"""Recover blind agreement samples and explicit human edits without saving or asking a model."""

from __future__ import annotations

import json
from typing import Any

from . import agreement, decisions, workbench
from .workbench import WorkbenchError


def _members(sample: dict) -> list:
    return [{"row_id": item["row_id"], "questions": item["questions"]} for item in sample["items"]]


def _labels(items: Any, sample: dict) -> list:
    if not isinstance(items, list) or len(items) > workbench.MAX_BULK_ROWS:
        raise WorkbenchError("Supply a list of second labels, at most one per sampled row")
    eligible = {item["row_id"]: item["questions"] for item in sample["items"]}
    clean, seen = [], set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {"row_id", "labels"}:
            raise WorkbenchError("Second labels need only their row_id and human labels")
        rid, labels = item["row_id"], item["labels"]
        if not isinstance(rid, str) or rid not in eligible or rid in seen:
            raise WorkbenchError("Second labels name an unknown or repeated sampled row; session recovery requires the "
                                 "original sample. Keep the filled-in CSV when comparing a different sample.")
        seen.add(rid)
        if not isinstance(labels, dict):
            raise WorkbenchError("Second labels must be keyed by question id")
        normalized = {}
        for qid, value in labels.items():
            if qid not in eligible[rid]:
                raise WorkbenchError("Only the sampled row's eligible questions can have second labels")
            ok, value = decisions.label(sample["questions"][qid], value)
            if not ok:
                raise WorkbenchError("Invalid second label for %s" % qid)
            if value is not None:
                normalized[qid] = value
        if normalized:
            clean.append({"row_id": rid, "labels": normalized})
    return clean


def _settlements(dataset_id: str, items: list, settlements: Any, sample: dict) -> list:
    if not isinstance(settlements, list) or len(settlements) > workbench.MAX_BULK_ROWS * workbench.MAX_QUESTIONS:
        raise WorkbenchError("Supply a list of explicit human settlements")
    if not settlements:
        return []
    # Recompute internally to validate edits, but never return saved labels on restore.
    report = agreement.compare(dataset_id, items=items, all_disagreements=True)
    eligible = {(item["row_id"], item["question"]) for item in report["disagreements"]}
    clean, seen = [], set()
    for item in settlements:
        if not isinstance(item, dict) or set(item) != {"row_id", "question", "value"}:
            raise WorkbenchError("Settlements need only row_id, question, and a human value")
        rid, qid = item["row_id"], item["question"]
        if not isinstance(rid, str) or not isinstance(qid, str) or (rid, qid) not in eligible or (rid, qid) in seen:
            raise WorkbenchError("Settlement names an unknown or repeated disagreement")
        seen.add((rid, qid))
        ok, value = decisions.label(sample["questions"][qid], item["value"])
        if not ok:
            raise WorkbenchError("Invalid settlement label for %s" % qid)
        clean.append({"row_id": rid, "question": qid, "value": value})
    return clean


@workbench.dataset_update()
def export_session(dataset_id: str, snapshot: Any, rows: Any, seed: Any, items: Any, settlements: Any = None) -> dict:
    """Keep only human second labels, settlements, and sample identifiers in the download."""
    sample = agreement.sample(dataset_id, rows, seed)
    if not isinstance(snapshot, str) or snapshot != sample["session_context"]:
        raise WorkbenchError("Dataset changed. Draw a new sample before downloading an agreement session")
    clean = _labels(items, sample)
    settled = _settlements(dataset_id, clean, [] if settlements is None else settlements, sample)
    return {"format": "jev-agreement-session", "version": 1, "dataset": dataset_id, "context": snapshot,
            "rows": rows, "seed": seed, "members": _members(sample), "items": clean, "settlements": settled}


@workbench.dataset_update()
def import_session(dataset_id: str, session: Any) -> dict:
    """Preview edits against the original saved snapshot, returning a sample that stays blind."""
    keys = {"format", "version", "dataset", "context", "rows", "seed", "members", "items", "settlements"}
    if not isinstance(session, dict) or set(session) != keys:
        raise WorkbenchError("Supply a file from Download agreement session")
    try:
        size = len(json.dumps(session, allow_nan=False))
    except (ValueError, TypeError) as err:
        raise WorkbenchError("Agreement session is not valid JSON") from err
    if size > workbench.MAX_DATASET_CHARS:
        raise WorkbenchError("Agreement session is too large")
    if (session["format"] != "jev-agreement-session" or type(session["version"]) is not int
            or session["version"] != 1 or session["dataset"] != dataset_id):
        raise WorkbenchError("Agreement session does not match this dataset")
    sample = agreement.sample(dataset_id, session["rows"], session["seed"])
    if session["context"] != sample["session_context"]:
        raise WorkbenchError("Agreement session needs the unchanged saved dataset and questions")
    if json.dumps(session["members"]) != json.dumps(_members(sample)):
        raise WorkbenchError("Agreement session sample membership changed")
    items = _labels(session["items"], sample)
    settlements = _settlements(dataset_id, items, session["settlements"], sample)
    return {"sample": sample, "items": items, "settlements": settlements,
            "counts": {"rows": len(sample["items"]), "edited_rows": len(items),
                       "labels": sum(len(item["labels"]) for item in items), "settlements": len(settlements)}}
