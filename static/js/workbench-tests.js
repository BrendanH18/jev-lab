// Tests tab: saved requests, current-page selection, and results from user-triggered live runs.
import { $, api, callStats, copyText, h, handleError, icon, inspect, ms, statusBadge, toast, usd } from "./common.js";
import { confirmSpend, estimateLine } from "./estimate.js";
import { testResultStatus, visibleTests, selectedTestIds, selectVisibleTests, deselectVisibleTests, invertVisibleTests, testRunBody,
  testRunSnapshot, pruneTestResults, mergeTestResults, selectedTestSummary, testMetadataJson, testMetadataCsv, testStatusSummary, testObservedSummary, suiteInventoryText, suiteQuestionInventory, previewSuiteIds, applySuiteIds, firstVisibleSuiteIds } from "./test-selection.js";
import { W } from "./workbench-state.js";
import { loadInto } from "./workbench-build.js";
import { render } from "./workbench.js";

// Filters only change presentation. Selections and session answers survive filters and partial runs.
const testFilterDefaults = () => ({ status: "all", type: "all", expectations: "all", images: "all", selection: "all", sort: "saved", minQuestions: "", maxQuestions: "", stateType: "all", notes: "all", questionId: "", coverage: "all", typeMix: "all", searchField: "all", exclude: "", minExpectations: "", maxExpectations: "", minImages: "", maxImages: "", idPrefix: "", excludeType: "all", minStateBytes: "", maxStateBytes: "", namePrefix: "", idSuffix: "", questionMatch: "contains", minUncovered: "", maxUncovered: "", minOptions: "", maxOptions: "", minInstructions: "", maxInstructions: "", minLatency: "", maxLatency: "", minCost: "", maxCost: "", latency: "all", cost: "all", minCriteria: "", maxCriteria: "", minCriteriaCharacters: "", maxCriteriaCharacters: "", minScoreLevels: "", maxScoreLevels: "", minOrphanExpectations: "", maxOrphanExpectations: "", orphanExpectations: "all" });
const testView = { ...testFilterDefaults(), selected: [], busy: false, details: true, advanced: false, previousSelection: null, planning: false, pastedIds: "", pastedPreview: null, firstCount: "5" };

function reconcileTests() {
  testView.selected = selectedTestIds(W.items, testView.selected);
  W.runResults = pruneTestResults(W.runResults, W.items);
}

function shownTests() {
  return visibleTests(W.items, W.runResults, { ...testView, query: W.testSearch || "" });
}

function unsuccessfulTestIds() {
  return (W.runResults?.runs || []).filter((run) => ["fail", "error"].includes(testResultStatus(run))).map((run) => run.id);
}

function testCountText(shown = shownTests()) {
  return `${shown.length} of ${W.items.length} tests shown · ${testView.selected.length} selected. Run all runs every saved test.`;
}

// Typing into search keeps focus and the cursor, and never changes selection.
function refreshTestVisibility() {
  const shown = shownTests();
  const visible = new Set(shown.map((item) => item.id));
  $("#saved-test-results")?.querySelectorAll(".saved-test-item").forEach((row) => {
    row.style.display = visible.has(row.dataset.testId) ? "" : "none";
  });
  const count = $("#saved-test-count");
  if (count) count.textContent = testCountText(shown);
  const summary = $("#saved-test-visible-summary");
  const totals = selectedTestSummary(W.items, shown.map((item) => item.id));
  if (summary) summary.textContent = `Visible requests: ${totals.tests} tests · ${totals.questions} questions · ${totals.expectations} expectations · ${totals.images} pictures. Input counts only.`;
  for (const id of ["saved-test-copy-ids", "saved-test-export-metadata", "saved-test-export-csv"]) {
    const button = $(`#${id}`);
    if (button) button.disabled = !visible.size;
  }
  const replaceSelection = $("#saved-test-replace-visible");
  if (replaceSelection) replaceSelection.disabled = testView.busy || !visible.size;
  const byId = new Map((W.runResults?.runs || []).map((run) => [run.id, run]));
  for (const status of ["error", "fail", "not-run"]) {
    const button = $(`#saved-test-select-visible-${status}`);
    if (button) button.disabled = testView.busy || !shown.some((item) => testResultStatus(byId.get(item.id)) === status);
  }
  const statuses = $("#saved-test-visible-statuses");
  if (statuses) statuses.textContent = testStatusSummary(shown, W.runResults);
  const inventory = $("#saved-test-visible-inventory");
  if (inventory) inventory.textContent = `Visible schema: ${suiteInventoryText(shown)}`;
  const inventoryDownload = $("#saved-test-visible-inventory-download");
  if (inventoryDownload) inventoryDownload.disabled = !shown.length;
  const firstButton = $("#saved-test-first-visible");
  if (firstButton) firstButton.disabled = testView.busy || !shown.length || !firstVisibleSuiteIds(W.items, testView.selected, shown, testView.firstCount);
  const empty = $("#saved-test-no-match");
  if (empty) empty.hidden = visible.size > 0;
  const selectVisible = $("#saved-test-select-visible");
  if (selectVisible) selectVisible.disabled = testView.busy || !visible.size;
  for (const id of ["saved-test-deselect-visible", "saved-test-invert-visible"]) {
    const button = $(`#${id}`);
    if (button) button.disabled = testView.busy || !visible.size;
  }
}

// ---------- Tests ----------
export function renderTests() {
  reconcileTests();
  const res = W.runResults;
  const busy = testView.busy;
  const query = W.testSearch || "";
  const shown = new Set(shownTests().map((item) => item.id));
  const selected = new Set(testView.selected);
  const search = h("input", { class: "input", type: "search", value: query, placeholder: "Search saved tests",
    "aria-label": "Search saved tests", oninput: (event) => {
      W.testSearch = event.target.value;
      refreshTestVisibility();
    } });
  const filter = (label, field, options) => h("label", { class: "faint" }, label, " ",
    h("select", { class: "input sm", "aria-label": label, onchange: (event) => {
      testView[field] = event.target.value;
      render();
    } }, options.map(([value, text]) => h("option", { value, selected: testView[field] === value }, text))));
  const byId = new Map((res?.runs || []).map((run) => [run.id, run]));
  const failed = unsuccessfulTestIds();
  const unrun = W.items.filter((item) => !byId.has(item.id)).map((item) => item.id);
  const summary = selectedTestSummary(W.items, testView.selected);
  const visibleSummary = selectedTestSummary(W.items, [...shown]);
  const passed = W.items.filter((item) => testResultStatus(byId.get(item.id)) === "pass").map((item) => item.id);
  const selectedObserved = testObservedSummary(W.items.filter((item) => selected.has(item.id)), res);
  const ordered = visibleTests(W.items, res, { sort: testView.sort });
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "panel tests", "aria-busy": String(busy) },
      h("div", { class: "panel-head" }, h("h2", {}, "Saved tests · data/workbench/"), h("div", { class: "spacer" }),
        res ? h("div", { class: "stat-row" },
          h("span", { class: `badge ${res.failed || res.errors ? "critical" : "good"}` },
            `${res.passed} passed · ${res.failed} failed · ${res.errors} errors · ${res.unrun} not run`),
          h("span", { class: "stat" }, "session wall total", h("b", {}, ms(res.wall_ms))),
          h("span", { class: "stat" }, "session spend", h("b", {}, usd(res.cost_usd)))) : null),
      h("div", { class: "panel-body grid", style: { gap: "10px" } },
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
          h("button", { class: "btn primary", disabled: busy || !W.items.length, onclick: () => runTests() }, icon("play"), `Run all ${W.items.length} tests`),
          estimateLine(h, api, "items", () => testRunBody(W.items)),
          h("button", { class: "btn", disabled: busy || !failed.length, onclick: () => runTests(unsuccessfulTestIds()) }, `Rerun ${failed.length} failed / errors`),
          h("button", { class: "btn", disabled: busy || !unrun.length, onclick: () => runTests(unrun) }, `Run ${unrun.length} not run`),
          h("button", { class: "btn ghost", disabled: busy || !res, onclick: () => { W.runResults = null; render(); } }, "Clear session results")),
        busy ? h("p", { class: "faint", role: "status" }, "Checking spend or running saved tests…") : null,
        res ? h("p", { class: "faint", style: { margin: 0, fontSize: "12px" } },
          `Latest result per test from this page session. ${res.batches} paid batch${res.batches === 1 ? "" : "es"}; last batch: ${res.last_count} tests. Spend and wall time include every completed batch, including reruns.`) : null,
        search,
        h("input", { class: "input", type: "search", value: testView.exclude,
          placeholder: "Exclude matching tests", "aria-label": "Exclude saved tests", oninput: (event) => {
            testView.exclude = event.target.value; refreshTestVisibility();
          } }),
        h("input", { class: "input", type: "search", value: testView.idPrefix,
          placeholder: "Test ID starts with", "aria-label": "Test ID prefix", oninput: (event) => {
            testView.idPrefix = event.target.value; refreshTestVisibility();
          } }),
        h("input", { class: "input", type: "search", value: testView.questionId,
          placeholder: "Find a question ID", "aria-label": "Test question ID", oninput: (event) => {
            testView.questionId = event.target.value; refreshTestVisibility();
          } }),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
          filter("Search test field", "searchField", [["all", "Name, ID and notes"], ["name", "Name only"], ["id", "ID only"], ["notes", "Notes only"]]),
          filter("Test status", "status", [["all", "All statuses"], ["pass", "Passed"], ["fail", "Failed expectations"], ["error", "Errors"], ["not-run", "Not run"]]),
          filter("Test question type", "type", [["all", "All types"], ["noul", "Yes / no"], ["choice", "Choice"], ["score", "Score"], ["box", "Box"]]),
          filter("Sort tests", "sort", [["fewest-criteria", "Fewest criteria"], ["most-criteria", "Most criteria"], ["shortest-criteria", "Shortest authored criteria"], ["longest-criteria", "Longest authored criteria"], ["fewest-score-levels", "Fewest Score levels"], ["most-score-levels", "Most Score levels"], ["fewest-orphans", "Fewest orphan expectations"], ["most-orphans", "Most orphan expectations"], ["saved", "Saved order"], ["id-desc", "ID Z–A"], ["fewest-images", "Fewest pictures"], ["most-uncovered", "Most uncovered questions"], ["fewest-uncovered", "Fewest uncovered questions"], ["most-options", "Most Choice options"], ["fewest-options", "Fewest Choice options"], ["longest-instructions", "Longest authored instructions"], ["shortest-instructions", "Shortest authored instructions"], ["input-smallest", "Smallest state inputs"], ["input-largest", "Largest state inputs"], ["id", "ID A–Z"], ["images", "Most pictures"], ["fewest-expectations", "Fewest expectations"], ["name", "Name A–Z"], ["name-desc", "Name Z–A"], ["questions", "Most questions"], ["fewest-questions", "Fewest questions"], ["expectations", "Most expectations"], ["problems", "Problems first"], ["slowest", "Slowest observed call"], ["costliest", "Costliest observed call"], ["fastest", "Fastest observed call"], ["cheapest", "Cheapest observed call"]]),
          filter("Exclude question type", "excludeType", [["all", "No type exclusion"], ["noul", "Exclude yes / no"], ["choice", "Exclude Choice"], ["score", "Exclude Score"], ["box", "Exclude Box"]]),
          filter("Test expectations", "expectations", [["all", "Any expectations"], ["with", "With expectations"], ["without", "Without expectations"]]),
          filter("Test pictures", "images", [["all", "Any pictures"], ["with", "With pictures"], ["without", "Without pictures"]]),
          filter("Test input shape", "stateType", [["all", "Any input shape"], ["text", "Plain text"], ["object", "JSON object"], ["array", "JSON array"]]),
          filter("Test expectation coverage", "coverage", [["all", "Any coverage"], ["full", "Every question has expectations"], ["partial", "Some questions have expectations"], ["none", "No questions have expectations"]]),
          filter("Test type mix", "typeMix", [["all", "Any type mix"], ["mixed", "Mixed question types"], ["single", "At most one question type"]]),
          filter("Test notes", "notes", [["all", "Any notes"], ["with", "With notes"], ["without", "Without notes"]]),
          [ ["Minimum state bytes", "minStateBytes"], ["Maximum state bytes", "maxStateBytes"], ["Minimum test questions", "minQuestions"], ["Maximum test questions", "maxQuestions"], ["Minimum test expectations", "minExpectations"], ["Maximum test expectations", "maxExpectations"], ["Minimum test pictures", "minImages"], ["Maximum test pictures", "maxImages"] ].map(([label, field]) =>
            h("label", { class: "faint" }, label, " ", h("input", { class: "input sm", type: "number", min: 0, step: 1,
              value: testView[field], "aria-label": label, style: { width: "90px" }, oninput: (event) => {
                testView[field] = event.target.value; refreshTestVisibility();
              } }))),
          filter("Test selection", "selection", [["all", "All tests"], ["selected", "Selected tests"], ["unselected", "Unselected tests"]]),
          h("button", { class: "btn sm ghost", onclick: () => {
            Object.assign(testView, testFilterDefaults()); W.testSearch = ""; render();
          } }, "Reset test filters")),
        h("details", { open: testView.advanced, ontoggle: (event) => { testView.advanced = event.target.open; } },
          h("summary", {}, "Advanced suite triage"),
          h("div", { class: "grid", style: { gap: "10px", marginTop: "10px" } },
            h("p", { class: "faint" }, "Authored counts describe the saved requests. Measurement filters use the latest current session call only; unknown values never satisfy a numeric bound."),
            [["Test name starts with", "namePrefix"], ["Test ID ends with", "idSuffix"]].map(([label, field]) =>
              h("input", { class: "input", type: "search", "aria-label": label, placeholder: label, value: testView[field],
                oninput: (event) => { testView[field] = event.target.value; refreshTestVisibility(); } })),
            filter("Question ID matching", "questionMatch", [["contains", "Contains text"], ["exact", "Exact ID"]]),
            filter("Latency measurement", "latency", [["all", "Any latency"], ["with", "Measured latency"], ["without", "Unknown latency"]]),
            filter("Spend measurement", "cost", [["all", "Any spend"], ["with", "Measured spend"], ["without", "Unknown spend"]]),
            [["Minimum uncovered questions", "minUncovered"], ["Maximum uncovered questions", "maxUncovered"],
              ["Minimum Choice options", "minOptions"], ["Maximum Choice options", "maxOptions"],
              ["Minimum instruction characters", "minInstructions"], ["Maximum instruction characters", "maxInstructions"],
              ["Minimum observed latency ms", "minLatency"], ["Maximum observed latency ms", "maxLatency"],
              ["Minimum observed spend USD", "minCost"], ["Maximum observed spend USD", "maxCost"]].map(([label, field]) =>
              h("label", { class: "faint" }, label, " ", h("input", { class: "input sm", type: "number", min: 0,
                step: /Cost|Latency/.test(field) ? "any" : 1, "aria-label": label, value: testView[field],
                oninput: (event) => { testView[field] = event.target.value; refreshTestVisibility(); } }))),
            h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              h("button", { class: "btn sm", id: "saved-test-replace-visible", disabled: busy || !shown.size, onclick: () => {
                testView.previousSelection = [...testView.selected]; testView.selected = shownTests().map((item) => item.id); render();
              } }, "Replace selection with visible"),
              [["error", "Select visible errors"], ["fail", "Select visible failed expectations"], ["not-run", "Select visible not run"]].map(([status, label]) =>
                h("button", { class: "btn sm", id: `saved-test-select-visible-${status}`, disabled: busy || !shownTests().some((item) => testResultStatus(byId.get(item.id)) === status), onclick: () => {
                  testView.previousSelection = [...testView.selected];
                  testView.selected = selectVisibleTests(W.items, testView.selected, shownTests().filter((item) => testResultStatus(byId.get(item.id)) === status)); render();
                } }, label)),
              h("button", { class: "btn sm", disabled: busy || testView.previousSelection === null, onclick: () => {
                testView.selected = selectedTestIds(W.items, testView.previousSelection || []); testView.previousSelection = null; render();
              } }, "Undo selection change"),
              h("button", { class: "btn sm", disabled: !selected.size,
                onclick: () => copyText(testMetadataJson(W.items.filter((item) => testView.selected.includes(item.id)), W.runResults)) }, "Copy selected metadata JSON")))),
        h("details", { open: testView.planning, ontoggle: (event) => { testView.planning = event.target.open; } },
          h("summary", {}, "Suite planning and schema inventory"),
          h("div", { class: "grid", style: { gap: "10px", marginTop: "10px" } },
            h("p", { class: "faint" }, "Authored criteria count entries across question types; text sizes count Unicode characters in descriptions. Orphan expectations reference removed questions. These diagnostics make no model calls or saved changes."),
            filter("Orphan expectations", "orphanExpectations", [["all", "Any orphan count"], ["with", "With orphan expectations"], ["without", "Without orphan expectations"]]),
            [["Minimum criteria", "minCriteria"], ["Maximum criteria", "maxCriteria"],
              ["Minimum criterion characters", "minCriteriaCharacters"], ["Maximum criterion characters", "maxCriteriaCharacters"],
              ["Minimum Score levels", "minScoreLevels"], ["Maximum Score levels", "maxScoreLevels"],
              ["Minimum orphan expectations", "minOrphanExpectations"], ["Maximum orphan expectations", "maxOrphanExpectations"]].map(([label, field]) =>
              h("label", { class: "faint" }, label, " ", h("input", { class: "input sm", type: "number", min: 0, step: 1,
                "aria-label": label, value: testView[field], oninput: (event) => {
                  testView[field] = event.target.value; refreshTestVisibility();
                } }))),
            h("p", { class: "faint", id: "saved-test-visible-inventory", "aria-live": "polite" }, `Visible schema: ${suiteInventoryText(shownTests())}`),
            h("p", { class: "faint" }, `Selected schema: ${suiteInventoryText(W.items.filter((item) => selected.has(item.id)))}`),
            h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              [["visible", "Download visible question inventory"], ["selected", "Download selected question inventory"]].map(([scope, label]) =>
                h("button", { class: "btn sm", id: `saved-test-${scope}-inventory-download`, disabled: scope === "visible" ? !shown.size : !selected.size,
                  onclick: () => {
                    const items = scope === "visible" ? shownTests() : W.items.filter((item) => testView.selected.includes(item.id));
                    const content = JSON.stringify(suiteQuestionInventory(items), null, 2);
                    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
                    h("a", { href: url, download: `jev-${scope}-question-inventory.json` }).click(); URL.revokeObjectURL(url);
                  } }, label))),
            h("p", { class: "faint" }, "Question inventories contain IDs, types and occurrence/expectation counts only. No instructions, labels, state, answers or measurement data."),
            h("label", { class: "faint" }, "Saved test IDs, one per line", h("textarea", { class: "input", rows: 4, value: testView.pastedIds,
              "aria-label": "Saved test IDs to select", oninput: (event) => {
                testView.pastedIds = event.target.value; testView.pastedPreview = null;
                for (const id of ["saved-test-paste-add", "saved-test-paste-remove"]) {
                  const button = $(`#${id}`); if (button) button.disabled = true;
                }
                const status = $("#saved-test-paste-preview"); if (status) status.textContent = "IDs changed. Preview again before changing selection.";
              } })),
            h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              h("button", { class: "btn sm", disabled: busy, onclick: () => {
                testView.pastedPreview = previewSuiteIds(W.items, testView.pastedIds); render();
              } }, "Preview pasted IDs"),
              [["add", "Add pasted IDs to selection"], ["remove", "Remove pasted IDs from selection"]].map(([mode, label]) =>
                h("button", { class: "btn sm", id: `saved-test-paste-${mode}`, disabled: busy || !testView.pastedPreview?.matched.length,
                  onclick: () => {
                    if (testView.busy) return;
                    const current = previewSuiteIds(W.items, testView.pastedIds);
                    if (JSON.stringify(current) !== JSON.stringify(testView.pastedPreview)) {
                      testView.pastedPreview = null; render(); return;
                    }
                    testView.previousSelection = [...testView.selected];
                    testView.selected = applySuiteIds(W.items, testView.selected, current, mode); render();
                  } }, label))),
            h("p", { class: "faint", id: "saved-test-paste-preview", "aria-live": "polite" }, testView.pastedPreview
              ? `${testView.pastedPreview.matched.length} saved IDs matched; ${testView.pastedPreview.unknown.length} unknown IDs ignored. Add or Remove changes selection only.`
              : "Preview IDs before changing selection. Matching is exact and case-sensitive; duplicates are ignored."),
            h("label", { class: "faint" }, "Visible selection limit", " ", h("input", { class: "input sm", type: "number", min: 1, step: 1,
              "aria-label": "Visible selection limit", value: testView.firstCount, oninput: (event) => {
                testView.firstCount = event.target.value; refreshTestVisibility();
              } })),
            h("button", { class: "btn sm", id: "saved-test-first-visible", disabled: busy || !shown.size || !firstVisibleSuiteIds(W.items, testView.selected, shownTests(), testView.firstCount),
              onclick: () => {
                if (testView.busy) return;
                const next = firstVisibleSuiteIds(W.items, testView.selected, shownTests(), testView.firstCount);
                if (!next) return;
                testView.previousSelection = [...testView.selected]; testView.selected = next; render();
              } }, "Add first N visible to selection"))),
        h("p", { class: "faint", "aria-live": "polite" },
          `Selected latest calls: ${selectedObserved.costCount}/${selectedObserved.tests} with measured spend (sum ${usd(selectedObserved.costTotal)}); ${selectedObserved.latencyCount}/${selectedObserved.tests} with measured latency (sum ${ms(selectedObserved.latencyTotal)}). Excludes previous rerun attempts; not wall time or a spend estimate.`),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
          h("button", { class: "btn sm", id: "saved-test-select-visible", disabled: busy || !shown.size,
            onclick: () => { testView.previousSelection = [...testView.selected]; testView.selected = selectVisibleTests(W.items, testView.selected, shownTests()); render(); } }, "Select visible"),
          h("button", { class: "btn sm", id: "saved-test-deselect-visible", disabled: busy || !shown.size,
            onclick: () => { testView.previousSelection = [...testView.selected]; testView.selected = deselectVisibleTests(W.items, testView.selected, shownTests()); render(); } }, "Deselect visible"),
          h("button", { class: "btn sm", id: "saved-test-invert-visible", disabled: busy || !shown.size,
            onclick: () => { testView.previousSelection = [...testView.selected]; testView.selected = invertVisibleTests(W.items, testView.selected, shownTests()); render(); } }, "Invert visible selection"),
          h("button", { class: "btn sm", disabled: busy || !failed.length,
            onclick: () => { testView.previousSelection = [...testView.selected]; testView.selected = selectedTestIds(W.items, [...testView.selected, ...unsuccessfulTestIds()]); render(); } }, "Select failed / errors"),
          h("button", { class: "btn sm", disabled: busy || !unrun.length,
            onclick: () => { testView.previousSelection = [...testView.selected]; testView.selected = selectedTestIds(W.items, [...testView.selected, ...unrun]); render(); } }, "Select not run"),
          h("button", { class: "btn sm", disabled: busy || !passed.length,
            onclick: () => { testView.previousSelection = [...testView.selected]; testView.selected = selectedTestIds(W.items, [...testView.selected, ...passed]); render(); } }, "Select passed"),
          h("button", { class: "btn sm ghost", disabled: busy || !selected.size,
            onclick: () => { testView.previousSelection = [...testView.selected]; testView.selected = []; render(); } }, "Clear selection"),
          h("button", { class: "btn sm primary", disabled: busy || !selected.size,
            onclick: () => runTests(testView.selected, true) }, `Run selected (${selected.size})`),
          estimateLine(h, api, "items", () => testRunBody(W.items, testView.selected))),
        h("p", { class: "faint", style: { margin: 0 } },
          `Selected requests: ${summary.tests} tests · ${summary.questions} questions · ${summary.expectations} expectations · ${summary.images} pictures. Counts describe saved inputs, not spend.`),
        h("p", { class: "faint", id: "saved-test-visible-summary", style: { margin: 0 } },
          `Visible requests: ${visibleSummary.tests} tests · ${visibleSummary.questions} questions · ${visibleSummary.expectations} expectations · ${visibleSummary.images} pictures. Input counts only.`),
        h("p", { class: "faint", id: "saved-test-visible-statuses", "aria-live": "polite", style: { margin: 0 } },
          testStatusSummary(shownTests(), W.runResults)),
        h("p", { class: "faint", style: { margin: 0 } }, "State sizes count UTF-8 bytes of text or serialized JSON, excluding pictures. They are not token or spend estimates."),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h("button", { class: "btn sm", id: "saved-test-copy-ids", disabled: !shown.size,
            onclick: () => copyText(shownTests().map((item) => item.id).join("\n")) }, "Copy visible test IDs"),
          h("button", { class: "btn sm", id: "saved-test-export-metadata", disabled: !shown.size,
            onclick: () => {
              const url = URL.createObjectURL(new Blob([testMetadataJson(shownTests(), W.runResults)], { type: "application/json" }));
              h("a", { href: url, download: "jev-test-metadata.json" }).click();
              URL.revokeObjectURL(url);
            } }, "Download visible metadata JSON"),
          h("button", { class: "btn sm", id: "saved-test-export-csv", disabled: !shown.size,
            onclick: () => downloadTestMetadata(shownTests(), "csv") }, "Download visible metadata CSV"),
          h("button", { class: "btn sm", disabled: !selected.size,
            onclick: () => downloadTestMetadata(W.items.filter((item) => testView.selected.includes(item.id)), "json") }, "Download selected metadata JSON"),
          h("button", { class: "btn sm", disabled: !selected.size,
            onclick: () => downloadTestMetadata(W.items.filter((item) => testView.selected.includes(item.id)), "csv") }, "Download selected metadata CSV")),
        h("button", { class: "btn sm", disabled: !selected.size,
          onclick: () => copyText(selectedTestIds(W.items, testView.selected).join("\n")) }, "Copy selected test IDs"),
        h("label", { class: "faint" }, h("input", { type: "checkbox", checked: testView.details,
          onchange: (event) => { testView.details = event.target.checked; render(); } }), " Show result checks and call details"),
        h("span", { class: "faint", id: "saved-test-count", "aria-live": "polite" }, testCountText())),
      W.items.length ? h("div", { id: "saved-test-results" },
        h("div", { class: "empty", id: "saved-test-no-match", hidden: shown.size > 0 }, "No saved tests match these filters. Your selection is kept."),
        ordered.map((it) => {
          const r = byId.get(it.id);
          return h("div", { class: "item saved-test-item", "data-test-id": it.id, style: { display: shown.has(it.id) ? "" : "none" } },
            h("input", { type: "checkbox", checked: selected.has(it.id), disabled: busy, "aria-label": `Select test ${it.name || it.id}`,
              onchange: (event) => {
                testView.previousSelection = [...testView.selected];
                testView.selected = event.target.checked ? selectedTestIds(W.items, [...testView.selected, it.id]) : testView.selected.filter((id) => id !== it.id);
                render();
              } }),
            h("div", { class: "grid", style: { gap: "4px", flex: "1" } },
              h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                r ? (r.error ? h("span", { class: "badge critical" }, "error") : statusBadge(r.ok ? "pass" : "fail")) : null,
                h("b", {}, it.name), h("code", { class: "faint" }, it.id),
                h("span", { class: "faint", style: { fontSize: "12px" } }, `${Object.keys(it.questions).length} questions · ${Object.keys(it.expect || {}).length} expectations`
                  + (it.images ? ` · ${Object.keys(it.images).length} image${Object.keys(it.images).length > 1 ? "s" : ""}` : ""))),
              it.notes ? h("div", { class: "muted", style: { fontSize: "12.5px" } }, it.notes) : null,
              r?.error ? h("div", { class: "checks", style: { color: "var(--critical-text)" } }, r.error) : null,
              testView.details && r && !r.error ? h("div", { class: "checks" }, Object.entries(r.results).map(([qid, q]) =>
                h("span", { style: { marginRight: "12px", color: q.ok === false ? "var(--critical-text)" : q.ok ? "var(--good-text)" : "var(--faint)" } },
                  `${qid}: ${q.checks.join(", ")}`))) : null,
              testView.details && r?.meta ? h("div", {}, callStats(r.meta, () => inspect(r.trace, `Test · ${it.name}`))) : null),
            h("div", { style: { display: "flex", gap: "6px" } },
              h("button", { class: "btn sm", onclick: () => openItem(it) }, "Open"),
              h("button", { class: "btn sm ghost", disabled: busy, "aria-label": `Run test ${it.name || it.id}`,
                onclick: () => runTests([it.id]) }, icon("play")),
              h("button", { class: "btn sm ghost danger", disabled: busy, "aria-label": `Delete test ${it.name || it.id}`,
                onclick: () => deleteTest(it.id) }, icon("trash"))));
        })) : h("div", { class: "empty" }, "No saved tests yet. Run something in Build, then “Save as test”. Files land in data/workbench/ so they can be committed alongside your code.")),
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Why tests for a model?")),
      h("div", { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
        h("p", { class: "muted" }, "Question wording is code. When you reword an instruction, add an option, or move to a new model version (aliases like jev-latest move), run the suite and see what changed."),
        h("p", { class: "muted" }, "Expectations are ranges on probabilities, not exact numbers, because calibrated models are allowed to be a little different run to run."),
        h("p", { class: "muted" }, "Each test is one JSON file with the request and the expectations, so you can also load them in CI with the Python SDK."))));
}

function downloadTestMetadata(items, format) {
  const content = format === "csv" ? testMetadataCsv(items, W.runResults) : testMetadataJson(items, W.runResults);
  const url = URL.createObjectURL(new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
  h("a", { href: url, download: `jev-test-metadata.${format}` }).click();
  URL.revokeObjectURL(url);
}

async function openItem(it) {
  try {
    const images = it.images ? (await api("/api/workbench/items/images", { id: it.id })).images : {};
    loadInto(it.state, it.questions, { expect: it.expect, name: it.name, notes: it.notes, id: it.id, images });
  } catch (e) { handleError(e); }
}

async function runTests(ids = null, fromSelection = false) {
  if (testView.busy) return;
  reconcileTests();
  const body = testRunBody(W.items, ids);
  if (!body) return;
  const snapshot = testRunSnapshot(W.items, body);
  const requestedItems = JSON.parse(JSON.stringify(W.items.filter((item) => body.ids.includes(item.id))));
  testView.busy = true;
  render();
  try {
    if (!(await confirmSpend(api, "items", body))) return;
    const now = testRunBody(W.items, fromSelection ? testView.selected : ids);
    if (testRunSnapshot(W.items, now) !== snapshot) {
      toast("The saved tests or selection changed during the spend preview. Run again to preview the current selection.", "error");
      return;
    }
    const batch = await api("/api/workbench/items/run", body);
    W.runResults = mergeTestResults(W.runResults, batch, W.items, requestedItems);
  } catch (e) { handleError(e); }
  finally { testView.busy = false; render(); }
}

async function deleteTest(id) {
  if (testView.busy || !confirm(`Delete test “${id}”?`)) return;
  testView.busy = true;
  render();
  try {
    await api("/api/workbench/items/delete", { id });
    // Clean up immediately even if the subsequent list refresh fails.
    W.items = W.items.filter((item) => item.id !== id);
    reconcileTests();
    W.items = (await api("/api/workbench/items")).items;
    reconcileTests();
  } catch (e) { handleError(e); }
  finally { testView.busy = false; render(); }
}
