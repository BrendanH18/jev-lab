// Tests for the tb-calibration Toolbox pack. Reference values were worked out independently of the pack: by hand for
// the bins, blocks and saturated fits below, and in a separate stdlib Python script (exact fractions for the Brier and
// Murphy terms, math.log / math.erfc for the logs and normal tails, its own bisection for calibration-in-the-large).
// Saturated fits have closed forms: with two distinct inputs the logistic MLE reproduces each group's rate exactly.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-calibration.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

// Ten rows: 0.9 ×3 (2 positive), 0.7 ×2 (1), 0.3 ×3 (1), 0.1 ×2 (0). Base rate 0.4, mean probability 0.52.
const D = "probability,outcome\n0.9,1\n0.9,yes\n0.9,0\n0.7,true\n0.7,no\n0.3,0\n0.3,correct\n0.3,wrong\n0.1,0\n0.1,0";
// The same rows several to a line, separated by spaces, tabs and semicolons, with no header.
const D_PACKED = "0.9 1; 0.9 1; 0.9 0\n0.7\t1;0.7\t0\n0.3,0,0.3,1,0.3,0\n0.1 0 0.1 0";
const BAD = [{ pairs: "" }, { pairs: "0.5,maybe" }, { pairs: "0.5,1\n1.5,0" }, { pairs: "0.5,1,0" }, { pairs: "0.2,1\nabc,0" }];
// 0.2 ×4 (2 positive) and 0.8 ×4 (3 positive): logit 0.2 = −ln 4, so slope = (logit .75 − logit .5) / (2 ln 4) = ln 3 / (2 ln 4).
const SAT = "0.2,1\n0.2,1\n0.2,0\n0.2,0\n0.8,1\n0.8,1\n0.8,1\n0.8,0";
const V = "label,a,b,c\na,0.7,0.2,0.1\nb,0.2,0.5,0.3\nc,0.1,0.3,0.6\na,0.3,0.4,0.3";
const V_POSITIONS = "1;0.7;0.2;0.1\n2;0.2;0.5;0.3\n3;0.1;0.3;0.6\n1;0.3;0.4;0.3";
const BAD_VECTORS = [{ rows: "" }, { rows: "label,a,b\nz,0.5,0.5" }, { rows: "1,0.5,0.6" }, { rows: "1,0.5,0.5\n2,0.5" }, { rows: "label,a,a\na,0.5,0.5" }, { rows: "4,0.5,0.5" }];
const LN9 = "2.1972245773362196";
const WILSON_1_5 = [0.036224108632430085, 0.6244653702374747];   // Wilson 95% for 1 of 5 (Python reference)

const rowsNear = (expected, tolerance = 1e-9) => (result) => {
  assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
  expected.forEach(([label, value], i) => approx(result.rows[i][1], value, tolerance, label));
};
const tableNear = (columns, rows, tolerance = 1e-9) => (result) => {
  assert.deepEqual(result.table.columns, columns);
  assert.equal(result.table.rows.length, rows.length);
  rows.forEach((row, i) => row.forEach((cell, j) => approx(result.table.rows[i][j], cell, tolerance, `row ${i + 1} cell ${j + 1}:`)));
};

checkPack(pack, {
  // Σ (p − y)² = 4·0.01 + 0.81 + 3·0.09 + 2·0.49 = 2.10 over 10 rows; reference 0.4·0.6 = 0.24; skill 1 − 0.21/0.24.
  brier_score: { values: { pairs: D }, expect: [["Brier score", 0.21], ["Base rate", 0.4], ["Brier score of always predicting the base rate", 0.24], ["Brier skill score", 0.125], ["Rows", 10]],
    more: [{ values: { pairs: D_PACKED }, expect: [["Brier score", 0.21], ["Base rate", 0.4], ["Brier score of always predicting the base rate", 0.24], ["Brier skill score", 0.125], ["Rows", 10]] },
      { values: { pairs: "0.8,1\n0.6,1" }, expect: [["Brier score", 0.1], ["Base rate", 1], ["Brier score of always predicting the base rate", 0], ["Brier skill score", null], ["Rows", 2]] }],
    invalid: BAD },
  // reliability = (3(0.9 − 2/3)² + 2(0.2)² + 3(0.3 − 1/3)² + 2(0.1)²)/10 = 2/75; resolution = 17/300 (exact fractions).
  murphy_decomposition: { values: { pairs: D }, expect: [["Reliability", 2 / 75], ["Resolution", 17 / 300], ["Uncertainty", 0.24], ["Brier score (reliability − resolution + uncertainty)", 0.21], ["Distinct probabilities", 4]],
    invalid: BAD },
  // −(4 ln 0.9 + 3 ln 0.7 + 2 ln 0.3 + ln 0.1)/10; base rate −(0.4 ln 0.4 + 0.6 ln 0.6).
  log_loss: { values: { pairs: D }, expect: [["Log loss (nats)", 0.620199759609342], ["Log loss (bits)", 0.894759117548925], ["Log loss of always predicting the base rate (nats)", 0.6730116670092565],
    ["Skill against the base rate", 0.07847101319149663], ["Sure misses (0 or 1 on the wrong side)", 0], ["Rows", 10]],
  more: [
    // a sure miss: infinite without clipping, −ln(1e-15)/2 with sklearn's clip
    { values: { pairs: "0,1\n0.5,0", eps: "0" }, expect: [["Log loss (nats)", null], ["Log loss (bits)", null], ["Log loss of always predicting the base rate (nats)", Math.LN2],
      ["Skill against the base rate", null], ["Sure misses (0 or 1 on the wrong side)", 1], ["Rows", 2]] },
    { values: { pairs: "0,1\n0.5,0" }, expect: (result) => approx(result.rows[0][1], (-Math.log(1e-15) + Math.LN2) / 2) },
  ],
  invalid: [...BAD, { pairs: D, eps: "0.2" }] },
  spherical_score: { values: { pairs: D }, expect: [["Spherical score", 0.7631240151981832], ["Score of always predicting the base rate", 0.7211102550927979], ["Rows", 10]],
    more: [{ values: { pairs: "1,1\n0,0" }, expect: [["Spherical score", 1], ["Score of always predicting the base rate", Math.SQRT1_2], ["Rows", 2]] }], invalid: BAD },
  // Bins 0.1, 0.3, 0.7, 0.9 (10 bins): |0 − 0.2| + |1 − 0.9| + |1 − 1.4| + |2 − 2.7| = 1.4 over 10 rows. Two bins: |1 − 1.1| + |3 − 4.1| = 1.2.
  ece_equal_width: { values: { pairs: D }, expect: [["Expected calibration error", 0.14], ["Mean probability", 0.52], ["Observed rate", 0.4], ["Nonempty bins", 4], ["Rows", 10]],
    more: [{ values: { pairs: D, bins: "2" }, expect: [["Expected calibration error", 0.12], ["Mean probability", 0.52], ["Observed rate", 0.4], ["Nonempty bins", 2], ["Rows", 10]] },
      // 0.3·10 and 0.7·10 sit on bin edges and go up; 1 goes to the last bin
      { values: { pairs: "0.3,1\n0.7,0\n1,1", bins: "10" }, expect: (result) => { approx(result.rows[0][1], (0.7 + 0.7 + 0) / 3); approx(result.rows[3][1], 3); } }],
    invalid: [...BAD, { pairs: D, bins: "0" }, { pairs: D, bins: "2.5" }] },
  // Three bins by sorted position: 0.1 starts at 0 → bin 0; 0.3 at 2 → ⌊6/10⌋ = 0; 0.7 at 5 → 1; 0.9 at 7 → 2. Gaps 0.1 + 0.4 + 0.7 = 1.2.
  ece_equal_mass: { values: { pairs: D, bins: "3" }, expect: [["Expected calibration error", 0.12], ["Nonempty bins", 3], ["Smallest bin (rows)", 2], ["Largest bin (rows)", 5], ["Rows", 10]],
    // two bins {0.1, 0.2} and {0.3, 0.4}: |0 − 0.3| + |2 − 0.7| = 1.6 over 4 rows
    more: [{ values: { pairs: "0.1,0\n0.2,0\n0.3,1\n0.4,1", bins: "2" }, expect: [["Expected calibration error", (0.3 + 1.3) / 4], ["Nonempty bins", 2], ["Smallest bin (rows)", 2], ["Largest bin (rows)", 2], ["Rows", 4]] }],
    invalid: [...BAD, { pairs: D, bins: "101" }] },
  // Per-bin gaps: 0.9 → 0.7/3, 0.7 → 0.2, 0.3 → 0.1/3, 0.1 → 0.1; the worst is the 0.9 bin, observed below predicted.
  max_calibration_error: { values: { pairs: D }, expect: [["Maximum calibration error", 0.7 / 3], ["Bin from", 0.9], ["Bin to", 1], ["Rows in that bin", 3],
    ["Observed rate − mean probability there", -0.7 / 3], ["Bins counted", 4]],
  more: [
    { values: { pairs: D, minRows: "4" }, expect: [["Maximum calibration error", null], ["Bin from", null], ["Bin to", null], ["Rows in that bin", null], ["Observed rate − mean probability there", null], ["Bins counted", 0]] },
    // at least 3 rows: only the 0.3 bin (gap 0.1/3) and the 0.9 bin (0.7/3) count
    { values: { pairs: D, minRows: "3" }, expect: [["Maximum calibration error", 0.7 / 3], ["Bin from", 0.9], ["Bin to", 1], ["Rows in that bin", 3], ["Observed rate − mean probability there", -0.7 / 3], ["Bins counted", 2]] },
    // equal mass, 3 bins: [0.1–0.3] gap 0.1/5, [0.7] 0.2, [0.9] 0.7/3
    { values: { pairs: D, binning: "mass", bins: "3", minRows: "1" }, expect: (result) => { approx(result.rows[0][1], 0.7 / 3); approx(result.rows[1][1], 0.9); approx(result.rows[5][1], 3); } },
  ],
  invalid: [...BAD, { pairs: D, binning: "quantile" }] },
  // Wilson 95% intervals for 0/2, 1/3, 1/2 and 2/3 from the Python reference.
  reliability_table: { values: { pairs: D }, expect: tableNear(["From", "To", "Rows", "Mean probability", "Observed rate", "Gap (observed − predicted)", "Interval low", "Interval high"], [
    [0.1, 0.2, 2, 0.1, 0, -0.1, 0, 0.6576197724933469], [0.3, 0.4, 3, 0.3, 1 / 3, 1 / 30, 0.06149194472039615, 0.7923403991979523],
    [0.7, 0.8, 2, 0.7, 0.5, -0.2, 0.09453120573423074, 0.9054687942657693], [0.9, 1, 3, 0.9, 2 / 3, -0.7 / 3, 0.20765960080204765, 0.9385080552796037]]),
  more: [{ values: { pairs: D, binning: "mass", bins: "3" }, expect: tableNear(["From", "To", "Rows", "Mean probability", "Observed rate", "Gap (observed − predicted)", "Interval low", "Interval high"], [
    [0.1, 0.3, 5, 0.22, 0.2, -0.02, WILSON_1_5[0], WILSON_1_5[1]], [0.7, 0.7, 2, 0.7, 0.5, -0.2, 0.09453120573423074, 0.9054687942657693],
    [0.9, 0.9, 3, 0.9, 2 / 3, -0.7 / 3, 0.20765960080204765, 0.9385080552796037]]) }],
  invalid: [...BAD, { pairs: D, level: "0.5" }] },
  // Saturated: slope ln 3 / (2 ln 4), intercept ln 3 / 2; calibration-in-the-large solves 4σ(a − ln 4) + 4σ(a + ln 4) = 5.
  calibration_slope: { values: { pairs: SAT }, expect: [["Calibration slope", 0.3962406251802891], ["Calibration intercept", 0.5493061443340549], ["Calibration-in-the-large", 0.7797298806731146]],
    tolerance: 1e-8,
    more: [
      // calibrated in the large: slope ln3/ln4 when 0.2 → 1/4 and 0.8 → 3/4
      { values: { pairs: "0.2,1\n0.2,0\n0.2,0\n0.2,0\n0.8,1\n0.8,1\n0.8,1\n0.8,0" }, expect: [["Calibration slope", Math.log(3) / Math.log(4)], ["Calibration intercept", 0], ["Calibration-in-the-large", 0]], tolerance: 1e-8 },
      // not saturated: slope and intercept from a separate Newton fit in Python (math.exp only), which also matched plain gradient descent
      { values: { pairs: D }, expect: [["Calibration slope", 0.6756457527514371], ["Calibration intercept", -0.6215267666002972], ["Calibration-in-the-large", -0.8057019838777159]], tolerance: 1e-8 },
      { values: { pairs: "0.2,0\n0.8,1\n0.6,1" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /separated/); } },
    ],
    invalid: [...BAD, { pairs: "0.2,1\n0.8,1" }, { pairs: "0.3,1\n0.3,0" }] },
  // One group per distinct probability (5 asked, 4 formed): H = Σ (O − E)²/E + (N − O − (N − E))²/(N − E) = 2.43386…, df 2, p = e^(−H/2).
  hosmer_lemeshow: { values: { pairs: D, groups: "5" }, expect: (result) => {
    rowsNear([["H statistic", 2.433862433862434], ["Degrees of freedom", 2], ["p-value", 0.296137555839429], ["Groups", 4]])(result);
    tableNear(["Group", "Rows", "Lowest probability", "Highest probability", "Observed positives", "Expected positives"],
      [[1, 2, 0.1, 0.1, 0, 0.2], [2, 3, 0.3, 0.3, 1, 0.9], [3, 2, 0.7, 0.7, 1, 1.4], [4, 3, 0.9, 0.9, 2, 2.7]])(result);
  },
  more: [{ values: { pairs: D, groups: "4" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.equal(result.rows[3][1], 2); } },
    { values: { pairs: "0,0\n0.5,1\n0.6,0\n0.7,1" , groups: "4" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /undefined/); } }],
  invalid: [...BAD, { pairs: D, groups: "2" }] },
  // Row sums of squared gaps 0.14, 0.38, 0.26, 0.74 → 0.38; label shares ½, ¼, ¼ → reference 1 − 0.375 = 0.625; the last row's top (b) is wrong.
  multiclass_brier: { values: { rows: V }, expect: [["Multi-class Brier score (0 to 2)", 0.38], ["Halved (0 to 1)", 0.19], ["Brier score of predicting the label shares", 0.625],
    ["Skill against the label shares", 0.392], ["Top-choice accuracy", 0.75], ["Rows", 4], ["Options", 3]],
  more: [{ values: { rows: V_POSITIONS }, expect: (result) => approx(result.rows[0][1], 0.38) },
    { values: { rows: "1,0.7,0.2,0.105" }, expect: (result) => { approx(result.rows[0][1], ((0.7 / 1.005 - 1) ** 2 + (0.2 / 1.005) ** 2 + (0.105 / 1.005) ** 2)); assert.match(result.note, /rescaled/); } }],
  invalid: BAD_VECTORS },
  multiclass_log_loss: { values: { rows: V }, expect: [["Log loss (nats)", 0.6911551381476512], ["Log loss (bits)", 0.9971260902905428], ["Perplexity", 1.9960198807747331],
    ["Log loss of a uniform guess (nats)", 1.0986122886681098], ["Log loss of predicting the label shares (nats)", 1.0397207708399179], ["Skill against the label shares", 0.33524927313963815], ["Rows", 4]],
  more: [{ values: { rows: "1,0,1\n2,0.5,0.5", eps: "0" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.equal(result.rows[2][1], null); } }],
  invalid: BAD_VECTORS },
  // Top probabilities 0.7, 0.5, 0.6, 0.4 (right, right, right, wrong); ECE bins 7, 5, 6, 4: (0.3 + 0.5 + 0.4 + 0.4)/4.
  top_label_calibration: { values: { rows: V }, expect: [["Top-choice accuracy", 0.75], ["Mean top probability", 0.55], ["Overconfidence (confidence − accuracy)", -0.2], ["Top-choice ECE", 0.4], ["Rows", 4]],
    more: [{ values: { rows: "1,0.5,0.5\n2,0.5,0.5" }, expect: (result) => approx(result.rows[0][1], 0.5) }],   // a tie goes to the first option
    invalid: [...BAD_VECTORS, { rows: V, bins: "0" }] },
  // (0.01 + 0.16)/2, (0.25 + 0.04)/2, (0.04 + 0.04)/2 → 0.09; shares ⅓ each → 5/18, 5/18, 1/9 → 2/9; skill 1 − 0.09·9/2.
  ranked_probability_score: { values: { rows: "level,1,2,3\n3,0.1,0.3,0.6\n1,0.5,0.3,0.2\n2,0.2,0.6,0.2" },
    expect: [["Ranked probability score", 0.09], ["Score of predicting the level shares", 2 / 9], ["Skill against the level shares", 0.595], ["Rows", 3], ["Levels", 3]],
    more: [{ values: { rows: "2,0,1\n1,1,0" }, expect: [["Ranked probability score", 0], ["Score of predicting the level shares", 0.25], ["Skill against the level shares", 1], ["Rows", 2], ["Levels", 2]] },
      // levels named 0, 1, 2 on the header: labels are those names, the same rows as above
      { values: { rows: "level,0,1,2\n2,0.1,0.3,0.6\n0,0.5,0.3,0.2\n1,0.2,0.6,0.2" }, expect: [["Ranked probability score", 0.09], ["Score of predicting the level shares", 2 / 9], ["Skill against the level shares", 0.595], ["Rows", 3], ["Levels", 3]] }],
    // with numeric level names a 3 is not read as the third position
    invalid: [...BAD_VECTORS, { rows: "level,0,1,2\n3,0.1,0.3,0.6" }] },
  // Scores −1 (1 of 4 positive) and 1 (3 of 4). Smoothed targets 5/6 and 1/6 make the group means 1/3 and 2/3, so a = ln 2, b = 0.
  platt_fit: { values: { pairs: "-1,1\n-1,0\n-1,0\n-1,0\n1,1\n1,1\n1,1\n1,0" }, tolerance: 1e-8, expect: (result) => {
    rowsNear([["Slope (a)", Math.LN2], ["Intercept (b)", 0], ["Log loss after (nats)", 0.5787519032481507], ["Log loss before (nats)", null], ["Rows", 8]], 1e-8)(result);
    tableNear(["Score", "Rows", "Recalibrated probability"], [[-1, 4, 1 / 3], [1, 4, 2 / 3]], 1e-8)(result);
  },
  more: [
    // without smoothing the groups' rates ¼ and ¾ are fitted exactly: a = ln 3
    { values: { pairs: "-1,1\n-1,0\n-1,0\n-1,0\n1,1\n1,1\n1,1\n1,0", smooth: false }, expect: (result) => { approx(result.rows[0][1], Math.log(3), 1e-8); approx(result.rows[1][1], 0, 1e-8); } },
    // on log-odds of 0.2 and 0.8 (±ln 4): a = ln 2 / ln 4 = 0.5; log loss before −(2 ln 0.2 + 6 ln 0.8)/8
    { values: { pairs: "0.2,1\n0.2,0\n0.2,0\n0.2,0\n0.8,1\n0.8,1\n0.8,1\n0.8,0", feature: "logodds" }, expect: (result) => {
      approx(result.rows[0][1], 0.5, 1e-8); approx(result.rows[1][1], 0, 1e-8); approx(result.rows[3][1], 0.5697171415941824, 1e-8);
    } },
    { values: { pairs: "-1,0\n1,1", smooth: false }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /separated/); } },
  ],
  invalid: [...BAD.slice(0, 2), { pairs: "1,1\n1,0" }, { pairs: "1.5,1\n0.5,0", feature: "logodds" }, { pairs: "1,1\n2,1" }] },
  // σ(0.5 · ln(0.2/0.8)) = σ(−ln 2) = 1/3; σ(2·0 − 1), σ(0), σ(1).
  platt_apply: { values: { a: "0.5", b: "0", feature: "logodds", scores: "0.2, 0.8\n0.5" }, expect: tableNear(["Score", "Recalibrated probability"], [[0.2, 1 / 3], [0.8, 2 / 3], [0.5, 0.5]]),
    more: [{ values: { a: "2", b: "-1", scores: "0 0.5 1" }, expect: tableNear(["Score", "Recalibrated probability"], [[0, 0.2689414213699951], [0.5, 0.5], [1, 0.7310585786300049]]) }],
    invalid: [{ a: "1", b: "0", scores: "" }, { a: "1", b: "0", scores: "0.2, x" }, { a: "1", b: "0", feature: "logodds", scores: "1.2" }, { b: "0", scores: "0.5" }] },
  // Pooling by hand: [0.2] 1 and [0.3] 0 pool to ½; [0.4] 1, [0.5] ½ pool to ⅔; [0.6] 0 pools to ½, equal to the block before, so they join: 3 of 6.
  isotonic_fit: { values: { pairs: "0.1,0\n0.2,1\n0.3,0\n0.4,1\n0.5,1\n0.5,0\n0.6,0\n0.8,1" }, expect: (result) => {
    rowsNear([["Blocks", 3], ["Brier score before", 0.25], ["Brier score after", 1.5 / 8]])(result);
    tableNear(["From score", "To score", "Rows", "Positives", "Fitted probability"], [[0.1, 0.1, 1, 0, 0], [0.2, 0.6, 6, 3, 0.5], [0.8, 0.8, 1, 1, 1]])(result);
  },
  // sorted −2 (0), 3 (0), 5 (1): the two equal rates 0 join one block, so the fit is exact
  more: [{ values: { pairs: "5,1\n-2,0\n3,0" }, expect: (result) => {
    rowsNear([["Blocks", 2], ["Brier score before", null], ["Brier score after", 0]])(result);
    tableNear(["From score", "To score", "Rows", "Positives", "Fitted probability"], [[-2, 3, 2, 0, 0], [5, 5, 1, 1, 1]])(result);
  } }],
  invalid: BAD.slice(0, 2) },
  // Logits (0, ln 9) for every row, three labeled 2 and one labeled 1: σ(ln 9 / T) must be ¾, so ln 9 / T = ln 3 and T = 2.
  temperature_fit: { values: { rows: `label,no,yes\nyes,0,${LN9}\nyes,0,${LN9}\nyes,0,${LN9}\nno,0,${LN9}` }, tolerance: 1e-9,
    expect: [["Temperature", 2], ["Log loss at T = 1 (nats)", 0.6546666599918811], ["Top-choice accuracy", 0.75], ["Mean top probability at T = 1", 0.9],
      ["Log loss at the fitted temperature (nats)", 0.5623351446188083], ["Mean top probability at the fitted temperature", 0.75], ["Rows", 4]],
    more: [
      { values: { rows: "1,2,0\n2,0,2" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /toward 0/); } },
      { values: { rows: "2,2,0\n1,0,2" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /no finite temperature/); } },
    ],
    invalid: [{ rows: "" }, { rows: "1,2,x" }, { rows: "label,a,b\nc,1,2" }, { rows: "1,2" }] },
  // softmax((0, ln 9)/2) = (¼, ¾); equal logits split evenly and the tie goes to the first option.
  temperature_apply: { values: { temperature: "2", rows: `a,b\n0,${LN9}\n1,1` }, expect: (result) => {
    assert.deepEqual(result.table.columns, ["Row", "a", "b", "Top option"]);
    approx(result.table.rows[0][1], 0.25); approx(result.table.rows[0][2], 0.75); assert.equal(result.table.rows[0][3], "b");
    approx(result.table.rows[1][1], 0.5); assert.equal(result.table.rows[1][3], "a");
  },
  more: [{ values: { temperature: "1", rows: "0 0 0" }, expect: (result) => { assert.deepEqual(result.table.columns, ["Row", "1", "2", "3", "Top option"]); approx(result.table.rows[0][2], 1 / 3); } }],
  invalid: [{ temperature: "0", rows: "1,2" }, { temperature: "1", rows: "" }, { temperature: "1", rows: "1,2\n3" }, { temperature: "0.000001", rows: "1e303,0" }] },
  // E = 5.2, O = 4, Σ p(1 − p) = 1.5; above 0.5: E = 4.1, O = 3, variance 0.69.
  observed_vs_expected: { values: { pairs: D }, expect: [["Rows checked", 10], ["Expected positives", 5.2], ["Observed positives", 4], ["Observed ÷ expected", 4 / 5.2], ["Observed − expected", -1.2],
    ["z", -0.9797958971132714], ["Two-sided p-value", 0.32718687779030553]],
  more: [{ values: { pairs: D, minimum: "0.5" }, expect: [["Rows checked", 5], ["Expected positives", 4.1], ["Observed positives", 3], ["Observed ÷ expected", 0.7317073170731708], ["Observed − expected", -1.1],
    ["z", -1.3242443839434608], ["Two-sided p-value", 0.18542189470595982]] },
  { values: { pairs: D, minimum: "0.95" }, expect: [["Rows checked", 0], ["Expected positives", null], ["Observed positives", null], ["Observed ÷ expected", null], ["Observed − expected", null], ["z", null], ["Two-sided p-value", null]] }],
  invalid: [...BAD, { pairs: D, minimum: "2" }] },
  // Σ (y − p)(1 − 2p) = 0.6 and Σ (1 − 2p)² p(1 − p) = 0.456 (exact fractions).
  spiegelhalter_z: { values: { pairs: D }, expect: [["z", 0.8885233166386387], ["Two-sided p-value", 0.3742593192802244], ["Rows", 10]],
    more: [{ values: { pairs: "0.5,1\n0.5,0\n1,1" }, expect: [["z", null], ["Two-sided p-value", null], ["Rows", 3]] }], invalid: BAD },
  compare_forecasts: { values: { rows: "a,b,outcome\n0.8,0.6,1\n0.3,0.5,0\n0.6,0.9,0 0.9,0.7,1" },
    expect: [["Score of A", 0.125], ["Score of B", 0.3275], ["Difference (A − B)", -0.2025], ["Standard error of the difference", 0.08410063416328481], ["z", -2.407829643791247],
      ["Two-sided p-value", 0.01604766731223134], ["Lower (better) score", "A"], ["Rows", 4]],
    more: [{ values: { rows: "0.8,0.6,1\n0.3,0.5,0\n0.6,0.9,0\n0.9,0.7,1", score: "log" }, expect: [["Score of A", 0.40036743569623084], ["Score of B", 0.9658082103146786], ["Difference (A − B)", -0.5654407746184477],
      ["Standard error of the difference", 0.2741733727585457], ["z", -2.062347517300341], ["Two-sided p-value", 0.0391746621288284], ["Lower (better) score", "A"], ["Rows", 4]] },
    { values: { rows: "0.5,0.5,1\n0.5,0.5,0" }, expect: (result) => { assert.equal(result.rows[4][1], null); assert.equal(result.rows[6][1], "neither"); } }],
    invalid: [{ rows: "0.5,0.5,1" }, { rows: "0.5,1\n0.4,0" }, { rows: "0.5,0.5,maybe\n0.1,0.2,1" }] },
  // Running sums after each run: 0.1 → (0 − 0.2)/10, 0.3 → (1 − 1.1)/10, 0.7 → (2 − 2.5)/10, 0.9 → (4 − 5.2)/10.
  ks_calibration: { values: { pairs: D }, expect: [["KS calibration error", 0.12], ["Up to probability", 0.9], ["Outcomes there run", "below the probabilities"], ["Rows", 10]],
    more: [{ values: { pairs: "0.2,1\n0.4,0" }, expect: [["KS calibration error", 0.4], ["Up to probability", 0.2], ["Outcomes there run", "above the probabilities"], ["Rows", 2]] }],
    invalid: BAD },
  // Wilson 95%: 0/1 → (0, 0.79345…), 2/2 → (0.34238…, 1), 1/2 → (0.09453…, 0.90547…).
  calibration_by_group: { values: { rows: "group,probability,outcome\nweb,0.9,1\nweb,0.7,0\nphone,0.6,1\nphone,0.4,yes\nemail,0.2,0" }, expect: (result) => {
    rowsNear([["Groups", 3], ["Largest absolute gap", 0.5], ["Group with the largest gap", "phone"]])(result);
    tableNear(["Group", "Rows", "Mean probability", "Observed rate", "Gap (observed − predicted)", "95% low", "95% high"], [
      ["email", 1, 0.2, 0, -0.2, 0, 0.7934506856227626], ["phone", 2, 0.5, 1, 0.5, 0.34238022750665303, 1], ["web", 2, 0.8, 0.5, -0.3, 0.09453120573423074, 0.9054687942657693]])(result);
  },
  more: [{ values: { rows: "gift card\t0.3\t1\ngift card\t0.5\t0" }, expect: (result) => { assert.equal(result.table.rows[0][0], "gift card"); approx(result.table.rows[0][4], 0.1); } }],
  invalid: [{ rows: "" }, { rows: "web,0.9" }, { rows: "web,1.9,1" }, { rows: ",0.5,1" }, { rows: "web,0.5,maybe" }] },
}, { ctx: () => fakeCtx({}) });
