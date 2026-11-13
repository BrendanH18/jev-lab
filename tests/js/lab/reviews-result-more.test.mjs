import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/reviews/reviews-result-more.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { REVIEWS_POLICY, sampleReviewsResult, sampleReviewsResultCtx } from "./fixtures/reviews.mjs";

const FLAT = "The bag that came last week was roasted almost three months ago. Flat, papery taste and no crema. Could you send a fresh bag?";
const feature = (id) => pack.features.find((entry) => entry.id === id);
const withResult = (change) => { const result = sampleReviewsResult(); change(result); return sampleReviewsResultCtx({ result }); };

// A hand-made session of three checks; the last is the shown one.
const session = fakeCtx({ data: { history: [
  { call: 1, answers: { severity: { type: "score", score: 1.0 }, safety: { type: "noul", noul: 0.1 }, topic: { type: "choice", choice: "cafe_service" } } },
  { call: 2, answers: { severity: { type: "score", score: 1.5, legend: { 0: "a", 1: "b", 2: "c", 3: "d" } }, safety: { type: "noul", noul: 0.2 },
    topic: { type: "choice", choice: "roast_flavor" }, tone: { type: "score", score: 2 } } },
  { call: 3, answers: { severity: { type: "score", score: 1.55 }, safety: { type: "noul", noul: 0.4 }, topic: { type: "choice", choice: "freshness" }, tone: { type: "score", score: 2.15 } } },
] } });
const shown = () => [{ id: "severity", type: "score", value: 1.55 }, { id: "safety", type: "noul", value: 0.4 }, { id: "topic", type: "choice", value: "freshness" },
  { id: "wants_reply", type: "noul", value: 0.9 }];
const severityProbs = [{ key: "0", p: 0.05 }, { key: "1", p: 0.3 }, { key: "2", p: 0.6 }, { key: "3", p: 0.05 }];
const toneProbs = [{ key: "0", p: 0.08 }, { key: "1", p: 0.8 }, { key: "2", p: 0.1 }, { key: "3", p: 0.01 }, { key: "4", p: 0.01 }];
const draft = (stars) => ({ stars, channel: "website", about: "Harbor House Blend, 340 g bag", text: FLAT });

// The form holds 2 stars: one step up is 3, one step down is 1. At the end of the scale, or while a check runs, the
// command is hidden.
function starsCase(by, edge) {
  return { ctx: () => sampleReviewsResultCtx(),
    check: (ctx) => { assert.deepEqual(ctx.log, [["setStars", 2 + by]]); assert.equal(ctx.data.review.stars, 2 + by); assert.equal(ctx.state.draft.stars, 2 + by); },
    hidden: () => sampleReviewsResultCtx({ draft: draft(edge) }) };
}
const stepStars = (id) => pack.features.find((entry) => entry.id === id);
const rowsOf = (t, tree, attr) => t.findAll(tree, (node) => node.tag === "tr" && node.attrs?.[attr]);
// Cells of the flip table's "Flips at" column, worked out by hand on the fixture's policy grid: severity 1.62 sits
// below P1 2 (last 0.1 step at or below it: 1.6) and above P2 1 (first step above: 1.7); tone 1.05 below 3 -> 1.0;
// safety 0.02 below 0.5 -> 0; wants_reply 0.93 above 0.6 -> 0.95; about_us 0.98 above 0.5 -> 1.0.
const FLIPS = [["severity:p1_at", "below", "1.6"], ["severity:p2_at", "at or above", "1.7"], ["tone:thank_tone_at", "below", "1"], ["safety:safety_at", "below", "0"],
  ["wants_reply:wants_reply_at", "at or above", "0.95"], ["about_us:about_us_min", "at or above", "1"]];

checkPack(pack, {
  // A tie keeps the first option on top, so the second is the runner-up; one option has none.
  runner_up: { items: [{ probabilities: [{ key: "freshness", p: 0.81 }, { key: "roast_flavor", p: 0.12 }, { key: "other", p: 0.07 }] },
    { probabilities: [{ key: "yes", p: 0.93 }, { key: "no", p: 0.07 }] }, { probabilities: [{ key: "a", p: 0.4 }, { key: "b", p: 0.4 }, { key: "c", p: 0.2 }] },
    { probabilities: [{ key: "only", p: 1 }] }], values: ["roast_flavor", "no", "b", null] },
  // 0×0.05 + 1×0.3 + 2×0.6 + 3×0.05 = 1.65; weights 1 and 1 normalize to a mean level of 0.5.
  expected_level: { items: [{ type: "score", probabilities: severityProbs }, { type: "score", probabilities: [{ key: "0", p: 1 }, { key: "1", p: 1 }] },
    { type: "noul", probabilities: [{ key: "yes", p: 0.9 }, { key: "no", p: 0.1 }] }, { type: "score", probabilities: [] }], values: [1.65, 0.5, null, null], tolerance: 1e-12 },
  // Severity levels 2 and 3: 0.6 + 0.05; tone levels 3 and 4: 0.01 + 0.01.
  top_two: { items: [{ type: "score", probabilities: severityProbs }, { type: "score", probabilities: toneProbs }, { type: "noul", probabilities: [{ key: "yes", p: 0.9 }] }],
    values: [0.65, 0.02, null], tolerance: 1e-12 },
  // Against check 2: 1.55 − 1.5 and 0.4 − 0.2; a choice and a question check 2 lacks are unavailable.
  prev_change: { ctx: session, items: shown(), values: [0.05, 0.2, null, null], tolerance: 1e-12 },
  // (1.0 + 1.5 + 1.55) / 3 = 1.35 and (0.1 + 0.2 + 0.4) / 3.
  session_mean: { ctx: session, items: shown(), values: [1.35, 0.7 / 3, null, null], tolerance: 1e-12 },
  // 0.05 is not more than 0.1; 0.2 is; freshness differs from roast_flavor; tone moved 0.15.
  changed: { ctx: session, items: [...shown(), { id: "tone", type: "score", value: 2.15 }], values: [false, true, true, false, true] },
  // Check 2 printed as the cards print it: its legend has four levels, so "/ 3".
  prev_display: { ctx: session, items: shown(), values: ["1.50 / 3", "20.0%", "roast flavor", ""] },

  level_disagrees: { hit: { type: "score", value: 1.62, top: { key: "1", p: 0.45 } },
    miss: [{ type: "score", value: 1.62, top: { key: "2", p: 0.6 } }, { type: "noul", value: 0.5, top: { key: "yes", p: 0.5 } }, { type: "score", value: null, top: null }],
    message: /^Score 1\.62 is nearest level 2, but level 1 is the most probable \(45%\)\.$/ },
  weak_choice: { hit: { type: "choice", top: { key: "cafe_service", p: 0.42 } },
    miss: [{ type: "choice", top: { key: "freshness", p: 0.81 } }, { type: "score", top: { key: "1", p: 0.3 } }, { type: "choice", top: null }],
    message: /^The most probable option, cafe service, holds 42%: less than half\.$/ },
  prob_sum_off: { hit: { type: "choice", probabilities: [{ key: "a", p: 0.5 }, { key: "b", p: 0.3 }] },
    miss: [{ type: "score", probabilities: severityProbs }, { type: "choice", probabilities: [{ key: "a", p: 0.505 }, { key: "b", p: 0.505 }] },
      { type: "noul", probabilities: [{ key: "yes", p: 0.5 }] }, { type: "choice", probabilities: [] }],
    message: /^The 2 probabilities add up to 0\.800, not 1\.$/ },
  // freshness -> Roasting but packaging_shipping -> Fulfillment; the fixture's runner-up roast_flavor also goes to Roasting.
  runner_up_team: { ctx: sampleReviewsResultCtx(),
    hitList: [{ id: "topic", type: "choice", probabilities: [{ key: "freshness", p: 0.55 }, { key: "packaging_shipping", p: 0.4 }] }],
    missList: sampleReviewsResultCtx().items(),
    message: /^Runner-up topic Packaging and shipping \(40%\) routes to Fulfillment, not Roasting\. Advisory, from the routing table\.$/ },
  // 1.8 is 0.2 from the cut of 2 (inside one 0.25 step); 1.7 is 0.3 away (outside).
  gap_near: { ctx: withResult((result) => { result.triage.evidence.rating_gap = 1.8; }), missCtx: withResult((result) => { result.triage.evidence.rating_gap = 1.7; }),
    hitList: sampleReviewsResultCtx().items(), missList: sampleReviewsResultCtx().items(),
    message: /^Stars and words are 1\.80 levels apart and the mismatch cut in force is 2: within one slider step/ },

  // (1450 + 60) / 6.
  tokens_per_question: [{ ctx: sampleReviewsResultCtx(), expect: (result) => { assert.ok(Math.abs(result.value - 1510 / 6) < 1e-9); assert.equal(result.detail, "1510 tokens, 6 questions"); },
    empty: sampleReviewsResultCtx({ result: null }) }],
  cost_per_thousand: [{ ctx: sampleReviewsResultCtx(), expect: (result) => { assert.ok(Math.abs(result.value - 0.42) < 1e-12); assert.match(result.detail, /^projection from one measured check of \$0\.00042$/); },
    empty: sampleReviewsResultCtx({ result: null }) }],
  // 700 against (820 + 760 + 700) / 3 = 760; one check alone has nothing to compare with.
  latency_vs_mean: [{ ctx: sampleReviewsResultCtx(), expect: (result) => { assert.equal(result.value, -60); assert.equal(result.detail, "mean of 3 checks: 760 ms"); },
    empty: sampleReviewsResultCtx({ result: null, history: [], calls: 0 }) },
  { ctx: sampleReviewsResultCtx({ history: [{ call: 1, at: 1, review: draft(2), answers: {}, meta: { latency_ms: 700 } }] }), expect: null }],
  // cafe_service, then freshness twice.
  distinct_topics: [{ ctx: sampleReviewsResultCtx(), expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "3 checks with a topic"); },
    empty: sampleReviewsResultCtx({ result: null, history: [], calls: 0 }) }],
  // (1400 + 60) + (1460 + 60) + (1450 + 60).
  session_tokens: [{ ctx: sampleReviewsResultCtx(), expect: (result) => { assert.equal(result.value, 4490); assert.equal(result.detail, "3 checks"); },
    empty: sampleReviewsResultCtx({ result: null, history: [], calls: 0 }) }],

  checks_csv: { ctx: sampleReviewsResultCtx(), filename: "review-checks.csv",
    text: '"id","passed","level","label","detail"\r\n'
      + '"safety","yes","ok","No safety or health risk","2% that it reports an injury, illness, or foreign object (escalate at 50%)"\r\n'
      + '"about_us","yes","ok","About Harbor Coffee Co.","98% that it is about the shop (hold below 50%)"\r\n'
      + '"topic","yes","ok","Routed by topic","freshness (81%) goes to Roasting"\r\n'
      + '"severity","no","reply","No real problem reported","Severity 1.62 of 3 is P2 (P1 at 2.0, P2 at 1.0)"\r\n'
      + '"wants_reply","no","reply","No reply requested","93% that the reviewer asks for a reply, refund, or contact (reply at 60%)"\r\n'
      + '"rating","yes","ok","Stars match the words","2 stars sit at level 1; the words read 1.05 of 4, 0.05 levels apart (flag at 2.0)"\r\n',
    excludes: ["papery"] },
  // at: 1 700 000 000 000 ms is 2023-11-14T22:13:20Z, and the next checks are one and two minutes later.
  history_csv: { ctx: sampleReviewsResultCtx(), filename: "review-session.csv",
    text: '"call","at","stars","channel","topic","severity","tone","safety","wants_reply","about_us","latency_ms","cost_usd"\r\n'
      + '"1","2023-11-14T22:13:20.000Z","5","maps","cafe_service","1.62","1.05","0.02","0.93","0.98","820","0.00041"\r\n'
      + '"2","2023-11-14T22:14:20.000Z","2","website","freshness","1.62","1.05","0.02","0.93","0.98","760","0.00043"\r\n'
      + '"3","2023-11-14T22:15:20.000Z","3","website","freshness","1.62","1.05","0.02","0.93","0.98","700","0.00042"\r\n',
    excludes: ["papery", "Pier Street", "reply,"],
    // An arrival time JavaScript cannot print as a date leaves the cell blank instead of failing the export.
    check: () => assert.match(feature("history_csv").build(sampleReviewsResultCtx({ history: [{ call: 1, at: 1e20, review: draft(2), answers: {}, meta: null }] })),
      /\r\n"1","","2","website","","","","","","","",""\r\n$/) },
  topic_csv: { ctx: sampleReviewsResultCtx({ matches: (item) => item.id !== "topic" }), filename: "review-topics.csv",
    text: '"topic","label","probability","routed_team"\r\n"freshness","Freshness","0.81","Roasting"\r\n"roast_flavor","Roast and flavor","0.12","Roasting"\r\n'
      + '"packaging_shipping","Packaging and shipping","0.03","Fulfillment"\r\n"delivery_timing","Delivery timing","0.01","Fulfillment"\r\n'
      + '"cafe_service","Café service","0.01","Cafés"\r\n"subscription_billing","Subscription and billing","0.005","Billing"\r\n'
      + '"equipment","Equipment","0.005","Equipment support"\r\n"other","Other","0.01","Customer care"\r\n',
    check: () => assert.throws(() => feature("topic_csv").build(sampleReviewsResultCtx({ result: null })), /no topic answer/) },
  policy_diff: { ctx: sampleReviewsResultCtx(), filename: "review-policy-changes.md",
    text: "# Policy changes from the defaults\n\n| Setting | Slider | Now | Default |\n| --- | --- | --- | --- |\n| wants_reply_at | Reviewer wants a reply at P ≥ | 0.6 | 0.5 |\n",
    excludes: ["papery", "freshness"],
    check: () => {
      assert.equal(feature("policy_diff").build(sampleReviewsResultCtx({ settings: { ...REVIEWS_POLICY } })), "# Policy changes from the defaults\n\nEvery setting is at its default.\n");
      assert.throws(() => feature("policy_diff").build(sampleReviewsResultCtx({ setup: null })), /not loaded/);
    } },

  stars_up: { ...starsCase(1, 5), check: (ctx) => {
    starsCase(1, 5).check(ctx);
    assert.equal(stepStars("stars_up").when(sampleReviewsResultCtx({ running: true })), false);
    assert.equal(stepStars("stars_up").when(sampleReviewsResultCtx({ draft: { ...draft(2), stars: null } })), false);
  } },
  stars_down: { ...starsCase(-1, 1), check: (ctx) => {
    starsCase(-1, 1).check(ctx);
    assert.throws(() => stepStars("stars_down").run(sampleReviewsResultCtx({ draft: draft(1) })), /already at 1/);
  } },
  reset_policy: { ctx: () => sampleReviewsResultCtx(), check: (ctx) => { assert.deepEqual(ctx.log, [["resetPolicy"]]); assert.deepEqual([...ctx.data.changed], []); },
    hidden: () => sampleReviewsResultCtx({ settings: { ...REVIEWS_POLICY } }) },
  copy_reasons: { ctx: () => sampleReviewsResultCtx(),
    check: (ctx) => { assert.deepEqual(ctx.env.copied, ["A person replies: the reviewer asks for a reply; severity 1.62 is at or above the P2 cut"]); assert.equal(ctx.log.length, 0); },
    hidden: () => sampleReviewsResultCtx({ result: null }) },
  focus_moved: { ctx: () => sampleReviewsResultCtx({ settings: { ...REVIEWS_POLICY, p1_at: 2.5, wants_reply_at: 0.6 } }),
    check: (ctx) => assert.deepEqual(ctx.log, [["focusPolicy", "wants_reply_at"]]),
    hidden: () => sampleReviewsResultCtx({ settings: { ...REVIEWS_POLICY } }) },

  session_checks: { improvements: {
    table: (t) => {
      const rows = rowsOf(t, t.render(sampleReviewsResultCtx()), "data-call");
      assert.deepEqual(rows.map((row) => row.attrs["data-call"]), ["1", "2", "3"]);
      assert.equal(t.textOf(rows[0]), "#15cafe service1.621.05820 ms$0.00041");
      assert.equal(t.textOf(rows[1]), "#22freshness1.621.05760 ms$0.00043");
      assert.match(t.textOf(t.render(sampleReviewsResultCtx({ result: null, history: [], calls: 0 }))), /Triage a review/);
    },
    shown_row: (t) => {
      const rows = rowsOf(t, t.render(sampleReviewsResultCtx()), "data-call");
      assert.deepEqual(rows.map((row) => row.attrs["data-shown"]), ["false", "false", "true"]);
      assert.ok(t.textOf(rows[2]).endsWith("shown"));
      // With the result cleared (an example picked), no earlier check is presented as the shown one.
      assert.deepEqual(rowsOf(t, t.render(sampleReviewsResultCtx({ result: null })), "data-call").map((row) => row.attrs["data-shown"]), ["false", "false", "false"]);
    },
    copy: (t) => {
      const tree = t.render(sampleReviewsResultCtx());
      t.fire(t.find(tree, (node) => node.attrs?.["data-copy"] === "session"), "click");
      assert.deepEqual(t.env.copied, ["check\tstars\ttopic\tseverity\ttone\tlatency_ms\tcost_usd\tshown\n1\t5\tcafe service\t1.62\t1.05\t820\t0.00041\t\n"
        + "2\t2\tfreshness\t1.62\t1.05\t760\t0.00043\t\n3\t3\tfreshness\t1.62\t1.05\t700\t0.00042\tyes"]);
    },
  } },
  flip_points: { improvements: {
    table: (t) => {
      const rows = rowsOf(t, t.render(sampleReviewsResultCtx()), "data-flip");
      assert.deepEqual(rows.map((row) => [row.attrs["data-flip"], t.textOf(row.children[4]), t.textOf(row.children[5])]), FLIPS);
      // About-us at exactly 1 is on the "at or above" side and no step above 1 exists on its slider.
      const edge = rowsOf(t, t.render(withResult((result) => { result.answers.about_us = { type: "noul", noul: 1 }; })), "data-flip")
        .find((row) => row.attrs["data-flip"] === "about_us:about_us_min");
      assert.equal(t.textOf(edge.children[5]), "outside the slider");
      assert.match(t.textOf(t.render(sampleReviewsResultCtx({ result: null }))), /Triage a review/);
    },
    move: (t) => {
      const ctx = sampleReviewsResultCtx();
      t.fire(t.find(t.render(ctx), (node) => node.attrs?.["data-move"] === "wants_reply_at"), "click");
      assert.deepEqual(ctx.log, [["setPolicy", { ...REVIEWS_POLICY, wants_reply_at: 0.95 }]]);
      assert.equal(ctx.state.settings.wants_reply_at, 0.95);
      assert.match(t.env.toasts[0].message, /no Jev call/);
      const unloaded = sampleReviewsResultCtx({ setup: null });
      t.fire(t.find(t.render(unloaded), (node) => node.attrs?.["data-move"] === "safety_at"), "click");
      assert.deepEqual(unloaded.log, []);
      assert.deepEqual(t.env.toasts[1], { message: "The policy has not loaded yet.", kind: "error" });
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleReviewsResultCtx()), (node) => node.attrs?.["data-copy"] === "flips"), "click");
      assert.deepEqual(t.env.copied, ["question\tanswer\tsetting\tcut\tside now\tflips at\nseverity\t1.62\tp1_at\t2\tbelow\t1.6\nseverity\t1.62\tp2_at\t1\tat or above\t1.7\n"
        + "tone\t1.05\tthank_tone_at\t3\tbelow\t1\nsafety\t0.02\tsafety_at\t0.5\tbelow\t0\nwants_reply\t0.93\twants_reply_at\t0.6\tat or above\t0.95\n"
        + "about_us\t0.98\tabout_us_min\t0.5\tat or above\t1"]);
    },
  } },

  // 2 stars sit at level 1 and tone 1.05 is 0.05 away (as the fixture's rating check says); 5 stars and tone 0.4: 3.6.
  rating_gap: { values: { stars: 2, tone: 1.05, cut: 2 }, expect: [["Star level", 1], ["Rating gap", 0.05], ["At or above the cut", "no"]], tolerance: 1e-9,
    more: [{ values: { stars: 5, tone: 0.4 }, expect: [["Star level", 4], ["Rating gap", 3.6], ["At or above the cut", "yes"]], tolerance: 1e-9 }],
    invalid: [{ stars: 0, tone: 1 }, { stars: 2.5, tone: 1 }, { stars: 3, tone: 5 }] },
}, { ctx: () => sampleReviewsResultCtx() });
