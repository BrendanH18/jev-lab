// Order desk: facts, advisory checks, totals, exports and drafting shortcuts for the Orders table of the simulated
// Harbor Coffee Co. world on the Dispatch page. Everything is local simulation data; nothing here runs an action.
import { csvText, definePack } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const usd = (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const windowDays = (ctx) => (typeof ctx?.data?.refund_window_days === "number" ? ctx.data.refund_window_days : 30);
const daysOf = (item) => (typeof item.days_since_delivery === "number" ? item.days_since_delivery : null);
const delivered = (item) => item.status === "delivered" && daysOf(item) !== null;
const inWindow = (item, ctx) => !item.refunded && delivered(item) && daysOf(item) <= windowDays(ctx);
const totalOf = (item) => (typeof item.total === "number" && Number.isFinite(item.total) ? item.total : null);
const refundable = (item) => !item.refunded && (item.status === "delivered" || item.status === "in transit");

export default definePack({
  id: "dispatch-order-desk",
  surface: "dispatch.orders",
  title: "Order desk",
  about: "Filters, sorts, policy hints, totals and exports for the simulated shop's orders, plus shortcuts that only draft a command for you to run. Exports hold simulation data only; refund-window hints are local advice, not the server's decision.",
  features: [
    { id: "total", kind: "fact", type: "number", label: "order total", unit: "USD", value: (item) => totalOf(item) },
    { id: "days_since_delivery", kind: "fact", type: "number", label: "days since delivery", unit: "days", value: (item) => daysOf(item) },
    { id: "window_days_left", kind: "fact", type: "number", label: "refund window days left", unit: "days",
      help: "Delivered orders only; negative once the window has passed.",
      value: (item, ctx) => (delivered(item) ? windowDays(ctx) - daysOf(item) : null) },
    { id: "refunded", kind: "fact", type: "flag", label: "refunded order", value: (item) => item.refunded === true },
    { id: "in_window", kind: "fact", type: "flag", label: "open refund window", help: "Delivered, not refunded, and within the refund window (local advice).",
      value: (item, ctx) => inWindow(item, ctx) },
    { id: "status", kind: "fact", type: "category", label: "order status", value: (item) => (item.refunded ? "refunded" : item.status || null) },
    { id: "customer", kind: "fact", type: "category", label: "customer", value: (item) => item.customer || null },
    { id: "items", kind: "fact", type: "text", label: "ordered items", value: (item) => item.items || "" },
    { id: "wholesale", kind: "fact", type: "flag", label: "wholesale order", value: (item) => /\bwholesale\b/i.test(item.items || "") },
    { id: "email_domain", kind: "fact", type: "category", label: "customer email domain",
      value: (item) => (typeof item.email === "string" && item.email.includes("@") ? item.email.slice(item.email.lastIndexOf("@") + 1).toLowerCase() : null) },
    { id: "plan_target", kind: "fact", type: "flag", label: "order in your latest plan",
      value: (item, ctx) => ctx?.data?.plan?.tool === "refund_order" && ctx.data.plan.exec_args?.order === item.id },

    { id: "outside_window", kind: "diagnostic", severity: "advice", label: "Past the refund window",
      check: (item, ctx) => (!item.refunded && delivered(item) && daysOf(item) > windowDays(ctx)
        ? `Delivered ${daysOf(item)} days ago, past the ${windowDays(ctx)}-day window for damaged or wrong items (local advice mirroring the refund policy).` : null) },
    { id: "not_shipped", kind: "diagnostic", severity: "info", label: "Not shipped yet",
      check: (item) => (!item.refunded && item.status === "processing" ? "Still processing: the refund policy says to cancel it instead of refunding (local advice)." : null) },
    { id: "missing_details", kind: "diagnostic", severity: "advice", label: "Missing order details",
      check: (item) => {
        const missing = [!item.customer && "customer", totalOf(item) === null && "total", !item.status && "status", !item.items && "items"].filter(Boolean);
        return missing.length ? `Missing ${missing.join(", ")}.` : null;
      } },
    { id: "repeat_customer", kind: "diagnostic", severity: "info", scope: "list", label: "Customer with several open orders",
      check: (items) => {
        const counts = new Map();
        for (const item of items) if (!item.refunded && item.customer_id) counts.set(item.customer_id, [...(counts.get(item.customer_id) || []), item]);
        return [...counts.values()].filter((list) => list.length > 1)
          .map((list) => `${list[0].customer || list[0].customer_id} has ${list.length} open orders (${list.map((item) => item.id).join(", ")}): name the order number in a refund command.`);
      } },

    { id: "open_value", kind: "metric", format: "usd", label: "Value of shown unrefunded orders",
      compute: (ctx) => {
        const shown = ctx.shown();
        if (!shown.length) return null;
        return shown.filter((item) => !item.refunded).reduce((sum, item) => sum + (totalOf(item) ?? 0), 0);
      } },
    { id: "refunded_value", kind: "metric", format: "usd", label: "Refunded so far (all orders)",
      compute: (ctx) => {
        const items = ctx.items();
        return items.length ? items.filter((item) => item.refunded).reduce((sum, item) => sum + (totalOf(item) ?? 0), 0) : null;
      } },
    { id: "refund_share", kind: "metric", format: "percent", label: "Share of orders refunded",
      compute: (ctx) => {
        const items = ctx.items();
        return items.length ? items.filter((item) => item.refunded).length / items.length : null;
      } },
    { id: "average_total", kind: "metric", format: "usd", label: "Average shown order total",
      compute: (ctx) => {
        const totals = ctx.shown().map(totalOf).filter((value) => value !== null);
        return totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : null;
      } },
    { id: "refundable_now", kind: "metric", format: "integer", label: "Orders inside the refund window",
      help: "Delivered, not refunded, within the window (local advice).",
      compute: (ctx) => {
        const items = ctx.items();
        return items.length ? items.filter((item) => inWindow(item, ctx)).length : null;
      } },

    { id: "orders_csv", kind: "exporter", label: "Shown orders as CSV", help: "simulation data: order, customer, items, status, total, delivery date, refunded",
      filename: "harbor-orders.csv", mime: "text/csv",
      build: (ctx) => csvText([["order", "customer", "items", "status", "total_usd", "delivered_on", "refunded"],
        ...ctx.shown().map((item) => [item.id, item.customer || "", item.items || "", item.status || "", totalOf(item) === null ? "" : totalOf(item).toFixed(2),
          item.delivered_on || "", item.refunded ? "yes" : "no"])]) },
    { id: "orders_markdown", kind: "exporter", label: "Shown orders as a Markdown table", help: "simulation data, refunded orders marked",
      filename: "harbor-orders.md", mime: "text/markdown",
      build: (ctx) => `${formatMarkdownTable(["Order", "Customer", "Items", "Status", "Total"], ctx.shown().map((item) => [item.id, item.customer || "",
        item.items || "", item.refunded ? "refunded" : item.status || "", totalOf(item) === null ? "" : usd(totalOf(item))]))}\n` },

    { id: "draft_refund", kind: "command", group: "Dispatch orders", title: "Draft a refund command for the first shown open order",
      when: (ctx) => ctx.shown().some(refundable),
      run: (ctx) => {
        const order = ctx.shown().find(refundable);
        if (!order) throw new Error("No shown order can be refunded.");
        const text = `refund order ${order.id}${order.customer ? ` for ${order.customer}` : ""}`;
        ctx.actions.draftCommand(text);
        ctx.env?.toast?.("Drafted in the command box. Add the reason, then press Enter to plan it.");
      } },
    { id: "copy_ids", kind: "command", group: "Dispatch orders", title: "Copy the shown order numbers",
      when: (ctx) => ctx.shown().length > 0,
      run: (ctx) => {
        const ids = ctx.shown().map((item) => item.id);
        ctx.env.copy(ids.join(", "));
        ctx.env.toast?.(`Copied ${ids.length} order number${ids.length === 1 ? "" : "s"}.`);
      } },
    { id: "copy_emails", kind: "command", group: "Dispatch orders", title: "Copy the shown customers' email addresses",
      when: (ctx) => ctx.shown().some((item) => item.email),
      run: (ctx) => {
        const emails = [...new Set(ctx.shown().map((item) => item.email).filter(Boolean))];
        ctx.env.copy(emails.join("\n"));
        ctx.env.toast?.(`Copied ${emails.length} address${emails.length === 1 ? "" : "es"} (fictional simulation data).`);
      } },
  ],
});
