"""Test split: rows held out of tuning, never sent with their marker, scored on purpose and counted.
No key, no network."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient, fake_answers  # noqa: E402
from jev import agreement, checks, decisions, drift, testsplit, workbench  # noqa: E402
from jev.workbench import TEST_KEY, WorkbenchError  # noqa: E402

Q = {"refund": {"type": "noul", "instructions": "Does the sender want money back?"}}


def picker(state, questions):
    return {"refund": 0.98 if "refund" in state["text"] else 0.02}


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir
        rows = [json.dumps({"text": ("refund %d" if i % 2 else "thanks %d") % i, "_expect": {"refund": bool(i % 2)}})
                for i in range(20)] + ["unlabeled row"]
        workbench.save_dataset({"name": "Tickets", "rows": "\n".join(rows), "questions": Q})

    def tearDown(self):
        workbench.WORKBENCH_DIR = self._orig
        shutil.rmtree(self.dir, ignore_errors=True)

    def answered(self, rows):
        """Policy's rows for these dataset rows, answered by the fake model, labels from the rows."""
        out = []
        for i, row in rows:
            state, labels = workbench.split_labels(row, i + 1)
            out.append({"index": i, "answers": fake_answers(Q, picker(workbench.without_marks(state), Q)),
                        "labels": labels or {}})
        return out

    def held_out(self):
        dataset = workbench.load_dataset("tickets")
        return [(i, dataset["rows"][i]) for i in testsplit.test_indexes(dataset)]


class LockTests(Temp):
    def test_lock_marks_a_share_of_the_labeled_rows(self):
        dataset = testsplit.lock("tickets", 0.25, seed=1)
        marked = testsplit.test_indexes(dataset)
        self.assertEqual(len(marked), 5, "a quarter of 20 labeled rows")
        self.assertNotIn(20, marked, "the unlabeled row is never a test row")
        self.assertEqual(dataset["test"]["looks"], [])
        summary = workbench.dataset_summary(workbench.load_dataset("tickets"))
        self.assertEqual((summary["test"]["rows"], summary["test"]["looks"]), (5, 0))
        self.assertEqual(len(workbench.tuning_rows(dataset)), 16)
        with self.assertRaisesRegex(WorkbenchError, "already has test rows"):
            testsplit.lock("tickets", 0.25)

    def test_lock_rejects(self):
        with self.assertRaisesRegex(WorkbenchError, "share must be"):
            testsplit.lock("tickets", 0.9)
        workbench.save_dataset({"name": "Few", "rows": "\n".join(json.dumps({"text": "x%d" % i, "_expect": {"refund": True}})
                                                                 for i in range(5)), "questions": Q})
        with self.assertRaisesRegex(WorkbenchError, "Label more rows first"):
            testsplit.lock("few", 0.2)
        workbench.save_dataset({"name": "Ten", "rows": "\n".join(json.dumps({"text": "y%d" % i, "_expect": {"refund": True}})
                                                                 for i in range(10)), "questions": Q})
        self.assertEqual(len(testsplit.test_indexes(testsplit.lock("ten", 0.25, seed=1))), 3, "2.5 rounds up, as the page counts")

    def test_marker_must_be_true(self):
        with self.assertRaisesRegex(WorkbenchError, "_test must be true"):
            workbench.validate_rows([{"text": "x", TEST_KEY: "yes"}])
        with self.assertRaisesRegex(WorkbenchError, "_test must be true"):
            workbench.run_bulk(FakeClient(), [{"text": "x", TEST_KEY: False}], Q)

    def test_saving_again_keeps_the_record_of_looks(self):
        testsplit.lock("tickets", 0.25, seed=1)
        rows = self.held_out()
        testsplit.score("tickets", self.answered(rows), {"refund": 0.5})
        dataset = workbench.load_dataset("tickets")
        workbench.save_dataset({"name": "Tickets", "rows": dataset["rows"], "questions": Q})
        self.assertEqual(len(workbench.load_dataset("tickets")["test"]["looks"]), 1, "re-saving the rows keeps the count")
        fresh = workbench.save_dataset({"name": "Copy", "rows": dataset["rows"], "questions": Q})
        self.assertEqual(fresh["test"]["looks"], [], "rows saved with markers and no record start one")

    def test_remove_puts_the_rows_back(self):
        testsplit.lock("tickets", 0.25, seed=1)
        self.assertTrue(testsplit.remove("tickets"))
        dataset = workbench.load_dataset("tickets")
        self.assertEqual((testsplit.test_indexes(dataset), "test" in dataset), ([], False))
        self.assertFalse(testsplit.remove("tickets"))


class ModelTests(Temp):
    def test_the_marker_never_reaches_the_model(self):
        fake = FakeClient(picker)
        rows = [{"text": "refund me", TEST_KEY: True}, {"text": "hi", "lang": "en", TEST_KEY: True}]
        res = workbench.run_bulk(fake, rows, Q)
        self.assertEqual([state for state, _ in fake.calls], [{"text": "refund me"}, {"text": "hi", "lang": "en"}])
        self.assertEqual(res["results"][0]["row"], {"text": "refund me", TEST_KEY: True}, "the browser sees the marker")
        fake.calls.clear()
        workbench.run_bulk(fake, [{"text": "refund me"}, {"text": "refund me", TEST_KEY: True}], Q, field="message")
        self.assertEqual([state for state, _ in fake.calls], [{"text": "refund me"}] * 2, "a marked object keeps its fields")

    def test_compare_leaves_test_rows_out(self):
        fake = FakeClient(picker)
        variants = [{"questions": Q}, {"questions": Q}]
        res = workbench.run_compare(fake, ["refund a", {"text": "refund b", TEST_KEY: True}, "hi"], variants)
        self.assertEqual((res["rows"], res["held_out"], len(fake.calls)), (2, 1, 4))
        with self.assertRaisesRegex(WorkbenchError, "Every row is a test row"):
            workbench.run_compare(fake, [{"text": "x", TEST_KEY: True}], variants)

    def test_a_check_reruns_only_the_rows_it_was_tuned_on(self):
        testsplit.lock("tickets", 0.25, seed=1)
        checks.save_check("tickets", {"gates": {"refund": 0.5}, "model": "jev-1.14.0", "min_accuracy": 0.9})
        fake = FakeClient(picker)
        rep = checks.run(fake, "tickets")
        self.assertEqual((len(fake.calls), rep["rows"]), (16, 16))

    def test_compare_new_rows_leaves_test_rows_out(self):
        checks.save_check("tickets", {"gates": {"refund": 0.5}, "model": "jev-1.14.0", "min_accuracy": 0.9})
        fake = FakeClient(picker)
        rep = drift.run(fake, "tickets", [{"text": "refund new"}, {"text": "held", TEST_KEY: True}])
        self.assertNotIn({"text": "held"}, [state for state, _ in fake.calls], "the test row was never asked")
        self.assertIn("1 of the new rows is a test row", " ".join(rep["notes"]))
        with self.assertRaisesRegex(WorkbenchError, "Every new row is a test row"):
            drift.run(fake, "tickets", [{"text": "held", TEST_KEY: True}])

    def test_a_marked_row_is_the_same_row(self):
        self.assertEqual(decisions._key({"text": "x", TEST_KEY: True, "_expect": {"refund": True}}), decisions._key("x"))
        self.assertEqual(agreement.row_id({"text": "x", TEST_KEY: True}), agreement.row_id({"text": "x"}))


class ScoreTests(Temp):
    def test_score_records_the_look_never_the_answers(self):
        testsplit.lock("tickets", 0.25, seed=1)
        rows = self.held_out()
        rep = testsplit.score("tickets", self.answered(rows), {"refund": 0.5}, model="jev-1.14.0")
        self.assertEqual((rep["look"], rep["rows"], rep["labeled"], rep["automated"], rep["accuracy"]), (1, 5, 5, 5, 1.0))
        self.assertEqual(rep["questions"], [{"qid": "refund", "accuracy": 1.0, "accuracy_low": rep["questions"][0]["accuracy_low"],
                                             "accuracy_high": 1.0}])
        self.assertNotIn("rows", rep["questions"][0])
        look = workbench.load_dataset("tickets")["test"]["looks"][0]
        self.assertEqual(set(look), {"at", "gates", "signal", "model"})
        again = testsplit.score("tickets", self.answered(rows), {"refund": 0.9})
        self.assertEqual((again["look"], len(again["earlier"])), (2, 1))
        self.assertEqual(workbench.dataset_summary(workbench.load_dataset("tickets"))["test"]["looks"], 2)

    def test_score_rejects(self):
        with self.assertRaisesRegex(WorkbenchError, "no test rows"):
            testsplit.score("tickets", [], {"refund": 0.5})
        testsplit.lock("tickets", 0.25, seed=1)
        rows = self.answered(self.held_out())
        with self.assertRaisesRegex(WorkbenchError, "has 5 test rows and 4 came with answers"):
            testsplit.score("tickets", rows[:4], {"refund": 0.5})
        with self.assertRaisesRegex(WorkbenchError, "Threshold"):
            testsplit.score("tickets", rows, {"refund": 2})
        self.assertEqual(workbench.load_dataset("tickets")["test"]["looks"], [], "a rejected score is not a look")


if __name__ == "__main__":
    unittest.main()
