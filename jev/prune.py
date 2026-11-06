"""Prune: do the questions a Policy gate reads, and the questions a request asks, earn their place?

Policy gates several questions at once, and every question in a request lengthens it. This module asks, over answers
Bulk already returned, what each gated question buys at one target accuracy, so it makes no model calls:

  * off: the gate retuned with that question's threshold at 0. Its answer is still acted on and still scored, so a row
    whose answer to it is wrong still counts as wrong. When the gate automates as many rows this way, the question's
    threshold holds nothing back at the target and the application need not wait on it.
  * dropped: the gate retuned without the question at all, neither acted on nor scored. This is what the gate would do
    if the application stopped using that answer; rows that lacked only its label are now scored too.

It also lists the questions in the request that no gate and no rule reads, with each question's share of the
request's question text. If the application does not read those answers either, a request without them is shorter.

The baseline and every variant are tuned on the same rows by Policy's search (jev/policy.py), so each number is fit to
those rows: confirm a smaller gate on unseen rows, and a smaller request with a live Compare, since removing one
question from a request can shift the answers to the others.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from . import calibrate, policy, rules as rulebook, workbench
from .calibrate import STEPS, TARGETS, CalibrationError


def _target(target: Any) -> float:
    if isinstance(target, bool) or not isinstance(target, (int, float)):
        raise CalibrationError("target must be one of %s" % ", ".join("%g" % t for t in TARGETS))
    for t in TARGETS:
        if abs(float(target) - t) < 1e-9:
            return t
    raise CalibrationError("target must be one of %s" % ", ".join("%g" % t for t in TARGETS))


def _outcome(levels: List[List[int]], right: List[bool], labeled: int, qids: List[str], target: float, bound: str,
             fixed: Optional[Dict[str, float]] = None) -> dict:
    """The thresholds on `qids` (columns of `levels`) that automate the most rows at the target, as Policy's Tune
    finds them, with `fixed` thresholds added. `labeled` counts the rows a rule holds too."""
    steps = policy.search(levels, right, bound, (target,))[0] if levels else None
    if steps is None:
        return {"gates": None, "labeled": labeled, "automated": 0, "coverage": 0.0, "accuracy": None,
                "low": None, "high": None}
    auto = policy.admitted(levels, steps)
    good = sum(right[i] for i in auto)
    low, high = calibrate.wilson(good, len(auto))
    gates = {q: steps[j] / STEPS for j, q in enumerate(qids)}
    gates.update(fixed or {})
    return {"gates": gates, "labeled": labeled, "automated": len(auto),
            "coverage": len(auto) / labeled if labeled else 0.0,
            "accuracy": good / len(auto) if auto else None, "low": low, "high": high}


def _tuned(rows: List[dict], qids: List[str], signal: str, rules: Any, target: float, bound: str) -> dict:
    qids, data, levels, right = policy.prepared(rows, qids, signal, rules)
    return _outcome(levels, right, len(levels) + len(data["held"]), qids, target, bound)


def _chars(questions: Dict[str, dict]) -> Dict[str, int]:
    """Each question's length as JSON, with its id: its part of the request's question text."""
    return {q: len(json.dumps({q: questions[q]}, ensure_ascii=False)) for q in questions}


def prune(rows: Any, qids: Any, signal: str = "confidence", bound: str = "estimate", target: Any = 0.95,
          rules: Any = None, request: Any = None) -> dict:
    """rows and qids as policy.tune takes them; target: one of TARGETS; request: optional {qid: question}, the
    question set the rows were run with, for the unused questions and each question's share of the text."""
    calibrate.check_bound(bound)
    target = _target(target)
    rows = policy._rows(rows)
    qids, data, levels, right = policy.prepared(rows, qids, signal, rules)
    labeled = len(levels) + len(data["held"])
    types = data["types"]
    reads: Dict[str, List[str]] = {}
    for rule in rulebook.parse(rules):  # prepared() has already checked the rules against the answers
        for q in rulebook.questions(rule):
            reads.setdefault(q, []).append(rule["text"])
    asked = workbench.validate_questions(request) if request is not None else {}
    chars = _chars(asked)
    total = sum(chars.values()) if chars else 0

    def share(q: str) -> Optional[float]:
        return chars[q] / total if chars and q in chars else None

    gated = []
    for j, q in enumerate(qids):
        others = [o for o in qids if o != q]
        off = _outcome([lv[:j] + lv[j + 1:] for lv in levels], right, labeled, others, target, bound, {q: 0.0})
        if off["gates"]:
            off["gates"] = {o: off["gates"][o] for o in qids}  # in the gate's order, with this one at 0
        dropped = _tuned(rows, others, signal, rules, target, bound) if others else None
        gated.append({"qid": q, "type": types[q], "share": share(q), "rules": reads.get(q, []),
                      "off": off, "dropped": dropped})
    unused = [{"qid": q, "type": asked[q]["type"], "share": share(q)} for q in asked if q not in qids and q not in reads]
    return {"signal": signal, "bound": bound, "target": target, "labeled": labeled,
            "baseline": _outcome(levels, right, labeled, qids, target, bound),
            "gated": gated, "unused": unused, "chars": total if asked else None}
