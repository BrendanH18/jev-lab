// More facts, wording checks, counts, exports and commands for the Examples gallery ("workbench.examples.gallery").
// Everything reads authored content only (state, ordered questions, picture names, titles and notes). Exports never
// hold expectations, picture bytes or answers, checks are plain local code, and nothing here runs a model: the only
// command that changes the editor is "Open the example last opened in Build again", and only when you run it (Build
// still asks before replacing unsaved edits).
import { csvText, definePack } from "../../kit.js";
import { depth, stableStringify } from "../../lib/json.js";
import { median } from "../../lib/math.js";
import { codePoints, escapeRegExp, findBackticked, findPlaceholders, isIdentifier, wordCount } from "../../lib/text.js";

// The server's request limits (jev/workbench.py validate_questions).
const MAX_QUESTIONS = 100;
const MAX_CHOICE_OPTIONS = 255;
const MAX_SCORE_LEVELS = 25;
const LONG_INSTRUCTION = 300;
const TYPES = ["choice", "noul", "score", "box"];

const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions.filter((q) => q && typeof q === "object") : []);
const of = (item, type) => questionsOf(item).filter((q) => q.type === type);
const criteriaOf = (q) => (Array.isArray(q?.criteria) ? q.criteria.filter((c) => c && typeof c === "object") : []);
const text = (value) => (typeof value === "string" ? value : "");
const picturesOf = (item) => (Array.isArray(item?.pictures) ? item.pictures.filter((p) => p && typeof p === "object") : []);
const isObjectState = (item) => !!item?.state && typeof item.state === "object" && !Array.isArray(item.state);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// Every string in an authored state: the text itself, or the string leaves of an object or array.
function stateStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => stateStrings(entry, out));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => stateStrings(entry, out));
  return out;
}

// A Choice option that lets the model say the input does not tell: "unknown", "other", "not stated", "n/a" and similar.
const FALLBACK = /^(?:unknown|other|none(?: of (?:these|the above))?|n\/a|unsure|unclear|not[ _-](?:stated|sure|clear|applicable|mentioned|given))\.?$/i;

const shownShare = (ctx, test) => {
  const shown = ctx.shown();
  if (!shown.length) return null;
  const count = shown.filter(test).length;
  return { value: count / shown.length, detail: `${count} of ${shown.length}` };
};

// One line per criterion of the shown examples' questions of one type, for the CSV exports.
const criteriaRows = (ctx, type) => ctx.shown().flatMap((item) => of(item, type)
  .flatMap((q) => criteriaOf(q).map((criterion) => [item.id, q.id, criterion.key, criterion.text])));

export default definePack({
  id: "examples-more",
  surface: "workbench.examples.gallery",
  title: "More example gallery insights",
  about: "Question-type counts, instruction and criterion lengths, state depth, fallback options and other facts the gallery does not already filter by, server-limit and wording checks, counts, and exports of authored criteria, pictures, states and notes. Authored content only: exports never contain expectations, picture bytes or model answers, and nothing here runs a model.",
  features: [
    { id: "choice_count", kind: "fact", type: "number", label: "choice question count", value: (item) => of(item, "choice").length },
    { id: "box_count", kind: "fact", type: "number", label: "box question count", value: (item) => of(item, "box").length },
    { id: "shortest_instruction", kind: "fact", type: "number", label: "shortest instruction length", unit: "characters",
      help: "Unavailable without questions.",
      value: (item) => (questionsOf(item).length ? Math.min(...questionsOf(item).map((q) => codePoints(q.instructions))) : null) },
    { id: "mean_instruction_words", kind: "fact", type: "number", label: "average words per instruction", unit: "words",
      help: "Unavailable without questions.",
      value: (item) => {
        const list = questionsOf(item);
        return list.length ? list.reduce((sum, q) => sum + wordCount(q.instructions), 0) / list.length : null;
      } },
    { id: "longest_criterion", kind: "fact", type: "number", label: "longest criterion length", unit: "characters",
      help: "The longest Choice option, Score level or yes/no wording. Unavailable without criteria.",
      value: (item) => {
        const lengths = questionsOf(item).flatMap((q) => criteriaOf(q).map((criterion) => codePoints(criterion.text)));
        return lengths.length ? Math.max(...lengths) : null;
      } },
    { id: "state_depth", kind: "fact", type: "number", label: "state nesting depth",
      help: "0 for a text state, 1 for an object or list of plain values, 2 for a list of objects, and so on.",
      value: (item) => depth(item?.state) },
    { id: "backticked_names", kind: "fact", type: "number", label: "distinct names in backticks",
      help: "Distinct `name` spans across every question's instructions.",
      value: (item) => new Set(questionsOf(item).flatMap((q) => findBackticked(q.instructions)).map((name) => name.trim()).filter(Boolean)).size },
    { id: "expectation_share", kind: "fact", type: "number", label: "share of questions with an expectation", unit: "share",
      help: "Authored expectations per question (at most 1); counts only, never the expectations. Unavailable without questions.",
      value: (item) => {
        const count = questionsOf(item).length;
        return count && Number.isInteger(item.expectation_count) ? Math.min(1, item.expectation_count / count) : null;
      } },
    { id: "question_marks", kind: "fact", type: "flag", label: "every non-box instruction ending in a question mark",
      help: "Box instructions name a thing to find, so they are left out.",
      value: (item) => {
        const asked = questionsOf(item).filter((q) => q.type !== "box");
        return asked.length > 0 && asked.every((q) => text(q.instructions).trim().endsWith("?"));
      } },
    { id: "picture_in_state", kind: "fact", type: "flag", label: "a state value naming an attached picture",
      value: (item) => {
        const names = new Set(picturesOf(item).map((picture) => picture?.name));
        return stateStrings(item?.state).some((value) => names.has(value));
      } },
    { id: "fallback_option", kind: "fact", type: "flag", label: "a fallback choice option such as unknown or not stated",
      value: (item) => of(item, "choice").some((q) => criteriaOf(q).some((criterion) => FALLBACK.test(text(criterion.key).trim()) || FALLBACK.test(text(criterion.text).trim()))) },

    { id: "empty_instructions", kind: "diagnostic", severity: "problem", label: "Question without instructions",
      check: (item) => questionsOf(item).filter((q) => text(q.instructions).trim() === "").map((q) => `${q.id} has no instructions.`) },
    { id: "unknown_type", kind: "diagnostic", severity: "problem", label: "Question type the server does not accept",
      check: (item) => questionsOf(item).filter((q) => !TYPES.includes(q.type))
        .map((q) => `${q.id} has ${q.type ? `type "${q.type}"` : "no type"}; the server accepts choice, noul, score or box.`) },
    { id: "over_limits", kind: "diagnostic", severity: "problem", label: "Above the server's request limits",
      help: `At most ${MAX_QUESTIONS} questions, ${MAX_CHOICE_OPTIONS} Choice options and ${MAX_SCORE_LEVELS} Score levels.`,
      check: (item) => {
        const out = [];
        const count = questionsOf(item).length;
        if (count > MAX_QUESTIONS) out.push(`${count} questions; a request takes at most ${MAX_QUESTIONS}.`);
        for (const q of of(item, "choice")) if (criteriaOf(q).length > MAX_CHOICE_OPTIONS) out.push(`${q.id} has ${criteriaOf(q).length} options; at most ${MAX_CHOICE_OPTIONS}.`);
        for (const q of of(item, "score")) if (criteriaOf(q).length > MAX_SCORE_LEVELS) out.push(`${q.id} has ${criteriaOf(q).length} levels; at most ${MAX_SCORE_LEVELS}.`);
        return out;
      } },
    { id: "question_id_identifier", kind: "diagnostic", severity: "advice", label: "Question ID that is not a plain identifier",
      help: "Letters, digits and underscores, not starting with a digit, are easiest to read back in code.",
      check: (item) => questionsOf(item).filter((q) => !isIdentifier(q.id)).map((q) => `"${q.id}" is not a plain identifier.`) },
    { id: "choice_key_identifier", kind: "diagnostic", severity: "advice", label: "Choice option key that is not a plain identifier",
      check: (item) => of(item, "choice").flatMap((q) => criteriaOf(q).filter((criterion) => !isIdentifier(criterion.key))
        .map((criterion) => `${q.id}: option key "${criterion.key}" is not a plain identifier.`)) },
    { id: "blank_choice_text", kind: "diagnostic", severity: "advice", label: "Choice option without a description",
      check: (item) => of(item, "choice").flatMap((q) => criteriaOf(q).filter((criterion) => text(criterion.text).trim() === "")
        .map((criterion) => `${q.id}: option ${criterion.key} has no description.`)) },
    { id: "blank_score_level", kind: "diagnostic", severity: "advice", label: "Score level without a description",
      check: (item) => of(item, "score").flatMap((q) => criteriaOf(q).filter((criterion) => text(criterion.text).trim() === "")
        .map((criterion) => `${q.id}: level ${criterion.key} has no description.`)) },
    { id: "same_choice_text", kind: "diagnostic", severity: "advice", label: "Two Choice options with the same description",
      help: "Compared ignoring case and repeated spaces.",
      check: (item) => of(item, "choice").flatMap((q) => {
        const seen = new Map(), out = [];
        for (const criterion of criteriaOf(q)) {
          const key = text(criterion.text).toLowerCase().replace(/\s+/g, " ").trim();
          if (!key) continue;
          if (seen.has(key)) out.push(`${q.id}: options ${seen.get(key)} and ${criterion.key} have the same description.`);
          else seen.set(key, criterion.key);
        }
        return out;
      }) },
    { id: "long_instruction", kind: "diagnostic", severity: "advice", label: `Instruction longer than ${LONG_INSTRUCTION} characters`,
      check: (item) => questionsOf(item).filter((q) => codePoints(q.instructions) > LONG_INSTRUCTION)
        .map((q) => `${q.id}: instructions are ${codePoints(q.instructions)} characters long.`) },
    { id: "placeholder", kind: "diagnostic", severity: "advice", label: "Instruction with a template placeholder",
      help: "Placeholders such as {name}, {{name}}, <name> or [NAME] are sent as written: nothing fills them in.",
      check: (item) => questionsOf(item).flatMap((q) => {
        const found = [...new Set(findPlaceholders(q.instructions))];
        return found.length ? [`${q.id}: instructions contain ${found.join(", ")}, which nothing fills in.`] : [];
      }) },
    { id: "noul_not_question", kind: "diagnostic", severity: "advice", label: "Yes/no instruction not phrased as a question",
      check: (item) => of(item, "noul").filter((q) => text(q.instructions).trim() !== "" && !text(q.instructions).trim().endsWith("?"))
        .map((q) => `${q.id} is a yes/no question whose instructions do not end with a question mark.`) },
    { id: "unmentioned_field", kind: "diagnostic", severity: "info", label: "State field no instruction mentions",
      help: "A top-level field of an object state whose name appears in no instruction (whole word, any case).",
      check: (item) => {
        if (!isObjectState(item)) return null;
        const wording = questionsOf(item).map((q) => text(q.instructions)).join("\n");
        return Object.keys(item.state).filter((name) => !new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(name)}(?:[^A-Za-z0-9_]|$)`, "i").test(wording))
          .map((name) => `${name} is in the state, but no instruction mentions it.`);
      } },
    { id: "identical_states", kind: "diagnostic", severity: "advice", scope: "list", label: "Two examples with the same authored state",
      help: "Compared ignoring object key order; blank text states are left out.",
      check: (items) => {
        const groups = new Map();
        for (const item of items) {
          if (item?.state === null || item?.state === undefined || (typeof item.state === "string" && item.state.trim() === "")) continue;
          const key = stableStringify(item.state);
          if (key !== null) groups.set(key, [...(groups.get(key) || []), item.id]);
        }
        return [...groups.values()].filter((ids) => ids.length > 1).map((ids) => `${ids.join(", ")} have the same authored state.`);
      } },

    { id: "total_criteria", kind: "metric", format: "integer", label: "Criteria across the shown examples",
      help: "Choice options plus Score levels, as the gallery counts them.",
      compute: (ctx) => (ctx.shown().length ? ctx.shown().reduce((sum, item) => sum + (Number.isInteger(item.criteria_count) ? item.criteria_count : 0), 0) : null) },
    { id: "expectation_examples", kind: "metric", format: "percent", label: "Shown examples with an authored expectation",
      help: "A count only; the expectations themselves are never shown.",
      compute: (ctx) => shownShare(ctx, (item) => item.expectation_count > 0) },
    { id: "median_state_bytes", kind: "metric", label: "Median authored state size of the shown examples (bytes)",
      help: "UTF-8 bytes of the authored input, not tokens or spend.",
      compute: (ctx) => (ctx.shown().length ? median(ctx.shown().map((item) => item.state_bytes)) : null) },
    { id: "box_examples", kind: "metric", format: "percent", label: "Shown examples with a Box question",
      compute: (ctx) => shownShare(ctx, (item) => of(item, "box").length > 0) },

    { id: "choice_options_csv", kind: "exporter", label: "Choice options of the shown examples (CSV)",
      help: "example id, question id, option key and authored description; no state, expectations or answers",
      filename: "example-choice-options.csv", mime: "text/csv",
      build: (ctx) => csvText([["example", "question", "option", "description"], ...criteriaRows(ctx, "choice")]) },
    { id: "score_levels_csv", kind: "exporter", label: "Score levels of the shown examples (CSV)",
      help: "example id, question id, level number and authored description; no state, expectations or answers",
      filename: "example-score-levels.csv", mime: "text/csv",
      build: (ctx) => csvText([["example", "question", "level", "description"], ...criteriaRows(ctx, "score")]) },
    { id: "pictures_csv", kind: "exporter", label: "Picture references of the shown examples (CSV)",
      help: "example id, picture name and built-in sample name (blank for an embedded picture); never picture bytes",
      filename: "example-pictures.csv", mime: "text/csv",
      build: (ctx) => csvText([["example", "picture", "sample"],
        ...ctx.shown().flatMap((item) => picturesOf(item).map((picture) => [item.id, picture.name, picture.sample || ""]))]) },
    { id: "states_json", kind: "exporter", label: "Authored states of the shown examples (JSON)",
      help: "each example's id and authored state only; no questions, pictures, expectations or answers",
      filename: "example-states.json", mime: "application/json",
      build: (ctx) => `${JSON.stringify(Object.fromEntries(ctx.shown().map((item) => [item.id, item.state])), null, 2)}\n` },
    { id: "notes_markdown", kind: "exporter", label: "Titles, patterns and notes of the shown examples (Markdown)",
      help: "each example's title, id, pattern, summary and In code note as authored; no state, questions, expectations or answers",
      filename: "example-notes.md", mime: "text/markdown",
      build: (ctx) => ctx.shown().map((item) => [`## ${item.title || item.id} · ${item.id}`, "",
        ...(item.pattern ? [`Pattern: ${item.pattern}`] : []), ...(item.blurb ? [`Summary: ${item.blurb}`] : []),
        ...(item.code ? [`In code: ${item.code}`] : []), ...(item.pattern || item.blurb || item.code ? [] : ["No notes."])].join("\n")).join("\n\n") + "\n" },

    { id: "expand_pinned", kind: "command", group: "Examples", title: "Open the request previews of pinned examples",
      when: (ctx) => ctx.data.pins.some((id) => !ctx.data.expanded.includes(id)),
      run: (ctx) => {
        const ids = ctx.data.pins.filter((id) => !ctx.data.expanded.includes(id));
        for (const id of ids) ctx.actions.expand(id);
        ctx.env.toast(`Opened ${plural(ids.length, "preview")}.`);
      } },
    { id: "collapse_hidden", kind: "command", group: "Examples", title: "Close the request previews of hidden examples",
      when: (ctx) => {
        const shown = new Set(ctx.shown().map((item) => item.id));
        return ctx.data.expanded.some((id) => !shown.has(id));
      },
      run: (ctx) => {
        const shown = new Set(ctx.shown().map((item) => item.id));
        const ids = ctx.data.expanded.filter((id) => !shown.has(id));
        for (const id of ids) ctx.actions.collapse(id);
        ctx.env.toast(`Closed ${plural(ids.length, "hidden preview")}.`);
      } },
    { id: "unpin_hidden", kind: "command", group: "Examples", title: "Unpin the examples hidden by filters",
      help: "Pins of shown examples stay.",
      when: (ctx) => {
        const shown = new Set(ctx.shown().map((item) => item.id));
        return ctx.data.pins.some((id) => !shown.has(id));
      },
      run: (ctx) => {
        const shown = new Set(ctx.shown().map((item) => item.id));
        const ids = ctx.data.pins.filter((id) => !shown.has(id));
        for (const id of ids) ctx.actions.unpin(id);
        ctx.env.toast(`Unpinned ${plural(ids.length, "hidden example")}.`);
      } },
    { id: "reopen_loaded", kind: "command", group: "Examples", title: "Open the example last opened in Build again",
      help: "Build asks before replacing unsaved edits. Nothing runs.",
      when: (ctx) => ctx.data.loaded !== null && ctx.items().some((item) => item.id === ctx.data.loaded),
      run: (ctx) => ctx.actions.open(ctx.data.loaded) },
  ],
});
