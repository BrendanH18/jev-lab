// Starter pack for the Shield inbox ("shield.inbox", contract: static/js/lab/surfaces/shield.js).
// It reads only the verdicts of messages the user screened in this page session and never asks the model: its
// commands open messages that already have a result. Scenario notes ("expected") are demo copy, never sent to Jev,
// and everything that uses them says so.
import { csvText, definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const screened = (items) => items.filter((item) => item?.status === "screened" && item.verdict);
const NEAR = 0.05;
const LEVEL_WORDS = { safe: "Nothing suspicious", review: "Hold for a human", quarantine: "Quarantined" };
const STATUS_WORDS = { unscreened: "not screened yet", screened: "screened", failed: "failed", skipped: "skipped by the batch" };

// The page's thresholds that a verdict's risk is compared with: [name, value] pairs.
function thresholds(ctx) {
  const policy = ctx?.data?.policy;
  if (!policy) return [];
  return [["review", finite(policy.review_at)], ["quarantine", finite(policy.quarantine_at)]].filter(([, value]) => value !== null);
}

// [name, cut, distance] of the threshold nearest to the item's risk, or null.
function nearest(item, ctx) {
  const risk = finite(item?.verdict?.risk);
  if (risk === null) return null;
  let best = null;
  for (const [name, cut] of thresholds(ctx)) {
    const distance = Math.abs(risk - cut);
    if (!best || distance < best[2]) best = [name, cut, distance];
  }
  return best;
}

const strongest = (item) => {
  const values = (item?.verdict?.signals || []).map((signal) => finite(signal.contribution)).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
};

const labelOf = (map, key) => (key === null || key === undefined ? null : (map && map[key]) || key);

// Opens the next (direction 1) or previous (-1) shown message that already has a result, wrapping around. With the
// opened message hidden (or "Write your own" open) it starts from the top, or from the bottom going back. Unscreened
// messages are skipped: opening one would ask Jev.
function step(ctx, direction) {
  const shown = ctx.shown();
  const count = shown.length;
  const at = shown.findIndex((item) => item.selected);
  for (let offset = 1; offset <= count; offset++) {
    const index = at === -1 ? (direction > 0 ? offset - 1 : count - offset) : (((at + direction * offset) % count) + count) % count;
    if (shown[index].status !== "unscreened") return ctx.actions.open(shown[index].id);
  }
  throw new Error("No shown message has a result yet. Click one in the inbox to screen it.");
}

const cell = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();

export default definePack({
  id: "shield-inbox-triage",
  surface: "shield.inbox",
  title: "Inbox triage",
  about: "Filters, checks, measurements, exports and keyboard navigation over the verdicts of messages you screened in this page "
    + "session. Nothing asks Jev; scenario notes are labeled as demo notes, and the CSV holds no message bodies or answers.",
  features: [
    { id: "risk", kind: "fact", type: "number", label: "combined risk", unit: "0 to 1", help: "The verdict's noisy-OR risk; unscreened messages have none.",
      value: (item) => finite(item?.verdict?.risk) },
    { id: "harm", kind: "fact", type: "number", label: "loss if obeyed", unit: "0 to 3", help: "The harm_if_obeyed score.",
      value: (item) => finite(item?.verdict?.harm) },
    { id: "latency", kind: "fact", type: "number", label: "measured latency", unit: "ms", value: (item) => finite(item?.meta?.latency_ms) },
    { id: "cost", kind: "fact", type: "number", label: "measured cost", unit: "USD", value: (item) => finite(item?.meta?.cost_usd) },
    { id: "strongest", kind: "fact", type: "number", label: "strongest signal contribution", unit: "0 to 1",
      help: "The largest weight × probability among the eight signals.", value: strongest },
    { id: "threshold_distance", kind: "fact", type: "number", label: "distance to the nearest threshold", unit: "0 to 1",
      help: "How far the risk sits from the review or quarantine threshold now set on the sliders.",
      value: (item, ctx) => nearest(item, ctx)?.[2] ?? null },
    { id: "rule_count", kind: "fact", type: "number", label: "hard rules fired", unit: "rules",
      value: (item) => (item?.verdict ? item.verdict.rules.length : null) },

    { id: "level", kind: "fact", type: "category", label: "verdict", value: (item) => item?.verdict?.level || null },
    { id: "category", kind: "fact", type: "category", label: "message kind", help: "The category Choice answer.",
      value: (item, ctx) => labelOf(ctx?.data?.category_labels, item?.verdict?.category) },
    { id: "claimed", kind: "fact", type: "category", label: "claimed sender", help: "The claimed_identity Choice answer.",
      value: (item, ctx) => labelOf(ctx?.data?.identity_labels, item?.fact?.claimed_identity) },
    { id: "status", kind: "fact", type: "category", label: "screening status", value: (item) => STATUS_WORDS[item?.status] || null },
    { id: "domain", kind: "fact", type: "text", label: "sender domain", help: "The part of the address after @, as code compares it.",
      value: (item) => item?.sender_domain ?? "" },

    { id: "lookalike", kind: "fact", type: "flag", label: "a lookalike sender domain", help: "Code check: the domain contains the claimed sender's name but is not its domain.",
      value: (item) => item?.fact?.lookalike_domain === true },
    { id: "mismatch", kind: "fact", type: "flag", label: "a sender domain mismatch", value: (item) => item?.fact?.domain_matches === false },
    { id: "differs", kind: "fact", type: "flag", label: "a verdict unlike the scenario note",
      help: "The verdict differs from what the scenario note expects (a demo note, never sent to Jev).", value: (item) => item?.matched === false },

    { id: "near_threshold", kind: "diagnostic", severity: "advice", label: "Close to a threshold",
      check: (item, ctx) => {
        const near = nearest(item, ctx);
        if (!near || near[2] >= NEAR) return null;
        return `Risk ${percent(item.verdict.risk)} is ${(near[2] * 100).toFixed(1)} points from the ${near[0]} threshold (${percent(near[1])}): a small weight change can flip this verdict.`;
      } },
    { id: "unlike_note", kind: "diagnostic", severity: "info", label: "Verdict unlike the scenario note",
      check: (item) => (item?.matched === false
        ? `Verdict ${item.verdict.level}, but the scenario note expects ${item.expected} (a demo note, never sent to Jev): ${item.note || "no note text"}.` : null) },
    { id: "no_result", kind: "diagnostic", severity: "problem", label: "Screen failed or was skipped",
      check: (item) => (item?.status === "failed" || item?.status === "skipped"
        ? `${item.status === "failed" ? "The screen failed" : "The batch skipped it"}: ${item.error || "no message"}. Click it to screen it again.` : null) },
    { id: "unsure_sender", kind: "diagnostic", severity: "advice", label: "Mismatch below the identity cut",
      check: (item, ctx) => {
        const fact = item?.fact;
        const cut = finite(ctx?.data?.rules?.mismatch_prob) ?? 0.6;
        const p = finite(fact?.claimed_identity_prob);
        if (fact?.domain_matches !== false || p === null || p >= cut) return null;
        return `${fact.sender_domain || "The sender"} is not ${fact.expected_domain}, but P(claimed sender) is ${percent(p)}, below ${percent(cut)}, so no hard rule used the mismatch.`;
      } },
    { id: "unscreened_left", kind: "diagnostic", severity: "info", scope: "list", label: "Messages without a result",
      check: (items) => {
        const left = items.filter((item) => item.status === "unscreened");
        return left.length ? `${plural(left.length, "shown message")} not screened yet: ${left.map((item) => `#${item.position}`).join(", ")}.` : null;
      } },

    { id: "screened_count", kind: "metric", format: "integer", label: "Shown messages screened",
      compute: (ctx) => { const done = screened(ctx.shown()).length; return done ? { value: done, detail: `of ${ctx.shown().length} shown` } : null; } },
    { id: "quarantine_share", kind: "metric", format: "percent", label: "Share of screened shown messages quarantined",
      compute: (ctx) => {
        const done = screened(ctx.shown());
        if (!done.length) return null;
        const held = done.filter((item) => item.verdict.level === "quarantine").length;
        return { value: held / done.length, detail: `${held} of ${done.length}` };
      } },
    { id: "agreement", kind: "metric", format: "percent", label: "Agreement with the scenario notes",
      help: "Screened shown messages whose verdict equals the scenario note's expectation (demo notes, never sent to Jev).",
      compute: (ctx) => {
        const judged = ctx.shown().filter((item) => item.matched === true || item.matched === false);
        if (!judged.length) return null;
        const agree = judged.filter((item) => item.matched).length;
        return { value: agree / judged.length, detail: `${agree} of ${judged.length}` };
      } },
    { id: "measured_cost", kind: "metric", format: "usd", label: "Measured cost of the shown screens",
      help: "The sum of each shown message's latest call cost; measured, not an estimate.",
      compute: (ctx) => {
        const costs = ctx.shown().map((item) => finite(item?.meta?.cost_usd)).filter((value) => value !== null);
        return costs.length ? { value: sum(costs), detail: `${plural(costs.length, "measured call")}` } : null;
      } },
    { id: "mean_latency", kind: "metric", format: "ms", label: "Mean measured latency of the shown screens",
      compute: (ctx) => {
        const values = ctx.shown().map((item) => finite(item?.meta?.latency_ms)).filter((value) => value !== null);
        return values.length ? sum(values) / values.length : null;
      } },

    { id: "verdicts_csv", kind: "exporter", label: "Shown verdicts as CSV",
      help: "senders, subjects, verdicts, risk and the scenario notes' expectation; no message bodies and no answers",
      filename: "shield-verdicts.csv", mime: "text/csv",
      build: (ctx) => csvText([["position", "from", "sender_domain", "subject", "status", "verdict", "risk", "harm", "hard_rules", "scenario_expected", "matches_note"],
        ...ctx.shown().map((item) => [item.position, item.from_name, item.sender_domain, item.subject, item.status, item.verdict?.level ?? "",
          finite(item.verdict?.risk) ?? "", finite(item.verdict?.harm) ?? "", (item.verdict?.rules || []).map((rule) => rule.id).join(" "),
          item.expected ?? "", item.matched === null ? "" : item.matched ? "yes" : "no"])]) },
    { id: "triage_md", kind: "exporter", label: "Triage summary as Markdown",
      help: "the shown screened messages grouped by verdict with sender, subject, risk and fired hard rules; no bodies or answers",
      filename: "shield-triage.md", mime: "text/markdown",
      build: (ctx) => {
        const done = screened(ctx.shown());
        const lines = ["# Shield triage", ""];
        for (const level of ["quarantine", "review", "safe"]) {
          const group = done.filter((item) => item.verdict.level === level);
          if (!group.length) continue;
          lines.push(`## ${LEVEL_WORDS[level]} (${group.length})`, "");
          for (const item of group) {
            const rules = item.verdict.rules.map((rule) => rule.id).join(", ");
            lines.push(`- ${cell(item.from_name) || `#${item.position}`}: ${cell(item.subject) || "(no subject)"} · risk ${finite(item.verdict.risk) === null ? "n/a" : percent(item.verdict.risk)}${rules ? ` · ${rules}` : ""}`);
          }
          lines.push("");
        }
        const left = ctx.shown().length - done.length;
        lines.push(done.length ? `${plural(done.length, "message")} screened${left ? `, ${left} without a verdict` : ""}.` : "No shown message has a verdict yet.");
        return `${lines.join("\n")}\n`;
      } },

    { id: "next_screened", kind: "command", title: "Open the next screened message", group: "Shield", keys: "Alt+Shift+J",
      when: (ctx) => ctx.shown().some((item) => item.status !== "unscreened"), run: (ctx) => step(ctx, 1) },
    { id: "previous_screened", kind: "command", title: "Open the previous screened message", group: "Shield", keys: "Alt+Shift+K",
      when: (ctx) => ctx.shown().some((item) => item.status !== "unscreened"), run: (ctx) => step(ctx, -1) },
  ],
});
