// Tests for the tb-thresholds Toolbox pack. Reference values were worked out independently of the pack: counts by
// hand from the small pastes below, and in a separate stdlib Python script that recounts the rows at or above every
// threshold, computes Wilson bounds from the textbook formula, averages AURC over every order of tied confidences with
// exact fractions, and searches every lower/upper threshold pair and every two-question threshold pair by brute force.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-thresholds.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

// Ten rows, six right. Sweep (threshold: automated, right): 0.95: 1/1, 0.9: 3/3, 0.85: 4/3, 0.8: 5/4, 0.7: 7/5, 0.6: 8/6, 0.5: 9/6, 0.4: 10/6.
const T = "confidence,correct\n0.95,1\n0.9,1\n0.9,yes\n0.85,0\n0.8,1\n0.7,1\n0.7,no\n0.6,1\n0.5,0\n0.4,0";
const T_CONFIDENCES = "0.95 0.9 0.9 0.85 0.8\n0.7, 0.7; 0.6\t0.5 0.4";
const BAD = [{ pairs: "" }, { pairs: "0.5,maybe" }, { pairs: "1.2,1" }, { pairs: "0.5,1,0" }, { pairs: "0.5,1\nx,0" }];
// label,choice,confidence for a Choice question.
const C = "label,choice,confidence\nrefund,refund,0.95\nrefund,refund,0.9\nexchange,refund,0.8\nrefund,refund,0.7\nexchange,exchange,0.9\nexchange,exchange,0.6\nrefund,exchange,0.55\nother,other,0.5\nexchange,other,0.45";
const BAD_CHOICE = [{ rows: "" }, { rows: "refund,refund" }, { rows: "refund,refund,1.4" }, { rows: "refund,,0.5" }, { rows: "a,b,c\nrefund,refund,x" }];
// Two questions' confidences and whether the row's decision was right.
const M = "q1,q2,correct\n0.9,0.9,1\n0.9,0.6,1\n0.85,0.95,0\n0.7,0.9,1\n0.95,0.8,1\n0.6,0.5,0\n0.8,0.75,0\n0.75,0.85,1";
// A yes/no question: score is the probability of yes, outcome whether the answer was yes.
const B = "0.95,1\n0.9,1\n0.8,0\n0.7,1\n0.6,1\n0.5,0\n0.4,1\n0.3,0\n0.2,0\n0.1,0";

const near = (expected, tolerance = 1e-9) => (result) => {
  assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
  expected.forEach(([label, value], i) => approx(result.rows[i][1], value, tolerance, label));
};
const tableIs = (columns, rows) => (result) => {
  assert.deepEqual(result.table.columns, columns);
  assert.equal(result.table.rows.length, rows.length);
  rows.forEach((row, i) => row.forEach((cell, j) => approx(result.table.rows[i][j], cell, 1e-9, `row ${i + 1} cell ${j + 1}:`)));
};
const both = (...checks) => (result) => checks.forEach((check) => check(result));

checkPack(pack, {
  // From 0.8 to 0.6: rows 6 (0.7 right), 7 (0.7 wrong) and 8 (0.6 right) move into automation.
  threshold_change: { values: { pairs: T, current: "0.8", next: "0.6" }, expect: both(near([["Automated at the current threshold", 5], ["Automated at the new threshold", 8], ["Coverage now", 0.5],
    ["Coverage after", 0.8], ["Accuracy now", 0.8], ["Accuracy after", 0.75], ["Errors automated now", 1], ["Errors automated after", 2], ["Rows that move", 3], ["They move", "into automation"],
    ["Accuracy of the rows that move", 2 / 3]]), tableIs(["Row", "Confidence", "Correct"], [[6, 0.7, "yes"], [7, 0.7, "no"], [8, 0.6, "yes"]])),
  more: [
    { values: { pairs: T, current: "0.6", next: "0.8" }, expect: (result) => { assert.equal(result.rows[9][1], "to review"); assert.equal(result.table.rows.length, 3); } },
    // a confidence equal to the threshold clears it: at 0.7 both 0.7 rows are automated, so nothing moves from 0.7 to 0.7
    { values: { pairs: T, current: "0.7", next: "0.7" }, expect: (result) => { assert.equal(result.rows[0][1], 7); assert.equal(result.rows[8][1], 0); assert.equal(result.rows[9][1], "nowhere"); assert.equal(result.rows[10][1], null); } },
    { values: { pairs: T, current: "0.99", next: "0.99" }, expect: (result) => assert.equal(result.rows[4][1], null) },
  ],
  invalid: [...BAD, { pairs: T, current: "1.5", next: "0.5" }] },
  // Wilson 95% lower ends: 0.95 → 0.2065, 0.9 → 0.4385, 0.85 → 0.3006, 0.8 → 0.3755, 0.7 → 0.3589, 0.6 → 0.4093, 0.5 → 0.3542, 0.4 → 0.3127.
  threshold_lower_bound: { values: { pairs: T, target: "0.4" }, expect: [["Threshold (confidence ≥)", 0.6], ["Rows automated", 8], ["Coverage", 0.8], ["Accuracy there", 0.75],
    ["Lower bound there", 0.40927543031016883], ["Lowest threshold by point accuracy", 0.4], ["Coverage by point accuracy", 1]],
  more: [{ values: { pairs: T, target: "0.95" }, expect: (result) => {
    near([["Threshold (confidence ≥)", null], ["Rows automated", 0], ["Coverage", 0], ["Accuracy there", null], ["Lower bound there", null], ["Lowest threshold by point accuracy", 0.9], ["Coverage by point accuracy", 0.3]])(result);
    assert.match(result.note, /label more rows/);
  } }],
  invalid: [...BAD, { pairs: T, target: "0.9", level: "0.8" }] },
  // Review 1, mistake 5: nothing 10; 0.95 → 9; 0.9 → 7; 0.85 → 11; 0.8 → 10; 0.7 → 13; 0.6 → 12; 0.5 → 16; 0.4 → 20.
  lowest_cost_review: { values: { pairs: T, review: "1", error: "5", current: "0.8" }, expect: [["Best threshold (confidence ≥)", 0.9], ["Rows automated", 3], ["Rows reviewed", 7], ["Errors automated", 0],
    ["Total cost", 7], ["Cost per row", 0.7], ["Cost of reviewing every row", 10], ["Cost of automating every row", 20], ["Cost at the current threshold", 10], ["Saving against the current threshold", 3]],
  more: [
    // cheap mistakes: automating every row costs 4 × 0.5 = 2, the least
    { values: { pairs: T, review: "1", error: "0.5" }, expect: (result) => { approx(result.rows[0][1], 0.4); approx(result.rows[4][1], 2); assert.equal(result.rows[8][1], null); assert.equal(result.rows[9][1], null); } },
    // free review: automating nothing ties with 0.95 and 0.9 at 0, and the tie goes to automating fewer rows
    { values: { pairs: T, review: "0", error: "1" }, expect: (result) => { assert.equal(result.rows[0][1], "above top confidence"); approx(result.rows[4][1], 0); } },
  ],
  invalid: [...BAD, { pairs: T, review: "-1" }] },
  risk_coverage_table: { values: { pairs: T }, expect: tableIs(["Threshold (confidence ≥)", "Automated", "Coverage", "Accuracy", "Errors", "Accuracy lower bound"], [
    [0.95, 1, 0.1, 1, 0, 0.20654931437723745], [0.9, 3, 0.3, 1, 0, 0.43850296824495455], [0.85, 4, 0.4, 0.75, 1, 0.30064184258240184], [0.8, 5, 0.5, 0.8, 1, 0.3755346297625253],
    [0.7, 7, 0.7, 5 / 7, 2, 0.35893445183261935], [0.6, 8, 0.8, 0.75, 2, 0.40927543031016883], [0.5, 9, 0.9, 2 / 3, 3, 0.3542021355803963], [0.4, 10, 1, 0.6, 4, 0.31267376973365824]]),
  invalid: BAD },
  // Python: the mean risk over k averaged over all 4 orders of the tied rows (exact fractions); optimal = (1/7 + 2/8 + 3/9 + 4/10)/10.
  risk_coverage_area: { values: { pairs: T }, expect: [["AURC", 0.19690476190476192], ["Optimal AURC at this error rate", 0.11261904761904762], ["Excess AURC", 0.08428571428571428],
    ["Error rate at full coverage", 0.4], ["Rows", 10]],
  more: [{ values: { pairs: "0.9,1\n0.9,0" }, expect: [["AURC", 0.5], ["Optimal AURC at this error rate", 0.25], ["Excess AURC", 0.25], ["Error rate at full coverage", 0.5], ["Rows", 2]] }],
  invalid: BAD },
  threshold_for_coverage: { values: { pairs: T, coverage: "0.75" }, expect: [["Threshold (confidence ≥)", 0.6], ["Coverage there", 0.8], ["Rows automated", 8], ["Rows reviewed", 2],
    ["Accuracy there", 0.75], ["Errors automated", 2]],
  more: [{ values: { pairs: T_CONFIDENCES, shape: "confidences", coverage: "0.3" }, expect: [["Threshold (confidence ≥)", 0.9], ["Coverage there", 0.3], ["Rows automated", 3], ["Rows reviewed", 7],
    ["Accuracy there", null], ["Errors automated", null]] },
  { values: { pairs: T, coverage: "1" }, expect: (result) => approx(result.rows[0][1], 0.4) }],
  invalid: [...BAD, { pairs: T_CONFIDENCES, coverage: "0.5" }, { pairs: "0.5, x", shape: "confidences" }, { pairs: T, coverage: "1.1" }] },
  // Mistakes ÷ rows × 1,000 per day: 0.85 and 0.8 → 100 (within 150), 0.7 → 200.
  error_budget: { values: { pairs: T, volume: "1000", budget: "150" }, expect: [["Threshold (confidence ≥)", 0.8], ["Coverage", 0.5], ["Accuracy there", 0.8], ["Automated rows per day", 500],
    ["Automated mistakes per day", 100], ["Reviews per day", 500]],
  more: [{ values: { pairs: T, volume: "1000", budget: "0" }, expect: [["Threshold (confidence ≥)", 0.9], ["Coverage", 0.3], ["Accuracy there", 1], ["Automated rows per day", 300],
    ["Automated mistakes per day", 0], ["Reviews per day", 700]] },
  { values: { pairs: "0.9,0\n0.5,1", volume: "200", budget: "0" }, expect: [["Threshold (confidence ≥)", "above top confidence"], ["Coverage", 0], ["Accuracy there", null], ["Automated rows per day", 0],
    ["Automated mistakes per day", 0], ["Reviews per day", 200]] }],
  invalid: [...BAD, { pairs: T, volume: "-5" }] },
  confident_mistakes: { values: { pairs: T, threshold: "0.4" }, expect: both(near([["Automated mistakes", 4], ["Rows automated", 10], ["Share of automated rows", 0.4]]),
    tableIs(["Row", "Confidence"], [[4, 0.85], [7, 0.7], [9, 0.5], [10, 0.4]])),
  more: [{ values: { pairs: T, threshold: "0.8" }, expect: both(near([["Automated mistakes", 1], ["Rows automated", 5], ["Share of automated rows", 0.2]]), tableIs(["Row", "Confidence"], [[4, 0.85]])) },
    { values: { pairs: T, threshold: "1" }, expect: (result) => { assert.equal(result.rows[2][1], null); assert.equal(result.table.rows.length, 0); } }],
  invalid: BAD },
  // At 0.7, k = 2: the lowest automated rows are the two 0.7s (one right); the highest reviewed are 0.6 (right) and 0.5 (wrong).
  edge_accuracy: { values: { pairs: T, threshold: "0.7", k: "2" }, expect: [["Automated edge rows", 2], ["Automated edge accuracy", 0.5], ["Automated edge confidence from", 0.7],
    ["Automated edge confidence to", 0.7], ["Reviewed edge rows", 2], ["Reviewed edge accuracy", 0.5], ["Reviewed edge confidence from", 0.5], ["Reviewed edge confidence to", 0.6],
    ["Accuracy of all automated rows", 5 / 7]],
  more: [
    // at 0.75, k = 1: the reviewed edge is one of the tied 0.7 rows, right in one order of two: ½
    { values: { pairs: T, threshold: "0.75", k: "1" }, expect: [["Automated edge rows", 1], ["Automated edge accuracy", 1], ["Automated edge confidence from", 0.8], ["Automated edge confidence to", 0.8],
      ["Reviewed edge rows", 1], ["Reviewed edge accuracy", 0.5], ["Reviewed edge confidence from", 0.7], ["Reviewed edge confidence to", 0.7], ["Accuracy of all automated rows", 0.8]] },
    { values: { pairs: T, threshold: "0.7", k: "20" }, expect: [["Automated edge rows", 7], ["Automated edge accuracy", 5 / 7], ["Automated edge confidence from", 0.7], ["Automated edge confidence to", 0.95],
      ["Reviewed edge rows", 3], ["Reviewed edge accuracy", 1 / 3], ["Reviewed edge confidence from", 0.4], ["Reviewed edge confidence to", 0.6], ["Accuracy of all automated rows", 5 / 7]] },
    { values: { pairs: T, threshold: "0.99", k: "3" }, expect: (result) => { assert.equal(result.rows[0][1], 0); assert.equal(result.rows[1][1], null); assert.equal(result.rows[8][1], null); } },
  ],
  invalid: [...BAD, { pairs: T, k: "0" }] },
  // refund: 0.95 1/1, 0.9 2/2, 0.8 2/3, 0.7 3/4 → 0.7; exchange: 0.9, 0.6 2/2, 0.55 2/3 → 0.6; other: 0.5 1/1, 0.45 1/2 → 0.5.
  // Shared: 0.95, 0.9 ×2 → 3/3, 0.8 → 3/4, 0.7 → 4/5, 0.6 → 5/6, 0.55 → 5/7, 0.5 → 6/8 = 0.75, 0.45 → 6/9: lowest 0.5.
  per_choice_thresholds: { values: { rows: C, target: "0.75" }, expect: both(near([["Coverage with these thresholds", 7 / 9], ["Accuracy with these thresholds", 6 / 7],
    ["One shared threshold for the target", 0.5], ["Coverage with the shared threshold", 8 / 9], ["Accuracy with the shared threshold", 0.75]]),
  tableIs(["Choice", "Rows given", "Threshold (confidence ≥)", "Automated", "Accuracy there"], [["exchange", 3, 0.6, 2, 1], ["other", 2, 0.5, 1, 1], ["refund", 4, 0.7, 4, 0.75]])),
  more: [
    { values: { rows: C, target: "1" }, expect: (result) => { approx(result.rows[0][1], 5 / 9); approx(result.rows[2][1], 0.9); approx(result.rows[3][1], 3 / 9); approx(result.table.rows[2][2], 0.9); } },
    { values: { rows: "a\tb\t0.9\nb\tb\t0.8", target: "0.9" }, expect: both(near([["Coverage with these thresholds", 0], ["Accuracy with these thresholds", null], ["One shared threshold for the target", null],
      ["Coverage with the shared threshold", 0], ["Accuracy with the shared threshold", null]]), tableIs(["Choice", "Rows given", "Threshold (confidence ≥)", "Automated", "Accuracy there"], [["b", 2, "none reaches the target", 0, "—"]])) },
  ],
  invalid: BAD_CHOICE },
  // At 0.6 six rows are automated: refund ×4 as answered (3 right), exchange ×2 (both right).
  per_class_at_threshold: { values: { rows: C, threshold: "0.6" }, expect: both(near([["Coverage", 6 / 9], ["Accuracy of automated rows", 5 / 6]]),
    tableIs(["Class", "Rows labeled", "Automated as this answer", "Right among those", "Labeled rows automated correctly"], [["exchange", 4, 2, 1, 0.5], ["other", 1, 0, "—", 0], ["refund", 4, 4, 0.75, 0.75]])),
  invalid: BAD_CHOICE },
  automated_mistakes: { values: { rows: `${C}\nexchange,refund,0.65`, threshold: "0.45" }, expect: both(near([["Rows automated", 10], ["Automated mistakes", 4], ["Accuracy of automated rows", 0.6]]),
    tableIs(["Right label", "Answer given", "Mistakes", "Share of mistakes", "Highest confidence"], [["exchange", "refund", 2, 0.5, 0.8], ["exchange", "other", 1, 0.25, 0.45], ["refund", "exchange", 1, 0.25, 0.55]])),
  more: [{ values: { rows: C, threshold: "0.7" }, expect: both(near([["Rows automated", 5], ["Automated mistakes", 1], ["Accuracy of automated rows", 0.8]]),
    tableIs(["Right label", "Answer given", "Mistakes", "Share of mistakes", "Highest confidence"], [["exchange", "refund", 1, 1, 0.8]])) }],
  invalid: BAD_CHOICE },
  // Brute force over every pair: at 90%, yes at ≥ 0.9 (2 right) and no below 0.4 (3 right) automate 5; at 80%, 0.6 for both automates all 10 with 8 right.
  best_review_band: { values: { pairs: B, target: "0.9" }, expect: [["Lower threshold (below it: no)", 0.4], ["Upper threshold (at or above it: yes)", 0.9], ["Decided yes", 2], ["Accuracy of yes", 1],
    ["Decided no", 3], ["Accuracy of no", 1], ["Sent to review", 5], ["Automated share", 0.5], ["Accuracy of automated decisions", 1]],
  more: [
    { values: { pairs: B, target: "0.8" }, expect: [["Lower threshold (below it: no)", 0.6], ["Upper threshold (at or above it: yes)", 0.6], ["Decided yes", 5], ["Accuracy of yes", 0.8],
      ["Decided no", 5], ["Accuracy of no", 0.8], ["Sent to review", 0], ["Automated share", 1], ["Accuracy of automated decisions", 0.8]] },
    // everything is no: the lower threshold sits above the top score and nothing is decided yes
    { values: { pairs: "0.3,0\n0.6,0", target: "1" }, expect: (result) => { assert.equal(result.rows[0][1], "above top score"); assert.equal(result.rows[2][1], 0); assert.equal(result.rows[3][1], null); assert.equal(result.rows[4][1], 2); } },
    { values: { pairs: "0.5,1\n0.5,0", target: "0.9" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /No pair/); } },
  ],
  invalid: [{ pairs: "" }, { pairs: "0.5,maybe" }, { pairs: "high,1\n0.4,0" }] },
  // Row by row at 0.8 and 0.7 (0.8 clears 0.8): automated rows 1, 3, 5, 7 (two right). Without q1: rows 1, 3, 4, 5, 7, 8 (four right); without q2: 1, 2, 3, 5, 7 (three right).
  multi_question_gate: { values: { thresholds: "0.8, 0.7", rows: M }, expect: both(near([["Rows automated", 4], ["Coverage", 0.5], ["Accuracy", 0.5], ["Errors automated", 2]]),
    tableIs(["Question", "Threshold", "Rows it blocks", "Rows only it blocks", "Coverage without it", "Accuracy without it"], [[1, 0.8, 3, 2, 0.75, 2 / 3], [2, 0.7, 2, 1, 5 / 8, 0.6]])),
  more: [{ values: { thresholds: "0.5 0.5 0.9", rows: "0.6 0.6 0.95 1\n0.6 0.6 0.5 0" }, expect: both(near([["Rows automated", 1], ["Coverage", 0.5], ["Accuracy", 1], ["Errors automated", 0]]),
    tableIs(["Question", "Threshold", "Rows it blocks", "Rows only it blocks", "Coverage without it", "Accuracy without it"], [[1, 0.5, 0, 0, 0.5, 1], [2, 0.5, 0, 0, 0.5, 1], [3, 0.9, 1, 1, 1, 0.5]])) }],
  invalid: [{ thresholds: "", rows: M }, { thresholds: "0.8, x", rows: M }, { thresholds: "0.8, 1.2", rows: M }, { thresholds: "0.8", rows: M }, { thresholds: "0.8, 0.7", rows: "0.9,0.9,maybe" }] },
  // Brute force over every pair of distinct confidences (Python): at 75%, (0.7, 0.8) automates rows 1, 3, 4, 5, 8 with 4 right.
  two_question_search: { values: { rows: M, target: "0.75" }, expect: [["Threshold for question 1", 0.7], ["Threshold for question 2", 0.8], ["Rows automated", 5], ["Coverage", 5 / 8], ["Accuracy", 0.8],
    ["Best coverage gating question 1 alone", 0.5], ["Best coverage gating question 2 alone", 0.625]],
  more: [{ values: { rows: M, target: "1" }, expect: [["Threshold for question 1", 0.9], ["Threshold for question 2", 0.6], ["Rows automated", 3], ["Coverage", 3 / 8], ["Accuracy", 1],
    ["Best coverage gating question 1 alone", 0.375], ["Best coverage gating question 2 alone", 0]] },
  { values: { rows: "0.9,0.9,0", target: "0.5" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.equal(result.rows[2][1], 0); assert.match(result.note, /No pair/); } }],
  invalid: [{ rows: "" }, { rows: "0.9,0.9" }, { rows: "0.9,1.9,1" }, { rows: M, target: "2" }] },
}, { ctx: () => fakeCtx({}) });
