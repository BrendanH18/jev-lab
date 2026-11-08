"""Spreadsheet prelabel handoff stays bound to its source without saving or model calls."""

import copy
import csv
import io
import json
import unittest
from unittest.mock import patch

from jev import prelabel
from jev.workbench import WorkbenchError
from tests.test_prelabel import QUESTIONS


def read(text):
    return list(csv.DictReader(io.StringIO(text)))


def write(rows):
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(rows[0]), lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


class PrelabelCSVTests(unittest.TestCase):
    def setUp(self):
        self.rows = ["same", "same", {"text": "partial", "_expect": {"team": "INVALID", "urgent": False}},
                     {"text": "held-secret", "_test": True, "_expect": {"team": "shipping"}}, ["array"]]

    def test_export_has_blank_labels_only_and_distinct_duplicate_positions(self):
        result = prelabel.export_labels(self.rows, QUESTIONS)
        self.assertEqual(result["rows"], 3)
        records = read(result["csv"])
        self.assertEqual(list(records[0]), ["row_id", "input", "missing", "label:team", "label:urgent", "label:severity"])
        self.assertEqual(len({r["row_id"] for r in records}), 3)
        self.assertEqual(records[0]["input"], records[1]["input"])
        self.assertEqual(json.loads(records[0]["input"]), {"text": "same"})
        for row in records:
            self.assertTrue(all(v == "" for k, v in row.items() if k.startswith("label:")))
        for secret in ("held-secret", "INVALID", "_expect", "_test", "shipping", "array"):
            self.assertNotIn(secret, result["csv"])

    def test_preview_normalizes_labels_and_preserves_source_without_side_effects(self):
        original = copy.deepcopy(self.rows)
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("must not save")), \
                patch("jev.client.JevClient.system_one", side_effect=AssertionError("must not call")):
            records = read(prelabel.export_labels(self.rows, QUESTIONS)["csv"])
            records[0]["label:team"] = " BILLING "
            records[0]["label:urgent"] = "false"
            records[2]["label:severity"] = "0"
            report = prelabel.import_labels(self.rows, QUESTIONS, write(records))
        self.assertEqual(report, {"items": [{"index": 0, "labels": {"team": "billing", "urgent": False}},
                                            {"index": 2, "labels": {"severity": 0}}],
                                  "counts": {"rows": 2, "matched": 3, "labels": 3}})
        self.assertEqual(self.rows, original)
        applied = prelabel.apply(self.rows, QUESTIONS, report["items"])
        self.assertEqual(applied["rows"][1], "same")
        self.assertEqual(applied["rows"][2]["_expect"], {"team": "INVALID", "urgent": False, "severity": 0})
        self.assertEqual(applied["rows"][3:], original[3:])

    def test_filtered_export_and_partial_reordered_import(self):
        rows = [{"text": "a", "channel": "mail"}, {"text": "b", "channel": "web"},
                {"text": "c", "channel": "mail"}]
        result = prelabel.export_labels(rows, QUESTIONS, "channel", "mail")
        records = read(result["csv"])
        self.assertEqual(result["rows"], 2)
        records[1]["label:urgent"] = "yes"
        self.assertEqual(prelabel.import_labels(rows, QUESTIONS, write(records[1:]))["items"],
                         [{"index": 2, "labels": {"urgent": True}}])
        records.reverse()
        self.assertEqual(prelabel.import_labels(rows, QUESTIONS, write(records))["counts"]["matched"], 2)

    def test_changed_snapshot_including_choice_order_is_rejected(self):
        text = prelabel.export_labels(self.rows, QUESTIONS)["csv"]
        changes = []
        rows = copy.deepcopy(self.rows)
        rows[0] = "changed"
        changes.append((rows, QUESTIONS))
        rows = copy.deepcopy(self.rows)
        rows[2]["_expect"]["urgent"] = True
        changes.append((rows, QUESTIONS))
        rows = copy.deepcopy(self.rows)
        rows[3].pop("_test")
        changes.append((rows, QUESTIONS))
        questions = copy.deepcopy(QUESTIONS)
        questions["team"]["criteria"] = dict(reversed(list(questions["team"]["criteria"].items())))
        changes.append((self.rows, questions))
        questions = copy.deepcopy(QUESTIONS)
        questions["urgent"]["instructions"] = "Different question"
        changes.append((self.rows, questions))
        for rows, questions in changes:
            with self.subTest(rows=rows, questions=questions), self.assertRaises(WorkbenchError):
                prelabel.import_labels(rows, questions, text)

    def test_rejects_invalid_existing_unknown_duplicate_and_changed_inputs(self):
        records = read(prelabel.export_labels(self.rows, QUESTIONS)["csv"])
        variants = []
        for index, key, value in [(0, "label:team", "wrong"), (0, "label:urgent", "maybe"),
                                  (0, "label:severity", "2"), (2, "label:team", "billing"),
                                  (2, "label:urgent", "false"), (0, "input", '{"text":"edited"}'),
                                  (0, "row_id", "unknown"), (0, "missing", '["urgent"]')]:
            changed = copy.deepcopy(records)
            changed[index][key] = value
            variants.append(write(changed))
        variants.extend([write(records + [records[0]]), "row_id,input\nabc,x\n",
                         "row_id,input,label:team,label:urgent,label:severity\nx,y,z\n", '"unterminated'])
        for text in variants:
            with self.subTest(text=text), self.assertRaises(WorkbenchError):
                prelabel.import_labels(self.rows, QUESTIONS, text)

    def test_picture_name_and_full_schema_change_invalidate_csv(self):
        from jev import workbench
        name = next(iter(workbench.images.SAMPLES))
        rows = [{"text": "photo", "_image": name}]
        questions = dict(QUESTIONS, damage={"type": "box", "instructions": "Where?"})
        records = read(prelabel.export_labels(rows, questions)["csv"])
        self.assertEqual(json.loads(records[0]["input"])["_image"], name)
        self.assertNotIn("label:damage", records[0])
        questions["damage"]["instructions"] = "Different box"
        with self.assertRaises(WorkbenchError):
            prelabel.import_labels(rows, questions, write(records))

    def test_blank_cells_are_noop_and_bom_and_tab_input_are_supported(self):
        records = read(prelabel.export_labels(self.rows, QUESTIONS)["csv"])
        result = prelabel.import_labels(self.rows, QUESTIONS, "\ufeff" + write(records))
        self.assertEqual(result["items"], [])
        self.assertEqual(result["counts"]["labels"], 0)
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=list(records[0]), delimiter="\t")
        writer.writeheader()
        records[1]["label:severity"] = "1"
        writer.writerows(records)
        self.assertEqual(prelabel.import_labels(self.rows, QUESTIONS, out.getvalue())["items"],
                         [{"index": 1, "labels": {"severity": 1}}])

    def test_large_valid_export_round_trips_with_csv_quoting_overhead(self):
        from jev import workbench
        rows = [{"text": '"' * 40000} for _ in range(20)]
        exported = prelabel.export_labels(rows, QUESTIONS)["csv"]
        self.assertGreater(len(exported), workbench.MAX_DATASET_CHARS)
        self.assertEqual(prelabel.import_labels(rows, QUESTIONS, exported)["counts"]["matched"], 20)
        with self.assertRaises(WorkbenchError):
            prelabel.import_labels(rows, QUESTIONS, "x" * (3 * workbench.MAX_DATASET_CHARS + 1))

    def test_handlers_are_pure_and_registered(self):
        import server
        body = {"rows": self.rows, "questions": QUESTIONS}
        with patch("jev.workbench.write_dataset", side_effect=AssertionError("must not save")), \
                patch.object(server.client, "system_one", side_effect=AssertionError("must not call")):
            result = server.ROUTES[("POST", "/api/workbench/prelabel/csv/export")](body)
            out = server.ROUTES[("POST", "/api/workbench/prelabel/csv/import")](dict(body, text=result["csv"]))
            self.assertEqual(out["counts"]["matched"], 3)


if __name__ == "__main__":
    unittest.main()
