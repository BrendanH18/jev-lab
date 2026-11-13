// Previewed edits and paste importers for the Build editor's questions (surface workbench.build.questions, contract in
// static/js/lab/surfaces/workbench-build.js). Every edit is a pure preview -> Apply -> Undo through the surface's
// replaceItems, which keeps ids and Choice keys unique, moves human expectations with their question and refuses while
// Raw JSON has unapplied edits. Edits move, rename, trim or reshape what the user wrote and ship no wording of their
// own: any new text comes from a value the user types. Importers read pasted questions only and add them after the
// last card; state, expectations, pictures and answers in a paste are left out.
import { compareText, definePack } from "../../kit.js";
import { duplicateKeys, isPlainObject } from "../../lib/json.js";
import { parseDelimited, sniffDelimiter } from "../../lib/tables.js";
import { escapeRegExp, normalizeDashes, normalizeQuotes, normalizeUnicode, stripControlCharacters, toCamelCase, toKebabCase, toSnakeCase,
  trimLineEnds, uniqueName, words } from "../../lib/text.js";

const TYPES = ["noul", "choice", "score", "box"];
const str = (value) => (typeof value === "string" ? value : "");
const trimmedId = (item) => str(item.id).trim();
const hasOwn = (object, key) => !!object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function parsesAsStructure(text) {
  const trimmed = str(text).trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try { const value = JSON.parse(trimmed); return !!value && typeof value === "object"; } catch { return false; }
}

// The named Choice keys of a stored item, trimmed.
const keysOf = (item) => (Array.isArray(item.choice) ? item.choice.map(([key]) => str(key).trim()).filter(Boolean) : []);
const nameOf = (item, index) => trimmedId(item) || `question ${index + 1}`;

// Every id that holds a human expectation: the editor's expectations plus the items' own.
function expectationIds(items, ctx) {
  const ids = new Set(Object.keys(ctx?.data?.expect || {}));
  for (const item of items) if (item.expectation && trimmedId(item)) ids.add(trimmedId(item));
  return ids;
}

// The checks replaceItems applies, run before the preview so it can explain a refusal: unique ids and Choice keys, and
// no expectation lost or taken over by a rename. before[i] is the item next[i] came from (null for a new card).
function checkList(next, items, ctx, before = next.map((_, index) => items[index] ?? null)) {
  const seen = new Set();
  next.forEach((item, index) => {
    const qid = trimmedId(item);
    if (qid) {
      if (seen.has(qid)) throw new Error(`Two questions would have the id “${qid}”. Rename one first.`);
      seen.add(qid);
    }
    const keys = keysOf(item);
    const repeat = keys.find((key, at) => keys.indexOf(key) !== at);
    if (item.type === "choice" && repeat !== undefined) throw new Error(`${nameOf(item, index)} would have the option “${repeat}” twice.`);
  });
  const owned = expectationIds(items, ctx);
  next.forEach((item, index) => {
    const from = before[index];
    const was = from ? trimmedId(from) : null;
    const now = trimmedId(item);
    if (was === now) return;
    if (from && from.expectation && !now) throw new Error(`Question “${was}” has human expectations, so it needs an id.`);
    if (now && owned.has(now)) throw new Error(`Expectations already exist for “${now}”, so another question cannot take that id.`);
  });
  // A Choice expectation must keep naming an offered option: an edit that renames or drops that key is refused.
  next.forEach((item, index) => {
    const from = before[index];
    const expected = from && item.type === "choice" && typeof from.expectation?.choice === "string" ? from.expectation.choice : null;
    if (expected !== null && keysOf(from).includes(expected) && !keysOf(item).includes(expected)) {
      throw new Error(`${nameOf(item, index)} expects “${expected}”; this edit would change that option's key and leave its expectation pointing at nothing. Change the expectation first.`);
    }
  });
  return next;
}

// An `all` edit that changes shown items one at a time: change(item, params, ctx, index) returns the next item or null.
const shownEdit = (change) => (items, params, ctx, shown) => checkList(items.map((item, index) => (shown.has(index) ? change(item, params, ctx, index) ?? item : item)), items, ctx);

// The type's own criterion texts (Choice descriptions, Score levels, Noul yes/no) changed by fn(text, item, index).
function mapCriteria(item, fn) {
  if (item.type === "choice" && Array.isArray(item.choice)) return { ...item, choice: item.choice.map(([key, text]) => [key, fn(text)]) };
  if (item.type === "score" && Array.isArray(item.score)) return { ...item, score: item.score.map((level) => fn(level)) };
  if (item.type === "noul") return { ...item, noulYes: fn(str(item.noulYes)), noulNo: fn(str(item.noulNo)) };
  return item;
}
const changed = (item, next) => (JSON.stringify(item) === JSON.stringify(next) ? null : next);

// Text that was structure must still be structure after an edit (a broken JSON text would be sent as plain text).
function keepStructure(before, after, where) {
  if (parsesAsStructure(before) && !parsesAsStructure(after)) throw new Error(`${where}: the edit would break its JSON, so it would be sent as plain text. Change the find text.`);
  return after;
}

function literalReplacer(find, replace, matchCase) {
  if (find === "") throw new Error("Find is required.");
  const pattern = new RegExp(escapeRegExp(find), matchCase ? "g" : "gi");
  return (text) => str(text).replace(pattern, () => replace);
}

function patternOf(source, flags) {
  if (source === "") throw new Error("Pattern is required.");
  try { return new RegExp(source, flags); } catch (error) { throw new Error(`The pattern is not a valid regular expression: ${error.message}`); }
}

function renameIds(rename) {
  return shownEdit((item, params, ctx, index) => {
    const qid = trimmedId(item);
    if (!qid) return null;
    const id = rename(qid, params);
    if (id === null || id === qid) return null;
    if (!id.trim()) throw new Error(`The edit would leave ${nameOf(item, index)} without an id.`);
    return { ...item, id: id.trim() };
  });
}

// Choice keys renamed by rename(key): unique per question, and a Choice expectation's key may not be renamed away.
function renameKeys(rename) {
  return shownEdit((item, params, ctx, index) => {
    if (item.type !== "choice" || !Array.isArray(item.choice)) return null;
    const choice = item.choice.map(([key, text]) => {
      if (!str(key).trim()) return [key, text];
      const next = rename(str(key).trim(), params);
      if (!next.trim()) throw new Error(`${nameOf(item, index)}: the edit would leave option “${str(key).trim()}” without a key.`);
      return [next === str(key).trim() ? key : next.trim(), text];
    });
    const expected = item.expectation && typeof item.expectation.choice === "string" ? item.expectation.choice : null;
    if (expected !== null && keysOf(item).includes(expected) && !keysOf({ choice }).includes(expected)) {
      throw new Error(`${nameOf(item, index)} expects “${expected}”; renaming that option would leave its expectation pointing at nothing. Change the expectation first.`);
    }
    return changed(item, { ...item, choice });
  });
}

// Puts the shown items, reordered by order(shownItems), back into the shown positions; hidden cards keep their places.
function reorderShown(order) {
  return (items, params, ctx, shown) => {
    const positions = items.map((_, index) => index).filter((index) => shown.has(index));
    const picked = order(positions.map((index) => items[index]), params);
    const next = items.slice();
    positions.forEach((position, at) => { next[position] = picked[at]; });
    return next;
  };
}

const QUOTED = /“[^”]*”|‘[^’]*’|"[^"]*"|(?<!\w)'[^'\n]*'(?!\w)|`[^`]*`/g;

// Splits text at each question mark outside quoted and backticked spans; text after the last one joins the last piece.
function splitQuestions(text) {
  const masked = text.replace(QUOTED, (span) => " ".repeat(span.length));
  const ends = [];
  for (let at = masked.indexOf("?"); at !== -1; at = masked.indexOf("?", at + 1)) ends.push(at + 1);
  if (ends.length < 2) return null;
  const pieces = [];
  let start = 0;
  ends.forEach((end) => { pieces.push(text.slice(start, end)); start = end; });
  if (text.slice(start).trim()) pieces[pieces.length - 1] += text.slice(start);
  const out = pieces.map((piece) => piece.trim()).filter(Boolean);
  return out.length >= 2 ? out : null;
}

// The active criteria of a stored item, for telling exact duplicates apart.
function activeCriteria(item) {
  if (item.type === "choice") return (item.choice || []).filter(([key]) => str(key).trim()).map(([key, text]) => [str(key).trim(), str(text).trim()]);
  if (item.type === "score") return (item.score || []).map((level) => str(level).trim()).filter(Boolean);
  if (item.type === "noul") return [str(item.noulYes).trim(), str(item.noulNo).trim()];
  return [];
}

// ---------- importers: every importer returns full editor rows ----------

const BLANK_CHOICE = () => [["", ""], ["", ""]];
const BLANK_SCORE = () => ["", "", ""];
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value));

function editorRow(id, type, instructions, { choice = null, score = null, yes = "", no = "" } = {}) {
  return { id, type, instructions, choice: type === "choice" && choice ? choice : BLANK_CHOICE(), score: type === "score" && score ? score : BLANK_SCORE(),
    noulYes: type === "noul" ? yes : "", noulNo: type === "noul" ? no : "" };
}

function typeOf(value, where) {
  const type = str(value).trim().toLowerCase();
  if (!TYPES.includes(type)) throw new Error(`${where}: the type must be noul, choice, score or box.`);
  return type;
}

// One question in the API's shape ({ type, instructions, criteria }) as an editor row.
function rowFromApi(id, question, where) {
  if (!isPlainObject(question)) throw new Error(`${where} is not a question object.`);
  const type = typeOf(question.type, where);
  const criteria = question.criteria;
  if (type === "choice" && criteria !== undefined && criteria !== null && !isPlainObject(criteria)) throw new Error(`${where}: Choice criteria must be an object of option keys.`);
  if (type === "score" && criteria !== undefined && criteria !== null && !Array.isArray(criteria)) throw new Error(`${where}: Score criteria must be a list of levels.`);
  return editorRow(id, type, asText(question.instructions), {
    choice: type === "choice" && criteria ? Object.entries(criteria).map(([key, text]) => [key, asText(text)]) : null,
    score: type === "score" && criteria ? criteria.map(asText) : null,
    yes: type === "noul" && isPlainObject(criteria) ? asText(criteria.true) : "", no: type === "noul" && isPlainObject(criteria) ? asText(criteria.false) : "",
  });
}

// One criterion line for a typed question: "key: description" (Choice), a level (Score), "yes: …" / "no: …" (Noul).
function addCriterion(parts, type, line, where) {
  const text = line.trim();
  if (!text) return;
  if (type === "box") throw new Error(`${where}: a Box question takes no criteria.`);
  if (type === "score") { parts.score.push(text.replace(/^\d+\s*[:.)]\s+/, "")); return; }
  const colon = text.indexOf(":");
  const head = (colon < 0 ? text : text.slice(0, colon)).trim().replace(/^`(.*)`$/, "$1");
  const rest = colon < 0 ? "" : text.slice(colon + 1).trim();
  if (type === "choice") { parts.choice.push([head, rest]); return; }
  const side = head.toLowerCase();
  if (side === "yes" || side === "true") parts.yes = rest;
  else if (side === "no" || side === "false") parts.no = rest;
  else throw new Error(`${where}: a Noul criterion starts with yes: or no:.`);
}

const fromParts = (id, type, instructions, parts) => editorRow(id, type, instructions,
  { choice: parts.choice.length ? parts.choice : null, score: parts.score.length ? parts.score : null, yes: parts.yes, no: parts.no });
const emptyParts = () => ({ choice: [], score: [], yes: "", no: "" });

// Warnings and checks shared by importers: ids present and not repeated in the paste; ids the editor already uses.
function finishImport(rows, ctx, warnings = []) {
  if (!rows.length) throw new Error("No questions were found in the pasted text.");
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const qid = row.id.trim();
    if (!qid) throw new Error(`Question ${index + 1} needs an id.`);
    if (seen.has(qid)) throw new Error(`The paste has the id “${qid}” twice.`);
    seen.add(qid);
  }
  const used = new Set((ctx?.items?.() || []).map(trimmedId).filter(Boolean));
  for (const row of rows) if (used.has(row.id.trim())) warnings.push(`“${row.id.trim()}” is already in the editor; rename one before adding.`);
  return { items: rows, warnings };
}

function parseJson(text, what) {
  const repeats = duplicateKeys(text);
  if (repeats === null) throw new Error(`Paste ${what}.`);
  if (repeats.length) throw new Error(`The JSON repeats ${repeats[0]}. Keep each key unique.`);
  return JSON.parse(text);
}

function questionsFromMap(map, ctx, warnings) {
  if (!isPlainObject(map) || !Object.keys(map).length) throw new Error("The paste has no questions object keyed by id.");
  return finishImport(Object.entries(map).map(([id, question]) => rowFromApi(id, question, `Question “${id}”`)), ctx, warnings);
}

const LEFT_OUT = [["state", "the state"], ["expect", "the expectations"], ["images", "the pictures"], ["assets", "the pictures"], ["model", "the model"]];
function leftOut(value) {
  const names = [...new Set(LEFT_OUT.filter(([key]) => hasOwn(value, key)).map(([, name]) => name))];
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return names.length ? [`Only the questions are added; ${list} ${names.length === 1 ? "was" : "were"} left out.`] : [];
}

export default definePack({
  id: "build-question-edits",
  surface: "workbench.build.questions",
  title: "Question edits and imports",
  about: "Previewed bulk renames, find and replace, normalization, conversions, reorders, splits and merges of the Build editor's shown questions, and importers that add questions pasted as CSV, Markdown, JSON Lines, a request or a curl snippet. Edits change only what the user wrote (new text comes only from values the user types); imports read questions only.",
  features: [
    // ---------- ids ----------
    { id: "remove_id_prefix", kind: "transform", label: "Remove a prefix from shown ids",
      params: [{ name: "prefix", label: "Prefix", type: "text", required: true, placeholder: "support_" }],
      help: "Ids that do not start with the prefix, or are only the prefix, stay as they are. Human expectations move with their question.",
      all: renameIds((qid, { prefix }) => (qid.startsWith(prefix) && qid.length > prefix.length ? qid.slice(prefix.length) : null)) },
    { id: "add_id_suffix", kind: "transform", label: "Add a suffix to shown ids",
      params: [{ name: "suffix", label: "Suffix", type: "text", required: true, placeholder: "_v2" }],
      help: "Ids that already end with the suffix stay as they are. Human expectations move with their question.",
      all: (items, params, ctx, shown) => {
        if (/\s/.test(params.suffix)) throw new Error("The suffix cannot contain spaces.");
        return renameIds((qid, { suffix }) => (qid.endsWith(suffix) ? null : `${qid}${suffix}`))(items, params, ctx, shown);
      } },
    { id: "remove_id_suffix", kind: "transform", label: "Remove a suffix from shown ids",
      params: [{ name: "suffix", label: "Suffix", type: "text", required: true, placeholder: "_v2" }],
      help: "Ids that do not end with the suffix, or are only the suffix, stay as they are. Human expectations move with their question.",
      all: renameIds((qid, { suffix }) => (qid.endsWith(suffix) && qid.length > suffix.length ? qid.slice(0, -suffix.length) : null)) },
    { id: "replace_in_ids", kind: "transform", label: "Find and replace in shown ids",
      params: [{ name: "find", label: "Find", type: "text", required: true }, { name: "replace", label: "Replace with", type: "text" }],
      help: "Literal and case-sensitive; every occurrence is replaced and the result is trimmed. Human expectations move with their question.",
      all: (items, params, ctx, shown) => {
        const swap = literalReplacer(params.find, params.replace, true);
        return renameIds((qid) => swap(qid))(items, params, ctx, shown);
      } },
    { id: "pattern_rename_ids", kind: "transform", label: "Rename shown ids with a pattern",
      params: [{ name: "pattern", label: "Pattern (regular expression)", type: "text", required: true, placeholder: "^(\\w+)_check$" },
        { name: "replacement", label: "Replacement ($1 for a group)", type: "text", placeholder: "$1" }],
      help: "Every match in each shown id is replaced, with $1, $2 … for the pattern's groups. An invalid pattern changes nothing. Human expectations move with their question.",
      all: (items, params, ctx, shown) => {
        const pattern = patternOf(params.pattern, "g");
        return renameIds((qid) => qid.replace(pattern, params.replacement))(items, params, ctx, shown);
      } },
    { id: "id_naming_style", kind: "transform", label: "Convert shown ids to a naming style",
      params: [{ name: "style", label: "Style", type: "select", options: [["kebab", "kebab-case"], ["camel", "camelCase"], ["lower", "lower case"]] }],
      help: "kebab-case (order-status), camelCase (orderStatus) or lower case. snake_case has its own edit. Human expectations move with their question.",
      all: (items, params, ctx, shown) => renameIds((qid, { style }) => {
        const next = style === "kebab" ? toKebabCase(qid) : style === "camel" ? toCamelCase(qid) : qid.toLowerCase();
        return next || null;
      })(items, params, ctx, shown) },
    { id: "fill_blank_ids", kind: "transform", label: "Name shown cards without an id from their first words",
      help: "A shown card with no id gets the first four words of its text instructions in snake_case (made unique with _2, _3 …), so Run sends it. Cards with structured or empty instructions stay as they are.",
      all: (items, params, ctx, shown) => {
        const taken = new Set([...items.map(trimmedId).filter(Boolean), ...expectationIds(items, ctx)]);
        return checkList(items.map((item, index) => {
          if (!shown.has(index) || trimmedId(item) || parsesAsStructure(item.instructions)) return item;
          const base = toSnakeCase(words(item.instructions).slice(0, 4).join(" "));
          if (!base) return item;
          const id = uniqueName(base, taken);
          taken.add(id);
          return { ...item, id };
        }), items, ctx);
      } },

    // ---------- find and replace in wording ----------
    { id: "replace_in_instructions", kind: "transform", label: "Find and replace in shown instructions",
      params: [{ name: "find", label: "Find", type: "text", required: true }, { name: "replace", label: "Replace with", type: "text" },
        { name: "matchCase", label: "Match case", type: "checkbox", default: true }],
      help: "Literal text, every occurrence. Structured (JSON) instructions must still parse afterwards, or nothing changes.",
      all: (items, params, ctx, shown) => {
        const swap = literalReplacer(params.find, params.replace, params.matchCase);
        return shownEdit((item, _, __, index) => changed(item, { ...item, instructions: keepStructure(item.instructions, swap(item.instructions), nameOf(item, index)) }))(items, params, ctx, shown);
      } },
    { id: "pattern_replace_instructions", kind: "transform", label: "Replace a pattern in shown instructions",
      params: [{ name: "pattern", label: "Pattern (regular expression)", type: "text", required: true }, { name: "replacement", label: "Replacement ($1 for a group)", type: "text" },
        { name: "ignoreCase", label: "Ignore case", type: "checkbox" }],
      help: "Every match is replaced, with $1, $2 … for groups. An invalid pattern, or one that would break structured (JSON) instructions, changes nothing.",
      all: (items, params, ctx, shown) => {
        const pattern = patternOf(params.pattern, params.ignoreCase ? "gi" : "g");
        return shownEdit((item, _, __, index) => changed(item, { ...item,
          instructions: keepStructure(item.instructions, str(item.instructions).replace(pattern, params.replacement), nameOf(item, index)) }))(items, params, ctx, shown);
      } },
    { id: "replace_in_criteria", kind: "transform", label: "Find and replace in shown criteria",
      params: [{ name: "find", label: "Find", type: "text", required: true }, { name: "replace", label: "Replace with", type: "text" },
        { name: "matchCase", label: "Match case", type: "checkbox", default: true }],
      help: "Literal text in the criteria of each question's own type: Choice descriptions, Score levels, Noul yes/no. Keys and instructions stay as they are; structured descriptions must still parse.",
      all: (items, params, ctx, shown) => {
        const swap = literalReplacer(params.find, params.replace, params.matchCase);
        return shownEdit((item, _, __, index) => changed(item, mapCriteria(item, (text) => keepStructure(text, swap(text), nameOf(item, index)))))(items, params, ctx, shown);
      } },
    { id: "replace_in_keys", kind: "transform", label: "Find and replace in shown Choice keys",
      params: [{ name: "find", label: "Find", type: "text", required: true }, { name: "replace", label: "Replace with", type: "text" }],
      help: "Literal and case-sensitive; descriptions stay with their keys. Refused when keys would repeat or a Choice expectation's key would be renamed away.",
      all: (items, params, ctx, shown) => {
        const swap = literalReplacer(params.find, params.replace, true);
        return renameKeys((key) => swap(key))(items, params, ctx, shown);
      } },
    { id: "rename_path", kind: "transform", label: "Rename a backticked state path in shown questions",
      params: [{ name: "from", label: "Path now", type: "text", required: true, placeholder: "ticket.from" },
        { name: "to", label: "New path", type: "text", required: true, placeholder: "email.sender" }],
      help: "Changes `from` to `to` only where the whole backticked span is that path, in instructions and criteria; the same words outside backticks stay as they are. The state itself is not changed.",
      all: (items, params, ctx, shown) => {
        const from = params.from.trim(), to = params.to.trim();
        if (!to || /[`"\\\s]/.test(to)) throw new Error("The new path cannot be blank or contain spaces, quotes, backslashes or backticks.");
        const swap = (text) => str(text).replace(/`([^`\n]+)`/g, (span, inner) => (inner.trim() === from ? `\`${to}\`` : span));
        return shownEdit((item) => changed(item, mapCriteria({ ...item, instructions: swap(item.instructions) }, swap)))(items, params, ctx, shown);
      } },
    { id: "add_instruction_text", kind: "transform", label: "Add your text before or after shown instructions",
      params: [{ name: "text", label: "Text to add", type: "textarea", required: true }, { name: "where", label: "Where", type: "select", options: [["after", "after"], ["before", "before"]] }],
      help: "Adds exactly the text you type, with one space between it and the instructions. Structured (JSON) and empty instructions stay as they are.",
      all: (items, params, ctx, shown) => shownEdit((item) => {
        const text = str(item.instructions);
        if (!text.trim() || parsesAsStructure(text)) return null;
        const add = params.text.trim();
        return { ...item, instructions: params.where === "before" ? `${add} ${text.replace(/^\s+/, "")}` : `${text.replace(/\s+$/, "")} ${add}` };
      })(items, params, ctx, shown) },

    // ---------- normalization ----------
    { id: "straighten_punctuation", kind: "transform", label: "Straighten quotes and dashes in shown questions",
      help: "Curly quotes become straight ones and Unicode dashes become -, in instructions and criteria. Structured (JSON) text keeps its curly double quotes, which straight ones would break.",
      all: shownEdit((item) => {
        const fix = (text) => {
          if (!parsesAsStructure(text)) return normalizeDashes(normalizeQuotes(text));
          const next = normalizeDashes(str(text).replace(/[‘’‚‛]/g, "'"));
          return parsesAsStructure(next) ? next : text;
        };
        return changed(item, mapCriteria({ ...item, instructions: fix(item.instructions) }, fix));
      }) },
    { id: "strip_control_characters", kind: "transform", label: "Remove control characters from shown questions",
      help: "Removes invisible control characters (not tabs or line breaks) from ids, instructions, Choice keys and criteria. Human expectations move with their question.",
      all: shownEdit((item) => changed(item, mapCriteria({ ...item, id: stripControlCharacters(item.id), instructions: stripControlCharacters(item.instructions),
        choice: Array.isArray(item.choice) ? item.choice.map(([key, text]) => [stripControlCharacters(key), text]) : item.choice }, stripControlCharacters))) },
    { id: "unicode_nfc", kind: "transform", label: "Normalize shown questions to Unicode NFC",
      help: "Letters typed as a base letter plus an accent become the single composed letter, in ids, instructions, Choice keys and criteria, so equal-looking ids and keys compare equal. Refused when two would then collide.",
      all: shownEdit((item) => {
        const nfc = (text) => normalizeUnicode(text, "NFC");
        return changed(item, mapCriteria({ ...item, id: nfc(item.id), instructions: nfc(item.instructions),
          choice: Array.isArray(item.choice) ? item.choice.map(([key, text]) => [nfc(key), text]) : item.choice }, nfc));
      }) },
    { id: "trim_line_ends", kind: "transform", label: "Remove spaces at the end of lines in shown instructions",
      help: "Trailing spaces and tabs on every line go; indentation and line breaks stay.",
      all: shownEdit((item) => changed(item, { ...item, instructions: trimLineEnds(item.instructions) })) },
    { id: "squeeze_blank_lines", kind: "transform", label: "Squeeze blank lines in shown instructions",
      help: "Two or more blank lines in a row become one blank line. Line breaks keep their style.",
      all: shownEdit((item) => changed(item, { ...item, instructions: str(item.instructions).replace(/(\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r)){2,}/g, "$1$1") })) },
    { id: "collapse_criteria_spaces", kind: "transform", label: "Collapse repeated spaces inside shown criteria",
      help: "Runs of spaces or tabs between words become one space in Choice descriptions, Score levels and Noul yes/no. Indentation, line breaks and structured (JSON) criteria stay as they are.",
      all: shownEdit((item) => changed(item, mapCriteria(item, (text) => (parsesAsStructure(text) ? text : str(text).replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 "))))) },

    // ---------- Choice options ----------
    { id: "add_catch_all", kind: "transform", label: "Add a catch-all option to shown Choice questions",
      params: [{ name: "key", label: "Option key", type: "text", required: true, placeholder: "none_of_these" }],
      help: "Adds an option with the key you type and a blank description after the last named option, to every shown Choice question that does not have it. Describe it before Run.",
      all: (items, params, ctx, shown) => {
        const key = params.key.trim();
        if (!key) throw new Error("Option key is required.");
        const limit = ctx?.data?.limits?.choiceOptions ?? 255;
        return shownEdit((item, _, __, index) => {
          if (item.type !== "choice" || !Array.isArray(item.choice) || !keysOf(item).length || keysOf(item).includes(key)) return null;
          if (keysOf(item).length >= limit) throw new Error(`${nameOf(item, index)} already has ${limit} options.`);
          const last = item.choice.reduce((at, [name], position) => (str(name).trim() ? position : at), -1);
          const choice = item.choice.slice();
          choice.splice(last + 1, 0, [key, ""]);
          return { ...item, choice };
        })(items, params, ctx, shown);
      } },
    { id: "snake_case_keys", kind: "transform", label: "Convert shown Choice keys to snake_case",
      help: "Descriptions stay with their keys. Refused when keys would repeat or a Choice expectation's key would be renamed away.",
      all: renameKeys((key) => toSnakeCase(key) || key) },
    { id: "name_unnamed_options", kind: "transform", label: "Name unnamed Choice options from their descriptions",
      help: "An option with a description but no key is not sent; it gets the first three words of its description in snake_case as its key (made unique with _2, _3 …).",
      all: shownEdit((item) => {
        if (item.type !== "choice" || !Array.isArray(item.choice)) return null;
        const taken = new Set(keysOf(item));
        return changed(item, { ...item, choice: item.choice.map(([key, text]) => {
          if (str(key).trim() || !str(text).trim()) return [key, text];
          const base = toSnakeCase(words(text).slice(0, 3).join(" "));
          if (!base) return [key, text];
          const name = uniqueName(base, taken);
          taken.add(name);
          return [name, text];
        }) });
      }) },
    { id: "sort_options_by_key", kind: "transform", label: "Sort options of shown Choice questions by key",
      help: "Named options are sorted A to Z by key within the places they hold, each keeping its description; unnamed rows stay where they are. The page's own sort does one card at a time.",
      all: shownEdit((item) => {
        if (item.type !== "choice" || !Array.isArray(item.choice)) return null;
        const places = item.choice.map((_, index) => index).filter((index) => str(item.choice[index][0]).trim());
        const sorted = places.map((index) => item.choice[index]).sort((a, b) => compareText(str(a[0]).trim(), str(b[0]).trim()));
        const choice = item.choice.slice();
        places.forEach((place, at) => { choice[place] = sorted[at]; });
        return changed(item, { ...item, choice });
      }) },
    { id: "copy_options", kind: "transform", label: "Give shown Choice questions one question's options",
      params: [{ name: "source", label: "Copy the options of (question id)", type: "text", required: true }],
      help: "Every shown Choice question gets the same option rows, keys and descriptions as the question you name. Refused when a Choice expectation's key would no longer be offered.",
      all: (items, params, ctx, shown) => {
        const source = items.find((item) => trimmedId(item) === params.source.trim());
        if (!source || source.type !== "choice" || !keysOf(source).length) throw new Error(`No Choice question with options has the id “${params.source.trim()}”.`);
        return shownEdit((item, _, __, index) => {
          if (item === source || item.type !== "choice") return null;
          const choice = source.choice.map(([key, text]) => [key, text]);
          const expected = item.expectation && typeof item.expectation.choice === "string" ? item.expectation.choice : null;
          if (expected !== null && !keysOf({ choice }).includes(expected)) throw new Error(`${nameOf(item, index)} expects “${expected}”, which the copied options do not offer.`);
          return changed(item, { ...item, choice });
        })(items, params, ctx, shown);
      } },
    { id: "remove_blank_criteria", kind: "transform", label: "Remove blank criterion rows from shown questions",
      help: "Choice rows with neither key nor description and blank Score levels go, for all shown questions at once. Blank levels are never sent, so the sent level numbers stay the same; the card's typed level numbers close up.",
      all: shownEdit((item) => {
        if (item.type === "choice" && Array.isArray(item.choice)) return changed(item, { ...item, choice: item.choice.filter(([key, text]) => str(key).trim() || str(text).trim()) });
        if (item.type === "score" && Array.isArray(item.score)) return changed(item, { ...item, score: item.score.filter((level) => str(level).trim()) });
        return null;
      }) },

    // ---------- type conversions ----------
    { id: "noul_to_choice", kind: "transform", label: "Convert shown Noul questions to two-option Choice",
      params: [{ name: "yesKey", label: "Key for yes", type: "text", required: true, placeholder: "yes" }, { name: "noKey", label: "Key for no", type: "text", required: true, placeholder: "no" }],
      help: "The yes and no criteria become the descriptions of the two options you name; instructions stay. A question with a human expectation is refused, since a Noul expectation does not fit a Choice.",
      all: (items, params, ctx, shown) => {
        const yes = params.yesKey.trim(), no = params.noKey.trim();
        if (!yes || !no || yes === no) throw new Error("Give two different keys for yes and no.");
        return shownEdit((item, _, __, index) => {
          if (item.type !== "noul") return null;
          if (item.expectation) throw new Error(`${nameOf(item, index)} has a human expectation for a Noul answer; remove it before converting.`);
          return { ...item, type: "choice", choice: [[yes, str(item.noulYes)], [no, str(item.noulNo)]], noulYes: "", noulNo: "" };
        })(items, params, ctx, shown);
      } },
    { id: "choice_to_noul", kind: "transform", label: "Convert shown yes/no Choice questions to Noul",
      params: [{ name: "yesKey", label: "Key that means yes", type: "text", required: true, placeholder: "yes" }],
      help: "Only Choice questions with exactly two named options, one of them the key you name: its description becomes the yes criterion and the other's the no criterion. A question with a human expectation is refused.",
      all: (items, params, ctx, shown) => {
        const yes = params.yesKey.trim();
        return shownEdit((item, _, __, index) => {
          if (item.type !== "choice" || !Array.isArray(item.choice)) return null;
          const named = item.choice.filter(([key]) => str(key).trim());
          if (named.length !== 2 || !named.some(([key]) => str(key).trim() === yes)) return null;
          if (item.expectation) throw new Error(`${nameOf(item, index)} has a human expectation for a Choice answer; remove it before converting.`);
          const [yesRow] = named.filter(([key]) => str(key).trim() === yes);
          const [noRow] = named.filter(([key]) => str(key).trim() !== yes);
          return { ...item, type: "noul", noulYes: yesRow[1], noulNo: noRow[1], choice: BLANK_CHOICE() };
        })(items, params, ctx, shown);
      } },

    // ---------- order ----------
    { id: "sort_by_id", kind: "transform", label: "Sort shown questions by id",
      params: [{ name: "direction", label: "Order", type: "select", options: [["asc", "A to Z"], ["desc", "Z to A"]] }],
      help: "Reorders the shown cards among the places they hold, so hidden cards keep their positions. Cards without an id go last. Run sends questions in this new order.",
      all: reorderShown((list, { direction }) => list.map((item, index) => ({ item, index })).sort((a, b) => {
        const x = trimmedId(a.item), y = trimmedId(b.item);
        if (!x || !y) return !x && !y ? a.index - b.index : !x ? 1 : -1;
        return compareText(x, y) * (direction === "desc" ? -1 : 1) || a.index - b.index;
      }).map((entry) => entry.item)) },
    { id: "group_by_type", kind: "transform", label: "Group shown questions by type",
      help: "Shown cards of one type come together, types in the order they first appear, keeping their order within each type; hidden cards keep their positions.",
      all: reorderShown((list) => {
        const order = [...new Set(list.map((item) => item.type))];
        return order.flatMap((type) => list.filter((item) => item.type === type));
      }) },
    { id: "reverse_shown", kind: "transform", label: "Reverse the order of shown questions",
      help: "The shown cards swap places end to end; hidden cards keep their positions.",
      all: reorderShown((list) => list.slice().reverse()) },
    { id: "order_by_list", kind: "transform", label: "Order shown questions by a list of ids",
      params: [{ name: "ids", label: "Ids in the order you want (one per line or comma-separated)", type: "textarea", required: true }],
      help: "The listed shown questions come first in the list's order, then the other shown questions as they were; hidden cards keep their positions. Ids are exact and case-sensitive.",
      all: (items, params, ctx, shown) => {
        const wanted = params.ids.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
        const repeat = wanted.find((id, at) => wanted.indexOf(id) !== at);
        if (repeat) throw new Error(`“${repeat}” is listed twice.`);
        const shownIds = items.filter((_, index) => shown.has(index)).map(trimmedId);
        const missing = wanted.find((id) => !shownIds.includes(id));
        if (missing) throw new Error(`No shown question has the id “${missing}”.`);
        const twice = wanted.find((id) => shownIds.indexOf(id) !== shownIds.lastIndexOf(id));
        if (twice) throw new Error(`Two shown questions have the id “${twice}”. Rename one first.`);
        return reorderShown((list) => [...wanted.map((id) => list.find((item) => trimmedId(item) === id)), ...list.filter((item) => !wanted.includes(trimmedId(item)))])(items, params, ctx, shown);
      } },

    // ---------- split and merge ----------
    { id: "split_questions", kind: "transform", label: "Split shown instructions that ask several questions",
      help: "Text instructions with two or more question marks (outside quotes and backticks) are split at each one: the card keeps the first question and its expectation, and each other question becomes a new card of the same type and criteria right after it, with the id plus _2, _3 …. This adds cards, so the one-step Undo refuses; remove the new cards to go back.",
      all: (items, params, ctx, shown) => {
        const taken = new Set([...items.map(trimmedId).filter(Boolean), ...expectationIds(items, ctx)]);
        const next = [], before = [];
        items.forEach((item, index) => {
          const pieces = shown.has(index) && trimmedId(item) && !parsesAsStructure(item.instructions) ? splitQuestions(str(item.instructions)) : null;
          if (!pieces) { next.push(item); before.push(item); return; }
          next.push({ ...item, instructions: pieces[0] });
          before.push(item);
          for (const piece of pieces.slice(1)) {
            const id = uniqueName(trimmedId(item), taken);
            taken.add(id);
            const { ref: _ref, ...rest } = item;
            next.push({ ...rest, id, instructions: piece, expectation: null });
            before.push(null);
          }
        });
        const limit = ctx?.data?.limits?.questions ?? 100;
        if (next.length > limit) throw new Error(`A request takes at most ${limit} questions; splitting would make ${next.length}.`);
        return checkList(next, items, ctx, before);
      } },
    { id: "remove_duplicates", kind: "transform", label: "Remove shown questions that repeat an earlier one",
      help: "A shown question with the same type, trimmed instructions and active criteria as an earlier shown question is removed, keeping the first. Refused when a repeat holds a human expectation: remove that one with its own Remove button.",
      all: (items, params, ctx, shown) => {
        const seen = new Set();
        return items.filter((item, index) => {
          if (!shown.has(index) || !trimmedId(item)) return true;
          const key = JSON.stringify([item.type, str(item.instructions).trim(), activeCriteria(item)]);
          if (!seen.has(key)) { seen.add(key); return true; }
          if (item.expectation) throw new Error(`${nameOf(item, index)} repeats an earlier question but has a human expectation. Remove it with its own Remove button.`);
          return false;
        });
      } },

    // ---------- paste to import ----------
    { id: "csv_questions", kind: "importer", label: "Questions from CSV or TSV (adds questions)",
      help: "A header row with id, type and instructions, and optionally criteria: one criterion per line or separated by “ | ” — key: description for Choice, the levels in order for Score, yes: … and no: … for Noul. Commas, semicolons or tabs are detected.",
      parse: (text, ctx) => {
        const rows = parseDelimited(text, sniffDelimiter(text)) || [];
        const body = rows.filter((cells) => cells.some((cell) => cell.trim()));
        if (body.length < 2) throw new Error("Paste a header row and at least one question row.");
        const header = body[0].map((cell) => cell.trim().toLowerCase());
        const column = (name) => header.indexOf(name);
        for (const name of ["id", "type", "instructions"]) if (column(name) < 0) throw new Error(`The header needs a column named ${name}.`);
        const warnings = header.filter((name) => name && !["id", "type", "instructions", "criteria"].includes(name)).map((name) => `The column “${name}” was ignored.`);
        const items = body.slice(1).map((cells, index) => {
          const where = `Row ${index + 2}`;
          const cell = (name) => (column(name) >= 0 ? str(cells[column(name)]) : "");
          const type = typeOf(cell("type"), where);
          const parts = emptyParts();
          for (const line of cell("criteria").split(/\r\n|\r|\n| \| /)) addCriterion(parts, type, line, where);
          return fromParts(cell("id").trim(), type, cell("instructions"), parts);
        });
        return finishImport(items, ctx, warnings);
      } },
    { id: "markdown_list", kind: "importer", label: "Questions from a Markdown list (adds questions)",
      help: "One top-level bullet per question, “- id (type): instructions”, with its criteria as indented bullets: “- key: description” for Choice, one level per bullet for Score (leading 0: or 1. is dropped), “- yes: …” and “- no: …” for Noul.",
      parse: (text, ctx) => {
        const items = [], warnings = [];
        let current = null;
        text.split(/\r\n|\r|\n/).forEach((line, index) => {
          if (!line.trim()) return;
          const top = /^(?:[-*+]|\d+[.)])\s+`?([^\s`]+)`?\s+\((noul|choice|score|box)\)\s*(?::\s*(.*))?$/i.exec(line);
          const nested = /^(?:\s{2,}|\t)\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
          if (top && !/^\s/.test(line)) {
            current = { id: top[1], type: typeOf(top[2], `Line ${index + 1}`), instructions: (top[3] || "").trim(), parts: emptyParts() };
            items.push(current);
          } else if (nested) {
            if (!current) throw new Error(`Line ${index + 1} is a criterion before any question.`);
            addCriterion(current.parts, current.type, nested[1], `Line ${index + 1}`);
          } else warnings.push(`Line ${index + 1} was skipped: it is not a “- id (type): instructions” bullet or an indented criterion.`);
        });
        return finishImport(items.map((entry) => fromParts(entry.id, entry.type, entry.instructions, entry.parts)), ctx, warnings);
      } },
    { id: "json_lines", kind: "importer", label: "Questions from JSON Lines or a JSON list (adds questions)",
      help: "One { id, type, instructions, criteria } object per line, as “Shown questions as JSON Lines” writes them, or a JSON list of such objects. criteria uses the API's shape.",
      parse: (text, ctx) => {
        const trimmed = text.trim();
        let values;
        if (trimmed.startsWith("[")) {
          values = parseJson(trimmed, "a JSON list of questions");
          if (!Array.isArray(values)) throw new Error("Paste a JSON list of questions.");
        } else {
          const lines = trimmed.split(/\r\n|\r|\n/).map((line, index) => [line.trim(), index + 1]).filter(([line]) => line);
          if (!lines.length) throw new Error("Paste one question object per line.");
          values = lines.map(([line, number]) => {
            const repeats = duplicateKeys(line);
            if (repeats === null) throw new Error(`Line ${number} is not valid JSON.`);
            if (repeats.length) throw new Error(`Line ${number} repeats ${repeats[0]}.`);
            return JSON.parse(line);
          });
        }
        return finishImport(values.map((value, index) => {
          if (!isPlainObject(value)) throw new Error(`Entry ${index + 1} is not a question object.`);
          if (typeof value.id !== "string") throw new Error(`Entry ${index + 1} needs an id.`);
          return rowFromApi(value.id, value, `Entry ${index + 1}`);
        }), ctx);
      } },
    { id: "request_questions", kind: "importer", label: "Questions from a request, saved test or Build draft (adds questions)",
      help: "Any JSON object with a questions map: the request in Inspect JSON (also wrapped as { request }), a saved test file or a Build draft. Only the questions are added; state, expectations, pictures and model are left out.",
      parse: (text, ctx) => {
        const value = parseJson(text.trim(), "a JSON object with a questions map");
        const holder = isPlainObject(value) && isPlainObject(value.questions) ? value : isPlainObject(value?.request) && isPlainObject(value.request.questions) ? value.request : null;
        if (!holder) throw new Error("The JSON has no questions map. Paste a request, a saved test or a Build draft.");
        return questionsFromMap(holder.questions, ctx, leftOut(holder));
      } },
    { id: "curl_questions", kind: "importer", label: "Questions from an exported curl snippet (adds questions)",
      help: "The curl tab of Export code: the request between <<'EOF' and EOF is read and only its questions are added; state, model and pictures are left out.",
      parse: (text, ctx) => {
        const match = /<<'?EOF'?\r?\n([\s\S]*?)\r?\nEOF\b/.exec(text);
        if (!match) throw new Error("No <<'EOF' … EOF request was found. Paste the whole curl snippet.");
        const value = parseJson(match[1], "the snippet's JSON request");
        if (!isPlainObject(value) || !isPlainObject(value.questions)) throw new Error("The snippet's request has no questions map.");
        return questionsFromMap(value.questions, ctx, leftOut(value));
      } },
    { id: "editor_markdown", kind: "importer", label: "Questions from the editor's authored Markdown (adds questions)",
      help: "The Markdown that Copy or Download shown Markdown writes (## Question, ID, Type, Instructions and Criteria blocks), read back into questions.",
      parse: (text, ctx) => {
        const lines = text.split(/\r\n|\r|\n/);
        const out = [];
        let current = null;
        const fenced = (start, where) => {
          let at = start;
          while (at < lines.length && !lines[at].trim()) at++;
          const fence = /^(`{3,})\s*$/.exec(lines[at] || "");
          if (!fence) throw new Error(`${where} should be followed by a fenced block.`);
          const end = lines.findIndex((line, index) => index > at && line === fence[1]);
          if (end < 0) throw new Error(`${where}: the fenced block is not closed.`);
          return { value: lines.slice(at + 1, end).join("\n"), next: end + 1 };
        };
        for (let index = 0; index < lines.length;) {
          const line = lines[index];
          const heading = /^##\s+Question\b/.exec(line);
          if (heading) { current = { id: null, type: null, instructions: "", criteria: null, where: line.trim() }; out.push(current); index++; continue; }
          if (!current) { index++; continue; }
          const type = /^Type:\s*(\S+)\s*$/.exec(line);
          if (type) { current.type = typeOf(type[1], current.where); index++; continue; }
          const block = { ID: "id", Instructions: "instructions", Criteria: "criteria" }[line.trim()];
          if (block) {
            const read = fenced(index + 1, `${current.where} ${line.trim()}`);
            current[block] = read.value;
            index = read.next;
            continue;
          }
          index++;
        }
        if (!out.length) throw new Error("No “## Question” sections were found.");
        const rows = out.map((entry) => {
          if (entry.id === null || !entry.type) throw new Error(`${entry.where} needs an ID block and a Type line.`);
          let criteria = null;
          if (entry.criteria !== null) {
            try { criteria = JSON.parse(entry.criteria); } catch { throw new Error(`${entry.where}: the Criteria block is not valid JSON.`); }
          }
          const parts = emptyParts();
          if (entry.type === "choice" && Array.isArray(criteria)) parts.choice = criteria.map((option) => [asText(option?.key), asText(option?.description)]);
          else if (entry.type === "score" && Array.isArray(criteria)) parts.score = criteria.map(asText);
          else if (entry.type === "noul" && isPlainObject(criteria)) { parts.yes = asText(criteria.yes); parts.no = asText(criteria.no); }
          else if (criteria !== null) throw new Error(`${entry.where}: the Criteria block does not fit a ${entry.type} question.`);
          return fromParts(entry.id, entry.type, entry.instructions, parts);
        });
        return finishImport(rows, ctx);
      } },
  ],
});
