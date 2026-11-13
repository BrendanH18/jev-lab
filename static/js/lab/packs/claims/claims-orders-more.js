// More facts, checks and exports for the Claims order picker (surface "claims.orders"; contract:
// static/js/lab/surfaces/claims.js). Readiness facts are plain arithmetic on the shop's order records as the page loaded
// them and on the current sliders: advisory, never the page's decision. Session facts read only this page load's own
// checks (data.history), as decided when each was sent.
import { csvText, definePack } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const money = (value) => `$${value.toFixed(2)}`;
const windowDays = (ctx) => (num(ctx?.data?.rules?.window_days) ?? 30);
const autoLimit = (ctx) => num(ctx?.data?.settings?.auto_limit_usd);
const shownOf = (ctx) => (ctx.shown ? ctx.shown() : ctx.items());
// Half the total rounded to cents, as jev/claims.py computes the 50% credit.
const credit = (item) => (num(item?.total) === null ? null : Math.round(item.total * 50) / 100);
const unclaimable = (item) => item?.refunded === true || (!!item?.status && item.delivered !== true);
const joinOr = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`);

// This session's checks on one order, oldest first.
const checksOf = (item, ctx) => (Array.isArray(ctx?.data?.history) ? ctx.data.history.filter((entry) => entry && entry.order === item?.id) : []);
const latestOf = (item, ctx) => { const checks = checksOf(item, ctx); return checks.length ? checks[checks.length - 1] : null; };
function costOf(item, ctx) {
  const costs = checksOf(item, ctx).map((entry) => num(entry.meta?.cost_usd)).filter((value) => value !== null);
  return costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
}

// The best outcome the plain-code rules leave open before any photo, under the current sliders: a refunded or
// undelivered order is rejected whatever the photo shows; one outside the window, or whose 50% credit is above the
// automatic limit, goes to a person at best. Advisory arithmetic on the record, not the page's decision.
function bestCase(item, ctx) {
  if (item?.refunded === true) return "reject";
  if (!item?.status) return null;
  if (item.delivered !== true) return "reject";
  const half = credit(item), limit = autoLimit(ctx);
  if (half === null || limit === null || typeof item.within_window !== "boolean") return null;
  return item.within_window && half <= limit ? "approve possible" : "review at best";
}

function statusLine(item, ctx) {
  if (!item.status) return "unknown";
  if (item.delivered !== true || num(item.days_since_delivery) === null) return item.status;
  const days = item.days_since_delivery;
  return `delivered ${days} day${days === 1 ? "" : "s"} ago, ${item.within_window ? "inside" : "outside"} the ${windowDays(ctx)}-day refund window`;
}

export default definePack({
  id: "claims-orders-more",
  surface: "claims.orders",
  title: "Order readiness",
  about: "Automatic-limit headroom, the best case before a photo, this session's decisions and spend per order, record checks and exports for the Claims order picker. Readiness is plain arithmetic on the shop's records as loaded and the current sliders, advisory only; exports hold records and, where they say so, your own session's decisions, never answers.",
  features: [
    { id: "limit_headroom", kind: "fact", type: "number", label: "headroom under the automatic limit for a full refund", unit: "USD",
      help: "The automatic limit now in the sliders minus the order total; negative when a full refund would go to a person (plain arithmetic).",
      value: (item, ctx) => (num(item.total) === null || autoLimit(ctx) === null ? null : Math.round((autoLimit(ctx) - item.total) * 100) / 100) },
    { id: "best_case", kind: "fact", type: "category", label: "best case before a photo (advisory)",
      help: "approve possible, review at best, or reject: what the plain-code record rules leave open under the current sliders, whatever the photo shows.",
      value: (item, ctx) => bestCase(item, ctx) },
    { id: "credit_within_limit", kind: "fact", type: "flag", label: "a 50% credit within the automatic limit",
      value: (item, ctx) => credit(item) !== null && autoLimit(ctx) !== null && credit(item) <= autoLimit(ctx) },
    { id: "latest_decision", kind: "fact", type: "category", label: "latest decision this session (when sent)",
      help: "The decision of your newest check on this order in this page session, under the policy of its time.",
      value: (item, ctx) => latestOf(item, ctx)?.decided?.decision || null },
    { id: "session_cost", kind: "fact", type: "number", label: "measured cost of this session's checks", unit: "USD",
      help: "The cost the server measured for each of your checks on this order in this page session, added up.",
      value: (item, ctx) => costOf(item, ctx) },

    { id: "stale_record", kind: "diagnostic", label: "Your latest check saw a different record", severity: "advice",
      check: (item, ctx) => {
        const latest = latestOf(item, ctx), facts = latest?.facts;
        if (!facts) return null;
        const yesNo = (value) => (value ? "yes" : "no");
        const diffs = [];
        if (typeof facts.status === "string" && facts.status !== item.status) diffs.push(["status", facts.status, item.status || "unknown"]);
        if (typeof facts.refunded === "boolean" && facts.refunded !== item.refunded) diffs.push(["refunded", yesNo(facts.refunded), yesNo(item.refunded)]);
        if (num(facts.total) !== null && num(item.total) !== null && Math.abs(facts.total - item.total) > 0.005) diffs.push(["total", money(facts.total), money(item.total)]);
        if (!diffs.length) return null;
        return `your check #${latest.call} saw ${diffs.map(([field, seen]) => `${field} ${seen}`).join(", ")}; the picker's record, loaded with the page, says ${diffs.map(([field, , here]) => `${field} ${here}`).join(", ")}. Checks always use fresh facts; reload to refresh the picker.`;
      } },
    { id: "window_closing", kind: "diagnostic", label: "Refund window closes within 3 days", severity: "advice",
      check: (item, ctx) => {
        if (item.delivered !== true || item.refunded === true || item.within_window !== true || num(item.days_since_delivery) === null) return null;
        const left = windowDays(ctx) - item.days_since_delivery;
        if (left > 3) return null;
        return `the ${windowDays(ctx)}-day refund window closes ${left === 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`} (delivered ${item.days_since_delivery} days ago).`;
      } },
    { id: "incomplete_record", kind: "diagnostic", label: "Order record is incomplete", severity: "advice",
      check: (item) => {
        const missing = [["total", num(item.total) === null], ["customer", !item.customer], ["items", !item.items], ["status", !item.status]]
          .filter(([, gone]) => gone).map(([field]) => field);
        return missing.length ? `the record has no ${joinOr(missing)}${missing.includes("total") ? ": refund amounts cannot be worked out" : ""}.` : null;
      } },
    { id: "checked_repeatedly", kind: "diagnostic", label: "Checked more than once this session", severity: "info",
      check: (item) => (num(item.checked) !== null && item.checked >= 2 ? `checked ${item.checked} times this session; each check is one paid call.` : null) },
    { id: "checked_unclaimable", kind: "diagnostic", label: "Paid check on an order the record already settles", severity: "advice",
      check: (item) => (num(item.checked) !== null && item.checked >= 1 && unclaimable(item)
        ? `${item.checked} paid check${item.checked === 1 ? "" : "s"} this session on an order that is ${item.refunded ? "already refunded" : item.status}: the plain-code rules reject a claim on it whatever the photo shows.` : null) },
    { id: "no_auto_approval", kind: "diagnostic", scope: "list", label: "No shown order could be approved automatically", severity: "info",
      check: (items, ctx) => (items.length && autoLimit(ctx) !== null && !items.some((item) => bestCase(item, ctx) === "approve possible")
        ? `none of the ${items.length} shown order${items.length === 1 ? "" : "s"} could be approved automatically under the current sliders (plain arithmetic on the records).` : null) },

    { id: "orders_json", kind: "exporter", label: "Shown orders as JSON", help: "the shop's order records as loaded; no answers or decisions",
      filename: "claims-orders.json", mime: "application/json",
      build: (ctx) => `${JSON.stringify(shownOf(ctx).map((item) => ({ id: item.id, items: item.items, customer: item.customer, total: num(item.total), status: item.status,
        days_since_delivery: num(item.days_since_delivery), refunded: item.refunded === true })), null, 2)}\n` },
    { id: "readiness_markdown", kind: "exporter", label: "Claim readiness as a Markdown table",
      help: "per shown order: total, 50% credit, days left in the window, the limit comparisons and the best case; plain arithmetic on the records and current sliders, advisory, not decisions",
      filename: "claims-order-readiness.md", mime: "text/markdown",
      build: (ctx) => {
        const limit = autoLimit(ctx);
        const vs = (amount) => (amount === null || limit === null ? "" : amount <= limit ? "yes" : "no");
        const rows = shownOf(ctx).map((item) => [item.id, num(item.total) === null ? "" : money(item.total), credit(item) === null ? "" : money(credit(item)),
          item.delivered === true && num(item.days_since_delivery) !== null ? windowDays(ctx) - item.days_since_delivery : "", vs(num(item.total)), vs(credit(item)),
          bestCase(item, ctx) || ""]);
        const head = ["order", "total", "50% credit", "days left in window", `full refund ≤ ${limit === null ? "limit" : money(limit)}`,
          `credit ≤ ${limit === null ? "limit" : money(limit)}`, "best case (advisory)"];
        return `${formatMarkdownTable(head, rows)}\n`;
      } },
    { id: "session_by_order_csv", kind: "exporter", label: "This session's checks per order as CSV",
      help: "per shown order: your checks this session, the latest decision and amount as decided when sent, and the measured cost; no answers, notes or photos",
      filename: "claims-session-by-order.csv", mime: "text/csv",
      build: (ctx) => csvText([["order", "checks", "latest_decision_when_sent", "latest_amount_when_sent", "measured_cost_usd"],
        ...shownOf(ctx).map((item) => {
          const latest = latestOf(item, ctx), cost = costOf(item, ctx), amount = num(latest?.decided?.amount);
          return [item.id, checksOf(item, ctx).length, latest?.decided?.decision || "", amount === null ? "" : amount.toFixed(2), cost === null ? "" : cost.toFixed(6)];
        })]) },
    { id: "selected_order_text", kind: "exporter", label: "Selected order as text", help: "the selected order's record as loaded with the page; no answers or decisions",
      filename: (ctx) => (/^[A-Za-z0-9-]+$/.test(ctx.data.selected || "") ? `order-${ctx.data.selected}.txt` : "order.txt"),
      build: (ctx) => {
        const item = ctx.items().find((entry) => entry.id === ctx.data.selected);
        if (!item) throw new Error("No order is selected yet.");
        return [`Order ${item.id} (record as loaded with the page)`, `Items: ${item.items || "unknown"}`, `Customer: ${item.customer || "unknown"}`,
          `Total: ${num(item.total) === null ? "unknown" : money(item.total)}`, `Status: ${statusLine(item, ctx)}`, `Refunded: ${item.refunded ? "yes" : "no"}`, ""].join("\n");
      } },
  ],
});
