import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-ledger-more.js";
import { fixtureWorld, sampleDispatchInvoicesCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture's invoices in table order (balance $16,451.00): INV-7781 $4,250 open and INV-7790 $1,200 PAID (Bean
// Brokers) · PR-2210 $860 and PR-2214 $95.50 open (PackRight) · SF-0930 $420 and SF-0931 (no amount) open (Sparkle) ·
// RW-5001 $21,500 open (Roastworks). Coastline Freight has no invoice. Payments this world, newest first: $500 to
// Coastline Freight "Unmatched payment", $1,200 to Bean Brokers Ltd (INV-7790), a $249 refund to Luis Ortega.
// Open value with an amount: 4250 + 860 + 95.5 + 420 + 21500 = 27125.5; all value with the paid one: 28325.5.
const ctx = sampleDispatchInvoicesCtx();
const items = ctx.items();
const empty = () => sampleDispatchInvoicesCtx({ world: null });
const without = (...ids) => sampleDispatchInvoicesCtx({ matches: (id, item) => !ids.includes(item.id) });

// A messier ledger: INV-7795 $1,200 open at Bean Brokers (same as the paid INV-7790), PR-2219 $860 open at PackRight
// (same as PR-2210), and a new vendor Quayside Repairs with no domain and QR-0007 $420 open (same as SF-0930).
const messyWorld = () => {
  const world = fixtureWorld();
  world.vendors.bean_brokers.invoices["INV-7795"] = { amount: 1200.0, paid: false };
  world.vendors.packright.invoices["PR-2219"] = { amount: 860.0, paid: false };
  world.vendors.quayside = { name: "Quayside Repairs", about: "espresso machine repairs", invoices: { "QR-0007": { amount: 420.0, paid: false } } };
  return world;
};
const messy = sampleDispatchInvoicesCtx({ world: messyWorld() });
const messyItems = messy.items();
// Order: INV-7781, INV-7790, INV-7795, PR-2210, PR-2214, PR-2219, SF-0930, SF-0931, RW-5001, QR-0007.

// The same world with the unmatched payment taken out.
const matchedWorld = () => {
  const world = fixtureWorld();
  world.payments = world.payments.filter((payment) => payment.memo !== "Unmatched payment");
  return world;
};
const matched = sampleDispatchInvoicesCtx({ world: matchedWorld() });

// The fixture's ledger with a $5,000 balance: smallest first 95.5 + 420 + 860 = 1375.5 fits, adding 4250 (5625.5) does
// not, although INV-7781 alone ($4,250) is less than the balance.
const tight = sampleDispatchInvoicesCtx({ world: { ...fixtureWorld(), balance: 5000 } });

// The messy ledger plus INV-7799, a second open $1,200 Bean Brokers invoice beside the paid INV-7790.
const dupWorld = () => {
  const world = messyWorld();
  world.vendors.bean_brokers.invoices["INV-7799"] = { amount: 1200.0, paid: false };
  return world;
};
const dup = sampleDispatchInvoicesCtx({ world: dupWorld() });

checkPack(pack, {
  vendor_open_total: { items, ctx, values: [4250, 4250, 955.5, 955.5, 420, 420, 21500] },
  vendor_paid_total: { items, ctx, values: [1200, 1200, 0, 0, 0, 0, 0] },
  vendor_exposure: { items, ctx, values: [4250 / 27125.5, 4250 / 27125.5, 955.5 / 27125.5, 955.5 / 27125.5, 420 / 27125.5, 420 / 27125.5, 21500 / 27125.5] },
  invoice_number: { items, ctx, values: [7781, 7790, 2210, 2214, 930, 931, 5001] },
  same_amount_count: { items: messyItems, ctx: messy, values: [0, 1, 1, 1, 0, 1, 1, null, 0, 1] },
  vendor_about: { items, ctx, values: ["green coffee importer", "green coffee importer", "coffee bags, labels, and boxes", "coffee bags, labels, and boxes",
    "cleaning and roaster maintenance", "cleaning and roaster maintenance", "roaster parts and service"] },
  has_domain: { items: messyItems, ctx: messy, values: [true, true, true, true, true, true, true, true, true, false] },
  covered_smallest_first: { items: tight.items(), ctx: tight, values: [false, false, true, true, true, false, false] },

  paid_twin: { ctx: messy, hit: messyItems[2], miss: [messyItems[0], messyItems[1], messyItems[3]],
    message: /^Paying \$1,200\.00 to Bean Brokers Ltd would be blocked as already paid: INV-7790 is a paid invoice for the same amount, and payments match invoices by amount \(local advice mirroring the invoice check\)\.$/ },
  // Given in reverse table order (as a Lab sort could): the messages still name invoices in table order.
  same_open_amount: { ctx: messy, hitList: [...messyItems].reverse(), missList: items,
    message: /^(PR-2210 \(PackRight Packaging\) and PR-2219 \(PackRight Packaging\) are both open for \$860\.00; a payment of that amount marks PR-2210 paid first \(local advice mirroring the invoice match\)\.|SF-0930 \(Sparkle Facility Services\) and QR-0007 \(Quayside Repairs\) are both open for \$420\.00: check that it is not a double bill\.)$/ },
  no_domain: { ctx: messy, hit: messyItems[9], miss: [messyItems[0], messyItems[6]],
    message: /^No email domain is on file for Quayside Repairs, so a payment asked for by email can never pass "Sent from the vendor's domain"/ },
  // 27125.5 - 16451 = 10674.5; without RW-5001 the open total is 5625.5.
  open_over_balance: { ctx, hitList: items, missList: items.slice(0, 6),
    message: /^Open invoices total \$27,125\.50, \$10,674\.50 more than the \$16,451\.00 balance: they cannot all be paid now \(local advice mirroring the funds check\)\.$/ },

  // Open amounts 95.5, 420, 860, 4250, 21500: median 860; without RW-5001 the median is (420 + 860) / 2 = 640.
  median_open: [{ ctx, expect: 860, empty: empty() }, { ctx: without("RW-5001"), expect: 640 }],
  smallest_open: [{ ctx, expect: 95.5, empty: empty() }, { ctx: without("PR-2214"), expect: 420 }],
  open_balance_share: [{ ctx, expect: 27125.5 / 16451, empty: empty() }, { ctx: without("RW-5001"), expect: 5625.5 / 16451 }],
  paid_share: [{ ctx, expect: 1200 / 28325.5, empty: empty() }, { ctx: without("INV-7790"), expect: 0 }],
  vendors_without_invoices: [{ ctx, expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "Coastline Freight"); }, empty: empty() }],
  unmatched_total: [{ ctx, expect: 500, empty: empty() }, { ctx: matched, expect: 0 }],
  open_vendors: [{ ctx, expect: 4, empty: empty() }, { ctx: messy, expect: 5 }, { ctx: without("RW-5001"), expect: 3 }],

  by_vendor: { ctx, filename: "harbor-payables-by-vendor.md", text: [
    "| Vendor | Open invoices | Open total | Paid total | No amount |",
    "| --- | --- | --- | --- | --- |",
    "| Bean Brokers Ltd | 1 | $4,250.00 | $1,200.00 | 0 |",
    "| PackRight Packaging | 2 | $955.50 | $0.00 | 0 |",
    "| Sparkle Facility Services | 2 | $420.00 | $0.00 | 1 |",
    "| Roastworks Machinery | 1 | $21,500.00 | $0.00 | 0 |",
    "| Total | 6 | $27,125.50 | $1,200.00 | 1 |",
  ].join("\n") + "\n" },
  jsonl: { ctx, filename: "harbor-invoices.jsonl",
    includes: ['{"id":"INV-7781","vendor":"Bean Brokers Ltd","vendor_domain":"beanbrokers.example","amount":4250,"paid":false}\n',
      '{"id":"INV-7790","vendor":"Bean Brokers Ltd","vendor_domain":"beanbrokers.example","amount":1200,"paid":true}\n',
      '{"id":"SF-0931","vendor":"Sparkle Facility Services","vendor_domain":"sparklefs.example","amount":null,"paid":false}\n'],
    excludes: ["green coffee importer"],
    check: (out) => assert.equal(out.text.split("\n").length - 1, 7) },
  vendor_directory: { ctx, filename: "harbor-vendors.csv", text: [
    '"vendor","about","domain","invoices","open_total_usd"',
    '"Bean Brokers Ltd","green coffee importer","beanbrokers.example","2","4250.00"',
    '"PackRight Packaging","coffee bags, labels, and boxes","packright.example","2","955.50"',
    '"Coastline Freight","pallet shipping for wholesale orders","coastlinefreight.example","0","0.00"',
    '"Sparkle Facility Services","cleaning and roaster maintenance","sparklefs.example","2","420.00"',
    '"Roastworks Machinery","roaster parts and service","roastworks.example","1","21500.00"',
  ].join("\r\n") + "\r\n" },
  payments_csv: { ctx, filename: "harbor-payments.csv", text: [
    '"to","amount_usd","memo","destination"',
    '"Coastline Freight","500.00","Unmatched payment","account on file"',
    '"Bean Brokers Ltd","1200.00","INV-7790","account on file"',
    '"Luis Ortega","249.00","Refund A-1042",""',
  ].join("\r\n") + "\r\n" },
}, { ctx: () => sampleDispatchInvoicesCtx() });

// Every branch of the same-amount check, with exact messages in table order (checkPack only checks that each finding matches).
const byId = (id) => pack.features.find((feature) => feature.id === id);
test("dispatch-ledger-more same-amount check covers each vendor case", () => {
  assert.deepEqual(byId("same_open_amount").check([...dup.items()].reverse(), dup), [
    "INV-7795 (Bean Brokers Ltd) and INV-7799 (Bean Brokers Ltd) are both open for $1,200.00; a payment of that amount would be blocked because INV-7790 is already paid (local advice mirroring the invoice check).",
    "PR-2210 (PackRight Packaging) and PR-2219 (PackRight Packaging) are both open for $860.00; a payment of that amount marks PR-2210 paid first (local advice mirroring the invoice match).",
    "SF-0930 (Sparkle Facility Services) and QR-0007 (Quayside Repairs) are both open for $420.00: check that it is not a double bill.",
  ]);
  // With PR-2210 hidden by a filter, a payment of $860 still marks PR-2210 first, so nothing is reported for one shown copy.
  assert.deepEqual(byId("same_open_amount").check(messyItems.filter((item) => item.id !== "PR-2210" && item.amount !== 420), messy), []);
  for (const feature of pack.features.filter((entry) => entry.kind === "fact")) {
    for (const odd of [{}, { id: 7, amount: "12", paid: "yes" }]) assert.doesNotThrow(() => feature.value(odd, ctx), feature.id);
  }
});
