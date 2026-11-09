// Explicit human repairs and redundant-copy cleanup. Apply changes the editor, never a saved dataset.
import { api, h, handleError, photoView, toast } from "./common.js";
import { W } from "./workbench-state.js";
import { bulkQuestions, loadPictureUrls, rowsPayload, rowsText, settleLabels } from "./workbench-bulk.js";
import { labelText, labelValue, syncAttachedSets } from "./workbench-calibrate.js";
import { render } from "./workbench.js";
import { preparedLabelsUnsaved } from "./workbench-labeling.js";

const state = { busy: false, context: null, report: null, drafts: {}, preview: null, action: "repair" };
const context = () => JSON.stringify([W.bulk.rowsText, bulkQuestions(), W.bulk.labelsDirty]);
const items = () => Object.entries(state.drafts).filter(([, labels]) => Object.keys(labels).length)
  .map(([index, labels]) => ({ index: Number(index), labels }));
const request = () => ({ rows: rowsPayload(), questions: bulkQuestions(), context: state.report.context,
  action: state.action, items: state.action === "repair" ? items() : [] });
export const datasetEditsUnsaved = () => state.context === context() && items().length > 0;
export const confirmDatasetEditsDiscard = () => !datasetEditsUnsaved()
  || window.confirm("Discard unapplied dataset label repairs? Apply them to the rows editor first to keep them.");

async function prepareEdits(action) {
  if (state.busy || !confirmDatasetEditsDiscard() || !settleLabels("Prepare dataset edits")) return;
  const key = context();
  state.busy = true; state.report = state.preview = null; state.drafts = {}; state.action = action;
  render();
  try {
    const report = await api("/api/workbench/dataset-edits/prepare", { rows: rowsPayload(), questions: bulkQuestions() });
    if (key === context()) {
      state.report = report; state.context = key;
      await loadPictureUrls(report.items);
      if (action === "deduplicate") await previewEdits(true);
    }
  } catch (e) { handleError(e); }
  state.busy = false; render();
}

async function previewEdits(preparing = false) {
  if ((!preparing && state.busy) || !state.report || state.context !== context()) return;
  const key = context(), body = request(), draftKey = JSON.stringify(items());
  state.busy = true; state.preview = null;
  if (!preparing) render();
  try {
    const report = await api("/api/workbench/dataset-edits/preview", body);
    if (key === context() && draftKey === JSON.stringify(items())) state.preview = { ...report, draftKey };
  } catch (e) { handleError(e); }
  if (!preparing) { state.busy = false; render(); }
}

async function applyEdits() {
  if (state.busy || !state.preview || state.context !== context() || state.preview.draftKey !== JSON.stringify(items())) return;
  if (preparedLabelsUnsaved() && !window.confirm("Applying dataset edits discards unapplied pre-run labeling drafts. Apply those labels first to keep them, or continue and discard them?")) return;
  const key = context();
  const draftContext = JSON.stringify([W.bulk.prelabel.context, W.bulk.prelabel.drafts]);
  state.busy = true; render();
  try {
    const result = await api("/api/workbench/dataset-edits/apply", { ...request(), token: state.preview.token });
    if (key === context() && draftContext === JSON.stringify([W.bulk.prelabel.context, W.bulk.prelabel.drafts])) {
      const b = W.bulk;
      b.rowsText = rowsText(result.rows); b.result = b.runText = b.testScore = b.gateExport = null;
      b.labels = {}; b.labelsDirty = false; b.health.report = null;
      b.prelabel.report = null; b.prelabel.drafts = {};
      state.report = state.preview = null; state.drafts = {};
      syncAttachedSets();
      toast(`Updated the rows editor: ${result.changed} labels repaired, ${result.removed} copies removed. Save dataset to keep changes.`);
    } else toast("Rows, questions, or labeling drafts changed; edits were not applied. Prepare again.", "error");
  } catch (e) { handleError(e); }
  state.busy = false; render();
}

export function datasetEditsBody() {
  const report = state.context === context() ? state.report : null;
  const preview = report ? state.preview : null;
  return h("div", { class: "panel", id: "dataset-edits" },
    h("div", { class: "panel-head" }, h("h2", {}, "Repair dataset labels and copies")),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("p", { class: "faint" }, "Choose human corrections for invalid or conflicting tuning labels. Cleanup removes only exact duplicate inputs with identical labels. Groups containing held-out inputs are excluded. No model calls or saved changes; Apply edits the rows box, then Save keeps it."),
      h("div", { class: "actions" },
        h("button", { class: "btn sm", disabled: state.busy, onclick: () => prepareEdits("repair") }, "Repair dataset labels"),
        h("button", { class: "btn sm", disabled: state.busy, onclick: () => prepareEdits("deduplicate") }, "Preview duplicate cleanup")),
      report ? h("div", { class: "grid", style: { gap: "10px" } },
        h("p", { class: "faint" }, `${report.protected_rows} rows protected because their input group contains held-out rows.`),
        state.action === "repair" ? [
          !report.items.length ? h("p", {}, "No eligible invalid or conflicting tuning labels.") : null,
          ...report.items.map((item) => h("div", { class: "queue-item" },
            h("b", {}, `Row ${item.index + 1}`),
            h("pre", { class: "code" }, typeof item.row === "string" ? item.row : JSON.stringify(item.row, null, 2)),
            W.bulk.pictures[item.row?._image] ? photoView(W.bulk.pictures[item.row._image]) : null,
            ...Object.entries(item.issues).map(([qid, issue]) => {
              const q = report.questions[qid];
              const choices = q.type === "noul" ? ["yes", "no"] : q.type === "score" ? q.criteria.map((_, i) => String(i)) : Object.keys(q.criteria);
              const current = labelText(state.drafts[item.index]?.[qid], q.type);
              return h("label", {}, `${qid} · ${issue} · current: ${JSON.stringify(item.labels[qid])}`,
                h("select", { class: "input", disabled: state.busy, "aria-label": `Repair ${qid} on row ${item.index + 1}`,
                  onchange: (event) => {
                    const value = labelValue(event.target.value, q.type);
                    const labels = state.drafts[item.index] ||= Object.create(null);
                    if (value === null) delete labels[qid]; else labels[qid] = value;
                    state.preview = null; render();
                  } }, h("option", { value: "", selected: !current }, "Keep current label"),
                ...choices.map((v) => h("option", { value: v, selected: current === v }, q.type === "score" ? `${v} · ${q.criteria[Number(v)]}` : v))),
                W.guides?.hint(W.bulk.dataset.id, qid, q));
            }))),
          h("button", { class: "btn sm", disabled: state.busy || !items().length, onclick: () => previewEdits() }, "Preview label repairs"),
        ] : null,
        preview ? h("div", { role: "status" },
          h("p", {}, `${preview.changed} labels change; ${preview.removed.length} duplicate copies removed; ${preview.remaining} rows remain.`),
          preview.changes.length ? h("p", {}, preview.changes.map((c) => `Row ${c.row}: ${c.question}`).join("; ")) : null,
          preview.removed.length ? h("p", {}, `Remove rows ${preview.removed.join(", ")}`) : null,
          h("button", { class: "btn sm primary", disabled: state.busy || (!preview.changed && !preview.removed.length), onclick: applyEdits }, "Apply previewed edits to rows")) : null,
        h("button", { class: "btn sm ghost", disabled: state.busy, onclick: () => {
          if (confirmDatasetEditsDiscard()) { state.report = state.preview = null; state.drafts = {}; render(); }
        } }, "Close repairs")) : null));
}
