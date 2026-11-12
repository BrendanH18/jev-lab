// Workbench entry point: boots the page, switches tabs and renders the current one. The panels live in the
// workbench-*.js modules it imports; they share the page state through W (workbench-state.js) and call render()
// from here. Modules only declare functions and constants at load time, so their import cycles are safe.
import { $, api, debounce, h, handleError, initChrome, mount, toast } from "./common.js";
import { readHandoff } from "./handoff.js";
import { renderWorkbenchGuide } from "./workbench-guide.js";
import { createGuidelines } from "./guidelines.js";
import { renderExamplesBrowser } from "./examples-browser.js";
import { W } from "./workbench-state.js";
import { buildUnsaved, loadInto, renderBuild } from "./workbench-build.js";
import { renderTests } from "./workbench-tests.js";
import { rowsText, bulkUnsaved, countRows, bulkQuestions, renderBulk } from "./workbench-bulk.js";
import { healthContext } from "./workbench-import.js";
import { datasetEditsUnsaved } from "./dataset-edits.js";
import { agreementSessionsUnsaved } from "./workbench-datasets.js";
import { preparedLabelsUnsaved } from "./workbench-labeling.js";
import { reviewQueuesUnsaved, confirmReviewDiscard } from "./workbench-review.js";
import { driftQueuesUnsaved } from "./workbench-drift.js";
import { updateCal, syncAttachedSets } from "./workbench-calibrate.js";
import { updatePolicy } from "./workbench-policy.js";
import { renderCompare, updateCmpChart, updateCascade } from "./workbench-compare.js";

// Labeling guidelines (static/js/guidelines.js): human-only, shown beside label controls, never sent to the model.
// Kept on W so a view rendered without it (tests/js) simply shows no guideline.
W.guides = createGuidelines({ h, api, handleError, toast, rerender: () => render(), beforeSave: (id) => confirmReviewDiscard(id) });
const TABS = [["build", "Build"], ["tests", "Tests"], ["bulk", "Bulk"], ["compare", "Compare"], ["examples", "Examples"]];

// ---------- boot ----------
async function boot() {
  await initChrome("/workbench");
  const [ex, items, sample, pics, sets] = await Promise.all([api("/api/workbench/examples"), api("/api/workbench/items"),
    api("/api/workbench/bulk/sample"), api("/api/images/samples"), api("/api/workbench/datasets")]);
  W.samples = pics.samples;
  W.maxImages = pics.limits.max_images;
  W.examples = ex.examples;
  W.items = items.items;
  W.bulk.rowsText = W.bulk.savedText = rowsText(sample.rows);
  W.bulk.datasets = sets.datasets;
  window.addEventListener("beforeunload", (e) => { if (bulkUnsaved() || preparedLabelsUnsaved() || reviewQueuesUnsaved() || driftQueuesUnsaved() || datasetEditsUnsaved() || buildUnsaved() || agreementSessionsUnsaved()) { e.preventDefault(); e.returnValue = ""; } });
  W.bulk.sampleQuestions = sample.questions;
  W.compare.terse = sample.terse_questions;
  W.compare.variants[0].text = JSON.stringify(sample.questions, null, 2);
  W.compare.variants[1].text = JSON.stringify(sample.terse_questions, null, 2);
  const first = W.examples[0];
  let handed = null;
  try { handed = readHandoff(localStorage); } catch { /* site data blocked: reading localStorage itself throws */ }
  if (handed) {
    loadInto(handed.state, handed.questions, { images: handed.images, handoff: { source: handed.source, model: handed.model } });
    return;
  }
  loadInto(first.state, first.questions, { expect: first.expect, example: first.id, images: first.images });
  const hash = location.hash.replace("#", "");
  if (TABS.some(([k]) => k === hash)) { W.tab = hash; render(); }
}

// ---------- render ----------
export function renderGuide() {
  const b = W.bulk;
  const questions = bulkQuestions() || {};
  mount("#workbench-guide", renderWorkbenchGuide(h, {
    questionCount: Object.keys(questions).length, rowCount: countRows(b.rowsText),
    currentRun: !!b.result && b.runText === b.rowsText && JSON.stringify(b.ranQuestions) === JSON.stringify(questions),
    healthCurrent: !!b.health.report && b.health.context === healthContext(),
    gateableCount: Object.values(questions).filter((q) => ["choice", "noul", "score"].includes(q.type)).length,
    hasSavedCheck: b.datasets.some((d) => d.check),
  }, (tab, target) => {
    W.tab = tab;
    location.hash = tab;
    render();
    $(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, { open: W.guideOpen, onToggle: (open) => { W.guideOpen = open; } }));
}

export function render() {
  syncAttachedSets();
  let view;
  switch (W.tab) {
    case "tests": view = renderTests(); break;
    case "bulk": view = renderBulk(); break;
    case "compare": view = renderCompare(); break;
    case "examples": view = renderExamplesBrowser(h, W.examples, (ex) => loadInto(ex.state, ex.questions, { expect: ex.expect, example: ex.id, images: ex.images })); break;
    default:
      W.tab = "build";
      view = renderBuild();
  }
  mount("#tabs", TABS.map(([k, label]) => h("button", { class: `tab${W.tab === k ? " active" : ""}`, onclick: () => { W.tab = k; location.hash = k; render(); } },
    label, k === "tests" && W.items.length ? ` (${W.items.length})` : "")));
  mount("#view", view);
  renderGuide();
  if (W.tab === "bulk") { updateCal(); updatePolicy(); }
  if (W.tab === "compare") { updateCmpChart(); updateCascade(); }
}

window.addEventListener("resize", debounce(() => { if (W.tab === "bulk") updateCal(); if (W.tab === "compare") { updateCmpChart(); updateCascade(); } }, 150));
boot().catch(handleError);
