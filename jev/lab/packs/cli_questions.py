"""Offline commands for question set files: a JSON file holding a Workbench questions object, or a request
(a saved test, an exported example) whose "questions" field holds one. Nothing here calls the model; the only
files written are the ones a user names with --out."""

from __future__ import annotations

import csv
import io
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from jev import lint, workbench
from jev.lab import kit

TYPES = workbench.QUESTION_TYPES
CSV_COLUMNS = ["question", "type", "field", "key", "text", "json"]
# A cell a spreadsheet would run as a formula (kit.csv_cell puts an apostrophe before it on export).
_FORMULA = re.compile(r"^\s*[=+@-]|^[\t\r\n]")
_TICKED = re.compile(r"`([^`\n]+)`")
_PATH = re.compile(r"[A-Za-z_][\w-]*(?:\.[\w-]+|\[\d+\])*")


# ---------- reading and writing files ----------


def _read_text(path: str) -> str:
    try:
        text = Path(path).read_bytes().decode("utf-8")
    except OSError as err:
        raise kit.CliError("cannot read %s: %s" % (path, err.strerror or err))
    except UnicodeDecodeError:
        raise kit.CliError("cannot read %s: it is not UTF-8 text" % path)
    return text[1:] if text.startswith("﻿") else text


def _parse(path: str) -> Any:
    try:
        return json.loads(_read_text(path))
    except ValueError as err:
        raise kit.CliError("%s is not JSON: %s" % (path, err))


def _is_request(data: Any) -> bool:
    """A request holds its questions under "questions"; a bare questions object holds questions keyed by id."""
    return isinstance(data, dict) and isinstance(data.get("questions"), dict) and not isinstance(data["questions"].get("type"), str)


def _request(path: str) -> dict:
    data = _parse(path)
    return data if _is_request(data) else {"questions": data}


def _valid(path: str, raw: Any) -> Dict[str, dict]:
    try:
        return workbench.validate_questions(raw)
    except workbench.WorkbenchError as err:
        raise kit.CliError("%s: %s" % (path, err))


def _questions(path: str) -> Dict[str, dict]:
    return _valid(path, _request(path)["questions"])


def _write_out(path: str, text: str, force: Optional[bool] = None) -> None:
    """Write a file the user named with --out. An existing file is replaced only with --force (force=True); commands
    without --force pass None and never replace one."""
    target = Path(path)
    if target.is_dir():
        raise kit.CliError("--out %s is a folder; name a file" % path)
    if target.exists() and not force:
        raise kit.CliError("%s already exists; choose another --out path%s" % (path, "" if force is None else " or pass --force"))
    if not target.parent.is_dir():
        raise kit.CliError("the folder for --out %s does not exist" % path)
    target.write_text(text, encoding="utf-8")


def _count(number: int, noun: str = "question") -> str:
    return "%d %s%s" % (number, noun, "" if number == 1 else "s")


def _json_text(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


# ---------- question helpers ----------


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
    """Every criterion as (key, description): Choice option keys, Score level numbers from 0, Noul true/false."""
    criteria = question.get("criteria")
    if question["type"] == "score" and isinstance(criteria, list):
        return [(str(index), level) for index, level in enumerate(criteria)]
    if isinstance(criteria, dict):
        return list(criteria.items())
    return []


def _empty(value: Any) -> bool:
    return value in (None, "", {}, [])


def _criteria_count(question: dict) -> int:
    """Choice options, Score levels, or the Noul true/false criteria that say something; a Box has none."""
    entries = _entries(question)
    if question["type"] == "noul":
        return sum(not _empty(value) for _key, value in entries)
    return len(entries)


def _type_counts(questions: Dict[str, dict]) -> Dict[str, int]:
    return {qtype: sum(q["type"] == qtype for q in questions.values()) for qtype in TYPES}


def _type_summary(questions: Dict[str, dict]) -> str:
    return ", ".join("%d %s" % (count, qtype) for qtype, count in _type_counts(questions).items() if count)


def _inline(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def _squash(value: Any) -> Any:
    """Strings with runs of whitespace collapsed to one space and the ends trimmed, inside any structure."""
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, dict):
        return {key: _squash(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_squash(item) for item in value]
    return value


def _table_or(args: Any, columns: List[str], rows: List[list], empty: str) -> None:
    if not rows and getattr(args, "format", "table") == "table":
        print(empty)
    else:
        kit.emit(args, columns, rows)


# ---------- outline ----------


def _configure_outline(parser: Any) -> None:
    parser.add_argument("file", help="a questions JSON file, or a request JSON file with a questions field")
    parser.add_argument("--type", choices=TYPES, help="only questions of this type")
    parser.add_argument("--criteria", action="store_true", help="one row per criterion instead of one per question")
    parser.add_argument("--sort", choices=("position", "id", "type", "criteria", "words"), default="position",
                        help="order rows by position (default), id, type, or most criteria / instruction words first")
    kit.add_format(parser)


def run_outline(args: Any) -> int:
    questions = _questions(args.file)
    picked = [(position, qid, q) for position, (qid, q) in enumerate(questions.items(), 1) if not args.type or q["type"] == args.type]
    if args.criteria:
        rows = [[qid, q["type"], key, _words(value)] for _position, qid, q in picked for key, value in _entries(q)]
        kit.emit(args, ["question", "type", "key", "words"], rows)
        return 0
    rows = [[position, qid, q["type"], _criteria_count(q), _words(q.get("instructions"))] for position, qid, q in picked]
    keys = {"id": lambda row: row[1], "type": lambda row: (TYPES.index(row[2]), row[0]),
            "criteria": lambda row: (-row[3], row[0]), "words": lambda row: (-row[4], row[0])}
    if args.sort in keys:
        rows.sort(key=keys[args.sort])
    kit.emit(args, ["#", "id", "type", "criteria", "words"], rows)
    return 0


# ---------- validate ----------


def _configure_validate(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("--state", action="store_true", help="also check the request's state as the Workbench would")
    parser.add_argument("--all", action="store_true", help="report every invalid question, not only the first problem")
    parser.add_argument("--quiet", action="store_true", help="print nothing; only the exit code tells")
    kit.add_format(parser)


def _all_problems(raw: Any) -> List[List[str]]:
    if not isinstance(raw, dict) or not raw:
        return [["", "questions must be a non-empty object keyed by question id"]]
    problems = []
    if len(raw) > workbench.MAX_QUESTIONS:
        problems.append(["", "At most %d questions per request" % workbench.MAX_QUESTIONS])
    seen = set()
    for qid, question in raw.items():
        trimmed = qid.strip()
        if trimmed and trimmed in seen:
            problems.append([qid, "Question ids must be unique after trimming whitespace: %r" % trimmed])
        seen.add(trimmed)
        try:
            workbench.validate_questions({qid: question})
        except workbench.WorkbenchError as err:
            problems.append([qid, str(err)])
    return problems


def run_validate(args: Any) -> int:
    text = _read_text(args.file)
    try:
        data = json.loads(text)
    except ValueError as err:
        problems = [["", "not JSON: %s" % err]]
        data = None
    else:
        request = data if _is_request(data) else {"questions": data}
        if args.all:
            problems = _all_problems(request["questions"])
        else:
            problems = []
            try:
                workbench.validate_questions(request["questions"])
            except workbench.WorkbenchError as err:
                problems = [["", str(err)]]
        if args.state and not problems:
            if "state" not in request:
                problems = [["", "the file has no state"]]
            else:
                try:
                    workbench.validate_state(request["state"])
                except workbench.WorkbenchError as err:
                    problems = [["", str(err)]]
    if args.quiet:
        return 1 if problems else 0
    if args.format != "table":
        kit.emit(args, ["question", "problem"], problems)
    elif problems:
        for _qid, message in problems:
            print("invalid: %s" % message)
    else:
        questions = workbench.validate_questions(request["questions"])
        print("valid: %s (%s)%s" % (_count(len(questions)), _type_summary(questions), " and a valid state" if args.state else ""))
    return 1 if problems else 0


# ---------- lint ----------


def _configure_lint(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("--state", metavar="FILE", help="read the request state from this file (JSON, or plain text)")
    parser.add_argument("--picture", action="append", default=[], metavar="NAME",
                        help="a picture reference the request carries, which is not a state path (repeatable)")
    parser.add_argument("--level", choices=lint.LEVELS, help="only findings of this level")
    parser.add_argument("--no-lab", action="store_true", help="leave out the Lab packs' findings")
    parser.add_argument("--strict", action="store_true", help="exit 1 on advice too, not only on problems")
    kit.add_format(parser)


def run_lint(args: Any) -> int:
    request = _request(args.file)
    questions = _valid(args.file, request["questions"])
    state: Any = None
    if args.state:
        text = _read_text(args.state)
        try:
            state = json.loads(text)
        except ValueError:
            state = text[:-1] if text.endswith("\n") else text
    elif "state" in request:
        state = request["state"]
    refs = set(request["images"]) if isinstance(request.get("images"), dict) else set()
    refs |= set(args.picture)
    result = lint.check("" if state is None else state, questions, refs)
    found = [("built-in", item) for item in result["findings"]]
    if not args.no_lab:
        found += [("lab", item) for item in result["lab"]["findings"]]
    if state is None:
        found = [(source, item) for source, item in found if item["code"] != "missing_path"]
        print("lab.py: %s has no state, so backticked paths were not checked (pass --state FILE)" % args.file, file=sys.stderr)
    rows = [[source, item["level"], item["code"], item["question"] or "", item["message"]] for source, item in found
            if not args.level or item["level"] == args.level]
    _table_or(args, ["source", "level", "code", "question", "message"], rows, "no findings")
    if any(row[1] == "problem" for row in rows) or (args.strict and rows):
        return 1
    return 0


# ---------- stats ----------


def _configure_stats(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("--by-type", action="store_true", help="one row per question type")
    parser.add_argument("--words-over", type=int, metavar="N", help="list questions whose instructions run past N words; exit 1 if any")
    kit.add_format(parser)


def run_stats(args: Any) -> int:
    questions = _questions(args.file)
    if args.words_over is not None:
        rows = [[qid, q["type"], _words(q.get("instructions"))] for qid, q in questions.items() if _words(q.get("instructions")) > args.words_over]
        _table_or(args, ["question", "type", "words"], rows, "no question has more than %d words of instructions" % args.words_over)
        return 1 if rows else 0
    if args.by_type:
        rows = [[qtype, sum(1 for q in questions.values() if q["type"] == qtype),
                 sum(_criteria_count(q) for q in questions.values() if q["type"] == qtype),
                 sum(_words(q.get("instructions")) for q in questions.values() if q["type"] == qtype)]
                for qtype in TYPES if any(q["type"] == qtype for q in questions.values())]
        kit.emit(args, ["type", "questions", "criteria", "words"], rows)
        return 0
    words = {qid: _words(q.get("instructions")) for qid, q in questions.items()}
    longest = max(words, key=lambda qid: words[qid])
    rows: List[list] = [["questions", len(questions)]]
    rows += [[qtype, count] for qtype, count in _type_counts(questions).items()]
    rows += [["criteria", sum(_criteria_count(q) for q in questions.values())],
             ["choice options", sum(len(_entries(q)) for q in questions.values() if q["type"] == "choice")],
             ["score levels", sum(len(_entries(q)) for q in questions.values() if q["type"] == "score")],
             ["instruction words", sum(words.values())],
             ["mean words", round(sum(words.values()) / len(words), 1)],
             ["longest", "%s (%d words)" % (longest, words[longest])]]
    kit.emit(args, ["metric", "value"], rows)
    return 0


# ---------- diff ----------


def _configure_diff(parser: Any) -> None:
    parser.add_argument("old", help="the first questions or request JSON file")
    parser.add_argument("new", help="the second questions or request JSON file")
    parser.add_argument("--ignore-order", action="store_true", help="do not report questions that only moved")
    parser.add_argument("--ignore-whitespace", action="store_true", help="treat text that differs only in spacing as the same")
    parser.add_argument("--criteria", action="store_true", help="one row per added, removed or changed criterion")
    parser.add_argument("--stat", action="store_true", help="only count added, removed, changed and moved questions")
    kit.add_format(parser)


def _moved(before: List[str], after: List[str]) -> set:
    """The ids (the same ones, in two orders) outside a longest common subsequence: the fewest questions whose move
    explains the new order. On a tie the later question of the old order is the one that moved."""
    size = [[0] * (len(after) + 1) for _ in range(len(before) + 1)]
    for i, left in enumerate(before, 1):
        for j, right in enumerate(after, 1):
            size[i][j] = size[i - 1][j - 1] + 1 if left == right else max(size[i - 1][j], size[i][j - 1])
    kept, i, j = set(), len(before), len(after)
    while i and j:
        if before[i - 1] == after[j - 1]:
            kept.add(before[i - 1])
            i, j = i - 1, j - 1
        elif size[i - 1][j] >= size[i][j - 1]:
            i -= 1
        else:
            j -= 1
    return set(before) - kept


def run_diff(args: Any) -> int:
    old, new = _questions(args.old), _questions(args.new)
    same = (lambda a, b: _squash(a) == _squash(b)) if args.ignore_whitespace else (lambda a, b: a == b)
    out_of_order = _moved([qid for qid in old if qid in new], [qid for qid in new if qid in old])
    position_old = {qid: index for index, qid in enumerate(old, 1)}
    position_new = {qid: index for index, qid in enumerate(new, 1)}
    rows: List[list] = []
    changed, moved = set(), set()
    for qid in list(old) + [qid for qid in new if qid not in old]:
        if qid not in new:
            rows.append(["removed", qid, old[qid]["type"]])
            continue
        if qid not in old:
            rows.append(["added", qid, new[qid]["type"]])
            continue
        a, b = old[qid], new[qid]
        if a["type"] != b["type"]:
            rows.append(["type", qid, "%s -> %s" % (a["type"], b["type"])])
            changed.add(qid)
        else:
            if not same(a.get("instructions"), b.get("instructions")):
                rows.append(["instructions", qid, "changed"])
                changed.add(qid)
            before, after = dict(_entries(a)), dict(_entries(b))
            added = [key for key in after if key not in before]
            removed = [key for key in before if key not in after]
            edited = [key for key in before if key in after and not same(before[key], after[key])]
            reordered = not (added or removed or edited) and a["type"] == "choice" and list(before) != list(after)
            if args.criteria:
                rows += [["criterion", qid, "%s: %s" % (key, what)] for what, keys in (("added", added), ("removed", removed), ("changed", edited))
                         for key in keys]
            elif added or removed or edited:
                rows.append(["criteria", qid, ", ".join(["+" + key for key in added] + ["-" + key for key in removed] + ["~" + key for key in edited])])
            if reordered:
                rows.append(["criteria", qid, "options reordered"])
            if added or removed or edited or reordered:
                changed.add(qid)
        if not args.ignore_order and qid in out_of_order:
            rows.append(["moved", qid, "position %d -> %d" % (position_old[qid], position_new[qid])])
            moved.add(qid)
    if args.stat:
        counts = [["added", sum(qid not in old for qid in new)], ["removed", sum(qid not in new for qid in old)],
                  ["changed", len(changed)], ["moved", len(moved)]]
        kit.emit(args, ["change", "questions"], counts)
    else:
        _table_or(args, ["change", "question", "detail"], rows, "no differences")
    return 1 if rows else 0


# ---------- conversion ----------


def _csv_value(value: Any) -> Tuple[str, str]:
    """(cell text, json flag). Text stays text; anything else, and text that starts with an apostrophe before a
    formula character (which the import would read as an escape), is written as JSON."""
    if isinstance(value, str) and not (value.startswith("'") and _FORMULA.match(value[1:])):
        return value, ""
    return json.dumps(value, ensure_ascii=False), "yes"


def _csv_rows(questions: Dict[str, dict]) -> List[list]:
    rows = []
    for qid, q in questions.items():
        rows.append([qid, q["type"], "instructions", ""] + list(_csv_value(q["instructions"])))
        for key, value in _entries(q):
            rows.append([qid, q["type"], "criterion", key] + list(_csv_value(value)))
    return rows


def _configure_to_csv(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("--out", metavar="PATH", help="write the CSV to this new file instead of printing it")


def run_to_csv(args: Any) -> int:
    questions = _questions(args.file)
    text = kit.csv_text([CSV_COLUMNS] + _csv_rows(questions))
    if args.out:
        _write_out(args.out, text)
        print("wrote %s to %s" % (_count(len(questions)), args.out))
    else:
        print(text, end="")
    return 0


def _unescape(cell: str) -> str:
    return cell[1:] if cell.startswith("'") and _FORMULA.match(cell[1:]) else cell


def questions_from_csv(text: str) -> Dict[str, dict]:
    """Workbench questions from the flat CSV that `questions to-csv` writes."""
    reader = csv.DictReader(io.StringIO(text, newline=""))
    missing = [column for column in CSV_COLUMNS[:5] if column not in (reader.fieldnames or [])]
    if missing:
        raise kit.CliError("the CSV needs the columns %s; it lacks %s" % (", ".join(CSV_COLUMNS), ", ".join(missing)))
    built: Dict[str, dict] = {}
    for number, row in enumerate(reader, 2):
        cell = {column: _unescape(row.get(column) or "") for column in CSV_COLUMNS}
        qid, qtype, field = cell["question"], cell["type"].strip(), cell["field"].strip()
        # Choice option keys are kept exactly (" a" and "a" are two options); level numbers and true/false are trimmed.
        key = cell["key"] if qtype == "choice" else cell["key"].strip()
        if not qid.strip():
            raise kit.CliError("line %d: the question column is empty" % number)
        value: Any = cell["text"]
        if cell["json"].strip().lower() in ("yes", "true", "1"):
            try:
                value = json.loads(value)
            except ValueError:
                raise kit.CliError("line %d: the text is marked as JSON but is not JSON" % number)
        question = built.setdefault(qid, {"type": qtype, "_criteria": []})
        if question["type"] != qtype:
            raise kit.CliError("line %d: question %r has type %r here but %r above" % (number, qid, qtype, question["type"]))
        if field == "instructions":
            if "instructions" in question:
                raise kit.CliError("line %d: question %r has a second instructions row" % (number, qid))
            question["instructions"] = value
        elif field == "criterion":
            if any(key == seen for seen, _value in question["_criteria"]):
                raise kit.CliError("line %d: question %r repeats the criterion %r" % (number, qid, key))
            question["_criteria"].append((key, value))
        else:
            raise kit.CliError("line %d: field must be instructions or criterion, not %r" % (number, field))
    out: Dict[str, dict] = {}
    for qid, question in built.items():
        entries = question.pop("_criteria")
        if entries and question["type"] == "score":
            if sorted(key for key, _value in entries) != sorted(str(index) for index in range(len(entries))):
                raise kit.CliError("question %r: score levels must be numbered 0 to %d" % (qid, len(entries) - 1))
            question["criteria"] = [value for _key, value in sorted(entries, key=lambda entry: int(entry[0]))]
        elif entries:
            question["criteria"] = dict(entries)
        out[qid] = {name: question[name] for name in ("type", "instructions", "criteria") if name in question}
    try:
        return workbench.validate_questions(out)
    except workbench.WorkbenchError as err:
        raise kit.CliError("the CSV does not hold valid questions: %s" % err)


def _configure_from_csv(parser: Any) -> None:
    parser.add_argument("file", help="a CSV file with the columns question,type,field,key,text,json")
    parser.add_argument("--out", metavar="PATH", help="write the questions JSON to this file instead of printing it")
    parser.add_argument("--force", action="store_true", help="let --out replace an existing file")


def run_from_csv(args: Any) -> int:
    questions = questions_from_csv(_read_text(args.file))
    if args.out:
        _write_out(args.out, _json_text(questions), args.force)
        print("wrote %s to %s" % (_count(len(questions)), args.out))
    else:
        print(_json_text(questions), end="")
    return 0


def _configure_to_markdown(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("--full", action="store_true", help="a section per question with every criterion, instead of one table")
    parser.add_argument("--out", metavar="PATH", help="write the Markdown to this new file instead of printing it")


def _markdown_full(questions: Dict[str, dict]) -> str:
    parts = []
    for position, (qid, q) in enumerate(questions.items(), 1):
        lines = ["## %d. `%s` (%s)" % (position, qid, q["type"]), "", _markdown_value(q["instructions"])]
        entries = _entries(q)
        if entries:
            lines.append("")
            lines += ["- `%s`: %s" % (key, "(no description)" if _empty(value) else _markdown_value(value)) for key, value in entries]
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


def _markdown_value(value: Any) -> str:
    return value if isinstance(value, str) else "`%s`" % json.dumps(value, ensure_ascii=False)


def run_to_markdown(args: Any) -> int:
    questions = _questions(args.file)
    if args.full:
        text = _markdown_full(questions)
    else:
        rows = [[position, qid, q["type"], _criteria_count(q), _inline(q["instructions"])] for position, (qid, q) in enumerate(questions.items(), 1)]
        text = kit.markdown_table(["#", "id", "type", "criteria", "instructions"], rows)
    if args.out:
        _write_out(args.out, text + "\n")
        print("wrote %s to %s" % (_count(len(questions)), args.out))
    else:
        print(text)
    return 0


# ---------- rename and pick ----------


def _load_editable(path: str) -> Tuple[Any, Dict[str, Any], bool]:
    data = _parse(path)
    request = _is_request(data)
    questions = data["questions"] if request else data
    if not isinstance(questions, dict):
        raise kit.CliError("%s holds no questions object" % path)
    return data, questions, request


def _rebuild(data: Any, questions: Dict[str, Any], request: bool, expect_ids: Optional[Dict[str, Optional[str]]] = None) -> Any:
    """The file's data with new questions. expect_ids maps each kept expectation id to its new id (None drops it)."""
    if not request:
        return questions
    out = dict(data)
    out["questions"] = questions
    if isinstance(data.get("expect"), dict) and expect_ids is not None:
        out["expect"] = {expect_ids.get(qid, qid): value for qid, value in data["expect"].items() if expect_ids.get(qid, qid) is not None}
    return out


def _configure_rename(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("old", help="the question id to rename")
    parser.add_argument("new", help="its new id")
    parser.add_argument("--out", metavar="PATH", help="write the renamed file here instead of printing it")
    parser.add_argument("--force", action="store_true", help="let --out replace an existing file, such as the input itself")


def run_rename(args: Any) -> int:
    data, questions, request = _load_editable(args.file)
    new = args.new.strip()
    if args.old not in questions:
        raise kit.CliError("%s has no question %r" % (args.file, args.old))
    if not new:
        raise kit.CliError("the new id is empty")
    if any(qid.strip() == new for qid in questions if qid != args.old):
        raise kit.CliError("%s already has a question %r" % (args.file, new))
    expect = data.get("expect") if request else None
    if isinstance(expect, dict) and new != args.old and new in expect:
        raise kit.CliError("%s already has an expectation for %r; remove it before renaming %r" % (args.file, new, args.old))
    renamed = {(new if qid == args.old else qid): question for qid, question in questions.items()}
    _valid(args.file, renamed)
    text = _json_text(_rebuild(data, renamed, request, {args.old: new}))
    if args.out:
        _write_out(args.out, text, args.force)
        print("wrote %s (renamed %s to %s)" % (args.out, args.old, new))
    else:
        print(text, end="")
    return 0


def _configure_pick(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("ids", nargs="+", metavar="ID", help="the question ids to keep")
    parser.add_argument("--exclude", action="store_true", help="keep every question except the ids given")
    parser.add_argument("--out", metavar="PATH", help="write the result to this new file instead of printing it")


def run_pick(args: Any) -> int:
    data, questions, request = _load_editable(args.file)
    unknown = [qid for qid in args.ids if qid not in questions]
    if unknown:
        raise kit.CliError("%s has no question %s" % (args.file, ", ".join(repr(qid) for qid in unknown)))
    kept = {qid: question for qid, question in questions.items() if (qid in args.ids) != args.exclude}
    if not kept:
        raise kit.CliError("no question would be left")
    _valid(args.file, kept)
    text = _json_text(_rebuild(data, kept, request, {qid: None for qid in questions if qid not in kept}))
    if args.out:
        _write_out(args.out, text)
        print("wrote %s to %s" % (_count(len(kept)), args.out))
    else:
        print(text, end="")
    return 0


# ---------- fields ----------


def _configure_fields(parser: Any) -> None:
    parser.add_argument("file", help="a request JSON file whose state is a JSON object")
    parser.add_argument("--unused", action="store_true", help="only fields no question names; exit 1 if any")
    kit.add_format(parser)


def _kind(value: Any) -> str:
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "text"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "list"
    return "null"


def _paths(question: dict) -> List[str]:
    found = []
    for text in _strings([question.get("instructions"), question.get("criteria")]):
        found += [token.strip() for token in _TICKED.findall(text) if _PATH.fullmatch(token.strip())]
    return found


def run_fields(args: Any) -> int:
    request = _request(args.file)
    questions = _valid(args.file, request["questions"])
    if "state" not in request:
        raise kit.CliError("%s has no state; fields reads a request file with a state" % args.file)
    state = request["state"]
    if not isinstance(state, dict):
        raise kit.CliError("the state in %s is not a JSON object, so it has no fields" % args.file)
    rows = []
    for field, value in state.items():
        users = [qid for qid, q in questions.items()
                 if any(path == field or path.startswith(field + ".") or path.startswith(field + "[") for path in _paths(q))]
        rows.append([field, _kind(value), len(users), ", ".join(users)])
    if args.unused:
        rows = [row for row in rows if row[2] == 0]
        _table_or(args, ["field", "kind", "questions", "named by"], rows, "every state field is named by a question")
        return 1 if rows else 0
    kit.emit(args, ["field", "kind", "questions", "named by"], rows)
    return 0


FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}

PACK = kit.define_pack({
    "id": "cli-questions",
    "surface": "python.cli",
    "title": "Question set commands",
    "about": "Offline commands for a question set file (a questions JSON object, or a request that holds one): outline, "
             "validate, lint, stats, diff, CSV and Markdown conversion, renaming and picking questions, and the state "
             "fields questions name. Only files named with --out are written.",
    "features": [
        {"id": "outline", "kind": "cli", "command": ["questions", "outline"], "configure": _configure_outline, "run": run_outline,
         "title": "Outline a question file: position, id, type, criteria count and instruction words",
         "options": [{"id": "type", "title": "--type keeps only questions of one type"},
                     {"id": "criteria", "title": "--criteria lists every criterion key with its word count"},
                     {"id": "sort", "title": "--sort orders questions by id, type, most criteria or most words"},
                     dict(FORMAT)]},
        {"id": "validate", "kind": "cli", "command": ["questions", "validate"], "configure": _configure_validate, "run": run_validate,
         "title": "Validate a question file as the Workbench would; exit 1 when it is invalid",
         "options": [{"id": "state", "title": "--state also validates the request's state"},
                     {"id": "all", "title": "--all reports every invalid question, not only the first problem"},
                     {"id": "quiet", "title": "--quiet prints nothing and answers with the exit code alone"},
                     dict(FORMAT, title="--format json|csv|markdown lists the problems as rows")]},
        {"id": "lint", "kind": "cli", "command": ["questions", "lint"], "configure": _configure_lint, "run": run_lint,
         "title": "Run the built-in question checks and the Lab packs' checks on a file; exit 1 on problems",
         "options": [{"id": "state", "title": "--state FILE checks backticked paths against a separate state file"},
                     {"id": "picture", "title": "--picture NAME treats a picture reference as present, not a missing path"},
                     {"id": "level", "title": "--level keeps only problems or only advice"},
                     {"id": "no_lab", "title": "--no-lab leaves out the Lab packs' findings"},
                     {"id": "strict", "title": "--strict exits 1 on advice too"},
                     dict(FORMAT)]},
        {"id": "stats", "kind": "cli", "command": ["questions", "stats"], "configure": _configure_stats, "run": run_stats,
         "title": "Count a question file's types, criteria, options, levels and instruction words",
         "options": [{"id": "by_type", "title": "--by-type gives questions, criteria and words per question type"},
                     {"id": "words_over", "title": "--words-over N lists questions with longer instructions and exits 1 if any"},
                     dict(FORMAT)]},
        {"id": "diff", "kind": "cli", "command": ["questions", "diff"], "configure": _configure_diff, "run": run_diff,
         "title": "Compare two question files: added, removed, retyped, reworded, re-criteria'd and moved questions; exit 1 when they differ",
         "options": [{"id": "ignore_order", "title": "--ignore-order does not report questions that only moved"},
                     {"id": "ignore_whitespace", "title": "--ignore-whitespace treats text that differs only in spacing as the same"},
                     {"id": "criteria", "title": "--criteria gives one row per added, removed or changed criterion"},
                     {"id": "stat", "title": "--stat prints only the counts of added, removed, changed and moved questions"},
                     dict(FORMAT)]},
        {"id": "to_csv", "kind": "cli", "command": ["questions", "to-csv"], "configure": _configure_to_csv, "run": run_to_csv,
         "title": "Convert a question file to a flat CSV outline, one row per instruction and criterion",
         "options": [{"id": "out", "title": "--out PATH writes the CSV to a new file"}]},
        {"id": "from_csv", "kind": "cli", "command": ["questions", "from-csv"], "configure": _configure_from_csv, "run": run_from_csv,
         "title": "Convert the flat CSV outline back to validated Workbench question JSON",
         "options": [{"id": "out", "title": "--out PATH writes the question JSON to a new file"},
                     {"id": "force", "title": "--force lets --out replace an existing file"}]},
        {"id": "to_markdown", "kind": "cli", "command": ["questions", "to-markdown"], "configure": _configure_to_markdown, "run": run_to_markdown,
         "title": "Convert a question file to a Markdown table of its questions",
         "options": [{"id": "full", "title": "--full writes a section per question with every criterion"},
                     {"id": "out", "title": "--out PATH writes the Markdown to a new file"}]},
        {"id": "rename", "kind": "cli", "command": ["questions", "rename"], "configure": _configure_rename, "run": run_rename,
         "title": "Rename a question id where it stands, moving a request's expectation with it",
         "options": [{"id": "out", "title": "--out PATH writes the renamed file instead of printing it"},
                     {"id": "force", "title": "--force lets --out replace an existing file, such as the input"}]},
        {"id": "pick", "kind": "cli", "command": ["questions", "pick"], "configure": _configure_pick, "run": run_pick,
         "title": "Keep only the named questions of a file, in their order, with their expectations",
         "options": [{"id": "exclude", "title": "--exclude keeps every question except the named ones"},
                     {"id": "out", "title": "--out PATH writes the result to a new file"}]},
        {"id": "fields", "kind": "cli", "command": ["questions", "fields"], "configure": _configure_fields, "run": run_fields,
         "title": "List a request's state fields with the questions that name each one in backticks",
         "options": [{"id": "unused", "title": "--unused lists only fields no question names and exits 1 if any"},
                     dict(FORMAT)]},
    ],
})
