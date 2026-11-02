"""Consistency rules (jev/rules.py) and how Policy, Tune, cost, cross-validation, checks, and drift apply them."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import fake_answers  # noqa: E402
from jev import checks, cost, drift, holdout, policy, rules, workbench  # noqa: E402
from jev.calibrate import CalibrationError  # noqa: E402

Q = {
    "dept": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "a", "shipping": "b", "none": "c"}},
    "refund": {"type": "noul", "instructions": "Refund?"},
    "anger": {"type": "score", "instructions": "How angry?", "criteria": ["calm", "annoyed", "furious"]},
}
RULE = "if refund = yes then dept in billing, shipping"


def answers(dept="billing", refund=0.05, anger=0.0, confidence=0.9):
    out = fake_answers(Q, {"dept": dept, "refund": refund})
    out["dept"]["confidence"] = confidence
    out["anger"]["probabilities"] = {str(i): (0.8 if i == anger else 0.1) for i in range(3)}
    return out


def row(index, labels=None, **kw):
    return {"index": index, "answers": answers(**kw), "labels": labels or {}}


class ParseTests(unittest.TestCase):
    def test_parses_conditions_comments_and_case(self):
        parsed = rules.parse("# refunds go to money teams\n\n" + RULE + "\nIF anger >= 2 AND dept != none THEN refund = Yes")
        self.assertEqual([r["line"] for r in parsed], [3, 4])
        self.assertEqual(parsed[0]["if"], [("refund", "=", ["yes"])])
        self.assertEqual(parsed[0]["then"], [("dept", "in", ["billing", "shipping"])])
        self.assertEqual(parsed[1]["if"], [("anger", ">=", ["2"]), ("dept", "!=", ["none"])])
        self.assertEqual(rules.parse("if dept not in none, shipping then refund = no")[0]["if"],
                         [("dept", "not in", ["none", "shipping"])])
        self.assertEqual(rules.parse(""), [])

    def test_refuses_what_it_cannot_read(self):
        for text in ("dept = billing", "if dept billing then refund = no", "if dept in billing, then refund = no",
                     "x" * (rules.MAX_CHARS + 1), "\n".join([RULE] * (rules.MAX_RULES + 1)), 42):
            with self.subTest(text=str(text)[:40]), self.assertRaises(CalibrationError):
                rules.parse(text)

    def test_check_names_unknown_questions_and_answers(self):
        kinds = rules.kinds_from_questions(Q)
        rules.check(rules.parse(RULE + "\nif anger > 1 then refund = TRUE"), kinds)
        for text in ("if team = billing then refund = no", "if dept = refunds then refund = no",
                     "if refund = maybe then dept = none", "if dept >= 1 then refund = no", "if anger = 3 then refund = no"):
            with self.subTest(text=text), self.assertRaises(CalibrationError):
                rules.check(rules.parse(text), kinds)

    def test_yes_no_aliases_apply_to_noul_questions_only(self):
        kinds = {"flag": ("choice", ["yes", "true", "no"]), "refund": ("noul", ["yes", "no"]), "dept": ("choice", ["billing", "none"])}
        choice_rule = rules.parse("if flag != true then dept = billing")
        rules.check(choice_rule, kinds)
        self.assertTrue(rules.broken(choice_rule[0], {"flag": "yes", "dept": "none"}), "a Choice option `true` is not `yes`")
        noul_rule = rules.parse("if refund = TRUE then dept = billing")
        rules.check(noul_rule, kinds)
        self.assertEqual(noul_rule[0]["if"], [("refund", "=", ["yes"])])

    def test_broken_needs_every_if_and_a_failed_then(self):
        rule = rules.parse(RULE)[0]
        self.assertTrue(rules.broken(rule, {"refund": "yes", "dept": "none"}))
        self.assertFalse(rules.broken(rule, {"refund": "yes", "dept": "billing"}))
        self.assertFalse(rules.broken(rule, {"refund": "no", "dept": "none"}))
        self.assertFalse(rules.broken(rule, {"refund": "no"}), "an if that fails decides it, missing answers or not")
        self.assertIsNone(rules.broken(rule, {"refund": "yes"}))
        self.assertIsNone(rules.broken(rule, {"dept": "none"}))


class ReportTests(unittest.TestCase):
    def test_counts_broken_rows_and_weighs_them_against_labels(self):
        rows = [
            # Applies and breaks it: the department answer is wrong on both labeled rows.
            row(0, {"dept": "billing", "refund": True}, dept="none", refund=0.9),
            row(1, {"dept": "shipping", "refund": True}, dept="none", refund=0.9),
            row(2, dept="none", refund=0.9),  # breaks it, unlabeled
            # Applies and keeps it: right on one, wrong on the other.
            row(3, {"dept": "billing", "refund": True}, dept="billing", refund=0.9),
            row(4, {"dept": "billing", "refund": False}, dept="shipping", refund=0.9),
            row(5, {"dept": "none", "refund": False}, dept="none"),  # does not apply
            # The labels themselves break the rule: a refund for the team that does nothing.
            row(6, {"dept": "none", "refund": True}, dept="billing", refund=0.9),
        ]
        rep = rules.report(RULE, rows, Q)
        (r,) = rep["rules"]
        self.assertEqual((r["applies"], r["broken"], r["kept"], r["unknown"]), (6, 3, 3, 0))
        self.assertEqual(r["broken_rows"], [0, 1, 2])
        self.assertEqual((r["labeled_broken"], r["wrong_broken"], r["labeled_kept"], r["wrong_kept"]), (2, 2, 3, 2))
        self.assertEqual(r["labels_break"], [6])
        # The labels break the rule even where the answers do not apply it: no refund answered, a refund labeled.
        quiet = row(7, {"dept": "none", "refund": True}, dept="none")
        self.assertEqual(rules.report(RULE, rows + [quiet], Q)["rules"][0]["labels_break"], [6, 7])
        self.assertEqual(r["p"], drift.fisher_exact(2, 0, 2, 1))
        self.assertEqual((rep["broken_any"], rep["broken_rows"]), (3, [0, 1, 2]))

    def test_unknown_rows_and_answers_as_the_questions(self):
        rows = [{"index": 0, "answers": {"refund": answers(refund=0.9)["refund"]}}, row(1)]
        (r,) = rules.report(RULE, rows)["rules"]  # no question set: the answers' own options check the rule
        self.assertEqual((r["unknown"], r["applies"]), (1, 0))  # row 1 says no refund, so the rule does not apply
        with self.assertRaises(CalibrationError):
            rules.report("if dept = refunds then refund = no", rows, Q)


class PolicyTests(unittest.TestCase):
    """Two rows break the rule: confident and labeled, they would otherwise be automated."""

    def setUp(self):
        self.rows = ([row(i, {"dept": "billing", "refund": False}) for i in range(8)]
                     + [row(8, {"dept": "billing", "refund": True}, dept="none", refund=0.9),
                        row(9, {"dept": "none", "refund": True}, dept="none", refund=0.9)])

    def test_evaluate_holds_rows_that_break_a_rule(self):
        gates = {"dept": 0.5}
        plain = policy.evaluate(self.rows, gates)
        held = policy.evaluate(self.rows, gates, rules=RULE)
        self.assertEqual((plain["automated"], plain["correct"]), (10, 9))
        self.assertEqual((held["automated"], held["correct"], held["labeled"]), (8, 8, 10))
        self.assertEqual((held["held_by_rules"], held["routed_held_by_rules"], held["rules"]), (2, 2, [RULE]))
        self.assertEqual([r["rules"] for r in held["rows"]][-2:], [[1], [1]])
        self.assertEqual(held["questions"][0]["holds"], 0, "a rule's hold is not the threshold's")
        self.assertAlmostEqual(held["coverage"], 0.8)
        with self.assertRaises(CalibrationError):
            policy.evaluate(self.rows, gates, rules="if dept = refunds then refund = no")

    def test_tune_cost_and_holdout_count_held_rows_as_reviewed(self):
        tuned = {t["target"]: t for t in policy.tune(self.rows, ["dept"], rules=RULE)["targets"]}
        self.assertEqual((tuned[0.99]["automated"], tuned[0.99]["coverage"], tuned[0.99]["gates"]), (8, 0.8, {"dept": 0.0}))
        costs = {"review": 1.0, "error": 10.0}
        rep = cost.evaluate(self.rows, ["dept"], costs=costs, gates={"dept": 0.0}, rules=RULE)
        self.assertEqual(rep["labeled"], 10)
        self.assertEqual((rep["current"]["automated"], rep["current"]["review"], rep["current"]["cost"]), (8, 2, 2.0))
        self.assertEqual(rep["automate_all"]["cost"], 2.0, "rows a rule holds are reviewed even when automating the rest")
        cv = holdout.evaluate(self.rows, ["dept"], folds=2, costs=costs, rules=RULE)
        self.assertEqual(cv["labeled"], 10)
        self.assertEqual(sum(p["rows"] for p in cv["targets"][0]["parts"]), 10)
        self.assertEqual(cv["targets"][0]["unseen"]["automated"], 8)
        self.assertEqual(sum(p["rows"] for p in cv["cost"]["parts"]), 10)
        self.assertEqual(cv["cost"]["unseen"]["review"], 2)

    def test_drift_routes_with_the_rules(self):
        read = [{"index": 0, "row": None, "read": {"dept": ("none", 0.9), "refund": ("yes", 0.8)}},
                {"index": 1, "row": None, "read": {"dept": ("billing", 0.9), "refund": ("yes", 0.8)}}]
        routed, auto = drift._route(read, {"dept": 0.5}, rules.parse(RULE))
        self.assertEqual((len(routed), [r["index"] for r in auto]), (2, [1]))


class CheckTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        patcher = patch.object(workbench, "WORKBENCH_DIR", Path(tmp))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_check_keeps_its_rules_and_applies_them(self):
        spec = {"gates": {"dept": 0.5}, "model": "jev-1.14.0", "min_accuracy": 0.9, "min_coverage": 0.5,
                "rules": "# money\n" + RULE + "\n"}
        saved = checks.validate_check(spec, Q)
        self.assertEqual(saved["rules"], RULE)
        self.assertNotIn("rules", checks.validate_check(dict(spec, rules=""), Q))
        with self.assertRaises(workbench.WorkbenchError):
            checks.validate_check(dict(spec, rules="if dept = refunds then refund = no"), Q)
        results = [{"index": 0, "answers": answers(), "expect": {"dept": "billing"}},
                   {"index": 1, "answers": answers(dept="none", refund=0.9), "expect": {"dept": "billing"}}]
        rep = checks.evaluate(results, saved)
        self.assertEqual((rep["automated"], rep["correct"], rep["labeled"]), (1, 1, 2))
        self.assertEqual(rep["status"], "pass")
        self.assertEqual(checks.evaluate(results, checks.validate_check(dict(spec, rules=None), Q))["status"], "fail")


class RouteTests(unittest.TestCase):
    def test_rules_route_and_policy_routes_take_rules(self):
        import server

        self.assertIs(server.ROUTES[("POST", "/api/workbench/rules")], server.api_wb_rules)
        rows = [row(0, dept="none", refund=0.9), row(1)]
        self.assertEqual(server.api_wb_rules({"rules": RULE, "rows": rows, "questions": Q})["broken_rows"], [0])
        rep = server.api_wb_policy({"rows": rows, "gates": {"dept": 0.0}, "rules": RULE})
        self.assertEqual((rep["routed_automated"], rep["routed_held_by_rules"]), (1, 1))


if __name__ == "__main__":
    unittest.main()
