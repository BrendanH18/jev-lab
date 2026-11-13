import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/dispatch/dispatch-plan-review.js";
import { fixtureClarifyLast, fixtureMissingLast, sampleDispatchPlanCtx } from "./fixtures/dispatch.mjs";
import { checkPack } from "./harness.mjs";

// The fixture command "refund maya's order, the bag arrived torn open" (made-up answers): 14 rows in response order —
// tool, refund.order, refund.reason (used by the refund plan), five reschedule/pay rows, task.area, task.priority (Score
// 1.62), info.template, info.customer, flag.complaint (Noul 0.73) and flag.photo (a box with no value).
const ctx = sampleDispatchPlanCtx();
const items = ctx.items();
const empty = () => sampleDispatchPlanCtx({ last: null });
const usedOnly = () => sampleDispatchPlanCtx({ matches: (id, item) => item.used });
// A Choice answer shaped like the surface's rows: probabilities in response order, ranked highest first (values given descending).
const probs = (...values) => {
  const probabilities = values.map((p, index) => ({ key: `k${index}`, p }));
  return { type: "choice", probabilities, ranked: probabilities.map((entry) => ({ ...entry })) };
};

checkPack(pack, {
  p: { items, ctx, values: [0.86, 0.91, 0.48, 0.97, 0.95, 0.96, 0.92, 0.9, 0.6, 0.67, 0.7, 0.88, 0.73, null] },
  margin: { items, ctx, values: [0.86 - 0.06, 0.91 - 0.03, 0.48 - 0.46, 0.97 - 0.01, 0.95 - 0.01, 0.96 - 0.02, 0.92 - 0.03, 0.9 - 0.1, 0.6 - 0.15, 0.67 - 0.28,
    0.7 - 0.1, 0.88 - 0.03, null, null] },
  used: { items, ctx, values: [true, true, true, false, false, false, false, false, false, false, false, false, false, false] },
  group: { items, ctx, values: ["tool", "refund", "refund", "reschedule", "reschedule", "reschedule", "pay", "pay", "task", "task", "info", "info", "flag", "flag"] },
  type: { items, ctx, values: ["choice", "choice", "choice", "choice", "choice", "choice", "choice", "choice", "choice", "score", "choice", "choice", "noul", "box"] },
  option_count: { items, ctx, values: [6, 7, 5, 5, 6, 3, 6, 2, 6, 3, 5, 6, 2, null] },
  not_found: { items, ctx, values: [false, false, false, true, true, true, true, true, false, false, false, false, false, false] },
  // Entropy by hand: H(.5,.5) = 1; H(1) = 0; H(.25 x4) = 2; H(.5,.25,.25) = .5·1 + 2·(.25·2) = 1.5; H(.75,.25) = .75·log2(4/3) + .25·2
  // = 0.811278124459133 (Shannon's binary entropy at 0.25, a published reference value). A zero term adds nothing.
  spread: { items: [probs(0.5, 0.5), probs(1), probs(), probs(0.25, 0.25, 0.25, 0.25), probs(0.5, 0.25, 0.25), probs(0.75, 0.25, 0), { type: "noul", probabilities: [null, { key: "yes", p: 1 }] }],
    values: [1, 0, null, 2, 1.5, 0.811278124459133, 0], tolerance: 1e-12 },
  answer: { items, ctx, values: ["refund order", "A-1041", "damaged", "not identified", "not stated", "not stated", "not identified", "not stated", "shipping",
    "score 1.62", "return policy", "maya chen", "yes", ""] },
  below_threshold: { items, ctx, values: [false, false, true, false, false, false, false, false, false, false, false, false, false, false] },

  // refund.reason: damaged 0.48 vs not_stated 0.46 is 2 points. A lead of exactly 10 points (0.6 vs 0.5) is not a close call.
  close_call: { ctx, hit: [items[2], probs(0.55, 0.459)], miss: [items[0], items[9], items[12], items[13], probs(0.6, 0.5), probs(0.9)],
    message: /^(?:damaged leads not stated by 2|k0 leads k1 by 9) points: a close call by a local 10-point rule, not the page's decision\.$/ },
  probability_sum: { ctx, hit: probs(0.6, 0.43), miss: [items[0], items[9], items[12], items[13]], message: /^The listed probabilities add up to 103\.0%\.$/ },

  tokens: [{ ctx, expect: 1926, empty: empty() }, { ctx, expect: (result) => assert.equal(result.detail, "1,830 in · 96 out") }],
  session_cost: [{ ctx, expect: 0.00038 + 0.00041, tolerance: 1e-12, empty: empty() }, { ctx, expect: (result) => assert.equal(result.detail, "2 commands") }],
  session_calls: [{ ctx, expect: 2, empty: empty() }, { ctx: sampleDispatchPlanCtx({ calls: 5 }), expect: 5 }],
  cost_per_1000: { ctx, expect: 0.41, tolerance: 1e-12, empty: empty() },

  answers_csv: { ctx: usedOnly(), filename: "dispatch-answers.csv",
    text: '"question","type","used","answer","probability"\r\n"tool","choice","yes","refund_order","0.86"\r\n"refund.order","choice","yes","A-1041","0.91"\r\n'
      + '"refund.reason","choice","yes","damaged","0.48"\r\n' },
  request_json: { ctx, filename: "dispatch-request.json",
    includes: ['"assistant_for": "Harbor Coffee Co., a small coffee roaster"', '"request": "refund maya\'s order, the bag arrived torn open"', '"model": "jev-1.14"', '"refund.reason": {'],
    excludes: ['"probabilities"', '"choice": "refund_order"', '"plan"', "cost_usd", "latency_ms", '"answers"'] },
  plan_summary: { ctx, filename: "dispatch-plan.txt",
    text: ["Command: refund maya's order, the bag arrived torn open", 'Call: refund_order(order="A-1041", reason="damaged")', "Decision: confirm (confidence 48%)",
      "Reasons:", "- Confidence 48% is below the 80% a medium-risk action needs", "Checks:", "- ok · Not already refunded · No previous refund",
      "- ok · Within 30-day window · Delivered 3 days ago"].join("\n") + "\n" },

  inspect: { ctx: () => sampleDispatchPlanCtx(), check: (c) => assert.deepEqual(c.recorded, [["inspect"]]), hidden: empty },
  copy_call: {
    ctx: () => sampleDispatchPlanCtx(),
    check: (c) => {
      assert.deepEqual(c.env.copied, ['refund_order(order="A-1041", reason="damaged")']);
      assert.deepEqual(c.recorded, [], "copying runs nothing");
    },
    hidden: empty,
  },
  pick_top_option: {
    ctx: () => sampleDispatchPlanCtx({ last: fixtureClarifyLast() }),
    check: (c) => {
      assert.deepEqual(c.recorded, [["pickTool", "create_task"]]);
      const feature = pack.features.find((entry) => entry.id === "pick_top_option");
      const missing = sampleDispatchPlanCtx({ last: fixtureMissingLast() });
      feature.run(missing);
      assert.deepEqual(missing.recorded, [["pickArg", "customer", "luis_ortega"]]);
    },
    hidden: () => sampleDispatchPlanCtx(),
  },
  copy_command: {
    ctx: () => sampleDispatchPlanCtx(),
    check: (c) => assert.deepEqual(c.env.copied, ["refund maya's order, the bag arrived torn open"]),
    hidden: empty,
  },
  restore_command: {
    ctx: () => sampleDispatchPlanCtx({ draft: "pay roastworks" }),
    check: (c) => {
      assert.deepEqual(c.recorded, [["draftCommand", "refund maya's order, the bag arrived torn open"]], "only the box changes: nothing is sent");
      assert.equal(c.data.stale, false);
      assert.match(c.env.toasts[0].message, /Nothing was sent/);
    },
    hidden: () => sampleDispatchPlanCtx(),
  },
}, { ctx: () => sampleDispatchPlanCtx() });
