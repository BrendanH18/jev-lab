"""Answer sets turn one question's labeled Bulk answers into a conformal cut; these tests pin the cut and the routing."""

import random
import sys
import time
from math import ceil
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import answersets, holdout  # noqa: E402
from jev.calibrate import CalibrationError  # noqa: E402

OPTIONS = ("billing", "shipping", "account", "other")


def choice(probs):
    best = max(probs, key=probs.get)
    return {"type": "choice", "choice": best, "probabilities": dict(probs)}


def row(i, probs, label, **extra):
    return dict({"index": i, "answer": choice(probs), "label": label, "key": "ticket %d" % i}, **extra)


def simulated(seed, n):
    """Choice answers drawn so the label follows the stated probabilities: a calibrated model, unsure on some rows."""
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        weights = [rng.random() ** 3 for _ in OPTIONS]
        total = sum(weights)
        probs = {k: w / total for k, w in zip(OPTIONS, weights)}
        label = rng.choices(OPTIONS, weights=[probs[k] for k in OPTIONS])[0]
        rows.append(row(i, probs, label, row={"channel": "email" if i % 2 else "chat"}))
    return rows


class CutTests(unittest.TestCase):
    def test_needed_rows_follow_the_coverage(self):
        self.assertEqual([answersets.needed(c) for c in answersets.COVERAGES], [4, 9, 19, 99])
        for c in answersets.COVERAGES:
            n = answersets.needed(c)
            self.assertIsNone(answersets.cut([0.1] * (n - 1), c))
            self.assertIsNotNone(answersets.cut([0.1] * n, c))

    def test_needed_is_immediate_near_full_coverage(self):
        start = time.monotonic()
        n = answersets.needed(0.999999999)
        self.assertLess(time.monotonic() - start, 0.1)
        self.assertLessEqual(ceil((n + 1) * 0.999999999 - 1e-9), n)
        self.assertGreater(ceil(n * 0.999999999 - 1e-9), n - 1)  # n - 1 rows would not do
        for c in [i / 1000 for i in range(500, 1000)] + [0.9999, 0.99999]:  # the closed form is the fewest rows
            n = answersets.needed(c)
            self.assertTrue(ceil((n + 1) * c - 1e-9) <= n and (n == 1 or ceil(n * c - 1e-9) > n - 1), c)

    def test_cut_is_the_conformal_quantile(self):
        # Ten scores, 90% coverage: the ceil(11 * 0.9) = 10th smallest, 0.9, so the cut is 0.1.
        scores = [i / 10 for i in range(10)]
        self.assertAlmostEqual(answersets.cut(scores, 0.9), 0.1)
        # 80%: the ceil(11 * 0.8) = 9th smallest, 0.8, so the cut is 0.2.
        self.assertAlmostEqual(answersets.cut(scores, 0.8), 0.2)

    def test_set_holds_every_option_at_the_cut_most_likely_first(self):
        probs = {"a": 0.2, "b": 0.5, "c": 0.3}
        self.assertEqual(answersets.answer_set(probs, 0.3), ["b", "c"])  # 0.3 equals the cut and joins
        self.assertEqual(answersets.answer_set(probs, 0.6), [])
        self.assertEqual(answersets.answer_set(probs, None), [])


class EvaluateTests(unittest.TestCase):
    def test_routes_by_set_size(self):
        rows = [row(i, {"billing": 0.9, "shipping": 0.05, "account": 0.03, "other": 0.02}, "billing") for i in range(8)]
        rows.append(row(8, {"billing": 0.45, "shipping": 0.45, "account": 0.05, "other": 0.05}, "shipping"))
        rows.append(row(9, {"billing": 0.25, "shipping": 0.25, "account": 0.25, "other": 0.25}, "other"))
        rep = answersets.evaluate(rows, 0.8)
        # Scores: eight 0.1, one 0.55, one 0.75; the 9th smallest is 0.55, so options need 0.45.
        self.assertAlmostEqual(rep["cut"], 0.45)
        by = {r["index"]: r for r in rep["rows"]}
        self.assertEqual((by[0]["route"], by[0]["set"]), ("auto", ["billing"]))
        self.assertEqual((by[8]["route"], sorted(by[8]["set"])), ("review", ["billing", "shipping"]))
        # No option reaches the cut: a person sees every option, so the list holds the label.
        self.assertEqual((by[9]["route"], by[9]["size"], by[9]["covered"]), ("review", 0, True))
        s = rep["summary"]
        self.assertEqual((s["single"], s["review"], s["short"], s["none"], s["covered"]), (8, 2, 1, 1, 10))
        self.assertEqual(s["sizes"], {"1": 8, "2": 1, "none": 1})
        self.assertEqual(s["listed_per_review"], 3.0)  # two options on one row, all four on the other
        self.assertEqual(s["options"], 4)

    def test_too_few_rows_for_the_coverage(self):
        rows = [row(i, {"billing": 0.9, "shipping": 0.1}, "billing") for i in range(18)]
        rep = answersets.evaluate(rows, 0.95)
        self.assertEqual((rep["cut"], rep["summary"], rep["needed"]), (None, None, 19))
        self.assertIsNotNone(answersets.evaluate(rows + [row(18, {"billing": 0.9, "shipping": 0.1}, "billing")], 0.95)["cut"])

    def test_noul_and_score(self):
        nouls = [{"index": i, "answer": {"type": "noul", "noul": p}, "label": label}
                 for i, (p, label) in enumerate([(0.9, "yes"), (0.8, True), (0.2, "no"), (0.6, "no"), (0.1, False)])]
        rep = answersets.evaluate(nouls, 0.8)
        self.assertEqual(rep["type"], "noul")
        self.assertEqual({r["label"] for r in rep["rows"]}, {"yes", "no"})
        self.assertTrue(all(r["covered"] for r in rep["rows"]))
        scores = [{"index": i, "answer": {"type": "score", "score": 1.0, "probabilities": {"0": 0.1, "1": 0.7, "2": 0.2}},
                   "label": label} for i, label in enumerate([1, 1, 1, 2, "1"])]
        rep = answersets.evaluate(scores, 0.8)
        self.assertEqual(rep["type"], "score")
        self.assertEqual(rep["rows"][3]["set"], ["1", "2"])  # the 5th smallest score is 0.8, so the cut is 0.2

    def test_unlabeled_invalid_and_bad_input(self):
        rows = [row(0, {"billing": 0.9, "shipping": 0.1}, None), row(1, {"billing": 0.9, "shipping": 0.1}, "nope")]
        rep = answersets.evaluate(rows, 0.9)
        self.assertEqual((rep["labeled"], rep["unlabeled"], len(rep["invalid"])), (0, 1, 1))
        with self.assertRaisesRegex(CalibrationError, "Box"):
            answersets.evaluate([{"index": 0, "answer": {"type": "box", "box": {}}, "label": None}])
        with self.assertRaisesRegex(CalibrationError, "same question"):
            answersets.evaluate([row(0, {"a": 1.0}, "a"), {"index": 1, "answer": {"type": "noul", "noul": 0.5}, "label": "yes"}])
        with self.assertRaisesRegex(CalibrationError, "Run Bulk"):
            answersets.evaluate([])
        for bad in (1, 0.4, True, "0.9"):
            with self.assertRaisesRegex(CalibrationError, "coverage"):
                answersets.evaluate([row(0, {"a": 1.0}, "a")], bad)

    def test_coverage_holds_on_unseen_rows_and_folds_never_see_their_rows(self):
        rows = simulated(7, 400)
        for target in (0.8, 0.9, 0.95):
            rep = answersets.evaluate(rows, target)
            self.assertGreaterEqual(rep["summary"]["coverage"], target)
            unseen = rep["holdout"]
            self.assertEqual(unseen["rows"], 400)
            self.assertGreaterEqual(unseen["high"], target)  # the interval reaches the target
            self.assertGreater(unseen["single"], 0)
            self.assertLess(unseen["listed_per_review"], 4)
        # A fold's cut comes only from the other folds: recompute fold 0's by hand.
        rep = answersets.evaluate(rows, 0.9)
        folds = holdout.assign([r["key"] for r in rows], [r["index"] for r in rows], holdout.FOLDS)
        train = [1 - r["answer"]["probabilities"][r["label"]] for r, f in zip(rows, folds) if f != 0]
        lo, hi = rep["holdout"]["spread"]
        self.assertTrue(lo - 1e-12 <= answersets.cut(train, 0.9) <= hi + 1e-12)

    def test_holdout_needs_rows_in_every_fold(self):
        rows = [row(i, {"billing": 0.9, "shipping": 0.1}, "billing") for i in range(9)]
        rep = answersets.evaluate(rows, 0.8)
        self.assertEqual(rep["holdout"], {"folds": 5, "minimum": 10})
        rep = answersets.evaluate(rows + [row(9, {"billing": 0.9, "shipping": 0.1}, "billing")], 0.8)
        self.assertEqual(rep["holdout"]["rows"], 10)
        # Each fold trains on 8 rows: enough for 80% (needs 4), so every fold has a cut.
        self.assertEqual(rep["holdout"]["unreached"], 0)
        rep = answersets.evaluate(rows + [row(9, {"billing": 0.9, "shipping": 0.1}, "billing")], 0.9)
        # 90% needs 9 rows and each fold trains on 8: no fold can promise it, so every row goes to review with every option.
        self.assertEqual((rep["holdout"]["unreached"], rep["holdout"]["single"], rep["holdout"]["spread"]), (5, 0, None))

    def test_slices_report_coverage_by_field(self):
        rep = answersets.evaluate(simulated(3, 60), 0.9)
        self.assertEqual(rep["slices"]["field"], "channel")
        self.assertEqual(sum(s["rows"] for s in rep["slices"]["slices"]), 60)
        self.assertEqual(rep["slices"]["overall"]["correct"], rep["summary"]["covered"])
        self.assertEqual(rep["slices"]["overall"]["automated"], rep["summary"]["single"])


if __name__ == "__main__":
    unittest.main()
