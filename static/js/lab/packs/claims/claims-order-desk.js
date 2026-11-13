// Facts, checks, metrics, exports and commands for the Claims order picker (surface "claims.orders"). Everything is
// plain arithmetic on the shop's order records as the page loaded them: advisory, never the page's decision.
import { csvText, definePack } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const WINDOW_DAYS = 30;
const windowDays = (ctx) => (Number.isFinite(ctx?.data?.rules?.window_days) ? ctx.data.rules.window_days : WINDOW_DAYS);
const autoLimit = (ctx) => (Number.isFinite(ctx?.data?.settings?.auto_limit_usd) ? ctx.data.settings.auto_limit_usd : null);
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const money = (value) => `$${value.toFixed(2)}`;
// Half the total rounded to cents, as jev/claims.py computes the 50% credit (an exact half cent may round the other way there).
const credit = (item) => (num(item?.total) === null ? null : Math.round(item.total * 50) / 100);
const open = (item) => item?.delivered === true && item.refunded !== true;
const shownOf = (ctx) => (ctx.shown ? ctx.shown() : ctx.items());

function columns(items) {
  return items.map((item) => [item.id, item.customer, item.items, num(item.total) === null ? "" : item.total.toFixed(2), item.status,
    num(item.days_since_delivery) === null ? "" : item.days_since_delivery, item.refunded ? "yes" : "no"]);
}
const HEADER = ["order", "customer", "items", "total_usd", "status", "days_since_delivery", "refunded"];

// The next or previous shown order after the selected one (the first shown one when the selection is hidden).
function step(ctx, direction) {
  const shown = shownOf(ctx);
  if (!shown.length) throw new Error("No order is shown.");
  const at = shown.findIndex((item) => item.selected);
  const next = at < 0 ? shown[0] : shown[(at + direction + shown.length) % shown.length];
  return ctx.actions.select(next.id);
}

export default definePack({
  id: "claims-order-desk",
  surface: "claims.orders",
  title: "Order desk",
  about: "Filters, checks, exports and palette commands for the Claims order picker: totals, delivery age, the refund window and the automatic limit, computed from the shop's order records as loaded. Exports hold those records only, never answers or decisions.",
  features: [
    { id: "total", kind: "fact", type: "number", label: "order total", unit: "USD", value: (item) => num(item.total) },
    { id: "days_since_delivery", kind: "fact", type: "number", label: "days since delivery", unit: "days", value: (item) => num(item.days_since_delivery) },
    { id: "days_left", kind: "fact", type: "number", label: "days left in the refund window", unit: "days",
      help: "Window length minus days since delivery; negative once the window has passed. Unavailable before delivery.",
      value: (item, ctx) => (item.delivered === true && num(item.days_since_delivery) !== null ? windowDays(ctx) - item.days_since_delivery : null) },
    { id: "credit_amount", kind: "fact", type: "number", label: "50% credit amount", unit: "USD", help: "Half the total, rounded to cents (plain arithmetic).",
      value: (item) => credit(item) },
    { id: "checked", kind: "fact", type: "number", label: "checks this session", value: (item) => num(item.checked) },
    { id: "status", kind: "fact", type: "category", label: "order status", value: (item) => item.status || null },
    { id: "customer", kind: "fact", type: "text", label: "customer", value: (item) => item.customer },
    { id: "items", kind: "fact", type: "text", label: "items ordered", value: (item) => item.items },
    { id: "refunded", kind: "fact", type: "flag", label: "already refunded", value: (item) => item.refunded === true },
    { id: "open_to_claim", kind: "fact", type: "flag", label: "open to a claim (delivered, not refunded)", value: (item) => open(item) },

    { id: "refunded_check", kind: "diagnostic", label: "Already refunded", severity: "advice",
      check: (item) => (item.refunded === true ? "a claim on this order is rejected (plain-code rule)." : null) },
    { id: "not_delivered_check", kind: "diagnostic", label: "Not delivered yet", severity: "advice",
      check: (item) => (item.status && item.delivered !== true ? `the order is ${item.status}; damage claims start after delivery.` : null) },
    { id: "outside_window_check", kind: "diagnostic", label: "Outside the refund window", severity: "advice",
      check: (item, ctx) => (item.within_window === false && item.refunded !== true && num(item.days_since_delivery) !== null
        ? `delivered ${item.days_since_delivery} days ago, past the ${windowDays(ctx)}-day window: the window rule keeps a claim from automatic approval (plain-code rule, advisory).` : null) },
    { id: "credit_over_limit_check", kind: "diagnostic", label: "Even a 50% credit is above the automatic limit", severity: "advice",
      check: (item, ctx) => {
        if (!open(item)) return null;
        const limit = autoLimit(ctx), half = credit(item);
        return limit !== null && half !== null && half > limit
          ? `${money(half)} against a ${money(limit)} limit: neither remedy fits the automatic limit, so no claim on it is approved automatically (plain arithmetic, advisory).` : null;
      } },

    { id: "open_count", kind: "metric", label: "shown orders open to a claim", format: "integer",
      compute: (ctx) => {
        const shown = shownOf(ctx);
        return shown.length ? shown.filter(open).length : null;
      } },
    { id: "shown_value", kind: "metric", label: "total value of the shown orders", format: "usd",
      compute: (ctx) => {
        const totals = shownOf(ctx).map((item) => num(item.total)).filter((value) => value !== null);
        return totals.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) * 100) / 100 : null;
      } },
    { id: "mean_delivery_age", kind: "metric", label: "mean days since delivery (delivered, shown)", format: "number",
      compute: (ctx) => {
        const days = shownOf(ctx).map((item) => num(item.days_since_delivery)).filter((value) => value !== null);
        return days.length ? days.reduce((sum, value) => sum + value, 0) / days.length : null;
      } },
    { id: "orders_checked", kind: "metric", label: "orders checked this session", format: "integer",
      help: "Orders with at least one answered check in this page session.",
      compute: (ctx) => {
        const items = ctx.items();
        return items.length && ctx.data?.calls ? items.filter((item) => item.checked > 0).length : null;
      } },

    { id: "orders_csv", kind: "exporter", label: "Shown orders as CSV", help: "the shop's order records as loaded; no answers or decisions",
      filename: "claims-orders.csv", mime: "text/csv", build: (ctx) => csvText([HEADER, ...columns(shownOf(ctx))]) },
    { id: "orders_markdown", kind: "exporter", label: "Shown orders as a Markdown table", help: "the shop's order records as loaded; no answers or decisions",
      filename: "claims-orders.md", mime: "text/markdown", build: (ctx) => `${formatMarkdownTable(HEADER, columns(shownOf(ctx)))}\n` },

    { id: "next_order", kind: "command", title: "Choose the next shown order", group: "Claims orders",
      when: (ctx) => !ctx.data?.running && shownOf(ctx).length > 0, run: (ctx) => step(ctx, 1) },
    { id: "previous_order", kind: "command", title: "Choose the previous shown order", group: "Claims orders",
      when: (ctx) => !ctx.data?.running && shownOf(ctx).length > 0, run: (ctx) => step(ctx, -1) },
    { id: "first_open_order", kind: "command", title: "Choose the first shown order open to a claim", group: "Claims orders",
      when: (ctx) => !ctx.data?.running && shownOf(ctx).some(open),
      run: (ctx) => {
        const target = shownOf(ctx).find(open);
        if (!target) throw new Error("No shown order is open to a claim.");
        return ctx.actions.select(target.id);
      } },
    { id: "focus_picker", kind: "command", title: "Focus the order picker", group: "Claims orders",
      when: (ctx) => !ctx.data?.running, run: (ctx) => ctx.actions.focusOrder() },
  ],
});
