import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/counter/counter-examples-more.js";
import { runDiagnostics } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { COUNTER_POLICY, examplesByIndex, sampleCounterExamplesCtx } from "./fixtures/counter.mjs";

const ctx = (overrides) => sampleCounterExamplesCtx(overrides);
const E = examplesByIndex(ctx());                          // the chat follows "Frustration builds" (index 1), handed off
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
  // "order"/"tracking"/"parcel"; "refund"/"order number"; shipping, a person and decaf beans name none. "Orders" and
  // "DELIVERED" count as words; "reorder" and "border" do not.
  mentions_order: { items: [E[1], E[3], E[0], E[2], E[5], odd({ turns: ["My ORDERS were DELIVERED late."] }), odd({ turns: ["Can I reorder at the border?"] })],
    values: [true, true, false, false, false, true, false] },
  expect_sequence: { items: [E[0], E[1], E[2], E[5], BLANK], values: ["reply → close", "reply → reply → handoff", "handoff", "reply → close", null] },

  unknown_action: { ctx: ctx(), hit: odd({ label: "Escalation", turns: ["Hi"], expect: ["escalate"] }), miss: [E[0], E[1], E[2], E[3], E[5]],
    message: /^Turn 1 of Escalation expects “escalate”, which is not one of reply, clarify, close, handoff\.$/ },
  after_handoff: { hit: odd({ label: "Late", turns: ["Hi", "Still there?"], expect: ["handoff", "reply"] }), miss: [E[1], E[2], E[0], BLANK],
    message: /^Late expects a handoff on turn 1 and then 1 more turn; a handoff ends the chat\.$/ },
  duplicate_labels: { hitList: [E[0], E[1], odd({ position: 7, label: " Shipping,  THEN sorted" })], missList: ctx().items(),
    message: /^Examples 1 and 7 share the name “Shipping, then sorted”\.$/ },
  // The default chat's current decisions are reply, clarify, handoff against the expectation reply, reply, handoff.
  departs: { ctx: ctx(), hit: E[1], miss: [E[0], E[2], E[5]],
    message: /^On turn 2 your chat's current decision is clarify; the hand-written expectation is reply \(the default policy is in force\)\.$/ },

  // Example 6 has one string turn (7 is dropped) and two expectations: its "close" gets a row with a blank customer cell.
  turns_csv: { ctx: ctx({ hide: [0, 1, 3] }), filename: "counter-example-turns.csv",
    text: '"example","position","turn","customer","expected"\r\n'
      + '"A person, please","3","1","Please connect me to a human agent.","handoff"\r\n'
      + '"Example 6","6","1","Do you sell decaf beans?","reply"\r\n'
      + '"Example 6","6","2","","close"\r\n',
    excludes: ["Where is my order", "clarify"] },

  start_previous: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.log, [["start", 0]]);
      assert.equal(c.state.sample.label, "Shipping, then sorted");
      assert.match(c.env.toasts[0].message, /^Loaded “Shipping, then sorted”/);
    },
    hidden: () => ctx({ chat: "typed" }) },
  copy_expectations: { ctx: () => ctx(),
    check: (c) => { assert.deepEqual(c.env.copied, ["1. reply\n2. reply\n3. handoff"]); assert.match(c.env.toasts[0].message, /not Jev's answers/); assert.deepEqual(c.log, []); },
    hidden: () => ctx({ chat: "typed" }) },
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
  assert.equal(feature("start_previous").when(ctx({ running: true })), false);
});

test("duplicate_labels lists three examples that share a name in one finding", () => {
  const items = [odd({ position: 1, label: "Refund" }), odd({ position: 4, label: "refund" }), odd({ position: 6, label: "REFUND " }), odd({ position: 2, label: "Other" })];
  const findings = runDiagnostics([["k", feature("duplicate_labels")]], items, ctx());
  assert.deepEqual(findings.map((finding) => finding.message), ["Examples 1, 4 and 6 share the name “Refund”."]);
});

test("odd items give unavailable values, never an exception", () => {
  for (const item of [null, undefined, {}, { turns: "Hi", expect: "reply" }]) {
    for (const fact of pack.features.filter((entry) => entry.kind === "fact")) {
      const value = fact.value(item, ctx());
      assert.ok(value === null || value === false, `${fact.id} gave ${value}`);
    }
  }
  assert.deepEqual(feature("duplicate_labels").check([null, {}, { label: "x" }], ctx()), []);
});

test("start_previous discards a chat that has sent every sample turn of its example", () => {
  const c = ctx({ chat: "shipping" });
  // Every sample turn of example 0 was sent: settled. Previous of index 0 wraps to the last item (index 5).
  assert.equal(feature("start_previous").when(c), true);
  feature("start_previous").run(c);
  assert.deepEqual(c.log, [["start", 5]]);
  assert.equal(c.state.sample.turns[0], "Do you sell decaf beans?");
});
