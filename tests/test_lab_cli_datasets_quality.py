"""`lab.py datasets coverage|labels|duplicates|split|diff|export|sample|lengths|invalid`
(jev/lab/packs/cli_datasets_quality.py).

Every case saves fixture datasets (tests/lab_datasets_fixtures.py) in a temporary data directory and states the
output by hand. Held-out rows must only ever be counted: every matcher but export --include-held-out's also fails on
a held-out input or label value."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev.lab.packs import cli_datasets_quality  # noqa: E402
import lab_datasets_fixtures as fx  # noqa: E402

ALL = fx.save_quality


def case(argv, stdout, code=0, setup=ALL):
    return {"argv": argv, "stdout": stdout, "code": code, "setup": setup}


def cov(question, kind, labeled, missing, invalid, coverage, **extra):
    return dict({"question": question, "type": kind, "labeled": labeled, "missing": missing, "invalid": invalid,
                 "coverage": coverage}, **extra)


def lab(question, label, rows, share, **first):
    return dict(first, question=question, label=label, rows=rows, share=share)


def dup(group, rows, copies, test, text, **extra):
    return dict({"group": group, "rows": rows, "copies": copies, "test": test, "input": text}, **extra)


def sampled(row, text, labels):
    return {"row": row, "input": text, "labels": json.dumps(labels)}


ST = "support-tickets"
COVERAGE = ["datasets", "coverage", ST, "--format", "json"]
LABELS = ["datasets", "labels", ST, "--format", "json"]
DUPLICATES = ["datasets", "duplicates", "bean-reviews", "--format", "json"]
SPLIT = ["datasets", "split", ST, "--format", "json"]
DIFF = ["datasets", "diff", ST, "support-tickets-next", "--format", "json"]
EXPORT = ["datasets", "export", ST]
SAMPLE = ["datasets", "sample", ST, "--format", "json"]
LENGTHS = ["datasets", "lengths", ST, "--format", "json"]
INVALID = ["datasets", "invalid", "bean-reviews", "--format", "json"]

DEPARTMENT, URGENT, FRUSTRATION = (cov("department", "choice", 5, 1, 0, 0.8333), cov("is_urgent", "noul", 3, 2, 1, 0.5),
                                   cov("frustration", "score", 3, 3, 0, 0.5))
DISTRIBUTION = [lab("department", "billing", 2, 0.4), lab("department", "shipping", 1, 0.2), lab("department", "product", 2, 0.4),
                lab("is_urgent", True, 1, 0.3333), lab("is_urgent", False, 2, 0.6667),
                lab("frustration", 0, 1, 0.3333), lab("frustration", 1, 1, 0.3333), lab("frustration", 2, 1, 0.3333)]
GROUPS = [dup(1, "1, 2, 11", 3, 0, "Great beans"), dup(2, "4", 2, 1, "Stale roast"), dup(3, "7, 8", 2, 0, "Lovely crema"),
          dup(4, "", 2, 2, "(held-out only)")]
SPLIT_SUMMARY = {"rows": 8, "tuning_rows": 6, "test_rows": 2, "labeled_tuning": 5, "labeled_test": 2, "test_share": 0.2857,
                 "looks": 2, "last_look": "2026-10-20T15:30:00Z", "overlap_groups": 0}
R1 = {"text": "Charged twice for order A-1", "channel": "email", "_expect": {"department": "billing", "is_urgent": True, "frustration": 2}}
R2 = {"text": "Bag arrived torn", "channel": "chat", "_expect": {"department": "shipping", "is_urgent": False}}
R3 = {"text": "Do you sell decaf?", "channel": "email", "_expect": {"department": "product", "is_urgent": False, "frustration": 0}}
R4 = {"text": "Bag arrived torn", "channel": "chat", "_expect": {"department": "product"}}
R5 = {"text": "Where is my refund?", "channel": "phone", "_expect": {"department": "billing", "is_urgent": "maybe", "frustration": 1}}
R6 = {"text": "Grinder makes a squeal"}
TUNING = [R1, R2, R3, R4, R5, R6]


def without(row, *keys):
    return {k: v for k, v in row.items() if k not in keys}


def held_out_inputs_only(text):
    """export --include-held-out: the tuning rows, then each held-out row's inputs with its marker and no labels."""
    value = [json.loads(line) for line in text.splitlines()]
    expected = TUNING + [{"text": "Held out torn parcel", "channel": "email", "_test": True},
                         {"text": "Held out ticket two", "channel": "fax", "_test": True}]
    if value != expected:
        raise AssertionError("expected %r\n     got %r" % (expected, value))


CSV = ('"text","channel","label_department","label_is_urgent","label_frustration"\r\n'
       '"Charged twice for order A-1","email","billing","yes","2"\r\n'
       '"Bag arrived torn","chat","shipping","no",""\r\n'
       '"Do you sell decaf?","email","product","no","0"\r\n'
       '"Bag arrived torn","chat","product","",""\r\n'
       '"Where is my refund?","phone","billing","maybe","1"\r\n'
       '"Grinder makes a squeal","","","",""\r\n')

FORMULA_CSV = ('"text","store","label_tone","label_urgent","label_level"\r\n'
               '"\'=SUM(A1:A2)","\'+pier","good","yes","1"\r\n'
               '"Plain note","dock","","no",""\r\n'
               '"\'@mention in a text row","","","",""\r\n')


def save_formula(directory):
    """formula-notes: inputs a spreadsheet would run as formulas, every label type, and a held-out row."""
    from jev import workbench
    workbench.save_dataset({"name": "Formula notes", "questions": {
        "tone": {"type": "choice", "instructions": "Is the note positive?", "criteria": {"good": "Positive", "bad": "Negative"}},
        "urgent": {"type": "noul", "instructions": "Is it urgent?"},
        "level": {"type": "score", "instructions": "How strong is it?", "criteria": ["low", "high"]}}, "rows": [
        {"text": "=SUM(A1:A2)", "store": "+pier", "_expect": {"tone": "good", "urgent": True, "level": 1}},
        {"text": "Plain note", "store": "dock", "_expect": {"urgent": False}},
        "@mention in a text row",
        {"text": "Held out formula", "store": "-dock", "_test": True, "_expect": {"tone": "bad"}}]})


CASES = {
    "coverage": dict(case(COVERAGE, fx.json_is([DEPARTMENT, URGENT, FRUSTRATION])), options={
        "held_out": case(COVERAGE + ["--held-out"], fx.json_is([
            dict(DEPARTMENT, test_labeled=2, test_missing=0), dict(URGENT, test_labeled=1, test_missing=1),
            dict(FRUSTRATION, test_labeled=1, test_missing=1)])),
        "min": case(COVERAGE + ["--min", "0.6"], fx.json_is([URGENT, FRUSTRATION]), code=1),
        "missing_rows": case(COVERAGE + ["--missing-rows"], fx.json_is([
            dict(DEPARTMENT, missing_rows="6"), dict(URGENT, missing_rows="4, 6"), dict(FRUSTRATION, missing_rows="2, 4, 6")])),
        "question": case(COVERAGE + ["--question", "is_urgent"], fx.json_is([URGENT])),
        "type": case(COVERAGE + ["--type", "score"], fx.json_is([FRUSTRATION])),
    }),
    "labels": dict(case(LABELS, fx.json_is(DISTRIBUTION)), options={
        "question": case(LABELS + ["--question", "frustration"], fx.json_is(DISTRIBUTION[5:])),
        "all_options": case(["datasets", "labels", "refund-requests", "--all-options", "--format", "json"], fx.json_is([
            lab("wants_refund", True, 3, 1.0), lab("wants_refund", False, 0, 0.0),
            lab("department", "billing", 0, 0.0), lab("department", "shipping", 1, 1.0)])),
        "rare": case(LABELS + ["--rare", "0.25"], fx.json_is([lab("department", "shipping", 1, 0.2)]), code=1),
        "by": case(LABELS + ["--by", "channel", "--question", "department"], fx.json_is([
            lab("department", "shipping", 1, 0.5, slice="chat"), lab("department", "product", 1, 0.5, slice="chat"),
            lab("department", "billing", 1, 0.5, slice="email"), lab("department", "product", 1, 0.5, slice="email"),
            lab("department", "billing", 1, 1.0, slice="phone")])),
        "sort": case(LABELS + ["--sort", "count", "--question", "department"], fx.json_is([
            lab("department", "billing", 2, 0.4), lab("department", "product", 2, 0.4), lab("department", "shipping", 1, 0.2)])),
    }),
    "duplicates": dict(case(DUPLICATES, fx.json_is(GROUPS), code=1), options={
        "conflicts": case(DUPLICATES + ["--conflicts"], fx.json_is([dict(GROUPS[0], questions="tone")]), code=1),
        "overlap": case(DUPLICATES + ["--overlap"], fx.json_is([GROUPS[1]]), code=1),
        "min_copies": case(DUPLICATES + ["--min-copies", "3"], fx.json_is([GROUPS[0]]), code=1),
        "normalize": case(DUPLICATES + ["--normalize"], fx.json_is([dup(1, "1, 2, 3, 11", 4, 0, "Great beans")] + GROUPS[1:]), code=1),
        "field": case(DUPLICATES + ["--field", "text"], fx.json_is([GROUPS[0], dup(2, "4, 6", 3, 1, "Stale roast")] + GROUPS[2:]), code=1),
    }),
    "split": dict(case(SPLIT, fx.fields_are(SPLIT_SUMMARY, drop=("locked_at",))), options={
        "looks": case(SPLIT + ["--looks"], fx.json_is([
            {"look": 1, "at": "2026-10-01T09:00:00Z", "model": "jev-1.14.0", "signal": "confidence", "gates": 1},
            {"look": 2, "at": "2026-10-20T15:30:00Z", "model": None, "signal": "confidence", "gates": 2}])),
        "max_looks": dict(case(SPLIT + ["--max-looks", "1"], fx.fields_are(SPLIT_SUMMARY, drop=("locked_at",)), code=1),
                          stderr="The test rows were scored 2 times, more than 1: results on them now flatter the gate.\n"),
    }),
    "diff": dict(case(DIFF, fx.fields_are({"a_inputs": 5, "b_inputs": 4, "only_in_a": 2, "only_in_b": 1, "in_both": 3,
                                           "label_changes": 2, "a_test_rows": 2, "b_test_rows": 1}), code=1), options={
        "rows": case(DIFF + ["--rows"], fx.json_is([
            {"side": "a", "row": 5, "input": "Where is my refund?"}, {"side": "a", "row": 6, "input": "Grinder makes a squeal"},
            {"side": "b", "row": 4, "input": "Mug handle snapped"}]), code=1),
        "labels": case(DIFF + ["--labels"], fx.json_is([
            {"input": "Charged twice for order A-1", "question": "frustration", "a": "2", "b": "1"},
            {"input": "Bag arrived torn", "question": "department", "a": "product, shipping", "b": "shipping"}]), code=1),
        "questions": case(["datasets", "diff", ST, "refund-requests", "--questions", "--format", "json"], fx.json_is([
            {"question": "department", "a": "choice", "b": "choice", "same": False},
            {"question": "is_urgent", "a": "noul", "b": None, "same": False},
            {"question": "frustration", "a": "score", "b": None, "same": False},
            {"question": "wants_refund", "a": None, "b": "noul", "same": False}]), code=1),
    }),
    "export": dict(case(EXPORT, fx.jsonl_is(TUNING)), options={
        "csv": case(["datasets", "export", "formula-notes", "--csv"], FORMULA_CSV, setup=save_formula),
        "include_held_out": case(EXPORT + ["--include-held-out"], held_out_inputs_only),
        "labeled_only": case(EXPORT + ["--labeled-only"], fx.jsonl_is(TUNING[:5])),
        "unlabeled": case(EXPORT + ["--unlabeled", "frustration"], fx.jsonl_is([R2, R4, R6])),
        "no_labels": case(EXPORT + ["--no-labels"], fx.jsonl_is([without(row, "_expect") for row in TUNING])),
        "question": case(EXPORT + ["--question", "department"], fx.jsonl_is(
            [dict(without(row, "_expect"), _expect={"department": row["_expect"]["department"]}) for row in TUNING[:5]] + [R6])),
        "fields": case(EXPORT + ["--fields", "text"], fx.jsonl_is([without(row, "channel") for row in TUNING])),
    }),
    "sample": dict(case(SAMPLE, fx.json_is([
        sampled(1, "Charged twice for order A-1", R1["_expect"]), sampled(2, "Bag arrived torn", R2["_expect"]),
        sampled(3, "Do you sell decaf?", R3["_expect"]), sampled(5, "Where is my refund?", R5["_expect"]),
        sampled(6, "Grinder makes a squeal", {})])), options={
        "n": case(SAMPLE + ["--n", "2"], fx.column_is("row", [1, 3])),
        "seed": case(SAMPLE + ["--seed", "7"], fx.column_is("row", [1, 2, 3, 4, 6])),
        # Seed 3 ranks the tuning rows 5, 4, 3, 6, 1, 2 (sha256 of "3:<row>:<identity>", worked out separately), so one
        # row per department label is billing 5, shipping 2 and product 4: not simply each label's first row.
        "stratify": case(SAMPLE + ["--stratify", "department", "--n", "1", "--seed", "3"], fx.json_is([
            {"label": "billing", "row": 5}, {"label": "shipping", "row": 2}, {"label": "product", "row": 4}],
            drop=("input", "labels"))),
        "jsonl": case(["datasets", "sample", ST, "--jsonl"], fx.jsonl_is([R1, R2, R3, R5, R6])),
        "unlabeled": case(SAMPLE + ["--unlabeled"], fx.column_is("row", [6])),
        "where": case(SAMPLE + ["--where", "channel=email"], fx.column_is("row", [1, 3])),
    }),
    "lengths": dict(case(LENGTHS, fx.json_is([{"field": "text", "rows": 6, "min": 16, "median": 18.5, "max": 27},
                                              {"field": "channel", "rows": 5, "min": 4, "median": 5.0, "max": 5}])), options={
        "field": case(LENGTHS + ["--field", "channel"], fx.json_is([{"field": "channel", "rows": 5, "min": 4, "median": 5.0, "max": 5}])),
        "over": case(LENGTHS + ["--over", "20"], fx.json_is([{"row": 1, "field": "text", "chars": 27},
                                                             {"row": 6, "field": "text", "chars": 22}]), code=1),
        "words": case(LENGTHS + ["--words"], fx.json_is([{"field": "text", "rows": 6, "min": 3, "median": 4.0, "max": 5},
                                                         {"field": "channel", "rows": 5, "min": 1, "median": 1.0, "max": 1}])),
    }),
    "invalid": dict(case(INVALID, fx.json_is([
        {"row": 3, "question": "roast", "label": "5", "reason": "not one of the levels 0-2"},
        {"row": 4, "question": "aroma", "label": '"flat"', "reason": "not a question of this dataset"},
        {"row": "(held-out)", "question": None, "label": None, "reason": "1 invalid label on held-out rows; values hidden"}]), code=1), options={
        "question": case(INVALID + ["--question", "roast"], fx.json_is([
            {"row": 3, "question": "roast", "label": "5", "reason": "not one of the levels 0-2"}]), code=1),
        "unknown": case(INVALID + ["--unknown"], fx.json_is([
            {"row": 4, "question": "aroma", "label": '"flat"', "reason": "not a question of this dataset"}]), code=1),
    }),
}


class CliDatasetsQualityTests(pack_tests(cli_datasets_quality.PACK, CASES)):
    """One test per improvement; the extra tests below cover usage errors, empty results and held-out privacy."""

    def test_usage_errors_exit_two(self):
        for argv in (["datasets", "coverage", "no-such"], ["datasets", "labels", ST, "--question", "nope"],
                     ["datasets", "labels", ST, "--by", "nope"], ["datasets", "diff", ST, "no-such"],
                     ["datasets", "export", ST, "--unlabeled", "nope"], ["datasets", "sample", ST, "--where", "channel"],
                     ["datasets", "sample", ST, "--n", "0"], ["datasets", "lengths", ST, "--field", "nope"]):
            code, out, _err = run_cli(argv, ALL)
            self.assertEqual(code, 2, argv)
            fx.never_held_out(out)

    def test_no_split_no_finding_and_identical_datasets(self):
        self.assertEqual(run_cli(["datasets", "split", "refund-requests"], ALL)[:2],
                         (0, "Dataset 'refund-requests' has no held-out test rows.\n"))
        self.assertEqual(run_cli(["datasets", "diff", ST, ST, "--labels", "--format", "json"], ALL)[:2], (0, "[]\n"))
        self.assertEqual(run_cli(["datasets", "invalid", ST, "--question", "department", "--format", "json"], ALL)[:2], (0, "[]\n"))
        code, _out, err = run_cli(["datasets", "split", ST, "--max-looks", "1"], ALL)
        self.assertEqual(code, 1)
        self.assertIn("scored 2 times, more than 1", err)

    def test_rare_lists_unused_options(self):
        # refund-requests: wants_refund is yes on all 3 labeled rows; department has one label, shipping.
        self.assertEqual(run_cli(["datasets", "labels", "refund-requests", "--rare", "0.5", "--format", "json"], ALL)[:2], (1, json.dumps([
            {"question": "wants_refund", "label": False, "rows": 0, "share": 0.0},
            {"question": "department", "label": "billing", "rows": 0, "share": 0.0}], indent=1) + "\n"))

    def test_conflicts_ignore_held_out_copies(self):
        from jev import workbench

        def setup(directory):
            workbench.save_dataset({"name": "Crema notes", "questions": {
                "tone": {"type": "choice", "instructions": "Is the note positive?", "criteria": {"good": "Positive", "bad": "Negative"}}},
                "rows": [{"text": "Thin crema", "_expect": {"tone": "bad"}}, {"text": "Thin crema", "_expect": {"tone": "bad"}},
                         {"text": "Thin crema", "_test": True, "_expect": {"tone": "good"}}, {"text": "Thick crema"},
                         {"text": "Thick crema", "_test": True}]})

        self.assertEqual(run_cli(["datasets", "duplicates", "crema-notes", "--conflicts", "--format", "json"], setup)[:2], (0, "[]\n"))
        code, out, _ = run_cli(["datasets", "duplicates", "crema-notes", "--format", "json"], setup)
        self.assertEqual((code, json.loads(out)), (1, [dup(1, "1, 2", 3, 1, "Thin crema"), dup(2, "4", 2, 1, "Thick crema")]))

    def test_held_out_labels_never_counted(self):
        # Row 7 is a held-out shipping/true/2 row and row 8 a held-out billing row: none of them reaches a distribution.
        code, out, _ = run_cli(LABELS + ["--question", "department"], ALL)
        self.assertEqual(code, 0)
        self.assertEqual([item["rows"] for item in json.loads(out)], [2, 1, 2])
        code, out, _ = run_cli(["datasets", "export", "bean-reviews", "--include-held-out"], ALL)
        self.assertEqual(code, 0)
        self.assertNotIn("meh", out)
        self.assertEqual([json.loads(line).get("_expect") for line in out.splitlines() if '"_test"' in line], [None, None, None])


if __name__ == "__main__":
    unittest.main()
