"""Offline commands for the decisions an exported gate prints (`lab.py decisions ...`).

Run as a script, a gate exported from a saved check (jev/gate.py) prints one JSON line per row: its route (auto or
review), the gated questions it held, the rules the answers broke, the answers as Calibrate shows them, its
configuration provenance and the row itself. These commands read such a file: route and question summaries, the
review rows with filters, a check of every line (and of its provenance against a saved check), answer counts,
review reasons, a comparison of two runs, and an export of the rows' inputs.

The file is the user's own gate output, so its answers may be shown. A saved dataset is read only for its questions,
its check and its rows' identities: no dataset label is ever printed. Nothing calls the model, and nothing is written
except the file a user names with --out, never inside the Workbench data directory.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from jev import config, decisions, slices, workbench
from jev.lab import kit

ROUTES = decisions.ROUTES
FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
PREVIEW_CHARS = 80
NO_ANSWER = "(no answer)"


# ---------- reading a decisions file ----------


def _pct(part: int, whole: int) -> Optional[float]:
    """part / whole as a percent with one decimal, or None for an empty whole."""
    return round(100.0 * part / whole, 1) if whole else None


def _text(path: str) -> str:
    target = Path(path)
    if not target.is_file():
        raise kit.CliError("no decisions file %s" % path)
    try:
        return target.read_text(encoding="utf-8-sig")  # a byte-order mark, as some shells write, is not part of line 1
    except (OSError, UnicodeDecodeError) as err:
        raise kit.CliError("cannot read %s: %s" % (path, err))


def _lines(path: str) -> List[Tuple[int, str]]:
    """(line number, stripped text) for every nonblank line."""
    return [(number, line.strip()) for number, line in enumerate(_text(path).split("\n"), 1) if line.strip()]


def _texts(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _no_constant(name: str) -> Any:
    raise ValueError(name)


def parse_line(line: str) -> dict:
    """One gate decision, checked for the shape gate.py and gate.mjs print, or ValueError with the reason."""
    try:
        d = json.loads(line, parse_constant=_no_constant)  # NaN and Infinity are not JSON, and NaN never equals itself
    except ValueError:
        raise ValueError("is not JSON")
    if not isinstance(d, dict):
        raise ValueError("is not a JSON object")
    if d.get("route") not in ROUTES:
        raise ValueError("has no route of auto or review")
    if not isinstance(d.get("answers"), dict):
        raise ValueError("has no answers object")
    held, broken = d.get("held", []), d.get("rules", [])
    if not _texts(held):
        raise ValueError("has held that is not a list of question ids")
    if not _texts(broken):
        raise ValueError("has rules that are not a list of rule texts")
    row = d.get("row")
    if row is None:
        raise ValueError("has no row: export the gate again, its script prints each row with its decision")
    if not isinstance(row, dict) or not row or workbench.LABEL_KEY in row:
        raise ValueError("has a row that is not a JSON object of input fields")
    unanswered = [qid for qid in held if qid not in d["answers"]]
    if unanswered:
        raise ValueError("holds %s, which it has no answer for" % ", ".join(unanswered))
    if d["route"] == "auto" and (held or broken):
        raise ValueError("is routed auto, but it holds a question or breaks a rule")
    if d["route"] == "review" and not held and not broken:
        raise ValueError("is routed to review, but it holds no question and breaks no rule")
    out = {"route": d["route"], "answers": d["answers"], "held": list(held), "rules": list(broken), "row": row}
    if "provenance" in d:
        value = d["provenance"]
        if not isinstance(value, dict) or type(value.get("version")) is not int or not isinstance(value.get("fingerprint"), str):
            raise ValueError("has provenance without a version number and a fingerprint")
        out["provenance"] = value
    return out


def load(path: str) -> Tuple[List[dict], List[Tuple[int, str]]]:
    """(decisions with their "line", [(line, problem)]) for a decisions file."""
    found, problems = [], []
    for number, line in _lines(path):
        try:
            d = parse_line(line)
        except ValueError as err:
            problems.append((number, str(err)))
            continue
        d["line"] = number
        found.append(d)
    return found, problems


def _valid(path: str) -> List[dict]:
    found, problems = load(path)
    if not found:
        hint = "; `lab.py decisions validate %s` says why" % path if problems else ""
        raise kit.CliError("%s holds no valid decision line%s" % (path, hint))
    return found


def _preview(row: Any) -> str:
    text = json.dumps(row, ensure_ascii=False)
    return text if len(text) <= PREVIEW_CHARS else text[:PREVIEW_CHARS - 1] + "…"


def _shown(value: Any) -> str:
    """An answer as a table cell: yes or no, the option or level, (box), or (no answer)."""
    if value is None:
        return NO_ANSWER
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, dict):
        return "(box)"
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return kit.cell_text(value)
    return json.dumps(value, ensure_ascii=False)


def _question_ids(found: List[dict]) -> List[str]:
    out: Dict[str, None] = {}
    for d in found:
        out.update(dict.fromkeys(d["answers"]))
        out.update(dict.fromkeys(d["held"]))
    return list(out)


def _table_or(args: Any, columns: List[str], rows: List[list], empty: str) -> None:
    if not rows and getattr(args, "format", "table") == "table":
        print(empty)
    else:
        kit.emit(args, columns, rows)


def _pair(text: str, flag: str) -> Tuple[str, str]:
    if "=" not in text:
        raise kit.CliError("%s takes FIELD=VALUE, not %r" % (flag, text))
    name, value = text.split("=", 1)
    return name.strip(), value


def _check_of(dataset_id: str) -> Tuple[dict, dict]:
    """(dataset, the provenance its check's exported gate carries). A dataset without a check exits 2."""
    dataset = workbench.load_dataset(dataset_id)
    _questions, check = decisions._check(dataset)
    return dataset, decisions._expected(dataset, check)


def _out_path(out: str, force: bool) -> Path:
    """The file --out names, checked: never inside the Workbench data directory, never an existing file without --force."""
    target = Path(out)
    resolved = target.resolve()
    for data in {workbench.WORKBENCH_DIR.resolve(), config.WORKBENCH_DIR.resolve()}:
        if resolved == data or data in resolved.parents:
            raise kit.CliError("--out %s is inside the Workbench data directory; write the file somewhere else" % out)
    if target.is_dir():
        raise kit.CliError("--out %s is a folder; name a file" % out)
    if target.exists() and not force:
        raise kit.CliError("%s already exists; choose another --out path or pass --force" % out)
    if not target.parent.is_dir():
        raise kit.CliError("the folder for --out %s does not exist" % out)
    return target


def _file_argument(parser: Any) -> None:
    parser.add_argument("file", help="a decisions file: the JSON lines an exported gate prints")


# ---------- decisions summary ----------


def _configure_summary(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument("--by", metavar="FIELD", help="one row per value of this row field, with its route counts")
    parser.add_argument("--max-review", type=float, metavar="PCT", help="exit 1 when more than PCT percent went to review")
    kit.add_format(parser)


def run_summary(args: Any) -> int:
    if args.max_review is not None and not 0 <= args.max_review <= 100:
        raise kit.CliError("--max-review takes a percent from 0 to 100")
    found, problems = load(args.file)
    if not found:
        _valid(args.file)
    n = len(found)
    review = sum(d["route"] == "review" for d in found)
    auto = n - review
    if args.by:
        groups: Dict[str, List[int]] = {}
        for d in found:
            groups.setdefault(slices._value(d["row"], args.by), [0, 0])[0 if d["route"] == "auto" else 1] += 1
        rows = [[slices._shown(value), a + r, a, r, _pct(r, a + r)] for value, (a, r) in groups.items()]
        rows.sort(key=lambda row: (-row[1], row[0]))
        kit.emit(args, [args.by, "decisions", "auto", "review", "review %"], rows)
    else:
        rows = [["decisions", n], ["auto", auto], ["review", review], ["auto %", _pct(auto, n)], ["review %", _pct(review, n)],
                ["held a question", sum(bool(d["held"]) for d in found)], ["broke a rule", sum(bool(d["rules"]) for d in found)],
                ["with provenance", sum("provenance" in d for d in found)],
                ["distinct rows", len({decisions._key(d["row"]) for d in found})], ["malformed lines", len(problems)]]
        kit.emit(args, ["metric", "value"], rows)
    if args.max_review is not None and 100.0 * review / n > args.max_review:
        print("review share %s%% is above --max-review %s%%" % (kit.cell_text(_pct(review, n)), kit.cell_text(args.max_review)),
              file=sys.stderr)
        return 1
    return 0


# ---------- decisions questions and answers ----------


def _configure_questions(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument("--held-only", action="store_true", help="only questions the gate held at least once")
    kit.add_format(parser)


def run_questions(args: Any) -> int:
    found = _valid(args.file)
    n = len(found)
    rows = []
    for qid in _question_ids(found):
        answered = sum(d["answers"].get(qid) is not None for d in found)
        held = sum(qid in d["held"] for d in found)
        if args.held_only and not held:
            continue
        rows.append([qid, answered, n - answered, held, _pct(held, n)])
    _table_or(args, ["question", "answered", "no answer", "held", "held %"], rows, "the gate never held a question")
    return 0


def _configure_answers(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument("--question", metavar="ID", help="only this question's answers")
    parser.add_argument("--route", choices=ROUTES, help="only decisions with this route")
    kit.add_format(parser)


def run_answers(args: Any) -> int:
    found = _valid(args.file)
    qids = _question_ids(found)
    if args.question:
        if args.question not in qids:
            raise kit.CliError("no decision answers %r; the file answers %s" % (args.question, ", ".join(qids)))
        qids = [args.question]
    picked = [d for d in found if not args.route or d["route"] == args.route]
    rows = []
    for qid in qids:
        counts: Dict[str, List[int]] = {}
        for d in picked:
            if qid in d["answers"]:
                counts.setdefault(_shown(d["answers"][qid]), [0, 0])[0 if d["route"] == "auto" else 1] += 1
        ordered = sorted(counts.items(), key=lambda item: (-sum(item[1]), item[0]))
        rows += [[qid, answer, a + r, _pct(a + r, len(picked)), a, r] for answer, (a, r) in ordered]
    _table_or(args, ["question", "answer", "decisions", "share %", "auto", "review"], rows, "no decisions match")
    return 0


# ---------- decisions review ----------


def _configure_review(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument("--held", metavar="ID", help="only rows that held this question")
    parser.add_argument("--rule", metavar="TEXT", help="only rows that broke a rule containing TEXT (any case)")
    parser.add_argument("--where", metavar="FIELD=VALUE", help="only rows whose FIELD has this value")
    parser.add_argument("--limit", type=int, metavar="N", help="at most N rows")
    kit.add_format(parser)


def run_review(args: Any) -> int:
    if args.limit is not None and args.limit < 1:
        raise kit.CliError("--limit takes a whole number of at least 1")
    picked = [d for d in _valid(args.file) if d["route"] == "review"]
    if args.held:
        picked = [d for d in picked if args.held in d["held"]]
    if args.rule:
        needle = args.rule.lower()
        picked = [d for d in picked if any(needle in text.lower() for text in d["rules"])]
    if args.where:
        field, value = _pair(args.where, "--where")
        picked = [d for d in picked if slices._value(d["row"], field) == value]
    if args.limit is not None:
        picked = picked[:args.limit]
    rows = [[d["line"], ", ".join(d["held"]), "; ".join(d["rules"]), _preview(d["row"])] for d in picked]
    _table_or(args, ["line", "held", "rules", "row"], rows, "no review rows match")
    return 0


# ---------- decisions validate ----------


def _configure_validate(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument("--dataset", metavar="ID", help="also check each line against this dataset's questions and check")
    parser.add_argument("--strict", action="store_true", help="a line without provenance is a problem too")
    kit.add_format(parser)


def run_validate(args: Any) -> int:
    lines = _lines(args.file)
    if not lines:
        raise kit.CliError("%s holds no decisions" % args.file)
    dataset, expected = _check_of(args.dataset) if args.dataset else (None, None)
    problems, valid = [], 0
    for number, line in lines:
        try:
            d = parse_line(line)
            if dataset is not None:
                decisions._decision(line, dataset.get("questions") or {})
                decisions._compatible(d, expected)
            if args.strict and "provenance" not in d:
                raise ValueError("has no provenance: export the gate again so Review can verify its decisions")
        except ValueError as err:
            problems.append([number, str(err)])
            continue
        valid += 1
    _table_or(args, ["line", "problem"], problems, "every line is valid (%d decisions)" % valid)
    return 1 if problems else 0


# ---------- decisions provenance ----------


def _configure_provenance(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument("--dataset", metavar="ID", help="compare with the provenance of this dataset's check; exit 1 on a mismatch")
    parser.add_argument("--lines", action="store_true", help="one row per decision instead of one per configuration")
    kit.add_format(parser)


def _fingerprint(provenance: Optional[dict]) -> str:
    return provenance["fingerprint"][:16] if provenance else "(none)"


def run_provenance(args: Any) -> int:
    found = _valid(args.file)
    expected = _check_of(args.dataset)[1] if args.dataset else None

    def status(provenance: Optional[dict]) -> List[str]:
        if expected is None:
            return []
        return ["legacy" if provenance is None else "matches" if provenance == expected else "differs"]

    extra = ["status"] if expected is not None else []
    if args.lines:
        rows = [[d["line"], _fingerprint(d.get("provenance")), (d.get("provenance") or {}).get("model")] + status(d.get("provenance"))
                for d in found]
        kit.emit(args, ["line", "fingerprint", "model"] + extra, rows)
    else:
        groups: Dict[str, List[Any]] = {}
        for d in found:
            provenance = d.get("provenance")
            key = json.dumps(provenance, sort_keys=True)
            if key not in groups:
                groups[key] = [_fingerprint(provenance), (provenance or {}).get("version"), (provenance or {}).get("model"), 0] + status(provenance)
            groups[key][3] += 1
        kit.emit(args, ["fingerprint", "version", "model", "decisions"] + extra, list(groups.values()))
    if expected is not None and args.format == "table":
        print("the check of %s has fingerprint %s" % (args.dataset, expected["fingerprint"][:16]))
    return 1 if expected is not None and any(d.get("provenance") not in (None, expected) for d in found) else 0


# ---------- decisions reasons ----------


def _configure_reasons(parser: Any) -> None:
    _file_argument(parser)
    kit.add_format(parser)


def run_reasons(args: Any) -> int:
    review = [d for d in _valid(args.file) if d["route"] == "review"]
    groups: Dict[Tuple[str, str], int] = {}
    for d in review:
        key = (", ".join(d["held"]), "; ".join(d["rules"]))
        groups[key] = groups.get(key, 0) + 1
    rows = [[held, broken, count, _pct(count, len(review))] for (held, broken), count in groups.items()]
    rows.sort(key=lambda row: (-row[2], row[0], row[1]))
    _table_or(args, ["held", "rules", "rows", "share %"], rows, "no row was sent to review")
    return 0


# ---------- decisions export ----------


def _configure_export(parser: Any) -> None:
    _file_argument(parser)
    parser.add_argument("--route", choices=ROUTES + ("all",), default="review", help="which rows to export (default: review)")
    parser.add_argument("--csv", action="store_true", help="write CSV, one column per input field, instead of JSON lines")
    parser.add_argument("--exclude-dataset", metavar="ID", help="leave out rows this saved dataset already has")
    parser.add_argument("--out", metavar="PATH", help="write the rows to this file instead of printing them")
    parser.add_argument("--force", action="store_true", help="replace the --out file if it exists")


def _csv_cell(value: Any) -> str:
    if value is None:
        return ""
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def run_export(args: Any) -> int:
    if args.force and not args.out:
        raise kit.CliError("--force replaces an --out file; name one with --out")
    target = _out_path(args.out, args.force) if args.out else None
    picked = [d for d in _valid(args.file) if args.route == "all" or d["route"] == args.route]
    have = set()
    if args.exclude_dataset:
        have = {decisions._key(row) for row in workbench.load_dataset(args.exclude_dataset)["rows"]}
    rows, seen, left_out = [], set(), 0
    for d in picked:
        key = decisions._key(d["row"])
        if key in seen:
            continue
        seen.add(key)
        if key in have:
            left_out += 1
            continue
        rows.append(workbench.without_marks(d["row"]))
    if args.csv:
        columns = list(dict.fromkeys(field for row in rows for field in row))
        text = kit.csv_text([columns] + [[_csv_cell(row.get(field)) for field in columns] for row in rows]) if rows else ""
    else:
        text = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    if target is None:
        sys.stdout.write(text)
        return 0
    target.write_bytes(text.encode("utf-8"))
    note = "; left out %d the dataset already has" % left_out if args.exclude_dataset else ""
    print("wrote %d rows to %s%s" % (len(rows), args.out, note))
    return 0


# ---------- decisions compare ----------


def _configure_compare(parser: Any) -> None:
    parser.add_argument("a", help="the first decisions file")
    parser.add_argument("b", help="the second decisions file, for example after a threshold change")
    parser.add_argument("--changed", action="store_true", help="list each row whose route or answers changed")
    kit.add_format(parser)


def _by_row(found: List[dict]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for d in found:
        out.setdefault(decisions._key(d["row"]), d)
    return out


def _answers_changed(a: dict, b: dict) -> List[str]:
    qids = list(dict.fromkeys(list(a["answers"]) + list(b["answers"])))
    return [qid for qid in qids if a["answers"].get(qid) != b["answers"].get(qid)]


def run_compare(args: Any) -> int:
    a, b = _by_row(_valid(args.a)), _by_row(_valid(args.b))
    both = [key for key in a if key in b]
    moved = {("auto", "review"): 0, ("review", "auto"): 0}
    changed = []
    for key in both:
        routes = (a[key]["route"], b[key]["route"])
        if routes in moved:
            moved[routes] += 1
        qids = _answers_changed(a[key], b[key])
        if routes[0] != routes[1] or qids:
            changed.append([a[key]["line"], b[key]["line"], routes[0], routes[1], ", ".join(qids), _preview(a[key]["row"])])
    if args.changed:
        _table_or(args, ["line A", "line B", "route A", "route B", "answers changed", "row"], changed, "no shared row changed")
    else:
        rows = [["rows in A", len(a)], ["rows in B", len(b)], ["in both", len(both)], ["only in A", len(a) - len(both)],
                ["only in B", len(b) - len(both)], ["same route", len(both) - sum(moved.values())],
                ["auto -> review", moved[("auto", "review")]], ["review -> auto", moved[("review", "auto")]],
                ["answers changed", sum(bool(row[4]) for row in changed)]]
        kit.emit(args, ["metric", "value"], rows)
    return 1 if sum(moved.values()) else 0


PACK = kit.define_pack({
    "id": "cli-decisions",
    "surface": "python.cli",
    "title": "Gate decisions commands",
    "about": "Offline commands for the JSON lines an exported gate prints: route and question summaries, review rows with "
             "filters, a check of every line and of its provenance against a saved check, answer counts, review reasons, "
             "a comparison of two runs, and an export of the rows' inputs only. No model call; no dataset label shown.",
    "features": [
        {"id": "summary", "kind": "cli", "command": ["decisions", "summary"], "configure": _configure_summary, "run": run_summary,
         "title": "Summarize a decisions file: auto and review counts and shares, held and rule rows, provenance, distinct rows",
         "options": [{"id": "by", "title": "--by FIELD gives each row field value its auto and review counts and review share"},
                     {"id": "max_review", "title": "--max-review PCT exits 1 when a larger share went to review"},
                     dict(FORMAT)]},
        {"id": "questions", "kind": "cli", "command": ["decisions", "questions"], "configure": _configure_questions, "run": run_questions,
         "title": "Per question: decisions that answered it, missing answers, and how often the gate held it",
         "options": [{"id": "held_only", "title": "--held-only keeps questions the gate held at least once"}, dict(FORMAT)]},
        {"id": "answers", "kind": "cli", "command": ["decisions", "answers"], "configure": _configure_answers, "run": run_answers,
         "title": "Count each question's answers in a decisions file, with their share and auto and review split",
         "options": [{"id": "question", "title": "--question ID counts one question's answers"},
                     {"id": "route", "title": "--route auto|review counts only decisions with that route"},
                     dict(FORMAT)]},
        {"id": "review", "kind": "cli", "command": ["decisions", "review"], "configure": _configure_review, "run": run_review,
         "title": "List the rows the gate sent to review with their line, held questions, broken rules and input",
         "options": [{"id": "held", "title": "--held ID keeps rows that held this question"},
                     {"id": "rule", "title": "--rule TEXT keeps rows that broke a rule containing TEXT"},
                     {"id": "where", "title": "--where FIELD=VALUE keeps rows whose input field has this value"},
                     {"id": "limit", "title": "--limit N keeps the first N review rows"},
                     dict(FORMAT)]},
        {"id": "validate", "kind": "cli", "command": ["decisions", "validate"], "configure": _configure_validate, "run": run_validate,
         "title": "Check every line of a decisions file and name each malformed or inconsistent one; exit 1 if any",
         "options": [{"id": "dataset", "title": "--dataset ID also checks answers, rows and provenance against a saved check"},
                     {"id": "strict", "title": "--strict reports lines without provenance"},
                     dict(FORMAT)]},
        {"id": "provenance", "kind": "cli", "command": ["decisions", "provenance"], "configure": _configure_provenance, "run": run_provenance,
         "title": "Group decisions by the gate configuration that made them: fingerprint, version, model and count",
         "options": [{"id": "dataset", "title": "--dataset ID marks each configuration as matching a saved check or not; exit 1 on a mismatch"},
                     {"id": "lines", "title": "--lines lists each decision's line with its fingerprint"},
                     dict(FORMAT)]},
        {"id": "reasons", "kind": "cli", "command": ["decisions", "reasons"], "configure": _configure_reasons, "run": run_reasons,
         "title": "Group review rows by why they went to review: the held questions and broken rules, with counts and shares",
         "options": [dict(FORMAT)]},
        {"id": "export", "kind": "cli", "command": ["decisions", "export"], "configure": _configure_export, "run": run_export,
         "title": "Export the review rows' inputs as JSON lines, without answers or labels, each distinct row once",
         "options": [{"id": "route", "title": "--route auto|review|all chooses which rows to export"},
                     {"id": "csv", "title": "--csv writes CSV with one column per input field"},
                     {"id": "exclude_dataset", "title": "--exclude-dataset ID leaves out rows a saved dataset already has"},
                     {"id": "out", "title": "--out PATH writes the rows to a file outside the Workbench data directory"},
                     {"id": "force", "title": "--force replaces an existing --out file"}]},
        {"id": "compare", "kind": "cli", "command": ["decisions", "compare"], "configure": _configure_compare, "run": run_compare,
         "title": "Compare two decisions files on their shared rows: route moves and changed answers; exit 1 if a route moved",
         "options": [{"id": "changed", "title": "--changed lists each shared row whose route or answers changed"}, dict(FORMAT)]},
    ],
})
