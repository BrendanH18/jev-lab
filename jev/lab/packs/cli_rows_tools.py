"""More offline tools for rows files (`lab.py rows ...`), beside the ones in cli_rows.

Compare two rows files by input identity, cut one into files Bulk can take (at most 200 rows each, exact copies kept
in one file), print its last rows, sort it by an input field, and shuffle it with a seed. Rows are read in any row
format cli_rows reads. Printed rows never show a held-out row's labels (cli_rows._emit_rows); files are written only
where --out or --out-dir names, never inside the Workbench data directory. Nothing calls the model.
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from jev import decisions, workbench
from jev.lab import kit
from jev.lab.packs import cli_rows

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the result in another format"}
LABEL_KEY, TEST_KEY = workbench.LABEL_KEY, workbench.TEST_KEY


def _key(row: Any) -> str:
    return decisions._key(row)


def _rows(path: str, source: Optional[str]) -> List[Any]:
    rows = [row for row in cli_rows.load(path, source) if row not in (None, "")]
    for row in rows:
        if not isinstance(row, (str, dict)):
            raise kit.CliError("%s holds a JSON array row; a rows file holds text and JSON objects" % path)
    return rows


# ---------- rows diff ----------


def _configure_diff(parser: Any) -> None:
    parser.add_argument("a", help="the first rows file")
    parser.add_argument("b", help="the second rows file")
    parser.add_argument("--from", dest="source", metavar="FORMAT", help="read both files in this row format")
    parser.add_argument("--rows", action="store_true", help="list the row numbers of each kind (in A, or in B for rows only B has)")
    kit.add_format(parser)


def _index(rows: List[Any]) -> Dict[str, List[Tuple[int, Any]]]:
    out: Dict[str, List[Tuple[int, Any]]] = {}
    for number, row in enumerate(rows, 1):
        out.setdefault(_key(row), []).append((number, row))
    return out


def run_diff(args: Any) -> int:
    a, b = _index(_rows(args.a, args.source)), _index(_rows(args.b, args.source))
    kinds: Dict[str, List[int]] = {"only in A": [], "only in B": [], "in both": [], "labels differ": [], "held out in only one file": []}
    for key, copies in a.items():
        numbers = [number for number, _row in copies]
        if key not in b:
            kinds["only in A"] += numbers
            continue
        kinds["in both"] += numbers
        labels_a = [json.dumps(cli_rows._labels(row), sort_keys=True) for _n, row in copies]
        labels_b = [json.dumps(cli_rows._labels(row), sort_keys=True) for _n, row in b[key]]
        if sorted(set(labels_a)) != sorted(set(labels_b)):
            kinds["labels differ"] += numbers
        if any(cli_rows._held_out(row) for _n, row in copies) != any(cli_rows._held_out(row) for _n, row in b[key]):
            kinds["held out in only one file"] += numbers
    kinds["only in B"] = [number for key, copies in b.items() if key not in a for number, _row in copies]
    columns = ["kind", "rows"] + (["row numbers"] if args.rows else [])
    rows = [[kind, len(found)] + ([", ".join(map(str, sorted(found)))] if args.rows else []) for kind, found in kinds.items()]
    kit.emit(args, columns, rows)
    differ = kinds["only in A"] or kinds["only in B"] or kinds["labels differ"] or kinds["held out in only one file"]
    return 1 if differ else 0


# ---------- rows chunk ----------


def _configure_chunk(parser: Any) -> None:
    cli_rows._add_input(parser)
    parser.add_argument("--out-dir", required=True, metavar="DIR", help="the existing folder to write the files to")
    parser.add_argument("--size", type=int, default=workbench.MAX_BULK_ROWS, metavar="N",
                        help="at most N rows per file (default %d, the most one Bulk run takes)" % workbench.MAX_BULK_ROWS)
    parser.add_argument("--prefix", default="part", metavar="NAME", help="file names start with this (default: part)")
    parser.add_argument("--to", metavar="FORMAT", help="the row format of the files (default: jsonl)")
    parser.add_argument("--force", action="store_true", help="replace files that already exist")
    kit.add_format(parser)


def run_chunk(args: Any) -> int:
    if args.size < 1:
        raise kit.CliError("--size must be at least 1")
    prefix = cli_rows._slug(args.prefix)
    folder = Path(args.out_dir)
    if not folder.is_dir():
        raise kit.CliError("--out-dir %s is not an existing folder" % args.out_dir)
    cli_rows._outside_data(folder, "--out-dir %s" % args.out_dir)
    name, feature = cli_rows._format(args.to, None, "render")
    extension = (feature.get("extensions") or [".csv" if name == "excel" else ".txt"])[0]
    groups: Dict[str, List[Any]] = {}
    for row in _rows(args.file, args.source):
        groups.setdefault(_key(row), []).append(row)
    chunks: List[List[Any]] = [[]]
    for copies in groups.values():
        if len(copies) > args.size:
            raise kit.CliError("one input has %d copies, more than --size %d; exact copies stay in one file" % (len(copies), args.size))
        if len(chunks[-1]) + len(copies) > args.size:
            chunks.append([])
        chunks[-1].extend(copies)
    chunks = [chunk for chunk in chunks if chunk]
    width = max(2, len(str(len(chunks))))
    files = [("%s-%0*d%s" % (prefix, width, index, extension), chunk) for index, chunk in enumerate(chunks, 1)]
    existing = [file for file, _chunk in files if (folder / file).exists()]
    if existing and not args.force:
        raise kit.CliError("%s already exist%s in %s; pass --force to replace" % (", ".join(existing), "s" if len(existing) == 1 else "",
                                                                                  args.out_dir))
    texts = [(file, cli_rows.render(chunk, name), len(chunk)) for file, chunk in files]
    for file, text, _count in texts:
        (folder / file).write_text(text, encoding="utf-8")
    kit.emit(args, ["file", "rows"], [[file, count] for file, _text, count in texts])
    return 0


# ---------- rows tail ----------


def _configure_tail(parser: Any) -> None:
    cli_rows._add_input(parser)
    parser.add_argument("-n", "--rows", type=int, default=5, metavar="N", help="how many rows (default: 5)")
    cli_rows._add_output(parser, out=False, force=False)


def run_tail(args: Any) -> int:
    if args.rows < 1:
        raise kit.CliError("--rows must be at least 1")
    cli_rows._emit_rows(_rows(args.file, args.source)[-args.rows:], args)
    return 0


# ---------- rows sort ----------


def _configure_sort(parser: Any) -> None:
    cli_rows._add_input(parser)
    parser.add_argument("--by", required=True, metavar="FIELD", help="the input field to sort by; rows without it go last")
    parser.add_argument("--reverse", action="store_true", help="sort from the largest value down")
    cli_rows._add_output(parser)


def _sort_key(value: Any) -> Tuple[int, Any]:
    if isinstance(value, bool):
        return (1, str(value).lower())
    if isinstance(value, (int, float)):
        return (0, float(value))
    return (1, cli_rows._value_text(value).casefold())


def run_sort(args: Any) -> int:
    field = cli_rows._input_field(args.by, "--by")
    rows = _rows(args.file, args.source)
    present = [row for row in rows if cli_rows._filled(cli_rows._field(row, field))]
    absent = [row for row in rows if not cli_rows._filled(cli_rows._field(row, field))]
    numbers = all(_sort_key(cli_rows._field(row, field))[0] == 0 for row in present)
    key = (lambda row: _sort_key(cli_rows._field(row, field))[1]) if numbers else \
        (lambda row: _sort_key(cli_rows._field(row, field)))
    cli_rows._emit_rows(sorted(present, key=key, reverse=args.reverse) + absent, args)
    return 0


# ---------- rows shuffle ----------


def _configure_shuffle(parser: Any) -> None:
    cli_rows._add_input(parser)
    parser.add_argument("--seed", type=int, default=0, metavar="S", help="the random seed (default: 0); the same seed gives the same order")
    cli_rows._add_output(parser)


def run_shuffle(args: Any) -> int:
    rows = _rows(args.file, args.source)
    random.Random(args.seed).shuffle(rows)
    cli_rows._emit_rows(rows, args)
    return 0


PACK = kit.define_pack({
    "id": "cli-rows-tools",
    "surface": "python.cli",
    "title": "More rows file tools",
    "about": "More offline `lab.py rows` commands: compare two rows files by input identity, cut a file into Bulk-sized "
             "files with exact copies kept together, print the last rows, sort by an input field, and shuffle with a "
             "seed. Printed rows never show a held-out row's labels.",
    "features": [
        {"id": "diff", "kind": "cli", "command": ["rows", "diff"], "configure": _configure_diff, "run": run_diff,
         "title": "Compare two rows files by input identity: rows only in each, rows in both, label and held-out differences; exit 1 when they differ",
         "options": [{"id": "rows", "title": "--rows lists the row numbers of each kind"},
                     {"id": "source", "title": "--from FORMAT reads both files in another row format"}, dict(FORMAT)]},
        {"id": "chunk", "kind": "cli", "command": ["rows", "chunk"], "configure": _configure_chunk, "run": run_chunk,
         "title": "Cut a rows file into files of at most 200 rows, the most one Bulk run takes, keeping exact copies in one file",
         "options": [{"id": "size", "title": "--size N sets the most rows per file"},
                     {"id": "prefix", "title": "--prefix NAME names the files NAME-01, NAME-02, ..."},
                     {"id": "to", "title": "--to FORMAT writes the files in another row format"},
                     {"id": "force", "title": "--force replaces files that already exist"}]},
        {"id": "tail", "kind": "cli", "command": ["rows", "tail"], "configure": _configure_tail, "run": run_tail,
         "title": "Print the last rows of a rows file, held-out labels left out",
         "options": [{"id": "rows", "title": "-n N prints the last N rows"}]},
        {"id": "sort", "kind": "cli", "command": ["rows", "sort"], "configure": _configure_sort, "run": run_sort,
         "title": "Sort a rows file by an input field, numbers by value and text alphabetically, rows without the field last",
         "options": [{"id": "reverse", "title": "--reverse sorts from the largest value down"},
                     {"id": "out", "title": "--out PATH writes the sorted rows, labels included, to a file"}]},
        {"id": "shuffle", "kind": "cli", "command": ["rows", "shuffle"], "configure": _configure_shuffle, "run": run_shuffle,
         "title": "Shuffle a rows file into a repeatable random order",
         "options": [{"id": "seed", "title": "--seed S picks the order; the same seed gives the same order"}]},
    ],
})
