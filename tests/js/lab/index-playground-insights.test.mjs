import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/index/index-playground-insights.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { HELLO_EXAMPLES, PLAYGROUND_EMPTY, PLAYGROUND_HISTORY, PLAYGROUND_RESULTS, HELLO_QUESTIONS, helloResult, sampleIndexPlaygroundCtx } from "./fixtures/index.mjs";

const ctx = (overrides) => sampleIndexPlaygroundCtx(overrides);
const byId = (overrides) => Object.fromEntries(ctx(overrides).items().map((item) => [item.id, item]));
const R = byId();                                              // refund: the shown call
const I = byId({ result: PLAYGROUND_RESULTS.injection });     // injection: two close calls
const P = byId({ result: PLAYGROUND_RESULTS.praise });
const O = byId({ result: PLAYGROUND_RESULTS.odd });           // box, unknown type, missing values
const empty = () => ctx(PLAYGROUND_EMPTY);

// Edge answers made by the real builder. "edge": a Choice 0.35 vs 0.25, exactly 0.10 apart (0.35 - 0.25 is
// 0.09999999999999998 in floating point, which must not read as a close call), a Score of 0.6 that rounds to level 1
// while level 0 and level 1 tie at 0.45. "tie": the Choice picked complaining, tied with making_request at 0.45, which
// the builder lists first as top; "off": the Choice picked complaining at 0.3 while making_request has 0.6.
const edge = (intent, urgency) => byId({ result: helloResult({ text: "Is the Harbor House Blend back in stock?", answers: {
  intent: { type: "choice", confidence: 0.45, ...intent },
  urgency: { type: "score", confidence: 0.45, legend: { 0: "Not urgent", 1: "Somewhat urgent", 2: "Very urgent" }, ...urgency },
}, meta: { latency_ms: 90, input_tokens: 200, cost_usd: 0.00001 }, questions: { intent: HELLO_QUESTIONS.intent, urgency: HELLO_QUESTIONS.urgency } }) });
const E = edge({ choice: "making_request", probabilities: { making_request: 0.35, complaining: 0.25, asking_question: 0.2, sharing_info: 0.2, praising: 0 } },
  { score: 0.6, probabilities: { 0: 0.45, 1: 0.45, 2: 0.1 } });
const T = edge({ choice: "complaining", probabilities: { making_request: 0.45, complaining: 0.45, asking_question: 0.1 } },
  { score: 1.4, probabilities: { 0: 0.5, 1: 0.3, 2: 0.2 } });
const F = edge({ choice: "complaining", probabilities: { making_request: 0.6, complaining: 0.3, praising: 0.1 } },
  { score: 1, probabilities: { 0: 0.2, 1: 0.5, 2: 0.3 } });

checkPack(pack, {
  top_p: { items: [R.intent, R.urgency, R.wants_money_back, O.spot, O.pending_choice], values: [0.62, 0.66, 0.97, null, 0.5] },
  // .62-.34, .66-.30, .97-.03, .51-.47; a Box has no probabilities and the odd Choice lists only one usable entry.
  margin: { items: [R.intent, R.urgency, R.wants_money_back, I.intent, O.spot, O.pending_choice, E.intent, T.intent], values: [0.28, 0.36, 0.94, 0.04, null, null, 0.1, 0] },
  // -(Σ p ln p) / ln n, worked out separately: intent over five options, a 0.97 Noul over two, an even Noul.
  // Reference values from a separate Python computation of -(sum p ln p) / ln n: refund intent (n = 5) 0.5092824,
  // a 0.97 Noul (n = 2) 0.1943919, an even Noul 1, praise intent 0.1226323, refund urgency (n = 3) 0.6955930.
  uncertainty: { items: [R.intent, R.wants_money_back, O.yes_no, P.intent, R.urgency, O.spot], values: [0.5092824, 0.1943919, 1, 0.1226323, 0.695593, null], tolerance: 1e-6 },
  confidence: { items: [R.intent, R.urgency, R.wants_money_back, O.spot, O.pending_choice], values: [0.62, 0.66, null, 0.8, null] },
  yes_p: { items: [R.wants_money_back, R.talks_to_ai, R.intent, O.silent_noul, O.yes_no], values: [0.97, 0.03, null, null, 0.5] },
  // 1.62 / 2, 0.08 / 2, 3.4 / 4
  score_share: { items: [R.urgency, P.urgency, O.legacy_score, R.intent], values: [0.81, 0.04, 0.85, null] },
  // .51 vs .47, .54 vs .46 and .5 vs .5 are close; .35 vs .25 is exactly 0.10 apart, which is not under 0.10; .45 vs .45 ties.
  close_call: { items: [I.intent, I.wants_money_back, R.intent, O.spot, O.yes_no, E.intent, E.urgency], values: [true, true, false, false, true, false, true] },
  // round(3.4) = 3 (0.35) but level 4 is likeliest (0.5); round(1.62) = 2 is the top level. Edge: 0.6 rounds to level 1,
  // tied with level 0 at 0.45 (no difference); T: complaining tied with the top (no difference), 1.4 rounds to level 1
  // at 0.3 under level 0 at 0.5 (differs); F: complaining 0.3 under making_request 0.6 (differs), 1 is the top level.
  differs_from_top: { items: [O.legacy_score, R.urgency, R.intent, O.pending_choice, R.wants_money_back, E.urgency, T.intent, T.urgency, F.intent, F.urgency],
    values: [true, false, false, false, false, false, false, true, true, false] },
  missing_value: { items: [O.mystery, O.pending_choice, O.silent_noul, O.spot, R.intent], values: [true, true, true, false, false] },
  type: { items: [R.intent, R.urgency, R.wants_money_back, O.spot, O.mystery], values: ["choice", "score", "noul", "box", "rank"] },
  band: { items: [R.intent, R.wants_money_back, O.pending_choice, O.spot, I.urgency],
    values: ["medium (60% to 90%)", "high (90% or more)", "low (under 60%)", null, "low (under 60%)"] },
  chosen_text: { items: [R.intent, R.urgency, P.urgency, R.wants_money_back, O.legacy_score],
    values: ["Asking someone to do something", "Very urgent: needs it right now or something bad happens", "Not urgent: no time pressure at all", "", "Most"] },

  sum_check: { hit: O.pending_choice, miss: [R.intent, R.urgency, R.wants_money_back, O.spot], message: /add up to 50\.0%/ },
  middle_noul: { hit: [I.wants_money_back, O.yes_no], miss: [R.wants_money_back, R.intent, O.silent_noul], message: /P\(yes\) is (54|50)\.0%.*local rule/ },
  stale: { ctx: ctx({ draft: "Where is my order of Harbor House Blend?" }), hitList: Object.values(R), missList: [], message: /earlier text/ },

  // (96.2 + 131 + 118.4) / 3; with only the first call, 96.2.
  session_latency: [{ ctx: ctx(), expect: 115.2, empty: empty() }, { ctx: ctx({ history: PLAYGROUND_HISTORY.slice(0, 1) }), expect: 96.2 }],
  // 0.000016716 + 0.000016884 + 0.000017304
  session_cost: { ctx: ctx(), expect: 0.000050904, tolerance: 1e-12, empty: empty() },
  per_thousand: { ctx: ctx(), expect: (result) => { assert.ok(Math.abs(result.value - 0.017304) < 1e-12); assert.equal(result.detail, "projection"); }, empty: empty() },
  // 412 input tokens over 4 questions; 398 over 4 for the praise call.
  tokens_per_question: [{ ctx: ctx(), expect: 103, empty: empty() }, { ctx: ctx({ result: PLAYGROUND_RESULTS.praise }), expect: 99.5 }],
  // (.62 + .66 + .97 + .97) / 4; without talks_to_ai (.62 + .66 + .97) / 3.
  mean_top_p: [{ ctx: ctx(), expect: 0.805, empty: empty() }, { ctx: ctx({ hide: ["talks_to_ai"] }), expect: 0.75 }],
  // Refund: none. Injection: intent (0.04) and wants_money_back (0.08). Odd: pending_choice lists one usable entry,
  // legacy_score .5 vs .35, yes_no .5 vs .5 -> 1.
  close_calls: [{ ctx: ctx(), expect: 0, empty: empty() }, { ctx: ctx({ result: PLAYGROUND_RESULTS.injection }), expect: 2 },
    { ctx: ctx({ result: PLAYGROUND_RESULTS.odd }), expect: 1 },
    { ctx: ctx({ result: PLAYGROUND_RESULTS.injection, hide: ["intent"] }), expect: 1 }],

  answers_csv: { ctx: ctx({ hide: ["urgency", "talks_to_ai"] }), filename: "playground-answers.csv",
    text: '"question","type","answer","top option","top probability","confidence"\r\n'
      + '"intent","choice","making request","making_request","0.62","0.62"\r\n'
      + '"wants_money_back","noul","97.0%","yes","0.97",""\r\n' },
  answers_markdown: { ctx: ctx(), filename: "playground-answers.md",
    text: "| Question | Type | Answer | Top option |\n| --- | --- | --- | --- |\n"
      + "| intent | choice | making request | making_request (62.0%) |\n"
      + "| urgency | score | 1.62 / 2 | 2 (66.0%) |\n"
      + "| wants_money_back | noul | 97.0% | yes (97.0%) |\n"
      + "| talks_to_ai | noul | 3.0% | no (97.0%) |\n" },
  request_json: { ctx: ctx(), filename: "playground-request.json",
    includes: [`"text": "${HELLO_EXAMPLES[0].text}"`, '"model": "jev-latest"', '"wants_money_back"', '"criteria"'],
    excludes: ['"answers"', '"probabilities"', '"noul": 0.97', "cost_usd", "latency_ms", "0.62"],
    check: (out) => {
      assert.deepEqual(Object.keys(JSON.parse(out.text)), ["state", "model", "questions"]);
      assert.throws(() => runExporter(pack.features.find((feature) => feature.id === "request_json"), empty()), /no request yet/);
    } },
  session_csv: { ctx: ctx(), filename: "playground-calls.csv", excludes: ["espresso", "making_request"],
    text: '"call","time","model","latency_ms","input_tokens","cost_usd"\r\n'
      + '"1","2026-11-12T09:00:00.000Z","jev-1.14.0","96.2","398","0.000016716"\r\n'
      + '"2","2026-11-12T09:00:30.000Z","jev-1.14.0","131","402","0.000016884"\r\n'
      + '"3","2026-11-12T09:01:30.000Z","jev-1.14.0","118.4","412","0.000017304"\r\n' },

  inspect: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["inspect"]]), hidden: empty },
  focus_text: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["focusText"]]) },
  restore_text: { ctx: () => ctx({ draft: "Do you ship to the harbor office?" }),
    check: (c) => {
      assert.deepEqual(c.log, [["draftText", HELLO_EXAMPLES[0].text]]);
      assert.equal(c.env.toasts.length, 1);
    },
    hidden: () => ctx() },
  copy_summary: { ctx: () => ctx({ hide: ["urgency", "talks_to_ai"] }),
    check: (c) => assert.deepEqual(c.env.copied, ["intent: making request (top making_request (62.0%))\nwants_money_back: 97.0% (top yes (97.0%))"]),
    hidden: empty },
}, { ctx: () => sampleIndexPlaygroundCtx() });
