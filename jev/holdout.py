"""Holdout: what a tuned threshold delivers on rows it was not tuned on.

Calibrate's shortcuts and Policy's Tune choose thresholds from the same labeled rows they report accuracy on, so
the accuracy they show favors thresholds that happen to fit those rows. This module estimates the accuracy the
tuning itself delivers on new rows, with k-fold cross-validation over answers Bulk already returned, so it makes
no model calls.

The labeled rows are split into `folds` parts. For each part, the same search Tune uses chooses thresholds from
the other parts alone, and those thresholds then route the held-out part. Every labeled row is routed exactly
once by thresholds that never saw it; pooled, those rows give the automated share and accuracy to expect. One
question is Calibrate's case: its tuned threshold is the lowest that reaches the target, as Calibrate picks it.

Folds are deterministic. Exact-input groups stay together; larger groups are assigned first to the
least populated fold, with input hashes breaking ties. Reordering rows or changing labels keeps the
split. Unequal group sizes can make folds unequal. At least one distinct input per fold is required.
The pooled 95% interval treats rows as independent; duplicates and cross-validation weaken that assumption.
With Policy's `rules`, rows a rule holds are dealt into folds like the rest and always go to review.
"""

from __future__ import annotations

import hashlib
from typing import Any, List, Optional, Tuple

from . import calibrate, cost, decisions, policy
from .calibrate import STEPS, TARGETS, CalibrationError

FOLDS = 5
MIN_FOLDS, MAX_FOLDS = 2, 10
MIN_PER_FOLD = 2  # fewer labeled rows than folds * this cannot hold anything meaningful out


def _key(item: dict) -> str:
    if item.get("row") is not None:
        return decisions._key(item["row"])
    key = item.get("key")
    return key if isinstance(key, str) and key else "#%s" % (item.get("index"),)


def assign(keys: List[str], indexes: List[Any], folds: int) -> List[int]:
    """Keep equal keys together, balancing row counts deterministically across folds."""
    groups = {}
    for i, key in enumerate(keys):
        groups.setdefault(key, []).append(i)
    order = sorted(groups, key=lambda k: (-len(groups[k]), hashlib.sha256(k.encode("utf-8")).hexdigest()))
    sizes = [0] * folds
    out = [0] * len(keys)
    for key in order:
        fold = min(range(folds), key=lambda f: (sizes[f], f))
        for i in groups[key]:
            out[i] = fold
        sizes[fold] += len(groups[key])
    return out


def problem(keys: List[str], folds: int) -> Optional[str]:
    """Why these rows cannot support the requested grouped cross-validation."""
    if len(keys) < folds * MIN_PER_FOLD:
        return "Needs at least %d valid labeled rows to hold some out (%d labeled)." % (folds * MIN_PER_FOLD, len(keys))
    if len(set(keys)) < folds:
        return ("Needs at least %d distinct labeled inputs for %d folds (%d distinct). "
                "Exact duplicate inputs must stay together; label more distinct inputs."
                % (folds, folds, len(set(keys))))
    return None


def _folds(folds: Any) -> int:
    if isinstance(folds, bool) or not isinstance(folds, int) or not MIN_FOLDS <= folds <= MAX_FOLDS:
        raise CalibrationError("folds must be a whole number from %d to %d" % (MIN_FOLDS, MAX_FOLDS))
    return folds


def _measure(right: List[bool], auto: List[int], n: int) -> dict:
    good = sum(right[i] for i in auto)
    low, high = calibrate.wilson(good, len(auto))
    return {"automated": len(auto), "correct": good, "coverage": len(auto) / n if n else 0.0,
            "accuracy": good / len(auto) if auto else None, "low": low, "high": high}


def evaluate(rows: Any, qids: Any, signal: str = "confidence", bound: str = "estimate", folds: Any = FOLDS,
             costs: Any = None, rules: Any = None, targets: Tuple[float, ...] = TARGETS) -> dict:
    """rows: Policy's rows, each optionally with "key", a string naming its input. For each target accuracy:
    the thresholds tuned on every labeled row and what they automate there, and what thresholds tuned without a
    row automate when they route it, pooled over the folds. targets: the accuracies to tune for, TARGETS unless
    given. With `costs` (as jev/cost.py takes them), the same for the cheapest thresholds, under "cost"."""
    calibrate.check_bound(bound)
    folds = _folds(folds)
    prices = cost.parse(costs) if costs is not None else None
    if isinstance(rows, list):
        rows = [dict(row, key=_key(row)) if isinstance(row, dict) else row for row in rows]
    qids, data, levels, right = policy.prepared(rows, qids, signal, rules)
    scored = data["scored"]
    everyone = scored + data["held"]  # rows a rule holds fill out their folds, always reviewed
    n = len(everyone)
    base = {"signal": signal, "bound": bound, "folds": folds, "questions": qids, "labeled": n,
            "minimum": folds * MIN_PER_FOLD, "targets": []}
    keys = [_key(item) for item in everyone]
    base.update(unique_inputs=len(set(keys)), problem=problem(keys, folds))
    if base["problem"]:
        return base
    fold_all = assign(keys, [item["index"] for item in everyone], folds)
    fold_of = fold_all[:len(scored)]
    members = [[i for i in range(len(scored)) if fold_of[i] == f] for f in range(folds)]
    sizes = [fold_all.count(f) for f in range(folds)]
    # Thresholds tuned on every row, then on each fold's complement: one search per fold covers every target.
    whole = policy.search(levels, right, bound, targets)
    per_fold = []
    for f in range(folds):
        train = [i for i in range(len(scored)) if fold_of[i] != f]
        per_fold.append(policy.search([levels[i] for i in train], [right[i] for i in train], bound, targets))

    def gates(steps: Optional[List[int]]) -> Optional[dict]:
        return None if steps is None else {q: steps[j] / STEPS for j, q in enumerate(qids)}

    for t, target in enumerate(targets):
        seen = whole[t]
        unseen: List[int] = []
        parts = []
        for f in range(folds):
            steps = per_fold[f][t]
            auto = [] if steps is None else [i for i in members[f] if all(v >= s for v, s in zip(levels[i], steps))]
            unseen.extend(auto)
            parts.append(dict(_measure(right, auto, sizes[f]), rows=sizes[f], gates=gates(steps)))
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
    if prices is not None:
        priced = cost.row_costs(scored, qids, prices)
        base["cost"] = dict(cost.holdout(levels, right, priced, prices["review"], qids, members, sizes),
                            review_cost=prices["review"], error=prices["error"])
    return base
