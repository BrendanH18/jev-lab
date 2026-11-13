// A small stand-in browser for testing the shared page chrome (static/js/common.js, static/js/lab/env.js) under Node,
// so behaviors such as focus return, Escape, the Tab wrap, live regions and the theme are checked by running the
// real code rather than by reading its source. Not a test file itself.
//
//   import { loadChrome } from "./fixtures/chrome-dom.mjs";
//   const { browser, common, env, chrome } = await loadChrome();
//
// loadChrome() installs the stand-ins as globals once per process (document, window, location, localStorage,
// navigator, fetch, setTimeout, requestAnimationFrame, Node), then imports the real modules. common.js keeps state
// across calls (the drawer, the open settings dialog), so a test closes what it opens. It supports what the chrome
// uses and little more: elements with attributes, classes, style, focus, events with capture and bubbling, and
// querySelector(All) with tag, .class, #id, [attr], [attr="value"], :not(...) and descendant selectors.

const VOID = new Set(["#text", "#html"]);

export class FakeNode {
  constructor(tag, doc = null) {
    this.tag = String(tag).toLowerCase();
    this.tagName = this.tag.toUpperCase();
    this.ownerDocument = doc;
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = [];
    this.style = {};
    this.text = "";
    this.html = null;
    this._value = "";
    this.checked = false;
  }
  get nodeType() { return this.tag === "#text" ? 3 : 1; }
  get firstChild() { return this.children[0] || null; }
  get className() { return this.attrs.class || ""; }
  set className(value) { this.attrs.class = String(value); }
  get id() { return this.attrs.id || ""; }
  set id(value) { this.attrs.id = String(value); }
  get content() { return this.attrs.content; }
  get disabled() { return "disabled" in this.attrs; }
  set disabled(value) { if (value) this.attrs.disabled = ""; else delete this.attrs.disabled; }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  get classList() {
    const node = this;
    const names = () => node.className.split(/\s+/).filter(Boolean);
    const write = (list) => { node.className = list.join(" "); };
    return {
      contains: (name) => names().includes(name),
      add: (...more) => write([...new Set([...names(), ...more])]),
      remove: (...less) => write(names().filter((name) => !less.includes(name))),
      toggle(name, force) {
        const on = force === undefined ? !names().includes(name) : !!force;
        if (on) this.add(name); else this.remove(name);
        return on;
      },
    };
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  hasAttribute(name) { return name in this.attrs; }
  removeAttribute(name) { delete this.attrs[name]; }
  adopt(node) {
    const child = node instanceof FakeNode ? node : Object.assign(new FakeNode("#text", this.ownerDocument), { text: String(node) });
    child.remove();
    child.parentNode = this;
    return child;
  }
  append(...nodes) { for (const node of nodes) this.children.push(this.adopt(node)); }
  prepend(...nodes) { this.children.unshift(...nodes.map((node) => this.adopt(node))); }
  after(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const adopted = nodes.map((node) => parent.adopt(node));
    parent.children.splice(parent.children.indexOf(this) + 1, 0, ...adopted);
  }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const adopted = nodes.map((node) => parent.adopt(node));
    parent.children.splice(parent.children.indexOf(this), 1, ...adopted);
    this.parentNode = null;
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
  get isConnected() {
    let at = this;
    while (at.parentNode) at = at.parentNode;
    return at.tag === "#document";
  }
  get textContent() { return VOID.has(this.tag) ? (this.tag === "#text" ? this.text : "") : this.children.map((child) => child.textContent).join(""); }
  set textContent(text) { this.replaceChildren(String(text)); }
  set innerHTML(html) {
    this.replaceChildren();
    const node = new FakeNode("#html", this.ownerDocument);
    node.html = String(html);
    this.append(node);
  }
  get innerHTML() { return this.children.map((child) => child.html ?? child.textContent).join(""); }
  addEventListener(type, handler, options) {
    const capture = options === true || options?.capture === true;
    this.listeners.push({ type, handler, capture });
  }
  removeEventListener(type, handler, options) {
    const capture = options === true || options?.capture === true;
    this.listeners = this.listeners.filter((entry) => !(entry.type === type && entry.handler === handler && entry.capture === capture));
  }
  dispatchEvent(event) { return dispatch(this, event); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { return dispatch(this, makeEvent("click")); }
  scrollIntoView() { this.scrolled = (this.scrolled || 0) + 1; }
  querySelectorAll(selector) { return descendants(this).filter((node) => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches(selector) { return matches(this, selector); }
}

const descendants = (node) => node.children.flatMap((child) => (VOID.has(child.tag) ? [] : [child, ...descendants(child)]));

// ---------- selectors ----------

function compoundMatches(node, compound) {
  if (VOID.has(node.tag) || node.tag === "#document") return false;
  const head = compound.match(/^([a-z][a-z0-9-]*|\*)?/i)[0];
  if (head && head !== "*" && node.tag !== head.toLowerCase()) return false;
  const rest = compound.slice(head.length);
  const parts = [...rest.matchAll(/\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:not\(([^)]*)\)/g)];
  if (parts.map((part) => part[0]).join("") !== rest) throw new Error(`chrome-dom: unsupported selector ${compound}`);
  return parts.every(([, cls, id, attr, value, not]) => {
    if (cls) return node.classList.contains(cls);
    if (id) return node.id === id;
    if (attr) return attr in node.attrs && (value === undefined || node.attrs[attr] === value);
    return !compoundMatches(node, not);
  });
}

function matches(node, selector) {
  return String(selector).split(",").some((one) => {
    const chain = one.trim().split(/\s+/);
    if (!compoundMatches(node, chain[chain.length - 1])) return false;
    let at = node.parentNode;
    for (let index = chain.length - 2; index >= 0; index--) {
      while (at && !compoundMatches(at, chain[index])) at = at.parentNode;
      if (!at) return false;
      at = at.parentNode;
    }
    return true;
  });
}

// ---------- events ----------

export function makeEvent(type, fields = {}) {
  const event = { type, bubbles: true, defaultPrevented: false, stopped: false, isComposing: false, ...fields };
  event.preventDefault = () => { event.defaultPrevented = true; };
  event.stopPropagation = () => { event.stopped = true; };
  event.stopImmediatePropagation = () => { event.stopped = true; };
  return event;
}

function dispatch(target, event) {
  // A real Event (CustomEvent from common.js) has a read-only target: carry its fields over to a plain one.
  if (typeof Event === "function" && event instanceof Event) event = makeEvent(event.type, { detail: event.detail, key: event.key });
  if (event.target === undefined || event.target === null) event.target = target;
  const path = [];
  for (let at = target; at; at = at.parentNode) path.unshift(at);
  const run = (node, capture) => {
    for (const entry of [...node.listeners]) {
      if (entry.type !== event.type || (capture !== null && entry.capture !== capture)) continue;
      event.currentTarget = node;
      entry.handler.call(node, event);
    }
  };
  for (const node of path.slice(0, -1)) { run(node, true); if (event.stopped) return !event.defaultPrevented; }
  run(target, null);
  if (event.stopped) return !event.defaultPrevented;
  for (const node of path.slice(0, -1).reverse()) { run(node, false); if (event.stopped) break; }
  return !event.defaultPrevented;
}

// ---------- the browser ----------

export class FakeStorage {
  constructor() { this.map = new Map(); this.blocked = false; }
  getItem(key) { if (this.blocked) throw new Error("SecurityError"); return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { if (this.blocked) throw new Error("QuotaExceededError"); this.map.set(key, String(value)); }
  removeItem(key) { if (this.blocked) throw new Error("SecurityError"); this.map.delete(key); }
  get length() { return this.map.size; }
}

export const SAMPLE_STATUS = Object.freeze({
  version: "0.9.0", configured: true, key_source: "file", model: "jev-1.14.0", model_source: "default", default_model: "jev-1.14.0",
  supports_box: true, backend: "typesafe-sdk", price_per_mtok_input: 0.4,
  spend: { budget_usd: 2, spent_usd: 0.0123, reserved_usd: 0, live_calls: 7, input_tokens: 30750, rpm: 120 },
  env: { path: ".env", exists: true, perms_ok: true, git_repo: true, problems: [], can_save: true },
});

let browser = null;

function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// Installs the stand-ins once per process and returns them. options: { path, theme, systemLight, status }.
export function installBrowser(options = {}) {
  if (browser) return browser;
  const doc = new FakeNode("#document");
  doc.ownerDocument = doc;
  const html = new FakeNode("html", doc);
  const head = new FakeNode("head", doc);
  const body = new FakeNode("body", doc);
  doc.append(html);
  html.append(head, body);
  doc.documentElement = html;
  doc.head = head;
  doc.body = body;
  doc.activeElement = body;
  doc.createElement = (tag) => new FakeNode(tag, doc);
  doc.createTextNode = (text) => Object.assign(new FakeNode("#text", doc), { text: String(text) });
  const meta = doc.createElement("meta");
  meta.setAttribute("name", "jev-csrf");
  meta.setAttribute("content", "test-session-token");
  head.append(meta);

  const storage = new FakeStorage();
  if (options.theme) storage.setItem("jev:theme", options.theme);
  const win = new FakeNode("#window", doc);
  const state = {
    document: doc, window: win, storage, html, body, head,
    systemLight: options.systemLight === true,
    status: { ...(options.status || SAMPLE_STATUS) },
    fetches: [], navigations: [], opened: [], copied: [], timers: [], frames: [],
  };
  win.matchMedia = (query) => ({ matches: /light/.test(query) ? state.systemLight : !state.systemLight, media: query });
  win.open = (url, target, features) => { state.opened.push({ url, target, features }); return {}; };
  const loc = { pathname: options.path || "/shield", hash: "", host: "127.0.0.1:8321" };
  Object.defineProperty(loc, "href", {
    get: () => `http://127.0.0.1:8321${loc.pathname}${loc.hash}`,
    set: (value) => { state.navigations.push(String(value)); },
  });
  state.location = loc;

  define("Node", FakeNode);
  define("document", doc);
  define("window", win);
  define("location", loc);
  define("localStorage", storage);
  define("navigator", { platform: options.platform || "Linux x86_64", userAgent: "chrome-dom",
    clipboard: { writeText: async (text) => { state.copied.push(text); } } });
  define("requestAnimationFrame", (fn) => { state.frames.push(fn); return state.frames.length; });
  // Timers are recorded, never run by themselves, so a toast's 7-second removal does not keep the test process alive.
  define("setTimeout", (fn, ms) => { state.timers.push({ fn, ms }); return state.timers.length; });
  define("clearTimeout", () => {});
  define("fetch", async (path, opts = {}) => {
    state.fetches.push({ path, opts });
    const reply = path === "/api/status" ? state.status : path === "/api/models" ? { models: [{ name: "jev-1.14.0", release_date: "2026-05-01" }] } : {};
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(reply)) };
  });

  // Helpers for tests.
  state.key = (key, fields = {}, target = doc.activeElement || body) => {
    const event = makeEvent("keydown", { key, ...fields });
    target.dispatchEvent(event);
    return event;
  };
  state.find = (selector) => doc.querySelector(selector);
  state.findAll = (selector) => doc.querySelectorAll(selector);
  state.byText = (tag, text) => doc.querySelectorAll(tag).find((node) => node.textContent.includes(text)) || null;
  state.runTimers = () => { const due = state.timers.splice(0); for (const timer of due) timer.fn(); };
  state.button = (label) => doc.querySelectorAll("button").find((node) => node.textContent.trim() === label) || null;
  browser = state;
  return state;
}

// Installs the stand-ins and imports the real chrome modules (once per process).
export async function loadChrome(options = {}) {
  const state = installBrowser(options);
  const common = await import("../../../../static/js/common.js");
  const env = await import("../../../../static/js/lab/env.js");
  const chrome = await import("../../../../static/js/chrome.js");
  return { browser: state, common, env, chrome };
}

// Runs initChrome once per process (it adds the skip link and the top bar) and returns what loadChrome returns.
let started = null;
export async function startChrome(options = {}) {
  const loaded = await loadChrome(options);
  if (!started) {
    const main = loaded.browser.document.createElement("main");
    main.className = "page";
    main.append(loaded.browser.document.createElement("h1"));
    loaded.browser.body.append(main);
    started = loaded.common.initChrome(loaded.browser.location.pathname);
  }
  await started;
  return loaded;
}
