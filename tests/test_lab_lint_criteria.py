"""Lab pack lint-criteria: one test per question check on Choice, Score and Noul criteria, and a check that no rule
reports on any built-in request."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from lablint_corpus import assert_quiet  # noqa: E402
from jev.lab.packs import lint_criteria  # noqa: E402

STATE = {"message": "My order arrived late and the bag was torn."}
LEVELS = ["Calm, just stating facts", "Annoyed but polite", "Angry, strong language"]
TEAMS = {"billing": "Charges and refunds", "shipping": "Parcels and delivery"}


def noul(yes="Asks for money back", no="Does not ask for money back", text="Does `message` ask for a refund?"):
    return {"type": "noul", "instructions": text, "criteria": {"true": yes, "false": no}}


def choice(options, text="Which team should handle `message`?"):
    return {"type": "choice", "instructions": text, "criteria": options}


def score(levels, text="How upset is the writer of `message`?"):
    return {"type": "score", "instructions": text, "criteria": levels}


def one(question, qid="x"):
    return (STATE, {qid: question})


WORDS_41 = " ".join(["word"] * 41)
WORDS_40 = " ".join(["word"] * 40)

CASES = {
    "single_option": {"hit": one(choice({"billing": "Charges and refunds"})), "miss": one(choice(dict(TEAMS))),
                      "question": "x", "message": "one option \\(`billing`\\)"},
    "yes_no_choice": {"hit": one(choice({"yes": "Asks for a refund", "no": "Does not ask"}, "Does `message` ask for a refund?")),
                      "miss": one(choice({"yes": "Asks for a refund", "partly": "Asks for store credit", "no": "Does not ask"})),
                      "question": "x", "message": "Noul"},
    "score_two_levels": {"hit": one(score(["Calm, just stating facts", "Angry, strong language"])), "miss": one(score(list(LEVELS))),
                         "question": "x", "message": "two levels"},
    "score_many_levels": {"hit": one(score(["Level %d of upset" % i for i in range(8)])),
                          "miss": one(score(["Level %d of upset" % i for i in range(7)])), "question": "x", "message": "^8 levels"},
    "options_restate_keys": {"hit": one(choice({"billing": "Billing", "late_delivery": "Late delivery"})),
                             "miss": one(choice({"billing": "Billing", "shipping": "Parcels and delivery"})), "question": "x", "message": "repeats its key"},
    "one_word_options": {"hit": one(choice({"billing": "Money", "shipping": "Parcels"})),
                         "miss": one(choice({"billing": "Billing", "shipping": "Shipping"})), "question": "x", "message": "one word"},
    "one_word_levels": {"hit": one(score(["Calm", "Annoyed", "Angry"])), "miss": one(score(["Calm", "Annoyed", "Very angry"])),
                        "question": "x", "message": "one word"},
    "option_is_question": {"hit": one(choice({"billing": "Is it about money?", "shipping": "Parcels and delivery"})),
                           "miss": one(choice({"billing": "Is it about money", "shipping": "Parcels and delivery"})),
                           "question": "x", "message": "`billing` ends with a question mark"},
    "long_criterion": {"hit": one(choice({"billing": WORDS_41, "shipping": "Parcels"})), "miss": one(choice({"billing": WORDS_40, "shipping": "Parcels"})),
                       "question": "x", "message": "`billing` runs to 41 words"},
    "keys_differ_by_case": {"hit": one(choice({"late_delivery": "Arrived after the promised date", "LateDelivery": "Arrived after the date"})),
                            "miss": one(choice({"late": "Arrived after the promised date", "delivery": "Delivery questions"})),
                            "question": "x", "message": "`late_delivery` and `LateDelivery`"},
    "options_differ_by_negation": {"hit": one(choice({"urgent": "Urgent reply needed", "routine": "No urgent reply needed"})),
                                   "miss": one(choice({"urgent": "Urgent reply needed", "routine": "Reply needed within the week"})),
                                   "question": "x", "message": "`urgent` and `routine` differ only by a negation"},
    "reordered_descriptions": {"hit": one(choice({"a": "Late and damaged", "b": "Damaged and late"})),
                               "miss": one(choice({"a": "Late and damaged", "b": "Late but intact"})), "question": "x", "message": "`a` and `b`"},
    "same_leading_words": {"hit": one(score(["The customer in the message is calm", "The customer in the message is angry", "Furious"])),
                           "miss": one(score(["The customer is calm", "The customer is angry", "Furious"])),
                           "question": "x", "message": "^Level 0 and level 1 begin with the same 6 words"},
    "catch_all_not_last": {"hit": one(choice({"billing": "Charges", "other": "Anything else", "shipping": "Parcels"})),
                           "miss": one(choice({"billing": "Charges", "shipping": "Parcels", "other": "Anything else", "none": "No team needs to act"})),
                           "question": "x", "message": "^`other` is a catch-all"},
    "conditional_choice_without_fallback": {
        "hit": one(choice({"damaged": "Arrived broken", "late": "Arrived late"}, "If `message` asks for a refund, which reason does it give?")),
        "miss": one(choice({"damaged": "Arrived broken", "late": "Arrived late", "not_stated": "No reason is given"},
                           "If `message` asks for a refund, which reason does it give?")),
        "question": "x", "message": "not_stated"},
    "two_catch_alls": {"hit": one(choice({"billing": "Charges", "other": "Anything else", "misc": "Miscellaneous requests"})),
                       "miss": one(choice({"billing": "Charges", "other": "Anything else", "unknown": "The message is unreadable"})),
                       "question": "x", "message": "`other` and `misc` are all catch-alls"},
    "key_with_spaces": {"hit": one(choice({"late delivery": "Arrived late", "billing": "Charges"})),
                        "miss": one(choice({"late_delivery": "Arrived late", "billing": "Charges"})), "question": "x", "message": "`late delivery` contains spaces"},
    "mixed_key_styles": {"hit": one(choice({"late_delivery": "Arrived late", "wrongItem": "Another product arrived"})),
                         "miss": one(choice({"late_delivery": "Arrived late", "wrong_item": "Another product arrived", "billing": "Charges"})),
                         "question": "x", "message": "\\(snake_case, camelCase\\)"},
    "keys_repeat_question_id": {"hit": one(choice({"reason_damaged": "Arrived broken", "reason_late": "Arrived late"}), "reason"),
                                "miss": one(choice({"damaged": "Arrived broken", "late": "Arrived late"}), "reason"),
                                "question": "reason", "message": "`damaged` instead of `reason_damaged`"},
    "sentence_as_key": {"hit": one(choice({"the_order_arrived_late": "Arrived late", "billing": "Charges"})),
                        "miss": one(choice({"late_order": "Arrived late", "billing": "Charges"})), "question": "x", "message": "`the_order_arrived_late`"},
    "choice_keys_in_instructions": {
        "hit": one(choice({"billing": "Charges", "shipping": "Parcels", "returns": "Sending items back"}, "Is `message` about billing, shipping or returns?")),
        "miss": one(choice({"billing": "Charges", "shipping": "Parcels", "returns": "Sending items back"})),
        "question": "x", "message": "`billing`, `shipping`, `returns`"},
    "ordinal_choice": {"hit": one(choice({"low": "Can wait", "medium": "This week", "high": "Today"})),
                       "miss": one(choice({"low": "Can wait", "medium": "This week", "billing": "Charges"})), "question": "x", "message": "ordered scale"},
    "noul_same_criteria": {"hit": one(noul("Asks for a refund.", "asks for a refund")), "miss": one(noul()), "question": "x", "message": "the same"},
    "noul_criteria_swapped": {"hit": one(noul("No refund is requested", "A refund is requested")),
                              "miss": one(noul("A refund is requested", "No refund is requested")), "question": "x", "message": "swapped"},
    "noul_both_negative": {"hit": one(noul("No refund is requested yet", "Not a refund request")),
                           "miss": one(noul("A refund is requested", "No refund is requested")), "question": "x", "message": "both read as negatives"},
    "yes_no_only_criteria": {"hit": one(noul("Yes", "No")), "miss": one(noul("Asks for money back", "No")), "question": "x", "message": "only say yes and no"},
    "level_number_mismatch": {"hit": one(score(["1 - Calm", "2 - Annoyed", "3 - Angry"])), "miss": one(score(["0 - Calm", "1 - Annoyed", "2 - Angry"])),
                              "question": "x", "message": "Level 0 starts with the number 1"},
    "numeric_levels": {"hit": one(score(["1", "2", "3"])), "miss": one(score(["1 - Calm", "2 - Annoyed", "3 - Angry"])),
                       "question": "x", "message": "bare numbers"},
    "levels_reversed": {"hit": one(score(["Severe damage", "Minor damage", "No damage"])),
                        "miss": one(score(["No damage", "Minor damage", "Severe damage"])), "question": "x", "message": '"severe" down to "no"'},
    "levels_out_of_order": {"hit": one(score(["No damage", "Severe damage", "Minor damage"])),
                            "miss": one(score(["No damage", "Minor damage", "Severe damage"])), "question": "x", "message": 'Level 2 \\("minor"\\)'},
    "mixed_level_fields": {"hit": one(score([{"what": "Calm"}, "Annoyed but polite", {"what": "Angry"}])),
                           "miss": one(score([{"what": "Calm"}, {"what": "Annoyed but polite"}, {"what": "Angry"}])),
                           "question": "x", "message": "different fields"},
    "uneven_level_labels": {"hit": one(score(["None: no damage", "Minor: a dent", "Badly broken"])),
                            "miss": one(score(["None: no damage", "Minor: a dent", "Major: badly broken"])),
                            "question": "x", "message": "but level 2 does not"},
    "range_reversed": {"hit": one(choice({"small": "Orders of 20-10 bags", "large": "Orders of 21-50 bags"})),
                       "miss": one(choice({"small": "Orders of 1-20 bags", "large": "Orders of 21-50 bags"})),
                       "question": "x", "message": "`small` runs backwards \\(20 to 10\\)"},
    "range_overlap": {"hit": one(score(["Light: 0-10 lb a week", "Regular: 10-50 lb a week", "Heavy: 51-500 lb a week"])),
                      "miss": one(score(["Light: 0-9 lb a week", "Regular: 10-50 lb a week", "Heavy: 51-500 lb a week"])),
                      "question": "x", "message": "level 0 and level 1 overlap \\(both include 10\\)"},
    "range_gap": {"hit": one(choice({"small": "1-3 bags", "large": "5-7 bags"})), "miss": one(choice({"small": "1-4 bags", "large": "5-7 bags"})),
                  "question": "x", "message": "nothing covers 4\\."},
    "empty_criterion_field": {"hit": one(noul({"what": "Asks for money back", "examples": []}, "Does not ask for money back")),
                              "miss": one(noul({"what": "Asks for money back", "examples": ["please refund me"]}, "Does not ask for money back")),
                              "question": "x", "message": "^The yes criterion has an empty field `examples`"},
    "shared_example": {"hit": one(noul({"what": "Asks for money back", "examples": ["please refund me"]},
                                       {"what": "Does not ask", "examples": ["Please refund me."]})),
                       "miss": one(noul({"what": "Asks for money back", "examples": ["please refund me"]},
                                        {"what": "Does not ask", "examples": ["thanks for the coffee"]})),
                       "question": "x", "message": "^The yes criterion and the no criterion list the same example"},
    "score_asks_which": {"hit": one(score(list(LEVELS), "Which team should handle `message`?")), "miss": one(score(list(LEVELS))),
                         "question": "x", "message": '"which"'},
}


# Criteria each rule must leave alone.
QUIET = [
    ("level_number_mismatch", score(["0 bags", "1-3 bags", "4-10 bags"], "How many bags does `message` order?")),
    ("level_number_mismatch", score(["None", "1 - one complaint", "Several complaints"])),
    ("sentence_as_key", choice({"billing": "Charges", "none_of_the_above": "No team fits"})),
    ("shared_example", choice({"billing": {"what": "Charges", "not_for": ["returns"]},
                               "shipping": {"what": "Parcels", "not_for": ["returns"]}})),
    ("range_reversed", choice({"day": "Open 9-5 on weekdays", "night": "The late shift"})),
    ("noul_criteria_swapped", noul("No complaints at all", "Complains about the order", "Is `message` free of complaints?")),
    ("noul_both_negative", noul("Nothing is missing", "Not complete: an item is missing", "Is nothing missing from `message`?")),
    ("one_word_levels", score(["1", "2", "3"])),
    ("options_differ_by_negation", choice({"urgent": "Urgent reply needed", "later": "Reply needed later"})),
    ("catch_all_not_last", choice({"billing": "Charges", "other": "Anything else", "none": "No team needs to act"})),
]

# More forms each rule must catch, with what its message should say.
HITS = [
    ("level_number_mismatch", score(["1) Calm", "2) Annoyed", "3) Angry"]), "Level 0 starts with the number 1"),
    ("options_differ_by_negation", choice({"refund": "Asks for a refund", "keep": "Never asks for a refund", "credit": "Store credit"}),
     "split one yes/no question"),
    ("option_is_question", score(["Calm", "Annoyed?", "Angry, strong language"]), "^Level 1 ends with a question mark"),
    ("long_criterion", noul(WORDS_41, "Does not ask"), "^The yes criterion runs to 41 words"),
    ("range_overlap", choice({"small": "Orders of 0-20 bags", "large": "Orders of 10-50 bags"}), "both include 10\\)"),
    ("range_gap", score(["0-9 lb a week", "10-49 lb a week", "60-500 lb a week"]), "nothing covers 50 to 59\\."),
    ("levels_out_of_order", score(["No damage", "Minor damage", "Severe damage", "Some damage"]), 'Level 3 \\("some"\\)'),
    ("ordinal_choice", choice({"never": "Not once", "sometimes": "Now and then", "always": "Every time", "other": "Unclear"}),
     "`never`, `sometimes`, `always`"),
]


class LintCriteriaTests(pack_tests(lint_criteria.PACK, CASES)):
    def test_rules_leave_ordinary_criteria_alone(self):
        rules = {feature["id"]: feature["check"] for feature in lint_criteria.PACK["features"]}
        for ident, question in QUIET:
            with self.subTest(rule=ident, criteria=question["criteria"]):
                self.assertEqual(rules[ident](STATE, {"x": question}, set()), [])

    def test_rules_catch_more_forms(self):
        rules = {feature["id"]: feature["check"] for feature in lint_criteria.PACK["features"]}
        for ident, question, message in HITS:
            with self.subTest(rule=ident, criteria=question["criteria"]):
                found = rules[ident](STATE, {"x": question}, set())
                self.assertEqual(len(found), 1)
                self.assertRegex(found[0][1], message)

    def test_quiet_on_every_built_in_request(self):
        assert_quiet(self, lint_criteria.PACK, terse_ok=["options_restate_keys", "one_word_levels"])

    def test_a_negative_yes_about_something_else_is_not_swapped(self):
        first = noul("No earlier contact is mentioned", "Mentions an earlier email, call, or chat",
                     "Is `message` the customer's first message about this problem?")
        self.assertEqual(lint_criteria.noul_criteria_swapped(STATE, {"first": first}, set()), [])

    def test_anchors_are_known_guide_sections(self):
        known = {"#use-structure-in-the-input-state", "#decompose-the-questions", "#use-structure-in-the-questions"}
        self.assertTrue(all(feature["anchor"] in known for feature in lint_criteria.PACK["features"]))


if __name__ == "__main__":
    unittest.main()
