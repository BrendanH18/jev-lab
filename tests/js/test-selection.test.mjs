import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  testResultStatus, visibleTests, selectedTestIds, selectVisibleTests, testRunBody,
  testRunSnapshot, pruneTestResults, mergeTestResults, testStatusSummary, testObservedSummary,
} from "../../static/js/test-selection.js";

const items = [
  { id: "billing", name: "Billing", notes: "Vendor invoice", state: "bill", questions: { route: { type: "choice" }, urgent: { type: "noul" } } },
  { id: "quality", name: "Quality", state: "bag", questions: { quality: { type: "score" } } },
  { id: "damage", name: "Damage", state: "parcel", questions: { damage: { type: "box" }, urgent: { type: "noul" } } },
  { id: "unrun", name: "New ticket", state: "support", questions: { route: { type: "choice" } } },
];
const passed = { id: "billing", ok: true, results: {} };
const failed = { id: "quality", ok: false, results: {} };
const error = { id: "damage", ok: false, error: "Budget reached" };
const result = { runs: [passed, failed, error], wall_ms: 12, cost_usd: 0.02 };
const ids = (value) => value.map((item) => item.id);

test("status and question-type filters combine with search and do not mutate inputs", () => {
  const before = JSON.stringify(items);
  assert.deepEqual([passed, failed, error, undefined].map(testResultStatus), ["pass", "fail", "error", "not-run"]);
  assert.deepEqual(ids(visibleTests(items, result, { status: "fail" })), ["quality"]);
  assert.deepEqual(ids(visibleTests(items, result, { status: "error", type: "box" })), ["damage"]);
  assert.deepEqual(ids(visibleTests(items, result, { status: "not-run", type: "choice" })), ["unrun"]);
  assert.deepEqual(ids(visibleTests(items, result, { query: "INVOICE", type: "noul", status: "pass" })), ["billing"]);
  assert.deepEqual(visibleTests(items, result, { query: "invoice", type: "box" }), []);
  assert.equal(JSON.stringify(items), before);
});

test("test sorting has stable ties and leaves saved order untouched", () => {
  assert.deepEqual(ids(visibleTests(items, result, { sort: "name" })), ["billing", "damage", "unrun", "quality"]);
  assert.deepEqual(ids(visibleTests(items, result, { sort: "questions" })), ["billing", "damage", "quality", "unrun"]);
  assert.deepEqual(ids(visibleTests(items, result)), ids(items));
});

test("Select visible adds to hidden selection and empty selection can never produce a run body", () => {
  const selected = selectVisibleTests(items, ["billing", "gone"], [items[2], items[2]]);
  assert.deepEqual(selected, ["billing", "damage"]);
  assert.deepEqual(selectVisibleTests(items, selected, []), selected);
  assert.deepEqual(selectedTestIds(items, ["gone", "damage", "damage"]), ["damage"]);
  assert.deepEqual(testRunBody(items, selected), { ids: ["billing", "damage"] });
  assert.deepEqual(testRunBody(items), { ids: ids(items) });
  assert.equal(testRunBody(items, []), null);
  assert.equal(testRunBody(items, ["gone"]), null);
  assert.equal(testRunBody([]), null);
});

test("run snapshots notice changed selected requests and list changes for Run all", () => {
  const selected = testRunBody(items, ["billing"]);
  const initial = testRunSnapshot(items, selected);
  const changed = structuredClone(items);
  changed[0].questions.urgent.instructions = "Is action urgent?";
  assert.notEqual(testRunSnapshot(changed, selected), initial);
  assert.notEqual(testRunSnapshot(items, testRunBody(items, ["damage"])), initial);
  assert.equal(testRunSnapshot([...items, { id: "later" }], selected), initial);
  assert.notEqual(testRunSnapshot(items.slice(0, -1), testRunBody(items.slice(0, -1))), testRunSnapshot(items, testRunBody(items)));
});

test("partial runs retain other answers and aggregate observed spend across attempts", () => {
  const first = mergeTestResults(null, result, items);
  assert.equal(first.passed, 1);
  assert.equal(first.failed, 1);
  assert.equal(first.errors, 1);
  assert.equal(first.unrun, 1);
  const retry = { id: "quality", ok: true, results: { quality: { ok: true, checks: [] } } };
  const next = mergeTestResults(first, { runs: [retry], cost_usd: 0.01, wall_ms: 3 }, items);
  assert.equal(next.runs.find((run) => run.id === "billing"), passed);
  assert.equal(next.runs.find((run) => run.id === "quality"), retry);
  assert.equal(next.passed, 2);
  assert.equal(next.failed, 0);
  assert.equal(next.errors, 1);
  assert.equal(next.cost_usd, 0.03);
  assert.equal(next.wall_ms, 15);
  assert.equal(next.batches, 2);
  assert.equal(next.last_count, 1);
  assert.equal(first.runs.find((run) => run.id === "quality"), failed);
});

test("deleted or changed tests lose obsolete answers, but their actual spend remains counted", () => {
  const session = mergeTestResults(null, result, items);
  const changed = structuredClone(items);
  changed[0].state = "edited";
  const pruned = pruneTestResults(session, changed.slice(0, 2));
  assert.deepEqual(ids(pruned.runs), ["quality"]);
  assert.equal(pruned.unrun, 1);
  assert.equal(pruned.cost_usd, 0.02);
  const completedAfterEdit = mergeTestResults(null, result, changed, items);
  assert.deepEqual(ids(completedAfterEdit.runs), ["quality", "damage"]);
  assert.equal(completedAfterEdit.cost_usd, 0.02);
});

const source = readFileSync(new URL("../../static/js/workbench-tests.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];
function runHarness(overrides = {}) {
  const W = { items: structuredClone(items), runResults: null };
  const calls = [], messages = [], errors = [];
  let previewDone, runDone;
  const confirmSpend = async (api, kind, request) => {
    calls.push(["preview", kind, request]);
    return new Promise((resolve) => { previewDone = resolve; });
  };
  const api = async (path, request) => {
    calls.push([path, request]);
    return new Promise((resolve, reject) => { runDone = { resolve, reject }; });
  };
  const helpers = { W, testRunBody, testRunSnapshot, selectedTestIds, pruneTestResults, mergeTestResults,
    confirmSpend, api, toast: (...args) => messages.push(args), handleError: (e) => errors.push(e), render: () => {}, ...overrides };
  const harness = new Function(...Object.keys(helpers), `
    const testView = { selected: [], busy: false };
    ${body("reconcileTests")}
    ${body("runTests")}
    ${body("deleteTest")}
    return { runTests, deleteTest, testView };
  `)(...Object.values(helpers));
  return { ...harness, W, calls, messages, errors, approve: (value = true) => previewDone(value),
    finish: (value = result) => runDone.resolve(value), fail: (e) => runDone.reject(e) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("run busy state spans preview and paid request; the same explicit IDs reach both", async () => {
  const h = runHarness();
  h.testView.selected = ["billing", "damage"];
  const pending = h.runTests(h.testView.selected, true);
  assert.equal(h.testView.busy, true);
  await h.runTests();
  assert.equal(h.calls.length, 1);
  h.approve();
  await tick();
  assert.deepEqual(h.calls[0][2], { ids: ["billing", "damage"] });
  assert.deepEqual(h.calls[1], ["/api/workbench/items/run", h.calls[0][2]]);
  await h.runTests();
  assert.equal(h.calls.length, 2);
  h.finish({ runs: [passed, error], cost_usd: 0.02, wall_ms: 12 });
  await pending;
  assert.equal(h.testView.busy, false);
  assert.equal(h.W.runResults.runs.length, 2);
});

test("empty selections make neither estimates nor paid calls", async () => {
  const h = runHarness();
  await h.runTests([]);
  await h.runTests(["gone"]);
  assert.deepEqual(h.calls, []);
  assert.equal(h.testView.busy, false);
});

test("changed selection, changed saved request, or removed test during preview cancels the paid action", async () => {
  for (const change of [
    (h) => { h.testView.selected = ["quality"]; },
    (h) => { h.W.items[0].state = "changed"; },
    (h) => { h.W.items = h.W.items.slice(1); },
  ]) {
    const h = runHarness();
    h.testView.selected = ["billing"];
    const pending = h.runTests(h.testView.selected, true);
    change(h);
    h.approve();
    await pending;
    assert.equal(h.calls.length, 1);
    assert.equal(h.testView.busy, false);
    assert.match(h.messages[0][0], /changed during the spend preview/);
  }
});

test("preview cancellation and failed requests release busy state and preserve earlier results", async () => {
  const h = runHarness();
  h.W.runResults = mergeTestResults(null, result, items);
  const cancelled = h.runTests(["billing"]);
  h.approve(false);
  await cancelled;
  assert.equal(h.testView.busy, false);
  assert.equal(h.calls.length, 1);
  const failing = h.runTests(["quality"]);
  h.approve();
  await tick();
  h.fail(new Error("Offline"));
  await failing;
  assert.equal(h.testView.busy, false);
  assert.equal(h.W.runResults.cost_usd, 0.02);
  assert.equal(h.W.runResults.runs.length, 3);
  assert.match(h.errors[0].message, /Offline/);
});

test("delete cleans selection and answers even if refreshing the saved list fails", async () => {
  const h = runHarness({ api: async (path) => {
    if (path === "/api/workbench/items") throw new Error("List unavailable");
    return { deleted: "billing" };
  }, confirm: () => true });
  h.testView.selected = ["billing", "quality"];
  h.W.runResults = mergeTestResults(null, result, items);
  await h.deleteTest("billing");
  assert.deepEqual(h.testView.selected, ["quality"]);
  assert.deepEqual(ids(h.W.runResults.runs), ["quality", "damage"]);
  assert.equal(h.W.runResults.cost_usd, 0.02);
  assert.equal(h.testView.busy, false);
});

const managed = [
  { id: "zebra", name: "First", notes: "invoice", state: "private input", questions: { q: { type: "noul" } }, expect: { q: [0, 1] }, images: { photo: "private.png" } },
  { id: "alpha", name: "Invoice", notes: "sample", questions: { q: { type: "choice" } }, expect: {}, images: {} },
  { id: "middle", name: "Last", notes: "invoice followup", questions: {}, expect: { q: {}, r: {} }, images: { a: "a.png", b: "b.png" } },
];

test("scoped test search and exclusion combine without changing selection or inputs", () => {
  const before = JSON.stringify(managed);
  assert.deepEqual(ids(visibleTests(managed, null, { query: "invoice", searchField: "name" })), ["alpha"]);
  assert.deepEqual(ids(visibleTests(managed, null, { query: "invoice", searchField: "notes", exclude: "followup" })), ["zebra"]);
  assert.deepEqual(ids(visibleTests(managed, null, { query: "ALP", searchField: "id" })), ["alpha"]);
  assert.deepEqual(ids(visibleTests(managed, null, { exclude: "invoice", selected: ["zebra"], selection: "selected" })), []);
  assert.deepEqual(selectedTestIds(managed, ["zebra"]), ["zebra"]);
  assert.equal(JSON.stringify(managed), before);
});

test("expectation and picture bounds intersect and reject invalid numeric limits", () => {
  assert.deepEqual(ids(visibleTests(managed, null, { minExpectations: "1", maxExpectations: "1" })), ["zebra"]);
  assert.deepEqual(ids(visibleTests(managed, null, { minImages: "1", maxImages: "1" })), ["zebra"]);
  assert.deepEqual(ids(visibleTests(managed, null, { maxExpectations: "0", maxImages: "0" })), ["alpha"]);
  assert.deepEqual(ids(visibleTests(managed, null, { minExpectations: "2", minImages: "2" })), ["middle"]);
  for (const field of ["minExpectations", "maxExpectations", "minImages", "maxImages"]) {
    for (const value of ["-1", "1.5", "NaN"]) assert.deepEqual(visibleTests(managed, null, { [field]: value }), []);
    assert.equal(visibleTests(managed, null, { [field]: " " }).length, 3);
  }
});

test("ID, picture and expectation sorts leave requests and result state unchanged", () => {
  const before = JSON.stringify(managed);
  assert.deepEqual(ids(visibleTests(managed, result, { sort: "id" })), ["alpha", "middle", "zebra"]);
  assert.deepEqual(ids(visibleTests(managed, result, { sort: "images" })), ["middle", "zebra", "alpha"]);
  assert.deepEqual(ids(visibleTests(managed, result, { sort: "fewest-expectations" })), ["alpha", "zebra", "middle"]);
  assert.deepEqual(ids(visibleTests([managed[0], { ...managed[0], id: "copy" }], null, { sort: "images" })), ["zebra", "copy"]);
  assert.equal(JSON.stringify(managed), before);
});

test("selected ID copying retains hidden selected tests and drops deleted IDs", () => {
  const selection = ["middle", "zebra", "gone", "zebra"];
  assert.deepEqual(ids(visibleTests(managed, null, { query: "First" })), ["zebra"]);
  assert.equal(selectedTestIds(managed, selection).join("\n"), "zebra\nmiddle");
  assert.match(source, /copyText\(selectedTestIds\(W\.items, testView\.selected\)\.join\("\\n"\)\)/);
});

test("rendered test controls reset presentation filters and copy hidden selected IDs", async () => {
  const { selectedTestSummary } = await import("../../static/js/test-selection.js");
  const defaultsSource = source.match(/const testFilterDefaults = \(\) => \(\{[^]*?\}\);/)[0];
  const testFilterDefaults = new Function(`${defaultsSource}; return testFilterDefaults;`)();
  const testView = { ...testFilterDefaults(), selected: ["zebra", "middle"], details: false, busy: false,
    searchField: "name", exclude: "Last", minImages: "1", minExpectations: "1" };
  const W = { items: managed, runResults: null, testSearch: "First" };
  let copied;
  const downloads = [];
  const h = (tag, props, ...children) => ({ tag, props, children: children.flat(Infinity).filter(Boolean) });
  const helpers = { W, testView, testFilterDefaults, h, selectedTestSummary, testStatusSummary, testObservedSummary, selectedTestIds, visibleTests, testResultStatus,
    reconcileTests: () => {}, shownTests: () => visibleTests(W.items, null, { ...testView, query: W.testSearch }),
    unsuccessfulTestIds: () => [], render: () => {}, testCountText: () => "counts",
    ms: String, usd: String, estimateLine: () => null, api: () => {}, icon: () => null, downloadTestMetadata: (rows, format) => downloads.push([rows.map((row) => row.id), format]), copyText: (value) => { copied = value; } };
  const renderTests = new Function(...Object.keys(helpers), `${body("renderTests").replace("export ", "")}; return renderTests;`)(...Object.values(helpers));
  const tree = renderTests();
  const nodes = [];
  const walk = (node) => {
    if (typeof node !== "object" || !node) return;
    nodes.push(node); node.children?.forEach(walk);
  };
  walk(tree);
  for (const label of ["Search test field", "Exclude saved tests", "Minimum test expectations", "Maximum test expectations", "Minimum test pictures", "Maximum test pictures"]) {
    assert.ok(nodes.some((node) => node.props?.["aria-label"] === label), label);
  }
  const button = (label) => nodes.find((node) => node.tag === "button" && node.children.includes(label));
  button("Copy selected test IDs").props.onclick();
  assert.equal(copied, "zebra\nmiddle");
  button("Download visible metadata CSV").props.onclick();
  button("Download selected metadata JSON").props.onclick();
  button("Download selected metadata CSV").props.onclick();
  assert.deepEqual(downloads, [[["zebra"], "csv"], [["zebra", "middle"], "json"], [["zebra", "middle"], "csv"]]);
  for (const label of ["Test ID prefix", "Exclude question type", "Minimum state bytes", "Maximum state bytes"]) {
    assert.ok(nodes.some((node) => node.props?.["aria-label"] === label), label);
  }
  const excludedType = nodes.find((node) => node.props?.["aria-label"] === "Exclude question type");
  excludedType.props.onchange({ target: { value: "box" } });
  assert.equal(testView.excludeType, "box");
  button("Reset test filters").props.onclick();
  assert.equal(W.testSearch, "");
  for (const [key, value] of Object.entries(testFilterDefaults())) assert.deepEqual(testView[key], value);
  assert.deepEqual(testView.selected, ["zebra", "middle"]);
});
