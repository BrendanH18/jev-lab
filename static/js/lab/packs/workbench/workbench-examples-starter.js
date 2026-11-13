// Facts, wording checks, counts, exports and commands for the Examples gallery ("workbench.examples.gallery"). They
// read authored content only (state, ordered questions, picture names). Exports never hold expectations or answers,
// and browsing never runs a model: the only action that changes the editor is Open in Build, from a command you run.
import { csvText, definePack } from "../../kit.js";

const words = (text) => String(text ?? "").split(/\s+/).filter(Boolean);
const codePoints = (text) => Array.from(String(text ?? "")).length;
const of = (item, type) => (Array.isArray(item?.questions) ? item.questions.filter((q) => q.type === type) : []);
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions : []);
const largest = (list) => (list.length ? Math.max(...list) : null);
const normal = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Every string in an authored state: the text itself, or the string leaves of an object or array.
function stateStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => stateStrings(entry, out));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => stateStrings(entry, out));
  return out;
}

// Field names written in backticks in an instruction: `message`, `photo` (a dotted name gives its first part).
const backticked = (text) => [...String(text ?? "").matchAll(/`([^`\s]+)`/g)].map((match) => match[1].split(".")[0]);

const isObjectState = (item) => !!item?.state && typeof item.state === "object" && !Array.isArray(item.state);

// One question in the request shape: Choice criteria as an object, Score levels as a list, Noul wording when authored.
function requestQuestion(q) {
  const out = { type: q.type, instructions: q.instructions };
  if (q.type === "choice") out.criteria = Object.fromEntries(q.criteria.map((c) => [c.key, c.text]));
  else if (q.type === "score") out.criteria = q.criteria.map((c) => c.text);
  else if (q.type === "noul" && q.criteria.length) out.criteria = Object.fromEntries(q.criteria.map((c) => [c.key, c.text || null]));
  return out;
}

export default definePack({
  id: "workbench-examples-starter",
  surface: "workbench.examples.gallery",
  title: "Example gallery insights",
  about: "Filters, sorts, wording checks, counts, exports and commands for the Examples gallery, from authored state, questions and picture names only. Exports never contain expectations or model answers, and nothing here runs a model.",
  features: [
    { id: "instruction_words", kind: "fact", type: "number", label: "instruction words", unit: "words",
      help: "Words across every question's instructions.",
      value: (item) => (questionsOf(item).length ? questionsOf(item).reduce((sum, q) => sum + words(q.instructions).length, 0) : null) },
    { id: "longest_instruction", kind: "fact", type: "number", label: "longest instruction length", unit: "characters",
      value: (item) => largest(questionsOf(item).map((q) => codePoints(q.instructions))) },
    { id: "yes_no_count", kind: "fact", type: "number", label: "yes/no question count", value: (item) => of(item, "noul").length },
    { id: "largest_choice", kind: "fact", type: "number", label: "options in the largest choice", help: "Unavailable without a Choice question.",
      value: (item) => largest(of(item, "choice").map((q) => q.criteria.length)) },
    { id: "score_levels", kind: "fact", type: "number", label: "levels in the largest score", help: "Unavailable without a Score question.",
      value: (item) => largest(of(item, "score").map((q) => q.criteria.length)) },
    { id: "state_fields", kind: "fact", type: "number", label: "top-level state fields", help: "Unavailable for a text or list state.",
      value: (item) => (isObjectState(item) ? Object.keys(item.state).length : null) },
    { id: "state_words", kind: "fact", type: "number", label: "words in the authored state", help: "Words in the state's text values, not tokens.",
      value: (item) => stateStrings(item?.state).reduce((sum, text) => sum + words(text).length, 0) },
    { id: "noul_wording", kind: "fact", type: "flag", label: "yes/no wording on a yes/no question",
      value: (item) => of(item, "noul").some((q) => q.criteria.length > 0) },
    { id: "field_references", kind: "fact", type: "flag", label: "instructions naming a state field in backticks",
      value: (item) => questionsOf(item).some((q) => backticked(q.instructions).length > 0) },
    { id: "type_combination", kind: "fact", type: "category", label: "question type combination",
      value: (item) => (Array.isArray(item?.types) && item.types.length ? item.types.join(" + ") : null) },
    { id: "picture_source", kind: "fact", type: "category", label: "picture source",
      value: (item) => {
        const pictures = Array.isArray(item?.pictures) ? item.pictures : [];
        if (!pictures.length) return "no pictures";
        const samples = pictures.filter((picture) => picture.sample).length;
        return samples === pictures.length ? "built-in samples" : samples ? "samples and embedded" : "embedded";
      } },

    { id: "missing_state_field", kind: "diagnostic", severity: "advice", label: "Instruction names a field the state lacks",
      check: (item) => {
        if (!isObjectState(item)) return null;
        const missing = [...new Set(questionsOf(item).flatMap((q) => backticked(q.instructions)))].filter((name) => !Object.hasOwn(item.state, name));
        return missing.map((name) => `\`${name}\` is named in an instruction, but the state has no such field.`);
      } },
    { id: "thin_choice", kind: "diagnostic", severity: "problem", label: "Choice with fewer than two options",
      check: (item) => of(item, "choice").filter((q) => q.criteria.length < 2).map((q) => `${q.id} has ${q.criteria.length} option${q.criteria.length === 1 ? "" : "s"}.`) },
    { id: "thin_score", kind: "diagnostic", severity: "problem", label: "Score with fewer than two levels",
      check: (item) => of(item, "score").filter((q) => q.criteria.length < 2).map((q) => `${q.id} has ${q.criteria.length} level${q.criteria.length === 1 ? "" : "s"}.`) },
    { id: "box_without_picture", kind: "diagnostic", severity: "problem", label: "Box question without a picture",
      check: (item) => (of(item, "box").length && !(item.picture_count > 0) ? `${of(item, "box").map((q) => q.id).join(", ")} asks where something is, but the example has no picture.` : null) },
    { id: "one_sided_noul", kind: "diagnostic", severity: "advice", label: "Yes/no wording on one side only",
      check: (item) => of(item, "noul").filter((q) => q.criteria.length && q.criteria.filter((c) => c.text.trim()).length === 1)
        .map((q) => `${q.id} describes only one answer.`) },
    { id: "repeated_instructions", kind: "diagnostic", severity: "advice", label: "Two questions with the same instructions",
      check: (item) => {
        const seen = new Map(), out = [];
        for (const q of questionsOf(item)) {
          const key = normal(q.instructions);
          if (key && seen.has(key)) out.push(`${q.id} repeats the instructions of ${seen.get(key)}.`);
          else if (key) seen.set(key, q.id);
        }
        return out;
      } },
    { id: "unused_picture", kind: "diagnostic", severity: "advice", label: "Picture nothing refers to",
      check: (item) => {
        const text = [...stateStrings(item?.state), ...questionsOf(item).map((q) => q.instructions)].join("\n");
        return (Array.isArray(item?.pictures) ? item.pictures : []).filter((picture) => !text.includes(picture.name))
          .map((picture) => `${picture.name} is attached, but neither the state nor an instruction mentions it.`);
      } },
    { id: "duplicate_ids", kind: "diagnostic", severity: "problem", scope: "list", label: "Example ID used twice",
      check: (items) => {
        const counts = new Map();
        for (const item of items) counts.set(item.id, (counts.get(item.id) || 0) + 1);
        return [...counts].filter(([, count]) => count > 1).map(([id, count]) => `${id} appears ${count} times.`);
      } },

    { id: "picture_share", kind: "metric", format: "percent", label: "Shown examples with pictures",
      compute: (ctx) => {
        const shown = ctx.shown();
        if (!shown.length) return null;
        const count = shown.filter((item) => item.picture_count > 0).length;
        return { value: count / shown.length, detail: `${count} of ${shown.length}` };
      } },
    { id: "mean_questions", kind: "metric", label: "Average questions per shown example",
      compute: (ctx) => {
        const shown = ctx.shown();
        return shown.length ? shown.reduce((sum, item) => sum + item.question_count, 0) / shown.length : null;
      } },
    { id: "hidden_pins", kind: "metric", format: "integer", label: "Pinned examples hidden by filters",
      help: "Pinned handoffs still include them.",
      compute: (ctx) => {
        if (!ctx.items().length) return null;
        const shown = new Set(ctx.shown().map((item) => item.id));
        return ctx.data.pins.filter((id) => !shown.has(id)).length;
      } },
    { id: "lab_hidden", kind: "metric", format: "integer", label: "Examples hidden by Lab filters",
      help: "Shown by the gallery's own filters, hidden by Lab's.",
      compute: (ctx) => (ctx.items().length ? Math.max(0, ctx.data.pageShown - ctx.shown().length) : null) },

    { id: "outlines_markdown", kind: "exporter", label: "Question outlines of the shown examples (Markdown)",
      help: "titles, question ids, types and criteria counts only", filename: "example-outlines.md", mime: "text/markdown",
      build: (ctx) => ctx.shown().map((item) => [`## ${item.title || item.id} · ${item.id}`, "",
        ...(item.questions.length ? item.questions.map((q) => `${q.position}. ${q.id} · ${q.type} · ${q.criteria.length} criteria`) : ["No questions."])].join("\n")).join("\n\n") + "\n" },
    { id: "requests_jsonl", kind: "exporter", label: "Authored requests of the shown examples (JSON Lines)",
      help: "one line per example: its id, state, questions and picture names; never expectations or answers", filename: "example-requests.jsonl", mime: "application/x-ndjson",
      build: (ctx) => ctx.shown().map((item) => JSON.stringify({ id: item.id, state: item.state,
        questions: Object.fromEntries(item.questions.map((q) => [q.id, requestQuestion(q)])), pictures: item.pictures.map((picture) => picture.name) })).join("\n") + "\n" },
    { id: "questions_csv", kind: "exporter", label: "Questions of the shown examples (CSV)",
      help: "example id, position, question id, type and criteria count; no wording", filename: "example-questions.csv", mime: "text/csv",
      build: (ctx) => csvText([["example", "position", "question", "type", "criteria"],
        ...ctx.shown().flatMap((item) => item.questions.map((q) => [item.id, q.position, q.id, q.type, q.criteria.length]))]) },
    { id: "instructions_markdown", kind: "exporter", label: "Authored instructions of the shown examples (Markdown)",
      help: "each question's instructions and criteria wording; no state, expectations or answers", filename: "example-instructions.md", mime: "text/markdown",
      build: (ctx) => ctx.shown().map((item) => [`## ${item.title || item.id}`, "",
        ...item.questions.flatMap((q) => [`- **${q.id}** (${q.type}): ${q.instructions}`, ...q.criteria.map((c) => `  - ${c.key}: ${c.text}`)])].join("\n")).join("\n\n") + "\n" },

    { id: "open_first_shown", kind: "command", group: "Examples", title: "Open the first shown example in Build",
      when: (ctx) => ctx.shown().length > 0, run: (ctx) => ctx.actions.open(ctx.shown()[0].id) },
    { id: "close_previews", kind: "command", group: "Examples", title: "Close every request preview",
      when: (ctx) => ctx.data.expanded.length > 0,
      run: (ctx) => { for (const id of ctx.data.expanded) ctx.actions.collapse(id); } },
    { id: "pin_loaded", kind: "command", group: "Examples", title: "Pin the example last opened in Build",
      when: (ctx) => ctx.data.loaded !== null && !ctx.data.pins.includes(ctx.data.loaded) && ctx.items().some((item) => item.id === ctx.data.loaded),
      run: (ctx) => ctx.actions.pin(ctx.data.loaded) },
  ],
});
