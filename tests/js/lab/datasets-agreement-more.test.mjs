import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/datasets-agreement-more.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { sampleAgreementReport, sampleAgreementSample, sampleDatasetsAgreementCtx } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsAgreementCtx(overrides);
const C = ctx();
const [A, B, G, T, X] = C.items();  // rows 3, 7, 12, 18, 25
const [NOT_COMPARED] = ctx({ report: null }).items();  // row 3 before Compare
const NO_REPORT = ctx({ report: null });
const NO_SAMPLE = ctx({ sample: null });
const feature = (id) => pack.features.find((entry) => entry.id === id);

// A comparison with more to report: 7 differences of which 2 are shown, 3 skipped labels, 2 rows no longer found,
// intent's mix-ups 3 + 1 rows, urgent's kappa 0.7.
const oddReport = () => {
  const report = sampleAgreementReport();
  report.disagreements_total = 7;
  report.problems_total = 3;
  report.counts.not_found = 2;
  report.questions.intent.mixups = [{ first: "refund", second: "replacement", rows: 3 }, { first: "question", second: "refund", rows: 1 }];
  report.questions.urgent.kappa = 0.7;
  return report;
};
const ODD = ctx({ report: oddReport() });
// Mix-ups at the edges of "dominates": intent 2 + 2 (a tie is not more than half), urgent 2 rows (fewer than three).
const tieReport = () => {
  const report = sampleAgreementReport();
  report.questions.intent.mixups = [{ first: "refund", second: "replacement", rows: 2 }, { first: "question", second: "refund", rows: 2 }];
  report.questions.urgent.mixups = [{ first: false, second: true, rows: 2 }];
  return report;
};
// Kappas at Landis and Koch's (1977) band edges: < 0 poor, 0-0.20 slight, 0.21-0.40 fair, 0.41-0.60 moderate,
// 0.61-0.80 substantial, 0.81-1 almost perfect.
const BANDS = [[-0.1, "-0.10", "poor (below chance)"], [0, "0.00", "slight"], [0.2, "0.20", "slight"], [0.21, "0.21", "fair"], [0.4, "0.40", "fair"],
  [0.41, "0.41", "moderate"], [0.6, "0.60", "moderate"], [0.61, "0.61", "substantial"], [0.8, "0.80", "substantial"], [0.81, "0.81", "almost perfect"], [1, "1.00", "almost perfect"]];
const bandReport = () => ({ ...sampleAgreementReport(),
  questions: Object.fromEntries(BANDS.map(([kappa], index) => [`k${index}`, { rows: 10, agree: 8, agreement: 0.8, low: 0.5, high: 0.9, kappa, mixups: [] }])) });
// A comparison where one labeled row was no longer in the dataset: rows without differences may not have been compared.
const lostReport = () => ({ ...sampleAgreementReport(), counts: { ...sampleAgreementReport().counts, not_found: 1 } });
// Five rows that each ask all three questions.
const manySample = () => ({ ...sampleAgreementSample(), items: [1, 2, 3, 4, 5].map((n) => ({ row_id: `r${n}`, number: n, row: { text: `Ticket ${n}` }, questions: ["intent", "urgent", "tone"] })) });
const MANY = ctx({ sample: manySample() });
// Row 7 with one more input field.
const wider = () => {
  const sample = sampleAgreementSample();
  sample.items[1].row.order = "HC-1042";
  return sample;
};
const W = ctx({ sample: wider() });
const [WA, WB, WG, , WX] = W.items();

checkPack(pack, {
  row_number: { items: [A, G, X], values: [3, 12, 25] },
  // text + channel; row 7 gains "order"; row 12's _image is not counted; row 25 is plain text.
  input_fields: { items: [WA, WB, WG, WX], values: [2, 3, 2, null] },
  // String lengths counted by hand: 45 + "email" 5; 22 + "chat" 4; 28 + 5 (picture name not counted); 29 + "social" 6; 22.
  input_chars: { items: [A, B, G, T, X], values: [50, 26, 33, 35, 22] },
  // intent 2/3, urgent 0; row 18 asks only tone, which the comparison does not cover. Before Compare it is unknown (checked below).
  agreement_floor: { items: [A, B, G, T, X], values: [0, 2 / 3, 0, null, 0], ctx: C, tolerance: 1e-12 },
  string_input: { items: [X, A], values: [true, false] },
  asks_choice: { items: [A, T], values: [true, false], ctx: C },
  asks_noul: { items: [A, B, T], values: [true, false, false], ctx: C },
  asks_score: { items: [G, T, A], values: [true, true, false], ctx: C },
  asks_every: { items: [G, A, T], values: [true, false, false], ctx: C },
  has_second: { items: [A, G, T, X], values: [true, true, false, false] },
  missing_questions: { items: [A, G, T, X], values: ["", "urgent, tone", "tone", "intent, urgent"] },
  differing_questions: { items: [A, B, G, NOT_COMPARED], values: ["urgent", "", "intent", ""] },

  // Sample: intent asked on 4 rows, urgent on 3, tone on 2; MANY asks each on 5.
  rare_question: { hitList: C.items(), missList: MANY.items(), ctx: C, missCtx: MANY, message: /^(intent|urgent|tone): asked on [234] sampled rows; .*Draw a larger sample\.$/ },
  short_draw: { hitList: [], missList: C.items(), ctx: ctx({ sample: { ...sampleAgreementSample(), sample_size: 8, eligible: 5 } }), missCtx: C,
    message: /^Only 5 of 8 requested rows were drawn: the dataset has 5 eligible labeled rows\.$/ },
  low_agreement: { hitList: C.items(), missList: C.items(), ctx: C, missCtx: NO_REPORT, message: /^(intent: 66\.7% of 3 compared rows|urgent: 0\.0% of 1 compared row) agree;/ },
  dominant_mixup: { hitList: ODD.items(), missList: C.items(), ctx: ODD, missCtx: ctx({ report: tieReport() }), message: /^intent: one pair of labels accounts for 3 of 4 mixed-up rows;/ },
  truncated_comparison: { hitList: ODD.items(), missList: C.items(), ctx: ODD, missCtx: C, message: /^Showing 2 of 7 differences:/ },
  skipped_labels: { hitList: ODD.items(), missList: C.items(), ctx: ODD, missCtx: C, message: /^3 second labels were skipped as not valid answers to their questions\.$/ },
  // Row 12's intent is settled as replacement, which changes its saved refund: one row to save.
  unsaved_settlements: { hitList: C.items(), missList: C.items(), ctx: C, missCtx: ctx({ choices: {} }),
    message: /^1 settled row is not saved yet: press Save settled labels to write it\.$/ },
  pending_settlements: { hitList: [], missList: [], ctx: ctx({ pendingSettlements: [{ row_id: "a1f0", question: "urgent", value: null }, { row_id: "c3d2", question: "intent", value: null }] }),
    missCtx: C, message: /^2 restored settlement choices wait for the next Compare\.$/ },
  rows_not_found: { hitList: ODD.items(), missList: C.items(), ctx: ODD, missCtx: C, message: /^2 compared rows are no longer in the dataset/ },

  // Only intent's kappa (0.5) is measurable; with urgent at 0.7 the mean is 0.6.
  mean_kappa: [{ ctx: C, expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "over 1 of 2 compared questions"); }, empty: NO_REPORT },
    { ctx: ODD, expect: 0.6, tolerance: 1e-12 }],
  // Rows 3 and 7 are done.
  rows_done_share: { ctx: C, expect: (result) => { assert.equal(result.value, 0.4); assert.equal(result.detail, "2 of 5 rows"); }, empty: NO_SAMPLE },
  differences_per_row: [{ ctx: C, expect: (result) => { assert.ok(Math.abs(result.value - 2 / 3) < 1e-12); assert.equal(result.detail, "2 differences over 3 compared rows"); }, empty: NO_REPORT },
    { ctx: ODD, expect: 7 / 3, tolerance: 1e-12 }],
  draw_coverage: { ctx: C, expect: (result) => { assert.ok(Math.abs(result.value - 5 / 30) < 1e-12); assert.equal(result.detail, "5 of 30 labeled rows"); }, empty: NO_SAMPLE },
  min_rows_per_question: { ctx: C, expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "urgent"); }, empty: NO_REPORT },

  settlement_worksheet: { ctx: C, filename: "harbor-support-inbox-settlement-worksheet.md",
    text: "# Settlement worksheet · Harbor support inbox\n\n- [ ] row 3 · urgent\n- [x] row 12 · intent (settled)\n\n"
      + "Row numbers and question IDs only: settle each difference in the page's comparison.\n",
    check: () => {
      assert.throws(() => runExporter(feature("settlement_worksheet"), NO_REPORT), /Compare first/);
      // ODD shows 2 of 7 differences: the worksheet says 5 more are not in it.
      assert.match(runExporter(feature("settlement_worksheet"), ODD).text, /\n\n5 more differences are not in this comparison: save these settlements, then Compare again\.\n\n/);
    } },
  // intent: rows 3, 7, 12, 25 ask it, 3 given; urgent: rows 3, 12, 25, only row 3 given; tone: rows 12, 18, none given.
  progress_markdown: { ctx: C, filename: "harbor-support-inbox-second-labeling-progress.md",
    text: "# Second-labeling progress · Harbor support inbox · 4 of 9 labels given\n\n| Question | Type | Rows asking | Given | Missing |\n| --- | --- | --- | --- | --- |\n"
      + "| intent | choice | 4 | 3 | 1 |\n| urgent | noul | 3 | 1 | 2 |\n| tone | score | 2 | 0 | 2 |\n",
    excludes: ["refund", "stale", "Canada"],
    check: () => assert.throws(() => runExporter(feature("progress_markdown"), NO_SAMPLE), /Draw a sample first/) },
  mixups_with_labels: { ctx: C, filename: "harbor-support-inbox-agreement-mixups-with-labels.md",
    text: "# Label mix-ups with label values · Harbor support inbox\n\nThis file contains saved and second label values from your latest Compare.\n\n"
      + "| Question | Saved label | Second label | Rows |\n| --- | --- | --- | --- |\n| intent | refund | replacement | 1 |\n| urgent | no | yes | 1 |\n",
    check: () => {
      assert.throws(() => runExporter(feature("mixups_with_labels"), NO_REPORT), /Compare first/);
      // ODD: intent's two mix-ups in the report's order, then urgent's.
      assert.match(runExporter(feature("mixups_with_labels"), ODD).text, /\| intent \| refund \| replacement \| 3 \|\n\| intent \| question \| refund \| 1 \|\n\| urgent \| no \| yes \| 1 \|\n$/);
      assert.match(feature("mixups_with_labels").help, /^CONTAINS LABEL VALUES/);
    } },
  // Row 7 has a second label and no difference; rows 3 and 12 differ; rows 18 and 25 have no second labels.
  agreeing_rows: { ctx: C, filename: "harbor-support-inbox-agreeing-rows.txt", text: "row 7\n",
    check: () => {
      assert.throws(() => runExporter(feature("agreeing_rows"), ODD), /only part of the differences/);
      assert.throws(() => runExporter(feature("agreeing_rows"), ctx({ report: lostReport() })), /were not compared/);
      // With no second labels given, no shown row can agree.
      assert.equal(runExporter(feature("agreeing_rows"), ctx({ labels: {} })).text, "No shown row agrees on every compared question.\n");
    } },
  option_inventory: { ctx: C, filename: "harbor-support-inbox-agreement-label-options.md",
    text: "| Question | Type | Options |\n| --- | --- | --- |\n| intent | choice | refund, replacement, question |\n| urgent | noul | yes, no |\n| tone | score | 0, 1, 2 |\n",
    check: () => assert.throws(() => runExporter(feature("option_inventory"), NO_SAMPLE), /Draw a sample first/) },

  agreement_overview: { improvements: {
    draw_summary: (t) => {
      const field = (tree, name) => t.textOf(t.find(tree, (node) => node.tag === "tr" && node.attrs["data-field"] === name).children[1]);
      const tree = t.render(C);
      assert.deepEqual(["requested", "drawn", "eligible", "seed", "session download"].map((name) => field(tree, name)), ["5", "5", "30", "7", "available"]);
      const { session_context: _dropped, ...unrecoverable } = sampleAgreementSample();
      assert.equal(field(t.render(ctx({ sample: unrecoverable })), "session download"), "not available");
      assert.match(t.textOf(t.render(NO_SAMPLE)), /^Draw a sample/);
    },
    completion_grid: (t) => {
      const cells = t.findAll(t.render(C), (node) => node.tag === "span" && node.attrs["data-row"]);
      assert.deepEqual(cells.map(t.textOf), ["row 3: 2/2", "row 7: 1/1", "row 12: 1/3", "row 18: 0/1", "row 25: 0/2"]);
      assert.deepEqual(cells.map((node) => node.attrs.class), ["cell done", "cell done", "cell partial", "cell empty", "cell empty"]);
    },
    kappa_bands: (t) => {
      const row = (c, qid) => t.find(t.render(c), (node) => node.tag === "tr" && node.attrs["data-question"] === qid).children.map(t.textOf);
      assert.deepEqual(row(C, "intent"), ["intent", "3", "0.50", "moderate"]);
      assert.deepEqual(row(C, "urgent"), ["urgent", "1", "—", "not measurable"]);
      assert.deepEqual(row(ODD, "urgent"), ["urgent", "1", "0.70", "substantial"]);
      const B = ctx({ report: bandReport() });
      BANDS.forEach(([, shown, band], index) => assert.deepEqual(row(B, `k${index}`), [`k${index}`, "10", shown, band]));
      assert.match(t.textOf(t.render(NO_REPORT)), /Compare to see kappa bands/);
    },
    settlement_by_question: (t) => {
      const row = (qid) => t.find(t.render(C), (node) => node.tag === "tr" && node.attrs["data-settle"] === qid).children.map(t.textOf);
      assert.deepEqual(row("urgent"), ["urgent", "1", "0", "1"]);
      assert.deepEqual(row("intent"), ["intent", "1", "1", "0"]);
      assert.equal(t.find(t.render(NO_REPORT), (node) => node.attrs?.["data-settle"]), null);
    },
  } },
}, { ctx: () => ctx() });

test("datasets-agreement-more: the lowest agreement is unknown before Compare", () => {
  assert.equal(feature("agreement_floor").value(NOT_COMPARED, NO_REPORT), null);
  assert.equal(feature("differing_questions").value(NOT_COMPARED, NO_REPORT), "");
});

test("datasets-agreement-more: facts and checks give unavailable values on odd items, never an exception", () => {
  const odd = [{}, { questions: "intent", second: null, given: "2", input: 5, differences: {} }, { questions: [7, null], input: { a: { b: ["xy", 3] } } }];
  for (const c of [C, NO_REPORT, NO_SAMPLE, ctx({ sample: null, report: null })]) {
    for (const f of pack.features) {
      for (const item of odd) {
        if (f.kind === "fact") {
          const value = f.value(item, c);
          if (f.type === "number") assert.ok(value === null || Number.isFinite(value), `${f.id}`);
          if (f.type === "flag") assert.equal(value, false, `${f.id}`);
          if (f.type === "text") assert.equal(value, "", `${f.id}`);
        }
      }
      if (f.kind === "diagnostic") f.check(odd, c);
    }
  }
  // Nested text counts; numbers do not.
  assert.equal(feature("input_chars").value(odd[2], C), 2);
});
