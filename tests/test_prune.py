"""Prune retunes a Policy gate without each question, over answers Bulk already returned; these tests pin it."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import prune  # noqa: E402
from jev.calibrate import CalibrationError  # noqa: E402
from jev.workbench import WorkbenchError  # noqa: E402


def dept(pick, confidence):
    probs = {o: (0.8 if o == pick else 0.1) for o in ("billing", "shipping", "none")}
    return {"type": "choice", "choice": pick, "probabilities": probs, "confidence": confidence}


def rows(n=20):
    """dept is sure and right on rows 0-13, unsure and wrong on 14-19. refund is always right, and its signal (0.8 on
    even rows, 0.6 on odd ones) says nothing about which dept answers are wrong."""
    out = []
    for i in range(n):
        sure = i < 14
        p = 0.9 if i % 2 == 0 else 0.2
        out.append({"index": i,
                    "answers": {"dept": dept("billing", 0.95 if sure else 0.4), "refund": {"type": "noul", "noul": p}},
                    "labels": {"dept": "billing" if sure else "shipping", "refund": p > 0.5}})
    return out


REQUEST = {
    "dept": {"type": "choice", "instructions": "Which team handles this?",
             "criteria": {"billing": "Charges and refunds", "shipping": "Deliveries", "none": "Neither"}},
    "refund": {"type": "noul", "instructions": "Does the customer ask for money back?"},
    "tone": {"type": "score", "instructions": "How upset is the customer?",
             "criteria": ["Calm", "Annoyed", "Angry"]},
}


class PruneTests(unittest.TestCase):
    def test_a_threshold_that_holds_nothing_back_and_one_the_gate_needs(self):
        r = prune.prune(rows(), ["dept", "refund"], target=0.95)
        self.assertEqual((r["labeled"], r["target"]), (20, 0.95))
        base = r["baseline"]
        self.assertEqual((base["automated"], base["accuracy"]), (14, 1.0))
        by = {g["qid"]: g for g in r["gated"]}
        # refund's threshold holds nothing back: at 0 the gate automates the same 14 rows.
        self.assertEqual(by["refund"]["off"]["automated"], 14)
        self.assertEqual(by["refund"]["off"]["gates"]["refund"], 0.0)
        self.assertEqual(list(by["refund"]["off"]["gates"]), ["dept", "refund"])
        # dept's threshold is what keeps its wrong answers out: refund's signal cannot separate them, so no gate
        # without it reaches 95% while dept's answers still count.
        self.assertIsNone(by["dept"]["off"]["gates"])
        self.assertEqual(by["dept"]["off"]["automated"], 0)
        # Dropping dept stops scoring it: every refund answer is right, so every row is automated.
        self.assertEqual((by["dept"]["dropped"]["automated"], by["dept"]["dropped"]["accuracy"]), (20, 1.0))
        self.assertEqual(list(by["dept"]["dropped"]["gates"]), ["refund"])
        self.assertEqual(by["refund"]["dropped"]["automated"], 14)
        self.assertEqual((r["unused"], r["chars"]), ([], None))
        self.assertIsNone(by["dept"]["share"])

    def test_the_only_gated_question_has_no_dropped_variant(self):
        r = prune.prune(rows(), ["refund"], target=0.9)
        g = r["gated"][0]
        self.assertIsNone(g["dropped"])
        # With refund's threshold at 0 every row is automated, and every refund answer is right.
        self.assertEqual((g["off"]["automated"], g["off"]["gates"]), (20, {"refund": 0.0}))

    def test_dropping_a_question_scores_rows_that_lacked_only_its_label(self):
        data = rows()
        del data[0]["labels"]["refund"]
        r = prune.prune(data, ["dept", "refund"])
        by = {g["qid"]: g for g in r["gated"]}
        self.assertEqual(r["labeled"], 19)
        self.assertEqual(by["refund"]["off"]["labeled"], 19)
        self.assertEqual(by["refund"]["dropped"]["labeled"], 20)

    def test_unused_questions_and_each_share_of_the_question_text(self):
        r = prune.prune(rows(), ["dept", "refund"], request=REQUEST)
        self.assertEqual([u["qid"] for u in r["unused"]], ["tone"])
        self.assertEqual(r["unused"][0]["type"], "score")
        shares = [g["share"] for g in r["gated"]] + [u["share"] for u in r["unused"]]
        self.assertAlmostEqual(sum(shares), 1.0)
        self.assertEqual(r["chars"], sum(len(json.dumps({q: v}, ensure_ascii=False)) for q, v in REQUEST.items()))
        self.assertGreater(r["gated"][0]["share"], r["gated"][1]["share"])  # dept's criteria make it the longest

    def test_a_question_a_rule_reads_is_not_unused(self):
        data = rows()
        for row in data:
            row["answers"]["tone"] = {"type": "score", "score": 0, "probabilities": {"0": 0.7, "1": 0.2, "2": 0.1}}
        rule = "if tone >= 2 then refund = yes"
        r = prune.prune(data, ["dept", "refund"], rules=rule, request=REQUEST)
        self.assertEqual(r["unused"], [])
        by = {g["qid"]: g for g in r["gated"]}
        self.assertEqual(by["refund"]["rules"], [rule])
        self.assertEqual(by["dept"]["rules"], [])

    def test_bad_inputs(self):
        with self.assertRaises(CalibrationError):
            prune.prune(rows(), ["dept"], target=0.8)
        with self.assertRaises(CalibrationError):
            prune.prune(rows(), ["dept"], target=True)
        with self.assertRaises(CalibrationError):
            prune.prune(rows(), ["dept"], bound="upper")
        with self.assertRaises(CalibrationError):
            prune.prune(rows(), [])
        with self.assertRaises(WorkbenchError):
            prune.prune(rows(), ["dept"], request={"dept": "not a question"})


if __name__ == "__main__":
    unittest.main()
