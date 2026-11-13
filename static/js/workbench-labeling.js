// Labels: pre-run labeling of missing labels (jev/prelabel.py) and the Review labels panel (jev/review.py).
import { $, api, debounce, h, handleError, icon, mount, pct, photoView, statusBadge, toast } from "./common.js";
import { labelProgress, visibleLabels, nextLabel, labelShortcut } from "./prelabel.js";
import { W, canon } from "./workbench-state.js";
import { stringify } from "./workbench-build.js";
import { render } from "./workbench.js";
import { rowsText, loadPictureUrls, settleLabels, rowsPayload, bulkQuestions, labelSelect, rowText } from "./workbench-bulk.js";
import { agreeQuestions } from "./workbench-datasets.js";
import { SIGNALS, labelText, labelValue, syncAttachedSets } from "./workbench-calibrate.js";
import { policyQids, policyRows } from "./workbench-policy.js";

// Pre-run human labels belong to a snapshot of the inputs and question schema, not model answers.
const prelabelContext = () => JSON.stringify([W.bulk.rowsText, bulkQuestions(), W.bulk.labelsDirty]);

async function prepareLabels(field = null, value = null) {
  const state = W.bulk.prelabel;
  if (state.busy || !settleLabels("Label the rows box")) return;
  const context = prelabelContext();
  if (state.context !== context) { state.drafts = {}; state.status = "all"; state.csvPreview = null; }
  state.busy = true;
  state.report = null;
  render();
  try {
    const report = await api("/api/workbench/prelabel", { rows: rowsPayload(), questions: bulkQuestions(), field, value });
    if (context === prelabelContext()) {
      state.report = report;
      state.context = context;
      state.nextIndex = null;
      state.field = report.field;
      state.value = report.value;
      await loadPictureUrls(report.items);
    }
  } catch (e) { handleError(e); }
  state.busy = false;
  render();
}

async function applyPreparedLabels() {
  const b = W.bulk;
  const state = b.prelabel;
  if (state.busy || !state.report || state.context !== prelabelContext()) return;
  const context = state.context;
  state.busy = true;
  render();
  try {
    const result = await api("/api/workbench/prelabel/apply", {
      rows: rowsPayload(), questions: bulkQuestions(),
      items: Object.entries(state.drafts).filter(([, labels]) => Object.keys(labels).length)
        .map(([index, labels]) => ({ index: Number(index), labels })),
    });
    if (context === prelabelContext()) {
      b.rowsText = rowsText(result.rows);
      // Old result-table labels must not later replace the newly labeled rows.
      b.result = null;
      b.runText = null;
      b.labels = {};
      b.labelsDirty = false;
      b.testScore = null;
      b.gateExport = null;
      state.report = null;
      state.drafts = {};
      syncAttachedSets();
      toast(`Applied ${result.applied} human labels to the rows box. Save dataset to keep them.`);
    } else toast("Rows or questions changed. Labels were not applied; reopen Label missing rows.", "error");
  } catch (e) { handleError(e); }
  state.busy = false;
  render();
}

// CSV previews belong to both the input snapshot and the draft values shown at preview time.
const preparedDraftKey = () => canon(W.bulk.prelabel.drafts);
export const preparedLabelsUnsaved = () => W.bulk.prelabel.context === prelabelContext()
  && Object.values(W.bulk.prelabel.drafts).some((labels) => Object.keys(labels).length);

async function downloadPreparedDraft() {
  const state = W.bulk.prelabel;
  if (state.busy || !state.report || state.context !== prelabelContext()) return;
  const context = state.context;
  const draftKey = preparedDraftKey();
  state.busy = true;
  render();
  try {
    const out = await api("/api/workbench/prelabel/draft/export", {
      rows: rowsPayload(), questions: bulkQuestions(),
      items: Object.entries(state.drafts).filter(([, labels]) => Object.keys(labels).length)
        .map(([index, labels]) => ({ index: Number(index), labels })),
    });
    if (context !== prelabelContext() || draftKey !== preparedDraftKey()) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: "labeling-draft.json" }).click();
    URL.revokeObjectURL(url);
    toast("Downloaded labeling draft. Keep the original rows and questions to restore it; pictures travel separately.");
  } catch (e) { handleError(e); }
  finally { state.busy = false; render(); }
}

async function exportPreparedLabels() {
  const state = W.bulk.prelabel;
  if (state.busy || !state.report || state.context !== prelabelContext()) return;
  const context = state.context;
  state.busy = true;
  render();
  try {
    const out = await api("/api/workbench/prelabel/csv/export", {
      rows: rowsPayload(), questions: bulkQuestions(), field: state.field, value: state.value,
    });
    if (context !== prelabelContext()) return;
    const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv;charset=utf-8" }));
    h("a", { href: url, download: "tuning-labels.csv" }).click();
    URL.revokeObjectURL(url);
  } catch (e) { handleError(e); }
  finally { state.busy = false; render(); }
}

async function previewPreparedLabels(text, context = prelabelContext(), format = "csv") {
  const state = W.bulk.prelabel;
  if (state.busy || !state.report || state.context !== context || context !== prelabelContext()) return;
  const draftKey = preparedDraftKey();
  state.busy = true;
  state.csvPreview = null;
  render();
  try {
    const report = await api(`/api/workbench/prelabel/${format}/import`, { rows: rowsPayload(), questions: bulkQuestions(), text });
    if (context === prelabelContext() && draftKey === preparedDraftKey()) state.csvPreview = { ...report, context, draftKey };
  } catch (e) { handleError(e); }
  finally { state.busy = false; render(); }
}

function acceptPreparedLabels() {
  const state = W.bulk.prelabel;
  const preview = state.csvPreview;
  if (state.busy || !preview || preview.context !== prelabelContext() || preview.draftKey !== preparedDraftKey()) return;
  for (const item of preview.items) {
    const labels = state.drafts[item.index] ||= Object.create(null);
    Object.assign(labels, item.labels);
  }
  state.csvPreview = null;
  render();
}

function preparedLabelCsv(state, report) {
  const context = state.context;
  const draftFile = h("input", { type: "file", accept: ".json,application/json", class: "hidden", disabled: state.busy });
  draftFile.addEventListener("change", async () => {
    const f = draftFile.files[0];
    if (!f) return;
    try { await previewPreparedLabels(await f.text(), context, "draft"); }
    catch (e) { handleError(e); }
  });
  const file = h("input", { type: "file", accept: ".csv,text/csv", class: "hidden", disabled: state.busy });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (f) {
      try { await previewPreparedLabels(await f.text(), context); }
      catch (e) { handleError(e); }
    }
  });
  const preview = state.csvPreview?.context === prelabelContext() && state.csvPreview.draftKey === preparedDraftKey() ? state.csvPreview : null;
  return h("div", { class: "panel-body grid", style: { gap: "8px" } },
    h("div", {}, draftFile,
      h("button", { class: "btn sm", disabled: state.busy, onclick: downloadPreparedDraft }, "Download labeling draft"),
      h("button", { class: "btn sm", disabled: state.busy, onclick: () => draftFile.click() }, "Restore labeling draft")),
    h("p", { class: "faint" }, "Draft files include eligible tuning inputs, questions, and your draft labels across all slices. Keep the original rows and questions for a matching restore. Existing labels, held-out inputs, and model answers are excluded; pictures travel separately. Restore previews before merging into drafts. Apply and Save remain explicit."),
    h("div", {}, file,
      h("button", { class: "btn sm", disabled: state.busy || !report.items.length, onclick: exportPreparedLabels }, "Download tuning labeling CSV"),
      h("button", { class: "btn sm", disabled: state.busy, onclick: () => file.click() }, "Import tuning labeling CSV")),
    h("p", { class: "faint" }, "Download includes this slice's eligible tuning rows with blank label columns. The missing column lists which questions need labels on each row. Edit only those label:<question> cells; keep row_id, input, and missing unchanged. Existing labels and held-out rows are excluded. Pictures remain separate; share the named files if needed. Imports can include rows from any slice of this same rows/questions snapshot."),
    preview ? h("div", { class: "grid", style: { gap: "6px" } },
      h("b", {}, `${preview.counts.matched} rows matched · ${preview.counts.labels} labels imported`),
      h("p", { class: "faint" }, "Preview only. Accept merges nonblank cells into drafts, replacing drafts for the same cells. Other drafts remain. Apply labels to rows and Save dataset are still required."),
      h("div", { class: "scroll" }, h("table", { class: "table" }, h("tbody", {}, preview.items.map((item) =>
        h("tr", {}, h("td", {}, `Row ${item.index + 1}`), h("td", {}, Object.entries(item.labels).map(([qid, value]) =>
          h("div", {}, `${qid}: ${labelText(value, report.questions[qid].type)}`)))))))),
      h("div", {}, h("button", { class: "btn sm primary", disabled: state.busy || !preview.counts.labels, onclick: acceptPreparedLabels }, "Accept imported label drafts"),
        h("button", { class: "btn sm", disabled: state.busy, onclick: () => { state.csvPreview = null; render(); } }, "Cancel import"))) : null);
}

function nextPreparedLabel(direction = 1) {
  const state = W.bulk.prelabel;
  if (state.busy || !state.report || state.context !== prelabelContext()) return;
  // With a Lab filter active, Next skips the rows it hides (the queue never draws them), still in rows-box order.
  const lab = W.lab?.active?.("workbench.labeling.queue") ? W.labelingLab : null;
  const item = nextLabel(lab ? state.report.items.filter((entry) => lab.page.matches(entry)) : state.report.items, state.drafts, state.nextIndex, direction);
  if (!item) return;
  state.nextIndex = item.index;
  state.status = "incomplete";
  render();
  const target = $(`#prelabel-row-${item.index}`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  (target?.querySelector("select:not(:disabled)") || target)?.focus({ preventScroll: true });
}

export function prelabelBody() {
  const state = W.bulk.prelabel;
  const report = state.context === prelabelContext() ? state.report : null;
  const drafts = report ? state.drafts : {};
  const filled = Object.values(drafts).reduce((n, labels) => n + Object.keys(labels).length, 0);
  const progress = labelProgress(report?.items || [], drafts);
  const byStatus = visibleLabels(report?.items || [], drafts, state.status || "all");
  // Lab (contract: static/js/lab/surfaces/workbench-labeling.js) is reached only through W: without it, or with no Lab
  // filter or sort active, the queue shows exactly the rows the status filter leaves, in rows-box order.
  const lab = report && W.lab?.builders?.labelingQueueCtx ? labelingLab() : null;
  const labActive = lab ? W.lab.active("workbench.labeling.queue") : 0;
  const visible = labActive ? lab.page.visible() : byStatus;
  return h("div", { class: "panel", id: "prelabel-controls", tabindex: "-1", onkeydown: (event) => {
    const direction = labelShortcut(event);
    if (direction === null || state.busy || !report || !progress.incomplete) return;
    event.preventDefault();
    const row = event.target.closest?.("[data-prelabel-index]");
    if (row) state.nextIndex = Number(row.dataset.prelabelIndex);
    nextPreparedLabel(direction);
  } },
    h("div", { class: "panel-head" }, h("h2", {}, "Label before running")),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("div", {}, h("button", { class: "btn sm", disabled: state.busy, onclick: () => prepareLabels() },
        state.busy ? "Preparing labels…" : "Label missing rows")),
      h("p", { class: "faint" }, "Fill blank Choice, Noul, and Score labels on tuning rows before a paid run. Existing labels and held-out rows stay unchanged. No model calls. Apply updates the rows box; Save dataset keeps the changes. Box and array rows must be labeled in JSON."),
      report ? h("div", { class: "grid", style: { gap: "10px" } },
        agreeQuestions(report.questions),
        h("p", { class: "muted" }, `${filled} of ${report.missing} missing labels filled across ${report.eligible} tuning rows · showing ${report.items.length} rows`),
        h("label", {}, "Filter by field ", h("select", { class: "input sm", "aria-label": "Labeling slice field", disabled: state.busy,
          onchange: (e) => prepareLabels(e.target.value || null) },
          h("option", { value: "", selected: report.field === null }, "All rows"),
          report.fields.map((f) => h("option", { value: f.name, selected: report.field === f.name }, f.name)))),
        report.field ? h("label", {}, "Value ", h("select", { class: "input sm", "aria-label": "Labeling slice value", disabled: state.busy,
          onchange: (e) => prepareLabels(report.field, e.target.value === "" ? null : e.target.value) },
          h("option", { value: "", selected: report.value === null }, "All values"),
          report.values.map((v) => h("option", { value: v.value, selected: report.value === v.value }, `${v.shown} (${v.rows} rows)`)))) : null,
        !report.items.length ? h("p", { class: "muted" }, "No missing labels in these tuning rows for Choice, Noul, or Score questions.") : null,
        preparedLabelCsv(state, report),
        h("div", { role: "status", class: "muted", id: "prelabel-status" }, `${progress.ready} rows ready · ${progress.incomplete} incomplete in this slice · showing ${visible.length}`),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h("label", {}, "Labeling status ", h("select", { class: "input sm", "aria-label": "Pre-run labeling status", disabled: state.busy,
            onchange: (e) => { state.status = e.target.value; render(); } },
            [["all", "All rows"], ["incomplete", "Incomplete"], ["ready", "Ready"]].map(([value, text]) =>
              h("option", { value, selected: value === (state.status || "all") }, text)))),
          h("button", { class: "btn sm", disabled: state.busy || !progress.incomplete, onclick: () => nextPreparedLabel() }, "Next incomplete row")),
        h("p", { class: "faint" }, "Filters change the rows shown. Apply includes drafts from every slice. Next follows the current slice and wraps to the first incomplete row. While focused in this panel, Ctrl/⌘+Enter goes to the next incomplete row; Ctrl/⌘+Shift+Enter goes to the previous one. Tab and arrow keys keep their usual behavior."),
        lab ? W.lab.section(W.labEnv, "workbench.labeling.queue", lab, { title: "Lab tools for the labeling queue" }) : null,
        h("div", { id: "prelabel-queue", class: "grid", style: { gap: "10px" } },
          labActive ? h("p", { class: "faint", role: "status", style: { fontSize: "12.5px", margin: 0, display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
            `Showing ${visible.length} of ${byStatus.length} rows this status leaves · ${labActive} Lab setting${labActive === 1 ? "" : "s"} active. Drafts on hidden rows stay, and Apply includes every slice.`,
            h("button", { class: "btn sm ghost", onclick: () => { W.lab.reset("workbench.labeling.queue"); render(); } }, "Clear Lab filters and sort")) : null,
          report.items.length && !visible.length ? h("p", { class: "muted" }, labActive && byStatus.length ? "No row matches the Lab filters." : "No rows match this labeling status.") : null,
          visible.map((item) => h("div", { class: "panel-body", id: `prelabel-row-${item.index}`, "data-prelabel-index": item.index, tabindex: "-1", style: { border: "1px solid var(--border)", borderRadius: "8px" } },
            h("b", {}, `Row ${item.index + 1}`),
            h("pre", { class: "code", style: { whiteSpace: "pre-wrap" } }, typeof item.row === "string" ? item.row : JSON.stringify(item.row, null, 2)),
            item.row?._image && W.bulk.pictures[item.row._image] ? photoView(W.bulk.pictures[item.row._image]) : null,
            item.missing.map((qid, position) => {
              const question = report.questions[qid];
              const choices = question.type === "noul" ? ["yes", "no"] : question.type === "score"
                ? question.criteria.map((_, i) => String(i)) : Object.keys(question.criteria);
              const current = labelText(drafts[item.index]?.[qid], question.type);
              return h("label", {}, qid, h("p", { class: "faint" }, stringify(question.instructions)),
                h("select", { class: "input sm", id: `prelabel-label-${item.index}-${position}`, "aria-label": `Label ${qid} for row ${item.index + 1}`, disabled: state.busy,
                  onchange: (e) => {
                    state.csvPreview = null;
                    const labels = state.drafts[item.index] ||= Object.create(null);
                    const value = labelValue(e.target.value, question.type);
                    if (value === null) delete labels[qid]; else labels[qid] = value;
                    state.nextIndex = item.index;
                    render();
                    ($(`#prelabel-label-${item.index}-${position}`) || $("#prelabel-controls"))?.focus({ preventScroll: true });
                  } }, h("option", { value: "", selected: !current }, "Choose a human label"),
                  choices.map((c) => h("option", { value: c, selected: current === c },
                    question.type === "score" ? `${c} · ${stringify(question.criteria[Number(c)])}` : c))),
                W.guides?.hint(W.bulk.dataset.id, qid, question));
            })))),
        h("button", { class: "btn sm primary", disabled: state.busy || !filled, onclick: applyPreparedLabels }, `Apply ${filled} labels to rows`),
        h("p", { class: "faint" }, "Apply includes drafts in every slice. Changing rows or questions discards the draft view. Applying clears old Bulk results; run again to score the new labels.")) : null));
}

// ---------- Lab surface "workbench.labeling.queue" (contract: static/js/lab/surfaces/workbench-labeling.js) ----------
// Built once per page session from W.lab.builders and kept on W, so prelabelBody and nextPreparedLabel reach it only
// through W. Every field reads W at call time: Compare's handoff replaces W.bulk.prelabel as a whole.
function labelingLab() {
  if (W.labelingLab) return W.labelingLab;
  const build = W.lab?.builders?.labelingQueueCtx;
  if (typeof build !== "function") return null;
  W.labelingLab = build({
    state: () => W.bulk.prelabel,
    current: () => W.bulk.prelabel.context === prelabelContext(),
    pictures: () => W.bulk.pictures,
    dataset: () => W.bulk.dataset,
    guidelines: () => W.guides?.peek?.(W.bulk.dataset.id) || null,
    matches: (item, ctx) => W.lab.matches("workbench.labeling.queue", item, ctx),
    arrange: (items, ctx) => W.lab.arrange("workbench.labeling.queue", items, ctx),
    writeDrafts: (changes, label) => labelingLabWrite(changes, label),
    goTo: (index) => labelingLabGoTo(index),
    next: (direction) => nextPreparedLabel(direction),
    setStatus: (status) => { W.bulk.prelabel.status = status; render(); },
    prepare: (field, value) => prepareLabels(field, value),
    resetFilters: () => { W.bulk.prelabel.status = "all"; W.lab?.reset("workbench.labeling.queue"); render(); },
    refresh: () => labelingLabRefresh(),
  });
  return W.labelingLab;
}

// A Lab edit of the drafts takes the path a label select takes: drafts change (null clears), a pending import preview
// is dropped, and nothing reaches the rows box until Apply.
function labelingLabWrite(changes, label) {
  const state = W.bulk.prelabel;
  for (const [index, labels] of changes) {
    const target = state.drafts[index] ||= Object.create(null);
    for (const [qid, value] of Object.entries(labels)) {
      if (value === null) delete target[qid]; else target[qid] = value;
    }
  }
  state.csvPreview = null;
  render();
  toast(`${label}: draft labels changed on ${changes.length} row${changes.length === 1 ? "" : "s"}. Apply labels to rows, then Save dataset, to keep them.`);
}

function labelingLabGoTo(index) {
  W.bulk.prelabel.nextIndex = index;
  render();
  const target = $(`#prelabel-row-${index}`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  (target?.querySelector("select:not(:disabled)") || target)?.focus({ preventScroll: true });
}

// Lab filters and sorts redraw the queue rows and the "showing N" line only, so the Lab section keeps its controls.
function labelingLabRefresh() {
  const panel = $("#prelabel-panel");
  if (!panel) return;
  const fresh = h("div", {}, prelabelBody());
  for (const id of ["prelabel-status", "prelabel-queue"]) {
    const live = $(`#${id}`, panel), next = $(`#${id}`, fresh);
    if (!live || !next) return void mount(panel, prelabelBody());
    live.replaceWith(next);
  }
}

// ---------- Review labels ----------
// Every accuracy above rests on the labels. This panel lists the labels worth a second look, across every
// question, and the unlabeled rows worth labeling next for Calibrate's question at its threshold. The server
// ranks them (jev/review.py); no model calls. "Label is right" hides a disagreement until its label changes.
const REVIEW_SHOWN = 8;
let reviewSeq = 0;
export async function rereview() {
  const b = W.bulk;
  const qids = policyQids(b.result);
  const seq = ++reviewSeq;  // only the latest request may install its report
  if (!qids.length) { b.review.report = null; return; }
  const question = qids.includes(b.cal.qid) ? b.cal.qid : null;
  b.review.asked = b.cal.threshold;  // the latest request's threshold, so a slider move back to an older one still re-ranks
  try {
    const report = await api("/api/workbench/review", { rows: policyRows(qids), question, threshold: b.cal.threshold, signal: b.cal.signal });
    if (seq === reviewSeq) b.review.report = report;
  } catch (e) { if (seq === reviewSeq) { b.review.report = null; handleError(e); } }
}
// The threshold moved: re-rank Label next in place, without rebuilding the slider under the pointer.
export const reviewSoon = debounce(async () => { await rereview(); if ($("#review")) mount("#review", ...reviewBody()); }, 250);

export function renderReview() {
  if (!policyQids(W.bulk.result).length) return null;
  return h("div", { class: "panel", id: "review-panel" },
    h("div", { class: "panel-head" }, icon("eye"), h("h2", {}, "Review labels"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "computed from these answers, no extra calls")),
    h("div", { class: "panel-body grid", id: "review", style: { gap: "16px" } }, ...reviewBody()));
}

function reviewBody() {
  const b = W.bulk;
  const rep = b.review.report;
  if (!rep) return [h("p", { class: "faint", style: { fontSize: "13px" } }, "Review appears once the answers can be read.")];
  return [checkLabels(rep), labelNext(rep)];
}

// Show the first few rows of a ranked list, with a toggle for the rest.
function moreToggle(key, total) {
  const all = W.bulk.review.all;
  if (total <= REVIEW_SHOWN) return null;
  return h("button", { class: "btn sm ghost", onclick: () => { all[key] = !all[key]; mount("#review", ...reviewBody()); } },
    all[key] ? `Show the first ${REVIEW_SHOWN}` : `Show all ${total}`);
}

function checkLabels(rep) {
  const b = W.bulk;
  const rowsBy = new Map(b.result.results.map((r) => [r.index, r]));
  const counts = Object.values(rep.questions);
  const labeled = counts.reduce((n, q) => n + q.labeled, 0);
  const invalid = counts.reduce((n, q) => n + q.invalid, 0);
  const kept = rep.suspects.filter((s) => b.review.kept.has(`${s.index}:${s.question}`)).length;
  const open = rep.suspects.filter((s) => !b.review.kept.has(`${s.index}:${s.question}`));
  const strong = open.filter((s) => s.strong).length;
  const head = h("h3", { class: "cal-h" }, `Check labels · ${open.length} ${open.length === 1 ? "disagreement" : "disagreements"}`,
    strong ? h("span", { class: "badge warning", style: { marginLeft: "8px" } }, `${strong} likely label ${strong === 1 ? "error" : "errors"}`) : null);
  const note = (text) => h("p", { class: "muted", style: { fontSize: "13px" } }, text);
  if (!labeled) return h("div", { class: "grid", style: { gap: "6px" } }, head, note(invalid
    ? `${invalid === 1 ? "The one label is not" : `None of the ${invalid} labels is`} a valid answer for its question, so nothing can be checked. Calibrate lists the reasons; fix the labels in the table below.`
    : "No labels yet. Label rows in the table below, or include \"_expect\" in JSON rows, and the answers that disagree with their labels appear here."));
  const summary = h("p", { class: "faint", style: { fontSize: "12.5px" } },
    `Checked ${labeled} ${labeled === 1 ? "label" : "labels"} across ${counts.filter((q) => q.labeled).length} of ${counts.length} questions`,
    kept ? `; you kept ${kept} as right` : "", invalid ? `; ${invalid} ${invalid === 1 ? "label is" : "labels are"} not valid answers and ${invalid === 1 ? "was" : "were"} skipped` : "", ".");
  if (!open.length) return h("div", { class: "grid", style: { gap: "6px" } }, head, note(rep.suspects.length ? "Every remaining labeled answer agrees with its label." : "Every labeled answer agrees with its label."), summary);
  const shown = b.review.all.suspects ? open : open.slice(0, REVIEW_SHOWN);
  return h("div", { class: "grid", style: { gap: "6px" } }, head,
    note(`Answers that disagree with their label, lowest probability on the label first. When Jev gave the label ${pct(rep.strong_at)} or less, the label is often the mistake, or the question reads differently to Jev than to you. One wrong label on a confident answer counts against accuracy at every threshold. Fix the label, or keep it if it is right.`),
    h("div", { class: "scroll" }, h("table", { class: "table review-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "question"), h("th", {}, "Jev's answer"),
        h("th", { title: "The probability Jev gave the label" }, "P(label)"), h("th", { title: `Jev's ${SIGNALS[rep.signal]} in its own answer` }, SIGNALS[rep.signal]),
        h("th", {}, "label"), h("th", {}))),
      h("tbody", {}, shown.map((s) => {
        const r = rowsBy.get(s.index);
        return h("tr", {},
          h("td", { class: "num" }, String(s.index + 1)),
          h("td", { class: "row" }, rowText(r.row)),
          h("td", { class: "mono" }, s.question),
          h("td", {}, h("span", { class: "cell-choice" }, s.answer)),
          h("td", { class: "mono" }, pct(s.label_probability, 1), s.strong ? h("span", { class: "badge warning", style: { marginLeft: "6px" }, title: `Jev gave this label ${pct(rep.strong_at)} or less` }, "check first") : null),
          h("td", { class: "mono" }, s.signal.toFixed(2)),
          h("td", {}, labelSelect(r, s.question)),
          h("td", {}, h("button", { class: "btn sm ghost", title: "Hide this disagreement until its label changes",
            onclick: () => { b.review.kept.add(`${s.index}:${s.question}`); mount("#review", ...reviewBody()); } }, "Label is right")));
      })))),
    h("div", {}, moreToggle("suspects", open.length)), summary);
}

function labelNext(rep) {
  const b = W.bulk;
  const qid = rep.question;
  const head = h("h3", { class: "cal-h" }, qid ? `Label next · ${qid}` : "Label next");
  const note = (text) => h("p", { class: "muted", style: { fontSize: "13px" } }, text);
  if (!qid) return h("div", { class: "grid", style: { gap: "6px" } }, head, note("Choose a Choice, Noul, or Score question in Calibrate to rank its unlabeled rows."));
  if (!rep.next.length) return h("div", { class: "grid", style: { gap: "6px" } }, head, note(`Every answered row has a label for “${qid}”.`));
  const rowsBy = new Map(b.result.results.map((r) => [r.index, r]));
  const shown = b.review.all.next ? rep.next : rep.next.slice(0, REVIEW_SHOWN);
  const t = rep.threshold.toFixed(2);
  return h("div", { class: "grid", style: { gap: "6px" } }, head,
    note(`${rep.next.length} answered ${rep.next.length === 1 ? "row has" : "rows have"} no label for “${qid}”. Those nearest Calibrate's threshold, ${SIGNALS[rep.signal]} ≥ ${t}, come first: just above it they are automated now, and just below it they would be if the threshold dropped, so their labels decide whether it can move. Moving the slider re-ranks them.`),
    h("div", { class: "scroll" }, h("table", { class: "table review-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "Jev's answer"), h("th", {}, SIGNALS[rep.signal]), h("th", {}, `at ≥ ${t}`), h("th", {}, "label"))),
      h("tbody", {}, shown.map((x) => {
        const r = rowsBy.get(x.index);
        return h("tr", {},
          h("td", { class: "num" }, String(x.index + 1)),
          h("td", { class: "row" }, rowText(r.row)),
          h("td", {}, h("span", { class: "cell-choice" }, x.answer), h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, pct(x.top))),
          h("td", { class: "mono" }, x.signal.toFixed(2)),
          h("td", {}, x.above ? statusBadge("execute", "Auto") : statusBadge("review")),
          h("td", {}, labelSelect(r, qid)));
      })))),
    h("div", {}, moreToggle("next", rep.next.length)));
}
