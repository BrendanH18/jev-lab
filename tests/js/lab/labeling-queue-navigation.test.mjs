import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/labeling-queue-navigation.js";
import { checkPack } from "./harness.mjs";
import { sampleLabelingQueueCtx } from "./fixtures/workbench-labeling.mjs";

const ctx = (overrides) => sampleLabelingQueueCtx(overrides);
const chat = () => ctx({ slice: "chat" });
const empty = () => ctx({ report: null });
const last = (c) => c.log.at(-1);
// The chat slice (rows 4, 5 and 9) with every missing label drafted.
const chatDone = () =>
  ctx({
    slice: "chat",
    drafts: {
      3: { topic: "billing", tone: 0 },
      4: { topic: "billing", tone: 0 },
      8: { urgent: false, topic: "shipping" },
    },
  });

const row = (index, input, missing, draft) => ({ index, row: input, missing, draft });

// Panels. Fixture (tests/js/lab/fixtures/workbench-labeling.mjs): rows 1 (all drafted), 2 (topic drafted; urgent, tone blank),
// 4 (topic, tone blank), 5 (topic drafted, tone blank), 6 (tone drafted), 7 (urgent blank), 9 (urgent drafted, topic
// blank). Guidelines: urgent has a note and 2 examples; topic no note and 1 valid example; tone none.
const byAttr = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const cells = (t, row) => row.children.filter((child) => child && child.tag === "td").map(t.textOf);

checkPack(
  pack,
  {
    show_incomplete: {
      ctx: () => ctx(),
      check: (c) => assert.deepEqual(last(c), ["setStatus", "incomplete"]),
      hidden: () => ctx({ status: "incomplete" }),
    },
    show_ready: {
      ctx: () => ctx(),
      check: (c) => assert.deepEqual(last(c), ["setStatus", "ready"]),
      hidden: () => ctx({ status: "ready" }),
    },
    show_every_status: {
      ctx: () => ctx({ status: "ready" }),
      check: (c) => assert.deepEqual(last(c), ["setStatus", "all"]),
      hidden: () => ctx(),
    },
    // The current row is row 2 (index 1); the next incomplete one is row 4 (index 3).
    next_incomplete: {
      ctx: () => ctx(),
      check: (c) => {
        assert.deepEqual(last(c), ["next", 1]);
        assert.equal(c.state.nextIndex, 3);
        assert.equal(c.state.status, "incomplete");
      },
      hidden: empty,
    },
    go_first_ready: {
      ctx: () => ctx(),
      check: (c) => assert.deepEqual(last(c), ["goTo", 0]),
      hidden: () => ctx({ status: "incomplete" }),
    },
    // channel values: chat, email, phone; the chat slice is open.
    next_slice_value: {
      ctx: chat,
      check: (c) => assert.deepEqual(last(c), ["prepare", "channel", "email"]),
      hidden: () => ctx(),
    },
    previous_slice_value: {
      ctx: chat,
      check: (c) => assert.deepEqual(last(c), ["prepare", "channel", "phone"]),
      hidden: () => ctx(),
    },
    every_value: {
      ctx: chat,
      check: (c) => assert.deepEqual(last(c), ["prepare", "channel", null]),
      hidden: () => ctx(),
    },
    whole_queue: { ctx: chat, check: (c) => assert.deepEqual(last(c), ["prepare", null, null]), hidden: () => ctx() },

    clear_question: {
      ctx: ctx(),
      params: { question: " topic " },
      input: [
        row(0, "a", ["urgent", "topic"], { urgent: true, topic: "billing" }),
        row(1, "b", ["topic"], {}),
        row(2, "c", ["topic", "tone"], { topic: "beans", tone: 1 }),
      ],
      output: [
        row(0, "a", ["urgent", "topic"], { urgent: true }),
        row(1, "b", ["topic"], {}),
        row(2, "c", ["topic", "tone"], { tone: 1 }),
      ],
      unchanged: [row(0, "a", ["urgent", "topic"], { urgent: true }), row(1, "b", ["tone"], { tone: 2 })],
      rejects: [{ params: { question: "mood" }, message: /No question “mood”/ }],
    },
    // Rows 0 and 1 are the same input (key order differs) with different topic drafts and the same tone; row 2 is a third,
    // undrafted copy. Rows 3 and 4 agree. Row 1 is not shown, so it keeps its draft.
    clear_conflicting_copies: {
      ctx: ctx(),
      shown: [0, 2, 3, 4],
      input: [
        row(0, { text: "x", channel: "chat" }, ["topic", "tone"], { topic: "billing", tone: 1 }),
        row(1, { channel: "chat", text: "x" }, ["topic", "tone"], { topic: "shipping", tone: 1 }),
        row(2, { text: "x", channel: "chat" }, ["topic"], {}),
        row(3, "y", ["topic"], { topic: "beans" }),
        row(4, "y", ["topic"], { topic: "beans" }),
      ],
      output: [
        row(0, { text: "x", channel: "chat" }, ["topic", "tone"], { tone: 1 }),
        row(1, { channel: "chat", text: "x" }, ["topic", "tone"], { topic: "shipping", tone: 1 }),
        row(2, { text: "x", channel: "chat" }, ["topic"], {}),
        row(3, "y", ["topic"], { topic: "beans" }),
        row(4, "y", ["topic"], { topic: "beans" }),
      ],
      unchanged: [
        row(3, "y", ["topic"], { topic: "beans" }),
        row(4, "y", ["topic"], { topic: "beans" }),
        row(5, "z", ["topic"], { topic: "billing" }),
      ],
    },

    slice_row_share: [
      { ctx: ctx(), empty: empty(), expect: 1 },
      {
        ctx: chat(),
        expect: (result) => {
          assert.equal(result.value, 3 / 7);
          assert.equal(result.detail, "3 of 7 rows");
        },
      },
    ],
    // Missing labels: 3 + 3 + 2 + 2 + 1 + 1 + 2 = 14 in all; chat rows 4, 5, 9: 2 + 2 + 2.
    slice_missing_share: [
      { ctx: ctx(), empty: empty(), expect: 1 },
      {
        ctx: chat(),
        expect: (result) => {
          assert.equal(result.value, 6 / 14);
          assert.equal(result.detail, "6 of 14 missing labels");
        },
      },
    ],
    // Seven draft labels over every slice.
    drafted_all_share: {
      ctx: chat(),
      empty: empty(),
      expect: (result) => {
        assert.equal(result.value, 0.5);
        assert.equal(result.detail, "7 of 14 missing labels");
      },
    },
    labels_per_row: {
      ctx: ctx(),
      empty: empty(),
      expect: (result) => {
        assert.equal(result.value, 2);
        assert.equal(result.detail, "14 labels over 7 rows");
      },
    },

    slice_done: (() => {
      const done = chatDone();
      return {
        ctx: done,
        hitList: done.items(),
        missList: chat().items(),
        missCtx: chat(),
        message: /^Every row of channel = chat is ready\. Other values with rows to label: email \(2\), phone \(1\)\.$/,
      };
    })(),
    status_hides_all: (() => {
      const none = ctx({ status: "ready", drafts: {} });
      assert.equal(none.shown().length, 0);
      return {
        ctx: none,
        hitList: none.shown(),
        missList: ctx().items(),
        missCtx: ctx(),
        message: /^The Labeling status filter \(Ready\) leaves no row of the 7 rows in this slice\.$/,
      };
    })(),

    slice_values_csv: {
      ctx: chat(),
      filename: "labeling-slices.csv",
      text: '"field","value","shown","rows","selected"\r\n"channel","chat","chat","3","yes"\r\n"channel","email","email","2","no"\r\n"channel","phone","phone","1","no"\r\n',
    },
    slices: {
      improvements: {
        values_table: (t) => {
          const tree = t.render(ctx({ slice: "chat" }));
          assert.deepEqual(cells(t, byAttr(t, tree, "data-value", "chat")), ["chat", "3", "labeling now"]);
          assert.deepEqual(cells(t, byAttr(t, tree, "data-value", "email")), ["email", "2", "Label this value"]);
          assert.deepEqual(cells(t, byAttr(t, tree, "data-value", "phone")), ["phone", "1", "Label this value"]);
          assert.match(t.textOf(t.render(ctx())), /Choose a field to see its values/);
          assert.match(t.textOf(t.render(ctx({ report: null }))), /Open the queue with Label missing rows first/);
        },
        label_value: (t) => {
          const page = ctx({ slice: "chat" });
          const tree = t.render(page);
          assert.equal(byAttr(t, tree, "data-label-value", "chat"), null);
          t.fire(byAttr(t, tree, "data-label-value", "email"), "click");
          assert.deepEqual(page.log.at(-1), ["prepare", "channel", "email"]);
        },
        choose_field: (t) => {
          const page = ctx({ slice: "chat" });
          const select = byAttr(t, t.render(page), "data-action", "slice-field");
          assert.deepEqual(
            t.findAll(select, (node) => node.tag === "option").map((node) => node.attrs.value),
            ["", "channel", "order", "text"],
          );
          t.fire(select, "change", { target: { value: "order" } });
          assert.deepEqual(page.log.at(-1), ["prepare", "order", null]);
          t.fire(select, "change", { target: { value: "" } });
          assert.deepEqual(page.log.at(-1), ["prepare", null, null]);
        },
      },
    },
    blanks: {
      improvements: {
        table: (t) => {
          // urgent blank on rows 2 and 7; topic on 4 and 9; tone on 2, 4 and 5.
          let tree = t.render(ctx());
          assert.deepEqual(cells(t, byAttr(t, tree, "data-question", "urgent")).slice(0, 5), [
            "urgent",
            "noul",
            "2",
            "2",
            "note, 2 examples",
          ]);
          assert.deepEqual(cells(t, byAttr(t, tree, "data-question", "topic")).slice(0, 5), [
            "topic",
            "choice",
            "2",
            "2",
            "no note, 1 example",
          ]);
          assert.deepEqual(cells(t, byAttr(t, tree, "data-question", "tone")).slice(0, 5), [
            "tone",
            "score",
            "3",
            "3",
            "none",
          ]);
          // "Ready" shows rows 1 and 6 only: nothing blank among them.
          tree = t.render(ctx({ status: "ready" }));
          assert.deepEqual(cells(t, byAttr(t, tree, "data-question", "tone")).slice(2, 4), ["3", "0"]);
          assert.equal(
            cells(t, byAttr(t, t.render(ctx({ guidelines: null })), "data-question", "urgent"))[4],
            "not loaded",
          );
        },
        go_blank: (t) => {
          const page = ctx();
          const tree = t.render(page);
          assert.equal(t.textOf(byAttr(t, tree, "data-go-blank", "urgent")), "First blank: row 2");
          t.fire(byAttr(t, tree, "data-go-blank", "topic"), "click");
          assert.deepEqual(page.log.at(-1), ["goTo", 3]);
          assert.equal(byAttr(t, t.render(ctx({ status: "ready" })), "data-go-blank", "tone"), null);
        },
      },
    },
  },
  { ctx: chat },
);
