"""Tests for the cli-decisions Lab pack (jev/lab/packs/cli_decisions.py): offline commands for the JSON lines an
exported gate prints. Fictional Harbor Coffee Co. data only."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import ROOT, pack_tests, run_cli  # noqa: E402
from jev import checks, gate, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_decisions  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


QUESTIONS = {
    "department": {"type": "choice", "instructions": "Which team should handle the ticket?",
                   "criteria": {"billing": "Charges and refunds", "shipping": "Delivery and damage", "product": "Products and stock"}},
    "is_urgent": {"type": "noul", "instructions": "Does it need action today?"},
    "frustration": {"type": "score", "instructions": "How frustrated is the customer?", "criteria": ["calm", "annoyed", "angry"]},
}
RULE = "if department = billing then frustration >= 1"
GATES = {"department": 0.8, "is_urgent": 0.7}
P = gate.provenance(QUESTIONS, GATES, "confidence", "jev-1.14.0", RULE, None)
P16 = P["fingerprint"][:16]
OTHER = {"version": 1, "fingerprint": "0" * 64, "model": "jev-1.14.0"}

TORN = {"text": "Bag arrived torn", "channel": "chat"}
TWICE = {"text": "Charged twice", "channel": "email"}
REFUND = {"text": "Refund please", "channel": "email"}
DECAF = {"text": "Do you sell decaf?", "channel": "phone"}
GRINDER = {"text": "Grinder squeals", "channel": "chat"}


def decision(route, row, department, urgent, frustration, held=(), rules=(), provenance=P):
    d = {"route": route, "held": list(held), "rules": list(rules),
         "answers": {"department": department, "is_urgent": urgent, "frustration": frustration}, "row": row}
    if provenance is not None:
        d["provenance"] = provenance
    return json.dumps(d)


def write(name, lines):
    path = DIR / name
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return str(path)


DEC = write("decisions.jsonl", [
    decision("auto", TORN, "shipping", False, 0),
    decision("review", TWICE, "billing", True, 2, held=["department"]),
    decision("review", REFUND, "billing", False, 0, rules=[RULE]),
    decision("auto", DECAF, "product", False, 1),
    decision("review", GRINDER, "shipping", None, 1, held=["department", "is_urgent"], provenance=None),
    "",
    "not json",
    decision("auto", TORN, "shipping", False, 0),
])
GOOD = write("good.jsonl", [decision("auto", TORN, "shipping", False, 0), decision("review", TWICE, "billing", True, 2, held=["department"]),
                            decision("review", REFUND, "billing", False, 0, rules=[RULE]), decision("auto", DECAF, "product", False, 1)])
BAD = write("bad.jsonl", [
    decision("auto", TORN, "shipping", False, 0),
    decision("auto", TWICE, "billing", True, 2, held=["department"]),
    decision("review", REFUND, "billing", False, 0),
    json.dumps({"route": "review", "held": ["mood"], "rules": [], "answers": {"department": "billing"}, "row": DECAF}),
    json.dumps({"route": "auto", "held": [], "rules": [], "answers": {}}),
    "[1]",
])
DSET = write("dataset-check.jsonl", [
    decision("auto", TORN, "shipping", False, 0),
    decision("auto", DECAF, "product", False, 1, provenance=OTHER),
    json.dumps({"route": "auto", "held": [], "rules": [], "answers": {"department": "product", "mood": "happy"}, "provenance": P,
                "row": TWICE}),
])
LATER = write("later.jsonl", [
    decision("review", TORN, "shipping", False, 0, held=["department"]),
    decision("review", TWICE, "billing", True, 2, held=["department"]),
    decision("auto", REFUND, "billing", False, 1),
    decision("auto", {"text": "New row", "channel": "phone"}, "product", False, 0),
])
EXISTING = DIR / "existing.jsonl"
EXISTING.write_text("old\n")
LINE = lambda row: json.dumps(row, ensure_ascii=False)  # noqa: E731


def save_support(directory):
    workbench.save_dataset({"name": "Support tickets", "questions": QUESTIONS, "rules": RULE, "rows": [
        dict(REFUND, _expect={"department": "billing", "frustration": 1}),
        dict(GRINDER, _test=True, _expect={"department": "shipping"}),
        {"text": "Unrelated", "channel": "fax"}]})
    checks.save_check("support-tickets", {"gates": GATES, "model": "jev-1.14.0", "min_accuracy": 0.9, "rules": RULE})


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


def wrote(path, message, content):
    def check(text):
        if text != message:
            raise AssertionError(text)
        if Path(path).read_text(encoding="utf-8") != content:
            raise AssertionError(Path(path).read_text(encoding="utf-8"))
    return check


SUMMARY = [["decisions", 6], ["auto", 3], ["review", 3], ["auto %", 50.0], ["review %", 50.0], ["held a question", 2],
           ["broke a rule", 1], ["with provenance", 5], ["distinct rows", 5], ["malformed lines", 1]]
ANSWERS = ["question", "answer", "decisions", "share %", "auto", "review"]
URGENT = [["is_urgent", "no", 4, 66.7, 3, 1], ["is_urgent", "(no answer)", 1, 16.7, 0, 1], ["is_urgent", "yes", 1, 16.7, 0, 1]]
REVIEW = ["line", "held", "rules", "row"]
R2, R3, R5 = [2, "department", "", LINE(TWICE)], [3, "", RULE, LINE(REFUND)], [5, "department, is_urgent", "", LINE(GRINDER)]
REVIEW_JSON = [dict(zip(REVIEW, row)) for row in (R2, R3, R5)]
BAD_PROBLEMS = [[2, "is routed auto, but it holds a question or breaks a rule"],
                [3, "is routed to review, but it holds no question and breaks no rule"],
                [4, "holds mood, which it has no answer for"],
                [5, "has no row: export the gate again, its script prints each row with its decision"],
                [6, "is not a JSON object"]]
OUT = DIR / "review.jsonl"
CSV_OUT = '"text","channel"\r\n"Charged twice","email"\r\n"Refund please","email"\r\n"Grinder squeals","chat"\r\n'
INSIDE = ROOT / "data" / "workbench" / "lab-decisions-test-never-written.jsonl"

CASES = {
    "summary": {"argv": ["decisions", "summary", DEC], "stdout": table(["metric", "value"], SUMMARY),
                "options": {
                    "by": {"argv": ["decisions", "summary", DEC, "--by", "channel"],
                           "stdout": table(["channel", "decisions", "auto", "review", "review %"],
                                           [["chat", 3, 2, 1, 33.3], ["email", 2, 0, 2, 100.0], ["phone", 1, 1, 0, 0.0]])},
                    "max_review": {"argv": ["decisions", "summary", DEC, "--max-review", "40", "--format", "json"], "code": 1,
                                   "stdout": same_json([{"metric": m, "value": v} for m, v in SUMMARY]),
                                   "stderr": "review share 50% is above --max-review 40%\n"},
                    "format": {"argv": ["decisions", "summary", GOOD, "--format", "csv"],
                               "stdout": kit.render(["metric", "value"], [["decisions", 4], ["auto", 2], ["review", 2], ["auto %", 50.0],
                                                                          ["review %", 50.0], ["held a question", 1], ["broke a rule", 1],
                                                                          ["with provenance", 4], ["distinct rows", 4], ["malformed lines", 0]],
                                                    "csv") + "\n"}}},
    "questions": {"argv": ["decisions", "questions", DEC],
                  "stdout": table(["question", "answered", "no answer", "held", "held %"],
                                  [["department", 6, 0, 2, 33.3], ["is_urgent", 5, 1, 1, 16.7], ["frustration", 6, 0, 0, 0.0]]),
                  "options": {
                      "held_only": {"argv": ["decisions", "questions", DEC, "--held-only"],
                                    "stdout": table(["question", "answered", "no answer", "held", "held %"],
                                                    [["department", 6, 0, 2, 33.3], ["is_urgent", 5, 1, 1, 16.7]])},
                      "format": {"argv": ["decisions", "questions", GOOD, "--format", "json"],
                                 "stdout": same_json([{"question": "department", "answered": 4, "no answer": 0, "held": 1, "held %": 25.0},
                                                      {"question": "is_urgent", "answered": 4, "no answer": 0, "held": 0, "held %": 0.0},
                                                      {"question": "frustration", "answered": 4, "no answer": 0, "held": 0, "held %": 0.0}])}}},
    "answers": {"argv": ["decisions", "answers", DEC],
                "stdout": table(ANSWERS, [["department", "shipping", 3, 50.0, 2, 1], ["department", "billing", 2, 33.3, 0, 2],
                                          ["department", "product", 1, 16.7, 1, 0]] + URGENT +
                                [["frustration", "0", 3, 50.0, 2, 1], ["frustration", "1", 2, 33.3, 1, 1], ["frustration", "2", 1, 16.7, 0, 1]]),
                "options": {
                    "question": {"argv": ["decisions", "answers", DEC, "--question", "is_urgent"], "stdout": table(ANSWERS, URGENT)},
                    "route": {"argv": ["decisions", "answers", DEC, "--route", "review", "--question", "department"],
                              "stdout": table(ANSWERS, [["department", "billing", 2, 66.7, 0, 2], ["department", "shipping", 1, 33.3, 0, 1]])},
                    "format": {"argv": ["decisions", "answers", DEC, "--question", "department", "--format", "markdown"],
                               "stdout": kit.render(ANSWERS, [["department", "shipping", 3, 50.0, 2, 1], ["department", "billing", 2, 33.3, 0, 2],
                                                              ["department", "product", 1, 16.7, 1, 0]], "markdown") + "\n"}}},
    "review": {"argv": ["decisions", "review", DEC], "stdout": table(REVIEW, [R2, R3, R5]),
               "options": {
                   "held": {"argv": ["decisions", "review", DEC, "--held", "is_urgent"], "stdout": table(REVIEW, [R5])},
                   "rule": {"argv": ["decisions", "review", DEC, "--rule", "BILLING then"], "stdout": table(REVIEW, [R3])},
                   "where": {"argv": ["decisions", "review", DEC, "--where", "channel=email"], "stdout": table(REVIEW, [R2, R3])},
                   "limit": {"argv": ["decisions", "review", DEC, "--limit", "1"], "stdout": table(REVIEW, [R2])},
                   "format": {"argv": ["decisions", "review", DEC, "--format", "json"], "stdout": same_json(REVIEW_JSON)}}},
    "validate": {"argv": ["decisions", "validate", GOOD], "stdout": "every line is valid (4 decisions)\n",
                 "options": {
                     "dataset": {"argv": ["decisions", "validate", DSET, "--dataset", "support-tickets"], "setup": save_support, "code": 1,
                                 "stdout": table(["line", "problem"], [
                                     [2, "has gate provenance that does not match this check. Export its current gate and route the rows again"],
                                     [3, "answers mood, which the dataset's questions do not include. Was it routed by this check's gate?"]])},
                     "strict": {"argv": ["decisions", "validate", DEC, "--strict"], "code": 1,
                                "stdout": table(["line", "problem"], [
                                    [5, "has no provenance: export the gate again so Review can verify its decisions"], [7, "is not JSON"]])},
                     "format": {"argv": ["decisions", "validate", BAD, "--format", "json"], "code": 1,
                                "stdout": same_json([{"line": n, "problem": p} for n, p in BAD_PROBLEMS])}}},
    "provenance": {"argv": ["decisions", "provenance", DEC],
                   "stdout": table(["fingerprint", "version", "model", "decisions"], [[P16, 1, "jev-1.14.0", 5], ["(none)", None, None, 1]]),
                   "options": {
                       "dataset": {"argv": ["decisions", "provenance", DSET, "--dataset", "support-tickets"], "setup": save_support, "code": 1,
                                   "stdout": table(["fingerprint", "version", "model", "decisions", "status"],
                                                   [[P16, 1, "jev-1.14.0", 2, "matches"], ["0" * 16, 1, "jev-1.14.0", 1, "differs"]])
                                   + "the check of support-tickets has fingerprint %s\n" % P16},
                       "lines": {"argv": ["decisions", "provenance", DEC, "--lines", "--format", "json"],
                                 "stdout": same_json([{"line": n, "fingerprint": P16, "model": "jev-1.14.0"} for n in (1, 2, 3, 4)]
                                                     + [{"line": 5, "fingerprint": "(none)", "model": None},
                                                        {"line": 8, "fingerprint": P16, "model": "jev-1.14.0"}])},
                       "format": {"argv": ["decisions", "provenance", GOOD, "--format", "csv"],
                                  "stdout": kit.render(["fingerprint", "version", "model", "decisions"], [[P16, 1, "jev-1.14.0", 4]], "csv") + "\n"}}},
    "reasons": {"argv": ["decisions", "reasons", DEC],
                "stdout": table(["held", "rules", "rows", "share %"],
                                [["", RULE, 1, 33.3], ["department", "", 1, 33.3], ["department, is_urgent", "", 1, 33.3]]),
                "options": {"format": {"argv": ["decisions", "reasons", GOOD, "--format", "json"],
                                       "stdout": same_json([{"held": "", "rules": RULE, "rows": 1, "share %": 50.0},
                                                            {"held": "department", "rules": "", "rows": 1, "share %": 50.0}])}}},
    "export": {"argv": ["decisions", "export", DEC], "stdout": "".join(LINE(row) + "\n" for row in (TWICE, REFUND, GRINDER)),
               "options": {
                   "route": {"argv": ["decisions", "export", DEC, "--route", "all"],
                             "stdout": "".join(LINE(row) + "\n" for row in (TORN, TWICE, REFUND, DECAF, GRINDER))},
                   "csv": {"argv": ["decisions", "export", DEC, "--csv"], "stdout": CSV_OUT},
                   "exclude_dataset": {"argv": ["decisions", "export", DEC, "--exclude-dataset", "support-tickets"], "setup": save_support,
                                       "stdout": LINE(TWICE) + "\n"},
                   "out": {"argv": ["decisions", "export", DEC, "--out", str(OUT)],
                           "stdout": wrote(OUT, "wrote 3 rows to %s\n" % OUT, "".join(LINE(row) + "\n" for row in (TWICE, REFUND, GRINDER)))},
                   "force": {"argv": ["decisions", "export", DEC, "--route", "auto", "--out", str(EXISTING), "--force"],
                             "stdout": wrote(EXISTING, "wrote 2 rows to %s\n" % EXISTING, LINE(TORN) + "\n" + LINE(DECAF) + "\n")}}},
    "compare": {"argv": ["decisions", "compare", DEC, LATER], "code": 1,
                "stdout": table(["metric", "value"], [["rows in A", 5], ["rows in B", 4], ["in both", 3], ["only in A", 2], ["only in B", 1],
                                                      ["same route", 1], ["auto -> review", 1], ["review -> auto", 1], ["answers changed", 1]]),
                "options": {
                    "changed": {"argv": ["decisions", "compare", DEC, LATER, "--changed"], "code": 1,
                                "stdout": table(["line A", "line B", "route A", "route B", "answers changed", "row"],
                                                [[1, 1, "auto", "review", "", LINE(TORN)], [3, 3, "review", "auto", "frustration", LINE(REFUND)]])},
                    "format": {"argv": ["decisions", "compare", GOOD, GOOD, "--format", "json"],
                               "stdout": same_json([{"metric": m, "value": v} for m, v in [
                                   ["rows in A", 4], ["rows in B", 4], ["in both", 4], ["only in A", 0], ["only in B", 0], ["same route", 4],
                                   ["auto -> review", 0], ["review -> auto", 0], ["answers changed", 0]]])}}},
}


class CliDecisionsTests(pack_tests(cli_decisions.PACK, CASES)):
    def test_usage_errors_exit_two(self):
        self.assertEqual(run_cli(["decisions", "summary", str(DIR / "missing.jsonl")])[0], 2)
        self.assertEqual(run_cli(["decisions", "summary", write("junk.jsonl", ["nope", "[]"])])[0], 2)
        self.assertEqual(run_cli(["decisions", "validate", GOOD, "--dataset", "no-such"])[0], 2)
        self.assertEqual(run_cli(["decisions", "review", DEC, "--where", "channel"])[0], 2)
        self.assertEqual(run_cli(["decisions", "answers", DEC, "--question", "mood"])[0], 2)
        for bad in ("nan", "150", "-1"):
            self.assertEqual(run_cli(["decisions", "summary", DEC, "--max-review", bad])[0], 2, bad)
        self.assertEqual(run_cli(["decisions", "review", DEC, "--limit", "0"])[0], 2)

    def test_byte_order_mark_and_non_finite_numbers(self):
        # A byte-order mark before line 1 is not part of the decision; NaN is not JSON (and never equals itself).
        path = DIR / "bom.jsonl"
        path.write_bytes(b"\xef\xbb\xbf" + (decision("auto", TORN, "shipping", False, 0) + "\n").encode("utf-8")
                         + b'{"route": "auto", "held": [], "rules": [], "answers": {"frustration": NaN}, "row": {"text": "x"}}\n')
        code, out, _err = run_cli(["decisions", "validate", str(path), "--format", "json"])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out), [{"line": 2, "problem": "is not JSON"}])
        code, out, _err = run_cli(["decisions", "compare", str(path), str(path), "--format", "json"])
        self.assertEqual(code, 0)
        self.assertEqual(dict((r["metric"], r["value"]) for r in json.loads(out))["answers changed"], 0)

    def test_export_never_replaces_or_writes_inside_the_data_directory(self):
        code, _out, err = run_cli(["decisions", "export", DEC, "--out", str(EXISTING)])
        self.assertEqual(code, 2)
        self.assertIn("already exists", err)
        code, _out, err = run_cli(["decisions", "export", DEC, "--out", str(INSIDE)])
        self.assertEqual(code, 2)
        self.assertIn("inside the Workbench data directory", err)
        self.assertFalse(INSIDE.exists())

    def test_dataset_rows_never_printed(self):
        for argv in (["decisions", "validate", DSET, "--dataset", "support-tickets"],
                     ["decisions", "export", DEC, "--route", "all", "--exclude-dataset", "support-tickets"]):
            _code, out, err = run_cli(argv, save_support)
            self.assertNotIn("Unrelated", out + err)

    def test_long_rows_are_cut_for_display(self):
        long_row = {"text": "A very long note about a delayed grinder delivery to the Harbor Coffee Co. roastery on Pier 4"}
        path = write("long.jsonl", [decision("review", long_row, "shipping", False, 0, held=["department"])])
        _code, out, _err = run_cli(["decisions", "review", path, "--format", "json"])
        shown = json.loads(out)[0]["row"]
        self.assertEqual(len(shown), 80)
        self.assertTrue(shown.endswith("…"))
