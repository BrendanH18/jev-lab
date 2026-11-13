"""Offline commands for Bulk rows files (`lab.py rows ...`).

A rows file holds one Bulk row per line (JSON lines: text, or a JSON object of input fields), with labels under
`_expect`, held-out test rows marked `"_test": true` and pictures named under `_image`. These commands count rows and
fields, check every line, convert between row formats, take the head or a seeded sample, split a file by a field or
by held-out marker, strip labels and test markers for sharing, merge files without duplicate inputs, and filter rows.

Files are read and written through the row formats of the Lab packs (kind "format", such as jsonl, csv, tsv,
markdown); a file's ending picks its format unless --from or --to names one. Rows are the same input when they match
with labels and test markers ignored and field order ignored, picture names kept: the identity dataset health and
Review use. Summaries never show a held-out row's label values, and a held-out row's labels are left out of rows
printed to the screen (they are kept in files written with --out). Nothing is written except the files named with
--out or --out-dir, never inside the Workbench data directory, and nothing calls the model.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from jev import config, decisions, workbench
from jev.lab import kit, mathx

LABEL_KEY, TEST_KEY, IMAGE_KEY = workbench.LABEL_KEY, workbench.TEST_KEY, workbench.IMAGE_KEY
DEFAULT_FORMAT = "jsonl"
MISSING = "(missing)"
FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the result in another format"}


# ---------- formats and files ----------


def _formats() -> Dict[str, dict]:
    """Every row format the Lab packs hold, by name (the first pack to claim a name keeps it)."""
    from jev import lab as registry

    out: Dict[str, dict] = {}
    for _pack, feature in registry.formats():
        out.setdefault(feature["name"], feature)
    return out


def _format(name: Optional[str], path: Optional[str], direction: str) -> Tuple[str, dict]:
    formats = _formats()
    if not name and path:
        suffix = Path(path).suffix.lower()
        name = next((n for n, f in formats.items() if suffix in (f.get("extensions") or []) and callable(f.get(direction))),
                    DEFAULT_FORMAT)
    name = name or DEFAULT_FORMAT
    feature = formats.get(name)
    if feature is None or not callable(feature.get(direction)):
        able = sorted(n for n, f in formats.items() if callable(f.get(direction)))
        raise kit.CliError("no row format %r %s rows; choose one of: %s" % (name, "reads" if direction == "parse" else "writes",
                                                                            ", ".join(able)))
    return name, feature


def _read_text(path: str) -> str:
    target = Path(path)
    if not target.is_file():
        raise kit.CliError("no rows file %s" % path)
    try:
        return target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as err:
        raise kit.CliError("cannot read %s: %s" % (path, err))


def load(path: str, fmt: Optional[str] = None) -> List[Any]:
    """The rows of a file, read with --from or the format its ending names (JSON lines otherwise)."""
    name, feature = _format(fmt, path, "parse")
    text = _read_text(path)
    try:
        return list(feature["parse"](text))
    except ValueError as err:
        raise kit.CliError("cannot read %s as %s: %s" % (path, name, err))


def render(rows: List[Any], name: str) -> str:
    _name, feature = _format(name, None, "render")
    try:
        return feature["render"](rows)
    except ValueError as err:
        raise kit.CliError("cannot write the rows as %s: %s" % (name, err))


def _out_path(out: str, force: bool) -> Path:
    """A file to write: never inside the Workbench data directory, never an existing file without --force."""
    target = Path(out)
    _outside_data(target, "--out %s" % out)
    if target.is_dir():
        raise kit.CliError("--out %s is a folder; name a file" % out)
    if target.exists() and not force:
        raise kit.CliError("%s already exists; choose another --out path or pass --force" % out)
    if not target.parent.is_dir():
        raise kit.CliError("the folder for --out %s does not exist" % out)
    return target


def _outside_data(target: Path, what: str) -> None:
    resolved = target.resolve()
    for data in {workbench.WORKBENCH_DIR.resolve(), config.WORKBENCH_DIR.resolve()}:
        if resolved == data or data in resolved.parents:
            raise kit.CliError("%s is inside the Workbench data directory; write somewhere else" % what)


def _held_out(row: Any) -> bool:
    return isinstance(row, dict) and row.get(TEST_KEY) is True


def _labels(row: Any) -> dict:
    labels = row.get(LABEL_KEY) if isinstance(row, dict) else None
    return labels if isinstance(labels, dict) else {}


def _masked(rows: List[Any]) -> Tuple[List[Any], int]:
    """Rows to print: a held-out row loses its labels, so the screen never shows a held-out label value."""
    out, hidden = [], 0
    for row in rows:
        if _held_out(row) and LABEL_KEY in row:
            row = {k: v for k, v in row.items() if k != LABEL_KEY}
            hidden += 1
        out.append(row)
    return out, hidden


def _emit_rows(rows: List[Any], args: Any, to: Optional[str] = None) -> None:
    """Print rows, or write them to --out. Held-out labels stay out of what is printed."""
    name = to or getattr(args, "to", None) or DEFAULT_FORMAT
    out = getattr(args, "out", None)
    if out:
        target = _out_path(out, getattr(args, "force", False))
        target.write_text(render(rows, name), encoding="utf-8")
        print("wrote %d row%s to %s" % (len(rows), "" if len(rows) == 1 else "s", out))
        return
    shown, hidden = _masked(rows)
    sys.stdout.write(render(shown, name))
    if hidden:
        print("left out the labels of %d held-out row%s; write them to a file with --out"
              % (hidden, "" if hidden == 1 else "s"), file=sys.stderr)


def _add_input(parser: Any, name: str = "file") -> None:
    parser.add_argument(name, help="a rows file (JSON lines unless its ending or --from names another format)")
    parser.add_argument("--from", dest="source", metavar="FORMAT", help="read the file in this row format")


def _add_output(parser: Any, out: bool = True, force: bool = True) -> None:
    parser.add_argument("--to", metavar="FORMAT", help="write the rows in this row format (default: jsonl)")
    if out:
        parser.add_argument("--out", metavar="PATH", help="write the rows to this file instead of printing them")
    if force:
        parser.add_argument("--force", action="store_true", help="replace the --out file if it exists")


def _value_text(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)


def _input_field(name: str, flag: str) -> str:
    """An input field named by --by or --where. Labels and test markers are not input fields: grouping or filtering by
    them would show or test held-out label values."""
    name = name.strip()
    if not name:
        raise kit.CliError("%s needs a field name" % flag)
    if name in (LABEL_KEY, TEST_KEY):
        raise kit.CliError("%s takes an input field; labels (%s) and test markers (%s) cannot be one" % (flag, LABEL_KEY, TEST_KEY))
    return name


def _field(row: Any, name: str) -> Any:
    """A row's value for an input field, or None. A text row's text is its "text" field."""
    if isinstance(row, str):
        return row if name == "text" else None
    return row.get(name) if isinstance(row, dict) else None


def _inputs(row: Any) -> Dict[str, Any]:
    if isinstance(row, str):
        return {"text": row}
    if not isinstance(row, dict):
        return {}
    return {k: v for k, v in row.items() if k not in (LABEL_KEY, TEST_KEY)}


def _filled(value: Any) -> bool:
    return value is not None and value != "" and value != {} and value != []


# ---------- rows count ----------


def _configure_count(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("--by", metavar="FIELD", help="count rows per value of this input field")
    kit.add_format(parser)


def run_count(args: Any) -> int:
    by = _input_field(args.by, "--by") if args.by is not None else None
    rows = load(args.file, args.source)
    if by:
        groups: Dict[str, List[int]] = {}
        for row in rows:
            value = _field(row, by)
            key = MISSING if value is None else _value_text(value)
            counts = groups.setdefault(key, [0, 0, 0])
            counts[0] += 1
            counts[1] += 1 if _labels(row) else 0
            counts[2] += 1 if _held_out(row) else 0
        ordered = sorted(groups.items(), key=lambda item: (-item[1][0], item[0]))
        kit.emit(args, [by, "rows", "labeled", "held out"], [[key] + counts for key, counts in ordered])
        return 0
    keys = [decisions._key(row) for row in rows]
    kit.emit(args, ["metric", "value"], [
        ["rows", len(rows)], ["text rows", sum(1 for row in rows if isinstance(row, str))],
        ["object rows", sum(1 for row in rows if isinstance(row, dict))],
        ["labeled rows", sum(1 for row in rows if _labels(row))], ["held-out rows", sum(1 for row in rows if _held_out(row))],
        ["picture rows", sum(1 for row in rows if isinstance(row, dict) and IMAGE_KEY in row)],
        ["distinct inputs", len(set(keys))], ["duplicate copies", len(keys) - len(set(keys))]])
    return 0


# ---------- rows fields ----------


def _configure_fields(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("--labels", action="store_true", help="list the labeled questions instead of the input fields")
    parser.add_argument("--min-fill", type=float, metavar="SHARE", help="keep fields filled in at least this share of rows")
    kit.add_format(parser)


def _kind(value: Any) -> str:
    if isinstance(value, bool):
        return "yes/no"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "text"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "list"
    return "null"


def _pct(part: int, whole: int) -> Optional[float]:
    return mathx.round(100.0 * part / whole, 1) if whole else None


def run_fields(args: Any) -> int:
    if args.min_fill is not None and not 0 <= args.min_fill <= 1:
        raise kit.CliError("--min-fill must be a share between 0 and 1")
    rows = load(args.file, args.source)
    total = len(rows)
    out = []
    if args.labels:
        names: Dict[str, None] = {}
        for row in rows:
            names.update(dict.fromkeys(_labels(row)))
        for qid in names:
            tuning = [_labels(row)[qid] for row in rows if not _held_out(row) and _filled(_labels(row).get(qid))]
            held = sum(1 for row in rows if _held_out(row) and _filled(_labels(row).get(qid)))
            labeled = len(tuning) + held
            out.append([qid, labeled, len(tuning), held, _pct(labeled, total), len({_value_text(v) for v in tuning})])
        columns = ["question", "labeled", "tuning", "held out", "fill %", "distinct (tuning)"]
    else:
        names = {}
        for row in rows:
            names.update(dict.fromkeys(_inputs(row)))
        for name in names:
            values = [_inputs(row).get(name) for row in rows]
            filled = [value for value in values if _filled(value)]
            kinds = sorted({_kind(value) for value in filled})
            out.append([name, len(filled), _pct(len(filled), total), ", ".join(kinds), len({_value_text(v) for v in filled})])
        columns = ["field", "rows", "fill %", "types", "distinct"]
    if args.min_fill is not None:
        out = [line for line in out if total and line[1] / total >= args.min_fill]
    kit.emit(args, columns, out)
    return 0


# ---------- rows validate ----------


def _configure_validate(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("--questions", metavar="PATH", help="a questions JSON file to check the labels against")
    parser.add_argument("--strict", action="store_true", help="also report repeated inputs and rows past the dataset limit")
    kit.add_format(parser)


def _questions(path: str) -> Dict[str, dict]:
    try:
        data = json.loads(_read_text(path))
    except ValueError as err:
        raise kit.CliError("%s is not JSON: %s" % (path, err))
    if isinstance(data, dict) and isinstance(data.get("questions"), dict):
        data = data["questions"]
    return workbench.validate_questions(data)


def _row_problems(row: Any, questions: Optional[Dict[str, dict]]) -> List[str]:
    if isinstance(row, list):
        return ["is a JSON array; a rows file holds text and JSON objects"]
    if not isinstance(row, (str, dict)):
        return ["is not text or a JSON object"]
    problems = []
    try:
        state, labels = workbench.split_labels(row, 0)
    except workbench.WorkbenchError as err:
        return [re.sub(r"^Row 0:? ", "", str(err))]
    for check in (workbench.row_test, lambda s: workbench.validate_state(workbench.without_marks(s)), workbench.row_picture):
        try:
            check(state)
        except workbench.WorkbenchError as err:
            problems.append(str(err))
    if questions is not None:
        for qid, value in (labels or {}).items():
            question = questions.get(qid)
            if question is None:
                problems.append("labels %s, which the questions do not ask" % qid)
            elif question["type"] not in decisions.LABEL_TYPES:
                problems.append("labels %s, a %s question, which takes no label here" % (qid, question["type"]))
            elif not decisions.label(question, value)[0]:
                problems.append("has a label for %s that fits none of its answers" % qid)
    return problems


def run_validate(args: Any) -> int:
    questions = _questions(args.questions) if args.questions else None
    name, _feature = _format(args.source, args.file, "parse")
    found: List[Tuple[int, Any]] = []
    problems: List[list] = []
    if name == DEFAULT_FORMAT:
        unit = "line"
        for number, line in enumerate(_read_text(args.file).lstrip("﻿").split("\n"), 1):
            text = line.strip()
            if not text:
                continue
            if text.startswith("{"):
                try:
                    value = json.loads(text)
                except ValueError:
                    value = None
                if not isinstance(value, dict):
                    problems.append([number, "starts with { but is not a JSON object, so Bulk would read it as text"])
                    continue
                found.append((number, value))
            else:
                found.append((number, text))
    else:
        unit = "row"
        found = list(enumerate(load(args.file, args.source), 1))
    for number, row in found:
        problems += [[number, problem] for problem in _row_problems(row, questions)]
    if args.strict:
        first: Dict[str, int] = {}
        for index, (number, row) in enumerate(found, 1):
            if not isinstance(row, (str, dict)):
                continue
            key = decisions._key(row)
            if key in first:
                problems.append([number, "repeats the input of %s %d" % (unit, first[key])])
            else:
                first[key] = number
            if index == workbench.MAX_BULK_ROWS + 1:
                problems.append([number, "is past the %d rows a dataset or a Bulk run holds" % workbench.MAX_BULK_ROWS])
    problems.sort(key=lambda item: item[0])
    if not problems:
        print("every row is valid (%d row%s)" % (len(found), "" if len(found) == 1 else "s"))
        return 0
    kit.emit(args, [unit, "problem"], problems)
    return 1


# ---------- rows convert, formats ----------


def _configure_convert(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("--to", metavar="FORMAT", required=True, help="the row format to write")
    parser.add_argument("--out", metavar="PATH", help="write the rows to this file instead of printing them")
    parser.add_argument("--force", action="store_true", help="replace the --out file if it exists")


def run_convert(args: Any) -> int:
    if args.force and not args.out:
        raise kit.CliError("--force replaces an --out file; name one with --out")
    rows = load(args.file, args.source)
    _emit_rows(rows, args, args.to)
    return 0


def _configure_formats(parser: Any) -> None:
    kit.add_format(parser)


def run_formats(args: Any) -> int:
    kit.emit(args, ["format", "reads", "writes", "extensions", "description"],
             [[name, callable(f.get("parse")), callable(f.get("render")), " ".join(f.get("extensions") or []), f["title"]]
              for name, f in sorted(_formats().items())])
    return 0


# ---------- rows head, sample ----------


def _configure_head(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("-n", "--rows", type=int, default=5, metavar="N", help="how many rows (default: 5)")
    _add_output(parser, out=False, force=False)


def run_head(args: Any) -> int:
    if args.rows < 1:
        raise kit.CliError("--rows must be at least 1")
    _emit_rows(load(args.file, args.source)[: args.rows], args)
    return 0


def _configure_sample(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("--size", type=int, required=True, metavar="N", help="how many rows to draw")
    parser.add_argument("--seed", type=int, default=0, metavar="S", help="the random seed (default: 0); the same seed draws the same rows")
    parser.add_argument("--tuning", action="store_true", help="draw from tuning rows only, never held-out ones")
    _add_output(parser)


def run_sample(args: Any) -> int:
    rows = load(args.file, args.source)
    pool = [row for row in rows if not (args.tuning and _held_out(row))]
    if not 1 <= args.size <= len(pool):
        raise kit.CliError("--size must be between 1 and the %d rows to draw from" % len(pool))
    picked = mathx.sample_indexes(len(pool), args.size, args.seed)
    if picked is None:
        raise kit.CliError("--seed must be an integer up to 2^53 - 1 in size")
    _emit_rows([pool[index] for index in picked], args)
    return 0


# ---------- rows split ----------


def _configure_split(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("--out-dir", required=True, metavar="DIR", help="the existing folder to write the files to")
    parser.add_argument("--by", metavar="FIELD", help="one file per value of this input field")
    parser.add_argument("--held-out", action="store_true", help="two files: tuning rows and held-out test rows")
    parser.add_argument("--to", metavar="FORMAT", help="the row format of the files (default: jsonl)")
    parser.add_argument("--force", action="store_true", help="replace files that already exist")
    kit.add_format(parser)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:60].strip("-") or "blank"


def run_split(args: Any) -> int:
    if (args.by is not None) == bool(args.held_out):
        raise kit.CliError("split by one of --by FIELD or --held-out")
    by = _input_field(args.by, "--by") if args.by is not None else None
    folder = Path(args.out_dir)
    if not folder.is_dir():
        raise kit.CliError("--out-dir %s is not an existing folder" % args.out_dir)
    _outside_data(folder, "--out-dir %s" % args.out_dir)
    name, feature = _format(args.to, None, "render")
    extension = (feature.get("extensions") or [".csv" if name == "excel" else ".txt"])[0]
    rows = load(args.file, args.source)
    groups: Dict[Optional[str], List[Any]] = {}
    if args.held_out:
        for row in rows:
            groups.setdefault("test" if _held_out(row) else "tuning", []).append(row)
    else:
        for row in rows:
            value = _field(row, by)
            groups.setdefault(None if value is None else _value_text(value), []).append(row)
    files: List[Tuple[str, List[Any]]] = []
    taken = set()
    for key in sorted(groups, key=lambda k: (k is not None, k or "")):
        base = "_missing" if key is None else key if args.held_out else _slug(key)
        stem, n = base, 2
        while stem in taken:
            stem, n = "%s-%d" % (base, n), n + 1
        taken.add(stem)
        files.append((stem + extension, groups[key]))
    existing = [file for file, _rows in files if (folder / file).exists()]
    if existing and not args.force:
        raise kit.CliError("%s already exist%s in %s; pass --force to replace" % (", ".join(existing), "s" if len(existing) == 1 else "",
                                                                                  args.out_dir))
    texts = [(file, render(group, name), len(group)) for file, group in files]
    for file, text, _count in texts:
        (folder / file).write_text(text, encoding="utf-8")
    kit.emit(args, ["file", "rows"], [[file, count] for file, _text, count in texts])
    return 0


# ---------- rows strip ----------


def _configure_strip(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("--pictures", action="store_true", help="also remove _image picture names")
    parser.add_argument("--drop", action="append", default=[], metavar="FIELD", help="also remove this input field (repeat for more)")
    _add_output(parser)


def run_strip(args: Any) -> int:
    rows = load(args.file, args.source)
    drop = {LABEL_KEY, TEST_KEY} | ({IMAGE_KEY} if args.pictures else set())
    drop |= {name.strip() for value in args.drop for name in value.split(",") if name.strip()}
    out, labels, markers, emptied = [], 0, 0, 0
    for row in rows:
        if isinstance(row, str):
            if "text" in drop:
                emptied += 1
                continue
            out.append(row)
            continue
        if not isinstance(row, dict):
            raise kit.CliError("a rows file holds text and JSON objects; one row is a JSON array")
        labels += 1 if LABEL_KEY in row else 0
        markers += 1 if TEST_KEY in row else 0
        kept = {k: v for k, v in row.items() if k not in drop}
        if not kept:
            emptied += 1
            continue
        out.append(kept)
    _emit_rows(out, args)
    note = "removed labels from %d row%s and test markers from %d" % (labels, "" if labels == 1 else "s", markers)
    if emptied:
        note += "; left out %d row%s with no input left" % (emptied, "" if emptied == 1 else "s")
    print(note, file=sys.stderr)
    return 0


# ---------- rows merge ----------


def _configure_merge(parser: Any) -> None:
    parser.add_argument("files", nargs="+", help="rows files, merged in order (one file removes its own duplicates)")
    parser.add_argument("--from", dest="source", metavar="FORMAT", help="read every file in this row format")
    parser.add_argument("--prefer", choices=("first", "last"), default="first",
                        help="whose labels a repeated input keeps: the first copy's (default) or the last copy's")
    parser.add_argument("--fill-labels", action="store_true",
                        help="add labels for questions the kept copy lacks from the other copies")
    _add_output(parser)


def run_merge(args: Any) -> int:
    order: List[str] = []
    copies: Dict[str, List[Any]] = {}
    total = 0
    for path in args.files:
        for row in load(path, args.source):
            if not isinstance(row, (str, dict)):
                raise kit.CliError("%s holds a JSON array row; a rows file holds text and JSON objects" % path)
            if isinstance(row, dict) and LABEL_KEY in row and not isinstance(row[LABEL_KEY], dict):
                raise kit.CliError("%s has a row whose %s is not an object; `lab.py rows validate %s` names it" % (path, LABEL_KEY, path))
            total += 1
            key = decisions._key(row)
            if key not in copies:
                order.append(key)
                copies[key] = []
            copies[key].append(row)
    merged, conflicts, held = [], 0, 0
    for key in order:
        group = copies[key]
        row = group[0]
        labels = dict(_labels(group[-1] if args.prefer == "last" else row))
        if args.fill_labels:
            for other in group:
                for qid, value in _labels(other).items():
                    labels.setdefault(qid, value)
        seen: Dict[str, str] = {}
        clash = False
        for other in group:
            for qid, value in _labels(other).items():
                text = json.dumps(value, sort_keys=True)
                clash = clash or seen.setdefault(qid, text) != text
        conflicts += 1 if clash else 0
        test = any(_held_out(other) for other in group)
        if len(group) > 1 and test and not _held_out(row):
            held += 1
        if isinstance(row, str) and not labels and not test:
            merged.append(row)
            continue
        out = dict(_inputs(row))
        if labels:
            out[LABEL_KEY] = labels
        if test:
            out[TEST_KEY] = True
        merged.append(out)
    _emit_rows(merged, args)
    dropped = total - len(merged)
    print("kept %d of %d rows: %d duplicate cop%s left out, %d input%s with conflicting labels, %d marked held out "
          "because a copy was" % (len(merged), total, dropped, "y" if dropped == 1 else "ies", conflicts,
                                  "" if conflicts == 1 else "s", held), file=sys.stderr)
    return 0


# ---------- rows filter ----------


def _configure_filter(parser: Any) -> None:
    _add_input(parser)
    parser.add_argument("--where", action="append", default=[], metavar="FIELD=VALUE",
                        help="keep rows whose input field has this value (repeat: all must match)")
    parser.add_argument("--labeled", nargs="?", const="", metavar="QUESTION",
                        help="keep rows with a label (for QUESTION, when given)")
    which = parser.add_mutually_exclusive_group()
    which.add_argument("--tuning", action="store_true", help="keep tuning rows only")
    which.add_argument("--held-out", action="store_true", help="keep held-out test rows only (printed without labels)")
    _add_output(parser)


def run_filter(args: Any) -> int:
    pairs = []
    for text in args.where:
        if "=" not in text:
            raise kit.CliError("--where takes FIELD=VALUE, not %r" % text)
        name, value = text.split("=", 1)
        pairs.append((_input_field(name, "--where"), value))
    rows = load(args.file, args.source)
    kept = []
    for row in rows:
        if args.tuning and _held_out(row) or args.held_out and not _held_out(row):
            continue
        if args.labeled is not None:
            labels = _labels(row)
            if not (_filled(labels.get(args.labeled)) if args.labeled else any(_filled(v) for v in labels.values())):
                continue
        if all(_field(row, name) is not None and _value_text(_field(row, name)) == value for name, value in pairs):
            kept.append(row)
    _emit_rows(kept, args)
    print("kept %d of %d rows" % (len(kept), len(rows)), file=sys.stderr)
    return 0


# ---------- the pack ----------

OUT = "--out PATH writes the %s to a file outside the Workbench data directory, labels included"

PACK = kit.define_pack({
    "id": "cli-rows",
    "surface": "python.cli",
    "title": "Bulk rows file tools",
    "about": "Offline commands for Bulk rows files: counts, field fill rates, line-by-line validation, conversion "
             "between row formats, head and seeded samples, splitting by a field or held-out marker, stripping labels "
             "for sharing, merging without duplicate inputs and filtering. Summaries never show held-out label values, "
             "and only files named with --out or --out-dir are written, never inside the Workbench data directory.",
    "features": [
        {"id": "count", "kind": "cli", "command": ["rows", "count"], "configure": _configure_count, "run": run_count,
         "title": "Count a rows file's rows: text and object rows, labeled, held-out and picture rows, distinct inputs",
         "options": [{"id": "by", "title": "--by FIELD counts rows, labeled rows and held-out rows per value of a field"},
                     dict(FORMAT)]},
        {"id": "fields", "kind": "cli", "command": ["rows", "fields"], "configure": _configure_fields, "run": run_fields,
         "title": "List a rows file's input fields with how many rows fill them, their value types and distinct values",
         "options": [{"id": "labels", "title": "--labels counts labels per question, tuning and held-out, without values"},
                     {"id": "min_fill", "title": "--min-fill SHARE keeps fields filled in at least that share of rows"},
                     dict(FORMAT)]},
        {"id": "validate", "kind": "cli", "command": ["rows", "validate"], "configure": _configure_validate, "run": run_validate,
         "title": "Check every line of a rows file as Bulk would read it and name each malformed one; exit 1 if any",
         "options": [{"id": "questions", "title": "--questions PATH checks each label against a questions JSON file"},
                     {"id": "strict", "title": "--strict also reports repeated inputs and rows past the 200-row limit"},
                     dict(FORMAT)]},
        {"id": "convert", "kind": "cli", "command": ["rows", "convert"], "configure": _configure_convert, "run": run_convert,
         "title": "Convert a rows file to another row format named with --to (jsonl, json, csv, tsv, markdown, ...)",
         "options": [{"id": "from", "title": "--from FORMAT reads a file whose ending does not name its format"},
                     {"id": "out", "title": OUT % "converted rows"},
                     {"id": "force", "title": "--force lets --out replace an existing file"}]},
        {"id": "formats", "kind": "cli", "command": ["rows", "formats"], "configure": _configure_formats, "run": run_formats,
         "title": "List the row formats the rows commands read and write, with the file endings that pick them"},
        {"id": "head", "kind": "cli", "command": ["rows", "head"], "configure": _configure_head, "run": run_head,
         "title": "Print the first rows of a rows file, held-out labels left out",
         "options": [{"id": "rows", "title": "-n N prints the first N rows"},
                     {"id": "to", "title": "--to FORMAT prints the rows in another row format, such as a Markdown table"}]},
        {"id": "sample", "kind": "cli", "command": ["rows", "sample"], "configure": _configure_sample, "run": run_sample,
         "title": "Draw a random sample of rows, in file order, the same rows for the same seed as the browser's sampler",
         "options": [{"id": "seed", "title": "--seed S draws a different, repeatable sample"},
                     {"id": "tuning", "title": "--tuning draws from tuning rows only, never held-out ones"},
                     {"id": "out", "title": OUT % "sample"}]},
        {"id": "split", "kind": "cli", "command": ["rows", "split"], "configure": _configure_split, "run": run_split,
         "title": "Split a rows file into one file per value of an input field in a folder named with --out-dir",
         "options": [{"id": "held_out", "title": "--held-out splits into tuning and held-out test files instead"},
                     {"id": "to", "title": "--to FORMAT writes the files in another row format"},
                     {"id": "force", "title": "--force replaces files that already exist"}]},
        {"id": "strip", "kind": "cli", "command": ["rows", "strip"], "configure": _configure_strip, "run": run_strip,
         "title": "Strip labels and test markers from a rows file for sharing, keeping the inputs",
         "options": [{"id": "pictures", "title": "--pictures also removes picture names"},
                     {"id": "drop", "title": "--drop FIELD also removes an input field, such as a customer email"},
                     {"id": "out", "title": "--out PATH writes the stripped rows to a file outside the Workbench data directory"}]},
        {"id": "merge", "kind": "cli", "command": ["rows", "merge"], "configure": _configure_merge, "run": run_merge,
         "title": "Merge rows files without duplicate inputs; a repeated input stays held out if any copy was",
         "options": [{"id": "prefer", "title": "--prefer last keeps the last copy's labels for a repeated input"},
                     {"id": "fill_labels", "title": "--fill-labels adds labels the kept copy lacks from the other copies"},
                     {"id": "out", "title": OUT % "merged rows"}]},
        {"id": "filter", "kind": "cli", "command": ["rows", "filter"], "configure": _configure_filter, "run": run_filter,
         "title": "Keep the rows that match filters and print or write them",
         "options": [{"id": "where", "title": "--where FIELD=VALUE keeps rows whose input field has that value"},
                     {"id": "labeled", "title": "--labeled [QUESTION] keeps labeled rows, or rows with that question labeled"},
                     {"id": "tuning", "title": "--tuning keeps tuning rows only"},
                     {"id": "held_out", "title": "--held-out keeps held-out test rows only, printed without their labels"}]},
    ],
})
