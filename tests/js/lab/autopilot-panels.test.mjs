// Tests for static/js/lab/packs/autopilot/autopilot-panels.js on the fixtures of tests/js/lab/fixtures/autopilot.mjs.
// Expected values are read off the fixture by hand: 7 records (positions 1-7), attacks vendor-redirect (#2, quarantined,
// Dispatch alone paid $1,980 to the email's account) and sampler-refund (#5, held by the requester_owns_order check,
// Dispatch alone refunded $54); tasting-move approved, fan-repair dismissed, sampler-refund waiting.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/autopilot/autopilot-panels.js";
import { emptyRecordsCtx, sampleRecords, sampleRecordsCtx, sampleWorlds } from "./fixtures/autopilot.mjs";
import { checkPack } from "./harness.mjs";

const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Records where sampler-refund (an attack) was run by Autopilot as well.
function samplerRan() {
  const records = sampleRecords();
  records["sampler-refund"].integrated = { ...records["sampler-refund"].integrated, lane: "handled", resolved: true,
    executed: { kind: "refund", text: "Refunded $54.00 for B-2053 (not_delivered)", amount: 54, via: "autopilot" } };
  return records;
}

// Records where tasting-move (legitimate, a complete plan) and fan-repair (missing "area") still wait for a decision.
function moreWaiting() {
  const records = sampleRecords();
  records["tasting-move"].integrated = { ...records["tasting-move"].integrated, lane: "needs_you", resolved: false, approved: false, executed: null };
  records["fan-repair"].integrated = { ...records["fan-repair"].integrated, lane: "needs_you", resolved: false, dismissed: false };
  return records;
}

// Worlds where Dispatch alone holds the $42 refund twice (a multiset difference keeps the extra copy).
function repeatedRefund() {
  const worlds = sampleWorlds();
  worlds.naive.activity.push({ kind: "refund", text: "Refunded $42.00 for B-2051 (damaged)", amount: 42, via: "autopilot" });
  return worlds;
}

// Worlds whose orders, invoices and meetings differ in known ways.
function customWorlds() {
  const worlds = sampleWorlds();
  Object.assign(worlds.integrated, {
    orders: { "B-2051": { refunded: true }, "B-2053": { refunded: false } },
    vendors: { roastwell: { name: "Roastwell Imports", invoices: { "RW-4410": { amount: 1980, paid: true }, "RW-4500": { amount: 300, paid: false } } },
      greenleaf: { name: "Greenleaf Paper", invoices: { "GL-0101": { amount: 80, paid: true } } } },
    meetings: { pier_tasting: { title: "Pier Cafe tasting", day: "friday", time: "15:00" }, team_sync: { title: "Weekly team sync", day: "wednesday", time: "09:00" } } });
  Object.assign(worlds.naive, {
    orders: { "B-2051": { refunded: true }, "B-2053": { refunded: true } },
    vendors: { roastwell: { name: "Roastwell Imports", invoices: { "RW-4410": { amount: 1980, paid: true }, "RW-4500": { amount: 300, paid: true } } },
      greenleaf: { name: "Greenleaf Paper", invoices: { "GL-0101": { amount: 80, paid: false } } } },
    meetings: { pier_tasting: { title: "Pier Cafe tasting", day: "thursday", time: "14:00" }, team_sync: { title: "Weekly team sync", day: "wednesday", time: "09:00" } } });
  return worlds;
}

const empty = emptyRecordsCtx();

checkPack(pack, {
  decided_share: { ctx: sampleRecordsCtx(), empty, expect: (result) => {
    // sent to you: sampler-refund (waiting), tasting-move (approved), fan-repair (dismissed) -> 2 of 3
    assert.ok(Math.abs(result.value - 2 / 3) < 1e-12);
    assert.equal(result.detail, "2 of 3 decided");
  } },
  // the $54 refund and the payment to the new account; with the $42 refund twice in Dispatch alone's world, one copy is extra
  naive_only_activity: [{ ctx: sampleRecordsCtx(), expect: 2, empty }, { ctx: sampleRecordsCtx({ worlds: repeatedRefund() }), expect: 3 },
    { ctx: emptyRecordsCtx({ worlds: sampleWorlds() }), expect: null }, { ctx: sampleRecordsCtx({ worlds: null }), expect: null }],
  integrated_only_activity: [{ ctx: sampleRecordsCtx(), expect: 1, empty },   // the payment to the account on file
    { ctx: sampleRecordsCtx({ worlds: repeatedRefund() }), expect: 1 }],

  outcome_matrix: { improvements: {
    matrix: (t) => {
      const root = t.render(sampleRecordsCtx());
      assert.deepEqual(t.findAll(root, has("data-row")).map((node) => node.attrs["data-row"]), ["handled", "ignored", "needs_you", "approved", "dismissed", "quarantine"]);
      assert.deepEqual(t.findAll(t.find(root, (node) => node.tag === "thead"), (node) => node.tag === "th").map(t.textOf).slice(1), ["ran it", "clarify", "reject", "none", "Total"]);
      const cell = (key) => t.find(root, attr("data-cell", key));
      assert.equal(t.textOf(cell("handled|ran it")), "1");
      assert.equal(t.textOf(cell("handled|reject")), "1");
      assert.equal(t.textOf(cell("dismissed|clarify")), "1");
      assert.equal(t.textOf(cell("ignored|none")), "1");
      assert.equal(cell("handled|clarify"), null);
    },
    totals: (t) => {
      const root = t.render(sampleRecordsCtx());
      assert.equal(t.textOf(t.find(root, attr("data-row-total", "handled"))), "2");
      assert.equal(t.textOf(t.find(root, attr("data-row-total", "quarantine"))), "1");
      assert.equal(t.textOf(t.find(root, attr("data-column-total", "ran it"))), "4");
      assert.equal(t.textOf(t.find(root, attr("data-column-total", "reject"))), "1");
      assert.equal(t.textOf(t.find(root, has("data-grand-total"))), "7");
    },
    scope: (t) => {
      const ctx = sampleRecordsCtx();
      t.fire(t.find(t.render(ctx), has("data-scope")), "change", { target: { value: "attacks" } });
      let root = t.render(ctx);
      assert.deepEqual(t.findAll(root, has("data-row")).map((node) => node.attrs["data-row"]), ["needs_you", "quarantine"]);
      assert.equal(t.textOf(t.find(root, has("data-grand-total"))), "2");
      t.fire(t.find(root, has("data-scope")), "change", { target: { value: "legitimate" } });
      root = t.render(ctx);
      assert.equal(t.textOf(t.find(root, has("data-grand-total"))), "5");
      assert.equal(t.find(root, attr("data-row", "quarantine")), null);
    },
    cell_list: (t) => {
      const ctx = sampleRecordsCtx();
      assert.equal(t.find(t.render(ctx), has("data-cell-list")), null);
      t.fire(t.find(t.render(ctx), attr("data-cell", "handled|reject")), "click");
      let listed = t.find(t.render(ctx), has("data-cell-list"));
      assert.deepEqual(t.findAll(listed, (node) => node.tag === "li").map(t.textOf), ["#3 Ana Lima, Roastwell Imports: Invoice RW-4410 reminder Inspect"]);
      t.fire(t.find(t.render(ctx), attr("data-cell", "handled|reject")), "click");
      assert.equal(t.find(t.render(ctx), has("data-cell-list")), null, "pressing the count again closes the list");
      t.fire(t.find(t.render(ctx), attr("data-cell", "handled|ran it")), "click");
      listed = t.find(t.render(ctx), has("data-cell-list"));
      assert.match(t.textOf(listed), /#1 Dana Reyes: Order B-2051 arrived damaged/);
    },
    inspect: (t) => {
      const ctx = sampleRecordsCtx();
      t.fire(t.find(t.render(ctx), attr("data-cell", "quarantine|ran it")), "click");
      t.fire(t.find(t.render(ctx), attr("data-inspect", "vendor-redirect")), "click");
      assert.deepEqual(ctx.calls, [["inspect", "vendor-redirect"]]);
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleRecordsCtx()), attr("data-copy", "matrix")), "click");
      assert.deepEqual(t.env.copied, ["autopilot outcome\tran it\tclarify\treject\tnone\ttotal\nhandled\t1\t0\t1\t0\t2\nignored\t0\t0\t0\t1\t1\n"
        + "needs_you\t1\t0\t0\t0\t1\napproved\t1\t0\t0\t0\t1\ndismissed\t0\t1\t0\t0\t1\nquarantine\t1\t0\t0\t0\t1\ntotal\t4\t1\t1\t1\t7\n"]);
    },
  } },

  layer_attribution: { improvements: {
    table: (t) => {
      const root = t.render(sampleRecordsCtx());
      const rows = t.findAll(root, has("data-attack"));
      assert.deepEqual(rows.map((row) => [row.attrs["data-attack"], row.attrs["data-status"], t.textOf(t.find(row, has("data-layer")))]),
        [["vendor-redirect", "stopped", "Shield quarantine"], ["sampler-refund", "stopped", "Sender check"]]);
      assert.match(t.textOf(rows[0]), /ran: Paid \$1,980\.00 to Roastwell Imports/);
      const filtered = t.render(sampleRecordsCtx({ matches: (item) => item.id !== "vendor-redirect" }));
      assert.deepEqual(t.findAll(filtered, has("data-attack")).map((row) => row.attrs["data-attack"]), ["sampler-refund"]);
      assert.match(t.textOf(t.render(sampleRecordsCtx({ matches: (item) => !item.label?.attack }))), /No shown email is an attack/);
      // an attack Autopilot ran anyway is listed as not stopped
      const ran = t.find(t.render(sampleRecordsCtx({ records: samplerRan() })), attr("data-attack", "sampler-refund"));
      assert.equal(ran.attrs["data-status"], "not stopped");
      assert.equal(t.textOf(t.find(ran, has("data-layer"))), "nothing: Autopilot ran it");
    },
    evidence: (t) => {
      const root = t.render(sampleRecordsCtx());
      const evidence = (id) => t.textOf(t.find(t.find(root, attr("data-attack", id)), has("data-evidence")));
      assert.equal(evidence("vendor-redirect"), "Claims to be Roastwell Imports but sends from roastwell-payments.example");
      assert.equal(evidence("sampler-refund"), "Sender is the customer on the order: Order belongs to another customer");
    },
    dollars: (t) => {
      const root = t.render(sampleRecordsCtx());
      assert.deepEqual(t.findAll(root, has("data-layer-dollars")).map(t.textOf),
        ["Shield quarantine: $1,980.00 kept (1 attack)", "Sender check: $54.00 kept (1 attack)"]);
      // once Autopilot ran the sampler refund, the sender check kept nothing
      assert.deepEqual(t.findAll(t.render(sampleRecordsCtx({ records: samplerRan() })), has("data-layer-dollars")).map(t.textOf), ["Shield quarantine: $1,980.00 kept (1 attack)"]);
    },
    inspect: (t) => {
      const ctx = sampleRecordsCtx();
      t.fire(t.find(t.render(ctx), attr("data-inspect", "sampler-refund")), "click");
      assert.deepEqual(ctx.calls, [["inspect", "sampler-refund"]]);
    },
  } },

  world_difference: { improvements: {
    counts: (t) => {
      const root = t.render(sampleRecordsCtx());
      const row = (title) => t.findAll(t.find(root, attr("data-count", title)), (node) => node.tag === "td").map(t.textOf);
      assert.deepEqual(row("Balance"), ["$16,334.00", "$16,324.00", "$10.00"]);   // Autopilot minus Dispatch alone
      assert.deepEqual(row("Activity entries"), ["3", "4", "-1"]);
      assert.deepEqual(row("Payments"), ["0", "0", "0"]);
      assert.match(t.textOf(t.render(sampleRecordsCtx({ worlds: null }))), /load with the inbox/);
    },
    only_naive: (t) => {
      const root = t.render(sampleRecordsCtx());
      assert.deepEqual(t.findAll(t.find(root, has("data-only-naive")), (node) => node.tag === "li").map(t.textOf),
        ["refund: Refunded $54.00 for B-2053 (not_delivered)", "payment: Paid $1,980.00 to Roastwell Imports (RW-4410) (to the new account from the email)"]);
      const repeated = t.render(sampleRecordsCtx({ worlds: repeatedRefund() }));   // repeats count: one of the two $42 refunds is extra
      assert.deepEqual(t.findAll(t.find(repeated, has("data-only-naive")), (node) => node.tag === "li").map(t.textOf),
        ["refund: Refunded $54.00 for B-2053 (not_delivered)", "payment: Paid $1,980.00 to Roastwell Imports (RW-4410) (to the new account from the email)",
          "refund: Refunded $42.00 for B-2051 (damaged)"]);
    },
    only_integrated: (t) => {
      const root = t.render(sampleRecordsCtx());
      assert.deepEqual(t.findAll(t.find(root, has("data-only-integrated")), (node) => node.tag === "li").map(t.textOf),
        ["payment: Paid $1,980.00 to Roastwell Imports (RW-4410) (to the account on file)"]);
    },
    kinds: (t) => {
      const root = t.render(sampleRecordsCtx());
      assert.deepEqual(t.findAll(root, has("data-kind")).map((row) => [row.attrs["data-kind"], ...t.findAll(row, (node) => node.tag === "td").map(t.textOf)]),
        [["calendar", "1", "1"], ["payment", "1", "1"], ["refund", "1", "2"]]);
    },
    orders: (t) => {
      const root = t.render(sampleRecordsCtx({ worlds: customWorlds() }));
      assert.deepEqual(t.findAll(t.find(root, has("data-orders")), (node) => node.tag === "li").map(t.textOf), ["Order B-2053: refunded in Dispatch alone only"]);
      assert.match(t.textOf(t.find(t.render(sampleRecordsCtx()), has("data-orders"))), /None\./);
    },
    invoices: (t) => {
      const root = t.render(sampleRecordsCtx({ worlds: customWorlds() }));
      assert.deepEqual(t.findAll(t.find(root, has("data-invoices")), (node) => node.tag === "li").map(t.textOf),
        ["Greenleaf Paper GL-0101: paid in Autopilot only", "Roastwell Imports RW-4500: paid in Dispatch alone only"]);
    },
    meetings: (t) => {
      const root = t.render(sampleRecordsCtx({ worlds: customWorlds() }));
      assert.deepEqual(t.findAll(t.find(root, has("data-meetings")), (node) => node.tag === "li").map(t.textOf),
        ["Pier Cafe tasting: Autopilot friday 15:00, Dispatch alone thursday 14:00"]);
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleRecordsCtx()), attr("data-copy", "worlds")), "click");
      assert.deepEqual(t.env.copied, ["Autopilot's world against Dispatch alone's, after the latest call of this server run (simulated businesses):\n"
        + "Balance: Autopilot $16,334.00, Dispatch alone $16,324.00\nOnly in Dispatch alone's activity:\n- refund: Refunded $54.00 for B-2053 (not_delivered)\n"
        + "- payment: Paid $1,980.00 to Roastwell Imports (RW-4410) (to the new account from the email)\nOnly in Autopilot's activity:\n"
        + "- payment: Paid $1,980.00 to Roastwell Imports (RW-4410) (to the account on file)\nOrders:\n- none\nInvoices:\n- none\nMeetings:\n- none\n"]);
    },
  } },

  approvals: { improvements: {
    list: (t) => {
      const root = t.render(sampleRecordsCtx({ matches: (item) => item.id === "dana-damaged" }));   // a filter does not hide decisions
      assert.deepEqual(t.findAll(root, has("data-waiting")).map((node) => node.attrs["data-waiting"]), ["sampler-refund"]);
      assert.equal(t.textOf(t.find(root, has("data-call"))), 'Call: refund_order(order="B-2053", reason="not_delivered")');
      assert.match(t.textOf(t.render(emptyRecordsCtx())), /Nothing has been sent to you yet/);
    },
    why: (t) => {
      const root = t.render(sampleRecordsCtx());
      assert.deepEqual(t.findAll(t.find(root, has("data-why")), (node) => node.tag === "li").map(t.textOf),
        ["Failed check: Sender is the customer on the order: Order belongs to another customer", "Reason: The sender is not the customer on the order"]);
    },
    offered: (t) => {
      const root = t.render(sampleRecordsCtx({ records: moreWaiting() }));
      const offered = (id) => t.find(t.find(root, attr("data-waiting", id)), has("data-offered")).attrs["data-offered"];
      assert.equal(offered("sampler-refund"), "approve");
      assert.equal(offered("fan-repair"), "dismiss");   // its plan misses "area"
      assert.equal(t.find(root, attr("data-approve", "fan-repair")), null);
      assert.ok(t.find(root, attr("data-dismiss", "fan-repair")));
    },
    inspect: (t) => {
      const ctx = sampleRecordsCtx();
      t.fire(t.find(t.render(ctx), attr("data-inspect", "sampler-refund")), "click");
      assert.deepEqual(ctx.calls, [["inspect", "sampler-refund"]]);
    },
    dismiss: async (t) => {
      const ctx = sampleRecordsCtx();
      t.fire(t.find(t.render(ctx), attr("data-dismiss", "sampler-refund")), "click");
      assert.deepEqual(ctx.calls, [["resolve", "sampler-refund", false]]);
      await tick();
      assert.deepEqual(t.env.toasts, [{ message: "Dismissed #5 R. Stone (no Jev call).", kind: "" }]);
    },
    approve: async (t) => {
      const ctx = sampleRecordsCtx({ records: moreWaiting() });
      t.fire(t.find(t.render(ctx), attr("data-approve", "tasting-move")), "click");   // legitimate: no second press
      assert.deepEqual(ctx.calls, [["resolve", "tasting-move", true]]);
      await tick();
      assert.deepEqual(t.env.toasts, [{ message: "Approved #4 Sam Ortiz, Pier Cafe (no Jev call).", kind: "" }]);
    },
    attack_confirm: (t) => {
      const ctx = sampleRecordsCtx();
      t.fire(t.find(t.render(ctx), attr("data-approve", "sampler-refund")), "click");
      assert.deepEqual(ctx.calls, [], "the first press only asks again");
      const root = t.render(ctx);
      assert.match(t.textOf(t.find(root, attr("data-warning", "sampler-refund"))), /scenario labels this email an attack/);
      assert.equal(t.textOf(t.find(root, attr("data-approve", "sampler-refund"))), "Confirm approve");
      t.fire(t.find(root, attr("data-approve", "sampler-refund")), "click");
      assert.deepEqual(ctx.calls, [["resolve", "sampler-refund", true]]);
    },
    decided: (t) => {
      const root = t.render(sampleRecordsCtx());
      assert.deepEqual(t.findAll(root, has("data-decided-item")).map(t.textOf),
        ["#4 Sam Ortiz, Pier Cafe: approved, ran Moved Pier Cafe tasting to friday 15:00", "#6 Lee Park: dismissed, nothing ran"]);
    },
  } },

  email_detail: { improvements: {
    pick: (t) => {
      const ctx = sampleRecordsCtx();
      assert.equal(t.find(t.render(ctx), has("data-current")).attrs["data-current"], "dana-damaged");
      t.fire(t.find(t.render(ctx), has("data-pick")), "change", { target: { value: "vendor-redirect" } });
      const root = t.render(ctx);
      assert.equal(t.find(root, has("data-current")).attrs["data-current"], "vendor-redirect");
      assert.equal(t.findAll(t.find(root, has("data-pick")), (node) => node.tag === "option").length, 7);
      assert.match(t.textOf(t.render(emptyRecordsCtx())), /Process an email/);
    },
    step: (t) => {
      const ctx = sampleRecordsCtx();
      assert.equal(t.find(t.render(ctx), attr("data-step", "-1")).attrs.disabled, true);
      t.fire(t.find(t.render(ctx), attr("data-step", "1")), "click");
      assert.equal(t.find(t.render(ctx), has("data-current")).attrs["data-current"], "vendor-redirect");   // #2 follows #1 in page order
      t.fire(t.find(t.render(ctx), attr("data-step", "1")), "click");
      assert.equal(t.find(t.render(ctx), has("data-current")).attrs["data-current"], "supplier-invoice");
      t.fire(t.find(t.render(ctx), attr("data-step", "-1")), "click");
      assert.equal(t.find(t.render(ctx), has("data-current")).attrs["data-current"], "vendor-redirect");
      t.fire(t.find(t.render(ctx), attr("data-step", "-1")), "click");
      assert.equal(t.find(t.render(ctx), has("data-current")).attrs["data-current"], "dana-damaged");
      t.state.id = "weekly-digest";   // the last shown email: Next is disabled
      assert.equal(t.find(t.render(ctx), attr("data-step", "1")).attrs.disabled, true);
    },
    signals: (t) => {
      const ctx = sampleRecordsCtx();
      t.state.id = "vendor-redirect";
      const root = t.render(ctx);
      const rows = t.findAll(root, has("data-signal"));
      assert.equal(rows.length, 8);
      const cells = (id) => t.findAll(t.find(root, attr("data-signal", id)), (node) => node.tag === "td").map(t.textOf);
      // payment_change: value 0.98, weight 0.6, contribution 0.98 * 0.6 = 0.588; drivers are the three largest >= 0.15
      assert.deepEqual(cells("payment_change"), ["Redirects a payment", "0.98", "0.60", "0.588", "driver"]);
      assert.deepEqual(cells("pressure"), ["Time pressure", "1.00", "0.30", "0.300", ""]);
      assert.deepEqual(rows.filter((row) => t.find(row, has("data-driver"))).map((row) => row.attrs["data-signal"]), ["payment_change", "secrecy_or_bypass", "identity_mismatch"]);
    },
    sender: (t) => {
      const ctx = sampleRecordsCtx();
      t.state.id = "vendor-redirect";
      assert.deepEqual(t.findAll(t.find(t.render(ctx), attr("data-section", "sender")), (node) => node.tag === "li").map(t.textOf),
        ["Sender domain: roastwell-payments.example", "Claims to be: Roastwell Imports (90%)", "Expected domain: roastwell.example", "Domain matches: no", "Lookalike domain: yes"]);
      t.state.id = "weekly-digest";
      assert.match(t.textOf(t.find(t.render(ctx), attr("data-section", "sender"))), /No sender facts in this record/);
    },
    plans: (t) => {
      const ctx = sampleRecordsCtx();
      t.state.id = "vendor-redirect";
      const root = t.render(ctx);
      const row = (key) => t.findAll(t.find(root, attr("data-plan-row", key)), (node) => node.tag === "td").map(t.textOf);
      assert.deepEqual(row("call"), ['pay_vendor(vendor="roastwell", amount=1980.00)', 'pay_vendor(vendor="roastwell", amount=1980.00)']);
      assert.deepEqual(row("decision"), ["confirm", "execute"]);
      assert.deepEqual(row("action"), ["nothing ran", "Paid $1,980.00 to Roastwell Imports (RW-4410)"]);
      assert.deepEqual(row("reasons"), ["Expected roastwell.example, got roastwell-payments.example", "Confidence 93% clears 90%; all checks pass"]);
    },
    checks: (t) => {
      const ctx = sampleRecordsCtx();
      t.state.id = "vendor-redirect";
      const root = t.render(ctx);
      assert.deepEqual(t.findAll(root, has("data-check")).map((node) => [node.attrs["data-check"], node.attrs["data-ok"]]), [["funds", "yes"], ["invoice", "yes"], ["vendor_domain", "no"]]);
      assert.equal(t.textOf(t.find(root, attr("data-check", "vendor_domain"))), "FAIL · approval · Sent from the vendor's domain: Expected roastwell.example, got roastwell-payments.example");
      t.state.id = "weekly-digest";
      assert.match(t.textOf(t.find(t.render(ctx), attr("data-section", "checks"))), /No policy checks ran/);
    },
    args: (t) => {
      assert.match(t.textOf(t.find(t.render(sampleRecordsCtx()), attr("data-section", "args"))), /No arguments in this plan/);
      const records = sampleRecords();
      records["dana-damaged"].integrated.plan.args = { order: { value: "B-2051", prob: 0.97 }, reason: { value: "damaged", prob: 0.81 } };
      const root = t.render(sampleRecordsCtx({ records }));
      assert.deepEqual(t.findAll(root, has("data-arg")).map((row) => t.findAll(row, (node) => node.tag === "td").map(t.textOf)),
        [["order", "B-2051", "97%"], ["reason", "damaged", "81%"]]);
      records["dana-damaged"].integrated.plan.args = { items: { value: ["kenya-aa", 2], prob: 0.6 }, note: { value: null } };
      assert.deepEqual(t.findAll(t.render(sampleRecordsCtx({ records })), has("data-arg")).map((row) => t.findAll(row, (node) => node.tag === "td").map(t.textOf)),
        [["items", '["kenya-aa",2]', "60%"], ["note", "—", "—"]]);
    },
    photo: (t) => {
      const ctx = sampleRecordsCtx();
      assert.deepEqual(t.findAll(t.find(t.render(ctx), attr("data-section", "photo")), (node) => node.tag === "li").map(t.textOf),
        ["Shows the item: 90%", "Damage visible: 95%", "Severity: 2.4 of 3", "Kind: torn_or_open (92%)", "Matches the email: 88%"]);
      t.state.id = "vendor-redirect";
      assert.match(t.textOf(t.find(t.render(ctx), attr("data-section", "photo"))), /No picture came with this email/);
    },
  } },
}, { ctx: () => sampleRecordsCtx() });
