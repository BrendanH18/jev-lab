"""Offline views and exports of the gate a saved check holds (`lab.py gates ...`).

A check saved with a dataset (jev/checks.py) gates questions at thresholds, may add consistency rules, answer-set cuts
and slice targets, and exports as a Python or JavaScript module through jev.gate. These commands show that gate as its
exported decide() applies it, list its rules and the questions it reads or ignores, count the tuning rows behind each
slice target, route one hand-typed set of signals and answers, find checks that read a question, compare two checks'
gates, and write the exported module to a file the user names.

Nothing here runs a gate or calls the model. Held-out rows are never read, and no label value is printed: slice targets
show only how many tuning rows carry labels.
"""

from __future__ import annotations

import json
from math import isfinite
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from jev import checks, config, decisions, gate, rules as rulebook, slices, workbench
from jev.lab import kit

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
LANGUAGES = ("python", "javascript")
ROLES = ("gated", "rule", "shortlist")
LABEL_TYPES = ("choice", "noul", "score")
SIGNAL_READ = {
    "confidence": {"noul": "|2p - 1|", "choice": "confidence", "score": "confidence"},
    "top_probability": {"noul": "max(p, 1 - p)", "choice": "probability of the chosen option",
                        "score": "probability of the likeliest level"},
}
EPS = 1e-9  # as the exported gate: a signal equal to its threshold clears it


# ---------- reading a saved check ----------


def _load(dataset_id: str) -> Tuple[dict, dict]:
    """(dataset, validated check). A dataset without a check, or with one that no longer fits, exits 2."""
    dataset = workbench.load_dataset(dataset_id)
    if not isinstance(dataset.get("check"), dict):
        raise kit.CliError("dataset %r has no check: save one from the Workbench's Policy panel" % dataset_id)
    return dataset, checks.validate_check(dataset["check"], dataset.get("questions"))


def _questions(dataset: dict) -> Dict[str, dict]:
    raw = dataset.get("questions")
    return {qid: q for qid, q in raw.items() if isinstance(q, dict)} if isinstance(raw, dict) else {}


def _rules(dataset: dict, check: dict) -> List[dict]:
    """The check's rules as the exported module holds them: {"rule", "if", "then"}."""
    return gate._rules(check.get("rules"), _questions(dataset))


def _reads(rule: dict) -> List[str]:
    return list(dict.fromkeys(condition[0] for condition in rule["if"] + rule["then"]))


def _provenance(dataset: dict, check: dict, model: Optional[str] = None) -> dict:
    return gate.provenance(dataset.get("questions"), check["gates"], check["signal"], model or check["model"],
                           check.get("rules"), check.get("answer_sets"))


def _roles(qid: str, check: dict, rules: List[dict]) -> List[str]:
    out = []
    if qid in check["gates"]:
        out.append("gated")
    if any(qid in _reads(rule) for rule in rules):
        out.append("rule")
    if qid in (check.get("answer_sets") or {}):
        out.append("shortlist")
    return out


def _cut(check: dict, qid: str) -> Optional[float]:
    return ((check.get("answer_sets") or {}).get(qid) or {}).get("cut")


def _rule_count(qid: str, rules: List[dict]) -> int:
    return sum(qid in _reads(rule) for rule in rules)


def _table_or(args: Any, columns: List[str], rows: List[list], empty: str) -> None:
    if not rows and getattr(args, "format", "table") == "table":
        print(empty)
    else:
        kit.emit(args, columns, rows)


def _pair(text: str, flag: str) -> Tuple[str, str]:
    if "=" not in text:
        raise kit.CliError("%s takes ID=VALUE, not %r" % (flag, text))
    name, value = text.split("=", 1)
    return name.strip(), value.strip()


def _dataset_argument(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset that holds a check")


# ---------- gates show ----------


def _configure_show(parser: Any) -> None:
    _dataset_argument(parser)
    parser.add_argument("--json", action="store_true", help="print the whole gate configuration as JSON")
    kit.add_format(parser)


def run_show(args: Any) -> int:
    dataset, check = _load(args.dataset)
    questions, rules = _questions(dataset), _rules(dataset, check)
    provenance = _provenance(dataset, check)
    if args.json:
        print(json.dumps({"dataset": dataset["id"], "model": check["model"], "signal": check["signal"], "thresholds": check["gates"],
                          "types": {qid: q.get("type") for qid, q in questions.items()}, "rules": rules,
                          "answer_sets": check.get("answer_sets") or {}, "slice_targets": check.get("slice_targets") or [],
                          "provenance": provenance}, indent=1, ensure_ascii=False))
        return 0
    reads = SIGNAL_READ[check["signal"]]
    rows = []
    for qid, threshold in check["gates"].items():
        qtype = questions[qid].get("type")
        rows.append([qid, qtype, threshold, reads[qtype], _cut(check, qid), _rule_count(qid, rules)])
    for qid in check.get("answer_sets") or {}:
        if qid not in check["gates"]:
            rows.append([qid, questions[qid].get("type"), None, "", _cut(check, qid), _rule_count(qid, rules)])
    if args.format == "table":
        print("gate of %s (%s)" % (dataset.get("name") or dataset["id"], dataset["id"]))
        print("model %s, signal %s, tuned on %s" % (check["model"], check["signal"], check.get("tuned_on") or "(not recorded)"))
        print("provenance fingerprint %s" % provenance["fingerprint"][:16])
        print()
    kit.emit(args, ["question", "type", "threshold", "signal read", "shortlist cut", "rules"], rows)
    return 0


# ---------- gates rules ----------


def _configure_rules(parser: Any) -> None:
    _dataset_argument(parser)
    parser.add_argument("--question", metavar="ID", help="only rules that read this question")
    kit.add_format(parser)


def run_rules(args: Any) -> int:
    dataset, check = _load(args.dataset)
    rows = []
    for number, rule in enumerate(_rules(dataset, check), 1):
        reads = _reads(rule)
        if args.question and args.question not in reads:
            continue
        rows.append([number, rule["rule"], ", ".join(reads), ", ".join(qid for qid in reads if qid not in check["gates"])])
    empty = "no rule reads %s" % args.question if args.question else "the check has no rules"
    _table_or(args, ["#", "rule", "reads", "not gated"], rows, empty)
    return 0


# ---------- gates slices ----------


def _configure_slices(parser: Any) -> None:
    _dataset_argument(parser)
    parser.add_argument("--missing", action="store_true",
                        help="only slice targets with no tuning row labeled for every gated question; exit 1 if any")
    kit.add_format(parser)


def _labeled_for(row: Any, gates: Dict[str, float]) -> bool:
    labels = row.get(workbench.LABEL_KEY) if isinstance(row, dict) else None
    return isinstance(labels, dict) and all(labels.get(qid) not in (None, "") for qid in gates)  # as Policy counts a label


def run_slices(args: Any) -> int:
    dataset, check = _load(args.dataset)
    tuning = workbench.tuning_rows(dataset)
    rows = []
    for target in check.get("slice_targets") or []:
        matched = [row for row in tuning if slices._value(row, target["field"]) == target["value"]]
        labeled = sum(_labeled_for(row, check["gates"]) for row in matched)
        if args.missing and labeled:
            continue
        rows.append([target["field"], target["value"], target["min_accuracy"], target["min_coverage"], len(matched), labeled])
    if args.missing:
        empty = "every slice target has tuning rows labeled for every gated question"
    else:
        empty = "the check has no slice targets"
    _table_or(args, ["field", "value", "min accuracy", "min coverage", "tuning rows", "labeled for gates"], rows, empty)
    return 1 if args.missing and rows else 0


# ---------- gates export ----------


def _configure_export(parser: Any) -> None:
    _dataset_argument(parser)
    parser.add_argument("--out", required=True, metavar="PATH", help="the gate module file to write")
    parser.add_argument("--language", choices=LANGUAGES, default="python", help="python (default) or javascript")
    parser.add_argument("--force", action="store_true", help="replace the file if it exists")


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


def run_export(args: Any) -> int:
    target = _out_path(args.out, args.force)
    _load(args.dataset)
    source = gate.export_check(args.dataset)[args.language]
    target.write_bytes(source.encode("utf-8"))
    print("wrote the %s gate of %s to %s" % (args.language, args.dataset, args.out))
    return 0


# ---------- gates diff ----------


def _configure_diff(parser: Any) -> None:
    parser.add_argument("a", help="the first dataset id")
    parser.add_argument("b", help="the second dataset id")
    parser.add_argument("--ignore-model", action="store_true", help="leave the model out, as when a check moves to a new version")
    kit.add_format(parser)


def _target_text(target: Optional[dict]) -> Optional[str]:
    if target is None:
        return None
    return "accuracy %s, coverage %s" % (kit.cell_text(target["min_accuracy"]), kit.cell_text(target["min_coverage"]))


def _target_key(target: Optional[dict]) -> Optional[tuple]:
    return None if target is None else (target["min_accuracy"], target["min_coverage"])


def run_diff(args: Any) -> int:
    (da, ca), (db, cb) = _load(args.a), _load(args.b)
    rows: List[list] = []
    if not args.ignore_model and ca["model"] != cb["model"]:
        rows.append(["model", "", ca["model"], cb["model"]])
    if ca["signal"] != cb["signal"]:
        rows.append(["signal", "", ca["signal"], cb["signal"]])
    for label, key in (("min accuracy", "min_accuracy"), ("min coverage", "min_coverage"), ("bound", "bound")):
        if ca[key] != cb[key]:
            rows.append(["target", label, ca[key], cb[key]])
    for qid in dict.fromkeys(list(ca["gates"]) + list(cb["gates"])):
        if ca["gates"].get(qid) != cb["gates"].get(qid):
            rows.append(["threshold", qid, ca["gates"].get(qid), cb["gates"].get(qid)])
    ra, rb = [rule["rule"] for rule in _rules(da, ca)], [rule["rule"] for rule in _rules(db, cb)]
    rows += [["rule", text, "yes", None] for text in ra if text not in rb]
    rows += [["rule", text, None, "yes"] for text in rb if text not in ra]
    sa, sb = ca.get("answer_sets") or {}, cb.get("answer_sets") or {}
    for qid in dict.fromkeys(list(sa) + list(sb)):
        for field in ("cut", "coverage"):
            va, vb = (sa.get(qid) or {}).get(field), (sb.get(qid) or {}).get(field)
            if va != vb:
                rows.append(["shortlist %s" % field, qid, va, vb])
    ta = {(t["field"], t["value"]): t for t in ca.get("slice_targets") or []}
    tb = {(t["field"], t["value"]): t for t in cb.get("slice_targets") or []}
    for key in dict.fromkeys(list(ta) + list(tb)):
        if _target_key(ta.get(key)) != _target_key(tb.get(key)):
            rows.append(["slice target", "%s = %s" % key, _target_text(ta.get(key)), _target_text(tb.get(key))])
    pa = _provenance(da, ca)
    pb = _provenance(db, cb, ca["model"] if args.ignore_model else None)
    if pa["fingerprint"] != pb["fingerprint"]:
        rows.append(["fingerprint", "", pa["fingerprint"][:16], pb["fingerprint"][:16]])
    _table_or(args, ["part", "item", "A", "B"], rows, "same gate")
    return 1 if rows else 0


# ---------- gates questions ----------


def _configure_questions(parser: Any) -> None:
    _dataset_argument(parser)
    parser.add_argument("--ignored", action="store_true",
                        help="only Choice, Noul and Score questions no threshold, rule or shortlist reads; exit 1 if any")
    kit.add_format(parser)


def run_questions(args: Any) -> int:
    dataset, check = _load(args.dataset)
    rules = _rules(dataset, check)
    rows = []
    for qid, question in _questions(dataset).items():
        qtype = question.get("type")
        roles = _roles(qid, check, rules)
        use = ", ".join(roles) if roles else "output only" if qtype not in LABEL_TYPES else "ignored"
        if args.ignored and use != "ignored":
            continue
        rows.append([qid, qtype, check["gates"].get(qid), _rule_count(qid, rules), _cut(check, qid), use])
    empty = "the gate reads every Choice, Noul and Score question" if args.ignored else "the dataset has no questions"
    _table_or(args, ["question", "type", "threshold", "rules", "shortlist cut", "use"], rows, empty)
    return 1 if args.ignored and rows else 0


# ---------- gates route ----------


def _configure_route(parser: Any) -> None:
    _dataset_argument(parser)
    parser.add_argument("--signal", action="append", metavar="ID=NUMBER",
                        help="a gated question's signal, from 0 to 1 (repeat per question); a missing one holds its question")
    parser.add_argument("--answer", action="append", metavar="ID=VALUE",
                        help="a question's answer for the rules: an option, yes or no, or a level number (repeat per question)")
    parser.add_argument("--json", action="store_true", help="print the route, held questions and rules as decide() returns them")


def run_route(args: Any) -> int:
    dataset, check = _load(args.dataset)
    questions, gates = _questions(dataset), check["gates"]
    signals: Dict[str, float] = {}
    for item in args.signal or []:
        qid, text = _pair(item, "--signal")
        if qid not in gates:
            raise kit.CliError("%s is not gated; the gate reads %s" % (qid, ", ".join(gates)))
        try:
            value = float(text)
        except ValueError:
            raise kit.CliError("the signal for %s must be a number from 0 to 1, not %r" % (qid, text))
        if not isfinite(value) or not 0 <= value <= 1:
            raise kit.CliError("the signal for %s must be a number from 0 to 1, not %r" % (qid, text))
        signals[qid] = value
    shown: Dict[str, str] = {}
    for item in args.answer or []:
        qid, text = _pair(item, "--answer")
        question = questions.get(qid)
        if not isinstance(question, dict) or question.get("type") not in LABEL_TYPES:
            raise kit.CliError("%s is not a Choice, Noul or Score question of this dataset" % qid)
        ok, value = decisions.label(question, text)
        if not ok or value is None:
            raise kit.CliError("%r is not an answer to %s" % (text, qid))
        shown[qid] = ("yes" if value else "no") if isinstance(value, bool) else str(value)
    held = [qid for qid, threshold in gates.items() if qid not in signals or not signals[qid] + EPS >= threshold]
    broken = [rule["rule"] for rule in _rules(dataset, check) if rulebook.broken(rule, shown) is not False]
    route = "review" if held or broken else "auto"
    if args.json:
        print(json.dumps({"route": route, "held": held, "rules": broken}, ensure_ascii=False))
        return 0
    print("route: %s" % route)
    for qid in held:
        if qid in signals:
            print("held: %s (signal %s is below %s)" % (qid, kit.cell_text(signals[qid]), kit.cell_text(gates[qid])))
        else:
            print("held: %s (no signal given)" % qid)
    for text in broken:
        print("rule: %s" % text)
    return 0


# ---------- gates find ----------


def _configure_find(parser: Any) -> None:
    parser.add_argument("question", help="a question id")
    parser.add_argument("--role", choices=ROLES, help="only checks that read the question this way")
    kit.add_format(parser)


def run_find(args: Any) -> int:
    rows = []
    for summary in workbench.list_datasets():
        if not isinstance(summary.get("check"), dict):
            continue
        try:
            dataset, check = _load(summary["id"])
        except (kit.CliError, workbench.WorkbenchError):
            continue
        rules = _rules(dataset, check)
        roles = _roles(args.question, check, rules)
        if not roles or (args.role and args.role not in roles):
            continue
        rows.append([dataset["id"], ", ".join(roles), check["gates"].get(args.question), _cut(check, args.question),
                     _rule_count(args.question, rules)])
    _table_or(args, ["dataset", "role", "threshold", "shortlist cut", "rules"], rows, "no saved check reads %s" % args.question)
    return 0


PACK = kit.define_pack({
    "id": "cli-gates",
    "surface": "python.cli",
    "title": "Saved gate commands",
    "about": "Offline views and exports of the gate a saved check holds: thresholds with the signal each reads, rules, "
             "the questions it reads or ignores, slice targets with their labeled tuning rows, a hand-typed routing, "
             "checks that read a question, a diff of two checks' gates, and the exported module written to --out. "
             "Nothing runs a gate or calls the model.",
    "features": [
        {"id": "show", "kind": "cli", "command": ["gates", "show"], "configure": _configure_show, "run": run_show,
         "title": "Show a check's gate as decide() applies it: model, signal, provenance, and each threshold with the signal it reads",
         "options": [{"id": "json", "title": "--json prints the whole gate configuration as JSON: thresholds, types, rules, cuts, slice targets and provenance"},
                     dict(FORMAT, title="--format json|csv|markdown prints only the question rows, in another format")]},
        {"id": "rules", "kind": "cli", "command": ["gates", "rules"], "configure": _configure_rules, "run": run_rules,
         "title": "List a check's consistency rules with the questions each reads and the ones no threshold gates",
         "options": [{"id": "question", "title": "--question ID keeps the rules that read one question"}, dict(FORMAT)]},
        {"id": "slices", "kind": "cli", "command": ["gates", "slices"], "configure": _configure_slices, "run": run_slices,
         "title": "List a check's slice targets with how many tuning rows match each and are labeled for every gate",
         "options": [{"id": "missing", "title": "--missing keeps targets no labeled tuning row can evaluate and exits 1 if any"},
                     dict(FORMAT)]},
        {"id": "export", "kind": "cli", "command": ["gates", "export"], "configure": _configure_export, "run": run_export,
         "title": "Write a check's exported gate module to --out, outside the Workbench data directory, without running it",
         "options": [{"id": "language", "title": "--language javascript writes the gate.mjs module instead of gate.py"},
                     {"id": "force", "title": "--force replaces an existing --out file"}]},
        {"id": "diff", "kind": "cli", "command": ["gates", "diff"], "configure": _configure_diff, "run": run_diff,
         "title": "Diff two checks' gates: model, signal, targets, thresholds, rules, shortlist cuts, slice targets and fingerprint; exit 1 if any differ",
         "options": [{"id": "ignore_model", "title": "--ignore-model compares everything but the model"}, dict(FORMAT)]},
        {"id": "questions", "kind": "cli", "command": ["gates", "questions"], "configure": _configure_questions, "run": run_questions,
         "title": "List every dataset question with how the gate reads it: threshold, rules, shortlist, output only, or ignored",
         "options": [{"id": "ignored", "title": "--ignored keeps the questions the gate never reads and exits 1 if any"}, dict(FORMAT)]},
        {"id": "route", "kind": "cli", "command": ["gates", "route"], "configure": _configure_route, "run": run_route,
         "title": "Route one hand-typed set of signals offline: the route, the held questions and why",
         "options": [{"id": "answer", "title": "--answer ID=VALUE checks the rules against typed answers"},
                     {"id": "json", "title": "--json prints the route, held questions and rules as decide() returns them"}]},
        {"id": "find", "kind": "cli", "command": ["gates", "find"], "configure": _configure_find, "run": run_find,
         "title": "Find the saved checks whose gate reads a question, and how: threshold, rules or shortlist",
         "options": [{"id": "role", "title": "--role gated|rule|shortlist keeps checks that read it one way"}, dict(FORMAT)]},
    ],
})
