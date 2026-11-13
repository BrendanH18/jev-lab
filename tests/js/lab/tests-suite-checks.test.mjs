import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tests-suite-checks.js";
import { runDiagnostics } from "../../../static/js/lab/kit.js";
import { mergeTestResults } from "../../../static/js/test-selection.js";
import { checkPack } from "./harness.mjs";
import { sampleTestsItemsCtx, TESTS_STATUS } from "./fixtures/workbench-tests.mjs";

const ctx = (overrides) => sampleTestsItemsCtx(overrides);
const FIXTURE = ctx({ filters: {} });
const T = Object.fromEntries(FIXTURE.items().map((item) => [item.id, item]));
const R = T["refund-routing"], B = T["bean-quality"], D = T["damaged-bag-photo"], W = T["wholesale-inquiry"], L = T["latte-art-feedback"], U = T["unnamed-draft"];
const ALL = [R, B, D, W, L, U];
// Items made by the real surface builder from hand-written raw saved tests (fictional data, nothing run).
const made = (...raws) => ctx({ items: raws, results: null, filters: {} }).items();
const one = (raw) => made(raw)[0];

const INTENT = { type: "choice", instructions: "What does the customer want?", criteria: { refund: "Money back", replacement: "A new bag", question: "Just asking" } };
const FOUR = { type: "choice", instructions: "Which roast?", criteria: { light: "Light", medium: "Medium", dark: "Dark", decaf: "Decaf" } };
const TWO = { type: "choice", instructions: "Which team should answer?", criteria: { sales: "Wholesale sales", support: "Customer support" } };
const URGENT = { type: "noul", instructions: "Does this need a reply today?" };
const QUALITY = { type: "score", instructions: "How happy is the reviewer?", criteria: ["Unhappy", "Mixed", "Happy"] };
const DAMAGE = { type: "box", instructions: "Where is the tear in `photo`?" };
const PHOTO = { photo: { sample: "torn-bag" } };
const STATE = "Order HC-1042 arrived stale. Dana (dana@customer.example)";
const saved = (id, extra = {}) => ({ id, name: id, saved_at: "2026-10-01T09:30:00Z", state: STATE, questions: { urgent: URGENT }, ...extra });
const box = (expect) => one(saved("box", { state: { photo: "photo" }, questions: { damage: DAMAGE }, expect: { damage: expect }, images: PHOTO }));
const choice = (question, expect) => one(saved("choice", { questions: { pick: question }, expect: { pick: expect } }));

const NESTED = (pad) => ({ a: [1, "x\n", null, true], b: { c: "\u{1F600}\u007f" }, pad: "y".repeat(pad) });
const fiveSamples = { a: { sample: "torn-bag" }, b: { sample: "torn-bag" }, c: { sample: "torn-bag" }, d: { sample: "torn-bag" }, e: { sample: "torn-bag" } };
const fourSamples = { a: { sample: "torn-bag" }, b: { sample: "torn-bag" }, c: { sample: "torn-bag" }, d: { sample: "torn-bag" } };

// The slug of this 80-character name, cut at 60 characters, as jev/workbench.py slugify writes it (computed with Python).
const LONG_NAME = "Harbor Coffee wholesale order for the Portside cafe, with a very long name indeed";
const LONG_ID = "harbor-coffee-wholesale-order-for-the-portside-cafe-with-a-v";

// Two tests with one request and the same expectations: one passed, one failed in a made-up session.
const TWIN_RAW = [
  saved("twin-a", { expect: { urgent: { min: 0.5 } } }),
  saved("twin-b", { expect: { urgent: { min: 0.5 } } }),
  saved("twin-c", { expect: { urgent: { min: 0.9 } } }),
];
const noulRun = (id, ok, value) => ({ id, name: id, ok, elapsed_ms: 400, meta: { model: "jev-1.2", latency_ms: 380, question_count: 1, input_tokens: 90, output_tokens: 5, cost_usd: 0.0001, backend: "sdk" },
  results: { urgent: { ok, checks: [`${value.toFixed(2)} ${ok ? "≥" : "<"} 0.50`], answer: { type: "noul", noul: value } } } });
const TWINS = ctx({ items: TWIN_RAW, filters: {}, results: mergeTestResults(null, { runs: [noulRun("twin-a", true, 0.55), noulRun("twin-b", false, 0.45), noulRun("twin-c", false, 0.55)], wall_ms: 900, cost_usd: 0.0003 }, TWIN_RAW) }).items();

checkPack(pack, {
  checks_nothing: {
    hit: [one(saved("no-expect")), one(saved("empty-expect", { expect: { urgent: {} } })), one(saved("ignored", { expect: { urgent: { choice: "yes" } } }))],
    // R and D check at least one question; U has no readable question, so there is nothing to call unchecked.
    miss: [R, D, U, one(saved("unreadable", { expect: { urgent: "yes" } }))], message: /^None of its 1 question has an expectation the run checks/ },
  partly_unchecked: { hit: [D, W, L], miss: [R, B, U], message: /^\d of \d questions unchecked: / },
  // 1/3 = 0.333…: a max of 0.3 is below it, 0.34 is not. With two options 1/2: 0.49 is below, 0.5 is not.
  choice_ceiling_below_chance: {
    hit: [choice(INTENT, { choice: "refund", max: 0.3 }), choice(TWO, { max: 0.49 })],
    miss: [choice(INTENT, { max: 0.34 }), choice(INTENT, { max: -0.1 }), choice(TWO, { max: 0.5 }), R], message: /below 1\/(3|2)/ },
  // 1/4 = 0.25 exactly, so a min of 0.25 is at chance; 0.26 is above it; a min of 0 is left to the trivial-bound fact.
  choice_floor_at_chance: {
    hit: [choice(FOUR, { choice: "dark", min: 0.25 }), choice(INTENT, { min: 0.3 })],
    miss: [choice(FOUR, { min: 0.26 }), choice(FOUR, { min: 0 }), R], message: /at or below 1\/(4|3)/ },
  choice_bound_without_option: {
    hit: [choice(INTENT, { min: 0.6 }), choice(TWO, { max: 0.9 })],
    miss: [R, W, one(saved("noul-bound", { expect: { urgent: { min: 0.5 } } }))], message: /no option is expected/ },
  // Python's float() (checked with python3): "0.5", " 0.5 ", "1_000", "inf" and True read; "half", "1__0", "" and None raise.
  unreadable_expectation: {
    hit: [one(saved("text", { expect: { urgent: "yes" } })), one(saved("text-min", { expect: { urgent: { min: "half" } } })),
      one(saved("double-underscore", { expect: { urgent: { min: "1__0" } } })), one(saved("blank-min", { expect: { urgent: { min: "" } } })),
      one(saved("null-max", { expect: { urgent: { max: null } } })), one(saved("list-max", { expect: { urgent: { max: [0.5] } } })), choice(INTENT, { choice: 1 }),
      box({ box: { left: 0.1, top: 0.2, right: 0.5 } }), box({ box: { left: 0.1, top: 0.2, right: 0.5, bottom: null } }),
      box({ box: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 }, iou_min: "half" })],
    miss: [R, D, W, one(saved("zero", { expect: { urgent: 0 } })), one(saved("extra-key", { expect: { urgent: { min: 0.5, note: "x" } } })),
      one(saved("choice-on-noul", { expect: { urgent: { choice: 5 } } })), one(saved("numeric-text", { expect: { urgent: { min: "0.5", max: " 0.9 " } } })),
      one(saved("underscored", { expect: { urgent: { max: "1_000" } } })), one(saved("infinite", { expect: { urgent: { max: "inf" } } })),
      one(saved("boolean", { expect: { urgent: { min: true } } })), box({ box: { left: "0.1", top: 0.2, right: 0.5, bottom: 0.6 }, iou_min: "0.4" })],
    message: /^(urgent|pick|damage): (the expectation is not|min is not|max is not|the expected option is not text|the expected box lacks|iou_min is not)/ },
  box_outside_picture: {
    hit: [box({ box: { left: -0.1, top: 0.2, right: 0.5, bottom: 0.6 } }), box({ box: { left: 0.1, top: 0.2, right: 1.2, bottom: 0.6 } })],
    miss: [D, box({ box: { left: 1.5, top: 0.2, right: 1.2, bottom: 0.6 } }), box({ box: { left: 0, top: 0, right: 1, bottom: 1 } })],
    message: /reaches outside the picture/, ctx: FIXTURE },
  // At most 4 per request: 5 is over, 4 is at the limit.
  too_many_pictures: {
    hit: one(saved("five", { images: fiveSamples })), miss: [D, one(saved("four", { images: fourSamples }))], message: /^5 pictures; .* at most 4\.$/, ctx: FIXTURE },
  unusable_id: {
    hit: [one(saved("Refund Routing")), one(saved("bad_id")), one(saved("a".repeat(61)))], miss: [R, one(saved("a".repeat(60)))], message: /60 or fewer/, ctx: FIXTURE },
  truncated_id: {
    hit: one(saved(LONG_ID, { name: LONG_NAME })),
    miss: [R, one(saved(LONG_ID, { name: "Another long name that slugs to something else entirely, past sixty characters" })), one(saved("short", { name: "Short" }))],
    message: /slug is 80 characters, cut to 60/, ctx: FIXTURE },
  // Python json.dumps lengths (computed with python3): "é" × 16,000 is 96,002 (80% of 120,000 is 96,000); "é" × 15,999 is
  // 95,996; "a" × 120,000 is 120,002. The nested object below with 95,926 "y"s is exactly 96,000 (the emoji is two
  // \uXXXX escapes, \u007f one, "\n" two characters, and ", " / ": " separators), and 95,999 with one "y" fewer.
  input_size: {
    hit: [one(saved("accents", { state: "é".repeat(16000) })), one(saved("huge", { state: "a".repeat(120000) })), one(saved("nested", { state: NESTED(95926) }))],
    miss: [R, B, one(saved("just-under", { state: "é".repeat(15999) })), one(saved("nested-under", { state: NESTED(95925) }))],
    message: /about (96,002 characters as JSON, 80%|120,002 characters as JSON, over|96,000 characters as JSON, 80%)/, ctx: FIXTURE },
  empty_input: {
    hit: [one(saved("blank", { state: "" })), one(saved("spaces", { state: "   " })), one(saved("none", { state: null })),
      one(saved("empty-object", { state: {} })), one(saved("empty-list", { state: [] }))],
    miss: [R, B, W, U, one(saved("zero", { state: 0 })), one(saved("blank-field", { state: { note: "" } })), one(saved("blank-entry", { state: [""] }))],
    message: /^Its input is empty\.$/ },
  future_saved_at: {
    // The fixture clock is 2026-11-12T12:00:00Z: one second later is in the future, the same second is not.
    hit: [one(saved("future", { saved_at: "2026-12-01T00:00:00Z" })), one(saved("next-second", { saved_at: "2026-11-12T12:00:01Z" }))],
    miss: [R, W, L, one(saved("now", { saved_at: "2026-11-12T12:00:00Z" }))], message: /^Saved at 2026-1[12]-\d\dT[\d:]+Z, after the current time\.$/, ctx: FIXTURE },
  // Configured jev-1.2: latte-art-feedback was answered by jev-1.1; refund-routing and bean-quality by jev-1.2 itself.
  other_model_result: {
    hit: L, miss: [R, B, D, W], message: /^Answered by jev-1\.1; the Workbench asks jev-1\.2 now/, ctx: ctx({ status: { ...TESTS_STATUS, model: "jev-1.2" } }) },

  repeated_requests: {
    hitList: [...made(saved("one", { questions: { urgent: URGENT, intent: INTENT } }), saved("two", { questions: { intent: INTENT, urgent: URGENT } }))],
    missList: ALL, message: /^one, two send the same request with the same expectations\.$/ },
  shared_input: {
    hitList: made(saved("ask-urgent"), saved("ask-intent", { questions: { intent: INTENT } })),
    missList: [...ALL, ...made(saved("copy-1"), saved("copy-2"))], message: /^ask-urgent, ask-intent send the same input with 2 different question sets/ },
  shared_questions: {
    hitList: made(saved("input-1"), saved("input-2", { state: "Order HC-2001 is late." }), saved("input-3", { state: { order: "HC-3001" } })),
    missList: [...ALL, ...made(saved("copy-1"), saved("copy-2"))], message: /^input-1, input-2, input-3 ask the same questions of 3 different inputs/ },
  conflicting_expectations: {
    hitList: made(saved("wants-refund", { questions: { intent: INTENT }, expect: { intent: { choice: "refund" } } }),
      saved("wants-replacement", { questions: { intent: INTENT }, expect: { intent: { choice: "replacement" } } })),
    missList: [...made(saved("at-least", { expect: { urgent: { min: 0.5 } } }), saved("at-most", { expect: { urgent: { max: 0.8 } } }),
      saved("refund-elsewhere", { state: "Another order", questions: { intent: INTENT }, expect: { intent: { choice: "replacement" } } }),
      saved("reworded", { questions: { urgent: { ...URGENT, instructions: "Reply within the day?" } }, expect: { urgent: { max: 0.3 } } })), ...ALL],
    message: /^wants-refund and wants-replacement expect incompatible results for intent on the same input/ },
  different_verdicts: { hitList: TWINS, missList: [TWINS[0], TWINS[2], ...ALL], message: /^twin-a passed and twin-b failed on the same request and expectations\.$/ },
  id_with_several_types: {
    hitList: made(saved("as-noul", { questions: { status: URGENT } }), saved("as-choice", { questions: { status: TWO } })),
    missList: ALL, message: /^status: noul in as-noul; choice in as-choice\.$/ },
  wording_drift: {
    hitList: made(saved("first"), saved("second", { questions: { urgent: { ...URGENT, instructions: "Reply today?" } } })),
    missList: [...made(saved("spaced", { questions: { urgent: { ...URGENT, instructions: "  Does this need a   reply today? " } } }), saved("plain")), ...ALL],
    message: /^urgent: 2 wordings \(first \| second\)\.$/ },
  option_drift: {
    hitList: made(saved("ordered", { questions: { route: TWO } }), saved("reversed", { questions: { route: { ...TWO, criteria: { support: "Customer support", sales: "Wholesale sales" } } } })),
    missList: [...made(saved("same-1", { questions: { route: TWO } }), saved("same-2", { questions: { route: TWO } })), ...ALL],
    message: /^route: 2 option lists \(the same options in a different order\) \(ordered \| reversed\)\.$/ },
  level_drift: {
    hitList: made(saved("three", { questions: { quality: QUALITY } }), saved("five", { questions: { quality: { ...QUALITY, criteria: ["1", "2", "3", "4", "5"] } } })),
    missList: [...made(saved("words", { questions: { quality: QUALITY } }), saved("other-words", { questions: { quality: { ...QUALITY, criteria: ["Sad", "Fine", "Glad"] } } })), ...ALL],
    message: /^quality: 3 levels in three; 5 levels in five\.$/ },
  similar_question_ids: {
    hitList: made(saved("lower", { questions: { intent: INTENT } }), saved("upper", { questions: { Intent: INTENT } }), saved("snake", { questions: { in_tent: INTENT } })),
    missList: ALL, message: /^intent, Intent, in_tent differ only in case or separators\.$/ },
  // Fixture question IDs: intent, urgent, quality, damage, torn, route, spam, tone, mentions_milk. torn has no expectation,
  // spam's is {} and tone has none; the other six are checked.
  never_checked_ids: { hitList: ALL, missList: [R, B], message: /^3 of 9 question IDs never checked: torn, spam, tone\.$/ },
  // intent offers refund, replacement and question; refund-routing expects refund, so two are never expected.
  never_expected_options: { hitList: [R], missList: [B, D, L, U], message: /^intent: 2 of 3 options never the expected option\.$/ },
  // The default page filter hides latte-art-feedback, which is selected with bean-quality.
  hidden_selection: { hitList: ctx().shown(), missList: ctx().items(), ctx: ctx(), message: /^1 selected test hidden by filters \(latte-art-feedback\); Run selected includes it\.$/ },
}, { ctx: () => ctx() });

test("tests-suite-checks: a configured alias is never compared with the answering version, and a patch of a two-part id matches it", () => {
  const check = pack.features.find((feature) => feature.id === "other_model_result");
  const found = (model) => runDiagnostics([["k", check]], ALL, ctx({ status: { ...TESTS_STATUS, model } })).map((finding) => finding.index);
  assert.deepEqual(found("jev-latest"), []);
  assert.deepEqual(found("jev-preview"), [], "jev-preview is an alias too");
  assert.deepEqual(found("my-model"), [], "a name that is not a versioned id may be an alias");
  // jev-1 is not versioned (it needs major.minor); jev-1.1 is, and jev-1.2 (refund-routing, bean-quality) is not a patch of it.
  assert.deepEqual(found("jev-1"), []);
  assert.deepEqual(found("jev-1.1"), [0, 1]);
  assert.deepEqual(found("jev-1.2.0"), [0, 1, 4], "jev-1.2 is not a patch of jev-1.2.0");
  const patched = made(saved("patched"));
  const item = { ...patched[0], status: "pass", result: { ok: true, error: null, meta: { model: "jev-1.14.0" }, checks: [] } };
  assert.deepEqual(runDiagnostics([["k", check]], [item], ctx({ status: { ...TESTS_STATUS, model: "jev-1.14" } })), []);
  assert.equal(runDiagnostics([["k", check]], [item], ctx({ status: { ...TESTS_STATUS, model: "jev-1.13" } })).length, 1);
});

test("tests-suite-checks: every check returns quietly on odd items and empty lists", () => {
  const odd = [{}, { id: 5 }, { id: "x", questions: "no" }, { id: "y", questions: [null, 3, { id: "q", type: "choice", criteria: "bad", expect: { max: 0.1 } }] },
    { id: "z", images: { a: 1 }, state: undefined, result: { error: "e" } }, null, 7];
  for (const feature of pack.features) {
    if ((feature.scope || "item") === "list") {
      assert.doesNotThrow(() => feature.check(odd, ctx()), feature.id);
      assert.doesNotThrow(() => feature.check([], ctx()), feature.id);
      assert.deepEqual(runDiagnostics([["k", feature]], [], ctx({ selected: [] })), [], feature.id);
    } else {
      for (const item of odd) assert.doesNotThrow(() => feature.check(item, ctx(), 0), `${feature.id} on ${JSON.stringify(item)}`);
    }
  }
});

test("tests-suite-checks: findings never quote expected options, bounds or instructions", () => {
  const list = made(saved("test-a", { questions: { intent: INTENT }, expect: { intent: { choice: "refund", min: 0.3 } } }),
    saved("test-b", { questions: { intent: INTENT }, expect: { intent: { choice: "replacement", max: 0.2 } } }));
  const found = runDiagnostics(pack.features.map((feature) => [feature.id, feature]), list, ctx());
  assert.ok(found.length >= 3);
  for (const finding of found) {
    for (const secret of ["refund\"", "replacement ", "0.3", "0.2", "Money back", "What does the customer want"]) assert.ok(!finding.message.includes(secret), `${finding.key}: ${finding.message}`);
  }
});
