// Starter pack for the Overview app cards ("index.apps", contract: static/js/lab/surfaces/index.js).
// Everything here is the page's own public copy: no inputs, answers, measurements or usage.
import { csvText, definePack } from "../../kit.js";

const words = (text) => String(text || "").split(/\s+/).filter(Boolean).length;
const points = (item) => (Array.isArray(item?.points) ? item.points : []);
const cardText = (item) => [item.title, item.summary, ...points(item)].filter((part) => typeof part === "string" && part.trim()).join(" ");
// The question types of the Jev API, as the copy names them (capitalized, singular or plural).
const TYPES = ["Noul", "Score", "Choice", "Box"];
const label = (item) => item.name || item.title || item.id;

export default definePack({
  id: "index-apps-explorer",
  surface: "index.apps",
  title: "App card explorer",
  about: "Filter, sort, check and copy the Overview's app cards by what their own copy says. "
    + "Exports and counts hold page copy only, never usage or measured results.",
  features: [
    { id: "bullets", kind: "fact", type: "number", label: "bullet count", unit: "bullets", value: (item) => points(item).length },
    { id: "summary_words", kind: "fact", type: "number", label: "summary word count", unit: "words",
      value: (item) => words(item.summary) || null },
    { id: "app_number", kind: "fact", type: "number", label: "app number", help: "The number printed above the title.",
      value: (item) => (Number.isInteger(item.number) ? item.number : null) },
    { id: "type_mentions", kind: "fact", type: "number", label: "question types named", unit: "of 4",
      help: "How many of Noul, Score, Choice and Box the card's copy mentions.",
      value: (item) => {
        const text = cardText(item);
        return TYPES.filter((type) => new RegExp(`\\b${type}(?:e?s)?\\b`).test(text)).length;
      } },
    { id: "featured", kind: "fact", type: "flag", label: "featured style", value: (item) => item.featured === true },
    { id: "has_emoji", kind: "fact", type: "flag", label: "heading symbol", value: (item) => typeof item.emoji === "string" && item.emoji !== "" },
    { id: "tag", kind: "fact", type: "category", label: "card tag", value: (item) => (typeof item.tag === "string" && item.tag ? item.tag : "untagged") },
    { id: "card_text", kind: "fact", type: "text", label: "card text", help: "Title, summary and bullets together.", value: cardText },
    { id: "name", kind: "fact", type: "text", label: "app name", value: (item) => item.name || "" },

    { id: "duplicate_numbers", kind: "diagnostic", severity: "advice", scope: "list", label: "App number printed on more than one card",
      check: (items) => {
        const byNumber = new Map();
        for (const item of items) if (Number.isInteger(item.number)) byNumber.set(item.number, [...(byNumber.get(item.number) || []), label(item)]);
        return [...byNumber].filter(([, names]) => names.length > 1).map(([number, names]) => `App ${number} is printed on ${names.join(" and ")}.`);
      } },
    { id: "out_of_order", kind: "diagnostic", severity: "info", scope: "list", label: "App numbers out of order",
      check: (items) => {
        const numbered = items.filter((item) => Number.isInteger(item.number));
        const out = [];
        for (let index = 1; index < numbered.length; index++) {
          const before = numbered[index - 1], after = numbered[index];
          if (after.number < before.number) out.push(`${label(before)} (App ${before.number}) comes before ${label(after)} (App ${after.number}).`);
        }
        return out;
      } },
    { id: "no_bullets", kind: "diagnostic", severity: "info", label: "Card without bullet points",
      check: (item) => (points(item).length ? null : `${label(item)} has a summary but no bullet points.`) },

    { id: "bullets_total", kind: "metric", format: "integer", label: "Bullet points on the shown cards",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? shown.reduce((total, item) => total + points(item).length, 0) : null;
      } },
    { id: "mean_summary_words", kind: "metric", format: "number", label: "Mean summary length of the shown cards, in words",
      compute: (ctx) => {
        const counts = ctx.shown().map((item) => words(item.summary)).filter((count) => count > 0);
        return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : null;
      } },
    { id: "tagged_count", kind: "metric", format: "integer", label: "Shown cards with a tag",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? shown.filter((item) => typeof item.tag === "string" && item.tag).length : null;
      } },

    { id: "links_markdown", kind: "exporter", label: "Shown apps as a Markdown link list", help: "page copy only",
      filename: "jev-lab-apps.md", mime: "text/markdown",
      build: (ctx) => ctx.shown().map((item) => `- [${label(item)}](${item.href})${item.summary ? `: ${item.summary}` : ""}`).join("\n") + "\n" },
    { id: "cards_csv", kind: "exporter", label: "Shown cards as CSV", help: "page copy only",
      filename: "jev-lab-apps.csv", mime: "text/csv",
      build: (ctx) => csvText([["id", "number", "name", "tag", "href", "bullets", "summary"],
        ...ctx.shown().map((item) => [item.id, item.number ?? "", item.name, item.tag, item.href, points(item).length, item.summary])]) },
    { id: "notes_text", kind: "exporter", label: "Capability and design notes as text", help: "the page's feature and principle cards",
      filename: "jev-lab-notes.txt",
      build: (ctx) => {
        const section = (title, cards) => (Array.isArray(cards) && cards.length ? [title, ...cards.map((card) => `- ${card.title}: ${card.text}`), ""] : []);
        const lines = [...section("Capabilities", ctx.data?.features), ...section("Built the way TypeSafe recommends", ctx.data?.principles)];
        if (!lines.length) throw new Error("This page has no capability or design notes to copy.");
        return lines.join("\n");
      } },

    { id: "open_first", kind: "command", title: "Open the first shown app", group: "Apps",
      when: (ctx) => ctx.shown().length > 0, run: (ctx) => ctx.actions.open(ctx.shown()[0].id) },
    { id: "focus_first", kind: "command", title: "Go to the first shown app card", group: "Apps",
      when: (ctx) => ctx.shown().length > 0, run: (ctx) => ctx.actions.focus(ctx.shown()[0].id) },
    { id: "copy_links", kind: "command", title: "Copy links to the shown apps", group: "Apps",
      when: (ctx) => ctx.shown().length > 0, run: (ctx) => ctx.env.copy(ctx.shown().map((item) => `${label(item)}: ${item.href}`).join("\n")) },
  ],
});
