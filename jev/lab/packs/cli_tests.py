"""Offline commands for saved Workbench tests (data/workbench/*.json): list, outline, expectation coverage and
checks, question ids shared with different definitions, a question inventory, search, state shapes and the
question checks. Read only: saved tests are loaded through jev.workbench and never written, and no answer is
shown, because saved tests hold none."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from jev import lint, workbench
from jev.lab import kit

TYPES = workbench.QUESTION_TYPES
FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}


# ---------- reading saved tests ----------


def _tests() -> List[dict]:
    """Saved tests sorted by id. Files that are not test objects are skipped."""
    items = [item for item in workbench.list_items() if isinstance(item, dict) and isinstance(item.get("id"), str)]
    return sorted(items, key=lambda item: item["id"])


def _load(test_id: str) -> dict:
    item = workbench.load_item(test_id)
    if not isinstance(item, dict):
        raise kit.CliError("saved test %r is not a JSON object" % test_id)
    if not isinstance(item.get("id"), str):
        item = dict(item, id=test_id)
    return item


def _questions(item: dict) -> Dict[str, dict]:
    raw = item.get("questions")
    if not isinstance(raw, dict):
        return {}
    return {qid: q for qid, q in raw.items() if isinstance(q, dict)}


def _expect(item: dict) -> Dict[str, Any]:
    raw = item.get("expect")
    return raw if isinstance(raw, dict) else {}


def _covered(item: dict) -> List[str]:
    """Question ids with an expectation."""
    expect = _expect(item)
    return [qid for qid in _questions(item) if qid in expect]


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _words(value: Any) -> int:
    return sum(len(text.split()) for text in _strings(value))


def _entries(question: dict) -> List[Tuple[str, Any]]:
    criteria = question.get("criteria")
    if question.get("type") == "score" and isinstance(criteria, list):
        return [(str(index), level) for index, level in enumerate(criteria)]
    if isinstance(criteria, dict):
        return list(criteria.items())
    return []


def _criteria_count(question: dict) -> int:
    """Choice options, Score levels, or the Noul true/false criteria that say something; a Box has none."""
    entries = _entries(question)
    if question.get("type") == "noul":
        return sum(value not in (None, "", {}, []) for _key, value in entries)
    return len(entries)


def _type_summary(questions: Dict[str, dict]) -> str:
    counts = [(qtype, sum(q.get("type") == qtype for q in questions.values())) for qtype in TYPES]
    return ", ".join("%d %s" % (count, qtype) for qtype, count in counts if count)


def _number(value: Any) -> Optional[float]:
    """A value as the Workbench's expectation check reads it (it calls float()), or None when float() would fail."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def _percent(part: int, whole: int) -> int:
    """part / whole as a whole percent, halves rounded up (exact integer arithmetic)."""
    return (200 * part + whole) // (2 * whole)


def _expect_text(expect: Any) -> str:
    """What an expectation asks for, in words."""
    if not isinstance(expect, dict):
        return "?"
    if "box" in expect:
        return "box, IoU >= %s" % kit.cell_text(expect.get("iou_min", 0.5))
    parts = []
    if "choice" in expect:
        parts.append("choice = %s" % expect["choice"])
    if "min" in expect:
        parts.append(">= %s" % kit.cell_text(expect["min"]))
    if "max" in expect:
        parts.append("<= %s" % kit.cell_text(expect["max"]))
    return ", ".join(parts) or "none"


def _state_kind(state: Any) -> str:
    if isinstance(state, str):
        return "text"
    if isinstance(state, dict):
        return "object"
    if isinstance(state, list):
        return "array"
    return "other"


def _state_bytes(state: Any) -> int:
    text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    return len(text.encode("utf-8"))


def _table_or(args: Any, columns: List[str], rows: List[list], empty: str) -> None:
    if not rows and getattr(args, "format", "table") == "table":
        print(empty)
    else:
        kit.emit(args, columns, rows)


# ---------- tests list ----------


def _configure_list(parser: Any) -> None:
    parser.add_argument("--sort", choices=("id", "name", "questions", "expected", "saved"), default="id",
                        help="order by id (default), name, most questions, most expectations, or newest first")
    parser.add_argument("--reverse", action="store_true", help="reverse the order")
    parser.add_argument("--type", choices=TYPES, help="only tests with a question of this type")
    parser.add_argument("--min-questions", type=int, default=0, metavar="N", help="only tests with at least N questions")
    parser.add_argument("--uncovered", action="store_true", help="only tests with a question that has no expectation")
    parser.add_argument("--name", metavar="TEXT", help="only tests whose id or name contains TEXT (any case)")
    parser.add_argument("--limit", type=int, metavar="N", help="at most N tests, after sorting")
    kit.add_format(parser)


def run_list(args: Any) -> int:
    picked = []
    for item in _tests():
        questions = _questions(item)
        if args.type and not any(q.get("type") == args.type for q in questions.values()):
            continue
        if len(questions) < args.min_questions:
            continue
        if args.uncovered and len(_covered(item)) == len(questions):
            continue
        if args.name and not any(args.name.lower() in str(text).lower() for text in (item["id"], item.get("name") or "")):
            continue
        picked.append([item["id"], str(item.get("name") or ""), len(questions), len(_covered(item)), _type_summary(questions), str(item.get("saved_at") or "")])
    keys = {"id": lambda row: row[0], "name": lambda row: (row[1].lower(), row[0]), "questions": lambda row: (-row[2], row[0]),
            "expected": lambda row: (-row[3], row[0])}
    if args.sort == "saved":
        picked.sort(key=lambda row: row[0])
        picked.sort(key=lambda row: row[5], reverse=True)
    else:
        picked.sort(key=keys[args.sort])
    if args.reverse:
        picked.reverse()
    if args.limit is not None:
        picked = picked[:max(0, args.limit)]
    _table_or(args, ["id", "name", "questions", "expected", "types", "saved"], picked, "no saved tests match")
    return 0


# ---------- tests show ----------


def _configure_show(parser: Any) -> None:
    parser.add_argument("id", help="a saved test id")
    parser.add_argument("--type", choices=TYPES, help="only questions of this type")
    parser.add_argument("--criteria", action="store_true", help="one row per criterion instead of one per question")
    kit.add_format(parser)


def run_show(args: Any) -> int:
    item = _load(args.id)
    questions = _questions(item)
    expect = _expect(item)
    picked = [(position, qid, q) for position, (qid, q) in enumerate(questions.items(), 1) if not args.type or q.get("type") == args.type]
    if args.format == "table":
        pictures = sorted((item.get("images") or {}).keys()) if isinstance(item.get("images"), dict) else []
        print("%s (%s)" % (item.get("name") or item["id"], item["id"]))
        print("state: %s, %d bytes" % (_state_kind(item.get("state")), _state_bytes(item.get("state"))))
        print("pictures: %s" % (", ".join(pictures) or "none"))
        print()
    if args.criteria:
        rows = [[qid, q.get("type"), key, _words(value)] for _position, qid, q in picked for key, value in _entries(q)]
        kit.emit(args, ["question", "type", "key", "words"], rows)
    else:
        rows = [[position, qid, q.get("type"), _criteria_count(q), _words(q.get("instructions")), _expect_text(expect[qid]) if qid in expect else ""]
                for position, qid, q in picked]
        kit.emit(args, ["#", "question", "type", "criteria", "words", "expected"], rows)
    return 0


# ---------- tests coverage ----------


def _configure_coverage(parser: Any) -> None:
    parser.add_argument("--below", type=float, metavar="PCT", help="only tests whose coverage is under PCT percent; exit 1 if any")
    parser.add_argument("--missing", action="store_true", help="one row per question that has no expectation")
    parser.add_argument("--type", choices=TYPES, help="count only questions of this type")
    kit.add_format(parser)


def run_coverage(args: Any) -> int:
    rows, missing = [], []
    for item in _tests():
        questions = {qid: q for qid, q in _questions(item).items() if not args.type or q.get("type") == args.type}
        if not questions:
            continue
        covered = [qid for qid in questions if qid in _expect(item)]
        uncovered = [qid for qid in questions if qid not in covered]
        if args.below is not None and not 100.0 * len(covered) / len(questions) < args.below:
            continue
        rows.append([item["id"], len(questions), len(covered), ", ".join(uncovered), _percent(len(covered), len(questions))])
        missing += [[item["id"], qid, questions[qid].get("type")] for qid in uncovered]
    if args.missing:
        _table_or(args, ["test", "question", "type"], missing, "every question has an expectation")
    else:
        _table_or(args, ["id", "questions", "expected", "missing", "coverage %"], rows, "no saved tests match")
    return 1 if args.below is not None and rows else 0


# ---------- tests expectations ----------


def _expectation_problems(questions: Dict[str, dict], expect: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Expectations that name no question, do not fit their question's type, or can never pass."""
    out = []
    for qid, spec in expect.items():
        question = questions.get(qid)
        if question is None:
            out.append((qid, "names no question in this test"))
            continue
        if not isinstance(spec, dict):
            out.append((qid, "is not an object"))
            continue
        qtype = question.get("type")
        if "box" in spec or qtype == "box":
            if qtype != "box":
                out.append((qid, "expects a box, but the question is a %s" % qtype))
                continue
            if "box" not in spec:
                continue
            box = spec["box"] if isinstance(spec["box"], dict) else {}
            edges = [_number(box.get(edge)) for edge in workbench.EDGES]
            if any(edge is None or not 0 <= edge <= 1 for edge in edges):
                out.append((qid, "the box needs left, top, right and bottom between 0 and 1"))
            elif edges[0] >= edges[2] or edges[1] >= edges[3]:
                out.append((qid, "the box has no area: left must be below right and top below bottom"))
            floor = _number(spec.get("iou_min", 0.5))
            if floor is None:
                out.append((qid, "iou_min is not a number"))
            elif floor > 1:
                out.append((qid, "iou_min %s is above 1, the highest overlap, so it can never pass" % kit.cell_text(floor)))
            continue
        if "choice" in spec:
            options = question.get("criteria") if isinstance(question.get("criteria"), dict) else {}
            if qtype != "choice":
                out.append((qid, "expects a choice, but the question is a %s" % qtype))
            elif not isinstance(spec["choice"], str) or spec["choice"] not in options:
                out.append((qid, "expects the choice %r, which is not one of the question's options" % (spec["choice"],)))
        low, high = spec.get("min"), spec.get("max")
        for name, value in (("min", low), ("max", high)):
            if value is not None and _number(value) is None:
                out.append((qid, "%s is not a number" % name))
        low, high = _number(low), _number(high)
        levels = question.get("criteria")
        top = (1.0 if qtype in ("noul", "choice")
               else float(len(levels) - 1) if qtype == "score" and isinstance(levels, list) and len(levels) >= 2 else None)
        if low is not None and high is not None and low > high:
            out.append((qid, "min %s is above max %s, so it can never pass" % (kit.cell_text(low), kit.cell_text(high))))
        if low is not None and top is not None and low > top:
            out.append((qid, "min %s is above the highest possible value, %s, so it can never pass" % (kit.cell_text(low), kit.cell_text(top))))
        if high is not None and high < 0:
            out.append((qid, "max %s is below 0, so it can never pass" % kit.cell_text(high)))
    return out


def _configure_expectations(parser: Any) -> None:
    parser.add_argument("--test", metavar="ID", help="check only this saved test")
    kit.add_format(parser)


def run_expectations(args: Any) -> int:
    items = [_load(args.test)] if args.test else _tests()
    rows = [[item["id"], qid, message] for item in items for qid, message in _expectation_problems(_questions(item), _expect(item))]
    _table_or(args, ["test", "question", "problem"], rows, "no expectation problems")
    return 1 if rows else 0


# ---------- tests conflicts and inventory ----------


def _normal(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(value.lower().split())
    if isinstance(value, dict):
        return {key: _normal(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normal(item) for item in value]
    return value


def _definition(question: dict, normalize: bool) -> str:
    instructions, criteria = question.get("instructions"), question.get("criteria")
    if normalize:
        instructions, criteria = _normal(instructions), _normal(criteria)
    return json.dumps([question.get("type"), instructions, criteria], ensure_ascii=False)


def _occurrences() -> Dict[str, List[Tuple[dict, dict]]]:
    """question id -> [(test, question)] in test id order."""
    out: Dict[str, List[Tuple[dict, dict]]] = {}
    for item in _tests():
        for qid, question in _questions(item).items():
            out.setdefault(qid, []).append((item, question))
    return out


def _configure_conflicts(parser: Any) -> None:
    parser.add_argument("--types-only", action="store_true", help="only question ids whose type differs between tests")
    parser.add_argument("--normalize", action="store_true", help="ignore differences of case and spacing in the text")
    parser.add_argument("--detail", action="store_true", help="one row per test that uses a conflicting question id")
    kit.add_format(parser)


def run_conflicts(args: Any) -> int:
    rows, detail = [], []
    for qid, uses in sorted(_occurrences().items()):
        variants: Dict[str, List[Tuple[dict, dict]]] = {}
        for item, question in uses:
            variants.setdefault(_definition(question, args.normalize), []).append((item, question))
        if len(variants) < 2:
            continue
        groups = list(variants.values())
        types = {question.get("type") for _item, question in uses}
        if args.types_only and len(types) < 2:
            continue
        if len(types) > 1:
            difference = "type"
        else:
            parts = []
            for field in ("instructions", "criteria"):
                seen = {json.dumps(_normal(group[0][1].get(field)) if args.normalize else group[0][1].get(field)) for group in groups}
                if len(seen) > 1:
                    parts.append(field)
            difference = ", ".join(parts)
        rows.append([qid, len(groups), " / ".join(", ".join(item["id"] for item, _question in group) for group in groups), difference])
        detail += [[qid, number, item["id"], question.get("type"), _criteria_count(question), _words(question.get("instructions"))]
                   for number, group in enumerate(groups, 1) for item, question in group]
    if args.detail:
        _table_or(args, ["question", "definition", "test", "type", "criteria", "words"], detail, "no conflicting question ids")
    else:
        _table_or(args, ["question", "definitions", "tests", "difference"], rows, "no conflicting question ids")
    return 1 if rows else 0


def _configure_inventory(parser: Any) -> None:
    parser.add_argument("--sort", choices=("question", "tests", "expected"), default="question",
                        help="order by question id (default), or by most tests or most expectations")
    parser.add_argument("--min-tests", type=int, default=0, metavar="N", help="only question ids used by at least N tests")
    parser.add_argument("--type", choices=TYPES, help="only question ids that are this type in some test")
    parser.add_argument("--unexpected", action="store_true", help="only question ids no test sets an expectation on")
    kit.add_format(parser)


def run_inventory(args: Any) -> int:
    rows = []
    for qid, uses in sorted(_occurrences().items()):
        types = [qtype for qtype in TYPES if any(question.get("type") == qtype for _item, question in uses)]
        expected = sum(qid in _expect(item) for item, _question in uses)
        definitions = len({_definition(question, False) for _item, question in uses})
        if len(uses) < args.min_tests or (args.type and args.type not in types) or (args.unexpected and expected):
            continue
        rows.append([qid, ", ".join(types), len(uses), expected, definitions])
    if args.sort == "tests":
        rows.sort(key=lambda row: (-row[2], row[0]))
    elif args.sort == "expected":
        rows.sort(key=lambda row: (-row[3], row[0]))
    _table_or(args, ["question", "types", "tests", "expected", "definitions"], rows, "no question ids match")
    return 0


# ---------- tests find ----------


def _configure_find(parser: Any) -> None:
    parser.add_argument("text", help="text to look for in question ids, instructions and criteria")
    parser.add_argument("--in", dest="where", choices=("id", "instructions", "criteria"), help="look only in this part of each question")
    parser.add_argument("--case-sensitive", action="store_true", help="match case exactly")
    parser.add_argument("--regex", action="store_true", help="TEXT is a regular expression")
    parser.add_argument("--tests-only", action="store_true", help="one row per matching test, with its number of matching questions")
    kit.add_format(parser)


def run_find(args: Any) -> int:
    flags = 0 if args.case_sensitive else re.IGNORECASE
    try:
        pattern = re.compile(args.text if args.regex else re.escape(args.text), flags)
    except re.error as err:
        raise kit.CliError("--regex %r is not a regular expression: %s" % (args.text, err))
    rows = []
    for item in _tests():
        for qid, question in _questions(item).items():
            criteria = question.get("criteria")
            parts = {"id": [qid], "instructions": list(_strings(question.get("instructions"))),
                     "criteria": (list(criteria) if isinstance(criteria, dict) else []) + list(_strings(criteria))}
            matched = [part for part in ("id", "instructions", "criteria")
                       if (not args.where or part == args.where) and any(pattern.search(text) for text in parts[part])]
            if matched:
                rows.append([item["id"], qid, question.get("type"), ", ".join(matched)])
    if args.tests_only:
        counts: Dict[str, int] = {}
        for row in rows:
            counts[row[0]] = counts.get(row[0], 0) + 1
        _table_or(args, ["test", "questions"], [[test, count] for test, count in counts.items()], "no saved test matches")
    else:
        _table_or(args, ["test", "question", "type", "matched"], rows, "no saved test matches")
    return 0


# ---------- tests summary and states ----------


def _configure_summary(parser: Any) -> None:
    kit.add_format(parser)


def run_summary(args: Any) -> int:
    items = _tests()
    questions = [(item, q) for item in items for q in _questions(item).values()]
    expected = sum(len(_covered(item)) for item in items)
    rows: List[list] = [["tests", len(items)], ["questions", len(questions)],
                        ["distinct question ids", len({qid for item in items for qid in _questions(item)})]]
    rows += [[qtype, sum(q.get("type") == qtype for _item, q in questions)] for qtype in TYPES]
    rows += [["expectations", expected], ["coverage %", _percent(expected, len(questions)) if questions else 0],
             ["tests with pictures", sum(bool(item.get("images")) for item in items)],
             ["text states", sum(_state_kind(item.get("state")) == "text" for item in items)],
             ["object states", sum(_state_kind(item.get("state")) == "object" for item in items)]]
    kit.emit(args, ["metric", "value"], rows)
    return 0


def _configure_states(parser: Any) -> None:
    parser.add_argument("--field", metavar="NAME", help="only tests whose state has this top-level field")
    parser.add_argument("--kind", choices=("text", "object", "array"), help="only tests whose state is this kind")
    kit.add_format(parser)


def run_states(args: Any) -> int:
    rows = []
    for item in _tests():
        state = item.get("state")
        kind = _state_kind(state)
        if args.kind and kind != args.kind:
            continue
        if args.field and not (isinstance(state, dict) and args.field in state):
            continue
        rows.append([item["id"], kind, _state_bytes(state), ", ".join(state) if isinstance(state, dict) else ""])
    _table_or(args, ["id", "kind", "bytes", "fields"], rows, "no saved tests match")
    return 0


# ---------- tests lint ----------


def _configure_lint(parser: Any) -> None:
    parser.add_argument("--level", choices=lint.LEVELS, help="only findings of this level")
    parser.add_argument("--summary", action="store_true", help="one row per test with its problem and advice counts")
    kit.add_format(parser)


def run_lint(args: Any) -> int:
    rows = []
    for item in _tests():
        try:
            questions = workbench.validate_questions(item.get("questions"))
        except workbench.WorkbenchError as err:
            rows.append([item["id"], "built-in", "problem", "invalid", "", str(err)])
            continue
        refs = set(item["images"]) if isinstance(item.get("images"), dict) else set()
        result = lint.check(item.get("state", ""), questions, refs)
        found = [("built-in", finding) for finding in result["findings"]] + [("lab", finding) for finding in result["lab"]["findings"]]
        rows += [[item["id"], source, finding["level"], finding["code"], finding["question"] or "", finding["message"]] for source, finding in found]
    rows = [row for row in rows if not args.level or row[2] == args.level]
    if args.summary:
        counts: Dict[str, List[int]] = {}
        for row in rows:
            counts.setdefault(row[0], [0, 0])[0 if row[2] == "problem" else 1] += 1
        _table_or(args, ["test", "problems", "advice"], [[test] + pair for test, pair in counts.items()], "no findings")
    else:
        _table_or(args, ["test", "source", "level", "code", "question", "message"], rows, "no findings")
    return 1 if any(row[2] == "problem" for row in rows) else 0


PACK = kit.define_pack({
    "id": "cli-tests",
    "surface": "python.cli",
    "title": "Saved test commands",
    "about": "Offline, read-only commands for the Workbench's saved tests: lists with question and expectation counts, a "
             "request outline, expectation coverage and checks, question ids that tests define differently, a question "
             "inventory, search, state shapes and the question checks across the suite. Saved tests hold no answers.",
    "features": [
        {"id": "list", "kind": "cli", "command": ["tests", "list"], "configure": _configure_list, "run": run_list,
         "title": "List saved tests with their question and expectation counts, question types and save time",
         "options": [{"id": "sort", "title": "--sort orders tests by id, name, most questions, most expectations or newest"},
                     {"id": "reverse", "title": "--reverse reverses the order"},
                     {"id": "type", "title": "--type keeps tests that ask a question of one type"},
                     {"id": "min_questions", "title": "--min-questions N keeps tests with at least N questions"},
                     {"id": "uncovered", "title": "--uncovered keeps tests with a question that has no expectation"},
                     {"id": "name", "title": "--name TEXT keeps tests whose id or name contains TEXT"},
                     {"id": "limit", "title": "--limit N keeps the first N tests after sorting"},
                     dict(FORMAT)]},
        {"id": "show", "kind": "cli", "command": ["tests", "show"], "configure": _configure_show, "run": run_show,
         "title": "Outline one saved test's request: state kind and size, pictures, and each question's type, criteria and expectation",
         "options": [{"id": "type", "title": "--type keeps only questions of one type"},
                     {"id": "criteria", "title": "--criteria lists every criterion key with its word count"},
                     dict(FORMAT, title="--format json|csv|markdown prints only the question rows, in another format")]},
        {"id": "coverage", "kind": "cli", "command": ["tests", "coverage"], "configure": _configure_coverage, "run": run_coverage,
         "title": "Show each saved test's expectation coverage and the questions that have none",
         "options": [{"id": "below", "title": "--below PCT keeps tests under that coverage and exits 1 if any"},
                     {"id": "missing", "title": "--missing lists every question that has no expectation"},
                     {"id": "type", "title": "--type counts only questions of one type"},
                     dict(FORMAT)]},
        {"id": "expectations", "kind": "cli", "command": ["tests", "expectations"], "configure": _configure_expectations, "run": run_expectations,
         "title": "Find expectations that name no question, do not fit their question, or can never pass; exit 1 if any",
         "options": [{"id": "test", "title": "--test ID checks one saved test"}, dict(FORMAT)]},
        {"id": "conflicts", "kind": "cli", "command": ["tests", "conflicts"], "configure": _configure_conflicts, "run": run_conflicts,
         "title": "Find question ids that saved tests define differently, and what differs; exit 1 if any",
         "options": [{"id": "types_only", "title": "--types-only keeps ids whose question type differs"},
                     {"id": "normalize", "title": "--normalize ignores differences of case and spacing"},
                     {"id": "detail", "title": "--detail lists every test that uses a conflicting id, by definition"},
                     dict(FORMAT)]},
        {"id": "inventory", "kind": "cli", "command": ["tests", "inventory"], "configure": _configure_inventory, "run": run_inventory,
         "title": "Inventory the suite's question ids: types, tests that ask them, expectations and distinct definitions",
         "options": [{"id": "sort", "title": "--sort orders ids by most tests or most expectations"},
                     {"id": "min_tests", "title": "--min-tests N keeps ids that at least N tests ask"},
                     {"id": "type", "title": "--type keeps ids of one question type"},
                     {"id": "unexpected", "title": "--unexpected keeps ids that no test sets an expectation on"},
                     dict(FORMAT)]},
        {"id": "find", "kind": "cli", "command": ["tests", "find"], "configure": _configure_find, "run": run_find,
         "title": "Find saved tests by question id, instruction text or criteria text",
         "options": [{"id": "where", "title": "--in id|instructions|criteria looks in one part of each question"},
                     {"id": "case_sensitive", "title": "--case-sensitive matches case exactly"},
                     {"id": "regex", "title": "--regex treats the text as a regular expression"},
                     {"id": "tests_only", "title": "--tests-only gives one row per test with its number of matching questions"},
                     dict(FORMAT)]},
        {"id": "summary", "kind": "cli", "command": ["tests", "summary"], "configure": _configure_summary, "run": run_summary,
         "title": "Summarize the suite: tests, questions by type, distinct ids, expectations, coverage, pictures and state kinds",
         "options": [dict(FORMAT)]},
        {"id": "states", "kind": "cli", "command": ["tests", "states"], "configure": _configure_states, "run": run_states,
         "title": "List each saved test's state kind, size in UTF-8 bytes and top-level fields",
         "options": [{"id": "field", "title": "--field NAME keeps tests whose state has that top-level field"},
                     {"id": "kind", "title": "--kind keeps text, object or array states"},
                     dict(FORMAT)]},
        {"id": "lint", "kind": "cli", "command": ["tests", "lint"], "configure": _configure_lint, "run": run_lint,
         "title": "Run the built-in and Lab question checks on every saved test; exit 1 on problems",
         "options": [{"id": "level", "title": "--level keeps only problems or only advice"},
                     {"id": "summary", "title": "--summary counts problems and advice per test"},
                     dict(FORMAT)]},
    ],
})
