"""Offline commands over the human labels on a dataset's tuning rows (`lab.py labels ...`).

These read the labels people gave, never model answers: how two questions' labels go together, how one question's
labels split by an input field, how far two datasets' labels agree on the inputs they share (with Cohen's kappa), and
which tuning rows still lack a label, optionally exported as unlabeled rows to label elsewhere.

Only tuning rows are read; held-out rows, their inputs and their labels are never read or counted here. Nothing calls
the model or writes a file.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from jev import decisions, slices, workbench
from jev.lab import kit
from jev.lab.packs import cli_gates

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
LABEL_TYPES = ("choice", "noul", "score")
INPUT_CHARS = 60


# ---------- reading ----------


def _questions(dataset: dict) -> Dict[str, dict]:
    raw = dataset.get("questions") if isinstance(dataset.get("questions"), dict) else {}
    return {qid: q for qid, q in raw.items() if isinstance(q, dict) and q.get("type") in LABEL_TYPES}


def _question(dataset: dict, qid: str) -> dict:
    questions = _questions(dataset)
    if qid not in questions:
        raise kit.CliError("%s is not a Choice, Noul or Score question of dataset %r" % (qid, dataset["id"]))
    return questions[qid]


def _answers(question: dict) -> List[str]:
    if question["type"] == "choice":
        return [str(key) for key in question.get("criteria") or {}]
    if question["type"] == "noul":
        return ["yes", "no"]
    return [str(level) for level in range(len(question.get("criteria") or []))]


def _label(question: dict, row: Any, qid: str) -> Optional[str]:
    labels = row.get(workbench.LABEL_KEY) if isinstance(row, dict) else None
    if not isinstance(labels, dict) or labels.get(qid) in (None, ""):
        return None
    ok, label = decisions.label(question, labels[qid])
    if not ok or label is None:
        return None
    return ("yes" if label else "no") if isinstance(label, bool) else str(label)


def _tuning(dataset: dict) -> List[Tuple[int, Any]]:
    """(1-based row number, row) for every tuning row."""
    return [(number, row) for number, row in enumerate(dataset["rows"], 1)
            if not (isinstance(row, dict) and row.get(workbench.TEST_KEY) is True)]


def _input_text(row: Any) -> str:
    state = workbench.without_marks(row)
    text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False, sort_keys=True)
    return text if len(text) <= INPUT_CHARS else text[:INPUT_CHARS - 1] + "…"


# ---------- labels crosstab ----------


def _configure_crosstab(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument("first", help="the question whose labels make the rows")
    parser.add_argument("second", help="the question whose labels make the columns")
    parser.add_argument("--shares", action="store_true", help="print each cell as a share of its row's labeled rows")
    kit.add_format(parser)


def run_crosstab(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    qa, qb = _question(dataset, args.first), _question(dataset, args.second)
    pairs = [(a, b) for _n, row in _tuning(dataset)
             for a, b in [(_label(qa, row, args.first), _label(qb, row, args.second))] if a is not None and b is not None]
    columns = _answers(qb)
    rows = []
    for answer in _answers(qa):
        counts = [sum(1 for a, b in pairs if a == answer and b == column) for column in columns]
        total = sum(counts)
        cells = [round(count / total, 6) if total else None for count in counts] if args.shares else counts
        rows.append([answer] + cells + [total])
    if args.format == "table":
        print("%s (rows) by %s (columns) on %d tuning rows labeled for both" % (args.first, args.second, len(pairs)))
    kit.emit(args, ["%s \\ %s" % (args.first, args.second)] + columns + ["total"], rows)
    return 0


# ---------- labels by-field ----------


def _configure_by_field(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument("question", help="a Choice, Noul or Score question")
    parser.add_argument("--field", required=True, metavar="FIELD", help="the top-level input field to split by")
    parser.add_argument("--min-rows", type=int, default=1, metavar="N", help="only values with at least N labeled rows")
    kit.add_format(parser)


def run_by_field(args: Any) -> int:
    if args.field in (workbench.LABEL_KEY, workbench.TEST_KEY):
        raise kit.CliError("labels and test markers cannot be slice fields")
    dataset = workbench.load_dataset(args.dataset)
    question = _question(dataset, args.question)
    answers = _answers(question)
    groups: Dict[str, List[str]] = {}
    for _n, row in _tuning(dataset):
        label = _label(question, row, args.question)
        if label is not None:
            groups.setdefault(slices._value(row, args.field), []).append(label)
    rows = []
    for value in sorted(groups, key=lambda v: (-len(groups[v]), v)):
        labels = groups[value]
        if len(labels) < args.min_rows:
            continue
        counts = [labels.count(answer) for answer in answers]
        top = max(range(len(answers)), key=lambda i: (counts[i], -i))
        rows.append([slices._shown(value), len(labels)] + counts + [answers[top]])
    cli_gates._table_or(args, [args.field, "labeled rows"] + answers + ["most common"], rows,
                        "no value of %s has %d or more labeled rows" % (args.field, args.min_rows))
    return 0


# ---------- labels agree ----------


def _configure_agree(parser: Any) -> None:
    parser.add_argument("a", help="the first dataset id")
    parser.add_argument("b", help="the second dataset id")
    parser.add_argument("--question", metavar="ID", help="only this question")
    parser.add_argument("--min-agreement", type=float, metavar="X", help="exit 1 when a question's agreement is below X")
    kit.add_format(parser)


def _first_labels(dataset: dict, qid: str, question: dict) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for _n, row in _tuning(dataset):
        label = _label(question, row, qid)
        if label is not None:
            out.setdefault(decisions._key(row), label)
    return out


def kappa(pairs: List[Tuple[str, str]]) -> Optional[float]:
    """Cohen's kappa for two labelers' answers on the same items; None when chance agreement is certain."""
    n = len(pairs)
    if not n:
        return None
    observed = sum(a == b for a, b in pairs) / n
    answers = {a for a, _b in pairs} | {b for _a, b in pairs}
    chance = sum((sum(a == k for a, _b in pairs) / n) * (sum(b == k for _a, b in pairs) / n) for k in answers)
    return None if chance >= 1 else (observed - chance) / (1 - chance)


def run_agree(args: Any) -> int:
    da, db = workbench.load_dataset(args.a), workbench.load_dataset(args.b)
    qa, qb = _questions(da), _questions(db)
    shared = [qid for qid in qa if qid in qb and qa[qid]["type"] == qb[qid]["type"]]
    if args.question:
        if args.question not in shared:
            raise kit.CliError("%s is not a Choice, Noul or Score question of the same type in both datasets" % args.question)
        shared = [args.question]
    rows, low = [], False
    for qid in shared:
        left, right = _first_labels(da, qid, qa[qid]), _first_labels(db, qid, qb[qid])
        pairs = [(left[key], right[key]) for key in left if key in right]
        agreed = sum(a == b for a, b in pairs)
        share = agreed / len(pairs) if pairs else None
        value = kappa(pairs)
        if args.min_agreement is not None and share is not None and share < args.min_agreement:
            low = True
        rows.append([qid, len(pairs), agreed, None if share is None else round(share, 6), None if value is None else round(value, 6)])
    cli_gates._table_or(args, ["question", "shared inputs", "agreed", "agreement", "kappa"], rows,
                        "the datasets share no Choice, Noul or Score question")
    return 1 if low else 0


# ---------- labels missing ----------


def _configure_missing(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument("--question", metavar="ID", help="only rows missing a label for this question")
    parser.add_argument("--limit", type=int, metavar="N", help="only the first N rows")
    parser.add_argument("--export", action="store_true",
                        help="print the rows as JSON lines, inputs and picture names only, ready to label elsewhere")
    kit.add_format(parser)


def run_missing(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    questions = _questions(dataset)
    if args.question:
        questions = {args.question: _question(dataset, args.question)}
    found = []
    for number, row in _tuning(dataset):
        missing = [qid for qid, question in questions.items() if _label(question, row, qid) is None]
        if missing:
            found.append((number, row, missing))
    if args.limit is not None:
        found = found[:max(args.limit, 0)]
    if args.export:
        for _number, row, _missing in found:
            state = workbench.without_marks(row)
            print(json.dumps({"text": state} if isinstance(state, str) else state, ensure_ascii=False))
        return 0
    rows = [[number, ", ".join(missing), _input_text(row)] for number, row, missing in found]
    cli_gates._table_or(args, ["row", "missing", "input"], rows, "every tuning row has a valid label for every question")
    return 0


PACK = kit.define_pack({
    "id": "cli-labels",
    "surface": "python.cli",
    "title": "Human label commands",
    "about": "Offline `lab.py labels` commands over the human labels on tuning rows: a cross-tab of two questions, one "
             "question's labels by an input field, agreement and Cohen's kappa between two datasets on shared inputs, "
             "and the rows still missing a label, exportable as unlabeled rows. Held-out rows are never read.",
    "features": [
        {"id": "crosstab", "kind": "cli", "command": ["labels", "crosstab"], "configure": _configure_crosstab, "run": run_crosstab,
         "title": "Cross-tabulate two questions' labels on tuning rows labeled for both",
         "options": [{"id": "shares", "title": "--shares prints each cell as a share of its row"}, dict(FORMAT)]},
        {"id": "by_field", "kind": "cli", "command": ["labels", "by-field"], "configure": _configure_by_field, "run": run_by_field,
         "title": "Count one question's tuning labels per value of an input field, with each value's most common answer",
         "options": [{"id": "min_rows", "title": "--min-rows N keeps values with at least N labeled rows"}, dict(FORMAT)]},
        {"id": "agree", "kind": "cli", "command": ["labels", "agree"], "configure": _configure_agree, "run": run_agree,
         "title": "Measure how often two datasets' labels agree on the tuning inputs they share, per question, with Cohen's kappa",
         "options": [{"id": "question", "title": "--question ID compares one question"},
                     {"id": "min_agreement", "title": "--min-agreement X exits 1 when a question agrees on less than X of shared inputs"},
                     dict(FORMAT)]},
        {"id": "missing", "kind": "cli", "command": ["labels", "missing"], "configure": _configure_missing, "run": run_missing,
         "title": "List the tuning rows still missing a valid label, with the questions they lack and a short input",
         "options": [{"id": "question", "title": "--question ID keeps rows missing one question's label"},
                     {"id": "limit", "title": "--limit N keeps the first N rows"},
                     {"id": "export", "title": "--export prints the rows as unlabeled JSON lines to label elsewhere"}, dict(FORMAT)]},
    ],
})
