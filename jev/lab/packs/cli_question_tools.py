"""More offline commands for question set files (`lab.py questions ...`), beside the ones in cli_questions.

Merge several question files into one, refusing ids defined two ways; add or strip an id prefix on every question, as
Autopilot prefixes Shield's and Dispatch's questions to send them in one request; list every answer a label can take
with what it means; and write a JSON Schema for the `_expect` labels of a rows file, so another labeling tool can check
labels before they come back. Nothing calls the model; files are written only where --out names.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from jev import workbench
from jev.lab import kit
from jev.lab.packs import cli_guidelines, cli_questions

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
OUT = {"id": "out", "title": "--out PATH writes the result to a file instead of printing it"}
_PREFIX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
SCHEMA = "https://json-schema.org/draft/2020-12/schema"


def _write_or_print(args: Any, text: str, what: str) -> None:
    if args.out:
        cli_questions._write_out(args.out, text, getattr(args, "force", None))
        print("wrote %s (%s)" % (args.out, what))
    else:
        print(text, end="")


# ---------- questions merge ----------


def _configure_merge(parser: Any) -> None:
    parser.add_argument("files", nargs="+", help="question or request JSON files, merged in order")
    parser.add_argument("--out", metavar="PATH", help="write the merged questions to this new file instead of printing them")
    parser.add_argument("--force", action="store_true", help="let --out replace an existing file")


def _canonical(question: dict) -> str:
    """A question as text for comparison: field order ignored, but a Choice's option order kept, since it is
    configuration (decision provenance records it)."""
    def ordered(key: str, value: Any) -> Any:
        choice = key == "criteria" and question.get("type") == "choice" and isinstance(value, dict)
        return [list(pair) for pair in value.items()] if choice else value
    return json.dumps({key: ordered(key, value) for key, value in question.items()}, sort_keys=True)


def _same(a: dict, b: dict) -> bool:
    return _canonical(a) == _canonical(b)


def run_merge(args: Any) -> int:
    if len(args.files) < 2:
        raise kit.CliError("name at least two files to merge")
    merged: Dict[str, dict] = {}
    source: Dict[str, str] = {}
    conflicts: List[str] = []
    for path in args.files:
        for qid, question in cli_questions._questions(path).items():
            if qid not in merged:
                merged[qid], source[qid] = question, path
            elif not _same(merged[qid], question) and qid not in conflicts:
                conflicts.append(qid)
    if conflicts:
        for qid in conflicts:
            print("conflict: %s is defined differently in %s and a later file" % (qid, source[qid]))
        return 1
    merged = cli_questions._valid("the merged questions", merged)
    _write_or_print(args, cli_questions._json_text(merged), cli_questions._count(len(merged)))
    return 0


# ---------- questions prefix ----------


def _configure_prefix(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("prefix", help="the prefix, such as shield.")
    parser.add_argument("--strip", action="store_true", help="remove the prefix from every id instead of adding it")
    parser.add_argument("--out", metavar="PATH", help="write the result to this new file instead of printing it")
    parser.add_argument("--force", action="store_true", help="let --out replace an existing file, such as the input itself")


def run_prefix(args: Any) -> int:
    if not _PREFIX.match(args.prefix):
        raise kit.CliError("the prefix must start with a letter or digit and hold only letters, digits, _ . and -")
    data, questions, request = cli_questions._load_editable(args.file)
    if args.strip:
        lacking = [qid for qid in questions if not qid.startswith(args.prefix) or qid == args.prefix]
        if lacking:
            raise kit.CliError("%s %s not start with %r" % (", ".join(lacking), "does" if len(lacking) == 1 else "do", args.prefix))
        names = {qid: qid[len(args.prefix):] for qid in questions}
    else:
        names = {qid: args.prefix + qid for qid in questions}
    if len(set(names.values())) != len(names):
        raise kit.CliError("two questions would get the same id")
    renamed = {names[qid]: question for qid, question in questions.items()}
    cli_questions._valid(args.file, renamed)
    text = cli_questions._json_text(cli_questions._rebuild(data, renamed, request, names))
    what = ("removed %r from %s" if args.strip else "added %r to %s") % (args.prefix, cli_questions._count(len(renamed), "id"))
    _write_or_print(args, text, what)
    return 0


# ---------- questions answers ----------


def _configure_answers(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("--question", metavar="ID", help="only this question's answers")
    kit.add_format(parser)


def run_answers(args: Any) -> int:
    questions = cli_questions._questions(args.file)
    if args.question:
        if args.question not in questions:
            raise kit.CliError("%s has no question %r" % (args.file, args.question))
        questions = {args.question: questions[args.question]}
    rows = []
    for qid, question in questions.items():
        qtype, criteria = question["type"], question.get("criteria")
        if qtype == "choice":
            rows += [[qid, qtype, str(key), cli_guidelines._describe(value)] for key, value in criteria.items()]
        elif qtype == "score":
            rows += [[qid, qtype, str(level), cli_guidelines._describe(value)] for level, value in enumerate(criteria)]
        elif qtype == "noul":
            given = criteria if isinstance(criteria, dict) else {}
            rows += [[qid, qtype, answer, cli_guidelines._describe(given[key]) if key in given else ""]
                     for answer, key in (("yes", "true"), ("no", "false"))]
        else:
            rows.append([qid, qtype, "a box", "left, top, right and bottom edges as fractions of the picture"])
    kit.emit(args, ["question", "type", "label", "meaning"], rows)
    return 0


# ---------- questions schema ----------


def _configure_schema(parser: Any) -> None:
    parser.add_argument("file", help="a questions or request JSON file")
    parser.add_argument("--out", metavar="PATH", help="write the schema to this new file instead of printing it")
    parser.add_argument("--force", action="store_true", help="let --out replace an existing file")


def schema(questions: Dict[str, dict]) -> dict:
    """A JSON Schema for a row's `_expect` object: every key a question id, every value a label it accepts."""
    properties: Dict[str, dict] = {}
    for qid, question in questions.items():
        qtype = question["type"]
        if qtype == "choice":
            properties[qid] = {"enum": [str(key) for key in question["criteria"]]}
        elif qtype == "noul":
            properties[qid] = {"type": "boolean"}
        elif qtype == "score":
            properties[qid] = {"type": "integer", "minimum": 0, "maximum": len(question["criteria"]) - 1}
        else:
            properties[qid] = {"type": "object", "required": list(workbench.EDGES), "additionalProperties": False,
                               "properties": {edge: {"type": "number", "minimum": 0, "maximum": 1} for edge in workbench.EDGES}}
        properties[qid] = {"description": "%s question" % qtype.capitalize(), "anyOf": [properties[qid], {"type": "null"}]}
    return {"$schema": SCHEMA, "title": "Workbench labels (%s)" % workbench.LABEL_KEY, "type": "object",
            "additionalProperties": False, "properties": properties}


def run_schema(args: Any) -> int:
    text = cli_questions._json_text(schema(cli_questions._questions(args.file)))
    _write_or_print(args, text, "a label schema")
    return 0


PACK = kit.define_pack({
    "id": "cli-question-tools",
    "surface": "python.cli",
    "title": "More question set tools",
    "about": "More offline `lab.py questions` commands: merge question files without silently redefining an id, add or "
             "strip an id prefix as merged requests use, list every label each question accepts with its meaning, and "
             "write a JSON Schema for rows' `_expect` labels.",
    "features": [
        {"id": "merge", "kind": "cli", "command": ["questions", "merge"], "configure": _configure_merge, "run": run_merge,
         "title": "Merge question files in order, keeping one copy of identical questions; exit 1 naming ids defined differently",
         "options": [dict(OUT, title="--out PATH writes the merged questions to a new file"),
                     {"id": "force", "title": "--force lets --out replace an existing file"}]},
        {"id": "prefix", "kind": "cli", "command": ["questions", "prefix"], "configure": _configure_prefix, "run": run_prefix,
         "title": "Add a prefix to every question id, moving a request's expectations with them, as merged requests name questions",
         "options": [{"id": "strip", "title": "--strip removes the prefix from every id instead"}, dict(OUT)]},
        {"id": "answers", "kind": "cli", "command": ["questions", "answers"], "configure": _configure_answers, "run": run_answers,
         "title": "List every label each question accepts (option keys, yes and no, level numbers) with what it means",
         "options": [{"id": "question", "title": "--question ID lists one question's labels"}, dict(FORMAT)]},
        {"id": "schema", "kind": "cli", "command": ["questions", "schema"], "configure": _configure_schema, "run": run_schema,
         "title": "Write a JSON Schema for rows' _expect labels, so another labeling tool can check labels before import",
         "options": [dict(OUT, title="--out PATH writes the schema to a new file")]},
    ],
})
