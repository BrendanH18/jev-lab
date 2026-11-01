// Run with: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import { reverseOptions } from "../../static/js/variants.js";

const QUESTIONS = {
  department: { type: "choice", instructions: "Which team?", criteria: { billing: "Money", shipping: "Parcels", other: "Anything else" } },
  urgency: { type: "score", instructions: "How urgent?", criteria: ["Not", "Soon", "Now"] },
  refund: { type: "noul", instructions: "Asks for a refund?" },
};

test("reverses each Choice question's options and leaves everything else alone", () => {
  const out = reverseOptions(QUESTIONS);
  assert.deepEqual(Object.keys(out), ["department", "urgency", "refund"]);
  assert.deepEqual(Object.entries(out.department.criteria),
    [["other", "Anything else"], ["shipping", "Parcels"], ["billing", "Money"]]);
  assert.equal(out.department.instructions, "Which team?");
  assert.deepEqual(out.urgency, QUESTIONS.urgency);
  assert.deepEqual(out.refund, QUESTIONS.refund);
  // The order survives the JSON the Compare request is sent as.
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(out)).department.criteria), ["other", "shipping", "billing"]);
  assert.deepEqual(Object.keys(QUESTIONS.department.criteria), ["billing", "shipping", "other"], "input is not changed");
});

test("returns null when no Choice question's order can change", () => {
  assert.equal(reverseOptions({ urgency: QUESTIONS.urgency, refund: QUESTIONS.refund }), null);
  assert.equal(reverseOptions({ one: { type: "choice", instructions: "x", criteria: { only: "One" } } }), null);
  // Whole-number names are always listed in ascending order, so reversing them cannot move them.
  assert.equal(reverseOptions({ stars: { type: "choice", instructions: "x", criteria: { 1: "one", 2: "two" } } }), null);
  assert.equal(reverseOptions(null), null);
});
