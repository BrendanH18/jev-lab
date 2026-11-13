// build-answer-facts on workbench.build.result. Expected values are worked out by hand from the fixture Run
// (tests/js/lab/fixtures/workbench-build.mjs): intent refund 0.82 / where_is_order 0.11 / other 0.07, urgency 1.35
// with levels 0.1 / 0.45 / 0.45, angry P(yes) 0.64, mug_box 0.25-0.65 × 0.3-0.7, refund_amount_ok P(yes) 0.12, tone
// upset 0.52 against calm 0.48; expectations intent = refund, angry ≤ 0.5 and a mug box 0.2-0.6 × 0.3-0.8.
//   Score spread of urgency: mean 1.35; 0.1·1.35² + 0.45·0.35² + 0.45·0.65² = 0.18225 + 0.055125 + 0.190125 = 0.4275.
//   Mug IoU: overlap 0.35 × 0.4 = 0.14; areas 0.16 and 0.2, union 0.22; IoU 14/22 = 7/11, headroom 7/11 − 0.5 = 3/22.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/build-answer-facts.js";
import { runDiagnostics } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { buildExpect, buildOddResult, buildResult, sampleBuildResultCtx } from "./fixtures/workbench-build.mjs";

const ctx = sampleBuildResultCtx();
const items = ctx.items();
const [intent, urgency, angry, mugBox, refundOk, tone] = items;
const empty = () => sampleBuildResultCtx({ result: null });
const probs = (pairs) => pairs.map(([key, p]) => ({ key, p }));

const withCalm = sampleBuildResultCtx({ expect: { ...buildExpect(), tone: { choice: "calm" } } });
const oddLevel = sampleBuildResultCtx({ result: buildOddResult() }).items()[0];

const extraResult = buildResult();
extraResult.trace.request.questions.extra = { type: "noul", instructions: "Is it raining?" };
const extraCtx = sampleBuildResultCtx({ result: extraResult });

const aliasResult = buildResult();
aliasResult.trace.request.model = "jev-latest";

checkPack(pack, {
  noul_yes: { items, values: [null, null, 0.64, null, 0.12, null], ctx },
  score_value: { items: [urgency, angry, { type: "score", value: 0.4 }], values: [1.35, null, 0.4], ctx },
  score_spread: { items: [urgency, { type: "score", probabilities: probs([["0", 0], ["1", 1], ["2", 0]]) }, intent], values: [Math.sqrt(0.4275), 0, null], ctx },
  options_to_90: { items: [...items, { type: "choice", probabilities: probs([["a", 0.95], ["b", 0.05]]) }, { type: "choice", probabilities: probs([["a", 0.5], ["b", 0.3]]) }],
    values: [2, 2, null, null, null, 2, 1, null], ctx },
  box_width: { items: [mugBox, { box: { left: 0, top: 0, right: 0.1, bottom: 0.5 } }, { box: { left: 0.1, top: 0.1, right: 0.4 } }], values: [0.4, 0.1, null], ctx },
  box_height: { items: [mugBox, { box: { left: 0, top: 0, right: 0.1, bottom: 0.5 } }, intent], values: [0.4, 0.5, null], ctx },
  expected_probability: { items: [...withCalm.items(), { type: "choice", value: "a", probabilities: probs([["a", 1]]), expectation: { choice: "zzz" } }],
    values: [0.82, null, null, null, null, 0.48, null], ctx: withCalm },
  // A box far from its expected box overlaps 0; a box without every expected edge is unavailable.
  expectation_iou: { items: [mugBox, { type: "box", box: { left: 0, top: 0, right: 0.5, bottom: 0.5 }, expectation: { box: { left: 0, top: 0, right: 0.5, bottom: 0.5 } } }, intent,
    { type: "box", box: { left: 0, top: 0, right: 0.2, bottom: 0.2 }, expectation: { box: { left: 0.5, top: 0.5, right: 1, bottom: 1 } } },
    { type: "box", box: { left: 0, top: 0, right: 0.2, bottom: 0.2 }, expectation: { box: { left: 0.5, top: 0.5, right: 1 } } }],
    values: [7 / 11, 1, null, 0, null], ctx },
  expectation_headroom: { items: [...items, { type: "score", value: 1.35, expectation: { min: 1, max: 1.5 } }, { type: "noul", value: 0.5, expectation: { min: "x" } },
    { type: "choice", value: "refund", probabilities: probs([["refund", 0.82]]), expectation: { min: 0.7 } },
    // check_expectation reads bounds with float(), so text numbers count: 0.7 − 0.5 = 0.2; a Choice whose chosen option is
    // not listed is measured at 0, so min 0.25 gives −0.25; IoU of [0, 0.5]² inside [0, 1]² is 0.25, floor "0.2" → 0.05.
    { type: "noul", value: 0.7, expectation: { min: "0.5" } }, { type: "choice", value: "zzz", probabilities: probs([["a", 1]]), expectation: { min: 0.25 } },
    { type: "box", box: { left: 0, top: 0, right: 0.5, bottom: 0.5 }, expectation: { box: { left: "0", top: 0, right: 1, bottom: "1" }, iou_min: "0.2" } }],
  values: [null, null, -0.14, 3 / 22, null, null, 0.15, null, 0.12, 0.2, -0.25, 0.05], ctx },
  chosen_description: { items, values: ["Wants money back", "Soon", "Uses angry or threatening words", "", "", "Upset"], ctx },
  runner_up: { items, values: ["where_is_order", "2", "", "", "", "calm"], ctx },
  chosen_answer: { items, values: ["refund", "level 1", "yes", null, "no", "upset"], ctx },
  chose_catch_all: { items: [tone, intent, { type: "choice", value: "None of the above" }, { type: "choice", value: "N/A" }, { type: "noul", value: 0.2 }],
    values: [false, false, true, true, false], ctx },
  mode_differs: { items: [urgency, { type: "score", value: 1, scale: 2, probabilities: probs([["0", 0.45], ["1", 0.1], ["2", 0.45]]) }, intent],
    values: [false, true, false], ctx },

  probabilities_off: { hit: oddLevel, miss: [intent, urgency, tone, angry], message: /^The listed probabilities add up to 50\.0%, not 100%/ },
  chosen_not_top: { hit: [{ type: "choice", value: "calm", probabilities: probs([["calm", 0.48], ["upset", 0.52]]) }, { type: "choice", value: "zzz", probabilities: probs([["a", 1]]) }],
    miss: [intent, tone, { type: "choice", value: "x_y", probabilities: [] }], message: /^The chosen option “(calm|zzz)”/ },
  box_at_edge: { hit: { type: "box", box: { left: 0, top: 0.2, right: 0.5, bottom: 0.997 } }, miss: [mugBox, { type: "box", box: { left: 0.006, top: 0.1, right: 0.99, bottom: 0.9 } }],
    message: /reaches the picture's left and bottom edge/ },
  expectation_other_kind: { hit: [{ type: "noul", value: 0.4, expectation: { choice: "yes" } }, { type: "box", box: mugBox.box, expectation: { min: 0.5 } },
    { type: "choice", value: "a", expectation: { choice: "a", iou_min: 0.5 } }, { type: "box", box: mugBox.box, expectation: { box: mugBox.box, max: 1 } }],
  miss: [intent, angry, mugBox, urgency], message: /ignored|without comparing anything/ },
  expected_option_unlisted: { hit: { type: "choice", value: "a", probabilities: probs([["a", 1]]), criteria: [{ key: "a", text: "" }], expectation: { choice: "b" } },
    miss: [intent, tone], message: /names “b”, which is not an option/ },
  barely_met: { hit: { type: "noul", value: 0.52, expectation: { min: 0.5 } },
    miss: [angry, intent, mugBox, { type: "noul", value: 0.49, expectation: { min: 0.5 } }], message: /^Passes its expectation by 0\.02 / },
  unanswered: { hitList: extraCtx.items(), missList: items, ctx: extraCtx, missCtx: ctx, message: /^The Run sent 1 question that got no answer: extra\.$/ },

  cost_per_question: [{ ctx, expect: 0.000412 / 6, empty: empty() }, { ctx: sampleBuildResultCtx({ result: buildOddResult() }), expect: null }],
  answering_model: [
    { ctx, expect: (result) => { assert.equal(result.value, "jev-1.14"); assert.equal(result.detail, ""); }, empty: empty() },
    { ctx: sampleBuildResultCtx({ result: aliasResult }), expect: (result) => { assert.equal(result.value, "jev-1.14"); assert.equal(result.detail, "asked for jev-latest"); } },
  ],
}, { ctx: () => sampleBuildResultCtx() });

test("headroom and the met/missed reading agree with check_expectation on the fixture Run", () => {
  const barely = pack.features.find((feature) => feature.id === "barely_met");
  // angry misses (0.64 > 0.5) and the mug box meets (IoU 7/11 ≥ 0.5) but not barely: nothing to report.
  assert.deepEqual(runDiagnostics([["b", barely]], items, ctx), []);
  // A Box that meets its floor by 0.02: IoU of [0, 0.52] against [0, 1] along one side is 0.52.
  const box = { type: "box", box: { left: 0, top: 0, right: 0.52, bottom: 1 }, expectation: { box: { left: 0, top: 0, right: 1, bottom: 1 } } };
  assert.match(runDiagnostics([["b", barely]], [box], ctx)[0].message, /by 0\.02/);
});

test("checks stay quiet on an empty Run and on refund_amount_ok", () => {
  const checks = pack.features.filter((feature) => feature.kind === "diagnostic").map((feature) => [feature.id, feature]);
  assert.deepEqual(runDiagnostics(checks, [], empty()), []);
  assert.deepEqual(runDiagnostics(checks.filter(([id]) => id !== "unanswered"), [refundOk], ctx), []);
});
