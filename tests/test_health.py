"""Dataset health uses inputs and human labels only, without model calls or file writes."""

import copy
import json
import unittest
from unittest.mock import patch

from jev import health, workbench
from jev.workbench import WorkbenchError


QUESTIONS = {
    "team": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "Money", "shipping": "Parcels"}},
    "urgent": {"type": "noul", "instructions": "Is it urgent?"},
    "severity": {"type": "score", "instructions": "How severe?", "criteria": ["Low", "High"]},
}


class HealthTests(unittest.TestCase):
    def test_identity_ignores_labels_marks_and_object_key_order(self):
        rows = ["same", {"text": "same", "_expect": {"team": "billing"}},
                {"_test": True, "_expect": {"team": "shipping"}, "text": "same"},
                {"a": 1, "b": 2}, {"b": 2, "a": 1}, "other"]
        out = health.analyze(rows, QUESTIONS)
        self.assertEqual(out["rows"], 6)
        self.assertEqual(out["unique_inputs"], 3)
        self.assertEqual(out["duplicate_groups"], [{"rows": [1, 2, 3]}, {"rows": [4, 5]}])
        self.assertEqual(out["overlap"], [{"rows": [1, 2, 3], "training": [1, 2], "test": [3]}])
        self.assertEqual(out["conflicts"], [{"rows": [2, 3], "question": "team"}])

    def test_pictures_and_other_input_fields_distinguish_rows(self):
        rows = [{"text": "same", "_image": "damaged"}, {"text": "same", "_image": "intact"},
                {"text": "same"}, {"text": "same", "channel": "email"}]
        # Valid names are enough: inspection never reads picture bytes from disk.
        names = list(workbench.images.SAMPLES)[:2]
        rows[0]["_image"], rows[1]["_image"] = names
        out = health.analyze(rows)
        self.assertEqual(out["unique_inputs"], 4)
        self.assertEqual(out["duplicate_groups"], [])

    def test_equivalent_label_spellings_do_not_conflict(self):
        rows = [{"text": "same", "_expect": {"team": "Billing", "urgent": "yes", "severity": "1.0"}},
                {"text": "same", "_expect": {"team": "billing", "urgent": True, "severity": 1}},
                {"text": "same", "_expect": {"team": "unknown", "urgent": None}}]
        out = health.analyze(rows, QUESTIONS)
        self.assertEqual(out["conflicts"], [])
        self.assertEqual(out["questions"][0], {"qid": "team", "type": "choice", "labeled": 2,
                                             "missing": 0, "missing_rows": [], "invalid": [3]})
        self.assertEqual(out["questions"][1]["missing_rows"], [3])

    def test_missing_invalid_and_unknown_labels_are_separate(self):
        rows = ["unlabeled", {"text": "partial", "_expect": {"team": None, "urgent": False, "severity": 0}},
                {"text": "wrong", "_expect": {"team": "elsewhere", "urgent": 2, "severity": True,
                                               "old_question": "yes", "unused": None}}]
        out = health.analyze(rows, QUESTIONS)
        self.assertEqual(out["invalid_labels"], [{"row": 3, "question": "old_question"}])
        for q in out["questions"]:
            self.assertEqual(q["invalid"], [3])
            self.assertEqual(q["labeled"] + q["missing"] + len(q["invalid"]), 3)
        self.assertEqual(out["questions"][0]["missing_rows"], [1, 2])
        self.assertEqual(out["questions"][1]["missing_rows"], [1])

    def test_box_labels_use_the_same_edge_validation_as_calibrate(self):
        question = {"damage": {"type": "box", "instructions": "Where is damage?"}}
        box = {"left": 0.1, "top": 0.2, "right": 0.8, "bottom": 0.9}
        rows = [{"text": "same", "_expect": {"damage": box}},
                {"text": "same", "_expect": {"damage": dict(box, left=0.2)}},
                {"text": "bad", "_expect": {"damage": dict(box, left=0.9)}}, "missing"]
        out = health.analyze(rows, question)
        self.assertEqual(out["conflicts"], [{"rows": [1, 2], "question": "damage"}])
        self.assertEqual(out["questions"], [{"qid": "damage", "type": "box", "labeled": 2,
                                            "missing": 1, "missing_rows": [4], "invalid": [3]}])

    def test_report_never_exposes_inputs_or_labels_even_for_test_rows(self):
        questions = {"q": {"type": "choice", "instructions": "Pick", "criteria": {"secret-a": None, "secret-b": None}}}
        rows = [{"text": "private input", "_expect": {"q": "secret-a"}},
                {"text": "private input", "_test": True, "_expect": {"q": "secret-b"}}]
        serialized = json.dumps(health.analyze(rows, questions))
        for secret in ("private input", "secret-a", "secret-b"):
            self.assertNotIn(secret, serialized)

    def test_identity_checks_work_without_questions(self):
        rows = [{"text": "same", "_expect": {"unknown": "anything"}}, "same"]
        for questions in (None, {}):
            out = health.analyze(rows, questions)
            self.assertEqual(out["questions"], [])
            self.assertEqual(out["invalid_labels"], [])
            self.assertEqual(out["conflicts"], [])
            self.assertEqual(out["duplicate_groups"], [{"rows": [1, 2]}])

    def test_newline_text_has_bulk_row_numbering(self):
        text = '\n hello\r\n\n{"text":"hello","_test":true}\n'
        out = health.analyze(text)
        self.assertEqual(out["rows"], 2)
        self.assertEqual(out["overlap"], [{"rows": [1, 2], "training": [1], "test": [2]}])

    def test_array_empty_entries_are_ignored_before_numbering_and_limit(self):
        rows = ["", {"text": "same"}, None, {"text": "same", "_test": True}]
        out = health.analyze(rows)
        self.assertEqual(out["rows"], 2)
        self.assertEqual(out["duplicate_groups"], [{"rows": [1, 2]}])
        self.assertEqual(out["overlap"], [{"rows": [1, 2], "training": [1], "test": [2]}])
        self.assertEqual(health.analyze([None, ""] * 200 + ["a"])["rows"], 1)
        with self.assertRaises(WorkbenchError):
            health.analyze([None, ""])

    def test_inspection_does_not_mutate_rows_questions_or_write_or_call(self):
        rows = [{"text": "same", "_expect": {"urgent": "yes"}}, {"text": "same", "_test": True}]
        original_rows, questions = copy.deepcopy(rows), copy.deepcopy(QUESTIONS)
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("must not write")), \
                patch("jev.client.JevClient.system_one", side_effect=AssertionError("must not call")):
            health.analyze(rows, questions)
        self.assertEqual(rows, original_rows)
        self.assertEqual(questions, QUESTIONS)

    def test_invalid_requests_are_reported_instead_of_truncated(self):
        for rows in (None, 12, {}, [], "\n", ["a"] * (workbench.MAX_BULK_ROWS + 1)):
            with self.subTest(rows=type(rows)), self.assertRaises(WorkbenchError):
                health.analyze(rows)
        for rows in ([{"text": "a", "_expect": []}], [{"text": "a", "_test": False}]):
            with self.assertRaises(WorkbenchError):
                health.analyze(rows)
        with self.assertRaisesRegex(WorkbenchError, "instructions"):
            health.analyze(["a"], {"q": {"type": "noul"}})


if __name__ == "__main__":
    unittest.main()
