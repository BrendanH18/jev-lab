"""Holdout cross-validates tuned thresholds over answers Bulk already returned; these tests pin its folds and arithmetic."""

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import calibrate, examples, holdout, policy, workbench  # noqa: E402
from jev.calibrate import BOUNDS, TARGETS, CalibrationError  # noqa: E402


def noul(p):
    return {"type": "noul", "noul": p}


def random_rows(seed, n, qids=("a",), skill=0.35, floor=None):
    """Noul answers whose labels agree more often the more confident the answer is. With `floor`, each answer is
    right with that probability instead, whatever its confidence."""
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        answers, labels = {}, {}
        for q in qids:
            p = rng.random()
            chance = floor if floor is not None else 1 - skill + skill * abs(2 * p - 1)
            right = rng.random() < chance
            answers[q] = noul(p)
            labels[q] = (p >= 0.5) == right
        rows.append({"index": i, "answers": answers, "labels": labels, "key": "ticket %d" % i})
    return rows


def folds_of(rows, folds=holdout.FOLDS):
    return holdout.assign([r["key"] for r in rows], [r["index"] for r in rows], folds)


class FoldTests(unittest.TestCase):
    def test_assignment_is_pinned(self):
        # A change here moves rows between folds and so changes every reported number: keep it deliberate.
        keys = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"]
        self.assertEqual(holdout.assign(keys, list(range(7)), 3), [1, 0, 2, 0, 0, 1, 2])

    def test_folds_are_balanced_and_follow_the_key_not_the_request_order(self):
        keys = ["row %d" % i for i in range(43)]
        folds = holdout.assign(keys, list(range(43)), 5)
        sizes = [folds.count(f) for f in range(5)]
        self.assertLessEqual(max(sizes) - min(sizes), 1)
        order = list(range(43))
        random.Random(3).shuffle(order)
        shuffled = holdout.assign([keys[i] for i in order], order, 5)
        self.assertEqual(shuffled, [folds[i] for i in order])

    def test_identical_inputs_break_ties_by_index(self):
        self.assertEqual(holdout.assign(["same", "same", "x"], [0, 1, 2], 2), [0, 1, 0])
        self.assertEqual(holdout.assign(["x", "same", "same"], [2, 1, 0], 2), [0, 1, 0])


class EvaluateTests(unittest.TestCase):
    def test_matches_tuning_each_fold_with_tune_and_scoring_it_with_evaluate(self):
        # The reference uses only Policy's public routes: tune on the other folds, route the held-out fold.
        for seed, qids in ((5, ["a"]), (6, ["a", "b"])):
            rows = random_rows(seed, 80, qids)
            fold = folds_of(rows)
            for bound in BOUNDS:
                report = holdout.evaluate(rows, qids, bound=bound)
                whole = policy.tune(rows, qids, bound=bound)["targets"]
                for t, target in enumerate(TARGETS):
                    auto = good = unreached = 0
                    for f in range(holdout.FOLDS):
                        train = [r for r, g in zip(rows, fold) if g != f]
                        test = [r for r, g in zip(rows, fold) if g == f]
                        gates = policy.tune(train, qids, bound=bound)["targets"][t]["gates"]
                        if gates is None:
                            unreached += 1
                            continue
                        scored = policy.evaluate(test, gates)
                        auto += scored["automated"]
                        good += scored["correct"]
                    got = report["targets"][t]
                    with self.subTest(qids=qids, bound=bound, target=target):
                        self.assertEqual((got["unseen"]["automated"], got["unseen"]["correct"]), (auto, good))
                        self.assertEqual(got["unreached"], unreached)
                        self.assertEqual(got["unseen"]["coverage"], auto / len(rows))
                        self.assertEqual((got["unseen"]["low"], got["unseen"]["high"]), calibrate.wilson(good, auto))
                        self.assertEqual(got["tuned"] and got["tuned"]["gates"], whole[t]["gates"])
                        if got["tuned"]:
                            self.assertEqual(got["tuned"]["automated"], whole[t]["automated"])

    def test_one_question_matches_a_brute_force_of_calibrates_lowest_threshold(self):
        # Independent of the tuner: per fold, sweep every threshold on the training rows and take the lowest that
        # reaches the target, as Calibrate's shortcuts do, then route the held-out rows with it.
        for seed in range(4):
            rows = random_rows(10 + seed, 60)
            fold = folds_of(rows)
            signal = [abs(2 * r["answers"]["a"]["noul"] - 1) for r in rows]
            right = [(r["answers"]["a"]["noul"] >= 0.5) == r["labels"]["a"] for r in rows]
            for bound in BOUNDS:
                report = holdout.evaluate(rows, ["a"], bound=bound)
                for t, target in enumerate(TARGETS):
                    auto = good = 0
                    for f in range(holdout.FOLDS):
                        train = [i for i in range(len(rows)) if fold[i] != f]
                        lowest = None
                        for step in range(calibrate.STEPS + 1):
                            kept = [right[i] for i in train if signal[i] + calibrate._EPS >= step / calibrate.STEPS]
                            if calibrate.meets(sum(kept), len(kept), target, bound):
                                lowest = step / calibrate.STEPS
                                break
                        if lowest is None:
                            continue
                        held = [right[i] for i in range(len(rows)) if fold[i] == f and signal[i] + calibrate._EPS >= lowest]
                        auto += len(held)
                        good += sum(held)
                    unseen = report["targets"][t]["unseen"]
                    with self.subTest(seed=seed, bound=bound, target=target):
                        self.assertEqual((unseen["automated"], unseen["correct"]), (auto, good))

    def test_one_question_tunes_the_threshold_calibrate_shows(self):
        rows = random_rows(21, 120)
        cal_rows = [{"index": r["index"], "answer": r["answers"]["a"], "label": r["labels"]["a"]} for r in rows]
        for bound in BOUNDS:
            shortcuts = calibrate.evaluate(cal_rows, bound=bound)["targets"]
            report = holdout.evaluate(rows, ["a"], bound=bound)
            for shortcut, got in zip(shortcuts, report["targets"]):
                with self.subTest(bound=bound, target=shortcut["target"]):
                    self.assertEqual(got["tuned"] and got["tuned"]["gates"]["a"], shortcut["threshold"])

    def test_tuning_on_noise_shows_a_gap_on_unseen_rows(self):
        # Labels unrelated to confidence: any threshold that looks good fits the rows, not the question.
        rows = random_rows(2, 60, ("a", "b"), floor=0.9)
        target = holdout.evaluate(rows, ["a", "b"])["targets"][1]
        self.assertGreaterEqual(target["tuned"]["accuracy"], 0.95)
        self.assertGreater(target["gap"], 0.1)
        self.assertTrue(target["below"])
        self.assertEqual(sum(p["rows"] for p in target["parts"]), 60)
        lo, hi = target["spread"]["a"]
        self.assertLessEqual(lo, hi)

    def test_too_few_labeled_rows_report_the_minimum(self):
        rows = random_rows(4, 9)
        report = holdout.evaluate(rows, ["a"])
        self.assertEqual((report["labeled"], report["minimum"], report["targets"]), (9, 10, []))
        self.assertEqual(len(holdout.evaluate(rows, ["a"], folds=3)["targets"]), len(TARGETS))

    def test_rows_without_a_key_fall_back_to_their_index(self):
        rows = [{k: v for k, v in r.items() if k != "key"} for r in random_rows(8, 20)]
        report = holdout.evaluate(rows, ["a"])
        expected = holdout.assign(["#%d" % r["index"] for r in rows], [r["index"] for r in rows], holdout.FOLDS)
        self.assertEqual([p["rows"] for p in report["targets"][0]["parts"]], [expected.count(f) for f in range(5)])

    def test_refusals(self):
        rows = random_rows(9, 20)
        for folds in (1, 11, 2.5, True, "5", None):
            with self.subTest(folds=folds), self.assertRaises(CalibrationError):
                holdout.evaluate(rows, ["a"], folds=folds)
        with self.assertRaises(CalibrationError):
            holdout.evaluate(rows, ["a"], bound="vibes")
        with self.assertRaises(CalibrationError):
            holdout.evaluate(rows, [])
        with self.assertRaises(CalibrationError):
            holdout.evaluate("rows", ["a"])

    def test_sample_rows_end_to_end(self):
        sample = workbench.load_sample_rows()
        report = workbench.run_bulk(FakeClient(), sample, examples.BULK_QUESTIONS)
        rows = [{"index": r["index"], "answers": r["answers"], "labels": r["expect"], "key": str(r["row"])}
                for r in report["results"]]
        qids = list(examples.BULK_QUESTIONS)
        result = holdout.evaluate(rows, qids)
        self.assertEqual((result["labeled"], result["folds"]), (40, 5))
        self.assertEqual([sum(p["rows"] for p in t["parts"]) for t in result["targets"]], [40] * 3)


if __name__ == "__main__":
    unittest.main()
