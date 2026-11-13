// More question facts and checks on workbench.build.questions. Expected values are worked out by hand from the rows
// written here and from the fixture (tests/js/lab/fixtures/workbench-build.mjs): seven cards intent, urgency, angry,
// mug_box, " refund_amount_ok " (structured instructions), a blank card and tone. Byte and character totals are
// counted independently with Buffer.byteLength and String length on the same literal strings.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/build-question-facts.js";
import { checkPack } from "./harness.mjs";
import { BUILD_STATE_TEXT, buildResult, buildRows, sampleBuildQuestionsCtx } from "./fixtures/workbench-build.mjs";

const ctx = sampleBuildQuestionsCtx();
const items = ctx.items();
const blank = { choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" };
const row = (fields) => ({ id: "", type: "noul", instructions: "", ...blank, ...fields });
const cardsOf = (rows, overrides = {}) => {
  const made = sampleBuildQuestionsCtx({ rows, expect: {}, hide: [], ...overrides });
  return { ctx: made, items: made.items() };
};

// authored_bytes: UTF-8 bytes of trimmed id + instructions + active criteria (Choice keys too), counted with Buffer.
const b = (...texts) => texts.reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
const authoredBytes = [
  b("intent", "What does the customer in `ticket.body` want?", "refund", "Wants money back", "where_is_order", "Asks where an order is", "other", ""),
  b("urgency", "How urgent is `ticket.body`?", "Not urgent", "Soon", "Right now"),
  b("angry", "Is the customer in `ticket.body` angry?", "Uses angry or threatening words"),
  b("mug_box", "The coffee mug in `photo`."),
  b("refund_amount_ok", "{\"ask\": \"Does `order_total` match the refund asked for?\"}"),
  0,
  b("tone", "What is the tone of `ticket.subject`?", "calm", "Calm and polite", "upset", "Upset"),
];
const nonAscii = cardsOf([row({ id: "café", instructions: "Is “it” late?", noulYes: "Ja – late" }), row({ id: "x", instructions: "Hi" })]);

const wordingCards = cardsOf([
  row({ id: "late", instructions: "Is the order late?" }),
  row({ id: "parcel", instructions: "Is the parcel late?" }),
  row({ id: "paid", instructions: "Who paid?" }),
  row({ id: "shaped", instructions: "{\"ask\": \"Is the order late?\"}" }),
  row({ id: "empty", instructions: "" }),
]);

const criteriaCards = cardsOf([
  row({ id: "a", type: "choice", choice: [["refund", "Wants money back"], ["refund_today", "Wants the money back today"], ["where", "Asks where an order is"]] }),
  row({ id: "b", type: "score", score: ["Low", "Low or medium", "High"] }),
  row({ id: "c", noulYes: "Angry words" }),
  row({ id: "d", type: "choice", choice: [["x", "Coffee beans"], ["y", "Paper cups"]] }),
]);

// State paths against the fixture state: ticket { subject, body, customer, lines: [{ sku, qty }] }, order_total, photo.
const state = JSON.parse(BUILD_STATE_TEXT);
const pathCards = cardsOf([
  row({ id: "p1", instructions: "Compare `ticket.body` with `ticket.subject`, then `ticket.body` again and `ticket.subjekt`." }),
  row({ id: "p2", type: "choice", instructions: "Which `ticket.lines[0].sku` in `photo`?", choice: [["a", "Like `order_total`"], ["b", ""]] }),
  row({ id: "p3", instructions: "No paths here, just `not a path`." }),
  row({ id: "p4", instructions: "Read `ticket` and `ticket.subject`." }),
  row({ id: "p5", instructions: "Is there a mug in `photo`?" }),
  row({ id: "p6", instructions: "Is `order_total` high?" }),
]);
const { subject, body, customer } = state.ticket;
const sku = state.ticket.lines[0].sku;

// The latest Run, changed after the fact: intent lost an option, urgency's level 1 text, angry's type.
const changedRun = () => {
  const result = buildResult();
  result.answers.intent.probabilities = { refund: 0.9, where_is_order: 0.1 };
  result.answers.urgency.legend = { 0: "Not urgent", 1: "Later", 2: "Right now" };
  result.answers.angry = { type: "choice", choice: "yes", probabilities: { yes: 0.6, no: 0.4 }, confidence: 0.6 };
  delete result.answers.refund_amount_ok;
  return sampleBuildQuestionsCtx({ result });
};
const runCtx = changedRun();
const box = { left: 0.2, top: 0.3, right: 0.6, bottom: 0.8 };

checkPack(pack, {
  position: { items, values: [1, 2, 3, 4, 5, 6, 7], ctx },
  authored_bytes: { items, values: authoredBytes, ctx },
  closest_wording: { ...wordingCards, values: [0.6, 0.6, 0, null, null] },  // {is,the,order,late} vs {is,the,parcel,late}: 3 of 5
  numbers_in_wording: {
    items: [{ instructions: "Is the total over 40 or under 12.5 for `frames[2]`?" }, { instructions: "No numbers here." }, { instructions: "{\"limit\": 40}" }],
    values: [2, 0, null] },
  opening_word: {
    items: [{ instructions: "Is the order late?" }, { instructions: "What does `ticket.body` want?" }, { instructions: "`ticket.body`: angry?" },
      { instructions: "{\"ask\": \"x\"}" }, { instructions: "  " }, { instructions: "¿Qué pasa?" }],
    values: ["is", "what", "ticket.body", null, null, "qué"] },
  negative_wording: {
    items: [{ instructions: "Is the order not paid?" }, { instructions: "Answer yes or no: is it paid?" }, { instructions: "Isn't it paid?" },
      { instructions: "Does the note say \"not paid\"?" }, { instructions: "{\"ask\": \"Is it not paid?\"}" }, { instructions: "Is it paid without a receipt?" }],
    values: [true, false, true, false, false, true] },

  // intent 16 (Wants money back) / 22 (Asks where an order is); urgency 4 (Soon) / 10 (Not urgent); angry 31; tone 5 / 15.
  shortest_criterion: { items, values: [16, 4, 31, null, null, null, 5], ctx },
  criterion_length_ratio: { items, values: [22 / 16, 10 / 4, null, null, null, null, 15 / 5], ctx },
  // a: {wants,money,back} vs {wants,the,money,back,today} = 3/5; b: {low} vs {low,or,medium} = 1/3; d: disjoint.
  closest_criteria: { ...criteriaCards, values: [0.6, 1 / 3, null, 0] },

  named_fields: { ...pathCards, values: [2, 3, 0, 2, 1, 1] },
  named_text_chars: { ...pathCards, values: [body.length + subject.length, sku.length, 0, subject.length + body.length + customer.length + sku.length, 0, 0] },
  named_value_kind: { ...pathCards, values: ["text", "mixed", null, "mixed", "picture", "number"] },

  expected_min: {
    items: [{ type: "noul", expectation: { min: 0.7 } }, { type: "score", score: ["L", "M", "H"], expectation: { min: 1, max: 2 } },
      { type: "choice", expectation: { choice: "refund" } }, { type: "box", expectation: { min: 0.3 } }, { type: "noul", expectation: null }],
    values: [0.7, 1, null, null, null] },
  expected_max: {
    items: [{ type: "noul", expectation: { min: 0.7 } }, { type: "score", score: ["L", "M", "H"], expectation: { min: 1, max: 2 } },
      { type: "noul", expectation: { max: 0.5 } }],
    values: [null, 2, 0.5] },
  expected_share: {
    items: [{ type: "noul", expectation: { min: 0.7 } }, { type: "score", score: ["L", "M", "H"], expectation: { min: 1, max: 2 } },
      { type: "choice", expectation: { choice: "refund", min: 0.8, max: 0.2 } }, { type: "score", score: ["a", "b", "c", "d"], expectation: { max: 0.75 } },
      { type: "choice", expectation: { choice: "refund" } }, { type: "noul", expectation: { min: -0.5, max: 0.5 } }],
    values: [0.3, 0.5, 0, 0.25, null, 0.5] },  // (1-0.7)/1; (2-1)/2; empty; (0.75-0)/3; no bound; (0.5-0)/1
  expectation_text: {
    items: [{ expectation: { choice: "refund" } }, { expectation: { choice: "refund", min: 0.7 } }, { expectation: { min: 0.5, max: 1.5 } },
      { expectation: { max: 0.5 } }, { expectation: { box, iou_min: 0.6 } }, { expectation: { box } }, { expectation: null }],
    values: ["= refund", "= refund, p ≥ 0.7", "0.5 to 1.5", "≤ 0.5", "box 0.2, 0.3, 0.6, 0.8, IoU ≥ 0.6", "box 0.2, 0.3, 0.6, 0.8, IoU ≥ 0.5", null] },

  run_shape: { items: runCtx.items(), ctx: runCtx,
    values: ["options changed", "levels changed", "type changed", "unchanged shape", "not in your latest run", "not in your latest run", "unchanged shape"] },

  expected_option_missing: {
    hit: { type: "choice", choice: [["refund", "x"], ["other", ""]], expectation: { choice: "cancel" } },
    miss: [{ type: "choice", choice: [["refund", "x"], ["other", ""]], expectation: { choice: "refund" } }, { type: "noul", expectation: { choice: "cancel" } }],
    message: /wants “cancel”/ },
  expectation_never_passes: {
    hit: [{ type: "noul", expectation: { min: 0.8, max: 0.2 } }, { type: "score", score: ["L", "M", "H"], expectation: { min: 3 } },
      { type: "noul", expectation: { max: -0.1 } }, { type: "box", expectation: { box, iou_min: 1.2 } },
      { type: "box", expectation: { box: { left: 0.6, top: 0.3, right: 0.2, bottom: 0.8 } } }],
    miss: [{ type: "noul", expectation: { min: 0.2, max: 0.8 } }, { type: "score", score: ["L", "M", "H"], expectation: { min: 2 } },
      { type: "box", expectation: { box, iou_min: 0.5 } }, { type: "choice", expectation: { choice: "refund" } },
      { type: "box", expectation: { box: { left: 0.6, top: 0.3, right: 0.2, bottom: 0.8 }, iou_min: 0 } }, { type: "noul", expectation: null }],
    message: /minimum|maximum|IoU|no area/ },
  expectation_ignored_parts: {
    hit: [{ type: "score", score: ["L", "H"], expectation: { choice: "x", min: 1 } }, { type: "box", expectation: { box, min: 0.2 } },
      { type: "noul", expectation: { iou_min: 0.5 } }],
    miss: [{ type: "choice", expectation: { choice: "x", min: 0.5 } }, { type: "box", expectation: { box, iou_min: 0.5 } },
      { type: "noul", expectation: { min: 0.5 } }, { type: "noul", expectation: null }],
    message: /does not check/ },
  blank_level_gap: {
    hit: [{ type: "score", score: ["Not urgent", "Soon", "", "Right now"] }, { type: "score", score: ["", "Low", "High"] }],
    miss: [{ type: "score", score: ["Low", "High", "", ""] }, { type: "score", score: ["", "", ""] }, { type: "choice", score: ["", "a"] }],
    message: /“(Right now|Low)”, typed as level (3|1), is sent as level (2|0)\./ },
  leftover_placeholder: {
    hit: [{ type: "noul", instructions: "Is {customer_name} angry?" }, { type: "choice", instructions: "Pick", choice: [["a", "About [ORDER ID]"]] }],
    miss: [{ type: "noul", instructions: "Is `ticket.body` angry?" }, { type: "noul", instructions: "{\"ask\": \"{x}\"}" },
      { type: "noul", instructions: "Is `{{ name }}` set?" }],
    message: /never filled in/ },
  contact_in_wording: {
    hit: [{ type: "noul", instructions: "Did maya@customers.example reply?" }, { type: "choice", instructions: "Which?", choice: [["a", "See https://harbor.example/faq"]] }],
    miss: { type: "noul", instructions: "Is the customer angry?" },
    message: /names (maya@customers\.example|https:\/\/harbor\.example\/faq)\./ },
  box_picture_ambiguous: { ctx,
    hit: { type: "box", qid: "spot", instructions: "The mug on the counter." },
    miss: [{ type: "box", qid: "mug_box", instructions: "The coffee mug in `photo`." }, { type: "box", qid: "b", instructions: "Mug in photo-99ffee0011." },
      { type: "noul", qid: "x", instructions: "Mug?" }, { type: "box", qid: "", instructions: "Mug." }],
    message: /^2 pictures are attached/ },
  unreferenced_picture: { ctx, hitList: items, missList: items, missCtx: sampleBuildQuestionsCtx({ images: [{ ref: "photo-0a1b2c3d4e", sample: "mug" }] }),
    message: /^Picture photo-99ffee0011 \(counter\.jpg\) is not named/ },
  json_like_instructions: {
    hit: [{ instructions: "{ask: 'late?'}" }, { instructions: "  [1, 2" }],
    miss: [{ instructions: "{\"ask\": \"late?\"}" }, { instructions: "Is it late?" }, { instructions: "" }],
    message: /sent as plain text/ },
  single_option: {
    hit: { type: "choice", qid: "pick", choice: [["refund", "x"], ["", ""]] },
    miss: [{ type: "choice", qid: "pick", choice: [["refund", "x"], ["other", ""]] }, { type: "choice", qid: "", choice: [["refund", "x"]] },
      { type: "noul", qid: "x", noulYes: "y" }],
    message: /Only “refund” is named/ },
  key_inner_space: {
    hit: { type: "choice", choice: [["where is order", "x"], ["refund", ""]] },
    miss: [{ type: "choice", choice: [[" refund ", "x"]] }, { type: "noul", noulYes: "a b" }],
    message: /^“where is order” has a space/ },
  near_ids: {
    hitList: [{ qid: "intent" }, { qid: "intents" }, { qid: "tone" }],
    missList: [{ qid: "intent" }, { qid: "Intent" }, { qid: "tone" }, { qid: "" }],
    message: /^intent and intents are one character apart/ },
}, { ctx: () => sampleBuildQuestionsCtx() });

test("build-question-facts: byte counts follow UTF-8, not string length", () => {
  const fact = pack.features.find((feature) => feature.id === "authored_bytes");
  // "café" 5 bytes, "Is “it” late?" 17 bytes (two 3-byte quotes), "Ja – late" 11 bytes (a 3-byte dash).
  assert.deepEqual(nonAscii.items.map((item) => fact.value(item, nonAscii.ctx)), [5 + 17 + 11, 1 + 2]);
});

test("build-question-facts: run shape is unavailable before a Run", () => {
  const fact = pack.features.find((feature) => feature.id === "run_shape");
  const none = sampleBuildQuestionsCtx({ result: null });
  assert.deepEqual(none.items().map((item) => fact.value(item, none)), buildRows().map(() => null));
});

test("build-question-facts: state facts are unavailable for a plain-text state", () => {
  const text = sampleBuildQuestionsCtx({ stateText: "Charged twice for my beans" });
  for (const id of ["named_fields", "named_text_chars", "named_value_kind"]) {
    const fact = pack.features.find((feature) => feature.id === id);
    assert.deepEqual(text.items().map((item) => fact.value(item, text)), buildRows().map(() => null), id);
  }
});
