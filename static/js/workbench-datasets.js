// Saved datasets: save, load, delete, revision history and portable bundles, plus label agreement
// (jev/agreement.py) and held-out test rows (jev/testsplit.py).
import { $, api, copyText, h, handleError, icon, pct, stat, toast } from "./common.js";
import { secondItems, settleKey, settledItems, sessionItems, sessionSettlements, changeSecondLabel, agreementEditsUnsaved,
  restoreAgreementEdits, restoredChoices, unshownSettlements } from "./agreement.js";
import { catalogDefaults, matchesCatalog, sortedCatalog, catalogSummary, catalogCsv, catalogJson, catalogPreset, datasetCopyName, canCopyDataset, catalogProgress, catalogIds } from "./dataset-catalog.js";
import { createHistory } from "./history.js";
import { W, canon } from "./workbench-state.js";
import { render } from "./workbench.js";
import {
  rowsText, bulkUnsaved, replaceRows, loadPictureUrls, settleLabels, rowsPayload, bulkQuestions, isTest, rowText,
} from "./workbench-bulk.js";
import { checkItem } from "./workbench-checks.js";
import { preparedLabelsUnsaved } from "./workbench-labeling.js";
import { queueClasses, shownAnswer, confirmReviewDiscard } from "./workbench-review.js";
import { withCI, labelText, labelValue } from "./workbench-calibrate.js";
import { activeGates, policyRules, policyRows, updatePolicy } from "./workbench-policy.js";

// The server's file name for a dataset name (jev/workbench.py slugify), to warn before replacing one.
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function datasetChangeMessage(report) {
  const rows = report.rows, labels = report.labels, test = report.test;
  return `Replace the saved dataset “${report.id}”?\n\n`
    + `Inputs: ${rows.before} → ${rows.after} rows; ${rows.added} added, ${rows.removed} removed.\n`
    + `Human labels: ${labels.added} added, ${labels.removed} removed, ${labels.changed} changed.\n`
    + `Questions: ${report.questions_changed ? "changed" : "unchanged"}. Rules: ${report.rules_changed ? "changed" : "unchanged"}.\n`
    + `Name/notes: ${report.metadata_changed ? "changed" : "unchanged"}. Input order: ${rows.order_changed ? "changed" : "unchanged"}.\n`
    + `Saved check: ${report.check}.${report.check_dropped ? ` ${report.check_dropped}` : ""}\n`
    + `Held-out rows: ${test.before} → ${test.after}; ${test.changed_membership} matching inputs change split. Test history: ${test.history}.\n`
    + (W.guides?.changeText(report.guidelines) ?? "") + "\n"
    + "Counts include held-out label changes without showing their values. Duplicate inputs are paired in row order. "
    + "Changed inputs count as a removal and an addition. No model calls or file changes have been made by this preview.";
}

async function saveDataset() {
  const b = W.bulk;
  if (b.datasetSaveBusy) return;
  const d = b.dataset;
  const name = d.name.trim();
  if (!slugOf(name)) return toast("Give the dataset a name", "error");
  if (!settleLabels("Save the rows box")) return;
  const questions = d.withQuestions ? bulkQuestions() : null;
  const currentSpec = () => {
    const form = b.dataset;
    const q = form.withQuestions ? bulkQuestions() : null;
    return { name: form.name.trim(), notes: form.notes, rows: rowsPayload(),
      questions: q && Object.keys(q).length ? q : undefined, rules: b.rules.text.trim() || undefined };
  };
  const spec = currentSpec();
  const snapshot = JSON.stringify([spec, b.rowsText, b.labelsDirty]);
  const current = () => snapshot === JSON.stringify([currentSpec(), b.rowsText, b.labelsDirty]);
  b.datasetSaveBusy = true;
  try {
    const preview = await api("/api/workbench/datasets/preview", spec);
    if (!current()) return toast("Rows or dataset settings changed. Save again to preview the current changes.", "error");
    if (!confirmReviewDiscard(preview.id)) return;
    if (preview.exists && !confirm(datasetChangeMessage(preview))) return;
    const { dataset, check_dropped: dropped, guidelines_dropped: guidesDropped } = await api("/api/workbench/datasets", { ...spec, preview_revision: preview.revision });
    if (current()) {
      b.savedText = b.rowsText;
      b.labelsDirty = false;
      d.id = dataset.id;
      d.name = dataset.name;
      // Match the file: a dataset saved without questions offers none, as when it is loaded.
      d.questions = questions && Object.keys(questions).length ? questions : null;
      if (!d.questions && b.source === "dataset") b.source = "current";
    } else toast("The previewed dataset was saved. Newer editor changes remain unsaved.", "error");
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    toast(`Saved ${dataset.rows} rows (${dataset.labeled} labeled) to data/workbench/datasets/${dataset.id}.json`);
    if (dropped) toast(`Removed the dataset's check: ${dropped}`, "error");
    if (guidesDropped?.length) toast(guidesDropped.join(". "), "error");
  } catch (e) { handleError(e); }
  finally { b.datasetSaveBusy = false; render(); }
}

async function loadDataset(id) {
  const b = W.bulk;
  try {
    const { dataset } = await api("/api/workbench/datasets/load", { id });
    if (!replaceRows(rowsText(dataset.rows), `“${dataset.name || id}”`)) return;
    b.dataset = { id, name: dataset.name || id, notes: dataset.notes || "", withQuestions: !!dataset.questions, questions: dataset.questions || null };
    b.checkSlices = { datasetId: id, targets: (dataset.check?.slice_targets || []).map((t) => ({ ...t })) };
    b.rules = { ...b.rules, text: dataset.rules || "", applied: "", checked: "", report: null, error: null };
    if (dataset.questions) b.source = "dataset";
    else if (b.source === "dataset") b.source = "current";
    toast(`Loaded ${dataset.rows.length} rows. Run them to get answers.`);
    render();
  } catch (e) { handleError(e); }
}

async function loadDatasetCopy(id) {
  const b = W.bulk;
  if (b.datasetCopyBusy) return;
  const context = () => JSON.stringify([b.rowsText, b.labelsDirty, b.dataset, b.source, b.rules.text]);
  const before = context();
  b.datasetCopyBusy = true;
  render();
  try {
    const { dataset } = await api("/api/workbench/datasets/load", { id });
    if (before !== context()) return toast("The editor changed while loading. Load the copy again when ready.", "error");
    if (!canCopyDataset(dataset)) return toast("This dataset has test history. Download and import its ZIP to preserve that history in a copy.", "error");
    if (preparedLabelsUnsaved() && !confirm("Load a dataset copy with unapplied labeling drafts? Apply or download the drafts first to keep them; different inputs or questions make these drafts unavailable.")) return;
    if (!replaceRows(rowsText(dataset.rows), `a copy of “${dataset.name || id}”`)) return;
    b.dataset = { id: null, name: datasetCopyName(dataset.name || id, b.datasets), notes: dataset.notes || "",
      withQuestions: !!dataset.questions, questions: dataset.questions || null };
    b.savedText = "";
    b.result = null;
    b.testScore = null;
    b.checkSlices = { datasetId: null, targets: null };
    b.rules = { ...b.rules, text: dataset.rules || "", applied: "", checked: "", report: null, error: null };
    if (dataset.questions) b.source = "dataset";
    else if (b.source === "dataset") b.source = "current";
    toast(`Loaded an unsaved copy as “${b.dataset.name}”. Save explicitly to create it. Saved checks and guidelines stay with the original.`);
  } catch (e) { handleError(e); }
  finally { b.datasetCopyBusy = false; render(); }
}

async function deleteDataset(id) {
  const b = W.bulk;
  if (!confirmReviewDiscard(id)) return;
  if (!confirm(`Delete the dataset “${id}”? This removes data/workbench/datasets/${id}.json; its history keeps a copy you can restore.`)) return;
  try {
    await api("/api/workbench/datasets/delete", { id });
    if (b.dataset.id === id) b.dataset.id = null;
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    render();
  } catch (e) { handleError(e); }
}

// Dataset revisions (static/js/history.js): after a restore, drop reports about the replaced file and reload it.
const datasetHistory = createHistory({ h, api, toast, handleError, render: () => render(), beforeRestore: confirmReviewDiscard, afterRestore: async (id) => {
  const b = W.bulk;
  delete b.checkRuns[id];
  delete b.agreeRuns[id];
  if (b.dataset.id === id) b.testScore = null;
  b.datasets = (await api("/api/workbench/datasets")).datasets;
  await loadDataset(id);
} });

async function exportBundle(id) {
  try {
    const { filename, data } = await api("/api/workbench/datasets/bundle/export", { id });
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const link = h("a", { href: url, download: filename });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { handleError(e); }
}

async function previewBundle(file) {
  if (!file) return;
  const b = W.bulk.bundle;
  b.data = b.report = null;
  b.busy = true;
  render();
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error("Dataset bundles must be at most 8 MiB.");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Could not read the bundle."));
      reader.readAsDataURL(file);
    });
    b.report = await api("/api/workbench/datasets/bundle/preview", { data });
    b.data = data;
    b.name = b.report.dataset.name;
  } catch (e) { handleError(e); }
  b.busy = false;
  render();
}

async function importBundle() {
  const bulk = W.bulk;
  const b = bulk.bundle;
  const name = b.name.trim();
  const id = slugOf(name);
  if (!id) return toast("Give the imported dataset a name", "error");
  const replace = bulk.datasets.some((x) => x.id === id);
  if (!confirmReviewDiscard(id)) return;
  if (replace && !confirm(`Replace the saved dataset “${id}” with this bundle, including its check and test history?`)) return;
  b.busy = true;
  render();
  try {
    await api("/api/workbench/datasets/bundle/import", { data: b.data, name, replace });
    // Reports and linked editors for an overwritten dataset refer to the old file.
    delete bulk.checkRuns[id];
    delete bulk.agreeRuns[id];
    if (bulk.dataset.id === id) {
      bulk.dataset.id = null;
      bulk.testScore = null;
    }
    bulk.datasets = (await api("/api/workbench/datasets")).datasets;
    b.data = b.report = null;
    toast(`Imported “${name}”. Load it to work with its rows; run it to get answers.`);
  } catch (e) { handleError(e); }
  b.busy = false;
  render();
}

function bundleImportForm() {
  const b = W.bulk.bundle;
  const file = h("input", { type: "file", accept: ".zip,application/zip", disabled: b.busy,
    "aria-label": "Choose dataset bundle", onchange: () => previewBundle(file.files[0]) });
  const name = h("input", { class: "input", value: b.name, disabled: b.busy, "aria-label": "Imported dataset name" });
  name.addEventListener("input", () => { b.name = name.value; });
  const d = b.report?.dataset;
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("b", {}, "Import dataset bundle"), file,
    h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "Preview a ZIP before saving. Bundles carry rows, human labels, questions, gate settings, test history, and pictures. No model calls. Limit: 8 MiB. Review your input data before sharing it."),
    b.busy ? h("p", { class: "faint" }, "Reading or saving bundle…") : null,
    d ? h("div", { class: "grid", style: { gap: "6px" } },
      h("span", { class: "muted" }, `${d.rows.length} rows · ${Object.keys(d.questions || {}).length} questions · ${b.report.images} pictures · ${d.check ? "saved check" : "no check"} · ${d.test ? `${d.test.looks.length} test evaluations` : "no test history"}`),
      h("details", {}, h("summary", {}, "Preview dataset contents"),
        h("pre", { class: "code", style: { maxHeight: "240px", overflow: "auto" } }, JSON.stringify(d, null, 2))),
      name,
      h("div", {}, h("button", { class: "btn sm primary", disabled: b.busy, onclick: importBundle }, "Import bundle"),
        h("button", { class: "btn sm ghost", disabled: b.busy, onclick: () => { b.data = b.report = null; render(); } }, "Cancel"))) : null);
}

export function renderDatasets() {
  const b = W.bulk;
  const d = b.dataset;
  const filters = b.datasetSearch = { ...catalogDefaults(), ...b.datasetSearch };
  const name = h("input", { class: "input", placeholder: "Dataset name, e.g. Support tickets, March", value: d.name, "aria-label": "Dataset name" });
  name.addEventListener("input", () => { d.name = name.value; });
  const notes = h("input", { class: "input", placeholder: "Notes (optional)", value: d.notes, "aria-label": "Dataset notes" });
  notes.addEventListener("input", () => { d.notes = notes.value; });
  const withQ = h("input", { type: "checkbox", checked: d.withQuestions });
  withQ.addEventListener("change", () => { d.withQuestions = withQ.checked; });
  const labeledText = (x) => `${x.rows} row${x.rows === 1 ? "" : "s"} · ${x.labeled} labeled`
    + (x.questions ? ` · ${x.questions} question${x.questions === 1 ? "" : "s"}` : "");
  return h("div", { class: "panel datasets", id: "datasets" },
    h("div", { class: "panel-head" }, h("h2", {}, "Datasets · data/workbench/datasets/"), h("div", { class: "spacer" }),
      h("span", { class: "badge warning", id: "ds-unsaved", style: { display: bulkUnsaved() ? "" : "none" }, title: "A reload would lose these rows or labels" }, "Unsaved rows or labels")),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("div", { class: "grid", style: { gap: "6px" } }, name, notes,
        h("label", { class: "toggle", style: { gap: "6px" } }, withQ, h("span", { class: "track" }), "Save the selected questions with the rows"),
        h("div", {}, h("button", { class: "btn sm", onclick: saveDataset }, icon("check"), "Save rows and labels"))),
      h("p", { class: "faint", style: { fontSize: "12px" } }, "Saves the rows box, with the labels you chose in the results table, as one JSON file you can commit. Only rows and labels are saved, never answers: run a loaded dataset to get answers."),
      bundleImportForm(),
      b.datasets.some((x) => x.check) ? h("datalist", { id: "cmp-models" }, (W.compare.models || []).map((n) => h("option", { value: n }))) : null,
      datasetSearchControls(filters),
      b.datasets.length ? h("div", { id: "dataset-search-results" }, sortedCatalog(b.datasets, filters.sort, filters.pinnedIds).map((x) => h("div", { class: "item dataset-search-item", "data-dataset-id": x.id,
        style: { display: matchesCatalog(x, filters) ? "" : "none" } },
        h("div", { class: "grid", style: { gap: "2px" } },
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
            h("b", {}, x.name || x.id), h("code", { class: "faint" }, x.id), x.id === d.id ? h("span", { class: "badge" }, "loaded") : null),
          h("span", { class: "faint", style: { fontSize: "12px" } }, labeledText(x) + (x.saved_at ? ` · saved ${x.saved_at.slice(0, 10)}` : "")),
          h("span", { class: "faint", style: { fontSize: "12px" } }, catalogProgress(x)),
          x.notes ? h("span", { class: "muted", style: { fontSize: "12px" } }, x.notes) : null),
        h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
          h("button", { class: "btn sm", "aria-label": `Pin dataset ${x.id}`, "aria-pressed": String(filters.pinnedIds.includes(x.id)),
            onclick: (event) => {
              const index = filters.pinnedIds.indexOf(x.id);
              if (index < 0) filters.pinnedIds.push(x.id); else filters.pinnedIds.splice(index, 1);
              event.currentTarget.setAttribute("aria-pressed", String(index < 0));
              event.currentTarget.textContent = index < 0 ? "Unpin" : "Pin";
              $("#dataset-catalog-pin-filter")?.dispatchEvent(new Event("change"));
            } }, filters.pinnedIds.includes(x.id) ? "Unpin" : "Pin"),
          h("button", { class: "btn sm", onclick: () => loadDataset(x.id) }, "Load"),
          h("button", { class: "btn sm", disabled: b.datasetCopyBusy || !canCopyDataset(x),
            title: canCopyDataset(x) ? "Load rows, labels, questions and rules under a new name; save explicitly" : "Use Download ZIP and Import to copy the held-out evaluation history too",
            onclick: () => loadDatasetCopy(x.id) }, "Load as copy"),
          h("button", { class: "btn sm", onclick: () => exportBundle(x.id) }, "Download ZIP"),
          x.labeled && x.questions ? agreeButton(x) : null,
          testControl(x),
          x.id === d.id ? datasetHistory.button(x.id) : null,
          W.guides?.toggle(x),
          h("button", { class: "btn sm ghost danger", "aria-label": `Delete ${x.id}`, onclick: () => deleteDataset(x.id) }, icon("trash"))),
        x.check ? checkItem(x) : null,
        b.agreeRuns[x.id]?.open ? agreePanel(x) : null,
        W.guides?.panel(x),
        x.id === d.id ? datasetHistory.panel(x.id) : null)))
        : h("div", { class: "empty" }, "No saved datasets yet. Label some rows, name them, and save."),
      datasetHistory.deleted()));
}

// Filtering keeps every queue mounted, so hidden human edits remain intact.
function datasetSearchControls(filters) {
  const visible = () => sortedCatalog(W.bulk.datasets, filters.sort, filters.pinnedIds).filter((item) => matchesCatalog(item, filters));
  const update = () => {
    const shown = visible();
    const matches = new Set(shown.map((item) => item.id));
    const list = $("#dataset-search-results");
    const nodes = new Map([...(list?.querySelectorAll(".dataset-search-item") || [])].map((row) => [row.dataset.datasetId, row]));
    sortedCatalog(W.bulk.datasets, filters.sort, filters.pinnedIds).forEach((item) => {
      const row = nodes.get(item.id);
      if (row) { row.style.display = matches.has(item.id) ? "" : "none"; list.append(row); }
    });
    const count = $("#dataset-search-count");
    if (count) count.textContent = `${matches.size} of ${W.bulk.datasets.length} datasets shown`;
    const summary = $("#dataset-search-summary");
    if (summary) summary.textContent = catalogSummary(shown);
    const empty = $("#dataset-search-empty");
    if (empty) empty.hidden = !W.bulk.datasets.length || !!shown.length;
    const download = $("#dataset-catalog-download");
    if (download) download.disabled = !shown.length;
    const idsCopy = $("#dataset-catalog-copy-ids");
    if (idsCopy) idsCopy.disabled = !shown.length;
    const jsonDownload = $("#dataset-catalog-json");
    if (jsonDownload) jsonDownload.disabled = !shown.length;
  };
  const controls = {};
  const search = h("input", { class: "input", type: "search", value: filters.query, placeholder: "Search datasets by name or notes",
    "aria-label": "Search datasets", oninput: (event) => { filters.query = event.target.value; update(); } });
  const select = (key, label, options) => controls[key] = h("select", { class: "input", id: key === "pinned" ? "dataset-catalog-pin-filter" : undefined, "aria-label": label,
    onchange: (event) => { filters[key] = event.target.value; update(); } },
  options.map(([value, text]) => h("option", { value, selected: filters[key] === value }, text)));
  const countFilter = (key, label) => h("label", { class: "faint" }, label, " ",
    controls[key] = h("input", { class: "input sm", type: "number", min: 0, step: 1,
      value: filters[key], "aria-label": label, style: { width: "90px" },
      oninput: (event) => { filters[key] = event.target.value; update(); } }));
  const applyFilters = (next) => {
    const pins = filters.pinnedIds;
    Object.assign(filters, next, { pinnedIds: pins });
    search.value = filters.query;
    for (const [key, element] of Object.entries(controls)) element.value = filters[key];
    update();
  };
  const clear = () => {
    applyFilters(catalogDefaults());
    search.focus();
  };
  const shown = visible();
  return h("div", { class: "grid", style: { gap: "6px" } }, search,
    h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      select("searchField", "Dataset search field", [["all", "Name, ID and notes"], ["name", "Name only"], ["id", "ID only"], ["notes", "Notes only"]]),
      controls.exclude = h("input", { class: "input", type: "search", value: filters.exclude, placeholder: "Exclude matching phrase", "aria-label": "Exclude dataset phrase",
        oninput: (event) => { filters.exclude = event.target.value; update(); } }),
      select("notes", "Filter datasets by notes", [["all", "Any notes"], ["with", "With notes"], ["without", "Without notes"]]),
      h("label", { class: "faint" }, "Quick view ", h("select", { class: "input", "aria-label": "Dataset workflow preset",
        onchange: (event) => { applyFilters(catalogPreset(event.target.value)); event.target.value = ""; } },
        h("option", { value: "" }, "Choose a workflow…"), h("option", { value: "label" }, "Continue partial labeling"),
        h("option", { value: "unlabeled" }, "Start labeling"), h("option", { value: "check" }, "Prepare a saved check"))),
      select("pinned", "Filter pinned datasets", [["all", "All pins"], ["with", "Pinned datasets only"], ["without", "Unpinned datasets only"]]),
      select("check", "Filter datasets by saved check", [["all", "All checks"], ["with", "With a saved check"], ["without", "Without a saved check"]]),
      select("labels", "Filter datasets by labeling status", [["all", "All labeling states"], ["none", "No rows labeled"],
        ["some", "Some rows labeled"], ["every", "Every row has a label"]]),
      select("questions", "Filter datasets by saved questions", [["all", "All question states"], ["with", "With saved questions"], ["without", "Without saved questions"]]),
      select("test", "Filter datasets by held-out split", [["all", "All test splits"], ["with", "With held-out rows"], ["without", "Without held-out rows"]]),
      select("guidelines", "Filter datasets by labeling guidelines", [["all", "All guideline states"], ["with", "With guidelines"], ["without", "Without guidelines"]]),
      select("sort", "Sort datasets", [["saved", "Saved order"], ["pinned", "Pinned first"], ["label-share-desc", "Highest labeled share first"], ["newest", "Newest saved first"], ["oldest", "Oldest saved first"], ["label-share", "Lowest labeled share first"], ["name", "Name A–Z"], ["name-desc", "Name Z–A"],
        ["rows", "Most rows first"], ["rows-asc", "Fewest rows first"], ["labeled", "Most labeled rows first"],
        ["unlabeled", "Most rows without labels"], ["questions", "Most questions first"], ["held-out", "Most held-out rows first"], ["labeled-asc", "Fewest labeled rows first"],
        ["unlabeled-asc", "Fewest rows without labels"], ["questions-asc", "Fewest questions first"],
        ["held-out-asc", "Fewest held-out rows first"], ["guidelines", "Most guideline questions first"]])),
    h("details", {}, h("summary", {}, "Filter by counts"),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", paddingTop: "8px" } },
        countFilter("minRows", "Minimum rows"), countFilter("maxRows", "Maximum rows"),
        countFilter("minLabeled", "Minimum labeled rows"), countFilter("maxLabeled", "Maximum labeled rows"), countFilter("minUnlabeled", "Minimum rows without labels"),
        countFilter("minQuestions", "Minimum saved questions"), countFilter("maxQuestions", "Maximum saved questions"),
        countFilter("maxUnlabeled", "Maximum rows without labels"), countFilter("minHeldOut", "Minimum held-out rows"),
        countFilter("maxHeldOut", "Maximum held-out rows"), countFilter("minGuidelines", "Minimum guideline questions"),
        countFilter("maxGuidelines", "Maximum guideline questions"),
        ...[["minLabelShare", "Minimum labeled share (%)"], ["maxLabelShare", "Maximum labeled share (%)"]].map(([key, label]) =>
          h("label", { class: "faint" }, label, " ", controls[key] = h("input", { class: "input sm", type: "number", min: 0, max: 100, step: "any",
            value: filters[key], "aria-label": label, style: { width: "90px" }, oninput: (event) => { filters[key] = event.target.value; update(); } }))))),
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
      ...[["savedAfter", "Saved on or after"], ["savedBefore", "Saved on or before"]].map(([key, label]) =>
        h("label", { class: "faint" }, label, " ", controls[key] = h("input", { class: "input", type: "date", value: filters[key],
          "aria-label": label, oninput: (event) => { filters[key] = event.target.value; update(); } })))),
    h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      h("button", { class: "btn sm ghost", onclick: clear }, "Clear dataset filters"),
      h("button", { class: "btn sm", id: "dataset-catalog-copy-ids", disabled: !shown.length,
        onclick: () => { const items = visible(); if (items.length) copyText(catalogIds(items)); } }, "Copy shown dataset IDs"),
      h("button", { class: "btn sm", id: "dataset-catalog-download", disabled: !shown.length,
        title: "Names and counts for the shown datasets, without inputs, label values or check configuration", onclick: () => {
          const items = visible();
          if (!items.length) return;
          const url = URL.createObjectURL(new Blob([catalogCsv(items)], { type: "text/csv;charset=utf-8" }));
          h("a", { href: url, download: "jev-dataset-catalog.csv" }).click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } }, "Download shown catalog CSV"),
      h("button", { class: "btn sm", id: "dataset-catalog-json", disabled: !shown.length, onclick: () => {
        const items = visible();
        if (!items.length) return;
        const url = URL.createObjectURL(new Blob([catalogJson(items)], { type: "application/json" }));
        h("a", { href: url, download: "jev-dataset-catalog.json" }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } }, "Download shown catalog JSON")),
    h("span", { class: "faint", id: "dataset-search-count", "aria-live": "polite" }, `${shown.length} of ${W.bulk.datasets.length} datasets shown`),
    h("span", { class: "faint", id: "dataset-search-summary" }, catalogSummary(shown)),
    h("div", { class: "empty", id: "dataset-search-empty", hidden: !W.bulk.datasets.length || !!shown.length },
      "No datasets match these filters. ", h("button", { class: "btn sm", onclick: clear }, "Show all datasets")),
    h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } }, "A labeled row has at least one saved label; this does not establish complete or valid labels. Filters only change the list shown. Pins last for this page session; clearing filters keeps them."));
}

// ---------- Label agreement ----------
// jev/agreement.py draws a random sample of a dataset's labeled rows and returns them without their labels, so a second
// person can label them blind, here or in a downloaded CSV. Comparing the two label sets shows, per question, how often
// two people agree and Cohen's kappa; the rows where they differ can be settled and written back to the dataset, rows
// and labels only. Nothing here calls the model.
function agreeRun(id) {
  return W.bulk.agreeRuns[id] || (W.bulk.agreeRuns[id] = { open: false, rows: "30", busy: false, sample: null, labels: {},
    report: null, choices: {}, pendingSettlements: [], sessionPreview: null, problem: null });
}

export function agreementSessionsUnsaved(id = null) {
  return Object.entries(W.bulk.agreeRuns || {}).some(([key, run]) => (id === null || key === id) && agreementEditsUnsaved(run));
}

export function confirmAgreementDiscard(id) {
  return !agreementSessionsUnsaved(id)
    || window.confirm("This changes the saved dataset used by unfinished Label agreement edits. Download the agreement session first to keep a copy. Continue?");
}

const agreementEditContext = (run) => JSON.stringify([run.sample?.session_context, run.labels, run.choices, run.pendingSettlements]);

function agreementSessionPanel(id, run) {
  const file = h("input", { type: "file", accept: ".json,application/json", hidden: true,
    "aria-label": `Restore agreement session for ${id}`, onchange: async () => {
      const selected = file.files[0];
      if (!selected) return;
      try {
        if (selected.size > 1024 * 1024) throw new Error("Agreement session must be at most 1 MiB.");
        await previewAgreementSession(id, JSON.parse(await selected.text()));
      } catch (e) { handleError(e); }
      file.value = "";
    } });
  const preview = run.sessionPreview;
  return h("div", { class: "grid", style: { gap: "6px" } },
    h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      h("button", { class: "btn sm", disabled: run.busy || !run.sample?.session_context,
        onclick: () => downloadAgreementSession(id) }, "Download agreement session"),
      h("button", { class: "btn sm", disabled: run.busy, onclick: () => file.click() }, "Restore agreement session"), file),
    h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "Recovery keeps your second labels, explicit settlement choices, and original sample. Restore needs the unchanged saved dataset and questions; saved labels stay hidden until you press Compare. Pictures travel separately."),
    run.sample && !run.sample.session_context ? h("p", { class: "faint" },
      "Saving settlements changed this dataset. Remaining labels stay on this page, but the original session can no longer be downloaded. Download before saving settlements when you need recovery.") : null,
    run.pendingSettlements?.length ? h("p", { class: "faint" }, `${run.pendingSettlements.length} restored settlement choices will appear after Compare.`) : null,
    preview ? h("div", { class: "callout" }, h("div", {},
      h("b", {}, "Agreement session preview"),
      h("p", { class: "muted" }, `${preview.result.counts.rows} sampled rows · ${preview.result.counts.labels} second labels · ${preview.result.counts.settlements} settlement choices. No saved changes or model calls.`),
      h("button", { class: "btn sm primary", disabled: run.busy, onclick: () => acceptAgreementSession(id) }, "Accept restored agreement session"),
      h("button", { class: "btn sm ghost", disabled: run.busy, onclick: () => { run.sessionPreview = null; render(); } }, "Cancel restore"))) : null);
}

async function downloadAgreementSession(id) {
  const run = agreeRun(id), sample = run.sample;
  if (run.busy || !sample?.session_context) return;
  run.busy = true;
  render();
  try {
    const session = await api("/api/workbench/datasets/agreement/session/export", {
      id, context: sample.session_context, rows: sample.sample_size, seed: sample.seed,
      items: sessionItems(run.labels),
      settlements: [...(run.pendingSettlements || []), ...sessionSettlements(run.choices)],
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: `${id}-agreement-session.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Downloaded agreement session. Keep the unchanged saved dataset to restore it.");
  } catch (e) { handleError(e); }
  finally { run.busy = false; render(); }
}

async function previewAgreementSession(id, session) {
  const run = agreeRun(id);
  if (run.busy) return;
  const context = agreementEditContext(run);
  run.busy = true;
  run.sessionPreview = null;
  render();
  try {
    const result = await api("/api/workbench/datasets/agreement/session/import", { id, session });
    if (W.bulk.agreeRuns[id] === run && agreementEditContext(run) === context) run.sessionPreview = { session, result, context };
  } catch (e) { handleError(e); }
  finally { run.busy = false; render(); }
}

async function acceptAgreementSession(id) {
  const run = agreeRun(id), preview = run.sessionPreview;
  if (run.busy || !preview || agreementEditContext(run) !== preview.context) return;
  if (agreementEditsUnsaved(run) && !window.confirm("Replace the current agreement labels and settlement choices with this session?")) return;
  run.busy = true;
  render();
  try {
    const result = await api("/api/workbench/datasets/agreement/session/import", { id, session: preview.session });
    if (W.bulk.agreeRuns[id] !== run || run.sessionPreview !== preview || agreementEditContext(run) !== preview.context) return;
    run.sample = result.sample;
    Object.assign(run, restoreAgreementEdits(result));
    run.rows = String(result.sample.sample_size);
    run.report = null;
    run.choices = {};
    run.sessionPreview = null;
    await loadPictureUrls(result.sample.items);
    toast("Restored human agreement edits. Compare explicitly to see saved labels; Save settled labels remains separate.");
  } catch (e) { handleError(e); }
  finally { run.busy = false; render(); }
}

function agreeButton(x) {
  const a = agreeRun(x.id);
  return h("button", { class: `btn sm${a.open ? " active" : ""}`, "aria-expanded": String(a.open),
    title: "Have a second person label a sample of these rows blind, and measure how often the two agree",
    onclick: () => { a.open = !a.open; render(); } }, icon("eye"), "Label agreement");
}

function agreePanel(x) {
  const a = agreeRun(x.id);
  const rows = h("input", { class: "input sm", type: "number", min: "1", max: "200", step: "1", value: a.rows, style: { width: "70px" },
    "aria-label": `Rows to sample from ${x.id}` });
  rows.addEventListener("input", () => { a.rows = rows.value; });
  return h("div", { class: "check-item agree" },
    h("p", { class: "muted", style: { fontSize: "12.5px", margin: 0 } },
      "Every accuracy here compares answers with these labels, so it is only as good as they are. Draw a random sample of the labeled rows, and have someone who did not label them label it again, without looking at the saved labels: here, or in the CSV. ",
      "The comparison shows, for each question, how often the two agree and Cohen's kappa, the agreement beyond chance. Nothing here calls the model."),
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      h("label", { class: "faint", style: { fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" } }, "Sample", rows, "labeled rows"),
      h("button", { class: "btn sm", disabled: a.busy, onclick: () => drawAgreeSample(x.id) },
        a.busy && !a.sample ? [h("span", { class: "spin" }), " Drawing…"] : [icon("layers"), a.sample ? "Draw a new sample" : "Draw sample"])),
    agreementSessionPanel(x.id, a),
    a.sample ? agreeSampleView(x, a) : null,
    a.report ? agreeReport(x, a) : null);
}

async function drawAgreeSample(id) {
  const a = agreeRun(id);
  const n = Number(a.rows || 0);
  if (!Number.isInteger(n) || n < 1 || n > 200) return toast("Sample a whole number of rows, from 1 to 200", "error");
  if (agreementEditsUnsaved(a) && !confirm("Draw a new sample? Download the agreement session first to keep the labels given on this one.")) return;
  a.busy = true;
  render();
  try {
    // A fresh seed each time: a second draw from the same dataset is a different sample.
    a.sample = await api("/api/workbench/datasets/agreement/sample", { id, rows: n, seed: Math.floor(Math.random() * 2 ** 31) });
    a.labels = {};
    a.report = null;
    a.choices = {};
    a.pendingSettlements = [];
    a.sessionPreview = null;
    await loadPictureUrls(a.sample.items);
  } catch (e) { handleError(e); }
  a.busy = false;
  render();
}

function agreeSampleView(x, a) {
  const s = a.sample;
  const given = secondItems(s.items, a.labels).length;
  const card = (item) => {
    const labels = a.labels[item.row_id] || (a.labels[item.row_id] = Object.create(null));  // a question id may be __proto__
    const done = item.questions.every((q) => labels[q] !== null && labels[q] !== undefined);
    const picture = W.bulk.pictures[item.row?._image];
    return h("div", { class: `queue-item${done ? " done" : ""}` },
      h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
        h("span", { class: "faint mono", style: { fontSize: "11.5px" } }, `row ${item.number}`),
        done ? h("span", { class: "badge good" }, icon("check"), "labeled") : null),
      picture ? h("img", { src: picture, alt: item.row._image, class: "row-thumb" }) : null,
      h("div", { class: "row-text" }, rowText(item.row)),
      h("div", { class: "queue-labels" }, item.questions.map((qid) => {
        const question = s.questions[qid];
        const current = labelText(labels[qid], question.type);
        const sel = h("select", { class: "input label-sel", disabled: a.busy, "aria-label": `Second label for ${qid} on row ${item.number}` },
          h("option", { value: "", selected: !current }, "—"),
          queueClasses(question).map((c) => h("option", { value: c, selected: c === current },
            question.type === "score" ? `${c} · ${String(question.criteria[Number(c)] ?? "").slice(0, 32)}` : c)));
        sel.addEventListener("change", () => {
          changeSecondLabel(a, item.row_id, qid, labelValue(sel.value, question.type));
          render();
        });
        return h("label", { class: "queue-label" }, h("span", { class: "mono" }, qid), sel, W.guides?.hint(x.id, qid, question, { row: item.row, blind: true }));
      })));
  };
  const file = h("input", { type: "file", accept: ".csv,.tsv,.txt", style: { display: "none" } });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (f) await compareAgreement(x.id, await f.text());
  });
  const download = () => {
    const url = URL.createObjectURL(new Blob([s.csv], { type: "text/csv" }));
    const link = h("a", { href: url, download: `${x.id}-second-labels.csv` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url));
  };
  return h("div", { class: "grid", style: { gap: "8px" } },
    h("div", { class: "faint", style: { fontSize: "12px" } },
      `${s.items.length} of ${s.eligible} labeled rows, drawn at random. Each row asks only the questions its saved labels cover, since only those are compared. `,
      "The saved labels stay hidden until you compare; the rows box shows them if this dataset is loaded there, so label from this list."),
    agreeQuestions(s.questions),
    h("div", { class: "queue-list" }, s.items.map(card)),
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm primary", disabled: a.busy || !given, onclick: () => compareAgreement(x.id) },
        a.busy ? [h("span", { class: "spin" }), " Comparing…"] : [icon("check"), `Compare ${given} labeled row${given === 1 ? "" : "s"}`]),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "or"),
      h("button", { class: "btn sm ghost", onclick: download }, icon("save"), "Download CSV"),
      h("button", { class: "btn sm ghost", disabled: a.busy, onclick: () => file.click() }, "Compare a filled-in CSV"), file),
    h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "The CSV has the rows without their labels and an empty ", h("code", {}, "label:<question>"),
      " column for each question; a \"-\" marks a label the saved labels do not have. Keep its ", h("code", {}, "row_id"),
      " column. Share the questions' instructions with the person labeling, as the model reads them."));
}

// The questions as the model reads them, so the second person labels by the same instructions and options.
export function agreeQuestions(questions) {
  const text = (v) => (v === null || v === undefined || typeof v === "string" ? v || "" : JSON.stringify(v));  // instructions may be JSON
  const options = (q) => (q.type === "noul" ? [["yes", q.criteria?.true], ["no", q.criteria?.false]].filter(([, d]) => d) : q.type === "score"
    ? q.criteria.map((d, i) => [String(i), d]) : Object.entries(q.criteria || {}));
  return h("details", { open: true },
    h("summary", { class: "muted", style: { fontSize: "12.5px" } }, "The questions, as the model reads them"),
    h("dl", { style: { fontSize: "12.5px", margin: "6px 0 0" } }, Object.entries(questions).map(([qid, q]) => [
      h("dt", { class: "mono" }, qid, h("span", { class: "faint" }, ` · ${q.type === "noul" ? "yes or no" : q.type}`)),
      h("dd", { style: { margin: "2px 0 8px 14px" } }, text(q.instructions),
        options(q).length ? h("ul", { class: "faint", style: { margin: "2px 0 0", paddingLeft: "18px" } },
          options(q).map(([name, d]) => h("li", {}, h("b", {}, name), d && d !== name ? ` · ${text(d)}` : ""))) : null)])));
}

async function compareAgreement(id, text = null) {
  const a = agreeRun(id);
  if (a.busy) return;
  if (Object.keys(a.choices).length && !confirm("Compare again and clear the current settlement choices? Download an agreement session first to keep them.")) return;
  a.busy = true;
  render();
  try {
    const body = text === null ? { id, items: secondItems(a.sample.items, a.labels) } : { id, text };
    a.report = await api("/api/workbench/datasets/agreement", body);
    if (text !== null) {
      a.labels = Object.fromEntries((a.report.second_items || []).map((item) => [item.row_id, { ...item.labels }]));
    }
    a.choices = restoredChoices(a.report.disagreements, a.pendingSettlements);
    a.pendingSettlements = unshownSettlements(a.report.disagreements, a.pendingSettlements);
    a.sessionPreview = null;
  } catch (e) { handleError(e); }
  a.busy = false;
  render();
  $(`#agree-${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const kappaText = (k) => (k === null || k === undefined ? "—" : k.toFixed(2));

function agreeReport(x, a) {
  const rep = a.report;
  const o = rep.overall;
  const c = rep.counts;
  const questions = a.sample?.questions || {};
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const notes = [
    c.not_found ? `${plural(c.not_found, "row")} not in the dataset any more, or changed since the sample` : null,
    c.repeated ? `${plural(c.repeated, "row")} given twice, read once` : null,
    c.unlabeled ? `${plural(c.unlabeled, "row")} with no label to compare` : null,
    c.only_second ? `${plural(c.only_second, "label")} for questions the saved labels leave empty, not compared` : null,
  ].filter(Boolean);
  const settled = settledItems(rep.disagreements, a.choices);
  const settleSelect = (d) => {
    const question = questions[d.question] || { type: typeof d.first === "boolean" ? "noul" : typeof d.first === "number" ? "score" : "choice", criteria: {} };
    const key = settleKey(d.row_id, d.question);
    const value = Object.prototype.hasOwnProperty.call(a.choices, key) ? a.choices[key] : d.first;
    const current = labelText(value, question.type);
    const options = [...new Set([...queueClasses(question), labelText(d.first, question.type), labelText(d.second, question.type)])];
    const sel = h("select", { class: "input label-sel", disabled: a.busy, "aria-label": `Settle ${d.question} on row ${d.number}` },
      h("option", { value: "", selected: !current }, "no label"),
      options.map((v) => h("option", { value: v, selected: v === current }, v)));
    sel.addEventListener("change", () => { a.choices[key] = labelValue(sel.value, question.type); a.sessionPreview = null; render(); });
    return sel;
  };
  return h("div", { class: "check-report grid", id: `agree-${x.id}`, style: { gap: "8px" } },
    h("div", { class: "stat-row" },
      stat("labels that agree", o.labels ? `${o.agree} of ${o.labels} · ${pct(o.agreement, 1)}` : "—"),
      stat("rows that agree on every question", o.rows ? withCI(`${o.rows_agree} of ${o.rows} · ${pct(o.rows_agreement, 1)}`, o.rows_low, o.rows_high) : "—")),
    notes.length ? h("div", { class: "faint", style: { fontSize: "12px" } }, notes.join(" · ")) : null,
    rep.problems_total ? h("details", {},
      h("summary", { class: "muted", style: { fontSize: "12.5px" } }, `${plural(rep.problems_total, "label")} that fit no answer, skipped`),
      h("ul", { class: "faint", style: { fontSize: "12px", margin: "4px 0 0", paddingLeft: "18px" } },
        rep.problems.map((p) => h("li", {}, p)),
        rep.problems_total > rep.problems.length ? h("li", {}, `…and ${rep.problems_total - rep.problems.length} more`) : null)) : null,
    Object.keys(rep.questions).length ? h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, ["question", "rows", "agree", "Cohen's kappa", "most common difference"].map((t) => h("th", {}, t)))),
      h("tbody", {}, Object.entries(rep.questions).map(([qid, q]) => h("tr", {},
        h("td", { class: "mono" }, qid),
        h("td", {}, String(q.rows)),
        h("td", {}, withCI(`${q.agree} · ${pct(q.agreement, 1)}`, q.low, q.high)),
        h("td", { title: q.kappa === null ? "Both gave every row the same label, so agreement beyond chance cannot be measured" : "" }, kappaText(q.kappa)),
        h("td", { style: { fontSize: "12px" } }, q.mixups.length
          ? `saved ${shownAnswer(q.mixups[0].first)}, second ${shownAnswer(q.mixups[0].second)} · ${plural(q.mixups[0].rows, "row")}` : "none"))))))
      : h("div", { class: "empty" }, "No label was given by both. Label the sample's questions, or check the CSV's label columns."),
    rep.disagreements.length ? [
      h("h3", { class: "cal-h" }, `Where they differ · ${rep.disagreements_total}`),
      h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
        "Settle each one: keep the saved label, take the second, choose another, or leave the row unlabeled for that question. A difference often means the question can be read two ways; sharpen its instructions or option descriptions too."),
      h("div", { class: "scroll" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, ["row", "question", "saved", "second", "settle as"].map((t) => h("th", {}, t)))),
        h("tbody", {}, rep.disagreements.map((d) => h("tr", {},
          h("td", { class: "row", style: { maxWidth: "320px" } }, h("span", { class: "faint mono" }, `${d.number} `), rowText(d.row)),
          h("td", { class: "mono" }, d.question),
          h("td", {}, shownAnswer(d.first)),
          h("td", {}, shownAnswer(d.second)),
          h("td", {}, settleSelect(d))))))),
      rep.disagreements_total > rep.disagreements.length
        ? h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } }, `Showing the first ${rep.disagreements.length}; settle these and compare again for the rest.`) : null,
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        h("button", { class: "btn sm primary", disabled: a.busy || !settled.length, onclick: () => saveSettled(x.id) },
          icon("save"), settled.length ? `Save settled labels on ${settled.length} row${settled.length === 1 ? "" : "s"} to “${x.name || x.id}”` : "Save settled labels"),
        h("span", { class: "faint", style: { fontSize: "12px" } }, "Only labels that change the saved one are written. Rows and labels are saved, never answers."))] : null,
    h("p", { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "Kappa is 1 when the two always agree and 0 when they agree only as often as two people labeling at random with the same label mix would. ",
      "When two people agree on fewer labels than a target accuracy, an accuracy measured near that target depends on who labeled the rows as much as on the model: settle the differences, or sharpen the question, before you tune to it. ",
      o.rows && o.rows < 50 ? `${plural(o.rows, "row")} give a wide interval; sample more to rely on it.` : ""));
}

async function saveSettled(id) {
  const b = W.bulk;
  const a = agreeRun(id);
  const items = settledItems(a.report.disagreements, a.choices);
  if (!items.length) return;
  const remaining = !!a.pendingSettlements?.length || a.report.disagreements_total > a.report.disagreements.length
    || a.report.disagreements.some((item) => !Object.prototype.hasOwnProperty.call(a.choices, settleKey(item.row_id, item.question)));
  if (remaining && !window.confirm("Saving these settlements changes the dataset and prevents downloading the remaining agreement edits as a session. Those edits stay on this page. Download the agreement session first if you need recovery. Save these settled labels anyway?")) return;
  a.busy = true;
  render();
  try {
    const out = await api("/api/workbench/datasets/agreement/settle", { id, items });
    a.sample.session_context = null;
    a.sessionPreview = null;
    // The rows box holds the labels as they were, and saving it replaces the file: unlink it until fresh rows are in,
    // so a failed refresh below cannot leave a save that undoes the settled labels.
    const loaded = b.dataset.id === id;
    if (loaded) b.dataset.id = null;
    a.report.disagreements = a.report.disagreements.filter((d) => !Object.prototype.hasOwnProperty.call(a.choices, settleKey(d.row_id, d.question)));
    a.choices = {};
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    if (loaded) {
      // Refresh the box when it has no unsaved edits; otherwise it stays unlinked, so a save under this name asks first.
      if (!bulkUnsaved()) {
        b.rowsText = b.savedText = rowsText((await api("/api/workbench/datasets/load", { id })).dataset.rows);
        b.dataset.id = id;
      } else {
        toast("The rows box has unsaved edits, so it still shows this dataset with its old labels. Saving it under the same name asks before it replaces the file.", "error");
      }
    }
    toast(`Changed ${out.changed} label${out.changed === 1 ? "" : "s"} on ${out.rows} row${out.rows === 1 ? "" : "s"} of data/workbench/datasets/${id}.json. Run the dataset again to score against them.`);
  } catch (e) { handleError(e); }
  a.busy = false;
  render();
}

// ---------- Test rows ----------
// jev/testsplit.py marks a random share of a dataset's labeled rows "_test": true. The marker never reaches the model,
// no tuning panel or Compare reads those rows, and their answers stay hidden in the results table. Scoring Policy's gate
// on them is a deliberate step the dataset file counts, since every look at a test result can steer the next choice.
function testControl(x) {
  if (x.test) {
    const looks = x.test.looks;
    return [h("span", { class: "badge", title: "Rows held out of every tuning panel and Compare. Score a gate on them from Policy." },
      `test: ${x.test.rows} rows · ${x.test.labeled} labeled (${pct(x.test.share, 1)} of labeled rows) · ${looks} look${looks === 1 ? "" : "s"}`),
    h("button", { class: "btn sm ghost", onclick: () => removeTest(x.id) }, "Remove test split")];
  }
  // The server finds the closest feasible share; whole groups must leave two labeled rows on each side.
  const shares = x.labeled >= 4 ? [0.2, 0.25, 0.33] : [];
  if (!shares.length) return null;
  const sel = h("select", { class: "input sm", "aria-label": `Hold out test rows from ${x.id}`, style: { width: "auto" } },
    h("option", { value: "" }, "Hold out test rows…"),
    shares.map((share) => h("option", { value: String(share) }, `About ${Math.round(share * 100)}% of ${x.labeled} labeled rows`)));
  sel.addEventListener("change", () => { if (sel.value) lockTest(x.id, Number(sel.value)); sel.value = ""; });
  return sel;
}

// The dataset file changed under the rows box: reload it, and drop a run whose rows no longer match the file.
async function reloadAfterSplit(id) {
  const b = W.bulk;
  b.datasets = (await api("/api/workbench/datasets")).datasets;
  if (b.dataset.id === id) {
    b.savedText = b.rowsText;  // nothing unsaved here: the caller checked, so the reload need not ask
    b.labelsDirty = false;
    await loadDataset(id);
    b.result = null;
    b.testScore = null;
  }
  render();
}

async function lockTest(id, share) {
  if (!confirmReviewDiscard(id)) return;
  const b = W.bulk;
  if (b.dataset.id === id && bulkUnsaved()) return toast("Save the rows and labels first: the split is drawn from the saved file.", "error");
  if (!confirm(`Hold out about ${Math.round(share * 100)}% of the labeled rows in “${id}” as test rows?\n\n`
    + "Exact duplicate inputs stay together, including unlabeled copies. Groups are drawn at random to get as close as possible to that share, with at least two labeled rows on each side. The actual share can differ. Picture names count as part of the input; similar wording is not grouped.\n\n"
    + "No tuning panel or Compare will read test rows, and their answers stay hidden. Score a gate on them from Policy when you have chosen it; each score is counted.")) return;
  try {
    const { dataset } = await api("/api/workbench/datasets/test/lock", { id, share });
    await reloadAfterSplit(id);
    toast(`${dataset.test.rows} test rows · ${dataset.test.labeled} labeled (${pct(dataset.test.share, 1)} of labeled rows).${b.dataset.id === id ? " Run the rows again to get answers." : ""}`);
  } catch (e) { handleError(e); }
}

async function removeTest(id) {
  if (!confirmReviewDiscard(id)) return;
  const b = W.bulk;
  if (b.dataset.id === id && bulkUnsaved()) return toast("Save the rows and labels first: removing the split rewrites the saved file.", "error");
  if (!confirm(`Put the test rows of “${id}” back among the rest, and forget how often they were scored? Tuning will then read them, so they can no longer give an unbiased number.`)) return;
  try {
    await api("/api/workbench/datasets/test/remove", { id });
    await reloadAfterSplit(id);
  } catch (e) { handleError(e); }
}

// The policy a test score measured: a score shows only while Policy still has these gates, signal, and rules.
const testPolicyKey = () => canon({ gates: activeGates(), signal: W.bulk.policy.signal, rules: policyRules() });

function testBlocker(tests) {
  const b = W.bulk;
  const d = b.dataset;
  if (!d.id || !b.datasets.find((x) => x.id === d.id)?.test) return "These rows carry test markers, but no saved dataset with a test split is loaded. Load the dataset to score its test rows.";
  if (bulkUnsaved() || b.runText !== b.savedText) return `Run the rows saved in “${d.name}” unchanged: the score is recorded in that file.`;
  if (tests.some((r) => !r.answers)) return "Some test rows got no answer. Run the rows again: a gate is scored on every test row or not at all.";
  return null;
}

export function testBody(rep) {
  const b = W.bulk;
  const tests = b.result.results.filter(isTest);
  if (!tests.length) return [];
  const title = h("h3", { class: "cal-h" }, "Test rows");
  const blocker = testBlocker(tests);
  if (blocker) return [title, h("p", { class: "faint", style: { fontSize: "12.5px" } }, blocker)];
  const looks = b.datasets.find((x) => x.id === b.dataset.id).test.looks;
  const gates = activeGates();
  const s = b.testScore?.key === testPolicyKey() ? b.testScore.report : null;  // never beside a gate it did not measure
  return [title,
    h("p", { class: "faint", style: { fontSize: "12.5px" } },
      `Everything above was measured on the ${rep.labeled} labeled rows that tuning reads, so it favors choices that fit them. The ${tests.length} test rows were held out of all of it. `,
      "Score the gate on them once you have chosen it: the result is what to expect on rows nobody tuned on. Each score is counted in the dataset, and only per-question accuracy is shown, not which rows were wrong, so the test rows cannot be fixed one by one."),
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("button", { class: "btn sm", disabled: b.testBusy || !Object.keys(gates).length, onclick: scoreTest },
        b.testBusy ? [h("span", { class: "spin" }), " Scoring…"] : [icon("eye"), `Score this gate on ${tests.length} test rows · look ${looks + 1}`]),
      looks ? h("span", { class: "faint", style: { fontSize: "12px" } }, `${looks} earlier look${looks === 1 ? "" : "s"} at these rows`) : null),
    s ? testReport(s, rep) : null];
}

async function scoreTest() {
  const b = W.bulk;
  const tests = b.result.results.filter(isTest);
  const blocker = testBlocker(tests);
  if (blocker) return toast(blocker, "error");
  const looks = b.datasets.find((x) => x.id === b.dataset.id).test.looks;
  if (looks && !confirm(`These test rows were scored ${looks} time${looks === 1 ? "" : "s"} before. If an earlier score changed the gate, the test rows helped choose it, and this score is optimistic too. Score again?`)) return;
  const gates = activeGates();
  const key = testPolicyKey();
  b.testBusy = true;
  updatePolicy();
  try {
    const report = await api("/api/workbench/datasets/test/score", { id: b.dataset.id, rows: policyRows(Object.keys(gates), tests), gates,
      signal: b.policy.signal, rules: policyRules() || undefined, model: b.runModel || undefined });
    b.testScore = { key, report };
    b.datasets = (await api("/api/workbench/datasets")).datasets;
  } catch (e) { handleError(e); }
  b.testBusy = false;
  render();
}

function testReport(s, rep) {
  const gatesText = Object.entries(s.gates).map(([q, v]) => `${q} ≥ ${v.toFixed(2)}`).join(" · ");
  const vs = (value) => (value === null ? "—" : pct(value, 1));
  return h("div", { class: "check-report grid", style: { gap: "8px" } },
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: `badge ${s.look === 1 ? "good" : "warning"}` }, icon("eye"), `look ${s.look}`),
      h("span", { class: "mono faint", style: { fontSize: "12px" } }, gatesText)),
    h("div", { class: "stat-row" },
      stat("accuracy when automated, test rows", s.accuracy === null ? "nothing automated" : withCI(pct(s.accuracy, 1), s.accuracy_low, s.accuracy_high)),
      stat("on the tuning rows", vs(rep.accuracy)),
      stat("automated, test rows", `${s.automated} of ${s.labeled} · ${pct(s.coverage)}`),
      stat("on the tuning rows", pct(rep.coverage))),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "gated question"), h("th", {}, "accuracy on every test row"))),
      h("tbody", {}, s.questions.map((q) => h("tr", {}, h("td", { class: "mono" }, q.qid),
        h("td", {}, q.accuracy === null ? "—" : withCI(pct(q.accuracy, 1), q.accuracy_low, q.accuracy_high))))))),
    s.unlabeled || s.invalid.length || s.skipped ? h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } },
      `${s.unlabeled + s.invalid.length + s.skipped} test rows lack a usable label or answer for a gated question and are not scored.`) : null,
    s.look > 1 ? h("p", { class: "faint", style: { fontSize: "12.5px", margin: 0 } }, icon("eye"),
      ` This is look ${s.look} at these rows. A gate or wording changed after an earlier look was chosen partly on them, so this number is optimistic too. For an unbiased one, label new rows and hold them out.`) : null);
}
