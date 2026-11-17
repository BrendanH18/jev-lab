"""Lab pack lint-scale: one test per question check on cost per row and on what survives CSV handoffs, rules and
exported gates, and a check that no rule reports on any built-in request."""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from lablint_corpus import assert_quiet  # noqa: E402
from jev import lint  # noqa: E402
from jev.lab.packs import lint_scale  # noqa: E402

STATE = {"subject": "Bag torn", "body": "My bag of beans arrived torn."}


def noul(text):
    return {"type": "noul", "instructions": text, "criteria": {"true": "A clear case", "false": "No sign of it"}}


def choice(criteria, text="Which team handles `body`?"):
    return {"type": "choice", "instructions": text, "criteria": criteria}


TEAMS = {"billing": "Charges and refunds", "shipping": "Delivery problems"}


def words(count):
    return " ".join(["beans"] * (count - 3)) + " in `body`?"


CASES = {
    "empty_option_key": {
        "hit": (STATE, {"team": choice({"": "Unsure", "billing": "Charges"})}),
        "miss": (STATE, {"team": choice(TEAMS)}),
        "question": "team",
        "message": re.compile(r"^`team` has an option with an empty key"),
    },
    "spreadsheet_rewritten_keys": {
        "hit": (
            STATE,
            {
                "answer": choice(
                    {
                        "true": "Agrees",
                        "007": "Agent code",
                        "1/2": "Half",
                        "1e5": "Large",
                        "=x": "Formula",
                        "other": "Else",
                    }
                )
            },
        ),
        "miss": (STATE, {"day": choice({"1": "First", "2": "Second", "not_stated": "No day given"})}),
        "question": "answer",
        "message": re.compile(
            r"^A spreadsheet rewrites option keys when it opens a Review or labeling CSV: `true` becomes TRUE or FALSE; "
            r"`007` loses its leading zero; `1/2` becomes a date; `1e5` becomes a number in scientific notation; "
            r"`=x` gets a leading apostrophe so it is not run as a formula, and"
        ),
    },
    "long_option_key": {
        "hit": (
            STATE,
            {
                "team": choice(
                    {"billing_and_refunds_for_wholesale_orders_only": "Wholesale money", "shipping": "Parcels"}
                )
            },
        ),
        "miss": (
            STATE,
            {"team": choice({"billing_and_refunds_for_wholesale": "Wholesale money", "shipping": "Parcels"})},
        ),
        "question": "team",
        "message": re.compile(r"^`billing_and_refunds_for_wholesale_orders_only` is over 40 characters"),
    },
    "long_question_id": {
        "hit": (STATE, {"does_the_customer_want_money_back_for_beans": noul("Does `body` ask for money back?")}),
        "miss": (STATE, {"does_the_customer_want_money_back": noul("Does `body` ask for money back?")}),
        "question": "does_the_customer_want_money_back_for_beans",
        "message": re.compile(r"is 43 characters"),
    },
    "many_questions": {
        "hit": (STATE, {"check_%02d" % i: noul("Does `body` mention item %d?" % i) for i in range(31)}),
        "miss": (STATE, {"check_%02d" % i: noul("Does `body` mention item %d?" % i) for i in range(30)}),
        "question": None,
        "message": re.compile(r"^The request asks 31 questions\."),
    },
    "wordy_request": {
        "hit": (
            STATE,
            {"long_one": noul(words(800)), "long_two": noul(words(796)), "short": noul("Is `body` urgent?")},
        ),
        "miss": (STATE, {"long_one": noul(words(700)), "long_two": noul(words(700))}),
        "question": None,
        "message": re.compile(
            r"^The questions' instructions and criteria add up to 1,6\d\d words, sent with every row\. "
            r"The longest are `long_one`, `long_two`, `short`\.$"
        ),
    },
    "similar_question_ids": {
        "hit": (
            STATE,
            {"refund": noul("Does `body` ask for a refund?"), "refunds": noul("Does `body` ask for several refunds?")},
        ),
        "miss": (
            STATE,
            {"refund": noul("Does `body` ask for a refund?"), "refund_amount": noul("Does `body` name an amount?")},
        ),
        "question": "refund",
        "message": re.compile(r"^`refund`, `refunds` differ only by a plural ending"),
    },
    "same_instructions": {
        "hit": (
            STATE,
            {
                "urgent": noul("Is `body` urgent?"),
                "urgency": {
                    "type": "score",
                    "instructions": "Is `body` urgent?",
                    "criteria": ["Not at all", "Somewhat", "Very"],
                },
            },
        ),
        "miss": (STATE, {"urgent": noul("Is `body` urgent?"), "urgent_copy": noul("Is `body` urgent?")}),
        "question": "urgent",
        "message": re.compile(r"^`urgent`, `urgency` have the same instructions with different types or criteria"),
    },
}


class LintScaleTests(pack_tests(lint_scale.PACK, CASES)):
    def test_quiet_on_built_in_requests(self):
        assert_quiet(self, lint_scale.PACK)

    def test_findings_reach_the_lint_report(self):
        report = lint.check(
            STATE, {"refund": noul("Does `body` ask for a refund?"), "refunds": noul("Does `body` ask for refunds?")}
        )
        codes = [item["code"] for item in report["lab"]["findings"]]
        self.assertIn("lint-scale/similar_question_ids", codes)


if __name__ == "__main__":
    unittest.main()
