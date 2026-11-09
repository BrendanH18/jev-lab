// Run with: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import { secondItems, settleKey, settledItems, sessionSettlements, sessionItems, changeSecondLabel, agreementEditsUnsaved,
  restoreAgreementEdits, restoredChoices } from "../../static/js/agreement.js";

const ITEMS = [
  { row_id: "aaa", number: 1, row: { text: "Charged twice" }, questions: ["department", "is_urgent"] },
  { row_id: "bbb", number: 2, row: { text: "Where is my parcel?" }, questions: ["department"] },
  { row_id: "ccc", number: 4, row: { text: "Love the beans" }, questions: ["department"] },
];

test("sends only the labeled rows, and only the questions the first labels cover", () => {
  const labels = {
    aaa: { department: "billing", is_urgent: false, wants_refund: true },
    bbb: { department: null },
    ccc: { department: "none" },
  };
  assert.deepEqual(secondItems(ITEMS, labels), [
    { row_id: "aaa", labels: { department: "billing", is_urgent: false } },
    { row_id: "ccc", labels: { department: "none" } },
  ]);
  assert.deepEqual(secondItems(ITEMS, {}), []);
  assert.deepEqual(secondItems(null, null), []);
});

test("keeps a no label of false, which is a label", () => {
  assert.deepEqual(secondItems([ITEMS[0]], { aaa: { is_urgent: false } }), [{ row_id: "aaa", labels: { is_urgent: false } }]);
});

const DISAGREE = [
  { row_id: "aaa", question: "department", first: "billing", second: "shipping" },
  { row_id: "aaa", question: "is_urgent", first: true, second: false },
  { row_id: "bbb", question: "department", first: "shipping", second: "billing" },
];

test("sends the settled labels that change the saved one, grouped by row", () => {
  const choices = {
    [settleKey("aaa", "department")]: "shipping",
    [settleKey("aaa", "is_urgent")]: true,  // kept the first label: nothing to write
    [settleKey("bbb", "department")]: null,  // neither: remove the label
  };
  assert.deepEqual(settledItems(DISAGREE, choices), [
    { row_id: "aaa", labels: { department: "shipping" } },
    { row_id: "bbb", labels: { department: null } },
  ]);
  assert.deepEqual(settledItems(DISAGREE, {}), []);
  assert.deepEqual(settledItems(DISAGREE, null), []);
});

test("a question id such as __proto__ stays an ordinary label", () => {
  const d = [{ row_id: "aaa", question: "__proto__", first: "x", second: "y" }];
  const out = settledItems(d, { [settleKey("aaa", "__proto__")]: "y" });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), [{ row_id: "aaa", labels: JSON.parse('{"__proto__": "y"}') }]);
});

test("agreement recovery preserves explicit false, zero and cleared settlements", () => {
  const choices = { [settleKey("aaa", "urgent")]: false, [settleKey("aaa", "score")]: 0,
    [settleKey("bbb", "department")]: null };
  const settlements = sessionSettlements(choices);
  const edits = restoreAgreementEdits({ items: [{ row_id: "aaa", labels: { urgent: false, score: 0 } }], settlements });
  assert.deepEqual(edits.labels, { aaa: { urgent: false, score: 0 } });
  assert.deepEqual(edits.pendingSettlements, settlements);
  assert.equal(agreementEditsUnsaved({ sample: { items: ITEMS }, labels: {} }), false);
  assert.equal(agreementEditsUnsaved({ sample: { items: ITEMS }, labels: { aaa: { is_urgent: false } } }), true);
  assert.equal(agreementEditsUnsaved({ sample: { items: ITEMS }, labels: {}, pendingSettlements: settlements }), true);
  const recovered = restoredChoices([{ row_id: "aaa", question: "urgent" }, { row_id: "bbb", question: "department" }], settlements);
  assert.deepEqual(recovered, { [settleKey("aaa", "urgent")]: false, [settleKey("bbb", "department")]: null });
});


test("editing another second label preserves restored and current settlements for unaffected questions", () => {
  const run = { labels: { a: { urgent: false } }, choices: { [settleKey("a", "other")]: 0 },
    pendingSettlements: [{ row_id: "a", question: "urgent", value: null }], report: {}, sessionPreview: {} };
  changeSecondLabel(run, "b", "urgent", true);
  assert.equal(run.report, null);
  assert.deepEqual(restoredChoices([{ row_id: "a", question: "urgent" }, { row_id: "a", question: "other" }], run.pendingSettlements),
    { [settleKey("a", "urgent")]: null, [settleKey("a", "other")]: 0 });
  changeSecondLabel(run, "a", "urgent", true);
  assert.deepEqual(run.pendingSettlements, [{ row_id: "a", question: "other", value: 0 }]);
});

test("recovery sends all CSV-imported human labels so a mismatched sample cannot be silently truncated", () => {
  const labels = { aaa: { is_urgent: false }, outside: { department: "billing" }, empty: {} };
  assert.deepEqual(sessionItems(labels), [{ row_id: "aaa", labels: { is_urgent: false } },
    { row_id: "outside", labels: { department: "billing" } }]);
});
