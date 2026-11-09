"""Labeling guidelines: how a person should label each of a dataset's questions, saved with the dataset.

A dataset may carry a `guidelines` object, question id -> {"note": text, "examples": [{"input", "label", "why"}]}.
They are for the people labeling rows (pre-run labeling, the Review queue, Label agreement, and drift's Label new
traffic) so two labelers share one definition of each answer. They are human-only: no request to the model ever
reads them, and they are not gate configuration, so an exported gate and its decision provenance never change
because of them. They travel with the dataset in bundles and survive check saves and model upgrades.

Examples are generic, written by a person, never taken from a row. Their labels are checked with the same label
validation the labeling surfaces use (jev/decisions.py), so a Choice example names an option, a Noul example is
yes or no, and a Score example is a level. Box questions take a note but no label examples.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from . import decisions, workbench
from .workbench import WorkbenchError

KEY = "guidelines"
MAX_NOTE_CHARS = 2000
MAX_EXAMPLES = 10  # per question
MAX_INPUT_CHARS = 500
MAX_WHY_CHARS = 500
FIELDS = ("note", "examples")
EXAMPLE_FIELDS = ("input", "label", "why")


def _text(value: Any, what: str, limit: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise WorkbenchError("%s must be text" % what)
    value = value.strip()
    if len(value) > limit:
        raise WorkbenchError("%s is too long (limit %d characters)" % (what, limit))
    if required and not value:
        raise WorkbenchError("%s is required" % what)
    return value


def _example(qid: str, question: dict, raw: Any, number: int) -> dict:
    what = "Guideline for %s, example %d" % (qid, number)
    if not isinstance(raw, dict):
        raise WorkbenchError("%s must be an object with input, label, and why" % what)
    unknown = sorted(set(raw) - set(EXAMPLE_FIELDS), key=str)
    if unknown:
        raise WorkbenchError("%s: unknown field %r; an example has input, label, and why" % (what, unknown[0]))
    if question["type"] not in decisions.LABEL_TYPES:
        raise WorkbenchError("Guideline for %s: Box questions take a note, not label examples" % qid)
    out = {"input": _text(raw.get("input"), what + ": input", MAX_INPUT_CHARS, required=True)}
    ok, label = decisions.label(question, raw.get("label"))
    if not ok or label is None:
        # The value is not echoed: a guideline error never repeats a label.
        raise WorkbenchError("%s: the label is not a valid answer for this %s question" % (what, question["type"]))
    out["label"] = label
    why = _text(raw.get("why"), what + ": why", MAX_WHY_CHARS)
    if why:
        out["why"] = why
    return out


def _entry(qid: str, question: dict, raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise WorkbenchError("Guideline for %s must be an object with a note and examples" % qid)
    unknown = sorted(set(raw) - set(FIELDS), key=str)
    if unknown:
        raise WorkbenchError("Guideline for %s: unknown field %r; a guideline has a note and examples" % (qid, unknown[0]))
    out: dict = {}
    note = _text(raw.get("note"), "Guideline for %s: note" % qid, MAX_NOTE_CHARS)
    if note:
        out["note"] = note
    examples = raw.get("examples")
    if examples not in (None, []):
        if not isinstance(examples, list):
            raise WorkbenchError("Guideline for %s: examples must be a list" % qid)
        if len(examples) > MAX_EXAMPLES:
            raise WorkbenchError("Guideline for %s: at most %d examples" % (qid, MAX_EXAMPLES))
        out["examples"] = [_example(qid, question, e, i) for i, e in enumerate(examples, 1)]
    return out


def validate(raw: Any, questions: Any) -> Dict[str, dict]:
    """Clean guidelines for `questions` (a dataset's saved questions), or WorkbenchError.

    Every question id must be one of the questions; an entry with neither a note nor an example is left out."""
    if raw in (None, {}):
        return {}
    if not isinstance(raw, dict):
        raise WorkbenchError("guidelines must be an object keyed by question id")
    questions = questions if isinstance(questions, dict) else {}
    if not questions:
        raise WorkbenchError("Save the dataset with its questions before writing labeling guidelines")
    out: Dict[str, dict] = {}
    for qid, entry in raw.items():
        if not isinstance(qid, str) or qid not in questions:
            raise WorkbenchError("Guideline for %r: the dataset has no such question" % (qid,))
        clean = _entry(qid, questions[qid], entry)
        if clean:
            out[qid] = clean
    return out


def reconcile(raw: Any, questions: Any) -> Tuple[Dict[str, dict], List[str]]:
    """(guidelines, warnings): `raw` kept where it still fits `questions`, never raising.

    A guideline for a question that is no longer in the dataset is dropped, as is an example whose label no longer
    fits its question. Each drop is reported by question id; warnings never repeat a label."""
    if not isinstance(raw, dict) or not raw:
        return {}, []
    questions = questions if isinstance(questions, dict) else {}
    out: Dict[str, dict] = {}
    warnings: List[str] = []
    for qid, entry in raw.items():
        if not isinstance(qid, str) or qid not in questions:
            warnings.append("Dropped the labeling guideline for %s: the question is no longer in the dataset" % qid)
            continue
        question = questions[qid]
        if not isinstance(entry, dict):
            warnings.append("Dropped the labeling guideline for %s: it is not a note and examples" % qid)
            continue
        try:
            note = _entry(qid, question, {"note": entry.get("note")})
        except WorkbenchError:
            warnings.append("Dropped the note for %s: it is not text within %d characters" % (qid, MAX_NOTE_CHARS))
            note = {}
        examples, dropped = [], 0
        raw_examples = entry.get("examples")
        for number, example in enumerate(raw_examples if isinstance(raw_examples, list) else [], 1):
            if len(examples) >= MAX_EXAMPLES:
                dropped += 1
                continue
            try:
                examples.append(_example(qid, question, example, number))
            except WorkbenchError:
                dropped += 1
        if raw_examples not in (None, []) and not isinstance(raw_examples, list):
            dropped += 1
        if dropped:
            warnings.append("Dropped %d labeling example%s for %s: %s no longer fit%s the question"
                            % (dropped, "" if dropped == 1 else "s", qid, "its label" if dropped == 1 else "their labels",
                               "s" if dropped == 1 else ""))
        clean = dict(note, **({"examples": examples} if examples else {}))
        if clean:
            out[qid] = clean
    return out, warnings


def changes(before: Any, after: Any) -> dict:
    """What a replacement does to a dataset's guidelines, by question id only: never a note, input, or label."""
    before = before if isinstance(before, dict) else {}
    after = after if isinstance(after, dict) else {}

    def same(qid: str) -> bool:
        return json.dumps(before[qid], sort_keys=True) == json.dumps(after[qid], sort_keys=True)

    return {"before": len(before), "after": len(after),
            "added": [q for q in after if q not in before],
            "removed": [q for q in before if q not in after],
            "changed": [q for q in after if q in before and not same(q)]}


def count(dataset: dict) -> int:
    value = dataset.get(KEY)
    return len(value) if isinstance(value, dict) else 0


def load(dataset_id: str) -> dict:
    """A saved dataset's guidelines and the questions they are for, for the labeling surfaces and the editor."""
    dataset = workbench.load_dataset(dataset_id)
    questions = dataset.get("questions") if isinstance(dataset.get("questions"), dict) else {}
    clean, warnings = reconcile(dataset.get(KEY), questions)
    return {"id": dataset_id, "name": dataset.get("name") or dataset_id, "saved_at": dataset.get("saved_at"),
            "questions": questions, KEY: clean, "warnings": warnings}


@workbench.dataset_update()
def save(dataset_id: str, raw: Any) -> dict:
    """Replace a saved dataset's guidelines; its rows, labels, questions, check, and test history stay as they are."""
    dataset = workbench.load_dataset(dataset_id)
    clean = validate(raw, dataset.get("questions"))
    if clean:
        dataset[KEY] = clean
    else:
        dataset.pop(KEY, None)
    workbench.write_dataset(dataset)
    return {"id": dataset_id, KEY: clean, "dataset": workbench.dataset_summary(dataset)}
