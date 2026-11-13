// Tests for the page-wide pack static/js/lab/packs/chrome/chrome-essentials.js. Commands run against a real chromeCtx
// (tests/js/lab/fixtures/chrome.mjs); behaviors run the real static/js/common.js and static/js/lab/env.js in the
// stand-in browser of tests/js/lab/fixtures/chrome-dom.mjs, and read static/css/app.css for the styles.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import pack from "../../../static/js/lab/packs/chrome/chrome-essentials.js";
import { createLab } from "../../../static/js/lab/host.js";
import { checkPack } from "./harness.mjs";
import { STATUS, sampleChromeCtx } from "./fixtures/chrome.mjs";
import { makeEvent, startChrome } from "./fixtures/chrome-dom.mjs";

const CSS = readFileSync(new URL("../../../static/css/app.css", import.meta.url), "utf8");
const loaded = await startChrome({ path: "/claims", theme: "light" });
const { browser: b, common, env, chrome } = loaded;
const themeAtLoad = b.html.getAttribute("data-theme");
const installed = env.installLab(createLab([pack]));
const feature = (id) => pack.features.find((entry) => entry.id === id);

const TRACE = {
  request: { model: "jev-1.14.0", state: { text: "The latte order for harbor-events@harborcoffee.example arrived cold." },
    questions: { cold: { type: "noul", instructions: "Does `text` say the drink arrived cold?" } } },
  response: { answers: { cold: { type: "noul", noul: 0.93 } } },
  meta: { model: "jev-1.14.0", question_count: 1, latency_ms: 412, input_tokens: 96, cost_usd: 0.0000384 },
};

// A button outside every dialog that "opened" something, so focus return can be checked.
function opener(label = "Opener") {
  const button = b.document.createElement("button");
  button.textContent = label;
  b.body.append(button);
  button.focus();
  return button;
}
const inside = (container) => container.contains(b.document.activeElement);
const settingsDialog = () => b.find('[role="dialog"][aria-labelledby="settings-title"]');
const go = (id, path, other) => ({ ctx: () => sampleChromeCtx({ path: other }), hidden: () => sampleChromeCtx({ path }),
  check: (ctx) => assert.deepEqual(ctx.calls, [["go", path]]) });

checkPack(pack, {
  go_overview: go("overview", "/", "/shield"),
  go_shield: go("shield", "/shield", "/"),
  go_dispatch: go("dispatch", "/dispatch", "/claims"),
  go_autopilot: go("autopilot", "/autopilot", "/workbench"),
  go_claims: go("claims", "/claims", "/reviews"),
  go_reviews: go("reviews", "/reviews", "/find"),
  go_find: go("find", "/find", "/play"),
  go_play: go("play", "/play", "/counter"),
  go_counter: go("counter", "/counter", "/dispatch"),
  go_workbench: go("workbench", "/workbench", "/autopilot"),
  go_build: { ctx: () => sampleChromeCtx({ path: "/workbench" }), check: (ctx) => assert.deepEqual(ctx.calls, [["go", "/workbench#build"]]) },
  open_settings: { ctx: () => sampleChromeCtx(), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["openSettings"]]);
    assert.throws(() => feature("open_settings").run(sampleChromeCtx({ missing: ["openSettings"] })), /cannot do that here/);
  } },
  theme_system: { ctx: () => sampleChromeCtx({ theme: "dark" }), hidden: () => sampleChromeCtx({ theme: "system" }), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["setTheme", "system"]]);
    assert.deepEqual(ctx.env.toasts, [{ message: "Theme: System (follows your device)", kind: "" }]);
  } },
  theme_light: { ctx: () => sampleChromeCtx({ theme: "system", storageBlocked: true }), hidden: () => sampleChromeCtx({ theme: "light" }), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["setTheme", "light"]]);
    assert.equal(ctx.data.theme, "light");
    assert.deepEqual(ctx.env.toasts, [{ message: "Theme: Light. This browser did not keep the choice, so it lasts for this page only.", kind: "" }]);
  } },
  theme_dark: { ctx: () => sampleChromeCtx({ theme: "light" }), hidden: () => sampleChromeCtx({ theme: "dark" }), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["setTheme", "dark"]]);
    assert.equal(ctx.data.effectiveTheme, "dark");
    assert.deepEqual(ctx.env.toasts.map((toast) => toast.message), ["Theme: Dark"]);
  } },
  cycle_theme: { ctx: () => sampleChromeCtx({ theme: "dark", systemLight: true }), check: async (ctx) => {
    assert.deepEqual(ctx.calls, [["setTheme", "system"]]);
    assert.equal(ctx.data.effectiveTheme, "light", "system on a light device");
    await feature("cycle_theme").run(ctx);
    assert.deepEqual(ctx.calls.map((entry) => entry[1]), ["system", "light"]);
    assert.deepEqual(ctx.env.toasts.map((toast) => toast.message), ["Theme: System (follows your device)", "Theme: Light"]);
    const blocked = sampleChromeCtx({ theme: "light", storageBlocked: true });
    await feature("cycle_theme").run(blocked);
    assert.deepEqual(blocked.calls, [["setTheme", "dark"]]);
    assert.deepEqual(blocked.env.toasts.map((toast) => toast.message), ["Theme: Dark. This browser did not keep the choice, so it lasts for this page only."],
      "a browser that refuses to remember the choice is reported, as for the direct theme commands");
  } },
  copy_link: { ctx: () => sampleChromeCtx({ path: "/workbench", url: "http://127.0.0.1:8321/workbench#build" }),
    hidden: () => sampleChromeCtx({ url: "file:///home/harbor/notes.txt" }),
    check: (ctx) => assert.deepEqual(ctx.calls, [["copy", "http://127.0.0.1:8321/workbench#build"]]) },
  keyboard_help: { ctx: () => sampleChromeCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["openHelp"]]) },
  focus_main: { ctx: () => sampleChromeCtx(), check: (ctx) => {
    assert.deepEqual(ctx.calls, [["focusMain"]]);
    assert.throws(() => feature("focus_main").run(sampleChromeCtx({ mainMissing: true })), /no main content/);
  } },
  open_console: { ctx: () => sampleChromeCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["openOfficial", "https://console.typesafe.ai/settings/keys"]]) },
  open_docs: { ctx: () => sampleChromeCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["openOfficial", "https://docs.typesafe.ai/"]]) },
  copy_status: { ctx: () => sampleChromeCtx(), hidden: () => sampleChromeCtx({ status: STATUS.loading }), check: async (ctx) => {
    assert.deepEqual(ctx.env.copied, ["Jev Lab connection (this server run)\n"
      + "Key: connected, from .env in the project folder\n"
      + "Model: jev-1.14.0 (the default)\n"
      + "Box questions: answered by this model\n"
      + "Backend: typesafe-sdk\n"
      + "Spent: $0.0125 of a $2.00 budget ($1.99 left), measured\n"
      + "Live calls: 7 · input tokens: 31,250 · local cap 120/min"]);
    const other = sampleChromeCtx({ status: STATUS.memory });
    await feature("copy_status").run(other);
    assert.deepEqual(other.env.copied[0].split("\n").slice(1), [
      "Key: connected, from this server's memory (until restart)",
      "Model: jev-1.13.2 (selected for this run; a restart returns to jev-1.14.0)",
      "Box questions: not answered by this model",
      "Backend: stdlib",
      "Spent: $4.75 of a $5.00 budget ($0.2500 left), measured",
      "Live calls: 812 · input tokens: 13,571,428 · local cap 60/min"]);
    const none = sampleChromeCtx({ status: STATUS.noKey });
    await feature("copy_status").run(none);
    assert.equal(none.env.copied[0].split("\n")[1], "Key: not connected");
    for (const text of [...ctx.env.copied, ...other.env.copied, ...none.env.copied]) assert.ok(!/problems|\.env is not|exists|git_repo/.test(text));
  } },
  budget_left: { ctx: () => sampleChromeCtx(), hidden: () => sampleChromeCtx({ status: STATUS.loading }), check: async (ctx) => {
    assert.deepEqual(ctx.env.toasts, [{ message: "Budget left this server run: $1.99 of $2.00 (measured; calls in flight count as spent).", kind: "" }]);
    const over = sampleChromeCtx({ status: STATUS.overBudget });
    await feature("budget_left").run(over);
    assert.deepEqual(over.env.toasts, [{ message: "Budget left this server run: $0.0000 of $0.0500 (measured; calls in flight count as spent).", kind: "error" }]);
    const unlimited = sampleChromeCtx({ status: STATUS.noBudget });
    await feature("budget_left").run(unlimited);
    assert.deepEqual(unlimited.env.toasts.map((toast) => toast.message), ["No budget is set for this server run. Measured spend so far: $0.3100."]);
    const unreported = sampleChromeCtx({ status: { ...STATUS.connected, spend: { budget_usd: 2, rpm: 120 } } });
    await feature("budget_left").run(unreported);
    assert.deepEqual(unreported.env.toasts.map((toast) => toast.message), ["Budget for this server run: $2.00. Measured spend has not been reported yet."],
      "a set budget with no measured spend is not called \"no budget\"");
  } },

  skip_link: { check: () => {
    const link = b.body.children[0];
    assert.equal(link.tag, "a");
    assert.ok(link.classList.contains("skip-link"));
    assert.equal(link.textContent, "Skip to content");
    const main = b.find("main");
    assert.equal(main.id, "main-content");
    assert.equal(link.getAttribute("href"), "#main-content");
    assert.equal(main.getAttribute("tabindex"), "-1");
    opener("Elsewhere");
    const click = makeEvent("click");
    link.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true, "the Workbench's tab in the hash is left alone");
    assert.equal(b.document.activeElement, main);
    assert.ok(main.scrolled >= 1);
    assert.match(CSS, /\.skip-link \{[^}]*transform: translateY\(-200%\); opacity: 0;/);
    assert.match(CSS, /\.skip-link:focus, \.skip-link:focus-visible \{ transform: none; opacity: 1;/);
    assert.match(CSS, /main\[tabindex="-1"\]:focus \{ outline: none; \}/);
  } },
  settings_dialog: { check: () => {
    const pill = b.find("#key-pill");
    pill.focus();
    pill.click();
    const dialog = settingsDialog();
    assert.ok(dialog, "the settings dialog opened");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.equal(b.find("#settings-title").textContent, "API key & safety");
    assert.ok(inside(dialog), "focus moved into the dialog");
    assert.deepEqual(common.openLayers(), ["settings"]);
    b.key("Escape");
    assert.equal(settingsDialog(), null);
    assert.equal(b.document.activeElement, pill, "Escape returns focus to the key pill");
    pill.click();
    b.button("Close").click();
    assert.equal(settingsDialog(), null);
    assert.equal(b.document.activeElement, pill, "Close returns focus too");
    assert.deepEqual(common.openLayers(), []);
  } },
  inspector_focus: { check: () => {
    const button = opener("Inspect JSON");
    for (const how of ["Escape", "backdrop", "Close"]) {
      common.inspect(TRACE, "Claims · cold drink");
      const panel = b.find("aside.drawer");
      assert.ok(panel.classList.contains("open"));
      assert.ok(inside(panel), "focus moves into the drawer");
      assert.deepEqual(common.openLayers(), ["inspector"]);
      if (how === "Escape") b.key("Escape");
      else if (how === "backdrop") b.find(".drawer-backdrop").click();
      else b.find('aside.drawer button[aria-label="Close"]').click();
      assert.equal(panel.classList.contains("open"), false, `${how} closes the drawer`);
      assert.equal(b.document.activeElement, button, `${how} returns focus to the opener`);
      assert.deepEqual(common.openLayers(), []);
    }
  } },
  inert_drawer: { check: () => {
    opener();
    common.inspect(TRACE, "Claims · cold drink");
    const panel = b.find("aside.drawer");
    assert.equal(panel.hasAttribute("inert"), false, "open, it can be used");
    assert.equal(panel.getAttribute("role"), "dialog");
    assert.equal(panel.getAttribute("aria-label"), "Request inspector");
    common.closeInspector();
    assert.equal(panel.hasAttribute("inert"), true, "closed, it is inert");
    assert.equal(b.find(".drawer-backdrop").classList.contains("open"), false);
    common.closeInspector();
    assert.equal(panel.hasAttribute("inert"), true, "closing twice changes nothing");
  } },
  palette_focus: { check: () => {
    const button = opener("Somewhere");
    b.key("k", { ctrlKey: true });
    assert.deepEqual(common.openLayers(), ["palette"]);
    assert.equal(b.document.activeElement.getAttribute("aria-label"), "Search commands");
    b.key("Escape");
    assert.deepEqual(common.openLayers(), []);
    assert.equal(b.find(".lab-palette-wrap"), null);
    assert.equal(b.document.activeElement, button);
    b.key("k", { metaKey: true });
    b.key("k", { metaKey: true });
    assert.equal(b.find(".lab-palette-wrap"), null, "Cmd+K toggles it closed");
    assert.equal(b.document.activeElement, button);
    installed.open();
    b.find('[data-lab-command="chrome-essentials/focus_main"]').click();
    assert.equal(b.document.activeElement, b.find("main"), "a command runs after focus has returned");
  } },
  escape_newest: { check: () => {
    const pill = b.find("#key-pill");
    pill.focus();
    pill.click();
    const inDialog = b.document.activeElement;
    b.key("k", { ctrlKey: true });
    assert.deepEqual(common.openLayers(), ["settings", "palette"]);
    b.key("Escape");
    assert.deepEqual(common.openLayers(), ["settings"]);
    assert.ok(settingsDialog(), "the settings dialog stays open");
    assert.equal(b.document.activeElement, inDialog);
    b.key("Escape");
    assert.deepEqual(common.openLayers(), []);
    assert.equal(b.document.activeElement, pill);
  } },
  tab_wrap: { check: () => {
    b.find("#key-pill").click();
    const wrap = b.find(".modal-wrap");
    const stops = wrap.querySelectorAll(chrome.FOCUSABLE).filter((node) => node.style.display !== "none");
    assert.ok(stops.length >= 3);
    stops[stops.length - 1].focus();
    const forward = b.key("Tab");
    assert.equal(forward.defaultPrevented, true);
    assert.equal(b.document.activeElement, stops[0], "Tab from the last control goes to the first");
    const back = b.key("Tab", { shiftKey: true });
    assert.equal(back.defaultPrevented, true);
    assert.equal(b.document.activeElement, stops[stops.length - 1], "Shift+Tab from the first goes to the last");
    stops[1].focus();
    assert.equal(b.key("Tab").defaultPrevented, false, "moves inside the dialog are the browser's own");
    b.key("Escape");
    assert.equal(settingsDialog(), null);
  } },
  live_toasts: { check: () => {
    const host = b.find(".toast-host");
    assert.ok(host && host.parentNode === b.body, "initChrome adds the live region before any toast");
    assert.equal(host.getAttribute("role"), "status");
    assert.equal(host.getAttribute("aria-live"), "polite");
    common.toast("Saved 12 rows to harbor-returns");
    assert.equal(b.find(".toast-host"), host);
    const last = host.children[host.children.length - 1];
    assert.equal(last.textContent, "Saved 12 rows to harbor-returns");
    assert.equal(last.getAttribute("role"), null, "a plain toast is read by the polite region");
    assert.equal(b.timers[b.timers.length - 1].ms, 3200);
  } },
  error_alerts: { check: () => {
    common.toast("Budget reached: $2.00 of $2.00", "error");
    const host = b.find(".toast-host");
    const last = host.children[host.children.length - 1];
    assert.equal(last.getAttribute("role"), "alert");
    assert.ok(last.classList.contains("error"));
    assert.equal(b.timers[b.timers.length - 1].ms, 7000);
    b.runTimers();
    assert.equal(host.children.length, 0, "toasts remove themselves when their time is up");
  } },
  focus_visible: { check: () => {
    for (const selector of ["a:focus-visible", "button:focus-visible", "summary:focus-visible", ".btn:focus-visible", ".chip:focus-visible", ".tab:focus-visible",
      ".key-pill:focus-visible", ".nav a:focus-visible", ".lab-palette-item:focus-visible", ".input:focus-visible", "input:focus-visible", "select:focus-visible",
      "textarea:focus-visible"]) assert.ok(CSS.includes(selector), selector);
    assert.equal((CSS.match(/outline: 2px solid var\(--focus\)/g) || []).length >= 2, true);
    assert.match(CSS, /:root \{ --focus: var\(--accent\); \}/);
    assert.match(CSS, /@media \(prefers-color-scheme: light\) \{ :root:not\(\[data-theme="dark"\]\) \{ --focus: var\(--series\); \} \}/);
    assert.match(CSS, /:root\[data-theme="light"\] \{ --focus: var\(--series\); \}/);
    assert.match(CSS, /:root\[data-theme="dark"\] \{ --focus: var\(--accent\); \}/);
  } },
  theme_preference: { check: () => {
    assert.equal(themeAtLoad, "light", "the stored choice is shown as common.js loads, before the page draws");
    assert.equal(common.setTheme("dark"), true);
    assert.equal(b.html.getAttribute("data-theme"), "dark");
    assert.equal(common.themePreference(), "dark");
    assert.deepEqual([...b.storage.map], [["jev:theme", "dark"]], "one key, one word");
    assert.equal(common.setTheme("system"), true);
    assert.equal(b.html.getAttribute("data-theme"), null);
    assert.equal(b.storage.map.size, 0);
    b.storage.blocked = true;
    try {
      assert.equal(common.setTheme("light"), false, "a refusing browser is reported");
      assert.equal(b.html.getAttribute("data-theme"), "light", "and the choice still applies to this page");
    } finally { b.storage.blocked = false; }
    common.setTheme("bogus");
    assert.equal(common.themePreference(), "system");
    assert.match(CSS, /:root\[data-theme="light"\] \{\n {2}color-scheme: light;/);
    assert.match(CSS, /@media \(prefers-color-scheme: light\) \{\n {2}:root:not\(\[data-theme="dark"\]\) \{/);
  } },
  theme_sync: { check: () => {
    const seen = [];
    const listen = (event) => seen.push(event.detail);
    b.window.addEventListener("jev:theme", listen);
    try {
      b.storage.setItem("jev:theme", "dark");
      b.window.dispatchEvent(makeEvent("storage", { key: "jev:theme" }));
      assert.equal(b.html.getAttribute("data-theme"), "dark");
      assert.equal(common.themePreference(), "dark");
      b.window.dispatchEvent(makeEvent("storage", { key: "jev:handoff-other" }));
      assert.deepEqual(seen, ["dark"], "other keys are ignored");
      b.storage.map.clear();
      b.window.dispatchEvent(makeEvent("storage", { key: null }));
      assert.equal(b.html.getAttribute("data-theme"), null, "storage cleared in another tab: back to system");
      assert.deepEqual(seen, ["dark", "system"]);
    } finally { b.window.removeEventListener("jev:theme", listen); }
  } },
  theme_picker: { check: () => {
    common.setTheme("system");
    b.find("#key-pill").click();
    const chips = () => b.findAll("[data-theme-choice]");
    const pressed = () => chips().filter((chip) => chip.getAttribute("aria-pressed") === "true").map((chip) => chip.getAttribute("data-theme-choice"));
    assert.deepEqual(chips().map((chip) => chip.textContent), ["System", "Light", "Dark"]);
    assert.equal(b.find('[role="group"][aria-label="Theme"]') !== null, true);
    assert.deepEqual(pressed(), ["system"]);
    chips()[1].click();
    assert.deepEqual(pressed(), ["light"]);
    assert.equal(b.html.getAttribute("data-theme"), "light");
    common.setTheme("dark");
    assert.deepEqual(pressed(), ["dark"], "a choice made elsewhere while the dialog is open shows here");
    b.key("Escape");
    common.setTheme("system");
  } },
  aria_current: { check: () => {
    const nav = b.find("nav.nav");
    assert.equal(nav.getAttribute("aria-label"), "Demos");
    const links = nav.querySelectorAll("a");
    assert.equal(links.length, 10);
    assert.deepEqual(links.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent), ["Claims"]);
    assert.ok(links.find((link) => link.textContent === "Claims").classList.contains("active"));
  } },
}, { ctx: () => sampleChromeCtx() });
