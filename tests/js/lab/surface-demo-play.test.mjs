// The Play page's Lab surface: the builder of static/js/lab/surfaces/play.js, and the hooks in static/js/play.js,
// rebuilt from the page source with stand-ins for the DOM and the network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { playHistoryCtx } from "../../../static/js/lab/surfaces/play.js";
import pack from "../../../static/js/lab/packs/play/play-history-insights.js";
import { fakeEnv, find, fire, textOf } from "./harness.mjs";
import { ABANDONED, FOOD_TURNS, GAMES, PAST, SUGGESTIONS, WIN_TURN, rawTurn, samplePlayHistoryCtx, turnsByN } from "./fixtures/play.mjs";

const PAGE = readFileSync(new URL("../../../static/js/play.js", import.meta.url), "utf8");
const PLAY_PY = readFileSync(new URL("../../../jev/play.py", import.meta.url), "utf8");
const body = (name) => {
  const match = PAGE.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `static/js/play.js has no function ${name}`);
  return match[0];
};
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) });
const ctx = (overrides) => samplePlayHistoryCtx(overrides);

// ---------- the builder ----------

test("items: one frozen plain turn per server turn, newest first, with the contract's fields", () => {
  const c = ctx();
  const items = c.items();
  assert.deepEqual(items.map((item) => item.n), [7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(items[3], {
    n: 4, text: "Would I find it at Harbor Coffee Co.?", kind: "answer", reply: "Yes", answer: "Yes", guess: null, last_question: false,
    probs: { answer_is_yes: 0.88, is_yes_no_question: 0.98, names_a_guess: 0.11, guess_matches: null },
    meta: { model: "jev-1.14.0", latency_ms: 97, question_count: 4, input_tokens: 124, output_tokens: 0, cost_usd: 0.000006, backend: "sdk" } });
  const byN = turnsByN(c);
  assert.deepEqual([byN[5].guess, byN[5].answer, byN[7].guess, byN[3].kind, byN[3].answer, byN[6].answer], ["wrong", null, "close", "invalid", null, "Hard to say"]);
  for (const item of items) assert.deepEqual(JSON.parse(JSON.stringify(item)), item);
  assert.throws(() => { items[0].text = "changed"; }, TypeError);
  assert.throws(() => { items[0].probs.answer_is_yes = 1; }, TypeError);
  assert.throws(() => { items[0].meta.cost_usd = 0; }, TypeError);
  assert.equal(c.items()[0], items[0], "the same objects while the game is unchanged");
  assert.equal(c.shown()[2], items[2]);
  assert.equal(c.itemName(items[0], 0), "#7");
  assert.equal(c.itemName({}, 3), "#?");
  assert.equal(FOOD_TURNS[0].probs.guess_matches, 0.01, "the raw turns are untouched");
});

test("guess_matches stays null while the game runs, except on turns the page shows as guesses", () => {
  const running = turnsByN(ctx());
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => running[n].probs.guess_matches), [null, null, null, null, 0.04, null, 0.55]);
  const over = turnsByN(ctx({ game: GAMES.won }));
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => over[n].probs.guess_matches), [0.01, 0.12, 0.02, 0.41, 0.04, 0.22, 0.55, 0.92]);
  assert.equal(over[8].guess, "right");
  // Exactly at the guess cut-off counts as a guess (jev/play.py: names_a_guess >= 0.6).
  assert.equal(turnsByN(ctx({ game: GAMES.odd }))[3].probs.guess_matches, 0.1);
  // Ending a game gives new items, now with the value.
  let game = GAMES.playing;
  const live = ctx({ game: () => game });
  assert.equal(turnsByN(live)[4].probs.guess_matches, null);
  game = { ...GAMES.playing, over: true, secret: "espresso", traces: [] };
  assert.equal(turnsByN(live)[4].probs.guess_matches, 0.41);
});

test("the last-question note: kept in reply, stripped from answer, flagged on turn 20", () => {
  const items = ctx({ game: GAMES.outOfQuestions }).items();
  assert.equal(items.length, 20);
  assert.deepEqual([items[0].n, items[0].reply, items[0].answer, items[0].last_question], [20, "Probably not That was your last question.", "Probably not", true]);
  assert.ok(items.slice(1).every((item) => item.last_question === false));
  // A guess on turn 20 keeps its kind of guess.
  const guess = rawTurn(1, "Is it a glacier?", [0.5, 0.9, 0.9, 0.5], "guess", "Close, but not quite. Be more specific. That was your last question.");
  const [item] = ctx({ game: { ...GAMES.fresh, turns: [guess], over: true, secret: "iceberg" } }).items();
  assert.deepEqual([item.guess, item.last_question, item.answer], ["close", true, null]);
});

test("odd shapes read without throwing", () => {
  const items = ctx({ game: GAMES.odd }).items();
  assert.deepEqual(items.map((item) => item.n), [3, 2, 1], "a non-object turn is skipped; a turn with no number takes its position");
  const blank = items[2];
  assert.deepEqual([blank.text, blank.kind, blank.reply, blank.answer, blank.guess], ["  ", null, "", null, null]);
  assert.deepEqual(blank.probs, { answer_is_yes: null, is_yes_no_question: null, names_a_guess: null, guess_matches: null });
  assert.deepEqual(Object.values(blank.meta), [null, null, null, null, null, null, null]);
  assert.deepEqual([items[1].probs.answer_is_yes, items[1].meta.latency_ms, items[1].meta.input_tokens, items[1].meta.cost_usd], [null, null, null, 0.000004],
    "text probabilities, NaN and fractional token counts are unavailable");
  assert.deepEqual(ctx({ game: GAMES.odd }).data.game, { category: "", over: false, won: false, outcome: "playing", asked: 3, turns_left: 17 });
  for (const raw of [null, "nope", 3, { turns: "nope" }]) assert.deepEqual(ctx({ game: raw }).items(), []);
  assert.deepEqual(playHistoryCtx().items(), []);
  assert.deepEqual(playHistoryCtx().shown(), []);
});

test("data: game, outcome, rules and suggestions; null before the first game", () => {
  assert.deepEqual(ctx().data.game, { category: "food", over: false, won: false, outcome: "playing", asked: 7, turns_left: 13 });
  assert.deepEqual(ctx({ game: GAMES.won }).data.game, { category: "food", over: true, won: true, outcome: "won", asked: 8, turns_left: 12 });
  assert.equal(ctx({ game: GAMES.gaveUp }).data.game.outcome, "gave_up");
  assert.equal(ctx({ game: GAMES.outOfQuestions }).data.game.outcome, "out_of_questions");
  assert.deepEqual(ctx({ game: GAMES.fresh }).data.game, { category: "animal", over: false, won: false, outcome: "playing", asked: 0, turns_left: 20 });
  const none = ctx({ game: null }).data;
  assert.deepEqual([none.game, none.secret, none.traces], [null, null, null]);
  const data = ctx().data;
  assert.deepEqual(data.suggestions, SUGGESTIONS);
  assert.deepEqual(data.answers, ["Yes", "Probably", "Hard to say", "Probably not", "No"]);
  assert.deepEqual([data.busy, ctx({ busy: true }).data.busy], [false, true]);
  assert.deepEqual(ctx({ suggestions: ["Is it red?", 4, null] }).data.suggestions, ["Is it red?"]);
  assert.deepEqual(ctx({ suggestions: "nope" }).data.suggestions, []);
  assert.throws(() => { data.game.over = true; }, TypeError);
  assert.throws(() => { data.suggestions.push("x"); }, TypeError);
  assert.throws(() => { data.rules.yes = 0.5; }, TypeError);
});

test("the rules mirror jev/play.py", () => {
  const { rules } = ctx().data;
  assert.match(PLAY_PY, new RegExp(`MAX_TURNS = ${rules.max_turns}\\b`));
  assert.ok(PLAY_PY.includes(`[:${rules.max_question_chars}]`));
  assert.ok(PLAY_PY.includes(`if p_yes >= ${rules.yes}:\n        return "Yes"`));
  assert.ok(PLAY_PY.includes(`if p_yes >= ${rules.probably}:\n        return "Probably"`));
  assert.ok(PLAY_PY.includes(`if p_yes <= ${rules.no}:\n        return "No"`));
  assert.ok(PLAY_PY.includes(`if p_yes <= ${rules.probably_not}:\n        return "Probably not"`));
  assert.ok(PLAY_PY.includes(`if a["names_a_guess"] >= ${rules.guess}:`));
  assert.ok(PLAY_PY.includes(`if a["guess_matches"] >= ${rules.match}:`));
  assert.ok(PLAY_PY.includes(`elif a["guess_matches"] <= ${rules.mismatch}:`));
  assert.ok(PLAY_PY.includes(`elif a["is_yes_no_question"] < ${rules.yes_no_question}:`));
  for (const reply of ['"No, it isn\'t that."', '"Close, but not quite. Be more specific."', '"Yes! You got it."', '" That was your last question."']) assert.ok(PLAY_PY.includes(reply), reply);
});

test("the secret and the traces reach packs only once the game is over", () => {
  // Even if a running game object held them, the ctx would not hand them out.
  const leaky = { ...GAMES.playing, secret: "espresso", traces: FOOD_TURNS.map(() => ({ request: { state: { secret: "espresso" } } })) };
  const running = ctx({ game: leaky });
  assert.deepEqual([running.data.secret, running.data.traces], [null, null]);
  assert.ok(!JSON.stringify([running.items(), running.data]).includes("espresso"));
  assert.throws(() => running.actions.inspectTurn(1), /released when the game ends/);
  const over = ctx({ game: GAMES.won });
  assert.equal(over.data.secret, "espresso");
  assert.equal(over.data.traces.length, 8);
  assert.equal(over.data.traces[3].request.state.player_question, "Would I find it at Harbor Coffee Co.?");
  assert.deepEqual(over.data.traces[7], GAMES.won.traces[7]);
  assert.notEqual(over.data.traces[0], GAMES.won.traces[0], "a copy, not the page's own trace");
  assert.throws(() => { over.data.traces[0].request.state.secret = "x"; }, TypeError);
  assert.equal(over.data.traces, over.data.traces, "the same frozen copy on every read");
});

test("past: this session's earlier games, oldest first, with no secret for an abandoned game", () => {
  const { past } = ctx().data;
  assert.deepEqual(past, [
    { category: "object", outcome: "gave_up", asked: 2, secret: "harmonica", cost_usd: 0.00001, mean_latency_ms: 100 },
    { category: "job", outcome: "abandoned", asked: 1, secret: null, cost_usd: 0.000007, mean_latency_ms: 120 },
  ]);
  assert.throws(() => { past[0].secret = "x"; }, TypeError);
  assert.deepEqual(ctx({ past: [] }).data.past, []);
  assert.deepEqual(ctx({ past: "nope" }).data.past, []);
  assert.deepEqual(playHistoryCtx({ game: () => GAMES.playing }).data.past, []);
  // A game left before its first question is not a record; an abandoned game that somehow carries a secret keeps it hidden.
  assert.deepEqual(ctx({ past: [GAMES.fresh, null, { ...ABANDONED, secret: "chef" }, GAMES.won] }).data.past.map((game) => [game.outcome, game.secret]),
    [["abandoned", null], ["won", "espresso"]]);
  assert.deepEqual(ctx({ past: [{ ...GAMES.gaveUp, turns: [] }] }).data.past[0], { category: "object", outcome: "gave_up", asked: 0, secret: "harmonica", cost_usd: null, mean_latency_ms: null });
  const many = Array.from({ length: 25 }, (_, index) => ({ ...GAMES.gaveUp, category: `c${index}` }));
  const capped = ctx({ past: many }).data.past;
  assert.deepEqual([capped.length, capped[0].category, capped[19].category], [20, "c5", "c24"]);
  assert.equal(PAST.length, 2);
});

test("shown() applies the Lab filter, then the Lab sort, at call time; items() is never filtered", () => {
  const hidden = new Set();
  let ascending = false;
  const c = ctx({ matches: (item) => !hidden.has(item.n), arrange: (list) => (ascending ? list.slice().sort((a, b) => a.n - b.n) : list) });
  assert.deepEqual(c.shown(), c.items());
  hidden.add(3).add(5);
  assert.deepEqual(c.shown().map((item) => item.n), [7, 6, 4, 2, 1]);
  ascending = true;
  assert.deepEqual(c.shown().map((item) => item.n), [1, 2, 4, 6, 7]);
  assert.equal(c.items().length, 7);
  assert.deepEqual(ctx({ hide: [1, 2], order: [3] }).shown().map((item) => item.n), [3, 7, 6, 5, 4]);
  // A hook that returns something odd leaves the filtered list as it is.
  assert.deepEqual(ctx({ arrange: () => "nope", hide: [7] }).shown().map((item) => item.n), [6, 5, 4, 3, 2, 1]);
});

test("draftQuestion: fills the box only for a running, idle game and checks the text like the server", () => {
  const c = ctx();
  assert.deepEqual(Object.keys(c.actions).sort(), ["draftQuestion", "focusQuestion", "giveUp", "inspectTurn", "newGame"]);
  assert.equal(c.actions.replaceItems, undefined, "the turns are records of calls: read-only");
  assert.equal(c.actions.importItems, undefined);
  assert.equal(c.actions.draftQuestion("  Is it   served\nhot? "), "Is it served hot?");
  assert.deepEqual(c.log, [["draft", "Is it served hot?"]]);
  assert.throws(() => c.actions.draftQuestion(" \n "), /no question/);
  assert.throws(() => c.actions.draftQuestion(null), /no question/);
  assert.equal(c.actions.draftQuestion("x".repeat(200)).length, 200);
  assert.throws(() => c.actions.draftQuestion("x".repeat(201)), /at most 200 characters/);
  assert.throws(() => ctx({ game: null }).actions.draftQuestion("Is it hot?"), /no game yet/);
  assert.throws(() => ctx({ game: GAMES.won }).actions.draftQuestion("Is it hot?"), /game is over/);
  assert.throws(() => ctx({ busy: true }).actions.draftQuestion("Is it hot?"), /Wait for the current answer/);
  assert.throws(() => ctx({ boxDisabled: true }).actions.draftQuestion("Is it hot?"), /not available/);
  assert.throws(() => ctx({ missing: ["draft"] }).actions.draftQuestion("Is it hot?"), /not available/);
  assert.equal(c.log.length, 2, "no refused draft reached the page");
});

test("focusQuestion, newGame, giveUp and inspectTurn guards", async () => {
  const c = ctx();
  assert.equal(c.actions.focusQuestion(), true);
  for (const blocked of [ctx({ game: null }), ctx({ game: GAMES.won }), ctx({ busy: true }), ctx({ boxDisabled: true }), ctx({ missing: ["focusAsk"] })]) {
    assert.equal(blocked.actions.focusQuestion(), false);
    assert.deepEqual(blocked.log, []);
  }
  await c.actions.newGame();
  await c.actions.giveUp();
  assert.deepEqual(c.log, [["focusAsk"], ["newGame"], ["giveUp"]]);
  assert.throws(() => ctx({ busy: true }).actions.newGame(), /Wait for the current answer/);
  assert.throws(() => ctx({ missing: ["newGame"] }).actions.newGame(), /cannot be started/);
  await ctx({ game: GAMES.won }).actions.newGame();  // "Play again" after a game is fine
  assert.throws(() => ctx({ game: null }).actions.giveUp(), /no game yet/);
  assert.throws(() => ctx({ game: GAMES.gaveUp }).actions.giveUp(), /already over/);
  assert.throws(() => ctx({ busy: true }).actions.giveUp(), /Wait for the current answer/);
  assert.throws(() => ctx({ missing: ["giveUp"] }).actions.giveUp(), /not available/);
  const over = ctx({ game: GAMES.won });
  assert.equal(over.actions.inspectTurn(8), GAMES.won.traces[7]);
  assert.deepEqual(over.log, [["inspect", GAMES.won.traces[7], "Play · turn 8 (secret now revealed)"]]);
  assert.throws(() => over.actions.inspectTurn(9), /Turn 9 has no request trace/);
  assert.throws(() => over.actions.inspectTurn("1"), /no request trace/);
  assert.throws(() => over.actions.inspectTurn(0), /no request trace/);
  assert.throws(() => ctx({ game: null }).actions.inspectTurn(1), /no game yet/);
  assert.throws(() => ctx({ game: GAMES.won, missing: ["inspect"] }).actions.inspectTurn(1), /not available/);
  c.refresh();
  assert.deepEqual(c.log.at(-1), ["refresh"]);
  ctx({ missing: ["refresh"] }).refresh();  // no callback: nothing happens
});

// ---------- the page hooks (static/js/play.js) ----------

const turnNode = (turn) => ({ turn: turn.n });

function page(game = GAMES.playing) {
  const LAB = createLab([pack]);
  const S = { game, busy: false, past: [] };
  const HISTORY = playHistoryCtx({ game: () => S.game, busy: () => S.busy, past: () => S.past,
    matches: (item, c) => LAB.matches("play.history", item, c), arrange: (list, c) => LAB.arrange("play.history", list, c) });
  const held = new Map();
  const box = { id: "turns" };
  const replaced = [];
  const section = { replaceWith: (node) => replaced.push(node) };
  const $ = (selector) => (selector === "#turns" ? box : selector === '[data-lab-surface="play.history"]' ? section : null);
  const mount = (target, ...nodes) => { held.set(target, nodes.flat(Infinity).filter(Boolean)); return target; };
  const make = new Function("S", "HISTORY", "LAB", "HISTORY_ID", "$", "mount", "h", "turnNode", "labEnv",
    `${body("shownTurns")}\n${body("resetLab")}\n${body("renderTurns")}\nreturn renderTurns;`);
  const renderTurns = make(S, HISTORY, LAB, "play.history", $, mount, h, turnNode, fakeEnv());
  return { LAB, S, HISTORY, renderTurns, shown: () => held.get(box), replaced };
}

test("renderTurns: with no Lab setting active it lists every turn newest first, exactly as before", () => {
  const p = page();
  p.renderTurns();
  // Before Lab the page rendered [...g.turns].reverse().map(...) and nothing else.
  assert.deepEqual(p.shown(), [...GAMES.playing.turns].reverse().map(turnNode));
  p.S.game = GAMES.fresh;
  p.renderTurns();
  assert.deepEqual(p.shown(), []);
});

test("renderTurns: Lab filters hide turns, a Lab sort reorders them, and the note's reset restores everything", () => {
  const p = page();
  const view = p.LAB.view("play.history");
  view.filters = [{ key: "play-history-insights/kind", op: "is", value: "answered question" }];
  p.renderTurns();
  let shown = p.shown();
  assert.equal(shown[0].attrs.role, "status");
  assert.match(textOf(shown[0]), /Showing 4 of 7 questions: 1 Lab filter or sort setting is active\./);
  assert.deepEqual(shown.slice(1), [{ turn: 6 }, { turn: 4 }, { turn: 2 }, { turn: 1 }]);
  view.sort = { key: "play-history-insights/yes_p", dir: "desc" };
  p.renderTurns();
  shown = p.shown();
  assert.match(textOf(shown[0]), /2 Lab filter or sort settings are active/);
  // P(yes): #4 0.88, #2 0.71, #6 0.58, #1 0.04.
  assert.deepEqual(shown.slice(1), [{ turn: 4 }, { turn: 2 }, { turn: 6 }, { turn: 1 }]);
  view.filters = [{ key: "play-history-insights/kind", op: "is", value: "winning guess" }];
  p.renderTurns();
  shown = p.shown();
  assert.equal(textOf(shown[1]), "No question matches the Lab filters.");
  assert.equal(shown.length, 2);
  fire(find(shown[0], (node) => node.tag === "button"), "click");
  assert.equal(p.LAB.active("play.history"), 0);
  assert.deepEqual(p.shown(), [...GAMES.playing.turns].reverse().map(turnNode));
  assert.equal(p.replaced.length, 1, "the Lab section is drawn again without the cleared settings");
  assert.equal(p.replaced[0].attrs["data-lab-surface"], "play.history");
});

test("renderTurns: does nothing before the first game, and a new turn shows up under an active filter only if it matches", () => {
  const p = page(null);
  p.renderTurns();
  assert.equal(p.shown(), undefined);
  p.S.game = GAMES.playing;
  p.LAB.view("play.history").filters = [{ key: "play-history-insights/kind", op: "is", value: "winning guess" }];
  p.S.game = GAMES.won;
  p.renderTurns();
  assert.deepEqual(p.shown().slice(1), [{ turn: 8 }]);
  assert.match(textOf(p.shown()[0]), /Showing 1 of 8 questions/);
});

test("newGame keeps the finished or played game in this session's past, and nothing else", async () => {
  const run = async (current, next = GAMES.fresh, fail = false) => {
    const S = { game: current, busy: false, past: [] };
    const api = async (path, payload) => { assert.deepEqual([path, payload], ["/api/play/new", {}]); if (fail) throw new Error("offline"); return next; };
    const errors = [];
    const newGame = new Function("S", "api", "render", "$", "handleError", `${body("newGame")}\nreturn newGame;`)(S, api, () => {}, () => null, (error) => errors.push(error.message));
    await newGame();
    return { S, errors };
  };
  assert.deepEqual((await run(null)).S.past, [], "the first game has no predecessor");
  assert.deepEqual((await run(GAMES.fresh)).S.past, [], "an untouched game is not kept");
  const played = await run(GAMES.playing);
  assert.deepEqual([played.S.past, played.S.game], [[GAMES.playing], GAMES.fresh]);
  assert.deepEqual((await run(GAMES.gaveUp)).S.past, [GAMES.gaveUp]);
  const failed = await run(GAMES.playing, GAMES.fresh, true);
  assert.deepEqual([failed.S.past, failed.S.game, failed.errors], [[], GAMES.playing, ["offline"]], "a failed request changes nothing");
  assert.match(body("newGame"), /\.slice\(-20\)/);
});

test("the page installs Lab once after the top bar, hooks the surface and renders its section under the board", () => {
  const boot = body("boot");
  assert.match(boot, /await initChrome\("\/play"\);\n\s*installLab\(LAB\);/);
  assert.equal(PAGE.match(/installLab\(/g).length, 1);
  assert.match(PAGE, /import \{ LAB \} from "\.\/lab\/pages\/play\.js";/);
  assert.match(PAGE, /import \{ installLab, labEnv \} from "\.\/lab\/env\.js";/);
  assert.match(PAGE, /import \{ playHistoryCtx \} from "\.\/lab\/surfaces\/play\.js";/);
  assert.match(PAGE, /matches: \(item, ctx\) => LAB\.matches\(HISTORY_ID, item, ctx\)/);
  assert.match(PAGE, /arrange: \(items, ctx\) => LAB\.arrange\(HISTORY_ID, items, ctx\)/);
  const render = body("render");
  assert.match(render, /h\("div", \{ class: "turns", id: "turns" \}\)/);
  assert.match(render, /LAB\.section\(labEnv, HISTORY_ID, HISTORY\)\);\n\s*renderTurns\(\);/);
  // No Lab callback can send a question: the source passes no ask().
  const source = PAGE.slice(PAGE.indexOf("const HISTORY = playHistoryCtx("), PAGE.indexOf("async function boot"));
  assert.doesNotMatch(source, /\bask\(|api\(/);
});

test("the section renders with the starter pack during and after a game", () => {
  for (const game of [GAMES.playing, GAMES.won, null]) {
    const LAB = createLab([pack]);
    const c = samplePlayHistoryCtx({ game });
    const view = LAB.view("play.history");
    for (const name of ["section", "refine", "checks", "metrics", "exports", "commands"]) view.open[name] = true;
    const env = fakeEnv();
    const tree = LAB.section(env, "play.history", c);
    assert.ok(tree);
    assert.equal(tree.attrs["data-lab-surface"], "play.history");
    if (game !== GAMES.won) assert.ok(!textOf(tree).includes("espresso"), "nothing on screen names the secret during a game");
    assert.equal(LAB.count("play.history"), 47);
  }
  assert.ok(WIN_TURN.kind === "win");
});
