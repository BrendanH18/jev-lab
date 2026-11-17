// Tests for static/js/lab/packs/workbench/calibrate-commands.js, on tests/js/lab/fixtures/workbench-analysis.mjs.
// Department's sweep reaches 90%, 95% and 99% accuracy first at 0.21 (lower steps automate the wrong rows at .20 and
// .12), and the lowest cost at $2 a review and $20 a mistake is also at 0.21. The run's labeled questions in answer
// order are department, urgent, tone and spot.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/calibrate-commands.js";
import { checkPack } from "./harness.mjs";
import { sampleCalibrateCtx } from "./fixtures/workbench-analysis.mjs";

const at =
  (threshold, more = {}) =>
  () =>
    sampleCalibrateCtx({ threshold, ...more });
const target = (name) => ({
  ctx: at(0.5),
  check: (ctx) => {
    assert.deepEqual(ctx.log, [["setThreshold", 0.21]]);
    assert.match(ctx.env.toasts[0].message, new RegExp(`0\\.50 → 0\\.21 for ${name} accuracy`));
  },
  hidden: at(0.21),
});

checkPack(
  pack,
  {
    apply_target_90: target("90%"),
    apply_target_95: target("95%"),
    apply_target_99: target("99%"),
    apply_cheapest: {
      ctx: at(0.5),
      check: (ctx) => {
        assert.deepEqual(ctx.log, [["setThreshold", 0.21]]);
        assert.match(ctx.env.toasts[0].message, /0\.50 → 0\.21, the lowest-cost threshold/);
      },
      hidden: at(0.5, { qid: "urgent" }),
    },
    raise_step: { ctx: at(0.5), check: (ctx) => assert.deepEqual(ctx.log, [["setThreshold", 0.55]]), hidden: at(1) },
    lower_step: { ctx: at(0.03), check: (ctx) => assert.deepEqual(ctx.log, [["setThreshold", 0]]), hidden: at(0) },
    toggle_signal: {
      ctx: at(0.5),
      check: (ctx) => assert.deepEqual(ctx.log, [["setSignal", "top_probability"]]),
      hidden: () => sampleCalibrateCtx({ result: null }),
    },
    toggle_bound: {
      ctx: at(0.5),
      check: (ctx) => assert.deepEqual(ctx.log, [["setBound", "lower"]]),
      hidden: () => sampleCalibrateCtx({ result: null }),
    },
    next_question: {
      ctx: at(0.5, { qid: "spot" }),
      check: (ctx) => assert.deepEqual(ctx.log, [["selectQuestion", "department"]]),
      hidden: at(0.5, { labeledQids: new Set(["department"]) }),
    },
    previous_question: {
      ctx: at(0.5),
      check: (ctx) => assert.deepEqual(ctx.log, [["selectQuestion", "spot"]]),
      hidden: at(0.5, { labeledQids: new Set(["department"]) }),
    },
    next_coverage: {
      ctx: at(0.5, { setsCoverage: 0.99 }),
      check: (ctx) => assert.deepEqual(ctx.log, [["setCoverage", 0.8]]),
      hidden: at(0.5, { qid: "spot" }),
    },
  },
  { ctx: () => sampleCalibrateCtx() },
);

test("calibrate-commands: questions step in answer order, skipping unlabeled ones", () => {
  const next = pack.features.find((f) => f.id === "next_question");
  const ctx = sampleCalibrateCtx({ labeledQids: new Set(["department", "tone"]) });
  next.run(ctx);
  assert.deepEqual(ctx.log, [["selectQuestion", "tone"]]);
  const moved = sampleCalibrateCtx({ setsCoverage: 0.9 });
  pack.features.find((f) => f.id === "next_coverage").run(moved);
  assert.deepEqual(moved.log, [["setCoverage", 0.95]]);
});
