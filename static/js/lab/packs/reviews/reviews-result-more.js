// More facts, checks, metrics, exports, commands, panels and calculators for the answers of the user's own latest
// Reviews check. Contract: static/js/lab/surfaces/reviews.js ("reviews.result"). Session comparisons read only this
// page load's earlier checks (data.history) and say so. Every local rule here ("would flip at", "runner-up routes
// elsewhere") is advisory plain code; the decision is the page's triage, and policy and stars change only through the
// page's own setPolicy, resetPolicy and setStars, which re-decide with no model call.
import { csvText, definePack, formatValue } from "../../kit.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const probs = (item) => (Array.isArray(item?.probabilities) ? item.probabilities.filter((entry) => entry && number(entry.p) !== null) : []);
const ranked = (item) => probs(item).slice().sort((a, b) => b.p - a.p);
const pct = (value) => `${(value * 100).toFixed(0)}%`;
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const historyOf = (ctx) => (Array.isArray(ctx?.data?.history) ? ctx.data.history : []);

// A raw answer's value as the surface reads it: the choice key, the score, or P(yes).
function rawValue(answer) {
  if (!isObject(answer)) return null;
  if (answer.type === "choice") return answer.choice === null || answer.choice === undefined ? null : String(answer.choice);
  if (answer.type === "score") return number(answer.score);
  if (answer.type === "noul") return number(answer.noul);
  return null;
}

// A raw answer printed the way the answer cards print it.
function printed(answer) {
  const value = rawValue(answer);
  if (value === null) return "";
  if (answer.type === "choice") return value.replace(/_/g, " ");
  if (answer.type === "noul") return `${(value * 100).toFixed(1)}%`;
  const levels = isObject(answer.legend) ? Object.keys(answer.legend).length : 0;
  return levels ? `${value.toFixed(2)} / ${levels - 1}` : value.toFixed(2);
}

// The session check before the shown one (the shown check is the last history entry), or null.
function previousAnswer(item, ctx) {
  const history = historyOf(ctx);
  if (history.length < 2 || typeof item?.id !== "string") return null;
  const answers = history[history.length - 2]?.answers;
  return isObject(answers) && isObject(answers[item.id]) ? answers[item.id] : null;
}

// Score levels as [level, p] with whole-number keys.
const levelsOf = (item) => (item?.type === "score" ? probs(item).flatMap((entry) => (/^\d+$/.test(String(entry.key)) ? [[Number(entry.key), entry.p]] : [])) : []);

// The policy-grid value at which the rule reading this answer would change sides: every cut in triage() fires at
// value >= at, so a rule on the "at or above" side flips at the first step above the value, and one on the "below"
// side at the last step at or below it. null when that lies outside the slider.
function flipAt(value, at, limit) {
  if (!limit || number(limit.step) === null || !(limit.step > 0)) return null;
  const steps = Math.floor((value - limit.min) / limit.step + 1e-9) + (value >= at ? 1 : 0);
  const next = Number((limit.min + steps * limit.step).toFixed(2));
  return next < limit.min - 1e-9 || next > limit.max + 1e-9 ? null : next;
}

function flipRows(ctx) {
  const limits = ctx.data.limits || {};
  return ctx.items().flatMap((item) => {
    const value = number(item.value);
    if (value === null || !Array.isArray(item.cuts)) return [];
    return item.cuts.filter((cut) => number(cut?.at) !== null).map((cut) => ({ id: item.id, value, key: cut.key, at: cut.at,
      side: value >= cut.at ? "at or above" : "below", flip: flipAt(value, cut.at, limits[cut.key]) }));
  });
}

const historyRow = (entry) => {
  const answers = isObject(entry.answers) ? entry.answers : {};
  return { call: entry.call, stars: entry.review?.stars ?? null, topic: printed(answers.topic), severity: number(rawValue(answers.severity)),
    tone: number(rawValue(answers.tone)), latency: number(entry.meta?.latency_ms), cost: number(entry.meta?.cost_usd) };
};
// An arrival time as ISO 8601 UTC; "" when missing or outside the dates JavaScript can print.
const isoTime = (at) => (number(at) !== null && Math.abs(at) <= 8.64e15 ? new Date(at).toISOString() : "");
const fixed = (value) => (value === null ? "" : value.toFixed(2));

// One step on the form's star picker: re-decides the shown answers with no Jev call (the stars never reach Jev).
const nextStars = (ctx, by) => {
  const stars = ctx.data.draft?.stars;
  return Number.isInteger(stars) && stars + by >= 1 && stars + by <= 5 ? stars + by : null;
};
function starsCommand(id, title, by) {
  return { id, kind: "command", title, group: "Reviews stars",
    help: "The star picker, one step: re-decides the shown answers with no Jev call (the stars never reach Jev).",
    when: (ctx) => !!ctx.data.settings && !ctx.data.running && nextStars(ctx, by) !== null,
    run: (ctx) => {
      const stars = nextStars(ctx, by);
      if (stars === null) throw new Error(by > 0 ? "The stars are already at 5." : "The stars are already at 1.");
      return ctx.actions.setStars(stars);
    } };
}

export default definePack({
  id: "reviews-result-more",
  surface: "reviews.result",
  title: "More review result insights",
  about: "Probability-shape and session-comparison facts, sanity checks, measured usage metrics, exports, stars and policy commands, a session-checks panel, a flip-point panel and a rating-gap calculator for your own latest Reviews check. Session comparisons use only this page load's earlier checks; flip points and routing hints are advisory local code, never the decision.",
  features: [
    { id: "runner_up", kind: "fact", type: "category", label: "runner-up option", help: "The second most probable option; for a Noul, yes or no.",
      value: (item) => ranked(item)[1]?.key ?? null },
    { id: "expected_level", kind: "fact", type: "number", label: "probability-weighted level", help: "Scores only: the sum of level × probability, divided by the total probability.",
      value: (item) => {
        const levels = levelsOf(item);
        const total = levels.reduce((sum, [, p]) => sum + p, 0);
        return total > 0 ? levels.reduce((sum, [level, p]) => sum + level * p, 0) / total : null;
      } },
    { id: "top_two", kind: "fact", type: "number", label: "probability of the top two levels", unit: "probability (0–1)",
      help: "Scores only: severity 2–3 (a real problem or worse), tone 3–4 (positive).",
      value: (item) => {
        const levels = levelsOf(item);
        const total = levels.reduce((sum, [, p]) => sum + p, 0);
        if (levels.length < 2 || !(total > 0)) return null;
        const highest = Math.max(...levels.map(([level]) => level));
        return levels.filter(([level]) => level >= highest - 1).reduce((sum, [, p]) => sum + p, 0) / total;
      } },
    { id: "prev_change", kind: "fact", type: "number", label: "change since the previous check", help: "This answer minus the same question's answer in this session's previous check.",
      value: (item, ctx) => {
        const now = number(item?.value), before = number(rawValue(previousAnswer(item, ctx)));
        return now === null || before === null ? null : now - before;
      } },
    { id: "session_mean", kind: "fact", type: "number", label: "mean over this session's checks", help: "Scores and Nouls: the mean of this question's answers across your checks since the page loaded.",
      value: (item, ctx) => {
        if (number(item?.value) === null) return null;
        return mean(historyOf(ctx).map((entry) => number(rawValue(entry?.answers?.[item.id]))).filter((value) => value !== null));
      } },
    { id: "changed", kind: "fact", type: "flag", label: "a change since the previous check", help: "More than 0.1 apart, or another choice, against this session's previous check.",
      value: (item, ctx) => {
        const before = rawValue(previousAnswer(item, ctx)), now = item?.value ?? null;
        if (before === null || now === null) return false;
        return typeof now === "number" && typeof before === "number" ? Math.abs(now - before) > 0.1 + 1e-9 : String(now) !== String(before);
      } },
    { id: "prev_display", kind: "fact", type: "text", label: "previous check's answer", help: "This session's previous check, printed as the cards print it.",
      value: (item, ctx) => printed(previousAnswer(item, ctx)) },

    { id: "level_disagrees", kind: "diagnostic", severity: "advice", label: "Score nearest a level that is not the most probable",
      check: (item) => {
        const value = number(item.value);
        if (item.type !== "score" || value === null || !item.top) return null;
        const nearest = Math.round(value);
        return String(nearest) === String(item.top.key) ? null
          : `Score ${value.toFixed(2)} is nearest level ${nearest}, but level ${item.top.key} is the most probable (${pct(item.top.p)}).`;
      } },
    { id: "weak_choice", kind: "diagnostic", severity: "advice", label: "No option holds a majority",
      check: (item) => (item.type === "choice" && item.top && number(item.top.p) !== null && item.top.p < 0.5
        ? `The most probable option, ${String(item.top.key).replace(/_/g, " ")}, holds ${pct(item.top.p)}: less than half.` : null) },
    { id: "prob_sum_off", kind: "diagnostic", severity: "problem", label: "Probabilities do not add up to 1",
      check: (item) => {
        if (item.type !== "choice" && item.type !== "score") return null;
        const entries = probs(item);
        if (!entries.length) return null;
        const total = entries.reduce((sum, entry) => sum + entry.p, 0);
        return Math.abs(total - 1) > 0.02 ? `The ${entries.length} probabilities add up to ${total.toFixed(3)}, not 1.` : null;
      } },
    { id: "runner_up_team", kind: "diagnostic", severity: "info", scope: "list", label: "Runner-up topic routes to another team",
      check: (items, ctx) => {
        const topic = items.find((item) => item.id === "topic" && item.type === "choice");
        const [top, second] = ranked(topic);
        const routes = ctx?.data?.topic_teams || {}, labels = ctx?.data?.labels || {};
        if (!top || !second || !routes[top.key] || !routes[second.key] || routes[top.key] === routes[second.key]) return null;
        const name = (key) => labels.topics?.[key] || key, team = (key) => labels.teams?.[routes[key]] || routes[key];
        return `Runner-up topic ${name(second.key)} (${pct(second.p)}) routes to ${team(second.key)}, not ${team(top.key)}. Advisory, from the routing table.`;
      } },
    { id: "gap_near", kind: "diagnostic", severity: "info", scope: "list", label: "Rating gap within one step of the mismatch cut",
      check: (_items, ctx) => {
        const gap = number(ctx?.data?.triage?.evidence?.rating_gap), cut = number(ctx?.data?.policy?.mismatch_gap);
        if (gap === null || cut === null || Math.abs(gap - cut) > 0.25 + 1e-9) return null;
        return `Stars and words are ${gap.toFixed(2)} levels apart and the mismatch cut in force is ${cut}: within one slider step (0.25). Advisory.`;
      } },
    { id: "tokens_per_question", kind: "metric", label: "Tokens per question in your latest check", format: "number",
      help: "Measured input plus output tokens divided by the questions asked.",
      compute: (ctx) => {
        const meta = ctx.data.meta;
        const input = number(meta?.input_tokens), output = number(meta?.output_tokens), count = number(meta?.question_count);
        return input === null || output === null || !count ? null : { value: (input + output) / count, detail: `${input + output} tokens, ${count} questions` };
      } },
    { id: "cost_per_thousand", kind: "metric", label: "Cost per 1,000 reviews at your latest check's rate", format: "usd",
      help: "A projection: 1,000 × the measured cost of your latest check. Arithmetic, not spend.",
      compute: (ctx) => {
        const cost = number(ctx.data.meta?.cost_usd);
        return cost === null ? null : { value: cost * 1000, detail: `projection from one measured check of ${formatValue(cost, "usd")}` };
      } },
    { id: "latency_vs_mean", kind: "metric", label: "Latest latency minus this session's mean", format: "ms",
      help: "Measured latency of your latest check against the mean of your checks since the page loaded.",
      compute: (ctx) => {
        const latest = number(ctx.data.meta?.latency_ms);
        const values = historyOf(ctx).map((entry) => number(entry.meta?.latency_ms)).filter((value) => value !== null);
        return latest === null || values.length < 2 ? null : { value: latest - mean(values), detail: `mean of ${values.length} checks: ${Math.round(mean(values))} ms` };
      } },
    { id: "distinct_topics", kind: "metric", label: "Distinct topics across this session's checks", format: "integer",
      compute: (ctx) => {
        const topics = historyOf(ctx).map((entry) => rawValue(entry.answers?.topic)).filter((value) => typeof value === "string");
        return topics.length ? { value: new Set(topics).size, detail: `${topics.length} check${topics.length === 1 ? "" : "s"} with a topic` } : null;
      } },
    { id: "session_tokens", kind: "metric", label: "Measured tokens of this session's checks", format: "integer",
      help: "Input plus output tokens of your checks since the page loaded.",
      compute: (ctx) => {
        const totals = historyOf(ctx).map((entry) => [number(entry.meta?.input_tokens), number(entry.meta?.output_tokens)])
          .filter(([input, output]) => input !== null && output !== null).map(([input, output]) => input + output);
        return totals.length ? { value: totals.reduce((sum, value) => sum + value, 0), detail: `${totals.length} check${totals.length === 1 ? "" : "s"}` } : null;
      } },

    { id: "checks_csv", kind: "exporter", label: "Plain-code checks as CSV", help: "your latest decision's checks: id, passed, level, label and detail (which quotes answer percentages); no review words",
      filename: "review-checks.csv", mime: "text/csv",
      build: (ctx) => {
        const checks = ctx.data.triage?.checks;
        if (!Array.isArray(checks)) throw new Error("Triage a review first: there are no checks to export.");
        return csvText([["id", "passed", "level", "label", "detail"], ...checks.map((one) => [one.id, one.ok ? "yes" : "no", one.level, one.label, one.detail])]);
      } },
    { id: "history_csv", kind: "exporter", label: "This session's checks as CSV", help: "the answers and measurements of your checks since the page loaded, oldest first; no review words and no decisions",
      filename: "review-session.csv", mime: "text/csv",
      build: (ctx) => {
        const ids = ["topic", "severity", "tone", "safety", "wants_reply", "about_us"];
        return csvText([["call", "at", "stars", "channel", ...ids, "latency_ms", "cost_usd"],
          ...historyOf(ctx).map((entry) => [entry.call ?? "", isoTime(entry.at), entry.review?.stars ?? "", entry.review?.channel ?? "",
            ...ids.map((id) => rawValue(entry.answers?.[id]) ?? ""), entry.meta?.latency_ms ?? "", entry.meta?.cost_usd ?? ""])]);
      } },
    { id: "topic_csv", kind: "exporter", label: "Topic probabilities as CSV", help: "your latest check's probability for each topic with the team the routing table names; no review words",
      filename: "review-topics.csv", mime: "text/csv",
      build: (ctx) => {
        const topic = ctx.items().find((item) => item.id === "topic");
        if (!topic) throw new Error("Triage a review first: there is no topic answer to export.");
        const labels = ctx.data.labels || {}, routes = ctx.data.topic_teams || {};
        return csvText([["topic", "label", "probability", "routed_team"],
          ...probs(topic).map((entry) => [entry.key, labels.topics?.[entry.key] || "", entry.p, labels.teams?.[routes[entry.key]] || routes[entry.key] || ""])]);
      } },
    { id: "policy_diff", kind: "exporter", label: "Policy changes from the defaults as Markdown", help: "the sliders that differ from the defaults, with both values; settings only, no review or answers",
      filename: "review-policy-changes.md", mime: "text/markdown",
      build: (ctx) => {
        const settings = ctx.data.settings, defaults = ctx.data.defaults, limits = ctx.data.limits || {};
        if (!settings || !defaults) throw new Error("The policy has not loaded yet.");
        const changed = ctx.data.changed || [];
        const body = changed.length ? formatMarkdownTable(["Setting", "Slider", "Now", "Default"], changed.map((key) => [key, limits[key]?.label || "", settings[key], defaults[key]]))
          : "Every setting is at its default.";
        return `# Policy changes from the defaults\n\n${body}\n`;
      } },

    starsCommand("stars_up", "Add a star", 1), starsCommand("stars_down", "Remove a star", -1),
    { id: "reset_policy", kind: "command", title: "Reset the policy to its defaults", group: "Reviews policy", help: "The page's Reset to defaults: re-decides with no Jev call.",
      when: (ctx) => (ctx.data.changed || []).length > 0, run: (ctx) => ctx.actions.resetPolicy() },
    { id: "copy_reasons", kind: "command", title: "Copy the decision's reasons", group: "Reviews",
      when: (ctx) => Array.isArray(ctx.data.triage?.reasons) && ctx.data.triage.reasons.length > 0,
      run: (ctx) => { ctx.env.copy(ctx.data.triage.reasons.join("\n")); ctx.env.toast("Copied the reasons of your latest decision."); } },
    { id: "focus_moved", kind: "command", title: "Focus the first moved policy slider", group: "Reviews policy",
      when: (ctx) => (ctx.data.changed || []).length > 0, run: (ctx) => ctx.actions.focusPolicy(ctx.data.changed[0]) },

    { id: "session_checks", kind: "panel", title: "This session's checks",
      improvements: [{ id: "table", title: "Show this session's checks with topic, severity, tone, latency and cost" },
        { id: "shown_row", title: "Mark the session check the page shows now" },
        { id: "copy", title: "Copy this session's checks as tab-separated text" }],
      render: (h, ctx, api) => {
        const history = historyOf(ctx);
        if (!history.length) return h("p", { class: "faint" }, "Triage a review: your checks of this page load appear here.");
        const shownAt = ctx.items().length ? history.length - 1 : -1;
        const rows = history.map(historyRow);
        const tsv = [["check", "stars", "topic", "severity", "tone", "latency_ms", "cost_usd", "shown"],
          ...rows.map((row, index) => [row.call ?? "", row.stars ?? "", row.topic, fixed(row.severity), fixed(row.tone), row.latency ?? "", row.cost ?? "", index === shownAt ? "yes" : ""])]
          .map((row) => row.join("\t")).join("\n");
        return h("div", {}, h("p", { class: "faint" }, "Your answered checks since the page loaded, oldest first. Earlier rows are earlier checks, not the shown one; nothing is kept after a reload."),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Check", "Stars", "Topic", "Severity", "Tone", "Latency", "Cost", ""].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row, index) => h("tr", { "data-call": String(row.call), "data-shown": index === shownAt ? "true" : "false", class: index === shownAt ? "active" : "",
              "aria-current": index === shownAt ? "true" : undefined },
            h("td", {}, `#${row.call ?? "?"}`), h("td", { class: "num" }, row.stars === null ? "—" : String(row.stars)), h("td", {}, row.topic || "—"),
            h("td", { class: "num" }, fixed(row.severity) || "—"), h("td", { class: "num" }, fixed(row.tone) || "—"),
            h("td", { class: "num" }, formatValue(row.latency, "ms")), h("td", { class: "num" }, formatValue(row.cost, "usd")),
            h("td", {}, index === shownAt ? "shown" : ""))))),
          h("button", { class: "btn sm ghost", "data-copy": "session", onclick: () => api.copy(tsv) }, "Copy checks"));
      } },
    { id: "flip_points", kind: "panel", title: "Where each rule would flip",
      improvements: [{ id: "table", title: "Show the cut value at which the rule reading each answer would change sides" },
        { id: "move", title: "Move a slider to its flip value, re-deciding with no Jev call" },
        { id: "copy", title: "Copy the flip points as tab-separated text" }],
      render: (h, ctx, api) => {
        const rows = flipRows(ctx);
        if (!rows.length) return h("p", { class: "faint" }, "Triage a review to see where each policy rule would change sides.");
        const tsv = [["question", "answer", "setting", "cut", "side now", "flips at"], ...rows.map((row) => [row.id, row.value.toFixed(2), row.key, String(row.at), row.side, row.flip === null ? "" : String(row.flip)])]
          .map((row) => row.join("\t")).join("\n");
        const move = (row) => {
          try {
            ctx.actions.setPolicy({ [row.key]: row.flip });
            api.toast(`Moved ${row.key} to ${row.flip}; the page re-decided with no Jev call.`);
          } catch (error) { api.toast(error.message, "error"); }
        };
        return h("div", {}, h("p", { class: "faint" }, "Advisory plain code on your latest check: each rule fires at answer ≥ cut, so it changes sides when the cut crosses the answer. Rules run in order, so the decision may not change; it is the page's triage. Moving P1 below P2 moves P2 too."),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Question", "Answer", "Setting", "Cut", "Side now", "Flips at", ""].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map((row) => h("tr", { "data-flip": `${row.id}:${row.key}` }, h("td", {}, row.id), h("td", { class: "num" }, row.value.toFixed(2)),
              h("td", {}, row.key), h("td", { class: "num" }, String(row.at)), h("td", {}, row.side), h("td", { class: "num" }, row.flip === null ? "outside the slider" : String(row.flip)),
              h("td", {}, row.flip === null ? null : h("button", { class: "btn sm ghost", "data-move": row.key, onclick: () => move(row) }, `Move to ${row.flip}`)))))),
          h("button", { class: "btn sm ghost", "data-copy": "flips", onclick: () => api.copy(tsv) }, "Copy flip points"));
      } },

    { id: "rating_gap", kind: "tool", group: "Reviews calculators", title: "Rating gap from stars and tone",
      help: "Stars 1–5 map to levels 0–4; the gap is how far the tone sits from that level. Arithmetic as the rating check describes it, not the page's decision.",
      inputs: [{ name: "stars", label: "Stars", type: "integer", min: 1, max: 5, default: 3 }, { name: "tone", label: "Tone (0–4)", type: "number", min: 0, max: 4 },
        { name: "cut", label: "Mismatch cut", type: "number", min: 0.5, max: 4, default: 2 }],
      compute: ({ stars, tone, cut }) => {
        const gap = Math.abs(tone - (stars - 1));
        return [["Star level", stars - 1], ["Rating gap", gap], ["At or above the cut", gap >= cut ? "yes" : "no"]];
      } },
  ],
});
