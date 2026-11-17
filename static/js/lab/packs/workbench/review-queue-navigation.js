// Navigation for a check's Review queue ("workbench.review.queue"; contract in static/js/lab/surfaces/workbench-checks.js):
// command-palette entries for the page's own row-kind, labeling-status and input-slice filters, its Next and Previous
// incomplete row, jumps to rows that need a particular kind of attention and copying the current row's input, plus two
// panels: labeling progress for each value of an input slice (with a button that shows that value) and a card for the
// current row with its input, each question's label (yours, the gate's untouched suggestion, or blank), option buttons
// that set the label you click, Clear, and Previous/Next incomplete row. Blind-safe: nothing here shows an answer, a
// shortlist or a disagreement, so an audit row stays blind until you label it. A label changes only when you click the
// option you choose; nothing reads decisions, adds rows or calls the model, no command declares a shortcut (the queue's
// own keys act inside it), and progress counts are never an accuracy.
import { definePack } from "../../kit.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const has = (value) => value !== null && value !== undefined;
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? list(ctx.items()) : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? list(ctx.shown()) : []);
const workable = (ctx) => ctx?.data?.read === true && ctx.data.busy !== true;
const blind = (item) => item?.kind === "audit" && item.revealed !== true;
const untouched = (item) => isObject(item?.labels) && !Object.values(item.labels).some(has);
const clearedGated = (item, ctx) =>
  isObject(item?.labels) &&
  list(item.edited).some((qid) => !has(item.labels[qid]) && Object.hasOwn(ctx.data.gates || {}, qid));
const suggestionsOnly = (item, ctx) => {
  const gated = Object.keys(ctx?.data?.gates || {});
  return (
    item?.kind === "review" &&
    item.ready === true &&
    gated.length > 0 &&
    gated.every((qid) => list(item.suggested).includes(qid))
  );
};
const partialAudit = (item) =>
  item?.kind === "audit" && item.ready !== true && isObject(item.labels) && Object.values(item.labels).some(has);
const current = (ctx) => itemsOf(ctx).find((item) => item.current) || null;

// The field the slice commands step through: the selected one, else the first the page offers; with its values.
function sliceOf(ctx) {
  const fields = list(ctx?.data?.slice_fields);
  const field = ctx?.data?.filters?.slice_field || fields[0]?.name || "";
  return { field, values: list(fields.find((entry) => entry.name === field)?.values) };
}
function stepSlice(ctx, direction) {
  const { field, values } = sliceOf(ctx);
  if (!field || !values.length) throw new Error("This queue offers no input slice.");
  const at = ctx.data.filters.slice_field === field ? values.indexOf(ctx.data.filters.slice_value) : -1;
  const next = at < 0 ? (direction > 0 ? 0 : values.length - 1) : (at + direction + values.length) % values.length;
  return ctx.actions.setSlice(field, values[next]);
}

const goFirst = (test, none) => (ctx) => {
  const item = shownOf(ctx).find((entry) => test(entry, ctx));
  if (!item) throw new Error(none);
  return ctx.actions.goTo(item.line);
};
const anyShown = (test) => (ctx) => workable(ctx) && shownOf(ctx).some((entry) => test(entry, ctx));

// ---------- panels ----------

const dataOf = (ctx) => (isObject(ctx?.data) ? ctx.data : {});
const humanCount = (item) =>
  isObject(item?.labels)
    ? Object.entries(item.labels).filter(([qid, value]) => has(value) && !list(item.suggested).includes(qid)).length
    : 0;
const notRead = (h) => h("p", { class: "faint" }, "Read the gate's decisions first: there is no Review queue yet.");
const optionText = (question, value) =>
  list(question?.options).find((option) => option.value === value)?.text ??
  (typeof value === "string" ? value : JSON.stringify(value));

function attempt(api, run) {
  try {
    const result = run();
    if (result && typeof result.then === "function")
      result.then(null, (error) => api.toast(error?.message || String(error), "error"));
  } catch (error) {
    api.toast(error?.message || String(error), "error");
  }
}

// ---------- progress by input slice ----------

const SLICE_COLUMNS = ["Value", "Rows", "Review", "Audit", "Ready", "Incomplete", "Blind audit", "Labels you set"];

function slicesPanel(h, ctx, api) {
  const data = dataOf(ctx);
  if (!data.read) return notRead(h);
  const fields = list(data.slice_fields);
  if (!fields.length) return h("p", { class: "faint" }, "This queue offers no input slice.");
  const field = fields.some((entry) => entry.name === api.state.field)
    ? api.state.field
    : data.filters?.slice_field || fields[0].name;
  const items = itemsOf(ctx);
  let rows = list(fields.find((entry) => entry.name === field)?.values).map((value) => {
    const members = items.filter((item) => item.slice_values?.[field] === value);
    return {
      value,
      rows: members.length,
      review: members.filter((item) => item.kind === "review").length,
      audit: members.filter((item) => item.kind === "audit").length,
      ready: members.filter((item) => item.ready).length,
      incomplete: members.filter((item) => !item.ready).length,
      blind: members.filter(blind).length,
      yours: members.reduce((sum, item) => sum + humanCount(item), 0),
    };
  });
  if (api.state.incompleteOnly) rows = rows.filter((row) => row.incomplete > 0);
  const selected = (value) => data.filters?.slice_field === field && data.filters?.slice_value === value;
  return h(
    "div",
    {},
    h(
      "div",
      { class: "chips lab-row" },
      h(
        "label",
        {},
        "Field ",
        h(
          "select",
          {
            class: "input sm",
            "data-action": "slice-field",
            onchange: (event) => {
              api.state.field = event.target.value;
              api.redraw();
            },
          },
          fields.map((entry) => h("option", { value: entry.name, selected: entry.name === field }, entry.name)),
        ),
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          "data-action": "slice-incomplete-only",
          "aria-pressed": api.state.incompleteOnly ? "true" : "false",
          onclick: () => {
            api.state.incompleteOnly = !api.state.incompleteOnly;
            api.redraw();
          },
        },
        "Only values with incomplete rows",
      ),
    ),
    rows.length
      ? h(
          "table",
          { class: "table", "data-table": "slices" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              [...SLICE_COLUMNS, ""].map((name) => h("th", {}, name)),
            ),
          ),
          h(
            "tbody",
            {},
            rows.map((row) =>
              h(
                "tr",
                { "data-slice": row.value },
                [row.value, row.rows, row.review, row.audit, row.ready, row.incomplete, row.blind, row.yours].map(
                  (cell, index) => h("td", index ? { class: "num" } : {}, String(cell)),
                ),
                h(
                  "td",
                  {},
                  selected(row.value)
                    ? h("span", { class: "faint" }, "shown")
                    : h(
                        "button",
                        {
                          class: "btn sm ghost",
                          "data-show-slice": row.value,
                          disabled: data.busy === true,
                          onclick: () => attempt(api, () => ctx.actions.setSlice(field, row.value)),
                        },
                        "Show",
                      ),
                ),
              ),
            ),
          ),
        )
      : h("p", { class: "faint" }, "No value has incomplete rows."),
  );
}

// ---------- current row ----------

function inputLines(row) {
  if (typeof row === "string") return [row];
  return Object.entries(isObject(row) ? row : {})
    .filter(([key]) => key !== "_image")
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

function currentPanel(h, ctx, api) {
  const data = dataOf(ctx);
  if (!data.read) return notRead(h);
  const item = itemsOf(ctx).find((entry) => entry.current) || null;
  const step = h(
    "div",
    { class: "chips lab-row" },
    h(
      "button",
      {
        class: "btn sm ghost",
        "data-action": "row-previous",
        disabled: data.busy === true,
        onclick: () => attempt(api, () => ctx.actions.next(-1)),
      },
      "Previous incomplete",
    ),
    h(
      "button",
      {
        class: "btn sm ghost",
        "data-action": "row-next",
        disabled: data.busy === true,
        onclick: () => attempt(api, () => ctx.actions.next(1)),
      },
      "Next incomplete",
    ),
  );
  if (!item)
    return h(
      "div",
      {},
      h("p", { class: "faint" }, "No row is current. Use Next incomplete, or pick a label on a row."),
      step,
    );
  const gates = isObject(data.gates) ? data.gates : {};
  return h(
    "div",
    { "data-current-line": item.line },
    h(
      "p",
      { "data-part": "heading" },
      h("b", {}, `Line ${item.line}`),
      ` · ${item.kind} · ${item.status}${blind(item) ? " · blind until its gated questions are labeled" : ""}`,
    ),
    h(
      "blockquote",
      { "data-part": "input" },
      inputLines(item.row).map((line) => h("div", {}, line)),
      item.image ? h("div", { class: "faint" }, `picture: ${item.image}`) : null,
    ),
    h(
      "table",
      { class: "table", "data-table": "current-labels" },
      h(
        "tbody",
        {},
        list(data.questions).map((question) => {
          const value = isObject(item.labels) ? item.labels[question.id] : null;
          const state = !has(value)
            ? "blank"
            : list(item.suggested).includes(question.id)
              ? `the gate's suggestion: ${optionText(question, value)}`
              : `yours: ${optionText(question, value)}`;
          return h(
            "tr",
            { "data-question": question.id },
            h("td", { class: "mono" }, question.id, Object.hasOwn(gates, question.id) ? " (gated)" : ""),
            h("td", { "data-part": "state" }, state),
            h(
              "td",
              {},
              list(question.options).map((option) =>
                h(
                  "button",
                  {
                    class: "btn sm ghost",
                    "data-pick": `${question.id}:${option.text}`,
                    "aria-pressed": has(value) && value === option.value ? "true" : "false",
                    disabled: data.busy === true,
                    onclick: () => attempt(api, () => ctx.actions.setLabel(item.line, question.id, option.value)),
                  },
                  option.text,
                ),
              ),
              has(value)
                ? h(
                    "button",
                    {
                      class: "btn sm ghost",
                      "data-clear": question.id,
                      disabled: data.busy === true,
                      onclick: () => attempt(api, () => ctx.actions.setLabel(item.line, question.id, null)),
                    },
                    "Clear",
                  )
                : null,
            ),
          );
        }),
      ),
    ),
    step,
  );
}

export default definePack({
  id: "review-queue-navigation",
  surface: "workbench.review.queue",
  title: "Review queue: navigation, slice progress and current row",
  about:
    "Command-palette entries for the Review queue's row-kind, labeling-status and input-slice filters, Next and Previous incomplete row, jumps to untouched, blind, rule-breaking, cleared, suggestion-only and partly labeled audit rows, copying the current row's input, and two panels: progress by input-slice value and a current-row card with option buttons that set the label you click. Nothing reveals a blind audit row, adds rows or calls the model.",
  features: [
    {
      id: "show_review_rows",
      kind: "command",
      title: "Show only the review rows",
      group: "Review queue",
      when: (ctx) => workable(ctx) && ctx.data.filters.kind !== "review",
      run: (ctx) => ctx.actions.setKind("review"),
    },
    {
      id: "show_audit_rows",
      kind: "command",
      title: "Show only the audit rows, labeled or not",
      group: "Review queue",
      when: (ctx) => workable(ctx) && ctx.data.filters.kind !== "audit",
      run: (ctx) => ctx.actions.setKind("audit"),
    },
    {
      id: "show_ready_rows",
      kind: "command",
      title: "Show only the ready Review rows",
      group: "Review queue",
      when: (ctx) => workable(ctx) && ctx.data.filters.status !== "ready",
      run: (ctx) => ctx.actions.setStatus("ready"),
    },
    {
      id: "show_incomplete_rows",
      kind: "command",
      title: "Show only the incomplete Review rows",
      group: "Review queue",
      when: (ctx) => workable(ctx) && ctx.data.filters.status !== "incomplete",
      run: (ctx) => ctx.actions.setStatus("incomplete"),
    },
    {
      id: "show_every_status",
      kind: "command",
      title: "Show ready and incomplete Review rows again",
      group: "Review queue",
      help: "Only the labeling-status filter; the kind and slice filters stay as they are.",
      when: (ctx) => workable(ctx) && ctx.data.filters.status !== "all",
      run: (ctx) => ctx.actions.setStatus("all"),
    },
    {
      id: "next_incomplete",
      kind: "command",
      title: "Go to the next incomplete Review row",
      group: "Review queue",
      help: "The page's Next incomplete row: it also sets the status filter to Incomplete.",
      when: (ctx) => workable(ctx) && itemsOf(ctx).some((item) => !item.ready),
      run: (ctx) => ctx.actions.next(1),
    },
    {
      id: "previous_incomplete",
      kind: "command",
      title: "Go to the previous incomplete Review row",
      group: "Review queue",
      help: "Backwards from the current row, starting over at the bottom; it also sets the status filter to Incomplete.",
      when: (ctx) => workable(ctx) && itemsOf(ctx).some((item) => !item.ready),
      run: (ctx) => ctx.actions.next(-1),
    },
    {
      id: "go_first_untouched",
      kind: "command",
      title: "Go to the first shown Review row with no label at all",
      group: "Review queue",
      when: anyShown(untouched),
      run: goFirst(untouched, "Every shown row has a label."),
    },
    {
      id: "go_first_blind",
      kind: "command",
      title: "Go to the first shown blind audit row",
      group: "Review queue",
      help: "It stays blind: the gate's answers appear only once you label its gated questions.",
      when: anyShown(blind),
      run: goFirst(blind, "No shown audit row is still blind."),
    },
    {
      id: "go_first_rule",
      kind: "command",
      title: "Go to the first shown Review row that broke a rule",
      group: "Review queue",
      when: anyShown((item) => list(item.rules).length > 0),
      run: goFirst((item) => list(item.rules).length > 0, "No shown row broke a rule."),
    },
    {
      id: "go_first_cleared",
      kind: "command",
      title: "Go to the first shown Review row with a gated label you cleared",
      group: "Review queue",
      when: anyShown(clearedGated),
      run: goFirst(clearedGated, "No shown row has a gated label you cleared."),
    },
    {
      id: "go_first_suggestions_only",
      kind: "command",
      title: "Go to the first shown ready review row with only the gate's suggestions",
      group: "Review queue",
      help: "A ready review row whose gated labels no person has changed: confirm them before Add.",
      when: anyShown(suggestionsOnly),
      run: goFirst(suggestionsOnly, "No shown ready review row rests on the gate's suggestions alone."),
    },
    {
      id: "go_first_partial_audit",
      kind: "command",
      title: "Go to the first shown partly labeled audit row",
      group: "Review queue",
      help: "An audit row with some labels but a gated question still blank; it stays blind until that is labeled.",
      when: anyShown(partialAudit),
      run: goFirst(partialAudit, "No shown audit row is partly labeled."),
    },
    {
      id: "go_last_incomplete",
      kind: "command",
      title: "Go to the last shown incomplete Review row",
      group: "Review queue",
      when: anyShown((item) => !item.ready),
      run: (ctx) => {
        const item = shownOf(ctx)
          .filter((entry) => !entry.ready)
          .pop();
        if (!item) throw new Error("Every shown row is ready.");
        return ctx.actions.goTo(item.line);
      },
    },
    {
      id: "go_first_picture",
      kind: "command",
      title: "Go to the first shown Review row with a picture",
      group: "Review queue",
      when: anyShown((item) => typeof item.image === "string"),
      run: goFirst((item) => typeof item.image === "string", "No shown row has a picture."),
    },
    {
      id: "next_slice_value",
      kind: "command",
      title: "Show the next input-slice value",
      group: "Review queue",
      help: "Steps through the values of the selected input slice (else the first field the page offers), starting over after the last.",
      when: (ctx) => workable(ctx) && sliceOf(ctx).values.length > 0,
      run: (ctx) => stepSlice(ctx, 1),
    },
    {
      id: "previous_slice_value",
      kind: "command",
      title: "Show the previous input-slice value",
      group: "Review queue",
      when: (ctx) => workable(ctx) && sliceOf(ctx).values.length > 0,
      run: (ctx) => stepSlice(ctx, -1),
    },
    {
      id: "copy_current_input",
      kind: "command",
      title: "Copy the current Review row's input",
      group: "Review queue",
      help: "The input only (picture by name), never its labels or the gate's answers.",
      when: (ctx) => ctx?.data?.read === true && !!current(ctx),
      run: (ctx) => {
        const item = current(ctx);
        if (!item) throw new Error("No row is current. Use Next incomplete row first.");
        ctx.env.copy(typeof item.row === "string" ? item.row : JSON.stringify(item.row, null, 2));
        ctx.env.toast(`Copied the input of line ${item.line}.`);
      },
    },
    {
      id: "slice_progress",
      kind: "panel",
      title: "Progress by input slice",
      improvements: [
        {
          id: "table",
          title:
            "Count rows, review and audit rows, ready, incomplete, still-blind rows and your labels for each value of an input slice",
        },
        { id: "field", title: "Choose which input-slice field the progress table counts by" },
        { id: "incomplete_only", title: "Show only the slice values that still have incomplete rows" },
        { id: "show", title: "Show one slice value's rows in the queue from its progress row" },
      ],
      render: slicesPanel,
    },
    {
      id: "current_row",
      kind: "panel",
      title: "Current row",
      improvements: [
        { id: "card_input", title: "The current Review row's line, kind, status and input, with its picture by name" },
        {
          id: "card_labels",
          title:
            "Each queue question on the current row marked as your label, the gate's untouched suggestion or blank, never with the gate's answers",
        },
        { id: "card_pick", title: "Set a current-row label by clicking the option you choose" },
        { id: "card_clear", title: "Clear one of the current row's labels" },
        { id: "card_step", title: "Previous and Next incomplete row buttons beside the current row" },
      ],
      render: currentPanel,
    },
  ],
});
