// Tests for static/js/lab/packs/workbench/policy-more.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs: gates department ≥ 0.50 and urgent ≥ 0.30, review $2, mistake $20,
// seven scored rows (index: department answer/label/signal · urgent answer/label/signal · outcome):
//   0 billing/billing .76 · yes/yes .76 · automated right      4 wholesale/wholesale .60 · no/no .60 · rule holds it
//   1 wholesale/shipping .12 · no/no .40 · department + rule   5 billing/shipping .20 · yes/yes 0 · both gates hold it
//   2 other/other .87 · no/no .90 · automated right            6 shipping/shipping .84 · yes/yes .82 · automated right
//   3 billing/billing .93 · yes/no .40 · automated, urgent wrong
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/policy-more.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { POLICY_COST, POLICY_GATES, POLICY_REPORT, samplePolicyCtx } from "./fixtures/workbench-analysis.mjs";

const base = samplePolicyCtx();
const rows = base.items();
const [r0, r1, r2, r3, r4] = rows;
const empty = () => samplePolicyCtx({ report: null });

// Priced: urgent labeled no answered yes $120 (row 3), department labeled shipping answered billing $50 (row 5).
// Row 1 (labeled shipping, answered wholesale) is not priced, so it takes the $20 default.
const priced = samplePolicyCtx({ cost: { ...POLICY_COST, mistakes: [
  { question: "urgent", label: "no", answer: "yes", cost: 120 },
  { question: "department", label: "shipping", answer: "billing", cost: 50 },
] } });

// Row 3's urgent signal raised to 0.9: its weakest signal (.9) now beats every right row's (.76, .87, .6, .82), so
// AUROC = (4 + 4 + 0) / (4 right × 3 wrong) = 8 / 12.
const report = JSON.parse(JSON.stringify(POLICY_REPORT));
report.rows[3].answers.urgent.signal = 0.9;
const overlap = samplePolicyCtx({ report });

const soleHolder = { ...r1, rules: [] };  // department alone holds it

checkPack(pack, {
  weakest_signal: { items: rows, values: [0.76, 0.12, 0.87, 0.4, 0.6, 0, 0.82], ctx: base },
  rules_broken: { items: rows, values: [0, 1, 0, 0, 1, 0, 0], ctx: base },
  automate_cost: { items: rows, values: [0, 20, 0, 120, 0, 50, 0], ctx: priced },
  routing_cost: { items: rows, values: [0, 2, 0, 120, 2, 2, 0], ctx: priced },
  // Default prices: row 3 automated wrong costs $20 where a review was $2 (18); row 4 reviewed a right row ($2 vs $0).
  hindsight_regret: { items: rows, values: [0, 0, 0, 18, 2, 0, 0], ctx: base },
  strongest_wrong_signal: { items: rows, values: [null, 0.12, null, 0.4, null, 0.2, null], ctx: base },
  row_number: { items: rows, values: [1, 2, 3, 4, 5, 6, 7], ctx: base },
  needless_review: { items: rows, values: [false, false, false, false, true, false, false], ctx: base },
  caught_mistake: { items: rows, values: [false, true, false, false, false, true, false], ctx: base },
  // Margins (signal − threshold): row 3 urgent .10 < department .43; row 5 ties at −.30 and goes to department.
  weakest_gate: { items: rows, values: ["department", "department", "department", "urgent", "department", "department", "department"], ctx: base },
  // Rows 1 and 4 carry a channel; text rows fall in "(none)" as jev/slices.py puts them.
  slice_value: { items: rows, values: ["(none)", "email", "(none)", "(none)", "phone", "(none)", "(none)"],
    ctx: samplePolicyCtx({ slices: { fields: [{ name: "channel", values: 2 }], field: "channel", slices: [], overall: {} } }) },
  gated_answers: { items: [r0, r1, r3], values: ["department: billing · urgent: yes", "department: wholesale · urgent: no", "department: billing · urgent: yes"], ctx: base },
  gated_labels: { items: [r0, r1, r3], values: ["department: billing · urgent: yes", "department: shipping · urgent: no", "department: billing · urgent: no"], ctx: base },

  rule_false_alarm: { hit: r4, miss: [r0, r1, r3], ctx: base, message: /only rule line 1 holds this row/ },
  // Department holds rows 1 (with a rule) and 5 (with urgent); urgent holds row 5 (with department).
  redundant_gate: { hitList: rows, missList: [r0, soleHolder], ctx: base, message: /^(department holds 2|urgent holds 1) shown rows?, but another gate/ },
  // Urgent holds only row 5, where its own answer (yes/yes) is right.
  holds_no_mistake: { hitList: rows, missList: [r0, r1], ctx: base, message: /^urgent holds 1 shown row, and its own answer is right/ },
  // Automated rows 0, 2, 3, 6: 3 of 4 right (75.0%) against the fixture's break-even 90.0%.
  below_break_even: { hitList: rows, missList: [r0, r1, r2], ctx: base, message: /right 75\.0% of the time, below the 90\.0%/ },

  // Held rows 1, 4, 5; rows 1 and 5 have a wrong answer.
  review_yield: [{ ctx: base, expect: 2 / 3, tolerance: 1e-12, empty: empty() }, { ctx: samplePolicyCtx({ hide: [4] }), expect: 1 }],
  // Rows with a wrong answer 1, 3, 5; 1 and 5 are held. Without row 1: 1 of 2.
  error_recall: [{ ctx: base, expect: 2 / 3, tolerance: 1e-12, empty: empty() }, { ctx: samplePolicyCtx({ hide: [1] }), expect: 0.5 }],
  needless_review_cost: [{ ctx: base, expect: 2, empty: empty() }, { ctx: samplePolicyCtx({ hide: [4] }), expect: 0 }],
  // Department right on 5 of 7, urgent on 6 of 7: product 30/49; every answer right on 4 of 7 = 28/49. Without row 3
  // urgent is right on all 6: 4/6 × 1 − 4/6 = 0.
  independence_gap: [{ ctx: base, expect: -2 / 49, tolerance: 1e-12, empty: empty() }, { ctx: samplePolicyCtx({ hide: [3] }), expect: 0, tolerance: 1e-12 }],
  weakest_signal_auroc: [{ ctx: base, expect: 1, empty: empty() }, { ctx: overlap, expect: 8 / 12, tolerance: 1e-12 }],
  // $26 over 7 rows (POLICY_COST's own figure); without row 3: three $2 reviews over 6 rows.
  shown_cost_per_1000: [{ ctx: base, expect: 26000 / 7, tolerance: 1e-12, empty: empty() }, { ctx: samplePolicyCtx({ hide: [3] }), expect: 1000, tolerance: 1e-12 }],
  // Cheaper routes: rows 1, 3, 5 cost one $2 review each, the rest nothing: $6. Without row 1: $4 over 6 rows.
  hindsight_cost_per_1000: [{ ctx: base, expect: 6000 / 7, tolerance: 1e-12, empty: empty() }, { ctx: samplePolicyCtx({ hide: [1] }), expect: 4000 / 6, tolerance: 1e-12 }],
  // Row 3's wrong urgent signal .40 is .10 above 0.30, not within 0.05; with urgent at 0.37 it is .03 above.
  mistakes_near_gate: [{ ctx: base, expect: 0, empty: empty() },
    { ctx: samplePolicyCtx({ gates: { ...POLICY_GATES, urgent: { on: true, t: 0.37 } } }), expect: 1 }],
  mistakes_per_1000: [{ ctx: base, expect: 1000 / 7, tolerance: 1e-12, empty: empty() }, { ctx: samplePolicyCtx({ hide: [3] }), expect: 0 }],
  // Wilson 95% (z = 1.959964) by a separate Python computation: 4 of 7 → 0.2505–0.8418, 3 of 6 → 0.1876–0.8124.
  shown_coverage: [{ ctx: base, empty: empty(), expect: (r) => {
    assert.ok(Math.abs(r.value - 4 / 7) < 1e-12);
    assert.equal(r.detail, "4 of 7; 95% interval 25.0%–84.2%");
  } }, { ctx: samplePolicyCtx({ hide: [0] }), expect: (r) => {
    assert.equal(r.value, 0.5);
    assert.equal(r.detail, "3 of 6; 95% interval 18.8%–81.2%");
  } }],

  round_gates: {
    ctx: () => samplePolicyCtx({ gates: { ...POLICY_GATES, urgent: { on: true, t: 0.32 } } }),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThresholds", { urgent: 0.3 }]]);
      assert.match(ctx.env.toasts[0].message, /urgent 0\.32 → 0\.30/);
    },
    hidden: () => samplePolicyCtx(),
  },
  raise_gates: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["setThresholds", { department: 0.55, urgent: 0.35 }]]),
    hidden: () => samplePolicyCtx({ gates: { ...POLICY_GATES, department: { on: true, t: 1 }, urgent: { on: true, t: 1 } } }),
  },
  lower_gates: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["setThresholds", { department: 0.45, urgent: 0.25 }]]),
    hidden: () => samplePolicyCtx({ gates: { ...POLICY_GATES, department: { on: true, t: 0 }, urgent: { on: true, t: 0 } } }),
  },
  // Row 3 is the only automated mistake: urgent's signal .40 is held from 0.41 up.
  hold_mistakes: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThresholds", { urgent: 0.41 }]]);
      assert.match(ctx.env.toasts[0].message, /urgent 0\.30 → 0\.41/);
    },
    hidden: () => samplePolicyCtx({ hide: [3] }),
  },
}, { ctx: () => samplePolicyCtx() });

test("policy-more: a wrong answer whose signal is 1 cannot be held", async () => {
  const report = JSON.parse(JSON.stringify(POLICY_REPORT));
  report.rows[3].answers.urgent.signal = 1;
  const ctx = samplePolicyCtx({ report });
  await pack.features.find((f) => f.id === "hold_mistakes").run(ctx);
  assert.deepEqual(ctx.log, []);
  assert.equal(ctx.env.toasts[0].kind, "error");
});

// Row 3 also answers department wrongly (signal .93, needs .94: a .44 raise) besides urgent (.40, needs .41: a .11 raise):
// only urgent moves. Row 2 made an automated department mistake whose urgent signal is .40: once row 3 (shown first)
// raised urgent to .41 it is held already, so department stays put.
test("policy-more: holding mistakes raises one gate per row, the smallest raise, and skips rows an earlier raise holds", async () => {
  const report = JSON.parse(JSON.stringify(POLICY_REPORT));
  report.rows[3].wrong = ["department", "urgent"];
  report.rows[3].answers.department = { answer: "other", label: "billing", signal: 0.93 };
  report.rows[2] = { ...report.rows[2], correct: false, wrong: ["department"],
    answers: { department: { answer: "billing", label: "other", signal: 0.87 }, urgent: { answer: "no", label: "no", signal: 0.4 } } };
  const hold = pack.features.find((f) => f.id === "hold_mistakes");
  const ctx = samplePolicyCtx({ report, order: [3, 2] });
  await hold.run(ctx);
  assert.deepEqual(ctx.log, [["setThresholds", { urgent: 0.41 }]]);
  // In row order, row 2 comes first and raises department to .88. Row 3 (department .93) is not held by that, and
  // department now needs only .94 − .88 = .06 more against urgent's .11, so department goes on to .94 alone.
  const rowOrder = samplePolicyCtx({ report });
  await hold.run(rowOrder);
  assert.deepEqual(rowOrder.log, [["setThresholds", { department: 0.94 }]]);
  // Department cheaper to raise on row 3 (signal .52 needs .53: a .03 raise) moves department alone.
  const cheap = JSON.parse(JSON.stringify(POLICY_REPORT));
  cheap.rows[3].wrong = ["department", "urgent"];
  cheap.rows[3].answers.department = { answer: "other", label: "billing", signal: 0.52 };
  const third = samplePolicyCtx({ report: cheap });
  await hold.run(third);
  assert.deepEqual(third.log, [["setThresholds", { department: 0.53 }]]);
});

test("policy-more: a row field that is not text reads as Python's json.dumps(sort_keys=True)", () => {
  const fact = pack.features.find((f) => f.id === "slice_value");
  const ctx = { data: { slices: { field: "meta" } } };
  assert.equal(fact.value({ row: { meta: { b: [1, true], a: "é" } } }, ctx), '{"a": "\\u00e9", "b": [1, true]}');
  assert.equal(fact.value({ row: { meta: "  " } }, ctx), "(none)");
  assert.equal(fact.value({ row: { meta: 0 } }, ctx), "0");
});

test("policy-more: facts never throw on an odd item", () => {
  for (const feature of pack.features.filter((f) => f.kind === "fact")) {
    feature.value({}, fakeCtx({}));
    feature.value({ answers: null, wrong: "x" }, base);
  }
});
