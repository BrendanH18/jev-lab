import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-world-facts.js";
import { fixtureWorld, sampleDispatchOrdersCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture world (today 2026-03-20): A-1041 Maya delivered 2026-03-17 · A-1042 Luis delivered 2026-03-08, refunded
// (damaged; a $249 "Refund A-1042" payment) · A-1043 Priya in transit (one reply sent to her) · A-1044 Tom delivered
// 2026-02-07 · A-1045 Northside processing (wholesale) · A-1046 unknown customer, delivery date "soon".
const ctx = sampleDispatchOrdersCtx();
const orders = ctx.items();
const empty = () => sampleDispatchOrdersCtx({ world: null });

// A busier world: a second Maya order (3 bags, delivered 2026-02-25, 23 days ago: 7 days of window left), a refunded
// Tom order paid back by an operator, and a customer with no order.
const busyWorld = () => {
  const world = fixtureWorld();
  world.orders["A-1047"] = { customer: "maya_chen", items: "3 x Kenya AA, 12 oz bags", total: 42.5, status: "delivered", delivered_on: "2026-02-25", refunded: false };
  world.orders["A-1048"] = { customer: "tom_becker", items: "Pour-over kettle", total: 89.0, status: "delivered", delivered_on: "2026-03-01", refunded: true, refund_reason: "wrong_item" };
  world.customers.ana_silva = { name: "Ana Silva", email: "ana@silva.example" };
  world.payments.unshift({ to: "Tom Becker", amount: 89.0, memo: "Refund A-1048", via: "operator" });
  world.tasks.unshift({ area: "admin", priority: "low", text: "file the receipts", via: "operator" });
  return world;
};
const busy = sampleDispatchOrdersCtx({ world: busyWorld() });
const many = busy.items();  // A-1041 … A-1048

// Weekdays and closing dates checked with Python's datetime: 2026-03-17 Tue, 03-08 Sun, 02-07 Sat, 02-25 Wed, 03-01 Sun;
// +30 days: 2026-04-16, 2026-03-09, 2026-03-27.
const withPayments = (payments) => sampleDispatchOrdersCtx({ world: { ...fixtureWorld(), payments } });

// The busy world plus an unrefunded Priya order with no total: her value is then unknown, not a partial sum.
const unknownTotal = (() => {
  const world = busyWorld();
  world.orders["A-1049"] = { customer: "priya_nair", items: "Gift card", status: "processing", delivered_on: null, refunded: false };
  return sampleDispatchOrdersCtx({ world });
})();
// Two vendors paid the same $700 in total: the most recent payment (first in the newest-first list) wins the tie.
const tiedVendors = withPayments([{ to: "PackRight Packaging", amount: 700, memo: "Unmatched payment", via: "dispatch" },
  { to: "Roastworks Machinery", amount: 300, memo: "Unmatched payment", via: "dispatch" }, { to: "Roastworks Machinery", amount: 400, memo: "Unmatched payment", via: "dispatch" },
  { to: "Luis Ortega", amount: 900, memo: "Refund A-1042", via: "dispatch" }]);

checkPack(pack, {
  quantity: { items: many, ctx: busy, values: [2, null, null, null, null, null, 3, null] },
  customer_orders: { items: many, ctx: busy, values: [2, 1, 1, 2, 1, 1, 2, 2] },
  // Maya 38 + 42.5; Luis's only order is refunded (0); Priya 54 + an order with no total (unknown); Tom 64 (A-1048
  // refunded); Northside 310; the unknown customer's only order has no total (unknown).
  customer_spend: { items: unknownTotal.items(), ctx: unknownTotal, values: [80.5, 0, null, 64, 310, null, 80.5, 64, null] },
  order_number: { items: orders, ctx, values: [1041, 1042, 1043, 1044, 1045, 1046] },
  refund_paid: { items: many, ctx: busy, values: [0, 249, 0, 0, 0, 0, 0, 89] },
  replies_to_customer: { items: orders, ctx, values: [0, 0, 1, 0, 0, null] },
  delivery_weekday: { items: many, ctx: busy, values: ["tuesday", "sunday", null, "saturday", null, null, "wednesday", "sunday"] },
  product_line: { items: many, ctx: busy, values: ["coffee", "equipment", "kit", "kit", "wholesale", null, "coffee", "equipment"] },
  refund_reason: { items: many, ctx: busy, values: [null, "damaged", null, null, null, null, null, "wrong_item"] },
  window_closes_on: { items: many, ctx: busy, values: ["2026-04-16", "", "", "2026-03-09", "", "", "2026-03-27", ""] },

  // A-1047: 23 days, 7 left, closes 2026-03-27. 2026-02-18 is 30 days before 2026-03-20 (0 left, closes today);
  // 2026-02-26 is 22 days before (8 left: quiet); 2026-02-17 is 31 days before (past the window: quiet).
  window_closes_soon: { ctx: busy, hit: [many[6], { ...many[6], delivered_on: "2026-02-18", days_since_delivery: 30 }],
    miss: [many[0], many[3], many[7], { ...many[6], refunded: true }, { ...many[6], delivered_on: "2026-02-26", days_since_delivery: 22 },
      { ...many[6], delivered_on: "2026-02-17", days_since_delivery: 31 }, { ...many[6], status: "in transit" }],
    message: /^The 30-day refund window closes (on 2026-03-27, in 7 days|on 2026-03-20, today) \(local advice mirroring the refund policy\)\.$/ },
  delivered_in_future: { ctx, hit: { ...orders[0], delivered_on: "2026-03-24", days_since_delivery: -4 }, miss: [orders[0], orders[2], orders[5]],
    message: /^Delivered on 2026-03-24, 4 days after the world's date 2026-03-20\.$/ },
  delivery_date_problem: { ctx, hit: [orders[5], { ...orders[0], delivered_on: "2026-02-31" }, { ...orders[0], delivered_on: null }, { ...orders[2], delivered_on: "2026-03-10" }],
    miss: [orders[0], orders[2], orders[4]],
    message: /^(Delivery date "(soon|2026-02-31)" is not a real YYYY-MM-DD date\.|Marked delivered with no delivery date\.|Has a delivery date \(2026-03-10\) but its status is "in transit"\.)$/ },
  refund_mismatch: { ctx, hit: [{ ...orders[1], total: 250 }, { ...orders[0], refunded: true }], miss: [orders[1], orders[0]],
    message: /^(Refund payments add up to \$249\.00; the order total is \$250\.00\.|Marked refunded, but this world's payments list holds no refund for it\.)$/ },
  refund_not_marked: { ctx, hit: { ...orders[1], refunded: false }, miss: [orders[0], orders[1]], message: /holds a refund for A-1042, but the order is not marked refunded/ },
  unknown_refund_order: { ctx: withPayments([{ to: "Ana Silva", amount: 12, memo: "Refund A-9999", via: "dispatch" }, ...fixtureWorld().payments]),
    missCtx: ctx, hitList: orders, missList: orders, message: /^A refund payment of \$12\.00 names order A-9999, which is not in the orders list\.$/ },

  // Vendor payments in the fixture: Coastline Freight $500 (no invoice) and Bean Brokers Ltd $1,200; the third is a refund.
  // tiedVendors: PackRight 700 vs Roastworks 300 + 400 = 700; the $900 refund to a customer is not a vendor payment.
  top_vendor_paid: [{ ctx, expect: "Bean Brokers Ltd ($1,200.00)", empty: empty() }, { ctx: tiedVendors, expect: "PackRight Packaging ($700.00)" },
    { ctx: withPayments([{ to: "Luis Ortega", amount: 249, memo: "Refund A-1042" }]), expect: null }],
  // Fixture: PackRight, Sparkle Facility, Roastworks; tiedVendors: Bean Brokers, Coastline, Sparkle Facility.
  vendors_unpaid: [{ ctx, expect: 3, empty: empty() }, { ctx: tiedVendors, expect: 3 }, { ctx: withPayments([]), expect: 5 }],
  customers_without_orders: [{ ctx, expect: 0, empty: empty() }, { ctx: busy, expect: 1 }],
  // Only A-1041 ($38) is delivered, unrefunded and inside 30 days: 16,451 - 38. In the busy world A-1047 ($42.50) joins it.
  balance_after_window_refunds: [{ ctx, expect: 16413, empty: empty() },
    { ctx: busy, expect: (result) => assert.deepEqual(result, { value: 16370.5, detail: "2 orders, $80.50" }) }],
}, { ctx: () => sampleDispatchOrdersCtx() });
