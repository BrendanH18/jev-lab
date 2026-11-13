import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/shield/shield-signal-insights.js";
import { checkPack } from "./harness.mjs";
import { DEFAULT_POLICY, DEFAULT_WEIGHTS, sampleShieldResultCtx, signalsById } from "./fixtures/shield.mjs";

const ctx = (overrides) => sampleShieldResultCtx(overrides);
const base = ctx();                                         // bec-invoice opened
const R = signalsById(base);
const packright = ctx({ selected: "packright-proof" });
const P = signalsById(packright);
// Defaults that differ from the weights the verdict used: ai_instructions 0.8 (verdict 0.9), pressure 0.5 (verdict 0.3).
const moved = ctx({ defaults: { weights: { ...DEFAULT_WEIGHTS, ai_instructions: 0.8, pressure: 0.5 }, policy: { ...DEFAULT_POLICY } } });
const M = signalsById(moved);
const empty = () => ctx({ selected: "northside-reschedule" });

checkPack(pack, {
  value: { items: [R.ai_instructions, R.pressure, R.unexpected_reward], values: [0.97, 0.95, 0.02] },
  weight: { items: [R.ai_instructions, R.secrecy_or_bypass, R.unexpected_reward], values: [0.9, 0.5, 0.4] },
  contribution: { items: [R.ai_instructions, R.link_lure, R.unexpected_reward], values: [0.873, 0.072, 0.008], tolerance: 1e-9 },
  // All eight contributions of bec sum to 0.873 + 0.054 + 0.588 + 0.45 + 0.072 + 0.008 + 0.285 + 0.616 = 2.946.
  share: { ctx: base, items: [R.ai_instructions, R.unexpected_reward], values: [0.2963340122, 0.0027155465], tolerance: 1e-9 },
  weight_change: { ctx: moved, items: [M.ai_instructions, M.pressure, M.unexpected_reward], values: [0.1, -0.2, 0], tolerance: 1e-9 },
  source: { items: [R.ai_instructions, R.pressure, R.identity_mismatch], values: ["Noul answer", "Score answer", "code check"] },
  name: { items: [R.ai_instructions, R.identity_mismatch], values: ["Instructs an AI", "Domain mismatch"] },
  // payment_change 0.98 feeds impersonation; link_lure 0.12 is under 0.5, so it does not.
  hard_rule: { items: [R.ai_instructions, R.payment_change, R.link_lure], values: [true, true, false] },
  reweighted: { items: [M.ai_instructions, M.unexpected_reward], values: [true, false] },
  // packright: link_lure 0.55 and pressure 1 / 2 = 0.5 are undecided; ai_instructions 0.02 is not.
  uncertain: { items: [P.link_lure, P.pressure, P.ai_instructions], values: [true, true, false] },

  muted: { hit: { ...R.ai_instructions, weight: 0, contribution: 0 }, miss: [R.ai_instructions, R.unexpected_reward],
    message: /^Instructs an AI is 97\.0%, but its weight 0\.00 lets it add only 0\.0% to the risk\.$/ },
  near_hard_rule: { ctx: base, hit: { ...R.credential_request, value: 0.65 }, miss: [R.ai_instructions, R.credential_request, { ...R.payment_change, value: 0.65 }],
    message: /^Credential ask is 65\.0%, 5\.0 points under the hard-rule cut \(70\.0%\) for credential_phish\.$/ },
  // 0.873 of 0.873 + 0.008 is 99.1%; bec's own top share is 29.6%.
  single_driver: { hitList: [R.ai_instructions, R.unexpected_reward], missList: base.items(), message: /^Instructs an AI holds 99\.1% of all contributions/ },

  // bec without 0.873: 1 − (0.946 × 0.412 × 0.55 × 0.715 × 0.928 × 0.992 × 0.384) = 0.9458188827. packright without
  // link_lure 0.33: 1 − (0.982 × 0.928 × 0.982 × 0.98 × 0.996 × 0.85) = 0.2575361866.
  risk_without_top: [{ ctx: base, expect: (result) => { assert.ok(Math.abs(result.value - 0.9458188827) < 1e-9); assert.equal(result.detail, "without Instructs an AI"); }, empty: empty() },
    { ctx: packright, expect: 0.2575361866, tolerance: 1e-9 }],
  // At the defaults the verdict's own risk, 0.9931189981; with ai_instructions' default at 0 it drops that signal.
  risk_at_defaults: [{ ctx: base, expect: 0.9931189981, tolerance: 1e-9, empty: empty() },
    { ctx: ctx({ defaults: { weights: { ...DEFAULT_WEIGHTS, ai_instructions: 0 }, policy: { ...DEFAULT_POLICY } } }), expect: 0.9458188827, tolerance: 1e-9 }],
  // bec: 0.873, 0.616, 0.588, 0.45, 0.285. packright: link_lure 0.33 and pressure 0.15 exactly.
  hot_count: [{ ctx: base, expect: 5, empty: empty() }, { ctx: packright, expect: 2 }],
  // bec: vendor_business 0.9 − other 0.06; packright 0.85 − 0.1; the odd message has no category answer.
  category_margin: [{ ctx: base, expect: 0.84, tolerance: 1e-9, empty: empty() }, { ctx: packright, expect: 0.75, tolerance: 1e-9 },
    { ctx: ctx({ selected: "message-9" }), expect: null }],
  // bec: bean_brokers 0.88 − other_organization 0.1; admin 0.91 − 0.07.
  identity_margin: [{ ctx: base, expect: 0.78, tolerance: 1e-9, empty: empty() }, { ctx: ctx({ selected: "admin-phish" }), expect: 0.84, tolerance: 1e-9 }],

  signals_csv: { ctx: ctx({ hide: Object.keys(R).filter((id) => id !== "ai_instructions" && id !== "unexpected_reward") }), filename: "shield-signals.csv",
    includes: ['"signal","name","source","value","weight","default_weight","contribution","hard_rules"\r\n',
      '"ai_instructions","Instructs an AI","noul","0.97","0.9","0.9","', '","prompt_injection"\r\n',
      '"unexpected_reward","Unexpected reward","noul","0.02","0.4","0.4","0.008",""\r\n'],
    excludes: ["URGENT", "beanbrokers", "payment_change"],
    check: (out) => assert.equal(out.text.split("\r\n").length, 4) },
  policy_json: { ctx: base, filename: "shield-policy.json", includes: ['  "weights": {\n    "ai_instructions": 0.9,', '"policy": {\n    "review_at": 0.3,'],
    excludes: ["bec", "0.97"],
    check: (out) => assert.deepEqual(JSON.parse(out.text), { weights: { ...DEFAULT_WEIGHTS }, policy: { ...DEFAULT_POLICY } }) },

  mute_top: { ctx: () => ctx(), hidden: empty,
    check: (c) => {
      assert.deepEqual(c.log, [["applyPolicy", { weights: { ai_instructions: 0 }, policy: null }]]);
      assert.equal(c.state.weights.ai_instructions, 0);
      assert.match(c.env.toasts[0].message, /^Instructs an AI weight set to 0\./);
    } },

  // 1 − 0.5 × 0.8; 1 − 0.127 × 0.384.
  noisy_or: { values: { contributions: "0.5, 0.2" }, expect: [["combined risk", 0.6], ["strongest alone", 0.5], ["signals", 2]], tolerance: 1e-12,
    more: [{ values: { contributions: "0.873\n0.616" }, expect: [["combined risk", 0.951232], ["strongest alone", 0.873], ["signals", 2]], tolerance: 1e-12 }],
    invalid: [{ contributions: "1.5" }, { contributions: "abc" }, { contributions: "  " }] },
  // 0.4 / 0.8; 0.5 / 0.4 is more than 1.
  weight_for: { values: { probability: 0.8, target: 0.4 }, expect: [["weight needed", 0.5]],
    more: [{ values: { probability: 0.4, target: 0.5 }, expect: (result) => { assert.deepEqual(result.rows, [["weight needed", 1]]); assert.match(result.note, /Even weight 1 gives only 0\.4/); } }],
    invalid: [{ probability: 0, target: 0.2 }, { probability: 1.2, target: 0.1 }, { probability: "x", target: 0.1 }] },
}, { ctx: () => ctx() });
