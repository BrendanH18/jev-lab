"""Tests for the row-formats Lab pack (jev/lab/packs/row_formats.py): parsers and renderers for Bulk rows files.
Fictional Harbor Coffee Co. rows only; every expected text is written out by hand."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev.lab.packs import row_formats  # noqa: E402

BOM = "﻿"

# Text, an object with labels, a held-out row with a nested input, and a picture row whose text looks like a formula.
ROWS = [
    "Bag arrived torn",
    {"text": "Charged twice", "channel": "email", "_expect": {"department": "billing", "is_urgent": True}},
    {"text": 'Refund please, "soon"', "order": {"id": "HC-1042"}, "_expect": {"frustration": 2}, "_test": True},
    {"text": "=cmd", "channel": "chat", "_image": "torn-bag"},
]
CSV = ('text,channel,order,_image,_expect.department,_expect.is_urgent,_expect.frustration,_test\n'
       'Bag arrived torn,,,,,,,\n'
       'Charged twice,email,,,billing,true,,\n'
       '"Refund please, ""soon""",,"{""id"": ""HC-1042""}",,,,2,true\n'
       "'=cmd,chat,,torn-bag,,,,\n")

CASES = {
    "jsonl": {"parse": {"text": BOM + 'Bag torn\n\n{"text": "x", "_test": true}\r\n{not json\n',
                        "rows": ["Bag torn", {"text": "x", "_test": True}, "{not json"]},
              "render": {"rows": ["Bag torn", " padded ", "{curly}", {"text": "Charged twice", "_test": True, "_expect": {"is_urgent": False}}],
                         "text": 'Bag torn\n{"text": " padded "}\n{"text": "{curly}"}\n'
                                 '{"text": "Charged twice", "_test": true, "_expect": {"is_urgent": false}}\n'}},
    "json_array": {"parse": {"text": '["Bag torn", {"text": "x", "_image": "torn-bag"}]',
                             "rows": ["Bag torn", {"text": "x", "_image": "torn-bag"}]},
                   "render": {"rows": ["Bag torn", {"text": "Café"}], "text": '[\n "Bag torn",\n {\n  "text": "Café"\n }\n]\n'}},
    "csv": {"parse": {"text": 'text,channel,_expect.department,_test\n"Line one\nline two",chat,shipping,yes\n\n,,,\nDecaf?,,,no\n',
                      "rows": [{"text": "Line one\nline two", "channel": "chat", "_expect": {"department": "shipping"}, "_test": True},
                               "Decaf?"]},
            "render": {"rows": ROWS, "text": CSV}},
    "tsv": {"parse": {"text": "text\t_expect.frustration\nGrinder squeals\t1\n'=2+2\t\n",
                      "rows": [{"text": "Grinder squeals", "_expect": {"frustration": 1}}, "=2+2"]},
            "render": {"rows": ROWS[:2], "text": "text\tchannel\t_expect.department\t_expect.is_urgent\n"
                                                "Bag arrived torn\t\t\t\nCharged twice\temail\tbilling\ttrue\n"}},
    "semicolon": {"parse": {"text": "text;price\nOat latte;4,25\n", "rows": [{"text": "Oat latte", "price": "4,25"}]},
                  "render": {"rows": [{"text": "Café crème", "price": "3,50"}, {"text": "+44 line", "price": "2"}],
                             "text": "text;price\nCafé crème;3,50\n'+44 line;2\n"}},
    "pipe": {"parse": {"text": 'text|channel\n"Mug | chipped"|chat\n=cmd|\n',
                       "rows": [{"text": "Mug | chipped", "channel": "chat"}, "=cmd"]},
             "render": {"rows": [{"text": "Mug | chipped", "channel": "chat"}, "=cmd"],
                        "text": 'text|channel\n"Mug | chipped"|chat\n=cmd|\n'}},
    "excel": {"parse": {"text": BOM + "text,_expect.is_urgent\r\nNo beans left,true\r\n''=quoted,\r\n",
                        "rows": [{"text": "No beans left", "_expect": {"is_urgent": True}}, "'=quoted"]},
              "render": {"rows": ["=HYPERLINK(x)", {"text": "Bag torn", "_test": True}],
                         "text": BOM + "text,_test\r\n'=HYPERLINK(x),\r\nBag torn,true\r\n"}},
    "markdown": {"parse": {"text": "| text | channel |\n|:---|---:|\n| Mug \\| chipped<br>again | chat |\n| Plain | |\n",
                           "rows": [{"text": "Mug | chipped\nagain", "channel": "chat"}, "Plain"]},
                 "render": {"rows": [{"text": "Mug | chipped\nagain", "channel": "chat"}, "Plain"],
                            "text": "| text | channel |\n| --- | --- |\n| Mug \\| chipped<br>again | chat |\n| Plain |  |\n"}},
    "html": {"parse": {"text": "<table><tr><th>text</th><th>channel</th></tr><tr><td>Line one<br>line two</td><td>email</td></tr>"
                               "<tr><td>Fish &amp; chips</td><td></td></tr></table>",
                       "rows": [{"text": "Line one\nline two", "channel": "email"}, "Fish & chips"]},
             "render": {"rows": [{"text": "Beans & <grinder>", "_expect": {"department": "product"}}],
                        "text": "<table>\n<thead>\n<tr><th>text</th><th>_expect.department</th></tr>\n</thead>\n<tbody>\n"
                                "<tr><td>Beans &amp; &lt;grinder&gt;</td><td>product</td></tr>\n</tbody>\n</table>\n"}},
    "lines": {"parse": {"text": BOM + " Bag torn \n\nDecaf?\r\n", "rows": ["Bag torn", "Decaf?"]},
              "render": {"rows": ["Bag torn", {"text": "Charged\ntwice", "_expect": {"department": "billing"}}],
                         "text": "Bag torn\nCharged twice\n"}},
}

FORMATS = {feature["name"]: feature for feature in row_formats.PACK["features"]}


class RowFormatsTests(pack_tests(row_formats.PACK, CASES)):
    def test_every_format_reads_back_what_it_writes(self):
        lossless = ["jsonl", "json", "csv", "tsv", "semicolon", "pipe", "excel", "html"]
        for name in lossless:
            self.assertEqual(FORMATS[name]["parse"](FORMATS[name]["render"](ROWS)), ROWS, name)
        # Markdown trims cells; these rows have no surrounding spaces, so they come back whole.
        self.assertEqual(FORMATS["markdown"]["parse"](FORMATS["markdown"]["render"](ROWS)), ROWS)

    def test_box_labels_round_trip_through_every_format(self):
        # A Box label is an object; its cell is JSON text, which must come back as the same object, not a string.
        box = {"box": {"left": 0.1, "top": 0.25, "right": 0.5, "bottom": 0.75}, "iou_min": 0.5}
        rows = [{"text": "Where is the tear?", "_image": "torn-bag", "_expect": {"tear": box, "department": "{not json"}}]
        for name in ("jsonl", "json", "csv", "tsv", "semicolon", "pipe", "excel", "html", "markdown"):
            back = FORMATS[name]["parse"](FORMATS[name]["render"](rows))
            self.assertEqual(back, rows, name)
            self.assertIsInstance(back[0]["_expect"]["tear"], dict, name)

    def test_apostrophes_round_trip_through_spreadsheet_formats(self):
        rows = ["'=already", "''=twice", "'plain", "-5", "@mention"]
        for name in ("csv", "tsv", "semicolon", "excel"):
            self.assertEqual(FORMATS[name]["parse"](FORMATS[name]["render"](rows)), rows, name)

    def test_rows_a_format_cannot_hold_are_refused(self):
        for name in ("csv", "markdown", "html", "json", "jsonl"):
            with self.assertRaisesRegex(ValueError, "row 2 is a JSON array"):
                FORMATS[name]["render"](["ok", [1, 2]])
        with self.assertRaisesRegex(ValueError, "row 1 has no text"):
            FORMATS["lines"]["render"]([{"channel": "email"}])
        with self.assertRaisesRegex(ValueError, "separator"):
            FORMATS["markdown"]["parse"]("| text |\n| Bag torn |\n")
        with self.assertRaisesRegex(ValueError, "array of rows"):
            FORMATS["json"]["parse"]('{"text": "x"}')
        with self.assertRaisesRegex(ValueError, "item 2"):
            FORMATS["json"]["parse"]('["x", 5]')

    def test_empty_inputs(self):
        for name, feature in FORMATS.items():
            self.assertEqual(feature["parse"](""), [], name)
            self.assertEqual(feature["render"]([]), "" if name != "json" else "[]\n", name)

    def test_extensions_are_distinct(self):
        seen = [ext for feature in FORMATS.values() for ext in feature["extensions"]]
        self.assertEqual(len(seen), len(set(seen)))


if __name__ == "__main__":
    unittest.main()
