import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/labeling-queue-inputs.js";
import { checkPack } from "./harness.mjs";
import { sampleLabelingDrafts, sampleLabelingGuidelines, sampleLabelingQueueCtx } from "./fixtures/workbench-labeling.mjs";

const ctx = (overrides) => sampleLabelingQueueCtx(overrides);
const empty = () => ctx({ report: null });
const R = Object.fromEntries(ctx().items().map((item) => [item.row_number, item]));
// Guidelines with two examples whose inputs are queue rows: topic "Charged twice for my subscription" -> billing (rows 4
// and 5 share that input; row 5 drafts billing, row 4 is blank), and urgent "  where is my ORDER? " -> yes (row 9's text,
// matched without case or edge spaces; row 9 drafts urgent no).
const withExamples = () => {
  const loaded = sampleLabelingGuidelines();
  loaded.guidelines.topic.examples.push({ input: "Charged twice for my subscription", label: "billing" });
  loaded.guidelines.urgent.examples.push({ input: "  where is my ORDER? ", label: true });
  return ctx({ guidelines: loaded });
};
const G = withExamples();
const E = Object.fromEntries(G.items().map((item) => [item.row_number, item]));

const conflicting = ctx({ drafts: { ...sampleLabelingDrafts(), 3: { topic: "shipping" } } });
const D = Object.fromEntries(conflicting.items().map((item) => [item.row_number, item]));

checkPack(pack, {
  // Row 1: 8 words + "email"; row 2: 15 words; row 7: "" + "phone"; row 9: 4 words + "chat" + the nested "HC-2077".
  input_words: { items: [R[1], R[2], R[7], R[9], { index: 99 }], values: [9, 15, 1, 6, null] },
  // Row 1: text and channel, one line each; row 7: "" (none) and "phone".
  input_lines: { items: [R[1], R[7], R[2], { row: "a\nb\r\nc" }, { index: 99 }], values: [2, 1, 1, 3, null] },
  input_fields: { items: [R[1], R[2], R[4], R[9]], values: [2, null, 2, 3] },
  copies: { items: [R[4], R[5], R[1]], values: [2, 2, 1], ctx: ctx() },
  draft_share: { items: [R[1], R[2], R[4], R[5], R[6]], values: [1, 1 / 3, 0, 0.5, 1], tolerance: 1e-12 },
  // urgent and topic have guidelines, tone none. Row 1 has no blank; row 2 urgent (+ tone); row 9 topic.
  guided_blank: { items: [R[1], R[2], R[9], R[6]], values: [0, 1, 1, 0], ctx: ctx() },
  nested_input: { items: [R[9], R[1], R[2]], values: [true, false, false] },
  contact_details: { items: [R[2], R[1], R[9]], values: [true, false, false] },
  example_match: { items: [E[4], E[5], E[9], E[1], E[2]], values: [true, true, true, false, false], ctx: G },
  // Row 4 drafted shipping, row 5 billing for the same input; row 9 and row 1 have no copy.
  copy_draft_conflict: { items: [D[4], D[5], D[9], D[1]], values: [true, true, false, false], ctx: conflicting },
  copy_rows: { items: [R[4], R[5], R[1]], values: ["5", "4", ""], ctx: ctx() },
  drafted_questions: { items: [R[1], R[2], R[4], R[9]], values: ["urgent, topic, tone", "topic", "none", "urgent"] },
  missing_types: { items: [R[1], R[6], R[9], R[7]], values: ["choice + noul + score", "score", "choice + noul", "noul"] },

  example_label_conflict: { ctx: G, hit: E[9], miss: [E[5], E[4], E[1]],
    message: /^Row 9: the urgent guideline has an example with this input labeled yes, but your draft is no\.$/ },
  example_input_blank: { ctx: G, hit: E[4], miss: [E[5], E[9], E[1]], message: /^Row 4: the guideline for topic has an example with this input\.$/ },

  // Blank labels: row 2 urgent, tone; row 4 topic, tone; row 5 tone; row 7 urgent; row 9 topic. 4 of the 7 are urgent or topic.
  guided_blank_share: [{ ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 4 / 7); assert.equal(result.detail, "4 of 7 blank labels"); } },
    { ctx: ctx({ guidelines: null }), expect: null }],
  // 9 + 15 + 6 + 6 + 6 + 1 + 6 = 49 words over 7 rows.
  mean_input_words: { ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 7); assert.equal(result.detail, "49 words over 7 rows"); } },
  example_rows: [{ ctx: G, empty: empty(), expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "1 with a different draft"); } },
    { ctx: ctx(), expect: 0 }],

  // Rows 4 and 5 are the one repeated input; they differ only once row 4 drafts shipping.
  copy_conflict_groups: [{ ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "of 1 repeated input"); } },
    { ctx: conflicting, expect: 1 }],
  worksheet_md: { ctx: ctx({ slice: "chat" }), filename: "labeling-worksheet.md",
    text: [
      "# Labeling worksheet", "", "3 rows · inputs and blank options only, no drafts. Pictures by name.", "",
      "## Row 4", "> text: Charged twice for my subscription · channel: chat", "> picture: receipt-scan",
      "- topic: [ ] billing  [ ] shipping  [ ] wholesale  [ ] beans", "- tone: [ ] 0 (Upset)  [ ] 1 (Neutral)  [ ] 2 (Happy)", "",
      "## Row 5", "> text: Charged twice for my subscription · channel: chat", "> picture: receipt-scan",
      "- topic: [ ] billing  [ ] shipping  [ ] wholesale  [ ] beans", "- tone: [ ] 0 (Upset)  [ ] 1 (Neutral)  [ ] 2 (Happy)", "",
      "## Row 9", '> text: Where is my order? · channel: chat · order: {"id":"HC-2077","items":2}',
      "- urgent: [ ] yes  [ ] no", "- topic: [ ] billing  [ ] shipping  [ ] wholesale  [ ] beans", ""].join("\n") },
  // Characters: 41 + 5; 92; 33 + 4; 27 + 5; 0 + 5; 18 + 4 + 7.
  input_shape_csv: { ctx: ctx(), filename: "labeling-input-shape.csv",
    text: '"row","shape","fields","words","characters","picture","copies","missing"\r\n'
      + '"1","object","2","9","46","","1","3"\r\n'
      + '"2","text","","15","92","","1","3"\r\n'
      + '"4","object","2","6","37","receipt-scan","2","2"\r\n'
      + '"5","object","2","6","37","receipt-scan","2","2"\r\n'
      + '"6","object","2","6","32","latte-photo","1","1"\r\n'
      + '"7","object","2","1","5","","1","1"\r\n'
      + '"9","object","3","6","29","","1","2"\r\n',
    excludes: ["Charged", "billing", "shipping"] },

  go_first_example_conflict: { ctx: withExamples, check: (c) => assert.deepEqual(c.log.at(-1), ["goTo", 8]), hidden: () => ctx() },
  go_first_copy_conflict: { ctx: () => ctx({ drafts: { ...sampleLabelingDrafts(), 3: { topic: "shipping" } } }), check: (c) => assert.deepEqual(c.log.at(-1), ["goTo", 3]), hidden: () => ctx() },
}, { ctx: withExamples });
