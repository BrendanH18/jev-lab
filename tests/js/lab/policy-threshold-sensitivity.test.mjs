// Tests for static/js/lab/packs/workbench/policy-threshold-sensitivity.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs: gates department ≥ 0.50 and urgent ≥ 0.30, one rule, seven scored rows
// (index: department signal · urgent signal · outcome, right or wrong):
//   0 .76 · .76 automated right       4 .60 · .60 a rule holds it, right
//   1 .12 · .40 department + rule, wrong   5 .20 · 0 both gates hold it, wrong
//   2 .87 · .90 automated right       6 .84 · .82 automated right
//   3 .93 · .40 automated, urgent wrong
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/policy-threshold-sensitivity.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { POLICY_GATES, POLICY_REPORT, POLICY_TUNES, samplePolicyCtx } from "./fixtures/workbench-analysis.mjs";

const base = samplePolicyCtx();
const rows = base.items();
const [r0, r1, , , r4] = rows;
const empty = () => samplePolicyCtx({ report: null });
const gates = (department, urgent) => ({ ...POLICY_GATES, department: { on: true, t: department }, urgent: { on: true, t: urgent } });

// Gates department 0.80, urgent 0.40: within 0.05 are department on rows 0 (.04) and 6 (.04), urgent on rows 1 and 3 (0).
const high = samplePolicyCtx({ gates: gates(0.8, 0.4) });
// Row 5 moved to department .47 and urgent .28: both just below their thresholds.
const report = JSON.parse(JSON.stringify(POLICY_REPORT));
report.rows[5].answers.department.signal = 0.47;
report.rows[5].answers.urgent.signal = 0.28;
const nearRow5 = samplePolicyCtx({ report });
// Department at 0.88: rows 2 (.87), 3 (.93) and 6 (.84) sit within 0.05 of it.
const crowded = samplePolicyCtx({ gates: gates(0.88, 0.3) });

checkPack(pack, {
  drop_to_automate: { items: rows, values: [0, 0.38, 0, 0, 0, 0.3, 0], ctx: base, tolerance: 1e-9 },
  gates_near_cut: { items: rows, values: [1, 1, 0, 1, 0, 0, 1], ctx: high },
  // Urgent at 0.37: row 3's urgent .40 is .03 above it.
  fragile_automation: { items: rows, values: [false, false, false, true, false, false, false], ctx: samplePolicyCtx({ gates: gates(0.5, 0.37) }) },
  automate_if_lowered: { items: nearRow5.items(), values: [false, false, false, false, false, true, false], ctx: nearRow5 },
  // Smallest margins: .26, −.38, .37, .10, .10, −.30, .34.
  margin_band: { items: rows, ctx: base, values: ["more than 0.10 above", "more than 0.10 below", "more than 0.10 above", "0.10 or less above",
    "0.10 or less above", "more than 0.10 below", "more than 0.10 above"] },
  hold_source: { items: rows, ctx: base, values: ["automated", "gates and a rule", "automated", "automated", "a rule only", "gates only", "automated"] },

  crowded_cut: { hitList: rows, missList: [r0, r1, r4], ctx: crowded, message: /^3 of 7 shown rows have department's signal within 0\.05 of its threshold 0\.88/ },
  gate_at_edge: { hitList: rows, missList: rows, ctx: samplePolicyCtx({ gates: gates(0, 0.3) }), missCtx: base, message: /^department's threshold is 0\.00/ },
  bottleneck_gate: { hitList: [{ ...r1, rules: [] }, { ...rows[5], held: ["department"] }], missList: rows, ctx: base,
    message: /^department alone holds 2 of the 2 shown rows held for review/ },

  rows_near_cut: [{ ctx: base, expect: 0, empty: empty() }, { ctx: high, expect: 4 }],
  // Gates 0.55 / 0.35: rows 0, 2, 3, 6 automate (3 wrong). From 0.80 / 0.40 to 0.85 / 0.45 only row 2 does.
  coverage_raised: [{ ctx: base, expect: 4 / 7, tolerance: 1e-12, empty: empty() }, { ctx: high, expect: 1 / 7, tolerance: 1e-12 }],
  accuracy_raised: [{ ctx: base, expect: 0.75, empty: empty() }, { ctx: high, expect: 1 }],
  // Gates 0.45 / 0.25: rows 0, 2, 3, 6 again; without row 0, 3 of 6.
  coverage_lowered: [{ ctx: base, expect: 4 / 7, tolerance: 1e-12, empty: empty() }, { ctx: samplePolicyCtx({ hide: [0] }), expect: 0.5 }],
  accuracy_lowered: [{ ctx: base, expect: 0.75, empty: empty() }, { ctx: samplePolicyCtx({ hide: [3] }), expect: 1 }],
  // At 0.80 / 0.45 rows 2 and 6 automate, both right; at 0.75 / 0.40 rows 0 and 3 join, and row 3 is wrong.
  // A typed urgent threshold of 0.4049 holds row 3 (urgent .40, wrong) now, as Policy applies it unrounded; 0.3549 automates
  // it. Rounding the "now" baseline to 0.40 would count row 3 as automated already and report 0.
  mistakes_added_lowered: [{ ctx: base, expect: 0, empty: empty() }, { ctx: samplePolicyCtx({ gates: gates(0.8, 0.45) }), expect: 1 },
    { ctx: samplePolicyCtx({ gates: gates(0.5, 0.4049) }), expect: 1 }],
  // Automated rows' weakest margins .26, .37, .10, .34: median (.26 + .34) / 2; without row 3, .34.
  median_automated_margin: [{ ctx: base, expect: 0.3, tolerance: 1e-9, empty: empty() }, { ctx: samplePolicyCtx({ hide: [3] }), expect: 0.34, tolerance: 1e-9 }],

  sensitivity_csv: { ctx: high, filename: "policy-gate-sensitivity.csv",
    includes: [
      "\"question\",\"threshold\",\"move\",\"tried threshold\",\"automated\",\"share\",\"accuracy\",\"automated mistakes\"\r\n",
      // Department at 0.70: rows 0, 2, 3, 6 (row 3 wrong).
      "\"department\",\"0.80\",\"0.10 lower\",\"0.70\",\"4\",\"0.5714\",\"0.7500\",\"1\"\r\n",
      // Department at 0.90: only row 3 (.93), which is wrong.
      "\"department\",\"0.80\",\"0.10 higher\",\"0.90\",\"1\",\"0.1429\",\"0.0000\",\"1\"\r\n",
      // Urgent at 0.50 with department 0.80: rows 2 and 6.
      "\"urgent\",\"0.40\",\"0.10 higher\",\"0.50\",\"2\",\"0.2857\",\"1.0000\",\"0\"\r\n",
    ],
    check: (out) => assert.equal(out.text.trim().split("\r\n").length, 11) },
  near_cut_csv: { ctx: crowded, filename: "policy-near-cut.csv",
    text: "\"Bulk #\",\"outcome\",\"question\",\"signal\",\"threshold\",\"side\",\"distance\"\r\n"
      + "\"3\",\"right\",\"department\",\"0.87\",\"0.88\",\"held\",\"0.01\"\r\n"
      + "\"4\",\"wrong\",\"department\",\"0.93\",\"0.88\",\"clears\",\"0.05\"\r\n"
      + "\"7\",\"right\",\"department\",\"0.84\",\"0.88\",\"held\",\"0.04\"\r\n",
    excludes: ["billing", "espresso"] },
  config_markdown: { ctx: base, filename: "policy-configuration.md",
    text: "# Policy configuration\n\n- Signal: confidence\n- Target basis: estimate\n- Rules send rows that break them to review: yes\n\n"
      + "| Question | Type | Threshold |\n| --- | --- | ---: |\n| department | choice | 0.50 |\n| urgent | noul | 0.30 |\n\n"
      + "Rules in force:\n\n```text\nif department = wholesale then urgent = yes\n```\n" },

  apply_cheapest: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThresholds", { urgent: 0.45 }]]);
      assert.match(ctx.env.toasts[0].message, /urgent 0\.30 → 0\.45/);
    },
    hidden: () => samplePolicyCtx({ cheapest: null }),
  },
  apply_tune_best: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThresholds", { urgent: 0.45 }]]);
      assert.match(ctx.env.toasts[0].message, /for 95\.0%: urgent 0\.30 → 0\.45/);
    },
    hidden: () => samplePolicyCtx({ tunes: null }),
  },
  apply_tune_90: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThresholds", { urgent: 0.45 }]]);
      assert.match(ctx.env.toasts[0].message, /for 90%: urgent 0\.30 → 0\.45/);
    },
    hidden: () => samplePolicyCtx({ tunes: null }),
  },
  apply_tune_95: { ctx: () => samplePolicyCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["setThresholds", { urgent: 0.45 }]]),
    hidden: () => samplePolicyCtx({ tunes: null }) },
  // The fixture's 99% chip has no thresholds; one that does moves both gates.
  apply_tune_99: {
    ctx: () => samplePolicyCtx({ tunes: { ...POLICY_TUNES, targets: [...POLICY_TUNES.targets.slice(0, 2),
      { target: 0.99, gates: { department: 0.9, urgent: 0.5 }, automated: 1, coverage: 1 / 7, accuracy: 1, low: 0.2065, high: 1, needed: 22, plan: null }] } }),
    check: (ctx) => assert.deepEqual(ctx.log, [["setThresholds", { department: 0.9, urgent: 0.5 }]]),
    hidden: () => samplePolicyCtx(),
  },
  toggle_signal: { ctx: () => samplePolicyCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["setSignal", "top_probability"]]),
    hidden: () => samplePolicyCtx({ result: null }) },
  toggle_bound: { ctx: () => samplePolicyCtx({ bound: "lower" }), check: (ctx) => assert.deepEqual(ctx.log, [["setBound", "estimate"]]),
    hidden: () => samplePolicyCtx({ result: null }) },
}, { ctx: () => samplePolicyCtx() });

test("policy-threshold-sensitivity: the configuration says when no rule is in force", () => {
  const ctx = samplePolicyCtx({ rulesInForce: "", rules: { text: "", applied: "", report: null, error: null, hold: false } });
  const text = pack.features.find((f) => f.id === "config_markdown").build(ctx);
  assert.match(text, /Rules send rows that break them to review: no\n/);
  assert.match(text, /Rules in force: none\n$/);
});

test("policy-threshold-sensitivity: moving gates never reaches past 0 or 1, and facts never throw on an odd item", () => {
  const ctx = samplePolicyCtx({ gates: gates(1, 0) });
  const csv = pack.features.find((f) => f.id === "sensitivity_csv").build(ctx);
  assert.ok(!csv.includes("\"1.10\"") && !csv.includes("\"-0.10\""));
  assert.equal(csv.trim().split("\r\n").length, 1 + 3 + 3);
  for (const feature of pack.features.filter((f) => f.kind === "fact")) {
    feature.value({}, fakeCtx({}));
    feature.value({ answers: null, held: "x" }, base);
  }
});
