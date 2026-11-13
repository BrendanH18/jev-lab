import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-invoice-desk.js";
import { sampleDispatchInvoicesCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture's invoices in table order (balance $16,451): INV-7781 $4,250 open, INV-7790 $1,200 paid, PR-2210 $860
// open, PR-2214 $95.50 open, SF-0930 $420 open, SF-0931 no amount, open, RW-5001 $21,500 open.
const ctx = sampleDispatchInvoicesCtx();
const items = ctx.items();
const empty = () => sampleDispatchInvoicesCtx({ world: null });
// INV-7781 (open) at another amount, for boundary cases against the $16,451 balance and the band edges.
const at = (amount) => ({ ...items[0], amount });
// Bean Brokers only, with the PAID INV-7790 raised to $9,000: the largest open one is still INV-7781 at $4,250.
const bigPaid = () => {
  const world = sampleDispatchInvoicesCtx().state.world;
  world.vendors.bean_brokers.invoices["INV-7790"].amount = 9000;
  return sampleDispatchInvoicesCtx({ world, matches: (id, item) => item.vendor_id === "bean_brokers" });
};
const onlyPackRight = () => sampleDispatchInvoicesCtx({ matches: (id, item) => item.vendor_id === "packright" });

checkPack(pack, {
  amount: { items, ctx, values: [4250, 1200, 860, 95.5, 420, null, 21500] },
  paid: { items, ctx, values: [false, true, false, false, false, false, false] },
  vendor: { items, ctx, values: ["Bean Brokers Ltd", "Bean Brokers Ltd", "PackRight Packaging", "PackRight Packaging", "Sparkle Facility Services", "Sparkle Facility Services", "Roastworks Machinery"] },
  vendor_domain: { items, ctx, values: ["beanbrokers.example", "beanbrokers.example", "packright.example", "packright.example", "sparklefs.example", "sparklefs.example", "roastworks.example"] },
  balance_share: { items, ctx, tolerance: 1e-12, values: [4250 / 16451, 1200 / 16451, 860 / 16451, 95.5 / 16451, 420 / 16451, null, 21500 / 16451] },
  covered: { items: [...items, at(16451), at(16451.01)], ctx, values: [true, false, true, true, true, false, false, true, false] },
  vendor_open_count: { items, ctx, values: [1, 1, 2, 2, 2, 2, 1] },
  amount_band: { items: [...items, at(499.99), at(500), at(1999.99), at(2000)], ctx,
    values: ["$2,000 or more", "$500 to $2,000", "$500 to $2,000", "under $500", "under $500", null, "$2,000 or more", "under $500", "$500 to $2,000", "$500 to $2,000", "$2,000 or more"] },

  exceeds_balance: { ctx, hit: [items[6], at(16451.01)], miss: [items[0], items[5], { ...items[6], paid: true }, at(16451)],
    message: /^Open invoice of \$(21,500\.00|16,451\.01) is more than the \$16,451\.00 balance/ },
  missing_amount: { ctx, hit: items[5], miss: [items[0], items[1]] },
  ambiguous_open_invoice: { ctx, hitList: items, missList: [items[0], items[1], items[2], items[6]],
    message: /^(PackRight Packaging has 2 open invoices \(PR-2210, PR-2214\)|Sparkle Facility Services has 2 open invoices \(SF-0930, SF-0931\))/ },

  open_total: [{ ctx, expect: 27125.5, empty: empty() }, { ctx: onlyPackRight(), expect: 955.5 }],
  paid_total: [{ ctx, expect: 1200, empty: empty() }, { ctx: onlyPackRight(), expect: 0 }],
  balance_after_open: [{ ctx, expect: -10674.5, empty: empty() }, { ctx: onlyPackRight(), expect: 15495.5 }],
  largest_open: [{ ctx, expect: 21500, empty: empty() }, { ctx: onlyPackRight(), expect: 860 }, { ctx: bigPaid(), expect: 4250 }],
  // also: a paid invoice larger than every open one never counts

  invoices_csv: { ctx: onlyPackRight(), filename: "harbor-invoices.csv",
    text: '"invoice","vendor","amount_usd","status"\r\n"PR-2210","PackRight Packaging","860.00","open"\r\n"PR-2214","PackRight Packaging","95.50","open"\r\n' },
  payables_text: { ctx, filename: "harbor-payables.txt",
    text: ["INV-7781 · Bean Brokers Ltd · $4,250.00", "PR-2210 · PackRight Packaging · $860.00", "PR-2214 · PackRight Packaging · $95.50",
      "SF-0930 · Sparkle Facility Services · $420.00", "SF-0931 · Sparkle Facility Services · amount unknown", "RW-5001 · Roastworks Machinery · $21,500.00",
      "Total open: $27,125.50"].join("\n") + "\n",
    excludes: ["INV-7790"] },

  draft_pay: {
    ctx: () => sampleDispatchInvoicesCtx({ matches: (id, item) => item.id !== "INV-7781" }),
    check: (c) => {
      assert.deepEqual(c.recorded, [["draftCommand", "pay PackRight Packaging $860.00"]]);
      assert.equal(c.recorded.some(([name]) => name === "runPlan"), false, "drafting pays nothing");
    },
    hidden: () => sampleDispatchInvoicesCtx({ matches: (id, item) => item.paid || item.id === "SF-0931" }),
  },
  copy_ids: {
    ctx: onlyPackRight,
    check: (c) => {
      assert.deepEqual(c.env.copied, ["PR-2210, PR-2214"]);
      assert.equal(c.env.toasts[0].message, "Copied 2 invoice numbers.");
    },
    hidden: empty,
  },
}, { ctx: () => sampleDispatchInvoicesCtx() });
