import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-order-desk.js";
import { sampleDispatchOrdersCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture world's orders, in order: A-1041 (Maya, delivered 3 days ago), A-1042 (Luis, refunded), A-1043 (Priya,
// in transit), A-1044 (Tom, delivered 41 days ago), A-1045 (Northside, processing, wholesale), A-1046 (no details).
const ctx = sampleDispatchOrdersCtx();
const items = ctx.items();
const empty = () => sampleDispatchOrdersCtx({ world: null });
const hideRefunded = () => sampleDispatchOrdersCtx({ matches: (id, item) => !item.refunded });

checkPack(pack, {
  total: { items, ctx, values: [38, 249, 54, 64, 310, null] },
  days_since_delivery: { items, ctx, values: [3, 12, null, 41, null, null] },
  window_days_left: { items, ctx, values: [27, 18, null, -11, null, null] },
  refunded: { items, ctx, values: [false, true, false, false, false, false] },
  in_window: { items, ctx, values: [true, false, false, false, false, false] },
  status: { items, ctx, values: ["delivered", "refunded", "in transit", "delivered", "processing", null] },
  customer: { items, ctx, values: ["Maya Chen", "Luis Ortega", "Priya Nair", "Tom Becker", "Northside Bistro", null] },
  items: { items, ctx, values: ["2 x Ethiopia Yirgacheffe, 12 oz bags", "Conical burr grinder", "Espresso sampler box", "Cold brew starter kit", "20 lb House Blend (wholesale)", ""] },
  wholesale: { items, ctx, values: [false, false, false, false, true, false] },
  email_domain: { items, ctx, values: ["mail.example", "mail.example", "nairdesign.example", "mail.example", "northsidebistro.example", null] },
  plan_target: { items, ctx, values: [true, false, false, false, false, false] },

  outside_window: { ctx, hit: items[3], miss: [items[0], items[1], items[2], items[4]], message: /41 days ago, past the 30-day window/ },
  not_shipped: { ctx, hit: items[4], miss: [items[0], items[2], { ...items[4], refunded: true }], message: /cancel/ },
  missing_details: { ctx, hit: items[5], miss: items[0], message: /^Missing customer, total, status, items\.$/ },
  repeat_customer: { ctx, hitList: [items[0], { ...items[0], id: "A-1050" }], missList: items, message: /Maya Chen has 2 open orders \(A-1041, A-1050\)/ },

  open_value: [{ ctx, expect: 466, empty: empty() }, { ctx: hideRefunded(), expect: 466 }],
  refunded_value: { ctx, expect: 249, empty: empty() },
  refund_share: { ctx, expect: 1 / 6, empty: empty() },
  average_total: [{ ctx, expect: 715 / 5, empty: empty() }, { ctx: hideRefunded(), expect: 466 / 4 }],
  refundable_now: [{ ctx, expect: 1, empty: empty() }, { ctx: sampleDispatchOrdersCtx({ world: { ...ctx.state.world, today: "2026-04-20" } }), expect: 0 }],

  orders_csv: { ctx: hideRefunded(), filename: "harbor-orders.csv",
    includes: ['"order","customer","items","status","total_usd","delivered_on","refunded"\r\n',
      '"A-1041","Maya Chen","2 x Ethiopia Yirgacheffe, 12 oz bags","delivered","38.00","2026-03-17","no"\r\n',
      '"A-1046","","","","","soon","no"\r\n'],
    excludes: ["A-1042", "mail.example"] },
  orders_markdown: { ctx, filename: "harbor-orders.md",
    text: ["| Order | Customer | Items | Status | Total |", "| --- | --- | --- | --- | --- |",
      "| A-1041 | Maya Chen | 2 x Ethiopia Yirgacheffe, 12 oz bags | delivered | $38.00 |",
      "| A-1042 | Luis Ortega | Conical burr grinder | refunded | $249.00 |",
      "| A-1043 | Priya Nair | Espresso sampler box | in transit | $54.00 |",
      "| A-1044 | Tom Becker | Cold brew starter kit | delivered | $64.00 |",
      "| A-1045 | Northside Bistro | 20 lb House Blend (wholesale) | processing | $310.00 |",
      "| A-1046 |  |  |  |  |"].join("\n") + "\n" },

  draft_refund: {
    ctx: () => sampleDispatchOrdersCtx({ matches: (id, item) => item.id !== "A-1041" }),
    check: (c) => {
      assert.deepEqual(c.recorded, [["draftCommand", "refund order A-1043 for Priya Nair"]]);
      assert.equal(c.state.draft, "refund order A-1043 for Priya Nair");
      assert.equal(c.recorded.some(([name]) => name === "runPlan" || name === "preview"), false, "drafting runs nothing");
    },
    hidden: () => sampleDispatchOrdersCtx({ matches: (id, item) => item.refunded || item.status === "processing" }),
  },
  copy_ids: {
    ctx: () => sampleDispatchOrdersCtx(),
    check: (c) => {
      assert.deepEqual(c.env.copied, ["A-1041, A-1042, A-1043, A-1044, A-1045, A-1046"]);
      assert.equal(c.env.toasts[0].message, "Copied 6 order numbers.");
    },
    hidden: empty,
  },
  copy_emails: {
    ctx: () => sampleDispatchOrdersCtx({ matches: (id, item) => item.id !== "A-1043" }),
    check: (c) => assert.deepEqual(c.env.copied, ["maya.chen@mail.example\nlortega@mail.example\ntom.becker@mail.example\norders@northsidebistro.example"]),
    hidden: empty,
  },
}, { ctx: () => sampleDispatchOrdersCtx() });
