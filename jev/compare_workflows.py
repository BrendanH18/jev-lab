"""Inspect Compare slices and hand disagreement inputs to blank human labeling.

These operations only read the current run's answers or the user's input snapshot.
They make no model calls and save nothing.
"""

from __future__ import annotations

from typing import Any, Dict, List

from . import calibrate, compare, prelabel, slices, workbench
from .workbench import WorkbenchError


def by_slice(rows: Any, field: Any = None, signal: str = "confidence", first: str = "A",
             bound: str = "estimate") -> dict:
    """Score each input value on the successful pairs the current Compare run supplied."""
    if not isinstance(rows, list) or len(rows) > calibrate.MAX_ROWS:
        raise WorkbenchError("Provide at most %d Compare rows" % calibrate.MAX_ROWS)
    paired = []
    for item in rows:
        if not isinstance(item, dict):
            raise WorkbenchError("Each Compare row must be an object")
        state = item.get("row")
        if workbench.row_test(state):
            continue
        answers = item.get("answers")
        if isinstance(answers, list) and len(answers) == 2 and all(isinstance(a, dict) for a in answers):
            paired.append(dict(item, row=workbench.without_marks(state)))
    options = slices.fields(paired)
    if not isinstance(field, str) or field not in {option["name"] for option in options}:
        field = None
    groups: Dict[str, List[dict]] = {}
    if field is not None:
        for item in paired:
            groups.setdefault(slices._value(item["row"], field), []).append(item)
    reports = []
    for value, group in sorted(groups.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        result = {"value": value, "shown": slices._shown(value), "rows": len(group)}
        try:
            report = compare.evaluate(group, signal, first, bound)
            result.update(paired=report["paired"], excluded=report["excluded"],
                          variants=[{key: variant[key] for key in (
                              "labeled", "correct", "accuracy", "accuracy_low", "accuracy_high", "targets")}
                                    for variant in report["variants"]])
        except calibrate.CalibrationError as err:
            result["error"] = str(err)
        reports.append(result)
    return {"fields": options, "field": field, "paired_rows": len(paired), "slices": reports,
            "signal": signal, "bound": bound}


def labeling(rows: Any, questions: Any, indices: Any, qid: Any) -> dict:
    """Blank labels for disagreement inputs, preserving their original row positions.

    Compare indices count tuning rows after its 200-row cap and test-row exclusion.
    The queue indices count all original rows, which is what prelabel.apply expects.
    Existing labels, pictures, duplicate occurrences and held-out markers are untouched.
    """
    rows = workbench.validate_rows(rows)
    asked = workbench.validate_questions(questions)
    if not isinstance(qid, str) or qid not in asked or asked[qid]["type"] not in ("choice", "noul", "score"):
        raise WorkbenchError("Choose a shared Choice, Noul, or Score question to label")
    if not isinstance(indices, list) or len(indices) > workbench.MAX_BULK_ROWS:
        raise WorkbenchError("Provide the disagreement row indices")
    tuning = [index for index, row in enumerate(rows[:workbench.MAX_BULK_ROWS]) if not workbench.row_test(row)]
    selected = set()
    for index in indices:
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(tuning):
            raise WorkbenchError("A disagreement index does not match this Compare input snapshot")
        selected.add(tuning[index])
    report = prelabel.prepare(rows, asked)
    report["items"] = [item for item in report["items"]
                       if item["index"] in selected and qid in item["missing"]]
    report.update(eligible=len(report["items"]), missing=sum(len(item["missing"]) for item in report["items"]),
                  fields=[], field=None, values=[], value=None)
    return report
