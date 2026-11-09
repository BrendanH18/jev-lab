"""Draft recovery protects inputs and never saves or asks the model."""

import copy
import json
import unittest
from unittest.mock import patch

from jev import prelabel_drafts
from jev.workbench import WorkbenchError
from tests.test_prelabel import QUESTIONS


class DraftTests(unittest.TestCase):
    def setUp(self):
        self.rows = ["same", "same", {"text": "partial", "_image": "intact-bag", "_expect": {"team": "INVALID"}},
                     {"text": "held-secret", "_test": True, "_expect": {"urgent": True}}, ["array"]]
        self.items = [{"index": 0, "labels": {"urgent": False}},
                      {"index": 2, "labels": {"severity": 0}}]

    def test_round_trip_keeps_duplicates_false_zero_and_no_side_effects(self):
        before = copy.deepcopy(self.rows)
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("write")), \
                patch("jev.client.JevClient.system_one", side_effect=AssertionError("model")):
            draft = prelabel_drafts.export_draft(self.rows, QUESTIONS, self.items)
            text = json.dumps(draft)
            result = prelabel_drafts.import_draft(self.rows, QUESTIONS, text)
        self.assertEqual(result["items"], self.items)
        self.assertEqual(result["counts"], {"matched": 3, "rows": 2, "labels": 2})
        self.assertEqual(self.rows, before)
        self.assertEqual([item["index"] for item in draft["items"]], [0, 1, 2])
        for secret in ("held-secret", "INVALID", "_expect", "_test", "array"):
            self.assertNotIn(secret, text)
        self.assertEqual(draft["items"][2]["row"]["_image"], "intact-bag")

    def test_changed_source_schema_order_and_heldout_snapshot_rejected(self):
        text = json.dumps(prelabel_drafts.export_draft(self.rows, QUESTIONS, self.items))
        changed = copy.deepcopy(self.rows)
        changed[3]["text"] = "other held out"
        changed_label = copy.deepcopy(self.rows)
        changed_label[2]["_expect"]["team"] = "billing"
        reordered = copy.deepcopy(QUESTIONS)
        reordered["team"]["criteria"] = dict(reversed(list(reordered["team"]["criteria"].items())))
        for rows, questions in [(changed, QUESTIONS), (changed_label, QUESTIONS), (self.rows[1:], QUESTIONS),
                                (self.rows, reordered)]:
            with self.subTest(rows=rows), self.assertRaises(WorkbenchError):
                prelabel_drafts.import_draft(rows, questions, text)

    def test_tampered_entries_and_invalid_labels_rejected(self):
        original = prelabel_drafts.export_draft(self.rows, QUESTIONS, self.items)
        variants = []
        for key, value in [("index", 3), ("index", False), ("row", {"text": "edited"}),
                           ("labels", {"urgent": "bad"}), ("labels", {"unknown": True}),
                           ("missing", []), ("answers", {"urgent": 0.8})]:
            draft = copy.deepcopy(original)
            draft["items"][0][key] = value
            variants.append(draft)
        draft = copy.deepcopy(original)
        draft["items"][2]["labels"] = {"team": "billing"}  # Existing invalid label must survive.
        variants.extend([draft, {}, {**original, "version": True}])
        for draft in variants:
            with self.subTest(draft=draft), self.assertRaises(WorkbenchError):
                prelabel_drafts.import_draft(self.rows, QUESTIONS, json.dumps(draft))

    def test_empty_draft_and_partial_nulls(self):
        draft = prelabel_drafts.export_draft(self.rows, QUESTIONS, [{"index": 0, "labels": {"urgent": None}}])
        self.assertEqual(prelabel_drafts.import_draft(self.rows, QUESTIONS, json.dumps(draft))["items"], [])
        for text in ("", "{", "[]", "null"):
            with self.assertRaises(WorkbenchError):
                prelabel_drafts.import_draft(self.rows, QUESTIONS, text)
