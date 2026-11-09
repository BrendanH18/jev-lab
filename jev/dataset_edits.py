"""Explicit, previewed repairs to tuning labels and redundant tuning copies.

These operations return editor rows only. They never save a file or call a model.
Input groups with any held-out copy are excluded from both operations.
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

from . import decisions, health, workbench
from .workbench import LABEL_KEY, WorkbenchError


def _source(rows: Any, questions: Any) -> tuple:
    rows = workbench.validate_rows(rows)
    report = health.analyze(rows, questions)
    asked = workbench.validate_questions(questions) if questions else {}
    # Keep Choice order in the schema, while ignoring JSON field order in inputs.
    context = hashlib.sha256((json.dumps(rows, sort_keys=True, ensure_ascii=False) + "\n" +
                              json.dumps(asked, ensure_ascii=False)).encode("utf-8")).hexdigest()
    groups = {}
    for index, row in enumerate(rows):
        groups.setdefault(decisions._key(row), []).append(index)
    protected = {i for group in groups.values() if any(workbench.row_test(rows[i]) for i in group) for i in group}
    return rows, asked, report, context, groups, protected


def prepare(rows: Any, questions: Any = None) -> dict:
    rows, asked, report, context, groups, protected = _source(rows, questions)
    eligible = {}
    for q in report["questions"]:
        if q["type"] in decisions.LABEL_TYPES:
            for number in q["invalid"]:
                if number - 1 not in protected:
                    eligible.setdefault(number - 1, {})[q["qid"]] = "invalid"
    for conflict in report["conflicts"]:
        qid = conflict["question"]
        if asked[qid]["type"] not in decisions.LABEL_TYPES or any(n - 1 in protected for n in conflict["rows"]):
            continue
        for number in conflict["rows"]:
            eligible.setdefault(number - 1, {})[qid] = "conflict"
    items = [{"index": i, "row": workbench.without_marks(rows[i]),
              "labels": {qid: rows[i][LABEL_KEY][qid] for qid in issues}, "issues": issues}
             for i, issues in sorted(eligible.items())]
    # Only byte-equivalent label maps may be collapsed. Missing vs explicit null stays distinct.
    remove = []
    for group in groups.values():
        seen = set()
        for index in group:
            if index in protected:
                continue
            raw = rows[index].get(LABEL_KEY, {}) if isinstance(rows[index], dict) else {}
            signature = json.dumps(raw, sort_keys=True, ensure_ascii=False)
            if signature in seen:
                remove.append(index)
            seen.add(signature)
    return {"context": context, "items": items, "questions": asked,
            "remove": sorted(remove), "protected_rows": len(protected)}


def _edited(rows: Any, questions: Any, context: Any, action: Any, items: Any) -> tuple:
    original, asked, _, current, _, _ = _source(rows, questions)
    if not isinstance(context, str) or context != current:
        raise WorkbenchError("Rows or questions changed. Prepare and preview dataset edits again.")
    report = prepare(original, asked)
    out, changes = copy.deepcopy(original), []
    if action == "deduplicate":
        if items not in (None, []):
            raise WorkbenchError("Duplicate cleanup does not accept label edits")
        removed = set(report["remove"])
        return [row for i, row in enumerate(out) if i not in removed], [], report["remove"]
    if action != "repair":
        raise WorkbenchError("Choose repair or deduplicate")
    if not isinstance(items, list) or len(items) > len(original):
        raise WorkbenchError("Provide at most one repair per row")
    eligible = {item["index"]: item["issues"] for item in report["items"]}
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            raise WorkbenchError("Each repair needs a row index and labels")
        index, labels = item.get("index"), item.get("labels")
        if isinstance(index, bool) or not isinstance(index, int) or index not in eligible or index in seen:
            raise WorkbenchError("Each repair must identify a distinct eligible tuning row")
        seen.add(index)
        if not isinstance(labels, dict):
            raise WorkbenchError("Repair labels must be keyed by question id")
        for qid, value in labels.items():
            if qid not in eligible[index]:
                raise WorkbenchError("Only invalid or conflicting Choice, Noul, or Score tuning labels can be repaired")
            ok, normalized = health._label(asked[qid], value)
            if not ok or normalized is None:
                raise WorkbenchError("Choose a valid human label for %s" % qid)
            if out[index][LABEL_KEY][qid] != normalized or type(out[index][LABEL_KEY][qid]) is not type(normalized):
                out[index][LABEL_KEY][qid] = normalized
                changes.append({"row": index + 1, "question": qid})
    return out, changes, []


def preview(rows: Any, questions: Any, context: Any, action: Any, items: Any = None) -> dict:
    out, changes, removed = _edited(rows, questions, context, action, items)
    token = hashlib.sha256(json.dumps([context, action, out], ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    return {"token": token, "changed": len(changes), "changes": changes,
            "removed": [i + 1 for i in removed], "remaining": len(out)}


def apply(rows: Any, questions: Any, context: Any, action: Any, items: Any, token: Any) -> dict:
    report = preview(rows, questions, context, action, items)
    if not isinstance(token, str) or token != report["token"]:
        raise WorkbenchError("Repairs changed since preview. Preview again before applying.")
    out, _, _ = _edited(rows, questions, context, action, items)
    return {"rows": out, "changed": report["changed"], "removed": len(report["removed"])}
