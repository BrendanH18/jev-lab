"""Bulk preflight: what a row would send to the model that it should not, or that the model would misread.

Each check receives one row's exact request state (see preflight_states). The first group looks at every text in the
row for things that should not leave the machine: credentials, card, bank and national id numbers. The second looks
at the text the questions point at for things the model misreads: words mixing look-alike alphabets, hidden
direction controls, long runs of one character, and a single field so long that every question pays for it. Notes
name question ids and paths only, never a value from the state. They are advisory and never ask for a confirm.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

from jev.lab import kit
from jev.lab.packs import health_inputs, health_values, preflight_requests as requests, preflight_states as states

CREDENTIAL_NAMES = {
    "password",
    "passwd",
    "pwd",
    "pass",
    "passcode",
    "pin",
    "secret",
    "client_secret",
    "api_key",
    "apikey",
    "api_token",
    "access_token",
    "auth_token",
    "refresh_token",
    "token",
    "private_key",
    "session_id",
    "authorization",
    "cookie",
}
RUN_MIN = 20
HUGE_FIELD_CHARS = 8_000
SHOWN_PATHS = 3
_LOOSE_NAME = re.compile(r"[\s-]+")
_LINK_LOGIN = re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@", re.I)
_IBAN = re.compile(r"\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?)\b")
_IBAN_LENGTHS = {
    "AD": 24,
    "AT": 20,
    "BE": 16,
    "CH": 21,
    "CY": 28,
    "CZ": 24,
    "DE": 22,
    "DK": 18,
    "EE": 20,
    "ES": 24,
    "FI": 18,
    "FR": 27,
    "GB": 22,
    "GR": 27,
    "HR": 21,
    "HU": 28,
    "IE": 22,
    "IS": 26,
    "IT": 27,
    "LI": 21,
    "LT": 20,
    "LU": 20,
    "LV": 21,
    "MC": 27,
    "MT": 31,
    "NL": 18,
    "NO": 15,
    "PL": 28,
    "PT": 25,
    "RO": 24,
    "SE": 24,
    "SI": 19,
    "SK": 24,
}
_SSN = re.compile(r"(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])")
_RUN = re.compile(r"(.)\1{%d,}" % (RUN_MIN - 1), re.S)
_WORD = re.compile(r"[^\W\d_]{2,}")
_BIDI = {"‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩", "‎", "‏", "؜"}


# ---------- reading ----------


def _texts(state: Any, refs: set) -> List[Tuple[str, str]]:
    """(path, text) for every text in the state, picture references left out."""
    return [(path, text) for path, text in states._strings(state) if text not in refs]


def _paths_with(state: Any, refs: set, test) -> List[str]:
    return list(dict.fromkeys(path for path, text in _texts(state, refs) if test(text)))


def _where(paths: List[str]) -> str:
    shown = [requests._place(path) for path in paths[:SHOWN_PATHS]]
    more = len(paths) - len(shown)
    return ", ".join(shown) + (" and %d more" % more if more else "")


def _verb(paths: List[str]) -> str:
    return "holds" if len(paths) == 1 else "hold"


# ---------- what should not leave the machine ----------


def credentials_in_row(state, questions, refs):
    paths = _paths_with(state, refs, lambda text: bool(health_values._SECRET.search(text)))
    if not paths:
        return []
    return [
        (
            None,
            "%s on this row %s text shaped like an API key, access token or private key; the run would send it "
            "to the model. Remove it from the row." % (_where(paths), _verb(paths)),
        )
    ]


def _credential_name(name: str) -> bool:
    return _LOOSE_NAME.sub("_", re.sub(r"(?<=[a-z])(?=[A-Z])", "_", name)).lower() in CREDENTIAL_NAMES


def credential_fields(state, questions, refs):
    found: List[str] = []

    def walk(value: Any, route: str) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                path = "%s.%s" % (route, key) if route else str(key)
                if (
                    isinstance(key, str)
                    and _credential_name(key)
                    and not health_inputs._blank(item)
                    and not isinstance(item, (dict, list))
                ):
                    found.append(path)
                walk(item, path)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, "%s[%d]" % (route, index))

    walk(state, "")
    if not found:
        return []
    return [
        (
            None,
            "%s %s named like a password or token and %s not empty; leave credentials out of the request."
            % (_where(found), "is a field" if len(found) == 1 else "are fields", "is" if len(found) == 1 else "are"),
        )
    ]


def login_in_link(state, questions, refs):
    paths = _paths_with(state, refs, lambda text: bool(_LINK_LOGIN.search(text)))
    if not paths:
        return []
    return [
        (
            None,
            "%s on this row %s a link with a user name and password in it; the run would send both to the "
            "model." % (_where(paths), _verb(paths)),
        )
    ]


def card_numbers(state, questions, refs):
    paths = _paths_with(state, refs, health_inputs._card)
    if not paths:
        return []
    return [
        (
            None,
            "%s on this row %s a number that passes the payment-card checksum; mask card numbers before a run."
            % (_where(paths), _verb(paths)),
        )
    ]


def _iban_valid(text: str) -> bool:
    compact = text.replace(" ", "")
    if _IBAN_LENGTHS.get(compact[:2]) != len(compact):
        return False
    moved = compact[4:] + compact[:4]
    digits = "".join(str(int(ch, 36)) for ch in moved)
    return int(digits) % 97 == 1


def bank_account_numbers(state, questions, refs):
    paths = _paths_with(state, refs, lambda text: any(_iban_valid(m.group(1)) for m in _IBAN.finditer(text)))
    if not paths:
        return []
    return [
        (
            None,
            "%s on this row %s an IBAN with a valid check number; mask bank account numbers before a run."
            % (_where(paths), _verb(paths)),
        )
    ]


def _ssn(text: str) -> bool:
    for match in _SSN.finditer(text):
        area, group, serial = match.groups()
        if area not in ("000", "666") and not area.startswith("9") and group != "00" and serial != "0000":
            return True
    return False


def national_id_numbers(state, questions, refs):
    paths = _paths_with(state, refs, _ssn)
    if not paths:
        return []
    return [
        (
            None,
            "%s on this row %s a number shaped like a US Social Security number (123-45-6789); mask it before "
            "a run." % (_where(paths), _verb(paths)),
        )
    ]


# ---------- what the model misreads ----------


def _script(ch: str) -> Optional[str]:
    try:
        name = unicodedata.name(ch)
    except ValueError:
        return None
    for script in ("LATIN", "CYRILLIC", "GREEK"):
        if name.startswith(script):
            return script
    return None


def _mixed_word(text: str) -> bool:
    for match in _WORD.finditer(text):
        scripts = {_script(ch) for ch in match.group(0)} - {None}
        if "LATIN" in scripts and len(scripts) > 1:
            return True
    return False


def mixed_script_words(state, questions, refs):
    found = ((qid, path) for qid, path, text in requests._read(state, questions, refs) if _mixed_word(text))
    return [
        (
            qid,
            "%s on this row has a word mixing Latin letters with look-alike Cyrillic or Greek ones; the model may "
            "read it as another word, and exact matches in code miss it." % requests._place(path),
        )
        for qid, path in requests._first_per_question(found)
    ]


def direction_controls(state, questions, refs):
    paths = _paths_with(state, refs, lambda text: any(ch in _BIDI for ch in text))
    if not paths:
        return []
    return [
        (
            None,
            "%s on this row %s invisible text-direction controls, which can make text read differently from how "
            "it shows on screen." % (_where(paths), _verb(paths)),
        )
    ]


def repeated_character_runs(state, questions, refs):
    found = (
        (qid, path)
        for qid, path, text in requests._read(state, questions, refs)
        if any(not m.group(1).isspace() for m in _RUN.finditer(text))
    )
    return [
        (
            qid,
            "%s on this row repeats one character %d or more times in a row; the run pays for padding that tells "
            "the model nothing." % (requests._place(path), RUN_MIN),
        )
        for qid, path in requests._first_per_question(found)
    ]


def huge_pointed_field(state, questions, refs):
    lengths: Dict[Tuple[Optional[str], str], int] = {}
    for qid, path, text in requests._read(state, questions, refs):
        lengths[(qid, path)] = max(lengths.get((qid, path), 0), len(text))
    found = ((qid, path) for (qid, path), size in lengths.items() if size > HUGE_FIELD_CHARS)
    return [
        (
            qid,
            "%s on this row is over %s characters; the question pays to read all of it on every run. Point it at "
            "a shorter field or trim the text." % (requests._place(path), format(HUGE_FIELD_CHARS, ",")),
        )
        for qid, path in requests._first_per_question(found)
    ]


def _check(ident: str, title: str, check) -> dict:
    return {"id": ident, "kind": "preflight_check", "title": title, "check": check}


PACK = kit.define_pack(
    {
        "id": "preflight-secrets",
        "surface": "python.health",
        "title": "Bulk preflight: private data and misread text",
        "about": "Advisory notes about one Bulk row before a paid run: credentials, card, bank and national id numbers "
        "anywhere in the row, and in the text questions point at, words mixing look-alike alphabets, hidden "
        "direction controls, long runs of one character and very long fields. Paths and question ids only.",
        "features": [
            _check("credentials_in_row", "API keys, access tokens and private keys in the row", credentials_in_row),
            _check("credential_fields", "Fields named like a password or token that are not empty", credential_fields),
            _check("login_in_link", "Links with a user name and password in them", login_in_link),
            _check("card_numbers", "Numbers that pass the payment-card checksum", card_numbers),
            _check("bank_account_numbers", "IBAN bank account numbers with a valid check number", bank_account_numbers),
            _check("national_id_numbers", "Numbers shaped like a US Social Security number", national_id_numbers),
            _check(
                "mixed_script_words",
                "Words that mix Latin letters with look-alike Cyrillic or Greek ones",
                mixed_script_words,
            ),
            _check("direction_controls", "Invisible text-direction controls in the row", direction_controls),
            _check(
                "repeated_character_runs",
                "One character repeated 20 or more times in text a question reads",
                repeated_character_runs,
            ),
            _check("huge_pointed_field", "Text a question reads that is over 8,000 characters", huge_pointed_field),
        ],
    }
)
