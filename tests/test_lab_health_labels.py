"""Lab pack health-labels: label coverage and quality findings, without label values."""

import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev import health, lab  # noqa: E402
from jev.lab.packs import health_labels  # noqa: E402

NOUL = {"type": "noul", "instructions": "Is the customer in a hurry?"}
TEAM = {"type": "choice", "instructions": "Which team handles it?",
        "criteria": {"billing": "Charges and refunds", "shipping": "Delivery problems", "product": "Questions about beans"}}
MOOD = {"type": "score", "instructions": "How upset is the customer?", "criteria": ["calm", "annoyed", "angry"]}
BOX = {"type": "box", "instructions": "Where is the tear in the bag?"}


def R(i, labels=None, test=False, picture=None, text=None):
    """A Harbor Coffee Co. ticket row; distinct per i unless text says otherwise."""
    row = {"text": text if text is not None else "Harbor ticket %d about a coffee order" % i}
    if labels is not None:
        row["_expect"] = labels
    if test:
        row["_test"] = True
    if picture:
        row["_image"] = picture
    return row


def labeled(values, qid="team", start=1):
    return [R(start + i, {qid: value}) for i, value in enumerate(values)]


def box(left, top, right, bottom):
    return {"left": left, "top": top, "right": right, "bottom": bottom}


CASES = {
    "too_few_cv_labels": {
        "hit": ([R(1, {"urgent": True}), R(2, {"urgent": False}), R(3), R(4, {"urgent": "yes"}), R(5, {"urgent": True}, test=True)],
                {"urgent": NOUL}),
        "miss": (labeled([True, False] * 5, "urgent"), {"urgent": NOUL}),
        "rows": [1, 2, 4], "message": re.compile(r"`urgent` has 3 valid labels on tuning rows; .* at least 10\.")},
    "too_few_distinct_inputs": {
        "hit": ([R(i, {"urgent": True}, text="Harbor ticket kind %d" % (i % 4)) for i in range(1, 11)], {"urgent": NOUL}),
        "miss": ([R(i, {"urgent": True}, text="Harbor ticket kind %d" % (i % 5)) for i in range(1, 11)], {"urgent": NOUL}),
        "rows": list(range(1, 11)), "message": re.compile(r"10 valid tuning labels come from 4 distinct inputs.*at least 5\.")},
    "target_not_verifiable": {
        "hit": (labeled([True] * 40, "urgent") + [R(41)], {"urgent": NOUL}),
        "miss": (labeled([True] * 73, "urgent"), {"urgent": NOUL}),
        "rows": list(range(1, 41)), "message": re.compile(r"has 40 valid tuning labels: .*cannot show 95% \(73 rows\) at 95% confidence\.$")},
    "labels_only_on_held_out": {
        "hit": ([R(1), R(2, {"team": "billing"}), R(3, {"urgent": True}, test=True), R(4, {"urgent": False}, test=True)],
                {"urgent": NOUL, "team": TEAM}),
        "miss": ([R(1, {"urgent": True}), R(3, {"urgent": True}, test=True)], {"urgent": NOUL}),
        "rows": [3, 4], "message": re.compile(r"^Question `urgent` has valid labels only on held-out rows")},
    "partial_label_rows": {
        "hit": ([R(1, {"urgent": True, "team": "billing"}), R(2, {"urgent": True}), R(3, {"team": "product"}, test=True), R(4)],
                {"urgent": NOUL, "team": TEAM}),
        "miss": ([R(1, {"urgent": True, "team": "billing"}), R(2), R(3, {"urgent": False, "team": "shipping"}, test=True)],
                 {"urgent": NOUL, "team": TEAM}),
        "rows": [2, 3], "message": re.compile(r"^2 rows are labeled for some of the 2 questions but not the others \(1 held out\)\.$")},
    "label_key_near_miss": {
        "hit": ([R(1, {"Is-Urgent": True}), R(2, {"is_urgent": False}), R(3, {"isurgent": True}), R(4, {"priority": True})],
                {"is_urgent": NOUL}),
        "miss": ([R(1, {"is_urgent": True}), R(2, {"priority": True}), R(3, {"Is-Urgent": None})], {"is_urgent": NOUL}),
        "rows": [1, 3], "message": re.compile(r"^Labels saved under `(Is-Urgent|isurgent)` look meant for question `is_urgent`")},
    "labels_on_empty_inputs": {
        "hit": ([{"text": "", "_expect": {"urgent": True}}, {"_test": True, "_expect": {"urgent": False}},
                 {"note": None, "items": [], "_expect": {"urgent": True}}, {"_image": "torn-bag", "_expect": {"urgent": True}},
                 R(5, {"urgent": True})], {"urgent": NOUL}),
        "miss": ([{"text": ""}, {"note": None, "_expect": {"urgent": None}}, R(3, {"urgent": True})], {"urgent": NOUL}),
        "rows": [1, 2, 3], "message": re.compile(r"^3 rows carry labels but no input")},
    "single_answer": {
        "hit": (labeled(["billing"] * 5) + [R(6, {"team": "shipping"}, test=True)], {"team": TEAM}),
        "miss": (labeled(["billing"] * 4 + ["shipping"]), {"team": TEAM}),
        "rows": [1, 2, 3, 4, 5], "message": re.compile(r"^Every one of the 5 valid tuning labels for `team` is the same answer")},
    "dominant_answer": {
        "hit": (labeled(["billing"] * 9 + ["shipping"]), {"team": TEAM}),
        "miss": (labeled(["billing"] * 8 + ["shipping"] * 2), {"team": TEAM}),
        "rows": list(range(1, 11)), "message": re.compile(r"^One answer holds 90% of `team`'s 10 valid tuning labels")},
    "rare_answers": {
        "hit": (labeled(["billing"] * 16 + ["shipping"] * 3 + ["product"]), {"team": TEAM}),
        "miss": (labeled(["billing"] * 10 + ["shipping"] * 5 + ["product"] * 5), {"team": TEAM}),
        "rows": [17, 18, 19, 20], "message": re.compile(r"^Question `team`: 2 answers have fewer than 5 tuning labels each")},
    "unused_choice_options": {
        "hit": (labeled(["billing", "billing", "shipping"]) + [R(4, {"team": "product"}, test=True)], {"team": TEAM}),
        "miss": (labeled(["billing", "shipping", "product"]), {"team": TEAM}),
        "rows": [1, 2, 3], "message": re.compile(r"^Question `team`: 1 of its 3 options has no tuning label, so tuning never sees it\.$")},
    "score_level_gap": {
        "hit": (labeled([0, 2, 0], "mood") + [R(4, {"mood": 1}, test=True)], {"mood": MOOD}),
        "miss": (labeled([0, 1, 1], "mood"), {"mood": MOOD}),
        "rows": [1, 2, 3], "message": re.compile(r"^Question `mood`: 1 level between its lowest and highest labeled levels has no tuning label\.$")},
    "redundant_questions": {
        "hit": ([R(i, {"urgent": i % 3 == 0, "rush": i % 3 == 0}) for i in range(1, 11)] + [R(11, {"urgent": True})],
                {"urgent": NOUL, "rush": NOUL}),
        # urgent and rush differ on row 10; calm and quiet agree on all 10 rows only because each is always true.
        "miss": ([R(i, {"urgent": i % 3 == 0, "rush": i % 3 == 0 or i == 10, "calm": True, "quiet": True}) for i in range(1, 11)],
                 {"urgent": NOUL, "rush": NOUL, "calm": NOUL, "quiet": NOUL}),
        "rows": list(range(1, 11)), "message": re.compile(r"^Questions `urgent` and `rush` have the same label on all 10 tuning rows")},
    "inverse_noul_questions": {
        "hit": ([R(i, {"urgent": i % 2 == 0, "relaxed": i % 2 == 1}) for i in range(1, 11)], {"urgent": NOUL, "relaxed": NOUL}),
        # 9 shared rows are too few; hurry is always true and late always false on 10 rows, opposite only trivially.
        "miss": ([R(i, {"urgent": i % 2 == 0, "relaxed": i % 2 == 1, "hurry": True, "late": False}) for i in range(1, 10)]
                 + [R(10, {"hurry": True, "late": False})],
                 {"urgent": NOUL, "relaxed": NOUL, "hurry": NOUL, "late": NOUL}),
        "rows": list(range(1, 11)), "message": re.compile(r"^Questions `urgent` and `relaxed` have opposite labels on all 10")},
    "unlabeled_test_rows": {
        "hit": ([R(1), R(2, test=True), R(3, {"other": True}, test=True), R(4, {"urgent": True}, test=True)], {"urgent": NOUL}),
        "miss": ([R(1), R(2, {"urgent": False}, test=True)], {"urgent": NOUL}),
        "rows": [2, 3], "message": re.compile(r"^2 held-out rows have no labels for the selected questions")},
    "test_share_too_small": {
        "hit": (labeled([True] * 19, "urgent") + [R(20, {"urgent": True}, test=True), R(21)], {"urgent": NOUL}),
        "miss": (labeled([True] * 18, "urgent") + [R(19, {"urgent": True}, test=True), R(20, {"urgent": True}, test=True)],
                 {"urgent": NOUL}),
        "rows": [20], "message": re.compile(r"^Held-out rows are 1 of 20 labeled rows \(5%\); a test split holds 10% to 50%")},
    "test_share_too_large": {
        "hit": ([R(1, {"urgent": True})] + [R(i, {"urgent": True}, test=True) for i in (2, 3, 4)], {"urgent": NOUL}),
        "miss": ([R(1, {"urgent": True}), R(2, {"urgent": True}), R(3, {"urgent": True}, test=True), R(4, {"urgent": True}, test=True)],
                 {"urgent": NOUL}),
        "rows": [2, 3, 4], "message": re.compile(r"^Held-out rows are 3 of 4 labeled rows \(75%\)")},
    "split_side_too_small": {
        "hit": (labeled([True] * 5, "urgent") + [R(6, {"urgent": True}, test=True), R(7, test=True)], {"urgent": NOUL}),
        "miss": (labeled([True] * 2, "urgent") + [R(3, {"urgent": True}, test=True), R(4, {"urgent": False}, test=True)],
                 {"urgent": NOUL}),
        "rows": [6, 7], "message": re.compile(r"^The split has 5 labeled tuning and 1 labeled held-out rows; each side needs at least 2\.$")},
    "test_rows_one_block": {
        "hit": ([R(i, {"urgent": True}, test=i > 3) for i in range(1, 7)], {"urgent": NOUL}),
        "miss": ([R(i, {"urgent": True}, test=i % 2 == 0) for i in range(1, 7)], {"urgent": NOUL}),
        "rows": [4, 5, 6], "message": re.compile(r"^All 3 held-out rows are the last rows in order")},
    "score_labels_one_based": {
        "hit": (labeled([1, 2, 3, 3], "mood") + [R(5, {"mood": 3}, test=True)], {"mood": MOOD}),
        "miss": (labeled([0, 1, 3], "mood"), {"mood": MOOD}),
        "rows": [3, 4], "message": re.compile(r"^Question `mood`: these tuning labels are one past the top level")},
    "box_label_tiny": {
        "hit": ([R(1, {"tear": box(0.1, 0.1, 0.15, 0.15)}, picture="torn-bag"), R(2, {"tear": box(0.1, 0.1, 0.5, 0.5)}, picture="torn-bag"),
                 R(3, {"tear": box(0.1, 0.1, 0.12, 0.12)}, test=True, picture="torn-bag")], {"tear": BOX}),
        "miss": ([R(1, {"tear": box(0.1, 0.1, 0.2, 0.2)}, picture="torn-bag")], {"tear": BOX}),
        "rows": [1], "message": re.compile(r"^Question `tear`: these tuning Box labels cover under 0\.5% of the picture")},
    "box_label_full_picture": {
        "hit": ([R(1, {"tear": box(0, 0.02, 1, 0.98)}, picture="torn-bag"), R(2, {"tear": box(0.1, 0.1, 0.5, 0.5)}, picture="torn-bag")],
                {"tear": BOX}),
        "miss": ([R(1, {"tear": box(0.05, 0.05, 0.95, 0.95)}, picture="torn-bag")], {"tear": BOX}),
        "rows": [1], "message": re.compile(r"over 95% of the picture")},
    "box_label_sliver": {
        "hit": ([R(1, {"tear": box(0.1, 0.5, 0.9, 0.53)}, picture="torn-bag"), R(2, {"tear": box(0.1, 0.5, 0.4, 0.51)}, picture="torn-bag"),
                 R(3, {"tear": box(0.1, 0.1, 0.5, 0.5)}, picture="torn-bag")], {"tear": BOX}),
        "miss": ([R(1, {"tear": box(0.1, 0.5, 0.9, 0.55)}, picture="torn-bag")], {"tear": BOX}),
        "rows": [1], "message": re.compile(r"over 20 times longer than wide")},
    "box_label_without_picture": {
        "hit": ([R(1, {"tear": box(0.1, 0.1, 0.5, 0.5)}, picture="torn-bag"), R(2, {"tear": box(0.1, 0.1, 0.5, 0.5)}),
                 R(3, {"tear": box(0.2, 0.2, 0.5, 0.5)}, test=True)], {"tear": BOX}),
        "miss": ([R(1, {"tear": box(0.1, 0.1, 0.5, 0.5)}, picture="torn-bag"), R(2)], {"tear": BOX}),
        "rows": [2, 3], "message": re.compile(r"^Question `tear`: these rows have a Box label but name no picture")},
    "labels_not_canonical": {
        "hit": ([R(1, {"urgent": True, "mood": 2}), R(2, {"urgent": "yes", "mood": 0}), R(3, {"urgent": 1, "mood": "1"}),
                 R(4, {"urgent": False, "mood": 2.0}), R(5, {"urgent": "no", "mood": "2"}, test=True)], {"urgent": NOUL, "mood": MOOD}),
        "miss": ([R(1, {"urgent": True, "mood": 2}), R(2, {"urgent": "maybe", "mood": 7})], {"urgent": NOUL, "mood": MOOD}),
        "rows": [2, 3, 4], "message": re.compile(r"^Question `(urgent|mood)`: these tuning labels are valid but not saved as (true or false|a whole number)")},
    "fixable_choice_labels": {
        "hit": (labeled(["Billing", " shipping ", "billing", "refunds"]) + [R(5, {"team": "PRODUCT"}, test=True)], {"team": TEAM}),
        "miss": (labeled(["billing", "refunds"]), {"team": TEAM}),
        "rows": [1, 2], "message": re.compile(r"^Question `team`: these tuning labels match one option except for case or spaces")},
    "label_matches_description": {
        "hit": ([R(1, {"team": "Delivery problems"}), R(2, {"mood": "annoyed"}), R(3, {"team": "billing", "mood": 1}),
                 R(4, {"team": "Charges and refunds"}, test=True)], {"team": TEAM, "mood": MOOD}),
        "miss": ([R(1, {"team": "refunds"}), R(2, {"mood": 2})], {"team": TEAM, "mood": MOOD}),
        "rows": [1, 2], "message": re.compile(r"^Question `(team|mood)`: these tuning labels repeat a description from the criteria instead of giving its (option key|level number)\.$")},
    "blank_text_labels": {
        "hit": ([R(1, {"urgent": ""}), R(2, {"urgent": None}), R(3, {"urgent": "  "}), R(4, {"urgent": ""}, test=True)], {"urgent": NOUL}),
        "miss": ([R(1, {"urgent": None}), R(2, {"urgent": False})], {"urgent": NOUL}),
        # Row 4 is held out: its label is never described, blank or not.
        "rows": [1, 3], "message": re.compile(r"^Question `urgent`: these tuning labels are blank text")},
}


class HealthLabelsTests(pack_tests(health_labels.PACK, CASES)):
    def test_health_report_carries_findings_without_label_values(self):
        """Through jev.health.analyze, findings land under "lab" with their codes, and the report's lab part names
        no label value, tuning or held out."""
        rows = labeled(["billing"] * 9 + ["shipping"]) + [R(11, {"team": "product"}, test=True), R(12, {"team": "Shipping"})]
        saved = lab._PACKS
        lab._PACKS = [health_labels.PACK]  # this pack alone, whatever else jev/lab/packs holds
        try:
            report = health.analyze(rows, {"team": TEAM})
        finally:
            lab._PACKS = saved
        codes = {item["code"] for item in report["lab"]}
        self.assertIn("health-labels/dominant_answer", codes)
        self.assertNotIn("health-labels/answers_only_held_out", codes)
        self.assertIn("health-labels/fixable_choice_labels", codes)
        text = json.dumps(report["lab"])
        for value in ("billing", "shipping", "product", "Shipping"):
            self.assertNotIn(value, text)

    def test_target_thresholds_at_35_and_73_labels(self):
        """Wilson's lower bound with every row right is n / (n + 1.96^2): 90% needs 1.96^2 * 9 = 34.57 -> 35 rows and
        95% needs 1.96^2 * 19 = 72.99 -> 73 rows."""
        check = health_labels.target_not_verifiable
        found = check(labeled([True] * 34, "urgent"), {"urgent": NOUL})
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0]["message"].endswith("cannot show 90% (35 rows) or 95% (73 rows) at 95% confidence."))
        found = check(labeled([True] * 35, "urgent"), {"urgent": NOUL})
        self.assertTrue(found[0]["message"].endswith("cannot show 95% (73 rows) at 95% confidence."))
        self.assertEqual(check(labeled([True] * 9, "urgent"), {"urgent": NOUL}), [])  # too_few_cv_labels' range

    def test_findings_never_name_a_label_value(self):
        rows = labeled(["billing"] * 9 + ["shipping"]) + [R(11, {"team": "product"}, test=True), R(12, {"team": "Shipping"})]
        for feature in health_labels.PACK["features"]:
            for item in feature["check"](rows, {"team": TEAM}):
                for value in ("billing", "shipping", "product", "Shipping"):
                    self.assertNotIn(value, item["message"])


if __name__ == "__main__":
    unittest.main()
