import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import examples, workbench  # noqa: E402

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


class ItemTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir

    def tearDown(self):
        workbench.WORKBENCH_DIR = self._orig
        shutil.rmtree(self.dir, ignore_errors=True)

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


class BulkAndExportTests(unittest.TestCase):
    def test_bulk_runs_every_row(self):
        client = FakeClient(lambda s, q: {"dept": "tech" if "bug" in s["text"] else "billing", "urgent": 0.6})
        report = workbench.run_bulk(client, ["bug in app", "charged twice", ""], Q)
        self.assertEqual(report["rows"], 2)
        self.assertEqual(report["completed"], 2)
        self.assertEqual([r["answers"]["dept"]["choice"] for r in report["results"]], ["tech", "billing"])
        self.assertEqual(client.calls[0][0], {"text": "bug in app"})
        self.assertGreater(report["cost_usd"], 0)

    def test_export_snippets(self):
        out = workbench.export({"text": "hi"}, Q, "jev-latest")
        self.assertIn("Choice(", out["python"])
        self.assertIn("Score(", out["python"])
        self.assertIn("Noul(", out["python"])
        self.assertIn("result.choices['dept']", out["python"])
        self.assertIn("client.systemOne({ state, questions })", out["javascript"])
        self.assertIn('"model": "jev-latest"', out["curl"])
        compile(out["python"], "export.py", "exec")  # the Python snippet must at least parse


if __name__ == "__main__":
    unittest.main()
