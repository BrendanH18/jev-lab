import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/play/play-history-insights.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { GAMES, samplePlayHistoryCtx, turnsByN } from "./fixtures/play.mjs";

const ctx = (overrides) => samplePlayHistoryCtx(overrides);
const P = turnsByN(ctx());                              // the running food game, turns 1-7
const W = turnsByN(ctx({ game: GAMES.won }));           // the same game won on turn 8
const O = turnsByN(ctx({ game: GAMES.odd }));           // missing and odd values
const repeatsCtx = ctx({ game: GAMES.repeats });
const R = turnsByN(repeatsCtx);
const fresh = () => ctx({ game: GAMES.fresh });
const feature = (id) => pack.features.find((entry) => entry.id === id);

checkPack(pack, {
  // The odd turn 2 sends P(yes) as the text "0.3", which is not a number.
  yes_p: { items: [P[1], P[3], P[5], O[2]], values: [0.04, 0.31, 0.09, null] },
  question_p: { items: [P[3], P[2], O[1]], values: [0.08, 0.99, null] },
  guess_p: { items: [P[5], P[7], P[1], O[2]], values: [0.93, 0.81, 0.02, null] },
  // Odd turn 2 has a NaN latency and turn 3 an empty meta.
  latency: { items: [P[1], P[5], O[2], O[3]], values: [92.4, 110, null, null] },
  cost: { items: [P[2], P[1], O[2], O[3]], values: [0.000006, 0.000005, 0.000004, null] },
  // "Would I find it at Harbor Coffee Co.?" is eight words; odd turn 1 is blank.
  words: { items: [P[1], P[4], O[1]], values: [3, 8, null] },
  // 0.04 is 0.11 from 15%, 0.88 is 0.03 from 85%, 0.58 is 0.02 from 60%; an invalid turn and a guess have none.
  cutoff_margin: { items: [P[1], P[4], P[6], P[3], P[5]], values: [0.11, 0.03, 0.02, null, null], tolerance: 1e-9 },
  borderline: { items: [P[4], P[6], P[1], P[5]], values: [true, true, false, false] },
  question_mark: { items: [P[1], P[6], O[1]], values: [true, false, false] },
  // #3 "is it SWEET" and #4 repeat #1; #2 is new; and #1 is the first time.
  repeat: { ctx: repeatsCtx, items: [R[1], R[2], R[3], R[4]], values: [false, false, true, true] },
  kind: { items: [P[1], P[3], P[5], W[8], O[1]], values: ["answered question", "not a yes/no question", "wrong or close guess", "winning guess", null] },
  answer: { items: [P[1], P[2], P[6], P[3], P[7]], values: ["No", "Probably", "Hard to say", null, null] },
  question_text: { items: [P[1], P[4], O[1]], values: ["Is it alive?", "Would I find it at Harbor Coffee Co.?", "  "] },

  not_a_question: { hit: P[3], miss: [P[1], P[5], O[1]], message: /P\(yes\/no question\) 8\.0%.*Rephrase/ },
  hard_to_say: { hit: P[6], miss: [P[1], P[2], P[3], P[7]], message: /P\(yes\) was 58\.0%/ },
  repeats: { hitList: repeatsCtx.items(), missList: ctx().items(), message: /^“Is it sweet\?” was asked 3 times \(#1, #3, #4\)\.$/ },

  // Latencies sorted: 88, 92.4, 95, 97, 101.6, 104, 110. Without #4: (95 + 101.6) / 2.
  median_latency: [{ ctx: ctx(), expect: 97, empty: fresh() }, { ctx: ctx({ hide: [4] }), expect: 98.3, tolerance: 1e-9 }],
  // 118 + 120 + 119 + 124 + 121 + 119 + 120; without #4 (124 tokens) 717.
  input_tokens: [{ ctx: ctx(), expect: 841, empty: fresh() }, { ctx: ctx({ hide: [4] }), expect: 717 }],
  // Answered: #1 No, #2 Probably, #4 Yes, #6 Hard to say -> 2 of 4. Without #2: 1 of 3.
  yes_share: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "2 of 4"); }, empty: fresh() },
    { ctx: ctx({ hide: [2] }), expect: 1 / 3, tolerance: 1e-12 }],
  invalid_count: [{ ctx: ctx(), expect: 1, empty: fresh() }, { ctx: ctx({ hide: [3] }), expect: 0 }],
  // (5 + 6 + 5 + 6 + 5 + 5 + 6) millionths over 7 turns, times 20; hiding a turn does not change it. The odd game
  // has one measured cost, 0.000004, so 0.00008.
  full_game_estimate: [
    { ctx: ctx({ hide: [1, 2] }), expect: (result) => { assert.ok(Math.abs(result.value - (0.000038 / 7) * 20) < 1e-15); assert.match(result.detail, /estimate from 7 measured turns/); },
      empty: fresh() },
    { ctx: ctx({ game: GAMES.odd }), expect: 0.00008, tolerance: 1e-9 }],
  // Default: the harmonica game was given up, the job game abandoned (not counted), the current game runs -> 0 of 1.
  // Won now: 1 of 2. With no earlier game and a running one, nothing has finished.
  win_rate: [{ ctx: ctx(), expect: 0, empty: ctx({ past: [] }) },
    { ctx: ctx({ game: GAMES.won }), expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "1 of 2 games"); } },
    { ctx: ctx({ game: GAMES.outOfQuestions, past: [GAMES.won] }), expect: 0.5 }],

  transcript_md: { ctx: ctx(), filename: "play-transcript.md", excludes: ["espresso", "0.41"],
    text: "# 20 Questions · food\n\n| # | Question | Reply |\n| --- | --- | --- |\n"
      + "| 1 | Is it alive? | No |\n| 2 | Can you eat it? | Probably |\n| 3 | What colour is it? | Ask a yes/no question, or name your guess. |\n"
      + "| 4 | Would I find it at Harbor Coffee Co.? | Yes |\n| 5 | Is it a croissant? | No, it isn't that. |\n| 6 | is it a drink | Hard to say |\n"
      + "| 7 | Is it coffee? | Close, but not quite. Be more specific. |\n\nIn progress after 7 questions, 13 left.\n",
    check: () => {
      const run = (overrides) => runExporter(feature("transcript_md"), ctx(overrides)).text;
      const won = run({ game: GAMES.won, hide: [3], order: [8] });
      assert.ok(won.includes("| 8 | Is it an espresso? | Yes! You got it. |\n\nWon in 8 questions. The secret was **espresso**.\n"));
      assert.ok(!won.includes("What colour"), "hidden turns stay out");
      assert.ok(won.indexOf("| 1 |") < won.indexOf("| 8 |"), "play order, whatever the Lab sort");
      const glacier = run({ game: GAMES.outOfQuestions });
      assert.ok(glacier.includes("| 20 | Is it ice? | Probably not |\n\nOut of questions after 20 questions. The secret was **glacier**.\n"));
      assert.ok(run({ game: GAMES.gaveUp }).endsWith("Gave up after 2 questions. The secret was **harmonica**.\n"));
      assert.throws(() => run({ game: null }), /no game yet/);
    } },
  // Turn 6 is not a guess, so its match probability stays blank while the game runs; turn 7 is a guess.
  turns_csv: { ctx: ctx({ hide: [1, 2, 3, 4, 5], order: [7] }), filename: "play-turns.csv",
    text: '"turn","question","kind","reply","p_yes","p_yes_no_question","p_guess","p_match","latency_ms","cost_usd"\r\n'
      + '"6","is it a drink","answer","Hard to say","0.58","0.96","0.04","","95","0.000005"\r\n'
      + '"7","Is it coffee?","guess","Close, but not quite. Be more specific.","0.9","0.97","0.81","0.55","104","0.000006"\r\n',
    check: () => {
      const all = runExporter(feature("turns_csv"), ctx()).text;
      for (const hidden of ["0.41", "0.22", "0.12"]) assert.ok(!all.includes(hidden), `a hidden match probability (${hidden}) leaked`);
      assert.ok(runExporter(feature("turns_csv"), ctx({ game: GAMES.won })).text.includes('"4","Would I find it at Harbor Coffee Co.?","answer","Yes","0.88","0.98","0.11","0.41"'),
        "after the game every match probability is released");
    } },
  result_card: { ctx: ctx(), filename: "play-result.txt", text: "Jev Lab 20 Questions · food\nIn progress after 7 questions, 13 left\n🟥🟩⬜🟩❌🟨🔶\n",
    check: () => {
      const won = runExporter(feature("result_card"), ctx({ game: GAMES.won, hide: [1, 2] })).text;
      assert.equal(won, "Jev Lab 20 Questions · food\nWon in 8 questions\n🟥🟩⬜🟩❌🟨🔶🎯\n", "every turn, whatever is shown");
      assert.ok(!/espresso|croissant|alive/.test(won), "no secret and no question");
      assert.equal(runExporter(feature("result_card"), ctx({ game: GAMES.gaveUp })).text, "Jev Lab 20 Questions · object\nGave up after 2 questions\n🟩🟥\n");
    } },

  focus_question: { ctx: () => ctx(), check: (c) => { assert.deepEqual(c.log, [["focusAsk"]]); assert.deepEqual(c.env.toasts, []); },
    hidden: () => ctx({ game: GAMES.won }) },
  // "Is it alive?" was asked as turn 1, so the next starter question is the second one.
  next_suggestion: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["draft", "Is it bigger than a car?"]]), hidden: () => ctx({ busy: true }) },
  edit_last: { ctx: () => ctx({ order: [1] }), check: (c) => assert.deepEqual(c.log, [["draft", "Is it coffee?"]]), hidden: fresh },
  copy_questions: { ctx: () => ctx({ game: GAMES.gaveUp, hide: [1] }),
    check: (c) => { assert.deepEqual(c.env.copied, ["1. Is it man-made?\n2. Is it bigger than a car?"]); assert.deepEqual(c.log, []); }, hidden: fresh },
  inspect_top: { ctx: () => ctx({ game: GAMES.won, order: [5] }),
    check: (c) => {
      assert.equal(c.log.length, 1);
      const [name, trace, title] = c.log[0];
      assert.deepEqual([name, trace.request.state.player_question, title], ["inspect", "Is it a croissant?", "Play · turn 5 (secret now revealed)"]);
    },
    hidden: () => ctx() },
}, { ctx: () => samplePlayHistoryCtx({ game: GAMES.won }) });

test("play-history-insights: the commands respect the page's guards", async () => {
  const disabled = ctx({ boxDisabled: true });
  await feature("focus_question").run(disabled);
  assert.deepEqual(disabled.env.toasts, [{ message: "The question box is not available right now.", kind: "error" }]);
  const allAsked = ctx({ suggestions: ["Is it alive?", "can you eat it"] });
  assert.equal(feature("next_suggestion").when(allAsked), false, "every starter question was asked, ignoring case and punctuation");
  assert.throws(() => feature("next_suggestion").run(allAsked), /Every starter question/);
  assert.throws(() => feature("edit_last").run(ctx({ busy: true })), /Wait for the current answer/, "drafting goes through the page's busy guard");
  assert.equal(feature("edit_last").when(ctx({ game: GAMES.won })), false, "no drafting once the game is over");
});

test("play-history-insights: nothing it produces during a game holds the secret or a hidden match probability", () => {
  // A running game whose raw turns all carry the secret-bearing match probability; only guess turns may show it.
  const running = ctx();
  const outputs = ["transcript_md", "turns_csv", "result_card"].map((id) => runExporter(feature(id), running).text);
  for (const text of outputs) for (const leak of ["espresso", "0.41", "0.22", "0.12", "0.01"]) assert.ok(!text.includes(leak), `${leak} in ${text}`);
  assert.equal(running.data.secret, null);
});
