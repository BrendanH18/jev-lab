"""Offline previews of how a dataset's rows would be split (`lab.py splits ...`), without writing anything.

A test split (jev/testsplit.py) holds whole exact-input groups out of tuning, choosing the feasible count of labeled
rows closest to a requested share. Cross-validation (jev/holdout.py) deals labeled tuning rows into folds, keeping
exact-input groups together. These commands preview both before anything is locked or tuned: the split a share and a
seed would draw (in counts, or row numbers with --rows), the folds labeled tuning rows would fall into, and the
looks already recorded at a dataset's held-out rows (when, which gates and model; never a result).

Held-out rows are counted, never shown with an input or a label. Nothing calls the model or writes a file.
"""

from __future__ import annotations

import json
from typing import Any, List, Optional, Tuple

from jev import decisions, holdout, testsplit, workbench
from jev.lab import kit
from jev.lab.packs import cli_gates

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
LABEL_TYPES = ("choice", "noul", "score")


# ---------- splits plan ----------


def _configure_plan(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset without a test split")
    parser.add_argument(
        "--share",
        type=float,
        default=testsplit.DEFAULT_SHARE,
        metavar="X",
        help="the share of labeled rows to hold out, from %g to %g (default %g)"
        % (testsplit.MIN_SHARE, testsplit.MAX_SHARE, testsplit.DEFAULT_SHARE),
    )
    parser.add_argument(
        "--seed", type=int, metavar="N", help="draw with this seed, the split lock() draws with the same seed"
    )
    parser.add_argument("--rows", action="store_true", help="also list the row numbers the draw would hold out")
    parser.add_argument("--json", action="store_true", help="print the plan as one JSON object")


def plan(dataset: dict, share: float, seed: Optional[int]) -> Tuple[List[int], List[List[int]]]:
    """(positions of labeled rows, the exact-input groups to hold out): testsplit.choose, the draw lock() makes."""
    return testsplit.choose(dataset, share, seed)


def run_plan(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    labeled, chosen = plan(dataset, args.share, args.seed)
    held = sorted(i for positions in chosen for i in positions)
    held_labeled = sum(testsplit._labeled(dataset["rows"][i]) for i in held)
    facts = {
        "dataset": dataset["id"],
        "labeled_rows": len(labeled),
        "requested_share": args.share,
        "held_out_labeled_rows": held_labeled,
        "actual_share": round(held_labeled / len(labeled), 6),
        "tuning_labeled_rows": len(labeled) - held_labeled,
        "input_groups_held_out": len(chosen),
        "rows_held_out": len(held),
    }
    if args.rows:
        facts["held_out_row_numbers"] = [i + 1 for i in held]
    if args.json:
        print(json.dumps(facts, ensure_ascii=False))
        return 0
    rows = [
        [key.replace("_", " "), value] for key, value in facts.items() if key not in ("dataset", "held_out_row_numbers")
    ]
    print("test split plan for %s (nothing written)" % dataset["id"])
    kit.emit(args, ["fact", "value"], rows)
    if args.rows:
        print("held-out rows: %s" % ", ".join(str(n) for n in facts["held_out_row_numbers"]))
    return 0


# ---------- splits shares ----------


SHARES = (0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5)


def _configure_shares(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset without a test split")
    kit.add_format(parser)


def run_shares(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    rows = []
    for share in SHARES:
        # Which counts a split can reach does not depend on the draw, so a fixed seed gives every draw's count.
        labeled, chosen = plan(dataset, share, 0)
        held = sum(testsplit._labeled(dataset["rows"][i]) for positions in chosen for i in positions)
        rows.append([share, held, round(held / len(labeled), 6), len(labeled) - held])
    kit.emit(args, ["requested share", "labeled rows held out", "actual share", "tuning labeled rows"], rows)
    return 0


# ---------- splits folds ----------


def _configure_folds(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument(
        "--folds",
        type=int,
        default=holdout.FOLDS,
        metavar="K",
        help="the number of folds, from %d to %d (default %d)" % (holdout.MIN_FOLDS, holdout.MAX_FOLDS, holdout.FOLDS),
    )
    parser.add_argument(
        "--question", metavar="ID", help="only rows with a valid label for this question (default: any question)"
    )
    kit.add_format(parser)


def _valid(question: dict, value: Any) -> bool:
    ok, label = decisions.label(question, value)
    return ok and label is not None


def run_folds(args: Any) -> int:
    if not holdout.MIN_FOLDS <= args.folds <= holdout.MAX_FOLDS:
        raise kit.CliError("--folds must be a whole number from %d to %d" % (holdout.MIN_FOLDS, holdout.MAX_FOLDS))
    dataset = workbench.load_dataset(args.dataset)
    raw = dataset.get("questions") if isinstance(dataset.get("questions"), dict) else {}
    questions = {qid: q for qid, q in raw.items() if isinstance(q, dict) and q.get("type") in LABEL_TYPES}
    if args.question:
        if args.question not in questions:
            raise kit.CliError(
                "%s is not a Choice, Noul or Score question of dataset %r" % (args.question, dataset["id"])
            )
        questions = {args.question: questions[args.question]}
    keys = []
    for row in workbench.tuning_rows(dataset):
        labels = row.get(workbench.LABEL_KEY) if isinstance(row, dict) else None
        if isinstance(labels, dict) and any(qid in labels and _valid(q, labels[qid]) for qid, q in questions.items()):
            keys.append(decisions._key(row))
    problem = holdout.problem(keys, args.folds)
    if problem:
        print("cannot cross-validate with %d folds: %s" % (args.folds, problem))
        return 1
    folds = holdout.assign(keys, list(range(len(keys))), args.folds)
    rows = [
        [fold + 1, sum(f == fold for f in folds), len({key for key, f in zip(keys, folds) if f == fold})]
        for fold in range(args.folds)
    ]
    kit.emit(args, ["fold", "labeled rows", "distinct inputs"], rows)
    return 0


# ---------- splits looks ----------


def _configure_looks(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset with a test split")
    parser.add_argument("--since", metavar="DATE", help="only looks at or after this ISO date or time")
    kit.add_format(parser)


def run_looks(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    test = dataset.get("test") if isinstance(dataset.get("test"), dict) else {}
    rows = []
    for number, look in enumerate(test.get("looks") or [], 1):
        if not isinstance(look, dict):
            continue
        at = str(look.get("at") or "")
        if args.since and at < args.since:
            continue
        gates = look.get("gates") if isinstance(look.get("gates"), dict) else {}
        rows.append(
            [
                number,
                at,
                look.get("model"),
                look.get("signal"),
                ", ".join("%s %s" % (qid, kit.cell_text(value)) for qid, value in gates.items()),
            ]
        )
    cli_gates._table_or(
        args,
        ["look", "at", "model", "signal", "gates"],
        rows,
        "no looks at the held-out rows%s" % (" since %s" % args.since if args.since else ""),
    )
    return 0


PACK = kit.define_pack(
    {
        "id": "cli-splits",
        "surface": "python.cli",
        "title": "Split previews",
        "about": "Offline `lab.py splits` commands that preview a test split before it is locked (counts, or row numbers "
        "for a seed), the cross-validation folds labeled tuning rows fall into, and the looks recorded at a "
        "dataset's held-out rows. Nothing is written, and held-out rows are only counted.",
        "features": [
            {
                "id": "plan",
                "kind": "cli",
                "command": ["splits", "plan"],
                "configure": _configure_plan,
                "run": run_plan,
                "title": "Preview the test split a share would draw, without writing it: labeled rows held out, actual share, groups and rows",
                "options": [
                    {"id": "share", "title": "--share X previews another share of labeled rows, from 0.1 to 0.5"},
                    {
                        "id": "seed",
                        "title": "--seed N draws with a seed, the same split the Workbench would lock with it",
                    },
                    {"id": "rows", "title": "--rows lists the row numbers the draw would hold out"},
                    {"id": "json", "title": "--json prints the plan as one JSON object"},
                ],
            },
            {
                "id": "shares",
                "kind": "cli",
                "command": ["splits", "shares"],
                "configure": _configure_shares,
                "run": run_shares,
                "title": "Show, for each share from 0.1 to 0.5, how many labeled rows a test split would hold out and the share it would reach",
                "options": [dict(FORMAT)],
            },
            {
                "id": "folds",
                "kind": "cli",
                "command": ["splits", "folds"],
                "configure": _configure_folds,
                "run": run_folds,
                "title": "Preview the cross-validation folds of labeled tuning rows, exact copies kept together; exit 1 when the rows cannot fill them",
                "options": [
                    {"id": "folds", "title": "--folds K previews K folds, from 2 to 10"},
                    {"id": "question", "title": "--question ID counts only rows with a valid label for one question"},
                    dict(FORMAT),
                ],
            },
            {
                "id": "looks",
                "kind": "cli",
                "command": ["splits", "looks"],
                "configure": _configure_looks,
                "run": run_looks,
                "title": "List the recorded looks at a dataset's held-out rows: when, which model and signal, and which gates; never a result",
                "options": [{"id": "since", "title": "--since DATE keeps the looks at or after a date"}, dict(FORMAT)],
            },
        ],
    }
)
