// Tests for the Calibrate rows starter pack (static/js/lab/packs/workbench/wb-calibrate-rows.js). Expected values are
// worked out by hand from tests/js/lab/fixtures/workbench-analysis.mjs (the "department" report, threshold 0.50).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/wb-calibrate-rows.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleCalibrateCtx } from "./fixtures/workbench-analysis.mjs";

// Rows #1-#7 of department: signals .76 .12 .87 .93 .60 .20 .84; #2 and #6 are wrong.
const rows = () => sampleCalibrateCtx().items();
const noulRows = () => sampleCalibrateCtx({ qid: "urgent" }).items();
const scoreRows = () => sampleCalibrateCtx({ qid: "tone" }).items();
const boxRows = () => sampleCalibrateCtx({ qid: "spot" }).items();

checkPack(pack, {
  signal: { items: rows(), values: [0.76, 0.12, 0.87, 0.93, 0.6, 0.2, 0.84] },
  // Top two options: .82-.12, .45-.40, .90-.05, .95-.02, .70-.15, .40-.30, .88-.05; a Noul at P(yes) .5 has 0; a Box none.
  margin: { items: [...rows(), noulRows()[5], boxRows()[0]], values: [0.7, 0.05, 0.85, 0.93, 0.55, 0.1, 0.83, 0, null], tolerance: 1e-9 },
  // At threshold 0.60: signal − 0.60.
  threshold_distance: { items: rows(), values: [0.16, -0.48, 0.27, 0.33, 0, -0.4, 0.24], ctx: sampleCalibrateCtx({ threshold: 0.6 }), tolerance: 1e-9 },
  // Noul: yes labels get P(yes), no labels 1 − P(yes): .88, 1-.30, 1-.05, 1-.70, 1-.20, .50, .91. Score: P(label level).
  label_probability: { items: [...noulRows(), ...scoreRows(), boxRows()[1]], values: [0.88, 0.7, 0.95, 0.3, 0.8, 0.5, 0.91, 0.7, 0.3, 0.9, 0.5, 0.7, null], tolerance: 1e-9 },
  automated: { items: rows(), values: [true, false, true, true, true, false, true], ctx: sampleCalibrateCtx() },
  // At 0.10 every row clears, so the two wrong rows are automated.
  wrong_automated: { items: rows(), values: [false, true, false, false, false, true, false], ctx: sampleCalibrateCtx({ threshold: 0.1 }) },
  confident_mistake: { items: [{ correct: false, top: 0.85 }, { correct: false, top: 0.5 }, { correct: true, top: 0.95 }, { correct: false, top: null }], values: [true, false, false, false] },
  // At 0.60 only #5 (signal 0.60) is within 0.05.
  close_call: { items: rows(), values: [false, false, false, false, true, false, false], ctx: sampleCalibrateCtx({ threshold: 0.6 }) },
  short_list: { items: rows(), values: [false, true, false, false, false, true, false] },
  label_outside_set: { items: [{ set: { size: 2, covered: false } }, { set: { size: 2, covered: true } }, { set: null }], values: [true, false, false] },
  result: { items: rows(), values: ["right", "wrong", "right", "right", "right", "wrong", "right"] },
  route: { items: rows(), values: ["auto", "review", "auto", "auto", "auto", "review", "auto"], ctx: sampleCalibrateCtx() },
  confusion: { items: rows(), values: ["billing → billing", "shipping → wholesale", "other → other", "billing → billing", "wholesale → wholesale", "shipping → billing", "shipping → shipping"] },
  row_text: { items: [rows()[0], rows()[2], rows()[5]],
    values: ["My espresso grinder arrived cracked, I want a refund today.", "Thanks for the Ethiopia roast, best cup all year!", "Do you ship to Norway?"] },

  possible_label_error: {
    hit: { label: "shipping", answer: { type: "choice", choice: "billing", probabilities: { billing: 0.97, shipping: 0.02, other: 0.01 } } },
    miss: [rows()[0], boxRows()[0], { label: "no", answer: { type: "noul", noul: 0.5 } }],
    message: /gave the label “shipping” 2\.0%/,
  },
  few_mistakes: {
    hitList: rows(),
    missList: [{ correct: false }, { correct: false }, { correct: false }, { correct: true }],
    message: /Only 2 wrong rows/,
  },

  // Every right signal (.76 .87 .93 .60 .84) beats both wrong ones (.12 .20): 10 of 10 pairs. Tone: right .55 .85 .25
  // .60 against wrong .40 → 3 of 4.
  auroc: [
    { ctx: sampleCalibrateCtx(), expect: 1, empty: sampleCalibrateCtx({ result: null }) },
    { ctx: sampleCalibrateCtx({ qid: "tone" }), expect: 0.75 },
    { ctx: sampleCalibrateCtx({ hide: [1, 5] }), expect: null },
  ],
  // (top − right)²: .0324 .2025 .01 .0025 .09 .16 .0144 → .5118 / 7; right rows only: .1493 / 5.
  brier: [
    { ctx: sampleCalibrateCtx(), expect: 0.5118 / 7, tolerance: 1e-9, empty: sampleCalibrateCtx({ result: null }) },
    { ctx: sampleCalibrateCtx({ hide: [1, 5] }), expect: 0.1493 / 5, tolerance: 1e-9 },
  ],
  shown_accuracy: [
    { ctx: sampleCalibrateCtx(), expect: (result) => { assert.ok(Math.abs(result.value - 5 / 7) < 1e-12); assert.match(result.detail, /^5 of 7; 95% interval/); },
      empty: sampleCalibrateCtx({ result: null }) },
    { ctx: sampleCalibrateCtx({ hide: [0] }), expect: 4 / 6, tolerance: 1e-12 },
  ],
  // The highest wrong signal is .20 → 0.21; without #6 it is .12 → 0.13; with no wrong row shown, 0.
  safe_threshold: [
    { ctx: sampleCalibrateCtx(), expect: (result) => { assert.equal(result.value, 0.21); assert.equal(result.detail, "automates 5 of 7 shown rows"); },
      empty: sampleCalibrateCtx({ result: null }) },
    { ctx: sampleCalibrateCtx({ hide: [5] }), expect: 0.13 },
    { ctx: sampleCalibrateCtx({ hide: [1, 5] }), expect: 0 },
  ],

  rows_csv: {
    ctx: sampleCalibrateCtx({ hide: [2, 3, 4, 6], order: [5, 0] }),
    filename: "calibrate-department-rows.csv",
    text: '"#","label","answer","right","signal","stated probability","route"\r\n'
      + '"6","shipping","billing","no","0.20","0.40","review"\r\n'
      + '"1","billing","billing","yes","0.76","0.82","auto"\r\n'
      + '"2","shipping","wholesale","no","0.12","0.45","review"\r\n',
    excludes: ["espresso", "Norway", "kettle"],
  },
  sweep_csv: {
    ctx: sampleCalibrateCtx({ hide: [0, 1, 2] }),
    filename: "calibrate-department-sweep.csv",
    includes: ['"threshold","automated","share","accuracy","low","high"\r\n', '"0.50","5","0.7143","1.0000","0.5655","1.0000"\r\n',
      '"0.15","6","0.8571","0.8333","0.4365","0.9699"\r\n', '"0.95","0","0.0000","","",""\r\n'],
    check: (out) => assert.equal(out.text.split("\r\n").length, 103, "a header, 101 thresholds and the final line break"),
  },
  confusion_csv: {
    ctx: sampleCalibrateCtx(),
    filename: "calibrate-department-confusion.csv",
    text: '"label \\ answer","billing","shipping","wholesale","other"\r\n"billing","2","0","0","0"\r\n"shipping","1","1","1","0"\r\n'
      + '"wholesale","0","0","1","0"\r\n"other","0","0","0","1"\r\n',
  },

  set_safe_threshold: {
    ctx: () => sampleCalibrateCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThreshold", 0.21]]);
      assert.equal(ctx.state.threshold, 0.21);
      assert.match(ctx.env.toasts[0].message, /Threshold set to 0\.21/);
    },
    hidden: () => sampleCalibrateCtx({ hide: [1, 5] }),
  },
  nudge_up: {
    ctx: () => sampleCalibrateCtx({ threshold: 0.57 }),
    check: (ctx) => assert.deepEqual(ctx.log, [["setThreshold", 0.58]]),
    hidden: () => sampleCalibrateCtx({ result: null }),
  },
  nudge_down: {
    ctx: () => sampleCalibrateCtx({ threshold: 0 }),
    check: (ctx) => assert.deepEqual(ctx.log, [["setThreshold", 0]]),
    hidden: () => sampleCalibrateCtx({ result: null }),
  },
  check_unseen: {
    ctx: () => sampleCalibrateCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["checkUnseen"]]),
    hidden: () => sampleCalibrateCtx({ qid: "spot" }),
  },
}, { ctx: () => sampleCalibrateCtx() });

// A fact never throws on an odd item.
for (const feature of pack.features.filter((f) => f.kind === "fact")) feature.value({}, fakeCtx({}));
