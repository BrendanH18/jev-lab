"""Bulk preflight checks exact request states without spending or revealing labels."""

import json
import unittest
from unittest.mock import patch

from jev import preflight, workbench
from jev.workbench import WorkbenchError


class PreflightTests(unittest.TestCase):
    def test_paths_use_bulk_wrapping_and_never_labels_or_test_markers(self):
        questions = {"q": {"type": "noul", "instructions": "Read `text` and `details.topic`."}}
        rows = ["plain", {"text": "ok", "details": {"topic": "coffee"}, "_expect": {"q": "secret"}},
                {"text": "held", "_test": True, "_expect": {"q": "held-secret"}}]
        report = preflight.check(rows, questions)
        self.assertEqual([f["row"] for f in report["findings"]], [1, 3])
        self.assertEqual(report["held_out"], 1)
        self.assertNotIn("secret", json.dumps(report))

    def test_picture_reference_matches_exact_bulk_state_without_calls_or_writes(self):
        name = next(iter(workbench.images.SAMPLES))
        questions = {"q": {"type": "box", "instructions": "Find the box in `photo`."}}
        with patch("jev.workbench._picture", return_value={}) as picture, patch("jev.client.JevClient.system_one", side_effect=AssertionError("call")):
            self.assertEqual(preflight.check([{"_image": name}], questions)["findings"], [])
            picture.assert_called_once()
        report = preflight.check([{"text": "no picture"}], questions)
        self.assertEqual({f["code"] for f in report["findings"]}, {"missing_path", "missing_picture"})

    def test_unavailable_picture_is_a_position_only_finding(self):
        name = next(iter(workbench.images.SAMPLES))
        with patch("jev.workbench._picture", side_effect=WorkbenchError("private path")):
            report = preflight.check([{"_image": name}], {"q": {"type": "noul", "instructions": "In `photo`?"}})
        self.assertEqual(report["findings"][0]["code"], "missing_picture")
        self.assertNotIn("private path", json.dumps(report))

    def test_backend_rejects_whitespace_colliding_question_ids(self):
        q = {"type": "noul", "instructions": "Read?"}
        with self.assertRaisesRegex(WorkbenchError, "unique"):
            workbench.validate_questions({"q": q, " q ": q})

    def test_uses_the_same_first_200_nonempty_rows_as_bulk(self):
        question = {"q": {"type": "noul", "instructions": "Read `text`."}}
        report = preflight.check([None, ""] + ["ok"] * 200 + [{"other": "outside cap"}], question)
        self.assertEqual(report["rows"], 200)
        self.assertEqual(report["findings"], [])
