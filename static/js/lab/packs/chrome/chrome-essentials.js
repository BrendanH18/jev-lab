// Chrome essentials: the page-wide commands every Jev Lab page offers in its command palette (go to a page, settings,
// theme, page link, keyboard help, skip to content, official TypeSafe pages, the connection summary) and the records
// of the keyboard and screen-reader behaviors that static/js/common.js, static/js/lab/env.js and static/css/app.css
// implement. Commands act only through ctx.actions and ctx.env; nothing here reads storage or calls the server.
import { definePack } from "../../kit.js";

const PAGES = [
  ["overview", "/", "Overview"], ["shield", "/shield", "Shield"], ["dispatch", "/dispatch", "Dispatch"], ["autopilot", "/autopilot", "Autopilot"],
  ["claims", "/claims", "Claims"], ["reviews", "/reviews", "Reviews"], ["find", "/find", "Find"], ["play", "/play", "Play"],
  ["counter", "/counter", "Counter"], ["workbench", "/workbench", "Workbench"],
];

const THEME_NAMES = { system: "System (follows your device)", light: "Light", dark: "Dark" };

const dollars = (value) => (typeof value === "number" && Number.isFinite(value) ? `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}` : "unknown");
const whole = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "unknown");
const KEY_SOURCES = { env: "the TYPESAFE_API_KEY environment variable", file: ".env in the project folder", memory: "this server's memory (until restart)" };

// The connection summary: model, backend and the spend guard's measured counts for this server run. The status
// snapshot never holds the key, and neither does this text.
export function connectionSummary(status) {
  if (!status || !status.loaded) return null;
  const lines = ["Jev Lab connection (this server run)"];
  lines.push(status.configured ? `Key: connected, from ${KEY_SOURCES[status.key_source] || "an unknown source"}` : "Key: not connected");
  if (status.model) {
    lines.push(status.model_source === "selected"
      ? `Model: ${status.model} (selected for this run; a restart returns to ${status.default_model || "the default"})`
      : `Model: ${status.model} (the default)`);
  }
  if (status.supports_box !== null) lines.push(`Box questions: ${status.supports_box ? "answered by this model" : "not answered by this model"}`);
  if (status.backend) lines.push(`Backend: ${status.backend}`);
  const spend = status.spend;
  if (spend) {
    const budget = typeof spend.budget_usd === "number" && spend.budget_usd > 0;
    lines.push(budget ? `Spent: ${dollars(spend.spent_usd)} of a ${dollars(spend.budget_usd)} budget (${dollars(spend.remaining_usd)} left), measured`
      : `Spent: ${dollars(spend.spent_usd)}, measured (no budget set)`);
    lines.push(`Live calls: ${whole(spend.live_calls)} · input tokens: ${whole(spend.input_tokens)} · local cap ${whole(spend.rpm)}/min`);
  }
  return lines.join("\n");
}

function themeMessage(preference, kept) {
  return `Theme: ${THEME_NAMES[preference] || preference}${kept === false ? ". This browser did not keep the choice, so it lasts for this page only." : ""}`;
}

const goTo = ([id, path, label]) => ({ id: `go_${id}`, kind: "command", group: "Go to", title: `Go to ${label}`,
  help: `Opens ${label} in this tab. A page with unsaved edits still asks before it is left.`,
  when: (ctx) => ctx.data.path !== path, run: (ctx) => ctx.actions.go(path) });

const useTheme = (preference) => ({ id: `theme_${preference}`, kind: "command", group: "Theme",
  title: { system: "Use the system theme", light: "Use the light theme", dark: "Use the dark theme" }[preference],
  when: (ctx) => ctx.data.theme !== preference,
  run: (ctx) => { const kept = ctx.actions.setTheme(preference); ctx.env.toast(themeMessage(preference, kept)); } });

export default definePack({
  id: "chrome-essentials",
  surface: "chrome",
  title: "Every page: essentials",
  about: "Page-wide commands in the command palette (go to any page, key and safety settings, theme, page link, keyboard help, skip to content, official TypeSafe pages, a connection summary) and the keyboard and screen-reader behaviors of the shared chrome. The connection summary holds the model, backend and measured spend of this server run, never the API key.",
  features: [
    ...PAGES.map(goTo),
    { id: "go_build", kind: "command", group: "Go to", title: "Open the Workbench Build tab",
      help: "Opens the Workbench with the Build tab selected.", run: (ctx) => ctx.actions.go("/workbench#build") },
    { id: "open_settings", kind: "command", group: "Settings", title: "Open API key and safety settings",
      help: "The same dialog as the key pill in the top bar.", run: (ctx) => ctx.actions.openSettings() },
    useTheme("system"),
    useTheme("light"),
    useTheme("dark"),
    { id: "cycle_theme", kind: "command", group: "Theme", title: "Cycle the theme: system, light, dark",
      run: (ctx) => {
        const next = ctx.actions.cycleTheme();
        ctx.env.toast(themeMessage(next, true));
      } },
    { id: "copy_link", kind: "command", group: "Page", title: "Copy this page's link", when: (ctx) => ctx.data.url !== null,
      run: (ctx) => ctx.actions.copyLink() },
    { id: "keyboard_help", kind: "command", group: "Help", title: "Show keyboard shortcuts", keys: "?",
      help: "Lists every shortcut and every command of this page.", run: (ctx) => ctx.actions.openHelp() },
    { id: "focus_main", kind: "command", group: "Page", title: "Skip to the page content", run: (ctx) => ctx.actions.focusMain() },
    { id: "open_console", kind: "command", group: "TypeSafe", title: "Open the TypeSafe console to create an API key",
      run: (ctx) => ctx.actions.openOfficial("https://console.typesafe.ai/settings/keys") },
    { id: "open_docs", kind: "command", group: "TypeSafe", title: "Open the TypeSafe docs",
      run: (ctx) => ctx.actions.openOfficial("https://docs.typesafe.ai/") },
    { id: "copy_status", kind: "command", group: "Settings", title: "Copy the connection summary (model, backend, measured spend)",
      when: (ctx) => ctx.data.status.loaded === true,
      run: (ctx) => {
        const text = connectionSummary(ctx.data.status);
        if (!text) throw new Error("The connection status has not loaded yet.");
        ctx.env.copy(text);
      } },
    { id: "budget_left", kind: "command", group: "Settings", title: "Show the budget left for this server run",
      when: (ctx) => ctx.data.status.loaded === true && ctx.data.status.spend !== null,
      run: (ctx) => {
        const spend = ctx.data.status.spend;
        if (!spend) throw new Error("The spend guard has not reported yet.");
        if (spend.remaining_usd === null) ctx.env.toast(`No budget is set for this server run. Measured spend so far: ${dollars(spend.spent_usd)}.`);
        else ctx.env.toast(`Budget left this server run: ${dollars(spend.remaining_usd)} of ${dollars(spend.budget_usd)} (measured; calls in flight count as spent).`,
          spend.remaining_usd === 0 ? "error" : "");
      } },

    { id: "skip_link", kind: "behavior", title: "Skip to content: the first Tab stop, shown only while focused, moves focus past the top bar",
      where: "static/js/common.js initChrome and focusMain; static/css/app.css .skip-link" },
    { id: "settings_dialog", kind: "behavior", title: "Key and safety settings: a labelled modal that takes focus, closes on Escape and returns focus",
      where: "static/js/common.js openSettings" },
    { id: "inspector_focus", kind: "behavior", title: "Request inspector: Escape, Close and the backdrop close it and return focus to the opener",
      where: "static/js/common.js inspect" },
    { id: "inert_drawer", kind: "behavior", title: "Closed request inspector is inert: no hidden Tab stops or read-out text",
      where: "static/js/common.js inspect" },
    { id: "palette_focus", kind: "behavior", title: "Command palette: Escape closes it and focus returns to where it was",
      where: "static/js/lab/env.js installLab, through common.js openLayer" },
    { id: "escape_newest", kind: "behavior", title: "Escape closes only the newest overlay when dialogs are stacked",
      where: "static/js/common.js openLayer; static/js/chrome.js createLayers" },
    { id: "tab_wrap", kind: "behavior", title: "Tab and Shift+Tab wrap inside an open dialog instead of escaping behind it",
      where: "static/js/common.js trapTab; static/js/chrome.js trapFocus" },
    { id: "live_toasts", kind: "behavior", title: "Toasts are announced by screen readers through a polite live region",
      where: "static/js/common.js toast and initChrome" },
    { id: "error_alerts", kind: "behavior", title: "Error toasts are alerts that interrupt and stay longer",
      where: "static/js/common.js toast" },
    { id: "focus_visible", kind: "behavior", title: "Visible keyboard focus ring on buttons, links, fields, chips, tabs and summaries in both themes",
      where: "static/css/app.css :focus-visible rules" },
    { id: "theme_preference", kind: "behavior", title: "Theme preference (system, light or dark) applied before the page draws and remembered under one key",
      where: "static/js/common.js setTheme; static/js/chrome.js readTheme and writeTheme; static/css/app.css data-theme" },
    { id: "theme_sync", kind: "behavior", title: "A theme chosen in another tab applies here too",
      where: "static/js/common.js storage listener" },
    { id: "theme_picker", kind: "behavior", title: "Theme picker in the settings dialog shows the current choice as pressed",
      where: "static/js/common.js themePicker" },
    { id: "aria_current", kind: "behavior", title: "Top bar marks the current page for screen readers",
      where: "static/js/common.js initChrome" },
  ],
});
