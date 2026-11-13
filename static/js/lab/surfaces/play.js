// Lab surfaces of the Play page (static/js/play.js): the ctx a pack on "play.history" receives.
// Pure code: no DOM, storage or network. Everything is read through the source's callbacks at call time, so the
// page builds ONE ctx for the whole page session and it never goes stale.
//
// ============================== CONTRACT FOR PACK AUTHORS ==============================
//
// SURFACE "play.history" (builder: playHistoryCtx, fixture: tests/js/lab/fixtures/play.mjs samplePlayHistoryCtx)
//   The turns of the CURRENT game of 20 Questions: what the player typed and what their own call answered.
//   The list is READ-ONLY. There is no replaceItems and no importItems, so transforms and importers do not render
//   here: a turn is the record of a call the user made, and an edited or pasted turn would be a made-up answer.
//   Kinds this surface hosts: fact, diagnostic, metric, exporter, command, tool, panel (and behavior).
//   Starter pack: static/js/lab/packs/play/play-history-insights.js (copy its tests: tests/js/lab/play-history-insights.test.mjs).
//   Fixture games (tests/js/lab/fixtures/play.mjs GAMES): fresh, playing (default, 7 turns of every kind but win),
//   won, gaveUp, outOfQuestions (20 turns, last-question note), repeats, odd (missing and malformed values); PAST holds
//   a given-up and an abandoned earlier game; turnsByN(ctx) keys items by turn number.
//
// ITEM  one turn, a fresh plain object (JSON-serializable, frozen with its probs and meta):
//   { n,              integer >= 1: the turn number the page shows as "#n". Unique; 1 is the first question.
//     text,           string: the player's text as the server kept it (whitespace collapsed, at most 200 characters)
//     kind,           "answer" | "guess" | "invalid" | "win", or null when the server sent none
//                       answer  a yes/no question that got one of the five answers
//                       guess   the player named a thing and it was wrong or only close
//                       invalid neither a yes/no question nor a guess; the reply asks for one
//                       win     the player named the secret; always the last turn of a won game
//     reply,          string: exactly what the page shows, including " That was your last question." on turn 20
//     answer,         "Yes" | "Probably" | "Hard to say" | "Probably not" | "No" for kind "answer" (the reply without
//                     the last-question note), otherwise null
//     guess,          "right" (kind win) | "close" | "wrong" (kind guess), otherwise null
//     last_question,  boolean: the reply carries the last-question note (turn 20 of a game that was not won)
//     probs: {        the four Noul probabilities of this turn's request, each a number 0..1 or null when missing
//       answer_is_yes, is_yes_no_question, names_a_guess,
//       guess_matches   null WHILE THE GAME RUNS unless names_a_guess >= 0.6 (the page shows "match" only then; on
//                       any other turn it would hint at the secret). Once the game is over it is always the number.
//     },
//     meta: {         about the call; every field is null when the server sent none
//       model (string), latency_ms (number), question_count (integer, 4), input_tokens (integer),
//       output_tokens (integer), cost_usd (number, measured), backend (string)
//     } }
//   items()  every turn in PAGE ORDER: newest first (the page lists the latest turn on top). For play order sort a
//            copy by n ascending. [] before the first game loads and before the first question.
//   shown()  items() minus what Lab filters hide, then in Lab's sort order when one is set. The page has no filter
//            or sort of its own. Items keep their identity between items() and shown() while the game is unchanged.
//   itemName(item) is "#n". refresh() re-renders the turn list only: the question box keeps its text and focus.
//
// DATA  ctx.data is computed at every read and frozen; read it, never keep it across calls.
//   game         null until the first game has loaded, then
//                { category,     string: the hint the page shows ("animal", "food", ...)
//                  over,         boolean
//                  won,          boolean
//                  outcome,      "playing" | "won" | "gave_up" | "out_of_questions"
//                  asked,        integer: turns so far
//                  turns_left }  integer: questions left (20 - asked)
//                The game id is deliberately not here: it is the server's handle for asking in this game.
//   secret       null until the game is over (won, given up or out of questions), then the secret word
//   traces       null until the game is over, then one { request, response, meta } per turn IN PLAY ORDER
//                (traces[n - 1] belongs to turn n). request.state.secret holds the secret. A frozen deep copy: the
//                page's own Inspect button keeps the originals.
//   past         the earlier games of THIS page session, oldest first, at most the last 20; [] before the first
//                "New game" / "Play again". One frozen record per game that had a question or had ended:
//                { category,        string hint the page showed
//                  outcome,         "won" | "gave_up" | "out_of_questions" | "abandoned" (left by New game mid-game)
//                  asked,           integer: questions asked in it
//                  secret,          the secret word for a game that ENDED; null for an abandoned game (the server
//                                   never sent it, and nothing may guess it)
//                  cost_usd,        number: measured cost of its calls summed, or null when no turn had a cost
//                  mean_latency_ms  number: mean measured latency of its turns, or null when none had one }
//                The current game is never in past.
//   busy         boolean: a question is on its way to the server
//   suggestions  the page's starter questions (strings), which it offers as chips before the first question
//   answers      ["Yes", "Probably", "Hard to say", "Probably not", "No"], from yes to no
//   rules        the cut-offs jev/play.py applies, as the page's side panel explains them:
//                { yes: 0.85, probably: 0.6, probably_not: 0.4, no: 0.15    on answer_is_yes
//                  guess: 0.6             names_a_guess at or above this makes the turn a guess
//                  match: 0.7, mismatch: 0.3   guess_matches at or above match wins; at or below mismatch is "wrong"
//                  yes_no_question: 0.5   below this (and not a guess) the turn is "invalid"
//                  max_turns: 20, max_question_chars: 200 }
//
// ACTIONS  the page's own operations. None of them asks the model: a pack NEVER sends a question.
//   draftQuestion(text)  Puts text in the question box and focuses it. The player still has to press Enter or Ask.
//                        Whitespace is collapsed like the server does. Throws an Error with a message for the user
//                        when the text is blank or longer than 200 characters, when there is no game, when the
//                        game is over, or while an answer is pending. Returns the text it placed.
//   focusQuestion()      Focuses the question box. Returns false (and does nothing) when there is no game, the game
//                        is over or an answer is pending.
//   newGame()            The page's "New game" / "Play again": drops the current game WITHOUT revealing its secret
//                        and asks the server for a new one (no model call). Throws while an answer is pending.
//                        Returns the page's promise.
//   giveUp()             The page's "Give up & reveal": ends the game and reveals the secret (no model call). Throws
//                        when there is no game, the game is already over, or an answer is pending.
//   inspectTurn(n)       Opens the page's Inspect JSON drawer on turn n's request and response. Throws until the
//                        game is over ("released when the game ends") and when turn n has no trace.
//
// CONTENT BOUNDARIES
//   - NEVER reveal or narrow down the secret before the game ends. The ctx gives a running game nothing that holds
//     it (secret and traces are null, guess_matches is null where the page hides it), and a pack must not work
//     around that: no bundled word list, no "likely secrets", no hint derived from anything but the turns shown.
//   - After the game ends an export or metric MAY contain the secret and the traces, and its label or help must say
//     so. Anything that can run during a game must behave the same with data.secret === null.
//   - Every probability, reply, latency and cost here comes from a call the current user made in this page session.
//     Show them as they are; never store them, never replay them into a later game, never fill a gap with a guess.
//   - cost_usd and token counts are measured values of calls already made. A projection for questions not asked
//     yet is an estimate and must be labeled as one, never shown as spend.
//   - Exports hold what the label says and nothing else; CSV goes through csvText/csvCell (formula escaping).
//   - Lab filters and sorts are presentation only. They never change the game, the question count or what the
//     server knows, and the page shows a "Showing x of y" note with a reset while one is active (and "No question
//     matches the Lab filters." when nothing is left).
//   - Do not duplicate what the page shows: per turn P(yes), yes/no-question, guess, match (guess turns only) and
//     latency; for the game questions left, mean latency ("avg") and game cost; the starter chips; Give up & reveal,
//     New game / Play again, and Inspect the LAST turn's JSON after the game.

const LAST_QUESTION = " That was your last question.";
const ANSWERS = Object.freeze(["Yes", "Probably", "Hard to say", "Probably not", "No"]);
// Mirrors jev/play.py (reply_for, Games.ask, MAX_TURNS); tests/js/lab/surface-demo-play.test.mjs keeps them in step.
const RULES = Object.freeze({ yes: 0.85, probably: 0.6, probably_not: 0.4, no: 0.15, guess: 0.6, match: 0.7, mismatch: 0.3,
  yes_no_question: 0.5, max_turns: 20, max_question_chars: 200 });

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const integer = (value) => (Number.isInteger(value) ? value : null);
const text = (value) => (typeof value === "string" && value !== "" ? value : null);

function turnItem(turn, index, over) {
  const probs = turn.probs && typeof turn.probs === "object" ? turn.probs : {};
  const meta = turn.meta && typeof turn.meta === "object" ? turn.meta : {};
  const kind = text(turn.kind);
  const reply = typeof turn.reply === "string" ? turn.reply : "";
  const last = reply.endsWith(LAST_QUESTION);
  const plain = last ? reply.slice(0, -LAST_QUESTION.length) : reply;
  const guessing = number(probs.names_a_guess);
  return Object.freeze({
    n: Number.isInteger(turn.n) && turn.n >= 1 ? turn.n : index + 1,
    text: typeof turn.text === "string" ? turn.text : "",
    kind,
    reply,
    answer: kind === "answer" && ANSWERS.includes(plain) ? plain : null,
    guess: kind === "win" ? "right" : kind === "guess" ? (plain.startsWith("Close") ? "close" : "wrong") : null,
    last_question: last,
    probs: Object.freeze({
      answer_is_yes: number(probs.answer_is_yes),
      is_yes_no_question: number(probs.is_yes_no_question),
      names_a_guess: guessing,
      // The page shows the match probability only on a turn it treats as a guess. Anywhere else it could give the
      // secret away, so it stays out of reach until the game is over.
      guess_matches: over || (guessing !== null && guessing >= RULES.guess) ? number(probs.guess_matches) : null,
    }),
    meta: Object.freeze({
      model: text(meta.model),
      latency_ms: number(meta.latency_ms),
      question_count: integer(meta.question_count),
      input_tokens: integer(meta.input_tokens),
      output_tokens: integer(meta.output_tokens),
      cost_usd: number(meta.cost_usd),
      backend: text(meta.backend),
    }),
  });
}

function outcomeOf(game, asked) {
  if (!game.over) return "playing";
  if (game.won) return "won";
  return asked >= RULES.max_turns ? "out_of_questions" : "gave_up";
}

// A frozen deep copy of plain JSON data, so a pack cannot change what the page holds.
function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === "object") return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozenCopy(entry)])));
  return value;
}

// One earlier game of the session, or null when it had no question and had not ended.
function pastRecord(game) {
  if (!game || typeof game !== "object") return null;
  const turns = Array.isArray(game.turns) ? game.turns.filter((turn) => turn && typeof turn === "object") : [];
  if (!turns.length && !game.over) return null;
  const costs = turns.map((turn) => number(turn.meta?.cost_usd)).filter((value) => value !== null);
  const latencies = turns.map((turn) => number(turn.meta?.latency_ms)).filter((value) => value !== null);
  return Object.freeze({
    category: typeof game.category === "string" ? game.category : "",
    outcome: game.over ? outcomeOf(game, turns.length) : "abandoned",
    asked: turns.length,
    secret: game.over && typeof game.secret === "string" ? game.secret : null,
    cost_usd: costs.length ? costs.reduce((total, value) => total + value, 0) : null,
    mean_latency_ms: latencies.length ? latencies.reduce((total, value) => total + value, 0) / latencies.length : null,
  });
}

// source: {
//   game()          the page's current public game object (the server's response), or null before the first loads
//   busy()          whether a question is in flight
//   suggestions     the page's starter questions
//   past()          the page's earlier games of this session (raw server objects, oldest first)
//   matches(item, ctx), arrange(items, ctx)   the Lab hooks: LAB.matches / LAB.arrange for "play.history"
//   refresh()       re-render the turn list
//   draft(text)     put text in the question box and focus it; false when the box is missing or disabled
//   focusAsk()      focus the question box; false when it is missing or disabled
//   newGame(), giveUp()                       the page's own handlers
//   inspect(trace, title)                     the page's Inspect JSON drawer
// }
export function playHistoryCtx(source = {}) {
  const game = () => {
    const value = source.game ? source.game() : null;
    return value && typeof value === "object" ? value : null;
  };
  const busy = () => !!(source.busy && source.busy());
  const turnsOf = (value) => (value && Array.isArray(value.turns) ? value.turns.filter((turn) => turn && typeof turn === "object") : []);
  // One item per raw turn object, so items() and shown() hand out the same objects while the game is unchanged.
  const cache = new WeakMap();
  const itemFor = (turn, index, over) => {
    const known = cache.get(turn);
    if (known && known.over === over && known.index === index) return known.item;
    const item = turnItem(turn, index, over);
    cache.set(turn, { over, index, item });
    return item;
  };

  const items = () => {
    const current = game();
    const turns = turnsOf(current);
    const out = [];
    for (let index = turns.length - 1; index >= 0; index--) out.push(itemFor(turns[index], index, !!current.over));
    return out;
  };
  const pending = () => { if (busy()) throw new Error("Wait for the current answer first."); };
  // Copies are made once per raw array, so repeated reads of data hand out the same frozen values.
  const traceCopies = new WeakMap();
  const tracesOf = (raw) => {
    if (!traceCopies.has(raw)) traceCopies.set(raw, frozenCopy(raw));
    return traceCopies.get(raw);
  };
  const pastRecords = new WeakMap();
  const past = () => {
    const raw = source.past ? source.past() : null;
    if (!Array.isArray(raw)) return Object.freeze([]);
    const out = [];
    for (const game of raw.slice(-20)) {
      if (!game || typeof game !== "object") continue;
      if (!pastRecords.has(game)) pastRecords.set(game, pastRecord(game));
      const record = pastRecords.get(game);
      if (record) out.push(record);
    }
    return Object.freeze(out);
  };

  const ctx = {
    items,
    shown() {
      const list = items().filter((item) => !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    get data() {
      const current = game();
      const asked = turnsOf(current).length;
      const over = !!current?.over;
      return Object.freeze({
        game: current ? Object.freeze({ category: typeof current.category === "string" ? current.category : "", over, won: !!current.won,
          outcome: outcomeOf(current, asked), asked,
          turns_left: Number.isInteger(current.turns_left) ? current.turns_left : Math.max(0, RULES.max_turns - asked) }) : null,
        secret: over && typeof current.secret === "string" ? current.secret : null,
        traces: over && Array.isArray(current.traces) ? tracesOf(current.traces) : null,
        past: past(),
        busy: busy(),
        suggestions: Object.freeze([...(Array.isArray(source.suggestions) ? source.suggestions : [])].filter((entry) => typeof entry === "string")),
        answers: ANSWERS,
        rules: RULES,
      });
    },
    actions: {
      draftQuestion(value) {
        const clean = String(value ?? "").split(/\s+/).filter(Boolean).join(" ");
        if (!clean) throw new Error("There is no question to put in the box.");
        if ([...clean].length > RULES.max_question_chars) throw new Error(`A question can be at most ${RULES.max_question_chars} characters.`);
        const current = game();
        if (!current) throw new Error("There is no game yet.");
        if (current.over) throw new Error("This game is over. Start a new one.");
        pending();
        if (!source.draft || source.draft(clean) === false) throw new Error("The question box is not available.");
        return clean;
      },
      focusQuestion() {
        const current = game();
        if (!current || current.over || busy() || !source.focusAsk) return false;
        return source.focusAsk() !== false;
      },
      newGame() {
        pending();
        if (!source.newGame) throw new Error("A new game cannot be started here.");
        return source.newGame();
      },
      giveUp() {
        const current = game();
        if (!current) throw new Error("There is no game yet.");
        if (current.over) throw new Error("This game is already over.");
        pending();
        if (!source.giveUp) throw new Error("Giving up is not available here.");
        return source.giveUp();
      },
      inspectTurn(n) {
        const current = game();
        if (!current) throw new Error("There is no game yet.");
        if (!current.over || !Array.isArray(current.traces)) throw new Error("Request traces are released when the game ends.");
        const trace = Number.isInteger(n) && n >= 1 ? current.traces[n - 1] : null;
        if (!trace || typeof trace !== "object") throw new Error(`Turn ${n} has no request trace.`);
        if (!source.inspect) throw new Error("The request inspector is not available here.");
        source.inspect(trace, `Play · turn ${n} (secret now revealed)`);
        return trace;
      },
    },
    refresh() { if (source.refresh) source.refresh(); },
    itemName: (item) => `#${item && item.n !== undefined && item.n !== null ? item.n : "?"}`,
  };
  return ctx;
}
