"""Browse saved Workbench datasets offline: `lab.py datasets list|show|fields|slices|check|history|questions|pictures|
find`.

Every command reads data/workbench/datasets through the app's loaders (so --data-dir applies), prints through kit, and
never writes. Held-out test rows are counted, never shown: no label value, input value or picture name of a held-out
row appears in any output. A value that appears only on held-out rows is folded into one "(held-out only)" count.

The small row helpers here (is_test, labels_of, inputs_of, preview, ...) are shared with cli_datasets_quality.
"""

from __future__ import annotations

import argparse
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from jev import decisions, health, history, images, slices, workbench
from jev.lab import kit

LABEL = workbench.LABEL_KEY
TEST = workbench.TEST_KEY
IMAGE = workbench.IMAGE_KEY
HELD_OUT_ONLY = "(held-out only)"
OTHER = "(other)"
NONE = slices.NONE
VERSIONED = re.compile(r"jev-\d+\.\d+(\.\d+)?")  # as jev.client.VERSIONED_MODEL: a model id that never moves


# ---------- row helpers (also used by cli_datasets_quality) ----------


def load(ident: str) -> dict:
    """A saved dataset by id, through the app's loader; a missing or invalid one exits 2."""
    return workbench.load_dataset(ident)


def is_test(row: Any) -> bool:
    return isinstance(row, dict) and row.get(TEST) is True


def labels_of(row: Any) -> dict:
    value = row.get(LABEL) if isinstance(row, dict) else None
    return value if isinstance(value, dict) else {}


def has_label(row: Any) -> bool:
    return any(value is not None for value in labels_of(row).values())


def inputs_of(row: Any) -> dict:
    """A row's input fields: a text row is its "text" field; labels and the test marker are left out."""
    if isinstance(row, str):
        return {"text": row}
    if isinstance(row, dict):
        return {k: v for k, v in row.items() if k not in (LABEL, TEST)}
    return {}


def identity(row: Any) -> str:
    """The dataset-health and Review identity: labels and test markers ignored, pictures kept."""
    return decisions._key(row)


def questions_of(dataset: dict) -> Dict[str, dict]:
    questions = dataset.get("questions")
    return {k: v for k, v in questions.items() if isinstance(v, dict)} if isinstance(questions, dict) else {}


def question(dataset: dict, qid: Optional[str]) -> Optional[dict]:
    """The named question, or CliError when the dataset does not ask it."""
    if qid is None:
        return None
    asked = questions_of(dataset)
    if qid not in asked:
        raise kit.CliError("Dataset %r has no question %r (it asks: %s)" % (dataset["id"], qid, ", ".join(asked) or "none"))
    return asked[qid]


def label_value(spec: dict, value: Any) -> Tuple[bool, Any]:
    """(valid, normalized label), read as dataset health reads it. (True, None) is no label. A label for a question
    a hand-edited file left without its type or options reads as invalid instead of failing."""
    try:
        return health._label(spec, value)
    except (KeyError, TypeError, AttributeError):
        return False, None


def numbered(dataset: dict) -> List[Tuple[int, Any]]:
    """(1-based row number, row) for every row of the dataset."""
    return list(enumerate(dataset["rows"], 1))


def tuning(dataset: dict) -> List[Tuple[int, Any]]:
    return [(n, row) for n, row in numbered(dataset) if not is_test(row)]


def held_out(dataset: dict) -> List[Tuple[int, Any]]:
    return [(n, row) for n, row in numbered(dataset) if is_test(row)]


def one_line(text: str, width: Optional[int]) -> str:
    text = " ".join(str(text).split())
    if width is not None and len(text) > width:
        return text[:width - 1] + "…"
    return text


def preview(row: Any, width: Optional[int] = 60) -> str:
    """A tuning row's input as one short line: its text, or its fields as JSON. Never call it on a held-out row."""
    state = workbench.without_marks(row)
    if isinstance(state, dict) and isinstance(state.get("text"), str):
        text = state["text"]
    elif isinstance(state, str):
        text = state
    else:
        text = json.dumps(state, ensure_ascii=False)
    return one_line(text, width)


def value_type(value: Any) -> str:
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


def slice_value(row: Any, field: str) -> str:
    """The full normalized value By slice groups a row under ("(none)" when the field is absent or empty)."""
    return slices._value(inputs_of(row), field)


def positive(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError("%r is not a whole number" % text)
    if value < 1:
        raise argparse.ArgumentTypeError("must be 1 or more")
    return value


def unit(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError("%r is not a number" % text)
    if not 0 <= value <= 1:
        raise argparse.ArgumentTypeError("must be from 0 to 1")
    return value


def share(part: int, whole: int) -> Optional[float]:
    return round(part / whole, 4) if whole else None


# ---------- datasets list ----------

LIST_COLUMNS = ["id", "name", "rows", "test", "labeled", "questions", "check", "saved"]
SORTS = {"id": (lambda s: s["id"], False), "name": (lambda s: str(s["name"] or "").lower(), False),
         "rows": (lambda s: s["rows"], True), "labeled": (lambda s: s["labeled"], True),
         "saved": (lambda s: str(s["saved_at"] or ""), True)}


def configure_list(parser) -> None:
    kit.add_format(parser)
    parser.add_argument("--sort", choices=sorted(SORTS), default="id",
                        help="order by id or name (A to Z), or rows, labeled rows or saved time (largest/newest first)")
    parser.add_argument("--reverse", action="store_true", help="reverse the order")
    parser.add_argument("--limit", type=positive, help="keep the first N datasets after sorting")
    parser.add_argument("--search", metavar="TEXT", help="only datasets whose id, name or notes contain TEXT (any case)")
    parser.add_argument("--check", choices=("yes", "no"), help="only datasets with (yes) or without (no) a saved check")
    parser.add_argument("--split", choices=("yes", "no"), help="only datasets with (yes) or without (no) held-out test rows")
    parser.add_argument("--min-rows", type=positive, metavar="N", help="only datasets with at least N rows")
    parser.add_argument("--question", metavar="QID", help="only datasets that ask question QID")
    parser.add_argument("--ids", action="store_true", help="print only the ids, one per line")
    parser.add_argument("--totals", action="store_true", help="add a (total) row summing rows, test rows and labeled rows")


def run_list(args) -> int:
    found = workbench.list_datasets()
    if not found:
        print("No saved datasets.")
        return 0
    if args.search:
        needle = args.search.lower()
        found = [s for s in found if any(needle in str(s.get(k) or "").lower() for k in ("id", "name", "notes"))]
    if args.check:
        found = [s for s in found if bool(s["check"]) == (args.check == "yes")]
    if args.split:
        found = [s for s in found if bool(s["test"]) == (args.split == "yes")]
    if args.min_rows:
        found = [s for s in found if s["rows"] >= args.min_rows]
    if args.question:
        found = [s for s in found if args.question in questions_of(load(s["id"]))]
    key, descending = SORTS[args.sort]
    found = sorted(found, key=lambda s: (s["id"],))
    found = sorted(found, key=key, reverse=descending != args.reverse)
    if args.limit:
        found = found[:args.limit]
    if args.ids:
        for summary in found:
            print(summary["id"])
        return 0
    rows = [[s["id"], s["name"], s["rows"], s["test"]["rows"] if s["test"] else 0, s["labeled"], s["questions"],
             bool(s["check"]), s["saved_at"]] for s in found]
    if args.totals:
        rows.append(["(total)", None, sum(r[2] for r in rows), sum(r[3] for r in rows), sum(r[4] for r in rows),
                     None, None, None])
    kit.emit(args, LIST_COLUMNS, rows)
    return 0


# ---------- datasets show ----------


def configure_show(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    what = parser.add_mutually_exclusive_group()
    what.add_argument("--questions", action="store_true", help="list the questions: id, type, options and instructions")
    what.add_argument("--criteria", metavar="QID", help="list one question's options or levels with their descriptions")
    what.add_argument("--rules", action="store_true", help="print the saved consistency rules, one per line")
    what.add_argument("--guidelines", action="store_true",
                      help="count the labeling guidelines per question (whether a note is written, how many examples)")


def _options(spec: dict) -> int:
    criteria = spec.get("criteria")
    if spec.get("type") == "noul":
        return 2
    return len(criteria) if isinstance(criteria, (dict, list)) else 0


def run_show(args) -> int:
    dataset = load(args.dataset)
    asked = questions_of(dataset)
    if args.questions:
        kit.emit(args, ["question", "type", "options", "instructions"],
                 [[qid, spec.get("type"), _options(spec), one_line(spec.get("instructions") or "", 60)]
                  for qid, spec in asked.items()])
        return 0
    if args.criteria is not None:
        spec = question(dataset, args.criteria)
        criteria = spec.get("criteria")
        if isinstance(criteria, list):
            rows = [[level, text] for level, text in enumerate(criteria)]
        elif isinstance(criteria, dict):
            rows = [[key, text] for key, text in criteria.items()]
        else:
            rows = []
        kit.emit(args, ["option", "description"], rows)
        return 0
    if args.rules:
        text = dataset.get("rules")
        lines = [line for line in str(text).splitlines() if line.strip()] if isinstance(text, str) else []
        print("\n".join(lines) if lines else "(no rules)")
        return 0
    if args.guidelines:
        guides = dataset.get("guidelines") if isinstance(dataset.get("guidelines"), dict) else {}
        guides = {qid: guide for qid, guide in guides.items() if isinstance(guide, dict)}
        kit.emit(args, ["question", "note", "examples"],
                 [[qid, bool(guides[qid].get("note")),
                   len(guides[qid]["examples"]) if isinstance(guides[qid].get("examples"), list) else 0]
                  for qid in asked if qid in guides])
        return 0
    rows = dataset["rows"]
    test = dataset.get("test") if isinstance(dataset.get("test"), dict) else {}
    check = dataset.get("check") if isinstance(dataset.get("check"), dict) else None
    rules = [line for line in str(dataset.get("rules") or "").splitlines() if line.strip() and not line.strip().startswith("#")]
    pairs = [
        ("id", dataset["id"]), ("name", dataset.get("name")), ("notes", dataset.get("notes") or ""),
        ("saved_at", dataset.get("saved_at")), ("rows", len(rows)),
        ("tuning_rows", sum(1 for row in rows if not is_test(row))),
        ("test_rows", sum(1 for row in rows if is_test(row))),
        ("labeled_tuning_rows", sum(1 for row in rows if not is_test(row) and has_label(row))),
        ("labeled_test_rows", sum(1 for row in rows if is_test(row) and has_label(row))),
        ("questions", ", ".join(asked)),
        ("picture_rows", sum(1 for row in rows if isinstance(row, dict) and IMAGE in row)),
        ("rules", len(rules)), ("check", check.get("model") if check else None),
        ("guidelines", len(dataset["guidelines"]) if isinstance(dataset.get("guidelines"), dict) else 0),
        ("test_looks", len(test.get("looks") or []) if test else 0),
    ]
    kit.emit(args, ["field", "value"], [list(pair) for pair in pairs])
    return 0


# ---------- datasets fields ----------


def _flatten(fields: Dict[str, Any], nested: bool, prefix: str = "") -> List[Tuple[str, Any]]:
    out = []
    for name, value in fields.items():
        path = prefix + str(name)
        out.append((path, value))
        if nested and isinstance(value, dict):
            out.extend(_flatten(value, True, path + "."))
    return out


def configure_fields(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--tuning", action="store_true", help="count tuning rows only, leaving held-out rows out")
    parser.add_argument("--min-fill", type=unit, metavar="SHARE", help="only fields filled on at least SHARE (0-1) of rows")
    parser.add_argument("--sort", choices=("first", "field", "fill", "distinct"), default="first",
                        help="order: first appearance (default), field name, fill rate or distinct values (most first)")
    parser.add_argument("--sliceable", action="store_true",
                        help="only fields By slice can split rows by: 2 to %d distinct values, counting (none)" % slices.MAX_VALUES)
    parser.add_argument("--nested", action="store_true", help="also list the keys inside object fields as dotted paths")


def run_fields(args) -> int:
    dataset = load(args.dataset)
    rows = [(is_test(row), dict(_flatten(inputs_of(row), args.nested)))
            for _n, row in (tuning(dataset) if args.tuning else numbered(dataset))]
    order: List[str] = []
    stats: Dict[str, dict] = {}
    for test, flat in rows:
        for name in flat:
            if not test and name not in stats:  # names and types come from tuning rows; held-out rows are only counted
                order.append(name)
                stats[name] = {"types": set(), "filled": 0, "values": set()}
    for test, flat in rows:
        for name in order:
            value = slices._value(flat, name)
            stats[name]["values"].add(value)
            if value != NONE:
                stats[name]["filled"] += 1
                if not test:
                    stats[name]["types"].add("picture" if name == IMAGE else value_type(flat[name]))
    out = []
    for position, name in enumerate(order):
        entry = stats[name]
        distinct = len(entry["values"] - {NONE})
        fill = share(entry["filled"], len(rows))
        if args.min_fill is not None and (fill or 0) < args.min_fill:
            continue
        if args.sliceable and not 2 <= len(entry["values"]) <= slices.MAX_VALUES:
            continue
        out.append((position, [name, "/".join(sorted(entry["types"])), entry["filled"], fill, distinct]))
    if args.sort == "field":
        out.sort(key=lambda item: item[1][0])
    elif args.sort == "fill":
        out.sort(key=lambda item: (-(item[1][3] or 0), item[0]))
    elif args.sort == "distinct":
        out.sort(key=lambda item: (-item[1][4], item[0]))
    kit.emit(args, ["field", "types", "filled", "fill", "distinct"], [row for _p, row in out])
    return 0


# ---------- datasets slices ----------


def configure_slices(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    parser.add_argument("field", help="input field to group rows by")
    kit.add_format(parser)
    parser.add_argument("--question", metavar="QID", help="count valid labels and missing labels for QID per value")
    parser.add_argument("--top", type=positive, metavar="N", help="keep the N values with most tuning rows; fold the rest into (other)")
    parser.add_argument("--sort", choices=("count", "value"), default="count", help="order by tuning rows (default) or value")
    parser.add_argument("--min-rows", type=positive, metavar="N", help="hide values with fewer than N tuning rows")
    parser.add_argument("--share", action="store_true", help="add each value's share of the tuning rows")
    parser.add_argument("--full", action="store_true", help="print values in full instead of cutting them at %d characters" % slices.MAX_VALUE_CHARS)


def run_slices(args) -> int:
    dataset = load(args.dataset)
    spec = question(dataset, args.question)
    train = [row for _n, row in tuning(dataset)]
    if not any(args.field in inputs_of(row) for row in train):
        raise kit.CliError("No tuning row of %r has the field %r" % (dataset["id"], args.field))
    groups: Dict[str, dict] = {}
    for row in train:
        group = groups.setdefault(slice_value(row, args.field), {"tuning": 0, "test": 0, "labeled": 0, "missing": 0})
        group["tuning"] += 1
        if spec is None:
            group["labeled"] += has_label(row)
        else:
            raw = labels_of(row).get(args.question)
            ok, value = label_value(spec, raw)
            group["labeled"] += bool(ok and value is not None)
            group["missing"] += raw is None
    only = 0
    for _n, row in held_out(dataset):
        value = slice_value(row, args.field)
        if value in groups:
            groups[value]["test"] += 1
        else:
            only += 1
    if args.sort == "value":
        ordered = sorted(groups.items(), key=lambda item: (item[0] == NONE, item[0]))
    else:
        ordered = sorted(groups.items(), key=lambda item: (-item[1]["tuning"], item[0] == NONE, item[0]))
    if args.min_rows:
        ordered = [item for item in ordered if item[1]["tuning"] >= args.min_rows]
    if args.top and len(ordered) > args.top:
        if args.sort == "value":  # the largest N, still in value order
            keep = {value for value, _g in sorted(ordered, key=lambda item: (-item[1]["tuning"], item[0] == NONE, item[0]))[:args.top]}
        else:
            keep = {value for value, _g in ordered[:args.top]}
        rest = [group for value, group in ordered if value not in keep]
        folded = {k: sum(group[k] for group in rest) for k in ("tuning", "test", "labeled", "missing")}
        ordered = [item for item in ordered if item[0] in keep] + [(OTHER, folded)]
    total = len(train)
    columns = ["value", "tuning", "test", "labeled"] + (["missing"] if spec is not None else []) + (["share"] if args.share else [])
    out = []
    for value, group in ordered + ([(HELD_OUT_ONLY, {"tuning": 0, "test": only, "labeled": 0, "missing": 0})] if only else []):
        shown = value if args.full or value in (OTHER, HELD_OUT_ONLY) else slices._shown(value)
        line = [shown, group["tuning"], group["test"], group["labeled"]]
        if spec is not None:
            line.append(group["missing"])
        if args.share:
            line.append(share(group["tuning"], total))
        out.append(line)
    kit.emit(args, columns, out)
    return 0


# ---------- datasets check ----------


def _check(dataset: dict) -> dict:
    check = dataset.get("check")
    if not isinstance(check, dict):
        raise kit.CliError("Dataset %r has no saved check. Save one from Policy first." % dataset["id"])
    return check


def _rule_lines(text: Any) -> List[str]:
    return [line.strip() for line in str(text or "").splitlines() if line.strip() and not line.strip().startswith("#")]


def configure_check(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    what = parser.add_mutually_exclusive_group()
    what.add_argument("--gates", action="store_true", help="list each gated question with its type and threshold")
    what.add_argument("--slice-targets", action="store_true", help="list the slice targets: field, value and their targets")
    what.add_argument("--answer-sets", action="store_true", help="list the answer-set cuts: question, cut and coverage")
    what.add_argument("--pin", action="store_true",
                      help="exit 1 when the check asks a moving alias (such as jev-latest) instead of a versioned model")


def run_check(args) -> int:
    dataset = load(args.dataset)
    check = _check(dataset)
    asked = questions_of(dataset)
    gates = check.get("gates") if isinstance(check.get("gates"), dict) else {}
    targets = check.get("slice_targets") if isinstance(check.get("slice_targets"), list) else []
    cuts = check.get("answer_sets") if isinstance(check.get("answer_sets"), dict) else {}
    if args.gates:
        kit.emit(args, ["question", "type", "threshold"],
                 [[qid, (asked.get(qid) or {}).get("type"), threshold] for qid, threshold in gates.items()])
        return 0
    if args.slice_targets:
        kit.emit(args, ["field", "value", "min_accuracy", "min_coverage"],
                 [[t.get("field"), t.get("value"), t.get("min_accuracy"), t.get("min_coverage")] for t in targets if isinstance(t, dict)])
        return 0
    if args.answer_sets:
        kit.emit(args, ["question", "cut", "coverage"],
                 [[qid, (cut or {}).get("cut"), (cut or {}).get("coverage")] for qid, cut in cuts.items()])
        return 0
    model = str(check.get("model") or "")
    if args.pin:
        if VERSIONED.fullmatch(model):
            print("%s asks %s, a versioned model." % (dataset["id"], model))
            return 0
        tuned = check.get("tuned_on")
        print("%s asks %s, an alias that moves when a new version ships%s." % (
            dataset["id"], model, "; its thresholds were tuned on %s" % tuned if tuned else ""))
        return 1
    pairs = [("model", model), ("tuned_on", check.get("tuned_on")), ("signal", check.get("signal", "confidence")),
             ("bound", check.get("bound", "estimate")), ("min_accuracy", check.get("min_accuracy")),
             ("min_coverage", check.get("min_coverage")), ("gates", len(gates)), ("rules", len(_rule_lines(check.get("rules")))),
             ("slice_targets", len(targets)), ("answer_sets", len(cuts)), ("saved_at", check.get("saved_at"))]
    kit.emit(args, ["field", "value"], [list(pair) for pair in pairs])
    return 0


# ---------- datasets history ----------


def configure_history(parser) -> None:
    parser.add_argument("dataset", nargs="?", help="dataset id (leave out with --deleted)")
    kit.add_format(parser)
    parser.add_argument("--limit", type=positive, metavar="N", help="keep the newest N revisions")
    parser.add_argument("--changes", action="store_true", help="add how rows and labeled rows changed from the revision before")
    parser.add_argument("--since", metavar="DATE", help="only revisions kept at or after DATE (YYYY-MM-DD or a longer UTC time)")
    parser.add_argument("--deleted", action="store_true", help="list deleted datasets whose history is kept, so a delete can be undone")


def run_history(args) -> int:
    if args.deleted:
        if args.dataset:
            raise kit.CliError("--deleted lists every deleted dataset; leave out the dataset id")
        kit.emit(args, ["id", "name", "revisions", "latest"],
                 [[item["id"], item.get("name"), item["revisions"], item["latest"]] for item in history.deleted()])
        return 0
    if not args.dataset:
        raise kit.CliError("Name a dataset id, or use --deleted")
    if args.since is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}(T[\d:.]*Z?)?", args.since):
        raise kit.CliError("--since takes a date such as 2026-11-01 or a UTC time such as 2026-11-01T09:30:00Z")
    found = history.revisions(args.dataset)["revisions"]  # newest first
    if not found:
        print("No revisions kept for %r." % args.dataset)
        return 0
    lines = []
    for index, entry in enumerate(found):
        line = [entry["revision"], entry["at"], entry.get("rows"), entry.get("labeled"), entry.get("test_rows"),
                len(entry.get("questions") or []), bool(entry.get("checks")), entry["current"]]
        if args.changes:
            older = found[index + 1] if index + 1 < len(found) else None
            for key in ("rows", "labeled"):
                ok = older is not None and isinstance(entry.get(key), int) and isinstance(older.get(key), int)
                line.append(entry[key] - older[key] if ok else None)
        lines.append((entry["at"], line))
    if args.since is not None:
        since = args.since.rstrip("Z")
        lines = [item for item in lines if item[0] >= since]
    if args.limit:
        lines = lines[:args.limit]
    columns = ["revision", "at", "rows", "labeled", "test", "questions", "check", "current"]
    kit.emit(args, columns + (["rows_change", "labeled_change"] if args.changes else []), [line for _at, line in lines])
    return 0


# ---------- datasets questions ----------


def configure_questions(parser) -> None:
    kit.add_format(parser)
    parser.add_argument("--type", choices=workbench.QUESTION_TYPES, help="only questions of this type")
    parser.add_argument("--shared", action="store_true", help="only questions asked by two or more datasets")
    parser.add_argument("--mismatch", action="store_true",
                        help="only question ids whose type or options differ between datasets; exit 1 when there are any")


def run_questions(args) -> int:
    seen: Dict[str, List[Tuple[str, dict]]] = {}
    for summary in workbench.list_datasets():
        for qid, spec in questions_of(load(summary["id"])).items():
            seen.setdefault(qid, []).append((summary["id"], spec))
    out = []
    for qid in sorted(seen):
        uses = seen[qid]
        types = sorted({str(spec.get("type")) for _id, spec in uses})
        shapes = {json.dumps([spec.get("type"), spec.get("criteria")], sort_keys=True) for _id, spec in uses}
        if args.type and args.type not in types:
            continue
        if args.shared and len(uses) < 2:
            continue
        if args.mismatch and len(shapes) < 2:
            continue
        out.append([qid, "/".join(types), len(uses), ", ".join(ident for ident, _spec in uses)])
    kit.emit(args, ["question", "type", "datasets", "ids"], out)
    return 1 if args.mismatch and out else 0


# ---------- datasets pictures ----------


def configure_pictures(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--missing", action="store_true",
                        help="only uploaded pictures whose file is not in the images folder; exit 1 when there are any")


def run_pictures(args) -> int:
    dataset = load(args.dataset)
    counts: Dict[str, List[int]] = {}
    for _n, row in tuning(dataset):
        if isinstance(row, dict) and isinstance(row.get(IMAGE), str):
            counts.setdefault(row[IMAGE], [0, 0])[0] += 1
    only, only_missing = 0, 0
    for _n, row in held_out(dataset):
        name = row.get(IMAGE)
        if not isinstance(name, str):
            continue
        if name in counts:
            counts[name][1] += 1
        else:
            only += 1
            only_missing += not _present(name)
    out = []
    for name in sorted(counts):
        present = _present(name)
        if args.missing and present:
            continue
        out.append([name, "sample" if name in images.SAMPLES else "uploaded", counts[name][0], counts[name][1],
                    "present" if present else "missing"])
    if args.missing and only_missing:
        out.append([HELD_OUT_ONLY, None, 0, only_missing, "missing"])
    elif not args.missing and only:
        out.append([HELD_OUT_ONLY, None, 0, only, None])
    kit.emit(args, ["picture", "kind", "tuning", "test", "file"], out)
    return 1 if args.missing and out else 0


def _present(name: str) -> bool:
    return name in images.SAMPLES or (workbench.images_dir() / name).is_file()


# ---------- datasets find ----------


def configure_find(parser) -> None:
    parser.add_argument("text", help="text to look for in tuning rows' input values (any case)")
    kit.add_format(parser)
    parser.add_argument("--field", metavar="NAME", help="look only in this input field")
    parser.add_argument("--regex", action="store_true", help="read TEXT as a regular expression (any case)")
    parser.add_argument("--dataset", metavar="ID", help="look only in this dataset")


def _strings(value: Any, path: str) -> List[Tuple[str, str]]:
    if isinstance(value, str):
        return [(path, value)]
    if isinstance(value, dict):
        return [hit for key, inner in value.items() for hit in _strings(inner, "%s.%s" % (path, key))]
    if isinstance(value, list):
        return [hit for index, inner in enumerate(value) for hit in _strings(inner, "%s[%d]" % (path, index))]
    return []


def run_find(args) -> int:
    if args.regex:
        try:
            pattern = re.compile(args.text, re.IGNORECASE)
        except re.error as err:
            raise kit.CliError("--regex: %s" % err)
    else:
        pattern = re.compile(re.escape(args.text), re.IGNORECASE)
    idents = [load(args.dataset)["id"]] if args.dataset else [s["id"] for s in workbench.list_datasets()]
    out = []
    for ident in idents:
        for number, row in tuning(load(ident)):
            for name, value in inputs_of(row).items():
                if name == IMAGE or (args.field is not None and name != args.field):
                    continue
                for path, text in _strings(value, name):
                    if pattern.search(text):
                        out.append([ident, number, path, one_line(text, 60)])
    kit.emit(args, ["dataset", "row", "field", "value"], out)
    return 1 if out else 0


PACK = kit.define_pack({
    "id": "cli-datasets-browse",
    "surface": "python.cli",
    "title": "Browse saved datasets",
    "about": "Offline `lab.py datasets` commands that list saved Workbench datasets and show their configuration, input "
             "fields, slices, saved check, revision history, questions and pictures. Held-out rows appear only as counts.",
    "features": [
        {"id": "list", "kind": "cli", "command": ["datasets", "list"], "configure": configure_list, "run": run_list,
         "title": "list saved datasets with their rows, held-out rows, labeled rows, questions and whether a check is saved",
         "options": [
             {"id": "format", "title": "--format json|csv|markdown prints the dataset list for scripts and docs"},
             {"id": "sort", "title": "--sort id|name|rows|labeled|saved orders the dataset list"},
             {"id": "reverse", "title": "--reverse flips the dataset list's order"},
             {"id": "limit", "title": "--limit N keeps the first N datasets"},
             {"id": "search", "title": "--search TEXT keeps datasets whose id, name or notes mention TEXT"},
             {"id": "check", "title": "--check yes|no keeps datasets with or without a saved check"},
             {"id": "split", "title": "--split yes|no keeps datasets with or without held-out test rows"},
             {"id": "min_rows", "title": "--min-rows N keeps datasets with at least N rows"},
             {"id": "question", "title": "--question QID keeps datasets that ask that question"},
             {"id": "ids", "title": "--ids prints only dataset ids, one per line, for shell loops"},
             {"id": "totals", "title": "--totals adds a row summing rows, held-out rows and labeled rows"},
         ]},
        {"id": "show", "kind": "cli", "command": ["datasets", "show"], "configure": configure_show, "run": run_show,
         "title": "summarize one dataset: notes, row and label counts, questions, pictures, rules, check and test looks",
         "options": [
             {"id": "questions", "title": "--questions lists each question's type, option count and instructions"},
             {"id": "criteria", "title": "--criteria QID lists one question's options or score levels with descriptions"},
             {"id": "rules", "title": "--rules prints the dataset's saved consistency rules"},
             {"id": "guidelines", "title": "--guidelines counts labeling-guideline notes and examples per question, without their text"},
         ]},
        {"id": "fields", "kind": "cli", "command": ["datasets", "fields"], "configure": configure_fields, "run": run_fields,
         "title": "inventory a dataset's input fields with value types, fill rates and distinct-value counts",
         "options": [
             {"id": "tuning", "title": "--tuning counts tuning rows only"},
             {"id": "min_fill", "title": "--min-fill SHARE hides sparsely filled fields"},
             {"id": "sort", "title": "--sort field|fill|distinct orders the field inventory"},
             {"id": "sliceable", "title": "--sliceable keeps fields By slice can group rows by"},
             {"id": "nested", "title": "--nested adds the keys inside object fields as dotted paths"},
         ]},
        {"id": "slices", "kind": "cli", "command": ["datasets", "slices"], "configure": configure_slices, "run": run_slices,
         "title": "count tuning, held-out and labeled rows per value of an input field, values from tuning rows only",
         "options": [
             {"id": "question", "title": "--question QID counts valid and missing labels for that question per value"},
             {"id": "top", "title": "--top N keeps the N largest values and folds the rest into (other)"},
             {"id": "sort", "title": "--sort value orders slices by value instead of size"},
             {"id": "min_rows", "title": "--min-rows N hides values with fewer tuning rows"},
             {"id": "share", "title": "--share adds each value's share of the tuning rows"},
             {"id": "full", "title": "--full prints long values whole instead of cutting them"},
         ]},
        {"id": "check", "kind": "cli", "command": ["datasets", "check"], "configure": configure_check, "run": run_check,
         "title": "summarize a dataset's saved check: model, tuned-on version, targets and counts of gates, rules, slices and cuts",
         "options": [
             {"id": "gates", "title": "--gates lists each gated question's type and threshold"},
             {"id": "slice_targets", "title": "--slice-targets lists the required slices and their targets"},
             {"id": "answer_sets", "title": "--answer-sets lists the saved answer-set cuts and coverage"},
             {"id": "pin", "title": "--pin exits 1 when the check asks a moving model alias"},
         ]},
        {"id": "history", "kind": "cli", "command": ["datasets", "history"], "configure": configure_history, "run": run_history,
         "title": "list a dataset's kept revisions with row, label, held-out and question counts",
         "options": [
             {"id": "limit", "title": "--limit N keeps the newest N revisions"},
             {"id": "changes", "title": "--changes adds row and labeled-row changes from the revision before"},
             {"id": "since", "title": "--since DATE keeps revisions kept at or after that date"},
             {"id": "deleted", "title": "--deleted lists deleted datasets whose history can still undo the delete"},
         ]},
        {"id": "questions", "kind": "cli", "command": ["datasets", "questions"], "configure": configure_questions, "run": run_questions,
         "title": "inventory question ids across datasets with their types and the datasets that ask them",
         "options": [
             {"id": "type", "title": "--type keeps questions of one type"},
             {"id": "shared", "title": "--shared keeps questions asked by two or more datasets"},
             {"id": "mismatch", "title": "--mismatch lists question ids whose type or options differ between datasets, exiting 1"},
         ]},
        {"id": "pictures", "kind": "cli", "command": ["datasets", "pictures"], "configure": configure_pictures, "run": run_pictures,
         "title": "list the pictures a dataset's rows name, sample or uploaded, with row counts and whether the file is there",
         "options": [
             {"id": "missing", "title": "--missing lists uploaded pictures whose file is gone, exiting 1"},
         ]},
        {"id": "find", "kind": "cli", "command": ["datasets", "find"], "configure": configure_find, "run": run_find,
         "title": "find tuning rows whose input text mentions a word, across datasets, exiting 1 on a match",
         "options": [
             {"id": "field", "title": "--field NAME searches one input field only"},
             {"id": "regex", "title": "--regex reads the search text as a regular expression"},
             {"id": "dataset", "title": "--dataset ID searches one dataset only"},
         ]},
    ],
})
