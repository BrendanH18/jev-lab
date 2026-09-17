"""Workbench: write your own state and questions, save them as tests, run them in bulk, export code.

This is the part of Jev Lab that turns "cool demo" into "how do I build with this". A workbench
item is plain JSON: a state, a map of questions, and optional expectations. Items are saved under
data/workbench/ so they can be committed with a project like any other test fixture.
"""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

from .client import JevClient, JevError
from .config import SAMPLES_DIR, WORKBENCH_DIR

MAX_QUESTIONS = 100
MAX_CHOICE_OPTIONS = 255
MAX_SCORE_LEVELS = 25
MAX_STATE_CHARS = 120_000
MAX_BULK_ROWS = 200
BULK_CONCURRENCY = 8
SLUG = re.compile(r"[^a-z0-9]+")


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
        if qtype not in ("noul", "choice", "score"):
            raise WorkbenchError("Question %r: type must be noul, choice, or score" % qid)
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


def run(client: JevClient, state: Any, questions: Any) -> dict:
    result = client.system_one(validate_state(state), validate_questions(questions))
    return {"answers": result.answers, "meta": result.meta(), "trace": result.trace()}


# --- expectations --------------------------------------------------------------------------


def check_expectation(answer: dict, expect: dict) -> dict:
    """expect examples: {"choice": "billing"}, {"min": 0.7}, {"max": 0.3}, {"min": 1, "max": 2}."""
    checks: List[str] = []
    ok = True
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


def save_item(spec: dict) -> dict:
    name = (spec.get("name") or "").strip()
    item = {
        "id": spec.get("id") or slugify(name),
        "name": name or spec.get("id"),
        "notes": (spec.get("notes") or "")[:2000],
        "state": validate_state(spec.get("state")),
        "questions": validate_questions(spec.get("questions")),
        "expect": spec.get("expect") or {},
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if not isinstance(item["expect"], dict):
        raise WorkbenchError("expect must be an object keyed by question id")
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


def run_item(client: JevClient, item: dict) -> dict:
    started = time.perf_counter()
    try:
        result = client.system_one(item["state"], item["questions"])
    except JevError as err:
        return {"id": item.get("id"), "name": item.get("name"), "error": str(err), "ok": False,
                "results": {}, "elapsed_ms": (time.perf_counter() - started) * 1000}
    results = {}
    ok = True
    for qid, answer in result.answers.items():
        expect = (item.get("expect") or {}).get(qid)
        if expect:
            verdict = check_expectation(answer, expect)
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


def load_sample_rows() -> List[str]:
    rows = []
    for line in (SAMPLES_DIR / "tickets.txt").read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            rows.append(line.strip())
    return rows


def run_bulk(client: JevClient, rows: List[Any], questions: Any, field: str = "text") -> dict:
    questions = validate_questions(questions)
    rows = [r for r in rows if r not in (None, "")][:MAX_BULK_ROWS]
    if not rows:
        raise WorkbenchError("No rows to run")
    started = time.perf_counter()
    stop = {"error": None}

    def one(index_row):
        index, row = index_row
        if stop["error"]:
            return {"index": index, "row": row, "skipped": True}
        state = row if isinstance(row, (dict, list)) else {field: row}
        try:
            result = client.system_one(state, questions)
            return {"index": index, "row": row, "answers": result.answers, "meta": result.meta()}
        except JevError as err:
            if err.status in (401, 402):
                stop["error"] = str(err)
            return {"index": index, "row": row, "error": str(err)}

    with ThreadPoolExecutor(max_workers=BULK_CONCURRENCY) as pool:
        results = list(pool.map(one, enumerate(rows)))
    done = [r for r in results if "answers" in r]
    return {"results": results, "wall_ms": (time.perf_counter() - started) * 1000,
            "rows": len(rows), "completed": len(done), "stopped": stop["error"],
            "cost_usd": sum(r["meta"]["cost_usd"] for r in done),
            "input_tokens": sum(r["meta"]["input_tokens"] for r in done),
            "replayed": sum(1 for r in done if r["meta"].get("replayed"))}


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


def export_python(state: Any, questions: Dict[str, dict]) -> str:
    lines = ["from typesafe_sdk import Choice, Noul, NoulCriteria, Score, TypeSafeClient", "",
             "client = TypeSafeClient()  # reads TYPESAFE_API_KEY from the environment", "",
             "state = %s" % _py(state), "", "questions = {"]
    for qid, q in questions.items():
        args = ["instructions=%s" % _py(q["instructions"], 8)]
        if q["type"] == "choice":
            lines.append("    %r: Choice(" % qid)
            args.append("criteria=%s" % _py(q["criteria"], 8))
        elif q["type"] == "score":
            lines.append("    %r: Score(" % qid)
            args.append("criteria=%s" % _py(q["criteria"], 8))
        else:
            lines.append("    %r: Noul(" % qid)
            if q.get("criteria"):
                c = q["criteria"]
                args.append("criteria=NoulCriteria(true=%s, false=%s)" % (_py(c.get("true"), 8), _py(c.get("false"), 8)))
        lines.append("        " + ",\n        ".join(args) + ",")
        lines.append("    ),")
    lines += ["}", "", "result = client.system_one(state, questions)", ""]
    for qid, q in questions.items():
        if q["type"] == "choice":
            lines.append("%s = result.choices[%r]   # .choice, .probabilities, .confidence" % (_ident(qid), qid))
        elif q["type"] == "score":
            lines.append("%s = result.scores[%r]    # .score, .probabilities, .confidence" % (_ident(qid), qid))
        else:
            lines.append("%s = result.nouls[%r]     # .noul is P(yes)" % (_ident(qid), qid))
    lines += ["", "# Your code owns the decision. For example:",
              "# if %s.confidence < 0.6: route_to_human()" % _ident(next(iter(questions)))]
    return "\n".join(lines) + "\n"


def export_javascript(state: Any, questions: Dict[str, dict]) -> str:
    body = json.dumps({"state": state, "questions": questions}, indent=2, ensure_ascii=False)
    return ("import { TypeSafeClient } from \"@typesafe-ai/sdk\";\n\n"
            "const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY\n\n"
            "const { state, questions } = %s;\n\n"
            "const result = await client.systemOne({ state, questions });\n"
            "console.log(result.answers);\n" % body)


def export_curl(state: Any, questions: Dict[str, dict], model: str) -> str:
    body = json.dumps({"state": state, "model": model, "questions": questions}, indent=2, ensure_ascii=False)
    return ("curl -X POST https://api.typesafe.ai/v1/systemone \\\n"
            "  -H \"Authorization: Bearer $TYPESAFE_API_KEY\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            "  -d @- <<'EOF'\n%s\nEOF\n" % body)


def _ident(qid: str) -> str:
    ident = re.sub(r"[^0-9a-zA-Z_]", "_", qid)
    return ident if ident and not ident[0].isdigit() else "q_" + ident


def export(state: Any, questions: Any, model: str) -> dict:
    questions = validate_questions(questions)
    return {"python": export_python(state, questions), "javascript": export_javascript(state, questions),
            "curl": export_curl(state, questions, model)}
