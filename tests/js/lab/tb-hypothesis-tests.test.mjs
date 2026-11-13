// Tests for the tb-hypothesis-tests pack. Reference values come from published worked examples where one exists (the
// R documentation examples of prop.test, binom.test, poisson.test and power.prop.test, Newcombe 1998 Table II) and
// otherwise from a separate Python computation with the standard library only: exact fractions and math.comb for
// discrete distributions, math.erfc for the normal, closed forms for chi-square with integer df, and Simpson
// integration of the Student t density for t tails. None of it shares code with the pack.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tb-hypothesis-tests.js";
import { runTool } from "../../../static/js/lab/kit.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const near = (actual, expected, tolerance = 1e-9) => approx(actual, expected, tolerance);
const table = (result, expected, tolerance = 1e-12) => {
  assert.deepEqual(result.table.columns, expected.columns);
  assert.equal(result.table.rows.length, expected.rows.length);
  expected.rows.forEach((row, i) => row.forEach((cell, j) => near(result.table.rows[i][j], cell, tolerance)));
};

const twoGroups = { x1: "15", n1: "50", x2: "25", n2: "50" };
const tool = (id) => pack.features.find((feature) => feature.id === id);

checkPack(pack, {
  // R: prop.test(c(15, 25), c(50, 50), correct = FALSE) gives X-squared = 4.1667 = z^2.
  two_proportion_z: {
    values: { ...twoGroups, alternative: "two-sided" },
    expect: [["Rate A (successes ÷ trials)", 0.3], ["Rate B (successes ÷ trials)", 0.5], ["Difference A − B (proportion)", -0.2], ["Pooled rate", 0.4],
      ["Standard error of the difference (pooled)", 0.09797958971132711], ["z statistic", -2.041241452319315], ["p-value (two-sided)", 0.041226833337163704]],
    more: [{ values: { ...twoGroups, alternative: "less" }, expect: (result) => {
      assert.equal(result.rows[6][0], "p-value (one-sided, A below B)");
      near(result.rows[6][1], 0.020613416668581852);
    } }],
    invalid: [{ ...twoGroups, x1: "51" }, { x1: "50", n1: "50", x2: "50", n2: "50" }, { ...twoGroups, n2: "0" }, { ...twoGroups, x2: "2.5" }],
  },
  // R: prop.test(c(15, 25), c(50, 50)) gives X-squared = 3.375, p-value = 0.06619.
  two_proportion_z_corrected: {
    values: { ...twoGroups, alternative: "two-sided" },
    expect: [["Rate A (successes ÷ trials)", 0.3], ["Rate B (successes ÷ trials)", 0.5], ["Difference A − B (proportion)", -0.2], ["Pooled rate", 0.4],
      ["Standard error of the difference (pooled)", 0.09797958971132711], ["Continuity correction applied (proportion)", 0.02],
      ["z statistic", -1.8371173070873836], ["p-value (two-sided)", 0.06619257972219343]],
    more: [{ values: { x1: "10", n1: "20", x2: "10", n2: "20", alternative: "two-sided" }, expect: (result) => {
      near(result.rows[5][1], 0);   // the correction never flips the sign: it stops at a zero difference
      near(result.rows[7][1], 1);
    } }],
    invalid: [{ ...twoGroups, x2: "60" }, { x1: "0", n1: "5", x2: "0", n2: "5" }],
  },
  // b = 10, c = 2: P[X >= 10 | 12, 1/2] = (1 + 12 + 66) / 4096; mid-p = 2 (79 − 33) / 4096 = 92 / 4096.
  mcnemar_detail: {
    values: { b: "10", c: "2" },
    expect: [["Discordant items", 12], ["Share of discordant items A wins", 10 / 12], ["Exact p-value (one-sided, A better)", 79 / 4096],
      ["Mid-p value (two-sided)", 92 / 4096], ["Chi-square without continuity correction (df 1)", 64 / 12], ["p-value without continuity correction", 0.02092133533779403]],
    more: [{ values: { b: "3", c: "3" }, expect: (result) => { near(result.rows[3][1], 1); near(result.rows[4][1], 0); near(result.rows[5][1], 1); } }],
    invalid: [{ b: "0", c: "0" }, { b: "-1", c: "2" }],
  },
  // Agresti–Min: add 0.5 to each cell, n = 202; (pb − pc) ± 1.96 sqrt((pb + pc − (pb − pc)^2) / 202).
  paired_difference_interval: {
    values: { both: "150", b: "20", c: "8", neither: "22", level: "0.95" },
    expect: [["Accuracy of A", 0.85], ["Accuracy of B", 0.79], ["Difference A − B (proportion)", 0.06],
      ["Lower 95% bound (Agresti–Min)", 0.007801015158239041], ["Upper 95% bound (Agresti–Min)", 0.11101086602987978]],
    invalid: [{ both: "0", b: "0", c: "0", neither: "0" }],
  },
  // Fisher's tea tasting: probabilities 1, 16, 36, 16, 1 over 70; observed 16/70.
  fisher_exact: {
    values: { a: "3", b: "1", c: "1", d: "3" },
    expect: [["Sample odds ratio (a·d ÷ b·c)", 9], ["p-value (two-sided)", 34 / 70], ["p-value (one-sided, A's success rate higher)", 17 / 70],
      ["p-value (one-sided, A's success rate lower)", 69 / 70]],
    // a = 5, b = 0, c = 1, d = 4: C(6,k) C(4,5−k) / 252 for k = 1..5 is 6, 60, 120, 60, 6 over 252.
    more: [{ values: { a: "5", b: "0", c: "1", d: "4" }, expect: [["Sample odds ratio (a·d ÷ b·c)", null], ["p-value (two-sided)", 12 / 252],
      ["p-value (one-sided, A's success rate higher)", 6 / 252], ["p-value (one-sided, A's success rate lower)", 1]] }],
    invalid: [{ a: "0", b: "0", c: "0", d: "0" }, { a: "1.5", b: "1", c: "1", d: "1" }, { a: "600000", b: "1", c: "1", d: "600000" }],
  },
  // [[10, 20, 30], [20, 20, 10]]: chi-square = 451/36 by exact fractions; df 2, so p = exp(−x / 2).
  chi_square_table: {
    values: { table: "10, 20, 30\n20\t20 10" },
    expect: (result) => {
      const rows = [["Chi-square statistic", 451 / 36], ["Degrees of freedom", 2], ["p-value", Math.exp(-451 / 72)], ["Cramér's V (0 to 1)", 0.3374742788552765],
        ["Cells with an expected count below 5", 0]];
      assert.deepEqual(result.rows.map(([label]) => label), rows.map(([label]) => label));
      rows.forEach(([, value], i) => near(result.rows[i][1], value));
      table(result, { columns: ["expected count", "column 1", "column 2", "column 3"],
        rows: [["row 1", 180 / 11, 240 / 11, 240 / 11], ["row 2", 150 / 11, 200 / 11, 200 / 11]] });
      assert.equal(result.note, null);
    },
    more: [{ values: { table: "1 2; 3 1" }, expect: (result) => { assert.equal(result.rows[4][1], 4); assert.match(result.note, /below 5/); } }],
    invalid: [{ table: "1 2 3" }, { table: "1 2\n3" }, { table: "1 x\n3 4" }, { table: "0 0\n3 4" }, { table: "1 -2\n3 4" }, { table: "" }],
  },
  // Same table: G = 2 Σ O ln(O / E); Williams q = 1 + (N Σ 1/R − 1)(N Σ 1/C − 1) / (6 N df).
  g_test: {
    values: { table: "10 20 30\n20 20 10" },
    expect: [["G statistic", 12.952596352875815], ["Degrees of freedom", 2], ["p-value", 0.0015394990981023727], ["Williams correction factor", 1.018766835016835],
      ["G with Williams correction", 12.7139949080319], ["p-value with Williams correction", 0.0017345670181052614]],
    invalid: [{ table: "5 0\n0 0" }, { table: "a b\nc d" }],
  },
  // R: binom.test(682, 925, p = 3/4) gives p-value = 0.3825 and 95% CI 0.7076683 to 0.7654066.
  binomial_test: {
    values: { x: "682", n: "925", p0: "0.75", alternative: "two-sided", level: "0.95" },
    expect: [["Observed rate", 682 / 925], ["Target rate", 0.75], ["p-value (two-sided)", 0.3824915595748517],
      ["Clopper–Pearson 95% interval, lower", 0.707668264079039], ["Clopper–Pearson 95% interval, upper", 0.7654065582415253]],
    tolerance: 1e-9,
    // P[X >= 8 | 10, 1/2] = (45 + 10 + 1) / 1024.
    more: [{ values: { x: "8", n: "10", p0: "0.5", alternative: "greater" }, expect: [["Observed rate", 0.8], ["Target rate", 0.5],
      ["p-value (one-sided, rate above target)", 56 / 1024], ["Clopper–Pearson 95% interval, lower", 0.4439045376923585], ["Clopper–Pearson 95% interval, upper", 0.9747892736731667]] },
    { values: { x: "0", n: "10", p0: "0.5", alternative: "less" }, expect: (result) => { near(result.rows[2][1], 1 / 1024); near(result.rows[3][1], 0); } }],
    invalid: [{ x: "11", n: "10", p0: "0.5" }, { x: "1", n: "10", p0: "1" }, { x: "1", n: "10", p0: "0" }],
  },
  // 6 for A (five A plus +3), 3 for B (two B plus −1), 2 ties; P[X <= 3 | 9, 1/2] = 130/512.
  sign_test: {
    values: { preferences: "A a B tie A A, B A; 3 −1 0" },
    expect: [["A preferred", 6], ["B preferred", 3], ["Ties (left out)", 2], ["Share of decisive items preferring A", 6 / 9],
      ["Exact p-value (two-sided)", 260 / 512], ["Exact p-value (one-sided, A preferred more)", 130 / 512]],
    invalid: [{ preferences: "A maybe B" }, { preferences: "tie = 0" }, { preferences: "" }],
  },
  // Differences 1.5 −0.5 2 2 0 3 −1 4 2.5 0.5: nine nonzero, W+ = 81/2, tie-corrected variance by exact fractions.
  wilcoxon_signed_rank: {
    values: { differences: "1.5, -0.5, 2, 2, 0, 3, -1, 4, 2.5, 0.5" },
    expect: [["Nonzero differences used", 9], ["Zero differences left out", 1], ["Sum of positive ranks W+", 40.5], ["Sum of negative ranks W−", 4.5],
      ["z statistic (normal approximation)", 2.0768679018392433], ["p-value (two-sided)", 0.037813753008406496]],
    more: [{ values: { differences: "1.5 -0.5 2 2 0 3 -1 4 2.5 0.5", continuity: false }, expect: (result) => {
      near(result.rows[4][1], 2.1362069847489358);
      near(result.rows[5][1], 0.032662546386305065);
    } }],
    invalid: [{ differences: "0 0 0" }, { differences: "1 2 x" }, { differences: "" }],
  },
  // A = 3 4 2 6 2 5, B = 9 7 5 10 6 8: U_A = 2 from average ranks, tie-corrected variance by exact fractions.
  mann_whitney: {
    values: { a: "3 4 2 6 2 5", b: "9\n7\n5\n10\n6\n8" },
    expect: [["Values in A", 6], ["Values in B", 6], ["U for A", 2], ["U for B", 34], ["Probability a value from A exceeds one from B (ties count half)", 2 / 36],
      ["z statistic (normal approximation)", -2.4951071082707506], ["p-value (two-sided)", 0.012591911490379715]],
    invalid: [{ a: "1 1", b: "1 1" }, { a: "", b: "1 2" }, { a: "1 2", b: "1,2,z" }],
  },
  // 1 2 3 | 4 5 6 | 7 8 9: rank sums 6, 15, 24, H = 12/90 · (12 + 75 + 192) − 30 = 7.2 with 2 df, so p = exp(−3.6).
  kruskal_wallis: {
    values: { groups: "1 2 3\n4, 5, 6\n7\t8\t9" },
    expect: (result) => {
      [["Groups", 3], ["Values", 9], ["H statistic (tie-corrected)", 7.2], ["Degrees of freedom", 2], ["p-value", Math.exp(-3.6)]]
        .forEach(([label, value], i) => { assert.equal(result.rows[i][0], label); near(result.rows[i][1], value); });
      table(result, { columns: ["group", "values", "mean rank"], rows: [[1, 3, 2], [2, 3, 5], [3, 3, 8]] });
    },
    // Ties: 1 2 2 | 2 3 4 ranks 1 3 3 | 3 5 6; uncorrected H = 7/3, tie factor 1 − 24/210 = 31/35, so H = 245/93 with 1 df.
    more: [{ values: { groups: "1 2 2\n2 3 4" }, expect: (result) => {
      near(result.rows[2][1], 245 / 93);
      near(result.rows[4][1], 0.10457099306437283);   // erfc(sqrt(H / 2)) for 1 df
    } }],
    invalid: [{ groups: "1 2 3" }, { groups: "1 1\n1 1" }, { groups: "1 2\n3 x" }, { groups: "" }],
  },
  // Means 10 and 8, SDs 2 and 3, sizes 10 and 12; t tails from Simpson integration of the t density.
  welch_t: {
    values: { mean1: "10", sd1: "2", n1: "10", mean2: "8", sd2: "3", n2: "12", level: "0.95" },
    expect: [["Difference in means A − B", 2], ["Standard error of the difference", 1.0723805294763609], ["t statistic", 1.8650096164806276],
      ["Degrees of freedom (Welch–Satterthwaite)", 19.190545987541217], ["p-value (two-sided)", 0.07754643868206224],
      ["Lower 95% bound for the difference", -0.24301080516030105], ["Upper 95% bound for the difference", 4.243010805160301]],
    tolerance: 1e-8,
    invalid: [{ mean1: "1", sd1: "0", n1: "5", mean2: "1", sd2: "0", n2: "5" }, { mean1: "1", sd1: "1", n1: "1", mean2: "1", sd2: "1", n2: "5" }],
  },
  // Differences 1 1 0 2 3: mean 1.4, variance 1.3, t = 1.4 / sqrt(0.26) with 4 df.
  paired_t: {
    values: { a: "5 7 6 9 8", b: "4 6 6 7 5", level: "0.95" },
    expect: [["Pairs", 5], ["Mean difference A − B", 1.4], ["Standard deviation of the differences", Math.sqrt(1.3)], ["Standard error of the mean difference", Math.sqrt(0.26)],
      ["t statistic", 2.745625891934576], ["Degrees of freedom", 4], ["p-value (two-sided)", 0.051605957811174163],
      ["Lower 95% bound for the mean difference", -0.01571477698226631], ["Upper 95% bound for the mean difference", 2.815714776982266]],
    tolerance: 1e-8,
    invalid: [{ a: "1 2 3", b: "1 2" }, { a: "2 3 4", b: "1 2 3" }, { a: "1", b: "1" }],
  },
  one_sample_t: {
    values: { values: "0.91 0.88 0.93 0.86 0.9", mu: "0.85", level: "0.95" },
    expect: [["Values", 5], ["Mean", 0.896], ["Standard deviation", 0.027018512172212593], ["t statistic", 3.806987087570896], ["Degrees of freedom", 4],
      ["p-value (two-sided)", 0.01898923149251086], ["Lower 95% bound for the mean", 0.8624520861507337], ["Upper 95% bound for the mean", 0.9295479138492664]],
    tolerance: 1e-8,
    invalid: [{ values: "0.9 0.9 0.9", mu: "0.85" }, { values: "0.9", mu: "0.85" }, { values: "1 2 3", mu: "" }],
  },
  // p = .01 .04 .03 .005, m = 4. Holm, sorted .005 .01 .03 .04: 4(.005), 3(.01), 2(.03), max(.06, .04) = .02, .03, .06, .06.
  bonferroni_holm: {
    values: { pvalues: "0.01, 0.04\n0.03 0.005", alpha: "0.05" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Tests", 4], ["Rejected by Bonferroni at α = 0.05", 2], ["Rejected by Holm at α = 0.05", 2]]);
      table(result, { columns: ["test", "p-value", "Bonferroni p", "Holm p", "rejected by Holm"],
        rows: [[1, 0.01, 0.04, 0.03, "yes"], [2, 0.04, 0.16, 0.06, "no"], [3, 0.03, 0.12, 0.06, "no"], [4, 0.005, 0.02, 0.02, "yes"]] });
    },
    more: [{ values: { pvalues: "0.5 0.9" }, expect: (result) => table(result, { columns: ["test", "p-value", "Bonferroni p", "Holm p", "rejected by Holm"],
      rows: [[1, 0.5, 1, 1, "no"], [2, 0.9, 1, 1, "no"]] }) }],
    invalid: [{ pvalues: "0.2 1.5" }, { pvalues: "" }, { pvalues: "0.2 p" }],
  },
  // m p / rank for ranks 1..4 (.005 .01 .03 .04): .02 .02 .04 .04, then the running minimum from the top.
  benjamini_hochberg: {
    values: { pvalues: "0.01 0.04 0.03 0.005", fdr: "0.05" },
    expect: (result) => {
      assert.deepEqual(result.rows.map(([label]) => label), ["Tests", "Discoveries at FDR 0.05", "Largest p-value among the discoveries"]);
      assert.deepEqual(result.rows.map(([, value]) => value), [4, 4, 0.04]);
      table(result, { columns: ["test", "p-value", "rank", "q-value", "discovery"],
        rows: [[1, 0.01, 2, 0.02, "yes"], [2, 0.04, 4, 0.04, "yes"], [3, 0.03, 3, 0.04, "yes"], [4, 0.005, 1, 0.02, "yes"]] });
    },
    more: [{ values: { pvalues: "0.2 0.6", fdr: "0.05" }, expect: (result) => { assert.equal(result.rows[1][1], 0); assert.equal(result.rows[2][1], null); } }],
    invalid: [{ pvalues: "-0.1" }, { pvalues: "0.1", fdr: "0.9" }],
  },
  // R: power.prop.test(n = 50, p1 = .50, p2 = .75) gives power = 0.7401659.
  power_two_proportions: {
    values: { p1: "0.5", p2: "0.75", n: "50", alpha: "0.05", sides: "two" },
    expect: [["Power (chance of a significant result)", 0.740165901331388], ["Difference to detect", 0.25], ["Items in total", 100]],
    more: [{ values: { p1: "0.5", p2: "0.75", n: "50", sides: "one" }, expect: (result) => near(result.rows[0][1], 0.8339835233554282) }],
    invalid: [{ p1: "0.5", p2: "0.5", n: "50" }, { p1: "1.2", p2: "0.5", n: "50" }, { p1: "0.5", p2: "0.7", n: "1" }],
  },
  // OR = 45·70 / (55·30); RR = 0.45 / 0.30; Woolf and Katz standard errors on the log scale.
  ratio_measures: {
    values: { a: "45", b: "55", c: "30", d: "70", level: "0.95" },
    expect: [["Odds ratio A ÷ B", 3150 / 1650], ["Odds ratio, lower 95% bound", 1.067299493885196], ["Odds ratio, upper 95% bound", 3.4148129180745097],
      ["Odds ratio p-value (two-sided, Wald)", 0.02929500202172007], ["Rate ratio A ÷ B (relative risk)", 1.5], ["Rate ratio, lower 95% bound", 1.036542603155077],
      ["Rate ratio, upper 95% bound", 2.1706777831912984], ["Rate ratio p-value (two-sided, Wald)", 0.03153121920966559], ["Zero-cell correction", "none"]],
    // With a zero cell every cell gets 0.5: 0.5, 10.5, 5.5, 5.5.
    more: [{ values: { a: "0", b: "10", c: "5", d: "5" }, expect: [["Odds ratio A ÷ B", 0.047619047619047616], ["Odds ratio, lower 95% bound", 0.0022030720739671297],
      ["Odds ratio, upper 95% bound", 1.0292780354034652], ["Odds ratio p-value (two-sided, Wald)", 0.05219028896154903], ["Rate ratio A ÷ B (relative risk)", 0.09090909090909091],
      ["Rate ratio, lower 95% bound", 0.005686257833282948], ["Rate ratio, upper 95% bound", 1.4534097911536115], ["Rate ratio p-value (two-sided, Wald)", 0.08996772071602267],
      ["Zero-cell correction", "added 0.5 to every cell"]] }],
    invalid: [{ a: "0", b: "0", c: "5", d: "5" }, { a: "1", b: "1", c: "", d: "5" }],
  },
  // 56/70 − 48/80 = 0.2 with Newcombe's 0.05243 to 0.33387, so the NNT is 5 with an interval 1/0.33387 to 1/0.05243.
  number_needed: {
    values: { x1: "56", n1: "70", x2: "48", n2: "80", level: "0.95" },
    expect: [["Difference in success rate (new − current)", 0.2], ["Direction", "the new variant is better"], ["Items per extra correct decision (or extra error when worse)", 5],
      ["Rounded up", 5], ["Lower 95% bound for the difference", 0.0524314724023649], ["Upper 95% bound for the difference", 0.3338726540369059],
      ["95% interval for the NNT", "2.995 to 19.07 items per extra correct decision"]],
    // 50/100 − 45/100: Newcombe −0.08699 to 0.18438 crosses zero; 1/0.18438 = 5.424 and 1/0.08699 = 11.50.
    more: [{ values: { x1: "50", n1: "100", x2: "45", n2: "100" }, expect: (result) => {
      near(result.rows[2][1], 20);
      assert.equal(result.rows[3][1], 20);
      assert.equal(result.rows[6][1], "5.424 or more items per extra correct decision, or 11.5 or more items per extra error");
    } },
    { values: { x1: "40", n1: "100", x2: "40", n2: "100" }, expect: (result) => { assert.equal(result.rows[1][1], "no difference"); assert.equal(result.rows[2][1], null); } }],
    invalid: [{ x1: "71", n1: "70", x2: "48", n2: "80" }],
  },
  // h = 2 asin(sqrt .65) − 2 asin(sqrt .45) = 0.40486; n = ((1.95996 + 0.84162) / h)^2 = 47.88, so 48.
  cohens_h: {
    values: { p1: "0.65", p2: "0.45" },
    expect: [["Cohen's h", 0.40486007517695755], ["Size (Cohen's rough reading)", "small"], ["Items per arm for 80% power at α = 0.05, two-sided", 48]],
    more: [{ values: { p1: "1", p2: "0" }, expect: (result) => { near(result.rows[0][1], Math.PI); assert.equal(result.rows[1][1], "large"); } },
      { values: { p1: "0.3", p2: "0.3" }, expect: (result) => { assert.equal(result.rows[1][1], "negligible"); assert.equal(result.rows[2][1], null); } }],
    invalid: [{ p1: "1.1", p2: "0.5" }, { p1: "", p2: "0.5" }],
  },
  // Observed 48 30 22 against shares .5 .3 .2 of 100: (4/50 + 0 + 4/20) = 0.28 with 2 df, so p = exp(−0.14).
  goodness_of_fit: {
    values: { observed: "48 30 22", expected: "0.5, 0.3, 0.2" },
    expect: (result) => {
      [["Chi-square statistic", 0.28], ["Degrees of freedom", 2], ["p-value", Math.exp(-0.14)], ["Smallest expected count", 20]]
        .forEach(([label, value], i) => { assert.equal(result.rows[i][0], label); near(result.rows[i][1], value); });
      table(result, { columns: ["category", "observed", "expected", "contribution to chi-square"], rows: [[1, 48, 50, 0.08], [2, 30, 30, 0], [3, 22, 20, 0.2]] });
    },
    // Blank shares mean equal shares: 10 and 20 against 15 each give 25/15 + 25/15 with 1 df.
    more: [{ values: { observed: "10 20", expected: "" }, expect: (result) => near(result.rows[0][1], 50 / 15) }],
    invalid: [{ observed: "10 20", expected: "1 2 3" }, { observed: "10 2.5", expected: "" }, { observed: "10 20", expected: "1 0" }, { observed: "0 0" }],
  },
  // R: poisson.test(c(11, 21), c(800, 3011)) gives p-value = 0.07967, rate ratio 1.971488, 95% CI 0.8584264 to 4.2772659.
  poisson_rate_comparison: {
    values: { e1: "11", t1: "800", e2: "21", t2: "3011", level: "0.95" },
    expect: [["Rate A (events per unit of exposure)", 11 / 800], ["Rate B (events per unit of exposure)", 21 / 3011], ["Rate ratio A ÷ B", 1.9714880952380953],
      ["Exact p-value (two-sided)", 0.07966863303332947], ["Rate ratio, lower 95% bound", 0.8584264033916397], ["Rate ratio, upper 95% bound", 4.277265943654075]],
    more: [{ values: { e1: "4", t1: "100", e2: "0", t2: "100" }, expect: (result) => { assert.equal(result.rows[2][1], null); assert.equal(result.rows[5][1], null); near(result.rows[3][1], 2 / 16); } }],
    invalid: [{ e1: "0", t1: "10", e2: "0", t2: "10" }, { e1: "1", t1: "0", e2: "1", t2: "10" }],
  },
  noninferiority: {
    values: { x1: "188", n1: "200", x2: "190", n2: "200", margin: "0.05", alpha: "0.05" },
    expect: [["Difference new − current", -0.01], ["Non-inferiority limit (−margin)", -0.05], ["z statistic", 1.7549599722874263], ["p-value (one-sided)", 0.03963307735407321],
      ["One-sided 95% lower bound for the difference", -0.04749039642898655], ["Verdict", "non-inferior at this margin"]],
    more: [{ values: { x1: "188", n1: "200", x2: "190", n2: "200", margin: "0.02" }, expect: (result) => assert.equal(result.rows[5][1], "not shown to be non-inferior") },
      // α = 0.025: the same z, but the bound −0.01 − 1.959964 · 0.0227926 = −0.054673 falls below −0.05.
      { values: { x1: "188", n1: "200", x2: "190", n2: "200", margin: "0.05", alpha: "0.025" }, expect: (result) => {
        assert.equal(result.rows[4][0], "One-sided 97.5% lower bound for the difference");
        near(result.rows[4][1], -0.054672562690656075);
        assert.equal(result.rows[5][1], "not shown to be non-inferior");
      } }],
    invalid: [{ x1: "200", n1: "200", x2: "200", n2: "200", margin: "0.05" }, { x1: "188", n1: "200", x2: "190", n2: "200", margin: "0" }],
  },
  equivalence_tost: {
    values: { x1: "188", n1: "200", x2: "190", n2: "200", margin: "0.05", alpha: "0.05" },
    expect: [["Difference new − current", -0.01], ["z against the lower limit", 1.7549599722874263], ["z against the upper limit", 2.6324399584311404],
      ["p-value (TOST, larger of the two)", 0.03963307735407321], ["Lower bound of the 90% interval", -0.04749039642898655], ["Upper bound of the 90% interval", 0.027490396428986534],
      ["Verdict", "equivalent within the margin"]],
    more: [{ values: { x1: "188", n1: "200", x2: "190", n2: "200", margin: "0.03" }, expect: (result) => assert.equal(result.rows[6][1], "not shown to be equivalent") },
      // α = 0.025 gives the 95% interval −0.01 ± 1.959964 · 0.0227926, and p = 0.0396 is above α.
      { values: { x1: "188", n1: "200", x2: "190", n2: "200", margin: "0.05", alpha: "0.025" }, expect: (result) => {
        assert.deepEqual([result.rows[4][0], result.rows[5][0]], ["Lower bound of the 95% interval", "Upper bound of the 95% interval"]);
        near(result.rows[4][1], -0.054672562690656075);
        near(result.rows[5][1], 0.03467256269065607);
        assert.equal(result.rows[6][1], "not shown to be equivalent");
      } }],
    invalid: [{ x1: "0", n1: "20", x2: "0", n2: "20", margin: "0.05" }],
  },
  // Connor (1987): n = (1.95996 sqrt(.2) + 0.84162 sqrt(.2 − .01))^2 / .01.
  mcnemar_sample_size: {
    values: { pb: "0.15", pc: "0.05", alpha: "0.05", power: "0.8" },
    expect: [["Items (rounded up)", 155], ["Items (unrounded)", 154.598569560211], ["Expected items where only one gate is right", 31]],
    invalid: [{ pb: "0.1", pc: "0.1" }, { pb: "0.7", pc: "0.6" }],
  },
  // Columns 5, 4, 1 of 10 successes; row totals 2 1 3 1 2 1: Q = 2 (3·42 − 100) / (30 − 20) = 5.2 with 2 df.
  cochran_q: {
    values: { table: "1 1 0\n1 0 0\n1 1 1\n0 1 0\n1 1 0\n1 0 0" },
    expect: (result) => {
      [["Items", 6], ["Gates", 3], ["Cochran's Q", 5.2], ["Degrees of freedom", 2], ["p-value", Math.exp(-2.6)]]
        .forEach(([label, value], i) => { assert.equal(result.rows[i][0], label); near(result.rows[i][1], value); });
      table(result, { columns: ["gate", "successes", "success rate"], rows: [[1, 5, 5 / 6], [2, 4, 4 / 6], [3, 1, 1 / 6]] });
    },
    invalid: [{ table: "1 1 1\n0 0 0" }, { table: "1 2\n0 1" }, { table: "1 0" }],
  },
  // Pooled SD sqrt((9·4 + 11·9) / 20) = sqrt(6.75); d = 2 / sqrt(6.75); g = d (1 − 3/79).
  cohens_d: {
    values: { mean1: "10", sd1: "2", n1: "10", mean2: "8", sd2: "3", n2: "12", level: "0.95" },
    expect: [["Pooled standard deviation", Math.sqrt(6.75)], ["Cohen's d", 0.769800358919501], ["Hedges' g", 0.7405674338972416], ["Standard error of d", 0.44362297821612756],
      ["Lower 95% bound for d", -0.09968470109850569], ["Upper 95% bound for d", 1.639285418937508], ["Size (Cohen's rough reading)", "medium"]],
    invalid: [{ mean1: "1", sd1: "0", n1: "3", mean2: "2", sd2: "0", n2: "3" }],
  },
  // t with 1 df is Cauchy: P(T >= 1) = 1/2 − atan(1)/pi = 1/4. Chi-square with 2 df: P(X >= 4) = e^-2.
  statistic_to_p: {
    values: { distribution: "z", statistic: "1.96" },
    expect: [["Upper-tail p-value P(Z ≥ z)", 0.024997895148220435], ["Lower-tail p-value P(Z ≤ z)", 0.9750021048517795], ["Two-sided p-value", 0.04999579029644087]],
    more: [{ values: { distribution: "t", statistic: "1", df: "1" }, expect: [["Upper-tail p-value P(T ≥ t)", 0.25], ["Lower-tail p-value P(T ≤ t)", 0.75], ["Two-sided p-value", 0.5]] },
      { values: { distribution: "chi2", statistic: "4", df: "2" }, expect: [["Upper-tail p-value P(X ≥ x)", Math.exp(-2)], ["Lower-tail p-value P(X ≤ x)", 1 - Math.exp(-2)]] },
      { values: { distribution: "t", statistic: "2.5", df: "7.5" }, expect: (result) => near(result.rows[0][1], 0.019410129136813115, 1e-8) }],
    invalid: [{ distribution: "t", statistic: "1" }, { distribution: "chi2", statistic: "-1", df: "2" }, { distribution: "z", statistic: "" }],
  },
  // Inverse of the power tool: R's power at p1 = .75, p2 = .5, n = 50 is 0.740165901331388, so the solution is 0.75.
  minimum_detectable_rate: {
    values: { p2: "0.5", n: "50", alpha: "0.05", power: "0.740165901331388", sides: "two" },
    expect: [["Smallest detectable rate", 0.75], ["Smallest detectable difference", 0.25]],
    tolerance: 1e-9,
    invalid: [{ p2: "0.99", n: "2", power: "0.99" }, { p2: "1", n: "50" }],
  },
  // Fisher: −2 ln(.08 · .11 · .04) with 6 df, p = e^(−x/2)(1 + x/2 + (x/2)^2 / 2); Stouffer: Σ Φ^−1(1 − p) / sqrt 3.
  combine_p_values: {
    values: { pvalues: "0.08 0.11 0.04" },
    expect: [["P-values combined", 3], ["Fisher's statistic −2 Σ ln p", 15.903758764732354], ["Degrees of freedom", 6], ["Fisher's combined p-value", 0.014279961427852145],
      ["Stouffer's z", 2.530113858351205], ["Stouffer's combined p-value (one-sided)", 0.005701275894558456]],
    invalid: [{ pvalues: "0 0.5" }, { pvalues: "0.5 1" }, { pvalues: "0.5 2" }],
  },
}, { ctx: () => fakeCtx({}) });

test("tb-hypothesis-tests: every tool is in the Hypothesis tests group", () => {
  for (const feature of pack.features) assert.equal(feature.group, "Hypothesis tests");
});

test("tb-hypothesis-tests: the smallest detectable rate is where the power tool reaches the target", () => {
  const rate = runTool(tool("minimum_detectable_rate"), { p2: "0.8", n: "300", power: "0.8" }).rows[0][1];
  near(runTool(tool("power_two_proportions"), { p1: String(rate), p2: "0.8", n: "300" }).rows[0][1], 0.8, 1e-9);
});
