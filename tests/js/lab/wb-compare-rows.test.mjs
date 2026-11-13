// Tests for the Compare rows starter pack (static/js/lab/packs/workbench/wb-compare-rows.js). Expected values are
// worked out by hand from tests/js/lab/fixtures/workbench-compare.mjs (the "department" run).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/wb-compare-rows.js";
import { checkPack } from "./harness.mjs";
import { sampleCompareRowsCtx } from "./fixtures/workbench-compare.mjs";

// The seven rows of the department run, in run order (#1 .. #7).
const rows = () => sampleCompareRowsCtx().items();

checkPack(pack, {
  // A's and B's signals: server signals on #1, #2, #4, #6; local reads on #3, #5, #7 (B failed on #5, skipped on #7).
  signal_a: { items: rows(), values: [0.6, 0.3, 0.7, 0.85, 0.6, 0.36, 0.35] },
  signal_b: { items: rows(), values: [0.45, 0.7, 0.85, 0.4, null, 0.33, null] },
  signal_gap: { items: rows(), values: [0.15, 0.4, 0.15, 0.45, null, 0.03, null] },
  row_chars: { items: [{ text: "Do you ship to Norway?" }, { text: "café ☕" }, { text: "" }], values: [22, 6, 0] },
  // B's latency minus A's: 560-400, 500-380, 470-390, 610-420, 90-450 (the failed call's meta), 530-410, none for a skip.
  latency_gap: { items: rows(), values: [160, 120, 80, 190, -360, 120, null] },
  labeled: { items: rows(), values: [true, true, true, false, true, true, false] },
  rewritten: { items: rows(), values: [true, true, false, true, false, true, false] },
  confident_split: {
    items: [{ differs: true, signals: [0.85, 0.9] }, { differs: true, signals: [0.85, 0.4] }, { differs: false, signals: [0.9, 0.9] }, { differs: true, signals: [0.8, null] }],
    values: [true, false, false, false],
  },
  orders_split: { items: rows(), values: [true, false, false, false, false, true, false] },
  verdict: { items: rows(), values: ["only A right", "only B right", null, "no label", null, "both wrong", null] },
  transition: { items: rows(), values: ["billing → shipping", "wholesale → shipping", "other → other", "billing → shipping", null, "billing → other", null] },
  row_text: {
    items: [rows()[0], rows()[2], rows()[5]],
    values: ["My espresso grinder arrived cracked, I want a refund today.", "Thanks for the Ethiopia roast, best cup all year!", "Do you ship to Norway?"],
  },

  // Shown: #1 only A, #2 only B, #4 no label, #6 both wrong → 1 - 1 = 0. Without #1: 1 - 0 = 1.
  b_net_wins: [
    { ctx: sampleCompareRowsCtx(), expect: 0, empty: sampleCompareRowsCtx({ result: null }) },
    { ctx: sampleCompareRowsCtx({ hide: [0] }), expect: 1 },
    { ctx: sampleCompareRowsCtx({ hide: [0, 1, 5] }), expect: null },  // only #4 shown, unlabeled
  ],
  // Gaps on the shown rows: 0.15, 0.40, 0.45, 0.03 → 1.03 / 4.
  mean_signal_gap: [
    { ctx: sampleCompareRowsCtx(), expect: 0.2575, empty: sampleCompareRowsCtx({ result: null }) },
    { ctx: sampleCompareRowsCtx({ hide: [0, 3] }), expect: 0.215 },
  ],

  shown_csv: {
    ctx: sampleCompareRowsCtx(),
    filename: "compare-department-rows.csv",
    text: '"row","input","label","A pick","A signal","B pick","B signal","result"\r\n'
      + '"1","My espresso grinder arrived cracked, I want a refund today.","billing","billing","0.60","shipping","0.45","only A right"\r\n'
      + '"2","{""text"":""Where is wholesale order HC-2231?"",""channel"":""email"",""_image"":""receipt.png""}","shipping","wholesale","0.30","shipping","0.70","only B right"\r\n'
      + '"4","Invoice INV-88 was charged twice on my card.","","billing","0.85","shipping","0.40","no label"\r\n'
      + '"6","Do you ship to Norway?","shipping","billing","0.36","other","0.33","both wrong"\r\n',
  },
  row_numbers: {
    ctx: sampleCompareRowsCtx({ hide: [1], order: [5, 0] }),
    text: "#6, #1, #4\n",
    excludes: ["Norway", "billing"],
    filename: "compare-row-numbers.txt",
  },

  sure_but_wrong: {
    hit: [{ correct: [false, true], signals: [0.85, 0.7] }, { correct: [true, false], signals: [0.6, 0.8] }],
    miss: [{ correct: [false, null], signals: [0.3, 0.9] }, { correct: [null, null], signals: [0.95, 0.95] }],
    message: /was wrong with a signal of 0\.8/,
  },
  small_sample: {
    hitList: sampleCompareRowsCtx().shown(),
    missList: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, verdict: index % 2 ? "a_only" : "both_right" })),
    message: /Only 3 labeled disagreements are shown/,
  },

  switch_signal: {
    ctx: () => sampleCompareRowsCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["setSignal", "top_probability"]]),
    hidden: () => sampleCompareRowsCtx({ running: true }),
  },
  next_question: {
    ctx: () => sampleCompareRowsCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["selectQuestion", "urgent"]]),
    hidden: () => sampleCompareRowsCtx({ result: null }),
  },
}, { ctx: () => sampleCompareRowsCtx() });

test("wb-compare-rows: next question wraps from the last shared id to the first", () => {
  const ctx = sampleCompareRowsCtx({ qid: "spot" });
  pack.features.find((feature) => feature.id === "next_question").run(ctx);
  assert.deepEqual(ctx.log, [["selectQuestion", "department"]]);
});

test("wb-compare-rows: the signal command switches back to confidence", () => {
  const ctx = sampleCompareRowsCtx({ report: { ...sampleCompareRowsCtx().state.report, signal: "top_probability" } });
  pack.features.find((feature) => feature.id === "switch_signal").run(ctx);
  assert.deepEqual(ctx.log, [["setSignal", "confidence"]]);
});
