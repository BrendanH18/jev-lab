import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/labeling-queue-essentials.js";
import { checkPack } from "./harness.mjs";
import { sampleLabelingQueueCtx, sampleLabelingReport } from "./fixtures/workbench-labeling.mjs";

const base = () => sampleLabelingQueueCtx();
const byRow = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.row_number, item]));
const R = byRow(base());
// Identical inputs (rows 4 and 5) with different drafts for topic; row 1 drafts urgent only.
const conflictCtx = () => sampleLabelingQueueCtx({ drafts: { 0: { urgent: true }, 3: { topic: "shipping" }, 4: { topic: "billing" } } });
const C = byRow(conflictCtx());
// Hand-made inputs for input length: 8, 6 + 4, 0 + 5 (the picture name is not text), and 4 (numbers are not text).
const lengthCtx = sampleLabelingQueueCtx({ drafts: {}, report: { ...sampleLabelingReport(), items: [
  { index: 0, row: "Hi there", missing: ["urgent"] },
  { index: 1, row: { text: "Refund", channel: "chat" }, missing: ["urgent"] },
  { index: 2, row: { text: "", channel: "phone", _image: "receipt-scan" }, missing: ["urgent"] },
  { index: 3, row: { order: { id: "HC-1", items: 2 } }, missing: ["urgent"] },
] } });
const L = lengthCtx.items();
const closed = () => sampleLabelingQueueCtx({ report: null });

checkPack(pack, {
  missing_labels: { items: [R[1], R[4], R[6]], values: [3, 2, 1] },
  drafted_labels: { items: [R[1], R[2], R[4]], values: [3, 1, 0] },
  blank_labels: { items: [R[1], R[2], R[5]], values: [0, 2, 1] },
  input_length: { items: L, values: [8, 10, 5, 4], ctx: lengthCtx },
  picture: { items: [R[4], R[1], R[6]], values: [true, false, true] },
  partly_drafted: { items: [R[1], R[2], R[4], R[9]], values: [false, true, false, true] },
  duplicate_input: { items: [R[4], R[5], R[1]], values: [true, true, false], ctx: base() },
  // Guidelines exist for urgent and topic, not tone.
  guided: { items: [R[6], R[7], R[4]], values: [false, true, true], ctx: base() },
  input_shape: { items: [R[2], R[1]], values: ["text", "object"] },
  next_blank: { items: [R[1], R[2], R[4], R[5]], values: [null, "urgent", "topic", "tone"] },
  input_text: { items: [R[1], R[2], R[7], R[9]], values: ["My order HC-2041 arrived with a torn bag. · email",
    "Do you sell 5 lb bags of the Harbor House blend wholesale? Reply to buyer@cafe-north.example", "phone", "Where is my order? · chat · HC-2077"] },
  draft_labels: { items: [R[1], R[4], R[9], R[6]], values: ["urgent=yes; topic=shipping; tone=0", "", "urgent=no", "tone=2"] },

  draft_conflict: { hit: [C[4], C[5]], miss: [C[1], C[9]], message: /same input with topic = (billing|shipping)/, ctx: conflictCtx() },
  partial_row: { hit: [R[2], R[9]], miss: [R[1], R[4]], message: /still blank/ },
  // Seven drafts in all; row 1 holds three of them.
  drafts_elsewhere: { hitList: [R[1]], missList: Object.values(R), message: /^4 draft labels sit on rows not listed here/, ctx: base() },
  unguided_questions: { hitList: [R[6]], missList: [R[7], R[9]], message: /guideline for tone\./, ctx: base() },

  clear_drafts: { input: [R[1], R[4]], output: [{ ...R[1], draft: {} }, R[4]], unchanged: [R[4], R[7]], ctx: base() },
  set_label: { input: [R[2], R[4], R[6]], params: { question: "tone", label: "1" }, ctx: base(),
    output: [{ ...R[2], draft: { topic: "wholesale", tone: 1 } }, { ...R[4], draft: { tone: 1 } }, R[6]],
    unchanged: [R[1]],
    rejects: [{ params: { question: "mood", label: "1" }, message: /No question “mood”/ }, { params: { question: "tone", label: "5" }, message: /tone takes one of: 0, 1, 2/ }] },
  copy_duplicate_drafts: { input: [R[4], R[5], R[1]], output: [{ ...R[4], draft: { topic: "billing" } }, R[5], R[1]], unchanged: [C[4], C[5]] },

  ready_share: [{ ctx: base(), expect: 2 / 7, empty: closed() }, { ctx: sampleLabelingQueueCtx({ status: "incomplete" }), expect: 0 }],
  shown_drafted: [{ ctx: base(), expect: 7, empty: closed() }, { ctx: sampleLabelingQueueCtx({ status: "ready" }), expect: 4 }],
  top_blank_question: { ctx: base(), expect: (result) => { assert.equal(result.value, "tone"); assert.equal(result.detail, "3 blank labels"); }, empty: closed() },
  distinct_inputs: { ctx: base(), expect: (result) => { assert.equal(result.value, 6); assert.equal(result.detail, "1 duplicate row"); }, empty: closed() },

  drafts_csv: { ctx: sampleLabelingQueueCtx({ status: "ready" }), filename: "labeling-queue-drafts.csv",
    text: [
      '"row","input","picture","question","type","draft"',
      '"1","{""text"":""My order HC-2041 arrived with a torn bag."",""channel"":""email""}","","urgent","noul","yes"',
      '"1","{""text"":""My order HC-2041 arrived with a torn bag."",""channel"":""email""}","","topic","choice","shipping"',
      '"1","{""text"":""My order HC-2041 arrived with a torn bag."",""channel"":""email""}","","tone","score","0"',
      '"6","{""text"":""Love the new Sumatra roast!"",""channel"":""email""}","latte-photo","tone","score","2"',
    ].join("\r\n") + "\r\n",
    excludes: ["row_id", "label:", "Urgent means"] },
  checklist_md: { ctx: sampleLabelingQueueCtx({ status: "ready" }), filename: "labeling-checklist.md",
    text: "# Labeling checklist\n\n2 rows · inputs and your draft labels only; pictures by name.\n\n"
      + "- [x] Row 1 — urgent: yes · topic: shipping · tone: 0\n  > My order HC-2041 arrived with a torn bag. · email\n"
      + "- [x] Row 6 — tone: 2\n  > Love the new Sumatra roast! · email (picture: latte-photo)\n" },
  question_tally_csv: { ctx: base(), filename: "labeling-tally.csv",
    text: '"question","type","rows_missing","drafted","blank"\r\n"urgent","noul","4","2","2"\r\n"topic","choice","5","3","2"\r\n"tone","score","5","2","3"\r\n',
    excludes: ["Charged twice", "billing"] },

  first_incomplete: { ctx: base, check: (ctx) => { assert.deepEqual(ctx.log, [["goTo", 1]]); assert.equal(ctx.state.nextIndex, 1); },
    hidden: () => sampleLabelingQueueCtx({ status: "ready" }) },
  copy_row_numbers: { ctx: base, check: (ctx) => { assert.deepEqual(ctx.env.copied, ["1, 2, 4, 5, 6, 7, 9"]); assert.match(ctx.env.toasts[0].message, /7 row numbers/); },
    hidden: closed },
  copy_current_input: { ctx: base, check: (ctx) => assert.deepEqual(ctx.env.copied, ["Do you sell 5 lb bags of the Harbor House blend wholesale? Reply to buyer@cafe-north.example"]),
    hidden: () => sampleLabelingQueueCtx({ nextIndex: null }) },

  question_progress: { improvements: {
    progress_table: (t) => {
      const tree = t.render(base());
      const row = (qid) => t.find(tree, (node) => node.tag === "tr" && node.attrs["data-question"] === qid);
      assert.deepEqual(row("tone").children.map(t.textOf), ["tone", "score", "5", "2", "3", "none"]);
      assert.deepEqual(row("urgent").children.slice(2, 5).map(t.textOf), ["4", "2", "2"]);
      assert.match(t.textOf(t.render(closed())), /Open the queue/);
    },
    guideline_column: (t) => {
      const tree = t.render(base());
      const cell = (qid) => t.textOf(t.find(tree, (node) => node.tag === "tr" && node.attrs["data-question"] === qid).children[5]);
      assert.equal(cell("urgent"), "saved");
      assert.equal(cell("topic"), "saved");
      assert.equal(cell("tone"), "none");
      const unsaved = t.render(sampleLabelingQueueCtx({ guidelines: null }));
      assert.equal(t.textOf(t.find(unsaved, (node) => node.tag === "tr" && node.attrs["data-question"] === "urgent").children[5]), "not loaded");
    },
  } },
}, { ctx: () => base() });
