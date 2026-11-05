"""Picture rows in Bulk: a row's "_image" travels as an image asset named in its state, Box questions run on them,
and Calibrate scores Box answers by overlap. No key, no network."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from helpers import FakeClient  # noqa: E402
from jev import calibrate, claims, gate, images, workbench  # noqa: E402

Q = {"damaged": {"type": "noul", "instructions": "Is anything in `photo` damaged?"},
     "where": {"type": "box", "instructions": "the damage in `photo`"}}


class Recorder(FakeClient):
    """A FakeClient that keeps the assets of every call."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.sent_assets = []

    def system_one(self, state, questions, assets=None, model=None):
        self.sent_assets.append(assets)
        return super().system_one(state, questions, assets=assets, model=model)


class PictureRowTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        patcher = patch.object(workbench, "WORKBENCH_DIR", Path(tmp))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_picture_row_sends_its_picture_as_photo(self):
        client = Recorder()
        rows = [{"note": "torn", "_image": "torn-bag", "_expect": {"damaged": True}}, {"note": "fine", "_image": "intact-bag"}]
        res = workbench.run_bulk(client, rows, Q)
        self.assertEqual(res["completed"], 2)
        (state, _), _ = client.calls
        self.assertNotIn("_image", state)
        self.assertNotIn("_expect", state)
        (ref, asset), = client.sent_assets[0].items()
        self.assertEqual(state["photo"], ref)
        self.assertTrue(images.REF_RE.fullmatch(ref))
        self.assertEqual(asset["sample"], "torn-bag")
        self.assertEqual(res["results"][0]["row"]["_image"], "torn-bag", "the row keeps its picture's name for the table")
        self.assertNotEqual(ref, client.calls[1][0]["photo"], "each picture has its own reference")

    def test_box_questions_need_a_picture_on_every_row(self):
        with self.assertRaises(workbench.WorkbenchError) as ctx:
            workbench.run_bulk(FakeClient(), [{"note": "a", "_image": "torn-bag"}, "no picture"], Q)
        self.assertIn("row 2", str(ctx.exception))
        text_only = workbench.run_bulk(FakeClient(), ["just text"], {"damaged": Q["damaged"]})
        self.assertEqual(text_only["completed"], 1, "questions without a Box still run on text rows")

    def test_bad_picture_rows_are_refused_before_any_call(self):
        client = FakeClient()
        for row, message in (({"_image": "nope"}, "sample picture"), ({"_image": "torn-bag", "photo": "x"}, "own 'photo'"),
                             ({"_image": "0123456789abcdef.png"}, "Missing image")):
            with self.subTest(row=row), self.assertRaises(workbench.WorkbenchError) as ctx:
                workbench.run_bulk(client, [row], Q)
            self.assertIn(message, str(ctx.exception))
        self.assertEqual(client.calls, [])

    def test_a_rewritten_row_keeps_its_picture_reference(self):
        client = Recorder()
        variants = [{"questions": Q}, {"questions": Q, "perturb": "typos"}]
        workbench.run_compare(client, [{"note": "the bag arrived torn open", "_image": "torn-bag"}], variants)
        plain, typos = (state for state, _ in client.calls)
        self.assertEqual(plain["photo"], typos["photo"])
        self.assertNotEqual(plain["note"], typos["note"])

    def test_uploaded_pictures_are_stored_and_loaded_by_name(self):
        upload = images.wire_asset(images.sample_asset("crushed-box"))
        (name,) = workbench.save_pictures([{"data_base64": upload["data_base64"]}])
        self.assertTrue(workbench.IMAGE_FILE.fullmatch(name))
        self.assertTrue((workbench.images_dir() / name).exists())
        loaded = workbench.load_pictures([name, "torn-bag"])
        self.assertEqual(loaded[name]["data_base64"], upload["data_base64"])
        client = Recorder()
        workbench.run_bulk(client, [{"_image": name}], Q)
        self.assertEqual(next(iter(client.sent_assets[0].values()))["sha"], name.split(".")[0])
        for bad in ([], [{"sample": "torn-bag"}], [{"data_base64": "!!"}], [{}] * (workbench.MAX_SAVED_PICTURES + 1)):
            with self.subTest(bad=str(bad)[:30]), self.assertRaises(workbench.WorkbenchError):
                workbench.save_pictures(bad)

    def test_datasets_keep_picture_rows_and_box_questions(self):
        rows = [{"note": "torn", "_image": "torn-bag", "_expect": {"damaged": True}}, {"note": "fine", "_image": "intact-bag"}]
        saved = workbench.save_dataset({"name": "Photos", "rows": rows, "questions": Q})
        self.assertEqual([r["_image"] for r in saved["rows"]], ["torn-bag", "intact-bag"])
        with self.assertRaises(workbench.WorkbenchError):
            workbench.save_dataset({"name": "Photos", "rows": ["text"], "questions": Q})

    def test_claims_photo_questions_run_on_picture_rows(self):
        rows = [{"order": {"items": "2 bags"}, "customer_note": ex["note"], "_image": ex["sample"]} for ex in claims.EXAMPLES]
        res = workbench.run_bulk(FakeClient(), rows, claims.questions())
        self.assertEqual(res["completed"], len(claims.EXAMPLES))

    def test_calibrate_scores_box_answers_by_overlap(self):
        label = {"left": 0.4, "top": 0.3, "right": 0.7, "bottom": 0.6}
        res = workbench.run_bulk(FakeClient(lambda s, q: {"where": dict(label, confidence=0.9)}),
                                 [{"_image": "torn-bag", "_expect": {"where": label}}], Q)
        r = res["results"][0]
        rep = calibrate.evaluate([{"index": 0, "answer": r["answers"]["where"], "label": r["expect"]["where"]}])
        self.assertEqual((rep["type"], rep["correct"], rep["labeled"]), ("box", 1, 1))

    def test_an_exported_gate_returns_boxes_but_cannot_gate_them(self):
        self.assertIn("Box(", gate.export(Q, {"damaged": 0.5}, "confidence", "jev-1.14.0")["python"])
        with self.assertRaises(workbench.WorkbenchError):
            gate.export(Q, {"where": 0.5}, "confidence", "jev-1.14.0")


class RouteTests(unittest.TestCase):
    def test_routes(self):
        import server

        self.assertIs(server.ROUTES[("POST", "/api/workbench/pictures")], server.api_wb_pictures_save)
        self.assertIn("torn-bag", server.api_wb_pictures_load({"names": ["torn-bag"]})["pictures"])


if __name__ == "__main__":
    unittest.main()
