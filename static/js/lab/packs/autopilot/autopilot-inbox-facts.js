// Facts and plain-code checks for "autopilot.inbox" (contract: static/js/lab/surfaces/autopilot.js), read from the
// authored email alone, so they work before any call. Nothing here says what Jev or Shield will answer: the
// amount and time finders are JavaScript ports of jev/dispatch.py's AMOUNT_RE and TIME_RE, and every check is a
// keyword, link or reference heuristic that says so.
import { definePack } from "../../kit.js";
import { findUrls } from "../../lib/text.js";

const str = (value) => (typeof value === "string" ? value : "");
const hasText = (item) => typeof item?.subject === "string" || typeof item?.body === "string";
const textOf = (item) => `${str(item?.subject)}\n${str(item?.body)}`;
const attachmentsOf = (item) => (Array.isArray(item?.attachments) ? item.attachments.filter((entry) => entry && typeof entry === "object") : []);
const nameOf = (item) => `#${Number.isInteger(item?.position) ? item.position : "?"}${str(item?.from_name) ? ` ${item.from_name}` : ""}`;
const HEURISTIC = "(plain-code heuristic, not a verdict)";

// jev/dispatch.py AMOUNT_RE: "$1,980.00", "$ 12", "30 dollars", "45 USD". Distinct positive values, rounded to cents.
const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?|\b(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(?:dollars|usd)\b/gi;
function amounts(text) {
  const seen = new Set();
  for (const match of str(text).matchAll(AMOUNT)) {
    const value = Math.round(Number(`${(match[1] || match[3] || "").replace(/,/g, "")}${match[2] || match[4] || ""}`) * 100) / 100;
    if (Number.isFinite(value) && value > 0) seen.add(value);
  }
  return [...seen];
}

// jev/dispatch.py TIME_RE: "3pm", "9:30 am", "14:00", "noon". Distinct clock times as HH:MM.
const TIME = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midday)\b/gi;
function times(text) {
  const seen = new Set();
  for (const match of str(text).matchAll(TIME)) {
    let hour, minute;
    if (match[6]) [hour, minute] = [12, 0];
    else if (match[3]) {
      hour = Number(match[1]) % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
      minute = Number(match[2] || 0);
    } else [hour, minute] = [Number(match[4]), Number(match[5])];
    if (hour <= 23 && minute <= 59) seen.add(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return [...seen];
}

// A link's host, lowercased, without "www." or a port: "harbor-login-check.example".
const hostOf = (url) => str(url).replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].split(":")[0].toLowerCase().replace(/^www\./, "");
const linksOf = (item) => findUrls(textOf(item));
// Order and invoice references such as B-2051 or RW-4410.
const refsOf = (item) => [...new Set(textOf(item).match(/\b[A-Z]{1,3}-\d{4}\b/g) || [])];
const PHOTO_WORDS = /\b(?:photos?|pictures?|images?|pics?|attached|attachments?)\b/i;
const URGENCY = /\b(?:urgent|asap|immediately|right away|today|expires?|expiring|(?:in|within) \d+ (?:hours?|minutes?)|action required|final notice|last chance)\b/i;
const SECRECY = /\b(?:keep (?:this|it) (?:quiet|between us|confidential|secret)|don'?t tell|do not tell|skip (?:the )?approval|without (?:the )?approval|confidential)\b/i;
const AUTOMATION = /\b(?:assistant|automated|automation|bot|system notice|ignore (?:all |any )?(?:previous|prior|earlier) instructions)\b/i;

export default definePack({
  id: "autopilot-inbox-facts",
  surface: "autopilot.inbox",
  title: "Inbox facts from the email text",
  about: "Filters, sorts and plain-code checks for waiting emails, read from the authored email alone before any call: dollar amounts and clock times found by the same patterns Dispatch's code uses, long digit runs, links, references, urgency and secrecy wording. None of it predicts what Jev or Shield will answer.",
  features: [
    // ---------- facts ----------
    { id: "amount_count", kind: "fact", type: "number", label: "dollar amounts mentioned",
      help: "Distinct dollar amounts in the subject and body, found by the pattern Dispatch's code uses.", value: (item) => (hasText(item) ? amounts(textOf(item)).length : null) },
    { id: "long_digit_runs", kind: "fact", type: "number", label: "digit runs of 8 or more",
      help: "Strings of eight or more digits, such as routing or account numbers.", value: (item) => (hasText(item) ? (textOf(item).match(/\d{8,}/g) || []).length : null) },
    { id: "position", kind: "fact", type: "number", label: "inbox position", help: "Sorting by it ascending restores the scenario order.",
      value: (item) => (Number.isInteger(item?.position) ? item.position : null) },
    { id: "time_count", kind: "fact", type: "number", label: "clock times mentioned",
      help: "Distinct clock times such as 3pm, 14:00 or noon, found by the pattern Dispatch's code uses.", value: (item) => (hasText(item) ? times(textOf(item)).length : null) },
    { id: "plain_http_link", kind: "fact", type: "flag", label: "plain http link", value: (item) => linksOf(item).some((url) => /^http:\/\//i.test(url)) },
    { id: "urgency_words", kind: "fact", type: "flag", label: "urgency wording (keyword heuristic)", value: (item) => URGENCY.test(textOf(item)) },
    { id: "from_email", kind: "fact", type: "text", label: "sender address", value: (item) => str(item?.from_email) },
    { id: "scenario_note", kind: "fact", type: "text", label: "scenario expected outcome", help: "Scenario ground truth, never sent to Jev.", value: (item) => str(item?.label?.expect) },
    { id: "attachment_names", kind: "fact", type: "text", label: "attachment file names", value: (item) => attachmentsOf(item).map((entry) => str(entry.name)).filter(Boolean).join(", ") },
    { id: "link_domain", kind: "fact", type: "category", label: "first link domain", value: (item) => hostOf(linksOf(item)[0]) || null },

    // ---------- plain-code checks ----------
    { id: "link_domain_differs", kind: "diagnostic", severity: "advice", label: "Link points away from the sender's domain",
      check: (item) => {
        const sender = str(item.sender_domain);
        const away = [...new Set(linksOf(item).map(hostOf).filter((host) => host && host !== sender && !(sender && host.endsWith(`.${sender}`))))];
        return away.length ? `Links to ${away.join(", ")}, not the sender's domain ${sender || "(none)"} ${HEURISTIC}.` : null;
      } },
    { id: "photo_claimed_missing", kind: "diagnostic", severity: "advice", label: "Mentions a photo but has no attachment",
      check: (item) => (PHOTO_WORDS.test(textOf(item)) && !attachmentsOf(item).length ? `The text mentions a photo or attachment, but none came with the email ${HEURISTIC}.` : null) },
    { id: "attachment_unmentioned", kind: "diagnostic", severity: "info", label: "Attachment the text never mentions",
      check: (item) => (attachmentsOf(item).length && !PHOTO_WORDS.test(textOf(item))
        ? `${attachmentsOf(item).map((entry) => str(entry.name) || "an attachment").join(", ")} came with the email, but the text never mentions a photo ${HEURISTIC}.` : null) },
    { id: "addresses_automation", kind: "diagnostic", severity: "advice", label: "Text addresses an AI or automation",
      check: (item) => (/\bAI\b/.test(textOf(item)) || AUTOMATION.test(textOf(item))
        ? `The text speaks to an AI, assistant or automation ${HEURISTIC}; Shield's ai_instructions question is the real judgment.` : null) },
    { id: "secrecy_wording", kind: "diagnostic", severity: "advice", label: "Asks for secrecy or to skip approval",
      check: (item) => {
        const match = textOf(item).match(SECRECY);
        return match ? `Says "${match[0]}" ${HEURISTIC}.` : null;
      } },
    { id: "empty_fields", kind: "diagnostic", severity: "info", label: "Empty sender name, address, subject or body",
      check: (item) => {
        const empty = [["sender name", item.from_name], ["sender address", item.from_email], ["subject", item.subject], ["body", item.body]]
          .filter(([, value]) => str(value).trim() === "").map(([name]) => name);
        return empty.length ? `This email has no ${empty.join(", ")}.` : null;
      } },
    { id: "amount_without_reference", kind: "diagnostic", severity: "advice", label: "Dollar amount with no order or invoice number",
      check: (item) => {
        const found = amounts(textOf(item));
        return found.length && !refsOf(item).length
          ? `Mentions ${found.map((value) => `$${value.toFixed(2)}`).join(", ")} but no order or invoice number to check it against ${HEURISTIC}.` : null;
      } },
    { id: "shared_reference", kind: "diagnostic", severity: "info", scope: "list", label: "Shown emails mention the same reference",
      check: (items) => {
        const byRef = new Map();
        for (const item of items) for (const ref of refsOf(item)) byRef.set(ref, [...(byRef.get(ref) || []), nameOf(item)]);
        return [...byRef].filter(([, names]) => names.length > 1)
          .map(([ref, names]) => `${ref} appears in ${names.join(" and ")}: their outcomes can depend on which is processed first.`);
      } },
  ],
});
