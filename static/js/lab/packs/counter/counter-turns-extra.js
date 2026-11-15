// More facts, checks, metrics, exports and commands for the Counter page's chat turns ("counter.turns", contract:
// static/js/lab/surfaces/counter.js): message length and punctuation, measured input tokens, the move in frustration
// since the previous turn, local wording rules, whether the policy moved since a reply was sent, the template sent,
// a frustration band, the bot's reply and the current reason. Everything reads the turns of the user's own chat in
// this page load; nothing calls the model, re-decides or sends a message. Wording rules are plain local code, never
// Jev's answer or the page's decision.
import { definePack } from "../../kit.js";
import { codePoints } from "../../lib/text.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const customerOf = (item) => (typeof item?.customer === "string" ? item.customer : "");
const turnOrder = (items) => items.filter((item) => Number.isInteger(item?.n)).sort((a, b) => a.n - b.n);
const newest = (ctx) => turnOrder(ctx.items()).at(-1) || null;
const NEAR_LIMIT = 1800;
// Local wording rule: the customer names a person to talk to. Advisory; the page's decision reads asks_for_person.
const PERSON_WORDS = /\b(?:person|human|agent|someone|somebody|manager|representative|real people)\b/i;

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const chatMedianLatency = (ctx) => median(ctx.items().map((item) => finite(item?.meta?.latency_ms)).filter((value) => value !== null));

// The turn just before this one in the chat, or null.
const previousTurn = (item, ctx) => turnOrder(ctx.items()).filter((other) => other.n < item.n).pop() || null;

// Whether the policy the shown decisions use differs, in any setting, from the one this turn's reply was sent under.
function policyMoved(item, ctx) {
  const sent = item?.sent_policy, now = ctx?.data?.decided_with;
  if (!sent || !now) return false;
  const keys = new Set([...Object.keys(sent), ...Object.keys(now)]);
  return [...keys].some((key) => sent[key] !== now[key]);
}

// Fixed bands of the 0 to 4 frustration score, for grouping only (the policy's cut is a slider).
function band(score) {
  if (score === null) return null;
  return score < 1 ? "calm" : score < 2 ? "mild" : score < 3 ? "frustrated" : "angry";
}

const shownWith = (ctx, read) => ctx.shown().map(read).filter((value) => value !== null);
const mean = (values) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);
const oneLine = (text) => String(text ?? "").replace(/[\r\n]+/g, " ");

export default definePack({
  id: "counter-turns-extra",
  surface: "counter.turns",
  title: "More chat turn facts",
  about: "Message length, question marks, measured input tokens, the move in frustration since the previous turn, exclamation, capitals and person-asking wording (local rules), whether the policy moved since the reply went out, the template sent, a frustration band, the bot's reply and the current reason; checks for messages near the 2,000-character limit, the same template on consecutive turns and slow turns; mean frustration, reply share and mean top-intent probability; customer-message and JSON Lines exports; and commands to copy the newest bot reply, explain the newest decision and inspect the first turn.",
  features: [
    { id: "message_chars", kind: "fact", type: "number", label: "customer message length in characters", unit: "characters",
      value: (item) => codePoints(customerOf(item)) || null },
    { id: "question_marks", kind: "fact", type: "number", label: "question marks in the customer message",
      value: (item) => (customerOf(item) ? (customerOf(item).match(/\?/g) || []).length : null) },
    { id: "input_tokens", kind: "fact", type: "number", label: "measured input tokens", unit: "tokens", help: "Grows with the conversation: each call reads every turn so far.",
      value: (item) => finite(item?.meta?.input_tokens) },
    { id: "frustration_change", kind: "fact", type: "number", label: "change in frustration since the previous turn", unit: "−4 to 4",
      value: (item, ctx) => {
        const now = finite(item?.evidence?.frustration);
        const before = now === null ? null : finite(previousTurn(item, ctx)?.evidence?.frustration);
        return before === null ? null : now - before;
      } },
    { id: "exclaims", kind: "fact", type: "flag", label: "exclamation mark in the message", value: (item) => customerOf(item).includes("!") },
    { id: "capitals", kind: "fact", type: "flag", label: "a word in capitals (local wording rule)", help: "A word of three or more letters written all in capitals.",
      value: (item) => /\b\p{Lu}{3,}\b/u.test(customerOf(item)) },
    { id: "names_person", kind: "fact", type: "flag", label: "words asking for a person (local wording rule)",
      help: "person, human, agent, someone, manager or representative in the message. The page's decision reads Jev's asks_for_person instead.",
      value: (item) => PERSON_WORDS.test(customerOf(item)) },
    { id: "policy_moved", kind: "fact", type: "flag", label: "policy changed since this reply was sent",
      help: "A setting of the policy the shown decisions use differs from the one in force when this turn's call was made.",
      value: policyMoved },
    { id: "template_sent", kind: "fact", type: "category", label: "reply template sent", help: "The template the reply went out with: an intent, clarify, close or handoff.",
      value: (item) => item?.sent?.reply || null },
    { id: "frustration_band", kind: "fact", type: "category", label: "frustration band", help: "calm (under 1), mild (1 to 2), frustrated (2 to 3), angry (3 or more) on the 0 to 4 score.",
      value: (item) => band(finite(item?.evidence?.frustration)) },
    { id: "bot_reply", kind: "fact", type: "text", label: "bot reply", value: (item) => item?.bot ?? "" },
    { id: "reason_now", kind: "fact", type: "text", label: "reason under the current policy", value: (item) => item?.decision?.reason ?? "" },

    { id: "near_limit", kind: "diagnostic", severity: "advice", label: `Message over ${NEAR_LIMIT.toLocaleString("en-US")} characters`,
      check: (item, ctx) => {
        const length = codePoints(customerOf(item));
        const max = finite(ctx?.data?.chat?.max_chars) ?? 2000;
        return length > NEAR_LIMIT ? `${length.toLocaleString("en-US")} of the ${max.toLocaleString("en-US")} characters a turn may hold.` : null;
      } },
    { id: "same_template_run", kind: "diagnostic", severity: "advice", scope: "list", label: "The same template on consecutive turns",
      help: "A customer who gets the same fixed reply twice in a row may feel unheard.",
      check: (items) => {
        const ordered = turnOrder(items);
        const found = [];
        for (let index = 1; index < ordered.length; index++) {
          const before = ordered[index - 1], now = ordered[index];
          if (now.n === before.n + 1 && now.sent?.reply && now.sent.reply === before.sent?.reply) found.push(`Turns ${before.n} and ${now.n} both got the ${now.sent.reply.replace(/_/g, " ")} template.`);
        }
        return found;
      } },
    { id: "slow_turn", kind: "diagnostic", severity: "info", label: "Slow turn",
      help: "Measured latency more than twice the median of this chat's turns.",
      check: (item, ctx) => {
        const latency = finite(item?.meta?.latency_ms), middle = chatMedianLatency(ctx);
        return latency !== null && middle && latency > 2 * middle ? `Took ${Math.round(latency)} ms, more than twice this chat's median of ${Math.round(middle)} ms.` : null;
      } },

    { id: "mean_frustration", kind: "metric", format: "number", label: "Mean frustration score of the shown turns", help: "On the 0 to 4 scale.",
      compute: (ctx) => mean(shownWith(ctx, (item) => finite(item.evidence?.frustration))) },
    { id: "reply_share", kind: "metric", format: "percent", label: "Shown turns answered with an intent template under the current policy",
      compute: (ctx) => {
        const decided = ctx.shown().filter((item) => item.decision?.action);
        if (!decided.length) return null;
        const replies = decided.filter((item) => item.decision.action === "reply").length;
        return { value: replies / decided.length, detail: `${replies} of ${decided.length}` };
      } },
    { id: "mean_intent_p", kind: "metric", format: "percent", label: "Mean top-intent probability of the shown turns",
      compute: (ctx) => mean(shownWith(ctx, (item) => finite(item.evidence?.intent_prob))) },

    { id: "customer_text", kind: "exporter", label: "Customer messages of the shown turns (text; holds your customer messages)",
      help: "one line per shown turn: its number and the customer's message; no replies, answers or measurements",
      filename: "counter-customer-messages.txt",
      build: (ctx) => ctx.shown().map((item) => `Turn ${item.n}: ${oneLine(item.customer)}`).join("\n") + "\n" },
    { id: "turns_jsonl", kind: "exporter", label: "Shown turns as JSON Lines (holds messages, decisions and Jev's answers)",
      help: "per turn: number, customer message, bot reply, decision sent and now, and the evidence decide() reads; no measurements",
      filename: "counter-turns.jsonl", mime: "application/x-ndjson",
      build: (ctx) => ctx.shown().map((item) => JSON.stringify({ n: item.n, customer: item.customer, bot: item.bot, sent: item.sent,
        now: item.decision ? { action: item.decision.action, reply: item.decision.reply, reason: item.decision.reason } : null, evidence: item.evidence })).join("\n") + "\n" },

    { id: "copy_newest_bot", kind: "command", group: "Counter", title: "Copy the newest bot reply",
      when: (ctx) => !!newest(ctx)?.bot,
      run: (ctx) => {
        const item = newest(ctx);
        if (!item?.bot) throw new Error("No bot reply yet.");
        ctx.env.copy(item.bot);
      } },
    { id: "explain_newest", kind: "command", group: "Counter", title: "Say how the newest turn was decided, now and when sent",
      when: (ctx) => newest(ctx) !== null,
      run: (ctx) => {
        const item = newest(ctx);
        if (!item) throw new Error("No turn has been sent yet.");
        const now = item.decision?.action ? `${item.decision.action} now (${item.decision.reason || "no reason given"})` : "no decision now";
        const sent = item.sent?.action ? `sent as ${item.sent.action}` : "no recorded decision when sent";
        ctx.env.toast(`Turn ${item.n}: ${now}; ${sent}.${item.changed ? " The current policy decides it differently." : ""}`);
      } },
    { id: "inspect_first", kind: "command", group: "Counter", title: "Inspect the first turn's JSON",
      when: (ctx) => ctx.items().length > 0,
      run: (ctx) => {
        const first = turnOrder(ctx.items())[0];
        if (!first) throw new Error("No turn has been sent yet.");
        ctx.actions.inspectTurn(first.n);
      } },
  ],
});
