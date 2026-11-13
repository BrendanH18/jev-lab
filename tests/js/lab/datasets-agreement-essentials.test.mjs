import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/datasets-agreement-essentials.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { sampleAgreementReport, sampleDatasetsAgreementCtx } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsAgreementCtx(overrides);
const C = ctx();
const [A, B, G, T, X] = C.items();  // rows 3, 7, 12, 18, 25
const [NOT_COMPARED] = ctx({ report: null }).items();  // row 3 before Compare
const report = (change) => {
  const value = sampleAgreementReport();
  change(value);
  return value;
};
// intent's kappa lowered to 0.2.
const LOW = ctx({ report: report((r) => { r.questions.intent.kappa = 0.2; }) });
// urgent's kappa measured (0, as jev/agreement.py gives for one row labeled false then true), intent's 0.5.
const MEASURED = ctx({ report: report((r) => { r.questions.urgent.kappa = 0; }) });
// The comparison shows only part of its differences.
const TRUNCATED = ctx({ report: report((r) => { r.disagreements_total = 9; }) });
// 40 rows compared.
const BIG = ctx({ report: report((r) => { r.counts.compared = 40; }) });
// The intervals at full precision, as jev/calibrate.py wilson gives them (the fixture rounds them to 4 decimals):
// recomputed separately with z = 1.959963984540054 for 2 of 3 and 0 of 1.
const EXACT = ctx({ report: report((r) => {
  Object.assign(r.questions.intent, { low: 0.2076596008020477, high: 0.9385080552796037 });
  Object.assign(r.questions.urgent, { low: 0, high: 0.7934506856227626 });
}) });
const ODD = { row_id: "odd", questions: "intent", second: null, differences: "none" };

checkPack(pack, {
  asked: { items: [A, B, G, T, ODD], values: [2, 1, 3, 1, 0] },
  // Row 3 has refund and true; row 12 has replacement, urgent cleared and tone never given; row 18 none of tone; row 25 none.
  missing: { items: [A, G, T, X, ODD], values: [0, 2, 1, 2, 0] },
  differences: { items: [A, B, G, NOT_COMPARED, ODD], values: [1, 0, 1, null, null] },
  // Row 12's difference is settled as replacement; row 3's urgent is not.
  unsettled: { items: [A, G, B, NOT_COMPARED], values: [1, 0, 0, null] },
  done: { items: [A, B, G, X], values: [true, true, false, false] },
  has_picture: { items: [G, A], values: [true, false] },
  partly_labeled: { items: [G, A, T], values: [true, false, false] },
  outcome: { items: [A, B, T, NOT_COMPARED], values: ["differs", "agrees", "not labeled", null], ctx: C },
  type_mix: { items: [A, B, G, T, ODD], values: ["choice + noul", "choice", "choice + noul + score", "score", null], ctx: C },

  unsettled_difference: { hit: A, miss: [G, B, NOT_COMPARED], message: /^urgent: choose how to settle it; unsettled differences keep the saved label\.$/ },
  low_kappa: { hitList: [T], missList: [A, B, G], ctx: LOW, missCtx: C, message: /^intent: kappa 0\.20 over 3 compared rows;/ },
  // urgent: 1 compared row, kappa null in the fixture's comparison.
  kappa_unmeasurable: { hitList: [B], missList: [A, G], ctx: C, missCtx: MEASURED, message: /^urgent: both people gave all 1 compared row the same single label/ },
  // counts.compared is 3 in the fixture, whichever rows are shown.
  small_comparison: { hitList: [T], missList: [A, B, G, T, X], ctx: C, missCtx: BIG, message: /^3 rows compared: / },

  // Asked: 2 + 1 + 3 + 1 + 2 = 9 labels; given: 2 + 1 + 1 = 4.
  label_progress: { ctx: C, expect: (result) => { assert.ok(Math.abs(result.value - 4 / 9) < 1e-12); assert.equal(result.detail, "4 of 9 labels"); },
    empty: ctx({ sample: null }) },
  // intent 0.5; urgent's null kappa is left out; with urgent at 0 it is the lowest.
  lowest_kappa: [{ ctx: C, expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "intent"); }, empty: ctx({ report: null }) },
    { ctx: LOW, expect: 0.2 }, { ctx: MEASURED, expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "urgent"); } }],
  // Two shown differences, row 12's settled.
  settled_share: { ctx: C, expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "1 of 2"); }, empty: ctx({ report: null }) },

  // Wilson 95% for 2 of 3: centre (2/3 + z²/6) / (1 + z²/3) = 0.57308, half-width 0.36543 -> 20.77% to 93.85% (0.938508),
  // shown as 20.8% to 93.9%; for 0 of 1: 0 to 0.79345 -> 0.0% to 79.3%.
  agreement_summary: { ctx: EXACT, filename: "harbor-support-inbox-agreement.md",
    text: "Label agreement · Harbor support inbox · 2 of 4 labels agree (50.0%) · 1 of 3 rows agree on every question (33.3%)\n\n"
      + "| Question | Rows | Agree | Agreement | 95% interval | Kappa |\n| --- | --- | --- | --- | --- | --- |\n"
      + "| intent | 3 | 2 | 66.7% | 20.8%–93.9% | 0.50 |\n| urgent | 1 | 0 | 0.0% | 0.0%–79.3% | — |\n",
    excludes: ["refund", "replacement", "stale", "Canada", "true", "false"] },
  missing_rows: { ctx: C, filename: "harbor-support-inbox-missing-second-labels.txt", text: "row 12: urgent, tone\nrow 18: tone\nrow 25: intent, urgent\n",
    excludes: ["Grinder", "Cancel"] },

  compare: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["compare"]]), hidden: () => ctx({ labels: {} }) },
}, { ctx: () => ctx() });

const feature = (id) => pack.features.find((entry) => entry.id === id);

test("datasets-agreement-essentials: an agreeing row is unknown while part of the differences is hidden", () => {
  const [, row7, , row18] = TRUNCATED.items();
  assert.equal(feature("outcome").value(row7, TRUNCATED), null);
  assert.equal(feature("outcome").value(row18, TRUNCATED), "not labeled");
});

test("datasets-agreement-essentials: the agreement summary needs a current comparison", () => {
  assert.throws(() => runExporter(feature("agreement_summary"), ctx({ report: null })), /Compare first/);
});

test("datasets-agreement-essentials: Compare is hidden while busy", () => {
  assert.equal(feature("compare").when(ctx({ busy: true })), false);
});
