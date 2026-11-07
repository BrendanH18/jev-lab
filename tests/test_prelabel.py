"""Pre-run human labeling preserves the source and never asks or saves anything."""

import copy
import json
import unittest
from unittest.mock import patch

from jev import prelabel, workbench
from jev.workbench import WorkbenchError


QUESTIONS = {
    "team": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "Money", "shipping": "Parcels"}},
    "urgent": {"type": "noul", "instructions": "Is it urgent?"},
    "severity": {"type": "score", "instructions": "How severe?", "criteria": ["Low", "High"]},
}


class PrelabelTests(unittest.TestCase):
    def test_queue_has_only_missing_tuning_cells_and_no_existing_labels(self):
        rows = ["plain", {"text": "partial", "_expect": {"team": "billing", "urgent": False, "severity": None}},
                {"text": "invalid", "_expect": {"team": "WRONG", "urgent": None}},
                {"text": "held-secret", "_test": True, "_expect": {"team": "shipping"}},
                {"text": "done", "_expect": {"team": "billing", "urgent": True, "severity": 0}}, ["array"]]
        out = prelabel.prepare(rows, QUESTIONS)
        self.assertEqual([i["index"] for i in out["items"]], [0, 1, 2])
        self.assertEqual([i["missing"] for i in out["items"]],
                         [["team", "urgent", "severity"], ["severity"], ["urgent", "severity"]])
        self.assertEqual(out["eligible"], 3)
        self.assertEqual(out["missing"], 6)
        rendered = json.dumps(out)
        for secret in ("held-secret", "_expect", "_test", "WRONG"):
            self.assertNotIn(secret, rendered)

    def test_fill_preserves_duplicates_existing_labels_marks_arrays_and_input(self):
        rows = ["same", "same", {"text": "partial", "_expect": {"team": "WRONG", "urgent": False, "severity": None}},
                {"text": "held", "_test": True, "_expect": {"urgent": True}}, ["keep"]]
        original = copy.deepcopy(rows)
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("must not save")), \
                patch("jev.client.JevClient.system_one", side_effect=AssertionError("must not call")):
            prelabel.prepare(rows, QUESTIONS)
            out = prelabel.apply(rows, QUESTIONS, [{"index": 0, "labels": {"team": "billing", "urgent": False}},
                                                   {"index": 2, "labels": {"severity": 0}}])
        self.assertEqual(rows, original)
        self.assertEqual(out["applied"], 3)
        self.assertEqual(out["rows"][0], {"text": "same", "_expect": {"team": "billing", "urgent": False}})
        self.assertEqual(out["rows"][1], "same")
        self.assertEqual(out["rows"][2]["_expect"], {"team": "WRONG", "urgent": False, "severity": 0})
        self.assertEqual(out["rows"][3:], original[3:])

    def test_rejects_replacement_invalid_labels_test_rows_and_bad_drafts(self):
        rows = [{"text": "partial", "_expect": {"team": "WRONG", "urgent": False}},
                {"text": "held", "_test": True}, "unlabeled", ["array"]]
        drafts = [None, {}, [{"index": 0, "labels": {"team": "billing"}}],
                  [{"index": 0, "labels": {"urgent": False}}],
                  [{"index": 1, "labels": {"team": "billing"}}],
                  [{"index": 3, "labels": {"team": "billing"}}],
                  [{"index": True, "labels": {"team": "billing"}}],
                  [{"index": 2, "labels": {"unknown": "billing"}}],
                  [{"index": 2, "labels": {"team": " Billing "}}],
                  [{"index": 2, "labels": {"urgent": 2}}],
                  [{"index": 2, "labels": {"severity": True}}],
                  [{"index": 2, "labels": {"severity": 2}}],
                  [{"index": 2, "labels": []}],
                  [{"index": 2, "labels": {}}, {"index": 2, "labels": {}}]]
        for items in drafts:
            with self.subTest(items=items), self.assertRaises(WorkbenchError):
                prelabel.apply(rows, QUESTIONS, items)

    def test_filters_use_full_normalized_identity_not_display_truncation(self):
        first, second = "x" * 100 + "a", "x" * 100 + "b"
        rows = [{"text": "a", "channel": first}, {"text": "b", "channel": second},
                {"text": "c", "channel": {"b": 2, "a": 1}}, {"text": "d", "channel": {"a": 1, "b": 2}},
                "none", {"text": "held", "channel": "held-only", "_test": True}]
        out = prelabel.prepare(rows, QUESTIONS, "channel")
        self.assertEqual(out["eligible"], 5)
        self.assertEqual(out["fields"], [{"name": "text", "values": 5}, {"name": "channel", "values": 4}])
        self.assertNotIn("held-only", json.dumps(out))
        long = [v for v in out["values"] if v["value"].startswith("x")]
        self.assertEqual(long[0]["shown"], long[1]["shown"])
        self.assertNotEqual(long[0]["value"], long[1]["value"])
        self.assertEqual([i["index"] for i in prelabel.prepare(rows, QUESTIONS, "channel", first)["items"]], [0])
        structured = '{"a": 1, "b": 2}'
        self.assertEqual([i["index"] for i in prelabel.prepare(rows, QUESTIONS, "channel", structured)["items"]], [2, 3])
        self.assertEqual(len(prelabel.prepare(rows, QUESTIONS, "channel", None)["items"]), 5)
        self.assertIsNone(prelabel.prepare(rows, QUESTIONS, "_test", "true")["field"])

    def test_newline_rows_nonempty_numbering_pictures_and_box_questions(self):
        name = next(iter(workbench.images.SAMPLES))
        rows = '\nfirst\n\n' + json.dumps({"text": "photo", "_image": name}) + '\n'
        questions = dict(QUESTIONS, damage={"type": "box", "instructions": "Where is the damage?"})
        out = prelabel.prepare(rows, questions)
        self.assertEqual([i["index"] for i in out["items"]], [0, 1])
        self.assertEqual(out["items"][1]["row"]["_image"], name)
        self.assertNotIn("damage", out["questions"])
        out = prelabel.apply(rows, questions, [{"index": 1, "labels": {"urgent": True}}])
        self.assertEqual(out["rows"][1]["_image"], name)
        self.assertEqual(prelabel.prepare(["a"], {"damage": questions["damage"]})["items"], [])

    def test_blank_drafts_are_noops_and_empty_array_entries_match_bulk(self):
        rows = [None, "", "a"]
        self.assertEqual(prelabel.prepare(rows, QUESTIONS)["items"][0]["index"], 0)
        self.assertEqual(prelabel.apply(rows, QUESTIONS, [{"index": 0, "labels": {"urgent": None}}]),
                         {"rows": ["a"], "applied": 0})

    def test_handlers_are_registered_and_pure(self):
        import server
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("must not save")), \
                patch.object(server.client, "system_one", side_effect=AssertionError("must not call")):
            prepare = server.ROUTES[("POST", "/api/workbench/prelabel")]
            apply = server.ROUTES[("POST", "/api/workbench/prelabel/apply")]
            body = {"rows": ["a"], "questions": QUESTIONS}
            self.assertEqual(prepare(body)["eligible"], 1)
            out = apply(dict(body, items=[{"index": 0, "labels": {"team": "billing"}}]))
            self.assertEqual(out["applied"], 1)


if __name__ == "__main__":
    unittest.main()
