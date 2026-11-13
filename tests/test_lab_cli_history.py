"""`lab.py history datasets|show|diff|labels|coverage|config|checks|verify` (jev/lab/packs/cli_history.py).

Revisions are written by hand with fixed times and their real content hashes, exactly as jev/history.py names them,
so every expected value below is worked out from the fixture. Fictional data only; the held-out input "Secret blend"
must never appear in any output.
"""

import hashlib
import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev.lab.packs import cli_history  # noqa: E402
from jev import workbench  # noqa: E402

QH = {"hot": {"type": "noul", "instructions": "Is it served hot?"}}
QS = dict(QH, size={"type": "choice", "instructions": "Which cup size?", "criteria": {"small": "8 oz", "large": "16 oz"}})
QNOW = {"size": {"type": "choice", "instructions": "Which cup size?", "criteria": {"large": "16 oz", "small": "8 oz"}},
        "hot": {"type": "noul", "instructions": "Is it served hot or warm?"}}
CHECK1 = {"gates": {"hot": 0.8}, "signal": "confidence", "bound": "estimate", "model": "jev-latest", "min_accuracy": 0.9,
          "min_coverage": 0.5, "saved_at": "2026-03-01T09:00:00Z"}
CHECK2 = {"gates": {"hot": 0.85, "size": 0.7}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
          "tuned_on": "jev-1.14.0", "min_accuracy": 0.9, "min_coverage": 0.6, "saved_at": "2026-04-01T09:00:00Z"}

MENU = [
    ("20260101T090000000000Z", {"name": "Menu board", "saved_at": "2026-01-01T09:00:00Z", "rows": ["Latte", "Mocha"]}),
    ("20260201T090000000000Z", {"name": "Menu board", "saved_at": "2026-02-01T09:00:00Z", "questions": QH, "rows": [
        {"text": "Latte", "_expect": {"hot": True}}, "Mocha", {"text": "Iced tea", "_expect": {"hot": False}}]}),
    ("20260301T090000000000Z", {"name": "Menu board", "notes": "Harbor Coffee drinks board", "saved_at": "2026-03-01T09:00:00Z",
                                "questions": QS, "check": CHECK1, "test": {"locked_at": "2026-03-01T09:00:00Z", "looks": []},
                                "rows": [{"text": "Latte", "_expect": {"hot": True, "size": "large"}},
                                         {"text": "Mocha", "_expect": {"hot": True}},
                                         {"text": "Iced tea", "_expect": {"hot": False}},
                                         {"text": "Secret blend", "_test": True, "_expect": {"hot": True}}]}),
]
MENU_NOW = {"id": "menu-board", "name": "Menu board", "notes": "Harbor Coffee drinks board", "saved_at": "2026-04-01T09:00:00Z",
            "questions": QNOW, "check": CHECK2,
            "test": {"locked_at": "2026-03-01T09:00:00Z",
                     "looks": [{"at": "2026-03-15T10:00:00Z", "gates": {"hot": 0.8}, "signal": "confidence"}]},
            "rows": [{"text": "Latte", "_expect": {"hot": True, "size": "small"}}, {"text": "Mocha", "_expect": {"hot": True}},
                     {"text": "Iced tea"}, {"text": "Cortado", "_expect": {"hot": True}},
                     {"text": "Secret blend", "_test": True, "_expect": {"hot": False}}]}
OLD = [("20250601T120000000000Z", {"name": "Old specials", "rows": ["Pumpkin latte"]}),
       ("20250701T120000000000Z", {"name": "Old specials", "rows": ["Pumpkin latte", "Maple mocha"]})]
DAYS = ["Sat", "Sun", "Mon", "Tue", "Wed"]
WEEKEND = [("2025%02d01T080000000000Z" % month, {"name": "Weekend hours", "rows": DAYS[:n]}) for n, month in zip(range(1, 5), range(9, 13))]


def data(dataset):
    return json.dumps(dataset).encode("utf-8")


def revid(stamp, dataset):
    return "%s-%s" % (stamp, hashlib.sha256(data(dataset)).hexdigest()[:12])


R1, R2, R3 = (revid(stamp, dataset) for stamp, dataset in MENU)


def size(revisions):
    return sum(len(data(dataset)) for _stamp, dataset in revisions)


def write_revisions(directory, dataset_id, revisions):
    folder = directory / "datasets" / ".history" / dataset_id
    folder.mkdir(parents=True, exist_ok=True)
    for stamp, dataset in revisions:
        (folder / (revid(stamp, dataset) + ".json")).write_bytes(data(dataset))


def setup(directory):
    write_revisions(directory, "menu-board", MENU)
    workbench.write_dataset(dict(MENU_NOW))  # no file yet, so nothing is snapshotted
    write_revisions(directory, "old-specials", OLD)
    write_revisions(directory, "weekend-hours", WEEKEND)
    workbench.write_dataset({"id": "weekend-hours", "name": "Weekend hours", "rows": DAYS})


def setup_full(directory):
    """daily-board keeps 21 revisions, one more than the Workbench keeps."""
    setup(directory)
    write_revisions(directory, "daily-board", [("202601%02dT090000000000Z" % day, {"name": "Daily board", "rows": ["Day %d" % day]})
                                               for day in range(1, 22)])


BAD = {"good": ("20260101T000000000000Z", {"name": "Bad board", "rows": ["A"]}),
       "other": ("20260103T000000000000Z", {"name": "Other board", "rows": []})}
TAMPERED = "20260102T000000000000Z-000000000000.json"
OTHER = revid(*BAD["other"]) + ".json"
REPEAT = revid("20260104T000000000000Z", BAD["other"][1]) + ".json"
NOT_JSON = "20260105T000000000000Z-%s.json" % hashlib.sha256(b"not json").hexdigest()[:12]
STRAY = "20260106T000000000000Z-aaaaaaaaaaaa.123.partial"


def setup_bad(directory):
    write_revisions(directory, "bad-board", [BAD["good"], BAD["other"], ("20260104T000000000000Z", BAD["other"][1])])
    folder = directory / "datasets" / ".history" / "bad-board"
    (folder / TAMPERED).write_bytes(data({"name": "Bad board", "rows": ["A", "B"]}))
    (folder / NOT_JSON).write_bytes(b"not json")
    (folder / STRAY).write_bytes(b"{}")
    (directory / "datasets" / ".history" / "Bad_Folder").mkdir()


def json_is(expected):
    def check(text):
        if "Secret" in text:
            raise AssertionError("output shows a held-out input:\n%s" % text)
        value = json.loads(text)
        if value != expected:
            raise AssertionError("expected %r\n     got %r" % (expected, value))
    return check


def fields(pairs):
    return json_is([{"field": k, "value": v} for k, v in pairs])


def column(name, expected):
    def check(text):
        value = [item[name] for item in json.loads(text)]
        if value != expected:
            raise AssertionError("expected %r\n     got %r" % (expected, value))
    return check


def case(argv, stdout, code=0, setup_fn=setup):
    return {"argv": argv, "stdout": stdout, "code": code, "setup": setup_fn}


J = ["--format", "json"]
MENU_ROW = ["menu-board", "Menu board", 3, "2026-01-01T09:00:00Z", "2026-03-01T09:00:00Z", size(MENU), True]
OLD_ROW = ["old-specials", "Old specials", 2, "2025-06-01T12:00:00Z", "2025-07-01T12:00:00Z", size(OLD), False]
WEEK_ROW = ["weekend-hours", "Weekend hours", 4, "2025-09-01T08:00:00Z", "2025-12-01T08:00:00Z", size(WEEKEND), True]
DS_COLUMNS = ["dataset", "name", "revisions", "oldest", "newest", "bytes", "file"]


def ds_rows(*rows):
    return json_is([dict(zip(DS_COLUMNS, row)) for row in rows])


def label_rows(columns, *rows):
    return json_is([dict(zip(["revision", "at"] + columns, row)) for row in rows])


KINDS = ["added", "removed", "changed"]
SPLIT = ["tuning_added", "tuning_removed", "tuning_changed", "test_added", "test_removed", "test_changed"]
AT1, AT2, AT3, NOW = "2026-01-01T09:00:00Z", "2026-02-01T09:00:00Z", "2026-03-01T09:00:00Z", "2026-04-01T09:00:00Z"
COVER = ["revision", "at", "rows", "hot", "size"]
CHECK_COLUMNS = ["revision", "at", "check", "model", "tuned_on", "signal", "gates", "min_accuracy", "min_coverage",
                 "slice_targets", "answer_sets"]
NO_CHECK = [False, None, None, None, None, None, None, None, None]

CASES = {
    "datasets": dict(case(["history", "datasets"] + J, ds_rows(MENU_ROW, OLD_ROW, WEEK_ROW)), options={
        "format": case(["history", "datasets", "--format", "csv"], re.compile(
            r'\A"dataset","name","revisions","oldest","newest","bytes","file"\r\n'
            r'"menu-board","Menu board","3","2026-01-01T09:00:00Z","2026-03-01T09:00:00Z","%d","True"\r\n' % size(MENU))),
        "sort": case(["history", "datasets", "--sort", "newest"] + J, ds_rows(MENU_ROW, WEEK_ROW, OLD_ROW)),
        "min": case(["history", "datasets", "--min", "3"] + J, ds_rows(MENU_ROW, WEEK_ROW)),
        "totals": case(["history", "datasets", "--totals"] + J, ds_rows(
            MENU_ROW, OLD_ROW, WEEK_ROW, ["(total)", None, 9, "2025-06-01T12:00:00Z", "2026-03-01T09:00:00Z",
                                          size(MENU) + size(OLD) + size(WEEKEND), None])),
    }),
    "show": dict(case(["history", "show", "menu-board", "20260301"] + J, fields([
        ("revision", R3), ("at", AT3), ("name", "Menu board"), ("saved_at", AT3), ("bytes", len(data(MENU[2][1]))),
        ("rows", 4), ("tuning_rows", 3), ("held_out_rows", 1), ("labeled_tuning", 3), ("labeled_held_out", 1),
        ("questions", 2), ("rules", False), ("check", True), ("guidelines", 0), ("test_looks", 0), ("same_as_current", False)])),
        options={
            "questions": case(["history", "show", "menu-board", "latest", "--questions"] + J, json_is([
                {"question": "hot", "type": "noul", "options": None, "labeled_tuning": 3, "labeled_held_out": 1},
                {"question": "size", "type": "choice", "options": 2, "labeled_tuning": 1, "labeled_held_out": 0}])),
            "restore_preview": case(["history", "show", "menu-board", "~0", "--restore-preview"] + J, fields([
                ("restoring", R3), ("file_exists", True), ("rows_before", 5), ("rows_after", 4), ("rows_added", 0),
                ("rows_removed", 1), ("order_changed", True), ("labels_added", 1), ("labels_removed", 1), ("labels_changed", 2),
                ("questions_changed", True), ("rules_changed", False), ("name_or_notes_changed", False), ("check", "preserved"),
                ("check_changed", True), ("guidelines_changed", 0), ("guidelines_dropped", 0), ("held_out_before", 1),
                ("held_out_after", 1), ("held_out_moved", 0), ("test_history", "preserved")])),
        }),
    "diff": dict(case(["history", "diff", "menu-board", "oldest"] + J, fields([
        ("from", R1), ("to", "current"), ("rows_before", 2), ("rows_after", 5), ("rows_added", 3), ("rows_removed", 0),
        ("order_changed", True), ("labels_added", 5), ("labels_removed", 0), ("labels_changed", 0), ("held_out_before", 0),
        ("held_out_after", 1), ("held_out_moved", 0), ("test_looks_before", 0), ("test_looks_after", 1),
        ("questions_changed", True), ("rules_changed", False), ("name_or_notes_changed", True), ("check_changed", True),
        ("guidelines_changed", 0)])),
        options={
            "by_question": case(["history", "diff", "menu-board", "~1", "latest", "--by-question"] + J, json_is([
                {"question": "hot", "added": 2, "removed": 0, "changed": 0},
                {"question": "size", "added": 1, "removed": 0, "changed": 0}])),
            "questions": case(["history", "diff", "menu-board", "latest", "current", "--questions"] + J, json_is([
                {"question": "size", "change": "options changed, moved"},
                {"question": "hot", "change": "instructions changed, moved"}])),
            "exit_code": case(["history", "diff", "menu-board", R3, "--exit-code"], re.compile(
                r"labels_added\s+1\n(.*\n)?labels_removed\s+1\nlabels_changed\s+2\n"), code=1),
        }),
    "labels": dict(case(["history", "labels", "menu-board", "hot"] + J, label_rows(
        KINDS, [R2, AT2, 2, 0, 0], [R3, AT3, 2, 0, 0], ["current", NOW, 1, 1, 1]), code=1),
        options={
            "all": case(["history", "labels", "menu-board", "size", "--all"] + J, label_rows(
                KINDS, [R2, AT2, 0, 0, 0], [R3, AT3, 1, 0, 0], ["current", NOW, 0, 0, 1]), code=1),
            "split": case(["history", "labels", "menu-board", "hot", "--split"] + J, label_rows(
                SPLIT, [R2, AT2, 2, 0, 0, 0, 0, 0], [R3, AT3, 1, 0, 0, 1, 0, 0], ["current", NOW, 1, 1, 0, 0, 0, 1]), code=1),
            "kind": case(["history", "labels", "menu-board", "hot", "--kind", "removed"] + J, label_rows(
                KINDS, ["current", NOW, 1, 1, 1]), code=1),
            "since": case(["history", "labels", "menu-board", "hot", "--since", "2026-03-01"] + J, label_rows(
                KINDS, [R3, AT3, 2, 0, 0], ["current", NOW, 1, 1, 1]), code=1),
        }),
    "coverage": dict(case(["history", "coverage", "menu-board"] + J, json_is([dict(zip(COVER, row)) for row in [
        [R1, AT1, 2, None, None], [R2, AT2, 3, 2, None], [R3, AT3, 4, 4, 1], ["current", NOW, 5, 4, 1]]])),
        options={
            "share": case(["history", "coverage", "menu-board", "--share"] + J, json_is([dict(zip(COVER, row)) for row in [
                [R1, AT1, 2, None, None], [R2, AT2, 3, 0.667, None], [R3, AT3, 4, 1.0, 0.25], ["current", NOW, 5, 0.8, 0.2]]])),
            "tuning": case(["history", "coverage", "menu-board", "--tuning"] + J, json_is([dict(zip(COVER, row)) for row in [
                [R1, AT1, 2, None, None], [R2, AT2, 3, 2, None], [R3, AT3, 3, 3, 1], ["current", NOW, 4, 3, 1]]])),
        }),
    "config": dict(case(["history", "config", "menu-board"] + J, label_rows(
        ["changed"], [R2, AT2, "questions"], [R3, AT3, "notes, questions, check, split"], ["current", NOW, "questions, check, looks"])),
        options={
            "part": case(["history", "config", "menu-board", "--part", "split"] + J, label_rows(
                ["changed"], [R3, AT3, "notes, questions, check, split"])),
        }),
    "checks": dict(case(["history", "checks", "menu-board"] + J, json_is([dict(zip(CHECK_COLUMNS, row)) for row in [
        [R1, AT1] + NO_CHECK, [R2, AT2] + NO_CHECK,
        [R3, AT3, True, "jev-latest", None, "confidence", 1, 0.9, 0.5, 0, 0],
        ["current", NOW, True, "jev-1.14.0", "jev-1.14.0", "confidence", 2, 0.9, 0.6, 0, 0]]])),
        options={
            "gates": case(["history", "checks", "menu-board", "--gates"] + J, lambda text: [
                (row["gate:hot"], row["gate:size"]) for row in json.loads(text)] == [(None, None), (None, None), (0.8, None), (0.85, 0.7)]
                or (_ for _ in ()).throw(AssertionError(text))),
            "changes": case(["history", "checks", "menu-board", "--changes"] + J, column("revision", [R1, R3, "current"])),
        }),
    "verify": dict(case(["history", "verify"] + J, json_is([
        {"dataset": "Bad_Folder", "file": "", "problem": "not a dataset id; the Workbench ignores this folder"},
        {"dataset": "bad-board", "file": TAMPERED, "problem": "its content does not match the hash in its name"},
        {"dataset": "bad-board", "file": OTHER, "problem": "named for another dataset, so it cannot be restored here"},
        {"dataset": "bad-board", "file": REPEAT,
         "problem": "named for another dataset, so it cannot be restored here; the same content as the revision before"},
        {"dataset": "bad-board", "file": NOT_JSON, "problem": "not a readable dataset file"},
        {"dataset": "bad-board", "file": STRAY, "problem": "not a revision file; the Workbench ignores it"}]), code=1, setup_fn=setup_bad),
        options={
            "all": case(["history", "verify", "bad-board", "--all"] + J, lambda text: [
                (row["file"], row["status"]) for row in json.loads(text)][:2] == [(revid(*BAD["good"]) + ".json", "ok"),
                                                                               (TAMPERED, "its content does not match the hash in its name")]
                and len(json.loads(text)) == 6 or (_ for _ in ()).throw(AssertionError(text)), code=1, setup_fn=setup_bad),
        }),
}


class CliHistoryTests(pack_tests(cli_history.PACK, CASES)):
    def test_good_history_checks_out(self):
        code, out, _err = run_cli(["history", "verify"], setup)
        self.assertEqual((code, out), (0, "All 9 kept revisions of 3 datasets check out.\n"))

    def test_verify_reports_more_revisions_than_the_keep_limit(self):
        code, out, _err = run_cli(["history", "verify", "daily-board"] + J, setup_full)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out), [{"dataset": "daily-board", "file": "",
                                            "problem": "21 revisions kept, more than the 20 the Workbench keeps"}])
        code, out, _err = run_cli(["history", "datasets", "--min", "20"] + J, setup_full)
        self.assertEqual((code, [row["dataset"] for row in json.loads(out)]), (0, ["daily-board"]))

    def test_revision_words_and_bad_usage_exit_two(self):
        for argv in (["history", "show", "menu-board", "2026"], ["history", "show", "menu-board", "~3"],
                     ["history", "show", "nothing-here"], ["history", "show", "Bad Id"], ["history", "labels", "menu-board", "nope"],
                     ["history", "show", "old-specials", "current"], ["history", "show", "menu-board", "current", "--restore-preview"]):
            self.assertEqual(run_cli(argv, setup)[0], 2, argv)
        code, out, _err = run_cli(["history", "show", "menu-board", "current"], setup)
        self.assertEqual(code, 0)
        self.assertRegex(out, r"revision\s+current\n")
        self.assertNotIn("Secret", out)

    def test_nothing_is_written(self):
        import io
        import tempfile
        from contextlib import redirect_stdout
        import lab as lab_cli  # scripts/lab.py, on the path through labkit
        with tempfile.TemporaryDirectory() as directory:
            previous = workbench.WORKBENCH_DIR
            workbench.WORKBENCH_DIR = Path(directory)
            try:
                setup(Path(directory))
            finally:
                workbench.WORKBENCH_DIR = previous
            before = sorted((str(p), p.read_bytes()) for p in Path(directory).rglob("*") if p.is_file())
            with redirect_stdout(io.StringIO()):
                for argv in (["history", "show", "menu-board", "oldest", "--restore-preview"], ["history", "diff", "menu-board", "oldest"],
                             ["history", "labels", "menu-board", "hot"], ["history", "verify"]):
                    lab_cli.main(["--data-dir", directory] + argv)
            after = sorted((str(p), p.read_bytes()) for p in Path(directory).rglob("*") if p.is_file())
            self.assertEqual(before, after)

if __name__ == "__main__":
    unittest.main()
