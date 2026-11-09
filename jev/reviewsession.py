"""Portable human Review edits, bound to their source file and saved dataset snapshot."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from . import decisions, workbench
from .workbench import WorkbenchError


def context(dataset: dict, text: str) -> str:
    # Preserve mapping order: Choice option order belongs to the configuration.
    raw = json.dumps([dataset, text], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _edits(items: Any, report: dict) -> list:
    if not isinstance(items, list) or len(items) > workbench.MAX_BULK_ROWS:
        raise WorkbenchError("Supply at most %d Review edit rows" % workbench.MAX_BULK_ROWS)
    eligible = {item["line"] for item in report["items"]}
    seen, clean = set(), []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"line", "labels"}:
            raise WorkbenchError("Review edits need only their line and human labels")
        line, labels = item["line"], item["labels"]
        if type(line) is not int or line not in eligible or line in seen:
            raise WorkbenchError("Review edits have an unknown or repeated queue line")
        seen.add(line)
        if not isinstance(labels, dict):
            raise WorkbenchError("Review labels must be keyed by question id")
        checked = {}
        for qid, value in labels.items():
            if qid not in report["questions"]:
                raise WorkbenchError("Review edit labels an unknown question")
            ok, normalized = decisions.label(report["questions"][qid], value)
            if not ok:
                raise WorkbenchError("Review edit has an invalid label for %s" % qid)
            checked[qid] = normalized  # A human clearing a suggestion must survive recovery too.
        if checked:
            clean.append({"line": line, "labels": checked})
    return clean


def _members(report: dict) -> list:
    return [{"line": item["line"], "kind": item["kind"]} for item in report["items"]]


def export_session(dataset_id: str, text: Any, seed: Any, audit: Any, snapshot: Any, items: Any) -> dict:
    """Return human edits and queue membership only; never copy gate answers or suggestions."""
    report = decisions.queue(dataset_id, text, audit, seed)
    if not isinstance(snapshot, str) or snapshot != report["session_context"]:
        raise WorkbenchError("Review source or dataset changed. Read decisions again before downloading a session")
    edits = _edits(items, report)
    return {"format": "jev-review-session", "version": 1, "dataset": dataset_id,
            "context": snapshot, "seed": seed, "audit": audit, "members": _members(report), "edits": edits}


def import_session(dataset_id: str, text: Any, session: Any) -> dict:
    """Validate an entire download and preview its original queue, without any writes or model calls."""
    keys = {"format", "version", "dataset", "context", "seed", "audit", "members", "edits"}
    if not isinstance(session, dict) or set(session) != keys:
        raise WorkbenchError("Supply a file from Download Review session")
    try:
        size = len(json.dumps(session, allow_nan=False))
    except (ValueError, TypeError) as err:
        raise WorkbenchError("Review session is not valid JSON") from err
    if size > decisions.MAX_TEXT_CHARS:
        raise WorkbenchError("Review session file is too large")
    if (session["format"] != "jev-review-session" or type(session["version"]) is not int
            or session["version"] != 1 or session["dataset"] != dataset_id):
        raise WorkbenchError("Review session does not match this dataset")
    report = decisions.queue(dataset_id, text, session["audit"], session["seed"])
    if session["context"] != report["session_context"]:
        raise WorkbenchError("Review session needs the original decisions file and unchanged saved dataset/check")
    # Strict JSON comparison rejects bool line numbers and extra member metadata too.
    if json.dumps(session["members"]) != json.dumps(_members(report)):
        raise WorkbenchError("Review session queue or audit membership changed")
    edits = _edits(session["edits"], report)
    index = {item["line"]: item for item in report["items"]}
    for edit in edits:
        index[edit["line"]]["labels"].update(edit["labels"])
    return {"report": report, "edits": edits,
            "counts": {"rows": len(report["items"]), "edited_rows": len(edits),
                       "labels": sum(len(item["labels"]) for item in edits)}}
