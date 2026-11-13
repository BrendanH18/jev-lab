"""`lab.py report data|dataset|site` (jev/lab/packs/cli_report.py).

The fixture writes two datasets, kept revisions, a deleted dataset's history and two saved tests with fixed times, so
every count below is worked out by hand from it. Fictional data only: no output may show an input, and the held-out
row's text ("Held-out secret order") and its label values must never appear.
"""

import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev.lab.packs import cli_report  # noqa: E402
from jev import workbench  # noqa: E402

DRINK = {"type": "choice", "instructions": "Which drink is ordered first?",
         "criteria": {"latte": "Milk and espresso", "mocha": "Chocolate and espresso", "cortado": "Equal parts"}}
QUESTIONS = {"drink": DRINK, "rush": {"type": "noul", "instructions": "Is the order a rush?"},
             "strength": {"type": "score", "instructions": "How strong should it be?", "criteria": ["mild", "medium", "strong"]}}
ESPRESSO = {
    "id": "espresso-orders", "name": "Espresso orders", "notes": "Counter orders at Harbor Coffee", "saved_at": "2026-05-01T10:00:00Z",
    "questions": QUESTIONS, "rules": "# house rule\nif drink = latte then strength >= 1",
    "check": {"gates": {"drink": 0.8, "rush": 0.7}, "signal": "confidence", "bound": "estimate", "model": "jev-latest",
              "tuned_on": "jev-1.14.0", "min_accuracy": 0.9, "min_coverage": 0.4,
              "slice_targets": [{"field": "table", "value": "4", "min_accuracy": 0.85, "min_coverage": 0.3}],
              "answer_sets": {"drink": {"cut": 0.1, "coverage": 0.9}}, "rules": "if drink = latte then strength >= 1",
              "saved_at": "2026-05-02T10:00:00Z"},
    "guidelines": {"drink": {"note": "Pick the drink named first.", "examples": [{"input": "A latte", "label": "latte"}]},
                   "rush": {"note": "Only same-minute orders."}},
    "test": {"locked_at": "2026-05-01T10:00:00Z", "looks": [{"at": "2026-05-03T10:00:00Z"}]},
    "rows": [{"text": "Two lattes please", "table": "4", "_expect": {"drink": "latte", "rush": True, "strength": 1}},
             {"text": "Mocha to go", "table": "", "_expect": {"drink": "mocha"}},
             {"text": "Cortado now", "_expect": {"drink": "espresso", "rush": "maybe"}},
             {"text": "Just water"},
             {"text": "Held-out secret order", "table": "9", "hidden_field": "x", "_test": True,
              "_expect": {"drink": "cortado", "rush": False}}]}
PASTRY = {"id": "pastry-feedback", "name": "Pastry feedback", "saved_at": "2026-06-01T08:00:00Z",
          "questions": {"tasty": {"type": "noul", "instructions": "Did they like it?"}},
          "rows": ["Flaky and warm", {"text": "Too sweet", "_expect": {"tasty": False}}]}
REVISIONS = [("20260401T100000000000Z", {"name": "Espresso orders", "rows": ["Two lattes please"]}),
             ("20260415T100000000000Z", {"name": "Espresso orders", "questions": {"drink": DRINK},
                                         "rows": [{"text": "Two lattes please", "table": "4", "_expect": {"drink": "mocha"}},
                                                  "Mocha to go"]})]
OLD = ("20250101T000000000000Z", {"name": "Old roasts", "rows": ["Dark"]})
TESTS = [{"id": "morning-rush", "name": "Morning rush", "state": "Two lattes", "saved_at": "2026-03-01T07:00:00Z",
          "questions": {"drink": DRINK, "rush": {"type": "noul", "instructions": "Is the order a rush?"}},
          "expect": {"drink": {"latte": [0.5, 1]}}},
         {"id": "refund-check", "name": "Refund check", "state": "Torn bag", "saved_at": "2026-03-05T07:00:00Z",
          "questions": {"refund": {"type": "noul", "instructions": "Does the customer want money back?"}},
          "expect": {}, "images": {"photo": {"sample": "torn-bag"}}}]
SECRETS = ("Held-out secret", "hidden_field", "cortado\n", "Two lattes please", "Mocha to go", "Just water", "Too sweet", "Flaky")


def revid(stamp, dataset):
    return "%s-%s" % (stamp, hashlib.sha256(json.dumps(dataset).encode()).hexdigest()[:12])


R1, R2 = (revid(stamp, dataset) for stamp, dataset in REVISIONS)


def write_revision(directory, dataset_id, stamp, dataset):
    folder = directory / "datasets" / ".history" / dataset_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / (revid(stamp, dataset) + ".json")).write_bytes(json.dumps(dataset).encode())


def setup(directory):
    for stamp, dataset in REVISIONS:
        write_revision(directory, "espresso-orders", stamp, dataset)
    write_revision(directory, "old-roasts", *OLD)
    workbench.write_dataset(dict(ESPRESSO))  # no file yet, so nothing is snapshotted
    workbench.write_dataset(dict(PASTRY))
    for item in TESTS:
        (directory / (item["id"] + ".json")).write_text(json.dumps(item))


def has(*lines, absent=()):
    """Every expected line appears whole in stdout, nothing secret does, and no `absent` text does."""
    def check(text):
        for secret in SECRETS + tuple(absent):
            if secret in text:
                raise AssertionError("output shows %r:\n%s" % (secret, text))
        got = text.splitlines()
        for line in lines:
            if line not in got:
                raise AssertionError("missing line %r in:\n%s" % (line, text))
    return check


def order(*lines):
    """The lines appear whole and in this order."""
    def check(text):
        has(*lines)(text)
        got = text.splitlines()
        positions = [got.index(line) for line in lines]
        if positions != sorted(positions):
            raise AssertionError("lines out of order %r in:\n%s" % (lines, text))
    return check


def case(argv, stdout, code=0, **extra):
    return dict({"argv": argv, "stdout": stdout, "code": code, "setup": setup}, **extra)


OUTSIDE = tempfile.mkdtemp(prefix="lab-report-test-")


def written(name, *lines, html=False):
    """stdout says the report was written, and the file holds the expected lines."""
    def check(text):
        path = Path(OUTSIDE) / name
        if not re.fullmatch(r"Wrote the %s report to %s \(\d+ bytes\)\.\n" % ("HTML" if html else "Markdown", re.escape(str(path))), text):
            raise AssertionError(text)
        has(*lines)(path.read_text(encoding="utf-8"))
    return check


DATASETS_HEAD = "| dataset | id | rows | held out | labeled | labeled share | questions | check | saved |"
ESPRESSO_ROW = "| Espresso orders | espresso-orders | 5 | 1 | 3 | 75.0% | 3 | yes | 2026-05-01T10:00:00Z |"
PASTRY_ROW = "| Pastry feedback | pastry-feedback | 2 | 0 | 1 | 50.0% | 1 | no | 2026-06-01T08:00:00Z |"
LABEL_ROWS = ["| espresso-orders | drink | choice | 2 | 1 | 1 | 50.0% | 1 |", "| espresso-orders | rush | noul | 1 | 2 | 1 | 25.0% | 1 |",
              "| espresso-orders | strength | score | 1 | 3 | 0 | 25.0% | 0 |", "| pastry-feedback | tasty | noul | 1 | 1 | 0 | 50.0% | 0 |"]
OVERVIEW = ["| datasets | 2 |", "| rows | 7 |", "| tuning rows | 6 |", "| held-out rows | 1 |", "| labeled tuning rows | 4 |",
            "| questions asked | 4 |", "| saved checks | 1 |", "| saved tests | 2 |", "| datasets with kept history | 1 |",
            "| deleted datasets with kept history | 1 |"]
CHECK_ROW = "| espresso-orders | jev-latest | jev-1.14.0 | confidence | 2 | 0.9 | 0.4 | 1 | 1 | 1 |"
HISTORY_ROWS = ["| espresso-orders | 2 | 2026-04-15T10:00:00Z | live |", "| old-roasts | 1 | 2025-01-01T00:00:00Z | deleted |"]
TEST_ROWS = ["| morning-rush | Morning rush | 2 | 1 choice, 1 noul | 1 | 0 | 2026-03-01T07:00:00Z |",
             "| refund-check | Refund check | 1 | 1 noul | 0 | 1 | 2026-03-05T07:00:00Z |"]


def file_exists(directory):
    setup(directory)
    (Path(OUTSIDE) / "exists.md").write_text("old report\n")


CASES = {
    "data": dict(case(["report", "data"], order(
        "# Workbench data report", cli_report.INTRO, "## Overview", *OVERVIEW, "## Datasets", DATASETS_HEAD, ESPRESSO_ROW, PASTRY_ROW,
        "## Label coverage", *LABEL_ROWS, "## Saved checks", CHECK_ROW, "## Saved tests", *TEST_ROWS,
        "## Revision history", *HISTORY_ROWS)), options={
        "out": case(["report", "data", "--out", str(Path(OUTSIDE) / "data.md")], written("data.md", "## Overview", ESPRESSO_ROW)),
        "html": case(["report", "data", "--html", "--sections", "datasets", "--title", "Cafe <data>"], has(
            "<!doctype html>", "<title>Cafe &lt;data&gt;</title>", "<h1>Cafe &lt;data&gt;</h1>", '<h2 id="datasets">Datasets</h2>',
            "@media (prefers-color-scheme: dark){:root{--bg:#15191d;--fg:#e6e9ec;--muted:#9aa5ae;--line:#2c3339;--head:#1e2429;--link:#7db4f5}}",
            absent=["<data>", "## "])),
        "force": case(["report", "data", "--out", str(Path(OUTSIDE) / "exists.md"), "--force"],
                      written("exists.md", "# Workbench data report"), setup=file_exists),
        "title": case(["report", "data", "--title", "Harbor Coffee weekly data"], has(
            "# Harbor Coffee weekly data", "## Overview", absent=["# Workbench data report"])),
        "stamp": case(["report", "data", "--stamp", "--sections", "overview"],
                      lambda text: re.search(r"^Generated \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ by lab\.py report\.$", text, re.M)
                      or (_ for _ in ()).throw(AssertionError(text))),
        "sections": case(["report", "data", "--sections", "checks,overview"], lambda text: (
            has(CHECK_ROW, *OVERVIEW, absent=["## Datasets", "## Label coverage", "## Saved tests", "## Revision history"])(text),
            order("## Saved checks", "## Overview")(text))),
        "toc": case(["report", "data", "--toc", "--sections", "overview,labels"], order(
            "- [Overview](#overview)", "- [Label coverage](#label-coverage)", "## Overview", "## Label coverage")),
        "dataset": case(["report", "data", "--dataset", "pastry-feedback"], has(
            "| datasets | 1 |", "| rows | 2 |", "| saved checks | 0 |", "| saved tests | 2 |", "| datasets with kept history | 0 |",
            PASTRY_ROW, LABEL_ROWS[3], "No saved checks.", "No dataset history is kept.", absent=["espresso-orders"])),
        "fail_under": case(["report", "data", "--fail-under", "0.3", "--sections", "labels"], has(*LABEL_ROWS), code=1,
                           stderr="lab.py: label coverage below 0.3: espresso-orders/rush, espresso-orders/strength\n"),
        "sort": case(["report", "data", "--sort", "saved", "--sections", "datasets"], order(DATASETS_HEAD, PASTRY_ROW, ESPRESSO_ROW)),
    }),
    "dataset": dict(case(["report", "dataset", "espresso-orders"], order(
        "# Dataset report: Espresso orders", "## Overview", "| notes | Counter orders at Harbor Coffee |", "| rows | 5 |", "| tuning rows | 4 |",
        "| held-out rows | 1 |", "| labeled tuning rows | 3 |", "| labeled held-out rows | 1 |", "| rules | 1 |", "| labeling guidelines | 2 |",
        "| test looks | 1 |", "## Questions", "| 1 | drink | choice | 3 | Which drink is ordered first? |", "| 2 | rush | noul |  | Is the order a rush? |",
        "## Label coverage", "| drink | choice | 2 | 1 | 1 | 50.0% | 1 |", "## Input fields", "| text | 4 | 100.0% |", "| table | 1 | 25.0% |",
        "## Saved check", "| tuned on | jev-1.14.0 |", "| drink | choice | 0.8 |", "| table | 4 | 0.85 | 0.3 |", "| drink | 0.1 | 0.9 |",
        "- if drink = latte then strength >= 1", "## Labeling guidelines", "| drink | yes | 1 |", "| rush | yes | 0 |", "## Revision history",
        "| %s | 2026-04-15T10:00:00Z | 2 | 1 | 0 | no |" % R2, "| %s | 2026-04-01T10:00:00Z | 1 | 0 | 0 | no |" % R1)),
        options={
            "sections": case(["report", "dataset", "espresso-orders", "--sections", "guidelines,labels"], lambda text: (
                order("## Labeling guidelines", "| drink | yes | 1 |", "## Label coverage", "| rush | noul | 1 | 2 | 1 | 25.0% | 1 |")(text),
                has(absent=["## Overview", "## Questions", "## Input fields", "## Saved check", "## Revision history"])(text))),
            "criteria": case(["report", "dataset", "espresso-orders", "--criteria", "--sections", "questions"], order(
                "| question | option | description |", "| drink | latte | Milk and espresso |", "| drink | mocha | Chocolate and espresso |",
                "| drink | cortado | Equal parts |", "| strength | 0 | mild |", "| strength | 1 | medium |", "| strength | 2 | strong |")),
            "revisions": case(["report", "dataset", "espresso-orders", "--revisions", "1", "--sections", "history"], has(
                "| %s | 2026-04-15T10:00:00Z | 2 | 1 | 0 | no |" % R2, "1 older revision is kept and not listed.", absent=[R1])),
            "since_revision": case(["report", "dataset", "espresso-orders", "--since-revision", "20260415", "--sections", "overview"], order(
                "## Changes since revision %s" % R2, "| rows then | 2 |", "| rows now | 5 |", "| rows added | 4 |", "| rows removed | 1 |",
                "| row order changed | yes |", "| labels added | 7 |", "| labels removed | 0 |", "| labels changed | 1 |",
                "| held-out rows then | 0 |", "| held-out rows now | 1 |", "| rows moved in or out of the held-out split | 0 |",
                "| questions changed | yes |", "| rules changed | yes |", "| name or notes changed | yes |", "| check changed | yes |")),
        }),
    "site": dict(case(["report", "site", "--out-dir", str(Path(OUTSIDE) / "site")], lambda text: site_written(
        "site", text, "HTML", ["index.html", "dataset-espresso-orders.html", "dataset-pastry-feedback.html"],
        {"index.html": ['<li><a href="#datasets">Datasets</a></li>', '<td><a href="dataset-espresso-orders.html">Espresso orders</a></td>'],
         "dataset-pastry-feedback.html": ['<li><a href="index.html">Back to the index</a></li>', "<h1>Dataset report: Pastry feedback</h1>"]})),
        options={
            "markdown": case(["report", "site", "--out-dir", str(Path(OUTSIDE) / "site-md"), "--markdown"], lambda text: site_written(
                "site-md", text, "Markdown", ["index.md", "dataset-espresso-orders.md", "dataset-pastry-feedback.md"],
                {"index.md": ["| [Espresso orders](dataset-espresso-orders.md) | espresso-orders | 5 | 1 | 3 | 75.0% | 3 | yes | 2026-05-01T10:00:00Z |"],
                 "dataset-espresso-orders.md": ["- [Back to the index](index.md)", "# Dataset report: Espresso orders"]})),
        }),
}


class CliReportTests(pack_tests(cli_report.PACK, CASES)):
    def test_refuses_to_write_inside_the_data_directory_or_over_a_file(self):
        def inside(directory):
            setup(directory)
            (directory / "reports").mkdir()

        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
        import lab as lab_cli
        import io
        from contextlib import redirect_stderr, redirect_stdout
        with tempfile.TemporaryDirectory() as directory:
            previous = workbench.WORKBENCH_DIR
            workbench.WORKBENCH_DIR = Path(directory)
            try:
                inside(Path(directory))
            finally:
                workbench.WORKBENCH_DIR = previous
            before = sorted(str(p) for p in Path(directory).rglob("*"))
            for argv in (["report", "data", "--out", str(Path(directory) / "reports" / "r.md")],
                         ["report", "data", "--out", str(Path(directory) / "datasets" / "r.md"), "--force"],
                         ["report", "site", "--out-dir", str(Path(directory) / "site")],
                         ["report", "dataset", "espresso-orders", "--out", str(Path(directory) / ".." / Path(directory).name / "r.md")]):
                err = io.StringIO()
                with redirect_stdout(io.StringIO()), redirect_stderr(err):
                    self.assertEqual(lab_cli.main(["--data-dir", directory] + argv), 2, argv)
                self.assertIn("inside the Workbench data directory", err.getvalue())
            self.assertEqual(before, sorted(str(p) for p in Path(directory).rglob("*")))
        code, _out, err = run_cli(["report", "data", "--out", str(Path(OUTSIDE) / "exists.md")], file_exists)
        self.assertEqual(code, 2)
        self.assertIn("exists; pass --force", err)
        self.assertEqual((Path(OUTSIDE) / "exists.md").read_text(), "old report\n")

    def test_empty_data_and_a_bare_dataset_say_so(self):
        code, out, _err = run_cli(["report", "data"])
        self.assertEqual(code, 0)
        has("| datasets | 0 |", "| saved tests | 0 |", "No saved datasets.", "No dataset asks a Choice, Noul or Score question.",
            "No saved checks.", "No saved tests.", "No dataset history is kept.")(out)
        code, out, _err = run_cli(["report", "dataset", "pastry-feedback"], setup)
        self.assertEqual(code, 0)
        has("| tasty | noul | 1 | 1 | 0 | 50.0% | 0 |", "| text | 2 | 100.0% |", "No saved check.", "No labeling guidelines.",
            "No revisions kept.")(out)

    def test_bad_usage_exits_two(self):
        for argv in (["report", "dataset", "no-such-dataset"], ["report", "data", "--sections", "overview,nope"],
                     ["report", "data", "--fail-under", "2"], ["report", "data", "--dataset", "missing"],
                     ["report", "dataset", "espresso-orders", "--since-revision", "2026"], ["report", "site"]):
            self.assertEqual(run_cli(argv, setup)[0], 2, argv)


def site_written(name, text, kind, pages, lines):
    folder = Path(OUTSIDE) / name
    expected = "Wrote %d %s pages to %s: %s\n" % (len(pages), kind, folder, ", ".join(pages))
    if text != expected:
        raise AssertionError("expected %r\n     got %r" % (expected, text))
    if sorted(path.name for path in folder.iterdir()) != sorted(pages):
        raise AssertionError(sorted(path.name for path in folder.iterdir()))
    for page, wanted in lines.items():
        content = (folder / page).read_text(encoding="utf-8")
        has()(content)
        for piece in wanted:
            if piece not in content:
                raise AssertionError("%s lacks %r:\n%s" % (page, piece, content))


def tearDownModule():
    import shutil
    shutil.rmtree(OUTSIDE, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
