"""Order averaging: ask a question set twice, the second time with each Choice question's options in
reverse order, and average the two answers in code.

Compare's order check (jev/compare.py agreement) shows whether an answer changes when only the order of
the options changes. This is a possible fix to measure against it: in a variant that averages over both
orders, the first and last options trade places, so a lean toward the first or the last place is split
between them. With three or more options the middle ones keep their place, so it is not a cure. It costs a second call per row. Compare scores the averaged variant like any other, so its report shows
whether the second call buys accuracy, calibration, or automation.

Only a Choice question whose options were reordered is averaged: its two probability lists are averaged
option by option, the top average is the answer, and the confidence is recomputed from the averages with
TypeSafe's Choice formula (calibrate._choice_formula). Every other question, Noul, Score, Box, or a Choice
question with one option, keeps the answer from the call that listed the options as written. A Score
scale keeps its order, since its levels mean low to high.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from . import calibrate


def averaged_ids(questions: Dict[str, dict]) -> List[str]:
    """The question ids an averaged variant reorders and averages: Choice questions with two or more options."""
    return [qid for qid, q in questions.items()
            if isinstance(q, dict) and q.get("type") == "choice" and isinstance(q.get("criteria"), dict) and len(q["criteria"]) > 1]


def reverse_options(questions: Dict[str, dict]) -> Optional[Dict[str, dict]]:
    """The questions with each Choice question's options in reverse order, everything else unchanged, or
    None when no Choice question has two or more options. Mirrors reverseOptions in static/js/variants.js;
    Python keeps whole-number option names in the order given, so those reverse too."""
    ids = set(averaged_ids(questions))
    if not ids:
        return None
    return {qid: dict(q, criteria=dict(reversed(list(q["criteria"].items())))) if qid in ids else q
            for qid, q in questions.items()}


def _choice(answer: Any, options: List[str]) -> Optional[Dict[str, float]]:
    """The answer's probability for each option, or None when it is not a readable answer to them."""
    if not isinstance(answer, dict) or answer.get("type") != "choice":
        return None
    try:
        probs = calibrate._probs(answer)
    except (TypeError, ValueError):
        return None
    if sorted(probs) != sorted(options) or answer.get("choice") not in probs:
        return None
    return probs


def average(first: Dict[str, Any], second: Dict[str, Any], questions: Dict[str, dict]) -> Tuple[Dict[str, Any], Dict[str, list]]:
    """(averaged answers, {qid: [first order's pick, reversed order's pick]}).

    first answered `questions`; second answered reverse_options(questions). A question whose answers
    cannot be read in either order is left out, so Compare does not score it on that row rather than
    score a single order as if it were the average."""
    out = dict(first)
    picks = {}
    for qid in averaged_ids(questions):
        options = list(questions[qid]["criteria"])
        a, b = _choice(first.get(qid), options), _choice(second.get(qid), options)
        if a is None or b is None:
            out.pop(qid, None)
            continue
        probs = {k: (a[k] + b[k]) / 2 for k in options}
        best = max(options, key=lambda k: probs[k])  # a tie goes to the option listed first as written
        out[qid] = dict(first[qid], choice=best, probabilities=probs, confidence=calibrate._choice_formula(probs))
        picks[qid] = [first[qid]["choice"], second[qid]["choice"]]
    return out, picks


def combine_meta(metas: List[dict]) -> dict:
    """One meta for the two calls: tokens and cost add up; latency is the slower call's, as an application
    that sends both at once would wait for it."""
    out = dict(metas[0])
    for key in ("input_tokens", "output_tokens", "cost_usd"):
        out[key] = sum(m.get(key) or 0 for m in metas)
    out["latency_ms"] = max(m.get("latency_ms") or 0 for m in metas)
    out["calls"] = len(metas)
    return out


def disagreement(runs: List[Any], questions: Dict[str, dict]) -> List[dict]:
    """For each averaged question: on how many rows both orders answered, and on how many the two orders
    picked different options, with a 95% interval. An order check inside the variant, from the same calls."""
    out = []
    for qid in averaged_ids(questions):
        pairs = [run["orders"][qid] for run in runs if isinstance(run, dict) and qid in (run.get("orders") or {})]
        changed = sum(1 for a, b in pairs if a != b)
        low, high = calibrate.wilson(changed, len(pairs))
        out.append({"qid": qid, "answered": len(pairs), "changed": changed,
                    "rate": changed / len(pairs) if pairs else None, "low": low, "high": high})
    return out
