// Text helpers for Lab packs: measuring, testing, cleaning, naming, comparing and searching plain text.
// Pure code: it imports nothing and touches no DOM, storage or network, so it runs in a browser and in Node.
//
// Every text argument takes any value: null and undefined read as "", everything else is converted with String().
// Lengths are counted in Unicode code points unless a function says otherwise, so an emoji outside the Basic
// Multilingual Plane counts once. An argument outside a function's domain (a negative length, a list that is not an
// array, an unknown normalization form) gives null. Nothing here returns NaN, and nothing throws on bad input.
// The find* functions are heuristics for spotting things in prose, not validators, and they never reach the network.

// Any value as text: null and undefined are "", and a value that cannot be converted is "".
function str(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try { return String(value); } catch { return ""; }
}

const points = (text) => Array.from(str(text));
const isLetterOrDigit = (char) => /[\p{L}\p{N}]/u.test(char);

// Calls visit(byte) for every UTF-8 byte of the text. A lone surrogate is encoded as U+FFFD, as TextEncoder does.
function eachUtf8Byte(text, visit) {
  for (const char of str(text)) {
    let code = char.codePointAt(0);
    if (code >= 0xD800 && code <= 0xDFFF) code = 0xFFFD;
    if (code < 0x80) visit(code);
    else if (code < 0x800) { visit(0xC0 | (code >> 6)); visit(0x80 | (code & 0x3F)); }
    else if (code < 0x10000) { visit(0xE0 | (code >> 12)); visit(0x80 | ((code >> 6) & 0x3F)); visit(0x80 | (code & 0x3F)); }
    else { visit(0xF0 | (code >> 18)); visit(0x80 | ((code >> 12) & 0x3F)); visit(0x80 | ((code >> 6) & 0x3F)); visit(0x80 | (code & 0x3F)); }
  }
}

// ---------- measures ----------

// The number of Unicode code points: 0 for "", 1 for an astral character such as an emoji, 1 for a lone surrogate.
export function codePoints(text) {
  let count = 0;
  for (const _char of str(text)) count += 1;
  return count;
}

let segmenter;

// The number of user-perceived characters (grapheme clusters), so a flag or a letter with a combining accent counts
// once. Uses Intl.Segmenter where the runtime has it and falls back to the code point count where it does not.
export function graphemeCount(text) {
  const value = str(text);
  if (segmenter === undefined) {
    try { segmenter = typeof Intl === "object" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null; }
    catch { segmenter = null; }
  }
  if (!segmenter) return codePoints(value);
  let count = 0;
  for (const _part of segmenter.segment(value)) count += 1;
  return count;
}

// The size in bytes of the text encoded as UTF-8 (1 to 4 bytes per code point; a lone surrogate counts 3).
export function utf8Bytes(text) {
  let count = 0;
  eachUtf8Byte(text, () => { count += 1; });
  return count;
}

// The whitespace-separated words, in order, punctuation included ("Hi, there" is ["Hi,", "there"]). [] for blank text.
export function words(text) {
  const value = str(text).trim();
  return value === "" ? [] : value.split(/\s+/);
}

// The number of whitespace-separated words; 0 for blank text.
export function wordCount(text) {
  return words(text).length;
}

// The lines of the text, split on CRLF, CR or LF. A line break at the very end closes the last line instead of
// opening an empty one, so "a\n" is ["a"] and "a\n\n" is ["a", ""]. [] for "".
export function lines(text) {
  const value = str(text);
  if (value === "") return [];
  const parts = value.split(/\r\n|\r|\n/);
  if (parts[parts.length - 1] === "" && parts.length > 1) parts.pop();
  return parts;
}

// The number of lines: 0 for "", and CRLF, CR and LF each count as one break. A final line break does not add a
// line ("a\n" is 1, "a\nb" is 2, "\n" is 1).
export function lineCount(text) {
  return lines(text).length;
}

// The sentences, trimmed, in order. A sentence ends at a run of . ! or ? (with any closing quotes or brackets after
// it) that is followed by whitespace or the end of the text, so "3.14" and "a.b" do not split. Text after the last
// terminator is a sentence too. [] for blank text.
export function sentences(text) {
  const value = str(text);
  const out = [];
  let start = 0;
  for (const match of value.matchAll(/[.!?]+["'\u201D\u2019)\]]*(?=\s|$)/g)) {
    const end = match.index + match[0].length;
    const piece = value.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  }
  const rest = value.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// The length in code points of the longest line; 0 for "".
export function longestLine(text) {
  let longest = 0;
  for (const line of lines(text)) longest = Math.max(longest, codePoints(line));
  return longest;
}

// The mean length of the words in code points, punctuation included; 0 when there are no words.
export function averageWordLength(text) {
  const list = words(text);
  if (!list.length) return 0;
  return list.reduce((sum, word) => sum + codePoints(word), 0) / list.length;
}

// ---------- character tests ----------

// True when every character is ASCII (U+0000 to U+007F); true for "".
export function isAscii(text) {
  return /^[\u0000-\u007F]*$/.test(str(text));
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

// True when the text holds a control character (C0, DEL or C1) other than tab, CR and LF.
export function hasControlCharacters(text) {
  return CONTROL.test(str(text));
}

// True when the text starts or ends with whitespace (spaces, tabs, line breaks, no-break spaces); false for "".
export function hasEdgeWhitespace(text) {
  const value = str(text);
  return value !== value.trim();
}

// True when two or more space characters (U+0020) appear in a row. Tabs and line breaks do not count.
export function hasRepeatedSpaces(text) {
  return str(text).includes("  ");
}

// True when the text uses more than one of the three line-break styles: CRLF, lone CR, lone LF.
export function hasMixedNewlines(text) {
  const value = str(text);
  const rest = value.replace(/\r\n/g, "");
  return (rest.length !== value.length ? 1 : 0) + (rest.includes("\r") ? 1 : 0) + (rest.includes("\n") ? 1 : 0) > 1;
}

// True when the text is empty or only whitespace.
export function isBlank(text) {
  return str(text).trim() === "";
}

// True when the text has at least one cased letter and none of them is lower case ("ORDER 66"); false for "" and "123".
export function isUpperCase(text) {
  const value = str(text);
  return value === value.toUpperCase() && value !== value.toLowerCase();
}

// True when the text has at least one cased letter and none of them is upper case ("order 66"); false for "" and "123".
export function isLowerCase(text) {
  const value = str(text);
  return value === value.toLowerCase() && value !== value.toUpperCase();
}

const TITLE_WORD = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu;

// True when every word (a run of letters, digits and inner apostrophes) starts with a capital or a digit and has no
// capital after its first character, and at least one word starts with a capital: "Order Status", "Well-Known Fact",
// "Don't Stop". False for "Order status", "USA Today", "iPhone", "" and "123".
export function isTitleCase(text) {
  let capitalized = false;
  for (const [word] of str(text).matchAll(TITLE_WORD)) {
    const [first, ...rest] = word;
    const tail = rest.join("");
    if (first !== first.toUpperCase() || tail !== tail.toLowerCase()) return false;
    if (first !== first.toLowerCase()) capitalized = true;
  }
  return capitalized;
}

// ---------- cleanup (pure: each returns new text) ----------

// The text with every CRLF and lone CR turned into LF.
export function normalizeNewlines(text) {
  return str(text).replace(/\r\n?/g, "\n");
}

// The text with every run of whitespace (line breaks included) turned into one space, and the ends trimmed.
export function collapseWhitespace(text) {
  return str(text).replace(/\s+/g, " ").trim();
}

// The text with whitespace removed from both ends of every line. Line breaks stay exactly as they were (CRLF stays
// CRLF) and blank lines are kept. Use trimLineEnds to keep indentation.
export function trimLines(text) {
  return str(text).split(/(\r\n|\r|\n)/).map((part, index) => (index % 2 ? part : part.trim())).join("");
}

// The text with trailing whitespace removed from every line; indentation and line breaks stay as they were.
export function trimLineEnds(text) {
  return str(text).split(/(\r\n|\r|\n)/).map((part, index) => (index % 2 ? part : part.trimEnd())).join("");
}

// The text without control characters (C0, DEL, C1); tab, CR and LF are kept.
export function stripControlCharacters(text) {
  return str(text).replace(new RegExp(CONTROL.source, "g"), "");
}

// The text with curly quotes made straight: ‘ ’ ‚ ‛ become ' and “ ” „ ‟ become ".
export function normalizeQuotes(text) {
  return str(text).replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

// The text with every Unicode hyphen and dash (U+2010 to U+2015: hyphen, non-breaking hyphen, figure, en and em dash,
// horizontal bar) and the minus sign U+2212 turned into the ASCII hyphen-minus. Spacing around them is unchanged.
export function normalizeDashes(text) {
  return str(text).replace(/[\u2010-\u2015\u2212]/g, "-");
}

// The text in a Unicode normalization form: "NFC" (default), "NFD", "NFKC" or "NFKD". null for any other form.
export function normalizeUnicode(text, form = "NFC") {
  if (!["NFC", "NFD", "NFKC", "NFKD"].includes(form)) return null;
  return str(text).normalize(form);
}

// ---------- identifiers ----------

const LATIN_FALLBACK = { "\u00DF": "ss", "\u00E6": "ae", "\u0153": "oe", "\u00F8": "o", "\u0111": "d", "\u0142": "l", "\u00FE": "th", "\u00F0": "d" };

// A lower-case ASCII slug: accents are removed ("Crème Brûlée" is "creme-brulee"), apostrophes are dropped
// ("Don't" is "dont"), and every other run of characters that are not a-z or 0-9 becomes one separator, with none
// at the ends. Letters with no ASCII form are dropped, so the result can be "". A separator that is not text is "-".
export function slugify(text, separator = "-") {
  const joiner = typeof separator === "string" ? separator : "-";
  return str(text).normalize("NFKD").replace(/\p{M}+/gu, "").replace(/['\u2019]/g, "").toLowerCase()
    .replace(/[\u00DF\u00E6\u0153\u00F8\u0111\u0142\u00FE\u00F0]/g, (char) => LATIN_FALLBACK[char])
    .split(/[^a-z0-9]+/).filter(Boolean).join(joiner);
}

// The words of a name or phrase: split at anything that is not a letter or digit, at a lower-to-upper step
// ("orderStatus") and before the last capital of an acronym ("HTTPServer" is HTTP, Server). Apostrophes are dropped.
function nameWords(text) {
  return str(text).replace(/['\u2019]/g, "")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const capitalize = (word) => {
  const [first = "", ...rest] = word;
  return first.toUpperCase() + rest.join("").toLowerCase();
};

// The words in lower case joined by underscores: "Order Status", "orderStatus" and "order-status" are all
// "order_status"; "HTTPServer" is "http_server". Letters keep their accents. "" when there are no words.
export function toSnakeCase(text) {
  return nameWords(text).map((word) => word.toLowerCase()).join("_");
}

// The words joined with no separator, the first in lower case and the rest capitalized: "order status" and
// "Order_Status" are "orderStatus"; "HTTP server" is "httpServer". "" when there are no words.
export function toCamelCase(text) {
  return nameWords(text).map((word, index) => (index ? capitalize(word) : word.toLowerCase())).join("");
}

// The words in lower case joined by hyphens: "Order Status" and "orderStatus" are "order-status". Unlike slugify,
// letters keep their accents. "" when there are no words.
export function toKebabCase(text) {
  return nameWords(text).map((word) => word.toLowerCase()).join("-");
}

// The words capitalized and joined by spaces, for turning a name into a label: "order_status", "orderStatus" and
// "ORDER STATUS" are all "Order Status". Punctuation between words is dropped. "" when there are no words.
export function toTitleCase(text) {
  return nameWords(text).map(capitalize).join(" ");
}

// True when the text is an ASCII identifier: a letter or underscore, then letters, digits and underscores.
export function isIdentifier(text) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(str(text));
}

// The base name if it is free, else the first of base_2, base_3, ... that is. taken is an array, a Set, a Map (its
// keys), any other iterable, or a plain object (its keys); anything else means nothing is taken.
export function uniqueName(base, taken) {
  const name = str(base);
  let used;
  if (taken instanceof Set || taken instanceof Map) used = taken;
  else if (taken && typeof taken === "object" && typeof taken[Symbol.iterator] === "function") used = new Set(Array.from(taken, str));
  else if (taken && typeof taken === "object") used = new Set(Object.keys(taken));
  else used = new Set();
  if (!used.has(name)) return name;
  for (let number = 2; ; number += 1) {
    const candidate = `${name}_${number}`;
    if (!used.has(candidate)) return candidate;
  }
}

// ---------- comparison ----------

// The Levenshtein edit distance in code points: the fewest single-character insertions, deletions and substitutions
// that turn a into b. Case-sensitive. 0 for equal texts; the other's length when one is "".
export function levenshtein(a, b) {
  let left = points(a);
  let right = points(b);
  if (left.length < right.length) [left, right] = [right, left];
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)));
    }
    previous = current;
  }
  return previous[right.length];
}

// A similarity from 0 to 1: 1 - levenshtein(a, b) / the longer length in code points. 1 for equal texts, two empty
// texts included; 0 when nothing lines up.
export function similarity(a, b) {
  const longer = Math.max(codePoints(a), codePoints(b));
  return longer === 0 ? 1 : 1 - levenshtein(a, b) / longer;
}

// The distinct words in lower case, with punctuation stripped from both ends of each word.
function wordSet(text) {
  const out = new Set();
  for (const word of words(str(text).toLowerCase())) {
    const chars = Array.from(word);
    let start = 0;
    let end = chars.length;
    while (start < end && !isLetterOrDigit(chars[start])) start += 1;
    while (end > start && !isLetterOrDigit(chars[end - 1])) end -= 1;
    if (end > start) out.add(chars.slice(start, end).join(""));
  }
  return out;
}

// The Jaccard similarity of the two texts' word sets, from 0 to 1: shared words / all distinct words. Words are
// lower-cased and lose punctuation at their ends, so "Refund, please." matches "please refund". 1 when neither text
// has a word; 0 when only one does.
export function jaccard(a, b) {
  const left = wordSet(a);
  const right = wordSet(b);
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// The longest prefix every text in the list starts with, cut on a code point boundary. "" for an empty list or no
// common prefix; the text itself for a list of one. null when list is not an array.
export function commonPrefix(list) {
  if (!Array.isArray(list)) return null;
  if (!list.length) return "";
  const items = list.map(points);
  const first = items[0];
  let length = Math.min(...items.map((item) => item.length));
  for (const item of items) {
    let same = 0;
    while (same < length && item[same] === first[same]) same += 1;
    length = same;
  }
  return first.slice(0, length).join("");
}

// The longest suffix every text in the list ends with, cut on a code point boundary. "" for an empty list or no
// common suffix; the text itself for a list of one. null when list is not an array.
export function commonSuffix(list) {
  if (!Array.isArray(list)) return null;
  const reversed = commonPrefix(list.map((item) => points(item).reverse().join("")));
  return points(reversed).reverse().join("");
}

// The word n-grams in order: every run of n consecutive whitespace-separated words, joined by one space, case and
// punctuation kept. [] when the text has fewer than n words. null when n is not a positive integer.
export function ngrams(text, n) {
  if (!Number.isInteger(n) || n < 1) return null;
  const list = words(text);
  const out = [];
  for (let index = 0; index + n <= list.length; index += 1) out.push(list.slice(index, index + n).join(" "));
  return out;
}

// ---------- finding things ----------

const LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
const DOMAIN_CHAR = /[A-Za-z0-9.-]/;
const DOMAIN_LABEL = /^[A-Za-z0-9-]+$/;

// The email addresses in the text, in order, repeats included. An address is letters, digits and . _ % + - around
// one @, with a dotted domain of at least two labels; dots at the edges are left out ("Write to ana@harbor.example."
// gives "ana@harbor.example"). [] when there are none.
export function findEmails(text) {
  const value = str(text);
  const out = [];
  for (let at = value.indexOf("@"); at !== -1; at = value.indexOf("@", at + 1)) {
    let start = at;
    while (start > 0 && LOCAL_CHAR.test(value[start - 1])) start -= 1;
    let local = value.slice(start, at);
    const doubled = local.lastIndexOf("..");
    if (doubled !== -1) local = local.slice(doubled + 2);
    local = local.replace(/^\.+/, "");
    if (local === "" || local.endsWith(".")) continue;
    let end = at + 1;
    while (end < value.length && DOMAIN_CHAR.test(value[end])) end += 1;
    const labels = [];
    for (const label of value.slice(at + 1, end).split(".")) {
      if (!DOMAIN_LABEL.test(label) || label.startsWith("-") || label.endsWith("-")) break;
      labels.push(label);
    }
    if (labels.length >= 2) out.push(`${local}@${labels.join(".")}`);
  }
  return out;
}

const CLOSERS = { ")": "(", "]": "[", "}": "{" };

// The web addresses in the text, in order, repeats included: anything that starts with http://, https:// or www.
// and runs to the next whitespace, quote, backtick or angle bracket. Sentence punctuation at the end and a closing
// bracket with no opening one inside the address are left out. [] when there are none.
export function findUrls(text) {
  const value = str(text);
  const out = [];
  for (const match of value.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'`]+/gi)) {
    if (match.index > 0 && /[A-Za-z0-9@]/.test(value[match.index - 1])) continue;
    const found = match[0];
    const surplus = {};
    for (const closer of Object.keys(CLOSERS)) surplus[closer] = found.split(closer).length - found.split(CLOSERS[closer]).length;
    let end = found.length;
    while (end > 0) {
      const last = found[end - 1];
      if (".,;:!?*".includes(last)) end -= 1;
      else if (surplus[last] > 0) { surplus[last] -= 1; end -= 1; }
      else break;
    }
    const prefix = /^www\./i.test(found) ? 4 : found.indexOf("//") + 2;
    if (end > prefix) out.push(found.slice(0, end));
  }
  return out;
}

const NUMBER = /(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?/g;

// The numbers in the text, in order, as finite numbers: integers, decimals (".5" is 0.5), exponents ("1e3" is 1000)
// and comma-grouped thousands ("1,234.5" is 1234.5; "1,2,3" is three numbers). A hyphen or minus sign directly
// before the digits makes the number negative unless a letter, digit, underscore or closing bracket comes before it,
// so "5 -3" has -3 while "2024-01-15" and "item-2" have none. Numbers too large for a finite value are left out.
export function findNumbers(text) {
  const value = str(text);
  const out = [];
  for (const match of value.matchAll(NUMBER)) {
    const at = match.index;
    let raw = match[0];
    if (raw[0] === "." && at > 0 && /\d/.test(value[at - 1])) raw = raw.slice(1);
    const number = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(number)) continue;
    const signed = at > 0 && (value[at - 1] === "-" || value[at - 1] === "\u2212") && (at === 1 || !/[\p{L}\p{N}_)\]]/u.test(value[at - 2]));
    out.push(signed && number !== 0 ? -number : number);
  }
  return out;
}

// The phone numbers in the text as written, in order: 7 to 15 digits in groups joined by single spaces, dots or
// hyphens, with an optional leading + and bracketed groups ("+1 (555) 010-0199", "555-0100", "5550100199"). Left out:
// digits glued to a letter, underscore or one of # $ € £, ISO dates, plain decimals ("3.1415926") and
// dotted IPv4 addresses. [] when there are none.
export function findPhoneNumbers(text) {
  const value = str(text);
  const out = [];
  for (const match of value.matchAll(/\+?(?:\(\d+\)|\d+)(?:[ .-]?(?:\(\d+\)|\d+))*/g)) {
    const found = match[0];
    const digits = found.replace(/\D/g, "").length;
    if (digits < 7 || digits > 15) continue;
    const before = match.index > 0 ? value[match.index - 1] : "";
    const after = value[match.index + found.length] || "";
    if (/[\p{L}\p{N}_#$\u20AC\u00A3]/u.test(before) || /[\p{L}_]/u.test(after)) continue;
    if (/(?:^|\D)\d{4}-\d{2}-\d{2}(?:\D|$)/.test(found)) continue;
    if (/^\d+\.\d+$/.test(found) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(found)) continue;
    out.push(found);
  }
  return out;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// The ISO calendar dates (YYYY-MM-DD) in the text, in order, repeats included. Only real dates count (month 1 to 12,
// a day that month has, 29 February only in leap years) and the date must not touch another digit. A time after the
// date is not part of the match. [] when there are none.
export function findIsoDates(text) {
  const value = str(text);
  const out = [];
  for (const match of value.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    const before = match.index > 0 ? value[match.index - 1] : "";
    const after = value[match.index + 10] || "";
    if (/\d/.test(before) || /\d/.test(after)) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) continue;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (day > MONTH_DAYS[month - 1] + (month === 2 && leap ? 1 : 0)) continue;
    out.push(match[0]);
  }
  return out;
}

const PLACEHOLDER = /\{\{\s*[A-Za-z_][\w.-]*\s*\}\}|\{[A-Za-z_][\w.-]*\}|<[A-Za-z_][\w.-]*>|\[[A-Z][A-Z0-9_]*(?:[ -][A-Z0-9_]+)*\]/g;

// The template placeholders in the text as written, in order, repeats included: {name}, {{name}} (spaces inside
// allowed), <name> and [NAME] (capitals, digits, underscores, and single spaces or hyphens between words). A name
// starts with a letter or underscore. JSON such as {"a": 1}, [1] and [see below] do not match; a bare HTML tag such
// as <br> does. [] when there are none.
export function findPlaceholders(text) {
  return Array.from(str(text).matchAll(PLACEHOLDER), (match) => match[0]);
}

// The name inside one placeholder: "{{ first_name }}" and "<first_name>" are "first_name", "[ORDER ID]" is
// "ORDER ID". Text that is not wrapped in placeholder marks comes back trimmed.
export function placeholderName(token) {
  const value = str(token).trim();
  for (const [open, close] of [["{{", "}}"], ["{", "}"], ["<", ">"], ["[", "]"]]) {
    if (value.length >= open.length + close.length && value.startsWith(open) && value.endsWith(close)) {
      return value.slice(open.length, value.length - close.length).trim();
    }
  }
  return value;
}

// The contents of every `inline code` span, without the backticks, in order, repeats included. A span opens with a
// run of backticks and closes at the next run of the same length on the same line, as in Markdown, so ``a ` b`` is
// one span; one space of padding on each side is dropped. A run with no partner on its line, and so a fenced code
// block, is not a span. [] when there are none.
export function findBackticked(text) {
  const out = [];
  for (const line of str(text).split(/\r\n|\r|\n/)) {
    const runs = Array.from(line.matchAll(/`+/g), (match) => ({ start: match.index, end: match.index + match[0].length }));
    for (let open = 0; open < runs.length; open += 1) {
      const size = runs[open].end - runs[open].start;
      let close = open + 1;
      while (close < runs.length && runs[close].end - runs[close].start !== size) close += 1;
      if (close === runs.length) continue;
      let inner = line.slice(runs[open].end, runs[close].start);
      if (inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ") && inner.trim() !== "") inner = inner.slice(1, -1);
      out.push(inner);
      open = close;
    }
  }
  return out;
}

// ---------- misc ----------

// The text with every regular-expression special character escaped, so new RegExp(escapeRegExp(text)) matches the
// text literally.
export function escapeRegExp(text) {
  return str(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// How many times needle occurs in the text, without overlaps ("aaa" holds "aa" once). 0 for an empty needle.
// options.caseSensitive defaults to true; false compares both in lower case.
export function countOccurrences(text, needle, options = {}) {
  const sensitive = !(options && options.caseSensitive === false);
  const haystack = sensitive ? str(text) : str(text).toLowerCase();
  const pin = sensitive ? str(needle) : str(needle).toLowerCase();
  if (pin === "") return 0;
  let count = 0;
  for (let at = haystack.indexOf(pin); at !== -1; at = haystack.indexOf(pin, at + pin.length)) count += 1;
  return count;
}

// The text cut to at most max code points. Text that fits comes back unchanged; longer text keeps its first
// max - (ellipsis length) code points and ends with the ellipsis, so the result is exactly max long. When max is
// no longer than the ellipsis the result is the ellipsis cut to max. null when max is not a whole number >= 0.
export function truncate(text, max, ellipsis = "…") {
  if (!Number.isInteger(max) || max < 0) return null;
  const value = str(text);
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  const tail = points(ellipsis);
  if (tail.length >= max) return tail.slice(0, max).join("");
  return chars.slice(0, max - tail.length).join("") + tail.join("");
}

// The FNV-1a 32-bit hash of the text's UTF-8 bytes as 8 lower-case hex digits ("811c9dc5" for ""). It is a quick
// change detector for equal-or-not checks, not a cryptographic hash.
export function fingerprint(text) {
  let hash = 0x811C9DC5;
  eachUtf8Byte(text, (byte) => { hash = Math.imul(hash ^ byte, 0x01000193) >>> 0; });
  return hash.toString(16).padStart(8, "0");
}

// A count with its noun: "1 row", "0 rows", "3 rows", or with an explicit plural "2 queries". The singular is used
// only when count is exactly 1. null when count is not a finite number.
export function pluralize(count, singular, plural = `${str(singular)}s`) {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  return `${count} ${count === 1 ? str(singular) : str(plural)}`;
}
