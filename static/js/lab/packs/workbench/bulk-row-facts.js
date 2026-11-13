// Row facts and checks for the Bulk rows box (surface workbench.bulk.rows; contract in
// static/js/lab/surfaces/workbench-bulk.js): input shape and size, fields present, label coverage per row, pictures and
// copies by identity. Everything is local and read-only. Label facts use the question ids a row labels (also known on
// held-out rows), never a held-out row's label values.
import { compareText, definePack } from "../../kit.js";
import { byteSize, depth } from "../../lib/json.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const listOf = (values) => values.join(", ");

// The input as the model reads it: a text row is { text }.
const stateOf = (item) => (typeof item?.input === "string" ? { text: item.input } : item?.input);

// Stable JSON with sorted keys, so field order does not matter.
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

// What identifies a row: its input as the model reads it and its picture name. Labels and the held-out marker are not
// part of it (the identity dataset health and Review use).
const identity = (item) => canon([stateOf(item) ?? null, item?.image ?? null]);

// The same, with every string lower-cased and its whitespace collapsed, for copies that differ only in case or spacing.
function loose(value) {
  if (typeof value === "string") return value.toLowerCase().replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(loose);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, loose(entry)]));
  return value;
}
const looseIdentity = (item) => canon([loose(stateOf(item) ?? null), item?.image ?? null]);

// Question ids with a label on the row: the surface's ids (held-out rows too), or the keys of a copy's labels.
const labeledIds = (item) => (Array.isArray(item?.labeled) ? item.labeled : isObject(item?.labels) ? Object.keys(item.labels) : []);
const selectedIds = (ctx) => Object.keys(ctx?.data?.questions || {});
const allItems = (ctx) => (typeof ctx?.items === "function" ? ctx.items() : []);
const rowName = (item, fallback) => (Number.isInteger(item?.position) ? item.position : fallback);
// The text the model reads: a text row's input, or an object input's string "text" field.
const textOf = (item) => (typeof item?.input === "string" ? item.input : isObject(item?.input) && typeof item.input.text === "string" ? item.input.text : null);

// One pass over the box for the facts that compare rows: identities, copies, pictures and texts. Cached per items()
// list, which the surface keeps frozen and identical until the box changes.
const indexes = new WeakMap();
function boxIndex(ctx) {
  const rows = allItems(ctx);
  const known = Array.isArray(rows) ? indexes.get(rows) : undefined;
  if (known) return known;
  const index = { position: new Map(), key: new Map(), copies: new Map(), pictures: new Map(), texts: new Map(), groups: new Map() };
  (Array.isArray(rows) ? rows : []).forEach((row, at) => {
    const key = identity(row);
    index.position.set(row, at);
    index.key.set(row, key);
    if (!index.copies.has(key)) index.copies.set(key, []);
    index.copies.get(key).push(at);
    if (typeof row?.image === "string" && row.image) index.pictures.set(row.image, (index.pictures.get(row.image) || 0) + 1);
    const text = textOf(row)?.trim();
    if (text) {
      if (!index.texts.has(text)) index.texts.set(text, new Set());
      index.texts.get(text).add(key);
    }
  });
  index.rows = Array.isArray(rows) ? rows : [];
  if (Array.isArray(rows) && Object.isFrozen(rows)) indexes.set(rows, index);
  return index;
}

const isEmptyValue = (value) => value === null || (typeof value === "string" && value.trim() === "")
  || (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length);

export default definePack({
  id: "bulk-row-facts",
  surface: "workbench.bulk.rows",
  title: "Row shape and coverage",
  about: "Row facts and checks for the Bulk rows box: input size and shape, fields present, label coverage of the selected questions, pictures and copies of the same input. Label facts use question ids only, never a held-out row's label values.",
  features: [
    // ---------- numbers ----------
    { id: "row_number", kind: "fact", type: "number", label: "row number", help: "The row's number among nonempty rows, as health and preflight print it.",
      value: (item) => (Number.isInteger(item?.position) ? item.position : null) },
    { id: "input_bytes", kind: "fact", type: "number", label: "input size in bytes", unit: "bytes",
      help: "UTF-8 bytes of the input as compact JSON, as the model reads it (a text row is {\"text\": …}). The picture is not counted.",
      value: (item) => (stateOf(item) === undefined ? null : byteSize(stateOf(item))) },
    { id: "field_count", kind: "fact", type: "number", label: "input field count", help: "Top-level input fields; 1 for a text row; unavailable for array and value rows.",
      value: (item) => (typeof item?.input === "string" ? 1 : isObject(item?.input) ? Object.keys(item.input).length : null) },
    { id: "nesting_depth", kind: "fact", type: "number", label: "input nesting depth", help: "How deeply the input's objects and lists nest: 1 for flat fields, 2 for a field holding an object or list, and so on.",
      value: (item) => (stateOf(item) === undefined ? null : depth(stateOf(item))) },
    { id: "empty_fields", kind: "fact", type: "number", label: "empty input fields", help: "Top-level input fields that are null, blank text, [] or {}. Unavailable for array and value rows.",
      value: (item) => {
        const state = stateOf(item);
        return isObject(state) ? Object.values(state).filter(isEmptyValue).length : null;
      } },
    { id: "missing_selected", kind: "fact", type: "number", label: "missing selected labels",
      help: "Selected questions the row has no label for (ids only, also on held-out rows). Unavailable when no questions are selected.",
      value: (item, ctx) => {
        const ids = selectedIds(ctx);
        if (!ids.length) return null;
        const have = new Set(labeledIds(item));
        return ids.filter((id) => !have.has(id)).length;
      } },
    { id: "same_input_rows", kind: "fact", type: "number", label: "rows with the same input",
      help: "Rows in the box with the same input and picture, this one included (1 when it is unique). Labels and the held-out marker are ignored.",
      value: (item, ctx) => boxIndex(ctx).copies.get(identity(item))?.length ?? null },
    { id: "same_picture_rows", kind: "fact", type: "number", label: "rows with the same picture",
      help: "Rows in the box that name the same picture, this one included; unavailable without a picture.",
      value: (item, ctx) => {
        if (typeof item?.image !== "string" || !item.image) return null;
        return boxIndex(ctx).pictures.get(item.image) ?? null;
      } },

    // ---------- flags ----------
    { id: "repeats_earlier", kind: "fact", type: "flag", label: "repeat of an earlier row",
      help: "An earlier row in the box has the same input and picture.",
      value: (item, ctx) => {
        const index = boxIndex(ctx);
        const at = index.position.get(item);
        return at !== undefined && index.copies.get(index.key.get(item))[0] < at;
      } },
    { id: "same_text_elsewhere", kind: "fact", type: "flag", label: "same text with other fields or picture",
      help: "Another row has the same text but a different input or picture (another channel, another photo).",
      value: (item, ctx) => {
        const text = textOf(item)?.trim();
        if (!text) return false;
        const index = boxIndex(ctx);
        return index.position.has(item) && (index.texts.get(text)?.size ?? 0) > 1;
      } },
    { id: "nested_object", kind: "fact", type: "flag", label: "field holding an object",
      value: (item) => isObject(item?.input) && Object.values(item.input).some(isObject) },
    { id: "list_field", kind: "fact", type: "flag", label: "field holding a list",
      value: (item) => isObject(item?.input) && Object.values(item.input).some(Array.isArray) },

    // ---------- text ----------
    { id: "input_json", kind: "fact", type: "text", label: "input JSON",
      help: "The input as compact JSON (a text row is {\"text\": …}), so a filter can search every field's values.",
      value: (item) => (stateOf(item) === undefined ? "" : JSON.stringify(stateOf(item)) ?? "") },
    { id: "labeled_ids", kind: "fact", type: "text", label: "labeled question ids",
      help: "The question ids the row has a label for, in written order. Ids only: held-out rows show which questions they label, never the values.",
      value: (item) => listOf(labeledIds(item)) },

    // ---------- categories ----------
    { id: "field_set", kind: "fact", type: "category", label: "input field set",
      help: "The input's top-level field names, sorted; \"text\" for a text row. Unavailable for array and value rows.",
      value: (item) => {
        const state = stateOf(item);
        if (!isObject(state)) return null;
        const names = Object.keys(state).sort(compareText);
        return names.length ? listOf(names) : "(no fields)";
      } },
    { id: "picture_name", kind: "fact", type: "category", label: "picture name",
      value: (item) => (typeof item?.image === "string" && item.image ? item.image : null) },
    { id: "label_coverage", kind: "fact", type: "category", label: "label coverage of selected questions",
      help: "none, partial or complete: which selected questions the row labels (ids only). Unavailable when no questions are selected.",
      value: (item, ctx) => {
        const ids = selectedIds(ctx);
        if (!ids.length) return null;
        const have = new Set(labeledIds(item));
        const count = ids.filter((id) => have.has(id)).length;
        return count === 0 ? "none" : count === ids.length ? "complete" : "partial";
      } },

    // ---------- row checks ----------
    { id: "underscore_field", kind: "diagnostic", severity: "advice", label: "Input field named with an underscore",
      check: (item) => {
        if (!isObject(item?.input)) return null;
        const names = Object.keys(item.input).filter((name) => name.startsWith("_"));
        return names.length ? `${listOf(names)} ${names.length === 1 ? "starts" : "start"} with an underscore but ${names.length === 1 ? "is" : "are"} not _expect, _image or _test, so the model reads ${names.length === 1 ? "it" : "them"} as input. Check for a misspelled marker.` : null;
      } },
    { id: "field_name_spaces", kind: "diagnostic", severity: "advice", label: "Field name with spaces at its ends",
      check: (item) => {
        if (!isObject(item?.input)) return null;
        const names = Object.keys(item.input).filter((name) => name !== name.trim());
        return names.length ? `Field ${names.map((name) => JSON.stringify(name)).join(", ")} has spaces at its ends; questions that name "${names[0].trim()}" will not find it.` : null;
      } },
    { id: "text_not_string", kind: "diagnostic", severity: "advice", label: "Text field that is not text",
      check: (item) => {
        if (!isObject(item?.input) || !Object.prototype.hasOwnProperty.call(item.input, "text") || typeof item.input.text === "string") return null;
        const value = item.input.text;
        const type = value === null ? "null" : Array.isArray(value) ? "a list" : typeof value === "object" ? "an object" : `a ${typeof value}`;
        return `The text field holds ${type}, so the row is not read as a text message.`;
      } },
    { id: "bare_value_row", kind: "diagnostic", severity: "info", label: "Row that cannot carry labels",
      check: (item) => (Array.isArray(item?.input) ? "This row is a JSON array, so it cannot carry labels or a picture. Wrap it in an object to label it."
        : typeof item?.input === "number" || typeof item?.input === "boolean" ? `This row is a bare ${typeof item.input}, so it cannot carry labels or a picture. Wrap it in an object to label it.` : null) },
    { id: "box_label_without_picture", kind: "diagnostic", severity: "problem", label: "Box label on a row without a picture",
      check: (item, ctx) => {
        const questions = ctx?.data?.questions || {};
        if (item?.image) return null;
        const boxes = labeledIds(item).filter((id) => questions[id]?.type === "box");
        return boxes.length ? `Has a label for Box question${boxes.length === 1 ? "" : "s"} ${listOf(boxes)} but no picture, so ${boxes.length === 1 ? "that label" : "those labels"} can never be scored.` : null;
      } },
    { id: "unlabeled_copy", kind: "diagnostic", severity: "advice", label: "Copy missing labels its twin has",
      help: "Tuning rows only; names question ids, never label values.",
      check: (item, ctx) => {
        if (!item || item.test) return null;
        const index = boxIndex(ctx);
        const mine = new Set(labeledIds(item));
        for (const at of index.copies.get(identity(item)) || []) {
          const other = index.rows[at];
          if (other === item || other.test) continue;
          const extra = labeledIds(other).filter((id) => !mine.has(id));
          if (extra.length) return `Same input as row ${rowName(other, "?")}, which has labels for ${listOf(extra)} that this row lacks.`;
        }
        return null;
      } },

    // ---------- list checks ----------
    { id: "field_case_variants", kind: "diagnostic", severity: "advice", scope: "list", label: "Field names that differ only in case",
      check: (items) => {
        const byLower = new Map();
        items.forEach((item, index) => {
          if (!isObject(item?.input)) return;
          for (const name of Object.keys(item.input)) {
            const key = name.trim().toLowerCase();
            if (!byLower.has(key)) byLower.set(key, new Map());
            const spellings = byLower.get(key);
            if (!spellings.has(name)) spellings.set(name, []);
            spellings.get(name).push(rowName(item, index + 1));
          }
        });
        return [...byLower.values()].filter((spellings) => spellings.size > 1).map((spellings) => `Fields ${[...spellings].map(([name, rows]) => `${JSON.stringify(name)} (${rows.length === 1 ? "row" : "rows"} ${listOf(rows)})`).join(" and ")} differ only in letter case or spacing, so questions see them as different fields.`);
      } },
    { id: "odd_field_set", kind: "diagnostic", severity: "advice", scope: "list", label: "Object rows with unusual fields",
      help: "Compares each object row's field names with the field set that more than half of the object rows share; quiet when no set has a majority.",
      check: (items) => {
        const rows = items.map((item, index) => ({ item, index })).filter(({ item }) => isObject(item?.input));
        if (rows.length < 3) return null;
        const counts = new Map();
        for (const { item } of rows) {
          const key = JSON.stringify(Object.keys(item.input).sort());
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const [best, bestCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
        const tied = [...counts.values()].filter((count) => count === bestCount).length > 1;
        if (bestCount < 2 || tied || bestCount * 2 <= rows.length) return null;
        const common = JSON.parse(best);
        return rows.filter(({ item }) => JSON.stringify(Object.keys(item.input).sort()) !== best).map(({ item, index }) => {
          const names = Object.keys(item.input);
          const missing = common.filter((name) => !names.includes(name));
          const extra = names.filter((name) => !common.includes(name)).sort(compareText);
          const parts = [missing.length ? `lacks ${listOf(missing)}` : "", extra.length ? `adds ${listOf(extra)}` : ""].filter(Boolean);
          return `Row ${rowName(item, index + 1)} ${parts.join(" and ")}, unlike the ${bestCount} object rows with fields ${listOf(common)}.`;
        });
      } },
    { id: "picture_on_both_sides", kind: "diagnostic", severity: "advice", scope: "list", label: "Picture on tuning and held-out rows",
      help: "Names pictures and row numbers only.",
      check: (items) => {
        const pictures = new Map();
        items.forEach((item, index) => {
          if (typeof item?.image !== "string" || !item.image) return;
          if (!pictures.has(item.image)) pictures.set(item.image, { tuning: [], held: [] });
          pictures.get(item.image)[item.test ? "held" : "tuning"].push(rowName(item, index + 1));
        });
        return [...pictures].filter(([, rows]) => rows.tuning.length && rows.held.length).map(([name, rows]) =>
          `Picture ${name} is on tuning ${rows.tuning.length === 1 ? "row" : "rows"} ${listOf(rows.tuning)} and held-out ${rows.held.length === 1 ? "row" : "rows"} ${listOf(rows.held)}, so the test side is not fully unseen.`);
      } },
    { id: "near_copies", kind: "diagnostic", severity: "advice", scope: "list", label: "Rows that differ only in case or spacing",
      help: "Groups rows whose inputs and pictures match once letter case and runs of spaces are ignored, but not exactly (exact copies are health's duplicates).",
      check: (items) => {
        const groups = new Map();
        items.forEach((item, index) => {
          const key = looseIdentity(item);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push({ row: rowName(item, index + 1), exact: identity(item) });
        });
        return [...groups.values()].filter((group) => new Set(group.map((entry) => entry.exact)).size > 1)
          .map((group) => `Rows ${listOf(group.map((entry) => entry.row))} match once letter case and spacing are ignored, but are not all exact copies (${plural(group.length, "row")}).`);
      } },
  ],
});
