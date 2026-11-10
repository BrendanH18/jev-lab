// Dataset revision history (jev/history.py): every replaced or deleted dataset file is kept as a local revision.
// This module lists a dataset's revisions, previews restoring one with the same change summary as a replacement
// preview, and restores only after an explicit confirmation. Revisions hold inputs, human labels and configuration,
// never answers; the list and previews show counts only, never label values. Nothing here calls the model.

import { guidelineChangeText } from "./guidelines.js";
import { matchesDeletedDataset } from "./dataset-catalog.js";

export const revisionTime = (at) => (typeof at === "string" ? `${at.slice(0, 10)} ${at.slice(11, 19)} UTC` : "unknown time");

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function revisionText(r) {
  if (r.error) return `${revisionTime(r.at)} · ${r.error}`;
  return [revisionTime(r.at), plural(r.rows, "row"), `${r.labeled} labeled`,
    r.test_rows ? `${r.test_rows} held out` : null,
    r.questions.length ? plural(r.questions.length, "question") : "no questions",
    r.checks ? "saved check" : null].filter(Boolean).join(" · ");
}

export function checkChange(report) {
  if (report.check === "removed") return `removed. ${report.check_dropped || ""}`.trim();
  if (report.check === "preserved") return report.check_changed ? "restored from the revision" : "unchanged";
  return report.check_changed ? "removed (the revision has none)" : "none";
}

export function restoreMessage(report, entry) {
  const rows = report.rows, labels = report.labels, test = report.test;
  return `Restore “${report.id}” to the revision from ${revisionTime(entry?.at)}?\n\n`
    + (report.exists ? "" : "The dataset file is deleted; restoring recreates it.\n")
    + `Inputs: ${rows.before} → ${rows.after} rows; ${rows.added} added, ${rows.removed} removed.\n`
    + `Human labels: ${labels.added} added, ${labels.removed} removed, ${labels.changed} changed.\n`
    + `Questions: ${report.questions_changed ? "changed" : "unchanged"}. Rules: ${report.rules_changed ? "changed" : "unchanged"}.\n`
    + `Name/notes: ${report.metadata_changed ? "changed" : "unchanged"}. Input order: ${rows.order_changed ? "changed" : "unchanged"}.\n`
    + `Saved check: ${checkChange(report)}\n`
    + guidelineChangeText(report.guidelines)
    + `Held-out rows: ${test.before} → ${test.after}. Test history: ${test.history}; looks recorded since the revision are kept.\n\n`
    + (report.exists ? "The current file is kept as a revision first, so this restore can be undone. " : "")
    + "The editor then reloads the dataset (you are asked first if it has unsaved rows). No model calls.";
}

// deps: { h, api, icon, toast, handleError, render, beforeRestore(id), afterRestore(id), confirm }
export function createHistory(deps) {
  const ask = deps.confirm || ((text) => globalThis.confirm(text));
  const runs = {};
  const gone = { open: false, busy: false, list: null, query: "" };
  const run = (id) => runs[id] || (runs[id] = { open: false, busy: false, list: null, preview: null, changedOnly: false });

  async function refresh(id) {
    const state = run(id);
    state.busy = true;
    deps.render();
    try {
      state.list = await deps.api("/api/workbench/datasets/history", { id });
      state.preview = null;
    } catch (e) { deps.handleError(e); }
    state.busy = false;
    deps.render();
  }

  async function refreshDeleted() {
    gone.busy = true;
    deps.render();
    try { gone.list = (await deps.api("/api/workbench/datasets/history/deleted")).datasets; } catch (e) { deps.handleError(e); }
    gone.busy = false;
    deps.render();
  }

  async function preview(id, entry) {
    const state = run(id);
    state.busy = true;
    state.preview = null;
    deps.render();
    try {
      const report = await deps.api("/api/workbench/datasets/history/preview", { id, revision: entry.revision });
      state.preview = { entry, report };
    } catch (e) { deps.handleError(e); }
    state.busy = false;
    deps.render();
  }

  async function restore(id) {
    const state = run(id);
    const { entry, report } = state.preview || {};
    if (state.busy || !report || !ask(restoreMessage(report, entry))) return;
    if (deps.beforeRestore && !deps.beforeRestore(id)) return;
    state.busy = true;
    deps.render();
    try {
      const out = await deps.api("/api/workbench/datasets/history/restore",
        { id, revision: entry.revision, preview_revision: report.revision });
      deps.toast(`Restored “${id}” to the revision from ${revisionTime(entry.at)}. The replaced file is kept as a revision.`);
      if (out.check_dropped) deps.toast(`The revision's check no longer fits: ${out.check_dropped}`, "error");
      if (out.guidelines_dropped?.length) deps.toast(out.guidelines_dropped.join(". "), "error");
      state.busy = false;
      state.preview = null;
      gone.list = null;
      gone.open = false;
      await deps.afterRestore(id);
      await refresh(id);
    } catch (e) {
      deps.handleError(e);
      state.busy = false;
      state.preview = null;  // a stale preview must be made again
    }
    deps.render();
  }

  function button(id) {
    const state = run(id);
    return deps.h("button", { class: `btn sm${state.open ? " active" : ""}`, "aria-expanded": String(state.open),
      title: "Earlier versions of this dataset file, kept on this computer",
      onclick: () => { state.open = !state.open; if (state.open) refresh(id); else deps.render(); } }, "History");
  }

  function panel(id) {
    const { h } = deps;
    const state = run(id);
    if (!state.open) return null;
    const list = state.list?.id === id ? state.list.revisions : null;
    const visible = list?.filter((entry) => !state.changedOnly || !entry.current);
    const shown = state.preview;
    return h("div", { class: "check-item", "aria-label": `History of ${id}` },
      h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
        h("b", {}, "History"),
        h("span", { class: "faint", style: { fontSize: "12px" } },
          `The newest ${state.list?.keep || 20} replaced or deleted versions, kept under data/workbench/datasets/.history/${id}/ (not committed). Counts only, no label values.`),
        h("button", { class: "btn sm ghost", disabled: state.busy, onclick: () => refresh(id) }, "Refresh")),
      list?.length ? h("label", { class: "muted", style: { fontSize: "12px" } },
        h("input", { type: "checkbox", checked: state.changedOnly, disabled: state.busy,
          onchange: (event) => {
            state.changedOnly = event.target.checked;
            if (state.changedOnly && state.preview?.entry.current) state.preview = null;
            deps.render();
          } }), " Hide revisions identical to the current file") : null,
      list?.length ? h("span", { class: "faint", "aria-live": "polite" }, `${visible.length} of ${list.length} revisions shown`) : null,
      list?.length && !visible.length ? h("p", { class: "faint" }, "Every kept revision matches the current file. Clear the filter to preview one.") : null,
      state.busy && !list ? h("p", { class: "faint" }, "Reading history…") : null,
      list && !list.length ? h("p", { class: "faint", style: { margin: 0 } }, "No earlier versions yet. Saving over this dataset keeps the file it replaces here.") : null,
      visible?.length ? h("ol", { class: "grid", style: { gap: "4px", paddingLeft: "20px", margin: 0 } },
        visible.map((r) => h("li", { style: { fontSize: "12.5px" } },
          h("span", { class: r.error ? "faint" : "muted" }, revisionText(r)),
          r.current ? h("span", { class: "badge" }, "same as current") : null, " ",
          r.error ? null : h("button", { class: "btn sm", disabled: state.busy,
            onclick: () => preview(id, r) }, shown?.entry.revision === r.revision ? "Preview again" : "Preview restore"),
          shown?.entry.revision === r.revision ? previewView(id, shown) : null))) : null);
  }

  function previewView(id, { entry, report }) {
    const { h } = deps;
    const state = run(id);
    return h("div", { class: "grid", style: { gap: "4px", margin: "6px 0" } },
      h("pre", { class: "code", style: { whiteSpace: "pre-wrap", margin: 0 } }, restoreMessage(report, entry)),
      h("div", {},
        h("button", { class: "btn sm primary", disabled: state.busy, onclick: () => restore(id) }, "Restore this revision"),
        h("button", { class: "btn sm ghost", disabled: state.busy,
          onclick: () => { state.preview = null; deps.render(); } }, "Cancel")));
  }

  function deleted() {
    const { h } = deps;
    const shown = (gone.list || []).filter((entry) => matchesDeletedDataset(entry, gone.query));
    const search = h("input", { class: "input", type: "search", value: gone.query,
      "aria-label": "Search deleted datasets", placeholder: "Search deleted datasets by name or id", oninput: (event) => {
        gone.query = event.target.value;
        const matches = new Set((gone.list || []).filter((entry) => matchesDeletedDataset(entry, gone.query)).map((entry) => entry.id));
        const section = event.target.closest("details");
        section.querySelectorAll("[data-deleted-dataset]").forEach((row) => { row.style.display = matches.has(row.dataset.deletedDataset) ? "" : "none"; });
        section.querySelector("[data-deleted-count]").textContent = `${matches.size} of ${gone.list?.length || 0} deleted datasets shown`;
        section.querySelector("[data-deleted-empty]").hidden = !gone.list?.length || !!matches.size;
      } });
    return h("details", { open: gone.open, ontoggle: (event) => {
      if (event.target.open === gone.open) return;
      gone.open = event.target.open;
      if (gone.open) refreshDeleted();
    } },
    h("summary", { class: "faint", style: { fontSize: "12.5px" } }, "Deleted datasets with kept history"),
    h("button", { class: "btn sm ghost", disabled: gone.busy, onclick: refreshDeleted }, "Refresh"),
    search,
    h("span", { class: "faint", "data-deleted-count": "", "aria-live": "polite" }, `${shown.length} of ${gone.list?.length || 0} deleted datasets shown`),
    h("p", { class: "faint", "data-deleted-empty": "", hidden: !gone.list?.length || !!shown.length }, "No deleted datasets match. Clear the search to show all kept histories."),
    gone.busy && !gone.list ? h("p", { class: "faint" }, "Reading history…") : null,
    gone.list && !gone.list.length ? h("p", { class: "faint", style: { fontSize: "12.5px" } }, "None. Deleting a dataset keeps its history here so the delete can be undone.") : null,
    (gone.list || []).map((x) => h("div", { class: "item", "data-deleted-dataset": x.id,
      style: { display: matchesDeletedDataset(x, gone.query) ? "" : "none" } },
      h("div", { class: "grid", style: { gap: "2px" } },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
          h("b", {}, x.name || x.id), h("code", { class: "faint" }, x.id), h("span", { class: "badge warning" }, "deleted")),
        h("span", { class: "faint", style: { fontSize: "12px" } }, `${plural(x.revisions, "revision")} · newest ${revisionTime(x.latest)}`)),
      h("div", {}, button(x.id)),
      panel(x.id))));
  }

  return { button, panel, deleted };
}
