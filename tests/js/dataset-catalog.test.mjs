import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogDefaults, matchesCatalog, sortedCatalog, catalogTotals, catalogSummary, catalogCsv, datasetCopyName,
  canCopyDataset, matchesDeletedDataset, catalogJson, catalogPreset } from "../../static/js/dataset-catalog.js";
import { workbenchSource } from "./workbench-source.mjs";

const items = [
  { id: "tickets", name: "Harbor support", notes: "Email traffic", rows: 5, labeled: 3, questions: 2, guidelines: 1,
    test: { rows: 2 }, check: { secret: "private configuration" } },
  { id: "orders", name: "Order routing", rows: 5, labeled: 0, questions: 0 },
  { id: "reviews", name: "Customer feedback", rows: 2, labeled: 2, questions: 1 },
];

test("catalog filters combine existing search with question, split and guideline presence", () => {
  const before = structuredClone(items);
  assert.deepEqual(items.filter((item) => matchesCatalog(item, { query: "email", check: "with", labels: "some",
    questions: "with", test: "with", guidelines: "with" })), [items[0]]);
  assert.deepEqual(items.filter((item) => matchesCatalog(item, { test: "without", guidelines: "without", questions: "with" })), [items[2]]);
  assert.deepEqual(items.filter((item) => matchesCatalog(item, { questions: "without" })), [items[1]]);
  assert.deepEqual(items, before);
});

test("catalog sorting preserves ties, original saved order and source arrays", () => {
  assert.deepEqual(sortedCatalog(items, "name").map((item) => item.id), ["reviews", "tickets", "orders"]);
  assert.deepEqual(sortedCatalog(items, "rows").map((item) => item.id), ["tickets", "orders", "reviews"]);
  assert.deepEqual(sortedCatalog(items, "labeled").map((item) => item.id), ["tickets", "reviews", "orders"]);
  assert.deepEqual(sortedCatalog(items, "saved"), items);
  assert.notEqual(sortedCatalog(items), items);
  assert.equal(items[0].id, "tickets");
});

test("catalog summaries aggregate shown counts without interpreting label quality", () => {
  assert.deepEqual(catalogTotals(items), { datasets: 3, rows: 12, labeled: 5, heldOut: 2, checks: 1 });
  assert.equal(catalogSummary(items.slice(1)), "7 rows · 2 with labels · 0 held out · 0 saved checks in the shown datasets");
  assert.deepEqual(catalogTotals([]), { datasets: 0, rows: 0, labeled: 0, heldOut: 0, checks: 0 });
});

test("CSV exports only allowlisted metadata, escapes cells and neutralizes formulas", () => {
  const csv = catalogCsv([{ ...items[0], name: ' =HYPERLINK("private")', notes: "do not export notes",
    state: "input data", answers: "model data", labels: { secret: "human label" } }, { ...items[1], name: "Coffee,\nHarbor" }]);
  assert.match(csv, /"' =HYPERLINK\(""private""\)"/);
  assert.match(csv, /"Coffee,\nHarbor"/);
  assert.match(csv, /"held_out_rows","saved_check"/);
  assert.doesNotMatch(csv, /do not export notes|private configuration|input data|model data|human label/);
  for (const name of ["+formula", "-formula", "@formula", "\tformula", "\rformula", "\nformula"]) {
    assert.ok(catalogCsv([{ id: "safe", name }]).includes(`"'${name}"`));
  }
});

test("copy names avoid saved slug collisions including long or non-ASCII source names", () => {
  assert.equal(datasetCopyName("Harbor", [{ id: "harbor-copy" }, { id: "harbor-copy-2" }]), "Harbor copy 3");
  assert.equal(datasetCopyName("☕", []), "Dataset copy");
  const name = "x".repeat(80);
  const first = datasetCopyName(name, []);
  const second = datasetCopyName(name, [{ id: first.replaceAll(" ", "-") }]);
  assert.notEqual(first, second);
  assert.ok(second.length < 60);
});

test("copy eligibility refuses held-out rows or test history instead of resetting looks", () => {
  assert.equal(canCopyDataset(items[1]), true);
  assert.equal(canCopyDataset(items[0]), false);
  assert.equal(canCopyDataset({ rows: [{ text: "hidden", _test: true }] }), false);
  assert.equal(canCopyDataset({ rows: ["text", { _test: false }], test: { looks: [] } }), false);
  assert.equal(canCopyDataset({ rows: ["text", { _image: "sample", _expect: { urgent: true } }] }), true);
});

test("deleted history search matches name or id without matching hidden revision contents", () => {
  assert.equal(matchesDeletedDataset({ id: "old-tickets", name: "Harbor" }, " HARBOR "), true);
  assert.equal(matchesDeletedDataset({ id: "old-tickets", name: "Harbor" }, "tickets"), true);
  assert.equal(matchesDeletedDataset({ id: "old", notes: "private" }, "private"), false);
});

const sourceFunction = (name) => workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const make = (name, deps) => new Function(...Object.keys(deps), `${sourceFunction(name)}; return ${name};`)(...Object.values(deps));

function copyHarness({ approve = true, read, heldOut = false, drafts = {}, discard = true } = {}) {
  const original = { id: "source", name: "Source", questions: { urgent: { type: "noul" } }, notes: "Saved notes",
    rows: [{ text: "Hello", _image: "photo", _expect: { urgent: true }, ...(heldOut ? { _test: true } : {}) }], rules: "urgent = true" };
  const W = { bulk: { dataset: { id: "before", name: "Before" }, rowsText: "before", savedText: "before",
    labelsDirty: false, prelabel: { drafts }, source: "current", rules: { text: "" }, result: { answers: "old" }, testScore: { accuracy: 1 }, datasets: [{ id: "source-copy" }] } };
  const calls = [], messages = [], confirmations = [];
  const deps = { W, canCopyDataset, datasetCopyName, render: () => {}, handleError: (error) => { throw error; },
    preparedLabelsUnsaved: () => Object.values(W.bulk.prelabel.drafts).some((labels) => Object.keys(labels).length),
    confirm: (message) => { confirmations.push(message); return discard; },
    toast: (message) => messages.push(message), rowsText: (rows) => JSON.stringify(rows),
    api: async (path, body) => { calls.push([path, body]); return read ? await read(original) : { dataset: original }; },
    replaceRows: (text) => { if (!approve) return false; W.bulk.rowsText = W.bulk.savedText = text; return true; } };
  return { W, calls, messages, confirmations, original, load: make("loadDatasetCopy", deps) };
}

test("canceling Load as copy preserves unapplied labeling drafts on otherwise saved rows", async () => {
  const x = copyHarness({ drafts: { 0: { urgent: false } }, discard: false });
  const before = structuredClone(x.W.bulk);
  await x.load("source");
  assert.equal(x.confirmations.length, 1);
  assert.match(x.confirmations[0], /labeling drafts/);
  assert.deepEqual(x.W.bulk, { ...before, datasetCopyBusy: false });
  assert.equal(x.calls.length, 1, "only reads the source dataset");
});

test("copy checks labeling drafts created while the source dataset is loading", async () => {
  let finish;
  const x = copyHarness({ discard: false, read: (dataset) => new Promise((resolve) => { finish = () => resolve({ dataset }); }) });
  const pending = x.load("source");
  x.W.bulk.prelabel.drafts = { 1: { urgent: true } };
  finish();
  await pending;
  assert.equal(x.confirmations.length, 1);
  assert.equal(x.W.bulk.rowsText, "before");
  assert.deepEqual(x.W.bulk.prelabel.drafts, { 1: { urgent: true } });
});

test("Load as copy reads once, preserves inputs/labels/pictures and leaves an unlinked unsaved editor", async () => {
  const x = copyHarness();
  await x.load("source");
  assert.deepEqual(x.calls, [["/api/workbench/datasets/load", { id: "source" }]]);
  assert.equal(x.W.bulk.dataset.id, null);
  assert.equal(x.W.bulk.dataset.name, "Source copy 2");
  assert.equal(x.W.bulk.savedText, "");
  assert.deepEqual(JSON.parse(x.W.bulk.rowsText), x.original.rows);
  assert.deepEqual(x.W.bulk.dataset.questions, x.original.questions);
  assert.equal(x.W.bulk.rules.text, x.original.rules);
  assert.equal(x.W.bulk.result, null);
  assert.equal(x.W.bulk.testScore, null);
  assert.equal(x.W.bulk.datasetCopyBusy, false);
});

test("declining replacement or copying held-out inputs leaves the editor unchanged", async () => {
  for (const options of [{ approve: false }, { heldOut: true }]) {
    const x = copyHarness(options);
    await x.load("source");
    assert.equal(x.W.bulk.rowsText, "before");
    assert.equal(x.W.bulk.dataset.id, "before");
    assert.equal(x.W.bulk.datasetCopyBusy, false);
  }
});

test("late copy responses cannot replace newer editor settings or cause duplicate loads", async () => {
  let finish;
  const x = copyHarness({ read: (dataset) => new Promise((resolve) => { finish = () => resolve({ dataset }); }) });
  const pending = x.load("source");
  await x.load("source");
  x.W.bulk.dataset.name = "New name";
  finish();
  await pending;
  assert.equal(x.calls.length, 1);
  assert.equal(x.W.bulk.rowsText, "before");
  assert.equal(x.W.bulk.dataset.name, "New name");
  assert.match(x.messages[0], /editor changed/);
});

test("filtering and sorting move existing dataset nodes without discarding queue edits", () => {
  const W = { bulk: { datasets: items } };
  const rows = items.map((item) => ({ dataset: { datasetId: item.id }, style: {}, draft: { label: "human edit" } }));
  const list = { querySelectorAll: () => rows, append: (row) => { rows.splice(rows.indexOf(row), 1); rows.push(row); } };
  const dom = { "#dataset-search-results": list, "#dataset-search-count": {}, "#dataset-search-summary": {},
    "#dataset-search-empty": {}, "#dataset-catalog-download": {} };
  const h = (tag, attrs, ...children) => ({ tag, attrs, value: attrs.value, children: children.flat(Infinity).filter(Boolean), focus() { this.focused = true; } });
  const nodes = (node) => typeof node !== "object" ? [] : [node, ...node.children.flatMap(nodes)];
  const filters = catalogDefaults();
  const tree = make("datasetSearchControls", { W, $: (id) => dom[id], h, catalogDefaults, matchesCatalog, sortedCatalog,
    catalogSummary, catalogCsv, catalogJson, catalogPreset })(filters);
  const select = (label) => nodes(tree).find((node) => node.attrs["aria-label"] === label);
  select("Filter datasets by held-out split").attrs.onchange({ target: { value: "with" } });
  assert.equal(rows[0].style.display, "");
  assert.equal(rows[1].style.display, "none");
  assert.match(dom["#dataset-search-summary"].textContent, /5 rows/);
  select("Sort datasets").attrs.onchange({ target: { value: "name" } });
  assert.deepEqual(rows.map((row) => row.dataset.datasetId), ["reviews", "tickets", "orders"]);
  assert.ok(rows.every((row) => row.draft.label === "human edit"));
  select("Minimum rows without labels").attrs.oninput({ target: { value: "4" } });
  assert.ok(rows.every((row) => row.style.display === "none"), "count bounds combine with the held-out filter");
  select("Filter datasets by held-out split").attrs.onchange({ target: { value: "all" } });
  assert.equal(rows.find((row) => row.dataset.datasetId === "orders").style.display, "");
  assert.equal(dom["#dataset-catalog-download"].disabled, false);
  select("Sort datasets").attrs.onchange({ target: { value: "unlabeled" } });
  assert.deepEqual(rows.map((row) => row.dataset.datasetId), ["orders", "tickets", "reviews"]);
  assert.ok(rows.every((row) => row.draft.label === "human edit"));
  select("Search datasets").attrs.oninput({ target: { value: "missing" } });
  assert.equal(dom["#dataset-search-empty"].hidden, false);
  nodes(tree).find((node) => node.tag === "button" && node.children[0] === "Clear dataset filters").attrs.onclick();
  assert.deepEqual(filters, catalogDefaults());
  assert.equal(select("Minimum rows without labels").value, "");
  assert.ok(rows.every((row) => row.style.display === ""));
  assert.deepEqual(rows.map((row) => row.dataset.datasetId), items.map((item) => item.id));
});

test("catalog count bounds combine and treat zero as an explicit bound", () => {
  const before = structuredClone(items);
  const ids = (filters) => items.filter((item) => matchesCatalog(item, filters)).map((item) => item.id);
  assert.deepEqual(ids({ minRows: "5" }), ["tickets", "orders"]);
  assert.deepEqual(ids({ maxRows: "2" }), ["reviews"]);
  assert.deepEqual(ids({ minLabeled: "3" }), ["tickets"]);
  assert.deepEqual(ids({ minUnlabeled: "3" }), ["orders"]);
  assert.deepEqual(ids({ minQuestions: "2" }), ["tickets"]);
  assert.deepEqual(ids({ minRows: "2", maxRows: "5", minLabeled: "2", minQuestions: "1" }), ["tickets", "reviews"]);
  assert.deepEqual(ids({ maxRows: "0" }), []);
  assert.deepEqual(ids({ minRows: "6", maxRows: "2" }), []);
  assert.deepEqual(ids({ minRows: "" }), items.map((item) => item.id));
  for (const value of ["-1", "1.5", "NaN", "Infinity"]) assert.deepEqual(ids({ minRows: value }), []);
  assert.equal(matchesCatalog({ rows: 0 }, { minRows: 0, maxRows: 0, minUnlabeled: 0 }), true);
  assert.deepEqual(items, before);
});

test("catalog metadata sorts order datasets without mutating saved order", () => {
  const before = structuredClone(items);
  for (const [sort, expected] of [
    ["name-desc", ["orders", "tickets", "reviews"]],
    ["rows-asc", ["reviews", "tickets", "orders"]],
    ["unlabeled", ["orders", "tickets", "reviews"]],
    ["questions", ["tickets", "reviews", "orders"]],
    ["held-out", ["tickets", "orders", "reviews"]],
  ]) assert.deepEqual(sortedCatalog(items, sort).map((item) => item.id), expected);
  assert.deepEqual(items, before);
  assert.deepEqual(sortedCatalog([{ id: "empty" }, { id: "also-empty" }], "unlabeled").map((item) => item.id), ["empty", "also-empty"]);
});


test("saved-date boundaries are inclusive and unknown dates never match a date filter", () => {
  const dated = { ...items[0], saved_at: "2026-11-10T23:59:00Z" };
  assert.equal(matchesCatalog(dated, { savedAfter: "2026-11-10", savedBefore: "2026-11-10" }), true);
  assert.equal(matchesCatalog(dated, { savedAfter: "2026-11-11" }), false);
  assert.equal(matchesCatalog(dated, { savedBefore: "2026-11-09" }), false);
  assert.equal(matchesCatalog(items[0], { savedAfter: "2026-11-01" }), false);
  assert.equal(matchesCatalog(dated, { savedAfter: "invalid" }), false);
});

test("label-share filters accept fractions and zero but exclude empty datasets", () => {
  assert.equal(matchesCatalog(items[0], { minLabelShare: "60", maxLabelShare: "60" }), true);
  assert.equal(matchesCatalog(items[0], { minLabelShare: "60.1" }), false);
  assert.equal(matchesCatalog(items[1], { maxLabelShare: "0" }), true);
  assert.equal(matchesCatalog({ rows: 0 }, { minLabelShare: "0" }), false);
  for (const value of ["-1", "101", "Infinity", "oops"]) {
    assert.equal(matchesCatalog(items[0], { minLabelShare: value }), false);
  }
});

test("timestamp and label-share sorting keeps unknown or empty datasets last", () => {
  const rows = [{ id: "unknown", rows: 0 }, { id: "older", rows: 2, labeled: 2, saved_at: "2026-01-01" },
    { id: "newer", rows: 10, labeled: 1, saved_at: "2026-11-10" }];
  assert.deepEqual(sortedCatalog(rows, "newest").map((x) => x.id), ["newer", "older", "unknown"]);
  assert.deepEqual(sortedCatalog(rows, "oldest").map((x) => x.id), ["older", "newer", "unknown"]);
  assert.deepEqual(sortedCatalog(rows, "label-share").map((x) => x.id), ["newer", "older", "unknown"]);
  assert.equal(rows[0].id, "unknown");
});

test("pin filtering is session metadata and presets return independent filter sets", () => {
  assert.equal(matchesCatalog(items[0], { pinned: "with", pinnedIds: ["tickets"] }), true);
  assert.equal(matchesCatalog(items[1], { pinned: "with", pinnedIds: ["tickets"] }), false);
  assert.equal(matchesCatalog(items[0], { pinned: "with" }), false);
  assert.deepEqual(items.filter((x) => matchesCatalog(x, catalogPreset("label"))), [items[0]]);
  assert.deepEqual(items.filter((x) => matchesCatalog(x, catalogPreset("unlabeled"))), [items[1]]);
  assert.deepEqual(items.filter((x) => matchesCatalog(x, catalogPreset("check"))), [items[2]]);
  const preset = catalogPreset("label");
  preset.pinnedIds.push("tickets");
  assert.deepEqual(catalogPreset("label").pinnedIds, []);
});

test("JSON catalog uses only allowlisted metadata and preserves names verbatim", () => {
  const output = catalogJson([{ ...items[0], name: "=name", answers: "forbidden", labels: "forbidden" }]);
  const [item] = JSON.parse(output);
  assert.equal(item.name, "=name");
  assert.equal(item.saved_check, true);
  assert.equal(item.held_out_rows, 2);
  assert.equal(item.guideline_questions, 1);
  assert.equal(item.labeled_rows, 3);
  assert.doesNotMatch(output, /private configuration|Email traffic|forbidden/);
  assert.deepEqual(Object.keys(item), ["id", "name", "rows", "labeled_rows", "questions", "held_out_rows", "saved_check", "guideline_questions", "saved_at"]);
});
