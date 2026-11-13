// More for the Workbench pre-run labeling queue ("workbench.labeling.queue"; contract in
// static/js/lab/surfaces/workbench-labeling.js): facts about what each row still needs (blank question types, the
// missing-question set, picture status, drafted Score level), advisory checks on drafts, pictures and guidelines,
// progress and label-balance metrics, exports with stated boundaries, and navigation commands without shortcuts.
// Draft labels are the user's own human labels: nothing here guesses a label from the input, shows a model answer,
// or applies or saves drafts. Guidelines are human-only and appear only in the export labeled as holding them.
import { csvText, definePack } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";
import { formatMarkdownTable } from "../../lib/tables.js";
import { fingerprint } from "../../lib/text.js";

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

// A question's type on a row: from the row's read-only questions, else from data.questions.
function typeOn(item, qid, ctx) {
  const fromItem = Array.isArray(item?.questions) ? item.questions.find((question) => question?.id === qid)?.type : null;
  if (typeof fromItem === "string" && fromItem) return fromItem;
  return questionsOf(ctx).find((question) => question.id === qid)?.type || "";
}

// A stored draft label as the option text the page shows: Noul yes/no, Score the level, Choice the key.
const labelText = (value) => (value === true ? "yes" : value === false ? "no" : has(value) ? String(value) : "");

// The input as one line for an export: the text row, or the object row's JSON without the picture name.
const inputLine = (row) => (typeof row === "string" ? row
  : isObject(row) ? JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_image"))) : "");

// How many queue rows share each input identity, cached per items() array.
const identityCache = new WeakMap();
function identityCounts(ctx) {
  const list = itemsOf(ctx);
  let counts = identityCache.get(list);
  if (!counts) {
    counts = new Map();
    for (const item of list) if (typeof item?.identity === "string") counts.set(item.identity, (counts.get(item.identity) || 0) + 1);
    identityCache.set(list, counts);
  }
  return counts;
}

// Draft labels of one question over some rows, as stored values.
const draftsFor = (rows, qid) => rows.filter((item) => missingOf(item).includes(qid)).map((item) => draftOf(item)[qid]).filter(has);

// The next shown row after the current one (in shown order, wrapping) that passes test; the current row comes last.
function nextShown(ctx, test) {
  const shown = shownOf(ctx);
  if (!shown.length) return null;
  const start = shown.findIndex((item) => item.current === true);
  for (let step = 1; step <= shown.length; step++) {
    const item = shown[(start + step + shown.length) % shown.length];
    if (test(item, ctx)) return item;
  }
  return null;
}
const goNext = (ctx, test, what) => {
  const item = nextShown(ctx, test);
  if (!item) throw new Error(`No shown row ${what}.`);
  return ctx.actions.goTo(item.index);
};
const currentOf = (ctx) => itemsOf(ctx).find((item) => item.current === true) || null;

const hasPicture = (item) => typeof item?.image === "string" && item.image !== "";
const isDuplicate = (item, ctx) => typeof item?.identity === "string" && (identityCounts(ctx).get(item.identity) || 0) > 1;
const partly = (item) => {
  const blank = blankOf(item).length;
  return blank > 0 && blank < missingOf(item).length;
};
const blankOfType = (type) => (item, ctx) => blankOf(item).some((qid) => typeOn(item, qid, ctx) === type);

// The slice as words for the status text.
function sliceText(slice) {
  if (!isObject(slice) || !slice.field) return "all rows";
  return slice.value === null || slice.value === undefined ? `${slice.field} (all values)` : `${slice.field} = ${slice.value}`;
}

export default definePack({
  id: "labeling-queue-more",
  surface: "workbench.labeling.queue",
  title: "Labeling queue: more facts, checks and progress",
  about: "Facts about what each labeling row still needs, advisory checks on drafts, pictures and guidelines, progress and label-balance metrics, exports and navigation commands for the pre-run labeling queue. Drafts stay the user's own human labels; exports state what they hold (guidelines only in the handbook), and nothing applies, saves or calls the model.",
  features: [
    // ---------- facts ----------
    { id: "row_number", kind: "fact", type: "number", label: "row number", help: "The row's number in the rows box, as the queue shows it (Row N). Use a range to split the work between people.",
      value: (item) => (Number.isInteger(item?.row_number) ? item.row_number : null) },
    { id: "score_level", kind: "fact", type: "number", label: "drafted Score level", help: "Your drafted Score level on this row (the mean when several Score questions have drafts). Blank without a Score draft.",
      value: (item, ctx) => {
        const levels = missingOf(item).filter((qid) => typeOn(item, qid, ctx) === "score")
          .map((qid) => draftOf(item)[qid]).filter((value) => Number.isInteger(value));
        return levels.length ? levels.reduce((total, value) => total + value, 0) / levels.length : null;
      } },
    { id: "current_row", kind: "fact", type: "flag", label: "current row", help: "The row Next incomplete row or your last label went to.",
      value: (item) => item?.current === true },
    { id: "blank_noul", kind: "fact", type: "flag", label: "blank Noul label", help: "A Noul (yes/no) question this row misses has no draft yet.",
      value: blankOfType("noul") },
    { id: "blank_choice", kind: "fact", type: "flag", label: "blank Choice label", help: "A Choice question this row misses has no draft yet.",
      value: blankOfType("choice") },
    { id: "blank_score", kind: "fact", type: "flag", label: "blank Score label", help: "A Score question this row misses has no draft yet.",
      value: blankOfType("score") },
    { id: "duplicate_all_blank", kind: "fact", type: "flag", label: "undrafted duplicate input", help: "The input appears on more than one queue row and none of those copies has a draft yet: label one, then copy it.",
      value: (item, ctx) => isDuplicate(item, ctx) && itemsOf(ctx).every((other) => other?.identity !== item.identity || !Object.keys(draftOf(other)).length) },
    { id: "first_blank_type", kind: "fact", type: "category", label: "type of the next blank question", help: "choice, noul or score: the type of the first question, in question order, still without a draft.",
      value: (item, ctx) => {
        const qid = blankOf(item)[0];
        return qid === undefined ? null : typeOn(item, qid, ctx) || null;
      } },
    { id: "picture_status", kind: "fact", type: "category", label: "picture status", help: "none (no picture), loaded (shown in the queue) or not loaded (named but not shown in this session).",
      value: (item) => (hasPicture(item) ? (item.picture_loaded === true ? "loaded" : "not loaded") : "none") },
    { id: "missing_set", kind: "fact", type: "category", label: "missing questions", help: "The questions this row needs a label for, joined with +. Rows in one group need the same work.",
      value: (item) => (missingOf(item).length ? missingOf(item).join("+") : null) },
    { id: "picture_name", kind: "fact", type: "category", label: "picture name", help: "The picture's name under _image; blank without a picture.",
      value: (item) => (hasPicture(item) ? item.image : null) },
    { id: "blank_questions", kind: "fact", type: "text", label: "blank questions", help: "The missing questions without a draft, in question order.",
      value: (item) => blankOf(item).join(", ") },

    // ---------- checks (advisory; nothing is repaired automatically) ----------
    { id: "picture_not_loaded", kind: "diagnostic", label: "Picture not loaded", severity: "advice",
      help: "The row names a picture this session has not loaded, so the queue cannot show it.",
      check: (item) => (hasPicture(item) && item.picture_loaded !== true
        ? `Row ${item.row_number} names the picture “${item.image}”, which is not loaded in this session. Label it once you can see the picture.` : null) },
    { id: "blank_field", kind: "diagnostic", label: "Blank text field", severity: "advice",
      help: "A top-level text field of an object row is empty or only spaces.",
      check: (item) => {
        if (!isObject(item?.row)) return null;
        const blank = Object.entries(item.row).filter(([key, value]) => key !== "_image" && typeof value === "string" && value.trim() === "").map(([key]) => key);
        return blank.length ? `Row ${item.row_number}: the ${blank.join(", ")} field${blank.length === 1 ? " is" : "s are"} blank. Check the input before you label it.` : null;
      } },
    { id: "duplicate_half_drafted", kind: "diagnostic", label: "Identical input drafted on another row", severity: "advice",
      help: "This row is blank for a question that a row with the identical input already drafts.",
      check: (item, ctx) => {
        if (typeof item?.identity !== "string") return null;
        const out = [];
        for (const qid of blankOf(item)) {
          for (const other of itemsOf(ctx)) {
            if (other === item || other?.index === item.index || other?.identity !== item.identity) continue;
            const theirs = draftOf(other)[qid];
            if (has(theirs) && missingOf(other).includes(qid)) {
              out.push(`Row ${item.row_number} has no ${qid} draft, but row ${other.row_number} with the same input drafts ${qid} = ${labelText(theirs)}. Copy drafts to identical inputs can fill it.`);
            }
          }
        }
        return out;
      } },
    { id: "unused_choice_option", kind: "diagnostic", label: "Choice option no draft uses", severity: "info", scope: "list",
      help: "A Choice question has at least as many drafts on the listed rows as it has options, yet one option is never drafted.",
      check: (items, ctx) => questionsOf(ctx).filter((question) => question.type === "choice").flatMap((question) => {
        const drafts = draftsFor(items, question.id);
        const used = new Set(drafts.map(String));
        const count = drafts.length;
        const unused = question.options.map((option) => String(option.value)).filter((value) => !used.has(value));
        return count >= question.options.length && unused.length ? [`${question.id}: ${plural(count, "draft")}, none uses ${unused.join(", ")}.`] : [];
      }) },
    { id: "one_label_only", kind: "diagnostic", label: "Every draft uses the same label", severity: "advice", scope: "list",
      help: "Three or more drafts of one question on the listed rows, all with the same label. Worth a second look before you apply.",
      check: (items, ctx) => questionsOf(ctx).flatMap((question) => {
        const values = items.filter((item) => missingOf(item).includes(question.id)).map((item) => draftOf(item)[question.id]).filter(has);
        return values.length >= 3 && new Set(values.map((value) => stableStringify(value))).size === 1
          ? [`${question.id}: all ${values.length} drafts are ${labelText(values[0])}.`] : [];
      }) },
    { id: "import_waiting", kind: "diagnostic", label: "Imported drafts wait for Accept", severity: "info", scope: "list",
      help: "A labeling CSV or draft file was previewed but not accepted yet.",
      check: (_items, ctx) => {
        const preview = ctx?.data?.csv_preview;
        return isObject(preview)
          ? `An import with ${plural(preview.labels, "draft label")} for ${plural(preview.matched, "matched row")} waits for Accept imported label drafts. Picking a label here or a Lab edit cancels it.` : null;
      } },
    { id: "undrafted_question", kind: "diagnostic", label: "Question with no draft yet", severity: "info", scope: "list",
      help: "A question the listed rows miss has no draft on any of them.",
      check: (items, ctx) => {
        const asked = questionsOf(ctx).map((question) => question.id).filter((qid) => items.some((item) => missingOf(item).includes(qid)));
        const none = asked.filter((qid) => !items.some((item) => missingOf(item).includes(qid) && has(draftOf(item)[qid])));
        return none.length ? `No draft yet for ${none.join(", ")} on the listed rows.` : null;
      } },
    { id: "score_middle_unused", kind: "diagnostic", label: "Score drafts skip the middle levels", severity: "advice", scope: "list",
      help: "Two or more drafts of a Score question with three or more levels, and none uses a level between 0 and the top level.",
      check: (items, ctx) => questionsOf(ctx).filter((question) => question.type === "score" && question.options.length >= 3).flatMap((question) => {
        const levels = items.filter((item) => missingOf(item).includes(question.id)).map((item) => draftOf(item)[question.id]).filter(Number.isInteger);
        const top = question.options.length - 1;
        if (levels.length < 2 || levels.some((level) => level > 0 && level < top)) return [];
        const used = [...new Set(levels)].sort((a, b) => a - b);
        const middle = question.options.slice(1, -1).map((option) => option.text).join(", ");
        return [`${question.id}: the ${levels.length} drafts use only level${used.length === 1 ? "" : "s"} ${used.join(" and ")}; none uses ${middle}.`];
      }) },
    { id: "guideline_no_examples", kind: "diagnostic", label: "Guideline note without examples", severity: "info", scope: "list",
      help: "A question the listed rows miss has a saved guideline note but no example.",
      check: (items, ctx) => {
        const guidelines = ctx?.data?.guidelines;
        if (!isObject(guidelines)) return null;
        return questionsOf(ctx).filter((question) => items.some((item) => missingOf(item).includes(question.id))
          && own(guidelines, question.id) && guidelines[question.id].note && !(guidelines[question.id].examples || []).length)
          .map((question) => `${question.id} has a guideline note but no examples. A made-up example or two shows labelers where the line is.`);
      } },

    // ---------- metrics (this queue and its drafts; nothing measures the model) ----------
    { id: "labels_left", kind: "metric", label: "blank labels left in this slice", format: "integer",
      help: "Missing labels without a draft over every row of this slice, whatever the filters show.",
      compute: (ctx) => {
        const list = itemsOf(ctx);
        if (!list.length) return null;
        const missing = list.reduce((total, item) => total + missingOf(item).length, 0);
        const blank = list.reduce((total, item) => total + blankOf(item).length, 0);
        return { value: blank, detail: `${missing - blank} of ${missing} labels drafted in this slice` };
      } },
    { id: "noul_yes_share", kind: "metric", label: "Noul drafts that are yes", format: "percent",
      help: "Among the Noul drafts on the shown rows.",
      compute: (ctx) => {
        const values = shownOf(ctx).flatMap((item) => missingOf(item).filter((qid) => typeOn(item, qid, ctx) === "noul").map((qid) => draftOf(item)[qid]))
          .filter((value) => value === true || value === false);
        return values.length ? { value: values.filter((value) => value === true).length / values.length,
          detail: `${values.filter((value) => value === true).length} of ${plural(values.length, "Noul draft")}` } : null;
      } },
    { id: "mean_score_draft", kind: "metric", label: "mean drafted Score level", format: "number",
      help: "The average drafted level over the Score drafts on the shown rows.",
      compute: (ctx) => {
        const values = shownOf(ctx).flatMap((item) => missingOf(item).filter((qid) => typeOn(item, qid, ctx) === "score").map((qid) => draftOf(item)[qid]))
          .filter(Number.isInteger);
        return values.length ? { value: values.reduce((total, value) => total + value, 0) / values.length, detail: plural(values.length, "Score draft") } : null;
      } },
    { id: "distinct_choice_keys", kind: "metric", label: "Choice options in use", format: "integer",
      help: "Different Choice labels (question and key) the drafts on the shown rows use, out of every Choice option.",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        const choices = questionsOf(ctx).filter((question) => question.type === "choice");
        if (!shown.length || !choices.length) return null;
        const used = new Set();
        for (const item of shown) for (const qid of missingOf(item)) {
          if (typeOn(item, qid, ctx) === "choice" && has(draftOf(item)[qid])) used.add(`${qid}=${draftOf(item)[qid]}`);
        }
        return { value: used.size, detail: `of ${plural(choices.reduce((total, question) => total + question.options.length, 0), "Choice option")}` };
      } },
    { id: "largest_label_share", kind: "metric", label: "largest share one label holds", format: "percent",
      help: "Over questions with two or more drafts on the shown rows: the biggest share of a question's drafts that one label takes. Ties go to the earlier question and option.",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        let best = null;
        for (const question of questionsOf(ctx)) {
          const values = shown.filter((item) => missingOf(item).includes(question.id)).map((item) => draftOf(item)[question.id]).filter(has);
          if (values.length < 2) continue;
          for (const option of question.options) {
            const count = values.filter((value) => value === option.value).length;
            if (count && (!best || count / values.length > best.share)) best = { share: count / values.length, question, option, count, total: values.length };
          }
        }
        return best ? { value: best.share, detail: `${best.question.id} = ${best.option.text}: ${best.count} of ${best.total} drafts` } : null;
      } },
    { id: "guideline_coverage", kind: "metric", label: "queue questions with a guideline", format: "percent",
      help: "Share of the queue's questions that have a saved labeling guideline. Blank until the guidelines load.",
      compute: (ctx) => {
        const guidelines = ctx?.data?.guidelines;
        const questions = questionsOf(ctx);
        if (!isObject(guidelines) || !questions.length) return null;
        const guided = questions.filter((question) => own(guidelines, question.id)).map((question) => question.id);
        return { value: guided.length / questions.length, detail: guided.length ? guided.join(", ") : "none" };
      } },
    { id: "outside_slice_share", kind: "metric", label: "drafts outside this slice", format: "percent",
      help: "Share of all draft labels that sit on rows outside the current slice. Apply includes them.",
      compute: (ctx) => {
        const drafts = ctx?.data?.drafts;
        if (ctx?.data?.prepared !== true || !isObject(drafts) || !(drafts.labels > 0)) return null;
        return { value: drafts.outside_slice / drafts.labels, detail: `${drafts.outside_slice} of ${plural(drafts.labels, "draft label")}` };
      } },

    // ---------- exports ----------
    { id: "drafts_md_table", kind: "exporter", label: "Shown rows with inputs and draft labels (Markdown table)", filename: "labeling-drafts-table.md", mime: "text/markdown",
      help: "One table row per shown row: the input, the picture name and your draft for each question (blank when none, — when the row is not missing that question). Inputs and human drafts only; never existing labels.",
      build: (ctx) => {
        const questions = questionsOf(ctx);
        const rows = shownOf(ctx).map((item) => [item.row_number, inputLine(item.row), hasPicture(item) ? item.image : "",
          ...questions.map((question) => (!missingOf(item).includes(question.id) ? "—" : has(draftOf(item)[question.id]) ? labelText(draftOf(item)[question.id]) : "blank"))]);
        const table = formatMarkdownTable(["Row", "Input", "Picture", ...questions.map((question) => question.id)], rows);
        return `# Shown rows with inputs and draft labels\n\nInputs and your draft labels only; pictures by name. “—” marks a question the row is not missing.\n\n${table}\n`;
      } },
    { id: "inputs_jsonl", kind: "exporter", label: "Shown inputs as JSON Lines (inputs only, no labels)", filename: "labeling-inputs.jsonl", mime: "application/x-ndjson",
      help: "One line per shown row: its row number and input, the picture by name. No draft labels.",
      build: (ctx) => shownOf(ctx).map((item) => `${JSON.stringify({ row: item.row_number, input: item.row })}\n`).join("") },
    { id: "blank_rows_csv", kind: "exporter", label: "Blank labels by question with row numbers (CSV, no inputs or labels)", filename: "labeling-blank-rows.csv", mime: "text/csv",
      help: "For each question: how many shown rows still need it and their row numbers. No inputs and no label values.",
      build: (ctx) => {
        const shown = shownOf(ctx);
        return csvText([["question", "type", "blank", "rows"], ...questionsOf(ctx).map((question) => {
          const rows = shown.filter((item) => blankOf(item).includes(question.id)).map((item) => item.row_number);
          return [question.id, question.type, rows.length, rows.join(" ")];
        })]);
      } },
    { id: "status_text", kind: "exporter", label: "Labeling progress update (text: dataset, slice and counts)", filename: "labeling-progress.txt",
      help: "For a status message: the dataset name, the slice, ready rows and drafted labels in this slice and draft labels across every slice. No inputs, labels or guidelines.",
      build: (ctx) => {
        if (ctx?.data?.prepared !== true) throw new Error("Open the queue with Label missing rows first.");
        const list = itemsOf(ctx);
        const ready = list.filter((item) => item.ready === true).length;
        const missing = list.reduce((total, item) => total + missingOf(item).length, 0);
        const blank = list.reduce((total, item) => total + blankOf(item).length, 0);
        const drafts = ctx.data.drafts;
        return [`Labeling progress: ${ctx.data.dataset?.name || "unsaved dataset"}`,
          `Slice: ${sliceText(ctx.data.slice)}`,
          `Rows: ${ready} of ${list.length} ready, ${list.length - ready} incomplete`,
          `Labels in this slice: ${missing - blank} of ${missing} drafted, ${blank} blank`,
          `Draft labels across all slices: ${drafts.labels} on ${plural(drafts.rows, "row")} (${drafts.outside_slice} outside this slice)`,
          "Drafts are not in the rows box until Apply, and not kept until Save dataset.", ""].join("\n");
      } },
    { id: "duplicate_groups_csv", kind: "exporter", label: "Identical-input groups (CSV, row numbers and a short input hash only)", filename: "labeling-duplicate-groups.csv", mime: "text/csv",
      help: "Each group of queue rows in this slice with an identical input: a short hash of the input, the number of copies and their row numbers. No inputs and no labels.",
      build: (ctx) => {
        const groups = new Map();
        for (const item of itemsOf(ctx)) {
          if (typeof item?.identity !== "string") continue;
          if (!groups.has(item.identity)) groups.set(item.identity, []);
          groups.get(item.identity).push(item.row_number);
        }
        const rows = [...groups].filter(([, members]) => members.length > 1)
          .map(([identity, members], position) => [position + 1, fingerprint(identity), members.length, members.join(" ")]);
        return csvText([["group", "input_hash", "copies", "rows"], ...rows]);
      } },
    { id: "guidelines_md", kind: "exporter", label: "Labeling guidelines handbook (Markdown, holds the guidelines)", filename: "labeling-guidelines.md", mime: "text/markdown",
      help: "The saved labeling guidelines for the queue's questions: notes and made-up examples, for the people labeling. Human-only: never sent to the model. No inputs or drafts.",
      build: (ctx) => {
        const guidelines = ctx?.data?.guidelines;
        if (!isObject(guidelines)) throw new Error("The guidelines are not loaded: save the dataset and open a label control first.");
        const lines = [`# Labeling guidelines: ${ctx.data.dataset?.name || "dataset"}`, "", "Human-only notes and made-up examples for the people labeling. Never sent to the model.", ""];
        for (const question of questionsOf(ctx)) {
          lines.push(`## ${question.id} (${question.type})`, "");
          const guideline = own(guidelines, question.id) ? guidelines[question.id] : null;
          if (!guideline) { lines.push("No guideline saved.", ""); continue; }
          if (guideline.note) lines.push(guideline.note, "");
          for (const example of guideline.examples || []) {
            lines.push(`- “${String(example.input).replace(/\s+/g, " ").trim()}” → ${example.label}${example.why ? ` (${example.why})` : ""}`);
          }
          if ((guideline.examples || []).length) lines.push("");
        }
        return `${lines.join("\n").trimEnd()}\n`;
      } },

    // ---------- commands (no shortcuts: labeling keys stay inside the panel; nothing applies or saves) ----------
    { id: "next_picture_row", kind: "command", title: "Go to the next shown labeling row with a picture", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some(hasPicture),
      run: (ctx) => goNext(ctx, hasPicture, "has a picture") },
    { id: "next_duplicate_row", kind: "command", title: "Go to the next shown labeling row with a duplicate input", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => isDuplicate(item, ctx)),
      run: (ctx) => goNext(ctx, isDuplicate, "has a duplicate input") },
    { id: "next_partial_row", kind: "command", title: "Go to the next shown partly drafted labeling row", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some(partly),
      run: (ctx) => goNext(ctx, partly, "is partly drafted") },
    { id: "last_incomplete", kind: "command", title: "Go to the last shown incomplete labeling row", group: "Labeling",
      when: (ctx) => workable(ctx) && shownOf(ctx).some((item) => item.ready !== true),
      run: (ctx) => {
        const item = shownOf(ctx).filter((entry) => entry.ready !== true).pop();
        if (!item) throw new Error("Every shown row is ready.");
        return ctx.actions.goTo(item.index);
      } },
    { id: "previous_incomplete", kind: "command", title: "Go to the previous incomplete labeling row", group: "Labeling",
      help: "The page's Ctrl/⌘+Shift+Enter from the palette: it sets the status filter to Incomplete.",
      when: (ctx) => workable(ctx) && itemsOf(ctx).some((item) => item.ready !== true),
      run: (ctx) => ctx.actions.next(-1) },
    { id: "copy_current_blank", kind: "command", title: "Copy the current labeling row's blank questions", group: "Labeling",
      when: (ctx) => blankOf(currentOf(ctx)).length > 0,
      run: (ctx) => {
        const item = currentOf(ctx);
        if (!item || !blankOf(item).length) throw new Error("The current row has no blank question.");
        ctx.env.copy(blankOf(item).join(", "));
        ctx.env.toast(`Copied ${plural(blankOf(item).length, "blank question")} of row ${item.row_number}.`);
      } },
    { id: "clear_current_drafts", kind: "command", title: "Clear the current labeling row's drafts", group: "Labeling",
      help: "Removes your draft labels from the current row only. Existing labels in the rows box are never touched.",
      when: (ctx) => workable(ctx) && Object.keys(draftOf(currentOf(ctx))).length > 0,
      run: (ctx) => {
        const item = currentOf(ctx);
        if (!item || !Object.keys(draftOf(item)).length) throw new Error("The current row has no draft to clear.");
        const next = itemsOf(ctx).map((entry) => ({ index: entry.index, row: entry.row, missing: entry.missing, draft: entry === item ? {} : draftOf(entry) }));
        ctx.actions.replaceItems(next, { label: "Clear the current row's drafts" });
        ctx.env.toast(`Cleared ${plural(Object.keys(draftOf(item)).length, "draft label")} on row ${item.row_number}.`);
      } },
  ],
});
