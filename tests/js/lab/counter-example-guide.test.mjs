import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/counter/counter-example-guide.js";
import { runMetrics } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { examplesByIndex, sampleCounterExamplesCtx } from "./fixtures/counter.mjs";

const ctx = (overrides) => sampleCounterExamplesCtx(overrides);
const E = examplesByIndex(ctx());                          // the chat follows "Frustration builds" (index 1), handed off
const shippingCtx = ctx({ chat: "shipping" });
const ES = examplesByIndex(shippingCtx);                   // the chat followed "Shipping, then sorted" (index 0) to its end
const BLANK = { index: 9, position: 10, label: "Blank", turns: [], expect: [], active: false, sent: 0, following: false };
const odd = (fields) => ({ ...BLANK, ...fields });
const feature = (id) => pack.features.find((entry) => entry.id === id);

checkPack(pack, {
  turn_count: { items: [E[0], E[1], E[2], BLANK], values: [2, 3, 1, null] },
  // 7 + 5; 4 + 11 + 9; 8 + 13 + 14; "Do you sell decaf beans?" 5 (the non-string turn is left out by the builder).
  word_count: { items: [E[0], E[1], E[3], E[5], BLANK], values: [12, 24, 35, 5, null] },
  // "How long does shipping to Canada take?" 38; "Please connect me to a human agent." 35; "Do you sell decaf beans?" 24.
  longest_turn: { items: [E[0], E[2], E[5], BLANK], values: [38, 35, 24, null] },
  first_handoff: { items: [E[0], E[1], E[2], E[3]], values: [null, 3, 1, 3] },
  sent: { items: [ES[0], E[1], E[2]], values: [2, 3, null] },
  final_expect: { items: [E[0], E[1], E[2], BLANK], values: ["close", "handoff", "handoff", null] },
  ends_in_handoff: { items: [E[1], E[0], E[5], BLANK], values: [true, false, false, false] },
  expects_close: { items: [E[0], E[5], E[1]], values: [true, true, false] },
  active: { items: [E[1], E[0]], values: [true, false] },
  label: { items: [E[0], E[5]], values: ["Shipping, then sorted", "Example 6"] },
  turn_text: { items: [E[0], E[2]], values: ["How long does shipping to Canada take? / Thanks, that answers my question!", "Please connect me to a human agent."] },
  // The shipping chat decided reply, close, exactly as expected; example 1 is not the current chat there.
  on_track: { ctx: shippingCtx, items: [ES[0], ES[1]], values: [true, false] },

  expect_length: { hit: E[5], miss: [E[0], E[1], E[2], E[3]], message: /^Example 6 has 1 turn but 2 expectations\.$/ },
  server_limits: { hit: [odd({ label: "Marathon", turns: Array.from({ length: 21 }, (_, i) => `Question ${i + 1}?`) }),
    odd({ label: "Essay", turns: ["x".repeat(2001)] }), odd({ label: "Gap", turns: ["Hello?", "   "] })],
  miss: [E[0], E[3], odd({ label: "Exactly", turns: ["y".repeat(2000)] })],
  message: /a chat holds at most 20\.$|longer than 2,000 characters\.$|is blank\.$/ },
  duplicate_turns: { hitList: [E[0], odd({ label: "Thanks again", turns: ["  Thanks, that answers my question!"] })], missList: ctx().items(),
    message: /^“thanks, that answers my question!” appears in Shipping, then sorted and Thanks again\.$/ },

  // 2 + 3 + 1 + 3 + 1; without indexes 1 and 3, 2 + 1 + 1.
  calls_to_run_all: [{ ctx: ctx(), expect: 10, empty: ctx({ setup: null }) }, { ctx: ctx({ hide: [1, 3] }), expect: 4 }],
  // Frustration builds: decided reply, clarify, handoff against reply, reply, handoff.
  expectation_agreement: [
    { ctx: ctx(), expect: (result) => { assert.ok(Math.abs(result.value - 2 / 3) < 1e-12); assert.equal(result.detail, "2 of 3 sent turns; default policy in force"); },
      empty: ctx({ chat: "empty" }) },
    { ctx: ctx({ chat: "relaxed" }), expect: (result) => { assert.ok(Math.abs(result.value - 1 / 3) < 1e-12); assert.match(result.detail, /policy changed from the defaults$/); } },
    { ctx: shippingCtx, expect: 1 },
    { ctx: ctx({ chat: "typed" }), expect: null },
    { ctx: ctx({ chat: "odd" }), expect: null }],
  // Indexes 1, 2 and 3 end in a handoff: 3 of 5, and 3 of 4 without the odd example.
  handoff_share: [{ ctx: ctx(), expect: 0.6, empty: ctx({ setup: null }) }, { ctx: ctx({ hide: [5] }), expect: 0.75 }],

  examples_md: { ctx: ctx({ hide: [1, 2, 3, 5] }), filename: "counter-examples.md",
    text: "# Counter example conversations\n\nBuilt-in customer turns and the hand-written expectation of each for the default policy; no answers.\n\n"
      + "## Shipping, then sorted\n\n1. How long does shipping to Canada take? (expected: reply)\n2. Thanks, that answers my question! (expected: close)\n" },
  examples_jsonl: { ctx: ctx({ hide: [0, 1, 3, 5] }), filename: "counter-examples.jsonl",
    text: '{"label":"A person, please","turns":["Please connect me to a human agent."],"expect":["handoff"]}\n' },

  start_next: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.log, [["start", 2]]);
      assert.equal(c.state.sample.label, "A person, please");
      assert.match(c.env.toasts[0].message, /Loaded “A person, please”/);
    },
    hidden: () => ctx({ chat: "typed" }) },
  restart_active: { ctx: () => ctx({ chat: "shipping" }), check: (c) => assert.deepEqual(c.log, [["start", 0]]), hidden: () => ctx({ chat: "odd" }) },
  copy_turns: { ctx: () => ctx(),
    check: (c) => assert.deepEqual(c.env.copied, ["1. Where is my order?\n2. This is ridiculous. I've waited weeks and your tracking is useless!\n3. I'm furious. Still no parcel and no useful help!"]),
    hidden: () => ctx({ chat: "typed" }) },
}, { ctx: () => ctx() });

test("on_track is false for the active example when a decision differs from its expectation", () => {
  assert.equal(feature("on_track").value(E[1], ctx()), false);
});

test("start_next starts the first example after a chat with no sample and needs no discard for an empty chat", () => {
  const long = ctx({ chat: "long" });
  feature("start_next").run(long);
  assert.deepEqual(long.log, [["start", 0]]);
  const fresh = ctx({ chat: "empty" });
  feature("start_next").run(fresh);
  assert.deepEqual(fresh.log, [["start", 1]]);
  assert.equal(feature("start_next").when(ctx({ running: true })), false);
  assert.equal(feature("start_next").when(ctx({ setup: null })), false);
});

test("metrics stay unavailable before the setup loads", () => {
  const rows = runMetrics(pack.features.filter((entry) => entry.kind === "metric").map((entry) => [entry.id, entry]), ctx({ setup: null }));
  assert.deepEqual(rows.map((row) => row.value), [null, null, null]);
});
