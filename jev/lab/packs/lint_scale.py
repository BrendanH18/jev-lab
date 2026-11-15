"""Question checks about scale and interchange: what a request costs on every row, and what survives the trip
through Review's CSV handoffs, rules and exported gates.

Every rule receives the validated questions (and the state and picture references, which these rules do not need)
and returns (question id or None, message) pairs. Plain code only.
"""

from __future__ import annotations

import re
from typing import Dict, List

from jev import lint
from jev.lab import kit

STRUCTURE = "#use-structure-in-the-questions"
DECOMPOSE = "#decompose-the-questions"
MAX_KEY_CHARS = 40
MAX_ID_CHARS = 40
MAX_QUESTIONS = 30
MAX_WORDS = 1500
_REWRITTEN = (
    (re.compile(r"(?i)true|false"), "becomes TRUE or FALSE"),
    (re.compile(r"0\d+"), "loses its leading zero"),
    (re.compile(r"\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?"), "becomes a date"),
    (re.compile(r"[+-]?\d+(?:\.\d+)?[eE][+-]?\d+"), "becomes a number in scientific notation"),
    (re.compile(r"[=+\-@].*", re.S), "gets a leading apostrophe so it is not run as a formula"),
)


def _choices(questions: Dict[str, dict]) -> Dict[str, dict]:
    return {qid: q for qid, q in questions.items() if q.get("type") == "choice" and isinstance(q.get("criteria"), dict)}


def _names(names: List[str]) -> str:
    return ", ".join("`%s`" % name for name in names)


def empty_option_key(state, questions, refs):
    return [(qid, "`%s` has an option with an empty key. A blank label cell means no label, so no row can ever be labeled "
                  "with it; give the option a key." % qid)
            for qid, q in _choices(questions).items() if any(str(key).strip() == "" for key in q["criteria"])]


def spreadsheet_rewritten_keys(state, questions, refs):
    out = []
    for qid, q in _choices(questions).items():
        found = []
        for key in q["criteria"]:
            for pattern, what in _REWRITTEN:
                if pattern.fullmatch(str(key)):
                    found.append("`%s` %s" % (key, what))
                    break
        if found:
            out.append((qid, "A spreadsheet rewrites option keys when it opens a Review or labeling CSV: %s, and the label no "
                             "longer matches on import. Use keys made of letters and underscores." % "; ".join(found)))
    return out


def long_option_key(state, questions, refs):
    out = []
    for qid, q in _choices(questions).items():
        long = [str(key) for key in q["criteria"] if len(str(key)) > MAX_KEY_CHARS]
        if long:
            out.append((qid, "%s %s over %d characters. Keys appear in labels, rules, CSV columns and exported gates; keep "
                             "them short and move the meaning into the description." % (_names(long), "is" if len(long) == 1 else "are",
                                                                                         MAX_KEY_CHARS)))
    return out


def long_question_id(state, questions, refs):
    return [(qid, "Question id `%s` is %d characters. Ids name label columns, rules and exported thresholds; keep them under "
                  "%d." % (qid, len(qid), MAX_ID_CHARS + 1)) for qid in questions if len(qid) > MAX_ID_CHARS]


def many_questions(state, questions, refs):
    if len(questions) <= MAX_QUESTIONS:
        return []
    return [(None, "The request asks %d questions. Every row pays for all of them; split questions that serve different "
                   "decisions into their own requests, and drop ones no gate or rule reads." % len(questions))]


def _words(question: dict) -> int:
    return sum(len(text.split()) for part in (question.get("instructions"), question.get("criteria")) for text in lint._strings(part))


def wordy_request(state, questions, refs):
    total = sum(_words(q) for q in questions.values())
    if total <= MAX_WORDS:
        return []
    top = sorted(questions, key=lambda qid: -_words(questions[qid]))[:3]
    return [(None, "The questions' instructions and criteria add up to %s words, sent with every row. The longest are %s."
             % (format(total, ","), _names(top)))]


def _stem(qid: str) -> str:
    low = re.sub(r"[\s_-]+", "_", qid.lower())
    for ending in ("ies", "es", "s"):
        if low.endswith(ending) and len(low) > len(ending) + 2:
            return low[:-len(ending)] + ("y" if ending == "ies" else "")
    return low


def similar_question_ids(state, questions, refs):
    groups: Dict[str, List[str]] = {}
    for qid in questions:
        groups.setdefault(_stem(qid), []).append(qid)
    out = []
    for qids in groups.values():
        loose = {re.sub(r"[\s_-]+", "", qid.lower()) for qid in qids}
        if len(qids) > 1 and len(loose) == len(qids):
            out.append((qids[0], "%s differ only by a plural ending, which is easy to confuse in rules, labels and gates."
                        % _names(qids)))
    return out


def same_instructions(state, questions, refs):
    groups: Dict[str, List[str]] = {}
    for qid, q in questions.items():
        text = lint._norm(q.get("instructions"))
        if text:
            groups.setdefault(text, []).append(qid)
    out = []
    for qids in groups.values():
        kinds = {(questions[qid]["type"], lint._norm(questions[qid].get("criteria"))) for qid in qids}
        if len(qids) > 1 and len(kinds) > 1:  # identical questions are the built-in same_question finding
            out.append((qids[0], "%s have the same instructions with different types or criteria, so each row pays twice for "
                                 "one question. Keep the one whose answer a decision reads." % _names(qids)))
    return out


def _rule(ident: str, title: str, check, level: str = "advice", anchor: str = STRUCTURE) -> dict:
    return {"id": ident, "kind": "lint_rule", "title": title, "level": level, "check": check, "anchor": anchor}


PACK = kit.define_pack({
    "id": "lint-scale",
    "surface": "python.lint",
    "title": "Scale and interchange",
    "about": "Question checks about what a request costs on every row (many questions, many words, repeated questions) "
             "and what survives Review's CSV handoffs, rules and exported gates (empty, rewritten or long keys and ids).",
    "features": [
        _rule("empty_option_key", "A Choice option with an empty key, which no label can name", empty_option_key, level="problem"),
        _rule("spreadsheet_rewritten_keys", "Option keys a spreadsheet rewrites (true, 007, 1/2, 1e5, =x)", spreadsheet_rewritten_keys),
        _rule("long_option_key", "Option keys over 40 characters", long_option_key),
        _rule("long_question_id", "Question ids over 40 characters", long_question_id),
        _rule("many_questions", "More than 30 questions in one request", many_questions, anchor=DECOMPOSE),
        _rule("wordy_request", "Instructions and criteria adding up to over 1,500 words", wordy_request),
        _rule("similar_question_ids", "Question ids that differ only by a plural ending (refund, refunds)", similar_question_ids),
        _rule("same_instructions", "Two questions with the same instructions but different types or criteria", same_instructions,
              anchor=DECOMPOSE),
    ],
})
