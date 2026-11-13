// Tests for static/js/lab/packs/play/play-panels.js. Reference values are worked out by hand from the fixture games
// (tests/js/lab/fixtures/play.mjs): the running food game is #1 No, #2 Probably, #3 unread, #4 Yes, #5 wrong guess,
// #6 Hard to say, #7 close guess; the session before it holds the harmonica game (given up after 2) and a job game left
// after 1 question.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/play/play-panels.js";
import { ABANDONED, GAMES, rawTurn, samplePlayHistoryCtx } from "./fixtures/play.mjs";
import { checkPack } from "./harness.mjs";

const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const cells = (t, row) => t.findAll(row, (node) => node.tag === "td").map((node) => t.textOf(node));

// Small hand-made games. P(yes) per reply sits inside its band of jev/play.py's cut-offs.
const P = { Yes: 0.9, Probably: 0.7, "Hard to say": 0.5, "Probably not": 0.3, No: 0.1 };
const answer = (n, reply) => rawTurn(n, `Question ${n}?`, [P[reply], 0.97, 0.03, 0.05], "answer", reply);
const running = (replies) => ({ id: "g-test", category: "food", turns: replies.map((reply, index) => answer(index + 1, reply)), over: false, won: false,
  turns_left: 20 - replies.length });
// A won animal game of three questions, and a second one of four.
const quickWin = (questions, secret) => ({ id: `g-${secret}`, category: "animal", over: true, won: true, turns_left: 20 - questions, secret,
  turns: [...Array.from({ length: questions - 1 }, (_, index) => answer(index + 1, "Yes")),
    rawTurn(questions, `Is it a ${secret}?`, [0.95, 0.98, 0.95, 0.93], "win", "Yes! You got it.")] });
const OWL = quickWin(3, "owl"), FOX = quickWin(4, "fox");

const hintsOf = (t, ctx) => t.findAll(t.render(ctx), has("data-hint")).map((node) => [node.attrs["data-hint"], t.textOf(node)]);
const groupOf = (t, tree, name) => t.find(tree, attr("data-group", name));
const groupTurns = (t, tree, name) => t.findAll(groupOf(t, tree, name), has("data-turn")).map(t.textOf);

checkPack(pack, {
  board: { improvements: {
    squares: (t) => {
      const tree = t.render(samplePlayHistoryCtx());
      const marks = t.findAll(tree, has("data-square")).map((node) => node.attrs["data-mark"]);
      assert.equal(marks.length, 20);
      assert.deepEqual(marks.slice(0, 7), ["no", "yes", "unread", "yes", "wrong", "unsure", "close"]);
      assert.ok(marks.slice(7).every((mark) => mark === "left"));
      assert.match(t.textOf(t.find(tree, has("data-board-count"))), /^7 questions asked, 13 left\./);
      const won = t.findAll(t.render(samplePlayHistoryCtx({ game: GAMES.won })), has("data-square")).map((node) => node.attrs["data-mark"]);
      assert.equal(won[7], "win");
      const full = t.findAll(t.render(samplePlayHistoryCtx({ game: GAMES.outOfQuestions })), has("data-square"));
      assert.equal(full.filter((node) => node.attrs["data-mark"] === "left").length, 0);
      assert.match(t.textOf(t.render(samplePlayHistoryCtx({ game: null }))), /Start a game/);
      // The summary lines under the board: yes-leaning #2 Probably and #4 Yes, Hard to say #6, no-leaning #1 No; guesses #5 and #7.
      assert.equal(t.find(tree, has("data-balance")).attrs["data-balance"], "2/1/1");
      assert.equal(t.textOf(t.find(tree, has("data-guesses"))), "2 guesses: #5 wrong, #7 close");
      assert.equal(t.textOf(t.find(t.render(samplePlayHistoryCtx({ game: GAMES.won })), has("data-guesses"))), "3 guesses: #5 wrong, #7 close, #8 right");
      // The odd game: three turns survive the builder (one without a number becomes #1), so 3 asked and 20 - 3 = 17 left.
      assert.match(t.textOf(t.find(t.render(samplePlayHistoryCtx({ game: GAMES.odd })), has("data-board-count"))), /^3 questions asked, 17 left\./);
      // A game record without counts says so instead of printing "null".
      const bare = t.fakeCtx({ items: [], data: { game: { category: "food", over: false } } });
      assert.match(t.textOf(t.find(t.render(bare), has("data-board-count"))), /^Questions asked unknown, questions left unknown\./);
    },
    filtered: (t) => {
      const tree = t.render(samplePlayHistoryCtx({ hide: [2, 6] }));
      const dimmed = t.findAll(tree, attr("data-shown", "false")).map((node) => node.attrs["data-square"]);
      assert.deepEqual(dimmed, ["2", "6"]);
      assert.equal(t.findAll(tree, attr("data-shown", "true")).length, 5);
      assert.equal(t.find(tree, has("data-board-hidden")).attrs["data-board-hidden"], "2");
      assert.equal(t.find(t.render(samplePlayHistoryCtx()), has("data-board-hidden")), null);
    },
  } },

  by_answer: { improvements: {
    groups: (t) => {
      const tree = t.render(samplePlayHistoryCtx());
      assert.deepEqual(["Yes", "Probably", "Hard to say", "Probably not", "No"].map((name) => t.find(groupOf(t, tree, name), has("data-group-count")).attrs["data-group-count"]),
        ["1", "1", "1", "0", "1"]);
      assert.deepEqual(groupTurns(t, tree, "Yes"), ["#4 Would I find it at Harbor Coffee Co.?"]);
      assert.deepEqual(groupTurns(t, tree, "No"), ["#1 Is it alive?"]);
      assert.match(t.textOf(groupOf(t, tree, "Probably not")), /None\./);
      const repeats = t.render(samplePlayHistoryCtx({ game: GAMES.repeats }));
      assert.deepEqual(groupTurns(t, repeats, "Yes"), ["#1 Is it sweet?", "#3 is it SWEET", "#4 Is it sweet?"]);
    },
    guesses: (t) => {
      const tree = t.render(samplePlayHistoryCtx());
      assert.deepEqual(groupTurns(t, tree, "Close guesses"), ["#7 Is it coffee?"]);
      assert.deepEqual(groupTurns(t, tree, "Wrong guesses"), ["#5 Is it a croissant?"]);
      assert.equal(groupOf(t, tree, "Winning guess"), null);
      assert.deepEqual(groupTurns(t, t.render(samplePlayHistoryCtx({ game: GAMES.won })), "Winning guess"), ["#8 Is it an espresso?"]);
      // Turns not read as yes/no questions get a group of their own too, shown only when there is one.
      assert.deepEqual(groupTurns(t, tree, "Not read as yes/no questions"), ["#3 What colour is it?"]);
      assert.equal(groupOf(t, t.render(samplePlayHistoryCtx({ game: GAMES.gaveUp })), "Not read as yes/no questions"), null);
    },
    scope: (t) => {
      const ctx = samplePlayHistoryCtx({ hide: [4, 5] });
      const all = t.render(ctx);
      assert.deepEqual(groupTurns(t, all, "Yes"), ["#4 Would I find it at Harbor Coffee Co.?"]);
      t.fire(t.find(all, attr("data-group-scope", "true")), "change", { target: { value: "shown" } });
      const shown = t.render(ctx);
      assert.deepEqual(groupTurns(t, shown, "Yes"), []);
      assert.equal(groupOf(t, shown, "Wrong guesses"), null);
      assert.deepEqual(groupTurns(t, shown, "Close guesses"), ["#7 Is it coffee?"]);
    },
  } },

  scoreboard: { improvements: {
    table: (t) => {
      const tree = t.render(samplePlayHistoryCtx());
      assert.deepEqual(t.findAll(tree, has("data-game")).map((row) => cells(t, row).slice(1, 4)),
        [["object", "Gave up", "2"], ["job", "Left mid-game", "1"], ["food", "In progress", "7"]]);
      assert.match(t.textOf(t.render(samplePlayHistoryCtx({ game: GAMES.fresh, past: [] }))), /start the scoreboard/);
      // The current game is the last row, in progress; a new game with no question yet is not listed; once won it is.
      const current = t.findAll(tree, attr("data-current", "true"));
      assert.equal(current.length, 1);
      assert.equal(cells(t, current[0])[0], "3 (this game)");
      assert.equal(t.findAll(t.render(samplePlayHistoryCtx({ game: GAMES.fresh })), has("data-game")).length, 2);
      assert.equal(cells(t, t.find(t.render(samplePlayHistoryCtx({ game: GAMES.won })), attr("data-current", "true")))[2], "Won");
      // Secrets: only for games that ended. The running food game's secret (espresso) never appears.
      const secrets = (ctx) => t.findAll(t.render(ctx), has("data-secret")).map(t.textOf);
      assert.deepEqual(secrets(samplePlayHistoryCtx()), ["harmonica", "never revealed", "hidden until the game ends"]);
      assert.deepEqual(secrets(samplePlayHistoryCtx({ game: GAMES.won })), ["harmonica", "never revealed", "espresso"]);
      assert.ok(!JSON.stringify(tree).includes("espresso"), "a running game's secret never appears");
      // Measured cost and mean latency. Harmonica: 2 × 0.000005, (90 + 110) / 2 = 100 ms. Job: 0.000007, 120 ms.
      // Food: 5 + 6 + 5 + 6 + 5 + 5 + 6 = 38 millionths; (92.4 + 101.6 + 88 + 97 + 110 + 95 + 104) / 7 = 688 / 7 = 98.29 ms.
      assert.deepEqual(t.findAll(tree, has("data-game")).map((row) => cells(t, row).slice(5)), [["$0.000010", "100 ms"], ["$0.000007", "120 ms"], ["$0.000038", "98.3 ms"]]);
    },
    best: (t) => {
      const ctx = samplePlayHistoryCtx({ game: GAMES.fresh, past: [GAMES.won, OWL, FOX] });
      assert.equal(t.textOf(t.find(t.render(ctx), has("data-best"))), "Fewest-question win: game 2 (animal) in 3 questions.");
      assert.equal(t.textOf(t.find(t.render(samplePlayHistoryCtx()), has("data-best"))), "No win yet this session.");
    },
    streak: (t) => {
      // Finished games in order: won, won, gave up, (left mid-game: skipped), won; the running game does not count.
      const ctx = samplePlayHistoryCtx({ past: [GAMES.won, OWL, GAMES.gaveUp, ABANDONED, FOX] });
      const node = t.find(t.render(ctx), has("data-streak"));
      assert.equal(node.attrs["data-streak"], "1/2");
      assert.equal(t.textOf(node), "Win streak: 1 now, longest 2.");
      assert.equal(t.textOf(t.find(t.render(samplePlayHistoryCtx()), has("data-streak"))), "Win streak: 0 now, longest 0.");
    },
    categories: (t) => {
      const tree = t.render(samplePlayHistoryCtx({ past: [GAMES.won, OWL, GAMES.gaveUp] }));
      assert.deepEqual(t.findAll(t.find(tree, has("data-categories")), has("data-category")).map((row) => cells(t, row)),
        [["food", "2", "1"], ["animal", "1", "1"], ["object", "1", "0"]]);
    },
  } },

  hints: { improvements: {
    lopsided: (t) => {
      assert.deepEqual(hintsOf(t, samplePlayHistoryCtx({ game: running(["No", "No", "Probably not", "Yes"]) })),
        [["lopsided", "3 of your 4 answers leaned no. Broader questions, which could split what is left about in half, tell you more per question."]]);
      assert.deepEqual(hintsOf(t, samplePlayHistoryCtx({ game: running(["Yes", "Yes", "Probably", "No"]) })),
        [["lopsided", "3 of your 4 answers leaned yes. Narrower questions, which could split what is left about in half, tell you more per question."]]);
      // Two yes-leaning of four answers in the default game is balanced.
      assert.ok(!hintsOf(t, samplePlayHistoryCtx()).some(([id]) => id === "lopsided"));
    },
    early_guess: (t) => {
      // #5 came after 3 answers (#1, #2, #4); #7 after 4 (#6 too), so only #5 is early.
      assert.ok(hintsOf(t, samplePlayHistoryCtx())
        .some(([id, text]) => id === "early_guess" && text === "A guess came before 4 yes/no answers were in (#5). A few more yes/no questions first make a guess more likely to land."));
      assert.ok(!hintsOf(t, samplePlayHistoryCtx({ game: running(["Yes", "No", "Yes"]) })).some(([id]) => id === "early_guess"));
    },
    unclear: (t) => {
      // #3 unread and #6 Hard to say: 2 of 7 turns, 28.6%.
      assert.ok(hintsOf(t, samplePlayHistoryCtx()).some(([id, text]) => id === "unclear"
        && text === "2 of your 7 turns were not read as a yes/no question or got Hard to say (#3, #6). Short questions about one plain property get clearer answers."));
      // 1 of 5 is 20%, under a quarter.
      assert.ok(!hintsOf(t, samplePlayHistoryCtx({ game: running(["Yes", "No", "Hard to say", "No", "Yes"]) })).some(([id]) => id === "unclear"));
    },
    soft: (t) => {
      assert.deepEqual(hintsOf(t, samplePlayHistoryCtx({ game: running(["Probably", "Probably not", "Probably not", "Probably", "Yes", "No"]) })),
        [["soft", "4 answers were Probably or Probably not, against 2 plain Yes or No. Questions about a property that is clearly there or not get firmer answers."]]);
      assert.ok(!hintsOf(t, samplePlayHistoryCtx()).some(([id]) => id === "soft"), "1 Probably against 2 firm answers");
    },
    no_run: (t) => {
      assert.deepEqual(hintsOf(t, samplePlayHistoryCtx({ game: running(["Yes", "Yes", "No", "Probably not", "No"]) })),
        [["no_run", "Your last 3 questions (#3 to #5) all leaned no. Try a different direction."]]);
      assert.ok(!hintsOf(t, samplePlayHistoryCtx({ game: running(["No", "Probably not", "Yes", "No", "No"]) })).some(([id]) => id === "no_run"));
    },
    copy: (t) => {
      t.fire(t.find(t.render(samplePlayHistoryCtx()), attr("data-hints-copy", "true")), "click");
      assert.deepEqual(t.env.copied, [["- A guess came before 4 yes/no answers were in (#5). A few more yes/no questions first make a guess more likely to land.",
        "- 2 of your 7 turns were not read as a yes/no question or got Hard to say (#3, #6). Short questions about one plain property get clearer answers."].join("\n")]);
      const quiet = t.render(samplePlayHistoryCtx({ game: running(["Yes", "No", "Yes"]) }));
      assert.ok(t.find(quiet, attr("data-hint-none", "true")));
      assert.equal(t.find(quiet, attr("data-hints-copy", "true")), null);
      assert.match(t.textOf(t.render(samplePlayHistoryCtx({ game: GAMES.fresh }))), /Ask a few questions/);
    },
  } },
}, { ctx: () => samplePlayHistoryCtx() });
