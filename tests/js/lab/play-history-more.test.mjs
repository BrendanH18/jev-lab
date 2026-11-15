// Tests of the play-history-more pack on the fixtures of tests/js/lab/fixtures/play.mjs. The running food game (7 turns)
// has answered turns #1 No (0.04), #2 Probably (0.71), #4 Yes (0.88), #6 Hard to say (0.58), the unread #3, and the
// guesses #5 (wrong) and #7 (close). Its latencies sort to 88, 92.4, 95, 97, 101.6, 104, 110 ms, so the median is 97.
// Expected values are worked out by hand from those numbers.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/play/play-history-more.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { GAMES, rawTurn, samplePlayHistoryCtx, turnsByN } from "./fixtures/play.mjs";

const feature = (id) => pack.features.find((entry) => entry.id === id);
const playing = () => samplePlayHistoryCtx();
const fresh = () => samplePlayHistoryCtx({ game: GAMES.fresh });
const won = () => samplePlayHistoryCtx({ game: GAMES.won });
const glacier = () => samplePlayHistoryCtx({ game: GAMES.outOfQuestions });
const food = turnsByN(playing());
const ice = turnsByN(glacier());

const custom = (turns) => samplePlayHistoryCtx({ game: { id: "g-test", category: "food", over: false, won: false, turns_left: 20 - turns.length, turns } });
// "Is it sweet?" answered Yes, then asked again as "is it sweet" and answered No.
const contradicting = custom([
  rawTurn(1, "Is it sweet?", [0.9, 0.98, 0.03, 0.06], "answer", "Yes"),
  rawTurn(2, "Is it a fruit?", [0.2, 0.98, 0.08, 0.04], "answer", "Probably not"),
  rawTurn(3, "is it sweet", [0.1, 0.96, 0.03, 0.06], "answer", "No"),
]);
// Latencies 100, 100, 100, 300 ms: the median is 100, and only 300 is more than twice it.
const slow = custom([1, 2, 3, 4].map((n) => rawTurn(n, `Is it number ${n}?`, [0.5, 0.97, 0.02, 0.01], "answer", "Hard to say", { latency: n === 4 ? 300 : 100 })));
const slowTurns = turnsByN(slow);

checkPack(pack, {
  questions_left: { items: [food[1], food[7], ice[20]], values: [19, 13, 0], ctx: playing() },
  yes_change: { items: [food[1], food[2], food[4], food[6], food[3]], values: [null, 0.67, 0.17, -0.3, null], ctx: playing(), tolerance: 1e-9 },
  latency_ratio: { items: [food[4], food[5], food[3]], values: [1, 110 / 97, 88 / 97], ctx: playing() },
  hedged: { items: [food[2], food[6], food[1], food[5]], values: [true, true, false, false] },
  last_question: { items: [ice[20], ice[19]], values: [true, false] },
  has_number: { items: [{ n: 9, text: "Is it under 5 kg?" }, food[1]], values: [true, false] },
  leaning: { items: [food[1], food[2], food[6], food[3], food[4]], values: ["no", "yes", "unsure", null, "yes"] },
  phase: { items: [ice[1], ice[7], ice[8], ice[14], ice[15], ice[20]], values: ["early", "early", "middle", "middle", "late", "late"], ctx: glacier() },
  reply_text: { items: [food[1], food[3]], values: ["No", "Ask a yes/no question, or name your guess."] },

  contradiction: { hitList: contradicting.items(), missList: samplePlayHistoryCtx({ game: GAMES.repeats }).items(), ctx: contradicting,
    message: /^#1 and #3 ask the same thing but got Yes and No/ },
  two_questions: { hit: { n: 1, text: "Is it big? Is it red?" }, miss: food[1] },
  slow_turn: { hit: slowTurns[4], miss: slowTurns[1], ctx: slow, message: /^Took 300 ms, more than twice this game's median of 100 ms\.$/ },
  long_question: { hit: { n: 1, text: "x".repeat(121) }, miss: { n: 2, text: "x".repeat(120) }, ctx: fakeCtx({}), message: /^121 characters of the 200 allowed/ },

  mean_yes: [
    { ctx: playing(), expect: 2.21 / 4, empty: fresh() },
    { ctx: samplePlayHistoryCtx({ hide: [1] }), expect: (0.71 + 0.88 + 0.58) / 3 },
  ],
  hedged_share: [
    { ctx: playing(), expect: 0.5, empty: fresh() },
    { ctx: samplePlayHistoryCtx({ hide: [2] }), expect: (result) => { assert.ok(Math.abs(result.value - 1 / 3) < 1e-12); assert.equal(result.detail, "1 of 3"); } },
  ],
  first_guess_turn: [
    { ctx: playing(), expect: 5, empty: fresh() },
    { ctx: samplePlayHistoryCtx({ game: GAMES.repeats }), expect: null },
  ],
  mean_words: { ctx: playing(), expect: 30 / 7, empty: fresh() },

  tally_csv: { ctx: playing(), filename: "play-answer-tally.csv",
    text: '"reply","turns"\r\n"Yes","1"\r\n"Probably","1"\r\n"Hard to say","1"\r\n"Probably not","0"\r\n"No","1"\r\n'
      + '"guess (wrong or close)","2"\r\n"win","0"\r\n"not read as a question","1"\r\n' },
  guesses_md: { ctx: playing(), text: "# Guesses\n\n- #5 Is it a croissant? — wrong\n- #7 Is it coffee? — close\n", excludes: ["espresso"],
    check: () => {
      const out = feature("guesses_md").build(won());
      assert.ok(out.endsWith("- #7 Is it coffee? — close\n- #8 Is it an espresso? — right\n"));
      assert.equal(feature("guesses_md").build(fresh()), "# Guesses\n\nNo guess yet.\n");
    } },

  copy_newest_reply: { ctx: playing, hidden: fresh, check: (ctx) => {
    assert.deepEqual(ctx.env.copied, ["Close, but not quite. Be more specific."]);
  } },
  read_tally: { ctx: playing, hidden: fresh, check: (ctx) => {
    assert.equal(ctx.env.toasts[0].message, "Yes 1, Probably 1, Hard to say 1, Probably not 0, No 1; 2 wrong or close guesses, 1 turn not read as a question.");
    const done = won();
    feature("read_tally").run(done);
    assert.equal(done.env.toasts[0].message, "Yes 1, Probably 1, Hard to say 1, Probably not 0, No 1; 2 wrong or close guesses, the winning guess, 1 turn not read as a question.");
    const plain = samplePlayHistoryCtx({ game: GAMES.repeats });
    feature("read_tally").run(plain);
    assert.equal(plain.env.toasts[0].message, "Yes 3, Probably 0, Hard to say 0, Probably not 1, No 0.");
  } },
  inspect_first: { ctx: won, hidden: playing, check: (ctx) => {
    assert.equal(ctx.log.length, 1);
    assert.equal(ctx.log[0][0], "inspect");
    assert.equal(ctx.log[0][1].request.state.player_question, "Is it alive?");
  } },
}, { ctx: playing });
