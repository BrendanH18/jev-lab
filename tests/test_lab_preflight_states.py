"""Lab pack preflight-states: advisory notes about one row's exact Bulk request state."""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev import lab, preflight  # noqa: E402
from jev.lab.packs import preflight_states  # noqa: E402

NOUL = {"type": "noul", "instructions": "Is the customer in a hurry?"}
CRITERIA = {"billing": "Charges and refunds", "shipping": "Delivery problems"}
TEAM = {"type": "choice", "instructions": "Which team handles `text`?", "criteria": CRITERIA}


def ask(text, qtype="noul"):
    return {"type": qtype, "instructions": text}


CASES = {
    "empty_object_state": {
        "hit": ({}, {"q": NOUL}), "miss": ({"text": "Harbor ticket"}, {"q": NOUL}),
        "question": None, "message": re.compile(r"^This row sends an empty object, so the model has no input to judge\.$")},
    "blank_state": {
        "hit": ({"text": "   ", "note": None}, {"q": NOUL}), "miss": ({"text": "  ", "count": 2}, {"q": NOUL}),
        "question": None, "message": re.compile(r"^Every text value on this row is blank")},
    "large_state": {
        "hit": ({"text": "x" * 20001}, {"q": NOUL}), "miss": ({"text": "x" * 19000}, {"q": NOUL}),
        "question": None, "message": re.compile(r"^This row's state is 20,013 characters as JSON, over 20,000")},
    "referenced_field_empty": {
        "hit": ({"note": "  ", "text": "Harbor ticket"}, {"complaint": ask("Is `note` a complaint?")}),
        "miss": ({"text": "Harbor ticket"}, {"complaint": ask("Is `note` a complaint?")}),
        "question": "complaint", "message": re.compile(r"^`note` is on this row but empty")},
    "placeholder_value": {
        "hit": ({"note": " N/A "}, {"complaint": ask("Is `note` a complaint?")}),
        # "none" is a real value for a discount, not a placeholder.
        "miss": ({"note": "Harbor n/a later", "discount": "none"},
                 {"complaint": ask("Is `note` a complaint?"), "big": ask("Is `discount` large?")}),
        "question": "complaint", "message": re.compile(r"^`note` holds a placeholder")},
    "ambiguous_path": {
        "hit": ({"order.total": 5, "order": {"total": 7}}, {"high": ask("Is `order.total` high?")}),
        "miss": ({"order": {"total": 7}}, {"high": ask("Is `order.total` high?")}),
        "question": "high", "message": re.compile(r"^`order\.total` names more than one place")},
    "path_case_mismatch": {
        "hit": ({"Order_ID": "A-1"}, {"known": ask("Is `order_id` known?")}),
        "miss": ({"order_id": "A-1", "Order_ID": "A-2"}, {"known": ask("Is `order_id` known?")}),
        "question": "known", "message": re.compile(r"^`order_id` is not on this row, but `Order_ID` differs only in case")},
    "photo_is_text": {
        "hit": ({"photo": "a picture of a torn bag"}, {"tear": ask("Does `photo` show a tear?")}),
        "miss": ({"photo": "photo_0123456789abcdef"}, {"tear": ask("Does `photo` show a tear?")}, ["photo_0123456789abcdef"]),
        "question": "tear", "message": re.compile(r"^`photo` on this row is an input field, not a picture")},
    "index_past_end": {
        "hit": ({"order": {"items": ["Harbor bag", "Harbor cup"]}}, {"third": ask("Is `order.items[2]` a grinder?")}),
        "miss": ({"order": {"items": ["Harbor bag", "Harbor cup", "Harbor mill"]}}, {"third": ask("Is `order.items[2]` a grinder?")}),
        "question": "third", "message": re.compile(r"^`order\.items` has 2 entries on this row, so `order\.items\[2\]` points past its end\.$")},
    "path_through_text": {
        "hit": ({"order": '{"total": 12}'}, {"high": ask("Is `order.total` over 10?")}),
        "miss": ({"order": {"total": 12}}, {"high": ask("Is `order.total` over 10?")}),
        "question": "high", "message": re.compile(r"^`order` is text on this row, so `order\.total` cannot reach inside it")},
    "photo_without_picture": {
        "hit": ({"text": "Harbor ticket"}, {"tear": ask("Does `photo` show a tear?"), "q": NOUL}),
        "miss": ({"text": "Harbor ticket", "photo": "photo_0123456789abcdef"}, {"tear": ask("Does `photo` show a tear?")},
                 ["photo_0123456789abcdef"]),
        "question": "tear", "message": re.compile(r"^`photo` points at the picture, but this row names none with _image\.$")},
    "unused_picture": {
        "hit": ({"text": "Harbor ticket", "photo": "photo_0123456789abcdef"}, {"q": NOUL}, ["photo_0123456789abcdef"]),
        "miss": ({"text": "Harbor ticket", "photo": "photo_0123456789abcdef"}, {"q": ask("Does `photo` show a tear?")},
                 ["photo_0123456789abcdef"]),
        "question": None, "message": re.compile(r"^This row sends a picture, but no question is a Box question or points at `photo`")},
    "mark_like_fields": {
        "hit": ({"text": "Harbor ticket", "_expected": {"q": True}, "_Image": "torn-bag", "_note": "x"}, {"q": NOUL}),
        "miss": ({"text": "Harbor ticket", "_note": "x"}, {"q": NOUL}),
        "question": None, "message": re.compile(r"^`_expected`, `_Image` look like a row mark but are not _expect, _test or _image")},
    "nested_marks": {
        "hit": ({"order": {"_expect": {"q": True}}, "items": [{"_test": True}]}, {"q": NOUL}),
        "miss": ({"order": {"expect": 1}}, {"q": NOUL}),
        "question": None, "message": re.compile(r"^`order\._expect`, `items\[0\]\._test` sit inside the input")},
    "labels_inside_text": {
        "hit": ({"text": '{"text": "Harbor ticket", "_expect": {"q": true}'}, {"q": NOUL}),
        "miss": ({"text": "We expect delivery soon, _expect nothing"}, {"q": NOUL}),
        "question": None, "message": re.compile(r"^`text` holds the text \"_expect\" or \"_test\"")},
    "question_id_field": {
        "hit": ({"text": "Harbor ticket", "team": "billing"}, {"team": TEAM}),
        "miss": ({"text": "Harbor ticket", "team": "billing"},
                 {"team": {"type": "choice", "instructions": "Which team does `team` name?", "criteria": CRITERIA}}),
        "question": "team", "message": re.compile(r"^This row has a field named `team`, like the question")},
    "field_holds_option_key": {
        "hit": ({"text": "Harbor ticket", "category": "billing"}, {"team": TEAM}),
        "miss": ({"text": "Harbor ticket", "category": "Billing desk"}, {"team": TEAM}),
        "question": "team", "message": re.compile(r"^`category` holds one of this question's option keys")},
    "unaddressable_field_names": {
        "hit": ({"Order ID": "A-1", "2nd": "x", "ok_name": 1}, {"q": NOUL}),
        # "order.total" is a field name a path can name: lint resolves `order.total` to it.
        "miss": ({"ok_name": 1, "order.total": 5, "photo": "photo_0123456789abcdef"}, {"q": NOUL}, ["photo_0123456789abcdef"]),
        "question": None, "message": re.compile(r'^"Order ID", "2nd" cannot be named in a backtick path')},
    "same_text_in_two_fields": {
        "hit": ({"text": "Harbor beans arrived crushed", "summary": "Harbor beans arrived crushed"}, {"q": NOUL}),
        "miss": ({"text": "Harbor beans arrived crushed", "summary": "Harbor"}, {"q": NOUL}),
        "question": None, "message": re.compile(r"^`text` and `summary` hold the same text")},
    "fields_in_text_field": {
        "hit": ({"text": "Order: A-1\nName: Pier\nNote: late"}, {"q": NOUL}),
        "miss": ({"text": "Order A-1 arrived late"}, {"q": NOUL}),
        "question": None, "message": re.compile(r'^`text` holds 3 "Key: value" lines')},
}


class PreflightStatesTests(pack_tests(preflight_states.PACK, CASES)):
    def test_notes_reach_preflight_without_findings(self):
        """Through jev.preflight, the pack's notes land under "lab" and never in the confirm-raising findings."""
        saved = lab._PACKS
        lab._PACKS = [preflight_states.PACK]  # this pack alone, whatever else jev/lab/packs holds
        try:
            report = preflight.check([{"text": "  ", "_expect": {"q": True}}, {"text": "Harbor ticket"}], {"q": NOUL})
        finally:
            lab._PACKS = saved
        self.assertEqual(report["findings"], [])
        codes = {(note["row"], note["code"]) for note in report["lab"]}
        self.assertIn((1, "preflight-states/blank_state"), codes)
        self.assertNotIn((2, "preflight-states/blank_state"), codes)


if __name__ == "__main__":
    unittest.main()
