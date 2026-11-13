"""Offline commands for the built-in examples (jev/examples.py): list, show the authored request, outline its
questions, export it as a request JSON file, search the descriptions and questions, and list the pictures the
examples use. Expectations are shown or exported only when asked for with --expectations; nothing here calls
the model, and the only file written is the one named with --out."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from jev import examples, images, workbench
from jev.lab import kit

TYPES = workbench.QUESTION_TYPES
FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
DESCRIPTION_FIELDS = ("pattern", "blurb", "code")


def _example(example_id: str) -> dict:
    try:
        return examples.get(example_id)
    except KeyError:
        raise kit.CliError("no built-in example %r; `lab.py examples list` shows them" % example_id)


def _pictures(example: dict) -> Dict[str, dict]:
    found = example.get("images")
    return dict(found) if isinstance(found, dict) else {}


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _words(value: Any) -> int:
    return sum(len(text.split()) for text in _strings(value))


def _entries(question: dict) -> List[Tuple[str, Any]]:
    criteria = question.get("criteria")
    if question["type"] == "score" and isinstance(criteria, list):
        return [(str(index), level) for index, level in enumerate(criteria)]
    if isinstance(criteria, dict):
        return list(criteria.items())
    return []


def _criteria_count(question: dict) -> int:
    """Choice options, Score levels, or the Noul true/false criteria that say something; a Box has none."""
    entries = _entries(question)
    if question["type"] == "noul":
        return sum(value not in (None, "", {}, []) for _key, value in entries)
    return len(entries)


def _type_summary(questions: Dict[str, dict]) -> str:
    counts = [(qtype, sum(q["type"] == qtype for q in questions.values())) for qtype in TYPES]
    return ", ".join("%d %s" % (count, qtype) for qtype, count in counts if count)


def _request(example: dict, expectations: bool) -> dict:
    """The authored request: state, questions and picture references; expectations only when asked for."""
    out: Dict[str, Any] = {"state": example["state"], "questions": example["questions"]}
    if _pictures(example):
        out["images"] = _pictures(example)
    if expectations:
        out["expect"] = example.get("expect") or {}
    return out


def _table_or(args: Any, columns: List[str], rows: List[list], empty: str) -> None:
    if not rows and getattr(args, "format", "table") == "table":
        print(empty)
    else:
        kit.emit(args, columns, rows)


# ---------- list ----------


def _configure_list(parser: Any) -> None:
    parser.add_argument("--type", choices=TYPES, help="only examples with a question of this type")
    parser.add_argument("--pictures", action="store_true", help="only examples that send a picture")
    parser.add_argument("--sort", choices=("gallery", "id", "title", "questions"), default="gallery",
                        help="gallery order (default), id, title, or most questions first")
    kit.add_format(parser)


def run_list(args: Any) -> int:
    rows = []
    for example in examples.EXAMPLES:
        questions = example["questions"]
        if args.type and not any(q["type"] == args.type for q in questions.values()):
            continue
        if args.pictures and not _pictures(example):
            continue
        state = "text" if isinstance(example["state"], str) else "object"
        rows.append([example["id"], example["title"], len(questions), _type_summary(questions), state, len(_pictures(example))])
    if args.sort == "id":
        rows.sort(key=lambda row: row[0])
    elif args.sort == "title":
        rows.sort(key=lambda row: row[1].lower())
    elif args.sort == "questions":
        rows.sort(key=lambda row: (-row[2], row[0]))
    _table_or(args, ["id", "title", "questions", "types", "state", "pictures"], rows, "no example matches")
    return 0


# ---------- show ----------


def _configure_show(parser: Any) -> None:
    parser.add_argument("id", help="an example id")
    parser.add_argument("--expectations", action="store_true", help="include the example's authored expectations")
    parser.add_argument("--part", choices=("state", "questions", "images"), help="print only this part of the request")


def run_show(args: Any) -> int:
    example = _example(args.id)
    if args.part:
        value: Any = _request(example, False).get(args.part, {})
    else:
        value = dict({"id": example["id"], "title": example["title"]}, **_request(example, args.expectations))
    print(json.dumps(value, indent=2, ensure_ascii=False))
    return 0


# ---------- outline ----------


def _configure_outline(parser: Any) -> None:
    parser.add_argument("id", nargs="?", help="an example id (leave out with --all)")
    parser.add_argument("--all", action="store_true", help="outline every example's questions in one table")
    parser.add_argument("--type", choices=TYPES, help="only questions of this type")
    parser.add_argument("--criteria", action="store_true", help="one row per criterion instead of one per question")
    kit.add_format(parser)


def run_outline(args: Any) -> int:
    if bool(args.id) == bool(args.all):
        raise kit.CliError("name one example id, or pass --all")
    chosen = examples.EXAMPLES if args.all else [_example(args.id)]
    lead = ["example"] if args.all else []
    rows = []
    for example in chosen:
        first = [example["id"]] if args.all else []
        for position, (qid, q) in enumerate(example["questions"].items(), 1):
            if args.type and q["type"] != args.type:
                continue
            if args.criteria:
                rows += [first + [qid, q["type"], key, _words(value)] for key, value in _entries(q)]
            else:
                rows.append(first + [position, qid, q["type"], _criteria_count(q), _words(q["instructions"])])
    columns = ["question", "type", "key", "words"] if args.criteria else ["#", "question", "type", "criteria", "words"]
    _table_or(args, lead + columns, rows, "no question matches")
    return 0


# ---------- export ----------


def _configure_export(parser: Any) -> None:
    parser.add_argument("id", help="an example id")
    parser.add_argument("--out", required=True, metavar="PATH", help="the request JSON file to write")
    parser.add_argument("--expectations", action="store_true", help="include the example's authored expectations")
    parser.add_argument("--questions-only", action="store_true", help="write only the questions object")
    parser.add_argument("--force", action="store_true", help="replace the file if it exists")


def run_export(args: Any) -> int:
    example = _example(args.id)
    if args.questions_only and args.expectations:
        raise kit.CliError("--questions-only writes no expectations; leave out one of them")
    target = Path(args.out)
    if target.is_dir():
        raise kit.CliError("--out %s is a folder; name a file" % args.out)
    if target.exists() and not args.force:
        raise kit.CliError("%s already exists; choose another --out path or pass --force" % args.out)
    if not target.parent.is_dir():
        raise kit.CliError("the folder for --out %s does not exist" % args.out)
    value = example["questions"] if args.questions_only else _request(example, args.expectations)
    target.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote %s to %s" % (example["id"], args.out))
    return 0


# ---------- search ----------


def _configure_search(parser: Any) -> None:
    parser.add_argument("text", help="text to look for (any case)")
    parser.add_argument("--in", dest="where", choices=("title", "description", "questions"),
                        help="look only in the title, the description (pattern, blurb, code) or the questions")
    parser.add_argument("--regex", action="store_true", help="TEXT is a regular expression")
    kit.add_format(parser)


def _searchable(example: dict) -> Dict[str, List[str]]:
    """The authored text search reads. Never the state or the expectations."""
    questions = []
    for qid, q in example["questions"].items():
        questions.append(qid)
        questions += list(_strings(q["instructions"]))
        criteria = q.get("criteria")
        questions += (list(criteria) if isinstance(criteria, dict) else []) + list(_strings(criteria))
    return {"title": [example["title"]], "description": [str(example.get(field) or "") for field in DESCRIPTION_FIELDS], "questions": questions}


def run_search(args: Any) -> int:
    try:
        pattern = re.compile(args.text if args.regex else re.escape(args.text), re.IGNORECASE)
    except re.error as err:
        raise kit.CliError("--regex %r is not a regular expression: %s" % (args.text, err))
    rows = []
    for example in examples.EXAMPLES:
        parts = _searchable(example)
        matched = [part for part in ("title", "description", "questions")
                   if (not args.where or part == args.where) and any(pattern.search(text) for text in parts[part])]
        if matched:
            rows.append([example["id"], example["title"], ", ".join(matched)])
    _table_or(args, ["example", "title", "matched"], rows, "no example matches")
    return 0


# ---------- pictures ----------


def _configure_pictures(parser: Any) -> None:
    kit.add_format(parser)


def run_pictures(args: Any) -> int:
    rows = []
    for example in examples.EXAMPLES:
        for ref, spec in _pictures(example).items():
            sample = str(spec.get("sample") or "") if isinstance(spec, dict) else ""
            present = bool(sample) and (images.SAMPLES_DIR / ("%s.png" % sample)).is_file()
            rows.append([example["id"], ref, sample, images.SAMPLES.get(sample, ""), present])
    _table_or(args, ["example", "picture", "sample", "description", "file"], rows, "no example uses a picture")
    return 0


PACK = kit.define_pack({
    "id": "cli-examples",
    "surface": "python.cli",
    "title": "Built-in example commands",
    "about": "Offline commands for the built-in examples: list them, show and outline the authored request (state, "
             "questions and picture names; expectations only with --expectations), export one as a request JSON file, "
             "search their descriptions and questions, and list the sample pictures they use.",
    "features": [
        {"id": "list", "kind": "cli", "command": ["examples", "list"], "configure": _configure_list, "run": run_list,
         "title": "List the built-in examples with their question counts, question types, state kind and pictures",
         "options": [{"id": "type", "title": "--type keeps examples that ask a question of one type"},
                     {"id": "pictures", "title": "--pictures keeps examples that send a picture"},
                     {"id": "sort", "title": "--sort orders examples by id, title or most questions"},
                     dict(FORMAT)]},
        {"id": "show", "kind": "cli", "command": ["examples", "show"], "configure": _configure_show, "run": run_show,
         "title": "Print an example's authored request as JSON: state, questions and picture names, without expectations",
         "options": [{"id": "expectations", "title": "--expectations adds the example's authored expectations"},
                     {"id": "part", "title": "--part state|questions|images prints one part of the request"}]},
        {"id": "outline", "kind": "cli", "command": ["examples", "outline"], "configure": _configure_outline, "run": run_outline,
         "title": "Outline an example's questions: position, id, type, criteria count and instruction words",
         "options": [{"id": "all", "title": "--all outlines every example's questions in one table"},
                     {"id": "type", "title": "--type keeps only questions of one type"},
                     {"id": "criteria", "title": "--criteria lists every criterion key with its word count"},
                     dict(FORMAT)]},
        {"id": "export", "kind": "cli", "command": ["examples", "export"], "configure": _configure_export, "run": run_export,
         "title": "Export an example as a request JSON file named with --out (state, questions, picture references)",
         "options": [{"id": "expectations", "title": "--expectations adds the example's authored expectations to the file"},
                     {"id": "questions_only", "title": "--questions-only writes only the questions object"},
                     {"id": "force", "title": "--force replaces an existing file"}]},
        {"id": "search", "kind": "cli", "command": ["examples", "search"], "configure": _configure_search, "run": run_search,
         "title": "Search the examples' titles, descriptions and questions, never their state or expectations",
         "options": [{"id": "where", "title": "--in title|description|questions looks in one part"},
                     {"id": "regex", "title": "--regex treats the text as a regular expression"},
                     dict(FORMAT)]},
        {"id": "pictures", "kind": "cli", "command": ["examples", "pictures"], "configure": _configure_pictures, "run": run_pictures,
         "title": "List the sample pictures examples send, with each sample's description and whether its file is present",
         "options": [dict(FORMAT)]},
    ],
})
