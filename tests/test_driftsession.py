"""Traffic draft recovery never needs saved answers, model calls or a dataset write."""

import copy
import json
from unittest.mock import patch

from jev import drift, driftsession, workbench
from jev.workbench import WorkbenchError
from tests.test_decisions import Temp


class TrafficDraftTests(Temp):
    def setUp(self):
        super().setUp()
        self.save()
        self.dataset = workbench.load_dataset("tickets")
        self.queue = drift._labeling(self.dataset, [
            {"index": 2, "row": {"text": "A new delivery question", "_image": "torn-bag"}},
            {"index": 7, "row": "A new invoice question"},
            {"index": 8, "row": "A new invoice question"},
        ], self.dataset["questions"], self.dataset["check"]["gates"])
        self.members = [{"line": item["line"], "row": item["row"]} for item in self.queue["items"]]
        self.edits = [{"line": 3, "labels": {"department": "shipping", "is_urgent": False, "frustration": 0}},
                      {"line": 8, "labels": {"wants_refund": True}}]
        self.before = workbench._dataset_path("tickets").read_bytes()

    def export(self, edits=None):
        return driftsession.export_session("tickets", self.queue["session_context"], self.members,
                                           self.edits if edits is None else edits)

    def test_round_trip_reconstructs_only_human_queue_without_comparison(self):
        with patch("jev.client.JevClient.system_one", side_effect=AssertionError("model call")), \
                patch("jev.workbench.write_dataset", side_effect=AssertionError("dataset write")), \
                patch("jev.drift.run", side_effect=AssertionError("paid comparison")):
            session = json.loads(json.dumps(self.export()))
            out = driftsession.import_session("tickets", session)
        self.assertEqual(out["counts"], {"rows": 2, "edited_rows": 2, "labels": 4})
        self.assertEqual([item["line"] for item in out["labeling"]["items"]], [3, 8])
        first, second = out["labeling"]["items"]
        self.assertEqual(first["row"]["_image"], "torn-bag")
        self.assertIs(first["labels"]["is_urgent"], False)
        self.assertEqual(first["labels"]["frustration"], 0)
        self.assertIsNone(second["labels"]["department"])
        self.assertEqual(out["labeling"]["session_context"], self.queue["session_context"])
        self.assertNotIn("report", out)
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), self.before)

    def test_file_contains_inputs_schema_and_human_edits_only(self):
        session = self.export([])
        self.assertEqual(session["items"], [])
        self.assertEqual(session["members"], self.members)
        self.assertEqual(session["questions"], self.queue["questions"])
        text = json.dumps(session)
        for forbidden in ("answers", "candidates", "read", "accuracy", "cost_usd", "confidence", "thin",
                          "Charged twice, refund me", "Where is my parcel?", "_expect", "_test"):
            self.assertNotIn('"%s"' % forbidden, text)

    def test_browser_round_trip_preserves_integer_float_queue_identity(self):
        row = {"amount": 5.0, "nested": {"values": [-0.0, 2.0, 0.125, False]}}
        queue = drift._labeling(self.dataset, [{"index": 0, "row": row}],
                                self.dataset["questions"], self.dataset["check"]["gates"])
        # JSON.stringify writes integral JS numbers without a decimal point.
        members = [{"line": 1, "row": {"amount": 5, "nested": {"values": [0, 2, 0.125, False]}}}]
        session = driftsession.export_session("tickets", queue["session_context"], members,
                                             [{"line": 1, "labels": {"is_urgent": False}}])
        restored = driftsession.import_session("tickets", json.loads(json.dumps(session)))
        self.assertEqual(restored["labeling"]["session_context"], queue["session_context"])
        self.assertIs(restored["labeling"]["items"][0]["labels"]["is_urgent"], False)
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), self.before)

    def test_numeric_duplicate_inputs_do_not_block_unrelated_human_draft_labels(self):
        queue = drift._labeling(self.dataset, [
            {"index": 0, "row": {"amount": 5.0}}, {"index": 1, "row": {"amount": 5}},
            {"index": 2, "row": {"text": "An unrelated new input"}},
        ], self.dataset["questions"], self.dataset["check"]["gates"])
        self.assertEqual(queue["counts"]["repeated"], 1)
        members = [{"line": item["line"], "row": item["row"]} for item in queue["items"]]
        members[0]["row"] = {"amount": 5}  # browser JSON round trip
        session = driftsession.export_session("tickets", queue["session_context"], members,
                                             [{"line": 3, "labels": {"is_urgent": False}}])
        restored = driftsession.import_session("tickets", session)
        self.assertEqual([item["line"] for item in restored["labeling"]["items"]], [1, 3])
        self.assertIs(restored["labeling"]["items"][1]["labels"]["is_urgent"], False)

    def test_numeric_saved_inputs_stay_excluded_during_prepare_recovery_and_append(self):
        saved = copy.deepcopy(self.dataset)
        saved["rows"].append({"amount": 5.0, "_test": True})
        workbench.write_dataset(saved)
        _, _, fresh, held_out, _, _ = drift.prepare("tickets", [{"amount": 5}, {"amount": 6}])
        self.assertEqual((fresh, held_out), ([{"amount": 6}], 1))
        queue = drift._labeling(saved, [{"index": 0, "row": {"amount": 5}}],
                                saved["questions"], saved["check"]["gates"])
        self.assertEqual((queue["items"], queue["counts"]["in_dataset"]), ([], 1))
        with self.assertRaises(WorkbenchError):
            driftsession.export_session("tickets", "old", [{"line": 1, "row": {"amount": 5}}], [])
        out = drift.append_labels("tickets", [{"row": {"amount": 5},
            "labels": {"department": "billing", "is_urgent": True}}], queue["questions"])
        self.assertEqual((out["added"], out["already"]), (0, 1))

    def test_members_and_picture_names_are_bound_without_merging_duplicate_positions(self):
        original = self.export()
        for mutate in (lambda x: x["members"].reverse(),
                       lambda x: x["members"][0].update(line=4),
                       lambda x: x["members"][0]["row"].update(_image="intact-bag"),
                       lambda x: x["members"][0]["row"].update(text="Changed input")):
            bad = copy.deepcopy(original)
            mutate(bad)
            with self.assertRaises(WorkbenchError):
                driftsession.import_session("tickets", bad)

    def test_saved_dataset_check_labels_and_choice_order_are_bound(self):
        session = self.export()
        for change in ("threshold", "label", "choice_order", "question_order"):
            saved = copy.deepcopy(self.dataset)
            if change == "threshold":
                saved["check"]["gates"]["department"] = 0.7
            elif change == "label":
                saved["rows"][0]["_expect"]["is_urgent"] = False
            elif change == "choice_order":
                criteria = saved["questions"]["department"]["criteria"]
                saved["questions"]["department"]["criteria"] = dict(reversed(list(criteria.items())))
            else:
                saved["questions"] = dict(reversed(list(saved["questions"].items())))
            workbench.write_dataset(saved)
            with self.subTest(change=change), self.assertRaises(WorkbenchError):
                driftsession.import_session("tickets", session)
        workbench.write_dataset(self.dataset)

    def test_invalid_files_are_rejected_before_any_draft_can_be_applied(self):
        original = self.export()
        variants = [{}, {**original, "version": True}, {**original, "dataset": "other"},
                    {**original, "answers": {}}, {**original, "questions": {}},
                    {**original, "items": [{"line": 3, "labels": {"unknown": True}}]},
                    {**original, "items": [{"line": 3, "labels": {"department": "INVALID"}}]},
                    {**original, "items": [{"line": True, "labels": {"is_urgent": True}}]},
                    {**original, "items": [{"line": 3, "labels": {"frustration": float("nan")}}]},
                    {**original, "items": self.edits * 2}]
        for field, value in (("line", True), ("line", 201), ("answers", {})):
            bad = copy.deepcopy(original)
            bad["members"][0][field] = value
            variants.append(bad)
        for bad in variants:
            with self.subTest(file=bad), self.assertRaises(WorkbenchError):
                driftsession.import_session("tickets", bad)
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), self.before)

    def test_saved_held_out_inputs_and_markers_cannot_enter_recovery(self):
        saved = copy.deepcopy(self.dataset)
        saved["rows"][0]["_test"] = True
        workbench.write_dataset(saved)
        for row in ({"text": "Charged twice, refund me"}, {"text": "Another row", "_test": True},
                    {"text": "Another row", "_expect": {"is_urgent": True}}):
            with self.subTest(row=row), self.assertRaises(WorkbenchError):
                driftsession.export_session("tickets", "old", [{"line": 1, "row": row}], [])

    def test_label_clears_stay_blank_and_model_suggestions_are_rejected(self):
        session = self.export([{"line": 3, "labels": {"department": None, "is_urgent": False}}])
        self.assertEqual(session["items"], [{"line": 3, "labels": {"is_urgent": False}}])
        bad = copy.deepcopy(self.members)
        bad[0]["labels"] = {"department": "shipping"}
        with self.assertRaises(WorkbenchError):
            driftsession.export_session("tickets", self.queue["session_context"], bad, [])
