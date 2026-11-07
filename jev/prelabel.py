"""Fill missing human labels on tuning rows before a paid Bulk run.

Preparing a queue reveals neither existing labels nor held-out rows. Applying drafts
returns edited rows for the browser's rows box; neither operation saves or calls a model.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List

from . import decisions, health, slices, workbench
from .workbench import LABEL_KEY, WorkbenchError


def _source(rows: Any, questions: Any) -> tuple:
    rows = workbench.validate_rows(rows)
    health.analyze(rows, questions)
    asked = workbench.validate_questions(questions) if questions not in (None, {}) else {}
    labelable = {qid: q for qid, q in asked.items() if q["type"] in decisions.LABEL_TYPES}
    return rows, labelable


def _items(rows: List[Any], questions: Dict[str, dict]) -> List[dict]:
    out = []
    for index, row in enumerate(rows):
        if workbench.row_test(row) or not isinstance(row, (str, dict)):
            continue
        clean = workbench.without_marks(row)
        if clean == {}:
            continue  # attaching labels would leave no state after split_labels
        raw = row.get(LABEL_KEY, {}) if isinstance(row, dict) else {}
        missing = [qid for qid in questions if raw.get(qid) is None]
        if missing:
            out.append({"index": index, "row": clean, "missing": missing})
    return out


def prepare(rows: Any, questions: Any, field: Any = None, value: Any = None) -> dict:
    """A blank-label queue, optionally filtered by a full normalized input value.

    Indices count the nonempty parsed rows from zero. Existing labels, even invalid
    ones, are never offered for replacement. Arrays cannot carry `_expect` labels.
    """
    rows, asked = _source(rows, questions)
    items = _items(rows, asked)
    fields = slices.fields(items)
    if not isinstance(field, str) or field not in {f["name"] for f in fields}:
        field = None
    counts: Dict[str, int] = {}
    if field is not None:
        for item in items:
            key = slices._value(item["row"], field)
            counts[key] = counts.get(key, 0) + 1
    if not isinstance(value, str) or value not in counts:
        value = None
    selected = [item for item in items if value is None or slices._value(item["row"], field) == value]
    return {"items": selected, "questions": asked, "fields": fields, "field": field, "value": value,
            "values": [{"value": key, "shown": slices._shown(key), "rows": count}
                       for key, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))],
            "eligible": len(items), "missing": sum(len(item["missing"]) for item in items)}


def apply(rows: Any, questions: Any, items: Any) -> dict:
    """Fill only missing tuning labels; reject a draft that would replace any label.

    The original row order, duplicate copies, other labels, and test markers survive.
    A text row is wrapped in a `text` object so it can carry its human labels.
    """
    rows, asked = _source(rows, questions)
    if not isinstance(items, list) or len(items) > len(rows):
        raise WorkbenchError("Provide a list of label drafts, at most one per row")
    eligible = {item["index"]: set(item["missing"]) for item in _items(rows, asked)}
    out, seen, applied = copy.deepcopy(rows), set(), 0
    for item in items:
        if not isinstance(item, dict):
            raise WorkbenchError("Each label draft needs an index and labels")
        index, labels = item.get("index"), item.get("labels")
        if isinstance(index, bool) or not isinstance(index, int) or index not in eligible:
            raise WorkbenchError("Label draft must identify a tuning row with missing labels")
        if index in seen:
            raise WorkbenchError("Provide each row's labels only once")
        seen.add(index)
        if not isinstance(labels, dict):
            raise WorkbenchError("Each label draft needs labels keyed by question id")
        clean = {}
        for qid, value in labels.items():
            if qid not in eligible[index]:
                raise WorkbenchError("Row %d: only missing Choice, Noul, or Score labels can be filled" % (index + 1))
            ok, normalized = health._label(asked[qid], value)
            if not ok:
                raise WorkbenchError("Row %d: invalid label for %s" % (index + 1, qid))
            if normalized is not None:
                clean[qid] = normalized
        if clean:
            row = out[index]
            if isinstance(row, str):
                row = {"text": row}
                out[index] = row
            row[LABEL_KEY] = dict(row.get(LABEL_KEY, {}), **clean)
            applied += len(clean)
    return {"rows": out, "applied": applied}
