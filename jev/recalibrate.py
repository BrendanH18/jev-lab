"""Monotone probability maps fitted to Bulk labels, selected only on unseen folds.

No model calls or persistence. The selected Calibrate signal estimates prediction correctness;
this does not change routing thresholds. Confidence can be a margin rather than a probability.
"""
from __future__ import annotations

import json
import math
from bisect import bisect_right
from typing import Any, List, Tuple

from . import calibrate, holdout
from .workbench import WorkbenchError

MIN_ROWS = 20
EPS = 1e-6
RIDGE = 0.01


def clip(p: float) -> float:
    return min(1 - EPS, max(EPS, p))


def logistic(x: float) -> float:
    return 1 / (1 + math.exp(-max(-35, min(35, x))))


def logit(p: float) -> float:
    p = clip(p)
    return math.log(p / (1 - p))


def platt(pairs: List[Tuple[float, bool]]) -> dict:
    """Constrained Newton fit: nonnegative slope preserves probability order.

    Ridge on both parameters and backtracking keep small/separated samples stable.
    Single-class training folds are allowed; the complete dataset must contain both classes.
    """
    data = [(logit(p), float(y)) for p, y in pairs]
    a, b = 1.0, 0.0

    def loss(a: float, b: float) -> float:
        return sum(max(z, 0) - y * z + math.log1p(math.exp(-abs(z)))
                   for x, y in data for z in [a * x + b]) + RIDGE * (a * a + b * b) / 2

    for _ in range(100):
        ga, gb, aa, ab, bb = RIDGE * a, RIDGE * b, RIDGE, 0.0, RIDGE
        for x, y in data:
            q = logistic(a * x + b)
            w = q * (1 - q)
            ga += (q - y) * x
            gb += q - y
            aa += w * x * x
            ab += w * x
            bb += w
        det = aa * bb - ab * ab
        da, db = (bb * ga - ab * gb) / det, (aa * gb - ab * ga) / det
        if a - da < 0:
            # Solve the quadratic subproblem on the nonnegative-slope boundary.
            da, db = a, (gb - ab * a) / bb
        old = loss(a, b)
        step = 1.0
        for _ in range(30):
            na, nb = max(0.0, a - step * da), b - step * db
            if loss(na, nb) <= old:
                break
            step /= 2
        if max(abs(na - a), abs(nb - b)) < 1e-9:
            break
        a, b = na, nb
    return {"method": "platt", "a": a, "b": b}


def isotonic(pairs: List[Tuple[float, bool]]) -> dict:
    """Weighted PAV over unique input probabilities, then linear interpolation."""
    groups = {}
    for p, y in pairs:
        total, n = groups.get(p, (0, 0))
        groups[p] = (total + int(y), n + 1)
    xs = sorted(groups)
    blocks = []
    for i, p in enumerate(xs):
        total, n = groups[p]
        blocks.append([i, i, total, n])
        while len(blocks) > 1 and blocks[-2][2] / blocks[-2][3] > blocks[-1][2] / blocks[-1][3]:
            right, left = blocks.pop(), blocks.pop()
            blocks.append([left[0], right[1], left[2] + right[2], left[3] + right[3]])
    ys = [0.0] * len(xs)
    for start, end, total, n in blocks:
        ys[start:end + 1] = [clip(total / n)] * (end - start + 1)
    return {"method": "isotonic", "knots": list(zip(xs, ys))}


def apply(mapping: dict, p: float) -> float:
    if mapping["method"] == "raw":
        return p
    if mapping["method"] == "platt":
        return clip(logistic(mapping["a"] * logit(p) + mapping["b"]))
    knots = mapping["knots"]
    i = bisect_right([x for x, _ in knots], p)
    if i == 0:
        return knots[0][1]
    if i == len(knots):
        return knots[-1][1]
    x0, y0 = knots[i - 1]
    x1, y1 = knots[i]
    return y0 + (y1 - y0) * (p - x0) / (x1 - x0)


def measure(pairs: List[Tuple[float, bool]]) -> dict:
    bins, ece = calibrate.reliability(pairs)
    return {"ece": ece, "reliability": bins,
            "brier": sum((p - y) ** 2 for p, y in pairs) / len(pairs),
            "log_loss": -sum(math.log(clip(p) if y else 1 - clip(p)) for p, y in pairs) / len(pairs)}


def source(mapping: dict) -> dict:
    """Standalone functions, including identical clamps and interpolation in both languages."""
    method = mapping["method"]
    py = "def calibrated(p):\n"
    js = "function calibrated(p) {\n"
    if method == "raw":
        return {"python": py + "    return p\n", "javascript": js + "  return p;\n}\n"}
    if method == "platt":
        a, b = mapping["a"], mapping["b"]
        py += ("    import math\n    p = min(1 - 1e-6, max(1e-6, p))\n"
               f"    z = {a!r} * math.log(p / (1 - p)) + {b!r}\n"
               "    return min(1 - 1e-6, max(1e-6, 1 / (1 + math.exp(-max(-35, min(35, z))))))\n")
        js += ("  p = Math.min(1 - 1e-6, Math.max(1e-6, p));\n"
               f"  const z = {a!r} * Math.log(p / (1 - p)) + {b!r};\n"
               "  return Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))))));\n}\n")
    else:
        knots = json.dumps(mapping["knots"])
        py += (f"    knots = {knots}\n    if p <= knots[0][0]:\n        return knots[0][1]\n"
               "    for (x0, y0), (x1, y1) in zip(knots, knots[1:]):\n"
               "        if p <= x1:\n            return y0 + (y1 - y0) * (p - x0) / (x1 - x0)\n"
               "    return knots[-1][1]\n")
        js += (f"  const knots = {knots};\n  if (p <= knots[0][0]) return knots[0][1];\n"
               "  for (let i = 1; i < knots.length; i++) {\n"
               "    const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];\n"
               "    if (p <= x1) return y0 + (y1 - y0) * (p - x0) / (x1 - x0);\n"
               "  }\n  return knots[knots.length - 1][1];\n}\n")
    return {"python": py, "javascript": js}


def evaluate(rows: Any, signal: str = "confidence") -> dict:
    if not isinstance(rows, list) or len(rows) > calibrate.MAX_ROWS:
        raise WorkbenchError("rows must be a list of at most %d rows" % calibrate.MAX_ROWS)
    rows = [r for r in rows if not isinstance(r, dict) or r.get("_test") is not True]
    # Give Calibrate unique internal indexes so missing or duplicate user indexes cannot lose keys.
    indexed = [dict(r, index=i) if isinstance(r, dict) else r for i, r in enumerate(rows)]
    try:
        report = calibrate.evaluate(indexed, signal)
    except calibrate.CalibrationError as err:
        raise WorkbenchError(str(err)) from err
    if report["type"] == "box":
        raise WorkbenchError("Recalibrate supports Choice, Noul and Score; Box is out of scope.")
    scored = report["rows"]
    if len(scored) < MIN_ROWS:
        raise WorkbenchError("Recalibrate needs at least %d valid labeled rows (got %d)." % (MIN_ROWS, len(scored)))
    if len({r["correct"] for r in scored}) < 2:
        raise WorkbenchError("Recalibrate needs both right and wrong answers; all labeled answers are right or all are wrong.")
    pairs = [(r["signal"], r["correct"]) for r in scored]
    indexes = [rows[r["index"]].get("index", r["index"]) for r in scored]
    keys = [holdout._key(dict(rows[r["index"]], index=indexes[i])) for i, r in enumerate(scored)]
    if any("row" not in rows[r["index"]] and rows[r["index"]].get("key")
           and not isinstance(rows[r["index"]]["key"], str) for r in scored):
        raise WorkbenchError("Each row key must be a string")
    issue = holdout.problem(keys, holdout.FOLDS)
    if issue:
        raise WorkbenchError(issue)
    folds = holdout.assign(keys, indexes, holdout.FOLDS)
    methods = {}
    for name, fit in [("raw", lambda _: {"method": "raw"}), ("platt", platt), ("isotonic", isotonic)]:
        mapping = fit(pairs)
        unseen = [0.0] * len(pairs)
        for f in range(holdout.FOLDS):
            trained = fit([pair for i, pair in enumerate(pairs) if folds[i] != f])
            for i, (p, _) in enumerate(pairs):
                if folds[i] == f:
                    unseen[i] = apply(trained, p)
        methods[name] = {"map": mapping, "fit": measure([(apply(mapping, p), y) for p, y in pairs]),
                         "cv": measure([(unseen[i], y) for i, (_, y) in enumerate(pairs)]),
                         "source": source(mapping)}
    best = min(methods, key=lambda m: methods[m]["cv"]["log_loss"])
    raw_loss = methods["raw"]["cv"]["log_loss"]
    margin = max(0.01, raw_loss * 0.01)
    chosen = best if raw_loss - methods[best]["cv"]["log_loss"] >= margin else "raw"
    return {"labeled": len(pairs), "signal": signal, "folds": holdout.FOLDS, "fold_of": folds,
            "invalid": report["invalid"], "methods": methods, "recommendation": chosen, "margin": margin}
