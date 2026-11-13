"""Tests for the cli-rows Lab pack (jev/lab/packs/cli_rows.py): offline commands for Bulk rows files.
Fictional Harbor Coffee Co. rows only. The held-out row's label value ("returns") appears in no other row, so a test can
check that no summary and no printed row shows it."""

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import ROOT, pack_tests, run_cli  # noqa: E402
from jev import images  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_rows  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


def write(name, text):
    path = DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return str(path)


def folder(name):
    path = DIR / name
    path.mkdir()
    return str(path)


L1 = "Bag arrived torn"
L2 = {"text": "Charged twice", "channel": "email", "_expect": {"department": "billing", "is_urgent": True}}
L3 = {"text": "Refund please", "channel": "email", "_expect": {"department": "returns"}, "_test": True}
L4 = {"text": "Grinder squeals", "channel": "chat", "_image": "grinder-ok"}
L5 = {"channel": "email", "text": "Charged twice", "_expect": {"department": "shipping"}}
L7 = {"text": "Decaf?", "channel": "phone", "_expect": {"frustration": 0}}
L3_SHOWN = {"text": "Refund please", "channel": "email", "_test": True}


def line(row):
    return row if isinstance(row, str) else json.dumps(row, ensure_ascii=False)


def lines(*rows):
    return "".join(line(row) + "\n" for row in rows)


TICKETS = write("tickets.jsonl", lines(L1, L2, L3, L4, L5) + "\n" + lines(L7))
SECRET = "returns"
HIDDEN = "left out the labels of 1 held-out row; write them to a file with --out\n"
MORE = write("more.jsonl", lines(
    {"channel": "chat", "text": "Grinder squeals", "_image": "grinder-ok", "_expect": {"department": "product"}, "_test": True},
    "Refund please",
    {"text": "Decaf?", "channel": "phone", "_expect": {"frustration": 1}}))
BAD = write("bad.jsonl", lines("Bag torn") + "{broken\n" + lines(
    {"text": "x", "_expect": "billing"}, {"_expect": {"department": "billing"}}, {"text": "y", "_test": "yes"},
    {"text": "z", "_image": "nope.gif"}, {"text": "Bag torn"}))
QUESTIONS = write("questions.json", json.dumps({
    "department": {"type": "choice", "instructions": "Which team should handle the ticket?",
                   "criteria": {"billing": "Charges and refunds", "shipping": "Delivery", "product": "Products"}},
    "is_urgent": {"type": "noul", "instructions": "Does it need action today?"},
    "frustration": {"type": "score", "instructions": "How frustrated is the customer?", "criteria": ["calm", "annoyed", "angry"]}}))
LABELED = write("labeled.jsonl", lines(
    {"text": "a", "_expect": {"department": "refunds"}}, {"text": "b", "_expect": {"mood": "calm"}},
    {"text": "c", "_expect": {"is_urgent": "maybe"}, "_test": True}, {"text": "d", "_expect": {"frustration": 2, "department": "billing"}}))
TSV_DATA = write("export.data", "text\tchannel\t_expect.frustration\nOat latte spilled\tchat\t2\n")
PICTURE_PROBLEM = "_image must name a sample picture (%s) or a picture saved with Add pictures" % ", ".join(images.SAMPLES)
BAD_PROBLEMS = [[2, "starts with { but is not a JSON object, so Bulk would read it as text"],
                [3, "_expect must be an object keyed by question id"], [4, "has labels but no state"],
                [5, "_test must be true, or left out"], [6, PICTURE_PROBLEM]]
CSV_SHOWN = ("text,channel,_image,_expect.department,_expect.is_urgent,_expect.frustration,_test\n"
             "Bag arrived torn,,,,,,\nCharged twice,email,,billing,true,,\nRefund please,email,,,,,true\n"
             "Grinder squeals,chat,grinder-ok,,,,\nCharged twice,email,,shipping,,,\nDecaf?,phone,,,,0,\n")
EXISTING = write("existing.csv", "old\n")
INSIDE = ROOT / "data" / "workbench" / "lab-rows-test-never-written.jsonl"


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


def wrote(path, count, content):
    def check(text):
        if text != "wrote %d rows to %s\n" % (count, path):
            raise AssertionError(text)
        if Path(path).read_text(encoding="utf-8") != content:
            raise AssertionError(Path(path).read_text(encoding="utf-8"))
    return check


def files(directory, expected):
    """The command's file table, and the files it wrote with their exact contents."""
    def check(text):
        if text != table(["file", "rows"], [[name, count] for name, count, _content in expected]):
            raise AssertionError(text)
        for name, _count, content in expected:
            if (Path(directory) / name).read_text(encoding="utf-8") != content:
                raise AssertionError("%s: %r" % (name, (Path(directory) / name).read_text(encoding="utf-8")))
    return check


def mulberry32(seed):
    """The published mulberry32 generator (32-bit state), written out from its JavaScript original."""
    state = [seed % 2 ** 32]

    def following():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 2 ** 32
    return following


def floyd(count, size, seed):
    """Floyd's algorithm for `size` distinct indexes of `count`, in ascending order."""
    random, chosen = mulberry32(seed), set()
    for top in range(count - size, count):
        pick = math.floor(random() * (top + 1))
        chosen.add(top if pick in chosen else pick)
    return sorted(chosen)


ALL = [L1, L2, L3, L4, L5, L7]
SHOWN = [L1, L2, L3_SHOWN, L4, L5, L7]
TUNING = [L1, L2, L4, L5, L7]
SPLIT1, SPLIT2, SPLIT3, SPLIT4 = folder("split1"), folder("split2"), folder("split3"), folder("split4")
write("split4/chat.jsonl", "old\n")
STRIPPED = ["Bag arrived torn", {"text": "Charged twice", "channel": "email"}, {"text": "Refund please", "channel": "email"},
            {"text": "Grinder squeals", "channel": "chat", "_image": "grinder-ok"}, {"channel": "email", "text": "Charged twice"},
            {"text": "Decaf?", "channel": "phone"}]
STRIP_NOTE = "removed labels from 4 rows and test markers from 1\n"
L4_HELD = {"text": "Grinder squeals", "channel": "chat", "_image": "grinder-ok", "_test": True}
MERGED = [L1, L2, L3, L4_HELD, L7, "Refund please"]
MERGE_NOTE = "kept 6 of 9 rows: 3 duplicate copies left out, 2 inputs with conflicting labels, 1 marked held out because a copy was\n"
FIELDS = ["field", "rows", "fill %", "types", "distinct"]
OUT = {name: str(DIR / name) for name in ("convert.csv", "sample.jsonl", "strip.jsonl", "merge.jsonl", "fill.jsonl")}

CASES = {
    "count": {"argv": ["rows", "count", TICKETS],
              "stdout": table(["metric", "value"], [["rows", 6], ["text rows", 1], ["object rows", 5], ["labeled rows", 4],
                                                    ["held-out rows", 1], ["picture rows", 1], ["distinct inputs", 5],
                                                    ["duplicate copies", 1]]),
              "options": {
                  "by": {"argv": ["rows", "count", TICKETS, "--by", "channel"],
                         "stdout": table(["channel", "rows", "labeled", "held out"],
                                         [["email", 3, 3, 1], ["(missing)", 1, 0, 0], ["chat", 1, 0, 0], ["phone", 1, 1, 0]])},
                  "format": {"argv": ["rows", "count", BAD, "--format", "json"],
                             # BAD read as Bulk reads it: "{broken" is a text row; "Bag torn" and {"text": "Bag torn"} match.
                             "stdout": same_json([{"metric": m, "value": v} for m, v in [
                                 ["rows", 7], ["text rows", 2], ["object rows", 5], ["labeled rows", 1], ["held-out rows", 0],
                                 ["picture rows", 1], ["distinct inputs", 6], ["duplicate copies", 1]]])}}},
    "fields": {"argv": ["rows", "fields", TICKETS],
               "stdout": table(FIELDS, [["text", 6, 100.0, "text", 5], ["channel", 5, 83.3, "text", 3], ["_image", 1, 16.7, "text", 1]]),
               "options": {
                   "labels": {"argv": ["rows", "fields", TICKETS, "--labels"],
                              "stdout": table(["question", "labeled", "tuning", "held out", "fill %", "distinct (tuning)"],
                                              [["department", 3, 2, 1, 50.0, 2], ["is_urgent", 1, 1, 0, 16.7, 1],
                                               ["frustration", 1, 1, 0, 16.7, 1]])},
                   "min_fill": {"argv": ["rows", "fields", TICKETS, "--min-fill", "0.5"],
                                "stdout": table(FIELDS, [["text", 6, 100.0, "text", 5], ["channel", 5, 83.3, "text", 3]])},
                   "format": {"argv": ["rows", "fields", LABELED, "--format", "csv"],
                              "stdout": kit.render(FIELDS, [["text", 4, 100.0, "text", 4]], "csv") + "\n"}}},
    "validate": {"argv": ["rows", "validate", BAD], "code": 1, "stdout": table(["line", "problem"], BAD_PROBLEMS),
                 "options": {
                     "questions": {"argv": ["rows", "validate", LABELED, "--questions", QUESTIONS], "code": 1,
                                   "stdout": table(["line", "problem"], [
                                       [1, "has a label for department that fits none of its answers"],
                                       [2, "labels mood, which the questions do not ask"],
                                       [3, "has a label for is_urgent that fits none of its answers"]])},
                     "strict": {"argv": ["rows", "validate", TICKETS, "--strict"], "code": 1,
                                "stdout": table(["line", "problem"], [[5, "repeats the input of line 2"]])},
                     "format": {"argv": ["rows", "validate", BAD, "--format", "json"], "code": 1,
                                "stdout": same_json([{"line": n, "problem": p} for n, p in BAD_PROBLEMS])}}},
    "convert": {"argv": ["rows", "convert", TICKETS, "--to", "csv"], "stdout": CSV_SHOWN, "stderr": HIDDEN,
                "options": {
                    "from": {"argv": ["rows", "convert", TSV_DATA, "--from", "tsv", "--to", "jsonl"],
                             "stdout": lines({"text": "Oat latte spilled", "channel": "chat", "_expect": {"frustration": 2}})},
                    "out": {"argv": ["rows", "convert", TICKETS, "--to", "csv", "--out", OUT["convert.csv"]],
                            "stdout": wrote(OUT["convert.csv"], 6, CSV_SHOWN.replace("Refund please,email,,,,,true",
                                                                                     "Refund please,email,,returns,,,true"))},
                    "force": {"argv": ["rows", "convert", TICKETS, "--to", "lines", "--out", EXISTING, "--force"],
                              "stdout": wrote(EXISTING, 6, "Bag arrived torn\nCharged twice\nRefund please\nGrinder squeals\n"
                                                           "Charged twice\nDecaf?\n")}}},
    "formats": {"argv": ["rows", "formats", "--format", "json"],
                "stdout": lambda text: [row for row in json.loads(text) if row["format"] in ("csv", "jsonl", "markdown")] == [
                    {"format": "csv", "reads": True, "writes": True, "extensions": ".csv",
                     "description": "CSV with a header line, labels in _expect.<question> columns and formula cells defused"},
                    {"format": "jsonl", "reads": True, "writes": True, "extensions": ".jsonl .ndjson",
                     "description": "JSON lines as Bulk reads them: one text row or JSON object per line"},
                    {"format": "markdown", "reads": True, "writes": True, "extensions": ".md .markdown",
                     "description": "a Markdown table, pipes escaped and line breaks as <br>"}] or (_ for _ in ()).throw(AssertionError(text))},
    "head": {"argv": ["rows", "head", TICKETS], "stdout": lines(*SHOWN[:5]), "stderr": HIDDEN,
             "options": {
                 "rows": {"argv": ["rows", "head", TICKETS, "-n", "2"], "stdout": lines(L1, L2), "stderr": ""},
                 "to": {"argv": ["rows", "head", TICKETS, "-n", "2", "--to", "markdown"],
                        "stdout": "| text | channel | _expect.department | _expect.is_urgent |\n| --- | --- | --- | --- |\n"
                                  "| Bag arrived torn |  |  |  |\n| Charged twice | email | billing | true |\n"}}},
    "sample": {"argv": ["rows", "sample", TICKETS, "--size", "3"], "stdout": lines(*[SHOWN[i] for i in floyd(6, 3, 0)]),
               "options": {
                   "seed": {"argv": ["rows", "sample", TICKETS, "--size", "3", "--seed", "42"],
                            "stdout": lines(*[SHOWN[i] for i in floyd(6, 3, 42)])},
                   "tuning": {"argv": ["rows", "sample", TICKETS, "--size", "4", "--tuning"], "stderr": "",
                              "stdout": lines(*[TUNING[i] for i in floyd(5, 4, 0)])},
                   "out": {"argv": ["rows", "sample", TICKETS, "--size", "6", "--out", OUT["sample.jsonl"]],
                           "stdout": wrote(OUT["sample.jsonl"], 6, lines(*ALL))}}},
    "split": {"argv": ["rows", "split", TICKETS, "--by", "channel", "--out-dir", SPLIT1],
              "stdout": files(SPLIT1, [["_missing.jsonl", 1, lines(L1)], ["chat.jsonl", 1, lines(L4)],
                                       ["email.jsonl", 3, lines(L2, L3, L5)], ["phone.jsonl", 1, lines(L7)]]),
              "options": {
                  "held_out": {"argv": ["rows", "split", TICKETS, "--held-out", "--out-dir", SPLIT2],
                               "stdout": files(SPLIT2, [["test.jsonl", 1, lines(L3)], ["tuning.jsonl", 5, lines(*TUNING)]])},
                  "to": {"argv": ["rows", "split", TICKETS, "--held-out", "--out-dir", SPLIT3, "--to", "csv"],
                         "stdout": files(SPLIT3, [["test.csv", 1, "text,channel,_expect.department,_test\nRefund please,email,returns,true\n"],
                                                  ["tuning.csv", 5, "text,channel,_image,_expect.department,_expect.is_urgent,"
                                                   "_expect.frustration\nBag arrived torn,,,,,\nCharged twice,email,,billing,true,\n"
                                                   "Grinder squeals,chat,grinder-ok,,,\nCharged twice,email,,shipping,,\nDecaf?,phone,,,,0\n"]])},
                  "force": {"argv": ["rows", "split", TICKETS, "--by", "channel", "--out-dir", SPLIT4, "--force"],
                            "stdout": files(SPLIT4, [["_missing.jsonl", 1, lines(L1)], ["chat.jsonl", 1, lines(L4)],
                                                     ["email.jsonl", 3, lines(L2, L3, L5)], ["phone.jsonl", 1, lines(L7)]])}}},
    "strip": {"argv": ["rows", "strip", TICKETS], "stdout": lines(*STRIPPED), "stderr": STRIP_NOTE,
              "options": {
                  "pictures": {"argv": ["rows", "strip", TICKETS, "--pictures"], "stderr": STRIP_NOTE,
                               "stdout": lines(*(STRIPPED[:3] + [{"text": "Grinder squeals", "channel": "chat"}] + STRIPPED[4:]))},
                  "drop": {"argv": ["rows", "strip", TICKETS, "--drop", "channel"], "stderr": STRIP_NOTE,
                           "stdout": lines("Bag arrived torn", {"text": "Charged twice"}, {"text": "Refund please"},
                                           {"text": "Grinder squeals", "_image": "grinder-ok"}, {"text": "Charged twice"},
                                           {"text": "Decaf?"})},
                  "out": {"argv": ["rows", "strip", TICKETS, "--out", OUT["strip.jsonl"]],
                          "stdout": wrote(OUT["strip.jsonl"], 6, lines(*STRIPPED))}}},
    "merge": {"argv": ["rows", "merge", TICKETS, MORE],
              "stdout": lines(L1, L2, L3_SHOWN, L4_HELD, L7, "Refund please"), "stderr": HIDDEN + MERGE_NOTE,
              "options": {
                  "prefer": {"argv": ["rows", "merge", TICKETS, MORE, "--prefer", "last"],
                             "stdout": lines(L1, {"text": "Charged twice", "channel": "email", "_expect": {"department": "shipping"}},
                                             L3_SHOWN, L4_HELD, {"text": "Decaf?", "channel": "phone", "_expect": {"frustration": 1}},
                                             "Refund please"),
                             "stderr": HIDDEN.replace("1 held-out row", "2 held-out rows") + MERGE_NOTE},
                  "fill_labels": {"argv": ["rows", "merge", TICKETS, MORE, "--fill-labels", "--out", OUT["fill.jsonl"]],
                                  "stdout": wrote(OUT["fill.jsonl"], 6, lines(
                                      L1, L2, L3, dict(L4, _expect={"department": "product"}, _test=True), L7, "Refund please")),
                                  "stderr": MERGE_NOTE},
                  "out": {"argv": ["rows", "merge", TICKETS, "--out", OUT["merge.jsonl"]],
                          "stdout": wrote(OUT["merge.jsonl"], 5, lines(L1, L2, L3, L4, L7)),
                          "stderr": "kept 5 of 6 rows: 1 duplicate copy left out, 1 input with conflicting labels, "
                                    "0 marked held out because a copy was\n"}}},
    "filter": {"argv": ["rows", "filter", TICKETS], "stdout": lines(*SHOWN), "stderr": HIDDEN + "kept 6 of 6 rows\n",
               "options": {
                   "where": {"argv": ["rows", "filter", TICKETS, "--where", "channel=email"], "stdout": lines(L2, L3_SHOWN, L5),
                             "stderr": HIDDEN + "kept 3 of 6 rows\n"},
                   "labeled": {"argv": ["rows", "filter", TICKETS, "--labeled", "frustration"], "stdout": lines(L7),
                               "stderr": "kept 1 of 6 rows\n"},
                   "tuning": {"argv": ["rows", "filter", TICKETS, "--tuning", "--labeled"], "stdout": lines(L2, L5, L7),
                              "stderr": "kept 3 of 6 rows\n"},
                   "held_out": {"argv": ["rows", "filter", TICKETS, "--held-out"], "stdout": lines(L3_SHOWN),
                                "stderr": HIDDEN + "kept 1 of 6 rows\n"}}},
}


class CliRowsTests(pack_tests(cli_rows.PACK, CASES)):
    def test_held_out_label_values_never_reach_the_screen(self):
        for argv in (["rows", "count", TICKETS], ["rows", "count", TICKETS, "--by", "channel"], ["rows", "fields", TICKETS, "--labels"],
                     ["rows", "convert", TICKETS, "--to", "markdown"], ["rows", "convert", TICKETS, "--to", "html"],
                     ["rows", "head", TICKETS, "-n", "6"], ["rows", "merge", TICKETS, MORE, "--fill-labels"],
                     ["rows", "filter", TICKETS, "--held-out", "--to", "json"], ["rows", "sample", TICKETS, "--size", "6"],
                     ["rows", "split", TICKETS, "--held-out", "--out-dir", folder("split-quiet")]):
            code, out, err = run_cli(argv)
            self.assertEqual(code, 0, argv)
            self.assertNotIn(SECRET, out + err, argv)
            self.assertNotIn("product", out + err if argv[1] == "merge" else "", argv)

    def test_writes_stay_outside_the_data_directory_and_never_replace_without_force(self):
        code, _out, err = run_cli(["rows", "convert", TICKETS, "--to", "csv", "--out", EXISTING])
        self.assertEqual(code, 2)
        self.assertIn("already exists", err)
        code, _out, err = run_cli(["rows", "strip", TICKETS, "--out", str(INSIDE)])
        self.assertEqual(code, 2)
        self.assertIn("inside the Workbench data directory", err)
        self.assertFalse(INSIDE.exists())
        code, _out, err = run_cli(["rows", "split", TICKETS, "--by", "channel", "--out-dir", str(ROOT / "data" / "workbench")])
        self.assertEqual(code, 2)
        self.assertIn("inside the Workbench data directory", err)
        busy = folder("split-busy")
        write("split-busy/email.jsonl", "keep me\n")
        code, _out, err = run_cli(["rows", "split", TICKETS, "--by", "channel", "--out-dir", busy])
        self.assertEqual(code, 2)
        self.assertIn("email.jsonl already exists", err)
        self.assertEqual(sorted(path.name for path in Path(busy).iterdir()), ["email.jsonl"], "nothing is written when one file exists")

    def test_usage_errors_exit_two(self):
        for argv in (["rows", "count", str(DIR / "missing.jsonl")], ["rows", "convert", TICKETS, "--to", "yaml"],
                     ["rows", "convert", TICKETS, "--to", "csv", "--force"], ["rows", "head", TICKETS, "-n", "0"],
                     ["rows", "sample", TICKETS, "--size", "7"], ["rows", "split", TICKETS, "--out-dir", SPLIT1],
                     ["rows", "filter", TICKETS, "--where", "channel"], ["rows", "fields", TICKETS, "--min-fill", "2"],
                     ["rows", "validate", TICKETS, "--questions", str(DIR / "missing.json")],
                     ["rows", "convert", write("table.md", "| text |\n| Bag |\n"), "--to", "jsonl"],
                     ["rows", "merge", BAD]):
            self.assertEqual(run_cli(argv)[0], 2, argv)

    def test_conversions_round_trip_through_every_tabular_format(self):
        for name in ("csv", "tsv", "semicolon", "pipe", "excel", "markdown", "html", "json"):
            target = str(DIR / ("round.%s" % name))
            self.assertEqual(run_cli(["rows", "convert", TICKETS, "--to", name, "--out", target])[0], 0, name)
            code, out, _err = run_cli(["rows", "convert", target, "--from", name, "--to", "jsonl", "--out", target + ".jsonl"])
            self.assertEqual(code, 0, name)
            back = [json.loads(text) if text.startswith("{") else text
                    for text in Path(target + ".jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(back, ALL, name)  # field order aside, every row comes back, held-out labels included

    def test_labels_and_test_markers_are_not_fields(self):
        # Grouping, splitting or filtering by _expect would print or test the held-out label value.
        for argv in (["rows", "count", TICKETS, "--by", "_expect"], ["rows", "count", TICKETS, "--by", "_test"],
                     ["rows", "split", TICKETS, "--by", "_expect", "--out-dir", folder("split-labels")],
                     ["rows", "filter", TICKETS, "--where", '_expect={"department": "returns"}'],
                     ["rows", "filter", TICKETS, "--where", " _test =true"]):
            code, out, err = run_cli(argv)
            self.assertEqual(code, 2, argv)
            self.assertNotIn(SECRET, out + err, argv)
            self.assertIn("cannot be one", err, argv)
        self.assertEqual(list(Path(DIR / "split-labels").iterdir()), [])

    def test_split_keeps_a_value_named_missing_apart_from_missing_values(self):
        source = write("missing-word.jsonl", lines({"text": "a", "channel": "_missing"}, "b"))
        target = folder("split-missing")
        self.assertEqual(run_cli(["rows", "split", source, "--by", "channel", "--out-dir", target])[:2],
                         (0, table(["file", "rows"], [["_missing.jsonl", 1], ["missing.jsonl", 1]])))
        self.assertEqual((Path(target) / "_missing.jsonl").read_text(encoding="utf-8"), "b\n")
        self.assertEqual((Path(target) / "missing.jsonl").read_text(encoding="utf-8"), lines({"text": "a", "channel": "_missing"}))

    def test_valid_file_message(self):
        self.assertEqual(run_cli(["rows", "validate", TICKETS])[:2], (0, "every row is valid (6 rows)\n"))


if __name__ == "__main__":
    unittest.main()
