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
        rows = [{"text": "same", "_expect": {"team": "billing", "urgent": "yes", "severity": "1.0"}},
                {"text": "same", "_expect": {"team": "billing", "urgent": True, "severity": 1}},
                {"text": "same", "_expect": {"team": "unknown", "urgent": None}}]
        out = health.analyze(rows, QUESTIONS)
        self.assertEqual(out["conflicts"], [])
        self.assertEqual(out["questions"][0], {"qid": "team", "type": "choice", "labeled": 2,
                                             "missing": 0, "missing_rows": [], "invalid": [3]})
        self.assertEqual(out["questions"][1]["missing_rows"], [3])

    def test_choice_labels_require_the_same_exact_match_as_calibrate(self):
        values = ["Billing", " billing ", "billing"]
        rows = [{"text": "same", "_expect": {"team": value}} for value in values]
        out = health.analyze(rows, QUESTIONS)
        self.assertEqual(out["questions"][0]["invalid"], [1, 2])
        self.assertEqual(out["questions"][0]["labeled"], 1)
        self.assertEqual(out["conflicts"], [])
        for value in values[:2]:
            with self.assertRaises(ValueError):
                health.calibrate._label("choice", value, {"probabilities": {"billing": 1.0, "shipping": 0.0}})

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

    def test_slices_count_label_status_and_distinct_inputs_by_split(self):
        rows = [{"channel": "email", "text": "same", "_expect": {"team": "billing"}},
                {"channel": "email", "text": "same", "_expect": {"team": "wrong"}},
                {"channel": "email", "text": "same", "_test": True, "_expect": {"team": "shipping"}},
                {"channel": "email", "text": "other", "_test": True},
                {"channel": "chat", "_expect": {"team": "wrong"}}]
        out = health.analyze(rows, QUESTIONS, "channel")["by_slice"]
        self.assertEqual(out["field"], "channel")
        email, chat = out["slices"]
        self.assertEqual((email["value"], email["rows"], email["unique_inputs"]), ("email", 4, 2))
        self.assertEqual(email["tuning"], {"rows": 2, "unique_inputs": 1, "questions": [
            {"qid": "team", "type": "choice", "labeled": 1, "missing": 0, "invalid": 1},
            {"qid": "urgent", "type": "noul", "labeled": 0, "missing": 2, "invalid": 0},
            {"qid": "severity", "type": "score", "labeled": 0, "missing": 2, "invalid": 0}]})
        self.assertEqual(email["test"]["questions"][0],
                         {"qid": "team", "type": "choice", "labeled": 1, "missing": 1, "invalid": 0})
        self.assertEqual((email["test"]["rows"], email["test"]["unique_inputs"]), (2, 2))
        self.assertEqual(chat["test"]["rows"], 0)
        for group in out["slices"]:
            for split in ("tuning", "test"):
                for question in group[split]["questions"]:
                    self.assertEqual(sum(question[k] for k in ("labeled", "missing", "invalid")),
                                     group[split]["rows"])

    def test_slices_normalize_values_and_include_absent_fields_and_text_rows(self):
        rows = [{"channel": 1}, {"channel": " 1 "}, {"channel": None}, "plain text",
                {"channel": {"a": 1, "b": 2}}, {"channel": {"b": 2, "a": 1}}]
        out = health.analyze(rows, field="channel")["by_slice"]
        self.assertEqual(out["fields"], [{"name": "channel", "values": 3}, {"name": "text", "values": 2}])
        self.assertEqual({group["value"]: group["rows"] for group in out["slices"]},
                         {"1": 2, "(none)": 2, '{"a": 1, "b": 2}': 2})
        self.assertTrue(all(not group["tuning"]["questions"] for group in out["slices"]))
        text = health.analyze(["same", {"text": "same", "_test": True}, "other"], field="text")["by_slice"]
        self.assertEqual((text["slices"][0]["rows"], text["slices"][0]["unique_inputs"]), (2, 1))

    def test_slice_grouping_uses_whole_values_before_truncating_display(self):
        prefix = "x" * health.slices.MAX_VALUE_CHARS
        rows = [{"channel": prefix + "a"}, {"channel": prefix + "b"}]
        out = health.analyze(rows, field="channel")["by_slice"]
        self.assertEqual(len(out["slices"]), 2)
        self.assertEqual(out["slices"][0]["value"], out["slices"][1]["value"])
        self.assertEqual([group["rows"] for group in out["slices"]], [1, 1])

    def test_slice_fields_exclude_marks_and_require_explicit_eligible_selection(self):
        rows = [{"channel": "email", "_expect": {"team": "billing"}},
                {"channel": "chat", "_test": True, "_expect": {"team": "shipping"}}]
        for field in (None, "missing", "_test", "_expect", {}, 3):
            with self.subTest(field=field):
                out = health.analyze(rows, QUESTIONS, field)["by_slice"]
                self.assertEqual(out, {"fields": [{"name": "channel", "values": 2}], "field": None, "slices": []})
        rows = [{"channel": str(i)} for i in range(health.slices.MAX_VALUES + 1)]
        self.assertEqual(health.analyze(rows, field="channel")["by_slice"],
                         {"fields": [], "field": None, "slices": []})

    def test_slice_report_hides_labels_and_other_inputs_without_side_effects(self):
        questions = {"q": {"type": "choice", "instructions": "Pick", "criteria": {"secret-a": None, "secret-b": None}}}
        rows = [{"channel": "email", "text": "private input", "_expect": {"q": "secret-a"}},
                {"channel": "chat", "text": "private input", "_test": True, "_expect": {"q": "secret-b"}}]
        original = copy.deepcopy(rows)
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("must not write")), \
                patch("jev.client.JevClient.system_one", side_effect=AssertionError("must not call")):
            report = health.analyze(rows, questions, "channel")
        self.assertEqual(rows, original)
        for secret in ("private input", "secret-a", "secret-b", "_expect", "_test"):
            self.assertNotIn(secret, json.dumps(report))

    def test_slice_distinct_inputs_keep_picture_names(self):
        first, second = list(workbench.images.SAMPLES)[:2]
        rows = [{"channel": "email", "_image": first},
                {"channel": "email", "_image": second}, {"channel": "chat"}]
        out = health.analyze(rows, field="channel")["by_slice"]
        self.assertEqual((out["slices"][0]["rows"], out["slices"][0]["unique_inputs"]), (2, 2))


if __name__ == "__main__":
    unittest.main()
