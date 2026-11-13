"""Lab pack lint-gating: one test per question check on gating and automation, and a check that no rule reports on
any built-in request."""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from lablint_corpus import assert_quiet  # noqa: E402
from jev import lint  # noqa: E402
from jev.lab.packs import lint_gating  # noqa: E402

STATE = {"message": "My grinder arrived with a cracked hopper.", "status": "shipped", "order": {"total": 249}}
PHOTO = {"message": "The bag split open.", "photo": "photo-3fa9c1d2e7a1"}


def noul(text, yes="A clear case", no="No sign of it"):
    return {"type": "noul", "instructions": text, "criteria": {"true": yes, "false": no}}


def choice(text, options):
    return {"type": "choice", "instructions": text, "criteria": options}


def score(text, levels):
    return {"type": "score", "instructions": text, "criteria": levels}


def box(text):
    return {"type": "box", "instructions": text}


TEAMS = {"billing": "Charges, refunds and invoices", "shipping": "Deliveries and lost parcels",
         "technical": "The website, the app and broken machines"}


def one(question, qid="x", state=STATE, refs=()):
    return (state, {qid: question}, list(refs))


CASES = {
    "option_alias": {
        "hit": one(choice("Which team should handle `message`?", dict(TEAMS, refunds="Same as `billing`"))),
        "miss": one(choice("Which team should handle `message`?", dict(TEAMS, refunds="Money back for an order, not other charges"))),
        "question": "x", "message": re.compile(r"^`refunds` is described as the same as `billing`")},
    "inflected_option_keys": {
        "hit": one(choice("What does `message` ask for?", {"refund": "Money back", "refunds": "Money back for several orders",
                                                           "exchange": "A different item"})),
        "miss": one(choice("What does `message` ask for?", {"refund": "Money back", "replacement": "The same item again",
                                                            "exchange": "A different item"})),
        "question": "x", "message": re.compile(r"^Options `refund` and `refunds` differ only by an ending")},
    "combined_option": {
        "hit": one(choice("What does `message` ask for?", {"refund": "Money back", "exchange": "A different item",
                                                           "refund_and_exchange": "Money back for one item and a swap"})),
        "miss": one(choice("What does `message` ask for?", {"refund": "Money back", "exchange": "A different item",
                                                            "torn_or_open": "A torn bag"})),
        "question": "x", "message": re.compile(r"^`refund_and_exchange` stands for several other options at once")},
    "flag_options": {
        "hit": one(choice("What is true of `message`?", {"is_urgent": "Needs action today", "has_photo": "Mentions a photo",
                                                         "other": "Anything else"})),
        "miss": one(choice("What is `message` about?", {"urgent_delivery": "A delivery needed today", "photo_claim": "A damage claim",
                                                        "other": "Anything else"})),
        "question": "x", "message": re.compile(r"^Options `is_urgent` and `has_photo` read as yes/no facts")},
    "negated_key_pair": {
        "hit": one(choice("Does `message` ask for money back?", {"refund": "Asks for money back", "no_refund": "Asks for nothing back"})),
        "miss": one(choice("Why does `message` want a refund?", {"damaged": "Arrived broken", "not_delivered": "Never arrived"})),
        "question": "x", "message": re.compile(r"^Options `refund` and `no_refund` are one condition and its negation\. This is a yes/no")},
    "numeric_choice_keys": {
        "hit": one(choice("How happy is `message`?", {"1": "Unhappy", "2": "Neutral", "3": "Happy"})),
        # Undescribed numbered options are positions or day numbers, not a scale.
        "miss": one(choice("Which line of `message` says it?", {"L000": None, "L001": None, "L002": None})),
        "question": "x", "message": re.compile(r"^The options are numbered 1 to 3, an ordered scale")},
    "certainty_in_options": {
        "hit": one(choice("Is `message` spam?", {"definitely_spam": "Certainly junk", "probably_spam": "Looks like junk",
                                                 "not_spam": "A real message"})),
        "miss": one(choice("What kind of message is `message`?", {"spam": "Unwanted advertising", "phishing": "Tries to steal logins",
                                                                  "genuine": "A real message"})),
        "question": "x", "message": re.compile(r"^`definitely_spam` and `probably_spam` grade how sure the answer is")},
    "doubt_rule": {
        "hit": one(noul("Does `message` ask for a refund? If unsure, answer no.")),
        "miss": one(noul("Does `message` ask for a refund?", yes="Asks for money back", no="No request, or the text is unclear")),
        "question": "x", "message": re.compile(r"^The question says what to answer when in doubt \(\"if unsure, answer\"\)")},
    "confidence_bar": {
        "hit": one(noul("Does `message` ask for a refund? Say yes only if you are certain.")),
        "miss": one(noul("Does `message` clearly ask for a refund?")),
        "question": "x", "message": re.compile(r"^The wording sets a confidence bar \(\"only if you are certain\"\)")},
    "asks_for_decision": {
        "hit": one(noul("Should we refund the order in `message`?")),
        "miss": one(choice("If `message` asks for a refund, which order should be refunded?", {"A-1041": "Maya's order", "none": "No order"})),
        "question": "x", "message": re.compile(r"^The question asks the model to decide what to do \(\"should we\"\)")},
    "likelihood_question": {
        "hit": one(score("How likely is the customer in `message` to cancel?", ["Unlikely", "Possible", "Very likely"])),
        "miss": one(noul("Would the writer of `message` likely recommend us to a friend?")),
        "question": "x", "message": re.compile(r"^The question asks how likely something is \(\"how likely\"\)")},
    "numeric_cutoff_in_criteria": {
        "hit": one(noul("Is the order in `message` a large one?", yes="A total over $100", no="A small order")),
        "miss": one(noul("Is the order in `message` a large one?", yes="A wholesale or bulk order", no="A single bag or two")),
        "question": "x", "message": re.compile(r"^A criterion is decided by a written number \(\"over \$100\"\)")},
    "compound_noul": {
        "hit": one(noul("Is the order in `message` late and is the customer upset?")),
        "miss": one(noul("Does `message` say an item arrived late or broken?")),
        "question": "x", "message": re.compile(r"^The Noul joins two yes/no conditions")},
    "field_equality_question": {
        "hit": one(noul("Is `status` \"shipped\"?")),
        "miss": one(noul("Does `status` match what `message` says about delivery?")),
        "question": "x", "message": re.compile(r"^The question checks whether `status` equals a written value")},
    "asks_for_reason": {
        "hit": one(noul("Is `message` a complaint, and why?")),
        "miss": one(choice("Why does `message` ask for a refund?", {"damaged": "Arrived broken", "late": "Arrived late"})),
        "question": "x", "message": re.compile(r"^The question asks for a reason \(\"and why\?\"\)")},
    "multi_select_choice": {
        "hit": one(choice("Which problems does `message` report? Select all that apply.", {"late": "Arrived late", "broken": "Arrived broken"})),
        "miss": one(choice("Which problem does `message` report first?", {"late": "Arrived late", "broken": "Arrived broken"})),
        "question": "x", "message": re.compile(r"^The Choice asks for several options \(\"select all that\"\)")},
    "box_if_present": {
        "hit": one(box("the torn seam in `photo`, if any"), state=PHOTO),
        "miss": one(box("the torn seam in `photo`"), state=PHOTO),
        "question": "x", "message": re.compile(r"^The Box says \"if any\"")},
    "noul_repeats_choice_option": {
        "hit": (STATE, {"team": choice("Which team should handle `message`?", TEAMS),
                        "billing_issue": noul("Is `message` a billing question?")}),
        # The same words about another field are a different question.
        "miss": (STATE, {"team": choice("Which team should handle `message`?", TEAMS),
                         "billing_issue": noul("Is `status` a billing state?")}),
        "question": "billing_issue",
        "message": re.compile(r"^This Noul asks about `billing`, which is also an option of Choice `team`.*"
                              r"`if billing_issue = yes then team = billing`")},
    "inverse_nouls": {
        "hit": (STATE, {"damaged": noul("Is the item in `message` damaged?"), "intact": noul("Is the item in `message` not damaged?")}),
        "miss": (STATE, {"damaged": noul("Is the item in `message` damaged?"), "late": noul("Is the item in `message` late?")}),
        "question": "damaged", "message": re.compile(r"^Nouls `damaged` and `intact` ask the same thing, one in the negative")},
    "padded_option_key": {
        "hit": one(choice("Which team should handle `message`?", {"billing ": "Charges", "shipping": "Parcels"})),
        "miss": one(choice("Which team should handle `message`?", {"billing": "Charges", "shipping": "Parcels"})),
        "question": "x", "message": re.compile(r'^Option "billing " has spaces at its start or end')},
    "negative_id": {
        "hit": (STATE, {"triage.not_spam": noul("Is `message` from a real customer?")}),
        "miss": (STATE, {"triage.genuine": noul("Is `message` from a real customer?")}),
        "question": "triage.not_spam", "message": re.compile(r"such as `triage\.spam`")},
    "copy_id": {
        "hit": (STATE, {"urgent": noul("Is `message` urgent?"), "urgent_2": noul("Does `message` need a reply today?")}),
        # A numbered id with nothing to be a copy of is its own question (uninformative_id's ground, not this one).
        "miss": (STATE, {"line_2": noul("Is `message` urgent?")}),
        "question": "urgent_2", "message": re.compile(r"^`urgent_2` looks like a copy")},
    "id_reads_as_other_type": {
        "hit": (STATE, {"fraud_score": noul("Does `message` try to trick the shop?")}),
        "miss": (STATE, {"fraud_attempt": noul("Does `message` try to trick the shop?")}),
        "question": "fraud_score", "message": re.compile(r"^The Noul `fraud_score` is named like a category or an amount")},
}

# Ordinary questions every rule must leave alone.
QUIET = [
    (STATE, {"team": choice("Which team should handle `message`?", TEAMS),
             "wants_refund": noul("Does `message` ask for money back?"),
             "frustration": score("How frustrated is the writer of `message`?", ["Calm", "Annoyed", "Angry"])}),
    (STATE, {"tone": choice("How does `message` feel about us?", {"positive": "Pleased", "negative": "Unhappy", "mixed": "Both pleased and unhappy"})}),
    (STATE, {"same": score("Do `message` and `status` agree?", ["Different: leave them", "Unclear: a person should look", "Same: link them"])}),
    (PHOTO, {"seen": noul("Is a torn seam visible in `photo`?"), "seam": box("the torn seam in `photo`")}, ["photo-3fa9c1d2e7a1"]),
]

HITS = [
    ("option_alias", one(choice("Team for `message`?", {"billing": "Charges", "invoices": {"what": "Treat as billing"}})), "`invoices` is described as the same as `billing`"),
    ("combined_option", one(choice("What went wrong in `message`?", {"late": "Late", "broken": "Broken", "both": "Late and broken"})), "^`both` stands"),
    ("numeric_choice_keys", one(choice("Which tier is `message`?", {"tier_0": "Free", "tier_1": "Basic", "tier_2": "Pro"})), "numbered tier_0 to tier_2"),
    ("certainty_in_options", one(score("Is `message` spam?", ["Not spam", "Possibly spam", "Definitely spam"])), "^level 1 and level 2 grade"),
    ("doubt_rule", one(noul("Is `message` a complaint?", yes="A complaint. When in doubt, choose this.")), "when in doubt"),
    ("confidence_bar", one(noul("Is `message` spam? Err on the side of caution.")), "err on the side of"),
    ("asks_for_decision", one(noul("Should this order be refunded, given `message`?")), "should this order be refunded"),
    ("asks_for_decision", one(noul("Does `message` need human review?")), "needs? human review"),
    ("compound_noul", one(noul("Does `message` mention a refund or does it threaten a chargeback?")), "two yes/no conditions"),
    ("field_equality_question", one(noul("Does `order.total` equal 249?")), "whether `order.total` equals"),
    ("negated_key_pair", one(choice("What happened in `message`?", {"delivered": "Reached the door", "not_delivered": "Lost in transit", "late": "Arrived late"})), "split one yes/no question"),
    ("noul_repeats_choice_option", (STATE, {"team": choice("Which team should handle `message`?", TEAMS),
                                            "for_shipping": noul("Is `message` for the shipping team?")}), "^This Noul asks about `shipping`"),
    ("noul_repeats_choice_option", (STATE, {"team": choice("Which team should handle `message`?", TEAMS),
                                            "about_tech": noul("Is `message` about technical?")}), "`if about_tech = yes then team = technical`"),
    ("combined_option", one(choice("Which teams does `message` need?", dict(TEAMS, multiple="More than one team"))), "^`multiple` stands"),
    ("confidence_bar", one(noul("Is `message` spam? Apply a high threshold.")), "apply a high threshold"),
    ("field_equality_question", one(noul("Is `status` equal to shipped?")), "whether `status` equals"),
    ("negative_id", one(noul("Is `message` from a real customer?"), qid="is_not_spam"), "such as `spam`"),
    ("copy_id", one(noul("Is `message` urgent?"), qid="urgent_copy"), "^`urgent_copy` looks like a copy"),
    ("id_reads_as_other_type", one(choice("Is `message` urgent?", {"yes_today": "Today", "this_week": "This week"}), qid="is_urgent"), "a yes/no fact"),
    ("id_reads_as_other_type", one(score("What kind of issue is `message`?", ["Small", "Medium", "Large"]), qid="issue_type"), "a category, which a Choice answers"),
]


# Near misses each rule must leave alone: (rule, request).
NEAR = [
    # A pair whose descriptions also differ only by a negation is lint-criteria's options_differ_by_negation.
    ("negated_key_pair", one(choice("What happened in `message`?", {"delivered": "Arrived", "not_delivered": "Never arrived", "late": "Arrived late"}))),
    # A key word used in passing is not the Noul's topic.
    ("noul_repeats_choice_option", (STATE, {"team": choice("Which team should handle `message`?", TEAMS),
                                            "costs": noul("Does `message` mention shipping costs?")})),
    # "multiple" beside a count is itself a count.
    ("combined_option", one(choice("How many items does `message` mention?", {"one": "One item", "multiple": "Two or more", "none": "No item"}))),
    # A door threshold is not a confidence bar.
    ("confidence_bar", one(noul("Is the door threshold in `message` damaged?"))),
    # Comparing a field with text in another field is a judgment, not a written value.
    ("field_equality_question", one(noul("Does `order.total` equal the amount in `message`?"))),
    # non_dairy names a positive thing.
    ("negative_id", one(noul("Is the drink in `message` non-dairy?"), qid="non_dairy")),
    # Nothing to be a copy of.
    ("copy_id", one(noul("Is `message` urgent?"), qid="urgent_v2")),
]


class LintGatingTests(pack_tests(lint_gating.PACK, CASES)):
    def test_rules_leave_near_misses_alone(self):
        rules = {feature["id"]: feature["check"] for feature in lint_gating.PACK["features"]}
        for ident, request in NEAR:
            with self.subTest(rule=ident, questions=list(request[1])):
                self.assertEqual(rules[ident](request[0], request[1], set(request[2]) if len(request) > 2 else set()), [])

    def test_rules_leave_ordinary_requests_alone(self):
        for request in QUIET:
            refs = set(request[2]) if len(request) > 2 else set()
            for feature in lint_gating.PACK["features"]:
                with self.subTest(rule=feature["id"], questions=list(request[1])):
                    self.assertEqual(feature["check"](request[0], request[1], refs), [])

    def test_rules_catch_more_forms(self):
        rules = {feature["id"]: feature["check"] for feature in lint_gating.PACK["features"]}
        for ident, request, message in HITS:
            with self.subTest(rule=ident, message=message):
                found = rules[ident](request[0], request[1], set(request[2]) if len(request) > 2 else set())
                self.assertEqual(len(found), 1)
                self.assertRegex(found[0][1], message)

    def test_quiet_on_every_built_in_request(self):
        assert_quiet(self, lint_gating.PACK)

    def test_anchors_are_known_guide_sections(self):
        known = {"#use-structure-in-the-input-state", "#decompose-the-questions", "#use-structure-in-the-questions"}
        self.assertTrue(all(feature["anchor"] in known for feature in lint_gating.PACK["features"]))

    def test_findings_reach_lint_under_lab(self):
        """Through jev.lint.check, the pack's findings land under "lab" with the pack's codes, and the built-in
        findings and counts stay what they are without the pack."""
        from jev import lab
        questions = {"not_spam": noul("Is `message` from a real customer?")}
        saved = lab._PACKS
        try:
            lab._PACKS = []
            bare = lint.check(STATE, questions)
            lab._PACKS = [lint_gating.PACK]  # this pack alone, whatever else jev/lab/packs holds
            report = lint.check(STATE, questions)
        finally:
            lab._PACKS = saved
        self.assertEqual([finding["code"] for finding in report["lab"]["findings"]], ["lint-gating/negative_id"])
        self.assertEqual(report["lab"]["counts"], {"problem": 0, "advice": 1})
        self.assertEqual((report["findings"], report["counts"]), (bare["findings"], bare["counts"]))


if __name__ == "__main__":
    unittest.main()
