import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as tools from "../../static/js/test-selection.js";

const items = [
  { id: "alpha", name: "Alpha", questions: { a: { type: "choice" }, b: { type: "noul" } }, expect: { a: {}, b: {} }, images: { photo: "parcel" } },
  { id: "beta", name: "Beta", questions: { a: { type: "score" } }, expect: { a: {} } },
  { id: "gamma", name: "Gamma", questions: { a: { type: "box" } }, expect: {}, images: {} },
  { id: "delta", name: "Delta", questions: {} },
];
const results = { runs: [{ id: "alpha", ok: true }, { id: "beta", ok: false }, { id: "gamma", error: "Offline" }] };
const ids = (rows) => rows.map((row) => row.id);

test("expectation, picture and selection filters compose without touching selections or requests", () => {
  const before = JSON.stringify(items), selected = ["alpha", "gamma"];
  const filter = (options) => ids(tools.visibleTests(items, results, options));
  assert.deepEqual(filter({ expectations: "with" }), ["alpha", "beta"]);
  assert.deepEqual(filter({ expectations: "without" }), ["gamma", "delta"]);
  assert.deepEqual(filter({ images: "with" }), ["alpha"]);
  assert.deepEqual(filter({ images: "without" }), ["beta", "gamma", "delta"]);
  assert.deepEqual(filter({ selection: "selected", selected }), selected);
  assert.deepEqual(filter({ selection: "unselected", selected }), ["beta", "delta"]);
  assert.deepEqual(filter({ expectations: "without", selection: "selected", selected, type: "box" }), ["gamma"]);
  assert.deepEqual(filter({ images: "with", query: "beta" }), []);
  assert.deepEqual(selected, ["alpha", "gamma"]);
  assert.equal(JSON.stringify(items), before);
});

test("additional sorts prioritize names, request size, expectations and actionable outcomes", () => {
  const order = (sort) => ids(tools.visibleTests(items, results, { sort }));
  assert.deepEqual(order("name-desc"), ["gamma", "delta", "beta", "alpha"]);
  assert.deepEqual(order("fewest-questions"), ["delta", "beta", "gamma", "alpha"]);
  assert.deepEqual(order("expectations"), ["alpha", "beta", "gamma", "delta"]);
  assert.deepEqual(order("problems"), ["gamma", "beta", "delta", "alpha"]);
  assert.deepEqual(ids(items), ["alpha", "beta", "gamma", "delta"]);
});

test("deselect and invert visible preserve hidden selections and ignore duplicate/stale IDs", () => {
  const selected = ["alpha", "beta", "deleted"];
  assert.deepEqual(tools.deselectVisibleTests(items, selected, [items[1], items[2]]), ["alpha"]);
  assert.deepEqual(tools.invertVisibleTests(items, selected, [items[1], items[2], items[2], { id: "gone" }]), ["alpha", "gamma"]);
  assert.deepEqual(tools.invertVisibleTests(items, selected, []), ["alpha", "beta"]);
  assert.deepEqual(selected, ["alpha", "beta", "deleted"]);
});

const source = readFileSync(new URL("../../static/js/workbench-tests.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`))[0].replace(/^export /, "");
function harness() {
  const W = { items, runResults: null, testSearch: "alpha" };
  const h = (tag, props, ...children) => ({ tag, props, children: children.flat(Infinity).filter(Boolean) });
  const helpers = { ...tools, W, h, render: () => {}, ms: String, usd: String, estimateLine: () => null, api: () => {}, icon: () => null };
  return new Function(...Object.keys(helpers), `
    ${source.match(/const testFilterDefaults[^\n]*/)[0]}
    ${source.match(/const testView[^\n]*/)[0]}
    ${body("reconcileTests")}
    ${body("shownTests")}
    ${body("unsuccessfulTestIds")}
    ${body("testCountText")}
    ${body("renderTests")}
    return { renderTests, testView, W };
  `)(...Object.values(helpers));
}
function nodes(node) { return typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : []; }
function button(tree, label) { return nodes(tree).find((node) => node.tag === "button" && node.children.includes(label)); }

test("saved test controls wire selection actions and reset presentation while retaining human choices", () => {
  const ui = harness();
  ui.testView.selected = ["alpha", "beta"];
  button(ui.renderTests(), "Deselect visible").props.onclick();
  assert.deepEqual(ui.testView.selected, ["beta"]);
  button(ui.renderTests(), "Invert visible selection").props.onclick();
  assert.deepEqual(ui.testView.selected, ["alpha", "beta"]);
  ui.testView.status = "fail"; ui.testView.images = "with"; ui.testView.expectations = "with";
  ui.testView.selection = "selected"; ui.testView.sort = "problems";
  button(ui.renderTests(), "Reset test filters").props.onclick();
  assert.equal(ui.W.testSearch, "");
  assert.equal(ui.testView.status, "all"); assert.equal(ui.testView.images, "all");
  assert.equal(ui.testView.expectations, "all"); assert.equal(ui.testView.selection, "all");
  assert.equal(ui.testView.sort, "saved");
  assert.deepEqual(ui.testView.selected, ["alpha", "beta"]);
  const controls = nodes(ui.renderTests()).filter((node) => node.tag === "select");
  for (const label of ["Test expectations", "Test pictures", "Test selection"]) {
    assert.ok(controls.some((node) => node.props["aria-label"] === label));
  }
});
