import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/counter/counter-turns-more.js";
import { factValue, runDiagnostics, runExporter, runMetrics } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { COUNTER_POLICY, sampleCounterChats, sampleCounterTurnsCtx, turnsByN } from "./fixtures/counter.mjs";

const ctx = (overrides) => sampleCounterTurnsCtx(overrides);
const F = turnsByN(ctx());                       // "Frustration builds": reply, clarify, handoff
const S = turnsByN(ctx({ chat: "shipping" }));   // reply, close
const T = turnsByN(ctx({ chat: "typed" }));      // one "other" turn: clarify
const oddCtx = ctx({ chat: "odd" });
const O = turnsByN(oddCtx);                      // turn 1 tied intents and odd values; turn 2 nothing usable
const empty = () => ctx({ chat: "empty" });
const feature = (id) => pack.features.find((entry) => entry.id === id);

// A chat put together from fixture turns ([chat name, 0-based turn] or a raw turn with its texts), with no sample.
// Each turn keeps its own answers and its current decision from the source chat.
function mixed(parts) {
  const chats = sampleCounterChats();
  const turns = parts.map((part) => {
    if (!Array.isArray(part)) return part;
    const [name, i] = part;
    const source = chats[name];
    return { raw: source.turns[i], customer: source.transcript[i * 2].text, bot: source.transcript[i * 2 + 1].text, now: source.decisions[i] };
  });
  return ctx({ sample: null, turns: turns.map((turn) => turn.raw), decisions: turns.map((turn) => turn.now),
    transcript: turns.flatMap((turn) => [{ speaker: "customer", text: turn.customer }, { speaker: "bot", text: turn.bot }]) });
}

// Turn 3 of "Frustration builds" with P(resolved) raised to 0.8: decide() still hands off on the frustration streak,
// which runs before the resolved rule.
function resolvedHandoff() {
  const source = sampleCounterChats().frustration;
  const raw = JSON.parse(JSON.stringify(source.turns[2]));
  raw.answers.resolved.noul = 0.8;
  return { raw, customer: source.transcript[4].text, bot: source.transcript[5].text, now: source.decisions[2] };
}
const H = turnsByN(mixed([["frustration", 0], ["frustration", 1], resolvedHandoff()]));

const switchCtx = mixed([["shipping", 0], ["frustration", 0], ["frustration", 1]]);
const SW = turnsByN(switchCtx);                  // top intents shipping_times, order_status, order_status
const strictPerson = ctx({ decidedWith: { ...COUNTER_POLICY, person_at: 0.3 } });
const at = (field, value) => ({ ...F[1], evidence: { ...F[1].evidence, [field]: value } });
const reason = (text) => ({ ...F[1], decision: { ...F[1].decision, reason: text } });
// A hand-made item whose whole intent mass is on one intent.
const ONLY = { ...F[1], intents: { shipping_times: 0, order_status: 1, other: 0 }, evidence: { ...F[1].evidence, intent: "order_status", intent_prob: 1 } };

checkPack(pack, {
  // Cuts of the default policy: person_at 0.5, missed_at 0.5, resolved_at 0.7, intent_min 0.6 (decide() compares with
  // >= for the first three and < for intent_min). person_over reads the policy the decisions used (person_at 0.3 here),
  // not the sliders (0.5): 0.04 < 0.3, 0.41 >= 0.3, 0.18 < 0.3; odd turn 2 has no answer.
  person_over: { ctx: strictPerson, items: [F[1], F[3], F[2], O[2]], values: [false, true, false, false] },
  // 0.35 < 0.5, 0.62 >= 0.5, odd turn 1 exactly on the cut (0.5 >= 0.5), no answer.
  missed_over: { ctx: ctx(), items: [F[2], F[3], O[1], O[2]], values: [false, true, true, false] },
  // 0.03 < 0.7, 0.93 >= 0.7, 0.12 < 0.7, no answer.
  resolved_over: { ctx: ctx(), items: [F[1], S[2], S[1], O[2], at("resolved", 0.7)], values: [false, true, false, false, true] },
  // 0.82 and 0.66 are not below 0.6; 0.48 and odd turn 1's 0.4 are; "other" at 0.77 is not (that clarify comes from the
  // no-template part of the rule, not the cut); no answer; exactly on the cut is not below it.
  intent_under: { ctx: ctx(), items: [F[1], F[3], F[2], O[1], T[1], O[2], at("intent_prob", 0.6)], values: [false, false, true, true, false, false, false] },
  streak: { items: [F[1], F[2], F[3], O[2]], values: [0, 1, 2, null] },
  misses: { items: [F[2], F[3], O[1], O[2]], values: [0, 1, 1, null] },
  // Entropies computed separately in Python with math.log2 over the fixture's probabilities (the rest of the mass shared
  // equally by the unnamed intents): F1 0.82, 0.12, 5 x 0.012; F2 0.48, 0.40, 5 x 0.024; S1 0.91, 6 x 0.015;
  // odd turn 1 0.4, 0.4, 4 x 0.05, 0 = 0.2·log2(20) + 0.8·log2(2.5).
  intent_entropy: { items: [F[1], F[2], S[1], O[1], O[2]], values: [0.9846859815513298, 1.6827388227735696, 0.669116442129007, 1.9219280948873623, null], tolerance: 1e-9 },
  // Odd turn 1 ties brewing_guide and order_status at 0.4: the first is the top intent, so the second is the runner-up.
  // S1's six other intents tie at 0.015: the first of them in question order wins. A turn whose other intents all have
  // probability 0 has no runner-up.
  runner_up: { items: [F[1], F[2], T[1], S[1], O[1], O[2], ONLY], values: ["shipping times", "return policy", "wholesale pricing", "return policy", "order status", null, null] },
  intent_switched: { ctx: switchCtx, items: [SW[1], SW[2], SW[3]], values: [false, true, false] },
  // The reason sentences of jev/counter.py decide(), one per rule; an unknown sentence groups as "other".
  rule: { items: [F[1], F[2], F[3], S[2], O[2], reason("The customer asks for a person."), reason("The bot missed the point 2 times."),
    reason("Already handed to a person."), reason("Some future rule.")],
  values: ["template reply", "uncertain intent", "frustration streak", "resolved", null, "asks for a person", "missed turns", "already handed off", "other"] },

  repeated_message: { hitList: mixed([["frustration", 0], ["shipping", 0], ["frustration", 0]]).items(), missList: ctx().items(),
    message: /^Turn 3 repeats the customer's message of turn 1\.$/ },
  clarify_run: { hitList: mixed([["frustration", 0], ["frustration", 1], ["typed", 0]]).items(), missList: ctx().items(),
    message: /^Turns 2 to 3 all ask the customer to clarify under the current policy \(2 in a row\)\.$/ },
  resolved_not_closed: { ctx: ctx(), hit: H[3], miss: [S[2], F[1], O[2]],
    message: /^P\(resolved\) 0\.80 is at or above the close cut 0\.70, but the current decision is handoff: Frustration stayed above the cut for 2 consecutive turns\.$/ },

  // 1180 + 1236 + 1302; without turn 3, 1180 + 1236. Odd: 1000.5 is not a token count and turn 2 has none.
  input_tokens: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 3718); assert.equal(result.detail, "3 measured calls of 3 shown turns"); }, empty: empty() },
    { ctx: ctx({ hide: [3] }), expect: 2416 }, { ctx: oddCtx, expect: null }],
  // Points (1, 1.1), (2, 3.2), (3, 3.8): Sxy = 2.7, Sxx = 2, slope 27/20 (exact fractions). Shipping (1, 0.2), (2, 0): -0.2.
  frustration_slope: [{ ctx: ctx(), expect: 1.35, tolerance: 1e-9, empty: empty() }, { ctx: ctx({ chat: "shipping" }), expect: -0.2, tolerance: 1e-9 },
    { ctx: ctx({ chat: "typed" }), expect: null }],

  decisions_csv: { ctx: ctx({ chat: "relaxed", hide: [1, 2] }), filename: "counter-decisions.csv",
    text: '"turn","sent_action","sent_reply","sent_reason","current_action","current_reply","current_reason","streak","misses","changed"\r\n'
      + '"3","handoff","handoff","Frustration stayed above the cut for 2 consecutive turns.","reply","order_status","The intent selects a fixed reply.","2","1","yes"\r\n',
    excludes: ["furious", "0.66"] },
  // T1: other 0.77, wholesale_pricing 0.1, and 0.13 shared by the five others (0.026 each).
  intents_csv: { ctx: ctx({ chat: "typed" }), filename: "counter-intents.csv",
    text: '"turn","model_choice","shipping_times","return_policy","wholesale_pricing","subscription_help","brewing_guide","order_status","other"\r\n'
      + '"1","other","0.026","0.026","0.1","0.026","0.026","0.026","0.77"\r\n',
    excludes: ["latte"] },
}, { ctx: () => ctx() });

test("cut comparisons fall back to the sliders before any decision and are off without a policy", () => {
  const before = ctx({ decidedWith: null, policy: { ...COUNTER_POLICY, intent_min: 0.85 } });
  // decided_with is null, so the sliders' intent_min 0.85 applies: 0.82 < 0.85. Under the default 0.6 it is not below.
  assert.equal(before.data.decided_with, null);
  assert.equal(factValue(feature("intent_under"), F[1], before), true);
  assert.equal(factValue(feature("intent_under"), F[1], ctx()), false);
  // decided_with wins over the sliders when both exist: sliders at 0.85, decisions made with 0.6.
  assert.equal(factValue(feature("intent_under"), F[1], ctx({ policy: { ...COUNTER_POLICY, intent_min: 0.85 } })), false);
  assert.equal(factValue(feature("missed_over"), F[3], ctx({ setup: null, decidedWith: null })), false);
});

test("clarify_run and repeated_message only look at the turns they are given, in turn order", () => {
  const c = mixed([["frustration", 0], ["frustration", 1], ["typed", 0]]);
  const shownWithoutTwo = c.items().filter((item) => item.n !== 2);
  assert.deepEqual(runDiagnostics([["k", feature("clarify_run")]], shownWithoutTwo, c), []);
  const repeat = mixed([["frustration", 0], ["shipping", 0], ["frustration", 0]]).items();
  const findings = runDiagnostics([["k", feature("repeated_message")]], repeat.slice().reverse(), c);
  assert.deepEqual(findings.map((finding) => finding.message), ["Turn 3 repeats the customer's message of turn 1."]);
});

test("the exports of an empty chat hold only their header rows", () => {
  assert.equal(runExporter(feature("decisions_csv"), empty()).text.split("\r\n").filter(Boolean).length, 1);
  assert.equal(runExporter(feature("intents_csv"), empty()).text.split("\r\n").filter(Boolean).length, 1);
});

test("repeated_message ignores case and spacing but not wording", () => {
  const base = sampleCounterChats().frustration;
  const texts = ["Where is my order?", "  where IS my   order? ", "Where is my order now?"];
  const c = ctx({ sample: null, turns: base.turns, decisions: base.decisions,
    transcript: texts.flatMap((text) => [{ speaker: "customer", text }, { speaker: "bot", text: "" }]) });
  const findings = runDiagnostics([["k", feature("repeated_message")]], c.items(), c);
  assert.deepEqual(findings.map((finding) => finding.message), ["Turn 2 repeats the customer's message of turn 1."]);
});

test("odd items and an empty page give unavailable values, never an exception or NaN", () => {
  const junk = [null, undefined, {}, "turn", { n: "2", evidence: null, intents: [], decision: "reply" }, { n: 4, intents: { a: -1, b: 2 } }];
  const facts = pack.features.filter((entry) => entry.kind === "fact");
  for (const fact of facts) for (const item of junk) {
    const value = fact.value(item, ctx());
    assert.ok(value === null || value === false, `${fact.id} on ${JSON.stringify(item)} gave ${value}`);
  }
  const lists = pack.features.filter((entry) => entry.kind === "diagnostic" && entry.scope === "list");
  for (const check of lists) assert.deepEqual(check.check(junk, ctx()), []);
  const bare = { items: () => [], shown: () => [], data: {} };
  for (const result of runMetrics(pack.features.filter((entry) => entry.kind === "metric").map((entry) => [entry.id, entry]), bare)) {
    assert.equal(result.value, null);
    assert.equal(result.detail, "");
  }
});
