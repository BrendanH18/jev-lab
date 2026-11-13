// World facts: more order facts, cross-checks against this world's payments and replies, and world-wide metrics
// (vendor payments, customers without orders, refund exposure) for the Orders table of the simulated Harbor Coffee
// Co. world on the Dispatch page. Everything is local simulation data; refund-window arithmetic is local advice, never the server's
// decision, and nothing here changes the world.
import { definePack } from "../../kit.js";

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") : []);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const usd = (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const windowDays = (ctx) => num(ctx?.data?.refund_window_days) ?? 30;
const daysOf = (item) => num(item?.days_since_delivery);
const totalOf = (item) => num(item?.total);
const delivered = (item) => item.status === "delivered" && daysOf(item) !== null;
const inWindow = (item, ctx) => !item.refunded && delivered(item) && daysOf(item) >= 0 && daysOf(item) <= windowDays(ctx);

// Whole days since 1970-01-01 for a real YYYY-MM-DD date, or null (2026-02-31 is not a date).
function dayNumber(iso) {
  const match = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.round(date.getTime() / 86400000);
}
const isoOfDay = (dayNum) => new Date(dayNum * 86400000).toISOString().slice(0, 10);

// The world's refund payments for one order: the server writes memo "Refund <order>" (jev/world.py).
const refundPayments = (ctx, id) => list(ctx?.data?.payments).filter((payment) => payment.memo === `Refund ${id}`);
const vendorNames = (ctx) => new Set(list(ctx?.data?.vendors).map((vendor) => vendor.name).filter(Boolean));
const vendorPayments = (ctx) => {
  const names = vendorNames(ctx);
  return list(ctx?.data?.payments).filter((payment) => names.has(payment.to) && num(payment.amount) !== null);
};
function productLine(items) {
  const text = String(items || "").toLowerCase();
  if (!text.trim()) return null;
  if (/\bwholesale\b/.test(text)) return "wholesale";
  if (/\b(?:grinder|brewer|kettle|scale|machine|dripper|press)\b/.test(text)) return "equipment";
  if (/\b(?:kit|sampler|box|set|bundle)\b/.test(text)) return "kit";
  if (/\b(?:bags?|blend|beans|roast|oz|lb)\b/.test(text)) return "coffee";
  return "other";
}

export default definePack({
  id: "dispatch-world-facts",
  surface: "dispatch.orders",
  title: "World facts",
  about: "More order facts, refund-window dates and cross-checks against this world's payments and replies, plus world-wide metrics on vendor payments, customers without orders and refund exposure. Simulation data only; refund-window rules are local advice, not the server's decision.",
  features: [
    { id: "quantity", kind: "fact", type: "number", label: "stated quantity", help: "The leading \"N x\" of the items line; blank when none is stated.",
      value: (item) => {
        const match = /^\s*(\d+)\s*[x×]\s/i.exec(typeof item.items === "string" ? item.items : "");
        return match ? Number(match[1]) : null;
      } },
    { id: "customer_orders", kind: "fact", type: "number", label: "orders by the same customer", help: "Counted over every order in the world, shown or not.",
      value: (item, ctx) => (item.customer_id ? ctx.items().filter((order) => order.customer_id === item.customer_id).length : null) },
    { id: "customer_spend", kind: "fact", type: "number", label: "customer's unrefunded order value", unit: "USD",
      help: "The totals of every unrefunded order of the same customer in the world; blank when one of those totals is missing.",
      value: (item, ctx) => {
        if (!item.customer_id) return null;
        const open = ctx.items().filter((order) => order.customer_id === item.customer_id && !order.refunded);
        return open.some((order) => totalOf(order) === null) ? null : open.reduce((sum, order) => sum + totalOf(order), 0);
      } },
    { id: "order_number", kind: "fact", type: "number", label: "order number", help: "The digits of the order id: A-1041 is 1041.",
      value: (item) => {
        const match = typeof item.id === "string" ? /(\d+)$/.exec(item.id) : null;
        return match ? Number(match[1]) : null;
      } },
    { id: "refund_paid", kind: "fact", type: "number", label: "refund paid for the order", unit: "USD",
      help: "From this world's payments list (memo \"Refund <order>\"); 0 when none was paid.",
      value: (item, ctx) => refundPayments(ctx, item.id).reduce((sum, payment) => sum + (num(payment.amount) ?? 0), 0) },
    { id: "replies_to_customer", kind: "fact", type: "number", label: "replies sent to the customer",
      help: "Standard-info replies in this world's outbox addressed to the customer's email.",
      value: (item, ctx) => {
        if (typeof item.email !== "string" || !item.email) return null;
        const email = item.email.toLowerCase();
        return list(ctx?.data?.outbox).filter((mail) => typeof mail.to === "string" && mail.to.toLowerCase() === email).length;
      } },
    { id: "delivery_weekday", kind: "fact", type: "category", label: "delivery weekday",
      value: (item) => {
        const day = dayNumber(item.delivered_on);
        return day === null ? null : WEEKDAY_NAMES[new Date(day * 86400000).getUTCDay()];
      } },
    { id: "product_line", kind: "fact", type: "category", label: "product line", help: "wholesale, equipment, kit, coffee or other, from words in the items line.",
      value: (item) => productLine(item.items) },
    { id: "refund_reason", kind: "fact", type: "category", label: "refund reason", value: (item) => (typeof item.refund_reason === "string" && item.refund_reason ? item.refund_reason : null) },
    { id: "window_closes_on", kind: "fact", type: "text", label: "refund window closing date",
      help: "Delivery date plus the refund window, for delivered orders not yet refunded (local advice).",
      value: (item, ctx) => {
        const day = dayNumber(item.delivered_on);
        return item.refunded || item.status !== "delivered" || day === null ? "" : isoOfDay(day + windowDays(ctx));
      } },

    { id: "window_closes_soon", kind: "diagnostic", severity: "advice", label: "Refund window closing soon",
      help: "Delivered, not refunded, and seven days or fewer left in the refund window (local advice).",
      check: (item, ctx) => {
        if (!inWindow(item, ctx)) return null;
        const left = windowDays(ctx) - daysOf(item);
        if (left > 7) return null;
        const day = dayNumber(item.delivered_on);
        const on = day === null ? "" : ` on ${isoOfDay(day + windowDays(ctx))}`;
        return `The ${windowDays(ctx)}-day refund window closes${on}, ${left === 0 ? "today" : `in ${plural(left, "day")}`} (local advice mirroring the refund policy).`;
      } },
    { id: "delivered_in_future", kind: "diagnostic", severity: "problem", label: "Delivery date after today",
      check: (item, ctx) => (daysOf(item) !== null && daysOf(item) < 0
        ? `Delivered on ${item.delivered_on}, ${plural(-daysOf(item), "day")} after the world's date${ctx?.data?.today ? ` ${ctx.data.today}` : ""}.` : null) },
    { id: "delivery_date_problem", kind: "diagnostic", severity: "advice", label: "Delivery date unreadable or at odds with status",
      check: (item) => {
        const date = item.delivered_on;
        if (date !== null && date !== undefined && dayNumber(date) === null) return `Delivery date ${JSON.stringify(String(date))} is not a real YYYY-MM-DD date.`;
        if (item.status === "delivered" && (date === null || date === undefined)) return "Marked delivered with no delivery date.";
        if (dayNumber(date) !== null && (item.status === "in transit" || item.status === "processing")) return `Has a delivery date (${date}) but its status is "${item.status}".`;
        return null;
      } },
    { id: "refund_mismatch", kind: "diagnostic", severity: "advice", label: "Refund not matched by a payment",
      check: (item, ctx) => {
        if (!item.refunded) return null;
        const payments = refundPayments(ctx, item.id);
        if (!payments.length) return "Marked refunded, but this world's payments list holds no refund for it.";
        const paid = payments.reduce((sum, payment) => sum + (num(payment.amount) ?? 0), 0);
        const total = totalOf(item);
        return total !== null && Math.abs(paid - total) > 0.005 ? `Refund payments add up to ${usd(paid)}; the order total is ${usd(total)}.` : null;
      } },
    { id: "refund_not_marked", kind: "diagnostic", severity: "advice", label: "Refund paid but order not marked refunded",
      check: (item, ctx) => (!item.refunded && refundPayments(ctx, item.id).length
        ? `This world's payments list holds a refund for ${item.id}, but the order is not marked refunded.` : null) },
    { id: "unknown_refund_order", kind: "diagnostic", severity: "advice", scope: "list", label: "Refund payment for an unlisted order",
      check: (items, ctx) => {
        const ids = new Set(ctx.items().map((order) => order.id));
        return list(ctx?.data?.payments).flatMap((payment) => {
          const match = typeof payment.memo === "string" ? /^Refund (.+)$/.exec(payment.memo) : null;
          return match && !ids.has(match[1]) ? [`A refund payment${num(payment.amount) === null ? "" : ` of ${usd(payment.amount)}`} names order ${match[1]}, which is not in the orders list.`] : [];
        });
      } },

    { id: "top_vendor_paid", kind: "metric", format: "text", label: "Vendor paid the most this world",
      help: "Payments to a vendor on file, added up per vendor; on a tie, the vendor paid most recently.",
      compute: (ctx) => {
        const totals = new Map();
        for (const payment of vendorPayments(ctx)) totals.set(payment.to, (totals.get(payment.to) || 0) + payment.amount);
        let best = null;
        for (const [name, total] of totals) if (!best || total > best[1]) best = [name, total];
        return best ? `${best[0]} (${usd(best[1])})` : null;
      } },
    { id: "vendors_unpaid", kind: "metric", format: "integer", label: "Vendors with no payment this world",
      compute: (ctx) => {
        const names = vendorNames(ctx);
        if (!names.size) return null;
        const paid = new Set(vendorPayments(ctx).map((payment) => payment.to));
        return [...names].filter((name) => !paid.has(name)).length;
      } },
    { id: "customers_without_orders", kind: "metric", format: "integer", label: "Customers with no order",
      compute: (ctx) => {
        const customers = list(ctx?.data?.customers);
        if (!customers.length) return null;
        const ordering = new Set(ctx.items().map((order) => order.customer_id));
        return customers.filter((customer) => !ordering.has(customer.id)).length;
      } },
    { id: "balance_after_window_refunds", kind: "metric", format: "usd", label: "Balance if every open-window order were refunded",
      help: "Local arithmetic: the balance minus the totals of delivered, unrefunded orders inside the refund window. Not a bank record or a decision.",
      compute: (ctx) => {
        const balance = num(ctx?.data?.balance);
        if (balance === null) return null;
        const open = ctx.items().filter((order) => inWindow(order, ctx));
        const total = open.reduce((sum, order) => sum + (totalOf(order) ?? 0), 0);
        return { value: balance - total, detail: `${plural(open.length, "order")}, ${usd(total)}` };
      } },
  ],
});
