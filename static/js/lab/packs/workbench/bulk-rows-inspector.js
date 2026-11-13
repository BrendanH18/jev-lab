// Rows box inspector: facts, checks, edits, metrics, exports and commands for the Bulk rows box
// (surface workbench.bulk.rows; contract in static/js/lab/surfaces/workbench-bulk.js).
// Everything is local: it reads the parsed rows, never answers, and never shows a held-out row's label values.
import { compareText, csvText, definePack } from "../../kit.js";
import { codePoints, findEmails, wordCount } from "../../lib/text.js";

const textOf = (item) => (typeof item.text === "string" ? item.text : null);
const tuning = (items) => items.filter((item) => !item.test);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const questionIds = (ctx) => Object.keys(ctx?.data?.questions || {});

// A transform's text: a text row's input, or an object input's string "text" field.
function editText(item, change) {
  if (item.test) return null;
  if (typeof item.input === "string") {
    const next = change(item.input);
    return next && next !== item.input ? { ...item, input: next } : null;
  }
  if (item.input && typeof item.input === "object" && !Array.isArray(item.input) && typeof item.input.text === "string") {
    const next = change(item.input.text);
    return next && next !== item.input.text ? { ...item, input: { ...item.input, text: next } } : null;
  }
  return null;
}

const NOUL_WORDS = { yes: true, true: true, 1: true, y: true, no: false, false: false, 0: false, n: false };

// A label as a CSV cell: text as written, true/false, numbers, a Box's edges as JSON.
const labelCell = (value) => (value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));

export default definePack({
  id: "bulk-rows-inspector",
  surface: "workbench.bulk.rows",
  title: "Rows box inspector",
  about: "Filters, checks, previewed edits, counts and exports for the Bulk rows box, computed from the rows as the server reads them. Exports hold inputs or tuning-row labels only, never answers or a held-out row's labels.",
  features: [
    // ---------- facts ----------
    { id: "chars", kind: "fact", type: "number", label: "text length", unit: "characters", help: "Characters of the text the model reads; unavailable for rows without text.",
      value: (item) => (textOf(item) === null ? null : codePoints(textOf(item))) },
    { id: "words", kind: "fact", type: "number", label: "word count", unit: "words",
      value: (item) => (textOf(item) === null ? null : wordCount(textOf(item))) },
    { id: "label_count", kind: "fact", type: "number", label: "label count", help: "Questions with a human label on the row (held-out rows count their ids only).",
      value: (item) => (Array.isArray(item.labeled) ? item.labeled.length : null) },
    { id: "has_picture", kind: "fact", type: "flag", label: "picture", value: (item) => typeof item.image === "string" && item.image !== "" },
    { id: "held_out", kind: "fact", type: "flag", label: "held-out marker", value: (item) => item.test === true },
    { id: "has_problem", kind: "fact", type: "flag", label: "row the server would refuse", value: (item) => typeof item.problem === "string" && item.problem !== "" },
    { id: "unlabeled", kind: "fact", type: "flag", label: "no labels", value: (item) => Array.isArray(item.labeled) && item.labeled.length === 0 },
    { id: "past_cap", kind: "fact", type: "flag", label: "place past the 200-row cap", value: (item) => item.inRun === false },
    { id: "kind", kind: "fact", type: "category", label: "row kind", value: (item) => item.kind ?? null },
    { id: "text", kind: "fact", type: "text", label: "row text", value: (item) => textOf(item) ?? "" },

    // ---------- checks ----------
    { id: "malformed_json", kind: "diagnostic", severity: "problem", label: "Broken JSON line",
      check: (item) => (item.malformed ? "Starts with { but is not a JSON object, so the model reads the whole line as text." : null) },
    { id: "server_problem", kind: "diagnostic", severity: "problem", label: "Row the server would refuse",
      check: (item) => (typeof item.problem === "string" && item.problem ? `A run would stop here: ${item.problem}.` : null) },
    { id: "unknown_label_ids", kind: "diagnostic", severity: "advice", label: "Labels for questions not selected",
      check: (item, ctx) => {
        const ids = questionIds(ctx);
        if (!ids.length || !Array.isArray(item.labeled)) return null;
        const unknown = item.labeled.filter((id) => !ids.includes(id));
        return unknown.length ? `Labels for ${unknown.join(", ")}, which the selected questions do not ask. They are kept but never scored.` : null;
      } },
    { id: "bracket_text", kind: "diagnostic", severity: "advice", label: "Line that looks like a JSON array",
      check: (item) => (item.kind === "text" && item.line !== null && item.line !== undefined && /^\s*\[/.test(textOf(item) || "")
        ? "Starts with [ but a line is always read as text. To send arrays, write the whole box as one JSON array." : null) },
    { id: "email_in_text", kind: "diagnostic", severity: "info", label: "Email address in the text",
      check: (item) => {
        const found = findEmails(textOf(item) || "").length;
        return found ? `Holds ${plural(found, "email address")}. Check that sending it to the model is fine.` : null;
      } },
    { id: "rows_past_cap", kind: "diagnostic", severity: "advice", scope: "list", label: "Rows past the run cap",
      check: (items, ctx) => {
        const past = items.filter((item) => item.inRun === false).length;
        return past ? `${plural(past, "row")} past the ${ctx?.data?.cap ?? 200}-row cap: a run sends the first ${ctx?.data?.cap ?? 200} only. Split the box to run the rest.` : null;
      } },

    // ---------- edits ----------
    { id: "trim_text", kind: "transform", label: "Trim spaces around the text", help: "Shown tuning rows only; held-out rows are never changed.",
      each: (item) => editText(item, (text) => text.trim()) },
    { id: "collapse_spaces", kind: "transform", label: "Collapse runs of spaces and line breaks in the text",
      each: (item) => editText(item, (text) => text.replace(/\s+/g, " ")) },
    { id: "drop_unknown_labels", kind: "transform", label: "Remove labels for questions not selected",
      help: "Keeps every label whose question is selected to run.",
      each: (item, params, ctx) => {
        const ids = questionIds(ctx);
        if (item.test || !ids.length || !item.labels || typeof item.labels !== "object") return null;
        const kept = Object.fromEntries(Object.entries(item.labels).filter(([id]) => ids.includes(id)));
        return Object.keys(kept).length === Object.keys(item.labels).length ? null : { ...item, labels: kept };
      } },
    { id: "normalize_noul_labels", kind: "transform", label: "Write Noul labels as true or false",
      help: "Turns yes/no, y/n, 1/0 and true/false text into true or false for the selected Noul questions. Other text is left as it is.",
      each: (item, params, ctx) => {
        if (item.test || !item.labels || typeof item.labels !== "object") return null;
        const questions = ctx?.data?.questions || {};
        let changed = false;
        const labels = { ...item.labels };
        for (const [id, value] of Object.entries(labels)) {
          if (questions[id]?.type !== "noul" || typeof value !== "string") continue;
          const word = value.trim().toLowerCase();
          if (word in NOUL_WORDS) { labels[id] = NOUL_WORDS[word]; changed = true; }
        }
        return changed ? { ...item, labels } : null;
      } },
    { id: "drop_shown", kind: "transform", label: "Remove the shown tuning rows",
      help: "Filter first, preview, then apply. Held-out rows always stay.",
      all: (items, params, ctx, shown) => items.filter((item, index) => item.test || !shown.has(index)) },
    { id: "sort_by_text", kind: "transform", label: "Sort tuning rows by text, A to Z",
      help: "Held-out rows keep their places; rows without text go after the others.",
      all: (items) => {
        const text = (item) => (typeof item.input === "string" ? item.input : typeof item.input?.text === "string" ? item.input.text : null);
        const slots = items.flatMap((item, index) => (item.test ? [] : [index]));
        const sorted = slots.map((index) => items[index]).map((item, order) => ({ item, order })).sort((a, b) => {
          const ta = text(a.item), tb = text(b.item);
          if (ta === null || tb === null) return ta === tb ? a.order - b.order : ta === null ? 1 : -1;
          return compareText(ta, tb) || a.order - b.order;
        }).map((entry) => entry.item);
        const out = items.slice();
        slots.forEach((slot, order) => { out[slot] = sorted[order]; });
        return out;
      } },

    // ---------- metrics ----------
    { id: "labeled_share", kind: "metric", format: "percent", label: "Shown tuning rows with a label",
      compute: (ctx) => {
        const rows = tuning(ctx.shown());
        return rows.length ? { value: rows.filter((item) => item.labeled.length > 0).length / rows.length, detail: `of ${plural(rows.length, "tuning row")}` } : null;
      } },
    { id: "held_out_share", kind: "metric", format: "percent", label: "Shown rows held out",
      compute: (ctx) => {
        const rows = ctx.shown();
        return rows.length ? { value: rows.filter((item) => item.test).length / rows.length, detail: `of ${plural(rows.length, "row")}` } : null;
      } },
    { id: "picture_rows", kind: "metric", format: "integer", label: "Shown rows with a picture",
      compute: (ctx) => (ctx.shown().length ? ctx.shown().filter((item) => item.image).length : null) },
    { id: "mean_words", kind: "metric", label: "Mean words per shown text",
      compute: (ctx) => {
        const counts = ctx.shown().map(textOf).filter((text) => text !== null).map(wordCount);
        return counts.length ? counts.reduce((total, count) => total + count, 0) / counts.length : null;
      } },

    // ---------- exports ----------
    { id: "shown_inputs_jsonl", kind: "exporter", label: "Shown inputs as JSON Lines", filename: "bulk-inputs.jsonl", mime: "application/x-ndjson",
      help: "Inputs and picture names only: no labels. Held-out rows are left out.",
      build: (ctx) => tuning(ctx.shown()).map((item) => {
        if (typeof item.input === "string") return JSON.stringify({ text: item.input, ...(item.image ? { _image: item.image } : {}) });
        if (item.input && typeof item.input === "object" && !Array.isArray(item.input)) return JSON.stringify({ ...item.input, ...(item.image ? { _image: item.image } : {}) });
        return JSON.stringify(item.input);
      }).map((line) => `${line}\n`).join("") },
    { id: "labels_csv", kind: "exporter", label: "Tuning labels as CSV", filename: "bulk-labels.csv", mime: "text/csv",
      help: "Human labels of the shown tuning rows by row number, one column per question. No inputs; held-out rows are left out.",
      build: (ctx) => {
        const rows = tuning(ctx.shown());
        const ids = [...questionIds(ctx)];
        for (const item of rows) for (const id of Object.keys(item.labels || {})) if (!ids.includes(id)) ids.push(id);
        return csvText([["row", ...ids], ...rows.map((item) => [String(item.position), ...ids.map((id) => labelCell(item.labels?.[id]))])]);
      } },
    { id: "positions", kind: "exporter", label: "Shown row numbers", filename: "bulk-rows.txt", help: "Row numbers only, as health and preflight print them.",
      build: (ctx) => ctx.shown().map((item) => item.position).join(", ") },

    // ---------- commands ----------
    { id: "check_health", kind: "command", title: "Check dataset health of the rows box", group: "Bulk rows",
      run: (ctx) => ctx.actions.checkHealth() },
    { id: "check_inputs", kind: "command", title: "Check Bulk inputs before a run", group: "Bulk rows",
      run: (ctx) => ctx.actions.checkPreflight() },
    { id: "open_csv", kind: "command", title: "Open CSV import", group: "Bulk rows", run: (ctx) => ctx.actions.openCsvImport() },
    { id: "first_problem", kind: "command", title: "Go to the first row that would break a run", group: "Bulk rows",
      when: (ctx) => ctx.shown().some((item) => (item.problem || item.malformed) && item.line !== null),
      run: (ctx) => {
        const item = ctx.shown().find((entry) => (entry.problem || entry.malformed) && entry.line !== null);
        if (!item) return ctx.env?.toast?.("No shown row has a problem.");
        return ctx.actions.focusRow(item.position);
      } },
  ],
});
