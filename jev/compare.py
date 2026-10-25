"""Compare: two variants of a question set, scored on the same labeled rows.

A variant is a question set and a model. The Workbench runs both over the same Bulk rows
(workbench.run_compare); this module turns their answers to one question into a side-by-side
report. Like Calibrate, it is arithmetic over answers already returned, so it makes no model calls.

Each variant is scored by calibrate.evaluate on the same rows: those both variants answered, without
labels that either variant cannot score. A failed call on one side therefore cannot tilt the
comparison. The paired part counts those labeled rows: both right, only A right, only B right,
both wrong. The exact McNemar
test asks how often the rows where exactly one variant was right would split at least this
unevenly if neither variant were better.
"""

from __future__ import annotations

from math import comb
from typing import Any, List, Optional

from . import calibrate
from .calibrate import CalibrationError

NAMES = ("A", "B")


def mcnemar(a_only: int, b_only: int) -> float:
    """Exact two-sided McNemar p-value from the two discordant counts. 1.0 when there are none."""
    n = a_only + b_only
    if n == 0:
        return 1.0
    tail = sum(comb(n, i) for i in range(min(a_only, b_only) + 1))
    return min(1.0, 2 * tail / 2 ** n)


def _summary(report: dict) -> dict:
    keys = ("labeled", "unlabeled", "invalid", "correct", "accuracy", "ece", "sweep", "targets")
    return {k: report[k] for k in keys}


def _verdict(a: Optional[dict], b: Optional[dict]) -> Optional[str]:
    if a is None or b is None:
        return None
    if a["correct"] and b["correct"]:
        return "both_right"
    if a["correct"]:
        return "a_only"
    return "b_only" if b["correct"] else "both_wrong"


def evaluate(rows: Any, signal: str = "confidence") -> dict:
    """rows: [{"index": int, "label": ..., "answers": [A's answer or None, B's answer or None]}] for one question."""
    if signal not in calibrate.SIGNALS:
        raise CalibrationError("signal must be one of %s" % ", ".join(calibrate.SIGNALS))
    if not isinstance(rows, list):
        raise CalibrationError("rows must be a list")
    if len(rows) > calibrate.MAX_ROWS:
        raise CalibrationError("At most %d rows" % calibrate.MAX_ROWS)
    types: List[Optional[str]] = [None, None]
    pairs: List[tuple] = []
    only = [0, 0]  # rows answered by one variant alone: a failed or skipped call on the other side
    for row in rows:
        if not isinstance(row, dict):
            continue
        answers = row.get("answers")
        if not isinstance(answers, list) or len(answers) != 2:
            raise CalibrationError("Each row needs a list of two answers: [A, B]")
        present = [isinstance(a, dict) for a in answers]
        for v, answer in enumerate(answers):
            if present[v]:
                types[v] = types[v] or answer.get("type")
        if all(present):
            pairs.append((row, answers))
        elif any(present):
            only[present.index(True)] += 1
    for v, name in enumerate(NAMES):
        if types[v] is None:
            raise CalibrationError("Variant %s has no answers to this question, so there is nothing to compare. "
                                   "Check its failed calls." % name)
    if types[0] != types[1]:
        raise CalibrationError("This question is a %s in A and a %s in B. Compare needs the same type in both."
                               % (types[0], types[1]))
    if not pairs:
        raise CalibrationError("No row has answers from both variants to this question, so there is nothing to compare.")

    # Both variants are scored on the same rows: those both answered, minus any label that either one
    # cannot score (say, an option only the other variant offers). The ignored labels stay listed.
    def scorable(v: int, dropped: set) -> List[dict]:
        return [{"index": row.get("index"), "answer": answers[v],
                 "label": None if str(row.get("index")) in dropped else row.get("label")} for row, answers in pairs]

    first = [calibrate.evaluate(scorable(v, set()), signal) for v in (0, 1)]
    dropped = {str(x["index"]) for rep in first for x in rep["invalid"]}
    reports = [calibrate.evaluate(scorable(v, dropped), signal) for v in (0, 1)] if dropped else first
    for rep, seen in zip(reports, first):
        rep["invalid"], rep["unlabeled"] = seen["invalid"], seen["unlabeled"]
    scored = [{str(r["index"]): r for r in rep["rows"]} for rep in reports]

    counts = {"both_right": 0, "a_only": 0, "b_only": 0, "both_wrong": 0}
    agree = 0
    disagreements = []
    for row, answers in pairs:
        key = str(row.get("index"))
        try:
            reads = [calibrate.read(answer, signal) for answer in answers]
        except (KeyError, TypeError, ValueError, AttributeError):
            continue  # unreadable answers are reported by each variant's own invalid list
        hits = [s.get(key) for s in scored]
        verdict = _verdict(*hits)
        if verdict:
            counts[verdict] += 1
        if reads[0][0] == reads[1][0]:
            agree += 1
            continue
        disagreements.append({
            "index": row.get("index"),
            "label": hits[0]["label"] if hits[0] else (hits[1]["label"] if hits[1] else None),
            "verdict": verdict,
            "answers": [{"predicted": p, "signal": s, "correct": h["correct"] if h else None}
                        for (p, s), h in zip(reads, hits)],
        })
    return {
        "type": types[0], "signal": signal,
        "variants": [_summary(rep) for rep in reports],
        "paired": dict(counts, rows=sum(counts.values()), p_value=mcnemar(counts["a_only"], counts["b_only"])),
        "answered_both": agree + len(disagreements), "agree": agree,
        "only_a": only[0], "only_b": only[1], "excluded": len(dropped),
        "disagreements": disagreements,
    }
