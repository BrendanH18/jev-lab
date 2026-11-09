"""Dataset revision history: local undo for every write that replaces or deletes a saved dataset.

Before data/workbench/datasets/<id>.json is replaced or deleted, the file as it stands is copied byte for byte to
data/workbench/datasets/.history/<id>/<UTC timestamp>-<short sha256>.json. A dataset file holds inputs, human labels
and configuration only, never model answers or measured results, so a revision holds the same and nothing more.
The newest KEEP revisions of each dataset are kept. Deleting a dataset keeps its history, so a delete can be undone.

A restore goes through the same candidate validation and change summary as a dataset replacement
(jev/dataset_changes.py): preview it, then restore with the preview's file revision token. A restore writes through
workbench.write_dataset, which snapshots the current file first, so a restore can be undone as well.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import re
import threading
from pathlib import Path
from typing import Any, List, Optional

from . import checks, dataset_changes, guidelines, testsplit, workbench
from .workbench import WorkbenchError

HISTORY_DIR = ".history"
KEEP = 20
HASH_CHARS = 12
REVISION = re.compile(r"(\d{8}T\d{12}Z)-([0-9a-f]{%d})" % HASH_CHARS)
_STAMP = "%Y%m%dT%H%M%S%fZ"


def history_dir() -> Path:
    return workbench.datasets_dir() / HISTORY_DIR


def _dir(dataset_id: str) -> Path:
    workbench._dataset_path(dataset_id)  # validates the id exactly as dataset files do
    return history_dir() / dataset_id


def _revision_path(dataset_id: str, revision: Any) -> Path:
    if not isinstance(revision, str) or not REVISION.fullmatch(revision):
        raise WorkbenchError("Invalid revision id")
    return _dir(dataset_id) / (revision + ".json")


def _revisions(dataset_id: str) -> List[Path]:
    """Revision files, oldest first. Names sort in time order."""
    folder = _dir(dataset_id)
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.glob("*.json") if p.is_file() and REVISION.fullmatch(p.stem))


def _stamp(previous: Optional[Path]) -> str:
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    if previous is not None:
        last = datetime.datetime.strptime(REVISION.fullmatch(previous.stem).group(1), _STAMP)
        if now <= last:  # a clock step back or two writes in one microsecond: keep names in write order
            now = last + datetime.timedelta(microseconds=1)
    return now.strftime(_STAMP)


@workbench.dataset_update()
def snapshot(dataset_id: str, replacing: Optional[str] = None) -> Optional[str]:
    """Copy the current dataset file into its history before it is replaced or deleted; return the revision id.

    None when there is no file, or when `replacing` (the text about to be written) is the same content. A revision
    identical to the newest one is not written again; its id is returned."""
    try:
        data = workbench._dataset_path(dataset_id).read_bytes()
    except FileNotFoundError:
        return None
    if replacing is not None and data == replacing.encode("utf-8"):
        return None
    existing = _revisions(dataset_id)
    if existing and existing[-1].read_bytes() == data:
        return existing[-1].stem
    revision = "%s-%s" % (_stamp(existing[-1] if existing else None), hashlib.sha256(data).hexdigest()[:HASH_CHARS])
    folder = _dir(dataset_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (revision + ".json")
    partial = folder / ("%s.%d.partial" % (revision, threading.get_ident()))
    partial.write_bytes(data)
    partial.replace(path)
    for old in _revisions(dataset_id)[:-KEEP]:
        old.unlink()
    return revision


def _read(dataset_id: str, revision: Any) -> dict:
    path = _revision_path(dataset_id, revision)
    try:
        dataset = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise WorkbenchError("Revision %s of %r is no longer kept. Refresh the history." % (revision, dataset_id))
    except ValueError:
        raise WorkbenchError("Revision %s of %r is not valid JSON" % (revision, dataset_id))
    if not isinstance(dataset, dict) or not isinstance(dataset.get("rows"), list):
        raise WorkbenchError("Revision %s of %r has no rows list" % (revision, dataset_id))
    return dataset


def _entry(dataset_id: str, path: Path, current: Optional[bytes]) -> dict:
    """What the history list shows for one revision: counts and question ids, never label values or rows."""
    stamp = REVISION.fullmatch(path.stem).group(1)
    at = datetime.datetime.strptime(stamp, _STAMP).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    data = path.read_bytes()
    out = {"revision": path.stem, "at": at, "current": data == current}
    try:
        dataset = json.loads(data.decode("utf-8"))
        rows = dataset["rows"]
        if not isinstance(rows, list):
            raise TypeError
        summary = workbench.dataset_summary(dict(dataset, id=dataset_id))
        questions = dataset.get("questions")
        out.update(name=dataset.get("name"), saved_at=dataset.get("saved_at"), rows=len(rows),
                   labeled=summary["labeled"], test_rows=summary["test"]["rows"] if summary["test"] else 0,
                   questions=list(questions) if isinstance(questions, dict) else [],
                   checks=1 if isinstance(dataset.get("check"), dict) else 0)
    except (ValueError, KeyError, TypeError, AttributeError):
        out["error"] = "Not a readable dataset file"
    return out


@workbench.dataset_update()
def revisions(dataset_id: str) -> dict:
    """A dataset's kept revisions, newest first, and whether the dataset file exists now."""
    try:
        current = workbench._dataset_path(dataset_id).read_bytes()
    except FileNotFoundError:
        current = None
    return {"id": dataset_id, "exists": current is not None, "keep": KEEP,
            "revisions": [_entry(dataset_id, path, current) for path in reversed(_revisions(dataset_id))]}


@workbench.dataset_update()
def deleted() -> List[dict]:
    """Datasets whose file is gone but whose history is kept, so a delete can be undone."""
    out = []
    if not history_dir().is_dir():
        return out
    for folder in sorted(history_dir().iterdir()):
        if not folder.is_dir() or not re.fullmatch(r"[a-z0-9-]{1,60}", folder.name):
            continue
        if workbench._dataset_path(folder.name).exists():
            continue
        kept = _revisions(folder.name)
        if kept:
            newest = _entry(folder.name, kept[-1], None)
            out.append({"id": folder.name, "name": newest.get("name"), "revisions": len(kept), "latest": newest["at"]})
    return out


NOTES = ("check_dropped", "guidelines_dropped")  # reported by a restore, never written to the file


def _looks(*tests: Any) -> list:
    """Test-split looks from several records, in order, each once: a restore never forgets that test rows were scored."""
    out, seen = [], set()
    for test in tests:
        for look in (test.get("looks") or []) if isinstance(test, dict) else []:
            key = json.dumps(look, sort_keys=True)
            if isinstance(look, dict) and key not in seen:
                seen.add(key)
                out.append(look)
    return out[-testsplit.MAX_LOOKS_KEPT:]


def _kept_test(dataset_id: str, revision: str) -> dict:
    """A kept revision's test record, or {} when it has none or cannot be read."""
    try:
        test = _read(dataset_id, revision).get("test")
    except WorkbenchError:
        return {}
    return test if isinstance(test, dict) else {}


def _candidate(dataset_id: str, revision: Any) -> tuple:
    """(prior dataset or {}, file token, the dataset a restore would write) after the replacement's validation."""
    raw = _read(dataset_id, revision)
    spec = {k: raw.get(k) for k in ("name", "notes", "questions", "rules", "rows")}
    try:
        same = isinstance(spec["name"], str) and workbench.slugify(spec["name"].strip()[:120]) == dataset_id
    except WorkbenchError:
        same = False
    if not same:
        raise WorkbenchError("Revision %s is named for a different dataset than %r" % (revision, dataset_id))
    candidate = workbench.prepare_dataset(spec)  # the same validation as saving or previewing a replacement
    token = dataset_changes._revision(dataset_id)
    prior = workbench.load_dataset(dataset_id) if token != "missing" else {}
    # The revision's own check comes back, not the current file's, when it still fits the revision's questions.
    candidate.pop("check", None)
    candidate.pop("check_dropped", None)
    if isinstance(raw.get("check"), dict):
        try:
            candidate["check"] = dict(checks.validate_check(raw["check"], candidate.get("questions")),
                                      saved_at=raw["check"].get("saved_at"))
        except WorkbenchError as err:
            candidate["check_dropped"] = str(err)
    # Likewise the revision's own labeling guidelines, kept where they still fit the revision's questions.
    candidate.pop("guidelines", None)
    candidate.pop("guidelines_dropped", None)
    guides, guides_dropped = guidelines.reconcile(raw.get("guidelines"), candidate.get("questions"))
    if guides:
        candidate["guidelines"] = guides
    if guides_dropped:
        candidate["guidelines_dropped"] = guides_dropped
    if "test" in candidate:
        # Test looks only accumulate: keep those recorded in the revision and since, so restoring an older
        # revision never hides how often the held-out rows were scored.
        old = raw.get("test") if isinstance(raw.get("test"), dict) else {}
        now = prior.get("test") if isinstance(prior.get("test"), dict) else {}
        # A deleted dataset has no current file: the kept revisions hold the looks recorded since. Merge them oldest
        # first (the selected revision is one of them) so the cap keeps the newest looks.
        kept = [] if prior else [_kept_test(dataset_id, p.stem) for p in _revisions(dataset_id)]
        candidate["test"] = {"locked_at": old.get("locked_at") or now.get("locked_at") or candidate["test"]["locked_at"],
                             "looks": _looks(*kept, old, now) if kept else _looks(old, now)}
    if len(workbench._dataset_text({k: v for k, v in candidate.items() if k not in NOTES})) > workbench.MAX_DATASET_CHARS:
        raise WorkbenchError("The dataset is too large to save (limit %d characters as JSON)" % workbench.MAX_DATASET_CHARS)
    return prior, token, candidate


@workbench.dataset_update()
def preview(dataset_id: str, revision: Any) -> dict:
    """What restoring `revision` would change, as a replacement preview reports it. Makes no writes."""
    prior, token, candidate = _candidate(dataset_id, revision)
    return dict(dataset_changes.summarize(prior, candidate, token), restoring=revision)


@workbench.dataset_update()
def restore(dataset_id: str, revision: Any, preview_revision: Any) -> dict:
    """Restore `revision` when the dataset file still matches the preview; the replaced file is kept as a revision."""
    if not isinstance(preview_revision, str) or preview_revision != dataset_changes._revision(dataset_id):
        raise WorkbenchError("The saved dataset changed after preview. Preview the restore again.")
    _prior, _token, candidate = _candidate(dataset_id, revision)
    notes = {k: candidate.pop(k) for k in NOTES if k in candidate}
    workbench.write_dataset(candidate)
    return dict(candidate, **notes)
