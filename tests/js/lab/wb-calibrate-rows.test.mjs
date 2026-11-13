// Tests for the Calibrate rows starter pack (static/js/lab/packs/workbench/wb-calibrate-rows.js). Expected values are
// worked out by hand from tests/js/lab/fixtures/workbench-analysis.mjs (the "department" report, threshold 0.50).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/wb-calibrate-rows.js";
import { runDiagnostics, runExporter } from "../../../static/js/lab/kit.js";
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
  // Noul: yes labels get P(yes), no labels 1 − P(yes): .88, 1-.30, 1-.05, 1-.70, 1-.20, .50, .91. Score: P(label level).
  label_probability: { items: [...noulRows(), ...scoreRows(), boxRows()[1]], values: [0.88, 0.7, 0.95, 0.3, 0.8, 0.5, 0.91, 0.7, 0.3, 0.9, 0.5, 0.7, null], tolerance: 1e-9 },
  // 0.80 itself counts; a right row and a row without a stated probability never do.
  confident_mistake: { items: [{ correct: false, top: 0.85 }, { correct: false, top: 0.5 }, { correct: true, top: 0.95 }, { correct: false, top: null },
    { correct: false, top: 0.8 }, { correct: false, top: 0.79 }], values: [true, false, false, false, true, false] },
  // At 0.81: #1 (.76) sits exactly 0.05 below (the tie tolerance keeps it), #7 (.84) 0.03 above, #3 (.87) 0.06 above is out.
  close_call: { items: rows(), values: [true, false, false, false, false, false, true], ctx: sampleCalibrateCtx({ threshold: 0.81 }) },
  label_outside_set: { items: [{ set: { size: 2, covered: false } }, { set: { size: 2, covered: true } }, { set: null }], values: [true, false, false] },
  result: { items: rows(), values: ["right", "wrong", "right", "right", "right", "wrong", "right"] },
  // At 0.76 the tie rule automates #1 (signal exactly .76); #5 (.60) now goes to review.
  route: { items: rows(), values: ["auto", "review", "auto", "auto", "review", "review", "auto"], ctx: sampleCalibrateCtx({ threshold: 0.76 }) },
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
  // .60 against wrong .40 → 3 of 4. Urgent: right .76 .40 .90 .60 0 .82 against wrong .40 → 1 + ½ (tie) + 1 + 1 + 0 + 1 = 4.5 of 6.
  auroc: [
    { ctx: sampleCalibrateCtx(), expect: 1, empty: sampleCalibrateCtx({ result: null }) },
    { ctx: sampleCalibrateCtx({ qid: "tone" }), expect: 0.75 },
    { ctx: sampleCalibrateCtx({ qid: "urgent" }), expect: (result) => { assert.equal(result.value, 0.75); assert.equal(result.detail, "6 right × 1 wrong"); } },
    { ctx: sampleCalibrateCtx({ hide: [1, 5] }), expect: null },
  ],
  // (top − right)²: .0324 .2025 .01 .0025 .09 .16 .0144 → .5118 / 7; right rows only: .1493 / 5.
  // Urgent (top .88 .70 .95 .70 .80 .50 .91, #4 wrong): .0144 .09 .0025 .49 .04 .25 .0081 → .895 / 7.
  brier: [
    { ctx: sampleCalibrateCtx(), expect: 0.5118 / 7, tolerance: 1e-9, empty: sampleCalibrateCtx({ result: null }) },
    { ctx: sampleCalibrateCtx({ qid: "urgent" }), expect: 0.895 / 7, tolerance: 1e-9 },
    { ctx: sampleCalibrateCtx({ hide: [1, 5] }), expect: 0.1493 / 5, tolerance: 1e-9 },
  ],
  shown_accuracy: [
    // Wilson 95% bounds from a separate computation (Python, z = 1.959964): 5/7 → 0.3589–0.9178; 4/6 → 0.3000–0.9032.
    { ctx: sampleCalibrateCtx(), expect: (result) => { assert.ok(Math.abs(result.value - 5 / 7) < 1e-12); assert.equal(result.detail, "5 of 7; 95% interval 35.9%–91.8%"); },
      empty: sampleCalibrateCtx({ result: null }) },
    { ctx: sampleCalibrateCtx({ hide: [0] }), expect: (result) => { assert.ok(Math.abs(result.value - 4 / 6) < 1e-12); assert.equal(result.detail, "4 of 6; 95% interval 30.0%–90.3%"); } },
  ],
  // The highest wrong signal is .20 → 0.21; without #6 it is .12 → 0.13; with no wrong row shown, 0.
  safe_threshold: [
    { ctx: sampleCalibrateCtx(), expect: (result) => { assert.equal(result.value, 0.21); assert.equal(result.detail, "automates 5 of 7 shown rows"); },
      empty: sampleCalibrateCtx({ result: null }) },
    { ctx: sampleCalibrateCtx({ hide: [5] }), expect: 0.13 },
    { ctx: sampleCalibrateCtx({ hide: [1, 5] }), expect: 0 },
    // Urgent: the one wrong row (#4) has signal .40 → 0.41, which automates .76 .90 .60 .82 (4 of 7).
    { ctx: sampleCalibrateCtx({ qid: "urgent" }), expect: (result) => { assert.equal(result.value, 0.41); assert.equal(result.detail, "automates 4 of 7 shown rows"); } },
  ],

  rows_csv: {
    ctx: sampleCalibrateCtx({ hide: [2, 3, 4, 6], order: [5, 0] }),
    filename: "calibrate-department-rows.csv",
    text: '"Bulk #","label","answer","right","signal","stated probability","route"\r\n'
      + '"6","shipping","billing","no","0.20","0.40","review"\r\n'
      + '"1","billing","billing","yes","0.76","0.82","auto"\r\n'
      + '"2","shipping","wholesale","no","0.12","0.45","review"\r\n',
    excludes: ["espresso", "Norway", "kettle"],
  },
  sweep_csv: {
    ctx: sampleCalibrateCtx({ hide: [0, 1, 2] }),
    filename: "calibrate-department-sweep.csv",
    // Every scored row, whatever Lab hides. 0.13 keeps all but #2 (6 rows, #6 wrong): Wilson 5/6 = 0.4365–0.9699. 0.21 keeps 5
    // right rows: 5/5 → 0.5655–1. 0.94 keeps none.
    includes: ['"threshold","automated","share","accuracy","low","high"\r\n', '"0.00","7","1.0000","0.7143","0.3589","0.9178"\r\n',
      '"0.12","7","1.0000","0.7143","0.3589","0.9178"\r\n', '"0.13","6","0.8571","0.8333","0.4365","0.9699"\r\n', '"0.21","5","0.7143","1.0000","0.5655","1.0000"\r\n',
      '"0.93","1","0.1429","1.0000","0.2065","1.0000"\r\n', '"0.94","0","0.0000","","",""\r\n'],
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
    ctx: () => sampleCalibrateCtx({ threshold: 0.3 }),
    check: (ctx) => assert.deepEqual(ctx.log, [["setThreshold", 0.29]]),
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

const feature = (id) => pack.features.find((f) => f.id === id);

test("wb-calibrate-rows: the nudges stop at 0 and 1", () => {
  const low = sampleCalibrateCtx({ threshold: 0 });
  feature("nudge_down").run(low);
  const high = sampleCalibrateCtx({ threshold: 1 });
  feature("nudge_up").run(high);
  assert.deepEqual([low.log, high.log], [[["setThreshold", 0]], [["setThreshold", 1]]]);
});

test("wb-calibrate-rows: with no shown mistake the check says so instead of counting zero", () => {
  const [finding] = runDiagnostics([["few", feature("few_mistakes")]], sampleCalibrateCtx({ hide: [1, 5] }).shown(), sampleCalibrateCtx());
  assert.match(finding.message, /^No shown row is wrong: the 5 shown rows/);
  assert.deepEqual(runDiagnostics([["few", feature("few_mistakes")]], [], sampleCalibrateCtx()), []);
});

test("wb-calibrate-rows: a Box or a malformed matrix has no confusion export", () => {
  assert.throws(() => runExporter(feature("confusion_csv"), sampleCalibrateCtx({ qid: "spot" })), /no confusion matrix/);
  const broken = sampleCalibrateCtx({ report: { ...sampleCalibrateCtx().state.report, confusion: [[2, 0, 0, 0]] } });
  assert.throws(() => runExporter(feature("confusion_csv"), broken), /no confusion matrix/);
});
