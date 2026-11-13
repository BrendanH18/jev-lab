// Tests for static/js/lab/packs/workbench/costs-more.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs: review $2, default mistake $20, priced mistakes department billing →
// shipping $50, urgent yes → no $120, tone 2 → 0 $35.5. Calibrate (department, 7 labeled rows, signals .76 .12 .87 .93
// .60 .20 .84 with rows at .12 and .20 wrong) costs at threshold t:
//   t ≤ .12: 7 automated, 2 wrong, $40   .13–.20: 6 automated, 1 wrong, $22   .21–.60: 5 automated, 0 wrong, $4
//   .61–.76: 4 automated, $6   .77–.84: 3 automated, $8   reviewing every row: $14; lowest $4 from 0.21.
// Policy: $26 at the gates (3 reviews + one $20 mistake), $14 reviewing every row, lowest $8 (per 1,000 = × 1000 / 7).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/costs-more.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { POLICY_CHEAPEST, POLICY_COST, sampleCostsCtx } from "./fixtures/workbench-analysis.mjs";

const A = { question: "department", label: "billing", answer: "shipping", cost: "50" };
const B = { question: "urgent", label: "yes", answer: "no", cost: "120" };
const C = { question: "tone", label: "2", answer: "0", cost: "35.5" };
const ARev = { question: "department", label: "shipping", answer: "billing", cost: "50" };
const BRev = { question: "urgent", label: "no", answer: "yes", cost: "120" };
const SPOT = { question: "spot", label: "a", answer: "b", cost: "3" };
const ctx = () => sampleCostsCtx();
const empty = () => sampleCostsCtx({ result: null, costs: { review: "2", error: "20", mistakes: [] } });
const at = (calThreshold) => sampleCostsCtx({ calThreshold });

// Hand-made cost sweeps over 10 labeled rows at $2 a review. Reviews cost 2 × (10 − automated); the rest is mistakes.
//   A: t0 $60 (all mistakes) · t.5 $4 + $16 · t.9 $14 · t1 $20.  At ×1 t.9 ($14) is cheapest; at ×½ t.5 ($4 + $8 = $12).
//   B: t0 $60 · t.7 $6 + $5 · t.9 $14 · t1 $20.  At ×1 t.7 ($11); at ×2 t.7 is $16, so t.9 ($14).
//   C: t0 $60 (all mistakes) · t1 $20.  At ×2 t0 is $120: review every row.
const sweepCtx = (sweep) => sampleCostsCtx({ calCost: { review: 2, error: 20, labeled: 10, sweep } });
const SWEEP_A = [{ threshold: 0, automated: 10, wrong: 3, cost: 60 }, { threshold: 0.5, automated: 8, wrong: 1, cost: 20 },
  { threshold: 0.9, automated: 3, wrong: 0, cost: 14 }, { threshold: 1, automated: 0, wrong: 0, cost: 20 }];
const SWEEP_B = [{ threshold: 0, automated: 10, wrong: 3, cost: 60 }, { threshold: 0.7, automated: 7, wrong: 1, cost: 11 },
  { threshold: 0.9, automated: 3, wrong: 0, cost: 14 }, { threshold: 1, automated: 0, wrong: 0, cost: 20 }];
const SWEEP_C = [{ threshold: 0, automated: 10, wrong: 3, cost: 60 }, { threshold: 1, automated: 0, wrong: 0, cost: 20 }];

checkPack(pack, {
  // 1 − 2/50, 1 − 2/120, 1 − 2/35.5; a free mistake has none; a $1 mistake is below a review: 0.
  break_even: { items: [{ ...A }, { ...B }, { ...C }, { ...A, cost: "0" }, { ...A, cost: "1" }], values: [0.96, 1 - 2 / 120, 1 - 2 / 35.5, null, 0],
    ctx: ctx(), tolerance: 1e-12 },
  score_distance: { items: [{ ...A }, { ...C }, { ...C, label: "1", answer: "2" }], values: [null, 2, 1], ctx: ctx() },
  label: { items: [{ ...A }, { ...B }, { ...C }], values: ["billing", "yes", "2"] },
  answer: { items: [{ ...A }, { ...B }, { ...C }], values: ["shipping", "no", "0"] },
  direction: { items: [{ ...A }, { ...B }, { ...C }, { ...BRev }, { ...C, label: "0", answer: "2" }],
    values: [null, "false no", "answered lower", "false yes", "answered higher"], ctx: ctx() },
  reverse_priced: { items: [{ ...A }, { ...B }, { ...ARev }], values: [true, false, true],
    ctx: sampleCostsCtx({ costs: { review: "2", error: "20", mistakes: [A, B, ARev] } }) },
  stale: { items: [{ ...A }, { ...SPOT }, { ...A, label: "refunds" }, { ...C, answer: "3" }], values: [false, true, true, true], ctx: ctx() },
  on_calibrate: { items: [{ ...A }, { ...B }], values: [true, false], ctx: ctx() },
  on_policy: { items: [{ ...A }, { ...B }, { ...C }], values: [true, true, false], ctx: ctx() },
  equals_default: { items: [{ ...A }, { ...B, cost: "20.0" }], values: [false, true], ctx: ctx() },

  cal_savings_share: [{ ctx: ctx(), expect: 10 / 14, tolerance: 1e-12, empty: empty() }, { ctx: at(0.15), expect: -8 / 14, tolerance: 1e-12 }],
  cal_review_spend: [{ ctx: ctx(), expect: 4000 / 7, tolerance: 1e-12, empty: empty() }, { ctx: at(0.8), expect: 8000 / 7, tolerance: 1e-12 }],
  cal_mistake_spend: [{ ctx: at(0.15), expect: 20000 / 7, tolerance: 1e-12, empty: empty() }, { ctx: ctx(), expect: 0 }],
  cal_regret: [{ ctx: at(0.8), expect: 4000 / 7, tolerance: 1e-12, empty: empty() }, { ctx: ctx(), expect: 0, tolerance: 1e-12 }],
  // 2 × 6 / 1 at 0.15; 2 × 7 / 2 at 0.10; no automated mistake at 0.50.
  cal_break_even_price: [{ ctx: at(0.15), expect: 12, empty: empty() }, { ctx: at(0.1), expect: 7 }, { ctx: ctx(), expect: null }],
  cal_best_at_half: [{ ctx: ctx(), expect: 0.21, empty: empty() }, { ctx: sweepCtx(SWEEP_A), expect: 0.5 }],
  cal_best_at_double: [{ ctx: ctx(), expect: 0.21, empty: empty() }, { ctx: sweepCtx(SWEEP_B), expect: 0.9 },
    { ctx: sweepCtx(SWEEP_C), expect: "review every row" }],

  pol_savings_share: [{ ctx: ctx(), expect: -12 / 14, tolerance: 1e-12, empty: empty() },
    { ctx: sampleCostsCtx({ policyCost: { ...POLICY_COST, current: { ...POLICY_COST.current, cost: 8 } } }), expect: 6 / 14, tolerance: 1e-12 }],
  pol_regret: [{ ctx: ctx(), expect: 18000 / 7, tolerance: 1e-12, empty: empty() },
    { ctx: sampleCostsCtx({ cheapest: { ...POLICY_CHEAPEST, best: null } }), expect: 26000 / 7 - 2000, tolerance: 1e-12 }],
  // $26 − 3 reviews × $2 = $20 of mistakes over 7 rows.
  pol_mistake_spend: [{ ctx: ctx(), expect: 20000 / 7, tolerance: 1e-12, empty: empty() },
    { ctx: sampleCostsCtx({ policyCost: { ...POLICY_COST, current: { ...POLICY_COST.current, cost: 6 } } }), expect: 0 }],
  mean_price: [{ ctx: ctx(), expect: 68.5, empty: empty() }, { ctx: sampleCostsCtx({ hide: [1] }), expect: 42.75 }],
  // Pairs: department 4 × 3 + urgent 2 × 1 + tone 3 × 2 = 20; three priced leaves 17; a Box question's entry counts nothing.
  unpriced_pairs: [{ ctx: ctx(), expect: 17, empty: empty() },
    { ctx: sampleCostsCtx({ costs: { review: "2", error: "20", mistakes: [A, B, SPOT] } }), expect: 18 }],

  fill_question: {
    input: [{ ...A }], params: { question: " urgent " }, ctx: ctx(),
    output: [{ ...A }, { question: "urgent", label: "yes", answer: "no", cost: "20" }, { question: "urgent", label: "no", answer: "yes", cost: "20" }],
    unchanged: [{ ...A }, { ...B }, { ...BRev }],
    rejects: [{ params: { question: "spot" }, message: /not a Choice, Noul or Score question/ }, { params: { question: "" }, message: /required/ }],
  },
  add_reverse: { input: [{ ...A }, { ...B }], shown: [0], ctx: ctx(), output: [{ ...A }, { ...B }, { ...ARev }], unchanged: [{ ...A }, { ...ARev }] },
  drop_default_priced: { input: [{ ...A }, { ...B, cost: "20" }, { ...C }], ctx: ctx(), output: [{ ...A }, { ...C }], unchanged: [{ ...A }, { ...B }, { ...C }] },
  score_by_distance: {
    input: [{ ...A }, { ...C }, { ...C, label: "1", answer: "2", cost: "5" }], params: { base: "10" }, ctx: ctx(),
    output: [{ ...A }, { ...C, cost: "20" }, { ...C, label: "1", answer: "2", cost: "10" }],
    rejects: [{ params: { base: "-1" }, message: /at least 0/ }],
  },
  round_cents: { input: [{ ...A, cost: "35.555" }, { ...B }, { ...C, cost: "x" }], output: [{ ...A, cost: "35.56" }, { ...B }, { ...C, cost: "x" }],
    unchanged: [{ ...A }, { ...B }, { ...C }] },
  sort_by_question: { input: [{ ...C }, { ...C, label: "1" }, { ...B }, { ...A }, { ...SPOT }], ctx: ctx(),
    output: [{ ...A }, { ...B }, { ...C, label: "1" }, { ...C }, { ...SPOT }], unchanged: [{ ...A }, { ...B }, { ...C }] },
  drop_stale: { input: [{ ...A }, { ...SPOT }, { ...A, label: "refunds" }], ctx: ctx(), output: [{ ...A }], unchanged: [{ ...A }, { ...B }, { ...C }] },
  set_shown_price: {
    input: [{ ...A }, { ...B }], shown: [1], params: { price: "75" }, output: [{ ...A }, { ...B, cost: "75" }],
    rejects: [{ params: { price: "" }, message: /required/ }, { params: { price: "2000000" }, message: /at most/ }],
  },
  noul_prices: {
    input: [{ ...A }, { ...B }], params: { question: "urgent", false_yes: "30", false_no: "90" }, ctx: ctx(),
    output: [{ ...A }, { ...B, cost: "90" }, { ...BRev, cost: "30" }],
    rejects: [{ params: { question: "department", false_yes: "1", false_no: "2" }, message: /not a Noul question/ }],
  },
  raise_to_review: { input: [{ ...A }, { ...B, cost: "1" }], ctx: ctx(), output: [{ ...A }, { ...B, cost: "2" }], unchanged: [{ ...A }, { ...B }] },

  prices_json: {
    ctx: ctx(), filename: "price-list.json",
    check: (out) => assert.deepEqual(JSON.parse(out.text), { review: 2, error: 20,
      mistakes: [{ ...A, cost: 50 }, { ...B, cost: 120 }, { ...C, cost: 35.5 }] }),
  },
  mistakes_markdown: {
    ctx: ctx(), filename: "priced-mistakes.md",
    text: "| question | label | answer | price | break-even accuracy |\n| --- | --- | --- | --- | --- |\n"
      + "| department | billing | shipping | $50.00 | 96.0% |\n| urgent | yes | no | $120.00 | 98.3% |\n| tone | 2 | 0 | $35.50 | 94.4% |\n",
  },
  cost_summary_csv: {
    ctx: ctx(), filename: "cost-summary.csv",
    includes: ['"Calibrate","question","department"', '"Calibrate","threshold","0.50"', '"Calibrate","cost per 1,000 at the threshold","571.43"',
      '"Calibrate","cost per 1,000 reviewing every row","2000.00"', '"Calibrate","lowest-cost threshold","0.21"',
      '"Policy","gates","department 0.50; urgent 0.30"', '"Policy","cost per 1,000 at the gates","3714.29"',
      '"Policy","lowest cost per 1,000","1142.86"', '"Policy","lowest-cost gates","department 0.50; urgent 0.45"'],
    excludes: ["billing", "shipping"],
  },
  price_matrix_csv: {
    ctx: ctx(), filename: "price-matrix.csv",
    includes: ['"department","billing","shipping","50","priced"', '"urgent","yes","no","120","priced"', '"tone","2","0","35.5","priced"',
      '"department","billing","wholesale","20","default"', '"urgent","no","yes","20","default"'],
    check: (out) => assert.equal(out.text.trim().split("\r\n").length, 21),
  },
  cal_sweep_csv: {
    ctx: ctx(), filename: "calibrate-cost-sweep.csv",
    includes: ['"0.50","5","0","4.00","571.43"', '"0.15","6","1","22.00","3142.86"', '"0.00","7","2","40.00","5714.29"'],
    check: (out) => assert.equal(out.text.trim().split("\r\n").length, 102),
  },
}, { ctx: () => sampleCostsCtx() });

test("costs-more: exports refuse when there is nothing to export", () => {
  for (const id of ["cost_summary_csv", "cal_sweep_csv"]) assert.throws(() => pack.features.find((f) => f.id === id).build(empty()), /no cost yet/);
  const invalid = sampleCostsCtx({ costs: { review: "x", error: "20", mistakes: [] } });
  assert.throws(() => pack.features.find((f) => f.id === "price_matrix_csv").build(invalid), /number from 0 to 1,000,000/);
});

test("costs-more: filling a question refuses to pass the 100-mistake limit", () => {
  const many = Array.from({ length: 99 }, (_, i) => ({ question: "x", label: String(i), answer: "y", cost: "1" }));
  const fill = pack.features.find((f) => f.id === "fill_question");
  assert.throws(() => fill.all(many, { question: "urgent" }, ctx(), new Set()), /at most 100/);
});

test("costs-more: facts never throw on an odd item", () => {
  for (const feature of pack.features.filter((f) => f.kind === "fact")) {
    feature.value({}, fakeCtx({}));
    feature.value({ question: null, cost: {} }, ctx());
  }
});
