import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/play/play-session-tools.js";
import { runExporter, runMetrics } from "../../../static/js/lab/kit.js";
import { checkPack, fakeEnv, textOf, findAll } from "./harness.mjs";
import { ABANDONED, GAMES, rawTurn, samplePlayHistoryCtx } from "./fixtures/play.mjs";

const ctx = (overrides) => samplePlayHistoryCtx(overrides);
const fresh = () => ctx({ game: GAMES.fresh });
const empty = () => ctx({ game: GAMES.fresh, past: [] });     // nothing played in this page session yet
const feature = (id) => pack.features.find((entry) => entry.id === id);
const at = (attr, value) => (node) => node.attrs?.[attr] === value;
const has = (attr) => (node) => node.attrs?.[attr] !== undefined && node.attrs?.[attr] !== null;

// An earlier game won in four questions (made up for these tests).
const QUICK_WIN = Object.freeze({ id: "g-quick", category: "animal", over: true, won: true, turns_left: 16, secret: "otter",
  turns: [rawTurn(1, "Is it alive?", [0.97, 0.98, 0.02, 0.03], "answer", "Yes"), rawTurn(2, "Does it swim?", [0.93, 0.98, 0.02, 0.04], "answer", "Yes"),
    rawTurn(3, "Is it a fish?", [0.05, 0.97, 0.7, 0.05], "guess", "No, it isn't that."), rawTurn(4, "Is it an otter?", [0.96, 0.98, 0.95, 0.94], "win", "Yes! You got it.")] });

checkPack(pack, {
  // Latencies sorted: 88, 92.4, 95, 97, 101.6, 104, 110. Type-7 position 6 × 0.95 = 5.7 -> 104 + 0.7 × 6 = 108.2.
  // Without #5 (110): position 5 × 0.95 = 4.75 -> 101.6 + 0.75 × 2.4 = 103.4.
  p95_latency: [{ ctx: ctx(), expect: 108.2, tolerance: 1e-12, empty: fresh() }, { ctx: ctx({ hide: [5] }), expect: 103.4, tolerance: 1e-12 }],
  // Food game: Probably (#2) and Yes (#4) are split by an invalid turn, so 1. Repeats game: Yes, Probably not, Yes, Yes.
  yes_streak: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "#2"); }, empty: fresh() },
    { ctx: ctx({ game: GAMES.repeats }), expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "#3 to #4"); } },
    // Harmonica: Yes, No. Odd game: no answer, Probably not, a guess, so no yes-leaning turn at all: 0, not unavailable.
    { ctx: ctx({ game: GAMES.gaveUp }), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "#1"); } },
    { ctx: ctx({ game: GAMES.odd }), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "no Yes or Probably yet"); } }],
  // Harmonica given up, job abandoned, the food game running. A fresh current game does not count yet.
  session_games: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "1 given up, 1 abandoned, 1 in progress"); }, empty: empty() },
    { ctx: ctx({ game: GAMES.fresh }), expect: 2 }],
  // 2 (harmonica) + 1 (job) + 7 (food).
  // A game given up before its first question was played, with 0 questions: the session total is 0, not unavailable.
  session_questions: [{ ctx: ctx(), expect: 10, empty: empty() }, { ctx: ctx({ game: GAMES.won, past: [] }), expect: 8 },
    { ctx: ctx({ game: GAMES.fresh, past: [{ id: "g-quit", category: "animal", turns: [], over: true, won: false, turns_left: 20, secret: "heron" }] }), expect: 0 },
    { ctx: ctx({ game: GAMES.fresh, past: [GAMES.gaveUp] }), expect: 2 }],
  // Won games: the quick win in 4 and the food game in 8 -> 6. The harmonica game was not won.
  mean_to_win: [{ ctx: ctx({ game: GAMES.won, past: [GAMES.gaveUp, QUICK_WIN] }), expect: (result) => { assert.equal(result.value, 6); assert.equal(result.detail, "2 won games"); },
    empty: empty() }, { ctx: ctx({ game: GAMES.gaveUp, past: [QUICK_WIN] }), expect: 4 }],
  // Harmonica 0.000010 + job 0.000007 + food (5 + 6 + 5 + 6 + 5 + 5 + 6 millionths) 0.000038 = 0.000055.
  session_cost: [{ ctx: ctx(), expect: 0.000055, tolerance: 1e-9, empty: empty() }, { ctx: ctx({ game: GAMES.fresh }), expect: 0.000017, tolerance: 1e-9 }],
  // Mean measured cost 0.000038 / 7 per turn, times the 13 questions left. A finished game has none left.
  remaining_estimate: [{ ctx: ctx({ hide: [1] }), expect: (result) => { assert.ok(Math.abs(result.value - (0.000038 / 7) * 13) < 1e-15); assert.equal(result.detail, "estimate for 13 questions"); },
    empty: fresh() }, { ctx: ctx({ game: GAMES.won }), expect: null }],

  turns_json: { ctx: ctx({ hide: [1, 2, 3, 4, 5], order: [7] }), filename: "play-turns.json", excludes: ["espresso", "0.22"],
    check: (out) => {
      const parsed = JSON.parse(out.text);
      assert.deepEqual([parsed.category, parsed.outcome, parsed.turns.map((turn) => turn.n)], ["food", "playing", [6, 7]]);
      assert.deepEqual(parsed.turns[0].probs, { answer_is_yes: 0.58, is_yes_no_question: 0.96, names_a_guess: 0.04, guess_matches: null });
      assert.deepEqual([parsed.turns[1].reply, parsed.turns[1].guess, parsed.turns[1].probs.guess_matches, parsed.turns[1].meta.latency_ms], ["Close, but not quite. Be more specific.", "close", 0.55, 104]);
      assert.equal(out.mime, "application/json");
      assert.throws(() => runExporter(feature("turns_json"), ctx({ game: null })), /no game yet/);
    } },
  // Turn 6 is not a guess, so its match probability stays blank while the game runs.
  probability_md: { ctx: ctx({ hide: [1, 2, 3, 4, 5] }), filename: "play-probabilities.md",
    text: "# 20 Questions · food\n\n| # | Question | Reply | P(yes) | P(yes/no question) | P(guess) | P(match) |\n| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| 6 | is it a drink | Hard to say | 58.0% | 96.0% | 4.0% |  |\n| 7 | Is it coffee? | Close, but not quite. Be more specific. | 90.0% | 97.0% | 81.0% | 55.0% |\n",
    check: () => {
      const won = runExporter(feature("probability_md"), ctx({ game: GAMES.won })).text;
      assert.ok(won.includes("| 4 | Would I find it at Harbor Coffee Co.? | Yes | 88.0% | 98.0% | 11.0% | 41.0% |"), "released after the game");
      assert.ok(!/secret was/i.test(won), "the transcript names no secret line");
      const glacier = runExporter(feature("probability_md"), ctx({ game: GAMES.outOfQuestions })).text;
      assert.ok(glacier.includes("| 20 | Is it ice? | Probably not | 30.0% | 97.0% | 5.0% | 10.0% |"), "the last-question note stays out of the reply");
    } },
  transcript_html: { ctx: ctx({ game: GAMES.gaveUp }), filename: "play-transcript.html",
    text: "<table>\n<thead><tr><th>#</th><th>Question</th><th>Reply</th></tr></thead>\n<tbody>\n"
      + "<tr><td>1</td><td>Is it man-made?</td><td>Yes</td></tr>\n<tr><td>2</td><td>Is it bigger than a car?</td><td>No</td></tr>\n</tbody>\n</table>\n",
    check: () => {
      const tricky = { id: "g-html", category: "object", over: false, won: false, turns_left: 19,
        turns: [rawTurn(1, "Is it <b>big</b> & \"heavy\"?", [0.5, 0.9, 0.02, 0.1], "answer", "Hard to say")] };
      assert.ok(runExporter(feature("transcript_html"), ctx({ game: tricky })).text.includes("<td>Is it &lt;b&gt;big&lt;/b&gt; &amp; &quot;heavy&quot;?</td>"));
      assert.ok(runExporter(feature("transcript_html"), ctx()).text.includes("<td>No, it isn&#39;t that.</td>"));
    } },
  timing_csv: { ctx: ctx({ hide: [1, 2, 3, 4, 5] }), filename: "play-timing.csv", excludes: ["drink", "coffee", "Hard to say"],
    text: '"turn","kind","latency_ms","input_tokens","output_tokens","cost_usd","model","backend"\r\n'
      + '"6","answer","95","119","0","0.000005","jev-1.14.0","sdk"\r\n"7","guess","104","120","0","0.000006","jev-1.14.0","sdk"\r\n' },
  // The job game was abandoned (no secret); the harmonica game was given up: mean latency (90 + 110) / 2.
  session_csv: { ctx: ctx({ game: GAMES.gaveUp, past: [ABANDONED] }), filename: "play-session.csv",
    text: '"game","category","outcome","questions","secret","cost_usd","mean_latency_ms"\r\n'
      + '"1","job","abandoned","1","","0.000007","120"\r\n"2","object","gave_up","2","harmonica","0.00001","100"\r\n',
    check: () => {
      const runningText = runExporter(feature("session_csv"), ctx()).text;
      assert.ok(runningText.includes('"1","object","gave_up","2","harmonica",'), "an ended earlier game's secret is included");
      assert.ok(runningText.includes('"3","food","playing","7","",'), "the running game has no secret");
      assert.ok(!runningText.includes("espresso"));
      assert.throws(() => runExporter(feature("session_csv"), empty()), /No game of this session/);
    } },
  traces_json: { ctx: ctx({ game: GAMES.gaveUp }), filename: "play-traces.json", includes: ['"secret": "harmonica"', '"player_question": "Is it bigger than a car?"'],
    check: (out) => {
      assert.deepEqual(JSON.parse(out.text).map((trace) => trace.request.state.player_question), ["Is it man-made?", "Is it bigger than a car?"]);
      assert.throws(() => runExporter(feature("traces_json"), ctx()), /released when the game ends/);
      assert.throws(() => runExporter(feature("traces_json"), fresh()), /released when the game ends/);
    } },

  // The won food game's slowest turn is #5 (110 ms).
  inspect_slowest: { ctx: () => ctx({ game: GAMES.won, hide: [5] }),
    check: (c) => {
      assert.equal(c.log.length, 1);
      const [name, trace, title] = c.log[0];
      assert.deepEqual([name, trace.request.state.player_question, title], ["inspect", "Is it a croissant?", "Play · turn 5 (secret now revealed)"]);
    },
    hidden: () => ctx() },
  copy_secret: { ctx: () => ctx({ game: GAMES.won }), check: (c) => { assert.deepEqual(c.env.copied, ["espresso"]); assert.deepEqual(c.log, []); }, hidden: () => ctx() },
  redraft_invalid: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["draft", "What colour is it?"]]), hidden: () => ctx({ game: GAMES.won }) },
  copy_known: { ctx: () => ctx({ hide: [1, 2, 3] }),
    check: (c) => {
      assert.deepEqual(c.env.copied, ["Yes: Would I find it at Harbor Coffee Co.?\nProbably: Can you eat it?\nHard to say: is it a drink\nNo: Is it alive?\n"
        + "Close guesses: Is it coffee?\nWrong guesses: Is it a croissant?"]);
      assert.deepEqual(c.log, []);
    },
    hidden: fresh },

  planner: { improvements: {
    add: (t) => {
      const c = ctx();
      let tree = t.render(c);
      t.fire(t.find(tree, at("data-plan", "text")), "input", { target: { value: "  Is it   round? " } });
      t.fire(t.find(tree, at("data-plan", "add")), "click");
      assert.deepEqual(t.state.plan, ["Is it round?"]);
      assert.equal(t.state.text, "");
      tree = t.render(c);
      assert.deepEqual(t.findAll(tree, has("data-plan-item")).map(t.textOf).map((text) => text.split("Up")[0]), ["Is it round?"]);
      t.state.text = "   ";
      t.fire(t.find(tree, at("data-plan", "add")), "click");
      t.state.text = "x".repeat(201);
      t.fire(t.find(t.render(c), at("data-plan", "add")), "click");
      assert.deepEqual(t.state.plan, ["Is it round?"], "blank and over-long questions are refused");
      assert.deepEqual(t.env.toasts, [{ message: "Type a question to plan.", kind: "error" }, { message: "A question can be at most 200 characters.", kind: "error" }]);
      assert.deepEqual(c.log, [], "planning never touches the question box");
    },
    remove: (t) => {
      t.state.plan = ["A?", "B?", "C?"];
      t.fire(t.find(t.render(ctx()), at("data-plan-remove", "1")), "click");
      assert.deepEqual(t.state.plan, ["A?", "C?"]);
      t.fire(t.find(t.render(ctx()), at("data-plan", "clear")), "click");
      assert.deepEqual(t.state.plan, []);
      const tree = t.render(ctx());
      assert.ok(t.find(tree, has("data-plan-empty")));
      assert.equal(t.find(tree, at("data-plan", "clear")), null, "nothing to clear");
    },
    move_up: (t) => {
      t.state.plan = ["A?", "B?", "C?"];
      const tree = t.render(ctx());
      t.fire(t.find(tree, at("data-plan-up", "2")), "click");
      assert.deepEqual(t.state.plan, ["A?", "C?", "B?"]);
      const top = t.find(t.render(ctx()), at("data-plan-up", "0"));
      assert.equal(top.attrs.disabled, true);
      t.fire(top, "click");
      assert.deepEqual(t.state.plan, ["A?", "C?", "B?"], "the first question cannot move up");
    },
    draft: (t) => {
      t.state.plan = ["Is it round?"];
      const c = ctx();
      t.fire(t.find(t.render(c), at("data-plan-draft", "0")), "click");
      assert.deepEqual(c.log, [["draft", "Is it round?"]], "it fills the box and sends nothing");
      const over = ctx({ game: GAMES.won });
      t.fire(t.find(t.render(over), at("data-plan-draft", "0")), "click");
      assert.deepEqual(over.log, []);
      assert.deepEqual(t.env.toasts, [{ message: "This game is over. Start a new one.", kind: "error" }]);
      assert.deepEqual(t.state.plan, ["Is it round?"], "drafting keeps the plan");
    },
    asked: (t) => {
      // "is it alive" is turn 1 of the food game, ignoring case and punctuation.
      t.state.plan = ["is it alive", "Is it round?"];
      const tree = t.render(ctx());
      assert.deepEqual(t.findAll(tree, has("data-plan-item")).map((node) => !!t.find(node, has("data-plan-asked"))), [true, false]);
    },
  } },
  yes_strip: { improvements: {
    bars: (t) => {
      const tree = t.render(ctx({ game: GAMES.gaveUp, order: [2] }));
      const rows = t.findAll(tree, has("data-turn"));
      assert.deepEqual(rows.map((row) => row.attrs["data-turn"]), ["1", "2"], "play order, whatever the Lab sort");
      assert.deepEqual(rows.map((row) => t.find(row, has("data-bar")).attrs["data-bar"]), ["96.0%", "3.0%"]);
      assert.deepEqual(rows.map((row) => row.attrs.title), ["#1 Is it man-made?: 96.0%", "#2 Is it bigger than a car?: 3.0%"]);
      assert.deepEqual(t.findAll(t.render(ctx({ hide: [1, 2, 3, 4, 5, 6] })), has("data-turn")).map((row) => row.attrs["data-turn"]), ["7"], "shown turns only");
      assert.match(t.textOf(t.render(fresh())), /Ask a question to see its P\(yes\)/);
      // The reply cut-offs (data.rules) marked on every bar.
      const food = t.render(ctx());
      const foodRows = t.findAll(food, has("data-turn"));
      assert.equal(foodRows.length, 7);
      for (const row of foodRows) assert.deepEqual(t.findAll(row, has("data-cut")).map((node) => node.attrs["data-cut"]), ["0.15", "0.4", "0.6", "0.85"]);
      // Bar widths are P(yes) as a share of the track: #1 0.04 -> 4%, #7 0.9 -> 90%.
      assert.equal(t.find(foodRows[0], has("data-bar")).attrs.style.width, "4%");
      assert.equal(t.find(foodRows[6], has("data-bar")).attrs.style.width, "90%");
      assert.match(t.textOf(food), /reply cut-offs at 15%, 40%, 60%, 85%/);
    },
  } },
}, { ctx: () => samplePlayHistoryCtx({ game: GAMES.won }) });

test("play-session-tools: nothing it shows during a game holds the secret or a hidden match probability", () => {
  const running = ctx();
  const leaks = ["espresso", "0.41", "0.22", "0.12", "0.01"];
  for (const id of ["turns_json", "probability_md", "transcript_html", "timing_csv", "session_csv"]) {
    const text = runExporter(feature(id), running).text;
    for (const leak of leaks) assert.ok(!text.includes(leak), `${leak} in ${id}`);
  }
  assert.throws(() => runExporter(feature("traces_json"), running), /released when the game ends/);
  for (const row of runMetrics(pack.features.filter((entry) => entry.kind === "metric").map((entry) => [entry.id, entry]), running)) {
    assert.ok(!`${row.text} ${row.detail}`.includes("espresso"), row.label);
  }
  assert.equal(feature("copy_secret").when(running), false);
  assert.throws(() => feature("copy_secret").run(running), /revealed when the game ends/);
  const env = fakeEnv();
  const strip = textOf(feature("yes_strip").render(env.h, running, { state: {}, redraw: () => {}, toast: env.toast, copy: env.copy, download: env.download }));
  for (const leak of leaks) assert.ok(!strip.includes(leak), `${leak} in the strip`);
  assert.equal(findAll(feature("yes_strip").render(env.h, running, { state: {} }), (node) => node.attrs?.["data-bar"] !== undefined).length, 7);
});

test("play-session-tools: the drafting command goes through the page's guards", () => {
  assert.throws(() => feature("redraft_invalid").run(ctx({ busy: true })), /Wait for the current answer/);
  assert.equal(feature("redraft_invalid").when(ctx({ game: GAMES.repeats })), false, "no unread turn to rephrase");
  assert.equal(feature("copy_known").when(ctx({ game: GAMES.odd, hide: [] })), true);
});
