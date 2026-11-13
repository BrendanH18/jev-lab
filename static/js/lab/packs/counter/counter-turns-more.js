// More for the Counter page's chat turns ("counter.turns", contract: static/js/lab/surfaces/counter.js): which
// policy cuts each turn's evidence crosses, the page's streak and miss counts, the shape of the intent answer,
// conversation checks, two measurements and two exports. It reads only the turns of the user's own chat in this page load, never asks the
// model and never re-implements decide(): a comparison with one cut is advisory plain code, not the decision.
import { csvText, definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const integer = (value) => (Number.isInteger(value) ? value : null);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const turnOrder = (items) => items.filter((item) => Number.isInteger(item?.n)).sort((a, b) => a.n - b.n);
const intentName = (key) => String(key ?? "").replace(/_/g, " ");
const two = (value) => value.toFixed(2);

// The policy the shown decisions use; the sliders' policy while no decision exists yet.
const policyOf = (ctx) => ctx?.data?.decided_with || ctx?.data?.policy || null;

// Local advisory comparison of one evidence value with its cut under the policy of the shown decisions, as decide()
// compares it (at or above for person, missed and resolved; below for the top intent). Not the decision: an earlier
// rule may decide first. False when the value or the cut is unavailable.
const crosses = (field, key, below = false) => (item, ctx) => {
  const value = finite(item?.evidence?.[field]), cut = finite(policyOf(ctx)?.[key]);
  if (value === null || cut === null) return false;
  return below ? value < cut : value >= cut;
};
const crossHelp = (what, key, side) => `${what} is ${side} the ${key} cut of the policy the shown decisions use. `
  + "Advisory plain code, not the decision: an earlier rule may decide first.";

// The intent probabilities of a turn as [key, p] in response order; null when any is negative or none is positive.
function intentEntries(item) {
  const intents = item?.intents && typeof item.intents === "object" ? item.intents : {};
  const entries = Object.entries(intents).filter(([, p]) => finite(p) !== null);
  if (!entries.length || entries.some(([, p]) => p < 0)) return null;
  return entries.reduce((total, [, p]) => total + p, 0) > 0 ? entries : null;
}

// Shannon entropy of the intent probabilities in bits, after scaling them to sum to one.
function entropy(item) {
  const entries = intentEntries(item);
  if (!entries) return null;
  const total = entries.reduce((sum, [, p]) => sum + p, 0);
  return entries.reduce((bits, [, p]) => (p > 0 ? bits - (p / total) * Math.log2(p / total) : bits), 0);
}

// The most likely intent other than the top one (decide()'s, first on a tie), keeping response order on ties; null
// when no other intent has a positive probability.
function runnerUp(item) {
  const entries = intentEntries(item);
  const top = item?.evidence?.intent;
  if (!entries || typeof top !== "string") return null;
  let best = null;
  for (const [key, p] of entries) if (key !== top && p > 0 && (best === null || p > best[1])) best = [key, p];
  return best ? intentName(best[0]) : null;
}

const previousTurn = (item, ctx) => (Number.isInteger(item?.n) ? (ctx?.items?.() || []).find((other) => other?.n === item.n - 1) || null : null);

// The page's reason sentences (jev/counter.py decide()) grouped by the rule that wrote them.
const REASONS = [
  [/^Already handed to a person/, "already handed off"],
  [/^The customer asks for a person/, "asks for a person"],
  [/^Frustration stayed above the cut/, "frustration streak"],
  [/^The bot missed the point/, "missed turns"],
  [/^The customer's need is met/, "resolved"],
  [/^The intent is uncertain or has no reply template/, "uncertain intent"],
  [/^The intent selects a fixed reply/, "template reply"],
];
function ruleOf(item) {
  const reason = item?.decision?.reason;
  if (typeof reason !== "string" || !reason) return null;
  const found = REASONS.find(([pattern]) => pattern.test(reason));
  return found ? found[1] : "other";
}

const normalized = (text) => String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export default definePack({
  id: "counter-turns-more",
  surface: "counter.turns",
  title: "More chat turn insights",
  about: "Which policy cuts each turn crosses, streak and miss counts, intent-answer shape, conversation checks, token and trend measures, "
    + "and decision and intent-probability exports for the turns of your own Counter chat in this page load. Cut comparisons are advisory "
    + "plain code, never the decision; the exports hold no customer messages.",
  features: [
    { id: "person_over", kind: "fact", type: "flag", label: "ask-for-a-person probability at or above its cut",
      help: crossHelp("P(asks for a person)", "person_at", "at or above"), value: crosses("asks_for_person", "person_at") },
    { id: "missed_over", kind: "fact", type: "flag", label: "missed-the-point probability at or above its cut",
      help: `${crossHelp("P(missed the point)", "missed_at", "at or above")} Such a turn counts toward the missed turns.`, value: crosses("missed", "missed_at") },
    { id: "resolved_over", kind: "fact", type: "flag", label: "resolved probability at or above its cut",
      help: crossHelp("P(resolved)", "resolved_at", "at or above"), value: crosses("resolved", "resolved_at") },
    { id: "intent_under", kind: "fact", type: "flag", label: "top intent probability below its cut",
      help: crossHelp("The top intent probability", "intent_min", "below"), value: crosses("intent_prob", "intent_min", true) },
    { id: "streak", kind: "fact", type: "number", label: "frustrated-turn streak", unit: "turns",
      help: "Consecutive frustrated turns ending here, as the current decision counts them.", value: (item) => integer(item?.decision?.streak) },
    { id: "misses", kind: "fact", type: "number", label: "missed turns so far", unit: "turns",
      help: "Turns up to this one that missed the point, as the current decision counts them.", value: (item) => integer(item?.decision?.misses) },
    { id: "intent_entropy", kind: "fact", type: "number", label: "intent uncertainty in bits", unit: "bits",
      help: "Shannon entropy of the intent probabilities: 0 when one intent has all of it, log2(7) ≈ 2.81 when all seven are equal.", value: entropy },
    { id: "runner_up", kind: "fact", type: "category", label: "runner-up intent", help: "The most likely intent after the top one.", value: runnerUp },
    { id: "intent_switched", kind: "fact", type: "flag", label: "a top intent that differs from the previous turn's",
      help: "The customer seems to have moved to another topic (the previous turn of the chat had another top intent).",
      value: (item, ctx) => {
        const before = previousTurn(item, ctx);
        const now = item?.evidence?.intent, then = before?.evidence?.intent;
        return typeof now === "string" && typeof then === "string" && now !== then;
      } },
    { id: "rule", kind: "fact", type: "category", label: "rule behind the current decision",
      help: "The rule whose reason the current decision gives, grouped from the page's reason sentence.", value: ruleOf },

    { id: "repeated_message", kind: "diagnostic", severity: "advice", scope: "list", label: "The customer repeated an earlier message",
      help: "Same words, ignoring case and spacing: the bot's reply may not have helped.",
      check: (items) => {
        const seen = new Map(), out = [];
        for (const item of turnOrder(items)) {
          const key = normalized(item.customer);
          if (!key) continue;
          if (seen.has(key)) out.push(`Turn ${item.n} repeats the customer's message of turn ${seen.get(key)}.`);
          else seen.set(key, item.n);
        }
        return out;
      } },
    { id: "clarify_run", kind: "diagnostic", severity: "advice", scope: "list", label: "Clarify on consecutive turns",
      help: "Two or more turns in a row whose current decision asks the customer to clarify.",
      check: (items) => {
        const ordered = turnOrder(items), out = [];
        let start = 0;
        for (let i = 1; i <= ordered.length; i++) {
          const continues = i < ordered.length && ordered[i].n === ordered[i - 1].n + 1
            && ordered[i].decision?.action === "clarify" && ordered[i - 1].decision?.action === "clarify";
          if (continues) continue;
          if (i - start >= 2 && ordered[start].decision?.action === "clarify") {
            out.push(`Turns ${ordered[start].n} to ${ordered[i - 1].n} all ask the customer to clarify under the current policy (${i - start} in a row).`);
          }
          start = i;
        }
        return out;
      } },
    { id: "resolved_not_closed", kind: "diagnostic", severity: "info", label: "Resolved at the cut but not closed",
      help: "P(resolved) is at or above the close cut, yet the current decision is something else because a rule that runs earlier decided.",
      check: (item, ctx) => {
        const resolved = finite(item?.evidence?.resolved), cut = finite(policyOf(ctx)?.resolved_at), action = item?.decision?.action;
        if (resolved === null || cut === null || typeof action !== "string" || action === "close" || resolved < cut) return null;
        return `P(resolved) ${two(resolved)} is at or above the close cut ${two(cut)}, but the current decision is ${action}: ${item.decision.reason || "no reason given"}`;
      } },

    { id: "input_tokens", kind: "metric", format: "integer", label: "Measured input tokens of the shown turns",
      help: "The sum of each call's measured input tokens; every call reads the whole conversation so far.",
      compute: (ctx) => {
        const shown = ctx.shown();
        const tokens = shown.map((item) => integer(item?.meta?.input_tokens)).filter((value) => value !== null);
        if (!tokens.length) return null;
        return { value: tokens.reduce((total, value) => total + value, 0), detail: `${plural(tokens.length, "measured call")} of ${plural(shown.length, "shown turn")}` };
      } },
    { id: "frustration_slope", kind: "metric", format: "number", label: "Frustration trend per turn of the shown turns",
      help: "Least-squares slope of the frustration score against the turn number: positive when frustration grows.",
      compute: (ctx) => {
        const points = turnOrder(ctx.shown()).map((item) => [item.n, finite(item.evidence?.frustration)]).filter(([, y]) => y !== null);
        if (points.length < 2) return null;
        const mx = points.reduce((total, [x]) => total + x, 0) / points.length;
        const my = points.reduce((total, [, y]) => total + y, 0) / points.length;
        const sxx = points.reduce((total, [x]) => total + (x - mx) ** 2, 0);
        const sxy = points.reduce((total, [x, y]) => total + (x - mx) * (y - my), 0);
        return { value: sxy / sxx, detail: `score points per turn over ${plural(points.length, "turn")}` };
      } },

    { id: "decisions_csv", kind: "exporter", label: "Shown turns' decisions as CSV",
      help: "per turn the decision its reply was sent under and the decision now, with reasons, streak and misses; no customer messages or probabilities",
      filename: "counter-decisions.csv", mime: "text/csv",
      build: (ctx) => csvText([["turn", "sent_action", "sent_reply", "sent_reason", "current_action", "current_reply", "current_reason", "streak", "misses", "changed"],
        ...turnOrder(ctx.shown()).map((item) => [item.n, item.sent?.action ?? "", item.sent?.reply ?? "", item.sent?.reason ?? "",
          item.decision?.action ?? "", item.decision?.reply ?? "", item.decision?.reason ?? "", item.decision?.streak ?? "", item.decision?.misses ?? "",
          item.changed ? "yes" : "no"])]) },
    { id: "intents_csv", kind: "exporter", label: "Shown turns' intent probabilities as CSV",
      help: "per turn the model's choice and the probability of every intent from your calls; no customer messages",
      filename: "counter-intents.csv", mime: "text/csv",
      build: (ctx) => {
        const keys = Array.isArray(ctx.data?.intents) ? ctx.data.intents : [];
        return csvText([["turn", "model_choice", ...keys],
          ...turnOrder(ctx.shown()).map((item) => [item.n, item.intent_choice ?? "", ...keys.map((key) => finite(item.intents?.[key]) ?? "")])]);
      } },
  ],
});
