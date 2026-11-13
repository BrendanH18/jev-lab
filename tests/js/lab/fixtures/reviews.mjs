// Fixtures for packs on the Reviews page's Lab surfaces (contract: static/js/lab/surfaces/reviews.js). Every ctx is
// made by the page's own builders from hand-written data: a fictional Harbor Coffee Co. session with three checks.
// The answers are made up for tests; nothing here came from the model.
//
//   sampleReviewsExamplesCtx(overrides)  "reviews.examples": six examples, the form holding "Flat beans" (index 1)
//   sampleReviewsResultCtx(overrides)    "reviews.result": the latest check of "Flat beans", re-decided to reply/P2
//
// overrides replace fields of the builder's source (setup, draft, result, settings, history, calls, running, note,
// matches, arrange, ...). For example { result: null, history: [], calls: 0 } is a page before its first check,
// { setup: null } a page whose setup has not loaded, and { matches: (item) => item.id !== "tone" } a page whose Lab
// filters hide an answer. Each ctx also carries, for tests only:
//   ctx.env    fakeEnv() from harness.mjs (toasts, copied, downloads)
//   ctx.log    every page operation an action reached, as [name, ...args]
//   ctx.state  the fixture's mutable page state: setPolicy/resetPolicy change state.settings, setStars changes
//              state.draft.stars (and the result's stars), use(index) loads an example and clears state.result.
import { reviewsExamplesCtx, reviewsResultCtx } from "../../../../static/js/lab/surfaces/reviews.js";
import { fakeEnv } from "../harness.mjs";

export const REVIEWS_POLICY = Object.freeze({ safety_at: 0.5, about_us_min: 0.5, wants_reply_at: 0.5, p1_at: 2, p2_at: 1, mismatch_gap: 2, thank_tone_at: 3 });
export const REVIEWS_TOPIC_LABELS = Object.freeze({
  roast_flavor: "Roast and flavor", freshness: "Freshness", packaging_shipping: "Packaging and shipping", delivery_timing: "Delivery timing",
  cafe_service: "Café service", subscription_billing: "Subscription and billing", equipment: "Equipment", other: "Other",
});
export const REVIEWS_FLAG_LABELS = Object.freeze({ safety: "Safety risk", not_about_us: "Not about us", rating_mismatch: "Stars disagree with words" });

const FLAT_BEANS = "The bag that came last week was roasted almost three months ago. Flat, papery taste and no crema. Could you send a fresh bag?";
const WARM = "Best flat white in town. The barista remembered my name and the croissant was still warm.";

// Six examples: every channel, an empty subject, a missing subject and label, odd stars, an unknown channel, and one
// with no expectation.
export function sampleReviewsSetup() {
  return {
    examples: [
      { label: "Warm welcome", stars: 5, channel: "maps", about: "Pier Street café", text: WARM, expect: { action: "thank", team: "cafes", flags: [] } },
      { label: "Flat beans", stars: 2, channel: "website", about: "Harbor House Blend, 340 g bag", text: FLAT_BEANS,
        expect: { action: "reply", team: "roasting", flags: [] } },
      { label: "Scalded wrist", stars: 1, channel: "app", about: "Pier Street café",
        text: "The lid popped off my takeaway latte and hot milk went over my wrist. I have a blister now.",
        expect: { action: "escalate", team: "quality_safety", flags: ["safety"] } },
      { label: "Five stars, angry", stars: 5, channel: "website", about: "Harbor Burr Grinder",
        text: "Total waste of $180. The burrs squeal after one week. Do not buy this.",
        expect: { action: "reply", team: "equipment_support", flags: ["rating_mismatch"] } },
      { label: "Phone repair ad", stars: 5, channel: "maps", about: "",
        text: "Cracked screen? Quickfix Phones on Elm Road fixes it while you wait at quickfix.example!",
        expect: { action: "moderate", team: "moderation", flags: ["not_about_us"] } },
      { label: "", stars: "3", channel: "fax", text: "  Fine.  " },
    ],
    policy: { ...REVIEWS_POLICY },
    teams: { quality_safety: "Quality & safety", moderation: "Moderation", roasting: "Roasting", fulfillment: "Fulfillment", cafes: "Cafés",
      billing: "Billing", equipment_support: "Equipment support", customer_care: "Customer care" },
    topic_teams: { roast_flavor: "roasting", freshness: "roasting", packaging_shipping: "fulfillment", delivery_timing: "fulfillment",
      cafe_service: "cafes", subscription_billing: "billing", equipment: "equipment_support", other: "customer_care" },
    channels: { website: "Website review", app: "App store review", maps: "Map listing" },
    actions: { escalate: "Escalate to quality & safety", moderate: "Hold for moderation", reply: "A person replies", thank: "Thank-you template", log: "Log only" },
  };
}

const SEVERITY = ["No problem: praise or a neutral remark", "Minor annoyance: something was off", "Real problem: it cost the customer money, time, or product",
  "Safety or health risk: an injury, burn, illness, or foreign object"];
const TONE = ["Very negative: angry", "Negative: disappointed", "Mixed or neutral", "Positive: pleased", "Very positive: delighted"];
const legend = (levels) => Object.fromEntries(levels.map((text, index) => [String(index), text]));

export function sampleReviewsQuestions() {
  const yesNo = (yes, no) => ({ true: { what: yes, examples: [] }, false: { what: no, examples: [] } });
  return {
    topic: { type: "choice", instructions: "What is `review.text` mainly about?", criteria: { ...REVIEWS_TOPIC_LABELS } },
    severity: { type: "score", instructions: "How serious is the problem that `review.text` describes?", criteria: [...SEVERITY] },
    tone: { type: "score", instructions: "How does `review.text` feel about Harbor Coffee Co., judged from its words alone?", criteria: [...TONE] },
    safety: { type: "noul", instructions: "Does `review.text` report that someone was hurt or made ill?", criteria: yesNo("Someone was hurt", "Nobody was hurt") },
    wants_reply: { type: "noul", instructions: "Does the writer of `review.text` ask Harbor Coffee Co. for a reply, refund, replacement, or contact?",
      criteria: yesNo("Asks for something back", "Only shares an opinion") },
    about_us: { type: "noul", instructions: "Is `review.text` about Harbor Coffee Co.'s own coffee, cafés, shop, or service?",
      criteria: yesNo("About the shop", "Spam or another business") },
  };
}

// Made-up answers in the API's shape, for the "Flat beans" review.
export function sampleReviewsAnswers() {
  return {
    topic: { type: "choice", choice: "freshness", confidence: 0.81, probabilities: { freshness: 0.81, roast_flavor: 0.12, packaging_shipping: 0.03,
      delivery_timing: 0.01, cafe_service: 0.01, subscription_billing: 0.005, equipment: 0.005, other: 0.01 } },
    severity: { type: "score", score: 1.62, confidence: 0.6, legend: legend(SEVERITY), probabilities: { 0: 0.05, 1: 0.3, 2: 0.6, 3: 0.05 } },
    tone: { type: "score", score: 1.05, confidence: 0.8, legend: legend(TONE), probabilities: { 0: 0.08, 1: 0.8, 2: 0.1, 3: 0.01, 4: 0.01 } },
    safety: { type: "noul", noul: 0.02 },
    wants_reply: { type: "noul", noul: 0.93 },
    about_us: { type: "noul", noul: 0.98 },
  };
}

// The triage jev/reviews.py gives those answers with 2 stars and the fixture's policy (wants_reply_at 0.6).
export function sampleReviewsTriage() {
  return {
    action: "reply", action_label: "A person replies", team: "roasting", team_label: "Roasting", priority: "P2", flags: [],
    checks: [
      { id: "safety", ok: true, level: "ok", label: "No safety or health risk", detail: "2% that it reports an injury, illness, or foreign object (escalate at 50%)" },
      { id: "about_us", ok: true, level: "ok", label: "About Harbor Coffee Co.", detail: "98% that it is about the shop (hold below 50%)" },
      { id: "topic", ok: true, level: "ok", label: "Routed by topic", detail: "freshness (81%) goes to Roasting" },
      { id: "severity", ok: false, level: "reply", label: "No real problem reported", detail: "Severity 1.62 of 3 is P2 (P1 at 2.0, P2 at 1.0)" },
      { id: "wants_reply", ok: false, level: "reply", label: "No reply requested", detail: "93% that the reviewer asks for a reply, refund, or contact (reply at 60%)" },
      { id: "rating", ok: true, level: "ok", label: "Stars match the words", detail: "2 stars sit at level 1; the words read 1.05 of 4, 0.05 levels apart (flag at 2.0)" },
    ],
    reasons: ["A person replies: the reviewer asks for a reply; severity 1.62 is at or above the P2 cut"],
    auto_reply_allowed: false,
    evidence: { topic: "freshness", topic_prob: 0.81, topics: [{ value: "freshness", prob: 0.81 }, { value: "roast_flavor", prob: 0.12 }, { value: "packaging_shipping", prob: 0.03 }],
      severity: 1.62, tone: 1.05, safety: 0.02, wants_reply: 0.93, about_us: 0.98, stars: 2, rating_gap: 0.05 },
  };
}

const meta = (latency, cost, input) => ({ model: "jev-1.16", latency_ms: latency, question_count: 6, input_tokens: input, output_tokens: 60, cost_usd: cost, backend: "sdk" });

export function sampleReviewsResult() {
  const review = { stars: 2, channel: "website", about: "Harbor House Blend, 340 g bag", text: FLAT_BEANS };
  const questions = sampleReviewsQuestions();
  const answers = sampleReviewsAnswers();
  const callMeta = meta(700, 0.00042, 1450);
  return {
    review,
    answers,
    triage: sampleReviewsTriage(),
    policy: { ...REVIEWS_POLICY, wants_reply_at: 0.6 },
    meta: callMeta,
    trace: { request: { state: { shop: "Harbor Coffee Co., a small coffee roaster", review: { channel: "Website review", text: FLAT_BEANS, about: review.about } }, questions },
      response: { answers }, meta: callMeta },
  };
}

// Three answered checks: "Warm welcome", then "Flat beans" twice (3 stars the second time; the user then moved the
// stars back to 2, which re-decided without a call). The last one is the shown result.
export function sampleReviewsHistory(result = sampleReviewsResult()) {
  return [
    { call: 1, at: 1_700_000_000_000, review: { stars: 5, channel: "maps", about: "Pier Street café", text: WARM },
      answers: { ...sampleReviewsAnswers(), topic: { type: "choice", choice: "cafe_service", confidence: 0.9, probabilities: { cafe_service: 0.9, other: 0.1 } } },
      meta: meta(820, 0.00041, 1400) },
    { call: 2, at: 1_700_000_060_000, review: { ...result.review }, answers: sampleReviewsAnswers(), meta: meta(760, 0.00043, 1460) },
    { call: 3, at: 1_700_000_120_000, review: { ...result.review, stars: 3 }, answers: result.answers, meta: result.meta },
  ];
}

function sampleState(overrides) {
  const setup = sampleReviewsSetup();
  const result = sampleReviewsResult();
  const flat = setup.examples[1];
  return {
    setup,
    draft: { stars: flat.stars, channel: flat.channel, about: flat.about, text: flat.text },
    result,
    settings: { ...result.policy },
    history: sampleReviewsHistory(result),
    calls: 3,
    running: false,
    note: "Re-decided in 3 ms · no Jev call",
    ...overrides,
  };
}

// The page's operations as the fixture's page performs them, recording each in log.
function pageOperations(state, log) {
  return {
    use: (index) => {
      log.push(["use", index]);
      const example = state.setup.examples[index];
      state.draft = { stars: example.stars, channel: example.channel, about: example.about || "", text: example.text };
      state.result = null;
    },
    focusText: () => { log.push(["focusText"]); },
    focusRun: () => { log.push(["focusRun"]); },
    setPolicy: (next) => { log.push(["setPolicy", { ...next }]); state.settings = { ...next }; },
    resetPolicy: () => { log.push(["resetPolicy"]); state.settings = { ...state.setup.policy }; },
    setStars: (stars) => {
      log.push(["setStars", stars]);
      state.draft = { ...state.draft, stars };
      if (state.result) state.result = { ...state.result, review: { ...state.result.review, stars } };
    },
    focusPolicy: (key) => { log.push(["focusPolicy", key]); },
    inspect: () => { log.push(["inspect"]); },
  };
}

function sourceFor(state, log, refreshes) {
  const read = (name) => () => state[name];
  return {
    setup: read("setup"), draft: read("draft"), result: read("result"), settings: read("settings"), history: read("history"), calls: read("calls"),
    running: read("running"), note: read("note"), topicLabels: REVIEWS_TOPIC_LABELS, flagLabels: REVIEWS_FLAG_LABELS,
    refresh: () => { refreshes.count++; },
    ...pageOperations(state, log),
  };
}

function finish(ctx, state, log, refreshes) {
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  Object.defineProperty(ctx, "refreshes", { get: () => refreshes.count });
  return ctx;
}

// overrides: state fields (setup, draft, result, settings, history, calls, running, note) or source fields
// (matches, arrange, any page operation).
const STATE_KEYS = new Set(["setup", "draft", "result", "settings", "history", "calls", "running", "note"]);
function split(overrides) {
  const state = {}, source = {};
  for (const [key, value] of Object.entries(overrides || {})) (STATE_KEYS.has(key) ? state : source)[key] = value;
  return { state, source };
}

export function sampleReviewsExamplesCtx(overrides = {}) {
  const parts = split(overrides);
  const state = sampleState(parts.state), log = [], refreshes = { count: 0 };
  return finish(reviewsExamplesCtx({ ...sourceFor(state, log, refreshes), ...parts.source }), state, log, refreshes);
}

export function sampleReviewsResultCtx(overrides = {}) {
  const parts = split(overrides);
  const state = sampleState(parts.state), log = [], refreshes = { count: 0 };
  return finish(reviewsResultCtx({ ...sourceFor(state, log, refreshes), ...parts.source }), state, log, refreshes);
}
