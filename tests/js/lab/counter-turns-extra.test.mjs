// Tests of the counter-turns-extra pack on tests/js/lab/fixtures/counter.mjs. The default chat ("Frustration builds")
// has three turns: #1 reply (frustration 1.1, top intent 0.82, 1,180 tokens), #2 clarify (3.2, 0.48, 1,236 tokens),
// #3 handoff (3.8, 0.66, 1,302 tokens). "relaxed" re-decides the same turns with streak_turns 3, so #3 is a reply now.
// Expected values are worked out by hand from those numbers and the fixture's messages.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/counter/counter-turns-extra.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { COUNTER_POLICY, REPLY_TEXT, sampleCounterTurnsCtx, turnsByN } from "./fixtures/counter.mjs";

const ctx = (overrides) => sampleCounterTurnsCtx(overrides);
const empty = () => ctx({ chat: "empty" });
const F = turnsByN(ctx());
const R = turnsByN(ctx({ chat: "relaxed" }));
const T = turnsByN(ctx({ chat: "typed" }));
const O = turnsByN(ctx({ chat: "odd" }));
const feature = (id) => pack.features.find((entry) => entry.id === id);
const STREAK = "Frustration stayed above the cut for 2 consecutive turns.";
// Three turns with latencies 100, 100 and 300 ms: the median is 100, so only 300 is more than twice it.
const timed = [100, 100, 300].map((latency, index) => ({
  n: index + 1,
  customer: "Hi",
  meta: { latency_ms: latency },
}));

checkPack(
  pack,
  {
    // "Where is my order?" is 18 characters; turn 3 is 48; the odd chat's "Hello?" is 6.
    message_chars: { items: [F[1], F[3], O[2]], values: [18, 48, 6] },
    question_marks: { items: [F[1], F[2], O[2]], values: [1, 0, 1] },
    input_tokens: { items: [F[1], F[3], O[1]], values: [1180, 1302, null] },
    // 3.2 - 1.1 and 3.8 - 3.2; turn 1 has no turn before it.
    frustration_change: { items: [F[1], F[2], F[3]], values: [null, 2.1, 0.6], ctx: ctx(), tolerance: 1e-9 },
    exclaims: { items: [F[2], F[1]], values: [true, false] },
    capitals: { items: [{ n: 1, customer: "WHERE is my ORDER" }, F[2], F[3]], values: [true, false, false] },
    names_person: { items: [{ n: 1, customer: "Please connect me to a human agent." }, F[1]], values: [true, false] },
    // The relaxed chat's turns were sent under streak_turns 2 and are decided now under 3.
    policy_moved: {
      items: [R[1], R[3], { n: 9, sent_policy: { ...COUNTER_POLICY, streak_turns: 3 } }, { n: 10 }],
      values: [true, true, false, false],
      ctx: ctx({ chat: "relaxed" }),
    },
    template_sent: { items: [F[1], F[2], F[3], O[2]], values: ["order_status", "clarify", "handoff", null] },
    frustration_band: {
      items: [F[1], F[2], T[1], { n: 4, evidence: { frustration: 2 } }, O[1]],
      values: ["mild", "angry", "calm", "frustrated", null],
    },
    bot_reply: { items: [F[2], F[3], O[2]], values: [REPLY_TEXT.clarify, REPLY_TEXT.handoff, ""] },
    reason_now: { items: [F[1], F[3], O[2]], values: ["The intent selects a fixed reply.", STREAK, ""] },

    near_limit: {
      hit: { n: 1, customer: "a".repeat(1801) },
      miss: [F[1], { n: 2, customer: "a".repeat(1800) }],
      ctx: ctx(),
      message: /^1,801 of the 2,000 characters/,
    },
    same_template_run: {
      hitList: [
        { n: 1, sent: { reply: "clarify" } },
        { n: 2, sent: { reply: "clarify" } },
      ],
      missList: [F[1], F[2], F[3], { n: 5, sent: { reply: "handoff" } }],
      message: /^Turns 1 and 2 both got the clarify template\.$/,
    },
    slow_turn: {
      hit: timed[2],
      miss: timed[0],
      ctx: fakeCtx({ items: timed }),
      message: /^Took 300 ms, more than twice this chat's median of 100 ms\.$/,
    },

    mean_frustration: [
      { ctx: ctx(), expect: 8.1 / 3, tolerance: 1e-9, empty: empty() },
      { ctx: ctx({ hide: [3] }), expect: 2.15, tolerance: 1e-9 },
    ],
    reply_share: [
      {
        ctx: ctx(),
        expect: (result) => {
          assert.ok(Math.abs(result.value - 1 / 3) < 1e-12);
          assert.equal(result.detail, "1 of 3");
        },
        empty: empty(),
      },
      { ctx: ctx({ chat: "relaxed" }), expect: 2 / 3 },
    ],
    mean_intent_p: { ctx: ctx(), expect: 1.96 / 3, tolerance: 1e-9, empty: empty() },

    customer_text: {
      ctx: ctx(),
      filename: "counter-customer-messages.txt",
      text: "Turn 1: Where is my order?\nTurn 2: This is ridiculous. I've waited weeks and your tracking is useless!\nTurn 3: I'm furious. Still no parcel and no useful help!\n",
    },
    turns_jsonl: {
      ctx: ctx(),
      filename: "counter-turns.jsonl",
      excludes: ["latency", "cost_usd"],
      check: (out) => {
        const lines = out.text
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(lines.length, 3);
        assert.deepEqual(lines[2].now, { action: "handoff", reply: "handoff", reason: STREAK });
        assert.equal(lines[2].evidence.frustration, 3.8);
        assert.equal(lines[0].customer, "Where is my order?");
      },
    },

    copy_newest_bot: {
      ctx: () => ctx(),
      hidden: empty,
      check: (c) => assert.deepEqual(c.env.copied, [REPLY_TEXT.handoff]),
    },
    explain_newest: {
      ctx: () => ctx(),
      hidden: empty,
      check: (c) => {
        assert.equal(c.env.toasts[0].message, `Turn 3: handoff now (${STREAK}); sent as handoff.`);
        const relaxed = ctx({ chat: "relaxed" });
        feature("explain_newest").run(relaxed);
        assert.equal(
          relaxed.env.toasts[0].message,
          "Turn 3: reply now (The intent selects a fixed reply.); sent as handoff. The current policy decides it differently.",
        );
        const odd = ctx({ chat: "odd" });
        feature("explain_newest").run(odd);
        assert.equal(odd.env.toasts[0].message, "Turn 2: no decision now; no recorded decision when sent.");
      },
    },
    inspect_first: { ctx: () => ctx(), hidden: empty, check: (c) => assert.deepEqual(c.log, [["inspect", 1]]) },
  },
  { ctx: () => ctx() },
);
