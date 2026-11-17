"""Tests for the cli-rows-tools Lab pack (jev/lab/packs/cli_rows_tools.py): more offline rows file tools.
Fictional Harbor Coffee Co. data only."""

import json
import random
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_rows  # noqa: E402
from jev.lab.packs import cli_rows_tools  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)


def tearDownModule():
    TMP.cleanup()


def jsonl(rows):
    return "\n".join(row if isinstance(row, str) else json.dumps(row) for row in rows) + "\n"


A = [
    {"text": "Charged twice", "_expect": {"team": "billing"}},
    {"text": "Bag torn", "_expect": {"team": "shipping"}},
    "Grinder squeals",
    {"text": "Held secret", "_test": True, "_expect": {"team": "product"}},
    {"text": "Bag torn"},
]
B = [
    {"text": "Charged twice", "_expect": {"team": "shipping"}},
    {"text": "Bag torn", "_expect": {"team": "shipping"}},
    {"text": "Held secret", "_expect": {"team": "product"}},
    {"text": "Mug chipped"},
]
S = [{"text": "B", "amount": 12}, {"text": "A", "amount": 3}, {"text": "C"}, {"text": "D", "amount": 7.5}]
FIVE = [{"text": "Latte %d" % i} for i in range(1, 6)]
FILE_A, FILE_B, FILE_S, FILE_FIVE = DIR / "a.jsonl", DIR / "b.jsonl", DIR / "s.jsonl", DIR / "five.jsonl"
CSV_1, CSV_2 = DIR / "one.txt", DIR / "two.txt"
FILE_A.write_text(jsonl(A))
FILE_B.write_text(jsonl(B))
FILE_S.write_text(jsonl(S))
FILE_FIVE.write_text(jsonl(FIVE))
CSV_1.write_text("text\nLatte\nMocha\n")
CSV_2.write_text("text\nMocha\nLatte\n")
CHUNKS = {name: DIR / name for name in ("plain", "small", "named", "csv", "forced")}
for folder in CHUNKS.values():
    folder.mkdir()
(CHUNKS["forced"] / "part-01.jsonl").write_text("old\n")
SORTED_OUT = DIR / "sorted.jsonl"


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))

    return check


def masked(rows):
    return [
        {k: v for k, v in row.items() if k != "_expect"} if isinstance(row, dict) and row.get("_test") is True else row
        for row in rows
    ]


def chunked(folder, expected, ext=".jsonl"):
    def check(text):
        if text != table(["file", "rows"], expected):
            raise AssertionError(text)
        for name, count in expected:
            lines = [line for line in (folder / name).read_text().splitlines() if line.strip()]
            if len(lines) != count + (1 if ext == ".csv" else 0):
                raise AssertionError("%s holds %d lines" % (name, len(lines)))

    return check


def shuffled(seed):
    order = list(range(len(FIVE)))
    random.Random(seed).shuffle(order)
    return cli_rows.render([FIVE[i] for i in order], "jsonl")


def wrote_sorted(text):
    if text != "wrote 4 rows to %s\n" % SORTED_OUT:
        raise AssertionError(text)
    if [json.loads(line) for line in SORTED_OUT.read_text().splitlines()] != [S[1], S[3], S[0], S[2]]:
        raise AssertionError(SORTED_OUT.read_text())


DIFF = ["kind", "rows"]
KINDS = [["only in A", 1], ["only in B", 1], ["in both", 4], ["labels differ", 3], ["held out in only one file", 1]]

CASES = {
    "diff": {
        "argv": ["rows", "diff", FILE_A, FILE_B],
        "code": 1,
        "stdout": table(DIFF, KINDS),
        "options": {
            "rows": {
                "argv": ["rows", "diff", FILE_A, FILE_B, "--rows"],
                "code": 1,
                "stdout": table(
                    DIFF + ["row numbers"],
                    [kind + [rows] for kind, rows in zip(KINDS, ["3", "4", "1, 2, 4, 5", "1, 2, 5", "4"])],
                ),
            },
            "source": {
                "argv": ["rows", "diff", CSV_1, CSV_2, "--from", "csv"],
                "stdout": table(
                    DIFF,
                    [
                        ["only in A", 0],
                        ["only in B", 0],
                        ["in both", 2],
                        ["labels differ", 0],
                        ["held out in only one file", 0],
                    ],
                ),
            },
            "format": {
                "argv": ["rows", "diff", FILE_A, FILE_B, "--format", "json"],
                "code": 1,
                "stdout": same_json([dict(zip(DIFF, kind)) for kind in KINDS]),
            },
        },
    },
    # Copies of "Bag torn" (rows 2 and 5) stay in one file.
    "chunk": {
        "argv": ["rows", "chunk", FILE_A, "--out-dir", CHUNKS["plain"]],
        "stdout": chunked(CHUNKS["plain"], [["part-01.jsonl", 5]]),
        "options": {
            "size": {
                "argv": ["rows", "chunk", FILE_A, "--out-dir", CHUNKS["small"], "--size", "2"],
                "stdout": chunked(CHUNKS["small"], [["part-01.jsonl", 1], ["part-02.jsonl", 2], ["part-03.jsonl", 2]]),
            },
            "prefix": {
                "argv": ["rows", "chunk", FILE_A, "--out-dir", CHUNKS["named"], "--prefix", "Batch One"],
                "stdout": chunked(CHUNKS["named"], [["batch-one-01.jsonl", 5]]),
            },
            "to": {
                "argv": ["rows", "chunk", FILE_FIVE, "--out-dir", CHUNKS["csv"], "--to", "csv", "--size", "3"],
                "stdout": chunked(CHUNKS["csv"], [["part-01.csv", 3], ["part-02.csv", 2]], ".csv"),
            },
            "force": {
                "argv": ["rows", "chunk", FILE_A, "--out-dir", CHUNKS["forced"], "--force"],
                "stdout": chunked(CHUNKS["forced"], [["part-01.jsonl", 5]]),
            },
        },
    },
    "tail": {
        "argv": ["rows", "tail", FILE_A],
        "stdout": cli_rows.render(masked(A), "jsonl"),
        "stderr": "left out the labels of 1 held-out row; write them to a file with --out\n",
        "options": {
            "rows": {
                "argv": ["rows", "tail", FILE_A, "-n", "1"],
                "stdout": cli_rows.render([A[4]], "jsonl"),
                "stderr": "",
            }
        },
    },
    "sort": {
        "argv": ["rows", "sort", FILE_S, "--by", "amount"],
        "stdout": cli_rows.render([S[1], S[3], S[0], S[2]], "jsonl"),
        "options": {
            "reverse": {
                "argv": ["rows", "sort", FILE_S, "--by", "text", "--reverse"],
                "stdout": cli_rows.render([S[3], S[2], S[0], S[1]], "jsonl"),
            },
            "out": {"argv": ["rows", "sort", FILE_S, "--by", "amount", "--out", SORTED_OUT], "stdout": wrote_sorted},
        },
    },
    "shuffle": {
        "argv": ["rows", "shuffle", FILE_FIVE],
        "stdout": shuffled(0),
        "options": {"seed": {"argv": ["rows", "shuffle", FILE_FIVE, "--seed", "3"], "stdout": shuffled(3)}},
    },
}


class CliRowsToolsTests(pack_tests(cli_rows_tools.PACK, CASES)):
    def test_usage_errors_exit_two(self):
        for argv in (
            ["rows", "chunk", FILE_A, "--out-dir", CHUNKS["plain"], "--size", "1"],
            ["rows", "chunk", FILE_A, "--out-dir", DIR / "nope"],
            ["rows", "sort", FILE_S, "--by", "_expect"],
            ["rows", "tail", FILE_A, "-n", "0"],
            ["rows", "diff", FILE_A, DIR / "missing.jsonl"],
        ):
            self.assertEqual(run_cli(argv)[0], 2, argv)

    def test_chunk_refuses_existing_files_without_force(self):
        folder = DIR / "refuse"
        folder.mkdir()
        (folder / "part-01.jsonl").write_text("old\n")
        code, _out, err = run_cli(["rows", "chunk", FILE_A, "--out-dir", folder])
        self.assertEqual(code, 2)
        self.assertIn("pass --force", err)
        self.assertEqual((folder / "part-01.jsonl").read_text(), "old\n")
