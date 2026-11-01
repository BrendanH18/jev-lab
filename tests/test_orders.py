"""Order averaging asks each row twice, the second time with the Choice options reversed, and averages."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import calibrate, compare, orders, workbench  # noqa: E402
from jev.client import JevError  # noqa: E402

DEPT = {"type": "choice", "instructions": "Which team?",
        "criteria": {"billing": "Money", "shipping": "Parcels", "other": "Anything else"}}
REVERSED = dict(DEPT, criteria=dict(reversed(list(DEPT["criteria"].items()))))
URGENT = {"type": "noul", "instructions": "Urgent?"}
SIZE = {"type": "score", "instructions": "How big?", "criteria": ["small", "medium", "large"]}
ONE = {"type": "choice", "instructions": "Language?", "criteria": {"en": "English"}}
Q = {"dept": DEPT, "urgent": URGENT}


def choice(probs, confidence=0.9):
    return {"type": "choice", "choice": max(probs, key=probs.get), "probabilities": probs, "confidence": confidence}


def first_listed(state, questions):
    """A model that only reads the list: it always picks the first option it is offered."""
    return {"dept": list(questions["dept"]["criteria"])[0]}


class ReverseTests(unittest.TestCase):
    def test_reverses_only_choice_questions_with_two_or_more_options(self):
        questions = {"dept": DEPT, "urgent": URGENT, "size": SIZE, "lang": ONE}
        out = orders.reverse_options(questions)
        self.assertEqual(list(out), ["dept", "urgent", "size", "lang"])
        self.assertEqual(list(out["dept"]["criteria"]), ["other", "shipping", "billing"])
        self.assertEqual(out["dept"]["instructions"], DEPT["instructions"])
        self.assertEqual((out["urgent"], out["size"], out["lang"]), (URGENT, SIZE, ONE))  # a Score scale keeps its order
        self.assertEqual(list(DEPT["criteria"]), ["billing", "shipping", "other"])  # the input is untouched
        self.assertEqual(orders.averaged_ids(questions), ["dept"])
        self.assertIsNone(orders.reverse_options({"urgent": URGENT, "size": SIZE, "lang": ONE}))
        # Whole-number option names keep the order given in Python, so they reverse too.
        numbered = {"type": "choice", "instructions": "Floor?", "criteria": {"1": "First", "2": "Second"}}
        self.assertEqual(list(orders.reverse_options({"floor": numbered})["floor"]["criteria"]), ["2", "1"])


class AverageTests(unittest.TestCase):
    def test_averages_each_option_and_recomputes_the_pick_and_confidence(self):
        first = {"dept": choice({"billing": 0.6, "shipping": 0.3, "other": 0.1}), "urgent": {"type": "noul", "noul": 0.8}}
        second = {"dept": choice({"other": 0.1, "shipping": 0.7, "billing": 0.2}), "urgent": {"type": "noul", "noul": 0.1}}
        answers, picks = orders.average(first, second, Q)
        dept = answers["dept"]
        self.assertEqual(dept["choice"], "shipping")
        self.assertEqual(list(dept["probabilities"]), ["billing", "shipping", "other"])  # in the order as written
        self.assertAlmostEqual(dept["probabilities"]["shipping"], 0.5)
        self.assertAlmostEqual(dept["confidence"], calibrate._choice_formula(dept["probabilities"]))
        self.assertEqual(answers["urgent"], first["urgent"])  # a Noul keeps the answer from the options as written
        self.assertEqual(picks, {"dept": ["billing", "shipping"]})
        self.assertEqual(first["dept"]["choice"], "billing")  # the inputs are untouched

    def test_a_tie_goes_to_the_option_listed_first(self):
        first = {"dept": choice({"billing": 0.9, "shipping": 0.05, "other": 0.05})}
        second = {"dept": choice({"other": 0.9, "shipping": 0.05, "billing": 0.05})}
        answers, _ = orders.average(first, second, {"dept": DEPT})
        self.assertEqual(answers["dept"]["choice"], "billing")
        self.assertAlmostEqual(answers["dept"]["confidence"], (0.475 - 1 / 3) / (2 / 3))

    def test_an_unreadable_answer_in_either_order_leaves_the_question_out(self):
        good = choice({"billing": 0.6, "shipping": 0.3, "other": 0.1})
        for bad in (None, {"type": "noul", "noul": 0.5}, choice({"billing": 0.6, "shipping": 0.4}),
                    dict(good, probabilities={"billing": 2, "shipping": 0, "other": 0}), dict(good, choice="refund")):
            with self.subTest(bad=bad):
                answers, picks = orders.average({"dept": good, "urgent": {"type": "noul", "noul": 0.2}}, {"dept": bad}, Q)
                self.assertNotIn("dept", answers)
                self.assertEqual((picks, answers["urgent"]["noul"]), ({}, 0.2))

    def test_meta_adds_cost_and_tokens_and_keeps_the_slower_latency(self):
        meta = orders.combine_meta([{"model": "m", "latency_ms": 30.0, "input_tokens": 100, "output_tokens": 2, "cost_usd": 0.01},
                                    {"model": "m", "latency_ms": 50.0, "input_tokens": 120, "output_tokens": 3, "cost_usd": 0.02}])
        self.assertEqual((meta["model"], meta["latency_ms"], meta["input_tokens"], meta["output_tokens"], meta["calls"]),
                         ("m", 50.0, 220, 5, 2))
        self.assertAlmostEqual(meta["cost_usd"], 0.03)


class RunCompareTests(unittest.TestCase):
    def test_b_asks_each_row_in_both_orders_and_averages_away_a_position_bias(self):
        client = FakeClient(first_listed)
        rows = [{"text": "refund my card", "_expect": {"dept": "billing"}}, "where is my parcel"]
        report = workbench.run_compare(client, rows, [{"questions": Q}, {"questions": Q, "average_orders": True}])
        self.assertEqual(len(client.calls), 6)  # one call per row for A, two for B
        self.assertEqual(sorted(list(q["dept"]["criteria"])[0] for _, q in client.calls), ["billing"] * 4 + ["other"] * 2)
        a, b = report["variants"]
        self.assertEqual((a["average_orders"], b["average_orders"]), (False, True))
        self.assertIsNone(a["orders"])
        self.assertEqual(b["orders"], [{"qid": "dept", "answered": 2, "changed": 2, "rate": 1.0,
                                        "low": calibrate.wilson(2, 2)[0], "high": 1.0}])
        self.assertEqual((a["completed"], b["completed"]), (2, 2))
        self.assertAlmostEqual(b["cost_usd"], 2 * a["cost_usd"])
        self.assertEqual(b["input_tokens"], 2 * a["input_tokens"])
        self.assertAlmostEqual(report["cost_usd"], 3 * a["cost_usd"])
        run_a, run_b = report["results"][0]["runs"]
        self.assertNotIn("orders", run_a)
        self.assertEqual(run_b["orders"], {"dept": ["billing", "other"]})
        self.assertEqual(run_b["meta"]["calls"], 2)
        # A says billing at 0.95; B sees the bias, splits billing and other, and its confidence drops.
        self.assertEqual(run_a["answers"]["dept"]["choice"], "billing")
        self.assertAlmostEqual(run_b["answers"]["dept"]["probabilities"]["other"], 0.4875)
        self.assertLess(run_b["answers"]["dept"]["confidence"], 0.3)
        # Compare scores the averaged answers like any other.
        scored = compare.evaluate([{"index": r["index"], "label": (r.get("expect") or {}).get("dept"),
                                    "answers": [x["answers"]["dept"] for x in r["runs"]]} for r in report["results"]])
        self.assertEqual([v["labeled"] for v in scored["variants"]], [1, 1])

    def test_agreement_is_never_an_order_or_input_check_when_only_one_variant_averages(self):
        reversed_a = workbench.run_compare(FakeClient(first_listed), ["a"],
                                           [{"questions": {"dept": REVERSED}}, {"questions": {"dept": DEPT}, "average_orders": True}])
        self.assertFalse(reversed_a["agreement"][0]["reordered"])
        rows = workbench.run_compare(FakeClient(first_listed), ["Ship it"],
                                     [{"questions": Q}, {"questions": Q, "perturb": "lowercase", "average_orders": True}])
        self.assertEqual({a["perturbed"] for a in rows["agreement"]}, {False})
        self.assertEqual(rows["results"][0]["runs"][1]["input"], {"text": "ship it"})  # both calls were sent the rewrite
        both = workbench.run_compare(FakeClient(first_listed), ["a"],
                                     [{"questions": {"dept": DEPT}, "average_orders": True}, {"questions": {"dept": REVERSED}, "average_orders": True}])
        self.assertTrue(both["agreement"][0]["reordered"])

    def test_a_stop_between_the_two_calls_leaves_the_row_unanswered_but_counts_its_spend(self):
        class Budget(FakeClient):
            def system_one(self, state, questions, assets=None, model=None):
                if len(self.calls) >= 2:
                    raise JevError("budget", status=402)
                return super().system_one(state, questions, model=model)

        with patch.object(workbench, "BULK_CONCURRENCY", 1):
            report = workbench.run_compare(Budget(), ["a", "b"], [{"questions": Q}, {"questions": Q, "average_orders": True}])
        self.assertEqual(report["stopped"], "budget")
        first, second = report["results"]
        self.assertEqual(first["runs"][1]["error"], "budget")
        self.assertNotIn("answers", first["runs"][1])
        self.assertEqual(first["runs"][1]["meta"]["calls"], 1)
        self.assertEqual(second["runs"], [{"skipped": True}, {"skipped": True}])
        a, b = report["variants"]
        self.assertEqual((a["completed"], b["completed"], b["errors"]), (1, 0, 1))
        self.assertAlmostEqual(b["cost_usd"], a["cost_usd"])  # B's one answered call still cost money

    def test_validation(self):
        for variant, message in (({"questions": Q, "average_orders": "yes"}, "true or false"),
                                 ({"questions": {"urgent": URGENT, "lang": ONE}, "average_orders": True}, "Choice question")):
            with self.subTest(variant=variant), self.assertRaisesRegex(workbench.WorkbenchError, "Variant B: .*" + message):
                workbench.validate_variants([{"questions": Q}, variant])
        self.assertFalse(workbench.validate_variants([{"questions": Q}, {"questions": Q}])[1]["average_orders"])


if __name__ == "__main__":
    unittest.main()
