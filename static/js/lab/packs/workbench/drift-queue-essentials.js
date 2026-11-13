// Starter pack for drift's "Label new traffic" queue ("workbench.drift.queue"; contract in
// static/js/lab/surfaces/workbench-checks.js): labeling-progress and input-shape facts, two advisory checks, two
// explicit label edits, progress metrics, two exports and two commands. This queue is a targeted sample, not a random
// audit: nothing here measures accuracy, and there are no model answers to show. Labels change only to values the user
// types into an edit's parameters.
import { csvText, definePack } from "../../kit.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const textOf = (item) => (isObject(item?.row) && typeof item.row.text === "string" ? item.row.text : null);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The queue question an edit names, or an Error the person can act on.
function questionOf(ctx, id) {
  const question = (ctx?.data?.questions || []).find((entry) => entry.id === String(id ?? "").trim());
  if (!question) throw new Error(`“${String(id ?? "").trim()}” is not a question of this queue (${(ctx?.data?.questions || []).map((entry) => entry.id).join(", ")}).`);
  return question;
}

const QUESTION_PARAM = { name: "question", label: "Question id", type: "text", required: true, placeholder: "topic" };

export default definePack({
  id: "drift-queue-essentials",
  surface: "workbench.drift.queue",
  title: "New traffic labeling essentials",
  about: "Labeling-progress and input-shape facts, advisory checks, explicit fill and clear edits for your own labels, progress metrics, input and progress exports, and navigation for drift's Label new traffic queue. It is a targeted sample: nothing here measures accuracy or shows model answers.",
  features: [
    { id: "labels_chosen", kind: "fact", type: "number", label: "labels chosen", unit: "labels", value: (item) => (Array.isArray(item?.labeled) ? item.labeled.length : null) },
    { id: "required_missing", kind: "fact", type: "number", label: "required labels missing", unit: "labels", help: "Gated questions still without a label; Add needs none missing.",
      value: (item) => (Array.isArray(item?.missing) ? item.missing.length : null) },
    { id: "input_characters", kind: "fact", type: "number", label: "input text characters", unit: "characters", help: "Unknown for rows without a text field.",
      value: (item) => { const text = textOf(item); return text === null ? null : [...text].length; } },
    { id: "input_fields", kind: "fact", type: "number", label: "input fields", unit: "fields", help: "Top-level fields of the row, not counting the picture name.",
      value: (item) => (isObject(item?.row) ? Object.keys(item.row).filter((key) => key !== "_image").length : null) },
    { id: "has_picture", kind: "fact", type: "flag", label: "a picture", value: (item) => typeof item?.image === "string" },
    { id: "picture_not_loaded", kind: "fact", type: "flag", label: "a picture this page has not loaded", value: (item) => typeof item?.image === "string" && item.picture_loaded !== true },
    { id: "will_add", kind: "fact", type: "flag", label: "a place in the next Add", help: "Ready, and within the room the dataset has left.", value: (item) => item?.will_add === true },
    { id: "status", kind: "fact", type: "category", label: "labeling status", value: (item) => (item?.status === "ready" || item?.status === "incomplete" ? item.status : null) },
    { id: "input_text", kind: "fact", type: "text", label: "input text", value: (item) => textOf(item) },

    { id: "blank_text", kind: "diagnostic", severity: "advice", label: "Blank input text",
      check: (item) => (textOf(item) !== null && !textOf(item).trim() ? "The input text is blank; label it from its other fields or picture." : null) },
    { id: "partly_labeled", kind: "diagnostic", severity: "advice", label: "Partly labeled",
      check: (item) => {
        const missing = list(item?.missing);
        return list(item?.labeled).length && item.ready !== true && missing.length
          ? `${missing.join(", ")} still ${missing.length === 1 ? "needs" : "need"} a label, so Add skips this row.` : null;
      } },

    { id: "fill_blank_label", kind: "transform", label: "Set a label you choose where it is blank",
      help: "On the shown rows only, and only where the question has no label yet. You choose the label; nothing is inferred.",
      params: [QUESTION_PARAM, { name: "label", label: "Label (option text: yes, no, 0, 1, a choice key)", type: "text", required: true }],
      each: (item, params, ctx) => {
        const question = questionOf(ctx, params.question);
        const option = question.options.find((entry) => entry.text === params.label.trim());
        if (!option) throw new Error(`“${params.label.trim()}” is not an option of ${question.id} (${question.options.map((entry) => entry.text).join(", ")}).`);
        if (!isObject(item.labels) || (item.labels[question.id] !== null && item.labels[question.id] !== undefined)) return null;
        return { ...item, labels: { ...item.labels, [question.id]: option.value } };
      } },
    { id: "clear_question", kind: "transform", label: "Clear one question's labels", help: "On the shown rows only.",
      params: [QUESTION_PARAM],
      each: (item, params, ctx) => {
        const question = questionOf(ctx, params.question);
        if (!isObject(item.labels) || item.labels[question.id] === null || item.labels[question.id] === undefined) return null;
        return { ...item, labels: { ...item.labels, [question.id]: null } };
      } },

    { id: "ready_share", kind: "metric", format: "percent", label: "Queued rows ready to add",
      compute: (ctx) => {
        const items = ctx.items();
        if (!items.length) return null;
        const ready = items.filter((item) => item.ready).length;
        return { value: ready / items.length, detail: `${ready} of ${plural(items.length, "queued row")}` };
      } },
    { id: "labels_total", kind: "metric", format: "integer", label: "Labels you chose", help: "Across the whole queue, shown or not.",
      compute: (ctx) => (ctx.data.present ? ctx.data.labels : null) },
    { id: "ready_over_room", kind: "metric", format: "integer", label: "Ready rows past the room left",
      help: "They stay in the queue with their labels after Add.",
      compute: (ctx) => (ctx.data.present ? Math.max(0, ctx.data.ready - ctx.data.room) : null) },

    { id: "inputs_jsonl", kind: "exporter", label: "Shown inputs as JSON lines (no labels)", filename: "jev-new-traffic-inputs.jsonl", mime: "application/x-ndjson",
      help: "One row per line, as the queue shows it. Pictures by name only; no labels.",
      build: (ctx) => ctx.shown().map((item) => JSON.stringify(item.row)).join("\n") + (ctx.shown().length ? "\n" : "") },
    { id: "progress_csv", kind: "exporter", label: "Shown rows' labeling progress as CSV (no inputs or labels)", filename: "jev-new-traffic-progress.csv", mime: "text/csv",
      help: "New row number, status, labels chosen and the required questions still missing.",
      build: (ctx) => csvText([["new_row", "status", "labels_chosen", "required_missing"],
        ...ctx.shown().map((item) => [item.line, item.status, item.labeled.length, item.missing.join(" ")])]) },

    { id: "go_first_incomplete", kind: "command", title: "Go to the first shown new row that still needs a label", group: "New traffic",
      when: (ctx) => ctx.shown().some((item) => !item.ready),
      run: (ctx) => {
        const item = ctx.shown().find((entry) => !entry.ready);
        if (!item) throw new Error("Every shown new row is ready.");
        return ctx.actions.goTo(item.line);
      } },
    { id: "open_labels", kind: "command", title: "Open Label new traffic", group: "New traffic",
      when: (ctx) => ctx.data.present && !ctx.data.open && !ctx.data.busy,
      run: (ctx) => ctx.actions.openLabels(true) },
  ],
});
