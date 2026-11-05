"""Gate export: a tuned gate as a module your application imports.

Policy tunes thresholds over a Bulk run, and a check keeps them with a dataset (jev/checks.py). Both stop
at a number per question. This module writes the code that applies those numbers outside Jev Lab: a
Python or JavaScript file with the question set, the model, the signal, and the thresholds built in, and
one function, decide(state). It asks the questions in one call, reads each gated answer's signal exactly
as Calibrate and Policy read it, and returns:

  * route: "auto" when every gated answer clears its threshold and no rule holds the row, else "review";
  * held: the gated questions that did not clear theirs, in gate order;
  * rules: Policy's consistency rules (jev/rules.py) the answers break, or cannot be checked against, as written;
  * answers: every answer as Calibrate shows it: a Choice's option, a Noul's yes or no as a boolean, a
    Score's most likely level, or a Box's left/top/right/bottom coordinates (output only, never gated).

A signal equal to its threshold clears it, as in the Workbench. An answer the model did not return holds
its question, so an incomplete result goes to review rather than being acted on. Run as a script, each
file reads rows from standard input, one per line, as Bulk does: a JSON object is sent as it is, and
other text becomes {"text": line}. A row's "_expect" labels are removed first, as Bulk removes them. It prints one decision per line as JSON,
with the row it was asked about under "row", so the Workbench's Review queue (jev/decisions.py) can label it.
Picture rows load their _image from a local directory and send it as Bulk's photo asset. Exported source contains
no pictures or answers. Library calls accept an image directory; scripts load from the working directory.

Exporting makes no model call. The thresholds are only as good as the labeled rows they were tuned on;
the file says where they came from.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from . import answersets, calibrate, images, policy, rules as rulebook, workbench
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


def _rules(text: Any, questions: Dict[str, dict]) -> List[dict]:
    """Rules as the exported files hold them: {"rule": text, "if": [[qid, op, values]], "then": [...]}, with a Noul's
    values written yes or no, or WorkbenchError."""
    try:
        parsed = rulebook.parse(text)
        rulebook.check(parsed, rulebook.kinds_from_questions(questions))
    except CalibrationError as err:
        raise WorkbenchError(str(err)) from err

    # check() wrote each Noul value as yes or no, as decide() shows a Noul answer.
    return [{"rule": r["text"], "if": [list(c) for c in r["if"]], "then": [list(c) for c in r["then"]]} for r in parsed]


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
           source: Optional[dict] = None, rules: Any = None, answer_sets: Any = None) -> dict:
    """{"python": source, "javascript": source}. rules: Policy's rules as text. No model call."""
    questions, gates, signal, model = validate(questions, gates, signal, model)
    origin = _origin(source)
    written = _rules(rules, questions)
    sets = answersets.validate_config(answer_sets, questions)
    return {"python": _python(questions, gates, signal, model, origin, written, sets),
            "javascript": _javascript(questions, gates, signal, model, origin, written, sets)}


def export_check(dataset_id: str) -> dict:
    """The gate saved as a check with a dataset, exported with the dataset's questions."""
    dataset = workbench.load_dataset(dataset_id)
    check = dataset.get("check")
    if not isinstance(check, dict):
        raise WorkbenchError("Dataset %r has no check to export. Save one from Policy first." % dataset_id)
    source = {"dataset": dataset.get("name") or dataset_id, "min_accuracy": check.get("min_accuracy"),
              "min_coverage": check.get("min_coverage"), "bound": check.get("bound")}
    return export(dataset.get("questions"), check.get("gates"), check.get("signal", "confidence"), check.get("model"),
                  source, check.get("rules"), check.get("answer_sets"))


def _candidate_options(questions: Dict[str, dict], answer_sets: dict) -> dict:
    """Declared labels in question order, also used when probabilities cannot form a shortlist."""
    return {qid: ([True, False] if questions[qid]["type"] == "noul" else
                  list(range(len(questions[qid]["criteria"]))) if questions[qid]["type"] == "score" else
                  list(questions[qid]["criteria"])) for qid in answer_sets}


def _python_candidates(questions: Dict[str, dict], answer_sets: dict) -> List[str]:
    header = ["# Answer sets only suggest review options; thresholds and rules still decide automation.",
              "ANSWER_SETS = %s" % _py(answer_sets),
              "CANDIDATE_OPTIONS = %s" % _py(_candidate_options(questions, answer_sets)), ""]
    return header + '''
def candidates(result):
    """Likely labels, or every declared label if none qualifies or probabilities are incomplete."""
    out = {}
    for qid, spec in ANSWER_SETS.items():
        options = CANDIDATE_OPTIONS[qid]
        answer = _answer(result, qid)
        raw = getattr(answer, "probabilities", None)
        if TYPES[qid] == "noul":
            p = getattr(answer, "noul", None)
            probs = [p, 1 - p] if isinstance(p, (int, float)) and not isinstance(p, bool) else []
        elif isinstance(raw, dict) and {str(k) for k in raw} == {str(k) for k in options}:
            by_key = {str(k): v for k, v in raw.items()}
            probs = [by_key[str(k)] for k in options]
        else:
            probs = []
        if len(probs) != len(options) or any(isinstance(p, bool) or not isinstance(p, (int, float))
                                             or not 0 <= p <= 1 for p in probs):
            out[qid] = list(options)
            continue
        ranked = sorted(range(len(options)), key=lambda i: -probs[i])
        chosen = [options[i] for i in ranked if probs[i] + 1e-9 >= spec["cut"]]
        out[qid] = chosen or [options[i] for i in ranked]
    return out


'''.splitlines()


def _javascript_candidates(questions: Dict[str, dict], answer_sets: dict) -> List[str]:
    header = ["// Answer sets only suggest review options; thresholds and rules still decide automation.",
              "export const ANSWER_SETS = %s;" % json.dumps(answer_sets, ensure_ascii=False),
              "const CANDIDATE_OPTIONS = %s;" % json.dumps(_candidate_options(questions, answer_sets), ensure_ascii=False), ""]
    return header + '''
export function candidates(answers) {
  return Object.fromEntries(Object.entries(ANSWER_SETS).map(([id, spec]) => {
    const options = CANDIDATE_OPTIONS[id];
    const answer = Object.hasOwn(answers, id) ? answers[id] : null;
    const raw = answer?.probabilities;
    let probs = [];
    if (TYPES[id] === "noul") {
      const p = answer?.noul;
      if (typeof p === "number") probs = [p, 1 - p];
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)
               && Object.keys(raw).length === options.length && options.every((k) => Object.hasOwn(raw, k))) {
      probs = options.map((k) => raw[k]);
    }
    if (probs.length !== options.length || probs.some((p) => typeof p !== "number" || !(p >= 0 && p <= 1))) {
      return [id, [...options]];
    }
    const ranked = options.map((value, i) => ({ value, probability: probs[i] }))
      .sort((a, b) => b.probability - a.probability);
    const chosen = ranked.filter((p) => p.probability + 1e-9 >= spec.cut);
    return [id, (chosen.length ? chosen : ranked).map((p) => p.value)];
  }));
}

'''.splitlines()


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


def _python_picture() -> List[str]:
    return '''
def _request(state, image_dir):
    """Strip row metadata and load its picture. Files are read only from image_dir (default: working directory)."""
    if not isinstance(state, dict):
        if "box" in TYPES.values():
            raise ValueError("Box questions need a picture row with _image.")
        return state, {}
    state = {k: v for k, v in state.items() if k not in ("_expect", "_test")}
    if "_image" not in state:
        if "box" in TYPES.values():
            raise ValueError("Box questions need a picture row with _image.")
        return state, {}
    name = state.pop("_image")
    if "photo" in state:
        raise ValueError("A picture row cannot also have its own photo field.")
    if not isinstance(name, str) or (name not in SAMPLES and not re.fullmatch(r"[0-9a-f]{16}\\.(png|jpg)", name)):
        raise ValueError("_image must name a sample picture or a saved Workbench picture filename.")
    path = Path(image_dir) / (name + ".png" if name in SAMPLES else name)
    if not path.is_file():
        raise ValueError("Missing picture file: %s. Copy it into image_dir first." % path)
    ref = "photo_" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:16]
    state["photo"] = ref
    return state, {ref: Image(path)}


'''.splitlines()


def _python(questions: Dict[str, dict], gates: Dict[str, float], signal: str, model: str, origin: str,
            rules: List[dict], answer_sets: dict) -> str:
    types = {qid: q["type"] for qid, q in questions.items()}
    names = sorted({"Choice", "Image", "Noul", "NoulCriteria", "Score", "TypeSafeClient"}
                   | ({"Box"} if workbench.has_box(questions) else set()))
    reads = _PY_SIGNAL[signal]
    lines = [
        '"""A confidence gate exported from Jev Lab: decide(state) asks Jev, then routes in code.',
        "",
        origin,
        "Confirm them on labeled rows from your own traffic before you rely on them.",
        "",
        "Needs: pip install typesafe-sdk (Python 3.10+), and TYPESAFE_API_KEY in the environment.",
        "Run:   python gate.py < rows.jsonl   (one row per line: a JSON object, or text sent as {\"%s\": text})" % FIELD,
        "Pictures: copy the named files into the working directory, or call decide(state, client, image_dir=...).",
        "Box needs Jev 1.14+. Its coordinates are output only; Choice/Noul/Score decide routing.",
        '"""',
        "",
        "import json",
        "import sys",
        "import hashlib",
        "import re",
        "from pathlib import Path",
        "",
        "from typesafe_sdk import %s" % ", ".join(names),
        "",
        "MODEL = %r" % model,
        "SIGNAL = %r  # what each threshold is compared with" % signal,
        "THRESHOLDS = %s" % _py(gates),
        "TYPES = %s" % _py(types),
        "FIELD = %r  # a text row becomes {FIELD: text}, as in Jev Lab's Bulk" % FIELD,
        "# Consistency rules: a row whose answers break one, or lack an answer one needs, goes to review.",
        "RULES = %s" % _py(rules),
        "# Copy sample PNGs from static/img/samples and uploads from data/workbench/images into image_dir.",
        "SAMPLES = %s" % _py(list(images.SAMPLES)),
        "",
    ] + workbench.python_questions(questions) + [
        "",
        "",
        "def _answer(result, qid):",
        "    group = {\"choice\": \"choices\", \"noul\": \"nouls\", \"score\": \"scores\", \"box\": \"boxes\"}[TYPES[qid]]",
        "    return getattr(result, group, {}).get(qid)",
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
        "    if qtype == \"box\":",
        "        return {edge: getattr(answer.box, edge) for edge in (\"left\", \"top\", \"right\", \"bottom\")}",
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
        "def _holds(condition, answers):",
        '    """Whether one condition holds for answers as decide() shows them; None when the answer is missing."""',
        "    qid, op, values = condition",
        "    answer = answers.get(qid)",
        "    if answer is None:",
        "        return None",
        "    text = (\"yes\" if answer else \"no\") if isinstance(answer, bool) else str(answer)",
        "    if op in (\">=\", \"<=\", \">\", \"<\"):",
        "        a, b = int(text), int(values[0])",
        "        return {\">=\": a >= b, \"<=\": a <= b, \">\": a > b, \"<\": a < b}[op]",
        "    return (text in values) == (op in (\"=\", \"in\"))",
        "",
        "",
        "def broken_rules(answers):",
        '    """The rules these answers break, or cannot be checked against: every `if` holds and some `then` does not."""',
        "    out = []",
        "    for rule in RULES:",
        "        found = [_holds(c, answers) for c in rule[\"if\"]]",
        "        if False in found:",
        "            continue",
        "        then = [_holds(c, answers) for c in rule[\"then\"]]",
        "        if None in found or False in then or None in then:",
        "            out.append(rule[\"rule\"])",
        "    return out",
        "",
        "",
    ] + _python_picture() + [
        "def decide(state, client=None, image_dir=\".\"):",
        '    """{"route": "auto" or "review", "held": [...], "rules": [...], "answers": {...}} for one state. One model call."""',
        "    state, assets = _request(state, image_dir)",
        "    client = client or TypeSafeClient(model=MODEL)  # reads TYPESAFE_API_KEY",
        "    options = {\"assets\": assets, \"extra_headers\": {\"TypeSafe-Danger-Zone-Images\": \"true\"}} if assets else {}",
        "    result = client.system_one(state, questions, model=MODEL, **options)",
        "    held = held_by(result)",
        "    answers = {}",
        "    for qid, qtype in TYPES.items():",
        "        answer = _answer(result, qid)",
        "        answers[qid] = None if answer is None else value(answer, qtype)",
        "    rules = broken_rules(answers)",
        "    route = \"review\" if held or rules else \"auto\"",
        "    return {\"route\": route, \"held\": held, \"rules\": rules, \"answers\": answers}",
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
        "    row.pop(%r, None)  # held-out test marker, not model input" % workbench.TEST_KEY,
        "    return row",
        "",
        "",
        "def main():",
        "    client = TypeSafeClient(model=MODEL)",
        "    for line in sys.stdin:",
        "        if line.strip():",
        "            row = _row(line.strip())",
        "            # The row goes with its decision, so Jev Lab's Review queue can add it to the dataset once labeled.",
        "            print(json.dumps(dict(decide(row, client), row=row)), flush=True)",
        "",
        "",
        "if __name__ == \"__main__\":",
        "    main()",
    ]
    if answer_sets:
        at = lines.index('def decide(state, client=None, image_dir="."):')
        lines[at:at] = _python_candidates(questions, answer_sets)
        at = lines.index('    return {"route": route, "held": held, "rules": rules, "answers": answers}')
        lines[at] = ('    return {"route": route, "held": held, "rules": rules, "answers": answers, '
                     '"candidates": candidates(result)}')
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


def _javascript_picture() -> List[str]:
    return '''
async function pictureRequest(state, imageDir) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    if (Object.values(TYPES).includes("box")) throw new Error("Box questions need a picture row with _image.");
    return { state };
  }
  state = Object.fromEntries(Object.entries(state).filter(([k]) => k !== "_expect" && k !== "_test"));
  if (!Object.hasOwn(state, "_image")) {
    if (Object.values(TYPES).includes("box")) throw new Error("Box questions need a picture row with _image.");
    return { state };
  }
  const name = state._image;
  delete state._image;
  if (Object.hasOwn(state, "photo")) throw new Error("A picture row cannot also have its own photo field.");
  if (typeof name !== "string" || (!SAMPLES.includes(name) && !/^[0-9a-f]{16}\\.(png|jpg)$/.test(name))) {
    throw new Error("_image must name a sample picture or a saved Workbench picture filename.");
  }
  const file = join(imageDir, SAMPLES.includes(name) ? name + ".png" : name);
  const ref = "photo_" + createHash("sha256").update(name, "utf8").digest("hex").slice(0, 16);
  state.photo = ref;
  return { state, assets: { [ref]: image(await openAsBlob(file)) } };
}

'''.splitlines()


def _javascript(questions: Dict[str, dict], gates: Dict[str, float], signal: str, model: str, origin: str,
                rules: List[dict], answer_sets: dict) -> str:
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
        "// Pictures: copy the named files into the working directory, or call decide(state, client, imageDir).",
        "// Box needs Jev 1.14+. Its coordinates are output only; Choice/Noul/Score decide routing.",
        "",
        "import { createInterface } from \"node:readline\";",
        "import { pathToFileURL } from \"node:url\";",
        "import { openAsBlob } from \"node:fs\";",
        "import { join } from \"node:path\";",
        "import { createHash } from \"node:crypto\";",
        "import { image, TypeSafeClient } from \"@typesafe-ai/sdk\";",
        "",
        "export const MODEL = %s;" % json.dumps(model),
        "export const SIGNAL = %s; // what each threshold is compared with" % json.dumps(signal),
        "export const THRESHOLDS = %s;" % dumps(gates),
        "const TYPES = %s;" % dumps(types),
        "const FIELD = %s; // a text row becomes {FIELD: text}, as in Jev Lab's Bulk" % json.dumps(FIELD),
        "// Consistency rules: a row whose answers break one, or lack an answer one needs, goes to review.",
        "export const RULES = %s;" % dumps(rules),
        "// Copy sample PNGs from static/img/samples and uploads from data/workbench/images into imageDir.",
        "const SAMPLES = %s;" % dumps(list(images.SAMPLES)),
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
        "  if (type === \"box\") return Object.fromEntries([\"left\", \"top\", \"right\", \"bottom\"].map((k) => [k, answer.box[k]]));",
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
        "// Whether one condition holds for answers as decide() shows them; null when the answer is missing.",
        "function holds([id, op, values], shown) {",
        "  const answer = Object.hasOwn(shown, id) ? shown[id] : null;",
        "  if (answer === null || answer === undefined) return null;",
        "  const text = typeof answer === \"boolean\" ? (answer ? \"yes\" : \"no\") : String(answer);",
        "  const a = Number(text), b = Number(values[0]);",
        "  if (op === \">=\") return a >= b;",
        "  if (op === \"<=\") return a <= b;",
        "  if (op === \">\") return a > b;",
        "  if (op === \"<\") return a < b;",
        "  return values.includes(text) === (op === \"=\" || op === \"in\");",
        "}",
        "",
        "// The rules these answers break, or cannot be checked against: every `if` holds and some `then` does not.",
        "export function brokenRules(shown) {",
        "  return RULES.filter((rule) => {",
        "    const found = rule.if.map((c) => holds(c, shown));",
        "    if (found.includes(false)) return false;",
        "    const then = rule.then.map((c) => holds(c, shown));",
        "    return found.includes(null) || then.includes(false) || then.includes(null);",
        "  }).map((rule) => rule.rule);",
        "}",
        "",
        "let shared;",
        "",
    ] + _javascript_picture() + [
        "// {route: \"auto\" or \"review\", held: [...], rules: [...], answers: {...}} for one state. One model call.",
        "export async function decide(state, client, imageDir = \".\") {",
        "  const request = await pictureRequest(state, imageDir);",
        "  client ??= (shared ??= new TypeSafeClient());",
        "  const { answers } = await client.systemOne({ ...request, model: MODEL, questions },",
        "    request.assets ? { headers: { \"TypeSafe-Danger-Zone-Images\": \"true\" } } : undefined);",
        "  const held = heldBy(answers);",
        "  const shown = Object.fromEntries(Object.entries(TYPES).map(([id, type]) =>",
        "    [id, Object.hasOwn(answers, id) ? value(answers[id], type) : null]));",
        "  const rules = brokenRules(shown);",
        "  return { route: held.length || rules.length ? \"review\" : \"auto\", held, rules, answers: shown };",
        "}",
        "",
        "function row(line) {",
        "  try {",
        "    const parsed = JSON.parse(line);",
        "    if (parsed && typeof parsed === \"object\" && !Array.isArray(parsed)) {",
        "      delete parsed[%s]; // a labeled Bulk row's labels: the model never sees them, as in Bulk" % json.dumps(workbench.LABEL_KEY),
        "      delete parsed[%s]; // held-out test marker, not model input" % json.dumps(workbench.TEST_KEY),
        "      return parsed;",
        "    }",
        "  } catch { /* text */ }",
        "  return { [FIELD]: line };",
        "}",
        "",
        "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {",
        "  for await (const line of createInterface({ input: process.stdin })) {",
        "    if (!line.trim()) continue;",
        "    const state = row(line.trim());",
        "    // The row goes with its decision, so Jev Lab's Review queue can add it to the dataset once labeled.",
        "    console.log(JSON.stringify({ ...(await decide(state)), row: state }));",
        "  }",
        "}",
    ]
    if answer_sets:
        at = lines.index("let shared;")
        lines[at:at] = _javascript_candidates(questions, answer_sets)
        at = lines.index('  return { route: held.length || rules.length ? "review" : "auto", held, rules, answers: shown };')
        lines[at] = ('  return { route: held.length || rules.length ? "review" : "auto", held, rules, answers: shown, '
                     'candidates: candidates(answers) };')
    return "\n".join(lines) + "\n"
