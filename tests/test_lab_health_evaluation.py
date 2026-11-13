"""Lab pack health-evaluation: evaluation readiness findings, without label or input values."""

import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev import health, lab, workbench  # noqa: E402
from jev.lab.packs import health_evaluation  # noqa: E402

NOUL = {"type": "noul", "instructions": "Is `text` urgent?"}
ON_MESSAGE = {"type": "noul", "instructions": "Is `message` urgent?"}
TEAM = {"type": "choice", "instructions": "Which team handles `text`?",
        "criteria": {"billing": "Charges and refunds", "shipping": "Delivery problems", "product": "Questions about beans"}}
MOOD = {"type": "score", "instructions": "How upset is `text`?", "criteria": ["calm", "annoyed", "angry"]}
BOX = {"type": "box", "instructions": "the tear in the bag in `photo`"}
MISSING_PICTURE = "0000000000000000.png"
DAMAGED_PICTURE = "1111111111111111.png"


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


def C(i, channel, labels=None, test=False):
    """An object row with a slice field: the channel a Harbor note came in on."""
    row = {"message": "Harbor note %d about an order" % i, "channel": channel}
    if labels is not None:
        row["_expect"] = labels
    if test:
        row["_test"] = True
    return row


def labeled(values, qid="urgent", start=1):
    return [R(start + i, {qid: value}) for i, value in enumerate(values)]


CASES = {
    "recalibrate_too_few": {
        "hit": (labeled([True, False] * 6) + [R(13)], {"urgent": NOUL}),
        "miss": (labeled([True, False] * 10), {"urgent": NOUL}),
        "rows": list(range(1, 13)), "message": re.compile(r"^Question `urgent` has 12 valid tuning labels; Recalibrate .* from 20\.$")},
    "answer_set_folds_short": {
        # Ten distinct inputs make five folds of 2: each cut is fit on 8 rows, under the 9 (90%) and 19 (95%) it needs.
        "hit": (labeled([True, False] * 5), {"urgent": NOUL}),
        # 24 inputs make folds of 5, 5, 5, 5, 4: the smallest training side has 19 rows, enough for 95%.
        "miss": (labeled([True, False] * 12), {"urgent": NOUL}),
        "rows": list(range(1, 11)),
        "message": re.compile(r"^Question `urgent`: with 10 valid tuning labels, the smallest training side of a fold has 8 rows, "
                              r"too few for an answer set to promise 90% \(9 rows\) or 95% \(19 rows\)")},
    "fewer_labels_than_answers": {
        "hit": (labeled(["billing", "shipping"], "team") + [R(3), R(4, {"team": "product"}, test=True)], {"team": TEAM}),
        "miss": (labeled(["billing", "shipping", "billing"], "team"), {"team": TEAM}),
        "rows": [1, 2], "message": re.compile(r"^Question `team` has 2 valid tuning labels for its 3 options, so at least 1 option is never tested\.$")},
    "score_ends_unlabeled": {
        "hit": (labeled([1] * 5 + [2] * 5, "mood"), {"mood": MOOD}),
        "miss": (labeled([0, 1, 2] * 4, "mood"), {"mood": MOOD}),
        "rows": list(range(1, 11)), "message": re.compile(r"^Question `mood`: level 0 has no tuning label among 10,")},
    "answer_few_inputs": {
        # Six billing labels from two inputs (three copies each); six shipping labels from six inputs.
        "hit": ([R(i, {"team": "billing"}, text="Harbor billing ticket kind %d" % (i % 2)) for i in range(1, 7)]
                + labeled(["shipping"] * 6, "team", start=7), {"team": TEAM}),
        "miss": ([R(i, {"team": "billing"}, text="Harbor billing ticket kind %d" % (i % 5)) for i in range(1, 7)]
                 + labeled(["shipping"] * 6, "team", start=7), {"team": TEAM}),
        "rows": list(range(1, 7)),
        "message": re.compile(r"^Question `team`: 1 answer has at least 5 tuning labels but from fewer than 5 distinct inputs")},
    "group_larger_than_fold": {
        # Three copies are 3 of 12 labeled tuning rows: 3 * 5 = 15 > 12.
        "hit": ([R(i, {"urgent": True}, text="Harbor copied ticket") for i in (1, 2, 3)] + labeled([False] * 9, start=4),
                {"urgent": NOUL}),
        # Two copies: 2 * 5 = 10, not over 12.
        "miss": ([R(i, {"urgent": True}, text="Harbor copied ticket") for i in (1, 2)] + labeled([False] * 10, start=3),
                 {"urgent": NOUL}),
        "rows": [1, 2, 3], "message": re.compile(r"^These 3 labeled copies of one input are more than a fifth of the 12 labeled tuning rows")},
    "gate_rows_too_few": {
        "hit": (labeled([True, False] * 5) + labeled(["billing", "shipping"] * 5, "team", start=11), {"urgent": NOUL, "team": TEAM}),
        "miss": ([R(i, {"urgent": i % 2 == 0, "team": "billing" if i % 2 else "shipping"}) for i in range(1, 11)],
                 {"urgent": NOUL, "team": TEAM}),
        "rows": list(range(1, 21)),
        "message": re.compile(r"^Questions `urgent` and `team` each have at least 10 valid tuning labels, but 0 tuning rows are labeled")},
    "labeled_rows_missing_question_field": {
        "hit": ([{"message": "Harbor order late", "_expect": {"urgent": True}}, {"note": "Harbor beans stale", "_expect": {"urgent": False}},
                 {"note": "Harbor unlabeled"}], {"urgent": ON_MESSAGE}),
        "miss": ([{"message": "Harbor order late", "_expect": {"urgent": True}}, {"note": "Harbor unlabeled"}], {"urgent": ON_MESSAGE}),
        "rows": [2], "message": re.compile(r"^Question `urgent`: 1 labeled row lacks `message`, so the model cannot see")},
    "labels_cover_only_first_rows": {
        "hit": (labeled([True, False, True, False, True]) + [R(i) for i in range(6, 16)], {"urgent": NOUL}),
        "miss": (labeled([True, False, True, False]) + [R(5)] + labeled([True], start=6) + [R(i) for i in range(7, 17)], {"urgent": NOUL}),
        "rows": list(range(6, 16)), "message": re.compile(r"^Labels stop at row 5: the 10 rows after it carry none\.")},
    "held_out_question_too_few": {
        # Two labeled held-out rows make the split big enough, but only one of them is labeled for `urgent`.
        "hit": (labeled([True, False, True]) + [R(4, {"urgent": True}, test=True), R(5, {"team": "billing"}, test=True)],
                {"urgent": NOUL, "team": TEAM}),
        "miss": (labeled([True, False, True]) + [R(4, {"urgent": True}, test=True), R(5, {"urgent": False}, test=True)], {"urgent": NOUL}),
        "rows": [4, 5], "message": re.compile(r"^Question `urgent` has 1 valid label on held-out rows; .* at least 2\.$")},
    "held_out_cannot_show_90": {
        "hit": (labeled([True, False, True]) + [R(i, {"urgent": i % 2 == 0}, test=True) for i in (4, 5, 6)], {"urgent": NOUL}),
        "miss": (labeled([True, False, True]) + [R(4, {"urgent": True}, test=True), R(5, test=True)], {"urgent": NOUL}),
        "rows": [4, 5, 6],
        "message": re.compile(r"^Question `urgent` has 3 valid held-out labels: .*cannot show 90% accuracy at 95% confidence \(35 rows\)\.$")},
    "question_split_skewed": {
        # 41 labeled rows, 6 held out (15%): the split is fine, but `urgent` has 6 of its 11 labels held out (55%).
        "hit": (labeled(["billing"] * 30, "team") + labeled([True] * 5, start=31)
                + [R(i, {"urgent": False}, test=True) for i in range(36, 42)], {"urgent": NOUL, "team": TEAM}),
        "miss": (labeled(["billing"] * 30, "team") + labeled([True] * 6, start=31)
                 + [R(i, {"urgent": False}, test=True) for i in range(37, 43)], {"urgent": NOUL, "team": TEAM}),
        "rows": list(range(36, 42)),
        "message": re.compile(r"^Question `urgent`: 6 of its 11 valid labels \(55%\) are on held-out rows, outside 10% to 50%")},
    "slice_too_few_labels": {
        "hit": ([C(i, "email", {"urgent": i % 2 == 0}) for i in range(1, 11)] + [C(11, "chat", {"urgent": True}), C(12, "chat")],
                {"urgent": ON_MESSAGE}),
        "miss": ([C(i, "email" if i <= 10 else "chat", {"urgent": i % 2 == 0}) for i in range(1, 21)], {"urgent": ON_MESSAGE}),
        "rows": [11, 12],
        "message": re.compile(r"^Field `channel`: 1 of its 2 values on tuning rows has fewer than 10 valid labels for `urgent`")},
    "slice_single_answer": {
        "hit": ([C(i, "email", {"team": "billing"}) for i in range(1, 6)]
                + [C(i, "chat", {"team": "billing" if i % 2 else "shipping"}) for i in range(6, 11)], {"team": TEAM}),
        "miss": ([C(i, "email", {"team": "billing"}) for i in range(1, 5)]
                 + [C(i, "chat", {"team": "billing" if i % 2 else "shipping"}) for i in range(5, 11)], {"team": TEAM}),
        "rows": [1, 2, 3, 4, 5],
        "message": re.compile(r"^Field `channel`: in 1 of its 2 values every valid tuning label for `team` is the same answer")},
    "slice_missing_from_held_out": {
        "hit": ([C(1, "email", {"urgent": True}), C(2, "email", {"urgent": False}), C(3, "chat", {"urgent": True}),
                 C(4, "chat", {"urgent": False}), C(5, "email", {"urgent": True}, test=True), C(6, "email", {"urgent": False}, test=True)],
                {"urgent": ON_MESSAGE}),
        "miss": ([C(1, "email", {"urgent": True}), C(2, "email", {"urgent": False}), C(3, "chat", {"urgent": True}),
                  C(4, "chat", {"urgent": False}), C(5, "email", {"urgent": True}, test=True), C(6, "chat", {"urgent": False}, test=True)],
                 {"urgent": ON_MESSAGE}),
        "rows": [3, 4],
        "message": re.compile(r"^Field `channel`: 1 of its 2 values on labeled tuning rows appears on no held-out row")},
    "slice_only_held_out": {
        "hit": ([C(1, "email", {"urgent": True}), C(2, "email", {"urgent": False}), C(3, "chat", {"urgent": True}),
                 C(4, "phone"), C(5, "phone", {"urgent": True}, test=True), C(6, "email", {"urgent": False}, test=True)],
                {"urgent": ON_MESSAGE}),
        "miss": ([C(1, "email", {"urgent": True}), C(2, "email", {"urgent": False}), C(3, "chat", {"urgent": True}),
                  C(4, "phone", {"urgent": False}), C(5, "phone", {"urgent": True}, test=True), C(6, "email", {"urgent": False}, test=True)],
                 {"urgent": ON_MESSAGE}),
        "rows": [5], "message": re.compile(r"^Field `channel`: 1 value on held-out rows appears on no labeled tuning row")},
    "missing_picture_files": {
        "hit": ([R(1, {"seen": True}, picture=MISSING_PICTURE), R(2, picture=MISSING_PICTURE), R(3, {"seen": False}, picture="torn-bag")],
                {"seen": NOUL}),
        "miss": ([R(1, {"seen": True}, picture="torn-bag"), R(2, picture=MISSING_PICTURE)], {"seen": NOUL}),
        "rows": [1], "message": re.compile(r"^1 labeled row names a picture that is not in the data directory")},
    "unreadable_picture_files": {
        "hit": ([R(1, {"seen": True}, picture=DAMAGED_PICTURE), R(2, {"seen": True}, picture="intact-bag"), R(3, picture=DAMAGED_PICTURE)],
                {"seen": NOUL}),
        "miss": ([R(1, {"seen": True}, picture="intact-bag"), R(2, picture=DAMAGED_PICTURE)], {"seen": NOUL}),
        "rows": [1], "message": re.compile(r"^1 labeled row names a picture file that is damaged, .*each side 280 to 1568 pixels")},
    "picture_across_split": {
        "hit": ([R(1, {"tear": None}, picture="torn-bag"), R(2, test=True, picture="torn-bag"), R(3, picture="crushed-box")],
                {"tear": BOX}),
        "miss": ([R(1, picture="torn-bag"), R(2, test=True, picture="crushed-box"), R(3, test=True, picture="torn-bag",
                                                                                       text="Harbor ticket 1 about a coffee order")],
                 {"tear": BOX}),
        "rows": [1, 2], "message": re.compile(r"^1 tuning row and 1 held-out row share one picture with different inputs")},
}


class HealthEvaluationTests(pack_tests(health_evaluation.PACK, CASES)):
    @classmethod
    def setUpClass(cls):
        cls._dir = tempfile.mkdtemp()
        cls._saved = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = Path(cls._dir)  # pictures are read from a temporary data directory, never the real one
        (workbench.images_dir()).mkdir(parents=True)
        (workbench.images_dir() / DAMAGED_PICTURE).write_bytes(b"\x89PNG\r\n\x1a\nnot really a picture")

    @classmethod
    def tearDownClass(cls):
        workbench.WORKBENCH_DIR = cls._saved
        shutil.rmtree(cls._dir, ignore_errors=True)

    def test_health_report_carries_findings_without_values(self):
        """Through jev.health.analyze, findings land under "lab" with their codes, and name no label or input value."""
        rows = ([C(i, "email", {"team": "billing"}) for i in range(1, 6)]
                + [C(i, "chat", {"team": "billing" if i % 2 else "shipping"}) for i in range(6, 11)]
                + [C(11, "phone", {"team": "product"}, test=True), C(12, "phone", {"urgent": True}, test=True)])
        saved = lab._PACKS
        lab._PACKS = [health_evaluation.PACK]  # this pack alone, whatever else jev/lab/packs holds
        try:
            report = health.analyze(rows, {"team": TEAM, "urgent": ON_MESSAGE})
        finally:
            lab._PACKS = saved
        codes = {item["code"] for item in report["lab"]}
        self.assertTrue({"health-evaluation/slice_single_answer", "health-evaluation/slice_only_held_out",
                         "health-evaluation/held_out_question_too_few"} <= codes, codes)
        text = json.dumps(report["lab"])
        for value in ("billing", "shipping", "product", "email", "chat", "phone", "Harbor note"):
            self.assertNotIn(value, text)

    def test_split_too_small_is_left_to_health_labels(self):
        """With fewer than 2 labeled held-out rows in all, health-labels' split_side_too_small speaks; this pack's
        per-question and per-slice held-out checks stay quiet."""
        rows = labeled([True, False, True]) + [R(4, {"urgent": True}, test=True), R(5, test=True)]
        self.assertEqual(health_evaluation.held_out_question_too_few(rows, {"urgent": NOUL}), [])
        sliced = [C(1, "email", {"urgent": True}), C(2, "email", {"urgent": False}), C(3, "chat", {"urgent": True}),
                  C(4, "chat", {"urgent": False}), C(5, "email", {"urgent": True}, test=True), C(6, "email", test=True)]
        self.assertEqual(health_evaluation.slice_missing_from_held_out(sliced, {"urgent": ON_MESSAGE}), [])

    def test_unlabeled_held_out_rows_do_not_count_as_scored(self):
        """An unlabeled held-out row is never scored: a slice value only it carries is not 'only held out'."""
        rows = [C(1, "email", {"urgent": True}), C(2, "email", {"urgent": False}), C(3, "chat", {"urgent": True}),
                C(4, "chat", {"urgent": False}), C(5, "email", {"urgent": True}, test=True), C(6, "phone", test=True)]
        self.assertEqual(health_evaluation.slice_only_held_out(rows, {"urgent": ON_MESSAGE}), [])

    def test_answer_set_folds_follow_duplicate_groups(self):
        """Copies of one input share a fold: 24 labels with 8 copies of one input put 8 rows in one fold, so its
        training side has 16 rows, short of the 19 a 95% set needs (but over the 9 for 90%)."""
        rows = ([R(i, {"urgent": True}, text="Harbor copied ticket") for i in range(1, 9)]
                + labeled([False] * 16, start=9))
        found = health_evaluation.answer_set_folds_short(rows, {"urgent": NOUL})
        self.assertEqual(len(found), 1)
        self.assertIn("has 16 rows, too few for an answer set to promise 95% (19 rows),", found[0]["message"])

    def test_text_rows_are_not_slices(self):
        """A field whose every value names one row, like the text of text rows, is not a slice field."""
        rows = labeled([True, False] * 6)
        for ident in ("slice_too_few_labels", "slice_single_answer"):
            check = next(f["check"] for f in health_evaluation.PACK["features"] if f["id"] == ident)
            self.assertEqual(check(rows, {"urgent": NOUL}), [])

    def test_held_out_rows_are_never_described_by_answers(self):
        """A held-out row's label value never changes a finding's text: the same counts give the same messages."""
        base = labeled([True, False, True]) + [R(4, {"urgent": True}, test=True), R(5, {"urgent": True}, test=True)]
        other = labeled([True, False, True]) + [R(4, {"urgent": False}, test=True), R(5, {"urgent": False}, test=True)]
        for feature in health_evaluation.PACK["features"]:
            self.assertEqual(feature["check"](base, {"urgent": NOUL}), feature["check"](other, {"urgent": NOUL}), feature["id"])


if __name__ == "__main__":
    unittest.main()
