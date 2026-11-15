"""Tests for the cli-drift Lab pack (jev/lab/packs/cli_drift.py): offline input comparisons before a drift run.
Fictional Harbor Coffee Co. data only."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_drift  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


ROWS = [
    {"text": "Charged twice for my order", "channel": "email", "_expect": {"team": "billing"}},
    {"text": "Bag torn", "channel": "chat"},
    {"text": "Where is my parcel", "channel": "email", "order": 12},
    "Grinder squeals",
    {"text": "Held out secret ticket", "channel": "fax", "_test": True, "_expect": {"team": "shipping"}},
]
QUESTIONS = {"team": {"type": "choice", "instructions": "Which team handles `text`?", "criteria": {"billing": "Money", "shipping": "Parcels"}},
             "late": {"type": "noul", "instructions": "Is order `order` late?"},
             "tone": {"type": "noul", "instructions": "Is the customer polite?"}}
NEW = [
    {"text": "Bag torn", "channel": "chat"},
    {"text": "Held out secret ticket", "channel": "fax"},
    {"text": "New ticket marked", "_test": True},
    {"text": "My espresso machine leaks water all over the counter every morning", "channel": "web", "order": "A-12", "rush": True},
    {"text": "Refund please", "channel": "email", "_expect": {"team": "billing"}},
    {"text": "Refund please", "channel": "email"},
]


def _text(length):
    return ("Harbor espresso order " * 4)[:length]


LONG = [{"text": _text(40)}, {"text": _text(50)}, {"text": _text(66)}]
PHOTO_ROWS = [{"note": "Seal split", "_image": "torn-bag"}, {"note": "Fine"},
              {"note": "Held dent", "_image": "intact-bag", "_test": True}]
PHOTOS = [{"note": "Box crushed", "_image": "intact-bag"}, {"note": "Seal split again", "_image": "torn-bag"},
          {"note": "Upload", "_image": "0123456789abcdef.png"}, {"note": "No photo"}]


def jsonl(rows):
    return "\n".join(json.dumps(row) for row in rows) + "\n"


NEW_FILE, LONG_FILE, PHOTO_FILE, CSV_FILE = DIR / "new.jsonl", DIR / "long.jsonl", DIR / "photos.jsonl", DIR / "new.txt"
NEW_FILE.write_text(jsonl(NEW))
LONG_FILE.write_text(jsonl(LONG))
PHOTO_FILE.write_text(jsonl(PHOTOS))
CSV_FILE.write_text("text,channel\nBag torn,chat\nBrand new,web\n")
LEFT_OUT = "left out 2 new rows: 1 marked as test rows, 1 copying the dataset's held-out rows\n"


def save(directory):
    workbench.save_dataset({"name": "Cafe tickets", "rows": ROWS, "questions": QUESTIONS})
    workbench.save_dataset({"name": "Parcel photos", "rows": PHOTO_ROWS})


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


FIELDS = ["field", "reference rows", "reference share", "new rows", "new share", "gap", "status"]
F_TEXT, F_CHANNEL = ["text", 4, 1.0, 4, 1.0, 0.0, ""], ["channel", 3, 0.75, 4, 1.0, 0.25, ""]
F_ORDER, F_RUSH = ["order", 1, 0.25, 1, 0.25, 0.0, ""], ["rush", 0, 0.0, 1, 0.25, 0.25, "new"]
VALUES = ["value", "reference rows", "reference share", "new rows", "new share", "status"]
V_EMAIL, V_CHAT = ["email", 2, 0.5, 2, 0.5, ""], ["chat", 1, 0.25, 1, 0.25, ""]
V_NONE, V_WEB = ["(none)", 1, 0.25, 0, 0.0, "gone"], ["web", 0, 0.0, 1, 0.25, "new"]
LENGTHS = ["field", "reference rows", "reference median", "reference p90", "new rows", "new median", "new p90", "ratio", "p"]
L_TEXT = ["text", 4, 16.5, 26, 3, 50.0, 66, 3.030303, 0.057143]  # 50 / 16.5; exact Mann-Whitney: 2 of 35 arrangements
L_CHANNEL = ["channel", 3, 5.0, 5, 0, None, None, None, None]
OVERLAP = ["kind", "new rows"]
KINDS = [["copies a tuning row", 1], ["copies a held-out row", 1], ["marked as a test row", 1], ["repeats an earlier new row", 1],
         ["new input", 2]]
TYPES = ["field", "reference types", "new types", "changed"]
T_ORDER = ["order", "number 1", "text 1", True]
PICTURES = ["measure", "reference", "new"]
DQ = ["question", "fields", "reference share", "new share", "gap"]
SUMMARY = ("cafe-tickets: 4 reference rows, 4 new rows\nfields added: rush\nfields gone: none\ntypes changed: order\n"
           "new values in slice fields: channel, order\nmedian length shifted: %s\nnew rows copying tuning rows: 1\nshifts: %d\n")

CASES = {
    "fields": {"argv": ["drift", "fields", "cafe-tickets", NEW_FILE], "setup": save, "stderr": LEFT_OUT,
               "stdout": table(FIELDS, [F_TEXT, F_CHANNEL, F_ORDER, F_RUSH]),
               "options": {
                   "min_gap": {"argv": ["drift", "fields", "cafe-tickets", NEW_FILE, "--min-gap", "0.2"], "setup": save, "code": 1,
                               "stdout": table(FIELDS, [F_CHANNEL, F_RUSH])},
                   "sort": {"argv": ["drift", "fields", "cafe-tickets", NEW_FILE, "--sort", "gap"], "setup": save,
                            "stdout": table(FIELDS, [F_CHANNEL, F_RUSH, F_TEXT, F_ORDER])},
                   "source": {"argv": ["drift", "fields", "cafe-tickets", CSV_FILE, "--from", "csv"], "setup": save, "stderr": "",
                              "stdout": table(FIELDS, [["text", 4, 1.0, 2, 1.0, 0.0, ""], F_CHANNEL[:3] + [2, 1.0, 0.25, ""],
                                                       ["order", 1, 0.25, 0, 0.0, -0.25, "gone"]])},
                   "format": {"argv": ["drift", "fields", "cafe-tickets", NEW_FILE, "--format", "json", "--min-gap", "0.25"], "setup": save,
                              "code": 1, "stdout": same_json([dict(zip(FIELDS, F_CHANNEL)), dict(zip(FIELDS, F_RUSH))])}}},
    "values": {"argv": ["drift", "values", "cafe-tickets", NEW_FILE, "--field", "channel"], "setup": save,
               "stdout": table(VALUES, [V_EMAIL, V_CHAT, V_NONE, V_WEB]),
               "options": {
                   "new_only": {"argv": ["drift", "values", "cafe-tickets", NEW_FILE, "--field", "channel", "--new-only"], "setup": save,
                                "code": 1, "stdout": table(VALUES, [V_WEB])},
                   "top": {"argv": ["drift", "values", "cafe-tickets", NEW_FILE, "--field", "channel", "--top", "2"], "setup": save,
                           "stdout": table(VALUES, [V_EMAIL, V_CHAT])},
                   "format": {"argv": ["drift", "values", "cafe-tickets", NEW_FILE, "--field", "channel", "--format", "csv", "--top", "1"],
                              "setup": save, "stdout": kit.render(VALUES, [V_EMAIL], "csv") + "\n"}}},
    "lengths": {"argv": ["drift", "lengths", "cafe-tickets", LONG_FILE], "setup": save, "stdout": table(LENGTHS, [L_TEXT, L_CHANNEL]),
                "options": {
                    "field": {"argv": ["drift", "lengths", "cafe-tickets", LONG_FILE, "--field", "channel"], "setup": save,
                              "stdout": table(LENGTHS, [L_CHANNEL])},
                    "min_ratio": {"argv": ["drift", "lengths", "cafe-tickets", LONG_FILE, "--min-ratio", "2"], "setup": save, "code": 1,
                                  "stdout": table(LENGTHS, [L_TEXT])},
                    "format": {"argv": ["drift", "lengths", "cafe-tickets", LONG_FILE, "--field", "text", "--format", "json"], "setup": save,
                               "stdout": same_json([dict(zip(LENGTHS, L_TEXT))])}}},
    "overlap": {"argv": ["drift", "overlap", "cafe-tickets", NEW_FILE], "setup": save, "stdout": table(OVERLAP, KINDS),
                "options": {
                    "rows": {"argv": ["drift", "overlap", "cafe-tickets", NEW_FILE, "--rows"], "setup": save,
                             "stdout": table(OVERLAP + ["row numbers"], [kind + [rows] for kind, rows in zip(KINDS, ["1", "2", "3", "6", "4, 5"])])},
                    "fail": {"argv": ["drift", "overlap", "cafe-tickets", NEW_FILE, "--fail"], "setup": save, "code": 1,
                             "stdout": table(OVERLAP, KINDS)},
                    "export": {"argv": ["drift", "overlap", "cafe-tickets", NEW_FILE, "--export"], "setup": save,
                               "stdout": json.dumps(dict(NEW[3])) + "\n" + json.dumps({"text": "Refund please", "channel": "email"}) + "\n"},
                    "format": {"argv": ["drift", "overlap", "cafe-tickets", NEW_FILE, "--format", "csv"], "setup": save,
                               "stdout": kit.render(OVERLAP, KINDS, "csv") + "\n"}}},
    "types": {"argv": ["drift", "types", "cafe-tickets", NEW_FILE], "setup": save,
              "stdout": table(TYPES, [["text", "text 4", "text 4", False], ["channel", "text 3", "text 4", False], T_ORDER,
                                      ["rush", "", "true/false 1", False]]),
              "options": {
                  "changed": {"argv": ["drift", "types", "cafe-tickets", NEW_FILE, "--changed"], "setup": save, "code": 1,
                              "stdout": table(TYPES, [T_ORDER])},
                  "format": {"argv": ["drift", "types", "cafe-tickets", NEW_FILE, "--changed", "--format", "json"], "setup": save, "code": 1,
                             "stdout": same_json([dict(zip(TYPES, T_ORDER))])}}},
    "pictures": {"argv": ["drift", "pictures", "parcel-photos", PHOTO_FILE], "setup": save,
                 "stdout": table(PICTURES, [["rows", 2, 4], ["rows with a picture", 1, 3], ["share with a picture", 0.5, 0.75],
                                            ["distinct pictures", 1, 3], ["sample pictures", 1, 2],
                                            ["pictures no reference row names", None, 2],
                                            ["pictures missing from the data directory", None, 1],
                                            ["rows naming a held-out row's picture", None, 1]]),
                 "options": {
                     "format": {"argv": ["drift", "pictures", "parcel-photos", PHOTO_FILE, "--format", "json"], "setup": save,
                                "stdout": lambda text: (json.loads(text)[5] == {"measure": "pictures no reference row names", "reference": None, "new": 2}
                                                        or (_ for _ in ()).throw(AssertionError(text)))}}},
    "questions": {"argv": ["drift", "questions", "cafe-tickets", LONG_FILE], "setup": save,
                  "stdout": table(DQ, [["team", "text", 1.0, 1.0, 0.0], ["late", "order", 0.25, 0.0, -0.25]]),
                  "options": {
                      "min_gap": {"argv": ["drift", "questions", "cafe-tickets", LONG_FILE, "--min-gap", "0.2"], "setup": save, "code": 1,
                                  "stdout": table(DQ, [["late", "order", 0.25, 0.0, -0.25]])},
                      "format": {"argv": ["drift", "questions", "cafe-tickets", NEW_FILE, "--format", "json"], "setup": save,
                                 "stdout": same_json([dict(zip(DQ, ["team", "text", 1.0, 1.0, 0.0])),
                                                      dict(zip(DQ, ["late", "order", 0.25, 0.25, 0.0]))])}}},
    "summary": {"argv": ["drift", "summary", "cafe-tickets", NEW_FILE], "setup": save, "code": 1, "stdout": SUMMARY % ("none", 4),
                "options": {
                    "ratio": {"argv": ["drift", "summary", "cafe-tickets", NEW_FILE, "--ratio", "1.2"], "setup": save, "code": 1,
                              "stdout": SUMMARY % ("text", 5)},
                    "json": {"argv": ["drift", "summary", "cafe-tickets", NEW_FILE, "--json"], "setup": save, "code": 1,
                             "stdout": same_json({"dataset": "cafe-tickets", "reference_rows": 4, "new_rows": 4, "left_out_marked": 1,
                                                  "left_out_held_out_copies": 1, "copies_of_tuning_rows": 1, "fields_added": ["rush"],
                                                  "fields_gone": [], "types_changed": ["order"], "new_slice_values": ["channel", "order"],
                                                  "lengths_shifted": [], "shifts": 4})}}},
}


class CliDriftTests(pack_tests(cli_drift.PACK, CASES)):
    def test_held_out_inputs_never_shown(self):
        for argv in (["drift", "values", "cafe-tickets", NEW_FILE, "--field", "text"], ["drift", "fields", "cafe-tickets", NEW_FILE, "--format", "json"],
                     ["drift", "summary", "cafe-tickets", NEW_FILE, "--json"]):
            code, out, err = run_cli(argv, save)
            self.assertNotIn("Held out", out + err)
            self.assertNotIn("fax", out + err)
            self.assertNotIn("shipping", out + err)

    def test_usage_errors_exit_two(self):
        for argv in (["drift", "fields", "no-such", NEW_FILE], ["drift", "fields", "cafe-tickets", DIR / "missing.jsonl"],
                     ["drift", "summary", "cafe-tickets", NEW_FILE, "--ratio", "1"], ["drift", "values", "cafe-tickets", NEW_FILE]):
            self.assertEqual(run_cli(argv, save)[0], 2, argv)

    def test_new_only_applies_before_top(self):
        # web is the only new channel and the least common value; --top 1 must not cut it away first.
        code, out, _err = run_cli(["drift", "values", "cafe-tickets", NEW_FILE, "--field", "channel", "--new-only", "--top", "1"], save)
        self.assertEqual((code, out), (1, table(VALUES, [V_WEB])))

    def test_text_rows_have_no_slice_value(self):
        # By slice reads a plain-text row as having no fields, so its text is "(none)", never its own value.
        code, out, _err = run_cli(["drift", "values", "cafe-tickets", NEW_FILE, "--field", "text", "--format", "json"], save)
        self.assertEqual(code, 0)
        values = {row["value"]: row["reference rows"] for row in json.loads(out)}
        self.assertNotIn("Grinder squeals", values)
        self.assertEqual(values["(none)"], 1)

    def test_new_rows_checked_as_the_drift_panel_checks_them(self):
        bad_marker, too_many = DIR / "bad-marker.jsonl", DIR / "too-many.jsonl"
        bad_marker.write_text(jsonl([{"text": "Bag torn", "_test": "true"}]))
        too_many.write_text(jsonl([{"text": "Ticket %d" % n} for n in range(workbench.MAX_BULK_ROWS + 1)]))
        for path in (bad_marker, too_many):
            for command in ("fields", "overlap"):
                code, _out, err = run_cli(["drift", command, "cafe-tickets", path], save)
                self.assertEqual(code, 2, (command, path.name, err))
