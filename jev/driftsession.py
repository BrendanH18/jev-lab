"""Portable human traffic labels, without replaying a drift comparison or saving answers."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from . import decisions, workbench
from .workbench import WorkbenchError


def _browser_numbers(value: Any) -> Any:
    """JSON.stringify writes integer-valued numbers as integers, including negative zero."""
    if isinstance(value, dict):
        return {key: _browser_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_browser_numbers(item) for item in value]
    return int(value) if isinstance(value, float) and value.is_integer() else value


def input_key(row: Any) -> str:
    """One browser-stable traffic input identity for queueing, recovery and append."""
    return decisions._key(_browser_numbers(row))


def context(dataset: dict, members: list) -> str:
    # Question/Choice order belongs to the saved snapshot; row field order does not.
    raw = json.dumps([dataset, [[item["line"], input_key(item["row"])] for item in members]],
                     ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _queue(dataset: dict, members: Any) -> dict:
    questions, check = decisions._check(dataset)
    if not isinstance(members, list) or len(members) > workbench.MAX_BULK_ROWS:
        raise WorkbenchError("Supply at most %d traffic queue rows" % workbench.MAX_BULK_ROWS)
    have = {input_key(row) for row in dataset["rows"]}
    lines, seen, items = set(), set(), []
    for member in members:
        if not isinstance(member, dict) or set(member) != {"line", "row"}:
            raise WorkbenchError("Traffic queue rows need only their original line and input")
        line, row = member["line"], member["row"]
        if type(line) is not int or not 1 <= line <= workbench.MAX_BULK_ROWS or line in lines:
            raise WorkbenchError("Traffic queue has an invalid or repeated line")
        lines.add(line)
        if (not isinstance(row, dict) or not row
                or workbench.LABEL_KEY in row or workbench.TEST_KEY in row):
            raise WorkbenchError("Traffic queue inputs must be objects without labels or test markers")
        workbench.validate_state(row)
        workbench.row_picture(row)
        key = input_key(row)
        if key in have or key in seen:
            raise WorkbenchError("Traffic queue contains repeated inputs or inputs already in the dataset")
        seen.add(key)
        items.append({"index": line - 1, "line": line, "row": row,
                      "labels": {qid: None for qid in questions}, "open": list(check["gates"])})
    return {"questions": questions, "gates": check["gates"], "items": items,
            "room": max(0, workbench.MAX_BULK_ROWS - len(dataset["rows"])),
            "counts": {"eligible": len(items), "queued": len(items), "in_dataset": 0,
                       "repeated": 0, "unsupported": 0}, "session_context": context(dataset, members)}


def _edits(items: Any, queue: dict) -> list:
    if not isinstance(items, list) or len(items) > workbench.MAX_BULK_ROWS:
        raise WorkbenchError("Supply at most one human edit per traffic queue row")
    eligible = {item["line"] for item in queue["items"]}
    clean, seen = [], set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {"line", "labels"}:
            raise WorkbenchError("Traffic edits need only their line and human labels")
        line, labels = item["line"], item["labels"]
        if type(line) is not int or line not in eligible or line in seen:
            raise WorkbenchError("Traffic edit has an unknown or repeated queue line")
        seen.add(line)
        if not isinstance(labels, dict):
            raise WorkbenchError("Traffic labels must be keyed by question id")
        checked = {}
        for qid, value in labels.items():
            if qid not in queue["questions"]:
                raise WorkbenchError("Traffic edit labels an unknown question")
            ok, value = decisions.label(queue["questions"][qid], value)
            if not ok:
                raise WorkbenchError("Invalid traffic label for %s" % qid)
            if value is not None:
                checked[qid] = value
        if checked:
            clean.append({"line": line, "labels": checked})
    return clean


def _size(session: dict) -> None:
    try:
        size = len(json.dumps(session, allow_nan=False))
    except (ValueError, TypeError) as err:
        raise WorkbenchError("Traffic labeling draft is not valid JSON") from err
    if size > workbench.MAX_DATASET_CHARS:
        raise WorkbenchError("Traffic labeling draft is too large")


@workbench.dataset_update()
def export_session(dataset_id: str, snapshot: Any, members: Any, items: Any) -> dict:
    """Validate the original queue and return inputs, schema and human drafts only."""
    dataset = workbench.load_dataset(dataset_id)
    queue = _queue(dataset, members)
    if not isinstance(snapshot, str) or snapshot != queue["session_context"]:
        raise WorkbenchError("Dataset, check or traffic queue changed. Download before saving dataset changes")
    session = {"format": "jev-traffic-label-draft", "version": 1, "dataset": dataset_id,
               "context": snapshot, "questions": queue["questions"], "members": members,
               "items": _edits(items, queue)}
    _size(session)
    return session


@workbench.dataset_update()
def import_session(dataset_id: str, session: Any) -> dict:
    """Preview a standalone human labeling queue; never reconstruct comparison statistics."""
    keys = {"format", "version", "dataset", "context", "questions", "members", "items"}
    if not isinstance(session, dict) or set(session) != keys:
        raise WorkbenchError("Supply a file from Download traffic labeling draft")
    _size(session)
    if (session["format"] != "jev-traffic-label-draft" or type(session["version"]) is not int
            or session["version"] != 1 or session["dataset"] != dataset_id):
        raise WorkbenchError("Traffic labeling draft does not match this dataset")
    dataset = workbench.load_dataset(dataset_id)
    queue = _queue(dataset, session["members"])
    if (session["context"] != queue["session_context"]
            or json.dumps(session["questions"]) != json.dumps(queue["questions"])):
        raise WorkbenchError("Traffic labeling draft needs its original queue and unchanged saved dataset/check")
    edits = _edits(session["items"], queue)
    by_line = {item["line"]: item for item in queue["items"]}
    for edit in edits:
        by_line[edit["line"]]["labels"].update(edit["labels"])
    return {"labeling": queue, "counts": {"rows": len(queue["items"]), "edited_rows": len(edits),
                                          "labels": sum(len(item["labels"]) for item in edits)}}
