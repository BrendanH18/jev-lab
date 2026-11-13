import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-activity-log.js";
import { fixtureWorld, sampleDispatchActivityCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture's log, newest first: #7 $500 payment (no invoice), #6 reply, #5 urgent task, #4 calendar move,
// #3 $1,200 payment (INV-7790), #2 $249 refund (A-1042), #1 an entry with no kind or via. Balance $16,451.
// Line formats follow jev/world.py's _do_* methods; reference values below are read off the fixture text by hand.
const ctx = sampleDispatchActivityCtx();
const items = ctx.items();
const empty = () => sampleDispatchActivityCtx({ world: { ...fixtureWorld(), activity: [] } });
const only = (...kinds) => sampleDispatchActivityCtx({ matches: (id, item) => kinds.includes(item.kind) });
const withLog = (activity, extra = {}) => sampleDispatchActivityCtx({ world: { ...fixtureWorld(), activity, ...extra } });
const URGENT = "New equipment task (urgent): the grinder in the tasting room is jammed again, get it looked at asap";
const wrongItem = { ...items[5], n: 9, text: "Refunded $38.00 for A-1041 (wrong_item)" };          // no "Refund A-1041" payment on file
const noReason = { ...items[5], n: 10, text: "Refunded $64.00 for A-1044 (None)" };                // Python's "%s" % None
const adminTask = { ...items[2], n: 9, text: "New admin task (normal): book the van" };
const nestedTask = { ...items[2], n: 10, text: "New shipping task (low): retry task (urgent): label printer" };  // the header wins
const returnReply = { ...items[1], n: 9, text: "Sent “Return policy” to maya.chen@mail.example" };
const quotedPayment = { ...items[0], n: 11, text: "Paid $10.00 to “Odd” to x (no invoice)" };          // a payment, not a reply

checkPack(pack, {
  kind: { items, ctx, values: ["payment", "reply", "task", "calendar", "payment", "refund", null] },
  amount: { items, ctx, values: [500, null, null, null, 1200, 249, null] },
  money: { items, ctx, values: [true, false, false, false, true, true, false] },
  text: { items, ctx, values: ["Paid $500.00 to Coastline Freight (no invoice)", "Sent “Wholesale pricing” to priya@nairdesign.example", URGENT,
    "Moved “Weekly team sync” from Wednesday 09:00 to Friday 11:00", "Paid $1,200.00 to Bean Brokers Ltd (INV-7790)", "Refunded $249.00 for A-1042 (damaged)", "Imported note"] },
  number: { items, ctx, values: [7, 6, 5, 4, 3, 2, 1] },
  reference: { items, ctx, values: ["", "", "", "", "INV-7790", "A-1042", ""] },
  refund_reason: { items: [items[5], wrongItem, noReason, items[0]], ctx, values: ["damaged", "wrong item", null, null] },
  task_area: { items: [items[2], adminTask, nestedTask, items[0]], ctx, values: ["equipment", "admin", "shipping", null] },
  task_priority: { items: [items[2], adminTask, nestedTask, items[0]], ctx, values: ["urgent", "normal", "low", null] },
  reply_template: { items: [items[1], returnReply, quotedPayment, items[6]], ctx, values: ["Wholesale pricing", "Return policy", null, null] },
  // #2's payee comes from data.payments ({ to: "Luis Ortega", memo: "Refund A-1042" }); A-1041 has no refund payment.
  counterparty: { items: [...items, wrongItem], ctx, values: ["Coastline Freight", "priya@nairdesign.example", "", "", "Bean Brokers Ltd", "Luis Ortega", "", ""] },

  unmatched_payment: { ctx, hit: items[0], miss: [items[4], items[1], { ...items[1], text: "Sent “x” (no invoice)" }] },
  repeated: { ctx, hitList: [items[0], { ...items[0], n: 8 }], missList: items,
    message: /^"Paid \$500\.00 to Coastline Freight \(no invoice\)" appears 2 times \(#7, #8\)/ },

  // 500 + 1,200 + 249 = 1,949; refunds 249; payments 500 + 1,200 = 1,700; balance before 16,451 + 1,949 = 18,400.
  money_out: [{ ctx, expect: 1949, empty: empty() }, { ctx: only("refund"), expect: 249 }, { ctx: only("task", "reply"), expect: 0 }],
  refunds_total: [{ ctx, expect: 249, empty: empty() }, { ctx: only("payment"), expect: 0 }],
  payments_total: [{ ctx, expect: 1700, empty: empty() }, { ctx: only("refund"), expect: 0 }],
  balance_before: [{ ctx, expect: 18400, empty: empty() }, { ctx: only("task"), expect: 18400 },
    { ctx: withLog(fixtureWorld().activity, { balance: null }), expect: null }],

  log_text: { ctx, filename: "harbor-activity.txt",
    text: ["#1 Imported note", "#2 Refunded $249.00 for A-1042 (damaged)", "#3 Paid $1,200.00 to Bean Brokers Ltd (INV-7790)",
      "#4 Moved “Weekly team sync” from Wednesday 09:00 to Friday 11:00", `#5 ${URGENT}`, "#6 Sent “Wholesale pricing” to priya@nairdesign.example",
      "#7 Paid $500.00 to Coastline Freight (no invoice)"].join("\n") + "\n",
    check: () => assert.equal(pack.features.find((entry) => entry.id === "log_text").build(empty()), "No activity is shown.\n") },
  activity_csv: { ctx: only("refund", "payment"), filename: "harbor-activity.csv",
    text: '"entry","kind","text","amount_usd","via"\r\n"2","refund","Refunded $249.00 for A-1042 (damaged)","249.00","dispatch"\r\n'
      + '"3","payment","Paid $1,200.00 to Bean Brokers Ltd (INV-7790)","1200.00","dispatch"\r\n"7","payment","Paid $500.00 to Coastline Freight (no invoice)","500.00","dispatch"\r\n',
    check: () => {
      const feature = pack.features.find((entry) => entry.id === "activity_csv");
      assert.equal(feature.build(empty()), '"entry","kind","text","amount_usd","via"\r\n', "an empty log gives the header only");
    } },
  activity_markdown: { ctx: sampleDispatchActivityCtx({ matches: (id, item) => item.kind === "task" || item.kind === null }), filename: "harbor-activity.md",
    text: `| # | Kind | Entry |\n| --- | --- | --- |\n| 5 | task | ${URGENT} |\n| 1 |  | Imported note |\n`,
    check: () => {
      const feature = pack.features.find((entry) => entry.id === "activity_markdown");
      const piped = withLog([{ kind: "task", text: "New admin task (low): label | box", via: "dispatch" }]);
      assert.equal(feature.build(piped), "| # | Kind | Entry |\n| --- | --- | --- |\n| 1 | task | New admin task (low): label \\| box |\n", "a pipe in command text is escaped");
    } },

  copy_latest: {
    ctx: () => sampleDispatchActivityCtx({ matches: () => false }),
    check: (c) => {
      assert.deepEqual(c.env.copied, ["Paid $500.00 to Coastline Freight (no invoice)"], "the latest entry, even when filters hide it");
      assert.equal(c.env.toasts[0].message, "Copied entry #7.");
      assert.deepEqual(c.recorded, [], "copying runs nothing");
    },
    hidden: empty,
  },
}, { ctx: () => sampleDispatchActivityCtx() });
