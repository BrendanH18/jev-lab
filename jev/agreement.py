"""Label agreement: have a second person label a sample of a dataset's rows, and measure how often the two agree.

Every accuracy the Workbench reports compares the model's answers with labels, so it can only be as good as the
labels are. When two careful people give the same row different labels, the question is ambiguous for people too, and
a measured accuracy near that agreement says as much about the labels as about the model. This module:

  * sample() draws rows at random from a saved dataset's labeled rows and returns them without their labels, so a
    second person can label them blind: in the browser, or in the CSV it writes for a spreadsheet.
  * compare() reads the second labels, from the browser or from that CSV filled in, and reports for each Choice, Noul,
    and Score question how often the two agree, with a 95% interval, and Cohen's kappa, the agreement beyond what
    two people labeling at random with the same label mix would reach. It lists every row where they differ.
  * settle() writes the label a person settles on for each disagreement back to the dataset, rows and labels only.

Rows are matched by a short hash of their content without labels (row_id), so a sample stays valid while the
dataset gains rows, and a row whose content changed is reported as not found rather than matched to another row.
Nothing here calls the model.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import random
from typing import Any, Dict, List, Optional, Tuple

from . import calibrate, csvimport, decisions, workbench
from .workbench import LABEL_KEY, WorkbenchError

TYPES = decisions.LABEL_TYPES  # a Box label is edges, which two people rarely draw identically: not compared here
MAX_SAMPLE = workbench.MAX_BULK_ROWS
ROW_ID = "row_id"
ROW_ID_CHARS = 12
SHOWN = 500  # disagreements listed
PROBLEMS_SHOWN = 20
FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def row_id(row: Any) -> str:
    """A row's identity without its labels, as a short hash: a text row and {"text": row} are the same row."""
    return hashlib.sha1(decisions._key(row).encode("utf-8")).hexdigest()[:ROW_ID_CHARS]


def _questions(dataset: dict) -> Dict[str, dict]:
    questions = {q: spec for q, spec in (dataset.get("questions") or {}).items()
                 if isinstance(spec, dict) and spec.get("type") in TYPES}
    if not questions:
        raise WorkbenchError("Dataset %r has no Choice, Noul, or Score questions saved with it. Save it with its questions "
                             "to compare labels." % dataset["id"])
    return questions


def _labels(row: Any, questions: Dict[str, dict]) -> Dict[str, Any]:
    """A dataset row's valid labels for the questions, {qid: label}. A label that fits no answer is left out."""
    raw = row.get(LABEL_KEY) if isinstance(row, dict) else None
    out = {}
    for qid, value in (raw.items() if isinstance(raw, dict) else ()):
        if qid in questions:
            ok, value = decisions.label(questions[qid], value)
            if ok and value is not None:
                out[qid] = value
    return out


def _state(row: Any) -> Any:
    return workbench.without_marks(row)  # a test row is the same row, and a second labeler need not see the marker


def _index(dataset: dict) -> Dict[str, List[int]]:
    """{row_id: the positions of the dataset rows with that content}."""
    out: Dict[str, List[int]] = {}
    for i, row in enumerate(dataset["rows"]):
        out.setdefault(row_id(row), []).append(i)
    return out


def _count(n: Any, what: str, least: int, most: int) -> int:
    if isinstance(n, bool) or not isinstance(n, int) or not least <= n <= most:
        raise WorkbenchError("%s must be a whole number from %d to %d" % (what, least, most))
    return n


def _cell(value: Any) -> str:
    """A row field as a CSV cell. Text a spreadsheet would run as a formula gets a leading ', so a ticket that starts
    with = opens as text; only row_id and the label columns are read back, so the prefix never reaches a label."""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return "'" + text if isinstance(value, str) and text[:1] in FORMULA_STARTS else text


def sample_csv(items: List[dict], questions: Dict[str, dict]) -> str:
    """The sample as CSV for a spreadsheet: row_id, the row's fields, and an empty label:<id> column per question.

    Rows that are objects of fields get a column per field; otherwise, or when a field is named like a label column, a
    single `row` column holds the row, its text or its JSON. A cell is left as "-" where the first labels have none, since that label is not compared."""
    fields: List[str] = []
    if items and all(isinstance(i["row"], dict) for i in items):
        for item in items:
            fields.extend(k for k in item["row"] if k not in fields)
    if any(f in (ROW_ID, csvimport.ROW_COLUMN) or csvimport._label_target(f) is not None for f in fields):
        fields = []  # a field named like a label column would be read back as one: put each row in one column instead
    names = [ROW_ID] + (fields or [csvimport.ROW_COLUMN]) + ["label:" + q for q in questions]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(names)
    for item in items:
        state = item["row"]
        cells = [_cell(state.get(f, "")) for f in fields] if fields else [_cell(state)]
        writer.writerow([item[ROW_ID]] + cells + ["" if q in item["questions"] else "-" for q in questions])
    return out.getvalue()


def sample(dataset_id: str, n: Any = 30, seed: Any = 0) -> dict:
    """Up to `n` labeled rows drawn at random, in dataset order, without their labels.

    Returns {"dataset", "questions", "items", "eligible", "csv"}. Each item has its "row_id", 1-based "number" in the
    dataset, "row" (without labels), and "questions", the ones its first labels cover, which are the ones compared."""
    dataset = workbench.load_dataset(dataset_id)
    questions = _questions(dataset)
    n = _count(n, "rows", 1, MAX_SAMPLE)
    seed = _count(seed, "seed", 0, 2 ** 31)
    eligible, seen = [], set()
    for number, row in enumerate(dataset["rows"], 1):
        labels = _labels(row, questions)
        rid = row_id(row)
        if labels and rid not in seen:  # a row saved twice is drawn once
            seen.add(rid)
            eligible.append({ROW_ID: rid, "number": number, "row": _state(row), "questions": list(labels)})
    if not eligible:
        raise WorkbenchError("Dataset %r has no labeled rows to compare. Label some rows and save them first." % dataset_id)
    items = sorted(random.Random(seed).sample(eligible, min(n, len(eligible))), key=lambda i: i["number"])
    return {"dataset": workbench.dataset_summary(dataset), "questions": questions, "items": items,
            "eligible": len(eligible), "csv": sample_csv(items, questions)}


def _from_csv(text: Any, questions: Dict[str, dict]) -> Tuple[List[dict], List[str]]:
    """([{"row_id", "labels"}], problems) from the sample CSV filled in. Columns are found by name, as Import does."""
    _delimiter, names, rows = csvimport.parse(text)
    if ROW_ID not in names:
        raise WorkbenchError("The CSV has no %s column. Fill in the CSV that Download CSV wrote, keeping its %s column."
                             % (ROW_ID, ROW_ID))
    roles = csvimport.suggest(names, questions)
    targets = {name: role[len("label:"):] for name, role in roles.items() if role.startswith("label:")}
    if not targets:
        raise WorkbenchError("The CSV has no label columns. Name them label:<question id>, as Download CSV does.")
    at = names.index(ROW_ID)
    items, problems = [], []
    for line, cells in enumerate(rows, 2):
        labels = {}
        for name, qid in targets.items():
            cell = cells[names.index(name)]
            if cell.strip() == "-":
                continue  # the download's mark for a label the first labels do not have
            ok, value = csvimport.label_value(questions[qid], cell)
            if not ok:
                problems.append("Line %d: %r is not an answer to %s" % (line, cell.strip(), qid))
            elif value is not None:
                labels[qid] = value
        items.append({ROW_ID: cells[at].strip(), "labels": labels})
    return items, problems


def _from_items(items: Any, questions: Dict[str, dict]) -> Tuple[List[dict], List[str]]:
    if not isinstance(items, list):
        raise WorkbenchError("items must be a list of rows, each with its row_id and labels")
    out, problems = [], []
    for number, item in enumerate(items, 1):
        if not isinstance(item, dict) or not isinstance(item.get(ROW_ID), str) or not isinstance(item.get("labels"), dict):
            raise WorkbenchError("Item %d needs its row_id and labels, keyed by question id" % number)
        labels = {}
        for qid, value in item["labels"].items():
            if qid not in questions:
                raise WorkbenchError("Item %d labels %r, which is not one of the dataset's questions" % (number, qid))
            ok, value = decisions.label(questions[qid], value)
            if not ok:
                problems.append("Item %d: %r is not an answer to %s" % (number, item["labels"][qid], qid))
            elif value is not None:
                labels[qid] = value
        out.append({ROW_ID: item[ROW_ID], "labels": labels})
    return out, problems


def kappa(pairs: List[Tuple[Any, Any]]) -> Optional[float]:
    """Cohen's kappa for (first, second) label pairs: (observed - chance) / (1 - chance), where chance is the agreement
    two labelers would reach by labeling independently with these label mixes. None without pairs, or when chance is 1
    (both gave every row one same label, so agreement beyond chance cannot be measured)."""
    n = len(pairs)
    if not n:
        return None
    observed = sum(1 for a, b in pairs if a == b) / n
    firsts: Dict[str, int] = {}
    seconds: Dict[str, int] = {}
    for a, b in pairs:
        firsts[json.dumps(a)] = firsts.get(json.dumps(a), 0) + 1
        seconds[json.dumps(b)] = seconds.get(json.dumps(b), 0) + 1
    chance = sum(count * seconds.get(k, 0) for k, count in firsts.items()) / (n * n)
    if chance >= 1 - 1e-12:
        return None
    return (observed - chance) / (1 - chance)


def _question_report(pairs: List[Tuple[Any, Any]]) -> dict:
    n = len(pairs)
    agree = sum(1 for a, b in pairs if a == b)
    low, high = calibrate.wilson(agree, n)
    mixups: Dict[str, dict] = {}
    for a, b in pairs:
        if a != b:
            key = json.dumps([a, b])
            mixups.setdefault(key, {"first": a, "second": b, "rows": 0})["rows"] += 1
    return {"rows": n, "agree": agree, "agreement": agree / n if n else None, "low": low, "high": high,
            "kappa": kappa(pairs), "mixups": sorted(mixups.values(), key=lambda m: -m["rows"])}


def compare(dataset_id: str, items: Any = None, text: Any = None) -> dict:
    """Compare second labels, as `items` from the browser or the sample CSV filled in as `text`, with the dataset's.

    Returns {"questions": {qid: {"rows", "agree", "agreement", "low", "high", "kappa", "mixups"}}, "overall",
    "disagreements", "counts", "problems"}. Only labels both sides gave are compared."""
    dataset = workbench.load_dataset(dataset_id)
    questions = _questions(dataset)
    if text is not None:
        second, problems = _from_csv(text, questions)
    else:
        second, problems = _from_items(items, questions)
    if not second:
        raise WorkbenchError("No rows to compare: label the sample first")
    where = _index(dataset)
    pairs: Dict[str, List[Tuple[Any, Any]]] = {q: [] for q in questions}
    disagreements = []
    counts = {"rows": len(second), "matched": 0, "not_found": 0, "repeated": 0, "unlabeled": 0, "compared": 0,
              "all_agree": 0, "only_second": 0}
    done = set()
    for item in second:
        rid = item[ROW_ID]
        if rid not in where:
            counts["not_found"] += 1
            continue
        if rid in done:
            counts["repeated"] += 1
            continue
        done.add(rid)
        counts["matched"] += 1
        # The labeled copy, as sample() draws it: an unlabeled copy saved earlier would leave nothing to compare.
        index = next((i for i in where[rid] if _labels(dataset["rows"][i], questions)), where[rid][0])
        first = _labels(dataset["rows"][index], questions)
        shared = [q for q in questions if q in first and q in item["labels"]]
        counts["only_second"] += sum(1 for q in item["labels"] if q not in first)
        if not shared:
            counts["unlabeled"] += 1
            continue
        counts["compared"] += 1
        differ = False
        for qid in shared:
            pairs[qid].append((first[qid], item["labels"][qid]))
            if first[qid] != item["labels"][qid]:
                differ = True
                disagreements.append({ROW_ID: rid, "number": index + 1, "row": _state(dataset["rows"][index]),
                                      "question": qid, "first": first[qid], "second": item["labels"][qid]})
        counts["all_agree"] += 0 if differ else 1
    report = {q: _question_report(p) for q, p in pairs.items() if p}
    every = [pair for p in pairs.values() for pair in p]
    agree = sum(1 for a, b in every if a == b)
    low, high = calibrate.wilson(counts["all_agree"], counts["compared"])
    overall = {"labels": len(every), "agree": agree, "agreement": agree / len(every) if every else None,
               "rows": counts["compared"], "rows_agree": counts["all_agree"],
               "rows_agreement": counts["all_agree"] / counts["compared"] if counts["compared"] else None,
               "rows_low": low, "rows_high": high}
    return {"dataset": workbench.dataset_summary(dataset), "questions": report, "overall": overall,
            "disagreements": disagreements[:SHOWN], "disagreements_total": len(disagreements), "counts": counts,
            "problems": problems[:PROBLEMS_SHOWN], "problems_total": len(problems)}


@workbench.dataset_update()
def settle(dataset_id: str, items: Any) -> dict:
    """Write settled labels to the dataset: items [{"row_id", "labels": {qid: label, or None to remove it}}].

    Every row with that content gets the label. Returns {"dataset": summary, "changed", "rows"}; a label equal to the
    saved one is not counted as a change."""
    dataset = workbench.load_dataset(dataset_id)
    questions = _questions(dataset)
    if not isinstance(items, list) or not items:
        raise WorkbenchError("Settle at least one label")
    where = _index(dataset)
    rows = list(dataset["rows"])
    changed, touched = 0, set()
    for number, item in enumerate(items, 1):
        if not isinstance(item, dict) or not isinstance(item.get(ROW_ID), str) or not isinstance(item.get("labels"), dict):
            raise WorkbenchError("Item %d needs its row_id and labels, keyed by question id" % number)
        if item[ROW_ID] not in where:
            raise WorkbenchError("Item %d names a row the dataset no longer has. Compare the labels again." % number)
        for qid, value in item["labels"].items():
            if qid not in questions:
                raise WorkbenchError("Item %d labels %r, which is not one of the dataset's questions" % (number, qid))
            ok, value = decisions.label(questions[qid], value)
            if not ok:
                raise WorkbenchError("Item %d: %r is not an answer to %s" % (number, item["labels"][qid], qid))
            for index in where[item[ROW_ID]]:
                row = rows[index]
                if isinstance(row, list):
                    raise WorkbenchError("Row %d is a JSON array, which cannot carry labels" % (index + 1))
                state = row if isinstance(row, dict) else {"text": row}
                labels = dict(state.get(LABEL_KEY) or {})
                if labels.get(qid) == value and (value is not None or qid not in labels):
                    continue
                if value is None:
                    labels.pop(qid, None)
                else:
                    labels[qid] = value
                row = {k: v for k, v in state.items() if k != LABEL_KEY}
                if labels:
                    row[LABEL_KEY] = labels
                rows[index] = row
                changed += 1
                touched.add(index)
    if changed:
        dataset["rows"] = workbench.validate_rows(rows)
        workbench.write_dataset(dataset)
    return {"dataset": workbench.dataset_summary(dataset), "changed": changed, "rows": len(touched)}
