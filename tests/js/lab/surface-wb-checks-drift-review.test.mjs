// The Workbench saved checks, drift "Label new traffic" and Review queue Lab surfaces: the builders
// (static/js/lab/surfaces/workbench-checks.js) and the hooks in static/js/workbench-checks.js, workbench-drift.js and
// workbench-review.js, rebuilt from the page's source the way the page's own tests do (tests/js/review-navigation.test.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogDefaults, matchesCatalog, sortedCatalog } from "../../../static/js/dataset-catalog.js";
import { createLab } from "../../../static/js/lab/host.js";
import { checksListCtx } from "../../../static/js/lab/surfaces/workbench-checks.js";
import checksPack from "../../../static/js/lab/packs/workbench/checks-list-essentials.js";
import driftPack from "../../../static/js/lab/packs/workbench/drift-queue-essentials.js";
import reviewPack from "../../../static/js/lab/packs/workbench/review-queue-essentials.js";
import { workbenchSource } from "../workbench-source.mjs";
import { fakeEnv } from "./harness.mjs";
import { CHECKS_SURFACE, DRIFT_SURFACE, REVIEW_SURFACE, sampleCheckDatasets, sampleCheckRuns, sampleChecksListCtx, sampleDriftQueueCtx,
  sampleReviewItemsRaw, sampleReviewQueueCtx } from "./fixtures/workbench-checks.mjs";

const body = (name) => workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const lines = (list) => list.map((item) => item.line);
const ids = (list) => list.map((item) => item.id);
const frozenDeep = (value) => !value || typeof value !== "object" || (Object.isFrozen(value) && Object.values(value).every(frozenDeep));

// A stand-in for common.js h(): plain nodes that also take addEventListener, as the page's own tests use.
function h(tag, attrs, ...children) {
  return { tag, attrs: attrs || {}, children: children.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false), addEventListener() {} };
}
const textOf = (node) => (node && typeof node === "object" ? (node.children || []).map(textOf).join(" ") : node === null || node === undefined ? "" : String(node));
const all = (node) => (node && typeof node === "object" ? [node, ...(node.children || []).flatMap(all)] : []);
const findAll = (node, match) => (Array.isArray(node) ? node.flatMap((entry) => all(entry)) : all(node)).filter(match);

// ---------- workbench.checks.list ----------

test("checks: one frozen item per dataset with a check, in catalog order, joined with this session's run state", () => {
  const ctx = sampleChecksListCtx({ catalogHidden: [] });
  assert.deepEqual(ids(ctx.items()), ["harbor-support", "wholesale-leads", "bean-reviews", "roastery-orders"]);
  const [harbor, wholesale, bean, roastery] = ctx.items();
  assert.deepEqual(wholesale, {
    id: "wholesale-leads", name: "Wholesale leads", position: 2, loaded: true, rows: 30, tuning_rows: 30, held_out_rows: 0, labeled: 30, question_count: 2,
    calls: 30, gates: { route: 0.55 }, gated: ["route"], signal: "probability", bound: "estimate", model: "jev-latest", tuned_on: "jev-1.2",
    min_accuracy: 0.9, min_coverage: 0.3, rules: 0, slice_targets: [], answer_sets: {}, notes: ["Pin this check to jev-1.2: it asks the alias jev-latest."],
    model_override: "jev-1.3", busy: false,
    report: { status: "pass", rows: 30, labeled: 30, automated: 18, correct: 17, coverage: 0.6, accuracy: 17 / 18, accuracy_low: 0.742, accuracy_high: 0.99,
      measured: 17 / 18, accuracy_ok: true, coverage_ok: true, model: "jev-latest", answered_by: ["jev-1.3"], cost_usd: 0.0021, latency_ms_median: 380,
      wall_ms: 2900, mistakes_total: 1, reasons: [], notes: ["jev-latest answered as jev-1.3, not jev-1.2."], slices: [] },
    drift: { open: false, running: false, compared: false, status: null, recovered: false, queued: 0 },
    upgrade: { open: false, running: false, verdict: "retune", candidate: "jev-1.3" },
    queue: { open: false, read: false, rows: 0, ready: 0, audit: 0, edited_labels: 0 },
  });
  assert.equal(harbor.tuning_rows, 40);
  assert.equal(harbor.rules, 1);
  assert.deepEqual(harbor.drift, { open: false, running: false, compared: true, status: "shift", recovered: false, queued: 3 });
  assert.deepEqual(harbor.queue, { open: true, read: true, rows: 4, ready: 2, audit: 1, edited_labels: 2 });
  assert.deepEqual(harbor.report.slices, [{ field: "channel", value: "email", status: "fail", rows: 20, labeled: 19, automated: 12, coverage: 12 / 19,
    accuracy: 1, accuracy_low: 0.758, accuracy_high: 1 }]);
  assert.equal(bean.calls, 200, "a run sends at most 200 tuning rows");
  assert.equal(bean.report, null);
  assert.equal(bean.tuned_on, null);
  assert.equal(roastery.name, "roastery-orders", "an empty name shows as the id");
  assert.equal(roastery.busy, true);
  assert.equal(roastery.report.status, "error");
  assert.equal(roastery.report.accuracy, null);
  // Never the row inputs, labels or answers of the "Automated but wrong" rows.
  assert.doesNotMatch(JSON.stringify(ctx.items()), /Grinder burr|"wrong"|"mistakes"/);
  assert.ok(ctx.items().every(frozenDeep));
  assert.equal(ctx.items(), ctx.items(), "unchanged state gives the same array");
  assert.equal(ctx.shown()[0], ctx.items()[0], "shown() returns the same objects");
  const before = ctx.items();
  ctx.state.runs["bean-reviews"].running = true;
  assert.notEqual(ctx.items(), before, "a change gives a new list");
  assert.equal(ctx.items()[2].busy, true);
  assert.equal(ctx.itemName(harbor), "harbor-support");
  assert.equal(ctx.actions.replaceItems, undefined, "checks are read-only here");
  assert.equal(ctx.actions.importItems, undefined);
});

test("checks: shown() honors the catalog's filters, then Lab's filters and sort; data counts them", () => {
  const lab = createLab([checksPack]);
  const ctx = sampleChecksListCtx({ lab });
  assert.deepEqual(ids(ctx.shown()), ["harbor-support", "wholesale-leads", "bean-reviews"], "the catalog hides roastery-orders");
  assert.deepEqual(ctx.data, { loaded_id: "wholesale-leads", datasets: 5, hidden_by_catalog: 1, session_spend_usd: 0.0042 + 0.0021 + 0.0011 });
  lab.view(CHECKS_SURFACE).filters = [{ key: "checks-list-essentials/last_status", op: "is", value: "not run" }];
  assert.deepEqual(ids(ctx.shown()), ["bean-reviews"]);
  assert.equal(ctx.page.matches("harbor-support"), false);
  assert.equal(ctx.page.matches("roastery-orders"), false, "Lab reads its own facts; the catalog decides catalog visibility");
  assert.equal(ctx.page.host(), "harbor-support", "the section stays above the first check the catalog shows, even when Lab hides it");
  assert.deepEqual(ctx.page.rank("bean-reviews"), { position: 1, of: 1 });
  assert.equal(ctx.page.rank("harbor-support"), null);
  lab.view(CHECKS_SURFACE).filters = [];
  lab.view(CHECKS_SURFACE).sort = { key: "checks-list-essentials/lowest_threshold", dir: "asc" };
  assert.deepEqual(ids(ctx.shown()), ["wholesale-leads", "harbor-support", "bean-reviews"]);
  assert.deepEqual(ids(ctx.items()), ["harbor-support", "wholesale-leads", "bean-reviews", "roastery-orders"], "sorting never reorders items()");
  lab.reset(CHECKS_SURFACE);
  assert.deepEqual(ids(ctx.shown()), ["harbor-support", "wholesale-leads", "bean-reviews"]);
});

test("checks: the real catalog filters and order feed the surface", () => {
  const datasets = sampleCheckDatasets();
  const filters = { ...catalogDefaults(), query: "leads", sort: "name" };
  const ctx = checksListCtx({ datasets: () => sortedCatalog(datasets, filters.sort, filters.pinnedIds), catalogShown: (x) => matchesCatalog(x, filters),
    runs: () => sampleCheckRuns(), loadedId: () => null });
  // By name: Bean reviews, Harbor support inbox, roastery-orders (no name, so its id), Wholesale leads.
  assert.deepEqual(ids(ctx.items()), ["bean-reviews", "harbor-support", "roastery-orders", "wholesale-leads"], "every check is an item whatever the catalog shows");
  assert.deepEqual(ctx.items().map((item) => item.position), [1, 2, 3, 4]);
  assert.deepEqual(ids(ctx.shown()), ["wholesale-leads"]);
  assert.equal(ctx.page.host(), "wholesale-leads");
  assert.equal(ctx.data.hidden_by_catalog, 3);
});

test("checks: every action keeps its guard and none runs a check (a paid run)", async () => {
  const ctx = sampleChecksListCtx();
  assert.equal("run" in ctx.actions, false, "Run check stays the page's own button");
  assert.throws(() => ctx.actions.open("harbor-support", "mistakes"), /Unknown panel/);
  ctx.actions.open("harbor-support", "drift");
  ctx.actions.open("harbor-support", "queue", false);
  assert.equal(ctx.state.runs["harbor-support"].drift.open, true);
  assert.equal(ctx.state.runs["harbor-support"].queue.open, false);
  ctx.actions.exportGate("roastery-orders");
  assert.throws(() => ctx.actions.goTo("roastery-orders"), /hidden/);
  ctx.actions.goTo("wholesale-leads");
  assert.deepEqual(ctx.log, [["open", "harbor-support", "drift", true], ["open", "harbor-support", "queue", false], ["exportGate", "roastery-orders"], ["goTo", "wholesale-leads"]]);
});

// ---------- workbench.drift.queue ----------

test("drift: items are the queued inputs with human labels only, and data holds no comparison statistics", () => {
  const ctx = sampleDriftQueueCtx();
  assert.deepEqual(lines(ctx.items()), [3, 5, 8, 11, 12]);
  assert.deepEqual(ctx.items()[2], { line: 8, index: 7, position: 3, row: { text: "Photo of my receipt", channel: "chat", _image: "receipt-scan" },
    identity: '{"_image":"receipt-scan","channel":"chat","text":"Photo of my receipt"}', image: "receipt-scan", picture_loaded: true,
    labels: { topic: null, urgent: null, tone: null }, labeled: [], missing: ["topic", "urgent"], ready: false, status: "incomplete", will_add: false });
  assert.deepEqual(ctx.items().map((item) => [item.line, item.ready, item.will_add]), [[3, true, true], [5, false, false], [8, false, false], [11, true, false], [12, false, false]]);
  const data = ctx.data;
  assert.deepEqual({ ...data, questions: data.questions.map((q) => [q.id, q.type, q.gated, q.options.map((o) => o.text)]) }, {
    dataset: { id: "harbor-support", name: "Harbor support inbox" }, busy: false, present: true, open: true, recovered: false,
    questions: [["topic", "choice", true, ["billing", "shipping", "wholesale"]], ["urgent", "noul", true, ["yes", "no"]], ["tone", "score", false, ["0", "1", "2"]]],
    gates: { topic: 0.62, urgent: 0.71 }, counts: { eligible: 8, queued: 5, in_dataset: 2, repeated: 1, unsupported: 0 },
    room: 1, ready: 2, adding: 1, labels: 8, saved: null, session_available: true });
  assert.doesNotMatch(JSON.stringify([ctx.items(), ctx.data]), /accuracy|estimate|share|answers|shift|candidates/);
  assert.ok(ctx.items().every(frozenDeep) && Object.isFrozen(ctx.data));
  assert.equal(ctx.itemName(ctx.items()[0]), "new row 3");
  assert.equal(ctx.actions.importItems, undefined);
  assert.deepEqual(sampleDriftQueueCtx({ labeling: null }).items(), []);
  assert.equal(sampleDriftQueueCtx({ recovered: true }).data.recovered, true);
});

test("drift: shown() is empty while Label new traffic is closed and honors Lab's filters and sort", () => {
  const lab = createLab([driftPack]);
  const ctx = sampleDriftQueueCtx({ lab });
  assert.deepEqual(lines(ctx.shown()), [3, 5, 8, 11, 12]);
  lab.view(DRIFT_SURFACE).filters = [{ key: "drift-queue-essentials/has_picture", op: "with" }];
  assert.deepEqual(lines(ctx.shown()), [8, 11]);
  assert.equal(ctx.page.matches(ctx.state.report.labeling.items[0]), false);
  assert.deepEqual(lines(ctx.page.visible().map((raw) => ({ line: raw.line }))), [8, 11]);
  lab.view(DRIFT_SURFACE).filters = [];
  lab.view(DRIFT_SURFACE).sort = { key: "drift-queue-essentials/labels_chosen", dir: "desc" };
  assert.deepEqual(lines(ctx.shown()), [11, 3, 5, 12, 8]);
  assert.deepEqual(lines(sampleDriftQueueCtx({ lab, open: false }).shown()), []);
});

test("drift: label actions validate options, write only changes and refuse while busy", () => {
  const ctx = sampleDriftQueueCtx();
  assert.throws(() => ctx.actions.setLabel(4, "topic", "billing"), /not in this traffic queue/);
  assert.throws(() => ctx.actions.setLabel(5, "mood", "happy"), /not a question of this queue/);
  assert.throws(() => ctx.actions.setLabel(5, "urgent", "maybe"), /not a label option for urgent \(options: yes, no\)/);
  assert.deepEqual(ctx.actions.setLabel(5, "topic", "billing"), { changed: 0 }, "the same label changes nothing");
  assert.deepEqual(ctx.actions.setLabel(5, "urgent", "yes"), { changed: 1 });
  assert.equal(ctx.state.report.labeling.items[1].labels.urgent, true, "option text is stored as the page stores it");
  ctx.actions.setLabel(5, "tone", "");
  assert.equal(ctx.state.report.labeling.items[1].labels.tone, null);
  assert.equal(ctx.items()[1].ready, true);
  const items = ctx.items();
  const edit = (patch) => items.map((item) => (item.line === 8 ? { ...item, ...patch } : item));
  assert.throws(() => ctx.actions.replaceItems(items.slice(1)), /cannot add or remove/);
  assert.throws(() => ctx.actions.replaceItems([...items].reverse()), /cannot reorder/);
  assert.throws(() => ctx.actions.replaceItems(edit({ row: { text: "Changed", channel: "chat", _image: "receipt-scan" } })), /cannot change the input/);
  assert.throws(() => ctx.actions.replaceItems(edit({ labels: { ...items[2].labels, tone: 7 } })), /not a label option for tone/);
  assert.throws(() => ctx.actions.replaceItems(edit({ labels: "shipping" })), /labels must be an object/);
  const before = ctx.log.length;
  assert.deepEqual(ctx.actions.replaceItems(edit({ labels: { topic: "shipping", urgent: false, tone: null }, ready: "ignored" }), { label: "Fill" }), { changed: 1 });
  assert.deepEqual(ctx.log.slice(before), [["writeLabels", [[8, { topic: "shipping", urgent: false }]], "Fill"]], "only changed labels reach the page");
  assert.deepEqual(ctx.actions.replaceItems(ctx.items()), { changed: 0 });
  assert.throws(() => ctx.actions.goTo(99), /not in this traffic queue/);
  ctx.actions.goTo(8);
  ctx.actions.openLabels(false);
  assert.throws(() => ctx.actions.goTo(8), /not shown/, "a closed queue shows nothing to go to");
  const busy = sampleDriftQueueCtx({ busy: true });
  for (const run of [() => busy.actions.setLabel(5, "urgent", "no"), () => busy.actions.replaceItems(busy.items()), () => busy.actions.openLabels()]) assert.throws(run, /Wait for the traffic operation/);
  assert.throws(() => sampleDriftQueueCtx({ labeling: null }).actions.setLabel(3, "topic", "billing"), /no traffic queue/);
});

// ---------- workbench.review.queue ----------

test("review: blind audit rows keep answers, shortlists and disagreement hidden until their gated labels are set", () => {
  const ctx = sampleReviewQueueCtx();
  assert.deepEqual(lines(ctx.items()), [2, 4, 6, 9, 13, 15]);
  const R = Object.fromEntries(ctx.items().map((item) => [item.line, item]));
  assert.deepEqual(R[9], { line: 9, position: 4, kind: "audit", row: { text: "Love the Sumatra roast", channel: "email" },
    identity: '{"channel":"email","text":"Love the Sumatra roast"}', image: null, picture_loaded: false, verified: true, held: [], rules: [],
    open: ["topic", "urgent", "tone"], labels: { topic: null, urgent: null, tone: null }, edited: [], suggested: [], missing: ["topic", "urgent"],
    ready: false, status: "incomplete", will_add: false, revealed: false, answers: null, candidates: null, disagree: null,
    slice_values: { channel: "email" }, current: false });
  assert.deepEqual([R[15].revealed, R[15].answers, R[15].candidates], [false, null, null], "a partly labeled audit row stays blind");
  assert.deepEqual([R[13].revealed, R[13].answers, R[13].candidates, R[13].disagree], [true, { topic: "beans", urgent: false, tone: 1 }, { topic: ["beans", "wholesale"] }, ["tone"]]);
  assert.deepEqual([R[2].suggested, R[2].edited, R[4].suggested, R[4].edited, R[4].disagree, R[6].verified, R[6].candidates], [["topic"], [], [], ["topic", "urgent"], ["topic"], false, {}]);
  assert.deepEqual([R[4].will_add, R[13].will_add, R[4].current], [true, false, true], "room for 1: the first ready row in queue order");
  assert.doesNotMatch(JSON.stringify(R[9]), /shipping/, "line 9's hidden answer never leaks");
  // Labeling line 9's gated questions reveals it, as the page does.
  ctx.actions.setLabel(9, "topic", "beans");
  assert.equal(ctx.items()[3].revealed, false);
  ctx.actions.setLabel(9, "urgent", "no");
  assert.deepEqual([ctx.items()[3].revealed, ctx.items()[3].answers.topic, ctx.items()[3].disagree], [true, "shipping", ["topic"]]);
  assert.deepEqual(ctx.state.edits[9], Object.assign(Object.create(null), { topic: "beans", urgent: false }), "Lab label changes are recorded as human edits");
  assert.equal(ctx.state.nextLine, 9);
});

test("review: data reports progress and counts without labels or answers", () => {
  const ctx = sampleReviewQueueCtx({ csvPreview: { counts: { matched: 6, changed: 2 } } });
  const data = ctx.data;
  assert.deepEqual({ ...data, questions: data.questions.map((q) => [q.id, q.gated, q.threshold]) }, {
    dataset: { id: "harbor-support", name: "Harbor support inbox" }, busy: false, read: true, text_changed: false,
    filters: { kind: "all", status: "all", slice_field: "", slice_value: "" }, slice_fields: [{ name: "channel", values: ["chat", "email", "phone"] }],
    questions: [["topic", true, 0.62], ["urgent", true, 0.71], ["tone", false, null]], gates: { topic: 0.62, urgent: 0.71 },
    counts: { decisions: 20, review: 5, auto: 15, in_dataset: 1, repeated: 1, unverified: 1, queued: 6, audit: 3, dropped: 0 }, problems_total: 2,
    room: 1, ready: 2, incomplete: 4, adding: 1,
    progress: { topic: { labeled: 4, missing: 2 }, urgent: { labeled: 2, missing: 4 }, tone: { labeled: 1, missing: 5 } },
    edits: { rows: 3, labels: 6 }, session_available: true, csv_preview: { matched: 6, changed: 2 }, audit_requested: 3, next_line: 4 });
  assert.equal(sampleReviewQueueCtx({ textChanged: true }).data.session_available, false);
  assert.equal(sampleReviewQueueCtx({ textChanged: true }).data.text_changed, true);
  assert.deepEqual(sampleReviewQueueCtx({ report: null }).items(), []);
  assert.equal(sampleReviewQueueCtx({ report: null }).data.read, false);
});

test("review: shown() applies the page's kind, status and slice filters, then Lab's; the fallback matches the page's queueVisible", () => {
  const queueVisible = new Function(`${["queueReady", "queueVisible"].map(body).join("\n")}; return queueVisible;`)();
  for (const [kind, status, field, value] of [["all", "all", "", ""], ["audit", "all", "", ""], ["review", "incomplete", "", ""], ["all", "ready", "", ""],
    ["all", "all", "channel", "chat"], ["audit", "incomplete", "channel", "phone"]]) {
    const ctx = sampleReviewQueueCtx({ kind, status, sliceField: field, sliceValue: value });
    const raw = ctx.state.report;
    assert.deepEqual(lines(ctx.shown()), lines(queueVisible(raw.items, raw.gates, kind, status, field, value)), `${kind}/${status}/${field}=${value}`);
  }
  const lab = createLab([reviewPack]);
  const ctx = sampleReviewQueueCtx({ lab, kind: "review" });
  assert.deepEqual(lines(ctx.shown()), [2, 4, 6]);
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-queue-essentials/verified", op: "with" }];
  assert.deepEqual(lines(ctx.shown()), [2, 4]);
  lab.view(REVIEW_SURFACE).sort = { key: "review-queue-essentials/human_edits", dir: "desc" };
  assert.deepEqual(lines(ctx.shown()), [4, 2]);
  assert.deepEqual(lines(ctx.items()), [2, 4, 6, 9, 13, 15], "filters and sorts never change the queue");
  // A Lab filter on a blind fact cannot pick out audit rows by their hidden answers: the fact is unknown there.
  lab.reset(REVIEW_SURFACE);
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-queue-essentials/disagreements", op: "min", value: "0" }];
  assert.deepEqual(lines(sampleReviewQueueCtx({ lab, kind: "audit" }).shown()), [13]);
});

test("review: edits keep lines, kinds and inputs; navigation and filters keep their guards", () => {
  const ctx = sampleReviewQueueCtx();
  const items = ctx.items();
  const edit = (line, patch) => items.map((item) => (item.line === line ? { ...item, ...patch } : item));
  assert.throws(() => ctx.actions.replaceItems(items.slice(0, 5)), /cannot add or remove/);
  assert.throws(() => ctx.actions.replaceItems(edit(9, { kind: "review" })), /audit membership cannot change/);
  assert.throws(() => ctx.actions.replaceItems(edit(9, { row: { text: "Love the Sumatra roast!", channel: "email" } })), /cannot change the input/);
  assert.throws(() => ctx.actions.replaceItems(edit(2, { labels: { ...items[0].labels, mood: "calm" } })), /mood is not a question/);
  assert.throws(() => ctx.actions.replaceItems(edit(2, { labels: { ...items[0].labels, topic: "coffee" } })), /not a label option for topic/);
  assert.deepEqual(ctx.actions.replaceItems(edit(2, { labels: { topic: "shipping", urgent: true, tone: null } }), { label: "Fill" }), { changed: 1 });
  assert.deepEqual(ctx.log.at(-1), ["writeLabels", [[2, { urgent: true }]], "Fill"]);
  assert.deepEqual(lines(ctx.items().filter((item) => item.kind === "audit")), [9, 13, 15], "audit membership is unchanged");
  assert.throws(() => ctx.actions.setKind("blind"), /Unknown row kind/);
  assert.throws(() => ctx.actions.setStatus("done"), /Unknown labeling status/);
  assert.throws(() => ctx.actions.setSlice("text"), /not an input slice/);
  assert.throws(() => ctx.actions.setSlice("channel", "fax"), /not a value of channel/);
  ctx.actions.setSlice("channel");
  assert.deepEqual(ctx.data.filters, { kind: "all", status: "all", slice_field: "channel", slice_value: "chat" }, "the field's first value by default");
  assert.deepEqual(lines(ctx.shown()), [4, 6]);
  assert.throws(() => ctx.actions.goTo(2), /hidden by the current filters/);
  ctx.actions.goTo(6);
  ctx.actions.setKind("audit");
  assert.throws(() => ctx.actions.next(), /No incomplete row/, "no chat audit row");
  ctx.actions.resetFilters();
  assert.deepEqual(ctx.data.filters, { kind: "all", status: "all", slice_field: "", slice_value: "" });
  assert.throws(() => ctx.actions.next(2), /next \(1\) or previous \(-1\)/);
  ctx.actions.next(1);
  assert.equal(ctx.state.statusFilter, "incomplete");
  const busy = sampleReviewQueueCtx({ busy: true });
  for (const run of [() => busy.actions.setLabel(2, "urgent", "yes"), () => busy.actions.replaceItems(busy.items()), () => busy.actions.next(), () => busy.actions.setKind("all")]) {
    assert.throws(run, /Wait for the Review operation/);
  }
  busy.actions.resetFilters();
  assert.throws(() => sampleReviewQueueCtx({ report: null }).actions.setLabel(2, "topic", "billing"), /Read the gate's decisions first/);
});

// ---------- the page hooks ----------

const QUEUE_VIEW = ["queueView", "queueReady", "queueVisible", "queueNextIncomplete", "queueSelect", "queueClasses", "shownAnswer", "labelText", "labelValue", "queueSliceControls"];
function reviewView(W) {
  return new Function("W", "h", "icon", "rowText", "queueCsv", "render", "nextQueueRow", "addQueued", `${QUEUE_VIEW.map(body).join("\n")}; return queueView;`)(
    W, h, () => "", (row) => row.text, () => null, () => {}, () => {}, () => {});
}
const cards = (tree, prefix) => findAll(tree, (node) => typeof node.attrs?.id === "string" && node.attrs.id.startsWith(prefix)).map((node) => Number(node.attrs.id.slice(prefix.length)));

test("hook: queueView shows exactly the page's rows without Lab, and Lab's filtered, sorted rows with its section and reset", () => {
  const lab = createLab([reviewPack]);
  const ctx = sampleReviewQueueCtx({ lab });
  const W = { bulk: { pictures: {} }, lab, labEnv: fakeEnv() };
  const view = reviewView(W);
  const x = { id: "harbor-support", name: "Harbor support inbox" };
  const plain = reviewView({ bulk: { pictures: {} } })(x, ctx.state);
  const hooked = view(x, ctx.state, ctx);
  assert.deepEqual(cards(plain, "queue-harbor-support-"), [2, 4, 6, 9, 13, 15]);
  assert.deepEqual(cards(hooked, "queue-harbor-support-"), [2, 4, 6, 9, 13, 15], "no Lab setting: the same rows in the same order");
  assert.ok(findAll(hooked, (node) => node.attrs?.["data-lab-surface"] === REVIEW_SURFACE).length === 1, "the Lab section renders beside the filters");
  assert.doesNotMatch(textOf(hooked), /Lab setting/);
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-queue-essentials/queue_reason", op: "is", value: "audit sample" }];
  lab.view(REVIEW_SURFACE).sort = { key: "review-queue-essentials/human_edits", dir: "desc" };
  const filtered = view(x, ctx.state, ctx);
  assert.deepEqual(cards(filtered, "queue-harbor-support-"), [13, 15, 9]);
  assert.match(textOf(filtered), /2 of 6 rows ready · 4 incomplete · showing 3/);
  assert.match(textOf(filtered), /Showing 3 of 6 rows the queue filters leave · 2 Lab settings active/);
  assert.match(textOf(filtered), /Add 1 of 2 labeled rows/, "Add still counts every ready row");
  assert.doesNotMatch(textOf(filtered), /gate: shipping|Suggested shortlist: shipping\./, "blind audit rows stay blind");
  const reset = findAll(filtered, (node) => node.tag === "button" && textOf(node).includes("Clear Lab filters and sort"))[0];
  reset.attrs.onclick();
  assert.equal(lab.active(REVIEW_SURFACE), 0);
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-queue-essentials/verified", op: "without" }];
  ctx.state.kindFilter = "audit";
  const none = view(x, ctx.state, ctx);
  assert.deepEqual(cards(none, "queue-harbor-support-"), []);
  assert.match(textOf(none), /No row matches the Lab filters/);
});

test("hook: Next incomplete row skips the rows Lab hides, in queue order", () => {
  const lab = createLab([reviewPack]);
  const ctx = sampleReviewQueueCtx({ lab });
  const calls = [];
  const document = { getElementById: (id) => { calls.push(id); return null; } };
  const W = { bulk: { checkRuns: { "harbor-support": { queue: ctx.state } } }, lab, checkLabs: { review: { "harbor-support": ctx } } };
  const next = new Function("W", "document", "render", `${["queueReady", "queueNextIncomplete", "nextQueueRow"].map(body).join("\n")}; return nextQueueRow;`)(W, document, () => {});
  next("harbor-support");
  assert.equal(ctx.state.nextLine, 6, "without Lab: the next incomplete row after line 4");
  ctx.state.nextLine = 4;
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-queue-essentials/queue_reason", op: "is", value: "audit sample" }];
  next("harbor-support");
  assert.equal(ctx.state.nextLine, 9, "with Lab: the first incomplete audit row");
  next("harbor-support");
  assert.equal(ctx.state.nextLine, 15);
  assert.deepEqual(calls, ["queue-harbor-support-6", "queue-harbor-support-9", "queue-harbor-support-15"]);
  assert.deepEqual(lines(ctx.items()), [2, 4, 6, 9, 13, 15]);
});

test("hook: driftLabels draws Lab's rows and section while Add keeps counting every ready row", () => {
  const lab = createLab([driftPack]);
  const ctx = sampleDriftQueueCtx({ lab });
  const funcs = ["driftLabels", "agreeQuestions", "rowText", "queueClasses", "queueReady", "queueSelect", "labelText", "labelValue"].map(body).join("\n");
  const make = (W) => new Function("W", "h", "photoView", "stringify", "icon", "render", "runCheck", `${funcs}; return driftLabels;`)(
    W, h, () => h("img", {}), String, () => "", () => {}, () => {});
  const x = { id: "harbor-support", name: "Harbor support inbox", rows: 48, test: { rows: 8 } };
  const run = { drift: ctx.state, upgrade: {} };
  const plain = make({ bulk: { pictures: {} } })(x, run);
  const view = make({ bulk: { pictures: {} }, lab, labEnv: fakeEnv() });
  assert.deepEqual(cards(plain, "drift-harbor-support-"), [3, 5, 8, 11, 12]);
  const hooked = view(x, run, ctx);
  assert.deepEqual(cards(hooked, "drift-harbor-support-"), [3, 5, 8, 11, 12]);
  assert.equal(findAll(hooked, (node) => node.attrs?.["data-lab-surface"] === DRIFT_SURFACE).length, 1);
  lab.view(DRIFT_SURFACE).filters = [{ key: "drift-queue-essentials/status", op: "is", value: "incomplete" }];
  const filtered = view(x, run, ctx);
  assert.deepEqual(cards(filtered, "drift-harbor-support-"), [5, 8, 12]);
  assert.match(textOf(filtered), /Showing 3 of 5 queued rows · 1 Lab setting active/);
  assert.match(textOf(filtered), /Add 1 labeled row/, "Add takes ready rows the filter hides");
  assert.doesNotMatch(textOf(filtered), /Suggested|gate:|estimated|accuracy when/, "no answers or statistics in the traffic queue");
  ctx.state.labelsOpen = false;
  const closed = view(x, run, ctx);
  assert.deepEqual(cards(closed, "drift-harbor-support-"), []);
  assert.equal(findAll(closed, (node) => node.attrs?.["data-lab-surface"]).length, 0, "no section while the queue is closed");
});

test("hook: checkItem hides a check Lab filters out (kept mounted), numbers the Lab order and puts the section above the first check", () => {
  const lab = createLab([checksPack]);
  const ctx = sampleChecksListCtx({ lab });
  const names = ["W", "h", "icon", "loadModels", "estimateLine", "api", "render", "exportGate", "removeCheck", "runCheck", "pct", "attachedSetsText", "checkReport",
    "upgradeForm", "upgradeReport", "driftForm", "driftReport", "driftQueueLab", "queueForm", "queueView", "reviewQueueLab", "auditReport", "newQueue", "checksListLab"];
  const make = (W, listLab) => new Function(...names, `${["checkItem", "checkTargetsText", "checksLabNote"].map(body).join("\n")}; return checkItem;`)(
    W, h, () => "", () => {}, () => null, {}, () => {}, () => {}, () => {}, () => {}, (v) => `${Math.round(v * 100)}%`, () => "", () => null,
    () => null, () => null, () => null, () => null, () => null, () => null, () => null, () => null, () => null, () => ({}), () => listLab);
  const W = { bulk: { checkRuns: ctx.state.runs }, lab, labEnv: fakeEnv() };
  const [harbor, wholesale] = sampleCheckDatasets();
  const plain = make({ bulk: { checkRuns: sampleCheckRuns() } }, null)(harbor);
  assert.equal(plain.attrs.class, "check-item", "without Lab: the check block alone, as before");
  assert.equal(plain.attrs.style.display, "");
  const view = make(W, ctx);
  let host = view(harbor), other = view(wholesale);
  assert.equal(host[0].attrs["data-lab-surface"], CHECKS_SURFACE, "the section sits above the first check the catalog shows");
  assert.equal(other[0], null);
  assert.equal(host[3].attrs.style.display, "");
  assert.equal(host[2].attrs.hidden, true, "no hidden-check note without a Lab filter");
  assert.equal(findAll(host[3], (node) => node.attrs?.id === "check-rank-harbor-support")[0].attrs.hidden, true);
  lab.view(CHECKS_SURFACE).filters = [{ key: "checks-list-essentials/last_status", op: "is", value: "passed" }];
  host = view(harbor); other = view(wholesale);
  assert.equal(host[3].attrs.style.display, "none", "hidden, still mounted");
  assert.equal(host[2].attrs.hidden, false);
  assert.match(textOf(host[2]), /hidden by Lab filters on saved checks. Its queues and labels are kept/);
  assert.match(textOf(host[1]), /1 Lab setting active: 1 of 4 saved checks shown/);
  assert.equal(other[3].attrs.style.display, "");
  assert.match(textOf(findAll(other[3], (node) => node.attrs?.id === "check-rank-wholesale-leads")[0]), /Lab order 1 of 1/);
  assert.match(textOf(host[3]), /Run check · 40 calls/, "the hidden block keeps its controls");
});
