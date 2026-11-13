"""Dataset health: label coverage and label quality, reported without label values.

Every check reads the rows as jev.health.analyze receives them (labels under ``_expect``, held-out rows marked
``_test``) and the validated questions. Findings carry row numbers, question ids, counts and shares only, never a
label value or input text. Answer distributions read tuning rows only; held-out rows are counted, never described by
their answers. Label validity is jev.health's own (exact Choice keys, as Calibrate reads them).
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

from jev import calibrate, decisions, health, holdout, testsplit, workbench
from jev.lab import kit
from jev.workbench import WorkbenchError

CV_MIN_ROWS = holdout.FOLDS * holdout.MIN_PER_FOLD  # valid labeled rows grouped cross-validation needs (10)
CV_MIN_INPUTS = holdout.FOLDS  # distinct labeled inputs it needs: one per fold (5)
SINGLE_MIN = 5  # labels before "every label is the same answer" means something
DOMINANT_SHARE = 0.9
DOMINANT_MIN = 10
RARE_MIN_LABELS = 20  # labels a question needs before a rare answer is worth pointing out
RARE_BELOW = 5  # an answer with fewer tuning labels than this is rare
SHARED_MIN = 10  # rows labeled for both questions before two questions can be called redundant
BLOCK_MIN = 3  # held-out rows before "they all sit at one end" means something
BOX_TINY = 0.005  # share of the picture
BOX_FULL = 0.95
BOX_ASPECT = 20.0
ANSWER_TYPES = ("noul", "choice", "score")
_LOOSE = re.compile(r"[\s_-]+")


# ---------- shared reading ----------


def _entries(rows: List[Any]) -> List[dict]:
    """One entry per row: number, input without marks, labels (a dict), held out or not, and Review's identity."""
    out = []
    for number, row in enumerate(rows, 1):
        try:
            state, raw = workbench.split_labels(row, number)
        except WorkbenchError:
            state, raw = row, None
        out.append({"n": number, "input": workbench.without_marks(state), "labels": raw if isinstance(raw, dict) else {},
                    "test": isinstance(state, dict) and state.get(workbench.TEST_KEY) is True,
                    "picture": state.get(workbench.IMAGE_KEY) if isinstance(state, dict) else None,
                    "key": decisions._key(row)})
    return out


def _valid(question: dict, value: Any) -> Tuple[bool, Any]:
    """(valid, label in its normal form). None is not a label."""
    if value is None:
        return False, None
    return health._label(question, value)


def _answers(entries: List[dict], qid: str, question: dict, test: bool = False) -> List[Tuple[int, Any]]:
    """(row number, normal label) for the valid labels of one question on tuning rows (or on held-out rows)."""
    out = []
    for entry in entries:
        if entry["test"] != test:
            continue
        ok, value = _valid(question, entry["labels"].get(qid))
        if ok:
            out.append((entry["n"], value))
    return out


def _key(value: Any) -> str:
    return json.dumps(value, sort_keys=True)


def _counts(answers: List[Tuple[int, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for _n, value in answers:
        counts[_key(value)] = counts.get(_key(value), 0) + 1
    return counts


def _rows(answers: List[Tuple[int, Any]]) -> List[int]:
    return [n for n, _ in answers]


def _plural(count: int, word: str, many: Optional[str] = None) -> str:
    return "%d %s" % (count, word if count == 1 else (many or word + "s"))


def _invalid_tuning(entries: List[dict], qid: str, question: dict) -> List[Tuple[int, Any]]:
    """(row number, raw label) for tuning rows whose label for this question is present but not valid."""
    out = []
    for entry in entries:
        value = entry["labels"].get(qid)
        if entry["test"] or value is None:
            continue
        if not _valid(question, value)[0]:
            out.append((entry["n"], value))
    return out


def _empty(value: Any) -> bool:
    """No input at all: no fields, or only null, empty text, empty lists and empty objects."""
    if value is None or value == "":
        return True
    if isinstance(value, dict):
        return all(_empty(item) for item in value.values())
    if isinstance(value, list):
        return all(_empty(item) for item in value)
    return False


def _box_area(box: dict) -> float:
    return (box["right"] - box["left"]) * (box["bottom"] - box["top"])


def _boxes(entries: List[dict], questions: Dict[str, dict]):
    for qid, question in questions.items():
        if question["type"] == "box":
            yield qid, _answers(entries, qid, question)


# ---------- coverage ----------


def too_few_cv_labels(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        answers = _answers(entries, qid, question)
        if 1 <= len(answers) < CV_MIN_ROWS:
            out.append({"rows": _rows(answers), "message": "Question `%s` has %s on tuning rows; checking a gate on "
                        "unseen rows needs at least %d." % (qid, _plural(len(answers), "valid label"), CV_MIN_ROWS)})
    return out


def too_few_distinct_inputs(rows, questions):
    entries = _entries(rows)
    keys = {entry["n"]: entry["key"] for entry in entries}
    out = []
    for qid, question in questions.items():
        answers = _answers(entries, qid, question)
        distinct = len({keys[n] for n, _ in answers})
        if len(answers) >= CV_MIN_ROWS and distinct < CV_MIN_INPUTS:
            out.append({"rows": _rows(answers), "message": "Question `%s`'s %d valid tuning labels come from %s; "
                        "cross-validation keeps copies of an input in one fold, so it needs at least %d."
                        % (qid, len(answers), _plural(distinct, "distinct input"), CV_MIN_INPUTS)})
    return out


def target_not_verifiable(rows, questions):
    entries = _entries(rows)
    need = {target: calibrate.rows_needed(target) for target in calibrate.TARGETS[:2]}
    out = []
    for qid, question in questions.items():
        answers = _answers(entries, qid, question)
        missed = [target for target in calibrate.TARGETS[:2] if len(answers) < need[target]]
        if len(answers) >= CV_MIN_ROWS and missed:
            shown = " or ".join("%d%% (%d rows)" % (round(target * 100), need[target]) for target in missed)
            out.append({"rows": _rows(answers), "message": "Question `%s` has %d valid tuning labels: even with every "
                        "automated row right, that cannot show %s at 95%% confidence." % (qid, len(answers), shown)})
    return out


def labels_only_on_held_out(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        held = _answers(entries, qid, question, test=True)
        if held and not _answers(entries, qid, question):
            out.append({"rows": _rows(held), "message": "Question `%s` has valid labels only on held-out rows, so "
                        "tuning has none to learn from." % qid})
    return out


def partial_label_rows(rows, questions):
    if len(questions) < 2:
        return []
    found, held = [], 0
    for entry in _entries(rows):
        present = [qid for qid in questions if entry["labels"].get(qid) is not None]
        if present and len(present) < len(questions):
            found.append(entry["n"])
            held += entry["test"]
    if not found:
        return []
    return [{"rows": found, "message": "%s labeled for some of the %d questions but not the others (%d held out)."
             % (_plural(len(found), "row is", "rows are"), len(questions), held)}]


def label_key_near_miss(rows, questions):
    loose = {}
    for qid in questions:
        loose.setdefault(_LOOSE.sub("", qid.casefold()), qid)
    groups: Dict[Tuple[str, str], List[int]] = {}
    for entry in _entries(rows):
        for name, value in entry["labels"].items():
            if name in questions or value is None:
                continue
            target = loose.get(_LOOSE.sub("", str(name).casefold()))
            if target is not None:
                groups.setdefault((str(name), target), []).append(entry["n"])
    return [{"rows": found, "message": "Labels saved under `%s` look meant for question `%s`; only exact question "
             "ids count as its labels." % (name, target)} for (name, target), found in groups.items()]


def labels_on_empty_inputs(rows, questions):
    found = [entry["n"] for entry in _entries(rows)
             if any(value is not None for value in entry["labels"].values()) and entry["picture"] is None
             and _empty(entry["input"])]
    if not found:
        return []
    return [{"rows": found, "message": "%s labels but no input: no fields, or only empty ones, and no picture."
             % _plural(len(found), "row carries", "rows carry")}]


# ---------- answer distributions (tuning rows only) ----------


def single_answer(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] not in ANSWER_TYPES:
            continue
        answers = _answers(entries, qid, question)
        if len(answers) >= SINGLE_MIN and len(_counts(answers)) == 1:
            out.append({"rows": _rows(answers), "message": "Every one of the %d valid tuning labels for `%s` is the "
                        "same answer, so tuning cannot learn when the answer differs." % (len(answers), qid)})
    return out


def dominant_answer(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] not in ANSWER_TYPES:
            continue
        answers = _answers(entries, qid, question)
        counts = _counts(answers)
        top = max(counts.values()) if counts else 0
        if len(answers) >= DOMINANT_MIN and len(counts) > 1 and top >= DOMINANT_SHARE * len(answers):
            out.append({"rows": _rows(answers), "message": "One answer holds %d%% of `%s`'s %d valid tuning labels; "
                        "accuracy can look high while the other answers go untested."
                        % (100 * top // len(answers), qid, len(answers))})
    return out


def rare_answers(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] not in ANSWER_TYPES:
            continue
        answers = _answers(entries, qid, question)
        counts = _counts(answers)
        rare = {key for key, count in counts.items() if count < RARE_BELOW}
        if len(answers) >= RARE_MIN_LABELS and rare:
            out.append({"rows": [n for n, value in answers if _key(value) in rare],
                        "message": "Question `%s`: %s fewer than %d tuning labels%s; these rows carry %s."
                        % (qid, _plural(len(rare), "answer has", "answers have"), RARE_BELOW,
                           "" if len(rare) == 1 else " each", "it" if len(rare) == 1 else "them")})
    return out


def unused_choice_options(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] != "choice":
            continue
        answers = _answers(entries, qid, question)
        options = list(question["criteria"])
        unused = [option for option in options if _key(option) not in _counts(answers)]
        if answers and len(answers) >= len(options) and unused:
            out.append({"rows": _rows(answers), "message": "Question `%s`: %d of its %d options %s no tuning label, "
                        "so tuning never sees %s." % (qid, len(unused), len(options), "has" if len(unused) == 1 else "have",
                                                      "it" if len(unused) == 1 else "them")})
    return out


def score_level_gap(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] != "score":
            continue
        answers = _answers(entries, qid, question)
        used = {value for _, value in answers}
        if not used:
            continue
        gaps = [level for level in range(min(used) + 1, max(used)) if level not in used]
        if gaps:
            out.append({"rows": _rows(answers), "message": "Question `%s`: %s between its lowest and highest labeled "
                        "levels %s no tuning label." % (qid, _plural(len(gaps), "level"), "has" if len(gaps) == 1 else "have")})
    return out


def redundant_questions(rows, questions):
    return _pairs(rows, questions, lambda a, b: a == b, ANSWER_TYPES,
                  "Questions `%s` and `%s` have the same label on all %d tuning rows labeled for both; one of them may "
                  "not be needed.")


def inverse_noul_questions(rows, questions):
    return _pairs(rows, questions, lambda a, b: a != b, ("noul",),
                  "Questions `%s` and `%s` have opposite labels on all %d tuning rows labeled for both; one may be the "
                  "other asked the other way round.")


def _pairs(rows, questions, agree, types, text):
    entries = _entries(rows)
    labeled = {qid: dict(_answers(entries, qid, question)) for qid, question in questions.items()
               if question["type"] in types}
    qids = list(labeled)
    out = []
    for i, first in enumerate(qids):
        for second in qids[i + 1:]:
            if questions[first]["type"] != questions[second]["type"]:
                continue
            shared = sorted(set(labeled[first]) & set(labeled[second]))
            # Two questions that each give one answer throughout agree (or disagree) trivially: single_answer covers it.
            varied = len({_key(labeled[first][n]) for n in shared}) > 1
            if len(shared) >= SHARED_MIN and varied and all(agree(labeled[first][n], labeled[second][n]) for n in shared):
                out.append({"rows": shared, "message": text % (first, second, len(shared))})
    return out


# ---------- the test split ----------


def _split(rows):
    labeled = [(n, row) for n, row in enumerate(rows, 1) if testsplit._labeled(row)]
    tests = [n for n, row in enumerate(rows, 1) if isinstance(row, dict) and row.get(workbench.TEST_KEY) is True]
    held = [n for n, row in labeled if n in set(tests)]
    tuning = [n for n, row in labeled if n not in set(tests)]
    return tests, tuning, held


def unlabeled_test_rows(rows, questions):
    found = []
    for entry in _entries(rows):
        names = questions or entry["labels"]
        if entry["test"] and not any(entry["labels"].get(qid) is not None for qid in names):
            found.append(entry["n"])
    if not found:
        return []
    return [{"rows": found, "message": "%s no labels%s, so %s cannot score a gate."
             % (_plural(len(found), "held-out row has", "held-out rows have"),
                " for the selected questions" if questions else "", "it" if len(found) == 1 else "they")}]


def _share(rows, low: bool):
    tests, tuning, held = _split(rows)
    total = len(tuning) + len(held)
    if not held:
        return []
    share = len(held) / total
    if (low and share >= testsplit.MIN_SHARE) or (not low and share <= testsplit.MAX_SHARE):
        return []
    return [{"rows": held, "message": "Held-out rows are %d of %d labeled rows (%d%%); a test split holds %d%% to "
             "%d%% of them." % (len(held), total, round(100 * share), round(100 * testsplit.MIN_SHARE),
                                round(100 * testsplit.MAX_SHARE))}]


def test_share_too_small(rows, questions):
    return _share(rows, True)


def test_share_too_large(rows, questions):
    return _share(rows, False)


def split_side_too_small(rows, questions):
    tests, tuning, held = _split(rows)
    if not tests or (len(tuning) >= testsplit.MIN_ROWS and len(held) >= testsplit.MIN_ROWS):
        return []
    found = tests if len(held) < testsplit.MIN_ROWS else tuning or tests
    return [{"rows": found, "message": "The split has %d labeled tuning and %d labeled held-out rows; each side needs "
             "at least %d." % (len(tuning), len(held), testsplit.MIN_ROWS)}]


def test_rows_one_block(rows, questions):
    tests = [n for n, row in enumerate(rows, 1) if isinstance(row, dict) and row.get(workbench.TEST_KEY) is True]
    if len(tests) < BLOCK_MIN or len(tests) == len(rows) or tests != list(range(tests[0], tests[-1] + 1)):
        return []
    if tests[0] == 1:
        where = "first"
    elif tests[-1] == len(rows):
        where = "last"
    else:
        return []
    return [{"rows": tests, "message": "All %d held-out rows are the %s rows in order, as a split made by hand often "
             "is; Hold out test rows draws a random split." % (len(tests), where)}]


# ---------- Score and Box labels ----------


def score_labels_one_based(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] != "score":
            continue
        levels = len(question["criteria"])
        over = [n for n, value in _invalid_tuning(entries, qid, question)
                if not isinstance(value, bool) and _number(value) == levels]
        lowest = any(value == 0 for _, value in _answers(entries, qid, question))
        if over and not lowest:
            out.append({"rows": over, "message": "Question `%s`: these tuning labels are one past the top level and "
                        "none uses the lowest, as if levels were counted from 1; Score levels count from 0." % qid})
    return out


def _number(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def box_label_tiny(rows, questions):
    out = []
    for qid, answers in _boxes(_entries(rows), questions):
        found = [n for n, box in answers if _box_area(box) < BOX_TINY]
        if found:
            out.append({"rows": found, "message": "Question `%s`: these tuning Box labels cover under %s of the "
                        "picture; check they mark the whole object." % (qid, "0.5%")})
    return out


def box_label_full_picture(rows, questions):
    out = []
    for qid, answers in _boxes(_entries(rows), questions):
        found = [n for n, box in answers if _box_area(box) > BOX_FULL]
        if found:
            out.append({"rows": found, "message": "Question `%s`: these tuning Box labels cover over 95%% of the "
                        "picture, which says little about where the object is." % qid})
    return out


def box_label_sliver(rows, questions):
    out = []
    for qid, answers in _boxes(_entries(rows), questions):
        found = []
        for n, box in answers:
            width, height = box["right"] - box["left"], box["bottom"] - box["top"]
            if _box_area(box) >= BOX_TINY and max(width / height, height / width) > BOX_ASPECT:
                found.append(n)
        if found:
            out.append({"rows": found, "message": "Question `%s`: these tuning Box labels are over %d times longer "
                        "than wide (as shares of the picture), more like a line than a box." % (qid, BOX_ASPECT)})
    return out


def box_label_without_picture(rows, questions):
    out = []
    entries = _entries(rows)
    for qid, question in questions.items():
        if question["type"] != "box":
            continue
        found = [entry["n"] for entry in entries if entry["labels"].get(qid) is not None and entry["picture"] is None]
        if found:
            out.append({"rows": found, "message": "Question `%s`: these rows have a Box label but name no picture "
                        "with _image." % qid})
    return out


# ---------- labels in the wrong form (tuning rows only) ----------


def labels_not_canonical(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] not in ("noul", "score"):
            continue
        found = []
        for entry in entries:
            value = entry["labels"].get(qid)
            if entry["test"] or not _valid(question, value)[0]:
                continue
            canonical = isinstance(value, bool) if question["type"] == "noul" else (
                isinstance(value, int) and not isinstance(value, bool))
            if not canonical:
                found.append(entry["n"])
        if found:
            want = "true or false" if question["type"] == "noul" else "a whole number"
            out.append({"rows": found, "message": "Question `%s`: these tuning labels are valid but not saved as %s; "
                        "writing every label one way keeps rows that agree from looking different." % (qid, want)})
    return out


def fixable_choice_labels(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] != "choice":
            continue
        folded: Dict[str, List[str]] = {}
        for option in question["criteria"]:
            folded.setdefault(option.strip().casefold(), []).append(option)
        found = [n for n, value in _invalid_tuning(entries, qid, question)
                 if isinstance(value, str) and len(folded.get(value.strip().casefold(), [])) == 1]
        if found:
            out.append({"rows": found, "message": "Question `%s`: these tuning labels match one option except for "
                        "case or spaces; Calibrate and health compare option keys exactly." % qid})
    return out


def label_matches_description(rows, questions):
    entries = _entries(rows)
    out = []
    for qid, question in questions.items():
        if question["type"] == "choice":
            texts = [text for text in question["criteria"].values() if isinstance(text, str)]
        elif question["type"] == "score":
            texts = [text for text in question["criteria"] if isinstance(text, str)]
        else:
            continue
        described = {text.strip().casefold() for text in texts if text.strip()}
        found = [n for n, value in _invalid_tuning(entries, qid, question)
                 if isinstance(value, str) and value.strip().casefold() in described]
        if found:
            what = "option key" if question["type"] == "choice" else "level number"
            out.append({"rows": found, "message": "Question `%s`: these tuning labels repeat a description from the "
                        "criteria instead of giving its %s." % (qid, what)})
    return out


def blank_text_labels(rows, questions):
    out = []
    entries = _entries(rows)
    for qid in questions:
        found = [entry["n"] for entry in entries if not entry["test"]
                 and isinstance(entry["labels"].get(qid), str) and not entry["labels"][qid].strip()]
        if found:
            out.append({"rows": found, "message": "Question `%s`: these tuning labels are blank text, which counts as an "
                        "invalid label; leave the label out to mark it missing." % qid})
    return out


def _check(ident: str, title: str, check) -> dict:
    return {"id": ident, "kind": "health_check", "title": title, "check": check}


PACK = kit.define_pack({
    "id": "health-labels",
    "surface": "python.health",
    "title": "Label coverage and quality",
    "about": "Dataset health findings about how well the human labels cover and fit the questions, reported as "
             "row numbers, question ids, counts and shares, never as label values.",
    "features": [
        _check("too_few_cv_labels", "Questions with too few tuning labels for cross-validation", too_few_cv_labels),
        _check("too_few_distinct_inputs", "Questions whose labels come from too few distinct inputs for the folds",
               too_few_distinct_inputs),
        _check("target_not_verifiable", "Questions with too few tuning labels to show 90% or 95% accuracy",
               target_not_verifiable),
        _check("labels_only_on_held_out", "Questions labeled only on held-out rows", labels_only_on_held_out),
        _check("partial_label_rows", "Rows labeled for some questions but not the others", partial_label_rows),
        _check("label_key_near_miss", "Label keys that nearly match a question id", label_key_near_miss),
        _check("labels_on_empty_inputs", "Labels on rows that send no input", labels_on_empty_inputs),
        _check("single_answer", "Every tuning label of a question is the same answer", single_answer),
        _check("dominant_answer", "One answer holds 90% or more of a question's tuning labels", dominant_answer),
        _check("rare_answers", "Answers with fewer than 5 tuning labels", rare_answers),
        _check("unused_choice_options", "Choice options no tuning row is labeled with", unused_choice_options),
        _check("score_level_gap", "Score levels skipped between the lowest and highest labeled level", score_level_gap),
        _check("redundant_questions", "Two questions whose tuning labels always agree", redundant_questions),
        _check("inverse_noul_questions", "Two yes/no questions whose tuning labels are always opposite",
               inverse_noul_questions),
        _check("unlabeled_test_rows", "Held-out rows with no labels", unlabeled_test_rows),
        _check("test_share_too_small", "Held-out share of labeled rows under 10%", test_share_too_small),
        _check("test_share_too_large", "Held-out share of labeled rows over 50%", test_share_too_large),
        _check("split_side_too_small", "A side of the test split with fewer than 2 labeled rows", split_side_too_small),
        _check("test_rows_one_block", "Held-out rows that are all the first or all the last rows", test_rows_one_block),
        _check("score_labels_one_based", "Score labels that look counted from 1 instead of 0", score_labels_one_based),
        _check("box_label_tiny", "Box labels covering under 0.5% of the picture", box_label_tiny),
        _check("box_label_full_picture", "Box labels covering over 95% of the picture", box_label_full_picture),
        _check("box_label_sliver", "Box labels over 20 times longer than wide", box_label_sliver),
        _check("box_label_without_picture", "Box labels on rows without a picture", box_label_without_picture),
        _check("labels_not_canonical", "Valid yes/no and Score labels saved as text or decimals", labels_not_canonical),
        _check("fixable_choice_labels", "Invalid Choice labels that match one option except for case or spaces",
               fixable_choice_labels),
        _check("label_matches_description", "Labels that repeat a criteria description instead of its key",
               label_matches_description),
        _check("blank_text_labels", "Tuning labels that are blank text", blank_text_labels),
    ],
})
