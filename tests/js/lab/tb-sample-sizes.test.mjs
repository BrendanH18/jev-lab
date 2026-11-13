// Tests for the tb-sample-sizes pack. Reference values come from published results where one exists (the classic
// single-sampling plan n = 132, c = 3 for good 1% / bad 5% at risks 0.05 and 0.10; 85 pairs to detect r = 0.3 at
// α = 0.05 and 80% power) and otherwise from a separate Python computation with the standard library only: exact
// fractions for binomial and hypergeometric sums with every size scanned one by one (not the pack's bisection or
// incremental search), statistics.NormalDist for normal quantiles, Student t quantiles from the closed-form t
// distribution function, and Cochran's and Chow–Shao–Wang's formulas evaluated directly.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tb-sample-sizes.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const near = (actual, expected, tolerance = 1e-9) => approx(actual, expected, tolerance);
const STRATA = "retail, 8000, 0.05\nwholesale, 2000, 0.2";

checkPack(pack, {
  // Normal: ((1.645 · 0.4 + 0.8416 · 0.3) / 0.1)² = 82.89; exact scan: n = 82 rejects at X >= 72 with power 0.8057.
  rows_above_target: {
    values: { target: "0.8", expected: "0.9", level: "0.95", power: "0.8" },
    expect: [["Rows needed (normal approximation)", 83], ["Rows needed (exact binomial)", 82], ["Correct rows needed among them", 72], ["Exact power at that size", 0.8057063959899639]],
    invalid: [{ target: "0.9", expected: "0.8", level: "0.95", power: "0.8" }, { target: "0", expected: "0.8", level: "0.95", power: "0.8" }],
  },
  // 1.96² · 0.98 / (0.1² · 0.02) = 18823.15; Poisson events 1.96² / 0.01 = 384.15.
  relative_precision_rows: {
    values: { rate: "0.02", relative: "0.1", level: "0.95" },
    expect: [["Rows needed", 18824], ["Expected cases among them", 18824 * 0.02], ["Events needed for a Poisson rate", 385]],
    invalid: [{ rate: "0", relative: "0.1", level: "0.95" }, { rate: "0.02", relative: "0", level: "0.95" }],
  },
  // 40 errors in 2,000 rows: hypergeometric P(X <= c) first at or below 0.05 at n = 143 (c = 0) and 225 (c = 1);
  // binomial at 149 and 236.
  finite_batch_audit: {
    values: { size: "2000", rate: "0.02", allowed: "0", level: "0.95" },
    expect: [["Errors in the batch at that rate", 40], ["Rows to audit (finite batch)", 143], ["Rows to audit ignoring the batch size", 149], ["Share of the batch audited", 0.0715]],
    more: [{ values: { size: "2000", rate: "0.02", allowed: "1", level: "0.95" }, expect: (result) => { assert.equal(result.rows[1][1], 225); assert.equal(result.rows[2][1], 236); } }],
    invalid: [{ size: "100", rate: "0.01", allowed: "1", level: "0.95" }, { size: "100", rate: "1", allowed: "0", level: "0.95" }],
  },
  // Proportional 400 · 0.8 and 400 · 0.2. Neyman 400 · 8000 √0.0475 / (8000 √0.0475 + 2000 · 0.4) = 274.19 -> 274 and 126.
  stratified_allocation: {
    values: { strata: STRATA, total: "400" },
    expect: { table: { columns: ["Stratum", "Rows", "Expected rate", "Proportional", "Neyman"], rows: [["retail", 8000, 0.05, 320, 274], ["wholesale", 2000, 0.2, 80, 126]] } },
    more: [
      // a and b would get 115.5 and 11.5 rows by Neyman, more than they hold: capped at 100 and 10, c takes the other 90.
      // Proportional quotas 2000/111, 200/111, 20000/111 floor to 199 rows; the extra one goes to b (largest remainder).
      { values: { strata: "a, 100, 0.5\nb, 10, 0.5\nc, 1000, 0.001", total: "200" },
        expect: { table: { columns: ["Stratum", "Rows", "Expected rate", "Proportional", "Neyman"], rows: [["a", 100, 0.5, 18, 100], ["b", 10, 0.5, 2, 10], ["c", 1000, 0.001, 180, 90]] } } },
      // Three equal strata: 33⅓ each, the spare row goes to the first line.
      { values: { strata: "1000, 0.1\n1000, 0.1\n1000, 0.1", total: "100" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[3], row[4]]),
        [["Stratum 1", 34, 34], ["Stratum 2", 33, 33], ["Stratum 3", 33, 33]]) },
    ],
    invalid: [{ strata: STRATA, total: "10001" }, { strata: "retail, 8000, 0.05", total: "10" }, { strata: "a, 0, 0.1\nb, 10, 0.1", total: "5" }, { strata: "a, 10, 2\nb, 10, 0.1", total: "5" }],
  },
  // Cochran with V = (0.02 / 1.96)²: (Σ W S)² / (V + Σ W S² / N), Σ W S² / (V + Σ W S² / N) and p(1 − p) / (V + p(1 − p) / N).
  stratified_total: {
    values: { strata: STRATA, margin: "0.02", level: "0.95" },
    expect: [["Rows with Neyman allocation", 583], ["Rows with proportional allocation", 630], ["Rows as one simple random sample", 661], ["Expected overall error rate", 0.08]],
    invalid: [{ strata: STRATA, margin: "0", level: "0.95" }],
  },
  // 2 (1.96 + 1.2816)² = 21.01; + 1.96² / 4 = 21.98 -> 22 (R's power.t.test gives 22.02 by the t distribution).
  two_means_rows: {
    values: { delta: "1", sd: "1", alpha: "0.05", power: "0.9" },
    expect: [["Rows per group (normal approximation)", 22], ["Rows per group (with the correction)", 22], ["Rows in total", 44]],
    more: [{ values: { delta: "50", sd: "120", alpha: "0.05", power: "0.8" }, expect: [["Rows per group (normal approximation)", 91], ["Rows per group (with the correction)", 92], ["Rows in total", 184]] }],
    invalid: [{ delta: "0", sd: "1", alpha: "0.05", power: "0.9" }, { delta: "1", sd: "0", alpha: "0.05", power: "0.9" }],
  },
  audit_power: {
    values: { n: "100", allowed: "1", rate: "0.03", acceptable: "0.005" },
    expect: [["Chance the audit catches it", 0.8053778799341641], ["Chance the batch passes", 0.19462212006583596], ["Expected errors found", 3], ["False alarm chance at the acceptable rate", 0.0898223089913179]],
    more: [{ values: { n: "100", allowed: "1", rate: "0.03" }, expect: (result) => assert.equal(result.rows[3][1], null) }],
    invalid: [{ n: "5", allowed: "5", rate: "0.03" }],
  },
  // Scanning m: P(Bin(m, 0.02) >= 5) first reaches 0.5 at m = 234 and 0.95 at m = 456.
  rows_until_errors: {
    values: { k: "5", rate: "0.02", chance: "0.95" },
    expect: [["Expected rows", 250], ["Standard deviation", Math.sqrt(5 * 0.98) / 0.02], ["Median rows", 234], ["Rows for the chance wanted", 456]],
    invalid: [{ k: "5", rate: "0", chance: "0.95" }, { k: "0", rate: "0.02", chance: "0.95" }],
  },
  rare_cases: {
    values: { n: "500", rate: "0.004", r: "3" },
    expect: [["Expected cases", 2], ["Standard deviation", Math.sqrt(500 * 0.004 * 0.996)], ["Chance of none", 0.13479358121064047], ["Chance of fewer than r", 0.6766767785260409],
      ["Chance of at least r", 0.32332322147395914]],
    invalid: [{ n: "500", rate: "0.004", r: "0" }],
  },
  // 1 + 9 · 0.05 = 1.45; 385 · 1.45 = 558.25 -> 559 rows, 56 groups, 10 / 1.45.
  design_effect: {
    values: { rows: "385", perGroup: "10", icc: "0.05" },
    expect: [["Design effect", 1.45], ["Rows needed", 559], ["Groups needed", 56], ["Independent rows each group is worth", 10 / 1.45]],
    more: [{ values: { rows: "385", perGroup: "10", icc: "0" }, expect: [["Design effect", 1], ["Rows needed", 385], ["Groups needed", 39], ["Independent rows each group is worth", 10]] }],
    invalid: [{ rows: "385", perGroup: "0.5", icc: "0.05" }, { rows: "385", perGroup: "10", icc: "1.5" }],
  },
  // 1.96² a(1 − a) / 0.05²: 72.99, 138.29, 245.85 labels; ÷ share: 122, 464, 2460 rows.
  per_class_labels: {
    values: { classes: "refund, 0.6, 0.95\nexchange, 0.3, 0.9\nfraud, 0.1, 0.8", margin: "0.05", level: "0.95" },
    expect: (result) => {
      assert.deepEqual(result.rows, [["Rows to sample so every class has enough", 2460], ["Class that needs the most rows", "fraud"]]);
      assert.deepEqual(result.table, { columns: ["Class", "Share of rows", "Expected accuracy", "Labels needed", "Rows to sample"],
        rows: [["refund", 0.6, 0.95, 73, 122], ["exchange", 0.3, 0.9, 139, 464], ["fraud", 0.1, 0.8, 246, 2460]] });
    },
    invalid: [{ classes: "a, 0.7, 0.9\nb, 0.6, 0.9", margin: "0.05", level: "0.95" }, { classes: "a, 0.7, 1", margin: "0.05", level: "0.95" }, { classes: "a, 0.7", margin: "0.05", level: "0.95" }],
  },
  // Uniform prior, no errors: 1 − 0.98^(n + 1) >= 0.95 first at n = 148. Two errors: P(Bin(n + 1, 0.02) >= 3) >= 0.95 first at n = 312.
  bayes_audit_rows: {
    values: { target: "0.02", chance: "0.95", errors: "0", a: "1", b: "1" },
    expect: [["Rows to audit", 148], ["Chance the error rate is below the target", 1 - 0.98 ** 149]],
    more: [{ values: { target: "0.02", chance: "0.95", errors: "2", a: "1", b: "1" }, expect: [["Rows to audit", 312], ["Chance the error rate is below the target", 0.950269595429201]] }],
    invalid: [{ target: "0", chance: "0.95", errors: "0", a: "1", b: "1" }],
  },
  // (1.96 · 120 / 20)² = 138.29 -> 139; t: 141 is the first n with t(0.975, n − 1) · 120 / √n <= 20; FPC with N = 1000: 121.6 -> 122.
  mean_margin_rows: {
    values: { sd: "120", margin: "20", level: "0.95", population: "1000" },
    expect: [["Rows (normal approximation)", 139], ["Rows (Student t)", 141], ["Rows with the population correction", 122]],
    more: [{ values: { sd: "120", margin: "20", level: "0.95" }, expect: (result) => assert.equal(result.rows[2][1], null) }],
    invalid: [{ sd: "0", margin: "20", level: "0.95" }],
  },
  // (1.96 + 0.8416)² · 0.18 / 0.05² = 565.1; equivalence uses z for 1 − β/2 at 80% power: (1.96 + 1.2816)² · 0.18 / 0.05² = 756.5.
  noninferiority_rows: {
    values: { pNew: "0.9", pCurrent: "0.9", margin: "0.05", alpha: "0.025", power: "0.8", design: "noninferiority" },
    expect: [["Rows per variant", 566], ["Rows in total", 1132]],
    more: [{ values: { pNew: "0.9", pCurrent: "0.9", margin: "0.05", alpha: "0.025", power: "0.8", design: "equivalence" }, expect: [["Rows per variant", 757], ["Rows in total", 1514]] },
      { values: { pNew: "0.92", pCurrent: "0.9", margin: "0.05", alpha: "0.025", power: "0.8", design: "noninferiority" }, expect: [["Rows per variant", 263], ["Rows in total", 526]] }],
    invalid: [{ pNew: "0.8", pCurrent: "0.9", margin: "0.05", alpha: "0.025", power: "0.8", design: "noninferiority" },
      { pNew: "0.8", pCurrent: "0.9", margin: "0.05", alpha: "0.025", power: "0.8", design: "equivalence" }, { pNew: "1", pCurrent: "1", margin: "0.05", alpha: "0.025", power: "0.8", design: "noninferiority" }],
  },
  acceptance_plan: {
    values: { good: "0.01", bad: "0.05", producer: "0.05", consumer: "0.1" },
    expect: [["Rows to audit", 132], ["Errors allowed", 3], ["Chance a good batch passes", 0.9557474941740338], ["Chance a bad batch passes", 0.09922830442578345]],
    invalid: [{ good: "0.05", bad: "0.01", producer: "0.05", consumer: "0.1" }, { good: "0", bad: "0.05", producer: "0.05", consumer: "0.1" }],
  },
  // Hanley–McNeil at AUC 0.85 with three negatives per positive: 99 positives is the first with half-width <= 0.05.
  auc_rows: {
    values: { auc: "0.85", ratio: "3", half: "0.05", level: "0.95" },
    expect: [["Positives needed", 99], ["Negatives needed", 297], ["Rows in total", 396], ["Half-width at that size", 0.049950294896946204]],
    // With 0.001 negatives per positive the half-width cannot reach 0.000003 below the search limit: every value is unavailable.
    more: [{ values: { auc: "0.85", ratio: "0.001", half: "0.000003", level: "0.99" }, expect: [["Positives needed", null], ["Negatives needed", null], ["Rows in total", null], ["Half-width at that size", null]] }],
    invalid: [{ auc: "1", ratio: "3", half: "0.05", level: "0.95" }, { auc: "0.4", ratio: "3", half: "0.05", level: "0.95" }, { auc: "0.85", ratio: "3", half: "0", level: "0.95" }],
  },
  correlation_rows: {
    values: { r: "0.3", alpha: "0.05", power: "0.8" },
    expect: [["Pairs needed", 85], ["Fisher z of r", Math.atanh(0.3)]],
    more: [{ values: { r: "-0.3", alpha: "0.05", power: "0.8" }, expect: [["Pairs needed", 85], ["Fisher z of r", Math.atanh(0.3)]] }],
    invalid: [{ r: "0", alpha: "0.05", power: "0.8" }, { r: "1", alpha: "0.05", power: "0.8" }],
  },
  // 1.96² (0.1275 + 0.09) / 0.05² = 334.2 -> 335.
  difference_margin_rows: {
    values: { p1: "0.85", p2: "0.9", margin: "0.05", level: "0.95" },
    expect: [["Rows per variant", 335], ["Rows in total", 670]],
    invalid: [{ p1: "0.85", p2: "0.9", margin: "0", level: "0.95" }, { p1: "0", p2: "1", margin: "0.05", level: "0.95" }],
  },
  // 1.96² · 0.95 · 0.05 / 0.03² = 202.7 -> 203 automated; 203 / 0.7 = 290 labeled; coverage margin 1.96 √(0.21 / 290).
  gate_label_rows: {
    values: { coverage: "0.7", accuracy: "0.95", margin: "0.03", level: "0.95" },
    expect: [["Automated rows needed", 203], ["Rows to label in all", 290], ["Coverage margin at that size", 0.05274226049925815]],
    invalid: [{ coverage: "0", accuracy: "0.95", margin: "0.03", level: "0.95" }, { coverage: "0.7", accuracy: "0.95", margin: "0", level: "0.95" },
      { coverage: "0.7", accuracy: "1", margin: "0.03", level: "0.95" }, { coverage: "0.7", accuracy: "0", margin: "0.03", level: "0.95" }],
  },
}, { ctx: () => fakeCtx({}) });

test("tb-sample-sizes: every tool is in the Sample sizes group", () => {
  for (const feature of pack.features) assert.equal(feature.group, "Sample sizes");
});

test("tb-sample-sizes: the stratified allocations always add up to the total", () => {
  const tool = pack.features.find((feature) => feature.id === "stratified_allocation");
  for (const total of [1, 7, 99, 401, 1110]) {
    const rows = tool.compute({ strata: "a, 100, 0.5\nb, 10, 0.5\nc, 1000, 0.001", total }).table.rows;
    assert.equal(rows.reduce((sum, row) => sum + row[3], 0), total);
    assert.equal(rows.reduce((sum, row) => sum + row[4], 0), total);
    rows.forEach((row) => assert.ok(row[4] <= row[1] && row[3] <= row[1]));
  }
});

test("tb-sample-sizes: a design effect of 1 changes nothing", () => near(pack.features.find((f) => f.id === "design_effect").compute({ rows: 100, perGroup: 1, icc: 0.4 })[0][1], 1));
