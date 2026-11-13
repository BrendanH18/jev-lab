// More payables for the Vendor invoices table of the simulated Harbor Coffee Co. world on the Dispatch page: vendor
// exposure, duplicate amounts, what the balance covers, vendors without a domain, payments made this world, and
// exports. Read-only: nothing here pays, drafts a payment or calls the model. Rules mirrored from jev/world.py and
// jev/dispatch.py (payments match invoices by amount, the funds check, the vendor-domain check) are local advice.
import { csvText, definePack } from "../../kit.js";
import { median } from "../../lib/math.js";
import { formatJsonl, formatMarkdownTable } from "../../lib/tables.js";

const usd = (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amountOf = (item) => (typeof item?.amount === "number" && Number.isFinite(item.amount) ? item.amount : null);
const balanceOf = (ctx) => (typeof ctx?.data?.balance === "number" && Number.isFinite(ctx.data.balance) ? ctx.data.balance : null);
const open = (item) => item.paid !== true;
const sumAmounts = (items) => items.reduce((total, item) => total + (amountOf(item) ?? 0), 0);
const sameAmount = (a, b) => Math.abs(a - b) < 0.005;   // jev/world.py open_invoice_for / paid_invoice_for
const listOf = (value) => (Array.isArray(value) ? value : []);
const vendorName = (item) => item.vendor || item.vendor_id;
const positionOf = (item) => (Number.isFinite(item?.position) ? item.position : Infinity);
const paymentsOf = (ctx) => listOf(ctx?.data?.payments).filter((payment) => payment && typeof payment === "object");
const unmatched = (ctx) => paymentsOf(ctx).filter((payment) => payment.memo === "Unmatched payment");
// The world is loaded when it has invoices or vendors; before that, payment metrics have nothing to measure.
const loaded = (ctx) => ctx.items().length > 0 || listOf(ctx?.data?.vendors).length > 0;

const vendorItems = (item, ctx) => (item.vendor_id ? ctx.items().filter((other) => other.vendor_id === item.vendor_id) : null);

// Open invoices with an amount that the balance covers when paid smallest first (ties in table order).
function coveredSmallestFirst(ctx) {
  const balance = balanceOf(ctx);
  const covered = new Set();
  if (balance === null) return covered;
  let spent = 0;
  const queue = ctx.items().filter((item) => open(item) && amountOf(item) !== null)
    .map((item, index) => ({ item, index })).sort((a, b) => amountOf(a.item) - amountOf(b.item) || a.index - b.index);
  for (const { item } of queue) {
    if (spent + amountOf(item) > balance + 0.005) break;
    spent += amountOf(item);
    covered.add(item.id);
  }
  return covered;
}

// Rows grouped by vendor in table order: [{ name, items }].
function byVendor(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.vendor_id || vendorName(item) || "";
    if (!groups.has(key)) groups.set(key, { name: vendorName(item) || "(unknown vendor)", items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

export default definePack({
  id: "dispatch-ledger-more",
  surface: "dispatch.invoices",
  title: "Ledger and exposure",
  about: "Vendor exposure, duplicate amounts, what the balance covers, vendors without a domain, payments made this world, and payables exports for the simulated shop's vendor invoices. Hints that mirror the payment checks are local advice, never a payment decision; exports hold simulation data only.",
  features: [
    { id: "vendor_open_total", kind: "fact", type: "number", label: "vendor's open total", unit: "USD",
      help: "Every open invoice from the same vendor, shown or not.",
      value: (item, ctx) => { const list = vendorItems(item, ctx); return list ? sumAmounts(list.filter(open)) : null; } },
    { id: "vendor_paid_total", kind: "fact", type: "number", label: "vendor's paid total", unit: "USD",
      help: "Every paid invoice from the same vendor, shown or not.",
      value: (item, ctx) => { const list = vendorItems(item, ctx); return list ? sumAmounts(list.filter((other) => !open(other))) : null; } },
    { id: "vendor_exposure", kind: "fact", type: "number", label: "vendor's share of all open value",
      help: "The vendor's open total over every open invoice's amount; 1 means one vendor holds it all.",
      value: (item, ctx) => {
        const list = vendorItems(item, ctx), all = sumAmounts(ctx.items().filter(open));
        return list && all > 0 ? sumAmounts(list.filter(open)) / all : null;
      } },
    { id: "invoice_number", kind: "fact", type: "number", label: "invoice sequence number", help: "The digits at the end of the invoice number: INV-7781 is 7781.",
      value: (item) => {
        const match = typeof item.id === "string" ? item.id.match(/(\d+)$/) : null;
        return match ? Number(match[1]) : null;
      } },
    { id: "same_amount_count", kind: "fact", type: "number", label: "other invoices with the same amount",
      help: "Open or paid, from any vendor, to the cent.",
      value: (item, ctx) => (amountOf(item) === null ? null
        : ctx.items().filter((other) => other !== item && other.id !== item.id && amountOf(other) !== null && sameAmount(amountOf(other), amountOf(item))).length) },
    { id: "vendor_about", kind: "fact", type: "text", label: "what the vendor does", value: (item) => item.vendor_about || "" },
    { id: "has_domain", kind: "fact", type: "flag", label: "vendor domain on file", value: (item) => typeof item.vendor_domain === "string" && item.vendor_domain.trim() !== "" },
    { id: "covered_smallest_first", kind: "fact", type: "flag", label: "payable from the balance, smallest first",
      help: "Paying every open invoice from the smallest up, this one still fits the balance. Arithmetic, not a plan.",
      value: (item, ctx) => open(item) && amountOf(item) !== null && coveredSmallestFirst(ctx).has(item.id) },

    { id: "paid_twin", kind: "diagnostic", severity: "problem", label: "Same amount as a paid invoice",
      check: (item, ctx) => {
        if (!open(item) || amountOf(item) === null) return null;
        const twin = (vendorItems(item, ctx) || []).find((other) => other.id !== item.id && !open(other) && amountOf(other) !== null && sameAmount(amountOf(other), amountOf(item)));
        return twin ? `Paying ${usd(amountOf(item))} to ${vendorName(item)} would be blocked as already paid: ${twin.id} is a paid invoice for the same amount, `
          + "and payments match invoices by amount (local advice mirroring the invoice check)." : null;
      } },
    { id: "same_open_amount", kind: "diagnostic", severity: "advice", scope: "list", label: "Open invoices with the same amount",
      help: "Within one vendor, a payment of that amount marks the first one in table order paid, or is blocked when a paid invoice has the same amount; across vendors it may be a double bill.",
      check: (items, ctx) => {
        const groups = new Map();
        for (const item of items.filter((entry) => open(entry) && amountOf(entry) !== null)) {
          const key = Math.round(amountOf(item) * 100);
          groups.set(key, [...(groups.get(key) || []), item]);
        }
        const byPosition = (list) => [...list].sort((a, b) => positionOf(a) - positionOf(b));
        return [...groups.values()].filter((list) => list.length > 1).map(byPosition)
          .sort((a, b) => positionOf(a[0]) - positionOf(b[0])).map((list) => {
            const amount = amountOf(list[0]);
            const names = list.map((item) => `${item.id} (${vendorName(item)})`);
            const head = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are ${list.length > 2 ? "all" : "both"} open for ${usd(amount)}`;
            if (new Set(list.map((item) => item.vendor_id)).size !== 1) return `${head}: check that it is not a double bill.`;
            // jev/world.py: paid_invoice_for blocks the payment first; otherwise open_invoice_for takes the vendor's first
            // invoice with that amount in table order, shown or not.
            const twins = byPosition((vendorItems(list[0], ctx) || list).filter((other) => amountOf(other) !== null && sameAmount(amountOf(other), amount)));
            const paid = twins.find((other) => !open(other));
            return paid
              ? `${head}; a payment of that amount would be blocked because ${paid.id} is already paid (local advice mirroring the invoice check).`
              : `${head}; a payment of that amount marks ${(twins[0] || list[0]).id} paid first (local advice mirroring the invoice match).`;
          });
      } },
    { id: "no_domain", kind: "diagnostic", severity: "advice", label: "Vendor without a domain",
      check: (item) => (typeof item.vendor_domain === "string" && item.vendor_domain.trim() !== "" ? null
        : `No email domain is on file for ${vendorName(item)}, so a payment asked for by email can never pass "Sent from the vendor's domain" and would need your approval (local advice mirroring the plan's check).`) },
    { id: "open_over_balance", kind: "diagnostic", severity: "problem", scope: "list", label: "Open invoices total more than the balance",
      check: (items, ctx) => {
        const balance = balanceOf(ctx), total = sumAmounts(items.filter(open));
        return balance !== null && total > balance + 0.005
          ? `Open invoices total ${usd(total)}, ${usd(total - balance)} more than the ${usd(balance)} balance: they cannot all be paid now (local advice mirroring the funds check).` : null;
      } },

    { id: "median_open", kind: "metric", format: "usd", label: "Median shown open invoice",
      compute: (ctx) => median(ctx.shown().filter(open).map(amountOf).filter((value) => value !== null)) },
    { id: "smallest_open", kind: "metric", format: "usd", label: "Smallest shown open invoice",
      compute: (ctx) => {
        const amounts = ctx.shown().filter(open).map(amountOf).filter((value) => value !== null);
        return amounts.length ? Math.min(...amounts) : null;
      } },
    { id: "open_balance_share", kind: "metric", format: "percent", label: "Shown open value as a share of the balance",
      help: "Over 100% means the balance cannot cover them all.",
      compute: (ctx) => {
        const balance = balanceOf(ctx);
        return ctx.shown().length && balance ? sumAmounts(ctx.shown().filter(open)) / balance : null;
      } },
    { id: "paid_share", kind: "metric", format: "percent", label: "Paid share of shown invoice value",
      compute: (ctx) => {
        const all = sumAmounts(ctx.shown());
        return all > 0 ? sumAmounts(ctx.shown().filter((item) => !open(item))) / all : null;
      } },
    { id: "vendors_without_invoices", kind: "metric", format: "integer", label: "Vendors with no invoice on file",
      compute: (ctx) => {
        const vendors = listOf(ctx?.data?.vendors);
        if (!vendors.length) return null;
        const billed = new Set(ctx.items().map((item) => item.vendor_id));
        const none = vendors.filter((vendor) => !billed.has(vendor.id));
        return { value: none.length, detail: none.map((vendor) => vendor.name || vendor.id).join(", ") };
      } },
    { id: "unmatched_total", kind: "metric", format: "usd", label: "Paid without an invoice since the last reset",
      help: "Payments this world that matched no open invoice (memo \"Unmatched payment\").",
      compute: (ctx) => (loaded(ctx) ? unmatched(ctx).reduce((total, payment) => total + (payment.amount ?? 0), 0) : null) },
    { id: "open_vendors", kind: "metric", format: "integer", label: "Vendors with a shown open invoice",
      compute: (ctx) => (ctx.shown().length ? new Set(ctx.shown().filter(open).map((item) => item.vendor_id)).size : null) },

    { id: "by_vendor", kind: "exporter", label: "Shown payables by vendor as Markdown",
      help: "simulation data: open count, open total, paid total and invoices without an amount per vendor, with a total row",
      filename: "harbor-payables-by-vendor.md", mime: "text/markdown",
      build: (ctx) => {
        const groups = byVendor(ctx.shown());
        const row = (name, list) => [name, list.filter(open).length, usd(sumAmounts(list.filter(open))), usd(sumAmounts(list.filter((item) => !open(item)))),
          list.filter((item) => amountOf(item) === null).length];
        return `${formatMarkdownTable(["Vendor", "Open invoices", "Open total", "Paid total", "No amount"],
          [...groups.map((group) => row(group.name, group.items)), row("Total", ctx.shown())])}\n`;
      } },
    { id: "jsonl", kind: "exporter", label: "Shown invoices as JSON Lines", help: "simulation data: invoice, vendor, vendor domain, amount, paid",
      filename: "harbor-invoices.jsonl", mime: "application/x-ndjson",
      build: (ctx) => formatJsonl(ctx.shown().map((item) => ({ id: item.id, vendor: item.vendor || "", vendor_domain: item.vendor_domain ?? null,
        amount: amountOf(item), paid: item.paid === true }))) },
    { id: "vendor_directory", kind: "exporter", label: "Vendor directory as CSV",
      help: "simulation data: every vendor of the world with what it does, its domain, its invoice count and open total",
      filename: "harbor-vendors.csv", mime: "text/csv",
      build: (ctx) => csvText([["vendor", "about", "domain", "invoices", "open_total_usd"], ...listOf(ctx.data?.vendors).map((vendor) => {
        const list = ctx.items().filter((item) => item.vendor_id === vendor.id);
        return [vendor.name || vendor.id, vendor.about || "", vendor.domain || "", list.length, sumAmounts(list.filter(open)).toFixed(2)];
      })]) },
    { id: "payments_csv", kind: "exporter", label: "Payments sent this world as CSV",
      help: "simulation data, newest first: payee, amount, memo, destination; customer refunds included",
      filename: "harbor-payments.csv", mime: "text/csv",
      build: (ctx) => csvText([["to", "amount_usd", "memo", "destination"], ...paymentsOf(ctx).map((payment) => [payment.to || "",
        payment.amount === null || payment.amount === undefined ? "" : payment.amount.toFixed(2), payment.memo || "", payment.destination || ""])]) },
  ],
});
