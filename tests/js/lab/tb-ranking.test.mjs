// Tests for the tb-ranking Toolbox pack. Reference values were worked out independently of the pack, in a separate
// Python script with exact fractions and brute force: AUC and concordance by comparing every positive-negative pair,
// threshold counts by recounting the items at or above each score, top-k positives by averaging over every order of
// tied scores, NDCG by averaging DCG over every order of ties, KS from the two empirical CDFs with the Kolmogorov
// series summed to 2,000 terms. The small four-item cases are the examples in scikit-learn's documentation.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-ranking.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

// Ten items, five positive, with ties at 0.8 (one of each label) and at 0.4 (two negatives).
const D = "score,label\n0.9,1\n0.8,1\n0.8,0\n0.7,1\n0.6,0\n0.5,1\n0.4,0\n0.4,0\n0.3,1\n0.1,0";
// scikit-learn's docs: y_true = [0, 0, 1, 1], y_score = [0.1, 0.4, 0.35, 0.8]
const SK = "0.1 0\n0.4 0\n0.35 1\n0.8 1";
// Perfect separation: negatives score 1..10, positives 11..20.
const SEPARATED = Array.from({ length: 20 }, (_, i) => `${i + 1}\t${i >= 10 ? "yes" : "no"}`).join("\n");
// The only positive scores lowest.
const UPSIDE = "0.9,0\n0.1,1";

const BAD_PAIRS = [{ pairs: "" }, { pairs: "0.5,maybe" }, { pairs: "abc,1\n0.2,0\nxyz,1" }, { pairs: "0.5,1,2" }];
const ONE_CLASS = { pairs: "0.9,1\n0.2,1" };

const tableIs = (expected) => (result) => {
  assert.deepEqual(result.table.columns, expected.columns);
  assert.equal(result.table.rows.length, expected.rows.length);
  expected.rows.forEach((row, i) => row.forEach((cell, j) => approx(result.table.rows[i][j], cell, 1e-9, `row ${i + 1} cell ${j + 1}:`)));
};

checkPack(pack, {
  // 17 concordant and 1 tied pair of 25: AUC = (17 + 0.5) / 25 = 0.7. Hanley-McNeil: Q1 = A/(2 − A), Q2 = 2A²/(1 + A),
  // se² = (A(1 − A) + 4(Q1 − A²) + 4(Q2 − A²)) / 25; the high bound 1.039 is capped at 1.
  roc_auc: { values: { pairs: D }, expect: [["ROC AUC", 0.7], ["Standard error (Hanley-McNeil)", 0.17317372858344657], ["95% interval, low", 0.3605857289079302],
    ["95% interval, high", 1], ["Positives", 5], ["Negatives", 5]],
  more: [
    { values: { pairs: SK }, expect: (result) => approx(result.rows[0][1], 0.75) },   // roc_auc_score docs: 0.75
    // the same data with a header, yes/no labels and semicolons with decimal commas
    { values: { pairs: "Score;Outcome\n0,1;no\n0,4;no\n0,35;yes\n0,8;yes" }, expect: (result) => approx(result.rows[0][1], 0.75) },
    { values: { pairs: SEPARATED }, expect: (result) => { approx(result.rows[0][1], 1); approx(result.rows[1][1], 0); } },
  ],
  invalid: [...BAD_PAIRS, ONE_CLASS, { pairs: D, level: "0.8" }] },
  // roc_curve docs for this data: fpr [0, 0, 0.5, 0.5, 1], tpr [0, 0.5, 0.5, 1, 1], thresholds [inf, 0.8, 0.4, 0.35, 0.1]
  roc_points: { values: { pairs: SK }, expect: tableIs({ columns: ["Threshold (score ≥)", "False positive rate", "True positive rate", "True positives", "False positives"],
    rows: [["above top score", 0, 0, 0, 0], [0.8, 0, 0.5, 1, 0], [0.4, 0.5, 0.5, 1, 1], [0.35, 0.5, 1, 2, 1], [0.1, 1, 1, 2, 2]] }),
  more: [{ values: { pairs: D }, expect: tableIs({ columns: ["Threshold (score ≥)", "False positive rate", "True positive rate", "True positives", "False positives"],
    rows: [["above top score", 0, 0, 0, 0], [0.9, 0, 0.2, 1, 0], [0.8, 0.2, 0.4, 2, 1], [0.7, 0.2, 0.6, 3, 1], [0.6, 0.4, 0.6, 3, 2], [0.5, 0.4, 0.8, 4, 2],
      [0.4, 0.8, 0.8, 4, 4], [0.3, 0.8, 1, 5, 4], [0.1, 1, 1, 5, 5]] }) }],
  invalid: [...BAD_PAIRS, ONE_CLASS] },
  // precision_recall_curve docs: precision [0.5, 0.667, 0.5, 1] and recall [1, 1, 0.5, 0.5] at thresholds [0.1, 0.35, 0.4, 0.8]
  pr_points: { values: { pairs: SK }, expect: tableIs({ columns: ["Threshold (score ≥)", "Precision", "Recall", "True positives", "False positives"],
    rows: [[0.8, 1, 0.5, 1, 0], [0.4, 0.5, 0.5, 1, 1], [0.35, 2 / 3, 1, 2, 1], [0.1, 0.5, 1, 2, 2]] }),
  invalid: [...BAD_PAIRS, { pairs: "0.3,0\n0.2,0" }] },
  // average_precision_score docs: 0.83; the ten items: Σ ΔR·P = 0.2·1 + 0.2·2/3 + 0.2·3/4 + 0.2·2/3 + 0.2·5/9 = 131/180
  average_precision: { values: { pairs: SK }, expect: [["Average precision", 5 / 6], ["Base rate", 0.5], ["Positives", 2], ["Items", 4]],
    more: [{ values: { pairs: D }, expect: [["Average precision", 131 / 180], ["Base rate", 0.5], ["Positives", 5], ["Items", 10]] }],
    invalid: [...BAD_PAIRS, { pairs: "0.3,0\n0.2,0" }] },
  // top 2: 0.9 (positive) and one of the tied 0.8 pair (one positive): 1.5 positives expected
  precision_at_k: { values: { pairs: D, k: "2" }, expect: [["Precision at k", 0.75], ["Recall at k", 0.3], ["Positives in the top k", 1.5], ["Tied items straddling the cut", 2]],
    more: [{ values: { pairs: D, k: "4" }, expect: [["Precision at k", 0.75], ["Recall at k", 0.6], ["Positives in the top k", 3], ["Tied items straddling the cut", 0]] },
      { values: { pairs: "0.9,0\n0.2,0", k: "1" }, expect: [["Precision at k", 0], ["Recall at k", null], ["Positives in the top k", 0], ["Tied items straddling the cut", 0]] }],
    invalid: [...BAD_PAIRS, { pairs: D, k: "11" }, { pairs: D, k: "0" }] },
  // 30% of 10 items = 3: 0.9, 0.8, 0.8 hold 2 positives; base rate 0.5
  lift_at_share: { values: { pairs: D, share: "0.3" }, expect: [["Items in the top share", 3], ["Positives in it", 2], ["Precision in it", 2 / 3], ["Base rate", 0.5],
    ["Lift", 4 / 3], ["Gain (share of positives captured)", 0.4]],
  // 15% of 10 = 1.5, rounded up to 2 items
  more: [{ values: { pairs: D, share: "0.15" }, expect: [["Items in the top share", 2], ["Positives in it", 1.5], ["Precision in it", 0.75], ["Base rate", 0.5], ["Lift", 1.5], ["Gain (share of positives captured)", 0.3]] }],
  invalid: [...BAD_PAIRS, { pairs: D, share: "0" }, { pairs: D, share: "1.2" }, { pairs: "0.3,0\n0.2,0", share: "0.5" }] },
  // fifths: top 2, 4, 6, 8, 10 items hold 1.5, 3, 4, 4, 5 positives
  gains_table: { values: { pairs: D, bins: "5" }, expect: tableIs({ columns: ["Top share", "Items", "Positives", "Gain", "Lift"],
    rows: [[0.2, 2, 1.5, 0.3, 1.5], [0.4, 4, 3, 0.6, 1.5], [0.6, 6, 4, 0.8, 4 / 3], [0.8, 8, 4, 0.8, 1], [1, 10, 5, 1, 1]] }),
  invalid: [...BAD_PAIRS, { pairs: D, bins: "11" }, { pairs: D, bins: "1" }] },
  // the CDFs differ most (0.4) at 0.7, before 0.5 which ties it; λ = 0.4·√(25/10)
  ks_statistic: { values: { pairs: D }, expect: [["KS statistic", 0.4], ["Threshold where it occurs (score ≥)", 0.7], ["True positive rate there", 0.6], ["False positive rate there", 0.2],
    ["Higher scores go with", "positives"], ["Asymptotic p-value", 0.8186211744710057]],
  // λ = 1·√(100/20) = √5: p = 2(e^−10 − e^−40 + …)
  more: [{ values: { pairs: SEPARATED }, expect: [["KS statistic", 1], ["Threshold where it occurs (score ≥)", 11], ["True positive rate there", 1], ["False positive rate there", 0],
    ["Higher scores go with", "positives"], ["Asymptotic p-value", 9.079985952496105e-05]] },
  { values: { pairs: UPSIDE }, expect: (result) => { approx(result.rows[0][1], 1); assert.equal(result.rows[4][1], "negatives"); } }],
  invalid: [...BAD_PAIRS, ONE_CLASS] },
  // J: 2/5 at 0.7 and 0.5 (higher wins); F1: 8/11 at 0.5; accuracy 7/10 at 0.7 and 0.5; corner: √0.2 at 0.7 and 0.5
  best_threshold: { values: { pairs: D }, expect: [["Best threshold (score ≥)", 0.7], ["Criterion value", 0.4], ["Precision", 0.75], ["Recall", 0.6], ["False positive rate", 0.2],
    ["True positives", 3], ["False positives", 1], ["False negatives", 2], ["True negatives", 4]],
  more: [
    { values: { pairs: D, criterion: "f1" }, expect: [["Best threshold (score ≥)", 0.5], ["Criterion value", 8 / 11], ["Precision", 2 / 3], ["Recall", 0.8], ["False positive rate", 0.4],
      ["True positives", 4], ["False positives", 2], ["False negatives", 1], ["True negatives", 3]] },
    { values: { pairs: D, criterion: "accuracy" }, expect: (result) => { approx(result.rows[0][1], 0.7); approx(result.rows[1][1], 0.7); } },
    { values: { pairs: D, criterion: "corner" }, expect: (result) => { approx(result.rows[0][1], 0.7); assert.equal(result.rows[1][0], "Distance to the corner"); approx(result.rows[1][1], Math.sqrt(0.2)); } },
  ], invalid: [...BAD_PAIRS, ONE_CLASS, { pairs: D, criterion: "auc" }] },
  // precision ≥ 0.7 holds at 0.9 (1) and 0.7 (3/4); the lowest is 0.7
  threshold_for_precision: { values: { pairs: D, target: "0.7" }, expect: [["Threshold (score ≥)", 0.7], ["Precision there", 0.75], ["Recall there", 0.6], ["Share of items flagged", 0.4]],
    more: [{ values: { pairs: D, target: "0.6" }, expect: [["Threshold (score ≥)", 0.5], ["Precision there", 2 / 3], ["Recall there", 0.8], ["Share of items flagged", 0.6]] },
      { values: { pairs: UPSIDE, target: "0.8" }, expect: (result) => { assert.deepEqual(result.rows.map(([, value]) => value), [null, null, null, null]); assert.match(result.note, /No threshold reaches/); } }],
    invalid: [...BAD_PAIRS, { pairs: D, target: "1.1" }] },
  // recall ≥ 0.8 first holds at 0.5 going down
  threshold_for_recall: { values: { pairs: D, target: "0.8" }, expect: [["Threshold (score ≥)", 0.5], ["Recall there", 0.8], ["Precision there", 2 / 3], ["False positive rate there", 0.4], ["Share of items flagged", 0.6]],
    more: [{ values: { pairs: D, target: "1" }, expect: [["Threshold (score ≥)", 0.3], ["Recall there", 1], ["Precision there", 5 / 9], ["False positive rate there", 0.8], ["Share of items flagged", 0.9]] }],
    invalid: [...BAD_PAIRS, { pairs: "0.3,0\n0.2,0", target: "0.5" }] },
  // FPR ≤ 0.2 holds down to 0.7; FPR 0 only at 0.9
  threshold_for_fpr: { values: { pairs: D, cap: "0.2" }, expect: [["Threshold (score ≥)", 0.7], ["False positive rate there", 0.2], ["True positive rate there", 0.6], ["Precision there", 0.75]],
    more: [{ values: { pairs: D, cap: "0" }, expect: [["Threshold (score ≥)", 0.9], ["False positive rate there", 0], ["True positive rate there", 0.2], ["Precision there", 1]] },
      { values: { pairs: UPSIDE, cap: "0" }, expect: (result) => { assert.equal(result.rows[0][1], null); assert.match(result.note, /above 0/); } }],
    invalid: [...BAD_PAIRS, ONE_CLASS] },
  // FPR and FNR meet at 0.4 when the threshold is 0.6
  equal_error_rate: { values: { pairs: D }, expect: [["Equal error rate", 0.4], ["Threshold (score ≥)", 0.6], ["False positive rate there", 0.4], ["False negative rate there", 0.4]],
    more: [{ values: { pairs: SEPARATED }, expect: [["Equal error rate", 0], ["Threshold (score ≥)", 11], ["False positive rate there", 0], ["False negative rate there", 0]] }],
    invalid: [...BAD_PAIRS, ONE_CLASS] },
  // width 0.2 from 0.1: [0.1, 0.3) has 0.1; [0.3, 0.5) has 0.3, 0.4, 0.4; [0.5, 0.7) has 0.5, 0.6; [0.7, 0.9] has 0.7, 0.8, 0.8, 0.9
  score_histogram: { values: { pairs: D, bins: "4" }, expect: tableIs({ columns: ["Score from", "Score to", "Positives", "Negatives"],
    rows: [[0.1, 0.3, 0, 1], [0.3, 0.5, 1, 2], [0.5, 0.7, 1, 1], [0.7, 0.9, 3, 1]] }),
  more: [{ values: { pairs: D, bins: "4", shares: true }, expect: tableIs({ columns: ["Score from", "Score to", "Share of positives", "Share of negatives"],
    rows: [[0.1, 0.3, 0, 0.2], [0.3, 0.5, 0.2, 0.4], [0.5, 0.7, 0.2, 0.2], [0.7, 0.9, 0.6, 0.2]] }) },
  { values: { pairs: "0.5,1\n0.5,1", shares: true }, expect: tableIs({ columns: ["Score from", "Score to", "Share of positives", "Share of negatives"], rows: [[0.5, 0.5, 1, "—"]] }) }],
  invalid: [...BAD_PAIRS, { pairs: D, bins: "0" }, { pairs: "-1e308,1\n1e308,0" }] },
  // 17 concordant, 7 discordant, 1 tied of 25: D = 10/25, gamma = 10/24
  concordance: { values: { pairs: D }, expect: [["Positive-negative pairs", 25], ["Concordant pairs", 17], ["Discordant pairs", 7], ["Tied pairs", 1],
    ["Somers' D (Gini)", 0.4], ["Goodman-Kruskal gamma", 5 / 12], ["Concordance index (C)", 0.7]],
  more: [{ values: { pairs: "0.5,1\n0.5,0" }, expect: [["Positive-negative pairs", 1], ["Concordant pairs", 0], ["Discordant pairs", 0], ["Tied pairs", 1],
    ["Somers' D (Gini)", 0], ["Goodman-Kruskal gamma", null], ["Concordance index (C)", 0.5]] }],
  invalid: [...BAD_PAIRS, ONE_CLASS] },
  // ROC points (0, 0), (0, 0.2), (0.2, 0.4) (the 0.8 tie runs diagonally), (0.2, 0.6), (0.4, 0.6), …; up to FPR 0.3:
  // 0.2·(0.2 + 0.4)/2 + 0.1·(0.6 + 0.6)/2 = 0.06 + 0.06 = 0.12;
  // McClish: 0.5·(1 + (0.12 − 0.045)/(0.3 − 0.045)) = 11/17
  partial_auc: { values: { pairs: D, cap: "0.3" }, expect: [["Partial AUC", 0.12], ["Largest possible", 0.3], ["Chance level", 0.045], ["Standardized partial AUC (McClish)", 11 / 17]],
    more: [{ values: { pairs: D, cap: "1" }, expect: [["Partial AUC", 0.7], ["Largest possible", 1], ["Chance level", 0.5], ["Standardized partial AUC (McClish)", 0.7]] },
      { values: { pairs: D, cap: "0.5" }, expect: (result) => { approx(result.rows[0][1], 0.26); approx(result.rows[3][1], 0.68); } }],
    invalid: [...BAD_PAIRS, ONE_CLASS, { pairs: D, cap: "0" }] },
  metrics_at_threshold: { values: { pairs: D, threshold: "0.5" }, expect: [["True positives", 4], ["False positives", 2], ["False negatives", 1], ["True negatives", 3], ["Precision", 2 / 3],
    ["Recall", 0.8], ["Specificity", 0.6], ["F1", 8 / 11], ["Accuracy", 0.7], ["Share predicted positive", 0.6]],
  more: [{ values: { pairs: D, threshold: "2" }, expect: [["True positives", 0], ["False positives", 0], ["False negatives", 5], ["True negatives", 5], ["Precision", null],
    ["Recall", 0], ["Specificity", 1], ["F1", 0], ["Accuracy", 0.5], ["Share predicted positive", 0]] }],
  invalid: [...BAD_PAIRS, { pairs: D, threshold: "high" }] },
  // FP at 1 and FN at 3: costs 15 (nothing), 12, 10, 7, 8, 5, 7, 4, 5 going down the scores: 0.3 is cheapest
  lowest_cost_threshold: { values: { pairs: D, cost_fp: "1", cost_fn: "3" }, expect: [["Best threshold (score ≥)", 0.3], ["Total cost", 4], ["Cost per item", 0.4], ["False positives", 4],
    ["False negatives", 0], ["Cost of flagging nothing", 15], ["Cost of flagging everything", 5]],
  // equal prices: 3 at 0.7 and at 0.5, the higher wins; a free miss makes flagging nothing best
  more: [{ values: { pairs: D }, expect: (result) => { approx(result.rows[0][1], 0.7); approx(result.rows[1][1], 3); } },
    { values: { pairs: D, cost_fn: "0" }, expect: [["Best threshold (score ≥)", "above top score"], ["Total cost", 0], ["Cost per item", 0], ["False positives", 0],
      ["False negatives", 5], ["Cost of flagging nothing", 0], ["Cost of flagging everything", 5]] }],
  invalid: [...BAD_PAIRS, { pairs: D, cost_fp: "-1" }] },
  // ≥ 0.7: 0.9, 0.8, 0.8, 0.7 (3 positive); < 0.4: 0.3 (positive), 0.1 (negative); review 0.6, 0.5, 0.4, 0.4
  review_band: { values: { pairs: D, low: "0.4", high: "0.7" }, expect: [["Decided positive", 4], ["Precision of those", 0.75], ["Decided negative", 2], ["Negative predictive value of those", 0.5],
    ["Sent to review", 4], ["Automated share", 0.6], ["Accuracy of automated decisions", 4 / 6]],
  more: [{ values: { pairs: D, low: "0.5", high: "0.5" }, expect: [["Decided positive", 6], ["Precision of those", 2 / 3], ["Decided negative", 4], ["Negative predictive value of those", 0.75],
    ["Sent to review", 0], ["Automated share", 1], ["Accuracy of automated decisions", 0.7]] }],
  invalid: [...BAD_PAIRS, { pairs: D, low: "0.8", high: "0.2" }, { pairs: D, low: "0.4" }] },
  // positives 0.9, 0.8, 0.7, 0.5, 0.3; negatives 0.8, 0.6, 0.4, 0.4, 0.1 (statistics.stdev); pooled sd from both
  score_summary: { values: { pairs: D }, expect: [["Positives", 5], ["Mean score of positives", 0.64], ["Median score of positives", 0.7], ["Standard deviation of positives", 0.24083189157584592],
    ["Negatives", 5], ["Mean score of negatives", 0.46], ["Median score of negatives", 0.4], ["Standard deviation of negatives", 0.260768096208106],
    ["Difference of means", 0.18], ["Cohen's d", 0.717137165600636]],
  more: [{ values: { pairs: "0.7,1\n0.2,1" }, expect: [["Positives", 2], ["Mean score of positives", 0.45], ["Median score of positives", 0.45], ["Standard deviation of positives", Math.sqrt(0.125)],
    ["Negatives", 0], ["Mean score of negatives", null], ["Median score of negatives", null], ["Standard deviation of negatives", null], ["Difference of means", null], ["Cohen's d", null]] }],
  invalid: BAD_PAIRS },
  // ideal DCG@3 = 1 + 1/log2(3) + 1/2; DCG@3 = 1 + (1/log2(3) + 1/2)/2, the 0.8 tie sharing ranks 2 and 3
  ndcg_at_k: { values: { pairs: D, k: "3" }, expect: [["NDCG at k", 0.7346393630113782], ["DCG at k", 1.5654648767857289], ["Ideal DCG at k", 2.1309297535714578], ["k", 3]],
    more: [{ values: { pairs: D }, expect: [["NDCG at k", 0.8999204366243961], ["DCG at k", 2.653378617631125], ["Ideal DCG at k", 2.9484591188793923], ["k", 10]] },
      { values: { pairs: SEPARATED, k: "50" }, expect: (result) => { approx(result.rows[0][1], 1); approx(result.rows[3][1], 20); } }],
    invalid: [...BAD_PAIRS, { pairs: D, k: "0" }, { pairs: "0.3,0\n0.2,0" }] },
}, { ctx: () => fakeCtx({}) });
