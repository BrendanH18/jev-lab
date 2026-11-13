"""Lab pack lint-wording: one test per question check on the wording of instructions, and a check that no rule
reports on any built-in request."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from lablint_corpus import assert_quiet  # noqa: E402
from jev.lab.packs import lint_wording  # noqa: E402

LEVELS = ["Calm", "Annoyed", "Angry"]
TEAMS = {"billing": "Charges and refunds", "shipping": "Parcels and delivery"}
STATE = {"message": "My order is late.", "order": {"total": 40}}


def noul(text, yes="A clear case", no="No sign of it"):
    return {"type": "noul", "instructions": text, "criteria": {"true": yes, "false": no}}


def choice(text, options=None):
    return {"type": "choice", "instructions": text, "criteria": options or dict(TEAMS)}


def score(text, levels=None):
    return {"type": "score", "instructions": text, "criteria": levels or list(LEVELS)}


def one(question, state=STATE):
    return (state, {"x": question})


CASES = {
    "vague_amount": {"hit": one(noul("Does `message` mention several products?")),
                     "miss": one(noul("Does `message` mention more than one product?")), "question": "x", "message": '"several"'},
    "degree_in_noul": {"hit": one(noul("Is `message` very rude?")), "miss": one(score("How very rude is `message`?")),
                       "question": "x", "message": '"very rude".*Score'},
    "negated_noul": {"hit": one(noul("Doesn't `message` mention a refund?")),
                     "miss": one(noul("Does `message` mention a refund that was not issued?")), "question": "x", "message": "positive question"},
    "double_negative": {"hit": one(noul("Does `message` say it is not without problems?")),
                        "miss": one(noul("Does `message` say it has no problems, not even small ones?")), "question": "x", "message": "two negatives"},
    "leading_question": {"hit": one(choice("Which team obviously owns `message`?")),
                         "miss": one(noul("Does `message` say “obviously”?")), "question": "x", "message": '"obviously"'},
    "noul_open_question": {"hit": one(noul("How angry is `message`?")), "miss": one(score("How angry is `message`?")),
                           "question": "x", "message": '"how \\.\\.\\."'},
    "asks_count": {"hit": one(choice("How many items does `order` list?", {"one": "One item", "more": "Two or more"})),
                   "miss": one(choice("How many days ago was `order` placed?", {"recent": "This week", "older": "Earlier"})),
                   "question": "x", "message": '"how many"'},
    "asks_arithmetic": {"hit": one(score("Calculate the refund owed for `order` and rate it.")),
                        "miss": one(noul("Does `message` say the bill adds up to the quote?")), "question": "x", "message": '"calculate"'},
    "asks_date_math": {"hit": one(choice("How many days between `order` and `message`?", {"few": "Under a week", "many": "A week or more"})),
                       "miss": one(choice("Which day of the month is the deadline in `message`?", {"1": None, "2": None})),
                       "question": "x", "message": '"how many days"'},
    "asks_length": {"hit": one(noul("Is `message` longer than 100 words?")), "miss": one(noul("Is `message` longer than the reply?")),
                    "question": "x", "message": '"longer than 100 words"'},
    "numeric_comparison": {"hit": one(noul("Is the refund in `message` more than $100?")),
                           "miss": one(noul("Is `message` longer than 100 words?")), "question": "x", "message": '"more than \\$100"'},
    "future_question": {"hit": one(noul("Will the customer in `message` cancel?")),
                        "miss": one(noul("Does `message` say the customer will cancel?")), "question": "x", "message": "what will happen"},
    "asks_model_confidence": {"hit": one(noul("How confident are you that `message` is spam?")), "miss": one(noul("Is `message` spam?")),
                              "question": "x", "message": '"how confident are you"'},
    "asks_model_opinion": {"hit": one(noul("In your opinion, is `message` rude?")),
                           "miss": one(noul("Does `message` give an opinion about the roast?")), "question": "x", "message": '"in your opinion"'},
    "role_preamble": {"hit": one(noul("You are a support agent. Is `message` urgent?")),
                      "miss": one(noul("Is `message` a reply to “you are late”?")), "question": "x", "message": '"you are"'},
    "polite_request": {"hit": one(noul("Could you tell whether `message` is urgent?")),
                       "miss": one(noul("Could the order in `message` arrive late?")), "question": "x", "message": '"could you"'},
    "template_variable": {"hit": one(noul("Does {{customer}} want a refund?")),
                          "miss": one(noul('Does `message` contain a template tag such as "{{name}}"?')),
                          "question": "x", "message": r"\(\{\{customer\}\}\)"},
    "insert_placeholder": {"hit": one(choice("Which team handles [insert topic here]?")),
                           "miss": one(choice("Which team handles `message` [see the policy]?")), "question": "x", "message": r"\[insert topic here\]"},
    "lorem_ipsum": {"hit": one(choice("Which team handles `message`?", {"billing": "Lorem ipsum dolor sit amet", "shipping": "Parcels"})),
                    "miss": one(choice("Which team handles `message`?")), "question": "x", "message": "Lorem ipsum"},
    "unbalanced_backticks": {"hit": one(noul("Does `message mention a refund?")), "miss": one(noul("Does `message` mention a refund?")),
                             "question": "x", "message": "instructions have an odd number of backticks"},
    "unbalanced_quotes": {"hit": one(noul('Does `message` say "refund?')), "miss": one(noul('Is the 12" grinder in `message` damaged?')),
                          "question": "x", "message": "do not pair up in the instructions"},
    "dangling_instruction": {"hit": one(noul("Does `message` mention a refund or")),
                             "miss": one(noul("Does `message` mention a refund or a credit?")), "question": "x", "message": '"or"'},
    "label_not_question": {"hit": one(score("Customer sentiment")), "miss": one(score("Rate customer sentiment in `message`")),
                           "question": "x", "message": '"Customer sentiment"'},
    "noul_not_a_question": {"hit": one(noul("The customer in `message` wants a refund.")),
                            "miss": one(noul("Does the customer in `message` want a refund?")), "question": "x", "message": "not a question"},
    "asks_for_text": {"hit": one(choice("Summarize `message` and pick a team.")),
                      "miss": one(choice("Which team should handle the summary in `message`?")), "question": "x", "message": '"summarize"'},
    "asks_for_reasoning": {"hit": one(noul("Think step by step: is `message` spam?")),
                           "miss": one(noul("Does `message` describe brewing one step at a time?")), "question": "x", "message": '"step by step"'},
    "output_format_request": {"hit": one(noul("Is `message` spam? Answer with yes or no.")),
                              "miss": one(noul("Can `message` be answered with yes or no?")), "question": "x",
                              "message": 'a Noul returns the probability of yes.*"answer with"'},
    "shouting": {"hit": one(noul("Is `message` spam? IMPORTANT: check the links.")), "miss": one(noul("Is `message` about an important order?")),
                 "question": "x", "message": '\\("IMPORTANT"\\)'},
    "inline_examples": {"hit": one(choice("Which product does `message` name, e.g. a grinder?", {"grinder": "A grinder", "kettle": "A kettle"})),
                        "miss": one(choice("Which product does `message` name?", {"grinder": "e.g. a burr grinder", "kettle": "A kettle"})),
                        "question": "x", "message": '"e\\.g\\."'},
    "bulleted_instructions": {"hit": one(noul("Is `message` spam?\n- links\n- prizes")), "miss": one(noul("Is `message` spam?\n- links")),
                              "question": "x", "message": "list of 2 items"},
    "depends_on_other_answer": {"hit": one(noul("If yes, does `message` also ask for a refund?")),
                                "miss": one(noul("Does `message` answer the customer's question?")), "question": "x", "message": '"if yes,"'},
    "positional_reference": {"hit": one(noul("Is the message below rude?")), "miss": one(noul("Is `message` rude?")),
                             "question": "x", "message": '"message below"'},
    "hedged_noul": {"hit": one(noul("Might `message` be spam?")), "miss": one(noul("Does `message` say “maybe later”?")),
                    "question": "x", "message": '"might"'},
    "relative_time_without_clock": {"hit": one(noul("Is the invoice in `message` overdue?")),
                                    "miss": one(noul("Is the invoice in `message` overdue?"), dict(STATE, today="2026-09-17")),
                                    "question": "x", "message": '"overdue"'},
    "asks_regex_fact": {"hit": one(noul("Does `message` contain an email address?")),
                        "miss": one(noul("Does `message` share someone else's email address?")), "question": "x", "message": '"contain an email address"'},
    "link_in_question": {"hit": one(choice("Which policy at https://harbor.example/returns applies to `message`?")),
                         "miss": one(choice("Which returns policy applies to `message`?")), "question": "x",
                         "message": r"\(https://harbor\.example/returns\)"},
    "empty_instruction_field": {"hit": one(noul({"question": "Is `message` spam?", "focus": ""})),
                                "miss": one(noul({"question": "Is `message` spam?", "focus": "Links and prizes"})), "question": "x", "message": "`focus`"},
    "scale_in_text": {"hit": one(score("On a scale of 1 to 5, how upset is `message`?")), "miss": one(score("How upset is `message`?")),
                      "question": "x", "message": '"on a scale"'},
    "open_ended_list": {"hit": one(choice("Which item (grinder, kettle, etc.) does `message` name?")),
                        "miss": one(choice("Which item does `message` name?")), "question": "x", "message": '"etc\\."'},
    "and_or": {"hit": one(noul("Does `message` ask for a refund and/or a replacement?")),
               "miss": one(noul("Does `message` ask for a refund or a replacement?")), "question": "x", "message": '"and/or"'},
    "unstated_baseline": {"hit": one(noul("Is `order.total` higher than usual?")),
                          "miss": one(noul("Is `order.total` higher than usual for `message`?")), "question": "x", "message": '"than usual"'},
    "negation_in_choice": {"hit": one(choice("Which team should not handle `message`?")), "miss": one(choice("Which team should handle `message`?")),
                           "question": "x", "message": "inverts"},
    "asks_to_rank": {"hit": one(score("Rank `message` by urgency.")), "miss": one(score("How urgent is `message`?")),
                     "question": "x", "message": '"rank"'},
}


# Wording each rule must leave alone: the reported content of the input, ordinary English that only looks like the
# pattern, and data in quotes.
QUIET = [
    ("vague_amount", noul("Does `message` say the order cost too much?")),
    ("degree_in_noul", noul("Is this the very first message from the customer in `message`?")),
    ("degree_in_noul", noul("Was the customer in `message` charged fairly and on time?")),
    ("negated_noul", noul("Does `message` ask us not to call?")),
    ("double_negative", noul("Does `message` say there is no milk and no sugar?")),
    ("double_negative", noul("Does `message` say the parcel will not come until Friday?")),
    ("leading_question", noul("Does `message` describe a change of course?")),
    ("noul_open_question", noul("When `message` mentions a refund, does it give a reason?")),
    ("asks_count", noul("Does `message` ask how many bags come in a box?")),
    ("asks_count", noul("Does the receipt in `message` tally with the order?")),
    ("asks_arithmetic", noul("Does `message` dispute the total of the invoice?")),
    ("asks_date_math", noul("Does `message` say the order arrived 3 days ago?")),
    ("numeric_comparison", noul("Was the order in `message` placed more than 30 days ago?")),
    ("future_question", noul("Does `message` say the customer is going to cancel?")),
    ("asks_model_confidence", noul("Does `message` mention the likelihood that the parcel is lost?")),
    ("polite_request", noul("Would you say `message` is rude?")),
    ("template_variable", noul("Does `message` use a set like {a, b}?")),
    ("dangling_instruction", noul("Which team is `message` meant for")),
    ("dangling_instruction", noul("Is the grade in `message` an A")),
    ("noul_not_a_question", noul("Decide whether `message` asks for a refund.")),
    ("noul_not_a_question", noul("Is `message` spam")),
    ("output_format_request", noul("Does the agent in `message` reply with a refund offer?")),
    ("output_format_request", noul("Is the attachment in `message` sent as JSON?")),
    ("inline_examples", noul({"question": "Is `message` spam?", "notes": "For example, prize offers"})),
    ("bulleted_instructions", noul({"question": "Is `message` spam?", "signals": "- links\n- prizes"})),
    ("depends_on_other_answer", noul("Does `message` answer the customer's last question?")),
    ("positional_reference", noul("Does `message` name any of the following: grinder, kettle?")),
    ("hedged_noul", noul("Does `message` say the order might be late?")),
    ("relative_time_without_clock", noul("Does `message` say the invoice is overdue?")),
    ("relative_time_without_clock", noul("Is the invoice in `message` overdue?"), dict(STATE, sentAt="2026-09-17T10:00")),
    ("scale_in_text", noul("Did the customer in `message` give the coffee 4 out of 5?")),
    ("unstated_baseline", noul("Did the parcel in `message` arrive later than expected?")),
    ("negation_in_choice", choice("Which team does `message` say did not reply?")),
    ("asks_to_rank", score("Sort `message` into a level of urgency.")),
    ("link_in_question", noul('Does `message` contain "https://harbor.example"?')),
]

# More forms each rule must catch, with the authored words it should quote.
HITS = [
    ("template_variable", noul("Does ${customer} want a refund?"), r"\(\$\{customer\}\)"),
    ("template_variable", choice("Which team handles {topic}?"), r"\(\{topic\}\)"),
    ("template_variable", noul("Does %s want a refund?"), r"\(%s\)"),
    ("double_negative", noul("Does `message` say the delay is not unusual?"), "two negatives"),
    ("asks_date_math", noul("Was the order in `message` placed more than 30 days ago?"), '"more than 30 days"'),
    ("noul_open_question", noul("Where was the parcel in `message` left?"), '"where \\.\\.\\."'),
    ("hedged_noul", noul("Is `message` possibly spam?"), '"possibly"'),
    ("negation_in_choice", choice("Which team does not fit `message`?"), "inverts"),
    ("output_format_request", noul("Is `message` spam (yes/no)?"), '"\\(yes/no\\)"'),
    ("dangling_instruction", noul("Classify the tone of `message`:"), '":"'),
]


class LintWordingTests(pack_tests(lint_wording.PACK, CASES)):
    def test_rules_leave_ordinary_wording_alone(self):
        rules = {feature["id"]: feature["check"] for feature in lint_wording.PACK["features"]}
        for ident, question, *state in QUIET:
            with self.subTest(rule=ident, question=question["instructions"]):
                self.assertEqual(rules[ident](state[0] if state else STATE, {"x": question}, set()), [])

    def test_rules_catch_more_forms(self):
        rules = {feature["id"]: feature["check"] for feature in lint_wording.PACK["features"]}
        for ident, question, message in HITS:
            with self.subTest(rule=ident, question=question["instructions"]):
                found = rules[ident](STATE, {"x": question}, set())
                self.assertEqual(len(found), 1)
                self.assertEqual(found[0][0], "x")
                self.assertRegex(found[0][1], message)

    def test_quiet_on_every_built_in_request(self):
        assert_quiet(self, lint_wording.PACK, terse_ok=["label_not_question"])

    def test_anchors_are_known_guide_sections(self):
        known = {"#use-structure-in-the-input-state", "#decompose-the-questions", "#use-structure-in-the-questions"}
        self.assertTrue(all(feature["anchor"] in known for feature in lint_wording.PACK["features"]))


if __name__ == "__main__":
    unittest.main()
