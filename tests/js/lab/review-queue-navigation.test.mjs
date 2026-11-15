import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/review-queue-navigation.js";
import { checkPack } from "./harness.mjs";
import { sampleReviewEdits, sampleReviewItemsRaw, sampleReviewQueueCtx, sampleReviewReport } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleReviewQueueCtx(overrides);
const last = (c, name) => c.log.filter((entry) => entry[0] === name).at(-1);
const run = (id, c) => pack.features.find((feature) => feature.id === id).run(c);
// Only the two ready rows (lines 4 and 13): nothing is incomplete.
const allReady = () => ctx({ items: sampleReviewItemsRaw().filter((item) => item.line === 4 || item.line === 13) });
const noSlices = () => ctx({ report: { ...sampleReviewReport(), slice_fields: [] } });

// Panels. Fixture (tests/js/lab/fixtures/workbench-checks.mjs): lines 2 (review, email, topic shipping is the gate's suggestion),
// 4 (review, chat, topic billing + urgent yes yours, READY, current), 6 (review, chat, nothing), 9 (audit, email, blind),
// 13 (audit, phone, all three yours, READY), 15 (audit, phone, topic yours, blind). Gates topic, urgent.
const byAttr = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const cells = (t, row) => row.children.filter((child) => child && child.tag === "td").map(t.textOf);
const keys = (t, tree) => t.findAll(byAttr(t, tree, "data-table", "slices"), (node) => node.tag === "tr" && node.attrs["data-slice"] !== undefined).map((node) => node.attrs["data-slice"]);
// A second slice field, "source": lines 2-9 web, 13 and 15 app.
const twoFields = () => {
  const items = sampleReviewItemsRaw().map((item) => ({ ...item, slice_values: { ...item.slice_values, source: item.line < 10 ? "web" : "app" } }));
  const report = sampleReviewReport({ items });
  report.slice_fields.push({ name: "source", values: ["app", "web"] });
  return ctx({ report });
};
// Line 6 labeled by hand: every chat row is ready.
const chatReady = () => ctx({ items: sampleReviewItemsRaw().map((item) => (item.line === 6 ? { ...item, labels: { topic: "beans", urgent: false, tone: null } } : item)),
  edits: { ...sampleReviewEdits(), 6: { topic: "beans", urgent: false } } });
const state = (t, tree, qid) => t.textOf(t.find(byAttr(t, tree, "data-question", qid), (node) => node.attrs?.["data-part"] === "state"));

checkPack(pack, {
  show_review_rows: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "setFilter"), ["setFilter", "kindFilter", "review"]), hidden: () => ctx({ kind: "review" }) },
  show_audit_rows: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "setFilter"), ["setFilter", "kindFilter", "audit"]), hidden: () => ctx({ kind: "audit" }) },
  show_ready_rows: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "setFilter"), ["setFilter", "statusFilter", "ready"]), hidden: () => ctx({ status: "ready" }) },
  show_incomplete_rows: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "setFilter"), ["setFilter", "statusFilter", "incomplete"]),
    hidden: () => ctx({ status: "incomplete" }) },
  show_every_status: { ctx: () => ctx({ status: "ready", kind: "audit" }),
    check: (c) => { assert.deepEqual(last(c, "setFilter"), ["setFilter", "statusFilter", "all"]); assert.equal(c.state.kindFilter, "audit"); }, hidden: () => ctx() },
  // The current row is line 4 (ready). Forward the next incomplete row is line 6, backwards line 2.
  next_incomplete: { ctx: () => ctx(), check: (c) => { assert.equal(c.state.nextLine, 6); assert.equal(c.state.statusFilter, "incomplete"); }, hidden: allReady },
  previous_incomplete: { ctx: () => ctx(), check: (c) => { assert.deepEqual(last(c, "next"), ["next", -1]); assert.equal(c.state.nextLine, 2); }, hidden: allReady },
  // Line 2 carries the gate's suggested topic, so line 6 is the first with no label at all. Ready rows all have labels.
  go_first_untouched: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "goTo"), ["goTo", 6]), hidden: () => ctx({ status: "ready" }) },
  go_first_blind: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "goTo"), ["goTo", 9]), hidden: () => ctx({ kind: "review" }) },
  go_first_rule: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "goTo"), ["goTo", 4]), hidden: () => ctx({ kind: "audit" }) },
  go_first_cleared: { ctx: () => ctx({ edits: { ...sampleReviewEdits(), 2: { urgent: null } } }), check: (c) => assert.deepEqual(last(c, "goTo"), ["goTo", 2]), hidden: () => ctx() },
  // Line 2 with urgent filled in by the gate too (no edit): ready on suggestions alone.
  go_first_suggestions_only: { ctx: () => ctx({ items: sampleReviewItemsRaw().map((item) => (item.line === 2 ? { ...item, labels: { topic: "shipping", urgent: true, tone: null } } : item)) }),
    check: (c) => assert.deepEqual(last(c, "goTo"), ["goTo", 2]), hidden: () => ctx() },
  // Line 15 has topic by hand and urgent blank; line 9 has nothing; line 13 is ready.
  go_first_partial_audit: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "goTo"), ["goTo", 15]), hidden: () => ctx({ kind: "review" }) },
  // Shown incomplete rows: 2, 6, 9, 15.
  go_last_incomplete: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "goTo"), ["goTo", 15]), hidden: () => ctx({ status: "ready" }) },
  go_first_picture: { ctx: () => ctx(), check: (c) => assert.deepEqual(last(c, "goTo"), ["goTo", 6]), hidden: () => ctx({ kind: "audit" }) },
  // channel: chat, email, phone. From no slice the first value, then the next one.
  next_slice_value: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(last(c, "setSlice"), ["setSlice", "channel", "chat"]);
      run("next_slice_value", c);
      assert.deepEqual(last(c, "setSlice"), ["setSlice", "channel", "email"]);
    },
    hidden: noSlices },
  // From chat backwards it starts over at phone; from no slice it starts at the last value too.
  previous_slice_value: { ctx: () => ctx({ sliceField: "channel", sliceValue: "chat" }),
    check: (c) => {
      assert.deepEqual(last(c, "setSlice"), ["setSlice", "channel", "phone"]);
      const fresh = ctx();
      run("previous_slice_value", fresh);
      assert.deepEqual(last(fresh, "setSlice"), ["setSlice", "channel", "phone"]);
    },
    hidden: noSlices },
  copy_current_input: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.env.copied, ['{\n  "text": "Charged twice for the wholesale order",\n  "channel": "chat"\n}']);
      assert.equal(c.env.toasts.at(-1).message, "Copied the input of line 4.");
    },
    hidden: () => ctx({ nextLine: null }) },
  slice_progress: { improvements: {
    table: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(keys(t, tree), ["chat", "email", "phone"]);
      // chat: lines 4, 6 (both review; 4 ready; your labels 2). email: 2 and blind 9 (line 2's topic is a suggestion).
      // phone: 13 ready (3 yours) and blind 15 (1 yours).
      assert.deepEqual(cells(t, byAttr(t, tree, "data-slice", "chat")).slice(0, 8), ["chat", "2", "2", "0", "1", "1", "0", "2"]);
      assert.deepEqual(cells(t, byAttr(t, tree, "data-slice", "email")).slice(0, 8), ["email", "2", "1", "1", "0", "2", "1", "0"]);
      assert.deepEqual(cells(t, byAttr(t, tree, "data-slice", "phone")).slice(0, 8), ["phone", "2", "0", "2", "1", "1", "1", "4"]);
      assert.match(t.textOf(t.render(ctx({ report: null }))), /Read the gate's decisions first/);
    },
    field: (t) => {
      const page = twoFields();
      t.fire(byAttr(t, t.render(page), "data-action", "slice-field"), "change", { target: { value: "source" } });
      const tree = t.render(page);
      assert.deepEqual(keys(t, tree), ["app", "web"]);
      assert.deepEqual(cells(t, byAttr(t, tree, "data-slice", "web")).slice(0, 8), ["web", "4", "3", "1", "1", "3", "1", "2"]);
      assert.deepEqual(page.log, [], "choosing the counted field does not change the page's filter");
    },
    incomplete_only: (t) => {
      const page = chatReady();
      t.fire(byAttr(t, t.render(page), "data-action", "slice-incomplete-only"), "click");
      assert.deepEqual(keys(t, t.render(page)), ["email", "phone"]);
    },
    show: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-show-slice", "email"), "click");
      assert.deepEqual(page.log.at(-1), ["setSlice", "channel", "email"]);
      const tree = t.render(ctx({ sliceField: "channel", sliceValue: "chat" }));
      assert.equal(byAttr(t, tree, "data-show-slice", "chat"), null);
      assert.match(t.textOf(byAttr(t, tree, "data-slice", "chat")), /shown$/);
    },
  } },
  current_row: { improvements: {
    card_input: (t) => {
      const tree = t.render(ctx());
      assert.equal(t.textOf(byAttr(t, tree, "data-part", "heading")), "Line 4 · review · ready");
      assert.equal(t.textOf(byAttr(t, tree, "data-part", "input")), "text: Charged twice for the wholesale orderchannel: chat");
      assert.match(t.textOf(byAttr(t, t.render(ctx({ nextLine: 6 })), "data-part", "input")), /picture: receipt-scan$/);
      assert.match(t.textOf(t.render(ctx({ nextLine: null }))), /^No row is current/);
    },
    card_labels: (t) => {
      let tree = t.render(ctx());
      assert.deepEqual(["topic", "urgent", "tone"].map((qid) => state(t, tree, qid)), ["yours: billing", "yours: yes", "blank"]);
      assert.match(t.textOf(byAttr(t, tree, "data-question", "topic")), /^topic \(gated\)/);
      tree = t.render(ctx({ nextLine: 2 }));
      assert.equal(state(t, tree, "topic"), "the gate's suggestion: shipping");
      // Blind audit line 15: only your topic label; its answers (urgent yes, tone 0) appear nowhere.
      tree = t.render(ctx({ nextLine: 15 }));
      assert.match(t.textOf(byAttr(t, tree, "data-part", "heading")), /blind until its gated questions are labeled/);
      assert.deepEqual(["topic", "urgent", "tone"].map((qid) => state(t, tree, qid)), ["yours: shipping", "blank", "blank"]);
      assert.equal(t.findAll(tree, (node) => node.attrs?.["aria-pressed"] === "true").length, 1, "only your own label is marked");
    },
    card_pick: (t) => {
      const page = ctx();
      const tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-pick", "topic:billing").attrs["aria-pressed"], "true");
      t.fire(byAttr(t, tree, "data-pick", "tone:2"), "click");
      assert.deepEqual(page.log.at(-1), ["writeLabels", [[4, { tone: 2 }]], "Line 4"]);
    },
    card_clear: (t) => {
      const page = ctx();
      const tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-clear", "tone"), null, "a blank question has nothing to clear");
      t.fire(byAttr(t, tree, "data-clear", "topic"), "click");
      assert.deepEqual(page.log.at(-1), ["writeLabels", [[4, { topic: null }]], "Line 4"]);
    },
    card_step: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "row-next"), "click");
      assert.deepEqual(page.log.at(-1), ["next", 1]);
      assert.equal(page.state.nextLine, 6);
      t.fire(byAttr(t, t.render(page), "data-action", "row-previous"), "click");
      assert.deepEqual(page.log.at(-1), ["next", -1]);
      const busy = ctx({ busy: true });
      t.fire(byAttr(t, t.render(busy), "data-action", "row-next"), "click");
      assert.equal(busy.log.length, 0);
      assert.equal(t.env.toasts.at(-1).kind, "error");
    },
  } },
});
