"""Decisions: label the rows an exported gate routed, and add them to the dataset its check is saved with.

A check's gate (jev/checks.py), exported as gate.py or gate.mjs (jev/gate.py), routes rows in an application. Run as a
script, it prints one decision per row as a line of JSON: the route, the held questions, the rules the answers break,
the answers as Calibrate shows them, and the row it was asked about. This module reads those lines back:

  * queue() lists the rows the gate sent to review, and, when asked, an audit sample of the rows it automated, drawn
    at random so the sample stands for every automated row. It leaves out rows the dataset already has.
  * A review row comes with the gated answers that cleared their thresholds as suggested labels. Its held questions, and
    the questions a broken rule reads, start unlabeled: those are the ones the gate could not settle, so a person
    decides them. Questions no gate reads start unlabeled too: the gate never judged them, so a suggestion would only
    copy the model's answer into the labels.
  * An audit row starts with no labels at all. It measures the gate on live traffic only if a person labels it without
    reading the gate's answers first; the Workbench shows them once the row is labeled.
  * append() adds the labeled rows to the dataset, rows and labels only, as every dataset holds, so the check, Policy,
    and Calibrate use them on their next run. For the audit rows among them it reports how often the gate's automated
    decisions were right, with a 95% interval, against the check's accuracy target.

The answers shown come from the user's own gate runs, read from the file they supply; nothing here calls the model.
"""

from __future__ import annotations

import json
import random
from typing import Any, Dict, List, Optional, Tuple

from . import calibrate, csvimport, rules as rulebook, workbench
from .calibrate import CalibrationError
from .workbench import WorkbenchError

MAX_LINES = 5000
MAX_TEXT_CHARS = 5_000_000
MAX_AUDIT = workbench.MAX_BULK_ROWS
PROBLEMS_SHOWN = 20
ROUTES = ("auto", "review")
LABEL_TYPES = ("choice", "noul", "score")  # a Box label is edges, which a gate never answers (it sends no picture)


def _key(row: Any) -> str:
    """One row's identity, labels left out: a text row and {"text": row} are the same row, as Bulk sends them."""
    state = workbench.without_marks(row)  # a test row is the same row
    if isinstance(state, str):
        state = {"text": state}
    return json.dumps(state, sort_keys=True, ensure_ascii=False)


def _check(dataset: dict) -> Tuple[Dict[str, dict], dict]:
    """(questions a label can be given for, check), or WorkbenchError."""
    check = dataset.get("check")
    if not isinstance(check, dict):
        raise WorkbenchError("Dataset %r has no check. Save one from Policy, export it, and route rows with it first."
                             % dataset["id"])
    questions = {q: spec for q, spec in (dataset.get("questions") or {}).items()
                 if isinstance(spec, dict) and spec.get("type") in LABEL_TYPES}
    return questions, check


def _rule_questions(check: dict, questions: Dict[str, dict]) -> Dict[str, List[str]]:
    """{rule text: the questions it reads}, for the check's rules."""
    try:
        parsed = rulebook.parse(check.get("rules"))
    except CalibrationError:
        return {}
    return {r["text"]: list(dict.fromkeys(c[0] for c in r["if"] + r["then"] if c[0] in questions)) for r in parsed}


def label(question: dict, value: Any) -> Tuple[bool, Any]:
    """(ok, label) for a value given as a label or shown as an answer; None is no label."""
    if value is None:
        return True, None
    if question.get("type") == "noul" and isinstance(value, bool):
        return True, value
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return False, None
    ok, out = csvimport.label_value(question, str(value))
    return (ok and out is not None), out


def _decision(line: str, questions: Dict[str, dict]) -> dict:
    """One line of a gate's output, checked, or ValueError with a reason a person can act on."""
    try:
        d = json.loads(line)
    except ValueError:
        raise ValueError("is not JSON")
    if not isinstance(d, dict) or d.get("route") not in ROUTES or not isinstance(d.get("answers"), dict):
        raise ValueError("is not a gate decision: it needs a route of auto or review, and answers")
    row = d.get("row")
    if row is None:
        raise ValueError("has no row. Export the gate again: its script prints each row with its decision")
    if not isinstance(row, dict) or not row or workbench.LABEL_KEY in row:
        raise ValueError("has a row that is not a JSON object of fields")
    try:
        workbench.validate_state(row)
    except WorkbenchError as err:
        raise ValueError("has a row the model cannot be sent: %s" % err)
    unknown = [q for q in d["answers"] if q not in questions]
    if unknown:
        raise ValueError("answers %s, which the dataset's questions do not include. Was it routed by this check's gate?"
                         % ", ".join(unknown[:3]))
    held = d.get("held") or []
    broken = d.get("rules") or []
    if not isinstance(held, list) or not isinstance(broken, list) or not all(isinstance(q, str) for q in held):
        raise ValueError("has held or rules that are not lists of text")
    return {"route": d["route"], "row": row, "answers": d["answers"],
            "held": [q for q in held if q in questions], "rules": [str(r) for r in broken]}


def _lines(text: Any) -> List[str]:
    if not isinstance(text, str) or not text.strip():
        raise WorkbenchError("Paste the gate's decisions, one JSON line per row, as gate.py or gate.mjs prints them")
    if len(text) > MAX_TEXT_CHARS:
        raise WorkbenchError("The decisions are too long (limit %d characters). Split the file." % MAX_TEXT_CHARS)
    lines = text.split("\n")
    if sum(1 for line in lines if line.strip()) > MAX_LINES:
        raise WorkbenchError("Read up to %d decisions at a time. Split the file." % MAX_LINES)
    return lines


def _count(n: Any, what: str, most: int) -> int:
    if isinstance(n, bool) or not isinstance(n, int) or not 0 <= n <= most:
        raise WorkbenchError("%s must be a whole number from 0 to %d" % (what, most))
    return n


def queue(dataset_id: str, text: Any, audit: Any = 0, seed: Any = 0) -> dict:
    """The rows to label from a gate's decisions: every review row, then `audit` automated rows drawn at random.

    Returns {"items", "questions", "gates", "counts", "problems", "problems_total", "room"}. Each item has its "line"
    in the file, "kind" (review or audit), "row", "route", "held", "rules", "answers", "labels" to start from, and
    "open", the questions a person must decide."""
    dataset = workbench.load_dataset(dataset_id)
    questions, check = _check(dataset)
    audit = _count(audit, "audit", MAX_AUDIT)
    seed = _count(seed, "seed", 2 ** 31)
    rule_qids = _rule_questions(check, questions)
    gates = check["gates"]
    have = {_key(r) for r in dataset["rows"]}
    seen = set()
    review: List[dict] = []
    auto: List[dict] = []
    problems: List[dict] = []
    counts = {"decisions": 0, "review": 0, "auto": 0, "in_dataset": 0, "repeated": 0}
    for number, line in enumerate(_lines(text), 1):
        if not line.strip():
            continue
        try:
            d = _decision(line.strip(), questions)
        except ValueError as err:
            problems.append({"line": number, "message": "Line %d %s" % (number, err)})
            continue
        counts["decisions"] += 1
        counts[d["route"]] += 1
        key = _key(d["row"])
        if key in have:
            counts["in_dataset"] += 1
            continue
        if key in seen:
            counts["repeated"] += 1
            continue
        seen.add(key)
        d["line"] = number
        (review if d["route"] == "review" else auto).append(d)
    room = max(0, workbench.MAX_BULK_ROWS - len(dataset["rows"]))
    sampled = random.Random(seed).sample(auto, min(audit, len(auto)))
    sampled.sort(key=lambda d: d["line"])
    waiting = len(review)
    review = review[:workbench.MAX_BULK_ROWS - len(sampled)]  # the audit sample stays whole: it stands for every auto row
    items = []
    for d in review:
        opened = set(d["held"])
        for text_ in d["rules"]:
            opened.update(rule_qids.get(text_, questions))  # a rule this check does not hold: decide every question
        labels = {}
        for qid, question in questions.items():
            # Only a gated answer that cleared its threshold is suggested. A question no gate reads was never judged
            # sure, so suggesting its answer would save the model's answer as a person's label.
            ok, value = label(question, d["answers"].get(qid))
            labels[qid] = value if ok and qid in gates and qid not in opened else None
        needed = [q for q in questions if labels[q] is None and (q in gates or q in opened)]
        items.append(dict(d, kind="review", labels=labels, open=needed))
    for d in sampled:
        items.append(dict(d, kind="audit", labels={q: None for q in questions}, open=list(questions)))
    counts.update({"queued": len(items), "audit": len(sampled), "dropped": waiting - len(review)})
    return {"dataset": workbench.dataset_summary(dataset), "items": items, "questions": questions,
            "gates": check["gates"], "counts": counts, "problems": problems[:PROBLEMS_SHOWN],
            "problems_total": len(problems), "room": room}


def _item(item: Any, number: int, questions: Dict[str, dict]) -> dict:
    """One labeled row to add, checked: {"row", "labels", "kind", "answers"}."""
    if not isinstance(item, dict) or not isinstance(item.get("row"), dict) or not item["row"]:
        raise WorkbenchError("Item %d needs its row, a JSON object of fields" % number)
    row = item["row"]
    if workbench.LABEL_KEY in row:
        raise WorkbenchError("Item %d: the row cannot carry its own %s" % (number, workbench.LABEL_KEY))
    raw = item.get("labels")
    if not isinstance(raw, dict):
        raise WorkbenchError("Item %d needs labels, keyed by question id" % number)
    labels = {}
    for qid, value in raw.items():
        if qid not in questions:
            raise WorkbenchError("Item %d labels %r, which is not one of the dataset's questions" % (number, qid))
        ok, value = label(questions[qid], value)
        if not ok:
            raise WorkbenchError("Item %d: %r is not an answer to %s" % (number, raw[qid], qid))
        if value is not None:
            labels[qid] = value
    if not labels:
        raise WorkbenchError("Item %d has no labels" % number)
    kind = item.get("kind")
    answers = item.get("answers") if isinstance(item.get("answers"), dict) else {}
    return {"row": row, "labels": labels, "kind": kind if kind in ("review", "audit") else "review", "answers": answers}


def audit_report(items: List[dict], questions: Dict[str, dict], check: dict) -> Optional[dict]:
    """How often the gate's automated decisions were right on the audit rows labeled for every gated question.

    A row is right when every gated answer matches its label, as Policy scores it. None without such rows."""
    gates = list(check["gates"])
    scored = [i for i in items if i["kind"] == "audit" and all(q in i["labels"] for q in gates)]
    if not scored:
        return None
    wrong = []
    for i in scored:
        miss = {}
        for q in gates:
            ok, answer = label(questions[q], i["answers"].get(q))
            if not ok or answer is None or answer != i["labels"][q]:
                miss[q] = {"answer": i["answers"].get(q), "label": i["labels"][q]}
        if miss:
            wrong.append({"row": i["row"], "wrong": miss})
    n = len(scored)
    correct = n - len(wrong)
    low, high = calibrate.wilson(correct, n)
    bound = check.get("bound", "estimate")
    target = check.get("min_accuracy")
    return {"rows": n, "correct": correct, "accuracy": correct / n, "accuracy_low": low, "accuracy_high": high,
            "target": target, "bound": bound,
            "ok": None if target is None else calibrate.meets(correct, n, target, bound),
            "wrong": wrong[:PROBLEMS_SHOWN], "wrong_total": len(wrong)}


@workbench.dataset_update()
def append(dataset_id: str, items: Any) -> dict:
    """Add labeled rows to the dataset, rows and labels only, and score the audit rows among them.

    Returns {"dataset": summary, "added", "already", "audit"}. A row the dataset already has is not added twice."""
    dataset = workbench.load_dataset(dataset_id)
    questions, check = _check(dataset)
    if not isinstance(items, list) or not items:
        raise WorkbenchError("Label at least one row to add")
    checked = [_item(item, n, questions) for n, item in enumerate(items, 1)]
    have = {_key(r) for r in dataset["rows"]}
    new, already = [], 0
    for item in checked:
        key = _key(item["row"])
        if key in have:
            already += 1
            continue
        have.add(key)
        new.append(item)
    if len(dataset["rows"]) + len(new) > workbench.MAX_BULK_ROWS:
        raise WorkbenchError("The dataset holds %d rows, and a dataset holds up to %d, the most one Bulk run takes. "
                             "Add at most %d of these %d rows, or save them as a new dataset."
                             % (len(dataset["rows"]), workbench.MAX_BULK_ROWS,
                                max(0, workbench.MAX_BULK_ROWS - len(dataset["rows"])), len(new)))
    rows = dataset["rows"] + [dict(i["row"], **{workbench.LABEL_KEY: i["labels"]}) for i in new]
    dataset["rows"] = workbench.validate_rows(rows)
    workbench.write_dataset(dataset)
    return {"dataset": workbench.dataset_summary(dataset), "added": len(new), "already": already,
            "audit": audit_report(checked, questions, check)}
