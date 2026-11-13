import assert from "node:assert/strict";
import { test } from "node:test";

import { runExporter } from "../../../static/js/lab/kit.js";
import pack from "../../../static/js/lab/packs/claims/claims-orders-more.js";
import { checkPack } from "./harness.mjs";
import { CLAIMS_POLICY, sampleClaimsHistory, sampleClaimsOrdersCtx } from "./fixtures/claims.mjs";

// The fixture's seven orders: A-1041 ($38, delivered 3 days ago), A-1042 ($249, 12 days), A-1043 ($54, in transit),
// A-1044 ($64, 41 days, selected), A-1045 ($310, processing), A-1046 ($72.50, 30 days, refunded), A-1047 (no total,
// customer or delivery; processing). The automatic limit in the sliders is $100 and the refund window 30 days.
// This session's checks: A-1041 twice (approve $38 at $0.000398, then retake $19 at $0.000401), A-1042 once (review
// $249, $0.000356), A-1044 once (review $32, $0.000412).
const page = sampleClaimsOrdersCtx();
const items = page.items();
const only = (...ids) => sampleClaimsOrdersCtx({ matches: (item) => ids.includes(item.id) });
const exporter = (id) => pack.features.find((feature) => feature.id === id);

// The latest check on A-1044 saw the order refunded: the picker's record (loaded earlier) still says it is not.
function staleCtx() {
  const history = sampleClaimsHistory();
  history[3] = { ...history[3], facts: { ...history[3].facts, refunded: true } };
  return sampleClaimsOrdersCtx({ history });
}
const stale = staleCtx();

checkPack(pack, {
  // $100 minus 38, 249, 54, 64, 310, 72.50; A-1047 has no total.
  limit_headroom: { items, values: [62, -149, 46, 36, -210, 27.5, null], ctx: page },
  // A-1041: inside the window, $19 credit within $100. A-1042: $124.50 credit over the limit. A-1044: 41 days, outside.
  // A-1043, A-1045, A-1047 not delivered and A-1046 refunded: reject. An order with no status is unknown.
  best_case: { items: [...items, { id: "X", status: "", delivered: false, refunded: false }],
    values: ["approve possible", "review at best", "reject", "review at best", "reject", "reject", "reject", null], ctx: page },
  // Credits 19, 124.50, 27, 32, 155, 36.25 against $100; A-1047 has none.
  credit_within_limit: { items, values: [true, false, true, true, false, true, false], ctx: page },
  latest_decision: { items, values: ["retake", "review", null, "review", null, null, null], ctx: page },
  // 0.000398 + 0.000401 for A-1041
  session_cost: { items, values: [0.000799, 0.000356, null, 0.000412, null, null, null], ctx: page, tolerance: 1e-12 },

  stale_record: { hit: stale.items()[3], miss: [stale.items()[0], stale.items()[2]], ctx: stale,
    message: /^your check #4 saw refunded yes; the picker's record, loaded with the page, says refunded no\. / },
  // 30 - 27 = 3 days left is the last day that warns; 30 - 26 = 4 does not.
  window_closing: { hit: [{ delivered: true, refunded: false, within_window: true, days_since_delivery: 28 }, { delivered: true, refunded: false, within_window: true, days_since_delivery: 30 },
    { delivered: true, refunded: false, within_window: true, days_since_delivery: 27 }],
  miss: [items[0], items[5], items[3], items[2], { delivered: true, refunded: false, within_window: true, days_since_delivery: 26 }],
  message: /^the 30-day refund window closes (in 2 days|today|in 3 days) \(delivered (28|30|27) days ago\)\.$/ },
  incomplete_record: { hit: items[6], miss: [items[0], items[2]], message: /^the record has no total or customer: refund amounts cannot be worked out\.$/ },
  checked_unclaimable: { hit: [{ checked: 1, refunded: false, status: "in transit", delivered: false }, { checked: 2, refunded: true, status: "delivered", delivered: true }],
    miss: [items[2], items[0], items[5]], message: /^(1 paid check this session on an order that is in transit|2 paid checks this session on an order that is already refunded)/ },
  // Without A-1041 no shown order is left that could be approved automatically.
  no_auto_approval: { hitList: items.slice(1), missList: items, ctx: page, message: /^none of the 6 shown orders could be approved automatically/ },

  orders_json: { ctx: only("A-1047", "A-1046"), filename: "claims-orders.json",
    text: `${JSON.stringify([
      { id: "A-1046", items: "Pour-over kettle", customer: "Ada Brook", total: 72.5, status: "delivered", days_since_delivery: 30, refunded: true },
      { id: "A-1047", items: "Gift card", customer: "", total: null, status: "processing", days_since_delivery: null, refunded: false },
    ], null, 2)}\n` },
  readiness_markdown: { ctx: page, filename: "claims-order-readiness.md",
    includes: ["| order | total | 50% credit | days left in window | full refund ≤ $100.00 | credit ≤ $100.00 | best case (advisory) |",
      "| A-1041 | $38.00 | $19.00 | 27 | yes | yes | approve possible |", "| A-1042 | $249.00 | $124.50 | 18 | no | no | review at best |",
      "| A-1044 | $64.00 | $32.00 | -11 | yes | yes | review at best |", "| A-1046 | $72.50 | $36.25 | 0 | yes | yes | reject |"],
    check: (out) => assert.equal(out.text.trim().split("\n").length, 9) },
  session_by_order_csv: { ctx: only("A-1041", "A-1043", "A-1044"), filename: "claims-session-by-order.csv", excludes: ["torn", "beans", "crushed-box"],
    text: ['"order","checks","latest_decision_when_sent","latest_amount_when_sent","measured_cost_usd"', '"A-1041","2","retake","19.00","0.000799"',
      '"A-1043","0","","",""', '"A-1044","1","review","32.00","0.000412"', ""].join("\r\n") },
  selected_order_text: { ctx: page, filename: "order-A-1044.txt",
    text: "Order A-1044 (record as loaded with the page)\nItems: Cold brew starter kit\nCustomer: Tom Becker\nTotal: $64.00\n"
      + "Status: delivered 41 days ago, outside the 30-day refund window\nRefunded: no\n",
    check: () => {
      const gift = runExporter(exporter("selected_order_text"), sampleClaimsOrdersCtx({ order: "A-1047" }));
      assert.equal(gift.text, "Order A-1047 (record as loaded with the page)\nItems: Gift card\nCustomer: unknown\nTotal: unknown\nStatus: processing\nRefunded: no\n");
      assert.throws(() => runExporter(exporter("selected_order_text"), sampleClaimsOrdersCtx({ setup: null })), /No order is selected/);
    } },
}, { ctx: () => sampleClaimsOrdersCtx() });

// The readiness facts follow the sliders now: at a $15 limit A-1041's $19 credit is over it, at $0 every total is.
test("claims-orders-more: headroom, credit and best case follow the automatic limit in the sliders", () => {
  const low = sampleClaimsOrdersCtx({ settings: { ...CLAIMS_POLICY, auto_limit_usd: 15 } });
  const fact = (id) => pack.features.find((feature) => feature.id === id);
  const a1041 = low.items()[0];
  assert.equal(fact("limit_headroom").value(a1041, low), -23);
  assert.equal(fact("credit_within_limit").value(a1041, low), false);
  assert.equal(fact("best_case").value(a1041, low), "review at best");
  // Before the setup has loaded there are no sliders: nothing is worked out.
  const before = sampleClaimsOrdersCtx({ setup: null });
  assert.equal(fact("limit_headroom").value(items[0], before), null);
  assert.equal(fact("best_case").value(items[0], before), null);
  assert.equal(fact("credit_within_limit").value(items[0], before), false);
});
