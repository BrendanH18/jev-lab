// Tests for the page-wide pack static/js/lab/packs/chrome/chrome-readouts.js, run against a real chromeCtx built by
// tests/js/lab/fixtures/chrome.mjs from the raw /api/status answers in STATUS. Expected messages are written by hand
// from those fixture numbers; averages are worked out below where they are not obvious.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/chrome/chrome-readouts.js";
import { checkPack } from "./harness.mjs";
import { STATUS, sampleChromeCtx } from "./fixtures/chrome.mjs";

const feature = (id) => pack.features.find((entry) => entry.id === id);
const at = (status, more = {}) => sampleChromeCtx({ status, ...more });
const toasts = (ctx) => ctx.env.toasts;
const runOn = (id, status, more) => {
  const ctx = at(status, more);
  feature(id).run(ctx);
  return ctx;
};
const without = (field) => { const copy = { ...STATUS.connected }; delete copy[field]; return copy; };
// A spend guard with binary-exact dollars, so derived numbers are exact: remaining = 2 - 0.5 - 0.25 = 1.25.
const EXACT = { ...STATUS.connected, spend: { budget_usd: 2, spent_usd: 0.5, reserved_usd: 0.25, live_calls: 3, input_tokens: 1200, rpm: 60 } };
const withSpend = (spend) => ({ ...STATUS.connected, spend: { ...STATUS.connected.spend, ...spend } });

checkPack(pack, {
  show_model: { ctx: () => at(STATUS.connected), hidden: () => at(STATUS.loading), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Model: jev-1.14.0 (the default).", kind: "" }]);
    assert.equal(toasts(runOn("show_model", STATUS.memory))[0].message,
      "Model: jev-1.13.2, selected in the settings for this server run (a restart returns to jev-1.14.0).");
    assert.equal(ctx.calls.length, 0);
  } },
  show_box_support: { ctx: () => at(STATUS.connected), hidden: () => at(without("supports_box")), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Box questions: jev-1.14.0 answers them.", kind: "" }]);
    assert.equal(toasts(runOn("show_box_support", STATUS.memory))[0].message,
      "Box questions: jev-1.13.2 does not answer them. Pick a model that does in the API key and safety settings.");
    assert.equal(feature("show_box_support").when(at(STATUS.loading)), false);
  } },
  show_backend: { ctx: () => at(STATUS.connected), hidden: () => at(without("backend")), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Backend: typesafe-sdk (the official TypeSafe SDK).", kind: "" }]);
    assert.equal(toasts(runOn("show_backend", STATUS.memory))[0].message, "Backend: stdlib (the built-in standard-library client).");
    assert.equal(toasts(runOn("show_backend", { ...STATUS.connected, backend: "custom-client" }))[0].message, "Backend: custom-client.");
    // The names jev/client.py JevClient.backend really sends.
    assert.equal(toasts(runOn("show_backend", { ...STATUS.connected, backend: "typesafe-sdk 0.4.1" }))[0].message,
      "Backend: typesafe-sdk 0.4.1 (the official TypeSafe SDK).");
    assert.equal(toasts(runOn("show_backend", { ...STATUS.connected, backend: "stdlib fallback" }))[0].message,
      "Backend: stdlib fallback (the built-in standard-library client).");
  } },
  show_version: { ctx: () => at(STATUS.memory), hidden: () => at(without("version")), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Jev Lab server version 0.9.0.", kind: "" }]);
  } },
  show_key_source: { ctx: () => at(STATUS.connected), hidden: () => at(STATUS.loading), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "The API key comes from the .env file in the project folder. The key itself is never sent to this page.", kind: "" }]);
    assert.equal(toasts(runOn("show_key_source", STATUS.noBudget))[0].message,
      "The API key comes from the TYPESAFE_API_KEY environment variable. The key itself is never sent to this page.");
    assert.match(toasts(runOn("show_key_source", STATUS.memory))[0].message, /^The API key comes from this server's memory \(pasted in the settings and not saved/);
    assert.equal(toasts(runOn("show_key_source", STATUS.noKey))[0].message, "No API key is connected for this server run.");
  } },
  show_env_saving: { ctx: () => at(STATUS.connected), hidden: () => at(without("env")), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Saving the key to .env is available.", kind: "" }]);
    const memory = toasts(runOn("show_env_saving", STATUS.memory))[0];
    assert.deepEqual(memory, { message: "Saving the key to .env is not available: 1 problem blocks it. The API key and safety settings explain why.", kind: "error" });
    assert.ok(!memory.message.includes("not ignored by git"), "the problem text stays out");
    assert.equal(toasts(runOn("show_env_saving", STATUS.noBudget))[0].message,
      "Saving the key to .env is available. The existing .env can be read or written by other users; owner-only (0600) is expected.");
    const two = { ...STATUS.memory, env: { ...STATUS.memory.env, problems: ["a", "b"] } };
    assert.match(toasts(runOn("show_env_saving", two))[0].message, /not available: 2 problems block it\./);
    // Not saveable with no problem texts reported: no "0 problems" count.
    const none = { ...STATUS.memory, env: { ...STATUS.memory.env, problems: [] } };
    assert.deepEqual(toasts(runOn("show_env_saving", none))[0],
      { message: "Saving the key to .env is not available. The API key and safety settings explain why.", kind: "error" });
    // can_save that is not a boolean is not a report: hidden, and run refuses.
    const unknown = { ...STATUS.connected, env: { ...STATUS.connected.env, can_save: "yes" } };
    assert.equal(feature("show_env_saving").when(at(unknown)), false);
    assert.throws(() => feature("show_env_saving").run(at(unknown)), /not reported on \.env/);
  } },
  show_spend: { ctx: () => at(STATUS.connected), hidden: () => at(without("spend")), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Spend measured for this server run: $0.0125, plus $0.0005 held for calls in flight. Budget: $2.00.", kind: "" }]);
    assert.equal(toasts(runOn("show_spend", STATUS.noBudget))[0].message,
      "Spend measured for this server run: $0.3100, plus $0.0000 held for calls in flight. No budget is set.");
    assert.equal(feature("show_spend").when(at(STATUS.loading)), false);
    // A reserve the guard did not report is left out rather than shown as "unknown".
    assert.equal(toasts(runOn("show_spend", withSpend({ reserved_usd: null })))[0].message,
      "Spend measured for this server run: $0.0125. Budget: $2.00.");
  } },
  show_calls_tokens: { ctx: () => at(STATUS.connected), hidden: () => at(STATUS.loading), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Measured for this server run: 7 live calls, 31,250 input tokens.", kind: "" }]);
    assert.equal(toasts(runOn("show_calls_tokens", STATUS.memory))[0].message, "Measured for this server run: 812 live calls, 13,571,428 input tokens.");
  } },
  // 0.0125 / 7 = 0.0017857142… -> 0.001786; 4.75 / 812 = 0.0058497536… -> 0.005850.
  show_cost_per_call: { ctx: () => at(STATUS.connected), hidden: () => at(STATUS.noKey), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Average cost per live call: $0.001786 (measured spend ÷ live calls, measured for this server run).", kind: "" }]);
    assert.match(toasts(runOn("show_cost_per_call", STATUS.memory))[0].message, /^Average cost per live call: \$0\.005850 /);
  } },
  // 31,250 / 7 = 4,464.29 -> 4,464; 13,571,428 / 812 = 16,713.58 (812 × 16,713 = 13,570,956, remainder 472) -> 16,714.
  show_tokens_per_call: { ctx: () => at(STATUS.connected), hidden: () => at(STATUS.noKey), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Average input tokens per live call: 4,464 (measured for this server run).", kind: "" }]);
    assert.equal(toasts(runOn("show_tokens_per_call", STATUS.memory))[0].message, "Average input tokens per live call: 16,714 (measured for this server run).");
  } },
  // EXACT: (0.5 + 0.25) / 2 = 37.5%. memory: 4.75 / 5 = 95%. overBudget: 0.0512 / 0.05 = 102.4%. 1.8 / 2 is exactly the
  // 90% boundary (halving is exact in binary), which already warns; 7 / 8 = 87.5% does not.
  show_budget_share: { ctx: () => at(EXACT), hidden: () => at(STATUS.noBudget), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Budget used: 37.5% of $2.00 (measured for this server run, calls in flight included).", kind: "" }]);
    assert.deepEqual(toasts(runOn("show_budget_share", STATUS.memory))[0],
      { message: "Budget used: 95.0% of $5.00 (measured for this server run, calls in flight included). 10% or less of the budget is left.", kind: "error" });
    assert.match(toasts(runOn("show_budget_share", STATUS.overBudget))[0].message, /^Budget used: 102\.4% of \$0\.0500 /);
    // (1.5 spent + 0.25 in flight) / 2 = 87.5%, reserve counted, no warning. 1.8 / 2 = 90%, exactly 10% left: warns
    // and says "10% or less" (1.8 / 2 rounds to the same double as 0.9).
    assert.deepEqual(toasts(runOn("show_budget_share", withSpend({ budget_usd: 2, spent_usd: 1.5, reserved_usd: 0.25 })))[0],
      { message: "Budget used: 87.5% of $2.00 (measured for this server run, calls in flight included).", kind: "" });
    assert.deepEqual(toasts(runOn("show_budget_share", withSpend({ budget_usd: 2, spent_usd: 1.8, reserved_usd: 0 })))[0],
      { message: "Budget used: 90.0% of $2.00 (measured for this server run, calls in flight included). 10% or less of the budget is left.", kind: "error" });
    assert.equal(toasts(runOn("show_budget_share", withSpend({ budget_usd: 8, spent_usd: 7, reserved_usd: 0 })))[0].kind, "");
  } },
  show_rate_cap: { ctx: () => at(STATUS.memory), hidden: () => at(withSpend({ rpm: null })), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Local rate cap: 60 live calls per minute, set by this server's spend guard.", kind: "" }]);
    assert.equal(feature("show_rate_cap").when(at(STATUS.loading)), false);
    // rpm 0 turns the guard's cap off (SpendGuard.check only limits when rpm > 0).
    assert.equal(toasts(runOn("show_rate_cap", withSpend({ rpm: 0 })))[0].message, "No local rate cap is set for this server run.");
    assert.equal(toasts(runOn("show_rate_cap", withSpend({ rpm: 1500 })))[0].message,
      "Local rate cap: 1,500 live calls per minute, set by this server's spend guard.");
  } },
  show_price: { ctx: () => at(STATUS.connected), hidden: () => at(without("price_per_mtok_input")), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Price for jev-1.14.0: $0.40 per million input tokens. This is a rate, not spend.", kind: "" }]);
    assert.match(toasts(runOn("show_price", STATUS.memory))[0].message, /^Price for jev-1\.13\.2: \$0\.35 per million/);
    assert.match(toasts(runOn("show_price", { ...STATUS.connected, price_per_mtok_input: 0.0125 }))[0].message, /: \$0\.0125 per million/);
    assert.match(toasts(runOn("show_price", { ...STATUS.connected, price_per_mtok_input: 1.5 }))[0].message, /: \$1\.50 per million/);
  } },
  copy_model: { ctx: () => at(STATUS.memory), hidden: () => at(STATUS.loading), check: (ctx) => {
    assert.deepEqual(ctx.env.copied, ["jev-1.13.2"]);
  } },
  copy_spend_csv: { ctx: () => at(EXACT), hidden: () => at(without("spend")), check: (ctx) => {
    const header = '"budget_usd","spent_usd","reserved_usd","remaining_usd","live_calls","input_tokens","rpm"\r\n';
    assert.deepEqual(ctx.env.copied, [`${header}"2","0.5","0.25","1.25","3","1200","60"\r\n`]);
    // No budget: remaining is unavailable and its cell stays blank.
    assert.deepEqual(runOn("copy_spend_csv", STATUS.noBudget).env.copied, [`${header}"0","0.31","0","","40","775000","120"\r\n`]);
  } },
  copy_status_json: { ctx: () => at({ ...EXACT, env: STATUS.memory.env }), hidden: () => at(STATUS.loading), check: (ctx) => {
    assert.equal(ctx.env.copied.length, 1);
    const text = ctx.env.copied[0];
    assert.deepEqual(JSON.parse(text), { loaded: true, configured: true, key_source: "file", model: "jev-1.14.0", model_source: "default",
      default_model: "jev-1.14.0", supports_box: true, backend: "typesafe-sdk", version: "0.9.0", price_per_mtok_input: 0.4,
      spend: { budget_usd: 2, spent_usd: 0.5, reserved_usd: 0.25, live_calls: 3, input_tokens: 1200, rpm: 60, remaining_usd: 1.25 },
      env: { can_save: false, perms_ok: null, problem_count: 1 } });
    assert.ok(!text.includes("not ignored by git") && !text.includes('"path"'), "no problem texts and no .env path");
    assert.ok(text.endsWith("}\n"));
  } },
  show_theme: { ctx: () => sampleChromeCtx({ theme: "system", systemLight: false }), check: (ctx) => {
    assert.deepEqual(toasts(ctx), [{ message: "Theme: system, following your device, which shows dark now.", kind: "" }]);
    const light = sampleChromeCtx({ theme: "system", systemLight: true });
    feature("show_theme").run(light);
    assert.equal(light.env.toasts[0].message, "Theme: system, following your device, which shows light now.");
    const fixed = sampleChromeCtx({ theme: "light", systemLight: false });
    feature("show_theme").run(fixed);
    assert.equal(fixed.env.toasts[0].message, "Theme: light.");
    assert.equal(ctx.calls.length, 0);
  } },
  toggle_light_dark: { ctx: () => sampleChromeCtx({ theme: "system", systemLight: true }), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["setTheme", "dark"]]);
    assert.equal(ctx.data.theme, "dark");
    assert.deepEqual(toasts(ctx), [{ message: "Theme: dark.", kind: "" }]);
    const dark = sampleChromeCtx({ theme: "dark", storageBlocked: true });
    feature("toggle_light_dark").run(dark);
    assert.deepEqual(dark.calls, [["setTheme", "light"]]);
    assert.equal(dark.env.toasts[0].message, "Theme: light. This browser did not keep the choice, so it lasts for this page only.");
  } },
}, { ctx: () => sampleChromeCtx() });
