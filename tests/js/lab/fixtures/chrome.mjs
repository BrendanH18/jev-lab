// Fixtures for packs on the page-wide "chrome" surface (static/js/lab/surfaces/chrome.js). Not a test file itself.
//
//   import { sampleChromeCtx, STATUS } from "./fixtures/chrome.mjs";
//   const ctx = sampleChromeCtx({ path: "/workbench", status: STATUS.noKey });
//   await command.run(ctx);
//   assert.deepEqual(ctx.calls, [["go", "/workbench#build"]]);
//
// sampleChromeCtx(overrides) is a real chromeCtx built from hand-written data, so every guard of the contract runs.
// Its actions do not touch a browser: each records [name, ...args] in ctx.calls, setTheme also changes the theme
// the ctx reports, and copy/openOfficial/go record the exact (validated) value. ctx.env is the harness's fakeEnv(),
// so ctx.env.toasts / copied / downloads hold what a pack sent there. Overrides (all optional):
//   path        the current path (default "/shield")          url        the page address (default from path)
//   status      a raw /api/status object (default STATUS.connected; use STATUS.* or your own)
//   theme       "system" | "light" | "dark" (default "system")  systemLight  boolean (default false: a dark device)
//   layers      open layer names (default [])                   commands   mounted command rows (default COMMANDS)
//   mac         boolean (default false)                         mainMissing  true: focusMain() reports no <main>
//   storageBlocked  true: setTheme reports the browser did not remember the choice
//   missing     action names whose page callback is absent (their actions then throw "cannot do that here")
// Everything is fictional: Harbor Coffee Co. data, .example addresses only, no real key.
import { fakeEnv } from "../harness.mjs";
import { chromeCtx } from "../../../../static/js/lab/surfaces/chrome.js";

// Raw GET /api/status answers, as the server sends them (server.py api_status).
export const STATUS = Object.freeze({
  // A key from .env, a $2.00 budget with a little spent and one call's reserve outstanding.
  connected: Object.freeze({ version: "0.9.0", configured: true, key_source: "file", model: "jev-1.14.0", model_source: "default",
    default_model: "jev-1.14.0", supports_box: true, backend: "typesafe-sdk", price_per_mtok_input: 0.4,
    spend: { budget_usd: 2, spent_usd: 0.0125, reserved_usd: 0.0005, live_calls: 7, input_tokens: 31250, rpm: 120 },
    env: { path: ".env", exists: true, perms_ok: true, git_repo: true, problems: [], can_save: true } }),
  // Connected for this run only (pasted, not saved), a model picked in the settings that cannot answer Box questions.
  memory: Object.freeze({ version: "0.9.0", configured: true, key_source: "memory", model: "jev-1.13.2", model_source: "selected",
    default_model: "jev-1.14.0", supports_box: false, backend: "stdlib", price_per_mtok_input: 0.35,
    spend: { budget_usd: 5, spent_usd: 4.75, reserved_usd: 0, live_calls: 812, input_tokens: 13571428, rpm: 60 },
    env: { path: ".env", exists: false, perms_ok: null, git_repo: true, problems: [".env is not ignored by git."], can_save: false } }),
  // No key yet: the pill says "Connect API key".
  noKey: Object.freeze({ version: "0.9.0", configured: false, key_source: null, model: "jev-1.14.0", model_source: "default",
    default_model: "jev-1.14.0", supports_box: true, backend: "typesafe-sdk", price_per_mtok_input: 0.4,
    spend: { budget_usd: 2, spent_usd: 0, reserved_usd: 0, live_calls: 0, input_tokens: 0, rpm: 120 },
    env: { path: ".env", exists: false, perms_ok: null, git_repo: true, problems: [], can_save: true } }),
  // JEV_LAB_BUDGET_USD=0: no budget, so nothing is "left".
  noBudget: Object.freeze({ version: "0.9.0", configured: true, key_source: "env", model: "jev-latest", model_source: "default",
    default_model: "jev-latest", supports_box: true, backend: "typesafe-sdk", price_per_mtok_input: 0.4,
    spend: { budget_usd: 0, spent_usd: 0.31, reserved_usd: 0, live_calls: 40, input_tokens: 775000, rpm: 120 },
    env: { path: ".env", exists: true, perms_ok: false, git_repo: true, problems: [], can_save: true } }),
  // Spent past the budget (the guard refuses the next call): remaining is 0, not negative.
  overBudget: Object.freeze({ version: "0.9.0", configured: true, key_source: "file", model: "jev-1.14.0", model_source: "default",
    default_model: "jev-1.14.0", supports_box: true, backend: "typesafe-sdk", price_per_mtok_input: 0.4,
    spend: { budget_usd: 0.05, spent_usd: 0.0512, reserved_usd: 0, live_calls: 128, input_tokens: 128000, rpm: 120 },
    env: { path: ".env", exists: true, perms_ok: true, git_repo: true, problems: [], can_save: true } }),
  // Before the first status answer of the page load (common.js starts with this).
  loading: Object.freeze({ configured: false }),
});

// Mounted commands as commandRows() reports them: a chrome command with a shortcut, one without, and a page command.
export const COMMANDS = Object.freeze([
  Object.freeze({ key: "chrome-essentials/keyboard_help", title: "Show keyboard shortcuts", keys: "?", group: "Help", surface: "chrome" }),
  Object.freeze({ key: "chrome-essentials/go_workbench", title: "Go to Workbench", keys: null, group: "Go to", surface: "chrome" }),
  Object.freeze({ key: "shield-inbox/next_message", title: "Select the next message", keys: "j", group: "Inbox", surface: "shield.inbox" }),
]);

export function sampleChromeCtx(overrides = {}) {
  const calls = [];
  const missing = new Set(overrides.missing || []);
  let theme = overrides.theme ?? "system";
  const path = overrides.path ?? "/shield";
  const source = {
    path,
    url: overrides.url !== undefined ? overrides.url : `http://127.0.0.1:8321${path}`,
    status: overrides.status !== undefined ? overrides.status : STATUS.connected,
    theme: () => theme,
    systemLight: overrides.systemLight === true,
    layers: overrides.layers || [],
    commands: overrides.commands || COMMANDS,
    mac: overrides.mac === true,
    go: (target) => { calls.push(["go", target]); },
    openSettings: () => { calls.push(["openSettings"]); },
    openPalette: () => { calls.push(["openPalette"]); },
    setTheme: (preference) => { calls.push(["setTheme", preference]); theme = preference; return overrides.storageBlocked !== true; },
    copy: (text) => { calls.push(["copy", text]); },
    openHelp: () => { calls.push(["openHelp"]); },
    focusMain: () => { calls.push(["focusMain"]); return overrides.mainMissing !== true; },
    openOfficial: (url) => { calls.push(["openOfficial", url]); },
  };
  for (const name of missing) delete source[name];
  const ctx = chromeCtx(source);
  ctx.calls = calls;
  ctx.env = fakeEnv();
  return ctx;
}
