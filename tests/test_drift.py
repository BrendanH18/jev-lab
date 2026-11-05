"""Drift: compare new, unlabeled rows with a check's dataset through its gate. No key, no network."""

import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import check as check_script  # noqa: E402
from helpers import FakeClient, fake_answers  # noqa: E402
from jev import checks, decisions, drift, workbench  # noqa: E402
from jev.client import JevError  # noqa: E402
from jev.workbench import WorkbenchError  # noqa: E402

Q = {
    "dept": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "money", "tech": "bugs", "other": None}},
    "refund": {"type": "noul", "instructions": "Does the sender want money back?"},
    "urgency": {"type": "score", "instructions": "How urgent?", "criteria": ["Not", "Soon", "Now"]},
}
SPEC = {"gates": {"dept": 0.5, "refund": 0.6}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
        "min_accuracy": 0.9, "min_coverage": 0.5}


def result(index, dept, p, labels=None, text=None, urgency=0.0):
    out = {"index": index, "row": text or "row %d" % index,
           "answers": fake_answers(Q, {"dept": dept, "refund": p, "urgency": urgency}), "meta": {}}
    if labels is not None:
        out["expect"] = labels
    return out


def labeled(n, dept, p, right=True, start=0):
    """n dataset rows answered dept and P(refund) = p, labeled so the gated answers are right, or refund is wrong."""
    return [result(start + i, dept, p, {"dept": dept, "refund": (p >= 0.5) == right}) for i in range(n)]


def unlabeled(n, dept, p, start=0):
    return [result(start + i, dept, p) for i in range(n)]


CHECK = checks.validate_check(SPEC, Q)


class StatsTests(unittest.TestCase):
    def test_chi_square_tail_at_the_usual_critical_values(self):
        for x, df in ((3.841459, 1), (5.991465, 2), (7.814728, 3), (9.487729, 4), (11.070498, 5), (18.307038, 10),
                      (124.342113, 100)):
            self.assertAlmostEqual(drift.chi2_sf(x, df), 0.05, places=5, msg="df=%d" % df)
        self.assertEqual(drift.chi2_sf(0, 3), 1.0)
        self.assertLess(drift.chi2_sf(5000, 2), 1e-100)

    def test_fisher_exact_matches_published_tables(self):
        self.assertAlmostEqual(drift.fisher_exact(1, 9, 11, 3), 0.002759, places=6)
        self.assertAlmostEqual(drift.fisher_exact(8, 2, 1, 5), 0.0350, places=4)
        self.assertAlmostEqual(drift.fisher_exact(5, 5, 5, 5), 1.0)
        self.assertEqual(drift.fisher_exact(0, 3, 0, 4), 1.0, "one margin is empty: nothing can differ")

    def test_mann_whitney(self):
        # Small samples are exact: 2 of the 252 ways to split ten ranks five and five are this extreme.
        self.assertAlmostEqual(drift.mann_whitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]), 2 / 252)
        # Ties too: four 0.98s against four 0.80s is 2 of 70 splits, not the normal approximation's 0.02 or less.
        self.assertAlmostEqual(drift.mann_whitney([0.98] * 4, [0.8] * 4), 2 / 70)
        # Larger samples use the normal approximation: 40 rows against 40, fully separated.
        self.assertLess(drift.mann_whitney(list(range(40)), list(range(40, 80))), 1e-10)
        self.assertEqual(drift.mann_whitney([0.9, 0.9], [0.9, 0.9, 0.9]), 1.0, "every value tied")
        self.assertIsNone(drift.mann_whitney([], [0.5]))
        self.assertGreater(drift.mann_whitney([0.1, 0.5, 0.9], [0.2, 0.5, 0.8]), 0.5)

    def test_holm_skips_missing_tests(self):
        self.assertEqual(drift.holm([0.01, None, 0.04, 0.03]), [0.03, None, 0.06, 0.06])
        self.assertEqual(drift.holm([]), [])

    def test_mix_test(self):
        p, method = drift.mix_test({"a": 30, "b": 10, "c": 20}, {"a": 10, "b": 30, "c": 20})
        self.assertEqual(method, "chi-square")
        self.assertLess(p, 0.001)
        p, method = drift.mix_test({"a": 20, "b": 20, "c": 20}, {"a": 20, "b": 20, "c": 20})
        self.assertAlmostEqual(p, 1.0)
        # Rare answers are pooled; with too few rows for three groups, Fisher's test compares the top answer.
        p, method = drift.mix_test({"a": 3, "b": 1, "c": 1}, {"a": 1, "b": 3, "c": 0})
        self.assertEqual(method, "fisher")
        self.assertGreater(p, 0.05)
        self.assertEqual(drift.mix_test({"a": 5, "b": 0}, {"a": 7, "b": 0}), (None, None), "one answer everywhere")
        self.assertEqual(drift.mix_test({"a": 0}, {"a": 3}), (None, None), "no dataset answers")


class EstimateTests(unittest.TestCase):
    def test_borrows_from_the_closest_group_with_enough_rows(self):
        ref = ([(("billing",), 2, True)] * 6 + [(("tech",), 2, False)] * 3 + [(("tech",), 1, True)] * 3)
        value, levels = drift.estimate(ref, [(("billing",), 2)])
        self.assertEqual((value, levels), (1.0, ["answers_band"]))
        # tech, band 2 has 3 rows (too few), so it borrows from all 6 tech rows: half right.
        value, levels = drift.estimate(ref, [(("tech",), 2)])
        self.assertEqual((value, levels), (0.5, ["answers"]))
        # No labeled row answered other: every labeled automated row, 9 of 12 right.
        value, levels = drift.estimate(ref, [(("other",), 0)])
        self.assertEqual((value, levels), (0.75, ["all"]))
        self.assertEqual(drift.estimate([], [(("x",), 0)]), (None, []))
        self.assertEqual(drift.estimate(ref, []), (None, []))

    def test_interval_brackets_the_estimate_and_repeats(self):
        ref = [(("billing",), 2, True)] * 18 + [(("billing",), 2, False)] * 2
        new = [(("billing",), 2)] * 20
        low, high = drift.interval(ref, new)
        self.assertLessEqual(low, 0.9)
        self.assertGreaterEqual(high, 0.9)
        self.assertLess(high - low, 0.4)
        self.assertEqual((low, high), drift.interval(ref, new), "seeded")
        self.assertEqual(drift.interval([], new), (None, None))

    def test_groups_with_the_same_counts_draw_apart(self):
        # Two groups that are each 9 of 10 right are two uncertain accuracies, not one: averaging them over
        # half the new rows each narrows the interval compared with every row borrowing from one 9 of 10.
        one = [(("a",), 2, True)] * 9 + [(("a",), 2, False)]
        two = one + [(("b",), 2, True)] * 9 + [(("b",), 2, False)]
        low1, high1 = drift.interval(one, [(("a",), 2)] * 20)
        low2, high2 = drift.interval(two, [(("a",), 2)] * 10 + [(("b",), 2)] * 10)
        self.assertLess(high2 - low2, high1 - low1)

    def test_every_labeled_row_right_is_not_certainty(self):
        low, high = drift.interval([(("billing",), 2, True)] * 40, [(("billing",), 2)] * 30)
        self.assertEqual(high, 1.0, "the interval holds the estimate, 100%")
        self.assertTrue(0.9 < low < 0.98, low)  # about where 40 of 40's Wilson interval starts (91%)


class CompareTests(unittest.TestCase):
    def test_the_same_rows_are_steady(self):
        ref = labeled(20, "billing", 0.98) + labeled(20, "tech", 0.05, start=20)
        new = unlabeled(20, "billing", 0.98) + unlabeled(20, "tech", 0.05, start=20)
        rep = drift.compare(ref, new, CHECK, Q)
        self.assertEqual(rep["status"], "steady", rep["reasons"])
        self.assertEqual(rep["reasons"], [])
        self.assertEqual((rep["reference"]["share"], rep["new"]["share"]), (1.0, 1.0))
        self.assertEqual(rep["reference"]["accuracy"], 1.0)
        self.assertEqual(rep["estimate"]["accuracy"], 1.0)
        self.assertEqual(rep["estimate"]["levels"], {"answers_band": 40, "answers": 0, "all": 0})
        self.assertEqual([q["qid"] for q in rep["questions"]], ["dept", "refund", "urgency"], "gated questions first")
        self.assertEqual([q["gated"] for q in rep["questions"]], [True, True, False])
        dept = rep["questions"][0]
        self.assertEqual([m["answer"] for m in dept["mix"]], ["billing", "tech", "other"], "every option, in order")
        self.assertEqual(dept["distance"], 0.0)
        self.assertTrue(all(t["ok"] for t in rep["targets"].values()))

    def test_less_confident_new_rows_shift_the_automated_share(self):
        ref = labeled(30, "billing", 0.98)
        new = unlabeled(10, "billing", 0.98) + unlabeled(20, "billing", 0.7)  # confidence 0.4, held by 0.6
        rep = drift.compare(ref, new, CHECK, Q)
        self.assertEqual(rep["status"], "shift")
        self.assertTrue(rep["automation"]["shifted"])
        self.assertAlmostEqual(rep["new"]["share"], 1 / 3)
        refund = next(q for q in rep["questions"] if q["qid"] == "refund")
        self.assertTrue(refund["signal"]["shifted"])
        self.assertFalse(refund["mix_shifted"], "still yes on every row")
        self.assertEqual(rep["targets"]["coverage"], {"ok": False, "value": 1 / 3, "target": 0.5})
        text = " ".join(rep["reasons"])
        self.assertIn("automates 33.3% of the new rows and 100.0% of the dataset's", text)
        self.assertIn("refund is less confident on the new rows: median 0.40, against 0.96", text)
        self.assertIn("below the check's 50.0% minimum", text)

    def test_an_answer_mix_change_and_the_accuracy_it_implies(self):
        # The gate is right on billing and wrong on tech, at the same confidence, so the overall 50% hides
        # that new traffic that is mostly tech will be handled badly.
        ref = labeled(20, "billing", 0.98) + labeled(20, "tech", 0.98, right=False, start=20)
        new = unlabeled(4, "billing", 0.98) + unlabeled(36, "tech", 0.98, start=4)
        rep = drift.compare(ref, new, dict(CHECK, min_accuracy=0.5), Q)
        dept = rep["questions"][0]
        self.assertTrue(dept["mix_shifted"])
        self.assertEqual(dept["mix_method"], "fisher", "two answers seen: billing against the rest")
        self.assertAlmostEqual(dept["distance"], 0.4)
        self.assertEqual(rep["reference"]["accuracy"], 0.5)
        self.assertAlmostEqual(rep["estimate"]["accuracy"], 0.1)
        self.assertFalse(rep["targets"]["accuracy"]["ok"])
        self.assertFalse(rep["automation"]["shifted"], "every row is still automated")
        text = " ".join(rep["reasons"])
        self.assertIn("dept answers are mixed differently: tech is 90.0% of new answers and 50.0% of the dataset's", text)
        self.assertIn("estimated accuracy on the new automated rows is 10.0%", text)
        self.assertEqual(rep["status"], "shift")

    def test_rows_unlike_the_labels_are_worth_labeling(self):
        ref = labeled(20, "billing", 0.98) + labeled(2, "other", 0.98, start=20)
        new = unlabeled(10, "billing", 0.98) + [result(10, "other", 0.98, text="A brand new kind of message")]
        rep = drift.compare(ref, new, CHECK, Q)
        self.assertEqual(rep["thin_total"], 1)
        self.assertEqual(rep["thin"], [{"index": 10, "row": "A brand new kind of message", "answers": "dept=other, refund=yes"}])
        self.assertEqual(rep["estimate"]["levels"]["all"], 1)
        self.assertIn("1 of 11 new automated rows", " ".join(rep["reasons"]))

    def test_labels_on_new_rows_are_ignored_and_lower_bound_uses_the_interval(self):
        ref = labeled(40, "billing", 0.98)
        new = labeled(40, "billing", 0.98, right=False)  # wrong labels would sink a measured accuracy
        rep = drift.compare(ref, new, dict(CHECK, bound="lower", min_accuracy=0.95), Q)
        self.assertEqual(rep["estimate"]["accuracy"], 1.0)
        self.assertEqual(rep["targets"]["accuracy"]["bound"], "lower")
        self.assertEqual(rep["targets"]["accuracy"]["value"], rep["estimate"]["low"])

    def test_no_labels_means_no_estimate(self):
        rep = drift.compare(unlabeled(10, "billing", 0.98), unlabeled(10, "billing", 0.98), CHECK, Q)
        self.assertIsNone(rep["estimate"]["accuracy"])
        self.assertNotIn("accuracy", rep["targets"])
        self.assertIn("No labeled dataset row is automated", " ".join(rep["reasons"]))
        self.assertEqual(rep["status"], "steady")

    def test_rows_with_unreadable_gated_answers_leave_it_incomplete(self):
        new = unlabeled(4, "billing", 0.98) + [{"index": 4, "row": "x", "answers": {}}]
        rep = drift.compare(labeled(5, "billing", 0.98), new, CHECK, Q)
        self.assertEqual(rep["status"], "error")
        self.assertIn("1 of 5 new rows have no readable answer to a gated question", rep["reasons"][0])

    def test_unreadable_answers_cannot_be_compared(self):
        broken = [{"index": i, "row": "x", "answers": {"dept": {"type": "choice"}}} for i in range(3)]
        rep = drift.compare(labeled(5, "billing", 0.98), broken, CHECK, Q)
        self.assertEqual(rep["status"], "error")
        self.assertIn("No new row has a readable answer", rep["reasons"][0])


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir
        rows = [json.dumps({"text": "billing %d" % i, "_expect": {"dept": "billing", "refund": True}}) for i in range(12)]
        workbench.save_dataset({"name": "Tickets", "rows": "\n".join(rows), "questions": Q})
        checks.save_check("tickets", SPEC)

    def tearDown(self):
        workbench.WORKBENCH_DIR = self._orig
        shutil.rmtree(self.dir, ignore_errors=True)

    @staticmethod
    def client():
        # Billing rows want a refund with confidence; "unsure" rows do not clear the 0.6 refund gate.
        return FakeClient(lambda state, qs: {"dept": "tech" if "tech" in state["text"] else "billing",
                                             "refund": 0.7 if "unsure" in state["text"] else 0.98})


class RunTests(Temp):
    def test_runs_both_sets_of_rows_live_and_judges_the_check(self):
        fake = self.client()
        rep = drift.run(fake, "tickets", "\n".join(["billing again %d" % i for i in range(12)]))
        self.assertEqual(len(fake.calls), 24, "every dataset row and every new row, asked again")
        self.assertEqual(fake.models, ["jev-1.14.0"] * 24)
        self.assertEqual(rep["status"], "steady", rep["reasons"])
        self.assertEqual(rep["check_status"], "pass")
        self.assertEqual((rep["calls"], rep["model"], rep["name"]), (24, "jev-1.14.0", "Tickets"))
        self.assertEqual(rep["input_tokens"], 24000)

    def test_a_shift_and_a_model_override(self):
        fake = self.client()
        rows = ["unsure %d" % i for i in range(10)] + ["tech %d" % i for i in range(10)]
        rep = drift.run(fake, "tickets", rows, model="jev-1.13.0")
        self.assertEqual(rep["model"], "jev-1.13.0")
        self.assertEqual(fake.models, ["jev-1.13.0"] * 32)
        self.assertEqual(rep["status"], "shift")
        self.assertTrue(rep["automation"]["shifted"])
        self.assertTrue(rep["questions"][0]["mix_shifted"])
        self.assertEqual(rep["thin_total"], 10, "no labeled row answered tech")

    def test_versions_that_differ_between_the_runs_are_noted(self):
        fake = self.client()
        answered = iter(["jev-1.14.0"] * 12 + ["jev-1.15.0"] * 3)
        original = fake.system_one

        def system_one(*a, **kw):
            res = original(*a, **kw)
            res.model = next(answered)
            return res

        fake.system_one = system_one
        with patch.object(workbench, "BULK_CONCURRENCY", 1):
            rep = drift.run(fake, "tickets", "a\nb\nc")
        self.assertIn("answered by jev-1.14.0 and the new rows by jev-1.15.0", " ".join(rep["notes"]))

    def test_a_stopped_run_does_not_spend_on_the_new_rows(self):
        class Broke(FakeClient):
            def system_one(self, *a, **kw):
                self.calls.append(a)
                raise JevError("Budget reached", 402)

        broke = Broke()
        rep = drift.run(broke, "tickets", "a\nb")
        self.assertEqual(rep["status"], "error")
        self.assertIn("stopped early: Budget reached", rep["reasons"][0])
        self.assertLessEqual(len(broke.calls), 12, "the new rows were never sent")

    def test_rejects(self):
        with self.assertRaisesRegex(WorkbenchError, "Paste the new rows"):
            drift.run(self.client(), "tickets", "  \n ")
        with self.assertRaisesRegex(WorkbenchError, "up to 200 new rows"):
            drift.new_rows(["x"] * 201)
        with self.assertRaisesRegex(WorkbenchError, "New row 2 has labels but no state"):
            drift.new_rows(["ok", {"_expect": {"dept": "billing"}}])
        with self.assertRaisesRegex(WorkbenchError, "New row 1 must be text"):
            drift.new_rows([3])
        checks.remove_check("tickets")
        with self.assertRaisesRegex(WorkbenchError, "has no check"):
            drift.run(self.client(), "tickets", "a")


class LabelingTests(Temp):
    def test_full_inputs_and_pictures_are_queued_without_suggested_labels(self):
        photo = {"text": "tech " + "long message " * 100, "_image": "torn-bag", "channel": "email",
                 "_expect": {"dept": "other", "refund": False}}
        rows = ["tech %d" % i for i in range(25)] + [photo]
        fake = self.client()
        report = drift.run(fake, "tickets", rows)
        queue = report["labeling"]
        self.assertEqual(len(report["thin"]), 20)
        self.assertEqual(len(queue["items"]), 26, "the labeling queue is not capped to the report's preview")
        item = queue["items"][-1]
        self.assertEqual(item["row"], workbench.without_marks(photo))
        self.assertEqual((item["index"], item["line"]), (25, 26))
        self.assertEqual(item["labels"], dict.fromkeys(Q))
        self.assertEqual(item["open"], list(SPEC["gates"]))
        self.assertEqual(queue["questions"], Q)
        self.assertEqual(queue["room"], 188)
        self.assertNotIn("answers", json.dumps(queue))
        self.assertNotIn("candidates", json.dumps(queue))
        self.assertTrue(all("_expect" not in state for state, _ in fake.calls))

    def test_queue_skips_existing_and_duplicate_rows_and_reports_array_inputs(self):
        saved = workbench.load_dataset("tickets")
        saved["rows"].append({"text": "tech saved", "_expect": {"dept": "tech", "refund": True}})
        workbench.write_dataset(saved)
        fake = FakeClient(lambda state, qs: {"dept": "tech" if isinstance(state, list) or "tech" in state["text"]
                                            else "billing", "refund": 0.98})
        report = drift.run(fake, "tickets", ["tech saved", "tech new", {"text": "tech new"}, ["tech array"]])
        queue = report["labeling"]
        self.assertEqual(queue["counts"], {"eligible": 4, "in_dataset": 1, "repeated": 1,
                                           "unsupported": 1, "queued": 1})
        self.assertEqual(queue["items"][0]["row"], {"text": "tech new"})

    def test_marked_and_unmarked_test_rows_never_reach_the_new_run(self):
        saved = workbench.load_dataset("tickets")
        saved["rows"].append({"text": "tech held", "_test": True,
                              "_expect": {"dept": "tech", "refund": True}})
        saved["test"] = {"locked_at": "2026-11-05T00:00:00Z", "looks": []}
        workbench.write_dataset(saved)
        fake = self.client()
        report = drift.run(fake, "tickets", ["tech held", {"text": "tech held"},
                                             {"text": "tech marked", "_test": True}, "tech available"])
        self.assertEqual(report["new"]["rows"], 1)
        self.assertEqual(report["labeling"]["items"][0]["row"], {"text": "tech available"})
        self.assertEqual(len(fake.calls), 13)
        self.assertTrue(all("held" not in state["text"] and "marked" not in state["text"] for state, _ in fake.calls))
        self.assertIn("3 of the new rows are test rows", " ".join(report["notes"]))
        with self.assertRaisesRegex(WorkbenchError, "Every new row is a test row"):
            drift.run(fake, "tickets", ["tech held"])

    def test_append_keeps_only_human_labels_and_preserves_check_and_test_history(self):
        saved = workbench.load_dataset("tickets")
        saved["rows"][0]["_test"] = True
        saved["test"] = {"locked_at": "2026-11-05T00:00:00Z", "looks": [{"at": "earlier"}]}
        workbench.write_dataset(saved)
        row = {"text": "tech " + "full input " * 100, "_image": "torn-bag"}
        labels = {"dept": "other", "refund": False, "urgency": 0}
        item = {"row": row, "labels": labels, "kind": "audit", "answers": {"dept": "tech"},
                "candidates": {"dept": ["tech"]}}
        with patch.object(decisions, "audit_report", side_effect=AssertionError("targeted rows are not an audit")):
            out = drift.append_labels("tickets", [item], Q)
        self.assertEqual((out["added"], out["already"], out["room"]), (1, 0, 187))
        self.assertNotIn("audit", out)
        after = workbench.load_dataset("tickets")
        self.assertEqual(after["rows"][:-1], saved["rows"])
        self.assertEqual(after["rows"][-1], dict(row, _expect=labels))
        self.assertEqual(after["check"], saved["check"])
        self.assertEqual(after["test"], saved["test"])
        self.assertNotIn("answers", json.dumps(after))
        self.assertNotIn("candidates", json.dumps(after))

    def test_append_deduplicates_within_batch_and_against_test_rows(self):
        saved = workbench.load_dataset("tickets")
        saved["rows"][0]["_test"] = True
        workbench.write_dataset(saved)
        labels = {"dept": "tech", "refund": False}
        item = {"row": {"text": "tech new"}, "labels": labels}
        before = len(saved["rows"])
        out = drift.append_labels("tickets", [item, item, {"row": {"text": "billing 0"}, "labels": labels}], Q)
        self.assertEqual((out["added"], out["already"]), (1, 2))
        out = drift.append_labels("tickets", [item], Q)
        self.assertEqual((out["added"], out["already"]), (0, 1))
        after = workbench.load_dataset("tickets")
        self.assertEqual(len(after["rows"]), before + 1)
        self.assertEqual(after["rows"][0], saved["rows"][0], "a held-out identity is never relabeled")

    def test_append_rejects_partial_labels_stale_questions_test_marks_and_bad_photos_atomically(self):
        path = self.dir / "datasets" / "tickets.json"
        before = path.read_text()
        labels = {"dept": "tech", "refund": True}
        valid = {"row": {"text": "tech first"}, "labels": labels}
        for invalid in (
            {"row": {"text": "tech missing label"}, "labels": {"dept": "tech"}},
            {"row": {"text": "tech invalid label"}, "labels": dict(labels, refund="maybe")},
            {"row": {"text": "tech held", "_test": True}, "labels": labels},
            {"row": {"text": "tech marked", "_expect": labels}, "labels": labels},
            {"row": {"text": "tech path", "_image": "../secret.png"}, "labels": labels},
            {"row": {"text": "tech missing photo", "_image": "0123456789abcdef.jpg"}, "labels": labels},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(WorkbenchError):
                drift.append_labels("tickets", [valid, invalid], Q)
            self.assertEqual(path.read_text(), before)
        changed = dict(Q, refund=dict(Q["refund"], instructions="A different judgment"))
        with self.assertRaisesRegex(WorkbenchError, "questions changed"):
            drift.append_labels("tickets", [valid], changed)
        self.assertEqual(path.read_text(), before)
        checks.remove_check("tickets")
        with self.assertRaisesRegex(WorkbenchError, "has no check"):
            drift.append_labels("tickets", [valid], Q)

    def test_append_capacity_failure_leaves_dataset_unchanged(self):
        saved = workbench.load_dataset("tickets")
        saved["rows"] += ["existing %d" % i for i in range(187)]
        workbench.write_dataset(saved)
        items = [{"row": {"text": "tech %d" % i}, "labels": {"dept": "tech", "refund": True}}
                 for i in range(2)]
        with self.assertRaisesRegex(WorkbenchError, "room for 1 more rows"):
            drift.append_labels("tickets", items, Q)
        self.assertEqual(workbench.load_dataset("tickets"), saved)
        out = drift.append_labels("tickets", items[:1], Q)
        self.assertEqual((out["added"], out["room"]), (1, 0))

    def test_picture_checks_keep_box_questions_out_of_label_controls(self):
        questions = dict(Q, damage={"type": "box", "instructions": "The damage in `photo`"})
        workbench.save_dataset({"name": "Photos", "questions": questions, "rows": [
            {"text": "billing photo", "_image": "intact-bag", "_expect": {"dept": "billing", "refund": True}}]})
        checks.save_check("photos", SPEC)
        report = drift.run(self.client(), "photos", [{"text": "tech photo", "_image": "torn-bag"}])
        queue = report["labeling"]
        self.assertEqual(queue["questions"], Q)
        item = queue["items"][0]
        item["labels"].update(dept="tech", refund=False)
        drift.append_labels("photos", [item], queue["questions"])
        self.assertEqual(workbench.load_dataset("photos")["rows"][-1]["_image"], "torn-bag")
        with self.assertRaisesRegex(WorkbenchError, "Box questions need a picture"):
            drift.append_labels("photos", [{"row": {"text": "no picture"},
                                            "labels": {"dept": "tech", "refund": False}}], queue["questions"])


class ScriptTests(Temp):
    def main(self, *argv, client=None):
        out = io.StringIO()
        with patch.object(check_script, "JevClient", lambda: client), redirect_stdout(out):
            code = check_script.main(list(argv))
        return code, out.getvalue()

    def configured(self):
        fake = self.client()
        fake.configured, fake.backend = True, "fake"
        fake.guard = type("G", (), {"snapshot": lambda self: {"live_calls": 0, "input_tokens": 0, "spent_usd": 0.0}})()
        return fake

    def rows_file(self, lines, name="new.jsonl"):
        path = self.dir / name
        path.write_text("\n".join(lines))
        return str(path)

    def test_exit_status_follows_the_comparison(self):
        same = self.rows_file(["billing again %d" % i for i in range(12)])
        code, out = self.main("--drift", same, client=self.configured())
        self.assertEqual(code, 0, out)
        self.assertIn("the check on the dataset rows: PASS", out)
        self.assertIn("STEADY", out)
        moved = self.rows_file(["unsure %d" % i for i in range(10)] + ["tech %d" % i for i in range(10)])
        out_file = self.dir / "drift.json"
        code, out = self.main("tickets", "--drift", moved, "--out", str(out_file), client=self.configured())
        self.assertEqual(code, 1, out)
        self.assertIn("SHIFT", out)
        self.assertIn("worth labeling, new row 11 (dept=tech, refund=yes): tech 0", out)
        self.assertEqual(json.loads(out_file.read_text())["status"], "shift")

    def test_errors_exit_2(self):
        workbench.save_dataset({"name": "Other", "rows": json.dumps({"text": "x", "_expect": {"refund": True}}), "questions": Q})
        checks.save_check("other", SPEC)
        path = self.rows_file(["a"])
        code, out = self.main("--drift", path, client=self.configured())
        self.assertEqual(code, 2)
        self.assertIn("Name it: other, tickets", out)
        code, out = self.main("tickets", "--drift", str(self.dir / "missing.jsonl"), client=self.configured())
        self.assertEqual(code, 2)
        self.assertIn("Cannot read", out)
        code, out = self.main("tickets", "--drift", "", client=self.configured())
        self.assertEqual((code, "Cannot read" in out), (2, True), "an empty path never falls back to the plain check")
        code, out = self.main("tickets", "--drift", self.rows_file([""], "empty.jsonl"), client=self.configured())
        self.assertEqual((code, "Paste the new rows" in out), (2, True))
        nokey = self.configured()
        nokey.configured = False
        code, out = self.main("tickets", "--drift", path, client=nokey)
        self.assertEqual((code, "No API key" in out), (2, True))


if __name__ == "__main__":
    unittest.main()
