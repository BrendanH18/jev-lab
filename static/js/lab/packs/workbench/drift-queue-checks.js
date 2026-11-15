// Advisory checks and counts for drift's "Label new traffic" queue ("workbench.drift.queue"; contract in
// static/js/lab/surfaces/workbench-checks.js): rows that will not be added, pictures you cannot see, inputs worth a
// second look before labeling, and queue-wide problems (no room, nothing ready, a required question nobody labeled),
// with metrics that count labeling work and the rows the comparison left out of the queue. This queue is a targeted
// sample: nothing here computes accuracy or estimates anything about new traffic, and there are no model answers.
import { definePack } from "../../kit.js";
import { median } from "../../lib/math.js";
import { codePoints, findEmails, findUrls, hasControlCharacters, hasEdgeWhitespace } from "../../lib/text.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const textOf = (item) => (isObject(item?.row) && typeof item.row.text === "string" ? item.row.text : null);
const fieldsOf = (item) => (isObject(item?.row) ? Object.keys(item.row).filter((key) => key !== "_image") : []);
const dataOf = (ctx) => (isObject(ctx?.data) ? ctx.data : {});
const questionsOf = (ctx) => list(dataOf(ctx).questions).filter((question) => isObject(question) && typeof question.id === "string");
const itemsOf = (ctx) => { try { return list(ctx?.items?.()); } catch { return []; } };
const name = (item) => `new row ${item?.line ?? "?"}`;
const LONG_TEXT = 2000;
// Metrics are unavailable until a comparison (or a restored draft) has filled a queue.
const present = (ctx) => dataOf(ctx).present === true;

export default definePack({
  id: "drift-queue-checks",
  surface: "workbench.drift.queue",
  title: "New traffic queue checks",
  about: "Advisory checks for drift's Label new traffic queue (ready rows with no room, rows not started, pictures not loaded, inputs that share a text, hold addresses, odd spacing, control characters, very long text, no text field or nested fields; no room, nothing ready, mixed fields, a required question nobody labeled, a restored draft, rows already added) and metrics that count labeling work and the rows the comparison did not queue. No accuracy, no answers.",
  features: [
    { id: "ready_no_room", kind: "diagnostic", severity: "advice", label: "Ready but no room in the next Add",
      check: (item) => (item?.ready === true && item.will_add !== true
        ? "Every required label is set, but the dataset has no room left for it in the next Add; it stays queued with your labels." : null) },
    { id: "not_started", kind: "diagnostic", severity: "info", label: "Not started",
      check: (item) => (Array.isArray(item?.labeled) && item.labeled.length === 0 ? "No label yet." : null) },
    { id: "picture_not_loaded", kind: "diagnostic", severity: "advice", label: "Picture not loaded",
      check: (item) => (typeof item?.image === "string" && item.picture_loaded !== true
        ? `This page has not loaded the picture “${item.image}”, so you see only its name. Load it before labeling from the picture.` : null) },
    { id: "shares_text", kind: "diagnostic", severity: "info", label: "Same text as another queued row",
      check: (item, ctx) => {
        const text = textOf(item);
        if (text === null || !text.trim()) return null;
        const others = itemsOf(ctx).filter((other) => other?.line !== item.line && textOf(other) === text);
        return others.length ? `${others.map(name).join(", ")} ${others.length === 1 ? "has" : "have"} the same text with other fields; label each from its own fields.` : null;
      } },
    { id: "contact_details", kind: "diagnostic", severity: "advice", label: "Web or email address in the input",
      check: (item) => {
        const text = textOf(item);
        if (text === null) return null;
        const found = findEmails(text).length + findUrls(text).length;
        return found ? `The text holds ${plural(found, "web or email address", "web or email addresses")}; check what you copy or download before sharing it.` : null;
      } },
    { id: "edge_spaces", kind: "diagnostic", severity: "info", label: "Spaces at the start or end of the text",
      check: (item) => (hasEdgeWhitespace(textOf(item) ?? "") ? "The text starts or ends with spaces or line breaks; the dataset keeps them as they are." : null) },
    { id: "control_characters", kind: "diagnostic", severity: "advice", label: "Control characters in the text",
      check: (item) => (hasControlCharacters(textOf(item) ?? "") ? "The text holds invisible control characters, which often come from a broken export." : null) },
    { id: "long_text", kind: "diagnostic", severity: "info", label: "Text over 2,000 characters",
      check: (item) => { const text = textOf(item); return text !== null && codePoints(text) > LONG_TEXT ? `The text is ${codePoints(text).toLocaleString("en-US")} characters long; read it to the end before labeling.` : null; } },
    { id: "no_text_field", kind: "diagnostic", severity: "info", label: "No text field",
      check: (item) => (isObject(item?.row) && textOf(item) === null
        ? `The input has no text field; label it from ${fieldsOf(item).length ? fieldsOf(item).join(", ") : "its picture"}${fieldsOf(item).length && item.image ? " and its picture" : ""}.` : null) },
    { id: "nested_fields", kind: "diagnostic", severity: "info", label: "Fields holding objects or lists",
      check: (item) => {
        const nested = fieldsOf(item).filter((key) => item.row[key] !== null && typeof item.row[key] === "object");
        return nested.length ? `${nested.join(", ")} ${nested.length === 1 ? "holds" : "hold"} an object or a list; open the row to read ${nested.length === 1 ? "it" : "them"} in full.` : null;
      } },

    { id: "no_room", kind: "diagnostic", scope: "list", severity: "problem", label: "No room left in the dataset",
      check: (items, ctx) => (present(ctx) && items.length && dataOf(ctx).room === 0
        ? "The dataset has no room left (200 rows at most), so Add takes none of these rows. Make room in the dataset first." : null) },
    { id: "nothing_ready", kind: "diagnostic", scope: "list", severity: "advice", label: "No queued row is ready",
      check: (items) => (items.length && !items.some((item) => item?.ready === true)
        ? `None of the ${plural(items.length, "row")} has every required label yet, so Add has nothing to take.` : null) },
    { id: "restored_draft", kind: "diagnostic", scope: "list", severity: "info", label: "Queue restored from a draft",
      check: (items, ctx) => (present(ctx) && dataOf(ctx).recovered === true
        ? "This queue came from a restored traffic labeling draft, so there are no comparison counts. Comparing again is a separate, paid run." : null) },
    { id: "mixed_fields", kind: "diagnostic", scope: "list", severity: "info", label: "Rows with different fields",
      check: (items) => {
        const sets = new Map();
        for (const item of items) { const key = [...fieldsOf(item)].sort().join(", "); sets.set(key, (sets.get(key) || 0) + 1); }
        return sets.size > 1 ? `The rows have ${sets.size} different sets of fields: ${[...sets].map(([key, count]) => `${key || "no fields"} (${count})`).join("; ")}.` : null;
      } },
    { id: "required_never_labeled", kind: "diagnostic", scope: "list", severity: "advice", label: "A required question no row has a label for",
      check: (items, ctx) => {
        if (!items.length) return null;
        const missing = questionsOf(ctx).filter((question) => question.gated && !items.some((item) => isObject(item?.labels) && has(item.labels[question.id])));
        return missing.length ? `${missing.map((question) => question.id).join(", ")} ${missing.length === 1 ? "has" : "have"} no label on any of these rows yet, and Add needs ${missing.length === 1 ? "it" : "them"} on every row.` : null;
      } },
    { id: "rows_added", kind: "diagnostic", scope: "list", severity: "info", label: "Rows already added from this queue",
      check: (items, ctx) => {
        const added = dataOf(ctx).saved?.added;
        return Number.isInteger(added) && added > 0
          ? `${plural(added, "row")} from this queue ${added === 1 ? "is" : "are"} in the dataset now. Rerunning the check to measure with ${added === 1 ? "it" : "them"} is a separate, paid run.` : null;
      } },

    { id: "queued_rows", kind: "metric", format: "integer", label: "Rows in the queue", compute: (ctx) => (present(ctx) ? itemsOf(ctx).length : null) },
    { id: "required_labels_missing", kind: "metric", format: "integer", label: "Required labels still missing",
      help: "Across the whole queue: gated questions without a label, summed over rows.",
      compute: (ctx) => (present(ctx) ? itemsOf(ctx).reduce((sum, item) => sum + list(item.missing).length, 0) : null) },
    { id: "optional_blank", kind: "metric", format: "integer", label: "Optional labels left blank",
      compute: (ctx) => {
        if (!present(ctx)) return null;
        const optional = questionsOf(ctx).filter((question) => !question.gated);
        return itemsOf(ctx).reduce((sum, item) => sum + optional.filter((question) => !(isObject(item.labels) && has(item.labels[question.id]))).length, 0);
      } },
    { id: "rows_not_started", kind: "metric", format: "integer", label: "Rows not started", compute: (ctx) => (present(ctx) ? itemsOf(ctx).filter((item) => list(item.labeled).length === 0).length : null) },
    { id: "rows_with_pictures", kind: "metric", format: "integer", label: "Rows with a picture",
      compute: (ctx) => {
        if (!present(ctx)) return null;
        const pictured = itemsOf(ctx).filter((item) => typeof item.image === "string");
        const missing = pictured.filter((item) => item.picture_loaded !== true).length;
        return { value: pictured.length, detail: `${missing} not loaded` };
      } },
    { id: "median_text_length", kind: "metric", format: "number", label: "Median text length in characters",
      help: "Over rows with a text field.",
      compute: (ctx) => {
        if (!present(ctx)) return null;
        const lengths = itemsOf(ctx).map(textOf).filter((text) => text !== null).map(codePoints);
        return lengths.length ? { value: median(lengths), detail: plural(lengths.length, "row") } : null;
      } },
    { id: "distinct_texts", kind: "metric", format: "integer", label: "Different texts in the queue",
      compute: (ctx) => {
        if (!present(ctx)) return null;
        const texts = itemsOf(ctx).map(textOf).filter((text) => text !== null);
        return texts.length ? { value: new Set(texts).size, detail: `among ${plural(texts.length, "row")} with text` } : null;
      } },
    { id: "least_labeled_required", kind: "metric", format: "integer", label: "Rows labeled on the least-labeled required question",
      help: "The gated question with the fewest labels across the queue, and on how many rows it has one.",
      compute: (ctx) => {
        if (!present(ctx)) return null;
        const items = itemsOf(ctx);
        const gated = questionsOf(ctx).filter((question) => question.gated);
        if (!items.length || !gated.length) return null;
        const counts = gated.map((question) => [question.id, items.filter((item) => isObject(item.labels) && has(item.labels[question.id])).length]);
        const [qid, fewest] = counts.reduce((low, entry) => (entry[1] < low[1] ? entry : low));
        return { value: fewest, detail: `${qid} (${fewest} of ${plural(items.length, "row")})` };
      } },
    { id: "skipped_in_dataset", kind: "metric", format: "integer", label: "New rows not queued: already in the dataset",
      compute: (ctx) => (present(ctx) && dataOf(ctx).recovered !== true ? dataOf(ctx).counts?.in_dataset ?? null : null) },
    { id: "skipped_repeated", kind: "metric", format: "integer", label: "New rows not queued: repeated inputs",
      compute: (ctx) => (present(ctx) && dataOf(ctx).recovered !== true ? dataOf(ctx).counts?.repeated ?? null : null) },
    { id: "skipped_unsupported", kind: "metric", format: "integer", label: "New rows not queued: arrays or unsupported rows",
      compute: (ctx) => (present(ctx) && dataOf(ctx).recovered !== true ? dataOf(ctx).counts?.unsupported ?? null : null) },
    { id: "rows_added_count", kind: "metric", format: "integer", label: "Rows added from this queue this session",
      compute: (ctx) => {
        const saved = dataOf(ctx).saved;
        return isObject(saved) && Number.isInteger(saved.added) ? { value: saved.added, detail: `${saved.already || 0} already in the dataset` } : null;
      } },
  ],
});
