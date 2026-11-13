// Starter pack for the Workbench pre-run labeling queue ("workbench.labeling.queue"; contract in
// static/js/lab/surfaces/workbench-labeling.js): draft-progress and input facts, duplicate and partial-row checks,
// explicit draft edits, queue metrics, per-question progress, exports of the shown rows and three commands.
// Draft labels are the user's own human labels; nothing here guesses a label from the input or shows a model answer.
import { csvText, definePack } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const draftOf = (item) => (isObject(item?.draft) ? item.draft : {});
const missingOf = (item) => (Array.isArray(item?.missing) ? item.missing : []);
const has = (value) => value !== undefined && value !== null;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The text a person reads in a row: the row text, or every string value of an object row (nested ones too) except the
// picture name under "_image".
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
const inputText = (row) => inputStrings(row).filter((text) => text.trim() !== "").join(" · ");

// A draft label as its option text: Noul yes/no, Score the level, Choice the key.
const labelText = (value) => (value === true ? "yes" : value === false ? "no" : has(value) ? String(value) : "");
const typeOf = (item, qid) => (Array.isArray(item?.questions) ? item.questions.find((question) => question.id === qid)?.type || "" : "");

// How many queue rows share each input identity, cached per items() array (the surface returns the same array while
// the queue is unchanged).
const identityCache = new WeakMap();
function identityCounts(ctx) {
  const list = typeof ctx?.items === "function" ? ctx.items() : null;
  if (!Array.isArray(list)) return new Map();
  let counts = identityCache.get(list);
  if (!counts) {
    counts = new Map();
    for (const item of list) if (typeof item?.identity === "string") counts.set(item.identity, (counts.get(item.identity) || 0) + 1);
    identityCache.set(list, counts);
  }
  return counts;
}

// Per question over some rows: rows that miss it, drafted, blank. In data.questions order.
function tally(items, ctx) {
  const questions = Array.isArray(ctx?.data?.questions) ? ctx.data.questions : [];
  return questions.map((question) => {
    const rows = items.filter((item) => missingOf(item).includes(question.id));
    const drafted = rows.filter((item) => has(draftOf(item)[question.id])).length;
    return { id: question.id, type: question.type, missing: rows.length, drafted, blank: rows.length - drafted };
  });
}

const shownOf = (ctx) => (typeof ctx?.shown === "function" ? ctx.shown() : []);
const workable = (ctx) => ctx?.data?.prepared === true && ctx.data.busy !== true;

export default definePack({
  id: "labeling-queue-essentials",
  surface: "workbench.labeling.queue",
  title: "Labeling queue essentials",
  about: "Draft-progress and input facts, duplicate and partial-row checks, explicit draft edits, per-question progress and exports for the pre-run labeling queue. Draft labels stay the user's own human choices: nothing guesses a label, shows a model answer, or applies or saves drafts.",
  features: [
    // ---------- facts ----------
    { id: "missing_labels", kind: "fact", type: "number", label: "missing labels", help: "Questions this row still needs a human label for.",
      value: (item) => (Array.isArray(item?.missing) ? item.missing.length : null) },
    { id: "drafted_labels", kind: "fact", type: "number", label: "drafted labels", help: "Missing questions that have a draft label now.",
      value: (item) => (Array.isArray(item?.missing) ? missingOf(item).filter((qid) => has(draftOf(item)[qid])).length : null) },
    { id: "blank_labels", kind: "fact", type: "number", label: "blank labels", help: "Missing questions with no draft yet.",
      value: (item) => (Array.isArray(item?.missing) ? missingOf(item).filter((qid) => !has(draftOf(item)[qid])).length : null) },
    { id: "input_length", kind: "fact", type: "number", label: "input length", help: "Characters of text in the input (every string value; not the picture name).",
      value: (item) => (typeof item?.row === "string" || isObject(item?.row) ? inputStrings(item.row).reduce((total, text) => total + [...text].length, 0) : null) },
    { id: "picture", kind: "fact", type: "flag", label: "picture", help: "The row names a picture under _image.",
      value: (item) => typeof item?.image === "string" && item.image !== "" },
    { id: "partly_drafted", kind: "fact", type: "flag", label: "partly drafted", help: "Some, but not all, of the row's missing labels have a draft.",
      value: (item) => {
        const drafted = missingOf(item).filter((qid) => has(draftOf(item)[qid])).length;
        return drafted > 0 && drafted < missingOf(item).length;
      } },
    { id: "duplicate_input", kind: "fact", type: "flag", label: "duplicate input", help: "Another queue row in this slice has the identical input (labels ignored, picture name kept).",
      value: (item, ctx) => typeof item?.identity === "string" && (identityCounts(ctx).get(item.identity) || 0) > 1 },
    { id: "guided", kind: "fact", type: "flag", label: "saved guideline", help: "A question this row misses has a saved labeling guideline.",
      value: (item, ctx) => {
        const guidelines = ctx?.data?.guidelines;
        return isObject(guidelines) && missingOf(item).some((qid) => Object.prototype.hasOwnProperty.call(guidelines, qid));
      } },
    { id: "input_shape", kind: "fact", type: "category", label: "input shape", help: "text or object, as the rows box holds the row.",
      value: (item) => (item?.kind === "text" || item?.kind === "object" ? item.kind : null) },
    { id: "next_blank", kind: "fact", type: "category", label: "next blank question", help: "The first question, in question order, still without a draft on this row.",
      value: (item) => missingOf(item).find((qid) => !has(draftOf(item)[qid])) ?? null },
    { id: "input_text", kind: "fact", type: "text", label: "input text", help: "The row's text, or the string values of an object row joined with ·.",
      value: (item) => (typeof item?.row === "string" || isObject(item?.row) ? inputText(item.row) : "") },
    { id: "draft_labels", kind: "fact", type: "text", label: "draft labels", help: "This row's draft labels as question=label, e.g. topic=billing.",
      value: (item) => missingOf(item).filter((qid) => has(draftOf(item)[qid])).map((qid) => `${qid}=${labelText(draftOf(item)[qid])}`).join("; ") },

    // ---------- checks ----------
    { id: "draft_conflict", kind: "diagnostic", label: "Identical inputs with different drafts", severity: "problem",
      help: "Two queue rows with the same input should get the same human label.",
      check: (item, ctx) => {
        const list = typeof ctx?.items === "function" ? ctx.items() : [];
        const out = [];
        for (const [qid, value] of Object.entries(draftOf(item))) {
          for (const other of list) {
            if (other === item || other?.identity !== item.identity || other.index === item.index) continue;
            const theirs = draftOf(other)[qid];
            if (has(theirs) && stableStringify(theirs) !== stableStringify(value)) {
              out.push(`Row ${item.row_number} drafts ${qid} = ${labelText(value)}, but row ${other.row_number} has the same input with ${qid} = ${labelText(theirs)}.`);
            }
          }
        }
        return out;
      } },
    { id: "partial_row", kind: "diagnostic", label: "Partly drafted row", severity: "advice",
      check: (item) => {
        const blank = missingOf(item).filter((qid) => !has(draftOf(item)[qid]));
        const drafted = missingOf(item).length - blank.length;
        return drafted > 0 && blank.length
          ? `Row ${item.row_number}: ${drafted} of ${missingOf(item).length} labels drafted; ${blank.join(", ")} still blank. Apply saves the drafted ones and leaves the rest missing.` : null;
      } },
    { id: "drafts_elsewhere", kind: "diagnostic", label: "Drafts on rows not listed here", severity: "info", scope: "list",
      check: (items, ctx) => {
        const total = Number.isInteger(ctx?.data?.drafts?.labels) ? ctx.data.drafts.labels : 0;
        const listed = items.reduce((sum, item) => sum + Object.keys(draftOf(item)).length, 0);
        const elsewhere = total - listed;
        return elsewhere > 0 ? `${plural(elsewhere, "draft label")} sit on rows not listed here (other slices or filtered out). Apply includes them.` : null;
      } },
    { id: "unguided_questions", kind: "diagnostic", label: "Questions without a labeling guideline", severity: "advice", scope: "list",
      check: (items, ctx) => {
        const guidelines = ctx?.data?.guidelines;
        if (!isObject(guidelines)) return null;
        const asked = [...new Set(items.flatMap(missingOf))];
        const order = (Array.isArray(ctx.data.questions) ? ctx.data.questions : []).map((question) => question.id);
        const without = asked.filter((qid) => !Object.prototype.hasOwnProperty.call(guidelines, qid)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
        return without.length ? `No saved labeling guideline for ${without.join(", ")}. Write one under the dataset's Guidelines so every labeler decides the same way.` : null;
      } },

    // ---------- edits (drafts only; Apply and Save stay with the page) ----------
    { id: "clear_drafts", kind: "transform", label: "Clear the drafts on the shown rows",
      help: "Removes draft labels from the shown rows only. Existing labels in the rows box are never touched.",
      each: (item) => (Object.keys(draftOf(item)).length ? { ...item, draft: {} } : null) },
    { id: "set_label", kind: "transform", label: "Set one question's label on the shown rows",
      help: "Your human label for every shown row that misses this question. Rows with a draft keep it unless you tick replace.",
      params: [
        { name: "question", label: "Question id", type: "text", required: true },
        { name: "label", label: "Label (yes/no, a level number, or a Choice key)", type: "text", required: true },
        { name: "replace", label: "Replace existing drafts", type: "checkbox" },
      ],
      each: (item, params, ctx) => {
        const question = (Array.isArray(ctx?.data?.questions) ? ctx.data.questions : []).find((entry) => entry.id === params.question.trim());
        if (!question) throw new Error(`No question “${params.question.trim()}” in this labeling queue.`);
        const option = question.options.find((entry) => entry.text === params.label.trim());
        if (!option) throw new Error(`${question.id} takes one of: ${question.options.map((entry) => entry.text).join(", ")}.`);
        if (!missingOf(item).includes(question.id)) return null;
        if (has(draftOf(item)[question.id]) && !params.replace) return null;
        if (draftOf(item)[question.id] === option.value) return null;
        return { ...item, draft: { ...draftOf(item), [question.id]: option.value } };
      } },
    { id: "copy_duplicate_drafts", kind: "transform", label: "Copy drafts to identical inputs",
      help: "Where rows share an identical input and exactly one draft label exists for a question among them, the shown rows still blank for it get that label. Conflicting drafts are left alone.",
      all: (items, _params, _ctx, shown) => {
        const groups = new Map();
        // Transforms get copies with the stored fields only: the identity is the row's sorted-key JSON.
        items.forEach((item, index) => {
          const identity = stableStringify(item.row);
          if (!groups.has(identity)) groups.set(identity, []);
          groups.get(identity).push(index);
        });
        const next = items.map((item) => ({ ...item, draft: { ...draftOf(item) } }));
        for (const members of groups.values()) {
          if (members.length < 2) continue;
          const qids = [...new Set(members.flatMap((index) => missingOf(items[index])))];
          for (const qid of qids) {
            const values = new Map();
            for (const index of members) {
              const value = draftOf(items[index])[qid];
              if (has(value)) values.set(stableStringify(value), value);
            }
            if (values.size !== 1) continue;
            const [value] = values.values();
            for (const index of members) {
              if (shown.has(index) && missingOf(items[index]).includes(qid) && !has(draftOf(items[index])[qid])) next[index].draft[qid] = value;
            }
          }
        }
        return next.map((item, index) => (stableStringify(item.draft) === stableStringify(draftOf(items[index])) ? items[index] : item));
      } },

    // ---------- metrics ----------
    { id: "ready_share", kind: "metric", label: "shown rows ready", format: "percent",
      help: "Shown rows whose every missing label has a draft.",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        return shown.length ? { value: shown.filter((item) => item.ready === true).length / shown.length, detail: `${shown.filter((item) => item.ready === true).length} of ${shown.length} rows` } : null;
      } },
    { id: "shown_drafted", kind: "metric", label: "draft labels in shown rows", format: "integer",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        return shown.length ? shown.reduce((sum, item) => sum + missingOf(item).filter((qid) => has(draftOf(item)[qid])).length, 0) : null;
      } },
    { id: "top_blank_question", kind: "metric", label: "question with the most blank labels", format: "text",
      help: "Over the shown rows; on a tie, the earlier question.",
      compute: (ctx) => {
        let best = null;
        for (const entry of tally(shownOf(ctx), ctx)) if (entry.blank > 0 && (!best || entry.blank > best.blank)) best = entry;
        return best ? { value: best.id, detail: `${plural(best.blank, "blank label")}` } : null;
      } },
    { id: "distinct_inputs", kind: "metric", label: "distinct inputs in this slice", format: "integer",
      compute: (ctx) => {
        const list = typeof ctx?.items === "function" ? ctx.items() : [];
        if (!list.length) return null;
        const distinct = new Set(list.map((item) => item.identity)).size;
        return { value: distinct, detail: `${plural(list.length - distinct, "duplicate row")}` };
      } },

    // ---------- exports ----------
    { id: "drafts_csv", kind: "exporter", label: "Shown rows with inputs and draft labels (CSV)", filename: "labeling-queue-drafts.csv", mime: "text/csv",
      help: "One line per shown row and missing question: the input and your draft label (blank when none). Inputs and human drafts only; not the importable tuning labeling CSV. Pictures by name.",
      build: (ctx) => csvText([["row", "input", "picture", "question", "type", "draft"],
        ...shownOf(ctx).flatMap((item) => missingOf(item).map((qid) => [item.row_number,
          typeof item.row === "string" ? item.row : JSON.stringify(Object.fromEntries(Object.entries(item.row).filter(([key]) => key !== "_image"))),
          item.image || "", qid, typeOf(item, qid), labelText(draftOf(item)[qid])]))]) },
    { id: "checklist_md", kind: "exporter", label: "Labeling checklist of the shown rows (Markdown, with inputs)", filename: "labeling-checklist.md", mime: "text/markdown",
      help: "A to-do list to label away from the page: each shown row's input text and its missing questions with your drafts. Inputs and human drafts only; pictures by name.",
      build: (ctx) => {
        const shown = shownOf(ctx);
        const lines = ["# Labeling checklist", "", `${plural(shown.length, "row")} · inputs and your draft labels only; pictures by name.`, ""];
        for (const item of shown) {
          const labels = missingOf(item).map((qid) => `${qid}: ${has(draftOf(item)[qid]) ? labelText(draftOf(item)[qid]) : "blank"}`).join(" · ");
          lines.push(`- [${item.ready ? "x" : " "}] Row ${item.row_number} — ${labels}`);
          lines.push(`  > ${inputText(item.row).replace(/\s+/g, " ") || "(no text)"}${item.image ? ` (picture: ${item.image})` : ""}`);
        }
        return `${lines.join("\n")}\n`;
      } },
    { id: "question_tally_csv", kind: "exporter", label: "Missing, drafted and blank labels by question (CSV, counts only)", filename: "labeling-tally.csv", mime: "text/csv",
      help: "Counts over the shown rows. No inputs and no label values.",
      build: (ctx) => csvText([["question", "type", "rows_missing", "drafted", "blank"],
        ...tally(shownOf(ctx), ctx).map((entry) => [entry.id, entry.type, entry.missing, entry.drafted, entry.blank])]) },

    // ---------- commands (no shortcuts: labeling keys stay inside the panel) ----------
    { id: "first_incomplete", kind: "command", title: "Go to the first shown incomplete labeling row", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => item.ready !== true),
      run: (ctx) => {
        const item = shownOf(ctx).find((entry) => entry.ready !== true);
        if (!item) throw new Error("Every shown row is ready.");
        return ctx.actions.goTo(item.index);
      } },
    { id: "copy_row_numbers", kind: "command", title: "Copy the shown labeling row numbers", group: "Labeling",
      when: (ctx) => shownOf(ctx).length > 0,
      run: (ctx) => {
        const shown = shownOf(ctx);
        ctx.env.copy(shown.map((item) => item.row_number).join(", "));
        ctx.env.toast(`Copied ${plural(shown.length, "row number")}.`);
      } },
    { id: "copy_current_input", kind: "command", title: "Copy the current labeling row's input", group: "Labeling",
      when: (ctx) => (typeof ctx?.items === "function" ? ctx.items() : []).some((item) => item.current === true),
      run: (ctx) => {
        const item = ctx.items().find((entry) => entry.current === true);
        if (!item) throw new Error("No row is current. Use Next incomplete row first.");
        ctx.env.copy(typeof item.row === "string" ? item.row : JSON.stringify(item.row, null, 2));
        ctx.env.toast(`Copied the input of row ${item.row_number}.`);
      } },

    // ---------- panel ----------
    { id: "question_progress", kind: "panel", title: "Progress by question",
      improvements: [
        { id: "progress_table", title: "Rows missing, drafted and blank labels per question for the shown rows" },
        { id: "guideline_column", title: "Which questions have a saved labeling guideline, beside their progress" },
      ],
      render: (h, ctx) => {
        const rows = tally(shownOf(ctx), ctx);
        if (!rows.length) return h("p", { class: "faint" }, "Open the queue with Label missing rows to see progress by question.");
        const guidelines = ctx.data.guidelines;
        const guide = (qid) => (!isObject(guidelines) ? "not loaded" : Object.prototype.hasOwnProperty.call(guidelines, qid) ? "saved" : "none");
        return h("div", { class: "scroll" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["question", "type", "rows missing", "drafted", "blank", "guideline"].map((name) => h("th", {}, name)))),
          h("tbody", {}, rows.map((entry) => h("tr", { "data-question": entry.id },
            h("td", { class: "mono" }, entry.id), h("td", {}, entry.type), h("td", { class: "num" }, String(entry.missing)),
            h("td", { class: "num" }, String(entry.drafted)), h("td", { class: "num" }, String(entry.blank)), h("td", {}, guide(entry.id)))))));
      } },
  ],
});
