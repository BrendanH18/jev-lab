"""Spend previews (jev/estimate.py): call counts, test-row exclusion, pictures, the budget, and no network.
No key, no network: each real run below goes through a JevClient whose transport is replaced, so the reserves its
guard holds can be compared with the preview."""

import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import check as check_script  # noqa: E402

from helpers import fake_answers  # noqa: E402
from jev import checks, drift, estimate, images, upgrade, workbench  # noqa: E402
from jev.client import JevClient, SpendGuard, price_per_input_token, request_reserve_usd  # noqa: E402
from jev.config import Settings  # noqa: E402
from jev.workbench import WorkbenchError  # noqa: E402

Q = {
    "dept": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "money", "tech": "bugs", "other": None}},
    "refund": {"type": "noul", "instructions": "Does the sender want money back?"},
}
SPEC = {"gates": {"refund": 0.6}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
        "tuned_on": "jev-1.14.0", "min_accuracy": 0.9, "min_coverage": 0.1}


class Recorder:
    """A real JevClient with a fake transport. `reserves` holds what each call held against the guard."""

    def __init__(self, folder: Path, budget: float = 100.0):
        settings = Settings(environ={"TYPESAFE_DEFAULT_MODEL": "jev-1.14.0"}, env_file=folder / "absent.env")
        self.client = JevClient(settings, guard=SpendGuard(budget, rpm=0), api_key="synthetic-key")
        self.reserves = []
        check = self.client.guard.check

        def held(reserve_usd=0.0):
            self.reserves.append(reserve_usd)
            check(reserve_usd)

        def post(payload):
            return {"model": payload["model"], "answers": fake_answers(payload["questions"]),
                    "usage": {"input_tokens": 1}}

        self.client.guard.check = held
        self.client._post_system_one = post


def rows_text(rows):
    return "\n".join(json.dumps(r) for r in rows)


class EstimateTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir
        rows = [{"text": ("refund %d" if i % 2 else "thanks %d") % i, "_expect": {"refund": bool(i % 2)}}
                for i in range(12)]
        for row in rows[:3]:
            row["_test"] = True
        workbench.save_dataset({"name": "Tickets", "rows": rows_text(rows), "questions": Q})
        checks.save_check("tickets", SPEC)

    def tearDown(self):
        workbench.WORKBENCH_DIR = self._orig
        shutil.rmtree(self.dir, ignore_errors=True)

    def same(self, preview, recorder):
        """The preview counts the calls the run made and prices them as the guard held them."""
        self.assertEqual(preview["calls"], len(recorder.reserves))
        self.assertAlmostEqual(preview["usd"], sum(recorder.reserves), places=15)
        self.assertTrue(preview["upper_bound"])

    def test_bulk_matches_the_run_and_takes_the_first_200_rows(self):
        rows = [{"text": "row %d" % i} for i in range(205)] + ["", None]
        rec = Recorder(self.dir)
        preview = estimate.for_bulk(rec.client, rows, Q)
        self.assertEqual((preview["calls"], preview["rows"], preview["capped"]), (200, 200, 5))
        self.assertEqual(preview["models"], ["jev-1.14.0"])
        workbench.run_bulk(rec.client, rows, Q)
        self.same(preview, rec)

    def test_bulk_sends_test_rows_and_a_text_row_under_its_field(self):
        rows = ["plain text", {"text": "held", "_test": True}, {"text": "kept"}]
        rec = Recorder(self.dir)
        preview = estimate.for_bulk(rec.client, rows, Q, field="message", model="jev-1.13.0")
        self.assertEqual((preview["calls"], preview["held_out"]), (3, 0))
        self.assertEqual(preview["models"], ["jev-1.13.0"])
        workbench.run_bulk(rec.client, rows, Q, field="message", model="jev-1.13.0")
        self.same(preview, rec)

    def test_compare_counts_each_variant_and_both_orders_and_leaves_test_rows_out(self):
        rows = [{"text": "row %d" % i} for i in range(10)] + [{"text": "held %d" % i, "_test": True} for i in range(2)]
        variants = [{"questions": Q, "model": "jev-1.13.0"},
                    {"questions": Q, "perturb": "typos", "average_orders": True}]
        rec = Recorder(self.dir)
        preview = estimate.for_compare(rec.client, rows, variants)
        self.assertEqual(preview["calls"], 10 + 2 * 10)
        self.assertEqual(preview["held_out"], 2)
        self.assertEqual([(p["label"], p["model"], p["calls"]) for p in preview["parts"]],
                         [("variant A", "jev-1.13.0", 10), ("variant B, both orders", "jev-1.14.0", 20)])
        workbench.run_compare(rec.client, rows, variants)
        self.same(preview, rec)

    def test_compare_of_only_test_rows_fails_as_the_run_does(self):
        rec = Recorder(self.dir)
        with self.assertRaisesRegex(WorkbenchError, "Every row is a test row"):
            estimate.for_compare(rec.client, [{"text": "x", "_test": True}], [{"questions": Q}, {"questions": Q}])

    def test_pictures_add_an_image_allowance_per_use(self):
        questions = {"torn": {"type": "noul", "instructions": "Is the bag in `photo` torn?"}}
        rows = [{"_image": "torn-bag", "note": "a"}, {"note": "a"}]
        rec = Recorder(self.dir)
        preview = estimate.for_bulk(rec.client, rows, questions)
        workbench.run_bulk(rec.client, rows, questions)
        self.same(preview, rec)
        allowance = images.RESERVE_TOKENS_PER_IMAGE * price_per_input_token("jev-1.14.0")
        self.assertGreater(max(rec.reserves) - min(rec.reserves), allowance * 0.99)
        # A saved test that names its picture twice is sent the picture twice.
        item = {"id": "t", "state": {"a": "photo_one", "b": "photo_one again"}, "questions": questions,
                "images": {"photo_one": {"sample": "torn-bag"}}}
        rec = Recorder(self.dir)
        preview = estimate.for_items(rec.client, [item])
        once = request_reserve_usd(item["state"], questions, "jev-1.14.0")
        self.assertAlmostEqual(preview["usd"] - once, 2 * allowance, places=12)
        workbench.run_items(rec.client, [item])
        self.same(preview, rec)

    def test_check_runs_only_tuning_rows(self):
        rec = Recorder(self.dir)
        preview = estimate.for_check(rec.client, "tickets")
        self.assertEqual((preview["calls"], preview["held_out"], preview["models"]), (9, 3, ["jev-1.14.0"]))
        self.assertEqual(estimate.for_check(rec.client, "tickets", " jev-1.13.0 ")["models"], ["jev-1.13.0"])
        checks.run(rec.client, "tickets")
        self.same(preview, rec)

    def test_drift_runs_the_dataset_rows_and_the_new_rows_that_are_not_test_rows(self):
        held = json.loads((self.dir / "datasets" / "tickets.json").read_text())["rows"][0]
        unmarked = {k: v for k, v in held.items() if k not in ("_test", "_expect")}  # a saved test row, unmarked
        new = rows_text([{"text": "new %d" % i} for i in range(4)] + [{"text": "x", "_test": True}, unmarked])
        rec = Recorder(self.dir)
        preview = estimate.for_drift(rec.client, "tickets", new)
        self.assertEqual([(p["label"], p["calls"]) for p in preview["parts"]], [("dataset rows", 9), ("new rows", 4)])
        self.assertEqual(preview["held_out"], 3 + 2)
        drift.run(rec.client, "tickets", new)
        self.same(preview, rec)

    def test_upgrade_asks_both_versions_every_tuning_row(self):
        rec = Recorder(self.dir)
        preview = estimate.for_upgrade(rec.client, "tickets", "jev-1.15.0")
        self.assertEqual([(p["model"], p["calls"]) for p in preview["parts"]], [("jev-1.14.0", 9), ("jev-1.15.0", 9)])
        self.assertEqual(preview["models"], ["jev-1.14.0", "jev-1.15.0"])
        upgrade.run(rec.client, "tickets", "jev-1.15.0")
        self.same(preview, rec)
        with self.assertRaisesRegex(WorkbenchError, "tuned on jev-1.14.0 already"):
            estimate.for_upgrade(rec.client, "tickets", "jev-1.14.0")

    def test_no_network_and_nothing_reserved(self):
        settings = Settings(environ={}, env_file=self.dir / "absent.env")
        client = JevClient(settings, guard=SpendGuard(2.0, rpm=120))  # no key at all: previews need none
        client.guard.spent_usd, client.guard.reserved_usd = 0.25, 0.05
        before = client.guard.snapshot()
        boom = AssertionError("a preview must not call the model or touch the guard")
        with patch.object(client, "_post_system_one", side_effect=boom), patch.object(client, "models", side_effect=boom), \
                patch.object(client, "_stdlib_request", side_effect=boom), patch.object(client, "system_one", side_effect=boom), \
                patch.object(client.guard, "check", side_effect=boom), patch.object(client.guard, "record", side_effect=boom), \
                patch.object(client.guard, "release", side_effect=boom), \
                patch("urllib.request.urlopen", side_effect=boom):
            previews = [estimate.for_bulk(client, ["a", "b"], Q),
                        estimate.for_compare(client, ["a", "b"], [{"questions": Q}, {"questions": Q}]),
                        estimate.for_check(client, "tickets"),
                        estimate.for_drift(client, "tickets", "new row"),
                        estimate.for_upgrade(client, "tickets", "jev-latest"),
                        estimate.for_items(client, [{"state": {"t": "x"}, "questions": Q}])]
        self.assertEqual(client.guard.snapshot(), before)
        self.assertEqual([p["calls"] for p in previews], [2, 4, 9, 10, 18, 1])
        for p in previews:
            self.assertAlmostEqual(p["remaining_usd"], 1.70)

    def test_budget_fit(self):
        rec = Recorder(self.dir, budget=1.0)
        cheap = estimate.for_bulk(rec.client, ["a"], Q)
        self.assertTrue(cheap["fits"])
        self.assertEqual((cheap["budget_usd"], cheap["remaining_usd"], cheap["notes"]), (1.0, 1.0, []))
        rec.client.guard.spent_usd = 1.0 - cheap["usd"] / 2
        tight = estimate.for_bulk(rec.client, ["a"], Q)
        self.assertFalse(tight["fits"])
        self.assertAlmostEqual(tight["remaining_usd"], cheap["usd"] / 2)
        self.assertIn("more than the budget left", tight["notes"][0])
        rec.client.guard.spent_usd = 5.0  # over budget: nothing left, never negative
        self.assertEqual(estimate.for_bulk(rec.client, ["a"], Q)["remaining_usd"], 0.0)
        rec.client.guard.budget_usd = 0  # no budget set
        free = estimate.for_bulk(rec.client, ["a"], Q)
        self.assertEqual((free["fits"], free["remaining_usd"], free["budget_usd"]), (True, None, None))

    def test_rate_limit_note(self):
        rec = Recorder(self.dir)
        rec.client.guard.rpm = 5
        notes = estimate.for_bulk(rec.client, ["r%d" % i for i in range(6)], Q)["notes"]
        self.assertIn("local limit of 5 live calls a minute", notes[0])
        self.assertEqual(estimate.for_bulk(rec.client, ["r%d" % i for i in range(5)], Q)["notes"], [])


    def test_check_script_estimate_makes_no_calls(self):
        settings = Settings(environ={}, env_file=self.dir / "absent.env")
        client = JevClient(settings, guard=SpendGuard(2.0, rpm=120))
        boom = AssertionError("--estimate must not call the model")
        new = self.dir / "new.jsonl"
        new.write_text("first new row\nsecond new row\n")

        def main(*args):
            output = io.StringIO()
            with redirect_stdout(output), patch.object(check_script, "JevClient", return_value=client), \
                    patch.object(client, "_post_system_one", side_effect=boom), \
                    patch.object(client.guard, "check", side_effect=boom):
                code = check_script.main(list(args))
            return code, output.getvalue()

        code, text = main("tickets", "--estimate")
        self.assertEqual(code, 0, text)
        self.assertIn("tickets  check: 9 calls, at most $", text)
        self.assertIn("(3 test rows left out)", text)
        self.assertIn("an upper bound, not a measured cost; fits the $2.00 budget", text)
        code, text = main("tickets", "--estimate", "--drift", str(new), "--model", "jev-1.13.0")
        self.assertEqual(code, 0, text)
        self.assertIn("drift: 11 calls", text)
        self.assertIn("new rows             2 calls to jev-1.13.0", text)
        code, text = main("--estimate", "--upgrade-to", "jev-1.15.0")
        self.assertEqual(code, 0, text)
        self.assertIn("upgrade: 18 calls", text)
        self.assertIn("candidate            9 calls to jev-1.15.0", text)
        code, text = main("--estimate", "--upgrade-to", "jev-1.14.0")
        self.assertEqual(code, 2, text)
        self.assertIn("tuned on jev-1.14.0 already", text)
        client.guard.budget_usd = 1e-9
        code, text = main("tickets", "--estimate")
        self.assertIn("is MORE than the $0.00 budget", text)
        self.assertEqual(client.guard.snapshot()["live_calls"], 0)

    def test_usd_up_rounds_up(self):
        self.assertEqual(check_script.usd_up(0.000186522), "$0.00019")
        self.assertEqual(check_script.usd_up(0.00019), "$0.00019")
        self.assertEqual(check_script.usd_up(0.0123), "$0.013")
        self.assertEqual(check_script.usd_up(1.231), "$1.24")
        self.assertEqual(check_script.usd_up(0), "$0")


if __name__ == "__main__":
    unittest.main()
