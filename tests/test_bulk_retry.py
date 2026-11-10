"""Selected Bulk retries keep original positions and preview precisely the calls they make."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from helpers import FakeClient, fake_answers  # noqa: E402
from jev import estimate, workbench  # noqa: E402
from jev.client import JevClient, JevError, SpendGuard  # noqa: E402
from jev.config import Settings  # noqa: E402

Q = {"urgent": {"type": "noul", "instructions": "Is `text` urgent?"}}


class BulkRetryTests(unittest.TestCase):
    def test_selected_duplicate_positions_keep_labels_but_send_only_inputs(self):
        rows = ["", {"text": "same", "_expect": {"urgent": False}},
                {"text": "same", "_expect": {"urgent": True}, "_test": True}, "third"]
        client = FakeClient()
        with patch.object(workbench, "BULK_CONCURRENCY", 1):
            report = workbench.run_bulk(client, rows, Q, field="message", indices=[2, 1])
        self.assertEqual([r["index"] for r in report["results"]], [2, 1])
        self.assertEqual([s for s, _q in client.calls], [{"message": "third"}, {"text": "same"}])
        self.assertEqual(report["results"][1]["expect"], {"urgent": True})
        self.assertTrue(report["results"][1]["row"]["_test"])
        self.assertEqual((report["rows"], report["completed"], report["labeled"]), (2, 2, 1))
        self.assertEqual(report["input_tokens"], 2000)
        report = workbench.run_bulk(client, rows, Q, indices=[1, 0])
        self.assertEqual([r["index"] for r in report["results"]], [1, 0])
        self.assertEqual([r["expect"] for r in report["results"]], [{"urgent": True}, {"urgent": False}])

    def test_model_is_frozen_before_the_first_job(self):
        client = FakeClient()
        original = client.model

        def switch(_state, _questions):
            client.model = "jev-preview"
            return {}

        client.picker = switch
        with patch.object(workbench, "BULK_CONCURRENCY", 1):
            report = workbench.run_bulk(client, ["one", "two"], Q)
        self.assertEqual(client.models, [original, original])
        self.assertEqual(report["model"], original)
        report = workbench.run_bulk(client, ["one"], Q, model="jev-1.14.0", indices=[0])
        self.assertEqual(report["model"], "jev-1.14.0")
        self.assertEqual(client.models[-1], "jev-1.14.0")

    def test_invalid_or_empty_selections_never_make_calls(self):
        client = FakeClient()
        for indices in ([False], [True], [0.0], ["0"], [-1], [2], [0, 0], "0", {}, 0):
            with self.subTest(indices=indices), self.assertRaises(workbench.WorkbenchError):
                workbench.run_bulk(client, ["one", "two"], Q, indices=indices)
            with self.subTest(indices=indices), self.assertRaises(workbench.WorkbenchError):
                estimate.for_bulk(client, ["one", "two"], Q, indices=indices)
        report = workbench.run_bulk(client, ["one", "two"], Q, indices=[])
        self.assertEqual((report["rows"], report["completed"], report["results"], report["cost_usd"]), (0, 0, [], 0))
        self.assertFalse(client.calls)
        with self.assertRaises(workbench.WorkbenchError):
            workbench.run_bulk(client, ["row"] * 201, Q, indices=[200])

    def test_only_selected_pictures_are_read(self):
        rows = [{"_image": "intact-bag"}, {"_image": "torn-bag", "_expect": {"urgent": True}}]
        client = FakeClient()
        asset = {"type": "image", "data": b"selected picture", "format": "png"}
        with patch.object(workbench, "picture_asset", return_value=asset) as load:
            report = workbench.run_bulk(client, rows, Q, indices=[1])
        load.assert_called_once_with("torn-bag")
        state = client.calls[0][0]
        self.assertEqual(list(state), ["photo"])
        self.assertEqual(client.assets, {state["photo"]: asset})
        self.assertEqual(report["results"][0]["row"], {"_image": "torn-bag"})
        # Box validation also considers the selected requests only.
        box = {"where": {"type": "box", "instructions": "the mug in `photo`"}}
        with patch.object(workbench, "picture_asset", return_value=asset):
            workbench.run_bulk(client, ["unselected", rows[1]], box, indices=[1])

    def test_budget_stop_preserves_selected_original_indices(self):
        class BudgetClient(FakeClient):
            def system_one(self, state, questions, assets=None, model=None):
                self.calls.append((state, questions))
                raise JevError("budget exhausted", status=402)

        client = BudgetClient()
        with patch.object(workbench, "BULK_CONCURRENCY", 1):
            report = workbench.run_bulk(client, ["one", "two", "three", "four"], Q, indices=[3, 1, 2])
        self.assertEqual([r["index"] for r in report["results"]], [3, 1, 2])
        self.assertEqual(report["stopped"], "budget exhausted")
        self.assertTrue(report["results"][1]["skipped"])
        self.assertTrue(report["results"][2]["skipped"])
        self.assertEqual(len(client.calls), 1)

    def test_preview_prices_only_selected_exact_requests_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            settings = Settings(environ={}, env_file=Path(folder) / "absent.env")
            client = JevClient(settings, guard=SpendGuard(1, rpm=0), api_key="synthetic-key")
            rows = [{"text": "not sent"}, {"text": "photo", "_image": "torn-bag", "_expect": {"urgent": True}},
                    "selected text"] + ["unused"] * 200
            body = {"kind": "bulk", "rows": rows, "questions": Q, "field": "message",
                    "model": "jev-1.14.0", "indices": [2, 1]}
            before = client.guard.snapshot()
            boom = AssertionError("no network or budget reservation while estimating")
            with patch.object(server, "client", client), patch.object(server, "check_model", side_effect=boom), \
                    patch.object(client, "system_one", side_effect=boom), \
                    patch.object(client.guard, "check", side_effect=boom), \
                    patch.object(client.guard, "record", side_effect=boom), \
                    patch("urllib.request.urlopen", side_effect=boom):
                preview = server.api_wb_estimate(body)
            self.assertEqual(client.guard.snapshot(), before)
            self.assertEqual((preview["calls"], preview["rows"], preview["capped"]), (2, 2, 3))
            self.assertEqual(preview["models"], ["jev-1.14.0"])
            reserves = []
            held = client.guard.check

            def reserve(value):
                reserves.append(value)
                held(value)

            def post(payload):
                return {"model": payload["model"], "answers": fake_answers(payload["questions"]),
                        "usage": {"input_tokens": 1}}

            with patch.object(client.guard, "check", side_effect=reserve), \
                    patch.object(client, "_post_system_one", side_effect=post):
                workbench.run_bulk(client, rows, Q, field="message", model=body["model"], indices=body["indices"])
            self.assertEqual(len(reserves), preview["calls"])
            self.assertAlmostEqual(sum(reserves), preview["usd"], places=15)
            self.assertTrue(preview["upper_bound"])
            empty = estimate.for_bulk(client, rows, Q, indices=[])
            self.assertEqual((empty["calls"], empty["usd"]), (0, 0))

    def test_api_validates_models_and_never_uses_sample_rows_for_a_selection(self):
        client = FakeClient()
        body = {"rows": ["one", "two"], "questions": Q, "indices": [1], "model": " jev-1.14.0 "}
        with patch.object(server, "client", client), patch.object(server, "check_model") as validate:
            report = server.api_wb_bulk(body)
            validate.assert_called_once_with("jev-1.14.0")
            self.assertEqual(report["results"][0]["index"], 1)
            for model in (12, False, []):
                with self.subTest(model=model), self.assertRaises(server.BadRequest):
                    server.api_wb_bulk(dict(body, model=model))
                with self.subTest(model=model), self.assertRaises(server.BadRequest):
                    server.api_wb_estimate(dict(body, kind="bulk", model=model))
        with patch.object(workbench, "load_sample_rows", side_effect=AssertionError("no sample fallback")):
            for method in (server.api_wb_bulk, server.api_wb_estimate):
                with self.assertRaises(workbench.WorkbenchError):
                    method({"rows": [], "questions": Q, "indices": [], "kind": "bulk"})


if __name__ == "__main__":
    unittest.main()
