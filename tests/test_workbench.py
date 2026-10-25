import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import examples, images, workbench  # noqa: E402
from jev.client import JevError  # noqa: E402

Q = {
    "dept": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "money", "tech": None}},
    "mood": {"type": "score", "instructions": "How upset?", "criteria": ["calm", "annoyed", "furious"]},
    "urgent": {"type": "noul", "instructions": "Urgent?"},
}


class ValidationTests(unittest.TestCase):
    def test_accepts_good_questions_and_examples(self):
        self.assertEqual(set(workbench.validate_questions(Q)), {"dept", "mood", "urgent"})
        for ex in examples.EXAMPLES:
            workbench.validate_questions(ex["questions"])

    def test_rejects_bad_shapes(self):
        bad = [
            {}, [], {"x": "not an object"}, {"x": {"type": "essay", "instructions": "?"}},
            {"x": {"type": "choice", "instructions": "?", "criteria": {}}},
            {"x": {"type": "score", "instructions": "?", "criteria": ["only one"]}},
            {"x": {"type": "noul"}}, {"x": {"type": "noul", "instructions": "?", "criteria": {"maybe": "x"}}},
            {"": {"type": "noul", "instructions": "?"}},
        ]
        for case in bad:
            with self.assertRaises(workbench.WorkbenchError, msg=repr(case)):
                workbench.validate_questions(case)
        with self.assertRaises(workbench.WorkbenchError):
            workbench.validate_state("")

    def test_box_questions_take_no_criteria_and_need_an_image(self):
        qs = workbench.validate_questions({"where": {"type": "box", "instructions": "the mug in `photo`"}})
        self.assertEqual(qs["where"], {"type": "box", "instructions": "the mug in `photo`"})
        with self.assertRaises(workbench.WorkbenchError):
            workbench.validate_questions({"where": {"type": "box", "instructions": "x", "criteria": {"a": "b"}}})
        with self.assertRaises(workbench.WorkbenchError) as ctx:
            workbench.run(FakeClient(), {"text": "no picture"}, qs)
        self.assertIn("need an image", str(ctx.exception))

    def test_images_must_be_referenced(self):
        q = {"bag": {"type": "noul", "instructions": "Is the bag in `photo` torn?"}}
        specs = {"photo-abc123": {"sample": "torn-bag"}}
        with self.assertRaises(workbench.WorkbenchError) as ctx:
            workbench.run(FakeClient(), {"photo": "nothing here"}, q, specs)
        self.assertIn("not referenced", str(ctx.exception))
        client = FakeClient(lambda s_, q_: {"bag": 0.9})
        out = workbench.run(client, {"photo": "photo-abc123"}, q, specs)
        self.assertEqual(out["answers"]["bag"]["noul"], 0.9)
        self.assertEqual(set(client.assets), {"photo-abc123"})

    def test_photo_example_validates(self):
        ex = examples.get("photo-locate")
        qs = workbench.validate_questions(ex["questions"])
        self.assertEqual(workbench.request_images(ex["state"], qs, ex["images"])["photo-torn-bag"]["sample"], "torn-bag")


class ExpectationTests(unittest.TestCase):
    def test_checks(self):
        choice = {"type": "choice", "choice": "billing", "probabilities": {"billing": 0.8, "tech": 0.2}, "confidence": 0.7}
        self.assertTrue(workbench.check_expectation(choice, {"choice": "billing", "min": 0.7})["ok"])
        self.assertFalse(workbench.check_expectation(choice, {"choice": "tech"})["ok"])
        score = {"type": "score", "score": 1.4}
        self.assertTrue(workbench.check_expectation(score, {"min": 1, "max": 2})["ok"])
        self.assertFalse(workbench.check_expectation(score, {"max": 1})["ok"])
        noul = {"type": "noul", "noul": 0.2}
        self.assertTrue(workbench.check_expectation(noul, {"max": 0.5})["ok"])
        self.assertEqual(workbench.default_expectation(noul), {"max": 0.5})
        self.assertEqual(workbench.default_expectation(choice), {"choice": "billing"})
        self.assertEqual(workbench.default_expectation(score), {"min": 0.9, "max": 1.9})

    def test_box_expectations_use_overlap(self):
        answer = {"type": "box", "box": {"left": 0.2, "top": 0.2, "right": 0.6, "bottom": 0.6}, "confidence": 0.8}
        expect = workbench.default_expectation(answer)
        self.assertEqual(expect["iou_min"], 0.5)
        self.assertTrue(workbench.check_expectation(answer, expect)["ok"])
        shifted = {"box": {"left": 0.4, "top": 0.4, "right": 0.8, "bottom": 0.8}, "iou_min": 0.5}
        verdict = workbench.check_expectation(answer, shifted)
        self.assertFalse(verdict["ok"])
        self.assertIn("IoU 0.14", verdict["checks"][0])
        self.assertAlmostEqual(workbench.iou(answer["box"], answer["box"]), 1.0)
        self.assertEqual(workbench.iou(answer["box"], {"left": 0.7, "top": 0.7, "right": 0.9, "bottom": 0.9}), 0.0)


class ItemTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir

    def tearDown(self):
        workbench.WORKBENCH_DIR = self._orig
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_a_malformed_expectation_fails_its_question_not_the_suite(self):
        q = {"urgent": {"type": "noul", "instructions": "Urgent?"},
             "where": {"type": "box", "instructions": "the tear in `photo`"}}
        bad = {"id": "bad", "name": "bad", "state": {"photo": "photo-abc123"}, "questions": q,
               "images": {"photo-abc123": {"sample": "torn-bag"}},
               "expect": {"where": {"box": {}}, "urgent": {"min": 10 ** 400}}}  # overflows float()
        good = {"id": "good", "name": "good", "state": "x", "questions": {"urgent": q["urgent"]},
                "expect": {"urgent": {"max": 0.5}}}
        report = workbench.run_items(FakeClient(), [bad, good])
        runs = {r["id"]: r for r in report["runs"]}
        self.assertFalse(runs["bad"]["ok"])
        self.assertIn("invalid expectation", runs["bad"]["results"]["where"]["checks"][0])
        self.assertFalse(runs["bad"]["results"]["urgent"]["ok"])
        self.assertTrue(runs["good"]["ok"], "the other test still runs and reports")
        self.assertEqual((report["passed"], report["failed"]), (1, 1))

    def test_save_list_run_delete(self):
        item = workbench.save_item({"name": "Angry refund → billing!", "state": "I want my money back now",
                                    "questions": Q, "expect": {"dept": {"choice": "billing"}, "urgent": {"min": 0.5}}})
        self.assertEqual(item["id"], "angry-refund-billing")
        self.assertEqual([i["id"] for i in workbench.list_items()], ["angry-refund-billing"])
        client = FakeClient(lambda s, q: {"dept": "billing", "urgent": 0.9})
        report = workbench.run_items(client, workbench.list_items())
        self.assertEqual((report["passed"], report["failed"]), (1, 0))
        run = report["runs"][0]
        self.assertTrue(run["results"]["dept"]["ok"])
        self.assertIsNone(run["results"]["mood"]["ok"])  # no expectation
        client = FakeClient(lambda s, q: {"dept": "tech", "urgent": 0.9})
        self.assertEqual(workbench.run_items(client, workbench.list_items())["failed"], 1)
        self.assertTrue(workbench.delete_item("angry-refund-billing"))
        self.assertEqual(workbench.list_items(), [])
        for bad in ("../x", "A B", ""):
            with self.assertRaises(workbench.WorkbenchError):
                workbench.load_item(bad)

    def test_saved_images_go_to_files_and_run_again(self):
        upload = images.wire_asset(images.sample_asset("crushed-box"))
        q = {"crushed": {"type": "noul", "instructions": "Is the box in `photo` crushed?"},
             "where": {"type": "box", "instructions": "the crushed corner in `photo`"}}
        item = workbench.save_item({
            "name": "Crushed box", "state": {"photo": "photo-up1234", "other": "photo-smp567"},
            "questions": dict(q, same={"type": "noul", "instructions": "Same scene as `other`?"}),
            "images": {"photo-up1234": {"format": "png", "data_base64": upload["data_base64"]},
                       "photo-smp567": {"sample": "torn-bag"}},
            "expect": {"where": {"box": {"left": 0.4, "top": 0.3, "right": 0.6, "bottom": 0.5}, "iou_min": 0.5}}})
        stored = item["images"]
        self.assertEqual(stored["photo-smp567"], {"sample": "torn-bag"})
        self.assertRegex(stored["photo-up1234"]["file"], r"^[0-9a-f]{16}\.png$")
        self.assertTrue((self.dir / "images" / stored["photo-up1234"]["file"]).exists())
        self.assertNotIn(upload["data_base64"][:200], (self.dir / "crushed-box.json").read_text())
        client = FakeClient(lambda s_, q_: {"crushed": 0.9})
        report = workbench.run_items(client, workbench.list_items())
        self.assertEqual(report["passed"], 1, report)
        self.assertEqual(set(client.assets), {"photo-up1234", "photo-smp567"})
        browser = workbench.item_images_for_browser(workbench.load_item("crushed-box"))
        self.assertEqual(browser["photo-up1234"]["data_base64"], upload["data_base64"])
        with self.assertRaises(workbench.WorkbenchError):
            workbench.item_image({"file": "../../.env"})


class BulkAndExportTests(unittest.TestCase):
    def test_bulk_runs_every_row(self):
        client = FakeClient(lambda s, q: {"dept": "tech" if "bug" in s["text"] else "billing", "urgent": 0.6})
        report = workbench.run_bulk(client, ["bug in app", "charged twice", ""], Q)
        self.assertEqual(report["rows"], 2)
        self.assertEqual(report["completed"], 2)
        self.assertEqual([r["answers"]["dept"]["choice"] for r in report["results"]], ["tech", "billing"])
        self.assertEqual(client.calls[0][0], {"text": "bug in app"})
        self.assertGreater(report["cost_usd"], 0)

    def test_bulk_stops_submitting_after_auth_or_budget_errors(self):
        class StopClient(FakeClient):
            def system_one(self, state, questions, assets=None, model=None):
                if state["text"] == "stop":
                    raise JevError("budget", status=402)
                if state["text"] == "limit":
                    raise JevError("slow", status=429)
                return super().system_one(state, questions, model=model)

        with patch.object(workbench, "BULK_CONCURRENCY", 1):
            stopped = workbench.run_bulk(StopClient(), ["stop", "later", "more"], Q)
            limited = workbench.run_bulk(StopClient(), ["limit", "ok"], Q)
        self.assertEqual(stopped["stopped"], "budget")
        self.assertEqual(stopped["completed"], 0)
        self.assertTrue(stopped["results"][0]["error"])
        self.assertTrue(stopped["results"][1]["skipped"])
        self.assertTrue(stopped["results"][2]["skipped"])
        self.assertIsNone(limited["stopped"])
        self.assertEqual(limited["completed"], 1)
        self.assertIn("answers", limited["results"][1])
        self.assertNotIn("skipped", limited["results"][1])

    def test_bulk_refuses_box_questions(self):
        with self.assertRaises(workbench.WorkbenchError):
            workbench.run_bulk(FakeClient(), ["a row"], {"b": {"type": "box", "instructions": "x"}})

    def test_export_refuses_unsafe_image_names(self):
        q = {"bag": {"type": "noul", "instructions": "Is the bag in `photo` torn?"}}
        for specs in ({"photo-abc123": {"sample": "torn-bag'; rm -rf ~ #"}},
                      {"photo-abc123": {"format": "jpg' && curl evil #"}},
                      {"photo-abc'123": {"sample": "torn-bag"}},
                      {"photo-abc123\n": {"sample": "torn-bag"}}):
            with self.subTest(specs=specs), self.assertRaises(workbench.WorkbenchError):
                workbench.export({"photo": "photo-abc123"}, q, "jev-1.14.0", specs)
        ok = workbench.export({"photo": "photo-abc123"}, q, "jev-1.14.0", {"photo-abc123": {"format": "png"}})
        self.assertIn("-F 'image-0=@photo-abc123.png'", ok["curl"])

    def test_export_with_images_loads_files(self):
        q = {"bag": {"type": "noul", "instructions": "Is the bag in `photo` torn?"},
             "where": {"type": "box", "instructions": "the tear in `photo`"}}
        out = workbench.export({"photo": "photo-abc123"}, q, "jev-1.14.0", {"photo-abc123": {"sample": "torn-bag"}})
        self.assertIn("Image(Path('torn-bag.png'))", out["python"])
        self.assertIn("TypeSafeClient(model='jev-1.14.0')", out["python"])
        self.assertIn('"model": "jev-1.14.0"', out["javascript"])
        self.assertIn("systemOne({ state, model, questions, assets }", out["javascript"])
        self.assertIn("Box(", out["python"])
        self.assertIn("result.boxes['where']", out["python"])
        self.assertIn("TypeSafe-Danger-Zone-Images", out["python"])
        compile(out["python"], "export.py", "exec")
        self.assertIn('image(await openAsBlob("torn-bag.png"))', out["javascript"])
        self.assertIn('"part": "image-0"', out["curl"])
        self.assertIn("-F 'image-0=@torn-bag.png'", out["curl"])
        self.assertNotIn("data_base64", json.dumps(out))

    def test_export_snippets(self):
        out = workbench.export({"text": "hi"}, Q, "jev-latest")
        self.assertIn("Choice(", out["python"])
        self.assertIn("Score(", out["python"])
        self.assertIn("Noul(", out["python"])
        self.assertIn("result.choices['dept']", out["python"])
        self.assertIn("TypeSafeClient(model='jev-latest')", out["python"])
        self.assertIn('"model": "jev-latest"', out["javascript"])
        self.assertIn("client.systemOne({ state, model, questions })", out["javascript"])
        self.assertIn('"model": "jev-latest"', out["curl"])
        compile(out["python"], "export.py", "exec")  # the Python snippet must at least parse


if __name__ == "__main__":
    unittest.main()
