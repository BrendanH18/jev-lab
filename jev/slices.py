"""Slices: accuracy for each value of a row field, to see where a question or a gate fails.

An overall accuracy can hide a part of the data where the answers are much worse: one channel, one language, one
product line. Given rows Calibrate or Policy already scored, with each row's input, this module groups them by the
value of one field of the input and reports, for each value, how many rows there are, their accuracy over every
row, how many the gate automates, and the accuracy of those, each with a 95% Wilson interval. It reads answers Bulk
already returned, so it makes no model calls.

A slice is marked `below` when its automated rows are right less often than the automated rows of every other
slice together, by more than chance explains: a one-sided Fisher exact test gives p < ALPHA. `below_all` does the
same for every row, with no gate. Small slices rarely reach it, so an unmarked slice is not shown to be fine, only
not shown to be worse. With many slices, about one in twenty can be marked by chance alone.

Fields worth slicing are fields of object rows that take from 2 to MAX_VALUES distinct values. A row without the
field, or a text row, falls in the "(none)" slice. Values are compared as text, so 1 and "1" are one slice.
"""

from __future__ import annotations

import json
from math import comb
from typing import Any, Dict, List, Optional

from . import calibrate
from .calibrate import CalibrationError
from .workbench import LABEL_KEY

MAX_VALUES = 20  # more distinct values than this reads as free text, not a slice
NONE = "(none)"
MAX_VALUE_CHARS = 80
ALPHA = 0.05


def _rows(rows: Any) -> List[dict]:
    if not isinstance(rows, list):
        raise CalibrationError("rows must be a list")
    if len(rows) > calibrate.MAX_ROWS:
        raise CalibrationError("At most %d rows" % calibrate.MAX_ROWS)
    out = []
    for r in rows:
        if not isinstance(r, dict) or not isinstance(r.get("correct"), bool) or not isinstance(r.get("automated"), bool):
            raise CalibrationError("Each row needs a boolean `correct` and `automated`")
        out.append(r)
    return out


def _value(row: Any, field: str) -> str:
    if not isinstance(row, dict) or field not in row or row[field] in (None, ""):
        return NONE
    value = row[field]
    text = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
    return text.strip() or NONE


def _shown(value: str) -> str:
    """A value cut for display only; grouping and counting use the whole value."""
    return value if len(value) <= MAX_VALUE_CHARS else value[:MAX_VALUE_CHARS - 1] + "…"


def fields(rows: List[dict]) -> List[dict]:
    """Fields of the rows' inputs that split them into 2 to MAX_VALUES values, in the order they first appear."""
    names: List[str] = []
    for r in rows:
        state = r.get("row")
        if isinstance(state, dict):
            names.extend(k for k in state if k != LABEL_KEY and k not in names)
    out = []
    for name in names:
        values = {_value(r.get("row"), name) for r in rows}
        if 2 <= len(values) <= MAX_VALUES:
            out.append({"name": name, "values": len(values)})
    return out


def _stats(group: List[dict]) -> dict:
    n = len(group)
    correct = sum(r["correct"] for r in group)
    auto = [r for r in group if r["automated"]]
    auto_correct = sum(r["correct"] for r in auto)
    low, high = calibrate.wilson(correct, n)
    a_low, a_high = calibrate.wilson(auto_correct, len(auto))
    return {
        "rows": n, "correct": correct, "accuracy": correct / n if n else None, "accuracy_low": low, "accuracy_high": high,
        "automated": len(auto), "coverage": len(auto) / n if n else 0.0, "automated_correct": auto_correct,
        "wrong_automated": len(auto) - auto_correct,
        "automated_accuracy": auto_correct / len(auto) if auto else None,
        "automated_low": a_low, "automated_high": a_high,
    }


def worse_p(right: int, n: int, rest_right: int, rest_n: int) -> Optional[float]:
    """One-sided Fisher exact test: the chance that a group of n drawn from all the rows has `right` or fewer right
    rows, if the slice were no worse than the rest. None when either side is empty."""
    if not n or not rest_n:
        return None
    total, total_right = n + rest_n, right + rest_right
    lo = max(0, n - (total - total_right))
    tail = sum(comb(total_right, x) * comb(total - total_right, n - x) for x in range(lo, right + 1))
    return tail / comb(total, n)


def _mark(p: Optional[float]) -> bool:
    return p is not None and p < ALPHA


def evaluate(rows: Any, field: Any = None) -> dict:
    """rows: [{"row": the row's input, "correct": bool, "automated": bool}], one per scored (labeled) row.
    field: the field to slice by. Without one, or when it is not worth slicing in these rows, the first field that is. Returns the fields worth slicing, the
    field used, the overall numbers, and one entry per value, largest first."""
    rows = _rows(rows)
    options = fields(rows)
    if not isinstance(field, str) or field not in {f["name"] for f in options}:  # None, or a field an earlier run had
        field = options[0]["name"] if options else None
    overall = _stats(rows)
    groups: Dict[str, List[dict]] = {}
    if field is not None:
        for r in rows:
            groups.setdefault(_value(r.get("row"), field), []).append(r)
    slices = []
    for value, group in groups.items():
        s = _stats(group)
        rest_n, rest_right = overall["rows"] - s["rows"], overall["correct"] - s["correct"]
        rest_auto = overall["automated"] - s["automated"]
        rest_auto_right = overall["automated_correct"] - s["automated_correct"]
        p_auto = worse_p(s["automated_correct"], s["automated"], rest_auto_right, rest_auto)
        p_all = worse_p(s["correct"], s["rows"], rest_right, rest_n)
        s.update(value=_shown(value), p=p_auto, below=_mark(p_auto), p_all=p_all, below_all=_mark(p_all))
        slices.append(s)
    slices.sort(key=lambda s: (-s["rows"], s["value"] == NONE, s["value"]))
    return {"fields": options, "field": field, "overall": overall, "slices": slices}
