// Starter pack for the Counter page's chat turns ("counter.turns", contract: static/js/lab/surfaces/counter.js).
// It reads only the turns of the user's own chat in this page load and never asks the model. Its one policy command
// moves the sliders through the page's own setPolicy (a re-decide in plain code, no model call), and its one message
// command fills the message box without sending.
import { csvText, definePack } from "../../kit.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const turnOrder = (items) => items.filter((item) => Number.isInteger(item?.n)).sort((a, b) => a.n - b.n);
// Probabilities arrive as binary floats (0.45 - 0.5 is -0.04999…, 0.55 - 0.5 is 0.05000…), so comparisons with a
// margin allow this much slack to treat both sides of a cut alike.
const EPSILON = 1e-9;
const intentName = (key) => String(key ?? "").replace(/_/g, " ");

// The two most likely intents of a turn, highest first, or null when fewer than two have a probability.
function topTwo(item) {
  const entries = Object.entries(item?.intents && typeof item.intents === "object" ? item.intents : {})
    .filter(([, p]) => finite(p) !== null).sort((a, b) => b[1] - a[1]);
  return entries.length >= 2 ? entries.slice(0, 2) : null;
}
const intentMargin = (item) => { const two = topTwo(item); return two ? two[0][1] - two[1][1] : null; };

// The policy the shown decisions use; the sliders' policy while no decision exists yet.
const policyOf = (ctx) => ctx?.data?.decided_with || ctx?.data?.policy || null;

// Local advisory rule: the evidence sits 0.05 or less from a probability cut, or 0.2 or less (5% of the 0 to 4 scale)
// from the frustration cut.
const CUTS = [["asks_for_person", "person_at", 0.05], ["missed", "missed_at", 0.05], ["resolved", "resolved_at", 0.05],
  ["intent_prob", "intent_min", 0.05], ["frustration", "frustration_at", 0.2]];
function nearCut(item, ctx) {
  const policy = policyOf(ctx);
  if (!policy) return false;
  return CUTS.some(([field, key, margin]) => {
    const value = finite(item?.evidence?.[field]), cut = finite(policy[key]);
    return value !== null && cut !== null && Math.abs(value - cut) <= margin + EPSILON;
  });
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const newest = (ctx) => turnOrder(ctx.items()).at(-1) || null;
const samePolicy = (a, b) => !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => a[key] === b[key]);

export default definePack({
  id: "counter-turn-insights",
  surface: "counter.turns",
  title: "Chat turn insights",
  about: "Filters, checks, measurements, exports and shortcuts over the turns of your own Counter chat in this page load. "
    + "Nothing calls the model: the policy shortcut re-decides through the page's sliders, and the transcript export holds your customer messages.",
  features: [
    { id: "frustration", kind: "fact", type: "number", label: "frustration score", unit: "0 to 4", value: (item) => finite(item?.evidence?.frustration) },
    { id: "person_p", kind: "fact", type: "number", label: "ask-for-a-person probability", unit: "0 to 1", value: (item) => finite(item?.evidence?.asks_for_person) },
    { id: "missed_p", kind: "fact", type: "number", label: "missed-the-point probability", unit: "0 to 1", value: (item) => finite(item?.evidence?.missed) },
    { id: "resolved_p", kind: "fact", type: "number", label: "resolved probability", unit: "0 to 1", value: (item) => finite(item?.evidence?.resolved) },
    { id: "intent_p", kind: "fact", type: "number", label: "top intent probability", unit: "0 to 1", value: (item) => finite(item?.evidence?.intent_prob) },
    { id: "intent_margin", kind: "fact", type: "number", label: "lead of the top intent over the runner-up", unit: "0 to 1",
      help: "Top intent probability minus the second highest.", value: intentMargin },
    { id: "latency", kind: "fact", type: "number", label: "measured latency", unit: "ms", value: (item) => finite(item?.meta?.latency_ms) },
    { id: "cost", kind: "fact", type: "number", label: "measured cost", unit: "USD", value: (item) => finite(item?.meta?.cost_usd) },
    { id: "message_words", kind: "fact", type: "number", label: "customer message word count", unit: "words",
      value: (item) => String(item?.customer ?? "").split(/\s+/).filter(Boolean).length || null },
    { id: "changed", kind: "fact", type: "flag", label: "a different decision under the current policy",
      help: "The decision now differs from the one the reply was sent under.", value: (item) => item?.changed === true },
    { id: "choice_differs", kind: "fact", type: "flag", label: "model choice that differs from the top probability",
      help: "The intent's choice field names another intent than the highest probability, which decide() uses.",
      value: (item) => typeof item?.intent_choice === "string" && typeof item?.evidence?.intent === "string" && item.intent_choice !== item.evidence.intent },
    { id: "near_cut", kind: "fact", type: "flag", label: "evidence near a policy cut",
      help: "Local advisory rule, not the decision: a probability 0.05 or less from its cut, or frustration 0.2 or less from its cut, "
        + "under the policy of the shown decisions.", value: nearCut },
    { id: "action_now", kind: "fact", type: "category", label: "current decision", value: (item) => item?.decision?.action || null },
    { id: "action_sent", kind: "fact", type: "category", label: "decision the reply was sent under", value: (item) => item?.sent?.action || null },
    { id: "intent", kind: "fact", type: "category", label: "top intent", value: (item) => (item?.evidence?.intent ? intentName(item.evidence.intent) : null) },
    { id: "message", kind: "fact", type: "text", label: "customer message", value: (item) => item?.customer ?? "" },

    { id: "close_intents", kind: "diagnostic", severity: "advice", label: "Two intents almost tied",
      check: (item) => {
        const two = topTwo(item);
        if (!two || two[0][1] - two[1][1] >= 0.1 - EPSILON) return null;
        return `The top intents ${intentName(two[0][0])} (${percent(two[0][1])}) and ${intentName(two[1][0])} (${percent(two[1][1])}) are less than 10 points apart, so a slightly different reading would pick another template.`;
      } },
    { id: "frustration_rising", kind: "diagnostic", severity: "advice", scope: "list", label: "Frustration rising turn after turn",
      check: (items) => {
        const ordered = turnOrder(items).filter((item) => finite(item?.evidence?.frustration) !== null);
        const out = [];
        let start = 0;
        for (let i = 1; i <= ordered.length; i++) {
          const rising = i < ordered.length && ordered[i].n === ordered[i - 1].n + 1 && ordered[i].evidence.frustration > ordered[i - 1].evidence.frustration;
          if (rising) continue;
          if (i - start >= 3) {
            const first = ordered[start], last = ordered[i - 1];
            out.push(`Frustration rose on every turn from turn ${first.n} to turn ${last.n} (${first.evidence.frustration.toFixed(1)} to ${last.evidence.frustration.toFixed(1)} of 4).`);
          }
          start = i;
        }
        return out;
      } },

    { id: "peak_frustration", kind: "metric", format: "number", label: "Highest frustration score of the shown turns",
      compute: (ctx) => {
        const values = ctx.shown().map((item) => finite(item?.evidence?.frustration)).filter((value) => value !== null);
        return values.length ? Math.max(...values) : null;
      } },
    { id: "changed_count", kind: "metric", format: "integer", label: "Turns decided differently under the current policy",
      help: "Every turn of the chat, compared with the decision its reply was sent under.",
      compute: (ctx) => {
        const items = ctx.items();
        if (!items.length) return null;
        const changed = items.filter((item) => item?.changed === true).length;
        return { value: changed, detail: `of ${plural(items.length, "turn")}` };
      } },
    { id: "median_latency", kind: "metric", format: "ms", label: "Median measured latency of the shown turns",
      compute: (ctx) => median(ctx.shown().map((item) => finite(item?.meta?.latency_ms)).filter((value) => value !== null)) },
    { id: "thousand_chats", kind: "metric", format: "usd", label: "Estimated cost of 1,000 chats like this one",
      help: "Mean measured cost per call times this chat's turns times 1,000. An estimate, not spend.",
      compute: (ctx) => {
        const items = ctx.items();
        const costs = items.map((item) => finite(item?.meta?.cost_usd)).filter((value) => value !== null);
        if (!costs.length) return null;
        return { value: (sum(costs) / costs.length) * items.length * 1000, detail: `estimate from ${plural(costs.length, "measured call")}` };
      } },

    { id: "transcript_md", kind: "exporter", label: "Chat transcript as Markdown",
      help: "your customer messages, the bot's fixed replies and each turn's decisions for the shown turns; no probabilities",
      filename: "counter-chat.md", mime: "text/markdown",
      build: (ctx) => {
        const shown = turnOrder(ctx.shown());
        if (!shown.length) throw new Error("There is no turn to export yet.");
        const sample = ctx.data?.chat?.sample;
        const lines = [`# Counter chat${sample ? ` · ${sample.label}` : ""}`, ""];
        for (const item of shown) {
          lines.push(`## Turn ${item.n}`, "", `**Customer:** ${item.customer}`, "", `**Bot (sent as ${item.sent?.action ?? "unknown"}):** ${item.bot}`, "",
            `Current policy: ${item.decision ? `${item.decision.action} · ${item.decision.reason}` : "no decision"}`, "");
        }
        return lines.join("\n");
      } },
    { id: "judgments_csv", kind: "exporter", label: "Shown turns' judgments as CSV",
      help: "your customer messages, the five judgments of your calls, both decisions and measured latency and cost",
      filename: "counter-judgments.csv", mime: "text/csv",
      build: (ctx) => csvText([["turn", "customer", "intent", "intent_p", "frustration", "asks_for_person", "missed", "resolved", "sent_action", "current_action", "latency_ms", "cost_usd"],
        ...turnOrder(ctx.shown()).map((item) => [item.n, item.customer, item.evidence?.intent ?? "", item.evidence?.intent_prob ?? "", item.evidence?.frustration ?? "",
          item.evidence?.asks_for_person ?? "", item.evidence?.missed ?? "", item.evidence?.resolved ?? "", item.sent?.action ?? "", item.decision?.action ?? "",
          item.meta?.latency_ms ?? "", item.meta?.cost_usd ?? ""])]) },
    { id: "policy_json", kind: "exporter", label: "Policy sliders as JSON",
      help: "the seven settings now and the defaults; no messages or answers", filename: "counter-policy.json", mime: "application/json",
      build: (ctx) => {
        const policy = ctx.data?.policy;
        if (!policy) throw new Error("The policy has not loaded yet.");
        return `${JSON.stringify({ policy, defaults: ctx.data.defaults || null }, null, 2)}\n`;
      } },

    { id: "inspect_newest", kind: "command", title: "Inspect the newest turn's JSON", group: "Counter", keys: "Alt+Shift+I",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => {
        const item = newest(ctx);
        if (!item) throw new Error("No turn has been sent yet.");
        ctx.actions.inspectTurn(item.n);
      } },
    { id: "restore_sent_policy", kind: "command", title: "Set the sliders to the policy the newest reply was sent under", group: "Counter",
      when: (ctx) => { const item = newest(ctx); return !!item?.sent_policy && !!ctx.data?.policy && !samePolicy(item.sent_policy, ctx.data.policy); },
      run: (ctx) => {
        const item = newest(ctx);
        if (!item?.sent_policy) throw new Error("No reply has a recorded policy yet.");
        ctx.actions.setPolicy({ ...item.sent_policy });
        ctx.env?.toast?.(`Policy set to the one turn ${item.n} was sent under. Re-deciding without a model call.`);
      } },
    { id: "draft_next_sample", kind: "command", title: "Put the next sample turn in the message box to edit", group: "Counter",
      when: (ctx) => typeof ctx.data?.chat?.next === "string" && !ctx.data.running && !ctx.data.chat.stopped,
      run: (ctx) => {
        const next = ctx.data?.chat?.next;
        if (typeof next !== "string") throw new Error("Every sample turn has been sent.");
        ctx.actions.draftMessage(next);
        ctx.env?.toast?.("Edit the message, then press Send customer turn. Nothing was sent.");
      } },
  ],
});
