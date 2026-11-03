"""Label agreement (jev/agreement.py): a second person labels a sample blind, and the two label sets are compared.

No key, no network: every dataset lives in a temp directory, and nothing here calls the model.
"""

import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402
from jev import agreement, checks, csvimport, examples, workbench  # noqa: E402
from jev.workbench import WorkbenchError  # noqa: E402

QUESTIONS = examples.BULK_QUESTIONS  # department (choice), frustration (score), is_urgent and wants_refund (noul)
ROWS = [
    {"text": "Charged twice", "_expect": {"department": "billing", "is_urgent": True}},
    {"text": "Where is my parcel?", "_expect": {"department": "shipping", "is_urgent": False}},
    {"text": "Login fails", "_expect": {"department": "technical", "is_urgent": "yes"}},  # a label as text
    {"text": "Love the beans", "_expect": {"department": "none"}},
    "No labels on this one",
    {"text": "Refund the broken grinder", "channel": "email", "_expect": {"department": "billing", "frustration": 2}},
]


def io_csv(header, cells):
    out = io.StringIO()
    csvimport.csv.writer(out, lineterminator="\n").writerow(cells)
    return header + "\n" + out.getvalue()


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, True)
        self._orig = workbench.WORKBENCH_DIR
        workbench.WORKBENCH_DIR = self.dir / "workbench"
        self.addCleanup(setattr, workbench, "WORKBENCH_DIR", self._orig)

    def save(self, rows=ROWS, questions=QUESTIONS):
        workbench.save_dataset({"name": "Tickets", "rows": rows, "questions": questions})

    def second(self, labels_by_text):
        """Browser items: second labels keyed by the row's text."""
        drawn = agreement.sample("tickets", 200)["items"]
        return [{"row_id": i["row_id"], "labels": labels_by_text[i["row"]["text"]]}
                for i in drawn if i["row"]["text"] in labels_by_text]


class KappaTests(unittest.TestCase):
    def test_kappa(self):
        self.assertIsNone(agreement.kappa([]))
        self.assertAlmostEqual(agreement.kappa([("a", "a"), ("b", "b")]), 1.0)
        # Observed 0.5; each labeler says a half the time, so chance is 0.5 and kappa 0.
        self.assertAlmostEqual(agreement.kappa([("a", "a"), ("a", "b"), ("b", "a"), ("b", "b")]), 0.0)
        # A textbook table: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no. Observed 0.7, chance 0.5, kappa 0.4.
        pairs = [(True, True)] * 20 + [(True, False)] * 5 + [(False, True)] * 10 + [(False, False)] * 15
        self.assertAlmostEqual(agreement.kappa(pairs), 0.4)
        # Worse than chance is negative.
        self.assertLess(agreement.kappa([("a", "b"), ("b", "a")]), 0)
        # Both always gave one same label: chance is 1, so kappa cannot be measured.
        self.assertIsNone(agreement.kappa([("a", "a"), ("a", "a")]))
        # True and 1 are different labels, though Python counts them equal as dict keys.
        self.assertAlmostEqual(agreement.kappa([(True, True), (1, 1)]), 1.0)


class SampleTests(Temp):
    def test_sample_hides_labels_and_draws_labeled_rows(self):
        self.save()
        out = agreement.sample("tickets", 30)
        self.assertEqual(out["eligible"], 5)
        self.assertEqual([i["number"] for i in out["items"]], [1, 2, 3, 4, 6])
        for item in out["items"]:
            self.assertNotIn("_expect", item["row"])
            self.assertNotIn("_expect", json.dumps(item))
        self.assertEqual(out["items"][3]["questions"], ["department"])
        self.assertEqual(out["items"][4]["questions"], ["department", "frustration"])
        self.assertNotIn("billing", out["csv"].split("\n", 1)[1])  # no first label leaks into the download
        self.assertEqual(set(out["questions"]), {"department", "frustration", "is_urgent", "wants_refund"})

    def test_sample_is_random_but_repeatable(self):
        self.save([{"text": "row %d" % i, "_expect": {"department": "none"}} for i in range(50)])
        a = agreement.sample("tickets", 10, seed=1)["items"]
        b = agreement.sample("tickets", 10, seed=1)["items"]
        c = agreement.sample("tickets", 10, seed=2)["items"]
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertEqual(len(a), 10)
        self.assertEqual([i["number"] for i in a], sorted(i["number"] for i in a))

    def test_csv_has_a_column_per_field_and_label(self):
        self.save()
        names, *lines = agreement.sample("tickets", 30)["csv"].strip().split("\n")
        self.assertEqual(names, "row_id,text,channel,label:department,label:frustration,label:is_urgent,label:wants_refund")
        # Charged twice: labeled for department and is_urgent only, so the others are marked "-".
        self.assertTrue(lines[0].endswith(",Charged twice,,,-,,-"), lines[0])

    def test_text_rows_go_in_a_row_column(self):
        rows = [{"text": "a", "_expect": {"department": "none"}}, {"x": [1, 2], "_expect": {"department": "none"}}]
        self.save(rows)
        names = agreement.sample("tickets", 30)["csv"].split("\n")[0]
        self.assertEqual(names.split(",")[:3], ["row_id", "text", "x"])
        self.assertEqual(agreement.sample_csv([{"row_id": "r", "row": "plain", "questions": []}], {"a": {}}),
                         "row_id,row,label:a\nr,plain,-\n")

    def test_a_field_named_like_a_label_column_is_not_read_as_one(self):
        self.save([{"text": "a", "label:department": "none", "_expect": {"department": "none"}}])
        text = agreement.sample("tickets")["csv"]
        self.assertTrue(text.startswith("row_id,row,label:department,"), text)
        filled = text.splitlines()
        cells = next(iter(csvimport.csv.reader([filled[1]])))
        cells[2] = "billing"
        out = io_csv(filled[0], cells)
        self.assertEqual(agreement.compare("tickets", text=out)["questions"]["department"]["agree"], 0)

    def test_refusals(self):
        self.save()
        with self.assertRaisesRegex(WorkbenchError, "from 1 to 200"):
            agreement.sample("tickets", 0)
        with self.assertRaisesRegex(WorkbenchError, "from 1 to 200"):
            agreement.sample("tickets", True)
        with self.assertRaisesRegex(WorkbenchError, "No saved dataset"):
            agreement.sample("nope")
        workbench.save_dataset({"name": "Bare", "rows": ["a", "b"]})
        with self.assertRaisesRegex(WorkbenchError, "no Choice, Noul, or Score questions"):
            agreement.sample("bare")
        workbench.save_dataset({"name": "Unlabeled", "rows": ["a"], "questions": QUESTIONS})
        with self.assertRaisesRegex(WorkbenchError, "no labeled rows"):
            agreement.sample("unlabeled")

    def test_a_row_saved_twice_is_drawn_once(self):
        self.save([ROWS[0], ROWS[0], ROWS[1]])
        self.assertEqual(agreement.sample("tickets")["eligible"], 2)

    def test_an_unlabeled_copy_saved_first_is_not_compared(self):
        self.save([ROWS[0]["text"], ROWS[0]])
        items = self.second({"Charged twice": {"department": "billing"}})
        self.assertEqual(agreement.compare("tickets", items)["counts"]["compared"], 1)


class CompareTests(Temp):
    def test_compare_counts_agreement_per_question(self):
        self.save()
        out = agreement.compare("tickets", self.second({
            "Charged twice": {"department": "billing", "is_urgent": True},
            "Where is my parcel?": {"department": "billing", "is_urgent": False},
            "Login fails": {"department": "technical", "is_urgent": "no"},
            "Love the beans": {"department": "none", "wants_refund": False},  # not in the first labels
            "Refund the broken grinder": {"department": "billing", "frustration": 2},
        }))
        dept = out["questions"]["department"]
        self.assertEqual((dept["rows"], dept["agree"]), (5, 4))
        self.assertAlmostEqual(dept["agreement"], 0.8)
        self.assertLess(dept["low"], 0.8)
        self.assertGreater(dept["high"], 0.8)
        self.assertEqual(dept["mixups"], [{"first": "shipping", "second": "billing", "rows": 1}])
        self.assertIsNotNone(dept["kappa"])
        self.assertLess(dept["kappa"], 0.8)  # kappa discounts the agreement chance alone would give
        urgent = out["questions"]["is_urgent"]
        self.assertEqual((urgent["rows"], urgent["agree"]), (3, 2))  # "yes" in the file reads as yes
        self.assertNotIn("wants_refund", out["questions"])
        self.assertEqual(out["counts"]["only_second"], 1)
        self.assertEqual(out["counts"]["compared"], 5)
        self.assertEqual(out["overall"]["rows_agree"], 3)
        self.assertEqual((out["overall"]["labels"], out["overall"]["agree"]), (9, 7))
        self.assertEqual([(d["question"], d["first"], d["second"]) for d in out["disagreements"]],
                         [("department", "shipping", "billing"), ("is_urgent", True, False)])
        self.assertEqual(out["disagreements"][0]["number"], 2)
        self.assertNotIn("_expect", out["disagreements"][0]["row"])

    def test_rows_not_found_repeated_or_unlabeled(self):
        self.save()
        items = self.second({"Charged twice": {"department": "billing"}, "Love the beans": {}})
        items += [items[0], {"row_id": "000000000000", "labels": {"department": "none"}}]
        out = agreement.compare("tickets", items)
        self.assertEqual(out["counts"], {"rows": 4, "matched": 2, "not_found": 1, "repeated": 1, "unlabeled": 1,
                                         "compared": 1, "all_agree": 1, "only_second": 0})

    def test_invalid_second_labels_are_reported_and_skipped(self):
        self.save()
        items = self.second({"Charged twice": {"department": "sales", "is_urgent": True}})
        out = agreement.compare("tickets", items)
        self.assertEqual(out["problems_total"], 1)
        self.assertIn("'sales' is not an answer to department", out["problems"][0])
        self.assertNotIn("department", out["questions"])
        with self.assertRaisesRegex(WorkbenchError, "not one of the dataset's questions"):
            agreement.compare("tickets", [{"row_id": items[0]["row_id"], "labels": {"mood": "x"}}])
        with self.assertRaisesRegex(WorkbenchError, "needs its row_id"):
            agreement.compare("tickets", [{"labels": {}}])
        with self.assertRaisesRegex(WorkbenchError, "label the sample first"):
            agreement.compare("tickets", [])

    def test_compare_reads_the_downloaded_csv_filled_in(self):
        self.save()
        text = agreement.sample("tickets", 30)["csv"]
        lines = text.strip().split("\n")
        filled = [lines[0]]
        answers = {"Charged twice": "billing", "Where is my parcel?": "Shipping", "Login fails": "billing",
                   "Love the beans": "none", "Refund the broken grinder": "nonsense"}
        for line in lines[1:]:
            cells = next(iter(csvimport.csv.reader([line])))
            cells[3] = answers[cells[1]]
            if cells[1] == "Charged twice":
                cells[5] = "yes"
            filled.append(",".join(cells))
        out = agreement.compare("tickets", text="\n".join(filled) + "\n")
        dept = out["questions"]["department"]
        self.assertEqual((dept["rows"], dept["agree"]), (4, 3))  # "Shipping" folds to shipping; nonsense is skipped
        self.assertEqual(out["questions"]["is_urgent"]["agree"], 1)
        self.assertEqual(out["problems_total"], 1)
        self.assertIn("Line 6", out["problems"][0])
        with self.assertRaisesRegex(WorkbenchError, "no row_id column"):
            agreement.compare("tickets", text="text,label:department\na,none\n")
        with self.assertRaisesRegex(WorkbenchError, "no label columns"):
            agreement.compare("tickets", text="row_id,text\nabc,a\n")

    def test_a_changed_row_is_not_found(self):
        self.save()
        items = self.second({"Charged twice": {"department": "billing"}})
        rows = [dict(ROWS[0], text="Charged twice!")] + ROWS[1:]
        self.save(rows)
        self.assertEqual(agreement.compare("tickets", items)["counts"]["not_found"], 1)

    def test_text_rows_and_object_rows_match(self):
        self.assertEqual(agreement.row_id("hi"), agreement.row_id({"text": "hi"}))
        self.assertEqual(agreement.row_id({"text": "hi", "_expect": {"a": 1}}), agreement.row_id("hi"))
        self.assertNotEqual(agreement.row_id("hi"), agreement.row_id("hi!"))


class SettleTests(Temp):
    def test_settle_writes_labels_and_keeps_the_check(self):
        self.save()
        checks.save_check("tickets", {"gates": {"department": 0.6}, "min_accuracy": 0.8, "model": "jev-1.14.0"})
        rid = agreement.row_id(ROWS[1])
        out = agreement.settle("tickets", [{"row_id": rid, "labels": {"department": "billing", "is_urgent": None}},
                                           {"row_id": agreement.row_id(ROWS[0]), "labels": {"department": "billing"}}])
        self.assertEqual((out["changed"], out["rows"]), (2, 1))  # the second label was already billing
        saved = workbench.load_dataset("tickets")
        self.assertEqual(saved["rows"][1], {"text": "Where is my parcel?", "_expect": {"department": "billing"}})
        self.assertEqual(saved["rows"][0], ROWS[0])
        self.assertIn("check", saved)
        self.assertEqual(out["dataset"]["check"]["gates"], {"department": 0.6})

    def test_settle_every_copy_and_remove_the_last_label(self):
        self.save([ROWS[3], ROWS[3], ROWS[0]])
        out = agreement.settle("tickets", [{"row_id": agreement.row_id(ROWS[3]), "labels": {"department": None}}])
        self.assertEqual(out["rows"], 2)
        self.assertEqual(workbench.load_dataset("tickets")["rows"][:2], [{"text": "Love the beans"}] * 2)

    def test_nothing_changed_writes_nothing(self):
        self.save()
        path = workbench.datasets_dir() / "tickets.json"
        before = path.read_text()
        out = agreement.settle("tickets", [{"row_id": agreement.row_id(ROWS[0]), "labels": {"department": "billing"}}])
        self.assertEqual(out["changed"], 0)
        self.assertEqual(path.read_text(), before)

    def test_refusals(self):
        self.save()
        rid = agreement.row_id(ROWS[0])
        for items, message in [([], "at least one"), ([{"labels": {}}], "needs its row_id"),
                               ([{"row_id": "000000000000", "labels": {}}], "no longer has"),
                               ([{"row_id": rid, "labels": {"mood": "x"}}], "not one of the dataset's"),
                               ([{"row_id": rid, "labels": {"department": "sales"}}], "not an answer")]:
            with self.subTest(message), self.assertRaisesRegex(WorkbenchError, message):
                agreement.settle("tickets", items)
        self.assertEqual(workbench.load_dataset("tickets")["rows"][0], ROWS[0])


class ServerTests(Temp):
    def test_routes(self):
        self.save()
        self.assertIs(server.ROUTES[("POST", "/api/workbench/datasets/agreement/sample")], server.api_wb_agreement_sample)
        self.assertIs(server.ROUTES[("POST", "/api/workbench/datasets/agreement")], server.api_wb_agreement)
        self.assertIs(server.ROUTES[("POST", "/api/workbench/datasets/agreement/settle")], server.api_wb_agreement_settle)
        drawn = server.api_wb_agreement_sample({"id": "tickets", "rows": 2, "seed": 3})
        self.assertEqual(len(drawn["items"]), 2)
        items = [{"row_id": i["row_id"], "labels": {"department": "none"}} for i in drawn["items"]]
        out = server.api_wb_agreement({"id": "tickets", "items": items})
        self.assertEqual(out["counts"]["compared"], 2)
        out = server.api_wb_agreement({"id": "tickets", "text": drawn["csv"]})
        self.assertEqual(out["counts"]["unlabeled"], 2)
        settled = server.api_wb_agreement_settle({"id": "tickets", "items": items})
        self.assertGreaterEqual(settled["changed"], 0)


if __name__ == "__main__":
    unittest.main()
