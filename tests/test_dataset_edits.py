"""Dataset repairs remain explicit, snapshot-bound, and limited to tuning rows."""

import copy
import json
import unittest
from unittest.mock import patch

from jev import dataset_edits, workbench
from jev.workbench import WorkbenchError

QUESTIONS = {"team": {"type": "choice", "instructions": "Team?", "criteria": {"a": None, "b": None}},
             "urgent": {"type": "noul", "instructions": "Urgent?"},
             "level": {"type": "score", "instructions": "Level?", "criteria": ["Low", "High"]}}


class EditTests(unittest.TestCase):
    def test_repairs_invalid_and_conflicting_labels_and_preserves_all_other_data(self):
        rows = [{"text": "same", "_expect": {"team": "a", "unknown": "keep"}},
                {"text": "same", "_expect": {"team": "b"}},
                {"text": "bad", "_image": "damaged-box", "_expect": {"urgent": "bad", "level": "bad"}},
                {"text": "held", "_test": True, "_expect": {"team": "held-secret"}}]
        # Use a valid sample name without reading its bytes.
        rows[2]["_image"] = next(iter(workbench.images.SAMPLES))
        original = copy.deepcopy(rows)
        prepared = dataset_edits.prepare(rows, QUESTIONS)
        self.assertEqual([i["index"] for i in prepared["items"]], [0, 1, 2])
        items = [{"index": 1, "labels": {"team": "a"}}, {"index": 2, "labels": {"urgent": False, "level": 0}}]
        preview = dataset_edits.preview(rows, QUESTIONS, prepared["context"], "repair", items)
        self.assertEqual(preview["changed"], 3)
        result = dataset_edits.apply(rows, QUESTIONS, prepared["context"], "repair", items, preview["token"])
        self.assertEqual(result["rows"][2]["_expect"], {"urgent": False, "level": 0})
        self.assertEqual(result["rows"][3], rows[3])
        self.assertEqual(result["rows"][0], rows[0])
        self.assertEqual(result["rows"][2]["_image"], rows[2]["_image"])
        self.assertEqual(rows, original)
        self.assertNotIn("held-secret", json.dumps(prepared))
        self.assertNotIn("held-secret", json.dumps(preview))

    def test_protects_entire_groups_with_held_out_inputs(self):
        rows = [{"text": "same", "_expect": {"team": "bad"}},
                {"text": "same", "_expect": {"team": "a"}},
                {"text": "same", "_expect": {"team": "b"}, "_test": True}]
        prepared = dataset_edits.prepare(rows, QUESTIONS)
        self.assertEqual(prepared["items"], [])
        self.assertEqual(prepared["remove"], [])
        self.assertEqual(prepared["protected_rows"], 3)
        with self.assertRaises(WorkbenchError):
            dataset_edits.preview(rows, QUESTIONS, prepared["context"], "repair", [{"index": 0, "labels": {"team": "a"}}])

    def test_cleanup_preserves_conflicting_labels_and_pictures(self):
        rows = [{"text": "same", "_expect": {"team": "a"}},
                {"_expect": {"team": "a"}, "text": "same"},
                {"text": "same", "_expect": {"team": "b"}}, "plain", {"text": "plain"},
                {"text": "held", "_test": True}, {"text": "held"}]
        prepared = dataset_edits.prepare(rows, QUESTIONS)
        self.assertEqual(prepared["remove"], [1, 4])
        preview = dataset_edits.preview(rows, QUESTIONS, prepared["context"], "deduplicate")
        self.assertEqual(preview["removed"], [2, 5])
        result = dataset_edits.apply(rows, QUESTIONS, prepared["context"], "deduplicate", [], preview["token"])
        self.assertEqual(result["rows"], [rows[i] for i in [0, 2, 3, 5, 6]])

    def test_stale_context_choice_order_and_preview_are_rejected(self):
        rows = [{"text": "bad", "_expect": {"team": "bad"}}]
        context = dataset_edits.prepare(rows, QUESTIONS)["context"]
        items = [{"index": 0, "labels": {"team": "a"}}]
        preview = dataset_edits.preview(rows, QUESTIONS, context, "repair", items)
        for changed_rows, changed_q in [([*rows, "new"], QUESTIONS), (rows, dict(QUESTIONS, team=dict(QUESTIONS["team"], criteria={"b": None, "a": None})))]:
            with self.assertRaises(WorkbenchError):
                dataset_edits.preview(changed_rows, changed_q, context, "repair", items)
        with self.assertRaises(WorkbenchError):
            dataset_edits.apply(rows, QUESTIONS, context, "repair", [{"index": 0, "labels": {"team": "b"}}], preview["token"])

    def test_rejects_edits_to_missing_valid_unknown_box_and_invalid_replacements(self):
        rows = [{"text": "bad", "_expect": {"team": "bad", "urgent": True}}]
        context = dataset_edits.prepare(rows, QUESTIONS)["context"]
        for item in [{"index": True, "labels": {"team": "a"}}, {"index": 0, "labels": {"urgent": False}},
                     {"index": 0, "labels": {"level": 0}}, {"index": 0, "labels": {"other": "x"}},
                     {"index": 0, "labels": {"team": None}}, {"index": 0, "labels": {"team": "wrong"}}]:
            with self.subTest(item=item), self.assertRaises(WorkbenchError):
                dataset_edits.preview(rows, QUESTIONS, context, "repair", [item])

    def test_no_calls_or_writes_and_no_input_mutation(self):
        rows = ["same", "same"]
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("write")), patch("jev.client.JevClient.system_one", side_effect=AssertionError("call")):
            prepared = dataset_edits.prepare(rows)
            preview = dataset_edits.preview(rows, None, prepared["context"], "deduplicate")
            self.assertEqual(dataset_edits.apply(rows, None, prepared["context"], "deduplicate", None, preview["token"])["rows"], ["same"])
        self.assertEqual(rows, ["same", "same"])

