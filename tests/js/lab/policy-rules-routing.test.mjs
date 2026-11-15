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
import { checkPack, fakeCtx } from "./harness.mjs";
import { POLICY_REPORT, samplePolicyCtx } from "./fixtures/workbench-analysis.mjs";

const base = samplePolicyCtx();
const rows = base.items();
const [r0, r1, r2, r3, r4] = rows;
const empty = () => samplePolicyCtx({ report: null });

// Row 4 (only the rule holds it) made wrong on urgent: the rule now catches a mistake, and automating it would cost $20.
const report = JSON.parse(JSON.stringify(POLICY_REPORT));
report.rows[4].correct = false;
report.rows[4].wrong = ["urgent"];
const caught = samplePolicyCtx({ report });

checkPack(pack, {
  input_length: { items: [{ text: "abc" }, { text: "Do you ship to Norway?" }, { text: "" }], values: [3, 22, null] },
  signal_spread: { items: rows, values: [0, 0.28, 0.03, 0.53, 0, 0.2, 0.02], ctx: base, tolerance: 1e-9 },
  wrong_margin: { items: rows, values: [null, -0.38, null, 0.1, null, -0.3, null], ctx: base, tolerance: 1e-9 },
  rule_lines: { items: rows, values: ["none", "line 1", "none", "none", "line 1", "none", "none"], ctx: base },
  input_kind: { items: [r0, r1, r4], values: ["plain text", "picture", "fields"], ctx: base },
  label_combo: { items: [r0, r1, r3], values: ["billing · yes", "shipping · no", "billing · no"], ctx: base },
  answer_combo: { items: [r0, r1, r3], values: ["billing · yes", "wholesale · no", "billing · yes"], ctx: base },
  outcome_detail: { items: rows, ctx: base, values: ["automated, right", "reviewed, a mistake caught", "automated, right", "automated, wrong",
    "reviewed, nothing wrong", "reviewed, a mistake caught", "automated, right"] },
  // At $2 a review and $20 a mistake: rows with a wrong gated answer (1, 3, 5) are cheaper reviewed.
  cheaper_route: { items: rows, values: ["automate", "review", "automate", "review", "automate", "review", "automate"], ctx: base },

  split_routes: { hitList: [r0, { ...r1, row: r0.row, text: r0.text, number: 9 }], missList: rows, ctx: base,
    message: /^Rows #1, #9 share one input, yet 1 automate and 1 go to review/ },
  rule_catches_mistake: { hit: { ...r4, correct: false, wrong: ["urgent"] }, miss: [r4, r1, r0], ctx: base,
    message: /every gate clears this row, yet urgent is wrong; rule line 1 sends it to review/ },
  rule_never_fires: { hitList: [r0, r2], missList: rows, ctx: base,
    message: /^Rule line 1 \(if department = wholesale then urgent = yes\) holds none of the 2 shown rows/ },

  rule_catch_rate: [{ ctx: base, expect: 0, empty: empty() }, { ctx: caught, expect: 1 }],
  // Every gate clears rows 0, 2, 3, 4, 6; row 3 is wrong.
  coverage_without_rules: [{ ctx: base, expect: 5 / 7, tolerance: 1e-12, empty: empty() }, { ctx: samplePolicyCtx({ hide: [4] }), expect: 4 / 6, tolerance: 1e-12 }],
  accuracy_without_rules: [{ ctx: base, expect: 0.8, empty: empty() }, { ctx: samplePolicyCtx({ hide: [3] }), expect: 1 }],
  // Row 4: a $2 review where automating it is free adds $2 over 7 rows; once it is wrong the review saves $20 − $2.
  rules_cost_per_1000: [{ ctx: base, expect: 2000 / 7, tolerance: 1e-12, empty: empty() }, { ctx: caught, expect: -18000 / 7, tolerance: 1e-12 }],

  rule_hits_csv: { ctx: base, filename: "policy-rule-lines.csv",
    text: "\"rule line\",\"rule\",\"shown rows it holds\",\"with a wrong gated answer\",\"held by this rule alone\",\"alone, with a wrong gated answer\"\r\n"
      + "\"1\",\"if department = wholesale then urgent = yes\",\"2\",\"1\",\"1\",\"0\"\r\n" },
  routing_by_label_csv: { ctx: base, filename: "policy-routing-by-label.csv",
    text: "\"question\",\"label\",\"shown rows\",\"automated\",\"automated, this answer wrong\",\"reviewed\",\"reviewed, this answer wrong\"\r\n"
      + "\"department\",\"billing\",\"2\",\"2\",\"0\",\"0\",\"0\"\r\n"
      + "\"department\",\"other\",\"1\",\"1\",\"0\",\"0\",\"0\"\r\n"
      + "\"department\",\"shipping\",\"3\",\"1\",\"0\",\"2\",\"2\"\r\n"
      + "\"department\",\"wholesale\",\"1\",\"0\",\"0\",\"1\",\"0\"\r\n"
      + "\"urgent\",\"no\",\"4\",\"2\",\"1\",\"2\",\"0\"\r\n"
      + "\"urgent\",\"yes\",\"3\",\"2\",\"0\",\"1\",\"0\"\r\n",
    excludes: ["espresso", "0.76"] },
}, { ctx: () => samplePolicyCtx() });

test("policy-rules-routing: rule lines are numbered as jev/rules.py numbers them, comments and blank lines included", () => {
  const text = "# hold wholesale\n\nif department = wholesale then urgent = yes";
  const ctx = samplePolicyCtx({ rulesInForce: text, rules: { text, applied: text, report: null, error: null, hold: true } });
  const csv = pack.features.find((f) => f.id === "rule_hits_csv").build(ctx);
  assert.match(csv, /\r\n"3","if department = wholesale then urgent = yes","0",/);
  const never = pack.features.find((f) => f.id === "rule_never_fires");
  assert.equal(never.check(rows, samplePolicyCtx({ rules: { text: "", applied: "", report: null, error: null, hold: false } })), null);
});

test("policy-rules-routing: facts never throw on an odd item", () => {
  for (const feature of pack.features.filter((f) => f.kind === "fact")) {
    feature.value({}, fakeCtx({}));
    feature.value({ answers: null, wrong: "x", rules: null }, base);
  }
});
