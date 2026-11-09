"""Read-only dataset replacement previews and revision-checked saves."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from typing import Any

from . import decisions, guidelines, workbench
from .workbench import WorkbenchError


def _revision(dataset_id: str) -> str:
    try:
        data = workbench._dataset_path(dataset_id).read_bytes()
    except FileNotFoundError:
        return "missing"
    return hashlib.sha256(data).hexdigest()


def _labels(row: Any) -> dict:
    value = row.get(workbench.LABEL_KEY) if isinstance(row, dict) else None
    return value if isinstance(value, dict) else {}


def _groups(rows: list) -> dict:
    groups = defaultdict(list)
    for row in rows:
        # Split changes are reported separately, so a label edit and a split move
        # still refer to the same input. Pair duplicate occurrences in row order.
        groups[decisions._key(row)].append(row)
    return groups


@workbench.dataset_update()
def preview(spec: dict) -> dict:
    candidate = workbench.prepare_dataset(spec)
    revision = _revision(candidate["id"])
    prior = workbench.load_dataset(candidate["id"]) if revision != "missing" else {}
    return summarize(prior, candidate, revision)


def summarize(prior: dict, candidate: dict, revision: str) -> dict:
    """Counts and configuration changes from the saved file `prior` ({} when missing) to `candidate`, without label
    values. `revision` is the saved file's token that a save or restore must still match (jev/history.py uses this too)."""
    before, after = _groups(prior.get("rows", [])), _groups(candidate["rows"])
    added = removed = labels_added = labels_removed = labels_changed = split_changed = 0
    for key in before.keys() | after.keys():
        old, new = before.get(key, []), after.get(key, [])
        added += max(0, len(new) - len(old))
        removed += max(0, len(old) - len(new))
        for index in range(max(len(old), len(new))):
            left = _labels(old[index]) if index < len(old) else {}
            right = _labels(new[index]) if index < len(new) else {}
            labels_added += len(right.keys() - left.keys())
            labels_removed += len(left.keys() - right.keys())
            labels_changed += sum(json.dumps(left[q], sort_keys=True) != json.dumps(right[q], sort_keys=True)
                                  for q in left.keys() & right.keys())
            if index < min(len(old), len(new)):
                split_changed += workbench.row_test(old[index]) != workbench.row_test(new[index])
    test_before = sum(workbench.row_test(row) for row in prior.get("rows", []))
    test_after = sum(workbench.row_test(row) for row in candidate["rows"])
    return {"id": candidate["id"], "exists": bool(prior), "revision": revision,
            "rows": {"before": len(prior.get("rows", [])), "after": len(candidate["rows"]),
                     "added": added, "removed": removed,
                     "order_changed": [decisions._key(r) for r in prior.get("rows", [])] !=
                                      [decisions._key(r) for r in candidate["rows"]]},
            "labels": {"added": labels_added, "removed": labels_removed, "changed": labels_changed},
            # Preserve Choice option order when comparing schemas.
            "questions_changed": json.dumps(prior.get("questions")) != json.dumps(candidate.get("questions")),
            "rules_changed": prior.get("rules", "") != candidate.get("rules", ""),
            "metadata_changed": any(prior.get(k, "") != candidate.get(k, "") for k in ("name", "notes")),
            "check": "removed" if candidate.get("check_dropped") else "preserved" if candidate.get("check") else "none",
            "check_dropped": candidate.get("check_dropped"),
            "check_changed": json.dumps(prior.get("check"), sort_keys=True) != json.dumps(candidate.get("check"), sort_keys=True),
            # Labeling guidelines by question id only: never a note, an example, or a label value.
            "guidelines": dict(guidelines.changes(prior.get("guidelines"), candidate.get("guidelines")),
                               dropped=candidate.get("guidelines_dropped") or []),
            "test": {"before": test_before, "after": test_after, "changed_membership": split_changed,
                     "history": "preserved" if test_after and prior.get("test") else "started" if test_after else
                                "removed" if prior.get("test") else "none"}}


@workbench.dataset_update()
def save(spec: dict, revision: Any) -> dict:
    # The server's dataset lock covers the read and write together, including
    # check edits, Review appends and test scoring between preview and Save.
    dataset_id = workbench.slugify(str(spec.get("name") or "").strip()[:120])
    if not isinstance(revision, str) or revision != _revision(dataset_id):
        raise WorkbenchError("The saved dataset changed after preview. Preview the replacement again.")
    return workbench.save_dataset(spec)
