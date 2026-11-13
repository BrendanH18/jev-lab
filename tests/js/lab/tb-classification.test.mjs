// Tests for the tb-classification Toolbox pack. Reference values were worked out independently of the pack: ratios
// as exact fractions by hand, Wilson bounds from the textbook formula
//   (p + z²/2n ± z·√(p(1 − p)/n + z²/4n²)) / (1 + z²/n),  z = NormalDist().inv_cdf(0.975) = 1.959964
// evaluated in a separate Python script, and log-method intervals as exp(ln(value) ± z·se) with the published
// standard errors. Most cases use TP = 40, FP = 10, FN = 20, TN = 30 (100 items).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-classification.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const M = { tp: "40", fp: "10", fn: "20", tn: "30" };
const ZERO = { tp: "0", fp: "0", fn: "0", tn: "0" };
const BAD = [ZERO, { ...M, tp: "-1" }, { ...M, fp: "2.5" }, { fp: "1", fn: "1", tn: "1" }];

// Wikipedia's "Sensitivity and specificity" worked example: 20 TP, 180 FP, 10 FN, 1820 TN, where it reports
// LR+ ≈ 7.4 and LR− ≈ 0.37. Intervals: log method, se(ln LR+) = √(1/TP − 1/(TP+FN) + 1/FP − 1/(FP+TN)).
const WIKI = { tp: "20", fp: "180", fn: "10", tn: "1820" };

const proportion = (label, value, counted, low, high, extra = []) => [[label, value], [`${label}: counted`, counted],
  ["95% Wilson interval, low", low], ["95% Wilson interval, high", high], ...extra];

const CAT_DOG_BIRD = ",cat,dog,bird\ncat,8,1,1\ndog,2,6,2\nbird,0,1,9";
const NEVER_PREDICTED = "5 1 0\n2 3 0\n1 1 0";
const PAIRS = "label,prediction\nrefund,refund\nrefund,other\nother,other\nlate,refund\nother,other";

// A table checked cell by cell, numbers within a tolerance.
const tableIs = (expected) => (result) => {
  assert.deepEqual(result.table.columns, expected.columns);
  assert.equal(result.table.rows.length, expected.rows.length);
  expected.rows.forEach((row, i) => row.forEach((cell, j) => approx(result.table.rows[i][j], cell, 1e-9, `row ${i + 1} cell ${j + 1}:`)));
};

checkPack(pack, {
  accuracy: { values: M, expect: proportion("Accuracy", 0.7, "70 of 100", 0.6041514536665333, 0.7810511470506722,
    [["Accuracy of always predicting the larger class", 0.6]]), invalid: BAD },
  error_rate: { values: M, expect: proportion("Error rate", 0.3, "30 of 100", 0.21894885294932756, 0.3958485463334666), invalid: BAD },
  precision: { values: M, expect: proportion("Precision", 0.8, "40 of 50", 0.6696289406777459, 0.887562499842239),
    more: [
      // 90%: z = 1.644854
      { values: { ...M, level: "0.9" }, expect: [["Precision", 0.8], ["Precision: counted", "40 of 50"], ["90% Wilson interval, low", 0.6926736151891772], ["90% Wilson interval, high", 0.8765264733390608]] },
      // nothing predicted positive: precision is undefined, not NaN
      { values: { tp: "0", fp: "0", fn: "5", tn: "5" }, expect: [["Precision", null], ["Precision: counted", "0 of 0"], ["95% Wilson interval, low", null], ["95% Wilson interval, high", null]] },
    ], invalid: [...BAD, { ...M, level: "0.5" }] },
  recall: { values: M, expect: proportion("Recall", 2 / 3, "40 of 60", 0.5405686645211968, 0.7727073847647732),
    // 0 of 10 at 99%: the low bound is exactly 0; high = z²/n / (1 + z²/n) with z = 2.575829
    more: [{ values: { tp: "0", fp: "3", fn: "10", tn: "7", level: "0.99" }, expect: [["Recall", 0], ["Recall: counted", "0 of 10"], ["99% Wilson interval, low", 0], ["99% Wilson interval, high", 0.39885409330490795]] }],
    invalid: BAD },
  specificity: { values: M, expect: proportion("Specificity", 0.75, "30 of 40", 0.5980603857923198, 0.8581288136090369), invalid: BAD },
  npv: { values: M, expect: proportion("Negative predictive value", 0.6, "30 of 50", 0.46181437747589366, 0.7239161026974346), invalid: BAD },
  fpr: { values: M, expect: proportion("False positive rate", 0.25, "10 of 40", 0.14187118639096308, 0.40193961420768026), invalid: BAD },
  fnr: { values: M, expect: proportion("False negative rate", 1 / 3, "20 of 60", 0.2272926152352268, 0.459431335478803), invalid: BAD },
  fdr: { values: M, expect: proportion("False discovery rate", 0.2, "10 of 50", 0.11243750015776112, 0.33037105932225413), invalid: BAD },
  false_omission_rate: { values: M, expect: proportion("False omission rate", 0.4, "20 of 50", 0.27608389730256544, 0.5381856225241064), invalid: BAD },
  prevalence: { values: M, expect: proportion("Prevalence", 0.6, "60 of 100", 0.5020025867910618, 0.690598713567541, [["Predicted positive share", 0.5]]), invalid: BAD },
  threat_score: { values: M, expect: proportion("Threat score", 40 / 70, "40 of 70", 0.45477836559850204, 0.6806469112000312), invalid: BAD },
  // F1 = 80 / 110 = 8/11
  f1: { values: M, expect: [["F1", 8 / 11], ["Precision", 0.8], ["Recall", 2 / 3]],
    more: [{ values: { tp: "0", fp: "0", fn: "0", tn: "9" }, expect: [["F1", null], ["Precision", null], ["Recall", null]] }], invalid: BAD },
  // F2 = 5·40 / (5·40 + 4·20 + 10) = 200/290 = 20/29; F0.5 = 1.25·40 / (1.25·40 + 0.25·20 + 10) = 50/65 = 10/13
  f_beta: { values: M, expect: [["F-beta score", 20 / 29], ["β", 2], ["Precision", 0.8], ["Recall", 2 / 3]],
    more: [{ values: { ...M, beta: "0.5" }, expect: [["F-beta score", 10 / 13], ["β", 0.5], ["Precision", 0.8], ["Recall", 2 / 3]] }],
    invalid: [...BAD, { ...M, beta: "0" }, { ...M, beta: "abc" }] },
  // (2/3 + 3/4) / 2 = 17/24
  balanced_accuracy: { values: M, expect: [["Balanced accuracy", 17 / 24], ["Recall", 2 / 3], ["Specificity", 0.75]],
    more: [{ values: { tp: "3", fp: "0", fn: "1", tn: "0" }, expect: [["Balanced accuracy", null], ["Recall", 0.75], ["Specificity", null]] }], invalid: BAD },
  // (40·30 − 10·20) / √(50·60·40·50) = 1000 / √6,000,000
  mcc: { values: M, expect: [["Matthews correlation", 1000 / Math.sqrt(6e6)]],
    more: [{ values: { tp: "0", fp: "5", fn: "5", tn: "0" }, expect: [["Matthews correlation", -1]] },
      { values: { tp: "5", fp: "5", fn: "0", tn: "0" }, expect: [["Matthews correlation", null]] }], invalid: BAD },
  // 2/3 + 3/4 − 1 = 5/12
  youden_j: { values: M, expect: [["Youden's J", 5 / 12], ["Recall", 2 / 3], ["Specificity", 0.75]], invalid: BAD },
  // 4/5 + 3/5 − 1 = 2/5
  markedness: { values: M, expect: [["Markedness", 0.4], ["Precision", 0.8], ["Negative predictive value", 0.6]], invalid: BAD },
  // LR+ = (20/30) / (180/2000) = 200/27
  lr_positive: { values: WIKI, expect: [["Positive likelihood ratio", 200 / 27], ["95% log-method interval, low", 5.5489680858898085], ["95% log-method interval, high", 9.888268169867382]],
    more: [{ values: { tp: "5", fp: "0", fn: "5", tn: "10" }, expect: [["Positive likelihood ratio", null], ["95% log-method interval, low", null], ["95% log-method interval, high", null]] }], invalid: BAD },
  // LR− = (10/30) / (1820/2000) = 100/273
  lr_negative: { values: WIKI, expect: [["Negative likelihood ratio", 100 / 273], ["95% log-method interval, low", 0.22078855802953878], ["95% log-method interval, high", 0.6077124627709712]], invalid: BAD },
  // DOR = 20·1820 / (180·10) = 182/9; Woolf: se = √(1/20 + 1/180 + 1/10 + 1/1820)
  diagnostic_odds: { values: WIKI, expect: [["Diagnostic odds ratio", 182 / 9], ["95% log-method interval, low", 9.32219269541257], ["95% log-method interval, high", 43.86717642150606]],
    more: [{ values: { tp: "5", fp: "0", fn: "1", tn: "4" }, expect: [["Diagnostic odds ratio", null], ["95% log-method interval, low", null], ["95% log-method interval, high", null]] }], invalid: BAD },
  // 40 / √(50·60)
  fowlkes_mallows: { values: M, expect: [["Fowlkes-Mallows index", 40 / Math.sqrt(3000)], ["Precision", 0.8], ["Recall", 2 / 3]], invalid: BAD },
  // po = 0.7, pe = (50·60 + 50·40) / 100² = 0.5, kappa = 0.2 / 0.5 = 0.4; se = √(0.7·0.3 / (100·0.25))
  cohen_kappa: { values: M, expect: [["Observed agreement", 0.7], ["Chance agreement", 0.5], ["Cohen's kappa", 0.4],
    ["95% interval, low", 0.4 - 1.959963984540054 * Math.sqrt(0.21 / 25)], ["95% interval, high", 0.4 + 1.959963984540054 * Math.sqrt(0.21 / 25)]],
  // every item in one class on both sides: chance agreement is 1, kappa undefined
  more: [{ values: { tp: "7", fp: "0", fn: "0", tn: "0" }, expect: [["Observed agreement", 1], ["Chance agreement", 1], ["Cohen's kappa", null], ["95% interval, low", null], ["95% interval, high", null]] }],
  invalid: BAD },
  report: { values: M, expect: tableIs({ columns: ["Metric", "Value", "95% low", "95% high"], rows: [
    ["Accuracy", 0.7, 0.6041514536665333, 0.7810511470506722], ["Error rate", 0.3, 0.21894885294932756, 0.3958485463334666],
    ["Precision", 0.8, 0.6696289406777459, 0.887562499842239], ["Recall", 2 / 3, 0.5405686645211968, 0.7727073847647732],
    ["Specificity", 0.75, 0.5980603857923198, 0.8581288136090369], ["Negative predictive value", 0.6, 0.46181437747589366, 0.7239161026974346],
    ["False positive rate", 0.25, 0.14187118639096308, 0.40193961420768026], ["False negative rate", 1 / 3, 0.2272926152352268, 0.459431335478803],
    ["False discovery rate", 0.2, 0.11243750015776112, 0.33037105932225413], ["False omission rate", 0.4, 0.27608389730256544, 0.5381856225241064],
    ["Prevalence", 0.6, 0.5020025867910618, 0.690598713567541], ["Threat score", 4 / 7, 0.45477836559850204, 0.6806469112000312],
    ["F1", 8 / 11, "—", "—"], ["Balanced accuracy", 17 / 24, "—", "—"], ["Matthews correlation", 1000 / Math.sqrt(6e6), "—", "—"],
    ["Youden's J", 5 / 12, "—", "—"], ["Markedness", 0.4, "—", "—"], ["Fowlkes-Mallows index", 40 / Math.sqrt(3000), "—", "—"],
    // LR+ = (2/3)/(1/4) = 8/3, se = √(1/40 − 1/60 + 1/10 − 1/40); LR− = (1/3)/(3/4) = 4/9, se = √(1/20 − 1/60 + 1/30 − 1/40); DOR = 1200/200 = 6
    ["Positive likelihood ratio", 8 / 3, Math.exp(Math.log(8 / 3) - 1.959963984540054 * Math.sqrt(1 / 40 - 1 / 60 + 1 / 10 - 1 / 40)), Math.exp(Math.log(8 / 3) + 1.959963984540054 * Math.sqrt(1 / 40 - 1 / 60 + 1 / 10 - 1 / 40))],
    ["Negative likelihood ratio", 4 / 9, Math.exp(Math.log(4 / 9) - 1.959963984540054 * Math.sqrt(1 / 20 - 1 / 60 + 1 / 30 - 1 / 40)), Math.exp(Math.log(4 / 9) + 1.959963984540054 * Math.sqrt(1 / 20 - 1 / 60 + 1 / 30 - 1 / 40))],
    ["Diagnostic odds ratio", 6, Math.exp(Math.log(6) - 1.959963984540054 * Math.sqrt(1 / 40 + 1 / 10 + 1 / 20 + 1 / 30)), Math.exp(Math.log(6) + 1.959963984540054 * Math.sqrt(1 / 40 + 1 / 10 + 1 / 20 + 1 / 30))],
    ["Cohen's kappa", 0.4, 0.22036633362915894, 0.5796336663708411]] }), invalid: BAD },
  // cat: 8/10 precision, 8/10 recall; dog: 6/8, 6/10, F1 12/18; bird: 9/12, 9/10, F1 18/22
  per_class: { values: { matrix: CAT_DOG_BIRD }, expect: tableIs({ columns: ["Class", "Support", "Predicted", "Precision", "Recall", "F1"], rows: [
    ["cat", 10, 10, 0.8, 0.8, 0.8], ["dog", 10, 8, 0.75, 0.6, 2 / 3], ["bird", 10, 12, 0.75, 0.9, 9 / 11]] }),
  more: [{ values: { matrix: NEVER_PREDICTED }, expect: tableIs({ columns: ["Class", "Support", "Predicted", "Precision", "Recall", "F1"], rows: [
    ["Class 1", 6, 8, 5 / 8, 5 / 6, 5 / 7], ["Class 2", 5, 5, 0.6, 0.6, 0.6], ["Class 3", 2, 0, "—", 0, 0]] }) },
  // the same matrix as tab-separated text with class names only in the first column
  { values: { matrix: "cat\t8\t1\t1\ndog\t2\t6\t2\nbird\t0\t1\t9" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => row[0]), ["cat", "dog", "bird"]) },
  // numeric class names behind a blank corner cell: class 0 has support 6, predicted 7; class 1 support 9, predicted 8
  { values: { matrix: ",0,1\n0,5,1\n1,2,7" }, expect: tableIs({ columns: ["Class", "Support", "Predicted", "Precision", "Recall", "F1"], rows: [
    ["0", 6, 7, 5 / 7, 5 / 6, 10 / 13], ["1", 9, 8, 7 / 8, 7 / 9, 14 / 17]] }) }],
  invalid: [{ matrix: "" }, { matrix: "1 2\n3" }, { matrix: "5" }, { matrix: "1 2 3\n4 5 6" }, { matrix: "1 x\n2 3" }, { matrix: "1 -2\n3 4" },
    { matrix: ",a,b\nb,1,2\na,3,4" }, { matrix: "0 0\n0 0" }, { matrix: "a,1,2\n3,4" }] },
  // equal supports: weighted = macro; second matrix: supports 6, 5, 2 and class 3 never predicted
  class_averages: { values: { matrix: CAT_DOG_BIRD }, expect: [["Macro precision", 23 / 30], ["Macro recall", 23 / 30], ["Macro F1", 0.7616161616161616],
    ["Weighted precision", 23 / 30], ["Weighted recall", 23 / 30], ["Weighted F1", 0.7616161616161616], ["Micro precision", 23 / 30], ["Micro recall", 23 / 30], ["Micro F1", 23 / 30]],
  more: [{ values: { matrix: NEVER_PREDICTED }, expect: (result) => {
    // macro P = (5/8 + 3/5 + 0)/3, macro R = (5/6 + 3/5 + 0)/3, macro F1 = (5/7 + 3/5 + 0)/3; weighted by 6, 5, 2 over 13
    const expected = [0.4083333333333333, 0.4777777777777778, 0.4380952380952381, 0.5192307692307693, 8 / 13, 0.5604395604395604, 8 / 13, 8 / 13, 8 / 13];
    expected.forEach((value, i) => approx(result.rows[i][1], value, 1e-9, result.rows[i][0]));
    assert.match(result.note, /1 class was never predicted, so precision counted as 0/);
  } }], invalid: [{ matrix: "" }, { matrix: "1 2\n3 4\n5 6" }] },
  // s = 30, correct 23, row totals 10/10/10, column totals 10/8/12: pe = 300/900, kappa = (23/30 − 1/3)/(2/3) = 13/20;
  // MCC = (23·30 − 300) / √((900 − 308)(900 − 300)); Wilson for 23 of 30 from the Python reference
  multiclass_agreement: { values: { matrix: CAT_DOG_BIRD }, expect: [["Items", 30], ["Accuracy", 23 / 30], ["95% Wilson interval, low", 0.5907167384187784],
    ["95% Wilson interval, high", 0.8820761185551051], ["Cohen's kappa", 0.65], ["Matthews correlation", 390 / Math.sqrt(592 * 600)]],
  // s = 13, correct 8, rows 6/5/2, columns 8/5/0: pe = 73/169, kappa = (104 − 73)/(169 − 73) = 31/96,
  // MCC = (8·13 − 73) / √((169 − 89)(169 − 65)); Wilson for 8 of 13 from the Python reference
  more: [{ values: { matrix: NEVER_PREDICTED }, expect: [["Items", 13], ["Accuracy", 8 / 13], ["95% Wilson interval, low", 0.355228915126657],
    ["95% Wilson interval, high", 0.8229029220223743], ["Cohen's kappa", 31 / 96], ["Matthews correlation", 31 / Math.sqrt(80 * 104)]] }],
  invalid: [{ matrix: "" }, { matrix: "a b\n1 2" }] },
  // classes sorted late, other, refund
  matrix_from_pairs: { values: { pairs: PAIRS }, expect: (result) => {
    assert.deepEqual(result.rows, [["Items", 5], ["Classes", 3], ["Accuracy", 0.6]]);
    assert.deepEqual(result.table, { columns: ["Actual \\ predicted", "late", "other", "refund", "Total"],
      rows: [["late", 0, 0, 1, 1], ["other", 0, 2, 0, 2], ["refund", 0, 1, 1, 2], ["Total", 0, 3, 2, 5]] });
  },
  more: [{ values: { pairs: PAIRS, shares: true }, expect: (result) => assert.deepEqual(result.table.rows,
    [["late", 0, 0, 1, 1], ["other", 0, 1, 0, 2], ["refund", 0, 0.5, 0.5, 2], ["Total", 0, 0.6, 0.4, 5]]) },
  { values: { pairs: "a\tb\nb\tb" }, expect: (result) => assert.deepEqual(result.rows, [["Items", 2], ["Classes", 2], ["Accuracy", 0.5]]) }],
  invalid: [{ pairs: "" }, { pairs: "label,prediction" }, { pairs: "a,b,c" }, { pairs: "a,\nb,b" }] },
  binary_counts: { values: { pairs: PAIRS, positive: "refund" }, expect: [["True positives (TP)", 1], ["False positives (FP)", 1], ["False negatives (FN)", 1], ["True negatives (TN)", 2], ["Items", 5]],
    // a tab-separated paste with an actual/pred header; "late" is only ever a label, so its one item is a miss
    more: [{ values: { pairs: "actual\tpred\nlate\trefund\nother\tother\nrefund\trefund", positive: "late" },
      expect: [["True positives (TP)", 0], ["False positives (FP)", 0], ["False negatives (FN)", 1], ["True negatives (TN)", 2], ["Items", 3]] },
    { values: { pairs: "actual\tpred\nlate\trefund\nother\tother\nrefund\trefund", positive: " refund " },
      expect: [["True positives (TP)", 1], ["False positives (FP)", 1], ["False negatives (FN)", 0], ["True negatives (TN)", 1], ["Items", 3]] }],
    invalid: [{ pairs: PAIRS, positive: "Refund" }, { pairs: PAIRS, positive: "" }, { pairs: "", positive: "refund" }] },
  // tpr 2/3, tnr 3/4, π = 0.1: precision = (1/15) / (1/15 + 9/40) = 8/35, NPV = (27/40) / (27/40 + 1/30) = 81/85, accuracy 89/120
  changed_prevalence: { values: { ...M, prevalence: "0.1" }, expect: [["Prevalence in the counts", 0.6], ["New prevalence", 0.1], ["Recall (unchanged)", 2 / 3], ["Specificity (unchanged)", 0.75],
    ["Precision in the counts", 0.8], ["Precision at the new prevalence", 8 / 35], ["Negative predictive value at the new prevalence", 81 / 85], ["Accuracy at the new prevalence", 89 / 120]],
  more: [{ values: { ...M, prevalence: "0" }, expect: (result) => { approx(result.rows[5][1], 0); approx(result.rows[6][1], 1); } }],
  invalid: [{ ...M, prevalence: "1.5" }, { ...M, prevalence: "" }, ZERO] },
  // 40·0 + 10·1 + 20·5 + 30·0 = 110; everything positive: 60·0 + 40·1 = 40; everything negative: 60·5 + 40·0 = 300
  matrix_cost: { values: { ...M, cost_fp: "1", cost_fn: "5" }, expect: [["Total cost", 110], ["Cost per item", 1.1], ["Cost of predicting everything positive", 40],
    ["Cost of predicting everything negative", 300], ["Saving against the cheaper of those", -70]],
  // defaults price FP and FN at 1: total 30, all positive 40, all negative 60, saving 10; a gain of 2 per TP: −80 + 10 + 20 = −50
  more: [{ values: M, expect: [["Total cost", 30], ["Cost per item", 0.3], ["Cost of predicting everything positive", 40], ["Cost of predicting everything negative", 60], ["Saving against the cheaper of those", 10]] },
    { values: { ...M, cost_tp: "-2" }, expect: [["Total cost", -50], ["Cost per item", -0.5], ["Cost of predicting everything positive", -80], ["Cost of predicting everything negative", 60], ["Saving against the cheaper of those", -30]] }],
  invalid: [{ ...M, cost_fp: "x" }, ZERO] },
  // 1000 items, 10% positive, recall 0.8, specificity 0.9: 80 TP, 20 FN, 90 FP, 810 TN; 90 / 80 false alarms per TP
  counts_from_rates: { values: { prevalence: "0.1", recall: "0.8", specificity: "0.9" }, expect: [["Actual positives", 100], ["Actual negatives", 900], ["True positives (TP)", 80],
    ["False negatives (FN)", 20], ["False positives (FP)", 90], ["True negatives (TN)", 810], ["Flagged items (TP + FP)", 170], ["False alarms per true positive", 1.125]],
  more: [{ values: { items: "50", prevalence: "0", recall: "1", specificity: "1" }, expect: [["Actual positives", 0], ["Actual negatives", 50], ["True positives (TP)", 0],
    ["False negatives (FN)", 0], ["False positives (FP)", 0], ["True negatives (TN)", 50], ["Flagged items (TP + FP)", 0], ["False alarms per true positive", null]] }],
  invalid: [{ prevalence: "2", recall: "0.8", specificity: "0.9" }, { items: "0", prevalence: "0.1", recall: "0.8", specificity: "0.9" }, { prevalence: "0.1", specificity: "0.9" }] },
  // b = 15, c = 5: (|15 − 5| − 1)² / 20 = 4.05, P(χ²₁ > 4.05) = erfc(√2.025); exact 2·Σₖ₌₀⁵ C(20, k) / 2²⁰ = 43400 / 1048576
  mcnemar: { values: { only_a: "15", only_b: "5" }, expect: [["Disagreements", 20], ["Chi-square (continuity corrected)", 4.05], ["p-value (chi-square)", 0.04417134490844261],
    ["Exact p-value (binomial)", 43400 / 1048576], ["More accurate on these items", "classifier A"]],
  more: [{ values: { only_a: "3", only_b: "3" }, expect: [["Disagreements", 6], ["Chi-square (continuity corrected)", 1 / 6], ["p-value (chi-square)", 0.6830913983096087],
    ["Exact p-value (binomial)", 1], ["More accurate on these items", "neither"]] },
  { values: { only_a: "0", only_b: "0" }, expect: [["Disagreements", 0], ["Chi-square (continuity corrected)", null], ["p-value (chi-square)", null], ["Exact p-value (binomial)", null], ["More accurate on these items", "neither"]] }],
  invalid: [{ only_a: "-1", only_b: "2" }, { only_a: "1.5", only_b: "2" }, { only_b: "2" }] },
}, { ctx: () => fakeCtx({}) });
