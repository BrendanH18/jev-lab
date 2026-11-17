// Navigation, slices and draft clean-up for the pre-run labeling queue ("workbench.labeling.queue"; contract in
// static/js/lab/surfaces/workbench-labeling.js): palette entries for the Labeling status filter, Next incomplete row and
// stepping through the values of the slice field (the server builds each slice's queue; no model call), two explicit
// edits that clear drafts (one question's, or the ones that differ between identical inputs), slice-share metrics,
// checks for a finished slice and a filter that hides every row, a CSV of the slice values, and two panels: the slice
// field's values with the rows each still has to label (buttons open one value or choose another field) and each
// question's blank labels beside whether its guideline has a note and how many examples (counts only, no guideline
// text). Drafts survive slice changes; nothing here sets a draft, applies, saves or calls the model, and no command
// declares a shortcut.
import { csvText, definePack } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? list(ctx.items()) : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? list(ctx.shown()) : []);
const draftOf = (item) => (isObject(item?.draft) ? item.draft : {});
const workable = (ctx) => ctx?.data?.prepared === true && ctx.data.busy !== true;
const sliceOf = (ctx) => (isObject(ctx?.data?.slice) ? ctx.data.slice : null);
const sliceValues = (ctx) => list(sliceOf(ctx)?.values).map((entry) => entry.value);

function stepSlice(ctx, direction) {
  const slice = sliceOf(ctx);
  const values = sliceValues(ctx);
  if (!slice?.field || !values.length) throw new Error("Choose a field under Filter by field first.");
  const at = slice.value === null ? -1 : values.indexOf(slice.value);
  const next = at < 0 ? (direction > 0 ? 0 : values.length - 1) : (at + direction + values.length) % values.length;
  return ctx.actions.prepare(slice.field, values[next]);
}

function questionOf(ctx, id) {
  const question = list(ctx?.data?.questions).find((entry) => entry.id === String(id ?? "").trim());
  if (!question)
    throw new Error(
      `No question “${String(id ?? "").trim()}” in this labeling queue (${list(ctx?.data?.questions)
        .map((entry) => entry.id)
        .join(", ")}).`,
    );
  return question;
}

// ---------- panels ----------

const dataOf = (ctx) => (isObject(ctx?.data) ? ctx.data : {});
const blank = (item, qid) => list(item?.missing).includes(qid) && !has(item?.draft?.[qid]);
const closed = (h) => h("p", { class: "faint" }, "Open the queue with Label missing rows first.");

function attempt(api, run) {
  try {
    const result = run();
    if (result && typeof result.then === "function")
      result.then(null, (error) => api.toast(error?.message || String(error), "error"));
  } catch (error) {
    api.toast(error?.message || String(error), "error");
  }
}

function slicesPanel(h, ctx, api) {
  const data = dataOf(ctx);
  if (data.prepared !== true) return closed(h);
  const slice = isObject(data.slice) ? data.slice : { field: null, value: null, fields: [], values: [] };
  const fieldSelect = h(
    "label",
    {},
    "Slice by ",
    h(
      "select",
      {
        class: "input sm",
        "data-action": "slice-field",
        disabled: data.busy === true,
        onchange: (event) =>
          attempt(api, () => ctx.actions.prepare(event.target.value === "" ? null : event.target.value, null)),
      },
      h("option", { value: "", selected: slice.field === null }, "all rows (no slice)"),
      list(slice.fields).map((field) => h("option", { value: field, selected: field === slice.field }, field)),
    ),
  );
  if (!slice.field)
    return h(
      "div",
      {},
      h("div", { class: "chips lab-row" }, fieldSelect),
      h("p", { class: "faint" }, "Choose a field to see its values and the rows each has to label."),
    );
  return h(
    "div",
    {},
    h("div", { class: "chips lab-row" }, fieldSelect),
    h(
      "table",
      { class: "table", "data-table": "slice-values" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ["Value", "Rows to label", ""].map((name) => h("th", {}, name)),
        ),
      ),
      h(
        "tbody",
        {},
        list(slice.values).map((entry) =>
          h(
            "tr",
            { "data-value": entry.value },
            h("td", {}, entry.shown),
            h("td", { class: "num" }, String(entry.rows)),
            h(
              "td",
              {},
              entry.value === slice.value
                ? h("span", { class: "faint" }, "labeling now")
                : h(
                    "button",
                    {
                      class: "btn sm ghost",
                      "data-label-value": entry.value,
                      disabled: data.busy === true,
                      onclick: () => attempt(api, () => ctx.actions.prepare(slice.field, entry.value)),
                    },
                    "Label this value",
                  ),
            ),
          ),
        ),
      ),
    ),
  );
}

function blanksPanel(h, ctx, api) {
  const data = dataOf(ctx);
  if (data.prepared !== true) return closed(h);
  const guidelines = isObject(data.guidelines) ? data.guidelines : null;
  const items = itemsOf(ctx),
    shown = shownOf(ctx);
  const guide = (qid) => {
    if (!guidelines) return "not loaded";
    const entry = guidelines[qid];
    if (!isObject(entry)) return "none";
    const examples = list(entry.examples).length;
    return `${entry.note ? "note" : "no note"}, ${examples} example${examples === 1 ? "" : "s"}`;
  };
  return h(
    "table",
    { class: "table", "data-table": "blanks" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        ["Question", "Type", "Blank in slice", "Blank shown", "Guideline", ""].map((name) => h("th", {}, name)),
      ),
    ),
    h(
      "tbody",
      {},
      list(data.questions).map((question) => {
        const first = shown.find((item) => blank(item, question.id)) || null;
        return h(
          "tr",
          { "data-question": question.id },
          h("td", { class: "mono" }, question.id),
          h("td", {}, question.type),
          h("td", { class: "num" }, String(items.filter((item) => blank(item, question.id)).length)),
          h("td", { class: "num" }, String(shown.filter((item) => blank(item, question.id)).length)),
          h("td", {}, guide(question.id)),
          h(
            "td",
            {},
            first
              ? h(
                  "button",
                  {
                    class: "btn sm ghost",
                    "data-go-blank": question.id,
                    disabled: data.busy === true,
                    onclick: () => attempt(api, () => ctx.actions.goTo(first.index)),
                  },
                  `First blank: row ${first.row_number}`,
                )
              : "",
          ),
        );
      }),
    ),
  );
}

export default definePack({
  id: "labeling-queue-navigation",
  surface: "workbench.labeling.queue",
  title: "Labeling queue: navigation, slices and draft clean-up",
  about:
    "Palette entries for the Labeling status filter, Next incomplete row and the values of the slice field; edits that clear one question's drafts or the drafts that differ between identical inputs; slice-share metrics; checks for a finished slice and a filter that hides every row; a CSV of the slice values; and panels of the slice values and of blank labels by question. Nothing sets a draft, applies, saves or calls the model.",
  features: [
    {
      id: "show_incomplete",
      kind: "command",
      title: "Show only the incomplete labeling rows",
      group: "Labeling",
      when: (ctx) => workable(ctx) && ctx.data.status !== "incomplete",
      run: (ctx) => ctx.actions.setStatus("incomplete"),
    },
    {
      id: "show_ready",
      kind: "command",
      title: "Show only the ready labeling rows",
      group: "Labeling",
      when: (ctx) => workable(ctx) && ctx.data.status !== "ready",
      run: (ctx) => ctx.actions.setStatus("ready"),
    },
    {
      id: "show_every_status",
      kind: "command",
      title: "Show ready and incomplete labeling rows again",
      group: "Labeling",
      help: "Only the Labeling status filter; Lab's filters stay as they are.",
      when: (ctx) => workable(ctx) && ctx.data.status !== "all",
      run: (ctx) => ctx.actions.setStatus("all"),
    },
    {
      id: "next_incomplete",
      kind: "command",
      title: "Go to the next incomplete labeling row",
      group: "Labeling",
      help: "The page's Next incomplete row from the palette: it sets the status filter to Incomplete.",
      when: (ctx) => workable(ctx) && itemsOf(ctx).some((item) => item.ready !== true),
      run: (ctx) => ctx.actions.next(1),
    },
    {
      id: "go_first_ready",
      kind: "command",
      title: "Go to the first shown ready labeling row",
      group: "Labeling",
      help: "To look over a finished row's drafts before Apply.",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => item.ready === true),
      run: (ctx) => {
        const item = shownOf(ctx).find((entry) => entry.ready === true);
        if (!item) throw new Error("No shown row is ready.");
        return ctx.actions.goTo(item.index);
      },
    },
    {
      id: "next_slice_value",
      kind: "command",
      title: "Label the next value of the slice field",
      group: "Labeling",
      help: "Asks the server for that slice's queue (no model call), starting over after the last value. Drafts in every slice are kept.",
      when: (ctx) => workable(ctx) && !!sliceOf(ctx)?.field && sliceValues(ctx).length > 0,
      run: (ctx) => stepSlice(ctx, 1),
    },
    {
      id: "previous_slice_value",
      kind: "command",
      title: "Label the previous value of the slice field",
      group: "Labeling",
      when: (ctx) => workable(ctx) && !!sliceOf(ctx)?.field && sliceValues(ctx).length > 0,
      run: (ctx) => stepSlice(ctx, -1),
    },
    {
      id: "every_value",
      kind: "command",
      title: "Label every value of the slice field together",
      group: "Labeling",
      help: "Keeps the field and drops the value. Drafts are kept.",
      when: (ctx) => workable(ctx) && !!sliceOf(ctx)?.field && sliceOf(ctx).value !== null,
      run: (ctx) => ctx.actions.prepare(sliceOf(ctx).field, null),
    },
    {
      id: "whole_queue",
      kind: "command",
      title: "Label all rows again, without a slice",
      group: "Labeling",
      help: "Drops the slice field. Drafts are kept.",
      when: (ctx) => workable(ctx) && !!sliceOf(ctx)?.field,
      run: (ctx) => ctx.actions.prepare(null, null),
    },

    {
      id: "clear_question",
      kind: "transform",
      label: "Clear one question's drafts on the shown rows",
      help: "Only that question's drafts, only on the shown rows. Existing labels in the rows box are never touched.",
      params: [{ name: "question", label: "Question id", type: "text", required: true }],
      each: (item, params, ctx) => {
        const question = questionOf(ctx, params.question);
        if (!has(draftOf(item)[question.id])) return null;
        const draft = { ...draftOf(item) };
        delete draft[question.id];
        return { ...item, draft };
      },
    },
    {
      id: "clear_conflicting_copies",
      kind: "transform",
      label: "Clear drafts that differ between identical inputs",
      help: "Where rows with the same input carry different drafts for a question, the shown rows lose that question's draft so you can decide once again. Agreeing drafts are kept.",
      all: (items, _params, _ctx, shown) => {
        const groups = new Map();
        items.forEach((item, index) => {
          const identity = stableStringify(item.row);
          if (!groups.has(identity)) groups.set(identity, []);
          groups.get(identity).push(index);
        });
        const clear = new Map();
        for (const members of groups.values()) {
          if (members.length < 2) continue;
          for (const qid of new Set(members.flatMap((index) => Object.keys(draftOf(items[index]))))) {
            const values = new Set(
              members
                .map((index) => draftOf(items[index])[qid])
                .filter(has)
                .map((value) => JSON.stringify(value)),
            );
            if (values.size < 2) continue;
            for (const index of members)
              if (shown.has(index) && has(draftOf(items[index])[qid]))
                clear.set(index, [...(clear.get(index) || []), qid]);
          }
        }
        return items.map((item, index) => {
          if (!clear.has(index)) return item;
          const draft = { ...draftOf(item) };
          for (const qid of clear.get(index)) delete draft[qid];
          return { ...item, draft };
        });
      },
    },

    {
      id: "slice_row_share",
      kind: "metric",
      format: "percent",
      label: "Rows to label that this slice holds",
      help: "Queue rows in this slice over the tuning rows that miss a label in every slice.",
      compute: (ctx) => {
        const eligible = ctx?.data?.eligible;
        if (ctx?.data?.prepared !== true || !Number.isInteger(eligible) || eligible <= 0) return null;
        const rows = itemsOf(ctx).length;
        return { value: rows / eligible, detail: `${rows} of ${plural(eligible, "row")}` };
      },
    },
    {
      id: "slice_missing_share",
      kind: "metric",
      format: "percent",
      label: "Missing labels that this slice holds",
      compute: (ctx) => {
        const missing = ctx?.data?.missing;
        if (ctx?.data?.prepared !== true || !Number.isInteger(missing) || missing <= 0) return null;
        const here = itemsOf(ctx).reduce((sum, item) => sum + list(item.missing).length, 0);
        return { value: here / missing, detail: `${here} of ${plural(missing, "missing label")}` };
      },
    },
    {
      id: "drafted_all_share",
      kind: "metric",
      format: "percent",
      label: "Missing labels drafted in every slice",
      help: "Draft labels across all slices (what Apply would write) over every missing label.",
      compute: (ctx) => {
        const missing = ctx?.data?.missing;
        if (ctx?.data?.prepared !== true || !Number.isInteger(missing) || missing <= 0) return null;
        const drafted = ctx.data.drafts.labels;
        return { value: drafted / missing, detail: `${drafted} of ${plural(missing, "missing label")}` };
      },
    },
    {
      id: "labels_per_row",
      kind: "metric",
      format: "number",
      label: "Missing labels per row in this slice",
      compute: (ctx) => {
        const rows = itemsOf(ctx);
        if (!rows.length) return null;
        const total = rows.reduce((sum, item) => sum + list(item.missing).length, 0);
        return { value: total / rows.length, detail: `${plural(total, "label")} over ${plural(rows.length, "row")}` };
      },
    },

    {
      id: "slice_done",
      kind: "diagnostic",
      severity: "info",
      scope: "list",
      label: "This slice is ready",
      help: "Every row of the selected slice value has a draft for every missing label.",
      check: (_items, ctx) => {
        const slice = sliceOf(ctx);
        if (
          !workable(ctx) ||
          !slice?.field ||
          slice.value === null ||
          !itemsOf(ctx).length ||
          ctx.data.progress?.incomplete !== 0
        )
          return null;
        const others = list(slice.values).filter((entry) => entry.value !== slice.value && entry.rows > 0);
        return `Every row of ${slice.field} = ${slice.value} is ready.${others.length ? ` Other values with rows to label: ${others.map((entry) => `${entry.shown} (${entry.rows})`).join(", ")}.` : ""}`;
      },
    },
    {
      id: "status_hides_all",
      kind: "diagnostic",
      severity: "advice",
      scope: "list",
      label: "Status filter hides every row",
      check: (items, ctx) =>
        workable(ctx) && !list(items).length && itemsOf(ctx).length > 0 && ctx.data.status !== "all"
          ? `The Labeling status filter (${ctx.data.status === "ready" ? "Ready" : "Incomplete"}) leaves no row of the ${plural(itemsOf(ctx).length, "row")} in this slice.`
          : null,
    },

    {
      id: "slice_values_csv",
      kind: "exporter",
      label: "Values of the slice field with their rows to label (CSV, counts only)",
      filename: "labeling-slices.csv",
      mime: "text/csv",
      help: "The selected field, each value as the page shows it, its full value and the tuning rows that still miss a label. No inputs and no drafts.",
      build: (ctx) => {
        const slice = sliceOf(ctx);
        if (!slice?.field) throw new Error("Choose a field under Filter by field first.");
        return csvText([
          ["field", "value", "shown", "rows", "selected"],
          ...list(slice.values).map((entry) => [
            slice.field,
            entry.value,
            entry.shown,
            entry.rows,
            entry.value === slice.value ? "yes" : "no",
          ]),
        ]);
      },
    },
    {
      id: "slices",
      kind: "panel",
      title: "Slices of the queue",
      improvements: [
        {
          id: "values_table",
          title: "Each value of the slice field with the tuning rows it still has to label, marking the value open now",
        },
        { id: "label_value", title: "Open one slice value's labeling queue from its row" },
        { id: "choose_field", title: "Choose the slice field, or none, beside the value table" },
      ],
      render: slicesPanel,
    },
    {
      id: "blanks",
      kind: "panel",
      title: "Blank labels by question",
      improvements: [
        {
          id: "table",
          title:
            "Blank labels per question in this slice and in the shown rows, with whether its guideline has a note and how many examples",
        },
        { id: "go_blank", title: "Go to the first shown row where a question is still blank" },
      ],
      render: blanksPanel,
    },
  ],
});
