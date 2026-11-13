// Tests for the Compare result tools pack (static/js/lab/packs/workbench/compare-result-tools.js). Expected values are
// worked out by hand from tests/js/lab/fixtures/workbench-compare.mjs: the 7-row run scored on "department", whose
// shown rows (the disagreements) are #1 a_only, #2 b_only, #4 unlabeled and #6 both_wrong.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/compare-result-tools.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { COMPARE_REPORTS, COMPARE_RESULT, QUESTIONS_B, sampleCompareRowsCtx } from "./fixtures/workbench-compare.mjs";

const ctx = sampleCompareRowsCtx();
const [r1, r2, r4, r6] = ctx.shown();

// B no longer offers "wholesale" for department.
const { wholesale: _dropped, ...narrower } = QUESTIONS_B.department.criteria;
const pickCtx = sampleCompareRowsCtx({ result: { ...COMPARE_RESULT, variants: [COMPARE_RESULT.variants[0],
  { ...COMPARE_RESULT.variants[1], questions: { ...QUESTIONS_B, department: { ...QUESTIONS_B.department, criteria: narrower } } }] } });
// A could not score row #6's label.
const dept = COMPARE_REPORTS.department;
const labelCtx = sampleCompareRowsCtx({ report: { ...dept, variants: [{ ...dept.variants[0], invalid: [{ index: 5, reason: "“shipping” is not an option" }] }, dept.variants[1]] } });
// A reaches 95% at a threshold of 0.62.
const targetCtx = () => sampleCompareRowsCtx({ report: { ...dept, variants: [{ ...dept.variants[0],
  targets: dept.variants[0].targets.map((target) => (target.target === 0.95 ? { ...target, threshold: 0.62 } : target)) }, dept.variants[1]] } });

const scored = (correct, signal) => ({ index: 0, number: 1, correct: [correct, null], signals: [signal, null] });
const csv = (...lines) => lines.map((cells) => `${cells.map((cell) => `"${cell}"`).join(",")}\r\n`).join("");
const logOf = (expected) => (c) => assert.deepEqual(c.log, expected);

checkPack(pack, {
  pick_not_offered: { ctx: pickCtx, hit: pickCtx.shown()[1], miss: [pickCtx.shown()[0], pickCtx.shown()[2], pickCtx.shown()[3]], message: /^A picked “wholesale”, which B does not offer/ },
  label_unscored: { ctx: labelCtx, hit: labelCtx.shown()[3], miss: [labelCtx.shown()[0], labelCtx.shown()[2]], message: /^A cannot score this row's label \(“shipping” is not an option\)/ },
  neither_sure: { hit: [r6, { ...r6, signals: [0.4, 0.4] }], miss: [r1, r2, { ...r6, signals: [0.41, 0.2] }], message: /^Neither variant is sure \(A 0\.(36|40), B 0\.(33|40)/ },
  pick_outside_orders: { hit: { ...r1, picks: ["billing", "wholesale"] }, miss: [r1, r6, r2], message: /^B's averaged answer “wholesale” is neither order's pick \(“shipping” as listed, “billing” reversed\)/ },
  repeated_transition: { hitList: [r1, r4, { ...r1, index: 9, number: 10 }], missList: [r1, r2, r4, r6], message: /^3 of 3 shown disagreements go billing → shipping \(#1, #4, #10\)/ },
  mostly_unlabeled: { ctx, hitList: [r4, r1, { ...r4, index: 7, number: 8 }], missList: [r1, r2, r4, r6], message: /^2 of 3 shown disagreements have no label for “department” \(#4, #8\)/ },
  mostly_both_wrong: { hitList: [r6, r1], missList: [r1, r2, r4, r6], message: /^1 of 2 labeled shown disagreements are wrong in both variants \(#6\)/ },
  // Right 0.5 and 0.3 (mean 0.40), wrong 0.6 and 0.4 (mean 0.50); the miss swaps them.
  signal_inverted: {
    hitList: [scored(true, 0.5), scored(true, 0.3), scored(false, 0.6), scored(false, 0.4)],
    missList: [scored(true, 0.6), scored(true, 0.4), scored(false, 0.5), scored(false, 0.3)],
    message: /^On the shown labeled rows, A's wrong answers .*\(mean 0\.50 on 2 wrong against 0\.40 on 2 right\)/,
  },
  // B's orders split on #1 (shipping, billing) and #6 (other, billing), not on #2 or #4.
  order_sensitive: { ctx, hitList: [r1, r2, r4, r6], missList: [r1, r2, r4], message: /^B picked differently in its two option orders on 2 of 4 shown rows \(#1, #6\): its answer to “department”/ },

  inputs_only: {
    ctx,
    filename: "compare-department-inputs.txt",
    text: "My espresso grinder arrived cracked, I want a refund today.\n{\"text\":\"Where is wholesale order HC-2231?\",\"channel\":\"email\",\"_image\":\"receipt.png\"}\n"
      + "Invoice INV-88 was charged twice on my card.\nDo you ship to Norway?\n",
    excludes: ["billing", "_expect", "0.6"],
  },
  missed_rows: {
    ctx,
    filename: "compare-department-missed-rows.jsonl",
    text: '{"text":"My espresso grinder arrived cracked, I want a refund today.","_expect":{"department":"billing"}}\n'
      + '{"text":"Where is wholesale order HC-2231?","channel":"email","_image":"receipt.png","_expect":{"department":"shipping"}}\n'
      + '{"text":"Do you ship to Norway?","_expect":{"department":"shipping"}}\n',
    excludes: ["Invoice", "0.45", "predicted"],
  },
  agreement_csv: {
    ctx,
    filename: "compare-agreement.csv",
    text: csv(["question", "type", "rows both answered", "answers changed", "rate", "95% low", "95% high", "options reordered", "input check", "changed answers in the same place"],
      ["department", "choice", 5, 4, 0.8, 0.376, 0.964, "no", "no", ""], ["urgent", "noul", 5, 1, 0.2, 0.036, 0.624, "no", "no", ""],
      ["tone", "score", 1, 1, 1, 0.207, 1, "no", "no", ""], ["drink", "choice", 0, 0, "", "", "", "no", "no", ""], ["spot", "box", 1, 1, 1, 0.207, 1, "no", "no", ""]),
  },
  summary_markdown: {
    ctx,
    filename: "compare-department-summary.md",
    includes: ["## Compare summary: “department” (choice)", "| model | jev-1.14.0 | jev-1.14.0 |", "| rows sent | as written | with typos |",
      "| asked | once | in both option orders |", "| calls answered | 7 | 5 |", "| calls failed | 0 | 1 |", "| cost (measured) | $0.00070 | $0.0012 |",
      "| input tokens | 2,100 | 3,600 |", "| median latency | 410 ms | 520 ms |", "| labeled rows scored | 4 | 4 |",
      "| accuracy (95% Wilson) | 50.0% (15.0%–85.0%) | 50.0% (15.0%–85.0%) |", "| calibration gap (ECE) | 0.21 | 0.18 |", "gated on confidence"],
    excludes: ["My espresso", "billing"],
  },
  // Distinct counts so a swapped cell shows: 5 both right, 2 only A, 7 only B, 3 both wrong (17 rows). Exact McNemar on the
  // 9 discordant rows: p = 2 × (C(9,0) + C(9,1) + C(9,2)) / 2^9 = 2 × 46 / 512 = 0.1796875, printed as 0.180.
  paired_markdown: {
    ctx: sampleCompareRowsCtx({ report: { ...dept, paired: { both_right: 5, a_only: 2, b_only: 7, both_wrong: 3, rows: 17, p_value: 0.1796875 } } }),
    filename: "compare-department-paired.md",
    text: "## Row by row: “department”\n\n|  | B right | B wrong |\n| --- | --- | --- |\n| A right | 5 | 2 |\n| A wrong | 7 | 3 |\n\n"
      + "17 labeled rows both variants answered. Exact McNemar test, two-sided: p = 0.180 from the 9 rows where exactly one variant was right. Small samples are rarely conclusive.\n",
  },
  // At 0.37 A automates 3 of 4 labeled rows, 2 right (0.6667); B too. At 0.71 A automates none, B 2 of 4, both right.
  curves_csv: {
    ctx,
    filename: "compare-department-curves.csv",
    includes: ['"0.37","3","0.75","0.6667","0.1","0.99","3","0.75","0.6667","0.1","0.99"\r\n', '"0.71","0","0","","","","2","0.5","1","0.1","0.99"\r\n',
      '"1","0","0","","","","0","0","","",""\r\n'],
    check: (out) => assert.equal(out.text.split("\r\n").length, 103),
  },
  // k = 37 lies in the fixture's 0.37..0.60 band: 2 escalated, 3 correct, cost 0.0004 + 0.0005, latency 397.5 + 255.
  cascade_csv: {
    ctx,
    filename: "compare-department-cascade.csv",
    includes: ['"0","A","B","0","0","2","0.5","0.0004","397.5"\r\n', '"0.37","A","B","2","0.5","3","0.75","0.0009","652.5"\r\n', '"1","A","B","4","1","2","0.5","0.0014","912.5"\r\n'],
    check: (out) => assert.equal(out.text.split("\r\n").length, 103),
  },
  slices_csv: {
    ctx,
    filename: "compare-department-slices.csv",
    text: csv(["field", "value", "rows", "A labeled", "A correct", "A accuracy", "A 95% low", "A 95% high", "B labeled", "B correct", "B accuracy", "B 95% low", "B 95% high",
      "only A right", "only B right", "McNemar p", "error"], ["channel", "email", 1, 1, 0, 0, 0, 0.79, 1, 1, 1, 0.21, 1, 0, 1, 1, ""]),
  },
  failed_calls_csv: {
    ctx,
    filename: "compare-failed-calls.csv",
    text: csv(["row", "variant", "outcome", "message"], [5, "B", "failed", "Rate limit reached"], [7, "B", "skipped", "Session budget reached; 1 call was skipped."]),
  },
  orders_csv: {
    ctx,
    filename: "compare-order-splits.csv",
    text: csv(["variant", "question", "rows both orders answered", "picked differently", "rate", "95% low", "95% high"], ["B", "department", 5, 1, 0.2, 0.036, 0.624]),
  },
  // A reaches 95% at 0.62, automating 2 of 4 labeled rows (share 0.5), both right, Wilson 95% for 2/2 from 0.3424 to 1.
  targets_csv: {
    ctx: sampleCompareRowsCtx({ report: { ...dept, variants: [{ ...dept.variants[0], targets: dept.variants[0].targets.map((target) => (target.target === 0.95
      ? { ...target, threshold: 0.62, coverage: 0.5, automated: 2, accuracy: 1, low: 0.34237, high: 1, needed: 0 } : target)) }, dept.variants[1]] } }),
    filename: "compare-department-targets.csv",
    includes: ['"A","these rows","0.9","","","0","","","","29"\r\n', '"A","these rows","0.95","0.62","0.5","2","1","0.3424","1","0"\r\n',
      '"B","these rows","0.99","","","0","","","","29"\r\n'],
    check: (out) => assert.equal(out.text.split("\r\n").length, 8),
  },
  rewritten_inputs: {
    ctx,
    filename: "compare-rewritten-inputs.jsonl",
    text: '{"row":1,"variant":"B","sent":"My espreso grinder arived cracked, I want a refund today."}\n'
      + '{"row":2,"variant":"B","sent":{"text":"Where is wholesale ordr HC-2231?","channel":"email","_image":"receipt.png"}}\n'
      + '{"row":4,"variant":"B","sent":"Invoice INV-88 was chargd twice on my card."}\n{"row":6,"variant":"B","sent":"Do you shp to Norway?"}\n',
    excludes: ["_expect", "billing"],
  },
  experiment_note: {
    ctx,
    filename: "compare-department-note.md",
    includes: ["# Compare note: “department”", "- A: jev-1.14.0, 7 questions, rows as written, asked once", "- B: jev-1.14.0, 7 questions, rows with typos, asked in both option orders",
      "- 7 tuning rows sent, 1 test row left out; the run stopped: Session budget reached; 1 call was skipped.",
      "- A: accuracy 50.0% (95% Wilson 15.0%–85.0%) on 4 labeled rows, calibration gap 0.21", "- B: accuracy 50.0% (95% Wilson 15.0%–85.0%) on 4 labeled rows, calibration gap 0.18",
      "- Rows only A got right: 1; rows only B got right: 1; exact McNemar p = 1.000", "- A and B answered differently on 4 of 5 rows both answered", "rarely conclusive"],
    excludes: ["My espresso", "billing"],
  },
  ignored_labels_csv: { ctx: labelCtx, filename: "compare-department-ignored-labels.csv", text: csv(["row", "variant", "reason"], [6, "A", "“shipping” is not an option"]) },
  usage_csv: {
    ctx,
    filename: "compare-usage.csv",
    includes: ['"1","400","300","40","0.0001","1","560","720","40","0.0003","2"\r\n', '"5","450","320","40","0.0001","1","90","0","40","0","1"\r\n',
      '"7","400","300","40","0.0001","1","","","","",""\r\n'],
    excludes: ["espresso", "billing"],
    check: (out) => assert.equal(out.text.split("\r\n").length, 9),
  },

  toggle_bound: { ctx: () => sampleCompareRowsCtx(), check: logOf([["setBound", "lower"]]), hidden: () => sampleCompareRowsCtx({ running: true }) },
  swap_first: { ctx: () => sampleCompareRowsCtx(), check: logOf([["setFirst", "B"]]), hidden: () => sampleCompareRowsCtx({ qid: "urgent" }) },
  cascade_match: { ctx: () => sampleCompareRowsCtx(), check: logOf([["setCascadeThreshold", 0]]), hidden: () => sampleCompareRowsCtx({ qid: "urgent" }) },
  cascade_best: { ctx: () => sampleCompareRowsCtx(), check: logOf([["setCascadeThreshold", 0.37]]), hidden: () => sampleCompareRowsCtx({ qid: "tone" }) },
  cascade_target: { ctx: targetCtx, check: logOf([["setCascadeThreshold", 0.62]]), hidden: () => sampleCompareRowsCtx() },
  // Shared: department, urgent, tone, drink, spot. Before department comes spot.
  previous_question: { ctx: () => sampleCompareRowsCtx(), check: logOf([["selectQuestion", "spot"]]), hidden: () => sampleCompareRowsCtx({ running: true }) },
  // Labeled: department, urgent, tone, spot. After tone, drink has no label, so spot.
  next_labeled_question: { ctx: () => sampleCompareRowsCtx({ qid: "tone" }), check: logOf([["selectQuestion", "spot"]]), hidden: () => sampleCompareRowsCtx({ running: true }) },
  // Rates: department 0.8, urgent 0.2, tone 1, drink none, spot 1; tone comes first of the two at 1.
  most_changed_question: { ctx: () => sampleCompareRowsCtx(), check: logOf([["selectQuestion", "tone"]]), hidden: () => sampleCompareRowsCtx({ qid: "tone" }) },
  use_a_in_build: { ctx: () => sampleCompareRowsCtx(), check: logOf([["useInBuild", 0]]), hidden: () => sampleCompareRowsCtx({ running: true }) },
  use_b_in_build: { ctx: () => sampleCompareRowsCtx(), check: logOf([["useInBuild", 1]]), hidden: () => sampleCompareRowsCtx({ result: null }) },
  label_disagreements: { ctx: () => sampleCompareRowsCtx(), check: logOf([["labelDisagreements"]]), hidden: () => sampleCompareRowsCtx({ qid: "spot" }) },
}, { ctx: () => sampleCompareRowsCtx() });

// ---------- beyond the per-feature cases ----------

const feature = (id) => pack.features.find((entry) => entry.id === id);

test("compare-result-tools: before a run every export is empty or refuses, and holds no row", () => {
  const empty = sampleCompareRowsCtx({ result: null });
  for (const entry of pack.features.filter((one) => one.kind === "exporter")) {
    let text = "";
    try { text = runExporter(entry, empty).text; } catch (error) { assert.match(error.message, /no Compare report/); continue; }
    assert.ok(!/espresso|Norway|billing/.test(text), `${entry.id} holds nothing from a run`);
  }
});

test("compare-result-tools: the inputs export follows the Lab filter and sort", () => {
  const sorted = sampleCompareRowsCtx({ hide: [0], order: [5, 3] });
  assert.equal(runExporter(feature("inputs_only"), sorted).text, "Do you ship to Norway?\nInvoice INV-88 was charged twice on my card.\n{\"text\":\"Where is wholesale order HC-2231?\",\"channel\":\"email\",\"_image\":\"receipt.png\"}\n");
});

test("compare-result-tools: a text row that would not fit on one line is written as the object it is sent as", () => {
  const custom = { ...ctx, shown: () => [{ ...r1, row: "two\nlines" }, { ...r1, row: "{ not json" }] };
  assert.equal(runExporter(feature("inputs_only"), custom).text, '{"text":"two\\nlines"}\n{"text":"{ not json"}\n');
});

test("compare-result-tools: targets name the lower-bound basis when it is selected", () => {
  const lower = sampleCompareRowsCtx({ bound: "lower", report: { ...dept, bound: "lower" } });
  assert.match(runExporter(feature("targets_csv"), lower).text, /"A","95% lower bound","0.9"/);
});

test("compare-result-tools: the label handoff command is hidden while it is being prepared", () => {
  assert.equal(feature("label_disagreements").when(sampleCompareRowsCtx({ labeling: true })), false);
  assert.equal(feature("cascade_target").when(sampleCompareRowsCtx({ qid: "urgent" })), false);
});

test("compare-result-tools: the cascade CSV says its cost and latency are a what-if from measured calls", () => {
  const head = runExporter(feature("cascade_csv"), ctx).text.split("\r\n")[0];
  assert.match(head, /cascade cost on scored rows \(USD, from measured calls\)/);
  assert.match(feature("cascade_csv").help, /not spend/);
});
