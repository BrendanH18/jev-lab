// Tests for the tb-experiments Toolbox pack. Reference values come from published tables where they exist
// (Jennison & Turnbull, Group Sequential Methods, tables 2.1–2.4: Pocock constants 2.178, 2.289, 2.361, 2.413,
// O'Brien–Fleming constants 1.977, 2.004, 2.024, 2.040, inflation factors 1.110/1.166/1.202/1.229 and
// 1.008/1.017/1.024/1.028; Armitage, McPherson and Rowe's repeated-test error 0.083, 0.107, 0.126, 0.142, 0.193) and
// otherwise from a separate stdlib Python computation: statistics.NormalDist quantiles with the textbook formulas
// evaluated directly, its own bisection, exact fractions for the binomial sums, brute-force tie sums for the winner,
// and a trapezoid-rule recursion on a fixed 0.004 grid (not the pack's Simpson grid) for the sequential boundaries.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tb-experiments.js";
import { runTool } from "../../../static/js/lab/kit.js";
import { approx, checkPack } from "./harness.mjs";

const feature = (id) => pack.features.find((f) => f.id === id);
const rowsAre = (expected, tolerance = 1e-9) => (result) => {
  assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
  expected.forEach(([label, value], i) => approx(result.rows[i][1], value, tolerance, label));
};
const tableIs = (columns, rows, tolerance = 1e-9) => (result) => {
  assert.deepEqual(result.table.columns, columns);
  assert.equal(result.table.rows.length, rows.length);
  rows.forEach((row, i) => row.forEach((cell, j) => approx(result.table.rows[i][j], cell, tolerance, `row ${i + 1} cell ${j + 1}:`)));
};
const both = (...checks) => (result) => checks.forEach((check) => check(result));
const column = (result, j) => result.table.rows.map((row) => row[j]);

checkPack(pack, {
  // Fleiss with r = 4: raw 409.33 → A 410, B ⌈1637.3⌉ = 1,638; an even split needs 686 per variant (the starter's
  // Rows per variant for 0.85 against 0.9).
  unequal_split_rows: {
    values: { p1: "0.85", p2: "0.9", ratio: "4", alpha: "0.05", power: "0.8" },
    expect: [["Rows for A", 410], ["Rows for B", 1638], ["Rows in total", 2048], ["Rows in total with an even split", 1372], ["Extra rows for the uneven split", 676]],
    more: [{ values: { p1: "0.85", p2: "0.9", ratio: "1", alpha: "0.05", power: "0.8" }, expect: (result) => { assert.equal(result.rows[0][1], 686); assert.equal(result.rows[4][1], 0); } }],
    invalid: [{ p1: "0.9", p2: "0.9", ratio: "2" }, { p1: "0.85", p2: "0.9", ratio: "0" }],
  },
  // Level 0.05 / 3 each; control gets √3 × each variant's rows: 1,277 and 737; equal arms 915 each.
  many_vs_control_rows: {
    values: { control: "0.85", variant: "0.9", k: "3", alpha: "0.05", power: "0.8" },
    expect: [["Significance per comparison", 0.05 / 3], ["Rows for the control", 1277], ["Rows per variant", 737], ["Rows in total", 1277 + 3 * 737], ["Rows in total with equal arms", 4 * 915]],
    invalid: [{ control: "0.85", variant: "0.85", k: "3" }, { control: "0.85", variant: "0.9", k: "0" }],
  },
  // Python bisection on Φ((d√500 − 1.96·√0.2) / √(0.2 − d²)) = 0.8.
  paired_mde: {
    values: { rows: "500", discordant: "0.2", alpha: "0.05", power: "0.8" },
    expect: [["Smallest detectable difference", 0.05589969282208476], ["Rows where exactly one is right", 100], ["Share of those won by the better variant", 0.639749232055212]],
    tolerance: 1e-8,
    more: [{ values: { rows: "3", discordant: "0.05", alpha: "0.05", power: "0.95" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /No difference/); } }],
    invalid: [{ rows: "500", discordant: "0" }, { rows: "500", discordant: "1" }, { rows: "0", discordant: "0.2" }],
  },
  // 200 a day split in two: 700, 1,400 and 2,800 rows per variant; Python bisection on the same-size formula.
  deadline_mde: {
    values: { baseline: "0.85", volume: "200", traffic: "1", alpha: "0.05", power: "0.8", days: "7, 14 28" },
    expect: tableIs(["Days", "Rows per variant", "Smallest detectable rise", "Smallest detectable fall"],
      [[7, 700, 0.04952414162944441, 0.05731620018168593], [14, 1400, 0.03583705990631014, 0.039747244483424926], [28, 2800, 0.025750194892930733, 0.027708844721502035]], 1e-8),
    more: [{ values: { baseline: "0.85", volume: "1", traffic: "1", days: "1" }, expect: (result) => assert.deepEqual(result.table.rows, [[1, 0, null, null]]) }],
    invalid: [{ baseline: "0", volume: "200", days: "7" }, { baseline: "0.85", volume: "200", days: "" }, { baseline: "0.85", volume: "200", days: "7, soon" }],
  },
  // 300 · 0.5 · 0.8 = 120 usable rows a day: ⌈2,000 / 120⌉ = 17 days, 21 in whole weeks; looks at 500/1,000/1,500/2,000 rows.
  collection_days: {
    values: { rows: "2000", volume: "300", traffic: "0.5", labeled: "0.8", looks: "4", weeks: true },
    expect: both(rowsAre([["Usable rows per day", 120], ["Days", 21], ["Weeks", 3], ["Traffic seen in that time", 6300]]),
      tableIs(["Look", "Rows by then", "Day"], [[1, 500, 5], [2, 1000, 9], [3, 1500, 13], [4, 2000, 17]])),
    more: [{ values: { rows: "2000", volume: "300", traffic: "0.5", labeled: "0.8", looks: "1" }, expect: (result) => { assert.equal(result.rows[1][1], 17); assert.deepEqual(result.table.rows, [[1, 2000, 17]]); } }],
    invalid: [{ rows: "2000", volume: "300", traffic: "0" }, { rows: "0", volume: "300" }],
  },
  // Pocock at 5 looks: 2.413 (J&T), 2.41317487 (Python); O'Brien–Fleming 2.040 / 2.04007213, boundaries c·√(5/k);
  // Haybittle–Peto final 1.99004494 (Python).
  group_sequential: {
    values: { looks: "5", alpha: "0.05", shape: "pocock" },
    expect: both(rowsAre([["Boundary constant", 2.41317486660555], ["Final-look boundary", 2.41317486660555], ["Significance spent in all", 0.05]], 1e-5),
      (result) => {
        approx(result.rows[0][1], 2.413, 5e-4);
        column(result, 2).forEach((b) => approx(b, 2.41317486660555, 1e-5));
        column(result, 3).forEach((p) => approx(p, 0.0158141, 1e-4));
        approx(result.table.rows[4][4], 0.05, 1e-8);
      }),
    more: [
      { values: { looks: "5", alpha: "0.05", shape: "obf" }, expect: (result) => {
        approx(result.rows[0][1], 2.040072129806504, 1e-5);
        approx(result.rows[0][1], 2.040, 5e-4);
        column(result, 2).forEach((b, k) => approx(b, 2.040072129806504 * Math.sqrt(5 / (k + 1)), 1e-5));
      } },
      { values: { looks: "5", alpha: "0.05", shape: "hp" }, expect: (result) => {
        approx(result.rows[1][1], 1.990044940356165, 1e-5);
        assert.deepEqual(column(result, 2).slice(0, 4), [3, 3, 3, 3]);
      } },
      ...[[2, 2.178, 1.977], [3, 2.289, 2.004], [4, 2.361, 2.024]].flatMap(([K, pocock, obf]) => [
        { values: { looks: String(K), alpha: "0.05", shape: "pocock" }, expect: (result) => approx(result.rows[0][1], pocock, 5e-4) },
        { values: { looks: String(K), alpha: "0.05", shape: "obf" }, expect: (result) => approx(result.rows[0][1], obf, 5e-4) },
      ]),
      { values: { looks: "1", alpha: "0.01", shape: "pocock" }, expect: (result) => approx(result.rows[0][1], 2.5758293035489004, 1e-9) },
    ],
    invalid: [{ looks: "0", alpha: "0.05", shape: "obf" }, { looks: "21", alpha: "0.05", shape: "obf" }, { looks: "8", alpha: "0.01", shape: "hp" }],
  },
  // O'Brien–Fleming-type spending 2 − 2Φ(1.96/√t) at 0.25, 0.5, 0.75, 1 (Python, trapezoid recursion and bisection).
  alpha_spending: {
    values: { fractions: "0.25, 0.5, 0.75, 1", alpha: "0.05", spending: "obf" },
    expect: (result) => {
        assert.deepEqual(result.table.columns, ["Look", "Fraction", "Significance spent by then", "Spent at this look", "Boundary (|z| ≥)", "Nominal p"]);
        const expected = [[0.25, 8.857543832130332e-05, 8.857543832130332e-05, 3.9199279691529227], [0.5, 0.005574596680784527, 0.005486021242463224, 2.773952365430887],
          [0.75, 0.023625121317601305, 0.018050524636816778, 2.298241807773593], [1, 0.05, 0.02637487868239874, 2.0426375564857153]];
        expected.forEach(([t, cumulative, part, b], i) => {
          const row = result.table.rows[i];
          assert.equal(row[0], i + 1); approx(row[1], t); approx(row[2], cumulative, 1e-9); approx(row[3], part, 1e-9); approx(row[4], b, 1e-5);
          if (i === 0) approx(row[5], part, 1e-6);   // at the first look the nominal p is what it spends
        });
      },
    more: [
      // linear spending: 0.05 · t
      { values: { fractions: "0.5 1", alpha: "0.05", spending: "linear" }, expect: (result) => { approx(result.table.rows[0][2], 0.025); approx(result.table.rows[0][4], 2.241402727604947, 1e-7); } },
      // Pocock-type: 0.05 · ln(1 + (e − 1) · 0.5) at the first look
      { values: { fractions: "0.5, 1", alpha: "0.05", spending: "pocock" }, expect: (result) => approx(result.table.rows[0][2], 0.05 * Math.log(1 + (Math.E - 1) * 0.5)) },
    ],
    invalid: [{ fractions: "0.5, 0.9" }, { fractions: "0.5, 0.4, 1" }, { fractions: "0.5, 0.505, 1" }, { fractions: "" }, { fractions: "0, 1" }, { fractions: "half, 1" }],
  },
  // Pocock at 3 looks, 80% power: R = 1.166 (J&T); Python: 1.16630849, expected 0.81852 (real) and 1.14299 (none) of the fixed size.
  sequential_rows: {
    values: { rows: "1000", looks: "3", alpha: "0.05", power: "0.8", shape: "pocock" },
    expect: both(rowsAre([["Inflation factor", 1.1663084907922894], ["Most rows per variant", 1167], ["Expected rows per variant if the difference is real", 818.5205313658787],
      ["Expected rows per variant if there is none", 1142.9864249344908], ["Power", 0.8]], 1e-5),
    tableIs(["Look", "Rows per variant by then", "Boundary (|z| ≥)", "Chance of stopping here if the difference is real"],
      [[1, 389, 2.289477509219432, 0.293712422708753], [2, 778, 2.289477509219432, 0.307161695378798], [3, 1167, 2.289477509219432, 0.1991258819765134]], 1e-5)),
    more: [[2, 1.110, 1.008], [4, 1.202, 1.024], [5, 1.229, 1.028]].flatMap(([K, pocock, obf]) => [
      { values: { rows: "1000", looks: String(K), alpha: "0.05", power: "0.8", shape: "pocock" }, expect: (result) => approx(result.rows[0][1], pocock, 1e-3) },
      { values: { rows: "1000", looks: String(K), alpha: "0.05", power: "0.8", shape: "obf" }, expect: (result) => approx(result.rows[0][1], obf, 1e-3) },
    ]),
    invalid: [{ rows: "1000", looks: "1" }, { rows: "0", looks: "3" }],
  },
  // Python: 0.05, 0.08312, 0.10726, 0.12617, 0.14169 by look; the published 0.083/0.107/0.126/0.142 and 0.193 at 10 looks.
  peeking_error: {
    values: { looks: "5", alpha: "0.05" },
    expect: both(rowsAre([["False win chance over all looks", 0.14168887609882438], ["Times the planned level", 0.14168887609882438 / 0.05], ["Boundary that keeps the level (Pocock)", 2.41317486660555]], 1e-5),
      tableIs(["Look", "False win chance by then"], [[1, 0.05], [2, 0.08311770891023376], [3, 0.10725615900705981], [4, 0.1261686736153303], [5, 0.14168887609882438]], 1e-5)),
    more: [{ values: { looks: "10", alpha: "0.05" }, expect: (result) => approx(result.rows[0][1], 0.193, 3e-3) }],
    invalid: [{ looks: "0", alpha: "0.05" }],
  },
  // 20 variants, 10% better: 20 · 0.1 · 0.8 = 1.6 real and 20 · 0.9 · 0.05 = 0.9 false wins; 1 − 0.955^20 and 1 − 0.92^20.
  many_variants_fdr: {
    values: { variants: "20", better: "0.1", power: "0.8", alpha: "0.05" },
    expect: [["Expected real wins", 1.6], ["Expected false wins", 0.9], ["False share of wins", 0.36], ["Chance of at least one false win", 0.6018310116739696], ["Chance of at least one real win", 0.8113066708372033]],
    more: [{ values: { variants: "5", better: "0", power: "0.8", alpha: "0" }, expect: (result) => { assert.equal(result.rows[2][1], null); assert.equal(result.rows[3][1], 0); } }],
    invalid: [{ variants: "0", better: "0.1", power: "0.8", alpha: "0.05" }, { variants: "5", better: "1.2", power: "0.8", alpha: "0.05" }],
  },
  // 4 variants, every pair: 6 comparisons at 0.05 / 6; Šidák 1 − 0.95^(1/6); z = Φ⁻¹(1 − 0.05/12); 1 − 0.95^6.
  bonferroni_budget: {
    values: { k: "4", design: "pairs", alpha: "0.05", power: "0.8" },
    expect: [["Comparisons", 6], ["Significance per comparison (Bonferroni)", 0.05 / 6], ["Significance per comparison (Šidák)", 0.008512444610847103], ["Two-sided z per comparison", 2.638257273476751],
      ["Rows per comparison, times a single test's", 1.5428385748900078], ["False win chance with no correction", 0.2649081093750002]],
    tolerance: 1e-9,
    more: [
      { values: { k: "4", design: "control", alpha: "0.05", power: "0.8" }, expect: (result) => { assert.equal(result.rows[0][1], 3); approx(result.rows[4][1], 1.3338354518884556); approx(result.rows[5][1], 0.1426250000000001); } },
      { values: { k: "4", design: "count", m: "10", alpha: "0.05", power: "0.8" }, expect: (result) => { assert.equal(result.rows[0][1], 10); approx(result.rows[3][1], 2.8070337683438114); approx(result.rows[5][1], 0.4012630607616213); } },
    ],
    invalid: [{ k: "4", design: "count", alpha: "0.05" }, { k: "1", design: "pairs" }],
  },
  // Five variants at 0.85 on 200 rows each, exact fractions: beating the control by 7+ correct rows, the best above 176.
  lucky_win: {
    values: { k: "5", accuracy: "0.85", rows: "200", margin: "0.03" },
    expect: [["Chance some variant beats the control by more than the margin", 0.4037212597529619], ["Chance the best measures more than the margin above the truth", 0.39601721547923935],
      ["Expected accuracy of the best variant as measured", 0.8788344684561487], ["Winner's curse (best measured minus true)", 0.028834468456148676]],
    tolerance: 1e-9,
    // a variant that is always right never beats another by anything
    more: [{ values: { k: "3", accuracy: "1", rows: "10", margin: "0" }, expect: [["Chance some variant beats the control by more than the margin", 0],
      ["Chance the best measures more than the margin above the truth", 0], ["Expected accuracy of the best variant as measured", 1], ["Winner's curse (best measured minus true)", 0]] }],
    invalid: [{ k: "1", accuracy: "0.85", rows: "200", margin: "0.03" }, { k: "5", accuracy: "0.85", rows: "0", margin: "0.03" }],
  },
  // Brute-force tie sums: 0.84833 at 200 rows; a scan of every size finds 264 rows (0.89962 at 263, 0.90027 at 264).
  correct_selection: {
    values: { k: "4", best: "0.9", other: "0.85", rows: "200", chance: "0.9" },
    expect: [["Chance the best variant comes out on top", 0.8483254338166355], ["Rows per variant for the chance wanted", 264], ["Rows in total", 1056]],
    tolerance: 1e-9,
    more: [
      // 3 variants on 2 rows, best 0.6 and others 0.5: enumerating all 27 outcomes with ties split evenly gives 493/1200.
      { values: { k: "3", best: "0.6", other: "0.5", rows: "2", chance: "0.9" }, expect: (result) => approx(result.rows[0][1], 493 / 1200, 1e-12) },
      { values: { k: "50", best: "0.5001", other: "0.5", chance: "0.99" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.equal(result.rows[1][1], null); assert.match(result.note, /20,000/); } },
    ],
    invalid: [{ k: "4", best: "0.85", other: "0.85" }, { k: "1", best: "0.9", other: "0.85" }],
  },
  // Python bisection on the share: 0.0641875; ⌈0.0641875 · 20,000⌉ = 1,284 held out; the best split √b / (√a + √b).
  holdout_size: {
    values: { rows: "20000", gated: "0.9", held: "0.85", margin: "0.02", level: "0.95" },
    expect: [["Smallest holdout share", 0.064187467607599], ["Holdout rows", 1284], ["Rows with the gate", 18716], ["Half-width at that split", 0.019998144161003147],
      ["Narrowest half-width possible", 0.009106377958267554], ["Holdout share for the narrowest", 0.54342862858286]],
    tolerance: 1e-9,
    more: [{ values: { rows: "100", gated: "0.9", held: "0.85", margin: "0.02", level: "0.95" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.equal(result.rows[1][1], null); assert.match(result.note, /No split/); } }],
    invalid: [{ rows: "20000", gated: "1", held: "0.85", margin: "0.02" }, { rows: "20000", gated: "0.9", held: "0.85", margin: "0" }],
  },
  // ⌈1.96² · 0.1975 / 0.0004⌉ = 1,897 paired; ⌈1.96² · 0.2175 / 0.0004⌉ = 2,089 per variant separately.
  paired_precision: {
    values: { p1: "0.85", p2: "0.9", discordant: "0.2", margin: "0.02", level: "0.95" },
    expect: [["Paired rows to label", 1897], ["Separate rows per variant", 2089], ["Separate rows to label", 4178]],
    invalid: [{ p1: "0.85", p2: "0.9", discordant: "0.01", margin: "0.02" }, { p1: "0.85", p2: "0.9", discordant: "0.2", margin: "0" }],
  },
  // z = 2.2: p = 0.0278; Φ(2.2 − 1.96) + Φ(−4.16); Φ(2.2/√2); Φ(0.24/√2).
  replication: {
    values: { z: "-2.2", alpha: "0.05" },
    expect: [["Two-sided p of the result", 0.02780689502699718], ["Power of an exact repeat at the observed difference", 0.5948647467172454], ["Chance a repeat points the same way", 0.9401025347870409],
      ["Chance a repeat is significant the same way", 0.567389190409579]],
    tolerance: 1e-9,
    invalid: [{ z: "x" }, { z: "60" }],
  },
  // τ² / (τ² + se²) = 1e-4 / 3.25e-4 = 0.3077; centre 0.009231; sd √0.3077 · 0.015.
  shrink_difference: {
    values: { difference: "0.03", se: "0.015", spread: "0.01", level: "0.95" },
    expect: [["Shrinkage factor", 0.3076923076923077], ["Shrunk difference", 0.009230769230769232], ["Lower end", -0.0070771168715120115], ["Upper end", 0.025538655333050476],
      ["Chance the true difference is above 0", 0.8663712534228061]],
    tolerance: 1e-9,
    invalid: [{ difference: "0.03", se: "0", spread: "0.01" }, { difference: "2", se: "0.01", spread: "0.01" }],
  },
  // z = 1.2 at half the rows: trend θ = 1.2/√0.5, plan θ = 1.96 + 0.8416, none θ = 0.
  conditional_power: {
    values: { z: "1.2", fraction: "0.5", alpha: "0.05", power: "0.8" },
    expect: [["If the current trend continues", 0.35501803423817413], ["If the planned difference is real", 0.6588080499437569], ["If there is no difference", 0.0579975835789055],
      ["Final z the trend points to", 1.6970562748477138]],
    tolerance: 1e-9,
    invalid: [{ z: "1.2", fraction: "1" }, { z: "1.2", fraction: "0" }],
  },
  // 0.2 · 0.05 = 0.01 overall: 19,461 per variant; affected only: 686, which takes ⌈686 / 0.2⌉ = 3,430 rows of traffic.
  diluted_rows: {
    values: { baseline: "0.85", change: "0.05", affected: "0.2", alpha: "0.05", power: "0.8" },
    expect: [["Difference over all rows", 0.01], ["Rows per variant analyzing all rows", 19461], ["Affected rows per variant analyzing only them", 686], ["Rows of traffic per variant to collect them", 3430],
      ["Traffic saved by analyzing only affected rows", 16031]],
    invalid: [{ baseline: "0.85", change: "0", affected: "0.2" }, { baseline: "0.85", change: "0.2", affected: "0.2" }, { baseline: "0.85", change: "0.05", affected: "0" }],
  },
  // ε = 0.05 over 4 options: factor 1 − 0.2/3; measured 0.05/3 + a · factor → 0.81 and 0.85667; 686 clean against 1,000.
  noisy_label_rows: {
    values: { p1: "0.85", p2: "0.9", noise: "0.05", options: "4", alpha: "0.05", power: "0.8" },
    expect: [["Measured accuracy of A", 0.81], ["Measured accuracy of B", 0.8566666666666668], ["Difference shrinks to (share)", 0.9333333333333333], ["Rows per variant with clean labels", 686],
      ["Rows per variant with these labels", 1000], ["Times the rows with clean labels", 1000 / 686]],
    invalid: [{ p1: "0.85", p2: "0.9", noise: "0.75", options: "4" }, { p1: "0.85", p2: "0.85", noise: "0.05", options: "4" }],
  },
}, {});

test("tb-experiments: every tool is in the Experiment planning group", () => {
  for (const f of pack.features) assert.equal(f.group, "Experiment planning");
});

test("tb-experiments: an uneven split never needs fewer rows in total than an even one", () => {
  for (const ratio of ["0.25", "0.5", "2", "3"]) {
    const result = runTool(feature("unequal_split_rows"), { p1: "0.7", p2: "0.8", ratio, alpha: "0.05", power: "0.9" });
    assert.ok(result.rows[2][1] >= result.rows[3][1] - 1, `ratio ${ratio}`);
  }
});
