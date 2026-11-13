// The pure core of the shared page chrome (static/js/chrome.js): every export, under Node, with no DOM.
// Run with: node --test tests/js/chrome.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import * as chrome from "../../static/js/chrome.js";
import { BUILT_IN_SHORTCUTS, EXTERNAL_HOSTS, FOCUSABLE, LAYER_NAMES, MAIN_ID, NAV_LINKS, THEMES, THEME_KEY, THEME_LABELS, applyTheme, commandRows,
  createLayers, effectiveTheme, externalUrl, keyboardHelp, keysLabel, localPath, nextTheme, normalizeTheme, pageLinks, pageUrl, readTheme,
  statusSnapshot, trapFocus, writeTheme } from "../../static/js/chrome.js";
import { definePack } from "../../static/js/lab/kit.js";
import { createLab } from "../../static/js/lab/host.js";

class Storage {
  constructor() { this.map = new Map(); this.blocked = false; }
  getItem(key) { if (this.blocked) throw new Error("SecurityError"); return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { if (this.blocked) throw new Error("QuotaExceededError"); this.map.set(key, String(value)); }
  removeItem(key) { if (this.blocked) throw new Error("SecurityError"); this.map.delete(key); }
}

class Root {
  constructor() { this.attrs = {}; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
}

const COVERED = ["BUILT_IN_SHORTCUTS", "EXTERNAL_HOSTS", "FOCUSABLE", "LAYER_NAMES", "MAIN_ID", "NAV_LINKS", "THEMES", "THEME_KEY", "THEME_LABELS",
  "applyTheme", "commandRows", "createLayers", "effectiveTheme", "externalUrl", "keyboardHelp", "keysLabel", "localPath", "nextTheme",
  "normalizeTheme", "pageLinks", "pageUrl", "readTheme", "statusSnapshot", "trapFocus", "writeTheme"];

test("every export of chrome.js has a test in this file", () => {
  assert.deepEqual(Object.keys(chrome).sort(), [...COVERED].sort());
});

test("NAV_LINKS lists the ten pages in bar order, frozen, each a local path", () => {
  assert.deepEqual(NAV_LINKS.map(([path]) => path), ["/", "/shield", "/dispatch", "/autopilot", "/claims", "/reviews", "/find", "/play", "/counter", "/workbench"]);
  assert.equal(NAV_LINKS[0][1], "Overview");
  assert.equal(NAV_LINKS[9][1], "Workbench");
  assert.ok(Object.isFrozen(NAV_LINKS) && NAV_LINKS.every((link) => Object.isFrozen(link)));
  for (const [path] of NAV_LINKS) assert.equal(localPath(path), path);
  assert.equal(MAIN_ID, "main-content");
});

test("the theme preference reads, writes and shows only system, light or dark", () => {
  assert.equal(THEME_KEY, "jev:theme");
  assert.deepEqual(THEMES, ["system", "light", "dark"]);
  assert.deepEqual(THEME_LABELS, { system: "System", light: "Light", dark: "Dark" });
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("light"), "light");
  for (const odd of ["Dark", "", null, undefined, 3, "system", "sepia"]) assert.equal(normalizeTheme(odd), "system");

  const storage = new Storage();
  assert.equal(readTheme(storage), "system", "no key reads as system");
  assert.equal(readTheme(null), "system");
  assert.equal(writeTheme(storage, "dark"), true);
  assert.equal(storage.map.get("jev:theme"), "dark");
  assert.equal(readTheme(storage), "dark");
  assert.equal(writeTheme(storage, "system"), true);
  assert.equal(storage.map.has("jev:theme"), false, "system removes the key");
  storage.map.set("jev:theme", "<script>");
  assert.equal(readTheme(storage), "system", "a foreign value changes nothing");
  assert.throws(() => writeTheme(storage, "sepia"), /system, light or dark/);
  assert.equal(writeTheme(null, "light"), false);
  storage.blocked = true;
  assert.equal(readTheme(storage), "system");
  assert.equal(writeTheme(storage, "light"), false, "a refusing storage reports false instead of throwing");
  assert.deepEqual([...storage.map.keys()], ["jev:theme"], "nothing but the one key is ever written");
});

test("applyTheme sets or removes data-theme; effectiveTheme and nextTheme follow the preference", () => {
  const root = new Root();
  assert.equal(applyTheme(root, "light"), "light");
  assert.equal(root.attrs["data-theme"], "light");
  assert.equal(applyTheme(root, "bogus"), "system");
  assert.equal("data-theme" in root.attrs, false);
  assert.equal(applyTheme(root, "dark"), "dark");
  assert.equal(root.attrs["data-theme"], "dark");

  assert.equal(effectiveTheme("system", true), "light");
  assert.equal(effectiveTheme("system", false), "dark");
  assert.equal(effectiveTheme("dark", true), "dark");
  assert.equal(effectiveTheme("light", false), "light");
  assert.equal(nextTheme("system"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "system");
  assert.equal(nextTheme("weird"), "light", "an unknown preference counts as system");
});

test("localPath accepts this app's paths and refuses every other target", () => {
  for (const ok of ["/", "/shield", "/workbench#build", "/find?x=1"]) assert.equal(localPath(ok), ok);
  for (const bad of ["//evil.example/x", "https://evil.example/", "javascript:alert(1)", "shield", "", "/a b", "/a\\b", "/a\nb", "/\u0000", null, 7]) {
    assert.throws(() => localPath(bad), /starts with \//, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("pageLinks marks only the link of the current path, ignoring query, hash and a trailing slash", () => {
  const links = pageLinks(NAV_LINKS, "/claims/?x=1#top");
  assert.equal(links.length, 10);
  assert.deepEqual(links.filter((link) => link.current).map((link) => link.path), ["/claims"]);
  assert.deepEqual(links[4], { path: "/claims", label: "Claims", current: true });
  assert.deepEqual(pageLinks(NAV_LINKS, "/").filter((link) => link.current).map((link) => link.label), ["Overview"]);
  assert.equal(pageLinks(NAV_LINKS, "/nowhere").some((link) => link.current), false);
  assert.deepEqual(pageLinks(null, "/"), []);
});

test("externalUrl opens only official TypeSafe pages over https", () => {
  assert.deepEqual(EXTERNAL_HOSTS, ["console.typesafe.ai", "docs.typesafe.ai"]);
  assert.equal(externalUrl("https://console.typesafe.ai/settings/keys"), "https://console.typesafe.ai/settings/keys");
  assert.equal(externalUrl("https://docs.typesafe.ai/images"), "https://docs.typesafe.ai/images");
  for (const bad of ["http://docs.typesafe.ai/", "https://typesafe.ai.evil.example/", "https://user:pw@docs.typesafe.ai/", "https://docs.typesafe.ai:8443/",
    "javascript:alert(1)", "/workbench", "", null]) {
    assert.throws(() => externalUrl(bad), /official TypeSafe pages/, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("pageUrl keeps an http(s) address with its hash and drops credentials", () => {
  assert.equal(pageUrl("http://127.0.0.1:8321/workbench#build"), "http://127.0.0.1:8321/workbench#build");
  assert.equal(pageUrl("http://me:secret@localhost:8321/shield"), "http://localhost:8321/shield");
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "not a url", "", null, undefined]) assert.equal(pageUrl(bad), null);
});

const pack = (id, surface, features) => definePack({ id, surface, title: id, features });

test("commandRows lists the mounted surfaces' commands once each, in palette order", () => {
  const run = () => {};
  const lab = createLab([
    pack("page-one", "shield.inbox", [{ id: "next", kind: "command", title: "Next message", keys: "j", group: "Inbox", run }]),
    pack("chrome-one", "chrome", [{ id: "help", kind: "command", title: "Keyboard help", keys: "?", run }, { id: "top", kind: "command", title: "Top", run }]),
    pack("unmounted", "shield.other", [{ id: "x", kind: "command", title: "Never listed", run }]),
  ]);
  assert.deepEqual(commandRows(lab), []);
  lab.mount("chrome", {});
  lab.mount("shield.inbox", {});
  lab.mount("chrome", {});
  assert.deepEqual(commandRows(lab), [
    { key: "chrome-one/help", title: "Keyboard help", keys: "?", group: null, surface: "chrome" },
    { key: "chrome-one/top", title: "Top", keys: null, group: null, surface: "chrome" },
    { key: "page-one/next", title: "Next message", keys: "j", group: "Inbox", surface: "shield.inbox" },
  ]);
  assert.deepEqual(commandRows(null), []);
});

test("keyboardHelp lists built-ins, then commands with shortcuts, then palette-only commands", () => {
  assert.equal(BUILT_IN_SHORTCUTS.length, 4);
  assert.deepEqual(BUILT_IN_SHORTCUTS.map((row) => row.keys), ["Mod+K", "Escape", "Tab", "Tab"]);
  assert.ok(Object.isFrozen(BUILT_IN_SHORTCUTS) && Object.isFrozen(BUILT_IN_SHORTCUTS[0]));
  const rows = keyboardHelp([
    { key: "a/plain", title: "Plain", keys: null, group: "G" },
    { key: "a/keyed", title: "Keyed", keys: "?", group: "" },
    { key: "a/bad", title: "" },
    null,
  ]);
  assert.deepEqual(rows.slice(4), [{ keys: "?", title: "Keyed", group: null, key: "a/keyed" }, { keys: null, title: "Plain", group: "G", key: "a/plain" }]);
  assert.deepEqual(rows.slice(0, 4).map((row) => row.key), [null, null, null, null]);
  assert.equal(keyboardHelp("nope").length, 4);
});

test("keysLabel spells Mod as Cmd on a Mac and Ctrl elsewhere", () => {
  assert.equal(keysLabel("Mod+K"), "Ctrl + K");
  assert.equal(keysLabel("Mod+Shift+K", true), "Cmd + Shift + K");
  assert.equal(keysLabel("Meta+J", true), "Cmd + J");
  assert.equal(keysLabel("?"), "?");
  assert.equal(keysLabel(null), "");
});

test("statusSnapshot passes only allow-listed status fields and computes the budget left", () => {
  const raw = { version: "0.9.0", configured: true, key_source: "file", model: "jev-1.14.0", model_source: "selected", default_model: "jev-1.13.0",
    supports_box: true, backend: "typesafe-sdk", price_per_mtok_input: 0.4, api_key: "ts-live-secret", key: "ts-live-secret",
    spend: { budget_usd: 2, spent_usd: 0.5, reserved_usd: 0.25, live_calls: 9, input_tokens: 1200, rpm: 120, extra: 1 },
    env: { path: ".env", can_save: false, perms_ok: true, problems: ["/home/someone/.env is tracked by git"] } };
  const snap = statusSnapshot(raw);
  assert.deepEqual(snap, { loaded: true, configured: true, key_source: "file", model: "jev-1.14.0", model_source: "selected", default_model: "jev-1.13.0",
    supports_box: true, backend: "typesafe-sdk", version: "0.9.0", price_per_mtok_input: 0.4,
    spend: { budget_usd: 2, spent_usd: 0.5, reserved_usd: 0.25, live_calls: 9, input_tokens: 1200, rpm: 120, remaining_usd: 1.25 },
    env: { can_save: false, perms_ok: true, problem_count: 1 } });
  assert.ok(!JSON.stringify(snap).includes("secret") && !JSON.stringify(snap).includes("/home/"));

  const before = statusSnapshot({ configured: false });
  assert.equal(before.loaded, false);
  assert.equal(before.configured, false);
  assert.equal(before.model, null);
  assert.equal(before.spend, null);
  assert.equal(statusSnapshot(null).loaded, false);
  assert.equal(statusSnapshot({ model: "m", configured: "yes", key_source: "elsewhere" }).configured, false);
  assert.equal(statusSnapshot({ model: "m", key_source: "elsewhere" }).key_source, null);
  assert.equal(statusSnapshot({ model: "m", spend: { budget_usd: 0, spent_usd: 1 } }).spend.remaining_usd, null, "no budget, no remaining");
  assert.equal(statusSnapshot({ model: "m", spend: { budget_usd: 1, spent_usd: 3 } }).spend.remaining_usd, 0, "floored at zero");
  assert.equal(statusSnapshot({ model: "m", spend: { budget_usd: 1, spent_usd: "0.2" } }).spend.spent_usd, null);
});

test("createLayers closes the newest layer first and releases report whether they were still open", () => {
  assert.deepEqual(LAYER_NAMES, ["settings", "inspector", "palette", "help"]);
  const layers = createLayers();
  const closed = [];
  assert.equal(layers.top(), null);
  assert.equal(layers.closeTop(), null);
  const releaseSettings = layers.open("settings", () => closed.push("settings"));
  const releasePalette = layers.open("palette", () => { closed.push("palette"); releasePalette(); });
  assert.deepEqual(layers.names(), ["settings", "palette"]);
  assert.equal(layers.top(), "palette");
  assert.equal(layers.closeTop(), "palette");
  assert.deepEqual(closed, ["palette"]);
  assert.deepEqual(layers.names(), ["settings"]);
  assert.equal(releasePalette(), false, "a second release finds nothing");
  assert.equal(releaseSettings(), true);
  assert.deepEqual(layers.names(), []);
});

test("trapFocus wraps Tab at the edges and leaves moves inside the dialog to the browser", () => {
  const [a, b, c] = ["a", "b", "c"].map((name) => ({ name }));
  const list = [a, b, c];
  assert.equal(trapFocus(list, c), a, "Tab from the last goes to the first");
  assert.equal(trapFocus(list, a, true), c, "Shift+Tab from the first goes to the last");
  assert.equal(trapFocus(list, b), null);
  assert.equal(trapFocus(list, b, true), null);
  assert.equal(trapFocus(list, { name: "outside" }), a);
  assert.equal(trapFocus(list, { name: "outside" }, true), c);
  assert.equal(trapFocus([], a), null);
  assert.equal(trapFocus([a], a), a, "a single control keeps the focus");
  for (const part of ["a[href]", "button:not([disabled])", 'input:not([disabled]):not([type="hidden"])', "select:not([disabled])", "textarea:not([disabled])",
    "summary", '[tabindex]:not([tabindex="-1"])']) assert.ok(FOCUSABLE.includes(part), part);
});
