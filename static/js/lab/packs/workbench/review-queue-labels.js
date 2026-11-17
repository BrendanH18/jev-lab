// Your own labels and the inputs in a check's Review queue ("workbench.review.queue"; contract in
// static/js/lab/surfaces/workbench-checks.js): facts about the labels a person set (the gate's untouched suggestions
// left out), the input's size and shape, what is still to decide, a check for gated labels you cleared, label-count
// metrics, a printable blank worksheet and per-slice progress counts. Blind audit rows stay blind: nothing here reads an
// answer, a shortlist or a disagreement, and the worksheet holds inputs and the options to choose from, never a label.
import { csvText, definePack } from "../../kit.js";
import { findEmails, findUrls, wordCount } from "../../lib/text.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? list(ctx.items()) : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? list(ctx.shown()) : []);
const blind = (item) => item?.kind === "audit" && item.revealed !== true;
const labelText = (value) => (value === true ? "yes" : value === false ? "no" : String(value));
const questionIds = (ctx) => list(ctx?.data?.questions).map((question) => question.id);

// Labels a person set: every label on an audit row; on a review row, those that are not the gate's untouched suggestion.
const humanLabels = (item) =>
  isObject(item?.labels)
    ? Object.entries(item.labels).filter(([qid, value]) => has(value) && !list(item.suggested).includes(qid))
    : [];
const cleared = (item) => (isObject(item?.labels) ? list(item.edited).filter((qid) => !has(item.labels[qid])) : []);

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
const hasInput = (item) => typeof item?.row === "string" || isObject(item?.row);
// The input on one line, field by field: "text: … · channel: email". The picture travels by name separately.
const inputLine = (row) =>
  (typeof row === "string"
    ? row
    : Object.entries(isObject(row) ? row : {})
        .filter(([key]) => key !== "_image")
        .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" · ")
  )
    .replace(/\s+/g, " ")
    .trim();

const sliceField = (ctx) => ctx?.data?.filters?.slice_field || list(ctx?.data?.slice_fields)[0]?.name || "";

export default definePack({
  id: "review-queue-labels",
  surface: "workbench.review.queue",
  title: "Review queue: your labels and the inputs",
  about:
    "Facts about the labels you set (the gate's untouched suggestions left out), the input's size, contact details and slice value, and what is still to decide; a check for gated labels you cleared; label-count metrics; a printable blank worksheet and per-slice progress counts. Blind audit rows stay blind: nothing reads an answer or a shortlist, and the worksheet holds inputs and options only.",
  features: [
    {
      id: "human_labels",
      kind: "fact",
      type: "number",
      label: "labels you set",
      unit: "labels",
      help: "Labels a person set on the row: all of an audit row's, and a review row's other than the gate's untouched suggestions.",
      value: (item) => (isObject(item?.labels) ? humanLabels(item).length : null),
    },
    {
      id: "open_blank",
      kind: "fact",
      type: "number",
      label: "open questions still blank",
      unit: "questions",
      help: "Questions to decide on this row (held, rule-read, every question on audit rows) that have no label yet, gated or not.",
      value: (item) =>
        isObject(item?.labels) && Array.isArray(item.open)
          ? item.open.filter((qid) => !has(item.labels[qid])).length
          : null,
    },
    {
      id: "input_words",
      kind: "fact",
      type: "number",
      label: "input words",
      unit: "words",
      help: "Words in the input's text values; the picture name is not counted.",
      value: (item) => (hasInput(item) ? wordCount(inputStrings(item.row).join(" ")) : null),
    },
    {
      id: "input_chars",
      kind: "fact",
      type: "number",
      label: "input characters",
      unit: "characters",
      help: "Characters in the input's text values; the picture name is not counted.",
      value: (item) =>
        hasInput(item) ? inputStrings(item.row).reduce((sum, text) => sum + [...text].length, 0) : null,
    },
    {
      id: "contact_details",
      kind: "fact",
      type: "flag",
      label: "an email address or link in the input",
      value: (item) =>
        hasInput(item) &&
        inputStrings(item.row).some((text) => findEmails(text).length > 0 || findUrls(text).length > 0),
    },
    {
      id: "blind",
      kind: "fact",
      type: "flag",
      label: "a blind audit row",
      help: "An audit row whose gated questions are not all labeled yet; the page hides the gate's answers until they are.",
      value: (item) => blind(item),
    },
    {
      id: "untouched",
      kind: "fact",
      type: "flag",
      label: "no label at all",
      help: "Not one question labeled yet, by you or by a gate suggestion.",
      value: (item) => isObject(item?.labels) && !Object.values(item.labels).some(has),
    },
    {
      id: "cleared_label",
      kind: "fact",
      type: "flag",
      label: "a label you cleared",
      help: "A question you edited this session that is blank now.",
      value: (item) => cleared(item).length > 0,
    },
    {
      id: "edited_questions",
      kind: "fact",
      type: "category",
      label: "questions you edited",
      help: '"none" when you have not changed a label on the row this session.',
      value: (item) => (Array.isArray(item?.edited) ? item.edited.join(", ") || "none" : null),
    },
    {
      id: "next_to_decide",
      kind: "fact",
      type: "category",
      label: "next question to decide",
      help: 'The first open question without a label, else the first gated one still missing; "none" when nothing is left.',
      value: (item) => {
        if (!isObject(item?.labels)) return null;
        return list(item.open).find((qid) => !has(item.labels[qid])) || list(item.missing)[0] || "none";
      },
    },
    {
      id: "kind_status",
      kind: "fact",
      type: "category",
      label: "kind and status",
      help: "review or audit, with ready or incomplete.",
      value: (item) =>
        (item?.kind === "review" || item?.kind === "audit") && (item.status === "ready" || item.status === "incomplete")
          ? `${item.kind} · ${item.status}`
          : null,
    },
    {
      id: "slice_value",
      kind: "fact",
      type: "category",
      label: "input-slice value",
      help: "The row's value for the selected input slice, else for the first slice field the page offers.",
      value: (item, ctx) => {
        const field = sliceField(ctx);
        const value = field && isObject(item?.slice_values) ? item.slice_values[field] : null;
        return typeof value === "string" ? value : null;
      },
    },
    {
      id: "your_labels",
      kind: "fact",
      type: "text",
      label: "your labels",
      help: "The labels you set, as question=label; the gate's untouched suggestions are left out.",
      value: (item) =>
        humanLabels(item)
          .map(([qid, value]) => `${qid}=${labelText(value)}`)
          .join("; "),
    },

    {
      id: "cleared_gated",
      kind: "diagnostic",
      severity: "advice",
      label: "Gated label you cleared",
      help: "Add needs every gated question labeled.",
      check: (item, ctx) => {
        const gates = isObject(ctx?.data?.gates) ? ctx.data.gates : {};
        const gone = cleared(item).filter((qid) => Object.prototype.hasOwnProperty.call(gates, qid));
        return gone.length
          ? `You cleared ${gone.join(", ")} on line ${item.line}; ${gone.length === 1 ? "it is" : "they are"} gated, so Add skips the row until ${gone.length === 1 ? "it is" : "they are"} labeled again.`
          : null;
      },
    },

    {
      id: "slice_without_audit",
      kind: "diagnostic",
      severity: "info",
      scope: "list",
      label: "Input-slice value without audit rows",
      help: "Over the whole queue, for the selected input slice (else the first slice field). The audit after Add can only describe values its sample reached.",
      check: (_items, ctx) => {
        const field = sliceField(ctx);
        const values = list(list(ctx?.data?.slice_fields).find((entry) => entry.name === field)?.values);
        const all = itemsOf(ctx);
        return values
          .map((value) => {
            const rows = all.filter((item) => item.slice_values?.[field] === value);
            const review = rows.filter((item) => item.kind === "review").length;
            return review > 0 && !rows.some((item) => item.kind === "audit")
              ? `${field} = ${value} has ${plural(review, "review row")} and no audit row, so the audit after Add says nothing about it.`
              : "";
          })
          .filter(Boolean);
      },
    },

    {
      id: "human_label_total",
      kind: "metric",
      format: "integer",
      label: "Labels you set in the queue",
      help: "Over the whole queue; the gate's untouched suggestions are not counted.",
      compute: (ctx) => {
        const all = itemsOf(ctx);
        if (!all.length) return null;
        const total = all.reduce((sum, item) => sum + humanLabels(item).length, 0);
        return {
          value: total,
          detail: `on ${plural(all.filter((item) => humanLabels(item).length > 0).length, "row")}`,
        };
      },
    },
    {
      id: "untouched_rows",
      kind: "metric",
      format: "integer",
      label: "Rows with no label at all",
      compute: (ctx) => {
        const all = itemsOf(ctx);
        return all.length
          ? {
              value: all.filter((item) => !Object.values(item.labels || {}).some(has)).length,
              detail: `of ${plural(all.length, "row")}`,
            }
          : null;
      },
    },
    {
      id: "blind_rows",
      kind: "metric",
      format: "integer",
      label: "Audit rows still blind",
      compute: (ctx) => {
        const audits = itemsOf(ctx).filter((item) => item.kind === "audit");
        return audits.length
          ? { value: audits.filter(blind).length, detail: `of ${plural(audits.length, "audit row")}` }
          : null;
      },
    },
    {
      id: "shown_share",
      kind: "metric",
      format: "percent",
      label: "Queue rows shown",
      help: "Rows the page's and Lab's filters leave, over the whole queue. Add and the CSV handoff use the whole queue either way.",
      compute: (ctx) => {
        const all = itemsOf(ctx);
        if (!all.length) return null;
        const shown = shownOf(ctx).length;
        return { value: shown / all.length, detail: `${shown} of ${plural(all.length, "row")}` };
      },
    },
    {
      id: "gated_labels_left",
      kind: "metric",
      format: "integer",
      label: "Gated labels left in the queue",
      help: "Gated questions without a label, over every queued row.",
      compute: (ctx) => {
        const all = itemsOf(ctx);
        return all.length
          ? {
              value: all.reduce((sum, item) => sum + list(item.missing).length, 0),
              detail: `on ${plural(all.filter((item) => list(item.missing).length > 0).length, "row")}`,
            }
          : null;
      },
    },

    {
      id: "audit_slices_covered",
      kind: "metric",
      format: "integer",
      label: "Input-slice values with a labeled audit row",
      help: "Values of the selected input slice (else the first slice field) where at least one audit row is ready. Coverage of the sample, not an accuracy.",
      compute: (ctx) => {
        const field = sliceField(ctx);
        const values = list(list(ctx?.data?.slice_fields).find((entry) => entry.name === field)?.values);
        if (!itemsOf(ctx).length || !values.length) return null;
        const covered = values.filter((value) =>
          itemsOf(ctx).some((item) => item.kind === "audit" && item.ready && item.slice_values?.[field] === value),
        );
        return {
          value: covered.length,
          detail: `of ${plural(values.length, `${field} value`)}${covered.length ? `: ${covered.join(", ")}` : ""}`,
        };
      },
    },

    {
      id: "worksheet_md",
      kind: "exporter",
      label:
        "Blank labeling worksheet of the shown rows (Markdown, inputs and options; no labels, suggestions or answers)",
      filename: "jev-review-worksheet.md",
      mime: "text/markdown",
      help: "Each shown row's line, kind and input, then every question to decide with its options as empty boxes, to label on paper. It holds no label, gate suggestion, answer or shortlist, so audit rows stay blind; not a file the page imports. Pictures by name.",
      build: (ctx) => {
        const questions = new Map(list(ctx.data.questions).map((question) => [question.id, question]));
        const order = questionIds(ctx);
        const shown = shownOf(ctx);
        const lines = [
          `# Review worksheet · ${ctx.data.dataset?.name || ctx.data.dataset?.id || "dataset"}`,
          "",
          `${plural(shown.length, "row")} · inputs and blank options only: no labels, gate suggestions, answers or shortlists. Pictures by name.`,
        ];
        for (const item of shown) {
          lines.push("", `## Line ${item.line} (${item.kind})`, `> ${inputLine(item.row) || "(no text)"}`);
          if (item.image) lines.push(`> picture: ${item.image}`);
          for (const qid of list(item.open)
            .filter((id) => questions.has(id))
            .sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
            const question = questions.get(qid);
            // Score levels are bare numbers, so their authored criterion goes beside them.
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
      id: "slice_progress_csv",
      kind: "exporter",
      label: "Progress by input-slice value as CSV (counts only)",
      filename: "jev-review-slices.csv",
      mime: "text/csv",
      help: "For each value of the selected input slice (else the first slice field): queued rows, review and audit rows, ready, incomplete and still-blind rows. Progress only, never an accuracy; no inputs, labels or answers.",
      build: (ctx) => {
        const field = sliceField(ctx);
        const values = list(list(ctx.data.slice_fields).find((entry) => entry.name === field)?.values);
        const all = itemsOf(ctx);
        return csvText([
          ["field", "value", "rows", "review", "audit", "ready", "incomplete", "blind_audit"],
          ...values.map((value) => {
            const rows = all.filter((item) => item.slice_values?.[field] === value);
            const count = (test) => rows.filter(test).length;
            return [
              field,
              value,
              rows.length,
              count((item) => item.kind === "review"),
              count((item) => item.kind === "audit"),
              count((item) => item.ready),
              count((item) => !item.ready),
              count(blind),
            ];
          }),
        ]);
      },
    },
    {
      id: "your_labels_csv",
      kind: "exporter",
      label: "Your labels on the shown rows (CSV, holds your labels; no inputs, suggestions or answers)",
      filename: "jev-review-your-labels.csv",
      mime: "text/csv",
      help: "One line per label a person set on a shown row: line, kind, question and label as the select shows it. The gate's untouched suggestions, answers and shortlists are left out, and so are inputs; not the page's labeling CSV.",
      build: (ctx) => {
        const questions = new Map(list(ctx.data.questions).map((question) => [question.id, question]));
        const text = (qid, value) =>
          list(questions.get(qid)?.options).find((option) => option.value === value)?.text ?? labelText(value);
        return csvText([
          ["line", "kind", "question", "label"],
          ...shownOf(ctx).flatMap((item) =>
            humanLabels(item).map(([qid, value]) => [item.line, item.kind, qid, text(qid, value)]),
          ),
        ]);
      },
    },
  ],
});
