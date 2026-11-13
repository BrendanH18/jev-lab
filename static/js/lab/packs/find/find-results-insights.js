// Starter pack for the Find page's result cards ("find.results", contract: static/js/lab/surfaces/find.js).
// It reads only the user's own latest search in this page load and never searches: commands focus a card, scroll the
// document or copy a line. Rules such as "close call" or "disagrees" are plain local code, labeled as such.
import { csvText, definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const points = (value) => (value * 100).toFixed(1);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const hitsOf = (item) => (Array.isArray(item?.hits) ? item.hits : []);

function secondProb(item) {
  const hit = hitsOf(item)[1];
  return hit ? finite(hit.prob) : null;
}

// How far the top line leads the second; null without two probabilities.
function leadOf(item) {
  const top = finite(item?.top_prob), second = secondProb(item);
  return top === null || second === null ? null : top - second;
}

// Local rule: "absent" with a top line of 50% or more, or "answered" with a top line under 20%.
function disagrees(item) {
  const top = finite(item?.top_prob);
  if (top === null) return false;
  return (item.verdict === "absent" && top >= 0.5) || (item.verdict === "answered" && top < 0.2);
}

const cell = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
const probCell = (value) => (finite(value) === null ? "" : String(value));

// The shown questions in shown order, and the next one after the focused one (wrapping), or the first.
function step(ctx, direction) {
  const shown = ctx.shown();
  if (!shown.length) throw new Error("No question is shown.");
  const at = shown.findIndex((item) => item.position === ctx.data.focus);
  const next = at === -1 ? (direction > 0 ? 0 : shown.length - 1) : (at + direction + shown.length) % shown.length;
  return ctx.actions.focusResult(shown[next].position);
}

const focusedItem = (ctx) => ctx.items().find((item) => item.position === ctx.data.focus) || null;

export default definePack({
  id: "find-results-insights",
  surface: "find.results",
  title: "Result insights",
  about: "Filters, checks, measurements, exports and shortcuts over the result cards of your own latest Find search. "
    + "Exports say when they hold answers; nothing here searches, and local rules are labeled as advisory.",
  features: [
    { id: "top_prob", kind: "fact", type: "number", label: "top line probability", unit: "0 to 1",
      help: "The where-probability of the line ranked first.", value: (item) => finite(item?.top_prob) },
    { id: "exists_p", kind: "fact", type: "number", label: "answer-exists probability", unit: "0 to 1",
      help: "The Noul: does any line answer the question?", value: (item) => finite(item?.exists) },
    { id: "runner_up", kind: "fact", type: "number", label: "second line probability", unit: "0 to 1", value: secondProb },
    { id: "lead", kind: "fact", type: "number", label: "lead of the top line over the second", unit: "0 to 1",
      help: "Top line probability minus the second line's. Small means two lines compete.", value: leadOf },
    { id: "confidence", kind: "fact", type: "number", label: "where-question confidence", unit: "0 to 1", value: (item) => finite(item?.confidence) },
    { id: "listed", kind: "fact", type: "number", label: "lines listed on the card", unit: "lines",
      help: "Hits the card lists: the top line and any other at 1% or more.", value: (item) => (Array.isArray(item?.hits) ? item.hits.filter((hit) => hit?.listed).length : null) },
    { id: "query_words", kind: "fact", type: "number", label: "question word count", unit: "words",
      value: (item) => String(item?.query ?? "").split(/\s+/).filter(Boolean).length || null },
    { id: "verdict", kind: "fact", type: "category", label: "verdict", value: (item) => item?.verdict || null },
    { id: "top_section", kind: "fact", type: "category", label: "section of the top line",
      help: "The Section heading above the top line; \"no section\" for a line above the first heading.",
      value: (item) => (item?.top ? item.top.section || "no section" : null) },
    { id: "query_text", kind: "fact", type: "text", label: "question text", value: (item) => item?.query ?? "" },
    { id: "top_text", kind: "fact", type: "text", label: "top line text", value: (item) => item?.top?.text ?? "" },
    { id: "strong_top", kind: "fact", type: "flag", label: "top line at 50% or more", value: (item) => (finite(item?.top_prob) ?? 0) >= 0.5 },
    { id: "disagrees", kind: "fact", type: "flag", label: "verdict and top line disagree",
      help: "Local rule: absent with a top line of 50% or more, or answered with a top line under 20%.", value: disagrees },
    { id: "top_heading", kind: "fact", type: "flag", label: "top line is a section heading", value: (item) => item?.top?.heading === true },
    { id: "spread", kind: "fact", type: "flag", label: "listed lines from more than one section",
      value: (item) => new Set(hitsOf(item).filter((hit) => hit?.listed).map((hit) => hit.section || "")).size > 1 },

    { id: "close_call", kind: "diagnostic", severity: "advice", label: "Top two lines are close",
      check: (item) => {
        const lead = leadOf(item);
        if (lead === null || lead >= 0.1) return null;
        return `The top line leads the second by only ${points(lead)} points (${hitsOf(item)[0].id} vs ${hitsOf(item)[1].id}). Read both before trusting either (local rule: under 10 points).`;
      } },
    { id: "partial", kind: "diagnostic", severity: "info", label: "Partial verdict",
      check: (item, ctx) => {
        if (item?.verdict !== "partial") return null;
        const t = ctx?.data?.thresholds || { found: 0.7, absent: 0.35 };
        const exists = finite(item.exists);
        return `exists is ${exists === null ? "between the thresholds" : percent(exists)}, between absent (< ${percent(t.absent)}) and answered (≥ ${percent(t.found)}). Check the top line by hand.`;
      } },
    { id: "shared_top", kind: "diagnostic", severity: "advice", scope: "list", label: "Several questions share a top line",
      check: (items) => {
        const groups = new Map();
        for (const item of items) {
          const id = item?.top?.id;
          if (!id) continue;
          if (!groups.has(id)) groups.set(id, []);
          groups.get(id).push(item.position);
        }
        return [...groups].filter(([, positions]) => positions.length > 1)
          .map(([id, positions]) => `${id} is the top line for ${positions.length} questions (${positions.map((position) => `Q${position}`).join(", ")}). One of them may be asking something the document does not say.`);
      } },

    { id: "answered_share", kind: "metric", format: "percent", label: "Share of shown questions answered",
      help: "Verdict answered, among the shown questions.",
      compute: (ctx) => {
        const shown = ctx.shown();
        if (!shown.length) return null;
        const answered = shown.filter((item) => item.verdict === "answered").length;
        return { value: answered / shown.length, detail: `${answered} of ${shown.length}` };
      } },
    { id: "mean_top", kind: "metric", format: "percent", label: "Mean top line probability of the shown questions",
      compute: (ctx) => {
        const values = ctx.shown().map((item) => finite(item.top_prob)).filter((value) => value !== null);
        return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
      } },
    { id: "cost_per_question", kind: "metric", format: "usd", label: "Measured search cost per question",
      help: "The one call's measured cost divided by its questions: arithmetic on measured spend, not a separate charge.",
      compute: (ctx) => {
        const cost = finite(ctx.data?.meta?.cost_usd), count = ctx.items().length;
        return cost === null || !count ? null : { value: cost / count, detail: `${plural(count, "question")} in one call` };
      } },
    { id: "tokens_per_line", kind: "metric", format: "number", label: "Measured input tokens per searched line",
      help: "Input tokens of the call divided by the lines it searched.",
      compute: (ctx) => {
        const tokens = finite(ctx.data?.meta?.input_tokens), lines = finite(ctx.data?.lines);
        return tokens === null || !lines ? null : tokens / lines;
      } },

    { id: "results_csv", kind: "exporter", label: "Shown results as CSV (holds answers)", mime: "text/csv", filename: "find-results.csv",
      help: "Question, verdict, exists, top line and its probability, from your own search.",
      build: (ctx) => csvText([["question", "verdict", "exists", "top line", "top probability", "top line text"],
        ...ctx.shown().map((item) => [item.query, item.verdict ?? "", probCell(item.exists), item.top?.id ?? "", probCell(item.top_prob), item.top?.text ?? ""])]) },
    { id: "results_markdown", kind: "exporter", label: "Shown results as a Markdown table (holds answers)", mime: "text/markdown", filename: "find-results.md",
      build: (ctx) => ["| Question | Verdict | Exists | Top line |", "| --- | --- | --- | --- |",
        ...ctx.shown().map((item) => `| ${cell(item.query)} | ${item.verdict ?? "—"} | ${finite(item.exists) === null ? "—" : percent(item.exists)} | ${item.top ? `${item.top.id} ${cell(item.top.text)}` : "—"} |`)].join("\n") + "\n" },
    { id: "questions_text", kind: "exporter", label: "Questions only, one per line (no answers)", filename: "find-questions.txt",
      help: "The searched questions in their original order, to reuse in another search.",
      build: (ctx) => (ctx.items().length ? ctx.items().map((item) => item.query).join("\n") + "\n" : "") },

    { id: "next_question", kind: "command", group: "Find", title: "Focus the next shown question", keys: "Alt+Shift+ArrowDown",
      when: (ctx) => ctx.shown().length > 0, run: (ctx) => step(ctx, 1) },
    { id: "previous_question", kind: "command", group: "Find", title: "Focus the previous shown question", keys: "Alt+Shift+ArrowUp",
      when: (ctx) => ctx.shown().length > 0, run: (ctx) => step(ctx, -1) },
    { id: "show_top", kind: "command", group: "Find", title: "Scroll to the focused question's top line",
      when: (ctx) => !!focusedItem(ctx)?.top, run: (ctx) => ctx.actions.showHit(ctx.data.focus, 1) },
    { id: "copy_top", kind: "command", group: "Find", title: "Copy the focused question's top line",
      when: (ctx) => !!focusedItem(ctx)?.top,
      run: (ctx) => {
        const top = focusedItem(ctx)?.top;
        if (!top) throw new Error("No question is focused.");
        ctx.env.copy(`${top.id}| ${top.text}`);
      } },
  ],
});
