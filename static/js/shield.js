import {
  $, api, barRow, callStats, choiceBars, debounce, h, handleError, icon, initChrome, inspect, mount, ms, pct,
  stat, statusBadge, toast, usd, num,
} from "./common.js";

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
};

const COMPOSE_ID = "__compose__";
const draft = {
  id: COMPOSE_ID, from_name: "Harbor Coffee Payroll", from_email: "payroll@harbor-coffee-hr.example",
  subject: "Bonus approved - confirm today",
  body: "Congrats! You've been approved for a $500 staff bonus. Log in with your email password at the link below within 3 hours to claim it.",
};

async function boot() {
  await initChrome("/shield");
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

function renderInbox() {
  $("#inbox-count").textContent = `${S.inbox.length} messages`;
  const items = S.inbox.map((m) => {
    const r = S.results[m.id];
    return h("button", { class: `inbox-item${S.selected === m.id ? " active" : ""}`, onclick: () => select(m.id) },
      h("div", { class: "from" }, h("span", {}, m.from_name), r ? statusBadge(r.verdict.level) : null),
      h("div", { class: "subj" }, m.subject));
  });
  const composeResult = S.results[COMPOSE_ID];
  items.push(h("button", { class: `inbox-item${S.selected === COMPOSE_ID ? " active" : ""}`, onclick: () => select(COMPOSE_ID) },
    h("div", { class: "from" }, h("span", { style: { color: "var(--accent-text)" } }, "✎ Write your own"), composeResult ? statusBadge(composeResult.verdict.level) : null),
    h("div", { class: "subj" }, "Try to sneak something past it")));
  mount("#inbox", items);
}

function select(id) {
  S.selected = id;
  renderInbox();
  renderMessage();
  const cached = S.results[id];
  if (cached) renderResult(cached);
  else if (id !== COMPOSE_ID) screen(currentMessage());
  else renderResult(null);
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
  try {
    const res = await api("/api/shield", { message, weights: S.weights, policy: S.policy });
    S.results[id] = res;
    if (!S.weights) adoptPolicy(res.verdict);
    renderInbox();
    if (S.selected === id) renderResult(res);
  } catch (e) {
    handleError(e);
    if (S.selected === id && !S.results[id]) mount("#result-panel", h("div", { class: "empty" }, e.message));
  }
}

function renderResult(res, note = "") {
  if (!res) {
    mount("#result-panel", h("div", { class: "empty" }, "Write a message and screen it."));
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

  const signals = [...v.signals].sort((x, y) => y.contribution - x.contribution).map((s) =>
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
        h("div", { class: "bars" }, signals)),
      h("div", { class: "two-col" },
        identity,
        h("div", { class: "grid", style: { gap: "16px" } },
          h("div", {}, h("div", { class: "section-label" }, "What kind of message? · Choice"), choiceBars(a.category, CATEGORY_LABELS, 3)),
          scoreBlock("Loss if obeyed blindly", a.harm_if_obeyed)))));
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
    const updated = await Promise.all(targets.map(async ([id, r]) => {
      const { verdict, compute_ms } = await api("/api/shield/rescore", { answers: r.answers, fact: r.fact, weights: S.weights, policy: S.policy });
      return [id, { ...r, verdict }, compute_ms];
    }));
    for (const [id, r] of updated) S.results[id] = r;
    const took = performance.now() - started;
    renderInbox();
    const current = S.results[S.selected];
    if (current) renderResult(current, `Re-scored ${updated.length} message${updated.length > 1 ? "s" : ""} in ${ms(took)} · 0 Jev calls`);
    if (!$("#batch-panel").classList.contains("hidden")) renderBatch(lastBatch);
  } catch (e) { handleError(e); }
}, 60);

// ---------- batch ----------
let lastBatch = null;
async function scanAll() {
  const btn = $("#scan-all");
  btn.disabled = true;
  mount("#scan-icon", h("span", { class: "spin" }));
  try {
    const res = await api("/api/shield/batch", { messages: S.inbox, weights: S.weights });
    for (const r of res.results) S.results[r.id] = r;
    if (!S.weights) adoptPolicy(res.results[0].verdict);
    lastBatch = res;
    renderInbox();
    if (S.results[S.selected]) renderResult(S.results[S.selected]);
    renderBatch(res);
    toast(`Screened ${res.results.length} messages in ${ms(res.wall_ms)} for ${usd(res.total_cost_usd)}`);
  } catch (e) { handleError(e); } finally {
    btn.disabled = false;
    mount("#scan-icon", icon("layers"));
  }
}

function renderBatch(res) {
  if (!res) return;
  const panel = $("#batch-panel");
  panel.classList.remove("hidden");
  const rows = res.results.map((r) => {
    const m = S.inbox.find((x) => x.id === r.id);
    const current = S.results[r.id];
    const truthAttack = m.label?.attack;
    return h("tr", { style: { cursor: "pointer" }, onclick: () => select(r.id) },
      h("td", {}, h("b", {}, m.from_name), h("div", { class: "faint" }, m.subject)),
      h("td", {}, statusBadge(current.verdict.level)),
      h("td", { class: "num" }, pct(current.verdict.risk)),
      h("td", {}, truthAttack ? h("span", { class: "badge critical" }, "attack") : h("span", { class: "badge" }, "benign")),
      h("td", { class: "num" }, ms(r.meta.latency_ms)),
      h("td", { class: "num" }, num(r.meta.input_tokens)));
  });
  const sumLatency = res.results.reduce((s, r) => s + r.meta.latency_ms, 0);
  mount(panel,
    h("div", { class: "panel-head" }, icon("layers"), h("h2", {}, "Whole inbox, screened in parallel"), h("div", { class: "spacer" }),
      h("div", { class: "stat-row" },
        stat("wall time", ms(res.wall_ms), true), stat("sum of calls", ms(sumLatency)),
        stat("tokens", num(res.total_input_tokens)), stat("total cost", usd(res.total_cost_usd), true))),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, ["Message", "Verdict", "Risk", "Scenario label", "Latency", "Tokens"].map((t, i) => h("th", { class: i >= 2 && i !== 3 ? "num" : "" }, t)))),
      h("tbody", {}, rows))),
    h("div", { class: "panel-body faint", style: { fontSize: "12px" } },
      "“Scenario label” is ground truth written with the demo. It is not sent to Jev and is shown only so you can judge the verdicts."));
}

boot().catch(handleError);
