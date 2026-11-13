// Tests for the tb-costs pack. Every expected value is worked out by hand from the inputs (shown in the comments);
// prices are per million input tokens, so cost = tokens × price ÷ 1,000,000.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-costs.js";
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

checkPack(pack, {
  // A: 100 × 500 × 0.05 / 1e6 = 0.0025; B: 100 × 800 × 0.05 / 1e6 = 0.004. With 20 of 120 rows held out and B averaging
  // both option orders at 0.1: 100 rows, 100 + 200 calls, B = 200 × 800 × 0.1 / 1e6 = 0.016.
  compare_cost: {
    values: { rows: 100, tokensA: 500, tokensB: 800, priceA: 0.05 },
    expect: [["Rows compared", 100], ["Calls", 200], ["Variant A cost (USD)", 0.0025], ["Variant B cost (USD)", 0.004], ["Total cost (USD)", 0.0065], ["Extra cost of B over A (USD)", 0.0015]],
    more: [{ values: { rows: 120, heldOut: 20, tokensA: 500, tokensB: 800, priceA: 0.05, priceB: 0.1, averageB: true },
      expect: [["Rows compared", 100], ["Calls", 300], ["Variant A cost (USD)", 0.0025], ["Variant B cost (USD)", 0.016], ["Total cost (USD)", 0.0185], ["Extra cost of B over A (USD)", 0.0135]] },
    { values: { rows: 100, tokensA: 500, tokensB: 500, priceA: 0.05, averageA: true },
      expect: [["Rows compared", 100], ["Calls", 300], ["Variant A cost (USD)", 0.005], ["Variant B cost (USD)", 0.0025], ["Total cost (USD)", 0.0075], ["Extra cost of B over A (USD)", -0.0025]] }],
    invalid: [{ rows: 0, tokensA: 1, tokensB: 1, priceA: 1 }, { rows: 1, tokensB: 1, priceA: 1 }, { rows: 10, heldOut: 10, tokensA: 1, tokensB: 1, priceA: 1 }],
  },
  // 120 − 20 = 100 calls × 400 × 0.05 / 1e6 = 0.002 per rerun; 0.05 / 0.002 = 25, 0.0499 / 0.002 = 24.95 → 24.
  check_rerun_cost: {
    values: { rows: 120, heldOut: 20, tokens: 400, price: 0.05, budget: 0.05 },
    expect: [["Calls per rerun", 100], ["Cost per rerun (USD)", 0.002], ["Reruns the budget covers", 25]],
    more: [{ values: { rows: 120, heldOut: 20, tokens: 400, price: 0.05, budget: 0.0499 }, expect: [["Calls per rerun", 100], ["Cost per rerun (USD)", 0.002], ["Reruns the budget covers", 24]] },
      { values: { rows: 10, tokens: 400, price: 0.05 }, expect: [["Calls per rerun", 10], ["Cost per rerun (USD)", 0.0002], ["Reruns the budget covers", null]] }],
    invalid: [{ rows: 120, heldOut: 120, tokens: 400, price: 0.05 }, { heldOut: 0, tokens: 400, price: 0.05 }],
  },
  // A per call 300 × 0.05e-6 = 1.5e-5 → 0.015 for 1000 rows; B per call 900 × 0.05e-6 = 4.5e-5, escalated 250 rows → 0.01125;
  // B every row 0.045. At a B price of 0.1: 9e-5 per call, 250 → 0.0225, every row 0.09.
  cascade_cost: {
    values: { rows: 1000, tokensA: 300, tokensB: 900, priceA: 0.05, escalated: 0.25 },
    expect: [["Expected calls", 1250], ["Variant A cost (USD)", 0.015], ["Escalation cost (USD)", 0.01125], ["Cascade cost (USD)", 0.02625],
      ["Cost of asking B every row (USD)", 0.045], ["Saving against B every row (USD)", 0.01875]],
    more: [{ values: { rows: 1000, tokensA: 300, tokensB: 900, priceA: 0.05, priceB: 0.1, escalated: 0.25 },
      expect: [["Expected calls", 1250], ["Variant A cost (USD)", 0.015], ["Escalation cost (USD)", 0.0225], ["Cascade cost (USD)", 0.0375],
        ["Cost of asking B every row (USD)", 0.09], ["Saving against B every row (USD)", 0.0525]] }],
    invalid: [{ rows: 10, tokensA: 1, tokensB: 1, priceA: 1, escalated: 1.5 }],
  },
  // 2000 / 4 = 500 per call, × 50 = 25,000 tokens, × 0.05 / 1e6 = 0.00125; 1001 / 4 = 250.25 → 251.
  tokens_from_chars: {
    values: { chars: 2000, perToken: 4, calls: 50, price: 0.05 },
    expect: [["Tokens per call", 500], ["Tokens for all calls", 25000], ["Estimated cost (USD)", 0.00125]],
    more: [{ values: { chars: 1001 }, expect: [["Tokens per call", 251], ["Tokens for all calls", 251], ["Estimated cost (USD)", null]] }],
    invalid: [{ chars: 100, perToken: 0 }],
  },
  // jev/client.py: max(64, (chars + 1) // 2) + uses × allowance. 1001 → 501; 50 → 25 → 64, + 16,000 = 16,064.
  reserve_bound: {
    values: { chars: 1001, calls: 10, price: 0.05 },
    expect: [["Tokens held per call", 501], ["Upper bound per call (USD)", 0.00002505], ["Upper bound for all calls (USD)", 0.0002505]],
    more: [{ values: { chars: 50, pictures: 1, calls: 100, price: 0.05 },
      expect: [["Tokens held per call", 16064], ["Upper bound per call (USD)", 0.0008032], ["Upper bound for all calls (USD)", 0.08032]] }],
    invalid: [{ chars: 10, calls: 1 }],
  },
  // Separately 100 × 3 × (300 + 20 + 50) = 111,000; merged 100 × (300 + 20 + 3 × 50) = 47,000.
  merge_vs_separate: {
    values: { rows: 100, questions: 3, state: 300, question: 50, overhead: 20, price: 0.05 },
    expect: [["Calls separately", 300], ["Calls merged", 100], ["Input tokens separately", 111000], ["Input tokens merged", 47000], ["Tokens saved by merging", 64000],
      ["Share of tokens saved", 64000 / 111000], ["Cost separately (USD)", 0.00555], ["Cost merged (USD)", 0.00235], ["Saving (USD)", 0.0032]],
    invalid: [{ rows: 1, questions: 0, state: 1, question: 1, overhead: 0, price: 1 }],
  },
  // 10,000 × 1.5 / 60 = 250 h ($7,500); with 60% automated 100 h ($3,000) + 10,000 × $0.0002 = $3,002.
  automation_savings: {
    values: { rows: 10000, automated: 0.6, minutes: 1.5, rate: 30, model: 0.0002 },
    expect: [["Review hours without a gate", 250], ["Review hours with the gate", 100], ["Review hours saved", 150], ["Cost without a gate (USD)", 7500],
      ["Cost with the gate, review and model (USD)", 3002], ["Saving (USD)", 4498]],
    invalid: [{ rows: 1, automated: 2, minutes: 1, rate: 1 }],
  },
  // 1000 × 0.8 = 800 automated, × 0.95 = 760 right; 0.5 / 800 = 0.000625; 0.5 / 760.
  cost_per_correct: {
    values: { cost: 0.5, rows: 1000, coverage: 0.8, accuracy: 0.95 },
    expect: [["Automated rows", 800], ["Correct automated rows", 760], ["Model cost per row (USD)", 0.0005], ["Cost per automated decision (USD)", 0.000625],
      ["Cost per correct automated decision (USD)", 0.5 / 760]],
    more: [{ values: { cost: 0.5, rows: 1000, coverage: 0, accuracy: 0.95 },
      expect: [["Automated rows", 0], ["Correct automated rows", 0], ["Model cost per row (USD)", 0.0005], ["Cost per automated decision (USD)", null], ["Cost per correct automated decision (USD)", null]] }],
  },
  // bulk 200 × 500 = 100,000 tokens → 0.005; compare 400 × 450 = 180,000 → 0.009 (running 0.014 > 0.01); check 50,000 → 0.0025.
  budget_plan: {
    values: { budget: 0.01, price: 0.05, runs: "# planned\nbulk, 200, 500\ncompare;400;450\n\ncheck\t100\t500" },
    expect: (result) => {
      rowsLike(result, [["Total cost (USD)", 0.0165], ["Budget left after the plan (USD)", -0.0065], ["Runs that fit, in order", 1]]);
      tableLike(result, ["Run", "Calls", "Input tokens", "Cost (USD)", "Running total (USD)", "Within budget"],
        [["bulk", 200, 100000, 0.005, 0.005, "yes"], ["compare", 400, 180000, 0.009, 0.014, "no"], ["check", 100, 50000, 0.0025, 0.0165, "no"]]);
    },
    more: [{ values: { budget: 2, price: 0.05, runs: "a, 10, 100" }, expect: (result) => { near(result.rows[2][1], 1); assert.equal(result.table.rows[0][5], "yes"); } }],
    invalid: [{ price: 1, runs: "bulk, 200" }, { price: 1, runs: "bulk, x, 5" }, { price: 1, runs: "bulk, 1.5, 5" }, { price: 1, runs: "" }, { price: 1, runs: "# only a comment" }],
  },
  // 2 × 0.1 = 0.2 kept back, 1.8 split over weights 1 + 2 + 1 = 4: 0.45 / 0.001 = 450 rows, 0.9 / 0.0005 = 1800 rows.
  budget_split: {
    values: { budget: 2, reserve: 0.1, runs: "a, 1, 0.001\nb, 2, 0.0005\nc, 1, 0" },
    expect: (result) => {
      rowsLike(result, [["Kept back (USD)", 0.2], ["Split across runs (USD)", 1.8]]);
      tableLike(result, ["Run", "Share", "Budget (USD)", "Rows it allows"], [["a", 0.25, 0.45, 450], ["b", 0.5, 0.9, 1800], ["c", 0.25, 0.45, null]]);
    },
    invalid: [{ budget: 2, runs: "a, 0, 1" }, { budget: 2, runs: "a, -1, 1" }, { budget: 2, runs: ", 1, 1" }],
  },
  // 1.2 + 0.05 = 1.25 committed, 0.75 left: 0.3 fits (2 such runs); 0.9 does not (0.15 short).
  guard_headroom: {
    values: { budget: 2, spent: 1.2, held: 0.05, next: 0.3 },
    expect: [["Committed (USD)", 1.25], ["Budget left (USD)", 0.75], ["Next run fits", "yes"], ["Shortfall (USD)", 0], ["Runs of this size that fit", 2]],
    more: [{ values: { budget: 2, spent: 1.2, held: 0.05, next: 0.9 }, expect: [["Committed (USD)", 1.25], ["Budget left (USD)", 0.75], ["Next run fits", "no"], ["Shortfall (USD)", 0.15], ["Runs of this size that fit", 0]] },
      { values: { budget: 0, spent: 1.2, held: 0.05, next: 0.9 }, expect: [["Committed (USD)", 1.25], ["Budget left (USD)", null], ["Next run fits", "yes"], ["Shortfall (USD)", 0], ["Runs of this size that fit", null]] },
      { values: { budget: 2, spent: 2.1, next: 0.1 }, expect: [["Committed (USD)", 2.1], ["Budget left (USD)", -0.1], ["Next run fits", "no"], ["Shortfall (USD)", 0.2], ["Runs of this size that fit", 0]] }],
    invalid: [{ budget: 2, spent: -1, next: 0.1 }],
  },
  // 0.008 / 0.02 = 0.4; 0.008 / 0.05 × 1e6 = 160,000 tokens, 1,600 per row.
  bound_vs_billed: {
    values: { bound: 0.02, billed: 0.008, rows: 100, price: 0.05 },
    expect: [["Billed as a share of the bound", 0.4], ["Bound ÷ billed", 2.5], ["Unused hold (USD)", 0.012], ["Billed per row (USD)", 0.00008], ["Billed input tokens", 160000], ["Billed input tokens per row", 1600]],
    more: [{ values: { bound: 0.02, billed: 0 }, expect: [["Billed as a share of the bound", 0], ["Bound ÷ billed", null], ["Unused hold (USD)", 0.02], ["Billed per row (USD)", null], ["Billed input tokens", null], ["Billed input tokens per row", null]] }],
    invalid: [{ bound: 0, billed: 0 }],
  },
  // 1050 rows at 200: 6 runs, the last with 50; 200 × 400 × 0.05 / 1e6 = 0.004; 1050 × 400 × 0.05 / 1e6 = 0.021.
  bulk_batches_cost: {
    values: { rows: 1050, perBatch: 200, tokens: 400, price: 0.05 },
    expect: [["Bulk runs", 6], ["Rows in the last run", 50], ["Cost of the largest run (USD)", 0.004], ["Cost of every run (USD)", 0.021]],
    more: [{ values: { rows: 150, tokens: 400, calls: 2, price: 0.05 }, expect: [["Bulk runs", 1], ["Rows in the last run", 150], ["Cost of the largest run (USD)", 0.006], ["Cost of every run (USD)", 0.006]] }],
    invalid: [{ rows: 10, perBatch: 201, tokens: 1, price: 1 }],
  },
  // 4000 × 0.02 = 80 rows × 2 min = 160 min = 8/3 h × $45 = $120; 1500 × 0.001 = 1.5 → 2 rows.
  audit_sample_cost: {
    values: { automated: 4000, share: 0.02, minutes: 2, rate: 45 },
    expect: [["Rows audited", 80], ["Labeling hours", 8 / 3], ["Audit cost (USD)", 120], ["Audit cost per automated row (USD)", 0.03]],
    more: [{ values: { automated: 1500, share: 0.001, minutes: 2, rate: 45 }, expect: [["Rows audited", 2], ["Labeling hours", 1 / 15], ["Audit cost (USD)", 3], ["Audit cost per automated row (USD)", 0.002]] }],
  },
  // 300 + 60 = 360 labels × 1.2 min = 432 min = 7.2 h × $40 = $288.
  labeling_cost: {
    values: { rows: 300, minutes: 1.2, rate: 40, second: 0.2 },
    expect: [["Labels", 360], ["Labeling hours", 7.2], ["Labeling cost (USD)", 288], ["Cost per row (USD)", 0.96]],
  },
  // 0.75 − 0.30 = 0.45 saved per row; 1500 / 0.45 = 3333.3 → 3334 rows, 3.333 months at 1000 a month.
  break_even_volume: {
    values: { build: 1500, before: 0.75, after: 0.3, perMonth: 1000 },
    expect: [["Saving per row (USD)", 0.45], ["Rows to break even", 3334], ["Months to break even", 10 / 3]],
    more: [{ values: { build: 1500, before: 0.75, after: 0.75 }, expect: [["Saving per row (USD)", 0], ["Rows to break even", null], ["Months to break even", null]] }],
  },
  // 100 + 110 + 121 = 331; flat 12 × 100 = 1200; shrinking by half 100 + 50 = 150.
  // At 1e-12 a month, exact fractions give Σₖ<₁₂ 100(1 + 1e-12)ᵏ = 1200 + 6.6e-9 (Math.pow(1 + g, n) − 1 would be 0.11 off).
  // 11⁶⁰⁰ overflows a double, so the total and last month are unavailable (null), not Infinity.
  growth_cost: {
    values: { first: 100, growth: 0.1, months: 3 },
    expect: [["Total cost (USD)", 331], ["Cost of the last month (USD)", 121], ["Average per month (USD)", 331 / 3]],
    more: [{ values: { first: 100 }, expect: [["Total cost (USD)", 1200], ["Cost of the last month (USD)", 100], ["Average per month (USD)", 100]] },
      { values: { first: 100, growth: -0.5, months: 2 }, expect: [["Total cost (USD)", 150], ["Cost of the last month (USD)", 50], ["Average per month (USD)", 75]] },
      { values: { first: 100, growth: 1e-12, months: 12 }, expect: [["Total cost (USD)", 1200.0000000066], ["Cost of the last month (USD)", 100.0000000011], ["Average per month (USD)", 100.00000000055]], tolerance: 1e-14 },
      { values: { first: 100, growth: 10, months: 600 }, expect: [["Total cost (USD)", null], ["Cost of the last month (USD)", null], ["Average per month (USD)", null]] }],
    invalid: [{ first: 100, growth: -1 }],
  },
  // At 0.9: 0.99, 0.95, 0.9 automated (expected mistakes 0.01 + 0.05 + 0.1 = 0.16), 0.7 and 0.5 reviewed.
  // Automating all: 0.16 + 0.3 + 0.5 = 0.96 expected mistakes × $20 = $19.20.
  threshold_cost: {
    values: { probs: "0.99\n0.95, 0.9 0.7;0.5", threshold: 0.9, review: 2, mistake: 20 },
    expect: [["Rows", 5], ["Rows automated", 3], ["Rows sent to review", 2], ["Share sent to review", 0.4], ["Review cost (USD)", 4], ["Expected mistakes among automated rows", 0.16],
      ["Expected mistake cost (USD)", 3.2], ["Expected total cost (USD)", 7.2], ["Cost of reviewing every row (USD)", 10], ["Expected cost of automating every row (USD)", 19.2]],
    invalid: [{ probs: "0.5 1.2", threshold: 0.5, review: 1, mistake: 1 }, { probs: "abc", threshold: 0.5, review: 1, mistake: 1 }, { probs: "", threshold: 0.5, review: 1, mistake: 1 }],
  },
  // 500 × 3 / 60 = 25 h; 25 / 6 = 4.17 → 5 reviewers at 25 / 30 utilization; 25 × $35 = $875.
  review_staffing: {
    values: { rows: 500, minutes: 3, hours: 6, rate: 35 },
    expect: [["Review hours per day", 25], ["Reviewers needed", 5], ["Reviewer utilization", 25 / 30], ["Review cost per day (USD)", 875]],
    more: [{ values: { rows: 10, minutes: 3 }, expect: [["Review hours per day", 0.5], ["Reviewers needed", 1], ["Reviewer utilization", 0.5 / 6], ["Review cost per day (USD)", null]] }],
  },
  // 20,000 × 0.03 = 600 mistakes avoided × $5 = $3,000; 20,000 × 500 extra tokens × 0.05 / 1e6 = $0.50.
  variant_worth: {
    values: { rows: 20000, accA: 0.9, accB: 0.93, tokensA: 400, tokensB: 900, price: 0.05, mistake: 5 },
    expect: [["Mistakes avoided per month", 600], ["Value of avoided mistakes (USD)", 3000], ["Extra model cost per month (USD)", 0.5], ["Net gain of B per month (USD)", 2999.5],
      ["Mistake cost where they break even (USD)", 0.5 / 600]],
    tolerance: 1e-12,
    more: [{ values: { rows: 20000, accA: 0.93, accB: 0.9, tokensA: 400, tokensB: 900, price: 0.05, mistake: 5 },
      expect: [["Mistakes avoided per month", -600], ["Value of avoided mistakes (USD)", -3000], ["Extra model cost per month (USD)", 0.5], ["Net gain of B per month (USD)", -3000.5],
        ["Mistake cost where they break even (USD)", null]], tolerance: 1e-12 }],
  },
  // 0.05 per million = 0.00005 per thousand = 5e-8 per token = 20,000,000 tokens per dollar; 1000 × 500 tokens → 0.025.
  price_converter: {
    values: { value: 0.05, tokens: 500 },
    expect: [["Per million tokens (USD)", 0.05], ["Per thousand tokens (USD)", 0.00005], ["Per token (USD)", 5e-8], ["Tokens per dollar", 20000000], ["Cost of 1,000 calls (USD)", 0.025]],
    more: [{ values: { value: 0.00005, unit: "thousand", tokens: 500 }, expect: [["Per million tokens (USD)", 0.05], ["Per thousand tokens (USD)", 0.00005], ["Per token (USD)", 5e-8], ["Tokens per dollar", 20000000], ["Cost of 1,000 calls (USD)", 0.025]] },
      { values: { value: 0, unit: "token" }, expect: [["Per million tokens (USD)", 0], ["Per thousand tokens (USD)", 0], ["Per token (USD)", 0], ["Tokens per dollar", null], ["Cost of 1,000 calls (USD)", null]] }],
    invalid: [{ value: 1, unit: "billion" }],
  },
  // 400 × 0.00025 = 0.1 a day; 2 / 0.1 = 20 days; 2 / 0.00025 = 8000 rows.
  budget_runway: {
    values: { budget: 2, perDay: 400, perRow: 0.00025 },
    expect: [["Cost per day (USD)", 0.1], ["Days the budget lasts", 20], ["Whole days", 20], ["Rows the budget covers", 8000]],
    more: [{ values: { budget: 2, perDay: 400, perRow: 0 }, expect: [["Cost per day (USD)", 0], ["Days the budget lasts", null], ["Whole days", null], ["Rows the budget covers", null]] }],
  },
  // 1000 / 25 = 40 mistakes of 5000 rows = 0.008; a budget of 1e6 allows every row to be wrong.
  mistake_budget_rate: {
    values: { rows: 5000, mistake: 25, budget: 1000 },
    expect: [["Mistakes allowed per month", 40], ["Highest error rate", 0.008], ["Lowest accuracy", 0.992]],
    more: [{ values: { rows: 5000, mistake: 25, budget: 1e6 }, expect: [["Mistakes allowed per month", 5000], ["Highest error rate", 1], ["Lowest accuracy", 0]] }],
    invalid: [{ rows: 5000, mistake: 0, budget: 10 }],
  },
}, { ctx: () => fakeCtx({}) });
