// Starter pack for the answers of the Build tab's latest Run (surface workbench.build.result, contract in
// static/js/lab/surfaces/workbench-build.js). Every value comes from the user's own Run in this page session; rules
// applied to it (margins, expectation checks) are local, advisory code and say so.
import { csvText, definePack, toNumber } from "../../kit.js";

const hasOwn = (object, key) => !!object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const RUN_NOTE = "From your latest Run in this page session.";
const probsOf = (item) => (Array.isArray(item?.probabilities) ? item.probabilities.map((entry) => finite(entry?.p)).filter((p) => p !== null) : []);

// Top probability minus the runner-up; null with fewer than two probabilities.
function margin(item) {
  const sorted = probsOf(item).sort((a, b) => b - a);
  return sorted.length >= 2 ? sorted[0] - sorted[1] : null;
}

// Intersection over union of two boxes of edge fractions, as jev/workbench.py iou.
function iou(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = w * h;
  const area = (e) => Math.max(0, e.right - e.left) * Math.max(0, e.bottom - e.top);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

// "met" | "missed" | null (nothing to check), mirroring jev/workbench.py check_expectation for the Tests tab.
function expectationCheck(item) {
  const expect = item.expectation;
  const answer = item.answer || {};
  if (!expect) return null;
  if (item.type === "box") {
    if (!hasOwn(expect, "box") || !item.box || !expect.box || typeof expect.box !== "object") return null;
    // float() in check_expectation reads "0.5" as 0.5; an edge or floor that is not a number checks nothing.
    const edges = ["left", "top", "right", "bottom"].map((edge) => toNumber(expect.box[edge]));
    const floor = hasOwn(expect, "iou_min") ? toNumber(expect.iou_min) : 0.5;
    if (edges.includes(null) || floor === null) return null;
    const wanted = { left: edges[0], top: edges[1], right: edges[2], bottom: edges[3] };
    return iou(item.box, wanted) >= floor ? "met" : "missed";
  }
  let checked = false, ok = true, target;
  if (item.type === "choice") {
    if (hasOwn(expect, "choice")) { checked = true; ok = ok && answer.choice === expect.choice; }
    target = finite(answer.probabilities?.[answer.choice]) ?? 0;
  } else if (item.type === "score" || item.type === "noul") target = finite(item.value);
  else return null;
  if (target === null) return null;
  // check_expectation reads bounds with float(), so "0.5" counts; a bound that is not a number checks nothing.
  for (const [name, passes] of [["min", (bound) => target >= bound], ["max", (bound) => target <= bound]]) {
    if (!hasOwn(expect, name)) continue;
    const bound = toNumber(expect[name]);
    if (bound === null) return null;
    checked = true;
    ok = ok && passes(bound);
  }
  return checked ? (ok ? "met" : "missed") : null;
}

const fixed = (value) => (finite(value) === null ? "" : value.toFixed(4));
const cell = (value) => String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n|\r/g, " ");

function shownOrRefuse(ctx) {
  const shown = ctx.shown();
  if (!shown.length) throw new Error("No answers are shown. Press Run, or clear the Lab filters.");
  return shown;
}

export default definePack({
  id: "wb-build-answer-insights",
  surface: "workbench.build.result",
  title: "Answer insights",
  about: "Margins, confidence, entropy, local expectation checks, measured per-question latency and tokens, and answer exports for the Build tab's latest Run. Everything reads your own Run in this page session; exports say they contain answers and mark them outdated when the request changed since.",
  features: [
    // ---------- facts ----------
    { id: "margin", kind: "fact", type: "number", label: "top-two margin",
      help: `Top probability minus the runner-up (for a Noul, P(yes) against P(no)). ${RUN_NOTE}`, value: (item) => margin(item) },
    { id: "confidence", kind: "fact", type: "number", label: "answer confidence", help: `The answer's own confidence; Noul answers carry none. ${RUN_NOTE}`,
      value: (item) => finite(item.confidence) },
    { id: "top_probability", kind: "fact", type: "number", label: "top probability", help: RUN_NOTE, value: (item) => finite(item.top?.p) },
    { id: "expectation_check", kind: "fact", type: "category", label: "expectation check",
      help: "met or missed against the human expectation the editor holds now, by local code that mirrors the Tests tab; unavailable without an expectation.",
      value: (item) => expectationCheck(item) },
    { id: "answer_type", kind: "fact", type: "category", label: "answer type", value: (item) => item.type || null },
    { id: "box_area", kind: "fact", type: "number", label: "box area share",
      help: "Width × height of a Box answer as a share of the picture; a box with its edges out of order has no area.",
      value: (item) => {
        const box = item.box && typeof item.box === "object" ? item.box : null;
        const edges = box ? [box.left, box.top, box.right, box.bottom].map(finite) : [null];
        return edges.includes(null) ? null : Math.max(0, edges[2] - edges[0]) * Math.max(0, edges[3] - edges[1]);
      } },
    { id: "question_gone", kind: "fact", type: "flag", label: "a question renamed or removed since the run",
      value: (item, ctx) => Array.isArray(ctx?.data?.currentIds) && !ctx.data.currentIds.includes(item.id) },
    { id: "entropy", kind: "fact", type: "number", label: "normalized entropy",
      help: "Shannon entropy of the probabilities (rescaled to add up to 1) divided by ln(number of options): 0 is all on one answer, 1 is even. Unavailable with fewer than two.",
      value: (item) => {
        const list = probsOf(item);
        const total = list.reduce((sum, p) => sum + p, 0);
        if (list.length < 2 || !(total > 0)) return null;
        return list.reduce((sum, p) => sum - (p > 0 ? (p / total) * Math.log(p / total) : 0), 0) / Math.log(list.length);
      } },

    // ---------- checks ----------
    { id: "close_call", kind: "diagnostic", severity: "advice", label: "Close call",
      check: (item) => {
        const gap = margin(item);
        return gap !== null && gap < 0.1 ? `The top two answers are within ${(gap * 100).toFixed(1)} points (local rule: under 10). Read this one before acting on it.` : null;
      } },
    { id: "between_levels", kind: "diagnostic", severity: "advice", label: "Score between two levels",
      check: (item) => {
        const score = item.type === "score" ? finite(item.value) : null;
        if (score === null) return null;
        const low = Math.floor(score);
        // The epsilon keeps a score exactly 0.3 from a level (1.3, whose difference reads 0.30000000000000004) quiet.
        return Math.abs(score - Math.round(score)) > 0.3 + 1e-9 ? `Score ${score.toFixed(2)} sits between level ${low} and level ${low + 1} (local rule: more than 0.3 from the nearest level).` : null;
      } },
    { id: "missed_expectation", kind: "diagnostic", severity: "advice", label: "Misses its human expectation",
      check: (item) => (expectationCheck(item) === "missed" ? "This answer misses the human expectation the editor holds (local check; the Tests tab is the reference)." : null) },

    // ---------- metrics ----------
    { id: "mean_confidence", kind: "metric", format: "percent", label: "Mean confidence of the shown answers", help: `Noul answers carry no confidence. ${RUN_NOTE}`,
      compute: (ctx) => {
        const values = ctx.shown().map((item) => finite(item.confidence)).filter((value) => value !== null);
        return values.length ? { value: values.reduce((sum, value) => sum + value, 0) / values.length, detail: `${values.length} answers` } : null;
      } },
    { id: "latency_per_question", kind: "metric", format: "ms", label: "Measured latency per question", help: "The Run's latency divided by its question count.",
      compute: (ctx) => {
        const latency = finite(ctx.data.meta?.latency_ms), count = finite(ctx.data.meta?.question_count);
        return latency !== null && count ? latency / count : null;
      } },
    { id: "tokens_per_question", kind: "metric", format: "number", label: "Measured tokens per question", help: "Input plus output tokens of the Run, divided by its question count.",
      compute: (ctx) => {
        const meta = ctx.data.meta || {};
        const input = finite(meta.input_tokens), output = finite(meta.output_tokens), count = finite(meta.question_count);
        return input !== null && output !== null && count ? (input + output) / count : null;
      } },
    { id: "cost_per_thousand", kind: "metric", format: "usd", label: "1,000 runs like this one (projection)",
      help: "Arithmetic on the measured cost of this Run, not spend; other inputs cost more or less.",
      compute: (ctx) => {
        const cost = finite(ctx.data.meta?.cost_usd);
        return cost === null ? null : { value: cost * 1000, detail: ctx.data.stale ? "from the previous request" : "" };
      } },
    { id: "expectations_met", kind: "metric", format: "percent", label: "Shown answers meeting their expectation (local check)",
      compute: (ctx) => {
        const checks = ctx.shown().map(expectationCheck).filter(Boolean);
        return checks.length ? { value: checks.filter((check) => check === "met").length / checks.length, detail: `${checks.length} checked` } : null;
      } },

    // ---------- copy and download ----------
    { id: "answers_csv", kind: "exporter", label: "Shown answers as CSV", help: "includes answers, probabilities and confidence from your latest Run; no state",
      filename: "jev-build-answers.csv", mime: "text/csv",
      build: (ctx) => csvText([["question", "type", "answer", "top_probability", "confidence", "margin", "outdated"],
        ...shownOrRefuse(ctx).map((item) => [item.id, item.type, item.display, fixed(item.top?.p), fixed(item.confidence), fixed(margin(item)), ctx.data.stale ? "yes" : "no"])]) },
    { id: "answers_markdown", kind: "exporter", label: "Shown answers as a Markdown table", help: "includes answers and confidence from your latest Run; no state",
      filename: "jev-build-answers.md", mime: "text/markdown",
      build: (ctx) => {
        const rows = shownOrRefuse(ctx).map((item) => `| ${cell(item.id)} | ${item.type} | ${cell(item.display || "—")} | ${finite(item.confidence) === null ? "—" : `${Math.round(item.confidence * 100)}%`} |`);
        const note = ctx.data.stale ? "Answers from your latest Run in this page session, OUTDATED: the request changed since." : "Answers from your latest Run in this page session.";
        return `${note}\n\n| Question | Type | Answer | Confidence |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`;
      } },

    // ---------- commands ----------
    { id: "inspect_run", kind: "command", title: "Inspect the Run's request and response", group: "Build", keys: "Alt+Shift+I",
      when: (ctx) => ctx.items().length > 0, run: (ctx) => ctx.actions.inspect() },
    { id: "save_as_test", kind: "command", title: "Save these answers as a test", group: "Build",
      when: (ctx) => ctx.items().length > 0 && !ctx.data.stale, run: (ctx) => ctx.actions.openSave() },
  ],
});
