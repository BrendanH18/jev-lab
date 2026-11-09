"""Agreement recovery keeps human work and the blind sample without copying saved labels."""

import copy
import json
from unittest.mock import patch

from jev import agreement, agreementsession, workbench
from jev.workbench import WorkbenchError
from tests.test_agreement import Temp


class AgreementSessionTests(Temp):
    def setUp(self):
        super().setUp()
        self.save()
        self.sample = agreement.sample("tickets", 4, 13)
        self.items = [{"row_id": item["row_id"], "labels": {item["questions"][0]: "none"}}
                      for item in self.sample["items"]]
        self.before = workbench._dataset_path("tickets").read_bytes()

    def export(self, items=None, settlements=None):
        return agreementsession.export_session("tickets", self.sample["session_context"],
                                                self.sample["sample_size"], self.sample["seed"],
                                                self.items if items is None else items, settlements)

    def test_round_trip_preserves_original_sample_and_human_labels_only(self):
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("write")), \
                patch("jev.client.JevClient.system_one", side_effect=AssertionError("model")):
            session = json.loads(json.dumps(self.export()))
            result = agreementsession.import_session("tickets", session)
        self.assertEqual(result["items"], self.items)
        self.assertEqual(result["sample"], self.sample)
        self.assertEqual(result["counts"], {"rows": 4, "edited_rows": 4, "labels": 4, "settlements": 0})
        self.assertNotIn("report", result)
        for row in result["sample"]["items"]:
            self.assertNotIn("_expect", row["row"])
        for forbidden in ("answers", "first", "probabilities", "row", "_expect", "csv", "questions_schema"):
            self.assertNotIn('"%s"' % forbidden, json.dumps(session))
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), self.before)

    def test_false_zero_partial_labels_and_removal_settlement_survive(self):
        self.sample = agreement.sample("tickets", 200, 7)
        charged = next(item for item in self.sample["items"] if item["number"] == 1)
        refund = next(item for item in self.sample["items"] if item["number"] == 6)
        items = [{"row_id": charged["row_id"], "labels": {"is_urgent": False}},
                 {"row_id": refund["row_id"], "labels": {"frustration": 0}}]
        settlements = [{"row_id": charged["row_id"], "question": "is_urgent", "value": None},
                       {"row_id": refund["row_id"], "question": "frustration", "value": 0}]
        result = agreementsession.import_session("tickets", self.export(items, settlements))
        self.assertEqual(result["items"], items)
        self.assertEqual(result["settlements"], settlements)
        self.assertNotIn("first", json.dumps(result))

    def test_empty_download_does_not_seed_saved_labels(self):
        session = self.export([])
        self.assertEqual(session["items"], [])
        self.assertEqual(session["settlements"], [])
        self.assertNotIn("billing", json.dumps(session))

    def test_saved_label_changes_invalidate_import_and_export(self):
        session = self.export()
        dataset = workbench.load_dataset("tickets")
        dataset["rows"][0]["_expect"]["department"] = "shipping"
        workbench.write_dataset(dataset)
        with self.assertRaisesRegex(WorkbenchError, "unchanged"):
            agreementsession.import_session("tickets", session)
        with self.assertRaisesRegex(WorkbenchError, "changed"):
            self.export()

    def test_choice_order_is_part_of_the_snapshot(self):
        session = self.export()
        dataset = workbench.load_dataset("tickets")
        criteria = dataset["questions"]["department"]["criteria"]
        dataset["questions"]["department"]["criteria"] = dict(reversed(list(criteria.items())))
        workbench.write_dataset(dataset)
        with self.assertRaisesRegex(WorkbenchError, "unchanged"):
            agreementsession.import_session("tickets", session)

    def test_invalid_sessions_are_rejected_atomically(self):
        original = self.export()
        variants = [{}, {**original, "version": True}, {**original, "dataset": "elsewhere"},
                    {**original, "answers": {}}, {**original, "seed": True}, {**original, "rows": 0}]
        bad = copy.deepcopy(original)
        bad["members"][0]["questions"] = []
        variants.append(bad)
        for labels in ({"unknown": True}, {"department": "INVALID"}, {"frustration": float("nan")}, []):
            bad = copy.deepcopy(original)
            bad["items"][0]["labels"] = labels
            variants.append(bad)
        bad = copy.deepcopy(original)
        bad["items"].append(bad["items"][0])
        variants.append(bad)
        bad = copy.deepcopy(original)
        bad["settlements"] = [{"row_id": "unknown", "question": "department", "value": "billing"}]
        variants.append(bad)
        for bad in variants:
            with self.subTest(session=bad), self.assertRaises(WorkbenchError):
                agreementsession.import_session("tickets", bad)
        self.assertEqual(workbench._dataset_path("tickets").read_bytes(), self.before)

    def test_only_original_sample_and_eligible_questions_can_be_restored(self):
        self.sample = agreement.sample("tickets", 1, 13)
        all_rows = agreement.sample("tickets", 200, 13)["items"]
        outside = next(item for item in all_rows if item["row_id"] != self.sample["items"][0]["row_id"])
        with self.assertRaisesRegex(WorkbenchError, "unknown"):
            self.export([{"row_id": outside["row_id"], "labels": {"department": "billing"}}])
        only = self.sample["items"][0]
        self.assertNotIn("wants_refund", only["questions"])
        with self.assertRaisesRegex(WorkbenchError, "eligible"):
            self.export([{"row_id": only["row_id"], "labels": {"wants_refund": False}}])

    def test_retained_settlement_beyond_display_cap_round_trips(self):
        questions = {"q%d" % i: {"type": "noul", "instructions": "Question %d?" % i} for i in range(3)}
        self.save([{"text": "Coffee %d" % i, "_expect": {qid: True for qid in questions}} for i in range(180)], questions)
        self.sample = agreement.sample("tickets", 200, 7)
        items = [{"row_id": item["row_id"], "labels": {qid: False for qid in questions}} for item in self.sample["items"]]
        settlement = {"row_id": self.sample["items"][-1]["row_id"], "question": "q2", "value": True}
        report = agreement.compare("tickets", items=items)
        self.assertEqual(len(report["disagreements"]), agreement.SHOWN)
        self.assertEqual(report["disagreements_total"], 540)
        self.assertNotIn(settlement["row_id"], {item["row_id"] for item in report["disagreements"]})
        result = agreementsession.import_session("tickets", self.export(items, [settlement]))
        self.assertEqual(result["settlements"], [settlement])
