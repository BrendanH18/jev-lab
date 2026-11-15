"""Tests for the cli-checks Lab pack (jev/lab/packs/cli_checks.py): offline views of saved checks' configuration.
Fictional Harbor Coffee Co. data only."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import checks, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_checks  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


QUESTIONS = {
    "department": {"type": "choice", "instructions": "Which team should handle the ticket?",
                   "criteria": {"billing": "Charges and refunds", "shipping": "Delivery and damage"}},
    "is_urgent": {"type": "noul", "instructions": "Does it need action today?"},
    "frustration": {"type": "score", "instructions": "How frustrated is the customer?", "criteria": ["calm", "annoyed", "angry"]},
}
QUESTIONS_V2 = dict(QUESTIONS, department=dict(QUESTIONS["department"], instructions="Which team owns the ticket?"))
ROWS = [
    {"text": "Charged twice", "channel": "email", "_expect": {"department": "billing", "is_urgent": True}},
    {"text": "Bag torn", "channel": "chat", "_expect": {"department": "shipping"}},
    {"text": "Held fax", "channel": "fax", "_test": True, "_expect": {"department": "shipping", "is_urgent": True}},
]
R1 = "if department = billing then frustration >= 1"
CHECK_A = {"gates": {"department": 0.8, "is_urgent": 0.7}, "model": "jev-1.14.0", "tuned_on": "jev-1.14.0", "min_accuracy": 0.9,
           "min_coverage": 0.5, "rules": R1, "answer_sets": {"department": {"cut": 0.12, "coverage": 0.9}},
           "slice_targets": [{"field": "channel", "value": "email", "min_accuracy": 0.85, "min_coverage": 0.4},
                             {"field": "channel", "value": "fax", "min_accuracy": 0.9, "min_coverage": 0}]}
CHECK_B = {"gates": {"wants_refund": 0.75}, "model": "jev-latest", "signal": "top_probability", "bound": "lower",
           "min_accuracy": 0.95, "min_coverage": 0.3}
CHECK_C = {"gates": {"department": 0.85, "frustration": 0.6}, "model": "jev-1.15.0", "tuned_on": "jev-1.14.0", "min_accuracy": 0.8,
           "slice_targets": [{"field": "channel", "value": "chat", "min_accuracy": 0.9, "min_coverage": 0.5}]}
QUESTION_FILE = DIR / "only-department.json"
QUESTION_FILE.write_text(json.dumps({"department": QUESTIONS["department"]}))
OUT, EXISTING = DIR / "check.json", DIR / "existing.json"
EXISTING.write_text("old\n")


def _times(dataset_id, dataset_at, check_at):
    dataset = workbench.load_dataset(dataset_id)
    dataset["saved_at"], dataset["check"]["saved_at"] = dataset_at, check_at
    workbench.write_dataset(dataset)


def save_all(directory):
    workbench.save_dataset({"name": "Support tickets", "questions": QUESTIONS, "rows": ROWS})
    checks.save_check("support-tickets", CHECK_A)
    _times("support-tickets", "2026-10-05T00:00:00Z", "2026-10-02T00:00:00Z")
    workbench.save_dataset({"name": "Refund requests", "rows": [{"text": "Refund please", "_expect": {"wants_refund": True}}, "Love the beans"],
                            "questions": {"wants_refund": {"type": "noul", "instructions": "Does the customer want money back?"}}})
    checks.save_check("refund-requests", CHECK_B)
    _times("refund-requests", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z")
    workbench.save_dataset({"name": "Support v2", "questions": QUESTIONS_V2, "rows": ROWS})
    checks.save_check("support-v2", CHECK_C)
    _times("support-v2", "2026-10-10T00:00:00Z", "2026-10-11T00:00:00Z")
    workbench.save_dataset({"name": "No check", "rows": ["Latte"]})


def save_broken(directory):
    save_all(directory)
    workbench.save_dataset({"name": "Old menu", "questions": {"hot": {"type": "noul", "instructions": "Is it served hot?"}}, "rows": ["Latte"]})
    dataset = workbench.load_dataset("old-menu")
    dataset["check"] = {"gates": {"gone": 0.5}, "model": "jev-1.14.0", "tuned_on": "jev-1.14.0", "min_accuracy": 0.9}
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
        same_json(expected)(Path(path).read_text(encoding="utf-8"))
    return check


LIST = ["dataset", "model", "tuned on", "signal", "gates", "rules", "cuts", "slices", "min accuracy", "min coverage", "saved"]
REFUND = ["refund-requests", "jev-latest", None, "top_probability", 1, 0, 0, 0, 0.95, 0.3, "2026-09-02T00:00:00Z"]
SUPPORT = ["support-tickets", "jev-1.14.0", "jev-1.14.0", "confidence", 2, 1, 1, 2, 0.9, 0.5, "2026-10-02T00:00:00Z"]
V2 = ["support-v2", "jev-1.15.0", "jev-1.14.0", "confidence", 2, 0, 0, 1, 0.8, 0.0, "2026-10-11T00:00:00Z"]
VALIDATE = ["dataset", "level", "message"]
ALIAS_NOTE = "asks jev-latest, an alias that moves when a new version ships; save the check again from a Bulk run to pin it"
NO_TUNED = "records no tuned-on version: it was saved before checks recorded the version that answered the tuning run"
V2_NOTE = "asks jev-1.15.0 but was tuned on answers from jev-1.14.0"
TARGETS = ["dataset", "min accuracy", "min coverage", "bound", "slice targets", "strictest slice accuracy"]
SUMMARY = ["question", "checks", "lowest", "median", "highest", "signals"]
PER_CHECK = ["dataset", "type", "threshold", "signal", "model"]
EXPORTED = {"gates": {"department": 0.8, "is_urgent": 0.7}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
            "tuned_on": "jev-1.14.0", "min_accuracy": 0.9, "min_coverage": 0.5, "rules": R1,
            "answer_sets": {"department": {"cut": 0.12, "coverage": 0.9}},
            "slice_targets": [{"field": "channel", "value": "email", "min_accuracy": 0.85, "min_coverage": 0.4},
                              {"field": "channel", "value": "fax", "min_accuracy": 0.9, "min_coverage": 0.0}]}
MODELS = ["model", "pinned", "checks", "tuned on", "datasets"]
STALE = ["dataset", "check saved", "dataset saved"]
SLICE_COLUMNS = ["dataset", "field", "value", "min accuracy", "min coverage"]
SLICE_ROWS = [["support-tickets", "channel", "email", 0.85, 0.4], ["support-tickets", "channel", "fax", 0.9, 0.0],
              ["support-v2", "channel", "chat", 0.9, 0.5]]
CUTS = ["dataset", "question", "cut", "coverage", "gated"]

CASES = {
    "list": {"argv": ["checks", "list"], "setup": save_all, "stdout": table(LIST, [REFUND, SUPPORT, V2]),
             "options": {
                 "model": {"argv": ["checks", "list", "--model", "jev-latest"], "setup": save_all, "stdout": table(LIST, [REFUND])},
                 "pinned": {"argv": ["checks", "list", "--pinned", "yes"], "setup": save_all, "stdout": table(LIST, [SUPPORT, V2])},
                 "sort": {"argv": ["checks", "list", "--sort", "accuracy"], "setup": save_all, "stdout": table(LIST, [V2, SUPPORT, REFUND])},
                 "reverse": {"argv": ["checks", "list", "--sort", "saved", "--reverse"], "setup": save_all,
                             "stdout": table(LIST, [V2, SUPPORT, REFUND])},
                 "format": {"argv": ["checks", "list", "--format", "csv", "--model", "jev-1.15.0"], "setup": save_all,
                            "stdout": kit.render(LIST, [V2], "csv") + "\n"}}},
    "validate": {"argv": ["checks", "validate"], "setup": save_broken, "code": 1,
                 "stdout": table(VALIDATE, [["old-menu", "problem", "The check gates 'gone', which is not one of the dataset's questions"],
                                            ["refund-requests", "note", ALIAS_NOTE], ["refund-requests", "note", NO_TUNED],
                                            ["support-tickets", "note", "slice target channel = fax matches no tuning row"],
                                            ["support-v2", "note", V2_NOTE]]),
                 "options": {
                     "dataset": {"argv": ["checks", "validate", "--dataset", "support-v2"], "setup": save_broken,
                                 "stdout": table(VALIDATE, [["support-v2", "note", V2_NOTE]])},
                     "strict": {"argv": ["checks", "validate", "--dataset", "support-v2", "--strict"], "setup": save_broken, "code": 1,
                                "stdout": table(VALIDATE, [["support-v2", "note", V2_NOTE]])},
                     "format": {"argv": ["checks", "validate", "--dataset", "refund-requests", "--format", "json"], "setup": save_all,
                                "stdout": same_json([{"dataset": "refund-requests", "level": "note", "message": ALIAS_NOTE},
                                                     {"dataset": "refund-requests", "level": "note", "message": NO_TUNED}])}}},
    "targets": {"argv": ["checks", "targets"], "setup": save_all,
                "stdout": table(TARGETS, [["refund-requests", 0.95, 0.3, "lower", 0, None], ["support-tickets", 0.9, 0.5, "estimate", 2, 0.9],
                                          ["support-v2", 0.8, 0.0, "estimate", 1, 0.9]]),
                "options": {
                    "below": {"argv": ["checks", "targets", "--below", "0.9"], "setup": save_all,
                              "stdout": table(TARGETS, [["support-v2", 0.8, 0.0, "estimate", 1, 0.9]])},
                    "bound": {"argv": ["checks", "targets", "--bound", "lower"], "setup": save_all,
                              "stdout": table(TARGETS, [["refund-requests", 0.95, 0.3, "lower", 0, None]])},
                    "format": {"argv": ["checks", "targets", "--bound", "lower", "--format", "json"], "setup": save_all,
                               "stdout": same_json([dict(zip(TARGETS, ["refund-requests", 0.95, 0.3, "lower", 0, None]))])}}},
    "thresholds": {"argv": ["checks", "thresholds"], "setup": save_all,
                   "stdout": table(SUMMARY, [["department", 2, 0.8, 0.825, 0.85, "confidence"], ["frustration", 1, 0.6, 0.6, 0.6, "confidence"],
                                             ["is_urgent", 1, 0.7, 0.7, 0.7, "confidence"],
                                             ["wants_refund", 1, 0.75, 0.75, 0.75, "top_probability"]]),
                   "options": {
                       "question": {"argv": ["checks", "thresholds", "--question", "department"], "setup": save_all,
                                    "stdout": table(PER_CHECK, [["support-tickets", "choice", 0.8, "confidence", "jev-1.14.0"],
                                                                ["support-v2", "choice", 0.85, "confidence", "jev-1.15.0"]])},
                       "signal": {"argv": ["checks", "thresholds", "--signal", "top_probability"], "setup": save_all,
                                  "stdout": table(SUMMARY, [["wants_refund", 1, 0.75, 0.75, 0.75, "top_probability"]])},
                       "format": {"argv": ["checks", "thresholds", "--signal", "top_probability", "--format", "csv"], "setup": save_all,
                                  "stdout": kit.render(SUMMARY, [["wants_refund", 1, 0.75, 0.75, 0.75, "top_probability"]], "csv") + "\n"}}},
    "export": {"argv": ["checks", "export", "support-tickets"], "setup": save_all,
               "stdout": same_json(dict(EXPORTED, saved_at="2026-10-02T00:00:00Z")),
               "options": {
                   "out": {"argv": ["checks", "export", "support-tickets", "--out", str(OUT)], "setup": save_all,
                           "stdout": wrote(OUT, "wrote the check of support-tickets to %s\n" % OUT, dict(EXPORTED, saved_at="2026-10-02T00:00:00Z"))},
                   "force": {"argv": ["checks", "export", "support-tickets", "--out", str(EXISTING), "--force", "--no-time"], "setup": save_all,
                             "stdout": wrote(EXISTING, "wrote the check of support-tickets to %s\n" % EXISTING, EXPORTED)},
                   "no_time": {"argv": ["checks", "export", "support-tickets", "--no-time"], "setup": save_all, "stdout": same_json(EXPORTED)}}},
    "fits": {"argv": ["checks", "fits", "support-tickets", "support-v2"], "setup": save_all,
             "stdout": "fits support-v2\nnote: department is worded differently there, so its threshold may not carry over\n"
                       "note: slice target channel = fax matches no tuning row there\n",
             "options": {
                 "questions": {"argv": ["checks", "fits", "support-tickets", "--questions", str(QUESTION_FILE)], "setup": save_all, "code": 1,
                               "stdout": "does not fit %s: The check gates 'is_urgent', which is not one of the dataset's questions\n" % QUESTION_FILE},
                 "strict": {"argv": ["checks", "fits", "support-v2", "support-tickets", "--strict"], "setup": save_all, "code": 1,
                            "stdout": "fits support-tickets\nnote: department is worded differently there, so its threshold may not carry over\n"}}},
    "models": {"argv": ["checks", "models"], "setup": save_all,
               "stdout": table(MODELS, [["jev-1.14.0", True, 1, "jev-1.14.0", "support-tickets"], ["jev-1.15.0", True, 1, "jev-1.14.0", "support-v2"],
                                        ["jev-latest", False, 1, "", "refund-requests"]]),
               "options": {
                   "aliases": {"argv": ["checks", "models", "--aliases"], "setup": save_all, "code": 1,
                               "stdout": table(MODELS, [["jev-latest", False, 1, "", "refund-requests"]])},
                   "format": {"argv": ["checks", "models", "--aliases", "--format", "json"], "setup": save_all, "code": 1,
                              "stdout": same_json([dict(zip(MODELS, ["jev-latest", False, 1, "", "refund-requests"]))])}}},
    "stale": {"argv": ["checks", "stale"], "setup": save_all, "code": 1,
              "stdout": table(STALE, [["support-tickets", "2026-10-02T00:00:00Z", "2026-10-05T00:00:00Z"]]),
              "options": {
                  "format": {"argv": ["checks", "stale", "--format", "json"], "setup": save_all, "code": 1,
                             "stdout": same_json([dict(zip(STALE, ["support-tickets", "2026-10-02T00:00:00Z", "2026-10-05T00:00:00Z"]))])}}},
    "slices": {"argv": ["checks", "slices"], "setup": save_all, "stdout": table(SLICE_COLUMNS, SLICE_ROWS),
               "options": {
                   "field": {"argv": ["checks", "slices", "--field", "store"], "setup": save_all, "stdout": "no saved check has slice targets on store\n"},
                   "format": {"argv": ["checks", "slices", "--format", "json"], "setup": save_all,
                              "stdout": same_json([dict(zip(SLICE_COLUMNS, row)) for row in SLICE_ROWS])}}},
    "cuts": {"argv": ["checks", "cuts"], "setup": save_all, "stdout": table(CUTS, [["support-tickets", "department", 0.12, 0.9, True]]),
             "options": {"format": {"argv": ["checks", "cuts", "--format", "csv"], "setup": save_all,
                                    "stdout": kit.render(CUTS, [["support-tickets", "department", 0.12, 0.9, True]], "csv") + "\n"}}},
}


class CliChecksTests(pack_tests(cli_checks.PACK, CASES)):
    def test_fits_notes_a_reordered_choice_but_not_reordered_fields(self):
        department = QUESTIONS["department"]
        reordered = DIR / "reordered-options.json"
        reordered.write_text(json.dumps(dict(QUESTIONS, department=dict(department, criteria=dict(reversed(list(department["criteria"].items())))))))
        code, out, _err = run_cli(["checks", "fits", "support-tickets", "--questions", reordered, "--strict"], save_all)
        self.assertEqual(code, 1)
        self.assertIn("note: department is worded differently there", out)
        same = DIR / "reordered-fields.json"
        same.write_text(json.dumps(dict(QUESTIONS, department=dict(reversed(list(department.items()))))))
        code, out, _err = run_cli(["checks", "fits", "support-tickets", "--questions", same, "--strict"], save_all)
        self.assertNotIn("department is worded differently", out)

    def test_empty_data_directory(self):
        self.assertEqual(run_cli(["checks", "list"]), (0, "no saved dataset holds a check\n", ""))
        self.assertEqual(run_cli(["checks", "stale"])[0:2], (0, "every check was saved after its dataset's rows\n"))
        self.assertEqual(run_cli(["checks", "validate"])[0:2], (0, "every saved check is valid\n"))

    def test_usage_errors_exit_two(self):
        for argv in (["checks", "export", "no-check"], ["checks", "fits", "support-tickets"],
                     ["checks", "fits", "support-tickets", "support-v2", "--questions", str(QUESTION_FILE)],
                     ["checks", "validate", "--dataset", "no-check"], ["checks", "export", "support-tickets", "--out", str(EXISTING)]):
            self.assertEqual(run_cli(argv, save_all)[0], 2, argv)

    def test_held_out_rows_never_shown(self):
        for argv in (["checks", "validate"], ["checks", "export", "support-tickets"], ["checks", "fits", "support-tickets", "support-v2"]):
            self.assertNotIn("Held fax", run_cli(argv, save_all)[1])
