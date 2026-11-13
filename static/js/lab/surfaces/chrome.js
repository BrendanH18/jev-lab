// Lab surface of the shared page chrome: the top bar, the key and safety settings, the request inspector, toasts and
// the command palette that every page gets from static/js/common.js and static/js/lab/env.js. Pure code: it imports
// only the kit and static/js/chrome.js (itself pure), touches no DOM, storage or network, and is tested in Node
// (tests/js/lab/surface-chrome.test.mjs). Fixture for pack tests: tests/js/lab/fixtures/chrome.mjs (sampleChromeCtx).
// This header is the CONTRACT for packs on this surface.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "chrome"  —  builder chromeCtx(source)  —  "Every page"
// ---------------------------------------------------------------------------------------------------------------
// Page-wide, not a page: every page loads the packs under static/js/lab/packs/chrome/ next to its own, and
// installLab() (static/js/lab/env.js) mounts ONE ctx with the id "chrome" right after initChrome() has drawn the top
// bar. Nothing renders a Lab tools section for it, so a chrome pack holds ONLY `command` and `behavior` features
// (tests/js/lab/registry.test.mjs enforces this). Its commands appear in the command palette (Ctrl/Cmd + K) of every
// page, with their shortcuts, and in the keyboard help.
//
// There is no list: items() and shown() always return [] (the same frozen array), itemName(item, index) returns the
// 1-based position, and refresh() does nothing. ctx.env is { h, mount, toast, copy, download } (labEnv); packs use
// only ctx.env.toast(message, kind), ctx.env.copy(text) and ctx.env.download(filename, text, mime).
//
// data (all live getters, evaluated when read; values are frozen copies, never the page's own objects):
//   path            string   the current page's path, for example "/shield" (query and hash left out). "/" when the
//                            page gives none.
//   url             string | null   the full address of the current page (http or https, hash kept, user name and
//                            password removed); null when it is not an http(s) address. Local: 127.0.0.1/localhost.
//   links           [{ path, label, current }]   the ten top-bar links in bar order: "/" Overview, "/shield",
//                            "/dispatch", "/autopilot", "/claims", "/reviews", "/find", "/play", "/counter",
//                            "/workbench". current is true for the link of `path` (at most one).
//   page            { path, label } | null   the link marked current; null on a path that is not in the bar.
//   status          object   statusSnapshot(currentStatus()) from static/js/chrome.js, an ALLOW-LIST of GET
//                            /api/status: { loaded, configured, key_source ("env" | "file" | "memory" | null), model,
//                            model_source, default_model, supports_box, backend, version, price_per_mtok_input,
//                            spend: { budget_usd, spent_usd, reserved_usd, live_calls, input_tokens, rpm,
//                            remaining_usd } | null, env: { can_save, perms_ok, problem_count } | null }. loaded is
//                            false until the first status answer of this page load, and every other field is then
//                            null or false. Any field may be null. remaining_usd is budget - spent - reserved floored
//                            at 0, or null when no budget is set (0 or less). Never holds the key (the server never
//                            sends it), the .env path or the problem texts.
//   theme           "system" | "light" | "dark"   the stored preference ("system" follows the device)
//   effectiveTheme  "light" | "dark"   the scheme the page shows now
//   themes          ["system", "light", "dark"]   the order Cycle uses
//   layers          string[]   open overlays, oldest first: "settings", "inspector", "palette", "help". [] with none
//                            open. Escape closes the last one.
//   commands        [{ key, title, keys, group, surface }]   every command of every mounted surface (this one
//                            included), in palette order; keys and group are null when the command has none.
//   shortcuts       [{ keys, title, group, key }]   exactly what the keyboard help lists: the built-in shortcuts
//                            (Mod+K, Escape, Tab, Skip to content; key null), then commands with a shortcut, then
//                            commands reachable only from the palette (keys null).
//   mac             boolean  whether Mod reads as Cmd (a Mac) rather than Ctrl, for labels only
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them from a
// command's run(), one call per press, never from when()):
//   go(path)           opens a page of this app in this tab. Guard: localPath() — one leading "/", no scheme, host,
//                      backslash, whitespace or control character ("/workbench#build" is fine). It is an ordinary
//                      navigation, so a page's own "leave with unsaved edits?" warning (beforeunload) still asks.
//   openSettings()     opens the API key & safety dialog, exactly what the key pill does. No guard. Never fills in,
//                      submits, forgets or reads a key.
//   openPalette()      opens the command palette. No guard (a second call while it is open does nothing).
//   setTheme(pref)     "system" | "light" | "dark". Guard: anything else throws. Returns whether this browser will
//                      remember it (it applies to this page either way).
//   cycleTheme()       moves to the next of data.themes and returns the new preference. No guard.
//   copyLink()         copies data.url (the page's own toast says "Copied"). Guard: data.url must not be null.
//   openHelp()         opens the keyboard help dialog listing data.shortcuts. No guard.
//   focusMain()        moves keyboard focus to the page's <main>, past the top bar. Guard: throws on a page without one.
//   openOfficial(url)  opens an official TypeSafe page in a new tab. Guard: externalUrl() — https only, host
//                      console.typesafe.ai or docs.typesafe.ai, no user name, password or port.
// No action spends budget, calls the model, changes a key, the model, a dataset or a saved test, or skips a guard.
//
// Content boundaries for chrome: a command may show (toast), copy or download only what data holds: page paths and
// labels, the allow-listed status (model names, backend, spend counts and dollars as the server measured them for
// this server run), the theme and the shortcut list. Spend is measured spend, never an estimate presented as spend.
// Nothing here may hold or ask for the API key, read storage, call the server, or show an answer.
import { NAV_LINKS, THEMES, effectiveTheme, externalUrl, keyboardHelp, localPath, nextTheme, normalizeTheme, pageLinks, pageUrl,
  statusSnapshot } from "../../chrome.js";

const EMPTY = Object.freeze([]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A source field: a value, or a function that returns the value now.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("This page cannot do that here.");
  return source[name](...args);
}

const pathOf = (value) => {
  const text = typeof value === "string" ? value.split(/[?#]/)[0] : "";
  return text.startsWith("/") ? text : "/";
};

function commandList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && typeof row === "object" && typeof row.title === "string" && row.title).map((row) => ({
    key: typeof row.key === "string" ? row.key : null, title: row.title,
    keys: typeof row.keys === "string" && row.keys ? row.keys : null, group: typeof row.group === "string" && row.group ? row.group : null,
    surface: typeof row.surface === "string" && row.surface ? row.surface : null }));
}

// source: {
//   path: () => location.pathname,   url: () => location.href,   status: () => currentStatus(),
//   theme: () => themePreference(),   systemLight: () => systemPrefersLight(),   layers: () => openLayers(),
//   commands: () => commandRows(LAB),   mac: () => boolean,   links: NAV_LINKS (optional; the bar's links by default),
//   go(path), openSettings(), openPalette(), setTheme(pref), copy(text), openHelp(), focusMain() -> boolean,
//   openOfficial(url)   the page's own operations
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function chromeCtx(source = {}) {
  const path = () => pathOf(read(source, "path", "/"));
  const links = () => pageLinks(read(source, "links", NAV_LINKS), path());
  const theme = () => normalizeTheme(read(source, "theme", "system"));
  const url = () => pageUrl(read(source, "url", null));
  const commands = () => commandList(read(source, "commands", EMPTY));
  const setTheme = (preference) => {
    if (!THEMES.includes(preference)) throw new Error("Choose system, light or dark.");
    return call(source, "setTheme", preference);
  };
  const ctx = {
    items: () => EMPTY,
    shown: () => EMPTY,
    data: {
      get path() { return path(); },
      get url() { return url(); },
      get links() { return deepFreeze(links()); },
      get page() {
        const link = links().find((entry) => entry.current);
        return link ? Object.freeze({ path: link.path, label: link.label }) : null;
      },
      get status() { return deepFreeze(statusSnapshot(read(source, "status", null))); },
      get theme() { return theme(); },
      get effectiveTheme() { return effectiveTheme(theme(), read(source, "systemLight", false) === true); },
      get themes() { return THEMES; },
      get layers() {
        const list = read(source, "layers", EMPTY);
        return Object.freeze(Array.isArray(list) ? list.filter((name) => typeof name === "string") : []);
      },
      get commands() { return deepFreeze(commands()); },
      get shortcuts() { return deepFreeze(keyboardHelp(commands())); },
      get mac() { return read(source, "mac", false) === true; },
    },
    actions: {
      go: (target) => call(source, "go", localPath(target)),
      openSettings: () => call(source, "openSettings"),
      openPalette: () => call(source, "openPalette"),
      setTheme,
      cycleTheme() {
        const next = nextTheme(theme());
        setTheme(next);
        return next;
      },
      copyLink() {
        const link = url();
        if (!link) throw new Error("This page has no link to copy.");
        return call(source, "copy", link);
      },
      openHelp: () => call(source, "openHelp"),
      focusMain() {
        if (call(source, "focusMain") === false) throw new Error("This page has no main content to move to.");
        return true;
      },
      openOfficial: (target) => call(source, "openOfficial", externalUrl(target)),
    },
    refresh: () => {},
    itemName: (item, index) => String(index + 1),
  };
  return ctx;
}
