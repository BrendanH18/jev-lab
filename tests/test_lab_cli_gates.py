"""Tests for the cli-gates Lab pack (jev/lab/packs/cli_gates.py): offline views and exports of saved checks' gates.
Fictional Harbor Coffee Co. data only."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import ROOT, pack_tests, run_cli  # noqa: E402
from jev import checks, gate, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_gates  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


QUESTIONS = {
    "department": {"type": "choice", "instructions": "Which team should handle the ticket?",
                   "criteria": {"billing": "Charges and refunds", "shipping": "Delivery and damage", "product": "Products and stock"}},
    "is_urgent": {"type": "noul", "instructions": "Does it need action today?"},
    "frustration": {"type": "score", "instructions": "How frustrated is the customer?", "criteria": ["calm", "annoyed", "angry"]},
    "mood": {"type": "noul", "instructions": "Is the customer cheerful?"},
}
R1 = "if department = billing then frustration >= 1"
R2 = "if is_urgent = yes then department in billing, shipping"
ROWS = [
    {"text": "Charged twice", "channel": "email", "_expect": {"department": "billing", "is_urgent": True}},
    {"text": "Refund please", "channel": "email", "_expect": {"department": "billing"}},
    {"text": "Bag torn", "channel": "chat", "_expect": {"department": "shipping", "is_urgent": False}},
    {"text": "Blank label", "channel": "email", "_expect": {"department": "billing", "is_urgent": ""}},
    {"text": "Held fax", "channel": "fax", "_test": True, "_expect": {"department": "shipping", "is_urgent": True}},
    "Grinder squeals",
]
CHECK = {"gates": {"department": 0.8, "is_urgent": 0.7}, "model": "jev-1.14.0", "tuned_on": "jev-1.14.0", "min_accuracy": 0.9,
         "min_coverage": 0.5, "rules": R1 + "\n" + R2,
         "answer_sets": {"department": {"cut": 0.12, "coverage": 0.9}, "frustration": {"cut": 0.2, "coverage": 0.8}},
         "slice_targets": [{"field": "channel", "value": "email", "min_accuracy": 0.85, "min_coverage": 0.4},
                           {"field": "channel", "value": "fax", "min_accuracy": 0.9, "min_coverage": 0}]}
CHECK_V2 = {"gates": {"department": 0.85, "frustration": 0.6}, "model": "jev-1.15.0", "min_accuracy": 0.9, "rules": R1,
            "answer_sets": {"department": {"cut": 0.12, "coverage": 0.95}},
            "slice_targets": [{"field": "channel", "value": "email", "min_accuracy": 0.85, "min_coverage": 0.4},
                              {"field": "channel", "value": "chat", "min_accuracy": 0.9, "min_coverage": 0.5}]}
PHOTO_QUESTIONS = {"damaged": {"type": "noul", "instructions": "Is the parcel damaged?"},
                   "where": {"type": "box", "instructions": "Where is the damage?"}}

PA = gate.provenance(QUESTIONS, CHECK["gates"], "confidence", "jev-1.14.0", CHECK["rules"], CHECK["answer_sets"])
PB = gate.provenance(QUESTIONS, CHECK_V2["gates"], "confidence", "jev-1.15.0", R1, CHECK_V2["answer_sets"])
PC = gate.provenance(QUESTIONS, CHECK["gates"], "confidence", "jev-1.15.0", CHECK["rules"], CHECK["answer_sets"])


def save_support(directory):
    workbench.save_dataset({"name": "Support tickets", "questions": QUESTIONS, "rows": ROWS})
    checks.save_check("support-tickets", CHECK)


def save_all(directory):
    save_support(directory)
    workbench.save_dataset({"name": "Support v2", "questions": QUESTIONS, "rows": ROWS})
    checks.save_check("support-v2", CHECK_V2)
    workbench.save_dataset({"name": "Support copy", "questions": QUESTIONS, "rows": ROWS})
    checks.save_check("support-copy", dict(CHECK, model="jev-1.15.0"))
    workbench.save_dataset({"name": "Parcel photos", "questions": PHOTO_QUESTIONS, "rows": [
        {"note": "Seal split", "_image": "torn-bag", "_expect": {"damaged": True}}, {"note": "Fine", "_image": "intact-bag"}]})
    checks.save_check("parcel-photos", {"gates": {"damaged": 0.6}, "model": "jev-latest", "min_accuracy": 0.9})
    workbench.save_dataset({"name": "No check", "questions": PHOTO_QUESTIONS, "rows": [{"note": "x", "_image": "torn-bag"}]})


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


def module(path, message, starts, contains):
    def check(text):
        if text != message:
            raise AssertionError(text)
        source = Path(path).read_text(encoding="utf-8")
        if not source.startswith(starts):
            raise AssertionError(source[:200])
        for part in contains:
            if part not in source:
                raise AssertionError("%r is not in the module" % part)
    return check


HEADER = ("gate of Support tickets (support-tickets)\nmodel jev-1.14.0, signal confidence, tuned on jev-1.14.0\n"
          "provenance fingerprint %s\n\n" % PA["fingerprint"][:16])
SHOW = ["question", "type", "threshold", "signal read", "shortlist cut", "rules"]
SHOW_ROWS = [["department", "choice", 0.8, "confidence", 0.12, 2], ["is_urgent", "noul", 0.7, "|2p - 1|", None, 1],
             ["frustration", "score", None, "", 0.2, 1]]
RULES = [{"rule": R1, "if": [["department", "=", ["billing"]]], "then": [["frustration", ">=", ["1"]]]},
         {"rule": R2, "if": [["is_urgent", "=", ["yes"]]], "then": [["department", "in", ["billing", "shipping"]]]}]
SHOW_JSON = {"dataset": "support-tickets", "model": "jev-1.14.0", "signal": "confidence", "thresholds": {"department": 0.8, "is_urgent": 0.7},
             "types": {"department": "choice", "is_urgent": "noul", "frustration": "score", "mood": "noul"}, "rules": RULES,
             "answer_sets": CHECK["answer_sets"],
             "slice_targets": [{"field": "channel", "value": "email", "min_accuracy": 0.85, "min_coverage": 0.4},
                               {"field": "channel", "value": "fax", "min_accuracy": 0.9, "min_coverage": 0.0}],
             "provenance": PA}
RULE_COLUMNS = ["#", "rule", "reads", "not gated"]
SLICES = ["field", "value", "min accuracy", "min coverage", "tuning rows", "labeled for gates"]
QUESTION_COLUMNS = ["question", "type", "threshold", "rules", "shortlist cut", "use"]
FIND = ["dataset", "role", "threshold", "shortlist cut", "rules"]
PY_OUT, JS_OUT, EXISTING = DIR / "gate.py", DIR / "gate.mjs", DIR / "existing.py"
EXISTING.write_text("old\n")
INSIDE = ROOT / "data" / "workbench" / "lab-gates-test-never-written.py"

CASES = {
    "show": {"argv": ["gates", "show", "support-tickets"], "setup": save_support, "stdout": HEADER + table(SHOW, SHOW_ROWS),
             "options": {
                 "json": {"argv": ["gates", "show", "support-tickets", "--json"], "setup": save_support, "stdout": same_json(SHOW_JSON)},
                 "format": {"argv": ["gates", "show", "support-tickets", "--format", "csv"], "setup": save_support,
                            "stdout": kit.render(SHOW, SHOW_ROWS, "csv") + "\n"}}},
    "rules": {"argv": ["gates", "rules", "support-tickets"], "setup": save_support,
              "stdout": table(RULE_COLUMNS, [[1, R1, "department, frustration", "frustration"], [2, R2, "is_urgent, department", ""]]),
              "options": {
                  "question": {"argv": ["gates", "rules", "support-tickets", "--question", "frustration"], "setup": save_support,
                               "stdout": table(RULE_COLUMNS, [[1, R1, "department, frustration", "frustration"]])},
                  "format": {"argv": ["gates", "rules", "support-v2", "--format", "json"], "setup": save_all,
                             "stdout": same_json([{"#": 1, "rule": R1, "reads": "department, frustration", "not gated": ""}])}}},
    "slices": {"argv": ["gates", "slices", "support-tickets"], "setup": save_support,
               "stdout": table(SLICES, [["channel", "email", 0.85, 0.4, 3, 1], ["channel", "fax", 0.9, 0.0, 0, 0]]),
               "options": {
                   "missing": {"argv": ["gates", "slices", "support-tickets", "--missing"], "setup": save_support, "code": 1,
                               "stdout": table(SLICES, [["channel", "fax", 0.9, 0.0, 0, 0]])},
                   "format": {"argv": ["gates", "slices", "support-v2", "--format", "json"], "setup": save_all,
                              "stdout": same_json([dict(zip(SLICES, ["channel", "email", 0.85, 0.4, 3, 0])),
                                                   dict(zip(SLICES, ["channel", "chat", 0.9, 0.5, 1, 0]))])}}},
    "export": {"argv": ["gates", "export", "support-tickets", "--out", str(PY_OUT)], "setup": save_support,
               "stdout": module(PY_OUT, "wrote the python gate of support-tickets to %s\n" % PY_OUT,
                                '"""A confidence gate exported from Jev Lab',
                                ["THRESHOLDS = {", "'department': 0.8", "'is_urgent': 0.7", PA["fingerprint"], "def decide(state"]),
               "options": {
                   "language": {"argv": ["gates", "export", "support-tickets", "--out", str(JS_OUT), "--language", "javascript"],
                                "setup": save_support,
                                "stdout": module(JS_OUT, "wrote the javascript gate of support-tickets to %s\n" % JS_OUT,
                                                 "// A confidence gate exported from Jev Lab",
                                                 ["export const THRESHOLDS = {", '"department": 0.8', PA["fingerprint"],
                                                  "export async function decide("])},
                   "force": {"argv": ["gates", "export", "support-v2", "--out", str(EXISTING), "--force"], "setup": save_all,
                             "stdout": module(EXISTING, "wrote the python gate of support-v2 to %s\n" % EXISTING,
                                              '"""A confidence gate exported from Jev Lab', ["'frustration': 0.6", PB["fingerprint"]])}}},
    "diff": {"argv": ["gates", "diff", "support-tickets", "support-v2"], "setup": save_all, "code": 1,
             "stdout": table(["part", "item", "A", "B"], [
                 ["model", "", "jev-1.14.0", "jev-1.15.0"], ["target", "min coverage", 0.5, 0.0], ["threshold", "department", 0.8, 0.85], ["threshold", "is_urgent", 0.7, None],
                 ["threshold", "frustration", None, 0.6], ["rule", R2, "yes", None], ["shortlist coverage", "department", 0.9, 0.95],
                 ["shortlist cut", "frustration", 0.2, None], ["shortlist coverage", "frustration", 0.8, None],
                 ["slice target", "channel = fax", "accuracy 0.9, coverage 0", None],
                 ["slice target", "channel = chat", None, "accuracy 0.9, coverage 0.5"],
                 ["fingerprint", "", PA["fingerprint"][:16], PB["fingerprint"][:16]]]),
             "options": {
                 "ignore_model": {"argv": ["gates", "diff", "support-tickets", "support-copy", "--ignore-model"], "setup": save_all,
                                  "stdout": "same gate\n"},
                 "format": {"argv": ["gates", "diff", "support-tickets", "support-copy", "--format", "json"], "setup": save_all, "code": 1,
                            "stdout": same_json([{"part": "model", "item": "", "A": "jev-1.14.0", "B": "jev-1.15.0"},
                                                 {"part": "fingerprint", "item": "", "A": PA["fingerprint"][:16], "B": PC["fingerprint"][:16]}])}}},
    "questions": {"argv": ["gates", "questions", "support-tickets"], "setup": save_support,
                  "stdout": table(QUESTION_COLUMNS, [["department", "choice", 0.8, 2, 0.12, "gated, rule, shortlist"],
                                                     ["is_urgent", "noul", 0.7, 1, None, "gated, rule"],
                                                     ["frustration", "score", None, 1, 0.2, "rule, shortlist"],
                                                     ["mood", "noul", None, 0, None, "ignored"]]),
                  "options": {
                      "ignored": {"argv": ["gates", "questions", "support-tickets", "--ignored"], "setup": save_support, "code": 1,
                                  "stdout": table(QUESTION_COLUMNS, [["mood", "noul", None, 0, None, "ignored"]])},
                      "format": {"argv": ["gates", "questions", "parcel-photos", "--format", "json"], "setup": save_all,
                                 "stdout": same_json([dict(zip(QUESTION_COLUMNS, ["damaged", "noul", 0.6, 0, None, "gated"])),
                                                      dict(zip(QUESTION_COLUMNS, ["where", "box", None, 0, None, "output only"]))])}}},
    "route": {"argv": ["gates", "route", "support-tickets", "--signal", "department=0.8"], "setup": save_support,
              "stdout": "route: review\nheld: is_urgent (no signal given)\nrule: %s\nrule: %s\n" % (R1, R2),
              "options": {
                  "answer": {"argv": ["gates", "route", "support-tickets", "--signal", "department=0.95", "--signal", "is_urgent=0.5",
                                      "--answer", "department=billing", "--answer", "frustration=0", "--answer", "is_urgent=no"],
                             "setup": save_support,
                             "stdout": "route: review\nheld: is_urgent (signal 0.5 is below 0.7)\nrule: %s\n" % R1},
                  "json": {"argv": ["gates", "route", "support-tickets", "--signal", "department=0.95", "--signal", "is_urgent=0.9",
                                    "--answer", "department=shipping", "--answer", "frustration=2", "--answer", "is_urgent=true", "--json"],
                           "setup": save_support, "stdout": same_json({"route": "auto", "held": [], "rules": []})}}},
    "find": {"argv": ["gates", "find", "department"], "setup": save_all,
             "stdout": table(FIND, [["support-copy", "gated, rule, shortlist", 0.8, 0.12, 2],
                                    ["support-tickets", "gated, rule, shortlist", 0.8, 0.12, 2],
                                    ["support-v2", "gated, rule, shortlist", 0.85, 0.12, 1]]),
             "options": {
                 "role": {"argv": ["gates", "find", "frustration", "--role", "gated"], "setup": save_all,
                          "stdout": table(FIND, [["support-v2", "gated, rule", 0.6, None, 1]])},
                 "format": {"argv": ["gates", "find", "is_urgent", "--format", "csv"], "setup": save_all,
                            "stdout": kit.render(FIND, [["support-copy", "gated, rule", 0.7, None, 1],
                                                        ["support-tickets", "gated, rule", 0.7, None, 1]], "csv") + "\n"}}},
}


class CliGatesTests(pack_tests(cli_gates.PACK, CASES)):
    def test_usage_errors_exit_two(self):
        for argv in (["gates", "show", "no-check"], ["gates", "show", "no-such"], ["gates", "route", "support-tickets", "--signal", "mood=0.5"],
                     ["gates", "route", "support-tickets", "--signal", "department=1.5"],
                     ["gates", "route", "support-tickets", "--answer", "frustration=7"],
                     ["gates", "export", "support-tickets", "--out", str(EXISTING)]):
            self.assertEqual(run_cli(argv, save_all)[0], 2, argv)

    def test_export_never_writes_inside_the_data_directory(self):
        code, _out, err = run_cli(["gates", "export", "support-tickets", "--out", str(INSIDE)], save_support)
        self.assertEqual(code, 2)
        self.assertIn("inside the Workbench data directory", err)
        self.assertFalse(INSIDE.exists())

    def test_held_out_rows_never_counted_or_shown(self):
        for argv in (["gates", "slices", "support-tickets", "--format", "json"], ["gates", "show", "support-tickets", "--json"]):
            _code, out, _err = run_cli(argv, save_support)
            self.assertNotIn("Held fax", out)
