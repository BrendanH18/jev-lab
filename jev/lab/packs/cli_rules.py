"""Offline tools for consistency rules (`lab.py rules ...`), the "if A then B" lines of jev/rules.py.

A dataset may hold rules as Policy wrote them, and its saved check may hold its own copy. These commands list a
dataset's rules, lint them against its questions (lines that do not parse, names and answers the questions cannot
give, repeated rules, rules that can never apply, never break, or always break), check them against the human labels
on tuning rows, suggest rules the labels already obey, and compare a dataset's rules with its check's.

Rules are read from the dataset by default, from its check with --check, or from text given with --text. Only tuning
rows are read; held-out rows are never read. Nothing calls the model or writes a file.
"""

from __future__ import annotations

import itertools
from typing import Any, Dict, List, Optional, Tuple

from jev import decisions, rules as rulebook, workbench
from jev.calibrate import CalibrationError
from jev.lab import kit
from jev.lab.packs import cli_gates

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
CHECK = {"id": "check", "title": "--check reads the rules saved with the dataset's check instead of the dataset's own"}
TEXT = {"id": "text", "title": "--text RULES reads draft rules given on the command line, one per line"}
DEFAULT_MIN_ROWS = 5


# ---------- reading rules and labels ----------


def _source(parser: Any, text: bool = True) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument("--check", action="store_true", help="read the rules saved with the dataset's check")
    if text:
        parser.add_argument("--text", metavar="RULES", help="read these rules instead, one per line (use \\n between lines)")


def _rules_text(args: Any, dataset: dict) -> str:
    if getattr(args, "text", None) is not None:
        return args.text.replace("\\n", "\n")
    if args.check:
        check = dataset.get("check")
        if not isinstance(check, dict):
            raise kit.CliError("dataset %r has no check" % dataset["id"])
        return str(check.get("rules") or "")
    return str(dataset.get("rules") or "")


def _kinds(dataset: dict) -> Dict[str, Tuple[str, List[str]]]:
    questions = dataset.get("questions") if isinstance(dataset.get("questions"), dict) else {}
    return rulebook.kinds_from_questions(questions)


def _parsed(args: Any, dataset: dict) -> List[dict]:
    """The rules, parsed and checked against the dataset's questions; a rule that does not fit exits 2."""
    try:
        parsed = rulebook.parse(_rules_text(args, dataset))
        rulebook.check(parsed, _kinds(dataset))
    except CalibrationError as err:
        raise kit.CliError("%s (run `lab.py rules lint %s` to see every problem)" % (err, dataset["id"]))
    return parsed


def _shown_label(question: dict, value: Any) -> Optional[str]:
    """A human label as a rule compares it: an option key, yes or no, or a level number; None when unusable."""
    if value in (None, ""):
        return None
    ok, label = decisions.label(question, value)
    if not ok or label is None:
        return None
    return ("yes" if label else "no") if isinstance(label, bool) else str(label)


def _tuning(dataset: dict) -> List[Tuple[int, Dict[str, str]]]:
    """(1-based row number, {question: shown label}) for each tuning row; held-out rows are skipped unread."""
    questions = dataset.get("questions") if isinstance(dataset.get("questions"), dict) else {}
    out = []
    for number, row in enumerate(dataset["rows"], 1):
        if not isinstance(row, dict):
            out.append((number, {}))
            continue
        if row.get(workbench.TEST_KEY) is True:
            continue
        labels = row.get(workbench.LABEL_KEY) if isinstance(row.get(workbench.LABEL_KEY), dict) else {}
        shown = {}
        for qid, value in labels.items():
            question = questions.get(qid)
            if isinstance(question, dict) and question.get("type") in rulebook.TYPES:
                label = _shown_label(question, value)
                if label is not None:
                    shown[qid] = label
        out.append((number, shown))
    return out


def _canon(rule: dict) -> tuple:
    def side(conds: List[tuple]) -> tuple:
        return tuple(sorted((q, op, tuple(sorted(vs))) for q, op, vs in conds))
    return side(rule["if"]), side(rule["then"])


def _sat(cond: tuple, values: List[str]) -> List[str]:
    return [value for value in values if rulebook._holds(cond, {cond[0]: value})]


# ---------- rules list ----------


def _configure_list(parser: Any) -> None:
    _source(parser, text=False)
    kit.add_format(parser)


def _side_text(conds: List[tuple]) -> str:
    return " and ".join("%s %s %s" % (q, op, ", ".join(vs)) for q, op, vs in conds)


def run_list(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    rows = [[rule["line"], _side_text(rule["if"]), _side_text(rule["then"]), ", ".join(rulebook.questions(rule))]
            for rule in _parsed(args, dataset)]
    cli_gates._table_or(args, ["line", "if", "then", "questions"], rows,
                        "the dataset's check has no rules" if args.check else "the dataset has no rules")
    return 0


# ---------- rules lint ----------


def _configure_lint(parser: Any) -> None:
    _source(parser)
    kit.add_format(parser)


def _logic(rule: dict, kinds: Dict[str, Tuple[str, List[str]]]) -> Optional[str]:
    allowed: Dict[str, List[str]] = {}
    for cond in rule["if"]:
        allowed[cond[0]] = _sat(cond, allowed.get(cond[0], kinds[cond[0]][1]))
    if any(not values for values in allowed.values()):
        return "never applies: its if conditions cannot all hold at once"
    always, never = [], []
    for cond in rule["then"]:
        values = allowed.get(cond[0], kinds[cond[0]][1])
        held = _sat(cond, values)
        (always if len(held) == len(values) else never if not held else []).append(cond)
    if never:
        return "is broken by every row it applies to: %s cannot hold when the if part does" % _side_text(never)
    if len(always) == len(rule["then"]):
        return "can never be broken: whenever the if part holds, the then part holds too"
    return None


def run_lint(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    text = _rules_text(args, dataset)
    kinds = _kinds(dataset)
    rows: List[list] = []
    if len(text) > rulebook.MAX_CHARS:
        rows.append([None, "", "the rules are over %d characters, the most a dataset or check saves" % rulebook.MAX_CHARS])
    seen: Dict[tuple, int] = {}
    count = 0
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        count += 1
        try:
            rule = rulebook.parse("\n" * (number - 1) + line)[0]
        except CalibrationError as err:
            rows.append([number, line.strip(), str(err).split(": ", 1)[-1]])
            continue
        try:
            rulebook.check([rule], kinds)
        except CalibrationError as err:
            rows.append([number, rule["text"], str(err).split(": ", 1)[-1]])
            continue
        key = _canon(rule)
        if key in seen:
            rows.append([number, rule["text"], "repeats the rule on line %d" % seen[key]])
            continue
        seen[key] = number
        problem = _logic(rule, kinds)
        if problem:
            rows.append([number, rule["text"], problem])
    if count > rulebook.MAX_RULES:
        rows.append([None, "", "%d rules; a dataset or check keeps at most %d" % (count, rulebook.MAX_RULES)])
    cli_gates._table_or(args, ["line", "rule", "problem"], rows, "%d rule%s, no problems" % (count, "" if count == 1 else "s"))
    return 1 if rows else 0


# ---------- rules labels ----------


def _configure_labels(parser: Any) -> None:
    _source(parser)
    parser.add_argument("--rows", action="store_true", help="list the tuning rows whose labels break each rule")
    kit.add_format(parser)


def run_labels(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    rules = _parsed(args, dataset)
    tuning = _tuning(dataset)
    rows, broken_any = [], False
    for rule in rules:
        qids = rulebook.questions(rule)
        labeled = [(number, shown) for number, shown in tuning if all(q in shown for q in qids)]
        applies = [number for number, shown in labeled if all(rulebook._holds(c, shown) for c in rule["if"])]
        broken = [number for number, shown in labeled if rulebook.broken(rule, shown)]
        broken_any = broken_any or bool(broken)
        rows.append([rule["line"], rule["text"], len(labeled), len(applies), len(broken)]
                    + ([", ".join(map(str, broken))] if args.rows else []))
    columns = ["line", "rule", "labeled rows", "applies", "labels break it"] + (["rows"] if args.rows else [])
    cli_gates._table_or(args, columns, rows, "no rules to check")
    return 1 if broken_any else 0


# ---------- rules suggest ----------


def _configure_suggest(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset with labeled tuning rows")
    parser.add_argument("--min-rows", type=int, default=DEFAULT_MIN_ROWS, metavar="N",
                        help="only rules whose if part holds on at least N labeled tuning rows (default %d)" % DEFAULT_MIN_ROWS)
    parser.add_argument("--question", metavar="ID", help="only rules whose if part reads this question")
    kit.add_format(parser)


def run_suggest(args: Any) -> int:
    if args.min_rows < 1:
        raise kit.CliError("--min-rows must be at least 1")
    dataset = workbench.load_dataset(args.dataset)
    kinds = _kinds(dataset)
    if args.question and args.question not in kinds:
        raise kit.CliError("%s is not a Choice, Noul or Score question of this dataset" % args.question)
    existing = set()
    for text in (dataset.get("rules"), (dataset.get("check") or {}).get("rules") if isinstance(dataset.get("check"), dict) else None):
        try:
            parsed = rulebook.parse(text)
            rulebook.check(parsed, kinds)
        except CalibrationError:
            continue
        existing |= {_canon(rule) for rule in parsed}
    tuning = _tuning(dataset)
    rows = []
    for first, second in itertools.permutations(kinds, 2):
        if args.question and first != args.question:
            continue
        for value in kinds[first][1]:
            seen = [shown[second] for _n, shown in tuning if shown.get(first) == value and second in shown]
            if len(seen) < args.min_rows:
                continue
            kept = [v for v in kinds[second][1] if v in seen]
            if len(kept) == len(kinds[second][1]):
                continue
            then = "%s = %s" % (second, kept[0]) if len(kept) == 1 else "%s in %s" % (second, ", ".join(kept))
            text = "if %s = %s then %s" % (first, value, then)
            rule = rulebook.parse(text)[0]
            rulebook.check([rule], kinds)
            rows.append([text, len(seen), _canon(rule) in existing])
    rows.sort(key=lambda row: (-row[1], row[0]))
    cli_gates._table_or(args, ["rule", "labeled rows", "saved"], rows,
                        "no rule holds on %d or more labeled tuning rows" % args.min_rows)
    return 0


# ---------- rules compare ----------


def _configure_compare(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset that holds a check")
    kit.add_format(parser)


def run_compare(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    if not isinstance(dataset.get("check"), dict):
        raise kit.CliError("dataset %r has no check" % dataset["id"])
    try:
        own = rulebook.parse(dataset.get("rules"))
        saved = rulebook.parse(dataset["check"].get("rules"))
    except CalibrationError as err:
        raise kit.CliError(str(err))
    kinds = _kinds(dataset)
    for group in (own, saved):
        try:
            rulebook.check(group, kinds)
        except CalibrationError:
            pass
    a, b = {_canon(r): r["text"] for r in own}, {_canon(r): r["text"] for r in saved}
    rows = [[text, True, key in b] for key, text in a.items()] + [[text, False, True] for key, text in b.items() if key not in a]
    differ = any(not (row[1] and row[2]) for row in rows)
    if not rows and args.format == "table":
        print("neither the dataset nor its check has rules")
    elif not differ and args.format == "table":
        print("the dataset and its check hold the same %d rule%s" % (len(rows), "" if len(rows) == 1 else "s"))
    else:
        kit.emit(args, ["rule", "in dataset", "in check"], rows)
    return 1 if differ else 0


# ---------- rules questions ----------


def _configure_questions(parser: Any) -> None:
    _source(parser, text=False)
    kit.add_format(parser)


def run_questions(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    rules = _parsed(args, dataset)
    tuning = _tuning(dataset)
    rows = []
    for qid, (qtype, _answers) in _kinds(dataset).items():
        in_if = sum(any(cond[0] == qid for cond in rule["if"]) for rule in rules)
        in_then = sum(any(cond[0] == qid for cond in rule["then"]) for rule in rules)
        rows.append([qid, qtype, in_if, in_then, sum(qid in shown for _n, shown in tuning)])
    cli_gates._table_or(args, ["question", "type", "rules reading it in if", "rules reading it in then", "labeled tuning rows"], rows,
                        "the dataset has no Choice, Noul or Score questions")
    return 0


PACK = kit.define_pack({
    "id": "cli-rules",
    "surface": "python.cli",
    "title": "Consistency rule commands",
    "about": "Offline `lab.py rules` commands for Policy's consistency rules: list a dataset's or its check's rules, "
             "lint them against the questions, check them against the human labels on tuning rows, suggest rules the "
             "labels already obey, and compare the dataset's rules with its check's. Tuning rows only; no model call.",
    "features": [
        {"id": "list", "kind": "cli", "command": ["rules", "list"], "configure": _configure_list, "run": run_list,
         "title": "List a dataset's rules, parsed: line, if part, then part and the questions each reads",
         "options": [dict(CHECK), dict(FORMAT)]},
        {"id": "lint", "kind": "cli", "command": ["rules", "lint"], "configure": _configure_lint, "run": run_lint,
         "title": "Lint rules against the dataset's questions: unparsed lines, unknown answers, repeats, and rules that never apply, never break or always break; exit 1 on any",
         "options": [dict(CHECK), dict(TEXT), dict(FORMAT)]},
        {"id": "labels", "kind": "cli", "command": ["rules", "labels"], "configure": _configure_labels, "run": run_labels,
         "title": "Check each rule against the human labels on tuning rows: rows labeled for it, rows it applies to, and rows whose labels break it; exit 1 if any",
         "options": [dict(CHECK), dict(TEXT), {"id": "rows", "title": "--rows lists the tuning rows whose labels break each rule"},
                     dict(FORMAT)]},
        {"id": "suggest", "kind": "cli", "command": ["rules", "suggest"], "configure": _configure_suggest, "run": run_suggest,
         "title": "Suggest rules the tuning labels already obey (if A = x then B in the answers seen), with their support and whether they are saved",
         "options": [{"id": "min_rows", "title": "--min-rows N sets how many labeled rows a suggestion needs (default 5)"},
                     {"id": "question", "title": "--question ID keeps suggestions whose if part reads one question"}, dict(FORMAT)]},
        {"id": "compare", "kind": "cli", "command": ["rules", "compare"], "configure": _configure_compare, "run": run_compare,
         "title": "Compare a dataset's rules with the rules saved in its check; exit 1 when they differ",
         "options": [dict(FORMAT)]},
        {"id": "questions", "kind": "cli", "command": ["rules", "questions"], "configure": _configure_questions, "run": run_questions,
         "title": "List each Choice, Noul and Score question with how many rules read it in their if and then parts, and its labeled tuning rows",
         "options": [dict(CHECK), dict(FORMAT)]},
    ],
})
