"""Workbench: write your own state and questions, save them as tests, run them in bulk, export code.

This is the part of Jev Lab that turns "cool demo" into "how do I build with this". A workbench
item is plain JSON: a state, a map of questions, and optional expectations. Items are saved under
data/workbench/ so they can be committed with a project like any other test fixture. Pictures an
item uses are saved beside it in data/workbench/images/, named by a hash of their bytes. Bulk rows and
their labels can be saved as datasets in data/workbench/datasets/.
"""

from __future__ import annotations

import json
import re
import statistics
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import compare, images, orders, perturb
from .client import JevClient, JevError, pin_note
from .config import SAMPLES_DIR, WORKBENCH_DIR

MAX_QUESTIONS = 100
MAX_CHOICE_OPTIONS = 255
MAX_SCORE_LEVELS = 25
MAX_STATE_CHARS = 120_000
MAX_BULK_ROWS = 200
MAX_DATASET_CHARS = 2_000_000
BULK_CONCURRENCY = 8
SLUG = re.compile(r"[^a-z0-9]+")
IMAGE_FILE = re.compile(r"[0-9a-f]{16}\.(png|jpg)")
QUESTION_TYPES = ("noul", "choice", "score", "box")
LABEL_KEY = "_expect"  # a bulk row's labels: removed before the call, returned beside the answers


class WorkbenchError(ValueError):
    pass


# --- validation ----------------------------------------------------------------------------


def validate_questions(questions: Any) -> Dict[str, dict]:
    if not isinstance(questions, dict) or not questions:
        raise WorkbenchError("questions must be a non-empty object keyed by question id")
    if len(questions) > MAX_QUESTIONS:
        raise WorkbenchError("At most %d questions per request" % MAX_QUESTIONS)
    out: Dict[str, dict] = {}
    for qid, q in questions.items():
        if not isinstance(qid, str) or not qid.strip():
            raise WorkbenchError("Question ids must be non-empty strings")
        if not isinstance(q, dict):
            raise WorkbenchError("Question %r must be an object" % qid)
        qtype = q.get("type")
        if qtype not in QUESTION_TYPES:
            raise WorkbenchError("Question %r: type must be noul, choice, score, or box" % qid)
        clean: dict = {"type": qtype}
        if q.get("instructions") in (None, ""):
            raise WorkbenchError("Question %r needs instructions" % qid)
        clean["instructions"] = q["instructions"]
        criteria = q.get("criteria")
        if qtype == "choice":
            if not isinstance(criteria, dict) or not criteria:
                raise WorkbenchError("Question %r: choice criteria must be an object of option -> description" % qid)
            if len(criteria) > MAX_CHOICE_OPTIONS:
                raise WorkbenchError("Question %r: at most %d options" % (qid, MAX_CHOICE_OPTIONS))
            clean["criteria"] = criteria
        elif qtype == "score":
            if not isinstance(criteria, list) or len(criteria) < 2:
                raise WorkbenchError("Question %r: score criteria must be a list of at least two levels" % qid)
            if len(criteria) > MAX_SCORE_LEVELS:
                raise WorkbenchError("Question %r: at most %d levels" % (qid, MAX_SCORE_LEVELS))
            clean["criteria"] = criteria
        elif qtype == "box":
            if criteria not in (None, {}, []):
                raise WorkbenchError("Question %r: box questions take no criteria" % qid)
        else:
            if criteria not in (None, {}):
                if not isinstance(criteria, dict) or not set(criteria) <= {"true", "false"}:
                    raise WorkbenchError("Question %r: noul criteria may only have true/false keys" % qid)
                clean["criteria"] = criteria
        out[qid.strip()] = clean
    return out


def validate_state(state: Any) -> Any:
    if state is None or state == "":
        raise WorkbenchError("state is required")
    if len(json.dumps(state)) > MAX_STATE_CHARS:
        raise WorkbenchError("state is too large (limit %d characters as JSON)" % MAX_STATE_CHARS)
    return state


def has_box(questions: Dict[str, dict]) -> bool:
    return any(q["type"] == "box" for q in questions.values())


def request_images(state: Any, questions: Dict[str, dict], specs: Any) -> Dict[str, dict]:
    """Validated assets for a request. Every image must be referenced; a Box question needs one."""
    try:
        assets = images.parse_images(specs)
    except images.ImageError as err:
        raise WorkbenchError(str(err)) from err
    unused = images.unreferenced(assets, state, questions)
    if unused:
        raise WorkbenchError("Image %s is not referenced. Put its reference in the state or a question, "
                             "or remove it." % unused[0])
    if has_box(questions) and not assets:
        raise WorkbenchError("Box questions need an image. Add one under Images and reference it in the state.")
    return assets


def run(client: JevClient, state: Any, questions: Any, image_specs: Any = None) -> dict:
    state, questions = validate_state(state), validate_questions(questions)
    assets = request_images(state, questions, image_specs)
    result = client.system_one(state, questions, assets=assets or None)
    return {"answers": result.answers, "meta": result.meta(), "trace": result.trace()}


# --- expectations --------------------------------------------------------------------------


EDGES = ("left", "top", "right", "bottom")


def iou(a: dict, b: dict) -> float:
    """Intersection over union of two boxes given as edge fractions: 1 is identical, 0 is disjoint."""
    w = max(0.0, min(a["right"], b["right"]) - max(a["left"], b["left"]))
    h = max(0.0, min(a["bottom"], b["bottom"]) - max(a["top"], b["top"]))
    inter = w * h
    area = lambda e: max(0.0, e["right"] - e["left"]) * max(0.0, e["bottom"] - e["top"])  # noqa: E731
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0


def check_expectation(answer: dict, expect: dict) -> dict:
    """expect examples: {"choice": "billing"}, {"min": 0.7}, {"max": 0.3}, {"min": 1, "max": 2},
    and for a Box {"box": {"left": .., "top": .., "right": .., "bottom": ..}, "iou_min": 0.5}."""
    checks: List[str] = []
    ok = True
    if answer["type"] == "box":
        if "box" not in expect:
            return {"ok": True, "checks": ["no box expected"]}
        overlap = iou({k: float(answer["box"][k]) for k in EDGES}, {k: float(expect["box"][k]) for k in EDGES})
        floor = float(expect.get("iou_min", 0.5))
        hit = overlap >= floor
        return {"ok": hit, "checks": ["IoU %.2f %s %.2f" % (overlap, "≥" if hit else "<", floor)]}
    if answer["type"] == "choice":
        value = answer["choice"]
        if "choice" in expect:
            hit = value == expect["choice"]
            ok &= hit
            checks.append("choice %s %s" % ("=" if hit else "≠", expect["choice"]))
        prob = float(answer.get("probabilities", {}).get(value, 0.0))
        target = prob
    elif answer["type"] == "score":
        target = float(answer["score"])
    else:
        target = float(answer["noul"])
    if "min" in expect:
        hit = target >= float(expect["min"])
        ok &= hit
        checks.append("%.2f %s %.2f" % (target, "≥" if hit else "<", float(expect["min"])))
    if "max" in expect:
        hit = target <= float(expect["max"])
        ok &= hit
        checks.append("%.2f %s %.2f" % (target, "≤" if hit else ">", float(expect["max"])))
    return {"ok": bool(ok), "checks": checks}


def default_expectation(answer: dict) -> dict:
    """A sensible expectation from an answer you have looked at and agree with."""
    if answer["type"] == "choice":
        return {"choice": answer["choice"]}
    if answer["type"] == "box":
        return {"box": {k: round(float(answer["box"][k]), 3) for k in EDGES}, "iou_min": 0.5}
    if answer["type"] == "score":
        s = float(answer["score"])
        return {"min": round(max(0.0, s - 0.5), 2), "max": round(s + 0.5, 2)}
    return {"min": 0.5} if float(answer["noul"]) >= 0.5 else {"max": 0.5}


# --- saved items ---------------------------------------------------------------------------


def slugify(name: str) -> str:
    slug = SLUG.sub("-", name.lower()).strip("-")[:60]
    if not slug:
        raise WorkbenchError("Give the item a name")
    return slug


def _path(item_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]{1,60}", item_id or ""):
        raise WorkbenchError("Invalid item id")
    return WORKBENCH_DIR / (item_id + ".json")


def images_dir() -> Path:
    return WORKBENCH_DIR / "images"


def _store_images(state: Any, questions: Dict[str, dict], specs: Any) -> Dict[str, dict]:
    """Keep samples by name; write uploads to images/<hash>.<format> so the JSON stays small."""
    stored = {}
    for ref, entry in request_images(state, questions, specs).items():
        if entry.get("sample"):
            stored[ref] = {"sample": entry["sample"]}
            continue
        name = "%s.%s" % (entry["sha"], entry["format"])
        images_dir().mkdir(parents=True, exist_ok=True)
        path = images_dir() / name
        if not path.exists():
            path.write_bytes(entry["data"])
        stored[ref] = {"file": name}
    return stored


def item_image(spec: dict) -> dict:
    """An asset entry for one saved image reference."""
    if spec.get("file"):
        if not IMAGE_FILE.fullmatch(str(spec["file"])):
            raise WorkbenchError("Invalid image file name")
        try:
            return images.asset((images_dir() / spec["file"]).read_bytes())
        except FileNotFoundError:
            raise WorkbenchError("Missing image data/workbench/images/%s" % spec["file"])
    return images.parse_upload(spec)


def item_images(item: dict) -> Dict[str, dict]:
    return {ref: item_image(spec) for ref, spec in (item.get("images") or {}).items()}


def item_images_for_browser(item: dict) -> Dict[str, dict]:
    """What the Workbench needs to show and resend a saved item's pictures."""
    out = {}
    for ref, spec in (item.get("images") or {}).items():
        if spec.get("sample"):
            out[ref] = {"sample": spec["sample"]}
        else:
            entry = item_image(spec)
            out[ref] = {"format": entry["format"], "data_base64": images.wire_asset(entry)["data_base64"]}
    return out


def save_item(spec: dict) -> dict:
    name = (spec.get("name") or "").strip()
    state, questions = validate_state(spec.get("state")), validate_questions(spec.get("questions"))
    item = {
        "id": spec.get("id") or slugify(name),
        "name": name or spec.get("id"),
        "notes": (spec.get("notes") or "")[:2000],
        "state": state,
        "questions": questions,
        "expect": spec.get("expect") or {},
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if not isinstance(item["expect"], dict):
        raise WorkbenchError("expect must be an object keyed by question id")
    stored = _store_images(state, questions, spec.get("images"))
    if stored:
        item["images"] = stored
    path = _path(item["id"])
    WORKBENCH_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(item, indent=2, ensure_ascii=False) + "\n")
    return item


def list_items() -> List[dict]:
    items = []
    if WORKBENCH_DIR.exists():
        for path in sorted(WORKBENCH_DIR.glob("*.json")):
            try:
                items.append(json.loads(path.read_text()))
            except ValueError:
                continue
    return items


def load_item(item_id: str) -> dict:
    try:
        return json.loads(_path(item_id).read_text())
    except FileNotFoundError:
        raise WorkbenchError("No saved item %r" % item_id)


def delete_item(item_id: str) -> bool:
    path = _path(item_id)
    if path.exists():
        path.unlink()
        return True
    return False


# --- saved datasets ------------------------------------------------------------------------
# A dataset is Bulk rows and their `_expect` labels, and optionally the question set the labels are for,
# saved as data/workbench/datasets/<id>.json so labels outlast a reload and can be committed. It holds
# inputs and labels only: answers are never saved, so every answer the Bulk tab shows comes from a run.


def datasets_dir() -> Path:
    return WORKBENCH_DIR / "datasets"


def _dataset_path(dataset_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]{1,60}", dataset_id or ""):
        raise WorkbenchError("Invalid dataset id")
    return datasets_dir() / (dataset_id + ".json")


def validate_rows(rows: Any) -> List[Any]:
    """Rows as Bulk takes them: text (one row per line) or a list. Empty rows are dropped."""
    if isinstance(rows, str):
        rows = parse_rows(rows)
    if not isinstance(rows, list):
        raise WorkbenchError("rows must be text or a list")
    rows = [r for r in rows if r not in (None, "")]
    if not rows:
        raise WorkbenchError("No rows to save")
    if len(rows) > MAX_BULK_ROWS:
        raise WorkbenchError("A dataset holds up to %d rows, the most one Bulk run takes; this has %d. "
                             "Split the rows into several datasets." % (MAX_BULK_ROWS, len(rows)))
    for number, row in enumerate(rows, 1):
        if not isinstance(row, (str, dict, list)):
            raise WorkbenchError("Row %d must be text, a JSON object, or a JSON array" % number)
        state, _labels = split_labels(row, number)
        try:
            validate_state(state)
        except WorkbenchError as err:
            raise WorkbenchError("Row %d: %s" % (number, err))
    return rows


def dataset_summary(dataset: dict) -> dict:
    """What the dataset list shows: the counts, without the rows."""
    rows = dataset.get("rows") or []
    labeled: Dict[str, int] = {}
    labeled_rows = 0
    for row in rows:
        labels = row.get(LABEL_KEY) if isinstance(row, dict) else None
        if isinstance(labels, dict) and any(v is not None for v in labels.values()):
            labeled_rows += 1
            for qid, value in labels.items():
                if value is not None:
                    labeled[qid] = labeled.get(qid, 0) + 1
    check = dataset.get("check")
    check = check if isinstance(check, dict) else None
    pin = pin_note(str(check.get("model") or ""), check.get("tuned_on")) if check else None
    return {"id": dataset.get("id"), "name": dataset.get("name"), "notes": dataset.get("notes", ""),
            "saved_at": dataset.get("saved_at"), "rows": len(rows), "labeled": labeled_rows, "labels": labeled,
            "questions": len(dataset.get("questions") or {}), "check": check, "check_notes": [pin] if pin else []}


def _dataset_text(dataset: dict) -> str:
    """Pretty JSON with one row per line, so a labeling change is a one-line diff."""
    head = json.dumps({k: v for k, v in dataset.items() if k != "rows"}, indent=2, ensure_ascii=False)
    rows = ",\n".join("    " + json.dumps(row, ensure_ascii=False) for row in dataset["rows"])
    return head[:-2] + ',\n  "rows": [\n' + rows + "\n  ]\n}\n"


def write_dataset(dataset: dict) -> None:
    """Replace data/workbench/datasets/<id>.json with `dataset`, atomically."""
    text = _dataset_text(dataset)
    if len(text) > MAX_DATASET_CHARS:
        raise WorkbenchError("The dataset is too large to save (limit %d characters as JSON)" % MAX_DATASET_CHARS)
    path = _dataset_path(dataset["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name("%s.%d.partial" % (path.name, threading.get_ident()))  # one per concurrent save
    partial.write_text(text, encoding="utf-8")
    partial.replace(path)


def _prior_check(dataset_id: str) -> Any:
    """The check saved in the dataset file this save replaces, or None."""
    try:
        check = json.loads(_dataset_path(dataset_id).read_text(encoding="utf-8")).get("check")
    except (OSError, ValueError, AttributeError):
        return None
    return check if isinstance(check, dict) else None


def save_dataset(spec: dict) -> dict:
    """Write a dataset named spec["name"]; a dataset with the same id is replaced.

    A check saved in the file it replaces (jev/checks.py) is kept while it still fits the questions saved
    now, so adding rows or labels keeps it. Otherwise it is dropped and the returned dataset says why under
    "check_dropped" (not written to the file)."""
    from . import checks  # checks imports this module

    name = str(spec.get("name") or "").strip()[:120]
    if not SLUG.sub("", name.lower()):
        raise WorkbenchError("Give the dataset a name")
    dataset = {"id": slugify(name), "name": name, "notes": str(spec.get("notes") or "")[:2000],
               "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if spec.get("questions"):
        dataset["questions"] = bulk_questions(spec["questions"])
    prior = _prior_check(dataset["id"])
    dropped = None
    if prior is not None:
        try:
            dataset["check"] = dict(checks.validate_check(prior, dataset.get("questions")),
                                    saved_at=prior.get("saved_at"))
        except WorkbenchError as err:
            dropped = str(err)
    dataset["rows"] = validate_rows(spec.get("rows"))
    write_dataset(dataset)
    return dict(dataset, check_dropped=dropped) if dropped else dataset


def list_datasets() -> List[dict]:
    out = []
    if datasets_dir().exists():
        for path in sorted(datasets_dir().glob("*.json")):
            try:
                dataset = json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                continue
            if isinstance(dataset, dict) and isinstance(dataset.get("rows"), list):
                try:
                    out.append(dataset_summary(dict(dataset, id=path.stem)))
                except (TypeError, AttributeError):  # a hand-edited file with odd fields; skip it, keep the list
                    continue
    return out


def load_dataset(dataset_id: str) -> dict:
    path = _dataset_path(dataset_id)  # outside the try: WorkbenchError is a ValueError
    try:
        dataset = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise WorkbenchError("No saved dataset %r" % dataset_id)
    except ValueError:
        raise WorkbenchError("data/workbench/datasets/%s.json is not valid JSON" % dataset_id)
    if not isinstance(dataset, dict) or not isinstance(dataset.get("rows"), list):
        raise WorkbenchError("data/workbench/datasets/%s.json has no rows list" % dataset_id)
    return dict(dataset, id=dataset_id)


def delete_dataset(dataset_id: str) -> bool:
    path = _dataset_path(dataset_id)
    if path.exists():
        path.unlink()
        return True
    return False


def run_item(client: JevClient, item: dict) -> dict:
    started = time.perf_counter()
    try:
        assets = item_images(item)
        result = client.system_one(item["state"], item["questions"], assets=assets or None)
    except (JevError, WorkbenchError, images.ImageError) as err:
        return {"id": item.get("id"), "name": item.get("name"), "error": str(err), "ok": False,
                "results": {}, "elapsed_ms": (time.perf_counter() - started) * 1000}
    results = {}
    ok = True
    for qid, answer in result.answers.items():
        expect = (item.get("expect") or {}).get(qid)
        if expect:
            try:
                verdict = check_expectation(answer, expect)
            except (KeyError, TypeError, ValueError, AttributeError, OverflowError) as err:
                verdict = {"ok": False, "checks": ["invalid expectation %s: %r" % (json.dumps(expect)[:120], err)]}
            ok &= verdict["ok"]
        else:
            verdict = {"ok": None, "checks": ["no expectation"]}
        results[qid] = dict(verdict, answer=answer)
    return {"id": item.get("id"), "name": item.get("name"), "ok": bool(ok), "results": results,
            "meta": result.meta(), "trace": result.trace(), "elapsed_ms": (time.perf_counter() - started) * 1000}


def run_items(client: JevClient, items: List[dict]) -> dict:
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=min(BULK_CONCURRENCY, max(1, len(items)))) as pool:
        runs = list(pool.map(lambda it: run_item(client, it), items))
    passed = sum(1 for r in runs if r["ok"])
    return {"runs": runs, "passed": passed, "failed": len(runs) - passed,
            "wall_ms": (time.perf_counter() - started) * 1000,
            "cost_usd": sum(r.get("meta", {}).get("cost_usd", 0.0) for r in runs)}


# --- bulk ----------------------------------------------------------------------------------


def load_sample_rows() -> List[dict]:
    """The labeled support tickets: one JSON object per line, labels under LABEL_KEY."""
    return parse_rows((SAMPLES_DIR / "tickets.jsonl").read_text())


def parse_rows(text: str) -> List[Any]:
    """One row per nonempty line. A line that is a JSON object becomes that object; others stay text.

    Lines end at "\n" only (a trailing "\r" is stripped), as the browser counts them; splitlines()
    would also break inside a JSON string at characters such as U+2028 that JSON leaves unescaped.
    """
    rows: List[Any] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("{"):
            try:
                value = json.loads(line)
            except ValueError:
                value = None
            if isinstance(value, dict):
                rows.append(value)
                continue
        rows.append(line)
    return rows


def split_labels(row: Any, number: int) -> tuple:
    """(state row, labels or None). Labels never reach the model."""
    if not isinstance(row, dict) or LABEL_KEY not in row:
        return row, None
    labels = row[LABEL_KEY]
    if not isinstance(labels, dict):
        raise WorkbenchError("Row %d: %s must be an object keyed by question id" % (number, LABEL_KEY))
    state = {k: v for k, v in row.items() if k != LABEL_KEY}
    if not state:
        raise WorkbenchError("Row %d has labels but no state" % number)
    return state, labels


def bulk_questions(questions: Any) -> Dict[str, dict]:
    questions = validate_questions(questions)
    if has_box(questions):
        raise WorkbenchError("Bulk rows are text, and Box questions need an image. Remove the Box questions first.")
    return questions


def _split_rows(rows: List[Any]) -> List[tuple]:
    """(state row, labels or None) for the first MAX_BULK_ROWS nonempty rows."""
    rows = [r for r in rows if r not in (None, "")][:MAX_BULK_ROWS]
    if not rows:
        raise WorkbenchError("No rows to run")
    return [split_labels(row, i + 1) for i, row in enumerate(rows)]


def _row_base(split: List[tuple], index: int) -> dict:
    row, labels = split[index]
    return {"index": index, "row": row, "expect": labels} if labels is not None else {"index": index, "row": row}


def _state(split: List[tuple], index: int, field: str) -> Any:
    """The state a row is sent as: a JSON row as it is, a text row under `field`."""
    row = split[index][0]
    return row if isinstance(row, (dict, list)) else {field: row}


def _run_jobs(client: JevClient, split: List[tuple], jobs: List[tuple], field: str) -> tuple:
    """jobs: [(row index, questions, model or None, perturbation or None)]. Returns (one outcome per job,
    first stopping error).

    An outcome is {"answers", "meta"}, {"error"}, or {"skipped": True}. When a perturbation changed the
    row, the outcome also holds the state it sent as "input". A missing key or exhausted budget stops new
    calls; other errors stay with their row.
    """
    stop = threading.Event()
    stopped = {"error": None}
    lock = threading.Lock()

    def one(job):
        index, questions, model, kind = job
        state = _state(split, index, field)
        sent = {}
        if kind:
            rewritten = perturb.apply(kind, state, index)
            if perturb.changed(state, rewritten):
                state, sent = rewritten, {"input": rewritten}
        try:
            result = client.system_one(state, questions, model=model)
            return dict(sent, answers=result.answers, meta=result.meta())
        except JevError as err:
            if err.status in (401, 402):
                with lock:
                    if stopped["error"] is None:
                        stopped["error"] = str(err)
                stop.set()
            return dict(sent, error=str(err))

    outcomes = map_until_stopped(one, jobs, BULK_CONCURRENCY, stop, lambda _job: {"skipped": True})
    return outcomes, stopped["error"]


def run_bulk(client: JevClient, rows: List[Any], questions: Any, field: str = "text", model: Optional[str] = None) -> dict:
    """Every row with the same questions. model: None asks the current model."""
    questions = bulk_questions(questions)
    split = _split_rows(rows)
    started = time.perf_counter()
    outcomes, stopped = _run_jobs(client, split, [(i, questions, model, None) for i in range(len(split))], field)
    results = [dict(_row_base(split, i), **outcome) for i, outcome in enumerate(outcomes)]
    done = [r for r in results if "answers" in r]
    return {"results": results, "wall_ms": (time.perf_counter() - started) * 1000,
            "rows": len(split), "completed": len(done), "stopped": stopped,
            "labeled": sum(1 for r in results if r.get("expect")),
            "cost_usd": sum(r["meta"]["cost_usd"] for r in done),
            "input_tokens": sum(r["meta"]["input_tokens"] for r in done)}


# --- compare -------------------------------------------------------------------------------


def validate_variants(variants: Any) -> List[dict]:
    """Two variants, each a Bulk question set, an optional model name (None uses the current model), and an
    optional perturbation of the rows it is sent (jev/perturb.py; None sends them as written)."""
    if not isinstance(variants, list) or len(variants) != len(compare.NAMES):
        raise WorkbenchError("Compare needs exactly two variants")
    out = []
    for name, variant in zip(compare.NAMES, variants):
        if not isinstance(variant, dict):
            raise WorkbenchError("Variant %s must be an object with questions and a model" % name)
        try:
            questions = bulk_questions(variant.get("questions"))
        except WorkbenchError as err:
            raise WorkbenchError("Variant %s: %s" % (name, err)) from err
        model = variant.get("model")
        if model is not None and not isinstance(model, str):
            raise WorkbenchError("Variant %s: model must be a string" % name)
        kind = variant.get("perturb") or None
        if kind is not None and kind not in perturb.KINDS:
            raise WorkbenchError("Variant %s: perturb must be one of %s" % (name, ", ".join(perturb.KINDS)))
        average = variant.get("average_orders", False)
        if not isinstance(average, bool):
            raise WorkbenchError("Variant %s: average_orders must be true or false" % name)
        if average and not orders.averaged_ids(questions):
            raise WorkbenchError("Variant %s: averaging over both orders needs a Choice question with two or more options"
                                 % name)
        out.append({"questions": questions, "model": (model or "").strip() or None, "perturb": kind,
                    "average_orders": average})
    return out


def _pair(outcomes: List[dict], questions: Dict[str, dict]) -> dict:
    """One outcome for an averaged variant from its two calls (jev/orders.py): the options as written, then
    reversed. When either call did not answer, the row has no answer: an error, or skipped by a stop. The
    spend of a call that did answer stays in "meta", so the variant's cost counts it."""
    first, second = outcomes
    spent = [o["meta"] for o in outcomes if "meta" in o]
    meta = {"meta": orders.combine_meta(spent)} if spent else {}
    sent = {"input": first["input"]} if "input" in first else {}
    if "answers" in first and "answers" in second:
        answers, picks = orders.average(first["answers"], second["answers"], questions)
        return dict(sent, answers=answers, orders=picks, **meta)
    failed = next((o for o in outcomes if "error" in o), None)
    return dict(sent, **meta, **({"error": failed["error"]} if failed else {"skipped": True}))


def run_compare(client: JevClient, rows: List[Any], variants: Any, field: str = "text") -> dict:
    """Both variants over the same rows: one call per row and variant, two for a variant that averages
    over both orders, interleaved row by row so a run stopped by the budget leaves the variants with
    nearly the same rows. Scoring (compare.evaluate) uses only rows both variants answered."""
    variants = validate_variants(variants)
    # Resolve a blank model once: the current model can change in Settings while the run is going,
    # and every call of a variant must use the same model.
    models = [v["model"] or client.model for v in variants]
    asked = [[v["questions"]] + ([orders.reverse_options(v["questions"])] if v["average_orders"] else []) for v in variants]
    split = _split_rows(rows)
    started = time.perf_counter()
    jobs = [(i, questions, model, v["perturb"]) for i in range(len(split))
            for v, model, sets in zip(variants, models, asked) for questions in sets]
    flat, stopped = _run_jobs(client, split, jobs, field)
    width = sum(len(sets) for sets in asked)
    results = []
    for i in range(len(split)):
        calls, runs = flat[i * width:(i + 1) * width], []
        for v, sets in zip(variants, asked):
            taken, calls = calls[:len(sets)], calls[len(sets):]
            runs.append(_pair(taken, v["questions"]) if len(taken) == 2 else taken[0])
        results.append(dict(_row_base(split, i), runs=runs))
    summaries = []
    for v, variant in enumerate(variants):
        done = [r["runs"][v] for r in results if "answers" in r["runs"][v]]
        spent = [r["runs"][v]["meta"] for r in results if "meta" in r["runs"][v]]
        latencies = [o["meta"]["latency_ms"] for o in done]
        kind = variant["perturb"]
        summaries.append({"name": compare.NAMES[v], "model": models[v], "perturb": kind,
                          # rows sent rewritten, and rows sent as written because the rewrite left them unchanged
                          "perturbed_rows": sum(1 for r in results if "input" in r["runs"][v]),
                          "unperturbed_rows": sum(1 for r in results if kind and "input" not in r["runs"][v]
                                                  and "skipped" not in r["runs"][v]),
                          "average_orders": variant["average_orders"],
                          "orders": orders.disagreement([r["runs"][v] for r in results], variant["questions"])
                          if variant["average_orders"] else None,
                          "questions": variant["questions"], "completed": len(done),
                          "errors": sum(1 for r in results if "error" in r["runs"][v]),
                          "cost_usd": sum(m["cost_usd"] for m in spent),
                          "input_tokens": sum(m["input_tokens"] for m in spent),
                          "latency_ms_median": statistics.median(latencies) if latencies else None})
    return {"variants": summaries, "results": results, "rows": len(split), "stopped": stopped,
            "agreement": compare.agreement(results, [v["questions"] for v in variants], models[0] == models[1],
                                           [v["perturb"] for v in variants], [v["average_orders"] for v in variants]),
            "labeled": sum(1 for r in results if r.get("expect")),
            "wall_ms": (time.perf_counter() - started) * 1000,
            "cost_usd": sum(s["cost_usd"] for s in summaries)}


def map_until_stopped(fn: Callable, items: list, max_workers: int, stop: threading.Event, skipped: Callable) -> list:
    """Run fn(item) with at most max_workers in flight. Once stop is set, remaining items are not started."""
    if not items:
        return []
    results: list = [None] * len(items)
    workers = max(1, min(max_workers, len(items)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        pending = {}
        next_i = 0
        while next_i < len(items) or pending:
            while next_i < len(items) and len(pending) < workers and not stop.is_set():
                pending[pool.submit(fn, items[next_i])] = next_i
                next_i += 1
            if stop.is_set():
                while next_i < len(items):
                    results[next_i] = skipped(items[next_i])
                    next_i += 1
            if not pending:
                break
            done, _ = wait(set(pending), return_when=FIRST_COMPLETED)
            for fut in done:
                results[pending.pop(fut)] = fut.result()
    return results


# --- code export ---------------------------------------------------------------------------


def _py(value: Any, indent: int = 0) -> str:
    """Python literal for JSON-ish data, pretty enough to paste into a file."""
    pad = " " * indent
    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = ",\n".join("%s    %r: %s" % (pad, k, _py(v, indent + 4)) for k, v in value.items())
        return "{\n%s\n%s}" % (inner, pad)
    if isinstance(value, list):
        if not value:
            return "[]"
        inner = ",\n".join("%s    %s" % (pad, _py(v, indent + 4)) for v in value)
        return "[\n%s\n%s]" % (inner, pad)
    return repr(value)


def image_file(ref: str, spec: dict) -> str:
    """The file name an exported snippet loads a picture from."""
    if spec.get("sample"):
        return "%s.png" % spec["sample"]
    return "%s.%s" % (ref, spec.get("format") or "jpg")


def python_questions(questions: Dict[str, dict]) -> List[str]:
    """The lines of a `questions = {...}` block built from the Python SDK's question classes."""
    lines = ["questions = {"]
    for qid, q in questions.items():
        args = ["instructions=%s" % _py(q["instructions"], 8)]
        if q["type"] == "choice":
            lines.append("    %r: Choice(" % qid)
            args.append("criteria=%s" % _py(q["criteria"], 8))
        elif q["type"] == "score":
            lines.append("    %r: Score(" % qid)
            args.append("criteria=%s" % _py(q["criteria"], 8))
        elif q["type"] == "box":
            lines.append("    %r: Box(" % qid)
        else:
            lines.append("    %r: Noul(" % qid)
            if q.get("criteria"):
                c = q["criteria"]
                args.append("criteria=NoulCriteria(true=%s, false=%s)" % (_py(c.get("true"), 8), _py(c.get("false"), 8)))
        lines.append("        " + ",\n        ".join(args) + ",")
        lines.append("    ),")
    return lines + ["}"]


def export_python(state: Any, questions: Dict[str, dict], model: str, refs: Dict[str, dict] = None) -> str:
    refs = refs or {}
    names = ["Choice", "Noul", "NoulCriteria", "Score", "TypeSafeClient"] + (["Box"] if has_box(questions) else [])
    names += ["Image"] if refs else []
    lines = (["from pathlib import Path", ""] if refs else []) + [
        "from typesafe_sdk import %s" % ", ".join(sorted(names)), "",
        "client = TypeSafeClient(model=%r)  # reads TYPESAFE_API_KEY from the environment" % model, "",
        "state = %s" % _py(state), ""] + python_questions(questions)
    if refs:
        lines += ["", "# Each reference in the text is replaced by its picture. Save the pictures beside this file.",
                  "assets = {"] + ["    %r: Image(Path(%r))," % (ref, image_file(ref, spec)) for ref, spec in refs.items()] + [
            "}", "",
            "# Images and Box questions are early TypeSafe features and need this header. Box needs Jev 1.14+.",
            "result = client.system_one(state, questions, assets=assets,",
            "                           extra_headers={\"TypeSafe-Danger-Zone-Images\": \"true\"})", ""]
    else:
        lines += ["", "result = client.system_one(state, questions)", ""]
    for qid, q in questions.items():
        if q["type"] == "box":
            lines.append("%s = result.boxes[%r]     # .box.left/.top/.right/.bottom, .confidence" % (_ident(qid), qid))
        elif q["type"] == "choice":
            lines.append("%s = result.choices[%r]   # .choice, .probabilities, .confidence" % (_ident(qid), qid))
        elif q["type"] == "score":
            lines.append("%s = result.scores[%r]    # .score, .probabilities, .confidence" % (_ident(qid), qid))
        else:
            lines.append("%s = result.nouls[%r]     # .noul is P(yes)" % (_ident(qid), qid))
    lines += ["", "# Your code owns the decision. For example:",
              "# if %s.confidence < 0.6: route_to_human()" % _ident(next(iter(questions)))]
    return "\n".join(lines) + "\n"


def export_javascript(state: Any, questions: Dict[str, dict], model: str, refs: Dict[str, dict] = None) -> str:
    body = json.dumps({"state": state, "model": model, "questions": questions}, indent=2, ensure_ascii=False)
    if not refs:
        return ("import { TypeSafeClient } from \"@typesafe-ai/sdk\";\n\n"
                "const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY\n\n"
                "const { state, model, questions } = %s;\n\n"
                "const result = await client.systemOne({ state, model, questions });\n"
                "console.log(result.answers);\n" % body)
    assets = "\n".join("  %s: image(await openAsBlob(%s))," % (json.dumps(ref), json.dumps(image_file(ref, spec)))
                       for ref, spec in refs.items())
    return ("import { openAsBlob } from \"node:fs\";\n"
            "import { image, TypeSafeClient } from \"@typesafe-ai/sdk\";\n\n"
            "const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY\n\n"
            "const { state, model, questions } = %s;\n\n"
            "// Each reference in the text is replaced by its picture. Save the pictures beside this file.\n"
            "const assets = {\n%s\n};\n\n"
            "// Images and Box questions are early TypeSafe features and need this header. Box needs Jev 1.14+.\n"
            "const result = await client.systemOne({ state, model, questions, assets },\n"
            "  { headers: { \"TypeSafe-Danger-Zone-Images\": \"true\" } });\n"
            "console.log(result.answers);\n" % (body, assets))


def export_curl(state: Any, questions: Dict[str, dict], model: str, refs: Dict[str, dict] = None) -> str:
    request = {"state": state, "model": model, "questions": questions}
    if not refs:
        body = json.dumps(request, indent=2, ensure_ascii=False)
        return ("curl -X POST https://api.typesafe.ai/v1/systemone \\\n"
                "  -H \"Authorization: Bearer $TYPESAFE_API_KEY\" \\\n"
                "  -H \"Content-Type: application/json\" \\\n"
                "  -d @- <<'EOF'\n%s\nEOF\n" % body)
    parts = {ref: "image-%d" % i for i, ref in enumerate(refs)}
    request["assets"] = {ref: {"type": "image", "part": part} for ref, part in parts.items()}
    body = json.dumps(request, indent=2, ensure_ascii=False)
    files = "".join(" \\\n  -F '%s=@%s'" % (part, image_file(ref, refs[ref])) for ref, part in parts.items())
    return ("# Multipart: the JSON request first, then one file part per picture.\n"
            "cat > request.json <<'EOF'\n%s\nEOF\n\n"
            "curl https://api.typesafe.ai/v1/systemone \\\n"
            "  -H \"Authorization: Bearer $TYPESAFE_API_KEY\" \\\n"
            "  -H \"TypeSafe-Danger-Zone-Images: true\" \\\n"
            "  -F 'request=<request.json;type=application/json'%s\n" % (body, files))


def _ident(qid: str) -> str:
    ident = re.sub(r"[^0-9a-zA-Z_]", "_", qid)
    return ident if ident and not ident[0].isdigit() else "q_" + ident


def export(state: Any, questions: Any, model: str, image_specs: Any = None) -> dict:
    """Code for this request. Pictures are loaded from files named in the snippet; no bytes are inlined."""
    questions = validate_questions(questions)
    refs = {}
    if isinstance(image_specs, dict):
        for ref, spec in image_specs.items():
            if not isinstance(spec, dict):
                continue
            # These values become file names inside quoted shell and code strings, so only safe ones pass.
            if not isinstance(ref, str) or not images.REF_RE.fullmatch(ref):
                raise WorkbenchError("Invalid image reference %r" % (ref,))
            if spec.get("sample"):
                if spec["sample"] not in images.SAMPLES:
                    raise WorkbenchError("Unknown sample image %r" % (spec["sample"],))
                refs[ref] = {"sample": spec["sample"]}
            else:
                fmt = spec.get("format") or "jpg"
                if fmt not in ("png", "jpg"):
                    raise WorkbenchError("Image format must be png or jpg, not %r" % (fmt,))
                refs[ref] = {"format": fmt}
    return {"python": export_python(state, questions, model, refs),
            "javascript": export_javascript(state, questions, model, refs),
            "curl": export_curl(state, questions, model, refs)}
