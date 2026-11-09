"""Review recovery preserves a blind sample and human edits without replay files or writes."""

import copy
import json
from unittest.mock import patch

import server
from jev import decisions, reviewsession, workbench
from jev.workbench import WorkbenchError
from tests.test_decisions import Temp


class SessionTests(Temp):
    def setUp(self):
        super().setUp()
        self.save()
        self.text = self.route()
        self.report = decisions.queue("tickets", self.text, audit=2, seed=12)
        self.edits = [{"line": self.report["items"][0]["line"],
                       "labels": {"department": "shipping", "is_urgent": False, "frustration": 0}},
                      {"line": self.report["items"][-1]["line"], "labels": {"department": None}}]
        self.before = workbench._dataset_path("tickets").read_bytes()

    def export(self, edits=None):
        return reviewsession.export_session("tickets", self.text, self.report["seed"],
                                            self.report["audit_requested"], self.report["session_context"],
                                            self.edits if edits is None else edits)

    def test_round_trip_preserves_sample_edits_and_blind_audit(self):
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("write")), \
                patch("jev.client.JevClient.system_one", side_effect=AssertionError("model")):
            session = json.loads(json.dumps(self.export()))
            out = reviewsession.import_session("tickets", self.text, session)
        self.assertEqual(out["edits"], self.edits)
        self.assertEqual([(i["line"], i["kind"]) for i in out["report"]["items"]],
                         [(i["line"], i["kind"]) for i in self.report["items"]])
        first = out["report"]["items"][0]
        self.assertIs(first["labels"]["is_urgent"], False)
        self.assertEqual(first["labels"]["frustration"], 0)
        for item in out["report"]["items"]:
            if item["kind"] == "audit":
                self.assertTrue(all(value is None for value in item["labels"].values()))
        self.assertEqual(out["counts"], {"rows": 4, "edited_rows": 2, "labels": 4})
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), self.before)

    def test_download_has_no_model_answers_shortlists_inputs_or_seeded_labels(self):
        empty = self.export([])
        self.assertEqual(empty["edits"], [])
        text = json.dumps(empty)
        for forbidden in ("answers", "candidates", "provenance", "row", "Refund my order today", "billing"):
            self.assertNotIn('"%s"' % forbidden, text)
        self.assertEqual(empty["members"], [{"line": i["line"], "kind": i["kind"]}
                                            for i in self.report["items"]])

    def test_exact_source_and_saved_snapshot_required_on_import_and_export(self):
        session = self.export()
        with self.assertRaisesRegex(WorkbenchError, "original decisions"):
            reviewsession.import_session("tickets", self.text + "\n", session)
        with self.assertRaisesRegex(WorkbenchError, "changed"):
            reviewsession.export_session("tickets", self.text + "\n", 12, 2,
                                         self.report["session_context"], self.edits)
        saved = workbench.load_dataset("tickets")
        saved["rows"][0]["_expect"]["department"] = "shipping"
        workbench.write_dataset(saved)
        with self.assertRaisesRegex(WorkbenchError, "unchanged"):
            reviewsession.import_session("tickets", self.text, session)
        with self.assertRaisesRegex(WorkbenchError, "changed"):
            self.export()

    def test_choice_order_is_part_of_binding(self):
        session = self.export()
        saved = workbench.load_dataset("tickets")
        criteria = saved["questions"]["department"]["criteria"]
        saved["questions"]["department"]["criteria"] = dict(reversed(list(criteria.items())))
        workbench.write_dataset(saved)
        with self.assertRaises(WorkbenchError):
            reviewsession.import_session("tickets", self.text, session)

    def test_tampered_session_rejected_atomically(self):
        original = self.export()
        variants = [{}, {**original, "version": True}, {**original, "dataset": "other"},
                    {**original, "answers": {}}, {**original, "seed": True}, {**original, "audit": -1}]
        for key, value in (("line", True), ("line", 999), ("kind", "audit"), ("answers", {})):
            bad = copy.deepcopy(original)
            bad["members"][0][key] = value
            variants.append(bad)
        for labels in ({"unknown": True}, {"department": "INVALID"}, {"frustration": float("nan")}, []):
            bad = copy.deepcopy(original)
            bad["edits"][0]["labels"] = labels
            variants.append(bad)
        bad = copy.deepcopy(original)
        bad["edits"].append(bad["edits"][0])
        variants.append(bad)
        for bad in variants:
            with self.subTest(session=bad), self.assertRaises(WorkbenchError):
                reviewsession.import_session("tickets", self.text, bad)
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), self.before)

    def test_legacy_auto_rows_cannot_enter_restored_audit(self):
        lines = [json.loads(line) for line in self.text.splitlines()]
        for item in lines:
            item.pop("provenance", None)
        text = "\n".join(json.dumps(item) for item in lines)
        report = decisions.queue("tickets", text, 2, 12)
        session = reviewsession.export_session("tickets", text, 12, 2, report["session_context"], [])
        out = reviewsession.import_session("tickets", text, session)
        self.assertEqual(out["report"]["counts"]["audit"], 0)
        self.assertTrue(all(i["kind"] == "review" for i in out["report"]["items"]))

    def test_routes_expose_export_and_preview_only(self):
        export = server.ROUTES[("POST", "/api/workbench/checks/decisions/session/export")]
        restore = server.ROUTES[("POST", "/api/workbench/checks/decisions/session/import")]
        session = export({"id": "tickets", "text": self.text, "seed": 12, "audit": 2,
                          "context": self.report["session_context"], "items": self.edits})
        out = restore({"id": "tickets", "text": self.text, "session": session})
        self.assertEqual(out["edits"], self.edits)
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), self.before)

    def test_slices_use_full_normalized_values_and_hide_markers(self):
        data = [json.loads(line) for line in self.text.splitlines()]
        long = "x" * 100
        for index, item in enumerate(data):
            item["row"].update({"channel": long + str(index % 2), "_test": bool(index % 2)})
        report = decisions.queue("tickets", "\n".join(json.dumps(item) for item in data), 2, 12)
        fields = {option["name"]: option["values"] for option in report["slice_fields"]}
        self.assertEqual(fields["channel"], [long + "0", long + "1"])
        self.assertNotIn("_test", fields)
        self.assertTrue(all(item["slice_values"]["channel"] == item["row"]["channel"]
                            for item in report["items"]))
