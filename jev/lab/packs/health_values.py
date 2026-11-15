"""Dataset health: field values that a spreadsheet export, a copy-paste or real data left in the rows.

Every check reads the rows as jev.health.analyze receives them, through health_inputs' reading (a row's input without
its labels, test marker and picture name). Findings carry row numbers, field names, counts and format names only,
never an input value or a label: mixed spellings of one category, dates and currencies written several ways,
spreadsheet date serials, error codes and scientific notation, numbers far from the rest or with a stray sign, ids
shared by different inputs or across the test split, credentials, private links, long tokens and text cut at one
length.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from jev.lab import kit
from jev.lab.packs import health_inputs as inputs

CATEGORY_MAX_VALUES = 20
CATEGORY_MIN_ROWS = 4
DATE_MIN_ROWS = 3
SERIAL_LOW, SERIAL_HIGH = 20000, 80000  # spreadsheet day numbers for the years 1954 to 2119
OUTLIER_MIN_ROWS = 8
OUTLIER_FENCE = 3.0  # Tukey's "far out": beyond three interquartile ranges
SIGN_MIN_ROWS = 5
SIGN_MAX_SHARE = 0.1
CURRENCY_MIN_ROWS = 3
ID_MIN_ROWS = 4
TOKEN_MIN_CHARS = 40
CUT_MIN_CHARS = 100
CUT_MIN_ROWS = 3
PLACEHOLDERS = {"n/a", "na", "null", "nil", "none", "undefined", "nan", "-", "--", "tbd", "?", "unknown"}
SPREADSHEET_ERRORS = {"#n/a", "#value!", "#ref!", "#div/0!", "#name?", "#num!", "#null!", "#spill!", "#calc!", "#getting_data"}

_DATE_FORMATS = (
    ("YYYY-MM-DD", re.compile(r"\d{4}-\d{1,2}-\d{1,2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?")),
    ("D/M/YYYY or M/D/YYYY", re.compile(r"\d{1,2}/\d{1,2}/(?:\d{4}|\d{2})")),
    ("D.M.YYYY", re.compile(r"\d{1,2}\.\d{1,2}\.\d{4}")),
    ("YYYY/MM/DD", re.compile(r"\d{4}/\d{1,2}/\d{1,2}")),
    ("month names", re.compile(r"(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?"
                               r"(?:,?\s+\d{4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?", re.I)),
)
_DATE_NAME = re.compile(r"(?:^|[_\s-])(?i:date|day|dob|on|at|created|updated|due|birthday)$|^(?i:date|dob|created|updated|due)(?:[_\s-]|$)"
                        r"|[a-z](?:Date|On|At)$")
_ROW_ID_NAME = re.compile(r"^(?i:id|uuid|guid)$|^(?i:message|ticket|review|row|record|case|email|comment|post|note|chat|call|entry)"
                          r"(?:[_\s-](?i:id|uuid)|Id|ID)$")
_ID_NAME = re.compile(r"^(?i:id|uuid|guid)$|[_\s-](?i:id|uuid|number|no|ref)$|[a-z](?:Id|ID|Number|No|Ref)$")
_LONG_NUMBER_NAME = re.compile(r"^(?i:id|phone|tel|zip|postcode|sku|account|number|ean|upc|isbn)$"
                               r"|[_\s-](?i:id|phone|tel|zip|postcode|postal|sku|account|number|no|ref|code|ean|upc|isbn)$"
                               r"|[a-z](?:Id|ID|Number|Phone|No)$")
_SCIENTIFIC = re.compile(r"[+-]?\d(?:[.,]\d+)?[eE]\+?\d{1,3}")
_CURRENCY = re.compile(r"(?:(?P<sym>[$€£¥₹])\s?\d|\d[\d.,]*\s?(?P<after>[€£])|(?P<code>\b(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|SEK|NOK|DKK|INR|CNY|NZD|MXN)\b))")
_SYMBOL = {"$": "dollar sign", "€": "EUR", "£": "GBP", "¥": "yen sign", "₹": "INR"}
_SECRET = re.compile(
    r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|\bsk-(?:live-|proj-|ant-)?[A-Za-z0-9_-]{20,}|\b(?:sk|pk|rk)_live_[A-Za-z0-9]{16,}"
    r"|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abpors]-[A-Za-z0-9-]{10,}"
    r"|\bAIza[0-9A-Za-z_-]{35}\b|\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*")
_URL_HOST = re.compile(r"\b(?:https?|ftp)://(?:[^\s/@]+@)?([A-Za-z0-9.-]+)", re.I)
_BARE_HOST = re.compile(r"\bwww\.([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)", re.I)
_RESERVED_TLDS = (".example", ".test", ".invalid", ".localhost", ".local")
_RESERVED_HOSTS = ("example.com", "example.net", "example.org", "localhost")
_TOKEN = re.compile(r"[A-Za-z0-9+/=_-]{%d,}" % TOKEN_MIN_CHARS)
_ANY_URL = re.compile(r"\S+://\S+")
_WORDISH = re.compile(r"[A-Za-z]{%d,}" % TOKEN_MIN_CHARS)


# ---------- reading ----------


def _field_values(rows: List[Any]) -> Dict[str, List[tuple]]:
    """{field: [(row number, value, entry)]} over object rows' top-level fields, in first-seen field order."""
    out: Dict[str, List[tuple]] = {}
    for entry in inputs._objects(inputs._entries(rows)):
        for name, value in entry["input"].items():
            out.setdefault(name, []).append((entry["n"], value, entry))
    return out


def _texts(rows: List[Any]) -> Dict[str, List[tuple]]:
    """Like _field_values, with text rows as the field `text`, and only text values."""
    out: Dict[str, List[tuple]] = {}
    for entry in inputs._entries(rows):
        value = entry["input"]
        pairs = [("text", value)] if isinstance(value, str) else list(value.items()) if isinstance(value, dict) else []
        for name, item in pairs:
            if isinstance(item, str):
                out.setdefault(name, []).append((entry["n"], item, entry))
    return out


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _counted(groups: Dict[str, List[int]]) -> str:
    order = sorted(groups, key=lambda name: (-len(groups[name]), name))
    return ", ".join("%s on %s" % (name, inputs._plural(len(groups[name]), "row")) for name in order)


def _minority(groups: Dict[str, List[int]]) -> List[int]:
    """Rows outside the most common group; a tie goes to the group seen first."""
    top = max(groups, key=lambda name: (len(groups[name]), -min(groups[name])))
    return sorted(n for name, found in groups.items() if name != top for n in found)


# ---------- categories, dates, currencies ----------


def category_case_variants(rows, questions):
    out = []
    for name, found in _field_values(rows).items():
        texts = [(n, value) for n, value, _entry in found if isinstance(value, str) and value.strip()]
        loose: Dict[str, Dict[str, List[int]]] = {}
        for n, value in texts:
            loose.setdefault(" ".join(value.casefold().split()), {}).setdefault(value, []).append(n)
        if len(texts) < CATEGORY_MIN_ROWS or len(loose) > CATEGORY_MAX_VALUES or len(loose) == len(texts):
            continue
        mixed = {key: spellings for key, spellings in loose.items() if len(spellings) > 1}
        if not mixed:
            continue
        found_rows = sorted(n for spellings in mixed.values() for n in _minority(spellings))
        out.append({"rows": found_rows, "message": "Field `%s` spells %s in more than one case or spacing; slices, slice "
                    "targets and drift count each spelling as its own value." % (name, inputs._plural(len(mixed), "value"))})
    return out


def _date_format(text: str) -> Optional[str]:
    value = text.strip()
    for label, pattern in _DATE_FORMATS:
        if pattern.fullmatch(value):
            return label
    return None


def mixed_date_formats(rows, questions):
    out = []
    for name, found in _texts(rows).items():
        groups: Dict[str, List[int]] = {}
        for n, value, _entry in found:
            label = _date_format(value)
            if label:
                groups.setdefault(label, []).append(n)
        if sum(map(len, groups.values())) < DATE_MIN_ROWS or len(groups) < 2:
            continue
        out.append({"rows": _minority(groups), "message": "Field `%s` writes dates in %d formats (%s); the model reads "
                    "each as written, and day/month order may be read the wrong way." % (name, len(groups), _counted(groups))})
    return out


def _serial(value: Any) -> bool:
    number = _number(value)
    if number is None and isinstance(value, str) and re.fullmatch(r"\d{5}(?:\.\d+)?", value.strip()):
        number = float(value)
    return number is not None and SERIAL_LOW <= number <= SERIAL_HIGH


def spreadsheet_date_serials(rows, questions):
    out = []
    for name, found in _field_values(rows).items():
        if not _DATE_NAME.search(name):
            continue
        hits = [n for n, value, _entry in found if _serial(value)]
        if hits:
            out.append({"rows": hits, "message": "Field `%s` is named like a date but holds a 5-digit number on %s, as a "
                        "spreadsheet stores days; export the dates as text." % (name, inputs._plural(len(hits), "row"))})
    return out


def _currency(text: str) -> Optional[str]:
    match = _CURRENCY.search(text)
    if not match:
        return None
    if match.group("code"):
        return match.group("code")
    return _SYMBOL[match.group("sym") or match.group("after")]


def mixed_currencies(rows, questions):
    out = []
    for name, found in _texts(rows).items():
        groups: Dict[str, List[int]] = {}
        for n, value, _entry in found:
            label = _currency(value)
            if label:
                groups.setdefault(label, []).append(n)
        if sum(map(len, groups.values())) < CURRENCY_MIN_ROWS or len(groups) < 2:
            continue
        out.append({"rows": _minority(groups), "message": "Field `%s` writes amounts with %d currency marks (%s); amounts "
                    "marked differently cannot be compared as written." % (name, len(groups), _counted(groups))})
    return out


# ---------- numbers ----------


def _quartiles(values: List[float]) -> tuple:
    ordered = sorted(values)
    n = len(ordered)

    def at(q: float) -> float:  # linear interpolation between closest ranks, as a spreadsheet's QUARTILE.INC
        pos = q * (n - 1)
        low = int(pos)
        high = min(low + 1, n - 1)
        return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)
    return at(0.25), at(0.75)


def numeric_outliers(rows, questions):
    out = []
    for name, found in _field_values(rows).items():
        numbers = [(n, _number(value)) for n, value, _entry in found if _number(value) is not None]
        if len(numbers) < OUTLIER_MIN_ROWS:
            continue
        q1, q3 = _quartiles([value for _n, value in numbers])
        spread = q3 - q1
        if spread <= 0:
            continue
        low, high = q1 - OUTLIER_FENCE * spread, q3 + OUTLIER_FENCE * spread
        hits = [n for n, value in numbers if value < low or value > high]
        if hits:
            out.append({"rows": hits, "message": "Field `%s` has %s far outside the rest (beyond three interquartile "
                        "ranges); check for a unit or typing mistake." % (name, inputs._plural(len(hits), "value"))})
    return out


def stray_negative_numbers(rows, questions):
    out = []
    for name, found in _field_values(rows).items():
        # Zeros count among the field's numbers (a 0 is a real value, and leaving it out would shrink the base the
        # share is measured on); only values below zero are negative.
        numbers = [(n, _number(value)) for n, value, _entry in found if _number(value) is not None]
        negative = [n for n, value in numbers if value < 0]
        if len(numbers) < SIGN_MIN_ROWS or not negative or len(negative) > SIGN_MAX_SHARE * len(numbers):
            continue
        out.append({"rows": negative, "message": "Field `%s` is negative on %s and zero or positive on the other %d; "
                    "check the sign." % (name, inputs._plural(len(negative), "row"), len(numbers) - len(negative))})
    return out


def scientific_notation_numbers(rows, questions):
    out = []
    for name, found in _field_values(rows).items():
        if not _LONG_NUMBER_NAME.search(name):
            continue
        hits = [n for n, value, _entry in found if isinstance(value, str) and _SCIENTIFIC.fullmatch(value.strip())]
        if hits:
            out.append({"rows": hits, "message": "Field `%s` holds a number in scientific notation on %s, as a spreadsheet "
                        "writes long numbers; its last digits are lost. Format the column as text before exporting."
                        % (name, inputs._plural(len(hits), "row"))})
    return out


def spreadsheet_errors(rows, questions):
    found = inputs._rows_where(rows, lambda text: text.strip().casefold() in SPREADSHEET_ERRORS)
    return inputs._one(found, "%s a spreadsheet error value such as #N/A or #REF!; fix the formula before exporting."
                       % inputs._plural(len(found), "row holds", "rows hold"))


def placeholder_values(rows, questions):
    out = []
    for name, found in _field_values(rows).items():
        texts = [(n, value) for n, value, _entry in found if isinstance(value, str)]
        hits = [n for n, value in texts if value.strip().casefold() in PLACEHOLDERS]
        if hits and len(hits) < len(texts):
            out.append({"rows": hits, "message": "Field `%s` holds placeholder text such as n/a or null on %s and real "
                        "values elsewhere; leave the field out or empty where there is no value."
                        % (name, inputs._plural(len(hits), "row"))})
    return out


# ---------- ids ----------


def _ids(rows: List[Any], names: Any) -> Dict[str, Dict[str, List[dict]]]:
    """{id field: {value: [entries]}} for fields named as `names` matches, with text or whole-number values."""
    out: Dict[str, Dict[str, List[dict]]] = {}
    for name, found in _field_values(rows).items():
        if not names.search(name):
            continue
        for _n, value, entry in found:
            if isinstance(value, str) and value.strip() or isinstance(value, int) and not isinstance(value, bool):
                out.setdefault(name, {}).setdefault(str(value).strip(), []).append(entry)
    return out


def id_shared_by_inputs(rows, questions):
    out = []
    for name, values in _ids(rows, _ROW_ID_NAME).items():
        if sum(map(len, values.values())) < ID_MIN_ROWS:
            continue
        shared = [entries for entries in values.values() if len({entry["key"] for entry in entries}) > 1]
        if shared:
            hits = sorted(entry["n"] for entries in shared for entry in entries)
            out.append({"rows": hits, "message": "Field `%s` gives the same id to rows with different inputs (%s across "
                        "%s); one message or record has one id, so rows may have been joined wrongly."
                        % (name, inputs._plural(len(shared), "id"), inputs._plural(len(hits), "row"))})
    return out


def id_across_split(rows, questions):
    out = []
    for name, values in _ids(rows, _ID_NAME).items():
        both = [entries for entries in values.values()
                if any(entry["test"] for entry in entries) and not all(entry["test"] for entry in entries)]
        if both:
            hits = sorted(entry["n"] for entries in both for entry in entries)
            out.append({"rows": hits, "message": "Field `%s` puts %s on both tuning and held-out rows; rows about one "
                        "record on both sides let tuning see the test rows' cases." % (name, inputs._plural(len(both), "id"))})
    return out


# ---------- content that should not be there ----------


def credentials(rows, questions):
    found = inputs._rows_where(rows, lambda text: bool(_SECRET.search(text)))
    return inputs._one(found, "%s text shaped like an API key, access token or private key; remove credentials from "
                       "datasets and rotate any that are real." % inputs._plural(len(found), "row holds", "rows hold"))


def _private_host(text: str) -> bool:
    hosts = [m.group(1) for m in _URL_HOST.finditer(text)] + ["www." + m.group(1) for m in _BARE_HOST.finditer(text)]
    for host in hosts:
        host = host.lower().rstrip(".")
        if not (host.endswith(_RESERVED_TLDS) or any(host == h or host.endswith("." + h) for h in _RESERVED_HOSTS)):
            return True
    return False


def links_outside_examples(rows, questions):
    found = inputs._rows_where(rows, _private_host)
    return inputs._one(found, "%s a link to a domain outside the reserved example domains; check no real customer data "
                       "or private links are in the dataset." % inputs._plural(len(found), "row holds", "rows hold"))


def _long_token(text: str) -> bool:
    for match in _TOKEN.finditer(_ANY_URL.sub(" ", text)):
        token = match.group(0)
        if _WORDISH.fullmatch(token):  # one very long word, not an encoded value
            continue
        if any(ch.isdigit() for ch in token):
            return True
    return False


def long_tokens(rows, questions):
    found = inputs._rows_where(rows, _long_token)
    return inputs._one(found, "%s an unbroken run of %d or more letters and digits, such as a hash or encoded data; it "
                       "costs tokens and tells the model little." % (inputs._plural(len(found), "row holds", "rows hold"),
                                                                       TOKEN_MIN_CHARS))


def cut_at_one_length(rows, questions):
    out = []
    for name, found in _texts(rows).items():
        if not found:
            continue
        longest = max(len(value) for _n, value, _entry in found)
        hits = [n for n, value, _entry in found if len(value) == longest]
        if longest >= CUT_MIN_CHARS and len(hits) >= CUT_MIN_ROWS and len(hits) < len(found):
            out.append({"rows": hits, "message": "%s of `%s` are exactly %d characters, the longest in the field; they "
                        "look cut off by an export limit." % (inputs._plural(len(hits), "value"), name, longest)})
    return out


def _check(ident: str, title: str, check) -> dict:
    return {"id": ident, "kind": "health_check", "title": title, "check": check}


PACK = kit.define_pack({
    "id": "health-values",
    "surface": "python.health",
    "title": "Field values from exports and real data",
    "about": "Dataset health findings about field values: category spellings, date and currency formats, spreadsheet "
             "serials, errors and scientific notation, outlying or stray-signed numbers, placeholders, ids shared by "
             "different inputs or across the test split, credentials, private links, long tokens and text cut at one "
             "length. Row numbers, field names and counts only.",
    "features": [
        _check("category_case_variants", "One category value spelled in different case or spacing", category_case_variants),
        _check("mixed_date_formats", "Dates in one field written in different formats", mixed_date_formats),
        _check("spreadsheet_date_serials", "Date fields holding spreadsheet day numbers", spreadsheet_date_serials),
        _check("mixed_currencies", "Amounts in one field written with different currency marks", mixed_currencies),
        _check("numeric_outliers", "Numbers beyond three interquartile ranges from the rest of their field", numeric_outliers),
        _check("stray_negative_numbers", "A few negative numbers in a field that is otherwise positive", stray_negative_numbers),
        _check("scientific_notation_numbers", "Ids, phone numbers or codes a spreadsheet wrote in scientific notation",
               scientific_notation_numbers),
        _check("spreadsheet_errors", "Spreadsheet error values such as #N/A or #REF!", spreadsheet_errors),
        _check("placeholder_values", "Placeholder text such as n/a or null where other rows hold values", placeholder_values),
        _check("id_shared_by_inputs", "One message or record id on rows with different inputs", id_shared_by_inputs),
        _check("id_across_split", "One id on both tuning and held-out rows", id_across_split),
        _check("credentials", "API keys, access tokens and private keys in inputs", credentials),
        _check("links_outside_examples", "Links to domains outside the reserved example domains", links_outside_examples),
        _check("long_tokens", "Hashes and encoded data: unbroken runs of 40 or more letters and digits", long_tokens),
        _check("cut_at_one_length", "Several values cut at the same, longest length", cut_at_one_length),
    ],
})
