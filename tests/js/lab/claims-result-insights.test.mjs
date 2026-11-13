import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/claims/claims-result-insights.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { CLAIMS_POLICY, sampleClaimsResult, sampleClaimsResultCtx } from "./fixtures/claims.mjs";

// The fixture's shown check ("Crushed box" on A-1044): shows_item 0.94, damage_visible 0.81, severity 1.20 (levels
// 0.05 / 0.70 / 0.20 / 0.05, confidence 0.70), damage_kind crushed_or_dented 0.66 (runner-up torn_or_open 0.18,
// confidence 0.66), matches_note 0.62 and a raw box 0.55–0.95 × 0.10–0.45 at confidence 0.52 on a 640 × 480 PNG.
// Policy in force: the defaults with matches_note moved to 0.60. Decision: review, $32.00 of a $64.00 order.
const page = sampleClaimsResultCtx();
const items = page.items();
const withResult = (change) => {
  const result = sampleClaimsResult();
  change(result);
  return result;
};
const noBox = () => sampleClaimsResultCtx({ result: withResult((r) => { delete r.answers.damage_box; delete r.trace.request.questions.damage_box; }) });
const empty = () => sampleClaimsResultCtx({ result: null, input: null, history: [], calls: 0 });
const policyCtx = fakeCtx({ data: { policy: { ...CLAIMS_POLICY } } });

checkPack(pack, {
  type: { items, values: ["noul", "noul", "score", "choice", "noul", "box"] },
  yes_probability: { items, values: [0.94, 0.81, null, null, 0.62, null] },
  confidence: { items, values: [null, null, 0.7, 0.66, null, 0.52] },
  top_probability: { items, values: [0.94, 0.81, 0.7, 0.66, 0.62, null] },
  // |0.94 - 0.50|, min(|0.81 - 0.30|, |0.81 - 0.70|), |1.20 - 1.50|, no cut, |0.62 - 0.60|, |0.52 - 0.60| (confidence)
  cut_distance: { items, values: [0.44, 0.11, 0.3, null, 0.02, 0.08], tolerance: 1e-9 },
  // severity 0.70 - 0.20, kind 0.66 - 0.18; nouls and the box have no runner-up
  runner_up_lead: { items, values: [null, null, 0.5, 0.48, null, null], tolerance: 1e-9 },
  instructions: { items: [items[0], items[3], { instructions: "" }], values: [
    "Does `photo` show the item described in `order.items`, or the packaging it was shipped in?", "What kind of damage does `photo` show?", ""] },
  failing_check: { items: [{ check: { id: "damage", ok: false } }, { check: { id: "shows_item", ok: true } }, { check: null }], values: [true, false, false] },

  // matches_note 0.62 vs 0.60; a box at confidence 0.57 vs box_confidence 0.60. The shown box (0.52, 0.08 away) is quiet.
  near_cut: { hit: [items[4], { type: "box", confidence: 0.57, cuts: [{ key: "box_confidence", at: 0.6 }] }], miss: [items[0], items[1], items[3], items[5]],
    message: /^(value 0\.62 sits 0\.02 from matches_note 0\.60|confidence 0\.57 sits 0\.03 from box_confidence 0\.60); a small slider move/ },
  narrow_lead: { hit: { type: "choice", probabilities: [{ key: "torn_or_open", p: 0.45 }, { key: "spilled_or_leaking", p: 0.4 }] }, miss: [items[2], items[3], items[0]],
    message: /leads by only 0\.05/ },
  // 0.8 × 0.8 = 64%; edges in the wrong order have no area rather than a positive product of two negatives.
  wide_box: { hit: { type: "box", box: { left: 0, top: 0, right: 0.8, bottom: 0.8 } },
    miss: [items[5], items[0], { type: "box", box: { left: 0.9, top: 0.9, right: 0.1, bottom: 0.1 } }], message: /covers 64% of the picture/ },
  kind_vs_damage: { hitList: [{ id: "damage_kind", value: "none_visible" }, { id: "damage_visible", value: 0.8 }], missList: items, ctx: policyCtx,
    message: /none_visible but damage_visible is 0\.80 \(at or above 0\.70\)/ },
  severity_vs_damage: { hitList: [{ id: "severity", value: 1.4 }, { id: "damage_visible", value: 0.2 }],
    missList: [{ id: "severity", value: 1.4 }, { id: "damage_visible", value: 0.81 }], ctx: policyCtx, message: /^severity 1\.40 but damage_visible 0\.20 is below 0\.30/ },

  // $32 of $64; a full refund of the whole order is 100%.
  refund_share: [{ ctx: page, expect: 0.5, empty: empty() },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.amount = 64; }) }), expect: 1 },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.decision = "reject"; }) }), expect: null }],
  // Only the window check fails; an odd entry in the list is skipped rather than breaking the count.
  failing_checks: [{ ctx: page, expect: 1, empty: empty() },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.checks = [null, { id: "a", ok: false }, { id: "b", ok: false }, { id: "c", ok: true }]; }) }), expect: 2 }],
  // 0.40 × 0.35 of the picture
  box_area: [{ ctx: page, expect: 0.14, tolerance: 1e-9, empty: empty() }, { ctx: noBox(), expect: null }],
  // 0.40 × 640 = 256 and 0.35 × 480 = 168
  // Floor/ceil: 0.551 × 640 = 352.64 -> 352, 0.951 × 640 = 608.64 -> 609 (257 px); 0.101 × 480 = 48.48 -> 48,
  // 0.451 × 480 = 216.48 -> 217 (169 px). Rounding the width (0.4 × 640) would say 256 and disagree with the Box inspector.
  box_pixels: [{ ctx: page, expect: "256 × 168 px", empty: empty() }, { ctx: noBox(), expect: null },
    { ctx: sampleClaimsResultCtx({ result: withResult((r) => { r.answers.damage_box.box = { left: 0.551, top: 0.101, right: 0.951, bottom: 0.451 }; }) }), expect: "257 × 169 px" }],
  cost_per_thousand: [{ ctx: page, expect: 0.412, tolerance: 1e-9, empty: empty() }],
  tokens_per_question: [{ ctx: page, expect: 1840 / 6, tolerance: 1e-12, empty: empty() }],
  // approve, retake, review, review when sent
  session_approvals: [{ ctx: page, expect: (result) => { assert.equal(result.value, 0.25); assert.equal(result.detail, "1 of 4"); }, empty: empty() }],
  settings_changed: [{ ctx: page, expect: 1, empty: sampleClaimsResultCtx({ setup: null }) },
    { ctx: sampleClaimsResultCtx({ settings: { ...CLAIMS_POLICY, auto_limit_usd: 150, damage_no: 0.2 } }), expect: 2 }],
  // 0.000398 + 0.000401 + 0.000356 + 0.000412
  session_cost: [{ ctx: page, expect: 0.001567, tolerance: 1e-9, empty: empty() }],

  decision_summary: { ctx: page, filename: "claim-A-1044.txt",
    text: "Claim decision for order A-1044 (your own check)\n"
      + "Photo: sample crushed-box\n"
      + "Decision: Send to a person (review)\n"
      + "Remedy: 50% credit or a replacement · $32.00\n"
      + "Reasons:\n- Delivered 41 days ago\n"
      + "Checks (plain code):\n"
      + "- [ok] Not already refunded: No previous refund\n"
      + "- [review] Within 30-day window: Delivered 41 days ago\n"
      + "- [ok] Photo shows the order: 94% that the photo shows this item or its packaging\n"
      + "- [ok] Damage visible: 81% that damage is visible\n"
      + "- [ok] Matches the customer's description: 62% that the photo shows the problem described\n"
      + "- [ok] Within the automatic limit: $32.00 against a $100.00 limit\n"
      + "Policy in force: damage_yes 0.70, damage_no 0.30, shows_order 0.50, matches_note 0.60, box_confidence 0.60, full_refund_at 1.50, auto_limit_usd 100.00\n",
    excludes: ["crushed on one corner", "0.94"],
    // An order id unfit for a file name falls back, and a verdict missing its lists and amount still exports.
    check: () => {
      const odd = runExporter(pack.features.find((feature) => feature.id === "decision_summary"),
        sampleClaimsResultCtx({ input: { order: "../x", note: "", photo: null }, result: withResult((r) => { r.verdict = { decision: "review", remedy: "full_refund" }; }) }));
      assert.equal(odd.filename, "claim-decision.txt");
      assert.match(odd.text, /Remedy: Full refund · amount unknown\nReasons:\nChecks \(plain code\):\nPolicy in force:/);
    } },
  answers_csv: { ctx: sampleClaimsResultCtx({ matches: (item) => item.id === "severity" || item.id === "damage_box" }), filename: "claim-answers.csv",
    text: "\"id\",\"type\",\"value\",\"display\",\"confidence\",\"top_key\",\"top_p\"\r\n"
      + "\"severity\",\"score\",\"1.2\",\"1.20 / 3\",\"0.7\",\"1\",\"0.7\"\r\n"
      + "\"damage_box\",\"box\",\"\",\"40% × 35%\",\"0.52\",\"\",\"\"\r\n" },
  policy_json: { ctx: page, filename: "claims-policy.json",
    text: "{\n  \"damage_yes\": 0.7,\n  \"damage_no\": 0.3,\n  \"shows_order\": 0.5,\n  \"matches_note\": 0.6,\n  \"box_confidence\": 0.6,\n"
      + "  \"full_refund_at\": 1.5,\n  \"auto_limit_usd\": 100\n}\n" },
  checks_markdown: { ctx: page, filename: "claim-checks.md",
    text: "| check | result | detail |\n| --- | --- | --- |\n"
      + "| Not already refunded | ok | No previous refund |\n"
      + "| Within 30-day window | review | Delivered 41 days ago |\n"
      + "| Photo shows the order | ok | 94% that the photo shows this item or its packaging |\n"
      + "| Damage visible | ok | 81% that damage is visible |\n"
      + "| Matches the customer's description | ok | 62% that the photo shows the problem described |\n"
      + "| Within the automatic limit | ok | $32.00 against a $100.00 limit |\n" },
  session_csv: { ctx: page, filename: "claims-session.csv",
    includes: ["\"call\",\"order\",\"example\",\"photo\",\"note\",\"decision_when_sent\",\"amount_when_sent\",\"model\",\"cost_usd\"\r\n",
      "\"1\",\"A-1041\",\"Torn bag\",\"sample: torn-bag\",\"One bag's seal was torn open and beans spilled all over the box.\",\"approve\",\"38.00\",\"jev-1.16\",\"0.000398\"\r\n",
      "\"3\",\"A-1042\",\"\",\"upload: hopper-crack.jpg\",\"The hopper cracked along the seam on day one.\",\"review\",\"249.00\",\"jev-1.12\",\"0.000356\"\r\n",
      "\"4\",\"A-1044\",\"Crushed box\",\"sample: crushed-box\""],
    excludes: ["noul", "crushed_or_dented"] },

  // A $249 full refund against the $100 limit: the limit moves to the next $5 step at or above it, $250.
  cover_refund: { ctx: () => sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.amount = 249; }) }),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setPolicy", { ...CLAIMS_POLICY, matches_note: 0.6, auto_limit_usd: 250 }]]);
      assert.match(ctx.env.toasts[0].message, /\$250/);
      const when = pack.features.find((feature) => feature.id === "cover_refund").when;
      assert.equal(when(sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.amount = 249; r.verdict.decision = "reject"; }) })), false);
      // $100.00 exactly is within the $100 limit; $401 would need a limit past the slider's $400.
      assert.equal(when(sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.amount = 100; }) })), false);
      assert.equal(when(sampleClaimsResultCtx({ result: withResult((r) => { r.verdict.amount = 401; }) })), false);
    },
    // Within the limit there is nothing to cover; a rejected claim has no refund to cover.
    hidden: () => sampleClaimsResultCtx(),
  },
  focus_damage_slider: { ctx: () => sampleClaimsResultCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["focusPolicy", "damage_yes"]]) },

  // 0.55 × 640 = 352, 0.10 × 480 = 48, 0.95 × 640 = 608, 0.45 × 480 = 216; 0.40 × 0.35 = 0.14.
  box_to_pixels: { values: { left: 0.55, top: 0.1, right: 0.95, bottom: 0.45, width: 640, height: 480 },
    expect: [["left px", 352], ["top px", 48], ["right px", 608], ["bottom px", 216], ["width px", 256], ["height px", 168], ["share of the picture", 0.14]], tolerance: 1e-9,
    more: [{ values: { left: 0, top: 0, right: 1, bottom: 1, width: 300, height: 280 },
      expect: [["left px", 0], ["top px", 0], ["right px", 300], ["bottom px", 280], ["width px", 300], ["height px", 280], ["share of the picture", 1]] },
    // 352.64 -> 352, 48.48 -> 48, 608.64 -> 609, 216.48 -> 217
    { values: { left: 0.551, top: 0.101, right: 0.951, bottom: 0.451, width: 640, height: 480 }, tolerance: 1e-9,
      expect: [["left px", 352], ["top px", 48], ["right px", 609], ["bottom px", 217], ["width px", 257], ["height px", 169], ["share of the picture", 0.14]] }],
    invalid: [{ left: 0.6, top: 0.1, right: 0.5, bottom: 0.4, width: 640, height: 480 }, { left: 0.1, top: 0.1, right: 0.5, bottom: 0.4, width: 0, height: 480 },
      { left: 0.1, top: 0.1, right: 1.5, bottom: 0.4, width: 640, height: 480 }] },
}, { ctx: () => sampleClaimsResultCtx() });
