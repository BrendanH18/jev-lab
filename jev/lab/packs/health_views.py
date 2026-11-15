"""Dataset health: rows that differ as stored but look the same through the fields a question points at.

Exact-input identity (Review's, decisions._key) keeps copies together and finds labels that conflict on one input.
But a question that points at `text` asks about the text, and two rows with the same text and a different id or time
are, for that question, the same case. These checks compare rows through each question's backtick paths: labels that
disagree on rows the question sees the same way, and the same view on both sides of the test split. Findings carry row
numbers, question ids and paths only; held-out rows' labels are never read.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from jev import decisions, lint, workbench
from jev.lab import kit
from jev.lab.packs import health_inputs as inputs, preflight_states as states

LABEL_TYPES = ("choice", "noul", "score")


def _state(entry: dict) -> Any:
    value = entry["input"]
    return {"text": value} if isinstance(value, str) else value


def _view(entry: dict, paths: List[str], photo: bool = False) -> Optional[str]:
    """What a question's paths read on this row, or None when one of them reads nothing. photo: the question reads the
    row's picture too, so its name is part of what the question sees."""
    parts: List[Any] = []
    for path in paths:
        found = [value for _route, value in states._lookup(_state(entry), path)]
        if not found or all(inputs._blank(value) for value in found):
            return None
        parts.append(found)
    if photo:
        parts.append({workbench.IMAGE_KEY: entry["picture"]})
    return json.dumps(parts, sort_keys=True, ensure_ascii=False)


def _pointed(questions: Dict[str, dict]) -> Dict[str, Tuple[List[str], bool]]:
    """Per question: (the state paths it reads other than the picture, whether it reads the picture)."""
    out = {}
    for qid, question in (questions or {}).items():
        if isinstance(question, dict):
            read = set(lint._paths(question))
            paths = sorted(path for path in read if path != workbench.PHOTO_FIELD)
            if paths:
                out[qid] = (paths, workbench.PHOTO_FIELD in read)
    return out


def _label(question: dict, row: Any, qid: str) -> Optional[str]:
    labels = row.get(workbench.LABEL_KEY) if isinstance(row, dict) else None
    if not isinstance(labels, dict) or labels.get(qid) in (None, ""):
        return None
    ok, label = decisions.label(question, labels[qid])
    return json.dumps(label) if ok and label is not None else None


def same_view_different_labels(rows, questions):
    entries = inputs._entries(rows)
    out = []
    for qid, (paths, photo) in _pointed(questions).items():
        question = questions[qid]
        if question.get("type") not in LABEL_TYPES:
            continue
        groups: Dict[str, List[tuple]] = {}
        for entry, row in zip(entries, rows):
            if entry["test"]:
                continue
            label = _label(question, row, qid)
            view = _view(entry, paths, photo) if label is not None else None
            if view is not None:
                groups.setdefault(view, []).append((entry["n"], entry["key"], label))
        hits = sorted(n for group in groups.values()
                      if len({key for _n, key, _given in group}) > 1 and len({given for _n, _key, given in group}) > 1
                      for n, _key, _given in group)
        if hits:
            out.append({"rows": hits, "message": "`%s` reads %s, and %s that read the same there but differ elsewhere carry "
                        "different labels; for this question they are one case, so one label is likely wrong."
                        % (qid, ", ".join("`%s`" % path for path in paths), inputs._plural(len(hits), "row"))})
    return out


def same_view_across_split(rows, questions):
    entries = inputs._entries(rows)
    if not any(entry["test"] for entry in entries):
        return []
    out = []
    for qid, (paths, photo) in _pointed(questions).items():
        groups: Dict[str, List[dict]] = {}
        for entry in entries:
            view = _view(entry, paths, photo)
            if view is not None:
                groups.setdefault(view, []).append(entry)
        hits = sorted(entry["n"] for group in groups.values()
                      if any(e["test"] for e in group) and not all(e["test"] for e in group) and len({e["key"] for e in group}) > 1
                      for entry in group)
        if hits:
            out.append({"rows": hits, "message": "`%s` reads %s, which is the same on tuning and held-out rows that differ "
                        "elsewhere (%s); the test split keeps exact copies together but not these, so tuning sees the "
                        "held-out case." % (qid, ", ".join("`%s`" % path for path in paths), inputs._plural(len(hits), "row"))})
    return out


def _check(ident: str, title: str, check) -> dict:
    return {"id": ident, "kind": "health_check", "title": title, "check": check}


PACK = kit.define_pack({
    "id": "health-views",
    "surface": "python.health",
    "title": "Rows as a question sees them",
    "about": "Dataset health findings that compare rows through the fields each question points at: different labels on "
             "rows a question sees the same way, and the same view on both sides of the test split. Row numbers, "
             "question ids and paths only.",
    "features": [
        _check("same_view_different_labels", "Different labels on rows that read the same through a question's fields",
               same_view_different_labels),
        _check("same_view_across_split", "Tuning and held-out rows that read the same through a question's fields",
               same_view_across_split),
    ],
})
