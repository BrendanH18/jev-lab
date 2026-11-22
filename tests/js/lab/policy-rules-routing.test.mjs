// Tests for static/js/lab/packs/workbench/policy-rules-routing.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs: gates department ≥ 0.50 and urgent ≥ 0.30, rule line 1
// "if department = wholesale then urgent = yes", review $2, mistake $20, seven scored rows
// (index: department answer/label/signal · urgent answer/label/signal · route):
//   0 billing/billing .76 · yes/yes .76 · automated right      4 wholesale/wholesale .60 · no/no .60 · rule 1 alone, right
//   1 wholesale/shipping .12 · no/no .40 · department + rule 1  5 billing/shipping .20 · yes/yes 0 · both gates
//   2 other/other .87 · no/no .90 · automated right            6 shipping/shipping .84 · yes/yes .82 · automated right
//   3 billing/billing .93 · yes/no .40 · automated, urgent wrong
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/policy-rules-routing.js";
import { checkPack } from "./harness.mjs";
import { POLICY_COST, POLICY_REPORT, samplePolicyCtx } from "./fixtures/workbench-analysis.mjs";

const base = samplePolicyCtx();
const rows = base.items();
const [r0, r1, r2, r3, r4] = rows;
const empty = () => samplePolicyCtx({ report: null });

// Row 4 (only the rule holds it) made wrong on urgent: the rule now catches a mistake, and automating it would cost $20.
const report = JSON.parse(JSON.stringify(POLICY_REPORT));
report.rows[4].correct = false;
report.rows[4].wrong = ["urgent"];
report.rows[4].answers.urgent.label = "yes";
const caught = samplePolicyCtx({ report });
const customPrice = samplePolicyCtx({
  report,
  cost: { ...POLICY_COST, mistakes: [{ question: "urgent", label: "yes", answer: "no", cost: 30 }] },
});

checkPack(
  pack,
  {
    rule_catches_mistake: {
      hit: { ...r4, correct: false, wrong: ["urgent"] },
      miss: [r4, r1, r0],
      ctx: base,
      message: /every gate clears this row, yet urgent is wrong; rule line 1 sends it to review/,
    },
    rule_never_fires: {
      hitList: [r0, r2],
      missList: rows,
      ctx: base,
      message: /^Rule line 1 \(if department = wholesale then urgent = yes\) holds none of the 2 shown rows/,
    },

    rule_catch_rate: [
      { ctx: base, expect: 0, empty: empty() },
      { ctx: caught, expect: 1 },
    ],
    // Every gate clears rows 0, 2, 3, 4, 6; row 3 is wrong.
    coverage_without_rules: [
      { ctx: base, expect: 5 / 7, tolerance: 1e-12, empty: empty() },
      { ctx: samplePolicyCtx({ hide: [4] }), expect: 4 / 6, tolerance: 1e-12 },
    ],
    accuracy_without_rules: [
      { ctx: base, expect: 0.8, empty: empty() },
      { ctx: samplePolicyCtx({ hide: [3] }), expect: 1 },
    ],
    // Row 4: a $2 review where automating it is free adds $2 over 7 rows; once it is wrong the review saves $20 − $2.
    rules_cost_per_1000: [
      { ctx: base, expect: 2000 / 7, tolerance: 1e-12, empty: empty() },
      { ctx: caught, expect: -18000 / 7, tolerance: 1e-12 },
      { ctx: customPrice, expect: -28000 / 7, tolerance: 1e-12 },
    ],

    rule_hits_csv: {
      ctx: base,
      filename: "policy-rule-lines.csv",
      text:
        '"rule line","rule","shown rows it holds","with a wrong gated answer","held by this rule alone","alone, with a wrong gated answer"\r\n' +
        '"1","if department = wholesale then urgent = yes","2","1","1","0"\r\n',
    },
  },
  { ctx: () => samplePolicyCtx() },
);

test("policy-rules-routing: rule lines are numbered as jev/rules.py numbers them, comments and blank lines included", () => {
  const text = "# hold wholesale\n\nif department = wholesale then urgent = yes";
  const ctx = samplePolicyCtx({
    rulesInForce: text,
    rules: { text, applied: text, report: null, error: null, hold: true },
  });
  const csv = pack.features.find((f) => f.id === "rule_hits_csv").build(ctx);
  assert.match(csv, /\r\n"3","if department = wholesale then urgent = yes","0",/);
  const never = pack.features.find((f) => f.id === "rule_never_fires");
  assert.equal(
    never.check(rows, samplePolicyCtx({ rules: { text: "", applied: "", report: null, error: null, hold: false } })),
    null,
  );
});
