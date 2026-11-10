import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as tools from "../../static/js/test-selection.js";

const items = [
  { id: "text", name: "Text", state: "message", notes: "Needs checking", questions: { a: { type: "noul" }, b: { type: "choice" } }, expect: { a: {} } },
  { id: "object", name: "Object", state: { ticket: "support" }, notes: "  ", questions: { a: { type: "score" } }, images: { photo: "parcel" } },
  { id: "array", name: "Array", state: [{ message: "one" }], questions: {} },
  { id: "new", name: "New", state: "not run", questions: { a: { type: "choice" } } },
];
const results = { runs: [
  { id: "text", ok: true, results: {}, meta: { latency_ms: 12, cost_usd: 0 } },
  { id: "object", ok: false, results: {}, meta: { latency_ms: 9, cost_usd: 0.02 } },
  { id: "array", error: "Offline" },
], passed: 1, failed: 1, errors: 1, unrun: 1 };
const ids = (rows) => rows.map((row) => row.id);

test("request-size limits compose with input-shape and notes filters without modifying data", () => {
  const before = JSON.stringify(items);
  assert.deepEqual(ids(tools.visibleTests(items, results, { minQuestions: "1", maxQuestions: "1" })), ["object", "new"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { minQuestions: "2", maxQuestions: "1" })), []);
  for (const invalid of ["-1", "1.5", "no", "Infinity"]) {
    assert.deepEqual(tools.visibleTests(items, results, { minQuestions: invalid }), []);
    assert.deepEqual(tools.visibleTests(items, results, { maxQuestions: invalid }), []);
  }
  assert.deepEqual(ids(tools.visibleTests(items, results, { stateType: "text", notes: "with" })), ["text"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { stateType: "object", notes: "without" })), ["object"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { stateType: "array", maxQuestions: "0" })), ["array"]);
  assert.equal(JSON.stringify(items), before);
});

test("observed-call sorts include zero spend before missing results and retain stable ties", () => {
  assert.deepEqual(ids(tools.visibleTests(items, results, { sort: "slowest" })), ["text", "object", "array", "new"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { sort: "costliest" })), ["object", "text", "array", "new"]);
  assert.deepEqual(ids(tools.visibleTests(items, null, { sort: "slowest" })), ids(items));
});

test("selected request totals include hidden selections once and ignore deleted IDs", () => {
  assert.deepEqual(tools.selectedTestSummary(items, ["text", "object", "text", "gone"]), {
    tests: 2, questions: 3, expectations: 1, images: 1,
  });
  assert.deepEqual(tools.selectedTestSummary(items, []), { tests: 0, questions: 0, expectations: 0, images: 0 });
});

const source = readFileSync(new URL("../../static/js/workbench-tests.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`))[0].replace(/^export /, "");
function harness() {
  const W = { items: structuredClone(items), runResults: structuredClone(results), testSearch: "text" };
  const calls = [];
  const h = (tag, props, ...children) => ({ tag, props, children: children.flat(Infinity).filter(Boolean) });
  const helpers = { ...tools, W, h, render: () => {}, estimateLine: () => null, api: () => {}, icon: () => null,
    statusBadge: () => null, callStats: () => "call stats", ms: String, usd: String, runTests: (ids) => calls.push(ids) };
  return { ...new Function(...Object.keys(helpers), `
    ${source.match(/const testFilterDefaults[^\n]*/)[0]}
    ${source.match(/const testView[^\n]*/)[0]}
    ${body("reconcileTests")}
    ${body("shownTests")}
    ${body("unsuccessfulTestIds")}
    ${body("testCountText")}
    ${body("renderTests")}
    return { renderTests, testView, W };
  `)(...Object.values(helpers)), calls };
}
function nodes(node) { return typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : []; }
function button(tree, label) { return nodes(tree).find((node) => node.tag === "button" && node.children.includes(label)); }

test("unrun shortcut passes explicit IDs and selecting problems adds to hidden selections", () => {
  const ui = harness();
  ui.testView.selected = ["text"];
  button(ui.renderTests(), "Run 1 not run").props.onclick();
  assert.deepEqual(ui.calls, [["new"]]);
  button(ui.renderTests(), "Select failed / errors").props.onclick();
  assert.deepEqual(ui.testView.selected, ["text", "object", "array"]);
  ui.W.runResults = { runs: ui.W.items.map((item) => ({ id: item.id, ok: true, results: {} })) };
  assert.equal(button(ui.renderTests(), "Run 0 not run").props.disabled, true);
});

test("compact results hide details while retaining error text and session results", () => {
  const ui = harness();
  let tree = ui.renderTests();
  const detailToggle = nodes(tree).find((node) => node.tag === "label" && node.children.includes(" Show result checks and call details"));
  detailToggle.children[0].props.onchange({ target: { checked: false } });
  tree = ui.renderTests();
  assert.equal(JSON.stringify(tree).includes("call stats"), false);
  assert.equal(JSON.stringify(tree).includes("Offline"), true);
  assert.equal(ui.W.runResults.runs.length, 3);
  assert.equal(ui.testView.details, false);
});
