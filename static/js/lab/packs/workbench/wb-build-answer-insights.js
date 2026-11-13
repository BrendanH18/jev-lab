// Starter pack for the answers of the Build tab's latest Run (surface workbench.build.result, contract in
// static/js/lab/surfaces/workbench-build.js). Every value comes from the user's own Run in this page session; rules
// applied to it (margins, expectation checks) are local, advisory code and say so.
import { csvText, definePack } from "../../kit.js";

const hasOwn = (object, key) => !!object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const RUN_NOTE = "From your latest Run in this page session.";

// Top probability minus the runner-up; null with fewer than two probabilities.
function margin(item) {
  const sorted = (item.probabilities || []).map((entry) => entry.p).sort((a, b) => b - a);
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
    if (!hasOwn(expect, "box") || !item.box) return null;
    return iou(item.box, expect.box) >= (finite(expect.iou_min) ?? 0.5) ? "met" : "missed";
  }
  let checked = false, ok = true, target;
  if (item.type === "choice") {
    if (hasOwn(expect, "choice")) { checked = true; ok = ok && answer.choice === expect.choice; }
    target = finite(answer.probabilities?.[answer.choice]) ?? 0;
  } else if (item.type === "score" || item.type === "noul") target = finite(item.value);
  else return null;
  if (target === null) return null;
  if (hasOwn(expect, "min")) { checked = true; ok = ok && target >= expect.min; }
  if (hasOwn(expect, "max")) { checked = true; ok = ok && target <= expect.max; }
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
  about: "Margins, confidence, local expectation checks, measured per-question cost and latency, and answer exports for the Build tab's latest Run. Everything reads your own Run in this page session; exports say they contain answers.",
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
    { id: "shown_answer", kind: "fact", type: "text", label: "answer as shown", help: "What the answer card prints.", value: (item) => item.display },
    { id: "box_area", kind: "fact", type: "number", label: "box area share", help: "Width × height of a Box answer as a share of the picture.",
      value: (item) => (item.box ? (item.box.right - item.box.left) * (item.box.bottom - item.box.top) : null) },
    { id: "question_gone", kind: "fact", type: "flag", label: "a question renamed or removed since the run",
      value: (item, ctx) => !ctx.data.currentIds.includes(item.id) },
    { id: "entropy", kind: "fact", type: "number", label: "normalized entropy",
      help: "Spread of the probabilities from 0 (all on one answer) to 1 (even); unavailable with fewer than two.",
      value: (item) => {
        const list = (item.probabilities || []).map((entry) => entry.p);
        if (list.length < 2) return null;
        return list.reduce((sum, p) => sum - (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(list.length);
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
        return Math.abs(score - Math.round(score)) > 0.3 ? `Score ${score.toFixed(2)} sits between level ${low} and level ${low + 1}.` : null;
      } },
    { id: "missed_expectation", kind: "diagnostic", severity: "advice", label: "Misses its human expectation",
      check: (item) => (expectationCheck(item) === "missed" ? "This answer misses the human expectation the editor holds (local check; the Tests tab is the reference)." : null) },
    { id: "outdated_answers", kind: "diagnostic", scope: "list", severity: "info", label: "Outdated answers",
      check: (items, ctx) => (items.length && ctx.data.stale ? "These answers are from the previous request: the inputs or questions changed since this Run." : null) },

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
