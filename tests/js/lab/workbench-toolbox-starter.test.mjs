// Tests of the Toolbox starter pack. Expected values are published reference values (Wilson 5/10, Clopper-Pearson
// 5/10, Newcombe 1998's 56/70 − 48/80 example, the 385/278 margin table, 80% vs 90% at 199 rows per arm), closed
// forms (0/n and n/n exact bounds, rule-of-three style bounds) or arithmetic worked out by hand.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/workbench-toolbox-starter.js";
import { checkPack } from "./harness.mjs";
import { sampleToolboxCtx } from "./fixtures/workbench-shell.mjs";

const GROUPS = ["Proportions and intervals", "Sample sizes", "Costs and budgets", "Time and rate limits", "Probabilities and odds", "Boxes and pictures"];
assert.deepEqual([...new Set(pack.features.map((feature) => feature.group))].sort(), [...GROUPS].sort(), "the starter pack uses exactly the six named groups");

checkPack(pack, {
  wilson_interval: {
    values: { k: "5", n: "10" },
    expect: [["Proportion", 0.5], ["Lower bound", 0.236593090512564], ["Upper bound", 0.7634069094874361], ["Interval width", 0.7634069094874361 - 0.236593090512564]],
    tolerance: 1e-12,
    more: [{ values: { k: 0, n: 20, level: "0.9" }, expect: [["Proportion", 0], ["Lower bound", 0], ["Upper bound", 0.11915783736096448], ["Interval width", 0.11915783736096448]], tolerance: 1e-12 }],
    invalid: [{ k: 11, n: 10 }, { k: 1, n: 0 }, { k: "", n: 10 }, { k: 1.5, n: 10 }],
  },
  clopper_pearson: {
    values: { k: 5, n: 10 },
    expect: [["Proportion", 0.5], ["Lower bound", 0.18708602844739858], ["Upper bound", 0.8129139715526015]],
    tolerance: 1e-9,
    more: [
      { values: { k: 0, n: 10 }, expect: [["Proportion", 0], ["Lower bound", 0], ["Upper bound", 1 - Math.pow(0.025, 1 / 10)]], tolerance: 1e-9 },
      { values: { k: 10, n: 10 }, expect: [["Proportion", 1], ["Lower bound", Math.pow(0.025, 1 / 10)], ["Upper bound", 1]], tolerance: 1e-9 },
      { values: { k: 3, n: 20, level: "0.99" }, expect: [["Proportion", 0.15], ["Lower bound", 0.017642637954194573], ["Upper bound", 0.449465406739486]], tolerance: 1e-8 },
    ],
    invalid: [{ k: 4, n: 3 }, { k: 1, n: 100001 }],
  },
  zero_errors_bound: {
    values: { n: 100 },
    expect: [["Error rate is at most", 0.029513049607039932], ["Accuracy is at least", 0.9704869503929601], ["Shortcut: −ln(1 − confidence) ÷ n", 0.029957322735539908]],
    tolerance: 1e-12,
    invalid: [{ n: 0 }],
  },
  newcombe_difference: {
    values: { k1: 56, n1: 70, k2: 48, n2: 80 },
    expect: [["First proportion", 0.8], ["Second proportion", 0.6], ["Difference (first − second)", 0.2], ["Lower bound", 0.0524], ["Upper bound", 0.3339]],
    tolerance: 6e-5,
    invalid: [{ k1: 71, n1: 70, k2: 1, n2: 2 }],
  },
  gate_coverage: {
    values: { total: 200, automated: 150, correct: 141 },
    expect: [["Coverage", 0.75], ["Coverage lower bound", 0.6856590168795417], ["Coverage upper bound", 0.8049183199318249], ["Accuracy when automated", 0.94],
      ["Accuracy lower bound", 0.8899102291652979], ["Accuracy upper bound", 0.9681159557907947], ["Rows sent to review", 50]],
    tolerance: 1e-12,
    invalid: [{ total: 10, automated: 11, correct: 1 }, { total: 10, automated: 0, correct: 0 }, { total: 10, automated: 5, correct: 6 }],
  },
  rows_for_margin: {
    values: { margin: 0.05, population: 1000 },
    expect: [["Rows needed", 385], ["With the population correction", 278]],
    more: [{ values: { margin: 0.03, p: 0.2, level: "0.9" }, expect: [["Rows needed", 481], ["With the population correction", null]] }],
    invalid: [{ margin: 0 }, { margin: 0.05, p: 1.5 }],
  },
  margin_for_rows: {
    values: { n: 400, population: 2000 },
    expect: [["Margin of error", 0.04899909961350135], ["With the population correction", 0.0438370876709984]],
    tolerance: 1e-12,
    more: [{ values: { n: 400 }, expect: [["Margin of error", 0.04899909961350135], ["With the population correction", null]], tolerance: 1e-12 }],
    invalid: [{ n: 400, population: 100 }],
  },
  rows_with_no_errors: {
    values: { rate: 0.01 },
    expect: [["Rows that must all be right", 299], ["Shortcut: −ln(1 − confidence) ÷ rate", 300]],
    more: [{ values: { rate: 0.02, level: "0.99" }, expect: [["Rows that must all be right", 228], ["Shortcut: −ln(1 − confidence) ÷ rate", 231]] }],
    invalid: [{ rate: 0 }, { rate: 1 }],
  },
  rows_per_variant: {
    values: { p1: 0.8, p2: 0.9 },
    expect: [["Rows per variant", 199], ["Rows in total", 398]],
    more: [{ values: { p1: 0.8, p2: 0.9, alpha: "0.01", power: "0.9" }, expect: [["Rows per variant", 377], ["Rows in total", 754]] }],
    invalid: [{ p1: 0.8, p2: 0.8 }, { p1: 0.8, p2: 0.9, power: "0.95" }],
  },
  run_cost: {
    values: { rows: 1000, tokens: 500 },
    expect: [["Input tokens", 500000], ["Estimated cost (USD)", 0.021], ["Estimated cost per 1,000 rows (USD)", 0.021]],
    more: [{ values: { rows: 250, tokens: 400, calls: 2, price: 0.1 }, expect: [["Input tokens", 200000], ["Estimated cost (USD)", 0.02], ["Estimated cost per 1,000 rows (USD)", 0.08]] }],
    invalid: [{ rows: 0, tokens: 500 }, { rows: 10 }],
  },
  rows_for_budget: {
    values: { tokens: 500 },
    expect: [["Estimated cost per row (USD)", 0.000021], ["Rows the budget allows", 95238]],
    more: [{ values: { budget: 1, tokens: 1000, calls: 2, price: 0.5 }, expect: [["Estimated cost per row (USD)", 0.001], ["Rows the budget allows", 1000]] }],
    invalid: [{ tokens: 0 }, { budget: -1, tokens: 5 }],
  },
  cost_with_review: {
    values: { review: 0.2, errorRate: 0.03, modelCost: 0.00002 },
    expect: [["Review cost per row", 0.4], ["Mistake cost per row", 0.48], ["Expected cost per row", 0.88002], ["Expected cost per 1,000 rows", 880.02]],
    invalid: [{ review: 1.2, errorRate: 0 }],
  },
  break_even_confidence: {
    values: {},
    expect: [["Automate when the probability of being right is at least", 0.9], ["Mistakes accepted per 100 rows at that probability", 10]],
    more: [{ values: { reviewCost: 25, errorCost: 20 }, expect: (result) => {
      assert.deepEqual(result.rows, [["Automate when the probability of being right is at least", 0], ["Mistakes accepted per 100 rows at that probability", 100]]);
      assert.match(result.note, /automating every row/);
    } }],
    invalid: [{ errorCost: 0 }],
  },
  monthly_projection: {
    values: { perDay: 2000, tokens: 400 },
    expect: [["Rows per month", 60000], ["Input tokens per month", 24000000], ["Projected cost per month (USD)", 1.008]],
    invalid: [{ perDay: 10, tokens: 1, days: 32 }],
  },
  time_for_rows: {
    values: { rows: 1000 },
    expect: [["Live calls", 1000], ["Minutes at the cap", 25 / 3], ["Duration", "8 min 20 s"]],
    more: [{ values: { rows: 60, calls: 3, cap: 60 }, expect: [["Live calls", 180], ["Minutes at the cap", 3], ["Duration", "3 min"]] }],
    invalid: [{ rows: 10, cap: 0 }],
  },
  rows_in_time: {
    values: { minutes: 15, calls: 4 },
    expect: [["Live calls allowed", 1800], ["Rows", 450]],
    more: [{ values: { minutes: 0.5, calls: 7 }, expect: [["Live calls allowed", 60], ["Rows", 8]] }],
    invalid: [{ minutes: -1 }],
  },
  parallel_duration: {
    values: { rows: 200 },
    expect: [["Limited by", "the rate limit"], ["Calls per second", 2], ["Duration (seconds)", 100], ["Duration", "1 min 40 s"]],
    more: [{ values: { rows: 200, parallel: 1, latency: 1000 }, expect: [["Limited by", "latency and parallel calls"], ["Calls per second", 1], ["Duration (seconds)", 200], ["Duration", "3 min 20 s"]] }],
    invalid: [{ rows: 10, latency: 0 }],
  },
  convert_duration: {
    values: { value: 90 },
    expect: [["Milliseconds", 5400000], ["Seconds", 5400], ["Minutes", 90], ["Hours", 1.5], ["Readable", "1 h 30 min"]],
    more: [{ values: { value: 250, unit: "ms" }, expect: [["Milliseconds", 250], ["Seconds", 0.25], ["Minutes", 0.25 / 60], ["Hours", 0.25 / 3600], ["Readable", "250 ms"]] }],
    invalid: [{ value: 5, unit: "days" }],
  },
  probability_to_odds: {
    values: { p: 0.8 },
    expect: [["Odds", 4], ["Odds as a ratio", "4 : 1"], ["Log-odds", 1.3862943611198906], ["One in", 1.25]],
    more: [{ values: { p: 0.2 }, expect: [["Odds", 0.25], ["Odds as a ratio", "1 : 4"], ["Log-odds", -1.3862943611198906], ["One in", 5]] }],
    invalid: [{ p: 0 }, { p: 1 }],
  },
  odds_to_probability: {
    values: { a: 3, b: 1 },
    expect: [["Probability", 0.75], ["Odds (A ÷ B)", 3]],
    more: [{ values: { a: 2, b: 0 }, expect: [["Probability", 1], ["Odds (A ÷ B)", null]] }],
    invalid: [{ a: 0, b: 0 }],
  },
  logodds_to_probability: {
    values: { x: 0 },
    expect: [["Probability", 0.5], ["Odds", 1]],
    more: [{ values: { x: Math.log(9) }, expect: [["Probability", 0.9], ["Odds", 9]], tolerance: 1e-12 }],
    invalid: [{ x: 701 }],
  },
  at_least_one: {
    values: { p: 0.1, k: 3 },
    expect: [["At least one", 0.271], ["All of them", 0.001], ["None of them", 0.729]],
    tolerance: 1e-12,
    invalid: [{ p: 0.1, k: 0 }],
  },
  box_iou: {
    values: { a_left: 0, a_top: 0, a_right: 0.5, a_bottom: 0.5, b_left: 0.25, b_top: 0.25, b_right: 0.75, b_bottom: 0.75 },
    expect: [["Intersection area", 0.0625], ["Union area", 0.4375], ["IoU", 1 / 7]],
    more: [{ values: { a_left: 0, a_top: 0, a_right: 0.5, a_bottom: 0.5, b_left: 0.5, b_top: 0.5, b_right: 1, b_bottom: 1 },
      expect: [["Intersection area", 0], ["Union area", 0.5], ["IoU", 0]] }],
    invalid: [{ a_left: 0.5, a_top: 0, a_right: 0.4, a_bottom: 1, b_left: 0, b_top: 0, b_right: 1, b_bottom: 1 }],
  },
  resize_picture: {
    values: { width: 4032, height: 3024 },
    expect: [["New width", 1568], ["New height", 1176], ["Scale", 1568 / 4032], ["Fits the limits", "yes"]],
    more: [
      { values: { width: 200, height: 150 }, expect: [["New width", 373], ["New height", 280], ["Scale", 280 / 150], ["Fits the limits", "yes"]] },
      { values: { width: 3024, height: 4032 }, expect: [["New width", 1176], ["New height", 1568], ["Scale", 1568 / 4032], ["Fits the limits", "yes"]] },
      { values: { width: 1000, height: 800 }, expect: [["New width", 1000], ["New height", 800], ["Scale", 1], ["Fits the limits", "yes"]] },
      { values: { width: 6000, height: 800 }, expect: (result) => {
        assert.deepEqual(result.rows.map(([label]) => label), ["New width", "New height", "Scale", "Fits the limits"]);
        assert.equal(result.rows[1][1], 209);
        assert.equal(result.rows[3][1], "no");
        assert.match(result.note, /crop to at most 5\.6 : 1/);
      } },
    ],
    invalid: [{ width: 0, height: 10 }, { width: 10, height: 10, minSide: 2000 }],
  },
  box_to_pixels: {
    values: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6, width: 1000, height: 800 },
    expect: [["Left (px)", 100], ["Top (px)", 160], ["Right (px)", 500], ["Bottom (px)", 480], ["Width (px)", 400], ["Height (px)", 320], ["Share of the picture", 0.16]],
    invalid: [{ left: 0.5, top: 0.2, right: 0.5, bottom: 0.6, width: 10, height: 10 }],
  },
}, { ctx: () => sampleToolboxCtx() });
