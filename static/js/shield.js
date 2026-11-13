import {
  $, api, barRow, callStats, choiceBars, debounce, h, handleError, icon, initChrome, inspect, mount, ms, pct,
  stat, statusBadge, toast, usd, num,
} from "./common.js";
import { installLab, labEnv } from "./lab/env.js";
import { LAB } from "./lab/pages/shield.js";
import { shieldInboxCtx, shieldResultCtx } from "./lab/surfaces/shield.js";

const IDENTITY_LABELS = {
  bean_brokers: "Bean Brokers Ltd", packright: "PackRight Packaging", coastline_freight: "Coastline Freight",
  sparkle_facility: "Sparkle Facility Services", harbor_coffee: "Harbor Coffee (internal)",
  customer_or_person: "Customer / individual", other_organization: "Other organization",
};
const CATEGORY_LABELS = {
  customer_request: "Customer request", vendor_business: "Vendor business", wholesale: "Wholesale",
  internal: "Internal", marketing: "Marketing", other: "Other",
};

const S = {
  inbox: [], selected: null, compose: false, live: false,
  results: {}, // id -> last /api/shield result
  weights: null, policy: null,
  pending: new Set(), // ids with a /api/shield call in flight (for Lab packs)
  scanning: false,    // "Scan whole inbox" is in flight (for Lab packs)
};

const COMPOSE_ID = "__compose__";
const draft = {
  id: COMPOSE_ID, from_name: "Harbor Coffee Payroll", from_email: "payroll@harbor-coffee-hr.example",
  subject: "Bonus approved - confirm today",
  body: "Congrats! You've been approved for a $500 staff bonus. Log in with your email password at the link below within 3 hours to claim it.",
};

// Lab surfaces of this page (contract: static/js/lab/surfaces/shield.js). Both ctx objects read the page state at
// call time, so one of each serves the whole page session. Packs never screen a message: they can open one that
// already has a result, fill the "Write your own" form without screening it, and move the policy sliders (re-scoring
// is pure code, no Jev call). Lab's filters and sort reach the inbox, the batch table and the signal rows.
const INBOX_ID = "shield.inbox";
const RESULT_ID = "shield.result";
const labSource = {
  inbox: () => S.inbox, results: () => S.results, selected: () => S.selected, composeId: COMPOSE_ID,
  draft: () => draft, live: () => S.live, pending: () => S.pending, scanning: () => S.scanning,
  weights: () => S.weights, policy: () => S.policy, defaults: () => defaults, batch: () => lastBatch,
  labels: () => ({ signals: SIGNAL_NAMES, identities: IDENTITY_LABELS, categories: CATEGORY_LABELS }),
  open: (id) => select(id), openCompose: () => select(COMPOSE_ID), draftCompose: (fields) => draftCompose(fields),
  applyPolicy: (next) => applyPolicy(next), resetPolicy: () => resetPolicy(), inspect: (trace, title) => inspect(trace, title),
};
const INBOX = shieldInboxCtx({ ...labSource,
  matches: (item, ctx) => LAB.matches(INBOX_ID, item, ctx), arrange: (items, ctx) => LAB.arrange(INBOX_ID, items, ctx),
  refresh: () => { renderInbox(); renderBatch(lastBatch); } });
const RESULT = shieldResultCtx({ ...labSource,
  matches: (item, ctx) => LAB.matches(RESULT_ID, item, ctx), arrange: (items, ctx) => LAB.arrange(RESULT_ID, items, ctx),
  refresh: () => { const res = S.results[S.selected]; if (res) renderResult(res); } });

async function boot() {
  await initChrome("/shield");
  installLab(LAB);
  const { inbox } = await api("/api/scenarios");
  S.inbox = inbox;
  renderInbox();
  select(inbox[1].id);
  mount("#scan-icon", icon("layers"));
  $("#scan-all").addEventListener("click", scanAll);
  window.addEventListener("jev:key", () => S.selected && screen(currentMessage()));
}

function currentMessage() {
  return S.selected === COMPOSE_ID ? draft : S.inbox.find((m) => m.id === S.selected);
}

function resultBadge(r) {
  if (!r) return null;
  if (r.verdict) return statusBadge(r.verdict.level);
  if (r.error) return statusBadge("reject", r.skipped ? "Skipped" : "Failed");
  return null;
}

// The inbox messages to list: page order, minus what a Lab filter hides, in Lab's sort order when one is set.
function shownMessages() {
  return INBOX.shown().map((item) => S.inbox[item.position - 1]).filter(Boolean);
}

function renderInbox() {
  const total = S.inbox.length;
  const shown = shownMessages();
  const active = LAB.active(INBOX_ID);
  $("#inbox-count").textContent = active ? `${shown.length} of ${total} messages` : `${total} messages`;
  const items = shown.map((m) => {
    const r = S.results[m.id];
    return h("button", { class: `inbox-item${S.selected === m.id ? " active" : ""}`, onclick: () => select(m.id) },
      h("div", { class: "from" }, h("span", {}, m.from_name), resultBadge(r)),
      h("div", { class: "subj" }, m.subject));
  });
  const composeResult = S.results[COMPOSE_ID];
  items.push(h("button", { class: `inbox-item${S.selected === COMPOSE_ID ? " active" : ""}`, onclick: () => select(COMPOSE_ID) },
    h("div", { class: "from" }, h("span", { style: { color: "var(--accent-text)" } }, "✎ Write your own"), resultBadge(composeResult)),
    h("div", { class: "subj" }, "Try to sneak something past it")));
  mount("#inbox",
    active ? h("div", { class: "faint", role: "status", style: { padding: "8px 14px", fontSize: "12px", borderBottom: "1px solid var(--line)" } },
      `${active} Lab setting${active === 1 ? "" : "s"} active${total && !shown.length ? ": no message matches." : "."} `,
      h("button", { class: "btn sm ghost", onclick: resetInboxLab }, "Clear Lab filters and sort")) : null,
    items);
}

function resetInboxLab() {
  LAB.reset(INBOX_ID);
  renderInbox();
  renderBatch(lastBatch);
  renderInboxLab();
}

// The Lab tools beside the inbox and under the verdict. Rendered again when results, the selection or the weights
// change, so their metrics read the page as it is; Lab's refresh() re-renders only the lists.
function renderInboxLab() {
  const section = LAB.section(labEnv, INBOX_ID, INBOX);
  $("#inbox-lab").classList.toggle("hidden", !section);
  mount("#inbox-lab", section);
}

function renderResultLab() {
  const section = LAB.section(labEnv, RESULT_ID, RESULT);
  $("#result-lab").classList.toggle("hidden", !section);
  mount("#result-lab", section);
}

function renderLab() {
  renderInboxLab();
  renderResultLab();
}

function select(id) {
  S.selected = id;
  renderInbox();
  renderMessage();
  const cached = S.results[id];
  if (cached) renderResult(cached);
  else if (id !== COMPOSE_ID) screen(currentMessage());
  else renderResult(null);
  renderLab();
}

// What a Lab pack may do with "Write your own": fill the form and open it WITHOUT screening. Nothing fires an input
// event, so even with Live on the page asks only after the user's next edit or "Screen message", as always.
function draftCompose(fields) {
  for (const key of ["from_name", "from_email", "subject", "body"]) if (typeof fields[key] === "string") draft[key] = fields[key];
  select(COMPOSE_ID);
}

function renderMessage() {
  const m = currentMessage();
  if (S.selected !== COMPOSE_ID) {
    mount("#message",
      h("div", { class: "mail-head" },
        h("div", { class: "subject" }, m.subject),
        h("div", { class: "muted" }, h("b", { style: { color: "var(--text)" } }, m.from_name), " ", h("span", { class: "mono" }, `<${m.from_email}>`))),
      h("div", { class: "mail-body" }, m.body),
      h("div", { style: { display: "flex", gap: "8px", marginTop: "12px", alignItems: "center" } },
        h("button", { class: "btn sm", onclick: () => screen(m) }, icon("reset"), "Re-screen"),
        h("span", { class: "faint", style: { fontSize: "12px" } }, "Scenario note (not sent to Jev): ", m.label?.expect)));
    return;
  }
  const field = (key, label, multiline = false) => {
    const input = multiline
      ? h("textarea", { class: "input", rows: 6 }, draft[key])
      : h("input", { class: "input", value: draft[key] });
    input.addEventListener("input", () => { draft[key] = input.value; if (S.live) liveScreen(); });
    return h("label", { class: "field" }, label, input);
  };
  const liveToggle = h("input", { type: "checkbox" });
  liveToggle.checked = S.live;
  liveToggle.addEventListener("change", () => { S.live = liveToggle.checked; if (S.live) screen(draft); });
  mount("#message",
    h("div", { class: "compose" },
      h("div", { class: "row" }, field("from_name", "From name"), field("from_email", "From email")),
      field("subject", "Subject"),
      field("body", "Body", true),
      h("div", { style: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" } },
        h("button", { class: "btn primary", onclick: () => screen(draft) }, icon("shield"), "Screen message"),
        h("label", { class: "toggle" }, liveToggle, h("span", { class: "track" }), "Live: re-screen as you type"),
        h("span", { class: "faint", style: { fontSize: "12px" } }, "Try: an AI prompt injection, a fake invoice, or a normal question"))));
}

const liveScreen = debounce(() => screen(draft), 450);

async function screen(message) {
  const id = message.id;
  if (!S.results[id]) mount("#result-panel", h("div", { class: "empty" }, h("span", { class: "spin" }), " Asking Jev ten questions at once…"));
  S.pending.add(id);
  try {
    const res = await api("/api/shield", { message, weights: S.weights, policy: S.policy });
    S.results[id] = res;
    if (!S.weights) adoptPolicy(res.verdict);
    S.pending.delete(id);
    renderInbox();
    if (S.selected === id) renderResult(res);
  } catch (e) {
    handleError(e);
    if (S.selected === id && !S.results[id]) mount("#result-panel", h("div", { class: "empty" }, e.message));
  } finally {
    S.pending.delete(id);
    renderLab();
  }
}

function renderResult(res, note = "") {
  if (!res) {
    mount("#result-panel", h("div", { class: "empty" }, "Write a message and screen it."));
    return;
  }
  if (!res.verdict) {
    mount("#result-panel", h("div", { class: "empty" }, res.error || "This message was not screened."));
    return;
  }
  const v = res.verdict;
  const a = res.answers;
  const f = res.fact;
  const levelWord = { safe: "Nothing suspicious", review: "Hold for a human", quarantine: "Quarantined" }[v.level];

  const meter = h("div", { class: "meter", style: { marginTop: "10px" } },
    h("i", { style: { width: pct(v.risk, 1), background: v.level === "quarantine" ? "var(--critical)" : v.level === "review" ? "var(--warning)" : "var(--good)" } }),
    h("span", { class: "tick", style: { left: pct(v.policy.review_at, 1) }, title: "review threshold" }),
    h("span", { class: "tick", style: { left: pct(v.policy.quarantine_at, 1) }, title: "quarantine threshold" }));

  const signals = shownSignals(res).map((s) =>
    h("div", { class: `signal-row${s.contribution >= 0.15 ? " hot" : ""}`, title: `p=${s.value.toFixed(3)} × weight ${s.weight.toFixed(2)} = ${s.contribution.toFixed(3)}` },
      h("span", { class: "lbl" }, s.label),
      (() => { const r = barRow("", s.value); return r.querySelector(".bar"); })(),
      h("span", { class: "val" }, pct(s.value)),
      h("span", { class: "contrib" }, `×${s.weight.toFixed(2)}→${s.contribution.toFixed(2)}`)));

  const identity = h("div", {},
    h("div", { class: "section-label" }, "Who does the sender claim to be? · Choice"),
    choiceBars(a.claimed_identity, IDENTITY_LABELS, 3),
    h("dl", { class: "domain-check" },
      h("dt", {}, "Sender domain"), h("dd", {}, f.sender_domain || "—"),
      h("dt", {}, "Expected"), h("dd", {}, f.expected_domain || "n/a (not a known org)"),
      h("dt", {}, "Code check"), h("dd", {},
        f.domain_matches === null ? h("span", { class: "faint" }, "nothing to verify")
          : f.domain_matches ? statusBadge("safe", "Domain matches")
            : statusBadge("quarantine", f.lookalike_domain ? "Lookalike domain" : "Domain mismatch"))));

  const scoreBlock = (title, ans) => h("div", {},
    h("div", { class: "section-label" }, `${title} · Score ${ans.score.toFixed(2)} / ${Object.keys(ans.legend).length - 1}`),
    h("div", { class: "score-levels" }, Object.entries(ans.legend).map(([lvl, text]) =>
      barRow(text.split(":")[0], ans.probabilities?.[lvl] ?? 0, { top: Math.round(ans.score) === Number(lvl), title: text }))));

  mount("#result-panel",
    h("div", { class: "panel-head" }, icon("shield"), h("h2", {}, "Verdict"), h("div", { class: "spacer" }),
      callStats(res.meta, () => inspect(res.trace, "Shield · one Jev request"))),
    h("div", { class: "panel-body grid", style: { gap: "18px" } },
      h("div", { class: "verdict" },
        h("div", {}, h("div", { class: "risk-num" }, pct(v.risk)), h("div", { class: "risk-label" }, "combined risk")),
        h("div", {},
          h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
            statusBadge(v.level, null, "lg"), h("b", {}, levelWord),
            h("span", { class: "rescore-note" }, note)),
          meter,
          h("div", { class: "faint", style: { fontSize: "11.5px", marginTop: "6px", display: "flex", justifyContent: "space-between" } },
            h("span", {}, "0"), h("span", {}, `review ≥ ${pct(v.policy.review_at)} · quarantine ≥ ${pct(v.policy.quarantine_at)}`), h("span", {}, "100%")))),
      v.rules.length ? h("div", { class: "grid", style: { gap: "6px" } },
        h("div", { class: "section-label" }, "Hard rules that fired (code)"),
        v.rules.map((r) => h("div", { class: "rule" },
          h("span", { style: { color: r.action === "quarantine" ? "var(--critical-text)" : "var(--warning-text)" } }, icon(r.action === "quarantine" ? "stop" : "eye")),
          h("span", {}, h("b", {}, r.action === "quarantine" ? "Quarantine: " : "Review: "), r.text)))) : null,
      h("div", {},
        h("div", { class: "section-label" }, "Signals · Noul probabilities, weighted in code"),
        signalsNote(res, signals.length),
        h("div", { class: "bars" }, signals)),
      h("div", { class: "two-col" },
        identity,
        h("div", { class: "grid", style: { gap: "16px" } },
          h("div", {}, h("div", { class: "section-label" }, "What kind of message? · Choice"), choiceBars(a.category, CATEGORY_LABELS, 3)),
          scoreBlock("Loss if obeyed blindly", a.harm_if_obeyed)))));
}

// The signal rows of a verdict: strongest contribution first, minus what a Lab filter hides, in Lab's sort order when
// one is set. Lab reads the opened message's result, so any other result keeps the page's own order.
function shownSignals(res) {
  const v = res.verdict;
  if (res !== S.results[S.selected]) return [...v.signals].sort((x, y) => y.contribution - x.contribution);
  const byId = new Map(v.signals.map((s) => [s.id, s]));
  return RESULT.shown().map((item) => byId.get(item.id)).filter(Boolean);
}

function signalsNote(res, count) {
  const active = LAB.active(RESULT_ID);
  if (!active || res !== S.results[S.selected]) return null;
  const total = res.verdict.signals.length;
  return h("div", { class: "faint", role: "status", style: { fontSize: "12px", margin: "4px 0 8px" } },
    `${count} of ${total} signals shown · ${active} Lab setting${active === 1 ? "" : "s"} active${count ? "" : ": no signal matches"}. `,
    h("button", { class: "btn sm ghost", onclick: () => { LAB.reset(RESULT_ID); renderResult(res); renderResultLab(); } }, "Clear Lab filters and sort"));
}

// ---------- policy sliders: re-score without calling Jev ----------
const SIGNAL_NAMES = {
  ai_instructions: "Instructs an AI", credential_request: "Credential ask", payment_change: "Payment redirect",
  secrecy_or_bypass: "Secrecy / bypass", link_lure: "Link lure", unexpected_reward: "Unexpected reward",
  pressure: "Time pressure", identity_mismatch: "Domain mismatch",
};

function renderPolicy() {
  const slider = (group, key, label, min = 0, max = 1, step = 0.05) => {
    const out = h("output", {}, S[group][key].toFixed(2));
    const input = h("input", { type: "range", min, max, step, value: S[group][key], "aria-label": label });
    input.addEventListener("input", () => {
      S[group][key] = Number(input.value);
      out.textContent = Number(input.value).toFixed(2);
      rescore();
    });
    return h("div", { class: "slider" }, h("span", { class: "name" }, label), input, out);
  };
  mount("#policy",
    h("div", { class: "section-label" }, "Signal weights"),
    Object.entries(SIGNAL_NAMES).map(([k, label]) => slider("weights", k, label)),
    h("div", { class: "divider" }),
    h("div", { class: "section-label" }, "Thresholds"),
    slider("policy", "review_at", "Review at risk ≥"),
    slider("policy", "quarantine_at", "Quarantine at risk ≥"),
    slider("policy", "hard_rule_at", "Hard rule fires at p ≥"),
    h("button", { class: "btn sm ghost", onclick: resetPolicy }, icon("reset"), "Reset to defaults"));
}

let defaults = null;
function adoptPolicy(verdict) {
  defaults = { weights: { ...verdict.weights }, policy: { ...verdict.policy } };
  S.weights = { ...defaults.weights };
  S.policy = { ...defaults.policy };
  renderPolicy();
}

// What a Lab pack's setWeights/setPolicy does: the same as moving those sliders (the contract checks the values).
function applyPolicy({ weights, policy }) {
  if (weights) S.weights = { ...S.weights, ...weights };
  if (policy) S.policy = { ...S.policy, ...policy };
  renderPolicy();
  rescore();
}

function resetPolicy() {
  if (!defaults) return;
  S.weights = { ...defaults.weights };
  S.policy = { ...defaults.policy };
  renderPolicy();
  rescore();
}

const rescore = debounce(async () => {
  const targets = Object.entries(S.results);
  if (!targets.length) return;
  const started = performance.now();
  try {
    const updated = await Promise.all(targets.filter(([, r]) => r.verdict && r.answers && r.fact).map(async ([id, r]) => {
      const { verdict, compute_ms } = await api("/api/shield/rescore", { answers: r.answers, fact: r.fact, weights: S.weights, policy: S.policy });
      return [id, { ...r, verdict }, compute_ms];
    }));
    for (const [id, r] of updated) S.results[id] = r;
    const took = performance.now() - started;
    renderInbox();
    const current = S.results[S.selected];
    if (current) renderResult(current, `Re-scored ${updated.length} message${updated.length > 1 ? "s" : ""} in ${ms(took)} · 0 Jev calls`);
    if (!$("#batch-panel").classList.contains("hidden")) renderBatch(lastBatch);
    renderLab();
  } catch (e) { handleError(e); }
}, 60);

// ---------- batch ----------
let lastBatch = null;
async function scanAll() {
  const btn = $("#scan-all");
  btn.disabled = true;
  S.scanning = true;
  mount("#scan-icon", h("span", { class: "spin" }));
  try {
    const res = await api("/api/shield/batch", { messages: S.inbox, weights: S.weights });
    for (const r of res.results) {
      S.results[r.id] = r.verdict ? r : {
        id: r.id,
        error: r.error || "Not screened. The batch stopped before this message.",
        skipped: !!r.skipped,
        status: r.status,
      };
    }
    const firstOk = res.results.find((r) => r.verdict);
    if (!S.weights && firstOk) adoptPolicy(firstOk.verdict);
    lastBatch = res;
    renderInbox();
    if (S.results[S.selected]) renderResult(S.results[S.selected]);
    renderBatch(res);
    const failed = res.results.filter((r) => !r.verdict).length;
    const done = res.results.length - failed;
    toast(failed
      ? `Screened ${done} of ${res.results.length} messages. ${failed} failed or were skipped.`
      : `Screened ${done} messages in ${ms(res.wall_ms)} for ${usd(res.total_cost_usd)}`);
  } catch (e) { handleError(e); } finally {
    btn.disabled = false;
    S.scanning = false;
    mount("#scan-icon", icon("layers"));
    renderLab();
  }
}

function renderBatch(res) {
  if (!res) return;
  const panel = $("#batch-panel");
  panel.classList.remove("hidden");
  const visible = shownBatchResults(res);
  const active = LAB.active(INBOX_ID);
  const rows = visible.map((r) => {
    const m = S.inbox.find((x) => x.id === r.id);
    const current = S.results[r.id];
    if (!current?.verdict) {
      return h("tr", { style: { cursor: "pointer" }, onclick: () => select(r.id) },
        h("td", {}, h("b", {}, m.from_name), h("div", { class: "faint" }, m.subject)),
        h("td", {}, resultBadge(current)),
        h("td", { class: "num" }, "—"),
        h("td", {}, h("span", { class: "faint" }, current?.error || r.error || "Not screened")),
        h("td", { class: "num" }, "—"),
        h("td", { class: "num" }, "—"));
    }
    const expected = m.label?.shield || (m.label?.attack ? "quarantine" : "safe");
    const matched = current.verdict.level === expected;
    const meta = current.meta;
    return h("tr", { style: { cursor: "pointer" }, onclick: () => select(r.id) },
      h("td", {}, h("b", {}, m.from_name), h("div", { class: "faint" }, m.subject)),
      h("td", {}, statusBadge(current.verdict.level)),
      h("td", { class: "num" }, pct(current.verdict.risk)),
      h("td", {}, h("span", { class: `badge ${matched ? "good" : "warning"}`, title: m.label?.expect || "" }, icon(matched ? "check" : "alert"), `expected ${expected}`)),
      h("td", { class: "num" }, meta ? ms(meta.latency_ms) : "—"),
      h("td", { class: "num" }, meta ? num(meta.input_tokens) : "—"));
  });
  const sumLatency = res.results.reduce((s, r) => s + (r.meta?.latency_ms || 0), 0);
  mount(panel,
    h("div", { class: "panel-head" }, icon("layers"), h("h2", {}, "Whole inbox, screened in parallel"), h("div", { class: "spacer" }),
      h("div", { class: "stat-row" },
        stat("wall time", ms(res.wall_ms), true), stat("sum of calls", ms(sumLatency)),
        stat("tokens", num(res.total_input_tokens)), stat("total cost", usd(res.total_cost_usd), true))),
    active ? h("div", { class: "panel-body faint", role: "status", style: { fontSize: "12px", paddingBottom: "0" } },
      `${visible.length} of ${res.results.length} messages shown · ${active} Lab setting${active === 1 ? "" : "s"} active on the inbox. The totals cover the whole batch.`) : null,
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, ["Message", "Verdict", "Risk", "Expected from the text", "Latency", "Tokens"].map((t, i) => h("th", { class: i >= 2 && i !== 3 ? "num" : "" }, t)))),
      h("tbody", {}, rows))),
    h("div", { class: "panel-body faint", style: { fontSize: "12px" } },
      "“Expected” is what the message text alone should trigger, written with the demo and never sent to Jev. A stranger asking for someone else's refund reads as safe here; Autopilot catches that one with a code check against the order data."));
}

// The batch rows to list: every result in the batch's order, or with Lab settings active on the inbox, the results of
// the shown messages in their shown order.
function shownBatchResults(res) {
  if (!LAB.active(INBOX_ID)) return res.results;
  const byId = new Map(res.results.map((r) => [r.id, r]));
  return INBOX.shown().map((item) => byId.get(item.id)).filter(Boolean);
}

boot().catch(handleError);
