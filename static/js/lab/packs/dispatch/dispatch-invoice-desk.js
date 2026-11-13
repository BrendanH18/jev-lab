// Invoice desk: facts, advisory checks, payables totals, exports and a drafting shortcut for the Vendor invoices table
// of the simulated Harbor Coffee Co. world on the Dispatch page. Nothing here pays anything.
import { csvText, definePack } from "../../kit.js";

const usd = (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amountOf = (item) => (typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : null);
const balanceOf = (ctx) => (typeof ctx?.data?.balance === "number" && Number.isFinite(ctx.data.balance) ? ctx.data.balance : null);
const open = (item) => item.paid !== true;
const openTotal = (items) => items.filter(open).reduce((sum, item) => sum + (amountOf(item) ?? 0), 0);

export default definePack({
  id: "dispatch-invoice-desk",
  surface: "dispatch.invoices",
  title: "Invoice desk",
  about: "Filters, sorts, payables totals, policy hints and exports for the simulated shop's vendor invoices, plus a shortcut that only drafts a payment command for you to review. Exports hold simulation data only; balance and invoice-match hints are local advice, not the server's checks.",
  features: [
    { id: "amount", kind: "fact", type: "number", label: "invoice amount", unit: "USD", value: (item) => amountOf(item) },
    { id: "paid", kind: "fact", type: "flag", label: "paid invoice", value: (item) => item.paid === true },
    { id: "vendor", kind: "fact", type: "category", label: "vendor", value: (item) => item.vendor || null },
    { id: "vendor_domain", kind: "fact", type: "text", label: "vendor domain", value: (item) => item.vendor_domain || "" },
    { id: "balance_share", kind: "fact", type: "number", label: "share of the bank balance", help: "1 means the whole balance.",
      value: (item, ctx) => {
        const amount = amountOf(item), balance = balanceOf(ctx);
        return amount === null || !balance ? null : amount / balance;
      } },
    { id: "covered", kind: "fact", type: "flag", label: "open and covered by the balance",
      value: (item, ctx) => open(item) && amountOf(item) !== null && balanceOf(ctx) !== null && amountOf(item) <= balanceOf(ctx) },
    { id: "vendor_open_count", kind: "fact", type: "number", label: "open invoices from the same vendor",
      value: (item, ctx) => (item.vendor_id ? ctx.items().filter((other) => other.vendor_id === item.vendor_id && open(other)).length : null) },
    { id: "amount_band", kind: "fact", type: "category", label: "amount band",
      value: (item) => {
        const amount = amountOf(item);
        if (amount === null) return null;
        return amount < 500 ? "under $500" : amount < 2000 ? "$500 to $2,000" : "$2,000 or more";
      } },

    { id: "exceeds_balance", kind: "diagnostic", severity: "problem", label: "More than the balance",
      check: (item, ctx) => {
        const amount = amountOf(item), balance = balanceOf(ctx);
        return open(item) && amount !== null && balance !== null && amount > balance
          ? `Open invoice of ${usd(amount)} is more than the ${usd(balance)} balance: paying it would be blocked (local advice mirroring the funds check).` : null;
      } },
    { id: "missing_amount", kind: "diagnostic", severity: "problem", label: "No amount on file",
      check: (item) => (amountOf(item) === null ? "This invoice has no amount, so no payment can match it." : null) },
    { id: "ambiguous_open_invoice", kind: "diagnostic", severity: "advice", scope: "list", label: "Several open invoices from one vendor",
      check: (items) => {
        const byVendor = new Map();
        for (const item of items.filter(open)) byVendor.set(item.vendor_id, [...(byVendor.get(item.vendor_id) || []), item]);
        return [...byVendor.values()].filter((list) => list.length > 1).map((list) => `${list[0].vendor || list[0].vendor_id} has ${list.length} open invoices `
          + `(${list.map((item) => item.id).join(", ")}), so "pay their open invoice" cannot pick one: name the amount (local advice mirroring the plan's rule).`);
      } },

    { id: "open_total", kind: "metric", format: "usd", label: "Open invoices shown, total",
      compute: (ctx) => (ctx.shown().length ? openTotal(ctx.shown()) : null) },
    { id: "paid_total", kind: "metric", format: "usd", label: "Paid invoices shown, total",
      compute: (ctx) => (ctx.shown().length ? ctx.shown().filter((item) => !open(item)).reduce((sum, item) => sum + (amountOf(item) ?? 0), 0) : null) },
    { id: "balance_after_open", kind: "metric", format: "usd", label: "Balance if every shown open invoice were paid",
      help: "Arithmetic on the balance tile, not a forecast.",
      compute: (ctx) => (ctx.shown().length && balanceOf(ctx) !== null ? balanceOf(ctx) - openTotal(ctx.shown()) : null) },
    { id: "largest_open", kind: "metric", format: "usd", label: "Largest shown open invoice",
      compute: (ctx) => {
        const amounts = ctx.shown().filter(open).map(amountOf).filter((value) => value !== null);
        return amounts.length ? Math.max(...amounts) : null;
      } },

    { id: "invoices_csv", kind: "exporter", label: "Shown invoices as CSV", help: "simulation data: invoice, vendor, amount, status",
      filename: "harbor-invoices.csv", mime: "text/csv",
      build: (ctx) => csvText([["invoice", "vendor", "amount_usd", "status"], ...ctx.shown().map((item) => [item.id, item.vendor || "",
        amountOf(item) === null ? "" : amountOf(item).toFixed(2), open(item) ? "open" : "paid"])]) },
    { id: "payables_text", kind: "exporter", label: "Shown open invoices as a payables list", help: "simulation data with a total line",
      filename: "harbor-payables.txt",
      build: (ctx) => {
        const list = ctx.shown().filter(open);
        if (!list.length) return "No open invoice is shown.\n";
        return [...list.map((item) => `${item.id} · ${item.vendor || item.vendor_id} · ${amountOf(item) === null ? "amount unknown" : usd(amountOf(item))}`),
          `Total open: ${usd(openTotal(list))}`].join("\n") + "\n";
      } },

    { id: "draft_pay", kind: "command", group: "Dispatch invoices", title: "Draft a payment command for the first shown open invoice",
      when: (ctx) => ctx.shown().some((item) => open(item) && amountOf(item) !== null),
      run: (ctx) => {
        const invoice = ctx.shown().find((item) => open(item) && amountOf(item) !== null);
        if (!invoice) throw new Error("No shown open invoice has an amount.");
        ctx.actions.draftCommand(`pay ${invoice.vendor || invoice.vendor_id} ${usd(amountOf(invoice))}`);
        ctx.env?.toast?.("Drafted in the command box. Press Enter to plan it; a payment always goes through the plan's checks.");
      } },
    { id: "copy_ids", kind: "command", group: "Dispatch invoices", title: "Copy the shown invoice numbers",
      when: (ctx) => ctx.shown().length > 0,
      run: (ctx) => {
        const ids = ctx.shown().map((item) => item.id);
        ctx.env.copy(ids.join(", "));
        ctx.env.toast?.(`Copied ${ids.length} invoice number${ids.length === 1 ? "" : "s"}.`);
      } },
  ],
});
