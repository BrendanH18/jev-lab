"""Tests for the cli-question-tools Lab pack (jev/lab/packs/cli_question_tools.py): more question set commands.
Fictional Harbor Coffee Co. data only."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_question_tools  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


DEPARTMENT = {
    "type": "choice",
    "instructions": "Which team handles `text`?",
    "criteria": {"billing": "Charges and refunds", "shipping": {"what": "Parcels", "examples": ["Bag torn"]}},
}
URGENT = {
    "type": "noul",
    "instructions": "Is `text` urgent?",
    "criteria": {"true": "Needs action today", "false": "Can wait"},
}
WHERE = {"type": "box", "instructions": "The damage in `photo`"}
MOOD = {"type": "score", "instructions": "How upset is `text`?", "criteria": ["calm", "annoyed", "angry"]}
Q1 = {"department": DEPARTMENT, "urgent": URGENT, "where": WHERE}
Q2 = {"state": {"text": "Bag torn"}, "questions": {"urgent": URGENT, "mood": MOOD}, "expect": {"urgent": {"min": 0.5}}}
Q3 = {"urgent": dict(URGENT, instructions="Does `text` need a reply today?")}
Q4 = {"shield.urgent": URGENT, "shield.mood": MOOD}
FILES = {}
for name, data in (("q1", Q1), ("q2", Q2), ("q3", Q3), ("q4", Q4)):
    FILES[name] = DIR / ("%s.json" % name)
    FILES[name].write_text(json.dumps(data))
MERGED, PREFIXED, SCHEMA_OUT, EXISTING = (
    DIR / "merged.json",
    DIR / "prefixed.json",
    DIR / "schema.json",
    DIR / "existing.json",
)
EXISTING.write_text("old\n")


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))

    return check


def wrote(path, message, expected):
    def check(text):
        if text != message:
            raise AssertionError(text)
        same_json(expected)(Path(path).read_text())

    return check


MERGED_QUESTIONS = {"department": DEPARTMENT, "urgent": URGENT, "where": WHERE, "mood": MOOD}
PREFIXED_REQUEST = {
    "state": {"text": "Bag torn"},
    "questions": {"shield.urgent": URGENT, "shield.mood": MOOD},
    "expect": {"shield.urgent": {"min": 0.5}},
}
ANSWERS = ["question", "type", "label", "meaning"]
A_URGENT = [["urgent", "noul", "yes", "Needs action today"], ["urgent", "noul", "no", "Can wait"]]
A_Q1 = (
    [["department", "choice", "billing", "Charges and refunds"], ["department", "choice", "shipping", "Parcels"]]
    + A_URGENT
    + [["where", "box", "a box", "left, top, right and bottom edges as fractions of the picture"]]
)
A_MOOD = [["mood", "score", "0", "calm"], ["mood", "score", "1", "annoyed"], ["mood", "score", "2", "angry"]]


def nullable(kind, schema):
    return {"description": "%s question" % kind, "anyOf": [schema, {"type": "null"}]}


EDGE = {"type": "number", "minimum": 0, "maximum": 1}
SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Workbench labels (_expect)",
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "department": nullable("Choice", {"enum": ["billing", "shipping"]}),
        "urgent": nullable("Noul", {"type": "boolean"}),
        "where": nullable(
            "Box",
            {
                "type": "object",
                "required": ["left", "top", "right", "bottom"],
                "additionalProperties": False,
                "properties": {"left": EDGE, "top": EDGE, "right": EDGE, "bottom": EDGE},
            },
        ),
    },
}

CASES = {
    "merge": {
        "argv": ["questions", "merge", FILES["q1"], FILES["q2"]],
        "stdout": same_json(MERGED_QUESTIONS),
        "options": {
            "out": {
                "argv": ["questions", "merge", FILES["q1"], FILES["q2"], "--out", MERGED],
                "stdout": wrote(MERGED, "wrote %s (4 questions)\n" % MERGED, MERGED_QUESTIONS),
            },
            "force": {
                "argv": ["questions", "merge", FILES["q2"], FILES["q1"], "--out", EXISTING, "--force"],
                "stdout": wrote(
                    EXISTING,
                    "wrote %s (4 questions)\n" % EXISTING,
                    {"urgent": URGENT, "mood": MOOD, "department": DEPARTMENT, "where": WHERE},
                ),
            },
        },
    },
    "prefix": {
        "argv": ["questions", "prefix", FILES["q2"], "shield."],
        "stdout": same_json(PREFIXED_REQUEST),
        "options": {
            "strip": {
                "argv": ["questions", "prefix", FILES["q4"], "shield.", "--strip"],
                "stdout": same_json({"urgent": URGENT, "mood": MOOD}),
            },
            "out": {
                "argv": ["questions", "prefix", FILES["q2"], "shield.", "--out", PREFIXED],
                "stdout": wrote(PREFIXED, "wrote %s (added 'shield.' to 2 ids)\n" % PREFIXED, PREFIXED_REQUEST),
            },
        },
    },
    "answers": {
        "argv": ["questions", "answers", FILES["q1"]],
        "stdout": table(ANSWERS, A_Q1),
        "options": {
            "question": {
                "argv": ["questions", "answers", FILES["q1"], "--question", "urgent"],
                "stdout": table(ANSWERS, A_URGENT),
            },
            "format": {
                "argv": ["questions", "answers", FILES["q2"], "--format", "csv"],
                "stdout": kit.render(ANSWERS, A_URGENT + A_MOOD, "csv") + "\n",
            },
        },
    },
    "schema": {
        "argv": ["questions", "schema", FILES["q1"]],
        "stdout": same_json(SCHEMA),
        "options": {
            "out": {
                "argv": ["questions", "schema", FILES["q1"], "--out", SCHEMA_OUT],
                "stdout": wrote(SCHEMA_OUT, "wrote %s (a label schema)\n" % SCHEMA_OUT, SCHEMA),
            }
        },
    },
}


class CliQuestionToolsTests(pack_tests(cli_question_tools.PACK, CASES)):
    def test_merge_conflicts_exit_one_without_writing(self):
        target = DIR / "never.json"
        code, out, _err = run_cli(["questions", "merge", FILES["q1"], FILES["q3"], "--out", target])
        self.assertEqual(code, 1)
        self.assertEqual(out, "conflict: urgent is defined differently in %s and a later file\n" % FILES["q1"])
        self.assertFalse(target.exists())

    def test_merge_compares_choice_option_order_but_not_field_order(self):
        reversed_options = DIR / "reversed.json"
        reversed_options.write_text(
            json.dumps({"department": dict(DEPARTMENT, criteria=dict(reversed(list(DEPARTMENT["criteria"].items()))))})
        )
        code, out, _err = run_cli(["questions", "merge", FILES["q1"], reversed_options])
        self.assertEqual(
            (code, out), (1, "conflict: department is defined differently in %s and a later file\n" % FILES["q1"])
        )
        reordered_fields = DIR / "reordered.json"
        reordered_fields.write_text(json.dumps({"department": dict(reversed(list(DEPARTMENT.items())))}))
        code, out, _err = run_cli(["questions", "merge", FILES["q1"], reordered_fields])
        self.assertEqual(code, 0)
        self.assertEqual(list(json.loads(out)["department"]["criteria"]), ["billing", "shipping"])

    def test_schema_accepts_a_labeled_row(self):
        properties = cli_question_tools.schema({"urgent": URGENT, "mood": MOOD})["properties"]
        self.assertEqual(properties["mood"]["anyOf"][0], {"type": "integer", "minimum": 0, "maximum": 2})

    def test_usage_errors_exit_two(self):
        for argv in (
            ["questions", "merge", FILES["q1"]],
            ["questions", "prefix", FILES["q2"], "shield.", "--strip"],
            ["questions", "prefix", FILES["q2"], "bad prefix"],
            ["questions", "answers", FILES["q1"], "--question", "nope"],
            ["questions", "merge", FILES["q1"], FILES["q2"], "--out", EXISTING],
        ):
            self.assertEqual(run_cli(argv)[0], 2, argv)
