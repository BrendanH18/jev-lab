"""Calibrate is arithmetic over answers Bulk already returned; these tests pin that arithmetic."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import calibrate, examples, workbench  # noqa: E402


def choice(pick, p, confidence=None, options=("billing", "shipping", "none")):
    rest = (1 - p) / (len(options) - 1)
    probs = {o: (p if o == pick else rest) for o in options}
    out = {"type": "choice", "choice": pick, "probabilities": probs}
    if confidence is not None:
        out["confidence"] = confidence
    return out


def rows(*pairs):
    return [{"index": i, "answer": a, "label": label} for i, (a, label) in enumerate(pairs)]


class ChoiceTests(unittest.TestCase):
    def setUp(self):
        self.report = calibrate.evaluate(rows(
            (choice("billing", 0.95, 0.9), "billing"),
            (choice("billing", 0.90, 0.8), "billing"),
            (choice("shipping", 0.60, 0.4), "billing"),   # wrong, low confidence
            (choice("none", 0.50, 0.25), "none"),
            (choice("shipping", 0.80, 0.7), None),         # unlabeled: counted, not scored
        ))

    def test_accuracy_and_confusion(self):
        r = self.report
        self.assertEqual((r["labeled"], r["unlabeled"], r["correct"]), (4, 1, 3))
        self.assertAlmostEqual(r["accuracy"], 0.75)
        self.assertEqual(r["classes"], ["billing", "shipping", "none"])
        self.assertEqual(r["confusion"], [[2, 1, 0], [0, 0, 0], [0, 0, 1]])
        self.assertEqual(r["signals"], {"0": 0.9, "1": 0.8, "2": 0.4, "3": 0.25, "4": 0.7})

    def test_sweep_trades_coverage_for_accuracy(self):
        by_t = {p["threshold"]: p for p in self.report["sweep"]}
        self.assertEqual(len(self.report["sweep"]), calibrate.STEPS + 1)
        self.assertEqual((by_t[0.0]["automated"], by_t[0.0]["accuracy"]), (4, 0.75))
        # 0.40 still admits the wrong row; 0.41 drops it and the 0.25 row.
        self.assertEqual(by_t[0.4]["automated"], 3)
        self.assertEqual((by_t[0.41]["automated"], by_t[0.41]["accuracy"]), (2, 1.0))
        self.assertIsNone(by_t[1.0]["accuracy"])
        self.assertEqual(by_t[1.0]["coverage"], 0.0)

    def test_targets_pick_the_lowest_threshold_that_reaches_each_accuracy(self):
        for t in self.report["targets"]:
            self.assertEqual(t["threshold"], 0.41)
            self.assertAlmostEqual(t["coverage"], 0.5)

    def test_top_probability_signal_and_missing_confidence(self):
        no_conf = calibrate.evaluate(rows((choice("billing", 0.7), "billing")))
        # Falls back to TypeSafe's Choice formula: (0.7 - 1/3) / (1 - 1/3).
        self.assertAlmostEqual(no_conf["rows"][0]["signal"], 0.55)
        top = calibrate.evaluate(rows((choice("billing", 0.7, 0.55), "billing")), "top_probability")
        self.assertAlmostEqual(top["rows"][0]["signal"], 0.7)

    def test_reliability_bins_and_ece(self):
        r = calibrate.evaluate(rows((choice("billing", 0.85), "billing"), (choice("billing", 0.85), "none")))
        self.assertEqual(len(r["reliability"]), 1)
        b = r["reliability"][0]
        self.assertEqual((b["lo"], b["count"], b["hits"]), (0.8, 2, 1))
        self.assertAlmostEqual(r["ece"], 0.35)


class NoulAndScoreTests(unittest.TestCase):
    def test_noul_labels_accept_common_spellings(self):
        r = calibrate.evaluate(rows(
            ({"type": "noul", "noul": 0.9}, True), ({"type": "noul", "noul": 0.2}, "no"),
            ({"type": "noul", "noul": 0.6}, "yes"), ({"type": "noul", "noul": 0.4}, 1)))
        self.assertEqual((r["labeled"], r["correct"]), (4, 3))
        self.assertEqual(r["classes"], ["yes", "no"])
        self.assertEqual(r["confusion"], [[2, 1], [0, 1]])
        # |2p - 1|: 0.4 is the docs' 0.7 / 0.3 starting band.
        self.assertAlmostEqual(r["rows"][0]["signal"], 0.8)
        by_t = {p["threshold"]: p for p in r["sweep"]}
        self.assertEqual((by_t[0.4]["automated"], by_t[0.4]["accuracy"]), (2, 1.0))

    def test_noul_reliability_compares_p_yes_with_yes_rate(self):
        r = calibrate.evaluate(rows(({"type": "noul", "noul": 0.15}, True), ({"type": "noul", "noul": 0.12}, False)))
        b = r["reliability"][0]
        self.assertEqual((b["lo"], b["count"], b["hits"]), (0.1, 2, 1))
        self.assertAlmostEqual(b["observed"], 0.5)

    def test_score_uses_most_likely_level(self):
        def score(probs, conf):
            return {"type": "score", "score": sum(i * p for i, p in enumerate(probs)), "confidence": conf,
                    "probabilities": {str(i): p for i, p in enumerate(probs)}}
        r = calibrate.evaluate(rows((score([0.1, 0.7, 0.2], 0.6), 1), (score([0.6, 0.3, 0.1], 0.5), "2"),
                                    (score([0.1, 0.1, 0.8], 0.8), 2.0)))
        self.assertEqual(r["classes"], ["0", "1", "2"])
        self.assertEqual([x["predicted"] for x in r["rows"]], ["1", "0", "2"])
        self.assertEqual(r["correct"], 2)


class InputTests(unittest.TestCase):
    def test_bad_labels_are_reported_not_scored(self):
        r = calibrate.evaluate(rows((choice("billing", 0.9), "refunds"), ({"type": "choice", "choice": "x"}, "x"),
                                    (choice("billing", 0.9), "billing")))
        self.assertEqual(r["labeled"], 1)
        self.assertEqual([x["index"] for x in r["invalid"]], [0, 1])
        self.assertIn("not one of the options", r["invalid"][0]["reason"])
        score = {"type": "score", "score": 1, "probabilities": {"0": 0.5, "1": 0.5}}
        bad = calibrate.evaluate(rows((score, 5), (score, True), (score, "high"), (score, 1.5)))
        self.assertEqual(len(bad["invalid"]), 4)

    def test_out_of_range_or_malformed_answers_are_reported_not_crashed_on(self):
        good = ({"type": "noul", "noul": 0.9}, True)
        r = calibrate.evaluate(rows(({"type": "noul", "noul": -2}, True), ({"type": "noul", "noul": 2}, True),
                                    ({"type": "noul", "noul": float("nan")}, True), ({"type": "noul", "noul": "0.9"}, True),
                                    ({"type": "noul", "noul": 10 ** 400}, True), good))
        self.assertEqual((r["labeled"], len(r["invalid"])), (1, 5))
        self.assertTrue(all(0 <= s <= 1 for s in r["signals"].values()))
        bad_choice = [dict(choice("billing", 0.9), probabilities=[0.9, 0.1]), dict(choice("billing", 0.9), confidence=3),
                      dict(choice("billing", 0.9), choice="refunds"), dict(choice("billing", 0.9), choice=["billing"])]
        r = calibrate.evaluate(rows(*[(a, "billing") for a in bad_choice], (choice("billing", 0.9), "billing")))
        self.assertEqual((r["labeled"], len(r["invalid"])), (1, 4))
        self.assertEqual(r["classes"], ["billing", "shipping", "none"])
        score = {"type": "score", "score": 1, "probabilities": {"low": 0.5, "high": 0.5}}
        self.assertEqual(len(calibrate.evaluate(rows((score, 1)))["invalid"]), 1)

    def test_class_count_is_capped_before_the_confusion_matrix(self):
        many = {"type": "choice", "choice": "o0", "probabilities": {"o%d" % i: 1 / 300 for i in range(300)}}
        r = calibrate.evaluate(rows((many, "o0"), (choice("billing", 0.9), "billing")))
        self.assertEqual(len(r["invalid"]), 1)
        self.assertIn("more than", r["invalid"][0]["reason"])
        self.assertEqual(len(r["confusion"]), 3)

    def test_rejects_requests_it_cannot_answer(self):
        for bad in (None, "rows", [], [{"answer": {"type": "box", "box": {}}, "label": "x"}],
                    rows(({"type": "noul", "noul": 0.5}, True), (choice("billing", 0.9), "billing"))):
            with self.subTest(bad=bad), self.assertRaises(calibrate.CalibrationError):
                calibrate.evaluate(bad)
        with self.assertRaises(calibrate.CalibrationError):
            calibrate.evaluate(rows((choice("billing", 0.9), "billing")), "vibes")

    def test_no_labels_still_reports_shape(self):
        r = calibrate.evaluate(rows((choice("billing", 0.9), None)))
        self.assertEqual((r["labeled"], r["unlabeled"], r["accuracy"], r["targets"]), (0, 1, None, []))


class BulkLabelTests(unittest.TestCase):
    def test_labels_are_removed_before_the_call_and_returned(self):
        client = FakeClient(lambda s, q: {"wants_refund": 0.9})
        report = workbench.run_bulk(client, [{"text": "refund please", "_expect": {"wants_refund": True}}, "hi"],
                                    {"wants_refund": {"type": "noul", "instructions": "Refund?"}})
        self.assertEqual(client.calls[0][0], {"text": "refund please"})
        self.assertEqual(report["results"][0]["row"], {"text": "refund please"})
        self.assertEqual(report["results"][0]["expect"], {"wants_refund": True})
        self.assertNotIn("expect", report["results"][1])
        self.assertEqual(report["labeled"], 1)

    def test_bad_labels_fail_before_any_call(self):
        client = FakeClient()
        for bad in ([{"text": "x", "_expect": "billing"}], [{"_expect": {"a": 1}}]):
            with self.subTest(bad=bad), self.assertRaises(workbench.WorkbenchError):
                workbench.run_bulk(client, bad, {"a": {"type": "noul", "instructions": "?"}})
        self.assertEqual(client.calls, [])

    def test_parse_rows_reads_json_lines_and_text(self):
        parsed = workbench.parse_rows('plain text\n\n{"text": "obj"}\n{not json\n[1, 2]\n')
        self.assertEqual(parsed, ["plain text", {"text": "obj"}, "{not json", "[1, 2]"])
        # Only "\n" ends a row, so a JSON line holding an unescaped U+2028 stays one row.
        self.assertEqual(workbench.parse_rows('{"text": "a\u2028b"}\r\nnext'), [{"text": "a\u2028b"}, "next"])

    def test_sample_labels_fit_the_sample_questions(self):
        sample = workbench.load_sample_rows()
        self.assertEqual(len(sample), 40)
        options = list(examples.BULK_QUESTIONS["department"]["criteria"])
        levels = range(len(examples.BULK_QUESTIONS["frustration"]["criteria"]))
        for row in sample:
            labels = row["_expect"]
            self.assertEqual(set(labels), set(examples.BULK_QUESTIONS))
            self.assertIn(labels["department"], options)
            self.assertIn(labels["frustration"], levels)
            self.assertIsInstance(labels["is_urgent"], bool)
            self.assertIsInstance(labels["wants_refund"], bool)
        # The sample end to end: fake answers through Bulk, then Calibrate on every labeled question.
        report = workbench.run_bulk(FakeClient(), sample, examples.BULK_QUESTIONS)
        for qid in examples.BULK_QUESTIONS:
            cal = calibrate.evaluate([{"index": r["index"], "answer": r["answers"][qid], "label": r["expect"][qid]}
                                      for r in report["results"]])
            self.assertEqual((cal["labeled"], cal["invalid"]), (40, []), qid)


if __name__ == "__main__":
    unittest.main()
