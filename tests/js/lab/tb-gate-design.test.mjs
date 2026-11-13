// Tests for the tb-gate-design Toolbox pack. Reference values were worked out independently of the pack: products,
// sums and ratios by hand (shown beside each case), and Poisson and binomial values in a separate stdlib Python script
// that sums the probability terms directly (log-gamma terms for Poisson, exact fractions for the binomial audit
// sizes scanned one row count at a time) and finds Clopper–Pearson bounds by bisection on the exact binomial sum.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tb-gate-design.js";
import { approx, checkPack } from "./harness.mjs";

const Q3 = "intent, 0.9, 0.97\nrefund_amount, 0.8, 0.95\nurgent, 0.75, 0.99";
const tableIs = (columns, rows, tolerance = 1e-9) => (result) => {
  assert.deepEqual(result.table.columns, columns);
  assert.equal(result.table.rows.length, rows.length);
  rows.forEach((row, i) => row.forEach((cell, j) => approx(result.table.rows[i][j], cell, tolerance, `row ${i + 1} cell ${j + 1}:`)));
};
const rowsAre = (expected, tolerance = 1e-9) => (result) => {
  assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
  expected.forEach(([label, value], i) => approx(result.rows[i][1], value, tolerance, label));
};
const both = (...checks) => (result) => checks.forEach((check) => check(result));

checkPack(pack, {
  // C = 0.9 · 0.8 · 0.75 = 0.54; A = 0.97 · 0.95 · 0.99 = 0.912285; 540 automated a day, 540 · 0.087715 = 47.3661 mistakes.
  // Without intent: 0.8 · 0.75 = 0.6 and 0.95 · 0.99 = 0.9405; only it blocks 0.6 · 0.1 = 0.06 (and so on).
  and_gate_rates: {
    values: { questions: Q3, volume: "1000" },
    expect: both(rowsAre([["Questions", 3], ["Gate coverage", 0.54], ["Gate accuracy", 0.912285], ["Gate error rate", 0.087715], ["Share sent to review", 0.46],
      ["Automated rows per day", 540], ["Automated mistakes per day", 47.3661]]),
    tableIs(["Question", "Coverage", "Accuracy", "Gate coverage without it", "Gate accuracy without it", "Share of rows only it blocks"],
      [["intent", 0.9, 0.97, 0.6, 0.9405, 0.06], ["refund_amount", 0.8, 0.95, 0.675, 0.9603, 0.135], ["urgent", 0.75, 0.99, 0.72, 0.9215, 0.18]])),
    more: [
      // a header line is skipped, names may be left out, and no volume leaves the daily rows unavailable
      { values: { questions: "name,coverage,accuracy\n0.5, 0.9\n0.5, 0.8" }, expect: (result) => {
        approx(result.rows[1][1], 0.25); approx(result.rows[2][1], 0.72); assert.equal(result.rows[5][1], null); assert.equal(result.rows[6][1], null);
        assert.deepEqual(result.table.rows.map((row) => row[0]), ["Question 1", "Question 2"]);
      } },
    ],
    invalid: [{ questions: "" }, { questions: "a, 1.2, 0.9" }, { questions: "a, 0.9" }, { questions: "a, 0.9, 0.9, 0.9" }, { questions: Q3, volume: "-1" }],
  },
  // Σc − 2 = 0.45, min c = 0.75; errors 0.03, 0.05, 0.01: max 0.05, sum 0.09.
  and_gate_bounds: {
    values: { questions: Q3 },
    expect: [["Lowest coverage", 0.45], ["Coverage if independent", 0.54], ["Highest coverage", 0.75], ["Lowest error rate", 0.05], ["Error rate if independent", 0.087715],
      ["Highest error rate", 0.09], ["Lowest accuracy", 0.91]],
    // 0.5 + 0.5 − 1 = 0; errors 0.6 + 0.7 cap at 1
    more: [{ values: { questions: "a,0.5,0.4\nb,0.5,0.3" }, expect: [["Lowest coverage", 0], ["Coverage if independent", 0.25], ["Highest coverage", 0.5], ["Lowest error rate", 0.7],
      ["Error rate if independent", 0.88], ["Highest error rate", 1], ["Lowest accuracy", 0]] }],
    invalid: [{ questions: "" }, { questions: "a, 0.9, x" }],
  },
  // 0.9³ = 0.729 and 0.95³ = 0.857375; (1 − 0.857375) / 3 = 0.047541666…
  per_question_targets: {
    values: { k: "3", coverage: "0.729", accuracy: "0.857375" },
    // any dependence: Σ(1 − cᵢ) ≤ 1 − C, so each question may send (1 − 0.729) / 3 = 0.090333… to review.
    expect: [["Coverage each question needs (independent)", 0.9], ["Accuracy each question needs (independent)", 0.95], ["Coverage each question needs (any dependence)", 1 - 0.271 / 3],
      ["Error budget per question (any dependence)", 0.142625 / 3],
      ["Accuracy each question needs (any dependence)", 1 - 0.142625 / 3]],
    invalid: [{ k: "0", coverage: "0.5", accuracy: "0.9" }, { k: "2", coverage: "1.5", accuracy: "0.9" }],
  },
  // 0.9 · 0.8 = 0.72 and 0.97 · 0.95 = 0.9215; 0.6 / 0.72 = 0.8333…, 0.9 / 0.9215 = 0.97667…
  last_question_needs: {
    values: { questions: "0.9, 0.97\n0.8, 0.95", coverage: "0.6", accuracy: "0.9" },
    expect: [["Coverage of the questions so far", 0.72], ["Accuracy of the questions so far", 0.9215], ["Coverage the new question needs", 0.6 / 0.72],
      ["Accuracy the new question needs", 0.9 / 0.9215], ["Within reach", "yes"]],
    more: [
      { values: { questions: "0.9, 0.97\n0.8, 0.95", coverage: "0.6", accuracy: "0.95" }, expect: (result) => { assert.equal(result.rows[3][1], null); assert.equal(result.rows[4][1], "no: accuracy"); } },
      { values: { questions: "0.9, 0.97\n0.8, 0.95", coverage: "0.8", accuracy: "0.95" }, expect: (result) => { assert.equal(result.rows[2][1], null); assert.equal(result.rows[4][1], "no: coverage and accuracy"); } },
    ],
    invalid: [{ questions: "", coverage: "0.5", accuracy: "0.9" }],
  },
  // Blocked rows: (0.94 − 0.9 · 0.97) / 0.1 = 0.67. 8,000 automated: 480 mistakes now, 8,000 · 0.9 · 0.03 = 216 after,
  // 264 avoided, 800 extra reviews; cost change 800 · 1 − 264 · 20 = −4,480.
  guard_question_value: {
    values: { coverage: "0.8", accuracy: "0.94", keep: "0.9", after: "0.97", volume: "10000", review: "1", mistake: "20" },
    expect: [["Coverage after", 0.72], ["Accuracy after", 0.97], ["Accuracy of the rows it blocks", 0.67], ["Automated mistakes per month now", 480], ["Automated mistakes per month after", 216],
      ["Mistakes avoided per month", 264], ["Extra reviews per month", 800], ["Reviews per mistake avoided", 800 / 264], ["Change in monthly cost (USD)", -4480], ["Worth adding", "yes"]],
    // cheap mistakes: 800 − 264 · 2 = 272 more a month
    more: [{ values: { coverage: "0.8", accuracy: "0.94", keep: "0.9", after: "0.97", volume: "10000", review: "1", mistake: "2" }, expect: (result) => {
      approx(result.rows[8][1], 272); assert.equal(result.rows[9][1], "no");
    } }],
    invalid: [{ coverage: "0.8", accuracy: "0.4", keep: "0.5", after: "1", volume: "100", review: "1", mistake: "1" },
      { coverage: "0.8", accuracy: "0.9", keep: "1", after: "0.95", volume: "100", review: "1", mistake: "1" }],
  },
  // (0.75 · 0.95 − 0.6 · 0.97) / 0.15 = (0.7125 − 0.582) / 0.15 = 0.87; 1,500 rows and 195 mistakes a month.
  looser_gate_added_rows: {
    values: { covA: "0.6", accA: "0.97", covB: "0.75", accB: "0.95", volume: "10000" },
    expect: [["Extra coverage", 0.15], ["Accuracy of the rows it adds", 0.87], ["Error rate of the rows it adds", 0.13], ["Extra automated rows per month", 1500], ["Extra automated mistakes per month", 195]],
    more: [{ values: { covA: "0.6", accA: "0.97", covB: "0.75", accB: "0.95" }, expect: (result) => assert.equal(result.rows[3][1], null) }],
    invalid: [{ covA: "0.7", accA: "0.97", covB: "0.6", accB: "0.95" }, { covA: "0.5", accA: "0.6", covB: "0.6", accB: "0.99" }],
  },
  // 0.7 · 0.95 + 0.3 · 0.98 = 0.959; reviewers are better, so coverage may go up to (0.98 − 0.96) / 0.03 = 2/3.
  overall_with_review: {
    values: { coverage: "0.7", automated: "0.95", reviewer: "0.98", target: "0.96" },
    expect: [["Overall accuracy", 0.959], ["Mistakes per 1,000 rows from automation", 35], ["Mistakes per 1,000 rows from review", 6], ["Lowest coverage meeting the target", 0],
      ["Highest coverage meeting the target", 2 / 3]],
    more: [
      // automation is better: at least (0.95 − 0.9) / 0.09 of rows must be automated
      { values: { coverage: "0.7", automated: "0.99", reviewer: "0.9", target: "0.95" }, expect: (result) => { approx(result.rows[3][1], 0.05 / 0.09); approx(result.rows[4][1], 1); } },
      { values: { coverage: "0.7", automated: "0.99", reviewer: "0.9", target: "0.995" }, expect: (result) => { assert.equal(result.rows[3][1], null); assert.equal(result.rows[4][1], null); } },
      { values: { coverage: "0.7", automated: "0.95", reviewer: "0.95", target: "0.9" }, expect: (result) => { assert.equal(result.rows[3][1], 0); assert.equal(result.rows[4][1], 1); } },
      { values: { coverage: "0.7", automated: "0.95", reviewer: "0.98" }, expect: (result) => { assert.equal(result.rows[3][1], null); assert.equal(result.rows[4][1], null); } },
    ],
    invalid: [{ coverage: "1.1", automated: "0.95", reviewer: "0.98" }],
  },
  // 200 a day, 1,400 a week, 280 per review day, 1,400 · 52 / 12 a month.
  review_load: {
    values: { volume: "1000", coverage: "0.8", arrive: "7", days: "5" },
    expect: [["Automated rows per day", 800], ["Rows sent to review per day", 200], ["Rows sent to review per week", 1400], ["Rows per review day", 280], ["Rows sent to review per month", 1400 * 52 / 12]],
    invalid: [{ volume: "1000", coverage: "0.8", arrive: "8", days: "5" }, { volume: "1000", coverage: "0.8", arrive: "7", days: "0" }],
  },
  // 400 reviewed (800 min) and 80 audited (80 min): 880 / 60 · 1.5 = 22 h, ⌈22 / 6⌉ = 4 reviewers, 22 / 24 utilization.
  review_audit_staffing: {
    values: { volume: "2000", coverage: "0.8", reviewMinutes: "2", audit: "0.05", auditMinutes: "1", hours: "6", peak: "1.5" },
    expect: [["Rows reviewed per day", 400], ["Rows audited per day", 80], ["Reviewer hours per day", 22], ["Reviewers needed", 4], ["Share of hours spent on audits", 80 / 880], ["Reviewer utilization", 22 / 24]],
    more: [{ values: { volume: "0", coverage: "0.8", reviewMinutes: "2", audit: "0.05", auditMinutes: "1" }, expect: (result) => {
      assert.equal(result.rows[3][1], 0); assert.equal(result.rows[4][1], null); assert.equal(result.rows[5][1], null);
    } }],
    invalid: [{ volume: "2000", coverage: "0.8", reviewMinutes: "2", audit: "0.05", auditMinutes: "1", peak: "0.5" }],
  },
  // 3 · 6 · 60 / 2 = 540 reviews a day; 540 / 0.2 = 2,700 rows; 1 − 540 / 5,000 = 0.892; 540 − 1,000 = −460 spare.
  team_capacity: {
    values: { reviewers: "3", hours: "6", minutes: "2", coverage: "0.8", volume: "5000" },
    expect: [["Reviews the team clears per day", 540], ["Highest daily volume at this coverage", 2700], ["Coverage needed for the expected volume", 0.892], ["Spare reviews per day at the expected volume", -460]],
    more: [{ values: { reviewers: "3", hours: "6", minutes: "2", coverage: "1" }, expect: (result) => {
      assert.equal(result.rows[1][1], null); assert.equal(result.rows[2][1], null); assert.match(result.note, /no volume limit/);
    } }],
    invalid: [{ reviewers: "0", hours: "6", minutes: "2", coverage: "0.8" }, { reviewers: "3", hours: "6", minutes: "0", coverage: "0.8" }],
  },
  // λ = 1,000 · 0.5 · 0.01 = 5: Poisson(5) cdf(0) = 0.0067, cdf(1) = 0.0404 → 1; cdf(9) = 0.968, cdf(10) = 0.986 → 10; P(X ≥ 9) = 0.06809.
  monthly_errors: {
    values: { volume: "1000", coverage: "0.5", accuracy: "0.99", cap: "8" },
    expect: [["Automated rows per month", 500], ["Expected automated mistakes", 5], ["Likely low (2.5th percentile)", 1], ["Likely high (97.5th percentile)", 10],
      ["Chance of a month with none", 0.006737946999085467], ["Chance of more than the cap", 0.06809363472184858]],
    tolerance: 1e-9,
    more: [
      { values: { volume: "30000", coverage: "0.8", accuracy: "0.995", cap: "130" }, tolerance: 1e-9, expect: [["Automated rows per month", 24000], ["Expected automated mistakes", 120],
        ["Likely low (2.5th percentile)", 99], ["Likely high (97.5th percentile)", 142], ["Chance of a month with none", 7.667648073722e-53], ["Chance of more than the cap", 0.16851838668810995]] },
      { values: { volume: "1000", coverage: "0.5", accuracy: "1" }, expect: (result) => { assert.equal(result.rows[3][1], 0); assert.equal(result.rows[4][1], 1); assert.equal(result.rows[5][1], null); } },
      // λ = 10⁹ at the input maximum: λ ± 1.959964 · √λ + (z² − 1) / 6 (Cornish–Fisher) = λ − 61,979.5 and λ + 61,980.4.
      { values: { volume: "1000000000", coverage: "1", accuracy: "0" }, expect: (result) => {
        approx(result.rows[2][1], 1e9 - 61979.5, 2e-9); approx(result.rows[3][1], 1e9 + 61980.4, 2e-9); assert.equal(result.rows[4][1], 0);
      } },
    ],
    invalid: [{ volume: "1000", coverage: "0.5", accuracy: "1.5" }],
  },
  // Poisson(4): P(X ≥ 8) = 0.0511 > 0.05, P(X ≥ 9) = 0.02136; at a rate of 8, P(X ≥ 9) = 0.40745.
  error_alarm: {
    values: { mean: "4", alpha: "0.05", factor: "2" },
    expect: [["Alarm when a week's mistakes reach", 9], ["False alarm chance per week", 0.021363434487984195], ["False alarms per year", 1.110898593375178],
      ["Chance of an alarm in a week after the rise", 0.4074526585624081], ["Expected weeks to the first alarm after the rise", 2.454272855963789]],
    invalid: [{ mean: "0", alpha: "0.05", factor: "2" }, { mean: "4", alpha: "0.2", factor: "2" }, { mean: "4", alpha: "0.05", factor: "0.5" }],
  },
  // 1,000 · 0.1 · 7 · 0.8 = 560 rows, 5.6 mistakes; then 2,800 and 28; then 11,200 and 112. All traffic for 28 days: 224.
  staged_rollout: {
    values: { volume: "1000", coverage: "0.8", accuracy: "0.99", stages: "0.1, 7\npilot, 0.5, 7\n1, 14" },
    expect: both(rowsAre([["Days in all", 28], ["Automated rows in all", 14560], ["Expected mistakes in all", 145.6], ["Mistakes with all traffic from day one", 224], ["Mistakes avoided by staging", 78.4]]),
      tableIs(["Stage", "Share of traffic", "Days", "Automated rows", "Expected mistakes", "Mistakes so far"],
        [["Stage 1", 0.1, 7, 560, 5.6, 5.6], ["pilot", 0.5, 7, 2800, 28, 33.6], ["Stage 3", 1, 14, 11200, 112, 145.6]])),
    invalid: [{ volume: "1000", coverage: "0.8", accuracy: "0.99", stages: "" }, { volume: "1000", coverage: "0.8", accuracy: "0.99", stages: "1.5, 7" },
      { volume: "1000", coverage: "0.8", accuracy: "0.99", stages: "0.5, -1" }, { volume: "1000", coverage: "0.8", accuracy: "0.99", stages: "0.5" }],
  },
  // 20 audited a day; 1 / 0.01 = 100 rows, 5 days; 0.98 / 0.02 = 49 slip; ln 0.05 / ln 0.99 = 298.07 → 299 rows, 14.95 days,
  // 299 · 0.98 · 0.01 / 0.02 = 146.51 unaudited mistakes.
  audit_slip: {
    values: { volume: "1000", audit: "0.02", rate: "0.01", chance: "0.95" },
    expect: [["Audited rows per day", 20], ["Expected audited rows until a mistake is found", 100], ["Expected days until a mistake is found", 5], ["Expected mistakes that slip past first", 49],
      ["Audited rows to find one with the chance wanted", 299], ["Days to find one with the chance wanted", 14.95], ["Unaudited mistakes in those days", 146.51]],
    invalid: [{ volume: "1000", audit: "0", rate: "0.01" }, { volume: "1000", audit: "0.02", rate: "0" }],
  },
  // Exact scan: 0.99^298 = 0.05002, 0.99^299 = 0.04952 → 299; one mistake allowed → 473 (Python, exact fractions).
  audit_share_bound: {
    values: { volume: "20000", bound: "0.01", level: "0.95", allowed: "0" },
    expect: [["Rows to audit", 299], ["Audit share of a month's automated rows", 0.01495], ["Unaudited mistakes per month at the bound", 197.01]],
    more: [
      { values: { volume: "20000", bound: "0.01", level: "0.95", allowed: "1" }, expect: [["Rows to audit", 473], ["Audit share of a month's automated rows", 0.02365], ["Unaudited mistakes per month at the bound", 195.27]] },
      { values: { volume: "100", bound: "0.01", level: "0.95", allowed: "0" }, expect: (result) => { assert.equal(result.rows[2][1], 0); assert.match(result.note, /several months/); } },
    ],
    invalid: [{ volume: "20000", bound: "0", level: "0.95", allowed: "0" }, { volume: "20000", bound: "1", level: "0.95", allowed: "0" }],
  },
  // 10 h · 60 / 2 = 300 rows; none found: 1 − 0.05^(1/300) = 0.0099361; two found: 0.0208362 by bisection on the exact sum.
  audit_budget_bound: {
    values: { hours: "10", minutes: "2", volume: "20000", found: "0", level: "0.95" },
    expect: [["Rows audited per month", 300], ["Audit share", 0.015], ["Upper bound on the mistake rate", 0.009936081944457664], ["Upper bound on unaudited mistakes per month", 195.74081430581597]],
    tolerance: 1e-8,
    more: [{ values: { hours: "10", minutes: "2", volume: "20000", found: "2", level: "0.95" }, tolerance: 1e-8,
      expect: [["Rows audited per month", 300], ["Audit share", 0.015], ["Upper bound on the mistake rate", 0.020836230527024713], ["Upper bound on unaudited mistakes per month", 410.47374138238683]] }],
    invalid: [{ hours: "0.01", minutes: "2", volume: "20000", found: "0" }, { hours: "1", minutes: "30", volume: "20000", found: "3" }],
  },
  // Sorted 0.97, 0.91, 0.88, 0.88, 0.62: coverages 0.2, 0.4, 0.8, 1 → 800, 600, 200, 0 reviews; hours ×2/60; ⌈hours / 6⌉.
  review_hours_by_threshold: {
    values: { confidences: "0.97, 0.62, 0.88\n0.91; 0.88", volume: "1000", minutes: "2", hours: "6" },
    expect: tableIs(["Threshold (confidence ≥)", "Coverage", "Reviews per day", "Reviewer hours per day", "Reviewers"],
      [[0.97, 0.2, 800, 80 / 3, 5], [0.91, 0.4, 600, 20, 4], [0.88, 0.8, 200, 20 / 3, 2], [0.62, 1, 0, 0, 0]]),
    invalid: [{ confidences: "" }, { confidences: "0.5, 1.2" }, { confidences: "0.5, high" }],
  },
  // C = 0.6 · 0.85 + 0.4 · 0.6 = 0.75; mistakes 0.0153 + 0.0192 = 0.0345 → 0.954. Shifted: 0.34 + 0.36 = 0.7; 0.0102 + 0.0288 = 0.039.
  segment_mix: {
    values: { segments: "segment,share,coverage,accuracy,new\nweb, 0.6, 0.85, 0.97, 0.4\nphone, 0.4, 0.6, 0.92, 0.6" },
    expect: both(rowsAre([["Overall coverage", 0.75], ["Overall accuracy", 0.954], ["Coverage after the shift", 0.7], ["Accuracy after the shift", 1 - 0.039 / 0.7]]),
      tableIs(["Segment", "Share", "Coverage", "Accuracy", "Share of automated rows", "Share of automated mistakes"],
        [["web", 0.6, 0.85, 0.97, 0.68, 0.0153 / 0.0345], ["phone", 0.4, 0.6, 0.92, 0.32, 0.0192 / 0.0345]])),
    more: [{ values: { segments: "web, 0.6, 0.85, 0.97\nphone, 0.4, 0.6, 0.92" }, expect: (result) => { assert.equal(result.rows[2][1], null); assert.equal(result.rows[3][1], null); } }],
    invalid: [{ segments: "web, 0.6, 0.85, 0.97\nphone, 0.3, 0.6, 0.92" }, { segments: "web, 0.6, 0.85, 0.97, 0.5\nphone, 0.4, 0.6, 0.92" }, { segments: "web, 0.6, 0.85" }],
  },
  // Lowest accuracy first: 0.7 (120 rows, all reviewed), 0.82 (130 of 200 reviewed), 0.9 (none). Automated mistakes
  // 70 · 0.18 + 300 · 0.1 = 42.6 of 102 if everything were automated; 1 − 42.6 / 370.
  review_bands_capacity: {
    values: { bands: "0.7-0.8, 300, 0.9\n0.5-0.6, 120, 0.7\n0.6-0.7, 200, 0.82", capacity: "250" },
    expect: both(rowsAre([["Rows reviewed per day", 250], ["Rows automated per day", 370], ["Mistakes automated per day", 42.6], ["Mistakes avoided per day", 59.4], ["Accuracy of automated rows", 1 - 42.6 / 370]]),
      tableIs(["Band", "Rows per day", "Accuracy if automated", "Rows reviewed", "Rows automated", "Mistakes automated per day"],
        [["0.5-0.6", 120, 0.7, 120, 0, 0], ["0.6-0.7", 200, 0.82, 130, 70, 12.6], ["0.7-0.8", 300, 0.9, 0, 300, 30]])),
    more: [{ values: { bands: "a, 10, 0.5", capacity: "50" }, expect: (result) => { assert.equal(result.rows[1][1], 0); assert.equal(result.rows[4][1], null); } }],
    invalid: [{ bands: "", capacity: "10" }, { bands: "a, 10", capacity: "10" }, { bands: "a, 10, 2", capacity: "10" }],
  },
  // 100 wrong approvals, 100 wrong rejections, 3,000 reviews: 5,000 + 1,000 + 3,000 = 9,000.
  approve_reject: {
    values: { volume: "10000", approved: "0.5", approveAccuracy: "0.98", rejected: "0.2", rejectAccuracy: "0.95", wrongApprove: "50", wrongReject: "10", review: "1" },
    expect: [["Coverage", 0.7], ["Accuracy of automated rows", 0.68 / 0.7], ["Wrong approvals per month", 100], ["Wrong rejections per month", 100], ["Reviews per month", 3000],
      ["Monthly cost (USD)", 9000], ["Cost per row (USD)", 0.9]],
    invalid: [{ volume: "10000", approved: "0.7", rejected: "0.4" }],
  },
  // Poisson(3) over 30 days: P(max ≤ k) = F(k)^30 first reaches 0.5 at 7 and 0.95 at 9; P(X ≥ 7) = s gives 1 − (1 − s)^30.
  worst_error_day: {
    values: { mean: "3", days: "30", cap: "6" },
    expect: [["Typical worst day (median)", 7], ["Bad worst day (95th percentile)", 9], ["Chance some day goes over the cap", 0.6402997904657965], ["Days over the cap to expect", 1.0052560592652369]],
    more: [{ values: { mean: "0", days: "30" }, expect: [["Typical worst day (median)", 0], ["Bad worst day (95th percentile)", 0], ["Chance some day goes over the cap", null], ["Days over the cap to expect", null]] }],
    invalid: [{ mean: "3", days: "0" }],
  },
  // 0.9^6 = 0.531 ≥ 0.5 but 0.98^6 = 0.886 < 0.9 and 0.98^5 = 0.9039: five questions, held back by accuracy.
  most_questions: {
    values: { coverage: "0.9", accuracy: "0.98", minCoverage: "0.5", minAccuracy: "0.9" },
    expect: both(rowsAre([["Most questions", 5], ["Limited by", "accuracy"], ["Gate coverage at that many", 0.59049], ["Gate accuracy at that many", 0.9039207968]]),
      tableIs(["Questions", "Gate coverage", "Gate accuracy", "Meets both"], [[1, 0.9, 0.98, "yes"], [2, 0.81, 0.9604, "yes"], [3, 0.729, 0.941192, "yes"], [4, 0.6561, 0.92236816, "yes"],
        [5, 0.59049, 0.9039207968, "yes"], [6, 0.531441, 0.885842380864, "no"]])),
    more: [
      { values: { coverage: "1", accuracy: "1", minCoverage: "0.5", minAccuracy: "0.9" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /No limit/); } },
      { values: { coverage: "0.4", accuracy: "0.4", minCoverage: "0.5", minAccuracy: "0.5" }, expect: (result) => { assert.equal(result.rows[0][1], 0); assert.equal(result.rows[1][1], "coverage and accuracy"); } },
    ],
    invalid: [{ coverage: "1.5", accuracy: "0.9", minCoverage: "0.5", minAccuracy: "0.9" }],
  },
  // 0.9 · 0.88 = 0.792 right; 0.1 · 0.12 / 3 = 0.004 wrong agreements; 0.792 / 0.796.
  agreement_gate: {
    values: { first: "0.9", second: "0.88", options: "4" },
    expect: [["Coverage (they agree)", 0.796], ["Accuracy when they agree", 0.792 / 0.796], ["Mistakes per 1,000 rows (agreement gate)", 4], ["Mistakes per 1,000 rows (better answer alone)", 100],
      ["Better answer's accuracy alone", 0.9]],
    invalid: [{ first: "0.9", second: "0.88", options: "1" }],
  },
  // 200 a day now; ln(300 / 200) / ln 1.05 = 8.3104 months; 1,000 · 1.05^12 = 1,795.856 → 1 − 300 / 1,795.856.
  review_growth_months: {
    values: { volume: "1000", growth: "0.05", coverage: "0.8", capacity: "300" },
    expect: [["Rows sent to review per day now", 200], ["Months until it passes capacity", Math.log(1.5) / Math.log(1.05)], ["Rows per day in 12 months", 1795.8563260221292],
      ["Coverage needed in 12 months", 1 - 300 / 1795.8563260221292]],
    more: [
      { values: { volume: "1000", growth: "0.05", coverage: "0.5", capacity: "300" }, expect: (result) => { assert.equal(result.rows[1][1], 0); assert.match(result.note, /already at or over/); } },
      { values: { volume: "1000", growth: "0", coverage: "0.8", capacity: "300" }, expect: (result) => { assert.equal(result.rows[1][1], null); assert.match(result.note, /never/); } },
    ],
    invalid: [{ volume: "1000", growth: "-0.1", coverage: "0.8", capacity: "300" }],
  },
  // Gate 0.54 / 0.912285. Raising urgent's coverage gives 0.72 · 0.77 = 0.5544 (most); refund_amount's accuracy gives 0.9603 · 0.97 = 0.931491 (most).
  improve_first: {
    values: { questions: Q3, step: "0.02" },
    expect: both(rowsAre([["Gate coverage now", 0.54], ["Gate accuracy now", 0.912285], ["Best coverage gain from", "urgent"], ["Best accuracy gain from", "refund_amount"]]),
      tableIs(["Question", "Coverage", "Accuracy", "Gate coverage if its coverage improves", "Gate accuracy if its accuracy improves"],
        [["intent", 0.9, 0.97, 0.552, 0.931095], ["refund_amount", 0.8, 0.95, 0.5535, 0.931491], ["urgent", 0.75, 0.99, 0.5544, 0.9215]])),
    more: [{ values: { questions: "a, 1, 1", step: "0.02" }, expect: (result) => { assert.equal(result.rows[2][1], null); assert.equal(result.rows[3][1], null); } }],
    invalid: [{ questions: Q3, step: "0" }],
  },
}, {});

test("tb-gate-design: every tool is in the Gate design group", () => {
  for (const feature of pack.features) assert.equal(feature.group, "Gate design");
});
