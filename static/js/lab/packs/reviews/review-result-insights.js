// Facts, checks, metrics, exports, commands and a margins panel for the answers of the user's own latest Reviews check.
// Contract: static/js/lab/surfaces/reviews.js ("reviews.result"). Every rule here ("close to a cut", "between levels")
// is advisory plain code; the decision is the page's triage, and policy changes go through its own sliders.
import { csvText, definePack } from "../../kit.js";

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const probs = (item) => (Array.isArray(item?.probabilities) ? item.probabilities.filter((entry) => number(entry?.p) !== null) : []);
const cutsOf = (item) => (Array.isArray(item?.cuts) ? item.cuts.filter((cut) => number(cut?.at) !== null) : []);
const CLOSE = 0.1;
const signed = (value) => `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
const list = (value) => (Array.isArray(value) ? value : []);
const flagText = (ctx, flags) => {
  const names = ctx.data.labels?.flags || {};
  return flags.length ? flags.map((flag) => names[flag] || flag).join(", ") : "";
};

function nearestCut(item) {
  const value = number(item?.value);
  const cuts = cutsOf(item);
  if (value === null || !cuts.length) return null;
  return Math.min(...cuts.map((cut) => Math.abs(value - cut.at)));
}

function entropy(item) {
  const entries = probs(item);
  const total = entries.reduce((sum, entry) => sum + entry.p, 0);
  if (entries.length < 2 || !(total > 0)) return null;
  const h = entries.reduce((sum, entry) => (entry.p > 0 ? sum - (entry.p / total) * Math.log(entry.p / total) : sum), 0);
  return Math.max(0, h / Math.log(entries.length));
}

// One row per policy cut of the answers that have a numeric value: [question, answer, cut, at, margin].
function marginRows(ctx) {
  return ctx.items().flatMap((item) => {
    const value = number(item.value);
    return value === null ? [] : cutsOf(item).map((cut) => [item.id, value, cut.key, cut.at, value - cut.at]);
  });
}

function nudge(ctx, key, by) {
  const settings = ctx.data.settings;
  if (!settings) throw new Error("The policy has not loaded yet.");
  return ctx.actions.setPolicy({ [key]: Number((settings[key] + by).toFixed(2)) });
}
const canNudge = (ctx, key, by) => {
  const settings = ctx.data.settings, limit = ctx.data.limits?.[key];
  if (!settings || !limit) return false;
  const next = settings[key] + by;
  return next >= limit.min - 1e-9 && next <= limit.max + 1e-9;
};

function decisionMarkdown(ctx) {
  const t = ctx.data.triage;
  if (!t) throw new Error("Triage a review first: there is no decision to export.");
  const policy = ctx.data.policy || {};
  const lines = ["# Review decision", "",
    `Your latest check${ctx.data.review?.channel_label ? ` of a ${ctx.data.review.channel_label}` : ""}, decided by plain code under the policy below.`, "",
    `- Action: ${t.action_label || t.action || "—"}`, `- Team: ${t.team_label || t.team || "—"}`, `- Priority: ${t.priority || "—"}`,
    `- Flags: ${flagText(ctx, list(t.flags)) || "none"}`,
    `- Public auto-reply: ${t.auto_reply_allowed ? "yes, the thank-you template" : "no"}`, "",
    "## Reasons", "", ...list(t.reasons).map((reason) => `- ${reason}`), "",
    "## Checks", "", ...list(t.checks).filter((one) => one && typeof one === "object").map((one) => `- [${one.ok ? "x" : " "}] ${one.label ?? ""}: ${one.detail ?? ""}`), "",
    "## Policy", "", "| Setting | Value |", "| --- | ---: |", ...Object.entries(policy).map(([key, value]) => `| ${key} | ${value} |`), ""];
  return lines.join("\n");
}

export default definePack({
  id: "review-result-insights",
  surface: "reviews.result",
  title: "Review result insights",
  about: "Margins, confidence and policy-cut facts over the answers of your own latest Reviews check, with commands to copy the decision, nudge the safety cut (no model call) and inspect the request, and exports of the decision, answers or policy. Close-call rules are advisory local code, never the decision.",
  features: [
    { id: "top_p", kind: "fact", type: "number", label: "top probability", value: (item) => number(item.top?.p) },
    { id: "margin", kind: "fact", type: "number", label: "margin over the runner-up", help: "Top probability minus the second; for a Noul, P(yes) against P(no).",
      value: (item) => {
        const sorted = probs(item).map((entry) => entry.p).sort((a, b) => b - a);
        return sorted.length >= 2 ? sorted[0] - sorted[1] : null;
      } },
    { id: "cut_distance", kind: "fact", type: "number", label: "distance to the nearest cut", help: "On the answer's own scale; answers no cut reads are unavailable.",
      value: (item) => nearestCut(item) },
    { id: "confidence", kind: "fact", type: "number", label: "reported confidence", help: "Noul answers carry none.", value: (item) => number(item.confidence) },
    { id: "entropy", kind: "fact", type: "number", label: "normalized entropy", help: "0 when one option holds everything, 1 when all are equal.", value: (item) => entropy(item) },
    { id: "options", kind: "fact", type: "number", label: "option count", value: (item) => probs(item).length || null },
    { id: "type", kind: "fact", type: "category", label: "answer type", value: (item) => item.type || null },
    { id: "question", kind: "fact", type: "text", label: "question text", value: (item) => (typeof item.instructions === "string" ? item.instructions : "") },
    { id: "reading", kind: "fact", type: "text", label: "answer label", help: "The topic or the nearest level's description, else the printed answer.",
      value: (item) => item.label || item.display || "" },
    { id: "close_call", kind: "fact", type: "flag", label: "a value within 0.1 of a cut", help: "Advisory: a small change in the answer could flip that rule.",
      value: (item) => { const distance = nearestCut(item); return distance !== null && distance <= CLOSE + 1e-9; } },

    { id: "between_levels", kind: "diagnostic", severity: "advice", label: "Score between two levels",
      check: (item) => {
        const value = number(item.value);
        if (item.type !== "score" || value === null) return null;
        const floor = Math.floor(value), fraction = value - floor;
        return fraction >= 0.35 - 1e-9 && fraction <= 0.65 + 1e-9 ? `Score ${value.toFixed(2)} sits between levels ${floor} and ${floor + 1}.` : null;
      } },
    { id: "low_confidence", kind: "diagnostic", severity: "advice", scope: "list", label: "Low mean confidence",
      check: (items) => {
        const values = items.map((item) => number(item.confidence)).filter((value) => value !== null);
        if (!values.length) return null;
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        return average < 0.5 ? `Mean confidence of the shown Choice and Score answers is ${Math.round(average * 100)}%.` : null;
      } },

    { id: "checks_passed", kind: "metric", label: "Plain-code checks passed", format: "percent",
      compute: (ctx) => {
        const checks = ctx.data.triage?.checks;
        if (!Array.isArray(checks) || !checks.length) return null;
        const passed = checks.filter((one) => one.ok).length;
        return { value: passed / checks.length, detail: `${passed} of ${checks.length}` };
      } },
    { id: "session_cost", kind: "metric", label: "Measured cost of this session's checks", format: "usd", help: "Measured by the server for each of your checks since the page loaded.",
      compute: (ctx) => {
        const costs = ctx.data.history.map((entry) => number(entry.meta?.cost_usd)).filter((value) => value !== null);
        return costs.length ? { value: costs.reduce((sum, value) => sum + value, 0), detail: `${costs.length} check${costs.length === 1 ? "" : "s"}` } : null;
      } },
    { id: "mean_latency", kind: "metric", label: "Mean latency of this session's checks", format: "ms",
      compute: (ctx) => {
        const values = ctx.data.history.map((entry) => number(entry.meta?.latency_ms)).filter((value) => value !== null);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      } },
    { id: "changed_settings", kind: "metric", label: "Policy settings moved from the defaults", format: "integer",
      compute: (ctx) => {
        const settings = ctx.data.settings, defaults = ctx.data.defaults;
        if (!settings || !defaults) return null;
        return { value: ctx.data.changed.length, detail: ctx.data.changed.map((key) => `${key} ${settings[key]} (default ${defaults[key]})`).join("; ") };
      } },

    { id: "decision_markdown", kind: "exporter", label: "Decision summary as Markdown",
      help: "your latest check's decision, reasons, plain-code checks and the policy in force; no review text. The reasons and check details quote answers and percentages as the page prints them.",
      filename: "review-decision.md", mime: "text/markdown", build: decisionMarkdown },
    { id: "answers_csv", kind: "exporter", label: "Shown answers as CSV", help: "the shown answers of your latest check: value, label, top option, its probability and the confidence; no review text",
      filename: "review-answers.csv", mime: "text/csv",
      build: (ctx) => csvText([["question", "type", "value", "label", "top", "top_probability", "confidence"],
        ...ctx.shown().map((item) => [item.id, item.type, item.value ?? "", item.label, item.top?.key ?? "", item.top?.p ?? "", item.confidence ?? ""])]) },
    { id: "policy_json", kind: "exporter", label: "Policy settings as JSON", help: "the sliders' values only; no review or answers",
      filename: "review-policy.json", mime: "application/json",
      build: (ctx) => {
        if (!ctx.data.settings) throw new Error("The policy has not loaded yet.");
        return `${JSON.stringify(ctx.data.settings, null, 2)}\n`;
      } },

    { id: "copy_decision", kind: "command", title: "Copy the decision line", group: "Reviews", when: (ctx) => !!ctx.data.triage,
      run: (ctx) => {
        const t = ctx.data.triage;
        if (!t) throw new Error("Triage a review first: there is no decision to copy.");
        ctx.env.copy(`${t.action_label || t.action || "—"} · ${t.team_label || t.team || "—"} · ${t.priority || "—"} · ${flagText(ctx, list(t.flags)) || "no flags"}`);
        ctx.env.toast("Copied the decision of your latest check.");
      } },
    { id: "raise_safety", kind: "command", title: "Raise the safety cut one step", group: "Reviews policy", when: (ctx) => canNudge(ctx, "safety_at", 0.05),
      run: (ctx) => nudge(ctx, "safety_at", 0.05) },
    { id: "lower_safety", kind: "command", title: "Lower the safety cut one step", group: "Reviews policy", when: (ctx) => canNudge(ctx, "safety_at", -0.05),
      run: (ctx) => nudge(ctx, "safety_at", -0.05) },
    { id: "inspect", kind: "command", title: "Inspect the latest review request", group: "Reviews", keys: "Alt+Shift+I", when: (ctx) => ctx.items().length > 0,
      run: (ctx) => ctx.actions.inspect() },

    { id: "cut_margins", kind: "panel", title: "Policy cut margins",
      improvements: [{ id: "table", title: "Show each policy cut beside the answer it reads, with the margin" },
        { id: "copy", title: "Copy the policy cut margins as tab-separated text" }],
      render: (h, ctx, api) => {
        const rows = marginRows(ctx);
        if (!rows.length) return h("p", { class: "faint" }, "Triage a review to compare its answers with the policy cuts.");
        const text = [["question", "answer", "cut", "at", "margin"], ...rows.map(([id, value, key, at, margin]) => [id, value.toFixed(2), key, String(at), signed(margin)])]
          .map((row) => row.join("\t")).join("\n");
        return h("div", {}, h("p", { class: "faint" }, "Answer minus cut, from your latest check and the policy in force. Advisory: the decision is the page's triage."),
          h("table", { class: "table lab-table" },
            h("thead", {}, h("tr", {}, ["Question", "Answer", "Cut", "At", "Margin"].map((label) => h("th", {}, label)))),
            h("tbody", {}, rows.map(([id, value, key, at, margin]) => h("tr", { "data-cut": `${id}:${key}` }, h("td", {}, id), h("td", { class: "num" }, value.toFixed(2)),
              h("td", {}, key), h("td", { class: "num" }, String(at)), h("td", { class: "num" }, signed(margin)))))),
          h("button", { class: "btn sm ghost", "data-copy": "margins", onclick: () => api.copy(text) }, "Copy margins"));
      } },
  ],
});
