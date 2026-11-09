"""Compare slices and blank-label handoff reuse inputs without calls or writes."""

import copy
import json
import unittest
from unittest.mock import patch

from jev import compare, compare_workflows, prelabel
from jev.workbench import WorkbenchError


QUESTIONS = {"urgent": {"type": "noul", "instructions": "Urgent?"},
             "level": {"type": "score", "instructions": "Severity?", "criteria": ["Low", "High"]}}


def answer(value):
    return {"type": "noul", "noul": value}


class CompareSliceTests(unittest.TestCase):
    def test_slices_score_same_pairs_with_current_signal_and_basis(self):
        rows = [
            {"index": 0, "row": {"channel": "email"}, "label": True, "answers": [answer(.9), answer(.2)]},
            {"index": 1, "row": {"channel": "email"}, "label": True, "answers": [answer(.8), None]},
            {"index": 2, "row": {"channel": "chat"}, "label": False, "answers": [answer(.8), answer(.1)]},
            {"index": 3, "row": {"channel": "secret-held", "_test": True}, "label": True,
             "answers": [answer(.9), answer(.1)]},
        ]
        with patch("jev.client.JevClient.system_one", side_effect=AssertionError("no calls")), \
                patch("jev.workbench.write_dataset", side_effect=AssertionError("no writes")):
            report = compare_workflows.by_slice(rows, "channel", "top_probability", "B", "lower")
        self.assertEqual((report["paired_rows"], report["field"], report["bound"], report["signal"]),
                         (2, "channel", "lower", "top_probability"))
        for group in report["slices"]:
            expected = compare.evaluate([r for r in rows if r["row"]["channel"] == group["value"]],
                                        "top_probability", "B", "lower")
            self.assertEqual(group["paired"], expected["paired"])
            self.assertEqual([v["correct"] for v in group["variants"]],
                             [v["correct"] for v in expected["variants"]])
        self.assertNotIn("secret-held", json.dumps(report))

    def test_fields_hide_values_until_selected_and_keep_full_identity(self):
        values = ["x" * 100 + "A", "x" * 100 + "B"]
        rows = [{"index": index, "row": {"group": value, "_expect": {"urgent": True}},
                 "label": True, "answers": [answer(.9), answer(.8)]} for index, value in enumerate(values)]
        blank = compare_workflows.by_slice(rows)
        self.assertEqual(blank["fields"], [{"name": "group", "values": 2}])
        self.assertEqual(blank["slices"], [])
        report = compare_workflows.by_slice(rows, "group")
        self.assertEqual({r["value"] for r in report["slices"]}, set(values))
        self.assertEqual(len({r["shown"] for r in report["slices"]}), 1)

    def test_invalid_choice_label_excluded_from_both_and_missing_labels_not_scored(self):
        def choice(pick, keys):
            return {"type": "choice", "choice": pick, "probabilities": {key: 1 / len(keys) for key in keys}}
        rows = [{"index": i, "row": {"group": group}, "label": label,
                 "answers": [choice("a", ["a", "b"]), choice("a", ["a", "c"])]}
                for i, (group, label) in enumerate([("one", "b"), ("one", "a"), ("two", None)])]
        report = compare_workflows.by_slice(rows, "group")
        self.assertEqual(report["slices"][0]["excluded"], 1)
        self.assertEqual([v["labeled"] for v in report["slices"][0]["variants"]], [1, 1])
        self.assertEqual([v["labeled"] for v in report["slices"][1]["variants"]], [0, 0])


class CompareLabelingTests(unittest.TestCase):
    def test_maps_compare_positions_to_original_rows_and_preserves_source(self):
        rows = [{"text": "held-secret", "_test": True, "_expect": {"urgent": True}},
                {"text": "duplicate", "_image": "torn-bag"},
                {"text": "already", "_expect": {"urgent": False, "level": 0}},
                {"text": "duplicate", "_image": "torn-bag"},
                ["array"]]
        original = copy.deepcopy(rows)
        with patch("jev.client.JevClient.system_one", side_effect=AssertionError("no calls")), \
                patch("jev.workbench.write_dataset", side_effect=AssertionError("no writes")):
            report = compare_workflows.labeling(rows, QUESTIONS, [0, 1, 2, 3], "urgent")
        self.assertEqual(rows, original)
        self.assertEqual([item["index"] for item in report["items"]], [1, 3])
        self.assertEqual(report["eligible"], 2)
        self.assertEqual(report["missing"], 4)
        for secret in ("held-secret", "_expect", "_test", "already"):
            self.assertNotIn(secret, json.dumps(report))
        edited = prelabel.apply(rows, QUESTIONS, [{"index": 1, "labels": {"urgent": False, "level": 0}}])["rows"]
        self.assertEqual(edited[0], rows[0])
        self.assertEqual(edited[2], rows[2])
        self.assertEqual(edited[3], rows[3])
        self.assertEqual(edited[1]["_expect"], {"urgent": False, "level": 0})
        self.assertEqual(edited[1]["_image"], "torn-bag")

    def test_rejects_invalid_compact_indices_and_nonlabelable_question(self):
        for indices in ([True], [-1], [1], "0"):
            with self.assertRaises(WorkbenchError):
                compare_workflows.labeling(["one"], QUESTIONS, indices, "urgent")
        with self.assertRaises(WorkbenchError):
            compare_workflows.labeling(["one"], QUESTIONS, [0], "missing")


if __name__ == "__main__":
    unittest.main()
