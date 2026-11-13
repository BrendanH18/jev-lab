// Tests of the examples-more pack, on the fixture gallery of tests/js/lab/fixtures/workbench-shell.mjs (order:
// order-triage, wholesale-lead, bag-photo, review-batch, late-delivery, blank-draft, crate-locate). Expected values
// were counted by hand from the fixture's authored text; the instruction and criterion lengths, average words, state
// bytes (UTF-8 of the text, or of compact JSON) and their medians were checked with a separate Python script.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/examples-more.js";
import { checkPack } from "./harness.mjs";
import { runDiagnostics } from "../../../static/js/lab/kit.js";
import { sampleExamples, sampleExamplesCtx } from "./fixtures/workbench-shell.mjs";

const items = sampleExamplesCtx().items();
const [order, lead, bag, review, late, blank, crate] = items;
const only = (id) => sampleExamplesCtx({ view: { searchScope: "id", query: id } });
const empty = () => sampleExamplesCtx({ examples: [] });
// Items in the surface's own shape, built by the real builder from raw authored examples.
const build = (...raws) => sampleExamplesCtx({ examples: raws }).items();
const one = (id, questions, extra = {}) => build({ id, title: id, state: "Order 1042 arrived late.", questions, ...extra })[0];

const [fallbackItem] = build({ id: "fallback", title: "Fallback", state: "x",
  questions: { reason: { type: "choice", instructions: "Why?", criteria: { refund: "Refund", n_a: "N/A" } } } });
const manyOptions = (count) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`o${index}`, `Option ${index}`]));
const manyLevels = (count) => Array.from({ length: count }, (_, index) => `Level ${index}`);
const manyQuestions = (count) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`q${index}`, { type: "noul", instructions: "Late?" }]));
const raws = sampleExamples();
const [leadCopy] = build({ ...raws[1], id: "lead-copy", state: { message: raws[1].state.message, email: raws[1].state.email, company: raws[1].state.company } });
const [blankCopy] = build({ id: "blank-copy", title: "Another blank", state: "  ", questions: {} });
// One question but two expectation keys (one for a question that is gone): the share is capped at 1.
const [overExpected] = build({ id: "over", title: "Over", state: "x", questions: { a: { type: "noul", instructions: "Late?" } }, expect: { a: { min: 0.5 }, gone: { min: 0.5 } } });
const feature = (id) => pack.features.find((entry) => entry.id === id);

checkPack(pack, {
  choice_count: { items, values: [1, 1, 0, 0, 1, 0, 0] },
  box_count: { items, values: [0, 0, 1, 0, 0, 0, 1] },
  shortest_instruction: { items, values: [37, 45, 35, 52, 25, null, 22] },
  mean_instruction_words: { items, values: [7, 9, 7.5, 7, 6, null, 5] },
  longest_criterion: { items, values: [28, 26, null, 8, 17, null, 5] },
  state_depth: { items, values: [0, 1, 1, 2, 1, 0, 1] },
  backticked_names: { items, values: [0, 2, 1, 0, 1, 0, 1] },
  // expectation_count / question_count: order-triage 2 of 3, bag-photo 1 of 2, late-delivery 1 of 3.
  expectation_share: { items: [...items, overExpected], values: [2 / 3, 0, 0.5, 0, 1 / 3, null, 0, 1] },
  // review-batch's instruction is JSON text; blank-draft has no question; Box instructions are left out.
  question_marks: { items, values: [true, true, true, false, true, false, true] },
  picture_in_state: { items, values: [false, false, true, false, false, false, false] },
  fallback_option: { items: [...items, fallbackItem], values: [false, true, false, false, false, false, false, true] },

  empty_instructions: {
    hit: [one("blank-instructions", { a: { type: "noul", instructions: "   " } }), one("no-instructions", { a: { type: "noul" } })],
    miss: items, message: /^a has no instructions\.$/,
  },
  unknown_type: {
    hit: [one("rank", { q: { type: "rank", instructions: "Rank it?" } }), one("untyped", { q: { instructions: "Late?" } })],
    miss: [order, bag, crate, blank], message: /^q has (type "rank"|no type); the server accepts choice, noul, score or box\.$/,
  },
  over_limits: {
    hit: [one("options", { pick: { type: "choice", instructions: "Pick?", criteria: manyOptions(256) } }),
      one("levels", { rate: { type: "score", instructions: "Rate?", criteria: manyLevels(26) } }),
      one("questions", manyQuestions(101))],
    miss: [order, lead, one("at-limits", { pick: { type: "choice", instructions: "Pick?", criteria: manyOptions(255) },
      rate: { type: "score", instructions: "Rate?", criteria: manyLevels(25) } }), one("hundred", manyQuestions(100))],
    message: /^(pick has 256 options; at most 255|rate has 26 levels; at most 25|101 questions; a request takes at most 100)\.$/,
  },
  question_id_identifier: {
    hit: [one("spaced", { "wants refund": { type: "noul", instructions: "Refund?" } }), one("digit", { "2nd": { type: "noul", instructions: "Again?" } })],
    miss: items, message: /^"(wants refund|2nd)" is not a plain identifier\.$/,
  },
  choice_key_identifier: {
    hit: one("keys", { team: { type: "choice", instructions: "Team?", criteria: { "late delivery": "Late", ok: "Fine" } } }),
    miss: items, message: /^team: option key "late delivery" is not a plain identifier\.$/,
  },
  blank_choice_text: {
    hit: one("blank-option", { team: { type: "choice", instructions: "Team?", criteria: { a: "", b: "Billing" } } }),
    miss: [order, lead, late], message: /^team: option a has no description\.$/,
  },
  blank_score_level: {
    hit: one("blank-level", { mood: { type: "score", instructions: "Mood?", criteria: ["Low", " ", "High"] } }),
    miss: [order, review, crate], message: /^mood: level 1 has no description\.$/,
  },
  same_choice_text: {
    hit: one("same", { team: { type: "choice", instructions: "Team?", criteria: { a: "Delivery issue", b: "delivery  issue", c: "" , d: "" } } }),
    miss: [order, lead, one("blank-pair", { team: { type: "choice", instructions: "Team?", criteria: { a: "", b: "" } } })],
    message: /^team: options a and b have the same description\.$/,
  },
  long_instruction: {
    hit: one("long", { a: { type: "noul", instructions: `${"x".repeat(300)}?` } }),
    miss: [order, one("limit", { a: { type: "noul", instructions: `${"é".repeat(299)}?` } })], message: /^a: instructions are 301 characters long\.$/,
  },
  placeholder: {
    hit: one("template", { a: { type: "noul", instructions: "Does {customer_name} want a refund for <order_id>?" } }),
    miss: [order, lead, review], message: /^a: instructions contain \{customer_name\}, <order_id>, which nothing fills in\.$/,
  },
  noul_not_question: {
    hit: one("statement", { a: { type: "noul", instructions: "The writer asks for a refund." } }),
    miss: [order, lead, bag, late, one("empty", { a: { type: "noul", instructions: "" } })],
    message: /^a is a yes\/no question whose instructions do not end with a question mark\.$/,
  },
  // wholesale-lead names only `message`; bag-photo never mentions `context`; text and list states are not checked.
  unmentioned_field: { hit: [lead, bag], miss: [late, crate, order, review], message: /^(company|email|context) is in the state, but no instruction mentions it\.$/ },
  identical_states: {
    hitList: [order, lead, leadCopy], missList: [...items, blankCopy],
    message: /^wholesale-lead, lead-copy have the same authored state\.$/,
  },

  // criteria_count: 6, 7, 0, 3, 1, 0, 1.
  total_criteria: [{ ctx: sampleExamplesCtx(), expect: 18 }, { ctx: sampleExamplesCtx({ view: { type: "box" } }), expect: 1, empty: empty() }],
  expectation_examples: [
    { ctx: sampleExamplesCtx(), expect: (result) => { approx7(result.value, 3 / 7); assert.equal(result.detail, "3 of 7"); } },
    { ctx: sampleExamplesCtx({ view: { type: "box" } }), expect: 0.5, empty: empty() },
  ],
  // state bytes: 87, 151, 74, 68, 65, 0, 23 (median 68); the four with a Score: 87, 151, 68, 23 (median 77.5).
  median_state_bytes: [{ ctx: sampleExamplesCtx(), expect: 68 }, { ctx: sampleExamplesCtx({ view: { type: "score" } }), expect: 77.5, empty: empty() }],
  box_examples: [
    { ctx: sampleExamplesCtx(), expect: 2 / 7 },
    { ctx: sampleExamplesCtx({ view: { type: "noul" } }), expect: (result) => { assert.equal(result.value, 0.25); assert.equal(result.detail, "1 of 4"); }, empty: empty() },
  ],

  choice_options_csv: {
    ctx: only("wholesale-lead"),
    text: '"example","question","option","description"\r\n"wholesale-lead","timing","now","Within a month"\r\n'
      + '"wholesale-lead","timing","later","Later this year"\r\n"wholesale-lead","timing","unknown","Not stated"\r\n',
    excludes: ["driftwood.example", "A home customer"], filename: "example-choice-options.csv",
  },
  score_levels_csv: {
    ctx: only("order-triage"),
    text: '"example","question","level","description"\r\n"order-triage","frustration","0","Calm"\r\n'
      + '"order-triage","frustration","1","Frustrated but civil"\r\n"order-triage","frustration","2","Very angry"\r\n',
    excludes: ["shipping", "0.7"], filename: "example-score-levels.csv",
  },
  pictures_csv: {
    ctx: sampleExamplesCtx(),
    text: '"example","picture","sample"\r\n"bag-photo","photo-torn-bag","torn-bag"\r\n"bag-photo","photo-spare-angle",""\r\n',
    excludes: ["iVBORw0KGgo=", "png"], filename: "example-pictures.csv",
  },
  states_json: {
    ctx: only("late-delivery"),
    excludes: ["is_late", "min", "Mentions a delay"], filename: "example-states.json",
    check: (out) => assert.deepEqual(JSON.parse(out.text), { "late-delivery": { message: "My grinder order is a week late and nobody answers." } }),
  },
  notes_markdown: {
    ctx: sampleExamplesCtx({ view: { type: "box" } }),
    text: "## Damaged bag photo · bag-photo\n\nPattern: Images + Box: is it there, and where\nSummary: A delivery photo goes in the state like any other field.\n"
      + "In code: crop to `spill_box` when `beans_spilled.noul` >= 0.5.\n\n## Find the crate · crate-locate\n\nPattern: Box\nSummary: Where is the crate on the pallet?\n"
      + "In code: send the box to the picker.\n",
    excludes: ["photo-torn-bag", "spilled outside", "0.6"], filename: "example-notes.md",
    check: () => {
      const out = pack.features.find((feature) => feature.id === "notes_markdown").build(only("blank-draft"));
      assert.equal(out, "## Blank starting point · blank-draft\n\nNo notes.\n");
    },
  },

  expand_pinned: {
    ctx: () => sampleExamplesCtx({ pins: ["bag-photo", "late-delivery"], expanded: ["bag-photo"] }),
    check: (ctx) => {
      assert.deepEqual(ctx.calls, [["expand", "late-delivery"]]);
      assert.deepEqual(ctx.env.toasts, [{ message: "Opened 1 preview.", kind: "" }]);
    },
    hidden: () => sampleExamplesCtx({ pins: ["bag-photo"], expanded: ["bag-photo", "order-triage"] }),
  },
  collapse_hidden: {
    ctx: () => sampleExamplesCtx({ view: { type: "box" }, expanded: ["late-delivery", "bag-photo", "order-triage"] }),
    check: (ctx) => {
      assert.deepEqual(ctx.calls, [["collapse", "order-triage"], ["collapse", "late-delivery"]], "in gallery order; shown previews stay open");
      assert.deepEqual(ctx.env.toasts, [{ message: "Closed 2 hidden previews.", kind: "" }]);
    },
    hidden: () => sampleExamplesCtx({ view: { type: "box" }, expanded: ["bag-photo"] }),
  },
  unpin_hidden: {
    ctx: () => sampleExamplesCtx({ view: { type: "box" }, pins: ["order-triage", "crate-locate"] }),
    check: (ctx) => {
      assert.deepEqual(ctx.calls, [["unpin", "order-triage"]]);
      assert.deepEqual(ctx.data.pins, ["crate-locate"], "the shown pin stays");
      assert.deepEqual(ctx.env.toasts, [{ message: "Unpinned 1 hidden example.", kind: "" }]);
    },
    hidden: () => sampleExamplesCtx({ view: { type: "box" }, pins: ["crate-locate"] }),
  },
  reopen_loaded: {
    ctx: () => sampleExamplesCtx({ loaded: "bag-photo" }),
    check: (ctx) => {
      assert.deepEqual(ctx.calls, [["open", "bag-photo"]]);
      assert.equal(pack.features.find((feature) => feature.id === "reopen_loaded").when(sampleExamplesCtx({ loaded: "no-such-example" })), false);
    },
    hidden: () => sampleExamplesCtx({ loaded: null }),
  },
}, { ctx: () => sampleExamplesCtx() });

// Exact findings, not only their shape: every expected message and nothing else.
const messages = (id, item) => runDiagnostics([[id, feature(id)]], [item], sampleExamplesCtx()).map((finding) => finding.message);
test("examples-more: checks report exactly the expected findings", () => {
  assert.deepEqual(messages("unmentioned_field", lead), ["company is in the state, but no instruction mentions it.", "email is in the state, but no instruction mentions it."]);
  assert.deepEqual(messages("unmentioned_field", bag), ["context is in the state, but no instruction mentions it."]);
  assert.deepEqual(messages("empty_instructions", one("two", { a: { type: "noul", instructions: "" }, b: { type: "noul", instructions: "Late?" }, c: { type: "box" } })),
    ["a has no instructions.", "c has no instructions."]);
  assert.deepEqual(messages("over_limits", one("both", { pick: { type: "choice", instructions: "Pick?", criteria: manyOptions(300) },
    rate: { type: "score", instructions: "Rate?", criteria: manyLevels(30) } })), ["pick has 300 options; at most 255.", "rate has 30 levels; at most 25."]);
  assert.deepEqual(messages("same_choice_text", one("three", { team: { type: "choice", instructions: "Team?", criteria: { a: "Late", b: "LATE", c: " late " } } })),
    ["team: options a and b have the same description.", "team: options a and c have the same description."]);
  assert.deepEqual(messages("question_id_identifier", one("ok", { _private: { type: "noul", instructions: "Late?" }, x2: { type: "noul", instructions: "Late?" } })), []);
});

test("examples-more: odd items give unavailable values and no findings instead of throwing", () => {
  const odd = [{}, { questions: "nope", pictures: [null], state: undefined }, { questions: [null, { type: "choice", criteria: [null, 5] }], pictures: [null, 3] }];
  for (const item of odd) {
    for (const entry of pack.features.filter((f) => f.kind === "fact")) {
      const value = entry.value(item, sampleExamplesCtx());
      assert.ok(value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)), `${entry.id} on ${JSON.stringify(item)} gave ${value}`);
    }
    for (const entry of pack.features.filter((f) => f.kind === "diagnostic" && (f.scope || "item") === "item")) entry.check(item, sampleExamplesCtx(), 0);
  }
  assert.equal(feature("longest_criterion").value(odd[2]), null);
  assert.equal(feature("shortest_instruction").value({}), null);
  const ctx = sampleExamplesCtx({ examples: [] });
  for (const entry of pack.features.filter((f) => f.kind === "exporter")) assert.equal(typeof entry.build(ctx), "string");
});

function approx7(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `expected ${expected}, got ${actual}`);
}
