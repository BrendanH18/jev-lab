// Tests for static/js/lab/packs/workbench/review-panels.js on the Review queue fixture
// (tests/js/lab/fixtures/workbench-checks.mjs). Reference values are worked out by hand from the fixture header:
//   line 2 review held urgent, topic shipping (gate suggestion), incomplete      reason "held"
//   line 4 review broke a rule, topic billing + urgent yes (yours), READY, in the next Add   reason "broke a rule"
//   line 6 review held topic, no labels, incomplete                               reason "held"
//   line 9 audit, nothing labeled (blind); line 13 audit topic beans / urgent no / tone 2 (yours) READY;
//   line 15 audit topic shipping (yours), incomplete (blind). Room 1, audit asked 3.
// Worst-case 95% margins are 0.98 / √n: n = 1 → 0.98, n = 3 → 0.565803 (±56.6 points); rows for ±m points are
// ⌈(0.98 / m)²⌉: ±10 → ⌈96.04⌉ = 97, ±20 → ⌈24.01⌉ = 25.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/review-panels.js";
import { approx, checkPack } from "./harness.mjs";
import { REVIEW_QUESTIONS, sampleReviewItemsRaw, sampleReviewQueueCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides = {}) => sampleReviewQueueCtx(overrides);
const empty = () => sampleReviewQueueCtx({ report: null });
const byAttr = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const cells = (t, row) => row.children.filter((child) => child && child.tag === "td").map(t.textOf);
const rowOf = (t, tree, name, value) => cells(t, byAttr(t, tree, name, value));
const tableKeys = (t, tree, table, name) => t.findAll(byAttr(t, tree, "data-table", table), (node) => node.tag === "tr" && node.attrs[name] !== undefined)
  .map((node) => node.attrs[name]);

const PROVENANCE = { version: 1, questions: "sha256:harbor-q", model: "jev-1.2", gates: { topic: 0.62, urgent: 0.71 } };
const raw = (line, kind, row, labels, answers) => ({ line, kind, route: kind === "audit" ? "auto" : "review", provenance: structuredClone(PROVENANCE),
  row, held: kind === "review" ? ["topic"] : [], rules: [], open: kind === "review" ? ["topic"] : ["topic", "urgent", "tone"], answers,
  labels: { topic: null, urgent: null, tone: null, ...labels }, slice_values: { channel: row.channel || "web" } });
const edit = (labels) => Object.assign(Object.create(null), labels);

// Copies: lines 3, 8 and 11 share one input (11 is a blind audit row); 12 has the same text on another channel;
// 20 and 21 share another input. Yours: 3 topic + urgent, 8 topic, 20 topic; the rest are the gate's suggestions
// (8 urgent yes, 12 topic + urgent, 20 urgent, 21 topic).
const ORDER = { text: "Where is my order?", channel: "email" };
const STALE = { text: "Beans arrived stale" };
const copiesCtx = () => sampleReviewQueueCtx({
  items: [
    raw(3, "review", { ...ORDER }, { topic: "shipping", urgent: false }, { topic: "shipping", urgent: false, tone: 1 }),
    raw(8, "review", { ...ORDER }, { topic: "billing", urgent: true }, { topic: "billing", urgent: true, tone: 0 }),
    raw(11, "audit", { ...ORDER }, {}, { topic: "shipping", urgent: false, tone: 1 }),
    raw(12, "review", { ...ORDER, channel: "chat" }, { topic: "shipping", urgent: false }, { topic: "shipping", urgent: false, tone: 2 }),
    raw(20, "review", { ...STALE }, { topic: "beans", urgent: false }, { topic: "beans", urgent: false, tone: 0 }),
    raw(21, "review", { ...STALE }, { topic: "beans" }, { topic: "beans", urgent: true, tone: 0 }),
  ],
  edits: { 3: edit({ topic: "shipping", urgent: false }), 8: edit({ topic: "billing" }), 20: edit({ topic: "beans" }) },
});
// Five review rows of yours on topic: four billing, one shipping (80% billing).
const lopsidedCtx = () => sampleReviewQueueCtx({
  items: [30, 31, 32, 33, 34].map((line, index) => raw(line, "review", { text: `Order ${line}` }, { topic: index === 4 ? "shipping" : "billing" }, { topic: "billing", urgent: false, tone: 1 })),
  edits: Object.fromEntries([30, 31, 32, 33, 34].map((line, index) => [line, edit({ topic: index === 4 ? "shipping" : "billing" })])),
});
// The fixture with line 13's labels cleared: no audit row is labeled.
const noAuditLabelsCtx = () => {
  const items = sampleReviewItemsRaw().map((item) => (item.line === 13 ? { ...item, labels: { topic: null, urgent: null, tone: null } } : item));
  return sampleReviewQueueCtx({ items, edits: { 4: edit({ topic: "billing", urgent: true }), 15: edit({ topic: "shipping" }) } });
};

checkPack(pack, {
  reasons: { improvements: {
    table: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(tableKeys(t, tree, "reasons", "data-reason"), ["held", "broke a rule", "audit sample", "all"]);
      assert.deepEqual(rowOf(t, tree, "data-reason", "held").slice(0, 6), ["held", "2", "0", "2", "0", "0.0%"]);
      assert.deepEqual(rowOf(t, tree, "data-reason", "broke a rule").slice(0, 6), ["broke a rule", "1", "1", "0", "1", "100.0%"]);
      assert.deepEqual(rowOf(t, tree, "data-reason", "audit sample").slice(0, 6), ["audit sample", "3", "1", "2", "0", "33.3%"]);
      assert.deepEqual(rowOf(t, tree, "data-reason", "all").slice(0, 6), ["all", "6", "2", "4", "1", "33.3%"]);
      assert.match(t.textOf(t.render(empty())), /Read the gate's decisions first/);
    },
    scope: (t) => {
      const page = ctx({ kind: "review" });
      let tree = t.render(page);
      assert.deepEqual(rowOf(t, tree, "data-reason", "all").slice(0, 6), ["all", "6", "2", "4", "1", "33.3%"], "the whole queue by default");
      t.fire(byAttr(t, tree, "data-action", "reason-scope"), "click");
      tree = t.render(page);
      // Shown under "Review rows": lines 2, 4, 6.
      assert.deepEqual(tableKeys(t, tree, "reasons", "data-reason"), ["held", "broke a rule", "all"]);
      assert.deepEqual(rowOf(t, tree, "data-reason", "all").slice(0, 6), ["all", "3", "1", "2", "1", "33.3%"]);
      assert.match(t.textOf(byAttr(t, tree, "data-action", "reason-scope")), /shown rows/);
    },
    go_incomplete: (t) => {
      const page = ctx();
      const tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-go-reason", "broke a rule"), null, "no incomplete row has that reason");
      assert.match(t.textOf(byAttr(t, tree, "data-go-reason", "audit sample")), /line 9/);
      t.fire(byAttr(t, tree, "data-go-reason", "held"), "click");
      assert.deepEqual(page.log, [["goTo", 2]]);
      const busy = ctx({ busy: true });
      const button = byAttr(t, t.render(busy), "data-go-reason", "held");
      assert.equal(button.attrs.disabled, true);
      t.fire(button, "click");
      assert.deepEqual(busy.log, []);
      assert.equal(t.env.toasts.at(-1).kind, "error");
      assert.match(t.env.toasts.at(-1).message, /Wait for the Review operation/);
    },
    copy: (t) => {
      t.fire(byAttr(t, t.render(ctx()), "data-action", "reason-copy"), "click");
      const text = t.env.copied[0];
      assert.match(text, /whole queue; counts only/);
      for (const line of ["| held | 2 | 0 | 2 | 0 | 0.0% |", "| audit sample | 3 | 1 | 2 | 0 | 33.3% |", "| all | 6 | 2 | 4 | 1 | 33.3% |"]) assert.ok(text.includes(line), line);
      for (const secret of ["grinder", "shipping", "billing", "Sumatra"]) assert.ok(!text.includes(secret), `no inputs or labels: ${secret}`);
    },
  } },

  questions: { improvements: {
    table: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(tableKeys(t, tree, "questions", "data-question"), ["topic", "urgent", "tone"]);
      assert.deepEqual(rowOf(t, tree, "data-question", "topic").slice(0, 7), ["topic", "≥ 0.62", "4", "2", "3", "1", "66.7%"]);
      assert.deepEqual(rowOf(t, tree, "data-question", "urgent").slice(0, 7), ["urgent", "≥ 0.71", "2", "4", "2", "0", "33.3%"]);
      assert.deepEqual(rowOf(t, tree, "data-question", "tone").slice(0, 7), ["tone", "not gated", "1", "5", "1", "0", "16.7%"]);
    },
    kind: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "question-kind"), "change", { target: { value: "audit" } });
      let tree = t.render(page);
      assert.deepEqual(rowOf(t, tree, "data-question", "topic").slice(2, 7), ["2", "1", "2", "0", "66.7%"]);
      assert.deepEqual(rowOf(t, tree, "data-question", "urgent").slice(2, 7), ["1", "2", "1", "0", "33.3%"]);
      t.fire(byAttr(t, tree, "data-action", "question-kind"), "change", { target: { value: "review" } });
      tree = t.render(page);
      assert.deepEqual(rowOf(t, tree, "data-question", "topic").slice(2, 7), ["2", "1", "1", "1", "66.7%"]);
      assert.deepEqual(rowOf(t, tree, "data-question", "tone").slice(2, 7), ["0", "3", "0", "0", "0.0%"]);
      assert.deepEqual(page.log, [], "a panel switch, not the page's filter");
    },
    gated_only: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "gated-only"), "click");
      assert.deepEqual(tableKeys(t, t.render(page), "questions", "data-question"), ["topic", "urgent"]);
    },
    missing_first: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "missing-first"), "click");
      assert.deepEqual(tableKeys(t, t.render(page), "questions", "data-question"), ["tone", "urgent", "topic"]);
    },
    go_missing: (t) => {
      const page = ctx();
      const tree = t.render(page);
      assert.match(t.textOf(byAttr(t, tree, "data-go-question", "topic")), /line 6/);
      t.fire(byAttr(t, tree, "data-go-question", "urgent"), "click");
      assert.deepEqual(page.log, [["goTo", 2]]);
      const audits = ctx({ kind: "audit" });
      t.fire(byAttr(t, t.render(audits), "data-go-question", "urgent"), "click");
      assert.deepEqual(audits.log, [["goTo", 9]], "the first SHOWN row without it");
    },
  } },

  audit: { improvements: {
    counts: (t) => {
      const tree = t.render(ctx());
      const count = (name) => t.textOf(byAttr(t, tree, "data-count", name));
      assert.equal(count("asked"), "Asked for: 3");
      assert.equal(count("queued"), "Queued: 3");
      assert.equal(count("labeled"), "Labeled: 1");
      assert.equal(count("partly"), "Partly labeled: 1");
      assert.equal(count("not-started"), "Not started: 1");
      assert.match(t.textOf(t.render(ctx({ items: sampleReviewItemsRaw().filter((item) => item.kind === "review") }))), /no audit rows \(asked for 3\)/);
    },
    margin: (t) => {
      let tree = t.render(ctx());
      assert.equal(t.textOf(byAttr(t, tree, "data-margin", "so-far")), "Worst-case 95% margin of the 1 labeled audit row so far: ±98.0 points");
      assert.equal(t.textOf(byAttr(t, tree, "data-margin", "sample")), "Once all 3 audit rows are labeled: ±56.6 points");
      tree = t.render(noAuditLabelsCtx());
      assert.equal(t.textOf(byAttr(t, tree, "data-margin", "so-far")), "Worst-case 95% margin of the 0 labeled audit rows so far: —");
    },
    target: (t) => {
      const page = ctx();
      let tree = t.render(page);
      assert.equal(t.textOf(byAttr(t, tree, "data-target", "10")),
        "±10 points needs 97 labeled audit rows; 96 still to label. The sample holds only 3: read the decisions again with a larger audit sample.");
      t.fire(byAttr(t, tree, "data-action", "audit-target"), "change", { target: { value: "20" } });
      tree = t.render(page);
      assert.match(t.textOf(byAttr(t, tree, "data-target", "20")), /^±20 points needs 25 labeled audit rows; 24 still to label\./);
    },
    rows: (t) => {
      const tree = t.render(ctx());
      const list = byAttr(t, tree, "data-list", "audit-rows");
      assert.deepEqual(t.findAll(list, (node) => node.tag === "li").map((node) => node.attrs["data-row"]), [9, 13, 15]);
      assert.match(t.textOf(byAttr(t, list, "data-row", 9)), /^Line 9: not started \(blind; to label: topic, urgent\)/);
      assert.match(t.textOf(byAttr(t, list, "data-row", 13)), /^Line 13: labeled /);
      assert.match(t.textOf(byAttr(t, list, "data-row", 15)), /^Line 15: partly labeled \(blind; to label: urgent\)/);
      // Line 13 is revealed (shortlist beans, wholesale; the gate's tone 1 differs from yours): the tracker shows neither.
      assert.ok(!t.textOf(tree).includes("wholesale"), "no shortlist in the tracker");
      assert.ok(!/disagree|differs|tone/i.test(t.textOf(list)), "no agreement or answers in the row list");
    },
    go: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-go-line", 13), "click");
      assert.deepEqual(page.log, [["goTo", 13]]);
      const reviews = ctx({ kind: "review" });
      const hidden = byAttr(t, t.render(reviews), "data-go-line", 9);
      assert.equal(hidden.attrs.disabled, true);
      assert.equal(t.textOf(hidden), "Go (hidden)");
    },
    slices: (t) => {
      const tree = t.render(ctx());
      // channel: line 9 email (not labeled); lines 13 (labeled) and 15 phone. No audit row is on chat.
      assert.deepEqual(tableKeys(t, tree, "audit-slices", "data-slice"), ["email", "phone"]);
      assert.deepEqual(rowOf(t, tree, "data-slice", "email"), ["email", "1", "0", "—"]);
      assert.deepEqual(rowOf(t, tree, "data-slice", "phone"), ["phone", "2", "1", "±98.0 points"]);
    },
  } },

  labels: { improvements: {
    table: (t) => {
      const page = ctx();
      let tree = t.render(page);
      assert.deepEqual(tableKeys(t, tree, "labels", "data-option"), ["billing", "shipping", "wholesale", "beans"]);
      // Yours on topic: billing (line 4), beans (13), shipping (15); line 2's shipping is the gate's.
      assert.deepEqual(["billing", "shipping", "wholesale", "beans"].map((option) => rowOf(t, tree, "data-option", option)[1]), ["1", "1", "0", "1"]);
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "totals")), "3 labels of yours; 3 rows without one.");
      t.fire(byAttr(t, tree, "data-action", "label-question"), "change", { target: { value: "urgent" } });
      tree = t.render(page);
      assert.deepEqual(tableKeys(t, tree, "labels", "data-option"), ["yes", "no"]);
      assert.deepEqual([rowOf(t, tree, "data-option", "yes")[1], rowOf(t, tree, "data-option", "no")[1]], ["1", "1"]);
    },
    shares: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(["billing", "shipping", "wholesale", "beans"].map((option) => rowOf(t, tree, "data-option", option)[2]), ["33.3%", "33.3%", "0.0%", "33.3%"]);
    },
    kinds: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(rowOf(t, tree, "data-option", "billing").slice(3, 5), ["1", "0"]);
      assert.deepEqual(rowOf(t, tree, "data-option", "shipping").slice(3, 5), ["0", "1"]);
      assert.deepEqual(rowOf(t, tree, "data-option", "beans").slice(3, 5), ["0", "1"]);
    },
    suggestions: (t) => {
      const page = ctx();
      let tree = t.render(page);
      assert.equal(rowOf(t, tree, "data-option", "shipping").length, 5, "no suggestion column until asked");
      t.fire(byAttr(t, tree, "data-action", "label-suggestions"), "click");
      tree = t.render(page);
      assert.deepEqual(["billing", "shipping", "wholesale", "beans"].map((option) => rowOf(t, tree, "data-option", option)[5]), ["0", "1", "0", "0"]);
      assert.equal(rowOf(t, tree, "data-option", "shipping")[1], "1", "your count is unchanged");
    },
    dominant: (t) => {
      assert.equal(byAttr(t, t.render(ctx()), "data-note", "dominant"), null, "3 labels are too few to call");
      assert.equal(t.textOf(byAttr(t, t.render(lopsidedCtx()), "data-note", "dominant")),
        "“billing” is 80.0% of your 5 labels for topic. Make sure the other options get a fair look.");
    },
    copy: (t) => {
      t.fire(byAttr(t, t.render(ctx()), "data-action", "label-copy"), "click");
      const text = t.env.copied[0];
      for (const line of ["| billing | 1 | 33.3% | 1 | 0 |", "| wholesale | 0 | 0.0% | 0 | 0 |", "Rows without a label of yours: 3"]) assert.ok(text.includes(line), line);
      for (const secret of ["grinder", "Sumatra", "Parcel"]) assert.ok(!text.includes(secret), `no inputs: ${secret}`);
      assert.match(t.env.toasts.at(-1).message, /Copied your label counts for topic/);
      assert.match(text, /counts only; no inputs or answers/);
      // With the suggestion column on, the heading says what the extra column counts; shipping: yours on audit line 15,
      // and line 2's untouched suggestion.
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "label-suggestions"), "click");
      t.fire(byAttr(t, t.render(page), "data-action", "label-copy"), "click");
      const withSuggestions = t.env.copied[1];
      assert.match(withSuggestions, /the last column counts the gate's untouched suggestions on review rows/);
      assert.ok(withSuggestions.includes("| shipping | 1 | 33.3% | 0 | 1 | 1 |"));
    },
  } },

  copies: { improvements: {
    groups: (t) => {
      assert.match(t.textOf(t.render(ctx())), /No input is queued more than once/);
      const tree = t.render(copiesCtx());
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "groups")), "2 inputs queued more than once.");
      assert.match(t.textOf(byAttr(t, tree, "data-group", 1)), /3 copies: Where is my order\? \(lines 3, 8, 11\)/);
      assert.match(t.textOf(byAttr(t, tree, "data-group", 2)), /2 copies: Beans arrived stale \(lines 20, 21\)/);
    },
    labels: (t) => {
      const tree = t.render(copiesCtx());
      const row = (line) => rowOf(t, tree, "data-line", line).slice(0, 5);
      assert.deepEqual(row(3), ["3", "review", "shipping (you)", "no (you)", "—"]);
      // Line 8's urgent is the gate's suggestion in a group with a blind audit copy (line 11), so it stays hidden.
      assert.deepEqual(row(8), ["8", "review", "billing (you)", "gate suggestion hidden", "—"]);
      assert.deepEqual(row(11), ["11", "audit", "—", "—", "—"]);
      assert.deepEqual(row(20), ["20", "review", "beans (you)", "no (gate)", "—"]);
      assert.deepEqual(row(21), ["21", "review", "beans (gate)", "—", "—"]);
    },
    differs: (t) => {
      const tree = t.render(copiesCtx());
      const heads = (group) => t.findAll(byAttr(t, tree, "data-group", group), (node) => node.tag === "th" && node.attrs["data-question"])
        .map((node) => [node.attrs["data-question"], node.attrs["data-differs"]]);
      // urgent: line 3's no (yours) against line 8's hidden suggestion yes is not compared while line 11 is blind.
      assert.deepEqual(heads(1), [["topic", "yes"], ["urgent", "no"], ["tone", "no"]]);
      assert.deepEqual(heads(2), [["topic", "no"], ["urgent", "no"], ["tone", "no"]]);
      assert.match(t.textOf(byAttr(t, byAttr(t, tree, "data-group", 1), "data-question", "topic")), /\(differs\)/);
    },
    differ_only: (t) => {
      const page = copiesCtx();
      t.fire(byAttr(t, t.render(page), "data-action", "copies-differ-only"), "click");
      const tree = t.render(page);
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "groups")), "1 input queued more than once (of 2).");
      assert.equal(byAttr(t, tree, "data-line", 20), null);
    },
    answers: (t) => {
      const page = copiesCtx();
      let tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-answers", 20), null, "answers stay off until asked");
      t.fire(byAttr(t, tree, "data-action", "copies-answers"), "click");
      tree = t.render(page);
      // Line 11 is a blind audit copy, so lines 3 and 8 (revealed review rows) hide their answers too.
      for (const line of [3, 8, 11]) assert.equal(t.textOf(byAttr(t, tree, "data-answers", line)), "hidden while a copy is a blind audit row");
      assert.equal(t.textOf(byAttr(t, tree, "data-answers", 20)), "topic beans, urgent no, tone 0");
      assert.equal(t.textOf(byAttr(t, tree, "data-answers", 21)), "topic beans, urgent yes, tone 0");
    },
    text_only: (t) => {
      const page = copiesCtx();
      t.fire(byAttr(t, t.render(page), "data-action", "copies-text-only"), "click");
      const tree = t.render(page);
      assert.match(t.textOf(byAttr(t, tree, "data-group", 1)), /4 copies: Where is my order\? \(lines 3, 8, 11, 12\)/);
      // Line 12 joins a group with the blind line 11, so its suggestions are hidden too.
      assert.deepEqual(rowOf(t, tree, "data-line", 12).slice(2, 4), ["gate suggestion hidden", "gate suggestion hidden"]);
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "groups")), "2 inputs queued more than once.");
    },
    go: (t) => {
      const page = copiesCtx();
      t.fire(byAttr(t, t.render(page), "data-go-line", 8), "click");
      assert.deepEqual(page.log, [["goTo", 8]]);
    },
  } },

  // Gated labels (topic, urgent) now set: line 2 topic (the gate's suggestion), line 4 both, line 13 both, line 15 topic
  // (all yours): 5 of 6. With every label cleared there is nothing to share out.
  gated_by_you: [{ ctx: ctx(), expect: (result) => { approx(result.value, 5 / 6); assert.equal(result.detail, "5 of 6 gated labels"); }, empty: empty() },
    { ctx: ctx({ items: sampleReviewItemsRaw().map((item) => ({ ...item, labels: { topic: null, urgent: null, tone: null } })), edits: {} }), expect: null },
    // Copies: set 3 topic+urgent, 8 topic+urgent, 12 topic+urgent, 20 topic+urgent, 21 topic = 9; yours 3 both, 8 topic, 20 topic = 4.
    { ctx: copiesCtx(), expect: 4 / 9 }],
  room_unfilled: [{ ctx: ctx(), expect: 0, empty: empty() }, { ctx: ctx({ room: 5 }), expect: 3 }],
  // Edited rows: 4 and 13 are ready, 15 is not. In the copies queue every edited row (3, 8, 20) is ready.
  started_unfinished: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "lines 15"); }, empty: empty() },
    { ctx: copiesCtx(), expect: 0 }],
  distinct_inputs: [{ ctx: ctx(), expect: 6, empty: empty() }, { ctx: copiesCtx(), expect: 3 }],
}, { ctx: () => sampleReviewQueueCtx() });

// The custom rows use the fixture's question set.
assert.ok(REVIEW_QUESTIONS.topic.criteria.beans);
