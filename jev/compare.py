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

The cascade asks one variant first and escalates to the other only when the first one's gating
signal falls below a threshold. Both variants already answered every scored row, so its accuracy,
cost, and latency at each threshold are read from those answers, again without calls.

Agreement counts, for every question both variants ask, how often their answers differ, with or
without labels. When B asks a Choice question with A's instructions and options, listed in another
order, every changed answer is an effect of the order alone. It also counts the changed answers that
kept the same position in the list. With two options every changed answer does, so the count says
something only for three or more. Likewise, when B asks exactly A's request of the same model and only
the rows differ, rewritten by a perturbation (jev/perturb.py), every changed answer is an effect of that
rewrite alone: an input check.
"""

from __future__ import annotations

import json
from math import comb
from math import isfinite
from typing import Any, Dict, List, Optional, Tuple

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
    keys = ("labeled", "unlabeled", "invalid", "correct", "accuracy", "accuracy_low", "accuracy_high", "ece", "sweep", "targets")
    return {k: report[k] for k in keys}


def _verdict(a: Optional[dict], b: Optional[dict]) -> Optional[str]:
    if a is None or b is None:
        return None
    if a["correct"] and b["correct"]:
        return "both_right"
    if a["correct"]:
        return "a_only"
    return "b_only" if b["correct"] else "both_wrong"


def _usage(meta: Any) -> Optional[Tuple[float, float]]:
    """(cost in USD, latency in ms) from one call's meta, or None when either is missing or malformed."""
    if not isinstance(meta, dict):
        return None
    out = []
    for key in ("cost_usd", "latency_ms"):
        value = meta.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value < 0:
            return None
        out.append(float(value))
    return out[0], out[1]


def cascade(scored: List[Dict[str, dict]], usage: Dict[str, list], first: int) -> Optional[dict]:
    """Ask variant `first` on every row and keep its answer when its signal clears the threshold; otherwise
    ask the other variant and use that answer. Scored on the labeled rows both variants scored.

    Cost and latency count the first call on every row and the second call on each escalated row, as a
    cascade would pay them. They are None when any of those rows lacks usage."""
    second = 1 - first
    rows = []
    for key, f in scored[first].items():
        s = scored[second].get(key)
        if s is not None:
            u = usage.get(key) or [None, None]
            rows.append((f, s, u[first], u[second]))
    if not rows:
        return None
    n = len(rows)
    known = all(uf is not None and us is not None for _, _, uf, us in rows)

    def alone(v: int) -> dict:
        correct = sum(1 for r in rows if r[v]["correct"])
        spent = [r[2 + v] for r in rows]
        return {"correct": correct, "accuracy": correct / n,
                "cost_usd": sum(u[0] for u in spent) if known else None,
                "latency_ms": sum(u[1] for u in spent) / n if known else None}

    points = []
    for i in range(calibrate.STEPS + 1):
        t = i / calibrate.STEPS
        escalated = correct = 0
        cost = latency = 0.0
        for f, s, uf, us in rows:
            keep = f["signal"] + calibrate._EPS >= t  # the same gate as Calibrate's sweep
            escalated += not keep
            correct += f["correct"] if keep else s["correct"]
            if known:
                cost += uf[0] + (0 if keep else us[0])
                latency += uf[1] + (0 if keep else us[1])
        points.append({"threshold": round(t, 2), "escalated": escalated, "share": escalated / n,
                       "correct": correct, "accuracy": correct / n,
                       "cost_usd": cost if known else None, "latency_ms": latency / n if known else None})
    target = alone(1)["accuracy"]
    # Thresholds rise with the escalated share, so the first point to reach a level is the cheapest.
    match = next((p for p in points if p["accuracy"] + calibrate._EPS >= target), None)
    best = max(points, key=lambda p: (p["accuracy"], -p["escalated"]))
    return {"first": NAMES[first], "second": NAMES[second], "rows": n,
            "first_alone": alone(0), "second_alone": alone(1),
            "sweep": points, "match": match, "best": best}


def evaluate(rows: Any, signal: str = "confidence", first: str = "A", bound: str = "estimate") -> dict:
    """rows: [{"index": int, "label": ..., "answers": [A's answer or None, B's answer or None],
    "meta": optional [A's call meta, B's call meta]}] for one question. `first` is the variant a cascade asks first.
    `bound` is what must reach each target accuracy, as in calibrate.evaluate."""
    if signal not in calibrate.SIGNALS:
        raise CalibrationError("signal must be one of %s" % ", ".join(calibrate.SIGNALS))
    calibrate.check_bound(bound)
    if first not in NAMES:
        raise CalibrationError("first must be one of %s" % ", ".join(NAMES))
    lead = NAMES.index(first)
    if not isinstance(rows, list):
        raise CalibrationError("rows must be a list")
    if len(rows) > calibrate.MAX_ROWS:
        raise CalibrationError("At most %d rows" % calibrate.MAX_ROWS)
    types: List[Optional[str]] = [None, None]
    pairs: List[tuple] = []
    only = [0, 0]  # rows answered by one variant alone: a failed or skipped call on the other side
    usage: Dict[str, list] = {}
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
            meta = row.get("meta")
            usage[str(row.get("index"))] = [_usage(m) for m in meta] if isinstance(meta, list) and len(meta) == 2 else [None, None]
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

    first = [calibrate.evaluate(scorable(v, set()), signal, bound) for v in (0, 1)]
    dropped = {str(x["index"]) for rep in first for x in rep["invalid"]}
    reports = [calibrate.evaluate(scorable(v, dropped), signal, bound) for v in (0, 1)] if dropped else first
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
        "type": types[0], "signal": signal, "bound": bound,
        "variants": [_summary(rep) for rep in reports],
        "paired": dict(counts, rows=sum(counts.values()), p_value=mcnemar(counts["a_only"], counts["b_only"])),
        "answered_both": agree + len(disagreements), "agree": agree,
        "only_a": only[0], "only_b": only[1], "excluded": len(dropped),
        "disagreements": disagreements,
        "cascade": cascade(scored, usage, lead),
    }


def reordered(qa: Any, qb: Any) -> bool:
    """True when B's Choice question is A's, with the same instructions and options, listed in another order."""
    if not (isinstance(qa, dict) and isinstance(qb, dict)) or qa.get("type") != "choice" or qb.get("type") != "choice":
        return False
    ca, cb = qa.get("criteria"), qb.get("criteria")
    return (isinstance(ca, dict) and isinstance(cb, dict) and ca == cb and list(ca) != list(cb)
            and qa.get("instructions") == qb.get("instructions"))


def agreement(results: List[dict], questions: List[Dict[str, dict]], same_model: bool = True,
              perturbs: Optional[List[Optional[str]]] = None, averaged: Optional[List[bool]] = None) -> List[dict]:
    """For each question id both variants ask with the same type, in A's order: how many rows both
    answered and how many of those got a different answer from each, with a 95% interval on the share.

    results: workbench.run_compare's rows, each with "runs" [A's outcome, B's outcome]. Labels are not used.
    A question counts as reordered only when nothing else in the request changed: both variants ask the
    same model (same_model) and the same questions in the same order, differing only in the order of
    Choice options. Every question goes out in one call, so rewording another question could change an
    answer too. For a reordered Choice question, "same_position" counts the changed answers that picked the option
    at the same place in each variant's list.

    perturbs: each variant's perturbation of its rows, or None. When they differ, the rows differ, so
    no question counts as reordered. When they differ and the request is otherwise identical, down to the
    order of every question and option, each question is marked "perturbed": an input check. It counts
    only rows the perturbation changed (a run with "input"); the rest were plain repeats.

    averaged: whether each variant averages over both option orders (jev/orders.py). When only one does,
    its answers come from two calls, so neither the order nor the rows alone explain a change."""
    qa, qb = questions
    same_rows = len(set(perturbs or [None])) == 1
    same_asking = len(set(averaged or [False])) == 1
    # Dict equality ignores key order, so this holds when the sets differ only in how options are listed.
    order_only = same_asking and same_rows and same_model and list(qa) == list(qb) and qa == qb
    input_only = same_asking and not same_rows and same_model and json.dumps(qa) == json.dumps(qb)
    out = []
    for qid, q in qa.items():
        other = qb.get(qid)
        if not isinstance(other, dict) or other.get("type") != q.get("type"):
            continue
        moved = order_only and reordered(q, other)
        lists = (list(q["criteria"]), list(other["criteria"])) if moved else None
        answered = changed = same_position = 0
        for row in results:
            runs = row.get("runs") or []
            answers = [(r.get("answers") or {}).get(qid) if isinstance(r, dict) else None for r in runs]
            if len(answers) != 2 or not all(isinstance(a, dict) for a in answers):
                continue
            if input_only and not any(isinstance(r, dict) and "input" in r for r in runs):
                continue  # the rewrite left this row as it was
            try:
                picks = [calibrate.read(a)[0] for a in answers]
            except (KeyError, TypeError, ValueError, AttributeError):
                continue  # unreadable answers are listed by Compare's per-question report
            answered += 1
            if picks[0] == picks[1]:
                continue
            changed += 1
            if lists and all(p in names for p, names in zip(picks, lists)):
                same_position += lists[0].index(picks[0]) == lists[1].index(picks[1])
        low, high = calibrate.wilson(changed, answered)
        entry = {"qid": qid, "type": q.get("type"), "answered": answered, "changed": changed,
                 "rate": changed / answered if answered else None, "low": low, "high": high, "reordered": moved,
                 "perturbed": input_only}
        if moved:
            entry["same_position"] = same_position
            entry["options"] = len(lists[0])
        out.append(entry)
    return out
