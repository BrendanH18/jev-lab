import base64
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from helpers import FakeClient
from jev import bundles, checks, images, workbench

Q = {"damaged": {"type": "noul", "instructions": "Is the bag in `photo` damaged?"},
     "where": {"type": "box", "instructions": "The bag in `photo`"}}
CHECK = {"gates": {"damaged": 0.8}, "signal": "confidence", "bound": "estimate", "model": "jev-1.14.0",
         "tuned_on": "jev-1.14.0", "min_accuracy": 0.95, "min_coverage": 0.5,
         "slice_targets": [{"field": "text", "value": "broken", "min_accuracy": 0.95, "min_coverage": 0.5}]}


def encoded(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return base64.b64encode(out.getvalue()).decode("ascii")


def contents(data):
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(data))) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patch = patch.object(workbench, "WORKBENCH_DIR", self.root / "source")
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def saved(self):
        dataset = workbench.save_dataset({"name": "Photo check", "notes": "Human labels",
            "questions": Q, "rows": [
                {"text": "broken", "_image": "torn-bag", "_expect": {"damaged": True}},
                {"text": "fine", "_image": "intact-bag", "_expect": {"damaged": False}, "_test": True}]})
        dataset = checks.save_check(dataset["id"], CHECK)
        dataset["test"] = {"locked_at": "2026-11-05T01:00:00Z", "looks": [
            {"at": "2026-11-05T02:00:00Z", "gates": {"damaged": 0.8}, "signal": "confidence",
             "model": "jev-1.14.0"}]}
        workbench.write_dataset(dataset)
        return dataset

    def test_round_trip_picture_check_history_and_preview_is_read_only(self):
        original = self.saved()
        exported = bundles.export_bundle(original["id"])
        self.assertEqual(exported["filename"], "photo-check.zip")
        with patch.object(workbench, "WORKBENCH_DIR", self.root / "destination"):
            preview = bundles.preview_bundle(exported["data"])
            self.assertEqual(preview["images"], 2)
            self.assertEqual(preview["summary"]["test"]["looks"], 1)
            self.assertFalse(preview["exists"])
            self.assertFalse(workbench.WORKBENCH_DIR.exists())
            imported = bundles.import_bundle(exported["data"])
            self.assertEqual(imported["check"], original["check"])
            self.assertEqual(imported["test"], original["test"])
            self.assertEqual(imported["questions"], Q)
            for row, prior in zip(imported["rows"], original["rows"]):
                self.assertEqual(row["_expect"], prior["_expect"])
                self.assertEqual(row.get("_test"), prior.get("_test"))
                self.assertTrue(workbench.IMAGE_FILE.fullmatch(row["_image"]))
                self.assertEqual(workbench.picture_asset(row["_image"])["data"], images.sample_bytes(prior["_image"]))
            self.assertTrue(bundles.preview_bundle(exported["data"])["exists"])
            # The imported photos can travel again without access to the original sample names.
            again = bundles.export_bundle(imported["id"])
            self.assertEqual(bundles.preview_bundle(again["data"])["dataset"]["rows"], imported["rows"])

    def test_collision_requires_explicit_replace_and_can_rename(self):
        dataset = self.saved()
        data = bundles.export_bundle(dataset["id"])["data"]
        before = workbench._dataset_path(dataset["id"]).read_bytes()
        with self.assertRaisesRegex(workbench.WorkbenchError, "Confirm replacement"):
            bundles.import_bundle(data)
        self.assertEqual(workbench._dataset_path(dataset["id"]).read_bytes(), before)
        self.assertEqual(bundles.import_bundle(data, name="Another dataset")["id"], "another-dataset")
        self.assertEqual(bundles.import_bundle(data, replace=True)["id"], dataset["id"])
        with self.assertRaisesRegex(workbench.WorkbenchError, "true or false"):
            bundles.import_bundle(data, replace="true")

    def test_picture_slice_follows_renamed_picture_and_still_passes_after_import(self):
        dataset = self.saved()
        target = {"field": "_image", "value": "torn-bag", "min_accuracy": 1, "min_coverage": 1}
        checks.save_check(dataset["id"], dict(CHECK, min_accuracy=1, slice_targets=[target]))
        client = FakeClient(lambda state, _: {"damaged": 0.99 if state["text"] == "broken" else 0.01})
        self.assertEqual(checks.run(client, dataset["id"])["status"], "pass")
        data = bundles.export_bundle(dataset["id"])["data"]
        with patch.object(workbench, "WORKBENCH_DIR", self.root / "destination"):
            preview = bundles.preview_bundle(data)
            renamed = preview["dataset"]["rows"][0]["_image"]
            self.assertNotEqual(renamed, "torn-bag")
            self.assertEqual(preview["dataset"]["check"]["slice_targets"], [dict(target, value=renamed)])
            imported = bundles.import_bundle(data)
            report = checks.run(client, imported["id"])
            self.assertEqual(report["status"], "pass")
            self.assertEqual(report["slice_targets"][0]["rows"], 1)
            again = bundles.export_bundle(imported["id"])["data"]
            self.assertEqual(bundles.preview_bundle(again)["dataset"]["check"], imported["check"])

    def test_export_and_import_allowlist_metadata(self):
        dataset = self.saved()
        dataset["answers"] = {"secret": "do not travel"}
        dataset["api_key"] = "do not travel"
        dataset["check"]["answers"] = "do not travel"
        dataset["check"]["slice_targets"][0]["result"] = "do not travel"
        dataset["test"]["looks"][0]["accuracy"] = "do not travel"
        workbench.write_dataset(dataset)
        data = bundles.export_bundle(dataset["id"])["data"]
        self.assertNotIn(b"do not travel", contents(data)["dataset.json"])
        files = contents(data)
        manifest = json.loads(files["dataset.json"])
        manifest["dataset"]["trace"] = "do not travel"
        files["dataset.json"] = json.dumps(manifest)
        self.assertNotIn("trace", bundles.preview_bundle(encoded(files))["dataset"])

    def test_rejects_invalid_archive_missing_picture_and_path_traversal(self):
        dataset = self.saved()
        files = contents(bundles.export_bundle(dataset["id"])["data"])
        for modified in [dict(files, **{"../evil": b"bad"}),
                         {key: value for key, value in files.items() if key != "images/torn-bag"},
                         dict(files, **{"images/torn-bag": b"not a photo"})]:
            with self.subTest(files=list(modified)):
                with self.assertRaises(workbench.WorkbenchError):
                    bundles.import_bundle(encoded(modified), name="Rejected")
        self.assertFalse(workbench._dataset_path("rejected").exists())
        for bad in ["not base64", base64.b64encode(b"not zip").decode(), ""]:
            with self.assertRaises(workbench.WorkbenchError):
                bundles.preview_bundle(bad)

    def test_rejects_oversized_expansion_and_duplicate_names(self):
        with self.assertRaisesRegex(workbench.WorkbenchError, "Expanded bundle"):
            bundles.preview_bundle(encoded({"dataset.json": b"x" * (bundles.MAX_BUNDLE_BYTES + 1)}))
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("dataset.json", "{}")
            with self.assertWarns(UserWarning):
                archive.writestr("dataset.json", "{}")
        with self.assertRaisesRegex(workbench.WorkbenchError, "duplicate"):
            bundles.preview_bundle(base64.b64encode(buffer.getvalue()).decode())

    def test_rejects_invalid_version_check_history_and_hash(self):
        dataset = self.saved()
        original = contents(bundles.export_bundle(dataset["id"])["data"])
        for mutation in [lambda m: m.update(version=2),
                         lambda m: m["dataset"]["check"].update(gates={"where": 0.8}),
                         lambda m: m["dataset"]["test"].update(looks=["invalid"]),
                         lambda m: m["dataset"].pop("test")]:
            manifest = json.loads(original["dataset.json"])
            mutation(manifest)
            modified = dict(original, **{"dataset.json": json.dumps(manifest)})
            with self.assertRaises(workbench.WorkbenchError):
                bundles.preview_bundle(encoded(modified))
        manifest = json.loads(original["dataset.json"])
        manifest["dataset"]["rows"][0]["_image"] = "0" * 16 + ".png"
        files = dict(original, **{"dataset.json": json.dumps(manifest)})
        files["images/" + "0" * 16 + ".png"] = files.pop("images/torn-bag")
        with self.assertRaisesRegex(workbench.WorkbenchError, "filename does not match"):
            bundles.preview_bundle(encoded(files))

    def test_existing_picture_is_never_overwritten(self):
        data = bundles.export_bundle(self.saved()["id"])["data"]
        preview = bundles.preview_bundle(data)
        name = preview["dataset"]["rows"][0]["_image"]
        workbench.images_dir().mkdir(parents=True)
        path = workbench.images_dir() / name
        path.write_bytes(b"different")
        with self.assertRaisesRegex(workbench.WorkbenchError, "different bytes"):
            bundles.import_bundle(data, name="Rejected")
        self.assertEqual(path.read_bytes(), b"different")
        self.assertFalse(workbench._dataset_path("rejected").exists())

    def test_text_dataset_without_questions_or_pictures(self):
        dataset = workbench.save_dataset({"name": "Plain", "rows": ["hello"]})
        data = bundles.export_bundle(dataset["id"])["data"]
        preview = bundles.preview_bundle(data)
        self.assertEqual(preview["images"], 0)
        self.assertEqual(preview["dataset"]["rows"], ["hello"])
        self.assertEqual(bundles.import_bundle(data, name="Imported")["rows"], ["hello"])
