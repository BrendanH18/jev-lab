"""Tests for the cli-examples Lab pack (jev/lab/packs/cli_examples.py): offline commands for the built-in examples."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import examples, lab, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_examples  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)
EXISTING = DIR / "existing.json"
EXISTING.write_text("{}")


def tearDownModule():
    TMP.cleanup()


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


def wrote(path, expected, example_id):
    def check(text):
        if text != "wrote %s to %s\n" % (example_id, path):
            raise AssertionError(text)
        same_json(expected)(Path(path).read_text(encoding="utf-8"))
    return check


def first_column(expected):
    def check(text):
        got = [line.split()[0] for line in text.splitlines()[2:]]
        if got != expected:
            raise AssertionError("got %r, expected %r" % (got, expected))
    return check


TRIAGE, PHOTO = examples.get("support-triage"), examples.get("photo-locate")
LIST = ["id", "title", "questions", "types", "state", "pictures"]
ROWS = {
    "support-triage": ["support-triage", "Support ticket triage", 3, "1 noul, 1 choice, 1 score", "text", 0],
    "llm-guardrail": ["llm-guardrail", "Guardrail for an LLM app", 5, "4 noul, 1 score", "object", 0],
    "citation-check": ["citation-check", "Catch hallucinated citations", 3, "2 noul, 1 choice", "object", 0],
    "tool-call-check": ["tool-call-check", "Verify an agent's tool call", 4, "4 noul", "object", 0],
    "model-router": ["model-router", "Route prompts to the right model", 3, "1 noul, 1 choice, 1 score", "object", 0],
    "date-parts": ["date-parts", "Extract a date without asking for a date", 3, "3 choice", "object", 0],
    "entity-match": ["entity-match", "Are these two records the same product?", 2, "1 noul, 1 score", "object", 0],
    "resume-screen": ["resume-screen", "Screen a candidate against explicit requirements", 4, "3 noul, 1 score", "object", 0],
    "community-moderation": ["community-moderation", "Moderate a post against your own rules", 4, "4 noul", "object", 0],
    "semantic-lint": ["semantic-lint", "Semantic code lint", 3, "3 noul", "object", 0],
    "lead-scoring": ["lead-scoring", "Score an inbound lead", 4, "2 noul, 1 choice, 1 score", "object", 0],
    "review-features": ["review-features", "Turn reviews into structured data", 5, "1 noul, 4 score", "object", 0],
    "photo-locate": ["photo-locate", "Find it in a photo", 3, "2 noul, 1 box", "object", 1],
}
OUTLINE = ["#", "question", "type", "criteria", "words"]
TRIAGE_OUTLINE = [[1, "department", "choice", 3, 5], [2, "frustration", "score", 3, 6], [3, "is_urgent", "noul", 0, 7]]
SEARCH = ["example", "title", "matched"]
MERGE = [["entity-match", "Are these two records the same product?", "description, questions"]]
PICTURES = ["example", "picture", "sample", "description", "file"]
PHOTO_ROW = ["photo-locate", "photo-torn-bag", "torn-bag", "A coffee bag with a torn seal and beans spilled on the counter", True]


def all_outline(text):
    rows = json.loads(text)
    if len(rows) != 46 or rows[0] != {"example": "support-triage", "#": 1, "question": "department", "type": "choice", "criteria": 3, "words": 5}:
        raise AssertionError(text[:400])
    if rows[-1] != {"example": "photo-locate", "#": 3, "question": "spill_box", "type": "box", "criteria": 0, "words": 6}:
        raise AssertionError(rows[-1])


CASES = {
    "list": {"argv": ["examples", "list"], "stdout": table(LIST, list(ROWS.values())), "options": {
        "type": {"argv": ["examples", "list", "--type", "choice"], "stdout": table(LIST, [ROWS[key] for key in (
            "support-triage", "citation-check", "model-router", "date-parts", "lead-scoring")])},
        "pictures": {"argv": ["examples", "list", "--pictures"], "stdout": table(LIST, [ROWS["photo-locate"]])},
        "sort": {"argv": ["examples", "list", "--sort", "questions"], "stdout": first_column([
            "llm-guardrail", "review-features", "community-moderation", "lead-scoring", "resume-screen", "tool-call-check",
            "citation-check", "date-parts", "model-router", "photo-locate", "semantic-lint", "support-triage", "entity-match"])},
        "format": {"argv": ["examples", "list", "--format", "json"], "stdout": same_json([dict(zip(LIST, row)) for row in ROWS.values()])},
    }},
    "show": {"argv": ["examples", "show", "photo-locate"], "stdout": same_json({
        "id": "photo-locate", "title": "Find it in a photo", "state": PHOTO["state"], "questions": PHOTO["questions"],
        "images": {"photo-torn-bag": {"sample": "torn-bag"}}}), "options": {
        "expectations": {"argv": ["examples", "show", "support-triage", "--expectations"], "stdout": same_json({
            "id": "support-triage", "title": "Support ticket triage", "state": TRIAGE["state"], "questions": TRIAGE["questions"],
            "expect": {"department": {"choice": "billing"}, "is_urgent": {"min": 0.7}}})},
        "part": {"argv": ["examples", "show", "photo-locate", "--part", "images"], "stdout": same_json({"photo-torn-bag": {"sample": "torn-bag"}})},
    }},
    "outline": {"argv": ["examples", "outline", "support-triage"], "stdout": table(OUTLINE, TRIAGE_OUTLINE), "options": {
        "all": {"argv": ["examples", "outline", "--all", "--format", "json"], "stdout": all_outline},
        "type": {"argv": ["examples", "outline", "support-triage", "--type", "score"], "stdout": table(OUTLINE, TRIAGE_OUTLINE[1:2])},
        "criteria": {"argv": ["examples", "outline", "support-triage", "--criteria"], "stdout": table(["question", "type", "key", "words"], [
            ["department", "choice", "billing", 4], ["department", "choice", "technical", 4], ["department", "choice", "sales", 4],
            ["frustration", "score", "0", 4], ["frustration", "score", "1", 3], ["frustration", "score", "2", 4]])},
        "format": {"argv": ["examples", "outline", "support-triage", "--format", "csv"],
                   "stdout": kit.csv_text([OUTLINE] + TRIAGE_OUTLINE).rstrip("\r\n") + "\n"},
    }},
    "export": {"argv": ["examples", "export", "photo-locate", "--out", DIR / "photo.json"], "stdout": wrote(DIR / "photo.json", {
        "state": PHOTO["state"], "questions": PHOTO["questions"], "images": {"photo-torn-bag": {"sample": "torn-bag"}}}, "photo-locate"), "options": {
        "expectations": {"argv": ["examples", "export", "support-triage", "--out", DIR / "triage.json", "--expectations"],
                         "stdout": wrote(DIR / "triage.json", {"state": TRIAGE["state"], "questions": TRIAGE["questions"],
                                                               "expect": {"department": {"choice": "billing"}, "is_urgent": {"min": 0.7}}}, "support-triage")},
        "questions_only": {"argv": ["examples", "export", "support-triage", "--out", DIR / "questions.json", "--questions-only"],
                           "stdout": wrote(DIR / "questions.json", TRIAGE["questions"], "support-triage")},
        "force": {"argv": ["examples", "export", "support-triage", "--out", EXISTING, "--force"],
                  "stdout": wrote(EXISTING, {"state": TRIAGE["state"], "questions": TRIAGE["questions"]}, "support-triage")},
    }},
    "search": {"argv": ["examples", "search", "merge"], "stdout": table(SEARCH, MERGE), "options": {
        "where": {"argv": ["examples", "search", "photo", "--in", "title"], "stdout": table(SEARCH, [["photo-locate", "Find it in a photo", "title"]])},
        "regex": {"argv": ["examples", "search", r"\d+ ms\b", "--regex"], "stdout": table(SEARCH, [["model-router", "Route prompts to the right model", "description"]])},
        "format": {"argv": ["examples", "search", "merge", "--format", "json"], "stdout": same_json([dict(zip(SEARCH, row)) for row in MERGE])},
    }},
    "pictures": {"argv": ["examples", "pictures"], "stdout": table(PICTURES, [PHOTO_ROW]), "options": {
        "format": {"argv": ["examples", "pictures", "--format", "json"], "stdout": same_json([dict(zip(PICTURES, PHOTO_ROW))])},
    }},
}


class CliExamplesTests(pack_tests(cli_examples.PACK, CASES)):
    @classmethod
    def setUpClass(cls):
        cls.saved = lab._PACKS
        lab._PACKS = [cli_examples.PACK]

    @classmethod
    def tearDownClass(cls):
        lab._PACKS = cls.saved

    def test_show_and_search_never_reveal_expectations_or_read_the_state(self):
        _code, out, _err = run_cli(["examples", "show", "support-triage"])
        self.assertNotIn("expect", json.loads(out))
        # "Stripe" appears only in support-triage's state, which search never reads.
        self.assertEqual(run_cli(["examples", "search", "Stripe"])[1], "no example matches\n")

    def test_every_export_is_a_valid_request_and_existing_files_are_kept(self):
        for example in examples.EXAMPLES:
            path = DIR / ("all-%s.json" % example["id"])
            self.assertEqual(run_cli(["examples", "export", example["id"], "--out", path])[0], 0)
            request = json.loads(path.read_text())
            self.assertEqual(workbench.validate_questions(request["questions"]), example["questions"])
            workbench.validate_state(request["state"])
            self.assertNotIn("expect", request)
        code, _out, err = run_cli(["examples", "export", "support-triage", "--out", DIR / "all-support-triage.json"])
        self.assertEqual(code, 2)
        self.assertIn("already exists", err)
        code, _out, err = run_cli(["examples", "export", "support-triage", "--out", DIR, "--force"])
        self.assertEqual(code, 2)
        self.assertIn("is a folder", err)
        self.assertEqual(run_cli(["examples", "show", "no-such-example"])[0], 2)
        self.assertEqual(run_cli(["examples", "outline"])[0], 2)
