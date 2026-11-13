// Tools for labeling faster in the Workbench pre-run labeling queue ("workbench.labeling.queue"; contract in
// static/js/lab/surfaces/workbench-labeling.js): a draft summary of the shown rows, a tally of draft labels per option,
// a guidelines-at-a-glance panel (human-only), a keyboard reference, a current-row card whose buttons set the label you
// click, identical-input groups, a few progress metrics and navigation commands without shortcuts.
// Draft labels are the user's own human labels: a button sets only the label clicked, nothing suggests or infers one,
// and nothing applies drafts, saves the dataset or calls the model. Guidelines are shown to the person labeling only.
import { definePack } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";
import { formatTextTable } from "../../lib/tables.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const has = (value) => value !== undefined && value !== null;
const own = (object, key) => isObject(object) && Object.prototype.hasOwnProperty.call(object, key);
const draftOf = (item) => (isObject(item?.draft) ? item.draft : {});
const missingOf = (item) => (Array.isArray(item?.missing) ? item.missing.filter((qid) => typeof qid === "string") : []);
const blankOf = (item) => missingOf(item).filter((qid) => !has(draftOf(item)[qid]));
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const itemsOf = (ctx) => {
  const list = typeof ctx?.items === "function" ? ctx.items() : null;
  return Array.isArray(list) ? list : [];
};
const shownOf = (ctx) => {
  const list = typeof ctx?.shown === "function" ? ctx.shown() : null;
  return Array.isArray(list) ? list : [];
};
// The queue's questions, each with an options list ([] when a question has none).
const questionsOf = (ctx) => (Array.isArray(ctx?.data?.questions) ? ctx.data.questions : [])
  .filter((question) => isObject(question) && typeof question.id === "string")
  .map((question) => (Array.isArray(question.options) ? question : { ...question, options: [] }));
const workable = (ctx) => ctx?.data?.prepared === true && ctx.data.busy !== true;
const currentOf = (ctx) => itemsOf(ctx).find((item) => item.current === true) || null;
const labelText = (value) => (value === true ? "yes" : value === false ? "no" : has(value) ? String(value) : "");
const typeOn = (item, qid, ctx) => (Array.isArray(item?.questions) ? item.questions.find((question) => question?.id === qid)?.type : null)
  || questionsOf(ctx).find((question) => question.id === qid)?.type || "";
const percent = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");
const CLOSED = "Open the queue with Label missing rows to use this panel.";

// The next shown row after the current one (in shown order, wrapping) that passes test; the current row comes last.
function goNext(ctx, test, what) {
  const shown = shownOf(ctx);
  const start = shown.findIndex((item) => item.current === true);
  for (let step = 1; step <= shown.length; step++) {
    const item = shown[(start + step + shown.length) % shown.length];
    if (test(item, ctx)) return ctx.actions.goTo(item.index);
  }
  throw new Error(`No shown row ${what}.`);
}
const untouched = (item) => missingOf(item).length > 0 && !missingOf(item).some((qid) => has(draftOf(item)[qid]));
const oneAway = (item) => blankOf(item).length === 1;
const blankOfType = (type) => (item, ctx) => blankOf(item).some((qid) => typeOn(item, qid, ctx) === type);

// Calls a page action from a control the user just used; a refusal becomes an error toast.
function act(api, run) {
  try {
    run();
    api.redraw();
  } catch (error) {
    api.toast(error.message, "error");
  }
}

// Per question over some rows: each option's draft count, in select order, and the question's draft total.
function tally(rows, ctx) {
  return questionsOf(ctx).map((question) => {
    const values = rows.filter((item) => missingOf(item).includes(question.id)).map((item) => draftOf(item)[question.id]).filter(has);
    return { question, total: values.length, options: question.options.map((option) => ({ option, count: values.filter((value) => value === option.value).length })) };
  });
}

// Groups of queue rows with an identical input, in rows-box order, with how their drafts compare.
function duplicateGroups(ctx) {
  const groups = new Map();
  for (const item of itemsOf(ctx)) {
    if (typeof item?.identity !== "string") continue;
    if (!groups.has(item.identity)) groups.set(item.identity, []);
    groups.get(item.identity).push(item);
  }
  return [...groups.values()].filter((members) => members.length > 1).map((members) => {
    const qids = [...new Set(members.flatMap(missingOf))];
    const differ = qids.some((qid) => new Set(members.map((item) => draftOf(item)[qid]).filter(has).map((value) => stableStringify(value))).size > 1);
    const drafted = members.filter((item) => Object.keys(draftOf(item)).length > 0).length;
    const status = differ ? "drafts differ" : !drafted ? "no drafts"
      : drafted === members.length && new Set(members.map((item) => stableStringify(draftOf(item)))).size === 1 ? "same drafts" : "some copies blank";
    return { members, status };
  });
}

// The first letters a native select uses to jump to each label, in the order the page's label select lists them.
// The page lists "Choose a human label" (it clears the draft) first, then the labels: Score as "N · criterion".
function typeAhead(question) {
  const shown = question.options.map((option) => (question.type === "score" && option.description ? `${option.text} · ${option.description}` : option.text));
  const letters = new Map();
  for (const text of shown) {
    const letter = text.charAt(0).toLowerCase();
    if (!letter) continue;
    if (!letters.has(letter)) letters.set(letter, letter === "c" ? ["Choose a human label (clears)"] : []);
    letters.get(letter).push(text);
  }
  return [...letters].map(([letter, texts]) => ({ letter, texts }));
}

export default definePack({
  id: "labeling-drafts-tools",
  surface: "workbench.labeling.queue",
  title: "Labeling queue: drafting tools",
  about: "Panels for labeling faster in the pre-run labeling queue: a draft summary, a per-option tally, a human-only guidelines panel, a keyboard reference, a current-row card that sets the label you click, and identical-input groups, plus progress metrics and navigation commands. Nothing suggests a label, applies or saves drafts, or sends guidelines anywhere.",
  features: [
    // ---------- panels ----------
    { id: "draft_summary", kind: "panel", title: "Draft summary",
      improvements: [
        { id: "summary_table", title: "A table of the shown labeling rows with each question's draft, blank or not asked" },
        { id: "summary_go", title: "Go to a labeling row from the draft summary" },
        { id: "summary_copy", title: "Copy the draft summary as text (row numbers and drafts, no inputs)" },
      ],
      render: (h, ctx, api) => {
        const shown = shownOf(ctx);
        if (ctx?.data?.prepared !== true) return h("p", { class: "faint" }, CLOSED);
        if (!shown.length) return h("p", { class: "faint" }, "No labeling row is shown.");
        const questions = questionsOf(ctx);
        const cell = (item, qid) => (!missingOf(item).includes(qid) ? "—" : has(draftOf(item)[qid]) ? labelText(draftOf(item)[qid]) : "blank");
        const name = (item) => `Row ${item.row_number}${item.current === true ? " (current)" : ""}`;
        const columns = ["row", "status", ...questions.map((question) => question.id)];
        const rows = shown.map((item) => [name(item), item.ready === true ? "ready" : "incomplete", ...questions.map((question) => cell(item, question.id))]);
        return h("div", { class: "grid", style: { gap: "6px" } },
          h("p", { class: "faint" }, "Your draft labels on the shown rows. “—”: the row is not missing that question. Apply and Save stay on the page."),
          h("div", { class: "scroll" }, h("table", { class: "table" },
            h("thead", {}, h("tr", {}, [...columns, ""].map((title) => h("th", {}, title)))),
            h("tbody", {}, shown.map((item, position) => h("tr", { "data-row": item.index },
              rows[position].map((value) => h("td", {}, value)),
              h("td", {}, h("button", { class: "btn sm ghost", "data-go": item.index, "aria-label": `Go to row ${item.row_number}`,
                onclick: () => act(api, () => ctx.actions.goTo(item.index)) }, "Go"))))))),
          h("div", {}, h("button", { class: "btn sm", "data-copy": "summary", onclick: () => {
            api.copy(formatTextTable(columns, rows));
            api.toast(`Copied the draft summary of ${plural(shown.length, "row")}.`);
          } }, "Copy summary")));
      } },
    { id: "draft_tally", kind: "panel", title: "Draft tally by label",
      improvements: [
        { id: "option_counts", title: "How many drafts on the shown rows use each label option, per question" },
        { id: "option_share", title: "Each label option's share of its question's drafts" },
        { id: "tally_copy", title: "Copy the draft tally as text (counts only)" },
      ],
      render: (h, ctx, api) => {
        if (ctx?.data?.prepared !== true) return h("p", { class: "faint" }, CLOSED);
        if (!shownOf(ctx).length) return h("p", { class: "faint" }, "No labeling row is shown.");
        const entries = tally(shownOf(ctx), ctx);
        const rows = entries.flatMap(({ question, total, options }) => options.map(({ option, count }) => [question.id, option.text, count, percent(count, total)]));
        return h("div", { class: "grid", style: { gap: "6px" } },
          h("div", { class: "scroll" }, h("table", { class: "table" },
            h("thead", {}, h("tr", {}, ["question", "label", "drafts", "share"].map((title) => h("th", {}, title)))),
            h("tbody", {}, rows.map(([qid, text, count, share]) => h("tr", { "data-question": qid, "data-option": text },
              h("td", { class: "mono" }, qid), h("td", {}, text), h("td", { class: "num" }, String(count)), h("td", { class: "num" }, share)))))),
          h("div", {}, h("button", { class: "btn sm", "data-copy": "tally", onclick: () => {
            api.copy(formatTextTable(["question", "label", "drafts", "share"], rows));
            api.toast("Copied the draft tally (counts only).");
          } }, "Copy tally")));
      } },
    { id: "guidelines_glance", kind: "panel", title: "Guidelines at a glance",
      improvements: [
        { id: "notes", title: "Each queue question's saved guideline note in one place" },
        { id: "examples", title: "The guidelines' made-up examples with their label and reason" },
        { id: "current_only", title: "Show only the guidelines for the current row's blank questions" },
      ],
      render: (h, ctx, api) => {
        if (ctx?.data?.prepared !== true) return h("p", { class: "faint" }, CLOSED);
        const guidelines = ctx.data.guidelines;
        if (!isObject(guidelines)) return h("p", { class: "faint" }, "Guidelines show here once the dataset is saved and a label control has loaded them.");
        const current = currentOf(ctx);
        const only = api.state.currentOnly === true;
        const questions = questionsOf(ctx).filter((question) => !only || (current && blankOf(current).includes(question.id)));
        return h("div", { class: "grid", style: { gap: "8px" } },
          h("p", { class: "faint" }, "Human-only: for the people labeling. Never sent to the model."),
          h("label", {}, h("input", { type: "checkbox", "data-current-only": "", checked: only,
            onchange: (event) => { api.state.currentOnly = event.target.checked === true; api.redraw(); } }), " Only the current row's blank questions"),
          only && !current ? h("p", { class: "faint" }, "No current row yet.") : null,
          questions.map((question) => {
            const guideline = own(guidelines, question.id) ? guidelines[question.id] : null;
            return h("div", { "data-question": question.id },
              h("b", { class: "mono" }, question.id),
              !guideline ? h("p", { class: "faint" }, "No guideline saved.") : [
                guideline.note ? h("p", { class: "muted", "data-note": "", style: { whiteSpace: "pre-wrap" } }, guideline.note) : null,
                (guideline.examples || []).length ? h("ul", {}, guideline.examples.map((example) => h("li", { "data-example": "" },
                  `“${example.input}” → ${example.label}${example.why ? ` (${example.why})` : ""}`))) : null,
              ]);
          }));
      } },
    { id: "keyboard_reference", kind: "panel", title: "Labeling keyboard reference",
      improvements: [
        { id: "panel_keys", title: "The labeling panel's shortcuts and the label select's own keys in one list" },
        { id: "type_ahead", title: "The first letter that picks each label on a select, with shared letters flagged" },
      ],
      render: (h, ctx) => {
        const keys = [
          ["Ctrl/⌘+Enter", "Next incomplete row (focus inside the labeling panel)"],
          ["Ctrl/⌘+Shift+Enter", "Previous incomplete row"],
          ["Tab / Shift+Tab", "Next or previous label select"],
          ["A letter or digit", "On a label select: picks the first label starting with it; press again for the next one"],
          ["Alt+↓ (Space in most browsers)", "Opens a label select's list"],
          ["Choose a human label", "Clears that question's draft"],
        ];
        const rows = questionsOf(ctx).flatMap((question) => typeAhead(question).map((entry) => ({ question, ...entry })));
        return h("div", { class: "grid", style: { gap: "8px" } },
          h("table", { class: "table", "data-keys": "" }, h("tbody", {}, keys.map(([key, what]) => h("tr", {}, h("td", { class: "mono" }, key), h("td", {}, what))))),
          ctx?.data?.prepared !== true ? h("p", { class: "faint" }, "Open the queue to see each question's letters.")
            : h("table", { class: "table", "data-type-ahead": "" },
              h("thead", {}, h("tr", {}, ["question", "type", "labels", ""].map((title) => h("th", {}, title)))),
              h("tbody", {}, rows.map((row) => h("tr", { "data-question": row.question.id, "data-letter": row.letter },
                h("td", { class: "mono" }, row.question.id), h("td", { class: "mono" }, row.letter), h("td", {}, row.texts.join(", ")),
                h("td", { class: "faint" }, row.texts.length > 1 ? "shared: press again, or type more letters" : ""))))));
      } },
    { id: "current_row_card", kind: "panel", title: "Current row",
      improvements: [
        { id: "card_checklist", title: "The current labeling row's input and each missing question's draft or blank" },
        { id: "card_pick", title: "Set or clear a current-row draft by clicking the label you choose" },
      ],
      render: (h, ctx, api) => {
        if (ctx?.data?.prepared !== true) return h("p", { class: "faint" }, CLOSED);
        const item = currentOf(ctx);
        if (!item) return h("p", { class: "faint" }, "No current row yet. Use Next incomplete row or pick a label in the queue.");
        const questions = questionsOf(ctx);
        const input = typeof item.row === "string" ? item.row
          : JSON.stringify(Object.fromEntries(Object.entries(item.row || {}).filter(([key]) => key !== "_image")), null, 2);
        return h("div", { class: "grid", style: { gap: "8px" }, "data-row": item.index },
          h("b", {}, `Row ${item.row_number} · ${item.ready === true ? "ready" : `${plural(blankOf(item).length, "blank label")}`}`),
          h("pre", { class: "code", style: { whiteSpace: "pre-wrap" } }, input),
          item.image ? h("p", { class: "faint" }, `Picture: ${item.image}${item.picture_loaded === true ? "" : " (not loaded)"}`) : null,
          missingOf(item).map((qid) => {
            const question = questions.find((entry) => entry.id === qid);
            const value = draftOf(item)[qid];
            return h("div", { "data-question": qid, class: "chips" },
              h("span", { class: "mono" }, `${qid}: ${has(value) ? labelText(value) : "blank"}`),
              (question ? question.options : []).map((option) => h("button", { class: `btn sm${value === option.value ? " primary" : " ghost"}`,
                "data-pick": option.text, "aria-pressed": value === option.value ? "true" : "false", title: option.description || option.text,
                onclick: () => act(api, () => ctx.actions.setDraft(item.index, qid, option.value)) }, option.text)),
              has(value) ? h("button", { class: "btn sm ghost", "data-clear": qid, "aria-label": `Clear the ${qid} draft`,
                onclick: () => act(api, () => ctx.actions.setDraft(item.index, qid, null)) }, "Clear") : null);
          }));
      } },
    { id: "duplicate_groups", kind: "panel", title: "Identical inputs",
      improvements: [
        { id: "groups", title: "Groups of labeling rows with an identical input and whether their drafts agree" },
        { id: "go", title: "Go to any copy in an identical-input group" },
      ],
      render: (h, ctx, api) => {
        if (ctx?.data?.prepared !== true) return h("p", { class: "faint" }, CLOSED);
        const groups = duplicateGroups(ctx);
        if (!groups.length) return h("p", { class: "faint" }, "No two rows in this slice share an input.");
        return h("ul", {}, groups.map(({ members, status }, position) => h("li", { "data-group": position + 1 },
          `Rows ${members.map((item) => item.row_number).join(", ")}: ${status} `,
          members.map((item) => h("button", { class: "btn sm ghost", "data-go": item.index, onclick: () => act(api, () => ctx.actions.goTo(item.index)) }, `Row ${item.row_number}`)))));
      } },

    // ---------- metrics ----------
    { id: "untouched_rows", kind: "metric", label: "rows with no draft yet in this slice", format: "integer",
      compute: (ctx) => {
        const list = itemsOf(ctx);
        return list.length ? { value: list.filter(untouched).length, detail: `of ${plural(list.length, "row")}` } : null;
      } },
    { id: "questions_done", kind: "metric", label: "questions fully drafted in this slice", format: "integer",
      help: "Questions every row of this slice that misses them has a draft for.",
      compute: (ctx) => {
        const list = itemsOf(ctx);
        const asked = questionsOf(ctx).map((question) => question.id).filter((qid) => list.some((item) => missingOf(item).includes(qid)));
        if (!asked.length) return null;
        const done = asked.filter((qid) => list.every((item) => !missingOf(item).includes(qid) || has(draftOf(item)[qid])));
        return { value: done.length, detail: done.length ? done.join(", ") : `none of ${asked.length}` };
      } },
    { id: "one_away_rows", kind: "metric", label: "shown rows one label from ready", format: "integer",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        return shown.length ? shown.filter(oneAway).length : null;
      } },
    { id: "drafted_rows_all", kind: "metric", label: "rows with drafts across all slices", format: "integer",
      help: "Rows Apply would write to, in every slice.",
      compute: (ctx) => (ctx?.data?.prepared === true && isObject(ctx.data.drafts)
        ? { value: ctx.data.drafts.rows, detail: plural(ctx.data.drafts.labels, "draft label") } : null) },

    // ---------- commands (no shortcuts: labeling keys stay inside the panel) ----------
    { id: "go_current", kind: "command", title: "Go back to the current labeling row", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => item.current === true),
      run: (ctx) => {
        const item = shownOf(ctx).find((entry) => entry.current === true);
        if (!item) throw new Error("No current row is shown.");
        return ctx.actions.goTo(item.index);
      } },
    { id: "next_untouched", kind: "command", title: "Go to the next shown labeling row with no draft", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some(untouched),
      run: (ctx) => goNext(ctx, untouched, "without a draft") },
    { id: "next_one_away", kind: "command", title: "Go to the next shown labeling row one label from ready", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some(oneAway),
      run: (ctx) => goNext(ctx, oneAway, "is one label from ready") },
    { id: "next_blank_choice", kind: "command", title: "Go to the next shown labeling row with a blank Choice label", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => blankOfType("choice")(item, ctx)),
      run: (ctx) => goNext(ctx, blankOfType("choice"), "has a blank Choice label") },
    { id: "next_blank_noul", kind: "command", title: "Go to the next shown labeling row with a blank Noul label", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => blankOfType("noul")(item, ctx)),
      run: (ctx) => goNext(ctx, blankOfType("noul"), "has a blank Noul label") },
    { id: "next_blank_score", kind: "command", title: "Go to the next shown labeling row with a blank Score label", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => blankOfType("score")(item, ctx)),
      run: (ctx) => goNext(ctx, blankOfType("score"), "has a blank Score label") },
  ],
});
