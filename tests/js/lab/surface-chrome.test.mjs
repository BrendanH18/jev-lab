// The page-wide "chrome" surface: its builder (static/js/lab/surfaces/chrome.js chromeCtx) and its hook, installLab()
// in static/js/lab/env.js, run for real in the stand-in browser of tests/js/lab/fixtures/chrome-dom.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import { definePack } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";
import { chromeCtx } from "../../../static/js/lab/surfaces/chrome.js";
import { COMMANDS, STATUS, sampleChromeCtx } from "./fixtures/chrome.mjs";
import { makeEvent, startChrome } from "./fixtures/chrome-dom.mjs";

// ---------- the builder ----------

test("chromeCtx has no list: items() and shown() are the same empty frozen array, itemName is a position", () => {
  const ctx = sampleChromeCtx();
  assert.deepEqual(ctx.items(), []);
  assert.equal(ctx.items(), ctx.shown());
  assert.ok(Object.isFrozen(ctx.items()));
  assert.equal(ctx.itemName({}, 2), "3");
  assert.equal(ctx.refresh(), undefined);
});

test("data: path, url, links and page follow the current address", () => {
  const ctx = sampleChromeCtx({ path: "/reviews" });
  assert.equal(ctx.data.path, "/reviews");
  assert.equal(ctx.data.url, "http://127.0.0.1:8321/reviews");
  assert.equal(ctx.data.links.length, 10);
  assert.deepEqual(ctx.data.links.filter((link) => link.current).map((link) => link.path), ["/reviews"]);
  assert.deepEqual(ctx.data.page, { path: "/reviews", label: "Reviews" });
  assert.ok(Object.isFrozen(ctx.data.links) && Object.isFrozen(ctx.data.links[0]));

  const odd = chromeCtx({ path: "/workbench?x=1#build", url: "javascript:alert(1)" });
  assert.equal(odd.data.path, "/workbench");
  assert.equal(odd.data.url, null);
  assert.deepEqual(odd.data.page, { path: "/workbench", label: "Workbench" });
  const nowhere = chromeCtx({ path: "/not-a-page" });
  assert.equal(nowhere.data.page, null);
  assert.equal(nowhere.data.links.some((link) => link.current), false);
  const empty = chromeCtx();
  assert.equal(empty.data.path, "/", "no path reads as the Overview");
  assert.equal(chromeCtx({ path: "shield" }).data.path, "/");
  assert.equal(chromeCtx({ path: () => { throw new Error("gone"); } }).data.path, "/", "a throwing source reads as missing");
  assert.equal(chromeCtx({ url: "http://user:pw@127.0.0.1:8321/find" }).data.url, "http://127.0.0.1:8321/find");
});

test("data.status is the allow-listed snapshot, never the raw status", () => {
  const ctx = sampleChromeCtx({ status: { ...STATUS.connected, api_key: "ts-live-not-a-real-key" } });
  const status = ctx.data.status;
  assert.equal(status.loaded, true);
  assert.equal(status.model, "jev-1.14.0");
  assert.equal(status.spend.live_calls, 7);
  assert.ok(Math.abs(status.spend.remaining_usd - 1.987) < 1e-12);
  assert.deepEqual(status.env, { can_save: true, perms_ok: true, problem_count: 0 });
  assert.ok(!JSON.stringify(status).includes("ts-live"));
  assert.ok(Object.isFrozen(status) && Object.isFrozen(status.spend));
  assert.equal(sampleChromeCtx({ status: STATUS.loading }).data.status.loaded, false);
  assert.equal(sampleChromeCtx({ status: null }).data.status.loaded, false);
  assert.equal(sampleChromeCtx({ status: STATUS.noBudget }).data.status.spend.remaining_usd, null);
  assert.equal(sampleChromeCtx({ status: STATUS.overBudget }).data.status.spend.remaining_usd, 0);
  assert.equal(sampleChromeCtx({ status: STATUS.memory }).data.status.env.problem_count, 1);
});

test("data: theme, effectiveTheme, themes, layers, commands, shortcuts and mac", () => {
  const ctx = sampleChromeCtx({ theme: "system", systemLight: true, layers: ["settings", 4, "palette"], mac: true });
  assert.equal(ctx.data.theme, "system");
  assert.equal(ctx.data.effectiveTheme, "light");
  assert.deepEqual(ctx.data.themes, ["system", "light", "dark"]);
  assert.deepEqual(ctx.data.layers, ["settings", "palette"]);
  assert.equal(ctx.data.mac, true);
  assert.equal(sampleChromeCtx({ theme: "sepia" }).data.theme, "system");
  assert.equal(sampleChromeCtx({ theme: "dark", systemLight: true }).data.effectiveTheme, "dark");
  assert.deepEqual(ctx.data.commands, COMMANDS);
  assert.deepEqual(ctx.data.shortcuts.slice(4).map((row) => [row.keys, row.title]),
    [["?", "Show keyboard shortcuts"], ["j", "Select the next message"], [null, "Go to Workbench"]]);
  assert.deepEqual(chromeCtx({ commands: [{ title: "" }, null, { title: "Ok", keys: "", group: 3 }] }).data.commands,
    [{ key: null, title: "Ok", keys: null, group: null, surface: null }]);
  assert.deepEqual(chromeCtx({ commands: "nope" }).data.commands, []);
});

test("data getters are live: they read the source each time", () => {
  let path = "/";
  const ctx = chromeCtx({ path: () => path });
  assert.equal(ctx.data.page.label, "Overview");
  path = "/play";
  assert.equal(ctx.data.page.label, "Play");
});

test("actions: go accepts only this app's paths", () => {
  const ctx = sampleChromeCtx();
  ctx.actions.go("/workbench#build");
  for (const bad of ["https://evil.example/", "//evil.example", "javascript:alert(1)", "/a b", 7]) assert.throws(() => ctx.actions.go(bad), /starts with \//);
  assert.deepEqual(ctx.calls, [["go", "/workbench#build"]]);
});

test("actions: setTheme refuses unknown themes, cycleTheme walks system, light, dark", () => {
  const ctx = sampleChromeCtx({ theme: "light" });
  assert.throws(() => ctx.actions.setTheme("sepia"), /system, light or dark/);
  assert.throws(() => ctx.actions.setTheme(undefined), /system, light or dark/);
  assert.equal(ctx.actions.setTheme("dark"), true);
  assert.equal(ctx.actions.cycleTheme(), "system");
  assert.equal(ctx.actions.cycleTheme(), "light");
  assert.deepEqual(ctx.calls, [["setTheme", "dark"], ["setTheme", "system"], ["setTheme", "light"]]);
  assert.equal(sampleChromeCtx({ storageBlocked: true }).actions.setTheme("dark"), false);
});

test("actions: copyLink needs a link, focusMain needs a <main>, openOfficial only TypeSafe pages", () => {
  const ctx = sampleChromeCtx({ path: "/find" });
  ctx.actions.copyLink();
  assert.throws(() => sampleChromeCtx({ url: null }).actions.copyLink(), /no link to copy/);
  assert.equal(ctx.actions.focusMain(), true);
  assert.throws(() => sampleChromeCtx({ mainMissing: true }).actions.focusMain(), /no main content/);
  ctx.actions.openOfficial("https://docs.typesafe.ai/images");
  for (const bad of ["https://evil.example/", "http://docs.typesafe.ai/", "/workbench"]) assert.throws(() => ctx.actions.openOfficial(bad), /official TypeSafe/);
  ctx.actions.openSettings();
  ctx.actions.openPalette();
  ctx.actions.openHelp();
  assert.deepEqual(ctx.calls, [["copy", "http://127.0.0.1:8321/find"], ["focusMain"], ["openOfficial", "https://docs.typesafe.ai/images"],
    ["openSettings"], ["openPalette"], ["openHelp"]]);
});

test("actions whose page callback is missing throw a message instead of failing silently", () => {
  const ctx = chromeCtx({});
  for (const run of [() => ctx.actions.go("/"), () => ctx.actions.openSettings(), () => ctx.actions.openPalette(), () => ctx.actions.setTheme("dark"),
    () => ctx.actions.cycleTheme(), () => ctx.actions.openHelp(), () => ctx.actions.focusMain(),
    () => ctx.actions.openOfficial("https://docs.typesafe.ai/")]) assert.throws(run, /cannot do that here/);
  assert.throws(() => ctx.actions.copyLink(), /no link to copy/, "the guard comes first");
  assert.equal(ctx.actions.replaceItems, undefined, "the chrome surface is read-only: no replaceItems");
  assert.equal(ctx.actions.importItems, undefined);
});

// ---------- the hook: installLab() in static/js/lab/env.js ----------

const { browser: b, common, env } = await startChrome({ path: "/find" });
const run = [];
const pagePack = definePack({ id: "find-sample", surface: "find.results", title: "Find sample", features: [
  { id: "next", kind: "command", title: "Select the next passage", keys: "j", group: "Results", run: () => { run.push("next"); } },
  { id: "fail", kind: "command", title: "Fail loudly", keys: "Alt+Shift+F", run: () => { throw new Error("Nothing to select."); } },
] });
const chromePack = definePack({ id: "chrome-sample", surface: "chrome", title: "Chrome sample", features: [
  { id: "help", kind: "command", title: "Show keyboard shortcuts", keys: "?", run: (ctx) => ctx.actions.openHelp() },
  { id: "where", kind: "command", title: "Say where I am", run: (ctx) => { run.push(`${ctx.data.page.label} ${ctx.data.status.model} ${ctx.data.theme}`); } },
] });
const lab = createLab([pagePack, chromePack]);
const installed = env.installLab(lab, { data: { extra: "page value", path: "/elsewhere" }, actions: { go: () => run.push("hijacked"), ping: () => "pong" } });

test("installLab mounts one chrome ctx built by chromeCtx from the live page", () => {
  assert.equal(env.installLab(lab), installed, "installing twice returns the first install");
  assert.deepEqual(lab.mountedIds(), ["chrome"]);
  const ctx = installed.ctx;
  assert.equal(ctx.env, env.labEnv);
  assert.equal(ctx.data.path, "/find");
  assert.equal(ctx.data.page.label, "Find");
  assert.equal(ctx.data.url, "http://127.0.0.1:8321/find");
  assert.equal(ctx.data.status.loaded, true);
  assert.equal(ctx.data.status.model, "jev-1.14.0");
  assert.equal(ctx.data.theme, common.themePreference());
  assert.equal(ctx.data.mac, false);
  assert.equal(ctx.data.extra, "page value", "a page may add data under a new name");
  assert.equal(ctx.actions.ping(), "pong", "and actions under a new name");
  ctx.actions.go("/play");
  assert.deepEqual(b.navigations, ["/play"], "but never replace a contract action");
  assert.deepEqual(run, []);
  b.navigations.length = 0;
});

test("the chrome ctx's actions reach the page: theme, copy, focus, official pages, settings and palette", async () => {
  const ctx = installed.ctx;
  ctx.actions.setTheme("dark");
  assert.equal(b.html.getAttribute("data-theme"), "dark");
  assert.equal(ctx.data.theme, "dark");
  ctx.actions.setTheme("system");
  ctx.actions.copyLink();
  await Promise.resolve();
  assert.deepEqual(b.copied, ["http://127.0.0.1:8321/find"]);
  assert.equal(ctx.actions.focusMain(), true);
  assert.equal(b.document.activeElement, b.find("main"));
  ctx.actions.openOfficial("https://console.typesafe.ai/settings/keys");
  assert.deepEqual(b.opened, [{ url: "https://console.typesafe.ai/settings/keys", target: "_blank", features: "noopener" }]);
  ctx.actions.openSettings();
  assert.deepEqual(ctx.data.layers, ["settings"]);
  ctx.actions.openPalette();
  assert.deepEqual(ctx.data.layers, ["settings", "palette"]);
  b.key("Escape");
  b.key("Escape");
  assert.deepEqual(ctx.data.layers, []);
});

test("the top bar gets a Commands button after its spacer, and data.commands lists every mounted command", () => {
  const button = b.find(".topbar .lab-palette-button");
  assert.ok(button);
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  const bar = b.find(".topbar");
  assert.equal(bar.children.indexOf(button), bar.children.indexOf(b.find(".topbar .spacer")) + 1);
  lab.mount("find.results", {});
  assert.deepEqual(installed.ctx.data.commands.map((row) => row.key), ["chrome-sample/help", "chrome-sample/where", "find-sample/next", "find-sample/fail"]);
  lab.unmountAll(["chrome"]);
  assert.deepEqual(installed.ctx.data.commands.map((row) => row.surface), ["chrome", "chrome"], "a page that unmounts its surfaces keeps the chrome");
});

test("shortcuts run mounted commands, are ignored while typing, and report errors as toasts", () => {
  lab.mount("find.results", {});
  b.body.focus?.();
  b.document.activeElement = b.body;
  const plain = b.key("j");
  assert.deepEqual(run, ["next"]);
  assert.equal(plain.defaultPrevented, true);
  const field = b.document.createElement("input");
  b.find("main").append(field);
  field.focus();
  const typed = b.key("j");
  assert.deepEqual(run, ["next"], "a bare key typed into a field is left alone");
  assert.equal(typed.defaultPrevented, false);
  b.document.activeElement = b.body;
  common.inspect({ request: { model: "jev-1.14.0", state: { text: "Is the Pier 4 roastery open?" }, questions: {} }, response: {}, meta: {} }, "Find · hours");
  b.key("j");
  assert.deepEqual(run, ["next"], "shortcuts wait while the request drawer is open");
  b.key("Escape");
  b.document.activeElement = b.body;
  b.key("F", { altKey: true, shiftKey: true });
  const host = b.find(".toast-host");
  assert.equal(host.children[host.children.length - 1].textContent, "Nothing to select.");
  assert.equal(host.children[host.children.length - 1].getAttribute("role"), "alert");
  lab.unmountAll(["chrome"]);
  b.document.activeElement = b.body;
});

test("the palette runs a chrome command with the chrome ctx", () => {
  installed.open();
  const item = b.find('[data-lab-command="chrome-sample/where"]');
  assert.ok(item);
  item.click();
  assert.equal(run[run.length - 1], `Find jev-1.14.0 ${common.themePreference()}`);
  assert.deepEqual(common.openLayers(), []);
});

test("keyboard help lists built-ins and every mounted command, opens on ?, closes on Escape and returns focus", () => {
  lab.mount("find.results", {});
  const pill = b.find("#key-pill");
  pill.focus();
  b.key("?", { shiftKey: true });
  const dialog = b.find('[role="dialog"][aria-labelledby="lab-help-title"]');
  assert.ok(dialog, "? opened the keyboard help");
  assert.equal(b.find("#lab-help-title").textContent, "Keyboard shortcuts");
  assert.deepEqual(common.openLayers(), ["help"]);
  assert.ok(dialog.contains(b.document.activeElement));
  const rows = dialog.querySelectorAll("tbody tr").map((row) => row.children.map((cell) => cell.textContent));
  assert.deepEqual(rows.slice(0, 2), [["Ctrl + K", "Open or close the command palette", "Every page"],
    ["Escape", "Close the newest dialog, drawer or palette and return focus", "Every page"]]);
  assert.deepEqual(rows.slice(4), [["?", "Show keyboard shortcuts", ""], ["j", "Select the next passage", "Results"],
    ["Alt + Shift + F", "Fail loudly", ""], ["Palette", "Say where I am", ""]]);
  b.key("j");
  assert.equal(run.filter((entry) => entry === "next").length, 1, "page shortcuts wait while the help is open");
  installed.ctx.actions.openHelp();
  assert.equal(b.findAll('[aria-labelledby="lab-help-title"]').length, 1, "a second open does nothing");
  b.key("Escape");
  assert.equal(b.find('[aria-labelledby="lab-help-title"]'), null);
  assert.equal(b.document.activeElement, pill);
  installed.ctx.actions.openHelp();
  const wrap = b.find("[data-lab-help]");
  wrap.dispatchEvent(makeEvent("click", { target: wrap }));
  assert.equal(b.find("[data-lab-help]"), null, "a click on the backdrop closes it");
  lab.unmountAll(["chrome"]);
});
