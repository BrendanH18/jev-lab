"""Inspect saved Workbench datasets offline: `lab.py datasets coverage|labels|duplicates|split|diff|export|sample|lengths|
invalid`.

Label counts and distributions read tuning rows; held-out test rows appear only as counts, never with a label value
or an input, except that `export --include-held-out` writes their inputs (never their labels) when asked. Nothing is
written: an export goes to standard output. Row identity is dataset health's (labels and test markers ignored,
pictures kept), and labels are read as dataset health reads them.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from typing import Any, Dict, List, Optional, Tuple

from jev import workbench
from jev.lab import kit
from jev.lab.packs import cli_datasets_browse as rows_kit

LABEL_TYPES = ("choice", "noul", "score")
HELD = "(held-out)"


def _ratio(part: int, whole: int) -> Optional[float]:
    return rows_kit.share(part, whole)


def _labelable(dataset: dict, qid: Optional[str] = None, types=LABEL_TYPES) -> Dict[str, dict]:
    """The dataset's questions a label distribution can count, or the one asked for."""
    asked = {q: spec for q, spec in rows_kit.questions_of(dataset).items() if spec.get("type") in types}
    if qid is not None:
        spec = rows_kit.question(dataset, qid)
        if spec.get("type") not in types:
            raise kit.CliError("%r is a %s question; this command reads %s questions" % (qid, spec.get("type"), ", ".join(types)))
        return {qid: spec}
    return asked


def _status(spec: dict, raw: Any) -> Tuple[str, Any]:
    """("labeled", value) | ("missing", None) | ("invalid", None)."""
    if raw is None:
        return "missing", None
    ok, value = rows_kit.label_value(spec, raw)
    return ("labeled", value) if ok and value is not None else ("invalid", None)


def _options(spec: dict) -> List[Any]:
    """Every label a question can take, in its own order: Choice keys, yes then no, Score levels."""
    criteria = spec.get("criteria")
    if spec.get("type") == "choice":
        return list(criteria) if isinstance(criteria, dict) else []
    if spec.get("type") == "noul":
        return [True, False]
    if spec.get("type") == "score":
        return list(range(len(criteria))) if isinstance(criteria, list) else []
    return []


def _label_text(value: Any) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    return "" if value is None else str(value)


def _field_value(text: str) -> Tuple[str, str]:
    if "=" not in text:
        raise argparse.ArgumentTypeError("use FIELD=VALUE")
    field, value = text.split("=", 1)
    if not field.strip():
        raise argparse.ArgumentTypeError("use FIELD=VALUE")
    return field.strip(), value.strip()


# ---------- datasets coverage ----------


def configure_coverage(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--held-out", action="store_true", help="add how many held-out rows are labeled and missing (counts only)")
    parser.add_argument("--min", type=rows_kit.unit, metavar="SHARE",
                        help="only questions whose tuning coverage is below SHARE; exit 1 when there are any")
    parser.add_argument("--missing-rows", action="store_true", help="add the tuning row numbers that have no label")
    parser.add_argument("--question", metavar="QID", help="only this question")
    parser.add_argument("--type", choices=workbench.QUESTION_TYPES, help="only questions of this type")


def run_coverage(args) -> int:
    dataset = rows_kit.load(args.dataset)
    asked = rows_kit.questions_of(dataset)
    if args.question is not None:
        asked = {args.question: rows_kit.question(dataset, args.question)}
    if args.type:
        asked = {q: spec for q, spec in asked.items() if spec.get("type") == args.type}
    train, held = rows_kit.tuning(dataset), rows_kit.held_out(dataset)
    columns = ["question", "type", "labeled", "missing", "invalid", "coverage"]
    columns += (["missing_rows"] if args.missing_rows else []) + (["test_labeled", "test_missing"] if args.held_out else [])
    out = []
    for qid, spec in asked.items():
        counts = {"labeled": 0, "missing": 0, "invalid": 0}
        missing_rows = []
        for number, row in train:
            status, _value = _status(spec, rows_kit.labels_of(row).get(qid))
            counts[status] += 1
            if status == "missing":
                missing_rows.append(number)
        coverage = _ratio(counts["labeled"], len(train))
        if args.min is not None and (coverage or 0) >= args.min:
            continue
        line = [qid, spec.get("type"), counts["labeled"], counts["missing"], counts["invalid"], coverage]
        if args.missing_rows:
            line.append(", ".join(str(n) for n in missing_rows))
        if args.held_out:
            statuses = [_status(spec, rows_kit.labels_of(row).get(qid))[0] for _n, row in held]
            line += [statuses.count("labeled"), statuses.count("missing")]
        out.append(line)
    kit.emit(args, columns, out)
    return 1 if args.min is not None and out else 0


# ---------- datasets labels ----------


def _slice_order(groups: Dict[str, Any], size) -> List[str]:
    return sorted(groups, key=lambda value: (-size(groups[value]), value == rows_kit.NONE, value))


def configure_labels(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--question", metavar="QID", help="only this question")
    parser.add_argument("--all-options", action="store_true", help="also list options and levels no tuning row has")
    parser.add_argument("--rare", type=rows_kit.unit, metavar="SHARE",
                        help="only labels (including unused options) below SHARE of a question's labels; exit 1 when there are any")
    parser.add_argument("--by", metavar="FIELD", help="count labels separately for each value of an input field")
    parser.add_argument("--sort", choices=("option", "count"), default="option",
                        help="order labels by the question's own option order (default) or by rows, most first")


def _distribution(spec: dict, qid: str, rows: List[Any]) -> Dict[str, int]:
    """Valid labels of `qid` on `rows`, counted by their JSON text."""
    counts: Dict[str, int] = {}
    for row in rows:
        status, value = _status(spec, rows_kit.labels_of(row).get(qid))
        if status == "labeled":
            key = json.dumps(value)
            counts[key] = counts.get(key, 0) + 1
    return counts


def run_labels(args) -> int:
    dataset = rows_kit.load(args.dataset)
    asked = _labelable(dataset, args.question)
    train = [row for _n, row in rows_kit.tuning(dataset)]
    if args.by is not None:
        if not any(args.by in rows_kit.inputs_of(row) for row in train):
            raise kit.CliError("No tuning row of %r has the field %r" % (dataset["id"], args.by))
        groups: Dict[str, List[Any]] = {}
        for row in train:
            groups.setdefault(rows_kit.slice_value(row, args.by), []).append(row)
        parts = [(value, groups[value]) for value in _slice_order(groups, len)]
    else:
        parts = [(None, train)]
    out = []
    for value, rows in parts:
        for qid, spec in asked.items():
            counts = _distribution(spec, qid, rows)
            labeled = sum(counts.values())
            options = [json.dumps(option) for option in _options(spec)]
            keys = [key for key in options if key in counts or args.all_options or args.rare is not None]
            keys += [key for key in counts if key not in options]
            if args.sort == "count":
                keys.sort(key=lambda key: -counts.get(key, 0))
            lines = []
            for key in keys:
                part = _ratio(counts.get(key, 0), labeled)
                if args.rare is not None and not (labeled and part < args.rare):
                    continue
                lines.append([qid, json.loads(key), counts.get(key, 0), part])
            out += [([rows_kit.slices._shown(value)] if args.by is not None else []) + line for line in lines]
    columns = (["slice"] if args.by is not None else []) + ["question", "label", "rows", "share"]
    kit.emit(args, columns, out)
    return 1 if args.rare is not None and out else 0


# ---------- datasets duplicates ----------


def _normalized(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(value.split()).lower()
    if isinstance(value, dict):
        return {k: _normalized(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalized(v) for v in value]
    return value


def configure_duplicates(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--conflicts", action="store_true",
                        help="only groups whose tuning copies carry different valid labels, naming the questions")
    parser.add_argument("--overlap", action="store_true", help="only groups with copies on both sides of the test split")
    parser.add_argument("--min-copies", type=rows_kit.positive, metavar="N", help="only groups with at least N copies")
    parser.add_argument("--normalize", action="store_true", help="treat text that differs only in case or spacing as the same")
    parser.add_argument("--field", metavar="NAME", help="group rows by this one input field instead of the whole input")


def run_duplicates(args) -> int:
    dataset = rows_kit.load(args.dataset)
    asked = rows_kit.questions_of(dataset)
    groups: Dict[str, List[Tuple[int, Any]]] = {}
    for number, row in rows_kit.numbered(dataset):
        if args.field is not None:
            fields = rows_kit.inputs_of(row)
            if fields.get(args.field) in (None, ""):
                continue
            value = _normalized(fields[args.field]) if args.normalize else fields[args.field]
            key = json.dumps(value, sort_keys=True, ensure_ascii=False)
        elif args.normalize:
            key = json.dumps(_normalized(rows_kit.inputs_of(row)), sort_keys=True, ensure_ascii=False)
        else:
            key = rows_kit.identity(row)
        groups.setdefault(key, []).append((number, row))
    out = []
    for index, members in enumerate((m for m in groups.values() if len(m) > 1), 1):
        train = [(n, row) for n, row in members if not rows_kit.is_test(row)]
        test = len(members) - len(train)
        conflicting = []
        for qid, spec in asked.items():
            values = {json.dumps(_status(spec, rows_kit.labels_of(row).get(qid))[1]) for _n, row in train
                      if _status(spec, rows_kit.labels_of(row).get(qid))[0] == "labeled"}
            if len(values) > 1:
                conflicting.append(qid)
        if args.conflicts and not conflicting:
            continue
        if args.overlap and not (train and test):
            continue
        if args.min_copies and len(members) < args.min_copies:
            continue
        if not train:
            shown = rows_kit.HELD_OUT_ONLY
        elif args.field is not None:
            value = rows_kit.inputs_of(train[0][1])[args.field]
            shown = rows_kit.one_line(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False), 60)
        else:
            shown = rows_kit.preview(train[0][1])
        line = [index, ", ".join(str(n) for n, _row in train), len(members), test, shown]
        out.append(line + ([", ".join(conflicting)] if args.conflicts else []))
    kit.emit(args, ["group", "rows", "copies", "test", "input"] + (["questions"] if args.conflicts else []), out)
    return 1 if out else 0


# ---------- datasets split ----------


def configure_split(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--looks", action="store_true",
                        help="list each recorded look at the test rows: when, the model, the signal and how many gates")
    parser.add_argument("--max-looks", type=int, metavar="N", help="exit 1 when the test rows were scored more than N times")


def run_split(args) -> int:
    dataset = rows_kit.load(args.dataset)
    train, held = rows_kit.tuning(dataset), rows_kit.held_out(dataset)
    test = dataset.get("test") if isinstance(dataset.get("test"), dict) else {}
    looks = [look for look in (test.get("looks") or []) if isinstance(look, dict)]
    if args.looks:
        kit.emit(args, ["look", "at", "model", "signal", "gates"],
                 [[n, look.get("at"), look.get("model"), look.get("signal"),
                   len(look["gates"]) if isinstance(look.get("gates"), dict) else 0] for n, look in enumerate(looks, 1)])
    elif not held:
        print("Dataset %r has no held-out test rows." % dataset["id"])
        return 0
    else:
        labeled_train = sum(1 for _n, row in train if rows_kit.has_label(row))
        labeled_test = sum(1 for _n, row in held if rows_kit.has_label(row))
        tuning_keys = {rows_kit.identity(row) for _n, row in train}
        overlap = len({rows_kit.identity(row) for _n, row in held} & tuning_keys)
        pairs = [("rows", len(dataset["rows"])), ("tuning_rows", len(train)), ("test_rows", len(held)),
                 ("labeled_tuning", labeled_train), ("labeled_test", labeled_test),
                 ("test_share", _ratio(labeled_test, labeled_train + labeled_test)),
                 ("locked_at", test.get("locked_at")), ("looks", len(looks)),
                 ("last_look", looks[-1].get("at") if looks else None), ("overlap_groups", overlap)]
        kit.emit(args, ["field", "value"], [list(pair) for pair in pairs])
    if args.max_looks is not None and len(looks) > args.max_looks:
        print("The test rows were scored %d times, more than %d: results on them now flatter the gate." % (len(looks), args.max_looks),
              file=sys.stderr)
        return 1
    return 0


# ---------- datasets diff ----------


def configure_diff(parser) -> None:
    parser.add_argument("dataset", help="first dataset id (a)")
    parser.add_argument("other", help="second dataset id (b)")
    kit.add_format(parser)
    what = parser.add_mutually_exclusive_group()
    what.add_argument("--rows", action="store_true", help="list the tuning inputs only one dataset has")
    what.add_argument("--labels", action="store_true", help="list shared tuning inputs whose labels differ, per question")
    what.add_argument("--questions", action="store_true", help="compare the two datasets' questions instead of their rows")


def _inputs(dataset: dict) -> Dict[str, List[Tuple[int, Any]]]:
    out: Dict[str, List[Tuple[int, Any]]] = {}
    for number, row in rows_kit.tuning(dataset):
        out.setdefault(rows_kit.identity(row), []).append((number, row))
    return out


def _labels_text(spec: dict, qid: str, copies: List[Tuple[int, Any]]) -> str:
    values = set()
    for _n, row in copies:
        status, value = _status(spec, rows_kit.labels_of(row).get(qid))
        if status == "labeled":
            values.add(_label_text(value))
    return ", ".join(sorted(values))


def run_diff(args) -> int:
    a, b = rows_kit.load(args.dataset), rows_kit.load(args.other)
    qa, qb = rows_kit.questions_of(a), rows_kit.questions_of(b)
    if args.questions:
        out = []
        for qid in list(qa) + [q for q in qb if q not in qa]:
            sa, sb = qa.get(qid), qb.get(qid)
            out.append([qid, (sa or {}).get("type"), (sb or {}).get("type"), sa is not None and sa == sb])
        kit.emit(args, ["question", "a", "b", "same"], out)
        return 1 if any(not line[3] for line in out) else 0
    ia, ib = _inputs(a), _inputs(b)
    shared = [key for key in ia if key in ib]
    changes = []
    for key in shared:
        for qid in qa:
            if qid not in qb:
                continue
            left, right = _labels_text(qa[qid], qid, ia[key]), _labels_text(qb[qid], qid, ib[key])
            if left != right:
                changes.append([rows_kit.preview(ia[key][0][1]), qid, left, right])
    only_a = [key for key in ia if key not in ib]
    only_b = [key for key in ib if key not in ia]
    found = bool(only_a or only_b or changes)
    if args.rows:
        kit.emit(args, ["side", "row", "input"],
                 [["a", ia[key][0][0], rows_kit.preview(ia[key][0][1])] for key in only_a]
                 + [["b", ib[key][0][0], rows_kit.preview(ib[key][0][1])] for key in only_b])
    elif args.labels:
        kit.emit(args, ["input", "question", "a", "b"], changes)
    else:
        pairs = [("a_inputs", len(ia)), ("b_inputs", len(ib)), ("only_in_a", len(only_a)), ("only_in_b", len(only_b)),
                 ("in_both", len(shared)), ("label_changes", len(changes)),
                 ("a_test_rows", len(rows_kit.held_out(a))), ("b_test_rows", len(rows_kit.held_out(b)))]
        kit.emit(args, ["field", "value"], [list(pair) for pair in pairs])
    return 1 if found else 0


# ---------- datasets export ----------


def configure_export(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    parser.add_argument("--csv", action="store_true",
                        help="write CSV: one column per input field, then label_<question> columns (formulas defused)")
    parser.add_argument("--include-held-out", action="store_true",
                        help="also write held-out rows' inputs, marked \"_test\": true; their labels are never written")
    parser.add_argument("--labeled-only", action="store_true", help="only rows with at least one label")
    parser.add_argument("--unlabeled", metavar="QID", help="only rows with no valid label for QID, for a labeling handoff")
    parser.add_argument("--no-labels", action="store_true", help="write inputs only")
    parser.add_argument("--question", metavar="QID", action="append", help="keep only this question's labels (repeat for more)")
    parser.add_argument("--fields", metavar="A,B", help="keep only these input fields (comma-separated)")


def run_export(args) -> int:
    dataset = rows_kit.load(args.dataset)
    for qid in (args.question or []) + ([args.unlabeled] if args.unlabeled else []):
        rows_kit.question(dataset, qid)
    keep_fields = [name.strip() for name in args.fields.split(",") if name.strip()] if args.fields else None
    out: List[dict] = []
    for _number, row in rows_kit.numbered(dataset):
        fields = rows_kit.inputs_of(row)
        if keep_fields is not None:
            fields = {k: v for k, v in fields.items() if k in keep_fields}
        if rows_kit.is_test(row):  # inputs and the marker only: a held-out row's labels are never written
            if args.include_held_out:
                out.append(dict(fields, **{rows_kit.TEST: True}))
            continue
        labels = dict(rows_kit.labels_of(row))
        if args.labeled_only and not any(v is not None for v in labels.values()):
            continue
        if args.unlabeled:
            spec = rows_kit.questions_of(dataset)[args.unlabeled]
            if _status(spec, labels.get(args.unlabeled))[0] == "labeled":
                continue
        if args.question:
            labels = {k: v for k, v in labels.items() if k in args.question}
        item = dict(fields)
        if labels and not args.no_labels:
            item[rows_kit.LABEL] = labels
        out.append(item)
    if args.csv:
        print(_csv(dataset, out, args), end="")
    else:
        for item in out:
            print(json.dumps(item, ensure_ascii=False))
    return 0


def _csv(dataset: dict, items: List[dict], args) -> str:
    fields: List[str] = []
    for item in items:
        fields += [k for k in item if k not in (rows_kit.LABEL, rows_kit.TEST) and k not in fields]
    qids: List[str] = []
    if not args.no_labels:
        qids = [q for q in rows_kit.questions_of(dataset) if not args.question or q in args.question]
        for item in items:
            qids += [q for q in item.get(rows_kit.LABEL, {}) if q not in qids]
    test = any(rows_kit.TEST in item for item in items)
    header = fields + ["label_%s" % q for q in qids] + (["_test"] if test else [])

    def cell(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "yes" if value else "no"
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)

    lines = [header] + [[cell(item.get(f)) for f in fields] + [cell(item.get(rows_kit.LABEL, {}).get(q)) for q in qids]
                        + (["yes" if item.get(rows_kit.TEST) else ""] if test else []) for item in items]
    return kit.csv_text(lines)


# ---------- datasets sample ----------


def _rank(seed: int, number: int, row: Any) -> str:
    """A row's place in a seeded shuffle: stable across Python versions, unlike random.sample."""
    return hashlib.sha256(("%d:%d:%s" % (seed, number, rows_kit.identity(row))).encode("utf-8")).hexdigest()


def configure_sample(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--n", type=rows_kit.positive, default=5, metavar="N", help="how many rows to draw (default 5)")
    parser.add_argument("--seed", type=int, default=0, help="draw a different, repeatable sample (default 0)")
    parser.add_argument("--stratify", metavar="QID", help="draw N rows for each label of QID")
    parser.add_argument("--jsonl", action="store_true", help="print the sampled rows as JSON Lines (inputs and labels)")
    parser.add_argument("--unlabeled", action="store_true", help="draw only from rows without any label")
    parser.add_argument("--where", type=_field_value, metavar="FIELD=VALUE", help="draw only from rows whose FIELD is VALUE")


def run_sample(args) -> int:
    dataset = rows_kit.load(args.dataset)
    pool = rows_kit.tuning(dataset)
    if args.unlabeled:
        pool = [(n, row) for n, row in pool if not rows_kit.has_label(row)]
    if args.where:
        field, value = args.where
        pool = [(n, row) for n, row in pool if rows_kit.slice_value(row, field) == value]
    ranked = sorted(pool, key=lambda item: _rank(args.seed, item[0], item[1]))
    chosen: List[Tuple[Any, int, Any]] = []
    if args.stratify:
        spec = _labelable(dataset, args.stratify)[args.stratify]
        for option in _options(spec):
            hits = [(n, row) for n, row in ranked if _status(spec, rows_kit.labels_of(row).get(args.stratify)) == ("labeled", option)]
            chosen += [(option, n, row) for n, row in sorted(hits[:args.n], key=lambda item: item[0])]
    else:
        chosen = [(None, n, row) for n, row in sorted(ranked[:args.n], key=lambda item: item[0])]
    if args.jsonl:
        for _stratum, _n, row in chosen:
            item = dict(rows_kit.inputs_of(row))
            if rows_kit.labels_of(row):
                item[rows_kit.LABEL] = rows_kit.labels_of(row)
            print(json.dumps(item, ensure_ascii=False))
        return 0
    columns = (["label"] if args.stratify else []) + ["row", "input", "labels"]
    kit.emit(args, columns, [([stratum] if args.stratify else []) + [n, rows_kit.preview(row),
                                                                      json.dumps(rows_kit.labels_of(row), ensure_ascii=False)]
                             for stratum, n, row in chosen])
    return 0


# ---------- datasets lengths ----------


def configure_lengths(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--field", metavar="NAME", help="only this input field")
    parser.add_argument("--over", type=rows_kit.positive, metavar="N",
                        help="list tuning rows whose text is longer than N; exit 1 when there are any")
    parser.add_argument("--words", action="store_true", help="count words instead of characters")


def _median(values: List[int]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    return float(ordered[middle]) if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def run_lengths(args) -> int:
    dataset = rows_kit.load(args.dataset)
    sizes: Dict[str, List[Tuple[int, int]]] = {}
    for number, row in rows_kit.tuning(dataset):
        for name, value in rows_kit.inputs_of(row).items():
            if name == rows_kit.IMAGE or not isinstance(value, str) or (args.field is not None and name != args.field):
                continue
            sizes.setdefault(name, []).append((number, len(value.split()) if args.words else len(value)))
    if args.field is not None and args.field not in sizes:
        raise kit.CliError("No tuning row of %r has text in the field %r" % (dataset["id"], args.field))
    if args.over is not None:
        out = [[number, name, size] for name, found in sizes.items() for number, size in found if size > args.over]
        out.sort(key=lambda line: (line[0], line[1]))
        kit.emit(args, ["row", "field", "words" if args.words else "chars"], out)
        return 1 if out else 0
    kit.emit(args, ["field", "rows", "min", "median", "max"],
             [[name, len(found), min(s for _n, s in found), _median([s for _n, s in found]), max(s for _n, s in found)]
              for name, found in sizes.items()])
    return 0


# ---------- datasets invalid ----------


def configure_invalid(parser) -> None:
    parser.add_argument("dataset", help="dataset id")
    kit.add_format(parser)
    parser.add_argument("--question", metavar="QID", help="only labels for this question id")
    parser.add_argument("--unknown", action="store_true", help="only labels for question ids the dataset does not ask")


def _reason(spec: Optional[dict]) -> str:
    if spec is None:
        return "not a question of this dataset"
    kind = spec.get("type")
    if kind == "choice":
        return "not one of the options"
    if kind == "noul":
        return "not yes or no"
    if kind == "score":
        criteria = spec.get("criteria")
        return "not one of the levels 0-%d" % (len(criteria) - 1) if isinstance(criteria, list) and criteria else "not a level"
    return "not a valid box"


def run_invalid(args) -> int:
    dataset = rows_kit.load(args.dataset)
    asked = rows_kit.questions_of(dataset)
    out = []
    hidden = 0
    for number, row in rows_kit.numbered(dataset):
        for qid, raw in rows_kit.labels_of(row).items():
            if raw is None or (args.question is not None and qid != args.question):
                continue
            spec = asked.get(qid)
            if args.unknown and spec is not None:
                continue
            if spec is not None and _status(spec, raw)[0] != "invalid":
                continue
            if rows_kit.is_test(row):
                hidden += 1
            else:
                out.append([number, qid, json.dumps(raw, ensure_ascii=False), _reason(spec)])
    if hidden:
        out.append([HELD, None, None, "%d invalid label%s on held-out rows; values hidden" % (hidden, "" if hidden == 1 else "s")])
    kit.emit(args, ["row", "question", "label", "reason"], out)
    return 1 if out else 0


PACK = kit.define_pack({
    "id": "cli-datasets-quality",
    "surface": "python.cli",
    "title": "Inspect dataset quality",
    "about": "Offline `lab.py datasets` commands that inspect saved datasets: label coverage and distributions on "
             "tuning rows, duplicate inputs, the held-out split as counts, differences between two datasets, invalid "
             "labels, text lengths, seeded samples and JSONL/CSV exports of inputs and human labels.",
    "features": [
        {"id": "coverage", "kind": "cli", "command": ["datasets", "coverage"], "configure": configure_coverage, "run": run_coverage,
         "title": "count valid, missing and invalid labels per question on tuning rows, with each question's coverage",
         "options": [
             {"id": "held_out", "title": "--held-out adds held-out labeled and missing counts, never values"},
             {"id": "min", "title": "--min SHARE lists questions below that coverage and exits 1"},
             {"id": "missing_rows", "title": "--missing-rows names the tuning rows still missing each label"},
             {"id": "question", "title": "--question QID reports one question's coverage"},
             {"id": "type", "title": "--type keeps questions of one type"},
         ]},
        {"id": "labels", "kind": "cli", "command": ["datasets", "labels"], "configure": configure_labels, "run": run_labels,
         "title": "show the label distribution of each question on tuning rows only, with shares",
         "options": [
             {"id": "question", "title": "--question QID shows one question's label distribution"},
             {"id": "all_options", "title": "--all-options lists options and levels no row is labeled with"},
             {"id": "rare", "title": "--rare SHARE lists labels below that share, unused options included, and exits 1"},
             {"id": "by", "title": "--by FIELD splits the label distribution by an input field's values"},
             {"id": "sort", "title": "--sort count orders labels by how many rows carry them"},
         ]},
        {"id": "duplicates", "kind": "cli", "command": ["datasets", "duplicates"], "configure": configure_duplicates, "run": run_duplicates,
         "title": "group identical inputs as dataset health does, counting held-out copies, and exit 1 when any exist",
         "options": [
             {"id": "conflicts", "title": "--conflicts keeps groups whose tuning copies disagree on a label, naming the questions"},
             {"id": "overlap", "title": "--overlap keeps groups split between tuning and held-out rows"},
             {"id": "min_copies", "title": "--min-copies N keeps groups with at least N copies"},
             {"id": "normalize", "title": "--normalize also groups text that differs only in case or spacing"},
             {"id": "field", "title": "--field NAME groups rows by one input field"},
         ]},
        {"id": "split", "kind": "cli", "command": ["datasets", "split"], "configure": configure_split, "run": run_split,
         "title": "summarize the held-out test split in counts: rows and labels on each side, share, looks and overlap",
         "options": [
             {"id": "looks", "title": "--looks lists each recorded look at the test rows without results"},
             {"id": "max_looks", "title": "--max-looks N exits 1 when the test rows were scored more than N times"},
         ]},
        {"id": "diff", "kind": "cli", "command": ["datasets", "diff"], "configure": configure_diff, "run": run_diff,
         "title": "compare two datasets' tuning inputs by identity and their labels, exiting 1 when they differ",
         "options": [
             {"id": "rows", "title": "--rows lists the tuning inputs only one dataset has"},
             {"id": "labels", "title": "--labels lists shared inputs whose labels differ, per question"},
             {"id": "questions", "title": "--questions compares the two datasets' question configuration"},
         ]},
        {"id": "export", "kind": "cli", "command": ["datasets", "export"], "configure": configure_export, "run": run_export,
         "title": "print tuning rows as JSON Lines with their inputs and human labels, ready for Bulk",
         "options": [
             {"id": "csv", "title": "--csv prints the rows as CSV with label columns and defused formulas"},
             {"id": "include_held_out", "title": "--include-held-out adds held-out inputs, marked as test rows, without labels"},
             {"id": "labeled_only", "title": "--labeled-only exports rows with at least one label"},
             {"id": "unlabeled", "title": "--unlabeled QID exports rows still needing a label for that question"},
             {"id": "no_labels", "title": "--no-labels exports inputs only"},
             {"id": "question", "title": "--question QID keeps only the named questions' labels"},
             {"id": "fields", "title": "--fields A,B keeps only the named input fields"},
         ]},
        {"id": "sample", "kind": "cli", "command": ["datasets", "sample"], "configure": configure_sample, "run": run_sample,
         "title": "draw a repeatable seeded sample of tuning rows with their labels",
         "options": [
             {"id": "n", "title": "--n N sets the sample size"},
             {"id": "seed", "title": "--seed S draws a different repeatable sample"},
             {"id": "stratify", "title": "--stratify QID draws N rows for each label of a question"},
             {"id": "jsonl", "title": "--jsonl prints the sample as JSON Lines for Bulk"},
             {"id": "unlabeled", "title": "--unlabeled draws only from rows without labels"},
             {"id": "where", "title": "--where FIELD=VALUE draws only from one slice"},
         ]},
        {"id": "lengths", "kind": "cli", "command": ["datasets", "lengths"], "configure": configure_lengths, "run": run_lengths,
         "title": "report the shortest, median and longest text per input field on tuning rows",
         "options": [
             {"id": "field", "title": "--field NAME measures one input field"},
             {"id": "over", "title": "--over N lists tuning rows with longer text and exits 1"},
             {"id": "words", "title": "--words counts words instead of characters"},
         ]},
        {"id": "invalid", "kind": "cli", "command": ["datasets", "invalid"], "configure": configure_invalid, "run": run_invalid,
         "title": "list tuning labels that do not fit their question, counting held-out ones without values, exiting 1",
         "options": [
             {"id": "question", "title": "--question QID lists invalid labels for one question"},
             {"id": "unknown", "title": "--unknown lists labels for questions the dataset does not ask"},
         ]},
    ],
})
