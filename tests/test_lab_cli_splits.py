"""Tests for the cli-splits Lab pack (jev/lab/packs/cli_splits.py): offline previews of test splits and folds.
Fictional Harbor Coffee Co. data only."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import testsplit, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_splits  # noqa: E402

TEAM = {"team": {"type": "choice", "instructions": "Which team handles it?", "criteria": {"billing": "Money", "shipping": "Parcels"}},
        "urgent": {"type": "noul", "instructions": "Is it urgent?"}}


def ticket(i, team="billing", **labels):
    return {"text": "Harbor ticket %d" % i, "_expect": dict({"team": team}, **labels)}


PLAN_ROWS = [ticket(i) for i in range(1, 11)] + ["Grinder squeals"]
COPY_ROWS = [ticket(i) for i in range(1, 11)] + [{"text": "Harbor ticket 1"}]
FOLD_ROWS = ([ticket(1, urgent=True), ticket(2, urgent=False), ticket(3, "shipping", urgent=True), ticket(4, "shipping", urgent=False),
              ticket(5), ticket(6, "shipping"), ticket(1), {"text": "Held secret", "_test": True, "_expect": {"team": "billing"}},
              "Grinder squeals", {"text": "Bad label", "_expect": {"team": "refunds"}}])
LOOKS = [{"at": "2026-10-01T09:00:00Z", "gates": {"team": 0.8}, "signal": "confidence", "model": "jev-1.14.0"},
         {"at": "2026-10-20T15:30:00Z", "gates": {"team": 0.85, "urgent": 0.7}, "signal": "confidence"}]


def save(directory):
    workbench.save_dataset({"name": "Plan me", "questions": TEAM, "rows": PLAN_ROWS})
    workbench.save_dataset({"name": "Copies", "questions": TEAM, "rows": COPY_ROWS})
    workbench.save_dataset({"name": "Folds", "questions": TEAM, "rows": FOLD_ROWS})
    dataset = workbench.load_dataset("folds")
    dataset["test"]["looks"] = LOOKS
    workbench.write_dataset(dataset)


def locked_rows(seed):
    """Row numbers testsplit.lock itself holds out of `copies` with this seed, in a separate data directory."""
    previous = workbench.WORKBENCH_DIR
    with tempfile.TemporaryDirectory() as directory:
        workbench.WORKBENCH_DIR = Path(directory)
        try:
            workbench.save_dataset({"name": "Copies", "questions": TEAM, "rows": COPY_ROWS})
            return [i + 1 for i in testsplit.test_indexes(testsplit.lock("copies", 0.25, seed=seed))]
        finally:
            workbench.WORKBENCH_DIR = previous


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


def plan_table(labeled, share, held, groups, rows):
    return table(["fact", "value"], [["labeled rows", labeled], ["requested share", share], ["held out labeled rows", held],
                                     ["actual share", held / labeled], ["tuning labeled rows", labeled - held],
                                     ["input groups held out", groups], ["rows held out", rows]])


def seeded_json(text):
    rows = locked_rows(7)
    # Ten labeled rows at 0.25: 2.5 ties between 2 and 3, and ties round up, so 3 labeled rows in 3 groups; the
    # unlabeled copy of ticket 1 (row 11) goes with its group when that group is drawn.
    expected = {"dataset": "copies", "labeled_rows": 10, "requested_share": 0.25, "held_out_labeled_rows": 3, "actual_share": 0.3,
                "tuning_labeled_rows": 7, "input_groups_held_out": 3, "rows_held_out": len(rows)}
    if json.loads(text) != expected or len(rows) != (4 if 1 in rows else 3):
        raise AssertionError("got %s, expected %s from lock's rows %s" % (text, expected, rows))


def seeded_rows(text):
    expected = "held-out rows: %s" % ", ".join(map(str, locked_rows(7)))
    if text.splitlines()[-1] != expected:
        raise AssertionError("%r != %r" % (text.splitlines()[-1], expected))


FOLDS = ["fold", "labeled rows", "distinct inputs"]
SHARES = ["requested share", "labeled rows held out", "actual share", "tuning labeled rows"]
SHARE_ROWS = [[0.1, 2, 0.2, 8], [0.15, 2, 0.2, 8], [0.2, 2, 0.2, 8], [0.25, 3, 0.3, 7], [0.3, 3, 0.3, 7], [0.35, 4, 0.4, 6],
              [0.4, 4, 0.4, 6], [0.45, 5, 0.5, 5], [0.5, 5, 0.5, 5]]
LOOK = ["look", "at", "model", "signal", "gates"]
L1, L2 = [1, "2026-10-01T09:00:00Z", "jev-1.14.0", "confidence", "team 0.8"], [2, "2026-10-20T15:30:00Z", None, "confidence", "team 0.85, urgent 0.7"]

CASES = {
    "plan": {"argv": ["splits", "plan", "plan-me"], "setup": save,
             "stdout": "test split plan for plan-me (nothing written)\n" + plan_table(10, 0.25, 3, 3, 3),
             "options": {
                 "share": {"argv": ["splits", "plan", "plan-me", "--share", "0.5"], "setup": save,
                           "stdout": "test split plan for plan-me (nothing written)\n" + plan_table(10, 0.5, 5, 5, 5)},
                 "seed": {"argv": ["splits", "plan", "copies", "--seed", "7", "--json"], "setup": save, "stdout": seeded_json},
                 "rows": {"argv": ["splits", "plan", "copies", "--seed", "7", "--rows"], "setup": save, "stdout": seeded_rows},
                 "json": {"argv": ["splits", "plan", "plan-me", "--json"], "setup": save,
                          "stdout": same_json({"dataset": "plan-me", "labeled_rows": 10, "requested_share": 0.25, "held_out_labeled_rows": 3,
                                               "actual_share": 0.3, "tuning_labeled_rows": 7, "input_groups_held_out": 3, "rows_held_out": 3})}}},
    # Ten singleton labeled rows: counts from 2 to 8 are reachable; the closest to share * 10 wins, ties rounding up.
    "shares": {"argv": ["splits", "shares", "plan-me"], "setup": save, "stdout": table(SHARES, SHARE_ROWS),
               "options": {"format": {"argv": ["splits", "shares", "plan-me", "--format", "csv"], "setup": save,
                                      "stdout": kit.render(SHARES, SHARE_ROWS, "csv") + "\n"}}},
    # Seven valid labeled tuning rows (ticket 1 twice) from six inputs: five folds need ten rows.
    "folds": {"argv": ["splits", "folds", "folds"], "setup": save, "code": 1,
              "stdout": "cannot cross-validate with 5 folds: Needs at least 10 valid labeled rows to hold some out (7 labeled).\n",
              "options": {
                  # The pair goes first to fold 1, then single rows to the least filled fold: 3, 2 and 2 rows.
                  "folds": {"argv": ["splits", "folds", "folds", "--folds", "3"], "setup": save,
                            "stdout": table(FOLDS, [[1, 3, 2], [2, 2, 2], [3, 2, 2]])},
                  "question": {"argv": ["splits", "folds", "folds", "--folds", "2", "--question", "urgent"], "setup": save,
                               "stdout": table(FOLDS, [[1, 2, 2], [2, 2, 2]])},
                  "format": {"argv": ["splits", "folds", "folds", "--folds", "2", "--question", "urgent", "--format", "json"], "setup": save,
                             "stdout": same_json([dict(zip(FOLDS, [1, 2, 2])), dict(zip(FOLDS, [2, 2, 2]))])}}},
    "looks": {"argv": ["splits", "looks", "folds"], "setup": save, "stdout": table(LOOK, [L1, L2]),
              "options": {
                  "since": {"argv": ["splits", "looks", "folds", "--since", "2026-10-10"], "setup": save, "stdout": table(LOOK, [L2])},
                  "format": {"argv": ["splits", "looks", "folds", "--format", "csv"], "setup": save, "stdout": kit.render(LOOK, [L1, L2], "csv") + "\n"}}},
}


class CliSplitsTests(pack_tests(cli_splits.PACK, CASES)):
    def test_plan_never_writes(self):
        import io
        from contextlib import redirect_stdout
        from labkit import lab_cli
        previous = workbench.WORKBENCH_DIR
        with tempfile.TemporaryDirectory() as directory:
            workbench.WORKBENCH_DIR = Path(directory)
            try:
                save(Path(directory))
            finally:
                workbench.WORKBENCH_DIR = previous
            before = {path: path.read_bytes() for path in Path(directory).rglob("*") if path.is_file()}
            with redirect_stdout(io.StringIO()):
                self.assertEqual(lab_cli.main(["--data-dir", directory, "splits", "plan", "plan-me", "--seed", "3", "--rows"]), 0)
            after = {path: path.read_bytes() for path in Path(directory).rglob("*") if path.is_file()}
        self.assertEqual(before, after)

    def test_usage_errors_exit_two(self):
        for argv in (["splits", "plan", "folds"], ["splits", "plan", "plan-me", "--share", "0.6"], ["splits", "folds", "folds", "--folds", "11"],
                     ["splits", "folds", "folds", "--question", "nope"]):
            self.assertEqual(run_cli(argv, save)[0], 2, argv)

    def test_held_out_rows_never_shown(self):
        for argv in (["splits", "looks", "folds", "--format", "json"], ["splits", "folds", "folds", "--folds", "3"]):
            self.assertNotIn("Held secret", run_cli(argv, save)[1])

    def test_matches_lock_for_many_seeds(self):
        def check(seed):
            def setup(directory):
                save(directory)
            code, out, _err = run_cli(["splits", "plan", "copies", "--seed", str(seed), "--json", "--rows"], setup)
            self.assertEqual(json.loads(out)["held_out_row_numbers"], locked_rows(seed))
        for seed in range(6):
            check(seed)
