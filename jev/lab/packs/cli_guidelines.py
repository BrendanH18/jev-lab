"""Offline commands for labeling guidelines (`lab.py guidelines ...`), the notes and examples saved with a dataset.

Guidelines (jev/guidelines.py) are human-only: no request to the model reads them and no gate depends on them. These
commands list which datasets have them, show a dataset's notes and examples, lint them (examples that no longer fit,
examples copied from rows, one input given two labels), show which answers have no example, write a Markdown labeling
guide for the people labeling, and compare two datasets' guidelines by question.

Held-out rows are read only to say that an example repeats one, never with a label. The diff shows counts and flags,
never a note or an example. Nothing calls the model or writes into the Workbench data directory.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from jev import decisions, guidelines, workbench
from jev.lab import kit
from jev.lab.packs import cli_gates

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
LABEL_TYPES = ("choice", "noul", "score")
GUIDED_TYPES = LABEL_TYPES + ("box",)


# ---------- reading ----------


def _questions(dataset: dict) -> Dict[str, dict]:
    raw = dataset.get("questions")
    return {qid: q for qid, q in raw.items() if isinstance(q, dict)} if isinstance(raw, dict) else {}


def _guides(dataset: dict) -> Dict[str, dict]:
    raw = dataset.get(guidelines.KEY)
    return {qid: entry for qid, entry in raw.items() if isinstance(entry, dict)} if isinstance(raw, dict) else {}


def _examples(entry: dict) -> List[dict]:
    raw = entry.get("examples")
    return [example for example in raw if isinstance(example, dict)] if isinstance(raw, list) else []


def _answers(question: dict) -> List[str]:
    """Every answer a label can give, as labels show them: option keys, yes and no, or level numbers."""
    qtype = question.get("type")
    if qtype == "choice":
        return [str(key) for key in question.get("criteria") or {}]
    if qtype == "noul":
        return ["yes", "no"]
    if qtype == "score":
        return [str(level) for level in range(len(question.get("criteria") or []))]
    return []


def _shown(question: dict, value: Any) -> Optional[str]:
    ok, label = decisions.label(question, value)
    if not ok or label is None:
        return None
    return ("yes" if label else "no") if isinstance(label, bool) else str(label)


def _norm(text: Any) -> str:
    return " ".join(str(text).casefold().split())


def _row_texts(row: Any) -> List[str]:
    """The text a row shows a labeler: a text row, or the top-level text fields of an object row."""
    if isinstance(row, str):
        return [row]
    if isinstance(row, dict):
        return [value for key, value in row.items() if isinstance(value, str) and not key.startswith("_")]
    return []


def _describe(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("what", "description", "label"):
            if isinstance(value.get(key), str):
                return value[key]
    return json.dumps(value, ensure_ascii=False)


# ---------- guidelines list ----------


def _configure_list(parser: Any) -> None:
    parser.add_argument("--missing", action="store_true",
                        help="only datasets with a labeled question that has no guideline; exit 1 if any")
    kit.add_format(parser)


def run_list(args: Any) -> int:
    rows = []
    for summary in workbench.list_datasets():
        dataset = workbench.load_dataset(summary["id"])
        questions = {qid: q for qid, q in _questions(dataset).items() if q.get("type") in GUIDED_TYPES}
        if not questions:
            continue
        guides = _guides(dataset)
        without = [qid for qid in questions if qid not in guides]
        if args.missing and not without:
            continue
        rows.append([dataset["id"], len(questions), sum(bool(guides.get(q, {}).get("note")) for q in questions),
                     sum(bool(_examples(guides.get(q, {}))) for q in questions),
                     sum(len(_examples(guides.get(q, {}))) for q in questions), ", ".join(without)])
    empty = "every dataset's questions have guidelines" if args.missing else "no saved dataset has questions"
    cli_gates._table_or(args, ["dataset", "questions", "with a note", "with examples", "examples", "without guidelines"], rows, empty)
    return 1 if args.missing and rows else 0


# ---------- guidelines show ----------


def _configure_show(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument("--question", metavar="ID", help="only this question's guideline")
    parser.add_argument("--examples", action="store_true", help="one row per example: input, label and why")
    kit.add_format(parser)


def _picked(dataset: dict, qid: Optional[str]) -> Dict[str, dict]:
    questions = _questions(dataset)
    if qid is None:
        return questions
    if qid not in questions:
        raise kit.CliError("dataset %r has no question %s" % (dataset["id"], qid))
    return {qid: questions[qid]}


def run_show(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    guides = _guides(dataset)
    picked = _picked(dataset, args.question)
    if args.examples:
        rows = [[qid, number, example.get("input"), _shown(question, example.get("label")) or "", example.get("why", "")]
                for qid, question in picked.items() for number, example in enumerate(_examples(guides.get(qid, {})), 1)]
        cli_gates._table_or(args, ["question", "#", "input", "label", "why"], rows, "no labeling examples")
        return 0
    rows = [[qid, question.get("type"), guides.get(qid, {}).get("note", ""), len(_examples(guides.get(qid, {})))]
            for qid, question in picked.items() if qid in guides]
    cli_gates._table_or(args, ["question", "type", "note", "examples"], rows, "no labeling guidelines")
    return 0


# ---------- guidelines lint ----------


def _configure_lint(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument("--question", metavar="ID", help="only this question's guideline")
    kit.add_format(parser)


def _row_index(dataset: dict) -> Tuple[Dict[str, List[int]], set]:
    """(normalized text -> tuning row numbers, normalized texts of held-out rows)."""
    tuning: Dict[str, List[int]] = {}
    held = set()
    for number, row in enumerate(dataset["rows"], 1):
        texts = {_norm(text) for text in _row_texts(row) if text.strip()}
        if isinstance(row, dict) and row.get(workbench.TEST_KEY) is True:
            held |= texts
        else:
            for text in texts:
                tuning.setdefault(text, []).append(number)
    return tuning, held


def run_lint(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    questions = _questions(dataset)
    tuning, held = _row_index(dataset)
    rows = []
    for qid, entry in _guides(dataset).items():
        if args.question and qid != args.question:
            continue
        question = questions.get(qid)
        if question is None:
            rows.append([qid, None, "the dataset has no such question; the next save drops this guideline"])
            continue
        if not entry.get("note") and not _examples(entry):
            rows.append([qid, None, "holds neither a note nor an example"])
        seen: Dict[str, Tuple[int, Optional[str]]] = {}
        for number, example in enumerate(_examples(entry), 1):
            if question.get("type") not in LABEL_TYPES:
                rows.append([qid, number, "%s questions take a note, not label examples" % str(question.get("type")).capitalize()])
                continue
            label = _shown(question, example.get("label"))
            if label is None:
                rows.append([qid, number, "the label is not a valid answer for this %s question" % question.get("type")])
            text = _norm(example.get("input") or "")
            if not text:
                rows.append([qid, number, "has no input"])
                continue
            if text in tuning:
                rows.append([qid, number, "repeats the input of tuning row %s; examples should be generic, not taken from rows"
                             % ", ".join(map(str, tuning[text]))])
            if text in held:
                rows.append([qid, number, "repeats the input of a held-out row; write a generic example instead"])
            if text in seen and label is not None and seen[text][1] is not None and seen[text][1] != label:
                rows.append([qid, number, "gives the input of example %d a different label" % seen[text][0]])
            seen.setdefault(text, (number, label))
    cli_gates._table_or(args, ["question", "example", "problem"], rows, "no problems in the labeling guidelines")
    return 1 if rows else 0


# ---------- guidelines coverage ----------


def _configure_coverage(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument("--missing-only", action="store_true", help="only questions with an answer no example shows; exit 1 if any")
    kit.add_format(parser)


def run_coverage(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    guides = _guides(dataset)
    rows = []
    for qid, question in _questions(dataset).items():
        answers = _answers(question)
        if not answers:
            continue
        shown = {_shown(question, example.get("label")) for example in _examples(guides.get(qid, {}))}
        missing = [answer for answer in answers if answer not in shown]
        if args.missing_only and not missing:
            continue
        rows.append([qid, question.get("type"), bool(guides.get(qid, {}).get("note")), len(answers), len(answers) - len(missing),
                     ", ".join(missing)])
    empty = "every answer has a labeling example" if args.missing_only else "the dataset has no Choice, Noul or Score questions"
    cli_gates._table_or(args, ["question", "type", "note", "answers", "with an example", "without an example"], rows, empty)
    return 1 if args.missing_only and rows else 0


# ---------- guidelines export ----------


def _configure_export(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset")
    parser.add_argument("--question", action="append", metavar="ID", help="only these questions (repeat the flag)")
    parser.add_argument("--out", metavar="PATH", help="write the guide to this file, outside the Workbench data directory")
    parser.add_argument("--force", action="store_true", help="replace the --out file if it exists")


def _guide(dataset: dict, qids: Optional[List[str]]) -> str:
    questions = _questions(dataset)
    for qid in qids or []:
        if qid not in questions:
            raise kit.CliError("dataset %r has no question %s" % (dataset["id"], qid))
    guides = _guides(dataset)
    lines = ["# Labeling guide: %s" % (dataset.get("name") or dataset["id"]), ""]
    for qid, question in questions.items():
        if qids and qid not in qids:
            continue
        qtype = question.get("type")
        lines += ["## %s (%s)" % (qid, qtype), "", _describe(question.get("instructions") or ""), ""]
        criteria = question.get("criteria")
        if qtype == "choice" and isinstance(criteria, dict):
            lines += ["Answers:", ""] + ["- `%s`: %s" % (key, _describe(value)) for key, value in criteria.items()] + [""]
        elif qtype == "score" and isinstance(criteria, list):
            lines += ["Levels:", ""] + ["- %d: %s" % (level, _describe(value)) for level, value in enumerate(criteria)] + [""]
        elif qtype == "noul" and isinstance(criteria, dict):
            lines += ["Answers:", ""] + ["- %s: %s" % ({"true": "yes", "false": "no"}.get(key, key), _describe(value))
                                         for key, value in criteria.items()] + [""]
        entry = guides.get(qid, {})
        if entry.get("note"):
            lines += ["Note: %s" % entry["note"], ""]
        examples = _examples(entry)
        if examples:
            lines += ["Examples:", ""]
            for example in examples:
                why = " (%s)" % example["why"] if example.get("why") else ""
                lines.append("- \"%s\" is labeled %s%s" % (example.get("input"), _shown(question, example.get("label")) or "?", why))
            lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def run_export(args: Any) -> int:
    dataset = workbench.load_dataset(args.dataset)
    text = _guide(dataset, args.question)
    if args.out:
        target = cli_gates._out_path(args.out, args.force)
        target.write_bytes(text.encode("utf-8"))
        print("wrote the labeling guide of %s to %s" % (dataset["id"], args.out))
    else:
        print(text, end="")
    return 0


# ---------- guidelines diff ----------


def _configure_diff(parser: Any) -> None:
    parser.add_argument("a", help="the first dataset id")
    parser.add_argument("b", help="the second dataset id")
    kit.add_format(parser)


def run_diff(args: Any) -> int:
    ga, gb = _guides(workbench.load_dataset(args.a)), _guides(workbench.load_dataset(args.b))
    changes = guidelines.changes(ga, gb)
    rows = []
    for qid in dict.fromkeys(list(ga) + list(gb)):
        status = ("added" if qid in changes["added"] else "removed" if qid in changes["removed"]
                  else "changed" if qid in changes["changed"] else "same")
        if status == "same":
            continue
        a, b = ga.get(qid, {}), gb.get(qid, {})
        rows.append([qid, status, (a.get("note") or "") != (b.get("note") or ""), len(_examples(a)), len(_examples(b))])
    cli_gates._table_or(args, ["question", "status", "note differs", "examples A", "examples B"], rows, "same guidelines")
    return 1 if rows else 0


# ---------- guidelines search ----------


def _configure_search(parser: Any) -> None:
    parser.add_argument("text", help="the words to find, ignoring case and spacing")
    parser.add_argument("--dataset", metavar="ID", help="only this dataset's guidelines")
    kit.add_format(parser)


def run_search(args: Any) -> int:
    needle = _norm(args.text)
    if not needle:
        raise kit.CliError("give some text to search for")
    ids = [args.dataset] if args.dataset else [summary["id"] for summary in workbench.list_datasets()]
    rows = []
    for dataset_id in ids:
        guides = _guides(workbench.load_dataset(dataset_id))
        for qid, entry in guides.items():
            if needle in _norm(entry.get("note") or ""):
                rows.append([dataset_id, qid, "note", entry["note"]])
            for number, example in enumerate(_examples(entry), 1):
                text = " ".join(str(example.get(field) or "") for field in ("input", "why"))
                if needle in _norm(text):
                    rows.append([dataset_id, qid, "example %d" % number, example.get("input")])
    cli_gates._table_or(args, ["dataset", "question", "where", "text"], rows, "no labeling guideline mentions %r" % args.text)
    return 1 if rows else 0


PACK = kit.define_pack({
    "id": "cli-guidelines",
    "surface": "python.cli",
    "title": "Labeling guideline commands",
    "about": "Offline `lab.py guidelines` commands for the human-only labeling guidelines saved with datasets: list "
             "them, show notes and examples, lint them, find answers without an example, write a Markdown labeling "
             "guide, and diff two datasets' guidelines by question. Held-out rows are never shown with a label.",
    "features": [
        {"id": "list", "kind": "cli", "command": ["guidelines", "list"], "configure": _configure_list, "run": run_list,
         "title": "List datasets with their labeled questions, how many have a note or examples, and the ones without guidelines",
         "options": [{"id": "missing", "title": "--missing keeps datasets with a question that has no guideline and exits 1 if any"},
                     dict(FORMAT)]},
        {"id": "show", "kind": "cli", "command": ["guidelines", "show"], "configure": _configure_show, "run": run_show,
         "title": "Show a dataset's labeling guidelines: each question's type, note and example count",
         "options": [{"id": "question", "title": "--question ID shows one question's guideline"},
                     {"id": "examples", "title": "--examples lists every example with its input, label and why"}, dict(FORMAT)]},
        {"id": "lint", "kind": "cli", "command": ["guidelines", "lint"], "configure": _configure_lint, "run": run_lint,
         "title": "Lint labeling guidelines: stale questions, labels that no longer fit, examples copied from rows, one input labeled two ways; exit 1 on any",
         "options": [{"id": "question", "title": "--question ID lints one question's guideline"}, dict(FORMAT)]},
        {"id": "coverage", "kind": "cli", "command": ["guidelines", "coverage"], "configure": _configure_coverage, "run": run_coverage,
         "title": "Show which answers of each Choice, Noul and Score question have a labeling example, and which have none",
         "options": [{"id": "missing_only", "title": "--missing-only keeps questions with an answer no example shows and exits 1 if any"},
                     dict(FORMAT)]},
        {"id": "export", "kind": "cli", "command": ["guidelines", "export"], "configure": _configure_export, "run": run_export,
         "title": "Write a Markdown labeling guide: each question's instructions, answers, note and examples",
         "options": [{"id": "question", "title": "--question ID keeps chosen questions in the guide (repeat the flag)"},
                     {"id": "out", "title": "--out PATH writes the guide to a file outside the Workbench data directory"},
                     {"id": "force", "title": "--force replaces an existing --out file"}]},
        {"id": "diff", "kind": "cli", "command": ["guidelines", "diff"], "configure": _configure_diff, "run": run_diff,
         "title": "Diff two datasets' guidelines by question: added, removed or changed, whether the note differs and example counts; exit 1 if any",
         "options": [dict(FORMAT)]},
        {"id": "search", "kind": "cli", "command": ["guidelines", "search"], "configure": _configure_search, "run": run_search,
         "title": "Find labeling-guideline notes and examples that mention some text, across datasets; exit 1 on a match",
         "options": [{"id": "dataset", "title": "--dataset ID searches one dataset's guidelines"}, dict(FORMAT)]},
    ],
})
