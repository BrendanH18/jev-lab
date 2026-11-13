"""Bulk preflight: more advisory notes about one row's exact request before a paid Bulk run.

Each check receives the state Bulk would send for one row (workbench.job_state: a text row under "text", the picture
named under "photo" by its asset reference), the validated questions and the row's picture references. These notes
look at what the request would show the model: a row that is a saved dataset's held-out test row, a row that is an
example from the criteria, text addressed to the model, earlier model answers or answer tags inside the input, cut
off, redacted, encoded or unfilled text, and fields that cost tokens without being asked about.

Notes name question ids, backticked paths, input field names and saved dataset names, never a value from the state.
They are advisory: jev.preflight reports them apart from its own findings, so they never ask for a confirm before a
run. The preflight-states pack already covers empty and oversized rows, empty or placeholder fields, paths that miss
on the row, pictures, row marks and fields named like a question; nothing here repeats them.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterator, List, Optional, Tuple

from jev import lint, workbench
from jev.lab import kit
from jev.workbench import WorkbenchError

ASKED = ("noul", "choice", "score")
LARGE_FIELD_CHARS = 2_000  # a field this long that no question points at is worth leaving out
LONG_LIST = 50
EXAMPLE_MIN_CHARS = 12  # shorter examples ("yes", "a leak") match ordinary inputs by chance
CUT_OFF_MIN_CHARS = 40
BLOB_RUN = 200
FILLER = {"test", "testing", "test test", "asdf", "asdfgh", "asdfasdf", "qwerty", "foo", "foobar", "foo bar",
          "dummy", "dummy text", "sample text", "placeholder", "placeholder text", "hello world", "lorem", "xxx", "xxxx"}
ANSWER_WORDS = {"prediction", "predictions", "probability", "probabilities", "confidence", "logit", "logits"}
ANSWER_NAMES = {"model_answer", "model_answers", "model_output", "model_label", "ai_answer", "ai_label", "llm_answer",
                "llm_label", "answers"}
OWN_ANSWER_ENDINGS = {"answer", "prediction", "pred", "probability", "prob", "p", "confidence", "conf"}

Finding = Tuple[Optional[str], str]


# ---------- reading the state ----------


def _lookup(value: Any, path: str) -> List[Tuple[str, Any]]:
    """Every (path as written, value) a backtick path names, by lint._resolve's rules (a field name may hold dots)."""
    def walk(value: Any, rest: str) -> List[Any]:
        if rest == "":
            return [value]
        found: List[Any] = []
        if isinstance(value, dict):
            for key in value:
                if isinstance(key, str) and rest.startswith(key):
                    tail = rest[len(key):]
                    if tail == "" or tail[0] in ".[":
                        found += walk(value[key], tail[1:] if tail.startswith(".") else tail)
        elif isinstance(value, list):
            step = re.match(r"\[(\d+)\]|(\d+)(?=$|[.\[])", rest)
            if step:
                index = int(step.group(1) or step.group(2))
                tail = rest[step.end():]
                if index < len(value):
                    found += walk(value[index], tail[1:] if tail.startswith(".") else tail)
        return found

    return [(path, item) for item in walk(value, path)]


def _strings(value: Any, route: str = "") -> Iterator[Tuple[str, str]]:
    """(path, text) for every text value inside `value`, paths written as questions write them."""
    if isinstance(value, str):
        yield route, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _strings(item, "%s.%s" % (route, key) if route else str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _strings(item, "%s[%d]" % (route, index))


def _paths(question: dict, refs: set) -> List[str]:
    return [path for path in lint._paths(question) if path not in refs]


def _read(state: Any, questions: Dict[str, dict], refs: set, types=ASKED) -> Iterator[Tuple[Optional[str], str, str]]:
    """(question id, path, text) for the text each question points at on this row. When no question points at any
    path, every question reads the whole state: then every text in it, with no question id."""
    pointed = False
    for qid, question in questions.items():
        for path in _paths(question, refs):
            pointed = True
            if question["type"] not in types:
                continue
            for route, value in _lookup(state, path):
                for inner, text in _strings(value, route):
                    if text not in refs:
                        yield qid, inner, text
    if not pointed:
        for path, text in _strings(state):
            if text not in refs:
                yield None, path, text


def _first_per_question(found: Iterator[Tuple[Optional[str], str]]) -> List[Tuple[Optional[str], str]]:
    """The first (question id, path) for each question id, in order."""
    out: Dict[Optional[str], str] = {}
    for qid, path in found:
        out.setdefault(qid, path)
    return list(out.items())


def _place(path: str) -> str:
    return "`%s`" % path if path else "The row's text"


def _canon(state: Any) -> str:
    return json.dumps(state, sort_keys=True, ensure_ascii=False)


# ---------- the row is not new input ----------

_HELD: Dict[str, Any] = {}


def _held_out_index() -> Dict[str, List[str]]:
    """{request state as sorted JSON: [saved dataset names]} for every held-out test row of every saved dataset, as
    Bulk would send it. Read through the app's loaders, and read again only when a dataset file changes."""
    directory = workbench.datasets_dir()
    files = sorted(directory.glob("*.json")) if directory.is_dir() else []
    stamp = (str(directory), tuple((path.name, path.stat().st_mtime_ns, path.stat().st_size) for path in files))
    if _HELD.get("stamp") == stamp:
        return _HELD["index"]
    index: Dict[str, List[str]] = {}
    for summary in workbench.list_datasets():
        if not (summary.get("test") or {}).get("rows"):
            continue
        try:
            dataset = workbench.load_dataset(str(summary["id"]))
        except WorkbenchError:
            continue
        name = str(dataset.get("name") or dataset["id"])
        for number, row in enumerate(dataset["rows"], 1):
            if not (isinstance(row, dict) and row.get(workbench.TEST_KEY) is True):
                continue
            try:
                state, _labels = workbench.split_labels(row, number)
                key = _canon(workbench._state([(state, None)], 0, "text"))
            except (WorkbenchError, TypeError, ValueError):
                continue
            if name not in index.setdefault(key, []):
                index[key].append(name)
    _HELD.clear()
    _HELD.update({"stamp": stamp, "index": index})
    return index


def matches_saved_held_out(state, questions, refs):
    names = _held_out_index().get(_canon(state))
    if not names:
        return []
    return [(None, "This row's input is a held-out test row of saved dataset %s. Running it shows answers on a row kept "
             "out of tuning; leave it out unless you mean to score the test split."
             % ", ".join("`%s`" % name for name in names))]


def _normal(text: str) -> str:
    return " ".join(text.casefold().split()).strip(" .,;:!?\"'“”‘’")


def _examples(question: dict) -> List[str]:
    """Example inputs a question's criteria carry: items of fields named like "examples", and quoted text."""
    found: List[str] = []

    def walk(value: Any, example: bool) -> None:
        if isinstance(value, str):
            if example:
                found.append(value)
            found.extend(m.group(1) or m.group(2) for m in re.finditer(r"“([^”]+)”|\"([^\"]+)\"", value))
        elif isinstance(value, dict):
            for key, item in value.items():
                walk(item, example or "example" in str(key).lower())
        elif isinstance(value, list):
            for item in value:
                walk(item, example)

    walk(question.get("criteria"), False)
    return [text for text in (_normal(item) for item in found) if len(text) >= EXAMPLE_MIN_CHARS]


def criteria_example_as_input(state, questions, refs):
    texts = [(path, _normal(text)) for path, text in _strings(state) if text not in refs]
    out = []
    for qid, question in questions.items():
        examples = set(_examples(question))
        hit = next((path for path, text in texts if text in examples), None)
        if hit is not None:
            out.append((qid, "%s on this row is word for word an example from this question's criteria, so the answer "
                             "is given away and the row says nothing about new inputs. Leave it out of evaluation runs."
                        % _place(hit)))
    return out


# ---------- what the input says to the model ----------

_ADDRESSED = re.compile(
    r"\bignore (?:all |any |the )?(?:previous|prior|above|earlier|preceding|your) (?:instructions|prompts?|rules|directions)\b"
    r"|\bdisregard (?:all |any |the )?(?:previous|prior|above|earlier|your) (?:instructions|prompts?|rules)\b"
    r"|\b(?:note|message|instructions?) (?:to|for) (?:the )?(?:ai|assistant|bot|model|llm|classifier)\b"
    r"|\byou are (?:now )?(?:an?|the) (?:ai|assistant|chatbot|language model|classifier)\b"
    r"|\bas an ai (?:language )?model\b|\bsystem prompt\b|^\s*system:\s"
    r"|\b(?:answer|respond|reply|classify|mark|label|flag) (?:this|it|me) as (?:safe|legitimate|not spam|approved|yes|no"
    r"|true|false)\b", re.I | re.M)


def text_addressed_to_model(state, questions, refs):
    found = [path for path, text in _strings(state) if text not in refs and _ADDRESSED.search(text)]
    if not found:
        return []
    return [(None, "%s on this row holds wording addressed to an AI model (an instruction to ignore instructions or to "
                   "answer a certain way). If it is real traffic, keep it, but check its answers: the model may follow "
                   "the text instead of the question." % ", ".join(_place(path) for path in found))]


def _words(name: str) -> List[str]:
    return [word.lower() for word in re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", name)]


def _pointed_tops(questions: Dict[str, dict], refs: set) -> set:
    return {re.match(r"[^.\[]*", path).group(0) for question in questions.values() for path in _paths(question, refs)}


def previous_answer_fields(state, questions, refs):
    if not isinstance(state, dict):
        return []
    pointed = _pointed_tops(questions, refs)
    found = []
    for key in state:
        if not isinstance(key, str) or key in pointed or (key == workbench.PHOTO_FIELD and state[key] in refs):
            continue
        loose = "_".join(_words(key))
        own = [qid for qid in questions if loose.startswith("_".join(_words(qid)) + "_")
               and loose[len("_".join(_words(qid))) + 1:] in OWN_ANSWER_ENDINGS]
        if own or loose in ANSWER_NAMES or set(_words(key)) & ANSWER_WORDS:
            found.append(key)
    if not found:
        return []
    return [(None, "%s %s named like an earlier model answer (a prediction, probability or confidence); if %s one, the "
                   "model reads it and may copy it. Leave earlier answers out of the row."
             % (", ".join("`%s`" % key for key in found), "is" if len(found) == 1 else "are",
                "it holds" if len(found) == 1 else "they hold"))]


def answer_tag_in_text(state, questions, refs):
    out = []
    for qid, question in questions.items():
        if question["type"] != "choice":
            continue
        keys = [key for key in question["criteria"] if len(key.strip()) >= 3]
        if not keys:
            continue
        names = "|".join(re.escape(key.strip()).replace("_", "[ _-]").replace("\\-", "[ _-]") for key in keys)
        rx = re.compile(r"\[\s*(?:%s)\s*\]|(?<![\w#])#(?:%s)\b|\b(?:category|label|tags?|type|class|team|department|topic"
                        r"|intent)\s*[:=]\s*(?:%s)\b" % (names, names, names), re.I)
        path = next((path for asker, path, text in _read(state, {qid: question}, refs, ("choice",)) if rx.search(text)), None)
        if path is not None:
            out.append((qid, "%s on this row tags itself with one of this question's option keys (as \"[key]\", \"#key\" "
                             "or \"Category: key\"), so the model may copy the tag instead of judging the text. Remove "
                             "the tags from the input." % _place(path)))
    return out


# ---------- text that is not the whole input ----------

_CUT = re.compile(r"(?:\.\.\.|…|\[(?:truncated|cut|\.\.\.|…|more)\]|\((?:truncated|cut|continued|cont\.)\)|<truncated>"
                  r"|\btruncated)\s*$", re.I)


def pointed_value_cut_off(state, questions, refs):
    found = ((qid, path) for qid, path, text in _read(state, questions, refs)
             if len(text.strip()) >= CUT_OFF_MIN_CHARS and _CUT.search(text))
    return [(qid, "%s on this row ends as if cut off (an ellipsis or a truncation mark), so the model judges only part of "
                  "it. Export the whole text." % _place(path)) for qid, path in _first_per_question(found)]


_REDACTED = re.compile(r"\[\s*(?:[Rr]edacted|REDACTED|[Rr]emoved|REMOVED|[Hh]idden|HIDDEN|[Mm]asked|MASKED)\s*\]"
                       r"|<\s*(?:redacted|REDACTED|removed|REMOVED)\s*>|█{2,}"
                       r"|(?<![A-Za-z])X{4,}(?![A-Za-z])")


def redacted_value(state, questions, refs):
    found = ((qid, path) for qid, path, text in _read(state, questions, refs) if _REDACTED.search(text))
    return [(qid, "%s on this row has parts redacted ([REDACTED], █ or XXXX), so the question may depend on text the "
                  "model cannot see. Check that what the question asks about survived the redaction." % _place(path))
            for qid, path in _first_per_question(found)]


_DATA_URI = re.compile(r"^\s*data:[\w/+.-]+;base64,")
_RUN = re.compile(r"[A-Za-z0-9+/]{%d,}={0,2}" % BLOB_RUN)


def _blob(text: str) -> bool:
    """A data: URI, or a long run of base64 characters mixing capitals, small letters and digits, as encoded bytes do
    (a long run of one letter is not one)."""
    return bool(_DATA_URI.search(text)) or any(
        re.search(r"[A-Z]", run) and re.search(r"[a-z]", run) and re.search(r"\d", run)
        for run in (m.group(0) for m in _RUN.finditer(text)))


def encoded_blob(state, questions, refs):
    found = [path for path, text in _strings(state) if text not in refs and _blob(text)]
    if not found:
        return []
    return [(None, "%s on this row holds an encoded blob (base64 or a data: URI), which the model reads as characters, "
                   "not as a file, and every question pays for. Send pictures with %s and leave other files out."
             % (", ".join(_place(path) for path in found), workbench.IMAGE_KEY))]


_TEMPLATE = re.compile(r"\{\{\s*[\w.]+\s*\}\}|\$\{\s*[\w.]+\s*\}|%\(\w+\)[sd]|\[\[\s*[\w.]+\s*\]\]|<<\s*[\w.]+\s*>>")


def unfilled_template(state, questions, refs):
    found = [path for path, text in _strings(state) if text not in refs and _TEMPLATE.search(text)]
    if not found:
        return []
    return [(None, "%s on this row holds an unfilled template variable (such as {{name}}), so the row was exported before "
                   "its values were filled in." % ", ".join(_place(path) for path in found))]


def filler_text(state, questions, refs):
    found = [path for path, text in _strings(state)
             if text not in refs and (_normal(text) in FILLER or re.search(r"\blorem ipsum\b|\bdolor sit amet\b", text, re.I))]
    if not found:
        return []
    return [(None, "%s on this row holds test filler (such as lorem ipsum or asdf), not real input; leave the row out of "
                   "the run." % ", ".join(_place(path) for path in found))]


# ---------- what the questions point at ----------


def pointed_typed_value(state, questions, refs):
    out = []
    for qid, question in questions.items():
        paths = _paths(question, refs)
        if question["type"] not in ASKED or not paths:
            continue
        values = [_lookup(state, path) for path in paths]
        if all(found and all(isinstance(value, (bool, int, float)) for _path, value in found) for found in values):
            out.append((qid, "Every field this question points at (%s) holds a plain true/false or number on this row, "
                             "which code reads exactly. Decide it in code, or point the question at the text the value "
                             "came from." % ", ".join("`%s`" % path for path in paths)))
    return out


def long_list_pointed(state, questions, refs):
    out = []
    for qid, question in questions.items():
        if question["type"] not in ASKED:
            continue
        for path in _paths(question, refs):
            lists = [value for _route, value in _lookup(state, path) if isinstance(value, list) and len(value) > LONG_LIST]
            if lists:
                out.append((qid, "`%s` holds %d items on this row, and the question gives one answer about all of them. "
                                 "If you need an answer per item, send each item as its own row."
                            % (path, max(len(value) for value in lists))))
                break
    return out


def large_unpointed_field(state, questions, refs):
    if not isinstance(state, dict):
        return []
    pointed = [path for question in questions.values() for path in _paths(question, refs)]
    if not pointed:
        return []  # with no paths, every question reads the whole state
    out = []
    for key, value in state.items():
        if not isinstance(key, str) or (key == workbench.PHOTO_FIELD and value in refs):
            continue
        if any(path == key or path.startswith((key + ".", key + "[")) for path in pointed):
            continue
        size = len(json.dumps(value))
        if size > LARGE_FIELD_CHARS:
            out.append((None, "`%s` is %s characters as JSON and no question points at it, so every question on this row "
                              "pays to read it. Leave it out of the row, or point a question at it."
                        % (key, format(size, ","))))
    return out


def _check(ident: str, title: str, check) -> dict:
    return {"id": ident, "kind": "preflight_check", "title": title, "check": check}


PACK = kit.define_pack({
    "id": "preflight-requests",
    "surface": "python.health",
    "title": "Request notes before Bulk",
    "about": "More advisory Bulk preflight notes on one row's exact request: held-out rows and criteria examples run "
             "as new input, text addressed to the model, earlier answers and answer tags in the input, cut off, "
             "redacted, encoded or unfilled text, and fields that cost tokens without being asked about.",
    "features": [
        _check("matches_saved_held_out", "A row identical to a held-out test row of a saved dataset", matches_saved_held_out),
        _check("criteria_example_as_input", "A row whose text is an example from a question's criteria",
               criteria_example_as_input),
        _check("text_addressed_to_model", "Input text addressed to an AI model (\"ignore previous instructions\")",
               text_addressed_to_model),
        _check("previous_answer_fields", "Fields named like an earlier model answer (prediction, confidence)",
               previous_answer_fields),
        _check("answer_tag_in_text", "Text tagged with one of a Choice's option keys ([billing], Category: billing)",
               answer_tag_in_text),
        _check("pointed_value_cut_off", "A field a question points at that ends as if cut off", pointed_value_cut_off),
        _check("redacted_value", "A field a question points at with redacted parts", redacted_value),
        _check("encoded_blob", "Base64 or data: URI blobs in the row", encoded_blob),
        _check("unfilled_template", "Unfilled template variables ({{name}}) in the row", unfilled_template),
        _check("filler_text", "Test filler (lorem ipsum, asdf) in the row", filler_text),
        _check("pointed_typed_value", "A question whose fields hold only true/false or numbers on the row",
               pointed_typed_value),
        _check("long_list_pointed", "A question pointing at a list of more than 50 items", long_list_pointed),
        _check("large_unpointed_field", "A field over 2,000 characters that no question points at", large_unpointed_field),
    ],
})
