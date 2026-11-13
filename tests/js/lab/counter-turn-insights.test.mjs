import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/counter/counter-turn-insights.js";
import { runDiagnostics, runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { COUNTER_POLICY, REPLY_TEXT, sampleCounterTurnsCtx, turnsByN } from "./fixtures/counter.mjs";

const ctx = (overrides) => sampleCounterTurnsCtx(overrides);
const F = turnsByN(ctx());                       // "Frustration builds": reply, clarify, handoff
const R = turnsByN(ctx({ chat: "relaxed" }));    // the same turns with streak_turns 3: turn 3 now a reply
const S = turnsByN(ctx({ chat: "shipping" }));   // reply, close
const T = turnsByN(ctx({ chat: "typed" }));      // one "other" turn: clarify
const oddCtx = ctx({ chat: "odd" });
const O = turnsByN(oddCtx);                      // turn 1 tied intents and odd values; turn 2 nothing usable
const empty = () => ctx({ chat: "empty" });
const feature = (id) => pack.features.find((entry) => entry.id === id);

checkPack(pack, {
  frustration: { items: [F[1], F[2], F[3], O[1]], values: [1.1, 3.2, 3.8, null] },
  // Odd turn 1 sends asks_for_person as the text "0.3".
  person_p: { items: [F[1], F[3], O[1]], values: [0.04, 0.41, null] },
  missed_p: { items: [F[2], F[3], O[2]], values: [0.35, 0.62, null] },
  resolved_p: { items: [F[1], S[2], O[2]], values: [0.03, 0.93, null] },
  intent_p: { items: [F[1], F[2], O[2]], values: [0.82, 0.48, null] },
  // 0.82 - 0.12, 0.48 - 0.40, 0.66 - 0.20, a tie at 0.40, and no intents at all.
  intent_margin: { items: [F[1], F[2], F[3], O[1], O[2]], values: [0.7, 0.08, 0.46, 0, null], tolerance: 1e-9 },
  // Odd turn 1 has a NaN latency and a cost sent as text.
  latency: { items: [F[1], F[2], O[1]], values: [412.3, 388, null] },
  cost: { items: [F[1], F[3], O[1], O[2]], values: [0.000071, 0.000077, null, null] },
  // "Where is my order?" 4; "This is ridiculous. I've waited weeks and your tracking is useless!" 11; "I'm furious. Still no
  // parcel and no useful help!" 9; "Hello?" 1.
  message_words: { items: [F[1], F[2], F[3], O[2]], values: [4, 11, 9, 1] },
  changed: { items: [R[3], R[1], F[3]], values: [true, false, false] },
  // Turn 2 chose return_policy while order_status had the highest probability; odd turn 1 chose order_status in a tie
  // that the first intent in order (brewing_guide) wins.
  choice_differs: { items: [F[2], F[1], O[1], O[2]], values: [true, false, true, false] },
  // Default cuts: person 0.5, missed 0.5, resolved 0.7, intent 0.6, frustration 2.5. Odd turn 1: missed 0.5 sits exactly on
  // its cut. F3's nearest is intent 0.66 against 0.6 (0.06 away). 0.45 and 0.55 are both exactly 0.05 from 0.5 and must
  // read alike although binary floats put them at 0.04999… and 0.05000…; 2.7 is exactly 0.2 above 2.5, 2.71 is 0.21.
  near_cut: { ctx: oddCtx, items: [O[1], F[1], F[3], { evidence: { missed: 0.45 } }, { evidence: { missed: 0.55 } }, { evidence: { asks_for_person: 0.56 } },
    { evidence: { frustration: 2.7 } }, { evidence: { frustration: 2.71 } }, { evidence: { intent_prob: 0.65 } }, { evidence: { resolved: 0.64 } }, {}],
  values: [true, false, false, true, true, false, true, false, true, false, false] },
  action_now: { items: [F[1], F[2], F[3], R[3], O[2]], values: ["reply", "clarify", "handoff", "reply", null] },
  action_sent: { items: [R[3], R[1], O[2]], values: ["handoff", "reply", null] },
  intent: { items: [F[1], S[1], T[1], O[1], O[2]], values: ["order status", "shipping times", "other", "brewing guide", null] },
  message: { items: [F[1], O[2]], values: ["Where is my order?", "Hello?"] },

  // 0.5 against 0.4 is exactly 10 points (0.09999… in binary floats) and must not count; 0.5 against 0.41 is 9 points.
  close_intents: { hit: [F[2], O[1], { intents: { order_status: 0.5, return_policy: 0.41 } }],
    miss: [F[1], F[3], O[2], { intents: { order_status: 0.5, return_policy: 0.4 } }, { intents: { order_status: 1 } }, {}],
    message: /\(\d+\.\d%\) and .+ \(\d+\.\d%\) are less than 10 points apart/ },
  frustration_rising: { hitList: ctx().items(), missList: ctx({ chat: "shipping" }).items(),
    message: /^Frustration rose on every turn from turn 1 to turn 3 \(1\.1 to 3\.8 of 4\)\.$/ },

  peak_frustration: [{ ctx: ctx(), expect: 3.8, empty: empty() }, { ctx: ctx({ hide: [3] }), expect: 3.2 }],
  changed_count: [{ ctx: ctx(), expect: 0, empty: empty() },
    { ctx: ctx({ chat: "relaxed", hide: [1, 2, 3] }), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "of 3 turns"); } }],
  // 388, 412.3, 451.7; without turn 1 the middle of 388 and 451.7.
  median_latency: [{ ctx: ctx(), expect: 412.3, empty: empty() }, { ctx: ctx({ hide: [1] }), expect: 419.85, tolerance: 1e-9 }],
  // (71 + 74 + 77) millionths over 3 calls, times 3 turns, times 1,000 = 0.222; shipping (68 + 70) millionths -> 0.138.
  thousand_chats: [{ ctx: ctx(), expect: (result) => { assert.ok(Math.abs(result.value - 0.222) < 1e-12); assert.equal(result.detail, "estimate from 3 measured calls"); }, empty: empty() },
    { ctx: ctx({ chat: "shipping", hide: [1] }), expect: 0.138, tolerance: 1e-9 }, { ctx: oddCtx, expect: null }],

  transcript_md: { ctx: ctx({ chat: "shipping" }), filename: "counter-chat.md",
    text: "# Counter chat · Shipping, then sorted\n\n"
      + `## Turn 1\n\n**Customer:** How long does shipping to Canada take?\n\n**Bot (sent as reply):** ${REPLY_TEXT.shipping_times}\n\nCurrent policy: reply · The intent selects a fixed reply.\n\n`
      + `## Turn 2\n\n**Customer:** Thanks, that answers my question!\n\n**Bot (sent as close):** ${REPLY_TEXT.close}\n\nCurrent policy: close · The customer's need is met.\n` },
  judgments_csv: { ctx: ctx({ chat: "typed" }), filename: "counter-judgments.csv",
    text: '"turn","customer","intent","intent_p","frustration","asks_for_person","missed","resolved","sent_action","current_action","latency_ms","cost_usd"\r\n'
      + '"1","Do you host latte art classes at the Pier Street café?","other","0.77","0.6","0.08","0.04","0.02","clarify","clarify","395.5","0.000069"\r\n' },
  policy_json: { ctx: ctx({ chat: "relaxed" }), filename: "counter-policy.json", includes: ['"streak_turns": 3', '"defaults": {', '"streak_turns": 2'],
    excludes: ["Where is my order?", "order_status"] },

  inspect_newest: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["inspect", 3]]), hidden: empty },
  restore_sent_policy: { ctx: () => ctx({ chat: "relaxed" }),
    check: (c) => {
      assert.deepEqual(c.log, [["setPolicy", { ...COUNTER_POLICY }]]);
      assert.equal(c.state.policy.streak_turns, 2);
      assert.match(c.env.toasts[0].message, /turn 3 was sent under/);
    },
    hidden: () => ctx() },
  draft_next_sample: { ctx: () => ctx({ chat: "odd" }),
    check: (c) => {
      assert.deepEqual(c.log, [["setDraft", "You missed my point again. I already did that and still need my refund."]]);
      assert.match(c.env.toasts[0].message, /Nothing was sent/);
    },
    hidden: () => ctx() },
}, { ctx: () => ctx() });

test("close_intents names both intents with their probabilities", () => {
  const [finding] = runDiagnostics([["k", feature("close_intents")]], [F[2]], ctx());
  assert.match(finding.message, /^The top intents order status \(48\.0%\) and return policy \(40\.0%\) are less than 10 points apart/);
});

test("frustration_rising needs consecutive turn numbers and reports every run", () => {
  // Frustration in the long chat cycles 0, 0.1, 0.2, 0.3: five runs of four turns.
  const long = runDiagnostics([["k", feature("frustration_rising")]], ctx({ chat: "long" }).items(), ctx());
  assert.equal(long.length, 5);
  assert.match(long[4].message, /from turn 17 to turn 20 \(0\.0 to 0\.3 of 4\)/);
  // With turn 2 hidden, turns 1 and 3 are no longer neighbors.
  assert.deepEqual(runDiagnostics([["k", feature("frustration_rising")]], ctx({ hide: [2] }).shown(), ctx()), []);
});

test("the transcript of a typed chat has no sample heading and no probabilities; an empty chat refuses", () => {
  const out = runExporter(feature("transcript_md"), ctx({ chat: "typed" }));
  assert.ok(out.text.startsWith("# Counter chat\n\n## Turn 1\n"));
  assert.ok(!out.text.includes("0.77"));
  assert.throws(() => runExporter(feature("transcript_md"), empty()), /no turn to export/);
  assert.throws(() => runExporter(feature("policy_json"), ctx({ setup: null })), /not loaded/);
});

test("draft_next_sample refuses to overwrite a typed draft, and the policy command is hidden without a recorded policy", () => {
  const c = ctx({ chat: "odd", draft: "my own words" });
  assert.throws(() => feature("draft_next_sample").run(c), /already holds text/);
  assert.deepEqual(c.log, []);
  assert.equal(feature("restore_sent_policy").when(empty()), false);
  assert.equal(feature("draft_next_sample").when(ctx({ chat: "odd", running: true })), false);
});

test("near_cut has no policy to compare with before the setup loads, and frustration_rising skips odd items", () => {
  assert.equal(feature("near_cut").value(F[3], { data: {} }), false);
  assert.equal(feature("near_cut").value({ evidence: { missed: 0.5 } }, { data: { policy: { missed_at: 0.5 } } }), true);
  const items = [null, { n: "2" }, ...ctx().items()];
  const found = runDiagnostics([["k", feature("frustration_rising")]], items, ctx());
  assert.equal(found.length, 1);
  assert.match(found[0].message, /turn 1 to turn 3/);
});

test("inspect_newest picks the highest turn number even when the list order differs", () => {
  const c = ctx({ chat: "shipping" });
  const reversed = { ...c, items: () => c.items().slice().reverse() };
  feature("inspect_newest").run(reversed);
  assert.deepEqual(c.log, [["inspect", 2]]);
});
