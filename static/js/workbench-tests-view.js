// View state, saved test visibility, and actions available from the saved test list.
import { $, api, handleError } from "./common.js";
import {
  firstVisibleSuiteIds,
  pruneTestResults,
  selectedTestIds,
  selectedTestSummary,
  suiteInventoryText,
  testResultStatus,
  testStatusSummary,
  visibleTests,
} from "./test-selection.js";
import { W } from "./workbench-state.js";
import { loadInto } from "./workbench-build.js";

// Filters only change presentation. Selections and session answers survive filters and partial runs.
const testFilterDefaults = () => ({
  status: "all",
  type: "all",
  expectations: "all",
  images: "all",
  selection: "all",
  sort: "saved",
  minQuestions: "",
  maxQuestions: "",
  stateType: "all",
  notes: "all",
  questionId: "",
  coverage: "all",
  typeMix: "all",
  searchField: "all",
  exclude: "",
  minExpectations: "",
  maxExpectations: "",
  minImages: "",
  maxImages: "",
  idPrefix: "",
  excludeType: "all",
  minStateBytes: "",
  maxStateBytes: "",
  namePrefix: "",
  idSuffix: "",
  questionMatch: "contains",
  minUncovered: "",
  maxUncovered: "",
  minOptions: "",
  maxOptions: "",
  minInstructions: "",
  maxInstructions: "",
  minLatency: "",
  maxLatency: "",
  minCost: "",
  maxCost: "",
  latency: "all",
  cost: "all",
  minCriteria: "",
  maxCriteria: "",
  minCriteriaCharacters: "",
  maxCriteriaCharacters: "",
  minScoreLevels: "",
  maxScoreLevels: "",
  minOrphanExpectations: "",
  maxOrphanExpectations: "",
  orphanExpectations: "all",
});
const testView = {
  ...testFilterDefaults(),
  selected: [],
  busy: false,
  details: true,
  advanced: false,
  previousSelection: null,
  planning: false,
  pastedIds: "",
  pastedPreview: null,
  firstCount: "5",
};

export function reconcileTests() {
  testView.selected = selectedTestIds(W.items, testView.selected);
  W.runResults = pruneTestResults(W.runResults, W.items);
}

export function shownTests() {
  return visibleTests(W.items, W.runResults, {
    ...testView,
    query: W.testSearch || "",
  });
}

export function unsuccessfulTestIds() {
  return (W.runResults?.runs || [])
    .filter((run) => ["fail", "error"].includes(testResultStatus(run)))
    .map((run) => run.id);
}

export function testCountText(shown = shownTests()) {
  return `${shown.length} of ${W.items.length} tests shown · ${testView.selected.length} selected. Run all runs every saved test.`;
}

// Typing into search keeps focus and the cursor, and never changes selection.
export function refreshTestVisibility() {
  const shown = shownTests();
  const visible = new Set(shown.map((item) => item.id));
  $("#saved-test-results")
    ?.querySelectorAll(".saved-test-item")
    .forEach((row) => {
      row.style.display = visible.has(row.dataset.testId) ? "" : "none";
    });
  const count = $("#saved-test-count");
  if (count) count.textContent = testCountText(shown);
  const summary = $("#saved-test-visible-summary");
  const totals = selectedTestSummary(
    W.items,
    shown.map((item) => item.id),
  );
  if (summary)
    summary.textContent = `Visible requests: ${totals.tests} tests · ${totals.questions} questions · ${totals.expectations} expectations · ${totals.images} pictures. Input counts only.`;
  for (const id of ["saved-test-copy-ids", "saved-test-export-metadata", "saved-test-export-csv"]) {
    const button = $(`#${id}`);
    if (button) button.disabled = !visible.size;
  }
  const replaceSelection = $("#saved-test-replace-visible");
  if (replaceSelection) replaceSelection.disabled = testView.busy || !visible.size;
  const byId = new Map((W.runResults?.runs || []).map((run) => [run.id, run]));
  for (const status of ["error", "fail", "not-run"]) {
    const button = $(`#saved-test-select-visible-${status}`);
    if (button)
      button.disabled = testView.busy || !shown.some((item) => testResultStatus(byId.get(item.id)) === status);
  }
  const statuses = $("#saved-test-visible-statuses");
  if (statuses) statuses.textContent = testStatusSummary(shown, W.runResults);
  const inventory = $("#saved-test-visible-inventory");
  if (inventory) inventory.textContent = `Visible schema: ${suiteInventoryText(shown)}`;
  const inventoryDownload = $("#saved-test-visible-inventory-download");
  if (inventoryDownload) inventoryDownload.disabled = !shown.length;
  const firstButton = $("#saved-test-first-visible");
  if (firstButton)
    firstButton.disabled =
      testView.busy || !shown.length || !firstVisibleSuiteIds(W.items, testView.selected, shown, testView.firstCount);
  const empty = $("#saved-test-no-match");
  if (empty) empty.hidden = visible.size > 0;
  const selectVisible = $("#saved-test-select-visible");
  if (selectVisible) selectVisible.disabled = testView.busy || !visible.size;
  for (const id of ["saved-test-deselect-visible", "saved-test-invert-visible"]) {
    const button = $(`#${id}`);
    if (button) button.disabled = testView.busy || !visible.size;
  }
}

export async function openItem(it) {
  try {
    const images = it.images ? (await api("/api/workbench/items/images", { id: it.id })).images : {};
    loadInto(it.state, it.questions, { expect: it.expect, name: it.name, notes: it.notes, id: it.id, images });
  } catch (e) {
    handleError(e);
  }
}

export { testFilterDefaults, testView };
