import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/labeling-queue-more.js";
import { runDiagnostics, runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { sampleLabelingDrafts, sampleLabelingQueueCtx, sampleLabelingReport } from "./fixtures/workbench-labeling.mjs";

// Fixture queue (all rows): Row 1 ready (urgent yes, topic shipping, tone 0); Row 2 current, topic wholesale; Rows 4
// and 5 identical inputs with a loaded picture, Row 5 topic billing; Row 6 ready (tone 2), picture not loaded; Row 7
// blank text, urgent missing; Row 9 urgent no, topic missing.
const base = () => sampleLabelingQueueCtx();
const byRow = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.row_number, item]));
const R = byRow(base());
const closed = () => sampleLabelingQueueCtx({ report: null });
const chat = () => sampleLabelingQueueCtx({ slice: "chat" });
const ready = () => sampleLabelingQueueCtx({ status: "ready" });
const withDrafts = (drafts) => sampleLabelingQueueCtx({ drafts });
// Two duplicate pairs: rows 4 and 5 (identical input, neither drafted) and rows 7 and 10 (a second copy of row 7's input
// at index 9, added here); row 7 has an urgent draft, so its pair is not undrafted even on row 10, which is blank itself.
const twoPairs = { ...sampleLabelingReport(), items: [...sampleLabelingReport().items, { index: 9, row: { text: "", channel: "phone" }, missing: ["urgent"] }] };
const undrafted = sampleLabelingQueueCtx({ report: twoPairs, drafts: { 0: { urgent: true }, 6: { urgent: true } } });
const D = byRow(undrafted);
// Four topic drafts (as many as topic has options) using billing, shipping and wholesale, never beans.
const coverage = withDrafts({ 0: { topic: "billing" }, 1: { topic: "billing" }, 3: { topic: "shipping" }, 8: { topic: "wholesale" } });
// Three topic drafts, all billing; and only two, which is below the check's minimum of three.
const same = withDrafts({ 0: { topic: "billing" }, 1: { topic: "billing" }, 4: { topic: "billing" } });
const sameTwo = withDrafts({ 0: { topic: "billing" }, 1: { topic: "billing" } });
// Tone drafts 0 and 1: a middle level is used.
const middleUsed = withDrafts({ 0: { tone: 0 }, 1: { tone: 1 } });
// Tone drafts 0, 0 and 0 (rows 1, 2 and 4): only the bottom level.
const bottomOnly = withDrafts({ 0: { tone: 0 }, 1: { tone: 0 }, 3: { tone: 0 } });
// Topic drafts billing, billing, shipping, billing: billing holds 3 of 4.
const skew = withDrafts({ 0: { topic: "billing" }, 1: { topic: "billing" }, 3: { topic: "shipping" }, 4: { topic: "billing" } });
const importing = sampleLabelingQueueCtx({ csvPreview: { counts: { rows: 3, matched: 2, labels: 4 } } });
const noteOnly = sampleLabelingQueueCtx({ guidelines: { guidelines: { urgent: { note: "Today only", examples: [] } } } });

// FNV-1a 32-bit of rows 4 and 5's identity, '{"_image":"receipt-scan","channel":"chat","text":"Charged twice for my
// subscription"}' (their input with keys sorted), worked out separately in Python:
//   h = 0x811C9DC5; for b in identity.encode(): h = ((h ^ b) * 0x01000193) % 2**32   ->  d315e161
const TWICE_HASH = "d315e161";

const feature = (id) => pack.features.find((entry) => entry.id === id);
const fakeLike = (list) => ({ items: () => list, data: {} });

checkPack(pack, {
  row_number: { items: [R[1], R[5], R[9]], values: [1, 5, 9] },
  score_level: { items: [R[1], R[6], R[2]], values: [0, 2, null], ctx: base() },
  current_row: { items: [R[2], R[1]], values: [true, false] },
  blank_noul: { items: [R[2], R[1], R[9], R[7]], values: [true, false, false, true], ctx: base() },
  blank_choice: { items: [R[4], R[5], R[9], R[2]], values: [true, false, true, false], ctx: base() },
  blank_score: { items: [R[2], R[6], R[9]], values: [true, false, false], ctx: base() },
  duplicate_all_blank: { items: [D[4], D[5], D[1], D[7], D[10]], values: [true, true, false, false, false], ctx: undrafted },
  first_blank_type: { items: [R[1], R[2], R[4], R[5]], values: [null, "noul", "choice", "score"], ctx: base() },
  picture_status: { items: [R[1], R[4], R[6]], values: ["none", "loaded", "not loaded"] },
  missing_set: { items: [R[1], R[2], R[4], R[6], R[9]], values: ["urgent+topic+tone", "urgent+topic+tone", "topic+tone", "tone", "urgent+topic"] },
  picture_name: { items: [R[4], R[6], R[1]], values: ["receipt-scan", "latte-photo", null] },
  blank_questions: { items: [R[1], R[2], R[4], R[5]], values: ["", "urgent, tone", "topic, tone", "tone"] },

  picture_not_loaded: { hit: R[6], miss: [R[4], R[1]], message: /^Row 6 names the picture “latte-photo”, which is not loaded/ },
  blank_field: { hit: R[7], miss: [R[1], R[2], R[6]], message: /^Row 7: the text field is blank\./ },
  duplicate_half_drafted: { hit: R[4], miss: [R[5], R[1], R[2]], ctx: base(), message: /^Row 4 has no topic draft, but row 5 with the same input drafts topic = billing\./ },
  unused_choice_option: { hitList: coverage.items(), ctx: coverage, message: /^topic: 4 drafts, none uses beans\.$/,
    missList: base().items(), missCtx: base() },
  one_label_only: { hitList: same.items(), ctx: same, message: /^topic: all 3 drafts are billing\.$/, missList: sameTwo.items(), missCtx: sameTwo },
  import_waiting: { hitList: importing.items(), ctx: importing, message: /^An import with 4 draft labels for 2 matched rows waits/,
    missList: base().items(), missCtx: base() },
  undrafted_question: { hitList: [R[4], R[7]], missList: Object.values(R), ctx: base(), message: /^No draft yet for urgent, topic, tone on the listed rows\.$/ },
  score_middle_unused: { hitList: Object.values(R), missList: middleUsed.items(), ctx: base(), missCtx: middleUsed,
    message: /^tone: the 2 drafts use only levels 0 and 2; none uses 1\.$/ },
  guideline_no_examples: { hitList: noteOnly.items(), ctx: noteOnly, message: /^urgent has a guideline note but no examples/,
    missList: base().items(), missCtx: base() },

  // 14 missing labels in the slice (3+3+2+2+1+1+2), 7 drafted (3+1+0+1+1+0+1). Chat: 6 missing, 2 drafted.
  labels_left: [
    { ctx: base(), expect: (result) => { assert.equal(result.value, 7); assert.equal(result.detail, "7 of 14 labels drafted in this slice"); }, empty: closed() },
    { ctx: chat(), expect: (result) => { assert.equal(result.value, 4); assert.equal(result.detail, "2 of 6 labels drafted in this slice"); } },
  ],
  // Noul drafts: Row 1 yes, Row 9 no. Ready rows: Row 1 yes only.
  noul_yes_share: [
    { ctx: base(), expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "1 of 2 Noul drafts"); }, empty: closed() },
    { ctx: ready(), expect: 1 },
  ],
  // Score drafts: 0 (Row 1) and 2 (Row 6). The chat slice has none.
  mean_score_draft: [{ ctx: base(), expect: 1, empty: closed() }, { ctx: chat(), expect: null }],
  // topic=shipping, wholesale, billing out of 4 topic options.
  distinct_choice_keys: [
    { ctx: base(), expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "of 4 Choice options"); }, empty: closed() },
    { ctx: ready(), expect: 1 },
  ],
  largest_label_share: [
    { ctx: base(), expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "urgent = yes: 1 of 2 drafts"); }, empty: closed() },
    { ctx: skew, expect: (result) => { assert.equal(result.value, 0.75); assert.equal(result.detail, "topic = billing: 3 of 4 drafts"); } },
  ],
  guideline_coverage: [
    { ctx: base(), expect: (result) => { assert.equal(result.value, 2 / 3); assert.equal(result.detail, "urgent, topic"); }, empty: closed() },
    { ctx: sampleLabelingQueueCtx({ guidelines: { guidelines: {} } }), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "none"); } },
    { ctx: sampleLabelingQueueCtx({ guidelines: null }), expect: null },
  ],
  // Chat slice: drafts on rows 1 (3), 2 (1) and 6 (1) lie outside it, 5 of all 7.
  outside_slice_share: [
    { ctx: chat(), expect: (result) => { assert.equal(result.value, 5 / 7); assert.equal(result.detail, "5 of 7 draft labels"); }, empty: closed() },
    { ctx: base(), expect: 0 },
  ],

  drafts_md_table: { ctx: ready(), filename: "labeling-drafts-table.md",
    text: "# Shown rows with inputs and draft labels\n\nInputs and your draft labels only; pictures by name. “—” marks a question the row is not missing.\n\n"
      + "| Row | Input | Picture | urgent | topic | tone |\n| --- | --- | --- | --- | --- | --- |\n"
      + '| 1 | {"text":"My order HC-2041 arrived with a torn bag.","channel":"email"} |  | yes | shipping | 0 |\n'
      + '| 6 | {"text":"Love the new Sumatra roast!","channel":"email"} | latte-photo | — | — | 2 |\n',
    excludes: ["Urgent means"] },
  inputs_jsonl: { ctx: ready(), filename: "labeling-inputs.jsonl",
    text: '{"row":1,"input":{"text":"My order HC-2041 arrived with a torn bag.","channel":"email"}}\n'
      + '{"row":6,"input":{"text":"Love the new Sumatra roast!","channel":"email","_image":"latte-photo"}}\n',
    excludes: ["shipping", "draft"] },
  // Blank: urgent on rows 2 and 7; topic on 4 and 9; tone on 2, 4 and 5.
  blank_rows_csv: { ctx: base(), filename: "labeling-blank-rows.csv",
    text: '"question","type","blank","rows"\r\n"urgent","noul","2","2 7"\r\n"topic","choice","2","4 9"\r\n"tone","score","3","2 4 5"\r\n',
    excludes: ["Charged", "billing"] },
  status_text: { ctx: chat(), filename: "labeling-progress.txt",
    text: "Labeling progress: Harbor support inbox\nSlice: channel = chat\nRows: 0 of 3 ready, 3 incomplete\n"
      + "Labels in this slice: 2 of 6 drafted, 4 blank\nDraft labels across all slices: 7 on 5 rows (5 outside this slice)\n"
      + "Drafts are not in the rows box until Apply, and not kept until Save dataset.\n",
    check: () => {
      const out = runExporter(feature("status_text"), base());
      assert.match(out.text, /\nSlice: all rows\nRows: 2 of 7 ready, 5 incomplete\nLabels in this slice: 7 of 14 drafted, 7 blank\n/);
      assert.throws(() => runExporter(feature("status_text"), closed()), /Label missing rows/);
    } },
  duplicate_groups_csv: { ctx: base(), filename: "labeling-duplicate-groups.csv",
    text: `"group","input_hash","copies","rows"\r\n"1","${TWICE_HASH}","2","4 5"\r\n`,
    excludes: ["Charged", "receipt-scan"] },
  guidelines_md: { ctx: base(), filename: "labeling-guidelines.md",
    text: "# Labeling guidelines: Harbor support inbox\n\nHuman-only notes and made-up examples for the people labeling. Never sent to the model.\n\n"
      + "## urgent (noul)\n\nUrgent means the customer cannot use what they paid for today.\n\n"
      + "- “My grinder arrived broken” → yes (cannot brew)\n- “Do you ship to the islands?” → no\n\n"
      + "## topic (choice)\n\n- “Refund my double charge” → billing\n\n## tone (score)\n\nNo guideline saved.\n",
    excludes: ["mugs", "Charged twice", "wholesale"],
    check: () => assert.throws(() => runExporter(feature("guidelines_md"), sampleLabelingQueueCtx({ guidelines: null })), /not loaded/) },

  // From Row 5 the next shown row with a picture is Row 6 (index 5).
  next_picture_row: { ctx: () => sampleLabelingQueueCtx({ nextIndex: 4 }), check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 5]]), hidden: closed },
  // From Row 4 the next duplicate is Row 5 (index 4); the ready rows have no duplicate.
  next_duplicate_row: { ctx: () => sampleLabelingQueueCtx({ nextIndex: 3 }), check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 4]]), hidden: ready },
  // Partly drafted rows: 2, 5 (topic only) and 9. From Row 2 the next is Row 5 (index 4); from Row 5, Row 9 (index 8).
  next_partial_row: { ctx: base, check: async (ctx) => {
    assert.deepEqual(ctx.log, [["goTo", 4]]);
    await feature("next_partial_row").run(ctx);
    assert.deepEqual(ctx.log, [["goTo", 4], ["goTo", 8]]);
  }, hidden: ready },
  // With Row 9 fully drafted, the last incomplete row is Row 7 (index 6).
  last_incomplete: { ctx: () => withDrafts({ ...sampleLabelingDrafts(), 8: { urgent: false, topic: "billing" } }),
    check: (ctx) => assert.deepEqual(ctx.log, [["goTo", 6]]), hidden: ready },
  // Incomplete rows are indexes 1, 3, 4, 6, 8: before index 1 it wraps to index 8.
  previous_incomplete: { ctx: base, check: (ctx) => {
    assert.deepEqual(ctx.log, [["next", -1]]);
    assert.equal(ctx.state.nextIndex, 8);
    assert.equal(ctx.state.status, "incomplete");
  }, hidden: closed },
  copy_current_blank: { ctx: base, check: (ctx) => {
    assert.deepEqual(ctx.env.copied, ["urgent, tone"]);
    assert.match(ctx.env.toasts[0].message, /2 blank questions of row 2/);
  }, hidden: () => sampleLabelingQueueCtx({ nextIndex: 0 }) },
  clear_current_drafts: { ctx: base, check: (ctx) => {
    assert.deepEqual(ctx.log, [["writeDrafts", [[1, { urgent: null, topic: null, tone: null }]], "Clear the current row's drafts"]]);
    assert.deepEqual(Object.keys(ctx.state.drafts[1]), []);
    assert.deepEqual({ ...ctx.state.drafts[4] }, { topic: "billing" });
    assert.match(ctx.env.toasts[0].message, /1 draft label on row 2/);
  }, hidden: () => sampleLabelingQueueCtx({ nextIndex: 3 }) },
}, { ctx: () => base() });

test("labeling-queue-more: the middle-levels check names the levels actually used", () => {
  const found = runDiagnostics([["k", feature("score_middle_unused")]], bottomOnly.items(), bottomOnly);
  assert.deepEqual(found.map((finding) => finding.message), ["tone: the 3 drafts use only level 0; none uses 1."]);
});

test("labeling-queue-more: identical-input hints ignore rows without an identity", () => {
  assert.equal(feature("duplicate_half_drafted").check({ index: 0, missing: ["topic"], draft: {} }, fakeLike([{ index: 1, missing: ["topic"], draft: { topic: "billing" } }])), null);
});
