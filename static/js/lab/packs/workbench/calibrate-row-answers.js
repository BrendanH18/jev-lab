// Answer and input facts for Calibrate's scored rows (surface "workbench.calibrate"; contract in
// static/js/lab/surfaces/workbench-analysis.js): the answer and its runner-up option as categories, the reviewer's
// answer-set list, how far the label trailed the answer, and the row's input, with a check and metrics on the shown
// rows. Arithmetic on the user's own Bulk run in this page session: no model call, no storage. Answer sets only
// assist review; thresholds and rules decide automation.
import { definePack } from "../../kit.js";

const EPS = 1e-9;
const CLASSES = ["choice", "score"];

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const typeOf = (item, ctx) => item?.type || ctx?.data?.type || null;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A Choice or Score answer's options, most likely first (ties keep the answer's own order).
function ranked(item) {
  const answer = item?.answer;
  if (!isObject(answer) || !CLASSES.includes(answer.type) || !isObject(answer.probabilities)) return null;
  const options = Object.entries(answer.probabilities).filter(([, p]) => num(p) !== null);
  return options.length ? options.map((entry, i) => [...entry, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]) : null;
}

function labelProbability(item) {
  const answer = item?.answer;
  if (!isObject(answer) || typeof item.label !== "string") return null;
  if (answer.type === "noul") {
    const p = num(answer.noul);
    return p === null || !["yes", "no"].includes(item.label) ? null : item.label === "yes" ? p : 1 - p;
  }
  if (!CLASSES.includes(answer.type) || !isObject(answer.probabilities)) return null;
  return num(answer.probabilities[item.label]) ?? 0;
}

function inputKind(item) {
  if (typeof item?.image === "string" && item.image) return "picture";
  if (typeof item?.row === "string") return "plain text";
  if (Array.isArray(item?.row)) return "list";
  if (isObject(item?.row)) return "fields";
  return null;
}

export default definePack({
  id: "calibrate-row-answers",
  surface: "workbench.calibrate",
  title: "Calibrate: answers and inputs",
  about: "The answer and its runner-up as categories to break the scored rows down by, the reviewer's answer-set list, how far the label trailed the answer, and the row's input, with a check and metrics on the shown rows. Arithmetic on your own run in this page session; nothing calls the model.",
  features: [
    { id: "answer", kind: "fact", type: "category", label: "answer", help: "The answer as Calibrate shows it. Not for a Box, whose answers are coordinates.",
      value: (item, ctx) => (typeOf(item, ctx) === "box" || !item.predicted ? null : String(item.predicted)) },
    { id: "runner_up", kind: "fact", type: "category", label: "runner-up option",
      help: "The second most likely option of a Choice or Score answer (ties go to the option the answer lists first).",
      value: (item) => {
        const options = ranked(item);
        return options && options.length > 1 ? String(options[1][0]) : null;
      } },
    { id: "set_route", kind: "fact", type: "category", label: "size of the reviewer's list",
      help: "How many options the answer set lists for the row at the coverage Answer sets asks for. Unavailable before a fit.",
      value: (item) => {
        if (!isObject(item.set) || !Array.isArray(item.set.options)) return null;
        const n = item.set.options.length;
        return n === 0 ? "no option reaches the cut" : n === 1 ? "one option" : "two or more options";
      } },
    { id: "set_options", kind: "fact", type: "text", label: "options in the reviewer's list", help: "Most likely first, as Answer sets lists them.",
      value: (item) => (isObject(item.set) && Array.isArray(item.set.options) ? item.set.options.join(", ") : "") },
    { id: "input_length", kind: "fact", type: "number", label: "length of the row's text", help: "Characters in the row as the Bulk table prints it.",
      value: (item) => (typeof item.text === "string" && item.text ? [...item.text].length : null) },
    { id: "input_kind", kind: "fact", type: "category", label: "kind of input", help: "A picture, plain text, fields of an object, or a list.", value: inputKind },
    { id: "label_gap", kind: "fact", type: "number", label: "how far the label trailed the answer",
      help: "The answer's stated probability minus the probability it gave the label: 0 when the answer is the label. Not for a Box.",
      value: (item) => {
        const p = labelProbability(item);
        return p === null || num(item.top) === null ? null : Math.max(0, item.top - p);
      } },

    { id: "answer_never_labeled", kind: "diagnostic", severity: "advice", scope: "list", label: "Answer no shown row is labeled",
      help: "An answer the shown rows get that is never their label: the question may describe that option too broadly.",
      check: (rows, ctx) => {
        const usable = rows.filter((item) => typeOf(item, ctx) !== "box" && item.predicted && item.label);
        if (!usable.length) return null;
        const labels = new Set(usable.map((item) => String(item.label)));
        const answered = new Map();
        for (const item of usable) answered.set(String(item.predicted), (answered.get(String(item.predicted)) || 0) + 1);
        return [...answered].filter(([answer]) => !labels.has(answer))
          .map(([answer, n]) => `“${answer}” is the answer of ${plural(n, "shown row")} but no shown row's label: check how the question describes it.`);
      } },

    { id: "runner_up_recovery", kind: "metric", format: "percent", label: "share of shown mistakes whose label was the runner-up",
      help: "Of the wrong Choice and Score rows shown, how many put the label second: a two-option shortlist would have held it.",
      compute: (ctx) => {
        const wrong = ctx.shown().filter((item) => item.correct === false && ranked(item)?.length > 1);
        if (!wrong.length) return null;
        const second = wrong.filter((item) => String(ranked(item)[1][0]) === String(item.label)).length;
        return { value: second / wrong.length, detail: `${second} of ${plural(wrong.length, "wrong row")}` };
      } },
    { id: "mean_set_size", kind: "metric", format: "number", label: "average options in the reviewer's list over the shown rows",
      compute: (ctx) => {
        const sets = ctx.shown().filter((item) => isObject(item.set) && Array.isArray(item.set.options));
        if (!sets.length) return null;
        const total = sets.reduce((sum, item) => sum + item.set.options.length, 0);
        return { value: total / sets.length, detail: `${total} options over ${plural(sets.length, "row")}${Math.abs(total / sets.length - 1) < EPS ? ": every row gets one" : ""}` };
      } },
  ],
});
