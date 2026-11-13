// More for the Find page's result cards ("find.results", contract: static/js/lab/surfaces/find.js): the shape of each
// question's line probabilities, how questions rank each other's lines, how much of the document a search touches,
// and exports. Everything reads only the user's own latest search in this page load; nothing here searches. Local
// rules ("flat", "near a cut-off") are plain code, labeled as advisory, never as the model's answer.
import { csvText, definePack } from "../../kit.js";

const HEADING = /^Section [A-Z]:/;
const NEAR = 0.05;        // local rule: "near a verdict cut-off" is within 5 points
const FLAT = 0.8;         // local rule: a spread above 0.8 is "flat"
const EPSILON = 1e-9;     // so 0.75 - 0.70 counts as 5 points, not 5.000000000000004
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const hitsOf = (item) => (Array.isArray(item?.hits) ? item.hits.filter((hit) => hit && typeof hit === "object") : []);
const probsOf = (item) => (Array.isArray(item?.line_probs) ? item.line_probs : null);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const probCell = (value) => (finite(value) === null ? "" : String(value));
const wordsOf = (text) => String(text ?? "").split(/\s+/).filter(Boolean);
// Lowercase words with punctuation stripped from their edges: "Dog?" and "dog" are the same word.
const plainWords = (text) => wordsOf(text).map((word) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);

// The searched lines' texts by index, from the request's tagged document ("L000| text"), or null without one.
function searchedTexts(ctx) {
  const document = ctx?.data?.request?.state?.document;
  if (typeof document !== "string") return null;
  const out = [];
  for (const line of document.split("\n")) {
    const match = line.match(/^L(\d+)\| ?(.*)$/);
    if (match) out[Number(match[1])] = match[2];
  }
  return out;
}

// The section heading at or above every searched line (null above the first heading), or null without a request.
function sectionsOf(ctx) {
  const texts = searchedTexts(ctx);
  if (!texts) return null;
  let section = null;
  return Array.from(texts, (text) => {
    if (typeof text === "string" && HEADING.test(text)) section = text;
    return section;
  });
}

// Sum of the five hits' probabilities; null when a hit has none (the sum would be a guess).
function hitMass(item) {
  const hits = hitsOf(item);
  if (!hits.length || hits.some((hit) => finite(hit.prob) === null)) return null;
  return hits.reduce((total, hit) => total + hit.prob, 0);
}

// Normalized entropy of the line probabilities: 0 when one line holds everything, 1 when every line is equal.
function spreadOf(item) {
  const probs = probsOf(item);
  if (!probs || probs.length < 2) return null;
  const known = probs.map(finite).filter((value) => value !== null && value > 0);
  const total = known.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  const entropy = -known.reduce((sum, value) => sum + (value / total) * Math.log(value / total), 0);
  // One line holding everything gives -0 (shown as "-0"); rounding can also step a hair outside 0..1.
  return Math.min(1, Math.max(0, entropy / Math.log(probs.length)));
}

const highlighted = (item, min) => {
  const probs = probsOf(item);
  return probs ? probs.filter((value) => finite(value) !== null && value >= min).length : null;
};

function sectionMass(item, ctx) {
  const probs = probsOf(item), sections = sectionsOf(ctx), top = item?.top;
  if (!probs || !sections || !top || !Number.isInteger(top.index) || top.index >= sections.length) return null;
  const section = sections[top.index] ?? null;
  return probs.reduce((sum, value, index) => sum + ((sections[index] ?? null) === section && finite(value) !== null ? value : 0), 0);
}

// Where this question ranks the focused question's top line: 1 + the lines it gives strictly more.
function focusTopRank(item, ctx) {
  const focus = ctx?.data?.focus;
  const focused = typeof ctx?.items === "function" ? ctx.items().find((entry) => entry.position === focus) : null;
  const index = focused?.top?.index;
  const probs = probsOf(item);
  if (!probs || !Number.isInteger(index) || index >= probs.length) return null;
  const own = finite(probs[index]);
  if (own === null) return null;
  return 1 + probs.filter((value) => finite(value) !== null && value > own).length;
}

function sameSectionTop2(item) {
  const [first, second] = hitsOf(item);
  return !!first && !!second && typeof first.section === "string" && first.section === second.section;
}

const cutoffs = (ctx) => {
  const t = ctx?.data?.thresholds, rules = ctx?.data?.rules || { found: 0.7, absent: 0.35 };
  return { found: finite(t?.found) ?? rules.found, absent: finite(t?.absent) ?? rules.absent };
};

function nearThreshold(item, ctx) {
  const exists = finite(item?.exists);
  if (exists === null) return false;
  const { found, absent } = cutoffs(ctx);
  return Math.abs(exists - found) <= NEAR + EPSILON || Math.abs(exists - absent) <= NEAR + EPSILON;
}

const focusedItem = (ctx) => ctx.items().find((item) => item.position === ctx.data?.focus) || null;

export default definePack({
  id: "find-results-more",
  surface: "find.results",
  title: "More result insights",
  about: "Probability shape, cross-question rank, section and document coverage facts, checks, measurements and exports "
    + "for the result cards of your own latest Find search. Exports say when they hold answers; the handoff holds the document and questions only.",
  features: [
    { id: "hit_mass", kind: "fact", type: "number", label: "probability of the five likeliest lines together", unit: "0 to 1",
      help: "The sum of the five hits' where-probabilities, listed on the card or not. Not available when a hit has no number.", value: hitMass },
    { id: "spread", kind: "fact", type: "number", label: "spread of line probabilities", unit: "0 to 1",
      help: "Normalized entropy over every searched line: 0 when one line holds all the probability, 1 when every line is equal.", value: spreadOf },
    { id: "highlighted", kind: "fact", type: "number", label: "lines at 5% or more", unit: "lines",
      help: "Searched lines whose where-probability is at least 5%, the lines the document highlights for this question.",
      value: (item, ctx) => highlighted(item, finite(ctx?.data?.rules?.highlight_min) ?? 0.05) },
    { id: "third_prob", kind: "fact", type: "number", label: "third line probability", unit: "0 to 1",
      value: (item) => finite(hitsOf(item)[2]?.prob) },
    { id: "section_mass", kind: "fact", type: "number", label: "probability inside the top line's section", unit: "0 to 1",
      help: "The where-probability of every line in the same section as the top line, added up. High means one section holds the answer.",
      value: sectionMass },
    { id: "focus_top_rank", kind: "fact", type: "number", label: "rank of the focused question's top line", unit: "rank",
      help: "Where this question ranks the line the focused question ranks first (1 is first). Shows which questions point at the same line.",
      value: focusTopRank },
    { id: "same_section_top2", kind: "fact", type: "flag", label: "top two lines in the same section",
      value: sameSectionTop2 },
    { id: "near_threshold", kind: "fact", type: "flag", label: "answer-exists within 5 points of a verdict cut-off",
      help: "Local rule: the exists probability is within 5 points of the server's answered or absent cut-off, so a small change would flip the verdict.",
      value: nearThreshold },
    { id: "opening_word", kind: "fact", type: "category", label: "question's first word",
      help: "The question's first word in lower case (what, how, can, is, …).", value: (item) => plainWords(item?.query)[0] || null },

    { id: "short_question", kind: "diagnostic", severity: "advice", label: "Very short question",
      check: (item) => {
        const count = wordsOf(item?.query).length;
        return count > 0 && count < 3 ? `Only ${plural(count, "word")}. A fuller question (who, what, when) gives Find more to match a line against.` : null;
      } },
    { id: "flat_answered", kind: "diagnostic", severity: "advice", label: "Answered, but no line stands out",
      check: (item) => {
        const spread = spreadOf(item);
        if (item?.verdict !== "answered" || spread === null || spread <= FLAT) return null;
        return `The verdict is answered, yet the line probabilities are spread evenly (spread ${spread.toFixed(2)}; local rule: over ${FLAT}). Read the listed lines; the answer may be split across several.`;
      } },
    { id: "absent_many_listed", kind: "diagnostic", severity: "info", label: "Absent, yet many lines listed",
      check: (item) => {
        const listed = hitsOf(item).filter((hit) => hit.listed).length;
        return item?.verdict === "absent" && listed >= 4 ? `The verdict is absent, but the card lists ${listed} lines. They are near misses, not answers.` : null;
      } },
    { id: "first_line_top", kind: "diagnostic", severity: "advice", label: "Top line is the document's first line",
      check: (item) => (item?.top && item.top.index === 0
        ? `The top line is ${item.top.id || "L000"}, the first line, often a title. A title rarely answers a question; check the lines below it.` : null) },
    { id: "duplicate_questions", kind: "diagnostic", severity: "advice", scope: "list", label: "Questions with the same words",
      help: "Ignoring case and punctuation.",
      check: (items) => {
        const groups = new Map();
        for (const item of items) {
          const key = plainWords(item?.query).join(" ");
          if (!key) continue;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item.position);
        }
        return [...groups.values()].filter((group) => group.length > 1)
          .map((group) => `${group.map((position) => `Q${position}`).join(", ")} ask the same words. Drop the copy to make room for another question.`);
      } },
    { id: "stale_result", kind: "diagnostic", severity: "info", scope: "list", label: "Results are for other questions",
      check: (items, ctx) => (items.length && ctx?.data?.stale === true
        ? "The question boxes no longer hold the questions these results answer. Press Search to answer the new ones." : null) },
    { id: "truncated_document", kind: "diagnostic", severity: "advice", scope: "list", label: "Document was cut at 255 lines",
      check: (items, ctx) => (items.length && ctx?.data?.truncated === true
        ? `Only the first ${ctx.data.rules?.max_lines ?? 255} lines were searched. An answer past that line could not be found; an absent verdict may be wrong.` : null) },

    { id: "mean_exists", kind: "metric", format: "percent", label: "Mean answer-exists probability of the shown questions",
      compute: (ctx) => {
        const values = ctx.shown().map((item) => finite(item?.exists)).filter((value) => value !== null);
        return values.length ? { value: values.reduce((sum, value) => sum + value, 0) / values.length, detail: `over ${plural(values.length, "question")}` } : null;
      } },
    { id: "document_coverage", kind: "metric", format: "percent", label: "Share of searched lines highlighted by a shown question",
      help: "Lines at 5% or more for at least one shown question, out of the lines searched.",
      compute: (ctx) => {
        const lines = finite(ctx.data?.lines);
        const lists = ctx.shown().map(probsOf).filter(Boolean);
        if (!lines || !lists.length) return null;
        const min = finite(ctx.data?.rules?.highlight_min) ?? 0.05;
        const touched = new Set();
        for (const probs of lists) probs.forEach((value, index) => { if (finite(value) !== null && value >= min) touched.add(index); });
        return { value: touched.size / lines, detail: `${touched.size} of ${plural(lines, "line")}` };
      } },
    { id: "latency_per_question", kind: "metric", format: "ms", label: "Measured latency per question",
      help: "The one call's measured latency divided by its questions: arithmetic on one measurement, since every question rides in the same call.",
      compute: (ctx) => {
        const latency = finite(ctx.data?.meta?.latency_ms), count = ctx.items().length;
        return latency === null || !count ? null : { value: latency / count, detail: `${plural(count, "question")} in one call` };
      } },

    { id: "hits_csv", kind: "exporter", label: "Every hit of the shown questions as CSV (holds answers)", mime: "text/csv", filename: "find-hits.csv",
      help: "One row per hit: question, rank, line, probability, whether the card lists it, section and line text, from your own search.",
      build: (ctx) => csvText([["question", "query", "rank", "line", "probability", "listed", "section", "text"],
        ...ctx.shown().flatMap((item) => hitsOf(item).map((hit) => [`Q${item.position}`, item.query, hit.rank, hit.id, probCell(hit.prob),
          hit.listed ? "yes" : "no", hit.section ?? "", hit.text]))]) },
    { id: "handoff_json", kind: "exporter", label: "Search handoff as JSON: document lines and questions (no answers)", mime: "application/json",
      filename: "find-search-handoff.json",
      help: "The searched lines (untagged) and the questions as they were sent, to repeat the search elsewhere. No verdicts, probabilities or measurements.",
      build: (ctx) => {
        const texts = searchedTexts(ctx) || [];
        return `${JSON.stringify({ questions: [...(ctx.data?.searched || [])], document: Array.from(texts, (text) => text ?? "") }, null, 2)}\n`;
      } },
    { id: "focused_probs_csv", kind: "exporter", label: "Focused question's probability for every line as CSV (holds answers)", mime: "text/csv",
      filename: (ctx) => `find-q${ctx.data?.focus ?? 0}-line-probabilities.csv`,
      help: "One row per searched line: its id, the focused question's where-probability (blank when the response held none) and the line text.",
      build: (ctx) => {
        const item = focusedItem(ctx);
        const probs = probsOf(item);
        if (!probs) return "";
        const texts = searchedTexts(ctx) || [];
        return csvText([["line", "probability", "text"], ...probs.map((value, index) => [`L${String(index).padStart(3, "0")}`, probCell(value), texts[index] ?? ""])]);
      } },
  ],
});
