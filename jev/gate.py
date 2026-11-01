"""Gate export: a tuned gate as a module your application imports.

Policy tunes thresholds over a Bulk run, and a check keeps them with a dataset (jev/checks.py). Both stop
at a number per question. This module writes the code that applies those numbers outside Jev Lab: a
Python or JavaScript file with the question set, the model, the signal, and the thresholds built in, and
one function, decide(state). It asks the questions in one call, reads each gated answer's signal exactly
as Calibrate and Policy read it, and returns:

  * route: "auto" when every gated answer clears its threshold, else "review";
  * held: the gated questions that did not clear theirs, in gate order;
  * answers: every answer as Calibrate shows it: a Choice's option, a Noul's yes or no as a boolean, a
    Score's most likely level.

A signal equal to its threshold clears it, as in the Workbench. An answer the model did not return holds
its question, so an incomplete result goes to review rather than being acted on. Run as a script, each
file reads rows from standard input, one per line, as Bulk does: a JSON object is sent as it is, and
other text becomes {"text": line}. A row's "_expect" labels are removed first, as Bulk removes them. It prints one decision per line as JSON.

Exporting makes no model call. The thresholds are only as good as the labeled rows they were tuned on;
the file says where they came from.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from . import calibrate, policy, workbench
from .calibrate import CalibrationError
from .workbench import WorkbenchError, _py

FIELD = "text"  # a Bulk text row becomes {"text": row}; checks.run sends rows the same way


def validate(questions: Any, gates: Any, signal: Any, model: Any) -> tuple:
    """(questions, gates, signal, model) checked, or WorkbenchError."""
    questions = workbench.bulk_questions(questions)
    # In a JavaScript object literal, a "__proto__" key sets the prototype instead of adding the key, so the
    # exported module would silently lose that question, gate, or option.
    if "__proto__" in questions or any("__proto__" in q["criteria"] for q in questions.values()
                                       if isinstance(q.get("criteria"), dict)):
        raise WorkbenchError("A question or option named __proto__ cannot be exported: JavaScript would drop it")
    try:
        gates = policy._gates(gates)
    except CalibrationError as err:
        raise WorkbenchError(str(err)) from err
    for qid in gates:
        qtype = (questions.get(qid) or {}).get("type")
        if qtype is None:
            raise WorkbenchError("The gate reads %r, which is not one of the questions" % qid)
        if qtype not in policy.TYPES:
            raise WorkbenchError("The gate reads %r, a %s question; gates read Choice, Noul, and Score" % (qid, qtype))
    if signal not in calibrate.SIGNALS:
        raise WorkbenchError("signal must be one of %s" % ", ".join(calibrate.SIGNALS))
    if not isinstance(model, str) or not model.strip():
        raise WorkbenchError("Name the model the gate was tuned with")
    return questions, gates, signal, model.strip()


def _origin(source: Optional[dict]) -> str:
    """One sentence on where the thresholds came from, for the file's header."""
    source = source or {}
    if source.get("dataset"):
        # JSON quoting escapes quotes, backslashes, and line breaks, so a dataset's name cannot end the file's
        # docstring or comment and become code in the module someone runs.
        line = "Thresholds from the check saved with the Jev Lab dataset %s" % json.dumps(str(source["dataset"]))
        if source.get("min_accuracy") is not None:
            line += ", whose targets are %s%% accuracy on automated rows%s and at least %s%% of rows automated" % (
                _percent(source["min_accuracy"]),
                " at 95% confidence" if source.get("bound") == "lower" else "",
                _percent(source.get("min_coverage") or 0))
        return line + "."
    return "Thresholds tuned in Jev Lab's Workbench Policy on one Bulk run."


def _percent(value: float) -> str:
    return ("%.1f" % (value * 100)).rstrip("0").rstrip(".")


def export(questions: Any, gates: Any, signal: Any = "confidence", model: Any = None,
           source: Optional[dict] = None) -> dict:
    """{"python": source, "javascript": source}. No model call."""
    questions, gates, signal, model = validate(questions, gates, signal, model)
    origin = _origin(source)
    return {"python": _python(questions, gates, signal, model, origin),
            "javascript": _javascript(questions, gates, signal, model, origin)}


def export_check(dataset_id: str) -> dict:
    """The gate saved as a check with a dataset, exported with the dataset's questions."""
    dataset = workbench.load_dataset(dataset_id)
    check = dataset.get("check")
    if not isinstance(check, dict):
        raise WorkbenchError("Dataset %r has no check to export. Save one from Policy first." % dataset_id)
    source = {"dataset": dataset.get("name") or dataset_id, "min_accuracy": check.get("min_accuracy"),
              "min_coverage": check.get("min_coverage"), "bound": check.get("bound")}
    return export(dataset.get("questions"), check.get("gates"), check.get("signal", "confidence"), check.get("model"),
                  source)


# --- Python --------------------------------------------------------------------------------------

_PY_SIGNAL = {
    "confidence": {
        "noul": "abs(2 * answer.noul - 1)  # a Noul has no confidence field: |2p - 1|",
        "choice": "answer.confidence",
        "score": "answer.confidence",
    },
    "top_probability": {
        "noul": "max(answer.noul, 1 - answer.noul)",
        "choice": "answer.probabilities[answer.choice]",
        "score": "max(answer.probabilities.values())",
    },
}


def _python(questions: Dict[str, dict], gates: Dict[str, float], signal: str, model: str, origin: str) -> str:
    types = {qid: q["type"] for qid, q in questions.items()}
    names = sorted({"Choice", "Noul", "NoulCriteria", "Score", "TypeSafeClient"})
    reads = _PY_SIGNAL[signal]
    lines = [
        '"""A confidence gate exported from Jev Lab: decide(state) asks Jev, then routes in code.',
        "",
        origin,
        "Confirm them on labeled rows from your own traffic before you rely on them.",
        "",
        "Needs: pip install typesafe-sdk (Python 3.10+), and TYPESAFE_API_KEY in the environment.",
        "Run:   python gate.py < rows.jsonl   (one row per line: a JSON object, or text sent as {\"%s\": text})" % FIELD,
        '"""',
        "",
        "import json",
        "import sys",
        "",
        "from typesafe_sdk import %s" % ", ".join(names),
        "",
        "MODEL = %r" % model,
        "SIGNAL = %r  # what each threshold is compared with" % signal,
        "THRESHOLDS = %s" % _py(gates),
        "TYPES = %s" % _py(types),
        "FIELD = %r  # a text row becomes {FIELD: text}, as in Jev Lab's Bulk" % FIELD,
        "",
    ] + workbench.python_questions(questions) + [
        "",
        "",
        "def _answer(result, qid):",
        "    return {\"choice\": result.choices, \"noul\": result.nouls, \"score\": result.scores}[TYPES[qid]].get(qid)",
        "",
        "",
        "def signal(answer, qtype):",
        '    """The number a threshold is compared with, read as Jev Lab\'s Calibrate and Policy read it."""',
        "    if qtype == \"noul\":",
        "        return %s" % reads["noul"],
        "    if qtype == \"choice\":",
        "        return %s" % reads["choice"],
        "    return %s" % reads["score"],
        "",
        "",
        "def value(answer, qtype):",
        '    """The answer as Jev Lab shows it: the option, yes or no, or the most likely level."""',
        "    if qtype == \"noul\":",
        "        return answer.noul >= 0.5",
        "    if qtype == \"choice\":",
        "        return answer.choice",
        "    return int(max(answer.probabilities, key=answer.probabilities.get))",
        "",
        "",
        "def held_by(result):",
        '    """The gated questions that are unsure, in gate order. A missing answer holds its question."""',
        "    held = []",
        "    for qid, threshold in THRESHOLDS.items():",
        "        answer = _answer(result, qid)",
        "        # 1e-9 absorbs float rounding, so a signal equal to its threshold clears it, as in the Workbench.",
        "        # Written as \"not >=\", so an unreadable signal (NaN) holds its question too.",
        "        if answer is None or not signal(answer, TYPES[qid]) + 1e-9 >= threshold:",
        "            held.append(qid)",
        "    return held",
        "",
        "",
        "def decide(state, client=None):",
        '    """{"route": "auto" or "review", "held": [...], "answers": {...}} for one state. One model call."""',
        "    client = client or TypeSafeClient(model=MODEL)  # reads TYPESAFE_API_KEY",
        "    result = client.system_one(state, questions, model=MODEL)",
        "    held = held_by(result)",
        "    answers = {}",
        "    for qid, qtype in TYPES.items():",
        "        answer = _answer(result, qid)",
        "        answers[qid] = None if answer is None else value(answer, qtype)",
        "    return {\"route\": \"review\" if held else \"auto\", \"held\": held, \"answers\": answers}",
        "",
        "",
        "def _row(line):",
        "    try:",
        "        row = json.loads(line)",
        "    except ValueError:",
        "        return {FIELD: line}",
        "    if not isinstance(row, dict):",
        "        return {FIELD: line}",
        "    row.pop(%r, None)  # a labeled Bulk row's labels: the model never sees them, as in Bulk" % workbench.LABEL_KEY,
        "    return row",
        "",
        "",
        "def main():",
        "    client = TypeSafeClient(model=MODEL)",
        "    for line in sys.stdin:",
        "        if line.strip():",
        "            print(json.dumps(decide(_row(line.strip()), client)), flush=True)",
        "",
        "",
        "if __name__ == \"__main__\":",
        "    main()",
    ]
    return "\n".join(lines) + "\n"


# --- JavaScript ----------------------------------------------------------------------------------

_JS_SIGNAL = {
    "confidence": {
        "noul": "Math.abs(2 * answer.noul - 1); // a Noul has no confidence field: |2p - 1|",
        "choice": "answer.confidence;",
        "score": "answer.confidence;",
    },
    "top_probability": {
        "noul": "Math.max(answer.noul, 1 - answer.noul);",
        "choice": "answer.probabilities[answer.choice];",
        "score": "Math.max(...Object.values(answer.probabilities));",
    },
}


def _javascript(questions: Dict[str, dict], gates: Dict[str, float], signal: str, model: str, origin: str) -> str:
    types = {qid: q["type"] for qid, q in questions.items()}
    reads = _JS_SIGNAL[signal]
    dumps = lambda value: json.dumps(value, indent=2, ensure_ascii=False)  # noqa: E731
    lines = [
        "// A confidence gate exported from Jev Lab: decide(state) asks Jev, then routes in code.",
        "//",
        "// %s" % origin,
        "// Confirm them on labeled rows from your own traffic before you rely on them.",
        "//",
        "// Needs: npm install @typesafe-ai/sdk (Node 22+), and TYPESAFE_API_KEY in the environment.",
        "// Run:   node gate.mjs < rows.jsonl   (one row per line: a JSON object, or text sent as {\"%s\": text})" % FIELD,
        "",
        "import { createInterface } from \"node:readline\";",
        "import { pathToFileURL } from \"node:url\";",
        "import { TypeSafeClient } from \"@typesafe-ai/sdk\";",
        "",
        "export const MODEL = %s;" % json.dumps(model),
        "export const SIGNAL = %s; // what each threshold is compared with" % json.dumps(signal),
        "export const THRESHOLDS = %s;" % dumps(gates),
        "const TYPES = %s;" % dumps(types),
        "const FIELD = %s; // a text row becomes {FIELD: text}, as in Jev Lab's Bulk" % json.dumps(FIELD),
        "",
        "export const questions = %s;" % dumps(questions),
        "",
        "// The number a threshold is compared with, read as Jev Lab's Calibrate and Policy read it.",
        "export function signal(answer, type) {",
        "  if (type === \"noul\") return %s" % reads["noul"],
        "  if (type === \"choice\") return %s" % reads["choice"],
        "  return %s" % reads["score"],
        "}",
        "",
        "// The answer as Jev Lab shows it: the option, yes or no, or the most likely level.",
        "function value(answer, type) {",
        "  if (type === \"noul\") return answer.noul >= 0.5;",
        "  if (type === \"choice\") return answer.choice;",
        "  const [level] = Object.entries(answer.probabilities).reduce((best, entry) => (entry[1] > best[1] ? entry : best));",
        "  return Number(level);",
        "}",
        "",
        "// The gated questions that are unsure, in gate order. A missing answer holds its question.",
        "export function heldBy(answers) {",
        "  // 1e-9 absorbs float rounding, so a signal equal to its threshold clears it, as in the Workbench.",
        "  // Written as \"not >=\", so an unreadable signal (NaN) holds its question too.",
        "  return Object.entries(THRESHOLDS)",
        "    .filter(([id, threshold]) => !Object.hasOwn(answers, id) || !(signal(answers[id], TYPES[id]) + 1e-9 >= threshold))",
        "    .map(([id]) => id);",
        "}",
        "",
        "let shared;",
        "",
        "// {route: \"auto\" or \"review\", held: [...], answers: {...}} for one state. One model call.",
        "export async function decide(state, client = (shared ??= new TypeSafeClient())) {",
        "  const { answers } = await client.systemOne({ state, model: MODEL, questions });",
        "  const held = heldBy(answers);",
        "  const shown = Object.fromEntries(Object.entries(TYPES).map(([id, type]) =>",
        "    [id, Object.hasOwn(answers, id) ? value(answers[id], type) : null]));",
        "  return { route: held.length ? \"review\" : \"auto\", held, answers: shown };",
        "}",
        "",
        "function row(line) {",
        "  try {",
        "    const parsed = JSON.parse(line);",
        "    if (parsed && typeof parsed === \"object\" && !Array.isArray(parsed)) {",
        "      delete parsed[%s]; // a labeled Bulk row's labels: the model never sees them, as in Bulk" % json.dumps(workbench.LABEL_KEY),
        "      return parsed;",
        "    }",
        "  } catch { /* text */ }",
        "  return { [FIELD]: line };",
        "}",
        "",
        "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {",
        "  for await (const line of createInterface({ input: process.stdin })) {",
        "    if (line.trim()) console.log(JSON.stringify(await decide(row(line.trim()))));",
        "  }",
        "}",
    ]
    return "\n".join(lines) + "\n"
