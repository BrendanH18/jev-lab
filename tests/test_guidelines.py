"""Labeling guidelines (jev/guidelines.py): validated, saved with a dataset, carried in bundles and through check saves and
upgrades, reported by question id in replacement previews, and never sent to the model. No key, no network."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from helpers import FakeClient  # noqa: E402
from jev import (agreement, bundles, checks, dataset_changes, drift, gate, guidelines, testsplit,  # noqa: E402
                 upgrade, workbench)
from jev.workbench import WorkbenchError  # noqa: E402

Q = {
    "dept": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "money", "tech": "bugs", "other": None}},
    "refund": {"type": "noul", "instructions": "Does the sender want money back?"},
    "tone": {"type": "score", "instructions": "How upset?", "criteria": ["calm", "annoyed", "angry"]},
}
SPEC = {"gates": {"dept": 0.5, "refund": 0.6}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
        "tuned_on": "jev-1.14.0", "min_accuracy": 0.9, "min_coverage": 0.5}
# Marker strings that must never appear in a model request, an exported gate, or a preview report.
NOTE = "GUIDE-NOTE-7f3a"
INPUT = "GUIDE-INPUT-9c1e"
WHY = "GUIDE-WHY-2b8d"
GUIDES = {
    "dept": {"note": NOTE + " Billing is anything about charges.",
             "examples": [{"input": INPUT + " I was charged twice", "label": "billing", "why": WHY},
                          {"input": "The app crashes on launch", "label": "tech"}]},
    "refund": {"note": "Yes only when the sender asks for money back.",
               "examples": [{"input": "Please refund my order", "label": "yes"}]},
    "tone": {"examples": [{"input": "This is the third time!", "label": "2", "why": "Repeated complaint"}]},
}
MARKERS = (NOTE, INPUT, WHY)


def rows(n=20):
    return "\n".join(json.dumps({"text": ("refund %d" if i % 2 else "thanks %d") % i,
                                 "_expect": {"dept": "billing", "refund": bool(i % 2)}}) for i in range(n))


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir

    def tearDown(self):
        workbench.WORKBENCH_DIR = self._orig
        shutil.rmtree(self.dir, ignore_errors=True)

    def save(self, **extra):
        return workbench.save_dataset(dict({"name": "Tickets", "rows": rows(), "questions": Q, "guidelines": GUIDES}, **extra))

    def assertNoMarkers(self, value, what):
        text = value if isinstance(value, str) else json.dumps(value, default=str)
        for marker in MARKERS:
            self.assertNotIn(marker, text, "%s carries a guideline" % what)


class ValidateTests(unittest.TestCase):
    def test_cleans_labels_with_the_labeling_validation(self):
        out = guidelines.validate(GUIDES, Q)
        self.assertIs(out["refund"]["examples"][0]["label"], True)
        self.assertEqual(out["tone"]["examples"][0]["label"], 2)
        self.assertEqual(out["dept"]["examples"][0], {"input": INPUT + " I was charged twice", "label": "billing", "why": WHY})
        self.assertNotIn("why", out["dept"]["examples"][1])
        folded = guidelines.validate({"dept": {"examples": [{"input": "x", "label": "BILLING"}]}}, Q)
        self.assertEqual(folded["dept"]["examples"][0]["label"], "billing")

    def test_empty_entries_and_values_are_left_out(self):
        self.assertEqual(guidelines.validate(None, Q), {})
        self.assertEqual(guidelines.validate({}, {}), {})
        self.assertEqual(guidelines.validate({"dept": {"note": "  ", "examples": []}}, Q), {})

    def test_rejects_unknown_questions_and_bad_shapes(self):
        cases = [
            ({"nope": {"note": "x"}}, "no such question"),
            ([], "object keyed by question id"),
            ({"dept": "x"}, "note and examples"),
            ({"dept": {"note": "x", "answers": {}}}, "unknown field"),
            ({"dept": {"note": 3}}, "must be text"),
            ({"dept": {"examples": {"input": "x"}}}, "must be a list"),
            ({"dept": {"examples": [{"input": "", "label": "billing"}]}}, "input is required"),
            ({"dept": {"examples": [{"input": "x", "label": "billing", "answer": "tech"}]}}, "unknown field"),
            ({"refund": {"examples": [{"input": "x", "label": None}]}}, "not a valid answer"),
        ]
        for raw, message in cases:
            with self.subTest(raw=raw), self.assertRaises(WorkbenchError) as ctx:
                guidelines.validate(raw, Q)
            self.assertIn(message, str(ctx.exception))
        with self.assertRaises(WorkbenchError) as ctx:
            guidelines.validate({"dept": {"note": "x"}}, None)
        self.assertIn("with its questions", str(ctx.exception))

    def test_invalid_labels_are_rejected_without_echoing_them(self):
        for qid, label in (("dept", "SECRET-OPTION"), ("refund", "SECRET-maybe"), ("tone", 7), ("tone", True)):
            with self.subTest(qid=qid), self.assertRaises(WorkbenchError) as ctx:
                guidelines.validate({qid: {"examples": [{"input": "x", "label": label}]}}, Q)
            self.assertNotIn(str(label), str(ctx.exception).replace("example 1", ""))

    def test_box_questions_take_a_note_but_no_examples(self):
        q = {"where": {"type": "box", "instructions": "Where is the cup?"}}
        self.assertEqual(guidelines.validate({"where": {"note": "Box the whole cup"}}, q), {"where": {"note": "Box the whole cup"}})
        with self.assertRaises(WorkbenchError) as ctx:
            guidelines.validate({"where": {"examples": [{"input": "x", "label": "0.1"}]}}, q)
        self.assertIn("Box questions take a note", str(ctx.exception))

    def test_limits(self):
        cases = [
            ({"dept": {"note": "x" * (guidelines.MAX_NOTE_CHARS + 1)}}, "too long"),
            ({"dept": {"examples": [{"input": "x", "label": "tech"}] * (guidelines.MAX_EXAMPLES + 1)}}, "at most"),
            ({"dept": {"examples": [{"input": "x" * (guidelines.MAX_INPUT_CHARS + 1), "label": "tech"}]}}, "too long"),
            ({"dept": {"examples": [{"input": "x", "label": "tech", "why": "y" * (guidelines.MAX_WHY_CHARS + 1)}]}}, "too long"),
        ]
        for raw, message in cases:
            with self.subTest(message=message), self.assertRaises(WorkbenchError) as ctx:
                guidelines.validate(raw, Q)
            self.assertIn(message, str(ctx.exception))
        self.assertEqual(len(guidelines.validate({"dept": {"note": "x" * guidelines.MAX_NOTE_CHARS}}, Q)["dept"]["note"]),
                         guidelines.MAX_NOTE_CHARS)


class ReconcileTests(unittest.TestCase):
    def test_removed_questions_and_unfit_examples_are_dropped_with_warnings(self):
        clean = guidelines.validate(GUIDES, Q)
        fewer = {"dept": dict(Q["dept"], criteria={"billing": "money", "other": None}), "tone": Q["tone"]}
        out, warnings = guidelines.reconcile(clean, fewer)
        self.assertNotIn("refund", out)
        self.assertEqual([e["label"] for e in out["dept"]["examples"]], ["billing"], "the tech example no longer fits")
        self.assertEqual(out["tone"], clean["tone"])
        self.assertEqual(sorted(warnings), [
            "Dropped 1 labeling example for dept: its label no longer fits the question",
            "Dropped the labeling guideline for refund: the question is no longer in the dataset"])
        self.assertNotIn("tech", " ".join(warnings), "a warning never repeats a label")

    def test_never_raises(self):
        self.assertEqual(guidelines.reconcile(None, Q), ({}, []))
        self.assertEqual(guidelines.reconcile({"dept": "x"}, Q)[0], {})
        self.assertEqual(guidelines.reconcile({"dept": {"note": "x"}}, None)[0], {})
        out, warnings = guidelines.reconcile({"dept": {"note": 5, "examples": "x"}}, Q)
        self.assertEqual(out, {})
        self.assertEqual(len(warnings), 2)


class DatasetTests(Temp):
    def test_saved_with_the_dataset_and_counted_in_the_summary(self):
        saved = self.save()
        self.assertEqual(saved["guidelines"], guidelines.validate(GUIDES, Q))
        self.assertEqual(workbench.load_dataset("tickets")["guidelines"], saved["guidelines"])
        self.assertEqual(workbench.dataset_summary(saved)["guidelines"], 3)
        self.assertEqual(workbench.list_datasets()[0]["guidelines"], 3)
        text = (self.dir / "datasets" / "tickets.json").read_text(encoding="utf-8")
        self.assertLess(text.index('"guidelines"'), text.index('"rows"'), "rows stay last, one per line")

    def test_a_save_without_guidelines_keeps_the_saved_ones(self):
        self.save()
        again = workbench.save_dataset({"name": "Tickets", "rows": rows(22), "questions": Q})
        self.assertEqual(again["guidelines"], guidelines.validate(GUIDES, Q))
        self.assertNotIn("guidelines_dropped", again)
        cleared = workbench.save_dataset({"name": "Tickets", "rows": rows(), "questions": Q, "guidelines": {}})
        self.assertNotIn("guidelines", cleared)
        self.assertNotIn("guidelines", workbench.load_dataset("tickets"))

    def test_removing_a_question_drops_its_guideline_with_a_warning(self):
        self.save()
        fewer = {k: v for k, v in Q.items() if k != "refund"}
        saved = workbench.save_dataset({"name": "Tickets", "rows": rows(), "questions": fewer})
        self.assertEqual(set(saved["guidelines"]), {"dept", "tone"})
        self.assertEqual(len(saved["guidelines_dropped"]), 1)
        self.assertIn("refund", saved["guidelines_dropped"][0])
        on_disk = workbench.load_dataset("tickets")
        self.assertEqual(set(on_disk["guidelines"]), {"dept", "tone"})
        self.assertNotIn("guidelines_dropped", on_disk, "a warning is reported, not saved")
        without = workbench.save_dataset({"name": "Tickets", "rows": rows()})
        self.assertNotIn("guidelines", without, "a dataset saved without questions has no guidelines")
        self.assertEqual(len(without["guidelines_dropped"]), 2)

    def test_explicit_guidelines_for_a_missing_question_are_rejected(self):
        with self.assertRaises(WorkbenchError):
            workbench.save_dataset({"name": "Tickets", "rows": rows(), "questions": Q,
                                    "guidelines": {"nope": {"note": "x"}}})
        self.assertFalse((self.dir / "datasets" / "tickets.json").exists())

    def test_server_save_reports_dropped_guidelines(self):
        self.save()
        fewer = {k: v for k, v in Q.items() if k != "tone"}
        out = server.api_wb_dataset_save({"name": "Tickets", "rows": rows(), "questions": fewer})
        self.assertIn("tone", out["guidelines_dropped"][0])
        self.assertEqual(out["dataset"]["guidelines"], 2)

    def test_editor_load_and_save_change_only_the_guidelines(self):
        workbench.save_dataset({"name": "Tickets", "rows": rows(), "questions": Q})
        checks.save_check("tickets", SPEC)
        testsplit.lock("tickets", 0.25)
        before = workbench.load_dataset("tickets")
        self.assertEqual(server.api_wb_guidelines({"id": "tickets"})["guidelines"], {})
        out = server.api_wb_guidelines_save({"id": "tickets", "guidelines": GUIDES})
        self.assertEqual(out["guidelines"], guidelines.validate(GUIDES, Q))
        self.assertEqual(out["dataset"]["guidelines"], 3)
        after = workbench.load_dataset("tickets")
        for key in ("rows", "questions", "check", "test", "saved_at"):
            self.assertEqual(after[key], before[key], key)
        loaded = server.api_wb_guidelines({"id": "tickets"})
        self.assertEqual(loaded["guidelines"], out["guidelines"])
        self.assertEqual(loaded["questions"], before["questions"])
        self.assertEqual(loaded["warnings"], [])
        with self.assertRaises(WorkbenchError):
            server.api_wb_guidelines_save({"id": "tickets", "guidelines": {"nope": {"note": "x"}}})
        self.assertEqual(workbench.load_dataset("tickets")["guidelines"], out["guidelines"], "a failed save changes nothing")
        server.api_wb_guidelines_save({"id": "tickets", "guidelines": {}})
        self.assertNotIn("guidelines", workbench.load_dataset("tickets"))
        self.assertIn(("POST", "/api/workbench/datasets/guidelines"), server.ROUTES)
        self.assertIn(("POST", "/api/workbench/datasets/guidelines/save"), server.ROUTES)

    def test_load_reports_a_hand_edited_guideline_for_a_missing_question(self):
        self.save()
        path = self.dir / "datasets" / "tickets.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["guidelines"]["gone"] = {"note": "x"}
        path.write_text(json.dumps(data), encoding="utf-8")
        loaded = guidelines.load("tickets")
        self.assertNotIn("gone", loaded["guidelines"])
        self.assertIn("gone", loaded["warnings"][0])


class PreservedTests(Temp):
    def setUp(self):
        super().setUp()
        self.save()
        self.guides = workbench.load_dataset("tickets")["guidelines"]

    def test_check_save_and_removal_keep_them(self):
        checks.save_check("tickets", SPEC)
        self.assertEqual(workbench.load_dataset("tickets")["guidelines"], self.guides)
        checks.remove_check("tickets")
        self.assertEqual(workbench.load_dataset("tickets")["guidelines"], self.guides)

    def test_upgrade_proposals_keep_them_and_are_not_changed_by_them(self):
        checks.save_check("tickets", SPEC)
        fake = FakeClient(lambda st, qs: {"dept": "billing", "refund": 0.98 if "refund" in st["text"] else 0.02})
        rep = upgrade.run(fake, "tickets", "jev-1.15.0")
        self.assertNoMarkers(fake.calls, "an upgrade request")
        for proposal in rep["proposals"].values():
            if proposal:
                self.assertNotIn("guidelines", proposal, "guidelines are not check configuration")
                checks.save_check("tickets", proposal)
                self.assertEqual(workbench.load_dataset("tickets")["guidelines"], self.guides)
        self.assertNoMarkers(rep, "an upgrade report")

    def test_test_split_and_label_settling_keep_them(self):
        testsplit.lock("tickets", 0.25)
        self.assertEqual(workbench.load_dataset("tickets")["guidelines"], self.guides)
        sample = agreement.sample("tickets", 2, 0)
        self.assertNoMarkers(sample, "an agreement sample")
        item = sample["items"][0]
        agreement.settle("tickets", [{"row_id": item["row_id"], "labels": {"dept": "tech"}}])
        self.assertEqual(workbench.load_dataset("tickets")["guidelines"], self.guides)


class NeverSentTests(Temp):
    """Every model-facing path reachable offline: the payloads built for the model and the exported source."""

    def setUp(self):
        super().setUp()
        self.save()
        checks.save_check("tickets", SPEC)
        self.dataset = workbench.load_dataset("tickets")
        self.fake = FakeClient(lambda st, qs: {"dept": "billing",
                                               "refund": 0.98 if "refund" in json.dumps(st) else 0.02})

    def test_rows_and_questions_never_carry_them(self):
        self.assertNoMarkers(self.dataset["rows"], "dataset rows")
        self.assertNoMarkers(self.dataset["questions"], "dataset questions")
        self.assertNoMarkers(workbench.bulk_questions(self.dataset["questions"]), "Bulk questions")

    def test_bulk_and_check_runs(self):
        workbench.run_bulk(self.fake, self.dataset["rows"], self.dataset["questions"])
        rep = checks.run(self.fake, "tickets")
        self.assertEqual(len(self.fake.calls), 40)
        self.assertNoMarkers(self.fake.calls, "a Bulk or check request")
        self.assertNoMarkers(rep, "a check report")

    def test_drift(self):
        rep = drift.run(self.fake, "tickets", "\n".join("billing again %d" % i for i in range(5)))
        self.assertTrue(self.fake.calls)
        self.assertNoMarkers(self.fake.calls, "a drift request")
        self.assertNoMarkers(rep, "a drift report")

    def test_compare(self):
        variants = [{"questions": self.dataset["questions"]}, {"questions": self.dataset["questions"], "model": "jev-1.15.0"}]
        workbench.run_compare(self.fake, workbench.tuning_rows(self.dataset), variants)
        self.assertTrue(self.fake.calls)
        self.assertNoMarkers(self.fake.calls, "a Compare request")

    def test_exported_gate_source_and_provenance_do_not_change(self):
        with_guides = gate.export_check("tickets")
        self.assertNoMarkers(with_guides, "an exported gate")
        provenance = gate.provenance(self.dataset["questions"], SPEC["gates"], "confidence", SPEC["model"])
        guidelines.save("tickets", {})
        self.assertEqual(gate.export_check("tickets"), with_guides, "guidelines are not gate configuration")
        self.assertEqual(gate.provenance(self.dataset["questions"], SPEC["gates"], "confidence", SPEC["model"]), provenance)

    def test_request_export(self):
        out = workbench.export({"text": "hello"}, self.dataset["questions"], "jev-1.14.0")
        self.assertNoMarkers(out, "an exported request")


class BundleTests(Temp):
    def test_round_trip(self):
        saved = self.save()
        bundle = bundles.export_bundle("tickets")
        preview = bundles.preview_bundle(bundle["data"])
        self.assertEqual(preview["dataset"]["guidelines"], saved["guidelines"])
        self.assertEqual(preview["summary"]["guidelines"], 3)
        imported = bundles.import_bundle(bundle["data"], "Tickets copy")
        self.assertEqual(imported["guidelines"], saved["guidelines"])
        self.assertEqual(workbench.load_dataset("tickets-copy")["guidelines"], saved["guidelines"])

    def test_a_bundle_with_invalid_guidelines_is_rejected(self):
        self.save()
        import base64
        import io
        import zipfile
        raw = base64.b64decode(bundles.export_bundle("tickets")["data"])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            manifest = json.loads(archive.read("dataset.json"))
        manifest["dataset"]["guidelines"]["nope"] = {"note": "x"}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("dataset.json", json.dumps(manifest))
        with self.assertRaises(WorkbenchError) as ctx:
            bundles.preview_bundle(base64.b64encode(buffer.getvalue()).decode("ascii"))
        self.assertIn("no such question", str(ctx.exception))


class PreviewTests(Temp):
    def test_reports_changes_by_question_id_without_values(self):
        self.save()
        changed = {"dept": {"note": NOTE + " changed", "examples": [{"input": INPUT, "label": "tech", "why": WHY}]},
                   "tone": GUIDES["tone"], "refund": None}
        changed = {k: v for k, v in changed.items() if v}
        rep = dataset_changes.preview({"name": "Tickets", "rows": rows(), "questions": Q, "guidelines": changed})
        self.assertEqual(rep["guidelines"], {"before": 3, "after": 2, "added": [], "removed": ["refund"],
                                             "changed": ["dept"], "dropped": []})
        self.assertNoMarkers(rep, "a replacement preview")
        self.assertNotIn("tech", json.dumps(rep["guidelines"]))
        self.assertEqual(workbench.load_dataset("tickets")["guidelines"], guidelines.validate(GUIDES, Q),
                         "a preview writes nothing")

    def test_reports_guidelines_dropped_with_their_question(self):
        self.save()
        fewer = {k: v for k, v in Q.items() if k != "refund"}
        rep = dataset_changes.preview({"name": "Tickets", "rows": rows(), "questions": fewer})
        self.assertEqual(rep["guidelines"]["removed"], ["refund"])
        self.assertEqual(len(rep["guidelines"]["dropped"]), 1)
        self.assertIn("refund", rep["guidelines"]["dropped"][0])
        self.assertNoMarkers(rep, "a replacement preview")

    def test_a_new_dataset_reports_its_guidelines_as_added(self):
        rep = dataset_changes.preview({"name": "Tickets", "rows": rows(), "questions": Q, "guidelines": GUIDES})
        self.assertEqual(rep["guidelines"]["added"], ["dept", "refund", "tone"])
        self.assertEqual(rep["guidelines"]["before"], 0)


if __name__ == "__main__":
    unittest.main()
