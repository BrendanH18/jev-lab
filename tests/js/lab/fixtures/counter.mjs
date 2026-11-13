// Fixtures for packs on the Counter page's Lab surfaces (contract: static/js/lab/surfaces/counter.js). Every ctx is
// made by the page's own builders from hand-written data: a fictional Harbor Coffee Co. support chat. The answers and
// measurements are made up for tests; nothing here came from the model.
//
//   sampleCounterTurnsCtx(overrides)     "counter.turns"     default: the "Frustration builds" chat, 3 turns, handed off
//   sampleCounterExamplesCtx(overrides)  "counter.examples"  default: the same page state
//
// overrides: { chat, hide, order, matches, arrange, missing, boxDisabled, ...state fields }
//   chat   one of sampleCounterChats()' names (or a chat object of the same shape) to load instead of "frustration":
//            frustration  example 1 (index 1), 3 turns: reply, clarify (top intent 0.48), handoff (frustration streak).
//                         Default policy; the expectation is reply, reply, handoff.
//                         Turn 2's model choice (return_policy) differs from its top probability (order_status).
//            relaxed      the same 3 turns re-decided with streak_turns 3: turn 3 is now a reply (changed), chat open
//            shipping     example 0, 2 turns: reply (shipping_times), close. Every sample turn sent; chat open.
//            typed        "New chat" (no sample), 1 typed turn with intent "other": clarify. A draft is in the box.
//            odd          a chat whose second turn lacks answers, meta and a decision, with an exact intent tie on
//                         turn 1 (brewing_guide and order_status 0.4 each), NaN latency and a string cost
//            long         20 calm brewing turns (turn limit reached), latency 300 + 10·n ms, cost 0.00007 each
//            empty        the page right after picking example 0: no turns
//   hide: [n | index]  items the "Lab filters" hide (turn numbers for turns, example indexes for examples)
//   order: [n | index] items moved to the front by the "Lab sort"
//   missing: [callback names] removed from the source (setPolicy, resetPolicy, setDraft, focusMessage, inspect,
//            refresh, start, newChat)
//   boxDisabled: true  focusMessage reports the box as disabled
//   any other key replaces a field of the page state: setup, policy, decidedWith, sample, running, draft, note, turns,
//   transcript, decisions.
// Each ctx also carries, for tests only:
//   ctx.env    fakeEnv() from harness.mjs (toasts, copied, downloads)
//   ctx.log    every page operation an action reached, as [name, ...args]
//   ctx.state  the fixture's mutable page state: setPolicy/resetPolicy change state.policy, setDraft state.draft,
//              start/newChat clear the chat and set state.sample.
import { counterExamplesCtx, counterTurnsCtx } from "../../../../static/js/lab/surfaces/counter.js";
import { fakeEnv } from "../harness.mjs";

export const COUNTER_POLICY = Object.freeze({ person_at: 0.5, frustration_at: 2.5, streak_turns: 2, missed_at: 0.5, missed_turns: 2, intent_min: 0.6, resolved_at: 0.7 });
export const INTENT_KEYS = Object.freeze(["shipping_times", "return_policy", "wholesale_pricing", "subscription_help", "brewing_guide", "order_status", "other"]);

// The fixed templates the transcripts below use (jev/counter.py REPLIES).
export const REPLY_TEXT = Object.freeze({
  shipping_times: "Thanks for asking! We roast to order and ship within 1-2 business days. US delivery usually takes 3-5 days; Canada takes 6-10 business days. Shipping is free on orders over $45.",
  brewing_guide: "Start with 1:16 coffee to water, water just off the boil (about 96C), and a medium-fine grind for pour-over. Store beans airtight and away from light.",
  order_status: "Please check Account > Orders for your tracking link. If it is missing, a person can help.",
  clarify: "Could you say more about what you need help with?",
  handoff: "I'll hand this chat to a person at Harbor Coffee Co. Please wait for their reply.",
  close: "Glad that helped. Thanks for visiting Harbor Coffee Co.!",
});

export function sampleCounterSetup() {
  return {
    examples: [
      { label: "Shipping, then sorted", turns: ["How long does shipping to Canada take?", "Thanks, that answers my question!"], expect: ["reply", "close"] },
      { label: "Frustration builds", turns: ["Where is my order?", "This is ridiculous. I've waited weeks and your tracking is useless!",
        "I'm furious. Still no parcel and no useful help!"], expect: ["reply", "reply", "handoff"] },
      { label: "A person, please", turns: ["Please connect me to a human agent."], expect: ["handoff"] },
      { label: "Missing the point", turns: ["I need a refund for a damaged bag.", "That doesn't answer my question. I already sent the photo and order number.",
        "You missed my point again. I already did that and still need my refund."], expect: ["reply", "reply", "handoff"] },
      null,
      // Odd: no label, a non-string turn, and one more expectation than turns.
      { turns: ["Do you sell decaf beans?", 7], expect: ["reply", "close"] },
    ],
    policy: { ...COUNTER_POLICY },
  };
}

// Intent probabilities: the named ones, and the rest of the mass shared equally by the other intents.
function intents(named) {
  const rest = INTENT_KEYS.filter((key) => !(key in named));
  const left = 1 - Object.values(named).reduce((total, p) => total + p, 0);
  return Object.fromEntries(INTENT_KEYS.map((key) => [key, key in named ? named[key] : Number((left / rest.length).toFixed(6))]));
}

// One turn's answers in the API's shape.
function answers({ probs, choice, frustration, person, missed, resolved }) {
  return {
    intent: { type: "choice", choice, confidence: probs[choice], probabilities: probs },
    frustration: { type: "score", score: frustration, confidence: 0.7, probabilities: {} },
    asks_for_person: { type: "noul", noul: person },
    missed: { type: "noul", noul: missed },
    resolved: { type: "noul", noul: resolved },
  };
}

const top = (probs) => Object.entries(probs).reduce((best, entry) => (entry[1] > best[1] ? entry : best));

function decision(action, reply, reason, streak, misses, a) {
  const [intent, intentProb] = top(a.intent.probabilities);
  return { action, reply, text: REPLY_TEXT[reply] || `(${reply} template)`, reason, streak, misses,
    evidence: { asks_for_person: a.asks_for_person.noul, missed: a.missed.noul, resolved: a.resolved.noul, intent, intent_prob: intentProb, frustration: a.frustration.score } };
}

const meta = (latency, cost, tokens) => ({ model: "jev-1.14.0", latency_ms: latency, question_count: 5, input_tokens: tokens, output_tokens: 0, cost_usd: cost, backend: "sdk" });
const REPLY = "The intent selects a fixed reply.";

// A chat from its turns: { customer, answers, sent (this call's decision), now (the decision under the current policy), meta }.
function chat({ sample = null, policy = COUNTER_POLICY, decidedWith = policy, sentPolicy = COUNTER_POLICY, draft = "", note = "", turns }) {
  const sentSoFar = [];
  const raw = turns.map((turn) => {
    sentSoFar.push(turn.sent);
    return { answers: turn.answers, decisions: [...sentSoFar], policy: { ...sentPolicy }, meta: turn.meta,
      trace: { request: { state: { latest_customer_message: turn.customer } }, response: { answers: turn.answers }, meta: turn.meta } };
  });
  const transcript = turns.flatMap((turn) => [{ speaker: "customer", text: turn.customer }, { speaker: "bot", text: turn.sent ? turn.sent.text : "" }]);
  return { sample, policy: { ...policy }, decidedWith: raw.length ? { ...decidedWith } : null, draft, note, turns: raw, transcript,
    decisions: turns.map((turn) => turn.now === undefined ? turn.sent : turn.now).filter((entry) => entry !== null) };
}

// "Frustration builds": frustration 1.1, 3.2, 3.8; the streak reaches 2 on turn 3.
const F1 = answers({ probs: intents({ order_status: 0.82, shipping_times: 0.12 }), choice: "order_status", frustration: 1.1, person: 0.04, missed: 0.02, resolved: 0.03 });
const F2 = answers({ probs: intents({ order_status: 0.48, return_policy: 0.4 }), choice: "return_policy", frustration: 3.2, person: 0.18, missed: 0.35, resolved: 0.01 });
const F3 = answers({ probs: intents({ order_status: 0.66, return_policy: 0.2 }), choice: "order_status", frustration: 3.8, person: 0.41, missed: 0.62, resolved: 0 });
const FRUSTRATION_TEXT = sampleCounterSetup().examples[1].turns;
const STREAK = "Frustration stayed above the cut for 2 consecutive turns.";
const RELAXED = Object.freeze({ ...COUNTER_POLICY, streak_turns: 3 });

const frustrationTurns = (relaxed) => [
  { customer: FRUSTRATION_TEXT[0], answers: F1, sent: decision("reply", "order_status", REPLY, 0, 0, F1), meta: meta(412.3, 0.000071, 1180) },
  // Turn 2: P(order_status) 0.48 is below intent_min 0.6 → clarify under the default policy.
  { customer: FRUSTRATION_TEXT[1], answers: F2, sent: decision("clarify", "clarify", "The intent is uncertain or has no reply template.", 1, 0, F2), meta: meta(388, 0.000074, 1236) },
  { customer: FRUSTRATION_TEXT[2], answers: F3, sent: decision("handoff", "handoff", STREAK, 2, 1, F3), meta: meta(451.7, 0.000077, 1302),
    now: relaxed ? decision("reply", "order_status", REPLY, 2, 1, F3) : undefined },
];

// "Shipping, then sorted".
const S1 = answers({ probs: intents({ shipping_times: 0.91 }), choice: "shipping_times", frustration: 0.2, person: 0.01, missed: 0.01, resolved: 0.12 });
const S2 = answers({ probs: intents({ shipping_times: 0.7, other: 0.2 }), choice: "shipping_times", frustration: 0, person: 0.02, missed: 0.03, resolved: 0.93 });
const SHIP_TEXT = sampleCounterSetup().examples[0].turns;

// "typed": a message about something with no template.
const T1 = answers({ probs: intents({ other: 0.77, wholesale_pricing: 0.1 }), choice: "other", frustration: 0.6, person: 0.08, missed: 0.04, resolved: 0.02 });

// "odd": an exact tie on turn 1, and a second turn the page holds with nothing usable.
const O1 = answers({ probs: { shipping_times: 0.05, return_policy: 0.05, wholesale_pricing: 0.05, subscription_help: 0.05, brewing_guide: 0.4, order_status: 0.4, other: 0 },
  choice: "order_status", frustration: Number.NaN, person: "0.3", missed: 0.5, resolved: 0.5 });

function longTurns() {
  return Array.from({ length: 20 }, (_, i) => {
    const a = answers({ probs: intents({ brewing_guide: 0.8 }), choice: "brewing_guide", frustration: 0.1 * (i % 4), person: 0.02, missed: 0.02, resolved: 0.2 });
    return { customer: `Brewing question ${i + 1}: what grind for a ${i % 2 ? "French press" : "pour-over"}?`, answers: a,
      sent: decision("reply", "brewing_guide", REPLY, 0, 0, a), meta: meta(300 + 10 * (i + 1), 0.00007, 1100 + i) };
  });
}

export function sampleCounterChats() {
  const setup = sampleCounterSetup();
  return {
    frustration: chat({ sample: setup.examples[1], note: "Re-decided in 0.4 ms · no Jev call", turns: frustrationTurns(false) }),
    relaxed: chat({ sample: setup.examples[1], policy: RELAXED, decidedWith: RELAXED, note: "Re-decided in 0.3 ms · no Jev call", turns: frustrationTurns(true) }),
    shipping: chat({ sample: setup.examples[0], turns: [
      { customer: SHIP_TEXT[0], answers: S1, sent: decision("reply", "shipping_times", REPLY, 0, 0, S1), meta: meta(366.2, 0.000068, 1150) },
      { customer: SHIP_TEXT[1], answers: S2, sent: decision("close", "close", "The customer's need is met.", 0, 0, S2), meta: meta(402, 0.00007, 1199) },
    ] }),
    typed: chat({ draft: "Also, can a café order wholesale?", turns: [
      { customer: "Do you host latte art classes at the Pier Street café?", answers: T1,
        sent: decision("clarify", "clarify", "The intent is uncertain or has no reply template.", 0, 0, T1), meta: meta(395.5, 0.000069, 1170) },
    ] }),
    odd: chat({ sample: setup.examples[3], turns: [
      { customer: setup.examples[3].turns[0], answers: O1, sent: decision("clarify", "clarify", "The intent is uncertain or has no reply template.", 0, 1, { ...O1,
        frustration: { score: 0 }, asks_for_person: { noul: 0.3 } }), meta: { latency_ms: Number.NaN, cost_usd: "0.00007", input_tokens: 1000.5 } },
      { customer: "Hello?", answers: null, sent: null, meta: null, now: null },
    ] }),
    long: chat({ turns: longTurns() }),
    empty: chat({ sample: setup.examples[0], turns: [] }),
  };
}

const value = (entry) => (typeof entry === "function" ? entry : () => entry);
const STATE_KEYS = ["setup", "policy", "decidedWith", "sample", "running", "draft", "note", "turns", "transcript", "decisions"];

function makeState(overrides) {
  const setup = sampleCounterSetup();
  const chats = sampleCounterChats();
  const picked = typeof overrides.chat === "object" && overrides.chat ? overrides.chat : chats[overrides.chat || "frustration"];
  if (!picked) throw new Error(`No fixture chat ${overrides.chat}`);
  // The chat's sample must be the setup's own example object, as on the page.
  const sampleIndex = picked.sample ? setup.examples.findIndex((example) => example && example.label === picked.sample.label) : -1;
  const state = { setup, policy: { ...picked.policy }, decidedWith: picked.decidedWith, sample: sampleIndex >= 0 ? setup.examples[sampleIndex] : picked.sample,
    running: false, draft: picked.draft, note: picked.note, turns: picked.turns, transcript: picked.transcript, decisions: picked.decisions };
  for (const key of STATE_KEYS) if (key in overrides) state[key] = overrides[key];
  return state;
}

function makeSource(overrides, idOf) {
  const log = [];
  const state = makeState(overrides);
  const { hide = [], order = [], matches, arrange, missing = [], boxDisabled = false } = overrides;
  const hidden = new Set(hide);
  const rank = (item) => (order.includes(idOf(item)) ? order.indexOf(idOf(item)) : order.length);
  const clear = (sample) => Object.assign(state, { sample, turns: [], transcript: [], decisions: [], decidedWith: null, note: "", draft: "" });
  const callbacks = {
    setPolicy: (next) => { log.push(["setPolicy", next]); state.policy = { ...next }; },
    resetPolicy: () => { log.push(["resetPolicy"]); state.policy = { ...state.setup.policy }; },
    setDraft: (text) => { log.push(["setDraft", text]); state.draft = text; },
    focusMessage: () => { if (boxDisabled) return false; log.push(["focusMessage"]); return true; },
    inspect: (n) => { log.push(["inspect", n]); return state.turns[n - 1]?.trace; },
    refresh: () => { log.push(["refresh"]); },
    start: (index) => { log.push(["start", index]); clear(state.setup.examples[index]); },
    newChat: () => { log.push(["newChat"]); clear(null); },
  };
  for (const name of missing) delete callbacks[name];
  const source = {
    ...Object.fromEntries(STATE_KEYS.map((key) => [key, () => state[key]])),
    matches: matches || ((item) => !hidden.has(idOf(item))),
    arrange: arrange || ((list) => (order.length ? list.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map((entry) => entry.item) : list)),
    ...callbacks,
  };
  return { source, log, state };
}

export function sampleCounterTurnsCtx(overrides = {}) {
  const { source, log, state } = makeSource(overrides, (item) => item.n);
  const ctx = counterTurnsCtx(source);
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  return ctx;
}

export function sampleCounterExamplesCtx(overrides = {}) {
  const { source, log, state } = makeSource(overrides, (item) => item.index);
  const ctx = counterExamplesCtx(source);
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  return ctx;
}

// The items of a ctx keyed by turn number (turns) or by index (examples), for fact and diagnostic cases.
export const turnsByN = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.n, item]));
export const examplesByIndex = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.index, item]));
