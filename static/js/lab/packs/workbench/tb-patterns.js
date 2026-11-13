// Toolbox: text patterns for writing rules and checks ("workbench.toolbox", group "Text patterns"). Every tool is a
// pure function of what is typed into its form: it never reads page data, never sends the text anywhere and never
// calls the model. Patterns are JavaScript regular expressions typed by the person, so each is compiled inside a
// try/catch and the work is capped: text up to 10,000 characters, patterns up to 2,000 characters, at most 50 patterns
// or rules per form, and listing tools stop after 1,000 matches. A pattern whose shape can take exponential time (a
// repeated group whose pieces or alternatives can match the same text in more than one way, as in (a+)+, (\w+\s?)+,
// (a|aa)+ or (\s|.)*) is refused before it runs, because a regular expression cannot be interrupted once started. That
// check reads shapes, so it is a safeguard, not a proof; shapes that are only slow on a long run of the same characters
// (two repeats back to back, such as \d+\d+) are reported as advice and still run.
import { csvText, definePack } from "../../kit.js";
import { escapeRegExp, lines } from "../../lib/text.js";

const GROUP = "Text patterns";
const MAX_TEXT = 10000;
const MAX_PATTERN = 2000;
const MAX_MATCHES = 1000;
const MAX_PATTERNS = 50;
const LIMITS = "Works on up to 10,000 characters; patterns that can take exponential time are refused (see Check a pattern for slow backtracking).";
const LIST_LIMITS = "Works on up to 10,000 characters and lists at most 1,000 matches; patterns that can take exponential time are refused (see Check a pattern for slow backtracking).";

const need = (condition, message) => { if (!condition) throw new Error(message); };
const yesNo = (flag) => (flag ? "yes" : "no");
const PATTERN = (name = "pattern", label = "Pattern") => ({ name, label, type: "text", required: true, placeholder: "for example HC-\\d{4}" });
const FLAGS = { name: "flags", label: "Flags (i, m, s, u)", type: "text", placeholder: "none" };
const TEXT = (name = "text", label = "Lines", extra = {}) => ({ name, label, type: "textarea", required: true, rows: 6, ...extra });
const CHECK = (name, label, value = false) => ({ name, label, type: "checkbox", default: value });

// ---------- reading a pattern's shape ----------

// Parses the source of a pattern that already compiled into { branches: [[node, ...], ...], groups }. A node is
// { type: "char" | "escape" | "class" | "dot" | "anchor" | "group", text, atomText, start, quant }, where quant is null
// or { min, max, lazy, text } and a group also has kind ("capture" | "named" | "plain" | "ahead" | "not_ahead" |
// "behind" | "not_behind"), name, number (capturing groups only) and branches. It is lenient: it only reads shapes.
function parsePattern(source) {
  let i = 0;
  let groups = 0;
  const n = source.length;
  const escapeEnd = (at) => {
    const next = source[at + 1];
    if (next === undefined) return at + 1;
    if ("upP".includes(next) && source[at + 2] === "{") { const close = source.indexOf("}", at + 3); return close < 0 ? at + 2 : close + 1; }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(at + 2, at + 6))) return at + 6;
    if (next === "x" && /^[0-9a-fA-F]{2}$/.test(source.slice(at + 2, at + 4))) return at + 4;
    if (next === "c" && /[A-Za-z]/.test(source[at + 2] || "")) return at + 3;
    if (next === "k" && source[at + 2] === "<") { const close = source.indexOf(">", at + 3); return close < 0 ? at + 2 : close + 1; }
    if (/[1-9]/.test(next)) { let j = at + 2; while (/\d/.test(source[j] || "")) j++; return j; }
    return at + 2;
  };
  const classEnd = (at) => {
    let j = at + 1;
    if (source[j] === "^") j++;
    while (j < n && source[j] !== "]") j = source[j] === "\\" ? escapeEnd(j) : j + 1;
    return Math.min(j + 1, n);
  };
  const quantifier = () => {
    const start = i;
    let min, max;
    const c = source[i];
    if (c === "*") { min = 0; max = Infinity; i++; }
    else if (c === "+") { min = 1; max = Infinity; i++; }
    else if (c === "?") { min = 0; max = 1; i++; }
    else if (c === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (!m) return null;
      min = Number(m[1]);
      max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
      i += m[0].length;
    } else return null;
    let lazy = false;
    if (source[i] === "?") { lazy = true; i++; }
    return { min, max, lazy, text: source.slice(start, i) };
  };
  const LOOK = [["(?<=", "behind"], ["(?<!", "not_behind"], ["(?:", "plain"], ["(?=", "ahead"], ["(?!", "not_ahead"]];
  function alternation() {
    const branches = [[]];
    while (i < n && source[i] !== ")") {
      if (source[i] === "|") { branches.push([]); i++; continue; }
      branches[branches.length - 1].push(atom());
    }
    return branches;
  }
  function atom() {
    const start = i;
    const c = source[i];
    let node;
    if (c === "\\") { i = escapeEnd(i); node = { type: /^\\[bB]$/.test(source.slice(start, i)) ? "anchor" : "escape" }; }
    else if (c === "[") { i = classEnd(i); node = { type: "class" }; }
    else if (c === "(") {
      const rest = source.slice(i);
      const named = /^\(\?<([^>=!][^>]*)>/.exec(rest);
      const look = LOOK.find(([open]) => rest.startsWith(open));
      let kind = "capture", name = null;
      if (look) { kind = look[1]; i += look[0].length; }
      else if (named) { kind = "named"; name = named[1]; i += named[0].length; }
      else i += 1;
      const number = kind === "capture" || kind === "named" ? ++groups : null;
      const branches = alternation();
      if (source[i] === ")") i++;
      node = { type: "group", kind, name, number, branches };
    } else if (c === ".") { i++; node = { type: "dot" }; }
    else if (c === "^" || c === "$") { i++; node = { type: "anchor" }; }
    else { i += source.codePointAt(i) > 0xFFFF ? 2 : 1; node = { type: "char" }; }
    node.start = start;
    node.atomText = source.slice(start, i);
    node.quant = quantifier();
    node.text = source.slice(start, i);
    return node;
  }
  const branches = alternation();
  return { branches, groups };
}

const LOOKAROUND = /ahead|behind/;
const unbounded = (node) => !!node.quant && node.quant.max === Infinity;
const broad = (node) => node.type === "dot" || /^\[(?:\^|\\s\\S|\\S\\s|\\d\\D|\\D\\d|\\w\\W|\\W\\w)\]$/.test(node.atomText);
function canBeEmpty(node) {
  if (node.type === "anchor" || (node.type === "group" && LOOKAROUND.test(node.kind))) return true;
  if (node.quant && node.quant.min === 0) return true;
  return node.type === "group" && node.branches.some((branch) => branch.every(canBeEmpty));
}
// An unbounded piece that can make up a whole match of the branches on its own (everything beside it can be empty).
function soloRepeat(branches) {
  for (const branch of branches) {
    for (const item of branch) {
      if (!branch.every((other) => other === item || canBeEmpty(other))) continue;
      if (unbounded(item)) return item;
      if (item.type === "group" && !LOOKAROUND.test(item.kind)) {
        const inner = soloRepeat(item.branches);
        if (inner) return inner;
      }
    }
  }
  return null;
}
// Two neighbouring unbounded repeats that can share characters (the same piece, or a broad one such as .*).
const overlapping = (node, next) => !!next && unbounded(node) && unbounded(next) && (node.atomText === next.atomText || broad(node) || broad(next));
function descendants(branches) {
  return branches.flat().flatMap((node) => [node, ...(node.type === "group" ? descendants(node.branches) : [])]);
}

// Which characters a piece can match, read on a sample alphabet by running the piece itself, so classes, escapes and
// the i and s flags count exactly as the engine reads them. The alphabet is code points 0 to 0x17F, a few common
// characters beyond, and every other character the pattern names (typed or as an escape); a last slot stands for "some
// other character", taken by a piece that matches none of the sample. A set is an array of booleans over that alphabet;
// a back-reference can match anything.
const BASE_PROBES = [...Array.from({ length: 0x180 }, (_, k) => String.fromCharCode(k)), "\u2013", "\u2019", "\u2028", "\u3000", "\u0430", "\u4e2d", "\ufeff"];
const union = (a, b) => a.map((x, k) => x || b[k]);
const meets = (a, b) => a.some((x, k) => x && b[k]);
const zeroWidth = (node) => node.type === "anchor" || (node.type === "group" && LOOKAROUND.test(node.kind));
function charSets(flags, source) {
  const extra = new Set();
  for (const char of source) if (char.codePointAt(0) >= 0x180) extra.add(char);
  for (const m of source.matchAll(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g)) {
    const code = parseInt(m[1] || m[2] || m[3], 16);
    if (code <= 0x10FFFF) extra.add(String.fromCodePoint(code));
  }
  const probes = [...BASE_PROBES, ...extra];
  const ALL = [...probes.map(() => true), true];
  const NONE = ALL.map(() => false);
  const cache = new Map();
  const atom = (text) => {
    if (/^\\(?:[1-9]|k<)/.test(text)) return ALL;
    if (!cache.has(text)) {
      let set;
      try {
        const re = new RegExp(`^(?:${text})$`, flags);
        set = probes.map((char) => re.test(char));
        set.push(!set.includes(true));
      } catch { set = ALL; }
      cache.set(text, set);
    }
    return cache.get(text);
  };
  // Every character a piece can match anywhere in it, and the characters it can start with.
  const all = (node) => (zeroWidth(node) ? NONE : node.type === "group" ? node.branches.flat().map(all).reduce(union, NONE) : atom(node.atomText));
  const seqFirst = (seq) => {
    let set = NONE;
    for (const node of seq) { set = union(set, first(node)); if (!canBeEmpty(node)) break; }
    return set;
  };
  const first = (node) => (zeroWidth(node) ? NONE : node.type === "group" ? node.branches.map(seqFirst).reduce(union, NONE) : atom(node.atomText));
  return { all, first, seqFirst, NONE };
}
// A piece whose length can vary: a range quantifier, a choice, or a group holding either.
function variable(node) {
  if (zeroWidth(node)) return false;
  if (node.quant && node.quant.min !== node.quant.max) return true;
  if (node.type === "escape" && /^\\(?:[1-9]|k<)/.test(node.atomText)) return true;
  return node.type === "group" && (node.branches.length > 1 || node.branches.flat().some(variable));
}
// A group repeated often enough for ambiguity to multiply: no upper limit, or at least three times.
const repeated = (node) => node.type === "group" && !LOOKAROUND.test(node.kind) && !!node.quant && node.quant.max >= 3;
const literalText = (branch, flags) => {
  const parts = branch.map(literalOf);
  if (parts.some((part) => part === null)) return null;
  const text = parts.join("");
  return flags.includes("i") ? text.toLowerCase() : text;
};
// Sardinas-Patterson: whether every text made of these words splits into them in only one way. Gives up (false) on a
// long search, which counts as ambiguous.
function uniquelyDecodable(words) {
  const set = new Set(words);
  if (set.size !== words.length || set.has("")) return false;
  const quotient = (A, B) => { const out = new Set(); for (const a of A) for (const b of B) if (b.length > a.length && b.startsWith(a)) out.add(b.slice(a.length)); return out; };
  let current = quotient(set, set);
  const seen = new Set();
  for (let round = 0; current.size; round++) {
    if (round > 200) return false;
    for (const rest of current) if (set.has(rest)) return false;
    const key = [...current].sort().join("\u0000");
    if (seen.has(key)) return true;
    seen.add(key);
    current = new Set([...quotient(set, current), ...quotient(current, set)]);
  }
  return true;
}

// Shapes known to make a backtracking engine slow, in order of position: { position, piece, severity, finding }.
// "problem" shapes are groups repeated with no limit (or three or more times) where the same text can be matched in
// more than one way: a piece that can be a whole repetition on its own, a broad repeat such as .*, two variable pieces
// back to back that can match the same characters, an end that can also start the next repetition, or alternatives
// that can split the same text differently. They can take exponential time and the tools that run a pattern refuse
// them. "advice" shapes are slow only on long runs of characters (polynomial time) and still run.
function backtrackingRisks(source, flags = "") {
  const tree = parsePattern(source);
  const sets = charSets(flags.replace(/[gy]/g, ""), source);
  const out = [];
  const add = (node, severity, finding) => out.push({ position: node.start + 1, piece: node.text, severity, finding });
  // The first two variable pieces, anywhere inside the branches, that can match the same characters back to back.
  const backToBack = (branches) => {
    for (const branch of branches) {
      for (let i = 0; i < branch.length; i++) {
        if (variable(branch[i])) {
          for (let j = i + 1; j < branch.length; j++) {
            if (meets(sets.all(branch[i]), sets.first(branch[j]))) return [branch[i], branch[j]];
            if (!canBeEmpty(branch[j])) break;
          }
        }
        if (branch[i].type === "group") { const inner = backToBack(branch[i].branches); if (inner) return inner; }
      }
    }
    return null;
  };
  // A variable piece that can end a repetition and match what starts the next one.
  const wraps = (node) => {
    const start = node.branches.map(sets.seqFirst).reduce(union, sets.NONE);
    for (const branch of node.branches) {
      for (let k = branch.length - 1; k >= 0; k--) {
        if (variable(branch[k]) && meets(sets.all(branch[k]), start)) return branch[k];
        if (!canBeEmpty(branch[k])) break;
      }
    }
    return null;
  };
  const visit = (branches) => {
    for (const branch of branches) {
      branch.forEach((node, index) => {
        const next = branch[index + 1];
        if (overlapping(node, next)) {
          add(node, "advice", `next to ${next.text}, two repeats can share the same characters, so matching slows down sharply on a long run of characters both can match`);
        }
        if (node.type !== "group") return;
        if (repeated(node)) {
          const solo = soloRepeat(node.branches);
          const inner = descendants(node.branches).filter(unbounded);
          const wide = inner.find(broad);
          const pair = backToBack(node.branches);
          const end = wraps(node);
          const texts = node.branches.map((b) => b.map((x) => x.text).join(""));
          const twin = texts.find((text, k) => texts.indexOf(text) !== k);
          const starts = node.branches.map(sets.seqFirst);
          const clash = [];
          starts.forEach((a, k) => starts.forEach((b, m) => { if (m > k && meets(a, b)) clash.push([k, m]); }));
          const words = node.branches.map((b) => literalText(b, flags));
          const literal = words.every((word) => word !== null && word !== "");
          if (solo) add(node, "problem", `repeats ${solo.text}, which is itself repeated: the same text can be split between the two repeats in exponentially many ways`);
          else if (wide) add(node, "problem", `repeats a group holding ${wide.text}, which can swallow what ends each repetition: exponential time on text that almost matches`);
          else if (twin !== undefined) add(node, "problem", `repeats a choice with two identical alternatives (${twin}), which doubles the ways to match at every repetition`);
          else if (pair) add(node, "problem", `repeats ${pair[0].text} followed by ${pair[1].text}, which can match the same characters, so the ways to split the text multiply at every repetition`);
          else if (end) add(node, "problem", `repeats a group whose end ${end.text} can also match the start of the next repetition, so the text can be split between repetitions in exponentially many ways`);
          else if (clash.length && !(literal && uniquelyDecodable(words))) {
            const [k, m] = clash[0];
            add(node, "problem", `repeats a choice whose alternatives ${texts[k]} and ${texts[m]} can match the same text, so the ways to match multiply at every repetition`);
          } else {
            if (inner.length) add(node, "advice", `repeats a group holding ${inner[0].text}: safe only while each repetition must end in something ${inner[0].text} cannot match`);
            if (texts.some((a, k) => texts.some((b, m) => m !== k && a !== "" && b.startsWith(a)))) {
              add(node, "advice", "repeats a choice where one alternative starts another, so the engine may retry many splits");
            }
          }
        }
        visit(node.branches);
      });
    }
  };
  visit(tree.branches);
  return out.sort((a, b) => a.position - b.position);
}

// Capturing groups in number order: [{ number, name }].
function captureGroups(source) {
  const out = [];
  const walk = (branches) => branches.flat().forEach((node) => {
    if (node.type !== "group") return;
    if (node.number) out.push({ number: node.number, name: node.name });
    walk(node.branches);
  });
  walk(parsePattern(source).branches);
  return out.sort((a, b) => a.number - b.number);
}
const groupColumn = (group) => group.name || `group ${group.number}`;

// ---------- compiling and matching ----------

function readFlags(text) {
  const flags = String(text ?? "").replace(/[\s,]/g, "");
  need(/^[imsu]*$/.test(flags), "Flags: use only i (ignore case), m (multiline), s (dot matches line breaks) and u (Unicode).");
  need(new Set(flags).size === flags.length, "Flags: give each flag once.");
  return flags;
}

// A global RegExp from a typed pattern. Throws an Error a person can act on: too long, not valid, or a shape that can
// take exponential time.
function compile(source, flagText = "", label = "Pattern") {
  const flags = readFlags(flagText);
  need(source.length <= MAX_PATTERN, `${label} is longer than ${MAX_PATTERN.toLocaleString("en-US")} characters.`);
  let re;
  try { re = new RegExp(source, `${flags}g`); } catch (error) { throw new Error(`${label} is not a valid regular expression: ${error.message}`); }
  const risk = backtrackingRisks(source, flags).find((item) => item.severity === "problem");
  need(!risk, `${label} was not run: at character ${risk?.position}, ${risk?.piece} ${risk?.finding}. Rewrite it (see "Check a pattern for slow backtracking").`);
  return re;
}
const checkText = (text, label = "Text") => need(text.length <= MAX_TEXT, `${label} is longer than 10,000 characters; paste a shorter sample.`);

const nextIndex = (text, index, unicode) => (unicode && index < text.length && text.codePointAt(index) > 0xFFFF ? index + 2 : index + 1);
// Every match of a global RegExp, at most cap of them; capped tells whether more were left.
function matchesIn(re, text, cap = MAX_MATCHES) {
  const list = [];
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text))) {
    if (list.length === cap) { re.lastIndex = 0; return { list, capped: true }; }
    list.push(match);
    if (match[0] === "") re.lastIndex = nextIndex(text, re.lastIndex, re.unicode);
  }
  return { list, capped: false };
}
const firstMatch = (re, text) => { re.lastIndex = 0; const match = re.exec(text); re.lastIndex = 0; return match; };
const groupValues = (match) => match.slice(1).map((value) => (value === undefined ? null : value));
// 1-based line and column (in characters) of a position in the text; CRLF counts as one line break.
function lineColumn(text, index) {
  const before = text.slice(0, index);
  const breaks = (before.match(/\r\n|\r|\n/g) || []).length;
  const lastBreak = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
  return [breaks + 1, Array.from(before.slice(lastBreak + 1)).length + 1];
}
const patternList = (text, label) => {
  const list = lines(text).filter((line) => line.trim() !== "");
  need(list.length > 0, `${label}: give at least one pattern.`);
  need(list.length <= MAX_PATTERNS, `${label}: give at most ${MAX_PATTERNS} patterns.`);
  return list;
};
// A typed replacement with \n (line break), \t (tab), \xHH (any character, \x20 for a space) and \\ (a backslash)
// read as escapes, since a form field holding only spaces reads as blank. $1, $<name>, $& and $$ pass through.
const replacementOf = (text) => text.replace(/\\(?:x([0-9a-fA-F]{2})|([nt\\]))/g, (_, hex, char) => (hex ? String.fromCharCode(parseInt(hex, 16)) : { n: "\n", t: "\t", "\\": "\\" }[char]));
const percent = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");

// ---------- building patterns ----------

// The class text for one code point inside [...].
function classChar(code) {
  const char = String.fromCodePoint(code);
  if ("\\]^-[".includes(char)) return `\\${char}`;
  const named = { 9: "\\t", 10: "\\n", 13: "\\r", 11: "\\v", 12: "\\f" }[code];
  if (named) return named;
  if (code < 0x20 || code === 0x7F) return `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
  return char;
}

// A pattern matching exactly the whole numbers from lo to hi written without leading zeros (both strings of digits
// with the same length when called from sameLength).
function sameLength(a, b) {
  if (a === b) return [escapeRegExp(a)];
  if (a.length === 1) return [`[${a}-${b}]`];
  const rest = a.length - 1;
  const tailAll = rest === 1 ? "\\d" : `\\d{${rest}}`;
  if (a[0] === b[0]) return sameLength(a.slice(1), b.slice(1)).map((part) => a[0] + part);
  const aRest = a.slice(1), bRest = b.slice(1);
  const lowFull = /^0*$/.test(aRest), highFull = /^9*$/.test(bRest);
  const out = [];
  const digitRange = (x, y) => (x === y ? String(x) : `[${x}-${y}]`);
  const da = Number(a[0]), db = Number(b[0]);
  const from = lowFull ? da : da + 1;
  const to = highFull ? db : db - 1;
  if (!lowFull) out.push(...sameLength(aRest, "9".repeat(rest)).map((part) => a[0] + part));
  if (from <= to) out.push(`${digitRange(from, to)}${tailAll}`);
  if (!highFull) out.push(...sameLength("0".repeat(rest), bRest).map((part) => b[0] + part));
  return out;
}
function numberRange(lo, hi) {
  const out = [];
  for (let digits = String(lo).length; digits <= String(hi).length; digits++) {
    const low = Math.max(lo, digits === 1 ? 0 : 10 ** (digits - 1));
    const high = Math.min(hi, 10 ** digits - 1);
    if (low <= high) out.push(...sameLength(String(low), String(high)));
  }
  return out;
}

// A glob (*, **, ?, [abc], [!abc], {a,b}, \ to escape) or SQL LIKE (%, _, \ to escape) as an anchored pattern.
function globBody(glob, inBraces = false) {
  let out = "";
  for (let i = 0; i < glob.length;) {
    const c = glob[i];
    if (c === "\\") { out += escapeRegExp(glob[i + 1] ?? "\\"); i += 2; }
    else if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 3; } else { out += ".*"; i += 2; }
    } else if (c === "*") { out += "[^/]*"; i++; }
    else if (c === "?") { out += "[^/]"; i++; }
    else if (c === "[") {
      let j = i + 1;
      if (glob[j] === "!" || glob[j] === "^") j++;
      if (glob[j] === "]") j++;
      const close = glob.indexOf("]", j);
      need(close >= 0, `The glob has a [ with no closing ] at character ${i + 1}.`);
      let inner = glob.slice(i + 1, close);
      const negate = inner[0] === "!" || inner[0] === "^";
      if (negate) inner = inner.slice(1);
      out += `[${negate ? "^" : ""}${inner.replace(/[\\\]\[]/g, "\\$&")}]`;
      i = close + 1;
    } else if (c === "{") {
      need(!inBraces, "Nested braces are not supported in a glob.");
      const close = glob.indexOf("}", i);
      need(close >= 0, `The glob has a { with no closing } at character ${i + 1}.`);
      const inner = glob.slice(i + 1, close);
      need(!inner.includes("{"), "Nested braces are not supported in a glob.");
      out += `(?:${inner.split(",").map((part) => globBody(part, true)).join("|")})`;
      i = close + 1;
    } else { out += escapeRegExp(c); i++; }
  }
  return out;
}
function likeBody(like) {
  let out = "";
  for (let i = 0; i < like.length; i++) {
    const c = like[i];
    if (c === "\\" && i + 1 < like.length) { out += escapeRegExp(like[++i]); }
    else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += escapeRegExp(c);
  }
  return out;
}

// ---------- explaining ----------

const ESCAPES = { "\\d": "a digit (0-9)", "\\D": "a character that is not a digit", "\\w": "a word character (A-Z, a-z, 0-9 or _)",
  "\\W": "a character that is not a word character", "\\s": "a whitespace character", "\\S": "a character that is not whitespace",
  "\\b": "a word boundary", "\\B": "a position that is not a word boundary", "\\n": "a line feed", "\\r": "a carriage return", "\\t": "a tab",
  "\\f": "a form feed", "\\v": "a vertical tab", "\\0": "the NUL character" };
function escapeMeaning(text) {
  if (ESCAPES[text]) return ESCAPES[text];
  let m;
  if ((m = /^\\(\d+)$/.exec(text))) return `the same text that group ${m[1]} matched`;
  if ((m = /^\\k<(.+)>$/.exec(text))) return `the same text that group "${m[1]}" matched`;
  if ((m = /^\\p\{(.+)\}$/.exec(text))) return `a character with the Unicode property ${m[1]}`;
  if ((m = /^\\P\{(.+)\}$/.exec(text))) return `a character without the Unicode property ${m[1]}`;
  if ((m = /^\\u\{([0-9a-fA-F]+)\}$|^\\u([0-9a-fA-F]{4})$|^\\x([0-9a-fA-F]{2})$/.exec(text))) {
    return `the character U+${(m[1] || m[2] || m[3]).toUpperCase().padStart(4, "0")}`;
  }
  if ((m = /^\\c([A-Za-z])$/.exec(text))) return `the control character Ctrl-${m[1].toUpperCase()}`;
  return `the character "${text.slice(1)}"`;
}
// A literal character a node stands for, or null when it is not a plain literal.
const literalOf = (node) => (node.quant ? null : node.type === "char" ? node.atomText
  : node.type === "escape" && /^\\[^A-Za-z0-9]$/.test(node.atomText) ? node.atomText.slice(1) : null);
function quantPhrase(quant) {
  if (!quant) return "";
  const { min, max, lazy } = quant;
  const base = min === 0 && max === Infinity ? "zero or more times" : min === 1 && max === Infinity ? "one or more times"
    : min === 0 && max === 1 ? "optional" : max === Infinity ? `${min} or more times` : min === max ? `exactly ${min} times` : `${min} to ${max} times`;
  return `, ${base}${lazy ? " (as few as possible)" : ""}`;
}
const GROUP_WORDS = { capture: (node) => `capture group ${node.number}`, named: (node) => `capture group ${node.number} named "${node.name}"`,
  plain: () => "a group (no capture)", ahead: () => "lookahead: followed by", not_ahead: () => "negative lookahead: not followed by",
  behind: () => "lookbehind: preceded by", not_behind: () => "negative lookbehind: not preceded by" };
function explainBranches(branches, level, flags, out) {
  const literalRow = (source, run) => [level, source, Array.from(run).length === 1 ? `the character "${run}"` : `the text "${run}"`];
  branches.forEach((branch, index) => {
    if (index > 0) out.push([level, "|", "or"]);
    let run = "", runSource = "";
    for (const node of branch) {
      const literal = literalOf(node);
      if (literal !== null) { run += literal; runSource += node.text; continue; }
      if (run) { out.push(literalRow(runSource, run)); run = ""; runSource = ""; }
      let meaning;
      if (node.type === "group") meaning = GROUP_WORDS[node.kind](node);
      else if (node.type === "char") meaning = `the character "${node.atomText}"`;
      else if (node.type === "escape" || (node.type === "anchor" && node.atomText.startsWith("\\"))) meaning = escapeMeaning(node.atomText);
      else if (node.type === "class") meaning = node.atomText.startsWith("[^") ? `one character not in ${node.atomText}` : `one character from ${node.atomText}`;
      else if (node.type === "dot") meaning = flags.includes("s") ? "any character" : "any character except a line break";
      else meaning = node.atomText === "^" ? (flags.includes("m") ? "the start of a line" : "the start of the text") : (flags.includes("m") ? "the end of a line" : "the end of the text");
      out.push([level, node.text, meaning + quantPhrase(node.quant)]);
      if (node.type === "group") explainBranches(node.branches, level + 1, flags, out);
    }
    if (run) out.push(literalRow(runSource, run));
  });
}

// ---------- converting between Python and JavaScript ----------

// Walks a pattern outside and inside character classes, letting visit(token, inClass) return a replacement. A class
// opening with ] reads as Python does (the ] is a character) for dialect "py", and as JavaScript does for "js" ([] is
// an empty class and [^] any character); either way it comes to visit as one token "[]" or "[^]".
function rewrite(source, visit, dialect) {
  let out = "", inClass = false;
  for (let i = 0; i < source.length;) {
    let token;
    if (source[i] === "\\") {
      const brace = /^\\[upPN]\{[^}]*\}|^\\U[0-9a-fA-F]{8}|^\\k<[^>]*>|^\\c[A-Za-z]/.exec(source.slice(i));
      token = brace ? brace[0] : source.slice(i, i + 2);
    } else if (!inClass && source[i] === "(") {
      const group = /^\(\?P<[^>]*>|^\(\?P=[^)]*\)|^\(\?<[^>=!][^>]*>|^\(\?#[^)]*\)|^\(\?>|^\(\?[a-zA-Z]+\)/.exec(source.slice(i));
      token = group ? group[0] : "(";
    } else if (!inClass && source[i] === "[") token = (/^\[\^?\]/.exec(source.slice(i)) || ["["])[0];
    else token = source[i];
    const replaced = visit(token, inClass, i);
    out += replaced === undefined ? token : replaced;
    if (token === "[" || (dialect === "py" && token !== "[" && token[0] === "[" && !inClass)) inClass = true;
    else if (inClass && token === "]") inClass = false;
    i += token.length;
  }
  return out;
}

// ---------- shape of example values ----------

function runsOf(text) {
  const runs = [];
  for (const char of text) {
    const kind = /[0-9]/.test(char) ? "digit" : /[A-Za-z]/.test(char) ? "letter" : "other";
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && kind !== "other") last.text += char;
    else runs.push({ kind, text: char });
  }
  return runs;
}
const lengthQuant = (lengths) => {
  const lo = Math.min(...lengths), hi = Math.max(...lengths);
  return lo === hi ? (lo === 1 ? "" : `{${lo}}`) : `{${lo},${hi}}`;
};

export default definePack({
  id: "tb-patterns",
  surface: "workbench.toolbox",
  title: "Text pattern tools",
  about: "Toolbox tools for writing rules and checks with regular expressions: test, replace, extract, count, escape, build, explain and compare patterns on pasted text. They run only on what is typed into the form, cap the work at 10,000 characters and 1,000 listed matches, and refuse patterns shaped to take exponential time (a repeated group that can match the same text in more than one way).",
  features: [
    { id: "test_lines", kind: "tool", group: GROUP, title: "Test a pattern on lines",
      help: `Runs the pattern on each pasted line: whether it matches, the first match and its capture groups (null for a group that took no part). The text output lists the lines without a match. ${LIMITS}`,
      inputs: [PATTERN(), FLAGS, TEXT(), CHECK("whole", "Whole line must match")],
      compute: ({ pattern, flags, text, whole }) => {
        checkText(text);
        compile(pattern, flags);
        const re = compile(whole ? `^(?:${pattern})$` : pattern, flags);
        const all = lines(text);
        const table = all.map((line, index) => {
          const match = firstMatch(re, line);
          return [index + 1, yesNo(!!match), match ? match[0] : "", match ? JSON.stringify(groupValues(match)) : ""];
        });
        const misses = all.filter((_, index) => table[index][1] === "no");
        return { rows: [["Lines", all.length], ["Lines with a match", all.length - misses.length], ["Lines without a match", misses.length],
          ["Capture groups", captureGroups(pattern).length]], table: { columns: ["line", "matched", "match", "groups"], rows: table }, text: misses.join("\n") };
      } },
    { id: "match_details", kind: "tool", group: GROUP, title: "Every match with its position and groups",
      help: `Searches the whole text (so m and s flags apply across lines) and lists each match with its line, column (in characters) and one column per capture group, named groups by name. The text below is the same list as CSV (line, column, match, groups), with a leading apostrophe on cells a spreadsheet would run as a formula. ${LIST_LIMITS}`,
      inputs: [PATTERN(), FLAGS, TEXT("text", "Text")],
      compute: ({ pattern, flags, text }) => {
        checkText(text);
        const re = compile(pattern, flags);
        const groups = captureGroups(pattern);
        const { list, capped } = matchesIn(re, text);
        const rows = list.map((match, index) => [index + 1, ...lineColumn(text, match.index), match[0], ...groupValues(match)]);
        const csv = csvText([["line", "column", "match", ...groups.map(groupColumn)], ...rows.map(([, ...rest]) => rest.map((value) => value ?? ""))]);
        return { rows: [["Matches", list.length], ["Lines with a match", new Set(rows.map((row) => row[1])).size], ["Stopped at 1,000 matches", yesNo(capped)]],
          table: { columns: ["match", "line", "column", "text", ...groups.map(groupColumn)], rows }, text: csv };
      } },
    { id: "keep_lines", kind: "tool", group: GROUP, title: "Keep or drop lines that match",
      help: `Filters pasted lines by a pattern: keeps only the lines with a match, or drops them, like grep and grep -v. ${LIMITS}`,
      inputs: [PATTERN(), FLAGS, TEXT(), { name: "mode", label: "Lines with a match", type: "select", options: [["keep", "Keep them"], ["drop", "Drop them"]], default: "keep" }],
      compute: ({ pattern, flags, text, mode }) => {
        checkText(text);
        const re = compile(pattern, flags);
        const all = lines(text);
        const kept = all.filter((line) => !!firstMatch(re, line) === (mode === "keep"));
        return { rows: [["Lines", all.length], ["Lines kept", kept.length], ["Lines dropped", all.length - kept.length]], text: kept.join("\n") };
      } },
    { id: "replace_preview", kind: "tool", group: GROUP, title: "Preview a find-and-replace",
      help: `Replaces every match in the text and shows the result and each changed line before and after. The replacement may use $1, $<name>, $& (the whole match) and $$ (a dollar sign), and \\n, \\t, \\x20 (a space) and \\\\ for a line break, a tab, a space and a backslash. Nothing is changed anywhere else. ${LIMITS}`,
      inputs: [PATTERN(), FLAGS, TEXT("text", "Text"), { name: "replacement", label: "Replace with", type: "text", placeholder: "blank deletes the match" }],
      compute: ({ pattern, flags, text, replacement }) => {
        checkText(text);
        const re = compile(pattern, flags);
        const count = matchesIn(re, text, Infinity).list.length;
        const out = text.replace(re, replacementOf(replacement));
        const before = lines(text), after = lines(out);
        const sameShape = before.length === after.length;
        const changed = sameShape ? before.map((line, index) => [index + 1, line, after[index]]).filter(([, a, b]) => a !== b) : [];
        return { rows: [["Replacements", count], ["Lines changed", sameShape ? changed.length : null], ["Lines before", before.length], ["Lines after", after.length]],
          table: sameShape ? { columns: ["line", "before", "after"], rows: changed } : null, text: out,
          note: sameShape ? null : "The number of lines changed, so lines are not compared one by one." };
      } },
    { id: "replace_steps", kind: "tool", group: GROUP, title: "Apply several replacements in order",
      help: `One rule per line written as pattern => replacement (a line ending in " =>" deletes the match; the replacement takes the same $1 and \\n escapes as a single find-and-replace). Each rule runs on the result of the one before, with the same flags, and the table counts what each rule replaced. At most 50 rules. ${LIMITS}`,
      inputs: [{ name: "rules", label: "Rules (pattern => replacement)", type: "textarea", required: true, rows: 4, placeholder: "\\s+ =>  \nHC-(\\d+) => order $1" }, FLAGS, TEXT("text", "Text")],
      compute: ({ rules, flags, text }) => {
        checkText(text);
        const list = patternList(rules, "Rules").map((line, index) => {
          const bare = line.replace(/\s+$/, "");
          const at = bare.endsWith(" =>") && !line.includes(" => ") ? bare.length - 3 : line.indexOf(" => ");
          need(at > 0, `Rule ${index + 1} must be written as pattern => replacement.`);
          const replacement = line.slice(at + 4);
          return { pattern: line.slice(0, at), replacement, with: replacementOf(replacement), re: compile(line.slice(0, at), flags, `Rule ${index + 1}`) };
        });
        let out = text;
        const table = list.map((rule, index) => {
          const count = matchesIn(rule.re, out, Infinity).list.length;
          out = out.replace(rule.re, rule.with);
          return [index + 1, rule.pattern, rule.replacement, count];
        });
        return { rows: [["Rules", list.length], ["Replacements", table.reduce((sum, row) => sum + row[3], 0)]],
          table: { columns: ["rule", "pattern", "replacement", "replacements"], rows: table }, text: out };
      } },
    { id: "list_matches", kind: "tool", group: GROUP, title: "List every match",
      help: `Each match (or one capture group of it) on its own line, ready to paste elsewhere, and a table of the distinct values with how often each appears. Group 0 is the whole match. ${LIST_LIMITS}`,
      inputs: [PATTERN(), FLAGS, TEXT("text", "Text"), { name: "group", label: "Group number", type: "integer", min: 0, default: 0 }, CHECK("unique", "List each value once")],
      compute: ({ pattern, flags, text, group, unique }) => {
        checkText(text);
        const re = compile(pattern, flags);
        const groups = captureGroups(pattern).length;
        need(group <= groups, `Group number: the pattern has ${groups} capture group${groups === 1 ? "" : "s"}.`);
        const { list, capped } = matchesIn(re, text);
        const values = list.map((match) => match[group]).filter((value) => value !== undefined);
        const counts = new Map();
        for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
        return { rows: [["Matches", list.length], ["Matches without the group", list.length - values.length], ["Distinct values", counts.size], ["Stopped at 1,000 matches", yesNo(capped)]],
          table: { columns: ["value", "times"], rows: [...counts] }, text: (unique ? [...counts.keys()] : values).join("\n") };
      } },
    { id: "lines_to_json", kind: "tool", group: GROUP, title: "Parse lines into JSON rows with named groups",
      help: `Each line's first match becomes one JSON object keyed by the pattern's named groups, for example (?<order>HC-\\d+) .* (?<status>late|lost), ready for Bulk rows. A group that took no part is null; lines without a match are listed. ${LIMITS}`,
      inputs: [PATTERN(), FLAGS, TEXT()],
      compute: ({ pattern, flags, text }) => {
        checkText(text);
        const re = compile(pattern, flags);
        const names = captureGroups(pattern).filter((group) => group.name).map((group) => group.name);
        need(names.length > 0, "Pattern: give at least one named group, written (?<name>...).");
        const rows = [], misses = [];
        lines(text).forEach((line, index) => {
          const match = firstMatch(re, line);
          if (!match) { misses.push([index + 1, line]); return; }
          rows.push(Object.fromEntries(names.map((name) => [name, match.groups[name] ?? null])));
        });
        return { rows: [["Lines", rows.length + misses.length], ["Rows made", rows.length], ["Lines without a match", misses.length]],
          table: { columns: ["line", "text without a match"], rows: misses }, text: JSON.stringify(rows, null, 2) };
      } },
    { id: "count_per_pattern", kind: "tool", group: GROUP, title: "Lines matching each of several patterns",
      help: `One pattern per line; counts the pasted lines each one matches, and the lines matched by none, by more than one and by all. Handy for checking that rules cover the text without overlapping. At most 50 patterns. ${LIMITS}`,
      inputs: [{ name: "patterns", label: "Patterns (one per line)", type: "textarea", required: true, rows: 4 }, FLAGS, TEXT()],
      compute: ({ patterns, flags, text }) => {
        checkText(text);
        const list = patternList(patterns, "Patterns").map((source, index) => ({ source, re: compile(source, flags, `Pattern ${index + 1}`) }));
        const all = lines(text);
        const hitsPerLine = all.map((line) => list.map((item) => !!firstMatch(item.re, line)));
        const counts = list.map((_, k) => hitsPerLine.filter((hits) => hits[k]).length);
        const perLine = hitsPerLine.map((hits) => hits.filter(Boolean).length);
        return { rows: [["Lines", all.length], ["Patterns", list.length], ["Lines matching none", perLine.filter((c) => c === 0).length],
          ["Lines matching more than one", perLine.filter((c) => c > 1).length], ["Lines matching all", perLine.filter((c) => c === list.length).length]],
        table: { columns: ["pattern", "text", "lines", "share of lines"], rows: list.map((item, k) => [k + 1, item.source, counts[k], percent(counts[k], all.length)]) } };
      } },
    { id: "first_rule", kind: "tool", group: GROUP, title: "Route lines to the first pattern that matches",
      help: `Treats the patterns (one per line) as ordered rules: each pasted line goes to the first rule that matches it, as a router would. Shows each line's rule, how many lines each rule caught, and the rules that caught nothing because earlier rules took their lines or nothing matched. At most 50 rules. ${LIMITS}`,
      inputs: [{ name: "patterns", label: "Rules (one pattern per line, in order)", type: "textarea", required: true, rows: 4 }, FLAGS, TEXT()],
      compute: ({ patterns, flags, text }) => {
        checkText(text);
        const list = patternList(patterns, "Rules").map((source, index) => compile(source, flags, `Rule ${index + 1}`));
        const all = lines(text);
        const routed = all.map((line) => list.findIndex((re) => !!firstMatch(re, line)));
        const counts = list.map((_, k) => routed.filter((rule) => rule === k).length);
        const idle = counts.map((count, k) => (count === 0 ? k + 1 : 0)).filter(Boolean);
        return { rows: [...counts.map((count, k) => [`Rule ${k + 1}`, count]), ["No rule", routed.filter((rule) => rule < 0).length],
          ["Rules that caught nothing", idle.length ? idle.join(", ") : "none"]],
        table: { columns: ["line", "rule", "text"], rows: all.map((line, index) => [index + 1, routed[index] < 0 ? "none" : routed[index] + 1, line]) } };
      } },
    { id: "escape_text", kind: "tool", group: GROUP, title: "Escape text for a pattern",
      help: "Escapes every character with a special meaning (. * + ? ^ $ { } ( ) | [ ] \\) so the pattern matches the text literally, optionally only as a whole word (not inside a longer word of A-Z, a-z, 0-9 or _) or as the whole line. Also gives the pattern as a JSON string for configuration files.",
      inputs: [{ name: "text", label: "Text", type: "text", required: true },
        { name: "mode", label: "Match", type: "select", options: [["anywhere", "Anywhere"], ["word", "As a whole word"], ["line", "As the whole line"]], default: "anywhere" }],
      compute: ({ text, mode }) => {
        const escaped = escapeRegExp(text);
        const pattern = mode === "word" ? `(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])` : mode === "line" ? `^${escaped}$` : escaped;
        return { rows: [["Characters escaped", (text.match(/[.*+?^${}()|[\]\\]/g) || []).length], ["As a JSON string", JSON.stringify(pattern)]], text: pattern };
      } },
    { id: "keyword_pattern", kind: "tool", group: GROUP, title: "Pattern from a word list",
      help: "One word or phrase per line becomes one pattern that matches any of them: special characters escaped, duplicates removed, longer entries first so \"refund request\" wins over \"refund\", and optionally whole words only. At most 1,000 entries.",
      inputs: [{ name: "words", label: "Words or phrases (one per line)", type: "textarea", required: true, rows: 5 }, CHECK("whole", "Whole words only", true), CHECK("ignoreCase", "Ignore case")],
      compute: ({ words, whole, ignoreCase }) => {
        const list = lines(words).map((line) => line.trim()).filter(Boolean);
        need(list.length > 0, "Words: give at least one word or phrase.");
        need(list.length <= 1000, "Words: give at most 1,000 entries.");
        const seen = new Set(), kept = [];
        for (const word of list) {
          const key = ignoreCase ? word.toLowerCase() : word;
          if (!seen.has(key)) { seen.add(key); kept.push(word); }
        }
        const ordered = kept.map((word, index) => [word, index]).sort((a, b) => Array.from(b[0]).length - Array.from(a[0]).length || a[1] - b[1]).map(([word]) => word);
        const body = `(?:${ordered.map(escapeRegExp).join("|")})`;
        const pattern = whole ? `(?<![A-Za-z0-9_])${body}(?![A-Za-z0-9_])` : body;
        return { rows: [["Entries", kept.length], ["Duplicates removed", list.length - kept.length], ["Flags", ignoreCase ? "i" : "none"]], text: pattern };
      } },
    { id: "backtracking_check", kind: "tool", group: GROUP, title: "Check a pattern for slow backtracking",
      help: "Advice from the pattern's shape, not a proof. A group repeated with no limit (or three or more times) that can match the same text in more than one way can take exponential time: a piece that can be a whole repetition on its own, as in (a+)+ or (\\w+\\s?)+, a broad repeat such as .*, two pieces back to back that can match the same characters, as in (\\s?\\s?)+, an end that can also start the next repetition, or alternatives that can match the same text, as in (a|aa)+ or (\\s|.)*. These are problems, and the other pattern tools refuse them. Two repeats back to back outside a repeated group, such as \\d+\\d+, and a repeat holding another repeat are advice: they still run but slow down on a long run of the same characters.",
      inputs: [PATTERN(), FLAGS],
      compute: ({ pattern, flags }) => {
        const f = readFlags(flags);
        need(pattern.length <= MAX_PATTERN, `Pattern is longer than ${MAX_PATTERN.toLocaleString("en-US")} characters.`);
        try { new RegExp(pattern, f); } catch (error) { throw new Error(`Pattern is not a valid regular expression: ${error.message}`); }
        const risks = backtrackingRisks(pattern, f);
        const problem = risks.some((risk) => risk.severity === "problem");
        return { rows: [["Findings", risks.length], ["Refused by the pattern tools", yesNo(problem)],
          ["Verdict", problem ? "Can take exponential time: rewrite it" : risks.length ? "Can be slow on long text" : "No slow shapes found"]],
        table: { columns: ["position", "piece", "severity", "finding"], rows: risks.map((risk) => [risk.position, risk.piece, risk.severity, risk.finding]) } };
      } },
    { id: "glob_to_pattern", kind: "tool", group: GROUP, title: "Glob or SQL LIKE to a pattern",
      help: "Turns a wildcard into an anchored regular expression. Glob: * is any run within one path part (no /), ** crosses parts, ? one character, [abc] and [!abc] sets, {a,b} choices. SQL LIKE: % is any run, _ one character. In both, \\ makes the next character literal. Optional sample lines show which ones match.",
      inputs: [{ name: "wildcard", label: "Wildcard", type: "text", required: true, placeholder: "orders/**/*.json" },
        { name: "syntax", label: "Syntax", type: "select", options: [["glob", "Glob"], ["like", "SQL LIKE"]], default: "glob" },
        TEXT("samples", "Sample lines", { required: false, rows: 4 })],
      compute: ({ wildcard, syntax, samples }) => {
        checkText(samples, "Sample lines");
        const pattern = `^${syntax === "like" ? likeBody(wildcard) : globBody(wildcard)}$`;
        const re = compile(pattern, "", "The converted pattern");
        const all = lines(samples);
        const table = all.map((line, index) => [index + 1, yesNo(!!firstMatch(re, line)), line]);
        return { rows: [["Sample lines", all.length], ["Sample lines that match", table.filter((row) => row[1] === "yes").length]],
          table: all.length ? { columns: ["line", "matches", "text"], rows: table } : null, text: pattern };
      } },
    { id: "compare_patterns", kind: "tool", group: GROUP, title: "Compare two patterns on sample lines",
      help: `Runs pattern A and pattern B on each pasted line and counts the lines both match, only one matches, or neither, to check that a rewritten pattern still catches the same lines. ${LIMITS}`,
      inputs: [PATTERN("a", "Pattern A"), PATTERN("b", "Pattern B"), FLAGS, TEXT()],
      compute: ({ a, b, flags, text }) => {
        checkText(text);
        const reA = compile(a, flags, "Pattern A"), reB = compile(b, flags, "Pattern B");
        const table = lines(text).map((line, index) => [index + 1, yesNo(!!firstMatch(reA, line)), yesNo(!!firstMatch(reB, line)), line]);
        const count = (x, y) => table.filter((row) => row[1] === x && row[2] === y).length;
        return { rows: [["Lines", table.length], ["Matched by both", count("yes", "yes")], ["Only A", count("yes", "no")], ["Only B", count("no", "yes")], ["Neither", count("no", "no")]],
          table: { columns: ["line", "A", "B", "text"], rows: table } };
      } },
    { id: "expected_lines", kind: "tool", group: GROUP, title: "Check a pattern against should-match and should-not lines",
      help: `A small test suite for a rule: start each example line with + if the pattern should find a match in it, or - if it should not (a space after the sign is optional). Lists the examples it gets wrong. Blank lines are skipped. ${LIMITS}`,
      inputs: [PATTERN(), FLAGS, TEXT("examples", "Examples (+ or - at the start)")],
      compute: ({ pattern, flags, examples }) => {
        checkText(examples, "Examples");
        const re = compile(pattern, flags);
        const table = [];
        lines(examples).forEach((line, index) => {
          if (line.trim() === "") return;
          const sign = line[0];
          need(sign === "+" || sign === "-", `Line ${index + 1} must start with + (should match) or - (should not match).`);
          const body = line.slice(1).replace(/^ /, "");
          const matched = !!firstMatch(re, body);
          const ok = matched === (sign === "+");
          table.push([index + 1, sign === "+" ? "match" : "no match", yesNo(matched), ok ? "ok" : sign === "+" ? "missed" : "false match", body]);
        });
        need(table.length > 0, "Examples: give at least one line starting with + or -.");
        return { rows: [["Examples", table.length], ["Correct", table.filter((row) => row[3] === "ok").length], ["Should match but did not", table.filter((row) => row[3] === "missed").length],
          ["Matched but should not", table.filter((row) => row[3] === "false match").length]], table: { columns: ["line", "expected", "matched", "result", "text"], rows: table } };
      } },
    { id: "split_fields", kind: "tool", group: GROUP, title: "Split lines into fields by a pattern",
      help: `Splits each line wherever the separator pattern matches (for example \\s*[,;|]\\s*), giving a table with one column per field. Empty matches never split, and a separator that matches empty text is refused. ${LIST_LIMITS.replace("lists", "splits")}`,
      inputs: [PATTERN("pattern", "Separator pattern"), FLAGS, TEXT(), CHECK("keepEmpty", "Keep empty fields", true)],
      compute: ({ pattern, flags, text, keepEmpty }) => {
        checkText(text);
        const re = compile(pattern, flags, "Separator pattern");
        need(!firstMatch(re, ""), "Separator pattern matches empty text; it must match at least one character.");
        const split = lines(text).map((line) => {
          const fields = [];
          let from = 0;
          for (const match of matchesIn(re, line).list) {
            if (match[0] === "") continue;
            fields.push(line.slice(from, match.index));
            from = match.index + match[0].length;
          }
          fields.push(line.slice(from));
          return keepEmpty ? fields : fields.filter((field) => field !== "");
        });
        const widest = Math.max(0, ...split.map((fields) => fields.length));
        return { rows: [["Lines", split.length], ["Most fields on a line", widest], ["Fewest fields on a line", split.length ? Math.min(...split.map((fields) => fields.length)) : null]],
          table: { columns: ["line", ...Array.from({ length: widest }, (_, k) => `field ${k + 1}`)], rows: split.map((fields, index) => [index + 1, ...fields, ...Array(widest - fields.length).fill("")]) } };
      } },
    { id: "explain_pattern", kind: "tool", group: GROUP, title: "Explain a pattern piece by piece",
      help: "Breaks a pattern into its pieces in order, each with what it matches in plain words; the level column shows nesting inside groups. Also counts capture groups, names the named ones and says whether the pattern can match empty text.",
      inputs: [PATTERN(), FLAGS],
      compute: ({ pattern, flags }) => {
        const f = readFlags(flags);
        need(pattern.length <= MAX_PATTERN, `Pattern is longer than ${MAX_PATTERN.toLocaleString("en-US")} characters.`);
        let re;
        try { re = new RegExp(pattern, f); } catch (error) { throw new Error(`Pattern is not a valid regular expression: ${error.message}`); }
        const groups = captureGroups(pattern);
        const pieces = [];
        explainBranches(parsePattern(pattern).branches, 0, f, pieces);
        const named = groups.filter((group) => group.name).map((group) => group.name);
        return { rows: [["Capture groups", groups.length], ["Named groups", named.length ? named.join(", ") : "none"], ["Matches empty text", yesNo(re.test(""))], ["Pieces", pieces.length]],
          table: { columns: ["level", "piece", "meaning"], rows: pieces } };
      } },
    { id: "shape_pattern", kind: "tool", group: GROUP, title: "Pattern from example values",
      help: "Builds an anchored pattern from examples of one kind of value, such as order numbers HC-1042 and HC-20931 giving ^HC-\\d{4,5}$: each run of digits becomes \\d, each run of letters stays literal when every example agrees or becomes [A-Z], [a-z] or [A-Za-z], with the range of lengths seen. Every example must have the same shape (the same order of digit runs, letter runs and other characters). At most 1,000 examples.",
      inputs: [{ name: "examples", label: "Examples (one per line)", type: "textarea", required: true, rows: 5 }],
      compute: ({ examples }) => {
        const list = lines(examples).map((line) => line.trim()).filter(Boolean);
        need(list.length > 0, "Examples: give at least one value.");
        need(list.length <= 1000, "Examples: give at most 1,000 values.");
        const shapes = list.map(runsOf);
        const kinds = (runs) => runs.map((run) => run.kind).join(" ");
        const odd = shapes.findIndex((runs) => kinds(runs) !== kinds(shapes[0]));
        need(odd < 0, `Example ${odd + 1} (${list[odd]}) has a different shape from example 1 (${list[0]}): digit runs, letter runs and other characters come in a different order.`);
        const body = shapes[0].map((run, k) => {
          const texts = shapes.map((runs) => runs[k].text);
          if (texts.every((text) => text === texts[0])) return escapeRegExp(texts[0]);
          if (run.kind === "other") return `[${[...new Set(texts)].sort().map((char) => classChar(char.codePointAt(0))).join("")}]`;
          const quant = lengthQuant(texts.map((text) => text.length));
          if (run.kind === "digit") return `\\d${quant}`;
          const joined = texts.join("");
          return `${/^[A-Z]+$/.test(joined) ? "[A-Z]" : /^[a-z]+$/.test(joined) ? "[a-z]" : "[A-Za-z]"}${quant}`;
        }).join("");
        const pattern = `^${body}$`;
        return { rows: [["Examples", list.length], ["Pieces", shapes[0].length]], text: pattern };
      } },
    { id: "char_class", kind: "tool", group: GROUP, title: "Character class of the characters used",
      help: "The smallest [...] class listing every distinct character in the text, with runs of three or more consecutive characters written as ranges (a-e) and special characters escaped. Line breaks can be left out. Characters outside the Basic Multilingual Plane, such as emoji, need the u flag.",
      inputs: [TEXT("text", "Text"), CHECK("skipBreaks", "Leave out line breaks", true)],
      compute: ({ text, skipBreaks }) => {
        checkText(text);
        const codes = [...new Set(Array.from(text, (char) => char.codePointAt(0)))].filter((code) => !(skipBreaks && (code === 10 || code === 13))).sort((a, b) => a - b);
        need(codes.length > 0, "Text: give at least one character besides line breaks.");
        const parts = [];
        for (let k = 0; k < codes.length;) {
          let end = k;
          while (end + 1 < codes.length && codes[end + 1] === codes[end] + 1) end++;
          if (end - k >= 2) parts.push(`${classChar(codes[k])}-${classChar(codes[end])}`);
          else for (let j = k; j <= end; j++) parts.push(classChar(codes[j]));
          k = end + 1;
        }
        return { rows: [["Distinct characters", codes.length], ["Needs the u flag", yesNo(codes.some((code) => code > 0xFFFF))]], text: `[${parts.join("")}]` };
      } },
    { id: "chars_outside", kind: "tool", group: GROUP, title: "Characters outside an allowed set",
      help: `Checks every character of every line against an allowed set written as a pattern for one character, such as [A-Za-z0-9 .,'-], and lists the characters that are not allowed with their code point, count and first line. Line breaks are not checked. ${LIMITS}`,
      inputs: [{ name: "allowed", label: "Allowed character (pattern)", type: "text", required: true, placeholder: "[A-Za-z0-9 .,'-]" }, FLAGS, TEXT()],
      compute: ({ allowed, flags, text }) => {
        checkText(text);
        compile(allowed, flags, "Allowed character");
        const re = compile(`^(?:${allowed})$`, flags, "Allowed character");
        const found = new Map();
        let checked = 0;
        const badLines = new Set();
        lines(text).forEach((line, index) => {
          for (const char of line) {
            checked++;
            if (firstMatch(re, char)) continue;
            badLines.add(index + 1);
            const entry = found.get(char);
            if (entry) entry.times++; else found.set(char, { times: 1, line: index + 1 });
          }
        });
        const show = (char) => (/[\p{Cc}\p{Cf}\p{Z}]/u.test(char) ? "(not visible)" : char);
        const code = (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
        return { rows: [["Characters checked", checked], ["Distinct characters not allowed", found.size], ["Lines with one", badLines.size]],
          table: { columns: ["character", "code point", "times", "first line"], rows: [...found].map(([char, entry]) => [show(char), code(char), entry.times, entry.line]) } };
      } },
    { id: "mask_matches", kind: "tool", group: GROUP, title: "Mask every match",
      help: `Replaces each character of every match with a mask character, optionally keeping the last few characters (HC-1042 with 2 kept is *****42), for sharing sample text without identifiers. Every match is masked; empty matches are skipped. ${LIMITS}`,
      inputs: [PATTERN(), FLAGS, TEXT("text", "Text"), { name: "mask", label: "Mask character", type: "text", default: "*" }, { name: "keep", label: "Characters to keep at the end", type: "integer", min: 0, default: 0 }],
      compute: ({ pattern, flags, text, mask, keep }) => {
        checkText(text);
        need(Array.from(mask).length === 1, "Mask character: give exactly one character.");
        const re = compile(pattern, flags);
        let out = "", from = 0, masked = 0, hidden = 0;
        for (const match of matchesIn(re, text, Infinity).list) {
          if (match[0] === "") continue;
          const chars = Array.from(match[0]);
          const cover = Math.max(0, chars.length - keep);
          out += text.slice(from, match.index) + mask.repeat(cover) + chars.slice(cover).join("");
          from = match.index + match[0].length;
          masked++;
          hidden += cover;
        }
        return { rows: [["Matches masked", masked], ["Characters masked", hidden]], text: out + text.slice(from) };
      } },
    { id: "number_range", kind: "tool", group: GROUP, title: "Pattern for a whole-number range",
      help: "A pattern that matches exactly the whole numbers from the lowest to the highest (written without leading zeros), such as 1 to 31 for days of a month, optionally only when the number is not part of a longer number. Up to 999,999,999.",
      inputs: [{ name: "low", label: "Lowest", type: "integer", min: 0, max: 999999999 }, { name: "high", label: "Highest", type: "integer", min: 0, max: 999999999 },
        CHECK("standalone", "Not part of a longer number", true)],
      compute: ({ low, high, standalone }) => {
        need(low <= high, "Lowest must not be above highest.");
        const parts = numberRange(low, high);
        const body = parts.length === 1 ? parts[0] : `(?:${parts.join("|")})`;
        return { rows: [["Alternatives", parts.length]], text: standalone ? `(?<!\\d)${body}(?!\\d)` : `^${body}$` };
      } },
    { id: "convert_python_js", kind: "tool", group: GROUP, title: "Convert a pattern between Python and JavaScript",
      help: "Rewrites the syntax that differs between Python's re and JavaScript: named groups (?P<name>) and (?<name>), back-references (?P=name) and \\k<name>, the \\A and \\Z anchors (as lookarounds when the m flag is on), JavaScript's $ (Python's $ also matches before a last line break, so it becomes \\Z), \\u{...} and \\U escapes, a class opening with ], and leading inline flags such as (?i). Comments (?#...) are dropped. Atomic groups, \\N{...} names, \\p{...} classes and verbose mode have no counterpart and are refused; a note names the differences that remain, such as \\d matching other scripts in Python.",
      inputs: [PATTERN(), { name: "direction", label: "Direction", type: "select", options: [["py_to_js", "Python to JavaScript"], ["js_to_py", "JavaScript to Python"]], default: "py_to_js" },
        { name: "flags", label: "JavaScript flags (i, m, s, u)", type: "text", placeholder: "none" }],
      compute: ({ pattern, direction, flags }) => {
        need(pattern.length <= MAX_PATTERN, `Pattern is longer than ${MAX_PATTERN.toLocaleString("en-US")} characters.`);
        const changes = [];
        const note = (from, to) => { changes.push([from, to]); return to; };
        const notes = [];
        if (direction === "py_to_js") {
          let source = pattern, jsFlags = readFlags(flags);
          const lead = /^\(\?([a-zA-Z]+)\)/.exec(source);
          if (lead) {
            need(/^[aimsu]+$/.test(lead[1]), `Inline flags (?${lead[1]}) have no JavaScript counterpart (only a, i, m, s and u do; x is verbose mode).`);
            for (const flag of lead[1].replaceAll("a", "")) if (!jsFlags.includes(flag)) jsFlags += flag;
            note(lead[0], lead[1].includes("a") ? `flags ${lead[1].replaceAll("a", "") || "none"} (JavaScript's \\d, \\w and \\b are ASCII already)` : `flags ${lead[1]}`);
            source = source.slice(lead[0].length);
          }
          const multi = jsFlags.includes("m");
          let wide = false;
          const out = rewrite(source, (token, inClass) => {
            if (/^\\U/.test(token)) { wide = true; return note(token, `\\u{${token.slice(2).replace(/^0+(?=.)/, "")}}`); }
            need(!/^\\N\{/.test(token), `Named characters such as ${token} have no JavaScript counterpart; write the character itself.`);
            if (/^\[\^?\]$/.test(token)) return note(token, `${token.slice(0, -1)}\\]`);
            if (inClass) return undefined;
            if (token.startsWith("(?P<")) return note(token, `(?<${token.slice(4)}`);
            if (token.startsWith("(?P=")) return note(token, `\\k<${token.slice(4, -1)}>`);
            if (token.startsWith("(?#")) return note(token, "");
            need(token !== "(?>", "Atomic groups (?>...) have no JavaScript counterpart.");
            need(!/^\(\?[a-zA-Z]+\)$/.test(token), `Inline flags ${token} in the middle of a pattern have no JavaScript counterpart; move them to the start.`);
            if (token === "\\A") return note(token, multi ? "(?<![\\s\\S])" : "^");
            if (token === "\\Z") return note(token, multi ? "(?![\\s\\S])" : "$");
            if (token === "$" && !multi) notes.push("Python's $ also matches before a final line break; JavaScript's $ only at the very end.");
            return undefined;
          }, "py");
          if (wide && !jsFlags.includes("u")) jsFlags += "u";
          const final = jsFlags.split("").sort().join("");
          try { new RegExp(out, final); } catch (error) { throw new Error(`The converted pattern is not valid JavaScript: ${error.message}`); }
          if (!lead?.[1].includes("a") && /\\[dDwWbB]/.test(source)) notes.push("Python's \\d, \\w and \\b also match other scripts; JavaScript's match ASCII only.");
          return { rows: [["Pattern", out], ["Flags", final || "none"], ["Changes", changes.length], ["Note", notes.length ? [...new Set(notes)].join(" ") : "none"]],
            table: { columns: ["from", "to"], rows: changes } };
        }
        const jsFlags = readFlags(flags);
        try { new RegExp(pattern, jsFlags); } catch (error) { throw new Error(`Pattern is not valid JavaScript: ${error.message}`); }
        const out = rewrite(pattern, (token, inClass, at) => {
          need(!/^\\[pP]\{/.test(token), `Python's re has no ${token} property class.`);
          if (/^\\u\{/.test(token)) return note(token, `\\U${token.slice(3, -1).padStart(8, "0")}`);
          if (/^\\c[A-Za-z]$/.test(token)) return note(token, `\\x${(token.charCodeAt(2) % 32).toString(16).padStart(2, "0")}`);
          if (token === "[]") return note(token, "(?!)");
          if (token === "[^]") return note(token, "[\\s\\S]");
          if (inClass) return undefined;
          if (/^\(\?<[^>=!]/.test(token)) {
            need(/^\(\?<[A-Za-z_][A-Za-z0-9_]*>$/.test(token), `Group name in ${token} is not a valid Python name.`);
            return note(token, `(?P<${token.slice(3)}`);
          }
          if (token.startsWith("\\k<")) return note(token, `(?P=${token.slice(3, -1)})`);
          if (token === "$" && !jsFlags.includes("m")) return note(token, "\\Z");
          if (token === "(" && /^\(\?<[=!]/.test(pattern.slice(at))) notes.push("Python's lookbehinds must match a fixed length.");
          return undefined;
        }, "js");
        const names = { i: "re.IGNORECASE", m: "re.MULTILINE", s: "re.DOTALL" };
        const pyFlags = jsFlags.split("").filter((flag) => names[flag]).map((flag) => names[flag]);
        if (/\\[dDwWbB]/.test(pattern)) notes.push("Python's \\d, \\w and \\b also match other scripts; add re.ASCII to keep JavaScript's meaning.");
        return { rows: [["Pattern", out], ["Flags", pyFlags.length ? pyFlags.join(" | ") : "none"], ["Changes", changes.length],
          ["Note", notes.length ? [...new Set(notes)].join(" ") : "none"]],
        table: { columns: ["from", "to"], rows: changes } };
      } },
  ],
});
