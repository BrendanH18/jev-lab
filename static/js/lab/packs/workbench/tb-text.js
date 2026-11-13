// Toolbox: text measures and helpers for writing instructions and inputs ("workbench.toolbox", group "Text"). Every
// tool is a pure function of the text typed into its form: it never reads page data, never sends the text anywhere and
// never calls the model. Finders are heuristics for spotting things in prose (static/js/lab/lib/text.js), not validators.
import { compareText, definePack } from "../../kit.js";
import { codePoints, commonPrefix, commonSuffix, escapeRegExp, findEmails, findIsoDates, findNumbers, findPhoneNumbers, findPlaceholders,
  findUrls, graphemeCount, isIdentifier, levenshtein, lineCount, lines, placeholderName, sentences, slugify, stripControlCharacters,
  toCamelCase, toKebabCase, toSnakeCase, toTitleCase, uniqueName, utf8Bytes, wordCount, words } from "../../lib/text.js";

const GROUP = "Text";
const need = (condition, message) => { if (!condition) throw new Error(message); };
const TEXT = (name = "text", label = "Text", extra = {}) => ({ name, label, type: "textarea", required: true, rows: 6, ...extra });
const CHECK = (name, label, value = false) => ({ name, label, type: "checkbox", default: value });
const yesNo = (flag) => (flag ? "yes" : "no");
const listOr = (values, none = "none") => (values.length ? values.join(", ") : none);

const isWordChar = (char) => /[\p{L}\p{N}]/u.test(char);

// A whitespace-separated word without the punctuation at its ends, in its own case ("(Refund," is "Refund"); "" when it
// has no letter or digit.
function core(token) {
  const chars = Array.from(token);
  let start = 0, end = chars.length;
  while (start < end && !isWordChar(chars[start])) start++;
  while (end > start && !isWordChar(chars[end - 1])) end--;
  return chars.slice(start, end).join("");
}
const cleanWords = (text) => words(text).map((token) => core(token).toLowerCase()).filter(Boolean);

// Occurrence counts in first-seen order: [[value, times], ...].
function tally(values, key = (value) => value) {
  const counts = new Map();
  for (const value of values) {
    const k = key(value);
    const entry = counts.get(k);
    if (entry) entry[1]++;
    else counts.set(k, [value, 1]);
  }
  return [...counts.values()];
}

// Syllables by a heuristic: accents removed, groups of vowels (a e i o u y) counted, a silent final "e" dropped (not
// in "-le" or "-ee"), at least one per word. Words with no Latin letters count one.
function syllables(word) {
  const latin = word.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z]/g, "");
  if (!latin) return 1;
  let count = (latin.match(/[aeiouy]+/g) || []).length;
  if (count > 1 && latin.endsWith("e") && !latin.endsWith("le") && !latin.endsWith("ee")) count--;
  return Math.max(1, count);
}

// Domains reserved for examples and tests by RFC 2606 and RFC 6761.
function reservedDomain(host) {
  const name = String(host).toLowerCase().replace(/\.$/, "");
  const tld = name.split(".").pop();
  return ["example", "test", "invalid", "localhost"].includes(tld) || /(?:^|\.)example\.(?:com|net|org)$/.test(name);
}
const urlHost = (url) => url.replace(/^https?:\/\//i, "").split(/[/?#:]/)[0];

const NAMES = { 0x00A0: "no-break space", 0x00AD: "soft hyphen", 0x2007: "figure space", 0x2009: "thin space", 0x200B: "zero-width space",
  0x200C: "zero-width non-joiner", 0x200D: "zero-width joiner", 0x200E: "left-to-right mark", 0x200F: "right-to-left mark", 0x2028: "line separator",
  0x2029: "paragraph separator", 0x202F: "narrow no-break space", 0x2060: "word joiner", 0xFEFF: "byte order mark" };
const codeLabel = (code) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
const INVISIBLE = /[​-‍⁠﻿­]/g;

function finder(found, noun) {
  const counts = tally(found);
  return { rows: [[`${noun} found`, found.length], [`Distinct ${noun.toLowerCase()}`, counts.length]], table: { columns: [noun.replace(/s$/, "").toLowerCase(), "times"], rows: counts } };
}

// The greedy wrap of one line: words joined by single spaces, each output line at most width code points (a word that
// is longer stays whole on its own line), every line keeping the original indentation.
function wrapLine(line, width) {
  const indent = line.match(/^\s*/)[0];
  const list = line.trim().split(/\s+/).filter(Boolean);
  if (!list.length) return [""];
  const out = [];
  let current = "";
  for (const word of list) {
    const next = current ? `${current} ${word}` : word;
    if (current && codePoints(indent + next) > width) { out.push(indent + current); current = word; }
    else current = next;
  }
  out.push(indent + current);
  return out;
}

// The line-by-line difference from a to b by the longest common subsequence: [[op, line], ...] with op " ", "-" or "+".
function diffLines(a, b, same) {
  const n = a.length, m = b.length;
  need(n * m <= 4e6, "These texts are too long to compare here (at most about 2,000 lines each).");
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = same(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && same(a[i], b[j])) { out.push([" ", b[j]]); i++; j++; }
    else if (j === m || (i < n && table[i + 1][j] >= table[i][j + 1])) out.push(["-", a[i++]]);
    else out.push(["+", b[j++]]);
  }
  return out;
}

function shorten(text, max, measure, tail) {
  if (measure(text) <= max) return text;
  const end = measure(tail) <= max ? tail : "";
  let out = "";
  for (const char of text) {
    if (measure(out + char) + measure(end) > max) break;
    out += char;
  }
  return out + end;
}

const PLACEHOLDER_STYLE = (token) => (token.startsWith("{{") ? "{{name}}" : token.startsWith("{") ? "{name}" : token.startsWith("<") ? "<name>" : "[NAME]");

export default definePack({
  id: "tb-text",
  surface: "workbench.toolbox",
  title: "Text tools",
  about: "Measures and helpers for writing instructions and inputs: sizes, sentences, readability, repeated and shared words, edit distance, finders for addresses, links, numbers, dates and placeholders, id naming, wrapping and cleanup, and line differences. They work on the text you type only and send it nowhere.",
  features: [
    { id: "text_size", kind: "tool", group: GROUP, title: "Characters, bytes and words",
      help: "Characters as people see them (an accented letter or a flag counts once), Unicode code points, UTF-8 bytes (what a request or file holds), whitespace-separated words and lines.",
      inputs: [TEXT()],
      compute: ({ text }) => [["Characters", graphemeCount(text)], ["Code points", codePoints(text)], ["UTF-8 bytes", utf8Bytes(text)], ["Words", wordCount(text)], ["Lines", lineCount(text)]] },
    { id: "sentence_lengths", kind: "tool", group: GROUP, title: "Sentences and their lengths",
      help: "Splits the text into sentences (ending at . ! or ? before a space or the end) and gives each one's length in words, the average, and the longest, for keeping instructions short and direct.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const list = sentences(text);
        need(list.length > 0, "Type some text.");
        const counts = list.map(wordCount);
        const total = counts.reduce((sum, value) => sum + value, 0);
        return { rows: [["Sentences", list.length], ["Words", total], ["Average words per sentence", total / list.length], ["Longest sentence (words)", Math.max(...counts)]],
          table: { columns: ["sentence", "words", "text"], rows: list.map((sentence, index) => [index + 1, counts[index], sentence]) } };
      } },
    { id: "readability", kind: "tool", group: GROUP, title: "Readability scores",
      help: "Flesch reading ease = 206.835 − 1.015 × (words ÷ sentences) − 84.6 × (syllables ÷ words); higher is easier, 60 to 70 is plain English. Flesch-Kincaid grade = 0.39 × (words ÷ sentences) + 11.8 × (syllables ÷ words) − 15.59, a US school grade. Syllables are estimated from vowel groups (a silent final e dropped), so scores are approximate and meant for English.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const list = words(text).map(core).filter(Boolean);
        need(list.length > 0, "Type some words.");
        const sentenceCount = Math.max(1, sentences(text).length);
        const syllableCount = list.reduce((sum, word) => sum + syllables(word), 0);
        const perSentence = list.length / sentenceCount, perWord = syllableCount / list.length;
        return [["Words", list.length], ["Sentences", sentenceCount], ["Syllables (estimated)", syllableCount], ["Words per sentence", perSentence],
          ["Syllables per word", perWord], ["Flesch reading ease", 206.835 - 1.015 * perSentence - 84.6 * perWord], ["Flesch-Kincaid grade", 0.39 * perSentence + 11.8 * perWord - 15.59]];
      } },
    { id: "long_lines", kind: "tool", group: GROUP, title: "Lines longer than a limit",
      help: "The longest line and every line over a length limit (in code points), by line number.",
      inputs: [TEXT(), { name: "limit", label: "Longest line allowed (characters)", type: "integer", min: 1, default: 100 }],
      compute: ({ text, limit }) => {
        const all = lines(text).map((line, index) => [index + 1, codePoints(line)]);
        need(all.length > 0, "Type some text.");
        const over = all.filter(([, length]) => length > limit);
        return { rows: [["Lines", all.length], ["Longest line (characters)", Math.max(...all.map(([, length]) => length))], ["Lines over the limit", over.length]],
          table: { columns: ["line", "characters"], rows: over } };
      } },
    { id: "repeated_words", kind: "tool", group: GROUP, title: "Words used most often",
      help: "Words that appear at least a given number of times, most frequent first (ties in order of first use). Case and the punctuation around words are ignored.",
      inputs: [TEXT(), { name: "least", label: "Used at least (times)", type: "integer", min: 2, default: 2 }],
      compute: ({ text, least }) => {
        const list = cleanWords(text);
        need(list.length > 0, "Type some words.");
        const counts = tally(list);
        const repeated = counts.map((entry, index) => [...entry, index]).filter(([, times]) => times >= least).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([word, times]) => [word, times]);
        return { rows: [["Words", list.length], ["Distinct words", counts.length], [`Words used ${least} or more times`, repeated.length]], table: { columns: ["word", "times"], rows: repeated } };
      } },
    { id: "doubled_words", kind: "tool", group: GROUP, title: "Find doubled words",
      help: "The same word twice in a row (\"the the\"), a common slip when editing instructions. Case is ignored; words with punctuation between them (\"that, that\") are left alone.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const tokens = [...String(text).matchAll(/\S+/g)];
        const found = [];
        for (let i = 0; i + 1 < tokens.length; i++) {
          const first = tokens[i][0], second = tokens[i + 1][0];
          const word = core(first);
          if (!word || !isWordChar(Array.from(first).pop()) || !isWordChar(Array.from(second)[0])) continue;
          if (core(second).toLowerCase() !== word.toLowerCase()) continue;
          found.push([lineCount(String(text).slice(0, tokens[i].index + 1)), `${word} ${core(second)}`]);
        }
        return { rows: [["Doubled words", found.length]], table: { columns: ["line", "words"], rows: found } };
      } },
    { id: "shared_words", kind: "tool", group: GROUP, title: "Words two texts share",
      help: "The distinct words in both texts, only in the first and only in the second, with their Jaccard similarity (shared ÷ all distinct). Case and the punctuation around words are ignored.",
      inputs: [TEXT("a", "Text A", { required: false }), TEXT("b", "Text B", { required: false })],
      compute: ({ a, b }) => {
        const left = [...new Set(cleanWords(a))], right = [...new Set(cleanWords(b))];
        need(left.length + right.length > 0, "Type some words in at least one text.");
        const inA = new Set(left), inB = new Set(right);
        const both = left.filter((word) => inB.has(word)), onlyA = left.filter((word) => !inB.has(word)), onlyB = right.filter((word) => !inA.has(word));
        return { rows: [["Distinct words in A", left.length], ["Distinct words in B", right.length], ["Shared words", both.length], ["Only in A", onlyA.length],
          ["Only in B", onlyB.length], ["Jaccard similarity", both.length / (left.length + onlyB.length)]],
        table: { columns: ["word", "in"], rows: [...both.map((word) => [word, "both"]), ...onlyA.map((word) => [word, "A only"]), ...onlyB.map((word) => [word, "B only"])] } };
      } },
    { id: "edit_distance", kind: "tool", group: GROUP, title: "Edit distance of two texts",
      help: "The Levenshtein distance (fewest single-character insertions, deletions and substitutions from A to B), similarity = 1 − distance ÷ the longer length, and how many characters the texts share at the start and the end. For comparing two versions of an instruction or label.",
      inputs: [TEXT("a", "Text A", { required: false, rows: 3 }), TEXT("b", "Text B", { required: false, rows: 3 }), CHECK("ignoreCase", "Ignore case")],
      compute: ({ a, b, ignoreCase }) => {
        const x = ignoreCase ? a.toLowerCase() : a, y = ignoreCase ? b.toLowerCase() : b;
        const distance = levenshtein(x, y), longer = Math.max(codePoints(x), codePoints(y));
        return [["Edit distance (characters)", distance], ["Similarity", longer ? 1 - distance / longer : 1], ["Same start (characters)", codePoints(commonPrefix([x, y]))],
          ["Same end (characters)", codePoints(commonSuffix([x, y]))]];
      } },
    { id: "find_emails", kind: "tool", group: GROUP, title: "Find email addresses",
      help: "Email addresses in the text, with how often each appears and whether its domain is reserved for examples (.example, .test, .invalid, .localhost, example.com/.net/.org). Fictional data should use reserved domains only.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const counts = tally(findEmails(text), (value) => value.toLowerCase());
        const real = counts.filter(([address]) => !reservedDomain(address.split("@").pop()));
        return { rows: [["Addresses found", counts.reduce((sum, [, times]) => sum + times, 0)], ["Distinct addresses", counts.length], ["Not on a reserved example domain", real.length]],
          table: { columns: ["address", "times", "example domain"], rows: counts.map(([address, times]) => [address, times, yesNo(reservedDomain(address.split("@").pop()))]) } };
      } },
    { id: "find_links", kind: "tool", group: GROUP, title: "Find links",
      help: "Web addresses (http://, https:// or www.) in the text, with how often each appears and whether its host is reserved for examples (.example, .test, .invalid, .localhost, example.com/.net/.org).",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const counts = tally(findUrls(text));
        return { rows: [["Links found", counts.reduce((sum, [, times]) => sum + times, 0)], ["Distinct links", counts.length],
          ["Not on a reserved example domain", counts.filter(([url]) => !reservedDomain(urlHost(url))).length]],
        table: { columns: ["link", "times", "example domain"], rows: counts.map(([url, times]) => [url, times, yesNo(reservedDomain(urlHost(url)))]) } };
      } },
    { id: "find_numbers", kind: "tool", group: GROUP, title: "Find numbers",
      help: "The numbers in the text in order (decimals, exponents and comma-grouped thousands read as one number; a minus sign right before the digits makes it negative, but not in dates or ids like item-2), with their sum, smallest and largest.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const found = findNumbers(text);
        return { rows: [["Numbers found", found.length], ["Sum", found.length ? found.reduce((sum, value) => sum + value, 0) : null],
          ["Smallest", found.length ? Math.min(...found) : null], ["Largest", found.length ? Math.max(...found) : null]],
        table: { columns: ["#", "number"], rows: found.map((value, index) => [index + 1, value]) } };
      } },
    { id: "find_dates", kind: "tool", group: GROUP, title: "Find dates",
      help: "Real calendar dates written as YYYY-MM-DD in the text, with how often each appears, the earliest and latest, and the days between them.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const found = findIsoDates(text), counts = tally(found);
        const sorted = [...new Set(found)].sort();
        const day = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;
        const some = sorted.length > 0;
        return { rows: [["Dates found", found.length], ["Distinct dates", counts.length], ["Earliest", some ? sorted[0] : null], ["Latest", some ? sorted[sorted.length - 1] : null],
          ["Days from earliest to latest", some ? day(sorted[sorted.length - 1]) - day(sorted[0]) : null]], table: { columns: ["date", "times"], rows: counts } };
      } },
    { id: "find_phones", kind: "tool", group: GROUP, title: "Find phone numbers",
      help: "Phone-like numbers in the text as written (7 to 15 digits in groups, optional + and brackets; dates, decimals and IP addresses are left out), for spotting personal data before sharing rows.",
      inputs: [TEXT()],
      compute: ({ text }) => finder(findPhoneNumbers(text), "Phone numbers") },
    { id: "find_placeholders", kind: "tool", group: GROUP, title: "Find placeholders",
      help: "Template placeholders such as {name}, {{name}}, <name> and [NAME], grouped by the name inside, with how they are written and how often, and which placeholder styles the text mixes.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const found = findPlaceholders(text);
        const groups = tally(found, placeholderName).map(([token, times]) => {
          const name = placeholderName(token);
          return [name, [...new Set(found.filter((other) => placeholderName(other) === name))].join(", "), times];
        });
        return { rows: [["Placeholders found", found.length], ["Distinct names", groups.length], ["Styles used", listOr([...new Set(found.map(PLACEHOLDER_STYLE))])]],
          table: { columns: ["name", "written as", "times"], rows: groups } };
      } },
    { id: "fill_placeholders", kind: "tool", group: GROUP, title: "Fill in placeholders",
      help: "Replaces placeholders ({name}, {{name}}, <name>, [NAME]) with values typed one per line as name = value (or name: value). Placeholders with no value stay as written, and the result lists them and any value that was not used.",
      inputs: [TEXT(), TEXT("values", "Values (name = value per line)", { rows: 4, placeholder: "customer = Ana Ruiz\norder_id: HC-1042" })],
      compute: ({ text, values }) => {
        const given = new Map();
        String(values).split(/\r\n|\r|\n/).forEach((raw, index) => {
          const line = raw.trim();
          if (!line || line.startsWith("#")) return;
          const equals = line.indexOf("="), colon = line.indexOf(":");
          const at = equals !== -1 ? equals : colon;
          need(at > 0, `Values, line ${index + 1}: write name = value.`);
          const name = line.slice(0, at).trim();
          need(name && !given.has(name), `Values, line ${index + 1}: ${name ? `${name} is given twice` : "the name is missing"}.`);
          given.set(name, line.slice(at + 1).trim());
        });
        const found = findPlaceholders(text);
        const tokens = [...new Set(found)].sort((x, y) => y.length - x.length);
        let filled = 0;
        const used = new Set(), missing = [];
        const out = tokens.length ? text.replace(new RegExp(tokens.map(escapeRegExp).join("|"), "g"), (token) => {
          const name = placeholderName(token);
          if (!given.has(name)) { if (!missing.includes(name)) missing.push(name); return token; }
          filled++; used.add(name);
          return given.get(name);
        }) : text;
        return { rows: [["Placeholders filled", filled], ["Placeholders left", found.length - filled], ["Names without a value", listOr(missing)],
          ["Values not used", listOr([...given.keys()].filter((name) => !used.has(name)))]], text: out };
      } },
    { id: "question_id", kind: "tool", group: GROUP, title: "Name a question id",
      help: "A question id from a phrase in snake_case, camelCase, kebab-case and as an ASCII slug, the phrase as a Title Case label, and a snake_case id made unique against ids already in use (adding _2, _3, ...).",
      inputs: [{ name: "text", label: "Phrase or name", type: "text", required: true, placeholder: "e.g. Is the order late?" },
        TEXT("taken", "Ids already in use (one per line, optional)", { required: false, rows: 3 })],
      compute: ({ text, taken }) => {
        const snake = toSnakeCase(text);
        need(snake !== "", "The phrase has no letters or digits to name it from.");
        const used = lines(taken).map((line) => line.trim()).filter(Boolean);
        return [["snake_case", snake], ["camelCase", toCamelCase(text)], ["kebab-case", toKebabCase(text)], ["ASCII slug", slugify(text, "_")],
          ["Title Case label", toTitleCase(text)], ["Plain identifier (letters, digits, underscores)", yesNo(isIdentifier(snake))], ["Unique snake_case id", uniqueName(snake, used)]];
      } },
    { id: "wrap_lines", kind: "tool", group: GROUP, title: "Wrap lines to a width",
      help: "Breaks long lines at spaces so none is longer than a width (in characters), keeping each line's indentation and the existing line breaks. A word longer than the width stays whole on its own line.",
      inputs: [TEXT(), { name: "width", label: "Width (characters)", type: "integer", min: 10, default: 72 }],
      compute: ({ text, width }) => {
        const before = lines(text);
        const after = before.flatMap((line) => wrapLine(line, width));
        return { rows: [["Lines before", before.length], ["Lines after", after.length]], text: after.join("\n") };
      } },
    { id: "unwrap_lines", kind: "tool", group: GROUP, title: "Join wrapped lines into paragraphs",
      help: "Joins the lines of each paragraph into one line with single spaces, for text copied from an email or a PDF. Blank lines separate paragraphs and stay as one blank line.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const paragraphs = [];
        let current = [];
        for (const line of lines(text)) {
          if (line.trim() === "") { if (current.length) paragraphs.push(current.join(" ")); current = []; }
          else current.push(line.trim());
        }
        if (current.length) paragraphs.push(current.join(" "));
        return { rows: [["Lines before", lineCount(text)], ["Paragraphs", paragraphs.length]], text: paragraphs.join("\n\n") };
      } },
    { id: "strip_control", kind: "tool", group: GROUP, title: "Remove control characters",
      help: "Removes control characters (C0, DEL and C1; tab and line breaks are kept), and optionally invisible ones: zero-width spaces and joiners, word joiners, byte order marks and soft hyphens.",
      inputs: [TEXT(), CHECK("invisible", "Also remove invisible characters")],
      compute: ({ text, invisible }) => {
        const clean = stripControlCharacters(text);
        const out = invisible ? clean.replace(INVISIBLE, "") : clean;
        return { rows: [["Control characters removed", codePoints(text) - codePoints(clean)], ["Invisible characters removed", codePoints(clean) - codePoints(out)]], text: out };
      } },
    { id: "normalize_punctuation", kind: "tool", group: GROUP, title: "Straighten quotes and dashes",
      help: "Turns curly quotes into straight ones, Unicode dashes and the minus sign into a hyphen, no-break and other fixed-width spaces into plain spaces, and optionally the ellipsis character into three dots. Each change can be turned off.",
      inputs: [TEXT(), CHECK("quotes", "Straighten quotes", true), CHECK("dashes", "Replace dashes", true), CHECK("spaces", "Replace special spaces", true),
        CHECK("ellipsis", "Ellipsis character to three dots")],
      compute: ({ text, quotes, dashes, spaces, ellipsis }) => {
        let out = text;
        const counts = [];
        const step = (label, on, pattern, replace) => {
          const found = on ? (out.match(pattern) || []).length : 0;
          if (on) out = out.replace(pattern, replace);
          counts.push([label, found]);
        };
        step("Quotes straightened", quotes, /[‘’‚‛“”„‟]/g, (char) => ("‘’‚‛".includes(char) ? "'" : '"'));
        step("Dashes replaced", dashes, /[‐-―−]/g, "-");
        step("Spaces replaced", spaces, /[    ]/g, " ");
        step("Ellipses expanded", ellipsis, /…/g, "...");
        return { rows: counts, text: out };
      } },
    { id: "count_phrase", kind: "tool", group: GROUP, title: "Count a phrase",
      help: "How many times a word or phrase occurs (without overlaps), on how many lines, and the first line it is on. Optionally ignore case or match whole words only, so \"late\" does not count inside \"translate\".",
      inputs: [TEXT(), { name: "phrase", label: "Phrase", type: "text", required: true }, CHECK("ignoreCase", "Ignore case"), CHECK("whole", "Whole words only")],
      compute: ({ text, phrase, ignoreCase, whole }) => {
        const body = escapeRegExp(phrase);
        const source = whole ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
        const flags = `gu${ignoreCase ? "i" : ""}`;
        const total = [...text.matchAll(new RegExp(source, flags))].length;
        const hits = lines(text).map((line, index) => (new RegExp(source, flags.replace("g", "")).test(line) ? index + 1 : 0)).filter(Boolean);
        return [["Occurrences", total], ["Lines with the phrase", hits.length], ["First line", hits.length ? hits[0] : null]];
      } },
    { id: "line_diff", kind: "tool", group: GROUP, title: "Difference between two texts by line",
      help: "Lines kept, removed and added from A to B, matched by the longest common sequence of lines. Removed lines start with \"- \", added ones with \"+ \" and unchanged ones with two spaces.",
      inputs: [TEXT("a", "Text A (before)", { required: false }), TEXT("b", "Text B (after)", { required: false }), CHECK("trimEnds", "Ignore spaces at line ends")],
      compute: ({ a, b, trimEnds }) => {
        const same = trimEnds ? (x, y) => x.trimEnd() === y.trimEnd() : (x, y) => x === y;
        const ops = diffLines(lines(a), lines(b), same);
        const count = (op) => ops.filter(([kind]) => kind === op).length;
        return { rows: [["Unchanged lines", count(" ")], ["Removed lines", count("-")], ["Added lines", count("+")]],
          text: ops.map(([op, line]) => `${op === " " ? " " : op} ${line}`).join("\n") };
      } },
    { id: "tidy_whitespace", kind: "tool", group: GROUP, title: "Tidy whitespace",
      help: "Removes spaces at line ends, collapses runs of spaces or tabs inside a line to one space (indentation is kept), turns CRLF and CR line breaks into LF, and keeps at most one blank line in a row, with none at the start or end.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const breaks = (text.match(/\r\n?/g) || []).length;
        let trailing = 0, runs = 0, blanks = 0;
        const kept = [];
        for (const raw of lines(text)) {
          const trimmed = raw.replace(/\s+$/, "");
          if (trimmed !== raw) trailing++;
          const indent = trimmed.match(/^\s*/)[0];
          const rest = trimmed.slice(indent.length);
          runs += (rest.match(/[ \t]{2,}/g) || []).length;
          const line = indent + rest.replace(/[ \t]{2,}/g, " ");
          if (line === "" && (!kept.length || kept[kept.length - 1] === "")) { blanks++; continue; }
          kept.push(line);
        }
        while (kept.length && kept[kept.length - 1] === "") { kept.pop(); blanks++; }
        return { rows: [["Lines with spaces at the end", trailing], ["Runs of spaces collapsed", runs], ["Blank lines removed", blanks], ["Line breaks changed to LF", breaks]], text: kept.join("\n") };
      } },
    { id: "unusual_characters", kind: "tool", group: GROUP, title: "List unusual characters",
      help: "Every character outside plain ASCII, with its code point, how often it appears and its kind: control, invisible or special space (shown by name, since it cannot be seen), or other non-ASCII. Finds the stray no-break or zero-width space that makes two inputs differ.",
      inputs: [TEXT()],
      compute: ({ text }) => {
        const seen = new Map();
        for (const char of text) {
          const code = char.codePointAt(0);
          if (code === 9 || code === 10 || code === 13 || (code >= 0x20 && code < 0x7F)) continue;
          const kind = /\p{Cc}/u.test(char) ? "control" : /[\p{Cf}\p{Z}]/u.test(char) ? "invisible or special space" : "non-ASCII";
          const entry = seen.get(code) || { char, code, kind, times: 0 };
          entry.times++;
          seen.set(code, entry);
        }
        const all = [...seen.values()];
        const hidden = all.filter((entry) => entry.kind !== "non-ASCII");
        return { rows: [["Distinct unusual characters", all.length], ["Control or invisible (times)", hidden.reduce((sum, entry) => sum + entry.times, 0)],
          ["Other non-ASCII (times)", all.filter((entry) => entry.kind === "non-ASCII").reduce((sum, entry) => sum + entry.times, 0)]],
        table: { columns: ["character", "code point", "times", "kind"],
          rows: all.map((entry) => [entry.kind === "non-ASCII" ? entry.char : NAMES[entry.code] || "(not shown)", codeLabel(entry.code), entry.times, entry.kind]) } };
      } },
    { id: "shorten_text", kind: "tool", group: GROUP, title: "Shorten text to a length",
      help: "Cuts text to at most a number of characters (code points) or UTF-8 bytes, never inside a character, ending with … when it is cut (the … counts toward the limit and is left out when it does not fit). Text that fits comes back unchanged.",
      inputs: [TEXT(), { name: "max", label: "Longest allowed", type: "integer", min: 1, default: 200 },
        { name: "unit", label: "Measured in", type: "select", options: [["points", "Characters (code points)"], ["bytes", "UTF-8 bytes"]] }, CHECK("ellipsis", "End with … when cut", true)],
      compute: ({ text, max, unit, ellipsis }) => {
        const measure = unit === "bytes" ? utf8Bytes : codePoints;
        const out = shorten(text, max, measure, ellipsis ? "…" : "");
        return { rows: [["Length before", measure(text)], ["Length after", measure(out)], ["Cut", yesNo(out !== text)]], text: out };
      } },
    { id: "sort_lines", kind: "tool", group: GROUP, title: "Sort lines and remove duplicates",
      help: "Sorts lines A to Z or Z to A (numbers in order, so item 2 comes before item 10; case and accents ignored) or keeps their order, removes repeated lines (keeping the first) and blank lines. Handy for Choice options and lists of inputs.",
      inputs: [TEXT(), { name: "order", label: "Order", type: "select", options: [["keep", "Keep the order"], ["asc", "A to Z"], ["desc", "Z to A"]] },
        CHECK("dedupe", "Remove repeated lines", true), CHECK("ignoreCase", "Ignore case when finding repeats"), CHECK("dropBlank", "Remove blank lines", true)],
      compute: ({ text, order, dedupe, ignoreCase, dropBlank }) => {
        const before = lines(text);
        let out = dropBlank ? before.filter((line) => line.trim() !== "") : before;
        const blanks = before.length - out.length;
        if (dedupe) {
          const seen = new Set();
          out = out.filter((line) => { const key = ignoreCase ? line.toLowerCase() : line; if (seen.has(key)) return false; seen.add(key); return true; });
        }
        const repeats = before.length - blanks - out.length;
        if (order !== "keep") out = [...out].sort((x, y) => (order === "asc" ? compareText(x, y) : compareText(y, x)));
        return { rows: [["Lines before", before.length], ["Lines after", out.length], ["Repeated lines removed", repeats], ["Blank lines removed", blanks]], text: out.join("\n") };
      } },
  ],
});
