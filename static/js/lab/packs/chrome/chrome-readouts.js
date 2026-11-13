// Chrome readouts: page-wide palette commands that read one fact of the allow-listed connection status (model, Box
// support, backend, version, where the key comes from, whether .env saving is available, measured spend, calls,
// tokens, averages per call, budget share, rate cap, price) or the theme, and toast or copy it. Spend figures are the
// spend guard's measured counts for this server run, never estimates. The status never holds the API key, the .env
// path or problem texts, and neither does anything here. No command has a shortcut.
import { csvText, definePack } from "../../kit.js";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
// Dollars the way the top bar's key pill shows them: four decimals under $1, two from $1 up.
export const dollars = (value) => (isNumber(value) ? `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}` : "unknown");
// A rate: up to four decimals, at least two, trailing zeros dropped ("$0.40", "$0.35", "$0.0125").
export const rate = (value) => (isNumber(value) ? `$${value.toFixed(4).replace(/(\.\d\d\d?)0+$/, "$1").replace(/(\.\d\d)0$/, "$1")}` : "unknown");
const whole = (value) => (isNumber(value) ? Math.round(value).toLocaleString("en-US") : "unknown");

const KEY_SOURCES = { env: "the TYPESAFE_API_KEY environment variable", file: "the .env file in the project folder",
  memory: "this server's memory (pasted in the settings and not saved; it is gone after a restart)" };
const THEME_NAMES = { system: "system", light: "light", dark: "dark" };

const loaded = (ctx) => ctx.data.status.loaded === true;
const spendOf = (ctx) => (loaded(ctx) ? ctx.data.status.spend : null);
const MEASURED = "measured for this server run";

function needSpend(ctx) {
  const spend = spendOf(ctx);
  if (!spend) throw new Error("The spend guard has not reported yet.");
  return spend;
}
function needStatus(ctx) {
  if (!loaded(ctx)) throw new Error("The connection status has not loaded yet.");
  return ctx.data.status;
}

// Measured spend per finished live call and input tokens per call: null without a finished call.
export function perCall(spend, field) {
  if (!spend || !isNumber(spend.live_calls) || spend.live_calls <= 0 || !isNumber(spend[field])) return null;
  return spend[field] / spend.live_calls;
}

// Share of the budget taken by measured spend plus calls in flight, or null when no budget is set.
export function budgetShare(spend) {
  if (!spend || !isNumber(spend.budget_usd) || spend.budget_usd <= 0 || !isNumber(spend.spent_usd)) return null;
  return (spend.spent_usd + (isNumber(spend.reserved_usd) ? spend.reserved_usd : 0)) / spend.budget_usd;
}

export function spendCsv(spend) {
  const cell = (value) => (isNumber(value) ? value : "");
  const fields = ["budget_usd", "spent_usd", "reserved_usd", "remaining_usd", "live_calls", "input_tokens", "rpm"];
  return csvText([fields, fields.map((field) => cell(spend[field]))]);
}

function backendName(backend) {
  if (backend.startsWith("typesafe-sdk")) return `${backend} (the official TypeSafe SDK)`;
  if (backend.startsWith("stdlib")) return `${backend} (the built-in standard-library client)`;
  return backend;
}

export default definePack({
  id: "chrome-readouts",
  surface: "chrome",
  title: "Every page: connection and spend readouts",
  about: "Page-wide palette commands that show or copy one fact of the connection status (model, Box support, backend, version, key source, .env saving), the spend guard's measured spend, calls, tokens, per-call averages, budget share and rate cap for this server run, the model's input-token price, and the theme. Never the API key, the .env path or its problem texts, and spend is measured, never estimated.",
  features: [
    { id: "show_model", kind: "command", group: "Connection", title: "Show the model in use", when: loaded,
      run: (ctx) => {
        const status = needStatus(ctx);
        ctx.env.toast(status.model_source === "selected"
          ? `Model: ${status.model}, selected in the settings for this server run (a restart returns to ${status.default_model || "the default"}).`
          : `Model: ${status.model} (the default).`);
      } },
    { id: "show_box_support", kind: "command", group: "Connection", title: "Show whether the model answers Box questions",
      when: (ctx) => loaded(ctx) && ctx.data.status.supports_box !== null,
      run: (ctx) => {
        const status = needStatus(ctx);
        if (status.supports_box === null) throw new Error("The server has not said whether this model answers Box questions.");
        ctx.env.toast(status.supports_box ? `Box questions: ${status.model} answers them.`
          : `Box questions: ${status.model} does not answer them. Pick a model that does in the API key and safety settings.`);
      } },
    { id: "show_backend", kind: "command", group: "Connection", title: "Show the client backend",
      when: (ctx) => loaded(ctx) && ctx.data.status.backend !== null,
      run: (ctx) => {
        const backend = needStatus(ctx).backend;
        if (!backend) throw new Error("The server has not named its backend.");
        ctx.env.toast(`Backend: ${backendName(backend)}.`);
      } },
    { id: "show_version", kind: "command", group: "Connection", title: "Show the Jev Lab server version",
      when: (ctx) => loaded(ctx) && ctx.data.status.version !== null,
      run: (ctx) => {
        const version = needStatus(ctx).version;
        if (!version) throw new Error("The server has not reported its version.");
        ctx.env.toast(`Jev Lab server version ${version}.`);
      } },
    { id: "show_key_source", kind: "command", group: "Connection", title: "Show where the API key comes from",
      help: "Names the source only; the key itself never reaches this page.", when: loaded,
      run: (ctx) => {
        const status = needStatus(ctx);
        ctx.env.toast(status.configured ? `The API key comes from ${KEY_SOURCES[status.key_source] || "an unknown source"}. The key itself is never sent to this page.`
          : "No API key is connected for this server run.");
      } },
    { id: "show_env_saving", kind: "command", group: "Connection", title: "Show whether the key can be saved to .env",
      help: "Says whether saving is available and how many problems block it; the settings dialog explains them.",
      when: (ctx) => loaded(ctx) && typeof ctx.data.status.env?.can_save === "boolean",
      run: (ctx) => {
        const env = needStatus(ctx).env;
        if (!env || typeof env.can_save !== "boolean") throw new Error("The server has not reported on .env yet.");
        const count = isNumber(env.problem_count) && env.problem_count > 0 ? env.problem_count : 0;
        const problems = count === 0 ? "" : count === 1 ? ": 1 problem blocks it" : `: ${count} problems block it`;
        const perms = env.perms_ok === false ? " The existing .env can be read or written by other users; owner-only (0600) is expected." : "";
        if (env.can_save) ctx.env.toast(`Saving the key to .env is available.${perms}`);
        else ctx.env.toast(`Saving the key to .env is not available${problems}. The API key and safety settings explain why.${perms}`, "error");
      } },

    { id: "show_spend", kind: "command", group: "Spend", title: "Show measured spend for this server run",
      when: (ctx) => spendOf(ctx) !== null,
      run: (ctx) => {
        const spend = needSpend(ctx);
        const budget = isNumber(spend.budget_usd) && spend.budget_usd > 0 ? ` Budget: ${dollars(spend.budget_usd)}.` : " No budget is set.";
        const held = isNumber(spend.reserved_usd) ? `, plus ${dollars(spend.reserved_usd)} held for calls in flight` : "";
        ctx.env.toast(`Spend ${MEASURED}: ${dollars(spend.spent_usd)}${held}.${budget}`);
      } },
    { id: "show_calls_tokens", kind: "command", group: "Spend", title: "Show live calls and input tokens so far",
      when: (ctx) => spendOf(ctx) !== null,
      run: (ctx) => {
        const spend = needSpend(ctx);
        ctx.env.toast(`${MEASURED[0].toUpperCase()}${MEASURED.slice(1)}: ${whole(spend.live_calls)} live calls, ${whole(spend.input_tokens)} input tokens.`);
      } },
    { id: "show_cost_per_call", kind: "command", group: "Spend", title: "Show the average measured cost per live call",
      help: "Measured spend divided by finished live calls, for this server run.",
      when: (ctx) => perCall(spendOf(ctx), "spent_usd") !== null,
      run: (ctx) => {
        const value = perCall(needSpend(ctx), "spent_usd");
        if (value === null) throw new Error("No live call has finished in this server run yet.");
        ctx.env.toast(`Average cost per live call: $${value.toFixed(6)} (measured spend ÷ live calls, ${MEASURED}).`);
      } },
    { id: "show_tokens_per_call", kind: "command", group: "Spend", title: "Show the average input tokens per live call",
      when: (ctx) => perCall(spendOf(ctx), "input_tokens") !== null,
      run: (ctx) => {
        const value = perCall(needSpend(ctx), "input_tokens");
        if (value === null) throw new Error("No live call has finished in this server run yet.");
        ctx.env.toast(`Average input tokens per live call: ${whole(value)} (${MEASURED}).`);
      } },
    { id: "show_budget_share", kind: "command", group: "Spend", title: "Show the share of the budget used",
      help: "Measured spend plus calls in flight, as a share of the budget; an error toast once 10% or less is left.",
      when: (ctx) => budgetShare(spendOf(ctx)) !== null,
      run: (ctx) => {
        const spend = needSpend(ctx);
        const share = budgetShare(spend);
        if (share === null) throw new Error("No budget is set for this server run.");
        const low = share >= 0.9;
        ctx.env.toast(`Budget used: ${(share * 100).toFixed(1)}% of ${dollars(spend.budget_usd)} (${MEASURED}, calls in flight included).`
          + (low ? " 10% or less of the budget is left." : ""), low ? "error" : "");
      } },
    { id: "show_rate_cap", kind: "command", group: "Spend", title: "Show the local rate cap",
      when: (ctx) => isNumber(spendOf(ctx)?.rpm),
      run: (ctx) => {
        const rpm = needSpend(ctx).rpm;
        if (!isNumber(rpm)) throw new Error("The spend guard has not reported its rate cap.");
        // The spend guard enforces the cap only when rpm > 0 (jev/client.py SpendGuard.check).
        ctx.env.toast(rpm > 0 ? `Local rate cap: ${whole(rpm)} live calls per minute, set by this server's spend guard.`
          : "No local rate cap is set for this server run.");
      } },
    { id: "show_price", kind: "command", group: "Spend", title: "Show the price per million input tokens",
      help: "The input-token rate this server uses for the model (an unknown model gets the highest known rate). A price, not spend.",
      when: (ctx) => loaded(ctx) && ctx.data.status.price_per_mtok_input !== null,
      run: (ctx) => {
        const status = needStatus(ctx);
        if (!isNumber(status.price_per_mtok_input)) throw new Error("The server has not reported a price for this model.");
        ctx.env.toast(`Price for ${status.model}: ${rate(status.price_per_mtok_input)} per million input tokens. This is a rate, not spend.`);
      } },

    { id: "copy_model", kind: "command", group: "Connection", title: "Copy the model name", when: loaded,
      run: (ctx) => ctx.env.copy(needStatus(ctx).model) },
    { id: "copy_spend_csv", kind: "command", group: "Spend", title: "Copy measured spend as CSV",
      help: "One header row and one row: budget, spent, reserved and remaining dollars, live calls, input tokens and the rate cap, as the spend guard measured them for this server run.",
      when: (ctx) => spendOf(ctx) !== null, run: (ctx) => ctx.env.copy(spendCsv(needSpend(ctx))) },
    { id: "copy_status_json", kind: "command", group: "Connection", title: "Copy the connection status as JSON (no key)",
      help: "The allow-listed status this page holds: model, backend, version, key source, measured spend and .env flags. Never the key, the .env path or problem texts.",
      when: loaded, run: (ctx) => ctx.env.copy(`${JSON.stringify(needStatus(ctx), null, 2)}\n`) },

    { id: "show_theme", kind: "command", group: "Theme", title: "Show the theme in use",
      run: (ctx) => {
        const { theme, effectiveTheme } = ctx.data;
        ctx.env.toast(theme === "system" ? `Theme: system, following your device, which shows ${effectiveTheme} now.`
          : `Theme: ${THEME_NAMES[theme] || theme}.`);
      } },
    { id: "toggle_light_dark", kind: "command", group: "Theme", title: "Switch between the light and dark theme",
      help: "Picks the opposite of the scheme shown now; Cycle the theme also passes through system.",
      run: (ctx) => {
        const next = ctx.data.effectiveTheme === "dark" ? "light" : "dark";
        const kept = ctx.actions.setTheme(next);
        ctx.env.toast(`Theme: ${next}${kept === false ? ". This browser did not keep the choice, so it lasts for this page only." : "."}`);
      } },
  ],
});
