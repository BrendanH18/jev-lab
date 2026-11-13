"""Bulk preflight: advisory notes about one row's exact request state before a paid Bulk run.

Each check receives the state Bulk would send for one row (workbench.job_state: a text row under "text", the
picture named under "photo" by its asset reference), the validated questions and the row's picture references.
Notes name question ids, backticked paths and field names only, never a value from the state. They are advisory:
jev.preflight reports them apart from its own findings, so they never ask for a confirm before a run.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterator, List, Tuple

from jev import lint, workbench
from jev.lab import kit

LARGE_STATE_CHARS = 20_000  # well under workbench.MAX_STATE_CHARS, but every call pays for it
SAME_TEXT_MIN_CHARS = 20
PLACEHOLDERS = {"n/a", "na", "null", "nil", "undefined", "nan", "-", "--", "tbd", "?", "...", "…"}
MARK_WORDS = {"expect", "expected", "expects", "expectation", "expectations", "label", "labels", "test", "tests",
              "image", "images", "img", "picture", "holdout", "held_out", "heldout"}
MARKS = (workbench.LABEL_KEY, workbench.TEST_KEY, workbench.IMAGE_KEY)
_LOOSE = re.compile(r"[\s_-]+")
_FIRST = re.compile(r"[^.\[]+")


# ---------- reading the state ----------


def _lookup(value: Any, path: str, route: str = "") -> List[Tuple[str, Any]]:
    """Every (route, value) a backtick path can name in `value`, by lint._resolve's rules: a field name may hold dots,
    so one path can name more than one place."""
    if path == "":
        return [(route, value)]
    found: List[Tuple[str, Any]] = []
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str) or not path.startswith(key):
                continue
            rest = path[len(key):]
            if rest == "" or rest[0] in ".[":
                found += _lookup(value[key], rest[1:] if rest.startswith(".") else rest, route + "/" + json.dumps(key))
    elif isinstance(value, list):
        step = re.match(r"\[(\d+)\]|(\d+)(?=$|[.\[])", path)
        if step:
            index = int(step.group(1) or step.group(2))
            rest = path[step.end():]
            if index < len(value):
                found += _lookup(value[index], rest[1:] if rest.startswith(".") else rest, route + "/%d" % index)
    return found


def _paths(questions: Dict[str, dict], refs: set) -> Iterator[Tuple[str, str]]:
    """(question id, path) for every backtick path a question names, picture references left out."""
    for qid, question in questions.items():
        for path in lint._paths(question):
            if path not in refs:
                yield qid, path


def _blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def _strings(value: Any, route: str = "") -> Iterator[Tuple[str, str]]:
    """(path, text) for every text value in the state, paths written as questions write them."""
    if isinstance(value, str):
        yield route, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _strings(item, "%s.%s" % (route, key) if route else str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _strings(item, "%s[%d]" % (route, index))


def _has_typed(value: Any) -> bool:
    if isinstance(value, (bool, int, float)):
        return True
    if isinstance(value, dict):
        return any(_has_typed(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_typed(item) for item in value)
    return False


def _names(names: List[str]) -> str:
    return ", ".join("`%s`" % name for name in names)


def _top_fields(state: Any, refs: set) -> List[str]:
    if not isinstance(state, dict):
        return []
    return [key for key, value in state.items() if not (key == workbench.PHOTO_FIELD and value in refs)]


def _loose(name: str) -> str:
    return _LOOSE.sub("", name.casefold())


# ---------- empty and oversized rows ----------


def empty_object_state(state, questions, refs):
    if state == {} or state == []:
        kind = "object" if isinstance(state, dict) else "array"
        return [(None, "This row sends an empty %s, so the model has no input to judge." % kind)]
    return []


def blank_state(state, questions, refs):
    texts = [text for _path, text in _strings(state) if text not in refs]
    if refs or _has_typed(state) or not texts or any(text.strip() for text in texts):
        return []
    return [(None, "Every text value on this row is blank, so the model has nothing to judge.")]


def large_state(state, questions, refs):
    size = len(json.dumps(state))
    if size <= LARGE_STATE_CHARS:
        return []
    return [(None, "This row's state is %s characters as JSON, over %s; every question on it pays to read all of "
             "it." % (format(size, ","), format(LARGE_STATE_CHARS, ",")))]


# ---------- what the questions point at ----------


def referenced_field_empty(state, questions, refs):
    out = []
    for qid, path in _paths(questions, refs):
        values = [value for _route, value in _lookup(state, path)]
        if values and all(_blank(value) for value in values):
            out.append((qid, "`%s` is on this row but empty, so the question has nothing to read there." % path))
    return out


def placeholder_value(state, questions, refs):
    out = []
    for qid, path in _paths(questions, refs):
        values = [value for _route, value in _lookup(state, path)]
        if values and all(isinstance(value, str) and value.strip().casefold() in PLACEHOLDERS for value in values):
            out.append((qid, "`%s` holds a placeholder such as n/a instead of a value; the model reads it as text."
                        % path))
    return out


def ambiguous_path(state, questions, refs):
    out = []
    for qid, path in _paths(questions, refs):
        if len(_lookup(state, path)) > 1:
            out.append((qid, "`%s` names more than one place on this row: a field whose name holds a dot, and a "
                        "field inside another. Rename one of them." % path))
    return out


def path_case_mismatch(state, questions, refs):
    out = []
    fields = _top_fields(state, refs)
    for qid, path in _paths(questions, refs):
        if _lookup(state, path):
            continue
        first = _FIRST.match(path)
        near = [name for name in fields if first and name != first.group(0) and _loose(name) == _loose(first.group(0))]
        if near:
            out.append((qid, "`%s` is not on this row, but %s differs only in case, spaces, underscores or hyphens; "
                        "paths match field names exactly." % (path, _names(near))))
    return out


def photo_is_text(state, questions, refs):
    if not isinstance(state, dict) or workbench.PHOTO_FIELD not in state or state[workbench.PHOTO_FIELD] in refs:
        return []
    return [(qid, "`%s` on this row is an input field, not a picture; name the picture with %s to send it as one."
             % (path, workbench.IMAGE_KEY))
            for qid, path in _paths(questions, refs)
            if path == workbench.PHOTO_FIELD or path.startswith(workbench.PHOTO_FIELD + ".")]


def _steps(path: str) -> List[int]:
    """Positions where a path's prefix ends: before each "." and "[" step."""
    return [match.start() for match in re.finditer(r"[.\[]", path) if match.start() > 0]


def index_past_end(state, questions, refs):
    out = []
    for qid, path in _paths(questions, refs):
        if _lookup(state, path):
            continue
        for match in re.finditer(r"\[(\d+)\]", path):
            lists = [value for _route, value in _lookup(state, path[:match.start()]) if isinstance(value, list)]
            if lists and all(len(value) <= int(match.group(1)) for value in lists):
                count = max(len(value) for value in lists)
                out.append((qid, "`%s` has %s on this row, so `%s` points past its end."
                            % (path[:match.start()], "1 entry" if count == 1 else "%d entries" % count, path)))
                break
    return out


def path_through_text(state, questions, refs):
    out = []
    for qid, path in _paths(questions, refs):
        if _lookup(state, path):
            continue
        for end in reversed(_steps(path)):
            values = [value for _route, value in _lookup(state, path[:end])]
            if values and all(isinstance(value, str) for value in values):
                out.append((qid, "`%s` is text on this row, so `%s` cannot reach inside it; store it as an object."
                            % (path[:end], path)))
                break
    return out


def photo_without_picture(state, questions, refs):
    if refs or (isinstance(state, dict) and workbench.PHOTO_FIELD in state):
        return []
    return [(qid, "`%s` points at the picture, but this row names none with %s." % (path, workbench.IMAGE_KEY))
            for qid, path in _paths(questions, refs)
            if _FIRST.match(path) and _FIRST.match(path).group(0) == workbench.PHOTO_FIELD]


def unused_picture(state, questions, refs):
    if not refs or workbench.has_box(questions):
        return []
    if any(_FIRST.match(path) and _FIRST.match(path).group(0) == workbench.PHOTO_FIELD
           for question in questions.values() for path in lint._paths(question)):
        return []
    return [(None, "This row sends a picture, but no question is a Box question or points at `%s`; the picture "
             "still adds to the request." % workbench.PHOTO_FIELD)]


# ---------- what the model should not see ----------


def mark_like_fields(state, questions, refs):
    found = [key for key in _top_fields(state, refs)
             if key.startswith("_") and key not in MARKS and key.lstrip("_").casefold() in MARK_WORDS]
    if not found:
        return []
    return [(None, "%s %s like a row mark but %s not %s, %s or %s, so %s sent to the model as input."
             % (_names(found), "looks" if len(found) == 1 else "look", "is" if len(found) == 1 else "are",
                workbench.LABEL_KEY, workbench.TEST_KEY, workbench.IMAGE_KEY, "it is" if len(found) == 1 else "they are"))]


def nested_marks(state, questions, refs):
    found: List[str] = []

    def walk(value: Any, route: str, depth: int) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                here = "%s.%s" % (route, key) if route else str(key)
                if depth > 0 and key in MARKS:
                    found.append(here)
                walk(item, here, depth + 1)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, "%s[%d]" % (route, index), depth + 1)

    walk(state, "", 0)
    if not found:
        return []
    return [(None, "%s %s inside the input, where Bulk does not treat it as a mark; it is sent to the model as "
             "input." % (_names(found), "sits" if len(found) == 1 else "sit"))]


def labels_inside_text(state, questions, refs):
    found = [path for path, text in _strings(state)
             if any('"%s"' % mark in text or "'%s'" % mark in text for mark in (workbench.LABEL_KEY, workbench.TEST_KEY))]
    if not found:
        return []
    return [(None, "%s holds the text \"_expect\" or \"_test\": a labeled line that is not valid JSON is sent as "
             "text, labels and all." % _names(found))]


def question_id_field(state, questions, refs):
    out = []
    for qid, question in questions.items():
        if not isinstance(state, dict) or qid not in state or qid == workbench.PHOTO_FIELD:
            continue
        own = [path for path in lint._paths(question) if path == qid or path.startswith((qid + ".", qid + "["))]
        if not own:
            out.append((qid, "This row has a field named `%s`, like the question; if it holds the answer, the model "
                        "reads it." % qid))
    return out


def field_holds_option_key(state, questions, refs):
    if not isinstance(state, dict):
        return []
    out = []
    for qid, question in questions.items():
        if question["type"] != "choice" or len(question["criteria"]) < 2:
            continue
        own = {(_FIRST.match(path).group(0) if _FIRST.match(path) else path) for path in lint._paths(question)}
        found = [key for key, value in state.items()
                 if key not in own and key != qid and isinstance(value, str) and value in question["criteria"]]
        if found:
            out.append((qid, "%s %s one of this question's option keys; if %s the answer, the model reads it."
                        % (_names(found), "holds" if len(found) == 1 else "hold", "it is" if len(found) == 1 else "they are")))
    return out


# ---------- shape ----------


def unaddressable_field_names(state, questions, refs):
    # lint's path grammar: a field name may hold dots (`order.total` names a field so called), not spaces.
    found = [key for key in _top_fields(state, refs) if not (isinstance(key, str) and lint._PATH.fullmatch(key))]
    if not found:
        return []
    return [(None, "%s cannot be named in a backtick path; use letters, digits, _ and -, starting with a letter or "
             "_." % ", ".join(json.dumps(key, ensure_ascii=False) for key in found))]


def same_text_in_two_fields(state, questions, refs):
    seen: Dict[str, str] = {}
    pairs: List[Tuple[str, str]] = []
    for path, text in _strings(state):
        if len(text.strip()) < SAME_TEXT_MIN_CHARS or text in refs:
            continue
        if text in seen:
            pairs.append((seen[text], path))
        else:
            seen[text] = path
    return [(None, "`%s` and `%s` hold the same text, so the model reads it twice." % pair) for pair in pairs]


def fields_in_text_field(state, questions, refs):
    out = []
    for path, text in _strings(state):
        lines = len(lint._KEY_VALUE.findall(text))
        if lines >= lint.KEY_VALUE_LINES:
            out.append((None, "`%s` holds %d \"Key: value\" lines; put each value in its own field and point "
                        "questions at the fields." % (path, lines)))
    return out


def _check(ident: str, title: str, check) -> dict:
    return {"id": ident, "kind": "preflight_check", "title": title, "check": check}


PACK = kit.define_pack({
    "id": "preflight-states",
    "surface": "python.health",
    "title": "Request state notes before Bulk",
    "about": "Advisory notes about each row's exact Bulk request state: empty or oversized rows, fields the questions "
             "point at that are empty or misnamed, and input the model should not see. Paths and field names only.",
    "features": [
        _check("empty_object_state", "Rows that send an empty object or array", empty_object_state),
        _check("blank_state", "Rows whose every text value is blank", blank_state),
        _check("large_state", "Rows whose state is over 20,000 characters", large_state),
        _check("referenced_field_empty", "A field a question points at is empty on this row", referenced_field_empty),
        _check("placeholder_value", "A field a question points at holds a placeholder such as n/a", placeholder_value),
        _check("ambiguous_path", "A path that names more than one place on this row", ambiguous_path),
        _check("path_case_mismatch", "A missing path whose field exists in another case or spelling",
               path_case_mismatch),
        _check("photo_is_text", "A question points at photo, but this row's photo is a field, not a picture",
               photo_is_text),
        _check("index_past_end", "A path that indexes a list past its end on this row", index_past_end),
        _check("path_through_text", "A path that reaches into a field holding text", path_through_text),
        _check("photo_without_picture", "A question points at photo, but this row names no picture",
               photo_without_picture),
        _check("unused_picture", "A picture on a row whose questions never use it", unused_picture),
        _check("mark_like_fields", "Fields that look like a misspelled row mark", mark_like_fields),
        _check("nested_marks", "Row marks nested inside the input", nested_marks),
        _check("labels_inside_text", "Labels inside text from a line that was not valid JSON", labels_inside_text),
        _check("question_id_field", "A field named like a question that does not point at it", question_id_field),
        _check("field_holds_option_key", "A field whose value is one of a Choice question's option keys",
               field_holds_option_key),
        _check("unaddressable_field_names", "Field names a backtick path cannot name", unaddressable_field_names),
        _check("same_text_in_two_fields", "Two fields holding the same text", same_text_in_two_fields),
        _check("fields_in_text_field", "A text field holding Key: value lines", fields_in_text_field),
    ],
})
