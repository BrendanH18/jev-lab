import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/shield/shield-result-more.js";
import { checkPack } from "./harness.mjs";
import { DEFAULT_POLICY, DEFAULT_WEIGHTS, sampleShieldResultCtx, signalsById } from "./fixtures/shield.mjs";

const ctx = (overrides) => sampleShieldResultCtx(overrides);
const base = ctx();                                 // bec-invoice opened
const packright = () => ctx({ selected: "packright-proof" });
const S = signalsById(base);
const P = signalsById(packright());
const unopened = () => ctx({ selected: "northside-reschedule" });
const applied = (c) => c.log.filter(([name]) => name === "applyPolicy").map(([, next]) => next);

// Reference values from a separate Python script over the fixture's bec answers and the default weights
// (contribution c = min(1, w × v); risk 1 − Π(1 − c)):
//   risk 0.9931189981053575; leave-one-out risk: ai 0.9458188827193508, identity_mismatch 0.982080724232702,
//   unexpected_reward 0.9930635061545943; one more weight step (Π over the other seven of (1 − c)) × 0.05 × v:
//   ai 0.002627784188111487, unexpected_reward 6.936493845405706e-06; every weight 1: 0.99999970816384.
//   packright: risk 0.5025492450267599, every weight 1: 0.81298580032.
//   Running risk in page order: 0.873, 0.951232, 0.979907584, 0.9889491712, 0.992098657408, 0.992667554074624,
//   0.9930635061545943, 0.9931189981053575.
const BEC_RISK = 0.9931189981053575;

checkPack(pack, {
  leave_out_risk: { ctx: base, items: [S.ai_instructions, S.identity_mismatch, S.unexpected_reward, { ...S.link_lure, contribution: null }],
    values: [0.9458188827193508, 0.982080724232702, 0.9930635061545943, null], tolerance: 1e-12 },
  // 0.15 / 0.97 = 0.155 → 0.2; 0.15 / 0.55 = 0.273 → 0.3; 0.15 / 0.5 = 0.3 exactly; 0.15 / 0.12 = 1.25 is out of reach.
  hot_weight: { ctx: base, items: [S.ai_instructions, P.link_lure, P.pressure, S.link_lure, P.identity_mismatch], values: [0.2, 0.3, 0.3, null, null] },
  // 0.9 × 0.97 and 0.7 × 0.88.
  default_contribution: { items: [S.ai_instructions, S.identity_mismatch, { ...S.ai_instructions, default_weight: null }], values: [0.873, 0.616, null], tolerance: 1e-12 },
  weight_step_gain: { ctx: base, items: [S.ai_instructions, S.unexpected_reward, { ...S.ai_instructions, weight: 1 }],
    values: [0.002627784188111487, 6.936493845405706e-06, null], tolerance: 1e-12 },
  driver: { items: [S.ai_instructions, S.secrecy_or_bypass, S.payment_change], values: [true, false, true] },
  // payment_change 0.98 and packright's link_lure 0.55 reach 0.5; bec's link_lure 0.12 does not; ai_instructions is not an ask.
  risky_ask: { ctx: base, items: [S.payment_change, S.link_lure, S.ai_instructions, P.link_lure], values: [true, false, false, true] },
  answer_text: { ctx: base, items: [S.ai_instructions, S.pressure, S.identity_mismatch, { ...S.ai_instructions, answer: null }],
    values: ["97.0% yes", "1.90 of 2 (Strong)", "Bean Brokers Ltd (88.0%)", ""] },
  feeds_rule: { items: [S.ai_instructions, S.identity_mismatch, S.payment_change, S.secrecy_or_bypass], values: ["prompt_injection", "impersonation", "impersonation", null] },

  rule_ignores_weight: { hit: { ...S.ai_instructions, weight: 0, contribution: 0 }, miss: [S.ai_instructions, S.secrecy_or_bypass],
    message: /^prompt_injection fired from Instructs an AI although its weight is 0: hard rules read the answer, not the weight\.$/ },
  split_score: { hit: { ...S.pressure, answer: { ...S.pressure.answer, value: 1.2, top: { key: "1", p: 0.45 } } }, miss: [S.pressure, S.ai_instructions],
    message: /^Time pressure: the most likely level \(1\) holds only 45\.0%, so the score 1\.20 averages across levels\.$/ },
  // bec: five rows at 0.15 or more, three named drivers. packright: two hot rows, both drivers.
  drivers_capped: { ctx: base, hitList: base.items(), missList: packright().items(), missCtx: packright(),
    message: /^The verdict names at most 3 drivers, so Secrecy \/ bypass, Time pressure also add 0\.15 or more without being named\.$/ },
  lure_from_vendor: { ctx: packright(), hitList: packright().items(), missList: base.items(), missCtx: base,
    message: /^Link lure is 55\.0% and the sender's domain matches PackRight Packaging \(packright\.example\)/ },

  risk_all_ones: [{ ctx: base, expect: 0.99999970816384, tolerance: 1e-12, empty: unopened() }, { ctx: packright(), expect: 0.81298580032, tolerance: 1e-12 }],
  // |0.5 − 0.9| + |0.5 − 0.3|.
  weights_moved: [{ ctx: ctx({ weights: { ...DEFAULT_WEIGHTS, ai_instructions: 0.5, pressure: 0.5 } }),
    expect: (result) => { assert.ok(Math.abs(result.value - 0.6) < 1e-12); assert.equal(result.detail, "2 sliders moved"); },
    empty: ctx({ weights: null, policy: null, defaults: null, results: {} }) },
  { ctx: base, expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "every weight at its default"); } }],
  // bec: levels 2 and 3 hold 0.1 + 0.9; packright: level 2 holds 0.5; the odd message has no loss answer.
  harm_moderate: [{ ctx: base, expect: 1, tolerance: 1e-12, empty: unopened() }, { ctx: packright(), expect: 0.5, tolerance: 1e-12 },
    { ctx: ctx({ selected: "message-9" }), expect: null }],
  identity_runner_up: [{ ctx: base, expect: (result) => { assert.equal(result.value, "Other organization"); assert.equal(result.detail, "10.0%"); }, empty: unopened() }],
  quarantine_gap: [{ ctx: base, expect: BEC_RISK - 0.6, tolerance: 1e-12, empty: unopened() },
    { ctx: packright(), expect: 0.5025492450267599 - 0.6, tolerance: 1e-12 }],

  request_json: { ctx: base, filename: "shield-request.json",
    includes: ['"subject": "URGENT: updated remittance details for INV-7781"', '"model": "jev-latest"', '"questions": {', '"harm_if_obeyed": {'],
    excludes: ['"answers"', '"verdict"', '"latency_ms"', '"probabilities"', '"noul": 0.97', '"score": 1.9', "jev-1.14.0"],
    check: (out) => assert.deepEqual(Object.keys(JSON.parse(out.text)), ["state", "questions", "model"]) },
  explainer_md: { ctx: ctx({ hide: ["identity_mismatch", "payment_change", "secrecy_or_bypass", "link_lure", "credential_request", "unexpected_reward"] }),
    filename: "shield-verdict.md", text: [
      "# Shield verdict", "",
      "- Verdict: quarantine",
      "- Combined risk: 99.3% (review at 30.0%, quarantine at 60.0%)",
      "- Loss if obeyed: 2.9 of 3",
      "- Drivers: Instructs an AI, Domain mismatch, Payment redirect", "",
      "## Hard rules that fired", "",
      "- prompt_injection (quarantine): Contains instructions aimed at an AI or automation",
      "- impersonation (quarantine): Claims to be Bean Brokers Ltd but sends from beanbrokers-payments.example", "",
      "## Signals", "",
      "| Signal | Value | Weight | Contribution |",
      "| --- | --- | --- | --- |",
      "| Instructs an AI | 0.97 | 0.90 | 0.873 |",
      "| Time pressure | 0.95 | 0.30 | 0.285 |", "",
      "Holds the answers and verdict of your own screen; no message text.", ""].join("\n"),
    excludes: ["Our bank has changed"] },
  weights_python: { ctx: ctx({ weights: { ...DEFAULT_WEIGHTS, pressure: 0.45 } }), filename: "shield_policy.py", text: [
    "# Shield slider settings: weights and thresholds only, no messages or answers.",
    "WEIGHTS = {", '    "ai_instructions": 0.9,', '    "credential_request": 0.9,', '    "payment_change": 0.6,', '    "secrecy_or_bypass": 0.5,',
    '    "link_lure": 0.6,', '    "unexpected_reward": 0.4,', '    "pressure": 0.45,', '    "identity_mismatch": 0.7,', "}",
    "POLICY = {", '    "review_at": 0.3,', '    "quarantine_at": 0.6,', '    "hard_rule_at": 0.7,', "}", ""].join("\n") },

  raise_review: { ctx: () => ctx(), hidden: () => ctx({ policy: { ...DEFAULT_POLICY, review_at: 1 } }),
    check: (c) => { assert.deepEqual(applied(c), [{ weights: null, policy: { review_at: 0.35 } }]); assert.equal(c.state.policy.review_at, 0.35); assert.match(c.env.toasts[0].message, /^review_at set to 0\.35\. .*no Jev call/); } },
  lower_review: { ctx: () => ctx(), hidden: () => ctx({ policy: { ...DEFAULT_POLICY, review_at: 0 } }),
    check: (c) => { assert.deepEqual(applied(c), [{ weights: null, policy: { review_at: 0.25 } }]); assert.equal(c.state.policy.review_at, 0.25); } },
  raise_quarantine: { ctx: () => ctx(), hidden: () => ctx({ policy: { ...DEFAULT_POLICY, quarantine_at: 1 } }),
    check: (c) => assert.deepEqual(applied(c), [{ weights: null, policy: { quarantine_at: 0.65 } }]) },
  lower_quarantine: { ctx: () => ctx(), hidden: () => ctx({ policy: null }),
    check: (c) => assert.deepEqual(applied(c), [{ weights: null, policy: { quarantine_at: 0.55 } }]) },
  inspect_result: { ctx: () => ctx(), hidden: unopened,
    check: (c) => { assert.equal(c.log.length, 1); assert.equal(c.log[0][0], "inspect"); assert.equal(c.log[0][2], "Shield · one Jev request"); assert.equal(c.log[0][1].request.model, "jev-latest"); } },
  // Defaults that differ from the verdict's weights for ai_instructions and pressure; pressure is filtered out.
  defaults_shown: { ctx: () => ctx({ defaults: { weights: { ...DEFAULT_WEIGHTS, ai_instructions: 0.5, pressure: 0.2 }, policy: { ...DEFAULT_POLICY } }, hide: ["pressure"] }),
    hidden: () => ctx(),
    check: (c) => { assert.deepEqual(applied(c), [{ weights: { ai_instructions: 0.5 }, policy: null }]); assert.match(c.env.toasts[0].message, /^Restored the default weight of Instructs an AI\./); } },

  what_if: { improvements: {
    try: (t) => {
      const c = ctx();
      const input = t.find(t.render(c), (node) => node.attrs?.["data-weight"] === "ai_instructions");
      assert.equal(input.attrs.value, "0.9");
      t.fire(input, "input", { target: { value: "0" } });
      assert.equal(t.find(t.render(c), (node) => node.attrs?.["data-weight"] === "ai_instructions").attrs.value, "0");
      t.fire(input, "input", { target: { value: "1.5" } });
      assert.equal(t.env.toasts.at(-1).kind, "error");
      assert.equal(applied(c).length, 0, "trying a weight leaves the page's sliders alone");
    },
    estimate: (t) => {
      const c = ctx();
      const estimate = () => t.textOf(t.find(t.render(c), (node) => node.attrs && "data-estimate" in node.attrs));
      assert.equal(estimate(), "Local estimate: 99.3% · verdict: 99.3%");
      t.fire(t.find(t.render(c), (node) => node.attrs?.["data-weight"] === "ai_instructions"), "input", { target: { value: "0" } });
      assert.equal(estimate(), "Local estimate: 94.6% · verdict: 99.3%");   // the leave-one-out risk 0.9458
      assert.match(t.textOf(t.render(unopened())), /Open a screened message/);
    },
    clear: (t) => {
      const c = ctx();
      t.fire(t.find(t.render(c), (node) => node.attrs?.["data-weight"] === "ai_instructions"), "input", { target: { value: "0" } });
      t.fire(t.find(t.render(c), (node) => node.attrs?.["data-action"] === "clear"), "click");
      assert.equal(t.textOf(t.find(t.render(c), (node) => node.attrs && "data-estimate" in node.attrs)), "Local estimate: 99.3% · verdict: 99.3%");
    },
    apply: (t) => {
      const c = ctx();
      t.fire(t.find(t.render(c), (node) => node.attrs?.["data-action"] === "apply"), "click");
      assert.equal(applied(c).length, 0, "nothing tried, nothing applied");
      t.fire(t.find(t.render(c), (node) => node.attrs?.["data-weight"] === "ai_instructions"), "input", { target: { value: "0.33" } });   // snaps to 0.35
      t.fire(t.find(t.render(c), (node) => node.attrs?.["data-action"] === "apply"), "click");
      assert.deepEqual(applied(c), [{ weights: { ai_instructions: 0.35 }, policy: null }]);
      assert.match(t.env.toasts.at(-1).message, /^Moved 1 slider; .*no Jev call/);
      assert.deepEqual(t.state.tried, {});
    },
  } },
  build_up: { improvements: {
    table: (t) => {
      const rows = t.findAll(t.render(ctx({ hide: ["pressure"] })), (node) => node.tag === "tr" && node.attrs["data-signal"]);
      assert.deepEqual(rows.map((row) => row.attrs["data-signal"]),
        ["ai_instructions", "identity_mismatch", "payment_change", "secrecy_or_bypass", "pressure", "link_lure", "credential_request", "unexpected_reward"]);
      assert.deepEqual(rows.map((row) => t.textOf(row.children[2])), ["87.3%", "95.1%", "98.0%", "98.9%", "99.2%", "99.3%", "99.3%", "99.3%"]);
      assert.match(t.textOf(t.render(unopened())), /Open a screened message/);
    },
    copy: (t) => {
      t.fire(t.find(t.render(ctx()), (node) => node.attrs?.["data-copy"] === "build-up"), "click");
      assert.deepEqual(t.env.copied, [["signal\tcontribution\trisk so far", "Instructs an AI\t0.873\t87.3%", "Domain mismatch\t0.616\t95.1%",
        "Payment redirect\t0.588\t98.0%", "Secrecy / bypass\t0.450\t98.9%", "Time pressure\t0.285\t99.2%", "Link lure\t0.072\t99.3%",
        "Credential ask\t0.054\t99.3%", "Unexpected reward\t0.008\t99.3%"].join("\n")]);
    },
  } },
  // packright: risk 0.5025. review_at 0.3 is under it, so the first step above is 0.55; quarantine_at 0.6 is above
  // it, so the last step at or under it is 0.5. bec (0.9931): both cross at 1.
  threshold_flip: { improvements: {
    table: (t) => {
      const rows = t.findAll(t.render(packright()), (node) => node.tag === "tr" && node.attrs["data-threshold"]);
      assert.deepEqual(rows.map((row) => row.children.slice(0, 4).map(t.textOf)), [["Review", "0.3", "at or above", "0.55"], ["Quarantine", "0.6", "below", "0.5"]]);
      const bec = t.findAll(t.render(base), (node) => node.tag === "tr" && node.attrs["data-threshold"]);
      assert.deepEqual(bec.map((row) => t.textOf(row.children[3])), ["1", "1"]);
      assert.match(t.textOf(t.render(unopened())), /Open a screened message/);
    },
    move: (t) => {
      const c = packright();
      t.fire(t.find(t.render(c), (node) => node.attrs?.["data-move"] === "review_at"), "click");
      assert.deepEqual(applied(c), [{ weights: null, policy: { review_at: 0.55 } }]);
      assert.match(t.env.toasts.at(-1).message, /^review_at moved to 0\.55; .*no Jev call/);
    },
  } },
  identity_options: { improvements: {
    table: (t) => {
      const rows = t.findAll(t.render(base), (node) => node.tag === "tr" && node.attrs["data-option"]);
      assert.deepEqual(rows.map((row) => row.children.map(t.textOf)), [
        ["Bean Brokers Ltd", "88.0%", "chosen"], ["PackRight Packaging", "0.0%", ""], ["Coastline Freight", "0.0%", ""],
        ["Sparkle Facility Services", "0.0%", ""], ["Harbor Coffee (internal)", "2.0%", ""], ["Customer / individual", "0.0%", ""], ["Other organization", "10.0%", ""]]);
      assert.match(t.textOf(t.render(unopened())), /Open a screened message/);
    },
  } },
}, { ctx: () => sampleShieldResultCtx() });
