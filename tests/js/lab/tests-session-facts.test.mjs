import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tests-session-facts.js";
import { factValue } from "../../../static/js/lab/kit.js";
import { mergeTestResults } from "../../../static/js/test-selection.js";
import { checkPack } from "./harness.mjs";
import { sampleTestsBatch, sampleTestsItemsCtx, sampleTestsRaw } from "./fixtures/workbench-tests.mjs";

// Five more saved tests (fictional, .example addresses) and their made-up latest results, merged into the fixture's
// session by the page's own mergeTestResults, so the items come from the real surface builder.
const meta = (model, latency, input, output, cost, backend, count) =>
  ({ model, latency_ms: latency, question_count: count, input_tokens: input, output_tokens: output, cost_usd: cost, backend });
const EXTRA_RAW = [
  { id: "close-call", name: "Close call", saved_at: "2026-11-05T10:00:00Z", state: "Order HC-2001 arrived late, refund please. sam@customer.example",
    questions: {
      intent: { type: "choice", instructions: "What does the customer want?", criteria: { refund: "Money back", replacement: "A new bag", question: "Just asking" } },
      urgent: { type: "noul", instructions: "Reply today?" },
      quality: { type: "score", instructions: "How happy?", criteria: ["Unhappy", "Mixed", "Happy"] },
      damage: { type: "box", instructions: "Where is the tear in `photo`?" },
    },
    expect: { intent: { choice: "refund", min: 0.5 }, urgent: { min: 0.4 }, quality: { min: 1, max: 2 }, damage: { box: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 } } },
    images: { photo: { sample: "torn-bag" } } },
  { id: "wrong-pick", name: "Wrong pick", state: ["Is this a wholesale order?", "From cafe@portside.example"],
    questions: {
      route: { type: "choice", instructions: "Which team?", criteria: { sales: "Wholesale sales", support: "Customer support" } },
      spam: { type: "noul", instructions: "Spam?" },
      stain: { type: "box", instructions: "Where is the stain in `photo`?" },
      extra: { type: "noul", instructions: "Mentions a cafe?" },
    },
    expect: { route: { choice: "sales" }, spam: { max: 0.2 }, stain: { box: { left: 0.1, top: 0.1, right: 0.4, bottom: 0.4 }, iou_min: 0.6 }, extra: { min: 0.5 } },
    images: { photo: { sample: "torn-bag" } } },
  { id: "rate-limited", name: "Rate limited", state: "Hello", questions: { open: { type: "noul", instructions: "Open?" } } },
  { id: "key-rejected", name: "Key rejected", state: "Hello", questions: { open: { type: "noul", instructions: "Open?" } } },
  { id: "bad-bounds", name: "Bad bounds", state: "Need beans by Friday", questions: { urgent: { type: "noul", instructions: "Urgent?" } }, expect: { urgent: { min: "high" } } },
  // Yes/no answers on the edges of the uncertain band, and a call whose meta reports zero questions.
  { id: "edge-noul", name: "Edge noul", state: "Beans for Friday?", questions: { a: { type: "noul", instructions: "A?" }, b: { type: "noul", instructions: "B?" },
    c: { type: "noul", instructions: "C?" }, d: { type: "noul", instructions: "D?" } } },
  // An expectation that is a bare number: the server's check_expectation fails on it (TypeError), so it is invalid.
  { id: "number-expect", name: "Number expect", state: "Hello", questions: { urgent: { type: "noul", instructions: "Urgent?" } }, expect: { urgent: 5 } },
  // One call error per cause, worded as jev/client.py and jev/images.py word them.
  ...["err-upstream", "err-upstream-429", "err-422", "err-network", "err-guard", "err-picture", "err-odd"].map((id) => ({ id, name: id, state: "Hello",
    questions: { open: { type: "noul", instructions: "Open?" } } })),
];
const ERRORS = {
  // Upstream text that says "image" or "budget" must not decide the cause: the TypeSafe prefix does.
  "err-upstream": "TypeSafe error 500: image decoder crashed",
  "err-upstream-429": "TypeSafe rate limit (429): monthly budget exceeded",
  "err-422": "TypeSafe could not validate the request (422): questions.open.type is invalid",
  "err-network": "Could not reach TypeSafe: [Errno 111] Connection refused",
  "err-guard": "This server run has spent its $1.00 budget ($1.0000 recorded, $0.0000 held by calls still running, 0 live calls). Restart it with JEV_LAB_BUDGET_USD=<amount> to allow more.",
  "err-picture": "photo: Image is 20.0 MiB; the limit is 16 MiB.",
  "err-odd": "Something unexpected happened",
};
const EXTRA_RUNS = [
  { id: "close-call", name: "Close call", ok: true, elapsed_ms: 850, meta: meta("jev-1.2", 800, 400, 20, 0.0004, "typesafe-sdk 1.4.0", 4), trace: { request: {}, response: {} },
    results: {
      intent: { ok: true, checks: ["choice = refund", "0.52 ≥ 0.50"], answer: { type: "choice", choice: "refund", probabilities: { refund: 0.52, replacement: 0.4, question: 0.08 }, confidence: 0.6 } },
      urgent: { ok: true, checks: ["0.47 ≥ 0.40"], answer: { type: "noul", noul: 0.47 } },
      quality: { ok: true, checks: ["1.90 ≥ 1.00", "1.90 ≤ 2.00"], answer: { type: "score", score: 1.9, probabilities: { 0: 0.02, 1: 0.06, 2: 0.92 }, confidence: 0.8 } },
      damage: { ok: true, checks: ["IoU 0.75 ≥ 0.50"], answer: { type: "box", box: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.5 }, confidence: 0.9 } },
    } },
  { id: "wrong-pick", name: "Wrong pick", ok: false, elapsed_ms: 320, meta: meta("jev-1.1", 300, 260, 30, 0.0002, "stdlib fallback", 4), trace: { request: {}, response: {} },
    results: {
      route: { ok: false, checks: ["choice ≠ sales"], answer: { type: "choice", choice: "support", probabilities: { sales: 0.3, support: 0.7 }, confidence: 0.7 } },
      spam: { ok: false, checks: ["0.25 > 0.20"], answer: { type: "noul", noul: 0.25 } },
      stain: { ok: false, checks: ["IoU 0.00 < 0.60"], answer: { type: "box", box: { left: 0.6, top: 0.6, right: 0.9, bottom: 0.9 }, confidence: 0.4 } },
      extra: { ok: false, checks: ["missing answer"], answer: null },
    } },
  { id: "rate-limited", name: "Rate limited", ok: false, error: "Local rate limit: more than 30 live calls in the last minute. Wait a moment.", results: {}, elapsed_ms: 1.5 },
  { id: "key-rejected", name: "Key rejected", ok: false, error: "TypeSafe rejected the API key (401): invalid key", results: {}, elapsed_ms: 210 },
  { id: "bad-bounds", name: "Bad bounds", ok: false, elapsed_ms: 260, meta: meta("jev-1.2", 250, 90, 4, 0.00008, "sdk", 1), trace: { request: {}, response: {} },
    results: { urgent: { ok: false, checks: ["invalid expectation {\"min\": \"high\"}: ValueError"], answer: { type: "noul", noul: 0.6 } } } },
  { id: "edge-noul", name: "Edge noul", ok: true, elapsed_ms: 120, meta: meta("jev-1.2", 100, 50, 5, 0.00004, "sdk", 0), trace: { request: {}, response: {} },
    results: { a: { ok: null, checks: ["no expectation"], answer: { type: "noul", noul: 0.35 } }, b: { ok: null, checks: ["no expectation"], answer: { type: "noul", noul: 0.65 } },
      c: { ok: null, checks: ["no expectation"], answer: { type: "noul", noul: 0.34 } }, d: { ok: null, checks: ["no expectation"], answer: { type: "noul", noul: 0.66 } } } },
  { id: "number-expect", name: "Number expect", ok: false, elapsed_ms: 90, meta: meta("jev-1.2", 80, 40, 3, 0.00003, "sdk", 1), trace: { request: {}, response: {} },
    results: { urgent: { ok: false, checks: ["invalid expectation 5: TypeError"], answer: { type: "noul", noul: 0.9 } } } },
  ...Object.entries(ERRORS).map(([id, error]) => ({ id, name: id, ok: false, error, results: {}, elapsed_ms: 2 })),
];

const combined = () => {
  const items = [...sampleTestsRaw(), ...EXTRA_RAW];
  const batch = sampleTestsBatch();
  return sampleTestsItemsCtx({ items, filters: {}, results: mergeTestResults(null, { ...batch, runs: [...batch.runs, ...EXTRA_RUNS] }, items) });
};
const C = combined();
const T = Object.fromEntries(C.items().map((item) => [item.id, item]));
const R = T["refund-routing"], B = T["bean-quality"], D = T["damaged-bag-photo"], W = T["wholesale-inquiry"], L = T["latte-art-feedback"];
const X1 = T["close-call"], X2 = T["wrong-pick"], X3 = T["rate-limited"], X4 = T["key-rejected"], X5 = T["bad-bounds"];
const E = T["edge-noul"], N = T["number-expect"];
const ERR = Object.fromEntries(Object.keys(ERRORS).map((id) => [id, T[id]]));

checkPack(pack, {
  // Refund 2 of 2 checks, bean 0 of 1, latte 1 of 2 (tone is unchecked; the orphan fails), close-call 4 of 4, wrong-pick 0 of 4.
  check_pass_share: { items: [R, B, L, D, W, X1, X2], values: [1, 0, 0.5, null, null, 1, 0], ctx: C },
  // Refund: intent 0.91 - 0.60 = 0.31, urgent 0.72 - 0.50 = 0.22. Latte: 0.97 - 0.80. Close-call: 0.52 - 0.50 (the Score
  // and box margins are other scales). Wrong-pick: max 0.20 - 0.25 (route has a choice expectation only). Bean is a Score.
  closest_probability_margin: { items: [R, B, L, X1, X2, D], values: [0.22, null, 0.17, 0.02, -0.05, null], ctx: C },
  // Bean: 0.4 - 1 = -0.6 (and 2 - 0.4 = 1.6). Close-call: 2 - 1.9 = 0.1 (and 1.9 - 1 = 0.9).
  closest_score_margin: { items: [B, X1, R, D], values: [-0.6, 0.1, null, null], ctx: C },
  // The probability of the expected option: refund 0.91, refund 0.52, sales 0.3 (support was chosen).
  lowest_expected_probability: { items: [R, X1, X2, B, W], values: [0.91, 0.52, 0.3, null, null], ctx: C },
  // Close-call: answered 0.4 x 0.3 inside expected 0.4 x 0.4 -> 0.12 / 0.16 = 0.75. Wrong-pick: disjoint boxes -> 0.
  lowest_overlap: { items: [X1, X2, R, D], values: [0.75, 0, null, null], ctx: C },
  missing_answer: { items: [X2, R, X1, D, W], values: [true, false, false, false, false], ctx: C },
  wrong_choice: { items: [X2, X1, R, B], values: [true, false, false, false], ctx: C },
  // Close-call passed with intent 0.02 above its min; refund's closest margin is 0.22; wrong-pick failed.
  close_pass: { items: [X1, R, X2, W], values: [true, false, false, false], ctx: C },
  // Wrong-pick fails four ways: wrong choice, above max, low overlap, missing answer.
  failure_kind: { items: [R, B, L, D, W, X2, X5, N, E], values: [null, "below min", "unknown question", "call error", null, "several kinds", "invalid expectation", "invalid expectation", null], ctx: C },
  error_kind: { items: [D, X3, X4, ...Object.values(ERR), R, W],
    values: ["budget reached", "local rate limit", "API key", "upstream error", "upstream rate limit", "request validation", "network", "budget reached", "picture problem", "other", null, null], ctx: C },
  failing_check_ids: { items: [B, L, X2, R, D], values: ["quality", "old_question", "route, spam, stain, extra", "", ""], ctx: C },
  // Close-call: (0.6 + 0.8 + 0.9) / 3; wrong-pick: (0.7 + 0.4) / 2; bad-bounds has only a yes/no answer.
  mean_confidence: { items: [R, B, X1, X2, X5, D, W], values: [0.88, 0.55, 2.3 / 3, 0.55, null, null, null], ctx: C },
  // P(yes) 0.47 and 0.6 are within 0.35..0.65; 0.72, 0.25 and 0.97 are not; bean has no yes/no question. Edge: 0.35 and
  // 0.65 count (the band is closed), 0.34 and 0.66 do not.
  uncertain_yes_no: { items: [R, X1, X5, X2, D, W, B, E], values: [0, 1, 1, 0, null, null, 0, 2], ctx: C },
  // Reference values from Python: -sum(p ln p) / ln k for (0.91, 0.06, 0.03), (0.52, 0.4, 0.08) and (0.3, 0.7).
  highest_choice_entropy: { items: [R, X1, X2, B, D], values: [0.3275260089073461, 0.8270582413085317, 0.8812908992306927, null, null], ctx: C },
  smallest_choice_gap: { items: [R, X1, X2, B], values: [0.85, 0.12, 0.4, null], ctx: C },
  output_tokens: { items: [R, B, L, X2, E, D, W], values: [12, 9, 15, 30, 5, null, null], ctx: C },
  // 180 / 2, 140 / 1, 220 / 2, 400 / 4; edge-noul's meta reports zero questions, so there is no per-question value.
  input_tokens_per_question: { items: [R, B, L, X1, E, D], values: [90, 140, 110, 100, null, null], ctx: C },
  // $0.00021 / 2, $0.00015 / 1, $0.0004 / 4, $0.0002 / 4.
  cost_per_question: { items: [R, B, X1, X2, E, D], values: [0.000105, 0.00015, 0.0001, 0.00005, null, null], ctx: C, tolerance: 1e-15 },
  // 412.5 / 2, 655 / 1, 980 / 2, 800 / 4, 300 / 4.
  latency_per_question: { items: [R, B, L, X1, X2, E, D], values: [206.25, 655, 490, 200, 75, null, null], ctx: C },
  // Call errors carry server time too.
  server_elapsed_ms: { items: [R, B, D, L, W, X3], values: [430.1, 660.4, 3.2, 1001, null, 1.5], ctx: C },
  // 430.1 - 412.5, 660.4 - 655, 1001 - 980, 850 - 800; an error has no latency.
  server_overhead_ms: { items: [R, B, L, X1, D, W], values: [17.6, 5.4, 21, 50, null, null], ctx: C },
}, { ctx: () => sampleTestsItemsCtx() });

test("tests-session-facts: every fact is unavailable before a run", () => {
  const ctx = sampleTestsItemsCtx({ items: [...sampleTestsRaw(), ...EXTRA_RAW], results: null, filters: {} });
  for (const item of ctx.items()) {
    for (const fact of pack.features) {
      const value = factValue(fact, item, ctx);
      assert.ok(value === null || value === false || value === "", `${fact.id} of ${item.id} should be unknown before a run, got ${JSON.stringify(value)}`);
    }
  }
});

test("tests-session-facts: facts never carry chosen options, expectation values or error text", () => {
  const texts = C.items().flatMap((item) => pack.features.map((fact) => factValue(fact, item, C))).filter((value) => typeof value === "string");
  for (const banned of ["refund", "support", "sales", "high", "Local rate limit", "rejected", "Budget reached", "Unhappy", "decoder", "Errno", "MiB", "unexpected"]) {
    assert.ok(!texts.some((text) => text.includes(banned)), `a fact value contains ${banned}`);
  }
});

test("tests-session-facts: odd items and results give unknown values, never an exception", () => {
  const odd = [null, undefined, 7, "x", {}, { result: "done" }, { status: "pass", result: { checks: "none" } }, { questions: "q", result: { error: 42 } },
    { result: { checks: [null, 3, { question: true, ok: false, answer: { type: "box", box: null } }], meta: { question_count: "2", latency_ms: "9" } } },
    { questions: [{ id: "q", expect: { min: 0.5 } }], result: { checks: [{ id: "q", question: true, ok: false, answer: { type: "choice", probabilities: null } }], meta: null } }];
  for (const item of odd) {
    for (const fact of pack.features) {
      const value = fact.value(item, C);
      assert.ok(value === null || value === false || value === "" || typeof value === "number" || typeof value === "string",
        `${fact.id} gave ${String(value)}`);
      if (typeof value === "number") assert.ok(Number.isFinite(value), `${fact.id} gave ${value}`);
    }
  }
});
