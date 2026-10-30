"""Policy gates several questions at once over answers Bulk already returned; these tests pin its arithmetic."""

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import examples, policy, workbench  # noqa: E402
from jev.calibrate import STEPS, TARGETS  # noqa: E402


def dept(pick, confidence, p=0.8):
    probs = {o: (p if o == pick else (1 - p) / 2) for o in ("billing", "shipping", "none")}
    return {"type": "choice", "choice": pick, "probabilities": probs, "confidence": confidence}


def noul(p):
    return {"type": "noul", "noul": p}


def row(index, answers, labels):
    return {"index": index, "answers": answers, "labels": labels}


# Gate signals (dept confidence, refund |2p - 1|) and whether each answer is right:
ROWS = [
    row(0, {"dept": dept("billing", 0.9), "refund": noul(0.95)}, {"dept": "billing", "refund": True}),   # .9 .9 right
    row(1, {"dept": dept("billing", 0.8), "refund": noul(0.1)}, {"dept": "billing", "refund": False}),   # .8 .8 right
    row(2, {"dept": dept("shipping", 0.3), "refund": noul(0.9)}, {"dept": "billing", "refund": "yes"}),  # .3 .8 dept wrong
    row(3, {"dept": dept("billing", 0.9), "refund": noul(0.6)}, {"dept": "billing", "refund": "no"}),    # .9 .2 refund wrong
    row(4, {"dept": dept("none", 0.7), "refund": noul(0.05)}, {"dept": "none", "refund": False}),        # .7 .9 right
    row(5, {"dept": dept("billing", 0.9), "refund": noul(0.9)}, {"dept": "billing"}),                    # refund unlabeled
    row(6, {"dept": dept("billing", 0.9), "refund": noul(0.95)}, {"dept": "refunds", "refund": True}),   # bad label
]


class EvaluateTests(unittest.TestCase):
    def test_a_row_is_automated_only_when_every_gate_clears(self):
        r = policy.evaluate(ROWS, {"dept": 0.5, "refund": 0.5})
        self.assertEqual((r["labeled"], r["unlabeled"], r["skipped"]), (5, 1, 0))
        self.assertEqual([x["index"] for x in r["invalid"]], [6])
        self.assertIn("dept", r["invalid"][0]["reason"])
        self.assertEqual((r["automated"], r["correct"], r["review"]), (3, 3, 2))
        self.assertAlmostEqual(r["coverage"], 0.6)
        self.assertEqual(r["accuracy"], 1.0)
        self.assertAlmostEqual(r["accuracy_all"], 0.6)
        held = {x["index"]: x["held"] for x in r["rows"]}
        self.assertEqual(held, {0: [], 1: [], 2: ["dept"], 3: ["refund"], 4: []})
        # Unlabeled and badly labeled rows are still routed: 0, 1, 4, 5, 6 clear both gates.
        self.assertEqual((r["routed"], r["routed_automated"]), (7, 5))

    def test_per_question_counts_say_which_gate_holds_and_which_answer_is_wrong(self):
        r = policy.evaluate(ROWS, {"dept": 0.85, "refund": 0})
        per = {q["qid"]: q for q in r["questions"]}
        # dept >= .85 holds rows 1, 2, 4; refund at 0 holds nothing, so row 3 is automated and wrong.
        self.assertEqual((per["dept"]["holds"], per["dept"]["only"]), (3, 3))
        self.assertEqual((per["refund"]["holds"], per["refund"]["wrong_automated"]), (0, 1))
        self.assertAlmostEqual(per["dept"]["accuracy"], 0.8)
        wrong = [x for x in r["rows"] if x["automated"] and not x["correct"]]
        self.assertEqual([(x["index"], x["wrong"]) for x in wrong], [(3, ["refund"])])
        self.assertEqual(wrong[0]["answers"]["refund"], {"answer": "yes", "label": "no", "signal": wrong[0]["answers"]["refund"]["signal"]})

    def test_a_signal_equal_to_its_threshold_clears_it(self):
        r = policy.evaluate(ROWS, {"dept": 0.3})
        self.assertEqual(r["automated"], 6)  # every row labeled for dept, row 2 included

    def test_top_probability_signal(self):
        r = policy.evaluate(ROWS, {"dept": 0.8}, "top_probability")
        self.assertEqual(r["automated"], 6)  # every dept answer has top probability 0.8
        self.assertEqual(policy.evaluate(ROWS, {"dept": 0.81}, "top_probability")["automated"], 0)

    def test_a_row_without_a_readable_answer_is_skipped(self):
        broken = ROWS + [row(7, {"dept": dept("billing", 0.9)}, {"dept": "billing", "refund": True}),
                         row(8, {"dept": dept("billing", 0.9), "refund": noul(2)}, {})]
        r = policy.evaluate(broken, {"dept": 0.5, "refund": 0.5})
        self.assertEqual((r["skipped"], r["routed"], r["labeled"]), (2, 7, 5))

    def test_refusals(self):
        bad_gates = (None, {}, {"dept": True}, {"dept": 1.5}, {"dept": float("nan")}, {"dept": "0.5"},
                     {"q%d" % i: 0.5 for i in range(policy.MAX_GATES + 1)}, {"missing": 0.5})
        for gates in bad_gates:
            with self.subTest(gates=gates), self.assertRaises(policy.CalibrationError):
                policy.evaluate(ROWS, gates)
        bad_rows = {
            "not a list": "rows",
            "box": [row(0, {"q": {"type": "box", "box": {}}}, {})],
            "mixed types": [row(0, {"q": noul(0.9)}, {}), row(1, {"q": dept("billing", 0.9)}, {})],
            "too many": [row(0, {"q": noul(0.9)}, {})] * 1001,
        }
        for name, rows in bad_rows.items():
            with self.subTest(rows=name), self.assertRaises(policy.CalibrationError):
                policy.evaluate(rows, {"q": 0.5})
        with self.assertRaises(policy.CalibrationError):
            policy.evaluate(ROWS, {"dept": 0.5}, "vibes")


class TuneTests(unittest.TestCase):
    def test_raises_the_gate_that_drops_wrong_rows_and_keeps_the_rest(self):
        r = policy.tune(ROWS, ["dept", "refund"])
        self.assertEqual(r["labeled"], 5)
        for t in r["targets"]:
            with self.subTest(target=t["target"]):
                # Row 2 is the only one below dept 0.31, row 3 the only one below refund 0.21.
                self.assertEqual(t["gates"], {"dept": 0.31, "refund": 0.21})
                self.assertEqual((t["automated"], t["accuracy"]), (3, 1.0))
                check = policy.evaluate(ROWS, t["gates"])
                self.assertEqual((check["automated"], check["accuracy"]), (3, 1.0))

    def test_lowers_a_threshold_that_another_gate_made_unnecessary(self):
        # The search first drops row 0 with q1, then drops row 1 with q2, which also drops row 0. q1 then returns to 0.
        right = [row(i, {"q1": noul(0.97), "q2": noul(0.97)}, {"q1": True, "q2": True}) for i in range(2, 8)]
        rows = [row(0, {"q1": noul(0.55), "q2": noul(0.55)}, {"q1": False, "q2": True}),
                row(1, {"q1": noul(0.97), "q2": noul(0.65)}, {"q1": True, "q2": False})] + right
        t = policy.tune(rows, ["q1", "q2"])["targets"][0]
        self.assertEqual(t["gates"], {"q1": 0.0, "q2": 0.31})
        self.assertEqual((t["automated"], t["accuracy"]), (6, 1.0))

    def test_partial_targets_stop_at_the_first_state_that_reaches_them(self):
        # Seventeen rows on one question, 15 right (88%); the two wrong rows sit at signals 0.2 and 0.6.
        signals = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9) + (1.0,) * 8
        rows = [row(i, {"q": noul((1 + s) / 2)}, {"q": s not in (0.2, 0.6)}) for i, s in enumerate(signals)]
        by = {t["target"]: t for t in policy.tune(rows, ["q"])["targets"]}
        self.assertEqual((by[0.9]["gates"], by[0.9]["automated"]), ({"q": 0.21}, 15))  # 14 of 15: 93%
        for target in (0.95, 0.99):
            self.assertEqual((by[target]["gates"], by[target]["automated"]), ({"q": 0.61}, 11))

    def test_unreachable_targets_and_no_labels(self):
        wrong = [row(i, {"q": noul(1.0)}, {"q": False}) for i in range(3)]
        for t in policy.tune(wrong, ["q"])["targets"]:
            self.assertEqual((t["gates"], t["automated"]), (None, 0))
        unlabeled = policy.tune([row(0, {"q": noul(0.9)}, {})], ["q"])
        self.assertEqual((unlabeled["labeled"], [t["gates"] for t in unlabeled["targets"]]), (0, [None] * 3))

    def test_lower_bound_tuning_needs_enough_automated_rows(self):
        # 70 clean rows (q1 0.9, q2 0.9), and 5 rows where q2 is wrong at q2 0.3. q1 alone cannot drop them.
        clean = [row(i, {"q1": noul(0.95), "q2": noul(0.95)}, {"q1": True, "q2": True}) for i in range(70)]
        bad = [row(70 + i, {"q1": noul(0.95), "q2": noul(0.65)}, {"q1": True, "q2": False}) for i in range(5)]
        estimate = {t["target"]: t for t in policy.tune(clean + bad, ["q1", "q2"])["targets"]}
        lower = policy.tune(clean + bad, ["q1", "q2"], bound="lower")
        self.assertEqual(lower["bound"], "lower")
        by = {t["target"]: t for t in lower["targets"]}
        # Measured: 70 of 75 is 93.3%, so 90% holds with every row; 95% and 99% drop the five.
        self.assertEqual((estimate[0.9]["gates"], estimate[0.9]["automated"]), ({"q1": 0.0, "q2": 0.0}, 75))
        self.assertEqual((estimate[0.95]["gates"], estimate[0.95]["automated"]), ({"q1": 0.0, "q2": 0.31}, 70))
        # With 95% confidence: 70 of 75 has a lower bound of 85%, so 90% must drop the five; 70 clean rows
        # show 94.9%, short of 95% (73 needed) and far from 99% (381 needed).
        self.assertEqual((by[0.9]["gates"], by[0.9]["automated"]), ({"q1": 0.0, "q2": 0.31}, 70))
        self.assertGreaterEqual(by[0.9]["low"], 0.9)
        for target in (0.95, 0.99):
            self.assertIsNone(by[target]["gates"])
            self.assertEqual(by[target]["needed"], policy.calibrate.rows_needed(target))
        with self.assertRaises(policy.CalibrationError):
            policy.tune(clean, ["q1"], bound="vibes")

    def test_two_questions_match_an_exhaustive_search(self):
        # For two questions the pair search is exhaustive, so it must find the largest automated set on the grid,
        # including sets the greedy path jumps past (one threshold higher, the other lower).
        rng = random.Random(7)
        for trial in range(3):
            rows = []
            for i in range(150):
                signals = [rng.random() for _ in range(2)]
                rows.append(row(i, {q: noul((1 + c) / 2) for q, c in zip("ab", signals)},
                                {q: rng.random() < 0.7 + 0.3 * c ** 0.5 for q, c in zip("ab", signals)}))
            levels = [[policy._level(abs(2 * r["answers"][q]["noul"] - 1)) for q in "ab"] for r in rows]
            right = [all(r["labels"].values()) for r in rows]
            for bound in policy.calibrate.BOUNDS:
                tuned = {t["target"]: t["automated"] for t in policy.tune(rows, ["a", "b"], bound=bound)["targets"]}
                for target in TARGETS:
                    best = 0
                    for sa in range(STEPS + 1):
                        kept = [(lv[1], hit) for lv, hit in zip(levels, right) if lv[0] >= sa]
                        for sb in range(STEPS + 1):
                            auto = [hit for level, hit in kept if level >= sb]
                            if len(auto) > best and policy.calibrate.meets(sum(auto), len(auto), target, bound):
                                best = len(auto)
                    with self.subTest(trial=trial, bound=bound, target=target):
                        self.assertEqual(tuned[target], best)

    def test_evaluate_reports_an_interval_on_automated_accuracy(self):
        r = policy.evaluate(ROWS, {"dept": 0.5, "refund": 0.5})
        self.assertEqual((r["accuracy_low"], r["accuracy_high"]), policy.calibrate.wilson(3, 3))
        self.assertEqual((r["accuracy_all_low"], r["accuracy_all_high"]), policy.calibrate.wilson(3, 5))
        dept = r["questions"][0]
        self.assertEqual((dept["accuracy_low"], dept["accuracy_high"]), policy.calibrate.wilson(dept["correct"], 5))
        none = policy.evaluate(ROWS, {"dept": 1.0, "refund": 1.0})
        self.assertEqual((none["automated"], none["accuracy_low"], none["accuracy_high"]), (0, None, None))

    def test_refusals(self):
        for qids in (None, [], ["dept", "dept"], [1], ["q%d" % i for i in range(policy.MAX_GATES + 1)]):
            with self.subTest(qids=qids), self.assertRaises(policy.CalibrationError):
                policy.tune(ROWS, qids)

    def test_sample_rows_end_to_end(self):
        sample = workbench.load_sample_rows()
        report = workbench.run_bulk(FakeClient(), sample, examples.BULK_QUESTIONS)
        rows = [row(r["index"], r["answers"], r["expect"]) for r in report["results"]]
        qids = list(examples.BULK_QUESTIONS)
        r = policy.evaluate(rows, {q: 0.5 for q in qids})
        self.assertEqual((r["labeled"], r["invalid"], r["skipped"]), (40, [], 0))
        self.assertEqual(policy.tune(rows, qids)["labeled"], 40)


if __name__ == "__main__":
    unittest.main()
