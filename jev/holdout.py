"""Holdout: what a tuned threshold delivers on rows it was not tuned on.

Calibrate's shortcuts and Policy's Tune choose thresholds from the same labeled rows they report accuracy on, so
the accuracy they show favors thresholds that happen to fit those rows. This module estimates the accuracy the
tuning itself delivers on new rows, with k-fold cross-validation over answers Bulk already returned, so it makes
no model calls.

The labeled rows are split into `folds` parts. For each part, the same search Tune uses chooses thresholds from
the other parts alone, and those thresholds then route the held-out part. Every labeled row is routed exactly
once by thresholds that never saw it; pooled, those rows give the automated share and accuracy to expect. One
question is Calibrate's case: its tuned threshold is the lowest that reaches the target, as Calibrate picks it.

Folds are deterministic. Labeled rows are ordered by a hash of their key (the row's input, so rerunning, reordering,
or changing a label's value keeps the split) and dealt round-robin, which keeps the parts within one row of the
same size. Identical
inputs share a key, and a tie between them is broken by row index, so the deal never depends on request order.
The pooled 95% interval treats the held-out rows as independent, which cross-validation only approximates.
"""

from __future__ import annotations

import hashlib
from typing import Any, List, Optional

from . import calibrate, policy
from .calibrate import STEPS, TARGETS, CalibrationError

FOLDS = 5
MIN_FOLDS, MAX_FOLDS = 2, 10
MIN_PER_FOLD = 2  # fewer labeled rows than folds * this cannot hold anything meaningful out


def _key(item: dict) -> str:
    key = item.get("key")
    return key if isinstance(key, str) and key else "#%s" % (item["index"],)


def assign(keys: List[str], indexes: List[Any], folds: int) -> List[int]:
    """The fold of each row: order by hash of key, then index, and deal round-robin."""
    digests = [hashlib.sha256(k.encode("utf-8")).hexdigest() for k in keys]
    order = sorted(range(len(keys)), key=lambda i: (digests[i], str(indexes[i])))
    out = [0] * len(keys)
    for position, i in enumerate(order):
        out[i] = position % folds
    return out


def _folds(folds: Any) -> int:
    if isinstance(folds, bool) or not isinstance(folds, int) or not MIN_FOLDS <= folds <= MAX_FOLDS:
        raise CalibrationError("folds must be a whole number from %d to %d" % (MIN_FOLDS, MAX_FOLDS))
    return folds


def _measure(right: List[bool], auto: List[int], n: int) -> dict:
    good = sum(right[i] for i in auto)
    low, high = calibrate.wilson(good, len(auto))
    return {"automated": len(auto), "correct": good, "coverage": len(auto) / n if n else 0.0,
            "accuracy": good / len(auto) if auto else None, "low": low, "high": high}


def evaluate(rows: Any, qids: Any, signal: str = "confidence", bound: str = "estimate", folds: Any = FOLDS) -> dict:
    """rows: Policy's rows, each optionally with "key", a string naming its input. For each target accuracy:
    the thresholds tuned on every labeled row and what they automate there, and what thresholds tuned without a
    row automate when they route it, pooled over the folds."""
    calibrate.check_bound(bound)
    folds = _folds(folds)
    qids, data, levels, right = policy.prepared(rows, qids, signal)
    n = len(levels)
    base = {"signal": signal, "bound": bound, "folds": folds, "questions": qids, "labeled": n,
            "minimum": folds * MIN_PER_FOLD, "targets": []}
    if n < folds * MIN_PER_FOLD:
        return base
    scored = data["scored"]
    fold_of = assign([_key(item) for item in scored], [item["index"] for item in scored], folds)
    members = [[i for i in range(n) if fold_of[i] == f] for f in range(folds)]
    # Thresholds tuned on every row, then on each fold's complement: one search per fold covers every target.
    whole = policy.search(levels, right, bound)
    per_fold = []
    for f in range(folds):
        train = [i for i in range(n) if fold_of[i] != f]
        per_fold.append(policy.search([levels[i] for i in train], [right[i] for i in train], bound))

    def gates(steps: Optional[List[int]]) -> Optional[dict]:
        return None if steps is None else {q: steps[j] / STEPS for j, q in enumerate(qids)}

    for t, target in enumerate(TARGETS):
        seen = whole[t]
        unseen: List[int] = []
        parts = []
        for f in range(folds):
            steps = per_fold[f][t]
            auto = [] if steps is None else [i for i in members[f] if all(v >= s for v, s in zip(levels[i], steps))]
            unseen.extend(auto)
            parts.append(dict(_measure(right, auto, len(members[f])), rows=len(members[f]), gates=gates(steps)))
        reached = [p["gates"] for p in parts if p["gates"] is not None]
        spread = {q: [min(g[q] for g in reached), max(g[q] for g in reached)] for q in qids} if reached else None
        tuned = _measure(right, policy.admitted(levels, seen), n) if seen is not None else None
        held = _measure(right, unseen, n)
        gap: Optional[float] = None
        if tuned and tuned["accuracy"] is not None and held["accuracy"] is not None:
            gap = tuned["accuracy"] - held["accuracy"]
        base["targets"].append({
            "target": target, "tuned": dict(tuned, gates=gates(seen)) if tuned else None, "unseen": held,
            "gap": gap, "below": held["accuracy"] is not None and held["accuracy"] + calibrate._EPS < target,
            "unreached": sum(1 for p in parts if p["gates"] is None), "spread": spread, "parts": parts,
            "needed": calibrate.rows_needed(target)})
    return base
