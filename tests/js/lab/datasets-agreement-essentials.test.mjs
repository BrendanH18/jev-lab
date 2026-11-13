import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/datasets-agreement-essentials.js";
import { checkPack } from "./harness.mjs";
import { sampleAgreementReport, sampleDatasetsAgreementCtx } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsAgreementCtx(overrides);
const C = ctx();
const [A, B, G, T, X] = C.items();  // rows 3, 7, 12, 18, 25
const [NOT_COMPARED] = ctx({ report: null }).items();  // row 3 before Compare
const lowReport = () => {
  const report = sampleAgreementReport();
  report.questions.intent.kappa = 0.2;
  return report;
};
const LOW = ctx({ report: lowReport() });
const everyLabel = { a1f0: { intent: "refund", urgent: true }, b2e1: { intent: "question" }, c3d2: { intent: "refund", urgent: false, tone: 0 },
  d4c3: { tone: 2 }, e5b4: { intent: "question", urgent: false } };

checkPack(pack, {
  asked: { items: [A, B, G, T], values: [2, 1, 3, 1] },
  missing: { items: [A, G, T, X], values: [0, 2, 1, 2] },
  differences: { items: [A, B, G, NOT_COMPARED], values: [1, 0, 1, null] },
  // Row 12's difference is settled as replacement; row 3's urgent is not.
  unsettled: { items: [A, G, B, NOT_COMPARED], values: [1, 0, 0, null] },
  done: { items: [A, G], values: [true, false] },
  has_picture: { items: [G, A], values: [true, false] },
  partly_labeled: { items: [G, A, T], values: [true, false, false] },
  disagrees: { items: [A, B, NOT_COMPARED], values: [true, false, false] },
  outcome: { items: [A, B, T, NOT_COMPARED], values: ["differs", "agrees", "not labeled", null], ctx: C },
  type_mix: { items: [A, B, G, T], values: ["choice + noul", "choice", "choice + noul + score", "score"], ctx: C },

  unsettled_difference: { hit: A, miss: [G, B], message: /^urgent: choose how to settle/ },
  low_kappa: { hit: LOW.items()[0], miss: LOW.items()[3], ctx: LOW, message: /intent: kappa 0\.20/ },
  // urgent: 1 compared row, kappa null. Row 7 asks intent only (kappa 0.5), row 18 tone (not compared).
  kappa_unmeasurable: { hit: [A, G, X], miss: [B, T], ctx: C, message: /^urgent: both people used one label/ },
  small_comparison: { hitList: [A, B], missList: [T, X], ctx: C, message: /^2 shown rows compared/ },

  // Asked: 2 + 1 + 3 + 1 + 2 = 9 labels; given: 2 + 1 + 1 = 4.
  label_progress: { ctx: C, expect: (result) => { assert.ok(Math.abs(result.value - 4 / 9) < 1e-12); assert.equal(result.detail, "4 of 9 labels"); },
    empty: ctx({ sample: null }) },
  rows_ready: { ctx: C, expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "of 5 sampled rows"); }, empty: ctx({ sample: null }) },
  lowest_kappa: [{ ctx: C, expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "intent"); }, empty: ctx({ report: null }) },
    { ctx: LOW, expect: 0.2 }],
  settled_share: { ctx: C, expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "1 of 2"); }, empty: ctx({ report: null }) },

  agreement_summary: { ctx: C, filename: "harbor-support-inbox-agreement.md",
    includes: ["Label agreement · Harbor support inbox · 2 of 4 labels agree (50.0%) · 1 of 3 rows agree on every question (33.3%)\n\n",
      "| Question | Rows | Agree | Agreement | 95% interval | Kappa |", "| intent | 3 | 2 | 66.7% | 20.8%–", "% | 0.50 |", "| urgent | 1 | 0 | 0.0% | 0.0%–", "% | — |"],
    excludes: ["refund", "replacement", "stale", "Canada", "true", "false"] },
  missing_rows: { ctx: C, filename: "harbor-support-inbox-missing-second-labels.txt", text: "row 12: urgent, tone\nrow 18: tone\nrow 25: intent, urgent\n" },

  compare: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["compare"]]), hidden: () => ctx({ labels: {} }) },
  copy_missing_rows: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.env.copied, ["12, 18, 25"]), hidden: () => ctx({ labels: everyLabel }) },

  // 20 + 15 agree of 50 = 0.7; first says yes 25/50, second 30/50: chance 0.5 * 0.6 + 0.5 * 0.4 = 0.5; kappa 0.2 / 0.5.
  kappa_two_by_two: { values: { yes_yes: 20, yes_no: 5, no_yes: 10, no_no: 15 },
    expect: [["Rows", 50], ["Observed agreement", 0.7], ["Expected by chance", 0.5], ["Kappa", 0.4]], tolerance: 1e-12,
    more: [{ values: { yes_yes: 10, yes_no: 0, no_yes: 0, no_no: 10 }, expect: [["Rows", 20], ["Observed agreement", 1], ["Expected by chance", 0.5], ["Kappa", 1]] }],
    invalid: [{ yes_yes: 0, yes_no: 0, no_yes: 0, no_no: 0 }, { yes_yes: 5, yes_no: 0, no_yes: 0, no_no: 0 }, { yes_yes: -1 }] },
  // 1.96² × 0.8 × 0.2 / 0.05² = 245.86 -> 246 rows, two samples; 1.96² × 0.25 / 0.1² = 96.04 -> 97 rows.
  sample_for_interval: { values: { agreement: 80, margin: 5 }, expect: [["Rows to compare", 246], ["Samples of 200 or fewer", 2]],
    more: [{ values: { agreement: 50, margin: 10 }, expect: [["Rows to compare", 97], ["Samples of 200 or fewer", 1]] }],
    invalid: [{ agreement: 80, margin: 0 }, { agreement: 120, margin: 5 }] },
}, { ctx: () => ctx() });
