// Spend previews next to the Workbench's paid run buttons (POST /api/workbench/estimate, jev/estimate.py).
// The server builds the requests the run would send and adds up the high estimate each live call holds against the
// session budget, so a preview is an upper bound, never a measured cost. It makes no model call and reserves nothing.
// The formatting and confirm logic are free of the DOM so tests/js can import them; estimateLine takes the page's h()
// and api() so this module never imports common.js.

const ENDPOINT = "/api/workbench/estimate";
const WAIT_MS = 400;     // debounce after typing
const FRESH_MS = 10000;  // a preview this recent is shown again without asking the server

// Dollars rounded up to two significant digits (at least two decimals), so an upper bound never reads lower than it is.
export function usdUp(value) {
  const v = Number(value) || 0;
  if (v <= 0) return "$0";
  const places = Math.max(2, 1 - Math.floor(Math.log10(v)));
  const step = 10 ** -places;
  return `$${(Math.ceil(v / step - 1e-9) * step).toFixed(places)}`;
}

// Dollars rounded down the same way, for the budget left, so the room left never reads higher than it is.
export function usdDown(value) {
  const v = Number(value) || 0;
  if (v <= 0) return "$0";
  const places = Math.max(2, 1 - Math.floor(Math.log10(v)));
  const step = 10 ** -places;
  return `$${(Math.floor(v / step + 1e-9) * step).toFixed(places)}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// True when the run's upper bound is more than the budget left, so starting it needs an explicit confirm.
export function needsConfirm(est) {
  return Boolean(est && est.fits === false);
}

// "120 calls · ≤ $0.0040 · fits the $1.99 left in this session's budget".
export function estimateText(est) {
  if (!est) return "";
  const head = `${plural(est.calls, "call")} · ≤ ${usdUp(est.usd)}`;
  if (est.remaining_usd === null || est.remaining_usd === undefined) return `${head} · no session budget set`;
  const left = `the ${usdDown(est.remaining_usd)} left in this session's budget`;
  return est.fits ? `${head} · fits ${left}` : `${head} · more than ${left}`;
}

// The hover text: how the bound is made, the calls per part, test rows left out, and the server's notes.
export function estimateDetail(est) {
  if (!est) return "";
  const parts = (est.parts || []).map((p) => `${p.label}: ${plural(p.calls, "call")} to ${p.model}, ≤ ${usdUp(p.usd)}`);
  const extra = [];
  if (est.held_out) extra.push(`${plural(est.held_out, "test row")} left out, as the run leaves them out`);
  if (est.capped) extra.push(`${plural(est.capped, "row")} past the 200-row cap not sent`);
  return ["Upper bound, not a measured cost: the most each call can hold against the session budget. No model call was made to estimate it.",
    ...parts, ...extra, ...(est.notes || [])].join("\n");
}

export function confirmMessage(est) {
  return `This run makes up to ${plural(est.calls, "live call")} and may cost up to ${usdUp(est.usd)} (an upper bound, not a measured cost), `
    + `more than the ${usdDown(est.remaining_usd)} left in this session's budget. The budget stops the run once it is spent, so the rows after that `
    + "get no answer. Start it anyway?";
}

export function errorMessage(e) {
  return `The spend preview failed (${e?.message || e}), so this run's cost and the budget left are unknown. `
    + "Start it anyway? Cancel to retry the preview.";
}

// Ask for a fresh preview just before a paid run. Resolves true to go ahead: the run fits, or the user confirmed,
// including after a failed preview, whose error is shown so the user can cancel and retry. ask: window.confirm in the
// page; tests pass their own.
// One at a time: a second paid click while a preview is on its way resolves false, so a double click cannot start
// two runs before the first one marks itself running.
let confirming = false;
export async function confirmSpend(api, kind, body, ask = (m) => globalThis.confirm(m)) {
  if (confirming) return false;
  confirming = true;
  cache.clear();  // the run changes what is left; every line asks again
  try {
    let est;
    try { est = await api(ENDPOINT, { ...body, kind }); } catch (e) { return Boolean(ask(errorMessage(e))); }
    return needsConfirm(est) ? Boolean(ask(confirmMessage(est))) : true;
  } finally { confirming = false; }
}

// ---------- live lines ----------
const lines = new Set();
const cache = new Map();  // request key -> { at, promise }
let listening = false;
let timer = null;

function requestOf(line) {
  try {
    const body = line.getBody();
    return body ? { ...body, kind: line.kind } : null;
  } catch { return null; }  // inputs not complete yet, such as a Compare variant that does not parse
}

function show(line, text, warn = false, title = "") {
  line.el.textContent = text;
  line.el.title = title;
  line.el.style.color = warn ? "var(--warning-text)" : "";
}

async function refresh(line) {
  const request = requestOf(line);
  if (!request) { line.key = null; show(line, ""); return; }
  const key = JSON.stringify(request);
  line.key = key;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > FRESH_MS) {
    hit = { at: Date.now(), promise: line.api(ENDPOINT, request) };
    cache.set(key, hit);
  }
  try {
    const est = await hit.promise;
    if (line.key !== key) return;  // the inputs changed while it was on its way
    show(line, estimateText(est), needsConfirm(est), estimateDetail(est));
  } catch (e) {
    if (cache.get(key) === hit) cache.delete(key);
    if (line.key === key) show(line, "", false, `No spend preview: ${e.message || e}`);
  }
}

function refreshAll() {
  timer = null;
  for (const line of lines) {
    if (!line.el.isConnected) lines.delete(line);  // replaced by a render
    else refresh(line);
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(refreshAll, WAIT_MS);
}

// A compact line to put next to a paid run button. getBody() returns the body the run would post (without kind), or
// null; it is read again after any typing on the page (debounced) and whenever the page renders a new line.
export function estimateLine(h, api, kind, getBody) {
  const el = h("span", { class: "faint", "aria-live": "polite", style: { fontSize: "12px" } });
  const line = { el, kind, getBody, api, key: null };
  lines.add(line);
  if (!listening && typeof document !== "undefined") {
    listening = true;
    document.addEventListener("input", schedule, true);
    document.addEventListener("change", schedule, true);
  }
  const request = requestOf(line);
  if (request && cache.has(JSON.stringify(request))) refresh(line);  // a render: show the preview it already has
  else schedule();
  return el;
}
