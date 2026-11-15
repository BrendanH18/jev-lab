"""Tests for the cli-bundles Lab pack (jev/lab/packs/cli_bundles.py): offline inspection and export of dataset bundles.
Fictional Harbor Coffee Co. data only."""

import base64
import io
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests, run_cli  # noqa: E402
from jev import bundles, checks, images, workbench  # noqa: E402
from jev.lab import kit  # noqa: E402
from jev.lab.packs import cli_bundles  # noqa: E402

TMP = tempfile.TemporaryDirectory()
DIR = Path(TMP.name)
SUPPORT_ZIP, PHOTO_ZIP, NOT_ZIP = DIR / "support.zip", DIR / "photos.zip", DIR / "notes.txt"
NOT_ZIP.write_text("not a bundle\n")
OUT, EXISTING = DIR / "export.zip", DIR / "existing.zip"
EXISTING.write_text("old\n")


def tearDownModule():
    TMP.cleanup()


QUESTIONS = {"team": {"type": "choice", "instructions": "Which team handles it?", "criteria": {"billing": "Money", "shipping": "Parcels"}},
             "urgent": {"type": "noul", "instructions": "Is it urgent?"}}
ROWS = [{"text": "Charged twice", "_expect": {"team": "billing"}}, {"text": "Refund please", "_expect": {"team": "billing"}},
        {"text": "Bag torn", "_expect": {"team": "shipping"}}, {"text": "Box crushed", "_expect": {"team": "shipping"}},
        {"text": "Held secret", "_test": True, "_expect": {"team": "shipping"}}, "Grinder squeals"]
GUIDES = {"team": {"note": "Refunds go to billing."}}
PHOTO_ROWS = [{"note": "Seal split", "_image": "torn-bag", "_expect": {"damaged": True}}, {"note": "Fine", "_image": "intact-bag"},
              {"note": "Held dent", "_image": "torn-bag", "_test": True, "_expect": {"damaged": True}}]
PHOTO_QUESTIONS = {"damaged": {"type": "noul", "instructions": "Is the bag in `photo` damaged?"}}


def _write_bundle(dataset_id, path):
    path.write_bytes(base64.b64decode(bundles.export_bundle(dataset_id)["data"]))


def save(directory):
    workbench.save_dataset({"name": "Support", "questions": QUESTIONS, "rows": ROWS, "guidelines": GUIDES})
    checks.save_check("support", {"gates": {"team": 0.8}, "model": "jev-1.14.0", "min_accuracy": 0.9})
    _write_bundle("support", SUPPORT_ZIP)
    changed = [dict(ROWS[0]), {"text": "Refund please", "_expect": {"team": "shipping"}}] + ROWS[2:] + ["Mug chipped"]
    workbench.save_dataset({"name": "Support", "questions": QUESTIONS, "rows": changed})
    workbench.save_dataset({"name": "Support copy", "questions": QUESTIONS, "rows": ROWS, "guidelines": GUIDES})
    workbench.save_dataset({"name": "Parcel photos", "questions": PHOTO_QUESTIONS, "rows": PHOTO_ROWS})
    _write_bundle("parcel-photos", PHOTO_ZIP)


def table(columns, rows):
    return kit.render(columns, rows, "table") + "\n"


def same_json(expected):
    def check(text):
        if json.loads(text) != expected:
            raise AssertionError("got %s, expected %s" % (text, json.dumps(expected)))
    return check


FACTS = {"name": "Support", "id": "support", "rows": 6, "held_out_rows": 1, "labeled_tuning_rows": 4, "questions": 2, "pictures": 0,
         "picture_bytes": 0, "rules": False, "check_model": "jev-1.14.0", "guidelines": 1, "test_looks": 0, "saved_dataset_exists": True}


def show_table(text):
    facts = dict(FACTS, bytes=SUPPORT_ZIP.stat().st_size)
    order = ["name", "id", "bytes", "rows", "held_out_rows", "labeled_tuning_rows", "questions", "pictures", "picture_bytes", "rules",
             "check_model", "guidelines", "test_looks", "saved_dataset_exists"]
    expected = table(["fact", "value"], [[key.replace("_", " "), facts[key]] for key in order])
    if text != expected:
        raise AssertionError("%s\n!=\n%s" % (text, expected))


def show_json(text):
    same_json(dict(FACTS, bytes=SUPPORT_ZIP.stat().st_size))(text)


def picture_rows():
    out = []
    for name, uses in (("intact-bag", 1), ("torn-bag", 2)):
        info = images.sample_asset(name)
        out.append([name, "%s.%s" % (info["sha"], info["format"]), info["format"], info["width"], info["height"], info["bytes"], uses, False])
    return out


PICTURES = ["in bundle", "saved as", "format", "width", "height", "bytes", "rows", "already saved"]
QCOLUMNS = ["question", "type", "options or levels", "labeled tuning rows", "gated", "guideline"]
QROWS = [["team", "choice", 2, 4, True, True], ["urgent", "noul", 0, 0, False, False]]
DIFF = ["change", "saved", "bundle"]


def diff_rows(rows_before, removed, order, labels_changed, metadata, check):
    return [["rows", rows_before, 6], ["rows added", None, 0], ["rows removed", None, removed], ["row order changed", None, order],
            ["labels added", None, 0], ["labels removed", None, 0], ["labels changed", None, labels_changed],
            ["questions changed", None, False], ["rules changed", None, False], ["name or notes changed", None, metadata],
            ["check changed", None, check], ["guidelines", 1, 1], ["guidelines added, removed or changed", None, 0],
            ["held-out rows", 1, 1], ["rows moved in or out of the split", None, 0]]


def wrote(path, force=False):
    def check(text):
        match = re.fullmatch(r"wrote the bundle of support to %s \((\d+) bytes\)\n" % re.escape(str(path)), text)
        data = Path(path).read_bytes()
        if not match or int(match.group(1)) != len(data):
            raise AssertionError(text)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            manifest = json.loads(archive.read("dataset.json"))
        if manifest["format"] != "jev-lab-dataset" or len(manifest["dataset"]["rows"]) != 7:
            raise AssertionError(manifest)
    return check


CASES = {
    "show": {"argv": ["bundles", "show", SUPPORT_ZIP], "setup": save, "stdout": show_table,
             "options": {"json": {"argv": ["bundles", "show", SUPPORT_ZIP, "--json"], "setup": save, "stdout": show_json}}},
    "validate": {"argv": ["bundles", "validate", PHOTO_ZIP], "setup": save, "stdout": "valid bundle of Parcel photos: 3 rows, 2 pictures\n"},
    "pictures": {"argv": ["bundles", "pictures", PHOTO_ZIP], "setup": save, "stdout": lambda text: _equal(text, table(PICTURES, picture_rows())),
                 "options": {"format": {"argv": ["bundles", "pictures", PHOTO_ZIP, "--format", "json"], "setup": save,
                                        "stdout": lambda text: same_json([dict(zip(PICTURES, row)) for row in picture_rows()])(text)}}},
    "questions": {"argv": ["bundles", "questions", SUPPORT_ZIP], "setup": save, "stdout": table(QCOLUMNS, QROWS),
                  "options": {"format": {"argv": ["bundles", "questions", SUPPORT_ZIP, "--format", "csv"], "setup": save,
                                         "stdout": kit.render(QCOLUMNS, QROWS, "csv") + "\n"}}},
    # The saved dataset gained a row (Mug chipped) and relabeled one after the bundle was exported.
    "diff": {"argv": ["bundles", "diff", SUPPORT_ZIP], "setup": save, "code": 1,
             "stdout": "importing %s over saved dataset support\n" % SUPPORT_ZIP + table(DIFF, diff_rows(7, 1, True, 1, False, False)),
             "options": {
                 # The copy has the same rows and guidelines under another name, and no check.
                 "dataset": {"argv": ["bundles", "diff", SUPPORT_ZIP, "--dataset", "support-copy"], "setup": save, "code": 1,
                             "stdout": "importing %s over saved dataset support-copy\n" % SUPPORT_ZIP + table(DIFF, diff_rows(6, 0, False, 0, True, True))},
                 "format": {"argv": ["bundles", "diff", SUPPORT_ZIP, "--format", "json"], "setup": save, "code": 1,
                            "stdout": same_json([dict(zip(DIFF, row)) for row in diff_rows(7, 1, True, 1, False, False)])}}},
    "export": {"argv": ["bundles", "export", "support", "--out", OUT], "setup": save, "stdout": wrote(OUT),
               "options": {"force": {"argv": ["bundles", "export", "support", "--out", EXISTING, "--force"], "setup": save, "stdout": wrote(EXISTING)}}},
}


def _equal(text, expected):
    if text != expected:
        raise AssertionError("%s\n!=\n%s" % (text, expected))


class CliBundlesTests(pack_tests(cli_bundles.PACK, CASES)):
    def test_invalid_bundles(self):
        code, out, _err = run_cli(["bundles", "validate", NOT_ZIP], save)
        self.assertEqual(code, 1)
        self.assertTrue(out.startswith("invalid bundle: "), out)
        for argv in (["bundles", "show", NOT_ZIP], ["bundles", "show", DIR / "missing.zip"], ["bundles", "diff", SUPPORT_ZIP, "--dataset", "nope"],
                     ["bundles", "export", "support", "--out", EXISTING]):
            self.assertEqual(run_cli(argv, save)[0], 2, argv)

    def test_unchanged_import_exits_zero(self):
        def fresh(directory):
            workbench.save_dataset({"name": "Support", "questions": QUESTIONS, "rows": ROWS, "guidelines": GUIDES})
            _write_bundle("support", DIR / "fresh.zip")
        code, out, _err = run_cli(["bundles", "diff", DIR / "fresh.zip", "--format", "json"], fresh)
        self.assertEqual(code, 0, out)

    def test_never_prints_label_values_or_held_out_inputs(self):
        for argv in (["bundles", "show", SUPPORT_ZIP, "--json"], ["bundles", "diff", SUPPORT_ZIP], ["bundles", "questions", SUPPORT_ZIP]):
            out = run_cli(argv, save)[1]
            for secret in ("Held secret", "billing", "shipping"):
                self.assertNotIn(secret, out, argv)
