// Facts, checks, metrics, exports and commands for the example reviews above the Reviews form.
// Contract: static/js/lab/surfaces/reviews.js ("reviews.examples"). Items are inputs plus hand-written expectations;
// nothing here shows an answer, and an expectation is always labeled as what a person would decide.
import { csvText, definePack } from "../../kit.js";

const text = (item) => (typeof item?.text === "string" ? item.text : "");
const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const labelOf = (map, key) => (typeof key === "string" && key ? (map && typeof map[key] === "string" ? map[key] : key) : null);

// Sentences: runs of text ending in ., ! or ? (or the end), counting only runs that hold a letter or digit.
function sentences(value) {
  return value.split(/[.!?]+/).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

const mean = (values) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);

function step(ctx, direction) {
  const shown = ctx.shown();
  if (!shown.length) throw new Error("No example is shown.");
  const at = shown.findIndex((item) => item.index === ctx.data.loaded);
  const next = at < 0 ? (direction > 0 ? 0 : shown.length - 1) : (at + direction + shown.length) % shown.length;
  return ctx.actions.use(shown[next].index);
}

export default definePack({
  id: "review-example-facts",
  surface: "reviews.examples",
  title: "Example review facts",
  about: "Filters, sorts, checks and exports over the built-in example reviews, plus keys to step through them. Exports hold the examples' inputs and hand-written expectations only, never answers.",
  features: [
    { id: "stars", kind: "fact", type: "number", label: "star rating", unit: "stars", help: "The stars never reach Jev.", value: (item) => number(item.stars) },
    { id: "chars", kind: "fact", type: "number", label: "length in characters", unit: "characters", value: (item) => number(item.chars) },
    { id: "words", kind: "fact", type: "number", label: "word count", unit: "words", value: (item) => number(item.words) },
    { id: "sentences", kind: "fact", type: "number", label: "sentence count", unit: "sentences", value: (item) => (typeof item.text === "string" ? sentences(item.text) : null) },
    { id: "triaged", kind: "fact", type: "number", label: "checks this session", unit: "checks", help: "Your own checks of these words since the page loaded.",
      value: (item) => number(item.triaged) },
    { id: "channel", kind: "fact", type: "category", label: "channel", value: (item) => item.channel_label || item.channel || null },
    { id: "expected_action", kind: "fact", type: "category", label: "expected action", help: "Hand-written in jev/reviews.py: what a person would decide, not Jev's answer.",
      value: (item, ctx) => labelOf(ctx?.data?.actions, item.expect?.action) },
    { id: "expected_team", kind: "fact", type: "category", label: "expected team", help: "Hand-written in jev/reviews.py, not the triage.",
      value: (item, ctx) => labelOf(ctx?.data?.teams, item.expect?.team) },
    { id: "text", kind: "fact", type: "text", label: "review text", value: (item) => text(item) },
    { id: "about", kind: "fact", type: "text", label: "subject", value: (item) => (typeof item.about === "string" ? item.about : "") },
    { id: "has_subject", kind: "fact", type: "flag", label: "a named subject", value: (item) => typeof item.about === "string" && item.about.trim() !== "" },
    { id: "loaded", kind: "fact", type: "flag", label: "loaded in the form", value: (item) => item.loaded === true },
    { id: "expected_flag", kind: "fact", type: "flag", label: "an expected flag", help: "A hand-written expectation lists a safety, moderation or rating flag.",
      value: (item) => Array.isArray(item.expect?.flags) && item.expect.flags.length > 0 },
    { id: "money", kind: "fact", type: "flag", label: "a money amount", value: (item) => /[$€£]\s?\d|\b\d+(?:\.\d+)?\s?(?:dollars|USD)\b/i.test(text(item)) },
    { id: "question", kind: "fact", type: "flag", label: "a question mark", value: (item) => text(item).includes("?") },

    { id: "no_expectation", kind: "diagnostic", severity: "info", label: "No hand-written expectation",
      check: (item) => (item.expect ? null : "This example has no expected decision, so a check of it cannot be compared with one.") },
    { id: "uncovered_actions", kind: "diagnostic", severity: "info", scope: "list", label: "Expected actions with no shown example",
      check: (items, ctx) => {
        const actions = ctx?.data?.actions || {};
        const covered = new Set(items.map((item) => item.expect?.action).filter(Boolean));
        const missing = Object.keys(actions).filter((key) => !covered.has(key));
        return missing.length ? `No shown example expects: ${missing.map((key) => actions[key]).join("; ")}.` : null;
      } },

    { id: "mean_stars", kind: "metric", label: "Mean stars of the shown examples", format: "number",
      compute: (ctx) => mean(ctx.shown().map((item) => number(item.stars)).filter((value) => value !== null)) },
    { id: "mean_words", kind: "metric", label: "Mean word count of the shown examples", format: "number",
      compute: (ctx) => mean(ctx.shown().map((item) => number(item.words)).filter((value) => value !== null)) },
    { id: "checked_share", kind: "metric", label: "Shown examples you checked this session", format: "percent",
      help: "Counts your own checks since the page loaded.",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? { value: shown.filter((item) => item.triaged > 0).length / shown.length, detail: `${shown.filter((item) => item.triaged > 0).length} of ${shown.length}` } : null;
      } },
    { id: "expected_actions", kind: "metric", label: "Distinct expected actions among the shown examples", format: "integer",
      compute: (ctx) => (ctx.shown().length ? new Set(ctx.shown().map((item) => item.expect?.action).filter(Boolean)).size : null) },

    { id: "shown_csv", kind: "exporter", label: "Shown examples as CSV", help: "inputs and hand-written expectations only; no answers or decisions",
      filename: "review-examples.csv", mime: "text/csv",
      build: (ctx) => csvText([["label", "stars", "channel", "about", "text", "expected_action", "expected_team", "expected_flags"],
        ...ctx.shown().map((item) => [item.label, item.stars ?? "", item.channel, item.about, item.text, item.expect?.action || "", item.expect?.team || "",
          (item.expect?.flags || []).join(" ")])]) },
    { id: "shown_markdown", kind: "exporter", label: "Shown examples as a Markdown list", help: "inputs only: label, stars, channel, subject and words",
      filename: "review-examples.md", mime: "text/markdown",
      build: (ctx) => ctx.shown().map((item) => `- **${item.label}** (${item.stars ?? "?"} stars, ${item.channel_label || item.channel || "unknown channel"}${item.about ? `, ${item.about}` : ""}): ${item.text.trim()}`).join("\n") + "\n" },

    { id: "next", kind: "command", title: "Load the next shown example", group: "Reviews", keys: "Alt+Shift+J",
      when: (ctx) => ctx.shown().length > 0 && !ctx.data.running, run: (ctx) => step(ctx, 1) },
    { id: "previous", kind: "command", title: "Load the previous shown example", group: "Reviews", keys: "Alt+Shift+K",
      when: (ctx) => ctx.shown().length > 0 && !ctx.data.running, run: (ctx) => step(ctx, -1) },
    { id: "focus_text", kind: "command", title: "Focus the review text", group: "Reviews", run: (ctx) => ctx.actions.focusText() },
  ],
});
