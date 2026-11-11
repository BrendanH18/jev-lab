import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as tools from "../../static/js/test-selection.js";

const items = [
  { id: "mixed", name: "Mixed", state: "PRIVATE INPUT", notes: "PRIVATE NOTE", questions: { route: { type: "choice", instructions: "PRIVATE INSTRUCTION" }, urgent: { type: "noul" } }, expect: { route: {} }, images: { photo: "PRIVATE PICTURE" } },
  { id: "full", name: "Full", questions: { route: { type: "choice" } }, expect: { route: {} } },
  { id: "bare", name: "Bare", questions: { rating: { type: "score" } } },
  { id: "empty", name: "Empty", questions: {}, expect: { removed: {} } },
];
const results = { runs: [
  { id: "mixed", ok: false, meta: { latency_ms: 20, cost_usd: 0.01 }, results: { route: { checks: ["PRIVATE ANSWER"] } } },
  { id: "full", ok: true, results: {}, meta: { latency_ms: 3, cost_usd: 0 } },
  { id: "bare", error: "PRIVATE ERROR" },
] };
const ids = (rows) => rows.map((row) => row.id);

test("ID, expectation coverage and type-mix filters compose without changing saved requests", () => {
  const before = JSON.stringify(items);
  assert.deepEqual(items.map(tools.testExpectationCoverage), ["partial", "full", "none", "none"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { questionId: " ROUT ", coverage: "partial", typeMix: "mixed" })), ["mixed"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { coverage: "full", typeMix: "single" })), ["full"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { questionId: "rating", coverage: "none" })), ["bare"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { questionId: "missing" })), []);
  assert.deepEqual(ids(tools.visibleTests(items, results)), ids(items));
  assert.equal(JSON.stringify(items), before);
});

test("ascending observed sorts put measured zero first and missing calls last", () => {
  assert.deepEqual(ids(tools.visibleTests(items, results, { sort: "fastest" })), ["full", "mixed", "bare", "empty"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { sort: "cheapest" })), ["full", "mixed", "bare", "empty"]);
  assert.deepEqual(ids(tools.visibleTests(items, null, { sort: "cheapest" })), ids(items));
});

test("metadata JSON contains counts and current observed summaries only", () => {
  const exported = tools.testMetadataJson(items, results);
  assert.equal(exported.includes("PRIVATE"), false);
  const rows = JSON.parse(exported);
  assert.deepEqual(rows[0], { id: "mixed", name: "Mixed", questions: 2, expectations: 1, pictures: 1, status: "fail", latency_ms: 20, cost_usd: 0.01 });
  assert.equal(rows[1].cost_usd, 0);
  assert.equal(rows[2].status, "error");
  assert.equal(rows[2].latency_ms, null);
  assert.equal(rows[3].status, "not-run");
  assert.deepEqual(JSON.parse(tools.testMetadataJson([], results)), []);
});

const source = readFileSync(new URL("../../static/js/workbench-tests.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`))[0].replace(/^export /, "");
function harness() {
  const W = { items: structuredClone(items), runResults: structuredClone(results), testSearch: "Mixed" };
  const copies = [], downloads = [], payloads = [], revoked = [];
  const h = (tag, props, ...children) => ({ tag, props, children: children.flat(Infinity).filter(Boolean), click: () => downloads.push(props) });
  const helpers = { ...tools, W, h, render: () => {}, estimateLine: () => null, api: () => {}, icon: () => null,
    copyText: (value) => copies.push(value), statusBadge: () => null, callStats: () => null, ms: String, usd: String,
    Blob: class { constructor(parts) { payloads.push(parts.join("")); } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: (url) => revoked.push(url) } };
  return { ...new Function(...Object.keys(helpers), `
    ${source.match(/const testFilterDefaults[^\n]*/)[0]}
    ${source.match(/const testView[^\n]*/)[0]}
    ${body("reconcileTests")}
    ${body("shownTests")}
    ${body("unsuccessfulTestIds")}
    ${body("testCountText")}
    ${body("renderTests")}
    return { renderTests, testView, W };
  `)(...Object.values(helpers)), copies, downloads, payloads, revoked };
}
const nodes = (node) => typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const button = (tree, label) => nodes(tree).find((node) => node.tag === "button" && node.children.includes(label));

test("new selection shortcuts preserve hidden selections; reset clears new presentation fields", () => {
  const ui = harness();
  ui.testView.selected = ["mixed"];
  button(ui.renderTests(), "Select not run").props.onclick();
  assert.deepEqual(ui.testView.selected, ["mixed", "empty"]);
  button(ui.renderTests(), "Select passed").props.onclick();
  assert.deepEqual(ui.testView.selected, ["mixed", "full", "empty"]);
  ui.testView.questionId = "route"; ui.testView.coverage = "partial"; ui.testView.typeMix = "mixed";
  button(ui.renderTests(), "Reset test filters").props.onclick();
  assert.equal(ui.testView.questionId, ""); assert.equal(ui.testView.coverage, "all"); assert.equal(ui.testView.typeMix, "all");
  assert.deepEqual(ui.testView.selected, ["mixed", "full", "empty"]);
});

test("visible summaries, clipboard and metadata download use current filtered scope", () => {
  const ui = harness();
  const tree = ui.renderTests();
  assert.ok(JSON.stringify(tree).includes("Visible requests: 1 tests · 2 questions · 1 expectations · 1 pictures. Input counts only."));
  button(tree, "Copy visible test IDs").props.onclick();
  button(tree, "Download visible metadata JSON").props.onclick();
  assert.deepEqual(ui.copies, ["mixed"]);
  assert.deepEqual(JSON.parse(ui.payloads[0]).map((row) => row.id), ["mixed"]);
  assert.equal(ui.payloads[0].includes("PRIVATE"), false);
  assert.equal(ui.downloads[0].download, "jev-test-metadata.json");
  assert.deepEqual(ui.revoked, ["blob:test"]);
  ui.W.testSearch = "no match";
  assert.equal(button(ui.renderTests(), "Download visible metadata JSON").props.disabled, true);
});
