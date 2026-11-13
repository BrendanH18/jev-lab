// Tests for the tb-agreement pack. Reference values come from published worked examples where one exists (the
// Wikipedia kappa example of 50 items with po = 0.7 and pe = 0.5; the Wikipedia Fleiss example of 10 items and 14
// raters, kappa 0.210; Krippendorff's 2011 example of 4 observers and 12 units, alpha 0.743 nominal, 0.815 ordinal,
// 0.849 interval; Shrout and Fleiss 1979, ICCs .17 .29 .71 .44 .62 .91) and otherwise from a separate Python
// computation with exact fractions, using a different algebraic form from the pack where one exists (the
// kappa-based form of the Fleiss–Cohen–Everitt variance, disagreement weights for weighted kappa, per-unit pair
// averages for alpha, the Fleiss–Everitt closed form for the 3-category Stuart–Maxwell test).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tb-agreement.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const near = (actual, expected, tolerance = 1e-9) => approx(actual, expected, tolerance);
const rowsLike = (result, expected, tolerance = 1e-9) => {
  assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
  expected.forEach(([, value], i) => near(result.rows[i][1], value, tolerance));
};
const tableLike = (result, expected, tolerance = 1e-12) => {
  assert.deepEqual(result.table.columns, expected.columns);
  assert.equal(result.table.rows.length, expected.rows.length);
  expected.rows.forEach((row, i) => { assert.equal(result.table.rows[i].length, row.length); row.forEach((cell, j) => near(result.table.rows[i][j], cell, tolerance)); });
};

// The Wikipedia example: A yes/B yes 20, A yes/B no 5, A no/B yes 10, A no/B no 15 (po = 0.7, pe = 0.5, kappa = 0.4).
const repeat = (line, times) => Array(times).fill(line);
const WIKI_PAIRS = [...repeat("yes,yes", 20), ...repeat("yes,no", 5), ...repeat("no,yes", 10), ...repeat("no,no", 15)].join("\n");
const WIKI_TABLE = "15 10\n5 20";   // rows A (no, yes), columns B (no, yes)
const wiki = { format: "pairs", data: WIKI_PAIRS };
const SCORES = "1 1\n1 2\n2 2\n2 3\n3 3\n3 1\n2 2\n1 1\n3 3\n2 1";
const FLEISS = "0 0 0 0 14\n0 2 6 4 2\n0 0 3 5 6\n0 3 9 2 0\n2 2 8 1 1\n7 7 0 0 0\n3 2 6 3 0\n2 5 3 2 2\n6 5 2 1 0\n0 2 2 3 7";
// Krippendorff (2011): rows are units 1..12, columns observers A..D, "." missing.
const KRIPPENDORFF = ["1 1 . 1", "2 2 3 2", "3 3 3 3", "3 3 3 3", "2 2 2 2", "1 2 3 4", "4 4 4 4", "1 1 2 1", "2 2 2 2", ". 5 5 5", ". . 1 1", ". 3 . ."].join("\n");
const SHROUT_FLEISS = "9\t2\t5\t8\n6\t1\t3\t2\n8\t4\t6\t8\n7\t1\t2\t6\n10\t5\t6\t9\n6\t2\t4\t7";
const THREE_BY_THREE = "20 5 3\n2 15 4\n1 6 10";

checkPack(pack, {
  percent_agreement: {
    values: { ...wiki, level: "0.95" },
    expect: [["Items", 50], ["Items both labeled the same", 35], ["Agreement (share of items)", 0.7], ["Lower 95% bound (Wilson)", 0.5624964953554661], ["Upper 95% bound (Wilson)", 0.8089644649911907]],
    more: [{ values: { format: "table", data: WIKI_TABLE, level: "0.9" }, expect: [["Items", 50], ["Items both labeled the same", 35], ["Agreement (share of items)", 0.7],
      ["Lower 90% bound (Wilson)", 0.5854003725969208], ["Upper 90% bound (Wilson)", 0.794066353088571]] },
    { values: { format: "pairs", data: "rater_a,rater_b\nyes,yes\nno,yes", header: true }, expect: (result) => { near(result.rows[0][1], 2); near(result.rows[2][1], 0.5); } }],
    invalid: [{ format: "pairs", data: "yes,yes,no" }, { format: "pairs", data: "yes,\nno,no" }, { format: "pairs", data: "yes,yes\nyes,yes" }, { format: "table", data: "1 2 3\n4 5 6" },
      { format: "table", data: "0 0\n0 0" }, { format: "pairs", data: "" }],
  },
  cohens_kappa: {
    values: { ...wiki, level: "0.95" },
    expect: [["Items", 50], ["Observed agreement", 0.7], ["Chance agreement", 0.5], ["Cohen's kappa", 0.4], ["Standard error", 0.12699606293110036],
      ["Lower 95% bound", 0.15109229047666117], ["Upper 95% bound", 0.6489077095233389], ["z statistic (kappa = 0)", 2.886751345948129], ["p-value (two-sided)", 0.003892417122778627]],
    more: [{ values: { format: "table", data: WIKI_TABLE }, expect: (result) => near(result.rows[3][1], 0.4) },
      { values: { format: "table", data: `no yes\n${WIKI_TABLE}`, header: true }, expect: (result) => near(result.rows[3][1], 0.4) }],
    invalid: [{ format: "table", data: "5 0\n0 0" }, { format: "pairs", data: "a b c" }, { format: "table", data: `no yes\n${WIKI_TABLE}` }],
  },
  // Pairs (A, B): 1 1, 1 2, 2 2, 2 3, 3 3, 3 1, 2 2, 1 1, 3 3, 2 1. Exact: linear 19/44, quadratic 6/13, unweighted 27/67.
  weighted_kappa: {
    values: { format: "pairs", data: SCORES },
    expect: [["Items", 10], ["Linear weighted kappa", 19 / 44], ["Quadratic weighted kappa", 6 / 13], ["Unweighted kappa", 27 / 67]],
    more: [{ values: { format: "table", data: "2 1 0\n1 2 1\n1 0 2" }, expect: [["Items", 10], ["Linear weighted kappa", 19 / 44], ["Quadratic weighted kappa", 6 / 13], ["Unweighted kappa", 27 / 67]] },
      // Values, not positions, set the distances. Pairs 1 1, 2 2, 5 5, 1 2: shares A (1: 1/2, 2: 1/4, 5: 1/4), B (1: 1/4,
      // 2: 1/2, 5: 1/4). Linear disagreement |i − j| / 4: observed 1/16, expected 26/64, kappa 1 − (1/16)/(13/32) = 11/13.
      // Equally spaced positions would give 1 − (1/8)/(7/16) = 5/7 instead.
      { values: { format: "pairs", data: "1 1\n2 2\n5 5\n1 2" }, expect: (result) => near(result.rows[1][1], 11 / 13) }],
    invalid: [{ format: "pairs", data: "low high\nhigh high" }],
  },
  // Wikipedia data: pooled shares yes 0.55, no 0.45, so chance = 0.505 and pi = 0.195 / 0.495 = 13/33.
  scotts_pi: {
    values: wiki,
    expect: [["Items", 50], ["Observed agreement", 0.7], ["Chance agreement (pooled shares)", 0.505], ["Scott's pi", 13 / 33]],
    invalid: [{ format: "table", data: "1 2\n3" }],
  },
  // Wikipedia Fleiss example: P = 0.378, Pe = 0.213, kappa = 0.210.
  fleiss_kappa: {
    values: { table: FLEISS },
    expect: (result) => {
      rowsLike(result, [["Items", 10], ["Labelers per item", 14], ["Mean observed agreement", 0.378021978021978], ["Chance agreement", 0.21275510204081632],
        ["Fleiss' kappa", 0.20993070442195524], ["Standard error (kappa = 0)", 0.01696506922439313], ["z statistic", 12.374291059190467]]
        .concat([["p-value (two-sided)", 0]]));
      assert.ok(result.rows[7][1] < 1e-30 && result.rows[7][1] > 0);
      tableLike(result, { columns: ["category", "share of labels", "kappa for this category"], rows: [[1, 0.14285714285714285, 0.2012820512820513], [2, 0.2, 0.07967032967032966],
        [3, 0.2785714285714286, 0.17159763313609466], [4, 0.15, 0.030381383322559793], [5, 0.22857142857142856, 0.5076566951566952]] }, 1e-12);
    },
    invalid: [{ table: "1 2\n2 2" }, { table: "1 0\n1 0" }, { table: "2 0\n2 0" }, { table: "1 x\n1 1" }],
  },
  krippendorff_alpha: {
    values: { table: KRIPPENDORFF, level: "nominal" },
    expect: [["Items with two or more labels", 11], ["Pairable labels", 40], ["Observed disagreement", 0.2], ["Expected disagreement", 0.7794871794871795], ["Krippendorff's alpha", 0.743421052631579]],
    more: [{ values: { table: KRIPPENDORFF, level: "ordinal" }, expect: [["Items with two or more labels", 11], ["Pairable labels", 40], ["Observed disagreement", 47.275],
      ["Expected disagreement", 256.0769230769231], ["Krippendorff's alpha", 0.8153875037548813]] },
    { values: { table: KRIPPENDORFF, level: "interval" }, expect: [["Items with two or more labels", 11], ["Pairable labels", 40], ["Observed disagreement", 0.43333333333333335],
      ["Expected disagreement", 2.871794871794872], ["Krippendorff's alpha", 0.8491071428571428]] },
    // Tab-separated with empty cells and a header line: the same data.
    { values: { table: `A\tB\tC\tD\n${KRIPPENDORFF.replace(/ /g, "\t").replace(/\./g, "")}`, level: "nominal", header: true },
      expect: (result) => near(result.rows[4][1], 0.743421052631579) }],
    invalid: [{ table: "1 .\n. 2" }, { table: "low high\nhigh high", level: "ordinal" }, { table: "1 1\n1 1" }],
  },
  // Wikipedia data: pooled shares 0.55 and 0.45, chance = 2 · 0.55 · 0.45 / 1 = 0.495, AC1 = 0.205 / 0.505 = 41/101.
  gwet_ac1: {
    values: wiki,
    expect: [["Items", 50], ["Observed agreement", 0.7], ["Chance agreement (Gwet)", 0.495], ["Gwet's AC1", 41 / 101]],
    more: [{ values: { ...wiki, categories: "3" }, expect: [["Items", 50], ["Observed agreement", 0.7], ["Chance agreement (Gwet)", 0.2475], ["Gwet's AC1", 181 / 301]] }],
    invalid: [{ format: "pairs", data: "a,b\nb,c\nc,a", categories: "2" }],
  },
  // a = 80, b = 5, c = 10, d = 5: po = 0.85, pe = 0.85 · 0.9 + 0.15 · 0.1 = 0.78, kappa = 0.07 / 0.22 = 7/22.
  pabak: {
    values: { a: "80", b: "5", c: "10", d: "5" },
    expect: [["Items", 100], ["Observed agreement", 0.85], ["Cohen's kappa", 7 / 22], ["Prevalence index |a − d| ÷ n", 0.75], ["Bias index |b − c| ÷ n", 0.05], ["PABAK (2 × observed agreement − 1)", 0.7]],
    invalid: [{ a: "0", b: "0", c: "0", d: "0" }, { a: "1", b: "-1", c: "0", d: "0" }],
  },
  bennett_s: {
    values: wiki,
    expect: [["Observed agreement", 0.7], ["Categories (K)", 2], ["Chance agreement 1 ÷ K", 0.5], ["Bennett's S", 0.4]],
    more: [{ values: { ...wiki, categories: "4" }, expect: [["Observed agreement", 0.7], ["Categories (K)", 4], ["Chance agreement 1 ÷ K", 0.25], ["Bennett's S", 0.6]] }],
    invalid: [{ format: "pairs", data: "a,b\nb,c\nc,a", categories: "2" }, { ...wiki, categories: "1" }],
  },
  // Wikipedia data: shares A (no .5, yes .5), B (no .4, yes .6): ceiling .4 + .5 = .9, max kappa (.9 − .5) / .5 = .8.
  max_kappa: {
    values: wiki,
    expect: [["Cohen's kappa", 0.4], ["Highest agreement these shares allow", 0.9], ["Maximum kappa", 0.8], ["Kappa as a share of its maximum", 0.5]],
    invalid: [{ format: "table", data: "0 0\n0 4" }],
  },
  // yes: A 25, B 30, both 20, 40/55; no: A 25, B 20, both 15, 30/45; with two categories each one-vs-rest kappa is 0.4.
  per_category_agreement: {
    values: wiki,
    expect: (result) => tableLike(result, { columns: ["category", "labeler A", "labeler B", "both", "specific agreement", "kappa vs the rest"],
      rows: [["no", 25, 20, 15, 30 / 45, 0.4], ["yes", 25, 30, 20, 40 / 55, 0.4]] }),
    // Three categories: c is only ever used by A, so its specific agreement is 0 and its kappa is negative.
    more: [{ values: { format: "pairs", data: "a a\nb b\nc a\na a\nb b" }, expect: (result) => {
      // c vs rest: both 0, A 1, B 0 of 5 items: po = 4/5, pe = (1/5)(0) + (4/5)(1) = 4/5, so kappa = 0.
      assert.deepEqual(result.table.rows[2].slice(0, 4), ["c", 1, 0, 0]);
      near(result.table.rows[2][4], 0);
      near(result.table.rows[2][5], 0);
    } }],
    invalid: [{ format: "pairs", data: "a" }],
  },
  disagreement_matrix: {
    values: wiki,
    expect: (result) => {
      assert.deepEqual(result.rows, [["Items", 50], ["Disagreements", 15], ["Most common disagreement", "no (A) vs yes (B): 10 items"]]);
      assert.deepEqual(result.table, { columns: ["labeler A \\ labeler B", "no", "yes", "total"], rows: [["no", 15, 10, 25], ["yes", 5, 20, 25], ["total", 20, 30, 50]] });
    },
    more: [{ values: { format: "pairs", data: "x;x\ny;y" }, expect: (result) => assert.deepEqual(result.rows[2], ["Most common disagreement", "none"]) },
      // A tie names every combination with the top count: a→b and b→a once each, c→a once too.
      { values: { format: "pairs", data: "a b\nb a\nc a\na a" }, expect: (result) => assert.deepEqual(result.rows,
        [["Items", 4], ["Disagreements", 3], ["Most common disagreement", "a (A) vs b (B); b (A) vs a (B); c (A) vs a (B): 1 item each"]]) },
      { values: { format: "pairs", data: "a b\na b\nb a\nb b" }, expect: (result) => assert.deepEqual(result.rows[2], ["Most common disagreement", "a (A) vs b (B): 2 items"]) }],
    invalid: [{ format: "table", data: "1 2\n3 x" }],
  },
  // a = 80, b = 5, c = 10, d = 5: PA = 160/175, NA = 10/25.
  positive_negative_agreement: {
    values: { a: "80", b: "5", c: "10", d: "5" },
    expect: [["Positive agreement", 160 / 175], ["Negative agreement", 10 / 25], ["Observed agreement", 0.85], ["Share of labels that are positive", 175 / 200]],
    more: [{ values: { a: "0", b: "0", c: "0", d: "7" }, expect: [["Positive agreement", null], ["Negative agreement", 1], ["Observed agreement", 1], ["Share of labels that are positive", 0]] }],
    invalid: [{ a: "0", b: "0", c: "0", d: "0" }],
  },
  kappa_reading: {
    values: { kappa: "0.62" },
    expect: [["Landis and Koch (1977)", "substantial"], ["Fleiss (1981)", "fair to good"], ["Altman (1991)", "good"]],
    more: [{ values: { kappa: "-0.1" }, expect: [["Landis and Koch (1977)", "poor (below chance)"], ["Fleiss (1981)", "poor"], ["Altman (1991)", "poor"]] },
      { values: { kappa: "0.2" }, expect: [["Landis and Koch (1977)", "slight"], ["Fleiss (1981)", "poor"], ["Altman (1991)", "poor"]] },
      { values: { kappa: "0.4" }, expect: [["Landis and Koch (1977)", "fair"], ["Fleiss (1981)", "fair to good"], ["Altman (1991)", "fair"]] },
      { values: { kappa: "0.9" }, expect: [["Landis and Koch (1977)", "almost perfect"], ["Fleiss (1981)", "excellent"], ["Altman (1991)", "very good"]] }],
    invalid: [{ kappa: "1.5" }, { kappa: "" }],
  },
  // r = 0.6, target 0.8: m = 0.8 · 0.4 / (0.6 · 0.2) = 8/3, so 3 labelers reaching 1.8 / 2.2 = 9/11.
  spearman_brown: {
    values: { r: "0.6", target: "0.8", raters: "2" },
    expect: [["Labelers needed (rounded up)", 3], ["Labelers needed (unrounded)", 8 / 3], ["Reliability with that many", 9 / 11], ["Reliability with 2 labelers", 0.75]],
    // r = 0.5, target 0.8 needs exactly 4 (4 · 0.5 / 2.5 = 0.8), not 5 from rounding noise; a target below r needs 1.
    more: [{ values: { r: "0.5", target: "0.8" }, expect: [["Labelers needed (rounded up)", 4], ["Labelers needed (unrounded)", 4], ["Reliability with that many", 0.8]] },
      { values: { r: "0.9", target: "0.8" }, expect: (result) => { assert.equal(result.rows[0][1], 1); near(result.rows[2][1], 0.9); } }],
    invalid: [{ r: "1", target: "0.8" }, { r: "0.5", target: "0" }],
  },
  // kappa 0.7, yes share 0.3: per-item variance 0.614 (kappa-based form), n = (2 · 1.96)^2 · 0.614 / 0.2^2 = 235.87, so 236.
  kappa_sample_size: {
    values: { kappa: "0.7", prevalence: "0.3", width: "0.2", level: "0.95" },
    expect: [["Items to double-label (rounded up)", 236], ["Standard error of kappa at that size", 0.051006812439655935], ["Expected interval half-width", 0.09997151534791522]],
    invalid: [{ kappa: "0.7", prevalence: "0", width: "0.2" }, { kappa: "0.7", prevalence: "0.3", width: "0" }],
  },
  compare_kappas: {
    values: { k1: "0.72", se1: "0.05", k2: "0.58", se2: "0.06", level: "0.95" },
    expect: [["Difference kappa 1 − kappa 2", 0.14], ["Standard error of the difference", 0.07810249675906655], ["z statistic", 1.7925163190605435], ["p-value (two-sided)", 0.07305029748636327],
      ["Lower 95% bound", -0.013078080750426685], ["Upper 95% bound", 0.29307808075042674]],
    invalid: [{ k1: "0.7", se1: "0", k2: "0.5", se2: "0" }, { k1: "0.7", se1: "-0.1", k2: "0.5", se2: "0.1" }],
  },
  // Shrout and Fleiss (1979): .17, .29, .71, .44, .62, .91; exact fractions 448/2703, 184/635, 920/1287, 1792/4047, 736/1187, 3680/4047.
  icc: {
    values: { table: SHROUT_FLEISS },
    expect: [["Items", 6], ["Labelers", 4], ["ICC(1,1): one labeler, labelers differ per item", 448 / 2703], ["ICC(2,1): one labeler, absolute agreement", 184 / 635],
      ["ICC(3,1): one labeler, consistency", 920 / 1287], ["ICC(1,k): mean of labelers, labelers differ per item", 1792 / 4047],
      ["ICC(2,k): mean of labelers, absolute agreement", 736 / 1187], ["ICC(3,k): mean of labelers, consistency", 3680 / 4047]],
    // Scores 2 0 | 1 2 | 0 1: BMS 1/2, JMS 0, EMS 3/2, WMS 1 by exact fractions, so the ICC(2,k) denominator
    // BMS + (JMS − EMS) / n is exactly 0 and that ICC is unavailable rather than infinite.
    more: [{ values: { table: "2 0\n1 2\n0 1" }, expect: [["Items", 3], ["Labelers", 2], ["ICC(1,1): one labeler, labelers differ per item", -1 / 3],
      ["ICC(2,1): one labeler, absolute agreement", -1], ["ICC(3,1): one labeler, consistency", -1 / 2], ["ICC(1,k): mean of labelers, labelers differ per item", -1],
      ["ICC(2,k): mean of labelers, absolute agreement", null], ["ICC(3,k): mean of labelers, consistency", -2]] }],
    invalid: [{ table: "1 2\n3 ." }, { table: "1 2\nx 3" }, { table: "1 2 3" }, { table: "2 2\n2 2" }],
  },
  // Pairwise kappas by exact fractions: 1/3 (6 items), 8/13 (5 items), −2/13 (5 items); mean 31/117.
  light_kappa: {
    values: { table: "a a a\na b a\nb b b\nb b .\na a b\nb a b" },
    expect: (result) => {
      rowsLike(result, [["Labeler pairs", 3], ["Pairs with a defined kappa", 3], ["Light's kappa (mean of pairwise kappas)", 31 / 117]]);
      tableLike(result, { columns: ["labeler pair", "items both labeled", "Cohen's kappa"], rows: [["labeler 1 and labeler 2", 6, 1 / 3], ["labeler 1 and labeler 3", 5, 8 / 13], ["labeler 2 and labeler 3", 5, -2 / 13]] });
    },
    more: [{ values: { table: "ann,bo\nx,x\nx,x", header: true }, expect: (result) => {
      assert.deepEqual(result.rows[1], ["Pairs with a defined kappa", 0]);
      assert.equal(result.rows[2][1], null);
      assert.deepEqual(result.table.rows, [["ann and bo", 2, null]]);
    } }],
    invalid: [{ table: "a\nb" }, { table: "" }],
  },
  // (5 − 2)^2 / 7 + (3 − 1)^2 / 4 + (4 − 6)^2 / 10 = 94/35 with 3 df.
  bowker_symmetry: {
    values: { format: "table", data: THREE_BY_THREE },
    expect: [["Bowker chi-square", 94 / 35], ["Degrees of freedom", 3], ["p-value", 0.4426604634710991]],
    // Two categories: McNemar without correction, (10 − 5)^2 / 15 with 1 df (Wikipedia data).
    more: [{ values: wiki, expect: (result) => { near(result.rows[0][1], 25 / 15); assert.equal(result.rows[1][1], 1); } }],
    invalid: [{ format: "table", data: "4 0\n0 6" }],
  },
  // Fleiss–Everitt closed form for 3 categories: 175/69 with 2 df, so p = exp(−175/138).
  stuart_maxwell: {
    values: { format: "table", data: THREE_BY_THREE },
    expect: (result) => {
      rowsLike(result, [["Stuart–Maxwell chi-square", 175 / 69], ["Degrees of freedom", 2], ["p-value", Math.exp(-175 / 138)]]);
      assert.deepEqual(result.table, { columns: ["category", "labeler A", "labeler B", "difference A − B"],
        rows: [["category 1", 28, 23, 5], ["category 2", 21, 26, -5], ["category 3", 17, 17, 0]] });
    },
    // Two separate groups of disagreements (1–2 and 3–4) are two McNemar tests: (2 − 1)^2 / 3 + (3 − 1)^2 / 4 with 2 df;
    // a category with no disagreements is left out: (2 − 1)^2 / 3 with 1 df.
    more: [{ values: { format: "table", data: "5 2 0 0\n1 5 0 0\n0 0 5 3\n0 0 1 5" }, expect: (result) => rowsLike(result, [["Stuart–Maxwell chi-square", 4 / 3], ["Degrees of freedom", 2], ["p-value", Math.exp(-2 / 3)]]) },
      { values: { format: "table", data: "5 2 0\n1 5 0\n0 0 4" }, expect: (result) => { near(result.rows[0][1], 1 / 3); assert.equal(result.rows[1][1], 1); } }],
    invalid: [{ format: "table", data: "3 0 0\n0 3 0\n0 0 3" }],
  },
  consensus_labels: {
    values: { table: "yes yes no\nno no no\nyes no .\nmaybe yes no" },
    expect: (result) => {
      rowsLike(result, [["Items", 4], ["Unanimous items", 1], ["Items with a tie for the top label", 2], ["Mean pairwise agreement per item", 1 / 3]]);
      tableLike(result, { columns: ["item", "labels", "majority label", "votes", "share", "status"], rows: [[1, 3, "yes", 2, 2 / 3, "majority"], [2, 3, "no", 3, 1, "unanimous"],
        [3, 2, "no / yes", 1, 0.5, "tie"], [4, 3, "maybe / no / yes", 1, 1 / 3, "tie"]] });
    },
    more: [{ values: { table: "a,,\n,,\nb,b," }, expect: (result) => {
      assert.deepEqual(result.table.rows[0], [1, 1, "a", 1, 1, "one label"]);
      assert.deepEqual(result.table.rows[1], [2, 0, "", 0, null, "no labels"]);
      assert.deepEqual(result.table.rows[2], [3, 2, "b", 2, 1, "unanimous"]);
      assert.equal(result.rows[1][1], 1);
      assert.equal(result.rows[3][1], 1);   // only item 3 has two labels, and they agree
    } }],
    invalid: [{ table: "" }],
  },
  // kappa 0.6 with 10% yes from both: chance .01 + .81 = .82, needed .82 + .6 · .18 = .928.
  target_kappa_agreement: {
    values: { kappa: "0.6", pa: "0.1" },
    expect: [["Chance agreement", 0.82], ["Observed agreement needed", 0.928], ["Highest agreement these shares allow", 1], ["Reachable", "yes"]],
    // 10% and 30% yes: chance .03 + .63 = .66, needed .66 + .9 · .34 = .966, but the shares allow only .1 + .7 = .8.
    more: [{ values: { kappa: "0.9", pa: "0.1", pb: "0.3" }, expect: [["Chance agreement", 0.66], ["Observed agreement needed", 0.966], ["Highest agreement these shares allow", 0.8],
      ["Reachable", "no: the yes rates differ too much"]] }],
    invalid: [{ kappa: "0.6", pa: "1.2" }, { kappa: "", pa: "0.1" }],
  },
  // Wikipedia Fleiss data: AC1 chance = Σ p(1 − p) / 4 = 0.19681, AC1 = (0.37802 − 0.19681) / (1 − 0.19681).
  gwet_ac1_raters: {
    values: { table: FLEISS },
    expect: [["Items", 10], ["Labelers per item", 14], ["Mean observed agreement", 0.378021978021978], ["Chance agreement (Gwet)", 0.1968112244897959], ["Gwet's AC1", 0.2256141508166282]],
    invalid: [{ table: "1 1\n2 0\n0 1" }],
  },
  // Labeler 1: 3 of 5 right, kappa 1/6; labeler 2: 3 of 4 right (one missing), kappa 1/2.
  labelers_vs_reference: {
    values: { table: "ref,ann,bo\nyes,yes,no\nno,no,no\nyes,yes,yes\nno,yes,\nyes,no,yes", header: true },
    expect: (result) => {
      rowsLike(result, [["Labelers", 2], ["Mean accuracy", 0.675]]);
      tableLike(result, { columns: ["labeler", "items with both labels", "accuracy", "Cohen's kappa vs reference"], rows: [["ann", 5, 0.6, 1 / 6], ["bo", 4, 0.75, 0.5]] });
    },
    more: [{ values: { table: "yes yes\nyes yes" }, expect: (result) => tableLike(result, { columns: ["labeler", "items with both labels", "accuracy", "Cohen's kappa vs reference"],
      rows: [["labeler 2", 2, 1, null]] }) }],
    invalid: [{ table: "yes\nno" }],
  },
}, { ctx: () => fakeCtx({}) });

test("tb-agreement: every tool is in the Agreement between labelers group", () => {
  for (const feature of pack.features) assert.equal(feature.group, "Agreement between labelers");
});
