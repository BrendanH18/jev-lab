"""Tests for the cli-tests Lab pack (jev/lab/packs/cli_tests.py): offline commands for saved Workbench tests."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import lab  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_tests  # noqa: E402

DEPARTMENT_2 = {"type": "choice", "instructions": "Which team should handle this?",
                "criteria": {"billing": "Charges and refunds", "shipping": "Delivery problems"}}
DEPARTMENT_3 = {"type": "choice", "instructions": "Which team should handle this?",
                "criteria": {"billing": "Charges and refunds", "shipping": "Delivery problems", "wholesale": "Cafes buying in volume"}}
T1_STATE = "Hi, my order HC-1001 arrived torn — please refund me today."
T2_STATE = {"message": "Third late delivery this month. We are a cafe and this is costing us.", "account": {"tier": "wholesale"}}
T3_STATE = {"photo": "photo-torn-bag", "context": "A customer's photo of a delivered order"}
TESTS = [
    {"id": "refund-request", "name": "Refund request", "notes": "", "state": T1_STATE, "saved_at": "2026-03-02T10:00:00Z",
     "questions": {"department": DEPARTMENT_2,
                   "is_urgent": {"type": "noul", "instructions": "Does the message need attention today?"},
                   "wants_refund": {"type": "noul", "instructions": "Does the writer ask for money back?",
                                    "criteria": {"true": "Asks for a refund", "false": "No refund requested"}}},
     "expect": {"department": {"choice": "billing"}, "wants_refund": {"min": 0.7}}},
    {"id": "angry-wholesale", "name": "Angry wholesale buyer", "notes": "", "state": T2_STATE, "saved_at": "2026-03-05T09:30:00Z",
     "questions": {"department": DEPARTMENT_3,
                   "frustration": {"type": "score", "instructions": "How frustrated does `customer.message` sound?", "criteria": ["Calm", "Frustrated", "Angry"]}},
     "expect": {"department": {"choice": "wholesale"}, "frustration": {"min": 2.5}}},
    {"id": "bag-photo", "name": "Torn bag photo", "notes": "", "state": T3_STATE, "saved_at": "2026-02-20T08:00:00Z",
     "images": {"photo-torn-bag": {"sample": "torn-bag"}},
     "questions": {"is_urgent": {"type": "noul", "instructions": "does the message need attention  today?"},
                   "spill_box": {"type": "box", "instructions": "the spilled beans in `photo`"},
                   "frustration": {"type": "noul", "instructions": "Does the customer sound upset?"}},
     "expect": {}},
]
HAND_EDITED = {"id": "hand-edited", "name": "Hand edited", "state": "A note", "saved_at": "2026-01-01T00:00:00Z",
               "questions": {"tone": {"type": "choice", "instructions": "Tone?", "criteria": {"calm": "Calm", "angry": "Angry"}},
                             "urgent": {"type": "noul", "instructions": "Urgent?"},
                             "where": {"type": "box", "instructions": "the note"},
                             "level": {"type": "score", "instructions": "Level?", "criteria": ["Low", "Mid", "High"]}},
               "expect": {"tone": {"choice": "furious"}, "urgent": {"choice": "yes"},
                          "where": {"box": {"left": 0.6, "top": 0.1, "right": 0.4, "bottom": 0.5}},
                          "level": {"min": 1.5, "max": 1}, "gone": {"min": 0.5}}}


LINT_FIXTURE = kit.define_pack({
    "id": "fixture-tests-lint", "surface": "python.lint", "title": "Fixture lint rule",
    "features": [{"id": "wants_ids", "kind": "lint_rule", "level": "advice", "title": "Ids that start with wants",
                  "check": lambda state, questions, refs: [(qid, "Fixture: %s starts with wants." % qid) for qid in questions
                                                           if qid.startswith("wants")]}],
})


def suite(directory, extra=()):
    for item in TESTS + list(extra):
        (directory / ("%s.json" % item["id"])).write_text(json.dumps(item, indent=2))


def with_hand_edited(directory):
    suite(directory, [HAND_EDITED])


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


def records(columns, rows):
    return [dict(zip(columns, row)) for row in rows]


# UTF-8 sizes worked out by hand: T1 is 59 characters with one 3-byte em dash; T2 and T3 as compact JSON are
# {"message":"Third late ... costing us.","account":{"tier":"wholesale"}} and {"photo":"photo-torn-bag","context":"..."}.
T1_BYTES, T2_BYTES, T3_BYTES = 61, 114, 78


LIST = ["id", "name", "questions", "expected", "types", "saved"]
ANGRY = ["angry-wholesale", "Angry wholesale buyer", 2, 2, "1 choice, 1 score", "2026-03-05T09:30:00Z"]
BAG = ["bag-photo", "Torn bag photo", 3, 0, "2 noul, 1 box", "2026-02-20T08:00:00Z"]
REFUND = ["refund-request", "Refund request", 3, 2, "2 noul, 1 choice", "2026-03-02T10:00:00Z"]
SHOW = ["#", "question", "type", "criteria", "words", "expected"]
SHOW_HEADER = "Refund request (refund-request)\nstate: text, 61 bytes\npictures: none\n\n"
SHOW_ROWS = [[1, "department", "choice", 2, 5, "choice = billing"], [2, "is_urgent", "noul", 0, 6, ""], [3, "wants_refund", "noul", 2, 7, ">= 0.7"]]
COVERAGE = ["id", "questions", "expected", "missing", "coverage %"]
CONFLICTS = ["question", "definitions", "tests", "difference"]
INVENTORY = ["question", "types", "tests", "expected", "definitions"]
INV = {"department": ["department", "choice", 2, 2, 2], "frustration": ["frustration", "noul, score", 2, 1, 2],
       "is_urgent": ["is_urgent", "noul", 2, 0, 2], "spill_box": ["spill_box", "box", 1, 0, 1], "wants_refund": ["wants_refund", "noul", 1, 1, 1]}
FIND = ["test", "question", "type", "matched"]
STATES = ["id", "kind", "bytes", "fields"]
LINT = ["test", "source", "level", "code", "question", "message"]
MISSING = "`customer.message` is not in the state, so the model cannot see what this question points at. Add the field, or fix the path."
NOUL = "Say what a yes means and what a no means, in true and false criteria, with examples of each."
LINT_ROWS = [["angry-wholesale", "built-in", "problem", "missing_path", "frustration", MISSING],
             ["bag-photo", "built-in", "advice", "noul_criteria", "is_urgent", NOUL],
             ["bag-photo", "built-in", "advice", "noul_criteria", "frustration", NOUL],
             ["refund-request", "built-in", "advice", "noul_criteria", "is_urgent", NOUL]]
SUMMARY = [["tests", 3], ["questions", 8], ["distinct question ids", 5], ["noul", 4], ["choice", 2], ["score", 1], ["box", 1],
           ["expectations", 4], ["coverage %", 50], ["tests with pictures", 1], ["text states", 1], ["object states", 2]]
EXPECTATION_PROBLEMS = [
    ["angry-wholesale", "frustration", "min 2.5 is above the highest possible value, 2, so it can never pass"],
    ["hand-edited", "tone", "expects the choice 'furious', which is not one of the question's options"],
    ["hand-edited", "urgent", "expects a choice, but the question is a noul"],
    ["hand-edited", "where", "the box has no area: left must be below right and top below bottom"],
    ["hand-edited", "level", "min 1.5 is above max 1, so it can never pass"],
    ["hand-edited", "gone", "names no question in this test"]]

CASES = {
    "list": {"argv": ["tests", "list"], "setup": suite, "stdout": table(LIST, [ANGRY, BAG, REFUND]), "options": {
        "sort": {"argv": ["tests", "list", "--sort", "saved"], "setup": suite, "stdout": table(LIST, [ANGRY, REFUND, BAG])},
        "reverse": {"argv": ["tests", "list", "--reverse"], "setup": suite, "stdout": table(LIST, [REFUND, BAG, ANGRY])},
        "type": {"argv": ["tests", "list", "--type", "box"], "setup": suite, "stdout": table(LIST, [BAG])},
        "min_questions": {"argv": ["tests", "list", "--min-questions", "3"], "setup": suite, "stdout": table(LIST, [BAG, REFUND])},
        "uncovered": {"argv": ["tests", "list", "--uncovered"], "setup": suite, "stdout": table(LIST, [BAG, REFUND])},
        "name": {"argv": ["tests", "list", "--name", "REFUND"], "setup": suite, "stdout": table(LIST, [REFUND])},
        "limit": {"argv": ["tests", "list", "--limit", "1"], "setup": suite, "stdout": table(LIST, [ANGRY])},
        "format": {"argv": ["tests", "list", "--format", "json"], "setup": suite, "stdout": same_json(records(LIST, [ANGRY, BAG, REFUND]))},
    }},
    "show": {"argv": ["tests", "show", "refund-request"], "setup": suite, "stdout": SHOW_HEADER + table(SHOW, SHOW_ROWS), "options": {
        "type": {"argv": ["tests", "show", "refund-request", "--type", "noul"], "setup": suite, "stdout": SHOW_HEADER + table(SHOW, SHOW_ROWS[1:])},
        "criteria": {"argv": ["tests", "show", "refund-request", "--criteria"], "setup": suite, "stdout": SHOW_HEADER + table(
            ["question", "type", "key", "words"], [["department", "choice", "billing", 3], ["department", "choice", "shipping", 2],
                                                   ["wants_refund", "noul", "true", 4], ["wants_refund", "noul", "false", 3]])},
        "format": {"argv": ["tests", "show", "bag-photo", "--format", "json"], "setup": suite, "stdout": same_json(records(SHOW, [
            [1, "is_urgent", "noul", 0, 6, ""], [2, "spill_box", "box", 0, 5, ""], [3, "frustration", "noul", 0, 5, ""]]))},
    }},
    "coverage": {"argv": ["tests", "coverage"], "setup": suite, "stdout": table(COVERAGE, [
        ["angry-wholesale", 2, 2, "", 100], ["bag-photo", 3, 0, "is_urgent, spill_box, frustration", 0], ["refund-request", 3, 2, "is_urgent", 67]]), "options": {
        # refund-request covers 2 of 3 questions, 66.7%: under 67 although it prints as 67.
        "below": {"argv": ["tests", "coverage", "--below", "67"], "setup": suite, "code": 1, "stdout": table(COVERAGE, [
            ["bag-photo", 3, 0, "is_urgent, spill_box, frustration", 0], ["refund-request", 3, 2, "is_urgent", 67]])},
        "missing": {"argv": ["tests", "coverage", "--missing"], "setup": suite, "stdout": table(["test", "question", "type"], [
            ["bag-photo", "is_urgent", "noul"], ["bag-photo", "spill_box", "box"], ["bag-photo", "frustration", "noul"], ["refund-request", "is_urgent", "noul"]])},
        "type": {"argv": ["tests", "coverage", "--type", "choice"], "setup": suite, "stdout": table(COVERAGE, [
            ["angry-wholesale", 1, 1, "", 100], ["refund-request", 1, 1, "", 100]])},
        "format": {"argv": ["tests", "coverage", "--format", "csv"], "setup": suite, "stdout": kit.csv_text([COVERAGE,
            ["angry-wholesale", 2, 2, "", 100], ["bag-photo", 3, 0, "is_urgent, spill_box, frustration", 0], ["refund-request", 3, 2, "is_urgent", 67]]).rstrip("\r\n") + "\n"},
    }},
    "expectations": {"argv": ["tests", "expectations"], "setup": with_hand_edited, "code": 1,
                     "stdout": table(["test", "question", "problem"], EXPECTATION_PROBLEMS), "options": {
        "test": {"argv": ["tests", "expectations", "--test", "refund-request"], "setup": with_hand_edited, "stdout": "no expectation problems\n"},
        "format": {"argv": ["tests", "expectations", "--format", "json"], "setup": suite, "code": 1,
                   "stdout": same_json(records(["test", "question", "problem"], EXPECTATION_PROBLEMS[:1]))},
    }},
    "conflicts": {"argv": ["tests", "conflicts"], "setup": suite, "code": 1, "stdout": table(CONFLICTS, [
        ["department", 2, "angry-wholesale / refund-request", "criteria"], ["frustration", 2, "angry-wholesale / bag-photo", "type"],
        ["is_urgent", 2, "bag-photo / refund-request", "instructions"]]), "options": {
        "types_only": {"argv": ["tests", "conflicts", "--types-only"], "setup": suite, "code": 1, "stdout": table(CONFLICTS, [
            ["frustration", 2, "angry-wholesale / bag-photo", "type"]])},
        "normalize": {"argv": ["tests", "conflicts", "--normalize"], "setup": suite, "code": 1, "stdout": table(CONFLICTS, [
            ["department", 2, "angry-wholesale / refund-request", "criteria"], ["frustration", 2, "angry-wholesale / bag-photo", "type"]])},
        "detail": {"argv": ["tests", "conflicts", "--detail"], "setup": suite, "code": 1, "stdout": table(
            ["question", "definition", "test", "type", "criteria", "words"], [
                ["department", 1, "angry-wholesale", "choice", 3, 5], ["department", 2, "refund-request", "choice", 2, 5],
                ["frustration", 1, "angry-wholesale", "score", 3, 5], ["frustration", 2, "bag-photo", "noul", 0, 5],
                ["is_urgent", 1, "bag-photo", "noul", 0, 6], ["is_urgent", 2, "refund-request", "noul", 0, 6]])},
        "format": {"argv": ["tests", "conflicts", "--format", "json", "--types-only"], "setup": suite, "code": 1,
                   "stdout": same_json(records(CONFLICTS, [["frustration", 2, "angry-wholesale / bag-photo", "type"]]))},
    }},
    "inventory": {"argv": ["tests", "inventory"], "setup": suite, "stdout": table(INVENTORY, list(INV.values())), "options": {
        "sort": {"argv": ["tests", "inventory", "--sort", "expected"], "setup": suite, "stdout": table(INVENTORY, [
            INV["department"], INV["frustration"], INV["wants_refund"], INV["is_urgent"], INV["spill_box"]])},
        "min_tests": {"argv": ["tests", "inventory", "--min-tests", "2"], "setup": suite, "stdout": table(INVENTORY, [
            INV["department"], INV["frustration"], INV["is_urgent"]])},
        "type": {"argv": ["tests", "inventory", "--type", "noul"], "setup": suite, "stdout": table(INVENTORY, [
            INV["frustration"], INV["is_urgent"], INV["wants_refund"]])},
        "unexpected": {"argv": ["tests", "inventory", "--unexpected"], "setup": suite, "stdout": table(INVENTORY, [INV["is_urgent"], INV["spill_box"]])},
        "format": {"argv": ["tests", "inventory", "--format", "json"], "setup": suite, "stdout": same_json(records(INVENTORY, list(INV.values())))},
    }},
    "find": {"argv": ["tests", "find", "refund"], "setup": suite, "stdout": table(FIND, [
        ["angry-wholesale", "department", "choice", "criteria"], ["refund-request", "department", "choice", "criteria"],
        ["refund-request", "wants_refund", "noul", "id, criteria"]]), "options": {
        "where": {"argv": ["tests", "find", "today", "--in", "instructions"], "setup": suite, "stdout": table(FIND, [
            ["bag-photo", "is_urgent", "noul", "instructions"], ["refund-request", "is_urgent", "noul", "instructions"]])},
        "case_sensitive": {"argv": ["tests", "find", "Does", "--case-sensitive"], "setup": suite, "stdout": table(FIND, [
            ["bag-photo", "frustration", "noul", "instructions"], ["refund-request", "is_urgent", "noul", "instructions"],
            ["refund-request", "wants_refund", "noul", "instructions"]])},
        "regex": {"argv": ["tests", "find", "^(is|wants)_", "--regex"], "setup": suite, "stdout": table(FIND, [
            ["bag-photo", "is_urgent", "noul", "id"], ["refund-request", "is_urgent", "noul", "id"], ["refund-request", "wants_refund", "noul", "id"]])},
        "tests_only": {"argv": ["tests", "find", "refund", "--tests-only"], "setup": suite, "stdout": table(["test", "questions"], [
            ["angry-wholesale", 1], ["refund-request", 2]])},
        "format": {"argv": ["tests", "find", "spill", "--format", "json"], "setup": suite, "stdout": same_json([
            {"test": "bag-photo", "question": "spill_box", "type": "box", "matched": "id, instructions"}])},
    }},
    "summary": {"argv": ["tests", "summary"], "setup": suite, "stdout": table(["metric", "value"], SUMMARY), "options": {
        "format": {"argv": ["tests", "summary", "--format", "json"], "setup": suite, "stdout": same_json(records(["metric", "value"], SUMMARY))},
    }},
    "states": {"argv": ["tests", "states"], "setup": suite, "stdout": table(STATES, [
        ["angry-wholesale", "object", T2_BYTES, "message, account"], ["bag-photo", "object", T3_BYTES, "photo, context"],
        ["refund-request", "text", T1_BYTES, ""]]), "options": {
        "field": {"argv": ["tests", "states", "--field", "photo"], "setup": suite, "stdout": table(STATES, [["bag-photo", "object", T3_BYTES, "photo, context"]])},
        "kind": {"argv": ["tests", "states", "--kind", "text"], "setup": suite, "stdout": table(STATES, [["refund-request", "text", T1_BYTES, ""]])},
        "format": {"argv": ["tests", "states", "--kind", "text", "--format", "csv"], "setup": suite,
                   "stdout": '"id","kind","bytes","fields"\r\n"refund-request","text","%d",""\n' % T1_BYTES},
    }},
    "lint": {"argv": ["tests", "lint", "--format", "markdown"], "setup": suite, "code": 1, "stdout": kit.markdown_table(LINT, LINT_ROWS) + "\n", "options": {
        "level": {"argv": ["tests", "lint", "--level", "advice", "--format", "json"], "setup": suite, "stdout": same_json(records(LINT, LINT_ROWS[1:]))},
        "summary": {"argv": ["tests", "lint", "--summary"], "setup": suite, "code": 1, "stdout": table(["test", "problems", "advice"], [
            ["angry-wholesale", 1, 0], ["bag-photo", 0, 2], ["refund-request", 0, 1]])},
        "format": {"argv": ["tests", "lint", "--format", "json"], "setup": suite, "code": 1, "stdout": same_json(records(LINT, LINT_ROWS))},
    }},
}


class CliTestsTests(pack_tests(cli_tests.PACK, CASES)):
    """The pack's commands run with only this pack registered, so other packs' question checks cannot change what the
    lint cases expect."""

    @classmethod
    def setUpClass(cls):
        cls.saved = lab._PACKS
        lab._PACKS = [cli_tests.PACK]

    @classmethod
    def tearDownClass(cls):
        lab._PACKS = cls.saved

    def test_lint_reports_lab_findings_under_lab(self):
        lab._PACKS = [cli_tests.PACK, LINT_FIXTURE]
        try:
            code, out, _err = run_cli(["tests", "lint", "--level", "advice", "--format", "json"], suite)
        finally:
            lab._PACKS = [cli_tests.PACK]
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), records(LINT, LINT_ROWS[1:] + [
            ["refund-request", "lab", "advice", "fixture-tests-lint/wants_ids", "wants_refund", "Fixture: wants_refund starts with wants."]]))

    def test_name_matches_the_id_or_the_name_never_text_across_both(self):
        # "refund-request" + "Refund request" would read "...request refund..." if they were joined.
        self.assertEqual(run_cli(["tests", "list", "--name", "request refund"], suite)[:2], (0, "no saved tests match\n"))

    def test_odd_expectations_are_reported_without_crashing(self):
        odd = {"id": "odd", "name": "Odd", "state": "x", "saved_at": "2026-01-02T00:00:00Z",
               "questions": {"pick": {"type": "choice", "instructions": "Pick?", "criteria": {"a": "A"}},
                             "lvl": {"type": "score", "instructions": "Level?", "criteria": 5},
                             "spot": {"type": "box", "instructions": "the spot"},
                             "yes": {"type": "noul", "instructions": "Yes?"},
                             "no": {"type": "noul", "instructions": "No?"}},
               "expect": {"pick": {"choice": ["a"]}, "lvl": {"min": 3}, "yes": {"min": "0.9"}, "no": {"max": "low"},
                          "spot": {"box": {"left": 0.1, "top": 0.1, "right": 0.5, "bottom": 0.5}, "iou_min": 1.5}}}
        code, out, err = run_cli(["tests", "expectations", "--test", "odd", "--format", "json"],
                                 lambda directory: (directory / "odd.json").write_text(json.dumps(odd)))
        self.assertEqual((code, err), (1, ""))
        self.assertEqual(json.loads(out), records(["test", "question", "problem"], [
            ["odd", "pick", "expects the choice ['a'], which is not one of the question's options"],
            ["odd", "no", "max is not a number"],
            ["odd", "spot", "iou_min 1.5 is above 1, the highest overlap, so it can never pass"]]))

    def test_missing_test_exits_two_and_an_empty_suite_says_so(self):
        code, _out, err = run_cli(["tests", "show", "no-such-test"], suite)
        self.assertEqual(code, 2)
        self.assertIn("No saved item", err)
        self.assertEqual(run_cli(["tests", "list"])[:2], (0, "no saved tests match\n"))

