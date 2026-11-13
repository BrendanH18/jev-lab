import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/claims/claims-order-desk.js";
import { checkPack } from "./harness.mjs";
import { sampleClaimsHistory, sampleClaimsOrdersCtx } from "./fixtures/claims.mjs";

// The fixture's seven orders: A-1041 ($38, delivered 3 days ago), A-1042 ($249, 12 days), A-1043 ($54, in transit),
// A-1044 ($64, 41 days, selected), A-1045 ($310, processing), A-1046 ($72.50, 30 days, refunded), A-1047 (no total,
// processing). The automatic limit is $100 and the refund window 30 days.
const page = sampleClaimsOrdersCtx();
const items = page.items();
const only = (...ids) => sampleClaimsOrdersCtx({ matches: (item) => ids.includes(item.id) });

checkPack(pack, {
  total: { items, values: [38, 249, 54, 64, 310, 72.5, null], ctx: page },
  days_since_delivery: { items, values: [3, 12, null, 41, null, 30, null], ctx: page },
  // 30 - 3, 30 - 12, -, 30 - 41, -, 30 - 30, -
  days_left: { items, values: [27, 18, null, -11, null, 0, null], ctx: page },
  credit_amount: { items, values: [19, 124.5, 27, 32, 155, 36.25, null], ctx: page },
  checked: { items, values: [2, 1, 0, 1, 0, 0, 0], ctx: page },
  status: { items, values: ["delivered", "delivered", "in transit", "delivered", "processing", "delivered", "processing"], ctx: page },
  customer: { items, values: ["Maya Chen", "Luis Ortega", "Priya Nair", "Tom Becker", "Northside Bistro", "Ada Brook", ""], ctx: page },
  items: { items, values: ["2 x Ethiopia Yirgacheffe, 12 oz bags", "Conical burr grinder", "Espresso sampler box", "Cold brew starter kit",
    "20 lb House Blend (wholesale)", "Pour-over kettle", "Gift card"], ctx: page },
  refunded: { items, values: [false, false, false, false, false, true, false], ctx: page },
  open_to_claim: { items, values: [true, true, false, true, false, false, false], ctx: page },

  refunded_check: { hit: items[5], miss: [items[0], items[3]], message: /rejected/ },
  not_delivered_check: { hit: [items[2], items[4], items[6]], miss: [items[0], items[5]], message: /^the order is (in transit|processing); damage claims start after delivery\.$/ },
  // A-1046 sits exactly on day 30 (inside); a refunded order past the window is rejected anyway, so it stays quiet.
  outside_window_check: { hit: items[3], miss: [items[0], items[2], items[5], { ...items[3], refunded: true }],
    message: /^delivered 41 days ago, past the 30-day window: the window rule keeps a claim from automatic approval/, ctx: page },
  // Half of $249 is $124.50 > $100. The $310 wholesale order ($155 half) is still processing, so it is rejected anyway;
  // half of $64 ($32) and $38 ($19) fit, and A-1047 has no total.
  credit_over_limit_check: { hit: items[1], miss: [items[0], items[3], items[4], items[6]],
    message: /^\$124\.50 against a \$100\.00 limit: neither remedy fits the automatic limit/, ctx: page },

  // A-1041, A-1042 and A-1044 are delivered and not refunded; hiding A-1041 leaves two.
  open_count: [{ ctx: page, expect: 3, empty: sampleClaimsOrdersCtx({ setup: null }) },
    { ctx: sampleClaimsOrdersCtx({ matches: (item) => item.id !== "A-1041" }), expect: 2 }],
  // 38 + 249 + 54 + 64 + 310 + 72.50 = 787.50; A-1047 has no total.
  shown_value: [{ ctx: page, expect: 787.5, empty: sampleClaimsOrdersCtx({ setup: null }) }, { ctx: only("A-1046", "A-1047"), expect: 72.5 }],
  // (3 + 12 + 41 + 30) / 4 = 21.5; without A-1044 (3 + 12 + 30) / 3 = 15.
  mean_delivery_age: [{ ctx: page, expect: 21.5, empty: sampleClaimsOrdersCtx({ setup: null }) },
    { ctx: sampleClaimsOrdersCtx({ matches: (item) => item.id !== "A-1044" }), expect: 15 }],
  // A-1041 (calls 1 and 2), A-1042 (call 3) and A-1044 (call 4); with only call 3 kept, just A-1042.
  orders_checked: [{ ctx: page, expect: 3, empty: sampleClaimsOrdersCtx({ history: [], calls: 0 }) },
    { ctx: sampleClaimsOrdersCtx({ history: sampleClaimsHistory().slice(2, 3), calls: 1 }), expect: 1 }],

  orders_csv: { ctx: only("A-1041", "A-1047"), filename: "claims-orders.csv",
    text: "\"order\",\"customer\",\"items\",\"total_usd\",\"status\",\"days_since_delivery\",\"refunded\"\r\n"
      + "\"A-1041\",\"Maya Chen\",\"2 x Ethiopia Yirgacheffe, 12 oz bags\",\"38.00\",\"delivered\",\"3\",\"no\"\r\n"
      + "\"A-1047\",\"\",\"Gift card\",\"\",\"processing\",\"\",\"no\"\r\n" },
  orders_markdown: { ctx: only("A-1046", "A-1047"), filename: "claims-orders.md",
    text: "| order | customer | items | total_usd | status | days_since_delivery | refunded |\n"
      + "| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| A-1046 | Ada Brook | Pour-over kettle | 72.50 | delivered | 30 | yes |\n"
      + "| A-1047 |  | Gift card |  | processing |  | no |\n" },

  // A-1044 is selected: the next order is A-1045, the previous A-1043.
  next_order: { ctx: () => sampleClaimsOrdersCtx(), check: (ctx) => { assert.deepEqual(ctx.log, [["select", "A-1045"]]); assert.equal(ctx.state.result, null); },
    hidden: () => sampleClaimsOrdersCtx({ running: true }) },
  previous_order: { ctx: () => sampleClaimsOrdersCtx({ order: "A-1041" }), check: (ctx) => assert.deepEqual(ctx.log, [["select", "A-1047"]]),
    hidden: () => sampleClaimsOrdersCtx({ matches: () => false }) },
  first_open_order: { ctx: () => sampleClaimsOrdersCtx({ matches: (item) => item.id !== "A-1041" }), check: (ctx) => assert.deepEqual(ctx.log, [["select", "A-1042"]]),
    hidden: () => sampleClaimsOrdersCtx({ matches: (item) => !item.delivered }) },
  focus_picker: { ctx: () => sampleClaimsOrdersCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["focusOrder"]]), hidden: () => sampleClaimsOrdersCtx({ running: true }) },
}, { ctx: () => sampleClaimsOrdersCtx() });
