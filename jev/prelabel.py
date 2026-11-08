"""Fill missing human labels on tuning rows before a paid Bulk run.

Preparing a queue reveals neither existing labels nor held-out rows. Applying drafts
returns edited rows for the browser's rows box; neither operation saves or calls a model.
"""

from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
from typing import Any, Dict, List

from . import csvimport, decisions, health, slices, workbench
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


def _csv_context(rows: List[Any], questions: Any) -> str:
    # Row order and all source labels matter, even outside the exported slice.
    # Keep Choice option order: it is part of the question schema.
    asked = workbench.validate_questions(questions) if questions not in (None, {}) else {}
    source = json.dumps(rows, sort_keys=True, ensure_ascii=False)
    schema = json.dumps(asked, ensure_ascii=False)
    return hashlib.sha256((source + "\n" + schema).encode("utf-8")).hexdigest()


def _csv_id(context: str, index: int) -> str:
    return hashlib.sha256((context + ":" + str(index)).encode("utf-8")).hexdigest()


def export_labels(rows: Any, questions: Any, field: Any = None, value: Any = None) -> dict:
    """Download only eligible inputs and blank human-label columns, never existing labels."""
    rows, asked = _source(rows, questions)
    report = prepare(rows, questions, field, value)
    context = _csv_context(rows, questions)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["row_id", "input", "missing"] + ["label:" + qid for qid in asked])
    for item in report["items"]:
        writer.writerow([_csv_id(context, item["index"]), decisions._key(item["row"]), json.dumps(item["missing"])] +
                        ["" for qid in asked])
    return {"csv": out.getvalue(), "rows": len(report["items"])}


def import_labels(rows: Any, questions: Any, text: Any) -> dict:
    """Preview a spreadsheet against the exact source snapshot; return nonblank drafts only."""
    rows, asked = _source(rows, questions)
    context = _csv_context(rows, questions)
    # CSV doubles quotes in JSON inputs and adds per-row handoff columns.
    limit = 3 * workbench.MAX_DATASET_CHARS
    if not isinstance(text, str) or not text.strip() or len(text) > limit:
        raise WorkbenchError("Supply a nonempty labels CSV of at most %d characters" % limit)
    try:
        parsed = [r for r in csv.reader(io.StringIO(text.lstrip("\ufeff"), newline=""),
                                       delimiter=csvimport._delimiter(text), strict=True) if any(c.strip() for c in r)]
    except csv.Error as err:
        raise WorkbenchError("Could not read the labels CSV: %s" % err) from err
    names = ["row_id", "input", "missing"] + ["label:" + qid for qid in asked]
    header = parsed[0] if parsed else []
    if len(header) != len(names) or set(header) != set(names):
        raise WorkbenchError("Keep exactly the row_id, input, missing, and label columns from Download labeling CSV")
    if len(parsed) < 2 or len(parsed) > workbench.MAX_BULK_ROWS + 1:
        raise WorkbenchError("Import between 1 and %d eligible rows" % workbench.MAX_BULK_ROWS)
    eligible = {_csv_id(context, item["index"]): item for item in _items(rows, asked)}
    seen, items, count = set(), [], 0
    for line, cells in enumerate(parsed[1:], 2):
        if len(cells) != len(header):
            raise WorkbenchError("Line %d has a different number of columns" % line)
        values = dict(zip(header, cells))
        rid = values["row_id"].strip()
        if rid not in eligible or rid in seen:
            raise WorkbenchError("Line %d has an unknown or repeated row_id; download CSV from the current rows and questions" % line)
        seen.add(rid)
        item = eligible[rid]
        try:
            state = json.loads(values["input"])
            same = isinstance(state, dict) and json.dumps(state, sort_keys=True, ensure_ascii=False) == decisions._key(item["row"])
        except (ValueError, TypeError):
            same = False
        if not same:
            raise WorkbenchError("Line %d changed its input; edit only the label columns" % line)
        try:
            missing_matches = json.loads(values["missing"]) == item["missing"]
        except ValueError:
            missing_matches = False
        if not missing_matches:
            raise WorkbenchError("Line %d changed its missing-label list; edit only the label columns" % line)
        labels = {}
        for qid, question in asked.items():
            cell = values["label:" + qid]
            if not cell.strip():
                continue
            if qid not in item["missing"]:
                raise WorkbenchError("Line %d: %s already has a label; only missing labels can be filled" % (line, qid))
            ok, value = csvimport.label_value(question, cell)
            if not ok:
                raise WorkbenchError("Line %d: %r is not an answer to %s" % (line, cell.strip(), qid))
            if value is not None:
                labels[qid] = value
        if labels:
            items.append({"index": item["index"], "labels": labels})
            count += len(labels)
    return {"items": items, "counts": {"rows": len(items), "matched": len(seen), "labels": count}}
