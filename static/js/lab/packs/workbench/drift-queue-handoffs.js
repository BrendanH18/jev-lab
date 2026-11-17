// Handoffs, edits and navigation for drift's "Label new traffic" queue ("workbench.drift.queue"; contract in
// static/js/lab/surfaces/workbench-checks.js). Exports say what they hold: inputs with blank label columns, inputs
// with your own labels, inputs alone, picture names, field names and counts, or a to-do list of row numbers and
// question ids. None mimics the page's traffic labeling draft (that file is bound to the saved dataset and check by
// the server), and none holds answers: this queue has none. Edits change only your labels, to a value you choose or
// to blank. Commands scroll, open or close; adding rows and comparing stay the page's own buttons.
import { csvText, definePack } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const textOf = (item) => (isObject(item?.row) && typeof item.row.text === "string" ? item.row.text : null);
const questionsOf = (ctx) =>
  list(ctx?.data?.questions).filter((question) => isObject(question) && typeof question.id === "string");
const shownOf = (ctx) => list(ctx.shown());

// The input fields of the given rows in the order they first appear, without the picture name.
function fieldsOf(items) {
  const seen = [];
  for (const item of items)
    for (const key of Object.keys(isObject(item?.row) ? item.row : {}))
      if (key !== "_image" && !seen.includes(key)) seen.push(key);
  return seen;
}
const cell = (row, key) =>
  !isObject(row) || !Object.hasOwn(row, key)
    ? ""
    : typeof row[key] === "string"
      ? row[key]
      : (stableStringify(row[key]) ?? "");
function labelText(question, value) {
  if (!has(value)) return "";
  const option = list(question?.options).find((entry) => entry?.value === value);
  return option ? String(option.text) : typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}
// Shown rows as CSV: new row number, input fields, picture name, then one label column per queue question.
function inputsCsv(ctx, withLabels) {
  const items = shownOf(ctx),
    fields = fieldsOf(items),
    questions = questionsOf(ctx);
  return csvText([
    ["new_row", ...fields, "picture", ...questions.map((question) => `label_${question.id}`)],
    ...items.map((item) => [
      item.line,
      ...fields.map((key) => cell(item.row, key)),
      item.image || "",
      ...questions.map((question) => (withLabels ? labelText(question, item.labels?.[question.id]) : "")),
    ]),
  ]);
}
function todoLines(ctx) {
  return shownOf(ctx).map((item) =>
    item.ready ? `- [x] new row ${item.line}` : `- [ ] new row ${item.line}: needs ${list(item.missing).join(", ")}`,
  );
}
function questionOf(ctx, id) {
  const question = questionsOf(ctx).find((entry) => entry.id === String(id ?? "").trim());
  if (!question)
    throw new Error(
      `“${String(id ?? "").trim()}” is not a question of this queue (${questionsOf(ctx)
        .map((entry) => entry.id)
        .join(", ")}).`,
    );
  return question;
}
const goFirst = (ctx, match, none) => {
  const item = shownOf(ctx).find(match);
  if (!item) throw new Error(none);
  return ctx.actions.goTo(item.line);
};

export default definePack({
  id: "drift-queue-handoffs",
  surface: "workbench.drift.queue",
  title: "New traffic handoffs and navigation",
  about:
    "Exports of drift's Label new traffic queue that say what they hold (inputs with blank label columns, inputs with your labels, inputs alone, input texts, picture names, field counts, a labeling to-do), edits that set a label you choose or clear labels on the shown rows, and commands to move through the queue. No answers, never the page's draft file, no model calls.",
  features: [
    {
      id: "blank_labels_csv",
      kind: "exporter",
      label: "Shown inputs with blank label columns as CSV (inputs only; label columns left blank)",
      filename: "jev-new-traffic-to-label.csv",
      mime: "text/csv",
      help: "New row number, every input field, the picture name and an empty label_<question> column for each queue question, to label in a spreadsheet. Type the labels back into the queue: it imports nothing.",
      build: (ctx) => inputsCsv(ctx, false),
    },
    {
      id: "labels_csv",
      kind: "exporter",
      label: "Shown inputs and your labels as CSV (holds inputs and your labels)",
      filename: "jev-new-traffic-labels.csv",
      mime: "text/csv",
      help: "As above with the labels you chose (option text: yes, no, 0, 1, a choice key). No answers: this queue has none.",
      build: (ctx) => inputsCsv(ctx, true),
    },
    {
      id: "inputs_markdown",
      kind: "exporter",
      label: "Shown inputs as a Markdown table (inputs only, no labels)",
      filename: "jev-new-traffic-inputs.md",
      mime: "text/markdown",
      build: (ctx) => {
        const items = shownOf(ctx),
          fields = fieldsOf(items);
        if (!items.length) return "No new row is shown.\n";
        return (
          formatMarkdownTable(
            ["New row", ...fields, "Picture"],
            items.map((item) => [item.line, ...fields.map((key) => cell(item.row, key)), item.image || ""]),
          ) + "\n"
        );
      },
    },
    {
      id: "texts_txt",
      kind: "exporter",
      label: "Shown input texts, one per line (inputs only)",
      filename: "jev-new-traffic-texts.txt",
      help: "The text field of each shown row that has one; line breaks inside a text become spaces.",
      build: (ctx) =>
        shownOf(ctx)
          .map(textOf)
          .filter((text) => text !== null)
          .map((text) => `${text.replace(/\r\n|\r|\n/g, " ")}\n`)
          .join(""),
    },
    {
      id: "picture_names",
      kind: "exporter",
      label: "Picture names of the shown rows (names only)",
      filename: "jev-new-traffic-pictures.txt",
      help: "One line per shown row with a picture, saying whether this page has loaded it. The pictures themselves travel separately.",
      build: (ctx) => {
        const pictured = shownOf(ctx).filter((item) => typeof item.image === "string");
        if (!pictured.length) return "# No shown new row has a picture.\n";
        return pictured
          .map((item) => `new row ${item.line}: ${item.image} (${item.picture_loaded ? "loaded" : "not loaded"})\n`)
          .join("");
      },
    },
    {
      id: "field_counts_csv",
      kind: "exporter",
      label: "Input fields of the shown rows as CSV (field names and counts, no values)",
      filename: "jev-new-traffic-fields.csv",
      mime: "text/csv",
      help: "Each top-level field, how many shown rows hold it and the kinds of value it holds (text, number, true/false, object, list, null).",
      build: (ctx) => {
        const items = shownOf(ctx);
        const kind = (value) =>
          value === null
            ? "null"
            : Array.isArray(value)
              ? "list"
              : typeof value === "string"
                ? "text"
                : typeof value === "boolean"
                  ? "true/false"
                  : typeof value;
        return csvText([
          ["field", "rows", "kinds"],
          ...fieldsOf(items).map((key) => {
            const holding = items.filter((item) => Object.hasOwn(item.row, key));
            return [key, holding.length, [...new Set(holding.map((item) => kind(item.row[key])))].join(" ")];
          }),
        ]);
      },
    },
    {
      id: "todo_markdown",
      kind: "exporter",
      label: "Labeling to-do of the shown rows as a Markdown checklist (row numbers and question ids only)",
      filename: "jev-new-traffic-todo.md",
      mime: "text/markdown",
      build: (ctx) => {
        const lines = todoLines(ctx);
        return lines.length ? `${lines.join("\n")}\n` : "No new row is shown.\n";
      },
    },

    {
      id: "set_label_replacing",
      kind: "transform",
      label: "Set a label you choose on the shown rows, replacing any there",
      help: "On the shown rows only. You choose the question and the label; nothing is inferred.",
      params: [
        { name: "question", label: "Question id", type: "text", required: true, placeholder: "urgent" },
        { name: "label", label: "Label (option text: yes, no, 0, 1, a choice key)", type: "text", required: true },
      ],
      each: (item, params, ctx) => {
        const question = questionOf(ctx, params.question);
        const option = question.options.find((entry) => entry.text === params.label.trim());
        if (!option)
          throw new Error(
            `“${params.label.trim()}” is not an option of ${question.id} (${question.options.map((entry) => entry.text).join(", ")}).`,
          );
        if (!isObject(item.labels) || item.labels[question.id] === option.value) return null;
        return { ...item, labels: { ...item.labels, [question.id]: option.value } };
      },
    },
    {
      id: "clear_shown_labels",
      kind: "transform",
      label: "Clear every label on the shown rows",
      help: "On the shown rows only; Undo brings them back.",
      each: (item) =>
        isObject(item.labels) && Object.values(item.labels).some(has)
          ? { ...item, labels: Object.fromEntries(Object.keys(item.labels).map((qid) => [qid, null])) }
          : null,
    },
    {
      id: "clear_optional_labels",
      kind: "transform",
      label: "Clear the optional questions' labels on the shown rows",
      help: "Questions the gate does not read; the required ones stay as they are.",
      each: (item, params, ctx) => {
        const optional = questionsOf(ctx)
          .filter((question) => !question.gated)
          .map((question) => question.id);
        if (!isObject(item.labels) || !optional.some((qid) => has(item.labels[qid]))) return null;
        return {
          ...item,
          labels: {
            ...item.labels,
            ...Object.fromEntries(optional.filter((qid) => qid in item.labels).map((qid) => [qid, null])),
          },
        };
      },
    },

    {
      id: "go_first_shown",
      kind: "command",
      title: "Go to the first shown new row",
      group: "New traffic",
      when: (ctx) => shownOf(ctx).length > 0,
      run: (ctx) => goFirst(ctx, () => true, "No new row is shown."),
    },
    {
      id: "go_last_incomplete",
      kind: "command",
      title: "Go to the last shown new row that still needs a label",
      group: "New traffic",
      when: (ctx) => shownOf(ctx).some((item) => !item.ready),
      run: (ctx) => {
        const item = [...shownOf(ctx)].reverse().find((entry) => !entry.ready);
        if (!item) throw new Error("Every shown new row is ready.");
        return ctx.actions.goTo(item.line);
      },
    },
    {
      id: "go_first_not_started",
      kind: "command",
      title: "Go to the first shown new row with no label yet",
      group: "New traffic",
      when: (ctx) => shownOf(ctx).some((item) => list(item.labeled).length === 0),
      run: (ctx) => goFirst(ctx, (item) => list(item.labeled).length === 0, "Every shown new row has a label."),
    },
    {
      id: "go_first_picture_not_loaded",
      kind: "command",
      title: "Go to the first shown new row whose picture is not loaded",
      group: "New traffic",
      when: (ctx) => shownOf(ctx).some((item) => typeof item.image === "string" && !item.picture_loaded),
      run: (ctx) =>
        goFirst(
          ctx,
          (item) => typeof item.image === "string" && !item.picture_loaded,
          "Every shown picture is loaded.",
        ),
    },
    {
      id: "close_labels",
      kind: "command",
      title: "Close Label new traffic",
      group: "New traffic",
      help: "Presentation only: your labels stay in the queue.",
      when: (ctx) => ctx.data.present && ctx.data.open && !ctx.data.busy,
      run: (ctx) => ctx.actions.openLabels(false),
    },
    {
      id: "copy_todo",
      kind: "command",
      title: "Copy the labeling to-do of the shown new rows",
      group: "New traffic",
      help: "A Markdown checklist of row numbers and the required questions each still needs: no inputs or labels.",
      when: (ctx) => shownOf(ctx).length > 0,
      run: (ctx) => {
        const lines = todoLines(ctx);
        ctx.env.copy(`${lines.join("\n")}\n`);
        const open = shownOf(ctx).filter((item) => !item.ready).length;
        ctx.env.toast?.(`Copied the to-do: ${plural(open, "row")} still ${open === 1 ? "needs" : "need"} labels.`);
      },
    },
  ],
});
