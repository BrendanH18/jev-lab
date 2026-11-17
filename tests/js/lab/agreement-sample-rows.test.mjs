import assert from "node:assert/strict";
import { test } from "node:test";

import { settleKey } from "../../../static/js/agreement.js";
import pack from "../../../static/js/lab/packs/workbench/agreement-sample-rows.js";
import { checkPack } from "./harness.mjs";
import { sampleAgreementReport, sampleDatasetsAgreementCtx } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsAgreementCtx(overrides);
const byId = (c) => Object.fromEntries(c.items().map((item) => [item.row_id, item]));
// Sample: row 3 (a1f0) gave 2 second labels, urgent differs, unsettled; row 7 (b2e1) gave 1, agrees; row 12 (c3d2) gave
// 1, intent differs and is settled as the second label (replacement; saved refund); rows 18 and 25 gave none.
const base = ctx();
const { a1f0: A, b2e1: B, c3d2: C, d4c3: D, e5b4: E } = byId(base);
const noReport = byId(ctx({ report: null }));
// Row 3's urgent difference settled as the saved label (false), or as no label.
const keptSaved = byId(
  ctx({ choices: { [settleKey("c3d2", "intent")]: "replacement", [settleKey("a1f0", "urgent")]: false } }),
).a1f0;
const unlabeled = byId(ctx({ choices: { [settleKey("a1f0", "urgent")]: null } })).a1f0;
// Row 3 differing on intent too, with only intent settled.
const twoDiffs = (() => {
  const report = sampleAgreementReport();
  report.disagreements.unshift({
    row_id: "a1f0",
    number: 3,
    row: { text: "x" },
    question: "intent",
    first: "replacement",
    second: "refund",
  });
  report.disagreements_total = 3;
  return ctx({ report, choices: { [settleKey("a1f0", "intent")]: "refund" } });
})();
const A2 = byId(twoDiffs).a1f0;

// urgent with a kappa of 0.10 (the sample has none for it).
const lowUrgent = (() => {
  const report = sampleAgreementReport();
  report.questions.urgent.kappa = 0.1;
  return ctx({ report });
})();
const K = byId(lowUrgent);

checkPack(pack, {
  // Row 3: 2 given, 1 differs; row 7: 1 given, none differs; row 12: 1 given, 1 differs; rows 18, 25: nothing given.
  agreed_questions: { items: [A, B, C, D, E], values: [1, 1, 0, null, null], ctx: base },
  row_agreement: { items: [A, B, C, D], values: [0.5, 1, 0, null], ctx: base },
  // 2 of 2, 1 of 3, 0 of 1.
  given_share: { items: [A, C, D, { questions: [] }], values: [1, 1 / 3, 0, null], tolerance: 1e-12 },
  settled_count: { items: [A, C, B, noReport.c3d2], values: [0, 1, 0, null] },
  settle_changes: { items: [C, A, keptSaved, noReport.c3d2], values: [1, 0, 0, null] },
  // Row 3 asks intent (0.5) and urgent (0.1); row 7 intent; row 12 also tone (no kappa); row 18 only tone.
  kappa_floor: { items: [K.a1f0, K.b2e1, K.c3d2, K.d4c3], values: [0.1, 0.5, 0.1, null], ctx: lowUrgent },
  took_second: { items: [C, A, keptSaved, unlabeled], values: [true, false, false, false] },
  kept_saved: { items: [keptSaved, C, A, unlabeled], values: [true, false, false, false] },
  left_unlabeled: { items: [unlabeled, C, keptSaved, A], values: [true, false, false, false] },
  settle_state: {
    items: [A, B, C, D, A2, noReport.a1f0],
    values: ["unsettled", "no difference", "settled", "not compared", "partly settled", null],
    ctx: base,
  },
  // intent 2/3, urgent 0; tone was not compared.
  weakest_question: { items: [A, B, C, D], values: ["urgent", "intent", "urgent", null], ctx: base },
  differing_types: {
    items: [A, C, B, D, A2, noReport.a1f0],
    values: ["noul", "choice", "none", null, "choice + noul", null],
    ctx: base,
  },
});

test("agreement-sample-rows: agreeing questions are unknown while only part of the differences is shown", () => {
  const report = sampleAgreementReport();
  report.disagreements_total = 5;
  const truncated = ctx({ report });
  const rows = byId(truncated);
  const fact = (id) => pack.features.find((feature) => feature.id === id);
  assert.equal(fact("agreed_questions").value(rows.b2e1, truncated), null);
  assert.equal(fact("row_agreement").value(rows.b2e1, truncated), null);
  assert.equal(fact("settle_state").value(rows.b2e1, truncated), null);
  assert.equal(fact("differing_types").value(rows.b2e1, truncated), null);
  assert.equal(fact("settle_state").value(rows.a1f0, truncated), "unsettled");
});
