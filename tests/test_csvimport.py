"""CSV import turns a spreadsheet into Bulk rows; these tests pin the column uses, label checks, and limits."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import csvimport, workbench  # noqa: E402
from jev.workbench import MAX_BULK_ROWS, WorkbenchError  # noqa: E402

QUESTIONS = {
    "department": {"type": "choice", "instructions": "Which team?",
                   "criteria": {"billing": "Charges", "shipping": "Parcels", "other": None}},
    "wants_refund": {"type": "noul", "instructions": "Asks for a refund?"},
    "frustration": {"type": "score", "instructions": "How frustrated?", "criteria": ["Calm", "Annoyed", "Angry"]},
}


def uses(report):
    return {c["name"]: c["use"] for c in report["columns"]}


class ParseTests(unittest.TestCase):
    def test_quotes_newlines_and_a_byte_order_mark(self):
        text = '﻿text,note\r\n"Hi, there","He said ""no""\nthen left"\r\n\r\nsecond,\r\n'
        delimiter, names, rows = csvimport.parse(text)
        self.assertEqual((delimiter, names), (",", ["text", "note"]))
        self.assertEqual(rows, [["Hi, there", 'He said "no"\nthen left'], ["second", ""]])

    def test_detects_tab_and_semicolon_from_the_header(self):
        self.assertEqual(csvimport.parse("a\tb\n1\t2")[0], "\t")
        self.assertEqual(csvimport.parse("a;b\n1;2")[0], ";")
        self.assertEqual(csvimport.parse('"a,b";c\n1;2')[1], ["a,b", "c"])  # a comma inside quotes does not count
        self.assertEqual(csvimport.parse("text\nhello")[0], ",")

    def test_a_blank_first_line_does_not_hide_the_delimiter(self):
        self.assertEqual(csvimport.parse("\n  \na;b\n1;2")[1:], (["a", "b"], [["1", "2"]]))

    def test_blank_and_repeated_names_stay_addressable_and_rows_fit_the_header(self):
        _, names, rows = csvimport.parse("text, ,text\n1\n1,2,3,4")
        self.assertEqual(names, ["text", "column_2", "text_2"])
        self.assertEqual(rows, [["1", "", ""], ["1", "2", "3"]])

    def test_rejects_empty_and_oversized_input(self):
        for text in ("", " \n\n", None, 5):
            with self.assertRaises(WorkbenchError):
                csvimport.parse(text)
        with self.assertRaisesRegex(WorkbenchError, "too large"):
            csvimport.parse("x" * (workbench.MAX_DATASET_CHARS + 1))


class ConvertTests(unittest.TestCase):
    def test_label_columns_become_expect_and_other_columns_state(self):
        text = ("text,channel,department,wants_refund,frustration\n"
                "Charged twice,email,Billing,yes,2\n"
                "Where is it?,chat,shipping,no,0\n"
                "Thanks!,chat,,,\n")
        rep = csvimport.convert(text, QUESTIONS)
        self.assertEqual(uses(rep), {"text": "state", "channel": "state", "department": "label:department",
                                     "wants_refund": "label:wants_refund", "frustration": "label:frustration"})
        self.assertEqual(rep["rows"], [
            {"text": "Charged twice", "channel": "email",
             "_expect": {"department": "billing", "wants_refund": True, "frustration": 2}},
            {"text": "Where is it?", "channel": "chat",
             "_expect": {"department": "shipping", "wants_refund": False, "frustration": 0}},
            {"text": "Thanks!", "channel": "chat"},
        ])
        self.assertEqual((rep["labeled"], rep["labels"]), (2, {"department": 2, "wants_refund": 2, "frustration": 2}))
        self.assertEqual(rep["columns"][1]["samples"], ["email", "chat", "chat"])
        # The rows run as they are: Bulk strips the labels and returns them beside the answers.
        self.assertEqual(workbench.split_labels(rep["rows"][0], 1)[0], {"text": "Charged twice", "channel": "email"})

    def test_values_that_fit_no_answer_are_counted_and_left_out(self):
        text = "text,department,wants_refund,frustration\na,refunds,maybe,3\nb,refunds,Y,1.0\nc,other,0,-1\n"
        rep = csvimport.convert(text + "d,,,nan\ne,,,inf\n", QUESTIONS)
        self.assertEqual([r.get("_expect") for r in rep["rows"][:3]],
                         [None, {"wants_refund": True, "frustration": 1}, {"department": "other", "wants_refund": False}])
        self.assertEqual(rep["problems"], [
            {"column": "department", "question": "department", "value": "refunds", "rows": 2},
            {"column": "frustration", "question": "frustration", "value": "-1", "rows": 1},
            {"column": "frustration", "question": "frustration", "value": "3", "rows": 1},
            {"column": "frustration", "question": "frustration", "value": "inf", "rows": 1},
            {"column": "frustration", "question": "frustration", "value": "nan", "rows": 1},
            {"column": "wants_refund", "question": "wants_refund", "value": "maybe", "rows": 1},
        ])

    def test_choice_case_is_forgiven_only_when_one_option_matches(self):
        q = {"type": "choice", "criteria": {"Billing": None, "billing": None, "Other": None}}
        self.assertEqual(csvimport.label_value(q, " other "), (True, "Other"))
        self.assertEqual(csvimport.label_value(q, "billing"), (True, "billing"))
        self.assertEqual(csvimport.label_value(q, "BILLING"), (False, None))
        self.assertEqual(csvimport.label_value(q, "  "), (True, None))

    def test_prefixed_label_columns_win_over_answer_columns(self):
        # The Workbench's own download: `row`, answer columns named by question, and `label:` columns.
        text = ('row,department,label:department\n'
                'Charged twice,billing,billing\n'
                '"{""text"": ""Lost parcel"", ""order"": ""A-1""}",other,shipping\n')
        rep = csvimport.convert(text, QUESTIONS)
        self.assertEqual(uses(rep), {"row": "state", "department": "skip", "label:department": "label:department"})
        self.assertEqual(rep["rows"], [{"text": "Charged twice", "_expect": {"department": "billing"}},
                                       {"text": "Lost parcel", "order": "A-1", "_expect": {"department": "shipping"}}])

    def test_a_row_column_beside_other_state_is_an_ordinary_field(self):
        rep = csvimport.convert("row,text\n1,hello\n", QUESTIONS)
        self.assertEqual(rep["rows"], [{"row": "1", "text": "hello"}])

    def test_other_label_prefixes_and_unknown_questions(self):
        rep = csvimport.convert("text,expect:wants_refund,_expect.frustration,label:missing\na,true,1,x\n", QUESTIONS)
        self.assertEqual(uses(rep)["expect:wants_refund"], "label:wants_refund")
        self.assertEqual(uses(rep)["_expect.frustration"], "label:frustration")
        self.assertEqual(uses(rep)["label:missing"], "state")  # no such question: the model reads it
        self.assertEqual(rep["rows"][0]["_expect"], {"wants_refund": True, "frustration": 1})

    def test_names_match_questions_ignoring_case_and_one_column_per_question(self):
        rep = csvimport.convert("Text,Department,DEPARTMENT,Label:Wants_Refund\nhi,billing,other,no\n", QUESTIONS)
        self.assertEqual(uses(rep), {"Text": "state", "Department": "label:department", "DEPARTMENT": "skip",
                                     "Label:Wants_Refund": "label:wants_refund"})
        self.assertEqual(rep["rows"], [{"Text": "hi", "_expect": {"department": "billing", "wants_refund": False}}])
        # Case is forgiven only when it picks out one question.
        twins = {"a": {"type": "noul", "instructions": "x"}, "A": {"type": "noul", "instructions": "y"}}
        self.assertEqual(uses(csvimport.convert("text,label:a\nhi,yes\n", twins))["label:a"], "label:a")
        self.assertEqual(uses(csvimport.convert("text,label:B\nhi,yes\n", twins))["label:B"], "state")

    def test_a_repeated_label_header_is_skipped_not_read_by_the_model(self):
        rep = csvimport.convert("text,department,department\nCharged twice,billing,billing\n", QUESTIONS)
        self.assertEqual(uses(rep), {"text": "state", "department": "label:department", "department_2": "skip"})
        self.assertEqual(rep["rows"], [{"text": "Charged twice", "_expect": {"department": "billing"}}])
        self.assertEqual(uses(csvimport.convert("text,text\na,b\n"))["text_2"], "state")

    def test_a_chosen_label_for_a_question_no_longer_run_keeps_the_suggestion(self):
        rep = csvimport.convert("text,department\nhi,billing\n", QUESTIONS, {"text": "state", "department": "label:gone"})
        self.assertEqual(uses(rep)["department"], "label:department")

    def test_chosen_uses_override_the_suggestion(self):
        text = "subject,body,department\nHelp,Charged twice,billing\n"
        rep = csvimport.convert(text, QUESTIONS, {"subject": "skip", "department": "state", "gone": "skip"})
        self.assertEqual(rep["rows"], [{"body": "Charged twice", "department": "billing"}])
        with self.assertRaisesRegex(WorkbenchError, "use must be"):
            csvimport.convert(text, QUESTIONS, {"body": "label"})
        # Choosing a column as a label takes the label over from the column only suggested for it.
        took = csvimport.convert(text, QUESTIONS, {"body": "label:department"})
        self.assertEqual((uses(took)["body"], uses(took)["department"]), ("label:department", "skip"))
        with self.assertRaisesRegex(WorkbenchError, "Two columns"):
            csvimport.convert(text, QUESTIONS, {"body": "label:department", "department": "label:department"})
        # No column for the model is not an error, so the columns stay on screen to fix: every row is left out.
        none = csvimport.convert(text, QUESTIONS, {"subject": "skip", "body": "skip", "department": "skip"})
        self.assertEqual((none["rows"], none["empty"], len(none["columns"])), ([], 1, 3))
        with self.assertRaisesRegex(WorkbenchError, "columns must"):
            csvimport.convert(text, QUESTIONS, ["subject"])

    def test_without_questions_every_column_is_state(self):
        rep = csvimport.convert("text,department\nhi,billing\n")
        self.assertEqual(rep["rows"], [{"text": "hi", "department": "billing"}])
        box = {"spill": {"type": "box", "instructions": "the spill"}}
        self.assertEqual(uses(csvimport.convert("text,spill\nhi,0.2\n", box))["spill"], "state")  # Box takes no label

    def test_rows_without_state_are_left_out_and_the_rest_capped(self):
        lines = ["text,wants_refund", ",yes"] + ["row %d,no" % i for i in range(MAX_BULK_ROWS + 5)]
        rep = csvimport.convert("\n".join(lines), QUESTIONS)
        self.assertEqual((len(rep["rows"]), rep["dropped"], rep["empty"]), (MAX_BULK_ROWS, 5, 1))
        self.assertEqual(rep["labels"], {"wants_refund": MAX_BULK_ROWS})

    def test_array_rows_cannot_carry_labels(self):
        text = 'row,label:wants_refund\n"[1, 2]",\n'
        self.assertEqual(csvimport.convert(text, QUESTIONS)["rows"], [[1, 2]])
        with self.assertRaisesRegex(WorkbenchError, "JSON arrays"):
            csvimport.convert('row,label:wants_refund\n"[1, 2]",yes\n', QUESTIONS)

    def test_the_sample_rows_survive_a_round_trip(self):
        # Write the labeled sample tickets as a spreadsheet would, read them back: the same rows and labels.
        import csv
        import io
        from jev import examples
        rows = workbench.load_sample_rows()
        qids = list(examples.BULK_QUESTIONS)
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["text"] + qids)
        for r in rows:
            exp = r.get("_expect", {})
            w.writerow([r["text"]] + [json.dumps(exp[q]) if isinstance(exp.get(q), bool) else exp.get(q, "") for q in qids])
        rep = csvimport.convert(out.getvalue(), examples.BULK_QUESTIONS)
        self.assertEqual(rep["problems"], [])
        self.assertEqual(rep["rows"], [{k: v for k, v in r.items() if k != "_expect" or v} for r in rows])


if __name__ == "__main__":
    unittest.main()
