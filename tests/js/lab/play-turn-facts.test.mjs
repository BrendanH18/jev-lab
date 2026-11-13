import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/play/play-turn-facts.js";
import { factValue, runDiagnostics } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { GAMES, rawTurn, samplePlayHistoryCtx, turnsByN } from "./fixtures/play.mjs";

const ctx = (overrides) => samplePlayHistoryCtx(overrides);
const playing = ctx();
const P = turnsByN(playing);                            // the running food game, turns 1-7
const W = turnsByN(ctx({ game: GAMES.won }));           // the same game won on turn 8 (every match probability released)
const O = turnsByN(ctx({ game: GAMES.odd }));           // missing and odd values
const feature = (id) => pack.features.find((entry) => entry.id === id);

// A running game of questioning styles (made up for these tests).
//   #  question                        P(yes) P(y/n q) kind     reply
//   1  Is it not made of metal?        0.3    0.97     answer   Probably not
//   2  Is it red or blue?              0.5    0.62     answer   Hard to say
//   3  Doesn't it have wheels?         0.8    0.9      answer   Probably
//   4  tell me more                    0.4    0.1      invalid
//   5  colour?                         0.4    0.2      invalid
//   6  what size                       0.4    0.15     invalid
//   7  Is it ordinary, like a knot?    0.2    0.93     answer   Probably not
//   8  Can't it fly?                   0.1    0.95     answer   No
const INVALID = "Ask a yes/no question, or name your guess.";
const styleGame = { id: "g-style", category: "object", over: false, won: false, turns_left: 12, turns: [
  rawTurn(1, "Is it not made of metal?", [0.3, 0.97, 0.02, 0.05], "answer", "Probably not"),
  rawTurn(2, "Is it red or blue?", [0.5, 0.62, 0.03, 0.04], "answer", "Hard to say"),
  rawTurn(3, "Doesn't it have wheels?", [0.8, 0.9, 0.02, 0.03], "answer", "Probably"),
  rawTurn(4, "tell me more", [0.4, 0.1, 0.02, 0.1], "invalid", INVALID),
  rawTurn(5, "colour?", [0.4, 0.2, 0.05, 0.1], "invalid", INVALID),
  rawTurn(6, "what size", [0.4, 0.15, 0.04, 0.1], "invalid", INVALID),
  rawTurn(7, "Is it ordinary, like a knot?", [0.2, 0.93, 0.02, 0.05], "answer", "Probably not"),
  rawTurn(8, "Can't it fly?", [0.1, 0.95, 0.02, 0.03], "answer", "No"),
] };
const styleCtx = ctx({ game: styleGame });
const S = turnsByN(styleCtx);

// Two more negations: "cannot" written as one word, and "Won't", whose verb is Will.
const N = turnsByN(ctx({ game: { id: "g-neg", category: "food", over: false, won: false, turns_left: 18, turns: [
  rawTurn(1, "Is it something you cannot eat?", [0.2, 0.95, 0.02, 0.05], "answer", "Probably not"),
  rawTurn(2, "Won't it melt?", [0.7, 0.96, 0.02, 0.05], "answer", "Probably"),
] } }));

// A running game with 17 answered questions and 3 left, none of them a guess.
const lateGame = (turnsLeft) => ({ id: "g-late", category: "animal", over: false, won: false, turns_left: turnsLeft,
  turns: Array.from({ length: 20 - turnsLeft }, (_, index) => rawTurn(index + 1, `Is it heavier than ${index + 1} kilograms?`, [0.1, 0.97, 0.03, 0.05], "answer", "No")) });
const lateCtx = ctx({ game: lateGame(3) });

checkPack(pack, {
  // Turn 4's match probability (0.41) is hidden while the game runs (not a guess turn) and released once it is won.
  match_p: { items: [P[5], P[7], P[4], W[4]], values: [0.04, 0.55, null, 0.41] },
  // |0.04 − 0.5| × 2 = 0.92, |0.71 − 0.5| × 2 = 0.42, |0.58 − 0.5| × 2 = 0.16; invalid and guess turns have none.
  certainty: { items: [P[1], P[2], P[6], P[3], P[5]], values: [0.92, 0.42, 0.16, null, null], tolerance: 1e-9 },
  // |0.02 − 0.6|, |0.81 − 0.6|, |0.93 − 0.6|, |0.6 − 0.6|; odd turn 2 sends no P(guess).
  guess_cut_distance: { items: [P[1], P[7], P[5], O[3], O[2]], values: [0.58, 0.21, 0.33, 0, null], tolerance: 1e-9 },
  // |0.08 − 0.5|, |0.97 − 0.5|, |0.9 − 0.5|; turn 5 is a guess, so it has none.
  question_cut_distance: { items: [P[3], P[1], O[2], P[5]], values: [0.42, 0.47, 0.4, null], tolerance: 1e-9 },
  // Guess turns: 0.04 is 0.26 from 30%; 0.55 is 0.15 from 70%; 0.92 is 0.22 from 70%; odd 0.1 is 0.2 from 30%.
  // Turn 4 is an answer, released or not.
  match_cut_distance: { items: [P[5], P[7], W[8], O[3], P[4], W[4]], values: [0.26, 0.15, 0.22, 0.2, null, null], tolerance: 1e-9 },
  // "Would I find it at Harbor Coffee Co.?" is 5+1+1+1+4+1+2+1+2+1+6+1+6+1+4 = 37 code points; odd turn 1 is blank.
  chars: { items: [P[1], P[4], O[1]], values: [12, 37, null] },
  // Odd turn 2 sends 117.5 input tokens, which is not a count; odd turn 3 has an empty meta.
  input_tokens: { items: [P[1], P[4], O[2], O[3]], values: [118, 124, null, null] },
  // Odd turn 1 has no number of its own; the builder numbers it by its place (1).
  turn_number: { items: [P[1], P[7], O[3], O[1]], values: [1, 7, 3, 1] },

  // "knot" holds "not" only inside a word.
  negated: { items: [S[1], S[3], S[8], N[1], N[2], S[7], P[1]], values: [true, true, true, true, true, false, false] },
  // "ordinary" holds "or" only inside a word.
  compound: { items: [S[2], S[7], P[4]], values: [true, false, false] },
  // "Is it alive?" and "Can you eat it?" are starter questions on the page.
  starter: { ctx: playing, items: [P[1], P[2], P[3], S[1]], values: [true, true, false, false] },
  // #3 follows #2 Probably, #5 follows #4 Yes; #2 follows No, #7 follows Hard to say, #1 follows nothing.
  after_yes: { ctx: playing, items: [P[1], P[2], P[3], P[5], P[7]], values: [false, false, true, true, false] },
  opener: { items: [S[1], S[3], S[4], S[8], N[2], P[4], P[6], P[3], O[1]], values: ["Is", "Does", "other", "Can", "Will", "Would", "Is", "other", null] },

  weak_yes_no: { hit: S[2], miss: [P[1], P[3], S[3], O[1]], message: /^Answered, but only 62\.0% read as a yes\/no question/ },
  invalid_streak: { hitList: styleCtx.items(), missList: playing.items(), message: /^Turns #4 to #6 in a row were not read as yes\/no questions\./ },
  late_no_guess: { ctx: lateCtx, hitList: lateCtx.items(), missList: [...lateCtx.items(), P[5]], message: /^3 questions left and no guess yet\./ },
}, { ctx: () => samplePlayHistoryCtx({ game: GAMES.won }) });

test("play-turn-facts: the checks need the run of turns and the stage of the game they describe", () => {
  const streak = [["k", feature("invalid_streak")]];
  // Hiding turn 5 leaves #4 and #6, which are not consecutive turns.
  assert.deepEqual(runDiagnostics(streak, styleCtx.items().filter((item) => item.n !== 5), styleCtx), []);
  const late = [["k", feature("late_no_guess")]];
  const four = ctx({ game: lateGame(4) });
  assert.deepEqual(runDiagnostics(late, four.items(), four), [], "four questions left is not near the end");
  const one = ctx({ game: lateGame(1) });
  assert.match(runDiagnostics(late, one.items(), one)[0].message, /^1 question left and no guess yet\./);
  const over = ctx({ game: GAMES.outOfQuestions });
  assert.deepEqual(runDiagnostics(late, over.items(), over), [], "a finished game gets no advice");
  // A guess hidden by a Lab filter still counts: the game has named something.
  const guessed = lateGame(3);
  guessed.turns = guessed.turns.map((turn) => (turn.n === 9 ? rawTurn(9, "Is it a badger?", [0.1, 0.96, 0.9, 0.05], "guess", "No, it isn't that.") : turn));
  const filtered = ctx({ game: guessed, hide: [9] });
  assert.equal(filtered.shown().length, 16);
  assert.deepEqual(runDiagnostics(late, filtered.shown(), filtered), [], "a hidden guess is still a guess");
});

test("play-turn-facts: during a game no fact reaches a hidden match probability or the secret", () => {
  const facts = pack.features.filter((entry) => entry.kind === "fact");
  for (const item of playing.items()) {
    if (item.kind === "guess") continue;
    assert.equal(factValue(feature("match_p"), item, playing), null, `#${item.n}`);
    assert.equal(factValue(feature("match_cut_distance"), item, playing), null, `#${item.n}`);
  }
  for (const fact of facts) for (const item of playing.items()) assert.ok(!String(factValue(fact, item, playing)).includes("espresso"));
  const findings = runDiagnostics(pack.features.filter((entry) => entry.kind === "diagnostic").map((entry) => [entry.id, entry]), playing.items(), playing);
  assert.ok(findings.every((finding) => !finding.message.includes("espresso")));
  assert.equal(playing.data.secret, null);
});
