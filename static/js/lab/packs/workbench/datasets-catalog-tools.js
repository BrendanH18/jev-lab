// Catalog tools for the Workbench dataset catalog ("workbench.datasets.catalog"; contract in
// static/js/lab/surfaces/workbench-datasets.js): cross-dataset metrics, labeling and split exports, load/pin/copy
// commands, split planning tools and overview panels (workflow stages, question IDs, a labeling plan, the loaded
// dataset). Summary metadata only: ids, names, counts, flags and dates, never notes, inputs, label values, answers or
// check configuration. Pins are session-only, nothing here saves or deletes a dataset, and nothing calls the model.
import { compareText, csvText, definePack } from "../../kit.js";

const DAY_MS = 86400000;
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? ctx.shown() : []);
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? ctx.items() : []);
const loadedOf = (ctx) => itemsOf(ctx).find((item) => item.loaded) || null;
const labelEntries = (item) => (Array.isArray(item?.question_labels) ? item.question_labels : [])
  .filter((entry) => entry && typeof entry.id === "string" && Number.isInteger(entry.labeled) && entry.labeled > 0);

const STAGES = ["empty", "unlabeled", "labeling", "labeled", "split", "checked"];
function stageOf(item) {
  if (!item || !(item.rows > 0)) return "empty";
  if (item.has_check) return "checked";
  if (item.test) return "split";
  if (!(item.labeled > 0)) return "unlabeled";
  return item.labeled < item.rows ? "labeling" : "labeled";
}

// Question IDs with a label across the given datasets: [{ id, datasets: [ids], rows }], most datasets first, then A to Z.
function questionInventory(items) {
  const byId = new Map();
  for (const item of items) {
    for (const entry of labelEntries(item)) {
      const known = byId.get(entry.id) || { id: entry.id, datasets: [], rows: 0 };
      known.datasets.push(item.id);
      known.rows += entry.labeled;
      byId.set(entry.id, known);
    }
  }
  return [...byId.values()].sort((a, b) => b.datasets.length - a.datasets.length || compareText(a.id, b.id));
}

// Labeled rows that reach a share in percent of the rows (rounded up; the scaling keeps 33.3% of 3 at 1).
const labeledAtShare = (rows, target) => Math.ceil(Math.round(target * rows * 1e6) / 1e8);

// The held-out labeled rows nearest share% of the labeled rows with at least 2 on each side, ties to the larger count,
// as jev/testsplit.py picks when no duplicate inputs force a different count. Constant time: the nearest whole number
// with ties up is floor(target + 0.5), and clamping it into [2, labeled - 2] keeps it nearest. null under 4 rows.
function heldOutFor(labeled, share) {
  if (labeled < 4) return null;
  return Math.min(labeled - 2, Math.max(2, Math.floor(labeled * share / 100 + 0.5)));
}

const tsv = (rows) => rows.map((row) => row.map((cell) => oneLine(cell).replace(/\t/g, " ")).join("\t")).join("\n");

function pinFromPanel(ctx, api, ids, what) {
  try {
    ctx.actions.pin(ids, true);
    api.toast(`Pinned ${plural(ids.length, "dataset")} ${what} for this page session.`);
  } catch (error) {
    api.toast(error.message, "error");
  }
}

export default definePack({
  id: "datasets-catalog-tools",
  surface: "workbench.datasets.catalog",
  title: "Dataset catalog tools",
  about: "Cross-dataset metrics, labeling and split exports, load, pin and copy commands, split planning tools and overview panels for saved datasets. Summary metadata only: ids, names, counts, flags and dates, never notes, inputs, label values, answers or check configuration.",
  features: [
    // ---------- metrics ----------
    { id: "question_ids", kind: "metric", format: "integer", label: "Question IDs labeled across shown datasets",
      help: "Distinct question IDs that carry at least one saved label in a shown dataset.",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        return shown.length ? { value: questionInventory(shown).length, detail: `in ${plural(shown.length, "dataset")}` } : null;
      } },
    { id: "shared_question_ids", kind: "metric", format: "integer", label: "Question IDs labeled in two or more shown datasets",
      help: "Question IDs whose labels appear in more than one shown dataset; the detail names them.",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        if (!shown.length) return null;
        const shared = questionInventory(shown).filter((entry) => entry.datasets.length > 1);
        return { value: shared.length, detail: shared.map((entry) => entry.id).join(", ") };
      } },
    { id: "pinned_hidden", kind: "metric", format: "integer", label: "Pinned datasets hidden by filters",
      help: "Session pins on datasets the current filters hide; the detail names them.",
      compute: (ctx) => {
        if (!(ctx?.data?.total > 0)) return null;
        const shown = new Set(shownOf(ctx).map((item) => item.id));
        const hidden = (ctx.data.pinned_ids || []).filter((id) => !shown.has(id));
        return { value: hidden.length, detail: hidden.join(", ") };
      } },
    { id: "save_span_days", kind: "metric", format: "integer", label: "Days between the oldest and newest shown save",
      help: "Whole days from the earliest to the latest saved date among the shown datasets; undated datasets are left out.",
      compute: (ctx) => {
        const dated = shownOf(ctx).filter((item) => finite(item.saved_ms) !== null);
        if (!dated.length) return null;
        const times = dated.map((item) => item.saved_ms);
        const low = Math.min(...times), high = Math.max(...times);
        return { value: Math.floor((high - low) / DAY_MS),
          detail: `${new Date(low).toISOString().slice(0, 10)} to ${new Date(high).toISOString().slice(0, 10)}, ${plural(dated.length, "dated dataset")}` };
      } },
    { id: "largest_backlog", kind: "metric", format: "integer", label: "Most rows without a label in one shown dataset",
      help: "The largest count of rows with no saved label among the shown datasets; the detail names the first such dataset.",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        if (!shown.length) return null;
        const top = shown.reduce((best, item) => (count(item.unlabeled) > count(best.unlabeled) ? item : best));
        return { value: count(top.unlabeled), detail: count(top.unlabeled) ? top.id : "every shown row has a label" };
      } },

    // ---------- exports ----------
    { id: "labeling_checklist", kind: "exporter", label: "Shown datasets still to label as a Markdown checklist",
      filename: "jev-datasets-labeling-checklist.md", mime: "text/markdown",
      help: "One unchecked line per shown dataset with rows that have no saved label: ID, name and counts. No notes, inputs or label values.",
      build: (ctx) => {
        const open = shownOf(ctx).filter((item) => count(item.unlabeled) > 0);
        const lines = open.map((item) => `- [ ] ${item.id} (${oneLine(item.name)}): ${item.unlabeled} of ${plural(item.rows, "row")} without a label`);
        return `# Datasets still to label\n\n${lines.length ? lines.join("\n") : "Every shown dataset has a saved label on each row."}\n`;
      } },
    { id: "stage_ids", kind: "exporter", label: "Shown dataset IDs grouped by workflow stage", filename: "jev-datasets-by-stage.txt",
      help: "One line per stage (empty, unlabeled, labeling, labeled, split, checked) with the shown IDs in it. IDs and counts only.",
      build: (ctx) => {
        const shown = shownOf(ctx);
        return STAGES.map((stage) => [stage, shown.filter((item) => stageOf(item) === stage).map((item) => item.id)])
          .filter(([, ids]) => ids.length).map(([stage, ids]) => `${stage} (${ids.length}): ${ids.join(", ")}`).join("\n") + "\n";
      } },
    { id: "split_csv", kind: "exporter", label: "Held-out splits of the shown datasets (CSV)", filename: "jev-dataset-splits.csv", mime: "text/csv",
      help: "One line per shown dataset with a split: held-out rows, those with a label, labeled tuning rows, held-out share of labeled rows, recorded test looks and when the split was drawn. Counts and dates only, never scores or label values.",
      build: (ctx) => csvText([["dataset", "held_out_rows", "held_out_labeled", "tuning_labeled", "held_out_share", "test_looks", "drawn_at"],
        ...shownOf(ctx).filter((item) => item.test).map((item) => [item.id, item.held_out, item.held_out_labeled, item.tuning_labeled,
          finite(item.test.share) === null ? "" : Math.round(item.test.share * 1e4) / 1e4, count(item.test.looks), item.test.locked_at || ""])]) },

    // ---------- commands ----------
    { id: "load_next", kind: "command", title: "Load the next shown dataset", group: "Datasets",
      help: "The shown dataset after the loaded one, in the shown order; the first shown when the loaded one is hidden. The page asks before replacing unsaved rows.",
      when: (ctx) => {
        const shown = shownOf(ctx), at = shown.findIndex((item) => item.loaded);
        return at === -1 ? shown.length > 0 : at < shown.length - 1;
      },
      run: (ctx) => {
        const shown = shownOf(ctx), at = shown.findIndex((item) => item.loaded);
        return ctx.actions.load(shown[at + 1].id);
      } },
    { id: "load_previous", kind: "command", title: "Load the previous shown dataset", group: "Datasets",
      help: "The shown dataset before the loaded one; the last shown when the loaded one is hidden.",
      when: (ctx) => {
        const shown = shownOf(ctx), at = shown.findIndex((item) => item.loaded);
        return at === -1 ? shown.length > 0 : at > 0;
      },
      run: (ctx) => {
        const shown = shownOf(ctx), at = shown.findIndex((item) => item.loaded);
        return ctx.actions.load(shown[at === -1 ? shown.length - 1 : at - 1].id);
      } },
    { id: "load_most_unlabeled", kind: "command", title: "Load the shown dataset with the most rows to label", group: "Datasets",
      when: (ctx) => {
        const shown = shownOf(ctx).filter((item) => count(item.unlabeled) > 0);
        return shown.length > 0 && !shown.reduce((best, item) => (item.unlabeled > best.unlabeled ? item : best)).loaded;
      },
      run: (ctx) => {
        const top = shownOf(ctx).filter((item) => count(item.unlabeled) > 0).reduce((best, item) => (item.unlabeled > best.unlabeled ? item : best));
        return ctx.actions.load(top.id);
      } },
    { id: "pin_labeling", kind: "command", title: "Pin the shown datasets still being labeled", group: "Datasets",
      help: "Datasets with some rows labeled and some not. Session pins only; hidden pins are kept.",
      when: (ctx) => shownOf(ctx).some((item) => item.labeled > 0 && item.unlabeled > 0 && !item.pinned),
      run: (ctx) => {
        const ids = shownOf(ctx).filter((item) => item.labeled > 0 && item.unlabeled > 0 && !item.pinned).map((item) => item.id);
        ctx.actions.pin(ids, true);
        ctx.env?.toast?.(`Pinned ${plural(ids.length, "dataset")} still being labeled for this page session.`);
      } },
    { id: "pin_recent", kind: "command", title: "Pin the shown datasets saved in the last 7 days", group: "Datasets",
      when: (ctx) => shownOf(ctx).some((item) => !item.pinned && finite(item.saved_ms) !== null && item.saved_ms <= ctx.data.now && ctx.data.now - item.saved_ms < 7 * DAY_MS),
      run: (ctx) => {
        const now = ctx.data.now;
        const ids = shownOf(ctx).filter((item) => !item.pinned && finite(item.saved_ms) !== null && item.saved_ms <= now && now - item.saved_ms < 7 * DAY_MS).map((item) => item.id);
        ctx.actions.pin(ids, true);
        ctx.env?.toast?.(`Pinned ${plural(ids.length, "dataset")} saved in the last 7 days.`);
      } },
    { id: "unpin_without_check", kind: "command", title: "Unpin the shown datasets without a saved check", group: "Datasets",
      when: (ctx) => shownOf(ctx).some((item) => item.pinned && !item.has_check),
      run: (ctx) => {
        const ids = shownOf(ctx).filter((item) => item.pinned && !item.has_check).map((item) => item.id);
        ctx.actions.pin(ids, false);
        ctx.env?.toast?.(`Unpinned ${plural(ids.length, "dataset")} without a saved check.`);
      } },
    { id: "unpin_hidden", kind: "command", title: "Unpin the datasets hidden by filters", group: "Datasets",
      help: "Removes session pins from datasets the current filters hide; pins on shown datasets stay.",
      when: (ctx) => {
        const shown = new Set(shownOf(ctx).map((item) => item.id));
        return (ctx.data.pinned_ids || []).some((id) => !shown.has(id));
      },
      run: (ctx) => {
        const shown = new Set(shownOf(ctx).map((item) => item.id));
        const ids = ctx.data.pinned_ids.filter((id) => !shown.has(id));
        ctx.actions.pin(ids, false);
        ctx.env?.toast?.(`Unpinned ${plural(ids.length, "hidden dataset")}.`);
      } },
    { id: "open_first_agreement", kind: "command", title: "Open Label agreement for the first eligible shown dataset", group: "Datasets",
      help: "Opens the panel only; drawing a sample stays the panel's own button.",
      when: (ctx) => shownOf(ctx).some((item) => item.agreement_ready && !item.agreement_open),
      run: (ctx) => ctx.actions.openAgreement(shownOf(ctx).find((item) => item.agreement_ready && !item.agreement_open).id) },
    { id: "copy_loaded_name", kind: "command", title: "Copy the loaded dataset's name", group: "Datasets",
      when: (ctx) => !!loadedOf(ctx),
      run: (ctx) => ctx.env.copy(loadedOf(ctx).name) },
    { id: "copy_split_ready_ids", kind: "command", title: "Copy IDs of shown datasets ready for a test split", group: "Datasets",
      help: "Shown datasets with no split yet and at least 4 labeled rows, one ID per line.",
      when: (ctx) => shownOf(ctx).some((item) => item.split_ready),
      run: (ctx) => {
        const ids = shownOf(ctx).filter((item) => item.split_ready).map((item) => item.id);
        ctx.env.copy(ids.join("\n"));
        ctx.env.toast?.(`Copied ${plural(ids.length, "dataset ID")}.`);
      } },
    { id: "copy_never_scored_ids", kind: "command", title: "Copy IDs of shown splits never scored", group: "Datasets",
      help: "Shown datasets with held-out rows and no recorded test look, one ID per line.",
      when: (ctx) => shownOf(ctx).some((item) => item.test && count(item.test.looks) === 0),
      run: (ctx) => {
        const ids = shownOf(ctx).filter((item) => item.test && count(item.test.looks) === 0).map((item) => item.id);
        ctx.env.copy(ids.join("\n"));
        ctx.env.toast?.(`Copied ${plural(ids.length, "dataset ID")}.`);
      } },
    { id: "load_loaded_copy", kind: "command", title: "Load the loaded dataset as a copy", group: "Datasets",
      help: "The card's Load as copy: an unsaved copy under a new name; Save stays explicit. Not offered for datasets with held-out rows or test history.",
      when: (ctx) => {
        const loaded = loadedOf(ctx);
        return !!loaded && loaded.can_copy && !ctx.data.copy_busy;
      },
      run: (ctx) => ctx.actions.loadCopy(loadedOf(ctx).id) },
    { id: "download_loaded_bundle", kind: "command", title: "Download the loaded dataset's ZIP bundle", group: "Datasets",
      help: "The card's Download ZIP: inputs, human labels, configuration and pictures; never answers.",
      when: (ctx) => !!loadedOf(ctx),
      run: (ctx) => ctx.actions.downloadBundle(loadedOf(ctx).id) },

    // ---------- tools ----------
    { id: "split_plan", kind: "tool", title: "Held-out rows for a test share", group: "Datasets",
      help: "How many labeled rows a test split holds out: the count nearest the share with at least 2 labeled rows on each side, ties to the larger count. Assumes distinct inputs; exact duplicates stay together and can move the count.",
      inputs: [
        { name: "labeled", label: "Labeled rows", type: "integer", min: 0, default: 30 },
        { name: "share", label: "Held-out share (%)", type: "number", min: 10, max: 50, default: 25 },
      ],
      compute: ({ labeled, share }) => {
        if (labeled < 4) throw new Error("A test split needs at least 4 labeled rows: 2 on each side.");
        const held = heldOutFor(labeled, share);
        return [["Labeled rows held out", held], ["Labeled rows left for tuning", labeled - held], ["Held-out share of labeled rows (%)", Math.round(1000 * held / labeled) / 10]];
      } },
    { id: "tuning_size", kind: "tool", title: "Labeled rows for a tuning size after a split", group: "Datasets",
      help: "The fewest labeled rows that still leave a number of labeled tuning rows once a share is held out (0 for no split), counted as the split tool counts.",
      inputs: [
        { name: "tuning", label: "Labeled tuning rows wanted", type: "integer", min: 2, max: 100000, default: 100 },
        { name: "share", label: "Held-out share (%; 0 for no split)", type: "number", min: 0, max: 50, default: 25 },
        { name: "labeled", label: "Labeled rows now", type: "integer", min: 0, default: 0 },
      ],
      compute: ({ tuning, share, labeled }) => {
        let total = tuning, held = 0;
        if (share > 0) {
          for (total = Math.max(4, tuning); ; total++) {
            held = heldOutFor(total, share);
            if (total - held >= tuning) break;
          }
        }
        return [["Labeled rows needed", total], ["Held out at that size", held], ["Labeled tuning rows at that size", total - held], ["Rows still to label", Math.max(0, total - labeled)]];
      } },

    // ---------- panels ----------
    { id: "stages", kind: "panel", title: "Workflow stages of the shown datasets",
      improvements: [{ id: "table", title: "Count the shown datasets, rows and rows without a label at each workflow stage" },
        { id: "copy", title: "Copy the workflow stage table as tab-separated text" },
        { id: "pin", title: "Pin every shown dataset at one workflow stage from its row" }],
      render: (h, ctx, api) => {
        const shown = shownOf(ctx);
        if (!shown.length) return h("p", { class: "faint" }, "No dataset is shown.");
        const rows = STAGES.map((stage) => {
          const list = shown.filter((item) => stageOf(item) === stage);
          return { stage, ids: list.map((item) => item.id), rows: list.reduce((sum, item) => sum + count(item.rows), 0),
            unlabeled: list.reduce((sum, item) => sum + count(item.unlabeled), 0) };
        }).filter((row) => row.ids.length);
        const head = ["Stage", "Datasets", "Rows", "Rows without a label"];
        const text = tsv([head, ...rows.map((row) => [row.stage, row.ids.length, row.rows, row.unlabeled])]);
        return h("div", {},
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, [...head, ""].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-stage": row.stage },
              h("td", {}, row.stage), h("td", { class: "num" }, String(row.ids.length)), h("td", { class: "num" }, String(row.rows)),
              h("td", { class: "num" }, String(row.unlabeled)),
              h("td", {}, h("button", { class: "btn sm ghost", "data-pin-stage": row.stage, onclick: () => pinFromPanel(ctx, api, row.ids, `at the ${row.stage} stage`) }, "Pin")))))),
          h("button", { class: "btn sm ghost", "data-copy": "stages", onclick: () => api.copy(text) }, "Copy table"),
          h("p", { class: "faint" }, "Stages come from saved counts: any label counts as labeled, which says nothing about label validity. Pins last for this page session."));
      } },
    { id: "question_inventory", kind: "panel", title: "Question IDs across the shown datasets",
      improvements: [{ id: "table", title: "List each question ID labeled in the shown datasets with how many datasets and rows carry it" },
        { id: "copy", title: "Copy the question ID inventory as tab-separated text" }],
      render: (h, ctx, api) => {
        const list = questionInventory(shownOf(ctx));
        if (!list.length) return h("p", { class: "faint" }, "No shown dataset has a saved label.");
        const head = ["Question", "Datasets", "Labeled rows", "Dataset IDs"];
        const rows = list.map((entry) => [entry.id, entry.datasets.length, entry.rows, entry.datasets.join(", ")]);
        return h("div", {},
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, head.map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-question": row[0] }, row.map((cell, index) => h("td", { class: index === 1 || index === 2 ? "num" : null }, String(cell))))))),
          h("button", { class: "btn sm ghost", "data-copy": "questions", onclick: () => api.copy(tsv([head, ...rows])) }, "Copy inventory"),
          h("p", { class: "faint" }, "Question IDs and labeled-row counts only; IDs may name questions a dataset no longer saves."));
      } },
    { id: "labeling_plan", kind: "panel", title: "Labeling plan for the shown datasets",
      improvements: [{ id: "progress", title: "Show a labeling progress bar for each shown dataset with rows" },
        { id: "target", title: "Count the rows each shown dataset still needs labeled to reach a target share, with a total" },
        { id: "copy", title: "Copy the labeling plan as tab-separated text" }],
      render: (h, ctx, api) => {
        const raw = api.state.target ?? "100";
        const input = h("input", { type: "number", min: "0", max: "100", step: "1", value: raw, "aria-label": "Target labeled share (%)",
          oninput: (event) => { api.state.target = event.target.value; api.redraw(); } });
        const text = String(raw).trim();
        const target = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
        if (target === null || target > 100) return h("div", {}, h("label", {}, "Target labeled share (%) ", input), h("p", { class: "faint", "data-plan-error": "true" }, "Enter a share from 0 to 100."));
        const shown = shownOf(ctx).filter((item) => count(item.rows) > 0);
        if (!shown.length) return h("div", {}, h("label", {}, "Target labeled share (%) ", input), h("p", { class: "faint" }, "No shown dataset has rows."));
        const plan = shown.map((item) => ({ id: item.id, labeled: count(item.labeled), rows: item.rows,
          needed: Math.max(0, labeledAtShare(item.rows, target) - count(item.labeled)) }));
        const total = plan.reduce((sum, row) => sum + row.needed, 0);
        const head = ["Dataset", "Labeled", "Rows", `To label for ${target}%`];
        const copyText = tsv([head, ...plan.map((row) => [row.id, row.labeled, row.rows, row.needed]), ["Total", "", "", total]]);
        return h("div", {}, h("label", {}, "Target labeled share (%) ", input),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Dataset", "Progress", head[3]].map((label) => h("th", {}, label)))),
            h("tbody", {}, plan.map((row) => h("tr", { "data-dataset": row.id },
              h("td", {}, row.id),
              h("td", {}, h("progress", { max: String(row.rows), value: String(row.labeled), "aria-label": `${row.id}: ${row.labeled} of ${row.rows} rows labeled` }),
                ` ${row.labeled} / ${row.rows}`),
              h("td", { class: "num", "data-needed": String(row.needed) }, String(row.needed)))),
            h("tr", { "data-total": String(total) }, h("td", {}, "Total"), h("td", {}, ""), h("td", { class: "num" }, String(total))))),
          h("button", { class: "btn sm ghost", "data-copy": "plan", onclick: () => api.copy(copyText) }, "Copy plan"),
          h("p", { class: "faint" }, "Rows with any saved label count; held-out rows are included. This plans human work, it does not check label validity."));
      } },
    { id: "loaded_summary", kind: "panel", title: "Loaded dataset at a glance",
      improvements: [{ id: "summary", title: "Show the loaded dataset's counts and whether the current filters hide it" }],
      render: (h, ctx) => {
        const loaded = loadedOf(ctx);
        if (!loaded) return h("p", { class: "faint" }, "No saved dataset is loaded in the rows box.");
        const shown = shownOf(ctx).some((item) => item.id === loaded.id);
        const facts = [`${loaded.labeled} of ${plural(loaded.rows, "row")} labeled`, plural(loaded.questions, "saved question"),
          loaded.test ? `${loaded.held_out} held out, ${plural(count(loaded.test.looks), "test look")}` : "no test split",
          loaded.has_check ? "saved check" : "no saved check", loaded.pinned ? "pinned" : "not pinned"];
        return h("div", { "data-loaded": loaded.id },
          h("p", {}, h("strong", {}, oneLine(loaded.name)), ` (${loaded.id})`),
          h("ul", {}, facts.map((fact) => h("li", {}, fact))),
          h("p", { class: shown ? "faint" : "warn", "data-visibility": shown ? "shown" : "hidden" },
            shown ? "Shown in the catalog with the current filters." : "Hidden by the current filters; its card and open panels stay mounted."),
          ctx.data?.unsaved ? h("p", { class: "warn", "data-unsaved": "true" }, "The rows box has unsaved rows or labels.") : null);
      } },
  ],
});
