// Lab surfaces of the Shield page (static/shield.html, static/js/shield.js): the inbox and the opened message's verdict.
// Pure code: it imports only the kit, touches no DOM, storage or network, and is tested in Node
// (tests/js/lab/surface-demo-shield.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/shield.mjs
// (sampleShieldInboxCtx, sampleShieldResultCtx); starter packs: static/js/lab/packs/shield/. This header is the
// CONTRACT for packs on these two surfaces.
//
// Both ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) } and are built ONCE per page
// load: everything is read through the page's callbacks at call time, so a ctx never goes stale. items() and shown()
// return the SAME frozen item objects (compare by identity) until the message, its result, the selection or the
// defaults change. Items and every data value are deeply frozen plain JSON: read them, never write to them. Every data
// field is a live getter: read it when you need it, do not keep a copy across renders.
// Neither surface has replaceItems or importItems, so Edits (transform) and Paste to import (importer) do not render
// here: the inbox is the demo's fixed scenario list and the verdicts are the record of calls the user made.
// Kinds both surfaces host: fact, diagnostic, metric, exporter, command, tool, panel (and behavior).
//
// NO ACTION HERE CALLS THE MODEL, and no pack may cause a model call. Opening an unscreened message in the page asks
// Jev, so open(id) refuses one; re-scoring with other weights is pure code on the server (POST /api/shield/rescore,
// "0 Jev calls") and runs only through the page's own slider path (setWeights / setPolicy / resetPolicy).
//
// Shared shapes (both surfaces):
//   ANSWER  one question's answer, normalized from the response:
//     { type,           "noul" | "score" | "choice" (from the answer's type, or inferred from its value field); "" if odd
//       value,          noul: P(yes) 0..1 · score: the score, a float 0..scale · choice: the chosen key · null if missing
//       probabilities,  { key: p } of score levels ("0", "1", ...) or choice options, finite numbers only; {} for noul
//       top,            { key, p } the most likely entry of probabilities (the first on a tie), or null (always for noul)
//       confidence,     the answer's own confidence field, or null
//       scale,          score only: the highest level index (2 for pressure, 3 for harm_if_obeyed); otherwise null
//       legend }        score only: { "0": "None: no deadline or urgency", ... } as the response sent it; otherwise null
//     The ten Shield questions (jev/shield.py questions()): Nouls ai_instructions, credential_request, payment_change,
//     secrecy_or_bypass, link_lure, unexpected_reward; Scores pressure (0-2) and harm_if_obeyed (0-3); Choices
//     claimed_identity (bean_brokers, packright, coastline_freight, sparkle_facility, harbor_coffee, customer_or_person,
//     other_organization) and category (customer_request, vendor_business, wholesale, internal, marketing, other).
//   VERDICT  what code decided from the answers (jev/shield.py verdict()), with the page's CURRENT weights once a
//     re-score has come back:
//     { level,          "safe" | "review" | "quarantine", or null when the server sent something else
//       risk,           noisy-OR combined risk 0..1, or null
//       harm,           the harm_if_obeyed score 0..3, or null
//       rules,          [{ id, action, text }] hard rules that fired, in the server's order. ids: prompt_injection,
//                       credential_phish (action quarantine), impersonation (quarantine), unverified_sender (review)
//       drivers,        signal ids whose contribution is >= 0.15, strongest first, at most 3
//       category,       the chosen category key, or null
//       signals }       [{ id, label, value, weight, contribution }] the eight signals in jev/shield.py order
//                       (numbers or null). label is the server's wording ("Instructs an AI / automation").
//   FACT  the code checks once Jev named the claimed sender (jev/shield.py facts()):
//     { sender_domain (string, "" when the address has no @), claimed_identity (key or null), claimed_label (string),
//       claimed_identity_prob (0..1 or null), expected_domain (string, or null for a customer or other organization),
//       domain_matches (true | false | null when there is nothing to verify), lookalike_domain (boolean) }
//   META  the server's measurements of that one call; every field may be null:
//     { model, latency_ms, question_count, input_tokens, output_tokens, cost_usd (measured, not an estimate), backend }
//   A RESULT part, carried by every inbox item and by data.compose / the result surface's data:
//     status   "unscreened" (no result in this session) | "screened" | "failed" | "skipped" (the batch stopped first)
//     error    the failure message for failed/skipped, otherwise null
//     verdict, answers ({ questionId: ANSWER }), fact, meta   null unless status is "screened"
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "shield.inbox"  —  builder shieldInboxCtx(source)  —  the Inbox panel (and the batch table under it)
// ---------------------------------------------------------------------------------------------------------------
// The list is the inbox messages (GET /api/scenarios .inbox, jev/scenarios.py) in page order, each joined with the
// result of the CURRENT USER'S OWN latest screen of it in this page session, if any. The "Write your own" entry is not
// an item: it always stays at the end of the list, and its draft and result are data.compose. The page has no filter
// or sort of its own, so shown() is items() after Lab's filters and Lab's sort; the inbox lists exactly those, and so
// does the "Whole inbox, screened in parallel" table (rows of hidden messages are left out, its totals stay whole).
// "Scan whole inbox" still screens every message: a Lab filter never narrows a paid run.
//
// Item (one message):
//   id            string   the scenario id, e.g. "bec-invoice" (unique; "message-<position>" if the server sent none)
//   position      integer  1-based position in the inbox
//   from_name, from_email, subject, body   strings exactly as the page shows them ("" when missing)
//   sender_domain string   the part after the last "@" of from_email, trimmed and lowercased ("" without an @): the
//                          same string jev/shield.py compares, available before any screen
//   attachments   string[] the attachment names (picture names; Shield sends no picture to Jev)
//   note          string   the scenario note the page shows under the message ("Scenario note (not sent to Jev)"); ""
//   expected      "safe" | "review" | "quarantine" | null   what the message text alone should make Shield do, as the
//                          batch table's "expected" column shows it; null for a message without a scenario label
//   attack        boolean | null   scenario ground truth: acting on it would be harmful (null without a label)
//   selected      boolean  the message is the one opened now
//   pending       boolean  a screen of this message is on its way (its previous result, if any, is still the item's)
//   status, error, verdict, answers, fact, meta   its RESULT part (shapes above)
//   matched       boolean | null   verdict.level === expected; null when either is missing
// itemName(item) is "#<position> <from_name>" (from_name cut to 24 characters).
//
// data (live getters):
//   selected       string | null   the opened message's id; null while "Write your own" is open or nothing is
//   compose        { open (boolean), live (boolean: "Live: re-screen as you type" is on), draft: { from_name,
//                  from_email, subject, body }, pending (boolean), stale (boolean: there is a screened result and the
//                  draft no longer holds the text it was made for), ...RESULT part of the draft's latest screen }
//   weights        { signalId: number } the page's current weights, or null before the first verdict arrives
//   policy         { review_at, quarantine_at, hard_rule_at } the page's current thresholds, or null before it
//   defaults       { weights, policy } as the first verdict brought them (what "Reset to defaults" restores), or null
//   signal_names   { signalId: slider name } the page's slider labels ("Instructs an AI", ...), in slider order
//   identity_labels, category_labels   { key: label } the page's labels for the two Choice questions
//   rules          the cut-offs jev/shield.py applies, as page copy: { hot: 0.15 (a signal row is highlighted and
//                  counts as a driver at or above this contribution), max_drivers: 3, mismatch_prob: 0.6 (a domain
//                  mismatch quarantines or holds only when P(claimed identity) is at least this), risky_ask: 0.5
//                  (payment_change, credential_request or link_lure at or above this makes a mismatch an
//                  impersonation), harm_quarantine: 2.5 (harm at or above this turns a review into a quarantine) }
//   batch          null until "Scan whole inbox" returned in this session, then the latest batch:
//                  { count, completed, failed (no verdict, skipped included), skipped, wall_ms, sum_latency_ms,
//                    total_cost_usd, total_input_tokens, stopped (string | null) } — measured, not estimates
//   scanning       boolean: "Scan whole inbox" is on its way
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them only from a
// command or a control the user just pressed, one call per press, never from a fact, metric, check or render):
//   open(id)            opens a message exactly as clicking it does. Guard: the id must be in items() AND have a
//                       result of this session (any status): clicking an unscreened message asks Jev, so this refuses.
//                       Returns the id.
//   openCompose()       opens "Write your own" as it is. Never screens. No guard.
//   draftCompose(fields)  puts { from_name?, from_email?, subject?, body? } (strings) into the "Write your own" form
//                       and opens it WITHOUT screening, even with Live on (the user's next edit or "Screen message"
//                       asks, as always). Guard: an object of only those keys, string values, and the merged draft
//                       must keep a nonblank subject or body. Returns the merged draft.
//   setWeights(partial) moves weight sliders: { signalId: number } for ids in data.signal_names, each 0..1 in the
//                       sliders' steps of 0.05. Goes through the page's slider path, so every verdict is re-scored by
//                       pure code (no Jev call) and the lists refresh when it returns (asynchronously). Guard: refuses
//                       before the first verdict (data.weights is null), on an unknown id, an empty object, or a value
//                       out of range or off-step. Returns the full weights it set.
//   setPolicy(partial)  the same for the thresholds { review_at?, quarantine_at?, hard_rule_at? }, same guards. Like
//                       the sliders, it does not force review_at below quarantine_at.
//   resetPolicy()       the page's "Reset to defaults". Guard: refuses before defaults exist.
//   inspect(id)         opens the page's Inspect JSON drawer on that message's own request and response. Guard: the
//                       id must be in items() and its result must carry a trace (status "screened").
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "shield.result"  —  builder shieldResultCtx(source)  —  the Verdict panel of the opened message
// ---------------------------------------------------------------------------------------------------------------
// The list is the opened message's eight weighted signals ("Signals · Noul probabilities, weighted in code"), in the
// page's order: strongest contribution first (a stable sort of the verdict's signals). [] while the opened message
// (or the "Write your own" draft) has no screened result. shown() is items() after Lab's filters and Lab's sort; the
// panel lists exactly those rows. The verdict, identity, category and harm blocks are data and stay whole.
//
// Item (one signal):
//   id              "ai_instructions" | "credential_request" | "payment_change" | "secrecy_or_bypass" | "link_lure" |
//                   "unexpected_reward" | "pressure" | "identity_mismatch"
//   position        integer  1-based in jev/shield.py's signal order (the order of data.signal_names)
//   rank            integer  1-based in the page's order (strongest contribution first)
//   label           string   the server's label, as the row shows it ("Sender domain mismatch (code check)")
//   name            string   the page's slider name ("Domain mismatch"); the label when the page has none
//   source          "noul" (its question's P(yes)) | "score" (pressure: score / 2) | "code" (identity_mismatch:
//                   P(claimed identity) when the code's domain check failed, else 0)
//   question        the question id it reads: the signal id itself, or "claimed_identity" for identity_mismatch
//   value           number 0..1 or null   the signal value the weight multiplies
//   weight          number or null        the weight the verdict used
//   default_weight  number or null        data.defaults.weights[id]; null before defaults exist
//   contribution    number or null        min(1, weight × value), the row's "→" number
//   hot             boolean  contribution >= 0.15 (the page highlights the row)
//   driver          boolean  the id is in verdict.drivers
//   rules           string[] ids of fired hard rules that read this signal: prompt_injection -> ai_instructions;
//                   credential_phish -> credential_request; unverified_sender -> identity_mismatch; impersonation ->
//                   identity_mismatch plus each of payment_change, credential_request, link_lure whose value is >= 0.5
//   answer          ANSWER of its question, or null when the response lacks it
// itemName(item) is item.label.
//
// data (live getters):
//   id          string | null   the opened message's id; null for "Write your own" and before anything is opened
//   compose     boolean         "Write your own" is open
//   message     { from_name, from_email, subject, body } | null   the opened message (for compose: the draft NOW)
//   note, expected               as on the inbox item; "" / null for compose
//   status, error, verdict, answers, fact, meta   the opened message's RESULT part
//   pending     boolean         a screen of the opened message is on its way
//   stale       boolean         compose only: the draft changed after its screened result was made; false otherwise
//   request     { state, questions, model } | null   the exact request of the shown result (inputs and questions, no
//               answers), for handoffs; null unless status is "screened" and the page holds its trace
//   weights, policy, defaults, signal_names, identity_labels, category_labels, rules   as on shield.inbox
//
// actions: setWeights, setPolicy, resetPolicy (as on shield.inbox) and
//   inspect()   opens the Inspect JSON drawer on the shown result. Guard: refuses unless data.request is not null.
//
// refresh() re-renders that surface's list only (the inbox and its batch table; the Verdict panel). The page renders
// the Lab sections itself when a result, the selection or the weights change.
//
// CONTENT BOUNDARIES (both surfaces)
//   - Every verdict, answer, probability, latency, token count and cost here comes from a call the current user made
//     in this page session (a click, "Re-screen", "Screen message", Live typing or "Scan whole inbox"). Show them as
//     they are; never store them, never replay them, never fill a gap with a guess or a sample answer, and never show
//     an answer for a message that has none (status "unscreened").
//   - note, expected and attack are scenario notes written with the demo and NEVER sent to Jev. Anything that shows or
//     exports them says so ("scenario note", "expected from the text"), and never presents them as model output.
//   - A local re-computation (noisy-OR with other weights, risk without a signal, distance to a threshold) is plain
//     arithmetic on the user's answers, labeled as a local estimate: the page's verdict (jev/shield.py, through the
//     re-score endpoint) stays the decision. To change the verdict a pack moves the page's own sliders (setWeights).
//   - Exports say what they hold: one with message text or answers says so in its label or help; a handoff or
//     "request" export carries data.request only (state, questions, model), never answers, verdicts or meta. Weights
//     and thresholds are settings and may be exported freely. CSV goes through the kit's csvText/csvCell.
//   - Metrics over meta are measurements of this session's calls, labeled as measured; a projection (cost per
//     thousand messages) is arithmetic on measured calls and says so; it is never shown as spend.
//   - Lab filters and sorts are presentation only: they never change a verdict, the weights, what is screened or what
//     "Scan whole inbox" sends. Nothing here holds the API key.
import { clone } from "../kit.js";

const EMPTY = Object.freeze([]);
const LEVELS = Object.freeze(["safe", "review", "quarantine"]);
const DRAFT_FIELDS = Object.freeze(["from_name", "from_email", "subject", "body"]);
const POLICY_KEYS = Object.freeze(["review_at", "quarantine_at", "hard_rule_at"]);
// Mirrors jev/shield.py verdict(); tests/js/lab/surface-demo-shield.test.mjs keeps these in step with the Python.
const RULES = Object.freeze({ hot: 0.15, max_drivers: 3, mismatch_prob: 0.6, risky_ask: 0.5, harm_quarantine: 2.5 });
const SIGNAL_SOURCES = Object.freeze({
  ai_instructions: "noul", credential_request: "noul", payment_change: "noul", secrecy_or_bypass: "noul", link_lure: "noul",
  unexpected_reward: "noul", pressure: "score", identity_mismatch: "code",
});
const RISKY_ASKS = Object.freeze(["payment_change", "credential_request", "link_lure"]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value) => (typeof value === "string" ? value : "");
const textOrNull = (value) => (typeof value === "string" && value !== "" ? value : null);
const integerOrNull = (value) => (Number.isInteger(value) ? value : null);

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

// The same string jev/shield.py _domain() compares. (Not exported: every export of this module is a LAB builder.)
function senderDomain(email) {
  const text = str(email);
  return text.includes("@") ? text.slice(text.lastIndexOf("@") + 1).trim().toLowerCase() : "";
}

// ---------- normalizing one result ----------

function answerOf(raw) {
  if (!isObject(raw)) return null;
  const type = typeof raw.type === "string" ? raw.type
    : "noul" in raw ? "noul" : "score" in raw ? "score" : "choice" in raw ? "choice" : "";
  const probabilities = {};
  if (type !== "noul" && isObject(raw.probabilities)) {
    for (const [key, p] of Object.entries(raw.probabilities)) if (finite(p) !== null) probabilities[key] = p;
  }
  let value = null, scale = null, legend = null;
  if (type === "noul") value = finite(raw.noul);
  else if (type === "score") {
    value = finite(raw.score);
    if (isObject(raw.legend)) legend = Object.fromEntries(Object.entries(raw.legend).map(([key, text]) => [key, str(text)]));
    const levels = legend ? Object.keys(legend).length : Object.keys(probabilities).length;
    scale = levels ? levels - 1 : null;
  } else if (type === "choice") value = textOrNull(raw.choice);
  let top = null;
  for (const [key, p] of Object.entries(probabilities)) if (!top || p > top.p) top = { key, p };
  return { type, value, probabilities, top, confidence: finite(raw.confidence), scale, legend };
}

function answersOf(raw) {
  if (!isObject(raw)) return null;
  const out = {};
  for (const [id, answer] of Object.entries(raw)) {
    const normalized = answerOf(answer);
    if (normalized) out[id] = normalized;
  }
  return out;
}

function verdictOf(raw) {
  if (!isObject(raw)) return null;
  return {
    level: LEVELS.includes(raw.level) ? raw.level : null,
    risk: finite(raw.risk),
    harm: finite(raw.harm),
    rules: (Array.isArray(raw.rules) ? raw.rules : []).filter(isObject).map((rule) => ({ id: str(rule.id), action: str(rule.action), text: str(rule.text) })),
    drivers: (Array.isArray(raw.drivers) ? raw.drivers : []).filter((id) => typeof id === "string"),
    category: textOrNull(raw.category),
    signals: (Array.isArray(raw.signals) ? raw.signals : []).filter(isObject).map((signal) => ({ id: str(signal.id), label: str(signal.label),
      value: finite(signal.value), weight: finite(signal.weight), contribution: finite(signal.contribution) })),
  };
}

function factOf(raw) {
  if (!isObject(raw)) return null;
  return {
    sender_domain: str(raw.sender_domain),
    claimed_identity: textOrNull(raw.claimed_identity),
    claimed_label: str(raw.claimed_label),
    claimed_identity_prob: finite(raw.claimed_identity_prob),
    expected_domain: textOrNull(raw.expected_domain),
    domain_matches: typeof raw.domain_matches === "boolean" ? raw.domain_matches : null,
    lookalike_domain: raw.lookalike_domain === true,
  };
}

function metaOf(raw) {
  if (!isObject(raw)) return null;
  return { model: textOrNull(raw.model), latency_ms: finite(raw.latency_ms), question_count: integerOrNull(raw.question_count),
    input_tokens: integerOrNull(raw.input_tokens), output_tokens: integerOrNull(raw.output_tokens), cost_usd: finite(raw.cost_usd),
    backend: textOrNull(raw.backend) };
}

// The RESULT part of one raw page result (the page's own screening response, or a batch entry without a verdict).
function resultPart(raw) {
  if (!isObject(raw)) return { status: "unscreened", error: null, verdict: null, answers: null, fact: null, meta: null };
  if (isObject(raw.verdict)) {
    return { status: "screened", error: null, verdict: verdictOf(raw.verdict), answers: answersOf(raw.answers), fact: factOf(raw.fact), meta: metaOf(raw.meta) };
  }
  return { status: raw.skipped ? "skipped" : "failed", error: textOrNull(raw.error), verdict: null, answers: null, fact: null, meta: null };
}

const traceOf = (raw) => (isObject(raw) && isObject(raw.verdict) && isObject(raw.trace) ? raw.trace : null);

function messageFields(raw) {
  return Object.fromEntries(DRAFT_FIELDS.map((key) => [key, str(raw?.[key])]));
}

// Whether the draft no longer holds the message its screened result was made for.
function draftStale(draft, raw) {
  const sent = traceOf(raw)?.request?.state?.message;
  if (!isObject(sent)) return false;
  return DRAFT_FIELDS.some((key) => str(draft[key]) !== str(sent[key]));
}

function expectedOf(label) {
  if (!label) return null;
  return typeof label.shield === "string" && label.shield ? label.shield : label.attack ? "quarantine" : "safe";
}

function inboxItem(message, index, raw, selected, pending) {
  const label = isObject(message.label) ? message.label : null;
  const expected = expectedOf(label);
  const part = resultPart(raw);
  const level = part.verdict?.level || null;
  return deepFreeze({
    id: textOrNull(message.id) || `message-${index + 1}`,
    position: index + 1,
    ...messageFields(message),
    sender_domain: senderDomain(message.from_email),
    attachments: (Array.isArray(message.attachments) ? message.attachments : []).filter(isObject).map((entry) => str(entry.name) || str(entry.sample)).filter(Boolean),
    note: str(label?.expect),
    expected,
    attack: typeof label?.attack === "boolean" ? label.attack : null,
    selected,
    pending,
    ...part,
    matched: level && expected ? level === expected : null,
  });
}

// ---------- the page state both surfaces read ----------

function pageState(source) {
  const composeId = typeof source.composeId === "string" ? source.composeId : "__compose__";
  const inbox = () => {
    const list = read(source, "inbox", EMPTY);
    return Array.isArray(list) ? list : EMPTY;
  };
  const results = () => {
    const map = read(source, "results", null);
    return isObject(map) ? map : {};
  };
  const resultFor = (id) => {
    const raw = Object.prototype.hasOwnProperty.call(results(), id) ? results()[id] : null;
    return isObject(raw) ? raw : null;
  };
  const selectedRaw = () => {
    const value = read(source, "selected", null);
    return typeof value === "string" ? value : null;
  };
  const pendingSet = () => {
    const value = read(source, "pending", null);
    return new Set(value instanceof Set ? value : Array.isArray(value) ? value : []);
  };
  const draft = () => messageFields(read(source, "draft", {}));
  const labels = () => {
    const value = read(source, "labels", {});
    return isObject(value) ? value : {};
  };
  const labelMap = (name) => {
    const value = labels()[name];
    return deepFreeze(isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, text]) => [key, str(text)])) : {});
  };
  const numberMap = (value) => (isObject(value) ? Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (finite(entry) === null ? [] : [[key, entry]]))) : null);
  const weights = () => deepFreeze(numberMap(read(source, "weights", null)));
  const policy = () => deepFreeze(numberMap(read(source, "policy", null)));
  const defaults = () => {
    const value = read(source, "defaults", null);
    if (!isObject(value)) return null;
    return deepFreeze({ weights: numberMap(value.weights) || {}, policy: numberMap(value.policy) || {} });
  };

  // One item per raw message object, rebuilt only when its result, selection or pending state changes.
  const cache = new WeakMap();
  const items = () => {
    const selected = selectedRaw();
    const pending = pendingSet();
    const out = [];
    inbox().forEach((message, index) => {
      if (!isObject(message)) return;
      const id = textOrNull(message.id) || `message-${index + 1}`;
      const raw = resultFor(id);
      const isSelected = selected === id;
      const isPending = pending.has(id);
      const known = cache.get(message);
      if (known && known.raw === raw && known.index === index && known.selected === isSelected && known.pending === isPending) {
        out.push(known.item);
        return;
      }
      const item = inboxItem(message, index, raw, isSelected, isPending);
      cache.set(message, { raw, index, selected: isSelected, pending: isPending, item });
      out.push(item);
    });
    return out;
  };
  const find = (id) => {
    const item = items().find((entry) => entry.id === id);
    if (!item) throw new Error(`There is no message "${str(id) || String(id)}" in the inbox.`);
    return item;
  };

  const actions = {
    setWeights(partial) {
      const current = weights();
      if (!current) throw new Error("Screen a message first: the weights arrive with the first verdict.");
      const known = Object.keys(labelMap("signals")).length ? Object.keys(labelMap("signals")) : Object.keys(current);
      const next = checkedValues(partial, known, "signal");
      call(source, "applyPolicy", { weights: next, policy: null });
      return { ...current, ...next };
    },
    setPolicy(partial) {
      const current = policy();
      if (!current) throw new Error("Screen a message first: the thresholds arrive with the first verdict.");
      const next = checkedValues(partial, POLICY_KEYS, "threshold");
      call(source, "applyPolicy", { weights: null, policy: next });
      return { ...current, ...next };
    },
    resetPolicy() {
      if (!defaults()) throw new Error("There are no defaults yet: they arrive with the first verdict.");
      return call(source, "resetPolicy");
    },
  };

  const shared = {
    get weights() { return weights(); },
    get policy() { return policy(); },
    get defaults() { return defaults(); },
    get signal_names() { return labelMap("signals"); },
    get identity_labels() { return labelMap("identities"); },
    get category_labels() { return labelMap("categories"); },
    get rules() { return RULES; },
  };

  return { composeId, inbox, results, resultFor, selectedRaw, pendingSet, draft, items, find, actions, shared, defaults };
}

// partial: { key: number } for keys in `known`, each 0..1 in steps of 0.05 (the sliders' range and step).
function checkedValues(partial, known, what) {
  if (!isObject(partial) || !Object.keys(partial).length) throw new Error(`Name at least one ${what} to set.`);
  const out = {};
  for (const [key, value] of Object.entries(partial)) {
    if (!known.includes(key)) throw new Error(`There is no ${what} "${key}" on this page.`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${key} must be a number from 0 to 1.`);
    const steps = value * 20;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) throw new Error(`${key} moves in steps of 0.05, like its slider.`);
    out[key] = Math.round(steps) / 20;
  }
  return out;
}

function shownOf(source, ctx) {
  const list = ctx.items().filter((item) => typeof source.matches !== "function" || source.matches(item, ctx) !== false);
  const arranged = typeof source.arrange === "function" ? source.arrange(list, ctx) : list;
  return Array.isArray(arranged) ? arranged : list;
}

// ---------- shield.inbox ----------

// source: {
//   inbox()      the page's S.inbox (raw scenario messages)       results()   the page's S.results (id -> raw result)
//   selected()   the opened id (composeId for "Write your own")   composeId   the page's id for the draft ("__compose__")
//   draft()      the draft { from_name, from_email, subject, body }   live()   whether Live is on
//   pending()    the ids with a screen in flight (Set or array)   scanning()  whether "Scan whole inbox" is in flight
//   weights(), policy(), defaults()   the page's current weights/thresholds and the first verdict's defaults
//   batch()      the latest "Scan whole inbox" response of this session, or null
//   labels()     { signals: SIGNAL_NAMES, identities: IDENTITY_LABELS, categories: CATEGORY_LABELS }
//   matches(item, ctx), arrange(items, ctx)   LAB.matches / LAB.arrange for this surface
//   open(id), openCompose(), draftCompose(fields), applyPolicy({ weights, policy }), resetPolicy(),
//   inspect(trace, title), refresh()   the page's own operations (none of them may ask Jev)
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function shieldInboxCtx(source = {}) {
  const page = pageState(source);
  const ctx = {
    items: page.items,
    shown: () => shownOf(source, ctx),
    data: Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(page.shared),
      selected: { enumerable: true, get() { const id = page.selectedRaw(); return id === page.composeId ? null : id; } },
      compose: { enumerable: true, get() {
        const raw = page.resultFor(page.composeId);
        const draft = page.draft();
        return deepFreeze({ open: page.selectedRaw() === page.composeId, live: read(source, "live", false) === true, draft,
          pending: page.pendingSet().has(page.composeId), stale: draftStale(draft, raw), ...resultPart(raw) });
      } },
      batch: { enumerable: true, get() { return batchOf(read(source, "batch", null)); } },
      scanning: { enumerable: true, get() { return read(source, "scanning", false) === true; } },
    }),
    actions: {
      ...page.actions,
      open(id) {
        const item = page.find(id);
        if (item.status === "unscreened") throw new Error(`“${item.subject || item.id}” has not been screened in this session. Opening it asks Jev, so click it in the inbox yourself.`);
        call(source, "open", item.id);
        return item.id;
      },
      openCompose: () => call(source, "openCompose"),
      draftCompose(fields) {
        if (!isObject(fields)) throw new Error("Give the draft as { from_name, from_email, subject, body }.");
        for (const [key, value] of Object.entries(fields)) {
          if (!DRAFT_FIELDS.includes(key)) throw new Error(`A draft has no field "${key}".`);
          if (typeof value !== "string") throw new Error(`${key} must be text.`);
        }
        const merged = { ...page.draft(), ...fields };
        if (!merged.subject.trim() && !merged.body.trim()) throw new Error("A message needs a subject or a body.");
        call(source, "draftCompose", { ...merged });
        return merged;
      },
      inspect(id) {
        const item = page.find(id);
        const trace = traceOf(page.resultFor(item.id));
        if (!trace) throw new Error(`“${item.subject || item.id}” has no screened request to inspect yet.`);
        return call(source, "inspect", trace, "Shield · one Jev request");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => {
      const position = Number.isInteger(item?.position) ? item.position : index + 1;
      const name = str(item?.from_name).trim();
      return name ? `#${position} ${name.length > 24 ? `${name.slice(0, 23)}…` : name}` : `#${position}`;
    },
  };
  return ctx;
}

function batchOf(raw) {
  if (!isObject(raw)) return null;
  const results = (Array.isArray(raw.results) ? raw.results : []).filter(isObject);
  const failed = results.filter((entry) => !isObject(entry.verdict));
  return deepFreeze({
    count: results.length,
    completed: integerOrNull(raw.completed) ?? results.length - failed.length,
    failed: failed.length,
    skipped: failed.filter((entry) => entry.skipped).length,
    wall_ms: finite(raw.wall_ms),
    sum_latency_ms: results.reduce((sum, entry) => sum + (finite(entry.meta?.latency_ms) || 0), 0),
    total_cost_usd: finite(raw.total_cost_usd),
    total_input_tokens: finite(raw.total_input_tokens),
    stopped: textOrNull(raw.stopped),
  });
}

// ---------- shield.result ----------

function signalRules(id, value, fired) {
  const out = [];
  for (const rule of fired) {
    if (rule.id === "prompt_injection" && id === "ai_instructions") out.push(rule.id);
    else if (rule.id === "credential_phish" && id === "credential_request") out.push(rule.id);
    else if (rule.id === "unverified_sender" && id === "identity_mismatch") out.push(rule.id);
    else if (rule.id === "impersonation" && (id === "identity_mismatch" || (RISKY_ASKS.includes(id) && value !== null && value >= RULES.risky_ask))) out.push(rule.id);
  }
  return out;
}

function signalItems(raw, defaults, names) {
  const part = resultPart(raw);
  if (part.status !== "screened") return EMPTY;
  const verdict = part.verdict;
  // The page's order: [...v.signals].sort((x, y) => y.contribution - x.contribution) on the raw signals.
  const rawSignals = (Array.isArray(raw.verdict.signals) ? raw.verdict.signals : []).filter(isObject);
  const order = [...rawSignals].sort((x, y) => y.contribution - x.contribution);
  return deepFreeze(order.map((signal, rank) => {
    const position = rawSignals.indexOf(signal) + 1;
    const id = str(signal.id);
    const value = finite(signal.value);
    const contribution = finite(signal.contribution);
    const question = id === "identity_mismatch" ? "claimed_identity" : id;
    return {
      id, position, rank: rank + 1, label: str(signal.label), name: names[id] || str(signal.label),
      source: SIGNAL_SOURCES[id] || "noul", question, value, weight: finite(signal.weight),
      default_weight: finite(defaults?.weights?.[id]), contribution,
      hot: contribution !== null && contribution >= RULES.hot, driver: verdict.drivers.includes(id),
      rules: signalRules(id, value, verdict.rules), answer: part.answers?.[question] || null,
    };
  }));
}

// source: the same fields as shieldInboxCtx, with matches/arrange/refresh for this surface. It reads the opened
// message from selected() and its result from results().
export function shieldResultCtx(source = {}) {
  const page = pageState(source);
  const current = () => {
    const id = page.selectedRaw();
    if (id === null) return { id: null, compose: false, message: null, raw: null };
    if (id === page.composeId) return { id: null, compose: true, message: page.draft(), raw: page.resultFor(id) };
    const message = page.inbox().find((entry) => isObject(entry) && entry.id === id) || null;
    return { id, compose: false, message: message ? messageFields(message) : null, label: isObject(message?.label) ? message.label : null, raw: page.resultFor(id) };
  };
  let built = { raw: undefined, defaults: undefined, items: EMPTY };
  const items = () => {
    const { raw } = current();
    const defaults = page.defaults();
    const key = JSON.stringify(defaults);
    if (built.raw !== raw || built.defaults !== key) built = { raw, defaults: key, items: signalItems(raw, defaults, page.shared.signal_names) };
    return built.items;
  };
  const requests = new WeakMap();
  const requestOf = (raw) => {
    const request = traceOf(raw)?.request;
    if (!isObject(request)) return null;
    if (!requests.has(request)) requests.set(request, deepFreeze(clone({ state: request.state ?? null, questions: request.questions ?? null, model: request.model ?? null })));
    return requests.get(request);
  };
  const ctx = {
    items,
    shown: () => shownOf(source, ctx),
    data: Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(page.shared),
      id: { enumerable: true, get() { return current().id; } },
      compose: { enumerable: true, get() { return current().compose; } },
      message: { enumerable: true, get() { return deepFreeze(current().message); } },
      note: { enumerable: true, get() { return str(current().label?.expect); } },
      expected: { enumerable: true, get() { const now = current(); return now.compose ? null : expectedOf(now.label); } },
      status: { enumerable: true, get() { return resultPart(current().raw).status; } },
      error: { enumerable: true, get() { return resultPart(current().raw).error; } },
      verdict: { enumerable: true, get() { return deepFreeze(resultPart(current().raw).verdict); } },
      answers: { enumerable: true, get() { return deepFreeze(resultPart(current().raw).answers); } },
      fact: { enumerable: true, get() { return deepFreeze(resultPart(current().raw).fact); } },
      meta: { enumerable: true, get() { return deepFreeze(resultPart(current().raw).meta); } },
      pending: { enumerable: true, get() { const id = page.selectedRaw(); return id !== null && page.pendingSet().has(id); } },
      stale: { enumerable: true, get() { const now = current(); return now.compose ? draftStale(now.message, now.raw) : false; } },
      request: { enumerable: true, get() { return requestOf(current().raw); } },
    }),
    actions: {
      ...page.actions,
      inspect() {
        const trace = traceOf(current().raw);
        if (!trace) throw new Error("The opened message has no screened request to inspect yet.");
        return call(source, "inspect", trace, "Shield · one Jev request");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.label === "string" && item.label ? item.label : String(index + 1)),
  };
  return ctx;
}
