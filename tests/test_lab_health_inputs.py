"""Lab pack health-inputs: input hygiene and schema findings, without input text."""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev.lab.packs import health_inputs  # noqa: E402

TEAM = {"team": {"type": "choice", "instructions": "Which team handles it?",
                 "criteria": {"billing": "Charges and refunds", "shipping": "Delivery problems"}}}


def T(i):
    """A distinct ticket text."""
    return "Harbor ticket number %d" % i


CASES = {
    "mixed_row_kinds": {
        "hit": (["Harbor note one", {"text": "Harbor note two"}, {"text": "Harbor note three"}], {}),
        "miss": ([{"text": "Harbor note two"}, {"text": "Harbor note three"}], {}),
        "rows": [1], "message": re.compile(r"^1 text row sits among 2 object rows; .* point at other fields find nothing on it\.$")},
    "missing_common_field": {
        "hit": ([{"text": T(i), "channel": "email"} for i in range(1, 5)] + [{"text": T(5)}], {}),
        "miss": ([{"text": T(i), "channel": "email"} for i in range(1, 4)] + [{"text": T(4)}, {"text": T(5)}], {}),
        "rows": [5], "message": re.compile(r"^Field `channel` is on 4 of 5 object rows; these rows lack it\.$")},
    "rare_field": {
        "hit": ([{"text": T(i)} for i in range(1, 10)] + [{"text": T(10), "chanel": "web"}], {}),
        "miss": ([{"text": T(i)} for i in range(1, 9)] + [{"text": T(i), "channel": "web"} for i in (9, 10)], {}),
        "rows": [10], "message": re.compile(r"^Field `chanel` is on only 1 of 10 object rows")},
    "field_name_variants": {
        "hit": ([{"order_id": "A-1"}, {"order_id": "A-2"}, {"Order ID": "A-3"}, {"orderId": "A-4"}], {}),
        "miss": ([{"order_id": "A-1"}, {"order_ids": "A-2"}], {}),
        "rows": [3, 4], "message": re.compile(r"^Fields `order_id`, `Order ID`, `orderId` differ only .* other than `order_id`\.$")},
    "field_mostly_empty": {
        "hit": ([{"text": T(1), "note": ""}, {"text": T(2), "note": None}, {"text": T(3), "note": "  "},
                 {"text": T(4), "note": "Harbor regular"}], {}),
        "miss": ([{"text": T(1), "note": ""}, {"text": T(2), "note": None}, {"text": T(3), "note": "Harbor one"},
                  {"text": T(4), "note": "Harbor two"}], {}),
        "rows": [1, 2, 3], "message": re.compile(r"^Field `note` is empty on 3 of the 4 rows that have it\.$")},
    "field_type_varies": {
        "hit": ([{"items": ["Harbor bag"]}, {"items": ["Harbor cup"]}, {"items": []}, {"items": "Harbor two bags"}], {}),
        "miss": ([{"amount": 12}, {"amount": "12.50"}, {"amount": None}], {}),
        "rows": [4], "message": re.compile(r"^Field `items` is a list on 3 rows and another type on 1 row\.$")},
    "typed_values_as_text": {
        "hit": ([{"amount": 12, "rush": True}, {"amount": 8.5, "rush": False}, {"amount": "12.50", "rush": False},
                 {"amount": 3, "rush": "TRUE"}], {}),
        "miss": ([{"amount": 12, "rush": True}, {"amount": 8.5, "rush": False}, {"code": "2210"}], {}),
        "rows": [3, 4], "message": re.compile(r"^Field `(amount|rush)` holds (numbers|true/false) on 3 rows and (numbers|true/false) written as text on 1 row\.$")},
    "constant_field": {
        "hit": ([{"text": T(i), "store": "Harbor Pier"} for i in range(1, 6)], {}),
        "miss": ([{"text": T(i), "store": "Harbor Pier" if i < 5 else "Harbor Dock", "note": ""} for i in range(1, 6)], {}),
        "rows": [1, 2, 3, 4, 5], "message": re.compile(r"^Field `store` has the same value on all 5 object rows")},
    "header_like_row": {
        "hit": (["Order ID,Customer,Total", "A-1,Harbor Pier,12", "A-2,Harbor Dock,9", "text,team"], TEAM),
        # "Team, call me" names the question id but is a sentence, not one-word column names.
        "miss": (["Hi, my order, please help", "Harbor beans, late", "Harbor cups, broken", "Team, call me"], TEAM),
        "rows": [1, 4], "message": re.compile(r"^2 rows look like a column header line")},
    "tab_separated_text": {
        "hit": (["Harbor\tbeans\tlate", "Harbor plain"], {}),
        "miss": (["Harbor plain", {"text": "Harbor\tobject"}], {}),
        "rows": [1], "message": re.compile(r"^1 text row holds tab characters")},
    "malformed_json_row": {
        "hit": (['{"text": "Harbor broken', "Harbor fine"], {}),
        "miss": ([{"text": "Harbor object"}, "Harbor {braces} inside"], {}),
        "rows": [1], "message": re.compile(r"^1 text row starts with \{ but is sent as text")},
    "array_line_as_text": {
        "hit": (['["Harbor one", "Harbor two"]', "[not json at all"], {}),
        "miss": (["[not json at all", "Harbor fine"], {}),
        "rows": [1], "message": re.compile(r"^1 text row is a JSON array on one line")},
    "json_in_field": {
        "hit": ([{"details": '{"amount": 12}'}, {"details": "{}"}, {"details": "{not json"}, {"items": ['["Harbor", "cup"]']}], {}),
        "miss": ([{"details": "{}"}, {"details": "Harbor plain"}], {}),
        "rows": [1, 4], "message": re.compile(r"^2 rows hold JSON written as text inside a field")},
    "shared_picture_names": {
        "hit": ([{"text": "Harbor torn bag", "_image": "torn-bag"}, {"text": "Harbor torn bag", "_image": "torn-bag"},
                 {"text": "Harbor crushed box", "_image": "torn-bag"}, {"text": "Harbor box", "_image": "crushed-box"}], {}),
        "miss": ([{"text": "Harbor torn bag", "_image": "torn-bag"}, {"text": "Harbor torn bag", "_image": "torn-bag", "_test": True}], {}),
        "rows": [1, 2, 3], "message": re.compile(r"^These 3 rows name the same picture with 2 different inputs")},
    "picture_rows_mixed": {
        "hit": ([{"text": T(i), "_image": "torn-bag"} for i in range(1, 4)] + [{"text": T(4)}], {}),
        "miss": ([{"text": T(i), "_image": "torn-bag"} for i in range(1, 4)], {}),
        "rows": [4], "message": re.compile(r"^1 row names no picture while 3 rows do")},
    "long_inputs": {
        "hit": ([T(i) for i in range(1, 5)] + ["Harbor " * 43], {}),
        "miss": ([T(i) for i in range(1, 5)] + ["Harbor " * 21], {}),
        "rows": [5], "message": re.compile(r"^1 row is over 5 times the median input length \(22 characters\) and over 200 characters\.$")},
    "very_short_text": {
        "hit": (["ok", "Harbor fine words", "??", "abcd"], {}),
        "miss": (["abcd", "??"], {}),
        "rows": [1], "message": re.compile(r"^1 text row has 3 characters or fewer")},
    "no_letters_or_digits": {
        "hit": (["??", {"text": "  ", "note": "--"}, {"text": "--", "count": 3}, {"text": "!!", "_image": "torn-bag"}, "Harbor fine"], {}),
        "miss": ([{"text": ""}, "Harbor 1"], {}),
        "rows": [1, 2], "message": re.compile(r"^2 rows hold only spaces or punctuation")},
    "near_duplicate_inputs": {
        "hit": (["Harbor  Beans late", "harbor beans late", {"text": "HARBOR BEANS LATE"}, "Harbor beans late", "Other Harbor"], {}),
        "miss": (["Harbor same", "Harbor same", {"text": "Harbor same"}], {}),
        "rows": [1, 2, 3, 4], "message": re.compile(r"^These 4 rows are the same input once case and spacing are ignored")},
    "near_duplicates_across_split": {
        "hit": ([{"text": "Harbor beans late"}, {"text": "harbor beans late", "_test": True}, {"text": "Harbor other"}], {}),
        "miss": ([{"text": "Harbor same"}, {"text": "Harbor same", "_test": True}, {"text": "harbor other"}, {"text": "Harbor Other"}], {}),
        "rows": [1, 2], "message": re.compile(r"\(1 tuning, 1 held out\)")},
    "control_characters": {
        "hit": (["Harbor\x07bell", "Harbor\ttab", {"note": "Harbor\x00null"}], {}),
        "miss": (["Harbor\ttab\nline\r"], {}),
        "rows": [1, 3], "message": re.compile(r"^2 rows hold control characters")},
    "invisible_characters": {
        "hit": (["Harbor\u200bbeans", "\ufeffHarbor", "Harbor plain"], {}),
        "miss": (["Harbor plain", "Harbor\u200emark"], {}),
        "rows": [1, 2], "message": re.compile(r"^2 rows hold invisible characters")},
    "mojibake": {
        "hit": (["Harbor caf\u00c3\u00a9", "Harbor don\u00e2\u20ac\u2122t", "Harbor \ufffd", "Harbor caf\u00e9"], {}),
        "miss": (["Harbor caf\u00e9", "S\u00c3O PAULO"], {}),
        "rows": [1, 2, 3], "message": re.compile(r"^3 rows hold replacement characters")},
    "padded_values": {
        "hit": ([{"text": " Harbor lead"}, {"text": "Harbor trail "}, {"text": "   "}, "Harbor fine"], {}),
        "miss": ([{"text": "Harbor fine"}, {"text": "   "}], {}),
        "rows": [1, 2], "message": re.compile(r"^2 rows hold text with leading or trailing spaces")},
    "html_markup": {
        "hit": (["Harbor <p>late</p>", "Harbor &amp; Co", "Harbor 3 < 5 > 2"], {}),
        "miss": (["Harbor 3 < 5 > 2", "Harbor & Co"], {}),
        "rows": [1, 2], "message": re.compile(r"^2 rows hold HTML tags or entities")},
    "literal_escape_sequences": {
        "hit": (["Harbor line\\nnext", "Harbor caf\\u00e9", "Harbor plain"], {}),
        "miss": (["Harbor path C:\\Users", "Harbor plain"], {}),
        "rows": [1, 2], "message": re.compile(r"^2 rows hold backslash escapes")},
    "different_script": {
        "hit": ([T(i) for i in range(1, 6)] + ["\u041f\u0440\u0438\u0432\u0435\u0442 \u043a\u043e\u0444\u0435"], {}),
        "miss": ([T(i) for i in range(1, 6)] + ["Harbor"], {}),
        "rows": [6], "message": re.compile(r"^1 row is written mostly in a different script from the 5 rows in Latin script")},
    "real_looking_email": {
        "hit": (["Write to ana@harbor.local", "Write to accounts@northside.example", {"contact": "ops@example.com"},
                 "Write to ops@mail.example.org"], {}),
        "miss": (["Write to accounts@northside.example", {"contact": "ops@example.com"}], {}),
        "rows": [1], "message": re.compile(r"^1 row holds an email address outside the reserved example domains")},
    "card_like_numbers": {
        "hit": (["Card 4111 1111 1111 1111 on file", {"note": "4111-1111-1111-1111"}, "Card 4111 1111 1111 1112"], {}),
        "miss": (["Card 4111 1111 1111 1112", "Order 2210 and 555 0100"], {}),
        "rows": [1, 2], "message": re.compile(r"^2 rows hold a 13 to 19 digit number that passes the payment-card checksum")},
    "url_only_inputs": {
        "hit": (["https://harbor.example/orders/22", {"link": "www.harbor.example"}, "See https://harbor.example please",
                 {"link": "https://harbor.example", "text": "Harbor note"}], {}),
        "miss": (["See https://harbor.example please", {"link": "https://harbor.example", "text": "Harbor note"}], {}),
        "rows": [1, 2], "message": re.compile(r"^2 rows are only a link")},
}


class HealthInputsTests(pack_tests(health_inputs.PACK, CASES)):
    pass


if __name__ == "__main__":
    unittest.main()
