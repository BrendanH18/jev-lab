// Tests for static/js/lab/packs/shield/shield-panels.js on the fixtures of tests/js/lab/fixtures/shield.mjs.
// Reference values come from a separate Python computation of jev/shield.py's noisy-OR (not the pack's code):
//   bec-invoice (opened by default): contributions ai .873, mismatch .616, pay .588, secrecy .45, pressure .285,
//     link .072, credential .054, reward .008; risk 0.99311899811. Log-survival shares (−ln(1 − c) / Σ, times the risk),
//     as risk points / percent of the risk: ai 0.41160 / 41.446%, mismatch 0.19091 / 19.223%, pay 0.17687 / 17.809%,
//     secrecy 0.11925 / 12.007%, pressure 0.06691 / 6.738%, link 0.01490 / 1.501%, credential 0.01107 / 1.115%,
//     reward 0.00160 / 0.161%. By source: Noul 0.73530 / 74.039%, Score 0.06691 / 6.738%, code 0.19091 / 19.223%.
//     With ai's default weight at 0.45 instead: default risk 0.96947, ai's default share 0.15938 / 16.440%.
//   packright-proof: risk 0.50254924503 (review; no rules; harm 1.5). Link lure weight 0.1 -> 0.29837 (safe), 0.15 ->
//     0.31879 (review), 0.8 -> 0.58422, 0.85 -> 0.60464 (quarantine). Pressure 0.6 -> 0.59033, 0.65 -> 0.60497
//     (quarantine); pressure at 0 still 0.41476 (review). Every other weight from 0 to 1 stays in 0.46..0.52 (review).
//     Shares as percent of the risk: link 57.354%, pressure 23.275% (two signals carry 80.6%).
//     Link lure weight 0 -> 0.25754 (safe); pressure weight 1 -> 0.70738 (quarantine).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/shield/shield-panels.js";
import { DEFAULT_POLICY, DEFAULT_WEIGHTS, sampleShieldResultCtx, sampleShieldResults } from "./fixtures/shield.mjs";
import { checkPack } from "./harness.mjs";

const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
const packright = (overrides = {}) => sampleShieldResultCtx({ selected: "packright-proof", ...overrides });
const empty = sampleShieldResultCtx({ weights: null, policy: null, defaults: null, results: {} });
const unscreened = () => sampleShieldResultCtx({ selected: "northside-reschedule" });
const stepTexts = (t, root, step) => t.findAll(root, attr("data-step", step)).map(t.textOf);
const select = (t, root, name) => t.find(root, attr("data-control", name));

checkPack(pack, {
  risk_breakdown: { improvements: {
    shares: (t) => {
      const root = t.render(sampleShieldResultCtx());
      const share = (id) => t.textOf(t.find(t.find(root, attr("data-signal", id)), has("data-share")));
      assert.equal(share("ai_instructions"), "0.412");
      assert.equal(share("identity_mismatch"), "0.191");
      assert.equal(share("payment_change"), "0.177");
      assert.equal(share("unexpected_reward"), "0.002");
      assert.match(t.textOf(root), /noisy-OR risk 99\.3%/);
      assert.match(t.textOf(t.render(unscreened())), /Open a screened message/);
    },
    bars: (t) => {
      const root = t.render(sampleShieldResultCtx());
      assert.equal(t.find(root, attr("data-bar", "ai_instructions")).attrs.style, "width: 41.4%");
      assert.equal(t.find(root, attr("data-bar", "pressure")).attrs.style, "width: 6.7%");
    },
    sources: (t) => {
      const root = t.render(sampleShieldResultCtx());
      const row = (key) => t.textOf(t.find(root, attr("data-source", key)));
      assert.equal(row("noul"), "Noul answers60.735");
      assert.equal(row("score"), "Score answer (time pressure)10.067");
      assert.equal(row("code"), "Code check (sender domain)10.191");
    },
    defaults: (t) => {
      const ctx = sampleShieldResultCtx({ defaults: { weights: { ...DEFAULT_WEIGHTS, ai_instructions: 0.45 }, policy: { ...DEFAULT_POLICY } } });
      const root = t.render(ctx);
      const cell = (id) => t.textOf(t.find(t.find(root, attr("data-signal", id)), has("data-default-share")));
      assert.equal(cell("ai_instructions"), "0.159");
      assert.equal(cell("identity_mismatch"), "0.266");
      t.state.unit = "percent";
      assert.equal(t.textOf(t.find(t.find(t.render(ctx), attr("data-signal", "ai_instructions")), has("data-default-share"))), "16.4%");
    },
    sort: (t) => {
      const ctx = sampleShieldResultCtx();
      const order = () => t.findAll(t.render(ctx), has("data-signal")).map((node) => node.attrs["data-signal"]);
      assert.deepEqual(order(), ["ai_instructions", "identity_mismatch", "payment_change", "secrecy_or_bypass", "pressure", "link_lure", "credential_request", "unexpected_reward"]);
      t.fire(select(t, t.render(ctx), "sort"), "change", { target: { value: "order" } });
      assert.deepEqual(order(), ["ai_instructions", "credential_request", "payment_change", "secrecy_or_bypass", "link_lure", "unexpected_reward", "pressure", "identity_mismatch"]);
    },
    unit: (t) => {
      const ctx = sampleShieldResultCtx();
      t.fire(select(t, t.render(ctx), "unit"), "change", { target: { value: "percent" } });
      const root = t.render(ctx);
      assert.equal(t.textOf(t.find(t.find(root, attr("data-signal", "ai_instructions")), has("data-share"))), "41.4%");
      assert.equal(t.textOf(t.find(t.find(root, attr("data-source", "noul")), has("data-share"))), "74.0%");
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleShieldResultCtx()), attr("data-copy", "breakdown")), "click");
      const lines = t.env.copied[0].trim().split("\n");
      assert.equal(lines[0], "signal\tcontribution\trisk points\tpercent of risk");
      assert.equal(lines[1], "Instructs an AI\t0.873\t0.4116\t41.4%");
      assert.equal(lines.length, 9);
    },
  } },

  weight_flips: { improvements: {
    raise: (t) => {
      const root = t.render(packright());
      const raise = (id) => t.textOf(t.find(t.find(root, attr("data-signal", id)), has("data-raise")));
      assert.equal(raise("link_lure"), "0.85 → quarantine (60.5%)Move");
      assert.equal(raise("pressure"), "0.65 → quarantine (60.5%)Move");
      assert.equal(raise("ai_instructions"), "none");
      assert.equal(raise("identity_mismatch"), "none");
    },
    lower: (t) => {
      const root = t.render(packright());
      const lower = (id) => t.textOf(t.find(t.find(root, attr("data-signal", id)), has("data-lower")));
      assert.equal(lower("link_lure"), "0.1 → safe (29.8%)Move");
      assert.equal(lower("pressure"), "none");
      assert.equal(lower("credential_request"), "none");
    },
    smallest: (t) => {
      const root = t.render(packright());
      assert.deepEqual(t.findAll(root, has("data-best")).map((node) => [node.attrs["data-signal"], node.attrs["data-best"]]), [["link_lure", "raise"]]);
      assert.equal(t.textOf(t.find(root, has("data-smallest"))), "Smallest move: Link lure to 0.85 (5 steps) gives quarantine.");
    },
    target: (t) => {
      const ctx = packright();
      t.fire(select(t, t.render(ctx), "target"), "change", { target: { value: "safe" } });
      const root = t.render(ctx);
      assert.equal(t.textOf(t.find(t.find(root, attr("data-signal", "link_lure")), has("data-raise"))), "none");
      assert.equal(t.textOf(t.find(t.find(root, attr("data-signal", "pressure")), has("data-raise"))), "none");
      assert.equal(t.textOf(t.find(root, has("data-smallest"))), "Smallest move: Link lure to 0.1 (10 steps) gives safe.");
      t.state.target = "review";   // the level now: no move can reach it
      assert.equal(t.textOf(t.find(t.render(ctx), has("data-smallest"))), "No single weight move reaches that level.");
    },
    locked: (t) => {
      const root = t.render(sampleShieldResultCtx());
      assert.match(t.textOf(t.find(root, has("data-locked"))), /prompt_injection, impersonation\) quarantine this message whatever the weights/);
      assert.equal(t.findAll(root, has("data-apply")).length, 0);
      assert.equal(t.find(t.render(packright()), has("data-locked")), null);
    },
    agree: (t) => {
      assert.equal(t.textOf(t.find(t.render(packright()), attr("data-agree", "yes"))), "The local estimate reproduces the verdict: risk 50.3%, review.");
      // message-9 lacks a loss score, so its review band cannot be estimated
      const odd = t.render(sampleShieldResultCtx({ selected: "message-9" }));
      assert.ok(t.find(odd, attr("data-agree", "no")));
      assert.match(t.textOf(odd), /loss score is missing/);
    },
    apply: (t) => {
      const ctx = packright();
      t.fire(t.find(t.render(ctx), attr("data-apply", "link_lure:0.85")), "click");
      assert.deepEqual(ctx.log, [["applyPolicy", { weights: { link_lure: 0.85 }, policy: null }]]);
      assert.match(t.env.toasts[0].message, /no Jev call/);
      const broken = packright({ missing: ["applyPolicy"] });
      t.fire(t.find(t.render(broken), attr("data-apply", "link_lure:0.1")), "click");
      assert.equal(t.env.toasts[1].kind, "error");
    },
    copy: (t) => {
      t.fire(t.find(t.render(packright()), attr("data-copy", "flips")), "click");
      const lines = t.env.copied[0].trim().split("\n");
      assert.equal(lines[0], "signal\tweight now\traise to\tlevel\tlower to\tlevel");
      assert.ok(lines.includes("Link lure\t0.6\t0.85\tquarantine\t0.1\tsafe"));
      assert.ok(lines.includes("Time pressure\t0.3\t0.65\tquarantine\t\t"));
    },
  } },

  weight_sweep: { improvements: {
    table: (t) => {
      const ctx = packright();
      let root = t.render(ctx);
      assert.equal(select(t, root, "signal").attrs.value, "link_lure");   // the page's strongest row comes first
      assert.equal(t.findAll(root, has("data-step")).length, 21);
      const row = (step) => t.findAll(t.find(root, attr("data-step", step)), (node) => node.tag === "td").slice(0, 3).map(t.textOf);
      assert.deepEqual(row("0"), ["0.00", "25.8%", "safe"]);
      assert.deepEqual(row("0.1"), ["0.10", "29.8%", "safe"]);
      assert.deepEqual(row("0.15"), ["0.15", "31.9%", "review"]);
      assert.deepEqual(row("0.8"), ["0.80", "58.4%", "review"]);
      assert.deepEqual(row("1"), ["1.00", "66.6%", "quarantine"]);
      t.fire(select(t, root, "signal"), "change", { target: { value: "pressure" } });
      root = t.render(ctx);
      assert.equal(select(t, root, "signal").attrs.value, "pressure");
      assert.deepEqual(row("0"), ["0.00", "41.5%", "review"]);
      assert.deepEqual(row("0.6"), ["0.60", "59.0%", "review"]);
      assert.deepEqual(row("0.65"), ["0.65", "60.5%", "quarantine"]);
      assert.deepEqual(row("1"), ["1.00", "70.7%", "quarantine"]);
      assert.equal(t.findAll(root, has("data-move")).length, 0);   // the page's own sliders set a weight; the sweep only estimates
    },
    current: (t) => {
      const root = t.render(packright({ defaults: { weights: { ...DEFAULT_WEIGHTS, link_lure: 0.4 }, policy: { ...DEFAULT_POLICY } } }));
      assert.deepEqual(t.findAll(root, has("data-current")).map((node) => node.attrs["data-step"]), ["0.6"]);
      assert.deepEqual(t.findAll(root, has("data-default")).map((node) => node.attrs["data-step"]), ["0.4"]);
    },
    boundaries: (t) => {
      assert.deepEqual(t.findAll(t.render(packright()), has("data-boundary")).map((node) => node.attrs["data-step"]), ["0.15", "0.85"]);
      t.state.signal = "pressure";
      assert.deepEqual(t.findAll(t.render(packright()), has("data-boundary")).map((node) => node.attrs["data-step"]), ["0.65"]);
      assert.deepEqual(t.findAll(t.render(sampleShieldResultCtx()), has("data-boundary")), []);   // hard rules hold quarantine
    },
  } },

  rule_trace: { improvements: {
    hard_rules: (t) => {
      assert.deepEqual(stepTexts(t, t.render(sampleShieldResultCtx()), "hard_rules"), [
        "Instructs an AI 97.0% ≥ hard_rule_at 70.0%: prompt_injection fires (quarantine).",
        "Credential ask 6.0% < hard_rule_at 70.0%: credential_phish does not fire."]);
    },
    sender: (t) => {
      assert.deepEqual(stepTexts(t, t.render(sampleShieldResultCtx()), "sender"),
        ["Sender domain beanbrokers-payments.example is not beanbrokers.example for Bean Brokers Ltd; P(Bean Brokers Ltd) 88.0% ≥ 60.0%: counts as a mismatch."]);
      assert.deepEqual(stepTexts(t, t.render(packright()), "sender"), ["Sender domain packright.example matches packright.example for PackRight Packaging: no mismatch."]);
      assert.deepEqual(stepTexts(t, t.render(sampleShieldResultCtx({ selected: "message-9" })), "sender"), ["Claimed sender other organization has no domain to verify, so there is no mismatch."]);
    },
    risky_ask: (t) => {
      assert.deepEqual(stepTexts(t, t.render(sampleShieldResultCtx()), "risky_ask"),
        ["Largest risky ask: Payment redirect 98.0% ≥ 50.0%.", "Mismatch with a risky ask: impersonation fires (quarantine)."]);
      assert.deepEqual(stepTexts(t, t.render(packright()), "risky_ask"), ["Largest risky ask: Link lure 55.0% ≥ 50.0%.", "No mismatch: no sender rule fires."]);
    },
    thresholds: (t) => {
      assert.deepEqual(stepTexts(t, t.render(packright()), "thresholds"), ["Risk 50.3% < quarantine_at 60.0%.", "Risk 50.3% ≥ review_at 30.0%."]);
    },
    harm: (t) => {
      assert.deepEqual(stepTexts(t, t.render(packright()), "harm"), ["Loss if obeyed 1.50 < 2.5: no lift."]);
      assert.match(stepTexts(t, t.render(sampleShieldResultCtx({ selected: "maya-damaged" })), "harm")[0], /^Loss if obeyed 0\.90: the lift does not apply/);
      const results = sampleShieldResults();
      results["packright-proof"].verdict.harm = 2.6;
      assert.deepEqual(stepTexts(t, t.render(packright({ results })), "harm"), ["Loss if obeyed 2.60 ≥ 2.5: lifts the review to quarantine."]);
      const noRisk = sampleShieldResults();
      noRisk["packright-proof"].verdict.risk = null;
      assert.deepEqual(stepTexts(t, t.render(packright({ results: noRisk })), "harm"), ["Loss if obeyed 1.50: without the risk and thresholds, the lift cannot be traced."]);
    },
    decided_by: (t) => {
      assert.deepEqual(stepTexts(t, t.render(sampleShieldResultCtx()), "decided_by"), ["Decided by: hard rule prompt_injection, impersonation → quarantine."]);
      assert.deepEqual(stepTexts(t, t.render(packright()), "decided_by"), ["Decided by: risk at or above review_at → review."]);
      assert.deepEqual(stepTexts(t, t.render(sampleShieldResultCtx({ selected: "maya-damaged" })), "decided_by"), ["Decided by: no rule fired and the risk is under review_at → safe."]);
    },
    agree: (t) => {
      assert.equal(t.textOf(t.find(t.render(sampleShieldResultCtx()), has("data-agree"))), "The trace matches the page's verdict (quarantine; prompt_injection, impersonation).");
      // Thresholds moved while the verdict still shows the earlier re-score: 0.97 is under 0.99, so no prompt_injection.
      const moved = t.render(sampleShieldResultCtx({ policy: { ...DEFAULT_POLICY, hard_rule_at: 0.99 } }));
      assert.match(t.textOf(t.find(moved, attr("data-agree", "no"))), /rules impersonation\) differs from the page's verdict \(quarantine; rules prompt_injection, impersonation\)/);
    },
    move_hard: (t) => {
      const ctx = sampleShieldResultCtx();
      const root = t.render(ctx);
      assert.equal(t.textOf(t.find(root, attr("data-move-hard", "prompt_injection"))), "Move hard_rule_at to 1 (prompt_injection would stop firing)");
      assert.equal(t.textOf(t.find(root, attr("data-move-hard", "credential_phish"))), "Move hard_rule_at to 0.05 (credential_phish would start firing)");
      t.fire(t.find(root, attr("data-move-hard", "prompt_injection")), "click");
      assert.deepEqual(ctx.log, [["applyPolicy", { weights: null, policy: { hard_rule_at: 1 } }]]);
    },
    copy: (t) => {
      t.fire(t.find(t.render(packright()), attr("data-copy", "trace")), "click");
      const text = t.env.copied[0];
      assert.ok(text.startsWith("Shield rule trace (your own screen; local mirror of the policy)\n"));
      assert.ok(text.includes("Decided by: risk at or above review_at → review.\n"));
      assert.equal(text.trim().split("\n").length, 10);
    },
  } },

  answer_sheet: { improvements: {
    table: (t) => {
      const root = t.render(sampleShieldResultCtx());
      const rows = t.findAll(root, has("data-answer"));
      assert.equal(rows.length, 10);
      const cells = (id) => t.findAll(t.find(root, attr("data-answer", id)), (node) => node.tag === "td").map(t.textOf);
      assert.deepEqual(cells("ai_instructions"), ["ai_instructions", "noul", "97.0% yes", "—", "—"]);
      assert.deepEqual(cells("pressure"), ["pressure", "score", "1.90 of 2", "2 90.0%", "90.0%"]);
      assert.deepEqual(cells("claimed_identity"), ["claimed_identity", "choice", "Bean Brokers Ltd", "bean_brokers 88.0%", "88.0%"]);
      assert.equal(t.findAll(t.render(sampleShieldResultCtx({ selected: "message-9" })), has("data-answer")).length, 8);
    },
    kinds: (t) => {
      const root = t.render(sampleShieldResultCtx());
      assert.equal(t.findAll(root, has("data-kind")).length, 6);
      assert.equal(t.textOf(t.find(root, attr("data-kind", "vendor_business"))), "Vendor business90.0%chosen");
      assert.equal(t.textOf(t.find(root, attr("data-kind", "internal"))), "Internal4.0%");
      assert.match(t.textOf(t.render(sampleShieldResultCtx({ selected: "message-9" }))), /no message-kind answer/);
    },
    levels: (t) => {
      const root = t.render(sampleShieldResultCtx());
      assert.deepEqual(t.findAll(root, has("data-score")).map((node) => node.attrs["data-score"]), ["pressure", "harm_if_obeyed"]);
      const cells = (key) => t.findAll(t.find(root, attr("data-level", key)), (node) => node.tag === "td").map(t.textOf);
      assert.deepEqual(cells("pressure:0"), ["0", "None: no deadline or urgency", "0.0%", ""]);
      assert.deepEqual(cells("pressure:2"), ["2", "Strong: demands action within hours or threatens suspension, holds, or penalties", "90.0%", "score 1.90 rounds here"]);
      assert.deepEqual(cells("harm_if_obeyed:3").slice(2), ["90.0%", "score 2.90 rounds here"]);
      assert.equal(t.findAll(root, has("data-level")).length, 7);
      // message-9's response has no loss score: only the time-pressure levels show
      assert.deepEqual(t.findAll(t.render(sampleShieldResultCtx({ selected: "message-9" })), has("data-score")).map((node) => node.attrs["data-score"]), ["pressure"]);
    },
  } },

  largest_share: [{ ctx: sampleShieldResultCtx(), empty, expect: (result) => { near(result.value, 0.4144550948098681, 1e-9); assert.equal(result.detail, "Instructs an AI"); } },
    { ctx: packright(), expect: (result) => { near(result.value, 0.573537514913664, 1e-9); assert.equal(result.detail, "Link lure"); } }],
  signals_for_80: [{ ctx: sampleShieldResultCtx(), empty, expect: (result) => {
    assert.equal(result.value, 4);
    assert.equal(result.detail, "Instructs an AI, Domain mismatch, Payment redirect, Secrecy / bypass");
  } }, { ctx: packright(), expect: (result) => assert.equal(result.value, 2) }],
  domain_check_share: [{ ctx: sampleShieldResultCtx(), empty, expect: 0.19223025786049977, tolerance: 1e-9 }, { ctx: packright(), expect: 0 }],
  hard_rule_margin: [{ ctx: sampleShieldResultCtx(), empty, expect: (result) => { near(result.value, -0.27); assert.equal(result.detail, "Instructs an AI"); } },
    { ctx: packright(), expect: (result) => { near(result.value, 0.62); assert.equal(result.detail, "Credential ask"); } }],
  identity_cut_margin: [{ ctx: sampleShieldResultCtx(), empty, expect: 0.28 }, { ctx: packright(), expect: null },
    { ctx: sampleShieldResultCtx({ selected: "message-9" }), expect: null }],
  risky_ask_margin: [{ ctx: sampleShieldResultCtx(), empty, expect: (result) => { near(result.value, 0.48); assert.equal(result.detail, "Payment redirect"); } },
    { ctx: packright(), expect: (result) => { near(result.value, 0.05); assert.equal(result.detail, "Link lure"); } }],
  harm_lift_margin: [{ ctx: sampleShieldResultCtx(), empty, expect: 0.4 }, { ctx: sampleShieldResultCtx({ selected: "maya-damaged" }), expect: -1.6 },
    { ctx: sampleShieldResultCtx({ selected: "message-9" }), expect: null }],
  level_at_defaults: [{ ctx: sampleShieldResultCtx(), empty, expect: (result) => { assert.equal(result.value, "quarantine"); assert.equal(result.detail, "risk 99.3%"); } },
    { ctx: sampleShieldResultCtx({ selected: "maya-damaged" }), expect: "safe" }, { ctx: packright(), expect: "review" }],
  thresholds_moved: [{ ctx: sampleShieldResultCtx(), empty, expect: 0 },
    { ctx: sampleShieldResultCtx({ policy: { review_at: 0.35, quarantine_at: 0.6, hard_rule_at: 0.8 } }), expect: (result) => {
      assert.equal(result.value, 2);
      assert.equal(result.detail, "review_at, hard_rule_at");
    } }],
}, { ctx: () => sampleShieldResultCtx() });
