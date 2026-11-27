// The Workbench Review queue Lab surface: the builder (static/js/lab/surfaces/workbench-checks.js) and the hooks in
// static/js/workbench-review.js, rebuilt from the page's source the way the page's own tests do
// (tests/js/review-navigation.test.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { workbenchSource } from "../workbench-source.mjs";
import { probePack } from "./fixture-pack.mjs";
import { fakeEnv } from "./harness.mjs";
import { REVIEW_SURFACE, sampleReviewQueueCtx } from "./fixtures/workbench-checks.mjs";

const body = (name) =>
  workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const lines = (list) => list.map((item) => item.line);
const frozenDeep = (value) =>
  !value || typeof value !== "object" || (Object.isFrozen(value) && Object.values(value).every(frozenDeep));
const reviewPack = probePack("review-probe", REVIEW_SURFACE, {
  verified: ["flag", (item) => item.verified],
  human_edits: ["number", (item) => item.edited.length],
  disagreements: ["number", (item) => item.disagree?.length ?? null],
  queue_kind: ["category", (item) => item.kind],
});

// A stand-in for common.js h(): plain nodes that also take addEventListener, as the page's own tests use.
function h(tag, attrs, ...children) {
  return {
    tag,
    attrs: attrs || {},
    children: children.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false),
    addEventListener() {},
  };
}
const textOf = (node) =>
  node && typeof node === "object"
    ? (node.children || []).map(textOf).join(" ")
    : node === null || node === undefined
      ? ""
      : String(node);
const all = (node) => (node && typeof node === "object" ? [node, ...(node.children || []).flatMap(all)] : []);
const findAll = (node, match) => (Array.isArray(node) ? node.flatMap((entry) => all(entry)) : all(node)).filter(match);

// ---------- workbench.review.queue ----------

test("review: blind audit rows keep answers, shortlists and disagreement hidden until their gated labels are set", () => {
  const ctx = sampleReviewQueueCtx();
  assert.deepEqual(lines(ctx.items()), [2, 4, 6, 9, 13, 15]);
  const R = Object.fromEntries(ctx.items().map((item) => [item.line, item]));
  assert.deepEqual(R[9], {
    line: 9,
    position: 4,
    kind: "audit",
    row: { text: "Love the Sumatra roast", channel: "email" },
    identity: '{"channel":"email","text":"Love the Sumatra roast"}',
    image: null,
    picture_loaded: false,
    verified: true,
    held: [],
    rules: [],
    open: ["topic", "urgent", "tone"],
    labels: { topic: null, urgent: null, tone: null },
    edited: [],
    suggested: [],
    missing: ["topic", "urgent"],
    ready: false,
    status: "incomplete",
    will_add: false,
    revealed: false,
    answers: null,
    candidates: null,
    disagree: null,
    slice_values: { channel: "email" },
    current: false,
  });
  assert.deepEqual(
    [R[15].revealed, R[15].answers, R[15].candidates],
    [false, null, null],
    "a partly labeled audit row stays blind",
  );
  assert.deepEqual(
    [R[13].revealed, R[13].answers, R[13].candidates, R[13].disagree],
    [true, { topic: "beans", urgent: false, tone: 1 }, { topic: ["beans", "wholesale"] }, ["tone"]],
  );
  assert.deepEqual(
    [R[2].suggested, R[2].edited, R[4].suggested, R[4].edited, R[4].disagree, R[6].verified, R[6].candidates],
    [["topic"], [], [], ["topic", "urgent"], ["topic"], false, {}],
  );
  assert.deepEqual(
    [R[4].will_add, R[13].will_add, R[4].current],
    [true, false, true],
    "room for 1: the first ready row in queue order",
  );
  assert.doesNotMatch(JSON.stringify(R[9]), /shipping/, "line 9's hidden answer never leaks");
  // Labeling line 9's gated questions reveals it, as the page does.
  ctx.actions.setLabel(9, "topic", "beans");
  assert.equal(ctx.items()[3].revealed, false);
  ctx.actions.setLabel(9, "urgent", "no");
  assert.deepEqual(
    [ctx.items()[3].revealed, ctx.items()[3].answers.topic, ctx.items()[3].disagree],
    [true, "shipping", ["topic"]],
  );
  assert.deepEqual(
    ctx.state.edits[9],
    Object.assign(Object.create(null), { topic: "beans", urgent: false }),
    "Lab label changes are recorded as human edits",
  );
  assert.equal(ctx.state.nextLine, 9);
});

test("review: data reports progress and counts without labels or answers", () => {
  const ctx = sampleReviewQueueCtx({ csvPreview: { counts: { matched: 6, changed: 2 } } });
  const data = ctx.data;
  assert.deepEqual(
    { ...data, questions: data.questions.map((q) => [q.id, q.gated, q.threshold]) },
    {
      dataset: { id: "harbor-support", name: "Harbor support inbox" },
      busy: false,
      read: true,
      text_changed: false,
      filters: { kind: "all", status: "all", slice_field: "", slice_value: "" },
      slice_fields: [{ name: "channel", values: ["chat", "email", "phone"] }],
      questions: [
        ["topic", true, 0.62],
        ["urgent", true, 0.71],
        ["tone", false, null],
      ],
      gates: { topic: 0.62, urgent: 0.71 },
      counts: {
        decisions: 20,
        review: 5,
        auto: 15,
        in_dataset: 1,
        repeated: 1,
        unverified: 1,
        queued: 6,
        audit: 3,
        dropped: 0,
      },
      problems_total: 2,
      room: 1,
      ready: 2,
      incomplete: 4,
      adding: 1,
      progress: {
        topic: { labeled: 4, missing: 2 },
        urgent: { labeled: 2, missing: 4 },
        tone: { labeled: 1, missing: 5 },
      },
      edits: { rows: 3, labels: 6 },
      session_available: true,
      csv_preview: { matched: 6, changed: 2 },
      audit_requested: 3,
      next_line: 4,
    },
  );
  assert.equal(sampleReviewQueueCtx({ textChanged: true }).data.session_available, false);
  assert.equal(sampleReviewQueueCtx({ textChanged: true }).data.text_changed, true);
  assert.deepEqual(sampleReviewQueueCtx({ report: null }).items(), []);
  assert.equal(sampleReviewQueueCtx({ report: null }).data.read, false);
});

test("review: shown() applies the page's kind, status and slice filters, then Lab's; the fallback matches the page's queueVisible", () => {
  const queueVisible = new Function(`${["queueReady", "queueVisible"].map(body).join("\n")}; return queueVisible;`)();
  for (const [kind, status, field, value] of [
    ["all", "all", "", ""],
    ["audit", "all", "", ""],
    ["review", "incomplete", "", ""],
    ["all", "ready", "", ""],
    ["all", "all", "channel", "chat"],
    ["audit", "incomplete", "channel", "phone"],
  ]) {
    const ctx = sampleReviewQueueCtx({ kind, status, sliceField: field, sliceValue: value });
    const raw = ctx.state.report;
    assert.deepEqual(
      lines(ctx.shown()),
      lines(queueVisible(raw.items, raw.gates, kind, status, field, value)),
      `${kind}/${status}/${field}=${value}`,
    );
  }
  const lab = createLab([reviewPack]);
  const ctx = sampleReviewQueueCtx({ lab, kind: "review" });
  assert.deepEqual(lines(ctx.shown()), [2, 4, 6]);
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-probe/verified", op: "with" }];
  assert.deepEqual(lines(ctx.shown()), [2, 4]);
  lab.view(REVIEW_SURFACE).sort = { key: "review-probe/human_edits", dir: "desc" };
  assert.deepEqual(lines(ctx.shown()), [4, 2]);
  assert.deepEqual(lines(ctx.items()), [2, 4, 6, 9, 13, 15], "filters and sorts never change the queue");
  // A Lab filter on a blind fact cannot pick out audit rows by their hidden answers: the fact is unknown there.
  lab.reset(REVIEW_SURFACE);
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-probe/disagreements", op: "min", value: "0" }];
  assert.deepEqual(lines(sampleReviewQueueCtx({ lab, kind: "audit" }).shown()), [13]);
});

test("review: edits keep lines, kinds and inputs; navigation and filters keep their guards", () => {
  const ctx = sampleReviewQueueCtx();
  const items = ctx.items();
  const edit = (line, patch) => items.map((item) => (item.line === line ? { ...item, ...patch } : item));
  assert.throws(() => ctx.actions.replaceItems(items.slice(0, 5)), /cannot add or remove/);
  assert.throws(() => ctx.actions.replaceItems(edit(9, { kind: "review" })), /audit membership cannot change/);
  assert.throws(
    () => ctx.actions.replaceItems(edit(9, { row: { text: "Love the Sumatra roast!", channel: "email" } })),
    /cannot change the input/,
  );
  assert.throws(
    () => ctx.actions.replaceItems(edit(2, { labels: { ...items[0].labels, mood: "calm" } })),
    /mood is not a question/,
  );
  assert.throws(
    () => ctx.actions.replaceItems(edit(2, { labels: { ...items[0].labels, topic: "coffee" } })),
    /not a label option for topic/,
  );
  assert.deepEqual(
    ctx.actions.replaceItems(edit(2, { labels: { topic: "shipping", urgent: true, tone: null } }), { label: "Fill" }),
    { changed: 1 },
  );
  assert.deepEqual(ctx.log.at(-1), ["writeLabels", [[2, { urgent: true }]], "Fill"]);
  assert.deepEqual(
    lines(ctx.items().filter((item) => item.kind === "audit")),
    [9, 13, 15],
    "audit membership is unchanged",
  );
  assert.throws(() => ctx.actions.setKind("blind"), /Unknown row kind/);
  assert.throws(() => ctx.actions.setStatus("done"), /Unknown labeling status/);
  assert.throws(() => ctx.actions.setSlice("text"), /not an input slice/);
  assert.throws(() => ctx.actions.setSlice("channel", "fax"), /not a value of channel/);
  ctx.actions.setSlice("channel");
  assert.deepEqual(
    ctx.data.filters,
    { kind: "all", status: "all", slice_field: "channel", slice_value: "chat" },
    "the field's first value by default",
  );
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
  for (const run of [
    () => busy.actions.setLabel(2, "urgent", "yes"),
    () => busy.actions.replaceItems(busy.items()),
    () => busy.actions.next(),
    () => busy.actions.setKind("all"),
  ]) {
    assert.throws(run, /Wait for the Review operation/);
  }
  busy.actions.resetFilters();
  assert.throws(
    () => sampleReviewQueueCtx({ report: null }).actions.setLabel(2, "topic", "billing"),
    /Read the gate's decisions first/,
  );
});

// ---------- the page hooks ----------

const QUEUE_VIEW = [
  "queueView",
  "queueReady",
  "queueVisible",
  "queueNextIncomplete",
  "queueSelect",
  "queueClasses",
  "shownAnswer",
  "labelText",
  "labelValue",
  "queueSliceControls",
];
function reviewView(W) {
  return new Function(
    "W",
    "h",
    "icon",
    "rowText",
    "queueCsv",
    "render",
    "nextQueueRow",
    "addQueued",
    `${QUEUE_VIEW.map(body).join("\n")}; return queueView;`,
  )(
    W,
    h,
    () => "",
    (row) => row.text,
    () => null,
    () => {},
    () => {},
    () => {},
  );
}
const cards = (tree, prefix) =>
  findAll(tree, (node) => typeof node.attrs?.id === "string" && node.attrs.id.startsWith(prefix)).map((node) =>
    Number(node.attrs.id.slice(prefix.length)),
  );

test("hook: queueView shows exactly the page's rows without Lab, and Lab's filtered, sorted rows with its section and reset", () => {
  const lab = createLab([reviewPack]);
  const ctx = sampleReviewQueueCtx({ lab });
  const W = { bulk: { pictures: {} }, lab, labEnv: fakeEnv() };
  const view = reviewView(W);
  const x = { id: "harbor-support", name: "Harbor support inbox" };
  const plain = reviewView({ bulk: { pictures: {} } })(x, ctx.state);
  const hooked = view(x, ctx.state, ctx);
  assert.deepEqual(cards(plain, "queue-harbor-support-"), [2, 4, 6, 9, 13, 15]);
  assert.deepEqual(
    cards(hooked, "queue-harbor-support-"),
    [2, 4, 6, 9, 13, 15],
    "no Lab setting: the same rows in the same order",
  );
  assert.ok(
    findAll(hooked, (node) => node.attrs?.["data-lab-surface"] === REVIEW_SURFACE).length === 1,
    "the Lab section renders beside the filters",
  );
  assert.doesNotMatch(textOf(hooked), /Lab setting/);
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-probe/queue_kind", op: "is", value: "audit" }];
  lab.view(REVIEW_SURFACE).sort = { key: "review-probe/human_edits", dir: "desc" };
  const filtered = view(x, ctx.state, ctx);
  assert.deepEqual(cards(filtered, "queue-harbor-support-"), [13, 15, 9]);
  assert.match(textOf(filtered), /2 of 6 rows ready · 4 incomplete · showing 3/);
  assert.match(textOf(filtered), /Showing 3 of 6 rows the queue filters leave · 2 Lab settings active/);
  assert.match(textOf(filtered), /Add 1 of 2 labeled rows/, "Add still counts every ready row");
  assert.doesNotMatch(
    textOf(filtered),
    /gate: shipping|Suggested shortlist: shipping\./,
    "blind audit rows stay blind",
  );
  const reset = findAll(
    filtered,
    (node) => node.tag === "button" && textOf(node).includes("Clear Lab filters and sort"),
  )[0];
  reset.attrs.onclick();
  assert.equal(lab.active(REVIEW_SURFACE), 0);
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-probe/verified", op: "without" }];
  ctx.state.kindFilter = "audit";
  const none = view(x, ctx.state, ctx);
  assert.deepEqual(cards(none, "queue-harbor-support-"), []);
  assert.match(textOf(none), /No row matches the Lab filters/);
});

test("hook: Next incomplete row skips the rows Lab hides, in queue order", () => {
  const lab = createLab([reviewPack]);
  const ctx = sampleReviewQueueCtx({ lab });
  const calls = [];
  const document = {
    getElementById: (id) => {
      calls.push(id);
      return null;
    },
  };
  const W = {
    bulk: { checkRuns: { "harbor-support": { queue: ctx.state } } },
    lab,
    checkLabs: { review: { "harbor-support": ctx } },
  };
  const next = new Function(
    "W",
    "document",
    "render",
    `${["queueReady", "queueNextIncomplete", "nextQueueRow"].map(body).join("\n")}; return nextQueueRow;`,
  )(W, document, () => {});
  next("harbor-support");
  assert.equal(ctx.state.nextLine, 6, "without Lab: the next incomplete row after line 4");
  ctx.state.nextLine = 4;
  lab.view(REVIEW_SURFACE).filters = [{ key: "review-probe/queue_kind", op: "is", value: "audit" }];
  next("harbor-support");
  assert.equal(ctx.state.nextLine, 9, "with Lab: the first incomplete audit row");
  next("harbor-support");
  assert.equal(ctx.state.nextLine, 15);
  assert.deepEqual(calls, ["queue-harbor-support-6", "queue-harbor-support-9", "queue-harbor-support-15"]);
  assert.deepEqual(lines(ctx.items()), [2, 4, 6, 9, 13, 15]);
});
