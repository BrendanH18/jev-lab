// Starter pack for the Find page's document lines ("find.document", contract: static/js/lab/surfaces/find.js).
// Local text tools: filters, checks for line shapes that hurt line-by-line search, previewed edits, imports and
// exports of the user's own document. Facts that read probabilities use only the user's own latest search, and
// nothing here searches: an applied edit drops the old results, as editing the text by hand does.
import { csvText, definePack } from "../../kit.js";
import { findEmails, sentences } from "../../lib/text.js";

const HEADING = /^Section [A-Z]:/;
const LIMIT = 60000;
const LONG = 300;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const textOf = (item) => (typeof item?.text === "string" ? item.text : "");
const wordsOf = (text) => text.split(/\s+/).filter(Boolean).length;
const codePoints = (text) => Array.from(text).length;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const lineId = (index) => `L${String(index).padStart(3, "0")}`;
// Case and spacing do not make a line different.
const normalized = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();
// A line that stops mid-sentence: it ends with a lowercase letter, a comma or a semicolon.
const wrapped = (text) => !HEADING.test(text) && /[\p{Ll},;]$/u.test(text);

// Canonical items for a list of line texts, as find.document's replaceItems requires (see the contract).
function relabel(texts) {
  let section = null;
  return texts.map((text, index) => {
    const heading = HEADING.test(text);
    if (heading) section = text;
    return { index, id: lineId(index), text, heading, section, searched: index < 255 };
  });
}

const probsAt = (result, index) => (Array.isArray(result?.line_probs) && Number.isInteger(index) ? finite(result.line_probs[index]) : null);
const results = (ctx) => (Array.isArray(ctx?.data?.results) ? ctx.data.results : []);
const topIndexes = (ctx) => new Set(results(ctx).map((result) => result?.top?.index).filter(Number.isInteger));

// A line's sentences, split at . ! or ? followed by a space. A piece stays with the one before it when that one ends in
// a common abbreviation ("Co.", "e.g.", "a.m.") or when it starts in lower case, so "Harbor Coffee Co. Team Handbook"
// and "open at 6 a.m. daily" stay whole.
const ABBREVIATION = /(?:^|\s)(?:Co|Inc|Ltd|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|No|e\.g|i\.e|a\.m|p\.m)\.$/i;
function sentencesOf(text) {
  const pieces = [];
  for (const piece of sentences(text)) {
    const previous = pieces[pieces.length - 1];
    if (previous !== undefined && (ABBREVIATION.test(previous) || /^\p{Ll}/u.test(piece))) pieces[pieces.length - 1] = `${previous} ${piece}`;
    else pieces.push(piece);
  }
  return pieces;
}

// Rewrites the text of the shown lines with fn, then relabels the whole list.
const rewriteShown = (fn) => (items, _params, _ctx, shown) => relabel(items.map((item, index) => (shown.has(index) ? fn(item.text) : item.text)));

export default definePack({
  id: "find-document-tools",
  surface: "find.document",
  title: "Document tools",
  about: "Filters, checks, previewed edits, imports, exports and the characters left for the lines of your own Find document. "
    + "Exports hold the document text only; probability facts read only your own latest search, and nothing here searches.",
  features: [
    { id: "words", kind: "fact", type: "number", label: "word count", unit: "words", value: (item) => wordsOf(textOf(item)) || null },
    { id: "chars", kind: "fact", type: "number", label: "character count", unit: "characters", value: (item) => codePoints(textOf(item)) || null },
    { id: "focused_p", kind: "fact", type: "number", label: "probability for the focused question", unit: "0 to 1",
      help: "What your latest search's focused question gave this line. Not available before a search.",
      value: (item, ctx) => probsAt(ctx?.data?.focused, item?.index) },
    { id: "best_p", kind: "fact", type: "number", label: "highest probability from any question", unit: "0 to 1",
      help: "The largest where-probability any question of your latest search gave this line.",
      value: (item, ctx) => {
        const values = results(ctx).map((result) => probsAt(result, item?.index)).filter((value) => value !== null);
        return values.length ? Math.max(...values) : null;
      } },
    { id: "section", kind: "fact", type: "category", label: "section",
      help: "The Section heading at or above the line; \"no section\" above the first heading.", value: (item) => (typeof item?.section === "string" && item.section ? item.section : item?.section === null ? "no section" : null) },
    { id: "heading", kind: "fact", type: "flag", label: "section heading", value: (item) => item?.heading === true },
    { id: "has_number", kind: "fact", type: "flag", label: "number in the line", value: (item) => /\d/.test(textOf(item)) },
    { id: "has_email", kind: "fact", type: "flag", label: "email address", value: (item) => findEmails(textOf(item)).length > 0 },
    { id: "top_hit", kind: "fact", type: "flag", label: "top line of a question",
      help: "Ranked first for at least one question of your latest search.", value: (item, ctx) => topIndexes(ctx).has(item?.index) },
    { id: "line_text", kind: "fact", type: "text", label: "line text", value: (item) => textOf(item) },

    { id: "long_line", kind: "diagnostic", severity: "advice", label: "Very long line",
      check: (item) => {
        const length = codePoints(textOf(item));
        return length > LONG ? `${length} characters. Find ranks whole lines, so a long line can answer many questions at once; split it into one fact per line.` : null;
      } },
    { id: "wrapped_line", kind: "diagnostic", severity: "advice", label: "Line ends mid-sentence",
      check: (item) => (wrapped(textOf(item)) ? "It ends without closing punctuation, as text pasted with hard line breaks does. Join it with the next line so one line holds the whole answer." : null) },
    { id: "duplicate_lines", kind: "diagnostic", severity: "advice", scope: "list", label: "Repeated lines",
      check: (items) => {
        const groups = new Map();
        for (const item of items) {
          const key = normalized(textOf(item));
          if (!key) continue;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        return [...groups.values()].filter((group) => group.length > 1)
          .map((group) => `“${group[0].text}” appears on ${group.map((item) => item.id).join(", ")}. Repeated lines split the probability between them.`);
      } },
    { id: "empty_section", kind: "diagnostic", severity: "info", scope: "list", label: "Section with no lines",
      help: "A heading directly followed by another heading, or the last line of the document. Read from the whole document, so a filter that hides the next line does not hide the finding.",
      check: (items, ctx) => {
        const all = typeof ctx?.items === "function" ? ctx.items() : items;
        const byIndex = new Map(all.map((item) => [item?.index, item]));
        const last = all.length - 1;
        return items.filter((item) => item?.heading && Number.isInteger(item.index)
          && (byIndex.get(item.index + 1)?.heading === true || item.index === last))
          .map((item) => `${item.id} “${item.text}” has no lines under it.`);
      } },

    { id: "collapse_spaces", kind: "transform", label: "Collapse repeated spaces in the shown lines",
      all: rewriteShown((text) => text.replace(/\s+/g, " ").trim()) },
    { id: "straight_quotes", kind: "transform", label: "Use straight quotes in the shown lines",
      all: rewriteShown((text) => text.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"')) },
    { id: "remove_duplicates", kind: "transform", label: "Remove shown lines that repeat an earlier line",
      help: "Ignoring case and spacing. The first copy stays.",
      all: (items, _params, _ctx, shown) => {
        const seen = new Set();
        const kept = items.filter((item, index) => {
          const key = normalized(item.text);
          const repeat = seen.has(key);
          seen.add(key);
          return !(repeat && shown.has(index));
        });
        return relabel(kept.map((item) => item.text));
      } },
    { id: "join_wrapped", kind: "transform", label: "Join shown lines that end mid-sentence with the next line",
      help: "A line that ends with a lowercase letter, a comma or a semicolon, followed by a line that is not a heading.",
      all: (items, _params, _ctx, shown) => {
        const texts = [];
        let joinNext = false;
        items.forEach((item, index) => {
          if (joinNext && !HEADING.test(item.text)) texts[texts.length - 1] += ` ${item.text}`;
          else texts.push(item.text);
          joinNext = shown.has(index) && wrapped(texts[texts.length - 1]);
        });
        return relabel(texts);
      } },

    { id: "split_sentences", kind: "transform", label: "Split shown lines into one sentence per line",
      help: "Find ranks whole lines, so a line holding several facts competes for many questions. Headings stay as they are; a common abbreviation such as \"Co.\" or \"a.m.\" does not end a sentence.",
      all: (items, _params, _ctx, shown) => relabel(items.flatMap((item, index) => (shown.has(index) && !HEADING.test(item.text) ? sentencesOf(item.text) : [item.text]))) },

    { id: "chars_left", kind: "metric", format: "integer", label: "Characters left before Find's 60,000 limit",
      help: "Counted on the text as the page holds it; negative means a search would be refused.",
      compute: (ctx) => (ctx.items().length && finite(ctx.data?.chars) !== null ? (finite(ctx.data?.rules?.max_doc_chars) ?? LIMIT) - ctx.data.chars : null) },

    { id: "tagged", kind: "exporter", label: "Document as Find tags it (text only)", filename: "find-document-tagged.txt",
      help: "Every searched line as \"L000| text\", the form one search sends. No answers.",
      build: (ctx) => ctx.items().filter((item) => item.searched).map((item) => `${item.id}| ${item.text}`).join("\n") },
    { id: "outline", kind: "exporter", label: "Section outline of the whole document (Markdown)", mime: "text/markdown", filename: "find-outline.md",
      build: (ctx) => {
        const groups = [];
        for (const item of ctx.items()) {
          if (item.heading || !groups.length) groups.push({ title: item.heading ? item.text : "(before the first section)", first: item.id, last: item.id, lines: item.heading ? 0 : 1 });
          else { groups[groups.length - 1].last = item.id; groups[groups.length - 1].lines += 1; }
        }
        return groups.map((group) => `- ${group.title}: ${group.first}${group.last === group.first ? "" : `–${group.last}`}, ${plural(group.lines, "line")}\n`).join("");
      } },
    { id: "shown_csv", kind: "exporter", label: "Shown lines as CSV (id, section, text)", mime: "text/csv", filename: "find-lines.csv",
      build: (ctx) => csvText([["id", "section", "text"], ...ctx.shown().map((item) => [item.id, item.section ?? "", item.text])]) },

    { id: "plain_lines", kind: "importer", label: "Plain text, one line each",
      help: "Every nonblank line is added at the end of the document.",
      parse: (text) => {
        const lines = text.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) throw new Error("Paste at least one nonblank line.");
        const long = lines.filter((line) => codePoints(line) > LONG).length;
        return { items: lines.map((line) => ({ text: line })), warnings: long ? [`${plural(long, "line")} over ${LONG} characters; consider splitting them.`] : [] };
      } },
    { id: "bullets", kind: "importer", label: "Markdown bullet or numbered list",
      help: "Each \"- item\", \"* item\" or \"1. item\" becomes a line; other lines are skipped.",
      parse: (text) => {
        const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim());
        const items = [];
        let skipped = 0;
        for (const line of lines) {
          const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/);
          if (match) items.push({ text: match[1] });
          else skipped += 1;
        }
        if (!items.length) throw new Error("No bullet or numbered line found.");
        return { items, warnings: skipped ? [`${plural(skipped, "line")} without a bullet skipped.`] : [] };
      } },
  ],
});
