// More for the Overview playground ("index.playground", contract: static/js/lab/surfaces/index.js): the shape of each
// answer's probabilities, comparison with the earlier calls of this page session, advisory checks, exports and panels.
// It reads only the answers of the user's own calls in this page load, labels anything from data.history as an earlier
// call, and never asks the model: the one action it uses to place text is draftText, which does not ask.
import { csvText, definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const probs = (item) => (Array.isArray(item?.probabilities) ? item.probabilities.filter((entry) => entry && finite(entry.p) !== null) : []);
const ranked = (item) => probs(item).map((entry, index) => ({ ...entry, index })).sort((a, b) => b.p - a.p || a.index - b.index);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const history = (ctx) => (Array.isArray(ctx?.data?.history) ? ctx.data.history : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? ctx.shown() : []);
const itemsOf = (ctx) => (typeof ctx?.items === "function" ? ctx.items() : []);

// Advisory local rules. They are plain code, never the model's answer.
const ABOVE = 0.05;          // an option "in play" (1 - 0.95 is 0.05000000000000004 in floating point, so compare with a tolerance)
const EPS = 1e-9;
const CONFIDENCE_GAP = 0.05; // confidence and top probability further apart than this
const SLOW_MS = 500;         // a call slower than this
const CLOSE_DEFAULT = "0.10";

// The session entry an answer row came from, and the earlier call just before it (rows are the same objects).
function entryIndex(ctx, item) {
  return history(ctx).findIndex((entry) => Array.isArray(entry?.rows) && entry.rows.includes(item));
}
function previousOf(ctx, item) {
  const index = item ? entryIndex(ctx, item) : -1;
  return index > 0 ? history(ctx)[index - 1] : null;
}
const shownEntry = (ctx) => {
  const first = itemsOf(ctx)[0];
  const index = first ? entryIndex(ctx, first) : -1;
  return index >= 0 ? history(ctx)[index] : null;
};
const previousCall = (ctx) => previousOf(ctx, itemsOf(ctx)[0]);
const sameQuestion = (entry, item) => (Array.isArray(entry?.rows) ? entry.rows.find((row) => row && row.id === item.id && row.type === item.type) || null : null);

// Half the summed absolute difference of two answers' listed probabilities (keys missing on one side count as 0).
function shift(before, after) {
  const a = probs(before), b = probs(after);
  if (!a.length || !b.length) return null;
  const keys = new Set([...a.map((entry) => entry.key), ...b.map((entry) => entry.key)]);
  const p = (list, key) => list.find((entry) => entry.key === key)?.p ?? 0;
  let total = 0;
  for (const key of keys) total += Math.abs(p(a, key) - p(b, key));
  return total / 2;
}

// Whether the answer differs from an earlier one: another Choice key, another rounded Score level, or a yes/no answer
// on the other side of one half. null when the two cannot be compared.
function changed(before, after) {
  if (!before || !after || before.type !== after.type) return null;
  if (after.type === "choice") return typeof before.value === "string" && typeof after.value === "string" ? before.value !== after.value : null;
  const x = finite(before.value), y = finite(after.value);
  if (x === null || y === null) return null;
  if (after.type === "score") return Math.round(x) !== Math.round(y);
  if (after.type === "noul") return (x > 0.5) !== (y > 0.5);
  return null;
}

function margin(item) {
  const list = ranked(item);
  return list.length >= 2 ? list[0].p - list[1].p : null;
}

function scoreSpread(item) {
  if (item?.type !== "score") return null;
  const list = probs(item);
  if (!list.length || !list.every((entry) => /^\d+$/.test(entry.key))) return null;
  const total = list.reduce((sum, entry) => sum + entry.p, 0);
  if (!(total > 0)) return null;
  const mean = list.reduce((sum, entry) => sum + entry.p * Number(entry.key), 0) / total;
  const variance = list.reduce((sum, entry) => sum + entry.p * (Number(entry.key) - mean) ** 2, 0) / total;
  return Math.sqrt(variance);
}

const measured = (ctx, field) => history(ctx).flatMap((entry) => {
  const value = finite(entry?.meta?.[field]);
  return value === null ? [] : [{ call: entry.call, value }];
});
const callName = (call) => (finite(call) === null ? "an earlier call" : `call ${call}`);
const iso = (at) => (finite(at) === null ? null : new Date(at).toISOString());
const round6 = (p) => Number(p.toFixed(6));

function answerRecord(item) {
  return { question: item.id, type: item.type, value: item.value ?? null, display: item.display || "" };
}

function questionMarkdown(id, question) {
  const type = typeof question?.type === "string" ? question.type : "unknown";
  const instructions = typeof question?.instructions === "string" ? question.instructions : JSON.stringify(question?.instructions ?? "");
  const lines = [`## ${id} (${type})`, "", instructions || "(no instructions)"];
  const criteria = question?.criteria;
  const options = Array.isArray(criteria) ? criteria.map((text, index) => `- ${index}: ${text ?? ""}`)
    : criteria && typeof criteria === "object" ? Object.entries(criteria).map(([key, text]) => `- \`${key}\`: ${text ?? ""}`) : [];
  if (options.length) lines.push("", ...options);
  return lines.join("\n");
}

const readThreshold = (raw) => {
  const text = String(raw ?? "").trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return value >= 0 && value <= 1 ? value : null;
};

export default definePack({
  id: "index-playground-more",
  surface: "index.playground",
  title: "Playground: shapes and session",
  about: "Probability-shape filters, comparison with your earlier playground calls of this page load, advisory checks, "
    + "exports and session panels. Rules such as close calls and slow calls are local code, and earlier calls are always labeled as earlier.",
  features: [
    { id: "runner_up_p", kind: "fact", type: "number", label: "runner-up probability", unit: "0 to 1",
      help: "The second highest listed probability.", value: (item) => { const list = ranked(item); return list.length >= 2 ? list[1].p : null; } },
    { id: "options_in_play", kind: "fact", type: "number", label: "options above 5%", unit: "options",
      help: "How many listed options have a probability above 0.05.",
      value: (item) => { const list = probs(item); return list.length ? list.filter((entry) => entry.p > ABOVE + EPS).length : null; } },
    { id: "score_spread", kind: "fact", type: "number", label: "Score spread in levels", unit: "levels",
      help: "Score answers only: the probability-weighted standard deviation of the level.", value: scoreSpread },
    { id: "shift_since_previous", kind: "fact", type: "number", label: "probability shift since the previous call", unit: "0 to 1",
      help: "How much probability moved since the same question in the earlier call of this session (half the summed absolute differences).",
      value: (item, ctx) => { const before = sameQuestion(previousOf(ctx, item), item); return before ? shift(before, item) : null; } },
    { id: "runner_up", kind: "fact", type: "category", label: "runner-up option", help: "The option with the second highest probability.",
      value: (item) => { const list = ranked(item); return list.length >= 2 ? list[1].key : null; } },
    { id: "extreme_level", kind: "fact", type: "flag", label: "likeliest Score level at an end of the scale",
      value: (item) => item?.type === "score" && !!item.top && finite(item.scale) !== null && (item.top.key === "0" || item.top.key === String(item.scale)) },
    { id: "changed_since_previous", kind: "fact", type: "flag", label: "answer changed since the previous call",
      help: "Compared with the earlier call of this session: another Choice key, another rounded Score level, or a yes/no answer on the other side of one half (local rule).",
      value: (item, ctx) => changed(sameQuestion(previousOf(ctx, item), item), item) === true },

    { id: "chosen_not_offered", kind: "diagnostic", severity: "problem", label: "Choice answer that is not one of the options sent",
      check: (item) => {
        if (item.type !== "choice" || typeof item.value !== "string" || !Array.isArray(item.criteria) || !item.criteria.length) return null;
        return item.criteria.some((entry) => entry.key === item.value) ? null : `${item.id} chose "${item.value}", which is not among the ${plural(item.criteria.length, "option")} sent.`;
      } },
    { id: "score_out_of_range", kind: "diagnostic", severity: "problem", label: "Score outside its scale",
      check: (item) => {
        const value = item.type === "score" ? finite(item.value) : null;
        const scale = finite(item.scale);
        return value === null || scale === null || (value >= 0 && value <= scale) ? null : `${item.id} scored ${value}, outside 0 to ${scale}.`;
      } },
    { id: "confidence_gap", kind: "diagnostic", severity: "info", label: "Confidence more than 5 points from the top probability",
      check: (item) => {
        const confidence = finite(item.confidence), top = finite(item.top?.p);
        return confidence === null || top === null || Math.abs(confidence - top) <= CONFIDENCE_GAP + EPS ? null
          : `${item.id} reports confidence ${percent(confidence)} but its top option has ${percent(top)}.`;
      } },
    { id: "unanswered", kind: "diagnostic", severity: "advice", scope: "list", label: "Question sent without an answer",
      check: (items, ctx) => {
        const questions = ctx?.data?.questions;
        if (!items.length || !questions || typeof questions !== "object") return null;
        const answered = new Set(itemsOf(ctx).map((item) => item.id));
        return Object.keys(questions).filter((id) => !answered.has(id)).map((id) => `${id} was sent in the request but the response has no answer for it.`);
      } },
    { id: "injection_signal", kind: "diagnostic", severity: "advice", scope: "list", label: "AI-instruction answer above one half (local rule)",
      help: "Local, advisory rule: the talks_to_ai answer gives more than one half to yes.",
      check: (items) => {
        const row = items.find((item) => item.id === "talks_to_ai" && item.type === "noul");
        const p = finite(row?.value);
        return p !== null && p > 0.5 ? `Local rule: talks_to_ai is ${percent(p)}, above one half, so a person should read this text before any automation acts on it.` : null;
      } },
    { id: "slow_call", kind: "diagnostic", severity: "info", scope: "list", label: "Shown call slower than 500 ms",
      check: (items, ctx) => {
        const latency = finite(ctx?.data?.meta?.latency_ms);
        return items.length && latency !== null && latency > SLOW_MS ? `The shown call took ${Math.round(latency)} ms (measured), above the 500 ms local limit.` : null;
      } },

    { id: "fastest_call", kind: "metric", format: "ms", label: "Fastest measured call this session",
      compute: (ctx) => {
        const list = measured(ctx, "latency_ms");
        if (!list.length) return null;
        const best = list.reduce((a, b) => (b.value < a.value ? b : a));
        return { value: best.value, detail: `measured, ${callName(best.call)} of ${plural(list.length, "call")}` };
      } },
    { id: "slowest_call", kind: "metric", format: "ms", label: "Slowest measured call this session",
      compute: (ctx) => {
        const list = measured(ctx, "latency_ms");
        if (!list.length) return null;
        const worst = list.reduce((a, b) => (b.value > a.value ? b : a));
        return { value: worst.value, detail: `measured, ${callName(worst.call)} of ${plural(list.length, "call")}` };
      } },
    { id: "latency_vs_mean", kind: "metric", format: "ms", label: "Shown call's latency minus the session mean",
      help: "Measured latency of the shown call minus the mean of this session's measured calls; needs two or more.",
      compute: (ctx) => {
        const shown = finite(ctx?.data?.meta?.latency_ms);
        const list = measured(ctx, "latency_ms");
        if (shown === null || list.length < 2 || !itemsOf(ctx).length) return null;
        const mean = list.reduce((sum, entry) => sum + entry.value, 0) / list.length;
        return { value: shown - mean, detail: `measured, against the mean of ${plural(list.length, "call")}` };
      } },
    { id: "session_tokens", kind: "metric", format: "integer", label: "Input tokens measured this session",
      compute: (ctx) => {
        const list = measured(ctx, "input_tokens");
        return list.length ? { value: list.reduce((sum, entry) => sum + entry.value, 0), detail: `measured over ${plural(list.length, "call")}` } : null;
      } },
    { id: "largest_score_swing", kind: "metric", format: "number", label: "Largest Score change between consecutive calls",
      help: "Across this session's calls, the biggest change of one Score question from one call to the next.",
      compute: (ctx) => {
        const list = history(ctx);
        let best = null;
        for (let index = 1; index < list.length; index++) {
          for (const row of list[index]?.rows || []) {
            if (row?.type !== "score" || finite(row.value) === null) continue;
            const before = sameQuestion(list[index - 1], row);
            if (!before || finite(before.value) === null) continue;
            const size = Math.abs(row.value - before.value);
            if (!best || size > best.size) best = { size, id: row.id, from: list[index - 1].call, to: list[index].call };
          }
        }
        return best ? { value: best.size, detail: `${best.id}, ${callName(best.from)} to ${callName(best.to)}` } : null;
      } },

    { id: "answers_jsonl", kind: "exporter", label: "Shown answers as JSON lines",
      help: "contains model answers and probabilities from your call, one line per shown question; P(yes) is the value of yes/no answers",
      filename: "playground-answers.jsonl", mime: "application/x-ndjson",
      build: (ctx) => {
        const shown = shownOf(ctx);
        if (!shown.length) throw new Error("There are no shown answers to export.");
        return shown.map((item) => JSON.stringify({ ...answerRecord(item),
          probabilities: item.type === "noul" ? null : Object.fromEntries(probs(item).map((entry) => [entry.key, entry.p])) })).join("\n") + "\n";
      } },
    { id: "probability_csv", kind: "exporter", label: "Every listed probability of the shown answers as CSV",
      help: "contains model probabilities from your call: one row per question and option, rounded to six decimals",
      filename: "playground-probabilities.csv", mime: "text/csv",
      build: (ctx) => csvText([["question", "type", "option", "probability"],
        ...shownOf(ctx).flatMap((item) => probs(item).map((entry) => [item.id, item.type, entry.key, round6(entry.p)]))]) },
    { id: "session_json", kind: "exporter", label: "This session's calls as JSON",
      help: "contains your texts and the model's answers of every answered call of this page load, oldest first; earlier calls are marked as not shown",
      filename: "playground-session.json", mime: "application/json",
      build: (ctx) => {
        const list = history(ctx);
        if (!list.length) throw new Error("Nothing has been answered in this page load yet.");
        const shown = shownEntry(ctx);
        return `${JSON.stringify({ note: "Answered playground calls of this page load, oldest first. Only the entry marked shown is the current answer.",
          calls: list.map((entry) => ({ call: entry.call ?? null, at: iso(entry.at), shown: entry === shown, text: entry.text ?? null,
            model: entry.meta?.model ?? null, answers: (entry.rows || []).map(answerRecord) })) }, null, 2)}\n`;
      } },
    { id: "questions_markdown", kind: "exporter", label: "Questions of the shown call as Markdown",
      help: "the questions exactly as sent: ids, types, instructions and options; no text, answers or probabilities",
      filename: "playground-questions.md", mime: "text/markdown",
      build: (ctx) => {
        const questions = ctx?.data?.questions;
        if (!questions || typeof questions !== "object" || !Object.keys(questions).length) throw new Error("Run the playground first: there are no questions yet.");
        return `# Playground questions\n\n${Object.entries(questions).map(([id, question]) => questionMarkdown(id, question)).join("\n\n")}\n`;
      } },

    { id: "previous_call", kind: "panel", title: "Shown call vs the previous call",
      improvements: [{ id: "table", title: "Compare each shown answer with the same question in the previous call of this session" },
        { id: "copy", title: "Copy the call comparison as tab-separated text" }],
      render: (h, ctx, api) => {
        const now = shownEntry(ctx), before = previousCall(ctx);
        if (!now || !before) return h("p", { class: "faint" }, "Ask the playground twice in this page load to compare a call with the one before it.");
        const rows = shownOf(ctx).map((item) => {
          const earlier = sameQuestion(before, item);
          const moved = earlier ? shift(earlier, item) : null;
          const differs = changed(earlier, item);
          return [item.id, earlier ? earlier.display || "no value" : "not asked", item.display || "no value",
            differs === null ? "—" : differs ? "changed" : "same", moved === null ? "—" : percent(moved)];
        });
        const head = ["Question", `Call ${before.call ?? "?"} (earlier)`, `Call ${now.call ?? "?"} (shown)`, "Answer", "Shift"];
        const text = [head, ...rows].map((row) => row.join("\t")).join("\n");
        return h("div", {},
          h("p", { class: "faint" }, `Your answers of call ${now.call ?? "?"} beside call ${before.call ?? "?"}, an earlier call of this page load. "Changed" is a local rule; shift is how much probability moved.`),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, head.map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-question": row[0] }, row.map((cell, index) => h("td", { class: index === 4 ? "num" : null }, cell)))))),
          h("button", { class: "btn sm ghost", "data-copy": "previous-call", onclick: () => api.copy(text) }, "Copy comparison"));
      } },
    { id: "close_explorer", kind: "panel", title: "Close calls at your threshold",
      improvements: [{ id: "threshold", title: "List the shown answers whose top two options are closer than a threshold you set (local rule)" }],
      render: (h, ctx, api) => {
        const raw = api.state.threshold ?? CLOSE_DEFAULT;
        const input = h("input", { type: "number", min: "0", max: "1", step: "0.01", value: raw, "aria-label": "Close-call threshold",
          oninput: (event) => { api.state.threshold = event.target.value; api.redraw(); } });
        const limit = readThreshold(raw);
        if (limit === null) return h("div", {}, input, h("p", { class: "faint", "data-close-error": "true" }, "Enter a threshold from 0 to 1."));
        const shown = shownOf(ctx);
        const close = shown.map((item) => ({ item, gap: margin(item), list: ranked(item) })).filter((entry) => entry.gap !== null && entry.gap < limit)
          .sort((a, b) => a.gap - b.gap);
        return h("div", {}, h("label", {}, "Top two closer than ", input),
          !shown.length ? h("p", { class: "faint" }, "No answers are shown.")
            : !close.length ? h("p", { class: "faint", "data-close-none": "true" }, `No shown answer has its top two options closer than ${limit}.`)
              : h("ul", {}, close.map(({ item, gap, list }) => h("li", { "data-close": item.id },
                `${item.id}: ${list[0].key} ${percent(list[0].p)} vs ${list[1].key} ${percent(list[1].p)} (${percent(gap)} apart)`))),
          h("p", { class: "faint" }, "A local, advisory rule over your answers, not the model's judgment."));
      } },
    { id: "example_coverage", kind: "panel", title: "Example texts asked this session",
      improvements: [{ id: "coverage", title: "Show which example texts this page load has asked, by call number" }],
      render: (h, ctx) => {
        const examples = Array.isArray(ctx?.data?.examples) ? ctx.data.examples : [];
        if (!examples.length) return h("p", { class: "faint" }, "The example texts did not load.");
        const list = history(ctx);
        return h("div", {}, h("ul", {}, examples.map((example) => {
          const calls = list.filter((entry) => typeof entry.text === "string" && entry.text === String(example.text).trim()).map((entry) => entry.call);
          return h("li", { "data-example": example.label }, `${example.label}: `,
            calls.length ? `asked in ${calls.length === 1 ? "call" : "calls"} ${calls.join(", ")}` : "not asked in this page load");
        })), h("p", { class: "faint" }, "Call numbers of your own calls in this page load; no answers are shown here."));
      } },

    { id: "copy_text", kind: "command", title: "Copy the text of the shown answers", group: "Playground",
      when: (ctx) => typeof ctx.data?.text === "string" && ctx.data.text !== "",
      run: (ctx) => { ctx.env.copy(ctx.data.text); ctx.env.toast?.("Copied the text the shown answers were made for."); } },
    { id: "draft_previous", kind: "command", title: "Put the previous call's text in the box without asking", group: "Playground",
      when: (ctx) => { const before = previousCall(ctx); return typeof before?.text === "string" && before.text.trim() !== "" && before.text !== ctx.data.draft.trim(); },
      run: (ctx) => {
        const before = previousCall(ctx);
        ctx.actions.draftText(before.text);
        ctx.env.toast?.(`The text of ${callName(before.call)}, an earlier call of this page load, is in the box. Nothing was asked; edit it to ask.`);
      } },
  ],
});
