import {
  $, $$, api, barRow, currentStatus, h, handleError, icon, initChrome, inspect, money, mount, ms, num, pct, stat, statusBadge,
  toast, usd,
} from "./common.js";
import { installLab, labEnv } from "./lab/env.js";
import { LAB } from "./lab/pages/autopilot.js";
import { autopilotBenchmarkCtx, autopilotInboxCtx, autopilotRecordsCtx } from "./lab/surfaces/autopilot.js";

// benchRuns: the benchmark results of this page load, oldest first (memory only); bench is the latest one.
const S = { inbox: [], records: {}, worlds: null, running: false, activeId: null, bench: null, benchRuns: [], benchBusy: false };
const BENCH_RUNS_KEPT = 20;

// Lab surfaces of this page (contract: static/js/lab/surfaces/autopilot.js). Each ctx reads S at call time, so one
// serves the whole page session. Lab filters and sorts change only what the email list shows: Run and Next still
// process every waiting email in scenario order.
const RECORDS_ID = "autopilot.records";
const INBOX_ID = "autopilot.inbox";
const BENCH_ID = "autopilot.benchmark";
const emailSource = {
  inbox: () => S.inbox, records: () => S.records, worlds: () => S.worlds, running: () => S.running, activeId: () => S.activeId,
  status: () => currentStatus(), reset: () => reset(), refresh: () => renderRows(),
};
const RECORDS = autopilotRecordsCtx({ ...emailSource,
  matches: (item, ctx) => LAB.matches(RECORDS_ID, item, ctx), arrange: (items, ctx) => LAB.arrange(RECORDS_ID, items, ctx),
  resolve: (id, approve) => resolve(id, approve),
  inspect: (id) => inspect(S.records[id].trace, `Autopilot · ${S.inbox.find((m) => m.id === id)?.subject ?? S.records[id].message?.subject ?? id}`) });
const INBOX = autopilotInboxCtx({ ...emailSource,
  matches: (item, ctx) => LAB.matches(INBOX_ID, item, ctx), arrange: (items, ctx) => LAB.arrange(INBOX_ID, items, ctx) });
const BENCH = autopilotBenchmarkCtx({ runs: () => S.benchRuns, busy: () => S.benchBusy, inbox: () => S.inbox, status: () => currentStatus(),
  refresh: () => { if (S.bench) renderBench(); } });

const SIGNAL_SHORT = {
  ai_instructions: "AI injection", credential_request: "credential ask", payment_change: "payment redirect",
  secrecy_or_bypass: "secrecy", link_lure: "link lure", unexpected_reward: "reward bait", pressure: "pressure",
  identity_mismatch: "domain mismatch",
};

async function boot() {
  await initChrome("/autopilot");
  installLab(LAB);
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
  renderLab();
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
  renderLab();
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
  renderLab();
}

async function resolve(id, approve) {
  try {
    const { record, worlds } = await api("/api/autopilot/resolve", { id, approve });
    S.records[id] = record;
    S.worlds = worlds;
    render();
    renderLab();
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
// The tally over every record of this server run lives in the Lab surface module (data.tally), so packs and the
// scoreboard count the same way. Lab filters never change it.
function renderScores() {
  const t = RECORDS.data.tally;
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
      h("div", { class: "score-head" }, icon("bolt"), h("h2", {}, "Dispatch alone"), h("span", { class: "sub" }, "same answers, no Shield, no idea who sent the email")),
      h("div", { class: "tiles" },
        tile("Actions run", String(t.naiveRuns)),
        tile("Harmful actions", String(t.harmN), "per the scenario labels", t.harmN ? "bad" : ""),
        tile("Money to wrong parties", money(t.lostN), null, t.lostN ? "bad" : ""),
        tile("Real work blocked", String(t.legitBlockedN), "legit actions rejected because of an earlier mistake", t.legitBlockedN ? "bad" : ""))));
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
    (m.attachments || []).map((att) => h("div", { class: "attachment" },
      h("img", { src: `/img/samples/${att.sample}.png`, alt: `Attached photo ${att.name}` }),
      h("div", {}, h("div", { class: "mono" }, att.name),
        r?.photo ? h("div", { class: "faint" }, `damage ${pct(r.photo.evidence.damage)} · matches ${pct(r.photo.evidence.matches_note)}`)
          : h("div", { class: "faint" }, "sent with the email")))),
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

// The emails to list: every email in scenario order, minus what Lab filters hide. A Lab sort reorders the processed
// emails among the places processed emails hold, and the waiting ones among theirs. With no Lab filter or sort this
// is S.inbox exactly. The email being processed is always shown (autopilotInboxCtx keeps it).
function shownMessages() {
  const done = RECORDS.shown().map((item) => item.id);
  const waiting = INBOX.shown().map((item) => item.id);
  const keep = new Set([...done, ...waiting]);
  const byId = new Map(S.inbox.map((m) => [m.id, m]));
  return S.inbox.filter((m) => keep.has(m.id)).map((m) => byId.get((S.records[m.id] ? done : waiting).shift())).filter(Boolean);
}

function clearLab() {
  LAB.reset(RECORDS_ID);
  LAB.reset(INBOX_ID);
  renderRows();
  renderLab();
}

// The email list and its "Showing x of y" note. Lab's refresh() calls this alone, so typing in a Lab control keeps focus.
function renderRows() {
  const shown = shownMessages();
  const active = LAB.active(RECORDS_ID) + LAB.active(INBOX_ID);
  mount("#rows", S.inbox.length && !shown.length ? h("div", { class: "empty" }, "No email matches the Lab filters.") : shown.map(renderRow));
  const note = $("#rows-note");
  note.classList.toggle("hidden", !active);
  mount(note, active ? h("div", { class: "faint", role: "status", style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px" } },
    `Showing ${shown.length} of ${S.inbox.length} emails · ${active} Lab setting${active === 1 ? "" : "s"} active. Run and Next still process every waiting email in order.`,
    h("button", { class: "btn sm ghost", onclick: clearLab }, "Clear Lab filters and sort")) : null);
}

// The Lab tools of the three surfaces. Rendered again when the data changes (an email processed or resolved, a reset,
// a benchmark), not while a call is in flight, so their metrics read the new results.
function renderLab() {
  for (const [id, ctx, slot, title] of [[RECORDS_ID, RECORDS, "#records-lab", "Lab tools · processed emails"], [INBOX_ID, INBOX, "#inbox-lab", "Lab tools · waiting emails"],
    [BENCH_ID, BENCH, "#bench-lab", "Lab tools · benchmark"]]) {
    const section = LAB.section(labEnv, id, ctx, { title });
    $(slot).classList.toggle("hidden", !section);
    mount(slot, section);
  }
}

function render() {
  renderScores();
  renderRows();
  renderLedgers();
}

// ---------- benchmark ----------
async function benchmark() {
  if (S.benchBusy) return;
  const btn = $("#bench-btn");
  btn.disabled = true;
  S.benchBusy = true;
  mount(btn, h("span", { class: "spin" }), "Measuring…");
  const model = currentStatus()?.model || null;
  try {
    S.bench = await api("/api/autopilot/benchmark", { id: "bec-invoice" });
    S.benchRuns.push({ run: (S.benchRuns.at(-1)?.run || 0) + 1, at: Date.now(), model, id: "bec-invoice", ...S.bench });
    if (S.benchRuns.length > BENCH_RUNS_KEPT) S.benchRuns.shift();
    renderBench();
  } catch (e) { handleError(e); } finally {
    S.benchBusy = false;
    btn.disabled = false;
    mount(btn, "Run again");
    renderLab();
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
