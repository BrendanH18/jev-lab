"""Dataset health: whether the labels can support the evaluations the Workbench runs on them, reported without values.

Calibrate, Recalibrate, answer sets, cross-validation, the held-out test split, By slice and slice targets, and
Policy gates each need enough labeled rows of the right kind. These checks count what the rows hold (valid labels per
question, per answer on tuning rows, per slice value, per side of the split) against those needs, and check that the
pictures labeled rows name can be sent. Findings carry row numbers, question ids, input field names, counts and
shares only: never a label value, never an input value (slice values included), never a picture name. Answer
distributions are read from tuning rows only; held-out rows are counted, never described by their answers.

The health-labels pack already covers too few tuning labels for cross-validation, labels only on held-out rows, one
dominant or rare answer, unused Choice options, gaps between labeled Score levels and the overall split shares;
nothing here repeats them.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from jev import answersets, calibrate, decisions, health, holdout, images, lint, recalibrate, slices, testsplit, workbench
from jev.lab import kit
from jev.workbench import WorkbenchError

CV_MIN_ROWS = holdout.FOLDS * holdout.MIN_PER_FOLD  # valid labeled rows grouped cross-validation needs (10)
ANSWER_TYPES = ("noul", "choice", "score")
SINGLE_MIN = 5  # labels in a slice before "every label is the same answer" means something
SET_COVERAGES = (0.9, 0.95)  # answer-set coverages worth checking on unseen folds
FIRST_ROWS_MIN = 5  # labeled rows before "labels stop at row K" means something
UNLABELED_AFTER_MIN = 10


# ---------- shared reading ----------


def _entries(rows: List[Any]) -> List[dict]:
    """Per row: number, the row as By slice reads it, labels, held out or not, picture name and Review's identity."""
    out = []
    for number, row in enumerate(rows, 1):
        try:
            state, raw = workbench.split_labels(row, number)
        except WorkbenchError:
            state, raw = row, None
        clean = workbench.without_marks(state)
        out.append({"n": number, "row": {"text": clean} if isinstance(clean, str) else clean,
                    "labels": raw if isinstance(raw, dict) else {},
                    "test": isinstance(state, dict) and state.get(workbench.TEST_KEY) is True,
                    "picture": clean.get(workbench.IMAGE_KEY) if isinstance(clean, dict) else None,
                    "key": decisions._key(row)})
    return out


def _valid(question: dict, value: Any) -> Tuple[bool, Any]:
    if value is None:
        return False, None
    return health._label(question, value)


def _answers(entries: List[dict], qid: str, question: dict, test: bool = False) -> List[Tuple[dict, Any]]:
    """(entry, normal label) for the valid labels of one question on tuning rows (or on held-out rows)."""
    out = []
    for entry in entries:
        if entry["test"] == test:
            ok, value = _valid(question, entry["labels"].get(qid))
            if ok:
                out.append((entry, value))
    return out


def _labeled(entry: dict) -> bool:
    return any(value is not None for value in entry["labels"].values())


def _key(value: Any) -> str:
    return json.dumps(value, sort_keys=True)


def _numbers(pairs) -> List[int]:
    return [entry["n"] for entry, _value in pairs]


def _plural(count: int, word: str, many: Optional[str] = None) -> str:
    return "%d %s" % (count, word if count == 1 else (many or word + "s"))


def _names(names: List[str]) -> str:
    quoted = ["`%s`" % name for name in names]
    return quoted[0] if len(quoted) == 1 else ", ".join(quoted[:-1]) + " and " + quoted[-1]


def _slice_fields(entries: List[dict]) -> List[str]:
    """Input fields By slice offers for these rows (2 to slices.MAX_VALUES values) that group them: at most half as many
    values as rows, so a field that names each row on its own (a ticket id, the text itself) is not a slice."""
    return [option["name"] for option in slices.fields([{"row": entry["row"]} for entry in entries])
            if 2 * option["values"] <= len(entries)]


def _groups(entries: List[dict], field: str) -> Dict[str, List[dict]]:
    groups: Dict[str, List[dict]] = {}
    for entry in entries:
        groups.setdefault(slices._value(entry["row"], field), []).append(entry)
    return groups


# ---------- enough labels for each evaluation ----------


def recalibrate_too_few(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        answers = _answers(entries, qid, question) if question["type"] in ANSWER_TYPES else []
        if CV_MIN_ROWS <= len(answers) < recalibrate.MIN_ROWS:
            out.append({"rows": _numbers(answers), "message": "Question `%s` has %d valid tuning labels; Recalibrate fits "
                        "and checks probability maps from %d." % (qid, len(answers), recalibrate.MIN_ROWS)})
    return out


def answer_set_folds_short(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        answers = _answers(entries, qid, question) if question["type"] in ANSWER_TYPES else []
        keys = [entry["key"] for entry, _value in answers]
        if len(answers) < CV_MIN_ROWS or holdout.problem(keys, holdout.FOLDS):
            continue
        folds = holdout.assign(keys, list(range(len(keys))), holdout.FOLDS)
        smallest = len(keys) - max(folds.count(fold) for fold in range(holdout.FOLDS))
        short = [coverage for coverage in SET_COVERAGES if smallest < answersets.needed(coverage)]
        if short:
            shown = " or ".join("%d%% (%d rows)" % (round(100 * c), answersets.needed(c)) for c in short)
            out.append({"rows": _numbers(answers), "message": "Question `%s`: with %d valid tuning labels, the smallest "
                        "training side of a fold has %d rows, too few for an answer set to promise %s, so those folds "
                        "send every row to review." % (qid, len(answers), smallest, shown)})
    return out


def fewer_labels_than_answers(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] not in ("choice", "score"):
            continue
        answers = _answers(entries, qid, question)
        size = len(question["criteria"])
        if 1 <= len(answers) < size:
            what = "options" if question["type"] == "choice" else "levels"
            missing = size - len(answers)
            out.append({"rows": _numbers(answers), "message": "Question `%s` has %s for its %d %s, so at least %s never "
                        "tested." % (qid, _plural(len(answers), "valid tuning label"), size, what,
                                     _plural(missing, what[:-1] + " is", what + " are"))})
    return out


def score_ends_unlabeled(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] != "score" or len(question["criteria"]) < 3:
            continue
        answers = _answers(entries, qid, question)
        used = {value for _entry, value in answers}
        top = len(question["criteria"]) - 1
        ends = [level for level in (0, top) if level not in used]
        if len(answers) >= CV_MIN_ROWS and ends:
            shown = " and ".join("level %d" % level for level in ends)
            out.append({"rows": _numbers(answers), "message": "Question `%s`: %s %s no tuning label among %d, so no "
                        "threshold or slice check ever tests %s." % (qid, shown, "has" if len(ends) == 1 else "have",
                                                                     len(answers), "it" if len(ends) == 1 else "them")})
    return out


def answer_few_inputs(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        answers = _answers(entries, qid, question) if question["type"] in ANSWER_TYPES else []
        if len(answers) < CV_MIN_ROWS:
            continue
        by_answer: Dict[str, List[dict]] = {}
        for entry, value in answers:
            by_answer.setdefault(_key(value), []).append(entry)
        thin = [group for group in by_answer.values()
                if len(group) >= holdout.FOLDS and len({entry["key"] for entry in group}) < holdout.FOLDS]
        if thin:
            out.append({"rows": sorted(entry["n"] for group in thin for entry in group),
                        "message": "Question `%s`: %s at least %d tuning labels but from fewer than %d distinct inputs; "
                        "copies of an input share one fold, so cross-validation tests %s in few folds."
                        % (qid, _plural(len(thin), "answer has", "answers have"), holdout.FOLDS, holdout.FOLDS,
                           "it" if len(thin) == 1 else "them")})
    return out


def group_larger_than_fold(rows, questions):
    labeled = [entry for entry in _entries(rows) if not entry["test"] and _labeled(entry)]
    if len(labeled) < CV_MIN_ROWS:
        return []
    groups: Dict[str, List[int]] = {}
    for entry in labeled:
        groups.setdefault(entry["key"], []).append(entry["n"])
    return [{"rows": found, "message": "These %d labeled copies of one input are more than a fifth of the %d labeled tuning "
             "rows; cross-validation keeps copies in one fold, which then tests little else." % (len(found), len(labeled))}
            for found in groups.values() if len(found) >= 2 and len(found) * holdout.FOLDS > len(labeled)]


def gate_rows_too_few(rows, questions):
    entries = _entries(rows)
    ready = {qid: {entry["n"] for entry, _value in _answers(entries, qid, question)}
             for qid, question in questions.items() if question["type"] in ANSWER_TYPES}
    ready = {qid: found for qid, found in ready.items() if len(found) >= CV_MIN_ROWS}
    if len(ready) < 2:
        return []
    both = set.intersection(*ready.values())
    if len(both) >= CV_MIN_ROWS:
        return []
    return [{"rows": sorted(set.union(*ready.values())),
             "message": "Questions %s each have at least %d valid tuning labels, but %s labeled for all of them; a "
             "Policy gate over them scores only those rows." % (_names(list(ready)), CV_MIN_ROWS,
                                                                _plural(len(both), "tuning row is", "tuning rows are"))}]


def labeled_rows_missing_question_field(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        for path in lint._paths(question):
            found = []
            for entry in entries:
                if entry["labels"].get(qid) is None:
                    continue
                state = entry["row"]
                if isinstance(state, dict) and entry["picture"] is not None:
                    state = dict({k: v for k, v in state.items() if k != workbench.IMAGE_KEY}, **{workbench.PHOTO_FIELD: True})
                if not lint._resolve(state, path):
                    found.append(entry["n"])
            if found:
                out.append({"rows": found, "message": "Question `%s`: %s `%s`, so the model cannot see what %s "
                            "describe." % (qid, _plural(len(found), "labeled row lacks", "labeled rows lack"), path,
                                           "its label would" if len(found) == 1 else "their labels")})
                break
    return out


def labels_cover_only_first_rows(rows, questions):
    entries = _entries(rows)
    labeled = [entry["n"] for entry in entries if _labeled(entry)]
    after = len(entries) - len(labeled)
    if (len(labeled) < FIRST_ROWS_MIN or labeled != list(range(1, len(labeled) + 1))
            or after < max(UNLABELED_AFTER_MIN, len(labeled))):
        return []
    return [{"rows": list(range(len(labeled) + 1, len(entries) + 1)),
             "message": "Labels stop at row %d: the %d rows after it carry none. If rows are in arrival order, tuning "
             "sees only the earliest traffic; label a random sample across all rows." % (len(labeled), after)}]


# ---------- the held-out split ----------


def _split(entries: List[dict]) -> Tuple[List[dict], List[dict]]:
    return [entry for entry in entries if not entry["test"]], [entry for entry in entries if entry["test"]]


def held_out_question_too_few(rows, questions):
    entries = _entries(rows)
    tuning, held = _split(entries)
    # A split with fewer than 2 labeled held-out rows in all is health-labels' split_side_too_small; this is the
    # question that falls short inside a split that is otherwise big enough.
    if len([entry for entry in held if _labeled(entry)]) < testsplit.MIN_ROWS:
        return []
    out = []
    for qid, question in questions.items():
        count = len(_answers(entries, qid, question, test=True))
        if _answers(entries, qid, question) and count < testsplit.MIN_ROWS:
            out.append({"rows": [entry["n"] for entry in held], "message": "Question `%s` has %s on held-out rows; "
                        "scoring it on the test split needs at least %d." % (qid, _plural(count, "valid label"),
                                                                             testsplit.MIN_ROWS)})
    return out


def held_out_cannot_show_90(rows, questions):
    entries = _entries(rows)
    need = calibrate.rows_needed(calibrate.TARGETS[0])
    out = []
    for qid, question in questions.items():
        held = _answers(entries, qid, question, test=True)
        if testsplit.MIN_ROWS <= len(held) < need:
            out.append({"rows": _numbers(held), "message": "Question `%s` has %d valid held-out labels: even with every "
                        "automated one right, the test split cannot show %d%% accuracy at 95%% confidence (%d rows)."
                        % (qid, len(held), round(100 * calibrate.TARGETS[0]), need)})
    return out


def question_split_skewed(rows, questions):
    entries = _entries(rows)
    labeled = [entry for entry in entries if _labeled(entry)]
    held_rows = [entry for entry in labeled if entry["test"]]
    if not held_rows or not testsplit.MIN_SHARE <= len(held_rows) / len(labeled) <= testsplit.MAX_SHARE:
        return []
    out = []
    for qid, question in questions.items():
        held = _answers(entries, qid, question, test=True)
        total = len(held) + len(_answers(entries, qid, question))
        if total < CV_MIN_ROWS or len(held) < testsplit.MIN_ROWS:
            continue
        share = len(held) / total
        if not testsplit.MIN_SHARE <= share <= testsplit.MAX_SHARE:
            out.append({"rows": _numbers(held), "message": "Question `%s`: %d of its %d valid labels (%d%%) are on held-out "
                        "rows, outside %d%% to %d%%, though the split as a whole is inside it."
                        % (qid, len(held), total, round(100 * share), round(100 * testsplit.MIN_SHARE),
                           round(100 * testsplit.MAX_SHARE))})
    return out


# ---------- slices ----------


def slice_too_few_labels(rows, questions):
    entries = _entries(rows)
    tuning, _held = _split(entries)
    out = []
    for field in _slice_fields(entries):
        groups = _groups(tuning, field)
        for qid, question in questions.items():
            labeled = {entry["n"] for entry, _value in _answers(entries, qid, question)}
            if len(labeled) < CV_MIN_ROWS:
                continue
            thin = [group for group in groups.values() if len([e for e in group if e["n"] in labeled]) < CV_MIN_ROWS]
            if thin:
                out.append({"rows": sorted(entry["n"] for group in thin for entry in group),
                            "message": "Field `%s`: %d of its %d values on tuning rows %s fewer than %d valid labels for "
                            "`%s`, so by-slice accuracy and slice targets there rest on a handful of rows."
                            % (field, len(thin), len(groups), "has" if len(thin) == 1 else "have", CV_MIN_ROWS, qid)})
    return out


def slice_single_answer(rows, questions):
    entries = _entries(rows)
    tuning, _held = _split(entries)
    out = []
    for field in _slice_fields(entries):
        groups = _groups(tuning, field)
        for qid, question in questions.items():
            if question["type"] not in ANSWER_TYPES:
                continue
            answers = {entry["n"]: _key(value) for entry, value in _answers(entries, qid, question)}
            if len(set(answers.values())) < 2:
                continue
            flat = []
            for group in groups.values():
                labels = [answers[entry["n"]] for entry in group if entry["n"] in answers]
                if len(labels) >= SINGLE_MIN and len(set(labels)) == 1:
                    flat.append([entry["n"] for entry in group if entry["n"] in answers])
            if flat:
                out.append({"rows": sorted(n for group in flat for n in group),
                            "message": "Field `%s`: in %d of its %d values every valid tuning label for `%s` is the same "
                            "answer, so by-slice accuracy there never sees the others." % (field, len(flat), len(groups), qid)})
    return out


def slice_missing_from_held_out(rows, questions):
    entries = _entries(rows)
    tuning, held = _split(entries)
    held = [entry for entry in held if _labeled(entry)]  # an unlabeled held-out row is never scored
    if len(held) < testsplit.MIN_ROWS:
        return []
    out = []
    for field in _slice_fields(entries):
        tuned = _groups([entry for entry in tuning if _labeled(entry)], field)
        seen = set(_groups(held, field))
        missing = [group for value, group in tuned.items() if value not in seen]
        if missing:
            out.append({"rows": sorted(entry["n"] for group in missing for entry in group),
                        "message": "Field `%s`: %d of its %d values on labeled tuning rows %s on no held-out row, so "
                        "the test split never scores %s." % (field, len(missing), len(tuned),
                                                             "appears" if len(missing) == 1 else "appear",
                                                             "it" if len(missing) == 1 else "them")})
    return out


def slice_only_held_out(rows, questions):
    entries = _entries(rows)
    tuning, held = _split(entries)
    held = [entry for entry in held if _labeled(entry)]  # an unlabeled held-out row is never scored
    if not held:
        return []
    out = []
    for field in _slice_fields(entries):
        tuned = set(_groups([entry for entry in tuning if _labeled(entry)], field))
        only = [group for value, group in _groups(held, field).items() if value not in tuned]
        if only and tuned:
            out.append({"rows": sorted(entry["n"] for group in only for entry in group),
                        "message": "Field `%s`: %s on held-out rows %s on no labeled tuning row, so thresholds are never "
                        "tuned on %s." % (field, _plural(len(only), "value"), "appears" if len(only) == 1 else "appear",
                                          "it" if len(only) == 1 else "them")})
    return out


# ---------- pictures ----------


def _picture_path(name: Any):
    """The file a row picture's name stands for, or None when the name is not a picture name at all."""
    if not isinstance(name, str):
        return None
    if name in images.SAMPLES:
        return images.SAMPLES_DIR / ("%s.png" % name)
    if workbench.IMAGE_FILE.fullmatch(name):
        return workbench.images_dir() / name
    return None


def missing_picture_files(rows, questions):
    found = []
    for entry in _entries(rows):
        if entry["picture"] is None or not _labeled(entry):
            continue
        path = _picture_path(entry["picture"])
        if path is None or not path.is_file():
            found.append(entry["n"])
    if not found:
        return []
    return [{"rows": found, "message": "%s a picture that is not in the data directory, so Bulk, checks and exported "
             "gates cannot send %s." % (_plural(len(found), "labeled row names", "labeled rows name"),
                                        "it" if len(found) == 1 else "them")}]


def unreadable_picture_files(rows, questions):
    found = []
    readable: Dict[str, bool] = {}
    for entry in _entries(rows):
        path = _picture_path(entry["picture"]) if _labeled(entry) else None
        if path is None or not path.is_file():
            continue
        if str(path) not in readable:
            try:
                images.check(path.read_bytes())
                readable[str(path)] = True
            except (images.ImageError, OSError):
                readable[str(path)] = False
        if not readable[str(path)]:
            found.append(entry["n"])
    if not found:
        return []
    return [{"rows": found, "message": "%s a picture file that is damaged, not PNG or JPEG, or outside the size limits "
             "(each side %d to %d pixels), so %s requests would fail." % (
                 _plural(len(found), "labeled row names", "labeled rows name"), images.MIN_SIDE, images.MAX_SIDE,
                 "its" if len(found) == 1 else "their")}]


def picture_across_split(rows, questions):
    reads = any(question["type"] == "box" or any(path.split(".")[0].split("[")[0] == workbench.PHOTO_FIELD
                                                 for path in lint._paths(question)) for question in questions.values())
    if not reads:
        return []
    groups: Dict[str, List[dict]] = {}
    for entry in _entries(rows):
        if isinstance(entry["picture"], str):
            groups.setdefault(entry["picture"], []).append(entry)
    out = []
    for group in groups.values():
        tuning = [entry for entry in group if not entry["test"]]
        held = [entry for entry in group if entry["test"]]
        if tuning and held and {entry["key"] for entry in held} - {entry["key"] for entry in tuning}:
            out.append({"rows": [entry["n"] for entry in group],
                        "message": "%s and %s share one picture with different inputs, so a picture question scored on "
                        "the test split has seen it in tuning." % (_plural(len(tuning), "tuning row"),
                                                                   _plural(len(held), "held-out row"))})
    return out


def _check(ident: str, title: str, check) -> dict:
    return {"id": ident, "kind": "health_check", "title": title, "check": check}


PACK = kit.define_pack({
    "id": "health-evaluation",
    "surface": "python.health",
    "title": "Evaluation readiness",
    "about": "Dataset health findings about whether the labels can support Recalibrate, answer sets, "
             "cross-validation, the test split, slices and Policy gates, and whether labeled rows' pictures can be "
             "sent, reported as row numbers, question ids, field names and counts, never as values.",
    "features": [
        _check("recalibrate_too_few", "Questions with 10 to 19 tuning labels, under Recalibrate's 20", recalibrate_too_few),
        _check("answer_set_folds_short", "Questions whose cross-validation folds are too small for a 90% or 95% answer set",
               answer_set_folds_short),
        _check("fewer_labels_than_answers", "Choice and Score questions with fewer tuning labels than options or levels",
               fewer_labels_than_answers),
        _check("score_ends_unlabeled", "Score questions whose lowest or top level has no tuning label", score_ends_unlabeled),
        _check("answer_few_inputs", "Answers whose tuning labels come from fewer than 5 distinct inputs", answer_few_inputs),
        _check("group_larger_than_fold", "Copies of one input holding more than a fold's share of labeled rows",
               group_larger_than_fold),
        _check("gate_rows_too_few", "Questions labeled on rows that rarely overlap, too few for a Policy gate over them",
               gate_rows_too_few),
        _check("labeled_rows_missing_question_field", "Labeled rows without a field their question points at",
               labeled_rows_missing_question_field),
        _check("labels_cover_only_first_rows", "Labels only on the first rows, with many unlabeled rows after them",
               labels_cover_only_first_rows),
        _check("held_out_question_too_few", "Questions with fewer than 2 valid labels on held-out rows",
               held_out_question_too_few),
        _check("held_out_cannot_show_90", "Questions with too few held-out labels to show 90% accuracy",
               held_out_cannot_show_90),
        _check("question_split_skewed", "Questions whose own held-out share is outside 10% to 50%", question_split_skewed),
        _check("slice_too_few_labels", "Slice values with fewer than 10 tuning labels for a question", slice_too_few_labels),
        _check("slice_single_answer", "Slice values where every tuning label of a question is one answer",
               slice_single_answer),
        _check("slice_missing_from_held_out", "Slice values on labeled tuning rows but on no held-out row",
               slice_missing_from_held_out),
        _check("slice_only_held_out", "Slice values only on held-out rows", slice_only_held_out),
        _check("missing_picture_files", "Labeled rows naming a picture missing from the data directory",
               missing_picture_files),
        _check("unreadable_picture_files", "Labeled rows naming a damaged or out-of-limits picture file",
               unreadable_picture_files),
        _check("picture_across_split", "One picture on tuning and held-out rows with different inputs",
               picture_across_split),
    ],
})
