// Starter pack for the Play page's turn list ("play.history", contract: static/js/lab/surfaces/play.js).
// It reads only the turns of the user's own game in this page session and never asks the model. Nothing here can
// reveal the secret before the game ends: the ctx holds no secret while a game runs, and the transcript names it only
// once ctx.data.secret is set.
import { csvText, definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The reply cut-offs on P(yes) that jev/play.py applies; the ctx carries them as data.rules.
const DEFAULT_CUTS = [0.15, 0.4, 0.6, 0.85];
function cutsOf(ctx) {
  const rules = ctx?.data?.rules;
  const cuts = rules ? [rules.no, rules.probably_not, rules.probably, rules.yes].map(finite) : [];
  return cuts.length === 4 && cuts.every((value) => value !== null) ? cuts : DEFAULT_CUTS;
}

// How far an answered question's P(yes) sat from the nearest cut-off: a small value means a slightly different
// probability would have given another reply. Only answered yes/no questions have one.
function cutoffMargin(item, ctx) {
  const p = item?.kind === "answer" ? finite(item.probs?.answer_is_yes) : null;
  if (p === null) return null;
  return Math.min(...cutsOf(ctx).map((cut) => Math.abs(p - cut)));
}

// Case, punctuation and spacing do not make a question new.
const normalized = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
const playOrder = (items) => items.slice().sort((a, b) => a.n - b.n);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const metaOf = (items, field) => items.map((item) => finite(item?.meta?.[field])).filter((value) => value !== null);

const KIND_LABELS = { answer: "answered question", guess: "wrong or close guess", invalid: "not a yes/no question", win: "winning guess" };

// One mark per turn for the spoiler-free card: the reply's direction, never the question or the secret.
function markOf(item) {
  if (item.kind === "win") return "🎯";
  if (item.kind === "guess") return item.guess === "close" ? "🔶" : "❌";
  if (item.kind === "invalid") return "⬜";
  if (item.answer === "Yes" || item.answer === "Probably") return "🟩";
  if (item.answer === "No" || item.answer === "Probably not") return "🟥";
  if (item.answer === "Hard to say") return "🟨";
  return "·";
}

function statusLine(game) {
  if (!game) return "No game yet";
  const asked = plural(game.asked, "question");
  if (game.outcome === "won") return `Won in ${asked}`;
  if (game.outcome === "gave_up") return `Gave up after ${asked}`;
  if (game.outcome === "out_of_questions") return `Out of questions after ${asked}`;
  return `In progress after ${asked}, ${game.turns_left} left`;
}

const replyCell = (item) => (item.last_question ? item.reply.replace(/ That was your last question\.$/, "") : item.reply);
const cell = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
const running = (ctx) => !!ctx.data?.game && !ctx.data.game.over && !ctx.data.busy;

export default definePack({
  id: "play-history-insights",
  surface: "play.history",
  title: "Turn insights",
  about: "Filters, checks, measurements, exports and shortcuts over the turns of your own 20 Questions game in this page session. "
    + "Nothing reveals or narrows down the secret while a game runs; only the transcript names it, and only after the game ends.",
  features: [
    { id: "yes_p", kind: "fact", type: "number", label: "yes probability", unit: "0 to 1", help: "answer_is_yes for the turn.",
      value: (item) => finite(item?.probs?.answer_is_yes) },
    { id: "question_p", kind: "fact", type: "number", label: "yes/no question probability", unit: "0 to 1", help: "is_yes_no_question for the turn.",
      value: (item) => finite(item?.probs?.is_yes_no_question) },
    { id: "guess_p", kind: "fact", type: "number", label: "guess probability", unit: "0 to 1", help: "names_a_guess for the turn.",
      value: (item) => finite(item?.probs?.names_a_guess) },
    { id: "latency", kind: "fact", type: "number", label: "measured latency", unit: "ms", value: (item) => finite(item?.meta?.latency_ms) },
    { id: "cost", kind: "fact", type: "number", label: "measured cost", unit: "USD", value: (item) => finite(item?.meta?.cost_usd) },
    { id: "words", kind: "fact", type: "number", label: "question word count", unit: "words",
      value: (item) => String(item?.text ?? "").split(/\s+/).filter(Boolean).length || null },
    { id: "cutoff_margin", kind: "fact", type: "number", label: "distance to the nearest reply cut-off", unit: "0 to 1",
      help: "Answered questions only: how far P(yes) sat from 15%, 40%, 60% or 85%.", value: cutoffMargin },
    { id: "borderline", kind: "fact", type: "flag", label: "reply within 5 points of a cut-off",
      help: "Local rule: an answered question whose P(yes) was less than 0.05 from a reply cut-off.",
      // 0.6 - 0.55 is 0.04999999999999993 in floating point, so exactly 5 points away must not count: compare with a tolerance.
      value: (item, ctx) => { const margin = cutoffMargin(item, ctx); return margin !== null && margin < 0.05 - 1e-9; } },
    { id: "question_mark", kind: "fact", type: "flag", label: "question mark at the end",
      value: (item) => /\?\s*$/.test(String(item?.text ?? "")) },
    { id: "repeat", kind: "fact", type: "flag", label: "repeat of an earlier question",
      help: "The same words as an earlier turn of this game, ignoring case and punctuation.",
      value: (item, ctx) => {
        const key = normalized(item?.text);
        return !!key && Number.isInteger(item?.n) && ctx.items().some((other) => other?.n < item.n && normalized(other.text) === key);
      } },
    { id: "kind", kind: "fact", type: "category", label: "turn kind",
      value: (item) => (typeof item?.kind === "string" && Object.hasOwn(KIND_LABELS, item.kind) ? KIND_LABELS[item.kind] : null) },
    { id: "answer", kind: "fact", type: "category", label: "answer given", help: "Answered yes/no questions only.",
      value: (item) => (typeof item?.answer === "string" && item.answer ? item.answer : null) },
    { id: "question_text", kind: "fact", type: "text", label: "question text", value: (item) => (typeof item?.text === "string" ? item.text : "") },

    { id: "not_a_question", kind: "diagnostic", severity: "advice", label: "Not read as a yes/no question",
      check: (item) => {
        if (item?.kind !== "invalid") return null;
        const p = finite(item.probs?.is_yes_no_question);
        return `Jev read this as neither a yes/no question nor a guess${p === null ? "" : ` (P(yes/no question) ${percent(p)})`}. Rephrase it so it can be answered yes or no.`;
      } },
    { id: "hard_to_say", kind: "diagnostic", severity: "info", label: "Hard to say",
      check: (item) => {
        if (item?.answer !== "Hard to say") return null;
        const p = finite(item.probs?.answer_is_yes);
        return `P(yes) was ${p === null ? "between the cut-offs" : percent(p)}, between Probably not and Probably. A narrower question may get a clearer answer.`;
      } },
    { id: "repeats", kind: "diagnostic", severity: "advice", scope: "list", label: "Repeated questions",
      check: (items) => {
        const groups = new Map();
        for (const item of playOrder(items)) {
          const key = normalized(item.text);
          if (!key) continue;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        return [...groups.values()].filter((group) => group.length > 1)
          .map((group) => `“${group[0].text}” was asked ${group.length} times (${group.map((item) => `#${item.n}`).join(", ")}).`);
      } },

    { id: "median_latency", kind: "metric", format: "ms", label: "Median measured latency of the shown turns",
      compute: (ctx) => {
        const values = metaOf(ctx.shown(), "latency_ms").sort((a, b) => a - b);
        if (!values.length) return null;
        const middle = values.length >> 1;
        return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      } },
    { id: "input_tokens", kind: "metric", format: "integer", label: "Input tokens of the shown turns",
      compute: (ctx) => { const values = metaOf(ctx.shown(), "input_tokens"); return values.length ? sum(values) : null; } },
    { id: "yes_share", kind: "metric", format: "percent", label: "Share of shown answers that leaned yes",
      help: "Yes or Probably, among answered yes/no questions.",
      compute: (ctx) => {
        const answered = ctx.shown().filter((item) => item.answer);
        if (!answered.length) return null;
        const yes = answered.filter((item) => item.answer === "Yes" || item.answer === "Probably").length;
        return { value: yes / answered.length, detail: `${yes} of ${answered.length}` };
      } },
    { id: "invalid_count", kind: "metric", format: "integer", label: "Shown turns not read as yes/no questions",
      compute: (ctx) => { const shown = ctx.shown(); return shown.length ? shown.filter((item) => item.kind === "invalid").length : null; } },
    { id: "full_game_estimate", kind: "metric", format: "usd", label: "Estimated cost of a full 20-question game",
      help: "Mean measured cost per turn of this game times 20. An estimate, not spend.",
      compute: (ctx) => {
        const costs = metaOf(ctx.items(), "cost_usd");
        if (!costs.length) return null;
        const turns = finite(ctx.data?.rules?.max_turns) || 20;
        return { value: (sum(costs) / costs.length) * turns, detail: `estimate from ${plural(costs.length, "measured turn")}` };
      } },
    { id: "win_rate", kind: "metric", format: "percent", label: "Win rate of this session's finished games",
      help: "Games that ended this page session, including the current one once it is over. Abandoned games do not count.",
      compute: (ctx) => {
        const outcomes = (Array.isArray(ctx.data?.past) ? ctx.data.past : []).map((game) => game?.outcome);
        if (ctx.data?.game?.over) outcomes.push(ctx.data.game.outcome);
        const finished = outcomes.filter((outcome) => outcome === "won" || outcome === "gave_up" || outcome === "out_of_questions");
        if (!finished.length) return null;
        const won = finished.filter((outcome) => outcome === "won").length;
        return { value: won / finished.length, detail: `${won} of ${plural(finished.length, "game")}` };
      } },

    { id: "transcript_md", kind: "exporter", label: "Game transcript as Markdown",
      help: "the shown turns in play order with your questions and the replies; it names the secret only after the game ends",
      filename: "play-transcript.md", mime: "text/markdown",
      build: (ctx) => {
        const game = ctx.data?.game;
        if (!game) throw new Error("There is no game yet.");
        const lines = [`# 20 Questions · ${game.category || "thing"}`, "", "| # | Question | Reply |", "| --- | --- | --- |",
          ...playOrder(ctx.shown()).map((item) => `| ${item.n} | ${cell(item.text)} | ${cell(replyCell(item))} |`), ""];
        lines.push(game.over && typeof ctx.data.secret === "string" ? `${statusLine(game)}. The secret was **${cell(ctx.data.secret)}**.` : `${statusLine(game)}.`);
        return `${lines.join("\n")}\n`;
      } },
    { id: "turns_csv", kind: "exporter", label: "Shown turns as CSV",
      help: "your questions, the replies, the four probabilities the page shows and measured latency and cost; no secret",
      filename: "play-turns.csv", mime: "text/csv",
      build: (ctx) => csvText([["turn", "question", "kind", "reply", "p_yes", "p_yes_no_question", "p_guess", "p_match", "latency_ms", "cost_usd"],
        ...playOrder(ctx.shown()).map((item) => [item.n, item.text, item.kind ?? "", replyCell(item), item.probs.answer_is_yes ?? "", item.probs.is_yes_no_question ?? "",
          item.probs.names_a_guess ?? "", item.probs.guess_matches ?? "", item.meta.latency_ms ?? "", item.meta.cost_usd ?? ""])]) },
    { id: "result_card", kind: "exporter", label: "Spoiler-free result card",
      help: "the category, the outcome and one mark per turn; no questions and no secret",
      filename: "play-result.txt", mime: "text/plain",
      build: (ctx) => {
        const game = ctx.data?.game;
        if (!game) throw new Error("There is no game yet.");
        const marks = playOrder(ctx.items()).map(markOf).join("");
        return `Jev Lab 20 Questions · ${game.category || "thing"}\n${statusLine(game)}\n${marks}\n`;
      } },

    { id: "focus_question", kind: "command", title: "Focus the question box", group: "Play", keys: "Alt+Shift+Q", when: running,
      run: (ctx) => { if (!ctx.actions.focusQuestion()) ctx.env?.toast?.("The question box is not available right now.", "error"); } },
    { id: "next_suggestion", kind: "command", title: "Put an unasked starter question in the box", group: "Play", keys: "Alt+Shift+S",
      when: (ctx) => running(ctx) && unasked(ctx) !== null,
      run: (ctx) => {
        const next = unasked(ctx);
        if (next === null) throw new Error("Every starter question has been asked in this game.");
        ctx.actions.draftQuestion(next);
      } },
    { id: "edit_last", kind: "command", title: "Put the newest question back in the box to edit", group: "Play",
      when: (ctx) => running(ctx) && ctx.items().length > 0,
      run: (ctx) => {
        const newest = ctx.items().reduce((best, item) => (!best || item.n > best.n ? item : best), null);
        if (!newest) throw new Error("No question has been asked yet.");
        ctx.actions.draftQuestion(newest.text);
      } },
    { id: "copy_questions", kind: "command", title: "Copy this game's questions in play order", group: "Play",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => {
        ctx.env.copy(playOrder(ctx.items()).map((item) => `${item.n}. ${item.text}`).join("\n"));
        ctx.env.toast?.("Copied your questions, without replies.");
      } },
    { id: "inspect_top", kind: "command", title: "Inspect the JSON of the top shown turn", group: "Play",
      when: (ctx) => !!ctx.data?.game?.over && ctx.shown().length > 0,
      run: (ctx) => {
        const [top] = ctx.shown();
        if (!top) throw new Error("No turn is shown.");
        ctx.actions.inspectTurn(top.n);
      } },
  ],
});

// The first starter question this game has not asked yet (ignoring case and punctuation), or null.
function unasked(ctx) {
  const asked = new Set(ctx.items().map((item) => normalized(item.text)));
  const suggestions = Array.isArray(ctx.data?.suggestions) ? ctx.data.suggestions : [];
  return suggestions.find((text) => typeof text === "string" && !asked.has(normalized(text))) ?? null;
}
