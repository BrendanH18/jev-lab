"""Portable pre-run labeling drafts, bound to the full source snapshot."""

from __future__ import annotations

import json
from typing import Any

from . import prelabel, workbench
from .workbench import WorkbenchError


def _normalized(rows: Any, questions: Any, items: Any) -> list:
    # Reuse Apply's eligibility and label validation without writing its edited rows.
    applied = prelabel.apply(rows, questions, items)
    return [{"index": item["index"], "labels": {
        qid: applied["rows"][item["index"]][workbench.LABEL_KEY][qid]
        for qid, value in item["labels"].items() if value is not None}}
        for item in items if any(value is not None for value in item["labels"].values())]


def export_draft(rows: Any, questions: Any, items: Any) -> dict:
    rows, asked = prelabel._source(rows, questions)
    drafts = {item["index"]: item["labels"] for item in _normalized(rows, questions, items)}
    schema = workbench.validate_questions(questions) if questions not in (None, {}) else {}
    entries = [dict(item, labels=drafts.get(item["index"], {})) for item in prelabel._items(rows, asked)]
    return {"format": "jev-labeling-draft", "version": 1,
            "context": prelabel._csv_context(rows, questions), "questions": schema, "items": entries}


def import_draft(rows: Any, questions: Any, text: Any) -> dict:
    """Validate and preview only; accepting in the browser merges human drafts."""
    limit = 3 * workbench.MAX_DATASET_CHARS
    if not isinstance(text, str) or not text.strip() or len(text) > limit:
        raise WorkbenchError("Supply a labeling draft JSON file of at most %d characters" % limit)
    try:
        draft = json.loads(text)
    except ValueError as err:
        raise WorkbenchError("Could not read the labeling draft JSON") from err
    expected = export_draft(rows, questions, [])
    if not isinstance(draft, dict) or set(draft) != set(expected):
        raise WorkbenchError("Supply a file from Download labeling draft")
    for key in ("format", "version", "context"):
        if type(draft[key]) is not type(expected[key]) or draft[key] != expected[key]:
            raise WorkbenchError("Labeling draft does not match the current rows and questions")
    # JSON equality alone ignores Choice option order.
    if json.dumps(draft["questions"], ensure_ascii=False) != json.dumps(expected["questions"], ensure_ascii=False):
        raise WorkbenchError("Labeling draft question schema changed")
    entries = draft["items"]
    if not isinstance(entries, list) or len(entries) != len(expected["items"]):
        raise WorkbenchError("Keep all tuning entries from Download labeling draft")
    items = []
    for entry, original in zip(entries, expected["items"]):
        if not isinstance(entry, dict) or set(entry) != set(original):
            raise WorkbenchError("Invalid labeling draft entry")
        if (type(entry["index"]) is not int or entry["index"] != original["index"]
                or entry["row"] != original["row"] or entry["missing"] != original["missing"]):
            raise WorkbenchError("Labeling draft inputs or duplicate positions changed")
        items.append({"index": entry["index"], "labels": entry["labels"]})
    clean = _normalized(rows, questions, items)
    return {"items": clean, "counts": {"matched": len(entries), "rows": len(clean),
                                       "labels": sum(len(item["labels"]) for item in clean)}}
