"""Dataset revision history offline: `lab.py history datasets|show|diff|labels|coverage|config|checks|verify`.

Every command reads data/workbench/datasets/.history (jev/history.py) and the dataset files through the app's own
helpers, so --data-dir applies. Nothing here restores, writes or deletes a revision: `history show --restore-preview`
runs the same read-only preview as the Datasets panel, and restoring stays in the Workbench. Outputs are counts,
question ids and configuration only: no input and no label value of any row is ever printed, held-out or not.

A REVISION argument is a kept revision id, a unique prefix of one (such as 20260301), `latest`, `oldest`, `~N` (N
revisions before the newest) or `current` (the dataset file as it is now).
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from jev import dataset_changes, decisions, guidelines, history, workbench
from jev.lab import kit

LABEL = workbench.LABEL_KEY
CURRENT = "current"
_STAMP = "%Y%m%dT%H%M%S%fZ"
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}(T[\d:.]*Z?)?")
_ID = re.compile(r"[a-z0-9-]{1,60}")
PARTS = ("name", "notes", "questions", "rules", "check", "guidelines", "split", "looks")
KINDS = ("added", "removed", "changed")


# ---------- reading revisions ----------


def _positive(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        value = 0
    if value < 1:
        raise argparse.ArgumentTypeError("expected a whole number of at least 1, got %r" % text)
    return value


def _since(text: str) -> str:
    if not _DATE.fullmatch(text):
        raise argparse.ArgumentTypeError("expected a date such as 2026-11-01 or a UTC time such as 2026-11-01T09:30:00Z")
    return text.rstrip("Z")


def _when(revision: str) -> str:
    """A revision id's UTC time, to the second."""
    stamp = history.REVISION.fullmatch(revision).group(1)
    return datetime.datetime.strptime(stamp, _STAMP).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(data: bytes) -> Optional[dict]:
    try:
        dataset = json.loads(data.decode("utf-8"))
    except ValueError:
        return None
    return dataset if isinstance(dataset, dict) and isinstance(dataset.get("rows"), list) else None


def _kept(dataset_id: str) -> List[dict]:
    """Kept revisions, oldest first: {"revision", "at", "data", "dataset"} (dataset None when unreadable)."""
    out = []
    for path in history._revisions(dataset_id):  # validates the id as dataset files do
        data = path.read_bytes()
        out.append({"revision": path.stem, "at": _when(path.stem), "data": data, "dataset": _parse(data)})
    return out


def _current(dataset_id: str) -> Optional[dict]:
    """The dataset file as it is now, shaped like a kept revision, or None when there is no readable file."""
    try:
        data = workbench._dataset_path(dataset_id).read_bytes()
    except FileNotFoundError:
        return None
    dataset = _parse(data)
    at = dataset.get("saved_at") if dataset else None
    return {"revision": CURRENT, "at": at if isinstance(at, str) else "", "data": data, "dataset": dataset}


def _timeline(dataset_id: str) -> List[dict]:
    """Readable kept revisions oldest first, then the current file when it is not the newest kept revision."""
    kept = _kept(dataset_id)
    current = _current(dataset_id)
    if current is not None and not (kept and kept[-1]["data"] == current["data"]):
        kept.append(current)
    out = [version for version in kept if version["dataset"] is not None]
    if not out:
        raise kit.CliError("No readable revisions kept for %r" % dataset_id)
    return out


def _pick(dataset_id: str, word: str) -> dict:
    """The version a REVISION argument names."""
    if word == CURRENT:
        current = _current(dataset_id)
        if current is None:
            raise kit.CliError("Dataset %r has no current file (it was deleted); name a kept revision" % dataset_id)
        found = current
    else:
        kept = _kept(dataset_id)
        if not kept:
            raise kit.CliError("No revisions kept for %r" % dataset_id)
        back = re.fullmatch(r"~(\d+)", word)
        if word == "latest":
            found = kept[-1]
        elif word == "oldest":
            found = kept[0]
        elif back:
            steps = int(back.group(1))
            if steps >= len(kept):
                raise kit.CliError("Only %d revisions are kept for %r" % (len(kept), dataset_id))
            found = kept[-1 - steps]
        else:
            exact = [version for version in kept if version["revision"] == word]
            matches = exact or [version for version in kept if word and version["revision"].startswith(word)]
            if not matches:
                raise kit.CliError("No kept revision of %r matches %r" % (dataset_id, word))
            if len(matches) > 1:
                raise kit.CliError("%r matches %d revisions of %r; give more of the revision id" % (word, len(matches), dataset_id))
            found = matches[0]
    if found["dataset"] is None:
        raise kit.CliError("Revision %s of %r is not a readable dataset file" % (found["revision"], dataset_id))
    return found


def _labels(row: Any) -> dict:
    value = row.get(LABEL) if isinstance(row, dict) else None
    return value if isinstance(value, dict) else {}


def _questions(dataset: dict) -> Dict[str, Any]:
    value = dataset.get("questions")
    return value if isinstance(value, dict) else {}


def _check(dataset: dict) -> Optional[dict]:
    value = dataset.get("check")
    return value if isinstance(value, dict) else None


def _test(dataset: dict) -> dict:
    value = dataset.get("test")
    return value if isinstance(value, dict) else {}


def _looks(dataset: dict) -> int:
    looks = _test(dataset).get("looks")
    return len(looks) if isinstance(looks, list) else 0


def _labeled(row: Any, qid: Optional[str] = None) -> bool:
    labels = _labels(row)
    if qid is not None:
        return labels.get(qid) is not None
    return any(value is not None for value in labels.values())


def _question_order(datasets: List[dict]) -> List[str]:
    """Question ids in the order they first appear, from the questions saved and then from labels."""
    order: List[str] = []
    for dataset in datasets:
        order.extend(qid for qid in _questions(dataset) if qid not in order)
    for dataset in datasets:
        for row in dataset["rows"]:
            order.extend(qid for qid in _labels(row) if qid not in order)
    return order


def _label_changes(before: dict, after: dict) -> Dict[str, Dict[str, List[int]]]:
    """{question: {"tuning": [added, removed, changed], "test": [...]}}, pairing rows as a replacement preview does
    (jev/dataset_changes.py): the same input in row order, labels and test markers ignored."""
    def groups(rows: list) -> Dict[str, list]:
        out: Dict[str, list] = {}
        for row in rows:
            out.setdefault(decisions._key(row), []).append(row)
        return out

    old_groups, new_groups = groups(before["rows"]), groups(after["rows"])
    out: Dict[str, Dict[str, List[int]]] = {}
    for key in set(old_groups) | set(new_groups):
        old, new = old_groups.get(key, []), new_groups.get(key, [])
        for index in range(max(len(old), len(new))):
            left = _labels(old[index]) if index < len(old) else {}
            right = _labels(new[index]) if index < len(new) else {}
            side = "test" if workbench.row_test(new[index] if index < len(new) else old[index]) else "tuning"
            for qid in set(left) | set(right):
                counts = out.setdefault(qid, {"tuning": [0, 0, 0], "test": [0, 0, 0]})[side]
                if qid not in left:
                    counts[0] += 1
                elif qid not in right:
                    counts[1] += 1
                elif json.dumps(left[qid], sort_keys=True) != json.dumps(right[qid], sort_keys=True):
                    counts[2] += 1
    return out


def _emit_or(args, columns: List[str], rows: List[list], empty: str) -> None:
    if not rows and getattr(args, "format", "table") == "table":
        print(empty)
    else:
        kit.emit(args, columns, rows)


def _keep_since(args, rows: List[list], at: int = 1) -> List[list]:
    if getattr(args, "since", None) is None:
        return rows
    return [row for row in rows if str(row[at]).rstrip("Z") >= args.since]


# ---------- history datasets ----------


def _configure_datasets(parser) -> None:
    kit.add_format(parser)
    parser.add_argument("--sort", choices=("id", "revisions", "newest", "bytes"), default="id",
                        help="order: id (default), most revisions, newest revision first, most bytes kept")
    parser.add_argument("--min", type=_positive, metavar="N",
                        help="keep datasets with at least N kept revisions (%d is the limit: the next save drops the oldest)"
                             % history.KEEP)
    parser.add_argument("--totals", action="store_true", help="add a row summing revisions and bytes")


def run_datasets(args) -> int:
    root = history.history_dir()
    rows = []
    for folder in sorted(root.iterdir()) if root.is_dir() else []:
        if not folder.is_dir() or not _ID.fullmatch(folder.name):
            continue
        kept = history._revisions(folder.name)
        if not kept:
            continue
        newest = _parse(kept[-1].read_bytes()) or {}
        name = newest.get("name") if isinstance(newest.get("name"), str) else None
        size = sum(path.stat().st_size for path in kept)
        rows.append([folder.name, name, len(kept), _when(kept[0].stem), _when(kept[-1].stem), size,
                     workbench._dataset_path(folder.name).exists()])
    if args.min:
        rows = [row for row in rows if row[2] >= args.min]
    if args.sort == "revisions":
        rows.sort(key=lambda row: (-row[2], row[0]))
    elif args.sort == "newest":
        rows.sort(key=lambda row: row[0])
        rows.sort(key=lambda row: row[4], reverse=True)
    elif args.sort == "bytes":
        rows.sort(key=lambda row: (-row[5], row[0]))
    if args.totals and rows:
        rows.append(["(total)", None, sum(row[2] for row in rows), min(row[3] for row in rows),
                     max(row[4] for row in rows), sum(row[5] for row in rows), None])
    _emit_or(args, ["dataset", "name", "revisions", "oldest", "newest", "bytes", "file"], rows,
             "No dataset history matches in this data directory.")
    return 0


# ---------- history show ----------


def _configure_show(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    parser.add_argument("revision", nargs="?", default="latest", help="revision (default: latest)")
    kit.add_format(parser)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--questions", action="store_true", help="list the revision's questions with labeled-row counts")
    group.add_argument("--restore-preview", action="store_true",
                       help="what restoring this revision would change, as counts; nothing is restored")


def _summary(dataset_id: str, version: dict) -> List[list]:
    dataset = version["dataset"]
    rows = dataset["rows"]
    held = [row for row in rows if workbench.row_test(row)]
    tuning = [row for row in rows if not workbench.row_test(row)]
    current = _current(dataset_id)
    same = None if current is None else current["data"] == version["data"]
    guides = dataset.get("guidelines")
    return [["revision", version["revision"]], ["at", version["at"]], ["name", dataset.get("name")],
            ["saved_at", dataset.get("saved_at")], ["bytes", len(version["data"])], ["rows", len(rows)],
            ["tuning_rows", len(tuning)], ["held_out_rows", len(held)],
            ["labeled_tuning", sum(_labeled(row) for row in tuning)], ["labeled_held_out", sum(_labeled(row) for row in held)],
            ["questions", len(_questions(dataset))], ["rules", bool(str(dataset.get("rules") or "").strip())],
            ["check", _check(dataset) is not None], ["guidelines", len(guides) if isinstance(guides, dict) else 0],
            ["test_looks", _looks(dataset)], ["same_as_current", same]]


def _question_rows(dataset: dict) -> List[list]:
    asked = _questions(dataset)
    out = []
    for qid in _question_order([dataset]):
        spec = asked.get(qid) if isinstance(asked.get(qid), dict) else {}
        criteria = spec.get("criteria")
        options = len(criteria) if spec.get("type") in ("choice", "score") and isinstance(criteria, (dict, list)) else None
        tuning = sum(_labeled(row, qid) for row in dataset["rows"] if not workbench.row_test(row))
        held = sum(_labeled(row, qid) for row in dataset["rows"] if workbench.row_test(row))
        out.append([qid, spec.get("type") if qid in asked else "(labels only)", options, tuning, held])
    return out


def _restore_rows(dataset_id: str, revision: str) -> List[list]:
    summary = history.preview(dataset_id, revision)  # read-only, the same validation as a restore
    rows, labels, test, guides = summary["rows"], summary["labels"], summary["test"], summary["guidelines"]
    return [["restoring", revision], ["file_exists", summary["exists"]], ["rows_before", rows["before"]],
            ["rows_after", rows["after"]], ["rows_added", rows["added"]], ["rows_removed", rows["removed"]],
            ["order_changed", rows["order_changed"]], ["labels_added", labels["added"]],
            ["labels_removed", labels["removed"]], ["labels_changed", labels["changed"]],
            ["questions_changed", summary["questions_changed"]], ["rules_changed", summary["rules_changed"]],
            ["name_or_notes_changed", summary["metadata_changed"]], ["check", summary["check"]],
            ["check_changed", summary["check_changed"]],
            ["guidelines_changed", len(guides["added"]) + len(guides["removed"]) + len(guides["changed"])],
            ["guidelines_dropped", len(guides.get("dropped") or [])], ["held_out_before", test["before"]],
            ["held_out_after", test["after"]], ["held_out_moved", test["changed_membership"]],
            ["test_history", test["history"]]]


def run_show(args) -> int:
    version = _pick(args.dataset, args.revision)
    if args.questions:
        _emit_or(args, ["question", "type", "options", "labeled_tuning", "labeled_held_out"],
                 _question_rows(version["dataset"]), "Revision %s asks no questions." % version["revision"])
        return 0
    if args.restore_preview:
        if version["revision"] == CURRENT:
            raise kit.CliError("--restore-preview needs a kept revision, not the current file")
        kit.emit(args, ["field", "value"], _restore_rows(args.dataset, version["revision"]))
        if args.format == "table":
            print("Preview only: nothing was restored. Restore from the Workbench's Datasets panel.")
        return 0
    kit.emit(args, ["field", "value"], _summary(args.dataset, version))
    return 0


# ---------- history diff ----------


def _configure_diff(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    parser.add_argument("old", help="the older revision")
    parser.add_argument("new", nargs="?", default=CURRENT, help="the newer revision (default: current)")
    kit.add_format(parser)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--by-question", action="store_true", help="count label changes per question")
    group.add_argument("--questions", action="store_true", help="list questions whose definition changed")
    parser.add_argument("--exit-code", action="store_true", help="exit 1 when the comparison finds a difference")


def _diff_rows(old: dict, new: dict) -> tuple:
    before, after = old["dataset"], new["dataset"]
    summary = dataset_changes.summarize(before, dict(after, id="-"), "-")
    rows, labels, test = summary["rows"], summary["labels"], summary["test"]
    guides = guidelines.changes(before.get("guidelines"), after.get("guidelines"))
    guides_changed = len(guides["added"]) + len(guides["removed"]) + len(guides["changed"])
    out = [["from", old["revision"]], ["to", new["revision"]], ["rows_before", rows["before"]], ["rows_after", rows["after"]],
           ["rows_added", rows["added"]], ["rows_removed", rows["removed"]], ["order_changed", rows["order_changed"]],
           ["labels_added", labels["added"]], ["labels_removed", labels["removed"]], ["labels_changed", labels["changed"]],
           ["held_out_before", test["before"]], ["held_out_after", test["after"]],
           ["held_out_moved", test["changed_membership"]], ["test_looks_before", _looks(before)],
           ["test_looks_after", _looks(after)], ["questions_changed", summary["questions_changed"]],
           ["rules_changed", summary["rules_changed"]], ["name_or_notes_changed", summary["metadata_changed"]],
           ["check_changed", summary["check_changed"]], ["guidelines_changed", guides_changed]]
    differs = bool(rows["added"] or rows["removed"] or rows["order_changed"] or any(labels.values())
                   or test["before"] != test["after"] or test["changed_membership"] or _looks(before) != _looks(after)
                   or summary["questions_changed"] or summary["rules_changed"] or summary["metadata_changed"]
                   or summary["check_changed"] or guides_changed)
    return out, differs


def _definition_changes(before: dict, after: dict) -> List[list]:
    old, new = _questions(before), _questions(after)
    old_order, new_order = list(old), list(new)
    out = []
    for qid in new_order + [qid for qid in old_order if qid not in new]:
        if qid not in old:
            out.append([qid, "added"])
            continue
        if qid not in new:
            out.append([qid, "removed"])
            continue
        a = old[qid] if isinstance(old[qid], dict) else {}
        b = new[qid] if isinstance(new[qid], dict) else {}
        changes = []
        if a.get("type") != b.get("type"):
            changes.append("type changed")
        if json.dumps(a.get("criteria")) != json.dumps(b.get("criteria")):  # Choice option order counts
            changes.append("options changed")
        if a.get("instructions") != b.get("instructions"):
            changes.append("instructions changed")
        shared_old = [q for q in old_order if q in new]
        shared_new = [q for q in new_order if q in old]
        if shared_old.index(qid) != shared_new.index(qid):
            changes.append("moved")
        if changes:
            out.append([qid, ", ".join(changes)])
    return out


def run_diff(args) -> int:
    old, new = _pick(args.dataset, args.old), _pick(args.dataset, args.new)
    if args.by_question:
        changes = _label_changes(old["dataset"], new["dataset"])
        rows = []
        for qid in _question_order([new["dataset"], old["dataset"]]):
            counts = changes.get(qid, {"tuning": [0, 0, 0], "test": [0, 0, 0]})
            rows.append([qid] + [counts["tuning"][i] + counts["test"][i] for i in range(3)])
        _emit_or(args, ["question", "added", "removed", "changed"], rows, "Neither revision has questions or labels.")
        differs = any(any(row[1:]) for row in rows)
    elif args.questions:
        rows = _definition_changes(old["dataset"], new["dataset"])
        _emit_or(args, ["question", "change"], rows, "No question definitions changed.")
        differs = bool(rows)
    else:
        rows, differs = _diff_rows(old, new)
        kit.emit(args, ["field", "value"], rows)
    return 1 if args.exit_code and differs else 0


# ---------- history labels ----------


def _configure_labels(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    parser.add_argument("question", help="question id")
    kit.add_format(parser)
    parser.add_argument("--all", action="store_true", help="also list revisions that left the question's labels alone")
    parser.add_argument("--split", action="store_true", help="count tuning and held-out label changes separately")
    parser.add_argument("--kind", choices=KINDS, help="keep revisions that added, removed or changed a label")
    parser.add_argument("--since", type=_since, metavar="DATE", help="keep revisions at or after DATE")


def run_labels(args) -> int:
    versions = _timeline(args.dataset)
    datasets = [version["dataset"] for version in versions]
    if args.question not in _question_order(datasets):
        raise kit.CliError("No kept revision of %r asks or labels %r" % (args.dataset, args.question))
    rows, found = [], False
    for previous, version in zip(versions, versions[1:]):
        counts = _label_changes(previous["dataset"], version["dataset"]).get(args.question,
                                                                            {"tuning": [0, 0, 0], "test": [0, 0, 0]})
        total = [counts["tuning"][i] + counts["test"][i] for i in range(3)]
        if args.kind and not total[KINDS.index(args.kind)]:
            continue
        if not (args.all or any(total)):
            continue
        line = [version["revision"], version["at"]] + (counts["tuning"] + counts["test"] if args.split else total)
        rows.append(line)
    rows = _keep_since(args, rows)
    found = any(any(line[2:]) for line in rows)
    columns = ["revision", "at"] + (["tuning_added", "tuning_removed", "tuning_changed", "test_added", "test_removed",
                                     "test_changed"] if args.split else list(KINDS))
    _emit_or(args, columns, rows, "No kept revision changed the labels of %r." % args.question)
    return 1 if found else 0


# ---------- history coverage ----------


def _configure_coverage(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--share", action="store_true", help="print each question's share of labeled rows instead of counts")
    parser.add_argument("--tuning", action="store_true", help="count tuning rows only, leaving held-out rows out")


def run_coverage(args) -> int:
    versions = _timeline(args.dataset)
    order = _question_order([version["dataset"] for version in versions])
    rows = []
    for version in versions:
        dataset = version["dataset"]
        counted = [row for row in dataset["rows"] if not (args.tuning and workbench.row_test(row))]
        asked = _questions(dataset)
        line: List[Any] = [version["revision"], version["at"], len(counted)]
        for qid in order:
            labeled = sum(_labeled(row, qid) for row in counted)
            if qid not in asked and not any(qid in _labels(row) for row in dataset["rows"]):
                line.append(None)
            elif args.share:
                line.append(round(labeled / len(counted), 3) if counted else None)
            else:
                line.append(labeled)
        rows.append(line)
    kit.emit(args, ["revision", "at", "rows"] + order, rows)
    return 0


# ---------- history config ----------


def _configure_config(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--part", choices=PARTS, help="keep revisions that changed this part of the configuration")


def _changed_parts(before: dict, after: dict) -> List[str]:
    def same(key: str, sort: bool = True) -> bool:
        return json.dumps(before.get(key), sort_keys=sort) == json.dumps(after.get(key), sort_keys=sort)

    moved = dataset_changes.summarize(before, dict(after, id="-"), "-")["test"]
    split = (sum(map(workbench.row_test, before["rows"])) != sum(map(workbench.row_test, after["rows"]))
             or moved["changed_membership"] or _test(before).get("locked_at") != _test(after).get("locked_at"))
    flags = {"name": before.get("name") != after.get("name"), "notes": (before.get("notes") or "") != (after.get("notes") or ""),
             "questions": not same("questions", sort=False), "rules": (before.get("rules") or "") != (after.get("rules") or ""),
             "check": not same("check"), "guidelines": not same("guidelines"), "split": bool(split),
             "looks": _looks(before) != _looks(after)}
    return [part for part in PARTS if flags[part]]


def run_config(args) -> int:
    versions = _timeline(args.dataset)
    rows = []
    for previous, version in zip(versions, versions[1:]):
        parts = _changed_parts(previous["dataset"], version["dataset"])
        if parts and (args.part is None or args.part in parts):
            rows.append([version["revision"], version["at"], ", ".join(parts)])
    _emit_or(args, ["revision", "at", "changed"], rows,
             "No kept revision changed %s." % ("the %s" % args.part if args.part else "the configuration"))
    return 0


# ---------- history checks ----------


def _configure_checks(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--gates", action="store_true", help="add one column per gated question with its threshold")
    parser.add_argument("--changes", action="store_true",
                        help="keep the oldest revision and those whose check differs from the revision before")


def _count(value: Any) -> int:
    return len(value) if isinstance(value, (dict, list)) else 0


def run_checks(args) -> int:
    versions = _timeline(args.dataset)
    gated: List[str] = []
    for version in versions:
        gates = (_check(version["dataset"]) or {}).get("gates")
        gated.extend(qid for qid in (gates if isinstance(gates, dict) else {}) if qid not in gated)
    rows, previous = [], None
    for index, version in enumerate(versions):
        check = _check(version["dataset"])
        config = json.dumps({k: v for k, v in (check or {}).items() if k != "saved_at"}, sort_keys=True) if check else None
        if args.changes and index and config == previous:
            continue
        previous = config
        spec = check or {}
        gates = spec.get("gates") if isinstance(spec.get("gates"), dict) else {}
        line: List[Any] = [version["revision"], version["at"], check is not None, spec.get("model"), spec.get("tuned_on"),
                           spec.get("signal", "confidence") if check else None, _count(gates) if check else None,
                           spec.get("min_accuracy"), spec.get("min_coverage"),
                           _count(spec.get("slice_targets")) if check else None,
                           _count(spec.get("answer_sets")) if check else None]
        if args.gates:
            line += [gates.get(qid) for qid in gated]
        rows.append(line)
    columns = ["revision", "at", "check", "model", "tuned_on", "signal", "gates", "min_accuracy", "min_coverage",
               "slice_targets", "answer_sets"]
    kit.emit(args, columns + (["gate:%s" % qid for qid in gated] if args.gates else []), rows)
    return 0


# ---------- history verify ----------


def _configure_verify(parser) -> None:
    parser.add_argument("dataset", nargs="?", help="verify one dataset's history (default: every dataset's)")
    kit.add_format(parser)
    parser.add_argument("--all", action="store_true", help="list every kept file with its status, not only problems")


def _file_problems(folder: Path, path: Path, previous: Optional[bytes]) -> List[str]:
    match = history.REVISION.fullmatch(path.stem)
    if path.suffix != ".json" or not path.is_file() or not match:
        return ["not a revision file; the Workbench ignores it"]
    data = path.read_bytes()
    problems = []
    try:
        datetime.datetime.strptime(match.group(1), _STAMP)
    except ValueError:
        problems.append("the time in its name is not a valid time")
    if hashlib.sha256(data).hexdigest()[:history.HASH_CHARS] != match.group(2):
        problems.append("its content does not match the hash in its name")
    dataset = _parse(data)
    if dataset is None:
        problems.append("not a readable dataset file")
    else:
        try:
            named = workbench.slugify(str(dataset.get("name") or "").strip()[:120])
        except workbench.WorkbenchError:
            named = None
        if named != folder.name:
            problems.append("named for another dataset, so it cannot be restored here")
    if previous is not None and previous == data:
        problems.append("the same content as the revision before")
    return problems


def run_verify(args) -> int:
    root = history.history_dir()
    if args.dataset:
        workbench._dataset_path(args.dataset)  # validates the id
        if not (root / args.dataset).is_dir():
            raise kit.CliError("No history is kept for %r" % args.dataset)
        folders = [root / args.dataset]
    else:
        folders = sorted(path for path in root.iterdir() if path.is_dir()) if root.is_dir() else []
    rows, problems, files = [], 0, 0
    for folder in folders:
        if not _ID.fullmatch(folder.name):
            rows.append([folder.name, "", "not a dataset id; the Workbench ignores this folder"])
            problems += 1
            continue
        previous = None
        entries = sorted(folder.iterdir())
        kept = [path for path in entries if path.is_file() and path.suffix == ".json" and history.REVISION.fullmatch(path.stem)]
        for path in entries:
            found = _file_problems(folder, path, previous)
            if path in kept:
                previous = path.read_bytes()
                files += 1
            problems += bool(found)
            if found or args.all:
                rows.append([folder.name, path.name, "; ".join(found) or "ok"])
        if len(kept) > history.KEEP:
            rows.append([folder.name, "", "%d revisions kept, more than the %d the Workbench keeps" % (len(kept), history.KEEP)])
            problems += 1
    if not problems and not args.all and args.format == "table":
        print("All %d kept revisions of %d datasets check out." % (files, len(folders)))
    else:
        kit.emit(args, ["dataset", "file", "problem" if not args.all else "status"], rows)
    return 1 if problems else 0


FORMAT = {"id": "format", "title": "--format json|csv|markdown prints the history list for scripts and docs"}

PACK = kit.define_pack({
    "id": "cli-history",
    "surface": "python.cli",
    "title": "Dataset revision history",
    "about": "Offline `lab.py history` commands over the revisions kept under data/workbench/datasets/.history: list "
             "datasets with history, summarize or preview restoring a revision, diff two revisions, trace when a "
             "question's labels changed, track label coverage, configuration and saved checks over time, and verify "
             "the kept files. Counts and configuration only, never a label value; nothing is restored or written.",
    "features": [
        {"id": "datasets", "kind": "cli", "command": ["history", "datasets"], "configure": _configure_datasets,
         "run": run_datasets,
         "title": "list datasets with kept history: revision count, oldest and newest revision, bytes kept, whether the file exists",
         "options": [
             FORMAT,
             {"id": "sort", "title": "--sort id|revisions|newest|bytes orders datasets with kept history"},
             {"id": "min", "title": "--min N keeps datasets with at least N kept revisions"},
             {"id": "totals", "title": "--totals adds a row summing kept revisions and bytes"},
         ]},
        {"id": "show", "kind": "cli", "command": ["history", "show"], "configure": _configure_show, "run": run_show,
         "title": "summarize one revision (latest, oldest, ~N, an id prefix or current) as row, label, question and check counts",
         "options": [
             {"id": "questions", "title": "--questions lists the revision's questions with tuning and held-out labeled-row counts"},
             {"id": "restore_preview", "title": "--restore-preview shows what restoring the revision would change, restoring nothing"},
         ]},
        {"id": "diff", "kind": "cli", "command": ["history", "diff"], "configure": _configure_diff, "run": run_diff,
         "title": "compare two revisions, or one with the current file, by row, label, held-out and configuration counts",
         "options": [
             {"id": "by_question", "title": "--by-question counts labels added, removed and changed per question"},
             {"id": "questions", "title": "--questions lists questions added, removed, moved or whose type, options or wording changed"},
             {"id": "exit_code", "title": "--exit-code exits 1 when the two revisions differ"},
         ]},
        {"id": "labels", "kind": "cli", "command": ["history", "labels"], "configure": _configure_labels, "run": run_labels,
         "title": "find the revisions that changed one question's labels, with counts, exiting 1 when one did",
         "options": [
             {"id": "all", "title": "--all also lists revisions that left the question's labels alone"},
             {"id": "split", "title": "--split counts tuning and held-out label changes separately"},
             {"id": "kind", "title": "--kind added|removed|changed keeps revisions with that kind of label change"},
             {"id": "since", "title": "--since DATE keeps revisions at or after a date"},
         ]},
        {"id": "coverage", "kind": "cli", "command": ["history", "coverage"], "configure": _configure_coverage,
         "run": run_coverage, "title": "track each question's labeled-row count across kept revisions and the current file",
         "options": [
             {"id": "share", "title": "--share prints each question's share of labeled rows instead of counts"},
             {"id": "tuning", "title": "--tuning counts tuning rows only, leaving held-out rows out"},
         ]},
        {"id": "config", "kind": "cli", "command": ["history", "config"], "configure": _configure_config, "run": run_config,
         "title": "list the revisions that changed the name, notes, questions, rules, check, guidelines, test split or looks",
         "options": [
             {"id": "part", "title": "--part PART keeps revisions that changed one part of the configuration"},
         ]},
        {"id": "checks", "kind": "cli", "command": ["history", "checks"], "configure": _configure_checks, "run": run_checks,
         "title": "track the saved check across revisions: model, tuned-on version, targets and gate, slice and cut counts",
         "options": [
             {"id": "gates", "title": "--gates adds each gated question's threshold per revision"},
             {"id": "changes", "title": "--changes keeps only the revisions whose saved check changed"},
         ]},
        {"id": "verify", "kind": "cli", "command": ["history", "verify"], "configure": _configure_verify, "run": run_verify,
         "title": "verify kept revision files: name, hash, readable JSON, dataset name, repeats and the keep limit; exits 1 on a problem",
         "options": [
             {"id": "all", "title": "--all lists every kept file with its status, not only problems"},
         ]},
    ],
})
