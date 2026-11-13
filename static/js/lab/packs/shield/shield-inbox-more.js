// More facts, checks and measurements for the Shield inbox ("shield.inbox", contract: static/js/lab/surfaces/shield.js).
// Two kinds of facts. Facts about the authored message (sender address, links, dollar amounts, money, sign-in and
// urgency words) are plain code on the text the page shows, available before any screen; the word facts are keyword
// matches, not judgments. Facts about a verdict (margin to the review threshold, hot signals, drivers, time pressure) read
// only the current user's own screens of this page session and are unavailable for an unscreened message. Scenario
// notes ("expected", "attack") are demo notes, never sent to Jev, and every feature that uses them says so.
import { definePack } from "../../kit.js";
import { median } from "../../lib/math.js";
import { findUrls, levenshtein } from "../../lib/text.js";

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const str = (value) => (typeof value === "string" ? value : "");
const textOf = (item) => `${str(item?.subject)}\n${str(item?.body)}`;
const screened = (items) => items.filter((item) => item?.status === "screened" && item.verdict);
const LEVELS = ["safe", "review", "quarantine"];

// Plain keyword and pattern matches on the message text. They spot words; they do not judge the message.
const URGENCY = ["urgent", "urgently", "immediately", "today", "tonight", "asap", "now", "action required", "expires", "expiring",
  "deadline", "right away", "final notice", "as soon as possible"];
const URGENCY_PATTERNS = URGENCY.map((word) => new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "i"));
const MONEY = /\b(?:invoice|invoices|payment|payments|pay|paid|bank|remittance|refund|wire|transfer|bonus)\b|\$\s?\d/i;
const CREDENTIAL = /\b(?:password|passwords|passcode|log ?in|sign ?in|verify|verification|one-time code|\d+-digit code)\b/i;
const REFERENCE = /\b[A-Z]{1,4}-\d{3,}\b/;
const DOLLARS = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/g;

// The dollar amounts written as "$4,250.00", "$500" or "$ 12.5", in order.
const dollarAmounts = (text) => [...str(text).matchAll(DOLLARS)].map((match) => Number(match[1].replace(/,/g, ""))).filter((value) => Number.isFinite(value));
const urgencyCount = (item) => URGENCY_PATTERNS.filter((pattern) => pattern.test(textOf(item))).length;
const answerValue = (item, id) => finite(item?.answers?.[id]?.value);
const policyValue = (ctx, key) => finite(ctx?.data?.policy?.[key]);
const ruleValue = (ctx, key, fallback) => finite(ctx?.data?.rules?.[key]) ?? fallback;

function margin(item, ctx, key) {
  const risk = finite(item?.verdict?.risk), cut = policyValue(ctx, key);
  return risk === null || cut === null ? null : risk - cut;
}

// The time-pressure answer's level word ("None", "Mild", "Strong") from its legend, for the score rounded to a level.
function pressureLevel(item) {
  const answer = item?.answers?.pressure;
  const value = finite(answer?.value);
  if (value === null || !answer.legend) return null;
  const top = finite(answer.scale) ?? Object.keys(answer.legend).length - 1;
  const level = Math.min(top, Math.max(0, Math.round(value)));
  const text = str(answer.legend[String(level)]);
  return text ? text.split(":")[0].trim() || `level ${level}` : `level ${level}`;
}

export default definePack({
  id: "shield-inbox-more",
  surface: "shield.inbox",
  title: "More inbox facts",
  about: "Plain-code facts about each message's sender, links, dollar amounts and money, sign-in and urgency words (keyword "
    + "matches, not judgments), facts about your own verdicts (review-threshold margin, hot signals, drivers), consistency checks "
    + "and inbox measurements. Nothing asks Jev; scenario notes are labeled as demo notes, never sent to Jev.",
  features: [
    // ---------- the authored message ----------
    { id: "link_count", kind: "fact", type: "number", label: "web addresses in the text", unit: "links",
      help: "Addresses that start with http://, https:// or www. in the subject and body (a plain pattern match).",
      value: (item) => findUrls(textOf(item)).length },
    { id: "largest_amount", kind: "fact", type: "number", label: "largest dollar amount mentioned", unit: "USD",
      help: "The largest amount written with a $ sign in the subject or body; none when no amount is written.",
      value: (item) => { const amounts = dollarAmounts(textOf(item)); return amounts.length ? Math.max(...amounts) : null; } },
    { id: "urgency_words", kind: "fact", type: "number", label: "urgency keywords", unit: "keywords",
      help: `How many of these words or phrases appear in the subject or body (a keyword match): ${URGENCY.join(", ")}.`,
      value: urgencyCount },
    { id: "domain_hyphens", kind: "fact", type: "number", label: "hyphens in the sender domain", unit: "hyphens",
      help: "Lookalike domains often join a real name and a word with a hyphen.",
      value: (item) => (str(item?.sender_domain) ? item.sender_domain.split("-").length - 1 : null) },
    { id: "money_words", kind: "fact", type: "flag", label: "a money keyword",
      help: "A plain keyword match: invoice, payment, pay, paid, bank, remittance, refund, wire, transfer, bonus or a $ amount.",
      value: (item) => MONEY.test(textOf(item)) },
    { id: "credential_words", kind: "fact", type: "flag", label: "a sign-in keyword",
      help: "A plain keyword match: password, passcode, login, sign in, verify, verification, one-time code or an n-digit code.",
      value: (item) => CREDENTIAL.test(textOf(item)) },
    { id: "reference_number", kind: "fact", type: "flag", label: "an order or invoice reference",
      help: "A pattern match for references like A-1041 or INV-7781 (capital letters, a hyphen, three or more digits).",
      value: (item) => REFERENCE.test(textOf(item)) },
    { id: "shared_domain", kind: "fact", type: "flag", label: "a sender domain shared with another message",
      help: "Another message in the inbox comes from the same domain.",
      value: (item, ctx) => {
        const domain = str(item?.sender_domain);
        return !!domain && ctx.items().some((other) => other !== item && other?.id !== item.id && other?.sender_domain === domain);
      } },
    { id: "address_untidy", kind: "fact", type: "flag", label: "an address with capitals or edge spaces",
      help: "The From address has capital letters or spaces at either end; code compares it trimmed and lowercased.",
      value: (item) => { const email = str(item?.from_email); return email !== email.trim() || /[A-Z]/.test(email); } },
    { id: "local_part", kind: "fact", type: "text", label: "address name before the @",
      help: "The part of the From address before its last @, trimmed; empty without an @.",
      value: (item) => { const email = str(item?.from_email).trim(); return email.includes("@") ? email.slice(0, email.lastIndexOf("@")) : ""; } },
    { id: "expected", kind: "fact", type: "category", label: "expected verdict (scenario note)",
      help: "What the scenario note expects from the text alone: a demo note, never sent to Jev.",
      value: (item) => (LEVELS.includes(item?.expected) ? item.expected : null) },

    // ---------- your own verdicts ----------
    { id: "review_margin", kind: "fact", type: "number", label: "risk minus the review threshold", unit: "−1 to 1",
      help: "Positive: the risk is that far above review_at on the sliders now; negative: below it.",
      value: (item, ctx) => margin(item, ctx, "review_at") },
    { id: "hot_signals", kind: "fact", type: "number", label: "hot signals", unit: "signals",
      help: "Signals whose contribution is at least 0.15; the verdict names at most three of them as drivers.",
      value: (item, ctx) => {
        if (!item?.verdict || !Array.isArray(item.verdict.signals)) return null;
        const hot = ruleValue(ctx, "hot", 0.15);
        return item.verdict.signals.filter((signal) => finite(signal?.contribution) !== null && signal.contribution >= hot).length;
      } },
    { id: "domain_distance", kind: "fact", type: "number", label: "edits from the claimed sender's domain", unit: "characters",
      help: "Character edits between the sender domain and the domain of the sender the message claims to be (a code check). "
        + "Unavailable when the claimed sender has no known domain.",
      value: (item) => {
        const actual = str(item?.fact?.sender_domain), expected = str(item?.fact?.expected_domain);
        return actual && expected ? levenshtein(actual, expected) : null;
      } },
    { id: "drivers", kind: "fact", type: "text", label: "driver signals",
      help: "The verdict's drivers, strongest first, by their slider names.",
      value: (item, ctx) => (Array.isArray(item?.verdict?.drivers) ? item.verdict.drivers : []).map((id) => ctx?.data?.signal_names?.[id] || id).join(", ") },
    { id: "pressure_level", kind: "fact", type: "category", label: "time pressure level",
      help: "The time-pressure Score rounded to its nearest level, named as its legend names it.",
      value: pressureLevel },

    // ---------- checks ----------
    { id: "link_not_lure", kind: "diagnostic", severity: "advice", label: "Link in the text, low link-lure answer",
      check: (item) => {
        const links = findUrls(textOf(item)).length, p = answerValue(item, "link_lure");
        if (!links || p === null || p >= 0.2) return null;
        return `The text holds ${plural(links, "web address")} (a plain match), but P(link lure) is ${percent(p)}: check where it leads before trusting the verdict.`;
      } },
    { id: "amount_not_payment", kind: "diagnostic", severity: "advice", label: "Dollar amount, low payment-redirect answer",
      check: (item) => {
        const amounts = dollarAmounts(textOf(item)), p = answerValue(item, "payment_change");
        if (!amounts.length || p === null || p >= 0.2) return null;
        return `The text mentions ${plural(amounts.length, "dollar amount")} (largest $${Math.max(...amounts)}, a plain match), but P(payment redirect) is ${percent(p)}.`;
      } },
    { id: "harm_lifted", kind: "diagnostic", severity: "info", label: "Quarantined by the loss score alone",
      check: (item, ctx) => {
        const verdict = item?.verdict;
        const risk = finite(verdict?.risk), harm = finite(verdict?.harm), cut = policyValue(ctx, "quarantine_at");
        const lift = ruleValue(ctx, "harm_quarantine", 2.5);
        if (verdict?.level !== "quarantine" || risk === null || harm === null || cut === null) return null;
        if (risk >= cut || harm < lift || (Array.isArray(verdict.rules) ? verdict.rules : []).some((rule) => rule?.action === "quarantine")) return null;
        return `Quarantined because loss if obeyed is ${harm}, at least ${lift}: the risk ${percent(risk)} is under the quarantine threshold ${percent(cut)} and no hard rule quarantined it.`;
      } },
    { id: "vendor_redirect", kind: "diagnostic", severity: "advice", label: "Matching sender asks to redirect a payment",
      check: (item, ctx) => {
        const fact = item?.fact, p = answerValue(item, "payment_change"), cut = ruleValue(ctx, "risky_ask", 0.5);
        if (fact?.domain_matches !== true || p === null || p < cut) return null;
        return `${fact.claimed_label || "The claimed sender"} writes from its own domain (${fact.sender_domain}), yet P(payment redirect) is ${percent(p)}: a matching domain does not prove the request is genuine.`;
      } },
    { id: "attack_passed", kind: "diagnostic", severity: "info", label: "Scenario attack that reads safe",
      check: (item) => (item?.attack === true && item.verdict?.level === "safe"
        ? "The scenario note marks acting on this message as harmful (a demo note, never sent to Jev), yet its text alone reads safe: the risk lies in who is asking, which the text cannot show." : null) },
    { id: "domain_split", kind: "diagnostic", severity: "advice", scope: "list", label: "Mixed verdicts from one sender domain",
      check: (items) => {
        const groups = new Map();
        for (const item of screened(items)) {
          const domain = str(item.sender_domain);
          if (!domain || !LEVELS.includes(item.verdict.level)) continue;
          if (!groups.has(domain)) groups.set(domain, {});
          const counts = groups.get(domain);
          counts[item.verdict.level] = (counts[item.verdict.level] || 0) + 1;
        }
        return [...groups].filter(([, counts]) => Object.keys(counts).length > 1)
          .map(([domain, counts]) => `${domain} has mixed verdicts: ${LEVELS.filter((level) => counts[level]).map((level) => `${counts[level]} ${level}`).join(", ")}.`);
      } },

    // ---------- measurements ----------
    { id: "median_risk", kind: "metric", format: "percent", label: "Median risk of the shown screens",
      compute: (ctx) => {
        const risks = screened(ctx.shown()).map((item) => finite(item.verdict.risk)).filter((value) => value !== null);
        return risks.length ? { value: median(risks), detail: `of ${plural(risks.length, "screened message")}` } : null;
      } },
    { id: "tokens_per_call", kind: "metric", format: "number", label: "Measured tokens per call",
      help: "Input plus output tokens per shown screen, averaged over the calls that report both.",
      compute: (ctx) => {
        const totals = ctx.shown().map((item) => [finite(item?.meta?.input_tokens), finite(item?.meta?.output_tokens)])
          .filter(([input, output]) => input !== null && output !== null).map(([input, output]) => input + output);
        return totals.length ? { value: totals.reduce((a, b) => a + b, 0) / totals.length, detail: `over ${plural(totals.length, "measured call")}` } : null;
      } },
    { id: "cost_per_thousand", kind: "metric", format: "usd", label: "Cost per 1,000 messages (projection)",
      help: "1,000 × the mean measured cost of the shown screens. Arithmetic on measured calls, not spend.",
      compute: (ctx) => {
        const costs = ctx.shown().map((item) => finite(item?.meta?.cost_usd)).filter((value) => value !== null);
        return costs.length ? { value: (1000 * costs.reduce((a, b) => a + b, 0)) / costs.length, detail: `projected from ${plural(costs.length, "measured call")}` } : null;
      } },
    { id: "batch_speedup", kind: "metric", format: "number", label: "Batch speed-up from parallel screening",
      help: "The latest Scan whole inbox: the sum of its calls' measured latencies divided by its measured wall time.",
      compute: (ctx) => {
        const batch = ctx.data?.batch;
        const total = finite(batch?.sum_latency_ms), wall = finite(batch?.wall_ms);
        return total === null || wall === null || wall <= 0 || total <= 0 ? null
          : { value: total / wall, detail: `${Math.round(total)} ms of calls in ${Math.round(wall)} ms` };
      } },
    { id: "attack_catch", kind: "metric", format: "percent", label: "Scenario attacks held for review or quarantine",
      help: "Of the shown screened messages whose scenario note marks them harmful (demo notes, never sent to Jev), the share not marked safe.",
      compute: (ctx) => {
        const attacks = screened(ctx.shown()).filter((item) => item.attack === true && LEVELS.includes(item.verdict.level));
        if (!attacks.length) return null;
        const held = attacks.filter((item) => item.verdict.level !== "safe").length;
        return { value: held / attacks.length, detail: `${held} of ${plural(attacks.length, "scenario attack")}` };
      } },
  ],
});
