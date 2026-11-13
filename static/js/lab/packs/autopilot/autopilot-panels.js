// Panels for "autopilot.records" (contract: static/js/lab/surfaces/autopilot.js): an outcome matrix of Autopilot
// against Dispatch alone, which layer stopped each attack, the difference between the two simulated businesses, an
// overview of the decisions waiting for you and a full view of one processed email. Everything shown comes from the
// user's own calls in this server run; anything judged by the scenario labels (never sent to Jev) says so. Approve and
// Dismiss here are the row's own buttons: no Jev call, one action per press.
import { definePack } from "../../kit.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value : "");
const list = (value) => (Array.isArray(value) ? value : []);
const verdictOf = (item) => (isObject(item?.shield?.verdict) ? item.shield.verdict : null);
const senderFactOf = (item) => (isObject(item?.shield?.fact) ? item.shield.fact : null);
const sideOf = (item, world) => (isObject(item?.[world]) ? item[world] : null);
const planOf = (item, world = "integrated") => (isObject(sideOf(item, world)?.plan) ? sideOf(item, world).plan : null);
const checksOf = (item, world = "integrated") => list(planOf(item, world)?.checks).filter(isObject);
const executedOf = (item, world) => (isObject(sideOf(item, world)?.executed) ? sideOf(item, world).executed : null);
const ran = (item, world) => !!executedOf(item, world);
const isAttack = (item) => item?.label?.attack === true;
const isLegit = (item) => isObject(item?.label) && item.label.attack === false;
const nameOf = (item) => `#${Number.isInteger(item?.position) ? item.position : "?"}${str(item?.from_name) ? ` ${item.from_name}` : ""}`;
const pct = (value) => `${Math.round(value * 100)}%`;
const usd = (value) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const fixed = (value, digits) => (num(value) === null ? "—" : value.toFixed(digits));
const SENDER_CHECKS = ["requester_owns_order", "vendor_domain", "sender_attends"];
const WORLDS = [["integrated", "Autopilot"], ["naive", "Dispatch alone"]];

// ---------- outcome matrix ----------

const OUTCOMES = ["handled", "ignored", "needs_you", "approved", "dismissed", "quarantine"];
const OUTCOME_LABEL = { handled: "Handled", ignored: "Ignored", needs_you: "Needs you", approved: "Approved by you", dismissed: "Dismissed", quarantine: "Quarantine" };
const NAIVE_COLUMNS = ["ran it", "execute", "confirm", "clarify", "reject", "none"];
const rowKey = (item) => str(item.outcome) || "unknown";
const columnKey = (item) => (ran(item, "naive") ? "ran it" : str(planOf(item, "naive")?.decision) || "unknown");
const ordered = (values, order) => [...new Set(values)].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
const SCOPES = [["all", "All shown emails"], ["attacks", "Attacks (per the scenario labels)"], ["legitimate", "Legitimate (per the scenario labels)"]];
const inScope = (item, scope) => (scope === "attacks" ? isAttack(item) : scope === "legitimate" ? isLegit(item) : true);

function matrixOf(items) {
  const rows = ordered(items.map(rowKey), OUTCOMES), columns = ordered(items.map(columnKey), NAIVE_COLUMNS);
  const cell = (row, column) => items.filter((item) => rowKey(item) === row && columnKey(item) === column);
  return { rows, columns, cell };
}

function matrixTsv(matrix) {
  const lines = [["autopilot outcome", ...matrix.columns, "total"]];
  for (const row of matrix.rows) {
    const counts = matrix.columns.map((column) => matrix.cell(row, column).length);
    lines.push([row, ...counts, counts.reduce((a, b) => a + b, 0)]);
  }
  const totals = matrix.columns.map((column) => matrix.rows.reduce((total, row) => total + matrix.cell(row, column).length, 0));
  lines.push(["total", ...totals, totals.reduce((a, b) => a + b, 0)]);
  return `${lines.map((line) => line.join("\t")).join("\n")}\n`;
}

// ---------- layer attribution ----------

function stopOf(item) {
  const verdict = verdictOf(item), plan = planOf(item);
  const reasons = list(plan?.reasons).map(str).filter(Boolean);
  if (sideOf(item, "integrated")?.lane === "quarantine") {
    const rule = list(verdict?.rules).find((entry) => entry?.action === "quarantine" && str(entry.text));
    return { layer: "Shield quarantine", evidence: rule ? rule.text : num(verdict?.risk) === null ? "Shield quarantined it" : `risk ${pct(verdict.risk)}` };
  }
  if (verdict?.level === "review") return { layer: "Shield review", evidence: reasons[0] || "Shield asked for review" };
  const failing = checksOf(item).filter((check) => check.ok === false);
  const describe = (check) => `${str(check.label) || str(check.id)}: ${str(check.detail)}`;
  const sender = failing.find((check) => SENDER_CHECKS.includes(check.id));
  if (sender) return { layer: "Sender check", evidence: describe(sender) };
  const photo = failing.find((check) => check.id === "photo_evidence");
  if (photo) return { layer: "Photo check", evidence: describe(photo) };
  return { layer: "Other", evidence: reasons[0] || str(plan?.decision) || "no reason given" };
}

function attributionOf(item) {
  if (ran(item, "integrated")) return { status: "not stopped", layer: "nothing: Autopilot ran it", evidence: str(executedOf(item, "integrated").text), dollars: 0 };
  if (!ran(item, "naive")) return { status: "neither", layer: "neither world acted", evidence: str(planOf(item, "naive")?.decision) || "no decision", dollars: 0 };
  return { status: "stopped", ...stopOf(item), dollars: num(executedOf(item, "naive").amount) ?? 0 };
}

// ---------- the two worlds ----------

const activityOf = (world) => list(world?.activity).filter(isObject);
const activityKey = (entry) => JSON.stringify([str(entry.kind), str(entry.text), num(entry.amount), str(entry.destination) || null]);

// Entries of world a that world b does not hold, counting repeats (a multiset difference), in a's order.
function onlyIn(a, b) {
  const left = new Map();
  for (const entry of activityOf(b)) left.set(activityKey(entry), (left.get(activityKey(entry)) || 0) + 1);
  const out = [];
  for (const entry of activityOf(a)) {
    const key = activityKey(entry), count = left.get(key) || 0;
    if (count > 0) left.set(key, count - 1);
    else out.push(entry);
  }
  return out;
}

const entryText = (entry) => `${str(entry.kind) || "action"}: ${str(entry.text)}${str(entry.destination) ? ` (to the ${entry.destination})` : ""}`;
const keysOf = (a, b) => [...new Set([...Object.keys(isObject(a) ? a : {}), ...Object.keys(isObject(b) ? b : {})])].sort();
const whichWorld = (inA) => (inA ? "Autopilot only" : "Dispatch alone only");

function orderDifferences(worlds) {
  const a = isObject(worlds.integrated.orders) ? worlds.integrated.orders : {}, b = isObject(worlds.naive.orders) ? worlds.naive.orders : {};
  return keysOf(a, b).filter((id) => (a[id]?.refunded === true) !== (b[id]?.refunded === true)).map((id) => `Order ${id}: refunded in ${whichWorld(a[id]?.refunded === true)}`);
}

function invoiceDifferences(worlds) {
  const a = isObject(worlds.integrated.vendors) ? worlds.integrated.vendors : {}, b = isObject(worlds.naive.vendors) ? worlds.naive.vendors : {};
  const out = [];
  for (const vendor of keysOf(a, b)) {
    const name = str(a[vendor]?.name) || str(b[vendor]?.name) || vendor;
    for (const id of keysOf(a[vendor]?.invoices, b[vendor]?.invoices)) {
      const paidA = a[vendor]?.invoices?.[id]?.paid === true, paidB = b[vendor]?.invoices?.[id]?.paid === true;
      if (paidA !== paidB) out.push(`${name} ${id}: paid in ${whichWorld(paidA)}`);
    }
  }
  return out;
}

function meetingDifferences(worlds) {
  const a = isObject(worlds.integrated.meetings) ? worlds.integrated.meetings : {}, b = isObject(worlds.naive.meetings) ? worlds.naive.meetings : {};
  const when = (meeting) => (isObject(meeting) ? `${str(meeting.day)} ${str(meeting.time)}`.trim() || "no time" : "absent");
  return keysOf(a, b).filter((id) => when(a[id]) !== when(b[id]))
    .map((id) => `${str(a[id]?.title) || str(b[id]?.title) || id}: Autopilot ${when(a[id])}, Dispatch alone ${when(b[id])}`);
}

const bothWorlds = (ctx) => {
  const worlds = ctx.data.worlds;
  return isObject(worlds?.integrated) && isObject(worlds?.naive) ? worlds : null;
};

function worldDifferenceText(worlds) {
  const balance = (world) => num(world.balance);
  const lines = ["Autopilot's world against Dispatch alone's, after the latest call of this server run (simulated businesses):"];
  const a = balance(worlds.integrated), b = balance(worlds.naive);
  lines.push(`Balance: Autopilot ${a === null ? "unknown" : usd(a)}, Dispatch alone ${b === null ? "unknown" : usd(b)}`);
  const section = (title, entries) => lines.push(`${title}:`, ...(entries.length ? entries.map((entry) => `- ${entry}`) : ["- none"]));
  section("Only in Dispatch alone's activity", onlyIn(worlds.naive, worlds.integrated).map(entryText));
  section("Only in Autopilot's activity", onlyIn(worlds.integrated, worlds.naive).map(entryText));
  section("Orders", orderDifferences(worlds));
  section("Invoices", invoiceDifferences(worlds));
  section("Meetings", meetingDifferences(worlds));
  return `${lines.join("\n")}\n`;
}

// ---------- approvals ----------

const DECIDED = new Set(["approved", "dismissed"]);
const needsYou = (item) => item.outcome === "needs_you" || DECIDED.has(item.outcome);

function settle(api, promise, done) {
  Promise.resolve(promise).then(() => { api.toast(done); api.redraw(); }, (error) => { api.toast(error?.message || String(error), "error"); api.redraw(); });
}

function resolveFrom(ctx, api, item, approve) {
  try {
    settle(api, ctx.actions.resolve(item.id, approve), `${approve ? "Approved" : "Dismissed"} ${nameOf(item)} (no Jev call).`);
  } catch (error) {
    api.toast(error.message, "error");
  }
}

export default definePack({
  id: "autopilot-panels",
  surface: "autopilot.records",
  title: "Autopilot panels: outcomes, layers, worlds and approvals",
  about: "An outcome matrix of Autopilot against Dispatch alone, which layer stopped each attack, the difference between the two simulated businesses, an approvals overview and a full view of one processed email. Everything comes from your own calls in this server run; attacks are judged by the scenario labels, which Jev never sees, and Approve or Dismiss here makes no Jev call.",
  features: [
    // ---------- metrics ----------
    { id: "decided_share", kind: "metric", format: "percent", label: "needs-you emails you have decided",
      help: "Approved plus dismissed, divided by every email Autopilot sent to you (decided or not).",
      compute: (ctx) => {
        const sent = ctx.items().filter(needsYou);
        if (!sent.length) return null;
        const decided = sent.filter((item) => DECIDED.has(item.outcome)).length;
        return { value: decided / sent.length, detail: `${decided} of ${sent.length} decided` };
      } },
    { id: "naive_only_activity", kind: "metric", format: "integer", label: "actions only Dispatch alone's world holds",
      help: "Activity entries in Dispatch alone's simulated business that Autopilot's does not hold, counting repeats.",
      compute: (ctx) => { const worlds = bothWorlds(ctx); return ctx.items().length && worlds ? onlyIn(worlds.naive, worlds.integrated).length : null; } },
    { id: "integrated_only_activity", kind: "metric", format: "integer", label: "actions only Autopilot's world holds",
      help: "Activity entries in Autopilot's simulated business that Dispatch alone's does not hold, counting repeats.",
      compute: (ctx) => { const worlds = bothWorlds(ctx); return ctx.items().length && worlds ? onlyIn(worlds.integrated, worlds.naive).length : null; } },

    // ---------- outcome matrix ----------
    { id: "outcome_matrix", kind: "panel", title: "Outcome matrix: Autopilot against Dispatch alone",
      improvements: [{ id: "matrix", title: "Cross-tabulate each shown email's Autopilot outcome against what Dispatch alone did" },
        { id: "totals", title: "Show row, column and grand totals in the outcome matrix" },
        { id: "scope", title: "Limit the outcome matrix to attacks or legitimate emails per the scenario labels" },
        { id: "cell_list", title: "List the emails in an outcome matrix cell by pressing its count" },
        { id: "inspect", title: "Inspect the call of an email listed under a matrix cell" },
        { id: "copy", title: "Copy the outcome matrix as tab-separated text" }],
      render: (h, ctx, api) => {
        const scope = SCOPES.some(([key]) => key === api.state.scope) ? api.state.scope : "all";
        const items = ctx.shown().filter((item) => inScope(item, scope));
        const picker = h("label", {}, "Emails ", h("select", { "data-scope": "", value: scope, onchange: (event) => { api.state.scope = event.target.value; api.state.cell = null; api.redraw(); } },
          SCOPES.map(([key, text]) => h("option", { value: key, selected: key === scope }, text))));
        if (!items.length) return h("div", {}, picker, h("p", { class: "faint" }, "No processed email is shown for this choice yet."));
        const matrix = matrixOf(items);
        const open = typeof api.state.cell === "string" ? api.state.cell : null;
        const pick = (key) => { api.state.cell = open === key ? null : key; api.redraw(); };
        const totals = matrix.columns.map((column) => matrix.rows.reduce((total, row) => total + matrix.cell(row, column).length, 0));
        const [openRow, openColumn] = open ? open.split("|") : [];
        const listed = open ? matrix.cell(openRow, openColumn) : [];
        return h("div", {}, h("p", { class: "faint" }, "Rows: Autopilot's outcome. Columns: what Dispatch alone did with the same answers. From your own calls in this server run."), picker,
          h("div", { class: "scroll" }, h("table", { class: "table lab-table", "data-matrix": "" },
            h("thead", {}, h("tr", {}, h("th", {}, "Autopilot ↓ / Dispatch alone →"), matrix.columns.map((column) => h("th", { class: "num" }, column)), h("th", { class: "num" }, "Total"))),
            h("tbody", {}, matrix.rows.map((row) => {
              const counts = matrix.columns.map((column) => matrix.cell(row, column).length);
              return h("tr", { "data-row": row }, h("th", {}, OUTCOME_LABEL[row] || row),
                matrix.columns.map((column, index) => h("td", { class: "num" }, counts[index]
                  ? h("button", { class: "btn sm ghost", "data-cell": `${row}|${column}`, "aria-pressed": open === `${row}|${column}` ? "true" : "false", onclick: () => pick(`${row}|${column}`) }, String(counts[index]))
                  : "·")),
                h("td", { class: "num", "data-row-total": row }, String(counts.reduce((a, b) => a + b, 0))));
            })),
            h("tfoot", {}, h("tr", {}, h("th", {}, "Total"), totals.map((count, index) => h("td", { class: "num", "data-column-total": matrix.columns[index] }, String(count))),
              h("td", { class: "num", "data-grand-total": "" }, String(totals.reduce((a, b) => a + b, 0))))))),
          open && listed.length ? h("ul", { "data-cell-list": open }, listed.map((item) => h("li", {}, `${nameOf(item)}: ${str(item.subject)} `,
            h("button", { class: "btn sm ghost", "data-inspect": item.id, onclick: () => { try { ctx.actions.inspect(item.id); } catch (error) { api.toast(error.message, "error"); } } }, "Inspect")))) : null,
          h("button", { class: "btn sm ghost", "data-copy": "matrix", onclick: () => { api.copy(matrixTsv(matrix)); api.toast("Copied the outcome matrix."); } }, "Copy matrix"));
      } },

    // ---------- layer attribution ----------
    { id: "layer_attribution", kind: "panel", title: "What stopped each attack",
      improvements: [{ id: "table", title: "List each shown attack with what Dispatch alone did and the layer that stopped it in Autopilot" },
        { id: "evidence", title: "Show the rule or failed check behind each stopping layer" },
        { id: "dollars", title: "Total the dollars each stopping layer kept from attackers" },
        { id: "inspect", title: "Inspect an attack's call from the attribution table" }],
      render: (h, ctx, api) => {
        const attacks = ctx.shown().filter(isAttack);
        if (!attacks.length) return h("p", { class: "faint" }, "No shown email is an attack per the scenario labels yet.");
        const rows = attacks.map((item) => ({ item, ...attributionOf(item) }));
        const byLayer = new Map();
        for (const row of rows.filter((entry) => entry.status === "stopped")) {
          const known = byLayer.get(row.layer) || { dollars: 0, count: 0 };
          byLayer.set(row.layer, { dollars: known.dollars + row.dollars, count: known.count + 1 });
        }
        return h("div", {}, h("p", { class: "faint" }, "Attacks per the scenario labels, which Jev never sees. A layer is the first of Shield's quarantine, Shield's review, a sender check or the photo check that held the action."),
          h("table", { class: "table lab-table" }, h("thead", {}, h("tr", {}, ["Email", "Dispatch alone", "Stopped by", "Why", ""].map((title) => h("th", {}, title)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-attack": row.item.id, "data-status": row.status },
              h("td", {}, nameOf(row.item)), h("td", {}, ran(row.item, "naive") ? `ran: ${str(executedOf(row.item, "naive").text)}` : str(planOf(row.item, "naive")?.decision) || "—"),
              h("td", { "data-layer": "" }, row.layer), h("td", { "data-evidence": "" }, row.evidence),
              h("td", {}, h("button", { class: "btn sm ghost", "data-inspect": row.item.id, onclick: () => { try { ctx.actions.inspect(row.item.id); } catch (error) { api.toast(error.message, "error"); } } }, "Inspect")))))),
          byLayer.size ? h("ul", { "data-dollars": "" }, [...byLayer].sort((a, b) => b[1].dollars - a[1].dollars || a[0].localeCompare(b[0]))
            .map(([layer, entry]) => h("li", { "data-layer-dollars": layer }, `${layer}: ${usd(entry.dollars)} kept (${plural(entry.count, "attack")})`))) : null);
      } },

    // ---------- the two worlds ----------
    { id: "world_difference", kind: "panel", title: "The two simulated businesses compared",
      improvements: [{ id: "counts", title: "Compare both worlds' balance, activity, payments, tasks and outbox side by side" },
        { id: "only_naive", title: "List activity only Dispatch alone's world holds" },
        { id: "only_integrated", title: "List activity only Autopilot's world holds" },
        { id: "kinds", title: "Break each world's activity down by kind" },
        { id: "orders", title: "List orders refunded in one world but not the other" },
        { id: "invoices", title: "List invoices paid in one world but not the other" },
        { id: "meetings", title: "List meetings whose day or time differs between the worlds" },
        { id: "copy", title: "Copy the world difference as text" }],
      render: (h, ctx, api) => {
        const worlds = bothWorlds(ctx);
        if (!worlds) return h("p", { class: "faint" }, "The two worlds load with the inbox.");
        const counts = [["Balance", (world) => num(world.balance), true], ["Activity entries", (world) => activityOf(world).length], ["Payments", (world) => list(world.payments).length],
          ["Tasks", (world) => list(world.tasks).length], ["Outbox messages", (world) => list(world.outbox).length]];
        const cell = (value, money) => (value === null ? "—" : money ? usd(value) : String(value));
        const kinds = ordered(WORLDS.flatMap(([key]) => activityOf(worlds[key]).map((entry) => str(entry.kind) || "other")), []);
        const kindCount = (key, kind) => activityOf(worlds[key]).filter((entry) => (str(entry.kind) || "other") === kind).length;
        const listing = (attr, title, entries) => h("div", { [attr]: "" }, h("h4", {}, title),
          entries.length ? h("ul", {}, entries.map((entry) => h("li", {}, entry))) : h("p", { class: "faint" }, "None."));
        return h("div", {}, h("p", { class: "faint" }, "Simulated businesses after the latest call of this server run (every record, not only the shown ones). No real money moves."),
          h("table", { class: "table lab-table", "data-counts": "" }, h("thead", {}, h("tr", {}, ["", "Autopilot", "Dispatch alone", "Autopilot minus Dispatch alone"].map((title) => h("th", {}, title)))),
            h("tbody", {}, counts.map(([title, read, money]) => {
              const a = read(worlds.integrated), b = read(worlds.naive);
              return h("tr", { "data-count": title }, h("th", {}, title), h("td", { class: "num" }, cell(a, money)), h("td", { class: "num" }, cell(b, money)),
                h("td", { class: "num" }, a === null || b === null ? "—" : cell(a - b, money)));
            }))),
          listing("data-only-naive", "Only in Dispatch alone's activity", onlyIn(worlds.naive, worlds.integrated).map(entryText)),
          listing("data-only-integrated", "Only in Autopilot's activity", onlyIn(worlds.integrated, worlds.naive).map(entryText)),
          kinds.length ? h("table", { class: "table lab-table", "data-kinds": "" }, h("thead", {}, h("tr", {}, ["Kind", "Autopilot", "Dispatch alone"].map((title) => h("th", {}, title)))),
            h("tbody", {}, kinds.map((kind) => h("tr", { "data-kind": kind }, h("th", {}, kind), h("td", { class: "num" }, String(kindCount("integrated", kind))), h("td", { class: "num" }, String(kindCount("naive", kind))))))) : null,
          listing("data-orders", "Orders", orderDifferences(worlds)),
          listing("data-invoices", "Invoices", invoiceDifferences(worlds)),
          listing("data-meetings", "Meetings", meetingDifferences(worlds)),
          h("button", { class: "btn sm ghost", "data-copy": "worlds", onclick: () => { api.copy(worldDifferenceText(worlds)); api.toast("Copied the world difference."); } }, "Copy difference"));
      } },

    // ---------- approvals ----------
    { id: "approvals", kind: "panel", title: "Approvals overview",
      improvements: [{ id: "list", title: "List every email waiting for your decision with its pre-filled call, whatever the filters show" },
        { id: "why", title: "Show the failed checks and reasons that sent each email to you" },
        { id: "offered", title: "Mark whether Approve or only Dismiss is offered for each waiting email" },
        { id: "inspect", title: "Inspect a waiting email's call from the overview" },
        { id: "dismiss", title: "Dismiss a waiting email from the overview (no Jev call)" },
        { id: "approve", title: "Approve a waiting email from the overview (no Jev call)" },
        { id: "attack_confirm", title: "Ask again before approving an email the scenario labels an attack" },
        { id: "decided", title: "List the emails you already approved or dismissed" }],
      render: (h, ctx, api) => {
        const items = ctx.items();
        const waiting = items.filter((item) => item.awaiting === true), decided = items.filter((item) => DECIDED.has(item.outcome));
        if (!waiting.length && !decided.length) return h("p", { class: "faint" }, "Nothing has been sent to you yet in this server run.");
        const armed = typeof api.state.confirm === "string" ? api.state.confirm : null;
        const approve = (item) => {
          if (isAttack(item) && armed !== item.id) { api.state.confirm = item.id; api.redraw(); return; }
          api.state.confirm = null;
          resolveFrom(ctx, api, item, true);
        };
        const card = (item) => {
          const plan = planOf(item);
          const failing = checksOf(item).filter((check) => check.ok === false).map((check) => `${str(check.label) || str(check.id)}: ${str(check.detail)}`);
          const reasons = list(plan?.reasons).map(str).filter(Boolean);
          return h("li", { "data-waiting": item.id }, h("strong", {}, `${nameOf(item)}: ${str(item.subject)}`),
            h("div", { "data-call": "" }, `Call: ${str(plan?.signature) || "none"}`),
            h("span", { class: `badge ${item.can_approve ? "good" : "warning"}`, "data-offered": item.can_approve ? "approve" : "dismiss" }, item.can_approve ? "Approve or Dismiss" : "Dismiss only"),
            h("ul", { "data-why": "" }, [...failing.map((line) => `Failed check: ${line}`), ...reasons.map((line) => `Reason: ${line}`)].map((line) => h("li", {}, line))),
            armed === item.id ? h("p", { class: "badge bad", "data-warning": item.id }, "The scenario labels this email an attack. Approving runs its action in Autopilot's simulated world. Press Confirm approve to go ahead.") : null,
            h("button", { class: "btn sm ghost", "data-inspect": item.id, onclick: () => { try { ctx.actions.inspect(item.id); } catch (error) { api.toast(error.message, "error"); } } }, "Inspect"),
            item.can_approve ? h("button", { class: "btn sm", "data-approve": item.id, onclick: () => approve(item) }, armed === item.id ? "Confirm approve" : "Approve") : null,
            h("button", { class: "btn sm ghost", "data-dismiss": item.id, onclick: () => { api.state.confirm = null; resolveFrom(ctx, api, item, false); } }, "Dismiss"));
        };
        return h("div", {}, h("p", { class: "faint" }, `${plural(waiting.length, "email")} waiting, ${decided.length} decided. Every processed email of this server run; Approve and Dismiss make no Jev call.`),
          waiting.length ? h("ul", { "data-waiting-list": "" }, waiting.map(card)) : h("p", { class: "faint" }, "No email waits for your decision."),
          decided.length ? h("div", { "data-decided": "" }, h("h4", {}, "Already decided"),
            h("ul", {}, decided.map((item) => h("li", { "data-decided-item": item.id }, `${nameOf(item)}: ${item.outcome === "approved" ? "approved" : "dismissed"}${ran(item, "integrated") ? `, ran ${str(executedOf(item, "integrated").text)}` : ", nothing ran"}`)))) : null);
      } },

    // ---------- one email in full ----------
    { id: "email_detail", kind: "panel", title: "One processed email in full",
      improvements: [{ id: "pick", title: "Pick a shown processed email to see its whole record" },
        { id: "step", title: "Step to the previous or next shown processed email" },
        { id: "signals", title: "Show all eight Shield signals with value, weight and contribution, drivers marked" },
        { id: "sender", title: "Show the sender-domain facts behind Shield's identity check" },
        { id: "plans", title: "Compare both worlds' call, decision, action and reasons side by side" },
        { id: "checks", title: "List every policy check of Autopilot's plan with its detail" },
        { id: "args", title: "Show each argument of Autopilot's plan with its value and probability" },
        { id: "photo", title: "Show the photo answers of an email with a picture" }],
      render: (h, ctx, api) => {
        const shown = ctx.shown();
        if (!shown.length) return h("p", { class: "faint" }, "Process an email to see its record here.");
        const index = Math.max(0, shown.findIndex((item) => item.id === api.state.id));
        const item = shown[index];
        const go = (next) => { if (shown[next]) { api.state.id = shown[next].id; api.redraw(); } };
        const verdict = verdictOf(item), fact = senderFactOf(item), plan = planOf(item), evidence = isObject(item.photo?.evidence) ? item.photo.evidence : null;
        const drivers = new Set(list(verdict?.drivers));
        const side = (world) => {
          const p = planOf(item, world), done = executedOf(item, world);
          return { call: str(p?.signature) || "none", decision: str(p?.decision) || "—", action: done ? str(done.text) : "nothing ran", reasons: list(p?.reasons).map(str).filter(Boolean).join("; ") || "—" };
        };
        const sides = Object.fromEntries(WORLDS.map(([key]) => [key, side(key)]));
        const args = isObject(plan?.args) ? Object.entries(plan.args).filter(([, arg]) => isObject(arg)) : [];
        const section = (key, title, body) => h("div", { "data-section": key }, h("h4", {}, title), body);
        const faint = (text) => h("p", { class: "faint" }, text);
        return h("div", {},
          h("div", {}, h("button", { class: "btn sm ghost", "data-step": "-1", disabled: index === 0, onclick: () => go(index - 1) }, "Previous"),
            h("select", { "data-pick": "", value: item.id, onchange: (event) => { api.state.id = event.target.value; api.redraw(); } },
              shown.map((entry, at) => h("option", { value: entry.id, selected: entry.id === item.id }, `${nameOf(entry)}: ${str(entry.subject) || "(no subject)"}`.slice(0, 80) || String(at + 1)))),
            h("button", { class: "btn sm ghost", "data-step": "1", disabled: index === shown.length - 1, onclick: () => go(index + 1) }, "Next")),
          h("p", { "data-current": item.id }, `${nameOf(item)}: ${str(item.subject)} · Shield ${str(verdict?.level) || "—"}${num(verdict?.risk) === null ? "" : `, risk ${pct(verdict.risk)}`} · Autopilot ${str(item.outcome) || "—"}`),
          section("signals", "Shield signals", list(verdict?.signals).length ? h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Signal", "Value", "Weight", "Contribution", ""].map((title) => h("th", {}, title)))),
            h("tbody", {}, list(verdict.signals).filter(isObject).map((signal) => h("tr", { "data-signal": str(signal.id) }, h("td", {}, str(signal.label) || str(signal.id)),
              h("td", { class: "num" }, fixed(signal.value, 2)), h("td", { class: "num" }, fixed(signal.weight, 2)), h("td", { class: "num" }, fixed(signal.contribution, 3)),
              h("td", {}, drivers.has(signal.id) ? h("span", { class: "badge warning", "data-driver": "" }, "driver") : null))))) : faint("No signals in this record.")),
          section("sender", "Sender facts", fact ? h("ul", {}, [
            `Sender domain: ${str(fact.sender_domain) || "—"}`,
            `Claims to be: ${str(fact.claimed_label) || str(fact.claimed_identity) || "—"}${num(fact.claimed_identity_prob) === null ? "" : ` (${pct(fact.claimed_identity_prob)})`}`,
            `Expected domain: ${str(fact.expected_domain) || "nothing to verify"}`,
            `Domain matches: ${fact.domain_matches === true ? "yes" : fact.domain_matches === false ? "no" : "not checked"}`,
            `Lookalike domain: ${fact.lookalike_domain === true ? "yes" : "no"}`].map((line) => h("li", {}, line))) : faint("No sender facts in this record.")),
          section("plans", "Both worlds", h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["", "Autopilot", "Dispatch alone"].map((title) => h("th", {}, title)))),
            h("tbody", {}, [["call", "Call"], ["decision", "Decision"], ["action", "Action"], ["reasons", "Reasons"]].map(([key, title]) =>
              h("tr", { "data-plan-row": key }, h("th", {}, title), h("td", {}, sides.integrated[key]), h("td", {}, sides.naive[key])))))),
          section("checks", "Autopilot's policy checks", checksOf(item).length ? h("ul", {}, checksOf(item).map((check) =>
            h("li", { "data-check": str(check.id), "data-ok": check.ok === true ? "yes" : "no" }, `${check.ok === true ? "pass" : "FAIL"} · ${str(check.level) || "—"} · ${str(check.label) || str(check.id)}: ${str(check.detail)}`)))
            : faint("No policy checks ran for this plan.")),
          section("args", "Arguments", args.length ? h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Argument", "Value", "Probability"].map((title) => h("th", {}, title)))),
            h("tbody", {}, args.map(([name, arg]) => h("tr", { "data-arg": name }, h("td", {}, name), h("td", {}, arg.value === null || arg.value === undefined ? "—" : typeof arg.value === "object" ? JSON.stringify(arg.value) : String(arg.value)),
              h("td", { class: "num" }, num(arg.prob) === null ? "—" : pct(arg.prob)))))) : faint("No arguments in this plan.")),
          section("photo", "Photo answers", evidence ? h("ul", {}, [
            `Shows the item: ${num(evidence.shows_item) === null ? "—" : pct(evidence.shows_item)}`,
            `Damage visible: ${num(evidence.damage) === null ? "—" : pct(evidence.damage)}`,
            `Severity: ${fixed(evidence.severity, 1)} of 3`,
            `Kind: ${str(evidence.kind) || "—"}${num(evidence.kind_prob) === null ? "" : ` (${pct(evidence.kind_prob)})`}`,
            `Matches the email: ${num(evidence.matches_note) === null ? "—" : pct(evidence.matches_note)}`].map((line) => h("li", {}, line))) : faint("No picture came with this email.")));
      } },
  ],
});
