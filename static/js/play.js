import { $, api, h, handleError, icon, initChrome, inspect, mount, ms, pct, toast, usd } from "./common.js";
import { installLab, labEnv } from "./lab/env.js";
import { LAB } from "./lab/pages/play.js";
import { playHistoryCtx } from "./lab/surfaces/play.js";

const S = { game: null, busy: false };
const SUGGESTIONS = ["Is it alive?", "Is it bigger than a car?", "Can you eat it?", "Is it man-made?", "Would I find it in a kitchen?", "Does it have wheels?"];

// Lab surface "play.history": the turns of the current game (contract in static/js/lab/surfaces/play.js). The ctx
// reads everything at call time, so one serves the whole page session. Packs can fill the question box but never
// send a question, and they get the secret and the traces only once the game is over.
const HISTORY_ID = "play.history";
const HISTORY = playHistoryCtx({
  game: () => S.game,
  busy: () => S.busy,
  suggestions: SUGGESTIONS,
  matches: (item, ctx) => LAB.matches(HISTORY_ID, item, ctx),
  arrange: (items, ctx) => LAB.arrange(HISTORY_ID, items, ctx),
  refresh: () => renderTurns(),
  draft: (text) => {
    const input = $("#ask-input");
    if (!input || input.disabled) return false;
    input.value = text;
    input.focus();
    return true;
  },
  focusAsk: () => {
    const input = $("#ask-input");
    if (!input || input.disabled) return false;
    input.focus();
    return true;
  },
  newGame: () => newGame(),
  giveUp: () => giveUp(),
  inspect: (trace, title) => inspect(trace, title),
});

async function boot() {
  await initChrome("/play");
  installLab(LAB);
  render();
  await newGame();
}

async function newGame() {
  try {
    S.game = await api("/api/play/new", {});
    render();
    $("#ask-input")?.focus();
  } catch (e) { handleError(e); }
}

async function ask(text) {
  text = (text || "").trim();
  if (!text || S.busy || !S.game || S.game.over) return;
  S.busy = true;
  render();
  try {
    S.game = await api("/api/play/ask", { id: S.game.id, text });
  } catch (e) { handleError(e); } finally {
    S.busy = false;
    render();
    $("#ask-input")?.focus();
  }
}

async function giveUp() {
  try { S.game = await api("/api/play/giveup", { id: S.game.id }); render(); } catch (e) { handleError(e); }
}

function toneFor(turn) {
  if (turn.kind === "win") return "win";
  if (turn.kind === "invalid" || turn.kind === "guess") return "";
  if (turn.reply === "Yes" || turn.reply === "Probably") return "yes";
  if (turn.reply === "No" || turn.reply === "Probably not") return "no";
  return "maybe";
}

function turnNode(t) {
  return h("div", { class: "turn pop" },
    h("span", { class: "n" }, `#${t.n}`), h("span", { class: "q" }, t.text), h("span", { class: `r ${toneFor(t)}` }, t.reply),
    h("div", { class: "probs" },
      h("span", { title: "answer_is_yes" }, `P(yes) ${pct(t.probs.answer_is_yes)}`),
      h("span", { title: "is_yes_no_question" }, `yes/no-question ${pct(t.probs.is_yes_no_question)}`),
      h("span", { title: "names_a_guess" }, `guess ${pct(t.probs.names_a_guess)}`),
      t.probs.names_a_guess >= 0.6 ? h("span", { title: "guess_matches" }, `match ${pct(t.probs.guess_matches)}`) : null,
      h("span", {}, ms(t.meta.latency_ms))));
}

// The turns to list: newest first, minus what a Lab filter hides, in Lab's sort order when one is set.
function shownTurns() {
  const byNumber = new Map((S.game?.turns || []).map((turn) => [turn.n, turn]));
  return HISTORY.shown().map((item) => byNumber.get(item.n)).filter(Boolean);
}

function resetLab() {
  LAB.reset(HISTORY_ID);
  renderTurns();
  $(`[data-lab-surface="${HISTORY_ID}"]`)?.replaceWith(LAB.section(labEnv, HISTORY_ID, HISTORY));
}

// Fills the turn list. Lab's refresh() calls this alone, so the question box keeps its text and focus.
function renderTurns() {
  const box = $("#turns");
  if (!box || !S.game) return;
  const turns = shownTurns();
  const total = S.game.turns.length, active = LAB.active(HISTORY_ID);
  mount(box,
    active && total ? h("div", { class: "faint", role: "status", style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px" } },
      `Showing ${turns.length} of ${total} question${total === 1 ? "" : "s"}: ${active} Lab filter or sort setting${active === 1 ? " is" : "s are"} active.`,
      h("button", { class: "btn ghost sm", onclick: resetLab }, "Show all, newest first")) : null,
    turns.map(turnNode));
}

function render() {
  const g = S.game;
  if (!g) return mount("#board", h("div", { class: "empty" }, h("span", { class: "spin" }), " Picking a secret…"));
  const cost = g.turns.reduce((s, t) => s + (t.meta?.cost_usd || 0), 0);
  const avg = g.turns.length ? g.turns.reduce((s, t) => s + (t.meta?.latency_ms || 0), 0) / g.turns.length : 0;
  const input = h("input", { id: "ask-input", class: "input", placeholder: g.over ? "Game over" : "Ask a yes/no question, or name your guess…", disabled: g.over || S.busy, autocomplete: "off" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { ask(input.value); input.value = ""; } });
  mount("#board",
    h("div", { style: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" } },
      h("div", { class: "thinking" }, "I'm thinking of ", h("em", {}, /^[aeiou]/i.test(g.category) ? `an ${g.category}` : `a ${g.category}`), "."),
      h("div", { style: { flex: 1 } }),
      h("span", { class: "stat" }, "questions left", h("b", {}, String(g.turns_left))),
      g.turns.length ? h("span", { class: "stat" }, "avg", h("b", {}, ms(avg))) : null,
      g.turns.length ? h("span", { class: "stat" }, "game cost", h("b", {}, usd(cost))) : null),
    g.over ? h("div", { class: "ends pop" },
      h("div", {}, g.won ? "🎉 You got it in " + g.turns.length + (g.turns.length === 1 ? " question." : " questions.") : "It was:"),
      h("div", { class: "secret" }, g.secret),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        h("button", { class: "btn primary", onclick: newGame }, icon("play"), "Play again"),
        g.traces?.length ? h("button", { class: "btn", onclick: () => inspect(g.traces[g.traces.length - 1], "Play · last turn (secret now revealed)") }, icon("code"), "Inspect a turn's JSON") : null))
      : h("div", { class: "ask" }, input, h("button", { class: "btn primary", disabled: S.busy, onclick: () => { ask(input.value); input.value = ""; } }, S.busy ? h("span", { class: "spin" }) : icon("send"), "Ask")),
    !g.over && g.turns.length === 0 ? h("div", { class: "chips" }, SUGGESTIONS.map((s) => h("button", { class: "chip", onclick: () => ask(s) }, s))) : null,
    h("div", { class: "turns", id: "turns" }),
    !g.over ? h("div", { style: { display: "flex", gap: "8px" } },
      h("button", { class: "btn ghost sm", onclick: giveUp }, "Give up & reveal"),
      h("button", { class: "btn ghost sm", onclick: newGame }, icon("reset"), "New game")) : null,
    LAB.section(labEnv, HISTORY_ID, HISTORY));
  renderTurns();
}

boot().catch(handleError);
