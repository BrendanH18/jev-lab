import { api, callStats, debounce, h, handleError, initChrome, inspect, mount } from "./common.js";

// draft: the customer message being typed. It survives re-renders and failed sends; a sent turn or a new chat clears it.
const S = { setup: null, policy: {}, transcript: [], turns: [], decisions: [], sample: null, running: false, rev: 0, note: "", draft: "" };

function reset(sample) {
  S.rev++;
  Object.assign(S, { transcript: [], turns: [], decisions: [], sample, note: "", draft: "" });
  render();
}
function render() {
  mount("#samples", S.setup.examples.map((ex) => h("button", { class: "chip", disabled: S.running, onclick: () => reset(ex) }, ex.label)),
    h("button", { class: "chip", disabled: S.running, onclick: () => reset(null) }, "New chat"));
  mount("#chat", S.turns.length ? S.turns.map((t, i) => h("div", { class: "chat-turn" },
    h("b", {}, `Customer · turn ${i + 1}`), h("p", {}, S.transcript[i * 2].text),
    h("b", {}, "Bot · fixed template"), h("p", {}, S.transcript[i * 2 + 1].text),
    h("p", { class: "muted" }, `Current policy: ${S.decisions[i].action} · ${S.decisions[i].reason}`),
    callStats(t.meta, () => inspect(t.trace, `Counter · turn ${i + 1}`)))) : h("p", { class: "empty" }, "Pick a sample and step through it, or write a customer message."));
  const terminal = S.decisions.at(-1)?.action === "handoff";  // a closed chat may bring a new need; a handoff is final
  const stopped = S.running || S.turns.length >= 20 || terminal;
  const input = h("textarea", { class: "input", maxlength: 2000, "aria-label": "Customer message", disabled: stopped });
  input.value = S.draft;
  input.addEventListener("input", () => { S.draft = input.value; });
  const send = h("button", { class: "btn primary", disabled: stopped, onclick: () => run(input.value, true) }, S.running ? "Reading…" : "Send customer turn");
  const next = S.sample?.turns[S.turns.length];
  mount("#compose", h("p", { class: "muted" }, "Up to 20 customer turns, 2,000 characters each. Each send makes one live call."),
    next ? h("button", { class: "btn", disabled: stopped, onclick: () => run(next) }, `Next sample turn: ${next}`) : null,
    input, send);
  renderResult();
}
async function run(text, typed = false) {
  if (!text.trim() || S.running) return;
  S.running = true;
  render();
  const transcript = [...S.transcript, { speaker: "customer", text }];
  try {
    const r = await api("/api/counter/turn", { transcript, turn_answers: S.turns.map((t) => t.answers), policy: S.policy });
    // The sent reply belongs to the policy used by this call. Subsequent replay never rewrites it.
    S.turns.push(r);
    S.transcript = [...transcript, { speaker: "bot", text: r.decisions.at(-1).text }];
    S.decisions = r.decisions;
    if (typed) S.draft = "";
    S.rev++;
    await decideAgain();
  } catch (e) { handleError(e); } finally { S.running = false; render(); }
}
async function decideAgain() {
  const rev = S.rev;
  if (!S.turns.length) return;
  try {
    const r = await api("/api/counter/decide", { turn_answers: S.turns.map((t) => t.answers), policy: S.policy });
    if (rev !== S.rev) return;
    S.decisions = r.decisions;
    S.note = `Re-decided in ${r.compute_ms} ms · no Jev call`;
    render();
  } catch (e) { handleError(e); }
}
const redecide = debounce(decideAgain, 120);
function renderPolicy() {
  const fields = [
    ["person_at", "Ask for a person at P ≥", 1, 0.05], ["frustration_at", "Frustration at score ≥", 4, 0.1],
    ["streak_turns", "Consecutive frustrated turns", 20, 1], ["missed_at", "Missed the point at P ≥", 1, 0.05],
    ["missed_turns", "Total missed turns", 20, 1], ["intent_min", "Clarify below intent P", 1, 0.05],
    ["resolved_at", "Close at resolved P ≥", 1, 0.05],
  ];
  mount("#policy", fields.map(([key, label, max, step]) => {
    const out = h("output", {}, String(S.policy[key]));
    const input = h("input", { type: "range", min: key.endsWith("turns") ? 1 : 0, max, step, value: S.policy[key], "aria-label": label });
    input.addEventListener("input", () => { S.policy[key] = Number(input.value); out.textContent = input.value; S.rev++; redecide(); });
    return h("div", { class: "slider" }, h("label", {}, label), input, out);
  }), h("button", { class: "btn sm", onclick: () => { S.policy = { ...S.setup.policy }; S.rev++; renderPolicy(); redecide(); } }, "Reset policy"));
}
function renderResult() {
  if (!S.turns.length) return mount("#result", h("p", { class: "empty" }, "Judgments appear after your first call."));
  const series = [["asks_for_person", "Asks for a person", "person_at", 1, "#9966cc"],
    ["frustration", "Frustration / 4", "frustration_at", 4, "#d05a40"],
    ["missed", "Missed the point", "missed_at", 1, "#b18a19"],
    ["resolved", "Resolved", "resolved_at", 1, "#21856a"],
    ["intent_prob", "Top intent", "intent_min", 1, "#377cbd"]];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 520 280"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Judgments per customer turn; dashed lines are policy cuts");
  const add = (tag, attrs, text = "") => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); el.textContent = text; svg.append(el); };
  const x = (i) => 40 + i * 450 / Math.max(1, S.decisions.length - 1);
  const y = (v) => 215 - v * 190;
  add("path", { d: "M40 20V215H500", fill: "none", stroke: "currentColor" });
  [0, 0.5, 1].forEach((v) => add("text", { x: 4, y: y(v), fill: "currentColor", "font-size": 12 }, String(v)));
  series.forEach(([key, label, cut, scale, color]) => {
    add("line", { x1: 40, x2: 500, y1: y(S.policy[cut] / scale), y2: y(S.policy[cut] / scale), stroke: color, "stroke-dasharray": "5 5", opacity: 0.6 });
    add("polyline", { points: S.decisions.map((d, i) => `${x(i)},${y(d.evidence[key] / scale)}`).join(" "), fill: "none", stroke: color, "stroke-width": 2 });
    S.decisions.forEach((d, i) => add("circle", { cx: x(i), cy: y(d.evidence[key] / scale), r: 3, fill: color }));
  });
  S.decisions.forEach((_, i) => add("text", { x: x(i), y: 238, fill: "currentColor", "font-size": 12 }, String(i + 1)));
  add("text", { x: 180, y: 268, fill: "currentColor", "font-size": 12 }, "Customer turn · dashed = cut");
  const cost = S.turns.reduce((n, t) => n + (t.meta.cost_usd || 0), 0);
  const latency = S.turns.reduce((n, t) => n + t.meta.latency_ms, 0);
  mount("#result", svg, h("div", { class: "chips" }, series.map(([, label, , , color]) => h("span", { style: { color } }, label))),
    h("p", {}, `${S.turns.length} calls · $${cost.toFixed(6)} · ${latency.toFixed(0)} ms total`),
    h("p", { class: "muted" }, S.note),
    S.decisions.map((d, i) => h("p", {}, `Turn ${i + 1}: ${d.action} · ${d.reason} Streak ${d.streak}, misses ${d.misses}.`,
      h("small", { class: "muted" }, ` Person ${d.evidence.asks_for_person.toFixed(2)} · frustration ${d.evidence.frustration.toFixed(2)}/4 · missed ${d.evidence.missed.toFixed(2)} · resolved ${d.evidence.resolved.toFixed(2)} · intent ${d.evidence.intent_prob.toFixed(2)}`))));
}
async function boot() {
  await initChrome("/counter"); S.setup = await api("/api/counter/setup"); S.policy = { ...S.setup.policy };
  reset(S.setup.examples[0]); renderPolicy();
}
boot().catch(handleError);
