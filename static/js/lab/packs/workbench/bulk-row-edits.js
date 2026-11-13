// Previewed row edits, paste importers and row exports for the Bulk rows box (surface workbench.bulk.rows; contract in
// static/js/lab/surfaces/workbench-bulk.js). Edits change tuning rows only (the shown ones, except the sorts) and give
// held-out rows back untouched in their places; imports add new tuning rows through the page's own import action. Exports state what they hold and
// never hold a held-out row's label values or any model answer.
import { compareText, csvText, definePack } from "../../kit.js";
import { normalizeDashes, normalizeQuotes, normalizeUnicode, stripControlCharacters, toSnakeCase } from "../../lib/text.js";
import { formatDelimited, formatMarkdownTable, parseDelimited, parseMarkdownTable } from "../../lib/tables.js";

const RESERVED = ["_expect", "_test", "_image"];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- rows as the model reads them ----------

// The input as an object of fields: a text row is { text }. null for array and value rows.
const stateOf = (input) => (typeof input === "string" ? { text: input } : isObject(input) ? input : null);
// Back to a row input: an object whose only field is a string "text" is a text row, as the page reads it.
const inputOf = (state) => {
  const keys = Object.keys(state);
  return keys.length === 1 && keys[0] === "text" && typeof state.text === "string" ? state.text : state;
};
const textOf = (input) => (typeof input === "string" ? input : isObject(input) && typeof input.text === "string" ? input.text : null);
const hasLabels = (item) => isObject(item.labels) && Object.keys(item.labels).length > 0;
const questionsOf = (ctx) => ctx?.data?.questions || {};
const idsOfType = (ctx, type) => Object.entries(questionsOf(ctx)).filter(([, question]) => question?.type === type).map(([id]) => id);

// Stable JSON with sorted keys: the identity of a row's input and picture, ignoring labels and the held-out marker.
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const identity = (item) => canon([stateOf(item.input) ?? item.input ?? null, item.image ?? null]);

// Every string inside a value (keys unchanged), changed by fix.
function mapStrings(value, fix) {
  if (typeof value === "string") return fix(value);
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, fix));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, fix)]));
  return value;
}

// A per-row edit of every string in a shown tuning row's input. A text row never becomes blank: it stays as it was.
const editStrings = (fix) => (item) => {
  if (item.test) return null;
  const next = mapStrings(item.input, fix);
  if (same(next, item.input) || (typeof next === "string" && !next.trim())) return null;
  return { ...item, input: next };
};

// A per-row edit of a shown tuning row's fields: change(state, index) returns the next state, or null for no change.
const editFields = (change) => (item, params, ctx, index) => {
  if (item.test) return null;
  const state = stateOf(item.input);
  if (!state) return null;
  const next = change({ ...state }, index, item, params, ctx);
  if (!next || same(next, state)) return null;
  if (!Object.keys(next).length && !item.image) throw new Error(`Row ${index + 1} would have no input left. Remove the row instead.`);
  if (item.image && has(next, "photo")) throw new Error(`Row ${index + 1} has a picture, so it cannot have its own photo field.`);
  return { ...item, input: inputOf(next) };
};

// Renames one key of an object, keeping its place.
const renameKey = (object, from, to) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key === from ? to : key, value]));

function fieldName(name, what = "Field name") {
  const text = String(name ?? "");
  if (!text.trim()) throw new Error(`${what} is required.`);
  if (RESERVED.includes(text)) throw new Error(`${text} is a row marker, not an input field. Use labels and pictures instead.`);
  return text;
}

// Keeps held-out rows in their places and fills the other places, in order, with next tuning rows.
function refill(items, tuning) {
  const queue = tuning.slice();
  return items.map((item) => (item.test ? item : queue.shift()));
}

// HTML tags removed; line-breaking tags become line breaks so words on either side stay apart.
function stripTags(text) {
  if (!/<\/?[A-Za-z][^<>]*>/.test(text)) return text;
  return text.replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|li|ul|ol|tr|table|blockquote|h[1-6])\b[^<>]*>/gi, "\n")
    .replace(/<\/?[A-Za-z][^<>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

// ---------- labels and cells ----------

// A pasted label cell in the question's terms: Noul true/false, a whole Score level, a Box's JSON edges; text otherwise.
function labelFrom(cell, type) {
  const text = cell.trim();
  if (type === "noul" && /^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (type === "score" && /^\d+$/.test(text)) return Number(text);
  if (type === "box" && text.startsWith("{")) {
    try { const value = JSON.parse(text); if (isObject(value)) return value; } catch { /* kept as text */ }
  }
  return text;
}

const cellOf = (value) => (value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value));

// Records from a pasted table into rows: _image is the picture, label:<question id> columns are labels, a _test column
// is refused, every other nonblank cell is an input field. Rows with nothing to read are skipped with a warning.
function rowsFromRecords(columns, records, ctx) {
  const questions = questionsOf(ctx);
  const warnings = [];
  if (columns.includes("_test")) throw new Error("A _test column cannot be imported: held-out rows come only from Datasets' test split.");
  const reserved = columns.filter((name) => name === "_expect");
  if (reserved.length) throw new Error("Write labels as label:<question id> columns, not _expect.");
  if (columns.some((name) => /^label:\s*$/.test(name))) throw new Error("A label: column needs a question id after the colon.");
  const items = [];
  records.forEach((cells, index) => {
    const state = {};
    const labels = {};
    let image = null;
    columns.forEach((name, column) => {
      const cell = String(cells[column] ?? "");
      if (!cell.trim()) return;
      if (name === "_image") image = cell.trim();
      else if (name.startsWith("label:")) {
        const id = name.slice(6).trim();
        labels[id] = labelFrom(cell, questions[id]?.type);
      } else state[name] = cell;
    });
    if (!Object.keys(state).length && !image) {
      warnings.push(`Row ${index + 1} has nothing for the model to read and was skipped.`);
      return;
    }
    if (image && has(state, "photo")) {
      warnings.push(`Row ${index + 1} has a picture and its own photo field and was skipped.`);
      return;
    }
    items.push({ input: inputOf(state), image, labels });
  });
  if (!items.length) throw new Error("No row in the paste has anything for the model to read.");
  return { items, warnings };
}

function headerCheck(columns) {
  if (!columns.length || columns.every((name) => !name.trim())) throw new Error("The first line must name the columns.");
  const seen = new Set();
  for (const name of columns) {
    if (seen.has(name)) throw new Error(`Column ${name} appears twice.`);
    seen.add(name);
  }
}

// ---------- exports ----------

const tuningShown = (ctx) => ctx.shown().filter((item) => !item.test);
const fieldRows = (ctx) => tuningShown(ctx).filter((item) => stateOf(item.input));

// A row the box accepts: a text line as itself, anything else as an object with _image and _expect.
function boxRow(item) {
  const labels = hasLabels(item) ? { _expect: item.labels } : {};
  const picture = item.image ? { _image: item.image } : {};
  if (typeof item.input === "string" && !item.image && !hasLabels(item)) return item.input;
  if (Array.isArray(item.input) || !stateOf(item.input)) return item.input;
  return { ...stateOf(item.input), ...picture, ...labels };
}

// Field names of the rows in first-seen order, and label columns: selected questions first, then other labeled ids.
function columnsOf(rows, ctx, withLabels) {
  const fields = [];
  for (const item of rows) for (const name of Object.keys(stateOf(item.input))) if (!fields.includes(name)) fields.push(name);
  const ids = withLabels ? Object.keys(questionsOf(ctx)).filter((id) => rows.some((item) => item.labels && has(item.labels, id))) : [];
  if (withLabels) for (const item of rows) for (const id of Object.keys(item.labels || {})) if (!ids.includes(id)) ids.push(id);
  return { fields, ids, picture: rows.some((item) => item.image) };
}

const displayInput = (input) => (typeof input === "string" ? input : JSON.stringify(input));

export default definePack({
  id: "bulk-row-edits",
  surface: "workbench.bulk.rows",
  title: "Row edits, imports and exports",
  about: "Previewed edits of the tuning rows (characters, line breaks, HTML, fields, labels, copies, order), paste importers that add rows, and row exports. Held-out rows are never changed and their label values are never exported.",
  features: [
    // ---------- text clean-up ----------
    { id: "straight_quotes", kind: "transform", label: "Make curly quotes straight", each: editStrings(normalizeQuotes) },
    { id: "plain_dashes", kind: "transform", label: "Write dashes and minus signs as hyphens", each: editStrings(normalizeDashes) },
    { id: "strip_control", kind: "transform", label: "Remove control characters", help: "Keeps tabs and line breaks.",
      each: editStrings(stripControlCharacters) },
    { id: "unicode_nfc", kind: "transform", label: "Normalize Unicode to composed form (NFC)",
      help: "Joins letters and combining accents, so text that looks the same is the same.", each: editStrings((text) => normalizeUnicode(text, "NFC")) },
    { id: "unix_newlines", kind: "transform", label: "Write line breaks as plain newlines", help: "CRLF and CR become LF.",
      each: editStrings((text) => text.replace(/\r\n?/g, "\n")) },
    { id: "literal_newlines", kind: "transform", label: "Turn literal \\n into line breaks",
      help: "For text pasted from an export that wrote a backslash and n instead of a line break.",
      each: editStrings((text) => text.replace(/\\r\\n|\\n/g, "\n")) },
    { id: "strip_html_tags", kind: "transform", label: "Remove HTML tags from the text",
      help: "<br> and paragraph, list, heading and table-row tags become line breaks, so words on either side stay apart; other tags are removed. Text without tags is left as it is.",
      each: editStrings(stripTags) },
    { id: "decode_entities", kind: "transform", label: "Decode HTML entities such as &amp;",
      help: "&amp; &lt; &gt; &quot; &#39; &apos; &nbsp; and numeric entities.",
      each: editStrings((text) => text.replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#\d+|#x[0-9a-f]+);/gi, (match, name) => {
        const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" }[name.toLowerCase()];
        if (named) return named;
        const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : match;
      })) },

    // ---------- fields ----------
    { id: "trim_field_names", kind: "transform", label: "Trim spaces around field names",
      each: editFields((state, index) => {
        const names = Object.keys(state);
        const next = names.map((name) => name.trim());
        if (next.some((name) => !name)) throw new Error(`Row ${index + 1} has a field whose name is only spaces.`);
        if (new Set(next).size !== next.length) throw new Error(`Row ${index + 1} would have two fields with the same name.`);
        if (next.some((name) => RESERVED.includes(name))) throw new Error(`Row ${index + 1} would get a field named like a row marker.`);
        return Object.fromEntries(names.map((name, position) => [next[position], state[name]]));
      }) },
    { id: "snake_case_fields", kind: "transform", label: "Write field names in snake_case", help: "\"Order ID\" and \"orderId\" become order_id.",
      each: editFields((state, index) => {
        const names = Object.keys(state);
        const next = names.map((name) => toSnakeCase(name) || name);
        if (new Set(next).size !== next.length) throw new Error(`Row ${index + 1} would have two fields with the same name.`);
        return Object.fromEntries(names.map((name, position) => [next[position], state[name]]));
      }) },
    { id: "rename_field", kind: "transform", label: "Rename an input field",
      help: "Renaming text on a text row turns it into an object row; renaming a field to text can make a text row.",
      params: [{ name: "from", label: "Field", type: "text", required: true }, { name: "to", label: "New name", type: "text", required: true }],
      each: editFields((state, index, item, params) => {
        const to = fieldName(params.to, "New name");
        if (!has(state, params.from) || params.from === to) return null;
        if (has(state, to)) throw new Error(`Row ${index + 1} already has a field ${to}.`);
        return renameKey(state, params.from, to);
      }) },
    { id: "drop_field", kind: "transform", label: "Remove an input field", params: [{ name: "name", label: "Field", type: "text", required: true }],
      each: editFields((state, index, item, params) => {
        if (!has(state, params.name)) return null;
        delete state[params.name];
        return state;
      }) },
    { id: "set_field", kind: "transform", label: "Set a field to a value",
      help: "Sets the field on every shown tuning row that is text or an object, adding it where it is missing. The value is written as text.",
      params: [{ name: "name", label: "Field", type: "text", required: true }, { name: "value", label: "Value", type: "text" }],
      each: editFields((state, index, item, params) => {
        const name = fieldName(params.name, "Field");
        state[name] = params.value;
        return state;
      }) },
    { id: "lowercase_field", kind: "transform", label: "Lower-case one field's values",
      help: "For slice fields such as a channel written Email and email.", params: [{ name: "name", label: "Field", type: "text", required: true }],
      each: editFields((state, index, item, params) => {
        if (typeof state[params.name] !== "string") return null;
        state[params.name] = state[params.name].toLowerCase();
        return state;
      }) },
    { id: "drop_empty_fields", kind: "transform", label: "Remove empty fields",
      help: "Removes fields that are null, blank text, [] or {}. A row whose fields are all empty is left for Remove empty rows.",
      each: editFields((state) => {
        const empty = (value) => value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length);
        const kept = Object.fromEntries(Object.entries(state).filter(([, value]) => !empty(value)));
        return Object.keys(kept).length ? kept : null;
      }) },
    { id: "field_into_text", kind: "transform", label: "Move a field into the text",
      help: "Adds a line \"field: value\" to the end of the text and removes the field, so the model reads it as part of the message.",
      params: [{ name: "name", label: "Field", type: "text", required: true }],
      each: editFields((state, index, item, params) => {
        const name = params.name;
        if (name === "text" || !has(state, name)) return null;
        if (has(state, "text") && typeof state.text !== "string") throw new Error(`Row ${index + 1} has a text field that is not text.`);
        const value = typeof state[name] === "string" ? state[name] : JSON.stringify(state[name]);
        const line = `${name}: ${value}`;
        const text = typeof state.text === "string" && state.text ? `${state.text}\n${line}` : line;
        delete state[name];
        return has(state, "text") ? { ...state, text } : { text, ...state };
      }) },
    { id: "field_to_label", kind: "transform", label: "Turn an input field into a label",
      help: "For a label column that was imported as input: moves the field's value into the question's label and removes it from the input. A blank or null value is removed without making a label. A row whose label already differs stops the preview.",
      params: [{ name: "field", label: "Field", type: "text", required: true }, { name: "question", label: "Question id", type: "text", required: true }],
      each: (item, params, ctx, index) => {
        if (item.test || !isObject(item.input) || !has(item.input, params.field)) return null;
        const question = params.question.trim();
        if (!question) throw new Error("Question id is required.");
        const value = item.input[params.field];
        const blank = value === null || (typeof value === "string" && !value.trim());
        const labels = isObject(item.labels) ? { ...item.labels } : {};
        if (!blank && has(labels, question) && !same(labels[question], value)) throw new Error(`Row ${index + 1} already has a different ${question} label. Settle it by hand first.`);
        if (!blank) labels[question] = value;
        const state = { ...item.input };
        delete state[params.field];
        if (!Object.keys(state).length && !item.image) throw new Error(`Row ${index + 1} would have no input left.`);
        return { ...item, input: inputOf(state), labels };
      } },

    // ---------- rows ----------
    { id: "drop_empty_rows", kind: "transform", label: "Remove empty rows",
      help: "Removes shown tuning rows with nothing to read: blank text, or an object whose fields are all empty, with no picture. Their labels go with them.",
      all: (items, params, ctx, shown) => items.filter((item, index) => {
        if (item.test || !shown.has(index) || item.image) return true;
        const empty = (value) => value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length);
        const state = stateOf(item.input);
        return !(state ? Object.values(state).every(empty) : empty(item.input));
      }) },
    { id: "merge_copies", kind: "transform", label: "Merge copies whose labels agree",
      help: "Shown tuning rows with the same input and picture become one row at the first copy's place, holding every label of the copies. Groups whose labels disagree, or that include a held-out copy, are left alone.",
      all: (items, params, ctx, shown) => {
        const heldKeys = new Set(items.filter((item) => item.test).map(identity));
        const groups = new Map();
        items.forEach((item, index) => {
          if (item.test || !shown.has(index) || heldKeys.has(identity(item))) return;
          const key = identity(item);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(index);
        });
        const drop = new Set();
        const merged = new Map();
        for (const indexes of groups.values()) {
          if (indexes.length < 2) continue;
          const labels = {};
          let conflict = false;
          for (const index of indexes) {
            for (const [id, value] of Object.entries(items[index].labels || {})) {
              if (has(labels, id) && !same(labels[id], value)) conflict = true;
              else labels[id] = value;
            }
          }
          if (conflict) continue;
          merged.set(indexes[0], { ...items[indexes[0]], labels });
          indexes.slice(1).forEach((index) => drop.add(index));
        }
        return items.flatMap((item, index) => (drop.has(index) ? [] : [merged.get(index) || item]));
      } },
    { id: "sort_by_field", kind: "transform", label: "Sort tuning rows by a field",
      help: "Numbers in numeric order, then text A to Z; rows without the field go last. Held-out rows keep their places.",
      params: [{ name: "name", label: "Field", type: "text", required: true },
        { name: "order", label: "Order", type: "select", options: [["asc", "Ascending"], ["desc", "Descending"]] }],
      all: (items, params) => {
        const direction = params.order === "desc" ? -1 : 1;
        const key = (item) => {
          const state = stateOf(item.input);
          if (!state || !has(state, params.name) || state[params.name] === null) return null;
          const value = state[params.name];
          return typeof value === "number" ? { rank: 0, value } : { rank: 1, value: typeof value === "string" ? value : JSON.stringify(value) };
        };
        const tuning = items.filter((item) => !item.test).map((item, order) => ({ item, order, key: key(item) }));
        tuning.sort((a, b) => {
          if (!a.key || !b.key) return a.key === b.key ? a.order - b.order : a.key ? -1 : 1;
          if (a.key.rank !== b.key.rank) return (a.key.rank - b.key.rank) * direction;
          const order = a.key.rank === 0 ? a.key.value - b.key.value : compareText(a.key.value, b.key.value);
          return order * direction || a.order - b.order;
        });
        return refill(items, tuning.map((entry) => entry.item));
      } },
    { id: "labeled_first", kind: "transform", label: "Move labeled tuning rows first",
      help: "Keeps the order within labeled and unlabeled rows; held-out rows keep their places.",
      all: (items) => refill(items, [...items.filter((item) => !item.test && hasLabels(item)), ...items.filter((item) => !item.test && !hasLabels(item))]) },

    // ---------- labels ----------
    { id: "rename_label", kind: "transform", label: "Rename a label's question id",
      params: [{ name: "from", label: "Question id", type: "text", required: true }, { name: "to", label: "New question id", type: "text", required: true }],
      each: (item, params, ctx, index) => {
        const to = params.to.trim();
        if (!to) throw new Error("New question id is required.");
        if (item.test || !isObject(item.labels) || !has(item.labels, params.from) || params.from === to) return null;
        if (has(item.labels, to)) throw new Error(`Row ${index + 1} already has a label for ${to}.`);
        return { ...item, labels: renameKey(item.labels, params.from, to) };
      } },
    { id: "drop_label", kind: "transform", label: "Remove one question's labels", params: [{ name: "question", label: "Question id", type: "text", required: true }],
      each: (item, params) => {
        if (item.test || !isObject(item.labels) || !has(item.labels, params.question)) return null;
        const labels = { ...item.labels };
        delete labels[params.question];
        return { ...item, labels };
      } },
    { id: "choice_label_case", kind: "transform", label: "Match Choice labels to their option's spelling",
      help: "For the selected Choice questions, a label that equals one option except for letter case or spaces is written as that option.",
      each: (item, params, ctx) => {
        if (item.test || !isObject(item.labels)) return null;
        const labels = { ...item.labels };
        for (const id of idsOfType(ctx, "choice")) {
          const value = labels[id];
          const keys = Object.keys(questionsOf(ctx)[id].criteria || {});
          if (typeof value !== "string" || keys.includes(value)) continue;
          const matches = keys.filter((key) => key.toLowerCase() === value.trim().toLowerCase());
          if (matches.length === 1) labels[id] = matches[0];
        }
        return same(labels, item.labels) ? null : { ...item, labels };
      } },
    { id: "score_label_numbers", kind: "transform", label: "Write Score labels as numbers",
      help: "For the selected Score questions, text such as \"2\" or \"2.0\" becomes the level 2. Other text is left as it is.",
      each: (item, params, ctx) => {
        if (item.test || !isObject(item.labels)) return null;
        const labels = { ...item.labels };
        for (const id of idsOfType(ctx, "score")) {
          const match = typeof labels[id] === "string" ? /^\s*(\d+)(?:\.0+)?\s*$/.exec(labels[id]) : null;
          if (match) labels[id] = Number(match[1]);
        }
        return same(labels, item.labels) ? null : { ...item, labels };
      } },
    { id: "drop_box_labels_without_picture", kind: "transform", label: "Remove Box labels from rows without a picture",
      help: "Such labels can never be scored, since a Box question looks at the row's picture.",
      each: (item, params, ctx) => {
        if (item.test || item.image || !isObject(item.labels)) return null;
        const boxes = idsOfType(ctx, "box");
        const labels = Object.fromEntries(Object.entries(item.labels).filter(([id]) => !boxes.includes(id)));
        return Object.keys(labels).length === Object.keys(item.labels).length ? null : { ...item, labels };
      } },

    // ---------- importers ----------
    { id: "plain_lines", kind: "importer", label: "Plain lines (each line is text)",
      help: "One row per nonblank line, read as text even when it looks like JSON. Adds rows after the existing ones.",
      parse: (text) => {
        const items = text.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ input: line, image: null, labels: {} }));
        if (!items.length) throw new Error("There are no lines to import.");
        return items;
      } },
    { id: "list_items", kind: "importer", label: "Numbered or bulleted list",
      help: "One row per list item (\"1. text\", \"2) text\", \"- text\", \"* text\", \"• text\"); indented lines continue the item above. Other lines are skipped with a warning.",
      parse: (text) => {
        const items = [];
        const warnings = [];
        text.split(/\r\n|\r|\n/).forEach((line, index) => {
          if (!line.trim()) return;
          const marker = /^\s*(?:[-*•+]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
          if (marker) items.push(marker[1]);
          else if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`;
          else warnings.push(`Line ${index + 1} is not a list item and was skipped.`);
        });
        if (!items.length) throw new Error("No line starts with a list marker such as 1. or -.");
        return { items: items.map((input) => ({ input, image: null, labels: {} })), warnings };
      } },
    { id: "message_blocks", kind: "importer", label: "Messages separated by blank lines",
      help: "One row per block of text; line breaks inside a block are kept, so multi-line messages stay whole.",
      parse: (text) => {
        const blocks = text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/).map((block) => block.split("\n").map((line) => line.trimEnd()).join("\n").trim()).filter(Boolean);
        if (!blocks.length) throw new Error("There is no text to import.");
        return blocks.map((input) => ({ input, image: null, labels: {} }));
      } },
    { id: "tab_separated", kind: "importer", label: "Tab-separated table with a header (spreadsheet paste)",
      help: "The first line names the columns: _image for a picture, label:<question id> for labels, any other column an input field. Adds rows after the existing ones; the page's Import CSV replaces the box instead.",
      parse: (text, ctx) => {
        const body = text.replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/, "").replace(/(?:(?:\r\n|\r|\n)[ \t]*)+$/, "");
        const table = parseDelimited(body, "\t") || [];
        if (table.length < 2) throw new Error("Paste a header line and at least one row, with columns separated by tabs.");
        const columns = table[0].map((name) => name.trim());
        if (columns.length === 1 && columns[0].includes(",")) throw new Error("The header has commas but no tabs. For comma-separated text, use the page's Import CSV.");
        headerCheck(columns);
        return rowsFromRecords(columns, table.slice(1), ctx);
      } },
    { id: "markdown_table", kind: "importer", label: "Markdown table",
      help: "Same columns as the tab-separated import (_image, label:<question id>, input fields); <br> in a cell is a line break.",
      parse: (text, ctx) => {
        const table = parseMarkdownTable(text);
        if (!table) throw new Error("This is not a Markdown table: every line needs | between cells.");
        headerCheck(table.columns);
        if (!table.rows.length) throw new Error("The table has a header but no rows.");
        return rowsFromRecords(table.columns, table.rows.map((cells) => cells.map((cell) => cell.replace(/<br\s*\/?>/gi, "\n"))), ctx);
      } },
    { id: "json_array", kind: "importer", label: "JSON array of rows",
      help: "Each element is text or an object as the box writes it (_expect labels, _image picture). Elements with _test, arrays and bare values are skipped with a warning.",
      parse: (text) => {
        let value;
        try { value = JSON.parse(text); } catch { throw new Error("This is not valid JSON."); }
        if (!Array.isArray(value)) throw new Error("Paste a JSON array: [ … ].");
        const items = [];
        const warnings = [];
        value.forEach((entry, index) => {
          const where = `Element ${index + 1}`;
          if (typeof entry === "string") {
            if (entry.trim()) items.push({ input: entry, image: null, labels: {} });
            else warnings.push(`${where} is blank and was skipped.`);
            return;
          }
          if (!isObject(entry)) return warnings.push(`${where} is not text or an object and was skipped.`);
          if (has(entry, "_test")) return warnings.push(`${where} is marked held out and was skipped: only Datasets' test split holds rows out.`);
          if (has(entry, "_expect") && !isObject(entry._expect)) return warnings.push(`${where} has _expect that is not an object and was skipped.`);
          if (has(entry, "_image") && !(typeof entry._image === "string" && entry._image.trim())) return warnings.push(`${where} has an _image that names no picture and was skipped.`);
          const state = Object.fromEntries(Object.entries(entry).filter(([key]) => !RESERVED.includes(key)));
          const image = has(entry, "_image") ? entry._image : null;
          if (image && has(state, "photo")) return warnings.push(`${where} has a picture and its own photo field and was skipped.`);
          if (!Object.keys(state).length && !image) return warnings.push(`${where} has nothing for the model to read and was skipped.`);
          items.push({ input: inputOf(state), image, labels: has(entry, "_expect") ? entry._expect : {} });
          return undefined;
        });
        if (!items.length) throw new Error("No element of the array can be a row.");
        return { items, warnings };
      } },
    { id: "field_blocks", kind: "importer", label: "Blocks of field: value lines",
      help: "Blocks separated by blank lines; each line is \"field: value\", with _image: for a picture and label:<question id>: for labels.",
      parse: (text, ctx) => {
        const blocks = text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/).filter((block) => block.trim());
        if (!blocks.length) throw new Error("There is no text to import.");
        const columns = [];
        const records = blocks.map((block, index) => {
          const record = {};
          for (const line of block.split("\n").filter((entry) => entry.trim())) {
            const match = /^\s*(label:[^:]+|[^:]+):\s?(.*)$/.exec(line);
            if (!match) throw new Error(`Block ${index + 1}: "${line.trim().slice(0, 40)}" is not a field: value line.`);
            const name = match[1].trim();
            if (has(record, name)) throw new Error(`Block ${index + 1} names ${name} twice.`);
            record[name] = match[2];
            if (!columns.includes(name)) columns.push(name);
          }
          return record;
        });
        return rowsFromRecords(columns, records.map((record) => columns.map((name) => record[name] ?? "")), ctx);
      } },

    // ---------- exporters ----------
    { id: "rows_json", kind: "exporter", label: "Shown tuning rows as a JSON array (rows handoff)", filename: "bulk-rows.json", mime: "application/json",
      help: "Inputs, picture names and human labels of the shown tuning rows, written as rows the box accepts. Held-out rows are left out.",
      build: (ctx) => `${JSON.stringify(tuningShown(ctx).map(boxRow), null, 2)}\n` },
    { id: "rows_tsv", kind: "exporter", label: "Shown tuning rows as a tab-separated table", filename: "bulk-rows.tsv", mime: "text/tab-separated-values",
      help: "One column per input field, _image for pictures, label:<question id> for human labels; the tab-separated import reads it back. Held-out rows and array or value rows are left out; text a spreadsheet would run as a formula gets a leading apostrophe.",
      build: (ctx) => {
        const rows = fieldRows(ctx);
        const { fields, ids, picture } = columnsOf(rows, ctx, true);
        const header = [...fields, ...(picture ? ["_image"] : []), ...ids.map((id) => `label:${id}`)];
        return formatDelimited([header, ...rows.map((item) => {
          const state = stateOf(item.input);
          return [...fields.map((name) => cellOf(state[name])), ...(picture ? [item.image || ""] : []), ...ids.map((id) => cellOf(item.labels?.[id]))];
        })], "\t", { newline: "\n" }) ?? "";
      } },
    { id: "inputs_csv", kind: "exporter", label: "Shown inputs as CSV, without labels", filename: "bulk-inputs.csv", mime: "text/csv",
      help: "Row number, one column per input field and the picture name of the shown tuning rows. No labels; held-out rows and array or value rows are left out.",
      build: (ctx) => {
        const rows = fieldRows(ctx);
        const { fields, picture } = columnsOf(rows, ctx, false);
        return csvText([["row", ...fields, ...(picture ? ["picture"] : [])], ...rows.map((item) => {
          const state = stateOf(item.input);
          return [String(item.position ?? ""), ...fields.map((name) => cellOf(state[name])), ...(picture ? [item.image || ""] : [])];
        })]);
      } },
    { id: "rows_markdown", kind: "exporter", label: "Shown rows as a Markdown table", filename: "bulk-rows.md", mime: "text/markdown",
      help: "Row number, input, picture name and human labels; a held-out row shows its input with \"held out\" in place of labels.",
      build: (ctx) => `${formatMarkdownTable(["row", "input", "picture", "labels"], ctx.shown().map((item) => [item.position ?? "", displayInput(item.input),
        item.image || "", item.test ? "held out" : hasLabels(item) ? Object.entries(item.labels).map(([id, value]) => `${id}: ${cellOf(value)}`).join("; ") : ""])) ?? ""}\n` },
    { id: "texts_lines", kind: "exporter", label: "Shown texts, one per line", filename: "bulk-texts.txt",
      help: "The text the model reads on each shown tuning row; line breaks inside a text become spaces. No labels; held-out rows and rows without text are left out.",
      build: (ctx) => tuningShown(ctx).map((item) => textOf(item.input)).filter((text) => text !== null && text.trim())
        .map((text) => `${text.replace(/[\r\n]+/g, " ")}\n`).join("") },
    { id: "field_inventory", kind: "exporter", label: "Field inventory as CSV", filename: "bulk-fields.csv", mime: "text/csv",
      help: "Each input field name, how many shown rows have it and the kinds of values it holds. Names and counts only, no values.",
      build: (ctx) => {
        const fields = new Map();
        for (const item of ctx.shown()) {
          const state = stateOf(item.input);
          if (!state) continue;
          for (const [name, value] of Object.entries(state)) {
            if (!fields.has(name)) fields.set(name, { rows: 0, kinds: new Set() });
            const entry = fields.get(name);
            entry.rows += 1;
            entry.kinds.add(value === null ? "null" : Array.isArray(value) ? "list" : typeof value === "object" ? "object" : typeof value === "string" ? "text" : typeof value);
          }
        }
        return csvText([["field", "rows", "kinds"], ...[...fields].map(([name, entry]) => [name, String(entry.rows), [...entry.kinds].sort().join(" ")])]);
      } },
    { id: "picture_counts", kind: "exporter", label: "Picture names with row counts as CSV", filename: "bulk-pictures.csv", mime: "text/csv",
      help: "Each picture name the shown rows use, with its tuning and held-out row counts. Names and counts only.",
      build: (ctx) => {
        const pictures = new Map();
        for (const item of ctx.shown()) {
          if (!item.image) continue;
          if (!pictures.has(item.image)) pictures.set(item.image, [0, 0]);
          pictures.get(item.image)[item.test ? 1 : 0] += 1;
        }
        return csvText([["picture", "tuning rows", "held-out rows"], ...[...pictures].map(([name, [tuning, held]]) => [name, String(tuning), String(held)])]);
      } },
    { id: "label_distribution", kind: "exporter", label: "Label counts per question as CSV", filename: "bulk-label-counts.csv", mime: "text/csv",
      help: "For each question, each label value as written on the shown tuning rows and how many rows carry it. Held-out rows are left out entirely.",
      build: (ctx) => {
        const counts = new Map();
        for (const item of tuningShown(ctx)) {
          for (const [id, value] of Object.entries(item.labels || {})) {
            if (!counts.has(id)) counts.set(id, new Map());
            const cell = cellOf(value);
            counts.get(id).set(cell, (counts.get(id).get(cell) || 0) + 1);
          }
        }
        const order = [...Object.keys(questionsOf(ctx)).filter((id) => counts.has(id)), ...[...counts.keys()].filter((id) => !has(questionsOf(ctx), id))];
        return csvText([["question", "label", "rows"], ...order.flatMap((id) => [...counts.get(id)].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
          .map(([label, rows]) => [id, label, String(rows)]))]);
      } },
  ],
});

