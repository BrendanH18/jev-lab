"""Review labels: find labels worth a second look, and the unlabeled rows worth labeling next.

Every accuracy, threshold, and tuned gate in the Workbench rests on the labels, and labels are written by people
who make mistakes. This module reads answers Bulk already returned, so it makes no model calls.

Check labels lists every labeled answer that disagrees with its label, ordered by the probability the model gave
the label, lowest first. When the model put almost no probability on the label, the label is often the mistake,
or the question is worded so that the model reads it differently from the person labeling. Either way it is worth
a look: a wrong label on a confident answer counts against accuracy at every threshold, so a few of them can rule
out a threshold that would otherwise reach its target. Disagreements whose label got at most STRONG are marked.

Label next ranks the rows that answered one question but carry no label for it, nearest the current threshold
first. Those rows decide whether the threshold can move: just above it they are automated today, and just below it
they are automated if it drops. Ties go to the lower signal, then to the row index.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import calibrate
from .calibrate import CalibrationError

TYPES = ("choice", "noul", "score")
STRONG = 0.10  # a disagreement whose label got at most this probability is marked as a likely label error
EPS = calibrate._EPS  # the same tie rule as Calibrate: a signal equal to the threshold clears it


def _rows(rows: Any) -> List[dict]:
    if not isinstance(rows, list):
        raise CalibrationError("rows must be a list")
    if len(rows) > calibrate.MAX_ROWS:
        raise CalibrationError("At most %d rows" % calibrate.MAX_ROWS)
    return [r for r in rows if isinstance(r, dict) and isinstance(r.get("answers"), dict)]


def _threshold(value: Any) -> float:
    # Bounds alone: they reject NaN and infinities, and a huge int cannot overflow a comparison.
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
        raise CalibrationError("threshold must be a number from 0 to 1")
    return float(value)


def _types(rows: List[dict]) -> Dict[str, str]:
    """The type of every Choice, Noul, and Score question the rows answered. Box answers are left out."""
    types: Dict[str, str] = {}
    for row in rows:
        for qid, answer in row["answers"].items():
            if not isinstance(answer, dict) or answer.get("type") not in TYPES:
                continue
            if types.setdefault(qid, answer["type"]) != answer["type"]:
                raise CalibrationError("Answers to %r come from different question types" % qid)
    return types


def _label_probability(qtype: str, answer: dict, label: Any) -> float:
    """The probability the answer gave the label."""
    if qtype == "noul":
        p = calibrate._unit(answer.get("noul"), "noul")
        return p if label else 1 - p
    probs = calibrate._probs(answer)
    if qtype == "choice":
        return probs[label]
    return next(v for k, v in probs.items() if int(k) == label)


def _order(index: Any) -> tuple:
    """Row indexes sort as numbers, so row 10 follows row 9; anything else sorts after them as text."""
    return (0, index, "") if isinstance(index, int) and not isinstance(index, bool) else (1, 0, str(index))


def evaluate(rows: Any, question: Optional[str] = None, threshold: Any = 0.5, signal: str = "confidence") -> dict:
    """rows: Policy's rows, [{"index", "answers": {qid: answer}, "labels": {qid: label}}].

    Returns the disagreements over every labeled question and, when `question` is given, the unlabeled rows for it
    ranked by how near their signal is to `threshold`. Distances are rounded to 9 places so float noise cannot
    reorder rows the same distance away."""
    if signal not in calibrate.SIGNALS:
        raise CalibrationError("signal must be one of %s" % ", ".join(calibrate.SIGNALS))
    if question is not None and (not isinstance(question, str) or not question):
        raise CalibrationError("question must be a question id")
    t = _threshold(threshold)
    rows = _rows(rows)
    types = _types(rows)
    if question is not None and question not in types:
        raise CalibrationError("No Choice, Noul, or Score answers for %r. Run Bulk with it first." % question)
    suspects: List[dict] = []
    nxt: List[dict] = []
    checked = {q: {"labeled": 0, "disagree": 0, "strong": 0, "invalid": 0} for q in types}
    for row in rows:
        index = row.get("index")
        labels = row.get("labels") if isinstance(row.get("labels"), dict) else {}
        for qid, qtype in types.items():
            answer = row["answers"].get(qid)
            if not isinstance(answer, dict) or answer.get("type") != qtype:
                continue
            try:
                predicted, gate, top = calibrate._read(qtype, answer, signal)
            except (KeyError, TypeError, ValueError, AttributeError):
                continue  # an unreadable answer has nothing to review
            raw = labels.get(qid)
            if raw in (None, ""):
                if qid == question:
                    nxt.append({"index": index, "answer": calibrate._show(qtype, predicted), "top": top,
                                "signal": gate, "distance": round(abs(gate - t), 9), "above": gate + EPS >= t})
                continue
            try:
                label = calibrate._label(qtype, raw, answer)
                given = _label_probability(qtype, answer, label)
            except (KeyError, TypeError, ValueError, AttributeError, StopIteration):
                checked[qid]["invalid"] += 1
                continue
            checked[qid]["labeled"] += 1
            if label == predicted:
                continue
            strong = given <= STRONG + EPS
            checked[qid]["disagree"] += 1
            checked[qid]["strong"] += strong
            suspects.append({"index": index, "question": qid, "type": qtype,
                             "label": calibrate._show(qtype, label), "answer": calibrate._show(qtype, predicted),
                             "label_probability": given, "top": top, "signal": gate, "strong": strong})
    suspects.sort(key=lambda s: (s["label_probability"], -s["signal"], _order(s["index"]), s["question"]))
    nxt.sort(key=lambda r: (r["distance"], r["signal"], _order(r["index"])))
    return {"signal": signal, "question": question, "threshold": t, "strong_at": STRONG,
            "questions": checked, "suspects": suspects, "next": nxt}
