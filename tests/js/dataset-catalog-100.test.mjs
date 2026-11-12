import assert from "node:assert/strict";
import { test } from "node:test";
import * as catalog from "../../static/js/dataset-catalog.js";
import { workbenchSource } from "./workbench-source.mjs";

const items = [
  { id: "harbor-support", name: "Harbor inbox", notes: "Customer tickets", rows: 10, labeled: 7, questions: 4, guidelines: 2,
    test: { rows: 4, labeled: 3, looks: 2 }, check: { answers: "private configuration" } },
  { id: "harbor-orders", name: "Orders", notes: "Harbor routing", rows: 8, labeled: 8, questions: 2, guidelines: 2 },
  { id: "reviews", name: "Reviews", rows: 6, labeled: 2, questions: 3, guidelines: 0,
    test: { rows: 2, labeled: 0, looks: 5 } },
  { id: "empty", name: "Empty", rows: 0, labeled: 0, questions: 0, guidelines: 0 },
];
const ids = (filters) => items.filter((item) => catalog.matchesCatalog(item, filters)).map((item) => item.id);

test("split and guideline metrics use counts only, including unlabeled held-out rows", () => {
  assert.deepEqual(catalog.catalogMetrics(items[0]), { tuning: 6, tuningLabeled: 4, heldOutLabeled: 3,
    heldOutShare: 40, guidelineShare: 50, unguided: 2 });
  assert.deepEqual(catalog.catalogMetrics(items[3]), { tuning: 0, tuningLabeled: 0, heldOutLabeled: 0,
    heldOutShare: null, guidelineShare: null, unguided: 0 });
});

test("held-out and guideline share bounds are inclusive, fractional and undefined for zero denominators", () => {
  assert.deepEqual(ids({ minHeldOutShare: "40", maxHeldOutShare: "40" }), ["harbor-support"]);
  assert.deepEqual(ids({ maxHeldOutShare: "0" }), ["harbor-orders"]);
  assert.deepEqual(ids({ minHeldOutShare: "33.3", maxHeldOutShare: "33.4" }), ["reviews"]);
  assert.deepEqual(ids({ minGuidelineShare: "50", maxGuidelineShare: "100" }), ["harbor-support", "harbor-orders"]);
  assert.deepEqual(ids({ maxGuidelineShare: "0" }), ["reviews"]);
  assert.deepEqual(ids({ minGuidelineShare: "50", maxHeldOutShare: "0" }), ["harbor-orders"]);
  for (const key of ["minHeldOutShare", "maxHeldOutShare", "minGuidelineShare", "maxGuidelineShare"]) {
    for (const value of ["-1", "101", "NaN", "Infinity"]) assert.deepEqual(ids({ [key]: value }), []);
  }
});

test("split label count and uncovered-question bounds combine without reading label maps", () => {
  assert.deepEqual(ids({ minTuningLabeled: "4", maxTuningLabeled: "4" }), ["harbor-support"]);
  assert.deepEqual(ids({ minHeldOutLabeled: "3", maxHeldOutLabeled: "3" }), ["harbor-support"]);
  assert.deepEqual(ids({ maxHeldOutLabeled: "0", minTuningLabeled: "1" }), ["harbor-orders", "reviews"]);
  assert.deepEqual(ids({ minUnguided: "2", maxUnguided: "3" }), ["harbor-support", "reviews"]);
  assert.deepEqual(ids({ maxUnguided: "0", minQuestions: "1" }), ["harbor-orders"]);
  for (const key of ["minTuningLabeled", "maxTuningLabeled", "minHeldOutLabeled", "maxHeldOutLabeled", "minUnguided", "maxUnguided"]) {
    for (const value of ["-1", "0.5", "NaN", "Infinity"]) assert.deepEqual(ids({ [key]: value }), []);
  }
});

test("tuning and held-out label progress exclude nonexistent groups", () => {
  assert.deepEqual(ids({ tuningLabels: "none" }), []);
  assert.deepEqual(ids({ tuningLabels: "some" }), ["harbor-support", "reviews"]);
  assert.deepEqual(ids({ tuningLabels: "every" }), ["harbor-orders"]);
  assert.deepEqual(ids({ heldOutLabels: "none" }), ["reviews"]);
  assert.deepEqual(ids({ heldOutLabels: "some" }), ["harbor-support"]);
  assert.deepEqual(ids({ heldOutLabels: "every" }), []);
  assert.equal(catalog.matchesCatalog({ rows: 4, labeled: 4, test: { rows: 2, labeled: 2 } },
    { tuningLabels: "every", heldOutLabels: "every" }), true);
});

test("ID prefixes and word searches respect selected metadata fields and phrase exclusions", () => {
  assert.deepEqual(ids({ idPrefix: " HARBOR- " }), ["harbor-support", "harbor-orders"]);
  assert.deepEqual(ids({ query: "tickets inbox", searchMode: "all-words" }), ["harbor-support"]);
  assert.deepEqual(ids({ query: "tickets inbox", searchMode: "phrase" }), []);
  assert.deepEqual(ids({ query: "tickets reviews", searchMode: "any-word" }), ["harbor-support", "reviews"]);
  assert.deepEqual(ids({ query: "harbor orders", searchMode: "all-words", searchField: "notes" }), []);
  assert.deepEqual(ids({ query: "harbor orders", searchMode: "all-words", exclude: "routing" }), []);
  for (const searchMode of ["all-words", "any-word"]) assert.deepEqual(ids({ query: "  ", searchMode }), items.map((item) => item.id));
});

test("all eight added sorts keep stable ties, source order and unknown shares last", () => {
  const before = structuredClone(items);
  for (const [sort, expected] of [
    ["looks", ["reviews", "harbor-support", "harbor-orders", "empty"]],
    ["looks-asc", ["harbor-orders", "empty", "harbor-support", "reviews"]],
    ["tuning-labeled", ["harbor-orders", "harbor-support", "reviews", "empty"]],
    ["tuning-labeled-asc", ["empty", "reviews", "harbor-support", "harbor-orders"]],
    ["held-out-share", ["harbor-support", "reviews", "harbor-orders", "empty"]],
    ["held-out-share-asc", ["harbor-orders", "reviews", "harbor-support", "empty"]],
    ["guideline-share", ["harbor-orders", "harbor-support", "reviews", "empty"]],
    ["guideline-share-asc", ["reviews", "harbor-support", "harbor-orders", "empty"]],
  ]) assert.deepEqual(catalog.sortedCatalog(items, sort).map((item) => item.id), expected, sort);
  assert.deepEqual(items, before);
});

test("bulk pins preserve hidden pins, deduplicate and ignore unavailable IDs", () => {
  const pins = ["reviews"];
  const added = catalog.updateCatalogPins(items, pins, ["harbor-support", "harbor-orders", "unavailable"], true);
  assert.deepEqual(added, ["reviews", "harbor-support", "harbor-orders"]);
  assert.deepEqual(catalog.updateCatalogPins(items, added, ["harbor-support"], false), ["reviews", "harbor-orders"]);
  assert.deepEqual(catalog.updateCatalogPins(items, ["deleted", "reviews"], [], false), ["reviews"]);
  assert.deepEqual(pins, ["reviews"], "session arrays are replaced rather than mutated");
});

test("pinned handoffs include hidden pins with the existing metadata export boundary", () => {
  const source = items.map((item) => ({ ...item, state: "private input", labels: { q: "private label" }, answers: "private answer" }));
  const pinned = catalog.pinnedCatalog(source, "name", ["reviews", "harbor-support"]);
  assert.deepEqual(pinned.map((item) => item.id), ["harbor-support", "reviews"]);
  assert.equal(catalog.catalogIds(pinned), "harbor-support\nreviews");
  for (const output of [catalog.catalogJson(pinned), catalog.catalogCsv(pinned)]) {
    assert.doesNotMatch(output, /private input|private label|private answer|private configuration|Customer tickets/);
  }
  assert.deepEqual(catalog.pinnedCatalog(source, "saved", []), []);
});

test("expanded current-view summaries contain counts without inputs, label values or performance claims", () => {
  assert.equal(catalog.catalogDetailsSummary(items), "18 tuning rows (14 with labels) · 3 held-out rows with labels · 9 questions (4 with guidelines, 5 without) · 7 recorded test evaluations");
  assert.equal(catalog.catalogDetailsSummary([]), "0 tuning rows (0 with labels) · 0 held-out rows with labels · 0 questions (0 with guidelines, 0 without) · 0 recorded test evaluations");
  assert.doesNotMatch(catalog.catalogDetailsSummary(items), /accuracy|coverage|pass|Harbor|tickets/);
});

test("new controls update mounted dataset cards and preserve hidden human queue edits", () => {
  const W = { bulk: { datasets: items } };
  const rows = items.map((item) => {
    const pin = { setAttribute(key, value) { this[key] = value; } };
    return { dataset: { datasetId: item.id }, style: {}, draft: "human edit", pin, querySelector: () => pin };
  });
  const list = { querySelectorAll: () => rows, append: (row) => { rows.splice(rows.indexOf(row), 1); rows.push(row); } };
  const dom = Object.fromEntries(["dataset-search-count", "dataset-search-summary", "dataset-search-details-summary", "dataset-catalog-pinned-count",
    "dataset-catalog-copy-pinned", "dataset-catalog-pinned-csv", "dataset-catalog-pinned-json", "dataset-catalog-pin-shown", "dataset-catalog-unpin-shown", "dataset-catalog-copy-summary"]
    .map((id) => [`#${id}`, {}]));
  dom["#dataset-search-results"] = list;
  const h = (tag, attrs, ...children) => ({ tag, attrs, value: attrs.value, children: children.flat(Infinity).filter(Boolean), focus() {} });
  const nodes = (node) => typeof node !== "object" ? [] : [node, ...node.children.flatMap(nodes)];
  const source = workbenchSource.match(/function datasetSearchControls\([^\n]*\) \{[\s\S]*?\n\}/)[0];
  const copied = [], dependencies = { ...catalog, W, $: (id) => dom[id], h, copyText: (text) => copied.push(text) };
  const make = new Function(...Object.keys(dependencies), `${source}; return datasetSearchControls;`)(...Object.values(dependencies));
  const filters = { ...catalog.catalogDefaults(), pinnedIds: ["reviews"] };
  const tree = make(filters), all = nodes(tree);
  const control = (label) => all.find((node) => node.attrs["aria-label"] === label);
  const action = (id) => all.find((node) => node.attrs.id === id).attrs.onclick();
  const shown = () => rows.filter((row) => row.style.display !== "none").map((row) => row.dataset.datasetId);
  for (const [label, value, expected] of [
    ["Minimum labeled tuning rows", "5", ["harbor-orders"]],
    ["Maximum labeled tuning rows", "0", ["empty"]],
    ["Minimum labeled held-out rows", "1", ["harbor-support"]],
    ["Maximum labeled held-out rows", "0", ["harbor-orders", "reviews", "empty"]],
    ["Minimum questions without guidelines", "3", ["reviews"]],
    ["Maximum questions without guidelines", "0", ["harbor-orders", "empty"]],
    ["Minimum held-out row share (%)", "35", ["harbor-support"]],
    ["Maximum held-out row share (%)", "0", ["harbor-orders"]],
    ["Minimum guideline share (%)", "100", ["harbor-orders"]],
    ["Maximum guideline share (%)", "0", ["reviews"]],
  ]) {
    control(label).attrs.oninput({ target: { value } });
    assert.deepEqual(shown(), expected, label);
    all.find((node) => node.tag === "button" && node.children[0] === "Clear dataset filters").attrs.onclick();
    assert.equal(control(label).value, "");
  }
  control("Dataset ID prefix").attrs.oninput({ target: { value: "harbor-" } });
  action("dataset-catalog-pin-shown");
  assert.deepEqual(filters.pinnedIds, ["reviews", "harbor-support", "harbor-orders"]);
  assert.equal(rows.find((row) => row.dataset.datasetId === "harbor-orders").pin["aria-pressed"], "true");
  action("dataset-catalog-copy-pinned");
  assert.deepEqual(copied, ["harbor-support\nharbor-orders\nreviews"]);
  action("dataset-catalog-copy-summary");
  assert.match(copied[1], /18 rows/);
  assert.match(copied[1], /14 tuning rows/);
  action("dataset-catalog-unpin-shown");
  assert.deepEqual(filters.pinnedIds, ["reviews"], "hidden pin remains");
  assert.equal(rows[0].pin["aria-pressed"], "false");
  assert.equal(dom["#dataset-catalog-pinned-count"].textContent, "1 datasets pinned in this page session");
  assert.ok(rows.every((row) => row.draft === "human edit"));
  assert.equal(rows.find((row) => row.dataset.datasetId === "reviews").style.display, "none");
  control("Dataset ID prefix").attrs.oninput({ target: { value: "missing" } });
  assert.equal(dom["#dataset-catalog-pin-shown"].disabled, true);
  assert.equal(dom["#dataset-catalog-copy-summary"].disabled, true);
  assert.equal(dom["#dataset-catalog-copy-pinned"].disabled, false);
});
