"""Upgrade: should a check move to a new model version, and with which thresholds?

A check (jev/checks.py) is pinned to the version its gate was tuned on. When TypeSafe ships a new version, the
question is whether the gate still holds there, and if not, whether thresholds tuned on the new version would.
run() asks both versions every row of the check's dataset, the version the check was tuned on and the candidate,
so each row has a fresh answer from each side; nothing from an earlier run is reused. Then:

- the check is judged on each side with its saved thresholds, as Run check would judge it;
- the labeled rows are compared pair by pair: on how many each side got every gated answer right, with the exact
  McNemar test, and on how many rows each gated question changed its answer, which needs no labels;
- the gates are tuned again on the candidate's answers at the check's own accuracy target and bound, as Policy's
  Tune would, and judged against both targets; five-fold cross-validation says what that tuning delivers on rows
  it was not tuned on.

The verdict is "keep" when the saved thresholds still meet both targets on the candidate, "retune" when they do
not but thresholds tuned on the candidate do, "stay" when neither does, and "error" when either run could not
judge the check. For "keep" and "retune" the report holds the checks that could be saved, with the saved thresholds
and with the retuned ones where each meets the targets, pinned to the version that answered the candidate run.
Saving one goes through the ordinary check endpoint, so this module writes nothing, and only targets and thresholds
are ever saved, never answers.
"""

from __future__ import annotations

import statistics
from typing import Any, Dict, List

from . import calibrate, checks, holdout, policy, workbench
from .calibrate import STEPS, CalibrationError
from .client import JevClient, is_versioned
from .compare import mcnemar
from .workbench import WorkbenchError

VERDICTS = ("keep", "retune", "stay", "error")
SIDES = ("current", "candidate")
CHANGED_SHOWN = 20


def _policy_rows(results: List[dict], gates: Dict[str, float]) -> List[dict]:
    """checks.evaluate's rows for policy: every answered row, with its labels for the gated questions."""
    return [{"index": r["index"], "answers": r["answers"], "key": checks._row_text(r.get("row")), "row": r.get("row"),
             "labels": {q: v for q, v in (r.get("expect") or {}).items() if q in gates}}
            for r in results if isinstance(r.get("answers"), dict)]


def _scored(results: List[dict], check: dict) -> Dict[Any, dict]:
    """Each labeled row's policy result under the check's gate, by row index; {} when the answers cannot be read."""
    try:
        rep = policy.evaluate(_policy_rows(results, check["gates"]), check["gates"], check["signal"], check.get("rules"))
    except CalibrationError:
        return {}
    return {r["index"]: r for r in rep["rows"]}


def paired(current: List[dict], candidate: List[dict], check: dict) -> dict:
    """Compare the two runs row by row over the labeled rows both answered: whether every gated answer is right
    on each side, and whether each side's gate automates the row."""
    a, b = _scored(current, check), _scored(candidate, check)
    both = [i for i in a if i in b]
    counts = {"both_right": 0, "current_only": 0, "candidate_only": 0, "both_wrong": 0}
    for i in both:
        x, y = a[i]["correct"], b[i]["correct"]
        counts["both_right" if x and y else "current_only" if x else "candidate_only" if y else "both_wrong"] += 1
    n = len(both)
    out: Dict[str, Any] = {"rows": n, **counts, "p": mcnemar(counts["current_only"], counts["candidate_only"])}
    for side, right in (("current", counts["both_right"] + counts["current_only"]),
                        ("candidate", counts["both_right"] + counts["candidate_only"])):
        low, high = calibrate.wilson(right, n)
        out[side] = {"correct": right, "accuracy": right / n if n else None, "low": low, "high": high}
    return out


def changed(current: List[dict], candidate: List[dict], check: dict) -> dict:
    """For each gated question, on how many rows both runs answered the two versions gave a different answer.
    Labels are not needed, so every answered row counts."""
    by_index = {r["index"]: r for r in candidate if isinstance(r.get("answers"), dict)}
    per = {q: {"qid": q, "rows": 0, "changed": 0} for q in check["gates"]}
    rows = []
    for r in current:
        other = by_index.get(r["index"])
        if not isinstance(r.get("answers"), dict) or other is None:
            continue
        moved = {}
        for q in check["gates"]:
            try:
                was, _ = calibrate.read(r["answers"][q], check["signal"])
                now, _ = calibrate.read(other["answers"][q], check["signal"])
            except (KeyError, TypeError, ValueError):
                continue
            per[q]["rows"] += 1
            if was != now:
                per[q]["changed"] += 1
                moved[q] = {"current": was, "candidate": now}
        if moved:
            rows.append({"index": r["index"], "row": checks._row_text(r.get("row")), "changed": moved,
                         "label": {q: (r.get("expect") or {}).get(q) for q in moved}})
    for p in per.values():
        p["share"] = p["changed"] / p["rows"] if p["rows"] else None
        p["low"], p["high"] = calibrate.wilson(p["changed"], p["rows"])
    return {"questions": list(per.values()), "rows": rows[:CHANGED_SHOWN], "rows_total": len(rows)}


def retune(results: List[dict], check: dict) -> dict:
    """Thresholds tuned on these answers at the check's accuracy target and bound, and what five-fold
    cross-validation says they deliver on rows they were not tuned on. gates is None when no thresholds reach the
    target on these rows."""
    qids = list(check["gates"])
    rows = _policy_rows(results, check["gates"])
    target = check["min_accuracy"]
    try:
        _, _, levels, right = policy.prepared(rows, qids, check["signal"], check.get("rules"))
        steps = policy.search(levels, right, check["bound"], (target,))[0]
        cv = holdout.evaluate(rows, qids, check["signal"], check["bound"], rules=check.get("rules"), targets=(target,))
    except CalibrationError as err:
        return {"gates": None, "problem": str(err), "unseen": None}
    unseen = None
    if cv["targets"]:
        t = cv["targets"][0]
        u = t["unseen"]
        unseen = {"folds": cv["folds"], "automated": u["automated"], "coverage": u["coverage"],
                  "accuracy": u["accuracy"], "low": u["low"], "high": u["high"], "unreached": t["unreached"],
                  "below": t["below"]}
    gates = None if steps is None else {q: steps[j] / STEPS for j, q in enumerate(qids)}
    return {"gates": gates, "problem": None, "unseen": unseen, "minimum": cv["minimum"], "holdout_problem": cv["problem"]}


def _judged(rep: dict) -> dict:
    keys = ("status", "reasons", "targets", "labeled", "automated", "correct", "coverage", "accuracy",
            "accuracy_low", "accuracy_high", "mistakes_total")
    return {k: rep.get(k) for k in keys}


def compare(current: dict, candidate: dict, check: dict) -> dict:
    """The report for two Bulk runs (workbench.run_bulk results) of a check's dataset: current is the version the
    check was tuned on, candidate the version it may move to."""
    now = checks.evaluate(current["results"], check, current["stopped"])
    kept = checks.evaluate(candidate["results"], check, candidate["stopped"])
    tuned = retune(candidate["results"], check)
    retuned = None
    if tuned["gates"] is not None:
        retuned = _judged(checks.evaluate(candidate["results"], dict(check, gates=tuned["gates"]), candidate["stopped"]))
    reasons: List[str] = []
    if now["status"] == "error":
        reasons += ["The run of the version the check was tuned on: %s" % r for r in now["reasons"]]
    if kept["status"] == "error":
        reasons += ["The run of the candidate: %s" % r for r in kept["reasons"]]
    if reasons:
        verdict = "error"
    elif kept["status"] == "pass":
        verdict = "keep"
    elif retuned is not None and retuned["status"] == "pass":
        verdict = "retune"
    else:
        verdict = "stay"
        reasons.append("Neither the saved thresholds nor thresholds tuned on the candidate meet the check's targets "
                       "on its answers, so keep the check on the version it was tuned on.")
    return {"verdict": verdict, "reasons": reasons, "current": _judged(now), "candidate": _judged(kept),
            "retuned": dict(tuned, report=retuned), "paired": paired(current["results"], candidate["results"], check),
            "changed": changed(current["results"], candidate["results"], check)}


def _answered_by(bulk: dict) -> List[str]:
    return sorted({r["meta"].get("model") for r in bulk["results"] if "answers" in r and r["meta"].get("model")})


def _side(bulk: dict, asked: str) -> dict:
    latencies = [r["meta"]["latency_ms"] for r in bulk["results"] if "answers" in r]
    return {"model": asked, "answered_by": _answered_by(bulk), "rows": bulk["rows"], "completed": bulk["completed"],
            "cost_usd": bulk["cost_usd"], "input_tokens": bulk["input_tokens"],
            "latency_ms_median": statistics.median(latencies) if latencies else None}


def run(client: JevClient, dataset_id: str, candidate: Any) -> dict:
    """Ask the check's tuned-on version and `candidate` every row of the dataset, and say whether the check can move."""
    dataset = workbench.load_dataset(dataset_id)
    if not isinstance(dataset.get("check"), dict):
        raise WorkbenchError("The dataset %r has no check. Save one from the Workbench's Policy panel." % dataset_id)
    check = checks.validate_check(dataset["check"], dataset.get("questions"))
    candidate = candidate.strip() if isinstance(candidate, str) else ""
    if not candidate or len(candidate) > checks.MAX_MODEL_CHARS:
        raise WorkbenchError("Name the model to try, such as jev-1.15.0 or jev-latest")
    current = check.get("tuned_on") or check["model"]
    if candidate == current:
        raise WorkbenchError("The check was tuned on %s already. Name another version to try." % current)
    questions = workbench.bulk_questions(dataset["questions"])
    ran = {"current": workbench.run_bulk(client, workbench.tuning_rows(dataset), questions, model=current)}
    if ran["current"]["stopped"]:  # a missing key or the budget: the candidate would stop too
        ran["candidate"] = {"results": [], "rows": len(workbench.tuning_rows(dataset)), "completed": 0,
                            "stopped": ran["current"]["stopped"], "cost_usd": 0.0, "input_tokens": 0, "wall_ms": 0.0}
    else:
        ran["candidate"] = workbench.run_bulk(client, workbench.tuning_rows(dataset), questions, model=candidate)
    report = compare(ran["current"], ran["candidate"], check)
    sides = {"current": _side(ran["current"], current), "candidate": _side(ran["candidate"], candidate)}
    notes: List[str] = []
    if not is_versioned(current):
        notes.append("The check has no recorded tuned-on version and asks %s, an alias, so the current side is "
                     "whatever %s points at now." % (current, current))
    if len(sides["current"]["answered_by"]) > 1:
        notes.append("The current side was answered by %s." % ", ".join(sides["current"]["answered_by"]))
    pinned = sides["candidate"]["answered_by"]
    if report["verdict"] in ("keep", "retune") and (len(pinned) != 1 or not is_versioned(pinned[0])):
        report["verdict"] = "error"
        report["reasons"].append("The candidate run was answered by %s, so there is no one version to pin the check "
                                 "to. Run it again." % (", ".join(pinned) or "no version"))
    elif pinned and sides["current"]["answered_by"] == pinned:
        notes.append("Both sides were answered by %s, so the comparison only shows run-to-run variation." % pinned[0])
    proposals = {"saved": None, "retuned": None}  # each a check to save, pinned to the candidate's version
    if report["verdict"] in ("keep", "retune"):
        # A probability cut fitted on the old version does not carry its coverage to a new model.
        base = {k: v for k, v in check.items() if k not in ("saved_at", "answer_sets")}
        if check.get("answer_sets"):
            notes.append("The proposed checks leave out the saved answer-set cuts. Refit Answer sets on a Bulk run "
                         "of the candidate version before exporting review shortlists for it.")
        if report["candidate"]["status"] == "pass":
            proposals["saved"] = dict(base, model=pinned[0], tuned_on=pinned[0])
        retuned = report["retuned"]["report"]
        if retuned is not None and retuned["status"] == "pass" and report["retuned"]["gates"] != check["gates"]:
            proposals["retuned"] = dict(base, gates=report["retuned"]["gates"], model=pinned[0], tuned_on=pinned[0])
    report.update({
        "id": dataset_id, "name": dataset.get("name") or dataset_id, "check": check, "sides": sides,
        "notes": notes, "proposals": proposals,
        "cost_usd": sides["current"]["cost_usd"] + sides["candidate"]["cost_usd"],
        "input_tokens": sides["current"]["input_tokens"] + sides["candidate"]["input_tokens"],
        "calls": ran["current"]["completed"] + ran["candidate"]["completed"],
    })
    return report
