"""Offline views of the checks saved with Workbench datasets (`lab.py checks ...`).

A check (jev/checks.py) is configuration: the gated questions and their thresholds, the signal and bound, the model it
asks and the version its thresholds were tuned on, the targets a person chose, and optional rules, answer-set cuts and
slice targets. These commands list the saved checks, validate them against their datasets' current questions, compare
their targets, thresholds and models, export one as JSON, say whether one would fit another dataset's questions, and
find checks whose dataset was saved again after the check.

Nothing here runs a check or calls the model, and nothing prints a measured result: a check holds none. Held-out rows
are never read.
"""

from __future__ import annotations

import json
import statistics
from typing import Any, Dict, List, Optional, Tuple

from jev import checks, rules as rulebook, slices, workbench
from jev.lab import kit
from jev.lab.packs import cli_gates

FORMAT = {"id": "format", "title": "--format table|json|csv|markdown prints the rows in another format"}
SORTS = ("dataset", "saved", "gates", "accuracy")
SIGNALS = ("confidence", "top_probability")
BOUNDS = ("estimate", "lower")
SPEC_FIELDS = ("gates", "signal", "bound", "model", "tuned_on", "min_accuracy", "min_coverage", "rules", "answer_sets",
               "slice_targets")


# ---------- reading saved checks ----------


def _saved() -> List[Tuple[dict, dict]]:
    """(dataset, check as saved) for every saved dataset that holds a check, in dataset id order."""
    out = []
    for summary in workbench.list_datasets():
        if isinstance(summary.get("check"), dict):
            dataset = workbench.load_dataset(summary["id"])
            out.append((dataset, dataset["check"]))
    return out


def _count(value: Any) -> int:
    return len(value) if isinstance(value, (dict, list)) else 0


def _rule_count(check: dict) -> int:
    try:
        return len(rulebook.parse(check.get("rules")))
    except ValueError:
        return 0


def _pinned(model: Any) -> bool:
    return isinstance(model, str) and checks.is_versioned(model)


def _number(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _table_or(args: Any, columns: List[str], rows: List[list], empty: str) -> None:
    cli_gates._table_or(args, columns, rows, empty)


# ---------- checks list ----------


def _configure_list(parser: Any) -> None:
    parser.add_argument("--model", metavar="MODEL", help="only checks that ask this model id or alias")
    parser.add_argument("--pinned", choices=("yes", "no"), help="only checks that ask a versioned id (yes) or an alias (no)")
    parser.add_argument("--sort", choices=SORTS, default="dataset", help="order by dataset id (default), save time, gate count or min accuracy")
    parser.add_argument("--reverse", action="store_true", help="reverse the order")
    kit.add_format(parser)


def run_list(args: Any) -> int:
    rows = []
    for dataset, check in _saved():
        model = check.get("model")
        if args.model and model != args.model:
            continue
        if args.pinned and _pinned(model) != (args.pinned == "yes"):
            continue
        rows.append([dataset["id"], model, check.get("tuned_on"), check.get("signal", "confidence"), _count(check.get("gates")),
                     _rule_count(check), _count(check.get("answer_sets")), _count(check.get("slice_targets")),
                     _number(check.get("min_accuracy")), _number(check.get("min_coverage")), check.get("saved_at")])
    keys = {"dataset": lambda row: row[0], "saved": lambda row: row[10] or "", "gates": lambda row: (row[4], row[0]),
            "accuracy": lambda row: (row[8] if row[8] is not None else -1.0, row[0])}
    rows.sort(key=keys[args.sort], reverse=args.reverse)
    _table_or(args, ["dataset", "model", "tuned on", "signal", "gates", "rules", "cuts", "slices", "min accuracy",
                     "min coverage", "saved"], rows, "no saved dataset holds a check")
    return 0


# ---------- checks validate ----------


def _configure_validate(parser: Any) -> None:
    parser.add_argument("--dataset", metavar="ID", help="only this dataset's check")
    parser.add_argument("--strict", action="store_true", help="exit 1 on notes too, not only on problems")
    kit.add_format(parser)


def _notes(dataset: dict, check: dict) -> List[str]:
    out = []
    model = str(check.get("model") or "")
    if model and not _pinned(model):
        out.append("asks %s, an alias that moves when a new version ships; save the check again from a Bulk run to pin it"
                   % model)
    if not check.get("tuned_on"):
        out.append("records no tuned-on version: it was saved before checks recorded the version that answered the tuning run")
    elif _pinned(model) and model != check["tuned_on"]:
        out.append("asks %s but was tuned on answers from %s" % (model, check["tuned_on"]))
    tuning = workbench.tuning_rows(dataset)
    for target in check.get("slice_targets") or []:
        if isinstance(target, dict) and not any(slices._value(row, str(target.get("field"))) == target.get("value") for row in tuning):
            out.append("slice target %s = %s matches no tuning row" % (target.get("field"), target.get("value")))
    return out


def run_validate(args: Any) -> int:
    pairs = [(workbench.load_dataset(args.dataset), None)] if args.dataset else _saved()
    rows = []
    for dataset, _check in pairs:
        check = dataset.get("check")
        if not isinstance(check, dict):
            raise kit.CliError("dataset %r has no check" % dataset["id"])
        try:
            checks.validate_check(check, dataset.get("questions"))
        except workbench.WorkbenchError as err:
            rows.append([dataset["id"], "problem", str(err)])
        rows += [[dataset["id"], "note", note] for note in _notes(dataset, check)]
    problems = sum(row[1] == "problem" for row in rows)
    _table_or(args, ["dataset", "level", "message"], rows, "every saved check is valid")
    return 1 if problems or (args.strict and rows) else 0


# ---------- checks targets ----------


def _configure_targets(parser: Any) -> None:
    parser.add_argument("--below", type=float, metavar="X", help="only checks whose min accuracy is below X")
    parser.add_argument("--bound", choices=BOUNDS, help="only checks that hold the measured accuracy (estimate) or its lower bound to the target")
    kit.add_format(parser)


def run_targets(args: Any) -> int:
    rows = []
    for dataset, check in _saved():
        accuracy = _number(check.get("min_accuracy"))
        if args.below is not None and not (accuracy is not None and accuracy < args.below):
            continue
        bound = check.get("bound", "estimate")
        if args.bound and bound != args.bound:
            continue
        targets = [t for t in check.get("slice_targets") or [] if isinstance(t, dict)]
        strictest = max((_number(t.get("min_accuracy")) or 0.0 for t in targets), default=None)
        rows.append([dataset["id"], accuracy, _number(check.get("min_coverage")), bound, len(targets), strictest])
    _table_or(args, ["dataset", "min accuracy", "min coverage", "bound", "slice targets", "strictest slice accuracy"], rows,
              "no saved check matches")
    return 0


# ---------- checks thresholds ----------


def _configure_thresholds(parser: Any) -> None:
    parser.add_argument("--question", metavar="ID", help="one row per check that gates this question")
    parser.add_argument("--signal", choices=SIGNALS, help="only checks that read this signal")
    kit.add_format(parser)


def run_thresholds(args: Any) -> int:
    found: Dict[str, List[Tuple[str, str, float, str, Any]]] = {}
    for dataset, check in _saved():
        signal = check.get("signal", "confidence")
        if args.signal and signal != args.signal:
            continue
        questions = dataset.get("questions") if isinstance(dataset.get("questions"), dict) else {}
        for qid, threshold in (check.get("gates") or {}).items():
            if _number(threshold) is None:
                continue
            qtype = (questions.get(qid) or {}).get("type") if isinstance(questions.get(qid), dict) else None
            found.setdefault(qid, []).append((dataset["id"], qtype, float(threshold), signal, check.get("model")))
    if args.question:
        rows = [list(item) for item in found.get(args.question, [])]
        _table_or(args, ["dataset", "type", "threshold", "signal", "model"], rows, "no saved check gates %s" % args.question)
        return 0
    rows = []
    for qid in sorted(found):
        values = [item[2] for item in found[qid]]
        rows.append([qid, len(values), min(values), statistics.median(values), max(values),
                     ", ".join(sorted({item[3] for item in found[qid]}))])
    _table_or(args, ["question", "checks", "lowest", "median", "highest", "signals"], rows, "no saved check gates a question")
    return 0


# ---------- checks export ----------


def _configure_export(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset that holds a check")
    parser.add_argument("--out", metavar="PATH", help="write the JSON to this file, outside the Workbench data directory")
    parser.add_argument("--force", action="store_true", help="replace the --out file if it exists")
    parser.add_argument("--no-time", action="store_true", help="leave out saved_at, so the file is only the configuration")


def run_export(args: Any) -> int:
    dataset, check = cli_gates._load(args.dataset)
    saved = dataset["check"]
    spec = {key: check[key] for key in SPEC_FIELDS if key in check}
    if not args.no_time and saved.get("saved_at"):
        spec["saved_at"] = saved["saved_at"]
    text = json.dumps(spec, indent=1, ensure_ascii=False) + "\n"
    if args.out:
        target = cli_gates._out_path(args.out, args.force)
        target.write_bytes(text.encode("utf-8"))
        print("wrote the check of %s to %s" % (dataset["id"], args.out))
    else:
        print(text, end="")
    return 0


# ---------- checks fits ----------


def _configure_fits(parser: Any) -> None:
    parser.add_argument("dataset", help="the id of a saved dataset that holds a check")
    parser.add_argument("target", nargs="?", help="the id of the dataset the check would move to")
    parser.add_argument("--questions", metavar="FILE", help="check against a question file instead of a saved dataset")
    parser.add_argument("--strict", action="store_true", help="exit 1 on notes (reworded questions, unseen slices) too")


def _wording(question: Any) -> str:
    if not isinstance(question, dict):
        return ""
    criteria = question.get("criteria")
    if question.get("type") == "choice" and isinstance(criteria, dict):
        criteria = [list(pair) for pair in criteria.items()]  # a Choice's option order is configuration: keep it
    return json.dumps({"type": question.get("type"), "instructions": question.get("instructions"), "criteria": criteria},
                      sort_keys=True, ensure_ascii=False)


def _question_file(path: str) -> Dict[str, dict]:
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError) as err:
        raise kit.CliError("cannot read %s: %s" % (path, err))
    if isinstance(raw, dict) and isinstance(raw.get("questions"), dict):
        raw = raw["questions"]
    try:
        return workbench.bulk_questions(raw)
    except workbench.WorkbenchError as err:
        raise kit.CliError("%s: %s" % (path, err))


def run_fits(args: Any) -> int:
    if bool(args.target) == bool(args.questions):
        raise kit.CliError("name a target dataset or --questions FILE, not both")
    source = workbench.load_dataset(args.dataset)
    check = source.get("check")
    if not isinstance(check, dict):
        raise kit.CliError("dataset %r has no check" % args.dataset)
    if args.questions:
        questions, tuning, label = _question_file(args.questions), None, args.questions
    else:
        target = workbench.load_dataset(args.target)
        questions, tuning, label = target.get("questions") or {}, workbench.tuning_rows(target), target["id"]
    try:
        fitted = checks.validate_check(check, questions)
    except workbench.WorkbenchError as err:
        print("does not fit %s: %s" % (label, err))
        return 1
    notes = []
    before = source.get("questions") or {}
    for qid in list(fitted["gates"]) + [q for q in fitted.get("answer_sets") or {} if q not in fitted["gates"]]:
        if _wording(before.get(qid)) != _wording(questions.get(qid)):
            notes.append("%s is worded differently there, so its threshold may not carry over" % qid)
    if tuning is not None:
        for target_spec in fitted.get("slice_targets") or []:
            if not any(slices._value(row, target_spec["field"]) == target_spec["value"] for row in tuning):
                notes.append("slice target %s = %s matches no tuning row there" % (target_spec["field"], target_spec["value"]))
    print("fits %s" % label)
    for note in notes:
        print("note: %s" % note)
    return 1 if args.strict and notes else 0


# ---------- checks models ----------


def _configure_models(parser: Any) -> None:
    parser.add_argument("--aliases", action="store_true", help="only models that are aliases; exit 1 if any check asks one")
    kit.add_format(parser)


def run_models(args: Any) -> int:
    groups: Dict[str, List[dict]] = {}
    for dataset, check in _saved():
        groups.setdefault(str(check.get("model") or ""), []).append({"id": dataset["id"], "tuned_on": check.get("tuned_on")})
    rows = []
    for model in sorted(groups):
        if args.aliases and _pinned(model):
            continue
        tuned = sorted({item["tuned_on"] for item in groups[model] if item["tuned_on"]})
        rows.append([model, _pinned(model), len(groups[model]), ", ".join(tuned), ", ".join(item["id"] for item in groups[model])])
    _table_or(args, ["model", "pinned", "checks", "tuned on", "datasets"], rows,
              "every saved check asks a versioned model" if args.aliases else "no saved dataset holds a check")
    return 1 if args.aliases and rows else 0


# ---------- checks stale ----------


def _configure_stale(parser: Any) -> None:
    kit.add_format(parser)


def run_stale(args: Any) -> int:
    rows = []
    for dataset, check in _saved():
        saved, changed = check.get("saved_at"), dataset.get("saved_at")
        if isinstance(saved, str) and isinstance(changed, str) and changed > saved:
            rows.append([dataset["id"], saved, changed])
    _table_or(args, ["dataset", "check saved", "dataset saved"], rows,
              "every check was saved after its dataset's rows")
    return 1 if rows else 0


# ---------- checks slices, checks cuts ----------


def _configure_slices(parser: Any) -> None:
    parser.add_argument("--field", metavar="FIELD", help="only slice targets on this input field")
    kit.add_format(parser)


def run_slices(args: Any) -> int:
    rows = []
    for dataset, check in _saved():
        for target in check.get("slice_targets") or []:
            if not isinstance(target, dict) or (args.field and target.get("field") != args.field):
                continue
            rows.append([dataset["id"], target.get("field"), slices._shown(str(target.get("value"))), _number(target.get("min_accuracy")),
                         _number(target.get("min_coverage"))])
    _table_or(args, ["dataset", "field", "value", "min accuracy", "min coverage"], rows,
              "no saved check has slice targets%s" % (" on %s" % args.field if args.field else ""))
    return 0


def _configure_cuts(parser: Any) -> None:
    kit.add_format(parser)


def run_cuts(args: Any) -> int:
    rows = []
    for dataset, check in _saved():
        for qid, fitted in (check.get("answer_sets") or {}).items():
            if isinstance(fitted, dict):
                rows.append([dataset["id"], qid, _number(fitted.get("cut")), _number(fitted.get("coverage")),
                             qid in (check.get("gates") or {})])
    _table_or(args, ["dataset", "question", "cut", "coverage", "gated"], rows, "no saved check has answer-set cuts")
    return 0


PACK = kit.define_pack({
    "id": "cli-checks",
    "surface": "python.cli",
    "title": "Saved check commands",
    "about": "Offline `lab.py checks` commands over the checks saved with datasets: list them, validate them against "
             "their datasets' questions, compare targets, thresholds and models, export one as JSON, say whether one "
             "fits another dataset, and find checks whose dataset was saved again since. Configuration only: a check "
             "holds no measured results, and nothing runs it.",
    "features": [
        {"id": "list", "kind": "cli", "command": ["checks", "list"], "configure": _configure_list, "run": run_list,
         "title": "List every saved check: model, tuned-on version, signal, gate, rule, cut and slice counts, targets and save time",
         "options": [{"id": "model", "title": "--model MODEL keeps the checks that ask one model id or alias"},
                     {"id": "pinned", "title": "--pinned yes|no keeps the checks that ask a versioned id, or an alias"},
                     {"id": "sort", "title": "--sort dataset|saved|gates|accuracy orders the checks"},
                     {"id": "reverse", "title": "--reverse flips the order"}, dict(FORMAT)]},
        {"id": "validate", "kind": "cli", "command": ["checks", "validate"], "configure": _configure_validate, "run": run_validate,
         "title": "Validate every saved check against its dataset's questions, with notes on aliases, missing tuned-on versions and unmatched slices; exit 1 on a problem",
         "options": [{"id": "dataset", "title": "--dataset ID validates one dataset's check"},
                     {"id": "strict", "title": "--strict exits 1 on notes as well as problems"}, dict(FORMAT)]},
        {"id": "targets", "kind": "cli", "command": ["checks", "targets"], "configure": _configure_targets, "run": run_targets,
         "title": "Compare the checks' targets: min accuracy, min coverage, bound, slice target count and the strictest slice accuracy",
         "options": [{"id": "below", "title": "--below X keeps checks whose min accuracy is under X"},
                     {"id": "bound", "title": "--bound estimate|lower keeps checks that hold the estimate or its lower bound to the target"},
                     dict(FORMAT)]},
        {"id": "thresholds", "kind": "cli", "command": ["checks", "thresholds"], "configure": _configure_thresholds, "run": run_thresholds,
         "title": "Summarize each gated question's thresholds across checks: how many gate it, lowest, median and highest",
         "options": [{"id": "question", "title": "--question ID lists each check's threshold for one question with its type, signal and model"},
                     {"id": "signal", "title": "--signal confidence|top_probability keeps checks that read one signal"}, dict(FORMAT)]},
        {"id": "export", "kind": "cli", "command": ["checks", "export"], "configure": _configure_export, "run": run_export,
         "title": "Print a check's saved configuration as JSON: gates, signal, bound, model, tuned-on version, targets, rules, cuts and slices",
         "options": [{"id": "out", "title": "--out PATH writes the JSON to a file outside the Workbench data directory"},
                     {"id": "force", "title": "--force replaces an existing --out file"},
                     {"id": "no_time", "title": "--no-time leaves out the save time, so the file is only configuration"}]},
        {"id": "fits", "kind": "cli", "command": ["checks", "fits"], "configure": _configure_fits, "run": run_fits,
         "title": "Say whether a check would fit another dataset's questions, noting reworded gated questions and unmatched slices; exit 1 if not",
         "options": [{"id": "questions", "title": "--questions FILE checks against a question file instead of a saved dataset"},
                     {"id": "strict", "title": "--strict exits 1 on notes as well"}]},
        {"id": "models", "kind": "cli", "command": ["checks", "models"], "configure": _configure_models, "run": run_models,
         "title": "Group the saved checks by the model they ask: pinned or alias, count, tuned-on versions and datasets",
         "options": [{"id": "aliases", "title": "--aliases keeps alias models and exits 1 if any check asks one"}, dict(FORMAT)]},
        {"id": "stale", "kind": "cli", "command": ["checks", "stale"], "configure": _configure_stale, "run": run_stale,
         "title": "Find checks whose dataset was saved again after the check, so rows or labels may have changed; exit 1 if any",
         "options": [dict(FORMAT)]},
        {"id": "slices", "kind": "cli", "command": ["checks", "slices"], "configure": _configure_slices, "run": run_slices,
         "title": "List the slice targets of every saved check: dataset, field, value and the accuracy and coverage each requires",
         "options": [{"id": "field", "title": "--field FIELD keeps the targets on one input field"}, dict(FORMAT)]},
        {"id": "cuts", "kind": "cli", "command": ["checks", "cuts"], "configure": _configure_cuts, "run": run_cuts,
         "title": "List the answer-set cuts saved with every check: question, cut, coverage and whether a threshold also gates it",
         "options": [dict(FORMAT)]},
    ],
})
