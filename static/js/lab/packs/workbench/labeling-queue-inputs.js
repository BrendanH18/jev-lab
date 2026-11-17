// Inputs and guidelines in the pre-run labeling queue ("workbench.labeling.queue"; contract in
// static/js/lab/surfaces/workbench-labeling.js): facts about each row's input (words, fields, nesting, contact details,
// copies in the slice) and its drafts (share drafted, which questions, the types still missing, blanks a guideline
// covers), checks for drafts that differ from a guideline example with the very same input, metrics, a printable blank
// worksheet and an input-shape CSV. Draft labels stay the user's own: nothing here sets one, and a guideline example is
// only ever pointed out to the person labeling, never turned into a draft. Facts never return guideline text.
import { csvText, definePack } from "../../kit.js";
import { findEmails, findUrls, wordCount } from "../../lib/text.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? list(ctx.items()) : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? list(ctx.shown()) : []);
const draftOf = (item) => (isObject(item?.draft) ? item.draft : {});
const missingOf = (item) => list(item?.missing);
const blankOf = (item) => missingOf(item).filter((qid) => !has(draftOf(item)[qid]));
const guidelinesOf = (ctx) => (isObject(ctx?.data?.guidelines) ? ctx.data.guidelines : null);
const hasRow = (item) => typeof item?.row === "string" || isObject(item?.row);
const draftText = (value) => (value === true ? "yes" : value === false ? "no" : String(value));

// Every string in the input except the picture name, nested values included.
function inputStrings(row) {
  if (typeof row === "string") return [row];
  const out = [];
  const walk = (value) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (isObject(value)) Object.values(value).forEach(walk);
  };
  if (isObject(row)) for (const [key, value] of Object.entries(row)) if (key !== "_image") walk(value);
  return out;
}

// The texts that identify a row as a person reads it, normalized as the guidelines on the page match them: the text of
// a text row; each top-level text field of an object row, and the whole row as JSON (picture name left out).
const norm = (value) => String(value).trim().replace(/\s+/g, " ").toLowerCase();
function rowTexts(row) {
  if (typeof row === "string") return new Set([norm(row)]);
  if (!isObject(row)) return new Set();
  const content = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_image"));
  const out = new Set(
    Object.values(content)
      .filter((value) => typeof value === "string" && value.trim())
      .map(norm),
  );
  out.add(norm(JSON.stringify(content)));
  return out;
}
// [{ question, label }] for the guideline examples (of the row's missing questions) whose input is this row's content.
function matchingExamples(item, ctx) {
  const guidelines = guidelinesOf(ctx);
  if (!guidelines || !hasRow(item)) return [];
  const texts = rowTexts(item.row);
  const out = [];
  for (const qid of missingOf(item)) {
    for (const example of list(guidelines[qid]?.examples)) {
      if (typeof example?.input === "string" && texts.has(norm(example.input)))
        out.push({ question: qid, label: String(example.label) });
    }
  }
  return out;
}
const exampleConflicts = (item, ctx) =>
  matchingExamples(item, ctx).filter(
    (match) => has(draftOf(item)[match.question]) && draftText(draftOf(item)[match.question]) !== match.label,
  );

const identityCache = new WeakMap();
function identityCounts(ctx) {
  const all = itemsOf(ctx);
  let counts = identityCache.get(all);
  if (!counts) {
    counts = new Map();
    for (const item of all)
      if (typeof item?.identity === "string") counts.set(item.identity, (counts.get(item.identity) || 0) + 1);
    identityCache.set(all, counts);
  }
  return counts;
}

const copiesOf = (item, ctx) =>
  typeof item?.identity === "string"
    ? itemsOf(ctx).filter((other) => other.identity === item.identity && other.index !== item.index)
    : [];
const copyConflicts = (item, ctx) =>
  copiesOf(item, ctx).filter((other) =>
    Object.entries(draftOf(item)).some(
      ([qid, value]) => has(draftOf(other)[qid]) && JSON.stringify(draftOf(other)[qid]) !== JSON.stringify(value),
    ),
  );

const typeOrder = ["choice", "noul", "score"];
const shapeOf = (item) => (typeof item?.row === "string" ? "text" : isObject(item?.row) ? "object" : "");
const fieldsOf = (item) =>
  isObject(item?.row) ? Object.keys(item.row).filter((key) => key !== "_image").length : null;

export default definePack({
  id: "labeling-queue-inputs",
  surface: "workbench.labeling.queue",
  title: "Labeling queue: inputs and guideline examples",
  about:
    "Input facts (words, fields, nesting, contact details, copies in the slice) and draft facts (share drafted, which questions, the types still missing, blanks a guideline covers), checks for drafts that differ from a guideline example with the same input, metrics, a printable blank worksheet and an input-shape CSV for the pre-run labeling queue. Nothing sets a draft or turns a guideline example into one.",
  features: [
    {
      id: "input_words",
      kind: "fact",
      type: "number",
      label: "input words",
      unit: "words",
      help: "Words in the input's text values; the picture name is not counted.",
      value: (item) => (hasRow(item) ? wordCount(inputStrings(item.row).join(" ")) : null),
    },
    {
      id: "input_lines",
      kind: "fact",
      type: "number",
      label: "input lines",
      unit: "lines",
      help: "Lines across the input's text values (a value with no line break is one line; blank values count none).",
      value: (item) =>
        hasRow(item)
          ? inputStrings(item.row).reduce((sum, text) => sum + (text === "" ? 0 : text.split(/\r\n|\r|\n/).length), 0)
          : null,
    },
    {
      id: "input_fields",
      kind: "fact",
      type: "number",
      label: "input fields",
      unit: "fields",
      help: "Top-level fields of an object row, the picture name not counted; unknown for a text row.",
      value: (item) => fieldsOf(item),
    },
    {
      id: "copies",
      kind: "fact",
      type: "number",
      label: "rows with this input",
      unit: "rows",
      help: "Queue rows in this slice with the identical input, this one included.",
      value: (item, ctx) =>
        typeof item?.identity === "string" ? identityCounts(ctx).get(item.identity) || null : null,
    },
    {
      id: "draft_share",
      kind: "fact",
      type: "number",
      label: "share of missing labels drafted",
      unit: "0 to 1",
      value: (item) =>
        missingOf(item).length ? (missingOf(item).length - blankOf(item).length) / missingOf(item).length : null,
    },
    {
      id: "guided_blank",
      kind: "fact",
      type: "number",
      label: "blank labels with a guideline",
      unit: "labels",
      help: "Blank questions on this row that have a saved labeling guideline; unknown until the guidelines are loaded.",
      value: (item, ctx) => {
        const guidelines = guidelinesOf(ctx);
        return guidelines && Array.isArray(item?.missing)
          ? blankOf(item).filter((qid) => Object.prototype.hasOwnProperty.call(guidelines, qid)).length
          : null;
      },
    },
    {
      id: "nested_input",
      kind: "fact",
      type: "flag",
      label: "a nested field",
      help: "An object row with an object or list inside it.",
      value: (item) =>
        isObject(item?.row) &&
        Object.entries(item.row).some(
          ([key, value]) => key !== "_image" && value !== null && typeof value === "object",
        ),
    },
    {
      id: "contact_details",
      kind: "fact",
      type: "flag",
      label: "an email address or link in the input",
      value: (item) =>
        hasRow(item) && inputStrings(item.row).some((text) => findEmails(text).length > 0 || findUrls(text).length > 0),
    },
    {
      id: "example_match",
      kind: "fact",
      type: "flag",
      label: "the input of a guideline example",
      help: "A saved guideline example for a question this row misses has this very input. Says nothing about the example's label.",
      value: (item, ctx) => matchingExamples(item, ctx).length > 0,
    },
    {
      id: "copy_draft_conflict",
      kind: "fact",
      type: "flag",
      label: "a copy with a different draft",
      help: "Another row in this slice has the identical input and a different draft for a question both rows drafted.",
      value: (item, ctx) => copyConflicts(item, ctx).length > 0,
    },
    {
      id: "copy_rows",
      kind: "fact",
      type: "text",
      label: "rows with the same input",
      help: "The other row numbers in this slice with the identical input.",
      value: (item, ctx) =>
        copiesOf(item, ctx)
          .map((other) => other.row_number)
          .join(", "),
    },
    {
      id: "drafted_questions",
      kind: "fact",
      type: "category",
      label: "drafted questions",
      help: 'The missing questions with a draft now, in question order; "none" when none.',
      value: (item) =>
        Array.isArray(item?.missing)
          ? missingOf(item)
              .filter((qid) => has(draftOf(item)[qid]))
              .join(", ") || "none"
          : null,
    },
    {
      id: "missing_types",
      kind: "fact",
      type: "category",
      label: "types still missing",
      help: "The question types this row needs labels for: choice, noul, score.",
      value: (item) => {
        const types = new Set(list(item?.questions).map((question) => question.type));
        const ordered = typeOrder.filter((type) => types.has(type));
        return ordered.length ? ordered.join(" + ") : null;
      },
    },

    {
      id: "example_label_conflict",
      kind: "diagnostic",
      severity: "advice",
      label: "Draft differs from a guideline example with the same input",
      help: "Your labeling guideline has an example with this very input and a different label. Check which is right; the draft stays as you set it.",
      check: (item, ctx) =>
        exampleConflicts(item, ctx).map(
          (match) =>
            `Row ${item.row_number}: the ${match.question} guideline has an example with this input labeled ${match.label}, but your draft is ${draftText(draftOf(item)[match.question])}.`,
        ),
    },
    {
      id: "example_input_blank",
      kind: "diagnostic",
      severity: "info",
      label: "Blank question with a guideline example for this input",
      help: "Points to the guideline only; open it beside the label control to read the example.",
      check: (item, ctx) => {
        const questions = [
          ...new Set(
            matchingExamples(item, ctx)
              .filter((match) => !has(draftOf(item)[match.question]))
              .map((match) => match.question),
          ),
        ];
        return questions.length
          ? `Row ${item.row_number}: the guideline for ${questions.join(", ")} has an example with this input.`
          : null;
      },
    },

    {
      id: "guided_blank_share",
      kind: "metric",
      format: "percent",
      label: "Blank labels a guideline covers",
      help: "Blank labels in this slice whose question has a saved labeling guideline.",
      compute: (ctx) => {
        const guidelines = guidelinesOf(ctx);
        const blanks = itemsOf(ctx).flatMap(blankOf);
        if (!guidelines || !blanks.length) return null;
        const covered = blanks.filter((qid) => Object.prototype.hasOwnProperty.call(guidelines, qid)).length;
        return { value: covered / blanks.length, detail: `${covered} of ${plural(blanks.length, "blank label")}` };
      },
    },
    {
      id: "mean_input_words",
      kind: "metric",
      format: "number",
      label: "Mean input words per row",
      help: "Over this slice's queue rows; the picture name is not counted.",
      compute: (ctx) => {
        const rows = itemsOf(ctx).filter(hasRow);
        if (!rows.length) return null;
        const total = rows.reduce((sum, item) => sum + wordCount(inputStrings(item.row).join(" ")), 0);
        return { value: total / rows.length, detail: `${plural(total, "word")} over ${plural(rows.length, "row")}` };
      },
    },
    {
      id: "example_rows",
      kind: "metric",
      format: "integer",
      label: "Rows whose input is a guideline example",
      compute: (ctx) => {
        const all = itemsOf(ctx);
        if (!all.length || !guidelinesOf(ctx)) return null;
        const matched = all.filter((item) => matchingExamples(item, ctx).length > 0);
        return {
          value: matched.length,
          detail: `${matched.filter((item) => exampleConflicts(item, ctx).length > 0).length} with a different draft`,
        };
      },
    },

    {
      id: "copy_conflict_groups",
      kind: "metric",
      format: "integer",
      label: "Repeated inputs with different drafts",
      help: "Inputs that appear more than once in this slice whose copies carry different drafts for some question.",
      compute: (ctx) => {
        const all = itemsOf(ctx);
        if (!all.length) return null;
        const repeated = [...new Set(all.map((item) => item.identity))].filter(
          (identity) => all.filter((item) => item.identity === identity).length > 1,
        );
        const conflicting = repeated.filter((identity) =>
          all.some((item) => item.identity === identity && copyConflicts(item, ctx).length > 0),
        );
        return { value: conflicting.length, detail: `of ${plural(repeated.length, "repeated input")}` };
      },
    },
    {
      id: "worksheet_md",
      kind: "exporter",
      label: "Blank labeling worksheet of the shown rows (Markdown, inputs and options; no drafts)",
      filename: "labeling-worksheet.md",
      mime: "text/markdown",
      help: "Each shown row's number and input, then every question it misses with its options as empty boxes, to label on paper. No drafts or existing labels; not the importable labeling CSV or draft file. Pictures by name.",
      build: (ctx) => {
        const questions = new Map(list(ctx.data.questions).map((question) => [question.id, question]));
        const shown = shownOf(ctx);
        const lines = [
          "# Labeling worksheet",
          "",
          `${plural(shown.length, "row")} · inputs and blank options only, no drafts. Pictures by name.`,
        ];
        for (const item of shown) {
          const input =
            typeof item.row === "string"
              ? item.row
              : Object.entries(item.row)
                  .filter(([key]) => key !== "_image")
                  .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
                  .join(" · ");
          lines.push("", `## Row ${item.row_number}`, `> ${input.replace(/\s+/g, " ").trim() || "(no text)"}`);
          if (item.image) lines.push(`> picture: ${item.image}`);
          for (const qid of missingOf(item)) {
            const question = questions.get(qid);
            if (!question) continue;
            const option = (entry) =>
              question.type === "score" && entry.description ? `${entry.text} (${entry.description})` : entry.text;
            lines.push(
              `- ${qid}: ${list(question.options)
                .map((entry) => `[ ] ${option(entry)}`)
                .join("  ")}`,
            );
          }
        }
        return `${lines.join("\n")}\n`;
      },
    },
    {
      id: "input_shape_csv",
      kind: "exporter",
      label: "Input shape of the shown rows (CSV, no input text or labels)",
      filename: "labeling-input-shape.csv",
      mime: "text/csv",
      help: "Row number, text or object, top-level fields, words, characters, picture name, copies in this slice and questions missing. No input text and no drafts.",
      build: (ctx) =>
        csvText([
          ["row", "shape", "fields", "words", "characters", "picture", "copies", "missing"],
          ...shownOf(ctx).map((item) => [
            item.row_number,
            shapeOf(item),
            fieldsOf(item) ?? "",
            wordCount(inputStrings(item.row).join(" ")),
            inputStrings(item.row).reduce((sum, text) => sum + [...text].length, 0),
            item.image || "",
            identityCounts(ctx).get(item.identity) || 1,
            missingOf(item).length,
          ]),
        ]),
    },

    {
      id: "go_first_example_conflict",
      kind: "command",
      title: "Go to the first shown labeling row whose draft differs from a guideline example",
      group: "Labeling",
      when: (ctx) =>
        ctx?.data?.prepared === true &&
        !ctx.data.busy &&
        shownOf(ctx).some((item) => exampleConflicts(item, ctx).length > 0),
      run: (ctx) => {
        const item = shownOf(ctx).find((entry) => exampleConflicts(entry, ctx).length > 0);
        if (!item) throw new Error("No shown row has a draft that differs from a guideline example.");
        return ctx.actions.goTo(item.index);
      },
    },
    {
      id: "go_first_copy_conflict",
      kind: "command",
      title: "Go to the first shown labeling row whose copy has a different draft",
      group: "Labeling",
      when: (ctx) =>
        ctx?.data?.prepared === true &&
        !ctx.data.busy &&
        shownOf(ctx).some((item) => copyConflicts(item, ctx).length > 0),
      run: (ctx) => {
        const item = shownOf(ctx).find((entry) => copyConflicts(entry, ctx).length > 0);
        if (!item) throw new Error("No shown row has a copy with a different draft.");
        return ctx.actions.goTo(item.index);
      },
    },
  ],
});
