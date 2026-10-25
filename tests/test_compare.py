"""Compare runs two variants over the same rows and scores them side by side without more calls."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import compare, examples, workbench  # noqa: E402
from jev.calibrate import CalibrationError  # noqa: E402
from jev.client import JevError  # noqa: E402


def noul(p):
    return {"type": "noul", "noul": p}


def choice(pick, options=("billing", "shipping")):
    return {"type": "choice", "choice": pick, "probabilities": {o: (0.9 if o == pick else 0.1) for o in options},
            "confidence": 0.8}


def rows(*triples):
    return [{"index": i, "label": label, "answers": [a, b]} for i, (a, b, label) in enumerate(triples)]


class McNemarTests(unittest.TestCase):
    def test_exact_two_sided_p_values(self):
        self.assertEqual(compare.mcnemar(0, 0), 1.0)
        self.assertEqual(compare.mcnemar(3, 3), 1.0)
        self.assertAlmostEqual(compare.mcnemar(0, 5), 2 / 32)
        self.assertAlmostEqual(compare.mcnemar(9, 1), 2 * 11 / 1024)
        self.assertLess(compare.mcnemar(0, 400), 1e-100)  # large counts stay exact, without overflow


class EvaluateTests(unittest.TestCase):
    def setUp(self):
        self.report = compare.evaluate(rows(
            (noul(0.9), noul(0.8), "yes"),    # both right, agree
            (noul(0.9), noul(0.2), "yes"),    # only A right
            (noul(0.6), noul(0.3), "yes"),    # only A right
            (noul(0.4), noul(0.7), "yes"),    # only B right
            (noul(0.1), noul(0.9), "yes"),    # only B right
            (noul(0.2), noul(0.3), "yes"),    # both wrong, agree
            (noul(0.8), noul(0.1), None),     # unlabeled disagreement
            (noul(0.7), None, "yes"),         # B failed on this row: left out of both
        ))

    def test_both_variants_are_scored_on_the_rows_both_answered(self):
        a, b = self.report["variants"]
        self.assertEqual((a["labeled"], a["correct"], a["unlabeled"]), (6, 3, 1))
        self.assertEqual((b["labeled"], b["correct"], b["unlabeled"]), (6, 3, 1))
        self.assertEqual(len(a["sweep"]), 101)
        self.assertEqual((self.report["only_a"], self.report["only_b"], self.report["excluded"]), (1, 0, 0))

    def test_paired_counts_use_rows_both_scored(self):
        p = self.report["paired"]
        self.assertEqual((p["both_right"], p["a_only"], p["b_only"], p["both_wrong"], p["rows"]), (1, 2, 2, 1, 6))
        self.assertEqual(p["p_value"], 1.0)

    def test_disagreements_list_rows_with_different_answers(self):
        r = self.report
        self.assertEqual((r["answered_both"], r["agree"]), (7, 2))
        self.assertEqual([d["index"] for d in r["disagreements"]], [1, 2, 3, 4, 6])
        first = r["disagreements"][0]
        self.assertEqual((first["label"], first["verdict"]), ("yes", "a_only"))
        self.assertEqual([x["predicted"] for x in first["answers"]], ["yes", "no"])
        self.assertEqual([x["correct"] for x in first["answers"]], [True, False])
        self.assertAlmostEqual(first["answers"][1]["signal"], 0.6)
        unlabeled = r["disagreements"][-1]
        self.assertEqual((unlabeled["label"], unlabeled["verdict"]), (None, None))
        self.assertEqual([x["correct"] for x in unlabeled["answers"]], [None, None])

    def test_choice_options_may_differ_between_variants(self):
        report = compare.evaluate(rows(
            (choice("billing"), choice("billing", ("billing", "other")), "billing"),
            (choice("shipping"), choice("other", ("billing", "other")), "shipping"),
        ))
        a, b = report["variants"]
        # "shipping" is not one of B's options, so row 1's label is left out of both variants.
        self.assertEqual(b["invalid"][0]["index"], 1)
        self.assertEqual((a["labeled"], a["correct"], b["labeled"], b["correct"]), (1, 1, 1, 1))
        self.assertEqual((report["excluded"], report["paired"]["rows"]), (1, 1))
        self.assertEqual(report["disagreements"][0]["verdict"], None)

    def test_refusals(self):
        with self.assertRaises(CalibrationError):
            compare.evaluate(rows((noul(0.9), choice("billing"), "yes")))
        with self.assertRaises(CalibrationError):
            compare.evaluate(rows((noul(0.9), None, "yes")))
        with self.assertRaisesRegex(CalibrationError, "No row has answers from both"):
            compare.evaluate(rows((noul(0.9), None, "yes"), (None, noul(0.8), "yes")))
        with self.assertRaises(CalibrationError):
            compare.evaluate([{"index": 0, "answers": [noul(0.9)]}])
        with self.assertRaises(CalibrationError):
            compare.evaluate(rows((noul(0.9), noul(0.8), "yes")), signal="vibes")
        with self.assertRaises(CalibrationError):
            compare.evaluate("rows")


Q = {"urgent": {"type": "noul", "instructions": "Does this need attention today?"}}
TERSE = {"urgent": {"type": "noul", "instructions": "Urgent?"}}


class RunTests(unittest.TestCase):
    def test_runs_each_row_once_per_variant_with_its_model(self):
        client = FakeClient(lambda s, q: {"urgent": 0.9 if "today" in q["urgent"]["instructions"] else 0.1})
        report = workbench.run_compare(client, ["ship it", {"text": "now", "_expect": {"urgent": True}}],
                                       [{"questions": Q}, {"questions": TERSE, "model": " jev-preview "}])
        self.assertEqual(len(client.calls), 4)
        self.assertEqual(sorted(client.models, key=str), [None, None, "jev-preview", "jev-preview"])
        self.assertEqual([v["model"] for v in report["variants"]], ["jev-fake", "jev-preview"])
        self.assertEqual([v["completed"] for v in report["variants"]], [2, 2])
        self.assertEqual(report["labeled"], 1)
        second = report["results"][1]
        self.assertEqual((second["row"], second["expect"]), ({"text": "now"}, {"urgent": True}))
        self.assertEqual([run["answers"]["urgent"]["noul"] for run in second["runs"]], [0.9, 0.1])
        self.assertNotIn("_expect", client.calls[2][0])
        self.assertAlmostEqual(report["cost_usd"], sum(v["cost_usd"] for v in report["variants"]))
        self.assertEqual(report["variants"][0]["latency_ms_median"], 12.0)

    def test_a_budget_stop_leaves_both_variants_with_the_same_rows(self):
        class Budget(FakeClient):
            def system_one(self, state, questions, assets=None, model=None):
                if len(self.calls) >= 4:
                    raise JevError("budget", status=402)
                return super().system_one(state, questions, model=model)

        with patch.object(workbench, "BULK_CONCURRENCY", 1):
            report = workbench.run_compare(Budget(), ["a", "b", "c", "d"], [{"questions": Q}, {"questions": TERSE}])
        self.assertEqual(report["stopped"], "budget")
        self.assertEqual([v["completed"] for v in report["variants"]], [2, 2])
        self.assertEqual([v["errors"] for v in report["variants"]], [1, 0])
        self.assertEqual(report["results"][2]["runs"], [{"error": "budget"}, {"skipped": True}])
        self.assertEqual(report["results"][3]["runs"], [{"skipped": True}, {"skipped": True}])

    def test_a_stop_between_the_two_calls_of_a_row_leaves_it_out_of_scoring(self):
        class Budget(FakeClient):
            def system_one(self, state, questions, assets=None, model=None):
                if len(self.calls) >= 3:
                    raise JevError("budget", status=402)
                return super().system_one(state, questions, model=model)

        with patch.object(workbench, "BULK_CONCURRENCY", 1):
            run = workbench.run_compare(Budget(), [{"text": t, "_expect": {"urgent": True}} for t in "ab"],
                                        [{"questions": Q}, {"questions": TERSE}])
        self.assertEqual([v["completed"] for v in run["variants"]], [2, 1])
        report = compare.evaluate([{"index": r["index"], "label": r["expect"]["urgent"],
                                    "answers": [x.get("answers", {}).get("urgent") for x in r["runs"]]}
                                   for r in run["results"]])
        self.assertEqual((report["only_a"], report["variants"][0]["labeled"], report["variants"][1]["labeled"]), (1, 1, 1))

    def test_variant_validation(self):
        good = {"questions": Q}
        for variants in (None, [good], [good, good, good], [good, "x"], [good, {"questions": {}}],
                         [good, {"questions": Q, "model": 3}],
                         [good, {"questions": {"b": {"type": "box", "instructions": "x"}}}]):
            with self.subTest(variants=variants), self.assertRaises(workbench.WorkbenchError):
                workbench.run_compare(FakeClient(), ["row"], variants)
        with self.assertRaisesRegex(workbench.WorkbenchError, "Variant B"):
            workbench.validate_variants([good, {"questions": {}}])

    def test_sample_variants_share_question_ids_and_types(self):
        plain, terse = examples.BULK_QUESTIONS, examples.TERSE_BULK_QUESTIONS
        self.assertEqual({k: q["type"] for k, q in plain.items()}, {k: q["type"] for k, q in terse.items()})
        self.assertEqual(list(plain["department"]["criteria"]), list(terse["department"]["criteria"]))
        self.assertEqual(len(plain["frustration"]["criteria"]), len(terse["frustration"]["criteria"]))
        workbench.validate_variants([{"questions": plain}, {"questions": terse}])


if __name__ == "__main__":
    unittest.main()
