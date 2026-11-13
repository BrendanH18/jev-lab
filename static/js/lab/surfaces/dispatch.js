// Lab surfaces of the Dispatch page (static/dispatch.html, static/js/dispatch.js): the simulated Harbor Coffee Co.
// world the page shows (orders, vendor invoices, this week's calendar, the activity log) and the plan of the user's own
// latest command. Pure code: it imports only the kit, touches no DOM, storage or network, and is tested in Node
// (tests/js/lab/surface-demo-dispatch.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/dispatch.mjs
// (sampleDispatchOrdersCtx, sampleDispatchInvoicesCtx, sampleDispatchCalendarCtx, sampleDispatchActivityCtx,
// sampleDispatchPlanCtx). This header is the CONTRACT for packs on these five surfaces.
//
// ============================================ CONTRACT FOR PACK AUTHORS ============================================
//
// Every ctx is { items(), shown(), data, actions, refresh(), itemName(item, index) }, built ONCE per page load: it reads
// the page's state through callbacks at call time and never goes stale. items() and shown() return the SAME frozen
// item objects (compare by identity) until the list itself changes: the world lists change when the page receives a
// new world snapshot (page load, Reset, an executed action), the plan list when a new answer or a re-plan arrives.
// Items and every data value are deeply frozen plain JSON: read them, never write to them. data fields are live
// getters: read them when you need them, never keep a copy across renders.
//
// NO SURFACE HERE HAS replaceItems OR importItems, so Edits (transform) and Paste to import (importer) do not render on
// this page. The world is server-side simulation state that changes only through an executed plan (the page's
// approved-plan path: POST /api/dispatch/execute, which the server re-checks against a plan it produced) or the
// page's Reset; the plan rows are model answers. Neither may be rewritten, added to or replayed by a pack.
// Kinds these surfaces host: fact, diagnostic, metric, exporter, command, tool, panel (and behavior).
//
// Formats used below: a "day" is a lowercase weekday as the server writes it ("monday" … "friday"); a "time" is
// "HH:MM" on a 24-hour clock; a date is ISO "YYYY-MM-DD"; money is a plain number of US dollars (format "usd").
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "dispatch.orders"  —  builder dispatchOrdersCtx(source)  —  fixture sampleDispatchOrdersCtx
// ---------------------------------------------------------------------------------------------------------------
// The shop's orders as the Orders table lists them, in the world's order (A-1041 … A-1045 in the seeded world).
// The page has no filter of its own: shown() is items() after Lab's filters, then Lab's sort, and the table shows
// exactly those rows in that order ("No order matches the Lab filters." when none is left).
// Item (one order):
//   id                   string          the order number, "A-1041". Unique. itemName() returns it.
//   position             number          1-based position in the world's order
//   customer_id          string | null   the customer key, "maya_chen"
//   customer             string | null   the customer's name, "Maya Chen"; null when the customer is not in the world
//   email                string | null   the customer's (fictional) email; null when unknown
//   items                string          what was ordered, as the table's second line prints it; "" when missing
//   total                number | null   the order total in dollars
//   status               string | null   "delivered" | "in transit" | "processing" (the server's text, as printed)
//   delivered_on         string | null   ISO date of delivery; null when not delivered
//   days_since_delivery  number | null   whole days from delivered_on to data.today (what jev/world.py computes);
//                                        null when either date is missing or unreadable
//   refunded             boolean         the order has been refunded (the table then shows "Refunded")
//   refund_reason        string | null   the reason recorded with the refund ("damaged", …); null when none
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "dispatch.invoices"  —  builder dispatchInvoicesCtx(source)  —  fixture sampleDispatchInvoicesCtx
// ---------------------------------------------------------------------------------------------------------------
// Every vendor invoice on file, open and paid, as the Vendor invoices table lists them: vendor by vendor in the
// world's order, each vendor's invoices in order. A vendor with no invoice gives no row. No page filter; shown() is
// items() after Lab's filters and sort ("No invoice matches the Lab filters." when none is left).
// Item (one invoice):
//   id             string          the invoice number, "INV-7781". Unique in the seeded world (the server does not
//                                  enforce it across vendors). itemName() returns it.
//   position       number          1-based position in table order
//   vendor_id      string          the vendor key, "bean_brokers"
//   vendor         string          the vendor's name as printed; "" when missing
//   vendor_about   string          what the vendor does ("green coffee importer"); "" when missing
//   vendor_domain  string | null   the vendor's (fictional) email domain, "beanbrokers.example"
//   amount         number | null   the invoice amount in dollars
//   paid           boolean         the invoice has been paid (the table shows "Paid", otherwise "Open")
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "dispatch.calendar"  —  builder dispatchCalendarCtx(source)  —  fixture sampleDispatchCalendarCtx
// ---------------------------------------------------------------------------------------------------------------
// The meetings of the "This week" calendar, in the world's order. THE PAGE'S OWN FILTER: the calendar draws Monday to
// Friday only, so a meeting whose day is not one of those five (on_calendar false) is never shown. shown() is items()
// minus those, minus what Lab's filters hide, in Lab's sort order; each day column lists its shown meetings in
// shown() order.
// Item (one meeting):
//   id            string          the meeting key, "bean_brokers_call". Unique. itemName() returns it.
//   position      number          1-based position in the world's order
//   title         string          the title as printed; "" when missing
//   day           string | null   the day exactly as the server holds it ("tuesday")
//   day_index     number | null   0 for monday … 4 for friday; null when day is not one of the five
//   on_calendar   boolean         day_index !== null: the page draws this meeting
//   time          string | null   the start time as printed ("10:00")
//   minutes       number | null   minutes after midnight (600 for "10:00"); null when time is not "H:MM"/"HH:MM"
//   with_domain   string | null   the email domain of the people it is with ("beanbrokers.example")
//   moved         boolean         the meeting was rescheduled since the last Reset (the page highlights it)
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "dispatch.activity"  —  builder dispatchActivityCtx(source)  —  fixture sampleDispatchActivityCtx
// ---------------------------------------------------------------------------------------------------------------
// The activity log, NEWEST FIRST as the page lists it: one entry per action executed since the last Reset. [] before
// anything has run (the page then says "Nothing has run yet."). No page filter; shown() is items() after Lab's
// filters and sort ("No activity matches the Lab filters." when none is left).
// Item (one entry):
//   n            number          its number in time order: 1 is the oldest entry, items().length the newest.
//                                itemName() returns "#n".
//   position     number          1-based position in page order (1 is the newest)
//   kind         string | null   "refund" | "payment" | "calendar" | "task" | "reply"
//   text         string          the line as printed ("Refunded $38.00 for A-1041 (damaged)")
//   amount       number | null   dollars moved, for refund and payment entries; null otherwise
//   via          string | null   what ran it ("dispatch" on this page); null when not recorded
//   destination  string | null   where a payment went ("account on file"); null otherwise
//
// data of the four world surfaces (live getters; local simulation data from this page's own server):
//   today              string | null   the world's ISO date, which days_since_delivery counts to
//   balance            number | null   the bank balance in dollars, as the Bank balance tile shows it
//   business_domain    string          "harborcoffee.example", the shop's own domain (jev/world.py BUSINESS)
//   refund_window_days number          30: delivered damaged or wrong items are refundable within this many days
//                                      (jev/world.py REFUND_WINDOW_DAYS). A pack may mirror the rule as advice only.
//   weekdays           string[]        ["monday", "tuesday", "wednesday", "thursday", "friday"], the calendar's days
//   customers          [{ id, name, email }]              every customer, world order; [] before the world loads
//   vendors            [{ id, name, about, domain }]      every vendor, world order (including one with no invoice)
//   tasks              [{ area, priority, text, via }]    tasks created this world, newest first (the Open tasks tile)
//   payments           [{ to, amount, memo, destination, via }]   money sent this world (refunds and vendor
//                                      payments), newest first; fields the server did not record are null
//   outbox             [{ to, template, label, via }]     standard-info replies sent this world, newest first
//   plan               { text, tool, decision, signature, exec_args, done } | null   the latest command's plan, so a
//                                      pack can mark the order, invoice or meeting it targets. null before the first
//                                      answered command. done: it was executed. This is the user's own latest call.
//   busy               boolean         a command request or an execution is in flight
// Everything is null, [] or false before the first world snapshot arrives (items() is then [] too).
//
// actions of the four world surfaces (each throws an Error with a message for the user when its guard refuses; call
// them only from a command or a control the user just pressed, one call per press, never from a fact, metric, check
// or render):
//   draftCommand(text)  puts text in the command box and focuses it. NO model call and nothing runs: the user still
//                       reads it and presses Enter (Live preview reacts only to typing). Guard: a nonblank string of
//                       at most 1,000 characters (what the server reads); refuses while an action is executing.
//                       Returns the text placed.
//   focusCommand()      moves the keyboard focus to the command box. No guard.
//   resetWorld()        the page's Reset button: the server restores the seeded world and forgets approved plans.
//                       No model call. Guard: refuses while a command or execution is in flight. Returns the page's
//                       promise. A pack command that calls it says "Reset" in its title.
// There is no action that changes an order, invoice, meeting or log entry directly, and none may be added by a pack:
// the world changes only through the approved-plan path.
//
// Content boundaries for the world surfaces: everything here is fictional simulation data of Harbor Coffee Co. (with
// .example domains) plus the user's own command text inside task and activity lines. Exports and metrics may contain it
// and say which list they hold. A rule a pack mirrors from jev/dispatch.py or jev/world.py (the refund window, a
// sufficient balance, an open invoice match) is plain local advice, labeled as such: never presented as what the
// server or the model decided, and never as permission to run anything.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "dispatch.plan"  —  builder dispatchPlanCtx(source)  —  fixture sampleDispatchPlanCtx
// ---------------------------------------------------------------------------------------------------------------
// The answers of the CURRENT USER'S OWN latest answered command: one row per question of that single request, in the
// response's order (tool, refund.order, refund.reason, reschedule.meeting, reschedule.day, reschedule.time,
// pay.vendor, pay.amount, task.area, task.priority, info.template, info.customer for the built-in questions), as the
// "All N answers from the same call" grid shows them. [] before the first answered command of this page load. The
// page has no filter of its own: shown() is items() after Lab's filters and sort, and the grid shows exactly those
// cards ("No answer matches the Lab filters." when none is left).
// Item (one answer):
//   id             string          the question id, "refund.order". Unique. itemName() returns it.
//   position       number          1-based position in the response's answer order
//   group          string          "tool" or the id's prefix: "refund" | "reschedule" | "pay" | "task" | "info"
//   tool           string | null   the action this question serves ("refund_order", …); null for "tool" itself
//   arg            string | null   the argument it fills ("order", "amount", …); null for "tool"
//   type           string          "choice" | "score" | "noul" as the API returned it (the built-in request asks
//                                  Choice questions and one Score, task.priority; Noul and others pass through)
//   used           boolean         the page highlights it: it is "tool" or belongs to the planned action
//   value          string | number | null   Choice: the chosen key. Score: the score (0 … scale). Noul: P(yes).
//   display        string          the value as the card prints it: Choice "refund order" (underscores as spaces),
//                                  Score "score 1.62", Noul "yes"/"no" (P(yes) ≥ 0.5); "" when value is null
//   p              number | null   the probability the card prints: Choice the chosen key's probability, Score the
//                                  answer's confidence, Noul P(yes)
//   probabilities  [{ key, p }]    Choice/Score: as the response listed them (Score keys "0", "1", …); Noul:
//                                  [{ key: "yes", p }, { key: "no", p: 1 - p }]; [] otherwise. Non-finite entries dropped.
//   ranked         [{ key, p }]    probabilities sorted by p, highest first (ties keep response order)
//   top            { key, p } | null   ranked[0]
//   confidence     number | null   the answer's own confidence field (Noul answers carry none: null)
//   score          number | null   Score only: the raw score
//   scale          number | null   Score only: the highest level index (2 for the three priority levels)
//   instructions   string          the question text that was sent ("" when the request has no such question)
//   criteria       [{ key, text }] the options that were sent, in authored order (Score: keys "0", "1", …); a null
//                                  description reads ""
//   answer         object          the raw answer exactly as the server returned it
//
// data of dispatch.plan (live getters):
//   text        string | null   the command the shown answers were made for; null while items() is []
//   draft       string          what the command box holds now, untrimmed
//   stale       boolean         answers are shown and the box no longer holds their text (trimmed)
//   busy        boolean         a command request is in flight (Live preview included)
//   executing   boolean         an approved action is being executed
//   live        boolean         the "Live preview while typing" toggle is on (each typing pause is then a model call)
//   plan        object | null   the plan shown now (after any re-plan), as the user's own command call returned it: { tool,
//               tool_prob, tool_ranking: [{ value, prob }], args: { name: { value, prob, options: [{ value, prob }],
//               picked_by_user?, resolved?, score?, ungated? } }, exec_args, missing: [name], confidence, signature,
//               decision: "execute" | "confirm" | "clarify" | "reject" | "none", reasons: [text], checks: [{ id, ok,
//               level: "ok" | "approval" | "block", label, detail }], tool_meta: { tool: { label, risk, threshold } } }
//   done        boolean         the shown plan was executed in this page session
//   override    { tool?, args } | null   what the user picked in "Which did you mean?" (re-plans use no model call)
//   replan_ms   number | null   how long the latest re-plan took, measured in this browser
//   meta        object | null   the server's measurements of the shown call: { model, latency_ms, question_count,
//               input_tokens, output_tokens, cost_usd, backend }; any field may be missing. Measured, not estimated.
//   trace       object | null   what Inspect JSON shows: { request, response, meta }
//   request     object | null   the exact request: { state: { assistant_for, request }, model, questions }
//   candidates  { amounts: [{ key, value, text }], times: [{ key, text }] } | null   what code found in the text
//   clarify     { tools: [{ value, label, prob }], args: [{ name, options: [{ value, label, prob }] }] } | null
//               exactly the "Which did you mean?" / "Which <arg>?" chips the page offers; null unless the decision
//               is "clarify". These are the only values pickTool / pickArg accept.
//   examples    string[]        the example command chips, in page order; [] when they did not load. Inputs only.
//   calls       number          answered commands since the page loaded
//   history     [{ call, at, text, tool, decision, confidence, signature, meta }]   this page load's answered
//               commands, oldest first, the newest 50 at most, in memory only. call is the 1-based number in the
//               session, at the arrival time (epoch ms). tool/decision/confidence/signature are the plan as first
//               returned (before any re-plan). The last entry is the shown call.
//   world       object | null   the latest world snapshot (for labels such as customer names), deeply frozen
//
// actions of dispatch.plan (each throws an Error with a message for the user when its guard refuses; call them only
// from a command or a control the user just pressed, one call per press, never from a fact, metric, check or render):
//   draftCommand(text), focusCommand(), resetWorld()   as for the world surfaces
//   inspect()          opens Inspect JSON on the shown call. Guard: refuses while items() is [].
//   pickTool(tool)     a "Which did you mean?" chip: re-plans from the answers already given, NO model call. Guard:
//                      tool must be in data.clarify.tools; refuses while busy.
//   pickArg(name, value)  a "Which <name>?" chip: re-plans, NO model call. Guard: the pair must be in data.clarify.args.
//   runPlan({ confirm }) the plan's own button ("Run now" / "Confirm & run"). It goes through the page's execute(),
//                      i.e. the server's approved-plan path, which re-checks policy and refuses anything it did not
//                      plan itself. Guards: a plan is shown, it is not done, the box still holds its text (not stale),
//                      nothing is in flight, and decision is "execute", or "confirm" with { confirm: true }; every
//                      other decision is refused. A pack command that calls it must say "Run" or "Confirm & run" in
//                      its title, must declare NO keyboard shortcut, and must never call it for the user unasked.
//
// refresh() re-renders the answer grid (plan) or that one world list from shown(); the Lab section is not rebuilt.
//
// Content boundaries for dispatch.plan:
//   - Everything in items(), data.plan and data.history is a call the current user made in this page load. A pack
//     may show, measure, compare and export those. It must never show a made-up, sample, remembered or predicted
//     answer, never keep answers beyond the page session, and never present an earlier call as the current one:
//     anything from data.history is labeled as an earlier command of this session.
//   - Exports that hold answers, probabilities, the plan or the command text say so in their label or help. One
//     described as a request or a handoff ("for the Workbench") carries state, model and questions only, never
//     answers, probabilities, plan or meta (the Open in Workbench rule of AGENTS.md).
//   - meta numbers are measurements of calls already made. A projection (cost per 1,000 commands) is arithmetic on a
//     measured call, says so, and is never shown as spend.
//   - A rule a pack applies to probabilities (a margin, a "close call") is plain local advice, labeled as such, and
//     never worded as the model's answer or as the page's decision. The page's own thresholds stay the only gate.
//   - No pack changes the questions, the examples, the thresholds or the world, and no pack makes a model call.
//     NO ACTION ON ANY DISPATCH SURFACE CALLS THE MODEL OR SPENDS BUDGET: only the user's own Enter, typing pause
//     (Live preview) or example chip asks Jev, and no action presses them. A pack may put text in the box with
//     draftCommand(); the user still sends it.
import { clone } from "../kit.js";

const WEEKDAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday", "friday"]);
const BUSINESS_DOMAIN = "harborcoffee.example";  // jev/world.py BUSINESS["domain"]
const REFUND_WINDOW_DAYS = 30;                   // jev/world.py REFUND_WINDOW_DAYS
const MAX_COMMAND = 1000;                        // server.api_dispatch reads at most this many characters
const HISTORY_SHOWN = 50;
// Mirrors static/js/dispatch.js: which question ids belong to which action, and the values a clarify chip skips.
const TOOL_PREFIX = Object.freeze({ refund_order: "refund.", reschedule_meeting: "reschedule.", pay_vendor: "pay.", create_task: "task.", send_info: "info." });
const GROUP_TOOL = Object.freeze({ refund: "refund_order", reschedule: "reschedule_meeting", pay: "pay_vendor", task: "create_task", info: "send_info" });
const MISSING_VALUES = new Set(["not_identified", "not_stated"]);
const EMPTY = Object.freeze([]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const textOrNull = (value) => (typeof value === "string" && value !== "" ? value : null);
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value) ?? "");
const entriesOf = (value) => (isObject(value) ? Object.entries(value) : []);

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

// Whole days between two ISO dates (b - a), or null when either is not a YYYY-MM-DD date.
function dayNumber(iso) {
  const match = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? Math.round(time / 86400000) : null;
}
function daysBetween(from, to) {
  const a = dayNumber(from), b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

function minutesOf(time) {
  const match = typeof time === "string" ? time.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

// How the page labels a chosen value (static/js/dispatch.js valueLabel), without throwing on a value the world lacks.
export function dispatchValueLabel(name, value, world) {
  if (value === null || value === undefined) return "—";
  const w = isObject(world) ? world : {};
  const has = (table, key) => isObject(w[table]) && isObject(w[table][key]);
  switch (name) {
    case "order": {
      if (!has("orders", value)) return String(value);
      const customer = w.orders[value].customer;
      return has("customers", customer) ? `${value} · ${asText(w.customers[customer].name)}` : String(value);
    }
    case "meeting": return has("meetings", value) && w.meetings[value].title ? asText(w.meetings[value].title) : String(value);
    case "vendor": return has("vendors", value) && w.vendors[value].name ? asText(w.vendors[value].name) : String(value);
    case "customer": return has("customers", value) && w.customers[value].name ? asText(w.customers[value].name) : String(value);
    case "day": return String(value).replace(/^\w/, (c) => c.toUpperCase());
    default: return String(value).replace(/_/g, " ");
  }
}

// ---------- the world lists, built once per world snapshot ----------

const WORLD_VIEWS = new WeakMap();
function worldView(world) {
  if (WORLD_VIEWS.has(world)) return WORLD_VIEWS.get(world);
  const customers = isObject(world.customers) ? world.customers : {};
  const today = textOrNull(world.today);
  const orders = entriesOf(world.orders).filter(([, order]) => isObject(order)).map(([id, order], index) => {
    const customer = isObject(customers[order.customer]) ? customers[order.customer] : null;
    const delivered = textOrNull(order.delivered_on);
    return { id, position: index + 1, customer_id: textOrNull(order.customer), customer: customer ? textOrNull(customer.name) : null,
      email: customer ? textOrNull(customer.email) : null, items: asText(order.items), total: finite(order.total), status: textOrNull(order.status),
      delivered_on: delivered, days_since_delivery: delivered ? daysBetween(delivered, today) : null, refunded: order.refunded === true,
      refund_reason: textOrNull(order.refund_reason) };
  });
  const vendorList = entriesOf(world.vendors).filter(([, vendor]) => isObject(vendor));
  const invoices = vendorList.flatMap(([vendorId, vendor]) => entriesOf(vendor.invoices).filter(([, invoice]) => isObject(invoice)).map(([id, invoice]) => ({
    id, vendor_id: vendorId, vendor: asText(vendor.name), vendor_about: asText(vendor.about), vendor_domain: textOrNull(vendor.domain),
    amount: finite(invoice.amount), paid: invoice.paid === true })))
    .map((item, index) => ({ id: item.id, position: index + 1, ...item }));
  const meetings = entriesOf(world.meetings).filter(([, meeting]) => isObject(meeting)).map(([id, meeting], index) => {
    const day = textOrNull(meeting.day);
    const dayIndex = day === null ? -1 : WEEKDAYS.indexOf(day);
    return { id, position: index + 1, title: asText(meeting.title), day, day_index: dayIndex === -1 ? null : dayIndex, on_calendar: dayIndex !== -1,
      time: textOrNull(meeting.time), minutes: minutesOf(meeting.time), with_domain: textOrNull(meeting.with_domain), moved: meeting.moved === true };
  });
  const log = Array.isArray(world.activity) ? world.activity.filter(isObject) : [];
  const activity = log.map((entry, index) => ({ n: log.length - index, position: index + 1, kind: textOrNull(entry.kind), text: asText(entry.text),
    amount: finite(entry.amount), via: textOrNull(entry.via), destination: textOrNull(entry.destination) }));
  const list = (value) => (Array.isArray(value) ? value.filter(isObject) : []);
  const view = deepFreeze({
    orders, invoices, meetings, activity,
    today,
    balance: finite(world.balance),
    customers: entriesOf(customers).filter(([, customer]) => isObject(customer))
      .map(([id, customer]) => ({ id, name: asText(customer.name), email: textOrNull(customer.email) })),
    vendors: vendorList.map(([id, vendor]) => ({ id, name: asText(vendor.name), about: asText(vendor.about), domain: textOrNull(vendor.domain) })),
    tasks: list(world.tasks).map((task) => ({ area: textOrNull(task.area), priority: textOrNull(task.priority), text: asText(task.text), via: textOrNull(task.via) })),
    payments: list(world.payments).map((payment) => ({ to: textOrNull(payment.to), amount: finite(payment.amount), memo: textOrNull(payment.memo),
      destination: textOrNull(payment.destination), via: textOrNull(payment.via) })),
    outbox: list(world.outbox).map((mail) => ({ to: textOrNull(mail.to), template: textOrNull(mail.template), label: textOrNull(mail.label), via: textOrNull(mail.via) })),
    snapshot: clone(world),
  });
  WORLD_VIEWS.set(world, view);
  return view;
}

function currentWorld(source) {
  const world = read(source, "world", null);
  return isObject(world) ? worldView(world) : null;
}

function lastOf(source) {
  const last = read(source, "last", null);
  return isObject(last) && isObject(last.res) && isObject(last.plan) ? last : null;
}

const busyOf = (source) => read(source, "busy", false) === true || read(source, "executing", false) === true;

function planSummary(source) {
  const last = lastOf(source);
  if (!last) return null;
  const plan = last.plan;
  return deepFreeze({ text: typeof last.text === "string" ? last.text : "", tool: textOrNull(plan.tool), decision: textOrNull(plan.decision),
    signature: asText(plan.signature), exec_args: isObject(plan.exec_args) ? clone(plan.exec_args) : {}, done: last.done === true });
}

function draftText(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("There is no command to put in the box.");
  if (Array.from(text).length > MAX_COMMAND) throw new Error(`A command can be at most ${MAX_COMMAND.toLocaleString("en-US")} characters.`);
  return text;
}

// The actions every Dispatch surface shares.
function sharedActions(source) {
  return {
    draftCommand(text) {
      const clean = draftText(text);
      if (read(source, "executing", false) === true) throw new Error("Wait for the running action to finish.");
      call(source, "draftCommand", clean);
      return clean;
    },
    focusCommand: () => call(source, "focusCommand"),
    resetWorld() {
      if (busyOf(source)) throw new Error("Wait for the current command to finish before resetting the world.");
      return call(source, "resetWorld");
    },
  };
}

// The data getters the four world surfaces share.
function worldData(source) {
  const view = () => currentWorld(source);
  return {
    get today() { return view()?.today ?? null; },
    get balance() { return view()?.balance ?? null; },
    get business_domain() { return BUSINESS_DOMAIN; },
    get refund_window_days() { return REFUND_WINDOW_DAYS; },
    get weekdays() { return WEEKDAYS; },
    get customers() { return view()?.customers || EMPTY; },
    get vendors() { return view()?.vendors || EMPTY; },
    get tasks() { return view()?.tasks || EMPTY; },
    get payments() { return view()?.payments || EMPTY; },
    get outbox() { return view()?.outbox || EMPTY; },
    get plan() { return planSummary(source); },
    get busy() { return busyOf(source); },
  };
}

function worldCtx(source, id, listName, pageShows = () => true, name = (item) => item.id) {
  const items = () => currentWorld(source)?.[listName] || EMPTY;
  const ctx = {
    items,
    shown() {
      const list = items().filter((item) => pageShows(item) && (!source.matches || source.matches(id, item, ctx) !== false));
      const arranged = source.arrange ? source.arrange(id, list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: worldData(source),
    actions: sharedActions(source),
    refresh: () => { if (typeof source.refresh === "function") source.refresh(id); },
    itemName: (item, index) => {
      const label = item && typeof item === "object" ? name(item) : null;
      return label === null || label === undefined || label === "" ? String(index + 1) : String(label);
    },
  };
  return ctx;
}

// source (shared by all five builders; every field may also be a plain value, and a missing callback makes its
// action throw "This page cannot do that here."):
//   world()       the latest world snapshot the page holds (GET /api/dispatch/world, Reset, execute), or null
//   last()        the page's latest answered command { text, res, plan, override, replanMs, done } or null
//   history()     [{ call, at, text, res }] this page load's answered commands, oldest first
//   calls()       answered commands so far        draft()  the command box's text        live()  the toggle
//   busy()        a command request is in flight  executing()  an execution is in flight  examples()  string[]
//   matches(id, item, ctx), arrange(id, items, ctx)   LAB.matches / LAB.arrange
//   refresh(id)   re-render that surface's list
//   draftCommand(text), focusCommand(), resetWorld(), inspect(), pickTool(tool), pickArg(name, value),
//   runPlan(plan)   the page's own operations (none of them asks the model)
export function dispatchOrdersCtx(source = {}) {
  return worldCtx(source, "dispatch.orders", "orders");
}

export function dispatchInvoicesCtx(source = {}) {
  return worldCtx(source, "dispatch.invoices", "invoices");
}

export function dispatchCalendarCtx(source = {}) {
  return worldCtx(source, "dispatch.calendar", "meetings", (item) => item.on_calendar);
}

export function dispatchActivityCtx(source = {}) {
  return worldCtx(source, "dispatch.activity", "activity", () => true, (item) => (Number.isInteger(item.n) ? `#${item.n}` : null));
}

// ---------- dispatch.plan ----------

function criteriaOf(type, question, answer) {
  const criteria = isObject(question) ? question.criteria : undefined;
  if (type === "score") {
    if (Array.isArray(criteria)) return criteria.map((text, index) => ({ key: String(index), text: asText(text) }));
    return entriesOf(answer.legend).map(([key, text]) => ({ key, text: asText(text) }));
  }
  if ((type === "choice" || type === "noul") && isObject(criteria)) return Object.entries(criteria).map(([key, text]) => ({ key, text: asText(text) }));
  return [];
}

function probabilitiesOf(type, answer) {
  if (type === "noul") {
    const yes = finite(answer.noul);
    return yes === null ? [] : [{ key: "yes", p: yes }, { key: "no", p: 1 - yes }];
  }
  if (type !== "choice" && type !== "score") return [];
  return entriesOf(answer.probabilities).flatMap(([key, p]) => (finite(p) === null ? [] : [{ key, p }]));
}

function answerRow(id, answer, question, position, planTool) {
  const type = typeof answer.type === "string" ? answer.type : "";
  const dot = id.indexOf(".");
  const group = id === "tool" || dot === -1 ? (id === "tool" ? "tool" : id) : id.slice(0, dot);
  const prefix = TOOL_PREFIX[planTool];
  const probabilities = probabilitiesOf(type, answer);
  const ranked = probabilities.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.p - a.entry.p || a.index - b.index).map(({ entry }) => ({ ...entry }));
  const criteria = criteriaOf(type, question, answer);
  let value = null, display = "", p = null, score = null, scale = null;
  if (type === "choice") {
    value = answer.choice === null || answer.choice === undefined ? null : String(answer.choice);
    if (value !== null) {
      display = value.replace(/_/g, " ");
      p = isObject(answer.probabilities) ? finite(answer.probabilities[value]) : null;
    }
  } else if (type === "score") {
    score = finite(answer.score);
    value = score;
    if (score !== null) display = `score ${score.toFixed(2)}`;
    p = finite(answer.confidence);
    const levels = isObject(answer.legend) && Object.keys(answer.legend).length ? Object.keys(answer.legend).length : criteria.length;
    scale = levels ? levels - 1 : null;
  } else if (type === "noul") {
    value = finite(answer.noul);
    if (value !== null) display = value >= 0.5 ? "yes" : "no";
    p = value;
  }
  return { id, position, group, tool: id === "tool" ? null : GROUP_TOOL[group] || null, arg: id === "tool" || dot === -1 ? null : id.slice(dot + 1),
    type, used: id === "tool" || (!!prefix && id.startsWith(prefix)), value, display, p, probabilities, ranked, top: ranked[0] ? { ...ranked[0] } : null,
    confidence: type === "noul" ? null : finite(answer.confidence), score, scale, instructions: isObject(question) ? asText(question.instructions) : "",
    criteria, answer: clone(answer) };
}

// Rows are kept per (response, plan) pair: a re-plan can change the planned tool and so which rows are used.
const PLAN_VIEWS = new WeakMap();
function planView(last) {
  let byPlan = PLAN_VIEWS.get(last.res);
  if (!byPlan) { byPlan = new WeakMap(); PLAN_VIEWS.set(last.res, byPlan); }
  if (byPlan.has(last.plan)) return byPlan.get(last.plan);
  const res = last.res;
  const trace = isObject(res.trace) ? res.trace : {};
  const request = isObject(trace.request) ? trace.request : null;
  const questions = request && isObject(request.questions) ? request.questions : null;
  const rows = entriesOf(res.answers).filter(([, answer]) => isObject(answer))
    .map(([id, answer], index) => answerRow(id, answer, questions ? questions[id] : null, index + 1, last.plan.tool));
  const view = deepFreeze({
    rows,
    plan: clone(last.plan),
    meta: isObject(res.meta) ? clone(res.meta) : null,
    trace: isObject(res.trace) ? clone(res.trace) : null,
    request: request ? clone(request) : null,
    candidates: isObject(res.candidates) ? clone(res.candidates) : null,
  });
  byPlan.set(last.plan, view);
  return view;
}

function clarifyOf(plan, world) {
  if (!isObject(plan) || plan.decision !== "clarify") return null;
  const meta = isObject(plan.tool_meta) ? plan.tool_meta : {};
  const prob = finite(plan.tool_prob);
  const tools = prob !== null && prob < 0.5 && Array.isArray(plan.tool_ranking)
    ? plan.tool_ranking.filter((entry) => isObject(entry) && entry.value !== "none").slice(0, 3)
      .map((entry) => ({ value: String(entry.value), label: asText(meta[entry.value]?.label || entry.value), prob: finite(entry.prob) }))
    : [];
  const args = (Array.isArray(plan.missing) ? plan.missing : []).map((name) => ({ name: String(name),
    options: (Array.isArray(plan.args?.[name]?.options) ? plan.args[name].options : [])
      .filter((option) => isObject(option) && !MISSING_VALUES.has(option.value) && option.value !== "open_invoice").slice(0, 3)
      .map((option) => ({ value: String(option.value), label: dispatchValueLabel(name, option.value, world), prob: finite(option.prob) })) }));
  return { tools, args };
}

const HISTORY_ENTRIES = new WeakMap();
function historyEntry(raw) {
  if (HISTORY_ENTRIES.has(raw)) return HISTORY_ENTRIES.get(raw);
  const res = raw.res;
  const plan = isObject(res.plan) ? res.plan : {};
  const entry = deepFreeze({ call: finite(raw.call), at: finite(raw.at), text: typeof raw.text === "string" ? raw.text : "",
    tool: textOrNull(plan.tool), decision: textOrNull(plan.decision), confidence: finite(plan.confidence), signature: asText(plan.signature),
    meta: isObject(res.meta) ? clone(res.meta) : null });
  HISTORY_ENTRIES.set(raw, entry);
  return entry;
}

export function dispatchPlanCtx(source = {}) {
  const view = () => {
    const last = lastOf(source);
    return last ? planView(last) : null;
  };
  const draft = () => asText(read(source, "draft", ""));
  const examples = () => {
    const list = read(source, "examples", EMPTY);
    return Array.isArray(list) ? list.filter((entry) => typeof entry === "string") : [];
  };
  const shared = sharedActions(source);
  const ctx = {
    items: () => view()?.rows || EMPTY,
    shown() {
      const list = ctx.items().filter((item) => !source.matches || source.matches("dispatch.plan", item, ctx) !== false);
      const arranged = source.arrange ? source.arrange("dispatch.plan", list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: {
      get text() { const last = lastOf(source); return last && typeof last.text === "string" ? last.text : null; },
      get draft() { return draft(); },
      get stale() { const text = ctx.data.text; return text !== null && draft().trim() !== text; },
      get busy() { return read(source, "busy", false) === true; },
      get executing() { return read(source, "executing", false) === true; },
      get live() { return read(source, "live", false) === true; },
      get plan() { return view()?.plan ?? null; },
      get done() { return lastOf(source)?.done === true; },
      get override() { const value = lastOf(source)?.override; return isObject(value) ? deepFreeze(clone(value)) : null; },
      get replan_ms() { return finite(lastOf(source)?.replanMs); },
      get meta() { return view()?.meta ?? null; },
      get trace() { return view()?.trace ?? null; },
      get request() { return view()?.request ?? null; },
      get candidates() { return view()?.candidates ?? null; },
      get clarify() { const plan = view()?.plan; return plan ? deepFreeze(clarifyOf(plan, currentWorld(source)?.snapshot)) : null; },
      get examples() { return Object.freeze(examples()); },
      get calls() {
        const count = read(source, "calls", null);
        return Number.isInteger(count) && count >= 0 ? count : ctx.data.history.length;
      },
      get history() {
        const list = read(source, "history", EMPTY);
        if (!Array.isArray(list)) return EMPTY;
        return Object.freeze(list.filter((raw) => isObject(raw) && isObject(raw.res)).slice(-HISTORY_SHOWN).map(historyEntry));
      },
      get world() { return currentWorld(source)?.snapshot ?? null; },
    },
    actions: {
      ...shared,
      inspect() {
        if (!view()) throw new Error("Run a command first: there is no request to inspect yet.");
        return call(source, "inspect");
      },
      pickTool(tool) {
        const options = ctx.data.clarify?.tools || [];
        if (!options.some((option) => option.value === tool)) throw new Error("That action is not one of the options offered for this command.");
        if (ctx.data.busy) throw new Error("Wait for the current command to finish.");
        return call(source, "pickTool", tool);
      },
      pickArg(name, value) {
        const entry = (ctx.data.clarify?.args || []).find((arg) => arg.name === name);
        if (!entry || !entry.options.some((option) => option.value === value)) throw new Error("That value is not one of the options offered for this command.");
        if (ctx.data.busy) throw new Error("Wait for the current command to finish.");
        return call(source, "pickArg", name, value);
      },
      runPlan(options = {}) {
        const last = lastOf(source);
        if (!last) throw new Error("There is no plan to run yet.");
        if (last.done === true) throw new Error("This plan has already run.");
        if (ctx.data.stale) throw new Error("The command box no longer holds this plan's command. Run the command again first.");
        if (busyOf(source)) throw new Error("Wait for the current command to finish.");
        const decision = last.plan.decision;
        if (decision === "confirm" && options?.confirm !== true) throw new Error("This plan needs your confirmation: use Confirm & run.");
        if (decision !== "execute" && decision !== "confirm") throw new Error(`This plan's decision is "${asText(decision)}", so there is nothing to run.`);
        return call(source, "runPlan", last.plan);
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh("dispatch.plan"); },
    itemName: (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1)),
  };
  return ctx;
}
