import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/labeling-drafts-tools.js";
import { checkPack } from "./harness.mjs";
import { LABELING_QUESTIONS, sampleLabelingDrafts, sampleLabelingQueueCtx, sampleLabelingReport } from "./fixtures/workbench-labeling.mjs";

// Fixture queue (all rows): Row 1 ready (urgent yes, topic shipping, tone 0); Row 2 current, topic wholesale; Rows 4
// and 5 identical inputs, Row 5 topic billing; Row 6 ready (tone 2); Row 7 urgent missing, no draft; Row 9 urgent no,
// topic missing.
const base = () => sampleLabelingQueueCtx();
const closed = () => sampleLabelingQueueCtx({ report: null });
const chat = () => sampleLabelingQueueCtx({ slice: "chat" });
const ready = () => sampleLabelingQueueCtx({ status: "ready" });
const withDrafts = (drafts) => sampleLabelingQueueCtx({ drafts });

const rowOf = (t, tree, index) => t.find(tree, (node) => node.tag === "tr" && node.attrs["data-row"] === index);
const tallyCell = (t, tree, qid, option, column) => t.textOf(t.find(tree, (node) => node.tag === "tr" && node.attrs["data-question"] === qid
  && node.attrs["data-option"] === option).children[column]);
const block = (t, tree, qid) => t.find(tree, (node) => node.tag === "div" && node.attrs["data-question"] === qid);
const groupText = (t, ctx) => t.textOf(t.find(t.render(ctx), (node) => node.tag === "li" && node.attrs["data-group"] === 1));

checkPack(pack, {
  draft_summary: { improvements: {
    summary_table: (t) => {
      const tree = t.render(base());
      assert.deepEqual(rowOf(t, tree, 1).children.map(t.textOf), ["Row 2 (current)", "incomplete", "blank", "wholesale", "blank", "Go"]);
      assert.deepEqual(rowOf(t, tree, 5).children.map(t.textOf), ["Row 6", "ready", "—", "—", "2", "Go"]);
      assert.equal(t.findAll(tree, (node) => node.tag === "tr" && node.attrs["data-row"] !== undefined).length, 7);
      assert.match(t.textOf(t.render(closed())), /Open the queue/);
    },
    summary_go: (t) => {
      const ctx = base();
      t.fire(t.find(t.render(ctx), (node) => node.attrs["data-go"] === 4), "click");
      assert.deepEqual(ctx.log, [["goTo", 4]]);
      const busy = sampleLabelingQueueCtx({ busy: true });
      t.fire(t.find(t.render(busy), (node) => node.attrs["data-go"] === 4), "click");
      assert.deepEqual(busy.log, []);
      assert.match(t.env.toasts.at(-1).message, /Wait for the labeling queue/);
      assert.equal(t.env.toasts.at(-1).kind, "error");
    },
    summary_copy: (t) => {
      t.fire(t.find(t.render(ready()), (node) => node.attrs["data-copy"] === "summary"), "click");
      // Columns padded to the widest cell with two spaces between; the numeric tone column is right-aligned.
      assert.equal(t.env.copied[0], [
        "row    status  urgent  topic     tone",
        "-----  ------  ------  --------  ----",
        "Row 1  ready   yes     shipping     0",
        "Row 6  ready   —       —            2",
      ].join("\n"));
      assert.ok(!t.env.copied[0].includes("Sumatra"));
    },
  } },
  draft_tally: { improvements: {
    option_counts: (t) => {
      const tree = t.render(base());
      assert.equal(tallyCell(t, tree, "topic", "billing", 2), "1");
      assert.equal(tallyCell(t, tree, "topic", "beans", 2), "0");
      assert.equal(tallyCell(t, tree, "urgent", "yes", 2), "1");
      assert.equal(tallyCell(t, tree, "tone", "1", 2), "0");
      assert.equal(t.findAll(tree, (node) => node.tag === "tr" && node.attrs["data-option"] !== undefined).length, 9);
      assert.match(t.textOf(t.render(closed())), /Open the queue/);
    },
    option_share: (t) => {
      const tree = t.render(base());
      assert.equal(tallyCell(t, tree, "topic", "billing", 3), "33.3%");
      assert.equal(tallyCell(t, tree, "urgent", "no", 3), "50.0%");
      assert.equal(tallyCell(t, tree, "tone", "1", 3), "0.0%");
      // The chat slice (rows 4, 5, 9) has no tone draft.
      assert.equal(tallyCell(t, t.render(chat()), "tone", "2", 3), "—");
    },
    tally_copy: (t) => {
      t.fire(t.find(t.render(ready()), (node) => node.attrs["data-copy"] === "tally"), "click");
      const lines = t.env.copied[0].split("\n");
      assert.equal(lines.length, 11);
      assert.match(lines[0], /^question\s+label\s+drafts\s+share$/);
      assert.match(t.env.copied[0], /^topic\s+shipping\s+1\s+100\.0%$/m);
      assert.match(t.env.copied[0], /^tone\s+2\s+1\s+50\.0%$/m);
      assert.ok(!t.env.copied[0].includes("torn bag"));
    },
  } },
  guidelines_glance: { improvements: {
    notes: (t) => {
      const tree = t.render(base());
      assert.equal(t.textOf(t.find(block(t, tree, "urgent"), (node) => node.attrs["data-note"] !== undefined)), "Urgent means the customer cannot use what they paid for today.");
      assert.match(t.textOf(block(t, tree, "tone")), /No guideline saved/);
      assert.match(t.textOf(tree), /Never sent to the model/);
      assert.match(t.textOf(t.render(sampleLabelingQueueCtx({ guidelines: null }))), /once the dataset is saved/);
    },
    examples: (t) => {
      const tree = t.render(base());
      const examples = (qid) => t.findAll(block(t, tree, qid), (node) => node.attrs["data-example"] !== undefined).map(t.textOf);
      assert.deepEqual(examples("urgent"), ["“My grinder arrived broken” → yes (cannot brew)", "“Do you ship to the islands?” → no"]);
      assert.deepEqual(examples("topic"), ["“Refund my double charge” → billing"]);
    },
    current_only: (t) => {
      const ctx = base();
      t.fire(t.find(t.render(ctx), (node) => node.attrs["data-current-only"] !== undefined), "change", { target: { checked: true } });
      assert.equal(t.state.currentOnly, true);
      // Row 2 is current and blank for urgent and tone.
      const shown = (tree) => t.findAll(tree, (node) => node.tag === "div" && node.attrs["data-question"]).map((node) => node.attrs["data-question"]);
      assert.deepEqual(shown(t.render(ctx)), ["urgent", "tone"]);
      const none = t.render(sampleLabelingQueueCtx({ nextIndex: null }));
      assert.deepEqual(shown(none), []);
      assert.match(t.textOf(none), /No current row yet/);
    },
  } },
  keyboard_reference: { improvements: {
    panel_keys: (t) => {
      const tree = t.render(closed());
      const keys = t.textOf(t.find(tree, (node) => node.attrs["data-keys"] !== undefined));
      assert.match(keys, /Ctrl\/⌘\+EnterNext incomplete row/);
      assert.match(keys, /Ctrl\/⌘\+Shift\+EnterPrevious incomplete row/);
      assert.match(keys, /Choose a human labelClears/);
      assert.match(t.textOf(tree), /Open the queue to see each question's letters/);
    },
    type_ahead: (t) => {
      const cells = (tree, qid, letter) => t.find(tree, (node) => node.tag === "tr" && node.attrs["data-question"] === qid && node.attrs["data-letter"] === letter)
        ?.children.map(t.textOf) || null;
      const tree = t.render(base());
      assert.deepEqual(cells(tree, "topic", "b"), ["topic", "b", "billing, beans", "shared: press again, or type more letters"]);
      assert.deepEqual(cells(tree, "topic", "s"), ["topic", "s", "shipping", ""]);
      assert.deepEqual(cells(tree, "urgent", "y"), ["urgent", "y", "yes", ""]);
      assert.deepEqual(cells(tree, "tone", "0"), ["tone", "0", "0 · Upset", ""]);
      assert.equal(cells(tree, "topic", "c"), null);
      // A Choice key starting with c shares its letter with the select's "Choose a human label" entry.
      const report = { ...sampleLabelingReport(), questions: { ...JSON.parse(JSON.stringify(LABELING_QUESTIONS)),
        topic: { type: "choice", instructions: "Team", criteria: { cafe: "Cafe orders", billing: "Charges" } } } };
      const cafe = t.render(sampleLabelingQueueCtx({ report, drafts: {} }));
      assert.deepEqual(cells(cafe, "topic", "c"), ["topic", "c", "Choose a human label (clears), cafe", "shared: press again, or type more letters"]);
    },
  } },
  current_row_card: { improvements: {
    card_checklist: (t) => {
      const tree = t.render(base());
      assert.match(t.textOf(tree), /^Row 2 · 2 blank labels/);
      assert.equal(t.textOf(t.find(tree, (node) => node.tag === "pre")), "Do you sell 5 lb bags of the Harbor House blend wholesale? Reply to buyer@cafe-north.example");
      assert.equal(t.textOf(block(t, tree, "topic").children[0]), "topic: wholesale");
      assert.equal(t.textOf(block(t, tree, "urgent").children[0]), "urgent: blank");
      const picture = t.render(sampleLabelingQueueCtx({ nextIndex: 5 }));
      assert.match(t.textOf(picture), /Picture: latte-photo \(not loaded\)/);
      assert.ok(!t.textOf(picture).includes('"_image"'));
      assert.match(t.textOf(t.render(sampleLabelingQueueCtx({ nextIndex: null }))), /No current row yet/);
    },
    card_pick: (t) => {
      const ctx = base();
      const tree = t.render(ctx);
      const pick = (qid, text) => t.find(block(t, tree, qid), (node) => node.tag === "button" && node.attrs["data-pick"] === text);
      assert.equal(pick("topic", "wholesale").attrs["aria-pressed"], "true");
      assert.equal(pick("topic", "billing").attrs["aria-pressed"], "false");
      t.fire(pick("tone", "1"), "click");
      assert.deepEqual(ctx.log, [["writeDrafts", [[1, { urgent: null, topic: "wholesale", tone: 1 }]], "Row 2"]]);
      assert.equal(ctx.state.drafts[1].tone, 1);
      // Clear: only on a question with a draft; it removes that draft alone.
      const other = base();
      const fresh = t.render(other);
      assert.equal(t.find(block(t, fresh, "urgent"), (node) => node.attrs["data-clear"] !== undefined), null);
      t.fire(t.find(block(t, fresh, "topic"), (node) => node.attrs["data-clear"] === "topic"), "click");
      assert.deepEqual(other.log, [["writeDrafts", [[1, { urgent: null, topic: null, tone: null }]], "Row 2"]]);
      assert.deepEqual(Object.keys(other.state.drafts[1]), []);
      // While the queue is busy the page refuses the pick; the panel shows the refusal as an error and changes nothing.
      const busy = sampleLabelingQueueCtx({ busy: true });
      t.fire(t.find(block(t, t.render(busy), "tone"), (node) => node.attrs["data-pick"] === "1"), "click");
      assert.deepEqual(busy.log, []);
      assert.equal(t.env.toasts.at(-1).kind, "error");
    },
  } },
  duplicate_groups: { improvements: {
    groups: (t) => {
      assert.match(groupText(t, base()), /^Rows 4, 5: some copies blank/);
      assert.match(groupText(t, withDrafts({ 3: { topic: "shipping" }, 4: { topic: "billing" } })), /^Rows 4, 5: drafts differ/);
      assert.match(groupText(t, withDrafts({ 3: { topic: "billing" }, 4: { topic: "billing" } })), /^Rows 4, 5: same drafts/);
      assert.match(groupText(t, withDrafts({})), /^Rows 4, 5: no drafts/);
      assert.match(t.textOf(t.render(ready())), /^Rows 4, 5/);
      assert.match(t.textOf(t.render(sampleLabelingQueueCtx({ slice: "chat", report: { ...sampleLabelingReport("chat"), items: sampleLabelingReport("chat").items.slice(2) } }))),
        /No two rows in this slice share an input/);
    },
    go: (t) => {
      const ctx = base();
      t.fire(t.find(t.render(ctx), (node) => node.tag === "button" && node.attrs["data-go"] === 4), "click");
      assert.deepEqual(ctx.log, [["goTo", 4]]);
    },
  } },

  // Rows with no draft: 4 and 7. In the chat slice (4, 5, 9): row 4.
  untouched_rows: [
    { ctx: base(), expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "of 7 rows"); }, empty: closed() },
    { ctx: chat(), expect: 1 },
  ],
  // urgent is missed by indexes 0, 1, 6 and 8; drafting it on 1 and 6 finishes it.
  questions_done: [
    { ctx: base(), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "none of 3"); }, empty: closed() },
    { ctx: withDrafts({ ...sampleLabelingDrafts(), 1: { topic: "wholesale", urgent: true }, 6: { urgent: true } }),
      expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "urgent"); } },
  ],
  // One blank label: rows 5 (tone), 7 (urgent) and 9 (topic).
  one_away_rows: [{ ctx: base(), expect: 3, empty: closed() }, { ctx: ready(), expect: 0 }],
  drafted_rows_all: [
    { ctx: base(), expect: (result) => { assert.equal(result.value, 5); assert.equal(result.detail, "7 draft labels"); }, empty: closed() },
    { ctx: chat(), expect: 5 },
  ],

  go_current: { ctx: base, check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 1]]), hidden: () => sampleLabelingQueueCtx({ nextIndex: null }) },
  // From Row 2: Row 4 has no draft (index 3).
  next_untouched: { ctx: base, check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 3]]), hidden: ready },
  // From Row 2: Row 5 has one blank label (index 4).
  next_one_away: { ctx: base, check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 4]]), hidden: ready },
  // From Row 2: Row 4 is blank for topic (index 3).
  next_blank_choice: { ctx: base, check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 3]]), hidden: ready },
  // From Row 2: rows 4 and 5 do not miss urgent, row 6 neither; Row 7 is blank for it (index 6).
  next_blank_noul: { ctx: base, check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 6]]), hidden: ready },
  // From Row 5: rows 6, 7, 9 and 1 have no blank tone, so it wraps to Row 2 (index 1).
  next_blank_score: { ctx: () => sampleLabelingQueueCtx({ nextIndex: 4 }), check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 1]]), hidden: ready },
}, { ctx: () => base() });
