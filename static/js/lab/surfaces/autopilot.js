// Lab surfaces of the Autopilot page (static/autopilot.html, static/js/autopilot.js): Shield + Dispatch merged into
// ONE Jev call per email, an "integrated" world where Shield gates Dispatch, a "Dispatch alone" world fed the same
// answers, and a benchmark of separate vs merged requests. Pure code: it imports only the kit, touches no DOM,
// storage or network, and is tested in Node (tests/js/lab/surface-demo-autopilot.test.mjs). Fixtures for pack tests:
// tests/js/lab/fixtures/autopilot.mjs (sampleRecordsCtx, sampleInboxCtx, sampleBenchmarkCtx).
//
// ============================== CONTRACT FOR PACK AUTHORS ==============================
//
// Every ctx is { items(), shown(), data, actions, refresh(), itemName(item, index) } and is built ONCE per page load:
// items(), shown() and every data field read the page's state at call time, so never keep a copy across renders.
// Items and data values are deeply frozen plain JSON objects: read them, never write to them. items() hands out the
// SAME item object for an unchanged email (compare by identity) and a new one when the server sends a new record.
//
// None of the three surfaces has replaceItems or importItems, so Edits (transform) and Paste to import (importer)
// never render here. The emails are built-in scenarios that scripts/validate.py checks against the live model (their
// text, order, labels and attachments must not change), and a record is the outcome of a call the user made: an
// edited or pasted record would be a made-up answer. Kinds these surfaces host: fact, diagnostic, metric, exporter,
// command, tool, panel (and behavior). autopilot.benchmark has no list, so facts and item checks have nothing to read
// there: it hosts metrics, exporters, commands, tools and panels.
//
// WHO SEES WHAT. The page lists the 11 built-in emails of Harbor Coffee's sample inbox in scenario order. An email
// the user has processed is an item of "autopilot.records"; an email still waiting is an item of "autopilot.inbox".
// The page shows one list: every email in scenario order minus what the two surfaces' Lab filters hide. A Lab sort on
// one surface reorders that surface's emails among the places they hold (processed emails come first in practice,
// because Run and Next go in scenario order). Lab filters and sorts are PRESENTATION ONLY: Run and Next still
// process every waiting email in scenario order, whatever is shown, and the scoreboard, the ledgers and data.tally
// always count every record. The email being processed right now is always shown (see inbox.shown()).
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "autopilot.records"  —  builder autopilotRecordsCtx(source)  —  fixture sampleRecordsCtx(overrides)
// ---------------------------------------------------------------------------------------------------------------
// The emails the user has processed, each with what ONE Jev call answered and what both pipelines did with it.
// items() is in page order (scenario order) and holds only emails of the inbox that have a record; [] before the
// first email is processed and after Reset. Records arrive from the page's own processing call (the user pressed Run
// or Next) or, after a reload, from GET /api/autopilot/state: the server keeps the records of THIS SERVER RUN, which may
// have been made in another tab. Say "this server run", not "this page", in labels about them.
//
// Item (one processed email):
//   id              string   the email's scenario id, e.g. "bec-invoice". Unique. Not shown on the page.
//   position        number   1-based place in the scenario inbox (the page order)
//   order           number   1-based place in processing order among the records (the server's record order)
//   from_name       string   sender's display name as the email says ("" when missing)
//   from_email      string   sender's address ("" when missing)
//   sender_domain   string   lowercased text after the last "@" of from_email ("" when there is none). Plain code.
//   subject, body   string   the authored email ("" when missing). The page shows the subject; the body only as a
//                            hover title. An export holding bodies must say so.
//   attachments     [{ sample, name }]   the authored attachments ([] for most emails). sample is a built-in picture
//                            name served at /img/samples/<sample>.png; name the file name the email gives it.
//   label           { attack, shield, expect } | null   SCENARIO GROUND TRUTH, never sent to Jev:
//                            attack  boolean: acting on this email would be harmful
//                            shield  "safe" | "review" | "quarantine" | null: what the text alone should make Shield
//                                    do. Two attack emails are "safe" by design (the harm shows only in the sender or
//                                    photo checks), so harm metrics use attack and Shield-accuracy metrics use shield.
//                            expect  string: the scenario's one-line expected outcome ("" when missing)
//                            null when the email carries no label.
//   meta            { model, latency_ms, question_count, input_tokens, output_tokens, cost_usd, backend }
//                            measured by the server for this one call; each field null when missing. question_count
//                            is 21, or 26 when Claims' photo questions joined the call. cost_usd is measured spend.
//   shield          { verdict, fact } as jev/shield.py builds them (deep copies):
//     verdict       { level: "safe"|"review"|"quarantine", risk: 0..1, harm: 0..3 score, category: string,
//                     rules: [{ id, action, text }] (ids prompt_injection, credential_phish, impersonation,
//                     unverified_sender; [] when none fired), signals: [{ id, label, value, weight, contribution }]
//                     (8: ai_instructions, credential_request, payment_change, secrecy_or_bypass, link_lure,
//                     unexpected_reward, pressure, identity_mismatch), drivers: [signal ids, at most 3],
//                     weights: { signal id: weight }, policy: { review_at, quarantine_at, hard_rule_at } }
//     fact          { sender_domain, claimed_identity, claimed_label, claimed_identity_prob,
//                     claimed_identity_ranked: [{ value, prob }], expected_domain, domain_matches: true|false|null,
//                     lookalike_domain: boolean } (identity_mismatch and domain checks are code, not Jev)
//                   A record without a verdict gives verdict null; without facts, fact null.
//   photo           { sample, name, evidence: { shows_item, damage, severity (0..3), kind, kind_prob,
//                     kinds: [{ value, prob }], matches_note } } | null (null without an attached picture). Built by
//                     jev/claims.py from the photo answers of the same call. No Box question is asked here.
//   integrated      the Autopilot world, as the server sent it (deep copy):
//                   { lane: "handled"|"needs_you"|"quarantine"|"ignored", plan, executed, error: string|null,
//                     context: { via: "autopilot", requested_by, destination: "account on file" |
//                     "new account from the email" }, resolved: boolean, approved: boolean, dismissed: boolean }
//                   approved/dismissed are false unless the user pressed Approve or Dismiss. A dismissed or approved
//                   record has lane "handled". executed is { kind: "refund"|"payment"|"calendar"|"task"|"reply",
//                   text, amount?, via, destination? } or null when nothing ran.
//   naive           Dispatch alone, same answers, no Shield gate and no sender checks:
//                   { plan, executed, error: string|null } (same shapes as integrated)
//   plan (both)     { tool: "refund_order"|"pay_vendor"|"reschedule_meeting"|"create_task"|"send_info"|"none",
//                     tool_prob, tool_ranking: [{ value, prob }], args: { name: { value, prob, options:
//                     [{ value, prob }], resolved?, score?, ungated? } }, exec_args, missing: [names], confidence,
//                     signature (the typed call as text), decision: "execute"|"confirm"|"clarify"|"reject"|"none",
//                     reasons: [string], checks: [{ id, ok, level: "ok"|"approval"|"block", label, detail }],
//                     tool_meta: { tool: { label, risk, threshold } } } (jev/dispatch.py plan()). The integrated plan
//                     carries Shield's review reason first when Shield asked for review.
//   outcome         "handled" | "needs_you" | "quarantine" | "ignored" | "approved" | "dismissed": exactly the badge
//                   of the page's Autopilot column (approved and dismissed replace "handled" after the user decided).
//   awaiting        boolean: lane "needs_you" and not resolved, so the row shows Dismiss (and maybe Approve)
//   can_approve     boolean: awaiting, a tool was chosen and no argument is missing, so the row shows Approve
//   harmful         boolean: the integrated world ran an action on an attack email (per the scenario labels)
//   naive_harmful   boolean: Dispatch alone ran an action on an attack email (per the scenario labels)
//   answers         { question id: answer } the raw typed answers of the call, ids prefixed "shield.",
//                   "dispatch." or "photo." ({ type, choice | noul | score, probabilities?, confidence?, legend? }).
//                   {} when the server sent none. Question texts are in data.traces, not here.
// itemName(item) is "#<position> <from_name>" (both already on the page), cut to 40 characters.
//
// data (live getters):
//   inbox       [{ id, position, from_name, from_email, sender_domain, subject, body, attachments, label }] every
//               authored email in scenario order, processed or not ([] before the inbox loads). Page copy and
//               scenario ground truth only: no outcome.
//   total       number of emails in the inbox (11 when loaded, 0 before)
//   processed   number of inbox emails with a record (items().length)
//   waiting     number of inbox emails still waiting (total - processed)
//   next        string | null   the id Next email (and Run) would process now; null when the inbox is done
//   running     boolean         Run or Next is in progress (the page disables Run, Next and Reset)
//   activeId    string | null   the email whose call is in flight now
//   tally       the page's scoreboard, over EVERY record of this server run (also any not in the inbox):
//               { processed, calls, cost (usd), latency (summed ms, not wall time), auto (handled automatically),
//                 needs (needs you, approved and dismissed included), quarantined, ignored, harmI (harmful actions in
//                 the integrated world), lostI (their dollars), naiveRuns (actions Dispatch alone ran), harmN, lostN,
//                 legitBlockedN (non-attack emails Dispatch alone rejected) }. All 0 before anything ran.
//   worlds      { integrated, naive } | null   each world's snapshot as the server sent it after the latest call:
//               { today, balance, customers, orders, vendors, meetings, payments[], tasks[], outbox[], activity[] }
//               (arrays newest first; activity entries { kind, text, amount?, via, destination? }). null before load.
//   traces      { record id: { request, response, meta } } what Inspect JSON shows for each processed email (the
//               exact request with state, model and the 21/26 questions; the response with answers and usage).
//               Holds email bodies and question text. {} when nothing ran.
//   configured  boolean         an API key is connected
//   model       string | null   the model the top bar's key pill shows now (not necessarily what earlier calls used:
//                               read item.meta.model for that)
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them only from a
// command or control the user just pressed, one call per press, never from a fact, metric, check or render):
//   inspect(id)          opens the Inspect JSON drawer on that record's request and response, exactly what the row's
//                        "N Q · latency · cost" button does. No model call. Guard: id must be an item.
//   resolve(id, approve) the row's Approve (approve true) or Dismiss (false): runs the pre-filled action in the
//                        integrated world, or drops it. NO model call, but it changes the server's world for this
//                        server run until Reset. Guards: id must be an item that is awaiting; approve also needs
//                        can_approve. Returns the page's promise.
//   reset()              Reset: clears every record and re-seeds both worlds on the server (no model call; the page
//                        has no confirm). Guard: not while running.
//   A command that calls reset() says so in its title ("(clears every result)") and has NO keyboard shortcut: it
//   discards results. There is no action that edits, reorders, adds or replays emails or records, and none may be
//   added by a pack.
// NO ACTION ON ANY AUTOPILOT SURFACE CALLS THE MODEL OR SPENDS BUDGET: processing emails (Run, Next) and the benchmark
// stay the page's own buttons, and no action presses them.
//
// refresh() re-renders the email list (and its "Showing x of y" note) from shown().
//
// Content boundaries for autopilot.records:
//   - Verdicts, probabilities, plans, latency, tokens and cost come from calls the user made in this server run.
//     Show, measure, compare and export them as they are; never store them, never fill a gap with a guess, and never
//     present a re-scored or simulated outcome (a what-if with other weights) as what happened: label it as plain
//     local arithmetic on the user's own answers, and say that it makes no call and changes no world.
//   - label is scenario ground truth that Jev never saw. Anything that uses it says "per the scenario labels".
//   - Exports state what they hold: values from the user's run, scenario labels, email bodies, raw answers or traces.
//     An export described as a request or a Workbench handoff carries state, model and questions only: never answers,
//     probabilities, meta or scenario labels (labels are not part of the request). CSV goes through csvText/csvCell.
//   - A rule a pack applies to probabilities (close call, near a threshold) is plain local code: advisory, labeled as
//     such, never worded as Jev's answer or as a Shield verdict.
//   - Nothing here holds the API key or the session token, and no pack may add a way to send a custom email.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "autopilot.inbox"  —  builder autopilotInboxCtx(source)  —  fixture sampleInboxCtx(overrides)
// ---------------------------------------------------------------------------------------------------------------
// The emails still waiting, in scenario order. items() is all 11 before the first run and [] when the inbox is done.
// The page has no filter of its own; shown() is items() minus what Lab filters hide, in Lab's sort order, EXCEPT that
// the email being processed right now (active) is always shown, so a filter never hides work in progress.
//
// Item (one waiting email): { id, position, from_name, from_email, sender_domain, subject, body, attachments, label }
//   exactly as in autopilot.records above, plus
//   active   boolean: its call is in flight now (the page shows "one Jev call…")
//   next     boolean: Next email (and Run) would process this one first
// A waiting email has NO outcome yet: no meta, no verdict, no answers.
// itemName(item) is "#<position> <from_name>", cut to 40 characters.
//
// data: the same live getters as autopilot.records except traces: inbox, total, processed, waiting, next, running,
// activeId, tally, worlds, configured, model.
// actions: reset() with the guard above. No inspect or resolve: a waiting email has no record.
//
// Content boundaries for autopilot.inbox: the items are page copy and scenario ground truth. A pack must not claim or
// predict what Jev or Shield will answer for a waiting email. A keyword, link or domain check over the text is a
// plain-code heuristic and is labeled as one, never as a verdict. Exports may hold senders, subjects and labels
// freely; one that holds bodies says so.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "autopilot.benchmark"  —  builder autopilotBenchmarkCtx(source)  —  fixture sampleBenchmarkCtx(overrides)
// ---------------------------------------------------------------------------------------------------------------
// The "Why merge them? Measured" panel: the user's own benchmark runs of this page load. Each run sends the same
// Shield and Dispatch questions about one built-in email (the vendor-fraud email, id "bec-invoice") three ways:
// sequential (2 calls one after the other), parallel (2 calls at once) and merged (1 call): 5 live calls. The panel
// shows the latest run; earlier runs of this page load live in data.runs (memory only, gone on reload).
// items() and shown() are always []: this surface hosts metrics, exporters, commands, tools and panels.
//
// data (live getters):
//   runs     [{ run, at, model, id, sequential, parallel, merged, per_call_ms }] oldest first, at most 20, this page
//            load only. run: 1-based number in the page load (the first entry's run can be above 1 once older runs
//            dropped off); at: arrival time in epoch ms; model: the model the key pill showed when the run started
//            (the response does not name it; null when unknown) — never average runs of different models together;
//            id: the email measured. sequential | parallel | merged: { requests, wall_ms, input_tokens, cost_usd,
//            questions } (wall_ms is wall-clock time for that mode, cost_usd measured spend, questions summed over its
//            requests: 21 for every mode today). per_call_ms: { shield, dispatch, merged } the server-measured
//            latency of the sequential mode's two calls and of the merged call. A missing number reads null.
//   latest   the last entry of runs, or null before the first run
//   busy     boolean: a benchmark is being measured now
//   email    { id, from_name, from_email, subject } of the measured email (authored), or null before the inbox loads
//   configured, model   as above
//
// actions: none. The benchmark makes live calls, so only the panel's own "Run benchmark" button starts it.
//
// refresh() re-renders the panel. Content boundaries for autopilot.benchmark: every number is a measurement of the
// user's own runs; latency varies from run to run. A projection (cost per thousand emails, savings per month) is
// arithmetic on a measured run and says so, never shown as spend. Exports hold run numbers only (no answers, no
// email bodies) and say which model they are about.
import { clone } from "../kit.js";

const AUTOPILOT_RUN_LIMIT = 20;
const EMPTY = Object.freeze([]);
const OUTCOMES = new Set(["handled", "needs_you", "quarantine", "ignored"]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value) => (typeof value === "string" ? value : "");
const textOrNull = (value) => (typeof value === "string" && value !== "" ? value : null);

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

const domainOf = (email) => {
  const value = text(email);
  const at = value.lastIndexOf("@");
  return at < 0 ? "" : value.slice(at + 1).trim().toLowerCase();
};

function labelOf(raw) {
  if (!isObject(raw)) return null;
  return { attack: raw.attack === true, shield: textOrNull(raw.shield), expect: text(raw.expect) };
}

function attachmentsOf(raw) {
  return Array.isArray(raw) ? raw.filter(isObject).map((entry) => ({ sample: text(entry.sample), name: text(entry.name) })) : [];
}

// The authored part of an email, shared by both lists.
function emailFields(message, position) {
  return { id: text(message.id), position, from_name: text(message.from_name), from_email: text(message.from_email),
    sender_domain: domainOf(message.from_email), subject: text(message.subject), body: text(message.body),
    attachments: attachmentsOf(message.attachments), label: labelOf(message.label) };
}

const shortName = (item, index) => {
  const position = item && Number.isInteger(item.position) ? item.position : index + 1;
  const name = `#${position}${item && item.from_name ? ` ${item.from_name}` : ""}`;
  return name.length > 40 ? `${name.slice(0, 39)}…` : name;
};

function metaOf(raw) {
  const meta = isObject(raw) ? raw : {};
  return { model: textOrNull(meta.model), latency_ms: finite(meta.latency_ms), question_count: Number.isInteger(meta.question_count) ? meta.question_count : null,
    input_tokens: Number.isInteger(meta.input_tokens) ? meta.input_tokens : null, output_tokens: Number.isInteger(meta.output_tokens) ? meta.output_tokens : null,
    cost_usd: finite(meta.cost_usd), backend: textOrNull(meta.backend) };
}

function sideOf(raw, integrated) {
  const side = isObject(raw) ? clone(raw) : {};
  const out = { ...side, plan: isObject(side.plan) ? side.plan : null, executed: isObject(side.executed) ? side.executed : null,
    error: textOrNull(side.error) };
  if (integrated) {
    out.lane = OUTCOMES.has(side.lane) ? side.lane : null;
    out.context = isObject(side.context) ? side.context : null;
    out.resolved = side.resolved === true;
    out.approved = side.approved === true;
    out.dismissed = side.dismissed === true;
  }
  return out;
}

// One processed email: the authored message joined with its record, without the trace.
function recordItem(message, record, position, order) {
  const label = labelOf(record.label) || labelOf(message.label);
  const integrated = sideOf(record.integrated, true);
  const naive = sideOf(record.naive, false);
  const shield = isObject(record.shield) ? record.shield : {};
  const plan = integrated.plan || {};
  const awaiting = integrated.lane === "needs_you" && !integrated.resolved;
  const attack = label?.attack === true;
  const answers = isObject(record.trace) && isObject(record.trace.response) && isObject(record.trace.response.answers) ? clone(record.trace.response.answers) : {};
  return { ...emailFields(message, position), label, order, meta: metaOf(record.meta),
    shield: { verdict: isObject(shield.verdict) ? clone(shield.verdict) : null, fact: isObject(shield.fact) ? clone(shield.fact) : null },
    photo: isObject(record.photo) ? clone(record.photo) : null,
    integrated, naive,
    outcome: integrated.approved ? "approved" : integrated.dismissed ? "dismissed" : integrated.lane,
    awaiting,
    can_approve: awaiting && !!plan.tool && plan.tool !== "none" && !(Array.isArray(plan.missing) && plan.missing.length),
    harmful: !!integrated.executed && attack,
    naive_harmful: !!naive.executed && attack,
    answers };
}

// The scoreboard of the page (both score panels), over every record. Same arithmetic as the page always used.
function tallyOf(records) {
  const t = { processed: records.length, calls: records.length, cost: 0, latency: 0, auto: 0, needs: 0, quarantined: 0, ignored: 0,
    harmI: 0, lostI: 0, naiveRuns: 0, harmN: 0, lostN: 0, legitBlockedN: 0 };
  for (const r of records) {
    t.cost += finite(r.meta?.cost_usd) || 0;
    t.latency += finite(r.meta?.latency_ms) || 0;
    const I = isObject(r.integrated) ? r.integrated : {};
    const N = isObject(r.naive) ? r.naive : {};
    const lane = I.lane;
    if (lane === "quarantine") t.quarantined++;
    else if (lane === "ignored") t.ignored++;
    else if (I.approved || I.dismissed) t.needs++;
    else if (lane === "handled") t.auto++;
    else t.needs++;
    const attack = r.label?.attack;
    if (I.executed && attack) { t.harmI++; t.lostI += I.executed.amount || 0; }
    if (N.executed) {
      t.naiveRuns++;
      if (attack) { t.harmN++; t.lostN += N.executed.amount || 0; }
    }
    if (!attack && N.plan?.decision === "reject") t.legitBlockedN++;
  }
  return t;
}

// What both email surfaces share: the raw page state read through the source, with stable frozen items.
function emailState(source) {
  const inbox = () => {
    const list = read(source, "inbox", EMPTY);
    return Array.isArray(list) ? list.filter((message) => isObject(message) && text(message.id)) : [];
  };
  const records = () => {
    const map = read(source, "records", null);
    return isObject(map) ? map : {};
  };
  const recordOf = (id) => {
    const map = records();
    return Object.prototype.hasOwnProperty.call(map, id) && isObject(map[id]) ? map[id] : null;
  };
  const activeId = () => textOrNull(read(source, "activeId", null));
  const running = () => read(source, "running", false) === true;
  const nextId = () => inbox().find((message) => !recordOf(message.id))?.id ?? null;
  const status = () => {
    const value = read(source, "status", null);
    return isObject(value) ? value : {};
  };

  // Items are cached per raw object, so an unchanged email keeps its item object.
  const recordCache = new WeakMap();
  const queuedCache = new WeakMap();
  const recordItems = () => {
    const raw = records();
    const order = new Map(Object.keys(raw).map((id, index) => [id, index + 1]));
    const out = [];
    inbox().forEach((message, index) => {
      const record = recordOf(message.id);
      if (!record) return;
      const known = recordCache.get(record);
      const position = index + 1, at = order.get(message.id);
      if (known && known.message === message && known.position === position && known.order === at) { out.push(known.item); return; }
      const item = deepFreeze(recordItem(message, record, position, at));
      recordCache.set(record, { message, position, order: at, item });
      out.push(item);
    });
    return out;
  };
  const queuedItems = () => {
    const active = activeId(), next = nextId();
    const out = [];
    inbox().forEach((message, index) => {
      if (recordOf(message.id)) return;
      const flags = { position: index + 1, active: message.id === active, next: message.id === next };
      const known = queuedCache.get(message);
      if (known && known.position === flags.position && known.active === flags.active && known.next === flags.next) { out.push(known.item); return; }
      const item = deepFreeze({ ...emailFields(message, flags.position), active: flags.active, next: flags.next });
      queuedCache.set(message, { ...flags, item });
      out.push(item);
    });
    return out;
  };

  const worldsCache = new WeakMap();
  const traceCache = new WeakMap();
  const inboxCache = { list: null, value: EMPTY };
  const data = {
    get inbox() {
      const list = inbox();
      const raw = read(source, "inbox", null);
      if (raw !== inboxCache.list || inboxCache.value.length !== list.length) {
        inboxCache.list = raw;
        inboxCache.value = deepFreeze(list.map((message, index) => emailFields(message, index + 1)));
      }
      return inboxCache.value;
    },
    get total() { return inbox().length; },
    get processed() { return inbox().filter((message) => recordOf(message.id)).length; },
    get waiting() { return inbox().filter((message) => !recordOf(message.id)).length; },
    get next() { return nextId(); },
    get running() { return running(); },
    get activeId() { return activeId(); },
    get tally() { return Object.freeze(tallyOf(Object.values(records()).filter(isObject))); },
    get worlds() {
      const raw = read(source, "worlds", null);
      if (!isObject(raw)) return null;
      if (!worldsCache.has(raw)) worldsCache.set(raw, deepFreeze({ integrated: isObject(raw.integrated) ? clone(raw.integrated) : null, naive: isObject(raw.naive) ? clone(raw.naive) : null }));
      return worldsCache.get(raw);
    },
    get configured() { return status().configured === true; },
    get model() { return textOrNull(status().model); },
  };
  const guardIdle = () => { if (running()) throw new Error("Wait for the current email to finish first."); };
  const actions = {
    reset() { guardIdle(); return call(source, "reset"); },
  };
  const traces = () => {
    const out = {};
    for (const item of recordItems()) {
      const record = recordOf(item.id);
      if (!record || !isObject(record.trace)) continue;
      if (!traceCache.has(record)) traceCache.set(record, deepFreeze(clone(record.trace)));
      out[item.id] = traceCache.get(record);
    }
    return Object.freeze(out);
  };
  return { recordItems, queuedItems, data, actions, traces, activeId };
}

// source: {
//   inbox: () => S.inbox (the authored emails, scenario order),   records: () => S.records ({ id: record }),
//   worlds: () => S.worlds,   running: () => boolean,   activeId: () => id | null,   status: () => currentStatus(),
//   matches: (item, ctx) => boolean   (LAB.matches for this surface),   arrange: (items, ctx) => items   (LAB.arrange),
//   reset(), resolve(id, approve), inspect(id), refresh()   the page's own operations (none calls the model)
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function autopilotRecordsCtx(source = {}) {
  const state = emailState(source);
  const find = (id) => {
    const item = state.recordItems().find((entry) => entry.id === id);
    if (!item) throw new Error(`No processed email "${text(id) || String(id)}" here. Process it first.`);
    return item;
  };
  const data = {};
  Object.defineProperties(data, Object.getOwnPropertyDescriptors(state.data));
  Object.defineProperty(data, "traces", { enumerable: true, get: state.traces });
  const ctx = {
    items: state.recordItems,
    shown() {
      const list = state.recordItems().filter((item) => !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data,
    actions: {
      ...state.actions,
      inspect(id) {
        const item = find(id);
        return call(source, "inspect", item.id);
      },
      resolve(id, approve) {
        const item = find(id);
        if (!item.awaiting) throw new Error(`${item.subject || item.id} is not waiting for your decision.`);
        if (approve === true && !item.can_approve) throw new Error(`${item.subject || item.id} cannot be approved: no action was chosen or an argument is missing. Dismiss it instead.`);
        return call(source, "resolve", item.id, approve === true);
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: shortName,
  };
  return ctx;
}

// source: as for autopilotRecordsCtx, without resolve and inspect.
export function autopilotInboxCtx(source = {}) {
  const state = emailState(source);
  const ctx = {
    items: state.queuedItems,
    shown() {
      const list = state.queuedItems().filter((item) => item.active || !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: state.data,
    actions: { ...state.actions },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: shortName,
  };
  return ctx;
}

const MODES = ["sequential", "parallel", "merged"];

function modeOf(raw) {
  const mode = isObject(raw) ? raw : {};
  const count = (value) => (Number.isInteger(value) ? value : null);
  return { requests: count(mode.requests), wall_ms: finite(mode.wall_ms), input_tokens: count(mode.input_tokens), cost_usd: finite(mode.cost_usd), questions: count(mode.questions) };
}

function runOf(raw, index) {
  const perCall = isObject(raw.per_call_ms) ? raw.per_call_ms : {};
  const out = { run: Number.isInteger(raw.run) && raw.run >= 1 ? raw.run : index + 1, at: finite(raw.at), model: textOrNull(raw.model), id: text(raw.id) };
  for (const mode of MODES) out[mode] = modeOf(raw[mode]);
  out.per_call_ms = { shield: finite(perCall.shield), dispatch: finite(perCall.dispatch), merged: finite(perCall.merged) };
  return out;
}

// source: {
//   runs: () => S.benchRuns ([{ run, at, model, id, ...the page's benchmark response }], oldest first),
//   busy: () => boolean,   inbox: () => S.inbox,   status: () => currentStatus(),
//   refresh()   re-render the panel
// }
export function autopilotBenchmarkCtx(source = {}) {
  const cache = new WeakMap();
  const runs = () => {
    const list = read(source, "runs", EMPTY);
    if (!Array.isArray(list)) return EMPTY;
    const kept = list.filter(isObject);
    const start = Math.max(0, kept.length - AUTOPILOT_RUN_LIMIT);
    return Object.freeze(kept.slice(start).map((raw, index) => {
      const known = cache.get(raw);
      if (known && known.index === start + index) return known.item;
      const item = deepFreeze(runOf(raw, start + index));
      cache.set(raw, { index: start + index, item });
      return item;
    }));
  };
  const status = () => {
    const value = read(source, "status", null);
    return isObject(value) ? value : {};
  };
  const busy = () => read(source, "busy", false) === true;
  const ctx = {
    items: () => EMPTY,
    shown: () => EMPTY,
    data: {
      get runs() { return runs(); },
      get latest() { const list = runs(); return list.length ? list[list.length - 1] : null; },
      get busy() { return busy(); },
      get email() {
        const list = read(source, "inbox", EMPTY);
        const latest = runs().at(-1);
        const id = latest?.id || "bec-invoice";
        const message = Array.isArray(list) ? list.find((entry) => isObject(entry) && entry.id === id) : null;
        return message ? Object.freeze({ id, from_name: text(message.from_name), from_email: text(message.from_email), subject: text(message.subject) }) : null;
      },
      get configured() { return status().configured === true; },
      get model() { return textOrNull(status().model); },
    },
    actions: {},
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (_item, index) => String(index + 1),
  };
  return ctx;
}
