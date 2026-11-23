// Saved Workbench datasets: editor actions, catalog filters and revision history.
import { $, api, copyText, h, handleError, icon, toast } from "./common.js";
import {
  catalogDefaults,
  matchesCatalog,
  sortedCatalog,
  catalogSummary,
  catalogCsv,
  catalogJson,
  catalogPreset,
  datasetCopyName,
  slugOf,
  canCopyDataset,
  catalogProgress,
  catalogIds,
  updateCatalogPins,
  pinnedCatalog,
  catalogDetailsSummary,
  invertCatalogPins,
  catalogActiveFilters,
  catalogFilterSummary,
} from "./dataset-catalog.js";
import { createHistory } from "./history.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";
import { rowsText, bulkUnsaved, replaceRows, settleLabels, rowsPayload, bulkQuestions } from "./workbench-bulk.js";
import { checkItem } from "./workbench-checks.js";
import { agreeButton, agreePanel, openDatasetAgreement } from "./workbench-dataset-agreement.js";
import { bundleImportForm, exportBundle } from "./workbench-dataset-bundles.js";
import { testControl } from "./workbench-dataset-holdout.js";
import { preparedLabelsUnsaved } from "./workbench-labeling.js";
import { confirmReviewDiscard } from "./workbench-review.js";

function datasetChangeMessage(report) {
  const rows = report.rows,
    labels = report.labels,
    test = report.test;
  return (
    `Replace the saved dataset “${report.id}”?\n\n` +
    `Inputs: ${rows.before} → ${rows.after} rows; ${rows.added} added, ${rows.removed} removed.\n` +
    `Human labels: ${labels.added} added, ${labels.removed} removed, ${labels.changed} changed.\n` +
    `Questions: ${report.questions_changed ? "changed" : "unchanged"}. Rules: ${report.rules_changed ? "changed" : "unchanged"}.\n` +
    `Name/notes: ${report.metadata_changed ? "changed" : "unchanged"}. Input order: ${rows.order_changed ? "changed" : "unchanged"}.\n` +
    `Saved check: ${report.check}.${report.check_dropped ? ` ${report.check_dropped}` : ""}\n` +
    `Held-out rows: ${test.before} → ${test.after}; ${test.changed_membership} matching inputs change split. Test history: ${test.history}.\n` +
    (W.guides?.changeText(report.guidelines) ?? "") +
    "\n" +
    "Counts include held-out label changes without showing their values. Duplicate inputs are paired in row order. " +
    "Changed inputs count as a removal and an addition. No model calls or file changes have been made by this preview."
  );
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
    return {
      name: form.name.trim(),
      notes: form.notes,
      rows: rowsPayload(),
      questions: q && Object.keys(q).length ? q : undefined,
      rules: b.rules.text.trim() || undefined,
    };
  };
  const spec = currentSpec();
  const snapshot = JSON.stringify([spec, b.rowsText, b.labelsDirty]);
  const current = () => snapshot === JSON.stringify([currentSpec(), b.rowsText, b.labelsDirty]);
  b.datasetSaveBusy = true;
  try {
    const preview = await api("/api/workbench/datasets/preview", spec);
    if (!current())
      return toast("Rows or dataset settings changed. Save again to preview the current changes.", "error");
    if (!confirmReviewDiscard(preview.id)) return;
    if (preview.exists && !confirm(datasetChangeMessage(preview))) return;
    const {
      dataset,
      check_dropped: dropped,
      guidelines_dropped: guidesDropped,
    } = await api("/api/workbench/datasets", { ...spec, preview_revision: preview.revision });
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
  } catch (e) {
    handleError(e);
  } finally {
    b.datasetSaveBusy = false;
    render();
  }
}

export async function loadDataset(id) {
  const b = W.bulk;
  try {
    const { dataset } = await api("/api/workbench/datasets/load", { id });
    if (!replaceRows(rowsText(dataset.rows), `“${dataset.name || id}”`)) return;
    b.dataset = {
      id,
      name: dataset.name || id,
      notes: dataset.notes || "",
      withQuestions: !!dataset.questions,
      questions: dataset.questions || null,
    };
    b.checkSlices = { datasetId: id, targets: (dataset.check?.slice_targets || []).map((t) => ({ ...t })) };
    b.rules = { ...b.rules, text: dataset.rules || "", applied: "", checked: "", report: null, error: null };
    if (dataset.questions) b.source = "dataset";
    else if (b.source === "dataset") b.source = "current";
    toast(`Loaded ${dataset.rows.length} rows. Run them to get answers.`);
    render();
  } catch (e) {
    handleError(e);
  }
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
    if (before !== context())
      return toast("The editor changed while loading. Load the copy again when ready.", "error");
    if (!canCopyDataset(dataset))
      return toast(
        "This dataset has test history. Download and import its ZIP to preserve that history in a copy.",
        "error",
      );
    if (
      preparedLabelsUnsaved() &&
      !confirm(
        "Load a dataset copy with unapplied labeling drafts? Apply or download the drafts first to keep them; different inputs or questions make these drafts unavailable.",
      )
    )
      return;
    if (!replaceRows(rowsText(dataset.rows), `a copy of “${dataset.name || id}”`)) return;
    b.dataset = {
      id: null,
      name: datasetCopyName(dataset.name || id, b.datasets),
      notes: dataset.notes || "",
      withQuestions: !!dataset.questions,
      questions: dataset.questions || null,
    };
    b.savedText = "";
    b.result = null;
    b.testScore = null;
    b.checkSlices = { datasetId: null, targets: null };
    b.rules = { ...b.rules, text: dataset.rules || "", applied: "", checked: "", report: null, error: null };
    if (dataset.questions) b.source = "dataset";
    else if (b.source === "dataset") b.source = "current";
    toast(
      `Loaded an unsaved copy as “${b.dataset.name}”. Save explicitly to create it. Saved checks and guidelines stay with the original.`,
    );
  } catch (e) {
    handleError(e);
  } finally {
    b.datasetCopyBusy = false;
    render();
  }
}

async function deleteDataset(id) {
  const b = W.bulk;
  if (!confirmReviewDiscard(id)) return;
  if (
    !confirm(
      `Delete the dataset “${id}”? This removes data/workbench/datasets/${id}.json; its history keeps a copy you can restore.`,
    )
  )
    return;
  try {
    await api("/api/workbench/datasets/delete", { id });
    if (b.dataset.id === id) b.dataset.id = null;
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    render();
  } catch (e) {
    handleError(e);
  }
}

// Dataset revisions (static/js/history.js): after a restore, drop reports about the replaced file and reload it.
const datasetHistory = createHistory({
  h,
  api,
  toast,
  handleError,
  render: () => render(),
  beforeRestore: confirmReviewDiscard,
  lab: (id, control) => (W.lab?.builders?.datasetsHistoryCtx ? datasetsHistoryLab(id, control) : null),
  afterRestore: async (id) => {
    const b = W.bulk;
    delete b.checkRuns[id];
    delete b.agreeRuns[id];
    if (b.dataset.id === id) b.testScore = null;
    b.datasets = (await api("/api/workbench/datasets")).datasets;
    await loadDataset(id);
  },
});

export function renderDatasets() {
  const b = W.bulk;
  const d = b.dataset;
  const filters = (b.datasetSearch = { ...catalogDefaults(), ...b.datasetSearch });
  const name = h("input", {
    class: "input",
    placeholder: "Dataset name, e.g. Support tickets, March",
    value: d.name,
    "aria-label": "Dataset name",
  });
  name.addEventListener("input", () => {
    d.name = name.value;
  });
  const notes = h("input", {
    class: "input",
    placeholder: "Notes (optional)",
    value: d.notes,
    "aria-label": "Dataset notes",
  });
  notes.addEventListener("input", () => {
    d.notes = notes.value;
  });
  const withQ = h("input", { type: "checkbox", checked: d.withQuestions });
  withQ.addEventListener("change", () => {
    d.withQuestions = withQ.checked;
  });
  const labeledText = (x) =>
    `${x.rows} row${x.rows === 1 ? "" : "s"} · ${x.labeled} labeled` +
    (x.questions ? ` · ${x.questions} question${x.questions === 1 ? "" : "s"}` : "");
  // Lab (contract: static/js/lab/surfaces/workbench-datasets.js) filters like any catalog filter and sorts after the page.
  const catalogLab = W.lab?.builders?.datasetsCatalogCtx ? datasetsCatalogLab() : null;
  const catalogOrder = sortedCatalog(b.datasets, filters.sort, filters.pinnedIds);
  return h(
    "div",
    { class: "panel datasets", id: "datasets" },
    h(
      "div",
      { class: "panel-head" },
      h("h2", {}, "Datasets · data/workbench/datasets/"),
      h("div", { class: "spacer" }),
      h(
        "span",
        {
          class: "badge warning",
          id: "ds-unsaved",
          style: { display: bulkUnsaved() ? "" : "none" },
          title: "A reload would lose these rows or labels",
        },
        "Unsaved rows or labels",
      ),
    ),
    h(
      "div",
      { class: "panel-body grid", style: { gap: "10px" } },
      h(
        "div",
        { class: "grid", style: { gap: "6px" } },
        name,
        notes,
        h(
          "label",
          { class: "toggle", style: { gap: "6px" } },
          withQ,
          h("span", { class: "track" }),
          "Save the selected questions with the rows",
        ),
        h("div", {}, h("button", { class: "btn sm", onclick: saveDataset }, icon("check"), "Save rows and labels")),
      ),
      h(
        "p",
        { class: "faint", style: { fontSize: "12px" } },
        "Saves the rows box, with the labels you chose in the results table, as one JSON file you can commit. Only rows and labels are saved, never answers: run a loaded dataset to get answers.",
      ),
      bundleImportForm(),
      b.datasets.some((x) => x.check)
        ? h(
            "datalist",
            { id: "cmp-models" },
            (W.compare.models || []).map((n) => h("option", { value: n })),
          )
        : null,
      datasetSearchControls(filters),
      catalogLab
        ? W.lab.section(W.labEnv, "workbench.datasets.catalog", catalogLab, {
            title: "Lab tools for the dataset catalog",
          })
        : null,
      b.datasets.length
        ? h(
            "div",
            { id: "dataset-search-results" },
            (catalogLab ? catalogLab.page.arrange(catalogOrder) : catalogOrder).map((x) =>
              h(
                "div",
                {
                  class: "item dataset-search-item",
                  "data-dataset-id": x.id,
                  style: {
                    display: matchesCatalog(x, filters) && (!catalogLab || catalogLab.page.matches(x)) ? "" : "none",
                  },
                },
                h(
                  "div",
                  { class: "grid", style: { gap: "2px" } },
                  h(
                    "div",
                    { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                    h("b", {}, x.name || x.id),
                    h("code", { class: "faint" }, x.id),
                    x.id === d.id ? h("span", { class: "badge" }, "loaded") : null,
                  ),
                  h(
                    "span",
                    { class: "faint", style: { fontSize: "12px" } },
                    labeledText(x) + (x.saved_at ? ` · saved ${x.saved_at.slice(0, 10)}` : ""),
                  ),
                  h("span", { class: "faint", style: { fontSize: "12px" } }, catalogProgress(x)),
                  x.notes ? h("span", { class: "muted", style: { fontSize: "12px" } }, x.notes) : null,
                ),
                h(
                  "div",
                  { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
                  h(
                    "button",
                    {
                      class: "btn sm",
                      "data-catalog-pin": "",
                      "aria-label": `Pin dataset ${x.id}`,
                      "aria-pressed": String(filters.pinnedIds.includes(x.id)),
                      onclick: (event) => {
                        const index = filters.pinnedIds.indexOf(x.id);
                        if (index < 0) filters.pinnedIds.push(x.id);
                        else filters.pinnedIds.splice(index, 1);
                        event.currentTarget.setAttribute("aria-pressed", String(index < 0));
                        event.currentTarget.textContent = index < 0 ? "Unpin" : "Pin";
                        $("#dataset-catalog-pin-filter")?.dispatchEvent(new Event("change"));
                      },
                    },
                    filters.pinnedIds.includes(x.id) ? "Unpin" : "Pin",
                  ),
                  h("button", { class: "btn sm", onclick: () => loadDataset(x.id) }, "Load"),
                  h(
                    "button",
                    {
                      class: "btn sm",
                      disabled: b.datasetCopyBusy || !canCopyDataset(x),
                      title: canCopyDataset(x)
                        ? "Load rows, labels, questions and rules under a new name; save explicitly"
                        : "Use Download ZIP and Import to copy the held-out evaluation history too",
                      onclick: () => loadDatasetCopy(x.id),
                    },
                    "Load as copy",
                  ),
                  h("button", { class: "btn sm", onclick: () => exportBundle(x.id) }, "Download ZIP"),
                  x.labeled && x.questions ? agreeButton(x) : null,
                  testControl(x),
                  x.id === d.id ? datasetHistory.button(x.id) : null,
                  W.guides?.toggle(x),
                  h(
                    "button",
                    {
                      class: "btn sm ghost danger",
                      "aria-label": `Delete ${x.id}`,
                      onclick: () => deleteDataset(x.id),
                    },
                    icon("trash"),
                  ),
                ),
                x.check ? checkItem(x) : null,
                b.agreeRuns[x.id]?.open ? agreePanel(x) : null,
                W.guides?.panel(x),
                x.id === d.id ? datasetHistory.panel(x.id) : null,
              ),
            ),
          )
        : h("div", { class: "empty" }, "No saved datasets yet. Label some rows, name them, and save."),
      datasetHistory.deleted(),
    ),
  );
}

// Filtering keeps every queue mounted, so hidden human edits remain intact.
function datasetSearchControls(filters) {
  let previousFilters = null;
  const snapshot = () =>
    Object.fromEntries(
      Object.keys(catalogDefaults())
        .filter((key) => key !== "pinnedIds")
        .map((key) => [key, filters[key]]),
    );
  const remember = () => {
    previousFilters = snapshot();
  };
  const activeChips = () =>
    catalogActiveFilters(filters).map(({ key, label, value }) =>
      h(
        "button",
        {
          class: "btn sm ghost",
          "aria-label": `Remove dataset filter ${label}`,
          onclick: () => setFilter(key, catalogDefaults()[key]),
        },
        `${label}: ${value} ×`,
      ),
    );
  // Lab's filters count like every catalog filter (and so scope every "shown" action); Lab's sort applies last.
  const lab = W.lab?.builders?.datasetsCatalogCtx ? datasetsCatalogLab().page : null;
  const ordered = () => {
    const list = sortedCatalog(W.bulk.datasets, filters.sort, filters.pinnedIds);
    return lab ? lab.arrange(list) : list;
  };
  const visible = () => ordered().filter((item) => matchesCatalog(item, filters) && (!lab || lab.matches(item)));
  const update = () => {
    const shown = visible();
    const matches = new Set(shown.map((item) => item.id));
    const list = $("#dataset-search-results");
    const nodes = new Map(
      [...(list?.querySelectorAll(".dataset-search-item") || [])].map((row) => [row.dataset.datasetId, row]),
    );
    ordered().forEach((item) => {
      const row = nodes.get(item.id);
      if (row) {
        row.style.display = matches.has(item.id) ? "" : "none";
        list.append(row);
      }
    });
    const count = $("#dataset-search-count");
    if (count) count.textContent = `${matches.size} of ${W.bulk.datasets.length} datasets shown`;
    const summary = $("#dataset-search-summary");
    if (summary) summary.textContent = catalogSummary(shown);
    const details = $("#dataset-search-details-summary");
    if (details) details.textContent = catalogDetailsSummary(shown);
    const pinned = pinnedCatalog(W.bulk.datasets, filters.sort, filters.pinnedIds);
    for (const id of ["dataset-catalog-copy-pinned", "dataset-catalog-pinned-csv", "dataset-catalog-pinned-json"]) {
      const button = $(`#${id}`);
      if (button) button.disabled = !pinned.length;
    }
    for (const id of [
      "dataset-catalog-pin-shown",
      "dataset-catalog-unpin-shown",
      "dataset-catalog-invert-shown",
      "dataset-catalog-copy-summary",
    ]) {
      const button = $(`#${id}`);
      if (button) button.disabled = !shown.length;
    }
    const pinnedCount = $("#dataset-catalog-pinned-count");
    if (pinnedCount) pinnedCount.textContent = `${pinned.length} datasets pinned in this page session`;
    for (const row of nodes.values()) {
      const button = row.querySelector?.("[data-catalog-pin]");
      if (!button) continue;
      const pinned = filters.pinnedIds.includes(row.dataset.datasetId);
      button.setAttribute("aria-pressed", String(pinned));
      button.textContent = pinned ? "Unpin" : "Pin";
    }
    const empty = $("#dataset-search-empty");
    if (empty) empty.hidden = !W.bulk.datasets.length || !!shown.length;
    const download = $("#dataset-catalog-download");
    if (download) download.disabled = !shown.length;
    const idsCopy = $("#dataset-catalog-copy-ids");
    if (idsCopy) idsCopy.disabled = !shown.length;
    const jsonDownload = $("#dataset-catalog-json");
    if (jsonDownload) jsonDownload.disabled = !shown.length;
    const active = catalogActiveFilters(filters);
    const activeCount = $("#dataset-catalog-active-count");
    if (activeCount)
      activeCount.textContent = `${active.length} active dataset filter${active.length === 1 ? "" : "s"}${labText()}`;
    const filterSummary = $("#dataset-catalog-filter-summary");
    if (filterSummary) filterSummary.textContent = catalogFilterSummary(filters);
    $("#dataset-catalog-filter-chips")?.replaceChildren?.(...activeChips());
    const undo = $("#dataset-catalog-filter-undo");
    if (undo) undo.disabled = !previousFilters;
  };
  const setFilter = (key, value) => {
    if (filters[key] !== value) remember();
    filters[key] = value;
    if (key === "query") search.value = value;
    else if (controls[key]) controls[key].value = value;
    update();
  };
  const controls = {};
  const search = h("input", {
    class: "input",
    type: "search",
    value: filters.query,
    placeholder: "Search datasets by name or notes",
    "aria-label": "Search datasets",
    oninput: (event) => setFilter("query", event.target.value),
  });
  const select = (key, label, options) =>
    (controls[key] = h(
      "select",
      {
        class: "input",
        id: key === "pinned" ? "dataset-catalog-pin-filter" : undefined,
        "aria-label": label,
        onchange: (event) => setFilter(key, event.target.value),
      },
      options.map(([value, text]) => h("option", { value, selected: filters[key] === value }, text)),
    ));
  const countFilter = (key, label) =>
    h(
      "label",
      { class: "faint" },
      label,
      " ",
      (controls[key] = h("input", {
        class: "input sm",
        type: "number",
        min: 0,
        step: 1,
        value: filters[key],
        "aria-label": label,
        style: { width: "90px" },
        oninput: (event) => setFilter(key, event.target.value),
      })),
    );
  const applyFilters = (next, saveUndo = true) => {
    if (saveUndo) remember();
    const pins = filters.pinnedIds;
    Object.assign(filters, next, { pinnedIds: pins });
    search.value = filters.query;
    for (const [key, element] of Object.entries(controls)) element.value = filters[key];
    update();
  };
  const clear = () => {
    if (W.lab) {
      W.lab.reset("workbench.datasets.catalog");
      const section = $('[data-lab-surface="workbench.datasets.catalog"]');
      if (section && lab)
        section.replaceWith(
          W.lab.section(W.labEnv, "workbench.datasets.catalog", datasetsCatalogLab(), {
            title: "Lab tools for the dataset catalog",
          }) || "",
        );
    }
    applyFilters(catalogDefaults());
    search.focus();
  };
  const labText = () => {
    const count = W.lab?.active("workbench.datasets.catalog") || 0;
    return count ? ` · ${count} Lab setting${count === 1 ? "" : "s"} active` : "";
  };
  if (lab) {
    W.datasetsCatalogRefresh = update;
    W.datasetsCatalogClear = clear;
  }
  const download = (items, format, name) => {
    if (!items.length) return;
    const url = URL.createObjectURL(
      new Blob([format === "csv" ? catalogCsv(items) : catalogJson(items)], {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/json",
      }),
    );
    h("a", { href: url, download: `${name}.${format}` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const setPins = (pin) => {
    filters.pinnedIds = updateCatalogPins(
      W.bulk.datasets,
      filters.pinnedIds,
      visible().map((item) => item.id),
      pin,
    );
    update();
  };
  const shown = visible();
  return h(
    "div",
    { class: "grid", style: { gap: "6px" } },
    search,
    h(
      "div",
      { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      select("searchField", "Dataset search field", [
        ["all", "Name, ID and notes"],
        ["name", "Name only"],
        ["id", "ID only"],
        ["notes", "Notes only"],
      ]),
      select("searchMode", "Dataset search matching", [
        ["phrase", "Match phrase"],
        ["all-words", "Match every word"],
        ["any-word", "Match any word"],
        ["exact-field", "Match a whole metadata field"],
      ]),
      (controls.exclude = h("input", {
        class: "input",
        type: "search",
        value: filters.exclude,
        placeholder: "Exclude matching phrase",
        "aria-label": "Exclude dataset phrase",
        oninput: (event) => setFilter("exclude", event.target.value),
      })),
      select("notes", "Filter datasets by notes", [
        ["all", "Any notes"],
        ["with", "With notes"],
        ["without", "Without notes"],
      ]),
      h(
        "label",
        { class: "faint" },
        "Quick view ",
        h(
          "select",
          {
            class: "input",
            "aria-label": "Dataset workflow preset",
            onchange: (event) => {
              applyFilters(catalogPreset(event.target.value));
              event.target.value = "";
            },
          },
          h("option", { value: "" }, "Choose a workflow…"),
          h("option", { value: "label" }, "Continue partial labeling"),
          h("option", { value: "unlabeled" }, "Start labeling"),
          h("option", { value: "check" }, "Prepare a saved check"),
          h("option", { value: "unscored" }, "Held-out splits never scored"),
          h("option", { value: "evaluated" }, "Held-out splits already scored"),
        ),
      ),
      select("pinned", "Filter pinned datasets", [
        ["all", "All pins"],
        ["with", "Pinned datasets only"],
        ["without", "Unpinned datasets only"],
      ]),
      select("check", "Filter datasets by saved check", [
        ["all", "All checks"],
        ["with", "With a saved check"],
        ["without", "Without a saved check"],
      ]),
      select("labels", "Filter datasets by labeling status", [
        ["all", "All labeling states"],
        ["none", "No rows labeled"],
        ["some", "Some rows labeled"],
        ["every", "Every row has a label"],
      ]),
      select("questions", "Filter datasets by saved questions", [
        ["all", "All question states"],
        ["with", "With saved questions"],
        ["without", "Without saved questions"],
      ]),
      select("timestamp", "Filter datasets by saved timestamp", [
        ["all", "Any saved timestamp"],
        ["with", "With a saved timestamp"],
        ["without", "Without a saved timestamp"],
      ]),
      select("test", "Filter datasets by held-out split", [
        ["all", "All test splits"],
        ["with", "With held-out rows"],
        ["without", "Without held-out rows"],
      ]),
      select("guidelines", "Filter datasets by labeling guidelines", [
        ["all", "All guideline states"],
        ["with", "With guidelines"],
        ["without", "Without guidelines"],
      ]),
      select("sort", "Sort datasets", [
        ["saved", "Saved order"],
        ["pinned", "Pinned first"],
        ["label-share-desc", "Highest labeled share first"],
        ["newest", "Newest saved first"],
        ["oldest", "Oldest saved first"],
        ["label-share", "Lowest labeled share first"],
        ["name", "Name A–Z"],
        ["name-desc", "Name Z–A"],
        ["rows", "Most rows first"],
        ["rows-asc", "Fewest rows first"],
        ["labeled", "Most labeled rows first"],
        ["unlabeled", "Most rows without labels"],
        ["questions", "Most questions first"],
        ["held-out", "Most held-out rows first"],
        ["labeled-asc", "Fewest labeled rows first"],
        ["unlabeled-asc", "Fewest rows without labels"],
        ["questions-asc", "Fewest questions first"],
        ["held-out-asc", "Fewest held-out rows first"],
        ["guidelines", "Most guideline questions first"],
        ["guidelines-asc", "Fewest guideline questions first"],
        ["tuning", "Most tuning rows first"],
        ["tuning-asc", "Fewest tuning rows first"],
        ["looks", "Most test evaluations first"],
        ["looks-asc", "Fewest test evaluations first"],
        ["tuning-labeled", "Most labeled tuning rows first"],
        ["tuning-labeled-asc", "Fewest labeled tuning rows first"],
        ["held-out-share", "Highest held-out row share first"],
        ["held-out-share-asc", "Lowest held-out row share first"],
        ["guideline-share", "Highest guideline share first"],
        ["guideline-share-asc", "Lowest guideline share first"],
        ["tuning-unlabeled", "Most tuning rows without labels"],
        ["tuning-unlabeled-asc", "Fewest tuning rows without labels"],
        ["held-out-unlabeled", "Most held-out rows without labels"],
        ["held-out-unlabeled-asc", "Fewest held-out rows without labels"],
        ["tuning-label-share", "Highest tuning labeled share first"],
        ["tuning-label-share-asc", "Lowest tuning labeled share first"],
        ["held-out-label-share", "Highest held-out labeled share first"],
        ["held-out-label-share-asc", "Lowest held-out labeled share first"],
      ]),
    ),
    h(
      "details",
      {},
      h("summary", {}, "Filter by counts"),
      h(
        "div",
        { style: { display: "flex", gap: "8px", flexWrap: "wrap", paddingTop: "8px" } },
        countFilter("minRows", "Minimum rows"),
        countFilter("maxRows", "Maximum rows"),
        countFilter("minLabeled", "Minimum labeled rows"),
        countFilter("maxLabeled", "Maximum labeled rows"),
        countFilter("minUnlabeled", "Minimum rows without labels"),
        countFilter("minQuestions", "Minimum saved questions"),
        countFilter("maxQuestions", "Maximum saved questions"),
        countFilter("maxUnlabeled", "Maximum rows without labels"),
        countFilter("minHeldOut", "Minimum held-out rows"),
        countFilter("maxHeldOut", "Maximum held-out rows"),
        countFilter("minGuidelines", "Minimum guideline questions"),
        countFilter("maxGuidelines", "Maximum guideline questions"),
        countFilter("minTuning", "Minimum tuning rows"),
        countFilter("maxTuning", "Maximum tuning rows"),
        countFilter("minLooks", "Minimum test evaluations"),
        countFilter("maxLooks", "Maximum test evaluations"),
        ...[
          ["minLabelShare", "Minimum labeled share (%)"],
          ["maxLabelShare", "Maximum labeled share (%)"],
        ].map(([key, label]) =>
          h(
            "label",
            { class: "faint" },
            label,
            " ",
            (controls[key] = h("input", {
              class: "input sm",
              type: "number",
              min: 0,
              max: 100,
              step: "any",
              value: filters[key],
              "aria-label": label,
              style: { width: "90px" },
              oninput: (event) => setFilter(key, event.target.value),
            })),
          ),
        ),
      ),
    ),
    h(
      "details",
      {},
      h("summary", {}, "Split labeling and guideline coverage"),
      h(
        "div",
        { class: "grid", style: { gap: "8px", paddingTop: "8px" } },
        (controls.idPrefix = h("input", {
          class: "input",
          type: "search",
          value: filters.idPrefix,
          placeholder: "Dataset ID starts with",
          "aria-label": "Dataset ID prefix",
          oninput: (event) => setFilter("idPrefix", event.target.value),
        })),
        ...[
          ["idSuffix", "Dataset ID suffix"],
          ["namePrefix", "Dataset name prefix"],
          ["nameSuffix", "Dataset name suffix"],
        ].map(
          ([key, label]) =>
            (controls[key] = h("input", {
              class: "input",
              type: "search",
              value: filters[key],
              placeholder: label,
              "aria-label": label,
              oninput: (event) => setFilter(key, event.target.value),
            })),
        ),
        select("tuningLabels", "Filter datasets by tuning row labels", [
          ["all", "Any tuning label progress"],
          ["none", "No tuning rows labeled"],
          ["some", "Some tuning rows labeled"],
          ["every", "Every tuning row has a label"],
        ]),
        select("heldOutLabels", "Filter datasets by held-out row labels", [
          ["all", "Any held-out label progress"],
          ["none", "No held-out rows labeled"],
          ["some", "Some held-out rows labeled"],
          ["every", "Every held-out row has a label"],
        ]),
        h(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
          countFilter("minTuningLabeled", "Minimum labeled tuning rows"),
          countFilter("maxTuningLabeled", "Maximum labeled tuning rows"),
          countFilter("minHeldOutLabeled", "Minimum labeled held-out rows"),
          countFilter("maxHeldOutLabeled", "Maximum labeled held-out rows"),
          countFilter("minUnguided", "Minimum questions without guidelines"),
          countFilter("maxUnguided", "Maximum questions without guidelines"),
          countFilter("minTuningUnlabeled", "Minimum tuning rows without labels"),
          countFilter("maxTuningUnlabeled", "Maximum tuning rows without labels"),
          countFilter("minHeldOutUnlabeled", "Minimum held-out rows without labels"),
          countFilter("maxHeldOutUnlabeled", "Maximum held-out rows without labels"),
          ...[
            ["minHeldOutShare", "Minimum held-out row share (%)"],
            ["maxHeldOutShare", "Maximum held-out row share (%)"],
            ["minGuidelineShare", "Minimum guideline share (%)"],
            ["maxGuidelineShare", "Maximum guideline share (%)"],
            ["minTuningLabelShare", "Minimum tuning labeled share (%)"],
            ["maxTuningLabelShare", "Maximum tuning labeled share (%)"],
            ["minHeldOutLabelShare", "Minimum held-out labeled share (%)"],
            ["maxHeldOutLabelShare", "Maximum held-out labeled share (%)"],
          ].map(([key, label]) =>
            h(
              "label",
              { class: "faint" },
              label,
              " ",
              (controls[key] = h("input", {
                class: "input sm",
                type: "number",
                min: 0,
                max: 100,
                step: "any",
                value: filters[key],
                "aria-label": label,
                style: { width: "90px" },
                oninput: (event) => setFilter(key, event.target.value),
              })),
            ),
          ),
        ),
        h(
          "p",
          { class: "faint", style: { margin: 0 } },
          "Split shares count rows, including unlabeled rows. Guideline share counts saved questions with human guidance. Shares with no rows or questions are unavailable. Label progress does not establish validity.",
        ),
      ),
    ),
    h(
      "div",
      { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
      ...[
        ["savedAfter", "Saved on or after"],
        ["savedBefore", "Saved on or before"],
      ].map(([key, label]) =>
        h(
          "label",
          { class: "faint" },
          label,
          " ",
          (controls[key] = h("input", {
            class: "input",
            type: "date",
            value: filters[key],
            "aria-label": label,
            oninput: (event) => setFilter(key, event.target.value),
          })),
        ),
      ),
    ),
    h(
      "div",
      { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      h("button", { class: "btn sm ghost", onclick: clear }, "Clear dataset filters"),
      h(
        "button",
        {
          class: "btn sm",
          id: "dataset-catalog-filter-undo",
          disabled: true,
          onclick: () => {
            if (!previousFilters) return;
            const restore = previousFilters;
            previousFilters = null;
            applyFilters(restore, false);
          },
        },
        "Undo dataset filter change",
      ),
      h(
        "button",
        {
          class: "btn sm",
          id: "dataset-catalog-copy-ids",
          disabled: !shown.length,
          onclick: () => {
            const items = visible();
            if (items.length) copyText(catalogIds(items));
          },
        },
        "Copy shown dataset IDs",
      ),
      h(
        "button",
        {
          class: "btn sm",
          id: "dataset-catalog-download",
          disabled: !shown.length,
          title: "Names and counts for the shown datasets, without inputs, label values or check configuration",
          onclick: () => {
            const items = visible();
            if (!items.length) return;
            const url = URL.createObjectURL(new Blob([catalogCsv(items)], { type: "text/csv;charset=utf-8" }));
            h("a", { href: url, download: "jev-dataset-catalog.csv" }).click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
        "Download shown catalog CSV",
      ),
      h(
        "button",
        {
          class: "btn sm",
          id: "dataset-catalog-json",
          disabled: !shown.length,
          onclick: () => {
            const items = visible();
            if (!items.length) return;
            const url = URL.createObjectURL(new Blob([catalogJson(items)], { type: "application/json" }));
            h("a", { href: url, download: "jev-dataset-catalog.json" }).click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
        "Download shown catalog JSON",
      ),
    ),
    h(
      "span",
      { class: "faint", id: "dataset-search-count", "aria-live": "polite" },
      `${shown.length} of ${W.bulk.datasets.length} datasets shown`,
    ),
    h(
      "span",
      { class: "faint", id: "dataset-catalog-active-count", "aria-live": "polite" },
      `${catalogActiveFilters(filters).length} active dataset filter${catalogActiveFilters(filters).length === 1 ? "" : "s"}${labText()}`,
    ),
    h(
      "details",
      {},
      h("summary", {}, "Active dataset filters"),
      h("p", { class: "faint", id: "dataset-catalog-filter-summary" }, catalogFilterSummary(filters)),
      h(
        "div",
        { id: "dataset-catalog-filter-chips", style: { display: "flex", flexWrap: "wrap", gap: "6px" } },
        activeChips(),
      ),
    ),
    h("span", { class: "faint", id: "dataset-search-summary" }, catalogSummary(shown)),
    h(
      "details",
      {},
      h("summary", {}, "Catalog summary and pinned datasets"),
      h(
        "div",
        { class: "grid", style: { gap: "8px", paddingTop: "8px" } },
        h(
          "span",
          { class: "faint", id: "dataset-search-details-summary", "aria-live": "polite" },
          catalogDetailsSummary(shown),
        ),
        h(
          "span",
          { class: "faint", id: "dataset-catalog-pinned-count" },
          `${pinnedCatalog(W.bulk.datasets, filters.sort, filters.pinnedIds).length} datasets pinned in this page session`,
        ),
        h(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "6px" } },
          h(
            "button",
            { class: "btn sm", id: "dataset-catalog-pin-shown", disabled: !shown.length, onclick: () => setPins(true) },
            "Pin shown datasets",
          ),
          h(
            "button",
            {
              class: "btn sm",
              id: "dataset-catalog-unpin-shown",
              disabled: !shown.length,
              onclick: () => setPins(false),
            },
            "Unpin shown datasets",
          ),
          h(
            "button",
            {
              class: "btn sm",
              id: "dataset-catalog-invert-shown",
              disabled: !shown.length,
              onclick: () => {
                filters.pinnedIds = invertCatalogPins(
                  W.bulk.datasets,
                  filters.pinnedIds,
                  visible().map((item) => item.id),
                );
                update();
              },
            },
            "Invert shown dataset pins",
          ),
          h(
            "button",
            {
              class: "btn sm",
              id: "dataset-catalog-copy-summary",
              disabled: !shown.length,
              onclick: () => {
                const items = visible();
                if (items.length) copyText(`${catalogSummary(items)}\n${catalogDetailsSummary(items)}`);
              },
            },
            "Copy shown catalog summary",
          ),
          h(
            "button",
            {
              class: "btn sm",
              id: "dataset-catalog-copy-pinned",
              disabled: !filters.pinnedIds.length,
              onclick: () => {
                const items = pinnedCatalog(W.bulk.datasets, filters.sort, filters.pinnedIds);
                if (items.length) copyText(catalogIds(items));
              },
            },
            "Copy all pinned dataset IDs",
          ),
          h(
            "button",
            {
              class: "btn sm",
              id: "dataset-catalog-pinned-csv",
              disabled: !filters.pinnedIds.length,
              onclick: () =>
                download(pinnedCatalog(W.bulk.datasets, filters.sort, filters.pinnedIds), "csv", "jev-pinned-datasets"),
            },
            "Download all pinned catalog CSV",
          ),
          h(
            "button",
            {
              class: "btn sm",
              id: "dataset-catalog-pinned-json",
              disabled: !filters.pinnedIds.length,
              onclick: () =>
                download(
                  pinnedCatalog(W.bulk.datasets, filters.sort, filters.pinnedIds),
                  "json",
                  "jev-pinned-datasets",
                ),
            },
            "Download all pinned catalog JSON",
          ),
        ),
        h(
          "p",
          { class: "faint", style: { margin: 0 } },
          "Pinned handoffs include hidden pins in the current sort order. Counts describe human work and recorded evaluation looks, never evaluation quality. Downloads contain the existing names, IDs, counts and timestamps only.",
        ),
      ),
    ),
    h(
      "div",
      { class: "empty", id: "dataset-search-empty", hidden: !W.bulk.datasets.length || !!shown.length },
      "No datasets match these filters. ",
      h("button", { class: "btn sm", onclick: clear }, "Show all datasets"),
    ),
    h(
      "p",
      { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "A labeled row has at least one saved label; this does not establish complete or valid labels. Filters only change the list shown. Pins last for this page session; clearing filters keeps them.",
    ),
  );
}

// ---------- Lab surfaces (contract: static/js/lab/surfaces/workbench-datasets.js) ----------
// Each ctx is built on first use from the page's own state and handlers, and reached only behind a W.lab check, so the
// tests that rebuild page functions from source (without W.lab) never touch them.

// "workbench.datasets.catalog": one ctx for the page session. refresh() and resetFilters() go through the catalog's own
// update and clear, which only hide and reorder the mounted cards, so open human queues stay mounted.
function datasetsCatalogLab() {
  const id = "workbench.datasets.catalog";
  if (!W.datasetsCatalogLab)
    W.datasetsCatalogLab = W.lab.builders.datasetsCatalogCtx({
      datasets: () => W.bulk.datasets,
      filters: () => W.bulk.datasetSearch,
      loadedId: () => W.bulk.dataset.id,
      unsaved: () => bulkUnsaved(),
      saveBusy: () => !!W.bulk.datasetSaveBusy,
      copyBusy: () => !!W.bulk.datasetCopyBusy,
      agreementOpen: (datasetId) => !!W.bulk.agreeRuns[datasetId]?.open,
      matches: (item, ctx) => W.lab.matches(id, item, ctx),
      arrange: (list, ctx) => W.lab.arrange(id, list, ctx),
      load: (datasetId) => loadDataset(datasetId),
      loadCopy: (datasetId) => loadDatasetCopy(datasetId),
      downloadBundle: (datasetId) => exportBundle(datasetId),
      setPins: (ids) => {
        W.bulk.datasetSearch.pinnedIds = ids;
        if (W.datasetsCatalogRefresh) W.datasetsCatalogRefresh();
        else render();
      },
      openAgreement: openDatasetAgreement,
      resetFilters: () => {
        if (W.datasetsCatalogClear) return W.datasetsCatalogClear();
        Object.assign(W.bulk.datasetSearch, catalogDefaults(), { pinnedIds: W.bulk.datasetSearch.pinnedIds });
        W.lab.reset(id);
        return render();
      },
      refresh: () => (W.datasetsCatalogRefresh ? W.datasetsCatalogRefresh() : render()),
      now: () => Date.now(),
    });
  return W.datasetsCatalogLab;
}

// "workbench.datasets.history": one ctx per dataset whose History panel is open (history.js passes its control).
function datasetsHistoryLab(datasetId, control) {
  const id = "workbench.datasets.history";
  const labs = W.datasetsHistoryLabs || (W.datasetsHistoryLabs = {});
  if (!labs[datasetId] || labs[datasetId].control !== control) {
    const ctx = W.lab.builders.datasetsHistoryCtx({
      datasetId,
      state: () => control.state(),
      deleted: () => control.deleted(),
      matches: (item, c) => W.lab.matches(id, item, c),
      arrange: (list, c) => W.lab.arrange(id, list, c),
      reload: () => control.reload(),
      preview: (entry) => control.preview(entry),
      cancelPreview: () => control.cancelPreview(),
      restore: () => control.restore(),
      setChangedOnly: (on) => control.setChangedOnly(on),
      refresh: () => render(),
      now: () => Date.now(),
    });
    labs[datasetId] = { control, ctx };
  }
  const ctx = labs[datasetId].ctx;
  return {
    matches: ctx.page.matches,
    arrange: ctx.page.arrange,
    active: () => W.lab.active(id),
    reset: () => W.lab.reset(id),
    section: () => W.lab.section(W.labEnv, id, ctx, { title: "Lab tools for revisions" }),
  };
}
