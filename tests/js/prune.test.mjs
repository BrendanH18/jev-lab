// Run with: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import { automatedDelta, holdsBackNothing, totalShare, withoutQuestions } from "../../static/js/prune.js";

const QUESTIONS = {
  department: { type: "choice", instructions: "Which team?", criteria: { billing: "Money", other: "Anything else" } },
  urgency: { type: "score", instructions: "How urgent?", criteria: ["Not", "Soon", "Now"] },
  refund: { type: "noul", instructions: "Asks for a refund?" },
  receipt: { type: "box", instructions: "Where is the total?" },
};

const outcome = (automated, { labeled = 100, gates = { a: 0.5 } } = {}) =>
  ({ gates, labeled, automated, coverage: automated / labeled, accuracy: 0.96, low: 0.9, high: 0.99 });

test("drops the named questions and keeps the others in order", () => {
  const out = withoutQuestions(QUESTIONS, new Set(["urgency", "receipt"]));
  assert.deepEqual(Object.keys(out), ["department", "refund"]);
  assert.equal(out.department, QUESTIONS.department);
  assert.deepEqual(Object.keys(withoutQuestions(QUESTIONS, ["department"])), ["urgency", "refund", "receipt"]);
  assert.deepEqual(Object.keys(QUESTIONS), ["department", "urgency", "refund", "receipt"], "input is not changed");
  assert.deepEqual(Object.keys(withoutQuestions(QUESTIONS, [])), Object.keys(QUESTIONS));
  assert.deepEqual(Object.keys(withoutQuestions(null, ["x"])), []);
});

test("keeps a question whose id is __proto__", () => {
  const questions = JSON.parse('{"__proto__": {"type": "noul", "instructions": "x"}, "team": {"type": "noul", "instructions": "y"}}');
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(withoutQuestions(questions, ["team"])))), ["__proto__"]);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(withoutQuestions(questions, ["__proto__"])))), ["team"]);
});

test("states the change in rows automated against the baseline", () => {
  const base = outcome(60);
  assert.equal(automatedDelta(outcome(48), base), "−12 rows");
  assert.equal(automatedDelta(outcome(59), base), "−1 row");
  assert.equal(automatedDelta(outcome(60), base), "no loss");
  assert.equal(automatedDelta(outcome(63), base), "+3 rows");
});

test("states the change in points automated when the labeled rows differ", () => {
  const base = outcome(60);
  assert.equal(automatedDelta(outcome(66, { labeled: 120 }), base), "−5.0 pts automated");
  assert.equal(automatedDelta(outcome(78, { labeled: 120 }), base), "+5.0 pts automated");
  assert.equal(automatedDelta(outcome(72, { labeled: 120 }), base), "no loss");
});

test("has no change when either side reaches no thresholds", () => {
  assert.equal(automatedDelta(outcome(0, { gates: null }), outcome(60)), null);
  assert.equal(automatedDelta(outcome(60), outcome(0, { gates: null })), null);
  assert.equal(automatedDelta(null, outcome(60)), null);
});

test("a threshold holds back nothing when turning it off automates no fewer rows", () => {
  const base = outcome(60);
  assert.equal(holdsBackNothing({ off: outcome(60) }, base), true);
  assert.equal(holdsBackNothing({ off: outcome(61) }, base), true);
  assert.equal(holdsBackNothing({ off: outcome(59) }, base), false);
  assert.equal(holdsBackNothing({ off: outcome(60, { gates: null }) }, base), false);
  assert.equal(holdsBackNothing({ off: outcome(60) }, outcome(0, { gates: null })), false);
  assert.equal(holdsBackNothing(null, base), false);
});

test("adds up shares of the question text", () => {
  assert.equal(totalShare([{ share: 0.25 }, { share: 0.125 }]), 0.375);
  assert.equal(totalShare([]), 0);
  assert.equal(totalShare([{ share: 0.7 }, { share: 0.6 }]), 1);
});
