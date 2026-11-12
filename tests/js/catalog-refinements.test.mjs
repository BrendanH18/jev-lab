import assert from "node:assert/strict";
import { test } from "node:test";
import * as catalog from "../../static/js/dataset-catalog.js";
import { workbenchSource } from "./workbench-source.mjs";

const items = [
  { id: "harbor-inbox", name: "Harbor support", rows: 10, labeled: 7, questions: 2, notes: "Customer tickets",
    test: { rows: 4, labeled: 3 }, check: { private: "gate configuration" } },
  { id: "harbor-orders", name: "Harbor orders", rows: 8, labeled: 8, questions: 2 },
  { id: "coffee-inbox", name: "Coffee support", rows: 6, labeled: 2, questions: 1,
    test: { rows: 2, labeled: 0 } },
  { id: "empty", name: "Empty", rows: 0, labeled: 0 },
];
const ids = (filters) => items.filter((item) => catalog.matchesCatalog(item, filters)).map((item) => item.id);

test("missing-label bounds describe each split independently and retain inclusive zero bounds", () => {
  assert.deepEqual(catalog.catalogSplitProgress(items[0]), { tuningUnlabeled: 2, heldOutUnlabeled: 1,
    tuningLabelShare: 100 * 4 / 6, heldOutLabelShare: 75 });
  assert.deepEqual(ids({ minTuningUnlabeled: "2", maxTuningUnlabeled: "2" }), ["harbor-inbox", "coffee-inbox"]);
  assert.deepEqual(ids({ minHeldOutUnlabeled: "2", maxHeldOutUnlabeled: "2" }), ["coffee-inbox"]);
  assert.deepEqual(ids({ maxTuningUnlabeled: "0", maxHeldOutUnlabeled: "0" }), ["harbor-orders", "empty"]);
  assert.deepEqual(ids({ minTuningUnlabeled: "1", maxHeldOutUnlabeled: "1", check: "with" }), ["harbor-inbox"]);
  for (const key of ["minTuningUnlabeled", "maxTuningUnlabeled", "minHeldOutUnlabeled", "maxHeldOutUnlabeled"]) {
    for (const value of ["-1", "0.5", "NaN", "Infinity"]) assert.deepEqual(ids({ [key]: value }), [], `${key}: ${value}`);
  }
});

test("split label share bounds accept fractions and omit absent splits", () => {
  assert.deepEqual(catalog.catalogSplitProgress(items[3]), { tuningUnlabeled: 0, heldOutUnlabeled: 0,
    tuningLabelShare: null, heldOutLabelShare: null });
  assert.deepEqual(ids({ minTuningLabelShare: "66.6", maxTuningLabelShare: "66.7" }), ["harbor-inbox"]);
  assert.deepEqual(ids({ minHeldOutLabelShare: "75", maxHeldOutLabelShare: "75" }), ["harbor-inbox"]);
  assert.deepEqual(ids({ minHeldOutLabelShare: "0", maxHeldOutLabelShare: "0" }), ["coffee-inbox"]);
  assert.deepEqual(ids({ minTuningLabelShare: "100" }), ["harbor-orders"]);
  assert.deepEqual(ids({ maxTuningLabelShare: "50", minHeldOutLabelShare: "0" }), ["coffee-inbox"]);
  for (const key of ["minTuningLabelShare", "maxTuningLabelShare", "minHeldOutLabelShare", "maxHeldOutLabelShare"]) {
    for (const value of ["-1", "100.1", "NaN", "Infinity"]) assert.deepEqual(ids({ [key]: value }), [], `${key}: ${value}`);
  }
});

test("all eight progress sorts preserve stable ties and unknown shares last in both directions", () => {
  const before = structuredClone(items);
  for (const [sort, expected] of [
    ["tuning-unlabeled", ["harbor-inbox", "coffee-inbox", "harbor-orders", "empty"]],
    ["tuning-unlabeled-asc", ["harbor-orders", "empty", "harbor-inbox", "coffee-inbox"]],
    ["held-out-unlabeled", ["coffee-inbox", "harbor-inbox", "harbor-orders", "empty"]],
    ["held-out-unlabeled-asc", ["harbor-orders", "empty", "harbor-inbox", "coffee-inbox"]],
    ["tuning-label-share", ["harbor-orders", "harbor-inbox", "coffee-inbox", "empty"]],
    ["tuning-label-share-asc", ["coffee-inbox", "harbor-inbox", "harbor-orders", "empty"]],
    ["held-out-label-share", ["harbor-inbox", "coffee-inbox", "harbor-orders", "empty"]],
    ["held-out-label-share-asc", ["coffee-inbox", "harbor-inbox", "harbor-orders", "empty"]],
  ]) assert.deepEqual(catalog.sortedCatalog(items, sort).map((item) => item.id), expected, sort);
  assert.deepEqual(items, before);
});

test("name prefixes, suffixes and ID suffixes combine with scoped exact-field search", () => {
  assert.deepEqual(ids({ idSuffix: " INBOX " }), ["harbor-inbox", "coffee-inbox"]);
  assert.deepEqual(ids({ namePrefix: " HARBOR ", nameSuffix: "SUPPORT" }), ["harbor-inbox"]);
  assert.deepEqual(ids({ idPrefix: "coffee", idSuffix: "inbox", nameSuffix: "support" }), ["coffee-inbox"]);
  assert.deepEqual(ids({ query: " HARBOR SUPPORT ", searchMode: "exact-field" }), ["harbor-inbox"]);
  assert.deepEqual(ids({ query: "support", searchMode: "exact-field" }), []);
  assert.deepEqual(ids({ query: "Customer tickets", searchField: "notes", searchMode: "exact-field" }), ["harbor-inbox"]);
  assert.deepEqual(ids({ query: "Harbor support", searchField: "notes", searchMode: "exact-field" }), []);
  assert.deepEqual(ids({ query: "", searchMode: "exact-field", namePrefix: "Harbor" }), ["harbor-inbox", "harbor-orders"]);
  assert.equal(catalog.matchesCatalog({ id: "no-name" }, { namePrefix: "no-", nameSuffix: "name" }), true);
});

test("active settings expose filter keys without reading input or label data", () => {
  const filters = { ...catalog.catalogDefaults(), minTuningUnlabeled: "0", namePrefix: "Harbor", sort: "name", pinnedIds: ["hidden"] };
  assert.deepEqual(catalog.catalogActiveFilters(filters).map(({ key }) => key), ["minTuningUnlabeled", "namePrefix"]);
  assert.equal(catalog.catalogFilterSummary(catalog.catalogDefaults()), "No dataset filters active");
  assert.match(catalog.catalogFilterSummary(filters), /Minimum tuning rows without labels: 0/);
  assert.match(catalog.catalogFilterSummary(filters), /Name prefix: Harbor/);
  assert.doesNotMatch(catalog.catalogFilterSummary(filters), /hidden|sort|name: /);
});

test("invert shown pins retains hidden pins, removes deleted pins and never mutates callers", () => {
  const pins = ["coffee-inbox", "harbor-inbox", "deleted"];
  assert.deepEqual(catalog.invertCatalogPins(items, pins, ["harbor-inbox", "harbor-orders", "unavailable"]), ["coffee-inbox", "harbor-orders"]);
  assert.deepEqual(pins, ["coffee-inbox", "harbor-inbox", "deleted"]);
  assert.deepEqual(catalog.invertCatalogPins(items, [], []), []);
});

function controlsHarness(filters = catalog.catalogDefaults()) {
  const W = { bulk: { datasets: items } };
  const rows = items.map((item) => ({ dataset: { datasetId: item.id }, style: {}, humanEdits: { pending: "keep me" } }));
  const list = { querySelectorAll: () => rows, append(row) { rows.splice(rows.indexOf(row), 1); rows.push(row); } };
  const h = (tag, attrs, ...children) => ({ tag, attrs, value: attrs.value, disabled: attrs.disabled,
    children: children.flat(Infinity).filter((child) => child !== null && child !== undefined),
    replaceChildren(...next) { this.children = next; }, focus() {} });
  const nodes = (node) => typeof node !== "object" ? [] : [node, ...node.children.flatMap(nodes)];
  const dom = { "#dataset-search-results": list };
  const source = workbenchSource.match(/function datasetSearchControls\([^\n]*\) \{[\s\S]*?\n\}/)[0];
  const deps = { ...catalog, W, h, $: (selector) => dom[selector], copyText() {} };
  const make = new Function(...Object.keys(deps), `${source}; return datasetSearchControls;`)(...Object.values(deps));
  const root = make(filters);
  for (const node of nodes(root)) if (node.attrs.id) dom[`#${node.attrs.id}`] = node;
  const control = (label) => nodes(root).find((node) => node.attrs["aria-label"] === label);
  const action = (id) => dom[`#${id}`].attrs.onclick();
  const shown = () => rows.filter((row) => row.style.display !== "none").map((row) => row.dataset.datasetId);
  return { filters, rows, dom, root, control, action, shown, nodes };
}

test("all added filter controls compose and clear without unmounting human queues", () => {
  const x = controlsHarness();
  for (const [label, value, expected] of [
    ["Minimum tuning rows without labels", "1", ["harbor-inbox", "coffee-inbox"]],
    ["Maximum tuning rows without labels", "0", ["harbor-orders", "empty"]],
    ["Minimum held-out rows without labels", "2", ["coffee-inbox"]],
    ["Maximum held-out rows without labels", "0", ["harbor-orders", "empty"]],
    ["Minimum tuning labeled share (%)", "100", ["harbor-orders"]],
    ["Maximum tuning labeled share (%)", "50", ["coffee-inbox"]],
    ["Minimum held-out labeled share (%)", "75", ["harbor-inbox"]],
    ["Maximum held-out labeled share (%)", "0", ["coffee-inbox"]],
    ["Dataset ID suffix", "orders", ["harbor-orders"]],
    ["Dataset name prefix", "coffee", ["coffee-inbox"]],
    ["Dataset name suffix", "support", ["harbor-inbox", "coffee-inbox"]],
  ]) {
    x.control(label).attrs.oninput({ target: { value } });
    assert.deepEqual(x.shown(), expected, label);
    x.nodes(x.root).find((node) => node.children[0] === "Clear dataset filters").attrs.onclick();
    assert.equal(x.control(label).value, "");
  }
  assert.ok(x.rows.every((row) => row.humanEdits.pending === "keep me"));
});

test("filter chips remove just one filter and Undo restores it without reverting newer pins", () => {
  const x = controlsHarness();
  x.control("Dataset name prefix").attrs.oninput({ target: { value: "Harbor" } });
  x.control("Dataset ID suffix").attrs.oninput({ target: { value: "inbox" } });
  assert.deepEqual(x.shown(), ["harbor-inbox"]);
  assert.equal(x.dom["#dataset-catalog-active-count"].textContent, "2 active dataset filters");
  assert.match(x.dom["#dataset-catalog-filter-summary"].textContent, /ID suffix: inbox/);
  x.control("Remove dataset filter ID suffix").attrs.onclick();
  assert.deepEqual(x.shown(), ["harbor-inbox", "harbor-orders"]);
  assert.equal(x.control("Dataset ID suffix").value, "");
  x.filters.pinnedIds = ["coffee-inbox"];
  x.action("dataset-catalog-filter-undo");
  assert.equal(x.control("Dataset ID suffix").value, "inbox");
  assert.deepEqual(x.shown(), ["harbor-inbox"]);
  assert.deepEqual(x.filters.pinnedIds, ["coffee-inbox"]);
  assert.equal(x.dom["#dataset-catalog-filter-undo"].disabled, true);
  x.action("dataset-catalog-filter-undo");
  assert.deepEqual(x.shown(), ["harbor-inbox"], "consumed Undo is a no-op");
});

test("filter Undo restores presets and Clear while invert pins touches the shown set only", () => {
  const x = controlsHarness({ ...catalog.catalogDefaults(), pinnedIds: ["coffee-inbox", "harbor-inbox"] });
  x.control("Dataset name prefix").attrs.oninput({ target: { value: "Harbor" } });
  x.action("dataset-catalog-invert-shown");
  assert.deepEqual(x.filters.pinnedIds, ["coffee-inbox", "harbor-orders"]);
  x.nodes(x.root).find((node) => node.children[0] === "Clear dataset filters").attrs.onclick();
  x.action("dataset-catalog-filter-undo");
  assert.equal(x.control("Dataset name prefix").value, "Harbor");
  assert.deepEqual(x.filters.pinnedIds, ["coffee-inbox", "harbor-orders"]);
  x.control("Dataset workflow preset").attrs.onchange({ target: { value: "unlabeled" } });
  x.action("dataset-catalog-filter-undo");
  assert.equal(x.filters.namePrefix, "Harbor");
  assert.equal(x.filters.labels, "all");
  assert.ok(x.rows.every((row) => row.humanEdits.pending === "keep me"));
});

test("existing catalog downloads retain their privacy boundary with refined views", () => {
  const source = items.map((item) => ({ ...item, state: "private input", labels: { q: "private label" }, answers: "private answer" }));
  const shown = catalog.sortedCatalog(source.filter((item) => catalog.matchesCatalog(item, { nameSuffix: "support" })), "held-out-label-share");
  for (const text of [catalog.catalogJson(shown), catalog.catalogCsv(shown)]) {
    assert.doesNotMatch(text, /private input|private label|private answer|gate configuration|Customer tickets/);
  }
});
