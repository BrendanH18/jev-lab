// Activity log: facts, checks, money totals and exports for the activity log of the simulated Harbor Coffee Co. world
// on the Dispatch page (newest first, one entry per executed action since the last reset). The line formats parsed
// here are the ones jev/world.py writes ("Refunded $38.00 for A-1041 (damaged)", "Paid $1,200.00 to Bean Brokers Ltd
// (INV-7790)", "New equipment task (urgent): …", "Sent “Wholesale pricing” to …", "Moved “…” from … to …").
import { csvText, definePack } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const MONEY = new Set(["refund", "payment"]);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const amountOf = (item) => (typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : null);
const textOf = (item) => (typeof item.text === "string" ? item.text : "");
const sumOf = (items, keep) => items.filter(keep).reduce((sum, item) => sum + (amountOf(item) ?? 0), 0);
const chronological = (items) => items.slice().sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
const REFUND = /^Refunded \$[\d,.]+ for (\S+) \((.*)\)$/;
const TASK = /^New (.+?) task \((low|normal|urgent)\):/;
const REPLY = /^Sent “(.+?)” to (\S+)$/;
const PAYMENT = /^Paid \$[\d,.]+ to (.+?) \(/;
const parsed = (item, kind, pattern) => (item.kind === kind ? textOf(item).match(pattern) : null);

export default definePack({
  id: "dispatch-activity-log",
  surface: "dispatch.activity",
  title: "Activity log",
  about: "Filters, sorts, checks, money totals and exports for the simulated shop's activity log. Exports hold simulation data and the commands' own text; nothing here runs or undoes an action.",
  features: [
    { id: "kind", kind: "fact", type: "category", label: "action kind", value: (item) => item.kind || null },
    { id: "amount", kind: "fact", type: "number", label: "amount moved", unit: "USD", value: (item) => amountOf(item) },
    { id: "money", kind: "fact", type: "flag", label: "money movement", help: "Refunds and vendor payments.", value: (item) => MONEY.has(item.kind) },
    { id: "text", kind: "fact", type: "text", label: "entry text", value: (item) => textOf(item) },
    { id: "number", kind: "fact", type: "number", label: "entry number", help: "1 is the oldest entry since the last reset.",
      value: (item) => (Number.isInteger(item.n) ? item.n : null) },
    { id: "reference", kind: "fact", type: "text", label: "order or invoice reference",
      value: (item) => (textOf(item).match(/\b(?:A-\d+|[A-Z]{2,4}-\d{3,5})\b/) || [""])[0] },
    { id: "refund_reason", kind: "fact", type: "category", label: "refund reason",
      value: (item) => {
        const reason = parsed(item, "refund", REFUND)?.[2];
        return !reason || reason === "None" ? null : reason.replace(/_/g, " ");
      } },
    { id: "task_area", kind: "fact", type: "category", label: "task area", value: (item) => parsed(item, "task", TASK)?.[1] ?? null },
    { id: "task_priority", kind: "fact", type: "category", label: "task priority", value: (item) => parsed(item, "task", TASK)?.[2] ?? null },
    { id: "reply_template", kind: "fact", type: "category", label: "reply sent", help: "The standard-info reply a reply entry sent.",
      value: (item) => parsed(item, "reply", REPLY)?.[1] ?? null },
    { id: "counterparty", kind: "fact", type: "text", label: "payee or recipient",
      help: "Payments: the vendor. Replies: the address. Refunds: who the matching refund payment went to.",
      value: (item, ctx) => {
        if (item.kind === "payment") return parsed(item, "payment", PAYMENT)?.[1] ?? "";
        if (item.kind === "reply") return parsed(item, "reply", REPLY)?.[2] ?? "";
        const order = parsed(item, "refund", REFUND)?.[1];
        if (!order) return "";
        const payments = Array.isArray(ctx?.data?.payments) ? ctx.data.payments : [];
        const payment = payments.find((entry) => isObject(entry) && entry.memo === `Refund ${order}`);
        return payment && typeof payment.to === "string" ? payment.to : "";
      } },

    { id: "unmatched_payment", kind: "diagnostic", severity: "advice", label: "Payment without an invoice",
      check: (item) => (item.kind === "payment" && /\(no invoice\)$/.test(textOf(item)) ? "This payment matched no open invoice on file; check it against the vendor's records." : null) },
    { id: "repeated", kind: "diagnostic", severity: "advice", scope: "list", label: "Repeated entry",
      check: (items) => {
        const seen = new Map();
        for (const item of items) if (textOf(item)) seen.set(item.text, [...(seen.get(item.text) || []), item]);
        return [...seen.values()].filter((list) => list.length > 1)
          .map((list) => `"${list[0].text}" appears ${list.length} times (${list.map((item) => `#${item.n}`).join(", ")}): an action may have run twice.`);
      } },

    { id: "money_out", kind: "metric", format: "usd", label: "Money out in shown entries",
      compute: (ctx) => (ctx.shown().length ? sumOf(ctx.shown(), (item) => MONEY.has(item.kind)) : null) },
    { id: "refunds_total", kind: "metric", format: "usd", label: "Refunds in shown entries",
      compute: (ctx) => (ctx.shown().length ? sumOf(ctx.shown(), (item) => item.kind === "refund") : null) },
    { id: "payments_total", kind: "metric", format: "usd", label: "Vendor payments in shown entries",
      compute: (ctx) => (ctx.shown().length ? sumOf(ctx.shown(), (item) => item.kind === "payment") : null) },
    { id: "balance_before", kind: "metric", format: "usd", label: "Balance before the logged actions",
      help: "The balance tile plus every logged refund and payment, filters ignored: arithmetic on this log, not a bank record.",
      compute: (ctx) => {
        const balance = ctx.data?.balance;
        return typeof balance === "number" && Number.isFinite(balance) && ctx.items().length ? balance + sumOf(ctx.items(), (item) => MONEY.has(item.kind)) : null;
      } },

    { id: "log_text", kind: "exporter", label: "Shown entries as a log, oldest first", help: "simulation data and command text", filename: "harbor-activity.txt",
      build: (ctx) => (ctx.shown().length ? chronological(ctx.shown()).map((item) => `#${item.n} ${textOf(item)}`).join("\n") + "\n" : "No activity is shown.\n") },
    { id: "activity_csv", kind: "exporter", label: "Shown entries as CSV, oldest first", help: "simulation data: number, kind, text, amount, source",
      filename: "harbor-activity.csv", mime: "text/csv",
      build: (ctx) => csvText([["entry", "kind", "text", "amount_usd", "via"], ...chronological(ctx.shown()).map((item) => [item.n, item.kind || "", textOf(item),
        amountOf(item) === null ? "" : amountOf(item).toFixed(2), item.via || ""])]) },
    { id: "activity_markdown", kind: "exporter", label: "Shown entries as a Markdown table, newest first", help: "simulation data and command text",
      filename: "harbor-activity.md", mime: "text/markdown",
      build: (ctx) => `${formatMarkdownTable(["#", "Kind", "Entry"], ctx.shown().map((item) => [item.n, item.kind || "", textOf(item)]))}\n` },

    { id: "copy_latest", kind: "command", group: "Dispatch activity", title: "Copy the latest activity entry",
      help: "The newest entry of the log, whatever the filters show.",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => {
        const latest = ctx.items()[0];
        ctx.env.copy(textOf(latest));
        ctx.env.toast?.(`Copied entry #${latest.n}.`);
      } },
  ],
});
