import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as tools from "../../static/js/test-selection.js";

const items = [
  { id: "a", name: "Alpha", state: "SECRET INPUT", notes: "SECRET NOTE", images: { photo: "SECRET PICTURE" }, questions: {
    route: { type: "choice", instructions: "SECRET INSTRUCTION", criteria: { a: "é😀", b: "B" } },
    quality: { type: "score", criteria: ["x", "yy", "zzz"] },
  }, expect: { route: "SECRET LABEL", removed: "SECRET ORPHAN" } },
  { id: "b", name: "Beta", questions: { route: { type: "noul", criteria: { true: "T", false: "F" } } }, expect: { route: {} } },
  { id: "c", name: "Gamma", questions: { box: { type: "box" } } },
  { id: "d", name: "Delta", questions: { route: { type: "noul", criteria: { true: "T", false: "F" } } } },
];
const ids = (rows) => rows.map((row) => row.id);

test("suite metrics count authored criteria, Unicode text, Score ordinals and orphan IDs only", () => {
  assert.deepEqual(tools.suiteAuthoredMetrics(items[0]), { criteria: 5, criteriaCharacters: 9, scoreLevels: 3, orphanExpectations: 1 });
  assert.deepEqual(tools.suiteAuthoredMetrics(items[2]), { criteria: 0, criteriaCharacters: 0, scoreLevels: 0, orphanExpectations: 0 });
  const structured = { questions: { q: { type: "choice", criteria: { a: { text: "😀" } } } } };
  assert.equal(tools.suiteAuthoredMetrics(structured).criteriaCharacters, Array.from(JSON.stringify({ text: "😀" })).length);
});

test("all nine suite filters compose with existing filters and leave authored data unchanged", () => {
  const before = JSON.stringify(items);
  for (const [min, max, value] of [["minCriteria", "maxCriteria", 5], ["minCriteriaCharacters", "maxCriteriaCharacters", 9],
    ["minScoreLevels", "maxScoreLevels", 3], ["minOrphanExpectations", "maxOrphanExpectations", 1]]) {
    assert.deepEqual(ids(tools.visibleTests(items, null, { [min]: String(value), [max]: String(value), query: "Alpha" })), ["a"]);
    for (const key of [min, max]) {
      for (const invalid of ["-1", "1.5", "NaN", "Infinity", "abc"]) assert.deepEqual(tools.visibleTests(items, null, { [key]: invalid }), []);
      assert.deepEqual(ids(tools.visibleTests(items, null, { [key]: " " })), ids(items));
    }
  }
  assert.deepEqual(ids(tools.visibleTests(items, null, { orphanExpectations: "with" })), ["a"]);
  assert.deepEqual(ids(tools.visibleTests(items, null, { orphanExpectations: "without", maxScoreLevels: "0", minCriteria: "2" })), ["b", "d"]);
  assert.deepEqual(ids(tools.visibleTests(items, null, { maxCriteria: "0" })), ["c"]);
  assert.equal(JSON.stringify(items), before);
});

test("eight suite sorts are stable with ties in saved order and no source mutation", () => {
  for (const sort of ["fewest-criteria", "shortest-criteria"]) assert.deepEqual(ids(tools.visibleTests(items, null, { sort })), ["c", "b", "d", "a"]);
  for (const sort of ["most-criteria", "longest-criteria"]) assert.deepEqual(ids(tools.visibleTests(items, null, { sort })), ["a", "b", "d", "c"]);
  for (const sort of ["fewest-score-levels", "fewest-orphans"]) assert.deepEqual(ids(tools.visibleTests(items, null, { sort })), ["b", "c", "d", "a"]);
  for (const sort of ["most-score-levels", "most-orphans"]) assert.deepEqual(ids(tools.visibleTests(items, null, { sort })), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(items), ["a", "b", "c", "d"]);
});

test("inventory groups question IDs, counts expectation presence and exposes no authored/private values", () => {
  const inventory = tools.suiteQuestionInventory(items);
  assert.deepEqual(inventory, [
    { id: "route", tests: 3, withExpectations: 2, types: ["choice", "noul"] },
    { id: "quality", tests: 1, withExpectations: 0, types: ["score"] },
    { id: "box", tests: 1, withExpectations: 0, types: ["box"] },
  ]);
  assert.equal(JSON.stringify(inventory).includes("SECRET"), false);
  assert.match(tools.suiteInventoryText(items), /3 distinct question IDs · 5 question occurrences · 2 with authored expectations · 1 IDs used with multiple types/);
  assert.equal(tools.suiteQuestionInventory([]).length, 0);
});

test("pasted IDs preview deduplicates, matches exact IDs and does not change selections", () => {
  const before = JSON.stringify(items);
  const preview = tools.previewSuiteIds(items, " a \r\nb\na\n\nB\nunknown ");
  assert.deepEqual(preview, { matched: ["a", "b"], unknown: ["B", "unknown"] });
  assert.deepEqual(tools.applySuiteIds(items, ["d", "deleted"], preview), ["a", "b", "d"]);
  assert.deepEqual(tools.applySuiteIds(items, ["a", "c", "d"], preview, "remove"), ["c", "d"]);
  assert.equal(JSON.stringify(items), before);
});

test("first-N selection respects visible ordering, retains hidden selection and rejects invalid limits", () => {
  const visible = tools.visibleTests(items, null, { sort: "name-desc", query: "a" });
  assert.deepEqual(tools.firstVisibleSuiteIds(items, ["a"], visible, "2"), ["a", "c", "d"]);
  for (const invalid of ["", " ", "0", "-1", "1.5", "NaN", "Infinity"]) assert.equal(tools.firstVisibleSuiteIds(items, ["a"], visible, invalid), null);
  assert.deepEqual(tools.firstVisibleSuiteIds(items, ["a"], [], "3"), ["a"]);
});

const source = readFileSync(new URL("../../static/js/workbench-tests.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`))[0].replace(/^export /, "");
function harness() {
  const W = { items: structuredClone(items), runResults: null, testSearch: "" };
  const elements = new Map(), payloads = [], downloads = [], revoked = [];
  const h = (tag, props, ...children) => ({ tag, props, children: children.flat(Infinity).filter((x) => x != null && x !== false), click: () => downloads.push(props) });
  const helpers = { ...tools, W, h, render: () => {}, api: () => { throw new Error("No API calls allowed"); }, estimateLine: () => null,
    icon: () => null, statusBadge: () => null, callStats: () => null, ms: String, usd: String, $: (id) => elements.get(id),
    Blob: class { constructor(parts) { payloads.push(parts.join("")); } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: (url) => revoked.push(url) } };
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
  `)(...Object.values(helpers)), elements, payloads, downloads, revoked };
}
const nodes = (node) => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
const button = (tree, label) => nodes(tree).find((node) => node.tag === "button" && node.children.includes(label));
const field = (tree, label) => nodes(tree).find((node) => node.props?.["aria-label"] === label);

test("rendered ID workflow previews, guards edited/stale IDs, retains hidden selections and supports Undo", () => {
  const ui = harness(); ui.testView.selected = ["d"]; ui.W.testSearch = "Alpha";
  field(ui.renderTests(), "Saved test IDs to select").props.oninput({ target: { value: "a\nb\nmissing" } });
  assert.equal(button(ui.renderTests(), "Add pasted IDs to selection").props.disabled, true);
  button(ui.renderTests(), "Preview pasted IDs").props.onclick();
  assert.deepEqual(ui.testView.selected, ["d"]);
  assert.match(JSON.stringify(ui.renderTests()), /2 saved IDs matched; 1 unknown IDs ignored/);
  button(ui.renderTests(), "Add pasted IDs to selection").props.onclick();
  assert.deepEqual(ui.testView.selected, ["a", "b", "d"]);
  button(ui.renderTests(), "Undo selection change").props.onclick();
  assert.deepEqual(ui.testView.selected, ["d"]);
  button(ui.renderTests(), "Remove pasted IDs from selection").props.onclick();
  assert.deepEqual(ui.testView.selected, ["d"]);
  ui.W.items = ui.W.items.filter((item) => item.id !== "b");
  button(ui.renderTests(), "Add pasted IDs to selection").props.onclick();
  assert.equal(ui.testView.pastedPreview, null);
  assert.deepEqual(ui.testView.selected, ["d"]);
  field(ui.renderTests(), "Saved test IDs to select").props.oninput({ target: { value: "a" } });
  assert.equal(ui.testView.pastedPreview, null);
});

test("inventory downloads distinguish visible and hidden-selected scope and remain schema metadata only", () => {
  const ui = harness(); ui.testView.selected = ["b", "d"]; ui.W.testSearch = "Alpha";
  button(ui.renderTests(), "Download visible question inventory").props.onclick();
  button(ui.renderTests(), "Download selected question inventory").props.onclick();
  assert.deepEqual(JSON.parse(ui.payloads[0]).map((row) => row.id), ["route", "quality"]);
  assert.deepEqual(JSON.parse(ui.payloads[1]), [{ id: "route", tests: 2, withExpectations: 1, types: ["noul"] }]);
  assert.equal(ui.payloads.join("").includes("SECRET"), false);
  assert.deepEqual(ui.revoked, ["blob:test", "blob:test"]);
  assert.equal(ui.downloads[0].download, "jev-visible-question-inventory.json");
  assert.equal(ui.downloads[1].download, "jev-selected-question-inventory.json");
});

test("live filters update inventory and first-N action without losing selection or request data", () => {
  const ui = harness(); ui.testView.selected = ["b"];
  ui.elements.set("#saved-test-visible-inventory", {});
  ui.elements.set("#saved-test-visible-inventory-download", {});
  ui.elements.set("#saved-test-first-visible", {});
  ui.W.testSearch = "Alpha"; ui.refreshTestVisibility();
  assert.match(ui.elements.get("#saved-test-visible-inventory").textContent, /2 distinct question IDs/);
  assert.equal(ui.elements.get("#saved-test-visible-inventory-download").disabled, false);
  button(ui.renderTests(), "Add first N visible to selection").props.onclick();
  assert.deepEqual(ui.testView.selected, ["a", "b"]);
  ui.W.testSearch = "none"; ui.refreshTestVisibility();
  assert.equal(ui.elements.get("#saved-test-first-visible").disabled, true);
  assert.equal(ui.elements.get("#saved-test-visible-inventory-download").disabled, true);
  ui.testView.minCriteria = "3"; ui.testView.orphanExpectations = "with";
  button(ui.renderTests(), "Reset test filters").props.onclick();
  assert.equal(ui.testView.minCriteria, ""); assert.equal(ui.testView.orphanExpectations, "all");
  assert.deepEqual(ui.testView.selected, ["a", "b"]);
});
