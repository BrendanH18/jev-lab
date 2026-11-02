"""Rules: what answers to one row may say together, checked in code over answers Bulk already returned.

Each question is asked on its own, so nothing stops a row from coming back as wants_refund = yes with
department = none. A person who knows the business can say that cannot be right:

    if wants_refund = yes then department in billing, shipping
    if department = none then is_urgent = no
    if frustration >= 2 then is_urgent = yes

A row breaks a rule when every condition after `if` holds and some condition after `then` does not. A broken
rule means at least one of its answers is wrong, or the rule is, so rows that break one are worth a look even
when nobody labeled them. Where rows are labeled, report() says how often the answers on rows that break each
rule are wrong, against rows the rule applies to and keeps, and whether the labels themselves break it (then
the rule is wrong, not the answers). Policy can send rows that break a rule to review (policy.py, `rules`).

Conditions compare an answer as Calibrate reads it: a Choice's selected option, a Noul's yes or no (P(yes) >=
0.5), and a Score's most likely level. Operators: `=`, `!=`, `in a, b`, `not in a, b`, and for Score levels
`>=`, `<=`, `>`, `<`. Several conditions join with `and`. A line starting with `#` is a comment. A row whose
answer to a rule's question is missing or unreadable cannot be checked against that rule, and Policy holds it.

Everything here is plain code: it makes no model calls.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from . import calibrate
from .calibrate import CalibrationError

MAX_RULES = 20
MAX_CHARS = 4000
TYPES = ("choice", "noul", "score")
ORDERED = (">=", "<=", ">", "<")
_LINE = re.compile(r"^\s*if\s+(.+?)\s+then\s+(.+?)\s*$", re.IGNORECASE)
_COND = re.compile(r"^(\S+?)\s*(>=|<=|!=|=|>|<|\s+not\s+in\s+|\s+in\s+)\s*(.+)$", re.IGNORECASE)
_AND = re.compile(r"\s+and\s+", re.IGNORECASE)

Cond = Tuple[str, str, List[str]]  # (question id, operator, values)


def _cond(text: str) -> Cond:
    m = _COND.match(text.strip())
    if not m:
        raise ValueError("%r is not a condition such as `department = billing` or `department in billing, shipping`"
                         % text.strip())
    qid, op, rest = m.group(1), " ".join(m.group(2).lower().split()), m.group(3).strip()
    values = [v.strip() for v in rest.split(",")] if op in ("in", "not in") else [rest]
    if not all(values):
        raise ValueError("%r has an empty value" % text.strip())
    return qid, op, values


def parse(text: Any) -> List[dict]:
    """Rules from text, one per line, as [{"line", "text", "if": [cond], "then": [cond]}]. CalibrationError names
    the first line that does not parse."""
    if text in (None, ""):
        return []
    if not isinstance(text, str):
        raise CalibrationError("rules must be text, one rule per line")
    if len(text) > MAX_CHARS:
        raise CalibrationError("Rules are limited to %d characters" % MAX_CHARS)
    out = []
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = _LINE.match(line)
        try:
            if not m:
                raise ValueError("write it as `if <condition> then <condition>`")
            out.append({"line": number, "text": line.strip(),
                        "if": [_cond(c) for c in _AND.split(m.group(1))],
                        "then": [_cond(c) for c in _AND.split(m.group(2))]})
        except ValueError as err:
            raise CalibrationError("Rule on line %d: %s" % (number, err)) from err
    if len(out) > MAX_RULES:
        raise CalibrationError("At most %d rules" % MAX_RULES)
    return out


def kinds_from_questions(questions: Dict[str, dict]) -> Dict[str, Tuple[str, List[str]]]:
    """{qid: (type, the answers it can give as Calibrate shows them)} for Choice, Noul, and Score questions."""
    out = {}
    for qid, q in questions.items():
        if not isinstance(q, dict):
            continue
        if q.get("type") == "noul":
            out[qid] = ("noul", ["yes", "no"])
        elif q.get("type") == "choice":
            out[qid] = ("choice", [str(k) for k in q.get("criteria") or {}])
        elif q.get("type") == "score":
            out[qid] = ("score", [str(i) for i in range(len(q.get("criteria") or []))])
    return out


def kinds_from_answers(rows: List[dict]) -> Dict[str, Tuple[str, List[str]]]:
    """The same, from answers: rows as Policy takes them, [{"answers": {qid: answer}}]."""
    out: Dict[str, Tuple[str, List[str]]] = {}
    for row in rows:
        for qid, answer in (row.get("answers") or {}).items():
            if qid in out or not isinstance(answer, dict) or answer.get("type") not in TYPES:
                continue
            try:
                out[qid] = (answer["type"], calibrate._classes(answer["type"], answer))
            except (TypeError, ValueError, AttributeError):
                continue
    return out


def check(rules: List[dict], kinds: Dict[str, Tuple[str, List[str]]]) -> None:
    """CalibrationError when a rule names a question these answers lack, or an answer its question cannot give.

    It also writes a Noul condition's values as yes or no in place (`true` -> `yes`), by the question's kind, so a
    condition then compares an answer literally: a Choice option named `true` stays itself. Check rules before
    evaluating them."""
    for rule in rules:
        for side in ("if", "then"):
            rule[side] = [(q, op, [_yes_no(v) for v in vs] if kinds.get(q, ("",))[0] == "noul" else vs)
                          for q, op, vs in rule[side]]
        for qid, op, values in rule["if"] + rule["then"]:
            where = "Rule on line %d" % rule["line"]
            if qid not in kinds:
                raise CalibrationError("%s: %r is not a Choice, Noul, or Score question here" % (where, qid))
            qtype, allowed = kinds[qid]
            if op in ORDERED and qtype != "score":
                raise CalibrationError("%s: %s compares levels, so it needs a Score question; %r is a %s"
                                       % (where, op, qid, qtype))
            for v in values:
                if v not in allowed:
                    raise CalibrationError("%s: %r cannot answer %r; it answers %s"
                                           % (where, qid, v, ", ".join(allowed)))


def _yes_no(value: str) -> str:
    low = value.lower()
    return "yes" if low in ("yes", "true", "y", "1") else "no" if low in ("no", "false", "n", "0") else value


def _holds(cond: Cond, shown: Dict[str, str]) -> Optional[bool]:
    qid, op, values = cond
    if qid not in shown:
        return None
    value = shown[qid]
    if op in ORDERED:
        a, b = int(value), int(values[0])
        return {">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b}[op]
    return (value in values) if op in ("=", "in") else (value not in values)


def broken(rule: dict, shown: Dict[str, str]) -> Optional[bool]:
    """Whether answers shown as {qid: answer} break the rule; None when a needed answer is missing."""
    conds = [_holds(c, shown) for c in rule["if"]]
    if False in conds:
        return False
    outcome = [_holds(c, shown) for c in rule["then"]]
    if None in conds:
        return None
    if False in outcome:
        return True
    return None if None in outcome else False


def questions(rule: dict) -> List[str]:
    return list(dict.fromkeys(q for q, _, _ in rule["if"] + rule["then"]))


def shown_answers(answers: Dict[str, Any], qids: List[str]) -> Dict[str, str]:
    """{qid: answer as Calibrate shows it} for the readable answers among qids."""
    out = {}
    for qid in qids:
        answer = answers.get(qid)
        if not isinstance(answer, dict):
            continue
        try:
            out[qid] = calibrate.read(answer)[0]
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    return out


def holding(rules: List[dict], answers: Dict[str, Any]) -> List[int]:
    """The line numbers of the rules a row's answers break, or cannot be checked against."""
    qids = list(dict.fromkeys(q for r in rules for q in questions(r)))
    shown = shown_answers(answers, qids)
    return [r["line"] for r in rules if broken(r, shown) is not False]


def _labels_shown(answers: Dict[str, Any], labels: Dict[str, Any], qids: List[str]) -> Optional[Dict[str, str]]:
    """{qid: label as Calibrate shows it} when every qid has a usable label, else None."""
    out = {}
    for qid in qids:
        answer, raw = answers.get(qid), labels.get(qid)
        if raw in (None, "") or not isinstance(answer, dict):
            return None
        try:
            out[qid] = calibrate._show(answer["type"], calibrate._label(answer["type"], raw, answer))
        except (KeyError, TypeError, ValueError, AttributeError):
            return None
    return out


def report(text: Any, rows: Any, question_set: Any = None) -> dict:
    """rows: [{"index", "answers": {qid: answer}, "labels": {qid: label}}], as Policy takes them. question_set: the
    Bulk questions, to check the rules against; without it, the answers' own options and levels are used.

    For each rule: how many rows it applies to (every `if` holds), which of them break it, how many rows cannot
    be checked, and on rows labeled for all of the rule's questions, how often some answer to those questions is
    wrong when the row breaks the rule and when it keeps it, with Fisher's exact test, and how many rows' labels
    break it."""
    from .drift import fisher_exact  # drift imports policy, which imports this module

    rules = parse(text)
    if not isinstance(rows, list):
        raise CalibrationError("rows must be a list")
    if len(rows) > calibrate.MAX_ROWS:
        raise CalibrationError("At most %d rows" % calibrate.MAX_ROWS)
    rows = [r for r in rows if isinstance(r, dict) and isinstance(r.get("answers"), dict)]
    kinds = kinds_from_questions(question_set) if isinstance(question_set, dict) else kinds_from_answers(rows)
    check(rules, kinds)
    out_rules = []
    any_broken = set()
    for rule in rules:
        qids = questions(rule)
        applies = kept_n = broken_n = unknown = 0
        broken_rows: List[int] = []
        labeled = {"broken": [0, 0], "kept": [0, 0]}  # [rows, rows with a wrong answer]
        labels_break: List[int] = []
        for row in rows:
            labels = row.get("labels") if isinstance(row.get("labels"), dict) else {}
            truth = _labels_shown(row["answers"], labels, qids)
            if truth is not None and broken(rule, truth):  # the labels' own verdict, whatever the answers say
                labels_break.append(row.get("index"))
            shown = shown_answers(row["answers"], qids)
            result = broken(rule, shown)
            if result is None:
                unknown += 1
                continue
            if not all(_holds(c, shown) for c in rule["if"]):
                continue
            applies += 1
            if result:
                broken_n += 1
                broken_rows.append(row.get("index"))
                any_broken.add(row.get("index"))
            else:
                kept_n += 1
            if truth is None:
                continue
            side = labeled["broken" if result else "kept"]
            side[0] += 1
            side[1] += any(shown[q] != truth[q] for q in qids)
        (bn, bw), (kn, kw) = labeled["broken"], labeled["kept"]
        out_rules.append({
            "line": rule["line"], "text": rule["text"], "questions": qids,
            "applies": applies, "broken": broken_n, "kept": kept_n, "unknown": unknown, "broken_rows": broken_rows,
            "labeled_broken": bn, "wrong_broken": bw, "labeled_kept": kn, "wrong_kept": kw,
            "wrong_broken_rate": bw / bn if bn else None, "wrong_kept_rate": kw / kn if kn else None,
            "p": fisher_exact(bw, bn - bw, kw, kn - kw) if bn and kn else None,
            "labels_break": labels_break,
        })
    return {"rules": out_rules, "rows": len(rows), "broken_any": len(any_broken),
            "broken_rows": sorted(i for i in any_broken if isinstance(i, int))}
