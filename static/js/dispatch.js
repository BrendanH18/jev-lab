import {
  $, api, barRow, callStats, debounce, h, handleError, icon, initChrome, inspect, money, mount, ms, pct,
  statusBadge, toast,
} from "./common.js";

const S = { world: null, last: null, seq: 0, shown: 0, busy: false };

const TOOL_PREFIX = {
  refund_order: "refund.", reschedule_meeting: "reschedule.", pay_vendor: "pay.", create_task: "task.", send_info: "info.",
};
const MISSING_VALUES = new Set(["not_identified", "not_stated"]);

async function boot() {
  await initChrome("/dispatch");
  mount("#cmd-icon", icon("bolt"));
  mount("#reset-icon", icon("reset"));
  const [{ commands }, world] = await Promise.all([api("/api/scenarios"), api("/api/dispatch/world")]);
  S.world = world;
  renderWorld();
  mount("#examples", commands.map((c) => h("button", { class: "chip", onclick: () => useExample(c) }, c)));

  const input = $("#cmd");
  input.addEventListener("input", () => { if ($("#live").checked && input.value.trim().length > 3) preview(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  $("#reset").addEventListener("click", async () => {
    S.world = await api("/api/dispatch/reset", {});
    renderWorld();
    toast("World reset");
  });
  input.focus();
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
  mount("#cmd-status", h("span", { class: "spin" }));
  try {
    const res = await api("/api/dispatch", { text, execute: false });
    if (seq < S.shown) return null; // a newer response is already on screen
    S.shown = seq;
    S.last = { text, res, plan: res.plan, override: null };
    renderRead();
    if (execute) await maybeExecute();
    return res;
  } catch (e) {
    handleError(e);
    return null;
  } finally {
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
  try {
    const { executed, world } = await api("/api/dispatch/execute", { tool: plan.tool, exec_args: plan.exec_args });
    S.world = world;
    renderWorld(executed.kind);
    toast(`✓ ${executed.text}`);
    S.last.done = true;
    renderRead();
  } catch (e) { handleError(e); }
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

  const prefix = TOOL_PREFIX[plan.tool];
  const fanout = Object.entries(res.answers).map(([qid, ans]) => {
    const used = qid === "tool" || (prefix && qid.startsWith(prefix));
    let value, p;
    if (ans.type === "choice") { value = ans.choice; p = pct(ans.probabilities[ans.choice]); }
    else if (ans.type === "score") { value = `score ${ans.score.toFixed(2)}`; p = pct(ans.confidence); }
    else { value = ans.noul >= 0.5 ? "yes" : "no"; p = pct(ans.noul); }
    return h("div", { class: `fq ${used ? "used" : "unused"}` }, h("div", { class: "id" }, qid),
      h("div", { class: "v" }, h("span", {}, String(value).replace(/_/g, " ")), h("span", {}, p)));
  });

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
        h("div", { class: "section-label" }, `All ${fanout.length} answers from the same call · highlighted = used by code, faded = ignored`),
        h("div", { class: "fanout" }, fanout))));
}

// ---------- world ----------
function renderWorld(flashKind) {
  const w = S.world;
  const flash = (kind) => (flashKind === kind ? " flash" : "");
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const unpaid = Object.values(w.vendors).flatMap((v) => Object.entries(v.invoices).map(([id, inv]) => ({ vendor: v.name, id, ...inv })));

  mount("#world",
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } },
      h("div", { class: `tile${flash("payment")}${flash("refund")}` }, h("div", { class: "k" }, "Bank balance"), h("div", { class: "v" }, money(w.balance))),
      h("div", { class: `tile${flash("task")}` }, h("div", { class: "k" }, "Open tasks"), h("div", { class: "v" }, String(w.tasks.length)),
        h("div", { class: "s" }, w.tasks[0] ? `${w.tasks[0].area} · ${w.tasks[0].priority}` : "none yet"))),
    h("div", { class: flash("calendar").trim() },
      h("h3", {}, icon("calendar"), "This week"),
      h("div", { class: "cal" }, days.map((d) => h("div", { class: "day" }, h("b", {}, d.slice(0, 3)),
        Object.values(w.meetings).filter((m) => m.day === d).map((m) =>
          h("div", { class: "evt", style: m.moved ? { borderLeftColor: "var(--accent)", background: "var(--accent-soft)" } : {} },
            h("div", { class: "t" }, m.time), m.title)))))),
    h("div", {},
      h("h3", {}, icon("box"), "Orders"),
      h("table", { class: "table" }, h("tbody", {}, Object.entries(w.orders).map(([id, o]) => h("tr", {},
        h("td", { class: "mono" }, id),
        h("td", {}, w.customers[o.customer].name, h("div", { class: "faint" }, o.items)),
        h("td", {}, o.refunded ? statusBadge("handled", "Refunded") : h("span", { class: "badge" }, o.status)),
        h("td", { class: "num" }, money(o.total))))))),
    h("div", {},
      h("h3", {}, icon("money"), "Vendor invoices"),
      h("table", { class: "table" }, h("tbody", {}, unpaid.map((i) => h("tr", {},
        h("td", {}, i.vendor, h("div", { class: "faint mono" }, i.id)),
        h("td", {}, i.paid ? statusBadge("handled", "Paid") : h("span", { class: "badge warning" }, "Open")),
        h("td", { class: "num" }, money(i.amount))))))),
    h("div", {},
      h("h3", {}, icon("list"), "Activity"),
      w.activity.length
        ? h("div", { class: "activity" }, w.activity.map((a, i) => h("div", { class: `a${i === 0 && flashKind ? " flash" : ""}` },
          icon({ refund: "money", payment: "money", calendar: "calendar", task: "list", reply: "send" }[a.kind] || "check"), a.text)))
        : h("div", { class: "faint", style: { fontSize: "12.5px" } }, "Nothing has run yet.")));
}

boot().catch(handleError);
