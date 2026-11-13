// Tests of the Lab surfaces of the Workbench Datasets panel (static/js/lab/surfaces/workbench-datasets.js) and of the
// hooks in static/js/workbench-datasets.js and static/js/history.js that route the page through them.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as catalog from "../../../static/js/dataset-catalog.js";
import { changeSecondLabel, secondItems, settleKey } from "../../../static/js/agreement.js";
import { createHistory } from "../../../static/js/history.js";
import { definePack } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";
import * as builders from "../../../static/js/lab/surfaces/workbench-datasets.js";
import { fakeEnv, find, findAll, textOf } from "./harness.mjs";
import { AGREEMENT_SURFACE, CATALOG_SURFACE, DATASETS_NOW, HISTORY_SURFACE, sampleAgreementLabels, sampleAgreementReport, sampleAgreementSample,
  sampleDatasetsAgreementCtx, sampleDatasetsCatalogCtx, sampleDatasetsHistoryCtx, sampleDatasetsRaw, sampleRevisionsRaw } from "./fixtures/workbench-datasets.mjs";
import { workbenchSource } from "../workbench-source.mjs";

const body = (name) => workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const rebuild = (name, deps) => new Function(...Object.keys(deps), `${body(name)}; return ${name};`)(...Object.values(deps));

// Small test packs: one numeric fact per surface, so Lab filters and sorts can be driven.
const rowsPack = definePack({ id: "t-rows", surface: CATALOG_SURFACE, title: "T", features: [
  { id: "rows", kind: "fact", type: "number", label: "rows", value: (item) => item.rows }] });
const revPack = definePack({ id: "t-rev", surface: HISTORY_SURFACE, title: "T", features: [
  { id: "labeled", kind: "fact", type: "number", label: "labeled", value: (item) => item.labeled }] });
const agreePack = definePack({ id: "t-agree", surface: AGREEMENT_SURFACE, title: "T", features: [
  { id: "missing", kind: "fact", type: "number", label: "missing", value: (item) => item.missing }] });
const newLab = () => createLab([rowsPack, revPack, agreePack], builders);
const filterOn = (lab, surface, key, op, value) => { lab.view(surface).filters = [{ key, op, value }]; };
const sortOn = (lab, surface, key, dir) => { lab.view(surface).sort = { key, dir }; };

// ---------- catalog ----------

test("catalog items are frozen summary metadata in saved order, without check configuration", () => {
  const ctx = sampleDatasetsCatalogCtx({ filters: {} });
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.id), ["archived-refunds", "bean-reviews", "cafe-photos", "empty-draft", "harbor-support-inbox", "wholesale-leads"]);
  assert.deepEqual(items[4], { id: "harbor-support-inbox", name: "Harbor support inbox", position: 5, notes: "Email tickets from support@harbor.example", has_notes: true,
    saved_at: "2026-10-30T16:20:00Z", saved_ms: Date.UTC(2026, 9, 30, 16, 20), rows: 40, labeled: 30, unlabeled: 10, label_share: 0.75, questions: 2,
    question_labels: [{ id: "intent", labeled: 30 }, { id: "urgent", labeled: 18 }], guidelines: 2, unguided: 0, has_check: true, check_notes: 0,
    test: { rows: 8, labeled: 6, share: 0.2, looks: 1, locked_at: "2026-10-31T09:00:00Z" }, tuning: 32, tuning_labeled: 24, held_out: 8, held_out_labeled: 6,
    loaded: true, pinned: false, can_copy: false, agreement_ready: true, agreement_open: true, split_ready: false });
  const empty = items[3];
  assert.equal(empty.name, "empty-draft");
  assert.equal(empty.notes, "");
  assert.equal(empty.label_share, null);
  assert.equal(items[2].saved_ms, null);
  assert.equal(items[1].pinned, true);
  assert.equal(items[1].split_ready, true);
  assert.ok(Object.isFrozen(items[4]) && Object.isFrozen(items[4].test) && Object.isFrozen(items[4].question_labels[0]));
  assert.doesNotMatch(JSON.stringify(items), /jev-1\.2|gates|tuned_on|Pinned to/, "no check configuration or check note text");
  assert.strictEqual(ctx.items()[4], items[4], "the same raw summary in the same state gives the same item");
  ctx.actions.pin(["harbor-support-inbox"]);
  assert.notStrictEqual(ctx.items()[4], items[4]);
  assert.equal(ctx.items()[4].pinned, true);
  assert.equal(ctx.actions.replaceItems, undefined);
  assert.equal(ctx.actions.importItems, undefined);
});

test("catalog shown() follows every page filter and sort, then Lab's filters, with Lab's sort last", () => {
  assert.deepEqual(sampleDatasetsCatalogCtx().shown().map((item) => item.id), ["bean-reviews", "cafe-photos", "empty-draft", "harbor-support-inbox", "wholesale-leads"]);
  assert.deepEqual(sampleDatasetsCatalogCtx({ filters: { sort: "rows-asc", test: "with" } }).shown().map((item) => item.id), ["archived-refunds", "harbor-support-inbox"]);
  assert.deepEqual(sampleDatasetsCatalogCtx({ filters: { sort: "pinned" }, pinnedIds: ["wholesale-leads"] }).shown().map((item) => item.id).slice(0, 2),
    ["wholesale-leads", "archived-refunds"]);
  const lab = newLab();
  const ctx = sampleDatasetsCatalogCtx({ lab, filters: { sort: "name-desc" } });
  assert.deepEqual(ctx.shown().map((item) => item.id), ["wholesale-leads", "harbor-support-inbox", "empty-draft", "cafe-photos", "bean-reviews", "archived-refunds"],
    "no Lab setting: page order (these settings replace the default exclusion)");
  filterOn(lab, CATALOG_SURFACE, "t-rows/rows", "min", "10");
  assert.deepEqual(ctx.shown().map((item) => item.id), ["wholesale-leads", "harbor-support-inbox", "bean-reviews"]);
  sortOn(lab, CATALOG_SURFACE, "t-rows/rows", "asc");
  assert.deepEqual(ctx.shown().map((item) => item.id), ["bean-reviews", "wholesale-leads", "harbor-support-inbox"]);
  assert.equal(lab.active(CATALOG_SURFACE), 2);
  lab.reset(CATALOG_SURFACE);
  assert.equal(ctx.shown().length, 6);
});

test("catalog data: page settings, pins in saved order, loaded dataset and busy flags", () => {
  const data = sampleDatasetsCatalogCtx({ pinnedIds: ["wholesale-leads", "gone", "bean-reviews"], copyBusy: true, unsaved: true }).data;
  assert.equal(data.total, 6);
  assert.equal(data.loaded_id, "harbor-support-inbox");
  assert.deepEqual(data.pinned_ids, ["bean-reviews", "wholesale-leads"]);
  assert.equal(data.filters.exclude, "archived");
  assert.equal(data.filters.pinnedIds, undefined);
  assert.equal(data.filters_active, 1);
  assert.equal(data.sort, "saved");
  assert.equal(data.copy_busy, true);
  assert.equal(data.save_busy, false);
  assert.equal(data.unsaved, true);
  assert.equal(data.now, DATASETS_NOW);
  assert.ok(Object.isFrozen(data));
  const none = sampleDatasetsCatalogCtx({ datasets: [], loadedId: null }).data;
  assert.equal(none.total, 0);
  assert.equal(none.loaded_id, null);
  assert.deepEqual(none.pinned_ids, []);
});

test("catalog actions wrap the page's own handlers and refuse what the page would not offer", () => {
  const ctx = sampleDatasetsCatalogCtx();
  assert.throws(() => ctx.actions.load("nope"), /no saved dataset “nope”/);
  ctx.actions.load("bean-reviews");
  assert.throws(() => ctx.actions.loadCopy("harbor-support-inbox"), /held-out rows or test history/);
  ctx.actions.loadCopy("bean-reviews");
  ctx.actions.downloadBundle("cafe-photos");
  assert.throws(() => ctx.actions.pin("bean-reviews"), /list of saved dataset IDs/);
  assert.throws(() => ctx.actions.pin(["ghost"]), /Pins are unchanged/);
  assert.deepEqual(ctx.actions.pin(["harbor-support-inbox", "ghost"]), ["bean-reviews", "harbor-support-inbox"]);
  assert.deepEqual(ctx.actions.pin(["bean-reviews"], false), ["harbor-support-inbox"]);
  assert.throws(() => ctx.actions.openAgreement("cafe-photos"), /needs saved questions and labeled rows/);
  ctx.actions.openAgreement("bean-reviews");
  ctx.actions.resetFilters();
  assert.deepEqual(ctx.log, [["load", "bean-reviews"], ["loadCopy", "bean-reviews"], ["downloadBundle", "cafe-photos"],
    ["setPins", ["bean-reviews", "harbor-support-inbox"]], ["setPins", ["harbor-support-inbox"]], ["openAgreement", "bean-reviews"], ["resetFilters"]]);
  assert.throws(() => sampleDatasetsCatalogCtx({ copyBusy: true }).actions.loadCopy("bean-reviews"), /already loading/);
  assert.throws(() => builders.datasetsCatalogCtx({ datasets: sampleDatasetsRaw() }).actions.load("bean-reviews"), /cannot do that here/);
  assert.equal(ctx.itemName(ctx.items()[0]), "archived-refunds");
});

// ---------- history ----------

test("history items: counts and question ids per kept revision, null counts for an unreadable file", () => {
  const ctx = sampleDatasetsHistoryCtx();
  const items = ctx.items();
  assert.deepEqual(items[0], { revision: "20261030T162000000000Z-a1b2c3d4e5f6", position: 1, at: "2026-10-30T16:20:00.000000Z", at_ms: Date.UTC(2026, 9, 30, 16, 20),
    current: true, readable: true, name: "Harbor support inbox", saved_at: "2026-10-30T16:20:00Z", saved_ms: Date.UTC(2026, 9, 30, 16, 20), rows: 40, labeled: 30,
    held_out: 8, unlabeled: 10, questions: ["intent", "urgent"], has_check: true, previewing: false });
  assert.deepEqual([items[2].readable, items[2].rows, items[2].labeled, items[2].held_out, items[2].questions, items[2].name], [false, null, null, null, [], null]);
  assert.equal(ctx.itemName(items[3]), "#4");
  assert.ok(Object.isFrozen(items[0].questions));
  assert.deepEqual(sampleDatasetsHistoryCtx({ datasetId: "other" }).items().length, 5);
  assert.deepEqual(sampleDatasetsHistoryCtx({ loaded: false }).items(), []);
  const mismatched = builders.datasetsHistoryCtx({ datasetId: "a", state: { list: { id: "b", revisions: sampleRevisionsRaw() } } });
  assert.deepEqual(mismatched.items(), [], "a listing for another dataset is not this panel's");
  assert.equal(sampleDatasetsHistoryCtx({ preview: true }).items()[1].previewing, true);
});

test("history shown() honors the page's identical-revision filter and Lab's filters and sort", () => {
  assert.deepEqual(sampleDatasetsHistoryCtx({ changedOnly: true }).shown().map((item) => item.position), [2, 3, 4, 5]);
  const lab = newLab();
  const ctx = sampleDatasetsHistoryCtx({ lab, changedOnly: true });
  filterOn(lab, HISTORY_SURFACE, "t-rev/labeled", "min", "1");
  assert.deepEqual(ctx.shown().map((item) => item.position), [2, 4], "the unreadable revision has no count, so a bound hides it");
  sortOn(lab, HISTORY_SURFACE, "t-rev/labeled", "desc");
  assert.deepEqual(ctx.shown().map((item) => item.position), [4, 2]);
});

test("history data mirrors the panel and the restore preview as counts", () => {
  const data = sampleDatasetsHistoryCtx({ preview: true }).data;
  assert.equal(data.dataset_id, "harbor-support-inbox");
  assert.equal(data.exists, true);
  assert.equal(data.keep, 20);
  assert.equal(data.loaded, true);
  assert.equal(data.preview.revision, "20261028T101500000000Z-0f9e8d7c6b5a");
  assert.deepEqual(data.preview.labels, { added: 0, removed: 6, changed: 1 });
  assert.deepEqual(data.preview.guidelines, { before: 2, after: 2, added: 0, changed: 1, removed: 0 });
  assert.equal(data.preview.check, "none");
  assert.deepEqual(data.deleted, [{ id: "old-promos", name: "Old promos", revisions: 2, latest: "2026-08-14T15:00:00.000000Z" }]);
  assert.doesNotMatch(JSON.stringify(data), /"intent"/, "the guideline change is a count, not question ids");
  const unread = sampleDatasetsHistoryCtx({ loaded: false, deleted: null }).data;
  assert.equal(unread.exists, null);
  assert.equal(unread.loaded, false);
  assert.equal(unread.preview, null);
  assert.equal(unread.deleted, null);
  assert.equal(sampleDatasetsHistoryCtx({ exists: false }).data.exists, false);
});

test("history actions: preview needs a listed readable revision, restore needs a preview, nothing while busy", () => {
  const ctx = sampleDatasetsHistoryCtx();
  assert.throws(() => ctx.actions.preview("nope"), /not in this history/);
  assert.throws(() => ctx.actions.preview("20261025T080000000000Z-badbadbadbad"), /not a readable dataset file/);
  assert.throws(() => ctx.actions.restore(), /Preview a revision first/);
  assert.throws(() => ctx.actions.cancelPreview(), /No restore preview/);
  assert.throws(() => ctx.actions.setChangedOnly("yes"), /true or false/);
  ctx.actions.preview("20261020T090000000000Z-1234567890ab");
  ctx.actions.restore();
  ctx.actions.cancelPreview();
  ctx.actions.setChangedOnly(true);
  ctx.actions.reload();
  assert.deepEqual(ctx.log, [["preview", "20261020T090000000000Z-1234567890ab"], ["restore", "20261020T090000000000Z-1234567890ab"], ["cancelPreview"],
    ["setChangedOnly", true], ["reload"]]);
  const busy = sampleDatasetsHistoryCtx({ busy: true, preview: true });
  for (const action of [() => busy.actions.reload(), () => busy.actions.restore(), () => busy.actions.preview("20261028T101500000000Z-0f9e8d7c6b5a")]) {
    assert.throws(action, /Wait for the history/);
  }
  assert.deepEqual(busy.log, []);
});

// ---------- agreement ----------

test("agreement items hold the blind sample and the second labels; no saved label before Compare", () => {
  const before = sampleDatasetsAgreementCtx({ report: null });
  const items = before.items();
  assert.deepEqual(items[2], { row_id: "c3d2", number: 12, position: 3, input: { text: "Grinder broke after two days", channel: "email", _image: "broken-grinder.png" },
    picture: "broken-grinder.png", questions: ["intent", "urgent", "tone"], second: { intent: "replacement", urgent: null, tone: null }, given: 1, missing: 2, done: false,
    differences: null });
  assert.equal(items[4].input, "Cancel my subscription");
  assert.equal(items[4].picture, null);
  assert.equal(before.itemName(items[0]), "row 3");
  assert.equal(before.data.report, null);
  assert.equal(before.data.choices, 0);
  assert.equal(before.data.settled_rows, 0);
  assert.ok(items.every((item) => item.differences === null));
  const after = sampleDatasetsAgreementCtx();
  assert.deepEqual(after.items()[0].differences, [{ question: "urgent", saved: false, second: true, settle: { set: false } }]);
  assert.deepEqual(after.items()[2].differences, [{ question: "intent", saved: "refund", second: "replacement", settle: { set: true, value: "replacement" } }]);
  assert.deepEqual(after.items()[1].differences, []);
  assert.deepEqual(sampleDatasetsAgreementCtx({ sample: null }).items(), []);
  assert.equal(after.actions.replaceItems, undefined);
});

test("agreement data: sample, question options, progress and the comparison", () => {
  const data = sampleDatasetsAgreementCtx().data;
  assert.deepEqual(data.sample, { requested: 5, drawn: 5, eligible: 30, seed: 7, recoverable: true });
  assert.deepEqual(data.questions, [{ id: "intent", type: "choice", options: ["refund", "replacement", "question"] },
    { id: "urgent", type: "noul", options: ["yes", "no"] }, { id: "tone", type: "score", options: ["0", "1", "2"] }]);
  assert.equal(data.given_rows, 3);
  assert.equal(data.given_labels, 4);
  assert.equal(data.unsaved, true);
  assert.deepEqual(data.report.questions.map((q) => [q.id, q.kappa]), [["intent", 0.5], ["urgent", null]]);
  assert.deepEqual(data.report.questions[1].mixups, [{ saved: false, second: true, rows: 1 }]);
  assert.equal(data.report.truncated, false);
  assert.equal(data.choices, 1);
  assert.equal(data.settled_rows, 1);
  assert.doesNotMatch(JSON.stringify(data), /stale|Canada|ctx-7|row_id/, "no inputs, session context or sample CSV in data");
  const none = sampleDatasetsAgreementCtx({ sample: null, report: null }).data;
  assert.equal(none.sample, null);
  assert.deepEqual(none.questions, []);
  assert.equal(none.given_rows, 0);
});

test("agreement shown() applies Lab's filters and sort; Compare still counts hidden labels", () => {
  const lab = newLab();
  const ctx = sampleDatasetsAgreementCtx({ lab });
  filterOn(lab, AGREEMENT_SURFACE, "t-agree/missing", "min", "1");
  assert.deepEqual(ctx.shown().map((item) => item.number), [12, 18, 25]);
  sortOn(lab, AGREEMENT_SURFACE, "t-agree/missing", "desc");
  assert.deepEqual(ctx.shown().map((item) => item.number), [12, 25, 18]);
  assert.equal(ctx.data.given_rows, 3, "rows 3 and 7 are hidden but still sent");
});

test("agreement actions go through the page's label and settle paths with their guards", () => {
  const ctx = sampleDatasetsAgreementCtx();
  assert.throws(() => ctx.actions.setSecondLabel("zzz", "intent", "refund"), /not in this agreement sample/);
  assert.throws(() => ctx.actions.setSecondLabel("b2e1", "urgent", true), /does not ask “urgent”/);
  assert.throws(() => ctx.actions.setSecondLabel("c3d2", "urgent", "yes"), /not a label/);
  assert.throws(() => ctx.actions.setSecondLabel("c3d2", "tone", 3), /not a label/);
  assert.throws(() => ctx.actions.setSecondLabel("c3d2", "intent", "exchange"), /not a label/);
  assert.throws(() => ctx.actions.settle("b2e1", "intent", "question"), /not a disagreement/);
  assert.throws(() => ctx.actions.settle("a1f0", "urgent", "maybe"), /not a label/);
  ctx.actions.settle("a1f0", "urgent", null);
  assert.equal(ctx.data.choices, 2);
  ctx.actions.setSecondLabel("c3d2", "tone", 2);
  assert.equal(ctx.data.report, null, "a label change drops the comparison, as on the page");
  assert.equal(ctx.items()[2].second.tone, 2);
  assert.ok(ctx.state.pendingSettlements.length >= 1, "settlement choices are kept for recovery");
  assert.throws(() => ctx.actions.settle("a1f0", "urgent", true), /Compare first/);
  ctx.actions.compare();
  assert.deepEqual(ctx.log, [["settle", "a1f0", "urgent", null], ["setLabel", "c3d2", "tone", 2], ["compare"]]);
  assert.throws(() => sampleDatasetsAgreementCtx({ labels: {} }).actions.compare(), /at least one second label/);
  assert.throws(() => sampleDatasetsAgreementCtx({ sample: null }).actions.compare(), /Draw a sample first/);
  const busy = sampleDatasetsAgreementCtx({ busy: true });
  assert.throws(() => busy.actions.compare(), /Wait/);
  assert.throws(() => busy.actions.setSecondLabel("a1f0", "intent", null), /Wait/);
  assert.throws(() => busy.actions.settle("a1f0", "urgent", true), /Wait/);
});

// ---------- hooks in the page code ----------

const h = (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, value: attrs?.value, disabled: attrs?.disabled,
  children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
  replaceChildren(...next) { this.children = next; }, focus() {}, addEventListener() {} });
const tree = (node) => (typeof node !== "object" || node === null ? [] : [node, ...(node.children || []).flatMap(tree)]);

function catalogPage({ withLab = true } = {}) {
  const lab = newLab();
  const filters = { ...catalog.catalogDefaults(), exclude: "archived", pinnedIds: ["bean-reviews"] };
  const W = { bulk: { datasets: sampleDatasetsRaw(), datasetSearch: filters, dataset: { id: "harbor-support-inbox" }, agreeRuns: {} } };
  if (withLab) { W.lab = lab; W.labEnv = fakeEnv(); }
  const rows = W.bulk.datasets.map((item) => ({ dataset: { datasetId: item.id }, style: {}, draft: "human edit" }));
  const list = { querySelectorAll: () => rows, append(row) { rows.splice(rows.indexOf(row), 1); rows.push(row); } };
  const dom = { "#dataset-search-results": list };
  const copied = [];
  const make = rebuild("datasetsCatalogLab", { W, bulkUnsaved: () => false, loadDataset() {}, loadDatasetCopy() {}, exportBundle() {}, agreeRun: () => ({}),
    render() {}, catalogDefaults: catalog.catalogDefaults });
  const controls = rebuild("datasetSearchControls", { ...catalog, W, h, $: (selector) => dom[selector], copyText: (text) => copied.push(text), datasetsCatalogLab: make });
  const root = controls(filters);
  for (const node of tree(root)) if (node.attrs.id) dom[`#${node.attrs.id}`] = node;
  const shown = () => rows.filter((row) => row.style.display !== "none").map((row) => row.dataset.datasetId);
  const button = (text) => tree(root).find((node) => node.tag === "button" && textOf(node) === text);
  return { W, lab, rows, dom, root, shown, copied, button, ctx: withLab ? make() : null };
}

test("hook: without Lab the catalog controls render and count exactly as before", () => {
  const page = catalogPage({ withLab: false });
  assert.equal(textOf(page.root).includes("Lab setting"), false);
  assert.equal(page.W.datasetsCatalogRefresh, undefined);
  page.button("Copy shown dataset IDs").attrs.onclick();
  assert.deepEqual(page.copied, ["bean-reviews\ncafe-photos\nempty-draft\nharbor-support-inbox\nwholesale-leads"]);
});

test("hook: Lab filters hide catalog cards in place, count as active, scope shown actions, and Clear resets them", () => {
  const page = catalogPage();
  filterOn(page.lab, CATALOG_SURFACE, "t-rows/rows", "min", "10");
  sortOn(page.lab, CATALOG_SURFACE, "t-rows/rows", "desc");
  page.W.datasetsCatalogRefresh();
  assert.deepEqual(page.shown(), ["harbor-support-inbox", "wholesale-leads", "bean-reviews"]);
  assert.deepEqual(page.rows.map((row) => row.dataset.datasetId).slice(0, 4), ["harbor-support-inbox", "wholesale-leads", "bean-reviews", "archived-refunds"],
    "Lab's sort reorders every card after the page's sort, hidden ones included");
  assert.equal(page.dom["#dataset-catalog-active-count"].textContent, "1 active dataset filter · 2 Lab settings active");
  assert.equal(page.dom["#dataset-search-count"].textContent, "3 of 6 datasets shown");
  page.button("Copy shown dataset IDs").attrs.onclick();
  assert.deepEqual(page.copied, ["harbor-support-inbox\nwholesale-leads\nbean-reviews"]);
  assert.deepEqual(page.ctx.shown().map((item) => item.id), ["harbor-support-inbox", "wholesale-leads", "bean-reviews"]);
  page.ctx.actions.pin(["wholesale-leads"]);
  assert.deepEqual(page.W.bulk.datasetSearch.pinnedIds, ["bean-reviews", "wholesale-leads"]);
  page.ctx.actions.resetFilters();
  assert.equal(page.lab.active(CATALOG_SURFACE), 0);
  assert.deepEqual(page.shown(), ["archived-refunds", "bean-reviews", "cafe-photos", "empty-draft", "harbor-support-inbox", "wholesale-leads"]);
  assert.deepEqual(page.W.bulk.datasetSearch.pinnedIds, ["bean-reviews", "wholesale-leads"], "pins survive Clear");
  assert.ok(page.rows.every((row) => row.draft === "human edit"), "cards stay mounted");
});

test("hook: the history panel counts Lab filters, renders the Lab section and sorts revisions", async () => {
  const lab = newLab();
  const W = { lab, labEnv: fakeEnv() };
  const labFor = rebuild("datasetsHistoryLab", { W, render() {} });
  const revisions = sampleRevisionsRaw();
  const make = (withLab) => createHistory({ h, render() {}, toast() {}, handleError: (e) => { throw e; },
    api: async (path) => (path.endsWith("/history") ? { id: "harbor-support-inbox", exists: true, keep: 20, revisions } : {}),
    afterRestore: async () => {}, confirm: () => true, lab: withLab ? (id, control) => labFor(id, control) : undefined });
  for (const withLab of [false, true]) {
    const ui = make(withLab);
    ui.button("harbor-support-inbox").attrs.onclick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const plain = ui.panel("harbor-support-inbox");
    assert.match(textOf(plain), /5 of 5 revisions shown/);
    assert.equal(textOf(plain).includes("Lab setting"), false);
    assert.equal(!!find(plain, (node) => node.attrs?.["data-lab-surface"] === HISTORY_SURFACE), withLab);
    if (!withLab) continue;
    filterOn(lab, HISTORY_SURFACE, "t-rev/labeled", "min", "1");
    sortOn(lab, HISTORY_SURFACE, "t-rev/labeled", "asc");
    const filtered = ui.panel("harbor-support-inbox");
    assert.match(textOf(filtered), /3 of 5 revisions shown · 2 Lab settings active/);
    assert.deepEqual(findAll(filtered, (node) => node.tag === "li" && !node.attrs.class).map((li) => textOf(li).slice(0, 10)), ["2026-10-28", "2026-10-20", "2026-10-30"]);
    find(filtered, (node) => node.tag === "button" && textOf(node) === "Clear Lab filters and sort").attrs.onclick();
    assert.equal(lab.active(HISTORY_SURFACE), 0);
    const ctx = W.datasetsHistoryLabs["harbor-support-inbox"].ctx;
    assert.equal(ctx.items().length, 5);
    ctx.actions.setChangedOnly(true);
    assert.match(textOf(ui.panel("harbor-support-inbox")), /4 of 5 revisions shown/, "the ctx acts through the panel's own state");
  }
});

test("hook: Lab filters hide agreement cards, say so, and Compare still sends every labeled row", () => {
  const lab = newLab();
  const sample = sampleAgreementSample();
  const run = { open: true, busy: false, sample, labels: sampleAgreementLabels(), report: sampleAgreementReport(), choices: {}, pendingSettlements: [] };
  const W = { lab, labEnv: fakeEnv(), bulk: { pictures: {}, datasets: [{ id: "harbor-support-inbox", name: "Harbor support inbox" }], agreeRuns: { "harbor-support-inbox": run } } };
  const compared = [];
  const labFor = rebuild("datasetsAgreementLab", { W, render() {}, agreeRun: () => run, changeSecondLabel, settleKey,
    compareAgreement: (id) => compared.push(id) });
  const functions = ["agreeSampleView", "agreeQuestions", "queueClasses", "labelText", "labelValue"].map(body).join("\n");
  const deps = { W, h, icon: () => "", rowText: (row) => (typeof row === "string" ? row : row.text), render() {}, secondItems, compareAgreement: (id) => compared.push(id),
    changeSecondLabel, datasetsAgreementLab: labFor };
  const view = new Function(...Object.keys(deps), `${functions}; return agreeSampleView;`)(...Object.values(deps));
  const cards = (node) => findAll(node, (n) => typeof n.attrs?.class === "string" && n.attrs.class.startsWith("queue-item")).map((n) => textOf(n).match(/row (\d+)/)[1]);
  const plain = view({ id: "harbor-support-inbox", name: "Harbor support inbox" }, run);
  assert.deepEqual(cards(plain), ["3", "7", "12", "18", "25"]);
  assert.ok(find(plain, (node) => node.attrs?.["data-lab-surface"] === AGREEMENT_SURFACE));
  assert.equal(textOf(plain).includes("Lab setting"), false);
  filterOn(lab, AGREEMENT_SURFACE, "t-agree/missing", "min", "1");
  sortOn(lab, AGREEMENT_SURFACE, "t-agree/missing", "desc");
  const filtered = view({ id: "harbor-support-inbox" }, run);
  assert.deepEqual(cards(filtered), ["12", "25", "18"]);
  assert.match(textOf(filtered), /Showing 3 of 5 sampled rows · 2 Lab settings active/);
  assert.match(textOf(filtered), /Compare 3 labeled rows/, "hidden rows still count for Compare");
  const ctx = W.datasetsAgreementLabs["harbor-support-inbox"];
  ctx.actions.setSecondLabel("e5b4", "urgent", false);
  assert.equal(run.labels.e5b4.urgent, false);
  assert.equal(run.report, null, "the page's changeSecondLabel dropped the comparison");
  ctx.actions.compare();
  assert.deepEqual(compared, ["harbor-support-inbox"]);
  // Without Lab the view is the page's own.
  const noLab = new Function(...Object.keys(deps), `${functions}; return agreeSampleView;`)(...Object.values({ ...deps, W: { bulk: W.bulk } }));
  assert.deepEqual(cards(noLab({ id: "harbor-support-inbox" }, run)), ["3", "7", "12", "18", "25"]);
});
