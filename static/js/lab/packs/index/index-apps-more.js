// More for the Overview app cards ("index.apps", contract: static/js/lab/surfaces/index.js): word and wording facts,
// copy checks, counts, an HTML link list and a navigation command. Everything here is the page's own public copy:
// no inputs, answers, measurements or usage.
import { definePack } from "../../kit.js";

const words = (text) => String(text || "").split(/\s+/).filter(Boolean).length;
const points = (item) => (Array.isArray(item?.points) ? item.points.filter((point) => typeof point === "string") : []);
const cardText = (item) => [item?.name, item?.summary, ...points(item)].filter((part) => typeof part === "string" && part.trim()).join(" ");
const label = (item) => item.name || item.title || item.id;
const names = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
// The question types of the Jev API as the copy names them (capitalized, singular or plural).
const TYPE = /\b(Noul|Score|Choice|Box)(?:e?s)?\b/;
const PICTURES = /\b(?:images?|photos?|pictures?)\b/i;
const ONE_CALL = /\b(?:one (?:merged )?call|single call)\b/i;
const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export default definePack({
  id: "index-apps-more",
  surface: "index.apps",
  title: "App cards: wording and navigation",
  about: "More filters, copy checks, counts and navigation for the Overview's app cards, read from the cards' own text. "
    + "Everything is public page copy: no usage, answers or measured results.",
  features: [
    { id: "total_words", kind: "fact", type: "number", label: "words on the card", unit: "words",
      help: "Name, summary and bullet points together.", value: (item) => words(cardText(item)) || null },
    { id: "longest_bullet", kind: "fact", type: "number", label: "longest bullet in words", unit: "words",
      value: (item) => { const list = points(item); return list.length ? Math.max(...list.map(words)) : null; } },
    { id: "mentions_pictures", kind: "fact", type: "flag", label: "mention of photos or images",
      value: (item) => PICTURES.test(cardText(item)) },
    { id: "mentions_one_call", kind: "fact", type: "flag", label: "mention of one call",
      help: "The copy says \"one call\", \"one merged call\" or \"single call\".", value: (item) => ONE_CALL.test(cardText(item)) },
    { id: "first_type", kind: "fact", type: "category", label: "first question type named",
      help: "The first of Noul, Score, Choice and Box the card's copy names.",
      value: (item) => cardText(item).match(TYPE)?.[1] || "none named" },

    { id: "cta_without_name", kind: "diagnostic", severity: "advice", label: "Link text that does not name its app",
      check: (item) => {
        if (!item.name) return null;
        if (!item.cta) return `${item.name} has no link text at the bottom of its card.`;
        return item.cta.toLowerCase().includes(item.name.toLowerCase()) ? null : `${item.name}'s link reads "${item.cta}", which does not name the app.`;
      } },
    { id: "label_without_number", kind: "diagnostic", severity: "info", label: "Card without an app number",
      check: (item) => (Number.isInteger(item.number) ? null : `${label(item)} has no app number above its title${item.label ? ` ("${item.label}")` : ""}.`) },
    { id: "repeated_link", kind: "diagnostic", severity: "advice", scope: "list", label: "Link used by more than one card",
      check: (items) => {
        const byHref = new Map();
        for (const item of items) if (item.href) byHref.set(item.href, [...(byHref.get(item.href) || []), item.id]);
        return [...byHref].filter(([, ids]) => ids.length > 1).map(([href, ids]) => `${href} is the link of ${ids.length} cards: ${names(ids)}.`);
      } },
    { id: "mixed_symbols", kind: "diagnostic", severity: "info", scope: "list", label: "Heading symbols on some cards only",
      check: (items) => {
        const without = items.filter((item) => !item.emoji);
        const others = items.length - without.length;
        if (!without.length || !others) return null;
        return `${names(without.map(label))} ${without.length === 1 ? "has" : "have"} no symbol before the title, while ${others} other card${others === 1 ? "" : "s"} ${others === 1 ? "has" : "have"} one.`;
      } },

    { id: "longest_summary", kind: "metric", format: "integer", label: "Longest summary of the shown cards, in words",
      compute: (ctx) => {
        let best = null;
        for (const item of ctx.shown()) {
          const count = words(item.summary);
          if (count && (!best || count > best.count)) best = { count, name: label(item) };
        }
        return best ? { value: best.count, detail: best.name } : null;
      } },

    { id: "links_html", kind: "exporter", label: "Shown apps as an HTML link list", help: "page copy only: names, links and summaries",
      filename: "jev-lab-apps.html", mime: "text/html",
      build: (ctx) => `<ul>\n${ctx.shown().map((item) => `  <li><a href="${escapeHtml(item.href)}">${escapeHtml(label(item))}</a>${item.summary ? `: ${escapeHtml(item.summary)}` : ""}</li>\n`).join("")}</ul>\n` },

    { id: "focus_featured", kind: "command", title: "Go to the featured app card", group: "Apps",
      when: (ctx) => ctx.shown().some((item) => item.featured === true),
      run: (ctx) => ctx.actions.focus(ctx.shown().find((item) => item.featured === true).id) },
  ],
});
