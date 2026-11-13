// Starter pack on workbench.build.questions. Expected values are worked out by hand from the fixture
// (tests/js/lab/fixtures/workbench-build.mjs): seven cards intent, urgency, angry, mug_box, " refund_amount_ok "
// (structured instructions), a blank card and tone (hidden by a page filter).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/wb-build-question-insights.js";
import { applyTransform, previewTransform, runExporter, undoTransform } from "../../../static/js/lab/kit.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { buildExpect, buildResult, sampleBuildQuestionsCtx } from "./fixtures/workbench-build.mjs";

const ctx = sampleBuildQuestionsCtx();
const items = ctx.items();
const box = { left: 0.2, top: 0.3, right: 0.6, bottom: 0.8 };

const partlyAnswered = () => {
  const result = buildResult();
  for (const id of ["mug_box", "refund_amount_ok", "tone"]) delete result.answers[id];
  return sampleBuildQuestionsCtx({ result });
};

checkPack(pack, {
  references: { items, values: [1, 1, 1, 1, 1, 0, 1], ctx },
  instruction_sentences: { items: [...items, { instructions: "Is it late? Say so. Then stop!" }, { instructions: "Pi is 3.14 here." }],
    values: [1, 1, 1, 1, null, 0, 1, 3, 1], ctx },
  // Characters of the longest active description: "Asks where an order is" 22, "Not urgent" 10,
  // "Uses angry or threatening words" 31, "Calm and polite" 15; Box, criteria-less Noul and blank card none.
  longest_criterion: { items: [...items, { criteria: undefined }], values: [22, 10, 31, null, null, null, 15, null], ctx },
  question_mark: { items: [...items, { instructions: "Is it late?  " }, { instructions: undefined }],
    values: [true, true, true, false, false, false, true, true, false], ctx },
  id_style: { items: [{ qid: "intent" }, { qid: "mug_box" }, { qid: "orderStatus" }, { qid: "order-status" }, { qid: "Order Status" }, { qid: "" }],
    values: ["single word", "snake_case", "camelCase", "kebab-case", "other", null] },
  answer_confidence: { items, values: [0.82, 0.45, null, 0.71, null, null, 0.52], ctx },
  expectation_kind: { items: [{ expectation: { choice: "refund" } }, { expectation: { min: 0.2, max: 0.6 } }, { expectation: { min: 0.5 } },
    { expectation: { max: 0.5 } }, { expectation: { box, iou_min: 0.5 } }, { expectation: null }],
  values: ["choice", "range", "minimum", "maximum", "box", null] },
  uses_picture: { items: [...items, { instructions: "Is photo-99ffee0011 blurry?" }], values: [false, false, false, true, false, false, false, true], ctx },
  check_findings: { items, values: [1, 0, 1, 0, 0, null, 1], ctx },

  choice_without_options: { hit: { qid: "pick", type: "choice", criteria: [] }, miss: [{ qid: "intent", type: "choice", criteria: [{ key: "other", text: "" }] },
    { qid: "", type: "choice", criteria: [] }], message: /needs at least one option/ },
  score_too_few_levels: { hit: { qid: "urgency", type: "score", criteria: [{ key: "0", text: "Low" }] },
    miss: [{ qid: "urgency", type: "score", criteria: [{ key: "0", text: "Low" }, { key: "1", text: "High" }] }, { qid: "", type: "score", criteria: [] }], message: /it has 1\./ },
  box_without_picture: { hit: { qid: "mug_box", type: "box" }, miss: [{ qid: "angry", type: "noul" }, { qid: "", type: "box" }],
    ctx: sampleBuildQuestionsCtx({ images: [] }), message: /needs an attached picture/ },
  empty_instructions: { hit: { qid: "angry", instructions: "" }, miss: [{ qid: "angry", instructions: "  " }, { qid: "", instructions: "" }], message: /needs instructions/ },
  id_inner_space: { hit: { qid: "order status" }, miss: [{ qid: "order_status" }, { qid: "" }] },
  blank_id: { hit: { qid: "", position: 6 }, miss: { qid: "intent", position: 1 }, message: /skip it/ },
  ids_differ_by_case: { hitList: [{ qid: "Intent" }, { qid: "intent" }, { qid: "tone" }], missList: [{ qid: "intent" }, { qid: "tone" }, { qid: "" }],
    message: /^Intent, intent differ only by case/ },

  snake_case_ids: {
    // An orphan expectation waits for "old_question" (renamed by typing); "Keep Me" owns one and carries it along.
    ctx: fakeCtx({ data: { expect: { old_question: { min: 0.2 }, "Keep Me": { max: 0.5 } } } }),
    input: [{ ref: "q1", id: "orderStatus" }, { ref: "q2", id: "" }, { ref: "q3", id: "tone" }, { ref: "q4", id: " Mixed Case " },
      { ref: "q5", id: "Keep Me", expectation: { max: 0.5 } }],
    output: [{ ref: "q1", id: "order_status" }, { ref: "q2", id: "" }, { ref: "q3", id: "tone" }, { ref: "q4", id: "mixed_case" },
      { ref: "q5", id: "keep_me", expectation: { max: 0.5 } }],
    unchanged: [{ ref: "q1", id: "intent" }, { ref: "q2", id: " padded " }],
    rejects: [{ input: [{ id: "orderStatus" }, { id: "order_status" }], message: /Two questions would have the id “order_status”/ },
      { input: [{ id: "oldQuestion" }], message: /Expectations already exist for “old_question”/ }],
  },
  prefix_ids: {
    ctx: fakeCtx({ data: { expect: { old_question: { min: 0.2 } } } }),
    params: { prefix: "support_" },
    input: [{ id: "intent" }, { id: "support_tone" }, { id: "" }, { id: " angry " }],
    output: [{ id: "support_intent" }, { id: "support_tone" }, { id: "" }, { id: "support_angry" }],
    rejects: [{ params: { prefix: "a b" }, message: /cannot contain spaces/ }, { params: { prefix: "" }, message: /Prefix is required/ },
      { input: [{ id: "x" }, { id: "p_x" }], params: { prefix: "p_" }, message: /Two questions/ },
      { input: [{ id: "question" }], params: { prefix: "old_" }, message: /Expectations already exist for “old_question”/ }],
  },
  collapse_inner_spaces: {
    input: [{ instructions: "Is  the   order late?" }, { instructions: "  Keep\tindent\n  and  this" }, { instructions: "{\"a\":  \"b  c\"}" }],
    output: [{ instructions: "Is the order late?" }, { instructions: "  Keep\tindent\n  and this" }, { instructions: "{\"a\":  \"b  c\"}" }],
    unchanged: [{ instructions: "One space only." }, { instructions: "[1,   2]" }],
  },

  expectation_share: [{ ctx, expect: 0.5, empty: sampleBuildQuestionsCtx({ rows: [] }) },
    { ctx: sampleBuildQuestionsCtx({ expect: {} }), expect: 0 }],
  // Six cards have an id; the blank card is left out of both shares.
  answered_share: [{ ctx, expect: 1, empty: sampleBuildQuestionsCtx({ result: null }) },
    { ctx: partlyAnswered(), expect: 0.5 }, { ctx: sampleBuildQuestionsCtx({ rows: [] }), expect: null }],

  questions_jsonl: { ctx: sampleBuildQuestionsCtx({ hide: ["tone", 6] }), filename: "jev-questions.jsonl",
    text: [
      "{\"id\":\"intent\",\"type\":\"choice\",\"instructions\":\"What does the customer in `ticket.body` want?\",\"criteria\":{\"refund\":\"Wants money back\",\"where_is_order\":\"Asks where an order is\",\"other\":null}}",
      "{\"id\":\"urgency\",\"type\":\"score\",\"instructions\":\"How urgent is `ticket.body`?\",\"criteria\":[\"Not urgent\",\"Soon\",\"Right now\"]}",
      "{\"id\":\"angry\",\"type\":\"noul\",\"instructions\":\"Is the customer in `ticket.body` angry?\",\"criteria\":{\"true\":\"Uses angry or threatening words\",\"false\":null}}",
      "{\"id\":\"mug_box\",\"type\":\"box\",\"instructions\":\"The coffee mug in `photo`.\"}",
      "{\"id\":\"refund_amount_ok\",\"type\":\"noul\",\"instructions\":{\"ask\":\"Does `order_total` match the refund asked for?\"}}",
    ].join("\n") + "\n",
    excludes: ["maya@customers.example", "photo-0a1b2c3d4e", "0.82", "\"choice\":\"refund\"", "max"] },

  questions_map: {
    ctx,
    text: JSON.stringify({
      refund_reason: { type: "choice", instructions: "Why does `ticket.body` ask for a refund?", criteria: { double_charge: "Charged twice", damaged: null } },
      size: { type: "score", instructions: "How big is the order?", criteria: ["Small", "Large"] },
      complete: { type: "noul", instructions: "Is the order complete?", criteria: { true: "Every line shipped" } },
      intent: { type: "box", instructions: "The mug" },
    }),
    items: [
      { id: "refund_reason", type: "choice", instructions: "Why does `ticket.body` ask for a refund?", choice: [["double_charge", "Charged twice"], ["damaged", ""]],
        score: ["", "", ""], noulYes: "", noulNo: "" },
      { id: "size", type: "score", instructions: "How big is the order?", choice: [["", ""], ["", ""]], score: ["Small", "Large"], noulYes: "", noulNo: "" },
      { id: "complete", type: "noul", instructions: "Is the order complete?", choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "Every line shipped", noulNo: "" },
      { id: "intent", type: "box", instructions: "The mug", choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" },
    ],
    warnings: 1,
    rejects: ["{\"a\": {\"type\": \"noul\"}, \"a\": {\"type\": \"box\"}}", "[1, 2]", "not json", "{\"a\": {\"type\": \"rank\"}}", "{}"],
  },

  check_questions: { ctx: () => sampleBuildQuestionsCtx(), check: (c) => assert.deepEqual(c.log, [["checkQuestions"]]),
    hidden: () => sampleBuildQuestionsCtx({ rawPending: true }) },
  first_shown: { ctx: () => sampleBuildQuestionsCtx({ hide: ["intent", "tone"] }), check: (c) => assert.deepEqual(c.log, [["focus", 1]]),
    hidden: () => sampleBuildQuestionsCtx({ hide: ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "tone", 6] }) },
  export_code: { ctx: () => sampleBuildQuestionsCtx(), check: (c) => assert.deepEqual(c.log, [["exportCode"]]),
    hidden: () => sampleBuildQuestionsCtx({ rows: [] }) },
}, { ctx: () => sampleBuildQuestionsCtx() });

test("question handoffs refuse pending Raw JSON and an empty shown set instead of falling back to every question", () => {
  const exporter = (id) => pack.features.find((feature) => feature.id === id);
  for (const id of ["questions_jsonl"]) {
    assert.throws(() => runExporter(exporter(id), sampleBuildQuestionsCtx({ rawPending: true })), /Apply the Raw JSON edits/);
    assert.throws(() => runExporter(exporter(id), sampleBuildQuestionsCtx({ hide: [1, 2, 3, 4, 5, 6, 7] })), /No questions are shown/);
  }
  assert.throws(() => runExporter(exporter("questions_jsonl"), sampleBuildQuestionsCtx()), /Give every shown question an id/);
});

test("an id edit applied through the surface keeps expectations attached", () => {
  const c = sampleBuildQuestionsCtx();
  const feature = pack.features.find((entry) => entry.id === "prefix_ids");
  const preview = previewTransform("wb-build-question-insights/prefix_ids", feature, c.items(), new Set([0, 2]), { prefix: "hc_" }, c);
  const applied = applyTransform(preview, c.items());
  c.actions.replaceItems(applied.items, { label: feature.label });
  assert.deepEqual(c.page.rows.map((row) => row.id), ["hc_intent", "urgency", "hc_angry", "mug_box", " refund_amount_ok ", "", "tone"]);
  assert.deepEqual(Object.keys(c.page.expect).sort(), ["hc_angry", "hc_intent", "mug_box", "old_question"]);
  // Lab's one-step Undo: the edited list reads back exactly as previewed, so Undo restores ids and expectations.
  c.actions.replaceItems(undoTransform(applied.undo, c.items()), { label: "Undo" });
  assert.deepEqual(c.page.rows.map((row) => row.id), ["intent", "urgency", "angry", "mug_box", " refund_amount_ok ", "", "tone"]);
  assert.deepEqual(c.page.expect, buildExpect());
});

test("the latest answer confidence goes blank while the answers are outdated", () => {
  const fact = pack.features.find((feature) => feature.id === "answer_confidence");
  const stale = sampleBuildQuestionsCtx({ stale: true });
  assert.deepEqual(stale.items().map((item) => fact.value(item, stale)), [null, null, null, null, null, null, null]);
});

test("the questions map importer warns about an id whose expectation waits for a renamed question", () => {
  const importer = pack.features.find((feature) => feature.id === "questions_map");
  const out = importer.parse(JSON.stringify({ old_question: { type: "noul", instructions: "Is it old?" } }), sampleBuildQuestionsCtx());
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.warnings, ["“old_question” has human expectations waiting for a renamed question; rename the import before adding."]);
});

test("snake_case ids applied through the surface: an orphan expectation blocks the preview, not Apply", () => {
  const c = sampleBuildQuestionsCtx({ rows: [...sampleBuildQuestionsCtx().page.rows, { id: "oldQuestion", type: "noul", instructions: "Old?", choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" }] });
  const feature = pack.features.find((entry) => entry.id === "snake_case_ids");
  assert.throws(() => previewTransform("wb-build-question-insights/snake_case_ids", feature, c.items(), new Set([7]), {}, c), /Expectations already exist for “old_question”/);
  // Without that card, " refund_amount_ok " is already snake_case once trimmed, so nothing would change.
  const plain = sampleBuildQuestionsCtx();
  const preview = previewTransform("wb-build-question-insights/snake_case_ids", feature, plain.items(), new Set([0, 1, 2, 3, 4, 5]), {}, plain);
  assert.deepEqual(preview.changed, []);
});

test("the JSON Lines handoff sends structured criteria as structure, as Run does", () => {
  const rows = [{ id: "size", type: "score", instructions: "How big?", choice: [["", ""], ["", ""]], score: ["{\"label\": \"small\"}", "Large"], noulYes: "", noulNo: "" },
    { id: "kind", type: "choice", instructions: "Which?", choice: [["a", " [1, 2] "], ["b", ""]], score: ["", "", ""], noulYes: "", noulNo: "" }];
  const out = runExporter(pack.features.find((feature) => feature.id === "questions_jsonl"), sampleBuildQuestionsCtx({ rows, hide: [] }));
  assert.equal(out.text, '{"id":"size","type":"score","instructions":"How big?","criteria":[{"label":"small"},"Large"]}\n'
    + '{"id":"kind","type":"choice","instructions":"Which?","criteria":{"a":[1,2],"b":null}}\n');
});
