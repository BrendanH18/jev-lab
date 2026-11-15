"""Offline drift helpers (`lab.py drift ...`): compare a file of new rows with a saved dataset's inputs, no model.

The Workbench's Drift panel and `scripts/check.py <id> --drift` send both sides to the model and compare answers
through a check's gate. Before spending on that, these commands compare the inputs alone: which fields new rows carry
and how often, the values of a slice-like field, value types, text lengths, pictures, and how many new rows copy rows
the dataset already holds.

The reference side is the dataset's tuning rows only. New rows marked `"_test": true`, and unmarked copies of the
dataset's held-out rows, are left out as drift.prepare leaves them out, and only counted. Labels on either side are
ignored and never printed. Nothing here calls the model or writes a file.
"""

from __future__ import annotations

import json
import statistics
import sys
from math import ceil
from typing import Any, Dict, List, Optional, Tuple

from jev import driftsession, drift as driftlib, images, lint, slices, workbench
from jev.lab import kit
from jev.lab.packs import cli_gates, cli_rows, preflight_states

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
FROM = {"id": "source", "title": "--from FORMAT reads the new rows in another row format (csv, tsv, json, ...)"}
TEXT = "text"
KINDS = (("text", str), ("number", (int, float)), ("list", list), ("object", dict))


# ---------- reading both sides ----------


def _inputs(row: Any) -> Dict[str, Any]:
    """A row's input fields: labels, test marker and picture name left out; a text row is its text field."""
    if isinstance(row, str):
        return {TEXT: row}
    if isinstance(row, dict):
        return {k: v for k, v in row.items() if k not in (workbench.LABEL_KEY, workbench.TEST_KEY, workbench.IMAGE_KEY)}
    return {}


def _sides(args: Any) -> Tuple[dict, List[Any], List[Any], dict]:
    """(dataset, reference tuning rows, new rows compared, counts of new rows left out)."""
    dataset = workbench.load_dataset(args.dataset)
    reference = workbench.tuning_rows(dataset)
    held = {driftsession.input_key(row) for row in dataset["rows"] if _held_out(row)}
    fresh, marked, copies = [], 0, 0
    for row in _new_rows(args):
        if _held_out(row):
            marked += 1
        elif driftsession.input_key(row) in held:
            copies += 1
        else:
            fresh.append(row)
    left = {"marked": marked, "held_out_copies": copies}
    if marked or copies:
        print("left out %d new row%s: %d marked as test rows, %d copying the dataset's held-out rows"
              % (marked + copies, "" if marked + copies == 1 else "s", marked, copies), file=sys.stderr)
    return dataset, reference, fresh, left


def _new_rows(args: Any) -> List[Any]:
    """The new rows as the Drift panel takes them: drift.new_rows enforces the row cap, row types and valid states."""
    return driftlib.new_rows(cli_rows.load(args.file, args.source))


def _held_out(row: Any) -> bool:
    """A test row, by the same strict rule as the Workbench: a marker other than true is an error."""
    return workbench.row_test(row)


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip()) or (isinstance(value, (list, dict)) and not value)


def _fields(*sides: List[Any]) -> List[str]:
    names: List[str] = []
    for side in sides:
        for row in side:
            names.extend(name for name in _inputs(row) if name not in names)
    return names


def _share(part: int, whole: int) -> Optional[float]:
    return part / whole if whole else None


def _filled(rows: List[Any], field: str) -> int:
    return sum(1 for row in rows if not _blank(_inputs(row).get(field)))


def _kind(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true/false"
    return next((name for name, kind in KINDS if isinstance(value, kind)), None)


def _lengths(rows: List[Any], field: str) -> List[int]:
    return [len(value) for row in rows for value in [_inputs(row).get(field)] if isinstance(value, str)]


def _p90(values: List[int]) -> Optional[int]:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, ceil(0.9 * len(ordered)) - 1)]


def _median(values: List[int]) -> Optional[float]:
    return float(statistics.median(values)) if values else None


def _ratio(new: Optional[float], ref: Optional[float]) -> Optional[float]:
    return new / ref if new is not None and ref else None


def _shifted(new: Optional[float], ref: Optional[float], limit: float) -> bool:
    """Whether a median length moved by a factor of limit or more. Text that vanishes (a median of 0 after a positive
    one) or appears (positive after 0) moved by more than any factor."""
    if new is None or ref is None or (new == 0 and ref == 0):
        return False
    if new == 0 or ref == 0:
        return True
    ratio = new / ref
    return ratio >= limit or ratio <= 1 / limit


def _common(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset whose tuning rows are the reference")
    cli_rows._add_input(parser)


def _emit(args: Any, columns: List[str], rows: List[list], empty: str) -> None:
    cli_gates._table_or(args, columns, rows, empty)


# ---------- drift fields ----------


def _configure_fields(parser: Any) -> None:
    _common(parser)
    parser.add_argument("--min-gap", type=float, metavar="X", help="only fields whose share of filled rows moved by X or more; exit 1 if any")
    parser.add_argument("--sort", choices=("first", "gap"), default="first", help="order by first appearance (default) or by the size of the move")
    kit.add_format(parser)


def _field_rows(reference: List[Any], fresh: List[Any]) -> List[list]:
    rows = []
    for name in _fields(reference, fresh):
        ref, new = _filled(reference, name), _filled(fresh, name)
        rs, ns = _share(ref, len(reference)), _share(new, len(fresh))
        gap = (ns or 0.0) - (rs or 0.0)
        status = "new" if new and not ref else "gone" if ref and not new else ""
        rows.append([name, ref, rs, new, ns, round(gap, 6), status])
    return rows


def run_fields(args: Any) -> int:
    _dataset, reference, fresh, _left = _sides(args)
    rows = _field_rows(reference, fresh)
    if args.min_gap is not None:
        rows = [row for row in rows if abs(row[5]) + 1e-9 >= args.min_gap]
    if args.sort == "gap":
        rows.sort(key=lambda row: -abs(row[5]))
    _emit(args, ["field", "reference rows", "reference share", "new rows", "new share", "gap", "status"], rows,
          "no field moved by %s or more" % kit.cell_text(args.min_gap) if args.min_gap is not None else "no input fields")
    return 1 if args.min_gap is not None and rows else 0


# ---------- drift values ----------


def _configure_values(parser: Any) -> None:
    _common(parser)
    parser.add_argument("--field", required=True, metavar="FIELD", help="the top-level input field to compare")
    parser.add_argument("--new-only", action="store_true", help="only values no reference row has; exit 1 if any")
    parser.add_argument("--top", type=int, metavar="N", help="only the N most common values on both sides together")
    kit.add_format(parser)


def _counts(rows: List[Any], field: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for row in rows:
        value = slices._value(row, field)  # the raw row, as By slice reads it: a text row has no fields
        out[value] = out.get(value, 0) + 1
    return out


def run_values(args: Any) -> int:
    _dataset, reference, fresh, _left = _sides(args)
    field = cli_rows._input_field(args.field, "--field")  # never labels or test markers
    ref, new = _counts(reference, field), _counts(fresh, field)
    values = sorted(set(ref) | set(new), key=lambda v: (-(ref.get(v, 0) + new.get(v, 0)), v))
    if args.new_only:  # before --top, so a rare new value is never cut away
        values = [value for value in values if not ref.get(value)]
    if args.top is not None:
        values = values[:max(args.top, 0)]
    rows = []
    for value in values:
        r, n = ref.get(value, 0), new.get(value, 0)
        status = "new" if n and not r else "gone" if r and not n else ""
        rows.append([slices._shown(value), r, _share(r, len(reference)), n, _share(n, len(fresh)), status])
    _emit(args, ["value", "reference rows", "reference share", "new rows", "new share", "status"], rows,
          "every new value of %s is in the reference" % args.field if args.new_only else "no rows")
    return 1 if args.new_only and rows else 0


# ---------- drift lengths ----------


def _configure_lengths(parser: Any) -> None:
    _common(parser)
    parser.add_argument("--field", metavar="FIELD", help="only this text field")
    parser.add_argument("--min-ratio", type=float, metavar="X",
                        help="only fields whose median length grew or shrank by a factor of X or more; exit 1 if any")
    kit.add_format(parser)


def run_lengths(args: Any) -> int:
    _dataset, reference, fresh, _left = _sides(args)
    rows = []
    for name in _fields(reference, fresh):
        if args.field and name != args.field:
            continue
        ref, new = _lengths(reference, name), _lengths(fresh, name)
        if not ref and not new:
            continue
        ratio = _ratio(_median(new), _median(ref))
        if args.min_ratio is not None and not _shifted(_median(new), _median(ref), args.min_ratio):
            continue
        p = driftlib.mann_whitney(ref, new)
        rows.append([name, len(ref), _median(ref), _p90(ref), len(new), _median(new), _p90(new),
                     None if ratio is None else round(ratio, 6), None if p is None else round(p, 6)])
    empty = "no text field's median length moved by a factor of %s" % kit.cell_text(args.min_ratio) if args.min_ratio else "no text fields"
    _emit(args, ["field", "reference rows", "reference median", "reference p90", "new rows", "new median", "new p90",
                 "ratio", "p"], rows, empty)
    return 1 if args.min_ratio is not None and rows else 0


# ---------- drift overlap ----------


def _configure_overlap(parser: Any) -> None:
    _common(parser)
    parser.add_argument("--rows", action="store_true", help="list the new rows' line numbers for each kind")
    parser.add_argument("--fail", action="store_true", help="exit 1 when any new row copies a saved row")
    parser.add_argument("--export", action="store_true",
                        help="print only the new inputs as JSON lines, without labels or test markers, ready to label or run")
    kit.add_format(parser)


def run_overlap(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    tuning = {driftsession.input_key(row) for row in workbench.tuning_rows(dataset)}
    held = {driftsession.input_key(row) for row in dataset["rows"] if _held_out(row)}
    kinds: Dict[str, List[int]] = {"copies a tuning row": [], "copies a held-out row": [], "marked as a test row": [],
                                   "repeats an earlier new row": [], "new input": []}
    seen = set()
    fresh: List[Any] = []
    for number, row in enumerate(_new_rows(args), 1):
        key = driftsession.input_key(row)
        if _held_out(row):
            kind = "marked as a test row"
        elif key in held:
            kind = "copies a held-out row"
        elif key in tuning:
            kind = "copies a tuning row"
        elif key in seen:
            kind = "repeats an earlier new row"
        else:
            kind = "new input"
            fresh.append(row)
        seen.add(key)
        kinds[kind].append(number)
    if args.export:
        for row in fresh:
            state = workbench.without_marks(row)
            print(json.dumps({TEXT: state} if isinstance(state, str) else state, ensure_ascii=False))
        return 0
    columns = ["kind", "new rows"] + (["row numbers"] if args.rows else [])
    rows = [[kind, len(found)] + ([", ".join(map(str, found))] if args.rows else []) for kind, found in kinds.items()]
    kit.emit(args, columns, rows)
    copied = len(kinds["copies a tuning row"]) + len(kinds["copies a held-out row"])
    return 1 if args.fail and copied else 0


# ---------- drift types ----------


def _configure_types(parser: Any) -> None:
    _common(parser)
    parser.add_argument("--changed", action="store_true", help="only fields whose value types differ; exit 1 if any")
    kit.add_format(parser)


def _mix(rows: List[Any], field: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for row in rows:
        kind = _kind(_inputs(row).get(field))
        if kind:
            out[kind] = out.get(kind, 0) + 1
    return out


def _mix_text(mix: Dict[str, int]) -> str:
    return ", ".join("%s %d" % (kind, mix[kind]) for kind in sorted(mix, key=lambda k: (-mix[k], k)))


def run_types(args: Any) -> int:
    _dataset, reference, fresh, _left = _sides(args)
    rows = []
    for name in _fields(reference, fresh):
        ref, new = _mix(reference, name), _mix(fresh, name)
        changed = bool(ref) and bool(new) and set(ref) != set(new)
        if args.changed and not changed:
            continue
        rows.append([name, _mix_text(ref), _mix_text(new), changed])
    _emit(args, ["field", "reference types", "new types", "changed"], rows,
          "every field keeps its value types" if args.changed else "no input fields")
    return 1 if args.changed and rows else 0


# ---------- drift pictures ----------


def _configure_pictures(parser: Any) -> None:
    _common(parser)
    kit.add_format(parser)


def _picture(row: Any) -> Optional[str]:
    name = row.get(workbench.IMAGE_KEY) if isinstance(row, dict) else None
    return name if isinstance(name, str) else None


def _present(name: str) -> bool:
    if name in images.SAMPLES:
        return True
    return bool(workbench.IMAGE_FILE.fullmatch(name)) and (workbench.images_dir() / name).is_file()


def run_pictures(args: Any) -> int:
    dataset, reference, fresh, _left = _sides(args)
    ref_names = {_picture(row) for row in reference} - {None}
    held_names = {_picture(row) for row in dataset["rows"] if _held_out(row)} - {None}
    new_names = [_picture(row) for row in fresh]
    named = [name for name in new_names if name]
    rows = [
        ["rows", len(reference), len(fresh)],
        ["rows with a picture", sum(_picture(row) is not None for row in reference), len(named)],
        ["share with a picture", _share(sum(_picture(row) is not None for row in reference), len(reference)), _share(len(named), len(fresh))],
        ["distinct pictures", len(ref_names), len(set(named))],
        ["sample pictures", len([n for n in ref_names if n in images.SAMPLES]), len({n for n in named if n in images.SAMPLES})],
        ["pictures no reference row names", None, len({n for n in named if n not in ref_names})],
        ["pictures missing from the data directory", None, len({n for n in named if not _present(n)})],
        ["rows naming a held-out row's picture", None, sum(1 for n in named if n in held_names and n not in ref_names)],
    ]
    kit.emit(args, ["measure", "reference", "new"], rows)
    return 0


# ---------- drift questions ----------


def _configure_questions(parser: Any) -> None:
    _common(parser)
    parser.add_argument("--min-gap", type=float, metavar="X",
                        help="only questions whose share of rows with every field filled moved by X or more; exit 1 if any")
    kit.add_format(parser)


def _reads(row: Any, paths: List[str]) -> bool:
    state = _inputs(row)
    return all(any(not _blank(value) for _route, value in preflight_states._lookup(state, path)) for path in paths)


def run_questions(args: Any) -> int:
    dataset, reference, fresh, _left = _sides(args)
    raw = dataset.get("questions") if isinstance(dataset.get("questions"), dict) else {}
    rows = []
    for qid, question in raw.items():
        paths = sorted(set(path for path in lint._paths(question) if path != workbench.PHOTO_FIELD)) if isinstance(question, dict) else []
        if not paths:
            continue
        rs = _share(sum(_reads(row, paths) for row in reference), len(reference))
        ns = _share(sum(_reads(row, paths) for row in fresh), len(fresh))
        gap = round((ns or 0.0) - (rs or 0.0), 6)
        if args.min_gap is not None and abs(gap) + 1e-9 < args.min_gap:
            continue
        rows.append([qid, ", ".join(paths), rs, ns, gap])
    empty = ("no question's fields moved by %s or more" % kit.cell_text(args.min_gap) if args.min_gap is not None
             else "no question of the dataset points at a field")
    _emit(args, ["question", "fields", "reference share", "new share", "gap"], rows, empty)
    return 1 if args.min_gap is not None and rows else 0


# ---------- drift summary ----------


def _configure_summary(parser: Any) -> None:
    _common(parser)
    parser.add_argument("--ratio", type=float, default=1.5, metavar="X",
                        help="a text field's median length moving by this factor counts as a shift (default 1.5)")
    parser.add_argument("--json", action="store_true", help="print the summary as one JSON object")


def run_summary(args: Any) -> int:
    if args.ratio <= 1:
        raise kit.CliError("--ratio must be above 1")
    dataset, reference, fresh, left = _sides(args)
    fields = _field_rows(reference, fresh)
    tuning = {driftsession.input_key(row) for row in reference}
    new_values = []
    for name in _fields(reference):
        ref = _counts(reference, name)
        if 2 <= len(ref) <= slices.MAX_VALUES and len(ref) < len(reference) and any(value not in ref for value in _counts(fresh, name)):
            new_values.append(name)
    lengths = [name for name in _fields(reference, fresh)
               if _shifted(_median(_lengths(fresh, name)), _median(_lengths(reference, name)), args.ratio)]
    types = [name for name in _fields(reference, fresh)
             if _mix(reference, name) and _mix(fresh, name) and set(_mix(reference, name)) != set(_mix(fresh, name))]
    facts = {
        "reference_rows": len(reference), "new_rows": len(fresh),
        "left_out_marked": left["marked"], "left_out_held_out_copies": left["held_out_copies"],
        "copies_of_tuning_rows": sum(1 for row in fresh if driftsession.input_key(row) in tuning),
        "fields_added": [row[0] for row in fields if row[6] == "new"],
        "fields_gone": [row[0] for row in fields if row[6] == "gone"],
        "types_changed": types, "new_slice_values": new_values, "lengths_shifted": lengths,
    }
    shifts = sum(len(facts[key]) for key in ("fields_added", "fields_gone", "types_changed", "new_slice_values", "lengths_shifted"))
    if args.json:
        print(json.dumps(dict(facts, dataset=dataset["id"], shifts=shifts), ensure_ascii=False))
    else:
        print("%s: %d reference rows, %d new rows" % (dataset["id"], len(reference), len(fresh)))
        for label, key in (("fields added", "fields_added"), ("fields gone", "fields_gone"), ("types changed", "types_changed"),
                           ("new values in slice fields", "new_slice_values"), ("median length shifted", "lengths_shifted")):
            print("%s: %s" % (label, ", ".join(facts[key]) or "none"))
        print("new rows copying tuning rows: %d" % facts["copies_of_tuning_rows"])
        print("shifts: %d" % shifts)
    return 1 if shifts else 0


PACK = kit.define_pack({
    "id": "cli-drift",
    "surface": "python.cli",
    "title": "Offline drift helpers",
    "about": "Offline `lab.py drift` commands that compare a file of new rows with a saved dataset's tuning inputs "
             "before a paid drift run: field presence, slice values, value types, text lengths, pictures and overlap. "
             "New rows marked as test rows, and copies of held-out rows, are left out and counted, as Drift does. "
             "Inputs only: no labels, no answers, no model call.",
    "features": [
        {"id": "fields", "kind": "cli", "command": ["drift", "fields"], "configure": _configure_fields, "run": run_fields,
         "title": "Compare how often each input field is filled on the dataset's tuning rows and on new rows, marking new and gone fields",
         "options": [{"id": "min_gap", "title": "--min-gap X keeps fields whose filled share moved by X or more and exits 1 if any"},
                     {"id": "sort", "title": "--sort gap orders fields by how far their share moved"},
                     dict(FROM), dict(FORMAT)]},
        {"id": "values", "kind": "cli", "command": ["drift", "values"], "configure": _configure_values, "run": run_values,
         "title": "Compare one field's values on tuning rows and new rows, with counts, shares and new or gone values",
         "options": [{"id": "new_only", "title": "--new-only keeps values no tuning row has and exits 1 if any"},
                     {"id": "top", "title": "--top N keeps the N most common values"}, dict(FORMAT)]},
        {"id": "lengths", "kind": "cli", "command": ["drift", "lengths"], "configure": _configure_lengths, "run": run_lengths,
         "title": "Compare text lengths per field: median and 90th percentile on each side, their ratio and a Mann-Whitney p-value",
         "options": [{"id": "field", "title": "--field FIELD compares one text field"},
                     {"id": "min_ratio", "title": "--min-ratio X keeps fields whose median length moved by a factor of X and exits 1 if any"},
                     dict(FORMAT)]},
        {"id": "overlap", "kind": "cli", "command": ["drift", "overlap"], "configure": _configure_overlap, "run": run_overlap,
         "title": "Count new rows that copy a tuning row, copy a held-out row, are marked as test rows, repeat each other, or are new",
         "options": [{"id": "rows", "title": "--rows lists the new rows' line numbers for each kind"},
                     {"id": "fail", "title": "--fail exits 1 when a new row copies a saved row"},
                     {"id": "export", "title": "--export prints only the new inputs as JSON lines, without labels or test markers"},
                     dict(FORMAT)]},
        {"id": "types", "kind": "cli", "command": ["drift", "types"], "configure": _configure_types, "run": run_types,
         "title": "Compare each field's value types (text, number, true/false, list, object) on tuning rows and new rows",
         "options": [{"id": "changed", "title": "--changed keeps fields whose types differ and exits 1 if any"}, dict(FORMAT)]},
        {"id": "pictures", "kind": "cli", "command": ["drift", "pictures"], "configure": _configure_pictures, "run": run_pictures,
         "title": "Compare picture use: rows with a picture, distinct and sample pictures, unseen and missing pictures",
         "options": [dict(FORMAT)]},
        {"id": "questions", "kind": "cli", "command": ["drift", "questions"], "configure": _configure_questions, "run": run_questions,
         "title": "Compare, per question, how many tuning and new rows fill every field the question points at",
         "options": [{"id": "min_gap", "title": "--min-gap X keeps questions whose share moved by X or more and exits 1 if any"},
                     dict(FORMAT)]},
        {"id": "summary", "kind": "cli", "command": ["drift", "summary"], "configure": _configure_summary, "run": run_summary,
         "title": "Summarize input drift in one report: fields added or gone, type changes, new slice values, length shifts; exit 1 on a shift",
         "options": [{"id": "ratio", "title": "--ratio X sets the median length factor that counts as a shift (default 1.5)"},
                     {"id": "json", "title": "--json prints the summary as one JSON object"}]},
    ],
})
