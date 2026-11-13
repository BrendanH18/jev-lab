// Fixtures for packs on the Dispatch page's Lab surfaces (contract: static/js/lab/surfaces/dispatch.js). Not a test file.
//
//   import { sampleDispatchOrdersCtx } from "./fixtures/dispatch.mjs";
//   const ctx = sampleDispatchOrdersCtx();                       // the hand-written world below
//   const empty = sampleDispatchOrdersCtx({ world: null });       // before the world loads: items() is []
//
// Every sample<Name>Ctx(overrides) builds a REAL ctx with the page's own builder from a fresh copy of the data here, so
// edits in one test never leak into another. overrides replace fields of the source state:
//   world, last, history, calls, draft, live, busy, executing, examples   (see the builders' source in the contract)
//   matches(id, item, ctx), arrange(id, items, ctx)                        stand-ins for LAB.matches / LAB.arrange
// The returned ctx also carries:
//   ctx.recorded   [[action name, ...args], ...] every page callback an action reached (draftCommand, focusCommand,
//                  resetWorld, inspect, pickTool, pickArg, runPlan, refresh). No action asks the model.
//   ctx.state      the mutable source state, so a test can flip busy, executing or draft after building
//   ctx.env        a fakeEnv() (toasts, copied, downloads) from the harness
//
// The world (today 2026-03-20, a Friday; balance $16,451.00) is the seeded Harbor Coffee Co. after a few actions,
// plus odd rows pack tests should survive:
//   orders     A-1041 delivered 3 days ago · A-1042 delivered 12 days ago, REFUNDED (damaged) · A-1043 in transit ·
//              A-1044 delivered 41 days ago (outside the 30-day window) · A-1045 processing (wholesale) ·
//              A-1046 unknown customer, no items, no total, no status, unreadable delivery date
//   invoices   INV-7781 $4,250 open · INV-7790 $1,200 PAID (Bean Brokers) · PR-2210 $860 open · PR-2214 $95.50 open
//              (PackRight has TWO open invoices) · SF-0930 $420 open · SF-0931 no amount, open · RW-5001 $21,500 open
//              (more than the balance). Coastline Freight has no invoice, so it gives no row.
//   calendar   bean_brokers_call Tue 10:00 · team_sync Fri 11:00 MOVED (clashes with accountant_review Fri 11:00) ·
//              northside_tasting Thu 14:00 · accountant_review Fri 11:00 · weekend_cupping SATURDAY 08:30 (the page's
//              own filter hides it: not on the Monday-Friday calendar) · late_pickup Mon 18:30 · inventory_count Thu,
//              time "TBD" (unreadable), no domain
//   activity   7 entries, newest first: an unmatched $500 payment, a reply, an urgent task, a calendar move, a $1,200
//              payment (INV-7790), a $249 refund (A-1042), and an oldest entry with no kind or via
// The plan (fixtureLast) is "refund maya's order, the bag arrived torn open": 12 built-in answers (11 Choice and the
// task.priority Score) plus two answers the built-in request never asks, so packs meet every type: flag.complaint
// (Noul, 0.73) and flag.photo (type "box", no value). Decision "confirm": refund.reason is a close call (damaged 0.48
// vs not_stated 0.46), so confidence 0.48 is below the 0.80 a refund needs. fixtureClarifyLast() is a "Which did you
// mean?" plan (tool 0.41) and fixtureMissingLast() a "Which customer?" plan. Answers here are MADE UP for tests only.
import { dispatchActivityCtx, dispatchCalendarCtx, dispatchInvoicesCtx, dispatchOrdersCtx, dispatchPlanCtx } from "../../../../static/js/lab/surfaces/dispatch.js";
import { fakeEnv } from "../harness.mjs";

export const fixtureWorld = () => ({
  today: "2026-03-20",
  balance: 16451.0,
  customers: {
    maya_chen: { name: "Maya Chen", email: "maya.chen@mail.example" },
    luis_ortega: { name: "Luis Ortega", email: "lortega@mail.example" },
    priya_nair: { name: "Priya Nair", email: "priya@nairdesign.example" },
    tom_becker: { name: "Tom Becker", email: "tom.becker@mail.example" },
    northside_bistro: { name: "Northside Bistro", email: "orders@northsidebistro.example" },
  },
  orders: {
    "A-1041": { customer: "maya_chen", items: "2 x Ethiopia Yirgacheffe, 12 oz bags", total: 38.0, status: "delivered", delivered_on: "2026-03-17", refunded: false },
    "A-1042": { customer: "luis_ortega", items: "Conical burr grinder", total: 249.0, status: "delivered", delivered_on: "2026-03-08", refunded: true, refund_reason: "damaged" },
    "A-1043": { customer: "priya_nair", items: "Espresso sampler box", total: 54.0, status: "in transit", delivered_on: null, refunded: false },
    "A-1044": { customer: "tom_becker", items: "Cold brew starter kit", total: 64.0, status: "delivered", delivered_on: "2026-02-07", refunded: false },
    "A-1045": { customer: "northside_bistro", items: "20 lb House Blend (wholesale)", total: 310.0, status: "processing", delivered_on: null, refunded: false },
    "A-1046": { customer: "ghost_account", delivered_on: "soon", refunded: false },
  },
  vendors: {
    bean_brokers: { name: "Bean Brokers Ltd", about: "green coffee importer", domain: "beanbrokers.example",
      invoices: { "INV-7781": { amount: 4250.0, paid: false }, "INV-7790": { amount: 1200.0, paid: true } } },
    packright: { name: "PackRight Packaging", about: "coffee bags, labels, and boxes", domain: "packright.example",
      invoices: { "PR-2210": { amount: 860.0, paid: false }, "PR-2214": { amount: 95.5, paid: false } } },
    coastline_freight: { name: "Coastline Freight", about: "pallet shipping for wholesale orders", domain: "coastlinefreight.example", invoices: {} },
    sparkle_facility: { name: "Sparkle Facility Services", about: "cleaning and roaster maintenance", domain: "sparklefs.example",
      invoices: { "SF-0930": { amount: 420.0, paid: false }, "SF-0931": { paid: false } } },
    roastworks: { name: "Roastworks Machinery", about: "roaster parts and service", domain: "roastworks.example",
      invoices: { "RW-5001": { amount: 21500.0, paid: false } } },
  },
  meetings: {
    bean_brokers_call: { title: "Supplier call with Bean Brokers", day: "tuesday", time: "10:00", with_domain: "beanbrokers.example" },
    team_sync: { title: "Weekly team sync", day: "friday", time: "11:00", with_domain: "harborcoffee.example", moved: true },
    northside_tasting: { title: "Wholesale tasting with Northside Bistro", day: "thursday", time: "14:00", with_domain: "northsidebistro.example" },
    accountant_review: { title: "Quarterly review with the accountant", day: "friday", time: "11:00", with_domain: "ledgerwisecpa.example" },
    weekend_cupping: { title: "Weekend cupping with the roasting team", day: "saturday", time: "08:30", with_domain: "harborcoffee.example" },
    late_pickup: { title: "Late pallet pickup", day: "monday", time: "18:30", with_domain: "coastlinefreight.example" },
    inventory_count: { title: "Inventory count", day: "thursday", time: "TBD" },
  },
  payments: [
    { to: "Coastline Freight", amount: 500.0, memo: "Unmatched payment", destination: "account on file", via: "dispatch" },
    { to: "Bean Brokers Ltd", amount: 1200.0, memo: "INV-7790", destination: "account on file", via: "dispatch" },
    { to: "Luis Ortega", amount: 249.0, memo: "Refund A-1042", via: "dispatch" },
  ],
  tasks: [{ area: "equipment", priority: "urgent", text: "the grinder in the tasting room is jammed again, get it looked at asap", via: "dispatch" }],
  outbox: [{ to: "priya@nairdesign.example", template: "wholesale_pricing", label: "Wholesale pricing", text: "We'd love to work together!", via: "dispatch" }],
  activity: [
    { kind: "payment", text: "Paid $500.00 to Coastline Freight (no invoice)", amount: 500.0, via: "dispatch", destination: "account on file" },
    { kind: "reply", text: "Sent “Wholesale pricing” to priya@nairdesign.example", via: "dispatch" },
    { kind: "task", text: "New equipment task (urgent): the grinder in the tasting room is jammed again, get it looked at asap", via: "dispatch" },
    { kind: "calendar", text: "Moved “Weekly team sync” from Wednesday 09:00 to Friday 11:00", via: "dispatch" },
    { kind: "payment", text: "Paid $1,200.00 to Bean Brokers Ltd (INV-7790)", amount: 1200.0, via: "dispatch", destination: "account on file" },
    { kind: "refund", text: "Refunded $249.00 for A-1042 (damaged)", amount: 249.0, via: "dispatch" },
    { text: "Imported note" },
  ],
});

const choice = (pick, probabilities) => ({ type: "choice", choice: pick, probabilities, confidence: probabilities[pick] });

export const fixtureAnswers = () => ({
  tool: choice("refund_order", { refund_order: 0.86, reschedule_meeting: 0.01, pay_vendor: 0.02, create_task: 0.06, send_info: 0.03, none: 0.02 }),
  "refund.order": choice("A-1041", { "A-1041": 0.91, "A-1042": 0.02, "A-1043": 0.01, "A-1044": 0.03, "A-1045": 0.01, "A-1046": 0.01, not_identified: 0.01 }),
  "refund.reason": choice("damaged", { damaged: 0.48, wrong_item: 0.02, not_delivered: 0.01, changed_mind: 0.03, not_stated: 0.46 }),
  "reschedule.meeting": choice("not_identified", { bean_brokers_call: 0.01, team_sync: 0.01, northside_tasting: 0.005, accountant_review: 0.005, not_identified: 0.97 }),
  "reschedule.day": choice("not_stated", { monday: 0.01, tuesday: 0.01, wednesday: 0.01, thursday: 0.01, friday: 0.01, not_stated: 0.95 }),
  "reschedule.time": choice("not_stated", { morning: 0.02, afternoon: 0.02, not_stated: 0.96 }),
  "pay.vendor": choice("not_identified", { bean_brokers: 0.03, packright: 0.02, coastline_freight: 0.01, sparkle_facility: 0.01, roastworks: 0.01, not_identified: 0.92 }),
  "pay.amount": choice("not_stated", { open_invoice: 0.1, not_stated: 0.9 }),
  "task.area": choice("shipping", { roasting: 0.05, equipment: 0.05, shipping: 0.6, wholesale: 0.1, marketing: 0.05, admin: 0.15 }),
  "task.priority": { type: "score", score: 1.62, legend: { 0: "Low", 1: "Normal", 2: "Urgent" }, probabilities: { 0: 0.05, 1: 0.28, 2: 0.67 }, confidence: 0.67 },
  "info.template": choice("return_policy", { shipping_times: 0.1, return_policy: 0.7, wholesale_pricing: 0.05, subscription_help: 0.05, brewing_guide: 0.1 }),
  "info.customer": choice("maya_chen", { maya_chen: 0.88, luis_ortega: 0.03, priya_nair: 0.03, tom_becker: 0.02, northside_bistro: 0.02, not_identified: 0.02 }),
  "flag.complaint": { type: "noul", noul: 0.73 },
  "flag.photo": { type: "box" },
});

const crit = (keys) => Object.fromEntries(keys.map((key) => [key, `Option ${key}`]));
export const fixtureQuestions = () => {
  const answers = fixtureAnswers();
  const questions = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (answer.type === "choice") questions[id] = { type: "choice", instructions: `Question ${id}?`, criteria: crit(Object.keys(answer.probabilities)) };
  }
  questions.tool.instructions = "Which one action does the shop owner's command in `request` ask Harbor Coffee to take?";
  questions["refund.reason"].criteria.not_stated = null;
  questions["task.priority"] = { type: "score", instructions: "How urgent is the work that `request` asks for?",
    criteria: ["Low: whenever someone has time", "Normal: should happen within the week", "Urgent: today, because it blocks sales, shipping, or safety"] };
  questions["flag.complaint"] = { type: "noul", instructions: "Is `request` a complaint?" };
  questions["flag.photo"] = { type: "box", instructions: "Where is the damage?" };
  return questions;
};

const TOOL_META = { refund_order: { label: "Refund an order", risk: "medium", threshold: 0.8 }, reschedule_meeting: { label: "Reschedule a meeting", risk: "medium", threshold: 0.75 },
  pay_vendor: { label: "Pay a vendor", risk: "high", threshold: 0.9 }, create_task: { label: "Create a task", risk: "low", threshold: 0.5 },
  send_info: { label: "Send standard info", risk: "low", threshold: 0.5 }, none: { label: "No action", risk: "none", threshold: 0 } };

export const fixturePlan = () => ({
  tool: "refund_order", tool_prob: 0.86,
  tool_ranking: [{ value: "refund_order", prob: 0.86 }, { value: "create_task", prob: 0.06 }, { value: "send_info", prob: 0.03 }, { value: "pay_vendor", prob: 0.02 },
    { value: "none", prob: 0.02 }, { value: "reschedule_meeting", prob: 0.01 }],
  args: {
    order: { value: "A-1041", prob: 0.91, options: [{ value: "A-1041", prob: 0.91 }, { value: "A-1044", prob: 0.03 }, { value: "A-1042", prob: 0.02 }, { value: "A-1043", prob: 0.01 }] },
    reason: { value: "damaged", prob: 0.48, options: [{ value: "damaged", prob: 0.48 }, { value: "not_stated", prob: 0.46 }, { value: "changed_mind", prob: 0.03 }, { value: "wrong_item", prob: 0.02 }] },
  },
  exec_args: { order: "A-1041", reason: "damaged" }, missing: [], confidence: 0.48, signature: 'refund_order(order="A-1041", reason="damaged")',
  decision: "confirm", reasons: ["Confidence 48% is below the 80% a medium-risk action needs"],
  checks: [{ id: "not_refunded", ok: true, level: "ok", label: "Not already refunded", detail: "No previous refund" },
    { id: "refund_window", ok: true, level: "ok", label: "Within 30-day window", detail: "Delivered 3 days ago" }],
  tool_meta: TOOL_META,
});

const TEXT = "refund maya's order, the bag arrived torn open";
const res = (plan, text = TEXT, meta = {}) => ({
  answers: fixtureAnswers(), plan, candidates: { amounts: [], times: [] },
  meta: { model: "jev-1.14", latency_ms: 412.5, question_count: 14, input_tokens: 1830, output_tokens: 96, cost_usd: 0.00041, backend: "sdk", ...meta },
  trace: { request: { state: { assistant_for: "Harbor Coffee Co., a small coffee roaster", request: text }, model: "jev-1.14", questions: fixtureQuestions() },
    response: { answers: fixtureAnswers() }, meta: {} },
});

// The page's S.last for the shown command (decision "confirm").
export const fixtureLast = () => {
  const r = res(fixturePlan());
  return { text: TEXT, res: r, plan: r.plan, override: null };
};

// "Which did you mean?": the top action is below 50%, so the page offers the three likeliest real actions.
export const fixtureClarifyLast = () => {
  const plan = { ...fixturePlan(), tool: "create_task", tool_prob: 0.41,
    tool_ranking: [{ value: "create_task", prob: 0.41 }, { value: "none", prob: 0.3 }, { value: "send_info", prob: 0.15 }, { value: "reschedule_meeting", prob: 0.1 },
      { value: "refund_order", prob: 0.03 }, { value: "pay_vendor", prob: 0.01 }],
    args: { area: { value: "wholesale", prob: 0.5, options: [{ value: "wholesale", prob: 0.5 }] }, priority: { value: "normal", prob: 0.6, score: 1.1, ungated: true } },
    exec_args: { area: "wholesale", priority: "normal", text: "hmm what about the bistro thing" }, confidence: 0.41,
    signature: 'create_task(area="wholesale", priority="normal")', decision: "clarify", reasons: ["Not sure which action is meant (41%)"], checks: [] };
  const r = res(plan, "hmm what about the bistro thing");
  return { text: "hmm what about the bistro thing", res: r, plan, override: null };
};

// "Which customer?": the action is clear but its customer is not.
export const fixtureMissingLast = () => {
  const plan = { ...fixturePlan(), tool: "send_info", tool_prob: 0.9,
    args: { template: { value: "brewing_guide", prob: 0.93, options: [{ value: "brewing_guide", prob: 0.93 }] },
      customer: { value: "not_identified", prob: 0.6, options: [{ value: "not_identified", prob: 0.6 }, { value: "luis_ortega", prob: 0.2 }, { value: "maya_chen", prob: 0.1 }, { value: "priya_nair", prob: 0.05 }] } },
    exec_args: { template: "brewing_guide", customer: "not_identified" }, missing: ["customer"], confidence: 0.6,
    signature: 'send_info(template="brewing_guide", customer="not_identified")', decision: "clarify", reasons: ["Missing: customer"], checks: [] };
  const r = res(plan, "send the brewing guide to him");
  return { text: "send the brewing guide to him", res: r, plan, override: null };
};

// This page load's answered commands, oldest first; the last entry is the shown command.
export const fixtureHistory = (last = fixtureLast()) => [
  { call: 1, at: 1774000000000, text: "pay packright's invoice",
    res: res({ ...fixturePlan(), tool: "pay_vendor", decision: "clarify", confidence: 0.55, signature: 'pay_vendor(vendor="packright")' }, "pay packright's invoice",
      { latency_ms: 388.0, cost_usd: 0.00038, input_tokens: 1790, output_tokens: 94 }) },
  { call: 2, at: 1774000060000, text: last.text, res: last.res },
];

export const fixtureExamples = () => ["refund maya's order, the bag arrived torn open", "move the supplier call to thursday at 2pm", "pay packright's invoice"];

function source(overrides) {
  const last = overrides.last === undefined ? fixtureLast() : overrides.last;
  const state = {
    world: fixtureWorld(), last, history: last ? fixtureHistory(last) : [], calls: last ? 2 : 0, draft: last ? last.text : "", live: true,
    busy: false, executing: false, examples: fixtureExamples(), matches: null, arrange: null, ...overrides,
  };
  if (overrides.last !== undefined && overrides.history === undefined) state.history = last ? fixtureHistory(last) : [];
  if (overrides.last !== undefined && overrides.calls === undefined) state.calls = state.history.length;
  if (overrides.last !== undefined && overrides.draft === undefined) state.draft = last ? last.text : "";
  const recorded = [];
  const record = (name) => (...args) => { recorded.push([name, ...args]); return name; };
  const src = {
    world: () => state.world, last: () => state.last, history: () => state.history, calls: () => state.calls, draft: () => state.draft,
    live: () => state.live, busy: () => state.busy, executing: () => state.executing, examples: () => state.examples,
    matches: (id, item, ctx) => (state.matches ? state.matches(id, item, ctx) : true),
    arrange: (id, items, ctx) => (state.arrange ? state.arrange(id, items, ctx) : items),
    refresh: record("refresh"),
    draftCommand: (text) => { recorded.push(["draftCommand", text]); state.draft = text; },
    focusCommand: record("focusCommand"), resetWorld: record("resetWorld"),
    inspect: record("inspect"), pickTool: record("pickTool"), pickArg: record("pickArg"), runPlan: record("runPlan"),
  };
  return { state, recorded, src };
}

function sample(builder, overrides) {
  const { state, recorded, src } = source(overrides);
  const ctx = builder(src);
  ctx.recorded = recorded;
  ctx.state = state;
  ctx.env = fakeEnv();
  return ctx;
}

export const sampleDispatchOrdersCtx = (overrides = {}) => sample(dispatchOrdersCtx, overrides);
export const sampleDispatchInvoicesCtx = (overrides = {}) => sample(dispatchInvoicesCtx, overrides);
export const sampleDispatchCalendarCtx = (overrides = {}) => sample(dispatchCalendarCtx, overrides);
export const sampleDispatchActivityCtx = (overrides = {}) => sample(dispatchActivityCtx, overrides);
export const sampleDispatchPlanCtx = (overrides = {}) => sample(dispatchPlanCtx, overrides);
