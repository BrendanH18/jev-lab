import pack from "../../../static/js/lab/packs/workbench/bulk-result-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleBulkResultsCtx } from "./fixtures/workbench-bulk.mjs";

// The fixture run (tests/js/lab/fixtures/workbench-bulk.mjs), indexes 0-7: 3 failed, 4 held out, 5 skipped, so their
// answer facts are unavailable. Reference values below are worked out by hand from the fixture's probabilities.
const ctx = sampleBulkResultsCtx();
const items = ctx.items();

// Variants of the same run, each changing one thing.
const withRun = (change) => {
  const result = structuredClone(ctx.state.result);
  change(result);
  return sampleBulkResultsCtx({ result });
};
const withLabels = (change) => {
  const labels = structuredClone(ctx.state.labels);
  change(labels);
  return sampleBulkResultsCtx({ labels });
};
// Row 1 also gets a Box label: answer (0.55, 0.1, 0.95, 0.45) vs label (0.55, 0.1, 0.95, 0.3) overlap 0.4 x 0.2 = 0.08,
// union 0.4 x 0.35 = 0.14, so IoU 4/7. Row 0: answer (0.2, 0.2, 0.6, 0.5) vs label (0.2, 0.2, 0.6, 0.6): 0.12 / 0.16 = 0.75.
const boxLabels = withLabels((labels) => { labels[1].seal_damage = { left: 0.55, top: 0.1, right: 0.95, bottom: 0.3 }; });
const wrongLabel = withLabels((labels) => { labels[0].department = "billing"; });
const failedLabels = withLabels((labels) => { labels[3] = { department: "product" }; });
const otherError = withRun((result) => { result.results[3].error = "Server error"; });
const slow = withRun((result) => { result.results[7].meta.latency_ms = 4000; });
const duplicate = withRun((result) => { result.results[7].row = structuredClone(result.results[2].row); });
const sharedError = withRun((result) => {
  result.results[5] = { index: 5, row: result.results[5].row, error: result.results[3].error };
});

// Row 0's Box answer written with its edges swapped (right < left, bottom < top): no area and no overlap, so null
// rather than the positive "area" (-0.4) x (-0.3) = 0.12 or an IoU of 0 that a plain width x height would give.
const inverted = withRun((result) => { result.results[0].answers.seal_damage.box = { left: 0.6, top: 0.5, right: 0.2, bottom: 0.2 }; });

const none = [null, null, null];  // indexes 3 (failed), 4 (held out), 5 (skipped)

checkPack(pack, {
  // Choice/Score top-two gaps, smallest per row: 0 min(0.88-0.05, 0.6-0.3); 1 min(0.94-0.02, 0.65-0.3);
  // 2 min(0.45-0.41, 0.75-0.2); 6 min(0.83-0.12, 0.92-0.07); 7 min(0.6-0.3, 0.55-0.35).
  min_margin: { items, values: [0.3, 0.35, 0.04, ...none, 0.71, 0.2] },
  // Largest entropy / ln(k) per row, from a separate Python computation: row 0 frustration [0.1, 0.6, 0.3];
  // row 1 wants_refund [0.62, 0.38]; row 2 frustration [0.05, 0.2, 0.75]; row 6 is_urgent [0.5, 0.5] = 1;
  // row 7 is_urgent [0.44, 0.56].
  max_entropy: { items, values: [0.8173454221465101, 0.9580420222262997, 0.7014714598838973, ...none, 1, 0.9895875212220555] },
  // Predicted-answer probabilities (Noul max(P, 1-P)): 0 [0.88, 0.6, 0.78, 0.91]; 1 [0.94, 0.65, 0.92, 0.62];
  // 2 [0.45, 0.75, 0.81, 0.97]; 6 [0.83, 0.92, 0.5, 0.97]; 7 [0.6, 0.55, 0.56, 0.95].
  mean_p: { items, values: [3.17 / 4, 3.13 / 4, 2.98 / 4, ...none, 3.22 / 4, 2.66 / 4] },
  p_spread: { items, values: [0.31, 0.32, 0.52, ...none, 0.47, 0.4] },
  // |P(yes) - 0.5|, smallest of is_urgent and wants_refund.
  noul_distance: { items, values: [0.28, 0.12, 0.31, ...none, 0, 0.06] },
  // |confidence - p| for Choice and Score: 0 max(0.02, 0.05); 1 max(0.01, 0.17); 2 max(0.11, 0.05); 6 max(0.03, 0.02);
  // 7 max(0.08, 0.15).
  confidence_gap: { items, values: [0.05, 0.17, 0.11, ...none, 0.03, 0.15] },
  // |score - likeliest level|: 1.2 vs 1, 0.4 vs 0, 1.7 vs 2, 0.1 vs 0, 1.5 vs 2.
  score_level_gap: { items, values: [0.2, 0.4, 0.3, ...none, 0.1, 0.5] },
  // Row 0 department, frustration, wants_refund, seal_damage; row 1 department, wants_refund; row 2 department,
  // is_urgent ("yes"), frustration; row 6 only an invalid label; row 7 a table label for wants_refund.
  scored_labels: { items, values: [4, 2, 3, ...none, 0, 1] },
  agreement_share: { items, values: [1, 0.5, 2 / 3, ...none, null, 1] },
  // |1.2 - 1| and |1.7 - 2|.
  score_label_distance: { items, values: [0.2, null, 0.3, ...none, null, null] },
  box_iou: { ctx: boxLabels, items: [...boxLabels.items(), inverted.items()[0]], values: [0.75, 4 / 7, null, ...none, null, null, null] },
  disagreeing_questions: { items, values: ["", "wants_refund", "department", "", "", "", "", ""] },
  cal_label: { ctx, items, values: ["shipping", "shipping", "billing", ...none, null, null] },
  cal_verdict: { items, values: ["right", "right", "wrong", ...none, null, null] },
  weakest_question: { items, values: ["frustration", "wants_refund", "department", ...none, "is_urgent", "frustration"] },
  // Box answer width x height: 0.4 x 0.3, 0.4 x 0.35, 0.05 x 0.08, 0.8 x 0.8, 0.3 x 0.3.
  box_area: { items: [...items, inverted.items()[0]], values: [0.12, 0.14, 0.004, ...none, 0.64, 0.09, null] },
  // Held-out row 4 keeps its measured meta; row 7's call reported no output tokens.
  output_tokens: { items, values: [40, 40, 41, null, 40, null, 39, null] },

  confident_wrong: { hit: wrongLabel.items()[0], miss: [items[0], items[1], items[2]], message: /^department: 88% sure of shipping, but the label says billing\.$/ },
  noul_tie: { hit: items[6], miss: [items[7], items[0], items[4]], message: /^is_urgent is exactly 0\.5/ },
  rate_limited: { hit: items[3], miss: [items[0], items[5], otherError.items()[3]], message: /rate limited/ },
  labels_unanswered: { hit: failedLabels.items()[3], miss: [items[3], items[5], items[0], items[4]], message: /^Labels for department cannot be scored/ },
  // Latencies 812, 790, 1033, 845, 702 and 4000: median (812 + 845) / 2 = 828.5, three times that is 2485.5.
  latency_outlier: { hitList: slow.items(), missList: items, message: /^Row 8 took 4000 ms, over three times the median of 829 ms\.$/ },
  // Rows 3 and 8 share the input; is_urgent 0.81 (yes) vs 0.44 (no), every other predicted answer matches.
  same_input_split: { hitList: duplicate.items(), missList: items, message: /^Rows 3, 8 have the same input and picture but different answers to is_urgent\.$/ },
  one_class: { hitList: items.filter((item) => item.index !== 6), missList: items, message: /^Every shown answer to department is shipping \(4 rows\)\.$/ },
  shared_error: { hitList: sharedError.items(), missList: items, message: /^2 failed rows share one error \(rows 4, 6\): Rate limited/ },
}, { ctx: () => sampleBulkResultsCtx() });
