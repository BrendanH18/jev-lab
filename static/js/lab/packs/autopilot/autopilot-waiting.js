// Starter pack for "autopilot.inbox" (contract: static/js/lab/surfaces/autopilot.js): facts, plain-code checks,
// metrics, an export, a command and a tool over the emails still waiting. A waiting email has no outcome, so nothing
// here says what Jev or Shield would answer: the checks are keyword and domain heuristics and say so.
import { csvText, definePack } from "../../kit.js";
import { findUrls, levenshtein, similarity, wordCount } from "../../lib/text.js";

const str = (value) => (typeof value === "string" ? value : "");
const textOf = (item) => `${str(item.subject)}\n${str(item.body)}`;
// jev/dispatch.py AMOUNT_RE: "$1,980.00", "$ 12", "30 dollars", "45 USD".
const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?|\b(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(?:dollars|usd)\b/gi;
const HOME = "harborcoffee.example";

function amounts(text) {
  return [...str(text).matchAll(AMOUNT)].map((match) => Number(`${(match[1] || match[3] || "").replace(/,/g, "")}${match[2] || match[4] || ""}`))
    .filter((value) => Number.isFinite(value) && value > 0);
}

// A domain's name as jev/shield.py's _base reads it: the label before the last dot ("roastwell" for
// "billing.roastwell.example"), the whole text when there is no dot.
const baseName = (domain) => { const parts = str(domain).split("."); return parts.length >= 2 ? parts[parts.length - 2] : str(domain); };
const unhyphen = (text) => str(text).replace(/-/g, "");
// Shield's code rule: the sender's domain contains the expected domain's name, hyphens ignored.
const containsName = (sender, expected) => unhyphen(baseName(expected)) !== "" && unhyphen(sender).includes(unhyphen(baseName(expected)));

export default definePack({
  id: "autopilot-waiting",
  surface: "autopilot.inbox",
  title: "Waiting emails",
  about: "Filters, plain-code checks and counts for the emails still waiting: words, links, dollar amounts, order and invoice numbers, sender domains and the scenario labels. Nothing here predicts what Jev will answer, and the export holds no email bodies.",
  features: [
    // ---------- facts ----------
    { id: "body_words", kind: "fact", type: "number", label: "body word count", value: (item) => (typeof item.body === "string" ? wordCount(item.body) : null) },
    { id: "link_count", kind: "fact", type: "number", label: "links in the email", value: (item) => (typeof item.body === "string" ? findUrls(textOf(item)).length : null) },
    { id: "largest_amount", kind: "fact", type: "number", label: "largest dollar amount mentioned",
      help: "The largest amount in the subject and body, found by the pattern Dispatch's code uses ($1,980.00, 30 dollars, 45 USD).",
      value: (item) => { const found = amounts(textOf(item)); return found.length ? Math.max(...found) : null; } },
    { id: "attachment", kind: "fact", type: "flag", label: "attached photo", value: (item) => Array.isArray(item.attachments) && item.attachments.length > 0 },
    { id: "scenario_attack", kind: "fact", type: "flag", label: "scenario attack label", value: (item) => item.label?.attack === true },
    { id: "order_ref", kind: "fact", type: "flag", label: "order number mentioned", value: (item) => /\b[A-Z]-\d{4}\b/.test(textOf(item)) },
    { id: "invoice_ref", kind: "fact", type: "flag", label: "invoice number mentioned", value: (item) => /\b[A-Z]{2,3}-\d{4}\b/.test(textOf(item)) },
    { id: "next_up", kind: "fact", type: "flag", label: "next to process", value: (item) => item.next === true },
    { id: "sender_domain", kind: "fact", type: "category", label: "sender domain", value: (item) => str(item.sender_domain) || null },
    { id: "expected_verdict", kind: "fact", type: "category", label: "scenario shield label", value: (item) => item.label?.shield ?? null },
    { id: "subject", kind: "fact", type: "text", label: "subject", value: (item) => str(item.subject) },
    { id: "sender_name", kind: "fact", type: "text", label: "sender name", value: (item) => str(item.from_name) },

    // ---------- checks (plain-code heuristics) ----------
    { id: "bank_details", kind: "diagnostic", severity: "advice", label: "Bank details in the text",
      check: (item) => (/\b(?:routing|account|iban|sort code)\b[^.\n]{0,20}?\d{6,}/i.test(textOf(item)) ? "Mentions a routing or account number (plain-code heuristic, not a verdict)." : null) },
    { id: "lookalike_domain", kind: "diagnostic", severity: "advice", label: "Sender domain resembles Harbor Coffee's",
      check: (item) => {
        const domain = str(item.sender_domain);
        return domain && domain !== HOME && !domain.endsWith(`.${HOME}`) && containsName(domain, HOME) ? `${domain} looks like ${HOME} but is not it (plain-code heuristic, not a verdict).` : null;
      } },
    { id: "credential_words", kind: "diagnostic", severity: "advice", label: "Asks about logins or codes",
      check: (item) => (/\b(?:password|log ?in|login|verification code|the code we text)\b/i.test(textOf(item)) ? "Talks about passwords, logins or codes (plain-code heuristic, not a verdict)." : null) },
    { id: "same_sender", kind: "diagnostic", severity: "info", scope: "list", label: "Several waiting emails from one domain",
      check: (items) => {
        const counts = new Map();
        for (const item of items) if (str(item.sender_domain)) counts.set(item.sender_domain, (counts.get(item.sender_domain) || 0) + 1);
        return [...counts].filter(([, count]) => count > 1).map(([domain, count]) => `${count} shown emails come from ${domain}.`);
      } },

    // ---------- metrics ----------
    { id: "waiting_count", kind: "metric", format: "integer", label: "emails waiting", help: "Run would make one live call for each.",
      compute: (ctx) => (ctx.data.total ? ctx.data.waiting : null) },
    { id: "attacks_waiting", kind: "metric", format: "integer", label: "scenario attacks waiting", help: "Per the scenario labels, which are never sent to Jev.",
      compute: (ctx) => (ctx.data.total ? ctx.items().filter((item) => item.label?.attack === true).length : null) },
    { id: "photos_waiting", kind: "metric", format: "integer", label: "waiting emails with photos",
      compute: (ctx) => (ctx.data.total ? ctx.items().filter((item) => Array.isArray(item.attachments) && item.attachments.length > 0).length : null) },

    // ---------- export, command, tool ----------
    { id: "waiting_csv", kind: "exporter", label: "Shown waiting emails as CSV", filename: "autopilot-waiting.csv", mime: "text/csv",
      help: "positions, senders, subjects, photo names and the scenario labels; no email bodies and no outcomes",
      build: (ctx) => csvText([["position", "sender", "address", "subject", "photo", "scenario attack", "scenario shield label"],
        ...ctx.shown().map((item) => [item.position, item.from_name, item.from_email, item.subject, (item.attachments || []).map((entry) => entry.name).join(" "),
          item.label ? (item.label.attack ? "yes" : "no") : "", item.label?.shield ?? ""])]) },
    { id: "copy_senders", kind: "command", title: "Copy the shown waiting senders", group: "Autopilot",
      when: (ctx) => ctx.shown().some((item) => str(item.from_email)),
      run: (ctx) => {
        const senders = [...new Set(ctx.shown().map((item) => str(item.from_email)).filter(Boolean))];
        ctx.env.copy(senders.join("\n"));
        ctx.env.toast(`Copied ${senders.length} sender address${senders.length === 1 ? "" : "es"}.`);
      } },
    { id: "domain_distance", kind: "tool", group: "Plain-code checks", title: "Compare two sender domains",
      help: "Edit distance and similarity of two domains, and whether a plain-code rule would call the sender a lookalike of the expected domain. No model call.",
      inputs: [{ name: "a", label: "Expected domain", type: "text", required: true, default: HOME }, { name: "b", label: "Sender domain", type: "text", required: true }],
      compute: ({ a, b }) => {
        const left = a.trim().toLowerCase(), right = b.trim().toLowerCase();
        const distance = levenshtein(left, right);
        const lookalike = left !== right && (distance <= 2 || containsName(right, left));
        return { rows: [["Edit distance", distance], ["Similarity", Number(similarity(left, right).toFixed(3))], ["Same domain", left === right ? "yes" : "no"],
          ["Lookalike (plain-code rule)", lookalike ? "yes" : "no"]], note: "A lookalike is within two edits of the expected domain, or contains its name (the label before the last dot, hyphens ignored) as Shield's domain check does." };
      } },
  ],
});
