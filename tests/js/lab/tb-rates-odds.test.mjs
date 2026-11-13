// Tests for the tb-rates-odds pack. Every expected value is worked out by hand from the inputs (shown in the comments).
// Queue values use the textbook M/M/1 formulas (ρ = λ/μ, Wq = ρ/(μ − λ)) and, for M/M/c, Erlang C written out from
// its sum form C = (aᶜ/c! · c/(c − a)) / (Σₖ<c aᵏ/k! + aᶜ/c! · c/(c − a)), not the recursion the pack uses.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-rates-odds.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const near = (actual, expected) => approx(actual, expected, 1e-9);
const rowsLike = (result, expected) => {
  assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
  expected.forEach(([, value], i) => near(result.rows[i][1], value));
};
const tableLike = (result, columns, expected) => {
  assert.deepEqual(result.table.columns, columns);
  assert.equal(result.table.rows.length, expected.length);
  expected.forEach((row, i) => row.forEach((cell, j) => near(result.table.rows[i][j], cell)));
};
const E2 = Math.exp(-2);
const LATENCIES = Array.from({ length: 20 }, (_, i) => String((i + 1) * 100)).reverse().join("\n");  // 2000 … 100, unsorted on purpose

checkPack(pack, {
  // 100 a minute × 3 s = 5 in flight; 200 needs 10 > 8 and passes the cap of 120; 30 × 0.6 s = 0.3 → 1.
  // The cap binds from cap × latency: 120 × 3 s / 60 s = 6 in flight, 20 × 0.6 s / 60 s = 0.2. 8 in flight at 3 s give 160 a minute.
  concurrency_needed: {
    values: { target: 100, latency: 3000 },
    expect: [["Calls in flight needed", 5], ["Reachable with the calls in flight available", "yes"], ["Within the rate cap", "yes"], ["Highest calls per minute possible", 120],
      ["Calls in flight where the cap starts to bind", 6]],
    more: [{ values: { target: 200, latency: 3000 }, expect: [["Calls in flight needed", 10], ["Reachable with the calls in flight available", "no"], ["Within the rate cap", "no"],
      ["Highest calls per minute possible", 120], ["Calls in flight where the cap starts to bind", 6]] },
    { values: { target: 30, latency: 600, available: 1, cap: 20 }, expect: [["Calls in flight needed", 1], ["Reachable with the calls in flight available", "yes"], ["Within the rate cap", "no"],
      ["Highest calls per minute possible", 20], ["Calls in flight where the cap starts to bind", 0.2]] },
    { values: { target: 150, latency: 3000, cap: 200 }, expect: [["Calls in flight needed", 8], ["Reachable with the calls in flight available", "yes"], ["Within the rate cap", "yes"],
      ["Highest calls per minute possible", 160], ["Calls in flight where the cap starts to bind", 10]] }],
    invalid: [{ target: 0, latency: 600 }, { target: 10, latency: 600, cap: 0 }],
  },
  // M/M/1, λ 8, μ 10: ρ 0.8, Wq 0.8/2 h = 24 min, W 30 min, Lq 3.2, L 4.
  // M/M/2, λ 15, μ 10: a 1.5, C = 4.5 / (2.5 + 4.5) = 9/14, Wq = (9/14)/5 h = 9/70 h, W = 16/70 h, Lq = 27/14, L = 24/7.
  review_queue: {
    values: { arrivals: 8, service: 10 },
    expect: [["Utilization per reviewer", 0.8], ["Chance a row waits", 0.8], ["Average wait before review (minutes)", 24], ["Average time until reviewed (minutes)", 30],
      ["Average rows waiting", 3.2], ["Average rows in review or waiting", 4]],
    more: [{ values: { arrivals: 15, service: 10, reviewers: 2 },
      expect: [["Utilization per reviewer", 0.75], ["Chance a row waits", 9 / 14], ["Average wait before review (minutes)", 540 / 70], ["Average time until reviewed (minutes)", 960 / 70],
        ["Average rows waiting", 27 / 14], ["Average rows in review or waiting", 24 / 7]] },
    { values: { arrivals: 10, service: 10 },
      expect: [["Utilization per reviewer", 1], ["Chance a row waits", null], ["Average wait before review (minutes)", null], ["Average time until reviewed (minutes)", null],
        ["Average rows waiting", null], ["Average rows in review or waiting", null]] }],
    invalid: [{ arrivals: 0, service: 10 }, { arrivals: 1, service: 10, reviewers: 0 }],
  },
  // λ 15, μ 10: two reviewers wait 540/70 ≈ 7.71 min; three: C = 1.125 / (3.625 + 1.125) = 9/38, Wq = (9/38)/15 h = 540/570 min.
  reviewers_for_wait: {
    values: { arrivals: 15, service: 10, target: 5 },
    expect: [["Reviewers needed", 3], ["Average wait with them (minutes)", 540 / 570], ["Utilization per reviewer", 0.5], ["Chance a row waits", 9 / 38]],
    more: [{ values: { arrivals: 15, service: 10, target: 10 }, expect: [["Reviewers needed", 2], ["Average wait with them (minutes)", 540 / 70], ["Utilization per reviewer", 0.75], ["Chance a row waits", 9 / 14]] }],
    invalid: [{ arrivals: 15, service: 10, target: 0 }],
  },
  // ln 0.001 / ln 0.1 = 3; ln 0.01 / ln 0.2 ≈ 2.86 → 3 (1 − 0.2³ = 0.992); ln 0.6 / ln 0.5 ≈ 0.74 → 1.
  attempts_for_target: {
    values: { failure: 0.1, target: 0.999 },
    expect: [["Attempts needed", 3], ["Retries after the first", 2], ["Chance of success within them", 0.999], ["Average attempts until success, with no limit", 1 / 0.9]],
    more: [{ values: { failure: 0.2, target: 0.99 }, expect: [["Attempts needed", 3], ["Retries after the first", 2], ["Chance of success within them", 0.992], ["Average attempts until success, with no limit", 1.25]] },
      { values: { failure: 0.5, target: 0.4 }, expect: [["Attempts needed", 1], ["Retries after the first", 0], ["Chance of success within them", 0.5], ["Average attempts until success, with no limit", 2]] }],
    invalid: [{ failure: 0, target: 0.9 }, { failure: 0.1, target: 1 }],
  },
  // 1000 × (1 + 0.1 + 0.01) = 1110 calls; 1000 × 0.1³ = 1 row still failing.
  calls_with_retries: {
    values: { rows: 1000, failure: 0.1, attempts: 3 },
    expect: [["Expected calls", 1110], ["Expected retries", 110], ["Expected rows still failing", 1], ["Extra calls as a share of rows", 0.11]],
    more: [{ values: { rows: 10, failure: 0.5, attempts: 1 }, expect: [["Expected calls", 10], ["Expected retries", 0], ["Expected rows still failing", 5], ["Extra calls as a share of rows", 0]] }],
    invalid: [{ rows: 10, failure: 1 }],
  },
  // 500, 1000, 2000, then 4000 capped at 3000: 6500 ms in total (shown as 7 s); 100, 150, 225 → 475 ms.
  backoff_schedule: {
    values: { base: 500, factor: 2, retries: 4, cap: 3000 },
    expect: (result) => {
      rowsLike(result, [["Total wait (ms)", 6500], ["Longest single wait (ms)", 3000], ["Total wait", "7 s"]]);
      tableLike(result, ["Retry", "Wait before it (ms)", "Waited in total (ms)"], [[1, 500, 500], [2, 1000, 1500], [3, 2000, 3500], [4, 3000, 6500]]);
    },
    more: [{ values: { base: 100, factor: 1.5, retries: 3 }, expect: (result) => {
      rowsLike(result, [["Total wait (ms)", 475], ["Longest single wait (ms)", 225], ["Total wait", "475 ms"]]);
      tableLike(result, ["Retry", "Wait before it (ms)", "Waited in total (ms)"], [[1, 100, 100], [2, 150, 250], [3, 225, 475]]);
    } }],
    invalid: [{ base: 500, factor: 0.5, retries: 3 }, { base: 500, factor: 2, retries: 0 }],
  },
  // L = λW: 2 × 0.6 = 1.2; 8 / 0.6 = 13.33; 8 / 4 = 2.
  littles_law: {
    values: { rate: 2, time: 0.6 },
    expect: [["Items in the system on average", 1.2], ["Arrivals per second", 2], ["Time in the system (seconds)", 0.6]],
    more: [{ values: { inSystem: 8, time: 0.6 }, expect: [["Items in the system on average", 8], ["Arrivals per second", 8 / 0.6], ["Time in the system (seconds)", 0.6]] },
      { values: { inSystem: 8, rate: 4 }, expect: [["Items in the system on average", 8], ["Arrivals per second", 4], ["Time in the system (seconds)", 2]] }],
    invalid: [{ inSystem: 1, rate: 1, time: 1 }, { rate: 1 }, {}, { inSystem: 8, rate: 0 }, { inSystem: 8, time: 0 }],
  },
  // 100 … 2000 ms: mean 1050; nearest rank ⌈q·20⌉: 10th = 1000, 18th = 1800, 19th = 1900, 20th = 2000; 5 of 20 above 1500.
  latency_percentiles: {
    values: { values: LATENCIES, timeout: 1500 },
    expect: [["Calls", 20], ["Mean (ms)", 1050], ["50th percentile (ms)", 1000], ["90th percentile (ms)", 1800], ["95th percentile (ms)", 1900], ["99th percentile (ms)", 2000],
      ["Slowest (ms)", 2000], ["Share slower than the timeout", 0.25]],
    more: [{ values: { values: "250" }, expect: [["Calls", 1], ["Mean (ms)", 250], ["50th percentile (ms)", 250], ["90th percentile (ms)", 250], ["95th percentile (ms)", 250],
      ["99th percentile (ms)", 250], ["Slowest (ms)", 250], ["Share slower than the timeout", null]] }],
    invalid: [{ values: "100 -5" }, { values: "abc" }, { values: "" }],
  },
  // 300 / (50 − 20) = 10 h; 75 / 30 = 2.5 h.
  backlog_clearance: {
    values: { backlog: 300, arrivals: 20, capacity: 50 },
    expect: [["Net rows cleared per hour", 30], ["Hours to clear", 10], ["Duration", "10 h"]],
    more: [{ values: { backlog: 75, arrivals: 20, capacity: 50 }, expect: [["Net rows cleared per hour", 30], ["Hours to clear", 2.5], ["Duration", "2 h 30 min"]] },
      { values: { backlog: 300, arrivals: 50, capacity: 50 }, expect: [["Net rows cleared per hour", 0], ["Hours to clear", null], ["Duration", null]] },
      { values: { backlog: 0, arrivals: 60, capacity: 50 }, expect: [["Net rows cleared per hour", -10], ["Hours to clear", 0], ["Duration", "0 s"]] }],
  },
  // Poisson(2): P(N ≤ 3) = (1 + 2 + 2 + 4/3)e⁻² = 19/3 e⁻²; E[(N − 3)+] = λ − 3 + Σₖ≤3 (3 − k)pₖ = −1 + (3 + 4 + 2)e⁻² = 9e⁻² − 1.
  // Cap 1: P(N ≤ 1) = 3e⁻²; E[(N − 1)+] = λ − 1 + p₀ = 1 + e⁻².
  cap_overflow: {
    values: { mean: 2, cap: 3 },
    expect: [["Chance a minute stays within the cap", 19 / 3 * E2], ["Chance a minute goes over the cap", 1 - 19 / 3 * E2], ["Average calls over the cap per minute", 9 * E2 - 1],
      ["Share of calls over the cap", (9 * E2 - 1) / 2]],
    more: [{ values: { mean: 0, cap: 3 }, expect: [["Chance a minute stays within the cap", 1], ["Chance a minute goes over the cap", 0], ["Average calls over the cap per minute", 0], ["Share of calls over the cap", null]] },
      { values: { mean: 2, cap: 1 }, expect: [["Chance a minute stays within the cap", 3 * E2], ["Chance a minute goes over the cap", 1 - 3 * E2], ["Average calls over the cap per minute", 1 + E2],
        ["Share of calls over the cap", (1 + E2) / 2]] },
      // A mean of a million against a cap of 120: P(N ≤ 120) is below 1e-400000, so all but 120 calls go over.
      { values: { mean: 1e6, cap: 120 }, expect: [["Chance a minute stays within the cap", 0], ["Chance a minute goes over the cap", 1], ["Average calls over the cap per minute", 999880],
        ["Share of calls over the cap", 0.99988]] }],
    invalid: [{ mean: -1, cap: 3 }, { mean: 2, cap: 0 }],
  },
  rate_converter: {
    values: { value: 120 },
    expect: [["Per second", 2], ["Per minute", 120], ["Per hour", 7200], ["Per day", 172800], ["Seconds between events", 0.5]],
    more: [{ values: { value: 36, unit: "h" }, expect: [["Per second", 0.01], ["Per minute", 0.6], ["Per hour", 36], ["Per day", 864], ["Seconds between events", 100]] },
      { values: { value: 0, unit: "day" }, expect: [["Per second", 0], ["Per minute", 0], ["Per hour", 0], ["Per day", 0], ["Seconds between events", null]] }],
    invalid: [{ value: 1, unit: "week" }],
  },
  // 400 + 600 + 500 = 1500 one after another, 600 all at once, against 700 merged.
  merged_latency: {
    values: { values: "400, 600\n500", merged: 700 },
    expect: [["Separate calls one after another (ms)", 1500], ["Separate calls all at once (ms)", 600], ["Merged call (ms)", 700],
      ["Saved by merging against one after another (ms)", 800], ["Saved by merging against all at once (ms)", -100]],
    invalid: [{ values: "", merged: 1 }, { values: "400", merged: -1 }],
  },
  // Prior 0.2 → odds 0.25 × 6 = 1.5 → 0.6; odds 1 × 0.25 → 0.2, log₂ 0.25 = −2.
  bayes_lr: {
    values: { prior: 0.2, ratio: 6 },
    expect: [["Prior odds", 0.25], ["Posterior odds", 1.5], ["Posterior probability", 0.6], ["Change in log-odds", Math.log(6)], ["Evidence in bits", Math.log2(6)]],
    more: [{ values: { prior: 0.5, ratio: 0.25 }, expect: [["Prior odds", 1], ["Posterior odds", 0.25], ["Posterior probability", 0.2], ["Change in log-odds", Math.log(0.25)], ["Evidence in bits", -2]] }],
    invalid: [{ prior: 0, ratio: 2 }, { prior: 0.5, ratio: 0 }],
  },
  // Odds 1/9 → 9 is a ratio of 81 = 3⁴; odds 1 → 0.25 is 0.25 = 0.5².
  lr_needed: {
    values: { prior: 0.1, target: 0.9, each: 3 },
    expect: [["Likelihood ratio needed", 81], ["Evidence in bits", Math.log2(81)], ["Signals of that strength needed", 4]],
    more: [{ values: { prior: 0.5, target: 0.2, each: 0.5 }, expect: [["Likelihood ratio needed", 0.25], ["Evidence in bits", -2], ["Signals of that strength needed", 2]] },
      { values: { prior: 0.5, target: 0.2, each: 3 }, expect: [["Likelihood ratio needed", 0.25], ["Evidence in bits", -2], ["Signals of that strength needed", null]] },
      { values: { prior: 0.3, target: 0.3, each: 2 }, expect: [["Likelihood ratio needed", 1], ["Evidence in bits", 0], ["Signals of that strength needed", 0]] },
      { values: { prior: 0.1, target: 0.9 }, expect: [["Likelihood ratio needed", 81], ["Evidence in bits", Math.log2(81)], ["Signals of that strength needed", null]] }],
    invalid: [{ prior: 0.1, target: 1 }],
  },
  // 0.9 × 0.1 + 0.05 × 0.9 = 0.135 flagged; 0.09 / 0.135 = 2/3; 0.855 / 0.865; LR+ 0.9 / 0.05 = 18; LR− 0.1 / 0.95.
  test_posterior: {
    values: { sensitivity: 0.9, specificity: 0.95, base: 0.1 },
    expect: [["Share of rows flagged", 0.135], ["Chance a flagged row is a true case", 2 / 3], ["Chance a cleared row is not a true case", 0.855 / 0.865],
      ["Positive likelihood ratio", 18], ["Negative likelihood ratio", 0.1 / 0.95]],
    more: [{ values: { sensitivity: 1, specificity: 1, base: 0.2 }, expect: [["Share of rows flagged", 0.2], ["Chance a flagged row is a true case", 1],
      ["Chance a cleared row is not a true case", 1], ["Positive likelihood ratio", null], ["Negative likelihood ratio", 0]] }],
  },
  // Odds factor (0.05/0.95) / (0.2/0.8) = 4/19; 0.8 → odds 4 × 4/19 = 16/19 → 16/35.
  prior_shift: {
    values: { p: 0.8, from: 0.2, to: 0.05 },
    expect: [["Odds multiplier", 4 / 19], ["Probability at the new base rate", 16 / 35]],
    more: [{ values: { p: 0.5, from: 0.5, to: 0.1 }, expect: [["Odds multiplier", 1 / 9], ["Probability at the new base rate", 0.1]] },
      { values: { p: 1, from: 0.5, to: 0.1 }, expect: [["Odds multiplier", 1 / 9], ["Probability at the new base rate", 1]] }],
    invalid: [{ p: 0.5, from: 0, to: 0.1 }],
  },
  // 0.9, 0.8, 0.5: P0 = 0.1·0.2·0.5 = 0.01; P1 = 0.09 + 0.04 + 0.01 = 0.14; P3 = 0.36; P2 = 0.36 + 0.09 + 0.04 = 0.49.
  k_of_n: {
    values: { probs: "0.9 0.8 0.5", k: 2 },
    expect: (result) => {
      rowsLike(result, [["Gates", 3], ["Expected number passing", 2.2], ["Chance at least 2 pass", 0.85], ["Chance exactly 2 pass", 0.49], ["Chance all pass", 0.36]]);
      tableLike(result, ["Passing", "Chance exactly", "Chance at least"], [[0, 0.01, 1], [1, 0.14, 0.99], [2, 0.49, 0.85], [3, 0.36, 0.36]]);
    },
    more: [{ values: { probs: "0.9 0.8 0.5", k: 0 }, expect: (result) => rowsLike(result, [["Gates", 3], ["Expected number passing", 2.2], ["Chance at least 0 pass", 1], ["Chance exactly 0 pass", 0.01], ["Chance all pass", 0.36]]) }],
    invalid: [{ probs: "0.9 0.8 0.5", k: 4 }],
  },
  // Base 0.5: ln 4 + ln 3 = ln 12 → 12/13. Base 0.2 (odds 1/4): ln 16 and ln 12 above it, total ln(1/4 · 16 · 12) = ln 48 → 48/49.
  combine_logodds: {
    values: { base: 0.5, probs: "0.8 0.75" },
    expect: (result) => {
      rowsLike(result, [["Base-rate log-odds", 0], ["Combined log-odds", Math.log(12)], ["Combined probability", 12 / 13]]);
      tableLike(result, ["Source", "Probability", "Evidence (log-odds over the base rate)"], [[1, 0.8, Math.log(4)], [2, 0.75, Math.log(3)]]);
    },
    more: [{ values: { base: 0.2, probs: "0.8 0.75" }, expect: (result) => {
      rowsLike(result, [["Base-rate log-odds", Math.log(0.25)], ["Combined log-odds", Math.log(48)], ["Combined probability", 48 / 49]]);
      tableLike(result, ["Source", "Probability", "Evidence (log-odds over the base rate)"], [[1, 0.8, Math.log(16)], [2, 0.75, Math.log(12)]]);
    } }],
    invalid: [{ base: 0.5, probs: "0.8 1" }, { base: 0, probs: "0.8" }],
  },
  // automate: 0.92 × 10 + 0.08 × (−60) = 9.2 − 4.8 = 4.4; review: 4.
  expected_value: {
    values: { outcomes: "automate, 0.92, 10\nautomate, 0.08, -60\n# a person reviews\nreview, 1, 4" },
    expect: (result) => {
      rowsLike(result, [["Best action", "automate"], ["Its expected payoff", 4.4], ["Margin over the next best", 0.4]]);
      tableLike(result, ["Action", "Total probability", "Expected payoff"], [["automate", 1, 4.4], ["review", 1, 4]]);
    },
    more: [{ values: { outcomes: "only, 1, -3" }, expect: (result) => rowsLike(result, [["Best action", "only"], ["Its expected payoff", -3], ["Margin over the next best", null]]) }],
    invalid: [{ outcomes: "a, 0.5, 1" }, { outcomes: "a, 1.5, 1" }, { outcomes: "a, x, 1" }, { outcomes: "a, 1" }, { outcomes: "" }],
  },
  probability_formats: {
    values: { value: "12.5%" },
    expect: [["Probability", 0.125], ["Percent", 12.5], ["Fraction", "1/8"], ["Odds for : against", "1 : 7"], ["One in", 8]],
    more: [{ values: { value: "3:1" }, expect: [["Probability", 0.75], ["Percent", 75], ["Fraction", "3/4"], ["Odds for : against", "3 : 1"], ["One in", 4 / 3]] },
      { values: { value: "1 to 3" }, expect: [["Probability", 0.25], ["Percent", 25], ["Fraction", "1/4"], ["Odds for : against", "1 : 3"], ["One in", 4]] },
      { values: { value: "1 in 8" }, expect: [["Probability", 0.125], ["Percent", 12.5], ["Fraction", "1/8"], ["Odds for : against", "1 : 7"], ["One in", 8]] },
      { values: { value: "0.2" }, expect: [["Probability", 0.2], ["Percent", 20], ["Fraction", "1/5"], ["Odds for : against", "1 : 4"], ["One in", 5]] },
      { values: { value: "2/4" }, expect: [["Probability", 0.5], ["Percent", 50], ["Fraction", "1/2"], ["Odds for : against", "1 : 1"], ["One in", 2]] },
      { values: { value: "1.5:1" }, expect: [["Probability", 0.6], ["Percent", 60], ["Fraction", "3/5"], ["Odds for : against", "3 : 2"], ["One in", 5 / 3]] },
      { values: { value: "0" }, expect: [["Probability", 0], ["Percent", 0], ["Fraction", "0"], ["Odds for : against", "0 : 1"], ["One in", null]] },
      { values: { value: "100%" }, expect: [["Probability", 1], ["Percent", 100], ["Fraction", "1"], ["Odds for : against", "1 : 0"], ["One in", 1]] }],
    invalid: [{ value: "abc" }, { value: "5/4" }, { value: "0:0" }, { value: "-1" }, { value: "150%" }, { value: "1 in 0" }, { value: "2 in 1" }, { value: "" }],
  },
  // Products 0.5·0.2 = 0.1, 0.3·0.6 = 0.18, 0.2·0.1 = 0.02, total 0.3: posteriors 1/3, 0.6, 1/15.
  posterior_categories: {
    values: { outcomes: "refund, 0.5, 0.2\nshipping, 0.3, 0.6\nother, 0.2, 0.1" },
    expect: (result) => {
      rowsLike(result, [["Most likely after the update", "shipping"], ["Its probability", 0.6], ["Chance of the evidence", 0.3]]);
      tableLike(result, ["Outcome", "Prior", "Likelihood", "Posterior"], [["refund", 0.5, 0.2, 1 / 3], ["shipping", 0.3, 0.6, 0.6], ["other", 0.2, 0.1, 1 / 15]]);
    },
    more: [{ values: { outcomes: "a, 2, 0.5\nb, 2, 0.5" }, expect: (result) => {
      rowsLike(result, [["Most likely after the update", "a"], ["Its probability", 0.5], ["Chance of the evidence", 0.5]]);
      tableLike(result, ["Outcome", "Prior", "Likelihood", "Posterior"], [["a", 0.5, 0.5, 0.5], ["b", 0.5, 0.5, 0.5]]);
    } }],
    invalid: [{ outcomes: "a, 1, 1\na, 1, 1" }, { outcomes: "a, 1, 0" }, { outcomes: "a, -1, 1" }, { outcomes: ", 1, 1" }],
  },
}, { ctx: () => fakeCtx({}) });
