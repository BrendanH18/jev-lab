#!/usr/bin/env python3
"""Run the checks saved in Workbench datasets against the live model, and fail when one misses its targets.

    uv run scripts/check.py                    # every dataset in data/workbench/datasets/ that holds a check
    uv run scripts/check.py support-tickets    # only these datasets, by id
    uv run scripts/check.py --model jev-1.14.0 # ask another model than the checks name
    uv run scripts/check.py --list             # show the checks, and any that ask a moving alias; no model calls
    uv run scripts/check.py support-tickets --drift new.jsonl  # do these unlabeled rows still look like the dataset?
    uv run scripts/check.py --upgrade-to jev-1.15.0  # can each check move to this version, and with which thresholds?

A check (jev/checks.py) gates some of a dataset's questions at fixed thresholds and names two targets: the
accuracy the automated rows must reach and the share of labeled rows that must be automated. This script
sends every row of each dataset to the model again, so it makes paid API calls (one per row), and nothing
from an earlier run is reused.

Exit status: 0 when every check passed, 1 when any failed, 2 when a check could not be judged (no key,
budget or rate limit reached, rows without answers, no labeled rows) or no check was found.

--drift FILE (jev/drift.py) runs one check's dataset and the rows in FILE, one per line as in the Workbench's Bulk
box, and compares them through the check's gate: the share automated, each question's answers and confidence,
and an estimated accuracy on the new rows, which need no labels. It makes one call per dataset row and one per
new row. Exit status: 0 when the new rows look like the dataset and the check passes on it, 1 when they differ
or the check fails, 2 when the runs could not be compared.

--upgrade-to MODEL (jev/upgrade.py) asks each check's dataset of the version the check was tuned on and of MODEL,
compares the two row by row, and tunes the gates again on MODEL's answers at the check's own targets. It makes two
calls per row and never changes a check: to move one, save it from the Workbench. Exit status: 0 when every check
can move (KEEP, with its saved thresholds, or RETUNE, with new ones), 1 when any should stay on its version (STAY),
2 when a comparison could not be judged.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import checks, drift, upgrade, workbench  # noqa: E402
from jev.client import JevClient, JevError  # noqa: E402

MISTAKES_PRINTED = 5


def pct(value) -> str:
    return "  n/a" if value is None else "%5.1f%%" % (100 * value)


def gates_text(check: dict) -> str:
    rules = len(check["rules"].splitlines()) if check.get("rules") else 0
    held = ", rows that break any of %d rule%s held" % (rules, "s" if rules > 1 else "") if rules else ""
    return ", ".join("%s>=%.2f" % (q, t) for q, t in check["gates"].items()) + held


def targets_text(check: dict) -> str:
    accuracy = "%s accurate%s" % (pct(check["min_accuracy"]).strip(), " at 95% confidence" if check["bound"] == "lower" else "")
    return "%s, at least %s automated" % (accuracy, pct(check["min_coverage"]).strip())


def print_list(summaries) -> None:
    for d in summaries:
        c = d["check"]
        tuned = "  tuned on %s" % c["tuned_on"] if c.get("tuned_on") and c["tuned_on"] != c.get("model") else ""
        print("%s  (%d rows, %d labeled)  model %s%s\n  gate: %s on %s\n  targets: %s" % (
            d["id"], d["rows"], d["labeled"], c.get("model"), tuned, gates_text(c), c.get("signal"), targets_text(c)))
        for note in d.get("check_notes", []):
            print("  note: " + note)


def print_report(rep: dict) -> None:
    c = rep["check"]
    answered = ", ".join(rep["answered_by"]) or "none"
    print("\n%s  (%d rows, %s labeled; asked %s, answered by %s)" % (
        rep["id"], rep["rows"], rep.get("labeled", 0), rep["model"], answered))
    print("  gate: %s on %s" % (gates_text(c), c["signal"]))
    t = rep["targets"]
    if t:
        acc, cov = t["accuracy"], t["coverage"]
        lower = c["bound"] == "lower"
        interval = "" if rep["accuracy_low"] is None else "  [%s-%s]" % (pct(rep["accuracy_low"]).strip(),
                                                                          pct(rep["accuracy_high"]).strip())
        print("  accuracy   %s%-16s target %s%s  %s" % (pct(rep["accuracy"]), interval, pct(acc["target"]).strip(),
                                                        " (95% lower bound)" if lower else "", "ok" if acc["ok"] else "FAIL"))
        print("  automated  %s  %d of %d    min %s  %s" % (pct(rep["coverage"]), rep["automated"], rep["labeled"],
                                                         pct(cov["target"]).strip(), "ok" if cov["ok"] else "FAIL"))
    latency = rep["latency_ms_median"]
    print("  cost $%.5f · %d input tokens · median latency %s" % (
        rep["cost_usd"], rep["input_tokens"], "n/a" if latency is None else "%.0f ms" % latency))
    for reason in rep["reasons"]:
        print("  - " + reason)
    for note in rep.get("notes", []):
        print("  note: " + note)
    for m in rep["mistakes"][:MISTAKES_PRINTED]:
        wrong = "; ".join("%s answered %s, label %s (%.2f)" % (q, a["answer"], a["label"], a["signal"]) for q, a in m["wrong"].items())
        row = m["row"] if len(m["row"]) <= 70 else m["row"][:67] + "..."
        print("  wrong but automated, row %d: %s\n      %s" % (m["index"] + 1, row, wrong))
    if rep["mistakes_total"] > MISTAKES_PRINTED:
        print("  ...and %d more automated rows with a wrong answer" % (rep["mistakes_total"] - MISTAKES_PRINTED))
    print("  %s" % rep["status"].upper())


def p_text(value) -> str:
    return "  n/a" if value is None else ("<0.001" if value < 0.001 else "%6.3f" % value)


def share_text(side: dict) -> str:
    return "%s  %d of %d" % (pct(side["share"]), side["automated"], side["routed"])


def print_drift(rep: dict) -> None:
    c = rep["check"]
    ref, new = rep["reference"], rep["new"]
    answered = ", ".join(rep["answered_by"]) or "none"
    print("\n%s  (%d dataset rows, %d new rows; asked %s, answered by %s)" % (
        rep["id"], ref["rows"], new["rows"], rep["model"], answered))
    print("  gate: %s on %s" % (gates_text(c), c["signal"]))
    print("  the check on the dataset rows: %s" % rep["check_status"].upper())
    print("                      dataset          new rows         adjusted p")
    a = rep["automation"]
    print("  automated   %-17s %-16s %s%s" % (share_text(ref), share_text(new), p_text(a["p_adjusted"]),
                                              "  SHIFT" if a["shifted"] else ""))
    e = rep["estimate"]
    if ref["accuracy"] is not None:
        interval = "" if e["low"] is None else "  [%s-%s]" % (pct(e["low"]).strip(), pct(e["high"]).strip())
        print("  accuracy    %s on the dataset, estimated %s on new rows%s" % (
            pct(ref["accuracy"]).strip(), pct(e["accuracy"]).strip(), interval))
    for q in rep["questions"]:
        s = q["signal"]
        flags = [w for w, on in (("MIX", q["mix_shifted"]), ("SIGNAL", s["shifted"])) if on]
        moved = sorted(q["mix"], key=lambda m: -abs((m["new_share"] or 0) - (m["reference_share"] or 0)))[:3]
        mix = ", ".join("%s %s->%s" % (m["answer"], pct(m["reference_share"]).strip(), pct(m["new_share"]).strip())
                        for m in moved)
        median = ("median %.2f->%.2f" % (s["reference"]["median"], s["new"]["median"])
                  if s["reference"]["median"] is not None and s["new"]["median"] is not None else "")
        print("  %s%s  mix p %s  signal p %s  %s; %s%s" % (q["qid"], " (gated)" if q["gated"] else "",
                                                       p_text(q["mix_p_adjusted"]).strip(),
                                                       p_text(s["p_adjusted"]).strip(), mix, median,
                                                       "  " + " ".join(flags) if flags else ""))
    print("  cost $%.5f · %d calls · %d input tokens" % (rep["cost_usd"], rep["calls"], rep["input_tokens"]))
    for reason in rep["check_reasons"]:
        print("  - check: " + reason)
    for reason in rep["reasons"]:
        print("  - " + reason)
    for note in rep.get("notes", []):
        print("  note: " + note)
    for t in rep["thin"][:MISTAKES_PRINTED]:
        row = t["row"] if len(t["row"]) <= 70 else t["row"][:67] + "..."
        print("  worth labeling, new row %d (%s): %s" % (t["index"] + 1, t["answers"], row))
    print("  %s" % rep["status"].upper())


def side_text(side: dict, sums: dict) -> str:
    if not sums.get("targets"):
        return "%s, not judged" % sums["status"].upper()
    return "%s  accuracy %s, %s automated" % (sums["status"].upper(), pct(sums["accuracy"]).strip(), pct(sums["coverage"]).strip())


def print_upgrade(rep: dict) -> None:
    c, s = rep["check"], rep["sides"]
    print("\n%s  (%d rows; %s, answered by %s -> %s, answered by %s)" % (
        rep["id"], s["current"]["rows"], s["current"]["model"], ", ".join(s["current"]["answered_by"]) or "none",
        s["candidate"]["model"], ", ".join(s["candidate"]["answered_by"]) or "none"))
    print("  gate: %s on %s; targets: %s" % (gates_text(c), c["signal"], targets_text(c)))
    print("  saved gate, tuned-on version:  %s" % side_text(s["current"], rep["current"]))
    print("  saved gate, candidate:         %s" % side_text(s["candidate"], rep["candidate"]))
    t = rep["retuned"]
    if t["gates"] is not None:
        print("  retuned gate: %s  %s" % (", ".join("%s>=%.2f" % kv for kv in t["gates"].items()),
                                         side_text(s["candidate"], t["report"])))
        u = t["unseen"]
        if u:
            print("    on unseen rows (%d-fold): accuracy %s, %s automated" % (
                u["folds"], pct(u["accuracy"]).strip(), pct(u["coverage"]).strip()))
    elif t["problem"]:
        print("  retuned gate: %s" % t["problem"])
    else:
        print("  retuned gate: no thresholds reach %s on the candidate's answers" % pct(c["min_accuracy"]).strip())
    p = rep["paired"]
    if p["rows"]:
        print("  every gated answer right, %d labeled rows: %s -> %s  (only tuned-on %d, only candidate %d, McNemar p %s)" % (
            p["rows"], pct(p["current"]["accuracy"]).strip(), pct(p["candidate"]["accuracy"]).strip(),
            p["current_only"], p["candidate_only"], p_text(p["p"]).strip()))
    for q in rep["changed"]["questions"]:
        if q["rows"]:
            print("  %s changed its answer on %d of %d rows" % (q["qid"], q["changed"], q["rows"]))
    print("  cost $%.5f · %d calls · %d input tokens" % (rep["cost_usd"], rep["calls"], rep["input_tokens"]))
    for reason in rep["reasons"]:
        print("  - " + reason)
    for note in rep["notes"]:
        print("  note: " + note)
    print("  %s" % rep["verdict"].upper())


def run_upgrade(args, ids) -> int:
    client = JevClient()
    if not client.configured:
        print("No API key. Set TYPESAFE_API_KEY or add it to .env.")
        return 2
    print("%d check%s, two calls per row, via %s" % (len(ids), "" if len(ids) == 1 else "s", client.backend))
    started = time.perf_counter()
    reports = []
    try:
        for dataset_id in ids:
            try:
                rep = upgrade.run(client, dataset_id, args.upgrade_to)
            except workbench.WorkbenchError as err:
                rep = {"id": dataset_id, "verdict": "error", "reasons": [str(err)]}
                print("\n%s\n  - %s\n  ERROR" % (dataset_id, err))
            else:
                print_upgrade(rep)
            reports.append(rep)
    except JevError as err:
        print("\nStopped: %s" % err)
        reports.append({"verdict": "error", "reasons": [str(err)]})
    finally:
        s = client.guard.snapshot()
        print("\n%d live calls · %d input tokens · $%.5f · %.1f s" % (
            s["live_calls"], s["input_tokens"], s["spent_usd"], time.perf_counter() - started))
        if args.out:
            Path(args.out).write_text(json.dumps(reports, indent=1, default=str))
    verdicts = [r["verdict"] for r in reports]
    if "error" in verdicts:
        return 2
    return 1 if "stay" in verdicts else 0


def run_drift(args, with_checks: dict) -> int:
    ids = args.ids or sorted(with_checks)
    if len(ids) != 1:
        print("--drift compares new rows with one dataset. Name it: %s" % ", ".join(sorted(with_checks)))
        return 2
    try:
        text = Path(args.drift).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as err:
        print("Cannot read %s: %s" % (args.drift, err))
        return 2
    try:
        rows = drift.new_rows(text)
    except workbench.WorkbenchError as err:
        print(str(err))
        return 2
    client = JevClient()
    if not client.configured:
        print("No API key. Set TYPESAFE_API_KEY or add it to .env.")
        return 2
    dataset_id = ids[0]
    print("%s: %d dataset rows and %d new rows, one call per row, via %s" % (
        dataset_id, with_checks[dataset_id]["rows"], len(rows), client.backend))
    started = time.perf_counter()
    rep = None
    try:
        rep = drift.run(client, dataset_id, rows, args.model)
        print_drift(rep)
    except (workbench.WorkbenchError, JevError) as err:
        print("\nStopped: %s" % err)
    finally:
        s = client.guard.snapshot()
        print("\n%d live calls · %d input tokens · $%.5f · %.1f s" % (
            s["live_calls"], s["input_tokens"], s["spent_usd"], time.perf_counter() - started))
        if args.out and rep is not None:
            Path(args.out).write_text(json.dumps(rep, indent=1, default=str))
    if rep is None or rep["status"] == "error" or rep["check_status"] == "error":
        return 2
    return 1 if rep["status"] == "shift" or rep["check_status"] == "fail" else 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run the checks saved in Workbench datasets against the live model.")
    parser.add_argument("ids", nargs="*", help="dataset ids to check (default: every dataset with a check)")
    parser.add_argument("--model", help="ask this model instead of the one each check names")
    parser.add_argument("--list", action="store_true", help="list the checks and exit, without model calls")
    parser.add_argument("--out", help="write the reports as JSON here (they include rows and answers)")
    parser.add_argument("--drift", metavar="FILE", help="compare the unlabeled rows in FILE with one check's dataset")
    parser.add_argument("--upgrade-to", metavar="MODEL",
                        help="ask each check's tuned-on version and MODEL every row, and say whether the check can move")
    args = parser.parse_args(argv)

    with_checks = {d["id"]: d for d in checks.listed()}
    ids = args.ids or sorted(with_checks)
    unknown = [i for i in ids if i not in with_checks]
    if unknown:
        print("No check saved in: %s. Datasets with a check: %s" % (", ".join(unknown), ", ".join(sorted(with_checks)) or "none"))
        return 2
    if not ids:
        print("No dataset in data/workbench/datasets/ holds a check. Save one from the Workbench's Policy panel.")
        return 2
    if args.list:
        print_list(with_checks[i] for i in ids)
        return 0
    if args.drift is not None and args.upgrade_to is not None:
        print("--drift and --upgrade-to each run the dataset again; run them one at a time.")
        return 2
    if args.upgrade_to is not None:
        return run_upgrade(args, ids)
    if args.drift is not None:  # an empty path is an error, not a request for the ordinary check
        return run_drift(args, with_checks)

    client = JevClient()
    if not client.configured:
        print("No API key. Set TYPESAFE_API_KEY or add it to .env.")
        return 2
    rows = sum(with_checks[i]["rows"] for i in ids)
    print("%d check%s, %d rows, one call per row, via %s" % (len(ids), "" if len(ids) == 1 else "s", rows, client.backend))
    started = time.perf_counter()
    reports = []
    try:
        for dataset_id in ids:
            try:
                rep = checks.run(client, dataset_id, args.model)
            except workbench.WorkbenchError as err:
                rep = {"id": dataset_id, "status": "error", "reasons": [str(err)]}
                print("\n%s\n  - %s\n  ERROR" % (dataset_id, err))
            else:
                print_report(rep)
            reports.append(rep)
    except JevError as err:
        print("\nStopped: %s" % err)
        reports.append({"status": "error", "reasons": [str(err)]})
    finally:
        s = client.guard.snapshot()
        print("\n%d live calls · %d input tokens · $%.5f · %.1f s" % (
            s["live_calls"], s["input_tokens"], s["spent_usd"], time.perf_counter() - started))
        if args.out:
            Path(args.out).write_text(json.dumps(reports, indent=1, default=str))
    statuses = [r["status"] for r in reports]
    passed = statuses.count("pass")
    print("%d of %d checks passed" % (passed, len(ids)))
    if "error" in statuses:
        return 2
    return 1 if "fail" in statuses else 0


if __name__ == "__main__":
    sys.exit(main())
