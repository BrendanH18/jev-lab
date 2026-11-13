// Facts, wording checks, counts, exports and commands for the Examples gallery ("workbench.examples.gallery"). They
// read authored content only (state, ordered questions, picture names). Exports never hold expectations or answers,
// and browsing never runs a model: the only action that changes the editor is Open in Build, from a command you run.
import { csvText, definePack } from "../../kit.js";

const words = (text) => String(text ?? "").split(/\s+/).filter(Boolean);
const codePoints = (text) => Array.from(String(text ?? "")).length;
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions.filter((q) => q && typeof q === "object") : []);
const of = (item, type) => questionsOf(item).filter((q) => q.type === type);
const criteriaOf = (q) => (Array.isArray(q?.criteria) ? q.criteria.filter((c) => c && typeof c === "object") : []);
const picturesOf = (item) => (Array.isArray(item?.pictures) ? item.pictures.filter((p) => p && typeof p === "object") : []);
const largest = (list) => (list.length ? Math.max(...list) : null);
const normal = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
// Criteria as the gallery counts them (its card outline and criteria bounds): Choice options and Score levels; Noul and
// Box add nothing.
const counted = (q) => (q.type === "choice" || q.type === "score" ? criteriaOf(q).length : 0);
const criteriaWord = (count) => `${count} ${count === 1 ? "criterion" : "criteria"}`;

// The picture names a request's text refers to, found the way the server does (jev/images.py _uses): every string of
// the state and of the questions (type, instructions, criteria), scanned left to right with longer names tried first
// and no overlaps, so "photo1" is not also counted inside "photo12".
function referencedPictures(item) {
  const names = [...new Set(picturesOf(item).map((p) => p.name).filter((name) => typeof name === "string" && name))].sort((a, b) => b.length - a.length);
  if (!names.length) return new Set();
  const pattern = new RegExp(names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const strings = [...stateStrings(item?.state), ...questionsOf(item).flatMap((q) => [q.type, q.instructions, ...criteriaOf(q).map((c) => c.text)])]
    .filter((value) => typeof value === "string");
  return new Set(strings.flatMap((value) => [...value.matchAll(pattern)].map((match) => match[0])));
}

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
  if (q.type === "choice") out.criteria = Object.fromEntries(criteriaOf(q).map((c) => [c.key, c.text]));
  else if (q.type === "score") out.criteria = criteriaOf(q).map((c) => c.text);
  else if (q.type === "noul" && criteriaOf(q).length) out.criteria = Object.fromEntries(criteriaOf(q).map((c) => [c.key, c.text || null]));
  return out;
}

export default definePack({
  id: "workbench-examples-starter",
  surface: "workbench.examples.gallery",
  title: "Example gallery insights",
  about: "Filters, sorts, wording and request checks, counts, exports and commands for the Examples gallery, from authored state, questions and picture names only. Exports never contain expectations or model answers, and nothing here runs a model.",
  features: [
    { id: "instruction_words", kind: "fact", type: "number", label: "instruction words", unit: "words",
      help: "Words across every question's instructions.",
      value: (item) => (questionsOf(item).length ? questionsOf(item).reduce((sum, q) => sum + words(q.instructions).length, 0) : null) },
    { id: "longest_instruction", kind: "fact", type: "number", label: "longest instruction length", unit: "characters",
      value: (item) => largest(questionsOf(item).map((q) => codePoints(q.instructions))) },
    { id: "yes_no_count", kind: "fact", type: "number", label: "yes/no question count", value: (item) => of(item, "noul").length },
    { id: "largest_choice", kind: "fact", type: "number", label: "options in the largest choice", help: "Unavailable without a Choice question.",
      value: (item) => largest(of(item, "choice").map((q) => criteriaOf(q).length)) },
    { id: "score_levels", kind: "fact", type: "number", label: "levels in the largest score", help: "Unavailable without a Score question.",
      value: (item) => largest(of(item, "score").map((q) => criteriaOf(q).length)) },
    { id: "state_fields", kind: "fact", type: "number", label: "top-level state fields", help: "Unavailable for a text or list state.",
      value: (item) => (isObjectState(item) ? Object.keys(item.state).length : null) },
    { id: "state_words", kind: "fact", type: "number", label: "words in the authored state", help: "Words in the state's text values, not tokens.",
      value: (item) => stateStrings(item?.state).reduce((sum, text) => sum + words(text).length, 0) },
    { id: "noul_wording", kind: "fact", type: "flag", label: "yes/no wording on a yes/no question",
      value: (item) => of(item, "noul").some((q) => criteriaOf(q).length > 0) },
    { id: "field_references", kind: "fact", type: "flag", label: "instructions naming a state field in backticks",
      value: (item) => questionsOf(item).some((q) => backticked(q.instructions).length > 0) },
    { id: "type_combination", kind: "fact", type: "category", label: "question type combination",
      value: (item) => {
        const types = Array.isArray(item?.types) ? item.types.filter((type) => typeof type === "string" && type) : [];
        return types.length ? types.join(" + ") : null;
      } },
    { id: "picture_source", kind: "fact", type: "category", label: "picture source",
      value: (item) => {
        const pictures = picturesOf(item);
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
      help: "A Choice with one option can only ever give that option.",
      check: (item) => of(item, "choice").filter((q) => criteriaOf(q).length < 2).map((q) => `${q.id} has ${criteriaOf(q).length} option${criteriaOf(q).length === 1 ? "" : "s"}.`) },
    { id: "thin_score", kind: "diagnostic", severity: "problem", label: "Score with fewer than two levels",
      help: "The server refuses a Score question with fewer than two levels.",
      check: (item) => of(item, "score").filter((q) => criteriaOf(q).length < 2).map((q) => `${q.id} has ${criteriaOf(q).length} level${criteriaOf(q).length === 1 ? "" : "s"}.`) },
    { id: "box_without_picture", kind: "diagnostic", severity: "problem", label: "Box question without a picture",
      help: "The server refuses a Box question in a request without a picture.",
      check: (item) => (of(item, "box").length && !(item.picture_count > 0) ? `${of(item, "box").map((q) => q.id).join(", ")} asks where something is, but the example has no picture.` : null) },
    { id: "one_sided_noul", kind: "diagnostic", severity: "advice", label: "Yes/no wording on one side only",
      check: (item) => of(item, "noul").filter((q) => criteriaOf(q).length && criteriaOf(q).filter((c) => String(c.text ?? "").trim()).length === 1)
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
    { id: "unused_picture", kind: "diagnostic", severity: "problem", label: "Picture nothing refers to",
      help: "The server refuses a request with a picture whose name appears nowhere in the state or the questions.",
      check: (item) => {
        const used = referencedPictures(item);
        return picturesOf(item).filter((picture) => !used.has(picture.name))
          .map((picture) => `${picture.name} is attached, but neither the state nor a question mentions it.`);
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
      help: "titles, question ids, types and criteria counts (Choice options and Score levels, as the gallery counts them) only",
      filename: "example-outlines.md", mime: "text/markdown",
      build: (ctx) => ctx.shown().map((item) => [`## ${item.title || item.id} · ${item.id}`, "",
        ...(questionsOf(item).length ? questionsOf(item).map((q) => `${q.position}. ${q.id} · ${q.type} · ${criteriaWord(counted(q))}`) : ["No questions."])].join("\n")).join("\n\n") + "\n" },
    { id: "requests_jsonl", kind: "exporter", label: "Authored requests of the shown examples (JSON Lines)",
      help: "one line per example: its id, state, questions and picture names; never expectations or answers", filename: "example-requests.jsonl", mime: "application/x-ndjson",
      build: (ctx) => ctx.shown().map((item) => JSON.stringify({ id: item.id, state: item.state,
        questions: Object.fromEntries(questionsOf(item).map((q) => [q.id, requestQuestion(q)])), pictures: picturesOf(item).map((picture) => picture.name) })).join("\n") + "\n" },
    { id: "questions_csv", kind: "exporter", label: "Questions of the shown examples (CSV)",
      help: "example id, position, question id, type and criteria count (Choice options and Score levels, as the gallery counts them); no wording",
      filename: "example-questions.csv", mime: "text/csv",
      build: (ctx) => csvText([["example", "position", "question", "type", "criteria"],
        ...ctx.shown().flatMap((item) => questionsOf(item).map((q) => [item.id, q.position, q.id, q.type, counted(q)]))]) },
    { id: "instructions_markdown", kind: "exporter", label: "Authored instructions of the shown examples (Markdown)",
      help: "each question's instructions and criteria wording; no state, expectations or answers", filename: "example-instructions.md", mime: "text/markdown",
      build: (ctx) => ctx.shown().map((item) => [`## ${item.title || item.id}`, "",
        ...questionsOf(item).flatMap((q) => [`- **${q.id}** (${q.type}): ${q.instructions}`, ...criteriaOf(q).map((c) => `  - ${c.key}: ${c.text}`)])].join("\n")).join("\n\n") + "\n" },

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
