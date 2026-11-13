// More for the Find page's document lines ("find.document", contract: static/js/lab/surfaces/find.js): structure,
// readability, repeated wording, and the times, amounts, dates and contacts the lines mention. Local text measures of
// the user's own document; exports hold document text only, and nothing here edits the text or searches.
import { csvText, definePack } from "../../kit.js";
import { findEmails, findIsoDates, findPhoneNumbers, findUrls, lines as rawLines, sentences as rawSentences, words } from "../../lib/text.js";

const HEADING = /^Section [A-Z]:/;
const LIKE_HEADING = /^(?:#{1,6}\s+\S|section\s+\w+\s*[:.\-–—])/i;
const textOf = (item) => (typeof item?.text === "string" ? item.text : "");
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const codePoints = (text) => Array.from(text).length;
const BEFORE = "(before the first section)";

// Times ("6:30 am", "5 pm", "14:00"), amounts ("$6.50", "40 dollars"), days and dates ("Monday", "September",
// "May 31", "2026-11-02", "4/15"). Month "May" counts only before a number, so "pets may wait" is not a date.
const TIME = /\b\d{1,2}(?::\d{2})?\s?(?:a\.m\.|p\.m\.|am|pm)(?!\p{L})|\b\d{1,2}:\d{2}\b/giu;
const MONEY = /[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|USD)\b/gi;
const DAY_WORD = /\b(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?|January|February|March|April|June|July|August|September|October|November|December|May(?= \d))\b/g;
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
// "May" before a number is the month ("due May 31"), not permission.
const MODAL = /\b(?:must|may(?!\s+\d)|should|shall|need|needs|required|cannot)\b/i;
const matchesOf = (regex, text) => Array.from(text.matchAll(regex), (match) => match[0]);
const datesIn = (text) => [...matchesOf(DAY_WORD, text), ...findIsoDates(text), ...matchesOf(SLASH_DATE, text)];

// Sentences, without splitting after a common abbreviation ("Harbor Coffee Co. Team Handbook" is one sentence).
const ABBREVIATION = /(?:^|\s)(?:Co|Inc|Ltd|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|e\.g|i\.e)\.$/;
function sentenceCount(text) {
  const pieces = [];
  for (const piece of rawSentences(text)) {
    if (pieces.length && ABBREVIATION.test(pieces[pieces.length - 1])) pieces[pieces.length - 1] += ` ${piece}`;
    else pieces.push(piece);
  }
  return pieces.length;
}

// Words with punctuation stripped from their edges, in lower case; words that are only punctuation are dropped.
const plainWords = (text) => words(text).map((word) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);

// Letters and digits only, inside a word too: "6:30" is 3 characters, "555-0142" is 7.
const letterCount = (word) => (word.match(/[\p{L}\p{N}]/gu) || []).length;

function averageWordLength(text) {
  const list = plainWords(text);
  return list.length ? list.reduce((sum, word) => sum + letterCount(word), 0) / list.length : null;
}

// How many lines sit under each heading, keyed by the heading's index, so two headings with the same text stay apart.
function sectionSizes(items) {
  const sizes = new Map();
  let heading = null;
  for (const item of items) {
    if (item?.heading) { heading = item.index; sizes.set(heading, 0); }
    else if (heading !== null) sizes.set(heading, sizes.get(heading) + 1);
  }
  return sizes;
}

// The index of the heading at or above a line, read from the document's own order; null above the first heading.
function headingIndexOf(item, items) {
  let heading = null;
  for (const entry of items) {
    if (entry?.heading) heading = entry.index;
    if (entry?.index === item?.index) return heading;
  }
  return null;
}

// The sections in document order: { title, heading (item or null), body: [items] }; lines above the first heading
// form a first group with no heading.
function sectionsOf(items) {
  const groups = [];
  for (const item of items) {
    if (item.heading) groups.push({ title: item.text, heading: item, body: [] });
    else {
      if (!groups.length) groups.push({ title: BEFORE, heading: null, body: [] });
      groups[groups.length - 1].body.push(item);
    }
  }
  return groups;
}

// Three-word phrases shared by two or more lines (ignoring case and edge punctuation), merged into longer runs where
// the same lines share them. A phrase needs a word of four letters or more, so "is on the" does not count.
function repeatedPhrases(items) {
  const lines = items.filter((item) => !item?.heading && textOf(item)).map((item) => ({ item, words: plainWords(textOf(item)) }));
  const owners = new Map();
  for (const line of lines) {
    const seen = new Set();
    for (let at = 0; at + 3 <= line.words.length; at++) {
      const gram = line.words.slice(at, at + 3);
      const key = gram.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(line.item.id);
    }
  }
  const shared = (key) => (owners.get(key)?.length > 1 ? owners.get(key).join(", ") : null);
  const out = [];
  const reported = new Set();
  for (const line of lines) {
    let run = null;
    for (let at = 0; at + 3 <= line.words.length; at++) {
      const key = line.words.slice(at, at + 3).join(" ");
      const ids = shared(key);
      if (ids && run && run.ids === ids && run.end === at + 2) { run.words.push(line.words[at + 2]); run.end += 1; reported.add(key); continue; }
      if (run) out.push(run);
      run = ids && !reported.has(key) ? { ids, words: line.words.slice(at, at + 3), end: at + 3 } : null;
      if (run) reported.add(key);
    }
    if (run) out.push(run);
  }
  const unique = new Map();
  for (const run of out) {
    const phrase = run.words.join(" ");
    if (!unique.has(phrase) && run.words.some((word) => (word.match(/\p{L}/gu) || []).length >= 4)) unique.set(phrase, run.ids);
  }
  return [...unique];
}

// A backslash before punctuation is a Markdown escape; before a digit it is not, so "1. x" becomes "1\. x".
const escapeMarkdown = (text) => text.replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2").replace(/^[#>+*_-]/, "\\$&");

function mentionsOf(text) {
  return [
    ...matchesOf(TIME, text).map((found) => ["time", found]),
    ...matchesOf(MONEY, text).map((found) => ["amount", found]),
    ...datesIn(text).map((found) => ["date", found]),
    ...findPhoneNumbers(text).map((found) => ["phone", found]),
    ...findEmails(text).map((found) => ["email", found]),
    ...findUrls(text).map((found) => ["web address", found]),
  ];
}

const focusedHeading = (ctx) => {
  const top = ctx.data?.focused?.top;
  if (!top || typeof top.section !== "string" || !Number.isInteger(top.index)) return null;
  return ctx.items().filter((item) => item.heading && item.text === top.section && item.index <= top.index).pop() || null;
};

export default definePack({
  id: "find-document-more",
  surface: "find.document",
  title: "More document tools",
  about: "Structure, readability and mention facts, heading and wording checks, measures and exports for the lines of your own "
    + "Find document. Exports hold the document text or counts of it, never answers; nothing here edits the text or searches.",
  features: [
    { id: "sentences", kind: "fact", type: "number", label: "sentence count", unit: "sentences",
      help: "Sentences end at . ! or ?; a common abbreviation such as \"Co.\" does not end one.", value: (item) => sentenceCount(textOf(item)) || null },
    { id: "section_size", kind: "fact", type: "number", label: "lines in its section", unit: "lines",
      help: "Lines under the line's section heading, not counting the heading. Not available above the first heading.",
      value: (item, ctx) => {
        if (typeof item?.section !== "string" || !Number.isInteger(item?.index) || typeof ctx?.items !== "function") return null;
        const items = ctx.items();
        const heading = headingIndexOf(item, items);
        return heading === null ? null : sectionSizes(items).get(heading) ?? null;
      } },
    { id: "word_length", kind: "fact", type: "number", label: "average word length", unit: "characters",
      help: "Letters and digits per word, punctuation left out. Long words make a line harder to read.", value: (item) => averageWordLength(textOf(item)) },
    { id: "has_time", kind: "fact", type: "flag", label: "time of day", help: "Such as 6:30 am, 5 pm or 14:00.",
      value: (item) => matchesOf(TIME, textOf(item)).length > 0 },
    { id: "has_amount", kind: "fact", type: "flag", label: "money amount", help: "Such as $6.50 or 40 dollars.",
      value: (item) => matchesOf(MONEY, textOf(item)).length > 0 },
    { id: "has_date", kind: "fact", type: "flag", label: "day or date", help: "A weekday, a month, an ISO date or a date like 4/15.",
      value: (item) => datesIn(textOf(item)).length > 0 },
    { id: "has_phone", kind: "fact", type: "flag", label: "phone number", value: (item) => findPhoneNumbers(textOf(item)).length > 0 },
    { id: "has_url", kind: "fact", type: "flag", label: "web address", value: (item) => findUrls(textOf(item)).length > 0 },
    { id: "has_modal", kind: "fact", type: "flag", label: "obligation or permission word",
      help: "must, may, should, shall, need, required or cannot: the lines that state rules.", value: (item) => MODAL.test(textOf(item)) },

    { id: "heading_order", kind: "diagnostic", severity: "advice", scope: "list", label: "Section letters out of order",
      help: "Headings should run Section A, B, C, … without repeats or gaps.",
      check: (items) => {
        const out = [];
        const first = new Map();
        let previous = null;
        for (const item of items) {
          if (!item?.heading) continue;
          const letter = textOf(item)[8];
          if (first.has(letter)) out.push(`${item.id} repeats Section ${letter} (first on ${first.get(letter)}).`);
          else {
            const expected = previous ? String.fromCharCode(previous.charCodeAt(0) + 1) : "A";
            if (letter !== expected) out.push(previous ? `${item.id} is Section ${letter} after Section ${previous}; expected Section ${expected}.`
              : `${item.id} is Section ${letter}, the first heading; expected Section A.`);
            first.set(letter, item.id);
          }
          previous = letter;
        }
        return out;
      } },
    { id: "unrecognized_heading", kind: "diagnostic", severity: "advice", label: "Heading the page does not recognize",
      check: (item) => (!item?.heading && LIKE_HEADING.test(textOf(item))
        ? "It looks like a heading, but only lines that start “Section X:” (capital S, one capital letter, a colon) count as headings, start a section and are drawn bold." : null) },
    { id: "starts_lowercase", kind: "diagnostic", severity: "advice", label: "Line starts in lower case",
      check: (item) => (!item?.heading && /^\p{Ll}/u.test(textOf(item))
        ? "It starts with a lowercase letter, as a sentence continued from the line above does. Join the two so one line holds the whole sentence." : null) },
    { id: "all_caps", kind: "diagnostic", severity: "advice", label: "Line in capitals",
      check: (item) => {
        const letters = textOf(item).match(/\p{L}/gu) || [];
        return letters.length >= 4 && !/\p{Ll}/u.test(textOf(item))
          ? "Written in capitals. If it is a heading, write it as “Section X: Title”; otherwise sentence case reads more easily." : null;
      } },
    { id: "repeated_phrase", kind: "diagnostic", severity: "info", scope: "list", label: "Wording shared by several lines",
      help: "Three or more words in a row on two or more lines, ignoring case and punctuation. Headings are left out.",
      check: (items) => repeatedPhrases(items).map(([phrase, ids]) => `“${phrase}” is on ${ids}. Lines that share wording compete for the same questions.`) },

    { id: "total_words", kind: "metric", format: "integer", label: "Words in the document",
      compute: (ctx) => (ctx.items().length ? ctx.items().reduce((sum, item) => sum + words(textOf(item)).length, 0) : null) },
    { id: "median_section_lines", kind: "metric", format: "number", label: "Median lines per section",
      help: "Lines under each section heading, not counting the heading; lines above the first heading are left out.",
      compute: (ctx) => {
        const counts = sectionsOf(ctx.items()).filter((group) => group.heading).map((group) => group.body.length).sort((a, b) => a - b);
        if (!counts.length) return null;
        const middle = counts.length >> 1;
        return { value: counts.length % 2 ? counts[middle] : (counts[middle - 1] + counts[middle]) / 2, detail: `over ${plural(counts.length, "section")}` };
      } },
    { id: "words_per_sentence", kind: "metric", format: "number", label: "Mean words per sentence",
      help: "Over every line that is not a heading. Long sentences are harder to read and to match.",
      compute: (ctx) => {
        const body = ctx.items().filter((item) => !item.heading);
        const count = body.reduce((sum, item) => sum + sentenceCount(textOf(item)), 0);
        if (!count) return null;
        return { value: body.reduce((sum, item) => sum + words(textOf(item)).length, 0) / count, detail: plural(count, "sentence") };
      } },
    { id: "blank_lines", kind: "metric", format: "integer", label: "Blank lines the page drops",
      help: "Empty or space-only lines in the text; the page and the search skip them.",
      compute: (ctx) => (ctx.items().length ? rawLines(ctx.data?.text).filter((line) => !line.trim()).length : null) },

    { id: "markdown", kind: "exporter", label: "Document as Markdown with section headings (text only)", mime: "text/markdown", filename: "find-document.md",
      help: "Every line of the document as a paragraph, with Section lines as ## headings. No answers.",
      build: (ctx) => {
        const blocks = ctx.items().map((item) => (item.heading ? `## ${item.text}` : escapeMarkdown(item.text)));
        return blocks.length ? `${blocks.join("\n\n")}\n` : "";
      } },
    { id: "section_stats", kind: "exporter", label: "Lines, words and characters per section (CSV)", mime: "text/csv", filename: "find-section-stats.csv",
      help: "One row per section of the whole document, counting the lines under its heading. Section names and counts only.",
      build: (ctx) => csvText([["section", "heading line", "lines", "words", "characters"],
        ...sectionsOf(ctx.items()).map((group) => [group.title, group.heading?.id ?? "", group.body.length,
          group.body.reduce((sum, item) => sum + words(textOf(item)).length, 0), group.body.reduce((sum, item) => sum + codePoints(textOf(item)), 0)])]) },
    { id: "mentions", kind: "exporter", label: "Times, amounts, dates and contacts in the shown lines (CSV)", mime: "text/csv", filename: "find-mentions.csv",
      help: "One row per time, money amount, day or date, phone number, email or web address found, with its line id. Text from your document only.",
      build: (ctx) => csvText([["line", "kind", "mention"], ...ctx.shown().flatMap((item) => mentionsOf(textOf(item)).map(([kind, found]) => [item.id, kind, found]))]) },
    { id: "unsearched", kind: "exporter", label: "Lines past 255 that Find does not search (text only)", filename: "find-unsearched-lines.txt",
      help: "Every line after the first 255 as \"L255| text\". Empty when the whole document is searched.",
      build: (ctx) => ctx.items().filter((item) => !item.searched).map((item) => `${item.id}| ${item.text}\n`).join("") },

    { id: "focused_section", kind: "command", group: "Find", title: "Scroll to the focused question's section heading",
      when: (ctx) => !ctx.data?.editing && !!focusedHeading(ctx),
      run: (ctx) => {
        const heading = focusedHeading(ctx);
        if (!heading) throw new Error("The focused question's top line has no section heading.");
        return ctx.actions.showLine(heading.index);
      } },
    { id: "longest_line", kind: "command", group: "Find", title: "Scroll to the longest shown line",
      when: (ctx) => !ctx.data?.editing && ctx.shown().length > 0,
      run: (ctx) => {
        const shown = ctx.shown();
        if (!shown.length) throw new Error("No line is shown.");
        const longest = shown.reduce((best, item) => (codePoints(textOf(item)) > codePoints(textOf(best)) ? item : best));
        return ctx.actions.showLine(longest.index);
      } },
  ],
});
