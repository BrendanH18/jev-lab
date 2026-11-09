import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jev import checks, dataset_changes, workbench

Q = {"urgent": {"type": "noul", "instructions": "Urgent?"}}
CHECK = {"gates": {"urgent": 0.8}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
         "min_accuracy": 0.9, "min_coverage": 0.5}


class DatasetChangeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "workbench"
        self.patch = patch.object(workbench, "WORKBENCH_DIR", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def spec(self, rows=None):
        return {"name": "Tickets", "questions": copy.deepcopy(Q),
                "rows": rows or [{"text": "late", "_expect": {"urgent": True}}]}

    def test_new_preview_is_read_only_and_save_checks_missing_revision(self):
        spec = self.spec()
        report = dataset_changes.preview(spec)
        self.assertFalse(self.root.exists())
        self.assertFalse(report["exists"])
        self.assertEqual(report["rows"]["added"], 1)
        self.assertEqual(report["labels"]["added"], 1)
        dataset_changes.save(spec, report["revision"])
        with self.assertRaisesRegex(workbench.WorkbenchError, "changed after preview"):
            dataset_changes.save(spec, report["revision"])

    def test_input_and_label_counts_preserve_duplicate_occurrences(self):
        initial = self.spec([{"text": "same", "_expect": {"urgent": True}},
                             {"text": "same", "_expect": {"urgent": False}},
                             {"text": "gone", "_expect": {"urgent": True}}])
        saved = workbench.save_dataset(initial)
        path = workbench._dataset_path(saved["id"])
        before = path.read_bytes()
        replacement = self.spec([{"text": "same", "_expect": {"urgent": False}},
                                 {"text": "same", "_expect": {"other": 1}},
                                 {"text": "new", "_expect": {"urgent": False}}])
        report = dataset_changes.preview(replacement)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(report["rows"]["added"], 1)
        self.assertEqual(report["rows"]["removed"], 1)
        self.assertEqual(report["labels"], {"added": 2, "removed": 2, "changed": 1})
        self.assertNotIn("_expect", json.dumps(report))
        dataset_changes.save(replacement, report["revision"])
        self.assertEqual(workbench.load_dataset("tickets")["rows"], replacement["rows"])

    def test_check_and_test_implications_match_save_without_label_values(self):
        initial = self.spec([{"text": "secret-input", "_expect": {"urgent": "secret-label"}, "_test": True},
                             {"text": "open", "_expect": {"urgent": True}}])
        saved = workbench.save_dataset(initial)
        saved = checks.save_check(saved["id"], CHECK)
        saved["test"]["looks"] = [{"at": "earlier"}]
        workbench.write_dataset(saved)
        replacement = copy.deepcopy(initial)
        replacement["rows"][0]["_expect"]["urgent"] = False
        report = dataset_changes.preview(replacement)
        self.assertEqual(report["check"], "preserved")
        self.assertEqual(report["test"]["history"], "preserved")
        self.assertEqual(report["labels"]["changed"], 1)
        self.assertNotIn("secret", json.dumps(report))
        replacement["questions"] = {"other": Q["urgent"]}
        report = dataset_changes.preview(replacement)
        self.assertEqual(report["check"], "removed")
        saved = dataset_changes.save(replacement, report["revision"])
        self.assertIn("check_dropped", saved)
        self.assertNotIn("check", saved)
        self.assertEqual(saved["test"]["looks"], [{"at": "earlier"}])
        self.assertNotIn("check_dropped", workbench.load_dataset(saved["id"]))

    def test_stale_preview_rejects_file_edits_deletion_and_test_looks(self):
        spec = self.spec([{"text": "late", "_test": True, "_expect": {"urgent": True}}])
        workbench.save_dataset(spec)
        for change in ("notes", "test", "delete"):
            report = dataset_changes.preview(spec)
            saved = workbench.load_dataset("tickets")
            if change == "delete":
                workbench.delete_dataset("tickets")
            else:
                if change == "notes":
                    saved["notes"] = "someone else's edit"
                else:
                    saved["test"]["looks"].append({"at": "now"})
                workbench.write_dataset(saved)
            with self.assertRaisesRegex(workbench.WorkbenchError, "changed after preview"):
                dataset_changes.save(spec, report["revision"])

    def test_choice_order_picture_identity_and_split_movement(self):
        q = {"kind": {"type": "choice", "instructions": "Which?", "criteria": {"a": "a", "b": "b"}}}
        spec = {"name": "Tickets", "questions": q,
                "rows": [{"text": "x", "_image": "torn-bag"}, {"text": "y", "_test": True}]}
        workbench.save_dataset(spec)
        spec["questions"]["kind"]["criteria"] = {"b": "b", "a": "a"}
        spec["rows"] = [{"text": "x", "_image": "intact-bag"}, {"text": "y"}]
        report = dataset_changes.preview(spec)
        self.assertTrue(report["questions_changed"])
        self.assertEqual((report["rows"]["added"], report["rows"]["removed"]), (1, 1))
        self.assertEqual(report["test"], {"before": 1, "after": 0, "changed_membership": 1, "history": "removed"})

    def test_invalid_candidate_fails_before_any_write(self):
        spec = self.spec()
        workbench.save_dataset(spec)
        before = workbench._dataset_path("tickets").read_bytes()
        spec["questions"] = {"x": {"type": "box", "instructions": "where?"}}
        with self.assertRaises(workbench.WorkbenchError):
            dataset_changes.preview(spec)
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), before)
