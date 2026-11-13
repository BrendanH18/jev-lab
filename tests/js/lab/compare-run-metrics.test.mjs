// Tests for the Compare run metrics pack (static/js/lab/packs/workbench/compare-run-metrics.js). Expected values are
// worked out by hand from tests/js/lab/fixtures/workbench-compare.mjs; the interval bounds, log losses and the 90th
// percentiles were computed separately in Python (statistics.NormalDist, math.log, type-7 interpolation by hand).
//
// The department run's labeled rows both variants answered: #1 billing (A right .7, B wrong .6), #2 shipping (A wrong
// .5, B right .8), #3 other (both right, .8 / .9), #6 shipping (both wrong, .52 / .5). Paired: 1 both right, 1 only A,
// 1 only B, 1 both wrong. Rows both answered: #1, #2, #3, #4, #6. B failed on #5 and was skipped on #7.
import assert from "node:assert/strict";

import { checkPack, fakeCtx } from "./harness.mjs";
import pack from "../../../static/js/lab/packs/workbench/compare-run-metrics.js";
import { COMPARE_REPORTS, sampleCompareRowsCtx } from "./fixtures/workbench-compare.mjs";

const dept = () => sampleCompareRowsCtx();
const urgent = () => sampleCompareRowsCtx({ qid: "urgent" });
const tone = () => sampleCompareRowsCtx({ qid: "tone" });
const spot = () => sampleCompareRowsCtx({ qid: "spot" });
const empty = sampleCompareRowsCtx({ result: null });
const paired = (both_right, a_only, b_only, both_wrong) => fakeCtx({ data: { paired: { both_right, a_only, b_only, both_wrong,
  rows: both_right + a_only + b_only + both_wrong, p_value: null } } });

// A hand-made Noul run of four labeled rows (signals written out, not computed, so the ties are exact):
//   r1 A .9 / B .8 yes, label yes: both right      signals .8 / .6
//   r2 A .7 yes / B .3 no, label no: only B right   signals .4 / .4 (tie)
//   r3 A .2 no / B .6 yes, label yes: only B right  signals .6 / .2
//   r4 A .9 / B .9 yes, label no: both wrong        signals .8 / .8 (tie)
const noulRow = (number, pa, pb, label, picks, signals, tops, correct) => ({ number, label, picks, signals, tops, correct,
  answers: [{ type: "noul", noul: pa }, { type: "noul", noul: pb }], meta: [null, null], errors: [null, null], skipped: [false, false] });
const noul = () => fakeCtx({
  items: [noulRow(1, 0.9, 0.8, true, ["yes", "yes"], [0.8, 0.6], [0.9, 0.8], [null, null]),
    noulRow(2, 0.7, 0.3, false, ["yes", "no"], [0.4, 0.4], [0.7, 0.7], [false, true]),
    noulRow(3, 0.2, 0.6, true, ["no", "yes"], [0.6, 0.2], [0.8, 0.6], [false, true]),
    noulRow(4, 0.9, 0.9, false, ["yes", "yes"], [0.8, 0.8], [0.9, 0.9], [null, null])],
  data: { type: "noul", paired: { both_right: 1, a_only: 0, b_only: 2, both_wrong: 1, rows: 4, p_value: 0.5 },
    scores: [{ labeled: 4, correct: 1 }, { labeled: 4, correct: 3 }] },
});
// A hand-made Choice run of two labeled rows where A states certainty: r1 label y, A x {x: 1, y: 0} wrong, B y {.5, .5}
// right; r2 label x, both pick x (A {1, 0}, B {.5, .5}) and are right. Paired: 1 both right, 1 only B.
const choiceRow = (label, pa, pb, probsA, probsB) => ({ label, picks: [pa, pb], signals: [1, 0], tops: [probsA[pa], probsB[pb]], correct: [null, null],
  answers: [{ type: "choice", choice: pa, probabilities: probsA }, { type: "choice", choice: pb, probabilities: probsB }] });
const certain = () => fakeCtx({
  items: [choiceRow("y", "x", "y", { x: 1, y: 0 }, { x: 0.5, y: 0.5 }), choiceRow("x", "x", "x", { x: 1, y: 0 }, { x: 0.5, y: 0.5 })],
  data: { type: "choice", paired: { both_right: 1, a_only: 0, b_only: 1, both_wrong: 0, rows: 2, p_value: 1 },
    scores: [{ labeled: 2, correct: 1 }, { labeled: 2, correct: 2 }] },
});
// The department run with a report that claims A got 3 right: the local reading no longer matches, so right/wrong
// measures must stay unavailable rather than disagree with the report.
const mismatched = () => {
  const report = COMPARE_REPORTS.department;
  return sampleCompareRowsCtx({ report: { ...report, variants: [{ ...report.variants[0], correct: 3 }, report.variants[1]] } });
};

checkPack(pack, {
  // (only B - only A) / rows: 0 / 4; urgent 1 / 2; 5/1/9/5 → 8 / 20. The 95% Agresti–Min interval adds 0.5 to each
  // cell and 2 to n, then takes the paired Wald interval; the bounds were computed separately in Python
  // (statistics.NormalDist().inv_cdf(0.975)): department ±0.56579, urgent -0.39820 to 0.89820, 5/1/9/5 0.11023 to 0.61705.
  accuracy_gain: [
    { ctx: dept(), expect: (r) => { assert.equal(r.value, 0); assert.match(r.detail, /^95% interval -56\.6% to 56\.6% over 4 labeled pairs$/); }, empty },
    { ctx: urgent(), expect: (r) => { assert.equal(r.value, 0.5); assert.match(r.detail, /^95% interval -39\.8% to 89\.8% over 2 labeled pairs$/); } },
    { ctx: paired(5, 1, 9, 5), expect: (r) => { assert.ok(Math.abs(r.value - 0.4) < 1e-12); assert.match(r.detail, /^95% interval 11\.0% to 61\.7% over 20 labeled pairs$/); } },
    { ctx: paired(0, 0, 0, 0), expect: null },
  ],
  // only B / (only A + only B) with a 95% Wilson interval (Python, as above): 1 of 2 → 9.5% to 90.5%; 1 of 1 → 20.7% to
  // 100%; 9 of 10 → 59.6% to 98.2%. Spot has no split row.
  b_win_share: [
    { ctx: dept(), expect: (r) => { assert.equal(r.value, 0.5); assert.equal(r.detail, "95% interval 9.5% to 90.5%"); }, empty },
    { ctx: urgent(), expect: (r) => { assert.equal(r.value, 1); assert.equal(r.detail, "95% interval 20.7% to 100.0%"); } },
    { ctx: paired(5, 1, 9, 5), expect: (r) => { assert.equal(r.value, 0.9); assert.equal(r.detail, "95% interval 59.6% to 98.2%"); } },
    { ctx: spot(), expect: null },
  ],
  // A wrong = only B + both wrong, B wrong = only A + both wrong: department 2 and 2; urgent 1 and 0; 5/1/9/5 14 and 6.
  error_reduction: [{ ctx: dept(), expect: 0, empty }, { ctx: urgent(), expect: 1 }, { ctx: tone(), expect: null }, { ctx: paired(5, 1, 9, 5), expect: 8 / 14 }],
  // (rows - both wrong) / rows: 3 / 4; 2 / 2; 15 / 20.
  either_right: [{ ctx: dept(), expect: 0.75, empty }, { ctx: urgent(), expect: 1 }, { ctx: paired(5, 1, 9, 5), expect: 0.75 }],
  // only A / (only A + both wrong): 1 / 2; tone 1 / 1; urgent has no B mistake; 1 / 6.
  a_covers_b: [{ ctx: dept(), expect: 0.5, empty }, { ctx: tone(), expect: 1 }, { ctx: urgent(), expect: null }, { ctx: paired(5, 1, 9, 5), expect: 1 / 6 }],
  // only B / (only B + both wrong): 1 / 2; urgent 1 / 1; tone has no A mistake; 9 / 14.
  b_covers_a: [{ ctx: dept(), expect: 0.5, empty }, { ctx: urgent(), expect: 1 }, { ctx: tone(), expect: null }, { ctx: paired(5, 1, 9, 5), expect: 9 / 14 }],
  // Exact two-sided McNemar: 2 split rows can never reach p < 0.05; 6-0 gives 2/64; of 10, 9-1 gives 22/1024 while
  // 8-2 gives 112/1024.
  wins_needed: [
    { ctx: dept(), expect: null, empty },
    { ctx: paired(0, 0, 6, 0), expect: 6 },
    { ctx: paired(5, 1, 9, 5), expect: 9 },
    // 5-0 gives 2/32 = 0.0625, not below 0.05: five split rows can never be enough.
    { ctx: paired(3, 0, 5, 0), expect: null },
  ],
  // Picks on #1, #2, #3, #4, #6: A billing ×3, wholesale, other; B shipping ×3, other ×2. Observed 1/5, chance
  // (1/5)(2/5) = 2/25 → (1/5 - 2/25) / (1 - 2/25) = 3/23. Box picks have no kappa.
  // Hand Noul run: picks yes/yes, yes/no, no/yes, yes/yes → observed 1/2, chance (3/4)² + (1/4)² = 5/8 → -1/3.
  pick_kappa: [{ ctx: dept(), expect: 3 / 23, empty }, { ctx: noul(), expect: -1 / 3 }, { ctx: spot(), expect: null }],
  // Department: #6 billing vs other → 0. Hand Noul run: r4 both said yes → 1.
  same_wrong_answer: [{ ctx: dept(), expect: 0, empty }, { ctx: noul(), expect: 1 }, { ctx: mismatched(), expect: null }],
  // Department: #1 A surer (right), #2 B surer (right), #3 agree (right), #6 A surer (wrong) → 3/4.
  // Hand Noul run: r1 A surer right; r2 tie → A, wrong; r3 A surer, wrong; r4 tie → A, wrong → 1/4.
  surer_pick_accuracy: [{ ctx: dept(), expect: 0.75, empty }, { ctx: noul(), expect: 0.25 }],
  // Department means: #1 billing .5 (right), #2 shipping .575 (right), #3 other .85 (right), #6 billing .36 against
  // other .29 (wrong) → 3/4. Hand Noul run mean P(yes): .85 yes right, .5 yes wrong, .4 no wrong, .9 yes wrong → 1/4.
  averaged_accuracy: [{ ctx: dept(), expect: 0.75, empty }, { ctx: noul(), expect: 0.25 }, { ctx: spot(), expect: null }],

  // (.7-1)² + .5² + (.8-1)² + .52² = .6504 / 4; hand Noul run A: .1² + .7² + .8² + .9² = 1.95 / 4.
  brier_a: [{ ctx: dept(), expect: 0.1626, empty }, { ctx: noul(), expect: 0.4875 }, { ctx: mismatched(), expect: null }],
  // .6² + (.8-1)² + (.9-1)² + .5² = .66 / 4.
  // Hand Noul run B: (.8-1)² + (.7-1)² + (.6-1)² + .9² = 1.1 / 4.
  brier_b: [{ ctx: dept(), expect: 0.165, empty }, { ctx: noul(), expect: 0.275 }],
  // The probability each variant gave the LABELED answer (computed in Python with math.log):
  //   department A: billing .7, shipping .35, other .8, shipping .3; B: billing .3, shipping .8, other .9, shipping .2
  //   hand Noul run A: P(yes) .9 (yes), 1 - .7 (no), .2 (yes), 1 - .9 (no); B: .8, 1 - .3, .6, 1 - .9
  //   hand Choice run: A gave the label y probability 0, clipped to 1e-15 → (15 ln 10 + ~0) / 2.
  log_loss_a: [{ ctx: dept(), expect: 0.708403356019389, empty }, { ctx: noul(), expect: 1.305339081352977 }, { ctx: certain(), expect: 17.269388197455342 },
    { ctx: spot(), expect: null }, { ctx: mismatched(), expect: null }],
  log_loss_b: [{ ctx: dept(), expect: 0.7854786959330181, empty }, { ctx: noul(), expect: 0.8483073030032446 }, { ctx: certain(), expect: Math.log(2) }],
  // Department: every right signal is above every wrong one for both. Hand Noul run A: right .8 against wrong .4, .6,
  // .8 → (1 + 1 + .5) / 3; B: right .6, .4, .2 against wrong .8 → 0. Tone has no wrong A answer.
  auroc_a: [{ ctx: dept(), expect: 1, empty }, { ctx: noul(), expect: 2.5 / 3 }, { ctx: tone(), expect: null }],
  auroc_b: [{ ctx: dept(), expect: 1, empty }, { ctx: noul(), expect: 0 }],
  // Mean probability minus accuracy: A .63 - .5; B .7 - .5; urgent B (.88 + .6) / 2 - 1.
  // Hand Noul run A: (.9 + .7 + .8 + .9) / 4 - 1/4.
  overconfidence_a: [{ ctx: dept(), expect: 0.13, empty }, { ctx: noul(), expect: 0.575 }],
  overconfidence_b: [{ ctx: dept(), expect: 0.2, empty }, { ctx: urgent(), expect: -0.26 }],
  // Rows both answered: A (.6 + .3 + .7 + .85 + .36) / 5; B (.45 + .7 + .85 + .4 + .33) / 5.
  // Hand Noul run: A (.8 + .4 + .6 + .8) / 4, B (.6 + .4 + .2 + .8) / 4.
  mean_signal_a: [{ ctx: dept(), expect: 0.562, empty }, { ctx: noul(), expect: 0.65 }],
  mean_signal_b: [{ ctx: dept(), expect: 0.546, empty }, { ctx: noul(), expect: 0.5 }],
  // Department agrees on #3 only: .85 - .7. Urgent agrees on #1, #3, #4, #6: -.06 - .06 - .08 + .2 = 0.
  signal_shift_agreeing: [{ ctx: dept(), expect: 0.15, empty }, { ctx: urgent(), expect: 0 }],

  // A's seven calls 380 390 400 400 410 420 450: position 5.4 → 420 + .4 × 30. B's five returned calls 470 500 530
  // 560 610 (the failed call on #5 does not count): position 3.6 → 560 + .6 × 50.
  latency_p90_a: [{ ctx: dept(), expect: 432, empty }],
  latency_p90_b: [{ ctx: dept(), expect: 590, empty }],
  // A's slowest call is row #5 (450 ms); B's is #4 (610 ms), not the failed #5.
  latency_max_a: [{ ctx: dept(), expect: (r) => { assert.equal(r.value, 450); assert.equal(r.detail, "row #5 (the table's numbering)"); }, empty }],
  latency_max_b: [{ ctx: dept(), expect: (r) => { assert.equal(r.value, 610); assert.equal(r.detail, "row #4 (the table's numbering)"); }, empty }],
  // B - A on #1, #2, #3, #4, #6: 160 + 120 + 80 + 190 + 120 = 670 / 5.
  latency_paired_diff: [{ ctx: dept(), expect: 134, empty }],
  // Scored rows #1, #2, #3, #6: A .0004 / 2 right; B .001 / 2 right; tone: B got its only row wrong.
  cost_per_correct_a: [{ ctx: dept(), expect: 0.0002, empty }],
  cost_per_correct_b: [{ ctx: dept(), expect: 0.0005, empty }, { ctx: tone(), expect: null }],
  // Rows both answered: B .0012 over A .0005.
  cost_ratio: [{ ctx: dept(), expect: 2.4, empty }],
  // 40 output tokens per returned call: A 7 calls, B 5 (#5 failed, #7 skipped).
  output_tokens_a: [{ ctx: dept(), expect: 280, empty }],
  output_tokens_b: [{ ctx: dept(), expect: 200, empty }],
  // The run cost .0019 over 4 scored department rows, over 2 urgent ones.
  cost_per_scored_row: [{ ctx: dept(), expect: 0.000475, empty }, { ctx: urgent(), expect: 0.00095 }],
}, { ctx: () => sampleCompareRowsCtx() });
