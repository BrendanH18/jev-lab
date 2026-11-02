"""Calibrate is arithmetic over answers Bulk already returned; these tests pin that arithmetic."""

import math
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
    def test_score_reports_how_far_off_it_is(self):
        def score(probs, expected=None):
            out = {"type": "score", "probabilities": {str(i): p for i, p in enumerate(probs)}, "confidence": 0.5}
            if expected is not None:
                out["score"] = expected
            return out
        # Most likely levels 0, 1, 2, 0 against labels 0, 2, 2, 2: within one on three rows, off by 0, 1, 0, 2.
        r = calibrate.evaluate(rows((score([0.8, 0.1, 0.1], 0.3), 0), (score([0.2, 0.5, 0.3], 1.1), 2),
                                    (score([0.1, 0.1, 0.8], 1.7), 2), (score([0.5, 0.0, 0.5]), 2)))
        o = r["ordinal"]
        self.assertEqual((o["within_one"], o["within_one_accuracy"]), (3, 0.75))
        self.assertEqual((o["within_one_low"], o["within_one_high"]), calibrate.wilson(3, 4))
        self.assertAlmostEqual(o["mean_error"], 3 / 4)
        # The fourth row has no `score`, so its expected score is the weighted level, 1.0.
        self.assertEqual(o["expected_rows"], 4)
        self.assertAlmostEqual(o["expected_error"], (0.3 + 0.9 + 0.3 + 1.0) / 4)
        cuts = {c["level"]: c for c in o["cuts"]}
        self.assertEqual(sorted(cuts), [1, 2])
        # Label >= 1 holds on rows 2-4, whose expected scores are 1.1, 1.7, and 1.0; row 1 sits at 0.3. Every cut
        # above 0.3 and up to 1.0 is right on all four, and the tie goes to the one nearest 0.5.
        self.assertEqual((cuts[1]["cut"], cuts[1]["correct"], cuts[1]["flagged"], cuts[1]["actual"]), (0.5, 4, 3, 3))
        self.assertEqual(cuts[2]["correct"], 4)
        self.assertTrue(0.3 < cuts[2]["cut"] <= 1.0)
        # A level no row is labeled at or above gets no cut: any cut past the data would score 100%.
        lone = calibrate.evaluate(rows((score([0.8, 0.1, 0.1], 0.3), 0), (score([0.2, 0.7, 0.1], 0.9), 1)))
        self.assertEqual([c["level"] for c in lone["ordinal"]["cuts"]], [1])
        # A malformed answer neither crashes nor builds a huge grid: an integer too large for a float falls back to
        # the weighted level, and a level number far past any real Score gets no cuts.
        huge = calibrate.evaluate(rows((score([0.8, 0.1, 0.1], 10 ** 400), 0), (score([0.1, 0.1, 0.8], 2.0), 2)))
        self.assertAlmostEqual(huge["ordinal"]["expected_error"], (0.3 + 0) / 2)
        far = {"type": "score", "probabilities": {"0": 0.5, "100000000": 0.5}, "confidence": 0.5, "score": 1.0}
        self.assertEqual(calibrate.evaluate(rows((far, 0)))["ordinal"]["cuts"], [])
        # Choice and Noul questions have no ordinal block.
        self.assertIsNone(calibrate.evaluate(rows((choice("billing", 0.9), "billing")))["ordinal"])

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
        for bad in (None, "rows", [], [{"answer": {"type": "bbox", "box": {}}, "label": "x"}],
                    rows(({"type": "noul", "noul": 0.5}, True), (choice("billing", 0.9), "billing"))):
            with self.subTest(bad=bad), self.assertRaises(calibrate.CalibrationError):
                calibrate.evaluate(bad)
        with self.assertRaises(calibrate.CalibrationError):
            calibrate.evaluate(rows((choice("billing", 0.9), "billing")), "vibes")

    def test_box_answers_are_right_when_they_overlap_their_label(self):
        def box(left, top, right, bottom, confidence):
            return {"type": "box", "box": {"left": left, "top": top, "right": right, "bottom": bottom}, "confidence": confidence}
        label = {"left": 0.2, "top": 0.2, "right": 0.6, "bottom": 0.6}
        r = calibrate.evaluate(rows(
            (box(0.2, 0.2, 0.6, 0.6, 0.9), label),          # the same box: IoU 1
            (box(0.25, 0.2, 0.6, 0.6, 0.8), label),         # IoU 0.875
            (box(0.4, 0.4, 0.8, 0.8, 0.3), label),          # IoU 1/7: wrong, and unsure
            (box(0.2, 0.2, 0.6, 0.6, 0.7), {"left": 0.5, "top": 0, "right": 0.4, "bottom": 1}),  # left > right
            (box(0.2, 0.2, 0.6, 0.6, 0.7), None)))
        self.assertEqual((r["type"], r["labeled"], r["correct"], r["unlabeled"], len(r["invalid"])), ("box", 3, 2, 1, 1))
        self.assertEqual((r["classes"], r["confusion"], r["iou_right"]), ([], [], 0.5))
        self.assertAlmostEqual(r["iou_mean"], (1 + 0.875 + 1 / 7) / 3)
        self.assertEqual(r["rows"][0]["predicted"], "0.20, 0.20, 0.60, 0.60")
        by_t = {p["threshold"]: p for p in r["sweep"]}
        self.assertEqual((by_t[0.31]["automated"], by_t[0.31]["accuracy"]), (2, 1.0), "the gate reads the Box's confidence")
        self.assertEqual(calibrate.evaluate(rows((box(0.2, 0.2, 0.6, 0.6, 0.9), label)), "top_probability")["signals"], {"0": 0.9})
        self.assertAlmostEqual(calibrate.iou(label, {"left": 0.4, "top": 0.2, "right": 0.8, "bottom": 0.6}), 1 / 3)

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


class IntervalTests(unittest.TestCase):
    def test_wilson_matches_reference_values(self):
        self.assertEqual(calibrate.wilson(0, 0), (None, None))
        low, high = calibrate.wilson(38, 40)
        self.assertAlmostEqual(low, 0.8350, places=4)
        self.assertAlmostEqual(high, 0.9862, places=4)
        self.assertEqual(calibrate.wilson(10, 10)[1], 1.0)
        self.assertEqual(calibrate.wilson(0, 10)[0], 0.0)
        self.assertAlmostEqual(calibrate.wilson(10, 10)[0], 10 / (10 + calibrate.Z ** 2))

    def test_rows_needed_is_the_fewest_all_right_rows_that_show_the_target(self):
        self.assertEqual([calibrate.rows_needed(t) for t in calibrate.TARGETS], [35, 73, 381])
        for target in calibrate.TARGETS:
            n = calibrate.rows_needed(target)
            self.assertTrue(calibrate.meets(n, n, target, "lower"))
            self.assertFalse(calibrate.meets(n - 1, n - 1, target, "lower"))

    def test_sweep_and_report_carry_intervals(self):
        report = calibrate.evaluate(rows(*[(choice("billing", 0.9, 0.9), "billing")] * 19 + [(choice("none", 0.5, 0.2), "billing")]))
        self.assertEqual(report["bound"], "estimate")
        self.assertEqual((report["accuracy_low"], report["accuracy_high"]), calibrate.wilson(19, 20))
        p = report["sweep"][50]
        self.assertEqual((p["automated"], p["correct"]), (19, 19))
        self.assertEqual((p["low"], p["high"]), calibrate.wilson(19, 19))
        self.assertEqual((report["sweep"][100]["low"], report["sweep"][100]["high"]), (None, None))

    def test_a_lower_bound_target_needs_enough_rows_not_only_a_clean_sample(self):
        # Twenty right rows at 0.9 and one wrong row at 0.2. Measured, threshold 0 is 95.2% accurate,
        # and 0.21 is 100% accurate on 20 rows. Twenty clean rows only show 83.9% with 95% confidence.
        data = rows(*[(choice("billing", 0.9, 0.9), "billing")] * 20 + [(choice("none", 0.5, 0.2), "billing")])
        estimate = {t["target"]: t for t in calibrate.evaluate(data)["targets"]}
        lower = {t["target"]: t for t in calibrate.evaluate(data, bound="lower")["targets"]}
        self.assertEqual([estimate[t]["threshold"] for t in calibrate.TARGETS], [0.0, 0.0, 0.21])
        self.assertAlmostEqual(estimate[0.99]["low"], 20 / (20 + calibrate.Z ** 2))
        for target in calibrate.TARGETS:
            self.assertIsNone(lower[target]["threshold"])
            self.assertEqual(lower[target]["needed"], calibrate.rows_needed(target))

    def test_automated_needed_is_the_fewest_rows_at_an_accuracy(self):
        # At a perfect accuracy this is rows_needed; below or at the target no number of rows is enough.
        for target in calibrate.TARGETS:
            self.assertEqual(calibrate.automated_needed(1.0, target), calibrate.rows_needed(target))
            self.assertIsNone(calibrate.automated_needed(target, target))
        n = calibrate.automated_needed(0.97, 0.95)
        self.assertGreaterEqual(calibrate.wilson(0.97 * n, n)[0], 0.95)
        self.assertLess(calibrate.wilson(0.97 * (n - 1), n - 1)[0], 0.95)
        # Just above the target takes a great many rows, but a finite number.
        n = calibrate.automated_needed(0.9501, 0.95)
        self.assertGreater(n, 1000000)
        self.assertGreaterEqual(calibrate.wilson(0.9501 * n, n)[0] + calibrate._EPS, 0.95)  # the tie rule meets() uses
        self.assertEqual(calibrate.plan([(100, 100)], 100, 0.99)["automated"], calibrate.automated_needed(101 / 102, 0.99))

    def test_plan_smooths_accuracy_and_picks_the_fewest_more_rows(self):
        # 3 of 3 right smooths to 80%, which cannot show 90%; 20 of 20 smooths to 95.5% and needs 92 automated
        # rows, 92 / (20 / 21) = 96.6, so 76 more labeled rows.
        found = calibrate.plan([(21, 20), (20, 20), (3, 3)], 21, 0.9)
        self.assertEqual(found["index"], 1)
        self.assertAlmostEqual(found["accuracy"], 21 / 22)
        need = calibrate.automated_needed(21 / 22, 0.9)
        self.assertEqual(found["automated"], need)
        self.assertEqual(found["more"], math.ceil(need * 21 / 20) - 21)
        self.assertIsNone(calibrate.plan([(3, 3), (0, 0)], 3, 0.9))

    def test_a_lower_bound_target_that_is_not_shown_carries_a_plan(self):
        # The 20 clean rows above threshold 0.21 cannot show 95% yet; the plan names that threshold.
        data = rows(*[(choice("billing", 0.9, 0.9), "billing")] * 20 + [(choice("none", 0.5, 0.2), "billing")])
        lower = {t["target"]: t for t in calibrate.evaluate(data, bound="lower")["targets"]}
        plan = lower[0.95]["plan"]
        self.assertEqual(plan["threshold"], 0.21)
        self.assertEqual(plan["more"], calibrate.plan([(20, 20)], 21, 0.95)["more"])
        self.assertNotIn("index", plan)
        # Measured targets and reached targets carry none.
        self.assertTrue(all(t["plan"] is None for t in calibrate.evaluate(data)["targets"]))

    def test_a_lower_bound_target_can_include_a_wrong_row_when_there_are_enough_rows(self):
        # 60 right rows and one wrong row: 98.4% measured, and the 95% lower bound is 91.3%.
        data = rows(*[(choice("billing", 0.9, 0.9), "billing")] * 60 + [(choice("none", 0.6, 0.5), "billing")])
        lower = {t["target"]: t for t in calibrate.evaluate(data, bound="lower")["targets"]}
        self.assertEqual((lower[0.9]["threshold"], lower[0.9]["automated"]), (0.0, 61))
        self.assertGreaterEqual(lower[0.9]["low"], 0.9)
        # 95% would need 73 clean rows; dropping the wrong row leaves 60, so it is not reached.
        self.assertIsNone(lower[0.95]["threshold"])

    def test_bad_bound_is_refused(self):
        with self.assertRaises(calibrate.CalibrationError):
            calibrate.evaluate(rows((choice("billing", 0.9), "billing")), bound="vibes")


if __name__ == "__main__":
    unittest.main()
