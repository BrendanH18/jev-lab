// Fixtures for packs on the Play page's surface "play.history" (contract: static/js/lab/surfaces/play.js). Not a test
// file itself.
//
//   import { samplePlayHistoryCtx, GAMES } from "./fixtures/play.mjs";
//   const ctx = samplePlayHistoryCtx();                              // a running food game after 7 turns
//   const won = samplePlayHistoryCtx({ game: GAMES.won });          // the same game, won on turn 8: secret released
//   const fresh = samplePlayHistoryCtx({ game: GAMES.fresh });      // a new game before the first question
//   const none = samplePlayHistoryCtx({ game: null });              // the page before the first game loaded
//   const byN = turnsByN(ctx);                                      // { 1: item, 2: item, ... } for fact cases
//
// Every ctx is made by the real builder from hand-written raw server responses (jev/play.py Games.public), so items
// and data have exactly the page's shapes, and every guard of the contract runs. The answers are made up for tests;
// the page itself only ever shows answers the user requested.
// overrides: any source field of the builder (game, busy, suggestions, past), as a value or a function, plus
//   hide:     turn numbers that shown() leaves out, as an active Lab filter would
//   order:    turn numbers in the order shown() returns them, as an active Lab sort would (others keep their place after)
//   matches, arrange:  your own Lab hooks instead of hide/order
//   boxDisabled: true makes the question box refuse a draft or focus (as the page's disabled input does)
//   missing:  page callback names to leave out (draft, focusAsk, newGame, giveUp, inspect, refresh)
// The ctx also carries env (fakeEnv(): toasts, copied, downloads) and log: every page callback it reached, as
// [name, ...args], so a command test can assert what it asked the page to do. No callback can ask the model.
import { playHistoryCtx } from "../../../../static/js/lab/surfaces/play.js";
import { fakeEnv } from "../harness.mjs";

// The page's starter questions (static/js/play.js SUGGESTIONS).
export const SUGGESTIONS = Object.freeze(["Is it alive?", "Is it bigger than a car?", "Can you eat it?", "Is it man-made?", "Would I find it in a kitchen?", "Does it have wheels?"]);

const LAST = " That was your last question.";

// One raw turn as the server sends it. p: [answer_is_yes, is_yes_no_question, names_a_guess, guess_matches].
export function rawTurn(n, text, [yes, yn, guess, match], kind, reply, { latency = 100, tokens = 120, cost = 0.000005 } = {}) {
  return { n, text, kind, reply,
    probs: { answer_is_yes: yes, is_yes_no_question: yn, names_a_guess: guess, guess_matches: match },
    meta: { model: "jev-1.14.0", latency_ms: latency, question_count: 4, input_tokens: tokens, output_tokens: 0, cost_usd: cost, backend: "sdk" } };
}

// The request trace the server keeps for a turn and releases when the game ends.
export function rawTrace(secret, turn) {
  const answers = Object.fromEntries(Object.entries(turn.probs).map(([id, p]) => [id, { type: "noul", noul: p }]));
  return { request: { state: { secret, player_question: turn.text }, model: "jev-latest",
    questions: { answer_is_yes: { type: "noul" }, is_yes_no_question: { type: "noul" }, names_a_guess: { type: "noul" }, guess_matches: { type: "noul" } } },
  response: { model: "jev-1.14.0", answers }, meta: turn.meta };
}

// The secret of the food game is "espresso". While it runs the server sends no secret and no traces.
//   #  question                                  P(yes) P(y/n q) P(guess) P(match) kind     reply           latency tokens cost
//   1  Is it alive?                               0.04   0.97     0.02     0.01     answer   No              92.4    118    0.000005
//   2  Can you eat it?                            0.71   0.99     0.03     0.12     answer   Probably        101.6   120    0.000006
//   3  What colour is it?                         0.31   0.08     0.05     0.02     invalid  Ask a yes/no…   88      119    0.000005
//   4  Would I find it at Harbor Coffee Co.?      0.88   0.98     0.11     0.41     answer   Yes             97      124    0.000006
//   5  Is it a croissant?                         0.09   0.95     0.93     0.04     guess    No, it isn't…   110     121    0.000005
//   6  is it a drink                              0.58   0.96     0.04     0.22     answer   Hard to say     95      119    0.000005
//   7  Is it coffee?                              0.9    0.97     0.81     0.55     guess    Close, but…     104     120    0.000006
//   8  Is it an espresso?  (won game only)        0.97   0.98     0.95     0.92     win      Yes! You got it 99      121    0.000005
// Turn 4's guess_matches (0.41) is NOT a guess turn, so the page hides it while the game runs: the builder gives null.
export const FOOD_TURNS = Object.freeze([
  rawTurn(1, "Is it alive?", [0.04, 0.97, 0.02, 0.01], "answer", "No", { latency: 92.4, tokens: 118, cost: 0.000005 }),
  rawTurn(2, "Can you eat it?", [0.71, 0.99, 0.03, 0.12], "answer", "Probably", { latency: 101.6, tokens: 120, cost: 0.000006 }),
  rawTurn(3, "What colour is it?", [0.31, 0.08, 0.05, 0.02], "invalid", "Ask a yes/no question, or name your guess.", { latency: 88, tokens: 119, cost: 0.000005 }),
  rawTurn(4, "Would I find it at Harbor Coffee Co.?", [0.88, 0.98, 0.11, 0.41], "answer", "Yes", { latency: 97, tokens: 124, cost: 0.000006 }),
  rawTurn(5, "Is it a croissant?", [0.09, 0.95, 0.93, 0.04], "guess", "No, it isn't that.", { latency: 110, tokens: 121, cost: 0.000005 }),
  rawTurn(6, "is it a drink", [0.58, 0.96, 0.04, 0.22], "answer", "Hard to say", { latency: 95, tokens: 119, cost: 0.000005 }),
  rawTurn(7, "Is it coffee?", [0.9, 0.97, 0.81, 0.55], "guess", "Close, but not quite. Be more specific.", { latency: 104, tokens: 120, cost: 0.000006 }),
]);
export const WIN_TURN = Object.freeze(rawTurn(8, "Is it an espresso?", [0.97, 0.98, 0.95, 0.92], "win", "Yes! You got it.", { latency: 99, tokens: 121, cost: 0.000005 }));

// The harmonica game: two questions, then "Give up & reveal".
const HARMONICA_TURNS = [
  rawTurn(1, "Is it man-made?", [0.96, 0.99, 0.02, 0.03], "answer", "Yes", { latency: 90, tokens: 118, cost: 0.000005 }),
  rawTurn(2, "Is it bigger than a car?", [0.03, 0.98, 0.04, 0.02], "answer", "No", { latency: 110, tokens: 122, cost: 0.000005 }),
];

// The glacier game: twenty questions, none of them a winning guess. P(yes) cycles 0.1, 0.5, 0.9, 0.3, so the replies
// cycle No, Hard to say, Yes, Probably not; turn 20 carries the last-question note. Latency is 100 + n ms, cost
// 0.000005 each, 120 tokens each.
const CYCLE = [[0.1, "No"], [0.5, "Hard to say"], [0.9, "Yes"], [0.3, "Probably not"]];
const GLACIER_QUESTIONS = ["Is it alive?", "Is it cold?", "Is it outdoors?", "Is it man-made?", "Is it bigger than a house?", "Does it move?",
  "Is it made of water?", "Can you visit it?", "Is it in the ocean?", "Is it in the mountains?", "Is it white?", "Is it old?",
  "Is it a place?", "Is it found in Europe?", "Is it melting?", "Is it loud?", "Does it have a name?", "Is it flat?", "Is it famous?", "Is it ice?"];
const GLACIER_TURNS = GLACIER_QUESTIONS.map((text, index) => {
  const [yes, reply] = CYCLE[index % 4];
  return rawTurn(index + 1, text, [yes, 0.97, 0.05, 0.1], "answer", index === 19 ? reply + LAST : reply, { latency: 101 + index, tokens: 120, cost: 0.000005 });
});

const game = (fields) => Object.freeze({ id: "g-fixture", ...fields });

// Raw games exactly as GET/POST /api/play/* return them.
export const GAMES = Object.freeze({
  // The page before the first question: no turns, 20 left.
  fresh: game({ category: "animal", turns: [], over: false, won: false, turns_left: 20 }),
  // The running food game after 7 questions (the default).
  playing: game({ id: "g-food", category: "food", turns: FOOD_TURNS, over: false, won: false, turns_left: 13 }),
  // A question on its way: the same game, with busy set by the override { busy: true }.
  // The food game, won on turn 8. The secret and the eight traces are released.
  won: game({ id: "g-food", category: "food", turns: [...FOOD_TURNS, WIN_TURN], over: true, won: true, turns_left: 12, secret: "espresso",
    traces: [...FOOD_TURNS, WIN_TURN].map((turn) => rawTrace("espresso", turn)) }),
  // Given up after two questions: the secret and two traces are released.
  gaveUp: game({ id: "g-harmonica", category: "object", turns: HARMONICA_TURNS, over: true, won: false, turns_left: 18, secret: "harmonica",
    traces: HARMONICA_TURNS.map((turn) => rawTrace("harmonica", turn)) }),
  // All twenty questions used without a win.
  outOfQuestions: game({ id: "g-glacier", category: "place or nature", turns: GLACIER_TURNS, over: true, won: false, turns_left: 0, secret: "glacier",
    traces: GLACIER_TURNS.map((turn) => rawTrace("glacier", turn)) }),
  // A running game with one question asked three ways: "Is it sweet?" (#1), "is it SWEET" (#3), "Is it sweet?" (#4).
  //   #1 0.9 Yes · #2 "Is it a fruit?" 0.2 Probably not · #3 0.88 Yes · #4 0.91 Yes; 100, 105, 110, 115 ms.
  repeats: game({ id: "g-repeats", category: "food", over: false, won: false, turns_left: 16, turns: [
    rawTurn(1, "Is it sweet?", [0.9, 0.98, 0.03, 0.06], "answer", "Yes", { latency: 100 }),
    rawTurn(2, "Is it a fruit?", [0.2, 0.98, 0.08, 0.04], "answer", "Probably not", { latency: 105 }),
    rawTurn(3, "is it SWEET", [0.88, 0.96, 0.03, 0.06], "answer", "Yes", { latency: 110 }),
    rawTurn(4, "Is it sweet?", [0.91, 0.98, 0.03, 0.06], "answer", "Yes", { latency: 115 }),
  ] }),
  // Shapes the builder must survive: a turn with no number, kind, probabilities or meta; one with text-typed
  // probabilities and NaN latency; a non-object; and a game with no category or turns_left.
  odd: game({ turns: [
    { text: "  ", reply: "" },
    null,
    { n: 2, text: "Is it bigger than a breadbox?", kind: "answer", reply: "Probably not", probs: { answer_is_yes: "0.3", is_yes_no_question: 0.9, names_a_guess: null },
      meta: { latency_ms: Number.NaN, cost_usd: 0.000004, input_tokens: 117.5 } },
    { n: 3, text: "Is it a lemon?", kind: "guess", reply: "No, it isn't that.", probs: { answer_is_yes: 0.2, is_yes_no_question: 0.9, names_a_guess: 0.6, guess_matches: 0.1 }, meta: {} },
  ], over: false, won: false }),
});

// Earlier games of the session, raw (oldest first): the harmonica game given up, then a game left by "New game"
// after one question (its secret was never sent).
export const ABANDONED = Object.freeze(game({ id: "g-left", category: "job", turns: [rawTurn(1, "Does it wear a uniform?", [0.62, 0.98, 0.03, 0.05], "answer", "Probably", { latency: 120, cost: 0.000007 })],
  over: false, won: false, turns_left: 19 }));
export const PAST = Object.freeze([GAMES.gaveUp, ABANDONED]);

const value = (entry) => (typeof entry === "function" ? entry : () => entry);

// The play.history ctx. By default: the running food game (7 turns, none hidden), not busy, the page's suggestions,
// and two earlier games (harmonica given up, a job game abandoned).
export function samplePlayHistoryCtx(overrides = {}) {
  const log = [];
  const { hide = [], order = [], matches, arrange, boxDisabled = false, missing = [], ...rest } = overrides;
  const hidden = new Set(hide);
  const rank = (item) => (order.includes(item.n) ? order.indexOf(item.n) : order.length);
  const callbacks = {
    draft: (text) => { if (boxDisabled) return false; log.push(["draft", text]); return true; },
    focusAsk: () => { if (boxDisabled) return false; log.push(["focusAsk"]); return true; },
    newGame: () => { log.push(["newGame"]); return Promise.resolve(); },
    giveUp: () => { log.push(["giveUp"]); return Promise.resolve(); },
    inspect: (trace, title) => { log.push(["inspect", trace, title]); },
    refresh: () => { log.push(["refresh"]); },
  };
  for (const name of missing) delete callbacks[name];
  const source = {
    game: value("game" in rest ? rest.game : GAMES.playing),
    busy: value(rest.busy ?? false),
    suggestions: "suggestions" in rest ? rest.suggestions : SUGGESTIONS,
    past: value("past" in rest ? rest.past : PAST),
    matches: matches || ((item) => !hidden.has(item.n)),
    arrange: arrange || ((list) => (order.length ? list.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map((entry) => entry.item) : list)),
    ...callbacks,
  };
  const ctx = playHistoryCtx(source);
  ctx.env = fakeEnv();
  ctx.log = log;
  return ctx;
}

// The items of a ctx keyed by turn number, for fact and diagnostic cases.
export const turnsByN = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.n, item]));
