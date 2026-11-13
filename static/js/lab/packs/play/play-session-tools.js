// Game and session tools for the Play page's turn list ("play.history", contract: static/js/lab/surfaces/play.js):
// measurements of this game and of this page session's earlier games, more export formats, palette actions, a local
// question planner and a P(yes) strip. Nothing here asks the model or sends a question: drafts only fill the box.
// Only three features can hold the secret, and each says so: the session CSV (secrets of games that ENDED, as
// data.past and data.secret release them), the request traces and "Copy the revealed secret" (both only after the
// game is over; they throw before).
import { csvText, definePack } from "../../kit.js";
import { mean, quantile } from "../../lib/math.js";
import { formatHtmlTable } from "../../lib/tables.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const percentCell = (value) => (finite(value) === null ? "" : `${(value * 100).toFixed(1)}%`);
const playOrder = (items) => items.slice().sort((a, b) => a.n - b.n);
const total = (values) => values.reduce((sum, value) => sum + value, 0);
const metaOf = (items, field) => items.map((item) => finite(item?.meta?.[field])).filter((value) => value !== null);
const pastOf = (ctx) => (Array.isArray(ctx?.data?.past) ? ctx.data.past.filter((game) => game && typeof game === "object") : []);
const replyCell = (item) => (item.last_question ? item.reply.replace(/ That was your last question\.$/, "") : item.reply);
const cell = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
const running = (ctx) => !!ctx.data?.game && !ctx.data.game.over && !ctx.data.busy;
const normalized = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
const collapse = (text) => String(text ?? "").split(/\s+/).filter(Boolean).join(" ");
const YES_LEANING = new Set(["Yes", "Probably"]);
const ENDED = new Set(["won", "gave_up", "out_of_questions"]);

// The current game counts as played once it has a question or has ended.
const currentPlayed = (ctx) => !!ctx.data?.game && (ctx.data.game.asked > 0 || ctx.data.game.over);

function requireGame(ctx) {
  const game = ctx.data?.game;
  if (!game) throw new Error("There is no game yet.");
  return game;
}

// The longest run of consecutive turns answered Yes or Probably, as { length, from, to }, or null.
function yesStreak(items) {
  let best = null, run = null;
  for (const item of playOrder(items)) {
    if (!YES_LEANING.has(item.answer)) { run = null; continue; }
    run = run && item.n === run.to + 1 ? { ...run, length: run.length + 1, to: item.n } : { length: 1, from: item.n, to: item.n };
    if (!best || run.length > best.length) best = run;
  }
  return best;
}

// One CSV row per game of the session: earlier games, then the current one once it has a question or has ended.
function sessionRows(ctx) {
  const rows = pastOf(ctx).map((game) => [game.category, game.outcome, game.asked, game.secret ?? "", finite(game.cost_usd) ?? "", finite(game.mean_latency_ms) ?? ""]);
  if (currentPlayed(ctx)) {
    const game = ctx.data.game;
    const items = ctx.items();
    const costs = metaOf(items, "cost_usd"), latencies = metaOf(items, "latency_ms");
    rows.push([game.category, game.outcome, game.asked, game.over && typeof ctx.data.secret === "string" ? ctx.data.secret : "",
      costs.length ? total(costs) : "", latencies.length ? total(latencies) / latencies.length : ""]);
  }
  return rows.map((row, index) => [index + 1, ...row]);
}

// The questions grouped by the answer they got, then the guesses: what the turns have established, no probabilities.
function knownLines(ctx) {
  const items = playOrder(ctx.items());
  const answers = Array.isArray(ctx.data?.answers) ? ctx.data.answers : ["Yes", "Probably", "Hard to say", "Probably not", "No"];
  const groups = [...answers.map((answer) => [answer, items.filter((item) => item.kind === "answer" && item.answer === answer)]),
    ["Close guesses", items.filter((item) => item.guess === "close")], ["Wrong guesses", items.filter((item) => item.guess === "wrong")]];
  return groups.filter(([, list]) => list.length).map(([name, list]) => `${name}: ${list.map((item) => item.text).join(" · ")}`);
}

const BAR = { position: "relative", flex: "1", height: "12px", background: "var(--track)", borderRadius: "3px", overflow: "hidden", minWidth: "80px" };

export default definePack({
  id: "play-session-tools",
  surface: "play.history",
  title: "Game and session tools",
  about: "Measurements of your current game and this page session's earlier games, more exports, palette actions, a local "
    + "question planner and a P(yes) strip. Drafts only fill the question box; only the session CSV (secrets of ended games), "
    + "the request traces and Copy the revealed secret (both after the game) hold a secret, and each says so.",
  features: [
    { id: "p95_latency", kind: "metric", format: "ms", label: "95th percentile measured latency of the shown turns",
      help: "Linear interpolation between the sorted latencies.",
      compute: (ctx) => { const values = metaOf(ctx.shown(), "latency_ms"); return values.length ? quantile(values, 0.95) : null; } },
    { id: "yes_streak", kind: "metric", format: "integer", label: "Longest run of yes-leaning answers in this game",
      help: "Consecutive turns answered Yes or Probably; 0 when no turn of this game leaned yes.",
      compute: (ctx) => {
        const items = ctx.items();
        if (!items.length) return null;
        const best = yesStreak(items);
        return best ? { value: best.length, detail: best.from === best.to ? `#${best.from}` : `#${best.from} to #${best.to}` }
          : { value: 0, detail: "no Yes or Probably yet" };
      } },
    { id: "session_games", kind: "metric", format: "integer", label: "Games played this session",
      help: "Earlier games of this page session plus the current one once it has a question.",
      compute: (ctx) => {
        const outcomes = pastOf(ctx).map((game) => game.outcome);
        if (currentPlayed(ctx)) outcomes.push(ctx.data.game.outcome);
        if (!outcomes.length) return null;
        const counts = new Map();
        for (const outcome of outcomes) counts.set(outcome, (counts.get(outcome) || 0) + 1);
        const names = { won: "won", gave_up: "given up", out_of_questions: "out of questions", abandoned: "abandoned", playing: "in progress" };
        return { value: outcomes.length, detail: [...counts].map(([outcome, count]) => `${count} ${names[outcome] || outcome}`).join(", ") };
      } },
    { id: "session_questions", kind: "metric", format: "integer", label: "Questions asked this session",
      help: "Every game of this page session, the current one included.",
      compute: (ctx) => {
        const asked = pastOf(ctx).map((game) => (Number.isInteger(game.asked) ? game.asked : 0));
        if (currentPlayed(ctx)) asked.push(Number.isInteger(ctx.data.game.asked) ? ctx.data.game.asked : 0);
        return asked.length ? total(asked) : null;
      } },
    { id: "mean_to_win", kind: "metric", format: "number", label: "Mean questions to a win this session",
      help: "Questions asked in each won game of this page session, averaged.",
      compute: (ctx) => {
        const won = pastOf(ctx).filter((game) => game.outcome === "won").map((game) => game.asked);
        if (ctx.data?.game?.outcome === "won") won.push(ctx.data.game.asked);
        return won.length ? { value: mean(won), detail: plural(won.length, "won game") } : null;
      } },
    { id: "session_cost", kind: "metric", format: "usd", label: "Measured cost of this session's games",
      help: "The measured cost of every call of this page session's games, the current one included. Spend, not an estimate.",
      compute: (ctx) => {
        const costs = pastOf(ctx).map((game) => finite(game.cost_usd)).filter((value) => value !== null);
        const current = metaOf(ctx.items(), "cost_usd");
        if (!costs.length && !current.length) return null;
        return total(costs) + total(current);
      } },
    { id: "remaining_estimate", kind: "metric", format: "usd", label: "Estimated cost of the questions left",
      help: "Mean measured cost per turn of this game times the questions left. An estimate, not spend.",
      compute: (ctx) => {
        const game = ctx.data?.game;
        if (!game || game.over || !(game.turns_left > 0)) return null;
        const costs = metaOf(ctx.items(), "cost_usd");
        if (!costs.length) return null;
        return { value: (total(costs) / costs.length) * game.turns_left, detail: `estimate for ${plural(game.turns_left, "question")}` };
      } },

    { id: "turns_json", kind: "exporter", label: "Shown turns as JSON",
      help: "the category, the outcome and the shown turns in play order as the page holds them (question, reply, the probabilities the page shows, call measurements); no secret",
      filename: "play-turns.json", mime: "application/json",
      build: (ctx) => {
        const game = requireGame(ctx);
        return `${JSON.stringify({ category: game.category, outcome: game.outcome, turns: playOrder(ctx.shown()) }, null, 2)}\n`;
      } },
    { id: "probability_md", kind: "exporter", label: "Transcript with probabilities as Markdown",
      help: "the shown turns in play order with your questions, the replies and the four probabilities the page shows; no secret",
      filename: "play-probabilities.md", mime: "text/markdown",
      build: (ctx) => {
        const game = requireGame(ctx);
        return `${[`# 20 Questions · ${game.category || "thing"}`, "", "| # | Question | Reply | P(yes) | P(yes/no question) | P(guess) | P(match) |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          ...playOrder(ctx.shown()).map((item) => `| ${item.n} | ${cell(item.text)} | ${cell(replyCell(item))} | ${percentCell(item.probs.answer_is_yes)} | `
            + `${percentCell(item.probs.is_yes_no_question)} | ${percentCell(item.probs.names_a_guess)} | ${percentCell(item.probs.guess_matches)} |`)].join("\n")}\n`;
      } },
    { id: "transcript_html", kind: "exporter", label: "Shown turns as an HTML table",
      help: "turn numbers, your questions and the replies in play order, every cell escaped; no secret",
      filename: "play-transcript.html", mime: "text/html",
      build: (ctx) => {
        requireGame(ctx);
        return `${formatHtmlTable(["#", "Question", "Reply"], playOrder(ctx.shown()).map((item) => [item.n, item.text, replyCell(item)]))}\n`;
      } },
    { id: "timing_csv", kind: "exporter", label: "Call measurements per turn as CSV",
      help: "turn number, kind, measured latency, tokens, cost, model and backend of the shown turns; no questions, replies or secret",
      filename: "play-timing.csv", mime: "text/csv",
      build: (ctx) => csvText([["turn", "kind", "latency_ms", "input_tokens", "output_tokens", "cost_usd", "model", "backend"],
        ...playOrder(ctx.shown()).map((item) => [item.n, item.kind ?? "", item.meta.latency_ms ?? "", item.meta.input_tokens ?? "", item.meta.output_tokens ?? "",
          item.meta.cost_usd ?? "", item.meta.model ?? "", item.meta.backend ?? ""])]) },
    { id: "session_csv", kind: "exporter", label: "This session's games as CSV (includes the secrets of ended games)",
      help: "one row per game of this page session: category, outcome, questions, measured cost and mean latency, and the secret of every game that ended (blank for the running game and abandoned games)",
      filename: "play-session.csv", mime: "text/csv",
      build: (ctx) => {
        const rows = sessionRows(ctx);
        if (!rows.length) throw new Error("No game of this session has a question yet.");
        return csvText([["game", "category", "outcome", "questions", "secret", "cost_usd", "mean_latency_ms"], ...rows]);
      } },
    { id: "traces_json", kind: "exporter", label: "Request traces as JSON (after the game; includes the secret)",
      help: "every turn's request, response and call measurements in play order, released when the game ends; each request's state holds the secret",
      filename: "play-traces.json", mime: "application/json",
      build: (ctx) => {
        const game = requireGame(ctx);
        if (!game.over || !Array.isArray(ctx.data.traces)) throw new Error("Request traces are released when the game ends.");
        return `${JSON.stringify(ctx.data.traces, null, 2)}\n`;
      } },

    { id: "inspect_slowest", kind: "command", title: "Inspect the JSON of the slowest turn", group: "Play",
      when: (ctx) => !!ctx.data?.game?.over && metaOf(ctx.items(), "latency_ms").length > 0,
      run: (ctx) => {
        const slowest = playOrder(ctx.items()).reduce((best, item) => (finite(item.meta?.latency_ms) !== null && (!best || item.meta.latency_ms > best.meta.latency_ms) ? item : best), null);
        if (!slowest) throw new Error("No turn has a measured latency.");
        ctx.actions.inspectTurn(slowest.n);
      } },
    { id: "copy_secret", kind: "command", title: "Copy the revealed secret", group: "Play",
      when: (ctx) => !!ctx.data?.game?.over && typeof ctx.data.secret === "string",
      run: (ctx) => {
        const { secret } = ctx.data;
        if (!ctx.data.game?.over || typeof secret !== "string") throw new Error("The secret is revealed when the game ends.");
        ctx.env.copy(secret);
        ctx.env.toast?.("Copied the secret.");
      } },
    { id: "redraft_invalid", kind: "command", title: "Put the newest unread question back in the box to rephrase", group: "Play",
      when: (ctx) => running(ctx) && ctx.items().some((item) => item.kind === "invalid"),
      run: (ctx) => {
        const newest = ctx.items().filter((item) => item.kind === "invalid").reduce((best, item) => (!best || item.n > best.n ? item : best), null);
        if (!newest) throw new Error("Every question so far was read as a yes/no question or a guess.");
        ctx.actions.draftQuestion(newest.text);
      } },
    { id: "copy_known", kind: "command", title: "Copy what the answers have told you so far", group: "Play",
      when: (ctx) => ctx.items().some((item) => item.kind === "answer" || item.kind === "guess"),
      run: (ctx) => {
        const lines = knownLines(ctx);
        if (!lines.length) throw new Error("No question has been answered yet.");
        ctx.env.copy(lines.join("\n"));
        ctx.env.toast?.("Copied your questions grouped by answer, without probabilities.");
      } },

    { id: "planner", kind: "panel", title: "Question planner",
      improvements: [
        { id: "add", title: "Plan questions to ask later, kept in this page session and never sent" },
        { id: "remove", title: "Remove one planned question or clear the whole plan" },
        { id: "move_up", title: "Move a planned question up the plan" },
        { id: "draft", title: "Put a planned question in the question box" },
        { id: "asked", title: "Mark planned questions already asked in this game" },
      ],
      render: (h, ctx, api) => {
        const state = api.state;
        const plan = Array.isArray(state.plan) ? state.plan : [];
        const limit = finite(ctx.data?.rules?.max_question_chars) || 200;
        const asked = new Set(ctx.items().map((item) => normalized(item.text)));
        const setPlan = (next) => { state.plan = next; api.redraw(); };
        const add = () => {
          const text = collapse(state.text);
          if (!text) return api.toast("Type a question to plan.", "error");
          if ([...text].length > limit) return api.toast(`A question can be at most ${limit} characters.`, "error");
          state.text = "";
          return setPlan([...plan, text]);
        };
        const draft = (text) => { try { ctx.actions.draftQuestion(text); } catch (error) { api.toast(error.message, "error"); } };
        return h("div", {},
          h("p", { class: "faint" }, "Planned questions stay in this page session and are never sent. Put in box fills the question box; you still press Ask."),
          h("div", { class: "row lab-row" },
            h("input", { class: "input sm", "data-plan": "text", value: state.text || "", placeholder: "A question to ask later", "aria-label": "Planned question",
              oninput: (event) => { state.text = event.target.value; } }),
            h("button", { class: "btn sm", "data-plan": "add", onclick: add }, "Add to plan"),
            plan.length ? h("button", { class: "btn sm ghost", "data-plan": "clear", onclick: () => setPlan([]) }, "Clear plan") : null),
          plan.length ? h("ol", { class: "lab-list" }, plan.map((text, index) => h("li", { "data-plan-item": String(index) },
            h("span", {}, text, asked.has(normalized(text)) ? h("span", { class: "badge", "data-plan-asked": "true", style: { marginLeft: "6px" } }, "asked") : null),
            h("span", { class: "row" },
              h("button", { class: "btn sm ghost", "data-plan-up": String(index), disabled: index === 0,
                onclick: () => { if (index > 0) setPlan([...plan.slice(0, index - 1), text, plan[index - 1], ...plan.slice(index + 1)]); } }, "Up"),
              h("button", { class: "btn sm ghost", "data-plan-draft": String(index), onclick: () => draft(text) }, "Put in box"),
              h("button", { class: "btn sm ghost", "data-plan-remove": String(index), onclick: () => setPlan(plan.filter((_, at) => at !== index)) }, "Remove")))))
            : h("p", { class: "faint", "data-plan-empty": "true" }, "No planned questions."));
      } },
    { id: "yes_strip", kind: "panel", title: "P(yes) by turn",
      improvements: [
        { id: "bars", title: "Show P(yes) of the shown turns as one bar per turn in play order, with the reply cut-offs marked" },
      ],
      render: (h, ctx) => {
        const rules = ctx.data?.rules || {};
        const cuts = [rules.no, rules.probably_not, rules.probably, rules.yes].map(finite).filter((value) => value !== null);
        const turns = playOrder(ctx.shown());
        if (!turns.length) return h("p", { class: "faint" }, "Ask a question to see its P(yes) here.");
        return h("div", { style: { display: "grid", gap: "4px" } },
          h("p", { class: "faint" }, `Your own calls' P(yes), with the reply cut-offs at ${cuts.map((cut) => `${Math.round(cut * 100)}%`).join(", ")}.`),
          turns.map((item) => {
            const p = finite(item.probs?.answer_is_yes);
            return h("div", { "data-turn": String(item.n), title: `#${item.n} ${item.text}: ${p === null ? "no P(yes)" : percentCell(p)}`,
              style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" } },
              h("span", { style: { width: "3em" } }, `#${item.n}`),
              h("div", { style: BAR },
                p === null ? null : h("div", { "data-bar": percentCell(p), style: { width: `${Math.min(1, Math.max(0, p)) * 100}%`, height: "100%", background: "var(--series)" } }),
                cuts.map((cut) => h("span", { "data-cut": String(cut), style: { position: "absolute", top: "0", bottom: "0", left: `${cut * 100}%`, width: "1px", background: "var(--line-strong)" } }))),
              h("span", { class: "num", style: { width: "4em", textAlign: "right" } }, p === null ? "—" : percentCell(p)));
          }));
      } },
  ],
});
