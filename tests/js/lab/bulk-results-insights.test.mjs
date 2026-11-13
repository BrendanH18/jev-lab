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
// A stopped run asked for the alias jev-latest and answered by the version jev-1.14.0.
const summarized = (() => {
  const result = structuredClone(ctx.state.result);
  result.stopped = "Session budget spent";
  result.model = "jev-1.14.0";
  return sampleBulkResultsCtx({ result });
})();

// Odd rows: no answers, a Box-only row, and a meta with text where numbers belong.
const odd = [{ answers: null, meta: null }, { answers: { spot: { type: "box", p: null, confidence: null, agrees: null } }, meta: { latency_ms: "812", cost_usd: null } },
  { answers: { gone: null }, meta: null }];

checkPack(pack, {
  // Row 0: department 0.88, frustration level 1 at 0.6, is_urgent max(0.22, 0.78), wants_refund 0.91 -> 0.6.
  // Row 2: department 0.45 is the lowest; row 6: is_urgent exactly 0.5; row 7: frustration level 2 at 0.55.
  min_p: { items: [...items, ...odd], values: [0.6, 0.62, 0.45, null, null, null, 0.5, 0.55, null, null, null] },
  // Confidence fields only (Noul carries none): row 2's Box at 0.12 is the lowest.
  min_confidence: { items: [...items, ...odd], values: [0.55, 0.48, 0.12, null, null, null, 0.2, 0.4, null, null, null] },
  // Row 1: wants_refund labeled false, answered 0.62 (yes). Row 2: billing labeled, shipping answered. Row 6's label is invalid.
  disagreements: { items: [...items, ...odd], values: [0, 1, 1, null, null, null, 0, 0, null, 0, 0] },
  latency: { items: [...items, ...odd], values: [812, 790, 1033, null, 845, null, 702, 1120, null, null, null] },
  cost: { items: [...items, ...odd], values: [0.0000366, 0.0000361, 0.0000370, null, 0.0000358, null, 0.0000345, 0.0000360, null, null, null] },
  status: { items: [...items, { status: 7 }], values: ["answered", "answered", "answered", "failed", "answered", "skipped", "answered", "answered", null] },
  cal_answer: { ctx, items, values: ["shipping", "shipping", "shipping", null, null, null, "none", "shipping"] },
  error: { items: [...variant.items(), { error: { code: 429 } }], values: ["", "", "", "Rate limited: try again in a few seconds", "", "Session budget spent", "", "", ""] },

  invalid_label: { hit: items[6], miss: [items[0], items[3], items[4], ...odd], message: /label for department is not one of its options/ },
  stopped_run: { ctx: stopped, hitList: stopped.items(), missList: stopped.items().filter((item) => item.status !== "skipped"), message: /^1 shown row never sent: the run stopped early \(Session budget spent\)/ },
  mixed_models: { hitList: variant.items(), missList: items, message: /2 model versions \(jev-1\.14\.0, jev-1\.15\.0\)/ },
  tiny_box: { hit: items[2], miss: [items[0], items[1], items[4], ...odd], message: /^The seal_damage box covers under 1%/ },

  agreement_rate: [{ ctx, expect: 0.8, empty: empty() }, { ctx: sampleBulkResultsCtx({ matches: (item) => item.index === 2 }), expect: 2 / 3, tolerance: 1e-12 }],
  mean_latency: [{ ctx, expect: 5302 / 6, tolerance: 1e-12, empty: empty() }, { ctx: sampleBulkResultsCtx({ matches: (item) => item.index === 3 }), expect: null }],
  p95_latency: [{ ctx, expect: 1120, empty: empty() }, { ctx: sampleBulkResultsCtx({ matches: (item) => item.index < 2 }), expect: 812 }],
  cost_per_1000: { ctx, expect: 0.036, tolerance: 1e-12, empty: empty() },
  tokens_per_row: { ctx, expect: 855, empty: empty() },

  shown_answers_csv: { ctx: sampleBulkResultsCtx({ matches: (item) => item.index === 0 || item.index === 4 }), filename: "bulk-answers.csv",
    text: '"row","status","department","department:p","frustration","frustration:p","is_urgent","is_urgent:p","wants_refund","wants_refund:p"\r\n'
      + '"1","answered","shipping","0.88","1","0.6","no","0.78","yes","0.91"\r\n'
      + '"5","answered","","","","","","","",""\r\n',
    excludes: ['"0.8"', "seal_damage", "Seal was open"] },
  disagreements_csv: { ctx, filename: "bulk-disagreements.csv",
    text: '"row","question","label","answer","probability"\r\n"2","wants_refund","no","yes","0.62"\r\n"3","department","billing","shipping","0.45"\r\n' },
  run_summary_md: { ctx: summarized, filename: "bulk-run-summary.md",
    text: "# Bulk run summary\n\n- Rows: 8 (6 answered, 1 failed, 1 skipped; 1 held out)\n- Model asked: jev-latest\n- Model that answered: jev-1.14.0\n- Wall time: 2140 ms (summed across attempts)\n"
      + "- Input tokens: 5130\n- Measured cost: $0.000216\n- Stopped early: Session budget spent\n",
    excludes: ["Charged twice", "shipping", "billing"],
    check: () => assert.throws(() => pack.features.find((feature) => feature.id === "run_summary_md").build(empty()), /Run Bulk first/) },

  sort_by_row: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["sortBy", "__row", 1]]), hidden: empty },
  keep_labels: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["keepLabels"]]), hidden: () => sampleBulkResultsCtx({ labelsDirty: false }) },
  download_csv: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["downloadCsv"]]), hidden: empty },
  first_failed: { ctx: () => sampleBulkResultsCtx(), check: (c) => assert.deepEqual(c.calls, [["focusRow", 3]]),
    hidden: () => sampleBulkResultsCtx({ matches: (item) => item.status !== "failed" }) },
}, { ctx: () => sampleBulkResultsCtx() });
