"""Dataset revision history (jev/history.py): snapshots, retention, restore. No model calls, temp dirs only."""

import base64
import copy
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jev import bundles, checks, dataset_changes, drift, guidelines, history, testsplit, workbench
from jev.workbench import WorkbenchError

Q = {"urgent": {"type": "noul", "instructions": "Urgent?"}}
CHECK = {"gates": {"urgent": 0.8}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
         "min_accuracy": 0.9, "min_coverage": 0.5}
JEV = Path(__file__).resolve().parent.parent / "jev"


def rows(n=6, label="secret-label"):
    return [{"text": "ticket %d" % i, "_expect": {"urgent": i % 2 == 0}} for i in range(n)] + \
           [{"text": "private-input", "_expect": {"urgent": True}, "note": label}]


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "workbench"
        patcher = patch.object(workbench, "WORKBENCH_DIR", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)

    def spec(self, data=None, notes=""):
        return {"name": "Tickets", "notes": notes, "questions": copy.deepcopy(Q), "rows": data or rows()}

    def kept(self, dataset_id="tickets"):
        return [p.stem for p in history._revisions(dataset_id)]

    def current(self, dataset_id="tickets"):
        return workbench._dataset_path(dataset_id).read_bytes()

    def test_first_save_keeps_nothing_and_replacement_keeps_exact_bytes(self):
        workbench.save_dataset(self.spec())
        self.assertEqual(self.kept(), [])
        before = self.current()
        workbench.save_dataset(self.spec(notes="second"))
        [revision] = self.kept()
        self.assertRegex(revision, history.REVISION)
        path = history.history_dir() / "tickets" / (revision + ".json")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(path.parent.parent, workbench.datasets_dir() / ".history")
        self.assertEqual(list(path.parent.glob("*.partial")), [])

    def test_every_dataset_writer_snapshots_first(self):
        workbench.save_dataset(self.spec())
        bundle = bundles.export_bundle("tickets")["data"]  # replacing later, after other writes, is a real change
        writers = [
            ("save", lambda: workbench.save_dataset(self.spec(notes="edit"))),
            ("preview save", lambda: dataset_changes.save(self.spec(notes="again"),
                                                          dataset_changes.preview(self.spec(notes="again"))["revision"])),
            ("check save", lambda: checks.save_check("tickets", CHECK)),
            ("drift labels", lambda: drift.append_labels("tickets", [{"row": {"text": "new"}, "labels": {"urgent": True}}], Q)),
            ("check remove", lambda: checks.remove_check("tickets")),
            ("test lock", lambda: testsplit.lock("tickets", 0.3, seed=1)),
            ("test remove", lambda: testsplit.remove("tickets")),
            ("bundle replace", lambda: bundles.import_bundle(bundle, "Tickets", True)),
            ("delete", lambda: workbench.delete_dataset("tickets")),
        ]
        for name, write in writers:
            with self.subTest(writer=name):
                before = self.current()
                count = len(self.kept())
                write()
                self.assertEqual(len(self.kept()), count + 1)
                newest = history.history_dir() / "tickets" / (self.kept()[-1] + ".json")
                self.assertEqual(newest.read_bytes(), before)

    def test_no_module_writes_dataset_files_outside_write_dataset(self):
        # Review appends (decisions.append) and agreement settling write through workbench.write_dataset too; this
        # keeps any new writer from bypassing the snapshot.
        for path in JEV.glob("*.py"):
            if path.name in ("workbench.py", "history.py"):
                continue
            source = path.read_text()
            with self.subTest(module=path.name):
                for match in re.finditer(r"_dataset_path\([^)]*\)[^\n]*", source):
                    self.assertNotRegex(match.group(0), r"\.(write_text|write_bytes|unlink|replace|rename|open)\(")
                self.assertNotIn("datasets_dir()", source)
        for module in ("decisions.py", "agreement.py", "drift.py", "checks.py", "testsplit.py", "bundles.py"):
            self.assertIn("workbench.write_dataset(", (JEV / module).read_text())

    def test_identical_content_is_not_duplicated(self):
        saved = workbench.save_dataset(self.spec())
        workbench.write_dataset(saved)  # same text: nothing to undo
        self.assertEqual(self.kept(), [])
        first = self.current()
        workbench.save_dataset(self.spec(notes="b"))
        path = workbench._dataset_path("tickets")
        path.write_bytes(first)  # the file goes back to the kept content by hand
        workbench.save_dataset(self.spec(notes="c"))
        self.assertEqual(len(self.kept()), 1)
        self.assertEqual(history.snapshot("tickets"), history.snapshot("tickets"))
        self.assertEqual(len(self.kept()), 2)

    def test_newest_twenty_are_kept_in_order(self):
        for n in range(history.KEEP + 5):
            workbench.save_dataset(self.spec(notes="version %d" % n))
        kept = self.kept()
        self.assertEqual(len(kept), history.KEEP)
        self.assertEqual(kept, sorted(kept))
        listed = history.revisions("tickets")["revisions"]
        self.assertEqual([r["revision"] for r in listed], kept[::-1])
        oldest = json.loads((history.history_dir() / "tickets" / (kept[0] + ".json")).read_text())
        self.assertEqual(oldest["notes"], "version 4")

    def test_listing_has_counts_and_question_ids_but_no_label_values_or_rows(self):
        workbench.save_dataset(self.spec())
        checks.save_check("tickets", CHECK)
        testsplit.lock("tickets", 0.3, seed=1)
        workbench.save_dataset(self.spec(notes="next"))
        report = history.revisions("tickets")
        self.assertTrue(report["exists"])
        entry = report["revisions"][0]
        self.assertEqual((entry["rows"], entry["labeled"], entry["questions"], entry["checks"]), (7, 7, ["urgent"], 1))
        self.assertGreaterEqual(entry["test_rows"], 2)
        text = json.dumps(report)
        for secret in ("secret-label", "private-input", "_expect", "ticket 1"):
            self.assertNotIn(secret, text)

    def test_delete_keeps_history_and_restore_recreates_the_dataset(self):
        workbench.save_dataset(self.spec(notes="keep me"))
        workbench.delete_dataset("tickets")
        self.assertEqual([d["id"] for d in workbench.list_datasets()], [])
        self.assertEqual([d["id"] for d in history.deleted()], ["tickets"])
        [entry] = history.revisions("tickets")["revisions"]
        self.assertFalse(history.revisions("tickets")["exists"])
        report = history.preview("tickets", entry["revision"])
        self.assertEqual((report["exists"], report["revision"], report["rows"]["after"]), (False, "missing", 7))
        self.assertFalse(workbench._dataset_path("tickets").exists(), "preview writes nothing")
        restored = history.restore("tickets", entry["revision"], report["revision"])
        self.assertEqual(restored["notes"], "keep me")
        self.assertEqual(workbench.load_dataset("tickets")["rows"], rows())
        self.assertEqual(history.deleted(), [])

    def test_restore_is_undoable_and_brings_back_the_revisions_check(self):
        workbench.save_dataset(self.spec())
        checks.save_check("tickets", CHECK)
        with_check = self.current()
        checks.remove_check("tickets")
        changed = self.spec(data=rows()[:3], notes="smaller")
        workbench.save_dataset(changed)
        before_restore = self.current()
        target = [r for r in history.revisions("tickets")["revisions"] if r["checks"]][0]["revision"]
        report = history.preview("tickets", target)
        self.assertEqual(report["restoring"], target)
        self.assertEqual((report["rows"]["before"], report["rows"]["after"]), (3, 7))
        self.assertEqual((report["check"], report["check_changed"]), ("preserved", True))
        self.assertNotIn("secret-label", json.dumps(report))
        self.assertEqual(self.current(), before_restore)
        restored = history.restore("tickets", target, report["revision"])
        self.assertEqual(restored["check"]["gates"], {"urgent": 0.8})
        self.assertEqual(json.loads(with_check)["check"], workbench.load_dataset("tickets")["check"])
        # The file the restore replaced is now the newest revision, so the restore can be undone.
        newest = self.kept()[-1]
        self.assertEqual((history.history_dir() / "tickets" / (newest + ".json")).read_bytes(), before_restore)
        undo = history.preview("tickets", newest)
        history.restore("tickets", newest, undo["revision"])
        self.assertEqual(workbench.load_dataset("tickets")["notes"], "smaller")
        self.assertNotIn("check", workbench.load_dataset("tickets"))

    def test_restore_brings_back_the_revisions_guidelines_and_writes_no_notes(self):
        workbench.save_dataset(self.spec())
        guidelines.save("tickets", {"urgent": {"note": "Urgent means a customer is blocked today."}})
        guidelines.save("tickets", {"urgent": {"note": "Rewritten note."}})
        target = self.kept()[-1]  # the file holding the first note
        report = history.preview("tickets", target)
        self.assertEqual(report["guidelines"]["changed"], ["urgent"])
        self.assertNotIn("Urgent means", json.dumps(report))
        history.restore("tickets", target, report["revision"])
        self.assertEqual(workbench.load_dataset("tickets")["guidelines"]["urgent"]["note"],
                         "Urgent means a customer is blocked today.")
        # A revision whose guideline names a question the restore no longer has: dropped, reported, never written.
        raw = json.loads((history.history_dir() / "tickets" / (target + ".json")).read_text())
        raw["guidelines"]["gone"] = {"note": "for a removed question"}
        (history.history_dir() / "tickets" / (target + ".json")).write_text(json.dumps(raw))
        report = history.preview("tickets", target)
        restored = history.restore("tickets", target, report["revision"])
        self.assertTrue(restored["guidelines_dropped"])
        saved = workbench.load_dataset("tickets")
        self.assertNotIn("guidelines_dropped", saved)
        self.assertEqual(sorted(saved["guidelines"]), ["urgent"])

    def test_stale_preview_is_rejected_without_writing(self):
        workbench.save_dataset(self.spec())
        workbench.save_dataset(self.spec(notes="two"))
        target = self.kept()[0]
        report = history.preview("tickets", target)
        checks.save_check("tickets", CHECK)  # someone else's change after the preview
        before, kept = self.current(), self.kept()
        with self.assertRaisesRegex(WorkbenchError, "Preview the restore again"):
            history.restore("tickets", target, report["revision"])
        with self.assertRaisesRegex(WorkbenchError, "Preview the restore again"):
            history.restore("tickets", target, None)
        self.assertEqual((self.current(), self.kept()), (before, kept))

    def test_restore_keeps_test_looks_recorded_since_the_revision(self):
        workbench.save_dataset(self.spec())
        testsplit.lock("tickets", 0.3, seed=1)
        workbench.save_dataset(self.spec(notes="after split", data=workbench.load_dataset("tickets")["rows"]))
        target = self.kept()[-1]
        dataset = workbench.load_dataset("tickets")
        dataset["test"]["looks"].append({"at": "2026-11-01T00:00:00Z", "gates": {"urgent": 0.5}, "signal": "confidence"})
        workbench.write_dataset(dataset)
        report = history.preview("tickets", target)
        history.restore("tickets", target, report["revision"])
        self.assertEqual(len(workbench.load_dataset("tickets")["test"]["looks"]), 1)

    def test_ids_and_revisions_are_validated_against_traversal(self):
        workbench.save_dataset(self.spec())
        workbench.save_dataset(self.spec(notes="two"))
        good = self.kept()[0]
        for bad_id in ("../tickets", ".history", "", "Tickets", "a/b", "x" * 61):
            with self.subTest(id=bad_id), self.assertRaisesRegex(WorkbenchError, "Invalid dataset id"):
                history.revisions(bad_id)
            with self.subTest(id=bad_id), self.assertRaisesRegex(WorkbenchError, "Invalid dataset id"):
                history.preview(bad_id, good)
        for bad in ("../../tickets", good + "/../x", good[:-1], None, 3, "../tickets", good + ".json"):
            with self.subTest(revision=bad), self.assertRaisesRegex(WorkbenchError, "Invalid revision id"):
                history.preview("tickets", bad)
        with self.assertRaisesRegex(WorkbenchError, "no longer kept"):
            history.preview("tickets", "20000101T000000000000Z-000000000000")

    def test_revision_named_for_another_dataset_is_refused(self):
        workbench.save_dataset(self.spec())
        workbench.save_dataset(self.spec(notes="two"))
        path = history.history_dir() / "tickets" / (self.kept()[0] + ".json")
        raw = json.loads(path.read_text())
        raw["name"] = "Other"
        path.write_text(json.dumps(raw))
        with self.assertRaisesRegex(WorkbenchError, "different dataset"):
            history.preview("tickets", self.kept()[0])

    def test_history_is_never_listed_or_bundled(self):
        workbench.save_dataset(self.spec())
        workbench.save_dataset(self.spec(notes="two"))
        self.assertTrue((workbench.datasets_dir() / ".history").is_dir())
        self.assertEqual([d["id"] for d in workbench.list_datasets()], ["tickets"])
        self.assertEqual([d["id"] for d in checks.listed()], [])
        with self.assertRaisesRegex(WorkbenchError, "Invalid dataset id"):
            workbench.load_dataset(".history")
        exported = bundles.export_bundle("tickets")
        import io
        import zipfile
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(exported["data"]))) as archive:
            self.assertEqual(archive.namelist(), ["dataset.json"])
            self.assertNotIn(".history", archive.read("dataset.json").decode())

    def test_revisions_never_hold_model_answers(self):
        workbench.save_dataset(self.spec())
        checks.save_check("tickets", CHECK)
        testsplit.lock("tickets", 0.3, seed=1)
        drift.append_labels("tickets", [{"row": {"text": "new one"}, "labels": {"urgent": True},
                                         "answers": {"urgent": 0.97}, "candidates": {"urgent": [True]}}], Q)
        workbench.delete_dataset("tickets")
        allowed = {"id", "name", "notes", "saved_at", "questions", "rules", "check", "test", "rows"}
        for path in (history.history_dir() / "tickets").glob("*.json"):
            dataset = json.loads(path.read_text())
            self.assertLessEqual(set(dataset), allowed)
            for row in dataset["rows"]:
                if isinstance(row, dict):
                    self.assertLessEqual(set(row) - {"text", "note"}, {"_expect", "_test"})
            self.assertNotIn("0.97", path.read_text())
            self.assertNotIn("candidates", path.read_text())
            self.assertNotIn("answers", path.read_text())


if __name__ == "__main__":
    unittest.main()
