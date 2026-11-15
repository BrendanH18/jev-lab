"""Tests for the cli-guidelines Lab pack (jev/lab/packs/cli_guidelines.py): offline labeling-guideline commands.
Fictional Harbor Coffee Co. data only."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_guidelines  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


QUESTIONS = {
    "department": {"type": "choice", "instructions": "Which team should handle the ticket?",
                   "criteria": {"billing": "Charges and refunds", "shipping": "Delivery and damage",
                                "product": {"what": "Beans and gear", "examples": ["Do you sell decaf"]}}},
    "is_urgent": {"type": "noul", "instructions": "Does it need action today?", "criteria": {"true": "Needs action today", "false": "Can wait"}},
    "frustration": {"type": "score", "instructions": "How frustrated is the customer?", "criteria": ["calm", "annoyed", "angry"]},
}
ROWS = [{"text": "Charged twice", "_expect": {"department": "billing"}}, {"text": "Bag torn"},
        {"text": "Held secret note", "_test": True, "_expect": {"department": "product"}}, "Grinder squeals"]
GUIDES = {"department": {"note": "Refunds go to billing.",
                         "examples": [{"input": "Please refund my order", "label": "billing", "why": "Money back"},
                                      {"input": "Box crushed in transit", "label": "shipping"}]},
          "is_urgent": {"note": "Same-day problems only.", "examples": [{"input": "Machine on fire", "label": True}]}}
NEXT = {"department": {"note": "Refunds go to billing.", "examples": [{"input": "Please refund my order", "label": "billing", "why": "Money back"}]},
        "frustration": {"note": "Count angry words."}}
LINT_GUIDES = {"department": {"examples": [{"input": "bag  TORN", "label": "shipping"}, {"input": "Held secret note", "label": "billing"},
                                           {"input": "Please refund", "label": "refunds"}, {"input": "Lost parcel", "label": "shipping"},
                                           {"input": "lost parcel", "label": "product"}]},
               "gone": {"note": "Old question"}, "is_urgent": {}}
OUT, EXISTING = DIR / "guide.md", DIR / "existing.md"
EXISTING.write_text("old\n")


def save(directory):
    workbench.save_dataset({"name": "Support", "questions": QUESTIONS, "rows": ROWS, "guidelines": GUIDES})
    workbench.save_dataset({"name": "Support next", "questions": QUESTIONS, "rows": ROWS, "guidelines": NEXT})
    workbench.save_dataset({"name": "Complete", "questions": {"is_urgent": QUESTIONS["is_urgent"]}, "rows": ["Latte"],
                            "guidelines": {"is_urgent": {"note": "Same-day only.", "examples": [{"input": "Machine on fire", "label": "yes"},
                                                                                                {"input": "Loved the beans", "label": "no"}]}}})
    workbench.save_dataset({"name": "Plain", "rows": ["Latte"]})
    workbench.save_dataset({"name": "Lint me", "questions": QUESTIONS, "rows": ["Bag torn", {"text": "Charged twice", "channel": "email"},
                                                                                {"text": "Held secret note", "_test": True}]})
    dataset = workbench.load_dataset("lint-me")
    dataset["guidelines"] = LINT_GUIDES
    workbench.write_dataset(dataset)


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
        if Path(path).read_text(encoding="utf-8") != expected:
            raise AssertionError(Path(path).read_text(encoding="utf-8"))
    return check


LIST = ["dataset", "questions", "with a note", "with examples", "examples", "without guidelines"]
L_COMPLETE = ["complete", 1, 1, 1, 2, ""]
# Listed in file-name order, as the Workbench lists datasets: "support-next.json" sorts before "support.json".
L_REST = [["lint-me", 3, 0, 1, 5, "frustration"], ["support-next", 3, 2, 1, 1, "is_urgent"], ["support", 3, 2, 2, 3, "frustration"]]
SHOW = ["question", "type", "note", "examples"]
S_DEPT, S_URGENT = ["department", "choice", "Refunds go to billing.", 2], ["is_urgent", "noul", "Same-day problems only.", 1]
EXAMPLES = ["question", "#", "input", "label", "why"]
E_DEPT = [["department", 1, "Please refund my order", "billing", "Money back"], ["department", 2, "Box crushed in transit", "shipping", ""]]
LINT = ["question", "example", "problem"]
LINT_DEPT = [["department", 1, "repeats the input of tuning row 1; examples should be generic, not taken from rows"],
             ["department", 2, "repeats the input of a held-out row; write a generic example instead"],
             ["department", 3, "the label is not a valid answer for this choice question"],
             ["department", 5, "gives the input of example 4 a different label"]]
COVERAGE = ["question", "type", "note", "answers", "with an example", "without an example"]
C_ROWS = [["department", "choice", True, 3, 2, "product"], ["is_urgent", "noul", True, 2, 1, "no"], ["frustration", "score", False, 3, 0, "0, 1, 2"]]
FRUSTRATION_GUIDE = "## frustration (score)\n\nHow frustrated is the customer?\n\nLevels:\n\n- 0: calm\n- 1: annoyed\n- 2: angry\n"
GUIDE = ("# Labeling guide: Support\n\n## department (choice)\n\nWhich team should handle the ticket?\n\nAnswers:\n\n"
         "- `billing`: Charges and refunds\n- `shipping`: Delivery and damage\n- `product`: Beans and gear\n\nNote: Refunds go to billing.\n\n"
         "Examples:\n\n- \"Please refund my order\" is labeled billing (Money back)\n- \"Box crushed in transit\" is labeled shipping\n\n"
         "## is_urgent (noul)\n\nDoes it need action today?\n\nAnswers:\n\n- yes: Needs action today\n- no: Can wait\n\n"
         "Note: Same-day problems only.\n\nExamples:\n\n- \"Machine on fire\" is labeled yes\n\n" + FRUSTRATION_GUIDE)
DIFF = ["question", "status", "note differs", "examples A", "examples B"]
SEARCH = ["dataset", "question", "where", "text"]
SEARCH_ROWS = [["lint-me", "department", "example 3", "Please refund"], ["support-next", "department", "note", "Refunds go to billing."],
               ["support-next", "department", "example 1", "Please refund my order"], ["support", "department", "note", "Refunds go to billing."],
               ["support", "department", "example 1", "Please refund my order"]]
D_ROWS = [["department", "changed", False, 2, 1], ["is_urgent", "removed", True, 1, 0], ["frustration", "added", True, 0, 0]]

CASES = {
    "list": {"argv": ["guidelines", "list"], "setup": save, "stdout": table(LIST, [L_COMPLETE] + L_REST),
             "options": {
                 "missing": {"argv": ["guidelines", "list", "--missing"], "setup": save, "code": 1, "stdout": table(LIST, L_REST)},
                 "format": {"argv": ["guidelines", "list", "--format", "json"], "setup": save,
                            "stdout": same_json([dict(zip(LIST, row)) for row in [L_COMPLETE] + L_REST])}}},
    "show": {"argv": ["guidelines", "show", "support"], "setup": save, "stdout": table(SHOW, [S_DEPT, S_URGENT]),
             "options": {
                 "question": {"argv": ["guidelines", "show", "support", "--question", "is_urgent"], "setup": save, "stdout": table(SHOW, [S_URGENT])},
                 "examples": {"argv": ["guidelines", "show", "support", "--examples"], "setup": save,
                              "stdout": table(EXAMPLES, E_DEPT + [["is_urgent", 1, "Machine on fire", "yes", ""]])},
                 "format": {"argv": ["guidelines", "show", "support", "--examples", "--question", "department", "--format", "json"], "setup": save,
                            "stdout": same_json([dict(zip(EXAMPLES, row)) for row in E_DEPT])}}},
    "lint": {"argv": ["guidelines", "lint", "lint-me"], "setup": save, "code": 1,
             "stdout": table(LINT, LINT_DEPT + [["gone", None, "the dataset has no such question; the next save drops this guideline"],
                                                ["is_urgent", None, "holds neither a note nor an example"]]),
             "options": {
                 "question": {"argv": ["guidelines", "lint", "lint-me", "--question", "department"], "setup": save, "code": 1,
                              "stdout": table(LINT, LINT_DEPT)},
                 "format": {"argv": ["guidelines", "lint", "lint-me", "--question", "is_urgent", "--format", "json"], "setup": save, "code": 1,
                            "stdout": same_json([{"question": "is_urgent", "example": None, "problem": "holds neither a note nor an example"}])}}},
    "coverage": {"argv": ["guidelines", "coverage", "support"], "setup": save, "stdout": table(COVERAGE, C_ROWS),
                 "options": {
                     "missing_only": {"argv": ["guidelines", "coverage", "complete", "--missing-only"], "setup": save,
                                      "stdout": "every answer has a labeling example\n"},
                     "format": {"argv": ["guidelines", "coverage", "support", "--format", "csv"], "setup": save,
                                "stdout": kit.render(COVERAGE, C_ROWS, "csv") + "\n"}}},
    "export": {"argv": ["guidelines", "export", "support"], "setup": save, "stdout": GUIDE,
               "options": {
                   "question": {"argv": ["guidelines", "export", "support", "--question", "frustration"], "setup": save,
                                "stdout": "# Labeling guide: Support\n\n" + FRUSTRATION_GUIDE},
                   "out": {"argv": ["guidelines", "export", "support", "--out", str(OUT)], "setup": save,
                           "stdout": wrote(OUT, "wrote the labeling guide of support to %s\n" % OUT, GUIDE)},
                   "force": {"argv": ["guidelines", "export", "support", "--question", "frustration", "--out", str(EXISTING), "--force"],
                             "setup": save, "stdout": wrote(EXISTING, "wrote the labeling guide of support to %s\n" % EXISTING,
                                                            "# Labeling guide: Support\n\n" + FRUSTRATION_GUIDE)}}},
    "diff": {"argv": ["guidelines", "diff", "support", "support-next"], "setup": save, "code": 1, "stdout": table(DIFF, D_ROWS),
             "options": {
                 "format": {"argv": ["guidelines", "diff", "support", "support-next", "--format", "json"], "setup": save, "code": 1,
                            "stdout": same_json([dict(zip(DIFF, row)) for row in D_ROWS])}}},
    "search": {"argv": ["guidelines", "search", "REFUND"], "setup": save, "code": 1, "stdout": table(SEARCH, SEARCH_ROWS),
               "options": {
                   "dataset": {"argv": ["guidelines", "search", "refund", "--dataset", "support"], "setup": save, "code": 1,
                               "stdout": table(SEARCH, SEARCH_ROWS[3:])},
                   "format": {"argv": ["guidelines", "search", "fire", "--dataset", "complete", "--format", "json"], "setup": save, "code": 1,
                              "stdout": same_json([dict(zip(SEARCH, ["complete", "is_urgent", "example 1", "Machine on fire"]))])}}},
}


class CliGuidelinesTests(pack_tests(cli_guidelines.PACK, CASES)):
    def test_never_shows_held_out_rows_or_notes_in_diff(self):
        _code, out, _err = run_cli(["guidelines", "lint", "lint-me", "--format", "json"], save)
        self.assertNotIn("Held secret", out)
        _code, out, _err = run_cli(["guidelines", "diff", "support", "support-next"], save)
        self.assertNotIn("Same-day", out)
        self.assertNotIn("refund", out)

    def test_quiet_and_usage(self):
        self.assertEqual(run_cli(["guidelines", "lint", "support"], save)[:2], (0, "no problems in the labeling guidelines\n"))
        self.assertEqual(run_cli(["guidelines", "diff", "support", "support"], save)[:2], (0, "same guidelines\n"))
        for argv in (["guidelines", "show", "support", "--question", "nope"], ["guidelines", "export", "support", "--question", "nope"],
                     ["guidelines", "export", "support", "--out", str(EXISTING)], ["guidelines", "show", "no-such"]):
            self.assertEqual(run_cli(argv, save)[0], 2, argv)
