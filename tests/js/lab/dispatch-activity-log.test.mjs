import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-activity-log.js";
import { fixtureWorld, sampleDispatchActivityCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture's log, newest first: #7 $500 payment (no invoice), #6 reply, #5 urgent task, #4 calendar move,
// #3 $1,200 payment (INV-7790), #2 $249 refund (A-1042), #1 an entry with no kind or via. Balance $16,451.
const ctx = sampleDispatchActivityCtx();
const items = ctx.items();
const empty = () => sampleDispatchActivityCtx({ world: { ...fixtureWorld(), activity: [] } });
const only = (...kinds) => sampleDispatchActivityCtx({ matches: (id, item) => kinds.includes(item.kind) });
const URGENT = "New equipment task (urgent): the grinder in the tasting room is jammed again, get it looked at asap";

checkPack(pack, {
  kind: { items, ctx, values: ["payment", "reply", "task", "calendar", "payment", "refund", null] },
  amount: { items, ctx, values: [500, null, null, null, 1200, 249, null] },
  money: { items, ctx, values: [true, false, false, false, true, true, false] },
  text: { items, ctx, values: ["Paid $500.00 to Coastline Freight (no invoice)", "Sent “Wholesale pricing” to priya@nairdesign.example", URGENT,
    "Moved “Weekly team sync” from Wednesday 09:00 to Friday 11:00", "Paid $1,200.00 to Bean Brokers Ltd (INV-7790)", "Refunded $249.00 for A-1042 (damaged)", "Imported note"] },
  number: { items, ctx, values: [7, 6, 5, 4, 3, 2, 1] },
  via: { items: [items[0], items[6], { ...items[0], n: 8, via: "operator" }], ctx, values: ["dispatch", null, "operator"] },
  reference: { items, ctx, values: ["", "", "", "", "INV-7790", "A-1042", ""] },
  task_priority: { items: [items[2], { ...items[2], n: 9, text: "New admin task (normal): book the van" }, items[0]], ctx, values: ["urgent", "normal", null] },
  counterparty: { items, ctx, values: ["Coastline Freight", "priya@nairdesign.example", "", "", "Bean Brokers Ltd", "", ""] },

  unmatched_payment: { ctx, hit: items[0], miss: [items[4], items[1]] },
  repeated: { ctx, hitList: [items[0], { ...items[0], n: 8 }], missList: items,
    message: /^"Paid \$500\.00 to Coastline Freight \(no invoice\)" appears 2 times \(#7, #8\)/ },
  no_kind: { ctx, hit: items[6], miss: items[0] },

  money_out: [{ ctx, expect: 1949, empty: empty() }, { ctx: only("refund"), expect: 249 }],
  refunds_total: [{ ctx, expect: 249, empty: empty() }, { ctx: only("payment"), expect: 0 }],
  payments_total: [{ ctx, expect: 1700, empty: empty() }, { ctx: only("refund"), expect: 0 }],
  tasks_created: [{ ctx, expect: 1, empty: empty() }, { ctx: only("refund", "payment"), expect: 0 }],
  replies_sent: [{ ctx, expect: 1, empty: empty() }, { ctx: only("task"), expect: 0 }],
  calendar_moves: [{ ctx, expect: 1, empty: empty() }, { ctx: only("task"), expect: 0 }],
  balance_before: [{ ctx, expect: 18400, empty: empty() }, { ctx: only("task"), expect: 18400 }],

  log_text: { ctx, filename: "harbor-activity.txt",
    text: ["#1 Imported note", "#2 Refunded $249.00 for A-1042 (damaged)", "#3 Paid $1,200.00 to Bean Brokers Ltd (INV-7790)",
      "#4 Moved “Weekly team sync” from Wednesday 09:00 to Friday 11:00", `#5 ${URGENT}`, "#6 Sent “Wholesale pricing” to priya@nairdesign.example",
      "#7 Paid $500.00 to Coastline Freight (no invoice)"].join("\n") + "\n" },
  activity_csv: { ctx: only("refund", "payment"), filename: "harbor-activity.csv",
    text: '"entry","kind","text","amount_usd","via"\r\n"2","refund","Refunded $249.00 for A-1042 (damaged)","249.00","dispatch"\r\n'
      + '"3","payment","Paid $1,200.00 to Bean Brokers Ltd (INV-7790)","1200.00","dispatch"\r\n"7","payment","Paid $500.00 to Coastline Freight (no invoice)","500.00","dispatch"\r\n' },
  activity_markdown: { ctx: sampleDispatchActivityCtx({ matches: (id, item) => item.kind === "task" || item.kind === null }), filename: "harbor-activity.md",
    text: `| # | Kind | Entry |\n| --- | --- | --- |\n| 5 | task | ${URGENT} |\n| 1 |  | Imported note |\n` },

  copy_latest: {
    ctx: () => sampleDispatchActivityCtx({ matches: () => false }),
    check: (c) => {
      assert.deepEqual(c.env.copied, ["Paid $500.00 to Coastline Freight (no invoice)"], "the latest entry, even when filters hide it");
      assert.equal(c.env.toasts[0].message, "Copied entry #7.");
    },
    hidden: empty,
  },
}, { ctx: () => sampleDispatchActivityCtx() });
