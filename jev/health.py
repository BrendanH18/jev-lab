"""Inspect dataset inputs and human labels without making calls or changing rows.

Row numbers are one-based positions among the parsed rows. Findings contain positions and
question IDs, never label values, including on held-out test rows. Slice reports show only
the selected input field's values alongside counts.
Identities follow the Review queue: labels and test markers are ignored, pictures are kept,
and a text row matches the equivalent object with a ``text`` field.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from . import calibrate, decisions, lab, slices, workbench
from .workbench import WorkbenchError


def _label(question: dict, value: Any) -> tuple:
    if value is None:
        return True, None
    qtype = question["type"]
    # Calibrate reads label validity from the available option/level keys. No model output is needed.
    keys = question["criteria"] if qtype == "choice" else range(len(question["criteria"])) if qtype == "score" else []
    schema = {"probabilities": {str(key): 0.0 for key in keys}}
    try:
        return True, calibrate._label(qtype, value, schema)
    except ValueError:
        return False, None


def _slice_counts(rows: List[dict], questions: Dict[str, dict]) -> dict:
    return {"rows": len(rows), "unique_inputs": len({row["key"] for row in rows}),
            "questions": [{"qid": qid, "type": question["type"],
                           **{status: sum(row["labels"][qid] == status for row in rows)
                              for status in ("labeled", "missing", "invalid")}}
                          for qid, question in questions.items()]}


def _by_slice(rows: List[dict], questions: Dict[str, dict], field: Any) -> dict:
    fields = slices.fields(rows)
    if not isinstance(field, str) or field not in {option["name"] for option in fields}:
        field = None
    groups: Dict[str, List[dict]] = {}
    if field is not None:
        for row in rows:
            groups.setdefault(slices._value(row["row"], field), []).append(row)
    ordered = sorted(groups.items(), key=lambda item: (-len(item[1]), item[0] == slices.NONE, item[0]))
    return {"fields": fields, "field": field,
            "slices": [{"value": slices._shown(value), "rows": len(group),
                        "unique_inputs": len({row["key"] for row in group}),
                        "tuning": _slice_counts([row for row in group if not row["test"]], questions),
                        "test": _slice_counts([row for row in group if row["test"]], questions)}
                       for value, group in ordered]}


def analyze(rows: Any, questions: Any = None, field: Any = None) -> dict:
    """Find duplicate inputs, conflicting labels, split overlap, and gaps in labels.

    ``rows`` is a list or Bulk's newline text; ``questions`` may be absent for identity
    checks alone. Each question reports labeled/missing counts, missing_rows, and invalid
    row numbers. ``invalid_labels`` lists nonempty labels for unknown question IDs when
    questions are supplied. A conflict lists the valid labeled copies that disagree;
    absent and invalid labels cannot create a conflict. ``field`` selects an eligible input
    field for split-specific label counts; without one, no input values are returned.
    """
    if isinstance(rows, str):
        rows = workbench.parse_rows(rows)
    if isinstance(rows, list):
        rows = [row for row in rows if row not in (None, "")]
    if not isinstance(rows, list) or not rows:
        raise WorkbenchError("Provide a nonempty list of rows or Bulk's rows text")
    if len(rows) > workbench.MAX_BULK_ROWS:
        raise WorkbenchError("Inspect at most %d rows at a time" % workbench.MAX_BULK_ROWS)
    asked = workbench.validate_questions(questions) if questions not in (None, {}) else {}
    groups: Dict[str, List[int]] = {}
    labels: List[dict] = []
    slice_rows = []
    tests = set()
    invalid_labels = []
    reports = {qid: {"qid": qid, "type": question["type"], "labeled": 0, "missing": 0,
                     "missing_rows": [], "invalid": []} for qid, question in asked.items()}
    for number, row in enumerate(rows, 1):
        state, raw = workbench.split_labels(row, number)
        if workbench.row_test(state):
            tests.add(number)
        workbench.validate_state(workbench.without_marks(state))
        workbench.row_picture(state)
        key = decisions._key(row)
        groups.setdefault(key, []).append(number)
        clean = workbench.without_marks(state)
        entry = {"row": {"text": clean} if isinstance(clean, str) else clean,
                 "key": key, "test": number in tests, "labels": {}}
        slice_rows.append(entry)
        normalized = {}
        raw = raw or {}
        for qid, question in asked.items():
            report = reports[qid]
            value = raw.get(qid)
            if value is None:
                entry["labels"][qid] = "missing"
                report["missing"] += 1
                report["missing_rows"].append(number)
                continue
            ok, value = _label(question, value)
            if not ok:
                entry["labels"][qid] = "invalid"
                report["invalid"].append(number)
            else:
                entry["labels"][qid] = "labeled"
                report["labeled"] += 1
                normalized[qid] = value
        if asked:
            invalid_labels.extend({"row": number, "question": qid}
                                  for qid, value in raw.items() if qid not in asked and value is not None)
        labels.append(normalized)
    duplicates, conflicts, overlap = [], [], []
    for positions in groups.values():
        if len(positions) < 2:
            continue
        duplicates.append({"rows": positions})
        training = [n for n in positions if n not in tests]
        held = [n for n in positions if n in tests]
        if training and held:
            overlap.append({"rows": positions, "training": training, "test": held})
        for qid in asked:
            labeled = [n for n in positions if qid in labels[n - 1]]
            values = {json.dumps(labels[n - 1][qid], sort_keys=True) for n in labeled}
            if len(values) > 1:
                conflicts.append({"rows": labeled, "question": qid})
    # "lab": extra advisory findings from Lab packs (jev/lab/packs, kind health_check), as titles, row numbers and
    # messages. Like everything above, they never carry a label value or an input.
    return {"rows": len(rows), "unique_inputs": len(groups), "duplicate_groups": duplicates,
            "conflicts": conflicts, "overlap": overlap, "questions": list(reports.values()),
            "invalid_labels": invalid_labels, "by_slice": _by_slice(slice_rows, asked, field),
            "lab": lab.health_findings(rows, asked)}
