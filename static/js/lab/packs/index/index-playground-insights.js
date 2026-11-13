// Starter pack for the Overview playground ("index.playground", contract: static/js/lab/surfaces/index.js).
// It reads only the answers of the user's own calls in this page session and never asks the model.
import { csvText, definePack } from "../../kit.js";

// A local, advisory rule: two options closer than this are a "close call". It is plain code, not the model's answer.
const CLOSE = 0.1;

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const probs = (item) => (Array.isArray(item?.probabilities) ? item.probabilities.filter((entry) => finite(entry?.p) !== null) : []);

function margin(item) {
  const sorted = probs(item).map((entry) => entry.p).sort((a, b) => b - a);
  return sorted.length >= 2 ? sorted[0] - sorted[1] : null;
}

// Shannon entropy of the listed probabilities over its maximum (ln n): 0 is certain, 1 is evenly spread.
function uncertainty(item) {
  const list = probs(item);
  if (list.length < 2) return null;
  let entropy = 0;
  for (const { p } of list) if (p > 0) entropy -= p * Math.log(p);
  return entropy / Math.log(list.length);
}

const topP = (item) => finite(item?.top?.p);
const percent = (value) => (value === null ? "" : `${(value * 100).toFixed(1)}%`);

function chosenText(item) {
  const criteria = Array.isArray(item?.criteria) ? item.criteria : [];
  if (item?.type === "choice" && typeof item.value === "string") return criteria.find((entry) => entry.key === item.value)?.text || "";
  if (item?.type === "score" && finite(item.value) !== null) return criteria.find((entry) => entry.key === String(Math.round(item.value)))?.text || "";
  return "";
}

function band(item) {
  const p = topP(item);
  if (p === null) return null;
  return p >= 0.9 ? "high (90% or more)" : p >= 0.6 ? "medium (60% to 90%)" : "low (under 60%)";
}

const history = (ctx) => (Array.isArray(ctx.data?.history) ? ctx.data.history : []);
const measured = (ctx, field) => history(ctx).map((entry) => finite(entry?.meta?.[field])).filter((value) => value !== null);
const topLabel = (item) => (item.top ? `${item.top.key} (${percent(item.top.p)})` : "");

export default definePack({
  id: "index-playground-insights",
  surface: "index.playground",
  title: "Playground insights",
  about: "Filters, checks, measurements and exports over the answers of your own playground calls in this page session. "
    + "Close calls and bands are local rules, projections are labeled as arithmetic, and the request export carries no answers.",
  features: [
    { id: "top_p", kind: "fact", type: "number", label: "top probability", unit: "0 to 1", value: topP },
    { id: "margin", kind: "fact", type: "number", label: "margin over the runner-up", unit: "0 to 1",
      help: "Top probability minus the second highest.", value: margin },
    { id: "uncertainty", kind: "fact", type: "number", label: "normalized uncertainty", unit: "0 to 1",
      help: "Entropy of the listed probabilities: 0 is certain, 1 is evenly spread.", value: uncertainty },
    { id: "confidence", kind: "fact", type: "number", label: "reported confidence", unit: "0 to 1", value: (item) => finite(item.confidence) },
    { id: "yes_p", kind: "fact", type: "number", label: "yes probability", unit: "0 to 1", help: "Yes/no (Noul) answers only.",
      value: (item) => (item.type === "noul" ? finite(item.value) : null) },
    { id: "score_share", kind: "fact", type: "number", label: "score as a share of its scale", unit: "0 to 1",
      value: (item) => (item.type === "score" && finite(item.value) !== null && finite(item.scale) ? item.value / item.scale : null) },
    { id: "question_words", kind: "fact", type: "number", label: "question word count", unit: "words",
      value: (item) => {
        const words = String(item.instructions || "").split(/\s+/).filter(Boolean).length;
        return words || null;
      } },
    { id: "close_call", kind: "fact", type: "flag", label: "close call under 10 points",
      help: "Local rule: the top two probabilities are less than 0.10 apart.", value: (item) => {
        const value = margin(item);
        return value !== null && value < CLOSE;
      } },
    { id: "differs_from_top", kind: "fact", type: "flag", label: "answer that differs from its most likely option",
      help: "A Choice whose chosen key is not the top probability, or a Score that rounds to another level.", value: (item) => {
        if (!item.top) return false;
        if (item.type === "choice") return typeof item.value === "string" && item.value !== item.top.key;
        if (item.type === "score") return finite(item.value) !== null && String(Math.round(item.value)) !== item.top.key;
        return false;
      } },
    { id: "leans_yes", kind: "fact", type: "flag", label: "yes-leaning answer", help: "Yes/no answers above one half.",
      value: (item) => item.type === "noul" && finite(item.value) !== null && item.value > 0.5 },
    { id: "missing_value", kind: "fact", type: "flag", label: "missing answer value",
      value: (item) => item.value === null && !item.box },
    { id: "type", kind: "fact", type: "category", label: "question type", value: (item) => item.type || null },
    { id: "band", kind: "fact", type: "category", label: "top probability band", help: "Local bands, not a model judgment.", value: band },
    { id: "chosen_text", kind: "fact", type: "text", label: "chosen option description", value: chosenText },

    { id: "sum_check", kind: "diagnostic", severity: "info", label: "Probabilities that do not add up to one",
      check: (item) => {
        if (item.type !== "choice" && item.type !== "score") return null;
        const list = probs(item);
        if (!list.length) return null;
        const sum = list.reduce((total, entry) => total + entry.p, 0);
        return Math.abs(sum - 1) > 0.02 ? `The listed probabilities add up to ${percent(sum)}.` : null;
      } },
    { id: "middle_noul", kind: "diagnostic", severity: "advice", label: "Yes/no answer near one half",
      check: (item) => {
        const p = item.type === "noul" ? finite(item.value) : null;
        return p !== null && p >= 0.4 && p <= 0.6 ? `P(yes) is ${percent(p)}. A local rule would send this to a person rather than act on it.` : null;
      } },
    { id: "stale", kind: "diagnostic", severity: "advice", scope: "list", label: "Answers for earlier text",
      check: (items, ctx) => (items.length && ctx.data?.stale ? "These answers were made for earlier text, not what the box holds now." : null) },

    { id: "session_latency", kind: "metric", format: "ms", label: "Mean measured latency this session",
      compute: (ctx) => {
        const values = measured(ctx, "latency_ms");
        return values.length ? { value: values.reduce((a, b) => a + b, 0) / values.length, detail: `measured over ${values.length} call${values.length === 1 ? "" : "s"}` } : null;
      } },
    { id: "session_cost", kind: "metric", format: "usd", label: "Measured cost of this session's calls",
      compute: (ctx) => {
        const values = measured(ctx, "cost_usd");
        return values.length ? { value: values.reduce((a, b) => a + b, 0), detail: `${values.length} call${values.length === 1 ? "" : "s"}` } : null;
      } },
    { id: "per_thousand", kind: "metric", format: "usd", label: "Projected cost of 1,000 calls like the shown one",
      help: "Arithmetic on one measured call, not spend.",
      compute: (ctx) => {
        const cost = finite(ctx.data?.meta?.cost_usd);
        return cost === null ? null : { value: cost * 1000, detail: "projection" };
      } },
    { id: "tokens_per_question", kind: "metric", format: "number", label: "Input tokens per question in the shown call",
      compute: (ctx) => {
        const tokens = finite(ctx.data?.meta?.input_tokens), count = finite(ctx.data?.meta?.question_count);
        return tokens === null || !count ? null : tokens / count;
      } },
    { id: "mean_top_p", kind: "metric", format: "percent", label: "Mean top probability of the shown answers",
      compute: (ctx) => {
        const values = ctx.shown().map(topP).filter((value) => value !== null);
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      } },
    { id: "close_calls", kind: "metric", format: "integer", label: "Close calls among the shown answers",
      help: "Local rule: top two less than 0.10 apart.",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? shown.filter((item) => { const value = margin(item); return value !== null && value < CLOSE; }).length : null;
      } },

    { id: "answers_csv", kind: "exporter", label: "Shown answers as CSV", help: "contains model answers and probabilities from your calls",
      filename: "playground-answers.csv", mime: "text/csv",
      build: (ctx) => csvText([["question", "type", "answer", "top option", "top probability", "confidence"],
        ...ctx.shown().map((item) => [item.id, item.type, item.display, item.top ? item.top.key : "", topP(item) ?? "", finite(item.confidence) ?? ""])]) },
    { id: "answers_markdown", kind: "exporter", label: "Shown answers as a Markdown table", help: "contains model answers from your calls",
      filename: "playground-answers.md", mime: "text/markdown",
      build: (ctx) => ["| Question | Type | Answer | Top option |", "| --- | --- | --- | --- |",
        ...ctx.shown().map((item) => `| ${[item.id, item.type, item.display || "—", topLabel(item) || "—"].map((cell) => String(cell).replaceAll("|", "\\|")).join(" | ")} |`)].join("\n") + "\n" },
    { id: "request_json", kind: "exporter", label: "Request for the Workbench as JSON", help: "state, model and questions only; no answers",
      filename: "playground-request.json", mime: "application/json",
      build: (ctx) => {
        const request = ctx.data?.request;
        if (!request) throw new Error("Run the playground first: there is no request yet.");
        return `${JSON.stringify({ state: request.state, model: request.model, questions: request.questions }, null, 2)}\n`;
      } },
    { id: "session_csv", kind: "exporter", label: "This session's call measurements as CSV", help: "latency, tokens and measured cost; no text or answers",
      filename: "playground-calls.csv", mime: "text/csv",
      build: (ctx) => csvText([["call", "time", "model", "latency_ms", "input_tokens", "cost_usd"],
        ...history(ctx).map((entry) => [entry.call ?? "", finite(entry.at) === null ? "" : new Date(entry.at).toISOString(), entry.meta?.model ?? "",
          finite(entry.meta?.latency_ms) ?? "", finite(entry.meta?.input_tokens) ?? "", finite(entry.meta?.cost_usd) ?? ""])]) },

    { id: "inspect", kind: "command", title: "Inspect the playground request", group: "Playground", keys: "Alt+Shift+J",
      when: (ctx) => ctx.items().length > 0, run: (ctx) => ctx.actions.inspect() },
    { id: "focus_text", kind: "command", title: "Focus the playground text", group: "Playground", keys: "Alt+Shift+P",
      run: (ctx) => ctx.actions.focusText() },
    { id: "restore_text", kind: "command", title: "Put the shown answers' text back in the box", group: "Playground",
      when: (ctx) => ctx.data?.stale === true && typeof ctx.data.text === "string",
      run: (ctx) => {
        ctx.actions.draftText(ctx.data.text);
        ctx.env?.toast?.("The text of the shown answers is back in the box. Edit it to ask again.");
      } },
    { id: "copy_summary", kind: "command", title: "Copy the shown answers as plain text", group: "Playground",
      when: (ctx) => ctx.shown().length > 0,
      run: (ctx) => ctx.env.copy(ctx.shown().map((item) => `${item.id}: ${item.display || "no value"}${item.top ? ` (top ${topLabel(item)})` : ""}`).join("\n")) },
  ],
});
