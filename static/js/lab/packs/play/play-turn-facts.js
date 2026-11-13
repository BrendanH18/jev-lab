// More facts and questioning-style checks for the Play page's turn list ("play.history", contract:
// static/js/lab/surfaces/play.js). Everything is read from the turns of the user's own game in this page session; no
// feature reads data.secret or data.traces, and the match probability is used only where the ctx releases it (guess
// turns while the game runs, every turn once it is over), so nothing here can hint at the secret.
import { definePack } from "../../kit.js";
import { codePoints } from "../../lib/text.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const textOf = (item) => (typeof item?.text === "string" ? item.text : "");
const playOrder = (items) => items.slice().sort((a, b) => a.n - b.n);

// The cut-offs jev/play.py applies, read from data.rules when the ctx carries them.
const DEFAULT_RULES = { guess: 0.6, match: 0.7, mismatch: 0.3, yes_no_question: 0.5, max_turns: 20 };
function rule(ctx, name) {
  const value = finite(ctx?.data?.rules?.[name]);
  return value === null ? DEFAULT_RULES[name] : value;
}

// Case, punctuation and spacing do not make a question different.
const normalized = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");

// The auxiliary verbs a yes/no question usually opens with; anything else is "other". A negative contraction counts
// as its verb ("Doesn't" is Does, "Can't" is Can, "Won't" is Will).
const OPENERS = new Set(["is", "are", "was", "were", "does", "do", "did", "can", "could", "would", "will", "should", "has", "have", "had"]);
const CONTRACTED = { ca: "can", wo: "will" };
function openerOf(item) {
  const first = textOf(item).trim().split(/\s+/)[0] || "";
  const letters = first.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}']/gu, "");
  if (!letters.replace(/'/g, "")) return null;
  const stem = letters.replace(/n't$/, "");
  const word = stem === letters ? letters : CONTRACTED[stem] || stem;
  return OPENERS.has(word) ? word[0].toUpperCase() + word.slice(1) : "other";
}

const YES_LEANING = new Set(["Yes", "Probably"]);
const answered = (item) => item?.kind === "answer";
const guessing = (item) => item?.kind === "guess" || item?.kind === "win";

export default definePack({
  id: "play-turn-facts",
  surface: "play.history",
  title: "Turn facts",
  about: "More numbers, flags and questioning-style checks for each turn of your own 20 Questions game: certainty, distances "
    + "to the guess, yes/no and match cut-offs, length, tokens and turn number. Nothing reads the secret, and the match "
    + "probability counts only where the page already shows it.",
  features: [
    { id: "match_p", kind: "fact", type: "number", label: "match probability", unit: "0 to 1",
      help: "guess_matches for the turn: guess turns while the game runs, every turn once it is over.",
      value: (item) => finite(item?.probs?.guess_matches) },
    { id: "certainty", kind: "fact", type: "number", label: "yes/no certainty", unit: "0 to 1",
      help: "Answered questions only: |P(yes) − 0.5| × 2, so 0 is a coin flip and 1 is a sure Yes or No.",
      value: (item) => { const p = answered(item) ? finite(item.probs?.answer_is_yes) : null; return p === null ? null : Math.abs(p - 0.5) * 2; } },
    { id: "guess_cut_distance", kind: "fact", type: "number", label: "distance to the guess cut-off", unit: "0 to 1",
      help: "How far P(guess) sat from the 60% at which a turn counts as a guess.",
      value: (item, ctx) => { const p = finite(item?.probs?.names_a_guess); return p === null ? null : Math.abs(p - rule(ctx, "guess")); } },
    { id: "question_cut_distance", kind: "fact", type: "number", label: "distance to the yes/no question cut-off", unit: "0 to 1",
      help: "Answered and unread turns only: how far P(yes/no question) sat from the 50% below which a turn is not read as a question.",
      value: (item, ctx) => {
        const p = item?.kind === "answer" || item?.kind === "invalid" ? finite(item.probs?.is_yes_no_question) : null;
        return p === null ? null : Math.abs(p - rule(ctx, "yes_no_question"));
      } },
    { id: "match_cut_distance", kind: "fact", type: "number", label: "distance to the nearest match cut-off", unit: "0 to 1",
      help: "Guess turns only: how far P(match) sat from 70% (a win) or 30% (a wrong guess), whichever is nearer.",
      value: (item, ctx) => {
        const p = guessing(item) ? finite(item.probs?.guess_matches) : null;
        return p === null ? null : Math.min(Math.abs(p - rule(ctx, "match")), Math.abs(p - rule(ctx, "mismatch")));
      } },
    { id: "chars", kind: "fact", type: "number", label: "question length in characters", unit: "characters",
      value: (item) => (textOf(item).trim() ? codePoints(textOf(item)) : null) },
    { id: "input_tokens", kind: "fact", type: "number", label: "input tokens", unit: "tokens", help: "Measured input tokens of the turn's call.",
      value: (item) => (Number.isInteger(item?.meta?.input_tokens) ? item.meta.input_tokens : null) },
    { id: "turn_number", kind: "fact", type: "number", label: "turn number", help: "Sort ascending for play order.",
      value: (item) => (Number.isInteger(item?.n) ? item.n : null) },

    { id: "negated", kind: "fact", type: "flag", label: "negated question", help: "Contains not, never, cannot or n't, which turns the yes/no meaning around.",
      value: (item) => /\b(?:not|never|cannot)\b|n['’]t\b/i.test(textOf(item)) },
    { id: "compound", kind: "fact", type: "flag", label: "compound question", help: "Contains and or or, so one answer covers two things.",
      value: (item) => /\b(?:and|or)\b/i.test(textOf(item)) },
    { id: "starter", kind: "fact", type: "flag", label: "starter question", help: "One of the page's starter questions, ignoring case and punctuation.",
      value: (item, ctx) => {
        const key = normalized(textOf(item));
        const suggestions = Array.isArray(ctx?.data?.suggestions) ? ctx.data.suggestions : [];
        return !!key && suggestions.some((text) => normalized(text) === key);
      } },
    { id: "after_yes", kind: "fact", type: "flag", label: "asked right after a yes-leaning answer",
      help: "The turn before it was answered Yes or Probably.",
      value: (item, ctx) => ctx.items().some((other) => other?.n === item?.n - 1 && YES_LEANING.has(other.answer)) },
    { id: "opener", kind: "fact", type: "category", label: "question opener",
      help: "The first word when it is an auxiliary verb (Is, Does, Can, Would, …), otherwise other.", value: openerOf },

    { id: "weak_yes_no", kind: "diagnostic", severity: "advice", label: "Barely read as a yes/no question",
      help: "Local rule: an answered turn whose P(yes/no question) was under 70%.",
      check: (item) => {
        const p = answered(item) ? finite(item.probs?.is_yes_no_question) : null;
        if (p === null || p >= 0.7) return null;
        return `Answered, but only ${percent(p)} read as a yes/no question, so the reply may not mean what you asked. A plainer “Is it …?” form reads more reliably.`;
      } },
    { id: "invalid_streak", kind: "diagnostic", severity: "advice", scope: "list", label: "Several unread turns in a row",
      help: "Three or more consecutive turns that were neither a yes/no question nor a guess.",
      check: (items) => {
        const runs = [];
        let run = [];
        for (const item of playOrder(items)) {
          const continues = run.length && item.n === run[run.length - 1].n + 1;
          if (item.kind === "invalid" && (continues || !run.length)) run.push(item);
          else {
            if (run.length >= 3) runs.push(run);
            run = item.kind === "invalid" ? [item] : [];
          }
        }
        if (run.length >= 3) runs.push(run);
        return runs.map((group) => `Turns #${group[0].n} to #${group[group.length - 1].n} in a row were not read as yes/no questions. Ask something that can be answered yes or no.`);
      } },
    { id: "late_no_guess", kind: "diagnostic", severity: "advice", scope: "list", label: "No guess yet near the end",
      help: "The game runs with 3 or fewer questions left and no turn of it names a guess, shown or hidden by a filter.",
      check: (items, ctx) => {
        const game = ctx?.data?.game;
        if (!game || game.over || !Number.isInteger(game.turns_left) || game.turns_left < 1 || game.turns_left > 3) return null;
        // A Lab filter can hide the guesses, so the whole game counts, not only the shown turns.
        const all = typeof ctx?.items === "function" ? ctx.items() : [];
        if ([...(Array.isArray(items) ? items : []), ...(Array.isArray(all) ? all : [])].some(guessing)) return null;
        return `${game.turns_left} question${game.turns_left === 1 ? "" : "s"} left and no guess yet. Only naming the thing can win.`;
      } },
  ],
});
