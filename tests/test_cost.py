"""Cost prices labeled rows over answers Bulk already returned; these tests pin its arithmetic and its search."""

import itertools
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from test_holdout import folds_of, random_rows  # noqa: E402
from jev import cost, holdout, policy  # noqa: E402
from jev.calibrate import CalibrationError  # noqa: E402


def noul_rows(cases):
    """cases: [(P(yes), label)] for one Noul question "u"."""
    return [{"index": i, "answers": {"u": {"type": "noul", "noul": p}}, "labels": {"u": label}, "key": "row %d" % i}
            for i, (p, label) in enumerate(cases)]


# Confidence |2p - 1|: 0.90 right, 0.80 wrong, 0.60 right, 0.40 right, 0.20 wrong, 0.10 right.
SIX = noul_rows([(0.95, True), (0.90, False), (0.80, True), (0.70, True), (0.60, False), (0.55, True)])


def choice(picked, conf, options=("billing", "shipping", "other")):
    rest = (1 - conf) / (len(options) - 1)
    return {"type": "choice", "choice": picked, "confidence": conf,
            "probabilities": {o: (conf if o == picked else rest) for o in options}}


# (answer, confidence, label): right, wrong (billing answered shipping), right, wrong (shipping answered other), right.
DEPT = [{"index": i, "answers": {"dept": choice(a, c)}, "labels": {"dept": label}}
        for i, (a, c, label) in enumerate([("billing", 0.9, "billing"), ("shipping", 0.7, "billing"),
                                           ("billing", 0.5, "billing"), ("other", 0.3, "shipping"),
                                           ("shipping", 0.8, "shipping")])]


def brute(levels, value):
    """Every combination of grid steps, with the same tie rule: most value, then most rows, then lowest thresholds."""
    n, k = len(levels), len(levels[0])
    best, arg = None, None
    for steps in itertools.product(range(101), repeat=k):
        auto = [i for i in range(n) if all(levels[i][q] >= steps[q] for q in range(k))]
        key = (round(sum(value[i] for i in auto), 9), len(auto), -sum(steps))
        if best is None or key > best:
            best, arg = key, list(steps)
    return None if best[1] == 0 or best[0] < 0 else arg


class ParseTests(unittest.TestCase):
    def test_prices_must_be_plain_numbers_in_range(self):
        for bad in (None, [], {"review": 1}, {"review": "1", "error": 2}, {"review": True, "error": 2},
                    {"review": -1, "error": 2}, {"review": 1, "error": float("nan")}, {"review": 1, "error": 2e6}):
            with self.assertRaises(CalibrationError, msg=repr(bad)):
                cost.parse(bad)
        self.assertEqual(cost.parse({"review": 0, "error": 3})["review"], 0.0)

    def test_mistakes_are_validated(self):
        ok = {"question": "q", "label": "a", "answer": "b", "cost": 5}
        self.assertEqual(cost.parse({"review": 1, "error": 2, "mistakes": [ok]})["mistakes"], {("q", "a", "b"): 5.0})
        for bad in ([dict(ok, answer="a")], [ok, dict(ok, cost=6)], [dict(ok, cost=-1)], [dict(ok, label="")],
                    ["q"], {"q": 1}, [dict(ok, label="l%d" % i) for i in range(cost.MAX_MISTAKES + 1)]):
            with self.assertRaises(CalibrationError, msg=repr(bad)):
                cost.parse({"review": 1, "error": 2, "mistakes": bad})

    def test_break_even(self):
        self.assertAlmostEqual(cost.break_even(1, 4), 0.75)
        self.assertEqual(cost.break_even(5, 2), 0.0)  # a review costs more than a mistake: always automate
        self.assertIsNone(cost.break_even(1, 0))


class RowCostTests(unittest.TestCase):
    def test_a_row_costs_its_most_expensive_mistake(self):
        prices = cost.parse({"review": 1, "error": 3, "mistakes": [
            {"question": "a", "label": "yes", "answer": "no", "cost": 5},
            {"question": "b", "label": "yes", "answer": "no", "cost": 8}]})
        scored = [
            {"right": {"a": True, "b": True}, "shown": {"a": ("yes", "yes"), "b": ("no", "no")}},
            {"right": {"a": False, "b": True}, "shown": {"a": ("no", "yes"), "b": ("no", "no")}},
            {"right": {"a": False, "b": False}, "shown": {"a": ("no", "yes"), "b": ("no", "yes")}},
            {"right": {"a": False, "b": True}, "shown": {"a": ("yes", "no"), "b": ("no", "no")}},  # unpriced direction
        ]
        self.assertEqual(cost.row_costs(scored, ["a", "b"], prices), [0.0, 5.0, 8.0, 3.0])
        self.assertEqual(cost.row_costs(scored, ["b"], prices), [0.0, 0.0, 8.0, 0.0])


class EvaluateTests(unittest.TestCase):
    def test_cheapest_threshold_by_hand(self):
        # At $1 a review and $3 a mistake, a right row saves 1 and a wrong one loses 2. Automating only the 0.90 row
        # saves 1, and so does automating the top four (3 - 2); ties go to automating more rows, so 0.21.
        rep = cost.evaluate(SIX, ["u"], costs={"review": 1, "error": 3}, gates={"u": 0.5})
        self.assertEqual(rep["best"]["gates"], {"u": 0.21})
        self.assertEqual((rep["best"]["automated"], rep["best"]["wrong"], rep["best"]["cost"]), (4, 1, 5.0))
        self.assertAlmostEqual(rep["best"]["per_1000"], 5 / 6 * 1000)
        self.assertEqual((rep["review_all"]["cost"], rep["automate_all"]["cost"]), (6.0, 6.0))
        self.assertAlmostEqual(rep["break_even"], 2 / 3)
        self.assertEqual((rep["current"]["automated"], rep["current"]["cost"]), (3, 6.0))  # 0.90, 0.80, 0.60
        sweep = {p["threshold"]: p["cost"] for p in rep["sweep"]}
        self.assertEqual([sweep[t] for t in (0.0, 0.11, 0.21, 0.41, 0.61, 0.81, 0.91)], [6, 4 + 3, 5, 6, 4 + 3, 5, 6])
        self.assertEqual(min(sweep.values()), rep["best"]["cost"])
        self.assertEqual(len(rep["sweep"]), 101)

    def test_dearer_mistakes_raise_the_threshold(self):
        rep = cost.evaluate(SIX, ["u"], costs={"review": 1, "error": 10})
        self.assertEqual((rep["best"]["gates"], rep["best"]["automated"]), ({"u": 0.81}, 1))

    def test_review_every_row_when_every_gate_loses(self):
        rows = noul_rows([(0.95, False), (0.9, True), (0.6, False)])
        rep = cost.evaluate(rows, ["u"], costs={"review": 1, "error": 5})
        self.assertIsNone(rep["best"]["gates"])
        self.assertEqual((rep["best"]["automated"], rep["best"]["cost"]), (0, 3.0))

    def test_free_mistakes_automate_everything(self):
        rep = cost.evaluate(SIX, ["u"], costs={"review": 1, "error": 0})
        self.assertEqual((rep["best"]["gates"], rep["best"]["cost"]), ({"u": 0.0}, 0.0))

    def test_a_priced_mistake_moves_the_choice_threshold(self):
        base = cost.evaluate(DEPT, ["dept"], costs={"review": 1, "error": 1.5})
        self.assertEqual((base["best"]["gates"], base["best"]["cost"]), ({"dept": 0.31}, 2.5))
        priced = cost.evaluate(DEPT, ["dept"], costs={"review": 1, "error": 1.5, "mistakes": [
            {"question": "dept", "label": "billing", "answer": "shipping", "cost": 10},
            {"question": "other", "label": "x", "answer": "y", "cost": 1}]})
        self.assertEqual(priced["best"]["gates"], {"dept": 0.71})
        self.assertEqual([m["question"] for m in priced["mistakes"]], ["dept"])  # prices for other questions don't apply

    def test_tune_false_skips_the_search(self):
        rep = cost.evaluate(SIX, ["u"], costs={"review": 1, "error": 3}, gates={"u": 0.0}, tune=False)
        self.assertIsNone(rep["best"])
        self.assertEqual(rep["current"]["cost"], 6.0)

    def test_gates_must_match_the_questions(self):
        with self.assertRaises(CalibrationError):
            cost.evaluate(SIX, ["u"], costs={"review": 1, "error": 3}, gates={"v": 0.5})
        with self.assertRaises(CalibrationError):
            cost.evaluate(SIX, ["u"], costs=None)

    def test_no_labels_reports_nothing_to_price(self):
        rows = [dict(r, labels={}) for r in SIX]
        rep = cost.evaluate(rows, ["u"], costs={"review": 1, "error": 3})
        self.assertEqual((rep["labeled"], rep["unlabeled"], rep["best"], rep["sweep"]), (0, 6, None, None))

    def test_several_questions_need_every_answer_right(self):
        rows = random_rows(5, 40, qids=("a", "b", "c"))
        rep = cost.evaluate(rows, ["a", "b", "c"], costs={"review": 2, "error": 10})
        self.assertIsNone(rep["sweep"])
        gates = rep["best"]["gates"]
        check = cost.evaluate(rows, ["a", "b", "c"], costs={"review": 2, "error": 10}, gates=gates, tune=False)
        self.assertEqual(check["current"]["cost"], rep["best"]["cost"])
        self.assertLessEqual(rep["best"]["cost"], min(rep["review_all"]["cost"], rep["automate_all"]["cost"]))


class SearchTests(unittest.TestCase):
    def test_exact_for_one_and_two_questions(self):
        for seed in range(24):
            k = 1 if seed % 2 else 2
            rows = random_rows(seed, 26 if k == 1 else 14, qids=tuple("ab"[:k]))
            rng = random.Random(seed)
            prices = {"review": rng.choice([0.5, 1, 2, 5]), "error": rng.choice([1, 3, 10, 40])}
            qids, _, levels, _, priced, p = cost.prepared(rows, list("ab"[:k]), "confidence", prices)
            value = [p["review"] - c for c in priced]
            self.assertEqual(cost.search(levels, value), brute(levels, value), (seed, prices))

    def test_never_worse_than_review_or_automate_all(self):
        for seed in range(6):
            rows = random_rows(seed, 60, qids=tuple("abcde"))
            rep = cost.evaluate(rows, list("abcde"), costs={"review": 1, "error": 6})
            self.assertLessEqual(rep["best"]["cost"], rep["review_all"]["cost"] + 1e-9)
            self.assertLessEqual(rep["best"]["cost"], rep["automate_all"]["cost"] + 1e-9)


class HoldoutCostTests(unittest.TestCase):
    def test_each_fold_is_priced_by_thresholds_tuned_without_it(self):
        rows = random_rows(11, 37, qids=("a", "b"))
        prices = {"review": 1, "error": 4}
        rep = holdout.evaluate(rows, ["a", "b"], costs=prices)
        c = rep["cost"]
        qids, data, levels, right, priced, _ = cost.prepared(rows, ["a", "b"], "confidence", prices)
        fold_of = folds_of([item for item in rows if item["index"] in {s["index"] for s in data["scored"]}])
        value = [1 - x for x in priced]
        for f, part in enumerate(c["parts"]):
            train = [i for i in range(len(levels)) if fold_of[i] != f]
            steps = cost.search([levels[i] for i in train], [value[i] for i in train])
            self.assertEqual(part["gates"], None if steps is None else {q: steps[j] / 100 for j, q in enumerate(qids)})
        self.assertEqual(sum(p["rows"] for p in c["parts"]), 37)
        self.assertEqual(sum(p["automated"] for p in c["parts"]), c["unseen"]["automated"])
        self.assertAlmostEqual(sum(p["cost"] for p in c["parts"]), c["unseen"]["cost"])
        self.assertAlmostEqual(c["gap"], c["unseen"]["per_1000"] - c["tuned"]["per_1000"])
        self.assertEqual(c["tuned"]["gates"], cost.evaluate(rows, ["a", "b"], costs=prices)["best"]["gates"])
        self.assertEqual(c["review_all"], 1000)

    def test_without_costs_there_is_no_cost_row(self):
        self.assertNotIn("cost", holdout.evaluate(random_rows(2, 20), ["a"]))
        with self.assertRaises(CalibrationError):
            holdout.evaluate(random_rows(2, 20), ["a"], costs={"review": "x", "error": 1})

    def test_matches_policy_scoring(self):
        # The gates the cost search picks route the same rows Policy reports automated.
        rows = random_rows(4, 50, qids=("a", "b"))
        best = cost.evaluate(rows, ["a", "b"], costs={"review": 1, "error": 5})["best"]
        rep = policy.evaluate(rows, best["gates"])
        self.assertEqual((rep["automated"], rep["automated"] - rep["correct"]), (best["automated"], best["wrong"]))


if __name__ == "__main__":
    unittest.main()
