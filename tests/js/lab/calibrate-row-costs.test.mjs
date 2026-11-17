// Tests for static/js/lab/packs/workbench/calibrate-row-costs.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs: Calibrate on department, $2 a review, $20 a mistake, threshold 0.50,
// seven scored rows (index: label → answer, signal):
//   0 billing → billing .76   1 shipping → wholesale .12 (wrong)   2 other → other .87   3 billing → billing .93
//   4 wholesale → wholesale .60   5 shipping → billing .20 (wrong)   6 shipping → shipping .84
// The fixture prices billing → shipping at $50, a mistake no row makes; "priced" below prices shipping → billing (row 5).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/calibrate-row-costs.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { CAL_COST, sampleCalibrateCtx } from "./fixtures/workbench-analysis.mjs";

const base = sampleCalibrateCtx();
const rows = base.items();
const [r0, , , , r4] = rows;
const empty = () => sampleCalibrateCtx({ report: null });
const cost = { ...CAL_COST, mistakes: [{ question: "department", label: "shipping", answer: "billing", cost: 50 }] };
const priced = (threshold = 0.5) => sampleCalibrateCtx({ cost, threshold });
const at = (threshold) => sampleCalibrateCtx({ threshold });

checkPack(
  pack,
  {
    automate_cost: { items: rows, values: [0, 20, 0, 0, 0, 50, 0], ctx: priced() },
    routing_cost: { items: rows, values: [0, 2, 0, 0, 0, 2, 0], ctx: priced() },
    // At 0.10 both wrong rows automate: $20 and $50 where a $2 review would do.
    hindsight_regret: { items: rows, values: [0, 18, 0, 0, 0, 48, 0], ctx: priced(0.1) },
    costly_mistake: { items: rows, values: [false, false, false, false, false, true, false], ctx: priced() },
    cheaper_route: {
      items: rows,
      values: ["automate", "review", "automate", "automate", "automate", "review", "automate"],
      ctx: base,
    },

    dear_automated_mistake: {
      hit: priced(0.1).items()[5],
      miss: [r0, r4],
      ctx: priced(0.1),
      message: /costs \$50\.00, as much as 25 reviews/,
    },

    // Two $2 reviews over 7 rows (the cost sweep's own $4 at 0.50); without row 1, one over 6.
    shown_cost_per_1000: [
      { ctx: base, expect: 4000 / 7, tolerance: 1e-12, empty: empty() },
      { ctx: sampleCalibrateCtx({ hide: [1] }), expect: 2000 / 6, tolerance: 1e-12 },
    ],
    hindsight_cost_per_1000: [
      { ctx: at(0.1), expect: 4000 / 7, tolerance: 1e-12, empty: empty() },
      { ctx: sampleCalibrateCtx({ hide: [1] }), expect: 2000 / 6, tolerance: 1e-12 },
    ],
    automated_mistake_cost: [
      { ctx: base, expect: 0, empty: empty() },
      { ctx: at(0.1), expect: 40 },
    ],
    // At 0.80 the right rows .76 and .60 go to review.
    needless_review_cost: [
      { ctx: base, expect: 0, empty: empty() },
      { ctx: at(0.8), expect: 4 },
    ],
    loss_per_automated_row: [
      { ctx: base, expect: 0, empty: empty() },
      { ctx: at(0.1), expect: 40 / 7, tolerance: 1e-12 },
    ],

    row_costs_csv: {
      ctx: base,
      filename: "calibrate-department-row-costs.csv",
      text:
        '"Bulk #","label","answer","right","signal","route","cost at the slider","cost if automated","cost if reviewed"\r\n' +
        '"1","billing","billing","yes","0.76","automated","0.00","0.00","2.00"\r\n' +
        '"2","shipping","wholesale","no","0.12","review","2.00","20.00","2.00"\r\n' +
        '"3","other","other","yes","0.87","automated","0.00","0.00","2.00"\r\n' +
        '"4","billing","billing","yes","0.93","automated","0.00","0.00","2.00"\r\n' +
        '"5","wholesale","wholesale","yes","0.60","automated","0.00","0.00","2.00"\r\n' +
        '"6","shipping","billing","no","0.20","review","2.00","20.00","2.00"\r\n' +
        '"7","shipping","shipping","yes","0.84","automated","0.00","0.00","2.00"\r\n',
      excludes: ["espresso"],
    },
  },
  { ctx: () => sampleCalibrateCtx() },
);

test("calibrate-row-costs: without a cost report (a Box, or invalid prices) nothing is priced", () => {
  const box = sampleCalibrateCtx({ qid: "spot" });
  assert.equal(pack.features.find((f) => f.id === "automate_cost").value(box.items()[0], box), null);
  assert.equal(pack.features.find((f) => f.id === "shown_cost_per_1000").compute(box), null);
  assert.throws(() => pack.features.find((f) => f.id === "row_costs_csv").build(box), /no cost yet/);
  for (const feature of pack.features.filter((f) => f.kind === "fact")) feature.value({}, fakeCtx({}));
});
