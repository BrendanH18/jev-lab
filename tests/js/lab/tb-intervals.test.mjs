// Tests for the tb-intervals pack. Reference values come from published examples where one exists (R's
// poisson.test(137, 24.19893): 5.661407, 4.753125 to 6.692709; Newcombe 1998 Table I, 81/263 with the corrected Wilson
// interval 0.2535 to 0.3682) and otherwise from a separate Python computation with the standard library only, built
// differently from the pack: score and mid-p equations solved by bisection instead of closed forms, Beta tails from
// exact binomial sums (whole-number shapes) or from the I_x(1/2, 1/2) = (2/π) asin √x recurrence (half-integer shapes),
// exact fractions for binomial, hypergeometric and beta-binomial sums, Student t and chi-square quantiles from their
// closed-form distribution functions, Koopman's interval from the four-cell Pearson statistic with the restricted
// maximum found by bisection on the likelihood's slope, the posterior comparison by integrating f_A (1 − F_B) exactly,
// and Goodman's bounds as roots of (N² + AN)x² − (2nN + AN)x + n² = 0.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tb-intervals.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const near = (actual, expected, tolerance = 1e-9) => approx(actual, expected, tolerance);
const tableLike = (result, expected, tolerance = 1e-9) => {
  assert.deepEqual(result.table.columns, expected.columns);
  assert.equal(result.table.rows.length, expected.rows.length);
  expected.rows.forEach((row, i) => { assert.equal(result.table.rows[i].length, row.length); row.forEach((cell, j) => near(result.table.rows[i][j], cell, tolerance)); });
};
const Z95 = 1.959963984540054;

checkPack(pack, {
  // 3 of 20: 0.15 ± 1.96 √(0.15 · 0.85 / 20); 0 of 20 collapses to [0, 0] while Wilson reaches 0.1611.
  wald_interval: {
    values: { k: "3", n: "20", level: "0.95" },
    expect: [["Proportion", 0.15], ["Lower bound (not clipped)", -0.006490574738305055], ["Upper bound (not clipped)", 0.30649057473830504],
      ["Runs outside 0 to 1", "yes"], ["Collapses to a single point", "no"], ["Wilson lower bound, for comparison", 0.05236874589621661],
      ["Wilson upper bound, for comparison", 0.3604188647407569]],
    more: [{ values: { k: "0", n: "20", level: "0.95" }, expect: [["Proportion", 0], ["Lower bound (not clipped)", 0], ["Upper bound (not clipped)", 0],
      ["Runs outside 0 to 1", "no"], ["Collapses to a single point", "yes"], ["Wilson lower bound, for comparison", 0], ["Wilson upper bound, for comparison", 0.1611251580528193]] }],
    invalid: [{ k: "21", n: "20", level: "0.95" }, { k: "3", n: "0", level: "0.95" }, { k: "3", n: "20", level: "0.8" }],
  },
  wilson_corrected: {
    values: { k: "81", n: "263", level: "0.95" },
    expect: [["Proportion", 81 / 263], ["Lower bound", 0.2535086822951852], ["Upper bound", 0.3681762010430035], ["Interval width", 0.3681762010430035 - 0.2535086822951852]],
    more: [{ values: { k: "0", n: "20", level: "0.95" }, expect: [["Proportion", 0], ["Lower bound", 0], ["Upper bound", 0.20045334501348694], ["Interval width", 0.20045334501348694]] }],
    invalid: [{ k: "5", n: "4", level: "0.95" }],
  },
  // ñ = n + z², p̃ = (k + z²/2) / ñ.
  agresti_coull: {
    values: { k: "15", n: "148", level: "0.95" },
    expect: [["Proportion", 15 / 148], ["Adjusted trials (n + z²)", 148 + Z95 * Z95], ["Adjusted proportion", 0.11143682062702215],
      ["Lower bound", 0.061385974928797285], ["Upper bound", 0.16148766632524703]],
    more: [{ values: { k: "0", n: "20", level: "0.95" }, expect: (result) => { near(result.rows[3][1], 0); near(result.rows[4][1], 0.18980956054248876); } }],
    invalid: [{ k: "30", n: "20", level: "0.95" }],
  },
  jeffreys_interval: {
    values: { k: "15", n: "148", level: "0.95" },
    expect: [["Proportion", 15 / 148], ["Lower bound", 0.060448517009320704], ["Upper bound", 0.1576431434787427]],
    more: [{ values: { k: "0", n: "20", level: "0.95" }, expect: [["Proportion", 0], ["Lower bound", 0], ["Upper bound", 0.11663898290487601]] }],
    invalid: [{ k: "21", n: "20", level: "0.95" }],
  },
  mid_p_interval: {
    values: { k: "15", n: "148", level: "0.95" },
    expect: [["Proportion", 15 / 148], ["Lower bound", 0.06006360266553215], ["Upper bound", 0.1581217330506119]],
    more: [{ values: { k: "0", n: "20", level: "0.95" }, expect: [["Proportion", 0], ["Lower bound", 0], ["Upper bound", 0.13910834066826522]] }],
    invalid: [{ k: "1", n: "100001", level: "0.95" }, { k: "21", n: "20", level: "0.95" }],
  },
  interval_methods: {
    values: { k: "3", n: "20", level: "0.95" },
    expect: (result) => {
      const rows = [["Wald", -0.006490574738305055, 0.30649057473830504], ["Wilson", 0.05236874589621661, 0.3604188647407569],
        ["Wilson with continuity correction", 0.039566271702555444, 0.3886251218432889], ["Agresti–Coull", 0.04393901127651956, 0.368848599360454],
        ["Jeffreys", 0.04413134197515911, 0.3485777108584548], ["Clopper–Pearson (exact)", 0.03207093718546372, 0.37892682654531396],
        ["Mid-p exact", 0.03961978432915211, 0.3561073603136117], ["Logit", 0.04917343611801944, 0.37584451018251896], ["Arcsine", 0.03154932398421739, 0.33460705383028444]];
      tableLike(result, { columns: ["Method", "Lower bound", "Upper bound", "Width"], rows: rows.map(([name, low, high]) => [name, low, high, high - low]) });
    },
    more: [{ values: { k: "0", n: "20", level: "0.95" }, expect: (result) => {
      assert.deepEqual(result.table.rows[7], ["Logit", null, null, null]);   // undefined at 0 successes
      near(result.table.rows[8][2], Math.sin(Z95 / (2 * Math.sqrt(20))) ** 2);
    } }],
    invalid: [{ k: "21", n: "20", level: "0.95" }],
  },
  // Exact sums over k = 0..30 of Bin(30, 0.1): Wald covers 0.8085, Wilson 0.9742.
  interval_coverage: {
    values: { n: "30", p: "0.1", level: "0.95", method: "wald" },
    expect: [["Actual coverage", 0.8085213615694752], ["Nominal coverage", 0.95], ["Actual minus nominal", 0.8085213615694752 - 0.95], ["Expected interval width", 0.201359090991065]],
    more: [{ values: { n: "30", p: "0.1", level: "0.95", method: "wilson" }, expect: (result) => { near(result.rows[0][1], 0.9741732113380901); near(result.rows[3][1], 0.21497997094835536); } }],
    invalid: [{ n: "30", p: "0", level: "0.95", method: "wald" }, { n: "2001", p: "0.1", level: "0.95", method: "wald" }, { n: "30", p: "0.1", level: "0.95", method: "logit" }],
  },
  // 8 of 10 with a uniform prior: Beta(9, 3), mean 3/4, mode 8/10, sd √(27 / (144 · 13)).
  beta_posterior: {
    values: { k: "8", n: "10", a: "1", b: "1", level: "0.95" },
    expect: [["Posterior a", 9], ["Posterior b", 3], ["Posterior mean", 0.75], ["Posterior mode", 0.8], ["Posterior standard deviation", Math.sqrt(27 / (144 * 13))],
      ["Lower 95% credible bound", 0.48224414763982726], ["Upper 95% credible bound", 0.9397822658270933]],
    more: [{ values: { k: "8", n: "10", a: "0.5", b: "0.5", level: "0.95" }, expect: (result) => { near(result.rows[5][1], 0.49722550356000605); near(result.rows[6][1], 0.9559405864473691); } },
      { values: { k: "0", n: "3", a: "1", b: "1", level: "0.95" }, expect: (result) => assert.equal(result.rows[3][1], null) }],
    invalid: [{ k: "8", n: "10", a: "0", b: "1", level: "0.95" }],
  },
  // Beta(189, 13): P(p > 0.9) = P(Bin(201, 0.9) <= 188), summed exactly.
  probability_above_target: {
    values: { k: "188", n: "200", target: "0.9", a: "1", b: "1" },
    expect: [["Posterior mean accuracy", 189 / 202], ["Chance the accuracy is above the target", 0.9694791707657539], ["Chance it is at or below the target", 0.030520829234246184]],
    // Jeffreys prior: Beta(188.5, 12.5), I_0.1(12.5, 188.5) from the all-positive power series of the incomplete beta.
    more: [{ values: { k: "188", n: "200", target: "0.9", a: "0.5", b: "0.5" }, expect: (result) => { near(result.rows[0][1], 188.5 / 201); near(result.rows[1][1], 0.9765653355684991, 1e-12); } }],
    invalid: [{ k: "188", n: "200", target: "1", a: "1", b: "1" }, { k: "201", n: "200", target: "0.9", a: "1", b: "1" }],
  },
  // A Beta(9, 3), B Beta(10, 2): P(pB > pA) = 94/133 exactly.
  probability_b_beats_a: {
    values: { kA: "8", nA: "10", kB: "9", nB: "10", a: "1", b: "1" },
    expect: [["Posterior mean of A", 0.75], ["Posterior mean of B", 10 / 12], ["Chance B is above A", 94 / 133], ["Chance A is above B", 39 / 133]],
    invalid: [{ kA: "11", nA: "10", kB: "9", nB: "10", a: "1", b: "1" }, { kA: "8", nA: "10", kB: "9", nB: "10", a: "1.5", b: "1" }],
  },
  one_sided_bounds: {
    values: { k: "188", n: "200", level: "0.95" },
    expect: [["Accuracy", 0.94], ["Exact lower bound", 0.9045985822701226], ["Exact upper bound", 0.9650178678744681], ["Wilson lower bound", 0.9060689339388414], ["Wilson upper bound", 0.9621855646849559]],
    more: [{ values: { k: "0", n: "10", level: "0.95" }, expect: (result) => { near(result.rows[1][1], 0); near(result.rows[2][1], 1 - 0.05 ** 0.1); } }],
    invalid: [{ k: "201", n: "200", level: "0.95" }],
  },
  // P(X >= 188 | 200, 0.9) <= 0.05 < P(X >= 187); 0.9^28 > 0.05 >= 0.9^29.
  accuracy_needed: {
    values: { n: "200", target: "0.9", level: "0.95" },
    expect: [["Correct rows needed", 188], ["Accuracy needed", 0.94], ["Errors allowed", 12], ["Fewest rows that could show it (all correct)", 29]],
    more: [{ values: { n: "20", target: "0.9", level: "0.95" }, expect: [["Correct rows needed", null], ["Accuracy needed", null], ["Errors allowed", null], ["Fewest rows that could show it (all correct)", 29]] },
      { values: { n: "29", target: "0.9", level: "0.95" }, expect: (result) => assert.equal(result.rows[0][1], 29) }],
    invalid: [{ n: "200", target: "0", level: "0.95" }],
  },
  ratio_score_interval: {
    values: { x1: "36", n1: "40", x2: "16", n2: "80", level: "0.95" },
    expect: [["Rate A", 0.9], ["Rate B", 0.2], ["Ratio A ÷ B", 4.5], ["Lower 95% bound", 2.9395691922149942], ["Upper 95% bound", 7.152223434866029]],
    more: [{ values: { x1: "0", n1: "40", x2: "16", n2: "80", level: "0.95" }, expect: [["Rate A", 0], ["Rate B", 0.2], ["Ratio A ÷ B", 0], ["Lower 95% bound", 0], ["Upper 95% bound", 0.4446029357920594]] },
      { values: { x1: "5", n1: "40", x2: "0", n2: "80", level: "0.95" }, expect: [["Rate A", 0.125], ["Rate B", 0], ["Ratio A ÷ B", null], ["Lower 95% bound", 2.6761831072109326], ["Upper 95% bound", null]] }],
    invalid: [{ x1: "0", n1: "40", x2: "0", n2: "80", level: "0.95" }, { x1: "41", n1: "40", x2: "1", n2: "80", level: "0.95" }],
  },
  poisson_rate_interval: {
    values: { events: "137", exposure: "24.19893", per: "1", level: "0.95" },
    expect: [["Events", 137], ["Rate per unit", 5.661407343217241], ["Lower 95% bound", 4.753124804848476], ["Upper 95% bound", 6.692709334176073]],
    // No events in 1,000 rows: the upper bound is −ln(0.025) per 1,000 rows.
    more: [{ values: { events: "0", exposure: "1000", per: "1000", level: "0.95" }, expect: [["Events", 0], ["Rate per unit", 0], ["Lower 95% bound", 0], ["Upper 95% bound", -Math.log(0.025)]] }],
    invalid: [{ events: "3", exposure: "0", per: "1", level: "0.95" }],
  },
  // mean 412, sd 95, n 25: se 19, t(0.975, 24) = 2.0638985616.
  mean_interval: {
    values: { m: "412", sd: "95", n: "25", level: "0.95" },
    expect: [["Standard error", 19], ["Degrees of freedom", 24], ["t multiplier", 2.063898561628024], ["Margin", 39.21407267093246], ["Lower bound", 372.78592732906753], ["Upper bound", 451.21407267093247]],
    more: [{ values: { m: "412", sd: "95", n: "25", level: "0.95", population: "100" }, expect: (result) => { near(result.rows[0][1], 16.537377315791296); near(result.rows[3][1], 34.13146925516157); } }],
    invalid: [{ m: "412", sd: "95", n: "25", level: "0.95", population: "20" }, { m: "412", sd: "95", n: "1", level: "0.95" }],
  },
  // df 10: chi-square quantiles 3.24697 and 20.48318 from the closed-form even-df distribution function.
  sd_interval: {
    values: { sd: "95", n: "11", level: "0.95" },
    expect: [["Lower bound for the standard deviation", 66.37811919552533], ["Upper bound for the standard deviation", 166.71868700426882],
      ["Lower bound for the variance", 4406.054707935368], ["Upper bound for the variance", 27795.120596427354]],
    invalid: [{ sd: "-1", n: "11", level: "0.95" }],
  },
  // Median of 1..10: ranks 2 and 9, coverage 1 − 2 · 11/1024 = 501/512. The 90th percentile of 1..20: lower rank 15,
  // no upper rank inside the data, coverage P(B >= 15 | 20, 0.9).
  quantile_interval: {
    values: { values: "10, 9 8 7; 6\n5 4 3 2 1", q: "0.5", level: "0.95" },
    expect: [["Values", 10], ["Sample percentile", 5.5], ["Lower bound", 2], ["Upper bound", 9], ["Rank of the lower bound", 2], ["Rank of the upper bound", 9], ["Actual coverage", 501 / 512]],
    more: [{ values: { values: "20 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19", q: "0.9", level: "0.95" },
      expect: [["Values", 20], ["Sample percentile", 18.1], ["Lower bound", 15], ["Upper bound", null], ["Rank of the lower bound", 15], ["Rank of the upper bound", null], ["Actual coverage", 0.988746865835491]] }],
    invalid: [{ values: "1 2 x", q: "0.5", level: "0.95" }, { values: "4", q: "0.5", level: "0.95" }, { values: "1 2 3", q: "1", level: "0.95" }],
  },
  // logs 0, ln 10, 2 ln 10: geometric mean 10, geometric sd 10, t(0.975, 2) = 0.95 / √(2 · 0.975 · 0.025).
  geometric_mean_interval: {
    values: { values: "1, 10, 100", level: "0.95" },
    expect: [["Values", 3], ["Geometric mean", 10], ["Lower bound", 0.03279912728775655], ["Upper bound", 3048.8616091114277], ["Geometric standard deviation", 10]],
    invalid: [{ values: "1, 0, 100", level: "0.95" }, { values: "5", level: "0.95" }],
  },
  // Exact hypergeometric enumeration over every possible error count.
  batch_errors_interval: {
    values: { size: "500", audited: "60", k: "2", level: "0.95" },
    expect: [["Error rate in the sample", 2 / 60], ["Estimated errors in the batch", 1000 / 60], ["Fewest errors in the batch", 3], ["Most errors in the batch", 55],
      ["Most errors as a share of the batch", 0.11], ["One-sided upper bound on errors", 48], ["Rows not audited", 440]],
    more: [{ values: { size: "20", audited: "5", k: "0", level: "0.95" }, expect: [["Error rate in the sample", 0], ["Estimated errors in the batch", 0], ["Fewest errors in the batch", 0],
      ["Most errors in the batch", 9], ["Most errors as a share of the batch", 0.45], ["One-sided upper bound on errors", 8], ["Rows not audited", 15]] },
      // A larger batch, against untruncated exact sums (Python integers) at every error count: 95% and 90%.
      { values: { size: "3000", audited: "400", k: "12", level: "0.95" }, expect: (result) => assert.deepEqual([2, 3, 5].map((i) => result.rows[i][1]), [50, 150, 140]) },
      { values: { size: "3000", audited: "400", k: "12", level: "0.9" }, expect: (result) => assert.deepEqual([2, 3, 5].map((i) => result.rows[i][1]), [55, 140, 129]) }],
    invalid: [{ size: "20", audited: "21", k: "0", level: "0.95" }, { size: "20", audited: "5", k: "6", level: "0.95" }],
  },
  // Weights 0.8 and 0.2: 0.8 · 0.95 + 0.2 · 0.8 = 23/25; variance Σ W² (1 − n/N) p(1 − p) / (n − 1).
  stratified_accuracy: {
    values: { strata: "retail, 800, 40, 38\nwholesale, 200, 30, 24", level: "0.95" },
    expect: (result) => {
      const expected = [["Stratified accuracy", 0.92], ["Standard error", 0.03046471774708199], ["Lower 95% bound", 0.8602902504165412], ["Upper 95% bound", 0.9797097495834589],
        ["Unweighted accuracy of the audited rows", 62 / 70]];
      assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
      expected.forEach(([, value], i) => near(result.rows[i][1], value));
      tableLike(result, { columns: ["Stratum", "Weight", "Rows audited", "Accuracy"], rows: [["retail", 0.8, 40, 0.95], ["wholesale", 0.2, 30, 0.8]] });
    },
    more: [{ values: { strata: "800, 40, 38\n200, 30, 24", level: "0.95" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => row[0]), ["Stratum 1", "Stratum 2"]) }],
    invalid: [{ strata: "retail, 800, 40, 38", level: "0.95" }, { strata: "a, 800, 1, 1\nb, 200, 30, 24", level: "0.95" }, { strata: "a, 800, 40, 41\nb, 200, 30, 24", level: "0.95" },
      { strata: "a, 30, 40, 38\nb, 200, 30, 24", level: "0.95" }],
  },
  goodman_intervals: {
    values: { counts: "refund: 40\nexchange: 25\nother: 15", level: "0.95" },
    expect: (result) => tableLike(result, { columns: ["Class", "Count", "Share", "Lower bound", "Upper bound"], rows: [
      ["refund", 40, 0.5, 0.37072302291651976, 0.6292769770834802], ["exchange", 25, 0.3125, 0.20453773225712749, 0.44553107294863653],
      ["other", 15, 0.1875, 0.10533426775943215, 0.3114470742501745]] }),
    more: [{ values: { counts: "40, 25, 15", level: "0.95" }, expect: (result) => {
      assert.deepEqual(result.table.rows.map((row) => row[0]), ["Class 1", "Class 2", "Class 3"]);
      near(result.table.rows[2][3], 0.10533426775943215);
    } }],
    invalid: [{ counts: "refund: 40", level: "0.95" }, { counts: "0 0", level: "0.95" }, { counts: "refund: many\nother: 3", level: "0.95" }],
  },
  // Beta-binomial with integer shapes, summed exactly: 3 of 200 then 1,000 rows; 1 of 10 then 5 rows (P(0) = 11/24).
  next_batch_errors: {
    values: { k: "3", n: "200", m: "1000", a: "1", b: "1", level: "0.95" },
    expect: [["Expected errors", 4000 / 202], ["Chance of no errors", 0.0007651455647400682], ["Lower end of the 95% range", 4], ["Upper end of the 95% range", 45]],
    more: [{ values: { k: "1", n: "10", m: "5", a: "1", b: "1", level: "0.95" }, expect: [["Expected errors", 10 / 12], ["Chance of no errors", 11 / 24], ["Lower end of the 95% range", 0], ["Upper end of the 95% range", 3]] }],
    invalid: [{ k: "11", n: "10", m: "5", a: "1", b: "1", level: "0.95" }],
  },
  // (rate + Sp − 1) / (Se + Sp − 1) applied to 0.15 and to its Wilson bounds; 2 of 200 falls below the false-flag rate.
  corrected_rate: {
    values: { x: "30", n: "200", sensitivity: "0.9", specificity: "0.95", level: "0.95" },
    expect: [["Share flagged", 0.15], ["Corrected rate (before clipping)", 0.11764705882352924], ["Corrected rate", 0.11764705882352924],
      ["Lower 95% bound", 0.06721874779108225], ["Upper 95% bound", 0.18359505040196067]],
    more: [{ values: { x: "2", n: "200", sensitivity: "0.9", specificity: "0.95", level: "0.95" }, expect: [["Share flagged", 0.01], ["Corrected rate (before clipping)", -0.0470588235294118],
      ["Corrected rate", 0], ["Lower 95% bound", 0], ["Upper 95% bound", 0]] }],
    invalid: [{ x: "30", n: "200", sensitivity: "0.5", specificity: "0.5", level: "0.95" }],
  },
  correlation_interval: {
    values: { r: "0.45", n: "50", level: "0.95" },
    expect: [["Fisher z", Math.atanh(0.45)], ["Standard error of z", 1 / Math.sqrt(47)], ["Lower bound", 0.1962315538663671], ["Upper bound", 0.647272631427789]],
    invalid: [{ r: "1", n: "50", level: "0.95" }, { r: "0.4", n: "3", level: "0.95" }],
  },
}, { ctx: () => fakeCtx({}) });

test("tb-intervals: the next-batch prior counts errors, not successes", () => {
  const labels = pack.features.find((feature) => feature.id === "next_batch_errors").inputs.map((input) => input.label);
  assert.ok(labels.includes("Prior errors + 1 (Beta a)") && labels.includes("Prior correct rows + 1 (Beta b)"));
});

test("tb-intervals: every tool is in the Proportions and intervals group", () => {
  for (const feature of pack.features) assert.equal(feature.group, "Proportions and intervals");
});
