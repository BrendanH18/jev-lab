// The Counter page's Lab surfaces: the builders of static/js/lab/surfaces/counter.js, and the hooks in
// static/js/counter.js, rebuilt from the page source with stand-ins for the DOM and the network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { improvementsOf } from "../../../static/js/lab/kit.js";
import { counterExamplesCtx, counterTurnsCtx } from "../../../static/js/lab/surfaces/counter.js";
import turnPack from "../../../static/js/lab/packs/counter/counter-turn-insights.js";
import examplePack from "../../../static/js/lab/packs/counter/counter-example-guide.js";
import { fakeEnv, find, fire, textOf } from "./harness.mjs";
import { COUNTER_POLICY, INTENT_KEYS, REPLY_TEXT, examplesByIndex, sampleCounterChats, sampleCounterExamplesCtx, sampleCounterSetup, sampleCounterTurnsCtx,
  turnsByN } from "./fixtures/counter.mjs";

const PAGE = readFileSync(new URL("../../../static/js/counter.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../../static/counter.html", import.meta.url), "utf8");
const COUNTER_PY = readFileSync(new URL("../../../jev/counter.py", import.meta.url), "utf8");
const WORLD_PY = readFileSync(new URL("../../../jev/world.py", import.meta.url), "utf8");
const body = (name) => {
  const match = PAGE.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `static/js/counter.js has no function ${name}`);
  return match[0];
};
const turns = (overrides) => sampleCounterTurnsCtx(overrides);
const examples = (overrides) => sampleCounterExamplesCtx(overrides);

// ---------- counter.turns ----------

test("turn items: one frozen plain object per customer turn, oldest first, with the contract's fields", () => {
  const c = turns();
  const items = c.items();
  assert.deepEqual(items.map((item) => item.n), [1, 2, 3]);
  assert.deepEqual(items[1], {
    n: 2, customer: "This is ridiculous. I've waited weeks and your tracking is useless!", bot: REPLY_TEXT.clarify,
    sent: { action: "clarify", reply: "clarify", reason: "The intent is uncertain or has no reply template." },
    sent_policy: { ...COUNTER_POLICY },
    decision: { action: "clarify", reply: "clarify", reason: "The intent is uncertain or has no reply template.", streak: 1, misses: 0 },
    changed: false,
    evidence: { intent: "order_status", intent_prob: 0.48, frustration: 3.2, asks_for_person: 0.18, missed: 0.35, resolved: 0.01 },
    intent_choice: "return_policy",
    intents: { shipping_times: 0.024, return_policy: 0.4, wholesale_pricing: 0.024, subscription_help: 0.024, brewing_guide: 0.024, order_status: 0.48, other: 0.024 },
    meta: { model: "jev-1.14.0", latency_ms: 388, question_count: 5, input_tokens: 1236, output_tokens: 0, cost_usd: 0.000074, backend: "sdk" },
  });
  for (const item of items) assert.deepEqual(JSON.parse(JSON.stringify(item)), item);
  assert.throws(() => { items[0].customer = "changed"; }, TypeError);
  assert.throws(() => { items[0].evidence.frustration = 0; }, TypeError);
  assert.throws(() => { items[0].intents.other = 1; }, TypeError);
  assert.equal(c.items()[0], items[0], "the same objects while the chat is unchanged");
  assert.equal(c.shown()[2], items[2]);
  assert.deepEqual([c.itemName(items[2], 2), c.itemName({}, 4)], ["Turn 3", "Turn 5"]);
});

test("turn items: the sent decision stays while the current decision follows the policy", () => {
  const relaxed = turnsByN(turns({ chat: "relaxed" }));
  assert.deepEqual([relaxed[3].sent.action, relaxed[3].decision.action, relaxed[3].changed, relaxed[3].bot], ["handoff", "reply", true, REPLY_TEXT.handoff]);
  assert.deepEqual([relaxed[1].changed, relaxed[2].changed], [false, false]);
  // A re-decide gives new items; a pushed turn too.
  const c = turns();
  const before = c.items();
  c.state.decisions = sampleCounterChats().relaxed.decisions;
  assert.notEqual(c.items()[2], before[2]);
  assert.equal(c.items()[2].changed, true);
  const chats = sampleCounterChats();
  const live = turns({ chat: "shipping" });
  live.state.turns = chats.shipping.turns.slice(0, 1);
  live.state.transcript = chats.shipping.transcript.slice(0, 2);
  live.state.decisions = chats.shipping.decisions.slice(0, 1);
  assert.equal(live.items().length, 1);
  live.state.turns.push(chats.shipping.turns[1]);  // the page pushes into the same array
  live.state.transcript = chats.shipping.transcript;
  live.state.decisions = chats.shipping.decisions;
  assert.deepEqual(live.items().map((item) => item.sent.action), ["reply", "close"]);
});

test("turn items: odd shapes read without throwing", () => {
  const [first, second] = turns({ chat: "odd" }).items();
  // An exact tie goes to the first intent in order, as Python's max() does; the model's choice is kept apart.
  assert.deepEqual(first.evidence, { intent: "brewing_guide", intent_prob: 0.4, frustration: null, asks_for_person: null, missed: 0.5, resolved: 0.5 });
  assert.equal(first.intent_choice, "order_status");
  assert.deepEqual(first.meta, { model: null, latency_ms: null, question_count: null, input_tokens: null, output_tokens: null, cost_usd: null, backend: null });
  assert.deepEqual([second.customer, second.bot, second.decision, second.changed, second.intent_choice, second.intents], ["Hello?", "", null, false, null, {}]);
  assert.deepEqual(second.sent, { action: null, reply: null, reason: null });
  assert.deepEqual(Object.values(second.evidence), [null, null, null, null, null, null]);
  for (const raw of [null, "nope", 3, [null, 4]]) assert.deepEqual(turns({ turns: raw }).items(), []);
  assert.deepEqual(counterTurnsCtx().items(), []);
  assert.deepEqual(counterTurnsCtx().shown(), []);
  assert.deepEqual(turns({ chat: "empty" }).items(), []);
});

test("turn data: policy, decided policy, defaults, limits, rules, intents and the chat's state", () => {
  const data = turns().data;
  assert.deepEqual(data.policy, COUNTER_POLICY);
  assert.deepEqual(data.decided_with, COUNTER_POLICY);
  assert.deepEqual(data.defaults, COUNTER_POLICY);
  assert.deepEqual(data.changed, []);
  assert.deepEqual(Object.keys(data.limits), ["person_at", "frustration_at", "streak_turns", "missed_at", "missed_turns", "intent_min", "resolved_at"]);
  assert.deepEqual(data.limits.frustration_at, { min: 0, max: 4, step: 0.1, label: "Frustration at score ≥" });
  assert.deepEqual(data.rules.map((rule) => rule.id), ["handed_off", "asks_for_person", "frustration_streak", "missed_turns", "resolved", "intent_confidence"]);
  assert.deepEqual(data.intents, INTENT_KEYS);
  assert.deepEqual(data.chat, { turns: 3, max_turns: 20, max_chars: 2000, stopped: "handoff", sample: { index: 1, label: "Frustration builds", turns: 3 }, following: true, next: null });
  assert.deepEqual([data.draft, data.note, data.running], ["", "Re-decided in 0.4 ms · no Jev call", false]);
  assert.throws(() => { data.policy.person_at = 1; }, TypeError);
  assert.throws(() => { data.chat.turns = 0; }, TypeError);
  assert.throws(() => { data.limits.person_at.max = 2; }, TypeError);

  const relaxed = turns({ chat: "relaxed" }).data;
  assert.deepEqual([relaxed.changed, relaxed.decided_with.streak_turns, relaxed.chat.stopped], [["streak_turns"], 3, null]);
  // While a re-decide is on its way the sliders and the decided policy differ.
  assert.deepEqual([turns({ policy: { ...COUNTER_POLICY, person_at: 0.3 } }).data.policy.person_at, turns({ policy: { ...COUNTER_POLICY, person_at: 0.3 } }).data.decided_with.person_at], [0.3, 0.5]);
  assert.deepEqual(turns({ chat: "long" }).data.chat.stopped, "turn_limit");
  assert.deepEqual(turns({ chat: "odd" }).data.chat, { turns: 2, max_turns: 20, max_chars: 2000, stopped: null, sample: { index: 3, label: "Missing the point", turns: 3 },
    following: false, next: "You missed my point again. I already did that and still need my refund." });
  const typed = turns({ chat: "typed" }).data;
  assert.deepEqual([typed.chat.sample, typed.chat.following, typed.chat.next, typed.draft], [null, false, null, "Also, can a café order wholesale?"]);
  const empty = turns({ chat: "empty" }).data;
  assert.deepEqual([empty.decided_with, empty.chat.next, empty.chat.following], [null, "How long does shipping to Canada take?", true]);
  // A sample that is an equal copy rather than the setup's own object is still recognized.
  assert.equal(turns({ sample: { ...sampleCounterSetup().examples[1] } }).data.chat.sample.index, 1);
  const none = turns({ setup: null }).data;
  assert.deepEqual([none.policy, none.defaults, none.changed], [null, null, []]);
  assert.deepEqual(turns({ running: true }).data.running, true);
});

test("the contract's constants mirror jev/counter.py, jev/world.py and the page's sliders", () => {
  const data = turns().data;
  const defaults = COUNTER_PY.match(/DEFAULT_POLICY = (\{[^}]*\})/)[1].replace(/\s+/g, " ");
  for (const [key, value] of Object.entries(COUNTER_POLICY)) assert.ok(defaults.includes(`"${key}": ${value}`), key);
  assert.deepEqual(Object.keys(data.limits), Object.keys(COUNTER_POLICY));
  assert.match(COUNTER_PY, new RegExp(`MAX_TEXT = ${data.chat.max_chars}\\b`));
  assert.match(COUNTER_PY, new RegExp(`MAX_TURNS = ${data.chat.max_turns}\\b`));
  assert.ok(COUNTER_PY.includes('top = MAX_TURNS if key.endswith("turns") else 4 if key == "frustration_at" else 1'));
  // The page's slider table: [key, label, max, step]; the minimum is 1 for *_turns and 0 otherwise.
  const fields = [...body("renderPolicy").matchAll(/\["(\w+)", "([^"]+)", (\d+), ([\d.]+)\]/g)].map(([, key, label, max, step]) => [key, { min: key.endsWith("turns") ? 1 : 0, max: Number(max), step: Number(step), label }]);
  assert.deepEqual(Object.fromEntries(fields), data.limits);
  // Intents: the templates of jev/world.py in order, then order_status and other.
  const templates = [...WORLD_PY.slice(WORLD_PY.indexOf("TEMPLATES = {")).matchAll(/^ {4}"(\w+)": \{/gm)].map(([, key]) => key);
  assert.deepEqual([...templates, "order_status", "other"], data.intents);
  // decide()'s rules in order.
  const decide = COUNTER_PY.slice(COUNTER_PY.indexOf("def decide("));
  const order = ["if handed_off:", 'ev["asks_for_person"] >= p["person_at"]', 'streak >= p["streak_turns"]', 'misses >= p["missed_turns"]', 'ev["resolved"] >= p["resolved_at"]', 'ev["intent_prob"] < p["intent_min"]'];
  const at = order.map((text) => decide.indexOf(text));
  assert.ok(at.every((index) => index > 0), "every rule is in decide()");
  assert.deepEqual(at, [...at].sort((a, b) => a - b), "in the contract's order");
});

test("turns shown(): Lab filters, then Lab sort, at call time; items() is never filtered", () => {
  const hidden = new Set();
  let reversed = false;
  const c = turns({ matches: (item) => !hidden.has(item.n), arrange: (list) => (reversed ? list.slice().reverse() : list) });
  assert.deepEqual(c.shown(), c.items());
  hidden.add(2);
  assert.deepEqual(c.shown().map((item) => item.n), [1, 3]);
  reversed = true;
  assert.deepEqual(c.shown().map((item) => item.n), [3, 1]);
  assert.equal(c.items().length, 3);
  assert.deepEqual(turns({ hide: [1], order: [3] }).shown().map((item) => item.n), [3, 2]);
  assert.deepEqual(turns({ arrange: () => "nope", hide: [3] }).shown().map((item) => item.n), [1, 2]);
});

test("setPolicy and resetPolicy: slider ranges and steps, no-op changes, and the setup guard", () => {
  const c = turns();
  assert.deepEqual(Object.keys(c.actions).sort(), ["draftMessage", "focusMessage", "inspectTurn", "resetPolicy", "setPolicy"]);
  assert.equal(c.actions.replaceItems, undefined, "turns are records of calls: read-only");
  assert.equal(c.actions.importItems, undefined);
  assert.deepEqual(c.actions.setPolicy({ streak_turns: 3, person_at: "0.35" }), { ...COUNTER_POLICY, streak_turns: 3, person_at: 0.35 });
  assert.deepEqual(c.log, [["setPolicy", { ...COUNTER_POLICY, streak_turns: 3, person_at: 0.35 }]]);
  assert.equal(c.state.policy.streak_turns, 3);
  assert.deepEqual(c.actions.setPolicy({ frustration_at: 4, intent_min: 0 }).frustration_at, 4);
  assert.equal(c.log.length, 2);
  assert.deepEqual(c.actions.setPolicy({ frustration_at: 4 }).frustration_at, 4, "a change that moves nothing");
  assert.equal(c.log.length, 2, "…does not re-decide");
  assert.throws(() => c.actions.setPolicy({}), /at least one/);
  assert.throws(() => c.actions.setPolicy(null), /at least one/);
  assert.throws(() => c.actions.setPolicy({ budget: 1 }), /no policy setting "budget"/);
  assert.throws(() => c.actions.setPolicy({ person_at: "lots" }), /must be a number/);
  assert.throws(() => c.actions.setPolicy({ person_at: Number.NaN }), /must be a number/);
  assert.throws(() => c.actions.setPolicy({ person_at: 1.05 }), /from 0 to 1/);
  assert.throws(() => c.actions.setPolicy({ streak_turns: 0 }), /from 1 to 20/);
  assert.throws(() => c.actions.setPolicy({ streak_turns: 21 }), /from 1 to 20/);
  assert.throws(() => c.actions.setPolicy({ person_at: 0.37 }), /steps of 0.05/);
  assert.throws(() => c.actions.setPolicy({ streak_turns: 2.5 }), /steps of 1/);
  assert.throws(() => c.actions.setPolicy({ frustration_at: 2.55 }), /steps of 0.1/);
  assert.equal(c.log.length, 2, "no refused change reached the page");
  c.actions.resetPolicy();
  assert.deepEqual(c.log.at(-1), ["resetPolicy"]);
  assert.deepEqual(c.state.policy, COUNTER_POLICY);
  assert.throws(() => turns({ setup: null }).actions.setPolicy({ person_at: 0.4 }), /not loaded/);
  assert.throws(() => turns({ setup: null }).actions.resetPolicy(), /not loaded/);
  assert.throws(() => turns({ missing: ["setPolicy"] }).actions.setPolicy({ person_at: 0.4 }), /cannot do that/);
  // Policy changes are allowed while a turn runs: the page's sliders stay enabled then.
  turns({ running: true }).actions.setPolicy({ person_at: 0.4 });
});

test("draftMessage fills the box without sending, and only when the page's box is open", () => {
  const c = turns({ chat: "odd" });
  assert.equal(c.actions.draftMessage("Where is my refund?"), "Where is my refund?");
  assert.deepEqual(c.log, [["setDraft", "Where is my refund?"]]);
  assert.equal(c.state.draft, "Where is my refund?");
  assert.equal(c.actions.draftMessage("Where is my refund?"), "Where is my refund?", "the same text again is fine");
  assert.throws(() => c.actions.draftMessage("Something else"), /already holds text you typed/);
  assert.equal(c.actions.draftMessage("Something else", { replace: true }), "Something else");
  assert.throws(() => c.actions.draftMessage("  \n "), /no message/);
  assert.throws(() => c.actions.draftMessage(42), /no message/);
  assert.throws(() => c.actions.draftMessage("x".repeat(2001), { replace: true }), /at most 2,000 characters/);
  assert.equal(c.actions.draftMessage("x".repeat(2000), { replace: true }).length, 2000);
  assert.throws(() => turns({ chat: "odd", running: true }).actions.draftMessage("Hi"), /current turn/);
  assert.throws(() => turns().actions.draftMessage("Hi"), /handed to a person/);
  assert.throws(() => turns({ chat: "long" }).actions.draftMessage("Hi"), /reached 20 customer turns/);
  assert.throws(() => turns({ chat: "odd", setup: null }).actions.draftMessage("Hi"), /not loaded/);
  assert.throws(() => turns({ chat: "odd", missing: ["setDraft"] }).actions.draftMessage("Hi"), /cannot do that/);
  // A relaxed policy reopens the chat the default policy handed off.
  assert.equal(turns({ chat: "relaxed" }).actions.draftMessage("Any update?"), "Any update?");
  assert.equal(turns({ chat: "empty" }).actions.draftMessage("Hello"), "Hello");
});

test("focusMessage and inspectTurn guards", () => {
  const c = turns({ chat: "odd" });
  assert.equal(c.actions.focusMessage(), true);
  for (const blocked of [turns(), turns({ chat: "long" }), turns({ chat: "odd", running: true }), turns({ chat: "odd", boxDisabled: true }),
    turns({ chat: "odd", missing: ["focusMessage"] }), turns({ chat: "odd", setup: null })]) {
    assert.equal(blocked.actions.focusMessage(), false);
    assert.deepEqual(blocked.log, []);
  }
  const d = turns();
  assert.equal(d.actions.inspectTurn(2), d.state.turns[1].trace);
  assert.deepEqual(d.log, [["inspect", 2]]);
  assert.throws(() => d.actions.inspectTurn(4), /no turn 4/);
  assert.throws(() => d.actions.inspectTurn(0), /no turn 0/);
  assert.throws(() => d.actions.inspectTurn("1"), /no turn 1/);
  assert.throws(() => turns({ chat: "empty" }).actions.inspectTurn(1), /no turn 1/);
  assert.throws(() => turns({ missing: ["inspect"] }).actions.inspectTurn(1), /cannot do that/);
  d.refresh();
  assert.deepEqual(d.log.at(-1), ["refresh"]);
  turns({ missing: ["refresh"] }).refresh();
});

// ---------- counter.examples ----------

test("example items: inputs and hand-written expectations, with the current chat's progress", () => {
  const c = examples();
  const items = c.items();
  assert.deepEqual(items.map((item) => item.index), [0, 1, 2, 3, 5], "a non-object example is skipped and indexes stay the setup's");
  assert.deepEqual(items[1], { index: 1, position: 2, label: "Frustration builds", turns: sampleCounterSetup().examples[1].turns, expect: ["reply", "reply", "handoff"],
    active: true, sent: 3, following: true });
  assert.deepEqual(items[4], { index: 5, position: 6, label: "Example 6", turns: ["Do you sell decaf beans?"], expect: ["reply", "close"], active: false, sent: 0, following: false });
  assert.ok(items.filter((item) => item.index !== 1).every((item) => !item.active && item.sent === 0 && !item.following));
  assert.throws(() => { items[0].turns.push("x"); }, TypeError);
  assert.equal(c.items()[0], items[0]);
  assert.deepEqual([c.itemName(items[1], 1), c.itemName({}, 2)], ["Frustration builds", "3"]);
  const odd = examplesByIndex(examples({ chat: "odd" }));
  assert.deepEqual([odd[3].active, odd[3].sent, odd[3].following], [true, 2, false]);
  assert.ok(Object.values(examplesByIndex(examples({ chat: "typed" }))).every((item) => !item.active));
  assert.deepEqual(examples({ setup: null }).items(), []);
  assert.deepEqual(examples({ setup: { examples: "nope" } }).items(), []);
  assert.deepEqual(counterExamplesCtx().items(), []);
  // A chat that moves on gives new items.
  const live = examples({ chat: "empty" });
  assert.deepEqual([live.items()[0].active, live.items()[0].sent], [true, 0]);
  const chats = sampleCounterChats();
  Object.assign(live.state, { turns: chats.shipping.turns, transcript: chats.shipping.transcript, decisions: chats.shipping.decisions });
  assert.deepEqual([live.items()[0].sent, live.items()[0].following], [2, true]);
});

test("example data and shown()", () => {
  const data = examples().data;
  assert.deepEqual(data.chat, { index: 1, turns: 3, actions: ["reply", "clarify", "handoff"], sent_actions: ["reply", "clarify", "handoff"], stopped: "handoff" });
  assert.deepEqual([data.defaults_in_force, data.running, data.max_turns, data.max_chars, data.actions], [true, false, 20, 2000, ["reply", "clarify", "close", "handoff"]]);
  assert.deepEqual(examples({ chat: "relaxed" }).data.chat.actions, ["reply", "clarify", "reply"]);
  assert.deepEqual(examples({ chat: "relaxed" }).data.chat.sent_actions, ["reply", "clarify", "handoff"]);
  assert.equal(examples({ chat: "relaxed" }).data.defaults_in_force, false);
  assert.deepEqual(examples({ chat: "odd" }).data.chat.actions, ["clarify", null]);
  assert.deepEqual(examples({ chat: "typed" }).data.chat.index, null);
  assert.equal(examples({ setup: null }).data.defaults_in_force, false);
  assert.deepEqual(examples({ hide: [0, 2], order: [5] }).shown().map((item) => item.index), [5, 1, 3]);
  assert.deepEqual(examples({ arrange: () => null }).shown().length, 5);
});

test("start and newChat: the chip handlers, refused while running and before discarding a chat without consent", () => {
  const c = examples({ chat: "empty" });
  assert.deepEqual(Object.keys(c.actions).sort(), ["newChat", "start"]);
  c.actions.start(3);
  assert.deepEqual(c.log, [["start", 3]]);
  assert.equal(c.state.sample.label, "Missing the point");
  c.actions.newChat();
  assert.deepEqual(c.log.at(-1), ["newChat"]);
  assert.equal(c.state.sample, null);
  const busy = examples();
  assert.throws(() => busy.actions.start(0), /clears the current chat of 3 turns/);
  assert.throws(() => busy.actions.newChat(), /clears the current chat of 3 turns/);
  assert.throws(() => busy.actions.start(0, { discard: "yes" }), /Confirm to discard/);
  busy.actions.start(0, { discard: true });
  assert.deepEqual(busy.log, [["start", 0]]);
  assert.equal(busy.state.turns.length, 0);
  assert.throws(() => examples({ chat: "empty" }).actions.start(4), /no example 5/, "the skipped non-object example");
  assert.throws(() => examples({ chat: "empty" }).actions.start(9), /no example 10/);
  assert.throws(() => examples({ chat: "empty" }).actions.start("1"), /no example 1/);
  assert.throws(() => examples({ chat: "empty", running: true }).actions.start(0), /Wait for the current turn/);
  assert.throws(() => examples({ chat: "empty", running: true }).actions.newChat(), /Wait for the current turn/);
  assert.throws(() => examples({ setup: null }).actions.start(0), /not loaded/);
  assert.throws(() => examples({ setup: null }).actions.newChat(), /not loaded/);
  assert.throws(() => examples({ chat: "empty", missing: ["start"] }).actions.start(0), /cannot do that/);
});

// ---------- the page hooks (static/js/counter.js) ----------

const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) });
const callStats = (meta) => ({ stats: meta });
const plain = (node) => JSON.parse(JSON.stringify(node, (key, value) => (typeof value === "function" ? "fn" : value)));

function page({ packs = [turnPack, examplePack], chat = "frustration" } = {}) {
  const LAB = createLab(packs);
  const setup = sampleCounterSetup();
  setup.examples = setup.examples.filter((example) => example && example.label);  // the real setup: four examples
  const picked = sampleCounterChats()[chat];
  const S = { setup, policy: { ...setup.policy }, transcript: picked.transcript, turns: picked.turns, decisions: picked.decisions, decidedWith: picked.decidedWith,
    sample: picked.sample ? setup.examples.find((example) => example.label === picked.sample.label) : null, running: false, rev: 0, note: "", draft: "" };
  const held = new Map();
  const classes = new Map();
  const $ = (selector) => ({ classList: { toggle: (name, on) => { if (name === "hidden") classes.set(selector, on); } } });
  const mount = (target, ...nodes) => { held.set(target, nodes.flat(Infinity).filter(Boolean)); return target; };
  const resets = [];
  const reset = (sample) => resets.push(sample);
  const chatSource = { setup: () => S.setup, turns: () => S.turns, transcript: () => S.transcript, decisions: () => S.decisions, sample: () => S.sample,
    running: () => S.running, policy: () => S.policy };
  const lists = {};
  const TURNS = counterTurnsCtx({ ...chatSource, matches: (item, c) => LAB.matches("counter.turns", item, c), arrange: (list, c) => LAB.arrange("counter.turns", list, c),
    refresh: () => lists.renderChat() });
  const EXAMPLES = counterExamplesCtx({ ...chatSource, matches: (item, c) => LAB.matches("counter.examples", item, c),
    arrange: (list, c) => LAB.arrange("counter.examples", list, c), refresh: () => lists.renderSamples() });
  const make = new Function("S", "TURNS", "EXAMPLES", "LAB", "TURNS_ID", "EXAMPLES_ID", "$", "mount", "h", "labEnv", "reset", "callStats", "inspect",
    `${body("labNote")}\n${body("renderSamples")}\n${body("turnNode")}\n${body("renderChat")}\n${body("resetLab")}\n${body("renderLab")}\nreturn { renderSamples, renderChat, renderLab };`);
  Object.assign(lists, make(S, TURNS, EXAMPLES, LAB, "counter.turns", "counter.examples", $, mount, h, fakeEnv(), reset, callStats, () => {}));
  return { LAB, S, ...lists, held, classes, resets, chat: () => held.get("#chat"), samples: () => held.get("#samples"), note: () => held.get("#samples-note") };
}

// The page's chat and chips before Lab, verbatim from the previous render().
const oldChat = (S) => [S.turns.length ? S.turns.map((t, i) => h("div", { class: "chat-turn" },
  h("b", {}, `Customer · turn ${i + 1}`), h("p", {}, S.transcript[i * 2].text),
  h("b", {}, "Bot · fixed template"), h("p", {}, S.transcript[i * 2 + 1].text),
  h("p", { class: "muted" }, `Current policy: ${S.decisions[i].action} · ${S.decisions[i].reason}`),
  callStats(t.meta, () => {}))) : h("p", { class: "empty" }, "Pick a sample and step through it, or write a customer message.")].flat();
const oldSamples = (S) => [S.setup.examples.map((ex) => h("button", { class: "chip", disabled: S.running, onclick: () => {} }, ex.label)),
  h("button", { class: "chip", disabled: S.running, onclick: () => {} }, "New chat")].flat();

test("with no Lab setting active the chat and the chips render exactly as before", () => {
  for (const chat of ["frustration", "shipping", "typed", "long", "empty"]) {
    const p = page({ chat });
    p.renderChat();
    p.renderSamples();
    assert.deepEqual(plain(p.chat()), plain(oldChat(p.S)), chat);
    assert.deepEqual(plain(p.samples()), plain(oldSamples(p.S)), chat);
    assert.deepEqual(p.note(), []);
    assert.equal(p.classes.get("#samples-note"), true, "the note box stays hidden");
  }
  const running = page();
  running.S.running = true;
  running.renderSamples();
  assert.deepEqual(plain(running.samples()), plain(oldSamples(running.S)));
  // Without any Lab pack nothing changes either, and the Lab boxes stay hidden.
  const bare = page({ packs: [] });
  bare.renderChat();
  bare.renderLab();
  assert.deepEqual(plain(bare.chat()), plain(oldChat(bare.S)));
  assert.deepEqual([bare.classes.get("#samples-lab"), bare.classes.get("#turns-lab")], [true, true]);
});

test("Lab filters hide chat turns, a Lab sort reorders them, and the note's reset restores everything", () => {
  const p = page();
  const view = p.LAB.view("counter.turns");
  view.filters = [{ key: "counter-turn-insights/action_now", op: "is", value: "handoff" }];
  p.renderChat();
  let shown = p.chat();
  assert.equal(shown[0].attrs.role, "status");
  assert.match(textOf(shown[0]), /^1 of 3 turns shown · 1 Lab setting active/);
  assert.deepEqual(shown.slice(1).map((node) => textOf(node.children[0])), ["Customer · turn 3"]);
  view.filters = [];
  view.sort = { key: "counter-turn-insights/frustration", dir: "desc" };
  p.renderChat();
  shown = p.chat();
  assert.deepEqual(shown.slice(1).map((node) => textOf(node.children[0])), ["Customer · turn 3", "Customer · turn 2", "Customer · turn 1"]);
  view.filters = [{ key: "counter-turn-insights/intent", op: "is", value: "brewing guide" }];
  p.renderChat();
  shown = p.chat();
  assert.equal(shown.length, 1);
  assert.match(textOf(shown[0]), /^No turn matches the Lab filters\./);
  fire(find(shown[0], (node) => node.tag === "button"), "click");
  assert.equal(p.LAB.active("counter.turns"), 0);
  assert.deepEqual(plain(p.chat()), plain(oldChat(p.S)));
  assert.deepEqual(p.held.get("#turns-lab")[0].attrs["data-lab-surface"], "counter.turns", "the Lab sections are drawn again");
  assert.equal(p.classes.get("#turns-lab"), false);
});

test("Lab filters hide example chips but never the New chat chip", () => {
  const p = page();
  const view = p.LAB.view("counter.examples");
  view.filters = [{ key: "counter-example-guide/expects_close", op: "without" }];
  p.renderSamples();
  assert.deepEqual(p.samples().map(textOf), ["Frustration builds", "A person, please", "Missing the point", "New chat"]);
  assert.equal(p.classes.get("#samples-note"), false);
  assert.match(textOf(p.note()[0]), /^3 of 4 examples shown · 1 Lab setting active/);
  fire(p.samples()[1], "click");
  assert.deepEqual(p.resets, [p.S.setup.examples[2]], "a chip still loads its own example");
  view.filters = [{ key: "counter-example-guide/turn_count", op: "min", value: "9" }];
  p.renderSamples();
  assert.deepEqual(p.samples().map(textOf), ["New chat"]);
  assert.match(textOf(p.note()[0]), /^No example matches the Lab filters\./);
  fire(find(p.note()[0], (node) => node.tag === "button"), "click");
  assert.deepEqual(p.samples().map(textOf), ["Shipping, then sorted", "Frustration builds", "A person, please", "Missing the point", "New chat"]);
  assert.equal(p.classes.get("#samples-note"), true);
  assert.equal(p.held.get("#samples-lab")[0].attrs["data-lab-surface"], "counter.examples");
});

test("the page installs Lab once after the top bar, hooks both surfaces and adds the Lab boxes", () => {
  assert.match(body("boot"), /await initChrome\("\/counter"\);\n\s*installLab\(LAB\);/);
  assert.equal(PAGE.match(/installLab\(/g).length, 1);
  assert.match(PAGE, /import \{ LAB \} from "\.\/lab\/pages\/counter\.js";/);
  assert.match(PAGE, /import \{ installLab, labEnv \} from "\.\/lab\/env\.js";/);
  assert.match(PAGE, /import \{ counterExamplesCtx, counterTurnsCtx \} from "\.\/lab\/surfaces\/counter\.js";/);
  assert.match(PAGE, /matches: \(item, ctx\) => LAB\.matches\(TURNS_ID, item, ctx\), arrange: \(list, ctx\) => LAB\.arrange\(TURNS_ID, list, ctx\)/);
  assert.match(PAGE, /matches: \(item, ctx\) => LAB\.matches\(EXAMPLES_ID, item, ctx\), arrange: \(list, ctx\) => LAB\.arrange\(EXAMPLES_ID, list, ctx\)/);
  assert.match(body("render"), /renderSamples\(\);\n\s*renderChat\(\);\n\s*renderCompose\(\);\n\s*renderResult\(\);\n\s*renderLab\(\);/);
  // No Lab callback sends a turn or calls the server.
  const source = PAGE.slice(PAGE.indexOf("const chatSource"), PAGE.indexOf("function reset("));
  assert.doesNotMatch(source, /\brun\(|api\(/);
  for (const id of ["samples-note", "samples-lab", "turns-lab"]) assert.match(HTML, new RegExp(`<div id="${id}" class="hidden"></div>`));
});

test("Reset policy and Lab's policy actions share one path, and every decision records its policy", async () => {
  assert.match(body("renderPolicy"), /onclick: \(\) => applyPolicy\(S\.setup\.policy\)/);
  const S = { setup: sampleCounterSetup(), policy: { ...COUNTER_POLICY, person_at: 0.2 }, rev: 4 };
  const calls = [];
  const applyPolicy = new Function("S", "renderPolicy", "redecide", `${body("applyPolicy")}\nreturn applyPolicy;`)(S, () => calls.push("renderPolicy"), () => calls.push("redecide"));
  applyPolicy(S.setup.policy);
  assert.deepEqual([S.policy, S.rev, calls], [COUNTER_POLICY, 5, ["renderPolicy", "redecide"]]);
  assert.notEqual(S.policy, S.setup.policy, "a copy: moving a slider never changes the defaults");

  const relaxed = { ...COUNTER_POLICY, streak_turns: 3 };
  const T = { turns: [{ answers: {} }], policy: relaxed, rev: 1, decisions: [], decidedWith: null, note: "" };
  const api = async (path, payload) => { assert.equal(path, "/api/counter/decide"); return { decisions: ["d"], policy: payload.policy, compute_ms: 0.2 }; };
  const decideAgain = new Function("S", "api", "render", "handleError", `${body("decideAgain")}\nreturn decideAgain;`)(T, api, () => {}, (error) => { throw error; });
  await decideAgain();
  assert.deepEqual([T.decisions, T.decidedWith, T.note], [["d"], relaxed, "Re-decided in 0.2 ms · no Jev call"]);
  assert.match(body("run"), /S\.decisions = r\.decisions;\n\s*S\.decidedWith = r\.policy;/);
  assert.match(body("reset"), /decidedWith: null/);
});

test("both sections render with the starter packs", () => {
  for (const [id, ctx] of [["counter.turns", turns()], ["counter.examples", examples()], ["counter.turns", turns({ chat: "empty" })], ["counter.examples", examples({ setup: null })]]) {
    const LAB = createLab([turnPack, examplePack]);
    const view = LAB.view(id);
    for (const name of ["section", "refine", "checks", "metrics", "exports", "commands"]) view.open[name] = true;
    const tree = LAB.section(fakeEnv(), id, ctx);
    assert.equal(tree.attrs["data-lab-surface"], id);
    assert.ok(!textOf(tree).includes("could not be shown"));
  }
  const LAB = createLab([turnPack, examplePack]);
  const improvements = (id) => [turnPack, examplePack].filter((pack) => pack.surface === id).reduce((sum, pack) => sum + improvementsOf(pack).length, 0);
  assert.ok(improvements("counter.turns") > 0 && improvements("counter.examples") > 0);
  assert.deepEqual([LAB.count("counter.turns"), LAB.count("counter.examples")], [improvements("counter.turns"), improvements("counter.examples")]);
});
