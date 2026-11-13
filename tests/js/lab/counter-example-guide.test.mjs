import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/counter/counter-example-guide.js";
import { runMetrics } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { examplesByIndex, sampleCounterExamplesCtx, sampleCounterSetup } from "./fixtures/counter.mjs";

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
  // "How long does shipping to Canada take?" 38; "I'm furious. Still no parcel and no useful help!" 48 is shorter than turn 2's 67;
  // "Please connect me to a human agent." 35; "Do you sell decaf beans?" 24; two emoji are 2 characters (4 UTF-16 units).
  longest_turn: { items: [E[0], E[1], E[2], E[5], odd({ turns: ["😀😀", "a"] }), BLANK], values: [38, 67, 35, 24, 2, null] },
  first_handoff: { items: [E[0], E[1], E[2], E[3]], values: [null, 3, 1, 3] },
  final_expect: { items: [E[0], E[1], E[2], BLANK], values: ["close", "handoff", "handoff", null] },
  // A close anywhere counts, not only at the end.
  expects_close: { items: [E[0], E[5], E[1], odd({ expect: ["close", "reply"] }), BLANK], values: [true, true, false, true, false] },
  active: { items: [E[1], E[0]], values: [true, false] },
  label: { items: [E[0], E[5]], values: ["Shipping, then sorted", "Example 6"] },
  turn_text: { items: [E[0], E[2]], values: ["How long does shipping to Canada take? / Thanks, that answers my question!", "Please connect me to a human agent."] },
  // The shipping chat decided reply, close, exactly as expected; example 1 is not the current chat there.
  on_track: { ctx: shippingCtx, items: [ES[0], ES[1], ES[2]], values: [true, false, false] },

  expect_length: { hit: E[5], miss: [E[0], E[1], E[2], E[3]], message: /^Example 6 has 1 turn but 2 expectations\.$/ },
  server_limits: { hit: [odd({ label: "Marathon", turns: Array.from({ length: 21 }, (_, i) => `Question ${i + 1}?`) }),
    odd({ label: "Essay", turns: ["x".repeat(2001)] }), odd({ label: "Gap", turns: ["Hello?", "   "] })],
  // The server counts characters as Python's len() does: 2,000 emoji are 2,000 characters (4,000 UTF-16 units) and pass.
  miss: [E[0], E[3], odd({ label: "Exactly", turns: ["y".repeat(2000)] }), odd({ label: "Emoji", turns: ["😀".repeat(2000)] }),
    odd({ label: "Twenty", turns: Array.from({ length: 20 }, (_, i) => `Question ${i + 1}?`) })],
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
  assert.deepEqual(rows.map((row) => row.value), [null, null]);
});

test("start_next wraps from the last example to the first, skipping the setup's null entry", () => {
  const last = ctx({ chat: "empty", sample: sampleCounterSetup().examples[5] });
  assert.equal(last.data.chat.index, 5);
  feature("start_next").run(last);
  assert.deepEqual(last.log, [["start", 0]]);
});

test("server_limits names each refused turn, and expect_length counts turns and expectations", () => {
  const check = feature("server_limits").check;
  assert.deepEqual(check(odd({ label: "Gap", turns: ["   ", "ok", "z".repeat(2001)] })),
    ["Turn 1 of Gap is blank.", "Turn 3 of Gap is longer than 2,000 characters."]);
  assert.equal(feature("expect_length").check(odd({ label: "Two", turns: ["a", "b"], expect: ["reply"] })), "Two has 2 turns but 1 expectation.");
});
