// Tests for static/js/lab/packs/workbench/calibrate-reliability-bins.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs, Calibrate on department. Stated probabilities and results:
//   0 .82 right   1 .45 wrong   2 .90 right   3 .95 right   4 .70 right   5 .40 wrong   6 .88 right
// so the bins are 0.4–0.5 (rows 1, 5: mean .425, none right), 0.7–0.8 (row 4), 0.8–0.9 (rows 0, 6: mean .85, both
// right) and 0.9–1.0 (rows 2, 3: mean .925, both right). 95% Wilson intervals from a separate Python computation:
// 0 of 2 → 0–0.6576, 1 of 1 → 0.2065–1, 2 of 2 → 0.3424–1, 2 of 6 → 0.0968–0.7000, 6 of 6 → 0.6097–1, 1 of 2 → 0.0945–0.9055.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/calibrate-reliability-bins.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleCalibrateCtx } from "./fixtures/workbench-analysis.mjs";

const base = sampleCalibrateCtx();
const rows = base.items();
const empty = () => sampleCalibrateCtx({ report: null });
const make = (n, top, right) => Array.from({ length: n }, (_, i) => ({ top, correct: i < right }));

// Six rows stating .95 with two right (overconfident), six stating .55 all right (underconfident), two stating .35
// with one right (within its interval).
const over = make(6, 0.95, 2), under = make(6, 0.55, 6), within = make(2, 0.35, 1);
const mixed = [...over, ...under, ...within];
const mixedCtx = fakeCtx({ items: mixed });
// Two rows stating .65 both right, then two stating .85 with one right: the higher bin is right less often.
const unordered = [...make(2, 0.65, 2), ...make(2, 0.85, 1)];
const five = make(5, 0.95, 5);

checkPack(pack, {
  bin_gap: { items: rows, values: [-0.15, 0.425, -0.075, -0.075, -0.3, 0.425, -0.15], ctx: base, tolerance: 1e-9 },
  bin_rows: { items: rows, values: [2, 2, 2, 2, 1, 2, 2], ctx: base },
  bin_accuracy: { items: rows, values: [1, 0, 1, 1, 1, 0, 1], ctx: base },
  stated_band: { items: rows, values: ["0.8–0.9", "0.4–0.5", "0.9–1.0", "0.9–1.0", "0.7–0.8", "0.4–0.5", "0.8–0.9"], ctx: base },
  bin_verdict: { items: mixed, ctx: mixedCtx,
    values: [...over.map(() => "overconfident"), ...under.map(() => "underconfident"), ...within.map(() => "within its interval")] },

  thin_bins: { hitList: rows, missList: five, ctx: base,
    message: /^4 of the 4 bins with rows hold fewer than 5 rows \(0\.4–0\.5: 2, 0\.7–0\.8: 1, 0\.8–0\.9: 2, 0\.9–1\.0: 2\)/ },
  non_monotone_bins: { hitList: unordered, missList: rows, ctx: base,
    message: /^Rows stating 0\.8–0\.9 are right less often \(50\.0% of 2\) than rows stating 0\.6–0\.7 \(100\.0% of 2\)/ },
  overconfident_bins: { hitList: mixed, missList: rows, ctx: base,
    message: /^Rows stating 0\.9–1\.0 say 95\.0% on average but 2 of 6 are right \(95% interval 9\.7%–70\.0%\)/ },
  underconfident_bins: { hitList: mixed, missList: rows, ctx: base,
    message: /^Rows stating 0\.5–0\.6 say 55\.0% on average but 6 of 6 are right \(95% interval 61\.0%–100\.0%\)/ },
  crowded_bin: { hitList: five, missList: rows, ctx: base, message: /^5 of 5 shown rows state 0\.9–1\.0/ },

  bins_with_rows: [{ ctx: base, expect: 4, empty: empty() }, { ctx: fakeCtx({ items: under }), expect: 1 }],
  // Department: every bin is thin. Five rows at .95 and one at .50: only the .50 row is in a thin bin.
  thin_bin_rows: [{ ctx: base, expect: 1, empty: empty() }, { ctx: fakeCtx({ items: [...five, { top: 0.5, correct: true }] }), expect: 1 / 6, tolerance: 1e-12 }],
  miscalibrated_rows: [{ ctx: base, expect: 0, empty: empty() }, { ctx: mixedCtx, expect: 12 / 14, tolerance: 1e-12 }],
  monotone_violations: [{ ctx: base, expect: 0, empty: empty() }, { ctx: fakeCtx({ items: unordered }), expect: 1 }],
  // (2 × .425 + 1 × .30 + 2 × .15 + 2 × .075) / 7; five rows at .95, all right: .05.
  shown_ece: [{ ctx: base, expect: 1.6 / 7, tolerance: 1e-12, empty: empty() }, { ctx: fakeCtx({ items: five }), expect: 0.05, tolerance: 1e-12 }],

  bins_csv: { ctx: base, filename: "calibrate-department-shown-bins.csv",
    text: "\"stated probability\",\"rows\",\"right\",\"mean stated\",\"share right\",\"low\",\"high\",\"verdict\"\r\n"
      + "\"0.4–0.5\",\"2\",\"0\",\"0.4250\",\"0.0000\",\"0.0000\",\"0.6576\",\"within its interval\"\r\n"
      + "\"0.7–0.8\",\"1\",\"1\",\"0.7000\",\"1.0000\",\"0.2065\",\"1.0000\",\"within its interval\"\r\n"
      + "\"0.8–0.9\",\"2\",\"2\",\"0.8500\",\"1.0000\",\"0.3424\",\"1.0000\",\"within its interval\"\r\n"
      + "\"0.9–1.0\",\"2\",\"2\",\"0.9250\",\"1.0000\",\"0.3424\",\"1.0000\",\"within its interval\"\r\n" },
}, { ctx: () => sampleCalibrateCtx() });

test("calibrate-reliability-bins: a stated probability of exactly 1 falls in the top bin, and odd rows are skipped", () => {
  const ctx = fakeCtx({ items: [{ top: 1, correct: true }, { top: 0.95, correct: false }, { top: null, correct: true }, { top: 1.2, correct: true }] });
  const fact = pack.features.find((f) => f.id === "bin_rows");
  assert.equal(fact.value(ctx.items()[0], ctx), 2);
  assert.equal(fact.value(ctx.items()[2], ctx), null);
  assert.equal(pack.features.find((f) => f.id === "stated_band").value({ top: 1 }), "0.9–1.0");
  for (const feature of pack.features.filter((f) => f.kind === "fact")) feature.value({}, fakeCtx({}));
});
