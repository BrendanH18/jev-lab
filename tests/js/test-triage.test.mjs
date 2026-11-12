import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as tools from "../../static/js/test-selection.js";

const items = [
  { id: "ticket-a", name: "Alpha request", state: "PRIVATE INPUT", notes: "PRIVATE NOTE", questions: {
    route: { type: "choice", instructions: "é☕", criteria: { one: "PRIVATE OPTION", two: "B" } },
    urgent: { type: "noul", instructions: "now" },
  }, expect: { route: "PRIVATE LABEL" }, images: { photo: "PRIVATE PICTURE" } },
  { id: "order-b", name: "Beta request", questions: { routeExtra: { type: "score", instructions: "x", criteria: ["bad", "good"] } }, expect: { removed: {} } },
  { id: "ticket-c", name: "Alpha followup", questions: { route: { type: "choice", instructions: "longer", criteria: { a: "A" } } }, expect: { route: {} } },
  { id: "empty-b", name: "Empty", questions: {} },
];
const results = { runs: [
  { id: "ticket-a", ok: true, results: {}, meta: { latency_ms: 10.5, cost_usd: 0 }, answers: "PRIVATE ANSWER" },
  { id: "order-b", ok: false, results: {}, meta: { latency_ms: 3, cost_usd: 0.002 }, trace: "PRIVATE TRACE" },
  { id: "ticket-c", error: "PRIVATE ERROR", meta: { latency_ms: NaN, cost_usd: -1 } },
] };
const ids = (rows) => rows.map((row) => row.id);

test("new authored-text filters compose and exact question matching avoids substring matches", () => {
  const before = JSON.stringify(items);
  assert.deepEqual(ids(tools.visibleTests(items, results, { namePrefix: " ALPHA ", idSuffix: "-A" })), ["ticket-a"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { questionId: "route" })), ["ticket-a", "order-b", "ticket-c"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { questionId: " ROUTE ", questionMatch: "exact" })), ["ticket-a", "ticket-c"]);
  assert.equal(JSON.stringify(items), before);
});

test("uncovered, Choice-option and Unicode instruction counts use authored request schema", () => {
  assert.deepEqual(items.map(tools.testAuthoredCounts), [
    { uncovered: 1, options: 2, instructions: 5 }, { uncovered: 1, options: 0, instructions: 1 },
    { uncovered: 0, options: 1, instructions: 6 }, { uncovered: 0, options: 0, instructions: 0 },
  ]);
  for (const [min, max, count, expected] of [
    ["minUncovered", "maxUncovered", "1", ["ticket-a", "order-b"]],
    ["minOptions", "maxOptions", "2", ["ticket-a"]],
    ["minInstructions", "maxInstructions", "5", ["ticket-a"]],
  ]) {
    assert.deepEqual(ids(tools.visibleTests(items, results, { [min]: count, [max]: count })), expected);
    for (const field of [min, max]) for (const invalid of ["-1", "1.5", "NaN", "Infinity"]) {
      assert.deepEqual(tools.visibleTests(items, results, { [field]: invalid }), []);
    }
  }
  assert.deepEqual(ids(tools.visibleTests(items, results, { maxUncovered: "0", maxOptions: "0", maxInstructions: "0" })), ["empty-b"]);
});

test("measurement availability and decimal ranges distinguish measured zero from unknown", () => {
  for (const availability of ["latency", "cost"]) {
    assert.deepEqual(ids(tools.visibleTests(items, results, { [availability]: "with" })), ["ticket-a", "order-b"]);
    assert.deepEqual(ids(tools.visibleTests(items, results, { [availability]: "without" })), ["ticket-c", "empty-b"]);
  }
  assert.deepEqual(ids(tools.visibleTests(items, results, { minLatency: "3.1", maxLatency: "10.5" })), ["ticket-a"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { minCost: "0", maxCost: "0" })), ["ticket-a"]);
  assert.deepEqual(ids(tools.visibleTests(items, results, { minCost: "0.001", maxCost: "0.002" })), ["order-b"]);
  for (const field of ["minLatency", "maxLatency", "minCost", "maxCost"]) {
    for (const invalid of ["-1", "NaN", "Infinity", "abc"]) assert.deepEqual(tools.visibleTests(items, results, { [field]: invalid }), []);
    assert.equal(tools.visibleTests(items, results, { [field]: " " }).length, 4);
    assert.deepEqual(tools.visibleTests(items, null, { [field]: "0" }), []);
  }
});

test("eight authored sorts are stable and leave saved order untouched", () => {
  const expected = {
    "id-desc": ["ticket-c", "ticket-a", "order-b", "empty-b"],
    "fewest-images": ["order-b", "ticket-c", "empty-b", "ticket-a"],
    "most-uncovered": ["ticket-a", "order-b", "ticket-c", "empty-b"],
    "fewest-uncovered": ["ticket-c", "empty-b", "ticket-a", "order-b"],
    "most-options": ["ticket-a", "ticket-c", "order-b", "empty-b"],
    "fewest-options": ["order-b", "empty-b", "ticket-c", "ticket-a"],
    "longest-instructions": ["ticket-c", "ticket-a", "order-b", "empty-b"],
    "shortest-instructions": ["empty-b", "order-b", "ticket-a", "ticket-c"],
  };
  for (const [sort, order] of Object.entries(expected)) assert.deepEqual(ids(tools.visibleTests(items, results, { sort })), order);
  assert.deepEqual(ids(items), ["ticket-a", "order-b", "ticket-c", "empty-b"]);
});

test("selected observation summary counts unknowns and excludes unselected and previous-attempt totals", () => {
  const session = { ...results, cost_usd: 100, wall_ms: 20000 };
  assert.deepEqual(tools.testObservedSummary([items[0], items[2], items[3]], session), {
    tests: 3, latencyCount: 1, latencyTotal: 10.5, costCount: 1, costTotal: 0,
  });
  assert.deepEqual(tools.testObservedSummary([], session), { tests: 0, latencyCount: 0, latencyTotal: 0, costCount: 0, costTotal: 0 });
});

const source = readFileSync(new URL("../../static/js/workbench-tests.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`))[0].replace(/^export /, "");
function harness() {
  const W = { items: structuredClone(items), runResults: structuredClone(results), testSearch: "" };
  const copies = [];
  const elements = new Map();
  const h = (tag, props, ...children) => ({ tag, props, children: children.flat(Infinity).filter((value) => value !== null && value !== undefined && value !== false) });
  const helpers = { ...tools, W, h, render: () => {}, estimateLine: () => null, api: () => {}, icon: () => null,
    $: (id) => elements.get(id), statusBadge: () => null, callStats: () => null, ms: String, usd: String,
    copyText: (value) => copies.push(value) };
  return { ...new Function(...Object.keys(helpers), `
    ${source.match(/const testFilterDefaults[^\n]*/)[0]}
    ${source.match(/const testView[^\n]*/)[0]}
    ${body("reconcileTests")}
    ${body("shownTests")}
    ${body("unsuccessfulTestIds")}
    ${body("testCountText")}
    ${body("refreshTestVisibility")}
    ${body("renderTests")}
    return { renderTests, refreshTestVisibility, testView, W };
  `)(...Object.values(helpers)), copies, elements };
}
const nodes = (node) => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const button = (tree, label) => nodes(tree).find((node) => node.tag === "button" && node.children.includes(label));

test("visible status selections add to hidden selection and undo restores previous membership", () => {
  for (const [label, expected] of [["Select visible errors", "ticket-c"], ["Select visible failed expectations", "order-b"], ["Select visible not run", "empty-b"]]) {
    const ui = harness(); ui.testView.selected = ["ticket-a"];
    button(ui.renderTests(), label).props.onclick();
    assert.deepEqual(ui.testView.selected, ["ticket-a", expected]);
    button(ui.renderTests(), "Undo selection change").props.onclick();
    assert.deepEqual(ui.testView.selected, ["ticket-a"]);
    assert.equal(button(ui.renderTests(), "Undo selection change").props.disabled, true);
  }
});

test("explicit replacement drops hidden selection; undo ignores deleted tests; clipboard is metadata only", () => {
  const ui = harness(); ui.testView.selected = ["order-b", "empty-b"]; ui.W.testSearch = "Alpha";
  button(ui.renderTests(), "Replace selection with visible").props.onclick();
  assert.deepEqual(ui.testView.selected, ["ticket-a", "ticket-c"]);
  button(ui.renderTests(), "Copy selected metadata JSON").props.onclick();
  assert.deepEqual(JSON.parse(ui.copies[0]).map((row) => row.id), ["ticket-a", "ticket-c"]);
  assert.equal(ui.copies[0].includes("PRIVATE"), false);
  ui.W.items = ui.W.items.filter((item) => item.id !== "empty-b");
  button(ui.renderTests(), "Undo selection change").props.onclick();
  assert.deepEqual(ui.testView.selected, ["order-b"]);
});

test("advanced controls reset without changing selection and live search refreshes status action availability", () => {
  const ui = harness(); ui.testView.selected = ["ticket-a"];
  for (const id of ["saved-test-replace-visible", "saved-test-select-visible-error", "saved-test-select-visible-fail", "saved-test-select-visible-not-run"]) ui.elements.set(`#${id}`, {});
  ui.W.testSearch = "no matches"; ui.refreshTestVisibility();
  for (const element of ui.elements.values()) assert.equal(element.disabled, true);
  ui.W.testSearch = "Alpha"; ui.refreshTestVisibility();
  assert.equal(ui.elements.get("#saved-test-replace-visible").disabled, false);
  assert.equal(ui.elements.get("#saved-test-select-visible-error").disabled, false);
  assert.equal(ui.elements.get("#saved-test-select-visible-fail").disabled, true);
  ui.testView.minCost = "2"; ui.testView.questionMatch = "exact"; ui.testView.namePrefix = "Other";
  button(ui.renderTests(), "Reset test filters").props.onclick();
  assert.equal(ui.testView.minCost, ""); assert.equal(ui.testView.questionMatch, "contains"); assert.equal(ui.testView.namePrefix, "");
  assert.deepEqual(ui.testView.selected, ["ticket-a"]);
});

test("structured instruction length filters and sorts count serialized authored JSON", () => {
  const structured = { task: "é😀".repeat(40) };
  const rows = [
    { id: "structured", questions: { q: { type: "noul", instructions: structured } } },
    { id: "text", questions: { q: { type: "noul", instructions: "x".repeat(40) } } },
    { id: "array", questions: { q: { type: "noul", instructions: ["first", "second"] } } },
  ];
  const before = JSON.stringify(rows);
  const length = Array.from(JSON.stringify(structured)).length;
  assert.equal(tools.testAuthoredCounts(rows[0]).instructions, length);
  assert.equal(tools.testAuthoredCounts(rows[2]).instructions, Array.from(JSON.stringify(["first", "second"])).length);
  assert.deepEqual(ids(tools.visibleTests(rows, null, { minInstructions: length, maxInstructions: length })), ["structured"]);
  assert.deepEqual(ids(tools.visibleTests(rows, null, { sort: "longest-instructions" })), ["structured", "text", "array"]);
  assert.deepEqual(ids(tools.visibleTests(rows, null, { sort: "shortest-instructions" })), ["array", "text", "structured"]);
  assert.equal(JSON.stringify(rows), before);
});
