"""Cost: choose thresholds by what a mistake costs, not by an accuracy target.

Calibrate's shortcuts and Policy's Tune choose thresholds that reach 90%, 95%, or 99% accuracy. An application
usually weighs two prices instead: a person reviewing an item, and the code acting on a wrong answer. A gate that
automates more rows saves reviews and risks mistakes; the threshold worth using is the one with the lowest total.
This module prices each labeled row over answers Bulk already returned, so it makes no model calls.

Every labeled row costs `review` when the gate sends it to a person. An automated row costs nothing when every gated
answer is right, and its mistake's price when one is wrong: `error` by default, or the price set for that question,
label, and answer in `mistakes` (billing mislabeled as shipping may cost more than the reverse). A row with several
wrong answers costs its most expensive mistake. Automating a row pays when it is right more often than
1 - review / error, the break-even accuracy.

The search maximizes the reviews saved minus the mistakes made over the automated rows, on Calibrate's 0.01 grid. It
re-chooses one or two thresholds at a time, exactly, while that lowers the cost, so for one or two gated questions
it finds the cheapest thresholds; for more it is a local search. Ties go to automating more rows, then to lower
thresholds. When every threshold costs more than reviewing every row, the result is to review every row.
"""

from __future__ import annotations

from math import isfinite
from typing import Any, List, Optional, Tuple

from . import calibrate, policy
from .calibrate import STEPS, CalibrationError

MAX_COST = 1_000_000
MAX_MISTAKES = 100
PER = 1000  # costs are reported per this many rows
_ROUND = 9  # float sums of prices compare equal after rounding to this many places


def _price(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or not 0 <= value <= MAX_COST:
        raise CalibrationError("%s must be a number from 0 to %s" % (what, "{:,}".format(MAX_COST)))
    return float(value)


def _text(value: Any, what: str) -> str:
    if not isinstance(value, str) or not value:
        raise CalibrationError("Each mistake needs a %s" % what)
    return value


def parse(costs: Any) -> dict:
    """{"review": float, "error": float, "mistakes": {(question, label, answer): float}} from the request's costs."""
    if not isinstance(costs, dict):
        raise CalibrationError("costs must be an object with review and error prices")
    out = {"review": _price(costs.get("review"), "The review cost"),
           "error": _price(costs.get("error"), "The cost of a wrong automated answer"), "mistakes": {}}
    raw = costs.get("mistakes") or []
    if not isinstance(raw, list):
        raise CalibrationError("mistakes must be a list")
    if len(raw) > MAX_MISTAKES:
        raise CalibrationError("At most %d priced mistakes" % MAX_MISTAKES)
    for m in raw:
        if not isinstance(m, dict):
            raise CalibrationError("Each mistake must be an object with question, label, answer, and cost")
        key = (_text(m.get("question"), "question"), _text(m.get("label"), "label"), _text(m.get("answer"), "answer"))
        if key[1] == key[2]:
            raise CalibrationError("A mistake's answer must differ from its label")
        if key in out["mistakes"]:
            raise CalibrationError("%s: label %s answered %s is priced twice" % key)
        out["mistakes"][key] = _price(m.get("cost"), "A mistake's cost")
    return out


def break_even(review: float, error: float) -> Optional[float]:
    """The accuracy above which automating a row costs less than reviewing it, or None when mistakes are free."""
    return max(0.0, 1 - review / error) if error else None


def row_costs(scored: List[dict], qids: List[str], prices: dict) -> List[float]:
    """What automating each scored row costs: nothing when every gated answer is right, else its priciest mistake."""
    out = []
    for item in scored:
        wrong = [q for q in qids if not item["right"][q]]
        # shown[q] is (answer, label), both as Calibrate shows them: an option key, "yes"/"no", or a level number.
        out.append(max((prices["mistakes"].get((q, item["shown"][q][1], item["shown"][q][0]), prices["error"])
                        for q in wrong), default=0.0))
    return out


def _candidates(column: List[int]) -> List[int]:
    """The grid steps worth trying for one question: 0, and each step just above a row's level. Any other step
    admits the same rows as the next one below it, and ties go to the lower threshold."""
    return sorted({0} | {lv + 1 for lv in column if lv < STEPS})


def search(levels: List[List[int]], value: List[float]) -> Optional[List[int]]:
    """Grid steps that maximize the summed `value` of the rows they admit, or None when no rows are worth
    automating. value[i] is the review cost a row saves minus what automating it costs; levels as policy.search."""
    if not levels:
        return None
    n, k = len(levels), len(levels[0])
    columns = [[lv[q] for lv in levels] for q in range(k)]
    cands = [_candidates(col) for col in columns]
    # The index of each row's level among each question's candidates: candidate j admits the row when j <= pos.
    pos = [[sum(1 for c in cands[q] if c <= columns[q][i]) - 1 for q in range(k)] for i in range(n)]

    def key(steps: List[int]) -> Tuple[float, int, int]:
        auto = [i for i in range(n) if all(levels[i][q] >= steps[q] for q in range(k))]
        return (round(sum(value[i] for i in auto), _ROUND), len(auto), -sum(steps))

    right = [v >= 0 for v in value]
    starts = [[0] * k] + [steps for steps, _, _ in policy._greedy(levels, right, k)]
    current = max(starts, key=key)
    best = key(current)
    improved = True
    while improved:
        improved = False
        for q in range(k):
            for r in range(q, k):
                held = [i for i in range(n) if all(levels[i][o] >= current[o] for o in range(k) if o not in (q, r))]
                rest = sum(current) - current[q] - (current[r] if r != q else 0)
                if r == q:
                    m = len(cands[q])
                    val, cnt = [0.0] * m, [0] * m
                    for i in held:
                        val[pos[i][q]] += value[i]
                        cnt[pos[i][q]] += 1
                    acc_v, acc_c = 0.0, 0
                    found = None
                    for a in range(m - 1, -1, -1):
                        acc_v += val[a]
                        acc_c += cnt[a]
                        here = (round(acc_v, _ROUND), acc_c, -(rest + cands[q][a]))
                        if here > best and (found is None or here > found[0]):
                            found = (here, a)
                    if found:
                        current[q] = cands[q][found[1]]
                        best, improved = found[0], True
                    continue
                mq, mr = len(cands[q]), len(cands[r])
                val = [[0.0] * (mr + 1) for _ in range(mq + 1)]
                cnt = [[0] * (mr + 1) for _ in range(mq + 1)]
                for i in held:
                    val[pos[i][q]][pos[i][r]] += value[i]
                    cnt[pos[i][q]][pos[i][r]] += 1
                found = None
                # Suffix sums in place: cell (a, b) becomes the total over rows admitted by candidates a and b.
                for a in range(mq - 1, -1, -1):
                    for b in range(mr - 1, -1, -1):
                        val[a][b] += val[a + 1][b] + val[a][b + 1] - val[a + 1][b + 1]
                        cnt[a][b] += cnt[a + 1][b] + cnt[a][b + 1] - cnt[a + 1][b + 1]
                        here = (round(val[a][b], _ROUND), cnt[a][b], -(rest + cands[q][a] + cands[r][b]))
                        if here > best and (found is None or here > found[0]):
                            found = (here, a, b)
                if found:
                    current[q], current[r] = cands[q][found[1]], cands[r][found[2]]
                    best, improved = found[0], True
    # Reviewing every row saves nothing and costs nothing extra; it wins only when every gate loses money.
    if best[1] == 0 or best[0] < 0:
        return None
    return current


def measure(auto: List[int], right: List[bool], costs: List[float], review: float, n: int) -> dict:
    """What routing the labeled rows costs when `auto` (row indices) are automated and the rest are reviewed."""
    wrong = [i for i in auto if not right[i]]
    total = review * (n - len(auto)) + sum(costs[i] for i in auto)
    good = len(auto) - len(wrong)
    low, high = calibrate.wilson(good, len(auto))
    return {"automated": len(auto), "wrong": len(wrong), "review": n - len(auto),
            "coverage": len(auto) / n if n else 0.0, "accuracy": good / len(auto) if auto else None, "low": low, "high": high,
            "cost": total, "per_1000": total / n * PER if n else None}


def _gates(qids: List[str], steps: Optional[List[int]]) -> Optional[dict]:
    return None if steps is None else {q: steps[j] / STEPS for j, q in enumerate(qids)}


def prepared(rows: Any, qids: Any, signal: str, costs: Any) -> Tuple[List[str], dict, List[List[int]], List[bool], List[float], dict]:
    """policy.prepared, plus each scored row's price when automated and the parsed prices."""
    prices = parse(costs)
    qids, data, levels, right = policy.prepared(rows, qids, signal)
    return qids, data, levels, right, row_costs(data["scored"], qids, prices), prices


def evaluate(rows: Any, qids: Any, signal: str = "confidence", costs: Any = None, gates: Any = None,
             tune: bool = True) -> dict:
    """rows: Policy's rows. The cheapest thresholds on `qids` (unless `tune` is false: a slider moving needs only
    the current cost), what reviewing or automating every row costs, and, with `gates` ({qid: threshold} over the
    same questions), what those thresholds cost. With one question, the cost at every threshold on the grid."""
    qids, data, levels, right, priced, prices = prepared(rows, qids, signal, costs)
    if gates is not None:
        gates = policy._gates(gates)
        if set(gates) != set(qids):
            raise CalibrationError("gates must set a threshold for each of the questions")
    n = len(levels)
    review = prices["review"]
    applied = sorted({k for k in prices["mistakes"] if k[0] in qids})
    out = {"signal": signal, "questions": qids, "labeled": n, "unlabeled": data["unlabeled"], "invalid": data["invalid"],
           "skipped": data["skipped"], "review": review, "error": prices["error"],
           "mistakes": [{"question": q, "label": lab, "answer": ans, "cost": prices["mistakes"][(q, lab, ans)]}
                        for q, lab, ans in applied],
           "break_even": break_even(review, prices["error"]),
           "review_all": None, "automate_all": None, "best": None, "current": None, "sweep": None}
    if not n:
        return out
    every = list(range(n))
    out.update(review_all=measure([], right, priced, review, n), automate_all=measure(every, right, priced, review, n))
    if tune:
        steps = search(levels, [review - c for c in priced])
        best = measure(policy.admitted(levels, steps) if steps is not None else [], right, priced, review, n)
        out["best"] = dict(best, gates=_gates(qids, steps))
    if gates is not None:
        auto = [i for i, item in enumerate(data["scored"]) if policy._clears(item, gates)]
        out["current"] = dict(measure(auto, right, priced, review, n), gates=gates)
    if len(qids) == 1:
        sweep = []
        for s in range(STEPS + 1):
            m = measure([i for i in every if levels[i][0] >= s], right, priced, review, n)
            sweep.append({"threshold": round(s / STEPS, 2), "automated": m["automated"], "wrong": m["wrong"],
                          "cost": m["cost"], "per_1000": m["per_1000"]})
        out["sweep"] = sweep
    return out


def holdout(levels: List[List[int]], right: List[bool], priced: List[float], review: float, qids: List[str],
            members: List[List[int]]) -> dict:
    """Cross-validate the cheapest thresholds: for each fold, search on the other folds and route the fold with the
    result. members[f] lists fold f's row indices into levels."""
    n = len(levels)
    value = [review - c for c in priced]
    whole = search(levels, value)
    tuned = measure(policy.admitted(levels, whole) if whole is not None else [], right, priced, review, n)
    unseen: List[int] = []
    parts = []
    for f, held in enumerate(members):
        train = [i for g, rows in enumerate(members) if g != f for i in rows]
        steps = search([levels[i] for i in train], [value[i] for i in train])
        auto = [] if steps is None else [i for i in held if all(v >= s for v, s in zip(levels[i], steps))]
        unseen.extend(auto)
        part = measure(list(range(len(auto))), [right[i] for i in auto], [priced[i] for i in auto], review, len(held))
        parts.append(dict(part, rows=len(held), gates=_gates(qids, steps)))
    held_out = measure(unseen, right, priced, review, n)
    chosen = [p["gates"] for p in parts if p["gates"] is not None]
    spread = {q: [min(g[q] for g in chosen), max(g[q] for g in chosen)] for q in qids} if chosen else None
    return {"tuned": dict(tuned, gates=_gates(qids, whole)), "unseen": held_out,
            "gap": held_out["per_1000"] - tuned["per_1000"], "review_all": review * PER,
            "worse": held_out["per_1000"] > review * PER + calibrate._EPS,
            "review_folds": sum(1 for p in parts if p["gates"] is None), "spread": spread, "parts": parts}
