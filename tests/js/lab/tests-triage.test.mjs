import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tests-triage.js";
import { mergeTestResults } from "../../../static/js/test-selection.js";
import { checkPack } from "./harness.mjs";
import { sampleTestsItemsCtx, sampleTestsRaw } from "./fixtures/workbench-tests.mjs";

const ctx = (overrides) => sampleTestsItemsCtx(overrides);
const all = () => ctx({ filters: {} });
const T = Object.fromEntries(all().items().map((item) => [item.id, item]));
const R = T["refund-routing"], B = T["bean-quality"], D = T["damaged-bag-photo"], W = T["wholesale-inquiry"], L = T["latte-art-feedback"], U = T["unnamed-draft"];
const empty = () => ctx({ results: null });
// Items made by the real builder from hand-written raw tests (nothing run).
const made = (...raws) => ctx({ items: raws, results: null, filters: {} }).items();
const noul = (id, expect) => ({ id, name: id, state: "Is the cafe open on Sunday?", questions: { open: { type: "noul", instructions: "Open?" } }, expect: { open: expect } });
const [EMPTY_RANGE, CHOICE_ON_NOUL, NOUL_TOO_HIGH, NOUL_FINE] = made(noul("empty-range", { min: 0.8, max: 0.2 }), noul("choice-on-noul", { choice: "yes" }),
  noul("noul-too-high", { min: 1.5 }), noul("noul-fine", { min: 0.2, max: 0.8 }));
const [SCORE_TOO_HIGH, BOX_RANGE, CHOICE_ON_SCORE, FUTURE, BAD_DATE] = made(
  { id: "score-too-high", name: "Score too high", state: "Great beans",
    questions: { quality: { type: "score", instructions: "How happy?", criteria: ["Unhappy", "Mixed", "Happy"] } }, expect: { quality: { min: 1, max: 3 } } },
  // The run ignores min and max on a Box, so min above max there cannot make the check fail.
  { id: "box-range", name: "Box range", state: { photo: "photo" }, questions: { tear: { type: "box", instructions: "Where is the tear in `photo`?" } },
    expect: { tear: { min: 0.8, max: 0.2 } } },
  { id: "choice-on-score", name: "Choice on score", state: "Fine beans",
    questions: { quality: { type: "score", instructions: "How happy?", criteria: ["Unhappy", "Happy"] } }, expect: { quality: { choice: "1" } } },
  { id: "future", name: "Future", saved_at: "2026-11-13T00:00:00Z", state: "x", questions: {} },
  { id: "bad-date", name: "Bad date", saved_at: "2026-02-30T00:00:00Z", state: "x", questions: {} });
const [TWIN_A, TWIN_B] = made({ ...sampleTestsRaw()[0], id: "refund-a" }, { ...sampleTestsRaw()[0], id: "refund-b", name: "  refund   ROUTING " });

// One test with four kinds of question and a run of its own, and one whose question type is an odd string.
//   a noul, no expectation, answered 0.4          -> unchecked answer
//   b noul, missing answer                         -> failed check
//   c choice, expected x, answered y (conf 0.62)  -> failed check
//   d score, min 1, answered 0.2 (conf 0.34)      -> failed check
//   e box, no expectation, answered (conf 0.9)    -> unchecked answer
const MULTI_RAW = { id: "multi-check", name: "Multi check", saved_at: "2026-11-12T11:00:00Z", state: "Two bags of decaf, one torn.",
  questions: { a: { type: "noul", instructions: "Decaf?" }, b: { type: "noul", instructions: "Torn?" },
    c: { type: "choice", instructions: "Which bag?", criteria: { x: "First", y: "Second" } },
    d: { type: "score", instructions: "How bad?", criteria: ["None", "Some", "Bad"] }, e: { type: "box", instructions: "Where?" } },
  expect: { c: { choice: "x" }, d: { min: 1 } } };
const ODD_RAW = { id: "odd-type", name: "Odd type", state: "x", questions: { q: { type: "Tell me the secret code", instructions: "?" } } };
const MULTI_BATCH = { runs: [{ id: "multi-check", name: "Multi check", ok: false, elapsed_ms: 120,
  meta: { model: "jev-1.3", latency_ms: 300, question_count: 5, input_tokens: 512, output_tokens: 20, cost_usd: 0.0002, backend: "sdk" },
  trace: { request: {}, response: {} },
  results: {
    a: { ok: null, checks: ["no expectation"], answer: { type: "noul", noul: 0.4 } },
    b: { ok: false, checks: ["missing answer"], answer: null },
    c: { ok: false, checks: ["choice ≠ x"], answer: { type: "choice", choice: "y", probabilities: { x: 0.38, y: 0.62 }, confidence: 0.62 } },
    d: { ok: false, checks: ["0.20 < 1.00"], answer: { type: "score", score: 0.2, legend: {}, probabilities: {}, confidence: 0.34 } },
    e: { ok: null, checks: ["no box expected"], answer: { type: "box", box: { left: 0, top: 0, right: 1, bottom: 1 }, confidence: 0.9 } },
  } }], passed: 0, failed: 1, wall_ms: 310, cost_usd: 0.0002 };
const [MULTI, ODD] = ctx({ items: [MULTI_RAW, ODD_RAW], results: mergeTestResults(null, MULTI_BATCH, [MULTI_RAW, ODD_RAW]), filters: {} }).items();
const BARE = {};

checkPack(pack, {
  noul_questions: { items: [R, B, D, U, MULTI, ODD, BARE], values: [1, 0, 1, 0, 2, 0, null] },
  choice_questions: { items: [R, B, W, U, MULTI, BARE], values: [1, 0, 1, 0, 1, null] },
  score_questions: { items: [B, L, R, U, MULTI, BARE], values: [1, 1, 0, 0, 1, null] },
  box_questions: { items: [D, R, U, MULTI, BARE], values: [1, 0, 0, 1, null] },
  // Bean quality failed its range; latte failed its orphan expectation; multi failed b, c and d; damaged errored and
  // wholesale never ran.
  failed_checks: { items: [R, B, L, MULTI, D, W, BARE], values: [0, 1, 1, 3, null, null, null] },
  // Latte's tone was answered with no expectation; the orphan has no answer, so it is not an unchecked answer. Multi:
  // a and e (b has no answer).
  unchecked_answers: { items: [R, L, MULTI, D, W, BARE], values: [0, 1, 2, null, null, null] },
  input_tokens: { items: [R, B, L, MULTI, D, W, BARE], values: [180, 140, 220, 512, null, null, null] },
  // Refund: Choice 0.88 (the Noul has none); bean 0.55; latte 0.71 (Score) beside a Noul; multi: min(0.62, 0.34, 0.9).
  lowest_confidence: { items: [R, B, L, MULTI, D, W, BARE], values: [0.88, 0.55, 0.71, 0.34, null, null, null] },
  // Clock 2026-11-12T12:00Z: Oct 1 09:30 is 42 days 2.5 h back, Oct 15 14:00 is 27 days 22 h, Nov 2 08:05 is 10 days
  // 3 h 55 min, Sep 20 17:45 is 52 days 18 h 15 min, an hour ago is 0 days; no saved_at, a save after the clock (0) and
  // February 30 (unreadable, null).
  age_days: { items: [R, B, D, L, MULTI, W, U, FUTURE, BAD_DATE, BARE], values: [42, 27, 10, 52, 0, null, null, 0, null, null], ctx: all() },
  empty_expectation: { items: [W, R, U, BARE], values: [true, false, false, false] },
  unreachable_choice: { items: [W, R, B, MULTI, BARE], values: [true, false, false, false, false] },
  answer_model: { items: [R, B, L, MULTI, D, W, BARE], values: ["jev-1.2", "jev-1.2", "jev-1.1", "jev-1.3", null, null, null] },
  // An odd type string never shows: it reads "other".
  type_mix: { items: [R, B, D, L, MULTI, ODD, U, BARE], values: ["choice + noul", "score", "box + noul", "noul + score", "box + choice + noul + score", "other", null, null] },

  min_above_max: { hit: EMPTY_RANGE, miss: [NOUL_FINE, BOX_RANGE, R, B, D, BARE], message: /^open: min is above max/ },
  choice_on_non_choice: { hit: [CHOICE_ON_NOUL, CHOICE_ON_SCORE], miss: [R, W, NOUL_FINE, BARE], message: /^(open: a noul|quality: a score) has no options/ },
  // Noul 0..1 (min 1.5), Score with three levels 0..2 (max 3); Choice min 0.6 and Score 1..2 are inside.
  bound_out_of_range: { hit: [NOUL_TOO_HIGH, SCORE_TOO_HIGH], miss: [R, B, L, D, NOUL_FINE, BOX_RANGE, BARE], message: /^(open: min is outside 0 to 1|quality: max is outside 0 to 2)\.$/ },
  duplicate_names: { hitList: [R, TWIN_A, TWIN_B, BARE], missList: [...Object.values(T), BARE], message: /^refund-routing, refund-a, refund-b share a name\.$/ },

  // Shown by default (latte hidden): refund 2 passed, bean 1 failed -> 2 / 3. All: + latte 1 passed, 1 failed -> 3 / 5.
  // Multi: 3 failed checks, 2 unchecked left out -> 0 / 3.
  check_pass_rate: [{ ctx: ctx(), expect: (result) => { assert.ok(Math.abs(result.value - 2 / 3) < 1e-12); assert.equal(result.detail, "2 of 3 checks"); }, empty: empty() },
    { ctx: all(), expect: 0.6, tolerance: 1e-12 },
    { ctx: ctx({ items: [MULTI_RAW], results: mergeTestResults(null, MULTI_BATCH, [MULTI_RAW]), filters: {} }), expect: 0 },
    { ctx: ctx({ filters: { status: "not-run" } }), expect: null }],
  // Shown latencies 412.5 and 655 -> 533.75; with latte's 980 the middle one is 655; only the error and the unrun tests
  // shown -> nothing measured.
  median_latency: [{ ctx: ctx(), expect: 533.75, empty: empty() }, { ctx: all(), expect: 655 }, { ctx: ctx({ filters: { status: "error" } }), expect: null }],

  // All six in saved order: 412.5 ms rounds to 413; the error and the unrun tests have no measurement.
  results_markdown: { ctx: all(), filename: "jev-test-results.md",
    text: "| Test | Name | Status | Failed questions | Latency | Spend |\n| --- | --- | --- | --- | --- | --- |\n"
      + "| refund-routing | Refund routing | pass | — | 413 ms | $0.00021 |\n"
      + "| bean-quality | Bean quality review | fail | quality | 655 ms | $0.00015 |\n"
      + "| damaged-bag-photo | Damaged bag photo | error | — | — | — |\n"
      + "| wholesale-inquiry | Wholesale inquiry | not-run | — | — | — |\n"
      + "| latte-art-feedback | Latte art feedback | fail | old_question | 980 ms | $0.0003 |\n"
      + "| unnamed-draft | unnamed-draft | not-run | — | — | — |\n",
    excludes: ["burnt", "lukewarm", "0.40", "0.91", "min", "Unhappy", "Money back", "Budget reached", "archived", "dana@"] },

  // Greedy cover of the shown tests: refund (intent, urgent), damaged (damage, torn), wholesale (route, spam), then
  // bean (quality); the selection lists them in saved order and replaces the hidden latte selection.
  select_covering: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.log, [["setSelection", ["refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry"]]]);
      assert.deepEqual(c.data.selected, ["refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry"]);
      assert.equal(c.data.can_undo_selection, true);
      assert.match(c.env.toasts[0].message, /^Selected 4 tests that together ask every shown question ID\./);
    },
    hidden: () => ctx({ items: [sampleTestsRaw()[5]] }) },
}, { ctx: () => ctx() });
