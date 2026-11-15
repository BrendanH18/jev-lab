"""Tests for the cli-labels Lab pack (jev/lab/packs/cli_labels.py): offline commands over human tuning labels.
Fictional Harbor Coffee Co. data only."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_labels  # noqa: E402

QUESTIONS = {"team": {"type": "choice", "instructions": "Which team handles it?",
                      "criteria": {"billing": "Money", "shipping": "Parcels", "product": "Beans and gear"}},
             "urgent": {"type": "noul", "instructions": "Is it urgent?"},
             "mood": {"type": "score", "instructions": "How upset is the customer?", "criteria": ["calm", "annoyed", "angry"]}}
TICKETS = [
    {"text": "Charged twice", "channel": "email", "_expect": {"team": "billing", "urgent": True, "mood": 2}},
    {"text": "Refund please", "channel": "email", "_expect": {"team": "billing", "urgent": False}},
    {"text": "Bag torn", "channel": "chat", "_expect": {"team": "shipping", "urgent": True, "mood": 1}},
    {"text": "Box crushed", "channel": "chat", "_expect": {"team": "shipping", "urgent": "yes"}},
    {"text": "Decaf?", "channel": "email", "_expect": {"team": "product"}},
    {"text": "Held secret", "channel": "fax", "_test": True, "_expect": {"team": "product", "urgent": True}},
    "Grinder squeals",
    {"text": "Bad label", "channel": "chat", "_expect": {"team": "refunds", "urgent": False}},
]
OTHER = [
    {"text": "Charged twice", "channel": "email", "_expect": {"team": "billing", "urgent": False}},
    {"text": "Refund please", "channel": "email", "_expect": {"team": "billing", "urgent": False}},
    {"text": "Bag torn", "channel": "chat", "_expect": {"team": "product", "urgent": True}},
    {"text": "Box crushed", "channel": "chat", "_expect": {"team": "shipping"}},
    {"text": "Held secret", "channel": "fax", "_test": True, "_expect": {"team": "billing"}},
    {"text": "New one", "_expect": {"team": "billing"}},
]


def save(directory):
    workbench.save_dataset({"name": "Tickets", "questions": QUESTIONS, "rows": TICKETS})
    workbench.save_dataset({"name": "Other", "questions": QUESTIONS, "rows": OTHER})


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


CROSS = ["team \\ urgent", "yes", "no", "total"]
HEADER = "team (rows) by urgent (columns) on 4 tuning rows labeled for both\n"
BY_FIELD = ["channel", "labeled rows", "billing", "shipping", "product", "most common"]
EMAIL, CHAT = ["email", 3, 2, 0, 1, "billing"], ["chat", 2, 0, 2, 0, "shipping"]
AGREE = ["question", "shared inputs", "agreed", "agreement", "kappa"]
# team: 3 of 4 agree; chance agreement .5 * .5 + .5 * .25 = .375, so kappa (.75 - .375) / .625 = .6.
# urgent: 2 of 3 agree; chance (2/3)(1/3) + (1/3)(2/3) = 4/9, so kappa (6/9 - 4/9) / (5/9) = .4.
A_TEAM, A_URGENT, A_MOOD = ["team", 4, 3, 0.75, 0.6], ["urgent", 3, 2, 0.666667, 0.4], ["mood", 0, 0, None, None]
MISSING = ["row", "missing", "input"]
M_ROWS = [[2, "mood", '{"channel": "email", "text": "Refund please"}'], [4, "mood", '{"channel": "chat", "text": "Box crushed"}'],
          [5, "urgent, mood", '{"channel": "email", "text": "Decaf?"}'], [7, "team, urgent, mood", "Grinder squeals"],
          [8, "team, mood", '{"channel": "chat", "text": "Bad label"}']]

CASES = {
    "crosstab": {"argv": ["labels", "crosstab", "tickets", "team", "urgent"], "setup": save,
                 "stdout": HEADER + table(CROSS, [["billing", 1, 1, 2], ["shipping", 2, 0, 2], ["product", 0, 0, 0]]),
                 "options": {
                     "shares": {"argv": ["labels", "crosstab", "tickets", "team", "urgent", "--shares"], "setup": save,
                                "stdout": HEADER + table(CROSS, [["billing", 0.5, 0.5, 2], ["shipping", 1.0, 0.0, 2], ["product", None, None, 0]])},
                     "format": {"argv": ["labels", "crosstab", "tickets", "team", "urgent", "--format", "json"], "setup": save,
                                "stdout": same_json([dict(zip(CROSS, row)) for row in [["billing", 1, 1, 2], ["shipping", 2, 0, 2], ["product", 0, 0, 0]]])}}},
    "by_field": {"argv": ["labels", "by-field", "tickets", "team", "--field", "channel"], "setup": save, "stdout": table(BY_FIELD, [EMAIL, CHAT]),
                 "options": {
                     "min_rows": {"argv": ["labels", "by-field", "tickets", "team", "--field", "channel", "--min-rows", "3"], "setup": save,
                                  "stdout": table(BY_FIELD, [EMAIL])},
                     "format": {"argv": ["labels", "by-field", "tickets", "team", "--field", "channel", "--format", "csv"], "setup": save,
                                "stdout": kit.render(BY_FIELD, [EMAIL, CHAT], "csv") + "\n"}}},
    "agree": {"argv": ["labels", "agree", "tickets", "other"], "setup": save, "stdout": table(AGREE, [A_TEAM, A_URGENT, A_MOOD]),
              "options": {
                  "question": {"argv": ["labels", "agree", "tickets", "other", "--question", "urgent"], "setup": save, "stdout": table(AGREE, [A_URGENT])},
                  "min_agreement": {"argv": ["labels", "agree", "tickets", "other", "--min-agreement", "0.7"], "setup": save, "code": 1,
                                    "stdout": table(AGREE, [A_TEAM, A_URGENT, A_MOOD])},
                  "format": {"argv": ["labels", "agree", "tickets", "other", "--question", "team", "--format", "json"], "setup": save,
                             "stdout": same_json([dict(zip(AGREE, A_TEAM))])}}},
    "missing": {"argv": ["labels", "missing", "tickets"], "setup": save, "stdout": table(MISSING, M_ROWS),
                "options": {
                    "question": {"argv": ["labels", "missing", "tickets", "--question", "urgent"], "setup": save,
                                 "stdout": table(MISSING, [[5, "urgent", M_ROWS[2][2]], [7, "urgent", "Grinder squeals"]])},
                    "limit": {"argv": ["labels", "missing", "tickets", "--limit", "2"], "setup": save, "stdout": table(MISSING, M_ROWS[:2])},
                    "export": {"argv": ["labels", "missing", "tickets", "--question", "urgent", "--export"], "setup": save,
                               "stdout": '{"text": "Decaf?", "channel": "email"}\n{"text": "Grinder squeals"}\n'},
                    "format": {"argv": ["labels", "missing", "tickets", "--limit", "1", "--format", "json"], "setup": save,
                               "stdout": same_json([dict(zip(MISSING, M_ROWS[0]))])}}},
}


class CliLabelsTests(pack_tests(cli_labels.PACK, CASES)):
    def test_held_out_rows_never_read(self):
        for argv in (["labels", "missing", "tickets", "--export"], ["labels", "by-field", "tickets", "team", "--field", "channel"],
                     ["labels", "agree", "tickets", "other", "--format", "json"]):
            out = run_cli(argv, save)[1]
            self.assertNotIn("Held secret", out)
            self.assertNotIn("fax", out)

    def test_kappa_matches_hand_counts(self):
        self.assertAlmostEqual(cli_labels.kappa([("a", "a"), ("a", "a"), ("b", "c"), ("b", "b")]), 0.6)
        self.assertIsNone(cli_labels.kappa([("a", "a"), ("a", "a")]))
        self.assertIsNone(cli_labels.kappa([]))

    def test_usage_errors_exit_two(self):
        for argv in (["labels", "crosstab", "tickets", "team", "nope"], ["labels", "by-field", "tickets", "team", "--field", "_expect"],
                     ["labels", "agree", "tickets", "other", "--question", "nope"], ["labels", "missing", "no-such"]):
            self.assertEqual(run_cli(argv, save)[0], 2, argv)
