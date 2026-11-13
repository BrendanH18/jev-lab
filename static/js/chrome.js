// The pure core of the shared page chrome (static/js/common.js): the nav links, the theme preference, the status
// snapshot Lab packs may read, local-path and official-link checks, the stack of open layers that Escape closes one
// at a time, and the Tab wrap for dialogs. No DOM, no network and no storage of its own: storage, the <html>
// element and the focusable elements are passed in, so tests/js/chrome.test.mjs runs all of it under Node.

export const NAV_LINKS = Object.freeze([["/", "Overview"], ["/shield", "Shield"], ["/dispatch", "Dispatch"], ["/autopilot", "Autopilot"],
  ["/claims", "Claims"], ["/reviews", "Reviews"], ["/find", "Find"], ["/play", "Play"], ["/counter", "Counter"], ["/workbench", "Workbench"]]
  .map((link) => Object.freeze(link)));

// The id the skip link targets when the page's <main> has none of its own.
export const MAIN_ID = "main-content";

// ---------- theme preference ----------
// The one localStorage key the chrome owns. It holds "light" or "dark" and nothing else; "system" is the absence
// of the key. Never store keys, inputs or answers here or under any other key.
export const THEME_KEY = "jev:theme";
export const THEMES = Object.freeze(["system", "light", "dark"]);
export const THEME_LABELS = Object.freeze({ system: "System", light: "Light", dark: "Dark" });

// Anything that is not exactly "light" or "dark" reads as "system", so a damaged or foreign value changes nothing.
export const normalizeTheme = (value) => (value === "light" || value === "dark" ? value : "system");

// The stored preference. A missing key, a blocked storage and an unknown value all read as "system".
export function readTheme(storage) {
  try { return normalizeTheme(storage?.getItem(THEME_KEY)); } catch { return "system"; }
}

// Remember a preference: "light" or "dark" is stored, "system" removes the key. Returns whether the browser kept
// it (false when storage is missing or refuses). Throws on anything that is not one of THEMES.
export function writeTheme(storage, preference) {
  if (!THEMES.includes(preference)) throw new Error("Choose system, light or dark.");
  if (!storage) return false;
  try {
    if (preference === "system") storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, preference);
    return true;
  } catch { return false; }
}

// Show a preference on the <html> element. app.css reads data-theme: "light" and "dark" force a scheme, and no
// attribute follows the device (prefers-color-scheme).
export function applyTheme(root, preference) {
  const theme = normalizeTheme(preference);
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  return theme;
}

// The scheme a preference shows: its own, or the device's when it is "system".
export const effectiveTheme = (preference, systemLight) => {
  const theme = normalizeTheme(preference);
  return theme === "system" ? (systemLight ? "light" : "dark") : theme;
};

export const nextTheme = (preference) => THEMES[(THEMES.indexOf(normalizeTheme(preference)) + 1) % THEMES.length];

// ---------- navigation ----------

// A path on this server, as given: it starts with one "/" and holds no scheme, host, backslash, whitespace or
// control character. Throws otherwise, so a command can never send the browser to another origin.
export function localPath(path) {
  const text = typeof path === "string" ? path : "";
  if (!/^\/(?!\/)/.test(text) || /[\\\s\u0000-\u001f\u007f]/.test(text)) throw new Error("Lab can only open a page of this app (a path that starts with /).");
  return text;
}

// The nav links as [{ path, label, current }], `current` marking the link for `path` (query and hash ignored).
export function pageLinks(links, path) {
  const here = String(path ?? "").split(/[?#]/)[0].replace(/(.)\/+$/, "$1");
  return (links || []).map(([href, label]) => ({ path: href, label, current: href === here }));
}

// Official pages the chrome may open in a new tab. Anything else is refused.
export const EXTERNAL_HOSTS = Object.freeze(["console.typesafe.ai", "docs.typesafe.ai"]);
export function externalUrl(url) {
  let parsed = null;
  try { parsed = new URL(String(url)); } catch { /* refused below */ }
  if (!parsed || parsed.protocol !== "https:" || !EXTERNAL_HOSTS.includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) {
    throw new Error("Lab only opens official TypeSafe pages in a new tab.");
  }
  return parsed.href;
}

// ---------- status snapshot ----------

const text = (value) => (typeof value === "string" && value !== "" ? value : null);
const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const flag = (value) => (typeof value === "boolean" ? value : null);

// What Lab packs may read of GET /api/status, by allow-list: a field this function does not name never reaches a
// pack, so nothing key-shaped can leak through it (the server never sends the key to the browser in the first
// place). `loaded` is false until the first status answer of this page load; every other field is then null.
// `spend.remaining_usd` is budget - spent - reserved, floored at 0, or null when no budget is set (0 or less).
export function statusSnapshot(status) {
  const raw = status && typeof status === "object" ? status : {};
  const loaded = typeof raw.model === "string" && raw.model !== "";
  const spend = raw.spend && typeof raw.spend === "object" ? raw.spend : null;
  const env = raw.env && typeof raw.env === "object" ? raw.env : null;
  const budget = spend ? number(spend.budget_usd) : null;
  const spent = spend ? number(spend.spent_usd) : null;
  const reserved = spend ? number(spend.reserved_usd) : null;
  return {
    loaded,
    configured: loaded ? raw.configured === true : false,
    key_source: ["env", "file", "memory"].includes(raw.key_source) ? raw.key_source : null,
    model: text(raw.model),
    model_source: text(raw.model_source),
    default_model: text(raw.default_model),
    supports_box: flag(raw.supports_box),
    backend: text(raw.backend),
    version: text(raw.version),
    price_per_mtok_input: number(raw.price_per_mtok_input),
    spend: spend ? { budget_usd: budget, spent_usd: spent, reserved_usd: reserved, live_calls: number(spend.live_calls),
      input_tokens: number(spend.input_tokens), rpm: number(spend.rpm),
      remaining_usd: budget !== null && budget > 0 && spent !== null ? Math.max(0, budget - spent - (reserved || 0)) : null } : null,
    env: env ? { can_save: flag(env.can_save), perms_ok: flag(env.perms_ok), problem_count: Array.isArray(env.problems) ? env.problems.length : 0 } : null,
  };
}

// ---------- layers: what Escape closes ----------

// The open overlays (command palette, key and safety settings, request inspector, keyboard help), newest last.
// open(name, close) returns a release function that reports whether the layer was still open. closeTop() calls the
// newest layer's close and returns its name, or null with nothing open: Escape closes one layer at a time.
export function createLayers() {
  const stack = [];
  return {
    open(name, close) {
      const entry = { name, close };
      stack.push(entry);
      return () => {
        const index = stack.indexOf(entry);
        if (index < 0) return false;
        stack.splice(index, 1);
        return true;
      };
    },
    top: () => (stack.length ? stack[stack.length - 1].name : null),
    names: () => stack.map((entry) => entry.name),
    closeTop() {
      const entry = stack[stack.length - 1];
      if (!entry) return null;
      entry.close();
      return entry.name;
    },
  };
}

// ---------- Tab wrap for dialogs ----------

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), '
  + 'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// Where Tab (or Shift+Tab when `backward`) should go so focus stays inside a dialog: the first element after the
// last, the last before the first, an edge when focus is outside the list, and null when the browser's own move
// already stays inside (or nothing can take focus).
export function trapFocus(list, active, backward = false) {
  if (!list.length) return null;
  const index = list.indexOf(active);
  if (index < 0) return backward ? list[list.length - 1] : list[0];
  if (backward) return index === 0 ? list[list.length - 1] : null;
  return index === list.length - 1 ? list[0] : null;
}
