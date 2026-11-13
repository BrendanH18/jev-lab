// Starter pack for the Build editor's questions (surface workbench.build.questions, contract in
// static/js/lab/surfaces/workbench-build.js). Facts and checks read authored fields only, except the answer facts,
// which read the user's own latest Run of this page session. Nothing here calls the model or ships question wording.
import { definePack } from "../../kit.js";
import { duplicateKeys } from "../../lib/json.js";
import { codePoints, findBackticked, sentences, toSnakeCase } from "../../lib/text.js";

const hasOwn = (object, key) => !!object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value));
const str = (value) => (typeof value === "string" ? value : "");
const criteriaOf = (item) => (Array.isArray(item?.criteria) ? item.criteria.filter((entry) => entry && typeof entry.text === "string") : []);
const answerOf = (item, ctx) => (item.qid && hasOwn(ctx?.data?.answers, item.qid) ? ctx.data.answers[item.qid] : null);
const named = (items) => items.filter((item) => item.qid);
const RUN_NOTE = "From your latest Run in this page session.";

// Follows a backticked state path such as `photo`, `after.photo` or `frames[2].frame`, as the Build tab does.
function lookup(state, path) {
  if (state && typeof state === "object" && hasOwn(state, path)) return state[path];
  let node = state;
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (node === null || typeof node !== "object" || !hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

function idStyle(qid) {
  if (!qid) return null;
  if (/^[a-z][a-z0-9]*$/.test(qid)) return "single word";
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(qid)) return "snake_case";
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(qid)) return "camelCase";
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(qid)) return "kebab-case";
  return "other";
}

function expectationKind(expectation) {
  if (!expectation || typeof expectation !== "object") return null;
  if (hasOwn(expectation, "box")) return "box";
  if (hasOwn(expectation, "choice")) return "choice";
  const min = hasOwn(expectation, "min"), max = hasOwn(expectation, "max");
  return min && max ? "range" : min ? "minimum" : max ? "maximum" : "other";
}

// Shown ids must be unique after an id edit; throws with the first repeated id.
function assertUnique(items) {
  const seen = new Set();
  for (const item of items) {
    const qid = String(item.id ?? "").trim();
    if (!qid) continue;
    if (seen.has(qid)) throw new Error(`Two questions would have the id “${qid}”. Rename one first.`);
    seen.add(qid);
  }
}

// The checks the editor applies to a rename, run at preview time so Apply cannot fail on them: ids stay unique, an
// expectation moves with the first card of its id, and no card takes an id whose expectation it does not own (one that
// waits for a renamed question, or another card's). next[i] is items[i] edited.
function checkRenames(next, items, ctx) {
  assertUnique(next);
  const expect = ctx?.data?.expect && typeof ctx.data.expect === "object" ? ctx.data.expect : {};
  const owners = new Map();
  items.forEach((item, index) => { const qid = trimmedId(item); if (qid && !owners.has(qid)) owners.set(qid, index); });
  const held = new Map();
  for (const key of Object.keys(expect)) if (!owners.has(key)) held.set(key, -1);
  for (const [qid, index] of owners) {
    if (!hasOwn(expect, qid) && !items[index].expectation) continue;
    const moved = trimmedId(next[index]);
    if (!moved) throw new Error(`Question “${qid}” has human expectations, so it needs an id.`);
    held.set(moved, index);
  }
  next.forEach((item, index) => {
    const qid = trimmedId(item);
    if (qid && held.has(qid) && held.get(qid) !== index) throw new Error(`Expectations already exist for “${qid}”, so another question cannot take that id.`);
  });
  return next;
}

// A criterion as the request sends it: text that parses as a JSON object or array is sent as structure.
const sentCriterion = (value) => (structuredText(value) ? JSON.parse(value.trim()) : value);

// The question as the API takes it (authored fields only), for the JSON Lines handoff.
function apiQuestion(item) {
  const out = { id: item.qid, type: item.type, instructions: item.structured ? JSON.parse(item.instructions.trim()) : item.instructions };
  if (item.type === "choice") out.criteria = Object.fromEntries(item.criteria.map(({ key, text: value }) => [key, value ? sentCriterion(value) : null]));
  else if (item.type === "score") out.criteria = item.criteria.map(({ text: value }) => sentCriterion(value));
  else if (item.type === "noul" && item.criteria.length) {
    const outcome = (key) => { const value = item.criteria.find((entry) => entry.key === key)?.text; return value ? sentCriterion(value) : null; };
    out.criteria = { true: outcome("true"), false: outcome("false") };
  }
  return out;
}

// Transforms get copies without the read-only facts (qid, structured, …), so they work from the stored fields.
const trimmedId = (item) => String(item.id ?? "").trim();
function structuredText(value) {
  const trimmed = String(value ?? "").trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try { const parsed = JSON.parse(trimmed); return !!parsed && typeof parsed === "object"; } catch { return false; }
}

function refuseRaw(ctx) {
  if (ctx.data.rawPending) throw new Error("Apply the Raw JSON edits before sharing editor questions.");
}

export default definePack({
  id: "wb-build-question-insights",
  surface: "workbench.build.questions",
  title: "Question insights",
  about: "Facts, pre-run checks, id edits, a question-map importer and a JSON Lines handoff for the Build editor's questions. The handoff holds authored ids, types, instructions and criteria only; answer facts read only your own latest Run in this page session and go blank while it is outdated.",
  features: [
    // ---------- facts ----------
    { id: "references", kind: "fact", type: "number", label: "backticked references", unit: "references",
      help: "Backticked spans in the instructions, such as `ticket.body`.", value: (item) => findBackticked(item.instructions).length },
    { id: "instruction_sentences", kind: "fact", type: "number", label: "instruction sentences",
      help: "Sentences in text instructions; unavailable for structured (JSON) instructions.",
      value: (item) => (item.structured ? null : sentences(item.instructions).length) },
    { id: "longest_criterion", kind: "fact", type: "number", label: "longest criterion characters",
      help: "Characters in the longest active criterion description; unavailable without active criteria.",
      value: (item) => { const list = criteriaOf(item); return list.length ? Math.max(...list.map((entry) => codePoints(entry.text))) : null; } },
    { id: "question_mark", kind: "fact", type: "flag", label: "instructions ending in a question mark",
      help: "Text instructions whose last character is ?; structured (JSON) instructions never are.",
      value: (item) => !item.structured && str(item.instructions).trim().endsWith("?") },
    { id: "id_style", kind: "fact", type: "category", label: "id naming style",
      help: "single word, snake_case, camelCase, kebab-case or other; unavailable for a card without an id.", value: (item) => idStyle(item.qid) },
    { id: "answer_confidence", kind: "fact", type: "number", label: "latest answer confidence",
      help: `${RUN_NOTE} Unavailable while those answers are outdated (the request changed since), and for Noul answers, which carry no confidence.`,
      value: (item, ctx) => {
        if (ctx?.data?.stale) return null;
        const answer = answerOf(item, ctx);
        return answer && typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : null;
      } },
    { id: "expectation_kind", kind: "fact", type: "category", label: "expectation kind",
      help: "choice, range, minimum, maximum or box; unavailable without a human expectation.", value: (item) => expectationKind(item.expectation) },
    { id: "uses_picture", kind: "fact", type: "flag", label: "a picture reference",
      help: "The instructions name an attached picture by reference or through a backticked state field that holds one.",
      value: (item, ctx) => {
        const refs = (Array.isArray(ctx?.data?.images) ? ctx.data.images : []).map((image) => image?.ref).filter((ref) => typeof ref === "string" && ref);
        const instructions = str(item.instructions);
        if (refs.some((ref) => instructions.includes(ref))) return true;
        const state = ctx?.data?.state?.value ?? null;
        return findBackticked(instructions).some((path) => refs.includes(lookup(state, path.trim())));
      } },
    { id: "check_findings", kind: "fact", type: "number", label: "question-check findings",
      help: "Findings of your last Check questions (built-in and additional) about this question; unavailable before a check or after an edit.",
      value: (item, ctx) => {
        const lint = ctx?.data?.lint;
        if (!lint || !item.qid) return null;
        return [...(lint.findings || []), ...(lint.lab?.findings || [])].filter((finding) => finding?.question === item.qid).length;
      } },

    // ---------- checks (before Run) ----------
    { id: "choice_without_options", kind: "diagnostic", severity: "problem", label: "Choice without a named option",
      check: (item) => (item.qid && item.type === "choice" && !criteriaOf(item).length ? "Run will be refused: a Choice question needs at least one option with a key." : null) },
    { id: "score_too_few_levels", kind: "diagnostic", severity: "problem", label: "Score with fewer than two levels",
      check: (item) => (item.qid && item.type === "score" && criteriaOf(item).length < 2
        ? `Run will be refused: a Score question needs at least two levels; it has ${criteriaOf(item).length}.` : null) },
    { id: "box_without_picture", kind: "diagnostic", severity: "problem", label: "Box without a picture",
      check: (item, ctx) => (item.qid && item.type === "box" && !(ctx?.data?.images?.length) ? "Run will be refused: a Box question needs an attached picture." : null) },
    { id: "empty_instructions", kind: "diagnostic", severity: "problem", label: "Named question without instructions",
      check: (item) => (item.qid && item.instructions === "" ? "Run will be refused: every question with an id needs instructions." : null) },
    { id: "id_inner_space", kind: "diagnostic", severity: "advice", label: "Id with a space inside",
      check: (item) => (/\s/.test(str(item.qid)) ? "The id has a space inside; code that reads the answers is easier with letters, digits and underscores." : null) },
    { id: "blank_id", kind: "diagnostic", severity: "info", label: "Card without an id",
      check: (item) => (item.qid ? null : "This card has no id, so Run, Check and Export skip it.") },
    { id: "ids_differ_by_case", kind: "diagnostic", scope: "list", severity: "advice", label: "Ids that differ only by case",
      check: (items) => {
        const groups = new Map();
        for (const item of named(items)) {
          const key = item.qid.toLowerCase();
          if (!groups.has(key)) groups.set(key, new Set());
          groups.get(key).add(item.qid);
        }
        return [...groups.values()].filter((group) => group.size > 1).map((group) => `${[...group].join(", ")} differ only by case; they are different questions.`);
      } },

    // ---------- edits ----------
    { id: "snake_case_ids", kind: "transform", label: "Convert shown ids to snake_case",
      help: "Human expectations move with their question. Cards without an id, and ids already in snake_case, stay as they are.",
      all: (items, params, ctx, shown) => {
        const next = items.map((item, index) => {
          if (!shown.has(index) || !trimmedId(item)) return item;
          const id = toSnakeCase(trimmedId(item));
          return id && id !== trimmedId(item) ? { ...item, id } : item;
        });
        return checkRenames(next, items, ctx);
      } },
    { id: "prefix_ids", kind: "transform", label: "Add a prefix to shown ids",
      params: [{ name: "prefix", label: "Prefix", type: "text", required: true, placeholder: "support_" }],
      help: "Ids that already start with the prefix stay as they are; expectations move with their question.",
      all: (items, { prefix }, ctx, shown) => {
        if (/\s/.test(prefix)) throw new Error("The prefix cannot contain spaces.");
        const next = items.map((item, index) => {
          const qid = trimmedId(item);
          return shown.has(index) && qid && !qid.startsWith(prefix) ? { ...item, id: `${prefix}${qid}` } : item;
        });
        return checkRenames(next, items, ctx);
      } },
    { id: "collapse_inner_spaces", kind: "transform", label: "Collapse repeated spaces inside shown instructions",
      help: "Runs of spaces or tabs between words become one space. Indentation, line breaks and structured (JSON) instructions stay as they are.",
      each: (item) => {
        if (typeof item.instructions !== "string" || structuredText(item.instructions)) return null;
        const instructions = item.instructions.replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ");
        return instructions === item.instructions ? null : { ...item, instructions };
      } },

    // ---------- metrics ----------
    { id: "expectation_share", kind: "metric", format: "percent", label: "Questions with a human expectation",
      help: "Share of the questions with an id.",
      compute: (ctx) => {
        const list = named(ctx.items());
        return list.length ? { value: list.filter((item) => item.expectation).length / list.length, detail: `of ${list.length} with an id` } : null;
      } },
    { id: "answered_share", kind: "metric", format: "percent", label: "Questions answered in your latest run",
      help: RUN_NOTE,
      compute: (ctx) => {
        const list = named(ctx.items());
        if (!ctx.data.answers || !list.length) return null;
        return { value: list.filter((item) => hasOwn(ctx.data.answers, item.qid)).length / list.length, detail: ctx.data.stale ? "outdated: the request changed since that Run" : "" };
      } },

    // ---------- copy and download ----------
    { id: "questions_jsonl", kind: "exporter", label: "Shown questions as JSON Lines", help: "authored questions only: id, type, instructions and active criteria; no state, pictures, expectations or answers",
      filename: "jev-questions.jsonl", mime: "application/x-ndjson",
      build: (ctx) => {
        refuseRaw(ctx);
        const shown = ctx.shown();
        if (!shown.length) throw new Error("No questions are shown.");
        if (shown.some((item) => !item.qid)) throw new Error("Give every shown question an id before sharing JSON.");
        assertUnique(shown);
        return shown.map((item) => JSON.stringify(apiQuestion(item))).join("\n") + "\n";
      } },

    // ---------- paste to import ----------
    { id: "questions_map", kind: "importer", label: "Questions JSON map (adds questions)",
      help: "The API's questions object, as Raw JSON shows it. The questions are added after the last card; nothing is replaced.",
      parse: (input, ctx) => {
        const repeats = duplicateKeys(input);
        if (repeats === null) throw new Error("Paste a JSON object of questions keyed by id.");
        if (repeats.length) throw new Error(`The JSON repeats ${repeats[0]}. Keep each question and option key unique.`);
        const map = JSON.parse(input);
        if (!map || typeof map !== "object" || Array.isArray(map) || !Object.keys(map).length) throw new Error("Paste a JSON object of questions keyed by id.");
        const used = new Set(ctx.items().map((item) => item.qid));
        const warnings = [];
        const items = Object.entries(map).map(([id, question]) => {
          if (!question || typeof question !== "object" || !["noul", "choice", "score", "box"].includes(question.type)) {
            throw new Error(`Question “${id}” needs a type: noul, choice, score or box.`);
          }
          if (used.has(id.trim())) warnings.push(`“${id.trim()}” is already in the editor; rename one before adding.`);
          else if (hasOwn(ctx.data.expect, id.trim())) warnings.push(`“${id.trim()}” has human expectations waiting for a renamed question; rename the import before adding.`);
          const criteria = question.criteria;
          return { id, type: question.type, instructions: text(question.instructions),
            choice: question.type === "choice" && criteria && typeof criteria === "object" ? Object.entries(criteria).map(([key, value]) => [key, text(value)]) : [["", ""], ["", ""]],
            score: question.type === "score" && Array.isArray(criteria) ? criteria.map(text) : ["", "", ""],
            noulYes: question.type === "noul" ? text(criteria?.true) : "", noulNo: question.type === "noul" ? text(criteria?.false) : "" };
        });
        return { items, warnings };
      } },

    // ---------- commands ----------
    { id: "check_questions", kind: "command", title: "Check questions (plain code, no model call)", group: "Build", keys: "Alt+Shift+C",
      when: (ctx) => !ctx.data.rawPending && ctx.items().some((item) => item.qid), run: (ctx) => ctx.actions.checkQuestions() },
    { id: "first_shown", kind: "command", title: "Go to the first shown question", group: "Build", keys: "Alt+Shift+F",
      when: (ctx) => ctx.shown().length > 0, run: (ctx) => ctx.actions.focus(ctx.shown()[0].position) },
    { id: "export_code", kind: "command", title: "Export this request as code", group: "Build", keys: "Alt+Shift+E",
      when: (ctx) => !ctx.data.rawPending && ctx.items().some((item) => item.qid), run: (ctx) => ctx.actions.exportCode() },
  ],
});

