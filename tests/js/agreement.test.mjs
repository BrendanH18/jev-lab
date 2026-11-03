// Run with: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import { secondItems, settleKey, settledItems } from "../../static/js/agreement.js";

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
