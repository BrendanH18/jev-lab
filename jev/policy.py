"""Policy: gate several questions at once, the way an application acts on one item.

Calibrate chooses a threshold for one question. An application usually acts on an item only when
every answer it depends on is confident: route a ticket automatically when the department is clear
AND the refund intent is clear, otherwise send it to a person. This module scores such a policy over
answers Bulk already returned, so it makes no model calls.

A row is automated when each gated question's signal clears its threshold, and it is right when
every gated answer matches its label, scored per type as Calibrate scores it. Only rows labeled for
every gated question are scored; the rest are still routed and counted.

tune() searches for thresholds that automate the most labeled rows at a target accuracy. It raises
whichever threshold removes the largest share of wrong rows per row removed until the target holds,
then lowers each threshold again as far as the target allows. Finally it re-chooses two thresholds at a
time, exactly, while that automates more rows. For one or two questions the result is the best on the 0.01
grid; for more it is a local search, not a proof that no better combination exists. With bound="lower" a
target counts as met only when the automated rows' 95% Wilson lower bound reaches it, so a few automated
rows cannot claim a high accuracy.
"""

from __future__ import annotations

from math import isfinite
from typing import Any, Dict, List, Optional, Tuple

from . import calibrate
from .calibrate import STEPS, TARGETS, CalibrationError

MAX_GATES = 10
EPS = calibrate._EPS  # the same tie rule as Calibrate: a signal equal to the threshold clears it
TYPES = ("choice", "noul", "score")


def _rows(rows: Any) -> List[dict]:
    if not isinstance(rows, list):
        raise CalibrationError("rows must be a list")
    if len(rows) > calibrate.MAX_ROWS:
        raise CalibrationError("At most %d rows" % calibrate.MAX_ROWS)
    return [r for r in rows if isinstance(r, dict) and isinstance(r.get("answers"), dict)]


def _qids(qids: Any) -> List[str]:
    if not isinstance(qids, list) or not qids or not all(isinstance(q, str) and q for q in qids):
        raise CalibrationError("Choose at least one question to gate")
    if len(set(qids)) != len(qids):
        raise CalibrationError("Each question can be gated once")
    if len(qids) > MAX_GATES:
        raise CalibrationError("At most %d gated questions" % MAX_GATES)
    return qids


def _gates(gates: Any) -> Dict[str, float]:
    if not isinstance(gates, dict):
        raise CalibrationError("gates must be an object of question id to threshold")
    _qids(list(gates))
    out = {}
    for qid, t in gates.items():
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not isfinite(t) or not 0 <= t <= 1:
            raise CalibrationError("Threshold for %r must be a number from 0 to 1" % qid)
        out[qid] = float(t)
    return out


def _types(rows: List[dict], qids: List[str]) -> Dict[str, str]:
    """Each gated question's answer type, from the rows that answered it."""
    types: Dict[str, str] = {}
    for row in rows:
        for qid in qids:
            answer = row["answers"].get(qid)
            if not isinstance(answer, dict):
                continue
            qtype = answer.get("type")
            if qtype not in TYPES:
                raise CalibrationError("Policy gates Choice, Noul, and Score answers; %r is not one" % qid)
            if types.setdefault(qid, qtype) != qtype:
                raise CalibrationError("Answers to %r come from different question types" % qid)
    missing = [q for q in qids if q not in types]
    if missing:
        raise CalibrationError("No answers for %s. Run Bulk with these questions first." % ", ".join(missing))
    return types


def _prepare(rows: List[dict], qids: List[str], signal: str) -> dict:
    """Read every row once: its gating signals, and for rows labeled on every gated question, which answers are right."""
    if signal not in calibrate.SIGNALS:
        raise CalibrationError("signal must be one of %s" % ", ".join(calibrate.SIGNALS))
    types = _types(rows, qids)
    routed, scored, invalid = [], [], []
    unlabeled = skipped = 0
    for row in rows:
        index = row.get("index")
        labels = row.get("labels") if isinstance(row.get("labels"), dict) else {}
        signals: Dict[str, float] = {}
        right: Dict[str, bool] = {}
        shown: Dict[str, Tuple[str, Optional[str]]] = {}
        reason = None
        for qid in qids:
            answer = row["answers"].get(qid)
            try:
                predicted, gate, _ = calibrate._read(types[qid], answer, signal)
            except (KeyError, TypeError, ValueError, AttributeError):
                break  # no readable answer: this row cannot be routed
            signals[qid] = gate
            raw = labels.get(qid)
            if raw in (None, "") or reason:
                shown[qid] = (calibrate._show(types[qid], predicted), None)
                continue
            try:
                label = calibrate._label(types[qid], raw, answer)
            except (KeyError, TypeError, ValueError, AttributeError) as err:
                reason = "%s: %s" % (qid, str(err).strip("'\""))
                continue
            right[qid] = label == predicted
            shown[qid] = (calibrate._show(types[qid], predicted), calibrate._show(types[qid], label))
        if len(signals) < len(qids):
            skipped += 1
            continue
        item = {"index": index, "signals": signals}
        routed.append(item)
        if reason:
            invalid.append({"index": index, "reason": reason})
        elif len(right) < len(qids):
            unlabeled += 1
        else:
            item.update(right=right, shown=shown)
            scored.append(item)
    return {"types": types, "routed": routed, "scored": scored, "invalid": invalid,
            "unlabeled": unlabeled, "skipped": skipped}


def _clears(item: dict, gates: Dict[str, float]) -> bool:
    return all(item["signals"][q] + EPS >= t for q, t in gates.items())


def evaluate(rows: Any, gates: Any, signal: str = "confidence") -> dict:
    """rows: [{"index": int, "answers": {qid: answer}, "labels": {qid: label}}]. gates: {qid: threshold}."""
    gates = _gates(gates)
    qids = list(gates)
    data = _prepare(_rows(rows), qids, signal)
    scored = data["scored"]
    per = {q: {"qid": q, "type": data["types"][q], "threshold": gates[q], "correct": 0,
               "holds": 0, "only": 0, "wrong_automated": 0} for q in qids}
    out_rows = []
    automated = correct = all_right = 0
    for item in scored:
        held = [q for q in qids if item["signals"][q] + EPS < gates[q]]
        wrong = [q for q in qids if not item["right"][q]]
        auto = not held
        ok = not wrong
        all_right += ok
        for q in qids:
            per[q]["correct"] += item["right"][q]
        for q in held:
            per[q]["holds"] += 1
        if len(held) == 1:
            per[held[0]]["only"] += 1
        if auto:
            automated += 1
            correct += ok
            for q in wrong:
                per[q]["wrong_automated"] += 1
        out_rows.append({"index": item["index"], "automated": auto, "correct": ok, "held": held, "wrong": wrong,
                         "answers": {q: {"answer": item["shown"][q][0], "label": item["shown"][q][1],
                                         "signal": item["signals"][q]} for q in qids}})
    n = len(scored)
    low, high = calibrate.wilson(correct, automated)
    for p in per.values():
        p["accuracy"] = p["correct"] / n if n else None
    routed_auto = sum(1 for item in data["routed"] if _clears(item, gates))
    return {
        "signal": signal, "gates": gates, "questions": [per[q] for q in qids],
        "labeled": n, "unlabeled": data["unlabeled"], "invalid": data["invalid"], "skipped": data["skipped"],
        "accuracy_all": all_right / n if n else None,
        "automated": automated, "correct": correct, "review": n - automated,
        "coverage": automated / n if n else 0.0, "accuracy": correct / automated if automated else None,
        "accuracy_low": low, "accuracy_high": high,
        "routed": len(data["routed"]), "routed_automated": routed_auto,
        "rows": out_rows,
    }


def _level(signal: float) -> int:
    """The highest grid step this signal clears: threshold i / STEPS admits it when signal + EPS >= i / STEPS."""
    return min(STEPS, int((signal + EPS) * STEPS))


def _greedy(levels: List[List[int]], right: List[bool], k: int) -> List[Tuple[List[int], int, int]]:
    """Raise thresholds one move at a time. Each move picks, over every question and every higher step, the
    one that drops the largest share of wrong rows per row dropped. Returns each state: (steps, automated, correct)."""
    steps = [0] * k
    alive = list(range(len(levels)))
    path = [(steps[:], len(alive), sum(right[i] for i in alive))]
    while alive:
        best = None  # (share wrong, wrong dropped, -step, -question) -> larger is better
        for q in range(k):
            wrong = [0] * (STEPS + 1)
            total = [0] * (STEPS + 1)
            for i in alive:
                total[levels[i][q]] += 1
                wrong[levels[i][q]] += not right[i]
            dropped = dropped_wrong = 0
            for s in range(steps[q] + 1, STEPS + 1):
                if not total[s - 1]:
                    continue
                dropped += total[s - 1]
                dropped_wrong += wrong[s - 1]
                key = (dropped_wrong / dropped, dropped_wrong, -s, -q)
                if best is None or key > best[0]:
                    best = (key, q, s)
        if best is None:
            break  # every remaining row sits at the top step of every question; nothing more can be dropped
        _, q, s = best
        steps[q] = s
        alive = [i for i in alive if levels[i][q] >= s]
        path.append((steps[:], len(alive), sum(right[i] for i in alive)))
    return path


def _relax(levels: List[List[int]], right: List[bool], steps: List[int], target: float, bound: str) -> List[int]:
    """Lower each threshold as far as the target allows, given the others, until no threshold moves."""
    steps = steps[:]
    k = len(steps)
    columns = [[lv[q] for lv in levels] for q in range(k)]
    moved = True
    while moved:
        moved = False
        for q in range(k):
            others = [True] * len(levels)  # rows every other gate admits
            for o in range(k):
                if o != q and steps[o]:
                    others = [ok and lv >= steps[o] for ok, lv in zip(others, columns[o])]
            total = [0] * (STEPS + 1)
            hits = [0] * (STEPS + 1)
            for ok, lv, hit in zip(others, columns[q], right):
                if ok:
                    total[lv] += 1
                    hits[lv] += hit
            auto = sum(total[steps[q]:])
            good = sum(hits[steps[q]:])
            best = steps[q]
            for s in range(steps[q] - 1, -1, -1):
                auto += total[s]
                good += hits[s]
                if calibrate.meets(good, auto, target, bound):
                    best = s
            if best < steps[q]:
                steps[q] = best
                moved = True
    return steps


def _pairs(levels: List[List[int]], right: List[bool], steps: List[int], target: float, bound: str) -> Optional[List[int]]:
    """Re-choose two thresholds at a time, exactly, with the others held, and keep any change that automates more
    rows at the target. Repeat until no pair improves. `steps` need not reach the target; None if nothing does.

    Relaxing lowers one threshold at a time, so it cannot reach a better state that needs one threshold higher
    and another lower. For one or two questions this search is exhaustive over the 0.01 grid."""
    k = len(steps)
    n = len(levels)

    def held(skip: Tuple[int, ...], current: List[int]) -> List[int]:
        return [i for i in range(n) if all(levels[i][o] >= current[o] for o in range(k) if o not in skip)]

    def scan(total: List[int], hits: List[int]) -> Tuple[int, int]:
        """(rows automated, step) at the lowest step on this histogram that reaches the target, or (0, -1)."""
        best = (0, -1)
        auto = good = 0
        for s in range(STEPS, -1, -1):
            auto += total[s]
            good += hits[s]
            if calibrate.meets(good, auto, target, bound):
                best = (auto, s)
        return best

    current = steps[:]
    alive = held((), current)
    best_n = len(alive) if calibrate.meets(sum(right[i] for i in alive), len(alive), target, bound) else 0
    best = current[:] if best_n else None
    improved = True
    while improved:
        improved = False
        for q in range(k):
            for r in range(q, k):
                rows = held((q, r), current)
                if r == q:  # one question: every threshold, the others held
                    total, hits = [0] * (STEPS + 1), [0] * (STEPS + 1)
                    for i in rows:
                        total[levels[i][q]] += 1
                        hits[levels[i][q]] += right[i]
                    count, s = scan(total, hits)
                    if count > best_n:
                        current[q] = s
                        best_n, best, improved = count, current[:], True
                    continue
                # Two questions: lower q's threshold one step at a time, adding its rows to r's histogram.
                by_q: List[List[int]] = [[] for _ in range(STEPS + 1)]
                for i in rows:
                    by_q[levels[i][q]].append(i)
                total, hits = [0] * (STEPS + 1), [0] * (STEPS + 1)
                found = None
                for sq in range(STEPS, -1, -1):
                    for i in by_q[sq]:
                        total[levels[i][r]] += 1
                        hits[levels[i][r]] += right[i]
                    count, sr = scan(total, hits)
                    if count > best_n:
                        best_n, found = count, (sq, sr)
                if found:
                    current[q], current[r] = found
                    best, improved = current[:], True
            if improved:
                break
        if best is not None:
            current = best[:]
    return best


def tune(rows: Any, qids: Any, signal: str = "confidence", bound: str = "estimate") -> dict:
    """For each target accuracy, thresholds on `qids` that automate the most labeled rows the search finds.
    bound: what must reach the target, the automated rows' measured accuracy or its 95% lower bound."""
    calibrate.check_bound(bound)
    qids = _qids(qids)
    data = _prepare(_rows(rows), qids, signal)
    scored = data["scored"]
    levels = [[_level(item["signals"][q]) for q in qids] for item in scored]
    right = [all(item["right"].values()) for item in scored]
    path = _greedy(levels, right, len(qids)) if scored else []
    out = []
    for target in TARGETS:
        # Relax every state on the path that reaches the target, not only the first: a later move can drop the
        # rows an earlier one was raised for, and relaxing then gives the earlier threshold back.
        best = None
        for steps, auto, good in path:
            if not calibrate.meets(good, auto, target, bound):
                continue
            steps = _relax(levels, right, steps, target, bound)
            auto = [i for i, lv in enumerate(levels) if all(lv[q] >= steps[q] for q in range(len(qids)))]
            if best is None or len(auto) > len(best[1]):
                best = (steps, auto)
        # The greedy path can jump past the region a target needs, especially a lower-bound target, which needs
        # many rows. Re-choosing pairs of thresholds exactly recovers it, starting from the best found.
        steps = _pairs(levels, right, best[0] if best else [0] * len(qids), target, bound) if scored else None
        if steps is not None:
            best = (steps, [i for i, lv in enumerate(levels) if all(lv[q] >= steps[q] for q in range(len(qids)))])
        if best is None:
            out.append({"target": target, "gates": None, "automated": 0, "coverage": 0.0, "accuracy": None,
                        "low": None, "high": None, "needed": calibrate.rows_needed(target)})
            continue
        steps, auto = best
        good = sum(right[i] for i in auto)
        low, high = calibrate.wilson(good, len(auto))
        out.append({"target": target, "gates": {q: steps[j] / STEPS for j, q in enumerate(qids)},
                    "automated": len(auto), "coverage": len(auto) / len(scored), "accuracy": good / len(auto),
                    "low": low, "high": high, "needed": calibrate.rows_needed(target)})
    return {"signal": signal, "bound": bound, "labeled": len(scored), "targets": out}
