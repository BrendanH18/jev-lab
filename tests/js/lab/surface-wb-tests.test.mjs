// The Workbench Tests tab's Lab surface: the builder (static/js/lab/surfaces/workbench-tests.js), the Lab option of
// test-selection.js visibleTests, and the hook in static/js/workbench-tests.js, rebuilt from its source the way the
// page's own tests do (tests/js/test-triage.test.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as tools from "../../../static/js/test-selection.js";
import { createLab } from "../../../static/js/lab/host.js";
import { testsItemsCtx } from "../../../static/js/lab/surfaces/workbench-tests.js";
import pack from "../../../static/js/lab/packs/workbench/tests-triage.js";
import { fakeEnv } from "./harness.mjs";
import { TESTS_SURFACE as ID, TESTS_NOW, sampleTestsItemsCtx, sampleTestsRaw, sampleTestsResults } from "./fixtures/workbench-tests.mjs";

const ids = (list) => list.map((item) => item.id);
const byId = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.id, item]));
const ALL = ["refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry", "latte-art-feedback", "unnamed-draft"];

// ---------- the builder ----------

test("items are frozen copies of every saved test in saved order, joined with the latest session result", () => {
  const raw = sampleTestsRaw();
  const before = JSON.stringify(raw);
  const ctx = sampleTestsItemsCtx({ items: raw });
  assert.deepEqual(ids(ctx.items()), ALL);
  const T = byId(ctx);
  assert.deepEqual(T["bean-quality"], {
    id: "bean-quality", name: "Bean quality review", position: 2, notes: "", saved_at: "2026-10-15T14:00:00Z", saved_ms: Date.UTC(2026, 9, 15, 14),
    state: { review: "Dark roast tasted burnt, but shipping was fast.", stars: 2 }, state_kind: "object",
    questions: [{ id: "quality", type: "score", instructions: "How happy is the reviewer with the beans?",
      criteria: [{ key: "0", text: "Unhappy" }, { key: "1", text: "Mixed" }, { key: "2", text: "Happy" }], expect: { min: 1, max: 2 } }],
    expect: { quality: { min: 1, max: 2 } }, orphan_expectations: [], images: [], status: "fail",
    result: { ok: false, error: null, elapsed_ms: 660.4, has_trace: true,
      meta: { model: "jev-1.2", latency_ms: 655, question_count: 1, input_tokens: 140, output_tokens: 9, cost_usd: 0.00015, backend: "sdk" },
      checks: [{ id: "quality", question: true, ok: false, checks: ["0.40 < 1.00", "0.40 ≤ 2.00"], type: "score", value: 0.4, confidence: 0.55,
        answer: { type: "score", score: 0.4, legend: { 0: "Unhappy", 1: "Mixed", 2: "Happy" }, probabilities: { 0: 0.62, 1: 0.36, 2: 0.02 }, confidence: 0.55 } }] },
  });
  // A call error: status error, its text, no meta and no trace.
  assert.deepEqual(T["damaged-bag-photo"].result, { ok: false, error: "Budget reached for this session", meta: null, elapsed_ms: 3.2, has_trace: false, checks: [] });
  assert.deepEqual(T["damaged-bag-photo"].images, [{ ref: "photo", sample: "torn-bag", file: null }]);
  assert.deepEqual(T["damaged-bag-photo"].questions[0].criteria, []);
  // Not run: no result; an empty {} expectation stays {}; an array state.
  assert.equal(T["wholesale-inquiry"].result, null);
  assert.equal(T["wholesale-inquiry"].status, "not-run");
  assert.deepEqual(T["wholesale-inquiry"].questions.map((question) => question.expect), [{ choice: "wholesale" }, {}]);
  assert.equal(T["wholesale-inquiry"].state_kind, "array");
  assert.equal(T["wholesale-inquiry"].saved_at, null);
  // Structured instructions become JSON text; Noul criteria; an orphan expectation and its verdict.
  const latte = T["latte-art-feedback"];
  assert.equal(latte.questions[0].instructions, '{"text":"Rate the tone","scale":"0-3"}');
  assert.deepEqual(latte.questions[1].criteria, [{ key: "true", text: "Milk is mentioned" }, { key: "false", text: "No milk" }]);
  assert.deepEqual(latte.orphan_expectations, ["old_question"]);
  assert.deepEqual(latte.result.checks.map((check) => [check.id, check.question, check.ok, check.value, check.confidence]),
    [["tone", true, null, 2.3, 0.71], ["mentions_milk", true, true, 0.97, null], ["old_question", false, false, null, null]]);
  // A malformed file: no name, no notes, questions null.
  assert.deepEqual(T["unnamed-draft"], { id: "unnamed-draft", name: "unnamed-draft", position: 6, notes: "", saved_at: null, saved_ms: null, state: "Draft",
    state_kind: "text", questions: [], expect: {}, orphan_expectations: [], images: [], status: "not-run", result: null });
  // Frozen, stable and never the page's own objects.
  for (const item of ctx.items()) assert.ok(Object.isFrozen(item) && Object.isFrozen(item.questions) && (item.result === null || Object.isFrozen(item.result.checks)));
  assert.equal(ctx.items()[1], T["bean-quality"]);
  assert.equal(ctx.shown()[1], T["bean-quality"]);
  assert.notEqual(T["bean-quality"].state, raw[1].state);
  assert.throws(() => { T["bean-quality"].state.stars = 5; }, TypeError);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(ctx.itemName(T["bean-quality"], 1), "bean-quality");
});

test("an item changes only when its test, its position or its latest run changes", () => {
  const ctx = sampleTestsItemsCtx();
  const first = byId(ctx);
  ctx.state.results = { ...ctx.state.results };  // a new session object (the page prunes on every render), same runs
  assert.equal(byId(ctx)["refund-routing"], first["refund-routing"]);
  const rerun = { ...ctx.state.results.runs[1], ok: true, results: {} };
  ctx.state.results = { ...ctx.state.results, runs: ctx.state.results.runs.map((run) => (run.id === "bean-quality" ? rerun : run)) };
  const next = byId(ctx);
  assert.notEqual(next["bean-quality"], first["bean-quality"]);
  assert.equal(next["bean-quality"].status, "pass");
  assert.equal(next["refund-routing"], first["refund-routing"]);
  ctx.state.items = ctx.state.items.slice(1);
  assert.equal(byId(ctx)["bean-quality"].position, 1);
  ctx.state.results = null;
  assert.ok(ctx.items().every((item) => item.result === null && item.status === "not-run"));
});

test("shown() honors the page's own filters, search and sort", () => {
  assert.deepEqual(ids(sampleTestsItemsCtx().shown()), ["refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry", "unnamed-draft"]);
  assert.deepEqual(ids(sampleTestsItemsCtx({ filters: {} }).shown()), ALL);
  assert.deepEqual(ids(sampleTestsItemsCtx({ filters: { status: "fail" } }).shown()), ["bean-quality", "latte-art-feedback"]);
  assert.deepEqual(ids(sampleTestsItemsCtx({ filters: { selection: "selected" } }).shown()), ["bean-quality", "latte-art-feedback"]);
  assert.deepEqual(ids(sampleTestsItemsCtx({ filters: { selection: "selected", exclude: "archived" } }).shown()), ["bean-quality"]);
  assert.deepEqual(ids(sampleTestsItemsCtx({ filters: { sort: "slowest" }, query: "e" }).shown()), ["latte-art-feedback", "bean-quality", "refund-routing", "damaged-bag-photo", "wholesale-inquiry", "unnamed-draft"]);
  assert.deepEqual(sampleTestsItemsCtx({ items: [] }).shown(), []);
});

test("shown() applies Lab filters like any other filter and Lab's sort after the page's", () => {
  const lab = createLab([pack]);
  const ctx = sampleTestsItemsCtx({ lab, filters: {} });
  assert.deepEqual(ids(ctx.shown()), ALL, "no Lab setting: nothing changes");
  lab.view(ID).filters = [{ key: "tests-triage/failed_checks", op: "min", value: "1" }];
  assert.deepEqual(ids(ctx.shown()), ["bean-quality", "latte-art-feedback"]);
  const paged = sampleTestsItemsCtx({ lab, filters: { status: "fail", exclude: "archived" } });
  assert.deepEqual(ids(paged.shown()), ["bean-quality"], "page and Lab filters combine");
  lab.view(ID).filters = [];
  lab.view(ID).sort = { key: "tests-triage/input_tokens", dir: "desc" };
  assert.deepEqual(ids(ctx.shown()), ["latte-art-feedback", "refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry", "unnamed-draft"]);
  // Lab's sort applies last: ties (one yes/no question each) keep the page's ID order, in either page direction.
  lab.view(ID).sort = { key: "tests-triage/noul_questions", dir: "asc" };
  const ordered = (sort) => ids(sampleTestsItemsCtx({ lab, filters: { sort, exclude: "draft" } }).shown());
  assert.deepEqual(ordered("id"), ["bean-quality", "damaged-bag-photo", "latte-art-feedback", "refund-routing", "wholesale-inquiry"]);
  assert.deepEqual(ordered("id-desc"), ["bean-quality", "wholesale-inquiry", "refund-routing", "latte-art-feedback", "damaged-bag-photo"]);
});

test("visibleTests' Lab option: null changes nothing, matches hides, arrange runs after every page sort", () => {
  const raw = sampleTestsRaw().slice(0, 5);
  const results = sampleTestsResults(raw);
  for (const sort of ["saved", "name", "problems", "most-criteria"]) {
    assert.deepEqual(ids(tools.visibleTests(raw, results, { sort, lab: null })), ids(tools.visibleTests(raw, results, { sort })));
    assert.deepEqual(ids(tools.visibleTests(raw, results, { sort, lab: { matches: () => true, arrange: (list) => list } })), ids(tools.visibleTests(raw, results, { sort })));
  }
  assert.deepEqual(ids(tools.visibleTests(raw, results, { lab: { matches: (item) => item.id !== "bean-quality" } })), ["refund-routing", "damaged-bag-photo", "wholesale-inquiry", "latte-art-feedback"]);
  const seen = [];
  const reversed = tools.visibleTests(raw, results, { sort: "name", status: "fail", lab: { arrange: (list) => { seen.push(ids(list)); return [...list].reverse(); } } });
  assert.deepEqual(seen, [["bean-quality", "latte-art-feedback"]], "arrange receives the filtered list in the page's order");
  assert.deepEqual(ids(reversed), ["latte-art-feedback", "bean-quality"]);
  assert.deepEqual(ids(raw), ["refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry", "latte-art-feedback"]);
});

test("the page hook keeps the raw list when Lab hands back something else", () => {
  const raw = sampleTestsRaw();
  const ctx = testsItemsCtx({ items: () => raw, results: () => null, arrange: (list) => list.slice(1), matches: () => false });
  assert.equal(ctx.page.arrange(raw), raw);
  assert.equal(ctx.page.matches(null), true);
  assert.equal(ctx.page.matches(raw[0]), false);
  const plain = testsItemsCtx({ items: () => raw });
  assert.equal(plain.page.arrange(raw), raw);
  assert.equal(plain.page.matches(raw[0]), true);
  assert.deepEqual(ids(plain.shown()), ALL, "without a page shown() the list is every test");
});

test("data: session totals, selection, filters, budget and clock; null and empty before anything happened", () => {
  const data = sampleTestsItemsCtx({ selected: ["latte-art-feedback", "gone", "refund-routing"], query: " beans ", filters: { exclude: "archived", sort: "name" } }).data;
  assert.ok(Object.isFrozen(data) && Object.isFrozen(data.filters));
  assert.deepEqual(data.results, { batches: 1, last_count: 4, cost_usd: 0.00066, wall_ms: 2100, passed: 1, failed: 2, errors: 1, unrun: 2 });
  assert.deepEqual(data.selected, ["refund-routing", "latte-art-feedback"]);
  assert.equal(data.filters_active, 3, "exclude, sort and the search box");
  assert.equal(data.filters.exclude, "archived");
  assert.equal(data.filters.query, " beans ");
  assert.equal(data.sort, "name");
  assert.deepEqual(data.budget, { budget_usd: 1, spent_usd: 0.25, reserved_usd: 0.05, remaining_usd: 0.7 });
  assert.equal(data.model, "jev-latest");
  assert.equal(data.now, TESTS_NOW);
  assert.equal(data.limits.max_questions, 100);
  assert.equal(data.busy, false);
  assert.equal(data.tab, "tests");
  assert.equal(data.editing_id, null);
  const blank = sampleTestsItemsCtx({ results: null, status: null, selected: [], filters: {} }).data;
  assert.equal(blank.results, null);
  assert.equal(blank.budget, null);
  assert.equal(blank.model, null);
  assert.deepEqual(blank.selected, []);
  assert.equal(blank.filters_active, 0);
  const none = testsItemsCtx({}).data;
  assert.equal(none.results, null);
  assert.deepEqual(none.selected, []);
  assert.equal(typeof none.now, "number");
});

test("select changes the selection only, records Undo, and refuses while busy or with nothing known", () => {
  const ctx = sampleTestsItemsCtx();
  assert.deepEqual(ctx.actions.select(["refund-routing", "gone"]), ["refund-routing", "bean-quality", "latte-art-feedback"]);
  assert.deepEqual(ctx.log, [["setSelection", ["refund-routing", "bean-quality", "latte-art-feedback"]]]);
  assert.equal(ctx.data.can_undo_selection, true);
  assert.deepEqual(ctx.actions.select(["latte-art-feedback"], "remove"), ["refund-routing", "bean-quality"]);
  assert.deepEqual(ctx.actions.select(["wholesale-inquiry", "refund-routing"], "replace"), ["refund-routing", "wholesale-inquiry"]);
  assert.deepEqual(ctx.actions.select([], "replace"), []);
  assert.throws(() => ctx.actions.select(["gone"]), /None of those IDs/);
  assert.throws(() => ctx.actions.select([], "remove"), /None of those IDs/);
  assert.throws(() => ctx.actions.select("refund-routing"), /list of saved test IDs/);
  assert.throws(() => ctx.actions.select(["refund-routing"], "toggle"), /Unknown selection change/);
  ctx.actions.undoSelection();
  assert.deepEqual(ctx.data.selected, ["refund-routing", "wholesale-inquiry"]);
  assert.throws(() => ctx.actions.undoSelection(), /nothing|no selection change/i);
  const busy = sampleTestsItemsCtx({ busy: true, canUndoSelection: true });
  assert.throws(() => busy.actions.select(["refund-routing"]), /Wait for the current/);
  assert.throws(() => busy.actions.undoSelection(), /Wait for the current/);
  assert.deepEqual(busy.log, []);
});

test("no action runs saved tests: a paid batch stays the page's own Run buttons", () => {
  const ctx = sampleTestsItemsCtx();
  assert.equal("run" in ctx.actions, false);
  assert.deepEqual(ctx.log, []);
});

test("open, inspect and resetFilters wrap the page's own handlers with their guards", () => {
  const ctx = sampleTestsItemsCtx();
  ctx.actions.open("wholesale-inquiry");
  assert.throws(() => ctx.actions.open("gone"), /no saved test/);
  assert.equal(ctx.actions.inspect("refund-routing").meta.model, "jev-1.2");
  assert.throws(() => ctx.actions.inspect("damaged-bag-photo"), /no call to inspect/);
  assert.throws(() => ctx.actions.inspect("wholesale-inquiry"), /no call to inspect/);
  ctx.actions.resetFilters();
  assert.deepEqual(ctx.log, [["open", "wholesale-inquiry"], ["inspect", "Test · Refund routing"], ["resetFilters"]]);
  assert.deepEqual(ids(ctx.shown()), ALL);
  ctx.refresh();
  assert.deepEqual(ctx.log.at(-1), ["refresh"]);
  assert.equal(ctx.actions.replaceItems, undefined, "read-only: no edits");
  assert.equal(ctx.actions.importItems, undefined, "read-only: no imports");
  const bare = testsItemsCtx({ items: () => sampleTestsRaw(), selected: () => [] });
  assert.throws(() => bare.actions.open("refund-routing"), /cannot do that here/);
  assert.throws(() => bare.actions.select(["refund-routing"]), /cannot do that here/);
  assert.throws(() => bare.actions.resetFilters(), /cannot do that here/);
  bare.refresh();
});

// ---------- the hook in static/js/workbench-tests.js ----------

const source = readFileSync(new URL("../../../static/js/workbench-tests.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`))[0].replace(/^export /, "");
const pageNodes = (node) => (node && typeof node === "object" ? [node, ...(node.children || []).flatMap(pageNodes)] : []);
const button = (tree, label) => pageNodes(tree).find((node) => node.tag === "button" && node.children.includes(label));
const labSection = (tree) => pageNodes(tree).find((node) => node.attrs?.["data-lab-surface"] === ID) || null;
const rows = (tree) => pageNodes(tree).filter((node) => node.props?.class === "item saved-test-item");

function page({ withLab = true } = {}) {
  const items = sampleTestsRaw().slice(0, 5);  // the page itself cannot render a file whose questions are null
  const W = { items, runResults: sampleTestsResults(items), testSearch: "", tab: "tests", editingId: null };
  if (withLab) { W.lab = createLab([pack], { testsItemsCtx }); W.labEnv = fakeEnv(); }
  const calls = [];
  const elements = new Map();
  const h = (tag, props, ...children) => ({ tag, props, children: children.flat(Infinity).filter((value) => value !== null && value !== undefined && value !== false) });
  const helpers = { ...tools, W, h, render: () => calls.push(["render"]), estimateLine: () => null, api: () => { throw new Error("no API calls"); }, icon: () => null,
    $: (selector) => elements.get(selector), statusBadge: () => null, callStats: () => null, ms: String, usd: String, copyText: (value) => calls.push(["copy", value]),
    inspect: (trace, title) => calls.push(["inspect", title]), currentStatus: () => ({ model: "jev-latest", spend: { budget_usd: 1, spent_usd: 0, reserved_usd: 0 } }),
    openItem: (item) => calls.push(["open", item.id]), runTests: (ids) => calls.push(["run", ids]), downloadTestMetadata: () => {} };
  return { ...new Function(...Object.keys(helpers), `
    ${source.match(/const testFilterDefaults[^\n]*/)[0]}
    ${source.match(/const testView[^\n]*/)[0]}
    ${body("reconcileTests")}
    ${body("shownTests")}
    ${body("unsuccessfulTestIds")}
    ${body("testCountText")}
    ${body("refreshTestVisibility")}
    ${body("savedTestsLab")}
    ${body("renderTests")}
    return { renderTests, refreshTestVisibility, shownTests, testCountText, testView };
  `)(...Object.values(helpers)), W, calls, elements };
}

test("hook: with no Lab setting the page shows, counts and orders exactly as before", () => {
  const plain = page({ withLab: false }), lab = page();
  assert.deepEqual(ids(lab.shownTests()), ids(plain.shownTests()));
  assert.equal(lab.testCountText(), plain.testCountText());
  assert.equal(lab.testCountText(), "5 of 5 tests shown · 0 selected. Run all runs every saved test.");
  assert.deepEqual(rows(lab.renderTests()).map((row) => row.props["data-test-id"]), rows(plain.renderTests()).map((row) => row.props["data-test-id"]));
  assert.equal(labSection(plain.renderTests()), null);
  assert.ok(labSection(lab.renderTests()), "the Lab section renders beside the controls");
});

test("hook: Lab filters hide rows, count as active, scope the visible selection tools, and Reset clears them", () => {
  const ui = page();
  ui.renderTests();
  ui.W.lab.view(ID).filters = [{ key: "tests-triage/failed_checks", op: "min", value: "1" }];
  assert.deepEqual(ids(ui.shownTests()), ["bean-quality", "latte-art-feedback"]);
  assert.equal(ui.testCountText(), "2 of 5 tests shown · 0 selected · 1 Lab setting active. Run all runs every saved test.");
  const tree = ui.renderTests();
  assert.deepEqual(rows(tree).filter((row) => row.props.style.display === "").map((row) => row.props["data-test-id"]), ["bean-quality", "latte-art-feedback"]);
  button(tree, "Select visible").props.onclick();
  assert.deepEqual(ui.testView.selected, ["bean-quality", "latte-art-feedback"]);
  button(ui.renderTests(), "Copy visible test IDs").props.onclick();
  assert.deepEqual(ui.calls.find((call) => call[0] === "copy"), ["copy", "bean-quality\nlatte-art-feedback"]);
  button(ui.renderTests(), "Reset test filters").props.onclick();
  assert.equal(ui.W.lab.active(ID), 0);
  assert.equal(ui.shownTests().length, 5);
  assert.deepEqual(ui.testView.selected, ["bean-quality", "latte-art-feedback"], "Reset keeps the selection");
});

test("hook: Lab's sort reorders the rendered rows after the page's sort, hidden rows included", () => {
  const ui = page();
  ui.W.lab.view(ID).sort = { key: "tests-triage/input_tokens", dir: "desc" };
  const order = ["latte-art-feedback", "refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry"];
  assert.deepEqual(ids(ui.shownTests()), order);
  assert.deepEqual(rows(ui.renderTests()).map((row) => row.props["data-test-id"]), order);
  ui.W.testSearch = "bean";  // the bean review's id and the refund test's notes ("a bag of beans")
  assert.deepEqual(rows(ui.renderTests()).map((row) => [row.props["data-test-id"], row.props.style.display]),
    order.map((id) => [id, ["refund-routing", "bean-quality"].includes(id) ? "" : "none"]));
  assert.equal(ui.testCountText(), "2 of 5 tests shown · 0 selected · 1 Lab setting active. Run all runs every saved test.");
});

test("hook: the ctx acts through the page's selection and inspect paths, never runTests, and live search refreshes the section", () => {
  const ui = page();
  ui.renderTests();
  const ctx = ui.W.testsLab;
  assert.ok(ctx && ctx.env, "the section gave the ctx its env");
  ctx.actions.select(["wholesale-inquiry"]);
  assert.deepEqual(ui.testView.selected, ["wholesale-inquiry"]);
  assert.deepEqual(ui.testView.previousSelection, []);
  ctx.actions.undoSelection();
  assert.deepEqual(ui.testView.selected, []);
  assert.equal("run" in ctx.actions, false);
  ctx.actions.inspect("refund-routing");
  ctx.actions.open("bean-quality");
  assert.deepEqual(ui.calls.filter((call) => call[0] !== "render"), [["inspect", "Test · Refund routing"], ["open", "bean-quality"]]);
  ui.testView.busy = true;
  assert.throws(() => ctx.actions.select(["bean-quality"]), /Wait for the current/);
  ui.testView.busy = false;
  assert.equal(ctx.data.model, "jev-latest");
  assert.equal(ctx.data.filters.exclude, "");
  const replaced = [];
  ui.elements.set(`[data-lab-surface="${ID}"]`, { replaceWith: (node) => replaced.push(node) });
  ui.W.testSearch = "refund";
  ui.refreshTestVisibility();
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].attrs["data-lab-surface"], ID);
  ctx.actions.resetFilters();
  assert.equal(ui.W.testSearch, "");
});
