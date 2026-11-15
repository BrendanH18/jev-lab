// More facts, checks, metrics, exports and commands for the Find page's result cards ("find.results", contract:
// static/js/lab/surfaces/find.js): question length, headings and sections among the listed lines, the top line's
// position in the document, answer-exists against the top line, word overlap between question and top line (a local
// rule), a strength band, the second line's text, a 1,000-search cost projection, top-line and JSON exports, and
// commands that copy the focused question, focus the weakest one and count the verdicts. Everything reads the user's
// own latest search in this page load; nothing searches, and every local rule is advisory, never the model's answer.
import { definePack } from "../../kit.js";
import { codePoints } from "../../lib/text.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const queryOf = (item) => (typeof item?.query === "string" ? item.query : "");
const listedHits = (item) => (Array.isArray(item?.hits) ? item.hits.filter((hit) => hit && hit.listed) : []);
const LONG_QUESTION = 25;
const pct = (value) => (finite(value) === null ? "—" : `${Math.round(value * 100)}%`);
const oneLine = (text) => String(text ?? "").replace(/[\r\n]+/g, " ");

// Words that say little about where an answer is. Content words are the other words of four or more letters.
const STOP = new Set(["what", "when", "where", "which", "while", "does", "have", "this", "that", "there", "their", "with", "about", "before",
  "after", "much", "many", "your", "from", "they", "them", "will", "would", "could", "should", "into", "than", "then", "were", "been", "being"]);
const contentWords = (text) => new Set((String(text ?? "").toLowerCase().match(/\p{L}+/gu) || []).filter((word) => word.length >= 4 && !STOP.has(word)));

// Local rule: the question and its top line share a content word.
function overlaps(item) {
  if (!item?.top) return null;
  const line = contentWords(item.top.text);
  return [...contentWords(queryOf(item))].some((word) => line.has(word));
}

// A band of the top line's probability, for grouping only: strong 60% or more, moderate 30% to 60%, weak under 30%.
function strength(item) {
  const p = finite(item?.top_prob);
  if (p === null) return null;
  return p >= 0.6 ? "strong" : p >= 0.3 ? "moderate" : "weak";
}

const focusedItem = (ctx) => ctx.items().find((item) => item.position === ctx.data.focus) || null;
// The shown question with the lowest answer-exists probability (the first on a tie), or null.
function weakest(ctx) {
  let best = null;
  for (const item of ctx.shown()) {
    const p = finite(item.exists);
    if (p !== null && (best === null || p < best.exists)) best = item;
  }
  return best;
}

export default definePack({
  id: "find-results-extra",
  surface: "find.results",
  title: "More result facts",
  about: "Question length, heading lines and sections among the listed lines, the top line's line number, answer-exists minus the top line's probability, a question mark, the focused question, a number in the top line, word overlap between question and top line (a local rule), a strength band and the second line's text; checks for an answered question whose top line shares no word with it, a result with no lines and a long question; mean top-line probability, distinct top lines and a 1,000-search cost projection; top-line and JSON exports that hold answers; and commands to copy the focused question, focus the weakest one and count the verdicts.",
  features: [
    { id: "query_chars", kind: "fact", type: "number", label: "question length in characters", unit: "characters",
      value: (item) => codePoints(queryOf(item).trim()) || null },
    { id: "heading_hits", kind: "fact", type: "number", label: "section headings among the listed lines", unit: "lines",
      value: (item) => { const hits = listedHits(item); return hits.length ? hits.filter((hit) => hit.heading).length : null; } },
    { id: "sections_listed", kind: "fact", type: "number", label: "sections the listed lines come from", unit: "sections",
      help: "Lines above the first heading count as one section of their own.",
      value: (item) => { const hits = listedHits(item); return hits.length ? new Set(hits.map((hit) => hit.section ?? "")).size : null; } },
    { id: "top_line_number", kind: "fact", type: "number", label: "line number of the top line", unit: "line", help: "1 is the document's first line (L000).",
      value: (item) => { const index = item?.top?.index; return Number.isInteger(index) ? index + 1 : null; } },
    { id: "exists_gap", kind: "fact", type: "number", label: "answer-exists minus the top line's probability", unit: "−1 to 1",
      help: "Large and positive: the document likely answers it, but no single line carries the answer.",
      value: (item) => { const exists = finite(item?.exists), top = finite(item?.top_prob); return exists === null || top === null ? null : exists - top; } },
    { id: "ends_question_mark", kind: "fact", type: "flag", label: "question mark at the end", value: (item) => queryOf(item).trim().endsWith("?") },
    { id: "focused", kind: "fact", type: "flag", label: "the focused question", value: (item, ctx) => item?.position === ctx?.data?.focus },
    { id: "top_has_number", kind: "fact", type: "flag", label: "number in the top line", value: (item) => /\p{N}/u.test(item?.top?.text ?? "") },
    { id: "word_overlap", kind: "fact", type: "flag", label: "question and top line share a word (local rule)",
      help: "A word of four or more letters, apart from common question words, appears in both.", value: (item) => overlaps(item) === true },
    { id: "strength", kind: "fact", type: "category", label: "top line strength",
      help: "Local bands of the top line's probability: strong (60% or more), moderate (30% to 60%), weak (under 30%).", value: strength },
    { id: "second_text", kind: "fact", type: "text", label: "second line text", value: (item) => item?.hits?.[1]?.text ?? "" },

    { id: "no_overlap", kind: "diagnostic", severity: "info", label: "Answered, but the top line shares no word with the question",
      help: "Local rule. A match by meaning is fine; worth reading the line before relying on it.",
      check: (item) => (item?.verdict === "answered" && overlaps(item) === false
        ? `${item.top.id || "The top line"} shares no word with the question; check it answers what you asked.` : null) },
    { id: "no_hits", kind: "diagnostic", severity: "info", label: "No lines listed",
      check: (item) => (Array.isArray(item?.hits) && item.hits.length === 0 ? "The answer listed no lines for this question." : null) },
    { id: "long_question", kind: "diagnostic", severity: "advice", label: `Question over ${LONG_QUESTION} words`,
      check: (item) => {
        const count = queryOf(item).split(/\s+/).filter(Boolean).length;
        return count > LONG_QUESTION ? `${count} words. One short question per box is easier to place on a line.` : null;
      } },

    { id: "mean_top_prob", kind: "metric", format: "percent", label: "Mean top-line probability of the shown questions",
      compute: (ctx) => {
        const values = ctx.shown().map((item) => finite(item.top_prob)).filter((value) => value !== null);
        return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
      } },
    { id: "distinct_top_lines", kind: "metric", format: "integer", label: "Different top lines among the shown questions",
      compute: (ctx) => {
        const ids = ctx.shown().map((item) => item.top?.id).filter(Boolean);
        return ids.length ? new Set(ids).size : null;
      } },
    { id: "thousand_searches", kind: "metric", format: "usd", label: "Estimated cost of 1,000 searches like this one",
      help: "The measured cost of this search times 1,000. A projection, not spend.",
      compute: (ctx) => { const cost = finite(ctx.data.meta?.cost_usd); return cost === null || !ctx.items().length ? null : { value: cost * 1000, detail: "estimate" }; } },

    { id: "top_lines_md", kind: "exporter", label: "Shown questions with their top lines (Markdown; holds answers)",
      help: "per shown question: the question, its verdict, the answer-exists probability, and the top line's ID, probability and text",
      filename: "find-top-lines.md", mime: "text/markdown",
      build: (ctx) => ["# Find results: top lines", "", ...ctx.shown().flatMap((item) => [
        `${item.position}. ${oneLine(queryOf(item))} — ${item.verdict || "no verdict"}, answer-exists ${pct(item.exists)}`,
        item.top ? `   Top line ${item.top.id || "(no ID)"} at ${pct(item.top.prob)}: ${oneLine(item.top.text)}` : "   No line listed."])].join("\n") + "\n" },
    { id: "results_json", kind: "exporter", label: "Shown results as JSON (holds answers)",
      help: "position, question, verdict, answer-exists probability and the top line (ID, text, probability); no other lines and no measurements",
      filename: "find-results.json", mime: "application/json",
      build: (ctx) => `${JSON.stringify(ctx.shown().map((item) => ({ position: item.position, query: item.query, verdict: item.verdict, exists: item.exists,
        top: item.top ? { id: item.top.id, text: item.top.text, prob: item.top.prob } : null })), null, 2)}\n` },

    { id: "copy_focused_query", kind: "command", group: "Find", title: "Copy the focused question",
      when: (ctx) => !!queryOf(focusedItem(ctx)).trim(),
      run: (ctx) => {
        const item = focusedItem(ctx);
        if (!queryOf(item).trim()) throw new Error("No question is focused.");
        ctx.env.copy(item.query);
      } },
    { id: "focus_weakest", kind: "command", group: "Find", title: "Focus the shown question least likely to be answered",
      help: "The lowest answer-exists probability among the shown questions.",
      when: (ctx) => { const item = weakest(ctx); return !!item && item.position !== ctx.data.focus; },
      run: (ctx) => {
        const item = weakest(ctx);
        if (!item) throw new Error("No shown question has an answer-exists probability.");
        return ctx.actions.focusResult(item.position);
      } },
    { id: "say_verdicts", kind: "command", group: "Find", title: "Count the verdicts of the shown questions",
      when: (ctx) => ctx.shown().length > 0,
      run: (ctx) => {
        const shown = ctx.shown();
        const count = (verdict) => shown.filter((item) => item.verdict === verdict).length;
        const none = shown.filter((item) => !item.verdict).length;
        ctx.env.toast(`Verdicts of the ${shown.length} shown ${shown.length === 1 ? "question" : "questions"}: ${count("answered")} answered, ${count("partial")} partial, ${count("absent")} absent${none ? `, ${none} without a verdict` : ""}.`);
      } },
  ],
});
