"""Drift: do new, unlabeled rows still look like the dataset a check's gate was tuned on?

A check (jev/checks.py) says how a gate did on the rows it was tuned on. Its accuracy says nothing about rows
unlike them: the 95% intervals assume the labeled rows are a random sample of the items the gate will see. When
the traffic changes, a new product, a new channel, a campaign, the gate can quietly automate fewer rows, or
rows of a kind nobody labeled. This module compares one live run of the dataset's rows with one live run of new
rows, both asked the same questions by the same model, without needing a label on the new rows:

  * the share of rows the gate automates, with Fisher's exact test;
  * for each Choice, Noul, and Score question, the mix of answers (a chi-square test of homogeneity, or Fisher's
    exact test when the rows are too few for chi-square) and the gating signal (a Mann-Whitney U test);
  * an estimated accuracy on the new automated rows. Each borrows the accuracy of the labeled, automated dataset
    rows like it: the same gated answers and the same confidence band when at least MIN_STRATUM such rows exist,
    the same gated answers when that many do, and every labeled automated row otherwise. Its 95% interval resamples
    the new rows and draws each borrowed accuracy from its Beta posterior. The estimate assumes a row's chance of being right depends on its answers and its
    confidence the same way on both sets of rows; rows of a kind the labels never covered can break that, so
    it is a reason to label new rows, not a substitute.

Every test's p-value is adjusted for the number of tests in the report (Holm's method), and a test counts as a
shift when its adjusted p-value is below ALPHA. Both sides are fresh runs a person started, as the no-replay rule
asks: answers from an earlier run are never compared against. The arithmetic below makes no model calls; run()
makes the two runs.
"""

from __future__ import annotations

import random
import statistics
from itertools import combinations
from math import comb, erfc, exp, lgamma, pi, sqrt
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import calibrate, checks, policy, workbench
from .client import JevClient
from .workbench import WorkbenchError

ALPHA = 0.05
MIN_STRATUM = 5  # labeled automated rows a group needs before its own accuracy is used
BANDS = (0.9, 0.99)  # confidence bands on a row's lowest gated signal: below 0.90, 0.90 to 0.99, 0.99 and up
BAND_NAMES = ("below 0.90", "0.90 to 0.99", "0.99 and up")
LEVELS = ("answers_band", "answers", "all")  # how closely the labeled rows an estimate borrows from match
DRAWS = 1000
EXACT_ARRANGEMENTS = 20000  # Mann-Whitney is exact up to this many arrangements, such as 4 against 40 rows
MIN_EXPECTED = 5  # chi-square's usual rule: every expected count at least 5
ROWS_SHOWN = 20


# --- tests ---------------------------------------------------------------------------------------


def _log_comb(n: int, k: int) -> float:
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)


def fisher_exact(a: int, b: int, c: int, d: int) -> float:
    """Two-sided p-value of Fisher's exact test for [[a, b], [c, d]]: the probability, with the margins fixed,
    of a table no more likely than this one."""
    r1, r2, c1 = a + b, c + d, a + c
    n = r1 + r2
    lo, hi = max(0, c1 - r2), min(r1, c1)
    if lo == hi:
        return 1.0
    base = _log_comb(n, c1)
    probs = [exp(_log_comb(r1, x) + _log_comb(r2, c1 - x) - base) for x in range(lo, hi + 1)]
    observed = probs[a - lo]
    return min(1.0, sum(p for p in probs if p <= observed * (1 + 1e-7)))


def chi2_sf(x: float, df: int) -> float:
    """P(X >= x) for a chi-square variable with a whole number of degrees of freedom, in closed form."""
    if df < 1:
        raise ValueError("df must be at least 1")
    if x <= 0:
        return 1.0
    if df % 2 == 0:
        term = total = exp(-x / 2)
        for i in range(1, df // 2):
            term *= (x / 2) / i
            total += term
        return min(1.0, total)
    total = erfc(sqrt(x / 2))
    if df > 1:
        term = sqrt(2 * x / pi) * exp(-x / 2)
        total += term
        for i in range(1, (df - 1) // 2):
            term *= x / (2 * i + 1)
            total += term
    return min(1.0, total)


def mix_test(ref: Dict[str, int], new: Dict[str, int]) -> Tuple[Optional[float], Optional[str]]:
    """(p-value, method) for whether two answer counts come from the same mix. (None, None) when they cannot
    differ: one side has no rows, or every row on both sides got the same answer.

    Answers too rare for chi-square's expected counts are pooled; with fewer than three groups left, Fisher's
    exact test compares the most common answer with the rest."""
    n1, n2 = sum(ref.values()), sum(new.values())
    cats = [k for k in ref.keys() | new.keys() if ref.get(k, 0) + new.get(k, 0)]
    if not n1 or not n2 or len(cats) < 2:
        return None, None
    total = {k: ref.get(k, 0) + new.get(k, 0) for k in cats}
    cats.sort(key=lambda k: (-total[k], k))
    need = MIN_EXPECTED * (n1 + n2) / min(n1, n2)  # a group's total for its smaller expected count to reach 5
    groups = [[k] for k in cats if total[k] >= need]
    rest = [k for k in cats if total[k] < need]
    if rest:
        groups.append(rest)
    while len(groups) > 1 and sum(total[k] for k in groups[-1]) < need:
        last = groups.pop()
        groups[-1] = groups[-1] + last
    if len(groups) < 3:
        top = cats[0]
        return fisher_exact(ref.get(top, 0), n1 - ref.get(top, 0), new.get(top, 0), n2 - new.get(top, 0)), "fisher"
    n = n1 + n2
    stat = 0.0
    for g in groups:
        col = sum(total[k] for k in g)
        for side, size in ((ref, n1), (new, n2)):
            observed = sum(side.get(k, 0) for k in g)
            expected = size * col / n
            stat += (observed - expected) ** 2 / expected
    return chi2_sf(stat, len(groups) - 1), "chi-square"


def mann_whitney(x: Sequence[float], y: Sequence[float]) -> Optional[float]:
    """Two-sided p-value of the Mann-Whitney U test. Exact over every arrangement of the pooled ranks, ties
    included, when there are at most EXACT_ARRANGEMENTS; otherwise the normal approximation with tie and
    continuity corrections, which small samples would make too eager to call a shift. None when a side is empty."""
    n1, n2 = len(x), len(y)
    if not n1 or not n2:
        return None
    pooled = sorted([(round(v, 9), 0) for v in x] + [(round(v, 9), 1) for v in y])
    n = n1 + n2
    ranks: List[float] = []
    rank_x = ties = 0.0
    i = 0
    while i < n:
        j = i
        while j + 1 < n and pooled[j + 1][0] == pooled[i][0]:
            j += 1
        size = j - i + 1
        rank = (i + j) / 2 + 1
        ranks += [rank] * size
        rank_x += rank * sum(1 for k in range(i, j + 1) if pooled[k][1] == 0)
        ties += size ** 3 - size
        i = j + 1
    small = min(n1, n2)
    if comb(n, small) <= EXACT_ARRANGEMENTS:
        # Every way to pick which ranks belong to the smaller side; |rank sum - its mean| is the statistic.
        mean = small * (n + 1) / 2
        observed = abs((rank_x if n1 == small else n * (n + 1) / 2 - rank_x) - mean)
        hits = total = 0
        for chosen in combinations(ranks, small):
            total += 1
            hits += abs(sum(chosen) - mean) + 1e-9 >= observed
        return hits / total
    u = rank_x - n1 * (n1 + 1) / 2
    var = n1 * n2 / 12 * ((n + 1) - ties / (n * (n - 1)))
    if var <= 0:
        return 1.0
    z = max(0.0, abs(u - n1 * n2 / 2) - 0.5) / sqrt(var)
    return erfc(z / sqrt(2))


def holm(ps: List[Optional[float]]) -> List[Optional[float]]:
    """Holm's step-down adjustment of several p-values; None stays None and does not count as a test."""
    order = sorted((p, i) for i, p in enumerate(ps) if p is not None)
    m = len(order)
    out: List[Optional[float]] = [None] * len(ps)
    running = 0.0
    for rank, (p, i) in enumerate(order):
        running = max(running, min(1.0, (m - rank) * p))
        out[i] = running
    return out


# --- reading the runs ----------------------------------------------------------------------------


def _categories(question: dict) -> List[str]:
    if question["type"] == "noul":
        return ["yes", "no"]
    if question["type"] == "score":
        return [str(i) for i in range(len(question.get("criteria") or []))]
    return [str(k) for k in (question.get("criteria") or {})]


def _read(results: List[dict], qtypes: Dict[str, str], signal: str) -> List[dict]:
    """Each answered row as {"index", "row", "read": {qid: (answer as shown, signal)}}; unreadable answers left out."""
    out = []
    for r in results:
        answers = r.get("answers")
        if not isinstance(answers, dict):
            continue
        read = {}
        for qid in qtypes:
            answer = answers.get(qid)
            if not isinstance(answer, dict) or answer.get("type") != qtypes[qid]:
                continue
            try:
                read[qid] = calibrate.read(answer, signal)
            except (KeyError, TypeError, ValueError, AttributeError):
                continue
        out.append({"index": r["index"], "row": r.get("row"), "read": read})
    return out


def _band(value: float) -> int:
    return sum(1 for cut in BANDS if value + calibrate._EPS >= cut)


def _route(rows: List[dict], gates: Dict[str, float]) -> Tuple[List[dict], List[dict]]:
    """(routed rows, automated rows). A row is routed when every gated answer is readable."""
    routed = [r for r in rows if all(q in r["read"] for q in gates)]
    auto = [r for r in routed if all(r["read"][q][1] + policy.EPS >= t for q, t in gates.items())]
    return routed, auto


def _key(row_read: Dict[str, Tuple[str, float]], gates: Dict[str, float]) -> Tuple[tuple, int]:
    """A row's group for the estimate: its gated answers, and the band of its lowest gated signal."""
    return tuple(row_read[q][0] for q in gates), _band(min(row_read[q][1] for q in gates))


def _shown(answers: tuple, gates: Dict[str, float]) -> str:
    return ", ".join("%s=%s" % (q, a) for q, a in zip(gates, answers))


# --- the estimate --------------------------------------------------------------------------------


def _groups(ref: List[Tuple[tuple, int, bool]], new: List[Tuple[tuple, int]]) -> List[Tuple[str, Any, int, int]]:
    """For each new automated row, the labeled rows it borrows from: (level, which group, right, count)."""
    by_band: Dict[tuple, List[int]] = {}
    by_answers: Dict[tuple, List[int]] = {}
    for answers, band, right in ref:
        for table, key in ((by_band, (answers, band)), (by_answers, answers)):
            hits = table.setdefault(key, [0, 0])
            hits[0] += right
            hits[1] += 1
    overall = (sum(right for _a, _b, right in ref), len(ref))
    out = []
    for answers, band in new:
        exact, near = by_band.get((answers, band)), by_answers.get(answers)
        if exact and exact[1] >= MIN_STRATUM:
            out.append(("answers_band", (answers, band), exact[0], exact[1]))
        elif near and near[1] >= MIN_STRATUM:
            out.append(("answers", answers, near[0], near[1]))
        else:
            out.append(("all", None) + overall)
    return out


def estimate(ref: List[Tuple[tuple, int, bool]], new: List[Tuple[tuple, int]]) -> Tuple[Optional[float], List[str]]:
    """(estimated accuracy of the new automated rows, the level each one borrowed from).

    ref: the labeled automated dataset rows as (gated answers, band, right). new: the new automated rows as
    (gated answers, band). None when either side is empty."""
    if not ref or not new:
        return None, []
    groups = _groups(ref, new)
    return sum(right / n for _lv, _g, right, n in groups) / len(groups), [lv for lv, _g, _r, _n in groups]


def interval(ref: list, new: list, reps: int = DRAWS, seed: int = 0) -> Tuple[Optional[float], Optional[float]]:
    """95% interval for the estimate. Each draw resamples the new automated rows and draws every borrowed accuracy
    from its Jeffreys posterior, Beta(right + 1/2, wrong + 1/2), so 40 of 40 right reads as about 94% to 100%,
    as a Wilson interval would, rather than exactly 100%. Seeded, so a report is repeatable."""
    if not ref or not new:
        return None, None
    rng = random.Random(seed)
    groups = _groups(ref, new)
    kinds = sorted(set(groups))
    values = []
    for _ in range(reps):
        drawn = {g: rng.betavariate(g[2] + 0.5, g[3] - g[2] + 0.5) for g in kinds}
        values.append(sum(drawn[rng.choice(groups)] for _ in groups) / len(groups))
    values.sort()
    point = sum(right / n for _lv, _g, right, n in groups) / len(groups)  # the estimate itself, which the interval holds
    return min(point, values[int(0.025 * (reps - 1))]), max(point, values[int(0.975 * (reps - 1) + 0.5)])


# --- the comparison ------------------------------------------------------------------------------


def _share(automated: int, routed: int) -> dict:
    low, high = calibrate.wilson(automated, routed)
    return {"routed": routed, "automated": automated, "share": automated / routed if routed else None,
            "share_low": low, "share_high": high}


def _signal_summary(values: List[float]) -> dict:
    return {"mean": statistics.fmean(values) if values else None,
            "median": statistics.median(values) if values else None, "n": len(values)}


def compare(reference: List[dict], new: List[dict], check: dict, questions: Dict[str, dict]) -> dict:
    """Compare a run of the dataset's rows (workbench.run_bulk "results", labels under "expect") with a run of new
    rows, through a validated check's gate. Labels on the new rows are ignored."""
    gates = check["gates"]
    signal = check["signal"]
    qtypes = {q: questions[q]["type"] for q in gates}
    qtypes.update({q: s["type"] for q, s in questions.items() if s["type"] in policy.TYPES and q not in qtypes})
    ref_rows, new_rows = _read(reference, qtypes, signal), _read(new, qtypes, signal)
    ref_routed, ref_auto = _route(ref_rows, gates)
    new_routed, new_auto = _route(new_rows, gates)

    # Which labeled dataset rows the gate automates, and whether each is right, scored as the check scores them.
    labeled: List[Tuple[tuple, int, bool]] = []
    accuracy = {"accuracy": None, "accuracy_low": None, "accuracy_high": None, "labeled_automated": 0}
    scored_rows = [{"index": r["index"], "answers": {q: r["answers"][q] for q in gates if q in r["answers"]},
                    "labels": {q: v for q, v in (r.get("expect") or {}).items() if q in gates}}
                   for r in reference if isinstance(r.get("answers"), dict)]
    if scored_rows:
        try:
            rep = policy.evaluate(scored_rows, gates, signal)
        except calibrate.CalibrationError:
            rep = None
        if rep is not None:
            by_index = {r["index"]: r for r in ref_rows}
            for item in rep["rows"]:
                if item["automated"] and item["index"] in by_index:
                    answers, band = _key(by_index[item["index"]]["read"], gates)
                    labeled.append((answers, band, item["correct"]))
            accuracy = {"accuracy": rep["accuracy"], "accuracy_low": rep["accuracy_low"],
                        "accuracy_high": rep["accuracy_high"], "labeled_automated": rep["automated"]}

    tests: List[Optional[float]] = []
    automation_p = (fisher_exact(len(ref_auto), len(ref_routed) - len(ref_auto), len(new_auto), len(new_routed) - len(new_auto))
                    if ref_routed and new_routed else None)
    tests.append(automation_p)

    per_question = []
    for qid, qtype in qtypes.items():
        cats = _categories(questions[qid])
        ref_counts = {c: 0 for c in cats}
        new_counts = {c: 0 for c in cats}
        ref_signals, new_signals = [], []
        for rows, counts, signals in ((ref_rows, ref_counts, ref_signals), (new_rows, new_counts, new_signals)):
            for r in rows:
                if qid in r["read"]:
                    shown, value = r["read"][qid]
                    counts[shown] = counts.get(shown, 0) + 1
                    signals.append(value)
        n1, n2 = sum(ref_counts.values()), sum(new_counts.values())
        mix_p, method = mix_test(ref_counts, new_counts)
        signal_p = mann_whitney(ref_signals, new_signals)
        mix = [{"answer": c, "reference": ref_counts[c], "new": new_counts.get(c, 0),
                "reference_share": ref_counts[c] / n1 if n1 else None,
                "new_share": new_counts.get(c, 0) / n2 if n2 else None} for c in ref_counts]
        mix += [{"answer": c, "reference": 0, "new": v, "reference_share": 0.0 if n1 else None,
                 "new_share": v / n2 if n2 else None} for c, v in new_counts.items() if c not in ref_counts]
        distance = (sum(abs(m["reference_share"] - m["new_share"]) for m in mix) / 2) if n1 and n2 else None
        tests += [mix_p, signal_p]
        per_question.append({
            "qid": qid, "type": qtype, "gated": qid in gates, "threshold": gates.get(qid),
            "reference_answered": n1, "new_answered": n2, "mix": mix, "distance": distance,
            "mix_p": mix_p, "mix_method": method,
            "signal": {"reference": _signal_summary(ref_signals), "new": _signal_summary(new_signals), "p": signal_p},
        })

    adjusted = holm(tests)
    shifted = [p is not None and p < ALPHA for p in adjusted]
    automation = dict(p=automation_p, p_adjusted=adjusted[0], shifted=shifted[0])
    for i, q in enumerate(per_question):
        q["mix_p_adjusted"], q["mix_shifted"] = adjusted[1 + 2 * i], shifted[1 + 2 * i]
        q["signal"]["p_adjusted"], q["signal"]["shifted"] = adjusted[2 + 2 * i], shifted[2 + 2 * i]

    new_keys = [_key(r["read"], gates) for r in new_auto]
    value, levels = estimate(labeled, new_keys)
    low, high = interval(labeled, new_keys)
    support: Dict[tuple, int] = {}
    for answers, _band_, _right in labeled:
        support[answers] = support.get(answers, 0) + 1
    thin = [r for r, (answers, _b) in zip(new_auto, new_keys) if support.get(answers, 0) < MIN_STRATUM]
    est = {"accuracy": value, "low": low, "high": high, "automated": len(new_auto),
           "levels": {lv: levels.count(lv) for lv in LEVELS}}

    reasons: List[str] = []
    ref_share, new_share = _share(len(ref_auto), len(ref_routed)), _share(len(new_auto), len(new_routed))
    for name, rows, routed in (("dataset", ref_rows, ref_routed), ("new", new_rows, new_routed)):
        if routed and len(routed) < len(rows):
            reasons.append("%d of %d %s rows have no readable answer to a gated question, so the comparison is not "
                           "over every row. Run it again." % (len(rows) - len(routed), len(rows), name))
    if not ref_routed or not new_routed:
        reasons.append("No %s row has a readable answer to every gated question, so the runs cannot be compared."
                       % ("dataset" if not ref_routed else "new"))
    if automation["shifted"]:
        reasons.append("The gate automates %s of the new rows and %s of the dataset's (adjusted p %s)."
                       % (_pct(new_share["share"]), _pct(ref_share["share"]), _p(automation["p_adjusted"])))
    for q in per_question:
        if q["mix_shifted"]:
            moved = max(q["mix"], key=_moved)
            reasons.append("%s answers are mixed differently: %s is %s of new answers and %s of the dataset's "
                           "(adjusted p %s)." % (q["qid"], moved["answer"], _pct(moved["new_share"]),
                                                   _pct(moved["reference_share"]), _p(q["mix_p_adjusted"])))
        if q["signal"]["shifted"]:
            s = q["signal"]
            reasons.append("%s is %s confident on the new rows: median %.2f, against %.2f (adjusted p %s)."
                           % (q["qid"], "less" if s["new"]["median"] < s["reference"]["median"] else "more",
                              s["new"]["median"], s["reference"]["median"], _p(s["p_adjusted"])))

    targets: Dict[str, dict] = {}
    bound = check["bound"]
    if new_share["share"] is not None:
        ok = new_share["share"] + checks.EPS >= check["min_coverage"]
        targets["coverage"] = {"ok": ok, "value": new_share["share"], "target": check["min_coverage"]}
        if not ok:
            reasons.append("The gate automates %s of the new rows, below the check's %s minimum."
                           % (_pct(new_share["share"]), _pct(check["min_coverage"])))
    if value is not None:
        measured = value if bound == "estimate" else low
        ok = measured + checks.EPS >= check["min_accuracy"]
        targets["accuracy"] = {"ok": ok, "value": measured, "target": check["min_accuracy"], "bound": bound}
        if not ok:
            reasons.append("The estimated accuracy on the new automated rows is %s%s, below the check's %s target."
                           % (_pct(value), " (95%% lower bound %s)" % _pct(low) if bound == "lower" else "",
                              _pct(check["min_accuracy"])))
    elif new_auto:
        reasons.append("No labeled dataset row is automated, so the accuracy on the new rows cannot be estimated.")
    if thin:
        reasons.append("%d of %d new automated rows have gated answers fewer than %d labeled dataset rows share, so "
                       "their estimate leans on unlike rows. Label some of them and add them to the dataset."
                       % (len(thin), len(new_auto), MIN_STRATUM))

    if not ref_routed or not new_routed or len(ref_routed) < len(ref_rows) or len(new_routed) < len(new_rows):
        status = "error"
    elif any(shifted) or any(not t["ok"] for t in targets.values()):
        status = "shift"
    else:
        status = "steady"
    return {
        "status": status, "reasons": reasons, "alpha": ALPHA, "signal": signal, "gates": gates,
        "reference": dict(ref_share, rows=len(reference), answered=len(ref_rows), **accuracy),
        "new": dict(new_share, rows=len(new), answered=len(new_rows)),
        "automation": automation, "questions": per_question, "estimate": est, "targets": targets,
        "tests": sum(1 for p in tests if p is not None),
        "thin": [{"index": r["index"], "row": checks._row_text(r["row"]),
                  "answers": _shown(_key(r["read"], gates)[0], gates)} for r in thin[:ROWS_SHOWN]],
        "thin_total": len(thin),
    }


def _moved(m: dict) -> Tuple[float, float]:
    """How far an answer's share moved; of two that moved as far, the one that grew, since the new rows are about it."""
    change = (m["new_share"] or 0) - (m["reference_share"] or 0)
    return abs(change), change


def _pct(value: Optional[float]) -> str:
    return "n/a" if value is None else "%.1f%%" % (100 * value)


def _p(value: Optional[float]) -> str:
    return "n/a" if value is None else ("< 0.001" if value < 0.001 else "= %.3f" % value)


# --- the runs ------------------------------------------------------------------------------------


def new_rows(rows: Any) -> List[Any]:
    """New rows as Bulk takes them: text, one row per line, or a list. Empty rows are dropped."""
    if isinstance(rows, str):
        rows = workbench.parse_rows(rows)
    if not isinstance(rows, list):
        raise WorkbenchError("rows must be text or a list")
    rows = [r for r in rows if r not in (None, "")]
    if not rows:
        raise WorkbenchError("Paste the new rows to compare, one per line")
    if len(rows) > workbench.MAX_BULK_ROWS:
        raise WorkbenchError("Compare up to %d new rows at a time, the most one Bulk run takes; these are %d."
                             % (workbench.MAX_BULK_ROWS, len(rows)))
    for number, row in enumerate(rows, 1):
        if not isinstance(row, (str, dict, list)):
            raise WorkbenchError("New row %d must be text, a JSON object, or a JSON array" % number)
        try:
            state, _labels = workbench.split_labels(row, number)
        except WorkbenchError as err:  # "Row 2 has labels but no state"
            raise WorkbenchError("New r" + str(err)[1:])
        try:
            workbench.validate_state(state)
        except WorkbenchError as err:
            raise WorkbenchError("New row %d: %s" % (number, err))
    return rows


def _incomplete(bulk: dict, what: str) -> List[str]:
    out = []
    if bulk["stopped"]:
        out.append("The run of the %s stopped early: %s" % (what, bulk["stopped"]))
    missing = bulk["rows"] - bulk["completed"]
    if missing:
        out.append("%d of %d %s got no answer, so the comparison is not over every row. Run it again."
                   % (missing, bulk["rows"], what))
    return out


def run(client: JevClient, dataset_id: str, rows: Any, model: Optional[str] = None) -> dict:
    """Send the saved dataset's rows, then the new rows, to the model with the dataset's questions, and compare
    them through its check's gate. The dataset run is also judged as a check run is, so the report says whether
    the gate still holds on the rows it was tuned on. model: ask this model instead of the one the check names."""
    dataset = workbench.load_dataset(dataset_id)
    if not isinstance(dataset.get("check"), dict):
        raise WorkbenchError("The dataset %r has no check. Save one from the Workbench's Policy panel." % dataset_id)
    check = checks.validate_check(dataset["check"], dataset.get("questions"))
    fresh = new_rows(rows)
    questions = workbench.bulk_questions(dataset["questions"])
    asked = (model or "").strip() or check["model"]
    ref = workbench.run_bulk(client, dataset["rows"], questions, model=asked)
    if ref["stopped"]:  # a missing key or the budget: the new rows would stop too
        new = {"results": [], "rows": len(fresh), "completed": 0, "stopped": None, "cost_usd": 0.0,
               "input_tokens": 0, "wall_ms": 0.0}
    else:
        new = workbench.run_bulk(client, fresh, questions, model=asked)
    report = compare(ref["results"], new["results"], check, questions)
    problems = _incomplete(ref, "dataset rows") + ([] if ref["stopped"] else _incomplete(new, "new rows"))
    if problems:
        report["status"] = "error"
        report["reasons"] = problems + report["reasons"]
    by = {side: sorted({r["meta"].get("model") for r in bulk["results"] if "answers" in r and r["meta"].get("model")})
          for side, bulk in (("reference", ref), ("new", new))}
    notes = checks.run_notes(check, by["reference"])
    if by["reference"] and by["new"] and by["reference"] != by["new"]:
        notes.append("The dataset rows were answered by %s and the new rows by %s, so a difference may come from the "
                     "model rather than the rows. Run it again." % (", ".join(by["reference"]), ", ".join(by["new"])))
    gate_check = checks.evaluate(ref["results"], check, ref["stopped"])
    latencies = [r["meta"]["latency_ms"] for bulk in (ref, new) for r in bulk["results"] if "answers" in r]
    report.update({
        "id": dataset_id, "name": dataset.get("name") or dataset_id, "check": check, "model": asked,
        "answered_by": sorted(set(by["reference"]) | set(by["new"])), "notes": notes,
        "check_status": gate_check["status"], "check_reasons": gate_check["reasons"],
        "cost_usd": ref["cost_usd"] + new["cost_usd"], "input_tokens": ref["input_tokens"] + new["input_tokens"],
        "calls": ref["completed"] + new["completed"], "wall_ms": ref["wall_ms"] + new["wall_ms"],
        "latency_ms_median": statistics.median(latencies) if latencies else None,
    })
    return report
