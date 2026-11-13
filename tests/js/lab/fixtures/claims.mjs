// Fixtures for packs on the Claims page's Lab surfaces (contract: static/js/lab/surfaces/claims.js). Every ctx is made
// by the page's own builders from hand-written data: a fictional Harbor Coffee Co. session with four checks. The
// answers are made up for tests; nothing here came from the model.
//
//   sampleClaimsOrdersCtx(overrides)    "claims.orders": seven orders, A-1044 selected
//   sampleClaimsExamplesCtx(overrides)  "claims.examples": five examples, the form holding "Crushed box" (index 2)
//   sampleClaimsResultCtx(overrides)    "claims.result": the latest check, "Crushed box" on A-1044, six answers,
//                                       decided "review" (outside the window) after the user moved matches_note to 0.6
//
// The orders cover every status, an order already refunded, one delivered exactly 30 days ago, and A-1047 with a
// missing total, customer and delivery. The examples are the four built-in ones plus "Example 5" with no label, an
// unknown sample, a blank note and an invalid expectation. The history holds four checks: Torn bag (approve), Intact
// bag (retake), an upload on A-1042 answered by a model without Box (5 answers, review), and the shown Crushed box.
//
// overrides replace fields of the fixture page's state (setup, order, note, image, result, input, settings, history,
// calls, running, note2) or of the builder's source (matches, arrange, any page operation). For example
// { result: null, input: null, history: [], calls: 0 } is a page before its first check, { setup: null } a page whose
// setup has not loaded, { running: true } a page with a check on its way, and { matches: (item) => item.id !==
// "severity" } a page whose Lab filters hide an item. Each ctx also carries, for tests only:
//   ctx.env    fakeEnv() from harness.mjs (toasts, copied, downloads)
//   ctx.log    every page operation an action reached, as [name, ...args]
//   ctx.state  the fixture's mutable page state: select(id) changes state.order and clears state.result, use(index)
//              loads an example and clears state.result, setPolicy/resetPolicy change state.settings.
//   ctx.refreshes  how many times refresh() reached the page
import { claimsExamplesCtx, claimsOrdersCtx, claimsResultCtx } from "../../../../static/js/lab/surfaces/claims.js";
import { fakeEnv } from "../harness.mjs";

export const CLAIMS_POLICY = Object.freeze({ damage_yes: 0.7, damage_no: 0.3, shows_order: 0.5, matches_note: 0.5, full_refund_at: 1.5,
  auto_limit_usd: 100, box_confidence: 0.6 });
export const CLAIMS_KIND_LABELS = Object.freeze({
  torn_or_open: "Torn or open", crushed_or_dented: "Crushed or dented", broken_or_cracked: "Broken or cracked",
  spilled_or_leaking: "Spilled or leaking", none_visible: "None visible",
});
const KINDS = {
  torn_or_open: "A bag, seal, or wrapper is torn, split, or open",
  crushed_or_dented: "A box or item is crushed, dented, or bent",
  broken_or_cracked: "Something is cracked, shattered, or snapped",
  spilled_or_leaking: "Contents have spilled out or liquid has leaked",
  none_visible: "No damage is visible",
};
const SEVERITY = [
  "None: no visible damage",
  "Cosmetic: packaging is scuffed or dented but the product looks usable",
  "Partial: part of the product is spilled, broken, or unusable",
  "Total: the product is destroyed or entirely unusable",
];
const legend = () => Object.fromEntries(SEVERITY.map((text, index) => [String(index), text]));

const TORN = "One bag's seal was torn open and beans spilled all over the box.";
const INTACT = "The bag arrived ripped and half the beans fell out.";
const CRUSHED = "The kit's box came crushed on one corner.";
const GRINDER = "The grinder's hopper arrived cracked.";
const UPLOAD_NOTE = "The hopper cracked along the seam on day one.";

export function sampleClaimsSetup() {
  return {
    orders: [
      { id: "A-1041", order: "A-1041", items: "2 x Ethiopia Yirgacheffe, 12 oz bags", total: 38, status: "delivered", refunded: false, days_since_delivery: 3, customer: "Maya Chen" },
      { id: "A-1042", order: "A-1042", items: "Conical burr grinder", total: 249, status: "delivered", refunded: false, days_since_delivery: 12, customer: "Luis Ortega" },
      { id: "A-1043", order: "A-1043", items: "Espresso sampler box", total: 54, status: "in transit", refunded: false, days_since_delivery: null, customer: "Priya Nair" },
      { id: "A-1044", order: "A-1044", items: "Cold brew starter kit", total: 64, status: "delivered", refunded: false, days_since_delivery: 41, customer: "Tom Becker" },
      { id: "A-1045", order: "A-1045", items: "20 lb House Blend (wholesale)", total: 310, status: "processing", refunded: false, days_since_delivery: null, customer: "Northside Bistro" },
      { id: "A-1046", order: "A-1046", items: "Pour-over kettle", total: 72.5, status: "delivered", refunded: true, days_since_delivery: 30, customer: "Ada Brook" },
      { id: "A-1047", order: "A-1047", items: "Gift card", status: "processing", refunded: false, days_since_delivery: null },
    ],
    policy: { ...CLAIMS_POLICY },
    samples: [
      { name: "torn-bag", about: "A coffee bag with a torn seal and beans spilled on the counter", url: "/img/samples/torn-bag.png" },
      { name: "intact-bag", about: "The same kind of coffee bag, sealed and undamaged", url: "/img/samples/intact-bag.png" },
      { name: "crushed-box", about: "A shipping box with a crushed corner", url: "/img/samples/crushed-box.png" },
      { name: "grinder-ok", about: "A burr grinder with an intact hopper", url: "/img/samples/grinder-ok.png" },
    ],
    examples: [
      { label: "Torn bag", order: "A-1041", sample: "torn-bag", expect: "approve", note: TORN },
      { label: "Intact bag", order: "A-1041", sample: "intact-bag", expect: "retake", note: INTACT },
      { label: "Crushed box", order: "A-1044", sample: "crushed-box", expect: "review", note: CRUSHED },
      { label: "Grinder", order: "A-1042", sample: "grinder-ok", expect: "retake", note: GRINDER },
      { label: "", order: "A-1047", sample: "mystery", expect: "maybe", note: "   " },
    ],
  };
}

export function sampleClaimsQuestions({ box = true } = {}) {
  const questions = {
    shows_item: { type: "noul", instructions: "Does `photo` show the item described in `order.items`, or the packaging it was shipped in?",
      criteria: { true: "The product or its shipping packaging is visible", false: "The photo shows something unrelated, or nothing recognizable" } },
    damage_visible: { type: "noul", instructions: "Does `photo` show visible damage to the product or its packaging?",
      criteria: { true: { what: "Damage is visible", examples: ["a crushed box corner"] }, false: { what: "Everything visible looks intact", examples: ["a sealed, undamaged bag"] } } },
    severity: { type: "score", instructions: "How badly damaged is the product in `photo`?", criteria: [...SEVERITY] },
    damage_kind: { type: "choice", instructions: "What kind of damage does `photo` show?", criteria: { ...KINDS } },
    matches_note: { type: "noul", instructions: "Does `photo` show the problem described in `customer_note`?",
      criteria: { true: "The photo shows the same kind of problem the text describes", false: "The photo shows a different problem, or no problem" } },
  };
  if (box) questions.damage_box = { type: "box", instructions: "the most visibly damaged part of the product or its packaging in `photo`" };
  return questions;
}

// Made-up answers in the API's shape, in the request's question order.
function answersOf({ shows, damage, severity, sevProbs, sevConf, kind, kindProbs, kindConf, matches, box, boxConf }) {
  const answers = {
    shows_item: { type: "noul", noul: shows },
    damage_visible: { type: "noul", noul: damage },
    severity: { type: "score", score: severity, confidence: sevConf, legend: legend(), probabilities: sevProbs },
    damage_kind: { type: "choice", choice: kind, confidence: kindConf, probabilities: kindProbs },
    matches_note: { type: "noul", noul: matches },
  };
  if (box) answers.damage_box = { type: "box", box, confidence: boxConf };
  return answers;
}

const meta = (model, latency, cost, input, output, count = 6) => ({ model, latency_ms: latency, question_count: count, input_tokens: input,
  output_tokens: output, cost_usd: cost, backend: "sdk" });

// The shown check: "Crushed box" on A-1044.
export function sampleClaimsAnswers() {
  return answersOf({ shows: 0.94, damage: 0.81, severity: 1.2, sevProbs: { 0: 0.05, 1: 0.7, 2: 0.2, 3: 0.05 }, sevConf: 0.7,
    kind: "crushed_or_dented", kindProbs: { crushed_or_dented: 0.66, torn_or_open: 0.18, broken_or_cracked: 0.09, spilled_or_leaking: 0.02, none_visible: 0.05 }, kindConf: 0.66,
    matches: 0.62, box: { left: 0.55, top: 0.1, right: 0.95, bottom: 0.45 }, boxConf: 0.52 });
}

const FACTS = {
  "A-1041": { order: "A-1041", items: "2 x Ethiopia Yirgacheffe, 12 oz bags", total: 38, status: "delivered", refunded: false, days_since_delivery: 3, customer: "Maya Chen" },
  "A-1042": { order: "A-1042", items: "Conical burr grinder", total: 249, status: "delivered", refunded: false, days_since_delivery: 12, customer: "Luis Ortega" },
  "A-1044": { order: "A-1044", items: "Cold brew starter kit", total: 64, status: "delivered", refunded: false, days_since_delivery: 41, customer: "Tom Becker" },
};

// What jev/claims.py decides for the shown answers under the fixture's policy (matches_note moved to 0.6).
export function sampleClaimsVerdict() {
  return {
    decision: "review", remedy: "replacement_or_credit", amount: 32,
    checks: [
      { id: "not_refunded", ok: true, level: "ok", label: "Not already refunded", detail: "No previous refund" },
      { id: "window", ok: false, level: "review", label: "Within 30-day window", detail: "Delivered 41 days ago" },
      { id: "shows_item", ok: true, level: "ok", label: "Photo shows the order", detail: "94% that the photo shows this item or its packaging" },
      { id: "damage", ok: true, level: "ok", label: "Damage visible", detail: "81% that damage is visible" },
      { id: "matches_note", ok: true, level: "ok", label: "Matches the customer's description", detail: "62% that the photo shows the problem described" },
      { id: "auto_limit", ok: true, level: "ok", label: "Within the automatic limit", detail: "$32.00 against a $100.00 limit" },
    ],
    reasons: ["Delivered 41 days ago"],
  };
}

export function sampleClaimsResult() {
  const answers = sampleClaimsAnswers();
  const questions = sampleClaimsQuestions();
  const callMeta = meta("jev-1.16", 812, 0.000412, 1840, 96);
  return {
    answers,
    evidence: { shows_item: 0.94, damage: 0.81, severity: 1.2, kind: "crushed_or_dented", kind_prob: 0.66,
      kinds: [{ value: "crushed_or_dented", prob: 0.66 }, { value: "torn_or_open", prob: 0.18 }, { value: "broken_or_cracked", prob: 0.09 }], matches_note: 0.62 },
    facts: { ...FACTS["A-1044"] },
    location: { shown: true, box: { left: 0.5, top: 0.05, right: 1, bottom: 0.5 }, confidence: 0.52, padded: true, tentative: false,
      reason: "Padded by 5% on each side: confidence 52% is below 60%." },
    verdict: sampleClaimsVerdict(),
    policy: { ...CLAIMS_POLICY, matches_note: 0.6 },
    box_supported: true,
    image: { format: "png", width: 640, height: 480, bytes: 18432 },
    meta: callMeta,
    trace: {
      request: { state: { shop: "Harbor Coffee Co., a small coffee roaster", order: { id: "A-1044", items: "Cold brew starter kit" }, customer_note: CRUSHED,
        photo: "photo-3fa2c81d90be" }, model: "jev-1.16", questions,
      assets: { "photo-3fa2c81d90be": { type: "image", format: "png", data_base64: "<PNG 640x480, 18 KB, omitted from this view>", sample: "crushed-box" } } },
      response: { model: "jev-1.16", answers, usage: { input_tokens: 1840, output_tokens: 96 } },
      meta: callMeta,
    },
  };
}

const sample = (name, about) => ({ source: "sample", name, about });

// Four answered checks, oldest first. The last is the shown result, recorded before the user moved matches_note.
export function sampleClaimsHistory(result = sampleClaimsResult()) {
  const setup = sampleClaimsSetup();
  const about = (name) => setup.samples.find((entry) => entry.name === name).about;
  const tornAnswers = answersOf({ shows: 0.97, damage: 0.93, severity: 2.1, sevProbs: { 0: 0.02, 1: 0.13, 2: 0.6, 3: 0.25 }, sevConf: 0.6,
    kind: "torn_or_open", kindProbs: { torn_or_open: 0.78, spilled_or_leaking: 0.15, crushed_or_dented: 0.04, broken_or_cracked: 0.01, none_visible: 0.02 }, kindConf: 0.78,
    matches: 0.91, box: { left: 0.2, top: 0.3, right: 0.7, bottom: 0.8 }, boxConf: 0.74 });
  const intactAnswers = answersOf({ shows: 0.95, damage: 0.08, severity: 0.1, sevProbs: { 0: 0.9, 1: 0.08, 2: 0.01, 3: 0.01 }, sevConf: 0.9,
    kind: "none_visible", kindProbs: { none_visible: 0.88, torn_or_open: 0.06, crushed_or_dented: 0.03, broken_or_cracked: 0.02, spilled_or_leaking: 0.01 }, kindConf: 0.88,
    matches: 0.05, box: { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 }, boxConf: 0.2 });
  const uploadAnswers = answersOf({ shows: 0.9, damage: 0.76, severity: 1.8, sevProbs: { 0: 0.05, 1: 0.25, 2: 0.55, 3: 0.15 }, sevConf: 0.55,
    kind: "broken_or_cracked", kindProbs: { broken_or_cracked: 0.7, crushed_or_dented: 0.2, torn_or_open: 0.05, spilled_or_leaking: 0.03, none_visible: 0.02 }, kindConf: 0.7,
    matches: 0.85 });
  const verdict = (decision, remedy, amount) => ({ decision, remedy, amount, checks: [], reasons: [] });
  return [
    { call: 1, at: 1_700_000_000_000, input: { order: "A-1041", note: TORN, photo: sample("torn-bag", about("torn-bag")) }, answers: tornAnswers,
      evidence: { shows_item: 0.97, damage: 0.93, severity: 2.1, kind: "torn_or_open", kind_prob: 0.78, kinds: [], matches_note: 0.91 },
      facts: { ...FACTS["A-1041"] }, verdict: verdict("approve", "full_refund", 38), policy: { ...CLAIMS_POLICY },
      meta: meta("jev-1.16", 790, 0.000398, 1830, 94), box_supported: true },
    { call: 2, at: 1_700_000_045_000, input: { order: "A-1041", note: INTACT, photo: sample("intact-bag", about("intact-bag")) }, answers: intactAnswers,
      evidence: { shows_item: 0.95, damage: 0.08, severity: 0.1, kind: "none_visible", kind_prob: 0.88, kinds: [], matches_note: 0.05 },
      facts: { ...FACTS["A-1041"] }, verdict: verdict("retake", "replacement_or_credit", 19), policy: { ...CLAIMS_POLICY },
      meta: meta("jev-1.16", 905, 0.000401, 1835, 95), box_supported: true },
    { call: 3, at: 1_700_000_120_000, input: { order: "A-1042", note: UPLOAD_NOTE, photo: { source: "upload", name: "hopper-crack.jpg", about: "" } },
      answers: uploadAnswers, evidence: { shows_item: 0.9, damage: 0.76, severity: 1.8, kind: "broken_or_cracked", kind_prob: 0.7, kinds: [], matches_note: 0.85 },
      facts: { ...FACTS["A-1042"] }, verdict: verdict("review", "full_refund", 249), policy: { ...CLAIMS_POLICY },
      meta: meta("jev-1.12", 1104, 0.000356, 1620, 80, 5), box_supported: false },
    { call: 4, at: 1_700_000_200_000, input: { order: "A-1044", note: CRUSHED, photo: sample("crushed-box", about("crushed-box")) }, answers: result.answers,
      evidence: result.evidence, facts: result.facts, verdict: { ...result.verdict }, policy: { ...CLAIMS_POLICY }, meta: result.meta, box_supported: true },
  ];
}

function sampleState(overrides) {
  const setup = sampleClaimsSetup();
  const result = sampleClaimsResult();
  const crushed = setup.examples[2];
  const image = { sample: "crushed-box", url: "/img/samples/crushed-box.png", about: setup.samples[2].about };
  return {
    setup,
    order: crushed.order,
    note: crushed.note,
    image,
    result,
    input: { order: crushed.order, note: crushed.note, photo: sample("crushed-box", setup.samples[2].about) },
    settings: { ...result.policy },
    history: sampleClaimsHistory(result),
    calls: 4,
    running: false,
    note2: "Re-decided in 2 ms · no Jev call",
    ...overrides,
  };
}

// The page's operations as the fixture's page performs them, recording each in log.
function pageOperations(state, log) {
  return {
    select: (id) => { log.push(["select", id]); state.order = id; state.result = null; state.input = null; },
    focusOrder: () => { log.push(["focusOrder"]); },
    use: (index) => {
      log.push(["use", index]);
      const example = state.setup.examples[index];
      const picked = state.setup.samples.find((entry) => entry.name === example.sample);
      state.order = example.order;
      state.note = example.note;
      state.image = picked ? { sample: picked.name, url: picked.url, about: picked.about } : null;
      state.result = null;
      state.input = null;
    },
    focusNote: () => { log.push(["focusNote"]); },
    focusRun: () => { log.push(["focusRun"]); },
    setPolicy: (next) => { log.push(["setPolicy", { ...next }]); state.settings = { ...next }; },
    resetPolicy: () => { log.push(["resetPolicy"]); state.settings = { ...state.setup.policy }; },
    focusPolicy: (key) => { log.push(["focusPolicy", key]); },
    inspect: () => { log.push(["inspect"]); },
  };
}

const STATE_KEYS = new Set(["setup", "order", "note", "image", "result", "input", "settings", "history", "calls", "running", "note2"]);

function build(builder, overrides, wire) {
  const stateOverrides = {}, sourceOverrides = {};
  for (const [key, value] of Object.entries(overrides || {})) (STATE_KEYS.has(key) ? stateOverrides : sourceOverrides)[key] = value;
  const state = sampleState(stateOverrides);
  const log = [];
  const refreshes = { count: 0 };
  const read = (name) => () => state[name];
  const source = {
    setup: read("setup"), running: read("running"), history: read("history"), calls: read("calls"), settings: read("settings"), result: read("result"),
    refresh: () => { refreshes.count++; },
    ...wire(state, read),
    ...pageOperations(state, log),
    ...sourceOverrides,
  };
  const ctx = builder(source);
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  Object.defineProperty(ctx, "refreshes", { get: () => refreshes.count });
  return ctx;
}

export function sampleClaimsOrdersCtx(overrides = {}) {
  return build(claimsOrdersCtx, overrides, (state, read) => ({ selected: read("order") }));
}

export function sampleClaimsExamplesCtx(overrides = {}) {
  return build(claimsExamplesCtx, overrides, (state, read) => ({ selected: read("order"),
    draft: () => ({ order: state.order, note: state.note, image: state.image }) }));
}

export function sampleClaimsResultCtx(overrides = {}) {
  return build(claimsResultCtx, overrides, (state, read) => ({ input: read("input"), note: read("note2"), kindLabels: CLAIMS_KIND_LABELS }));
}
