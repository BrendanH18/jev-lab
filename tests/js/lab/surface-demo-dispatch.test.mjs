// The Dispatch page's Lab surfaces: the pure builders of static/js/lab/surfaces/dispatch.js, and the page's own hook
// code in static/js/dispatch.js (rebuilt from its source with stand-ins for the DOM helpers, as
// tests/js/build-refinements.test.mjs does), so the wiring the browser runs is the wiring tested here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { dispatchActivityCtx, dispatchCalendarCtx, dispatchInvoicesCtx, dispatchOrdersCtx, dispatchPlanCtx, dispatchValueLabel }
  from "../../../static/js/lab/surfaces/dispatch.js";
import activityPack from "../../../static/js/lab/packs/dispatch/dispatch-activity-log.js";
import invoicePack from "../../../static/js/lab/packs/dispatch/dispatch-invoice-desk.js";
import orderPack from "../../../static/js/lab/packs/dispatch/dispatch-order-desk.js";
import planPack from "../../../static/js/lab/packs/dispatch/dispatch-plan-review.js";
import weekPack from "../../../static/js/lab/packs/dispatch/dispatch-week-planner.js";
import { fixtureClarifyLast, fixtureHistory, fixtureLast, fixtureMissingLast, fixtureWorld, sampleDispatchActivityCtx, sampleDispatchCalendarCtx,
  sampleDispatchInvoicesCtx, sampleDispatchOrdersCtx, sampleDispatchPlanCtx } from "./fixtures/dispatch.mjs";
import { fakeEnv, find, findAll, textOf } from "./harness.mjs";

const ALL = [sampleDispatchOrdersCtx, sampleDispatchInvoicesCtx, sampleDispatchCalendarCtx, sampleDispatchActivityCtx, sampleDispatchPlanCtx];

// ---------- builders ----------

test("order, invoice, meeting and activity items have the documented shape", () => {
  const orders = sampleDispatchOrdersCtx().items();
  assert.deepEqual(orders[0], { id: "A-1041", position: 1, customer_id: "maya_chen", customer: "Maya Chen", email: "maya.chen@mail.example",
    items: "2 x Ethiopia Yirgacheffe, 12 oz bags", total: 38, status: "delivered", delivered_on: "2026-03-17", days_since_delivery: 3, refunded: false, refund_reason: null });
  assert.deepEqual(orders[1].refund_reason, "damaged");
  assert.deepEqual(orders[5], { id: "A-1046", position: 6, customer_id: "ghost_account", customer: null, email: null, items: "", total: null, status: null,
    delivered_on: "soon", days_since_delivery: null, refunded: false, refund_reason: null });
  const invoices = sampleDispatchInvoicesCtx().items();
  assert.deepEqual(invoices.map((item) => item.id), ["INV-7781", "INV-7790", "PR-2210", "PR-2214", "SF-0930", "SF-0931", "RW-5001"]);
  assert.deepEqual(invoices[1], { id: "INV-7790", position: 2, vendor_id: "bean_brokers", vendor: "Bean Brokers Ltd", vendor_about: "green coffee importer",
    vendor_domain: "beanbrokers.example", amount: 1200, paid: true });
  assert.equal(invoices[5].amount, null);
  const meetings = sampleDispatchCalendarCtx().items();
  assert.deepEqual(meetings[1], { id: "team_sync", position: 2, title: "Weekly team sync", day: "friday", day_index: 4, on_calendar: true, time: "11:00", minutes: 660,
    with_domain: "harborcoffee.example", moved: true });
  assert.deepEqual(meetings[4].on_calendar, false);
  assert.deepEqual([meetings[6].minutes, meetings[6].with_domain, meetings[4].day_index], [null, null, null]);
  const activity = sampleDispatchActivityCtx().items();
  assert.deepEqual(activity[0], { n: 7, position: 1, kind: "payment", text: "Paid $500.00 to Coastline Freight (no invoice)", amount: 500, via: "dispatch", destination: "account on file" });
  assert.deepEqual(activity[6], { n: 1, position: 7, kind: null, text: "Imported note", amount: null, via: null, destination: null });
});

test("plan rows have the documented shape for Choice, Score, Noul and other answers", () => {
  const rows = sampleDispatchPlanCtx().items();
  assert.deepEqual(rows.map((row) => row.id), ["tool", "refund.order", "refund.reason", "reschedule.meeting", "reschedule.day", "reschedule.time", "pay.vendor",
    "pay.amount", "task.area", "task.priority", "info.template", "info.customer", "flag.complaint", "flag.photo"]);
  const [tool, order, reason] = rows;
  assert.deepEqual([tool.group, tool.tool, tool.arg, tool.used, tool.value, tool.display, tool.p], ["tool", null, null, true, "refund_order", "refund order", 0.86]);
  assert.deepEqual([order.group, order.tool, order.arg, order.used], ["refund", "refund_order", "order", true]);
  assert.deepEqual(reason.ranked.slice(0, 2), [{ key: "damaged", p: 0.48 }, { key: "not_stated", p: 0.46 }]);
  assert.deepEqual(reason.criteria.at(-1), { key: "not_stated", text: "" }, "a null description reads empty");
  assert.equal(reason.instructions, "Question refund.reason?");
  const priority = rows[9];
  assert.deepEqual([priority.type, priority.value, priority.score, priority.scale, priority.display, priority.p, priority.confidence, priority.used],
    ["score", 1.62, 1.62, 2, "score 1.62", 0.67, 0.67, false]);
  assert.deepEqual(priority.top, { key: "2", p: 0.67 });
  assert.equal(priority.criteria.length, 3);
  const noul = rows[12];
  assert.deepEqual([noul.value, noul.display, noul.p, noul.confidence, noul.tool, noul.arg], [0.73, "yes", 0.73, null, null, "complaint"]);
  assert.equal(noul.probabilities[1].key, "no");
  assert.ok(Math.abs(noul.probabilities[1].p - 0.27) < 1e-12);
  const box = rows[13];
  assert.deepEqual([box.type, box.value, box.display, box.p, box.top, box.probabilities, box.criteria], ["box", null, "", null, null, [], []]);
  assert.deepEqual(box.answer, { type: "box" });
});

test("a re-plan to another action changes which rows are used, without a new answer", () => {
  const last = fixtureLast();
  const ctx = sampleDispatchPlanCtx({ last });
  assert.deepEqual(ctx.items().filter((row) => row.used).map((row) => row.id), ["tool", "refund.order", "refund.reason"]);
  last.plan = { ...last.plan, tool: "send_info" };
  assert.deepEqual(ctx.items().filter((row) => row.used).map((row) => row.id), ["tool", "info.template", "info.customer"]);
});

test("items are frozen, keep their identity until the list changes, and are [] before data arrives", () => {
  for (const sample of ALL) {
    const ctx = sample();
    const first = ctx.items();
    assert.ok(first.length > 0);
    assert.equal(ctx.items(), first, "the same array while nothing changed");
    assert.equal(ctx.shown()[0], first[0], "shown() hands out the same objects");
    assert.ok(Object.isFrozen(first[0]));
    assert.throws(() => { "use strict"; first[0].id = "x"; }, TypeError);
    assert.deepEqual(sample({ world: null, last: null }).items(), []);
    assert.deepEqual(sample({ world: null, last: null }).shown(), []);
  }
  const ctx = sampleDispatchOrdersCtx();
  const before = ctx.items();
  ctx.state.world = { ...fixtureWorld(), orders: { "A-2000": { customer: "maya_chen", items: "Mug", total: 12, status: "delivered", delivered_on: "2026-03-19", refunded: false } } };
  assert.notEqual(ctx.items(), before, "a new snapshot gives new items");
  assert.deepEqual(ctx.items().map((item) => [item.id, item.days_since_delivery]), [["A-2000", 1]]);
});

test("shown() keeps the calendar's own weekday filter, then Lab filters, then Lab's sort", () => {
  const calendar = sampleDispatchCalendarCtx();
  assert.equal(calendar.items().length, 7);
  assert.deepEqual(calendar.shown().map((item) => item.id), ["bean_brokers_call", "team_sync", "northside_tasting", "accountant_review", "late_pickup", "inventory_count"]);
  const seen = [];
  const filtered = sampleDispatchCalendarCtx({ matches: (id, item, ctx) => { seen.push([id, ctx === filtered]); return item.day === "friday" || item.day === "saturday"; },
    arrange: (id, items) => items.slice().reverse() });
  assert.deepEqual(filtered.shown().map((item) => item.id), ["accountant_review", "team_sync"], "saturday stays hidden even when a Lab filter would keep it");
  assert.deepEqual(seen[0], ["dispatch.calendar", true]);
  const orders = sampleDispatchOrdersCtx({ matches: (id, item) => !item.refunded, arrange: (id, items) => items.slice().sort((a, b) => (b.total ?? -1) - (a.total ?? -1)) });
  assert.deepEqual(orders.shown().map((item) => item.id), ["A-1045", "A-1044", "A-1043", "A-1041", "A-1046"]);
  const plan = sampleDispatchPlanCtx({ matches: (id, item) => id === "dispatch.plan" && item.used });
  assert.deepEqual(plan.shown().map((item) => item.id), ["tool", "refund.order", "refund.reason"]);
  const broken = sampleDispatchActivityCtx({ arrange: () => "not a list" });
  assert.equal(broken.shown().length, 7, "a bad arrange result falls back to the filtered list");
});

test("Lab filters and sorts from real packs reach shown() through LAB.matches and LAB.arrange", () => {
  const lab = createLab([orderPack, invoicePack, weekPack, activityPack, planPack]);
  const hooks = { matches: (id, item, ctx) => lab.matches(id, item, ctx), arrange: (id, items, ctx) => lab.arrange(id, items, ctx) };
  const orders = sampleDispatchOrdersCtx(hooks);
  assert.equal(orders.shown().length, 6, "no Lab filter: everything");
  lab.view("dispatch.orders").filters = [{ key: "dispatch-order-desk/total", op: "min", value: "60" }];
  lab.view("dispatch.orders").sort = { key: "dispatch-order-desk/total", dir: "desc" };
  assert.deepEqual(orders.shown().map((item) => item.id), ["A-1045", "A-1042", "A-1044"]);
  assert.equal(lab.active("dispatch.orders"), 2);
  lab.reset("dispatch.orders");
  assert.deepEqual(orders.shown().map((item) => item.id), ["A-1041", "A-1042", "A-1043", "A-1044", "A-1045", "A-1046"]);
  const calendar = sampleDispatchCalendarCtx(hooks);
  lab.view("dispatch.calendar").filters = [{ key: "dispatch-week-planner/internal", op: "with" }];
  assert.deepEqual(calendar.shown().map((item) => item.id), ["team_sync"], "the internal saturday meeting stays hidden by the page");
});

test("world data fields hold the snapshot's values and are empty before it loads", () => {
  const { data } = sampleDispatchOrdersCtx();
  assert.equal(data.today, "2026-03-20");
  assert.equal(data.balance, 16451);
  assert.equal(data.business_domain, "harborcoffee.example");
  assert.equal(data.refund_window_days, 30);
  assert.deepEqual(data.weekdays, ["monday", "tuesday", "wednesday", "thursday", "friday"]);
  assert.deepEqual(data.customers[2], { id: "priya_nair", name: "Priya Nair", email: "priya@nairdesign.example" });
  assert.deepEqual(data.vendors.map((vendor) => vendor.id), ["bean_brokers", "packright", "coastline_freight", "sparkle_facility", "roastworks"]);
  assert.deepEqual(data.tasks, [{ area: "equipment", priority: "urgent", text: "the grinder in the tasting room is jammed again, get it looked at asap", via: "dispatch" }]);
  assert.deepEqual(data.payments[2], { to: "Luis Ortega", amount: 249, memo: "Refund A-1042", destination: null, via: "dispatch" });
  assert.deepEqual(data.outbox, [{ to: "priya@nairdesign.example", template: "wholesale_pricing", label: "Wholesale pricing", via: "dispatch" }], "no template text");
  assert.deepEqual(data.plan, { text: "refund maya's order, the bag arrived torn open", tool: "refund_order", decision: "confirm",
    signature: 'refund_order(order="A-1041", reason="damaged")', exec_args: { order: "A-1041", reason: "damaged" }, done: false });
  assert.equal(data.busy, false);
  assert.ok(Object.isFrozen(data.customers) && Object.isFrozen(data.plan));
  const none = sampleDispatchInvoicesCtx({ world: null, last: null }).data;
  assert.deepEqual([none.today, none.balance, none.customers, none.vendors, none.tasks, none.payments, none.outbox, none.plan, none.busy],
    [null, null, [], [], [], [], [], null, false]);
  assert.equal(sampleDispatchCalendarCtx({ executing: true }).data.busy, true);
});

test("plan data fields describe the user's latest command and are empty before it", () => {
  const ctx = sampleDispatchPlanCtx();
  const { data } = ctx;
  assert.equal(data.text, "refund maya's order, the bag arrived torn open");
  assert.equal(data.draft, data.text);
  assert.equal(data.stale, false);
  ctx.state.draft = "  refund maya's order, the bag arrived torn open  ";
  assert.equal(data.stale, false, "trimmed like the page");
  ctx.state.draft = "refund tom's order";
  assert.equal(data.stale, true);
  assert.equal(data.plan.decision, "confirm");
  assert.equal(data.done, false);
  assert.equal(data.meta.cost_usd, 0.00041);
  assert.equal(data.request.state.request, "refund maya's order, the bag arrived torn open");
  assert.deepEqual(data.candidates, { amounts: [], times: [] });
  assert.equal(data.clarify, null, "only a clarify decision offers options");
  assert.deepEqual(data.examples.length, 3);
  assert.equal(data.calls, 2);
  assert.deepEqual(data.history.map((entry) => [entry.call, entry.text, entry.tool, entry.decision]),
    [[1, "pay packright's invoice", "pay_vendor", "clarify"], [2, "refund maya's order, the bag arrived torn open", "refund_order", "confirm"]]);
  assert.equal(data.history[0].meta.cost_usd, 0.00038);
  assert.equal(data.world.orders["A-1041"].customer, "maya_chen");
  assert.equal(data.live, true);
  const empty = sampleDispatchPlanCtx({ last: null }).data;
  assert.deepEqual([empty.text, empty.stale, empty.plan, empty.meta, empty.trace, empty.request, empty.candidates, empty.clarify, empty.calls, empty.history, empty.override, empty.replan_ms],
    [null, false, null, null, null, null, null, null, 0, [], null, null]);
  const long = Array.from({ length: 60 }, (_, index) => ({ call: index + 1, at: index, text: `c${index}`, res: fixtureLast().res }));
  assert.equal(sampleDispatchPlanCtx({ history: long }).data.history.length, 50);
  assert.equal(sampleDispatchPlanCtx({ history: long }).data.history[0].call, 11);
});

test("clarify options are exactly the chips the page offers", () => {
  assert.deepEqual(sampleDispatchPlanCtx({ last: fixtureClarifyLast() }).data.clarify, { tools: [
    { value: "create_task", label: "Create a task", prob: 0.41 }, { value: "send_info", label: "Send standard info", prob: 0.15 },
    { value: "reschedule_meeting", label: "Reschedule a meeting", prob: 0.1 }], args: [] }, "none is skipped and three at most are offered");
  assert.deepEqual(sampleDispatchPlanCtx({ last: fixtureMissingLast() }).data.clarify, { tools: [], args: [{ name: "customer", options: [
    { value: "luis_ortega", label: "Luis Ortega", prob: 0.2 }, { value: "maya_chen", label: "Maya Chen", prob: 0.1 }, { value: "priya_nair", label: "Priya Nair", prob: 0.05 }] }] });
});

test("dispatchValueLabel labels values like the page and never throws on unknown ones", () => {
  const world = fixtureWorld();
  assert.equal(dispatchValueLabel("order", "A-1041", world), "A-1041 · Maya Chen");
  assert.equal(dispatchValueLabel("order", "A-1046", world), "A-1046", "unknown customer");
  assert.equal(dispatchValueLabel("meeting", "team_sync", world), "Weekly team sync");
  assert.equal(dispatchValueLabel("vendor", "nobody", world), "nobody");
  assert.equal(dispatchValueLabel("day", "friday", null), "Friday");
  assert.equal(dispatchValueLabel("reason", "wrong_item", world), "wrong item");
  assert.equal(dispatchValueLabel("order", null, world), "—");
});

test("itemName gives ids, #n for activity, and a position as the fallback", () => {
  assert.equal(sampleDispatchOrdersCtx().itemName(sampleDispatchOrdersCtx().items()[0], 0), "A-1041");
  const activity = sampleDispatchActivityCtx();
  assert.equal(activity.itemName(activity.items()[0], 0), "#7");
  assert.equal(activity.itemName({}, 3), "4");
  const plan = sampleDispatchPlanCtx();
  assert.equal(plan.itemName(plan.items()[2], 2), "refund.reason");
  assert.equal(plan.itemName(null, 1), "2");
});

test("no surface lets a pack replace or import items", () => {
  for (const sample of ALL) {
    const { actions } = sample();
    assert.equal(actions.replaceItems, undefined);
    assert.equal(actions.importItems, undefined);
  }
});

test("shared actions draft, focus and reset only within their guards", () => {
  const ctx = sampleDispatchInvoicesCtx();
  assert.equal(ctx.actions.draftCommand("pay packright $860"), "pay packright $860");
  assert.equal(ctx.state.draft, "pay packright $860");
  assert.throws(() => ctx.actions.draftCommand("   "), /no command/);
  assert.throws(() => ctx.actions.draftCommand(42), /no command/);
  assert.throws(() => ctx.actions.draftCommand("x".repeat(1001)), /at most 1,000 characters/);
  ctx.actions.draftCommand("😀".repeat(1000));
  ctx.state.executing = true;
  assert.throws(() => ctx.actions.draftCommand("pay bean brokers"), /running action/);
  assert.throws(() => ctx.actions.resetWorld(), /before resetting/);
  ctx.state.executing = false;
  ctx.state.busy = true;
  assert.throws(() => ctx.actions.resetWorld(), /before resetting/);
  ctx.state.busy = false;
  ctx.actions.resetWorld();
  ctx.actions.focusCommand();
  assert.deepEqual(ctx.recorded, [["draftCommand", "pay packright $860"], ["draftCommand", "😀".repeat(1000)], ["resetWorld"], ["focusCommand"]]);
  const bare = dispatchOrdersCtx({ world: fixtureWorld });
  assert.throws(() => bare.actions.draftCommand("refund A-1041"), /cannot do that here/);
  assert.throws(() => bare.actions.resetWorld(), /cannot do that here/);
  bare.refresh();  // no refresh callback: nothing happens
});

test("plan actions inspect and pick only within their guards, and none asks the model", () => {
  const ctx = sampleDispatchPlanCtx({ draft: " move the team sync to monday " });
  for (const name of ["preview", "useExample", "ask", "run"]) assert.equal(name in ctx.actions, false, `no ${name} action: it would ask the model`);
  ctx.actions.inspect();
  assert.throws(() => ctx.actions.pickTool("create_task"), /not one of the options/, "nothing is offered for a confirm decision");
  assert.deepEqual(ctx.recorded, [["inspect"]]);
  assert.throws(() => sampleDispatchPlanCtx({ last: null }).actions.inspect(), /Run a command first/);

  const clarify = sampleDispatchPlanCtx({ last: fixtureClarifyLast() });
  assert.throws(() => clarify.actions.pickTool("none"), /not one of the options/);
  assert.throws(() => clarify.actions.pickTool("pay_vendor"), /not one of the options/, "only the top three are offered");
  clarify.actions.pickTool("send_info");
  clarify.state.busy = true;
  assert.throws(() => clarify.actions.pickTool("send_info"), /Wait/);
  const missing = sampleDispatchPlanCtx({ last: fixtureMissingLast() });
  assert.throws(() => missing.actions.pickArg("customer", "not_identified"), /not one of the options/);
  assert.throws(() => missing.actions.pickArg("order", "A-1041"), /not one of the options/);
  missing.actions.pickArg("customer", "maya_chen");
  assert.deepEqual([...clarify.recorded, ...missing.recorded], [["pickTool", "send_info"], ["pickArg", "customer", "maya_chen"]]);
});

test("runPlan goes to the page's execute only for an unchanged, unrun execute or confirmed plan", () => {
  const confirm = sampleDispatchPlanCtx();
  assert.throws(() => confirm.actions.runPlan(), /needs your confirmation/);
  assert.throws(() => confirm.actions.runPlan({ confirm: "yes" }), /needs your confirmation/);
  confirm.state.draft = "refund tom's order";
  assert.throws(() => confirm.actions.runPlan({ confirm: true }), /no longer holds/);
  confirm.state.draft = confirm.state.last.text;
  confirm.state.busy = true;
  assert.throws(() => confirm.actions.runPlan({ confirm: true }), /Wait/);
  confirm.state.busy = false;
  confirm.state.executing = true;
  assert.throws(() => confirm.actions.runPlan({ confirm: true }), /Wait/);
  confirm.state.executing = false;
  confirm.actions.runPlan({ confirm: true });
  assert.equal(confirm.recorded.length, 1);
  assert.equal(confirm.recorded[0][0], "runPlan");
  assert.equal(confirm.recorded[0][1], confirm.state.last.plan, "the page's own plan object, not a copy a pack could edit");
  confirm.state.last.done = true;
  assert.throws(() => confirm.actions.runPlan({ confirm: true }), /already run/);

  const last = fixtureLast();
  last.plan = { ...last.plan, decision: "execute" };
  const execute = sampleDispatchPlanCtx({ last });
  execute.actions.runPlan();
  assert.equal(execute.recorded.length, 1);
  for (const decision of ["clarify", "reject", "none", undefined]) {
    const other = fixtureLast();
    other.plan = { ...other.plan, decision };
    assert.throws(() => sampleDispatchPlanCtx({ last: other }).actions.runPlan({ confirm: true }), /nothing to run/);
  }
  assert.throws(() => sampleDispatchPlanCtx({ last: null }).actions.runPlan({ confirm: true }), /no plan/);
});

// ---------- the page's hook code, rebuilt from static/js/dispatch.js ----------

const pageSource = readFileSync(new URL("../../../static/js/dispatch.js", import.meta.url), "utf8");
const fn = (name) => {
  const match = pageSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `static/js/dispatch.js has no function ${name}`);
  return match[0];
};
const block = (start, end) => {
  const from = pageSource.indexOf(start), to = pageSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `static/js/dispatch.js has no block ${start}`);
  return pageSource.slice(from, to);
};

const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) });

// The fixture world without A-1046: the page's own order row reads the customer's name, as it always has, so a world
// the server can produce never holds an order of an unknown customer.
function pageWorld() {
  const world = fixtureWorld();
  delete world.orders["A-1046"];
  return world;
}

function loadPage({ world = pageWorld(), last = null } = {}) {
  const S = { world, last, seq: 0, shown: 0, busy: false, inflight: 0, executing: false, calls: 0, history: [], examples: ["refund maya's order, the bag arrived torn open"] };
  const dom = {};
  const input = { value: last ? last.text : "", focused: 0, focus() { this.focused++; } };
  const live = { checked: true };
  const replaced = [];
  const calls = [];
  const $ = (selector) => {
    if (selector === "#cmd") return input;
    if (selector === "#live") return live;
    if (selector.startsWith("[data-lab-surface")) return { replaceWith: (node) => replaced.push([selector, node]) };
    return dom[selector] || null;
  };
  const mount = (target, ...children) => { dom[target] = { tag: "mounted", attrs: {}, children: children.flat(Infinity).filter(Boolean) }; return dom[target]; };
  const LAB = createLab([orderPack, invoicePack, weekPack, activityPack, planPack]);
  const env = fakeEnv();
  const stubs = {
    S, LAB, $, h, mount, labEnv: env,
    money: (value) => `$${value}`, pct: (value) => `${Math.round(value * 100)}%`,
    statusBadge: (kind, label) => h("span", { class: `badge ${kind}` }, label), icon: (name) => h("i", { "data-icon": name }),
    api: async (path, body) => { calls.push(["api", path, body]); return { plan: fixtureLast().plan, ...fixtureLast().res }; },
    handleError: (error) => calls.push(["handleError", error.message]), renderRead: () => calls.push(["renderRead"]),
    maybeExecute: async () => calls.push(["maybeExecute"]), resetWorld: () => calls.push(["resetWorld"]),
    useExample: (text) => calls.push(["useExample", text]), inspect: (trace, title) => calls.push(["inspect", title]),
    replan: (override) => calls.push(["replan", override]), execute: (plan) => calls.push(["execute", plan]),
    dispatchActivityCtx, dispatchCalendarCtx, dispatchInvoicesCtx, dispatchOrdersCtx, dispatchPlanCtx,
  };
  const ask = fn("ask");
  const body = [block("const TOOL_PREFIX", "const MISSING_VALUES"), "const HISTORY_LIMIT = 50;", block("const ORDERS = ", "async function boot"),
    ask, fn("fanoutCard"), fn("renderFanout"), fn("labEmpty"), fn("labNote"), fn("resetLab"), block("const labSectionOf", "\n// ---------- world"),
    fn("renderWorld"), fn("renderCalendar"), fn("renderOrders"), fn("renderInvoices"), fn("renderActivity"),
    "return { LAB_SOURCE, LAB_CTX, LAB_LISTS, ask, renderFanout, renderWorld, renderCalendar, renderOrders, renderInvoices, renderActivity, resetLab };"].join("\n");
  const names = Object.keys(stubs);
  // The rebuilt functions see the stubs by name, as the module sees its imports.
  const page = new Function(...names, body)(...names.map((name) => stubs[name]));
  return { ...page, S, LAB, dom, input, live, replaced, calls, env };
}

const rowsText = (node) => findAll(node, (n) => n.tag === "tr").map(textOf);

test("the world lists render the page's rows in world order when no Lab setting is active", () => {
  const page = loadPage();
  page.renderWorld();
  assert.deepEqual(rowsText(page.dom["#orders-list"]), ["A-1041Maya Chen2 x Ethiopia Yirgacheffe, 12 oz bagsdelivered$38", "A-1042Luis OrtegaConical burr grinderRefunded$249",
    "A-1043Priya NairEspresso sampler boxin transit$54", "A-1044Tom BeckerCold brew starter kitdelivered$64", "A-1045Northside Bistro20 lb House Blend (wholesale)processing$310"]);
  assert.deepEqual(rowsText(page.dom["#invoices-list"]), ["Bean Brokers LtdINV-7781Open$4250", "Bean Brokers LtdINV-7790Paid$1200", "PackRight PackagingPR-2210Open$860",
    "PackRight PackagingPR-2214Open$95.5", "Sparkle Facility ServicesSF-0930Open$420", "Sparkle Facility ServicesSF-0931Open$undefined", "Roastworks MachineryRW-5001Open$21500"]);
  const days = findAll(page.dom["#calendar-list"], (n) => n.attrs.class === "day").map((day) => findAll(day, (n) => n.attrs.class === "evt").map(textOf));
  assert.deepEqual(days, [["18:30Late pallet pickup"], ["10:00Supplier call with Bean Brokers"], [], ["14:00Wholesale tasting with Northside Bistro", "TBDInventory count"],
    ["11:00Weekly team sync", "11:00Quarterly review with the accountant"]], "the saturday meeting is never drawn");
  const entries = findAll(page.dom["#activity-list"], (n) => /^a( flash)?$/.test(n.attrs.class || ""));
  assert.equal(entries.length, 7);
  assert.equal(textOf(entries[0]), "Paid $500.00 to Coastline Freight (no invoice)");
  for (const id of ["#orders-note", "#invoices-note", "#calendar-note", "#activity-note"]) assert.deepEqual(page.dom[id].children, [], `${id} is empty with no Lab setting`);
  // Each Lab section sits after its list, inside the same block.
  const world_ = page.dom["#world"];
  const ordersBlock = world_.children.find((child) => textOf(child).startsWith("Orders"));
  assert.deepEqual(ordersBlock.children.map((child) => child.attrs.id || child.attrs["data-lab-surface"] || child.tag), ["h3", "orders-note", "orders-list", "dispatch.orders"]);
});

test("a Lab filter and sort reach each world list, with a count note and a reset that restores page order", () => {
  const page = loadPage();
  page.renderWorld();
  page.LAB.view("dispatch.orders").filters = [{ key: "dispatch-order-desk/refunded", op: "without" }];
  page.LAB.view("dispatch.orders").sort = { key: "dispatch-order-desk/total", dir: "desc" };
  page.LAB_SOURCE.refresh("dispatch.orders");
  assert.deepEqual(rowsText(page.dom["#orders-list"]).map((row) => row.slice(0, 6)), ["A-1045", "A-1044", "A-1043", "A-1041"]);
  assert.equal(textOf(page.dom["#orders-note"]), "4 of 5 orders shown · 2 Lab settings activeClear Lab filters and sort");
  const reset = find(page.dom["#orders-note"], (n) => n.tag === "button");
  reset.attrs.onclick();
  assert.equal(page.LAB.active("dispatch.orders"), 0);
  assert.deepEqual(rowsText(page.dom["#orders-list"]).map((row) => row.slice(0, 6)), ["A-1041", "A-1042", "A-1043", "A-1044", "A-1045"]);
  assert.deepEqual(page.dom["#orders-note"].children, []);
  assert.equal(page.replaced[0][0], '[data-lab-surface="dispatch.orders"]', "the Lab section is rebuilt so its chips clear too");

  page.LAB.view("dispatch.invoices").filters = [{ key: "dispatch-invoice-desk/paid", op: "with" }];
  page.renderInvoices();
  assert.deepEqual(rowsText(page.dom["#invoices-list"]), ["Bean Brokers LtdINV-7790Paid$1200"], "position maps back to the page's own invoice row");
  page.LAB.view("dispatch.invoices").filters = [{ key: "dispatch-invoice-desk/amount", op: "min", value: "999999" }];
  page.renderInvoices();
  assert.equal(textOf(page.dom["#invoices-list"]), "No invoice matches the Lab filters.");

  page.LAB.view("dispatch.calendar").filters = [{ key: "dispatch-week-planner/moved", op: "with" }];
  page.renderCalendar();
  assert.deepEqual(findAll(page.dom["#calendar-list"], (n) => n.attrs.class === "evt").map(textOf), ["11:00Weekly team sync"]);
  assert.equal(textOf(page.dom["#calendar-note"]), "1 of 6 meetings shown · 1 Lab setting activeClear Lab filters and sort", "the total counts what the calendar can show");
});

test("activity flashes only the newest entry, and only when it is shown", () => {
  const page = loadPage();
  page.renderWorld("payment");
  const flashing = () => findAll(page.dom["#activity-list"], (n) => n.attrs.class === "a flash").map(textOf);
  assert.deepEqual(flashing(), ["Paid $500.00 to Coastline Freight (no invoice)"]);
  page.LAB.view("dispatch.activity").sort = { key: "dispatch-activity-log/number", dir: "asc" };
  page.renderActivity("payment");
  assert.deepEqual(flashing(), ["Paid $500.00 to Coastline Freight (no invoice)"], "the newest entry flashes wherever a sort puts it");
  page.LAB.view("dispatch.activity").filters = [{ key: "dispatch-activity-log/kind", op: "is", value: "refund" }];
  page.renderActivity("refund");
  assert.deepEqual(flashing(), []);
  page.LAB.view("dispatch.activity").filters = [{ key: "dispatch-activity-log/kind", op: "is", value: "nothing" }];
  page.renderActivity();
  assert.equal(textOf(page.dom["#activity-list"]), "No activity matches the Lab filters.");
  const fresh = loadPage({ world: { ...pageWorld(), activity: [] } });
  fresh.renderWorld();
  assert.equal(textOf(fresh.dom["#activity-list"]), "Nothing has run yet.");
});

test("the answer grid shows the shown plan rows with the page's own cards", () => {
  const page = loadPage({ last: fixtureLast() });
  page.dom["#fanout"] = {};
  page.renderFanout();
  const cards = page.dom["#fanout"].children;
  assert.equal(cards.length, 14);
  assert.deepEqual(cards.slice(0, 3).map((card) => [card.attrs.class, textOf(card)]),
    [["fq used", "toolrefund order86%"], ["fq used", "refund.orderA-104191%"], ["fq used", "refund.reasondamaged48%"]]);
  assert.deepEqual([cards[9].attrs.class, textOf(cards[9])], ["fq unused", "task.priorityscore 1.6267%"]);
  assert.deepEqual(page.dom["#fanout-note"].children, []);
  page.LAB.view("dispatch.plan").filters = [{ key: "dispatch-plan-review/used", op: "with" }];
  page.LAB.view("dispatch.plan").sort = { key: "dispatch-plan-review/p", dir: "asc" };
  page.renderFanout();
  assert.deepEqual(page.dom["#fanout"].children.map((card) => card.children[0].children[0]), ["refund.reason", "tool", "refund.order"]);
  assert.equal(textOf(page.dom["#fanout-note"]), "3 of 14 answers shown · 2 Lab settings activeClear Lab filters and sort");
  page.LAB.view("dispatch.plan").filters = [{ key: "dispatch-plan-review/p", op: "min", value: "2" }];
  page.renderFanout();
  assert.equal(textOf(page.dom["#fanout"]), "No answer matches the Lab filters.");
});

test("the page's ctx source routes every action to the page's own functions", async () => {
  const page = loadPage({ last: fixtureLast() });
  const plan = page.LAB_CTX["dispatch.plan"];
  assert.equal(plan.env, page.env, "commands from the palette get the page env");
  plan.actions.draftCommand("pay packright $860");
  assert.deepEqual([page.input.value, page.input.focused], ["pay packright $860", 1]);
  page.input.value = page.S.last.text;
  plan.actions.runPlan({ confirm: true });
  plan.actions.inspect();
  plan.actions.resetWorld();
  assert.equal("useExample" in plan.actions, false, "no action presses an example chip (a model call)");
  assert.equal("preview" in page.LAB_SOURCE || "useExample" in page.LAB_SOURCE, false, "the page passes no model-calling callback");
  assert.deepEqual(page.calls.map(([name]) => name), ["execute", "inspect", "resetWorld"]);
  assert.equal(page.calls[0][1], page.S.last.plan);
  page.S.last = fixtureMissingLast();
  page.input.value = page.S.last.text;
  plan.actions.pickArg("customer", "priya_nair");
  assert.deepEqual(page.calls.at(-1), ["replan", { args: { customer: "priya_nair" } }]);
  page.S.last = fixtureClarifyLast();
  plan.actions.pickTool("send_info");
  assert.deepEqual(page.calls.at(-1), ["replan", { tool: "send_info" }]);
  page.S.inflight = 1;
  assert.equal(plan.data.busy, true);
  assert.throws(() => plan.actions.resetWorld(), /before resetting/);
  page.S.inflight = 0;
  page.live.checked = false;
  assert.equal(plan.data.live, false);
  page.S.world = pageWorld();
  page.dom["#orders-list"] = null;
  page.LAB_CTX["dispatch.orders"].refresh();
  assert.ok(page.dom["#orders-list"], "refresh re-renders that list");
});

test("each answered command is counted once in the session history, and in-flight requests are tracked", async () => {
  const page = loadPage();
  const pending = page.ask("refund maya's order, the bag arrived torn open", false);
  assert.equal(page.S.inflight, 1);
  assert.equal(page.LAB_CTX["dispatch.plan"].data.busy, true);
  await pending;
  assert.equal(page.S.inflight, 0);
  assert.equal(page.S.calls, 1);
  assert.deepEqual(page.calls[0], ["api", "/api/dispatch", { text: "refund maya's order, the bag arrived torn open", execute: false }], "asking never executes");
  assert.equal(page.LAB_CTX["dispatch.plan"].data.history.length, 1);
  assert.equal(page.LAB_CTX["dispatch.plan"].items().length, 14);
  for (let index = 0; index < 55; index++) await page.ask(`command ${index}`, false);
  assert.equal(page.S.history.length, 50);
  assert.equal(page.S.calls, 56);
  assert.equal(page.LAB_CTX["dispatch.plan"].data.history[0].call, 7);
});
