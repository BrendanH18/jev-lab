#!/usr/bin/env python3
"""Run the checks saved in Workbench datasets against the live model, and fail when one misses its targets.

    uv run scripts/check.py                    # every dataset in data/workbench/datasets/ that holds a check
    uv run scripts/check.py support-tickets    # only these datasets, by id
    uv run scripts/check.py --model jev-1.14.0 # ask another model than the checks name
    uv run scripts/check.py --list             # show the checks; no model calls

A check (jev/checks.py) gates some of a dataset's questions at fixed thresholds and names two targets: the
accuracy the automated rows must reach and the share of labeled rows that must be automated. This script
sends every row of each dataset to the model again, so it makes paid API calls (one per row), and nothing
from an earlier run is reused.

Exit status: 0 when every check passed, 1 when any failed, 2 when a check could not be judged (no key,
budget or rate limit reached, rows without answers, no labeled rows) or no check was found.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import checks, workbench  # noqa: E402
from jev.client import JevClient, JevError  # noqa: E402

MISTAKES_PRINTED = 5


def pct(value) -> str:
    return "  n/a" if value is None else "%5.1f%%" % (100 * value)


def gates_text(check: dict) -> str:
    return ", ".join("%s>=%.2f" % (q, t) for q, t in check["gates"].items())


def targets_text(check: dict) -> str:
    accuracy = "%s accurate%s" % (pct(check["min_accuracy"]).strip(), " at 95% confidence" if check["bound"] == "lower" else "")
    return "%s, at least %s automated" % (accuracy, pct(check["min_coverage"]).strip())


def print_list(summaries) -> None:
    for d in summaries:
        c = d["check"]
        print("%s  (%d rows, %d labeled)  model %s\n  gate: %s on %s\n  targets: %s" % (
            d["id"], d["rows"], d["labeled"], c.get("model"), gates_text(c), c.get("signal"), targets_text(c)))


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
    for m in rep["mistakes"][:MISTAKES_PRINTED]:
        wrong = "; ".join("%s answered %s, label %s (%.2f)" % (q, a["answer"], a["label"], a["signal"]) for q, a in m["wrong"].items())
        row = m["row"] if len(m["row"]) <= 70 else m["row"][:67] + "..."
        print("  wrong but automated, row %d: %s\n      %s" % (m["index"] + 1, row, wrong))
    if rep["mistakes_total"] > MISTAKES_PRINTED:
        print("  ...and %d more automated rows with a wrong answer" % (rep["mistakes_total"] - MISTAKES_PRINTED))
    print("  %s" % rep["status"].upper())


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Run the checks saved in Workbench datasets against the live model.")
    parser.add_argument("ids", nargs="*", help="dataset ids to check (default: every dataset with a check)")
    parser.add_argument("--model", help="ask this model instead of the one each check names")
    parser.add_argument("--list", action="store_true", help="list the checks and exit, without model calls")
    parser.add_argument("--out", help="write the reports as JSON here (they include rows and answers)")
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
