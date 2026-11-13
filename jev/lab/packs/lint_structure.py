"""Question checks on the structure of a request: question ids, the paths questions point at, the shape and
content of the state, and pictures and Box questions.

The built-in check already reports a backticked path the state lacks (`missing_path`); the path rules here add
what the fix probably is (a case or spelling slip, a list without an index, a field one level up, path syntax the
checks cannot read). Messages quote question ids, field names, paths and picture references, which are authored
names, and never a state value; a rule that inspects values says only where they are.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Dict, Iterable, List, Optional, Tuple

from jev import images, lint
from jev.lab import kit

STATE = "#use-structure-in-the-input-state"
STRUCTURE = "#use-structure-in-the-questions"
DECOMPOSE = "#decompose-the-questions"
EMPTY = (None, "", [], {})
MAX_DEPTH = 6
LARGE_STATE = 20000
LARGE_FIELD = 2000
SNAKE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
ADDRESSABLE = re.compile(r"^[A-Za-z_][\w.-]*$")
# A picture reference the app made: Build's `photo-` and ten hex digits, or images.new_ref's label and twelve. Real
# random hex mixes letters and digits, so an id such as `order-1234567890` does not count.
PICTURE_REF = re.compile(r"^(?:photo|img)-(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{10}(?:[0-9a-f]{2})?$")
ROW_MARKS = ("_expect", "_test", "_image")
CSV_LABEL_PREFIXES = ("label:", "expect:", "_expect.")  # jev.csvimport reads these columns as labels
ANSWER_FIELDS = {"label", "labels", "answer", "answers", "expected", "expected_answer", "ground_truth", "gold",
                 "gold_label", "target", "correct_answer", "truth"}
PLACEHOLDER_IDS = {"x", "y", "z", "q", "a", "b", "c", "test", "tmp", "temp", "foo", "bar", "baz", "untitled", "new",
                   "new_question", "question", "my_question", "example", "sample", "id"}
# Numbered ids, including the ones Build gives a new question (`noul_1`, `choice_2`).
NUMBERED_ID = re.compile(r"(?:q|question|item|field|input|check|test|noul|choice|score|box)_?\d+", re.I)

Finding = Tuple[Optional[str], str]


# ---------- helpers ----------

def _texts(question: dict) -> List[str]:
    return list(lint._strings([question.get("instructions"), question.get("criteria")]))


def _ticked(question: dict) -> List[str]:
    found: List[str] = []
    for text in _texts(question):
        for token in lint._TICKED.findall(text):
            if token.strip() not in found:
                found.append(token.strip())
    return found


def _lookup(value: Any, path: str) -> Tuple[bool, Any]:
    """(found, value at `path`), resolving the way jev.lint._resolve does (a field name may contain dots)."""
    if path == "":
        return True, value
    if isinstance(value, dict):
        for key in value:
            if isinstance(key, str) and path.startswith(key):
                rest = path[len(key):]
                if rest == "" or rest[0] in ".[":
                    found, got = _lookup(value[key], rest[1:] if rest.startswith(".") else rest)
                    if found:
                        return True, got
        return False, None
    if isinstance(value, list):
        step = re.match(r"\[(\d+)\]|(\d+)(?=$|[.\[])", path)
        if not step:
            return False, None
        index, rest = int(step.group(1) or step.group(2)), path[step.end():]
        if index >= len(value):
            return False, None
        return _lookup(value[index], rest[1:] if rest.startswith(".") else rest)
    return False, None


def _steps(path: str) -> List[str]:
    """A path's steps: field names, and indexes written as [n]."""
    first = re.match(r"[^.\[]+", path)
    if not first:
        return []
    steps = [first.group(0)]
    for m in lint._STEP.finditer(path, first.end()):
        name = m.group(1)
        steps.append("[%s]" % (m.group(2) if name is None else name) if name is None or name.isdigit() else name)
    return steps


def _join_steps(steps: List[str]) -> str:
    out = ""
    for step in steps:
        out += step if step.startswith("[") else ("." + step if out else step)
    return out


def _missing(state: Any, question: dict, refs: set) -> List[str]:
    """Backticked paths that are not in the state and are not picture references: the built-in missing_path ones."""
    if not isinstance(state, (dict, list)):
        return []
    return [path for path in lint._paths(question) if path not in refs and not lint._resolve(state, path)]


def _walk_missing(state: Any, path: str):
    """Walk a missing path step by step. Returns (steps walked, value reached, the step that failed) or None."""
    steps, value = _steps(path), state
    for i, step in enumerate(steps):
        if step.startswith("["):
            index = int(step[1:-1])
            if isinstance(value, list) and index < len(value):
                value = value[index]
                continue
            return steps[:i], value, step
        if isinstance(value, dict) and step in value:
            value = value[step]
            continue
        return steps[:i], value, step
    return None


def _leaves(value: Any, prefix: str = "") -> Iterable[Tuple[str, Any]]:
    """(path, value) for every value below the top of the state, objects and lists included."""
    if isinstance(value, dict):
        for key, item in value.items():
            path = "%s.%s" % (prefix, key) if prefix else str(key)
            yield path, item
            yield from _leaves(item, path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            path = "%s[%d]" % (prefix, index)
            yield path, item
            yield from _leaves(item, path)


def _strings_at(state: Any) -> List[Tuple[str, str]]:
    if isinstance(state, str):
        return [("", state)]
    return [(path, value) for path, value in _leaves(state) if isinstance(value, str)]


def _place(path: str) -> str:
    return "The state" if path == "" else "`%s`" % path


def _depth(value: Any) -> int:
    if isinstance(value, dict) and value:
        return 1 + max(_depth(item) for item in value.values())
    if isinstance(value, list) and value:
        return 1 + max(_depth(item) for item in value)
    return 0


def _pointed(state: Any, questions: dict) -> List[str]:
    """Every backticked path any question points at that the state has."""
    return [path for q in questions.values() for path in lint._paths(q) if lint._resolve(state, path)]


def _fold(name: str) -> str:
    return re.sub(r"[\s_.-]+", "", name.lower())


def _snake(name: str) -> str:
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name.strip())
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "question"


def _edit_one(a: str, b: str) -> bool:
    """Whether a and b differ by one inserted, deleted or replaced character, or two swapped neighbours."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        return len(diff) == 1 or (len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]])
    short, long = (a, b) if len(a) < len(b) else (b, a)
    return any(long[:i] + long[i + 1:] == short for i in range(len(long)))


def _plural(a: str, b: str) -> bool:
    return a.lower() in (b.lower() + "s", b.lower() + "es") or b.lower() in (a.lower() + "s", a.lower() + "es")


# ---------- question ids ----------

def _bad_for_rules(qid: str) -> bool:
    # jev.rules reads a condition as the id (no spaces) followed by an operator: = != < > <= >=.
    return bool(re.search(r"[\s=<>]", qid))


def id_not_snake_case(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid in questions:
        if _bad_for_rules(qid) or all(SNAKE.match(part) for part in qid.split(".")):
            continue
        out.append((qid, "Question id `%s` is not snake_case. Ids become names in code, CSV columns and rules; "
                         "lowercase words joined by underscores, such as `%s`, are the easiest to type and match." % (qid, _snake(qid))))
    return out


def uninformative_id(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid in questions:
        if NUMBERED_ID.fullmatch(qid) or qid.isdigit():
            kind = "a numbered id"
        elif qid.lower() in PLACEHOLDER_IDS:
            kind = "a placeholder id"
        else:
            continue
        out.append((qid, "`%s` is %s, which says nothing about the question. Name it after what it asks, such as "
                         "`wants_refund`, so answers, labels and rules read clearly." % (qid, kind)))
    return out


def ids_differ_by_case(state: Any, questions: dict, refs: set) -> List[Finding]:
    groups: Dict[str, List[str]] = {}
    for qid in questions:
        groups.setdefault(_fold(qid), []).append(qid)
    return [(qids[0], "%s differ only in case or separators. CSV import matches columns to questions ignoring case, and "
                      "people mix them up in labels and rules; rename one." % " and ".join("`%s`" % q for q in qids))
            for qids in groups.values() if len(qids) > 1]


def id_collides_with_csv(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid in questions:
        lower = qid.lower()
        if lower == "row" or lower.startswith(CSV_LABEL_PREFIXES):
            out.append((qid, "Question id `%s` collides with a column name that Bulk's CSV files give their own meaning: "
                             "`row` holds the row, and a column starting with `label:`, `expect:` or `_expect.` holds a "
                             "label. Rename the question." % qid))
    return out


def id_unusable_in_rules(state: Any, questions: dict, refs: set) -> List[Finding]:
    return [(qid, "Question id `%s` holds a space or one of = < >, and a consistency rule names a question by its id "
                  "followed by an operator, so it cannot be named in a rule. Use letters, digits and underscores." % qid)
            for qid in questions if _bad_for_rules(qid)]


def id_same_as_state_field(state: Any, questions: dict, refs: set) -> List[Finding]:
    if not isinstance(state, dict):
        return []
    return [(qid, "Question `%s` has the same name as a state field. If the input already holds the answer, read it in "
                  "code instead of asking; otherwise rename the question so answers and inputs are not confused." % qid)
            for qid in questions if qid in state]


# ---------- paths ----------

def array_path_without_index(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        for path in _missing(state, q, refs):
            walked = _walk_missing(state, path)
            if walked and isinstance(walked[1], list) and not walked[2].startswith("["):
                at, rest = _join_steps(walked[0]) or path, walked[2]
                out.append((qid, "`%s` steps into `%s`, which is a list, by a field name. Name an item by its index, such "
                                 "as `%s[0].%s`, or point at the whole list." % (path, at, at, rest)))
                break
    return out


def _sibling_fix(state: Any, path: str, match) -> Optional[str]:
    walked = _walk_missing(state, path)
    if not walked or not isinstance(walked[1], dict) or walked[2].startswith("["):
        return None
    done, here, step = walked
    found = [key for key in here if isinstance(key, str) and match(step, key)]
    if len(found) != 1:
        return None
    rest = _steps(path)[len(done) + 1:]
    fixed = _join_steps(done + [found[0]] + rest)
    return fixed if lint._resolve(state, fixed) else None


def _path_rule(match, message: str):
    def check(state: Any, questions: dict, refs: set) -> List[Finding]:
        out = []
        for qid, q in questions.items():
            for path in _missing(state, q, refs):
                fixed = _sibling_fix(state, path, match)
                if fixed:
                    out.append((qid, message % {"path": path, "fixed": fixed}))
                    break
        return out
    return check


path_case_mismatch = _path_rule(
    lambda step, key: step != key and step.lower() == key.lower(),
    "`%(path)s` is not in the state, but `%(fixed)s` is: field names are case-sensitive. Match the field's case.")

path_plural = _path_rule(
    lambda step, key: step.lower() != key.lower() and _plural(step, key),
    "`%(path)s` is not in the state, but `%(fixed)s` is: singular and plural are different fields.")

path_typo = _path_rule(
    lambda step, key: len(step) >= 4 and step.lower() != key.lower() and not _plural(step, key) and _edit_one(step.lower(), key.lower()),
    "`%(path)s` is not in the state; did you mean `%(fixed)s`? The names differ by one letter.")


def path_index_off_by_one(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        for path in _missing(state, q, refs):
            walked = _walk_missing(state, path)
            if walked and isinstance(walked[1], list) and walked[1] and walked[2] == "[%d]" % len(walked[1]):
                at, size = _join_steps(walked[0]), len(walked[1])
                out.append((qid, "`%s` asks for item %d, but `%s` has %d item%s, numbered from 0, so the last one is "
                                 "`%s[%d]`." % (path, size, at, size, "" if size == 1 else "s", at, size - 1)))
                break
    return out


def path_too_deep(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        for path in _missing(state, q, refs):
            walked = _walk_missing(state, path)
            if walked and walked[0] and not isinstance(walked[1], (dict, list)):
                at = _join_steps(walked[0])
                out.append((qid, "`%s` steps into `%s`, which is a single value with no fields. Point at `%s` itself."
                                 % (path, at, at)))
                break
    return out


def _named_paths(value: Any, name: str, prefix: str = "") -> List[str]:
    return [path for path, _item in _leaves(value, prefix) if re.search(r"(?:^|\.)%s$" % re.escape(name), path)]


def path_missing_parent(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    if not isinstance(state, dict):
        return out
    for qid, q in questions.items():
        for path in _missing(state, q, refs):
            if len(_steps(path)) != 1 or path in state:
                continue
            found = _named_paths(state, path)
            if len(found) == 1 and "." in found[0]:
                out.append((qid, "`%s` is not a top-level field, but `%s` is. Write the full path." % (path, found[0])))
                break
    return out


_SYNTAX = [(re.compile(r"^\$\.?"), ""), (re.compile(r"\[\s*[\"']([^\"'\]]+)[\"']\s*\]"), r".\1"),
           (re.compile(r"\s*(?:->|/|>)\s*"), ".")]


def path_syntax(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    if not isinstance(state, (dict, list)):
        return out
    for qid, q in questions.items():
        for token in _ticked(q):
            if lint._PATH.fullmatch(token) or token in refs:
                continue
            fixed = token
            for rx, repl in _SYNTAX:
                fixed = rx.sub(repl, fixed)
            fixed = fixed.strip(".")
            if fixed != token and lint._PATH.fullmatch(fixed) and lint._resolve(state, fixed):
                out.append((qid, "`%s` is not path syntax the checks read, so it is not checked. Write it as `%s`."
                                 % (token, fixed)))
                break
    return out


def refers_to_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        others = [token for token in _ticked(q) if token in questions and token != qid and token not in refs
                  and not (isinstance(state, (dict, list)) and lint._resolve(state, token))]
        if others:
            out.append((qid, "`%s` names the question `%s`, not a state field. Questions are answered independently and "
                             "cannot see each other's answers; point at the input instead, and combine answers in code."
                             % (others[0], others[0])))
    return out


def _empty(value: Any) -> bool:
    return value in EMPTY or (isinstance(value, str) and not value.strip())


def path_to_empty_value(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        empty = [path for path in lint._paths(q) if path not in refs and _lookup(state, path)[0] and _empty(_lookup(state, path)[1])]
        if empty:
            out.append((qid, "`%s` is empty in this state, so the question has nothing to read. Fill it in, or say in "
                             "the criteria what an empty field means." % empty[0]))
    return out


def link_as_data(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for qid, q in questions.items():
        links = [path for path in lint._paths(q) if path not in refs and isinstance(_lookup(state, path)[1], str)
                 and re.fullmatch(r"\s*https?://\S+\s*", _lookup(state, path)[1])]
        if links:
            out.append((qid, "`%s` holds only a link. The model cannot open links; put the content itself in the state."
                             % links[0]))
    return out


def no_field_named(state: Any, questions: dict, refs: set) -> List[Finding]:
    if not isinstance(state, dict) or len(state) < 2:
        return []
    out = []
    for qid, q in questions.items():
        text = " ".join(_texts(q))
        if not any(lint._resolve(state, path) for path in lint._paths(q)) and not any(ref in text for ref in refs):
            out.append((qid, "The state has %d fields, but this question points at none of them, so the model has to "
                             "guess what it is about. Name the field with backticks, such as `%s`." % (len(state), next(iter(state)))))
    return out


def unticked_field(state: Any, questions: dict, refs: set) -> List[Finding]:
    if not isinstance(state, dict):
        return []
    out = []
    for qid, q in questions.items():
        roots = {_steps(path)[0] for path in lint._paths(q) if _steps(path)}
        plain = " ".join(lint._QUOTED.sub(" ", text) for text in _texts(q))
        # Only names no prose would use (snake_case or camelCase), so an ordinary word such as "recipient" is not one.
        named = [key for key in state if isinstance(key, str) and re.search(r"[a-z0-9]_[a-z0-9]|[a-z][A-Z]", key)
                 and key not in roots and re.search(r"(?<![\w`.])%s(?![\w`])" % re.escape(key), plain)]
        if named:
            out.append((qid, "The question mentions `%s` as a plain word but does not point at the field. Write it in "
                             "backticks so the model knows which input you mean." % named[0]))
    return out


# ---------- the state ----------

def _keys(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from _keys(item)


def unaddressable_field(state: Any, questions: dict, refs: set) -> List[Finding]:
    bad = []
    for key in _keys(state):
        if not ADDRESSABLE.match(key) and key not in bad:
            bad.append(key)
    if not bad:
        return []
    return [(None, "The state field %s cannot be written as a backticked path, which takes letters, digits, _ and - and "
                   "starts with a letter or _. Rename it, such as `%s`." % (", ".join("`%s`" % k for k in bad[:3]), _snake(bad[0])))]


def state_keys_differ_by_case(state: Any, questions: dict, refs: set) -> List[Finding]:
    objects = [("", state)] + [(path, value) for path, value in _leaves(state) if isinstance(value, dict)]
    for where, obj in objects:
        if not isinstance(obj, dict):
            continue
        groups: Dict[str, List[str]] = {}
        for key in obj:
            groups.setdefault(_fold(str(key)), []).append(str(key))
        same = [keys for keys in groups.values() if len(keys) > 1]
        if same:
            inside = "the top of the state" if where == "" else "`%s`" % where
            return [(None, "Fields %s in %s differ only in case or separators, so paths to them are easy to mix up. "
                           "Merge or rename one." % (" and ".join("`%s`" % k for k in same[0]), inside))]
    return []


def deep_state(state: Any, questions: dict, refs: set) -> List[Finding]:
    depth = _depth(state)
    if depth <= MAX_DEPTH:
        return []
    return [(None, "The state nests %d levels deep. Flatten it to the fields the questions need: deep paths are hard to "
                   "point at and to read." % depth)]


def large_state(state: Any, questions: dict, refs: set) -> List[Finding]:
    size = len(json.dumps(state))
    if size <= LARGE_STATE:
        return []
    return [(None, "The state is %d characters as JSON (the limit is 120,000). Send only what the questions need: "
                   "every character is read on every call." % size)]


def large_unreferenced_field(state: Any, questions: dict, refs: set) -> List[Finding]:
    if not isinstance(state, dict):
        return []
    total = len(json.dumps(state))
    roots = {_steps(path)[0] for path in _pointed(state, questions) if _steps(path)}
    text = " ".join(" ".join(_texts(q)) for q in questions.values())
    out = []
    for key, value in state.items():
        size = len(json.dumps(value))
        if size >= LARGE_FIELD and 2 * size >= total and key not in roots and not any(ref in text for ref in refs if ref in json.dumps(value)):
            out.append((None, "`%s` holds %d of the state's %d characters, but no question points at it. Drop it, or "
                              "point a question at it." % (key, size, total)))
    return out


def empty_state_values(state: Any, questions: dict, refs: set) -> List[Finding]:
    pointed = {path for q in questions.values() for path in lint._paths(q)}
    empty = [path for path, value in _leaves(state) if _empty(value) and path not in pointed]
    if not empty:
        return []
    return [(None, "%d field%s of the state %s empty or null (%s). The model reads them as part of the input; leave them "
                   "out, or say in the questions what an empty field means." % (
                       len(empty), "" if len(empty) == 1 else "s", "is" if len(empty) == 1 else "are",
                       ", ".join("`%s`" % p for p in empty[:5]) + (", ..." if len(empty) > 5 else "")))]


def row_marks_in_state(state: Any, questions: dict, refs: set) -> List[Finding]:
    if not isinstance(state, dict):
        return []
    marks = [mark for mark in ROW_MARKS if mark in state]
    if not marks:
        return []
    return [(None, "The state has %s, a Bulk row mark. Here it is sent to the model as ordinary input; remove it, or run "
                   "the row in Bulk, which strips it." % " and ".join("`%s`" % m for m in marks))]


def answer_in_state(state: Any, questions: dict, refs: set) -> List[Finding]:
    if not isinstance(state, dict):
        return []
    found = [key for key in state if isinstance(key, str) and key.lower() in ANSWER_FIELDS]
    if not found:
        return []
    return [(None, "The state has a field `%s`, which reads like the expected answer. The model sees every field; keep "
                   "labels out of the input (Bulk keeps them under `_expect`)." % found[0])]


def json_string_state(state: Any, questions: dict, refs: set) -> List[Finding]:
    for path, text in _strings_at(state):
        stripped = text.strip()
        if stripped[:1] in ("{", "[") and stripped[-1:] in ("}", "]"):
            try:
                parsed = json.loads(stripped)
            except ValueError:
                continue
            if isinstance(parsed, (dict, list)) and parsed:
                return [(None, "%s is JSON written inside a string, so the model sees one long text. Send it as structure "
                               "(an object or a list) so questions can point at its fields." % _place(path))]
    return []


def markup_in_state(state: Any, questions: dict, refs: set) -> List[Finding]:
    rx = re.compile(r"</?(?:p|br|div|span|table|tr|td|li|ul|ol|a|b|i|strong|em|html|body|head|img|h[1-6])\b[^>]*>"
                    r"|&(?:nbsp|amp|lt|gt|quot|apos|#\d+);", re.I)
    found = [path for path, text in _strings_at(state) if rx.search(text)]
    if not found:
        return []
    return [(None, "%s holds HTML markup. Strip tags and entities in code, so the model reads only the text."
                   % ", ".join(_place(p) for p in found[:3]))]


def blob_in_state(state: Any, questions: dict, refs: set) -> List[Finding]:
    rx = re.compile(r"data:[\w/+.-]+;base64,|[A-Za-z0-9+/]{200,}={0,2}")
    found = [path for path, text in _strings_at(state) if rx.search(text)]
    if not found:
        return []
    return [(None, "%s holds encoded data (base64), which the model reads as noise. Send pictures under Images, and leave "
                   "other binary data out." % _place(found[0]))]


def quoted_state_text(state: Any, questions: dict, refs: set) -> List[Finding]:
    sources = [(path, " ".join(text.split())) for path, text in _strings_at(state) if len(text) >= 30]
    out = []
    for qid, q in questions.items():
        hit = None
        for text in _texts(q):
            words = text.split()
            for i in range(len(words) - 5):
                chunk = " ".join(words[i:i + 6])
                if len(chunk) >= 30:
                    hit = next((path for path, source in sources if chunk in source), None)
                    if hit is not None:
                        break
            if hit is not None:
                break
        if hit is not None:
            out.append((qid, "The question copies text that is also in %s. Point at the field with backticks instead, so "
                             "the question stays the same when the input changes." % _place(hit).replace("The state", "the state")))
    return out


# ---------- pictures and Box ----------

def state_picture_not_carried(state: Any, questions: dict, refs: set) -> List[Finding]:
    found = [path for path, text in _strings_at(state) if PICTURE_REF.match(text.strip()) and text.strip() not in refs]
    if not found:
        return []
    return [(None, "%s holds what looks like a picture reference, but the request carries no picture by that name, so "
                   "the model reads it as text. Add the picture under Images, or remove the reference." % _place(found[0]))]


def _box_tokens(question: dict, state: Any, refs: set) -> set:
    text = " ".join(_texts(question))
    tokens = {ref for ref in refs if ref in text}
    for path in lint._paths(question):
        tokens.add(path)
        found, value = _lookup(state, path)
        if found:
            tokens.update(ref for ref in refs if ref in json.dumps(value))
    return tokens


def box_without_picture(state: Any, questions: dict, refs: set) -> List[Finding]:
    if refs:
        return []
    return [(qid, "A Box finds something in a picture, but the request carries none, so it cannot run. Add a picture "
                  "under Images and point at it.") for qid, q in questions.items() if q["type"] == "box"]


def box_names_no_picture(state: Any, questions: dict, refs: set) -> List[Finding]:
    if len(refs) < 2:
        return []
    return [(qid, "The request carries %d pictures, but this Box names none of them, so it is unclear where to look. "
                  "Point at the picture's field, such as `photo`." % len(refs))
            for qid, q in questions.items() if q["type"] == "box" and not (_box_tokens(q, state, refs) & refs)]


def box_many_targets(state: Any, questions: dict, refs: set) -> List[Finding]:
    # Only what the Box is asked to find, at the start of its description: "all the spilled beans", not "the largest
    # of all the bags".
    rx = re.compile(r"^\s*(?:(?:find|locate|mark|box|outline|show|draw)\s+)?(?:the\s+)?(all|every|each|both|several|multiple"
                    r"|many)\b", re.I)
    out = []
    for qid, q in questions.items():
        m = rx.search(" ".join(lint._QUOTED.sub(" ", t) for t in lint._strings(q.get("instructions")))) if q["type"] == "box" else None
        if m:
            out.append((qid, "A Box returns one rectangle, but the instructions ask for \"%s\". Ask for one thing, such as "
                             "the largest or the most visible, or use one Box each." % m.group(1).lower()))
    return out


def box_is_question(state: Any, questions: dict, refs: set) -> List[Finding]:
    return [(qid, "A Box takes a description of what to find, not a question. Write a noun phrase such as \"the torn "
                  "seam in `photo`\", and ask yes or no in a Noul.")
            for qid, q in questions.items() if q["type"] == "box" and isinstance(q.get("instructions"), str)
            and q["instructions"].rstrip().endswith("?")]


def box_without_noul(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    nouls = [q for q in questions.values() if q["type"] == "noul"]
    for qid, q in questions.items():
        if q["type"] != "box":
            continue
        tokens = _box_tokens(q, state, refs)
        if not any((_box_tokens(n, state, refs) & tokens) if tokens else True for n in nouls):
            out.append((qid, "A Box always returns four edges, even when the thing is not there. Add a Noul that asks "
                             "whether it is visible in the same picture, and use the box only when the Noul says yes."))
    return out


def picture_word_no_picture(state: Any, questions: dict, refs: set) -> List[Finding]:
    if refs:
        return []
    # Only a question that looks at a picture ("Is the bag in the photo torn?"); "Does `message` say the customer sent
    # a photo?" is about text.
    rx = re.compile(r"\b(?:in|on|from|of)\s+(?:the|this|that|each)\s+(photo|picture|image|screenshot|photograph)s?\b", re.I)
    out = []
    for qid, q in questions.items():
        m = rx.search(" ".join(lint._QUOTED.sub(" ", t) for t in lint._strings(q.get("instructions")))) if q["type"] != "box" else None
        if m:
            out.append((qid, "The question talks about a %s, but the request carries no picture, so the model answers "
                             "from the text alone. Add one under Images and point at it." % m.group(1).lower()))
    return out


def picture_repeated(state: Any, questions: dict, refs: set) -> List[Finding]:
    uses = Counter(images._uses(refs, [state, [q.get("instructions") for q in questions.values()],
                                       [q.get("criteria") for q in questions.values()]]))
    return [(None, "Picture `%s` appears %d times in the state and questions, and each appearance sends the image again. "
                   "Put it in one state field and point the questions at that field." % (ref, n))
            for ref, n in sorted(uses.items()) if n > 1]


def picture_unused(state: Any, questions: dict, refs: set) -> List[Finding]:
    out = []
    for ref in sorted(refs):
        if not any(ref in _box_tokens(q, state, {ref}) for q in questions.values()):
            out.append((None, "Picture `%s` is in the request, but no question points at it or at the field that holds it, "
                              "so it is sent without being asked about. Point a question at it, or remove it." % ref))
    return out


def _rule(ident: str, title: str, check, level: str = "advice", anchor: str = STATE) -> dict:
    return {"id": ident, "kind": "lint_rule", "title": title, "level": level, "check": check, "anchor": anchor}


PACK = kit.define_pack({
    "id": "lint-structure",
    "surface": "python.lint",
    "title": "State, paths, pictures and ids",
    "about": "Question checks on the structure of a request: question ids, what the backticked paths probably meant, "
             "the shape and content of the state, and pictures and Box questions.",
    "features": [
        _rule("id_not_snake_case", "Question ids that are not snake_case", id_not_snake_case, anchor=STRUCTURE),
        _rule("uninformative_id", "Question ids that say nothing about the question (q1, noul_2, test, x)", uninformative_id, anchor=STRUCTURE),
        _rule("ids_differ_by_case", "Question ids that differ only in case or separators", ids_differ_by_case, level="problem", anchor=STRUCTURE),
        _rule("id_collides_with_csv", "A question id that collides with a Bulk CSV column (row, label:...)", id_collides_with_csv, level="problem", anchor=STRUCTURE),
        _rule("id_unusable_in_rules", "A question id with a space or = < > that a consistency rule cannot name", id_unusable_in_rules, anchor=STRUCTURE),
        _rule("id_same_as_state_field", "A question id that is also a state field", id_same_as_state_field),
        _rule("array_path_without_index", "A path that steps into a list by field name, without an index", array_path_without_index),
        _rule("path_case_mismatch", "A missing path that matches a field in another case", path_case_mismatch),
        _rule("path_plural", "A missing path that matches a field in the singular or plural", path_plural),
        _rule("path_typo", "A missing path one letter away from a field", path_typo),
        _rule("path_index_off_by_one", "A list index one past the end (lists are numbered from 0)", path_index_off_by_one),
        _rule("path_too_deep", "A path that steps into a value that has no fields", path_too_deep),
        _rule("path_missing_parent", "A field name written without the object that holds it", path_missing_parent),
        _rule("path_syntax", "A path in other syntax ($.a.b, a[\"b\"], a/b, a -> b) the checks cannot read", path_syntax),
        _rule("refers_to_question", "A backticked name that is another question, not a state field", refers_to_question, anchor=DECOMPOSE),
        _rule("path_to_empty_value", "A path to an empty or null value", path_to_empty_value),
        _rule("link_as_data", "A path to a field that holds only a link", link_as_data),
        _rule("no_field_named", "A question that points at none of the state's fields", no_field_named),
        _rule("unticked_field", "A state field named as a plain word instead of a backticked path", unticked_field),
        _rule("unaddressable_field", "State fields whose names cannot be written as a path", unaddressable_field),
        _rule("state_keys_differ_by_case", "State fields that differ only in case or separators", state_keys_differ_by_case),
        _rule("deep_state", "A state nested more than six levels deep", deep_state),
        _rule("large_state", "A state over 20,000 characters as JSON", large_state),
        _rule("large_unreferenced_field", "A large state field that no question points at", large_unreferenced_field),
        _rule("empty_state_values", "Empty strings, nulls and empty lists or objects in the state", empty_state_values),
        _rule("row_marks_in_state", "Bulk row marks (_expect, _test, _image) left in a request state", row_marks_in_state, level="problem"),
        _rule("answer_in_state", "A state field named like the expected answer (label, answer, ground_truth)", answer_in_state),
        _rule("json_string_state", "JSON written inside a state string", json_string_state, anchor=STRUCTURE),
        _rule("markup_in_state", "HTML tags or entities in state text", markup_in_state),
        _rule("blob_in_state", "Base64 or data-URI blobs in state text", blob_in_state),
        _rule("quoted_state_text", "A question that copies state text instead of pointing at the field", quoted_state_text),
        _rule("state_picture_not_carried", "A picture reference in the state for a picture the request does not carry", state_picture_not_carried, level="problem"),
        _rule("box_without_picture", "A Box question in a request with no picture", box_without_picture, level="problem"),
        _rule("box_names_no_picture", "A Box that names none of several pictures", box_names_no_picture),
        _rule("box_many_targets", "A Box that asks for several things at once", box_many_targets, anchor=DECOMPOSE),
        _rule("box_is_question", "A Box written as a question instead of a description", box_is_question, anchor=STRUCTURE),
        _rule("box_without_noul", "A Box with no Noul asking whether the thing is there", box_without_noul, anchor=DECOMPOSE),
        _rule("picture_word_no_picture", "A question that looks \"in the photo\" in a request with no picture", picture_word_no_picture),
        _rule("picture_repeated", "A picture reference used more than once, which sends the image again", picture_repeated),
        _rule("picture_unused", "A picture no question points at", picture_unused),
    ],
})
