"""Lab pack health-values: field values from exports and real data, reported without values."""

import re
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev import health  # noqa: E402
from jev.lab.packs import health_values  # noqa: E402


def T(i):
    """A distinct ticket text."""
    return "Harbor ticket number %d" % i


def long_text(i, length):
    return (("Harbor long ticket %d about beans " % i) * 10)[:length]


AMOUNTS = [10, 12, 11, 13, 12, 11, 10]

CASES = {
    "category_case_variants": {
        "hit": ([{"text": T(1), "channel": "email"}, {"text": T(2), "channel": "email"}, {"text": T(3), "channel": "Email"},
                 {"text": T(4), "channel": "chat"}, {"text": T(5), "channel": "chat "}], {}),
        "miss": ([{"text": T(1), "channel": "email"}, {"text": T(2), "channel": "email"}, {"text": T(3), "channel": "chat"},
                  {"text": T(4), "channel": "chat"}], {}),
        "rows": [3, 5], "message": re.compile(r"^Field `channel` spells 2 values in more than one case or spacing; slices")},
    "mixed_date_formats": {
        "hit": ([{"ordered": "2026-03-01"}, {"ordered": "2026-03-02"}, {"ordered": "2026-03-04"}, {"ordered": "03/05/2026"}], {}),
        "miss": ([{"ordered": "2026-03-01"}, {"ordered": "2026-03-02"}, {"ordered": "2026-03-04T10:30:00Z"}], {}),
        "rows": [4], "message": re.compile(r"^Field `ordered` writes dates in 2 formats \(YYYY-MM-DD on 3 rows, D/M/YYYY or M/D/YYYY "
                                           r"on 1 row\); ")},
    "spreadsheet_date_serials": {
        "hit": ([{"text": T(1), "order_date": 46100}, {"text": T(2), "order_date": "2026-03-01"}, {"text": T(3), "order_date": "46101"}], {}),
        "miss": ([{"text": T(1), "order_total": 46100}, {"text": T(2), "order_date": "2026-03-01"}], {}),
        "rows": [1, 3], "message": re.compile(r"^Field `order_date` is named like a date but holds a 5-digit number on 2 rows")},
    "mixed_currencies": {
        "hit": ([{"total": "$12.50"}, {"total": "$8.00"}, {"total": "€9,50"}], {}),
        "miss": ([{"total": "$12.50"}, {"total": "$8.00"}, {"total": "$9.50"}], {}),
        "rows": [3], "message": re.compile(r"^Field `total` writes amounts with 2 currency marks \(dollar sign on 2 rows, EUR on 1 row\)")},
    "numeric_outliers": {
        # Quartiles of 10 10 11 11 12 12 13 1200 are 10.75 and 12.25; the far-out fence is 12.25 + 3 * 1.5 = 16.75.
        "hit": ([{"amount": value} for value in AMOUNTS + [1200]], {}),
        "miss": ([{"amount": value} for value in AMOUNTS + [15]], {}),
        "rows": [8], "message": re.compile(r"^Field `amount` has 1 value far outside the rest")},
    "stray_negative_numbers": {
        "hit": ([{"amount": value} for value in [12, 8, 5, 20, 7, 9, 11, 14, 6, 10, -12]], {}),
        "miss": ([{"amount": value} for value in [12, -8, 5, -20, 7]], {}),
        "rows": [11], "message": re.compile(r"^Field `amount` is negative on 1 row and zero or positive on the other 10; check the sign\.$")},
    "scientific_notation_numbers": {
        "hit": ([{"phone": "4.15555E+09"}, {"phone": "415-555-0100"}], {}),
        "miss": ([{"ratio": "1.5E+3"}, {"phone": "415-555-0100"}], {}),
        "rows": [1], "message": re.compile(r"^Field `phone` holds a number in scientific notation on 1 row")},
    "spreadsheet_errors": {
        "hit": ([{"total": "#VALUE!"}, {"total": "12"}, {"note": "#DIV/0!"}], {}),
        "miss": ([{"note": "#1 fan of your beans"}], {}),
        "rows": [1, 3], "message": re.compile(r"^2 rows hold a spreadsheet error value")},
    "placeholder_values": {
        "hit": ([{"note": "n/a"}, {"note": "Loves decaf"}, {"note": "-"}], {}),
        "miss": ([{"note": "n/a"}, {"note": "N/A"}], {}),
        "rows": [1, 3], "message": re.compile(r"^Field `note` holds placeholder text such as n/a or null on 2 rows and real values")},
    "id_shared_by_inputs": {
        "hit": ([{"ticket_id": "T-1", "text": T(1)}, {"ticket_id": "T-1", "text": T(2)}, {"ticket_id": "T-2", "text": T(3)},
                 {"ticket_id": "T-3", "text": T(4)}], {}),
        "miss": ([{"ticket_id": "T-1", "text": T(1)}, {"ticket_id": "T-1", "text": T(1)}, {"ticket_id": "T-2", "text": T(3)},
                  {"order_id": "A-1", "text": T(4)}, {"order_id": "A-1", "text": T(5)}], {}),
        "rows": [1, 2], "message": re.compile(r"^Field `ticket_id` gives the same id to rows with different inputs \(1 id across 2 rows\)")},
    "id_across_split": {
        "hit": ([{"order_id": "A-1", "text": T(1)}, {"order_id": "A-1", "text": T(2), "_test": True, "_expect": {"team": "billing"}},
                 {"order_id": "A-2", "text": T(3)}], {}),
        "miss": ([{"order_id": "A-1", "text": T(1)}, {"order_id": "A-2", "text": T(2), "_test": True}], {}),
        "rows": [1, 2], "message": re.compile(r"^Field `order_id` puts 1 id on both tuning and held-out rows")},
    "credentials": {
        "hit": ([{"text": "Use key sk-proj-abcdefghij0123456789xyz to log in"}, {"text": T(2)},
                 "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmn"], {}),
        "miss": ([{"text": "My sk-8 skateboard arrived"}, "Bearer of bad news"], {}),
        "rows": [1, 3], "message": re.compile(r"^2 rows hold text shaped like an API key, access token or private key")},
    "links_outside_examples": {
        "hit": ([{"text": "See https://shop.harbor.example/order/1"}, {"text": "See https://mail.realshop.com/x"}, "visit www.realcafe.net today"], {}),
        "miss": (["See https://harbor.example/x", "http://localhost:8321/x", "www.example.com"], {}),
        "rows": [2, 3], "message": re.compile(r"^2 rows hold a link to a domain outside the reserved example domains")},
    "long_tokens": {
        "hit": ([{"text": "Receipt hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 attached"}, {"text": T(1)}], {}),
        "miss": (["Supercalifragilisticexpialidociousandmoreandmoreletters",
                  "see https://harbor.example/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"], {}),
        "rows": [1], "message": re.compile(r"^1 row holds an unbroken run of 40 or more letters and digits")},
    "cut_at_one_length": {
        "hit": ([{"text": long_text(1, 120)}, {"text": long_text(2, 120)}, {"text": long_text(3, 120)}, {"text": "Short note"}], {}),
        "miss": ([{"text": long_text(1, 120)}, {"text": long_text(2, 120)}, {"text": long_text(3, 120)}, {"text": long_text(4, 130)}], {}),
        "rows": [1, 2, 3], "message": re.compile(r"^3 values of `text` are exactly 120 characters, the longest in the field")},
}


class HealthValuesTests(pack_tests(health_values.PACK, CASES)):
    def test_long_tokens_scan_in_linear_time(self):
        # A 120,000-character run without :// took about half a minute with an unbounded URL prefix; it now takes
        # milliseconds. The bound is generous so a slow machine never fails it.
        started = time.monotonic()
        self.assertFalse(health_values._long_token("a" * 120000))
        self.assertLess(time.monotonic() - started, 2.0)

    def test_zeros_count_toward_the_sign_share(self):
        # 40 zeros, 4 positives and 1 negative: 1 of 45 numbers is negative (2%, under the 10% share), so it is stray.
        # Leaving zeros out would make it 1 of 5 (20%) and hide it.
        rows = [{"amount": 0}] * 40 + [{"amount": value} for value in (3, 4, 5, 6, -2)]
        self.assertEqual(health_values.stray_negative_numbers(rows, {}),
                         [{"rows": [45], "message": "Field `amount` is negative on 1 row and zero or positive on the other 44; "
                                                    "check the sign."}])

    def test_findings_reach_the_health_report(self):
        rows = [{"text": T(1), "channel": "email"}, {"text": T(2), "channel": "email"}, {"text": T(3), "channel": "Email"},
                {"text": T(4), "channel": "chat"}]
        codes = {item["code"] for item in health.analyze(rows, {})["lab"]}
        self.assertIn("health-values/category_case_variants", codes)

    def test_held_out_label_values_never_in_messages(self):
        rows = [{"order_id": "A-1", "text": T(1)}, {"order_id": "A-1", "text": T(2), "_test": True, "_expect": {"team": "shipping"}}]
        for item in health_values.id_across_split(rows, {}):
            self.assertNotIn("shipping", item["message"])


if __name__ == "__main__":
    unittest.main()
