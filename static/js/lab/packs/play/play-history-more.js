// More turn facts, checks, metrics, exports and commands for the Play page's turn list ("play.history", contract:
// static/js/lab/surfaces/play.js): questions left, the move in P(yes) since the previous answer, latency against the
// game's median, hedged answers, the game's phase, contradicting repeats, tallies and guesses. Everything is read
// from the turns of the user's own game in this page session. Nothing reads data.secret, data.traces or a match
// probability, so nothing here can hint at the secret while the game runs.
import { csvText, definePack } from "../../kit.js";
import { codePoints } from "../../lib/text.js";

const ANSWERS = ["Yes", "Probably", "Hard to say", "Probably not", "No"];
const YES_LEANING = new Set(["Yes", "Probably"]);
const NO_LEANING = new Set(["No", "Probably not"]);
const HEDGED = new Set(["Probably", "Hard to say", "Probably not"]);
const LONG_QUESTION = 120;

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const textOf = (item) => (typeof item?.text === "string" ? item.text : "");
const playOrder = (items) => items.slice().sort((a, b) => a.n - b.n);
const maxTurns = (ctx) => finite(ctx?.data?.rules?.max_turns) ?? 20;
const normalized = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
const replyCell = (item) => (item.last_question ? item.reply.replace(/ That was your last question\.$/, "") : item.reply);

function leaning(item) {
  if (item?.kind !== "answer" || !item.answer) return null;
  return YES_LEANING.has(item.answer) ? "yes" : NO_LEANING.has(item.answer) ? "no" : "unsure";
}

function medianOf(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// The median measured latency of every turn of the game (not only the shown ones), or null.
const gameMedianLatency = (ctx) => medianOf(ctx.items().map((item) => finite(item.meta?.latency_ms)).filter((value) => value !== null));

// The answered turn just before this one in play order, or null.
function previousAnswered(item, ctx) {
  return playOrder(ctx.items()).filter((other) => other.n < item.n && other.kind === "answer" && finite(other.probs?.answer_is_yes) !== null).pop() || null;
}

// Pairs of turns that ask the same question (ignoring case and punctuation) and got answers leaning opposite ways.
function contradictions(items) {
  const seen = new Map();
  const found = [];
  for (const item of playOrder(items)) {
    const lean = leaning(item);
    if (lean !== "yes" && lean !== "no") continue;
    const key = normalized(item.text);
    if (!key) continue;
    for (const earlier of seen.get(key) || []) if (leaning(earlier) !== lean) found.push([earlier, item]);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(item);
  }
  return found;
}

function phase(item, ctx) {
  const n = finite(item?.n);
  if (n === null) return null;
  const third = maxTurns(ctx) / 3;
  return n <= Math.ceil(third) ? "early" : n <= Math.ceil(third * 2) ? "middle" : "late";
}

function tally(items) {
  const counts = Object.fromEntries(ANSWERS.map((answer) => [answer, 0]));
  let guesses = 0, unread = 0, wins = 0;
  for (const item of items) {
    if (item.kind === "answer" && item.answer) counts[item.answer]++;
    else if (item.kind === "guess") guesses++;
    else if (item.kind === "win") wins++;
    else if (item.kind === "invalid") unread++;
  }
  return { counts, guesses, unread, wins };
}

const answeredShown = (ctx) => ctx.shown().filter((item) => item.kind === "answer" && item.answer);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const GUESS_WORDS = { right: "right", close: "close", wrong: "wrong" };

export default definePack({
  id: "play-history-more",
  surface: "play.history",
  title: "More turn facts and tallies",
  about: "Questions left after each turn, the move in P(yes) since the previous answer, latency against the game's median, hedged answers, the game's phase and the reply text; checks for contradicting repeats, two questions in one turn, slow turns and long questions; mean P(yes), hedged share, turn of the first guess and words per question; answer tally and guess exports; and commands to copy the newest reply, read out the tally and inspect the first turn after the game. Nothing reads the secret.",
  features: [
    { id: "questions_left", kind: "fact", type: "number", label: "questions left after this turn", unit: "questions",
      value: (item, ctx) => { const n = finite(item?.n); return n === null ? null : Math.max(0, maxTurns(ctx) - n); } },
    { id: "yes_change", kind: "fact", type: "number", label: "change in P(yes) since the previous answer", unit: "−1 to 1",
      help: "Answered turns only: this turn's P(yes) minus the previous answered turn's. Positive moved toward Yes.",
      value: (item, ctx) => {
        const p = item?.kind === "answer" ? finite(item.probs?.answer_is_yes) : null;
        const before = p === null ? null : previousAnswered(item, ctx);
        return before ? p - before.probs.answer_is_yes : null;
      } },
    { id: "latency_ratio", kind: "fact", type: "number", label: "latency against the game's median", unit: "× median",
      help: "Measured latency divided by the median of every turn of this game: 2 is twice as slow as usual.",
      value: (item, ctx) => {
        const latency = finite(item?.meta?.latency_ms), median = gameMedianLatency(ctx);
        return latency === null || !median ? null : latency / median;
      } },
    { id: "hedged", kind: "fact", type: "flag", label: "hedged answer (Probably, Hard to say or Probably not)",
      value: (item) => item?.kind === "answer" && HEDGED.has(item.answer) },
    { id: "last_question", kind: "fact", type: "flag", label: "the game's last allowed question", value: (item) => item?.last_question === true },
    { id: "has_number", kind: "fact", type: "flag", label: "number in the question", value: (item) => /\p{N}/u.test(textOf(item)) },
    { id: "leaning", kind: "fact", type: "category", label: "answer leaning", help: "yes (Yes, Probably), no (No, Probably not) or unsure (Hard to say); answered turns only.",
      value: leaning },
    { id: "phase", kind: "fact", type: "category", label: "game phase", help: "early (turns 1–7), middle (8–14) or late (15–20) of the 20 questions.",
      value: phase },
    { id: "reply_text", kind: "fact", type: "text", label: "reply text", value: (item) => (typeof item?.reply === "string" ? item.reply : "") },

    { id: "contradiction", kind: "diagnostic", severity: "advice", scope: "list", label: "The same question answered both ways",
      check: (items) => contradictions(items).map(([a, b]) => `#${a.n} and #${b.n} ask the same thing but got ${a.answer} and ${b.answer}: the wording sat near a cut-off, so neither answer is firm.`) },
    { id: "two_questions", kind: "diagnostic", severity: "advice", label: "Two questions in one turn",
      check: (item) => ((textOf(item).match(/\?/g) || []).length >= 2 ? "This turn holds more than one question mark; one answer covers only one of them. Ask them separately." : null) },
    { id: "slow_turn", kind: "diagnostic", severity: "info", label: "Slow turn",
      help: "Measured latency more than twice the median of this game's turns.",
      check: (item, ctx) => {
        const latency = finite(item?.meta?.latency_ms), median = gameMedianLatency(ctx);
        return latency !== null && median && latency > 2 * median ? `Took ${Math.round(latency)} ms, more than twice this game's median of ${Math.round(median)} ms.` : null;
      } },
    { id: "long_question", kind: "diagnostic", severity: "info", label: `Question over ${LONG_QUESTION} characters`,
      check: (item, ctx) => {
        const length = codePoints(textOf(item));
        const max = finite(ctx?.data?.rules?.max_question_chars) ?? 200;
        return length > LONG_QUESTION ? `${length} characters of the ${max} allowed. Short questions are read more reliably.` : null;
      } },

    { id: "mean_yes", kind: "metric", format: "percent", label: "Mean P(yes) of the shown answered questions",
      compute: (ctx) => {
        const values = answeredShown(ctx).map((item) => finite(item.probs.answer_is_yes)).filter((value) => value !== null);
        return values.length ? { value: values.reduce((total, value) => total + value, 0) / values.length, detail: `over ${plural(values.length, "answer")}` } : null;
      } },
    { id: "hedged_share", kind: "metric", format: "percent", label: "Share of shown answers that were hedged",
      help: "Probably, Hard to say and Probably not, out of every answered question shown.",
      compute: (ctx) => {
        const answered = answeredShown(ctx);
        if (!answered.length) return null;
        const hedged = answered.filter((item) => HEDGED.has(item.answer)).length;
        return { value: hedged / answered.length, detail: `${hedged} of ${answered.length}` };
      } },
    { id: "first_guess_turn", kind: "metric", format: "integer", label: "Turn of this game's first guess",
      help: "The first turn read as naming a thing (a guess or the win); every turn of the game counts, filters aside.",
      compute: (ctx) => {
        const first = playOrder(ctx.items()).find((item) => item.kind === "guess" || item.kind === "win");
        return first ? first.n : null;
      } },
    { id: "mean_words", kind: "metric", format: "number", label: "Mean words per shown question",
      compute: (ctx) => {
        const counts = ctx.shown().map((item) => textOf(item).split(/\s+/).filter(Boolean).length).filter((count) => count > 0);
        return counts.length ? counts.reduce((total, count) => total + count, 0) / counts.length : null;
      } },

    { id: "tally_csv", kind: "exporter", label: "Answer tally of the shown turns (CSV)", help: "how many shown turns got each reply kind; no questions and no secret",
      filename: "play-answer-tally.csv", mime: "text/csv",
      build: (ctx) => {
        const { counts, guesses, unread, wins } = tally(ctx.shown());
        return csvText([["reply", "turns"], ...ANSWERS.map((answer) => [answer, counts[answer]]), ["guess (wrong or close)", guesses], ["win", wins], ["not read as a question", unread]]);
      } },
    { id: "guesses_md", kind: "exporter", label: "This game's guesses as Markdown", help: "every turn read as a guess, in play order, with your words and whether it was right, close or wrong; no secret beyond what you typed",
      filename: "play-guesses.md", mime: "text/markdown",
      build: (ctx) => {
        const guesses = playOrder(ctx.items()).filter((item) => item.guess);
        return ["# Guesses", "", ...(guesses.length ? guesses.map((item) => `- #${item.n} ${item.text.replace(/[\r\n]+/g, " ")} — ${GUESS_WORDS[item.guess]}`) : ["No guess yet."])].join("\n") + "\n";
      } },

    { id: "copy_newest_reply", kind: "command", group: "Play", title: "Copy the newest reply",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => {
        const newest = ctx.items().reduce((best, item) => (!best || item.n > best.n ? item : best), null);
        if (!newest) throw new Error("No question has been asked yet.");
        ctx.env.copy(newest.reply);
      } },
    { id: "read_tally", kind: "command", group: "Play", title: "Say the answer tally of this game",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => {
        const { counts, guesses, unread, wins } = tally(ctx.items());
        const extra = [guesses ? plural(guesses, "wrong or close guess", "wrong or close guesses") : null, wins ? "the winning guess" : null,
          unread ? plural(unread, "turn") + " not read as a question" : null].filter(Boolean);
        ctx.env.toast(`${ANSWERS.map((answer) => `${answer} ${counts[answer]}`).join(", ")}${extra.length ? `; ${extra.join(", ")}` : ""}.`);
      } },
    { id: "inspect_first", kind: "command", group: "Play", title: "Inspect the JSON of the first turn",
      help: "Available once the game is over, when the page releases the requests.",
      when: (ctx) => !!ctx.data?.game?.over && ctx.items().length > 0,
      run: (ctx) => {
        const first = playOrder(ctx.items())[0];
        if (!first) throw new Error("No question has been asked yet.");
        ctx.actions.inspectTurn(first.n);
      } },
  ],
});
