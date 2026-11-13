import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/bulk-results-insights.js";
import { checkPack } from "./harness.mjs";
import { sampleBulkResultsCtx } from "./fixtures/workbench-bulk.mjs";

// The fixture run (tests/js/lab/fixtures/workbench-bulk.mjs), indexes 0-7: 3 failed, 4 held out, 5 skipped.
const ctx = sampleBulkResultsCtx();
const items = ctx.items();

// The same run with one more failure (index 5) under another message, and index 1 answered by another version.
const variant = (() => {
  const result = structuredClone(ctx.state.result);
  result.results[5] = { index: 5, row: result.results[5].row, error: "Session budget spent" };
  result.results[1].meta.model = "jev-1.15.0";
  result.stopped = "Session budget spent";
  return sampleBulkResultsCtx({ result });
})();
const stopped = (() => {
  const result = structuredClone(ctx.state.result);
  result.stopped = "Session budget spent";
  return sampleBulkResultsCtx({ result });
})();
const empty = () => sampleBulkResultsCtx({ result: null });

checkPack(pack, {
  min_p: { items, values: [0.6, 0.62, 0.45, null, null, null, 0.5, 0.55] },
  min_confidence: { items, values: [0.55, 0.48, 0.12, null, null, null, 0.2, 0.4] },
  disagreements: { items, values: [0, 1, 1, null, null, null, 0, 0] },
  latency: { items, values: [812, 790, 1033, null, 845, null, 702, 1120] },
  cost: { items, values: [0.0000366, 0.0000361, 0.0000370, null, 0.0000358, null, 0.0000345, 0.0000360] },
  failed: { items, values: [false, false, false, true, false, false, false, false] },
  close_call: { items, values: [false, false, true, false, false, false, false, false] },
  status: { items, values: ["answered", "answered", "answered", "failed", "answered", "skipped", "answered", "answered"] },
  cal_answer: { ctx, items, values: ["shipping", "shipping", "shipping", null, null, null, "none", "shipping"] },
  error: { items: variant.items(), values: ["", "", "", "Rate limited: try again in a few seconds", "", "Session budget spent", "", ""] },

  invalid_label: { hit: items[6], miss: [items[0], items[3], items[4]], message: /label for department is not one of its options/ },
  stopped_run: { ctx: stopped, hitList: stopped.items(), missList: stopped.items().filter((item) => item.status !== "skipped"), message: /^1 shown row never sent: the run stopped early \(Session budget spent\)/ },
  mixed_models: { hitList: variant.items(), missList: items, message: /2 model versions \(jev-1\.14\.0, jev-1\.15\.0\)/ },
  tiny_box: { hit: items[2], miss: [items[0], items[1], items[4]], message: /^The seal_damage box covers under 1%/ },

  agreement_rate: [{ ctx, expect: 0.8, empty: empty() }, { ctx: sampleBulkResultsCtx({ matches: (item) => item.index === 2 }), expect: 2 / 3, tolerance: 1e-12 }],
  mean_latency: [{ ctx, expect: 5302 / 6, tolerance: 1e-12, empty: empty() }, { ctx: sampleBulkResultsCtx({ matches: (item) => item.index === 3 }), expect: null }],
  p95_latency: [{ ctx, expect: 1120, empty: empty() }, { ctx: sampleBulkResultsCtx({ matches: (item) => item.index < 2 }), expect: 812 }],
  cost_per_1000: { ctx, expect: 0.036, tolerance: 1e-12, empty: empty() },
  answered_share: { ctx, expect: 0.75, empty: empty() },
  tokens_per_row: { ctx, expect: 855, empty: empty() },

  shown_answers_csv: { ctx: sampleBulkResultsCtx({ matches: (item) => item.index === 0 || item.index === 4 }), filename: "bulk-answers.csv",
    text: '"row","status","department","department:p","frustration","frustration:p","is_urgent","is_urgent:p","wants_refund","wants_refund:p"\r\n'
      + '"1","answered","shipping","0.88","1","0.6","no","0.78","yes","0.91"\r\n'
      + '"5","answered","","","","","","","",""\r\n',
    excludes: ['"0.8"', "seal_damage", "Seal was open"] },
  disagreements_csv: { ctx, filename: "bulk-disagreements.csv",
    text: '"row","question","label","answer","probability"\r\n"2","wants_refund","no","yes","0.62"\r\n"3","department","billing","shipping","0.45"\r\n' },
  run_summary_md: { ctx: stopped, filename: "bulk-run-summary.md",
    text: "# Bulk run summary\n\n- Rows: 8 (6 answered, 1 failed, 1 skipped; 1 held out)\n- Model asked: jev-latest\n- Wall time: 2140 ms (summed across attempts)\n"
      + "- Input tokens: 5130\n- Measured cost: $0.000216\n- Stopped early: Session budget spent\n",
    check: () => assert.throws(() => pack.features.find((feature) => feature.id === "run_summary_md").build(empty()), /Run Bulk first/) },

  sort_by_row: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["sortBy", "__row", 1]]), hidden: empty },
  keep_labels: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["keepLabels"]]), hidden: () => sampleBulkResultsCtx({ labelsDirty: false }) },
  download_csv: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["downloadCsv"]]), hidden: empty },
  first_failed: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["focusRow", 3]]),
    hidden: () => sampleBulkResultsCtx({ matches: (item) => item.status !== "failed" }) },
}, { ctx: () => sampleBulkResultsCtx() });
