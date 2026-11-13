import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tests-suite-metrics.js";
import { runMetrics } from "../../../static/js/lab/kit.js";
import { mergeTestResults } from "../../../static/js/test-selection.js";
import { checkPack } from "./harness.mjs";
import { sampleTestsBatch, sampleTestsItemsCtx, sampleTestsRaw, sampleTestsResults } from "./fixtures/workbench-tests.mjs";

// The fixture's six tests plus five more (fictional, .example addresses) with made-up latest results, merged by the
// page's own mergeTestResults so the ctx comes from the real surface builder.
const meta = (model, latency, input, output, cost, backend, count) =>
  ({ model, latency_ms: latency, question_count: count, input_tokens: input, output_tokens: output, cost_usd: cost, backend });
const EXTRA_RAW = [
  { id: "close-call", name: "Close call", state: "Order HC-2001 arrived late, refund please. sam@customer.example",
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
    expect: { route: { choice: "sales" }, spam: { max: 0.2 }, stain: { box: { left: 0.1, top: 0.1, right: 0.4, bottom: 0.4 }, iou_min: 0.6 }, extra: { min: 0.5 } } },
  { id: "rate-limited", name: "Rate limited", state: "Hello", questions: { open: { type: "noul", instructions: "Open?" } } },
  { id: "key-rejected", name: "Key rejected", state: "Hello", questions: { open: { type: "noul", instructions: "Open?" } } },
  { id: "bad-bounds", name: "Bad bounds", state: "Need beans by Friday", questions: { urgent: { type: "noul", instructions: "Urgent?" } }, expect: { urgent: { min: "high" } } },
];
const EXTRA_RUNS = [
  { id: "close-call", name: "Close call", ok: true, elapsed_ms: 850, meta: meta("jev-1.2", 800, 400, 20, 0.0004, "sdk", 4), trace: {},
    results: {
      intent: { ok: true, checks: [], answer: { type: "choice", choice: "refund", probabilities: { refund: 0.52, replacement: 0.4, question: 0.08 }, confidence: 0.6 } },
      urgent: { ok: true, checks: [], answer: { type: "noul", noul: 0.47 } },
      quality: { ok: true, checks: [], answer: { type: "score", score: 1.9, probabilities: { 0: 0.02, 1: 0.06, 2: 0.92 }, confidence: 0.8 } },
      damage: { ok: true, checks: [], answer: { type: "box", box: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.5 }, confidence: 0.9 } },
    } },
  { id: "wrong-pick", name: "Wrong pick", ok: false, elapsed_ms: 320, meta: meta("jev-1.1", 300, 260, 30, 0.0002, "stdlib", 4), trace: {},
    results: {
      route: { ok: false, checks: [], answer: { type: "choice", choice: "support", probabilities: { sales: 0.3, support: 0.7 }, confidence: 0.7 } },
      spam: { ok: false, checks: [], answer: { type: "noul", noul: 0.25 } },
      stain: { ok: false, checks: [], answer: { type: "box", box: { left: 0.6, top: 0.6, right: 0.9, bottom: 0.9 }, confidence: 0.4 } },
      extra: { ok: false, checks: ["missing answer"], answer: null },
    } },
  { id: "rate-limited", name: "Rate limited", ok: false, error: "Local rate limit: more than 30 live calls in the last minute. Wait a moment.", results: {}, elapsed_ms: 1.5 },
  { id: "key-rejected", name: "Key rejected", ok: false, error: "TypeSafe rejected the API key (401): invalid key", results: {}, elapsed_ms: 210 },
  { id: "bad-bounds", name: "Bad bounds", ok: false, elapsed_ms: 260, meta: meta("jev-1.2", 250, 90, 4, 0.00008, "sdk", 1), trace: {},
    results: { urgent: { ok: false, checks: [], answer: { type: "noul", noul: 0.6 } } } },
];

const ctx = (overrides) => sampleTestsItemsCtx(overrides);
const all = () => ctx({ filters: {} });
const combined = () => {
  const items = [...sampleTestsRaw(), ...EXTRA_RAW];
  const batch = sampleTestsBatch();
  return ctx({ items, filters: {}, results: mergeTestResults(null, { ...batch, runs: [...batch.runs, ...EXTRA_RUNS], cost_usd: 0.00134 }, items) });
};
// One more batch that reruns bean-quality for $0.0001: session spend $0.00076, latest calls $0.00061.
const rerun = () => {
  const items = sampleTestsRaw();
  const bean = sampleTestsBatch().runs[1];
  const results = mergeTestResults(sampleTestsResults(items), { runs: [{ ...bean, meta: { ...bean.meta, cost_usd: 0.0001 } }], passed: 0, failed: 1, wall_ms: 700, cost_usd: 0.0001 }, items);
  return ctx({ items, results });
};
// Twins: the refund and bean tests again with other ids (the bean state with its keys in another order) and pictures.
const twins = () => {
  const [refund, bean, damaged] = sampleTestsRaw();
  return ctx({ results: null, filters: {}, items: [refund, { ...refund, id: "refund-b", images: { photo: { file: "0123456789abcdef.png" } } }, bean,
    { ...bean, id: "bean-b", state: { stars: 2, review: bean.state.review }, images: { photo: { file: "fedcba9876543210.jpg" } } }, damaged] });
};
// A saved test whose expectation is a bare number: the server's check fails on it (TypeError), so it is invalid.
const numberExpect = () => {
  const items = [{ id: "number-expect", name: "Number expect", state: "Hello", questions: { urgent: { type: "noul", instructions: "Urgent?" } }, expect: { urgent: 5 } }];
  const run = { id: "number-expect", name: "Number expect", ok: false, elapsed_ms: 90, meta: meta("jev-1.2", 80, 40, 3, 0.00003, "sdk", 1), trace: {},
    results: { urgent: { ok: false, checks: [], answer: { type: "noul", noul: 0.9 } } } };
  return ctx({ items, filters: {}, results: mergeTestResults(null, { runs: [run], passed: 0, failed: 1, wall_ms: 90, cost_usd: 0.00003 }, items) });
};
const passOnly = () => ctx({ filters: { status: "pass" } });   // refund-routing only
const failOnly = () => ctx({ filters: { status: "fail" } });   // bean-quality and latte-art-feedback
const notRun = () => ctx({ results: null });
const noTests = () => ctx({ items: [], results: null });
const detail = (value, pattern) => (result) => { assert.equal(result.value, value); assert.match(result.detail, pattern); };
const near = (value, pattern) => (result) => { assert.ok(Math.abs(result.value - value) < 1e-12, `expected ${value}, got ${result.value}`); if (pattern) assert.match(result.detail, pattern); };

// Shown by default: refund (pass), bean (fail), damaged (error), wholesale and unnamed (not run); latte is hidden.
// Wilson 95% intervals computed separately in Python: 1/2 -> 9.5%..90.5%, 1/3 -> 6.1%..79.2%, 2/3 -> 20.8%..93.9%, 3/5 -> 23.1%..88.2%,
// 0/2 -> 0.0%..65.8% (the same script gives the published 0/10 -> 0..27.75% and 5/10 -> 23.66%..76.34%).
checkPack(pack, {
  test_pass_rate: [{ ctx: ctx(), expect: detail(0.5, /^1 of 2 tests; 95% interval 9\.5% to 90\.5%; 1 call error left out$/), empty: notRun() },
    { ctx: all(), expect: near(1 / 3, /^1 of 3 tests; 95% interval 6\.1% to 79\.2%/) },
    { ctx: failOnly(), expect: detail(0, /^0 of 2 tests; 95% interval 0\.0% to 65\.8%$/) }],
  check_pass_interval: [{ ctx: ctx(), expect: detail("20.8% to 93.9%", /^2 of 3 checks passed \(66\.7%\)$/), empty: notRun() },
    { ctx: all(), expect: "23.1% to 88.2%" }, { ctx: failOnly(), expect: detail("6.1% to 79.2%", /^1 of 3 checks passed \(33\.3%\)$/) }],
  pass_rate_by_type: [{ ctx: ctx(), expect: detail("choice 1/1 · noul 1/1 · score 0/1", /^3 checked questions$/), empty: notRun() }, { ctx: all(), expect: "choice 1/1 · noul 2/2 · score 0/1" }],
  failures_by_kind: [{ ctx: ctx(), expect: "below min 1", empty: notRun() }, { ctx: all(), expect: "below min 1 · unknown question 1" },
    { ctx: combined(), expect: detail("above max 1 · below min 1 · invalid expectation 1 · low overlap 1 · missing answer 1 · unknown question 1 · wrong choice 1", /^7 failures$/) },
    { ctx: passOnly(), expect: "no failed checks" }, { ctx: numberExpect(), expect: "invalid expectation 1" }],
  // Combined: every failing ID failed once; quality is 1/2 and urgent 1/3, so the 1/1 IDs come first, A to Z.
  most_failed_ids: [{ ctx: ctx(), expect: "quality 1/1", empty: notRun() }, { ctx: all(), expect: "old_question 1/1 · quality 1/1" },
    { ctx: combined(), expect: detail("extra 1/1 · old_question 1/1 · route 1/1", /^7 IDs failed at least once$/) }, { ctx: passOnly(), expect: "no failed checks" }],
  // Latte's tone is the one answer of five with no expectation.
  unchecked_share: [{ ctx: ctx(), expect: 0, empty: notRun() }, { ctx: all(), expect: 0.2 }],
  // Close-call's intent held its min by 0.52 - 0.50 = 0.02; the other six passed bounds held by 0.07 or more.
  close_passes: [{ ctx: ctx(), expect: detail(0, /^of 2 passed checks with a bound$/), empty: notRun() }, { ctx: combined(), expect: detail(1, /^of 7 passed checks with a bound$/) }],
  // Expected options: refund 0.91, refund 0.52, sales 0.3.
  mean_expected_probability: [{ ctx: ctx(), expect: 0.91, empty: notRun() }, { ctx: combined(), expect: near((0.91 + 0.52 + 0.3) / 3, /^3 Choice answers$/) }],
  // (0.91-1)^2 + 0.06^2 + 0.03^2 = 0.0126; (0.52-1)^2 + 0.4^2 + 0.08^2 = 0.3968; (0.3-1)^2 + 0.7^2 = 0.98.
  choice_brier: [{ ctx: ctx(), expect: 0.0126, empty: notRun() }, { ctx: combined(), expect: near((0.0126 + 0.3968 + 0.98) / 3) }],
  // Type-7 quantile: 412.5 + 0.9 * (655 - 412.5) = 630.75; with 980: 655 + 0.8 * 325 = 915.
  latency_p90: [{ ctx: ctx(), expect: 630.75, empty: notRun() }, { ctx: all(), expect: 915 }],
  // (2 q, 412.5 ms) and (1 q, 655 ms): -242.5 ms per question. With (2 q, 980 ms): Sxy = 27.5, Sxx = 2/3 -> 41.25.
  latency_slope: [{ ctx: ctx(), expect: -242.5, empty: notRun() }, { ctx: all(), expect: 41.25 }, { ctx: passOnly(), expect: null }],
  latest_spend: [{ ctx: ctx(), expect: 0.00036, tolerance: 1e-15, empty: notRun() }, { ctx: all(), expect: 0.00066, tolerance: 1e-15 }],
  median_spend: [{ ctx: ctx(), expect: 0.00018, tolerance: 1e-15, empty: notRun() }, { ctx: all(), expect: 0.00021, tolerance: 1e-15 }],
  // $0.00036 over 2 + 1 questions; $0.00066 over 2 + 1 + 2.
  spend_per_question: [{ ctx: ctx(), expect: 0.00012, tolerance: 1e-15, empty: notRun() }, { ctx: all(), expect: 0.000132, tolerance: 1e-15 }],
  // Combined calls: 0.0004, 0.0003, 0.00021 of 0.00134 in all -> 0.00091 / 0.00134.
  spend_concentration: [{ ctx: combined(), expect: near(0.00091 / 0.00134, /^of 6 calls$/), empty: notRun() }, { ctx: ctx(), expect: null }],
  superseded_spend: [{ ctx: rerun(), expect: 0.00015, tolerance: 1e-15, empty: notRun() }, { ctx: ctx(), expect: 0 }],
  // (180 + 140) / 3; (180 + 140 + 220) / 5.
  input_tokens_per_question: [{ ctx: ctx(), expect: 320 / 3, empty: notRun() }, { ctx: all(), expect: 108 }],

  // Authored. Shown by default: refund (choice, noul), bean (score), damaged (box, noul), wholesale (choice, noul), unnamed (none).
  // Damaged's torn has no expectation; wholesale's {} counts as coverage; latte's tone has none.
  coverage_by_type: [{ ctx: ctx(), expect: detail("box 1/1 · choice 2/2 · noul 2/3 · score 1/1", /^6 of 7 question occurrences covered$/), empty: noTests() }, { ctx: all(), expect: "box 1/1 · choice 2/2 · noul 3/4 · score 1/2" }],
  questions_per_test: [{ ctx: ctx(), expect: detail(2, /^largest 2$/), empty: noTests() }, { ctx: failOnly(), expect: 1.5 }],
  options_per_choice: [{ ctx: ctx(), expect: 2.5, empty: noTests() }, { ctx: passOnly(), expect: 3 }],
  levels_per_score: [{ ctx: ctx(), expect: 3, empty: noTests() }, { ctx: all(), expect: 3.5 }],
  distinct_inputs: [{ ctx: ctx(), expect: detail(5, /^of 5 tests$/), empty: noTests() }, { ctx: twins(), expect: detail(3, /^of 5 tests$/) }],
  distinct_pictures: [{ ctx: ctx(), expect: detail(1, /^1 reference; 1 sample, 0 uploads$/), empty: noTests() }, { ctx: twins(), expect: detail(3, /^3 references; 1 sample, 2 uploads$/) },
    { ctx: passOnly(), expect: 0 }],
}, { ctx: () => ctx() });

test("tests-suite-metrics: session metrics are unavailable before a run and no metric throws on an empty page", () => {
  const authored = new Set(["coverage_by_type", "questions_per_test", "options_per_choice", "levels_per_score", "distinct_inputs", "distinct_pictures"]);
  const rows = runMetrics(pack.features.map((feature) => [feature.id, feature]), notRun());
  for (const row of rows) {
    assert.ok(!row.detail.startsWith("Could not compute"), row.detail);
    if (!authored.has(row.key)) assert.equal(row.value, null, `${row.key} should be unavailable before a run`);
  }
  for (const row of runMetrics(pack.features.map((feature) => [feature.id, feature]), noTests())) assert.equal(row.value, null, row.key);
});

test("tests-suite-metrics: no metric shows inputs, instructions, expectation values, chosen options or error text", () => {
  const text = runMetrics(pack.features.map((feature) => [feature.id, feature]), combined()).map((row) => `${row.text} ${row.detail}`).join("\n");
  for (const banned of ["refund", "support", "sales", "high", "Local rate limit", "rejected", "Budget reached", "Unhappy", "customer.example", "0.6", "Money back"]) {
    assert.ok(!text.includes(banned), `a metric shows ${banned}`);
  }
});

test("tests-suite-metrics: odd shown items give unavailable values, never an exception or NaN", () => {
  const odd = [null, 7, "x", {}, { result: "done" }, { status: "pass", result: { checks: "none" } }, { questions: "q", images: "i", result: { error: 42 } },
    { result: { checks: [null, 3, { question: true, ok: false, answer: { type: "box", box: null } }], meta: { question_count: 0, latency_ms: "9", cost_usd: Infinity } } }];
  const page = { shown: () => odd, items: () => odd, data: { results: null } };
  for (const feature of pack.features) {
    const result = feature.compute(page);
    const value = result && typeof result === "object" ? result.value : result;
    assert.ok(value === null || value === undefined || typeof value === "string" || Number.isFinite(value), `${feature.id} gave ${value}`);
  }
  for (const feature of pack.features) assert.doesNotThrow(() => feature.compute({}), feature.id);
});
