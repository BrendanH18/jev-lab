"""Checks: rerun a tuned gate over a saved dataset and say whether it still meets its targets.

Policy tunes thresholds on one Bulk run. A check keeps that decision with the rows it was tuned on. In a
saved dataset (data/workbench/datasets/<id>.json), under "check", it records which questions are gated at
which thresholds, the signal they read, the model to ask, the version that answered the run the thresholds
were tuned on, and two targets a person chose: the accuracy the automated rows must reach (measured, or at
95% confidence) and the share of labeled rows that must be automated. Running a check sends every row to the model again, scores the new answers with
policy.evaluate, and passes only when both targets hold on every row of the dataset.

A check saved from a run of an alias such as jev-latest asks the version that answered that run by default,
because an alias moves when TypeSafe ships a new version and thresholds tuned on one version may not hold on
the next (https://docs.typesafe.ai/models#aliases). A check that still asks an alias carries a note saying so,
and a run answered by another version than the one the gate was tuned on says that too.

A check holds targets, never answers or results from an earlier run, so every number a run reports comes
from that run. Run checks from the Workbench's Datasets panel, or with scripts/check.py, which exits
nonzero when a check fails so a CI job can rerun them after a change to wording or model.
"""

from __future__ import annotations

import json
import statistics
import time
from math import isfinite
from typing import Any, Dict, List, Optional

from . import calibrate, policy, workbench
from .calibrate import CalibrationError
from .client import JevClient, is_versioned
from .workbench import WorkbenchError

STATUSES = ("pass", "fail", "error")
MAX_MODEL_CHARS = 100
MISTAKES_SHOWN = 20
EPS = calibrate._EPS  # a share equal to its target meets it, as a threshold equal to its signal clears it


def _unit(value: Any, what: str, low: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or not low <= value <= 1:
        raise WorkbenchError("%s must be a number from %g to 1" % (what, low))
    return float(value)


def validate_check(spec: Any, questions: Any) -> dict:
    """The check as it is saved, or WorkbenchError. `questions` are the dataset's saved questions."""
    if not isinstance(spec, dict):
        raise WorkbenchError("A check must be an object")
    if not isinstance(questions, dict) or not questions:
        raise WorkbenchError("Save the dataset with its questions first: a check reruns them")
    try:
        gates = policy._gates(spec.get("gates"))
    except CalibrationError as err:
        raise WorkbenchError(str(err)) from err
    for qid in gates:
        qtype = (questions.get(qid) or {}).get("type")
        if qtype is None:
            raise WorkbenchError("The check gates %r, which is not one of the dataset's questions" % qid)
        if qtype not in policy.TYPES:
            raise WorkbenchError("The check gates %r, a %s question; gates read Choice, Noul, and Score" % (qid, qtype))
    signal = spec.get("signal", "confidence")
    if signal not in calibrate.SIGNALS:
        raise WorkbenchError("signal must be one of %s" % ", ".join(calibrate.SIGNALS))
    bound = spec.get("bound", "estimate")
    if bound not in calibrate.BOUNDS:
        raise WorkbenchError("bound must be one of %s" % ", ".join(calibrate.BOUNDS))
    model = spec.get("model")
    if model is not None and not isinstance(model, str):
        raise WorkbenchError("model must be a string")
    model = (model or "").strip()
    if not model or len(model) > MAX_MODEL_CHARS:
        raise WorkbenchError("Name the model the check asks, up to %d characters" % MAX_MODEL_CHARS)
    out = {"gates": gates, "signal": signal, "bound": bound, "model": model,
           "min_accuracy": _unit(spec.get("min_accuracy"), "min_accuracy", 0.5),
           "min_coverage": _unit(spec.get("min_coverage", 0), "min_coverage")}
    tuned_on = spec.get("tuned_on")
    if tuned_on is not None:  # checks saved before this field existed have none
        if not isinstance(tuned_on, str) or not is_versioned(tuned_on.strip()):
            raise WorkbenchError("tuned_on must be the versioned model id that answered the tuning run, such as jev-1.14.0")
        out["tuned_on"] = tuned_on.strip()
    return out


def run_notes(check: dict, answered_by: List[str]) -> List[str]:
    """What may make a run's answers differ from the ones the check was tuned on: a version other than the one
    it was tuned on, or an alias. Notes never change a check's status. Before a run, client.pin_note says it."""
    tuned_on = check.get("tuned_on")
    if not answered_by:
        return []
    if tuned_on and answered_by != [tuned_on]:
        return ["Answered by %s, but these thresholds were tuned on answers from %s. If the check passes, pin it "
                "to the new version: run the dataset in Bulk and save the check again." % (", ".join(answered_by), tuned_on)]
    if not is_versioned(check["model"]):
        return ["Asks %s, an alias; this run was answered by %s. To keep the check on that version, run the dataset "
                "in Bulk and save the check again." % (check["model"], ", ".join(answered_by))]
    return []


def save_check(dataset_id: str, spec: Any) -> dict:
    """Add or replace the check in a saved dataset; the rows, labels, and questions stay as they are."""
    dataset = workbench.load_dataset(dataset_id)
    check = validate_check(spec, dataset.get("questions"))
    check["saved_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    dataset["check"] = check
    workbench.write_dataset(dataset)
    return dataset


def remove_check(dataset_id: str) -> bool:
    dataset = workbench.load_dataset(dataset_id)
    if "check" not in dataset:
        return False
    del dataset["check"]
    workbench.write_dataset(dataset)
    return True


def listed() -> List[dict]:
    """Summaries of the saved datasets that hold a check."""
    return [d for d in workbench.list_datasets() if d.get("check")]


def _row_text(row: Any) -> str:
    if isinstance(row, dict) and set(row) == {"text"} and isinstance(row["text"], str):
        return row["text"]
    return row if isinstance(row, str) else json.dumps(row, ensure_ascii=False)


def evaluate(results: List[dict], check: dict, stopped: Optional[str] = None) -> dict:
    """Score one run's Bulk results (workbench.run_bulk's "results") against a validated check.

    status: "pass" when both targets hold; "fail" when one does not; "error" when the run cannot judge the
    check: some rows got no answer, or no row is labeled for every gated question."""
    gates = check["gates"]
    qids = list(gates)
    rows = [{"index": r["index"], "answers": {q: r["answers"][q] for q in qids if q in r["answers"]},
             "labels": {q: v for q, v in (r.get("expect") or {}).items() if q in gates}}
            for r in results if isinstance(r.get("answers"), dict)]
    missing = [r["index"] for r in results if not isinstance(r.get("answers"), dict)]
    errors = [{"index": r["index"], "error": r["error"]} for r in results if r.get("error")]
    reasons: List[str] = []
    rep: Optional[dict] = None
    if stopped:
        reasons.append("The run stopped early: %s" % stopped)
    if missing:
        reasons.append("%d of %d rows got no answer, so the check was not measured on every row. Run it again."
                       % (len(missing), len(results)))
    if rows:
        try:
            rep = policy.evaluate(rows, gates, check["signal"])
        except CalibrationError as err:
            reasons.append(str(err))
    if rep is not None and rep["skipped"]:
        reasons.append("%d of %d rows have no readable answer to a gated question, so the check was not measured "
                       "on every row. Run it again." % (rep["skipped"], len(results)))
    if rep is not None and not rep["labeled"]:
        reasons.append("No row is labeled for every gated question (%s), so accuracy is unknown." % ", ".join(qids))
    targets: Dict[str, dict] = {}
    if rep is not None and rep["labeled"]:
        bound = check["bound"]
        measured = rep["accuracy"] if bound == "estimate" else rep["accuracy_low"]
        accuracy_ok = calibrate.meets(rep["correct"], rep["automated"], check["min_accuracy"], bound)
        coverage_ok = rep["coverage"] + EPS >= check["min_coverage"]
        targets = {
            "accuracy": {"ok": accuracy_ok, "value": measured, "target": check["min_accuracy"], "bound": bound},
            "coverage": {"ok": coverage_ok, "value": rep["coverage"], "target": check["min_coverage"]},
        }
        if not rep["automated"]:
            reasons.append("The gate automated none of the %d labeled rows." % rep["labeled"])
        elif not accuracy_ok:
            reasons.append("Accuracy on automated rows is %s%s, below the %s target."
                           % (_pct(rep["accuracy"]), " (95%% lower bound %s)" % _pct(rep["accuracy_low"])
                              if bound == "lower" else "", _pct(check["min_accuracy"])))
        if not coverage_ok:
            reasons.append("It automated %s of labeled rows, below the %s minimum."
                           % (_pct(rep["coverage"]), _pct(check["min_coverage"])))
    if stopped or missing or not targets or rep["skipped"]:
        status = "error"
    else:
        status = "pass" if all(t["ok"] for t in targets.values()) else "fail"
    by_index = {r["index"]: r.get("row") for r in results}
    wrong = [r for r in (rep["rows"] if rep else []) if r["automated"] and not r["correct"]]
    mistakes = [{"index": r["index"], "row": _row_text(by_index.get(r["index"])),
                 "wrong": {q: r["answers"][q] for q in r["wrong"]}} for r in wrong[:MISTAKES_SHOWN]]
    out = {"status": status, "reasons": reasons, "targets": targets, "errors": errors[:MISTAKES_SHOWN],
           "rows": len(results), "answered": len(rows), "mistakes": mistakes, "mistakes_total": len(wrong)}
    if rep is not None:
        out.update({k: rep[k] for k in ("labeled", "unlabeled", "invalid", "skipped", "automated", "correct", "coverage",
                                        "accuracy", "accuracy_low", "accuracy_high", "routed", "routed_automated",
                                        "questions")})
    return out


def _pct(value: Optional[float]) -> str:
    return "n/a" if value is None else "%.1f%%" % (100 * value)


def run(client: JevClient, dataset_id: str, model: Optional[str] = None) -> dict:
    """Send every row of a saved dataset to the model and judge the dataset's check on the answers.
    model: ask this model instead of the one the check names, to see whether the gate holds on it."""
    dataset = workbench.load_dataset(dataset_id)
    if not isinstance(dataset.get("check"), dict):
        raise WorkbenchError("The dataset %r has no check. Save one from the Workbench's Policy panel." % dataset_id)
    check = validate_check(dataset["check"], dataset.get("questions"))
    asked = (model or "").strip() or check["model"]
    bulk = workbench.run_bulk(client, dataset["rows"], dataset["questions"], model=asked)
    done = [r for r in bulk["results"] if "answers" in r]
    latencies = [r["meta"]["latency_ms"] for r in done]
    report = evaluate(bulk["results"], check, bulk["stopped"])
    answered_by = sorted({r["meta"].get("model") for r in done if r["meta"].get("model")})
    report.update({
        "id": dataset_id, "name": dataset.get("name") or dataset_id, "check": check, "model": asked,
        "answered_by": answered_by, "notes": run_notes(check, answered_by),
        "cost_usd": bulk["cost_usd"], "input_tokens": bulk["input_tokens"], "wall_ms": bulk["wall_ms"],
        "latency_ms_median": statistics.median(latencies) if latencies else None,
    })
    return report
