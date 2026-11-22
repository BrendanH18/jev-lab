// Tests of the Toolbox starter pack. Expected values are published reference values (Wilson 5/10, Clopper-Pearson
// 5/10, Newcombe 1998's 56/70 − 48/80 example, and the 385/278 margin table), closed
// forms (0/n and n/n exact bounds, rule-of-three style bounds) or arithmetic worked out by hand.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/workbench-toolbox-starter.js";
import { checkPack } from "./harness.mjs";
import { sampleToolboxCtx } from "./fixtures/workbench-shell.mjs";

const GROUPS = ["Proportions and intervals", "Sample sizes"];
assert.deepEqual(
  [...new Set(pack.features.map((feature) => feature.group))].sort(),
  [...GROUPS].sort(),
  "the starter pack uses the two named groups",
);

checkPack(
  pack,
  {
    wilson_interval: {
      values: { k: "5", n: "10" },
      expect: [
        ["Proportion", 0.5],
        ["Lower bound", 0.236593090512564],
        ["Upper bound", 0.7634069094874361],
        ["Interval width", 0.7634069094874361 - 0.236593090512564],
      ],
      tolerance: 1e-12,
      more: [
        {
          values: { k: 0, n: 20, level: "0.9" },
          expect: [
            ["Proportion", 0],
            ["Lower bound", 0],
            ["Upper bound", 0.11915783736096448],
            ["Interval width", 0.11915783736096448],
          ],
          tolerance: 1e-12,
        },
      ],
      invalid: [
        { k: 11, n: 10 },
        { k: 1, n: 0 },
        { k: "", n: 10 },
        { k: 1.5, n: 10 },
      ],
    },
    clopper_pearson: {
      values: { k: 5, n: 10 },
      expect: [
        ["Proportion", 0.5],
        ["Lower bound", 0.18708602844739858],
        ["Upper bound", 0.8129139715526015],
      ],
      tolerance: 1e-9,
      more: [
        {
          values: { k: 0, n: 10 },
          expect: [
            ["Proportion", 0],
            ["Lower bound", 0],
            ["Upper bound", 1 - 0.025 ** (1 / 10)],
          ],
          tolerance: 1e-9,
        },
        {
          values: { k: 10, n: 10 },
          expect: [
            ["Proportion", 1],
            ["Lower bound", 0.025 ** (1 / 10)],
            ["Upper bound", 1],
          ],
          tolerance: 1e-9,
        },
        {
          values: { k: 3, n: 20, level: "0.99" },
          expect: [
            ["Proportion", 0.15],
            ["Lower bound", 0.017642637954194573],
            ["Upper bound", 0.449465406739486],
          ],
          tolerance: 1e-8,
        },
        // k = 1 of n = 100,000 at 99%: the lower bound has the closed form 1 − (1 − 0.005)^(1/n) = 5.0125e-8; the upper bound
        // is the chi-square (4 df, 0.995) quantile 14.860259 ÷ 2n = 7.42990e-5 (large-n Poisson limit, so a looser check).
        {
          values: { k: 1, n: 100000, level: "0.99" },
          expect: (result) => {
            assert.ok(Math.abs(result.rows[1][1] - (1 - 0.995 ** 1e-5)) < 1e-15);
            assert.ok(Math.abs(result.rows[2][1] - 14.860259 / 2e5) < 1e-8);
          },
        },
      ],
      invalid: [
        { k: 4, n: 3 },
        { k: 1, n: 100001 },
      ],
    },
    zero_errors_bound: {
      values: { n: 100 },
      expect: [
        ["Error rate is at most", 0.029513049607039932],
        ["Accuracy is at least", 0.9704869503929601],
        ["Shortcut: −ln(1 − confidence) ÷ n", 0.029957322735539908],
      ],
      tolerance: 1e-12,
      // 99%, 50 rows: 1 − 0.01^(1/50) and ln(100) ÷ 50 (Python's math module).
      more: [
        {
          values: { n: 50, level: "0.99" },
          expect: [
            ["Error rate is at most", 0.08798916064409024],
            ["Accuracy is at least", 1 - 0.08798916064409024],
            ["Shortcut: −ln(1 − confidence) ÷ n", 0.09210340371976182],
          ],
          tolerance: 1e-12,
        },
      ],
      invalid: [{ n: 0 }],
    },
    newcombe_difference: {
      values: { k1: 56, n1: 70, k2: 48, n2: 80 },
      expect: [
        ["First proportion", 0.8],
        ["Second proportion", 0.6],
        ["Difference (first − second)", 0.2],
        ["Lower bound", 0.0524],
        ["Upper bound", 0.3339],
      ],
      tolerance: 6e-5,
      invalid: [{ k1: 71, n1: 70, k2: 1, n2: 2 }],
    },
    rows_for_margin: {
      values: { margin: 0.05, population: 1000 },
      expect: [
        ["Rows needed", 385],
        ["With the population correction", 278],
      ],
      more: [
        {
          values: { margin: 0.03, p: 0.2, level: "0.9" },
          expect: [
            ["Rows needed", 481],
            ["With the population correction", null],
          ],
        },
        // 2.5758293^2 × 0.25 ÷ 0.01 = 165.87 → 166; with 200 people: 165.87 ÷ (1 + 164.87 ÷ 200) = 90.92 → 91.
        {
          values: { margin: 0.1, level: "0.99", population: 200 },
          expect: [
            ["Rows needed", 166],
            ["With the population correction", 91],
          ],
        },
      ],
      invalid: [{ margin: 0 }, { margin: 0.05, p: 1.5 }],
    },
    margin_for_rows: {
      values: { n: 400, population: 2000 },
      expect: [
        ["Margin of error", 0.04899909961350135],
        ["With the population correction", 0.0438370876709984],
      ],
      tolerance: 1e-12,
      more: [
        {
          values: { n: 400 },
          expect: [
            ["Margin of error", 0.04899909961350135],
            ["With the population correction", null],
          ],
          tolerance: 1e-12,
        },
        // 1.6448536 × √(0.9 × 0.1 ÷ 100) = 0.0493456.
        {
          values: { n: 100, p: 0.9, level: "0.9" },
          expect: [
            ["Margin of error", 0.04934560880854415],
            ["With the population correction", null],
          ],
          tolerance: 1e-12,
        },
      ],
      invalid: [{ n: 400, population: 100 }],
    },
    rows_with_no_errors: {
      values: { rate: 0.01 },
      expect: [
        ["Rows that must all be right", 299],
        ["Shortcut: −ln(1 − confidence) ÷ rate", 300],
      ],
      more: [
        {
          values: { rate: 0.02, level: "0.99" },
          expect: [
            ["Rows that must all be right", 228],
            ["Shortcut: −ln(1 − confidence) ÷ rate", 231],
          ],
        },
      ],
      invalid: [{ rate: 0 }, { rate: 1 }],
    },
  },
  { ctx: () => sampleToolboxCtx() },
);
