"""Answer sets: for each row, the shortest list of answers that holds the right one as often as you ask.

A gate either acts on the top answer or sends the whole row to a person, who then reads every option. Often the
model is unsure between two or three of them, and the right one is almost always among those. This module turns
one question's labeled Bulk answers into a cut on the stated probability: every option at or above the cut joins
the row's answer set. A set of one answer can be acted on; a longer set goes to review with only those answers
to choose from; a row where no option reaches the cut goes to review with every option.

The cut comes from split conformal prediction (https://en.wikipedia.org/wiki/Conformal_prediction). Each labeled
row scores 1 - (the probability the model gave its label). With n labeled rows and a coverage target 1 - a, the
cut is 1 minus the ceil((n + 1)(1 - a))-th smallest score. On a new row drawn like these, the set then holds the
right answer with probability at least 1 - a, averaged over rows and over the labeled rows the cut came from.
That holds whatever the model's probabilities are, calibrated or not, and needs at least (1 - a) / a labeled rows.
It is a guarantee for rows on average, not for each kind of row: a slice can fall short, which is why the report
breaks coverage down by a row field. The accuracy of the single-answer rows alone is measured, not guaranteed.

The coverage measured on the rows the cut came from is optimistic in the same way a tuned threshold is, so the
report also cross-validates: each fold's rows get sets from a cut fitted on the other folds (jev/holdout.py's
deterministic folds). It reads answers Bulk already returned, so it makes no model calls.

Choice, Noul (as yes and no), and Score answers have sets; Box answers have no options, so they have none.
"""

from __future__ import annotations

from math import ceil, isfinite
from typing import Any, Dict, List, Optional, Tuple

from . import calibrate, holdout, slices
from .calibrate import CalibrationError
from .workbench import WorkbenchError

COVERAGES = (0.80, 0.90, 0.95, 0.99)
TYPES = ("choice", "noul", "score")
EPS = calibrate._EPS  # a probability equal to the cut joins the set, as a signal equal to a threshold clears it


def validate_config(spec: Any, questions: Any) -> dict:
    """Saved shortlist cuts, keyed by question, without answers or measured results. None means no shortlists.

    These cuts only choose what a reviewer sees; a gate's thresholds and consistency rules still decide its route.
    """
    if spec is None:
        return {}
    if not isinstance(spec, dict):
        raise WorkbenchError("answer_sets must be an object keyed by question id")
    out = {}
    for qid, fitted in spec.items():
        question = questions.get(qid) if isinstance(questions, dict) else None
        if not isinstance(question, dict):
            raise WorkbenchError("The answer set reads %r, which is not one of the questions" % qid)
        if question.get("type") not in TYPES:
            raise WorkbenchError("The answer set reads %r; answer sets read Choice, Noul, and Score" % qid)
        if not isinstance(fitted, dict):
            raise WorkbenchError("The answer set for %r needs its cut and coverage" % qid)
        values = {}
        for field in ("cut", "coverage"):
            value = fitted.get(field)
            if (isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value)
                    or not 0 <= value <= 1 or (field == "coverage" and value in (0, 1))):
                interval = "above 0 and below 1" if field == "coverage" else "from 0 to 1"
                raise WorkbenchError("The answer set %s for %r must be a number %s" % (field, qid, interval))
            values[field] = float(value)
        out[qid] = values
    return out


def needed(coverage: float) -> int:
    """The fewest labeled rows whose cut can promise this coverage: n with ceil((n + 1) * coverage) <= n, which holds
    exactly when n >= coverage / (1 - coverage)."""
    n = max(1, ceil(coverage / (1 - coverage) - EPS))
    while ceil((n + 1) * coverage - EPS) > n:  # float rounding can put the closed form a few rows off either way
        n += 1
    while n > 1 and ceil(n * coverage - EPS) <= n - 1:
        n -= 1
    return n


def cut(scores: List[float], coverage: float) -> Optional[float]:
    """The probability an option needs to join a set, from the labeled rows' scores (1 - P(label)).
    None when there are too few rows to promise the coverage."""
    n = len(scores)
    k = ceil((n + 1) * coverage - EPS)
    if k > n or n == 0:
        return None
    return 1 - sorted(scores)[k - 1]


def answer_set(probs: Dict[str, float], at: Optional[float]) -> List[str]:
    """The options whose probability reaches the cut, most likely first. Empty when none does, or when there is no cut."""
    if at is None:
        return []
    return sorted((k for k, p in probs.items() if p + EPS >= at), key=lambda k: -probs[k])


def _coverage(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0.5 <= value < 1:
        raise CalibrationError("coverage must be a number from 0.5 to below 1, such as 0.9")
    return float(value)


def _options(qtype: str, answer: dict) -> Dict[str, float]:
    """The answer's options and their probabilities, keyed as Calibrate shows a label."""
    if qtype == "noul":
        p = calibrate._unit(answer.get("noul"), "noul")
        return {"yes": p, "no": 1 - p}
    probs = calibrate._probs(answer)
    if not probs:
        raise ValueError("answer has no probabilities")
    if qtype == "score":
        return {str(int(k)): v for k, v in probs.items()}  # level keys must be whole numbers; ValueError otherwise
    return probs


def _prepare(rows: Any) -> Tuple[str, List[dict], List[dict], int]:
    """(question type, scored rows, invalid labels, unlabeled count). Each scored row: index, key, row, options, label."""
    if not isinstance(rows, list):
        raise CalibrationError("rows must be a list")
    if len(rows) > calibrate.MAX_ROWS:
        raise CalibrationError("At most %d rows" % calibrate.MAX_ROWS)
    qtype = None
    scored: List[dict] = []
    invalid: List[dict] = []
    unlabeled = 0
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("answer"), dict):
            continue
        answer = row["answer"]
        if answer.get("type") == "box":
            raise CalibrationError("A Box answer has no options to list, so it has no answer set")
        if answer.get("type") not in TYPES:
            raise CalibrationError("Answer sets work on Choice, Noul, and Score answers")
        if qtype is None:
            qtype = answer["type"]
        elif answer["type"] != qtype:
            raise CalibrationError("All answers must come from the same question")
        if row.get("label") in (None, ""):
            unlabeled += 1
            continue
        try:
            label = calibrate._show(qtype, calibrate._label(qtype, row["label"], answer))
            options = _options(qtype, answer)
            if label not in options:
                raise ValueError("label %r is not one of the answer's options" % (label,))
        except (KeyError, TypeError, ValueError, AttributeError) as err:
            invalid.append({"index": row.get("index"), "reason": str(err).strip("'\"")})
            continue
        key = row.get("key")
        scored.append({"index": row.get("index"), "key": key if isinstance(key, str) and key else "#%s" % (row.get("index"),),
                       "row": row.get("row"), "options": options, "label": label})
    if qtype is None:
        raise CalibrationError("No answers to make sets from. Run Bulk first.")
    return qtype, scored, invalid, unlabeled


def _route(item: dict, at: Optional[float]) -> dict:
    """One row under a cut: its set, the list a person would see, the route, and whether that list holds the label."""
    chosen = answer_set(item["options"], at)
    shown = chosen or sorted(item["options"], key=lambda k: -item["options"][k])  # nothing reached the cut: every option
    return {"index": item["index"], "label": item["label"], "set": chosen, "size": len(chosen),
            "route": "auto" if len(chosen) == 1 else "review", "covered": item["label"] in shown,
            "probabilities": {k: item["options"][k] for k in shown}}


def _summary(routed: List[dict], options: int) -> dict:
    """Coverage, what the single-answer rows deliver, and how long the lists sent to review are."""
    n = len(routed)
    covered = sum(r["covered"] for r in routed)
    auto = [r for r in routed if r["route"] == "auto"]
    auto_right = sum(r["covered"] for r in auto)
    review = [r for r in routed if r["route"] == "review"]
    short = [r for r in review if r["size"] >= 2]
    sizes: Dict[str, int] = {}
    for r in routed:
        name = "none" if r["size"] == 0 else str(r["size"])
        sizes[name] = sizes.get(name, 0) + 1
    low, high = calibrate.wilson(covered, n)
    a_low, a_high = calibrate.wilson(auto_right, len(auto))
    listed = sum(len(r["probabilities"]) for r in review)
    return {
        "rows": n, "covered": covered, "coverage": covered / n if n else None, "low": low, "high": high,
        "single": len(auto), "single_share": len(auto) / n if n else 0.0, "single_right": auto_right,
        "single_accuracy": auto_right / len(auto) if auto else None, "single_low": a_low, "single_high": a_high,
        "review": len(review), "short": len(short), "none": sum(1 for r in routed if r["size"] == 0),
        "review_covered": sum(r["covered"] for r in review),
        # A reviewer reads this many options per reviewed row, where a plain gate would show all of them.
        "listed_per_review": listed / len(review) if review else None, "options": options,
        "sizes": sizes,
    }


def evaluate(rows: Any, coverage: Any = 0.9, folds: Any = holdout.FOLDS, field: Any = None) -> dict:
    """rows: [{"index", "answer", "label", "key"?, "row"?}] for one question; key names the row's input for the folds,
    row is its input for slices. coverage: how often a set must hold the right answer. field: the row field to slice by."""
    coverage = _coverage(coverage)
    folds = holdout._folds(folds)
    qtype, scored, invalid, unlabeled = _prepare(rows)
    options = max((len(item["options"]) for item in scored), default=0)
    n = len(scored)
    base = {"type": qtype, "coverage_target": coverage, "labeled": n, "unlabeled": unlabeled, "invalid": invalid,
            "needed": needed(coverage), "options": options, "cut": None, "summary": None, "rows": [],
            "holdout": None, "slices": None}
    if not n:
        return base
    scores = [1 - item["options"][item["label"]] for item in scored]
    at = cut(scores, coverage)
    base["cut"] = at
    if at is None:
        return base
    routed = [_route(item, at) for item in scored]
    base["summary"] = _summary(routed, options)
    base["rows"] = routed
    base["slices"] = slices.evaluate([{"row": item["row"], "correct": r["covered"], "automated": r["route"] == "auto"}
                                      for item, r in zip(scored, routed)], field)
    if n >= folds * holdout.MIN_PER_FOLD:
        fold_of = holdout.assign([item["key"] for item in scored], [item["index"] for item in scored], folds)
        unseen: List[dict] = []
        cuts: List[float] = []
        unreached = 0
        for f in range(folds):
            train = [scores[i] for i in range(n) if fold_of[i] != f]
            fold_cut = cut(train, coverage)
            if fold_cut is None:
                unreached += 1  # too few rows to promise the coverage: every option, sent to review
            else:
                cuts.append(fold_cut)
            unseen.extend(_route(scored[i], fold_cut) for i in range(n) if fold_of[i] == f)
        base["holdout"] = dict(_summary(unseen, options), folds=folds, unreached=unreached,
                               spread=[min(cuts), max(cuts)] if cuts else None)
    else:
        base["holdout"] = {"folds": folds, "minimum": folds * holdout.MIN_PER_FOLD}
    return base
