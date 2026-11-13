// Lab surfaces of the Counter page (static/counter.html, static/js/counter.js): the turns of the user's own support
// chat and the built-in example conversations. Pure code: it imports only the kit, touches no DOM, storage or
// network, and is tested in Node (tests/js/lab/surface-demo-counter.test.mjs). Fixtures for pack tests:
// tests/js/lab/fixtures/counter.mjs (sampleCounterTurnsCtx, sampleCounterExamplesCtx). This header is the CONTRACT
// for packs on these two surfaces.
//
// Both ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) } and are built ONCE per
// page load. items(), shown() and every data field are read at call time, so a ctx never goes stale; read a data
// field when you need it and never keep a copy across renders. Items and data values are deeply frozen plain JSON:
// read them, never write to them. items() and shown() hand out the SAME item objects (compare by identity) until the
// list itself changes. Neither surface has replaceItems or importItems, so Edits (transform) and Paste to import
// (importer) do not render here: a turn is the record of a live call the user made, and the examples are built-in
// scenarios (jev/counter.py EXAMPLES, checked by scripts/validate.py) that nothing may change.
// Kinds both surfaces host: fact, diagnostic, metric, exporter, command, tool, panel (and behavior).
//
// How the page works (jev/counter.py): after each customer message ONE live Jev call reads the conversation and
// answers five questions: intent (choice over data.intents), frustration (score 0–4), asks_for_person, missed and
// resolved (noul, P(yes) 0–1). Plain code (decide()) turns the answers of every turn so far into one decision per
// turn: "reply" (the intent's fixed template), "clarify", "close" or "handoff". The rules run in order (data.rules):
// an earlier handoff stays, a request for a person, a frustration streak, repeated misses, resolution, then intent
// confidence. A handoff is final for the chat; a close may be followed by a new need. The bot's reply is chosen by
// the policy in force WHEN THE CALL WAS MADE and is never rewritten. Moving a policy slider re-decides the saved
// answers through POST /api/counter/decide (plain code, NO model call), which changes each turn's `decision` but
// never its `sent` decision, its reply text or its answers.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "counter.turns"  —  builder counterTurnsCtx(source)  —  the chat transcript, one item per customer turn
// ---------------------------------------------------------------------------------------------------------------
// The list is the customer turns of the CURRENT chat, oldest first (turn 1 on top), each with the answers of the call
// the user made for it and its decisions. items() is [] before the first call and again after the page starts a new
// chat (an example chip or "New chat"); at most 20 turns. The page has no filter or sort of its own, so shown() is
// items() after Lab's filters and Lab's sort, and the chat column shows exactly those turns in that order (with
// "x of y turns shown" and a "Clear Lab filters and sort" button while a Lab setting is active; "No turn matches the
// Lab filters." when none is left). The chart and the per-turn decision lines under "Judgments over time" always
// show every turn: they are a time series.
//
// Item (one customer turn):
//   n              number   1-based turn number, as the page prints "Customer · turn n". Unique. itemName() is "Turn n".
//   customer       string   the customer's message exactly as sent ("" when missing)
//   bot            string   the fixed template the bot replied with ("" when missing). Never written by Jev.
//   sent           { action, reply, reason }   the decision of THIS turn's own call, under the policy of that moment:
//                           the one that chose `bot`. action "reply" | "clarify" | "close" | "handoff", reply the
//                           template key (an intent key, "clarify", "close" or "handoff"), reason the rule's sentence.
//                           Fields are null when missing. It never changes.
//   sent_policy    object | null   the full policy that call used ({ person_at, …, resolved_at }; keys of data.limits)
//   decision       { action, reply, reason, streak, misses } | null   the decision under the policy now in force
//                           (data.decided_with), as the page prints "Current policy: action · reason". streak is the
//                           count of consecutive frustrated turns ending here, misses the missed turns so far. null
//                           only if the page has no decision for the turn.
//   changed        boolean  decision and sent differ in action or reply (a different policy would have answered
//                           differently). false when either is missing.
//   evidence       { intent, intent_prob, frustration, asks_for_person, missed, resolved }   what decide() reads,
//                           computed from the answers: intent is the key with the highest probability (the first on a
//                           tie, as Python's max), intent_prob its probability, frustration the score 0–4, the other
//                           three P(yes) 0–1. Each is null when the answer is missing or not a finite number.
//   intent_choice  string | null   the intent the model's choice field named (decide() ignores it and uses the top
//                           probability; the two can differ)
//   intents        { key: p }   the intent probabilities, finite values only, in the response's order; {} when missing
//   meta           { model, latency_ms, question_count, input_tokens, output_tokens, cost_usd, backend }   the
//                           server's measurements of the call; every field null when missing. cost_usd is MEASURED.
//
// data (live getters):
//   policy        { key: number } | null   the policy sliders now; null before the setup loads
//   decided_with  { key: number } | null   the full policy the shown `decision`s were decided under; null before the
//                 first call. Differs from `policy` for about 120 ms after a slider moves (the re-decide is debounced).
//   defaults      { key: number } | null   the default policy (jev/counter.py DEFAULT_POLICY); null before setup
//   changed       [key]   sliders that differ from defaults, in data.limits order; [] before setup
//   limits        { key: { min, max, step, label } }   the seven sliders as the page draws them, in page order:
//                 person_at, frustration_at, streak_turns, missed_at, missed_turns, intent_min, resolved_at.
//                 Probabilities step 0.05 (0–1); frustration_at 0.1 (0–4); the two *_turns counts 1 (1–20).
//   rules         [{ id, label, keys }]   decide()'s rules in the order they run; keys are the policy settings each
//                 reads: handed_off [], asks_for_person [person_at], frustration_streak [frustration_at,
//                 streak_turns], missed_turns [missed_at, missed_turns], resolved [resolved_at], intent_confidence
//                 [intent_min] (it also clarifies the "other" intent, which has no template)
//   intents       [key]   the seven intent keys in question order: shipping_times, return_policy, wholesale_pricing,
//                 subscription_help, brewing_guide, order_status, other
//   chat          { turns, max_turns: 20, max_chars: 2000, stopped, sample, following, next }
//                   turns      number of customer turns sent
//                   stopped    null | "turn_limit" | "handoff": why the composer is closed. "handoff" follows the
//                              CURRENT decisions (moving a slider can reopen a chat), "turn_limit" means 20 turns.
//                   sample     { index, label, turns } | null   the example the chat started from (turns = its length)
//                   following  boolean  every customer message so far equals the sample's turns in order
//                   next       string | null   the sample's next turn, which the page offers as "Next sample turn"
//                              (null without a sample or once every sample turn has been sent)
//   draft         string   the customer message being typed and not yet sent ("" when none). The user's own text.
//   note          string   the page's re-decide note ("Re-decided in 0.4 ms · no Jev call"); "" when none
//   running       boolean  a turn (one live call) is on its way
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them only from a
// command or a control the user just pressed, one call per press, never from a fact, metric, check or render):
//   setPolicy(changes)  moves policy sliders exactly as dragging them does, then re-decides the saved answers through
//                       POST /api/counter/decide: plain code, NO model call. changes is { key: number }. Guards: the
//                       setup has loaded; at least one key; every key is one of data.limits; every value is a finite
//                       number inside the slider's range and on its step grid. Returns the policy now in the sliders
//                       (frozen); a change that moves nothing returns it without re-deciding. The replies already
//                       sent never change.
//   resetPolicy()       the page's "Reset policy" button: the defaults, same re-decide, no model call. Guard: setup.
//   draftMessage(text, { replace })   puts text in the customer message box and focuses it. It NEVER sends: the user
//                       still presses "Send customer turn" (one live call). Guards: setup loaded; text is a string
//                       that is not blank and at most 2000 characters; no turn is on its way; the chat is not stopped
//                       (handoff or 20 turns, when the page disables the box); and a nonblank draft the user typed is
//                       never overwritten unless replace is true. Returns the text placed.
//   focusMessage()      focuses the message box. Returns false (and does nothing) while it is disabled.
//   inspectTurn(n)      opens the page's Inspect JSON drawer on turn n's request and response (the page's own per-turn
//                       "Inspect JSON" button). Guard: n is an integer naming a turn of the chat.
// There is no action that sends a turn, changes or replays answers, edits the transcript, or starts a chat here; none
// may be added by a pack.
//
// refresh() re-renders the chat column (and Lab's "x of y" note) from shown(); the message box keeps its text.
//
// Content boundaries for counter.turns:
//   - Every message, answer, probability, decision, latency and cost here comes from calls the current user made in
//     this page load. Show, measure, compare and export them as the user's own chat; never store them, never replay
//     them into a later chat, never show an example's expectation or a made-up answer as one.
//   - Exports that hold the customer's messages say so in their label or help; a policy export holds settings only.
//     CSV goes through csvText/csvCell (formula escaping). Nothing here holds the API key.
//   - The decision is the page's: `decision` (now) and `sent` (when the reply went out). A pack does not
//     re-implement decide(); to see another policy's decisions it moves the sliders through setPolicy. A local rule
//     ("within 0.05 of a cut") is advisory plain code, labeled as such, never worded as Jev's answer or the decision.
//   - cost_usd and token counts are measured; a projection (cost of 1,000 chats) is arithmetic on measured calls and
//     says so, never shown as spend.
//   - Lab filters and sorts are presentation only: they never change the chat, its order for the next call, the
//     chart or the decisions.
//   - Do not duplicate the page: per turn it shows the customer text, the bot reply, "Current policy: action ·
//     reason", the call's question count, latency, tokens, cost and an Inspect JSON button; under "Judgments over
//     time" a chart of the five evidence values against the cuts, total calls/cost/latency, the re-decide note, and
//     one line per turn with action, reason, streak, misses and the five evidence values to two decimals.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "counter.examples"  —  builder counterExamplesCtx(source)  —  the example chips above the chat
// ---------------------------------------------------------------------------------------------------------------
// The list is the built-in example conversations from GET /api/counter/setup, in page order (4 today: Shipping, then
// sorted; Frustration builds; A person, please; Missing the point). items() is [] until the setup has loaded. The page
// has no filter of its own, so shown() is items() after Lab's filters and sort, and the page shows exactly those
// chips in that order, followed by the "New chat" chip, which is always shown (with "x of y examples shown" and a
// "Clear Lab filters and sort" button while a Lab setting is active; "No example matches the Lab filters." when none is
// left). Clicking a chip clears the chat and loads that example; its turns are then sent one live call at a time with
// "Next sample turn".
//
// Item (one example conversation; inputs and a hand-written expectation only, never an answer):
//   index      number   0-based position in the setup's examples: the argument of actions.start(index)
//   position   number   index + 1
//   label      string   the chip's text ("Example n" when the setup gives none). itemName() returns it.
//   turns      [string] the customer messages in order (non-strings are left out)
//   expect     [string] what a PERSON expects the DEFAULT policy to decide per turn ("reply" | "clarify" | "close" |
//                       "handoff"), written by hand in jev/counter.py for scripts/validate.py. [] when missing; it may
//                       be shorter or longer than turns in odd data. NOT Jev's answer and NOT the page's decision.
//   active     boolean  the current chat was started from this example
//   sent       number   active only: customer turns sent so far in the current chat (0 for every other example)
//   following  boolean  active and every customer message so far equals this example's turns in order
//
// data (live getters):
//   chat       { index, turns, actions, sent_actions, stopped }   the current chat: index the active example's index
//              (null for a "New chat" or before setup), turns the customer turns sent, actions the CURRENT decision
//              per turn (the user's own calls under the sliders now), sent_actions the decision each reply was sent
//              under, stopped as counter.turns' data.chat.stopped
//   defaults_in_force  boolean   the sliders equal the default policy (expectations are written for the defaults)
//   running    boolean   a turn (one live call) is on its way; the chips are disabled meanwhile
//   max_turns  20,  max_chars 2000   what the server accepts per chat and per message
//   actions    ["reply", "clarify", "close", "handoff"]   every action a decision or an expectation can name
//
// actions (each throws an Error with a message for the user when its guard refuses):
//   start(index, { discard })  what clicking that example's chip does: clears the chat and loads the example. NO model
//                       call; the user still presses "Next sample turn". Guards: setup loaded; index is an integer
//                       naming an item; no turn is on its way (the chips are disabled then); and when the chat holds
//                       turns, discard must be true (a pack passes it only for a chat that is stopped or has sent
//                       every sample turn, or after the user confirmed in its own control).
//   newChat({ discard })       the "New chat" chip: clears the chat with no example. Same guards.
// There is no action that sends a turn or edits an example, and none may be added by a pack.
//
// refresh() re-renders the example chips (and Lab's "x of y" note) from shown().
//
// Content boundaries for counter.examples:
//   - Items are built-in inputs plus hand-written expectations. Exports may contain them and must say so; they hold
//     no answers, probabilities or decisions, and a pack never shows an expectation as what Jev or the policy decided.
//     "Matches the expectation" may only compare with data.chat, the user's own calls in this page load, and should
//     say whether the default policy is in force (data.defaults_in_force).
//   - A count of live calls needed to step through examples is an upper bound of calls, never spend.
//   - No pack changes the examples, the questions or the request, and none sends a turn.
import { toNumber } from "../kit.js";

const MAX_TURNS = 20;
const MAX_CHARS = 2000;
const EMPTY = Object.freeze([]);
const ACTIONS = Object.freeze(["reply", "clarify", "close", "handoff"]);

// The page's seven policy sliders (static/js/counter.js renderPolicy); tests/js/lab/surface-demo-counter.test.mjs keeps
// them in step with the page source and with full_policy() in jev/counter.py.
const LIMITS = deepFreeze({
  person_at: { min: 0, max: 1, step: 0.05, label: "Ask for a person at P ≥" },
  frustration_at: { min: 0, max: 4, step: 0.1, label: "Frustration at score ≥" },
  streak_turns: { min: 1, max: 20, step: 1, label: "Consecutive frustrated turns" },
  missed_at: { min: 0, max: 1, step: 0.05, label: "Missed the point at P ≥" },
  missed_turns: { min: 1, max: 20, step: 1, label: "Total missed turns" },
  intent_min: { min: 0, max: 1, step: 0.05, label: "Clarify below intent P" },
  resolved_at: { min: 0, max: 1, step: 0.05, label: "Close at resolved P ≥" },
});
// decide()'s rules in jev/counter.py, in the order they run.
const RULES = deepFreeze([
  { id: "handed_off", label: "Already handed to a person", keys: [] },
  { id: "asks_for_person", label: "The customer asks for a person", keys: ["person_at"] },
  { id: "frustration_streak", label: "Frustration stayed above the cut for consecutive turns", keys: ["frustration_at", "streak_turns"] },
  { id: "missed_turns", label: "The bot missed the point too often", keys: ["missed_at", "missed_turns"] },
  { id: "resolved", label: "The customer's need is met", keys: ["resolved_at"] },
  { id: "intent_confidence", label: "The intent is uncertain or has no reply template", keys: ["intent_min"] },
]);
// jev/counter.py INTENTS, in question order.
const INTENTS = Object.freeze(["shipping_times", "return_policy", "wholesale_pricing", "subscription_help", "brewing_guide", "order_status", "other"]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const integer = (value) => (Number.isInteger(value) ? value : null);
const textOr = (value, fallback = null) => (typeof value === "string" && value !== "" ? value : fallback);
const plain = (value) => (typeof value === "string" ? value : "");

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A source field: a value, or a function that returns the value now.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("This page cannot do that here.");
  return source[name](...args);
}

const listOf = (source, name) => {
  const value = read(source, name, EMPTY);
  return Array.isArray(value) ? value : EMPTY;
};

function setupOf(source) {
  const setup = read(source, "setup", null);
  return isObject(setup) ? setup : null;
}

// A policy reduced to the sliders' keys with finite values, frozen; null when it is not an object.
function policyCopy(value) {
  if (!isObject(value)) return null;
  return Object.freeze(Object.fromEntries(Object.keys(LIMITS).filter((key) => finite(value[key]) !== null).map((key) => [key, value[key]])));
}

function decisionOf(raw, withCounts) {
  if (!isObject(raw)) return null;
  const out = { action: textOr(raw.action), reply: textOr(raw.reply), reason: textOr(raw.reason) };
  if (withCounts) { out.streak = integer(raw.streak); out.misses = integer(raw.misses); }
  return out;
}

const answerOf = (answers, key) => (isObject(answers) && isObject(answers[key]) ? answers[key] : {});

function evidenceOf(answers) {
  const probs = answerOf(answers, "intent").probabilities;
  const intents = {};
  if (isObject(probs)) for (const [key, p] of Object.entries(probs)) if (finite(p) !== null) intents[key] = p;
  let intent = null;
  for (const [key, p] of Object.entries(intents)) if (intent === null || p > intents[intent]) intent = key;
  return {
    intents,
    evidence: {
      intent,
      intent_prob: intent === null ? null : intents[intent],
      frustration: finite(answerOf(answers, "frustration").score),
      asks_for_person: finite(answerOf(answers, "asks_for_person").noul),
      missed: finite(answerOf(answers, "missed").noul),
      resolved: finite(answerOf(answers, "resolved").noul),
    },
  };
}

function metaOf(raw) {
  const meta = isObject(raw) ? raw : {};
  return { model: textOr(meta.model), latency_ms: finite(meta.latency_ms), question_count: integer(meta.question_count),
    input_tokens: integer(meta.input_tokens), output_tokens: integer(meta.output_tokens), cost_usd: finite(meta.cost_usd), backend: textOr(meta.backend) };
}

function turnItem(turn, index, transcript, current) {
  const said = (offset) => (isObject(transcript[index * 2 + offset]) ? plain(transcript[index * 2 + offset].text) : "");
  const own = Array.isArray(turn.decisions) ? turn.decisions[turn.decisions.length - 1] : null;
  const sent = decisionOf(own, false) || { action: null, reply: null, reason: null };
  const decision = decisionOf(current, true);
  const { intents, evidence } = evidenceOf(turn.answers);
  const choice = answerOf(turn.answers, "intent").choice;
  return {
    n: index + 1,
    customer: said(0),
    bot: said(1),
    sent,
    sent_policy: policyCopy(turn.policy),
    decision,
    changed: !!decision && sent.action !== null && decision.action !== null && (decision.action !== sent.action || decision.reply !== sent.reply),
    evidence,
    intent_choice: textOr(choice),
    intents,
    meta: metaOf(turn.meta),
  };
}

function snapPolicy(settings, changes) {
  if (!isObject(changes) || !Object.keys(changes).length) throw new Error("Name at least one policy setting to change.");
  const next = { ...settings };
  for (const [key, raw] of Object.entries(changes)) {
    const limit = LIMITS[key];
    if (!limit) throw new Error(`There is no policy setting "${key}".`);
    const value = typeof raw === "string" ? toNumber(raw) : finite(raw);
    if (value === null) throw new Error(`${limit.label} must be a number.`);
    if (value < limit.min - 1e-9 || value > limit.max + 1e-9) throw new Error(`${limit.label} must be from ${limit.min} to ${limit.max}.`);
    const steps = (value - limit.min) / limit.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) throw new Error(`${limit.label} moves in steps of ${limit.step}.`);
    next[key] = Number((limit.min + Math.round(steps) * limit.step).toFixed(2));
  }
  return next;
}

// The chat as both surfaces see it.
function chatOf(source) {
  const turns = listOf(source, "turns").filter(isObject);
  const decisions = listOf(source, "decisions");
  const transcript = listOf(source, "transcript");
  const setup = setupOf(source);
  const examples = setup && Array.isArray(setup.examples) ? setup.examples : EMPTY;
  const sample = read(source, "sample", null);
  let index = isObject(sample) ? examples.indexOf(sample) : -1;
  if (index < 0 && isObject(sample)) {
    const key = JSON.stringify(sample);
    index = examples.findIndex((example) => JSON.stringify(example) === key);
  }
  const sampleTurns = isObject(sample) && Array.isArray(sample.turns) ? sample.turns.filter((turn) => typeof turn === "string") : EMPTY;
  const customer = turns.map((_, i) => (isObject(transcript[i * 2]) ? plain(transcript[i * 2].text) : ""));
  const last = decisions.length ? decisions[decisions.length - 1] : null;
  const stopped = turns.length >= MAX_TURNS ? "turn_limit" : isObject(last) && last.action === "handoff" ? "handoff" : null;
  return { turns, decisions, transcript, examples, sample: isObject(sample) ? sample : null, index: index < 0 ? null : index, sampleTurns, customer, stopped,
    following: isObject(sample) && customer.length <= sampleTurns.length && customer.every((text, i) => text === sampleTurns[i]) };
}

const running = (source) => read(source, "running", false) === true;

const shownOf = (source, ctx, items) => () => {
  const list = items().filter((item) => !source.matches || source.matches(item, ctx) !== false);
  const arranged = source.arrange ? source.arrange(list, ctx) : list;
  return Array.isArray(arranged) ? arranged : list;
};

// ---------- counter.turns ----------

// source: {
//   setup: () => the GET /api/counter/setup response ({ examples, policy }) or null,
//   turns: () => the page's S.turns: one response of the page's own turn call per customer turn
//                ({ answers, decisions, policy, meta, trace }), oldest first,
//   transcript: () => [{ speaker, text }] alternating customer and bot,   decisions: () => the current decisions,
//   policy: () => the sliders' values,   decidedWith: () => the policy the current decisions used, or null,
//   sample: () => the example object the chat started from, or null,   draft: () => the unsent message,
//   note: () => the re-decide note,   running: () => boolean,
//   matches: (item, ctx) => boolean   (LAB.matches),     arrange: (items, ctx) => items   (LAB.arrange),
//   setPolicy(next), resetPolicy(), setDraft(text), focusMessage(), inspect(n), refresh()   the page's own operations
//   (setPolicy receives the whole next policy, already checked; focusMessage returns false when the box is disabled)
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function counterTurnsCtx(source = {}) {
  let built = { parts: null, items: EMPTY };
  const items = () => {
    const turns = listOf(source, "turns");
    const decisions = listOf(source, "decisions");
    const transcript = listOf(source, "transcript");
    const parts = [decisions, transcript, ...turns];
    if (!built.parts || built.parts.length !== parts.length || built.parts.some((part, index) => part !== parts[index])) {
      built = { parts, items: deepFreeze(turns.flatMap((turn, index) => (isObject(turn) ? [turnItem(turn, index, transcript, decisions[index])] : []))) };
    }
    return built.items;
  };
  const settings = () => {
    const value = read(source, "policy", null);
    return setupOf(source) && isObject(value) ? value : null;
  };
  const needSetup = () => { if (!setupOf(source) || !settings()) throw new Error("The policy has not loaded yet."); };
  const ctx = {
    items,
    shown: null,
    data: {
      get policy() { return policyCopy(settings()); },
      get decided_with() { return listOf(source, "turns").length ? policyCopy(read(source, "decidedWith", null)) : null; },
      get defaults() { return policyCopy(setupOf(source)?.policy); },
      get changed() {
        const now = settings(), defaults = setupOf(source)?.policy;
        if (!now || !isObject(defaults)) return EMPTY;
        return Object.freeze(Object.keys(LIMITS).filter((key) => finite(now[key]) !== null && finite(defaults[key]) !== null && Math.abs(now[key] - defaults[key]) > 1e-9));
      },
      get limits() { return LIMITS; },
      get rules() { return RULES; },
      get intents() { return INTENTS; },
      get chat() {
        const chat = chatOf(source);
        const sample = chat.sample ? { index: chat.index, label: textOr(chat.sample.label, chat.index === null ? "Example" : `Example ${chat.index + 1}`), turns: chat.sampleTurns.length } : null;
        return deepFreeze({ turns: chat.turns.length, max_turns: MAX_TURNS, max_chars: MAX_CHARS, stopped: chat.stopped, sample,
          following: chat.following, next: chat.sample && chat.turns.length < chat.sampleTurns.length ? chat.sampleTurns[chat.turns.length] : null });
      },
      get draft() { return plain(read(source, "draft", "")); },
      get note() { return plain(read(source, "note", "")); },
      get running() { return running(source); },
    },
    actions: {
      setPolicy(changes) {
        needSetup();
        const now = settings();
        const next = snapPolicy(now, changes);
        if (Object.keys(LIMITS).every((key) => next[key] === now[key])) return policyCopy(now);
        call(source, "setPolicy", next);
        return policyCopy(next);
      },
      resetPolicy() {
        needSetup();
        return call(source, "resetPolicy");
      },
      draftMessage(text, options = {}) {
        if (!setupOf(source)) throw new Error("The chat has not loaded yet.");
        if (typeof text !== "string" || !text.trim()) throw new Error("There is no message to put in the box.");
        if (text.length > MAX_CHARS) throw new Error(`A customer message can be at most ${MAX_CHARS.toLocaleString("en-US")} characters.`);
        if (running(source)) throw new Error("Wait for the current turn to finish.");
        const stopped = chatOf(source).stopped;
        if (stopped === "handoff") throw new Error("This chat was handed to a person. Start a new chat to write another message.");
        if (stopped === "turn_limit") throw new Error(`This chat has reached ${MAX_TURNS} customer turns. Start a new chat.`);
        const draft = plain(read(source, "draft", ""));
        if (draft.trim() && draft !== text && options?.replace !== true) throw new Error("The message box already holds text you typed. Clear it first.");
        call(source, "setDraft", text);
        return text;
      },
      focusMessage() {
        if (!setupOf(source) || running(source) || chatOf(source).stopped || typeof source.focusMessage !== "function") return false;
        return source.focusMessage() !== false;
      },
      inspectTurn(n) {
        const item = Number.isInteger(n) ? items().find((entry) => entry.n === n) : undefined;
        if (!item) throw new Error(`There is no turn ${Number.isInteger(n) ? n : String(n)} in this chat.`);
        return call(source, "inspect", n);
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => `Turn ${item && Number.isInteger(item.n) ? item.n : index + 1}`,
  };
  ctx.shown = shownOf(source, ctx, items);
  return ctx;
}

// ---------- counter.examples ----------

function exampleItem(raw, index, chat) {
  const turns = Array.isArray(raw.turns) ? raw.turns.filter((turn) => typeof turn === "string") : [];
  const active = chat.index === index;
  return { index, position: index + 1, label: plain(raw.label).trim() || `Example ${index + 1}`, turns,
    expect: Array.isArray(raw.expect) ? raw.expect.filter((action) => typeof action === "string") : [],
    active, sent: active ? chat.turns.length : 0, following: active && chat.following };
}

// source: {
//   setup, turns, transcript, decisions, sample, running, policy   as for counterTurnsCtx,
//   matches: (item, ctx) => boolean   (LAB.matches),     arrange: (items, ctx) => items   (LAB.arrange),
//   start(index), newChat(), refresh()   the page's own operations (the chip handlers)
// }
export function counterExamplesCtx(source = {}) {
  let built = { key: null, examples: null, items: EMPTY };
  const items = () => {
    const chat = chatOf(source);
    const key = JSON.stringify([chat.index, chat.turns.length, chat.following]);
    if (chat.examples !== built.examples || key !== built.key) {
      built = { key, examples: chat.examples, items: deepFreeze(chat.examples.flatMap((raw, index) => (isObject(raw) ? [exampleItem(raw, index, chat)] : []))) };
    }
    return built.items;
  };
  const guard = (options) => {
    if (!setupOf(source)) throw new Error("The examples have not loaded yet.");
    if (running(source)) throw new Error("Wait for the current turn to finish before starting another chat.");
    const sent = chatOf(source).turns.length;
    if (sent && options?.discard !== true) throw new Error(`This clears the current chat of ${sent} turn${sent === 1 ? "" : "s"}. Confirm to discard it.`);
  };
  const ctx = {
    items,
    shown: null,
    data: {
      get chat() {
        const chat = chatOf(source);
        return deepFreeze({ index: chat.index, turns: chat.turns.length,
          actions: chat.turns.map((_, i) => (isObject(chat.decisions[i]) ? textOr(chat.decisions[i].action) : null)),
          sent_actions: chat.turns.map((turn) => {
            const own = Array.isArray(turn.decisions) ? turn.decisions[turn.decisions.length - 1] : null;
            return isObject(own) ? textOr(own.action) : null;
          }),
          stopped: chat.stopped });
      },
      get defaults_in_force() {
        const now = read(source, "policy", null), defaults = setupOf(source)?.policy;
        if (!isObject(now) || !isObject(defaults)) return false;
        return Object.keys(LIMITS).every((key) => finite(now[key]) !== null && finite(defaults[key]) !== null && Math.abs(now[key] - defaults[key]) <= 1e-9);
      },
      get running() { return running(source); },
      max_turns: MAX_TURNS,
      max_chars: MAX_CHARS,
      actions: ACTIONS,
    },
    actions: {
      start(index, options = {}) {
        const item = Number.isInteger(index) ? items().find((entry) => entry.index === index) : undefined;
        if (!setupOf(source)) throw new Error("The examples have not loaded yet.");
        if (!item) throw new Error(`There is no example ${Number.isInteger(index) ? index + 1 : String(index)}.`);
        guard(options);
        return call(source, "start", item.index);
      },
      newChat(options = {}) {
        guard(options);
        return call(source, "newChat");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.label === "string" && item.label ? item.label : String(index + 1)),
  };
  ctx.shown = shownOf(source, ctx, items);
  return ctx;
}
