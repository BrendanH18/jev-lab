import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/index/index-playground-more.js";
import { runDiagnostics, runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { HELLO_EXAMPLES, PLAYGROUND_EMPTY, PLAYGROUND_HISTORY, PLAYGROUND_RESULTS, helloResult, sampleIndexPlaygroundCtx } from "./fixtures/index.mjs";

const ctx = (overrides) => sampleIndexPlaygroundCtx(overrides);
const byId = (overrides) => Object.fromEntries(ctx(overrides).items().map((item) => [item.id, item]));
const R = byId();                                              // refund: the shown call (call 3)
const I = byId({ result: PLAYGROUND_RESULTS.injection });     // injection: call 2
const P = byId({ result: PLAYGROUND_RESULTS.praise });        // praise: call 1
const O = byId({ result: PLAYGROUND_RESULTS.odd });           // box, unknown type, missing values; not in the session history
const empty = () => ctx(PLAYGROUND_EMPTY);
const feature = (id) => pack.features.find((entry) => entry.id === id);

// A response that breaks the rules the checks look for: a Choice key that was not offered, a Score above its scale,
// a confidence far from the top probability, two questions without an answer and a slow call.
const BAD = helloResult({ text: "Please refund my Harbor House Blend order.",
  answers: {
    intent: { type: "choice", choice: "refund_request", confidence: 0.9, probabilities: { refund_request: 0.7, complaining: 0.3 } },
    urgency: { type: "score", score: 2.4, confidence: 0.7, legend: { 0: "Not urgent", 1: "Somewhat urgent", 2: "Very urgent" },
      probabilities: { 0: 0.1, 1: 0.2, 2: 0.7 } },
  },
  meta: { latency_ms: 812, input_tokens: 300, cost_usd: 0.0000126 } });
const B = byId({ result: BAD });
// Boundaries: P(yes) .95 leaves "no" at 1 − .95, which floating point makes 0.05000000000000004 (not above 5%);
// intent confidence .67 against top .62 is exactly 5 points apart (quiet), urgency .72 against .66 is 6 points (reported).
const EDGE = helloResult({ text: "Can I get a credit for the late Harbor House Blend delivery?",
  answers: {
    intent: { type: "choice", choice: "making_request", confidence: 0.67, probabilities: { making_request: 0.62, complaining: 0.38 } },
    urgency: { type: "score", score: 0.8, confidence: 0.72, legend: { 0: "Not urgent", 1: "Somewhat urgent", 2: "Very urgent" },
      probabilities: { 0: 0.27, 1: 0.66, 2: 0.07 } },
    wants_money_back: { type: "noul", noul: 0.95 },
    talks_to_ai: { type: "noul", noul: 0.5 },
  },
  meta: { latency_ms: 500, input_tokens: 300 } });
const E = byId({ result: EDGE });
const badCtx = () => ctx({ result: BAD });

checkPack(pack, {
  // Second highest: .34, .30, .03 (no), .47; a Box lists nothing and the odd Choice lists one usable entry.
  runner_up_p: { items: [R.intent, R.urgency, R.wants_money_back, I.intent, O.spot, O.pending_choice], values: [0.34, 0.3, 0.03, 0.47, null, null] },
  // Strictly above .05: intent .62/.34; urgency .30/.66; money back .97; injection urgency .35/.59/.06; legacy .10/.35/.50.
  // Edge: money back .95/.05 counts one; urgency .27/.66/.07 counts three.
  options_in_play: { items: [R.intent, R.urgency, R.wants_money_back, I.urgency, O.legacy_score, O.spot, E.wants_money_back, E.urgency],
    values: [2, 2, 1, 3, 3, null, 1, 3] },
  // sqrt(Σ p k² − (Σ p k)²), worked out with exact fractions: refund .04/.30/.66 -> sqrt(.3156); praise .92/.08/0 ->
  // sqrt(.0736); legacy 0/.05/.10/.35/.50 -> sqrt(.71). Choice and Noul have none.
  score_spread: { items: [R.urgency, P.urgency, O.legacy_score, R.intent, R.wants_money_back],
    values: [0.5617828762075255, 0.2712931993250107, 0.8426149773176358, null, null], tolerance: 1e-9 },
  // Half the summed absolute differences against the previous call of the session, worked out with exact fractions:
  // refund vs injection .135, .60, .43, .95; injection vs praise .98; praise is the first call; odd is not in history.
  shift_since_previous: { ctx: ctx(), items: [R.intent, R.urgency, R.wants_money_back, R.talks_to_ai, I.intent, P.intent, O.yes_no],
    values: [0.135, 0.6, 0.43, 0.95, 0.98, null, null], tolerance: 1e-9 },
  runner_up: { items: [R.intent, R.urgency, R.wants_money_back, P.intent, O.spot], values: ["complaining", "1", "no", "sharing_info", null] },
  // Top levels: refund "2" of 2, praise "0", injection "1", legacy "4" of 4.
  extreme_level: { items: [R.urgency, P.urgency, I.urgency, O.legacy_score, R.intent], values: [true, true, false, true, false] },
  // Refund vs injection: intent stays making_request, urgency rounds 2 vs 1, money back stays above one half,
  // talks to AI crosses it. Praise has no earlier call.
  changed_since_previous: { ctx: ctx(), items: [R.intent, R.urgency, R.wants_money_back, R.talks_to_ai, P.intent, O.yes_no],
    values: [false, true, false, true, false, false] },

  chosen_not_offered: { hit: B.intent, miss: [R.intent, P.intent, O.pending_choice, R.urgency], message: /refund_request.*5 options sent/ },
  score_out_of_range: { hit: B.urgency, miss: [R.urgency, O.legacy_score, R.intent, O.silent_noul], message: /2\.4, outside 0 to 2/ },
  confidence_gap: { hit: [B.intent, E.urgency], miss: [R.intent, R.urgency, R.wants_money_back, O.spot, O.legacy_score, E.intent],
    message: /confidence (90\.0% but its top option has 70\.0%|72\.0% but its top option has 66\.0%)/ },
  unanswered: { ctx: badCtx(), hitList: Object.values(B), missList: [], message: /^(wants_money_back|talks_to_ai) was sent/ },
  // talks_to_ai .98 is reported; .03 and exactly one half are not.
  injection_signal: { hitList: Object.values(I), missList: [...Object.values(R), ...Object.values(E)], message: /^Local rule: talks_to_ai is 98\.0%, above one half/ },
  slow_call: { ctx: badCtx(), hitList: Object.values(B), missList: [], message: /812 ms \(measured\)/ },  // quiet cases: the tests below

  fastest_call: { ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 96.2); assert.match(result.detail, /call 1 of 3 calls/); } },
  slowest_call: { ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 131); assert.match(result.detail, /call 2 of 3 calls/); } },
  // 118.4 − (96.2 + 131 + 118.4) / 3 = 118.4 − 115.2 = 3.2; for the praise call 96.2 − 115.2 = −19; one call alone has no mean to compare.
  latency_vs_mean: [{ ctx: ctx(), expect: 3.2, tolerance: 1e-9, empty: empty() },
    { ctx: ctx({ result: PLAYGROUND_RESULTS.praise }), expect: -19, tolerance: 1e-9 },
    { ctx: ctx({ history: PLAYGROUND_HISTORY.slice(2) }), expect: null }],
  // 398 + 402 + 412
  session_tokens: [{ ctx: ctx(), expect: 1212, empty: empty() }, { ctx: ctx({ history: PLAYGROUND_HISTORY.slice(0, 2) }), expect: 800 }],
  // urgency .08 -> .71 -> 1.62: changes .63 and .91.
  largest_score_swing: [{ ctx: ctx(), empty: empty(), expect: (result) => { assert.ok(Math.abs(result.value - 0.91) < 1e-9); assert.equal(result.detail, "urgency, call 2 to call 3"); } },
    { ctx: ctx({ history: PLAYGROUND_HISTORY.slice(0, 2) }), expect: 0.63, tolerance: 1e-9 }],

  answers_jsonl: { ctx: ctx({ hide: ["urgency", "talks_to_ai"] }), filename: "playground-answers.jsonl",
    text: '{"question":"intent","type":"choice","value":"making_request","display":"making request","probabilities":{"making_request":0.62,"complaining":0.34,"asking_question":0.02,"sharing_info":0.02,"praising":0}}\n'
      + '{"question":"wants_money_back","type":"noul","value":0.97,"display":"97.0%","probabilities":null}\n',
    check: () => {
      assert.throws(() => runExporter(feature("answers_jsonl"), empty()), /no shown answers/);
      assert.throws(() => runExporter(feature("answers_jsonl"), ctx({ hide: ["intent", "urgency", "wants_money_back", "talks_to_ai"] })), /no shown answers/);
    } },
  probability_csv: { ctx: ctx({ hide: ["intent", "wants_money_back"] }), filename: "playground-probabilities.csv",
    // talks_to_ai: yes .03, no 1 − .03 = .97 after rounding to six decimals.
    text: '"question","type","option","probability"\r\n"urgency","score","0","0.04"\r\n"urgency","score","1","0.3"\r\n"urgency","score","2","0.66"\r\n'
      + '"talks_to_ai","noul","yes","0.03"\r\n"talks_to_ai","noul","no","0.97"\r\n' },
  session_json: { ctx: ctx(), filename: "playground-session.json", includes: [HELLO_EXAMPLES[1].text, "Only the entry marked shown"],
    excludes: ["latency_ms", "cost_usd", "input_tokens"],
    check: (out) => {
      const data = JSON.parse(out.text);
      assert.deepEqual(data.calls.map((entry) => [entry.call, entry.at, entry.shown, entry.model]), [
        [1, "2026-11-12T09:00:00.000Z", false, "jev-1.14.0"], [2, "2026-11-12T09:00:30.000Z", false, "jev-1.14.0"], [3, "2026-11-12T09:01:30.000Z", true, "jev-1.14.0"]]);
      assert.deepEqual(data.calls[1].answers[0], { question: "intent", type: "choice", value: "making_request", display: "making request" });
      assert.deepEqual(data.calls[0].answers.map((answer) => answer.display), ["praising", "0.08 / 2", "1.0%", "2.0%"]);
      assert.throws(() => runExporter(feature("session_json"), empty()), /Nothing has been answered/);
    } },
  questions_markdown: { ctx: ctx(), filename: "playground-questions.md", excludes: ["espresso", "0.62", "making request", "97.0%"],
    text: "# Playground questions\n\n"
      + "## intent (choice)\n\nWhat is the writer of `text` mainly doing?\n\n- `asking_question`: Asking for information\n- `making_request`: Asking someone to do something\n"
      + "- `complaining`: Expressing dissatisfaction about something that went wrong\n- `praising`: Expressing thanks or satisfaction\n- `sharing_info`: Just sharing news or information\n\n"
      + "## urgency (score)\n\nHow urgent does the writer of `text` sound?\n\n- 0: Not urgent: no time pressure at all\n- 1: Somewhat urgent: would like it handled soon\n"
      + "- 2: Very urgent: needs it right now or something bad happens\n\n"
      + "## wants_money_back (noul)\n\nIs the writer of `text` asking for a refund, credit, or money back?\n\n"
      + "## talks_to_ai (noul)\n\nDoes `text` contain instructions aimed at an AI assistant or automated system?\n",
    check: () => assert.throws(() => runExporter(feature("questions_markdown"), empty()), /no questions yet/) },

  previous_call: { improvements: {
    table: (t) => {
      const tree = t.render(ctx());
      const rows = t.findAll(tree, (node) => node.tag === "tr" && node.attrs["data-question"]);
      // Call 2 (injection) beside call 3 (refund); shifts from the exact-fraction sums above.
      assert.deepEqual(rows.map((row) => row.children.map(t.textOf)), [
        ["intent", "making request", "making request", "same", "13.5%"],
        ["urgency", "0.71 / 2", "1.62 / 2", "changed", "60.0%"],
        ["wants_money_back", "54.0%", "97.0%", "same", "43.0%"],
        ["talks_to_ai", "98.0%", "3.0%", "changed", "95.0%"]]);
      assert.match(t.textOf(tree), /Call 2 \(earlier\).*Call 3 \(shown\)/);
      assert.match(t.textOf(tree), /an earlier call of this page load/);
      assert.match(t.textOf(t.render(ctx({ history: PLAYGROUND_HISTORY.slice(2) }))), /Ask the playground twice/);
      assert.match(t.textOf(t.render(empty())), /Ask the playground twice/);
    },
    copy: (t) => {
      const tree = t.render(ctx({ hide: ["intent", "wants_money_back"] }));
      t.fire(t.find(tree, (node) => node.attrs?.["data-copy"] === "previous-call"), "click");
      assert.deepEqual(t.env.copied, ["Question\tCall 2 (earlier)\tCall 3 (shown)\tAnswer\tShift\n"
        + "urgency\t0.71 / 2\t1.62 / 2\tchanged\t60.0%\ntalks_to_ai\t98.0%\t3.0%\tchanged\t95.0%"]);
    },
  } },
  close_explorer: { improvements: {
    threshold: (t) => {
      const ids = (tree) => t.findAll(tree, (node) => node.attrs?.["data-close"]).map((node) => node.attrs["data-close"]);
      // Refund margins: intent .28, urgency .36, the two Nouls .94. The default threshold is 0.10.
      let tree = t.render(ctx());
      assert.deepEqual(ids(tree), []);
      assert.ok(t.find(tree, (node) => node.attrs?.["data-close-none"]));
      t.fire(t.find(tree, (node) => node.tag === "input"), "input", { target: { value: "0.3" } });
      tree = t.render(ctx());
      assert.deepEqual(ids(tree), ["intent"]);
      assert.match(t.textOf(tree), /intent: making_request 62\.0% vs complaining 34\.0% \(28\.0% apart\)/);
      t.state.threshold = "0.5";
      assert.deepEqual(ids(t.render(ctx())), ["intent", "urgency"]);
      // Injection at the default: intent .04 apart, money back .08 apart, closest first.
      t.state.threshold = "0.10";
      assert.deepEqual(ids(t.render(ctx({ result: PLAYGROUND_RESULTS.injection }))), ["intent", "wants_money_back"]);
      t.state.threshold = "2";
      assert.ok(t.find(t.render(ctx()), (node) => node.attrs?.["data-close-error"]));
      t.state.threshold = "";
      assert.ok(t.find(t.render(ctx()), (node) => node.attrs?.["data-close-error"]));
    },
  } },
  example_coverage: { improvements: {
    coverage: (t) => {
      const tree = t.render(ctx());
      const lines = t.findAll(tree, (node) => node.tag === "li").map(t.textOf);
      // History: praise is call 1, injection call 2, refund call 3; the question example was never asked.
      assert.deepEqual(lines, ["Angry + refund: asked in call 3", "Praise: asked in call 1", "Question: not asked in this page load", "Injection: asked in call 2"]);
      assert.doesNotMatch(t.textOf(tree), /making|97\.0%|praising/);
      assert.deepEqual(t.findAll(t.render(empty()), (node) => node.tag === "li").map(t.textOf),
        ["Angry + refund: not asked in this page load", "Praise: not asked in this page load", "Question: not asked in this page load", "Injection: not asked in this page load"]);
      assert.match(t.textOf(t.render(ctx({ examples: [] }))), /did not load/);
    },
  } },

  copy_text: { ctx: () => ctx(), check: (c) => { assert.deepEqual(c.env.copied, [HELLO_EXAMPLES[0].text]); assert.deepEqual(c.log, []); }, hidden: empty },
  draft_previous: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.log, [["draftText", HELLO_EXAMPLES[3].text]]);
      assert.match(c.env.toasts[0].message, /call 2, an earlier call of this page load.*Nothing was asked/);
    },
    hidden: () => ctx({ history: PLAYGROUND_HISTORY.slice(2) }) },
}, { ctx: () => sampleIndexPlaygroundCtx() });

test("index-playground-more: list checks stay quiet on a complete, quick call", () => {
  const full = ctx();
  const findings = runDiagnostics([["u", feature("unanswered")], ["s", feature("slow_call")]], full.items(), full);
  assert.deepEqual(findings, []);
});

test("index-playground-more: a call of exactly 500 ms is not reported as slow", () => {
  const edge = ctx({ result: EDGE });
  assert.deepEqual(runDiagnostics([["s", feature("slow_call")]], edge.items(), edge), []);
});

test("index-playground-more: draft_previous is hidden once the box already holds that text", () => {
  assert.equal(feature("draft_previous").when(ctx({ draft: ` ${HELLO_EXAMPLES[3].text} ` })), false);
});
