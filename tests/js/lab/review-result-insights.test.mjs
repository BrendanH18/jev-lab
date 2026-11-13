import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/reviews/review-result-insights.js";
import { checkPack } from "./harness.mjs";
import { REVIEWS_POLICY, sampleReviewsResult, sampleReviewsResultCtx } from "./fixtures/reviews.mjs";

const severityCuts = [{ key: "p1_at", at: 2 }, { key: "p2_at", at: 1 }];
const only = (...ids) => sampleReviewsResultCtx({ matches: (item) => ids.includes(item.id) });
const escalated = () => {
  const result = sampleReviewsResult();
  result.triage = { ...result.triage, action: "escalate", checks: [{ id: "safety", ok: false, level: "escalate", label: "No safety or health risk", detail: "91%" }] };
  return sampleReviewsResultCtx({ result });
};

checkPack(pack, {
  top_p: { items: [{ top: { key: "freshness", p: 0.81 } }, { top: { key: "no", p: 0.98 } }, { top: null }], values: [0.81, 0.98, null] },
  // 0.81 - 0.12 from unsorted options; a Noul's 0.93 against 1 - 0.93; one option has no runner-up.
  margin: { items: [{ probabilities: [{ key: "roast_flavor", p: 0.12 }, { key: "freshness", p: 0.81 }, { key: "other", p: 0.03 }] },
    { probabilities: [{ key: "yes", p: 0.93 }, { key: "no", p: 1 - 0.93 }] }, { probabilities: [{ key: "a", p: 1 }] }, {}],
  values: [0.69, 0.86, null, null], tolerance: 1e-9 },
  // Severity 1.62 sits 0.38 below P1 (2) and 0.62 above P2 (1); a topic has no cut; a missing value has no distance.
  cut_distance: { items: [{ value: 1.62, cuts: severityCuts }, { value: 0.93, cuts: [{ key: "wants_reply_at", at: 0.6 }] }, { value: "freshness", cuts: [] },
    { value: null, cuts: [{ key: "safety_at", at: 0.5 }] }], values: [0.38, 0.33, null, null], tolerance: 1e-9 },
  confidence: { items: [{ confidence: 0.81 }, { confidence: 0.6 }, { confidence: null }], values: [0.81, 0.6, null] },
  // An even split is 1, a certainty 0, and 0.9/0.1 is (0.9 ln 1/0.9 + 0.1 ln 10) / ln 2 = 0.468996; weights are normalized.
  entropy: { items: [{ probabilities: [{ key: "a", p: 0.5 }, { key: "b", p: 0.5 }] }, { probabilities: [{ key: "a", p: 1 }, { key: "b", p: 0 }] },
    { probabilities: [{ key: "a", p: 0.9 }, { key: "b", p: 0.1 }] }, { probabilities: [{ key: "a", p: 2 }, { key: "b", p: 2 }] }, { probabilities: [{ key: "a", p: 1 }] }],
  values: [1, 0, 0.468996, 1, null], tolerance: 1e-6 },
  options: { items: [{ probabilities: sampleReviewsResultCtx().items()[0].probabilities }, { probabilities: [{ key: "yes", p: 0.2 }, { key: "no", p: 0.8 }] }, { probabilities: [] }],
    values: [8, 2, null] },
  type: { items: [{ type: "choice" }, { type: "noul" }, { type: "" }], values: ["choice", "noul", null] },
  question: { items: [{ instructions: "What is `review.text` mainly about?" }, { instructions: "How serious is the problem?" }, {}],
    values: ["What is `review.text` mainly about?", "How serious is the problem?", ""] },
  reading: { items: [{ label: "Freshness", display: "freshness" }, { label: "", display: "93.0%" }, { label: "", display: "" }], values: ["Freshness", "93.0%", ""] },
  // 0.55 is 0.05 from 0.5 and 2.1 is 0.1 from 2 (inclusive); 1.62 is 0.38 from its nearest cut.
  close_call: { items: [{ value: 0.55, cuts: [{ key: "safety_at", at: 0.5 }] }, { value: 1.62, cuts: severityCuts }, { value: 2.1, cuts: [{ key: "p1_at", at: 2 }] },
    { value: "freshness", cuts: [] }], values: [true, false, true, false] },
  has_cut: { items: [{ cuts: [{ key: "safety_at", at: 0.5 }] }, { cuts: [] }, {}], values: [true, false, false] },

  between_levels: { hit: [{ type: "score", value: 1.5 }, { type: "score", value: 0.35 }], miss: [{ type: "score", value: 1.05 }, { type: "noul", value: 0.5 }, { type: "score", value: null }],
    message: /^Score (1\.50 sits between levels 1 and 2|0\.35 sits between levels 0 and 1)\.$/ },
  low_confidence: { hitList: [{ type: "choice", confidence: 0.4 }, { type: "score", confidence: 0.3 }, { type: "noul", confidence: null }],
    missList: [{ type: "choice", confidence: 0.8 }, { type: "score", confidence: 0.6 }], message: /is 35%\.$/ },

  // safety, about_us, topic and rating pass; severity and wants_reply do not.
  checks_passed: [{ ctx: sampleReviewsResultCtx(), expect: (result) => { assert.ok(Math.abs(result.value - 4 / 6) < 1e-12); assert.equal(result.detail, "4 of 6"); },
    empty: sampleReviewsResultCtx({ result: null }) }, { ctx: escalated(), expect: 0 }],
  session_cost: [{ ctx: sampleReviewsResultCtx(), expect: 0.00126, tolerance: 1e-9, empty: sampleReviewsResultCtx({ result: null, history: [], calls: 0 }) }],
  mean_latency: [{ ctx: sampleReviewsResultCtx(), expect: (820 + 760 + 700) / 3, empty: sampleReviewsResultCtx({ result: null, history: [] }) }],
  p1_headroom: [{ ctx: sampleReviewsResultCtx(), expect: 0.38, tolerance: 1e-9, empty: sampleReviewsResultCtx({ result: null }) },
    { ctx: sampleReviewsResultCtx({ result: { ...sampleReviewsResult(), policy: { ...REVIEWS_POLICY, p1_at: 1.5 } } }), expect: -0.12, tolerance: 1e-9 }],
  changed_settings: [{ ctx: sampleReviewsResultCtx(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "wants_reply_at 0.6 (default 0.5)"); },
    empty: sampleReviewsResultCtx({ setup: null }) }, { ctx: sampleReviewsResultCtx({ settings: { ...REVIEWS_POLICY } }), expect: 0 }],

  decision_markdown: {
    ctx: sampleReviewsResultCtx(),
    filename: "review-decision.md",
    text: ["# Review decision", "", "Your latest check of a Website review, decided by plain code under the policy below.", "",
      "- Action: A person replies", "- Team: Roasting", "- Priority: P2", "- Flags: none", "- Public auto-reply: no", "",
      "## Reasons", "", "- A person replies: the reviewer asks for a reply; severity 1.62 is at or above the P2 cut", "",
      "## Checks", "",
      "- [x] No safety or health risk: 2% that it reports an injury, illness, or foreign object (escalate at 50%)",
      "- [x] About Harbor Coffee Co.: 98% that it is about the shop (hold below 50%)",
      "- [x] Routed by topic: freshness (81%) goes to Roasting",
      "- [ ] No real problem reported: Severity 1.62 of 3 is P2 (P1 at 2.0, P2 at 1.0)",
      "- [ ] No reply requested: 93% that the reviewer asks for a reply, refund, or contact (reply at 60%)",
      "- [x] Stars match the words: 2 stars sit at level 1; the words read 1.05 of 4, 0.05 levels apart (flag at 2.0)", "",
      "## Policy", "", "| Setting | Value |", "| --- | ---: |", "| safety_at | 0.5 |", "| about_us_min | 0.5 |", "| wants_reply_at | 0.6 |",
      "| p1_at | 2 |", "| p2_at | 1 |", "| mismatch_gap | 2 |", "| thank_tone_at | 3 |", ""].join("\n"),
    excludes: ["papery", "Harbor House Blend"],
    check: () => assert.throws(() => pack.features.find((feature) => feature.id === "decision_markdown").build(sampleReviewsResultCtx({ result: null })), /Triage a review first/),
  },
  answers_csv: {
    ctx: only("topic", "severity", "safety"),
    filename: "review-answers.csv",
    text: '"question","type","value","label","top","top_probability","confidence"\r\n'
      + '"topic","choice","freshness","Freshness","freshness","0.81","0.81"\r\n'
      + '"severity","score","1.62","Real problem: it cost the customer money, time, or product","2","0.6","0.6"\r\n'
      + '"safety","noul","0.02","","no","0.98",""\r\n',
    excludes: ["tone", "papery"],
  },
  policy_json: {
    ctx: sampleReviewsResultCtx({ result: null }),
    filename: "review-policy.json",
    text: '{\n  "safety_at": 0.5,\n  "about_us_min": 0.5,\n  "wants_reply_at": 0.6,\n  "p1_at": 2,\n  "p2_at": 1,\n  "mismatch_gap": 2,\n  "thank_tone_at": 3\n}\n',
  },

  copy_decision: { ctx: () => sampleReviewsResultCtx(), check: (ctx) => assert.deepEqual(ctx.env.copied, ["A person replies · Roasting · P2 · no flags"]),
    hidden: () => sampleReviewsResultCtx({ result: null }) },
  raise_safety: { ctx: () => sampleReviewsResultCtx(),
    check: (ctx) => { assert.deepEqual(ctx.log, [["setPolicy", { ...REVIEWS_POLICY, wants_reply_at: 0.6, safety_at: 0.55 }]]); assert.equal(ctx.data.settings.safety_at, 0.55); },
    hidden: () => sampleReviewsResultCtx({ settings: { ...REVIEWS_POLICY, safety_at: 1 } }) },
  lower_safety: { ctx: () => sampleReviewsResultCtx(),
    check: (ctx) => { assert.deepEqual(ctx.log, [["setPolicy", { ...REVIEWS_POLICY, wants_reply_at: 0.6, safety_at: 0.45 }]]); assert.equal(ctx.data.settings.safety_at, 0.45); },
    hidden: () => sampleReviewsResultCtx({ settings: { ...REVIEWS_POLICY, safety_at: 0 } }) },
  inspect: { ctx: () => sampleReviewsResultCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["inspect"]]), hidden: () => sampleReviewsResultCtx({ result: null }) },

  cut_margins: { improvements: {
    table: (t) => {
      const tree = t.render(sampleReviewsResultCtx());
      const rows = t.findAll(tree, (node) => node.tag === "tr" && node.attrs["data-cut"]);
      assert.deepEqual(rows.map((row) => row.attrs["data-cut"]),
        ["severity:p1_at", "severity:p2_at", "tone:thank_tone_at", "safety:safety_at", "wants_reply:wants_reply_at", "about_us:about_us_min"]);
      assert.deepEqual(rows.map((row) => t.textOf(row.children[4])), ["-0.38", "+0.62", "-1.95", "-0.48", "+0.33", "+0.48"]);
      assert.match(t.textOf(t.render(sampleReviewsResultCtx({ result: null }))), /Triage a review/);
    },
    copy: (t) => {
      const tree = t.render(sampleReviewsResultCtx());
      t.fire(t.find(tree, (node) => node.attrs?.["data-copy"] === "margins"), "click");
      assert.deepEqual(t.env.copied, ["question\tanswer\tcut\tat\tmargin\nseverity\t1.62\tp1_at\t2\t-0.38\nseverity\t1.62\tp2_at\t1\t+0.62\n"
        + "tone\t1.05\tthank_tone_at\t3\t-1.95\nsafety\t0.02\tsafety_at\t0.5\t-0.48\nwants_reply\t0.93\twants_reply_at\t0.6\t+0.33\nabout_us\t0.98\tabout_us_min\t0.5\t+0.48"]);
    },
  } },
}, { ctx: () => sampleReviewsResultCtx() });
