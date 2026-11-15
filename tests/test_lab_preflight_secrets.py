"""Lab pack preflight-secrets: private data and misread text in one Bulk row, named by path only."""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from jev import preflight  # noqa: E402
from jev.lab.packs import preflight_secrets  # noqa: E402

URGENT = {"urgent": {"type": "noul", "instructions": "Is `text` urgent?", "criteria": {"true": "Needs action today", "false": "Can wait"}}}

CASES = {
    "credentials_in_row": {
        "hit": ({"text": "Hi team", "note": "key sk-proj-abcdefghij0123456789xyz"}, URGENT),
        "miss": ({"text": "My sk-8 board arrived"}, URGENT),
        "question": None, "message": re.compile(r"^`note` on this row holds text shaped like an API key, access token or private key")},
    "credential_fields": {
        "hit": ({"text": "Login help", "account": {"password": "hunter22", "apiKey": "abc123"}}, URGENT),
        "miss": ({"text": "Forgot my password", "password_hint": "pet name", "token": ""}, URGENT),
        "question": None,
        "message": re.compile(r"^`account\.password`, `account\.apiKey` are fields named like a password or token and are not empty")},
    "login_in_link": {
        "hit": ({"text": "Fetch https://ops:hunter22@files.harbor.example/x"}, URGENT),
        "miss": ({"text": "Email ops@harbor.example or open https://harbor.example/x"}, URGENT),
        "question": None, "message": re.compile(r"^`text` on this row holds a link with a user name and password in it")},
    "card_numbers": {
        "hit": ({"text": "Card 4111 1111 1111 1111 was charged"}, URGENT),
        "miss": ({"text": "Order 4111 1111 1111 1112 was charged"}, URGENT),
        "question": None, "message": re.compile(r"^`text` on this row holds a number that passes the payment-card checksum")},
    "bank_account_numbers": {
        "hit": ({"text": "Refund to GB82 WEST 1234 5698 7654 32 please"}, URGENT),
        "miss": ({"text": "Refund to GB82 WEST 1234 5698 7654 33 please"}, URGENT),
        "question": None, "message": re.compile(r"^`text` on this row holds an IBAN with a valid check number")},
    "national_id_numbers": {
        "hit": ({"text": "My number is 123-45-6789"}, URGENT),
        "miss": ({"text": "Call 555-01-0000 or 900-12-3456 about order 12-345-6789"}, URGENT),
        "question": None, "message": re.compile(r"^`text` on this row holds a number shaped like a US Social Security number")},
    "mixed_script_words": {
        "hit": ({"text": "Рlease refund"}, URGENT),
        "miss": ({"text": "Привет, please refund"}, URGENT),
        "question": "urgent", "message": re.compile(r"^`text` on this row has a word mixing Latin letters with look-alike Cyrillic")},
    "direction_controls": {
        "hit": ({"text": "Refund ‮oof‬ now"}, URGENT),
        "miss": ({"text": "Refund now"}, URGENT),
        "question": None, "message": re.compile(r"^`text` on this row holds invisible text-direction controls")},
    "repeated_character_runs": {
        "hit": ({"text": "Help" + "!" * 25}, URGENT),
        "miss": ({"text": "Help!!!", "pad": "=" * 30, "gap": "Hello" + " " * 40 + "there"}, URGENT),
        "question": "urgent", "message": re.compile(r"^`text` on this row repeats one character 20 or more times in a row")},
    "huge_pointed_field": {
        "hit": ({"text": "a b " * 2100}, URGENT),
        "miss": ({"text": "short", "log": "x " * 5000}, URGENT),
        "question": "urgent", "message": re.compile(r"^`text` on this row is over 8,000 characters")},
}


class PreflightSecretsTests(pack_tests(preflight_secrets.PACK, CASES)):
    def test_notes_reach_the_preflight_report_without_values(self):
        report = preflight.check([{"text": "Card 4111 1111 1111 1111", "password": "hunter22"}], URGENT)
        lab = [item for item in report["lab"] if item["code"].startswith("preflight-secrets/")]
        self.assertEqual(sorted(item["code"] for item in lab), ["preflight-secrets/card_numbers", "preflight-secrets/credential_fields"])
        for item in lab:
            self.assertNotIn("4111", item["message"])
            self.assertNotIn("hunter22", item["message"])
        self.assertEqual({item["row"] for item in lab}, {1})


if __name__ == "__main__":
    unittest.main()
