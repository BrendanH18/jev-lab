import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tests-triage.js";
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
const [SCORE_TOO_HIGH] = made({ id: "score-too-high", name: "Score too high", state: "Great beans",
  questions: { quality: { type: "score", instructions: "How happy?", criteria: ["Unhappy", "Mixed", "Happy"] } }, expect: { quality: { min: 1, max: 3 } } });
const [TWIN_A, TWIN_B] = made({ ...sampleTestsRaw()[0], id: "refund-a" }, { ...sampleTestsRaw()[0], id: "refund-b", name: "  refund   ROUTING " });

checkPack(pack, {
  noul_questions: { items: [R, B, D, U], values: [1, 0, 1, 0] },
  choice_questions: { items: [R, B, W, U], values: [1, 0, 1, 0] },
  score_questions: { items: [B, L, R, U], values: [1, 1, 0, 0] },
  box_questions: { items: [D, R, U], values: [1, 0, 0] },
  // Bean quality failed its range; latte failed its orphan expectation; damaged errored and wholesale never ran.
  failed_checks: { items: [R, B, L, D, W], values: [0, 1, 1, null, null] },
  // Latte's tone was answered with no expectation; the orphan has no answer, so it is not an unchecked answer.
  unchecked_answers: { items: [R, L, D, W], values: [0, 1, null, null] },
  input_tokens: { items: [R, B, L, D, W], values: [180, 140, 220, null, null] },
  // Refund: Choice 0.88 (the Noul has none); bean 0.55; latte 0.71 (Score) beside a Noul.
  lowest_confidence: { items: [R, B, L, D, W], values: [0.88, 0.55, 0.71, null, null] },
  // Clock 2026-11-12T12:00Z: Oct 1 09:30 is 42 days back, Oct 15 14:00 is 27 days 22 h, Nov 2 08:05 is 10 days,
  // Sep 20 17:45 is 52 days 18 h; no saved_at is unknown.
  age_days: { items: [R, B, D, L, W, U], values: [42, 27, 10, 52, null, null], ctx: all() },
  empty_expectation: { items: [W, R, U], values: [true, false, false] },
  unreachable_choice: { items: [W, R, B], values: [true, false, false] },
  answer_model: { items: [R, B, L, D, W], values: ["jev-1.2", "jev-1.2", "jev-1.1", null, null] },
  type_mix: { items: [R, B, D, L, U], values: ["choice + noul", "score", "box + noul", "noul + score", null] },

  min_above_max: { hit: EMPTY_RANGE, miss: [NOUL_FINE, R, B, D], message: /^open: min is above max/ },
  choice_on_non_choice: { hit: CHOICE_ON_NOUL, miss: [R, W, NOUL_FINE], message: /^open: a noul has no options/ },
  bound_out_of_range: { hit: [NOUL_TOO_HIGH, SCORE_TOO_HIGH], miss: [R, B, L, D, NOUL_FINE], message: /^(open: min is outside 0 to 1|quality: max is outside 0 to 2)\.$/ },
  duplicate_names: { hitList: [R, TWIN_A, TWIN_B], missList: Object.values(T), message: /^refund-routing, refund-a, refund-b share a name\.$/ },

  // Shown by default (latte hidden): refund 2 passed, bean 1 failed -> 2 / 3. All: + latte 1 passed, 1 failed -> 3 / 5.
  check_pass_rate: [{ ctx: ctx(), expect: 2 / 3, tolerance: 1e-12, empty: empty() }, { ctx: all(), expect: 0.6, tolerance: 1e-12 }],
  // Shown latencies 412.5 and 655 -> 533.75; with latte's 980 the middle one is 655.
  median_latency: [{ ctx: ctx(), expect: 533.75, empty: empty() }, { ctx: all(), expect: 655 }],
  input_tokens_total: [{ ctx: ctx(), expect: 320, empty: empty() }, { ctx: all(), expect: 540 }],

  results_markdown: { ctx: ctx({ filters: { status: "fail" } }), filename: "jev-test-results.md",
    text: "| Test | Name | Status | Failed questions | Latency | Spend |\n| --- | --- | --- | --- | --- | --- |\n"
      + "| bean-quality | Bean quality review | fail | quality | 655 ms | $0.00015 |\n"
      + "| latte-art-feedback | Latte art feedback | fail | old_question | 980 ms | $0.0003 |\n",
    excludes: ["burnt", "lukewarm", "0.40", "min", "Unhappy"] },

  // Greedy cover of the shown tests: refund (intent, urgent), damaged (damage, torn), wholesale (route, spam), then
  // bean (quality); the selection lists them in saved order and replaces the hidden latte selection.
  select_covering: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.log, [["setSelection", ["refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry"]]]);
      assert.deepEqual(c.data.selected, ["refund-routing", "bean-quality", "damaged-bag-photo", "wholesale-inquiry"]);
      assert.equal(c.data.can_undo_selection, true);
    },
    hidden: () => ctx({ items: [sampleTestsRaw()[5]] }) },
}, { ctx: () => ctx() });
