"""Question checks (jev/lint.py): each rule on a small request, the API route, and every built-in request.

The checks are plain code, so these tests need no key and no network. The last test sends every demo's
request through the real JevClient with the network stubbed, the way tests/test_handoff.py does, and
requires that none of them, and none of the examples, has a problem: a backticked path the state lacks,
two questions that ask the same thing, or options the model cannot tell apart.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402
from helpers import fake_answers  # noqa: E402
from jev import examples, lint, workbench  # noqa: E402
from jev.client import SpendGuard, choice, noul, score  # noqa: E402
from jev.scenarios import INBOX  # noqa: E402

DESCRIBED = noul("Is it urgent?", yes="A deadline today", no="No deadline")


def codes(state, questions, refs=()):
    return [(f["code"], f["question"]) for f in lint.check(state, questions, refs)["findings"]]


class PathTests(unittest.TestCase):
    def test_a_path_the_state_has_passes(self):
        state = {"ticket": {"from": "maya@harbor.example", "lines": ["Hi", "My bag tore"]}, "a.b": 1}
        for path in ("ticket", "ticket.from", "ticket.lines[1]", "ticket.lines.0", "a.b"):
            with self.subTest(path=path):
                q = {"x": noul("Does `%s` mention a refund?" % path, yes="Yes", no="No")}
                self.assertEqual(codes(state, q), [])

    def test_a_path_the_state_lacks_is_a_problem(self):
        state = {"ticket": {"from": "maya@harbor.example", "lines": ["Hi"]}}
        for path in ("email", "ticket.subject", "ticket.lines[3]", "ticket.from.name"):
            with self.subTest(path=path):
                q = {"x": noul("Does `%s` mention a refund?" % path, yes="Yes", no="No")}
                (finding,) = lint.check(state, q)["findings"]
                self.assertEqual((finding["level"], finding["code"], finding["question"]), ("problem", "missing_path", "x"))
                self.assertIn("`%s`" % path, finding["message"])
                self.assertTrue(finding["guide"].startswith(lint.GUIDE + "#"))

    def test_paths_in_criteria_and_structured_instructions_count(self):
        q = {"x": choice({"question": "Which team owns `ticket`?", "context": "See `notes`"},
                         {"a": "Mentions `sku`", "b": "Anything else"})}
        self.assertEqual(codes({"ticket": "Hi"}, q),
                         [("missing_path", "x"), ("missing_path", "x")])

    def test_a_text_state_has_no_fields(self):
        (finding,) = lint.check("My order arrived damaged.", {"x": noul("Is `message` angry?", yes="Y", no="N")})["findings"]
        self.assertEqual(finding["code"], "missing_path")
        self.assertIn("the state is text", finding["message"])

    def test_picture_references_and_code_in_backticks_are_not_paths(self):
        q = {"x": noul("Is the bag in `photo-3fa9c1d2e7` torn? Compare with `datetime(year, month, day)`.", yes="Y", no="N")}
        self.assertEqual(codes({"note": "torn"}, q, ["photo-3fa9c1d2e7"]), [])


class InstructionTests(unittest.TestCase):
    def test_two_questions_in_one_is_advice(self):
        q = {"x": noul("Is the customer angry? Do they want a refund?", yes="Y", no="N")}
        self.assertEqual(codes("hi", q), [("several_questions", "x")])

    def test_question_marks_in_quoted_data_do_not_count(self):
        state = {"document": "L000 We roast on Mondays."}
        for text in ("Does any line of `document` answer: “When do we roast?”?",
                     "Does `document` say 'Where is my order? Can I get a refund?'?",
                     "Does `document` say ‘Where is it?’?", "Doesn't `document` say when we roast?"):
            with self.subTest(text=text):
                self.assertEqual(codes(state, {"x": noul(text, yes="Y", no="N")}), [])

    def test_long_instructions_are_advice(self):
        q = {"x": noul(" ".join(["word"] * (lint.LONG_WORDS + 1)) + "?", yes="Y", no="N")}
        self.assertEqual(codes("hi", q), [("long_instructions", "x")])
        q = {"x": noul(" ".join(["word"] * lint.LONG_WORDS) + "?", yes="Y", no="N")}
        self.assertEqual(codes("hi", q), [])

    def test_the_same_question_twice_is_a_problem(self):
        q = {"a": DESCRIBED, "b": noul("is it URGENT ?", yes="a deadline today.", no="No deadline"), "c": noul("Is it late?", yes="Y", no="N")}
        findings = lint.check("hi", q)["findings"]
        self.assertEqual([(f["code"], f["question"]) for f in findings], [("same_question", "a")])
        self.assertIn("`a` and `b`", findings[0]["message"])

    def test_structured_criteria_differing_in_a_field_or_number_are_not_duplicates(self):
        q = {"a": noul("Is it urgent?", yes="Due today", no="No deadline"),
             "b": noul("Is it urgent?", yes="No deadline", no="Due today")}
        self.assertEqual(codes("hi", q), [])
        q = {"x": choice("How much?", {"small": {"max": 10}, "large": {"max": 100}})}
        self.assertEqual(codes("hi", q), [])
        q = {"x": choice("Which?", {"a": {"covers": "Charges"}, "b": {"about": "Charges"}})}
        self.assertEqual(codes("hi", q), [("mixed_option_fields", "x")])

    def test_signs_and_operators_keep_descriptions_apart(self):
        q = {"x": choice("How large is the order?", {"small": "Amount < 100", "large": "Amount > 100"})}
        self.assertEqual(codes("hi", q), [])
        q = {"x": score("How cold?", ["Temperature: -10 C", "Temperature: 10 C"])}
        self.assertEqual(codes("hi", q), [])

    def test_the_same_fields_in_another_order_are_the_same_description(self):
        q = {"x": choice("Which team?", {"billing": {"covers": "Charges", "excludes": "Refunds"},
                                         "refunds": {"excludes": "Refunds", "covers": "Charges"}})}
        self.assertEqual(codes("hi", q), [("same_options", "x")])

    def test_the_same_wording_with_different_criteria_is_not_a_duplicate(self):
        q = {"a": choice("Which team?", {"billing": "Charges", "shipping": "Parcels"}),
             "b": choice("Which team?", {"sales": "Pricing", "support": "Bugs"})}
        self.assertEqual(codes("hi", q), [])


class CriteriaTests(unittest.TestCase):
    def test_choice_options_with_the_same_description_are_a_problem(self):
        q = {"x": choice("Which team?", {"billing": "Money issues", "refunds": "money issues.", "other": "Anything else"})}
        findings = lint.check("hi", q)["findings"]
        self.assertEqual([(f["level"], f["code"]) for f in findings], [("problem", "same_options")])
        self.assertIn("`billing` and `refunds`", findings[0]["message"])

    def test_an_undescribed_option_beside_described_ones_is_advice(self):
        q = {"x": choice("Which team?", {"billing": "Charges", "shipping": None, "other": ""})}
        findings = lint.check("hi", q)["findings"]
        self.assertEqual([f["code"] for f in findings], ["undescribed_option"])
        self.assertIn("`shipping` and `other` have", findings[0]["message"])

    def test_options_that_all_go_undescribed_are_fine(self):
        q = {"x": choice("Which weekday?", {"monday": None, "tuesday": None})}
        self.assertEqual(codes("hi", q), [])

    def test_options_described_with_different_fields_are_advice(self):
        q = {"x": choice("Which team?", {"billing": {"covers": "Charges", "not_for": "Parcels"},
                                         "shipping": {"covers": "Parcels"}})}
        self.assertEqual(codes("hi", q), [("mixed_option_fields", "x")])
        q = {"x": choice("Which team?", {"billing": {"covers": "Charges"}, "shipping": "Parcels"})}
        self.assertEqual(codes("hi", q), [("mixed_option_fields", "x")])
        q = {"x": choice("Which team?", {"billing": {"covers": "Charges"}, "shipping": {"covers": "Parcels"}})}
        self.assertEqual(codes("hi", q), [])

    def test_repeated_score_levels_are_a_problem(self):
        q = {"x": score("How upset?", ["Calm", "Annoyed", "calm"])}
        findings = lint.check("hi", q)["findings"]
        self.assertEqual([f["code"] for f in findings], ["same_levels"])
        self.assertIn("level 0 and level 2", findings[0]["message"])

    def test_a_noul_needs_both_criteria(self):
        for q in (noul("Is it urgent?"), noul("Is it urgent?", yes="A deadline today")):
            with self.subTest(q=q):
                self.assertEqual(codes("hi", {"x": q}), [("noul_criteria", "x")])
        self.assertEqual(codes("hi", {"x": DESCRIBED}), [])


class StateTests(unittest.TestCase):
    def test_key_value_lines_in_a_text_state_are_advice(self):
        text = "From: maya@harbor.example\nSubject: Damaged order\n\nMy bag tore."
        self.assertEqual(codes(text, {"x": DESCRIBED}), [("fields_in_text", None)])
        self.assertEqual(codes("Order: A-1041 arrived damaged.", {"x": DESCRIBED}), [])
        self.assertEqual(codes({"text": text}, {"x": DESCRIBED}), [])


class ReportTests(unittest.TestCase):
    def test_problems_come_first_then_questions_in_order(self):
        q = {"a": noul("Is it urgent?"), "b": noul("Does `missing` say so?", yes="Y", no="N")}
        report = lint.check("From: a\nTo: b\n", q)
        self.assertEqual([(f["level"], f["code"], f["question"]) for f in report["findings"]],
                         [("problem", "missing_path", "b"), ("advice", "fields_in_text", None), ("advice", "noul_criteria", "a")])
        self.assertEqual(report["counts"], {"problem": 1, "advice": 2})

    def test_the_route_validates_and_takes_picture_references(self):
        self.assertIs(server.ROUTES[("POST", "/api/workbench/lint")], server.api_wb_lint)
        q = {"x": noul("Is the bag in `photo-3fa9c1d2e7` torn?", yes="Y", no="N")}
        self.assertEqual(server.api_wb_lint({"state": "torn", "questions": q})["counts"]["problem"], 1)
        report = server.api_wb_lint({"state": "torn", "questions": q, "images": {"photo-3fa9c1d2e7": {"sample": "torn-bag"}}})
        self.assertEqual(report["findings"], [])
        for body in ({"state": "torn", "questions": {}}, {"state": "", "questions": q}):
            with self.subTest(body=body), self.assertRaises(workbench.WorkbenchError):
                server.api_wb_lint(body)


class BuiltInRequestTests(unittest.TestCase):
    """No demo or example sends a request with a problem in it."""

    def setUp(self):
        self.sent = []

        def post(payload):
            self.sent.append(payload)
            return {"model": "jev-1.14.0", "answers": fake_answers(payload["questions"]), "usage": {"input_tokens": 100}}

        for target, attr, value in ((server.client, "_post_system_one", post), (server.client, "_memory_key", "sk-test"),
                                    (server.client, "guard", SpendGuard(budget_usd=100, rpm=1000))):
            patcher = patch.object(target, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(server.autopilot.reset)

    def demo_requests(self):
        def last(call):
            call()
            return self.sent[-1]

        order = next(iter(server.dispatch_world.state["orders"]))
        game = server.api_play_new({"seed": 1})
        yield "playground", last(lambda: server.api_hello({"text": "My order A-1041 arrived damaged. Refund please."}))
        for message in INBOX:
            yield "shield " + message["id"], last(lambda: server.api_shield({"message": dict(message)}))
            yield "autopilot " + message["id"], last(lambda: server.api_autopilot_process({"id": message["id"]}))
        yield "dispatch", last(lambda: server.api_dispatch({"text": "Pay PackRight's open invoice"}))
        yield "find", last(lambda: server.api_find({"queries": ["When do we roast?", "Who handles refunds?"]}))
        yield "play", last(lambda: server.api_play_ask({"id": game["id"], "text": "Is it alive?"}))
        yield "claims", last(lambda: server.api_claims_check({"order": order, "note": "The bag tore.", "image": {"sample": "torn-bag"}}))

    def test_no_demo_or_example_has_a_problem(self):
        requests = list(self.demo_requests())
        requests += [("example " + e["id"], {"state": e["state"], "questions": e["questions"], "assets": e.get("images") or {}})
                     for e in examples.EXAMPLES]
        for row in workbench.load_sample_rows():
            state = workbench.split_labels(row, 0)[0]
            requests += [("bulk sample", {"state": state, "questions": examples.BULK_QUESTIONS}),
                         ("terse bulk sample", {"state": state, "questions": examples.TERSE_BULK_QUESTIONS})]
        self.assertGreater(len(requests), 20)
        for name, request in requests:
            with self.subTest(request=name):
                questions = workbench.validate_questions(request["questions"])
                report = lint.check(request["state"], questions, request.get("assets") or {})
                self.assertEqual([f for f in report["findings"] if f["level"] == "problem"], [])


if __name__ == "__main__":
    unittest.main()
