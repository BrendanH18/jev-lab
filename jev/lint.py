"""Question checks: read a request's questions for common mistakes before any call is paid for.

Every check is plain code, so it makes no model calls and costs nothing. Each finding names the
question it is about, says what to change, and points at the part of TypeSafe's guide, How to build
with System One, that the advice comes from. A finding has one of two levels:

  * problem: almost certainly a mistake. A backticked path the state does not have, so the model
    cannot see what the question points at; two questions that ask the same thing; two options or
    levels the model cannot tell apart because their descriptions are the same.
  * advice: a pattern the guide recommends against, which may still be what you meant. A question
    that asks more than one thing, long instructions, options described with different fields, a
    Noul with no yes/no criteria, an option left undescribed beside described ones, or a text state with "Key: value"
    lines that would be clearer as JSON fields.

Checks are heuristics over text, so advice can be wrong about a question that works. Run the
question and look at the answers before rewriting one that the checks question.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

GUIDE = "https://docs.typesafe.ai/concepts/how-to-build-with-system-one"
LEVELS = ("problem", "advice")
LONG_WORDS = 60  # string instructions longer than this read as more than one short question
KEY_VALUE_LINES = 2  # a text state with this many "Key: value" lines holds fields

# A backticked token that reads as a state path: a field name, then .field, .0, or [0] steps.
_PATH = re.compile(r"[A-Za-z_][\w-]*(?:\.[\w-]+|\[\d+\])*")
_TICKED = re.compile(r"`([^`\n]+)`")
_STEP = re.compile(r"\.([\w-]+)|\[(\d+)\]")
# Quoted text is data the question carries, such as a search query, so its question marks do not count.
_QUOTED = re.compile(r"“[^”]*”|‘[^’]*’|\"[^\"]*\"|(?<!\w)'[^'\n]*'(?!\w)|`[^`]*`")
_KEY_VALUE = re.compile(r"^\s*[A-Z][\w ./-]{0,30}:[ \t]+\S", re.M)


def _finding(level: str, code: str, question: Optional[str], message: str, anchor: str = "") -> dict:
    return {"level": level, "code": code, "question": question, "message": message, "guide": GUIDE + anchor}


def _strings(value: Any) -> Iterable[str]:
    """Every string inside an instruction or criterion, which may be structured (objects and arrays)."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _norm(value: Any) -> str:
    """A description for comparing: case, spacing, and punctuation ignored in text; field names (in any order),
    numbers, and structure kept, so criteria that differ only in a field or a number stay different."""
    if isinstance(value, str):
        return " ".join(re.sub(r"[^\w`]+", " ", value.lower()).split())
    if isinstance(value, dict):
        return "{%s}" % ", ".join("%s: %s" % (key, _norm(item)) for key, item in sorted(value.items())) if value else ""
    if isinstance(value, list):
        return "[%s]" % " | ".join(_norm(item) for item in value) if value else ""
    return "" if value is None else json.dumps(value)


def _resolve(value: Any, path: str) -> bool:
    """Whether `path` names something in `value`. A field name may itself contain dots."""
    if path == "":
        return True
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str) or not path.startswith(key):
                continue
            rest = path[len(key):]
            if rest == "" or rest[0] in ".[":
                if _resolve(value[key], rest[1:] if rest.startswith(".") else rest):
                    return True
        return False
    if isinstance(value, list):
        step = re.match(r"\[(\d+)\]|(\d+)(?=$|[.\[])", path)
        if not step:
            return False
        index = int(step.group(1) or step.group(2))
        rest = path[step.end():]
        return index < len(value) and _resolve(value[index], rest[1:] if rest.startswith(".") else rest)
    return False


def _paths(question: dict) -> List[str]:
    found = []
    for text in _strings([question.get("instructions"), question.get("criteria")]):
        for token in _TICKED.findall(text):
            token = token.strip()
            if _PATH.fullmatch(token) and token not in found:
                found.append(token)
    return found


def _missing_paths(qid: str, question: dict, state: Any, refs: set) -> List[dict]:
    out = []
    for path in _paths(question):
        if path in refs or _resolve(state, path):
            continue
        if isinstance(state, (dict, list)):
            message = ("`%s` is not in the state, so the model cannot see what this question points at. "
                       "Add the field, or fix the path." % path)
        else:
            message = ("`%s` names a field, but the state is text, which has no fields. Make the state a JSON object "
                       "with a field named `%s`, or remove the backticks." % (path, path.split(".")[0].split("[")[0]))
        out.append(_finding("problem", "missing_path", qid, message, "#use-structure-in-the-input-state"))
    return out


def _question_text(instructions: Any) -> Optional[str]:
    return instructions if isinstance(instructions, str) else None


def _instructions(qid: str, question: dict) -> List[dict]:
    text = _question_text(question.get("instructions"))
    if text is None:
        return []
    out = []
    marks = _QUOTED.sub("", text).count("?")
    if marks > 1:
        out.append(_finding("advice", "several_questions", qid,
                            "The instructions ask %d questions. Ask one narrow question each, and split the rest into "
                            "their own questions in the same request." % marks, "#decompose-the-questions"))
    words = len(text.split())
    if words > LONG_WORDS:
        out.append(_finding("advice", "long_instructions", qid,
                            "The instructions run to %d words. Keep the question short, and move guidance into the "
                            "criteria, or into structured instructions." % words, "#use-structure-in-the-questions"))
    return out


def _repeats(values: List[Tuple[str, Any]]) -> List[List[str]]:
    """Groups of names whose descriptions are the same once case and punctuation are ignored."""
    groups: Dict[str, List[str]] = {}
    for name, value in values:
        key = _norm(value)
        if key:
            groups.setdefault(key, []).append(name)
    return [names for names in groups.values() if len(names) > 1]


def _criteria(qid: str, question: dict) -> List[dict]:
    qtype, criteria, out = question["type"], question.get("criteria"), []
    if qtype == "choice":
        # Options with self-explaining keys, such as weekdays or line IDs, may all go undescribed. One described
        # option among undescribed ones, or the reverse, usually means a description was forgotten.
        empty = [key for key, about in criteria.items() if about in (None, "", {}, [])]
        if empty and len(empty) < len(criteria):
            out.append(_finding("advice", "undescribed_option", qid,
                                "%s %s no description, but the other options do. Unless a key says all it covers, "
                                "describe it: what it covers, what it is not for, and an example." % (_names(empty), "has" if len(empty) == 1 else "have"),
                                "#use-structure-in-the-questions"))
        for same in _repeats(list(criteria.items())):
            out.append(_finding("problem", "same_options", qid,
                                "%s have the same description, so the model cannot tell them apart. Describe how they "
                                "differ, or merge them." % _names(same), "#use-structure-in-the-questions"))
        described = [about for about in criteria.values() if about not in (None, "", {}, [])]
        shapes = {tuple(sorted(about)) if isinstance(about, dict) else type(about).__name__ for about in described}
        if any(isinstance(about, dict) for about in described) and len(shapes) > 1:
            out.append(_finding("advice", "mixed_option_fields", qid,
                                "The options are described with different fields. Use the same field names for every "
                                "option, so the model can compare them directly.", "#use-structure-in-the-questions"))
    elif qtype == "score":
        for same in _repeats([("level %d" % i, level) for i, level in enumerate(criteria)]):
            out.append(_finding("problem", "same_levels", qid,
                                "%s have the same description, so the model cannot tell them apart. Describe what "
                                "changes from one level to the next." % _names(same), "#use-structure-in-the-questions"))
    elif qtype == "noul":
        given = criteria or {}
        if given.get("true") in (None, "") or given.get("false") in (None, ""):
            out.append(_finding("advice", "noul_criteria", qid,
                                "Say what a yes means and what a no means, in true and false criteria, with examples of "
                                "each.", "#use-structure-in-the-questions"))
    return out


def _names(names: List[str]) -> str:
    quoted = ["`%s`" % name if not name.startswith("level ") else name for name in names]
    if len(quoted) == 1:
        return quoted[0]
    return ", ".join(quoted[:-1]) + " and " + quoted[-1]


def _duplicates(questions: Dict[str, dict]) -> List[dict]:
    groups: Dict[tuple, List[str]] = {}
    for qid, q in questions.items():
        groups.setdefault((q["type"], _norm(q.get("instructions")), _norm(q.get("criteria"))), []).append(qid)
    out = []
    for (_type, text, _crit), qids in groups.items():
        if text and len(qids) > 1:
            out.append(_finding("problem", "same_question", qids[0],
                                "%s ask the same thing with the same criteria, so they pay for the same answer twice. "
                                "Remove one, or add the data that makes each one distinct." % _names(qids), "#decompose-the-questions"))
    return out


def _state(state: Any) -> List[dict]:
    if not isinstance(state, str):
        return []
    lines = len(_KEY_VALUE.findall(state))
    if lines < KEY_VALUE_LINES:
        return []
    return [_finding("advice", "fields_in_text", None,
                     "The state is text with %d \"Key: value\" lines. Put each value in its own field of a JSON object, "
                     "and point questions at the fields with backticks." % lines, "#use-structure-in-the-questions")]


def check(state: Any, questions: Dict[str, dict], image_refs: Iterable[str] = ()) -> dict:
    """Findings for already-validated questions. `image_refs` are picture references, which are not state paths."""
    refs = set(image_refs)
    findings = _state(state) + _duplicates(questions)
    for qid, q in questions.items():
        findings += _missing_paths(qid, q, state, refs) + _instructions(qid, q) + _criteria(qid, q)
    order = {qid: i for i, qid in enumerate(questions)}
    findings.sort(key=lambda f: (LEVELS.index(f["level"]), -1 if f["question"] is None else order.get(f["question"], 0)))
    counts = {level: sum(f["level"] == level for f in findings) for level in LEVELS}
    return {"findings": findings, "counts": counts, "guide": GUIDE}
