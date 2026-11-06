"""Inspect dataset inputs and human labels without making calls or changing rows.

Row numbers are one-based positions among the parsed rows. Findings contain positions and
question IDs, never input content or label values, including on held-out test rows.
Identities follow the Review queue: labels and test markers are ignored, pictures are kept,
and a text row matches the equivalent object with a ``text`` field.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from . import calibrate, decisions, workbench
from .workbench import WorkbenchError


def _label(question: dict, value: Any) -> tuple:
    if value is None:
        return True, None
    if question["type"] == "box":
        try:
            return True, calibrate._edges(value, "label")
        except ValueError:
            return False, None
    return decisions.label(question, value)


def analyze(rows: Any, questions: Any = None) -> dict:
    """Find duplicate inputs, conflicting labels, split overlap, and gaps in labels.

    ``rows`` is a list or Bulk's newline text; ``questions`` may be absent for identity
    checks alone. Each question reports labeled/missing counts, missing_rows, and invalid
    row numbers. ``invalid_labels`` lists nonempty labels for unknown question IDs when
    questions are supplied. A conflict lists the valid labeled copies that disagree;
    absent and invalid labels cannot create a conflict. No labels or inputs are returned.
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
        groups.setdefault(decisions._key(row), []).append(number)
        normalized = {}
        raw = raw or {}
        for qid, question in asked.items():
            report = reports[qid]
            value = raw.get(qid)
            if value is None:
                report["missing"] += 1
                report["missing_rows"].append(number)
                continue
            ok, value = _label(question, value)
            if not ok:
                report["invalid"].append(number)
            else:
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
    return {"rows": len(rows), "unique_inputs": len(groups), "duplicate_groups": duplicates,
            "conflicts": conflicts, "overlap": overlap, "questions": list(reports.values()),
            "invalid_labels": invalid_labels}
