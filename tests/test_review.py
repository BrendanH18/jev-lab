"""Review labels reads answers Bulk already returned; these tests pin which labels it flags and which rows it ranks."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import review  # noqa: E402
from jev.calibrate import CalibrationError  # noqa: E402


def noul(p):
    return {"type": "noul", "noul": p}


def choice(pick, probs, confidence=None):
    out = {"type": "choice", "choice": pick, "probabilities": probs}
    if confidence is not None:
        out["confidence"] = confidence
    return out


def score(probs):
    return {"type": "score", "score": 0.0, "probabilities": probs, "legend": {k: "level %s" % k for k in probs}}


def row(index, answers, labels=None):
    return {"index": index, "answers": answers, "labels": labels or {}}


class CheckLabelsTests(unittest.TestCase):
    def test_disagreements_rank_by_the_probability_the_label_got(self):
        rows = [
            row(0, {"u": noul(0.97)}, {"u": False}),  # P(no) = 0.03: likely a label error
            row(1, {"u": noul(0.70)}, {"u": False}),  # P(no) = 0.30: a model miss or a close call
            row(2, {"u": noul(0.10)}, {"u": True}),   # P(yes) = 0.10: on the strong line
            row(3, {"u": noul(0.90)}, {"u": "yes"}),  # agrees: not listed
            row(4, {"u": noul(0.40)}),                # unlabeled: not listed
        ]
        rep = review.evaluate(rows)
        self.assertEqual([s["index"] for s in rep["suspects"]], [0, 2, 1])
        self.assertEqual([s["strong"] for s in rep["suspects"]], [True, True, False])
        first = rep["suspects"][0]
        self.assertEqual((first["label"], first["answer"], first["question"]), ("no", "yes", "u"))
        self.assertAlmostEqual(first["label_probability"], 0.03)
        self.assertAlmostEqual(first["signal"], 0.94)
        self.assertEqual(rep["questions"]["u"], {"labeled": 4, "disagree": 3, "strong": 2, "invalid": 0})

    def test_choice_and_score_use_the_label_option_and_level(self):
        rows = [
            row(0, {"dept": choice("billing", {"billing": 0.9, "shipping": 0.08, "other": 0.02}),
                    "urgency": score({"0": 0.05, "1": 0.15, "2": 0.8})}, {"dept": "other", "urgency": 1}),
            row(1, {"dept": choice("shipping", {"billing": 0.3, "shipping": 0.6, "other": 0.1}),
                    "urgency": score({"0": 0.7, "1": 0.2, "2": 0.1})}, {"dept": "billing", "urgency": "0"}),
        ]
        rep = review.evaluate(rows)
        got = [(s["index"], s["question"], s["label"], s["answer"], round(s["label_probability"], 2)) for s in rep["suspects"]]
        self.assertEqual(got, [(0, "dept", "other", "billing", 0.02), (0, "urgency", "1", "2", 0.15),
                               (1, "dept", "billing", "shipping", 0.3)])
        self.assertEqual(rep["questions"]["urgency"]["labeled"], 2)
        self.assertEqual(rep["questions"]["urgency"]["disagree"], 1)

    def test_ties_go_to_the_more_confident_answer_then_the_row_number(self):
        probs = {"a": 0.0, "b": 1.0}
        rows = [row(10, {"q": choice("b", probs, confidence=0.6)}, {"q": "a"}),
                row(9, {"q": choice("b", probs, confidence=0.6)}, {"q": "a"}),
                row(2, {"q": choice("b", probs, confidence=0.9)}, {"q": "a"})]
        self.assertEqual([s["index"] for s in review.evaluate(rows)["suspects"]], [2, 9, 10])

    def test_invalid_labels_and_box_answers_are_counted_or_skipped_not_fatal(self):
        rows = [row(0, {"u": noul(0.9), "spot": {"type": "box", "box": {}}}, {"u": "maybe", "spot": "x"}),
                row(1, {"u": {"type": "noul", "noul": "high"}}, {"u": True})]
        rep = review.evaluate(rows)
        self.assertEqual(rep["suspects"], [])
        self.assertEqual(rep["questions"], {"u": {"labeled": 0, "disagree": 0, "strong": 0, "invalid": 1}})


class LabelNextTests(unittest.TestCase):
    def test_unlabeled_rows_rank_nearest_the_threshold_then_lower_signal(self):
        # Noul confidence is |2p - 1|: 0.75 -> 0.5, 0.80 -> 0.6, 0.70 -> 0.4, 0.95 -> 0.9, 0.5 -> 0.
        rows = [row(0, {"u": noul(0.95)}), row(1, {"u": noul(0.70)}), row(2, {"u": noul(0.80)}),
                row(3, {"u": noul(0.75)}), row(4, {"u": noul(0.5)}), row(5, {"u": noul(0.75)}, {"u": True})]
        rep = review.evaluate(rows, "u", 0.5)
        self.assertEqual([r["index"] for r in rep["next"]], [3, 1, 2, 0, 4])
        self.assertEqual([r["above"] for r in rep["next"]], [True, False, True, True, False])
        self.assertEqual(rep["next"][1]["distance"], rep["next"][2]["distance"])  # 0.1 either side, float noise rounded off

    def test_next_follows_the_threshold_and_the_signal(self):
        rows = [row(i, {"q": choice("a", {"a": p, "b": 1 - p}, confidence=c)}) for i, (p, c) in
                enumerate([(0.95, 0.2), (0.6, 0.9), (0.8, 0.5)])]
        self.assertEqual([r["index"] for r in review.evaluate(rows, "q", 0.9)["next"]], [1, 2, 0])
        self.assertEqual([r["index"] for r in review.evaluate(rows, "q", 0.9, "top_probability")["next"]], [0, 2, 1])
        self.assertEqual(review.evaluate(rows)["next"], [])  # no question, no ranking

    def test_bad_requests_raise(self):
        rows = [row(0, {"u": noul(0.9)})]
        for kwargs, message in [({"threshold": 1.5}, "threshold"), ({"threshold": True}, "threshold"),
                                ({"signal": "vibes"}, "signal"), ({"question": "missing"}, "Run Bulk"),
                                ({"question": 3}, "question id")]:
            with self.subTest(kwargs=kwargs), self.assertRaises(CalibrationError) as caught:
                review.evaluate(rows, **kwargs)
            self.assertIn(message, str(caught.exception))
        with self.assertRaises(CalibrationError):
            review.evaluate("rows")
        with self.assertRaises(CalibrationError):
            review.evaluate([row(0, {"u": noul(0.9)}), row(1, {"u": choice("a", {"a": 1.0})})])


if __name__ == "__main__":
    unittest.main()
