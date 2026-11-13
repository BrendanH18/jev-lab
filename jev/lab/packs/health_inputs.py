"""Dataset health: input hygiene and schema, reported without input text.

Every check reads the rows as jev.health.analyze receives them. A row's input is the row without its labels, test
marker and picture name; text rows are inputs too (Bulk sends them as {"text": ...}). Findings carry row numbers,
field names, counts and lengths only, never an input value or a label. Identity is Review's (decisions._key).
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Dict, Iterator, List, Optional

from jev import decisions, workbench
from jev.lab import kit
from jev.workbench import WorkbenchError

COMMON_SHARE = 0.8  # a field on at least this share of object rows is expected on all of them
COMMON_MIN_ROWS = 5
RARE_SHARE = 0.1
RARE_MIN_ROWS = 10
EMPTY_MIN_ROWS = 4
LONG_TIMES = 5  # an input this many times the median length is long
LONG_MIN_CHARS = 200
LENGTH_MIN_ROWS = 5
SHORT_MAX_CHARS = 3
SCRIPT_MIN_LETTERS = 5
SCRIPT_MIN_ROWS = 5
SCRIPT_MAJORITY = 0.8
CONSTANT_MIN_ROWS = 5
HEADER_WORDS = 3  # words per header cell at most
INVISIBLE = {"​": "zero-width space", "‌": "zero-width non-joiner", "‍": "zero-width joiner",
             "⁠": "word joiner", "﻿": "byte order mark", "­": "soft hyphen"}
_LOOSE = re.compile(r"[\s_-]+")
_NUMBER_TEXT = re.compile(r"-?\d+(?:\.\d+)?")
_BOOL_TEXT = ("true", "false")
_MOJIBAKE = re.compile("�|Ã[\u0080-¿]|â€|Â[ -¿]")
_EMAIL = re.compile(r"[\w.+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)")
_RESERVED_TLDS = (".example", ".test", ".invalid", ".localhost")
_RESERVED_DOMAINS = ("example.com", "example.net", "example.org")
_CARD = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.I)
_HTML = re.compile(r"</?(?:p|br|div|span|b|i|em|strong|a|ul|ol|li|table|tr|td|th|h[1-6])(?:\s[^<>]*)?/?>"
                   r"|&(?:amp|lt|gt|quot|nbsp|#\d+|#x[0-9a-fA-F]+);", re.I)
_ESCAPES = re.compile(r"\\(?:[nrt]|u[0-9a-fA-F]{4})")
_HEADER_PART = re.compile(r"[A-Za-z_][A-Za-z0-9_ ]{0,39}")
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,39}")  # a column name with no spaces, as "text,team" has


# ---------- shared reading ----------


def _entries(rows: List[Any]) -> List[dict]:
    """Per row: number, input (marks and picture name removed), picture, held out, Review's identity."""
    out = []
    for number, row in enumerate(rows, 1):
        try:
            state, _labels = workbench.split_labels(row, number)
        except WorkbenchError:
            state = row
        clean = workbench.without_marks(state)
        picture = clean.get(workbench.IMAGE_KEY) if isinstance(clean, dict) else None
        if isinstance(clean, dict):
            clean = {k: v for k, v in clean.items() if k != workbench.IMAGE_KEY}
        out.append({"n": number, "input": clean, "picture": picture, "key": decisions._key(row),
                    "test": isinstance(state, dict) and state.get(workbench.TEST_KEY) is True})
    return out


def _objects(entries: List[dict]) -> List[dict]:
    return [entry for entry in entries if isinstance(entry["input"], dict)]


def _strings(value: Any) -> Iterator[str]:
    """Every text value inside an input, at any depth."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _rows_where(rows, test) -> List[int]:
    return [entry["n"] for entry in _entries(rows) if any(test(text) for text in _strings(entry["input"]))]


def _blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def _kind(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true/false"
    if isinstance(value, (int, float)):
        return "a number"
    if isinstance(value, str):
        return "text"
    return "a list" if isinstance(value, list) else "an object"


def _fields(objects: List[dict]) -> List[str]:
    names: List[str] = []
    for entry in objects:
        names.extend(name for name in entry["input"] if name not in names)
    return names


def _plural(count: int, word: str, many: Optional[str] = None) -> str:
    return "%d %s" % (count, word if count == 1 else (many or word + "s"))


def _one(found: List[int], message: str) -> List[dict]:
    return [{"rows": found, "message": message}] if found else []


def _loose(value: Any) -> Any:
    """An input with case and runs of spaces ignored in its text; field names, numbers and pictures kept."""
    if isinstance(value, str):
        return " ".join(value.casefold().split())
    if isinstance(value, dict):
        return {key: _loose(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_loose(item) for item in value]
    return value


def _loose_key(entry: dict) -> str:
    value = entry["input"]
    value = {"text": value} if isinstance(value, str) else value
    if isinstance(value, dict) and entry["picture"] is not None:
        value = dict(value, **{workbench.IMAGE_KEY: entry["picture"]})
    return json.dumps(_loose(value), sort_keys=True, ensure_ascii=False)


def _length(value: Any) -> int:
    return len(value) if isinstance(value, str) else len(json.dumps(value, ensure_ascii=False, sort_keys=True))


# ---------- shape ----------


def mixed_row_kinds(rows, questions):
    entries = _entries(rows)
    text = [entry["n"] for entry in entries if isinstance(entry["input"], str)]
    objects = [entry["n"] for entry in _objects(entries)]
    if not text or not objects:
        return []
    if len(text) <= len(objects):
        return _one(text, "%s among %d object rows; a text row is sent as {\"text\": ...}, so questions that "
                    "point at other fields find nothing on it." % (_plural(len(text), "text row sits", "text rows sit"),
                                                             len(objects)))
    return _one(objects, "%s among %d text rows; questions written for one shape miss the other."
                % (_plural(len(objects), "object row sits", "object rows sit"), len(text)))


def missing_common_field(rows, questions):
    objects = _objects(_entries(rows))
    if len(objects) < COMMON_MIN_ROWS:
        return []
    out = []
    for name in _fields(objects):
        lacking = [entry["n"] for entry in objects if name not in entry["input"]]
        if lacking and len(objects) - len(lacking) >= COMMON_SHARE * len(objects):
            out.append({"rows": lacking, "message": "Field `%s` is on %d of %d object rows; these rows lack it."
                        % (name, len(objects) - len(lacking), len(objects))})
    return out


def rare_field(rows, questions):
    objects = _objects(_entries(rows))
    if len(objects) < RARE_MIN_ROWS:
        return []
    out = []
    for name in _fields(objects):
        having = [entry["n"] for entry in objects if name in entry["input"]]
        if len(having) <= RARE_SHARE * len(objects):
            out.append({"rows": having, "message": "Field `%s` is on only %d of %d object rows; it may be a "
                        "misspelled field name." % (name, len(having), len(objects))})
    return out


def field_name_variants(rows, questions):
    objects = _objects(_entries(rows))
    groups: Dict[str, List[str]] = {}
    for name in _fields(objects):
        groups.setdefault(_LOOSE.sub("", name.casefold()), []).append(name)
    out = []
    for names in groups.values():
        if len(names) < 2:
            continue
        counts = {name: sum(name in entry["input"] for entry in objects) for name in names}
        keep = max(names, key=lambda name: counts[name])  # the most used spelling; the first seen on a tie
        found = [entry["n"] for entry in objects if any(name in entry["input"] for name in names if name != keep)]
        out.append({"rows": found, "message": "Fields %s differ only in case, spaces, underscores or hyphens; these "
                    "rows use a spelling other than `%s`." % (", ".join("`%s`" % name for name in names), keep)})
    return out


def field_mostly_empty(rows, questions):
    objects = _objects(_entries(rows))
    out = []
    for name in _fields(objects):
        having = [entry for entry in objects if name in entry["input"]]
        empty = [entry["n"] for entry in having if _blank(entry["input"][name])]
        if len(having) >= EMPTY_MIN_ROWS and 2 * len(empty) > len(having):
            out.append({"rows": empty, "message": "Field `%s` is empty on %d of the %d rows that have it."
                        % (name, len(empty), len(having))})
    return out


def field_type_varies(rows, questions):
    objects = _objects(_entries(rows))
    out = []
    for name in _fields(objects):
        kinds: Dict[str, List[int]] = {}
        for entry in objects:
            value = entry["input"].get(name)
            kind = _kind(value)
            if kind is not None and not _typed_text(value):
                kinds.setdefault(kind, []).append(entry["n"])
        if len(kinds) < 2:
            continue
        main = max(kinds, key=lambda kind: len(kinds[kind]))  # the first kind seen wins a tie
        found = sorted(n for kind, numbers in kinds.items() if kind != main for n in numbers)
        out.append({"rows": found, "message": "Field `%s` is %s on %s and another type on %s."
                    % (name, main, _plural(len(kinds[main]), "row"), _plural(len(found), "row"))})
    return out


def _typed_text(value: Any) -> bool:
    return isinstance(value, str) and (bool(_NUMBER_TEXT.fullmatch(value.strip())) or value.strip().casefold() in _BOOL_TEXT)


def typed_values_as_text(rows, questions):
    objects = _objects(_entries(rows))
    out = []
    for name in _fields(objects):
        values = [(entry["n"], entry["input"].get(name)) for entry in objects]
        numbers = [n for n, v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        bools = [n for n, v in values if isinstance(v, bool)]
        number_text = [n for n, v in values if isinstance(v, str) and _NUMBER_TEXT.fullmatch(v.strip())]
        bool_text = [n for n, v in values if isinstance(v, str) and v.strip().casefold() in _BOOL_TEXT]
        if numbers and number_text:
            out.append({"rows": number_text, "message": "Field `%s` holds numbers on %s and numbers written as text "
                        "on %s." % (name, _plural(len(numbers), "row"), _plural(len(number_text), "row"))})
        if bools and bool_text:
            out.append({"rows": bool_text, "message": "Field `%s` holds true/false on %s and true/false written as "
                        "text on %s." % (name, _plural(len(bools), "row"), _plural(len(bool_text), "row"))})
    return out


def constant_field(rows, questions):
    objects = _objects(_entries(rows))
    if len(objects) < CONSTANT_MIN_ROWS:
        return []
    out = []
    for name in _fields(objects):
        if not all(name in entry["input"] for entry in objects):
            continue
        values = {json.dumps(entry["input"][name], sort_keys=True) for entry in objects}
        if len(values) == 1 and not _blank(objects[0]["input"][name]):
            out.append({"rows": [entry["n"] for entry in objects], "message": "Field `%s` has the same value on all "
                        "%d object rows; it is sent on every call without telling rows apart." % (name, len(objects))})
    return out


def header_like_row(rows, questions):
    entries = _entries(rows)
    names = {"text"} | {qid.casefold() for qid in questions}
    found = []
    for index, entry in enumerate(entries):
        line = entry["input"]
        if not isinstance(line, str):
            continue
        parts = _cells(line)
        if not parts or not all(_HEADER_PART.fullmatch(part) and len(part.split()) <= HEADER_WORDS for part in parts):
            continue
        # A header is one-word cells that name a column ("text", or a question id), or is a first line of 3+ cells that the next text
        # rows repeat cell for cell, as a pasted spreadsheet does.
        named = (all(_IDENTIFIER.fullmatch(part) for part in parts)
                 and any(part.casefold() in names for part in parts))
        separator = "\t" if "\t" in line else ","
        later = [other["input"] for other in entries[index + 1:] if isinstance(other["input"], str)]
        shaped = (index == 0 and len(parts) >= 3
                  and sum(len(text.split(separator)) == len(parts) for text in later) >= 2)
        if named or shaped:
            found.append(entry["n"])
    return _one(found, "%s like a column header line, not an input; remove %s before running."
                % (_plural(len(found), "row looks", "rows look"), "it" if len(found) == 1 else "them"))


def _cells(line: str) -> List[str]:
    parts = [part.strip() for part in line.split("\t" if "\t" in line else ",")]
    return parts if len(parts) >= 2 else []


def tab_separated_text(rows, questions):
    found = [entry["n"] for entry in _entries(rows) if isinstance(entry["input"], str) and "\t" in entry["input"]]
    return _one(found, "%s tab characters, as cells copied from a spreadsheet do; Import CSV makes each column a "
                "field." % _plural(len(found), "text row holds", "text rows hold"))


def malformed_json_row(rows, questions):
    found = [entry["n"] for entry in _entries(rows)
             if isinstance(entry["input"], str) and entry["input"].strip().startswith("{")]
    return _one(found, "%s with { but %s sent as text, not as a JSON object; check the line is complete JSON."
                % (_plural(len(found), "text row starts", "text rows start"), "is" if len(found) == 1 else "are"))


def array_line_as_text(rows, questions):
    found = []
    for entry in _entries(rows):
        text = entry["input"]
        if isinstance(text, str) and text.strip().startswith("["):
            try:
                found += [entry["n"]] if isinstance(json.loads(text), list) else []
            except ValueError:
                continue
    return _one(found, "%s a JSON array on one line, which Bulk sends as text; array rows come from a JSON array "
                "of rows." % _plural(len(found), "text row is", "text rows are"))


def json_in_field(rows, questions):
    found = []
    for entry in _objects(_entries(rows)):
        for text in _strings(entry["input"]):
            if text.strip()[:1] in ("{", "["):
                try:
                    parsed = json.loads(text)
                except ValueError:
                    continue
                if isinstance(parsed, (dict, list)) and parsed:
                    found.append(entry["n"])
                    break
    return _one(found, "%s JSON written as text inside a field; questions cannot point into it with paths, so "
                "store it as an object." % _plural(len(found), "row holds", "rows hold"))


def shared_picture_names(rows, questions):
    groups: Dict[str, List[dict]] = {}
    for entry in _entries(rows):
        if isinstance(entry["picture"], str):
            groups.setdefault(entry["picture"], []).append(entry)
    out = []
    for group in groups.values():
        inputs = {json.dumps(entry["input"], sort_keys=True) for entry in group}
        if len(inputs) > 1:
            out.append({"rows": [entry["n"] for entry in group], "message": "These %d rows name the same picture with "
                        "%d different inputs; check the picture belongs to each of them." % (len(group), len(inputs))})
    return out


def picture_rows_mixed(rows, questions):
    entries = _entries(rows)
    with_picture = [entry["n"] for entry in entries if entry["picture"] is not None]
    without = [entry["n"] for entry in entries if entry["picture"] is None]
    if not with_picture or not without:
        return []
    if len(without) <= len(with_picture):
        return _one(without, "%s no picture while %d rows do; Box questions need one on every row."
                    % (_plural(len(without), "row names", "rows name"), len(with_picture)))
    return _one(with_picture, "%s a picture while %d rows do not; check the pictures went on the right rows."
                % (_plural(len(with_picture), "row names", "rows name"), len(without)))


# ---------- length and duplicates ----------


def long_inputs(rows, questions):
    entries = _entries(rows)
    if len(entries) < LENGTH_MIN_ROWS:
        return []
    lengths = sorted(_length(entry["input"]) for entry in entries)
    middle = len(lengths) // 2
    median = lengths[middle] if len(lengths) % 2 else (lengths[middle - 1] + lengths[middle]) / 2
    found = [entry["n"] for entry in entries
             if _length(entry["input"]) > max(LONG_TIMES * median, LONG_MIN_CHARS)]
    return _one(found, "%s over %d times the median input length (%d characters) and over %d characters."
                % (_plural(len(found), "row is", "rows are"), LONG_TIMES, round(median), LONG_MIN_CHARS))


def very_short_text(rows, questions):
    found = [entry["n"] for entry in _entries(rows) if isinstance(entry["input"], str)
             and 0 < len(entry["input"].strip()) <= SHORT_MAX_CHARS and any(ch.isalnum() for ch in entry["input"])]
    return _one(found, "%s %d characters or fewer, too little for a question to judge."
                % (_plural(len(found), "text row has", "text rows have"), SHORT_MAX_CHARS))


def no_letters_or_digits(rows, questions):
    found = []
    for entry in _entries(rows):
        value = entry["input"]
        texts = list(_strings(value))
        typed = _has_typed(value)
        if entry["picture"] is None and not typed and any(texts) and not any(ch.isalnum() for text in texts for ch in text):
            found.append(entry["n"])
    return _one(found, "%s only spaces or punctuation: no letters, digits or other values."
                % _plural(len(found), "row holds", "rows hold"))


def _has_typed(value: Any) -> bool:
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return True
    if isinstance(value, dict):
        return any(_has_typed(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_typed(item) for item in value)
    return False


def _near_groups(entries: List[dict]) -> List[List[dict]]:
    groups: Dict[str, List[dict]] = {}
    for entry in entries:
        groups.setdefault(_loose_key(entry), []).append(entry)
    return [group for group in groups.values() if len({entry["key"] for entry in group}) > 1]


def near_duplicate_inputs(rows, questions):
    return [{"rows": [entry["n"] for entry in group], "message": "These %d rows are the same input once case and "
             "spacing are ignored, but not exact copies, so duplicate checks miss them." % len(group)}
            for group in _near_groups(_entries(rows))]


def near_duplicates_across_split(rows, questions):
    out = []
    for group in _near_groups(_entries(rows)):
        tuning = [entry for entry in group if not entry["test"]]
        held = [entry for entry in group if entry["test"]]
        if any(a["key"] != b["key"] for a in tuning for b in held):
            out.append({"rows": [entry["n"] for entry in group], "message": "These rows match across the test split "
                        "once case and spacing are ignored (%d tuning, %d held out); a near copy in tuning flatters the "
                        "test score." % (len(tuning), len(held))})
    return out


# ---------- characters ----------


def control_characters(rows, questions):
    found = _rows_where(rows, lambda text: any(unicodedata.category(ch) == "Cc" and ch not in "\t\n\r" for ch in text))
    return _one(found, "%s control characters other than tabs and line breaks." % _plural(len(found), "row holds", "rows hold"))


def invisible_characters(rows, questions):
    found = _rows_where(rows, lambda text: any(ch in INVISIBLE for ch in text))
    return _one(found, "%s invisible characters (zero-width spaces, joiners, soft hyphens or a byte order mark) "
                "that make equal-looking inputs differ." % _plural(len(found), "row holds", "rows hold"))


def mojibake(rows, questions):
    found = _rows_where(rows, lambda text: bool(_MOJIBAKE.search(text)))
    return _one(found, "%s replacement characters or text decoded with the wrong encoding; re-export the rows as "
                "UTF-8." % _plural(len(found), "row holds", "rows hold"))


def padded_values(rows, questions):
    found = _rows_where(rows, lambda text: text.strip() != "" and text != text.strip())
    return _one(found, "%s text with leading or trailing spaces; padded copies of an input do not count as "
                "duplicates." % _plural(len(found), "row holds", "rows hold"))


def html_markup(rows, questions):
    found = _rows_where(rows, lambda text: bool(_HTML.search(text)))
    return _one(found, "%s HTML tags or entities, as text pasted from a web page does; the model reads the markup "
                "as words." % _plural(len(found), "row holds", "rows hold"))


def literal_escape_sequences(rows, questions):
    found = _rows_where(rows, lambda text: bool(_ESCAPES.search(text)))
    return _one(found, "%s backslash escapes such as \\n written out as characters, a sign the text was escaped "
                "twice." % _plural(len(found), "row holds", "rows hold"))


def different_script(rows, questions):
    scripts: Dict[int, str] = {}
    for entry in _entries(rows):
        counts: Dict[str, int] = {}
        for text in _strings(entry["input"]):
            for ch in text:
                if ch.isalpha():
                    name = unicodedata.name(ch, "")
                    script = name.split(" ")[0] if name else ""
                    counts[script] = counts.get(script, 0) + 1
        if sum(counts.values()) >= SCRIPT_MIN_LETTERS:
            scripts[entry["n"]] = max(counts, key=lambda script: counts[script])
    if len(scripts) < SCRIPT_MIN_ROWS:
        return []
    totals: Dict[str, int] = {}
    for script in scripts.values():
        totals[script] = totals.get(script, 0) + 1
    main = max(totals, key=lambda script: totals[script])
    if totals[main] < SCRIPT_MAJORITY * len(scripts):
        return []
    found = sorted(n for n, script in scripts.items() if script != main)
    return _one(found, "%s written mostly in a different script from the %d rows in %s script; check they belong "
                "in this dataset." % (_plural(len(found), "row is", "rows are"), totals[main], main.title()))


# ---------- content that should not be there ----------


def _real_email(text: str) -> bool:
    for match in _EMAIL.finditer(text):
        domain = match.group(1).lower()
        if not (domain.endswith(_RESERVED_TLDS) or any(domain == d or domain.endswith("." + d) for d in _RESERVED_DOMAINS)):
            return True
    return False


def real_looking_email(rows, questions):
    found = _rows_where(rows, _real_email)
    return _one(found, "%s an email address outside the reserved example domains; check no real customer data is "
                "in the dataset." % _plural(len(found), "row holds", "rows hold"))


def _luhn(digits: str) -> bool:
    total = 0
    for index, ch in enumerate(reversed(digits)):
        value = int(ch)
        if index % 2:
            value = value * 2 - 9 if value > 4 else value * 2
        total += value
    return total % 10 == 0


def _card(text: str) -> bool:
    for match in _CARD.finditer(text):
        digits = re.sub(r"[ -]", "", match.group(0))
        if 13 <= len(digits) <= 19 and _luhn(digits):
            return True
    return False


def card_like_numbers(rows, questions):
    found = _rows_where(rows, _card)
    return _one(found, "%s a 13 to 19 digit number that passes the payment-card checksum; remove card numbers "
                "from datasets." % _plural(len(found), "row holds", "rows hold"))


def url_only_inputs(rows, questions):
    found = []
    for entry in _entries(rows):
        value = entry["input"]
        if isinstance(value, dict) and len(value) == 1:
            value = next(iter(value.values()))
        if isinstance(value, str) and _URL.fullmatch(value.strip()):
            found.append(entry["n"])
    return _one(found, "%s only a link; the model reads the address, it does not open the page."
                % _plural(len(found), "row is", "rows are"))


def _check(ident: str, title: str, check) -> dict:
    return {"id": ident, "kind": "health_check", "title": title, "check": check}


PACK = kit.define_pack({
    "id": "health-inputs",
    "surface": "python.health",
    "title": "Input hygiene and schema",
    "about": "Dataset health findings about the inputs themselves: row shapes, field types, lengths, near copies, "
             "stray characters and content that should not be in a dataset. Row numbers and field names only.",
    "features": [
        _check("mixed_row_kinds", "Text rows mixed with object rows", mixed_row_kinds),
        _check("missing_common_field", "Rows missing a field most object rows have", missing_common_field),
        _check("rare_field", "Fields on 10% of object rows or fewer", rare_field),
        _check("field_name_variants", "Field names that differ only in case, spaces, underscores or hyphens",
               field_name_variants),
        _check("field_mostly_empty", "A field that is empty on most rows that have it", field_mostly_empty),
        _check("field_type_varies", "A field whose type differs between rows", field_type_varies),
        _check("typed_values_as_text", "Numbers or true/false written as text where other rows use the real type",
               typed_values_as_text),
        _check("constant_field", "A field with the same value on every object row", constant_field),
        _check("header_like_row", "Rows that look like a column header line", header_like_row),
        _check("tab_separated_text", "Text rows holding tab characters", tab_separated_text),
        _check("malformed_json_row", "Rows that start with { but are sent as text", malformed_json_row),
        _check("array_line_as_text", "JSON array lines sent as text", array_line_as_text),
        _check("json_in_field", "Fields holding JSON written as text", json_in_field),
        _check("shared_picture_names", "One picture named by rows with different inputs", shared_picture_names),
        _check("picture_rows_mixed", "Some rows name a picture and others do not", picture_rows_mixed),
        _check("long_inputs", "Inputs over five times the median length", long_inputs),
        _check("very_short_text", "Text rows of three characters or fewer", very_short_text),
        _check("no_letters_or_digits", "Rows holding only spaces or punctuation", no_letters_or_digits),
        _check("near_duplicate_inputs", "Inputs equal once case and spacing are ignored", near_duplicate_inputs),
        _check("near_duplicates_across_split", "Near copies that span tuning and held-out rows",
               near_duplicates_across_split),
        _check("control_characters", "Control characters in inputs", control_characters),
        _check("invisible_characters", "Zero-width characters, soft hyphens and byte order marks in inputs",
               invisible_characters),
        _check("mojibake", "Replacement characters or text decoded with the wrong encoding", mojibake),
        _check("padded_values", "Text with leading or trailing spaces", padded_values),
        _check("html_markup", "HTML tags or entities in inputs", html_markup),
        _check("literal_escape_sequences", "Backslash escapes written out as characters", literal_escape_sequences),
        _check("different_script", "Rows written in a different script from most rows", different_script),
        _check("real_looking_email", "Email addresses outside the reserved example domains", real_looking_email),
        _check("card_like_numbers", "Numbers that pass the payment-card checksum", card_like_numbers),
        _check("url_only_inputs", "Inputs that are only a link", url_only_inputs),
    ],
})
