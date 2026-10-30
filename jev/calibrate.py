"""Calibrate: measure one question against labeled rows, then choose where to stop trusting it.

Everything here is arithmetic over answers Bulk already returned, so it makes no model calls. For
one question it reports accuracy, a confusion matrix, whether stated probabilities match observed
outcomes, and a threshold sweep: the share of rows a gate would let code act on automatically,
and how accurate those automated rows were (https://docs.typesafe.ai/confidence).

Correctness per type:
  * Choice: the selected option equals the label.
  * Noul: P(yes) >= 0.5 agrees with a yes/no label.
  * Score: the most likely level equals the labeled level.

Accuracy measured on a few dozen rows is itself uncertain, so each accuracy carries a 95% Wilson
score interval. Targets can be met by the measured accuracy ("estimate") or, more cautiously, by the
interval's lower bound ("lower"): then a threshold counts only when these rows show, with 95%
confidence, that the gate is at least that accurate.
"""

from __future__ import annotations

from math import ceil, sqrt
from typing import Any, Dict, List, Optional, Tuple

SIGNALS = ("confidence", "top_probability")
BOUNDS = ("estimate", "lower")  # what must reach a target accuracy: the measured accuracy, or its 95% lower bound
Z = 1.959964  # two-sided 95% normal quantile
TARGETS = (0.90, 0.95, 0.99)
STEPS = 100  # threshold resolution: 0.00, 0.01, ... 1.00
BINS = 10
MAX_ROWS = 1000
MAX_CLASSES = 255  # the Workbench's Choice option limit; Score allows fewer levels
_EPS = 1e-9


class CalibrationError(ValueError):
    pass


def wilson(correct: int, n: int) -> Tuple[Optional[float], Optional[float]]:
    """95% Wilson score interval for a proportion of correct / n. (None, None) when n is 0."""
    if not n:
        return None, None
    p = correct / n
    z2 = Z * Z
    centre = p + z2 / (2 * n)
    spread = Z * sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    denom = 1 + z2 / n
    low = 0.0 if correct == 0 else max(0.0, (centre - spread) / denom)
    high = 1.0 if correct == n else min(1.0, (centre + spread) / denom)
    return low, high


def rows_needed(target: float) -> int:
    """The fewest automated rows, every one right, whose Wilson lower bound reaches the target.

    With all n right the lower bound is n / (n + Z^2), so n must be at least Z^2 * target / (1 - target)."""
    n = max(1, ceil(Z * Z * target / (1 - target) - _EPS))
    while wilson(n, n)[0] + _EPS < target:  # guard the closed form against float rounding
        n += 1
    return n


def check_bound(bound: str) -> str:
    if bound not in BOUNDS:
        raise CalibrationError("bound must be one of %s" % ", ".join(BOUNDS))
    return bound


def meets(correct: int, n: int, target: float, bound: str = "estimate") -> bool:
    """Whether correct / n reaches the target, by the measured accuracy or by its 95% lower bound."""
    if not n:
        return False
    value = correct / n if bound == "estimate" else wilson(correct, n)[0]
    return value + _EPS >= target


def _unit(value: Any, what: str) -> float:
    """A probability-like number in [0, 1]; anything else is a bad answer, not a crash."""
    # Bounds first: they reject NaN and infinities, and a huge int cannot overflow a comparison.
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
        raise ValueError("%s must be a number from 0 to 1" % what)
    return float(value)


def _probs(answer: dict) -> Dict[str, float]:
    raw = answer.get("probabilities") or {}
    if not isinstance(raw, dict):
        raise ValueError("probabilities must be an object")
    if len(raw) > MAX_CLASSES:
        raise ValueError("more than %d options or levels" % MAX_CLASSES)
    return {str(k): _unit(v, "probability") for k, v in raw.items()}


def _choice_formula(probs: Dict[str, float]) -> float:
    """TypeSafe's Choice confidence: how far the top probability sits above an even split."""
    n = len(probs)
    if n < 2:
        return 1.0
    return max(0.0, (max(probs.values()) - 1 / n) / (1 - 1 / n))


def _label(qtype: str, raw: Any, answer: dict) -> Any:
    """The label in the answer's own terms, or ValueError with a reason a person can act on."""
    if qtype == "choice":
        options = list(_probs(answer))
        if isinstance(raw, str) and raw in options:
            return raw
        raise ValueError("label %r is not one of the options" % (raw,))
    if qtype == "noul":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text in ("yes", "true", "1", "y"):
            return True
        if text in ("no", "false", "0", "n"):
            return False
        raise ValueError("label %r is not yes or no" % (raw,))
    levels = sorted(int(k) for k in _probs(answer))
    if isinstance(raw, bool):
        raise ValueError("label %r is not a level number" % (raw,))
    try:
        level = float(raw)
    except (TypeError, ValueError):
        raise ValueError("label %r is not a level number" % (raw,))
    if not level.is_integer() or int(level) not in levels:
        raise ValueError("label %r is not one of the levels %s" % (raw, levels))
    return int(level)


def _read(qtype: str, answer: dict, signal: str) -> Tuple[Any, float, float]:
    """(prediction, gating signal, probability the prediction is right as the model states it)."""
    if qtype == "noul":
        p = _unit(answer.get("noul"), "noul")
        predicted = p >= 0.5
        top = max(p, 1 - p)
        gate = abs(2 * p - 1) if signal == "confidence" else top
        return predicted, gate, top
    probs = _probs(answer)
    if not probs:
        raise ValueError("answer has no probabilities")
    if qtype == "choice":
        predicted = answer["choice"]
        if predicted not in probs:
            raise ValueError("choice %r is not one of the answer's options" % (predicted,))
        top = probs[predicted]
    else:
        levels = {k: int(k) for k in probs}  # level keys must be whole numbers; ValueError otherwise
        best = max(probs, key=probs.get)
        predicted, top = levels[best], probs[best]
    if signal == "confidence":
        stated = answer.get("confidence")
        gate = _choice_formula(probs) if stated is None else _unit(stated, "confidence")
    else:
        gate = top
    return predicted, gate, top


def _show(qtype: str, value: Any) -> str:
    if qtype == "noul":
        return "yes" if value else "no"
    return str(value)


def read(answer: dict, signal: str = "confidence") -> Tuple[str, float]:
    """(prediction as Calibrate shows it, gating signal) for one answer. ValueError if unreadable."""
    qtype = answer.get("type")
    if qtype not in ("choice", "noul", "score"):
        raise ValueError("Calibrate works on Choice, Noul, and Score answers")
    predicted, gate, _ = _read(qtype, answer, signal)
    return _show(qtype, predicted), gate


def _classes(qtype: str, answer: dict) -> List[str]:
    if qtype == "noul":
        return ["yes", "no"]
    keys = list(_probs(answer))
    return [str(k) for k in sorted(int(k) for k in keys)] if qtype == "score" else keys


def sweep(rows: List[dict]) -> List[dict]:
    """For each threshold, how many rows clear the gate and how many of those are right."""
    points = []
    for i in range(STEPS + 1):
        t = i / STEPS
        auto = [r for r in rows if r["signal"] + _EPS >= t]
        correct = sum(1 for r in auto if r["correct"])
        low, high = wilson(correct, len(auto))
        points.append({
            "threshold": round(t, 2),
            "automated": len(auto),
            "correct": correct,
            "coverage": len(auto) / len(rows) if rows else 0.0,
            "accuracy": correct / len(auto) if auto else None,
            "low": low, "high": high,
        })
    return points


def targets(points: List[dict], bound: str = "estimate") -> List[dict]:
    """The lowest threshold whose automated rows reach each target accuracy, and what it automates.

    `needed` is the fewest automated rows, all right, that could show the target at 95% confidence."""
    out = []
    for target in TARGETS:
        hit = next((p for p in points if meets(p["correct"], p["automated"], target, bound)), None)
        out.append({"target": target, "threshold": hit and hit["threshold"],
                    "coverage": hit["coverage"] if hit else 0.0, "automated": hit["automated"] if hit else 0,
                    "accuracy": hit and hit["accuracy"], "low": hit and hit["low"], "high": hit and hit["high"],
                    "needed": rows_needed(target)})
    return out


def reliability(pairs: List[Tuple[float, bool]]) -> Tuple[List[dict], Optional[float]]:
    """Bins of stated probability against observed frequency, plus expected calibration error."""
    bins: List[List[Tuple[float, bool]]] = [[] for _ in range(BINS)]
    for p, hit in pairs:
        bins[min(int(p * BINS), BINS - 1)].append((p, hit))
    out = []
    ece = 0.0
    for i, members in enumerate(bins):
        if not members:
            continue
        stated = sum(p for p, _ in members) / len(members)
        observed = sum(1 for _, hit in members if hit) / len(members)
        ece += len(members) / len(pairs) * abs(stated - observed)
        out.append({"lo": i / BINS, "hi": (i + 1) / BINS, "count": len(members),
                    "stated": stated, "observed": observed, "hits": sum(1 for _, hit in members if hit)})
    return out, (ece if pairs else None)


def evaluate(rows: Any, signal: str = "confidence", bound: str = "estimate") -> dict:
    """rows: [{"index": int, "answer": {...}, "label": ...}] for one question. Unlabeled rows are counted, not scored.
    bound: what must reach each target accuracy, the measured accuracy or its 95% lower bound."""
    if signal not in SIGNALS:
        raise CalibrationError("signal must be one of %s" % ", ".join(SIGNALS))
    check_bound(bound)
    if not isinstance(rows, list):
        raise CalibrationError("rows must be a list")
    if len(rows) > MAX_ROWS:
        raise CalibrationError("At most %d rows" % MAX_ROWS)
    qtype = None
    first: Optional[dict] = None
    scored: List[dict] = []
    invalid: List[dict] = []
    signals: Dict[str, float] = {}  # every readable row, labeled or not, so a view can route all of them
    unlabeled = 0
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("answer"), dict):
            continue
        answer = row["answer"]
        if answer.get("type") not in ("choice", "noul", "score"):
            raise CalibrationError("Calibrate works on Choice, Noul, and Score answers")
        if qtype is None:
            qtype = answer["type"]
        elif answer["type"] != qtype:
            raise CalibrationError("All answers must come from the same question")
        index = row.get("index")
        try:
            signals[str(index)] = _read(qtype, answer, signal)[1]
            first = first or answer
        except (KeyError, TypeError, ValueError, AttributeError):
            pass
        if row.get("label") in (None, ""):
            unlabeled += 1
            continue
        try:
            label = _label(qtype, row["label"], answer)
            predicted, gate, top = _read(qtype, answer, signal)
        except (KeyError, TypeError, ValueError, AttributeError) as err:
            invalid.append({"index": index, "reason": str(err).strip("'\"")})
            continue
        noul_p = float(answer["noul"]) if qtype == "noul" else None
        scored.append({"index": index, "label": _show(qtype, label), "predicted": _show(qtype, predicted),
                       "correct": label == predicted, "signal": gate, "top": top,
                       # Noul calibration compares P(yes) with how often the label is yes.
                       "pair": (noul_p, label) if qtype == "noul" else (top, label == predicted)})
    if qtype is None:
        raise CalibrationError("No answers to calibrate. Run Bulk first.")
    classes = _classes(qtype, first) if first else []
    pos = {c: i for i, c in enumerate(classes)}
    counts = [[0] * len(classes) for _ in classes]
    for r in scored:
        if r["label"] in pos and r["predicted"] in pos:
            counts[pos[r["label"]]][pos[r["predicted"]]] += 1
    bins, ece = reliability([r.pop("pair") for r in scored])
    points = sweep(scored)
    correct = sum(1 for r in scored if r["correct"])
    low, high = wilson(correct, len(scored))
    return {
        "type": qtype, "signal": signal, "bound": bound,
        "labeled": len(scored), "unlabeled": unlabeled, "invalid": invalid,
        "correct": correct, "accuracy": correct / len(scored) if scored else None,
        "accuracy_low": low, "accuracy_high": high,
        "classes": classes, "confusion": counts,
        "reliability": bins, "ece": ece,
        "sweep": points, "targets": targets(points, bound) if scored else [],
        "rows": scored, "signals": signals,
    }
