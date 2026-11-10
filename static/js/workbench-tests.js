// Tests tab (saved items, run again live) and the Examples gallery, both of which load a request into Build.
import { $, api, callStats, h, handleError, icon, inspect, ms, statusBadge, toast, usd } from "./common.js";
import { confirmSpend, estimateLine } from "./estimate.js";
import { testResultStatus, visibleTests, selectedTestIds, selectVisibleTests, deselectVisibleTests, invertVisibleTests, testRunBody,
  testRunSnapshot, pruneTestResults, mergeTestResults, selectedTestSummary } from "./test-selection.js";
import { W } from "./workbench-state.js";
import { loadInto } from "./workbench-build.js";
import { render } from "./workbench.js";

// Filters only change presentation. Selections and session answers survive filters and partial runs.
const testFilterDefaults = () => ({ status: "all", type: "all", expectations: "all", images: "all", selection: "all", sort: "saved", minQuestions: "", maxQuestions: "", stateType: "all", notes: "all" });
const testView = { ...testFilterDefaults(), selected: [], busy: false, details: true };

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

function testCountText() {
  return `${shownTests().length} of ${W.items.length} tests shown · ${testView.selected.length} selected. Run all runs every saved test.`;
}

// Typing into search keeps focus and the cursor, and never changes selection.
function refreshTestVisibility() {
  const visible = new Set(shownTests().map((item) => item.id));
  $("#saved-test-results")?.querySelectorAll(".saved-test-item").forEach((row) => {
    row.style.display = visible.has(row.dataset.testId) ? "" : "none";
  });
  const count = $("#saved-test-count");
  if (count) count.textContent = testCountText();
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
  const search = h("input", { class: "input", type: "search", value: query, placeholder: "Search tests by name or notes",
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
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
          filter("Test status", "status", [["all", "All statuses"], ["pass", "Passed"], ["fail", "Failed expectations"], ["error", "Errors"], ["not-run", "Not run"]]),
          filter("Test question type", "type", [["all", "All types"], ["noul", "Yes / no"], ["choice", "Choice"], ["score", "Score"], ["box", "Box"]]),
          filter("Sort tests", "sort", [["saved", "Saved order"], ["name", "Name A–Z"], ["name-desc", "Name Z–A"], ["questions", "Most questions"], ["fewest-questions", "Fewest questions"], ["expectations", "Most expectations"], ["problems", "Problems first"], ["slowest", "Slowest observed call"], ["costliest", "Costliest observed call"]]),
          filter("Test expectations", "expectations", [["all", "Any expectations"], ["with", "With expectations"], ["without", "Without expectations"]]),
          filter("Test pictures", "images", [["all", "Any pictures"], ["with", "With pictures"], ["without", "Without pictures"]]),
          filter("Test input shape", "stateType", [["all", "Any input shape"], ["text", "Plain text"], ["object", "JSON object"], ["array", "JSON array"]]),
          filter("Test notes", "notes", [["all", "Any notes"], ["with", "With notes"], ["without", "Without notes"]]),
          [ ["Minimum test questions", "minQuestions"], ["Maximum test questions", "maxQuestions"] ].map(([label, field]) =>
            h("label", { class: "faint" }, label, " ", h("input", { class: "input sm", type: "number", min: 0, step: 1,
              value: testView[field], "aria-label": label, style: { width: "90px" }, oninput: (event) => {
                testView[field] = event.target.value; refreshTestVisibility();
              } }))),
          filter("Test selection", "selection", [["all", "All tests"], ["selected", "Selected tests"], ["unselected", "Unselected tests"]]),
          h("button", { class: "btn sm ghost", onclick: () => {
            Object.assign(testView, testFilterDefaults()); W.testSearch = ""; render();
          } }, "Reset test filters")),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
          h("button", { class: "btn sm", id: "saved-test-select-visible", disabled: busy || !shown.size,
            onclick: () => { testView.selected = selectVisibleTests(W.items, testView.selected, shownTests()); render(); } }, "Select visible"),
          h("button", { class: "btn sm", id: "saved-test-deselect-visible", disabled: busy || !shown.size,
            onclick: () => { testView.selected = deselectVisibleTests(W.items, testView.selected, shownTests()); render(); } }, "Deselect visible"),
          h("button", { class: "btn sm", id: "saved-test-invert-visible", disabled: busy || !shown.size,
            onclick: () => { testView.selected = invertVisibleTests(W.items, testView.selected, shownTests()); render(); } }, "Invert visible selection"),
          h("button", { class: "btn sm", disabled: busy || !failed.length,
            onclick: () => { testView.selected = selectedTestIds(W.items, [...testView.selected, ...unsuccessfulTestIds()]); render(); } }, "Select failed / errors"),
          h("button", { class: "btn sm ghost", disabled: busy || !selected.size,
            onclick: () => { testView.selected = []; render(); } }, "Clear selection"),
          h("button", { class: "btn sm primary", disabled: busy || !selected.size,
            onclick: () => runTests(testView.selected, true) }, `Run selected (${selected.size})`),
          estimateLine(h, api, "items", () => testRunBody(W.items, testView.selected))),
        h("p", { class: "faint", style: { margin: 0 } },
          `Selected requests: ${summary.tests} tests · ${summary.questions} questions · ${summary.expectations} expectations · ${summary.images} pictures. Counts describe saved inputs, not spend.`),
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

// ---------- Examples ----------
export function renderExamples() {
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("p", { class: "muted", style: { maxWidth: "760px" } }, `${W.examples.length} starting points, one per pattern. Open any of them in Build to see the exact state and questions, run it, then change the wording and watch the probabilities move.`),
    h("div", { class: "gallery" }, W.examples.map((ex) => h("div", { class: "panel ex" },
      h("div", { class: "pat" }, ex.pattern), h("h3", {}, ex.title), h("p", {}, ex.blurb),
      h("div", { class: "codenote" }, h("b", { style: { color: "var(--muted)" } }, "In code: "), ex.code),
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" } },
        h("button", { class: "btn sm primary", onclick: () => loadInto(ex.state, ex.questions, { expect: ex.expect, example: ex.id, images: ex.images }) }, "Open in Build"),
        h("span", { class: "faint", style: { fontSize: "12px" } }, `${ex.question_count} questions${ex.images ? " · 1 image" : ""}`))))));
}
