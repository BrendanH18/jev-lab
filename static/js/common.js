// Shared helpers for the Jev Lab pages: API calls (with the session token), formatting, DOM
// building, probability bars, the request inspector, the key/settings modal, and the top bar.

const TOKEN = document.querySelector('meta[name="jev-csrf"]')?.content || "";
let status = { configured: false };

export async function api(path, body) {
  const opts = body === undefined
    ? { headers: { "X-Jev-Token": TOKEN } }
    : { method: "POST", headers: { "Content-Type": "application/json", "X-Jev-Token": TOKEN }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: "Invalid response from server" }));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.reason = data.reason;
    if (res.status === 401 && data.jev_status === 401 && !status.configured) openSettings("Connect a key to make live calls.");
    else if (res.status === 403 && data.reason === "token") toast("Session changed. Reload the page.", "error");
    throw err;
  }
  if (body !== undefined && !path.startsWith("/api/status")) refreshStatusSoon();
  return data;
}

// ---------- formatting ----------
export const pct = (p, digits = 0) => `${(p * 100).toFixed(digits)}%`;
export const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
export const money = (v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function usd(v) {
  if (!v) return "$0";
  if (v < 0.0001) return `$${v.toFixed(7)}`;
  if (v < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(4)}`;
}
export const num = (v) => Number(v || 0).toLocaleString("en-US");

// ---------- DOM ----------
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "value" && ("value" in node)) node.value = v;
    else if (k === "checked") node.checked = !!v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function mount(target, ...nodes) {
  const el = typeof target === "string" ? $(target) : target;
  el.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  return el;
}
export function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { toast("Copy failed. Select the text and copy it manually.", "error"); }
}

// ---------- icons (inline SVG, stroke = currentColor) ----------
const ICONS = {
  check: '<path d="M4 10.5l3.5 3.5L16 5.5"/>',
  shield: '<path d="M10 2.5l6 2.2v4.6c0 3.9-2.6 6.9-6 8.2-3.4-1.3-6-4.3-6-8.2V4.7z"/>',
  alert: '<path d="M10 3l7.5 13h-15z"/><path d="M10 8v3.5M10 14h.01"/>',
  stop: '<path d="M7 2.5h6L17.5 7v6L13 17.5H7L2.5 13V7z"/><path d="M7 7l6 6M13 7l-6 6"/>',
  hand: '<path d="M10 17.5a6 6 0 01-6-6V8.5a1.2 1.2 0 012.4 0V10M6.4 9V4.5a1.2 1.2 0 012.4 0V9M8.8 8.5V3.5a1.2 1.2 0 012.4 0v5M11.2 8.5V5a1.2 1.2 0 012.4 0v6.5a6 6 0 01-3.6 6"/>',
  minus: '<path d="M5 10h10"/>',
  bolt: '<path d="M11 2.5L4.5 11H10l-1 6.5L15.5 9H10z"/>',
  question: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 114 1.6c-.9.6-1.8 1-1.8 2.1M10 14h.01"/>',
  eye: '<path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.5"/>',
  x: '<path d="M5 5l10 10M15 5L5 15"/>',
  play: '<path d="M6 4l10 6-10 6z"/>',
  reset: '<path d="M3.5 10a6.5 6.5 0 106.5-6.5c-2 0-3.8.9-5 2.4"/><path d="M4.5 2.5v3.9h3.9"/>',
  mail: '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M3 5.5l7 5.5 7-5.5"/>',
  money: '<rect x="2.5" y="5" width="15" height="10" rx="2"/><circle cx="10" cy="10" r="2.2"/>',
  calendar: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2.5v3M13 2.5v3"/>',
  list: '<path d="M7 5.5h10M7 10h10M7 14.5h10M3 5.5h.01M3 10h.01M3 14.5h.01"/>',
  box: '<path d="M10 2.5l7 3.5v8L10 17.5 3 14V6z"/><path d="M3 6l7 3.5L17 6M10 9.5v8"/>',
  send: '<path d="M17.5 2.5L9 11M17.5 2.5l-5 15-3.5-6.5L2.5 7.5z"/>',
  code: '<path d="M7 5l-4.5 5L7 15M13 5l4.5 5L13 15"/>',
  key: '<circle cx="6.5" cy="13.5" r="3.5"/><path d="M9 11l8-8M14 6l2.5 2.5M12 8l1.5 1.5"/>',
  arrow: '<path d="M4 10h12M11 5l5 5-5 5"/>',
  layers: '<path d="M10 2.5l7.5 4-7.5 4-7.5-4z"/><path d="M2.5 10l7.5 4 7.5-4M2.5 13.5l7.5 4 7.5-4"/>',
  search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/>',
  save: '<path d="M4 3h9l3 3v11H4z"/><path d="M7 3v4h5V3M7 17v-5h6v5"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M6 6l.8 11h6.4L14 6"/>',
  copy: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  replay: '<path d="M4 10a6 6 0 1 1 2 4.5"/><path d="M4 15v-4h4"/>',
  sparkle: '<path d="M10 2.5l1.8 5.2 5.2 1.8-5.2 1.8L10 16.5l-1.8-5.2L3 9.5l5.2-1.8z"/>',
};
export function icon(name, cls = "icon") {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return span.firstChild;
}

// Status always ships with an icon + label, never color alone.
const STATUS = {
  safe: ["good", "check", "Safe"],
  review: ["warning", "eye", "Review"],
  quarantine: ["critical", "stop", "Quarantine"],
  execute: ["good", "bolt", "Auto-run"],
  confirm: ["warning", "hand", "Needs confirmation"],
  clarify: ["info", "question", "Needs clarification"],
  reject: ["critical", "stop", "Blocked by policy"],
  none: ["", "minus", "No action"],
  handled: ["good", "check", "Handled"],
  needs_you: ["warning", "hand", "Needs you"],
  ignored: ["", "minus", "Ignored"],
  answered: ["good", "check", "Answered here"],
  partial: ["warning", "eye", "Partly addressed"],
  absent: ["critical", "minus", "Not in document"],
  pass: ["good", "check", "Pass"],
  fail: ["critical", "x", "Fail"],
  unchecked: ["", "minus", "No expectation"],
};
export function statusBadge(kind, label, extra = "") {
  const [tone, ic, text] = STATUS[kind] || ["", "minus", kind];
  return h("span", { class: `badge ${tone} ${extra}` }, icon(ic), label || text);
}

// ---------- probability visuals ----------
export function barRow(label, p, { top = false, title = null, valueText = null } = {}) {
  const fill = h("i");
  const row = h("div", { class: `bar-row${top ? " top" : ""}`, title: title || `${label}: ${pct(p, 1)}` },
    h("span", { class: "lbl" }, label),
    h("div", { class: "bar" }, fill),
    h("span", { class: "val" }, valueText ?? pct(p)));
  requestAnimationFrame(() => { fill.style.width = `${Math.max(0, Math.min(1, p)) * 100}%`; });
  return row;
}

export function choiceBars(answer, labels = {}, limit = 6) {
  const entries = Object.entries(answer.probabilities || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return h("div", { class: "bars" }, entries.map(([k, p], i) => barRow(labels[k] || k, p, { top: i === 0 })));
}

// One answer of any type, rendered as a card. Used by the playground, Workbench, and tests.
export function answerCard(qid, answer, question = null) {
  const type = answer.type;
  let big, body, title = "";
  if (question) title = typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions);
  if (type === "choice") {
    big = String(answer.choice).replace(/_/g, " ");
    body = choiceBars(answer, {}, 4);
  } else if (type === "score") {
    const levels = Object.keys(answer.legend || {}).length - 1;
    big = `${answer.score.toFixed(2)} / ${levels}`;
    body = h("div", { class: "bars" }, Object.entries(answer.legend || {}).map(([lvl, text]) => {
      const label = typeof text === "string" ? text.split(":")[0] : JSON.stringify(text);
      return barRow(label, answer.probabilities?.[lvl] ?? 0, { top: Math.round(answer.score) === Number(lvl), title: typeof text === "string" ? text : label });
    }));
  } else {
    big = pct(answer.noul, 1);
    body = h("div", { class: "bars" }, barRow("P(yes)", answer.noul, { top: true }));
  }
  return h("div", { class: "ans pop" },
    h("div", { class: "t" }, h("span", { class: "typ" }, type), h("code", {}, qid)),
    title ? h("div", { class: "muted", style: { fontSize: "12px" }, title }, title.length > 110 ? title.slice(0, 109) + "…" : title) : null,
    h("div", { class: "big" }, big),
    body,
    type !== "noul" ? h("div", { class: "faint", style: { fontSize: "11.5px" } }, `confidence ${pct(answer.confidence)}`) : null);
}

// ---------- JSON inspector ----------
function highlight(json) {
  const esc = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (m) => {
    let cls = "j-num";
    if (/^"/.test(m)) cls = /:$/.test(m) ? "j-key" : "j-str";
    else if (/true|false|null/.test(m)) cls = "j-lit";
    return `<span class="${cls}">${m}</span>`;
  });
}

let drawer;
export function inspect(trace, title = "Jev request") {
  if (!drawer) {
    const pre = h("pre");
    const tabs = ["request", "response"].map((t) => h("button", { class: "tab", "data-tab": t }, t === "request" ? "Request" : "Response"));
    const meta = h("div", { class: "stat-row" });
    const heading = h("h3");
    const backdrop = h("div", { class: "drawer-backdrop", onclick: () => close() });
    const copyBtn = h("button", { class: "btn ghost sm", title: "Copy JSON", onclick: () => copyText(JSON.stringify(drawer.current[drawer.which], null, 2)) }, icon("copy"));
    const panel = h("aside", { class: "drawer", role: "dialog", "aria-label": "Request inspector" },
      h("div", { class: "panel-head" }, icon("code"), heading, h("div", { class: "spacer" }), h("div", { class: "tabs" }, tabs), copyBtn,
        h("button", { class: "btn ghost sm", onclick: () => close(), "aria-label": "Close" }, icon("x"))),
      h("div", { style: { padding: "12px 18px", borderBottom: "1px solid var(--line)" } }, meta),
      pre);
    document.body.append(backdrop, panel);
    const close = () => { panel.classList.remove("open"); backdrop.classList.remove("open"); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    drawer = { pre, tabs, meta, heading, panel, backdrop, current: null, which: "request" };
    tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));
    function show(which) {
      drawer.which = which;
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === which));
      pre.innerHTML = highlight(JSON.stringify(drawer.current[which], null, 2));
      pre.scrollTop = 0;
    }
    drawer.show = show;
  }
  drawer.current = trace;
  drawer.heading.textContent = title;
  const m = trace.meta || {};
  mount(drawer.meta,
    stat("model", m.model), stat("questions", m.question_count),
    stat(m.replayed ? "recorded latency" : "latency", ms(m.latency_ms)),
    stat("input tokens", num(m.input_tokens)), stat("cost", usd(m.cost_usd), true),
    m.replayed ? h("span", { class: "badge accent" }, icon("replay"), "replayed") : null);
  drawer.show("request");
  drawer.panel.classList.add("open");
  drawer.backdrop.classList.add("open");
}

export function stat(k, v, accent = false) {
  return h("span", { class: `stat${accent ? " accent" : ""}` }, k, h("b", {}, v));
}

export function callStats(meta, onInspect, calls = 1) {
  return h("div", { class: "stat-row" },
    stat(`${calls} call${calls > 1 ? "s" : ""}`, `${meta.question_count} questions`),
    stat(meta.replayed ? "recorded" : "latency", ms(meta.latency_ms), true),
    stat("tokens", num(meta.input_tokens)),
    stat("cost", usd(meta.cost_usd)),
    meta.replayed ? h("span", { class: "badge accent", title: "A recorded Jev answer for this exact request was replayed. No live call, no cost." }, icon("replay"), "replayed") : null,
    onInspect && h("button", { class: "btn sm ghost", onclick: onInspect }, icon("code"), "Inspect JSON"));
}

// ---------- toast ----------
export function toast(message, kind = "") {
  let host = $(".toast-host");
  if (!host) { host = h("div", { class: "toast-host", role: "status" }); document.body.append(host); }
  const t = h("div", { class: `toast pop ${kind}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), kind === "error" ? 7000 : 3200);
}

// ---------- status pill + settings modal ----------
export function currentStatus() { return status; }

export async function refreshStatus() {
  try {
    status = await api("/api/status");
    renderPill();
    window.dispatchEvent(new CustomEvent("jev:status", { detail: status }));
  } catch (e) { console.error(e); }
  return status;
}
const refreshStatusSoon = debounce(refreshStatus, 350);

function renderPill() {
  const pill = $("#key-pill");
  if (!pill) return;
  pill.classList.toggle("ok", status.configured);
  const s = status.spend || {};
  const parts = status.configured
    ? [h("span", { class: "dot" }), `${status.model}`, h("span", { class: "sep" }), `${usd(s.spent_usd)} · ${num(s.live_calls)} live`]
    : [h("span", { class: "dot" }), status.replay?.entries ? "No key · replaying recorded answers" : "Connect API key"];
  mount(pill, ...parts);
}

let modalOpen = false;
export function openSettings(reason = "") {
  if (modalOpen) return;
  modalOpen = true;
  const env = status.env || {};
  const s = status.spend || {};
  const r = status.replay || {};
  const input = h("input", { class: "input mono", type: "password", placeholder: "paste your TypeSafe API key", autocomplete: "new-password", spellcheck: "false" });
  const save = h("input", { type: "checkbox", checked: env.can_save });
  if (!env.can_save) save.disabled = true;
  const error = h("p", { style: { color: "var(--critical-text)", minHeight: "18px", fontSize: "12.5px" } }, reason);
  const connect = h("button", { class: "btn primary" }, icon("key"), "Validate & connect");
  const wrap = h("div", { class: "modal-wrap", onclick: (e) => { if (e.target === wrap) close(); } });
  const replaceable = !status.configured || status.key_source === "memory";

  const sourceText = { env: "the TYPESAFE_API_KEY environment variable", file: ".env in the project folder", memory: "this server's memory (until restart)" }[status.key_source];
  const keySection = h("div", { class: "grid", style: { gap: "10px" } },
    status.configured
      ? h("div", { class: "callout good" }, icon("check"), h("div", {}, h("b", {}, "Connected"), h("div", { class: "muted" }, `Key loaded from ${sourceText}. It is never sent to the browser.`)))
      : h("div", { class: "callout" }, icon("key"), h("div", {}, h("b", {}, "No key yet"), h("div", { class: "muted" }, "Create one at ", h("a", { href: "https://console.typesafe.ai/settings/keys", target: "_blank", rel: "noopener" }, "console.typesafe.ai"), ", paste it here, and it is validated against TypeSafe before anything is stored."))),
    replaceable ? input : null,
    replaceable ? h("label", { class: "toggle", style: { alignItems: "flex-start" } }, save, h("span", { class: "track", style: { marginTop: "2px", flex: "none" } }),
      h("span", {}, "Save to ", h("code", {}, ".env"), " in the project folder so it survives restarts",
        h("div", { class: "faint", style: { fontSize: "11.5px", marginTop: "2px" } },
          env.can_save
            ? "Written with owner-only permissions (0600) to a file that is gitignored and not tracked by git. The key never leaves this machine."
            : `Disabled: ${(env.problems || []).join(" ")}`))) : null,
    !replaceable && status.key_source === "file" && env.perms_ok === false
      ? h("div", { class: "callout" }, icon("alert"), h("div", {}, h("b", {}, ".env is readable by other users"), h("div", { class: "muted" }, "Run ", h("code", {}, "chmod 600 .env"), " to make it owner-only."))) : null,
    error,
    h("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" } },
      status.configured ? h("button", { class: "btn danger", onclick: forget }, icon("trash"), status.key_source === "file" ? "Forget key (remove from .env)" : status.key_source === "env" ? "Ignore env key for this run" : "Forget key") : null,
      h("button", { class: "btn ghost", onclick: () => close() }, "Close"), replaceable ? connect : null));

  const budgetPct = s.budget_usd ? Math.min(1, s.spent_usd / s.budget_usd) : 0;
  const spendSection = h("div", { class: "grid", style: { gap: "8px" } },
    h("div", { class: "section-label" }, "Spend guard · this server run"),
    h("div", { class: "meter" }, h("i", { style: { width: pct(budgetPct, 1), background: budgetPct > 0.8 ? "var(--warning)" : "var(--series)" } })),
    h("div", { class: "muted", style: { fontSize: "12.5px" } }, `${usd(s.spent_usd)} of a ${money(s.budget_usd)} budget · ${num(s.live_calls)} live calls · ${num(s.input_tokens)} input tokens · local cap ${s.rpm}/min. Change with `, h("code", {}, "JEV_LAB_BUDGET_USD"), " and ", h("code", {}, "JEV_LAB_RPM"), "."));

  const recordBtn = h("button", { class: "btn sm", disabled: !status.configured, onclick: record }, icon("replay"), "Record demo answers now");
  const replaySection = h("div", { class: "grid", style: { gap: "8px" } },
    h("div", { class: "section-label" }, "Replay cache"),
    h("div", { class: "muted", style: { fontSize: "12.5px" } },
      r.entries ? `${num(r.entries)} recorded Jev answers in data/replay.json (${num(r.hits)} replayed this run). Built-in demos use them instead of live calls; your own input always goes live.`
        : "Empty. Once you have a key, record the built-in demos so this repo works for people who have no key yet. Costs well under a cent."),
    h("div", {}, recordBtn));

  mount(wrap, h("div", { class: "panel modal pop", style: { width: "min(600px, 100%)", maxHeight: "92vh", overflow: "auto" } },
    h("div", { class: "panel-head" }, icon("key"), h("h3", {}, "API key & safety"), h("div", { class: "spacer" }),
      h("span", { class: "faint", style: { fontSize: "12px" } }, status.backend)),
    h("div", { class: "panel-body grid", style: { gap: "18px" } }, keySection, spendSection, replaySection)));

  function close() { wrap.remove(); modalOpen = false; }
  async function submit() {
    connect.disabled = true;
    error.textContent = "";
    try {
      const res = await api("/api/key", { key: input.value, save: save.checked && !save.disabled });
      status = res;
      renderPill();
      close();
      const names = (res.models || []).map((m) => m.name).join(", ");
      toast(res.saved ? `Connected and saved to .env · ${names}` : `Connected for this run · ${names}`);
      if (res.save_error) toast(`Not saved to .env: ${res.save_error}`, "error");
      window.dispatchEvent(new CustomEvent("jev:key"));
      window.dispatchEvent(new CustomEvent("jev:status", { detail: status }));
    } catch (e) {
      error.textContent = e.message;
    } finally { connect.disabled = false; }
  }
  async function forget() {
    try {
      status = await api("/api/key/forget", {});
      renderPill();
      close();
      toast(status.removed_from_file ? "Key removed from .env and from memory" : "Key removed from memory");
      window.dispatchEvent(new CustomEvent("jev:status", { detail: status }));
    } catch (e) { error.textContent = e.message; }
  }
  async function record() {
    recordBtn.disabled = true;
    mount(recordBtn, h("span", { class: "spin" }), " Recording every built-in scenario…");
    try {
      const res = await api("/api/replay/record", {});
      const c = res.counts;
      toast(`Recorded ${c.live_calls} live calls (≈ ${usd(c.cost_usd_x1e6 / 1e6)}) into data/replay.json. Commit it!`);
      await refreshStatus();
      close();
    } catch (e) {
      toast(e.message, "error");
      recordBtn.disabled = false;
      mount(recordBtn, icon("replay"), "Record demo answers now");
    }
  }
  connect.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  document.body.append(wrap);
  input.focus();
}
export const openKeyModal = openSettings;

// ---------- nav ----------
const LINKS = [["/", "Overview"], ["/shield", "Shield"], ["/dispatch", "Dispatch"], ["/autopilot", "Autopilot"],
  ["/find", "Find"], ["/play", "Play"], ["/workbench", "Workbench"]];

export async function initChrome(active) {
  const bar = h("header", { class: "topbar" },
    h("a", { class: "brand", href: "/" }, h("span", { class: "brand-mark" }, "J"), "Jev Lab", h("small", {}, "TypeSafe System One")),
    h("nav", { class: "nav" }, LINKS.map(([href, label]) => h("a", { href, class: href === active ? "active" : "" }, label))),
    h("div", { class: "spacer" }),
    h("button", { id: "key-pill", class: "key-pill", onclick: () => openSettings(), title: "API key, spend, and replay settings" }, h("span", { class: "dot" }), "Checking…"));
  document.body.prepend(bar);
  return refreshStatus();
}

export function handleError(e) {
  console.error(e);
  if (e.status !== 401 && e.status !== 403) toast(e.message, "error");
}
