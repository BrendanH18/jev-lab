import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/counter/counter-examples-more.js";
import { runDiagnostics } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { COUNTER_POLICY, examplesByIndex, sampleCounterExamplesCtx } from "./fixtures/counter.mjs";

const ctx = (overrides) => sampleCounterExamplesCtx(overrides);
const E = examplesByIndex(ctx());                          // the chat follows "Frustration builds" (index 1), handed off
const EE = examplesByIndex(ctx({ chat: "empty" }));        // "Shipping, then sorted" (index 0) loaded, nothing sent
const BLANK = { index: 9, position: 10, label: "Blank", turns: [], expect: [], active: false, sent: 0, following: false };
const odd = (fields) => ({ ...BLANK, ...fields });
const feature = (id) => pack.features.find((entry) => entry.id === id);

checkPack(pack, {
  // "How long does shipping to Canada take?"; "Where is my order?"; none in "A person, please"; "Do you sell decaf beans?".
  question_marks: { items: [E[0], E[1], E[2], E[5], BLANK], values: [1, 1, 0, 1, null] },
  // "...answers my question!"; "...tracking is useless!" and "...no useful help!"; none in the others.
  exclamation_marks: { items: [E[0], E[1], E[2], E[3], BLANK], values: [1, 2, 0, 0, null] },
  // reply, close; reply, reply, handoff; handoff; reply, reply, handoff; reply, close (odd example).
  expected_replies: { items: [E[0], E[1], E[2], E[3], E[5], BLANK], values: [1, 2, 0, 2, 1, null] },
  // The empty chat has example 0 loaded with nothing sent (2 left); the default chat sent all 3 turns of example 1.
  turns_left: { items: [EE[0], E[1], E[0]], values: [2, 0, null] },
  // "order"/"tracking"/"parcel"; "refund"/"order number"; shipping, a person and decaf beans name none.
  mentions_order: { items: [E[1], E[3], E[0], E[2], E[5]], values: [true, true, false, false, false] },
  expect_sequence: { items: [E[0], E[1], E[2], E[5], BLANK], values: ["reply → close", "reply → reply → handoff", "handoff", "reply → close", null] },

  unknown_action: { ctx: ctx(), hit: odd({ label: "Escalation", turns: ["Hi"], expect: ["escalate"] }), miss: [E[0], E[1], E[2], E[3], E[5]],
    message: /^Turn 1 of Escalation expects “escalate”, which is not one of reply, clarify, close, handoff\.$/ },
  after_handoff: { hit: odd({ label: "Late", turns: ["Hi", "Still there?"], expect: ["handoff", "reply"] }), miss: [E[1], E[2], E[0], BLANK],
    message: /^Late expects a handoff on turn 1 and then 1 more turn; a handoff ends the chat\.$/ },
  duplicate_labels: { hitList: [E[0], E[1], odd({ position: 7, label: " Shipping, THEN sorted" })], missList: ctx().items(),
    message: /^Examples 1 and 7 are both named “shipping, then sorted”\.$/ },
  // The default chat's current decisions are reply, clarify, handoff against the expectation reply, reply, handoff.
  departs: { ctx: ctx(), hit: E[1], miss: [E[0], E[2], E[5]],
    message: /^On turn 2 your chat's current decision is clarify; the hand-written expectation is reply \(the default policy is in force\)\.$/ },

  turns_csv: { ctx: ctx({ hide: [0, 1, 3] }), filename: "counter-example-turns.csv",
    text: '"example","position","turn","customer","expected"\r\n'
      + '"A person, please","3","1","Please connect me to a human agent.","handoff"\r\n'
      + '"Example 6","6","1","Do you sell decaf beans?","reply"\r\n' },
  checklist_md: { ctx: ctx({ hide: [1, 2, 3, 5] }), filename: "counter-example-checklist.md",
    text: "# Counter example checklist\n\nExpectations are hand-written for the default policy; tick a turn when your chat's decision matches.\n\n"
      + "## Shipping, then sorted\n\n- [ ] Turn 1: How long does shipping to Canada take? (expect reply)\n- [ ] Turn 2: Thanks, that answers my question! (expect close)\n" },

  start_previous: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.log, [["start", 0]]);
      assert.equal(c.state.sample.label, "Shipping, then sorted");
      assert.match(c.env.toasts[0].message, /^Loaded “Shipping, then sorted”/);
    },
    hidden: () => ctx({ chat: "typed" }) },
  new_chat: { ctx: () => ctx({ chat: "shipping" }),
    check: (c) => { assert.deepEqual(c.log, [["newChat"]]); assert.equal(c.state.sample, null); assert.equal(c.state.turns.length, 0); },
    hidden: () => ctx({ chat: "typed" }) },
  copy_expectations: { ctx: () => ctx(),
    check: (c) => { assert.deepEqual(c.env.copied, ["1. reply\n2. reply\n3. handoff"]); assert.match(c.env.toasts[0].message, /not Jev's answers/); assert.deepEqual(c.log, []); },
    hidden: () => ctx({ chat: "typed" }) },
  copy_next_turn: { ctx: () => ctx({ chat: "empty" }),
    check: (c) => { assert.deepEqual(c.env.copied, ["How long does shipping to Canada take?"]); assert.match(c.env.toasts[0].message, /Nothing was sent/); assert.deepEqual(c.log, []); },
    hidden: () => ctx({ chat: "shipping" }) },
}, { ctx: () => ctx() });

test("departs stays quiet when the chat agrees and names a changed policy", () => {
  const shipping = ctx({ chat: "shipping" });
  assert.deepEqual(runDiagnostics([["k", feature("departs")]], shipping.items(), shipping), []);
  // A typed chat follows no example: nothing to compare.
  const typed = ctx({ chat: "typed" });
  assert.deepEqual(runDiagnostics([["k", feature("departs")]], typed.items(), typed), []);
  const relaxed = ctx({ chat: "relaxed" });
  const findings = runDiagnostics([["k", feature("departs")]], relaxed.items(), relaxed);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /^On turn 2 .*\(the policy differs from the defaults the expectation was written for\)\.$/);
  assert.equal(COUNTER_POLICY.streak_turns, 2);
});

test("start_previous wraps from the first example to the last and starts without discarding an empty chat", () => {
  const c = ctx({ chat: "empty" });
  feature("start_previous").run(c);
  assert.deepEqual(c.log, [["start", 5]]);
  const blank = ctx({ sample: null, turns: [], transcript: [], decisions: [] });
  assert.equal(feature("new_chat").when(blank), false, "a new chat with nothing in it has nothing to clear");
  assert.equal(feature("start_previous").when(ctx({ running: true })), false);
});
