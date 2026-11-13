// More facts, checks, exports and metrics for the example reviews above the Reviews form: text-shape measures,
// plain keyword flags, consistency checks of the hand-written expectations, and exports of the examples.
// Contract: static/js/lab/surfaces/reviews.js ("reviews.examples"). Keyword flags are literal word matches in local
// code, never Jev's judgment. An expectation is what a person would decide (jev/reviews.py), never an answer or the
// triage. Nothing here shows an answer, runs a check or changes an example.
import { definePack } from "../../kit.js";
import { sentences } from "../../lib/text.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const textOf = (item) => (typeof item?.text === "string" ? item.text : null);
const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const expectOf = (item) => (item && item.expect && typeof item.expect === "object" ? item.expect : null);
const flagsOf = (item) => (Array.isArray(expectOf(item)?.flags) ? expectOf(item).flags.filter((flag) => typeof flag === "string") : []);
// The flags as a set in a fixed order, so the same flags always read the same: known ones first, then any others A to Z.
const FLAG_ORDER = ["safety", "not_about_us", "rating_mismatch"];
const flagSet = (item) => [...new Set(flagsOf(item))].sort((a, b) => {
  const ai = FLAG_ORDER.indexOf(a), bi = FLAG_ORDER.indexOf(b);
  return (ai < 0 ? FLAG_ORDER.length : ai) - (bi < 0 ? FLAG_ORDER.length : bi) || (a < b ? -1 : a > b ? 1 : 0);
});
const share = (part, whole) => (whole ? { value: part / whole, detail: `${part} of ${whole}` } : null);

// A whole word or phrase from the list, case-insensitive; letters or digits may not touch either end, so "late" never
// matches inside "chocolate" and "café" works at the end of the text.
function keywords(list) {
  const body = list.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "iu");
}

// Plain keyword matches, chosen for the Harbor Coffee Co. examples. Each is advisory: a word, not a judgment.
const KEYWORDS = {
  refund: keywords(["refund", "refunds", "refunded", "charge", "charged", "charges", "overcharged", "billed", "money back"]),
  delivery: keywords(["deliver", "delivery", "delivered", "shipping", "shipped", "parcel", "parcels", "package", "packages", "courier", "deliveries", "arrive", "arrived", "arrival", "tracking"]),
  cafe: keywords(["café", "cafe", "cafés", "cafes", "barista", "baristas", "takeaway", "staff", "queue"]),
  equipment: keywords(["grinder", "grinders", "burr", "burrs", "kettle", "kettles", "brewer", "brewers", "machine", "machines", "french press", "carafe"]),
  injury: keywords(["blister", "blisters", "burn", "burned", "burns", "scald", "scalded", "hurt", "injury", "injured", "sick", "ill",
    "allergic", "hospital"]),
  stale: keywords(["stale", "papery", "cardboard", "expired", "best before", "roast date", "weeks ago", "months ago"]),
  date: keywords(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april",
    "june", "july", "august", "september", "october", "november", "december", "yesterday", "today", "tomorrow", "last week", "next week"]),
};
// Ordinal days ("the 2nd", "14th") count as dates too.
const ORDINAL = /(?<![\p{L}\p{N}])\d{1,2}(?:st|nd|rd|th)(?![\p{L}\p{N}])/iu;
const ADVERT = /\d+\s?%\s?off(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:while you wait|promo code|discount code|buy now|call now|limited offer|click here)(?![\p{L}\p{N}])/iu;
const keywordFlag = (pattern) => (item) => { const text = textOf(item); return text !== null && pattern.test(text); };

// Words: runs of letters and digits, joined by an inner apostrophe or hyphen ("wasn't", "berry-like").
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
// A web address: an optional scheme, then dotted labels ending in a top-level name of two or more letters.
const WEB = /(?:https?:\/\/)?(?<![\p{L}\p{N}.@-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?![\p{L}\p{N}])/giu;
const DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g;

function largestAmount(text) {
  let best = null;
  for (const match of text.matchAll(DOLLARS)) {
    const value = Number(`${match[1].replaceAll(",", "")}${match[2] ? `.${match[2]}` : ""}`);
    if (Number.isFinite(value) && (best === null || value > best)) best = value;
  }
  return best;
}

const sameWords = (a, b) => a.text.trim() === b.text.trim() && a.channel === b.channel && (a.about || "").trim() === (b.about || "").trim();
const inputs = (item) => ({ label: item.label, stars: item.stars, channel: item.channel, about: item.about, text: item.text });

function loadedExample(ctx) {
  const at = ctx.data.loaded;
  const item = at === null || at === undefined ? null : ctx.items().find((entry) => entry.index === at);
  if (!item) throw new Error("The form does not hold an example now: pick one first.");
  return item;
}

export default definePack({
  id: "reviews-example-more",
  surface: "reviews.examples",
  title: "More example review facts",
  about: "Text-shape measures, plain keyword flags and checks of the hand-written expectations over the built-in example reviews, with exports of the examples. Keyword flags are literal word matches, not Jev's judgment, and exports hold inputs and hand-written expectations only, never answers.",
  features: [
    { id: "exclamations", kind: "fact", type: "number", label: "exclamation marks", unit: "marks", value: (item) => { const text = textOf(item); return text === null ? null : (text.match(/!/g) || []).length; } },
    { id: "upper_share", kind: "fact", type: "number", label: "share of capital letters", unit: "share (0–1)", help: "Capital letters out of all letters in the words.",
      value: (item) => {
        const text = textOf(item);
        const letters = text === null ? 0 : (text.match(/\p{L}/gu) || []).length;
        return letters ? (text.match(/\p{Lu}/gu) || []).length / letters : null;
      } },
    { id: "avg_word_length", kind: "fact", type: "number", label: "average word length", unit: "characters",
      help: "Letters and digits per word; punctuation, including an apostrophe or hyphen inside a word, is left out.",
      value: (item) => {
        const found = (textOf(item) || "").match(WORD) || [];
        return found.length ? found.reduce((sum, word) => sum + (word.match(/[\p{L}\p{N}]/gu) || []).length, 0) / found.length : null;
      } },
    { id: "web_addresses", kind: "fact", type: "number", label: "web address count", unit: "addresses", help: "Addresses such as quickfix.example in the words.",
      value: (item) => { const text = textOf(item); return text === null ? null : (text.match(WEB) || []).length; } },
    { id: "largest_amount", kind: "fact", type: "number", label: "largest dollar amount", unit: "dollars", help: "The biggest $ amount written in the words; unavailable when there is none.",
      value: (item) => { const text = textOf(item); return text === null ? null : largestAmount(text); } },

    { id: "kw_refund", kind: "fact", type: "flag", label: "refund or charge keywords", help: "A plain keyword match (refund, charged, billed, …), not Jev's judgment.",
      value: keywordFlag(KEYWORDS.refund) },
    { id: "kw_delivery", kind: "fact", type: "flag", label: "delivery keywords", help: "A plain keyword match (delivery, shipping, parcel, arrived, …), not Jev's judgment.",
      value: keywordFlag(KEYWORDS.delivery) },
    { id: "kw_cafe", kind: "fact", type: "flag", label: "café visit keywords", help: "A plain keyword match (café, barista, takeaway, staff, …), not Jev's judgment.",
      value: keywordFlag(KEYWORDS.cafe) },
    { id: "kw_equipment", kind: "fact", type: "flag", label: "equipment keywords", help: "A plain keyword match (grinder, burrs, kettle, brewer, …), not Jev's judgment.",
      value: keywordFlag(KEYWORDS.equipment) },
    { id: "kw_injury", kind: "fact", type: "flag", label: "injury keywords", help: "A plain keyword match (blister, burned, hurt, sick, …), not Jev's judgment.",
      value: keywordFlag(KEYWORDS.injury) },
    { id: "kw_stale", kind: "fact", type: "flag", label: "staleness keywords", help: "A plain keyword match (stale, papery, months ago, …), not Jev's judgment.",
      value: keywordFlag(KEYWORDS.stale) },
    { id: "kw_advert", kind: "fact", type: "flag", label: "advert phrase keywords", help: "A plain phrase match (20% off, while you wait, promo code, …), not Jev's judgment.",
      value: keywordFlag(ADVERT) },
    { id: "kw_date", kind: "fact", type: "flag", label: "date keywords", help: "A plain keyword match: a weekday, a month, yesterday or last week, or a day such as 14th. Not Jev's judgment.",
      value: (item) => { const text = textOf(item); return text !== null && (KEYWORDS.date.test(text) || ORDINAL.test(text)); } },
    { id: "edge_space", kind: "fact", type: "flag", label: "leading or trailing spaces", help: "The server trims them before the check.",
      value: (item) => { const text = textOf(item); return text !== null && text.trim() !== "" && text !== text.trim(); } },

    { id: "expects_mismatch", kind: "fact", type: "flag", label: "an expected rating-mismatch flag", help: "Hand-written in jev/reviews.py, not the triage.",
      value: (item) => flagsOf(item).includes("rating_mismatch") },
    { id: "expected_flags", kind: "fact", type: "category", label: "expected flag set",
      help: "The hand-written flags in a fixed order (safety, not_about_us, rating_mismatch) joined with +, or none; unavailable without an expectation.",
      value: (item) => (expectOf(item) ? (flagSet(item).length ? flagSet(item).join(" + ") : "none") : null) },

    { id: "unknown_channel", kind: "diagnostic", severity: "advice", label: "Channel not in the setup",
      check: (item, ctx) => {
        const channels = ctx?.data?.channels || {};
        if (!Object.keys(channels).length || typeof channels[item.channel] === "string") return null;
        return item.channel ? `Channel "${item.channel}" is not one of the page's channels, so the server would refuse this example.` : "This example names no channel, so the server would refuse it.";
      } },
    { id: "unknown_team", kind: "diagnostic", severity: "advice", label: "Expected team not in the setup",
      check: (item, ctx) => {
        const teams = ctx?.data?.teams || {};
        const team = expectOf(item)?.team;
        return team && Object.keys(teams).length && typeof teams[team] !== "string" ? `The hand-written expectation names team "${team}", which the page does not list.` : null;
      } },
    { id: "thank_low_stars", kind: "diagnostic", severity: "info", label: "Thank-you expected for 3 stars or fewer",
      check: (item) => (expectOf(item)?.action === "thank" && number(item.stars) !== null && item.stars <= 3
        ? `A person expects the thank-you template for a ${item.stars}-star review.` : null) },
    { id: "mismatch_mid_stars", kind: "diagnostic", severity: "info", label: "Rating mismatch expected at 3 stars",
      check: (item) => (flagsOf(item).includes("rating_mismatch") && item.stars === 3
        ? "3 stars sit at level 2 of the tone's 0–4, so the words can be at most 2 levels away: the expected rating mismatch needs extreme words." : null) },
    { id: "escalate_safety_pair", kind: "diagnostic", severity: "advice", label: "Escalation and safety flag disagree",
      check: (item) => {
        const escalate = expectOf(item)?.action === "escalate", safety = flagsOf(item).includes("safety");
        if (escalate === safety) return null;
        return escalate ? "A person expects escalate but lists no safety flag." : "A person lists the safety flag but expects no escalation.";
      } },
    { id: "moderation_pair", kind: "diagnostic", severity: "advice", label: "Moderation action and team disagree",
      check: (item) => {
        const expect = expectOf(item);
        if (!expect) return null;
        const action = expect.action === "moderate", team = expect.team === "moderation";
        if (action === team) return null;
        return action ? `A person expects moderate but names team "${expect.team ?? "none"}".` : `A person names the moderation team but expects "${expect.action ?? "no action"}".`;
      } },
    { id: "duplicate_words", kind: "diagnostic", severity: "advice", scope: "list", label: "Shown examples with the same words",
      check: (items) => {
        const out = [];
        items.forEach((item, at) => {
          if (typeof item?.text !== "string") return;
          const twin = items.findIndex((other, index) => index < at && typeof other?.text === "string" && sameWords(other, item));
          if (twin >= 0) out.push(`${items[twin].label} and ${item.label} have the same words, channel and subject (only the stars may differ).`);
        });
        return out;
      } },

    { id: "shown_jsonl", kind: "exporter", label: "Shown examples as JSON lines", help: "inputs and hand-written expectations only; no answers or decisions",
      filename: "review-examples.jsonl", mime: "application/x-ndjson",
      build: (ctx) => ctx.shown().map((item) => JSON.stringify({ ...inputs(item), expect: expectOf(item) })).join("\n") + (ctx.shown().length ? "\n" : "") },
    { id: "shown_table", kind: "exporter", label: "Shown examples as a Markdown table", help: "label, stars, channel, subject, word count and the hand-written expected action; no review words or answers",
      filename: "review-examples-table.md", mime: "text/markdown",
      build: (ctx) => `${formatMarkdownTable(["Example", "Stars", "Channel", "Subject", "Words", "Expected action (hand-written)"],
        ctx.shown().map((item) => [item.label, item.stars ?? "", item.channel_label || item.channel, item.about, item.words, expectOf(item)?.action || ""]))}\n` },
    { id: "loaded_json", kind: "exporter", label: "Loaded example as JSON", help: "the example the form holds: its inputs only, no expectation and no answers",
      filename: "review-example.json", mime: "application/json",
      build: (ctx) => `${JSON.stringify(inputs(loadedExample(ctx)), null, 2)}\n` },
    { id: "by_action", kind: "exporter", label: "Shown examples grouped by expected action", help: "a Markdown list of labels under each hand-written expected action; no review words or answers",
      filename: "review-expectations.md", mime: "text/markdown",
      build: (ctx) => {
        const actions = ctx.data.actions || {};
        const groups = new Map();
        for (const item of ctx.shown()) {
          const key = expectOf(item)?.action || "";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item.label);
        }
        const order = [...Object.keys(actions).filter((key) => groups.has(key)), ...[...groups.keys()].filter((key) => key && !(key in actions)), ...(groups.has("") ? [""] : [])];
        const lines = ["# Expected actions (hand-written, not Jev's answers)", ""];
        for (const key of order) {
          lines.push(`## ${key ? (actions[key] || key) : "No expectation"}`, "", ...groups.get(key).map((label) => `- ${label}`), "");
        }
        return lines.join("\n");
      } },

    { id: "words_per_sentence", kind: "metric", label: "Words per sentence across the shown examples", format: "number",
      help: "All shown words divided by all shown sentences. A sentence ends at . ! or ? followed by a space or the end, so a web address such as quickfix.example does not split one.",
      compute: (ctx) => {
        const shown = ctx.shown().filter((item) => typeof item.text === "string");
        const words = shown.reduce((sum, item) => sum + (number(item.words) || 0), 0);
        const count = shown.reduce((sum, item) => sum + sentences(item.text).length, 0);
        return count ? { value: words / count, detail: `${words} words in ${count} sentences` } : null;
      } },
    { id: "keyword_share", kind: "metric", label: "Shown examples with any topic keyword", format: "percent",
      help: "Plain keyword matches (refund, delivery, café, equipment, injury, staleness, advert), not Jev's judgment.",
      compute: (ctx) => {
        const shown = ctx.shown();
        const patterns = [KEYWORDS.refund, KEYWORDS.delivery, KEYWORDS.cafe, KEYWORDS.equipment, KEYWORDS.injury, KEYWORDS.stale, ADVERT];
        return share(shown.filter((item) => typeof item.text === "string" && patterns.some((pattern) => pattern.test(item.text))).length, shown.length);
      } },
    { id: "team_coverage", kind: "metric", label: "Teams some shown example expects", format: "percent",
      help: "Distinct hand-written expected teams out of the page's teams.",
      compute: (ctx) => {
        const teams = Object.keys(ctx.data.teams || {});
        if (!teams.length || !ctx.shown().length) return null;
        const covered = new Set(ctx.shown().map((item) => expectOf(item)?.team).filter((team) => teams.includes(team)));
        return share(covered.size, teams.length);
      } },
    { id: "followup_share", kind: "metric", label: "Shown examples a person expects to follow up", format: "percent",
      help: "Hand-written expected action escalate, moderate or reply, out of the shown examples that have an expectation.",
      compute: (ctx) => {
        const expected = ctx.shown().filter((item) => expectOf(item)?.action);
        return share(expected.filter((item) => ["escalate", "moderate", "reply"].includes(item.expect.action)).length, expected.length);
      } },
  ],
});
