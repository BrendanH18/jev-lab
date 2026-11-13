"""`lab.py datasets list|show|fields|slices|check|history|questions|pictures|find` (jev/lab/packs/cli_datasets_browse.py).

Every case saves fixture datasets (tests/lab_datasets_fixtures.py) in a temporary data directory and states the
output by hand. Held-out rows must only ever be counted: every JSON matcher also fails on a held-out input."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev.lab.packs import cli_datasets_browse  # noqa: E402
import lab_datasets_fixtures as fx  # noqa: E402

ALL = fx.save_all
SAVED = ("saved",)


def case(argv, stdout, code=0, setup=ALL):
    return {"argv": argv, "stdout": stdout, "code": code, "setup": setup}


PHOTO = {"id": "photo-claims", "name": "Photo claims", "rows": 6, "test": 2, "labeled": 0, "questions": 0, "check": False}
REFUND = {"id": "refund-requests", "name": "Refund requests", "rows": 4, "test": 0, "labeled": 3, "questions": 2, "check": True}
SUPPORT = {"id": "support-tickets", "name": "Support tickets", "rows": 8, "test": 2, "labeled": 7, "questions": 3, "check": True}
STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"

LIST = ["datasets", "list"]
SHOW = ["datasets", "show", "support-tickets", "--format", "json"]
FIELDS = ["datasets", "fields"]
SLICES = ["datasets", "slices", "support-tickets", "channel", "--format", "json"]
CHECK = ["datasets", "check", "support-tickets", "--format", "json"]
HISTORY = ["datasets", "history", "old-menu", "--format", "json"]
QUESTIONS = ["datasets", "questions", "--format", "json"]
FIND = ["datasets", "find"]


def ids(*names):
    return fx.column_is("id", list(names))


def slice_row(value, tuning, test, labeled, **extra):
    return dict({"value": value, "tuning": tuning, "test": test, "labeled": labeled}, **extra)


NEWEST = {"revision": "20260301T120000000000Z-bbbbbbbbbbbb", "at": "2026-03-01T12:00:00.000000Z", "rows": 3, "labeled": 1,
          "test": 0, "questions": 1, "check": False, "current": False}
OLDEST = {"revision": "20250101T000000000000Z-aaaaaaaaaaaa", "at": "2025-01-01T00:00:00.000000Z", "rows": 2, "labeled": 0,
          "test": 0, "questions": 0, "check": False, "current": False}

CASES = {
    "list": dict(case(LIST, fx.lines_match([
        r"id\s+name\s+rows\s+test\s+labeled\s+questions\s+check\s+saved", r"[- ]+",
        r"photo-claims\s+Photo claims\s+6\s+2\s+0\s+0\s+no\s+" + STAMP,
        r"refund-requests\s+Refund requests\s+4\s+0\s+3\s+2\s+yes\s+" + STAMP,
        r"support-tickets\s+Support tickets\s+8\s+2\s+7\s+3\s+yes\s+" + STAMP])), options={
        "format": case(LIST + ["--format", "json"], fx.json_is([PHOTO, REFUND, SUPPORT], SAVED)),
        "sort": case(LIST + ["--sort", "rows", "--format", "json"], ids("support-tickets", "photo-claims", "refund-requests")),
        "reverse": case(LIST + ["--reverse", "--format", "json"], ids("support-tickets", "refund-requests", "photo-claims")),
        "limit": case(LIST + ["--limit", "2", "--format", "json"], ids("photo-claims", "refund-requests")),
        "search": case(LIST + ["--search", "INBOX", "--format", "json"], ids("support-tickets")),
        "check": case(LIST + ["--check", "no", "--format", "json"], ids("photo-claims")),
        "split": case(LIST + ["--split", "no", "--format", "json"], ids("refund-requests")),
        "min_rows": case(LIST + ["--min-rows", "5", "--format", "json"], ids("photo-claims", "support-tickets")),
        "question": case(LIST + ["--question", "wants_refund", "--format", "json"], ids("refund-requests")),
        "ids": case(LIST + ["--ids"], "photo-claims\nrefund-requests\nsupport-tickets\n"),
        "totals": case(LIST + ["--totals", "--format", "json"], fx.json_is([PHOTO, REFUND, SUPPORT, {
            "id": "(total)", "name": None, "rows": 18, "test": 4, "labeled": 10, "questions": None, "check": None}], SAVED)),
    }),
    "show": dict(case(SHOW, fx.fields_are({
        "id": "support-tickets", "name": "Support tickets", "notes": "Harbor Coffee support inbox, autumn sample", "rows": 8,
        "tuning_rows": 6, "test_rows": 2, "labeled_tuning_rows": 5, "labeled_test_rows": 2,
        "questions": "department, is_urgent, frustration", "picture_rows": 0, "rules": 1, "check": "jev-latest",
        "guidelines": 2, "test_looks": 2}, drop=("saved_at",))), options={
        "questions": case(SHOW + ["--questions"], fx.json_is([
            {"question": "department", "type": "choice", "options": 3, "instructions": "Which team should handle the ticket?"},
            {"question": "is_urgent", "type": "noul", "options": 2, "instructions": "Does it need action today?"},
            {"question": "frustration", "type": "score", "options": 3, "instructions": "How frustrated is the customer?"}])),
        "criteria": case(SHOW + ["--criteria", "frustration"], fx.json_is([
            {"option": 0, "description": "calm"}, {"option": 1, "description": "annoyed"}, {"option": 2, "description": "angry"}])),
        "rules": case(["datasets", "show", "support-tickets", "--rules"], "if department = billing then frustration >= 1\n"),
        "guidelines": case(SHOW + ["--guidelines"], fx.json_is([
            {"question": "department", "note": True, "examples": 1}, {"question": "is_urgent", "note": True, "examples": 0}])),
    }),
    "fields": dict(case(FIELDS + ["support-tickets", "--format", "json"], fx.json_is([
        {"field": "text", "types": "text", "filled": 8, "fill": 1.0, "distinct": 7},
        {"field": "channel", "types": "text", "filled": 7, "fill": 0.875, "distinct": 4}])), options={
        "tuning": case(FIELDS + ["support-tickets", "--tuning", "--format", "json"], fx.json_is([
            {"field": "text", "types": "text", "filled": 6, "fill": 1.0, "distinct": 5},
            {"field": "channel", "types": "text", "filled": 5, "fill": 0.8333, "distinct": 3}])),
        "min_fill": case(FIELDS + ["support-tickets", "--min-fill", "0.9", "--format", "json"], fx.column_is("field", ["text"])),
        "sort": case(FIELDS + ["support-tickets", "--sort", "field", "--format", "json"], fx.column_is("field", ["channel", "text"])),
        "sliceable": case(FIELDS + ["refund-requests", "--sliceable", "--format", "json"], fx.json_is([
            {"field": "text", "types": "text", "filled": 4, "fill": 1.0, "distinct": 4},
            {"field": "channel", "types": "text", "filled": 2, "fill": 0.5, "distinct": 2},
            {"field": "_image", "types": "picture", "filled": 1, "fill": 0.25, "distinct": 1}])),
        "nested": case(FIELDS + ["photo-claims", "--nested", "--tuning", "--format", "json"], fx.json_is([
            {"field": "note", "types": "text", "filled": 4, "fill": 1.0, "distinct": 4},
            {"field": "order", "types": "object", "filled": 2, "fill": 0.5, "distinct": 2},
            {"field": "order.id", "types": "text", "filled": 2, "fill": 0.5, "distinct": 2},
            {"field": "order.items", "types": "number", "filled": 1, "fill": 0.25, "distinct": 1},
            {"field": "_image", "types": "picture", "filled": 4, "fill": 1.0, "distinct": 4}])),
    }),
    "slices": dict(case(SLICES, fx.json_is([
        slice_row("chat", 2, 0, 2), slice_row("email", 2, 1, 2), slice_row("phone", 1, 0, 1), slice_row("(none)", 1, 0, 0),
        slice_row("(held-out only)", 0, 1, 0)])), options={
        "question": case(SLICES + ["--question", "frustration"], fx.json_is([
            slice_row("chat", 2, 0, 0, missing=2), slice_row("email", 2, 1, 2, missing=0), slice_row("phone", 1, 0, 1, missing=0),
            slice_row("(none)", 1, 0, 0, missing=1), slice_row("(held-out only)", 0, 1, 0, missing=0)])),
        "top": case(SLICES + ["--top", "2"], fx.json_is([
            slice_row("chat", 2, 0, 2), slice_row("email", 2, 1, 2), slice_row("(other)", 2, 0, 1), slice_row("(held-out only)", 0, 1, 0)])),
        "sort": case(SLICES + ["--sort", "value"], fx.column_is("value", ["chat", "email", "phone", "(none)", "(held-out only)"])),
        "min_rows": case(SLICES + ["--min-rows", "2"], fx.column_is("value", ["chat", "email", "(held-out only)"])),
        "share": case(SLICES + ["--share"], fx.column_is("share", [0.3333, 0.3333, 0.1667, 0.1667, 0.0])),
        "full": case(["datasets", "slices", "refund-requests", "text", "--full", "--format", "json"], fx.json_is([
            slice_row("Bag arrived torn", 1, 0, 1), slice_row(fx.LONG_TEXT, 1, 0, 0), slice_row("Refund for torn bag", 1, 0, 1),
            slice_row("Where is my refund?", 1, 0, 1)])),
    }),
    "check": dict(case(CHECK, fx.fields_are({
        "model": "jev-latest", "tuned_on": "jev-1.14.0", "signal": "confidence", "bound": "estimate", "min_accuracy": 0.9,
        "min_coverage": 0.5, "gates": 2, "rules": 1, "slice_targets": 1, "answer_sets": 1}, drop=("saved_at",))), options={
        "gates": case(CHECK + ["--gates"], fx.json_is([{"question": "department", "type": "choice", "threshold": 0.8},
                                                       {"question": "is_urgent", "type": "noul", "threshold": 0.7}])),
        "slice_targets": case(CHECK + ["--slice-targets"], fx.json_is([
            {"field": "channel", "value": "email", "min_accuracy": 0.85, "min_coverage": 0.4}])),
        "answer_sets": case(CHECK + ["--answer-sets"], fx.json_is([{"question": "department", "cut": 0.12, "coverage": 0.9}])),
        "pin": case(["datasets", "check", "support-tickets", "--pin"], "support-tickets asks jev-latest, an alias that moves when "
                    "a new version ships; its thresholds were tuned on jev-1.14.0.\n", code=1),
    }),
    "history": dict(case(HISTORY, fx.json_is([NEWEST, OLDEST])), options={
        "limit": case(HISTORY + ["--limit", "1"], fx.json_is([NEWEST])),
        "changes": case(HISTORY + ["--changes"], fx.json_is([dict(NEWEST, rows_change=1, labeled_change=1),
                                                             dict(OLDEST, rows_change=None, labeled_change=None)])),
        "since": case(HISTORY + ["--since", "2026-01-01"], fx.json_is([NEWEST])),
        "deleted": case(["datasets", "history", "--deleted", "--format", "json"], fx.json_is([
            {"id": "old-menu", "name": "Old menu", "revisions": 2, "latest": "2026-03-01T12:00:00.000000Z"}])),
    }),
    "questions": dict(case(QUESTIONS, fx.json_is([
        {"question": "department", "type": "choice", "datasets": 2, "ids": "refund-requests, support-tickets"},
        {"question": "frustration", "type": "score", "datasets": 1, "ids": "support-tickets"},
        {"question": "is_urgent", "type": "noul", "datasets": 1, "ids": "support-tickets"},
        {"question": "wants_refund", "type": "noul", "datasets": 1, "ids": "refund-requests"}])), options={
        "type": case(QUESTIONS + ["--type", "noul"], fx.column_is("question", ["is_urgent", "wants_refund"])),
        "shared": case(QUESTIONS + ["--shared"], fx.column_is("question", ["department"])),
        "mismatch": case(QUESTIONS + ["--mismatch"], fx.column_is("question", ["department"]), code=1),
    }),
    "pictures": dict(case(["datasets", "pictures", "photo-claims", "--format", "json"], fx.json_is([
        {"picture": "0123456789abcdef.png", "kind": "uploaded", "tuning": 1, "test": 0, "file": "present"},
        {"picture": "fedcba9876543210.jpg", "kind": "uploaded", "tuning": 1, "test": 0, "file": "missing"},
        {"picture": "intact-bag", "kind": "sample", "tuning": 1, "test": 0, "file": "present"},
        {"picture": "torn-bag", "kind": "sample", "tuning": 1, "test": 1, "file": "present"},
        {"picture": "(held-out only)", "kind": None, "tuning": 0, "test": 1, "file": None}])), options={
        "missing": case(["datasets", "pictures", "photo-claims", "--missing", "--format", "json"], fx.json_is([
            {"picture": "fedcba9876543210.jpg", "kind": "uploaded", "tuning": 1, "test": 0, "file": "missing"},
            {"picture": "(held-out only)", "kind": None, "tuning": 0, "test": 1, "file": "missing"}]), code=1),
    }),
    "find": dict(case(FIND + ["torn", "--format", "json"], fx.json_is([
        {"dataset": "refund-requests", "row": 2, "field": "text", "value": "Bag arrived torn"},
        {"dataset": "refund-requests", "row": 4, "field": "text", "value": "Refund for torn bag"},
        {"dataset": "support-tickets", "row": 2, "field": "text", "value": "Bag arrived torn"},
        {"dataset": "support-tickets", "row": 4, "field": "text", "value": "Bag arrived torn"}]), code=1), options={
        "field": case(FIND + ["A-", "--field", "order", "--format", "json"], fx.json_is([
            {"dataset": "photo-claims", "row": 1, "field": "order.id", "value": "A-1"},
            {"dataset": "photo-claims", "row": 3, "field": "order.id", "value": "A-3"}]), code=1),
        "regex": case(FIND + ["^bag", "--regex", "--format", "json"], fx.json_is([
            {"dataset": "refund-requests", "row": 2, "field": "text", "value": "Bag arrived torn"},
            {"dataset": "support-tickets", "row": 2, "field": "text", "value": "Bag arrived torn"},
            {"dataset": "support-tickets", "row": 4, "field": "text", "value": "Bag arrived torn"}]), code=1),
        "dataset": case(FIND + ["refund", "--dataset", "support-tickets", "--format", "json"], fx.json_is([
            {"dataset": "support-tickets", "row": 5, "field": "text", "value": "Where is my refund?"}]), code=1),
    }),
}


class CliDatasetsBrowseTests(pack_tests(cli_datasets_browse.PACK, CASES)):
    """One test per improvement; the extra tests below cover usage errors and empty data."""

    def test_usage_errors_exit_two(self):
        from labkit import run_cli
        for argv in (["datasets", "show", "no-such"], ["datasets", "show", "support-tickets", "--criteria", "nope"],
                     ["datasets", "slices", "support-tickets", "nope"], ["datasets", "check", "photo-claims"],
                     ["datasets", "history"], ["datasets", "history", "old-menu", "--deleted"],
                     ["datasets", "find", "(", "--regex"], ["datasets", "list", "--limit", "0"]):
            code, out, _err = run_cli(argv, ALL)
            self.assertEqual(code, 2, argv)
            fx.never_held_out(out)

    def test_empty_data_and_no_match(self):
        from labkit import run_cli
        self.assertEqual(run_cli(["datasets", "list"]), (0, "No saved datasets.\n", ""))
        self.assertEqual(run_cli(["datasets", "find", "espresso", "--format", "json"], ALL)[:2], (0, "[]\n"))

    def test_pin_passes_on_a_versioned_model(self):
        from labkit import run_cli
        self.assertEqual(run_cli(["datasets", "check", "refund-requests", "--pin"], ALL),
                         (0, "refund-requests asks jev-1.14.0, a versioned model.\n", ""))

    def test_fields_only_held_out_rows_have_stay_hidden(self):
        from labkit import run_cli
        from jev import workbench

        def setup(directory):
            workbench.save_dataset({"name": "Latte notes", "rows": [
                {"text": "Oat latte"}, {"text": "Soy latte"}, {"text": "Held out mocha", "size": "grande", "_test": True}]})

        code, out, _err = run_cli(["datasets", "fields", "latte-notes", "--format", "json"], setup)
        self.assertEqual(code, 0)
        fx.json_is([{"field": "text", "types": "text", "filled": 3, "fill": 1.0, "distinct": 3}])(out)
        self.assertNotIn("size", out)


if __name__ == "__main__":
    unittest.main()
