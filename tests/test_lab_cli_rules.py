"""Tests for the cli-rules Lab pack (jev/lab/packs/cli_rules.py): offline tools for consistency rules.
Fictional Harbor Coffee Co. data only."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import checks, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_rules  # noqa: E402

QUESTIONS = {
    "wants_refund": {"type": "noul", "instructions": "Does the customer want money back?"},
    "department": {
        "type": "choice",
        "instructions": "Which team should handle it?",
        "criteria": {"billing": "Charges", "shipping": "Parcels", "product": "Beans and gear"},
    },
    "frustration": {
        "type": "score",
        "instructions": "How frustrated is the customer?",
        "criteria": ["calm", "annoyed", "angry"],
    },
}
R1 = "if wants_refund = yes then department in billing, shipping"
R2 = "if frustration >= 2 then wants_refund = yes"
R3 = "if department = product then wants_refund = no"
R4 = "if frustration >= 2 then frustration >= 1"
ROWS = [
    {"text": "Refund my torn bag", "_expect": {"wants_refund": True, "department": "shipping", "frustration": 2}},
    {"text": "Charged twice", "_expect": {"wants_refund": "yes", "department": "billing", "frustration": 1}},
    {"text": "Do you sell decaf", "_expect": {"wants_refund": False, "department": "product", "frustration": 0}},
    {"text": "Money back for beans", "_expect": {"wants_refund": True, "department": "product", "frustration": 2}},
    {"text": "Angry about delay", "_expect": {"wants_refund": False, "department": "shipping", "frustration": 2}},
    "Grinder squeals",
    {
        "text": "Held secret",
        "_test": True,
        "_expect": {"wants_refund": True, "department": "product", "frustration": 2},
    },
    {"text": "Refund partial", "_expect": {"wants_refund": True, "department": "billing"}},
]
DRAFT = "\n".join(
    [
        R1,
        "# a comment",
        "if department = billing then wants_refund in yes, no",
        "if wants_refund = yes then department in shipping, billing",
        "if department = billing and department = shipping then frustration >= 1",
        "if department = product then department != product",
        "if mood = calm then department = billing",
        "department must be billing",
        "if department = refunds then wants_refund = yes",
        "if wants_refund = yes then department > 0",
    ]
)


def save(directory):
    workbench.save_dataset({"name": "Refunds", "questions": QUESTIONS, "rows": ROWS, "rules": R1 + "\n" + R2})
    checks.save_check(
        "refunds",
        {"gates": {"wants_refund": 0.8}, "model": "jev-1.14.0", "min_accuracy": 0.9, "rules": "\n".join([R1, R3, R4])},
    )
    workbench.save_dataset({"name": "Plain", "questions": QUESTIONS, "rows": ["Latte please"]})


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))

    return check


LIST = ["line", "if", "then", "questions"]
L1 = [1, "wants_refund = yes", "department in billing, shipping", "wants_refund, department"]
LINT = ["line", "rule", "problem"]
NEVER_BREAKS = "can never be broken: whenever the if part holds, the then part holds too"
LABELS = ["line", "rule", "labeled rows", "applies", "labels break it"]
SUGGEST = ["rule", "labeled rows", "saved"]
S_FRUSTRATION = ["if frustration = 2 then department in shipping, product", 3, False]
S_REFUND = ["if wants_refund = yes then frustration in 1, 2", 3, False]
COMPARE = ["rule", "in dataset", "in check"]
QUESTION_COLUMNS = ["question", "type", "rules reading it in if", "rules reading it in then", "labeled tuning rows"]

CASES = {
    "list": {
        "argv": ["rules", "list", "refunds"],
        "setup": save,
        "stdout": table(LIST, [L1, [2, "frustration >= 2", "wants_refund = yes", "frustration, wants_refund"]]),
        "options": {
            "check": {
                "argv": ["rules", "list", "refunds", "--check"],
                "setup": save,
                "stdout": table(
                    LIST,
                    [
                        L1,
                        [2, "department = product", "wants_refund = no", "department, wants_refund"],
                        [3, "frustration >= 2", "frustration >= 1", "frustration"],
                    ],
                ),
            },
            "format": {
                "argv": ["rules", "list", "refunds", "--format", "json"],
                "setup": save,
                "stdout": same_json(
                    [
                        dict(zip(LIST, L1)),
                        dict(zip(LIST, [2, "frustration >= 2", "wants_refund = yes", "frustration, wants_refund"])),
                    ]
                ),
            },
        },
    },
    "lint": {
        "argv": ["rules", "lint", "refunds"],
        "setup": save,
        "stdout": "2 rules, no problems\n",
        "options": {
            "check": {
                "argv": ["rules", "lint", "refunds", "--check"],
                "setup": save,
                "code": 1,
                "stdout": table(LINT, [[3, R4, NEVER_BREAKS]]),
            },
            "text": {
                "argv": ["rules", "lint", "refunds", "--text", DRAFT],
                "setup": save,
                "code": 1,
                "stdout": table(
                    LINT,
                    [
                        [3, "if department = billing then wants_refund in yes, no", NEVER_BREAKS],
                        [4, "if wants_refund = yes then department in shipping, billing", "repeats the rule on line 1"],
                        [
                            5,
                            "if department = billing and department = shipping then frustration >= 1",
                            "never applies: its if conditions cannot all hold at once",
                        ],
                        [
                            6,
                            "if department = product then department != product",
                            "is broken by every row it applies to: department != product cannot hold when the if part does",
                        ],
                        [
                            7,
                            "if mood = calm then department = billing",
                            "'mood' is not a Choice, Noul, or Score question here",
                        ],
                        [8, "department must be billing", "write it as `if <condition> then <condition>`"],
                        [
                            9,
                            "if department = refunds then wants_refund = yes",
                            "'department' cannot answer 'refunds'; it answers billing, shipping, product",
                        ],
                        [
                            10,
                            "if wants_refund = yes then department > 0",
                            "> compares levels, so it needs a Score question; 'department' is a choice",
                        ],
                    ],
                ),
            },
            "format": {
                "argv": ["rules", "lint", "refunds", "--check", "--format", "json"],
                "setup": save,
                "code": 1,
                "stdout": same_json([{"line": 3, "rule": R4, "problem": NEVER_BREAKS}]),
            },
        },
    },
    "labels": {
        "argv": ["rules", "labels", "refunds"],
        "setup": save,
        "code": 1,
        "stdout": table(LABELS, [[1, R1, 6, 4, 1], [2, R2, 5, 3, 1]]),
        "options": {
            "check": {
                "argv": ["rules", "labels", "refunds", "--check"],
                "setup": save,
                "code": 1,
                "stdout": table(LABELS, [[1, R1, 6, 4, 1], [2, R3, 6, 2, 1], [3, R4, 5, 3, 0]]),
            },
            "text": {
                "argv": ["rules", "labels", "refunds", "--text", "if department = billing then frustration >= 1"],
                "setup": save,
                "stdout": table(LABELS, [[1, "if department = billing then frustration >= 1", 5, 1, 0]]),
            },
            "rows": {
                "argv": ["rules", "labels", "refunds", "--rows"],
                "setup": save,
                "code": 1,
                "stdout": table(LABELS + ["rows"], [[1, R1, 6, 4, 1, "4"], [2, R2, 5, 3, 1, "5"]]),
            },
            "format": {
                "argv": ["rules", "labels", "refunds", "--format", "csv"],
                "setup": save,
                "code": 1,
                "stdout": kit.render(LABELS, [[1, R1, 6, 4, 1], [2, R2, 5, 3, 1]], "csv") + "\n",
            },
        },
    },
    "suggest": {
        "argv": ["rules", "suggest", "refunds"],
        "setup": save,
        "stdout": "no rule holds on 5 or more labeled tuning rows\n",
        "options": {
            "min_rows": {
                "argv": ["rules", "suggest", "refunds", "--min-rows", "3"],
                "setup": save,
                "stdout": table(SUGGEST, [S_FRUSTRATION, S_REFUND]),
            },
            "question": {
                "argv": ["rules", "suggest", "refunds", "--min-rows", "3", "--question", "wants_refund"],
                "setup": save,
                "stdout": table(SUGGEST, [S_REFUND]),
            },
            "format": {
                "argv": [
                    "rules",
                    "suggest",
                    "refunds",
                    "--min-rows",
                    "3",
                    "--question",
                    "frustration",
                    "--format",
                    "json",
                ],
                "setup": save,
                "stdout": same_json([dict(zip(SUGGEST, S_FRUSTRATION))]),
            },
        },
    },
    "compare": {
        "argv": ["rules", "compare", "refunds"],
        "setup": save,
        "code": 1,
        "stdout": table(COMPARE, [[R1, True, True], [R2, True, False], [R3, False, True], [R4, False, True]]),
        "options": {
            "format": {
                "argv": ["rules", "compare", "refunds", "--format", "json"],
                "setup": save,
                "code": 1,
                "stdout": same_json(
                    [
                        dict(zip(COMPARE, row))
                        for row in [[R1, True, True], [R2, True, False], [R3, False, True], [R4, False, True]]
                    ]
                ),
            }
        },
    },
    "questions": {
        "argv": ["rules", "questions", "refunds"],
        "setup": save,
        "stdout": table(
            QUESTION_COLUMNS,
            [["wants_refund", "noul", 1, 1, 6], ["department", "choice", 0, 1, 6], ["frustration", "score", 1, 0, 5]],
        ),
        "options": {
            "check": {
                "argv": ["rules", "questions", "refunds", "--check"],
                "setup": save,
                "stdout": table(
                    QUESTION_COLUMNS,
                    [
                        ["wants_refund", "noul", 1, 1, 6],
                        ["department", "choice", 1, 1, 6],
                        ["frustration", "score", 1, 1, 5],
                    ],
                ),
            },
            "format": {
                "argv": ["rules", "questions", "refunds", "--format", "json"],
                "setup": save,
                "stdout": same_json(
                    [
                        dict(zip(QUESTION_COLUMNS, row))
                        for row in [
                            ["wants_refund", "noul", 1, 1, 6],
                            ["department", "choice", 0, 1, 6],
                            ["frustration", "score", 1, 0, 5],
                        ]
                    ]
                ),
            },
        },
    },
}


class CliRulesTests(pack_tests(cli_rules.PACK, CASES)):
    def test_held_out_labels_never_counted(self):
        # The held-out row would break R1 (a refund for product); it is never read.
        code, out, _err = run_cli(["rules", "labels", "refunds", "--rows", "--format", "json"], save)
        self.assertEqual(json.loads(out)[0]["rows"], "4")
        self.assertNotIn("Held secret", out)

    def test_suggestions_marked_saved(self):
        code, out, _err = run_cli(
            ["rules", "suggest", "refunds", "--min-rows", "1", "--question", "department", "--format", "json"], save
        )
        saved = {item["rule"]: item["saved"] for item in json.loads(out)}
        self.assertEqual(code, 0)
        self.assertIs(
            saved.get("if department = product then wants_refund = no"), None
        )  # product rows disagree: no rule
        self.assertIs(saved["if department = billing then wants_refund = yes"], False)

        def more(directory):
            save(directory)
            workbench.save_dataset(
                {
                    "name": "Refunds two",
                    "questions": QUESTIONS,
                    "rows": ROWS,
                    "rules": "if department = billing then wants_refund = true",
                }
            )

        code, out, _err = run_cli(
            ["rules", "suggest", "refunds-two", "--min-rows", "1", "--question", "department", "--format", "json"], more
        )
        saved = {item["rule"]: item["saved"] for item in json.loads(out)}
        self.assertIs(saved["if department = billing then wants_refund = yes"], True)

    def test_empty_and_usage(self):
        self.assertEqual(run_cli(["rules", "list", "plain"], save)[:2], (0, "the dataset has no rules\n"))
        self.assertEqual(run_cli(["rules", "lint", "plain"], save)[:2], (0, "0 rules, no problems\n"))
        for argv in (
            ["rules", "list", "plain", "--check"],
            ["rules", "compare", "plain"],
            ["rules", "labels", "refunds", "--text", "nonsense"],
            ["rules", "suggest", "refunds", "--question", "nope"],
            ["rules", "suggest", "refunds", "--min-rows", "0"],
        ):
            self.assertEqual(run_cli(argv, save)[0], 2, argv)
