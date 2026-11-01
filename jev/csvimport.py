"""Import CSV: turn a spreadsheet into Bulk rows, with label columns as `_expect` labels.

Labeled data usually lives in a spreadsheet. This module reads CSV (or tab- or semicolon-separated) text whose
first line names the columns, and gives each column a use:

- "state": a field of the row the model sees. The row is an object of its state columns, so a question can
  name a field. When the only state column is `row`, as in the Workbench's own CSV download, each cell is the
  row itself: a JSON object or array when the cell holds one, its text otherwise.
- "label:<question id>": the cell is that question's label. It goes under `_expect`, which Bulk removes before
  the call, so the model never sees it.
- "skip": left out.

Without a choice, a column named `label:<id>`, `expect:<id>`, or `_expect.<id>` labels that question, and a
column named exactly like a question labels it too, unless a `label:` column for the same question exists (the
Workbench's download names its answer columns by question ID). Every other column is state.

Labels are checked against the questions: a Choice label must name an option (case and surrounding spaces are
forgiven when only one option matches), a Noul label is yes/no, true/false, y/n, or 1/0, and a Score label is a
level number. A value that fits none is left out of the row and counted, so the import can show it. Nothing here
calls the model.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Dict, List, Optional, Tuple

from .workbench import LABEL_KEY, MAX_BULK_ROWS, MAX_DATASET_CHARS, WorkbenchError, validate_questions

MAX_COLUMNS = 100
SAMPLES = 3  # sample values shown per column
LABEL_PREFIXES = ("label:", "expect:", "_expect.")
ROW_COLUMN = "row"
YES = {"yes", "true", "y", "1"}
NO = {"no", "false", "n", "0"}


def _delimiter(text: str) -> str:
    """Comma, tab, or semicolon: the one the header line holds most of, outside quotes. Comma on a tie."""
    head = next((line for line in text.split("\n") if line.strip()), "")  # parse() skips blank lines too
    counts = {",": 0, "\t": 0, ";": 0}
    quoted = False
    for ch in head:
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch in counts:
            counts[ch] += 1
    best = max(counts, key=lambda d: (counts[d], d == ","))
    return best if counts[best] else ","


def _header(names: List[str]) -> List[str]:
    """Trimmed column names, with a name for blank ones and a suffix for repeats, so every column is addressable."""
    out: List[str] = []
    seen = set()
    for i, raw in enumerate(names):
        base = raw.strip() or "column_%d" % (i + 1)
        name, n = base, 2
        while name in seen:
            name, n = "%s_%d" % (base, n), n + 1
        seen.add(name)
        out.append(name)
    return out


def parse(text: Any) -> Tuple[str, List[str], List[List[str]]]:
    """(delimiter, column names, data rows). Rows are padded or cut to the header's width; blank lines are dropped."""
    if not isinstance(text, str):
        raise WorkbenchError("text must be the CSV as a string")
    if len(text) > MAX_DATASET_CHARS:
        raise WorkbenchError("The CSV is too large (limit %d characters)" % MAX_DATASET_CHARS)
    text = text.lstrip("﻿")  # a byte-order mark from a spreadsheet's "CSV UTF-8" export
    if not text.strip():
        raise WorkbenchError("The CSV is empty")
    delimiter = _delimiter(text)
    try:
        lines = [r for r in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter) if any(c.strip() for c in r)]
    except csv.Error as e:
        raise WorkbenchError("Could not read the CSV: %s" % e)
    if not lines:
        raise WorkbenchError("The CSV is empty")
    if len(lines[0]) > MAX_COLUMNS:
        raise WorkbenchError("At most %d columns" % MAX_COLUMNS)
    names = _header(lines[0])
    width = len(names)
    rows = [(r + [""] * width)[:width] for r in lines[1:]]
    return delimiter, names, rows


def _label_target(name: str) -> Optional[str]:
    low = name.lower()
    for prefix in LABEL_PREFIXES:
        if low.startswith(prefix) and len(name) > len(prefix):
            return name[len(prefix):].strip()
    return None


def _question(name: Optional[str], questions: Dict[str, dict]) -> Optional[str]:
    """The question a column name names: exactly, or ignoring case and spaces when only one question matches."""
    if name is None or name in questions:
        return name
    folded = [q for q in questions if q.lower() == name.strip().lower()]
    return folded[0] if len(folded) == 1 else None


def _base(name: str, earlier: List[str]) -> str:
    """The header a repeated column had before _header() added its suffix."""
    head, _, n = name.rpartition("_")
    return head if n.isdigit() and head in earlier else name


def suggest(names: List[str], questions: Dict[str, dict]) -> Dict[str, str]:
    """A use for every column, from its name alone. A repeated header is read as the header it repeats, so a second
    label column for a question is skipped rather than shown to the model."""
    bases = [_base(n, names[:i]) for i, n in enumerate(names)]
    prefixed = {_question(_label_target(n), questions) for n in bases} - {None}
    roles = {}
    for name, base in zip(names, bases):
        target = _question(_label_target(base), questions)
        plain = _question(base, questions)
        if target:
            role = "label:" + target
        elif plain and plain not in prefixed:
            role = "label:" + plain
        elif plain:
            role = "skip"  # the download's answer column; its label column is beside it
        else:
            role = "state"
        # A second column naming the same question is skipped: it names a question, so it is not for the model.
        roles[name] = "skip" if role.startswith("label:") and role in roles.values() else role
    return roles


def _roles(names: List[str], questions: Dict[str, dict], chosen: Any) -> Dict[str, str]:
    if chosen is None:
        chosen = {}
    if not isinstance(chosen, dict):
        raise WorkbenchError("columns must map column names to a use")
    roles = suggest(names, questions)
    for name, role in chosen.items():
        if name not in roles:
            continue  # a column from an earlier file; the new one does not have it
        if isinstance(role, str) and role.startswith("label:"):
            if role[len("label:"):] not in questions:
                continue  # a label for a question no longer being run: keep the suggestion
        elif role not in ("state", "skip"):
            raise WorkbenchError("Column %r: use must be state, skip, or label:<question id>" % name)
        roles[name] = role
    for name, role in list(roles.items()):
        # A column chosen as a question's label takes it over from a column only suggested for it.
        if name not in chosen and role.startswith("label:") and role in [chosen.get(n) for n in roles]:
            roles[name] = "skip"
    targets = [r for r in roles.values() if r.startswith("label:")]
    for target in targets:
        if targets.count(target) > 1:
            raise WorkbenchError("Two columns label %r; choose one" % target[len("label:"):])
    return roles


def label_value(question: dict, cell: str) -> Tuple[bool, Any]:
    """(ok, label) for one cell. An empty cell is (True, None): no label. A value that does not fit is (False, None)."""
    value = cell.strip()
    if not value:
        return True, None
    qtype = question.get("type")
    if qtype == "noul":
        low = value.lower()
        return (True, True) if low in YES else (True, False) if low in NO else (False, None)
    if qtype == "score":
        try:
            level = float(value)
        except ValueError:
            return False, None
        ok = 0 <= level < len(question.get("criteria") or []) and level == int(level)  # NaN fails the range
        return (True, int(level)) if ok else (False, None)
    if qtype == "choice":
        options = list(question.get("criteria") or {})
        if value in options:
            return True, value
        folded = [o for o in options if o.strip().lower() == value.lower()]
        return (True, folded[0]) if len(folded) == 1 else (False, None)
    return False, None  # Box answers are edges, which a CSV cell does not label


def _row_cell(cell: str) -> Any:
    """A cell from the download's `row` column: the row it was, a JSON object or array, or its text."""
    t = cell.strip()
    if t[:1] in ("{", "["):
        try:
            value = json.loads(t)
        except ValueError:
            return cell
        if isinstance(value, (dict, list)):
            return value
    return cell


def convert(text: Any, questions: Any = None, columns: Any = None) -> dict:
    """Read the CSV and build Bulk rows. Returns the columns with their uses and sample values, the rows (the first
    MAX_BULK_ROWS that have state), and counts of rows left out and labeled, and of label values that did not fit.
    Only kept rows are checked and counted."""
    qs = validate_questions(questions) if questions else {}
    gateable = {q: v for q, v in qs.items() if v.get("type") in ("choice", "noul", "score")}
    delimiter, names, data = parse(text)
    roles = _roles(names, gateable, columns)
    state_cols = [i for i, n in enumerate(names) if roles[n] == "state"]
    label_cols = [(i, roles[n][len("label:"):]) for i, n in enumerate(names) if roles[n].startswith("label:")]
    whole_row = len(state_cols) == 1 and names[state_cols[0]] == ROW_COLUMN

    rows: List[Any] = []
    empty = dropped = 0
    labels = {q: 0 for _, q in label_cols}
    bad: Dict[Tuple[str, str], int] = {}
    for cells in data:
        if whole_row:
            cell = cells[state_cols[0]]
            row: Any = _row_cell(cell) if cell.strip() else None
        else:
            row = {names[i]: cells[i] for i in state_cols if cells[i].strip()} or None
        if row is None:
            empty += 1
            continue
        if len(rows) >= MAX_BULK_ROWS:
            dropped += 1
            continue
        expect = {}
        for i, qid in label_cols:
            ok, value = label_value(gateable[qid], cells[i])
            if not ok:
                key = (names[i], cells[i].strip())
                bad[key] = bad.get(key, 0) + 1
            elif value is not None:
                expect[qid] = value
                labels[qid] += 1
        if expect:
            if isinstance(row, list):
                raise WorkbenchError("Rows that are JSON arrays cannot carry labels. Wrap each one in an object first.")
            if isinstance(row, str):
                row = {"text": row}
            prior = row.get(LABEL_KEY)
            row = {**row, LABEL_KEY: {**(prior if isinstance(prior, dict) else {}), **expect}}
        rows.append(row)

    problems = [{"column": c, "question": roles[c][len("label:"):], "value": v, "rows": n}
                for (c, v), n in sorted(bad.items(), key=lambda kv: (-kv[1], kv[0]))]
    return {
        "delimiter": {",": "comma", "\t": "tab", ";": "semicolon"}[delimiter],
        "columns": [{"name": n, "use": roles[n], "samples": [r[i] for r in data if r[i].strip()][:SAMPLES]}
                    for i, n in enumerate(names)],
        "rows": rows,
        "dropped": dropped,
        "empty": empty,
        "labeled": sum(1 for r in rows if isinstance(r, dict) and r.get(LABEL_KEY)),
        "labels": labels,
        "problems": problems,
    }
