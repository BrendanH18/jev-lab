// Tests for static/js/lab/packs/workbench/costs-gate-economics.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs, at $2 a review and $20 a mistake.
// Calibrate (department, 7 labeled rows, signals .12 and .20 wrong, the rest .60 to .93 right):
//   at 0.50: 5 automated, 0 wrong, cost $4 · at 0.10: 7 automated, 2 wrong, $40 · at 0.70: 4 automated, 0 wrong, $6
//   automating every row: 2 wrong, $40 · lowest cost $4 at 0.21 to 0.60 · dearest $40 ($5,714.29 per 1,000)
// Policy (current gates department 0.50, urgent 0.30): 4 automated, 1 wrong, 3 reviews, $26; automating every row:
//   3 wrong, $60; lowest cost at department 0.50, urgent 0.45 (3 automated, 0 wrong, 4 reviews, $8). Break-even 90%.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/costs-gate-economics.js";
import { checkPack } from "./harness.mjs";
import { POLICY_CHEAPEST, POLICY_COST, sampleCostsCtx } from "./fixtures/workbench-analysis.mjs";

const base = sampleCostsCtx();
const empty = () => sampleCostsCtx({ result: null });
const cal = (calThreshold) => sampleCostsCtx({ calThreshold });
// Policy at the lowest-cost gates instead.
const cheap = sampleCostsCtx({ policyCost: { ...POLICY_COST, current: { ...POLICY_CHEAPEST.best } } });

checkPack(
  pack,
  {
    cal_loss_per_automated: [
      { ctx: base, expect: 0, empty: empty() },
      { ctx: cal(0.1), expect: 40 / 7, tolerance: 1e-12 },
    ],
    cal_break_even_headroom: [
      { ctx: base, expect: 0.1, tolerance: 1e-12, empty: empty() },
      { ctx: cal(0.1), expect: 5 / 7 - 0.9, tolerance: 1e-12 },
    ],
    // Two reviews avoid both mistakes; at 0.70 three reviews avoid the same two.
    cal_reviews_per_mistake_avoided: [
      { ctx: base, expect: 1, empty: empty() },
      { ctx: cal(0.7), expect: 1.5 },
      { ctx: cal(0.1), expect: null },
    ],
    cal_savings_vs_automate_all: [
      { ctx: base, expect: 0.9, tolerance: 1e-12, empty: empty() },
      { ctx: cal(0.1), expect: 0 },
    ],
    // The $40 of mistakes avoided over 2 reviews; at 0.70 over 3.
    cal_review_price_tie: [
      { ctx: base, expect: 20, empty: empty() },
      { ctx: cal(0.7), expect: 40 / 3, tolerance: 1e-12 },
    ],
    cal_near_cheapest_width: [
      {
        ctx: base,
        empty: empty(),
        expect: (r) => {
          assert.ok(Math.abs(r.value - 0.39) < 1e-9);
          assert.equal(r.detail, "0.21 to 0.60 (40 steps) cost at most $4.40");
        },
      },
    ],
    cal_slider_to_cheapest: [
      { ctx: base, expect: 0.29, tolerance: 1e-9, empty: empty() },
      { ctx: cal(0.1), expect: -0.11, tolerance: 1e-9 },
    ],
    cal_cost_spread: [{ ctx: base, expect: 36000 / 7, tolerance: 1e-9, empty: empty() }],

    pol_loss_per_automated: [
      { ctx: base, expect: 5, empty: empty() },
      { ctx: cheap, expect: 0 },
    ],
    pol_break_even_headroom: [
      { ctx: base, expect: -0.15, tolerance: 1e-12, empty: empty() },
      { ctx: cheap, expect: 0.1, tolerance: 1e-12 },
    ],
    pol_reviews_per_mistake_avoided: [
      { ctx: base, expect: 1.5, empty: empty() },
      { ctx: cheap, expect: 4 / 3, tolerance: 1e-12 },
    ],
    pol_savings_vs_automate_all: [
      { ctx: base, expect: 34 / 60, tolerance: 1e-12, empty: empty() },
      { ctx: cheap, expect: 52 / 60, tolerance: 1e-12 },
    ],
    // $60 − $20 of mistakes over 3 reviews; at the cheapest gates $60 − $0 over 4.
    pol_review_price_tie: [
      { ctx: base, expect: 40 / 3, tolerance: 1e-12, empty: empty() },
      { ctx: cheap, expect: 15 },
    ],
    // $2 × 4 automated ÷ 1 wrong; with 2 wrong, $4; nothing wrong at the cheapest gates.
    pol_break_even_price: [
      { ctx: base, expect: 8, empty: empty() },
      {
        ctx: sampleCostsCtx({
          policyCost: { ...POLICY_COST, current: { ...POLICY_COST.current, wrong: 2, cost: 46 } },
        }),
        expect: 4,
      },
      { ctx: cheap, expect: null },
    ],
    // 3 automated at the cheapest gates against 4 now, of 7.
    pol_cheapest_coverage_change: [
      { ctx: base, expect: -1 / 7, tolerance: 1e-12, empty: empty() },
      { ctx: cheap, expect: 0 },
    ],
    pol_cheapest_moves: [
      { ctx: base, expect: "urgent 0.30 → 0.45", empty: empty() },
      { ctx: sampleCostsCtx({ active: { department: 0.5, urgent: 0.45 } }), expect: "nothing" },
      { ctx: sampleCostsCtx({ cheapest: { ...POLICY_CHEAPEST, best: null } }), expect: "review every row" },
    ],
    economics_csv: {
      ctx: base,
      filename: "gate-economics.csv",
      includes: [
        '"measure","value","basis"\r\n',
        '"Calibrate: mistake cost per automated row at the slider","0.0000","$0.00 in mistakes over 5 automated rows, against a $2.00 review"\r\n',
        '"Policy: review price at which the current gates tie automating every row","13.3333",',
        '"Policy: what the lowest-cost gates change","urgent 0.30 → 0.45",',
      ],
      check: (out) => assert.equal(out.text.trim().split("\r\n").length, 17),
    },
  },
  { ctx: () => sampleCostsCtx() },
);
