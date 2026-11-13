// Activity log: facts, checks, money totals and exports for the activity log of the simulated Harbor Coffee Co. world
// on the Dispatch page (newest first, one entry per executed action since the last reset).
import { csvText, definePack } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const MONEY = new Set(["refund", "payment"]);
const amountOf = (item) => (typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : null);
const sumOf = (items, keep) => items.filter(keep).reduce((sum, item) => sum + (amountOf(item) ?? 0), 0);
const countOf = (ctx, kind) => (ctx.shown().length ? ctx.shown().filter((item) => item.kind === kind).length : null);
const chronological = (items) => items.slice().sort((a, b) => (a.n ?? 0) - (b.n ?? 0));

export default definePack({
  id: "dispatch-activity-log",
  surface: "dispatch.activity",
  title: "Activity log",
  about: "Filters, sorts, checks, money totals and exports for the simulated shop's activity log. Exports hold simulation data and the commands' own text; nothing here runs or undoes an action.",
  features: [
    { id: "kind", kind: "fact", type: "category", label: "action kind", value: (item) => item.kind || null },
    { id: "amount", kind: "fact", type: "number", label: "amount moved", unit: "USD", value: (item) => amountOf(item) },
    { id: "money", kind: "fact", type: "flag", label: "money movement", value: (item) => MONEY.has(item.kind) },
    { id: "text", kind: "fact", type: "text", label: "entry text", value: (item) => item.text || "" },
    { id: "number", kind: "fact", type: "number", label: "entry number", help: "1 is the oldest entry since the last reset.",
      value: (item) => (Number.isInteger(item.n) ? item.n : null) },
    { id: "via", kind: "fact", type: "category", label: "source", value: (item) => item.via || null },
    { id: "reference", kind: "fact", type: "text", label: "order or invoice reference",
      value: (item) => (String(item.text || "").match(/\b(?:A-\d+|[A-Z]{2,4}-\d{3,5})\b/) || [""])[0] },
    { id: "task_priority", kind: "fact", type: "category", label: "task priority",
      value: (item) => (item.kind === "task" ? (String(item.text || "").match(/\btask \((low|normal|urgent)\)/) || [null, null])[1] : null) },
    { id: "counterparty", kind: "fact", type: "text", label: "payee or recipient",
      value: (item) => {
        const text = String(item.text || "");
        if (item.kind === "payment") return (text.match(/^Paid \$[\d,.]+ to (.+?) \(/) || ["", ""])[1];
        if (item.kind === "reply") return (text.match(/” to (\S+)$/) || ["", ""])[1];
        return "";
      } },

    { id: "unmatched_payment", kind: "diagnostic", severity: "advice", label: "Payment without an invoice",
      check: (item) => (item.kind === "payment" && /\(no invoice\)$/.test(item.text || "") ? "This payment matched no open invoice on file; check it against the vendor's records." : null) },
    { id: "repeated", kind: "diagnostic", severity: "advice", scope: "list", label: "Same entry twice",
      check: (items) => {
        const seen = new Map();
        for (const item of items) if (item.text) seen.set(item.text, [...(seen.get(item.text) || []), item]);
        return [...seen.values()].filter((list) => list.length > 1)
          .map((list) => `"${list[0].text}" appears ${list.length} times (${list.map((item) => `#${item.n}`).join(", ")}): an action may have run twice.`);
      } },
    { id: "no_kind", kind: "diagnostic", severity: "info", label: "Entry without a kind",
      check: (item) => (!item.kind ? "This entry has no kind, so it is not counted as a refund, payment, task, reply or calendar change." : null) },

    { id: "money_out", kind: "metric", format: "usd", label: "Money out in shown entries",
      compute: (ctx) => (ctx.shown().length ? sumOf(ctx.shown(), (item) => MONEY.has(item.kind)) : null) },
    { id: "refunds_total", kind: "metric", format: "usd", label: "Refunds in shown entries",
      compute: (ctx) => (ctx.shown().length ? sumOf(ctx.shown(), (item) => item.kind === "refund") : null) },
    { id: "payments_total", kind: "metric", format: "usd", label: "Vendor payments in shown entries",
      compute: (ctx) => (ctx.shown().length ? sumOf(ctx.shown(), (item) => item.kind === "payment") : null) },
    { id: "tasks_created", kind: "metric", format: "integer", label: "Tasks created (shown)", compute: (ctx) => countOf(ctx, "task") },
    { id: "replies_sent", kind: "metric", format: "integer", label: "Replies sent (shown)", compute: (ctx) => countOf(ctx, "reply") },
    { id: "calendar_moves", kind: "metric", format: "integer", label: "Meetings moved (shown)", compute: (ctx) => countOf(ctx, "calendar") },
    { id: "balance_before", kind: "metric", format: "usd", label: "Balance before the logged actions",
      help: "The balance tile plus every logged refund and payment: arithmetic on this log, not a bank record.",
      compute: (ctx) => {
        const balance = ctx.data?.balance;
        return typeof balance === "number" && ctx.items().length ? balance + sumOf(ctx.items(), (item) => MONEY.has(item.kind)) : null;
      } },

    { id: "log_text", kind: "exporter", label: "Shown entries as a log, oldest first", help: "simulation data and command text", filename: "harbor-activity.txt",
      build: (ctx) => (ctx.shown().length ? chronological(ctx.shown()).map((item) => `#${item.n} ${item.text}`).join("\n") + "\n" : "No activity is shown.\n") },
    { id: "activity_csv", kind: "exporter", label: "Shown entries as CSV, oldest first", help: "simulation data: number, kind, text, amount, source",
      filename: "harbor-activity.csv", mime: "text/csv",
      build: (ctx) => csvText([["entry", "kind", "text", "amount_usd", "via"], ...chronological(ctx.shown()).map((item) => [item.n, item.kind || "", item.text || "",
        amountOf(item) === null ? "" : amountOf(item).toFixed(2), item.via || ""])]) },
    { id: "activity_markdown", kind: "exporter", label: "Shown entries as a Markdown table, newest first", help: "simulation data and command text",
      filename: "harbor-activity.md", mime: "text/markdown",
      build: (ctx) => `${formatMarkdownTable(["#", "Kind", "Entry"], ctx.shown().map((item) => [item.n, item.kind || "", item.text || ""]))}\n` },

    { id: "copy_latest", kind: "command", group: "Dispatch activity", title: "Copy the latest activity entry",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => {
        const latest = ctx.items()[0];
        ctx.env.copy(latest.text);
        ctx.env.toast?.(`Copied entry #${latest.n}.`);
      } },
  ],
});
