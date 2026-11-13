// Tests for static/js/lab/packs/workbench/calibrate-metrics.js. Reference values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs, or by the separate small computations written out below.
//
// department, rows #1-#7: labels billing shipping other billing wholesale shipping shipping; answers billing wholesale
// other billing wholesale billing shipping (5 of 7 right); signals .76 .12 .87 .93 .60 .20 .84; stated .82 .45 .90 .95
// .70 .40 .88. Per option (right, answered wrongly, missed): billing 2/1/0, shipping 1/0/2, wholesale 1/1/0, other 1/0/0.
// urgent: labels yes no no no no yes yes, answers yes no no yes no yes yes; P(yes) .88 .30 .05 .70 .20 .50 .91.
// tone (rows #1 #2 #3 #4 #7): labels 2 1 0 1 2, answers 2 0 0 1 2, expected scores 1.65 .50 .12 1.10 1.55,
// signals .55 .40 .85 .25 .60 (only #2 wrong). spot: #2 IoU .855 (right), #5 IoU 0 (wrong).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/calibrate-metrics.js";
import { normalSf } from "../../../static/js/lab/lib/math.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleCalibrateCtx, wilson } from "./fixtures/workbench-analysis.mjs";

const dep = (overrides) => sampleCalibrateCtx(overrides);
const urgent = () => sampleCalibrateCtx({ qid: "urgent" });
const tone = () => sampleCalibrateCtx({ qid: "tone" });
const spot = () => sampleCalibrateCtx({ qid: "spot" });
const empty = () => sampleCalibrateCtx({ result: null });
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const f4 = (x) => x.toFixed(4);
const detail = (pattern) => (result) => assert.match(result.detail, pattern);
const both = (value, pattern, tolerance = 1e-12) => (result) => {
  assert.ok(Math.abs(result.value - value) <= tolerance, `expected ${value}, got ${result.value}`);
  assert.match(result.detail, pattern);
};

// department's probabilities and labels, typed out again for the full-distribution scores.
const DEP_PROBS = [
  [{ billing: 0.82, shipping: 0.12, wholesale: 0.03, other: 0.03 }, "billing"],
  [{ billing: 0.05, shipping: 0.4, wholesale: 0.45, other: 0.1 }, "shipping"],
  [{ billing: 0.02, shipping: 0.03, wholesale: 0.05, other: 0.9 }, "other"],
  [{ billing: 0.95, shipping: 0.02, wholesale: 0.02, other: 0.01 }, "billing"],
  [{ billing: 0.1, shipping: 0.15, wholesale: 0.7, other: 0.05 }, "wholesale"],
  [{ billing: 0.4, shipping: 0.3, wholesale: 0.2, other: 0.1 }, "shipping"],
  [{ billing: 0.04, shipping: 0.88, wholesale: 0.03, other: 0.05 }, "shipping"],
];
const depLogLoss = DEP_PROBS.reduce((s, [p, label]) => s - Math.log(p[label]), 0) / 7;
const depMultiBrier = DEP_PROBS.reduce((s, [p, label]) => s + Object.entries(p).reduce((t, [k, v]) => t + (v - (k === label ? 1 : 0)) ** 2, 0), 0) / 7;
// Spiegelhalter's Z over department's (stated, right) pairs.
const DEP_PAIRS = [[0.82, 1], [0.45, 0], [0.9, 1], [0.95, 1], [0.7, 1], [0.4, 0], [0.88, 1]];
const zTop = DEP_PAIRS.reduce((s, [p, y]) => s + (y - p) * (1 - 2 * p), 0);
const zVar = DEP_PAIRS.reduce((s, [p]) => s + (1 - 2 * p) ** 2 * p * (1 - p), 0);
const depZ = zTop / Math.sqrt(zVar);

const top3 = (label, correct) => ({ type: "choice", label, predicted: "a", correct, signal: 0.5, top: 0.5,
  answer: { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.3, c: 0.2 } } });
const levels = (label, predicted) => ({ type: "score", label, predicted, correct: label === predicted, signal: 0.5, top: 0.5 });

const [w57lo, w57hi] = wilson(5, 7), [w55lo] = wilson(5, 5), [, w02hi] = wilson(0, 2), [w22lo] = wilson(2, 2), [w33lo] = wilson(3, 3);

checkPack(pack, {
  // 2/3, 1, 1/2, 1 over the four answered options.
  macro_precision: { ctx: dep(), expect: both(19 / 24, /^4 answered options; on 7 shown rows$/), empty: empty() },
  macro_recall: [{ ctx: dep(), expect: 5 / 6, tolerance: 1e-12, empty: empty() }, { ctx: spot(), expect: null }],
  // F1: 4/5, 1/2, 2/3, 1.
  macro_f1: { ctx: dep(), expect: 89 / 120, tolerance: 1e-12, empty: empty() },
  // Observed 5/7; chance (2·3 + 3·1 + 1·2 + 1·1) / 49 = 12/49 → (35 − 12) / (49 − 12).
  kappa: { ctx: dep(), expect: 23 / 37, tolerance: 1e-12, empty: empty() },
  // (5·7 − 12) / √((49 − 15)(49 − 15)).
  mcc: { ctx: dep(), expect: 23 / 34, tolerance: 1e-12, empty: empty() },
  majority_rate: { ctx: dep(), expect: both(3 / 7, /^“shipping” labels 3 of 7 shown rows; 95% interval/), empty: empty() },
  accuracy_lift: { ctx: dep(), expect: 2 / 7, tolerance: 1e-12, empty: empty() },
  // P(X ≥ 5), X ~ Binomial(7, 3/7) = (21·3⁵·4² + 7·3⁶·4 + 3⁷) / 7⁷.
  lift_p_value: { ctx: dep(), expect: 104247 / 823543, tolerance: 1e-10, empty: empty() },
  // department and tone hold every label in the top two; a label in third place does not count.
  top2_accuracy: [
    { ctx: dep(), expect: both(1, /^7 of 7 shown rows hold the label in the top two; 95% interval/), empty: empty() },
    { ctx: fakeCtx({ items: [top3("c", false), top3("b", false), top3("a", true)], data: { type: "choice" } }), expect: 2 / 3, tolerance: 1e-12 },
    { ctx: urgent(), expect: null },
  ],
  top_confusion: [
    { ctx: dep(), expect: (r) => { assert.equal(r.value, "shipping → wholesale"); assert.equal(r.detail, "1 of 2 wrong shown rows (50.0%)"); }, empty: empty() },
    { ctx: dep({ hide: [1] }), expect: "shipping → billing" },
    { ctx: dep({ hide: [1, 5] }), expect: null },
  ],
  // billing and wholesale are both answered once more than labeled: billing comes first in the report's options.
  over_given: [
    { ctx: dep(), expect: (r) => { assert.equal(r.value, "billing"); assert.equal(r.detail, "answered 3, labeled 2 of 7 shown rows (14.3 points more)"); }, empty: empty() },
    { ctx: dep({ hide: [5] }), expect: "wholesale" },
  ],

  // urgent: true yes 3, false yes 1, true no 3, missed yes 0.
  sensitivity: [{ ctx: urgent(), expect: both(1, /^3 of 3 yes-labeled shown rows answered yes/), empty: empty() }, { ctx: dep(), expect: null }],
  specificity: { ctx: urgent(), expect: 0.75, empty: empty() },
  ppv: { ctx: urgent(), expect: 0.75, empty: empty() },
  npv: { ctx: urgent(), expect: 1, empty: empty() },
  yes_f1: { ctx: urgent(), expect: 6 / 7, tolerance: 1e-12, empty: empty() },

  // tone as a label × answer table: [[1,0,0],[1,1,0],[0,0,2]], label totals 1 2 2, answer totals 2 1 2. Quadratic
  // weights (i − j)²/4: observed 0.25, expected 1.75 → 1 − 1/7. Linear |i − j|/2: observed 0.5, expected 2.3.
  quadratic_kappa: [{ ctx: tone(), expect: 6 / 7, tolerance: 1e-12, empty: empty() }, { ctx: dep(), expect: null }],
  linear_kappa: { ctx: tone(), expect: 18 / 23, tolerance: 1e-12, empty: empty() },
  level_rmse: { ctx: tone(), expect: Math.sqrt(1 / 5), tolerance: 1e-12, empty: empty() },
  level_bias: { ctx: tone(), expect: both(-0.2, /^scores low; on 5 shown rows$/), empty: empty() },
  // Ranks of the expected scores 5 2 1 3 4; of the labels 4.5 2.5 1 2.5 4.5 → 9 / √(10 · 9).
  score_spearman: { ctx: tone(), expect: 3 / Math.sqrt(10), tolerance: 1e-12, empty: empty() },
  off_by_two: [
    { ctx: tone(), expect: 0, empty: empty() },
    { ctx: fakeCtx({ items: [levels("0", "2"), levels("1", "1"), levels("3", "1"), levels("2", "1")], data: { type: "score" } }), expect: 0.5 },
  ],

  median_iou: [{ ctx: spot(), expect: (0.1368 / 0.16 + 0) / 2, tolerance: 1e-12, empty: empty() }, { ctx: dep(), expect: null }],
  iou_high: { ctx: spot(), expect: 0.5, empty: empty() },

  // Equal-width bins: 0.4–0.5 holds .45 and .40, both wrong: mean .425, right 0.
  max_calibration_error: { ctx: dep(), expect: both(0.425, /^in the 0\.4–0\.5 bin \(2 rows\); on 7 shown rows$/), empty: empty() },
  // Three bins of 2, 2, 3 rows by stated probability. department: (.40 .45 | .70 .82 | .88 .90 .95) → (2·.425 + 2·.24 +
  // 3·.09) / 7. urgent: (.50 .70 | .70✗ .80 | .88 .91 .95) → (2·.4 + 2·.25 + 3·(.91333…)→.08667) / 7 = 1.56 / 7.
  equal_count_ece: [
    { ctx: dep(), expect: both(1.6 / 7, /^3 bins; on 7 shown rows$/), empty: empty() },
    { ctx: urgent(), expect: 1.56 / 7, tolerance: 1e-12 },
  ],
  // Stated 5.1 / 7 against 5 / 7 right.
  overconfidence: { ctx: dep(), expect: both(0.1 / 7, /overconfident; on 7 shown rows$/), empty: empty() },
  // Brier .5118 / 7 against the base rate's 5/7 · 2/7 = 10/49.
  brier_skill: [
    { ctx: dep(), expect: 1 - (0.5118 / 7) / (10 / 49), tolerance: 1e-9, empty: empty() },
    { ctx: dep({ hide: [1, 5] }), expect: null },
  ],
  label_log_loss: [{ ctx: dep(), expect: depLogLoss, tolerance: 1e-12, empty: empty() }, { ctx: spot(), expect: null }],
  multiclass_brier: { ctx: dep(), expect: depMultiBrier, tolerance: 1e-12, empty: empty() },
  // .90 and .95 of seven.
  sharpness: { ctx: dep(), expect: 2 / 7, tolerance: 1e-12, empty: empty() },
  spiegelhalter: { ctx: dep(), expect: both(2 * normalSf(Math.abs(depZ)), new RegExp(`^Z = ${depZ.toFixed(3)};`), 1e-12), empty: empty() },

  // From the highest signal down the five right rows come first, then .20 (1 wrong of 6) and .12 (2 of 7):
  // (1/6 + 2/7) / 7 = 19/294, which is also the best possible ordering.
  aurc: { ctx: dep(), expect: both(19 / 294, /best possible 0\.064626, excess 0;/), empty: empty() },
  // department: both wrong rows have the lowest signals → 1. tone: .25 (right) comes before .40 (wrong) → 1/2.
  wrong_average_precision: [{ ctx: dep(), expect: 1, empty: empty() }, { ctx: tone(), expect: 0.5 }],
  // tone: at signal ≤ .40 every wrong row (1 of 1) but one right row of four.
  ks_separation: [
    { ctx: dep(), expect: both(1, /^largest at signal ≤ 0\.20/), empty: empty() },
    { ctx: tone(), expect: 0.75, tolerance: 1e-12 },
  ],
  // tone: the lowest right signal .25 sits below the wrong .40, so rows #4 (.25) and #2 (.40) overlap.
  overlap_rows: [{ ctx: dep(), expect: 0, empty: empty() }, { ctx: tone(), expect: both(2, /^signals 0\.25–0\.40 of 5 shown rows$/) }],
  // 0.76 automates .76 .84 .87 .93 (4 of 7, all right); 0.77 only three.
  accuracy_at_half: { ctx: dep(), expect: both(1, /^at threshold 0\.76 \(signal: confidence\): 4 of 4 automated right, 4 of 7 shown rows automated/), empty: empty() },
  // Only 0.12 and below automate at least 90% (all seven).
  accuracy_at_ninety: { ctx: dep(), expect: both(5 / 7, /^at threshold 0\.12/), empty: empty() },
  // yes rows .88 .50 .91 against no rows .30 .05 .70 .20: .50 loses to .70 → 11 of 12 pairs.
  yes_auroc: [{ ctx: urgent(), expect: 11 / 12, tolerance: 1e-12, empty: empty() }, { ctx: dep(), expect: null }],
  // From 0.31 to 0.50 every yes row clears and three of four no rows stay below: J = 0.75.
  youden_cut: { ctx: urgent(), expect: (r) => {
    assert.equal(r.value, 0.31);
    assert.equal(r.detail, "J 0.750 (sensitivity 100.0%, specificity 75.0%); the same J up to 0.50; on 7 shown rows");
  }, empty: empty() },

  classes_csv: {
    ctx: dep(),
    filename: "calibrate-department-options.csv",
    text: '"option","labeled","answered","right","answered wrongly","missed","precision","recall","F1"\r\n'
      + '"billing","2","3","2","1","0","0.6667","1.0000","0.8000"\r\n'
      + '"shipping","3","1","1","0","2","1.0000","0.3333","0.5000"\r\n'
      + '"wholesale","1","2","1","1","0","0.5000","1.0000","0.6667"\r\n'
      + '"other","1","1","1","0","0","1.0000","1.0000","1.0000"\r\n',
    excludes: ["espresso", "#"],
  },
  confusion_shares_csv: {
    ctx: dep(),
    filename: "calibrate-department-confusion-shares.csv",
    text: '"label \\ answer","billing","shipping","wholesale","other","rows"\r\n'
      + '"billing","1.0000","0.0000","0.0000","0.0000","2"\r\n'
      + '"shipping","0.3333","0.3333","0.3333","0.0000","3"\r\n'
      + '"wholesale","0.0000","0.0000","1.0000","0.0000","1"\r\n'
      + '"other","0.0000","0.0000","0.0000","1.0000","1"\r\n',
  },
  // A negative gap starts with "-", so the CSV writer guards it with an apostrophe like any formula-like cell.
  reliability_csv: {
    ctx: dep(),
    filename: "calibrate-department-reliability.csv",
    includes: ['"bin from","bin to","rows","mean stated","observed","hits","gap","low","high"\r\n',
      `"0.40","0.50","2","0.4250","0.0000","0","0.4250","0.0000","${f4(w02hi)}"\r\n`,
      `"0.80","0.90","2","0.8500","1.0000","2","'-0.1500","${f4(w22lo)}","1.0000"\r\n`],
    check: (out) => assert.equal(out.text.split("\r\n").length, 6),
  },
  // Every target is first reached at 0.21: rows .60 and up, 5 of 7, all right.
  targets_csv: {
    ctx: dep(),
    filename: "calibrate-department-targets.csv",
    includes: ['"target","basis","threshold","automated","share","accuracy","low","high","rows needed"\r\n',
      `"0.90","estimate","0.21","5","0.7143","1.0000","${f4(w55lo)}","1.0000","22"\r\n`,
      `"0.99","estimate","0.21","5","0.7143","1.0000","${f4(w55lo)}","1.0000","22"\r\n`],
  },
  // Seven rows in three groups of 2, 2 and 3 by signal: (.12 .20) both wrong, (.60 .76) and (.84 .87 .93) all right.
  signal_groups_csv: {
    ctx: dep(),
    filename: "calibrate-department-signal-groups.csv",
    text: '"group","lowest signal","highest signal","rows","right","accuracy","low","high"\r\n'
      + `"1","0.12","0.20","2","0","0.0000","0.0000","${f4(w02hi)}"\r\n`
      + `"2","0.60","0.76","2","2","1.0000","${f4(w22lo)}","1.0000"\r\n`
      + `"3","0.84","0.93","3","3","1.0000","${f4(w33lo)}","1.0000"\r\n`,
  },
  risk_coverage_csv: {
    ctx: dep(),
    filename: "calibrate-department-risk-coverage.csv",
    text: '"threshold","automated","share","wrong","share wrong"\r\n"0.93","1","0.1429","0","0.0000"\r\n"0.87","2","0.2857","0","0.0000"\r\n'
      + '"0.84","3","0.4286","0","0.0000"\r\n"0.76","4","0.5714","0","0.0000"\r\n"0.60","5","0.7143","0","0.0000"\r\n'
      + '"0.20","6","0.8571","1","0.1667"\r\n"0.12","7","1.0000","2","0.2857"\r\n',
  },
  summary_markdown: {
    ctx: dep(),
    filename: "calibrate-department-summary.md",
    includes: ["# Calibrate summary: department\n", "- Question: department (choice)\n", "- Signal: confidence; targets: on these rows\n",
      "- Labeled rows scored: 7 (answered without a label: 1; labels ignored: 0)\n",
      `- Accuracy on every scored row: 71.4% (95% interval ${pct(w57lo)}–${pct(w57hi)})\n`,
      "- Calibration error (the page's ECE): 0.1393\n",
      `- At threshold 0.50: 5 of 7 automated (71.4%), accuracy 100.0% (95% interval ${pct(w55lo)}–100.0%)\n`,
      `| 95.0% | 0.21 | 71.4% | 100.0% | ${pct(w55lo)}–100.0% |`, "not promised"],
    excludes: ["espresso", "Norway", "#1", "wholesale"],
  },
  // 23/37 = 0.6216216… prints to five significant digits; Noul-only metrics are blank for a Choice question.
  metrics_csv: {
    ctx: dep(),
    filename: "calibrate-department-metrics.csv",
    includes: ['"metric","value","basis"\r\n', '"Cohen\'s kappa between answers and labels","0.62162","observed 71.4%, chance 24.5%; on 7 shown rows"\r\n',
      '"Sensitivity (yes rows answered yes)","",""\r\n', '"Most frequent mistake","shipping → wholesale","1 of 2 wrong shown rows (50.0%)"\r\n'],
    excludes: ["espresso", "Norway"],
    check: (out) => assert.equal(out.text.split("\r\n").length, pack.features.filter((f) => f.kind === "metric").length + 2),
  },
}, { ctx: () => sampleCalibrateCtx() });

// Every metric stays quiet (no throw) on odd rows and an odd ctx.
const odd = fakeCtx({ items: [{ correct: true }, { correct: false, signal: "x", label: null, answer: { type: "box" } }], data: {} });
for (const feature of pack.features.filter((f) => f.kind === "metric")) feature.compute(odd);
