import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/bulk-result-reports.js";
import { checkPack } from "./harness.mjs";
import { sampleBulkResultsCtx, sampleBulkRowsCtx } from "./fixtures/workbench-bulk.mjs";

// The fixture run (tests/js/lab/fixtures/workbench-bulk.mjs), indexes 0-7: 3 failed, 4 held out, 5 skipped. Answered
// shown rows are 0, 1, 2, 6, 7 with five questions each (25 answers, 20 with a probability).
// Valid labels (10): row 0 department, wants_refund, frustration, seal_damage (all agree, Box IoU 0.75); row 1 department
// (agrees), wants_refund (disagrees); row 2 department (disagrees), is_urgent, frustration (agree); row 6 none (its
// department label "accounts" is invalid); row 7 wants_refund (agrees). So 8 of 10 agree.
const ctx = sampleBulkResultsCtx();
const empty = () => sampleBulkResultsCtx({ result: null });
const only = (indexes) => sampleBulkResultsCtx({ matches: (item) => indexes.includes(item.index) });
const withLabels = (change) => {
  const labels = structuredClone(ctx.state.labels);
  change(labels);
  return sampleBulkResultsCtx({ labels });
};
const feature = (id) => pack.features.find((entry) => entry.id === id);
// Row 0's Box answer with its edges swapped (right < left): it has no overlap to measure, so it is left out rather
// than counted as an IoU of 0.
const inverted = () => {
  const result = structuredClone(ctx.state.result);
  result.results[0].answers.seal_damage.box = { left: 0.6, top: 0.5, right: 0.2, bottom: 0.2 };
  return sampleBulkResultsCtx({ result });
};
// A run over a JSON-array rows box: an array row, a number row (failed) and a text row with a table label.
const arrayRun = () => sampleBulkResultsCtx({ result: { rows: 3, results: [
  { index: 0, row: ["Harbor House Blend", "Decaf"], answers: {} },
  { index: 1, row: 7, error: "Server error" },
  { index: 2, row: { text: "Is the Kenya roast back?" }, answers: {} },
] }, labels: { 2: { department: "product" } }, calQuestion: null });

// Wilson 95% intervals from a separate Python computation (z = 1.959963984540054):
// 8/10 -> 0.49016247153664183..0.9433178485456247; 2/3 -> 20.8%..93.9%; 2/2 -> 34.2%..100%; 1/1 -> 20.7%..100%.
// (8/10 matches the published Wilson interval 0.4902-0.9433.)
checkPack(pack, {
  cal_agreement: { ctx, empty: empty(), expect: (result) => {
    assert.ok(Math.abs(result.value - 2 / 3) < 1e-12);
    assert.equal(result.detail, "department: 2 of 3 labeled; 95% interval 20.8%–93.9%");
  } },
  agreement_low: { ctx, empty: empty(), expect: (result) => {
    assert.ok(Math.abs(result.value - 0.49016247153664183) < 1e-12);
    assert.equal(result.detail, "8 of 10 labeled answers agree; 95% interval 49.0%–94.3%");
  } },
  label_coverage: { ctx, expect: 10 / 25, empty: empty() },
  // Rows with a scored label: 0 (all agree), 1, 2, 7 (all agree).
  rows_all_agree: { ctx, expect: 0.5, empty: empty() },
  // Labeled Nouls (P(yes), label): (0.91, yes), (0.62, no), (0.81, yes), (0.95, yes).
  // Brier: (0.0081 + 0.3844 + 0.0361 + 0.0025) / 4.
  brier_noul: { ctx, expect: 0.107775, empty: empty() },
  // Log loss: mean of -ln 0.91, -ln 0.38, -ln 0.81, -ln 0.95 (Python: 0.3309772578590375).
  log_loss_noul: { ctx, expect: 0.3309772578590375, empty: empty() },
  // Nine labeled answers with a probability: 0.88, 0.6, 0.91, 0.94, 0.62 (wrong), 0.45 (wrong), 0.81, 0.75, 0.95.
  // Mean 6.91 / 9 minus agreement 7 / 9 = -0.01.
  overconfidence: { ctx, expect: -0.01, empty: empty() },
  // Bins: [0.4) 0.45 wrong -> 0.45; [0.6) 0.6, 0.62 half right -> 2 x 0.11; [0.7) 0.75 -> 0.25; [0.8) 0.88, 0.81 -> 2 x 0.155;
  // [0.9] 0.91, 0.94, 0.95 -> 3 x (1 - 0.9333…) = 0.2. (0.45 + 0.22 + 0.25 + 0.31 + 0.2) / 9.
  ece: { ctx, expect: 1.43 / 9, empty: empty() },
  // At 0.9 or more: row 0 wants_refund; row 1 department, is_urgent (0.92); row 2 wants_refund; row 6 frustration,
  // wants_refund (0.97); row 7 wants_refund. 7 of 20.
  coverage_at_90: { ctx, expect: 0.35, empty: empty() },
  // Labeled at 0.9 or more: row 0 wants_refund, row 1 department, row 7 wants_refund (all agree); relabeling row 1's
  // department as billing makes 2 of 3.
  accuracy_at_90: [{ ctx, expect: 1, empty: empty() },
    { ctx: withLabels((labels) => { labels[1].department = "billing"; }), expect: 2 / 3 }],
  // |1.2 - 1| and |1.7 - 2|.
  score_mae: { ctx, expect: 0.25, empty: empty() },
  // Row 1 gets a Box label with IoU 0.08 / 0.14 = 4/7.
  mean_box_iou: [{ ctx, expect: 0.75, empty: empty() },
    { ctx: withLabels((labels) => { labels[1].seal_damage = { left: 0.55, top: 0.1, right: 0.95, bottom: 0.3 }; }), expect: (0.75 + 4 / 7) / 2 },
    { ctx: inverted(), expect: null }],
  // Yes at P >= 0.5: row 0 wants_refund; row 1 wants_refund; row 2 both; row 6 is_urgent (0.5); row 7 wants_refund.
  noul_yes_share: { ctx, expect: 0.6, empty: empty() },
  // Python statistics.stdev of the six measured latencies 812, 790, 1033, 845 (held-out row's call), 702, 1120.
  latency_stdev: [{ ctx, expect: 159.09829246936206, empty: empty() }, { ctx: only([0]), expect: null }],
  // 870 + 860 + 880 + 850 + 820 + 850; only rows 0 and 1: 870 + 860.
  shown_input_tokens: [{ ctx, expect: 5130, empty: empty() }, { ctx: only([0, 1, 3]), expect: 1730 }],
  // 200 output tokens over 812 + 790 + 1033 + 845 + 702 = 4182 ms.
  output_tokens_per_second: { ctx, expect: 200 / 4.182, empty: empty() },
  wall_per_answered: { ctx, expect: 2140 / 6, empty: empty() },

  agreement_by_question_md: { ctx, filename: "bulk-agreement-by-question.md",
    text: "# Bulk agreement by question\n\n"
      + "| question | type | answered | labeled | agree | agreement | 95% interval |\n"
      + "| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| department | choice | 5 | 3 | 2 | 66.7% | 20.8%–93.9% |\n"
      + "| frustration | score | 5 | 2 | 2 | 100.0% | 34.2%–100.0% |\n"
      + "| is_urgent | noul | 5 | 1 | 1 | 100.0% | 20.7%–100.0% |\n"
      + "| wants_refund | noul | 5 | 3 | 2 | 66.7% | 20.8%–93.9% |\n"
      + "| seal_damage | box | 5 | 1 | 1 | 100.0% | 20.7%–100.0% |\n",
    check: () => assert.throws(() => feature("agreement_by_question_md").build(empty()), /Run Bulk first/) },
  // Labels (rows) x answers (columns): billing -> shipping once (row 3), shipping -> shipping twice.
  confusion_csv: { ctx, filename: "bulk-confusion.csv",
    text: '"department: label \\ answer","billing","shipping","technical","product","wholesale","none"\r\n'
      + '"billing","0","1","0","0","0","0"\r\n"shipping","0","2","0","0","0","0"\r\n"technical","0","0","0","0","0","0"\r\n'
      + '"product","0","0","0","0","0","0"\r\n"wholesale","0","0","0","0","0","0"\r\n"none","0","0","0","0","0","0"\r\n',
    check: () => assert.throws(() => feature("confusion_csv").build(sampleBulkResultsCtx({ calQuestion: null })), /Choose a question in Calibrate/) },
  answers_jsonl: { ctx, filename: "bulk-answers.jsonl", excludes: ["The bag arrived", "Seal was open", '"row":5', '"label"', "torn-bag"],
    check: (out) => {
      const lines = out.text.trim().split("\n").map((line) => JSON.parse(line));
      assert.deepEqual(lines.map((line) => line.row), [1, 2, 3, 7, 8]);
      assert.deepEqual(lines[0].answers.department, { type: "choice", predicted: "shipping", value: "shipping", p: 0.88, confidence: 0.86,
        probabilities: { billing: 0.05, shipping: 0.88, technical: 0.01, product: 0.02, wholesale: 0.01, none: 0.03 }, box: null });
      assert.deepEqual(lines[0].answers.seal_damage, { type: "box", predicted: null, value: null, p: null, confidence: 0.74, probabilities: {},
        box: { left: 0.2, top: 0.2, right: 0.6, bottom: 0.5 } });
    } },
  calls_csv: { ctx: only([3, 7]), filename: "bulk-calls.csv",
    text: '"row","status","model","latency_ms","input_tokens","output_tokens","cost_usd"\r\n'
      + '"4","failed","","","","",""\r\n"8","answered","jev-1.14.0","1120","850","","0.000036"\r\n' },
  unanswered_csv: { ctx, filename: "bulk-unanswered.csv",
    text: '"row","status","error"\r\n"4","failed","Rate limited: try again in a few seconds"\r\n"6","skipped",""\r\n', excludes: ["Sealed bag"] },
  boxes_csv: { ctx: only([0, 2, 4]), filename: "bulk-boxes.csv",
    text: '"row","question","left","top","right","bottom","confidence"\r\n'
      + '"1","seal_damage","0.2","0.2","0.6","0.5","0.74"\r\n"3","seal_damage","0.4","0.4","0.45","0.48","0.12"\r\n' },
  probabilities_csv: { ctx: only([1]), filename: "bulk-probabilities.csv",
    text: '"row","question","option","probability"\r\n'
      + '"2","department","billing","0.02"\r\n"2","department","shipping","0.94"\r\n"2","department","technical","0.01"\r\n'
      + '"2","department","product","0.01"\r\n"2","department","wholesale","0.01"\r\n"2","department","none","0.01"\r\n'
      + '"2","frustration","0","0.65"\r\n"2","frustration","1","0.3"\r\n"2","frustration","2","0.05"\r\n'
      + '"2","is_urgent","yes","0.08"\r\n"2","is_urgent","no","0.92"\r\n"2","wants_refund","yes","0.62"\r\n"2","wants_refund","no","0.38"\r\n' },
  // Predicted per question on rows 0, 1, 2, 6, 7: department shipping x4, none; frustration 1, 0, 2, 0, 2;
  // is_urgent no, no, yes, yes (0.5), no; wants_refund yes, yes, yes, no, yes; Box answers have no class.
  answer_counts_csv: { ctx, filename: "bulk-answer-counts.csv",
    text: '"question","answer","rows"\r\n"department","shipping","4"\r\n"department","none","1"\r\n'
      + '"frustration","0","2"\r\n"frustration","2","2"\r\n"frustration","1","1"\r\n'
      + '"is_urgent","no","3"\r\n"is_urgent","yes","2"\r\n"wants_refund","yes","4"\r\n"wants_refund","no","1"\r\n' },
  close_calls_csv: { ctx, filename: "bulk-close-calls.csv",
    text: '"row","question","first","first_p","second","second_p"\r\n"3","department","shipping","0.45","billing","0.41"\r\n' },
  rows_handoff: { ctx: only([0, 4, 7]), filename: "bulk-rows.jsonl", excludes: ["Seal was open", "0.88", '"p"', "jev-1.14.0"],
    text: '{"text":"The bag arrived torn and beans spilled everywhere. Replacement please.","_image":"torn-bag","_expect":{"department":"shipping","wants_refund":true,"frustration":1,"seal_damage":{"left":0.2,"top":0.2,"right":0.6,"bottom":0.6}}}\n'
      + '{"text":"Grinder hopper cracked in transit, I want my money back","_image":"grinder-ok","_expect":{"wants_refund":true}}\n',
    check: (out) => {
      // The rows box reads the lines back as the same inputs, pictures and labels.
      const back = sampleBulkRowsCtx({ rowsText: out.text }).items();
      assert.deepEqual(back.map((row) => [row.input, row.image, row.labels]), [
        ["The bag arrived torn and beans spilled everywhere. Replacement please.", "torn-bag",
          { department: "shipping", wants_refund: true, frustration: 1, seal_damage: { left: 0.2, top: 0.2, right: 0.6, bottom: 0.6 } }],
        ["Grinder hopper cracked in transit, I want my money back", "grinder-ok", { wants_refund: true }]]);
      // With an array or number row the export is a JSON array, which the box reads row for row (as lines, the
      // array and the 7 would read as text).
      const other = arrayRun();
      const exporter = feature("rows_handoff");
      const text = exporter.build(other);
      assert.equal(exporter.filename(other), "bulk-rows.json");
      assert.equal(text, '[\n["Harbor House Blend","Decaf"],\n7,\n{"text":"Is the Kenya roast back?","_expect":{"department":"product"}}\n]\n');
      const rows = sampleBulkRowsCtx({ rowsText: text }).items();
      assert.deepEqual(rows.map((row) => [row.kind, row.input, row.labels]),
        [["array", ["Harbor House Blend", "Decaf"], {}], ["value", 7, {}], ["text", "Is the Kenya roast back?", { department: "product" }]]);
    } },

  sort_by_cal: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["sortBy", "department", -1]]),
    hidden: () => sampleBulkResultsCtx({ calQuestion: null }) },
  first_disagreement: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["focusRow", 1]]),
    hidden: () => sampleBulkResultsCtx({ matches: (item) => item.index !== 1 && item.index !== 2 }) },
  first_invalid_label: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["focusRow", 6]]),
    hidden: () => sampleBulkResultsCtx({ matches: (item) => item.index !== 6 }) },
  // Lowest predicted probability per row: 0.6, 0.62, 0.45 (row 3), 0.5, 0.55.
  least_certain_row: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["focusRow", 2]]),
    hidden: () => sampleBulkResultsCtx({ matches: (item) => item.status !== "answered" || item.test }) },
  slowest_row: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["focusRow", 7]]), hidden: empty },
  first_held_out: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["focusRow", 4]]),
    hidden: () => sampleBulkResultsCtx({ matches: (item) => !item.test }) },
  first_skipped: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["focusRow", 5]]),
    hidden: () => sampleBulkResultsCtx({ matches: (item) => item.status !== "skipped" }) },
  copy_positions: { ctx: () => sampleBulkResultsCtx({ matches: (item) => item.index !== 3 }), hidden: empty,
    check: (c) => {
      assert.deepEqual(c.env.copied, ["1, 2, 3, 5, 6, 7, 8"]);
      assert.deepEqual(c.env.toasts, [{ message: "Copied 7 row numbers.", kind: "ok" }]);
    } },
  copy_texts: { ctx: () => sampleBulkResultsCtx({ matches: (item) => item.index < 2 }), hidden: empty,
    check: (c) => assert.deepEqual(c.env.copied, ["The bag arrived torn and beans spilled everywhere. Replacement please.\nBox corner crushed but the beans look fine."]) },
}, { ctx: () => sampleBulkResultsCtx() });
