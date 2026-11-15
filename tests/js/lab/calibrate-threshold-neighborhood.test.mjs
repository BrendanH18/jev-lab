// Tests for static/js/lab/packs/workbench/calibrate-threshold-neighborhood.js. Expected values are worked out by hand
// from tests/js/lab/fixtures/workbench-analysis.mjs: Calibrate on department at threshold 0.50, seven scored rows
// (index: signal, stated probability, right or wrong):
//   0 .76 .82 right   1 .12 .45 wrong   2 .87 .90 right   3 .93 .95 right   4 .60 .70 right   5 .20 .40 wrong   6 .84 .88 right
// Urgent's signals are .76, .40, .90, .40 (wrong), .60, 0, .82, the others right.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/calibrate-threshold-neighborhood.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleCalibrateCtx } from "./fixtures/workbench-analysis.mjs";

const base = sampleCalibrateCtx();
const rows = base.items();
const urgent = sampleCalibrateCtx({ qid: "urgent" });
const at = (threshold) => sampleCalibrateCtx({ threshold });
const empty = () => sampleCalibrateCtx({ report: null });

// Five made-up rows: wrong ones at .50 and .20; holding .50 takes 0.51, which also holds the right rows at .30 and .50.
const made = [{ signal: 0.3, correct: true }, { signal: 0.5, correct: false }, { signal: 0.7, correct: true }, { signal: 0.2, correct: false }, { signal: 0.5, correct: true }];

checkPack(pack, {
  distance_to_threshold: { items: rows, values: [0.26, -0.38, 0.37, 0.43, 0.1, -0.3, 0.34], ctx: base, tolerance: 1e-9 },
  right_held_to_hold: { items: made, values: [null, 2, null, 0, null], ctx: fakeCtx({ items: made, data: { threshold: 0.5 } }) },
  // Signals sorted: .12 .20 .60 .76 .84 .87 .93.
  coverage_at_row: { items: rows, values: [4 / 7, 1, 2 / 7, 1 / 7, 5 / 7, 6 / 7, 3 / 7], ctx: base, tolerance: 1e-12 },
  accuracy_at_row: { items: rows, values: [1, 5 / 7, 1, 1, 1, 5 / 6, 1], ctx: base, tolerance: 1e-12 },
  mistakes_at_row: { items: rows, values: [0, 2, 0, 0, 0, 1, 0], ctx: base },
  rows_sharing_signal: { items: urgent.items(), values: [1, 2, 1, 2, 1, 1, 1], ctx: urgent },

  rows_near_threshold: [{ ctx: base, expect: 0, empty: empty() }, { ctx: at(0.8), expect: 2 }],
  // At 0.50 only row 4 (.60) is within 0.10 above; at 0.10 rows 1 (.12) and 5 (.20), both wrong.
  accuracy_just_above: [{ ctx: base, expect: 1, empty: empty() }, { ctx: at(0.1), expect: 0 }],
  // Nothing is within 0.10 below 0.50; below 0.65 is row 4 (right), below 0.30 row 5 (wrong).
  accuracy_just_below: [{ ctx: base, expect: null, empty: empty() }, { ctx: at(0.65), expect: 1 }, { ctx: at(0.3), expect: 0 }],
  mistakes_let_through: [{ ctx: base, expect: 0, empty: empty() }, { ctx: at(0.15), expect: 0.5 }],
  right_held_share: [{ ctx: base, expect: 0, empty: empty() }, { ctx: at(0.8), expect: 0.4 }],
  // Automated at 0.50: stated .82 .90 .95 .70 .88 → 0.18 + 0.10 + 0.05 + 0.30 + 0.12; at 0.10 rows 1 and 5 add 0.55 and 0.60.
  expected_mistakes_automated: [{ ctx: base, expect: 0.75, tolerance: 1e-9, empty: empty() }, { ctx: at(0.1), expect: 1.9, tolerance: 1e-9 }],
  // Mean stated 4.25 / 5 against 5 of 5 right; at 0.10, 5.1 / 7 against 5 of 7.
  automated_overconfidence: [{ ctx: base, expect: -0.15, tolerance: 1e-9, empty: empty() }, { ctx: at(0.1), expect: 0.1 / 7, tolerance: 1e-9 }],
  // Urgent's rows 1 and 3 share .40.
  tied_rows_share: [{ ctx: base, expect: 0, empty: empty() }, { ctx: urgent, expect: 2 / 7, tolerance: 1e-12 }],
  // Department: 0.21 automates five right rows (lower steps let in the wrong .20 and .12). Urgent: 0.41 keeps out the
  // wrong .40 and automates 4 of 7.
  best_coverage_90: [{ ctx: base, expect: 5 / 7, tolerance: 1e-12, empty: empty() }, { ctx: urgent, expect: 4 / 7, tolerance: 1e-12 }],
  best_coverage_95: [{ ctx: base, expect: 5 / 7, tolerance: 1e-12, empty: empty() }, { ctx: urgent, expect: 4 / 7, tolerance: 1e-12 }],
  best_coverage_99: [{ ctx: base, empty: empty(), expect: (r) => {
    assert.ok(Math.abs(r.value - 5 / 7) < 1e-12);
    assert.equal(r.detail, "threshold 0.21 automates 5 of 7 shown rows, 5 right");
  } }],

  near_threshold_csv: { ctx: at(0.8), filename: "calibrate-department-near-threshold.csv",
    text: "\"Bulk #\",\"label\",\"answer\",\"right\",\"signal\",\"side\",\"distance\"\r\n"
      + "\"1\",\"billing\",\"billing\",\"yes\",\"0.76\",\"review\",\"0.04\"\r\n"
      + "\"7\",\"shipping\",\"shipping\",\"yes\",\"0.84\",\"automated\",\"0.04\"\r\n",
    excludes: ["espresso"] },
  // Highest signal first; at .20 six rows automate (one wrong), at .12 all seven (two wrong).
  row_thresholds_csv: { ctx: base, filename: "calibrate-department-row-thresholds.csv",
    text: "\"Bulk #\",\"signal\",\"right\",\"automated at this signal\",\"share\",\"accuracy\",\"mistakes\"\r\n"
      + "\"4\",\"0.93\",\"yes\",\"1\",\"0.1429\",\"1.0000\",\"0\"\r\n"
      + "\"3\",\"0.87\",\"yes\",\"2\",\"0.2857\",\"1.0000\",\"0\"\r\n"
      + "\"7\",\"0.84\",\"yes\",\"3\",\"0.4286\",\"1.0000\",\"0\"\r\n"
      + "\"1\",\"0.76\",\"yes\",\"4\",\"0.5714\",\"1.0000\",\"0\"\r\n"
      + "\"5\",\"0.60\",\"yes\",\"5\",\"0.7143\",\"1.0000\",\"0\"\r\n"
      + "\"6\",\"0.20\",\"no\",\"6\",\"0.8571\",\"0.8333\",\"1\"\r\n"
      + "\"2\",\"0.12\",\"no\",\"7\",\"1.0000\",\"0.7143\",\"2\"\r\n",
    excludes: ["billing", "espresso"] },
  setting_json: { ctx: base, filename: "calibrate-department-setting.json",
    text: "{\n  \"question\": \"department\",\n  \"type\": \"choice\",\n  \"signal\": \"confidence\",\n  \"bound\": \"estimate\",\n  \"threshold\": 0.5\n}\n" },
  label_routing_csv: { ctx: base, filename: "calibrate-department-routing-by-label.csv",
    text: "\"label\",\"shown rows\",\"automated\",\"automated, right\",\"automated, wrong\",\"reviewed\",\"reviewed, wrong\"\r\n"
      + "\"billing\",\"2\",\"2\",\"2\",\"0\",\"0\",\"0\"\r\n"
      + "\"other\",\"1\",\"1\",\"1\",\"0\",\"0\",\"0\"\r\n"
      + "\"shipping\",\"3\",\"1\",\"1\",\"0\",\"2\",\"2\"\r\n"
      + "\"wholesale\",\"1\",\"1\",\"1\",\"0\",\"0\",\"0\"\r\n" },
  // 80%: 0.13 automates six rows, five right; from 85% up, 0.21 automates the five right rows.
  targets_on_shown_csv: { ctx: base, filename: "calibrate-department-shown-targets.csv",
    text: "\"target\",\"threshold\",\"automated\",\"share\",\"accuracy\"\r\n"
      + "\"0.80\",\"0.13\",\"6\",\"0.8571\",\"0.8333\"\r\n"
      + "\"0.85\",\"0.21\",\"5\",\"0.7143\",\"1.0000\"\r\n"
      + "\"0.90\",\"0.21\",\"5\",\"0.7143\",\"1.0000\"\r\n"
      + "\"0.95\",\"0.21\",\"5\",\"0.7143\",\"1.0000\"\r\n"
      + "\"0.99\",\"0.21\",\"5\",\"0.7143\",\"1.0000\"\r\n" },

  // At 0.10 the wrong rows .12 and .20 automate; the lower one needs 0.13.
  hold_next_mistake: {
    ctx: () => at(0.1),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThreshold", 0.13]]);
      assert.match(ctx.env.toasts[0].message, /0\.10 → 0\.13: row #2 now goes to review/);
    },
    hidden: () => sampleCalibrateCtx(),
  },
  // At 0.50 the held rows are .12 and .20: the slider moves to 0.20.
  automate_next_row: {
    ctx: () => sampleCalibrateCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThreshold", 0.2]]);
      assert.match(ctx.env.toasts[0].message, /0\.50 → 0\.20: row #6 \(wrong\) now automates/);
    },
    hidden: () => at(0),
  },
  apply_shown_90: {
    ctx: () => sampleCalibrateCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setThreshold", 0.21]]);
      assert.match(ctx.env.toasts[0].message, /0\.50 → 0\.21: 5 of 7 shown rows automate, 5 right/);
    },
    hidden: () => at(0.21),
  },
  apply_shown_95: { ctx: () => sampleCalibrateCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["setThreshold", 0.21]]), hidden: () => at(0.21) },
  // Urgent: 0.41 keeps out the wrong .40.
  apply_shown_99: { ctx: () => sampleCalibrateCtx({ qid: "urgent" }), check: (ctx) => assert.deepEqual(ctx.log, [["setThreshold", 0.41]]),
    hidden: () => sampleCalibrateCtx({ qid: "urgent", threshold: 0.41 }) },
}, { ctx: () => sampleCalibrateCtx() });

test("calibrate-threshold-neighborhood: Box labels have no routing by label, and a target no step reaches says so", () => {
  assert.throws(() => pack.features.find((f) => f.id === "label_routing_csv").build(sampleCalibrateCtx({ qid: "spot" })), /coordinates/);
  // Only wrong rows shown: no threshold reaches 90%.
  const wrongOnly = sampleCalibrateCtx({ hide: [0, 2, 3, 4, 6] });
  const result = pack.features.find((f) => f.id === "best_coverage_90").compute(wrongOnly);
  assert.equal(result.value, 0);
  assert.match(pack.features.find((f) => f.id === "targets_on_shown_csv").build(wrongOnly), /"0\.90","none","0","0\.0000",""/);
});

test("calibrate-threshold-neighborhood: a wrong row with a signal of 1 cannot be held", () => {
  const made1 = [{ signal: 1, correct: false }, { signal: 0.4, correct: true }];
  const fact = pack.features.find((f) => f.id === "right_held_to_hold");
  assert.equal(fact.value(made1[0], fakeCtx({ items: made1, data: { threshold: 0.5 } })), null);
  for (const feature of pack.features.filter((f) => f.kind === "fact")) feature.value({}, fakeCtx({}));
});
