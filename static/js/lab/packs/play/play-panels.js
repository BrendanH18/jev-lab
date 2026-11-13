// Panels for the Play page's turn list ("play.history", contract: static/js/lab/surfaces/play.js): a board of the
// current game, its questions grouped by the answer they got, a scoreboard of this page session's games and strategy
// hints worked out from the user's own turns. Nothing here asks the model or sends a question. No panel reads
// data.traces or a match probability, and the scoreboard names a secret only for a game that ENDED (data.secret of the
// current game once it is over, the secret field of an earlier game that ended), so nothing can hint at a running
// game's secret. The hints are local advice about questioning style, never about what the secret might be.
import { definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const playOrder = (items) => items.slice().sort((a, b) => a.n - b.n);
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? ctx.items() : []);
const pastOf = (ctx) => (Array.isArray(ctx?.data?.past) ? ctx.data.past.filter((game) => game && typeof game === "object") : []);
const ANSWERS = ["Yes", "Probably", "Hard to say", "Probably not", "No"];
const answersOf = (ctx) => (Array.isArray(ctx?.data?.answers) && ctx.data.answers.length ? ctx.data.answers : ANSWERS);
const YES_LEANING = new Set(["Yes", "Probably"]);
const NO_LEANING = new Set(["No", "Probably not"]);
const FIRM = new Set(["Yes", "No"]);
const SOFT = new Set(["Probably", "Probably not"]);
const answered = (item) => item?.kind === "answer" && typeof item.answer === "string";
const NO_GAME = "Start a game to see this. It only uses the turns of your own games in this page session.";

// The board's mark for a turn: what kind of square it is and a one-character label.
function markOf(item) {
  if (item.kind === "win") return ["win", "W"];
  if (item.kind === "guess") return [item.guess === "close" ? "close" : "wrong", "G"];
  if (item.kind === "invalid") return ["unread", "–"];
  if (YES_LEANING.has(item.answer)) return ["yes", "Y"];
  if (NO_LEANING.has(item.answer)) return ["no", "N"];
  if (item.answer === "Hard to say") return ["unsure", "?"];
  return ["other", "·"];
}

const OUTCOMES = { won: "Won", gave_up: "Gave up", out_of_questions: "Out of questions", abandoned: "Left mid-game", playing: "In progress" };
const ENDED = new Set(["won", "gave_up", "out_of_questions"]);
const usd = (value) => `$${value.toFixed(6)}`;
const ms = (value) => `${Number(value.toFixed(1))} ms`;
const total = (values) => values.reduce((sum, value) => sum + value, 0);

// One scoreboard row per game of the session: earlier games, then the current one once it has a question or has ended.
function sessionGames(ctx) {
  const rows = pastOf(ctx).map((game) => ({ category: String(game.category ?? ""), outcome: String(game.outcome ?? ""), asked: finite(game.asked),
    secret: ENDED.has(game.outcome) && typeof game.secret === "string" ? game.secret : null, cost: finite(game.cost_usd), latency: finite(game.mean_latency_ms), current: false }));
  const game = ctx?.data?.game;
  if (game && (game.asked > 0 || game.over)) {
    const items = itemsOf(ctx);
    const costs = items.map((item) => finite(item?.meta?.cost_usd)).filter((value) => value !== null);
    const latencies = items.map((item) => finite(item?.meta?.latency_ms)).filter((value) => value !== null);
    rows.push({ category: String(game.category ?? ""), outcome: game.over ? game.outcome : "playing", asked: finite(game.asked),
      secret: game.over && typeof ctx.data.secret === "string" ? ctx.data.secret : null,
      cost: costs.length ? total(costs) : null, latency: latencies.length ? total(latencies) / latencies.length : null, current: true });
  }
  return rows.map((row, index) => ({ ...row, number: index + 1 }));
}

function secretCell(row) {
  if (row.secret !== null) return row.secret;
  if (row.outcome === "playing") return "hidden until the game ends";
  if (row.outcome === "abandoned") return "never revealed";
  return "—";
}

// Local, advisory hints about questioning style, worked out from the turns of the current game only.
const HINT_MIN_ANSWERS = 4;
const LOPSIDED = 0.75;
const EARLY_GUESS = 4;
const UNCLEAR = 0.25;
const NO_RUN = 3;
function hintsOf(ctx) {
  const turns = playOrder(itemsOf(ctx));
  const out = [];
  const replies = turns.filter(answered);
  if (replies.length >= HINT_MIN_ANSWERS) {
    const yes = replies.filter((item) => YES_LEANING.has(item.answer)).length, no = replies.filter((item) => NO_LEANING.has(item.answer)).length;
    if (no / replies.length >= LOPSIDED) {
      out.push(["lopsided", `${no} of your ${replies.length} answers leaned no. Broader questions, which could split what is left about in half, tell you more per question.`]);
    } else if (yes / replies.length >= LOPSIDED) {
      out.push(["lopsided", `${yes} of your ${replies.length} answers leaned yes. Narrower questions, which could split what is left about in half, tell you more per question.`]);
    }
  }
  const early = turns.filter((item) => item.kind === "guess" && turns.filter((other) => other.n < item.n && answered(other)).length < EARLY_GUESS);
  if (early.length) {
    out.push(["early_guess", `${early.length === 1 ? "A guess" : `${early.length} guesses`} came before ${EARLY_GUESS} yes/no answers were in `
      + `(${early.map((item) => `#${item.n}`).join(", ")}). A few more yes/no questions first make a guess more likely to land.`]);
  }
  if (turns.length >= 4) {
    const unclear = turns.filter((item) => item.kind === "invalid" || item.answer === "Hard to say");
    if (unclear.length / turns.length >= UNCLEAR) {
      out.push(["unclear", `${unclear.length} of your ${turns.length} turns were not read as a yes/no question or got Hard to say `
        + `(${unclear.map((item) => `#${item.n}`).join(", ")}). Short questions about one plain property get clearer answers.`]);
    }
  }
  const soft = replies.filter((item) => SOFT.has(item.answer)).length, firm = replies.filter((item) => FIRM.has(item.answer)).length;
  if (replies.length >= 3 && soft > firm) {
    out.push(["soft", `${soft} answers were Probably or Probably not, against ${firm} plain Yes or No. Questions about a property that is clearly there or not get firmer answers.`]);
  }
  const tail = turns.slice(-NO_RUN);
  if (tail.length === NO_RUN && tail.every((item) => answered(item) && NO_LEANING.has(item.answer))) {
    out.push(["no_run", `Your last ${NO_RUN} questions (#${tail[0].n} to #${tail[tail.length - 1].n}) all leaned no. Try a different direction.`]);
  }
  return out;
}

const SQUARE = { width: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--line-strong)",
  borderRadius: "4px", fontSize: "12px" };

export default definePack({
  id: "play-panels",
  surface: "play.history",
  title: "Play panels",
  about: "A board of the current game, its questions grouped by answer, a scoreboard of this page session's games and local strategy hints from your own turns. "
    + "Nothing here asks the model; a secret appears only for a game that has ended, and the hints are about questioning style, never about the secret.",
  features: [
    { id: "board", kind: "panel", title: "Game board",
      improvements: [
        { id: "squares", title: "Show the game as a board of 20 squares: one mark per question asked, blank squares for those left" },
        { id: "filtered", title: "Dim the board squares of turns that a Lab filter hides" },
      ],
      render: (h, ctx) => {
        const game = ctx.data?.game;
        if (!game) return h("p", { class: "faint" }, NO_GAME);
        const turns = playOrder(itemsOf(ctx));
        const shown = new Set(typeof ctx.shown === "function" ? ctx.shown() : turns);
        const size = Math.max(finite(ctx.data?.rules?.max_turns) || 20, turns.length);
        const byN = new Map(turns.map((item) => [item.n, item]));
        const squares = Array.from({ length: size }, (_, index) => {
          const item = byN.get(index + 1);
          if (!item) return h("span", { "data-square": String(index + 1), "data-mark": "left", title: `#${index + 1}: not asked`, style: { ...SQUARE, opacity: "0.5" } }, "");
          const [mark, label] = markOf(item);
          const visible = shown.has(item);
          return h("span", { "data-square": String(index + 1), "data-mark": mark, "data-shown": visible ? "true" : "false", title: `#${item.n} ${item.text}: ${item.reply}`,
            style: { ...SQUARE, opacity: visible ? "1" : "0.35" } }, label);
        });
        const replies = turns.filter(answered);
        const yes = replies.filter((item) => YES_LEANING.has(item.answer)).length;
        const no = replies.filter((item) => NO_LEANING.has(item.answer)).length;
        const unsure = replies.length - yes - no;
        const guesses = turns.filter((item) => item.kind === "guess" || item.kind === "win");
        const hiddenCount = turns.filter((item) => !shown.has(item)).length;
        return h("div", { style: { display: "grid", gap: "8px" } },
          h("p", { class: "faint", "data-board-count": "true" }, `${Number.isInteger(game.asked) ? `${plural(game.asked, "question")} asked` : "Questions asked unknown"}, `
            + `${Number.isInteger(game.turns_left) ? `${game.turns_left} left` : "questions left unknown"}. Y yes-leaning, N no-leaning, ? Hard to say, `
            + "G guess, W the winning guess, – not read as a yes/no question."),
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px" } }, squares),
          hiddenCount ? h("p", { class: "faint", "data-board-hidden": String(hiddenCount) }, `${plural(hiddenCount, "square")} dimmed: a Lab filter hides ${hiddenCount === 1 ? "that turn" : "those turns"}.`) : null,
          h("div", { "data-balance": `${yes}/${unsure}/${no}` },
            replies.length ? [h("div", { style: { display: "flex", height: "10px", borderRadius: "3px", overflow: "hidden", background: "var(--track)" } },
              h("div", { style: { width: `${(yes / replies.length) * 100}%`, background: "var(--series)" } }),
              h("div", { style: { width: `${(unsure / replies.length) * 100}%`, background: "var(--track)" } }),
              h("div", { style: { width: `${(no / replies.length) * 100}%`, background: "var(--line-strong)" } })),
            h("p", {}, `Yes-leaning ${yes} · Hard to say ${unsure} · No-leaning ${no}`)]
              : h("p", { class: "faint" }, "No yes/no question has been answered yet.")),
          h("p", { "data-guesses": String(guesses.length) }, guesses.length
            ? `${guesses.length} ${guesses.length === 1 ? "guess" : "guesses"}: ${guesses.map((item) => `#${item.n} ${item.guess === "right" ? "right" : item.guess === "close" ? "close" : "wrong"}`).join(", ")}`
            : "No guesses yet."));
      } },

    { id: "by_answer", kind: "panel", title: "Questions by answer",
      improvements: [
        { id: "groups", title: "Group this game's questions under the five answers, with a count per answer" },
        { id: "guesses", title: "List close, wrong and winning guesses in their own groups" },
        { id: "scope", title: "Group every turn of the game or only the turns the Lab filters show" },
      ],
      render: (h, ctx, api) => {
        if (!ctx.data?.game) return h("p", { class: "faint" }, NO_GAME);
        const shownOnly = api.state.scope === "shown";
        const turns = playOrder(shownOnly && typeof ctx.shown === "function" ? ctx.shown() : itemsOf(ctx));
        const groups = [...answersOf(ctx).map((answer) => [answer, turns.filter((item) => item.kind === "answer" && item.answer === answer)]),
          ["Close guesses", turns.filter((item) => item.guess === "close")], ["Wrong guesses", turns.filter((item) => item.guess === "wrong")],
          ["Winning guess", turns.filter((item) => item.guess === "right")], ["Not read as yes/no questions", turns.filter((item) => item.kind === "invalid")]];
        const answers = answersOf(ctx);
        return h("div", {},
          h("label", {}, "Group ", h("select", { "data-group-scope": "true", value: shownOnly ? "shown" : "all", "aria-label": "Turns to group",
            onchange: (event) => { api.state.scope = event.target.value; api.redraw(); } },
          h("option", { value: "all", selected: !shownOnly }, "every turn"), h("option", { value: "shown", selected: shownOnly }, "shown turns only"))),
          groups.filter(([name, list]) => list.length || answers.includes(name)).map(([name, list]) => h("div", { "data-group": name },
            h("div", { class: "row lab-row" }, h("b", {}, name), h("span", { class: "badge", "data-group-count": String(list.length) }, String(list.length))),
            !list.length ? h("p", { class: "faint" }, "None.")
              : h("ul", { class: "lab-list" }, list.map((item) => h("li", { "data-turn": String(item.n) }, `#${item.n} ${item.text}`))))));
      } },

    { id: "scoreboard", kind: "panel", title: "Session scoreboard",
      improvements: [
        { id: "table", title: "List this page session's games, the current one included, with outcome, questions asked, the secret once a game ended, and measured cost and latency" },
        { id: "best", title: "Name the session's fewest-question win" },
        { id: "streak", title: "Show the current and longest win streak of the session's finished games" },
        { id: "categories", title: "Count games and wins per category hint" },
      ],
      render: (h, ctx) => {
        const rows = sessionGames(ctx);
        if (!rows.length) return h("p", { class: "faint" }, "Finish or leave a game, or ask a question, to start the scoreboard of this page session.");
        const wins = rows.filter((row) => row.outcome === "won" && row.asked !== null);
        const best = wins.reduce((top, row) => (!top || row.asked < top.asked ? row : top), null);
        let run = 0, longest = 0;
        for (const row of rows) {
          if (!ENDED.has(row.outcome)) continue;
          run = row.outcome === "won" ? run + 1 : 0;
          longest = Math.max(longest, run);
        }
        const categories = [];
        for (const row of rows) {
          const name = row.category || "(no hint)";
          let entry = categories.find((item) => item.name === name);
          if (!entry) categories.push(entry = { name, games: 0, wins: 0 });
          entry.games++;
          if (row.outcome === "won") entry.wins++;
        }
        return h("div", {},
          h("p", { class: "faint" }, "Your games of this page session. Cost and latency are measured; a secret appears only once its game has ended."),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Game", "Category", "Outcome", "Questions", "Secret", "Cost", "Mean latency"].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-game": String(row.number), "data-current": row.current ? "true" : null },
              h("td", {}, `${row.number}${row.current ? " (this game)" : ""}`), h("td", {}, row.category || "—"),
              h("td", { "data-outcome": row.outcome }, OUTCOMES[row.outcome] || row.outcome), h("td", { class: "num" }, row.asked === null ? "—" : String(row.asked)),
              h("td", { "data-secret": "true" }, secretCell(row)),
              h("td", { class: "num", "data-cost": "true" }, row.cost === null ? "—" : usd(row.cost)),
              h("td", { class: "num", "data-latency": "true" }, row.latency === null ? "—" : ms(row.latency)))))),
          h("p", { "data-best": best ? String(best.number) : "none" }, best ? `Fewest-question win: game ${best.number}${best.category ? ` (${best.category})` : ""} in ${plural(best.asked, "question")}.`
            : "No win yet this session."),
          h("p", { "data-streak": `${run}/${longest}` }, `Win streak: ${run} now, longest ${longest}.`),
          h("table", { class: "table lab-table", "data-categories": "true" },
            h("thead", {}, h("tr", {}, ["Category", "Games", "Wins"].map((label) => h("th", {}, label)))),
            h("tbody", {}, categories.map((entry) => h("tr", { "data-category": entry.name }, h("td", {}, entry.name), h("td", { class: "num" }, String(entry.games)),
              h("td", { class: "num" }, String(entry.wins)))))));
      } },

    { id: "hints", kind: "panel", title: "Strategy hints",
      improvements: [
        { id: "lopsided", title: "Suggest broader or narrower questions when three quarters of the answers leaned one way" },
        { id: "early_guess", title: "Point out guesses made before four yes/no answers were in" },
        { id: "unclear", title: "Suggest simpler wording when a quarter of the turns were unread or got Hard to say" },
        { id: "soft", title: "Suggest firmer questions when Probably answers outnumber plain Yes and No" },
        { id: "no_run", title: "Suggest a new direction after three no-leaning answers in a row" },
        { id: "copy", title: "Copy the strategy hints as plain text" },
      ],
      render: (h, ctx, api) => {
        if (!ctx.data?.game) return h("p", { class: "faint" }, NO_GAME);
        const turns = itemsOf(ctx);
        if (!turns.length) return h("p", { class: "faint" }, "Ask a few questions to get hints about your questioning.");
        const hints = hintsOf(ctx);
        return h("div", {},
          h("p", { class: "faint" }, `Local advice from your ${plural(turns.length, "turn")} of this game. It looks at how you ask, never at what the secret might be.`),
          hints.length ? h("ul", { class: "lab-list" }, hints.map(([id, text]) => h("li", { "data-hint": id }, text)))
            : h("p", { class: "faint", "data-hint-none": "true" }, "No hint applies to this game so far."),
          hints.length ? h("button", { class: "btn sm ghost", "data-hints-copy": "true",
            onclick: () => { api.copy(hints.map(([, text]) => `- ${text}`).join("\n")); api.toast("Copied the strategy hints."); } }, "Copy hints") : null);
      } },
  ],
});
