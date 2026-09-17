import {
  $, $$, api, barRow, h, handleError, icon, initChrome, inspect, money, mount, ms, num, pct, stat, statusBadge,
  toast, usd,
} from "./common.js";

const S = { inbox: [], records: {}, worlds: null, running: false, activeId: null, bench: null };

const SIGNAL_SHORT = {
  ai_instructions: "AI injection", credential_request: "credential ask", payment_change: "payment redirect",
  secrecy_or_bypass: "secrecy", link_lure: "link lure", unexpected_reward: "reward bait", pressure: "pressure",
  identity_mismatch: "domain mismatch",
};

async function boot() {
  await initChrome("/autopilot");
  $$("icon-slot").forEach((el) => el.replaceWith(icon(el.dataset.i)));
  mount("#run", icon("play"), "Run the inbox");
  mount("#step", icon("arrow"), "Next email");
  mount("#reset", icon("reset"), "Reset");
  const [{ inbox }, state] = await Promise.all([api("/api/scenarios"), api("/api/autopilot/state")]);
  S.inbox = inbox;
  for (const r of state.records) S.records[r.id] = r;
  S.worlds = { integrated: state.integrated, naive: state.naive };
  $("#run").addEventListener("click", runAll);
  $("#step").addEventListener("click", step);
  $("#reset").addEventListener("click", reset);
  $("#bench-btn").addEventListener("click", benchmark);
  render();
}

const nextMessage = () => S.inbox.find((m) => !S.records[m.id]);

async function processOne(message) {
  S.activeId = message.id;
  render();
  const { record, worlds } = await api("/api/autopilot/process", { id: message.id });
  S.records[record.id] = record;
  S.worlds = worlds;
  S.activeId = null;
  render();
  return record;
}

async function step() {
  const m = nextMessage();
  if (!m) return toast("Inbox done. Reset to run it again.");
  setBusy(true);
  try { await processOne(m); } catch (e) { handleError(e); } finally { setBusy(false); }
}

async function runAll() {
  setBusy(true);
  const started = performance.now();
  let calls = 0;
  try {
    for (let m = nextMessage(); m; m = nextMessage()) {
      await processOne(m);
      calls++;
      await new Promise((r) => setTimeout(r, 250)); // pause briefly so you can follow along
    }
    if (calls) toast(`Processed ${calls} emails with ${calls} Jev calls in ${ms(performance.now() - started)} (including animation pauses)`);
  } catch (e) { handleError(e); } finally { setBusy(false); }
}

async function reset() {
  const state = await api("/api/autopilot/reset", {});
  S.records = {};
  S.worlds = { integrated: state.integrated, naive: state.naive };
  render();
}

async function resolve(id, approve) {
  try {
    const { record, worlds } = await api("/api/autopilot/resolve", { id, approve });
    S.records[id] = record;
    S.worlds = worlds;
    render();
    toast(approve ? (record.integrated.executed ? `✓ ${record.integrated.executed.text}` : record.integrated.error || "Nothing to run") : "Dismissed");
  } catch (e) { handleError(e); }
}

function setBusy(on) {
  S.running = on;
  $("#run").disabled = on;
  $("#step").disabled = on;
  $("#reset").disabled = on;
}

// ---------- scoring ----------
function tally() {
  const recs = Object.values(S.records);
  const t = {
    processed: recs.length, calls: recs.length, cost: 0, latency: 0,
    auto: 0, needs: 0, quarantined: 0, ignored: 0, harmI: 0, lostI: 0,
    naiveRuns: 0, harmN: 0, lostN: 0, legitBlockedN: 0,
  };
  for (const r of recs) {
    t.cost += r.meta.cost_usd;
    t.latency += r.meta.latency_ms;
    const I = r.integrated;
    const lane = I.lane;
    if (lane === "quarantine") t.quarantined++;
    else if (lane === "ignored") t.ignored++;
    else if (I.approved || I.dismissed) t.needs++;
    else if (lane === "handled") t.auto++;
    else t.needs++;
    const attack = r.label?.attack;
    if (I.executed && attack) { t.harmI++; t.lostI += I.executed.amount || 0; }
    if (r.naive.executed) {
      t.naiveRuns++;
      if (attack) { t.harmN++; t.lostN += r.naive.executed.amount || 0; }
    }
    if (!attack && r.naive.plan.decision === "reject") t.legitBlockedN++;
  }
  return t;
}

function renderScores() {
  const t = tally();
  const tile = (k, v, s, cls = "") => h("div", { class: `tile ${cls}` }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), s ? h("div", { class: "s" }, s) : null);
  mount("#scores",
    h("div", { class: "panel" },
      h("div", { class: "score-head" }, icon("shield"), h("h2", {}, "Autopilot"), h("span", { class: "sub" }, "Shield + Dispatch in one call"),
        h("div", { style: { flex: 1 } }), t.processed ? h("div", { class: "stat-row" }, stat("calls", t.calls), stat("avg", ms(t.latency / t.processed), true), stat("spent", usd(t.cost))) : null),
      h("div", { class: "tiles" },
        tile("Handled automatically", String(t.auto), `${t.ignored} ignored as no-action`, "goodv"),
        tile("Needs you", String(t.needs), "action pre-filled"),
        tile("Quarantined", String(t.quarantined)),
        tile("Harmful actions", String(t.harmI), t.lostI ? `${money(t.lostI)} lost` : "$0 lost", t.harmI ? "bad" : "goodv"))),
    h("div", { class: "panel" },
      h("div", { class: "score-head" }, icon("bolt"), h("h2", {}, "Dispatch alone"), h("span", { class: "sub" }, "same answers, trusts every email like a command from the owner")),
      h("div", { class: "tiles" },
        tile("Actions run", String(t.naiveRuns)),
        tile("Harmful actions", String(t.harmN), "per the scenario labels", t.harmN ? "bad" : ""),
        tile("Money to wrong parties", money(t.lostN), null, t.lostN ? "bad" : ""),
        tile("Real work blocked", String(t.legitBlockedN), "e.g. real invoice already paid to the fraudster", t.legitBlockedN ? "bad" : ""))));
}

// ---------- rows ----------
function describeOutcome(side, rec) {
  const plan = side.plan;
  const parts = [];
  if (plan.tool !== "none") parts.push(h("div", { class: "sig", title: plan.signature }, plan.signature));
  if (side.executed) parts.push(h("div", { class: "ok-note" }, "✓ ", side.executed.text));
  if (side.error) parts.push(h("div", { class: "why" }, "Error: ", side.error));
  return parts;
}

function renderRow(m) {
  const r = S.records[m.id];
  const active = S.activeId === m.id;
  const emailCell = h("div", { class: "cell" },
    h("div", { class: "from" }, m.from_name),
    h("div", { class: "addr" }, m.from_email),
    h("div", { class: "subj", title: m.body }, m.subject),
    m.label?.attack ? h("span", { class: "badge critical", style: { justifySelf: "start", fontSize: "10.5px" }, title: "Scenario ground truth. Not sent to Jev." }, "scenario: attack") : null);

  if (!r) {
    return h("div", { class: `row ${active ? "active" : "queued"}` }, emailCell,
      h("div", { class: "cell" }, active ? h("span", { class: "muted" }, h("span", { class: "spin" }), " one Jev call…") : h("span", { class: "faint" }, "queued")),
      h("div", {}), h("div", {}));
  }

  const v = r.shield.verdict;
  const shieldCell = h("div", { class: "cell" },
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      statusBadge(v.level), h("span", { class: "mono faint", style: { fontSize: "12px" } }, `risk ${pct(v.risk)}`)),
    v.drivers.length ? h("div", { class: "drivers" }, v.drivers.map((d) => h("span", {}, SIGNAL_SHORT[d]))) : null,
    v.rules.length ? h("div", { class: "why" }, v.rules[0].text) : null,
    h("div", { class: "stat-row" },
      h("button", { class: "stat", style: { cursor: "pointer" }, onclick: () => inspect(r.trace, `Autopilot · ${m.subject}`), title: "Inspect the request" },
        `${r.meta.question_count} Q`, h("b", {}, ms(r.meta.latency_ms)), usd(r.meta.cost_usd))));

  const I = r.integrated;
  const laneKind = I.approved ? "handled" : I.dismissed ? "none" : I.lane;
  const laneLabel = I.approved ? "Approved by you" : I.dismissed ? "Dismissed" : null;
  const integratedCell = h("div", { class: "cell" },
    h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
      statusBadge(laneKind === "quarantine" ? "quarantine" : laneKind, laneLabel)),
    I.lane === "quarantine"
      ? h("div", { class: "why" }, "Nothing was run. Dispatch's proposed action was blocked: ", h("span", { class: "mono" }, I.plan.signature))
      : describeOutcome(I, r),
    !I.executed && I.lane !== "quarantine" && I.plan.reasons?.length ? h("div", { class: "why" }, h("ul", {}, I.plan.reasons.slice(0, 3).map((x) => h("li", {}, x)))) : null,
    I.lane === "needs_you" && !I.resolved ? h("div", { style: { display: "flex", gap: "6px" } },
      I.plan.tool !== "none" && !I.plan.missing.length ? h("button", { class: "btn sm good", onclick: () => resolve(r.id, true) }, icon("check"), "Approve") : null,
      h("button", { class: "btn sm", onclick: () => resolve(r.id, false) }, "Dismiss")) : null);

  const N = r.naive;
  const harmful = N.executed && r.label?.attack;
  const naiveCell = h("div", { class: "cell" },
    statusBadge(N.executed ? "execute" : N.plan.decision, N.executed ? "Ran it" : null),
    N.plan.tool !== "none" ? h("div", { class: "sig", title: N.plan.signature }, N.plan.signature) : null,
    N.executed
      ? h("div", { class: harmful ? "harm" : "ok-note" }, harmful ? h("b", {}, "✗ Harmful: ") : "✓ ", N.executed.text,
        harmful && N.executed.destination === "new account from the email" ? h("div", {}, "Sent to the bank account the attacker supplied.") : null)
      : h("div", { class: "why" }, (N.plan.reasons || []).slice(0, 2).join(" · ")));

  return h("div", { class: `row pop${active ? " active" : ""}` }, emailCell, shieldCell, integratedCell, naiveCell);
}

function renderLedgers() {
  const w = S.worlds;
  if (!w) return;
  const recs = Object.values(S.records);
  const harmfulTexts = new Set(recs.filter((r) => r.label?.attack && r.naive.executed).map((r) => r.naive.executed.text));
  const book = (title, world, isNaive) => h("div", {},
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" } },
      h("b", {}, title), h("span", { class: "mono" }, money(world.balance))),
    world.activity.length
      ? h("div", { class: "ledger" }, world.activity.map((a) => h("div", { class: isNaive && harmfulTexts.has(a.text) ? "bad" : "" }, h("span", {}, a.text))))
      : h("div", { class: "faint", style: { fontSize: "12px" } }, "No actions yet"));
  mount("#ledgers", book("Autopilot", w.integrated, false), book("Dispatch alone", w.naive, true));
}

function render() {
  renderScores();
  mount("#rows", S.inbox.map(renderRow));
  renderLedgers();
}

// ---------- benchmark ----------
async function benchmark() {
  const btn = $("#bench-btn");
  btn.disabled = true;
  mount(btn, h("span", { class: "spin" }), "Measuring…");
  try {
    S.bench = await api("/api/autopilot/benchmark", { id: "bec-invoice" });
    renderBench();
  } catch (e) { handleError(e); } finally {
    btn.disabled = false;
    mount(btn, "Run again");
  }
}

function renderBench() {
  const b = S.bench;
  const modes = [["sequential", "2 calls, in turn"], ["parallel", "2 calls, parallel"], ["merged", "1 merged call"]];
  const chart = (title, key, fmt) => {
    const max = Math.max(...modes.map(([k]) => b[k][key])) || 1;
    return h("div", {}, h("div", { class: "section-label" }, title),
      h("div", { class: "bars" }, modes.map(([k, label]) => barRow(label, b[k][key] / max, { top: k === "merged", valueText: fmt(b[k][key]) }))));
  };
  const btn = $("#bench-btn");
  mount("#bench",
    h("p", { class: "muted", style: { fontSize: "12.5px" } }, `Same ${b.merged.questions} questions, same email, measured just now.`),
    h("div", { class: "bench-chart" },
      chart("Wall-clock time", "wall_ms", ms),
      chart("Input tokens (billed)", "input_tokens", num),
      chart("Requests", "requests", String)),
    h("p", { class: "faint", style: { fontSize: "12px" } },
      `The merged call sends the email once, so it saves ${num(b.sequential.input_tokens - b.merged.input_tokens)} tokens compared with two calls. Latency varies from run to run over the network, so try it a few times.`),
    btn);
}

boot().catch(handleError);
