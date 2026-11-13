import {
  $, api, barRow, callStats, debounce, h, handleError, icon, initChrome, inspect, money, mount, ms, pct,
  statusBadge, toast,
} from "./common.js";
import { installLab, labEnv } from "./lab/env.js";
import { LAB } from "./lab/pages/dispatch.js";
import { dispatchActivityCtx, dispatchCalendarCtx, dispatchInvoicesCtx, dispatchOrdersCtx, dispatchPlanCtx } from "./lab/surfaces/dispatch.js";

// inflight/executing: requests on their way; calls/history: this page load's answered commands, in memory only.
const S = { world: null, last: null, seq: 0, shown: 0, busy: false, inflight: 0, executing: false, calls: 0, history: [], examples: [] };
const HISTORY_LIMIT = 50;

const TOOL_PREFIX = {
  refund_order: "refund.", reschedule_meeting: "reschedule.", pay_vendor: "pay.", create_task: "task.", send_info: "info.",
};
const MISSING_VALUES = new Set(["not_identified", "not_stated"]);

// Lab surfaces of this page (contract: static/js/lab/surfaces/dispatch.js). One ctx per surface for the page session;
// each reads S at call time. Packs act only through these callbacks: running an action still goes through execute(),
// the server's approved-plan path, and nothing here edits the world directly.
const ORDERS = "dispatch.orders", INVOICES = "dispatch.invoices", CALENDAR = "dispatch.calendar", ACTIVITY = "dispatch.activity", PLAN = "dispatch.plan";
const LAB_SOURCE = {
  world: () => S.world, last: () => S.last, history: () => S.history, calls: () => S.calls,
  draft: () => $("#cmd")?.value ?? "", live: () => !!$("#live")?.checked,
  busy: () => S.inflight > 0, executing: () => S.executing, examples: () => S.examples,
  matches: (id, item, ctx) => LAB.matches(id, item, ctx), arrange: (id, items, ctx) => LAB.arrange(id, items, ctx),
  refresh: (id) => LAB_LISTS[id]?.(),
  draftCommand: (text) => { const input = $("#cmd"); input.value = text; input.focus(); },
  focusCommand: () => $("#cmd").focus(),
  resetWorld: () => resetWorld(),
  inspect: () => inspect(S.last.res.trace, "Dispatch · one Jev request"),
  pickTool: (tool) => replan({ tool }),
  pickArg: (name, value) => replan({ args: { [name]: value } }),
  runPlan: (plan) => execute(plan),
};
const LAB_CTX = {
  [ORDERS]: dispatchOrdersCtx(LAB_SOURCE), [INVOICES]: dispatchInvoicesCtx(LAB_SOURCE), [CALENDAR]: dispatchCalendarCtx(LAB_SOURCE),
  [ACTIVITY]: dispatchActivityCtx(LAB_SOURCE), [PLAN]: dispatchPlanCtx(LAB_SOURCE),
};
for (const ctx of Object.values(LAB_CTX)) ctx.env = labEnv;
// Re-render one surface's list after a Lab filter or sort changes (the Lab section itself is left in place).
const LAB_LISTS = {
  [ORDERS]: () => renderOrders(), [INVOICES]: () => renderInvoices(), [CALENDAR]: () => renderCalendar(),
  [ACTIVITY]: () => renderActivity(), [PLAN]: () => renderFanout(),
};

async function boot() {
  await initChrome("/dispatch");
  installLab(LAB);
  LAB.mount(PLAN, LAB_CTX[PLAN]);  // its commands reach the palette before the first command is answered
  mount("#cmd-icon", icon("bolt"));
  mount("#reset-icon", icon("reset"));
  const [{ commands }, world] = await Promise.all([api("/api/scenarios"), api("/api/dispatch/world")]);
  S.world = world;
  S.examples = commands;
  renderWorld();
  mount("#examples", commands.map((c) => h("button", { class: "chip", onclick: () => useExample(c) }, c)));

  const input = $("#cmd");
  input.addEventListener("input", () => { if ($("#live").checked && input.value.trim().length > 3) preview(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  $("#reset").addEventListener("click", resetWorld);
  input.focus();
}

async function resetWorld() {
  S.world = await api("/api/dispatch/reset", {});
  renderWorld();
  toast("World reset");
}

function useExample(text) {
  const input = $("#cmd");
  input.value = text;
  input.focus();
  ask(text, false);
}

const preview = debounce(() => ask($("#cmd").value.trim(), false), 380);

async function ask(text, execute) {
  if (!text) return null;
  const seq = ++S.seq;
  S.inflight += 1;
  mount("#cmd-status", h("span", { class: "spin" }));
  try {
    const res = await api("/api/dispatch", { text, execute: false });
    if (seq < S.shown) return null; // a newer response is already on screen
    S.shown = seq;
    S.last = { text, res, plan: res.plan, override: null };
    S.calls += 1;
    S.history.push({ call: S.calls, at: Date.now(), text, res });
    if (S.history.length > HISTORY_LIMIT) S.history.shift();
    renderRead();
    if (execute) await maybeExecute();
    return res;
  } catch (e) {
    handleError(e);
    return null;
  } finally {
    S.inflight -= 1;
    if (seq === S.seq) mount("#cmd-status");
  }
}

async function run() {
  const text = $("#cmd").value.trim();
  if (!text) return;
  if (S.last && S.last.text === text) await maybeExecute();
  else await ask(text, true);
}

async function maybeExecute() {
  const plan = S.last?.plan;
  if (!plan) return;
  if (plan.decision === "execute") await execute(plan);
  else if (plan.decision === "confirm") toast("This one needs your confirmation. See the reasons below.");
  else if (plan.decision === "clarify") toast("Jev isn't sure. Pick an option below; no new Jev call needed.");
}

async function execute(plan) {
  S.executing = true;
  try {
    const { executed, world } = await api("/api/dispatch/execute", { tool: plan.tool, exec_args: plan.exec_args });
    S.world = world;
    renderWorld(executed.kind);
    toast(`✓ ${executed.text}`);
    S.last.done = true;
    renderRead();
  } catch (e) { handleError(e); } finally { S.executing = false; }
}

async function replan(override) {
  const merged = {
    tool: override.tool ?? S.last.override?.tool,
    args: { ...(S.last.override?.args || {}), ...(override.args || {}) },
  };
  if (override.tool) merged.args = {};
  const started = performance.now();
  try {
    const { plan } = await api("/api/dispatch/replan", { text: S.last.text, answers: S.last.res.answers, override: merged });
    S.last.plan = plan;
    S.last.override = merged;
    S.last.replanMs = performance.now() - started;
    renderRead();
  } catch (e) { handleError(e); }
}

// ---------- labels ----------
function valueLabel(name, value) {
  const w = S.world;
  if (value === null || value === undefined) return "—";
  switch (name) {
    case "order": return w.orders[value] ? `${value} · ${w.customers[w.orders[value].customer].name}` : value;
    case "meeting": return w.meetings[value]?.title || value;
    case "vendor": return w.vendors[value]?.name || value;
    case "customer": return w.customers[value]?.name || value;
    case "day": return value.replace(/^\w/, (c) => c.toUpperCase());
    default: return String(value).replace(/_/g, " ");
  }
}

function renderCall(plan) {
  if (plan.tool === "none") return h("div", { class: "code-call" }, h("span", { class: "dim" }, "# no action"), " ", h("span", { class: "fn" }, "no_action"), "()");
  const parts = [];
  Object.entries(plan.exec_args).forEach(([k, v]) => {
    if (k === "text" || v === null || v === undefined) return;
    if (parts.length) parts.push(h("span", { class: "dim" }, ", "));
    const unknown = MISSING_VALUES.has(v);
    parts.push(h("span", { class: "k" }, `${k}=`),
      unknown ? h("span", { class: "missing", title: "Jev couldn't identify this argument" }, "?")
        : h("span", { class: "val" }, typeof v === "number" ? v.toFixed(2) : `"${v}"`));
  });
  return h("div", { class: "code-call" }, h("span", { class: "fn" }, plan.tool), "(", parts, ")");
}

function renderRead() {
  const { res, plan, text } = S.last;
  const meta = plan.tool_meta[plan.tool] || { label: plan.tool, risk: "none", threshold: 0 };
  const argChips = Object.entries(plan.args).map(([name, a]) => {
    const shown = a.resolved !== undefined && a.resolved !== null ? money(a.resolved) : valueLabel(name, a.value);
    return h("span", { class: `arg${a.picked_by_user ? " user" : a.prob < meta.threshold && !a.ungated ? " weak" : ""}`, title: a.picked_by_user ? "picked by you" : "" },
      h("span", { class: "n" }, name), shown, h("span", { class: "p" }, a.ungated ? `score ${a.score.toFixed(2)}` : a.picked_by_user ? "you" : pct(a.prob)));
  });

  const actions = [];
  if (S.last.done) actions.push(statusBadge("handled", "Executed"));
  else if (plan.decision === "execute") actions.push(h("button", { class: "btn primary", onclick: () => execute(plan) }, icon("bolt"), "Run now"), h("span", { class: "faint" }, "or press ⏎"));
  else if (plan.decision === "confirm") actions.push(h("button", { class: "btn primary", onclick: () => execute(plan) }, icon("check"), "Confirm & run"));

  const clarify = [];
  if (plan.decision === "clarify") {
    if (plan.tool_prob < 0.5) {
      clarify.push(h("div", { class: "section-label" }, "Which did you mean?"),
        h("div", { class: "chips" }, plan.tool_ranking.filter((t) => t.value !== "none").slice(0, 3).map((t) =>
          h("button", { class: "chip", onclick: () => replan({ tool: t.value }) }, `${plan.tool_meta[t.value].label} · ${pct(t.prob)}`))));
    }
    for (const name of plan.missing) {
      const options = (plan.args[name]?.options || []).filter((o) => !MISSING_VALUES.has(o.value) && o.value !== "open_invoice");
      clarify.push(h("div", { class: "section-label", style: { marginTop: "6px" } }, `Which ${name}?`),
        options.length
          ? h("div", { class: "chips" }, options.slice(0, 3).map((o) =>
            h("button", { class: "chip", onclick: () => replan({ args: { [name]: o.value } }) }, `${valueLabel(name, o.value)} · ${pct(o.prob)}`)))
          : h("p", { class: "muted" }, `Add the ${name} to your command.`));
    }
  }

  const answerCount = Object.keys(res.answers).length;
  const labSection = LAB.section(labEnv, PLAN, LAB_CTX[PLAN]);

  mount("#read",
    h("div", { class: "panel-head" }, icon("code"), h("h2", {}, "Jev's read"), h("div", { class: "spacer" }),
      callStats(res.meta, () => inspect(res.trace, "Dispatch · one Jev request"))),
    h("div", { class: "panel-body grid", style: { gap: "18px" } },
      h("div", {},
        h("div", { class: "section-label" }, `“${text}” becomes`),
        renderCall(plan),
        h("div", { class: "args" }, argChips),
        S.last.override ? h("p", { class: "faint", style: { fontSize: "12px", marginTop: "8px" } },
          `Re-planned from the answers Jev already gave, in ${ms(S.last.replanMs || 0)} with 0 new Jev calls.`) : null),
      h("div", { class: "decision" },
        h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
          statusBadge(plan.decision, null, "lg"),
          h("span", { class: "muted" }, `${meta.label} · ${meta.risk} risk · needs ≥ ${pct(meta.threshold)} · call confidence ${pct(plan.confidence)}`),
          h("div", { style: { flex: 1 } }), actions),
        h("ul", {}, plan.reasons.map((r) => h("li", {}, r))),
        clarify.length ? h("div", {}, clarify) : null,
        plan.checks.length ? h("div", { class: "checks" }, h("div", { class: "section-label", style: { margin: "4px 0 2px" } }, "Policy checks · plain code"),
          plan.checks.map((c) => h("div", { class: "check" },
            h("span", { class: c.ok ? "ok" : c.level === "block" ? "blk" : "no" }, icon(c.ok ? "check" : c.level === "block" ? "stop" : "hand")),
            h("b", {}, c.label), h("span", { class: "muted" }, c.detail)))) : null),
      h("div", {},
        h("div", { class: "section-label" }, "Which function? · one Choice across 6 options"),
        h("div", { class: "bars" }, plan.tool_ranking.map((t, i) => barRow(plan.tool_meta[t.value]?.label || t.value, t.prob, { top: i === 0 })))),
      h("div", {},
        h("div", { class: "section-label" }, `All ${answerCount} answers from the same call · highlighted = used by code, faded = ignored`),
        h("div", { id: "fanout-note" }),
        h("div", { class: "fanout", id: "fanout" })),
      labSection));
  renderFanout();
}

function fanoutCard(qid, ans, prefix) {
  const used = qid === "tool" || (prefix && qid.startsWith(prefix));
  let value, p;
  if (ans.type === "choice") { value = ans.choice; p = pct(ans.probabilities[ans.choice]); }
  else if (ans.type === "score") { value = `score ${ans.score.toFixed(2)}`; p = pct(ans.confidence); }
  else { value = ans.noul >= 0.5 ? "yes" : "no"; p = pct(ans.noul); }
  return h("div", { class: `fq ${used ? "used" : "unused"}` }, h("div", { class: "id" }, qid),
    h("div", { class: "v" }, h("span", {}, String(value).replace(/_/g, " ")), h("span", {}, p)));
}

// The answer cards of the shown call: every answer in response order, unless Lab filters hide some or a Lab sort
// reorders them.
function renderFanout() {
  if (!S.last || !$("#fanout")) return;
  const { res, plan } = S.last;
  const ctx = LAB_CTX[PLAN];
  const prefix = TOOL_PREFIX[plan.tool];
  const total = ctx.items().length, shown = ctx.shown();
  mount("#fanout", total && !shown.length ? labEmpty("No answer matches the Lab filters.", { gridColumn: "1 / -1" })
    : shown.map((item) => fanoutCard(item.id, res.answers[item.id], prefix)));
  mount("#fanout-note", labNote(PLAN, shown.length, total, "answers"));
}

// ---------- Lab ----------
function labEmpty(text, style = {}) {
  return h("div", { class: "faint", role: "status", style: { fontSize: "12.5px", ...style } }, text);
}

// "x of y shown" with a reset, only while a Lab filter or sort is active on that surface.
function labNote(id, shown, total, noun) {
  const active = LAB.active(id);
  if (!active) return null;
  return h("div", { class: "faint", role: "status", style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", fontSize: "12px", margin: "0 0 8px" } },
    `${shown} of ${total} ${noun} shown · ${active} Lab setting${active === 1 ? "" : "s"} active`,
    h("button", { class: "btn sm ghost", onclick: () => resetLab(id) }, "Clear Lab filters and sort"));
}

function resetLab(id) {
  LAB.reset(id);
  LAB_LISTS[id]();
  const node = $(`[data-lab-surface="${id}"]`);
  const section = LAB.section(labEnv, id, LAB_CTX[id]);
  if (node && section) node.replaceWith(section);
}

const labSectionOf = (id) => LAB.section(labEnv, id, LAB_CTX[id]);

// ---------- world ----------
function renderWorld(flashKind) {
  const w = S.world;
  const flash = (kind) => (flashKind === kind ? " flash" : "");

  mount("#world",
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } },
      h("div", { class: `tile${flash("payment")}${flash("refund")}` }, h("div", { class: "k" }, "Bank balance"), h("div", { class: "v" }, money(w.balance))),
      h("div", { class: `tile${flash("task")}` }, h("div", { class: "k" }, "Open tasks"), h("div", { class: "v" }, String(w.tasks.length)),
        h("div", { class: "s" }, w.tasks[0] ? `${w.tasks[0].area} · ${w.tasks[0].priority}` : "none yet"))),
    h("div", { class: flash("calendar").trim() },
      h("h3", {}, icon("calendar"), "This week"),
      h("div", { id: "calendar-note" }), h("div", { id: "calendar-list" }), labSectionOf(CALENDAR)),
    h("div", {},
      h("h3", {}, icon("box"), "Orders"),
      h("div", { id: "orders-note" }), h("div", { id: "orders-list" }), labSectionOf(ORDERS)),
    h("div", {},
      h("h3", {}, icon("money"), "Vendor invoices"),
      h("div", { id: "invoices-note" }), h("div", { id: "invoices-list" }), labSectionOf(INVOICES)),
    h("div", {},
      h("h3", {}, icon("list"), "Activity"),
      h("div", { id: "activity-note" }), h("div", { id: "activity-list" }), labSectionOf(ACTIVITY)));
  renderCalendar();
  renderOrders();
  renderInvoices();
  renderActivity(flashKind);
}

// Each world list shows its Lab surface's shown() items: all of them in the world's order unless a Lab filter hides
// some or a Lab sort reorders them. The rows themselves are drawn from the world exactly as before.
function renderCalendar() {
  const w = S.world, ctx = LAB_CTX[CALENDAR];
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const shown = ctx.shown();
  mount("#calendar-list",
    h("div", { class: "cal" }, days.map((d) => h("div", { class: "day" }, h("b", {}, d.slice(0, 3)),
      shown.filter((item) => item.day === d).map((item) => w.meetings[item.id]).map((m) =>
        h("div", { class: "evt", style: m.moved ? { borderLeftColor: "var(--accent)", background: "var(--accent-soft)" } : {} },
          h("div", { class: "t" }, m.time), m.title))))));
  mount("#calendar-note", labNote(CALENDAR, shown.length, ctx.items().filter((item) => item.on_calendar).length, "meetings"));
}

function renderOrders() {
  const w = S.world, ctx = LAB_CTX[ORDERS];
  const total = ctx.items().length, shown = ctx.shown();
  mount("#orders-list", total && !shown.length ? labEmpty("No order matches the Lab filters.")
    : h("table", { class: "table" }, h("tbody", {}, shown.map((item) => [item.id, w.orders[item.id]]).map(([id, o]) => h("tr", {},
      h("td", { class: "mono" }, id),
      h("td", {}, w.customers[o.customer].name, h("div", { class: "faint" }, o.items)),
      h("td", {}, o.refunded ? statusBadge("handled", "Refunded") : h("span", { class: "badge" }, o.status)),
      h("td", { class: "num" }, money(o.total)))))));
  mount("#orders-note", labNote(ORDERS, shown.length, total, "orders"));
}

function renderInvoices() {
  const w = S.world, ctx = LAB_CTX[INVOICES];
  const unpaid = Object.values(w.vendors).flatMap((v) => Object.entries(v.invoices).map(([id, inv]) => ({ vendor: v.name, id, ...inv })));
  const total = ctx.items().length, shown = ctx.shown();
  mount("#invoices-list", total && !shown.length ? labEmpty("No invoice matches the Lab filters.")
    : h("table", { class: "table" }, h("tbody", {}, shown.map((item) => unpaid[item.position - 1]).map((i) => h("tr", {},
      h("td", {}, i.vendor, h("div", { class: "faint mono" }, i.id)),
      h("td", {}, i.paid ? statusBadge("handled", "Paid") : h("span", { class: "badge warning" }, "Open")),
      h("td", { class: "num" }, money(i.amount)))))));
  mount("#invoices-note", labNote(INVOICES, shown.length, total, "invoices"));
}

function renderActivity(flashKind) {
  const w = S.world, ctx = LAB_CTX[ACTIVITY];
  const total = ctx.items().length, shown = ctx.shown();
  mount("#activity-list", w.activity.length
    ? (shown.length ? h("div", { class: "activity" }, shown.map((item) => [item.position - 1, w.activity[item.position - 1]]).map(([i, a]) => h("div", { class: `a${i === 0 && flashKind ? " flash" : ""}` },
      icon({ refund: "money", payment: "money", calendar: "calendar", task: "list", reply: "send" }[a.kind] || "check"), a.text)))
      : labEmpty("No activity matches the Lab filters."))
    : h("div", { class: "faint", style: { fontSize: "12.5px" } }, "Nothing has run yet."));
  mount("#activity-note", labNote(ACTIVITY, shown.length, total, "entries"));
}

boot().catch(handleError);
