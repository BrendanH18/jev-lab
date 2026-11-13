"""Tests for the cli-questions Lab pack (jev/lab/packs/cli_questions.py): offline commands for question set files."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev import examples, lab  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_questions  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


def write(name, value):
    path = DIR / name
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=1), encoding="utf-8")
    return str(path)


def out(name):
    """A path in the temporary folder that does not exist yet, for --out."""
    return str(DIR / name)


QUESTIONS = {
    "department": {"type": "choice", "instructions": "Which team should handle `message`?",
                   "criteria": {"billing": "Charges and refunds", "shipping": "Delivery problems", "wholesale": "Cafes buying in volume"}},
    "frustration": {"type": "score", "instructions": "How frustrated does the writer of `message` sound?",
                    "criteria": ["Calm", "Frustrated but civil", "Very angry"]},
    "wants_refund": {"type": "noul", "instructions": "Does `message` ask for money back?",
                     "criteria": {"true": "Asks for a refund", "false": "No refund requested"}},
    "big_order": {"type": "noul", "instructions": "Is `order.amount` above a typical order total?"},
}
STATE = {"message": "My order arrived torn. Refund please!", "order": {"id": "HC-1001", "total": 24.5}, "channel": "email"}
REQUEST = {"state": STATE, "questions": QUESTIONS, "expect": {"department": {"choice": "shipping"}, "wants_refund": {"min": 0.7}}}
REQ = write("request.json", REQUEST)
BARE = write("questions.json", QUESTIONS)
STATE_FILE = write("state.json", {"message": "Where is my bag?", "order": {"amount": 24.5}})
BAD = write("bad.json", {"a": {"type": "noul", "instructions": "Fine?"}, "b": {"type": "choice", "instructions": "Pick one", "criteria": {}},
                         "c": {"type": "maybe", "instructions": "Something"}})
EMPTY_STATE = write("empty-state.json", {"state": "", "questions": {"a": {"type": "noul", "instructions": "Fine?"}}})
TRIAGE = examples.get("support-triage")
EXAMPLE = write("triage.json", {"state": TRIAGE["state"], "questions": TRIAGE["questions"]})
PHOTO = write("photo.json", {"state": {"context": "A customer's photo of a delivered order"},
                             "questions": {"spill": {"type": "box", "instructions": "the spilled beans in `photo`"}}})
NEW = write("new.json", {
    "frustration": QUESTIONS["frustration"],
    "department": {"type": "choice", "instructions": "Which team should   handle `message`?",
                   "criteria": {"billing": "Charges and refunds", "shipping": "Late, lost or damaged deliveries", "returns": "Items sent back"}},
    "wants_refund": QUESTIONS["wants_refund"],
    "rush": {"type": "noul", "instructions": "Does `message` ask for faster delivery?"},
})
SMALL_QUESTIONS = {
    "department": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "=Charges", "shipping": "Delivery"}},
    "level": {"type": "score", "instructions": "How upset?", "criteria": ["Calm", {"tone": "angry"}]},
    "photo_box": {"type": "box", "instructions": "the torn seal in `photo`"},
    "rush": {"type": "noul", "instructions": "Rush?", "criteria": {"true": "Asks for speed", "false": None}},
}
SMALL = write("small.json", SMALL_QUESTIONS)
SMALL_CSV = ('"question","type","field","key","text","json"\r\n'
             '"department","choice","instructions","","Which team?",""\r\n'
             '"department","choice","criterion","billing","\'=Charges",""\r\n'
             '"department","choice","criterion","shipping","Delivery",""\r\n'
             '"level","score","instructions","","How upset?",""\r\n'
             '"level","score","criterion","0","Calm",""\r\n'
             '"level","score","criterion","1","{""tone"": ""angry""}","yes"\r\n'
             '"photo_box","box","instructions","","the torn seal in `photo`",""\r\n'
             '"rush","noul","instructions","","Rush?",""\r\n'
             '"rush","noul","criterion","true","Asks for speed",""\r\n'
             '"rush","noul","criterion","false","null","yes"\r\n')
CSV_FILE = write("small.csv", SMALL_CSV)
EXISTING = write("existing.json", "{}")
EXISTING_RENAME = write("existing-rename.json", "{}")

LINT_FIXTURE = kit.define_pack({
    "id": "fixture-lint", "surface": "python.lint", "title": "Fixture lint rule",
    "features": [{"id": "starts_with_w", "kind": "lint_rule", "level": "advice", "title": "Ids that start with w",
                  "check": lambda state, questions, refs: [(qid, "Fixture: %s starts with w." % qid) for qid in questions if qid.startswith("w")]}],
})

MISSING = "`order.amount` is not in the state, so the model cannot see what this question points at. Add the field, or fix the path."
NOUL = "Say what a yes means and what a no means, in true and false criteria, with examples of each."


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def ordered(text):
    return json.loads(text, object_pairs_hook=lambda pairs: [list(pair) for pair in pairs])


def same_json(expected):
    def check(text):
        if ordered(text) != ordered(json.dumps(expected)):
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


def finding_rows(expected):
    """The first four cells (source, level, code, question) of each row of a lint table."""
    def check(text):
        got = [line.split()[:4] for line in text.splitlines()[2:]]
        if got != expected:
            raise AssertionError("got %r, expected %r" % (got, expected))
    return check


def file_is(path, expected_text, stdout):
    def check(text):
        if text != stdout:
            raise AssertionError("stdout %r != %r" % (text, stdout))
        written = Path(path).read_bytes().decode("utf-8")
        if written != expected_text:
            raise AssertionError("file %r != %r" % (written, expected_text))
    return check


def file_json(path, expected, stdout):
    def check(text):
        if text != stdout:
            raise AssertionError("stdout %r != %r" % (text, stdout))
        same_json(expected)(Path(path).read_text(encoding="utf-8"))
    return check


OUTLINE_COLUMNS = ["#", "id", "type", "criteria", "words"]
OUTLINE = [[1, "department", "choice", 3, 5], [2, "frustration", "score", 3, 8], [3, "wants_refund", "noul", 2, 6], [4, "big_order", "noul", 0, 7]]
RENAMED = {"state": STATE, "questions": {"team": QUESTIONS["department"], "frustration": QUESTIONS["frustration"],
                                         "wants_refund": QUESTIONS["wants_refund"], "big_order": QUESTIONS["big_order"]},
           "expect": {"team": {"choice": "shipping"}, "wants_refund": {"min": 0.7}}}
MARKDOWN_FULL = """## 1. `department` (choice)

Which team?

- `billing`: =Charges
- `shipping`: Delivery

## 2. `level` (score)

How upset?

- `0`: Calm
- `1`: `{"tone": "angry"}`

## 3. `photo_box` (box)

the torn seal in `photo`

## 4. `rush` (noul)

Rush?

- `true`: Asks for speed
- `false`: (no description)
"""
MARKDOWN_TABLE = """| # | id | type | criteria | instructions |
| --- | --- | --- | --- | --- |
| 1 | department | choice | 2 | Which team? |
| 2 | level | score | 2 | How upset? |
| 3 | photo_box | box | 0 | the torn seal in `photo` |
| 4 | rush | noul | 1 | Rush? |
"""
DIFF_COLUMNS = ["change", "question", "detail"]
B_ERROR = "Question 'b': choice criteria must be an object of option -> description"
C_ERROR = "Question 'c': type must be noul, choice, score, or box"

CASES = {
    "outline": {"argv": ["questions", "outline", REQ], "stdout": table(OUTLINE_COLUMNS, OUTLINE), "options": {
        "type": {"argv": ["questions", "outline", BARE, "--type", "noul"], "stdout": table(OUTLINE_COLUMNS, OUTLINE[2:])},
        "criteria": {"argv": ["questions", "outline", REQ, "--criteria"], "stdout": table(["question", "type", "key", "words"], [
            ["department", "choice", "billing", 3], ["department", "choice", "shipping", 2], ["department", "choice", "wholesale", 4],
            ["frustration", "score", "0", 1], ["frustration", "score", "1", 3], ["frustration", "score", "2", 2],
            ["wants_refund", "noul", "true", 4], ["wants_refund", "noul", "false", 3]])},
        "sort": {"argv": ["questions", "outline", REQ, "--sort", "words"], "stdout": table(OUTLINE_COLUMNS, [OUTLINE[1], OUTLINE[3], OUTLINE[2], OUTLINE[0]])},
        "format": {"argv": ["questions", "outline", REQ, "--format", "json"], "stdout": same_json([dict(zip(OUTLINE_COLUMNS, row)) for row in OUTLINE])},
    }},
    "validate": {"argv": ["questions", "validate", BAD], "code": 1, "stdout": "invalid: %s\n" % B_ERROR, "options": {
        "state": {"argv": ["questions", "validate", EMPTY_STATE, "--state"], "code": 1, "stdout": "invalid: state is required\n"},
        "all": {"argv": ["questions", "validate", BAD, "--all"], "code": 1, "stdout": "invalid: %s\ninvalid: %s\n" % (B_ERROR, C_ERROR)},
        "quiet": {"argv": ["questions", "validate", BAD, "--quiet"], "code": 1, "stdout": ""},
        "format": {"argv": ["questions", "validate", REQ, "--format", "json"], "stdout": "[]\n"},
    }},
    "lint": {"argv": ["questions", "lint", REQ], "code": 1, "stdout": finding_rows([
        ["built-in", "problem", "missing_path", "big_order"], ["built-in", "advice", "noul_criteria", "big_order"],
        ["lab", "advice", "fixture-lint/starts_with_w", "wants_refund"]]), "options": {
        "state": {"argv": ["questions", "lint", BARE, "--state", STATE_FILE], "stdout": finding_rows([
            ["built-in", "advice", "noul_criteria", "big_order"], ["lab", "advice", "fixture-lint/starts_with_w", "wants_refund"]])},
        "picture": {"argv": ["questions", "lint", PHOTO, "--picture", "photo"], "stdout": "no findings\n"},
        "level": {"argv": ["questions", "lint", REQ, "--level", "problem"], "code": 1, "stdout": finding_rows([["built-in", "problem", "missing_path", "big_order"]])},
        "no_lab": {"argv": ["questions", "lint", REQ, "--no-lab"], "code": 1, "stdout": finding_rows([
            ["built-in", "problem", "missing_path", "big_order"], ["built-in", "advice", "noul_criteria", "big_order"]])},
        "strict": {"argv": ["questions", "lint", EXAMPLE, "--strict"], "code": 1, "stdout": finding_rows([["built-in", "advice", "noul_criteria", "is_urgent"]])},
        "format": {"argv": ["questions", "lint", REQ, "--format", "json"], "code": 1, "stdout": same_json([
            {"source": "built-in", "level": "problem", "code": "missing_path", "question": "big_order", "message": MISSING},
            {"source": "built-in", "level": "advice", "code": "noul_criteria", "question": "big_order", "message": NOUL},
            {"source": "lab", "level": "advice", "code": "fixture-lint/starts_with_w", "question": "wants_refund", "message": "Fixture: wants_refund starts with w."}])},
    }},
    "stats": {"argv": ["questions", "stats", REQ], "stdout": table(["metric", "value"], [
        ["questions", 4], ["noul", 2], ["choice", 1], ["score", 1], ["box", 0], ["criteria", 8], ["choice options", 3], ["score levels", 3],
        ["instruction words", 26], ["mean words", 6.5], ["longest", "frustration (8 words)"]]), "options": {
        "by_type": {"argv": ["questions", "stats", REQ, "--by-type"], "stdout": table(["type", "questions", "criteria", "words"], [
            ["noul", 2, 2, 13], ["choice", 1, 3, 5], ["score", 1, 3, 8]])},
        "words_over": {"argv": ["questions", "stats", REQ, "--words-over", "6"], "code": 1, "stdout": table(["question", "type", "words"], [
            ["frustration", "score", 8], ["big_order", "noul", 7]])},
        "format": {"argv": ["questions", "stats", BARE, "--format", "csv"], "stdout": kit.csv_text([["metric", "value"], ["questions", 4], ["noul", 2], ["choice", 1],
                   ["score", 1], ["box", 0], ["criteria", 8], ["choice options", 3], ["score levels", 3], ["instruction words", 26], ["mean words", 6.5],
                   ["longest", "frustration (8 words)"]]).rstrip("\r\n") + "\n"},
    }},
    # department and frustration swap places: one move explains the new order, and the later one (frustration) is reported.
    "diff": {"argv": ["questions", "diff", REQ, NEW], "code": 1, "stdout": table(DIFF_COLUMNS, [
        ["instructions", "department", "changed"], ["criteria", "department", "+returns, -wholesale, ~shipping"],
        ["moved", "frustration", "position 2 -> 1"], ["removed", "big_order", "noul"], ["added", "rush", "noul"]]), "options": {
        "ignore_order": {"argv": ["questions", "diff", REQ, NEW, "--ignore-order"], "code": 1, "stdout": table(DIFF_COLUMNS, [
            ["instructions", "department", "changed"], ["criteria", "department", "+returns, -wholesale, ~shipping"],
            ["removed", "big_order", "noul"], ["added", "rush", "noul"]])},
        "ignore_whitespace": {"argv": ["questions", "diff", REQ, NEW, "--ignore-whitespace"], "code": 1, "stdout": table(DIFF_COLUMNS, [
            ["criteria", "department", "+returns, -wholesale, ~shipping"],
            ["moved", "frustration", "position 2 -> 1"], ["removed", "big_order", "noul"], ["added", "rush", "noul"]])},
        "criteria": {"argv": ["questions", "diff", REQ, NEW, "--criteria", "--ignore-order"], "code": 1, "stdout": table(DIFF_COLUMNS, [
            ["instructions", "department", "changed"], ["criterion", "department", "returns: added"], ["criterion", "department", "wholesale: removed"],
            ["criterion", "department", "shipping: changed"], ["removed", "big_order", "noul"], ["added", "rush", "noul"]])},
        "stat": {"argv": ["questions", "diff", REQ, NEW, "--stat"], "code": 1, "stdout": table(["change", "questions"], [
            ["added", 1], ["removed", 1], ["changed", 1], ["moved", 1]])},
        "format": {"argv": ["questions", "diff", BARE, REQ, "--format", "json"], "stdout": "[]\n"},
    }},
    "to_csv": {"argv": ["questions", "to-csv", SMALL], "stdout": SMALL_CSV, "options": {
        "out": {"argv": ["questions", "to-csv", SMALL, "--out", out("to.csv")], "stdout": file_is(out("to.csv"), SMALL_CSV, "wrote 4 questions to %s\n" % out("to.csv"))},
    }},
    "from_csv": {"argv": ["questions", "from-csv", CSV_FILE], "stdout": same_json(SMALL_QUESTIONS), "options": {
        "out": {"argv": ["questions", "from-csv", CSV_FILE, "--out", out("from.json")],
                "stdout": file_json(out("from.json"), SMALL_QUESTIONS, "wrote 4 questions to %s\n" % out("from.json"))},
        "force": {"argv": ["questions", "from-csv", CSV_FILE, "--out", EXISTING, "--force"],
                  "stdout": file_json(EXISTING, SMALL_QUESTIONS, "wrote 4 questions to %s\n" % EXISTING)},
    }},
    "to_markdown": {"argv": ["questions", "to-markdown", SMALL], "stdout": MARKDOWN_TABLE, "options": {
        "full": {"argv": ["questions", "to-markdown", SMALL, "--full"], "stdout": MARKDOWN_FULL},
        "out": {"argv": ["questions", "to-markdown", SMALL, "--out", out("small.md")],
                "stdout": file_is(out("small.md"), MARKDOWN_TABLE, "wrote 4 questions to %s\n" % out("small.md"))},
    }},
    "rename": {"argv": ["questions", "rename", REQ, "department", "team"], "stdout": same_json(RENAMED), "options": {
        "out": {"argv": ["questions", "rename", REQ, "department", "team", "--out", out("renamed.json")],
                "stdout": file_json(out("renamed.json"), RENAMED, "wrote %s (renamed department to team)\n" % out("renamed.json"))},
        "force": {"argv": ["questions", "rename", REQ, "department", "team", "--out", EXISTING_RENAME, "--force"],
                  "stdout": file_json(EXISTING_RENAME, RENAMED, "wrote %s (renamed department to team)\n" % EXISTING_RENAME)},
    }},
    "pick": {"argv": ["questions", "pick", REQ, "big_order", "department"], "stdout": same_json({
        "state": STATE, "questions": {"department": QUESTIONS["department"], "big_order": QUESTIONS["big_order"]},
        "expect": {"department": {"choice": "shipping"}}}), "options": {
        "exclude": {"argv": ["questions", "pick", REQ, "big_order", "department", "--exclude"], "stdout": same_json({
            "state": STATE, "questions": {"frustration": QUESTIONS["frustration"], "wants_refund": QUESTIONS["wants_refund"]},
            "expect": {"wants_refund": {"min": 0.7}}})},
        "out": {"argv": ["questions", "pick", BARE, "wants_refund", "--out", out("picked.json")],
                "stdout": file_json(out("picked.json"), {"wants_refund": QUESTIONS["wants_refund"]}, "wrote 1 question to %s\n" % out("picked.json"))},
    }},
    "fields": {"argv": ["questions", "fields", REQ], "stdout": table(["field", "kind", "questions", "named by"], [
        ["message", "text", 3, "department, frustration, wants_refund"], ["order", "object", 1, "big_order"], ["channel", "text", 0, ""]]), "options": {
        "unused": {"argv": ["questions", "fields", REQ, "--unused"], "code": 1, "stdout": table(["field", "kind", "questions", "named by"], [["channel", "text", 0, ""]])},
        "format": {"argv": ["questions", "fields", REQ, "--format", "json"], "stdout": same_json([
            {"field": "message", "kind": "text", "questions": 3, "named by": "department, frustration, wants_refund"},
            {"field": "order", "kind": "object", "questions": 1, "named by": "big_order"},
            {"field": "channel", "kind": "text", "questions": 0, "named by": ""}])},
    }},
}


class CliQuestionsTests(pack_tests(cli_questions.PACK, CASES)):
    """The pack's commands run with only this pack and a fixture lint rule registered, so other packs' findings
    cannot change what these cases expect."""

    @classmethod
    def setUpClass(cls):
        cls.saved = lab._PACKS
        lab._PACKS = [cli_questions.PACK, LINT_FIXTURE]

    @classmethod
    def tearDownClass(cls):
        lab._PACKS = cls.saved

    def test_out_never_replaces_a_file_without_force(self):
        from labkit import run_cli
        code, stdout, err = run_cli(["questions", "to-csv", SMALL, "--out", BARE])
        self.assertEqual((code, stdout), (2, ""))
        self.assertIn("already exists", err)
        self.assertEqual(json.loads(Path(BARE).read_text()), QUESTIONS)

    def test_csv_round_trip_keeps_every_example(self):
        for example in examples.EXAMPLES:
            rows = [cli_questions.CSV_COLUMNS] + cli_questions._csv_rows(example["questions"])
            back = cli_questions.questions_from_csv(kit.csv_text(rows))
            self.assertEqual(json.dumps(back), json.dumps(example["questions"]), example["id"])

    def test_bad_rename_exits_two(self):
        from labkit import run_cli
        self.assertEqual(run_cli(["questions", "rename", REQ, "department", "frustration"])[0], 2)
        self.assertEqual(run_cli(["questions", "rename", REQ, "nope", "x"])[0], 2)
        # An expectation already kept under the new id would be overwritten by the moved one.
        orphan = write("orphan-expect.json", dict(REQUEST, expect={"department": {"choice": "billing"}, "team": {"min": 0.2}}))
        code, stdout, err = run_cli(["questions", "rename", orphan, "department", "team"])
        self.assertEqual((code, stdout), (2, ""))
        self.assertIn("already has an expectation for 'team'", err)

    def test_diff_reports_only_the_question_that_moved(self):
        from labkit import run_cli
        q = {"type": "noul", "instructions": "Fine?"}
        before = write("rotate-before.json", {"a": q, "b": q, "c": q, "d": q})
        after = write("rotate-after.json", {"b": q, "c": q, "d": q, "a": q})
        self.assertEqual(run_cli(["questions", "diff", before, after])[:2], (1, table(DIFF_COLUMNS, [["moved", "a", "position 1 -> 4"]])))

    def test_diff_reports_reordered_options_with_criteria(self):
        from labkit import run_cli
        flipped = write("flipped.json", dict(QUESTIONS, department=dict(QUESTIONS["department"], criteria={
            "wholesale": "Cafes buying in volume", "billing": "Charges and refunds", "shipping": "Delivery problems"})))
        self.assertEqual(run_cli(["questions", "diff", BARE, flipped, "--criteria"])[:2],
                         (1, table(DIFF_COLUMNS, [["criteria", "department", "options reordered"]])))

    def test_lint_without_a_state_skips_paths_and_says_so(self):
        from labkit import run_cli
        code, stdout, err = run_cli(["questions", "lint", BARE, "--no-lab"])
        self.assertEqual(code, 0)
        self.assertNotIn("missing_path", stdout)
        self.assertIn("noul_criteria", stdout)
        self.assertIn("has no state, so backticked paths were not checked", err)

    def test_csv_keeps_choice_keys_exactly(self):
        spaced = {"tone": {"type": "choice", "instructions": "Tone?", "criteria": {"calm": "Calm", " calm": "Calm, with a space"}}}
        rows = [cli_questions.CSV_COLUMNS] + cli_questions._csv_rows(spaced)
        self.assertEqual(list(cli_questions.questions_from_csv(kit.csv_text(rows))["tone"]["criteria"]), ["calm", " calm"])
