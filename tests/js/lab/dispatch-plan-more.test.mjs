import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-plan-more.js";
import { fixtureMissingLast, sampleDispatchPlanCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture's latest command ("refund maya's order, the bag arrived torn open"), 14 answers in response order:
//  0 tool refund_order .86 (then create_task .06)      1 refund.order A-1041 .91 (then A-1044 .03)
//  2 refund.reason damaged .48 (then not_stated .46)   3 reschedule.meeting not_identified .97 (then bean_brokers_call .01)
//  4 reschedule.day not_stated .95 (then monday .01)   5 reschedule.time not_stated .96 (then morning .02)
//  6 pay.vendor not_identified .92 (then bean_brokers .03)   7 pay.amount not_stated .9 (then open_invoice .1)
//  8 task.area shipping .6 (then admin .15; wholesale .1; three at .05)   9 task.priority score 1.62 ("2" .67, "1" .28, "0" .05)
// 10 info.template return_policy .7 (then shipping_times .1, brewing_guide .1, two at .05)   11 info.customer maya_chen .88
// 12 flag.complaint Noul .73 (yes .73, no .27)         13 flag.photo Box, no probabilities
// The plan is refund_order (threshold 0.80), so rows 0-2 are used. Ties keep response order when ranked.
const ctx = sampleDispatchPlanCtx();
const items = ctx.items();
const empty = () => sampleDispatchPlanCtx({ last: null });

// The user picked Luis in "Which customer?" for the send_info plan (rows 0, 10 and 11 are used there).
const picked = sampleDispatchPlanCtx({ last: { ...fixtureMissingLast(), override: { args: { customer: "luis_ortega" } } } });
const pickedItems = picked.items();

const entry = (call, text, tool, decision, latency, cost) => ({ call, at: 1774000000000 + call * 1000, text,
  res: { plan: { tool, decision, confidence: 0.9, signature: `${tool}()` }, meta: cost === null ? { latency_ms: latency } : { latency_ms: latency, cost_usd: cost } } });
// Three commands; the second repeats the first up to case and spacing, the third has no measured cost.
const session = () => sampleDispatchPlanCtx({ history: [entry(1, "Pay PackRight's invoice", "pay_vendor", "execute", 300, 0.0003),
  entry(2, "pay  packright's invoice ", "pay_vendor", "confirm", 500, 0.0005), entry(3, "refund A-1041", "refund_order", "confirm", 100, null)] });

const extra = [{ ...items[3], value: "team_sync" }, { ...items[6], value: "roastworks" }, { ...items[4], value: "thursday" },
  { ...items[1], value: "A-1046" }, { ...items[1], value: "A-2000" }];
const priority = [items[0], items[9], { ...items[9], score: 0.5 }, { ...items[9], score: 1.0 }, { ...items[9], score: 1.34 }];

checkPack(pack, {
  runner_up: { items, ctx, values: ["create task", "A-1044", "not stated", "bean brokers call", "monday", "morning", "bean brokers", "open invoice",
    "admin", "1", "shipping times", "luis ortega", "no", ""] },
  runner_up_p: { items, ctx, values: [0.06, 0.03, 0.46, 0.01, 0.01, 0.02, 0.03, 0.1, 0.15, 0.28, 0.1, 0.03, 0.27, null] },
  top_two: { items, ctx, values: [0.92, 0.94, 0.94, 0.98, 0.96, 0.98, 0.95, 1, 0.75, 0.95, 0.8, 0.91, 1, null] },
  plausible_options: { items, ctx, values: [2, 1, 2, 1, 1, 1, 1, 2, 6, 3, 5, 1, 2, null] },
  world_record: { items, ctx, values: [false, true, false, false, false, false, false, false, false, false, false, true, false, false] },
  value_label: { items: [...items, ...extra], ctx, values: ["refund order", "A-1041 · Maya Chen", "damaged", "not identified", "not stated", "not stated",
    "not identified", "not stated", "shipping", "", "return policy", "Maya Chen", "", "",
    "Weekly team sync", "Roastworks Machinery", "Thursday", "A-1046", "A-2000"] },
  priority_level: { items: priority, ctx, values: [null, "urgent", "low", "normal", "urgent"] },
  // |1.62 - 1.34|, |0.5 - 0.67|, min(|1.0 - 0.67|, |1.0 - 1.34|), 0 at the cut-off itself.
  cutoff_distance: { items: priority, ctx, values: [null, 0.28, 0.17, 0.33, 0], tolerance: 1e-9 },
  threshold_gap: { items, ctx, values: [0.06, 0.11, -0.32, null, null, null, null, null, null, null, null, null, null, null] },
  replaced_by_pick: { items: picked.items(), ctx: picked, values: [false, false, false, false, false, false, false, false, false, false, false, true, false, false] },

  // Under the send_info plan with the user's customer pick: info.template is used and not overridden, info.customer
  // (row 11) was picked, so a "not identified" there is already resolved; rows 1-2 are unused there.
  used_not_found: { ctx: picked, hit: [{ ...pickedItems[10], value: "not_stated" }, { ...pickedItems[0], id: "info.template", arg: "template", value: "not_identified" }],
    miss: [pickedItems[10], { ...pickedItems[11], value: "not_identified" }, { ...pickedItems[1], value: "not_identified" }, pickedItems[3]],
    message: /^info\.template is not (stated|identified), so the plan has no template from the command: name it in the command \(local advice\)\.$/ },
  tool_runner_up_none: { ctx, hit: { ...items[0], ranked: [{ key: "create_task", p: 0.41 }, { key: "none", p: 0.3 }] }, miss: [items[0], items[3]],
    message: /no action at 30%/ },
  // 1.39 and 0.62 sit exactly 0.05 from a cut-off (inclusive); 1.40 and 0.61 are 0.06 away.
  near_priority_cut: { ctx, hit: [{ ...items[9], score: 1.36 }, { ...items[9], score: 0.7 }, { ...items[9], score: 1.39 }, { ...items[9], score: 0.62 }],
    miss: [items[9], items[0], { ...items[9], score: 1.0 }, { ...items[9], score: 1.4 }, { ...items[9], score: 0.61 }, { ...items[2], score: 1.34 }],
    message: /^Score (1\.36|1\.39) is within 0\.05 of the 1\.34 cut-off|^Score (0\.70|0\.62) is within 0\.05 of the 0\.67 cut-off/ },
  not_in_criteria: { ctx, hit: { ...items[2], value: "lost" }, miss: [items[2], items[9], items[13]], message: /refund\.reason chose "lost", which is not one of the options/ },
  chosen_not_top: { ctx, hit: { ...items[2], value: "not_stated" }, miss: [items[2], items[12], items[13]],
    message: /^refund\.reason chose "not_stated" but "damaged" has the highest probability \(48%\)\.$/ },

  // Fixture session: call 1 "pay packright's invoice" (clarify, pay_vendor, 388 ms, $0.00038), call 2 the shown command
  // (confirm, refund_order, 412.5 ms, $0.00041).
  median_latency: [{ ctx, expect: (388 + 412.5) / 2, empty: empty() }, { ctx: session(), expect: 300 }],
  average_cost: [{ ctx, expect: (0.00038 + 0.00041) / 2, empty: empty() }, { ctx: session(), expect: 0.0004 }],
  decision_mix: [{ ctx, expect: "clarify 1 · confirm 1", empty: empty() }, { ctx: session(), expect: "confirm 2 · execute 1" }],
  tool_mix: [{ ctx, expect: "pay vendor 1 · refund order 1", empty: empty() }, { ctx: session(), expect: "pay vendor 2 · refund order 1" }],
  confirm_share: [{ ctx, expect: 0.5, empty: empty() }, { ctx: session(), expect: 2 / 3 }],
  repeated_commands: [{ ctx, expect: 0, empty: empty() }, { ctx: session(), expect: 1 }],

  session_csv: { ctx, filename: "dispatch-session.csv",
    text: ['"call","when","command","action","decision","confidence","latency_ms","cost_usd"',
      '"1","earlier","pay packright\'s invoice","pay_vendor","clarify","0.55","388","0.00038"',
      '"2","latest (shown)","refund maya\'s order, the bag arrived torn open","refund_order","confirm","0.48","412.5","0.00041"'].join("\r\n") + "\r\n",
    check: () => assert.throws(() => pack.features.find((f) => f.id === "session_csv").build(empty()), /Run a command first/) },
  plan_json: { ctx, filename: "dispatch-plan.json",
    includes: ['"command": "refund maya\'s order, the bag arrived torn open"', '"executed": false', '"decision": "confirm"',
      '"signature": "refund_order(order=\\"A-1041\\", reason=\\"damaged\\")"'],
    excludes: ["jev-1.14", "latency_ms", "cost_usd", "instructions", "Question "],
    check: (out) => {
      assert.equal(JSON.parse(out.text).plan.args.reason.prob, 0.48);
      assert.throws(() => pack.features.find((f) => f.id === "plan_json").build(empty()), /Run a command first/);
    } },
}, { ctx: () => sampleDispatchPlanCtx() });
