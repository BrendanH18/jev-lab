"""Slices group scored rows by a field of their input; these tests pin the fields offered, the counts, and the marks."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import slices  # noqa: E402
from jev.calibrate import CalibrationError  # noqa: E402


def row(state, correct, automated=True):
    return {"row": state, "correct": correct, "automated": automated}


def by_value(rep):
    return {s["value"]: s for s in rep["slices"]}


class FieldTests(unittest.TestCase):
    def test_offers_fields_with_two_to_twenty_values(self):
        rows = [row({"text": "t%d" % i, "channel": ["email", "chat"][i % 2], "one": "x", "n": i % 3,
                     "_expect": {"q": True}}, True) for i in range(30)]
        self.assertEqual(slices.fields(rows), [{"name": "channel", "values": 2}, {"name": "n", "values": 3}])
        # Text rows have no fields; a field missing from some rows counts "(none)" as a value.
        self.assertEqual(slices.fields([row("plain", True), row({"lang": "en"}, True)]), [{"name": "lang", "values": 2}])


class EvaluateTests(unittest.TestCase):
    def test_counts_accuracy_and_automation_per_value(self):
        rows = ([row({"channel": "email"}, True)] * 6 + [row({"channel": "email"}, False, automated=False)]
                + [row({"channel": "chat"}, True), row({"channel": "chat"}, False), row({"channel": "chat"}, True, False)])
        rep = slices.evaluate(rows)
        self.assertEqual(rep["field"], "channel")
        self.assertEqual([s["value"] for s in rep["slices"]], ["email", "chat"])  # largest first
        email, chat = by_value(rep)["email"], by_value(rep)["chat"]
        self.assertEqual((email["rows"], email["correct"], email["automated"], email["wrong_automated"]), (7, 6, 6, 0))
        self.assertAlmostEqual(email["accuracy"], 6 / 7)
        self.assertEqual(email["automated_accuracy"], 1.0)
        self.assertEqual((chat["automated"], chat["automated_correct"], chat["coverage"]), (2, 1, 2 / 3))
        self.assertEqual((rep["overall"]["rows"], rep["overall"]["automated"]), (10, 8))
        self.assertLess(chat["automated_low"], 0.5)
        self.assertGreater(chat["automated_high"], 0.5)

    def test_marks_a_slice_only_when_it_is_worse_than_the_rest_beyond_chance(self):
        good = [row({"lang": "en"}, True)] * 60
        bad = [row({"lang": "fr"}, i % 2 == 0) for i in range(30)]  # 15 of 30 right against 60 of 61
        small = [row({"lang": "de"}, False)]  # one wrong row could happen by chance
        rep = slices.evaluate(good + bad + small)
        marks = {s["value"]: (s["below"], s["below_all"]) for s in rep["slices"]}
        self.assertEqual(marks, {"en": (False, False), "fr": (True, True), "de": (False, False)})
        self.assertLess(by_value(rep)["fr"]["p"], 0.001)
        self.assertAlmostEqual(by_value(rep)["de"]["p"], 16 / 91)  # 0 of 1 right, drawn from 75 of 91 right
        # One wrong row of five against five right is not evidence: p = 1 - C(9,5)/C(10,5) = 0.5.
        even = slices.evaluate([row({"g": "a"}, True)] * 5 + [row({"g": "b"}, True)] * 4 + [row({"g": "b"}, False)])
        self.assertEqual([s["below"] for s in even["slices"]], [False, False])
        self.assertAlmostEqual(by_value(even)["b"]["p"], 0.5)

    def test_worse_p_is_a_one_sided_fisher_test(self):
        self.assertEqual(slices.worse_p(3, 3, 0, 3), 1.0)  # the slice is better: nothing to see
        self.assertAlmostEqual(slices.worse_p(0, 3, 3, 3), 1 / 20)  # all 3 wrong vs all 3 right: C(3,0)C(3,3)/C(6,3)
        self.assertIsNone(slices.worse_p(0, 0, 3, 3))
        self.assertIsNone(slices.worse_p(1, 2, 0, 0))

    def test_no_automated_rows_is_not_a_mark(self):
        rows = [row({"g": "a"}, True, False), row({"g": "b"}, True)]
        rep = slices.evaluate(rows)
        a = by_value(rep)["a"]
        self.assertEqual((a["automated"], a["automated_accuracy"], a["below"]), (0, None, False))

    def test_missing_values_slice_together_and_sort_last_among_equals(self):
        rows = [row({"g": "a"}, True), row({"other": 1}, True), row("text", False), row({"g": ""}, True)]
        rep = slices.evaluate(rows, "g")
        self.assertEqual([(s["value"], s["rows"]) for s in rep["slices"]], [("(none)", 3), ("a", 1)])
        tie = slices.evaluate([row({"g": "z"}, True), row({}, True)], "g")
        self.assertEqual([s["value"] for s in tie["slices"]], ["z", "(none)"])

    def test_values_compare_as_text_and_long_values_are_cut(self):
        rows = [row({"n": 1}, True), row({"n": "1"}, True), row({"n": "x" * 200}, True), row({"n": "x" * 199 + "y"}, True)]
        values = [s["value"] for s in slices.evaluate(rows, "n")["slices"]]
        self.assertEqual(values[0], "1")
        # Long values that differ only past the cut stay separate slices; only the shown value is cut.
        self.assertEqual([len(v) for v in values[1:]], [slices.MAX_VALUE_CHARS] * 2)
        many = [row({"n": "p" * 100 + str(i)}, True) for i in range(21)] + [row({"n": "other"}, True)]
        self.assertEqual(slices.fields(many), [])  # 22 values: free text, not a slice

    def test_no_field_worth_slicing(self):
        rep = slices.evaluate([row("a", True), row("b", False)])
        self.assertEqual((rep["fields"], rep["field"], rep["slices"]), ([], None, []))
        self.assertEqual(rep["overall"]["rows"], 2)

    def test_rejects_bad_input(self):
        # A field these rows cannot be sliced by falls back to the first one they can.
        self.assertEqual(slices.evaluate([row({"g": "a"}, True), row({"g": "b"}, True)], "text")["field"], "g")
        for bad in ("rows", [{"row": {}, "correct": 1, "automated": True}], [{"row": {}, "correct": True}]):
            with self.assertRaises(CalibrationError):
                slices.evaluate(bad)
        with self.assertRaisesRegex(CalibrationError, "At most"):
            slices.evaluate([row({}, True)] * 1001)


if __name__ == "__main__":
    unittest.main()
