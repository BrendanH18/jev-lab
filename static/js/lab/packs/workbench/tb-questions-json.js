// Toolbox tools for question sets and JSON ("workbench.toolbox", group "Questions and JSON"). A questions object is
// keyed by question id; each question has a type (noul, choice, score or box), instructions, and criteria: Choice an
// object of option key to description, Score a list of levels from 0 up, Noul optional "true"/"false" criteria, Box
// none. Every tool reads only the text typed or pasted into its form, runs locally and returns text to copy or a
// table. Nothing reads page data, sends anything or calls the model, and no tool writes question wording of its own:
// builders assemble exactly the instructions and criteria typed into them.
import { definePack } from "../../kit.js";
import { countLeaves, depth, diffValues, duplicateKeys, flatten, getPath, listPaths, mergeDeep, parsePath, setPath, sortKeys, stableStringify, typeName, unflatten, walk } from "../../lib/json.js";
import { formatDelimited, formatMarkdownTable, parseDelimited, parseMarkdownTable, sniffDelimiter } from "../../lib/tables.js";
import { truncate, utf8Bytes, wordCount } from "../../lib/text.js";

const GROUP = "Questions and JSON";
const TYPES = ["noul", "choice", "score", "box"];
const FIELDS = ["type", "instructions", "criteria"];
const MAX_QUESTIONS = 100;
const MAX_OPTIONS = 255;
const MAX_LEVELS = 25;
const STATE_LIMIT = 120000;
const OUTLINE = ["id", "type", "instructions", "key", "description"];
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const pretty = (value) => JSON.stringify(value, null, 2);
const describe = (value) => (typeof value === "string" ? value : JSON.stringify(value));

function setOwn(object, key, value) {
  if (key === "__proto__") Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
  else object[key] = value;
}

function parseJson(text, what = "This") {
  try { return JSON.parse(text); } catch (error) { throw new Error(`${what} is not valid JSON: ${error.message}`); }
}

function parseQuestions(text, what = "The questions object") {
  const value = parseJson(text, what);
  if (!isRecord(value) || !Object.values(value).every(isRecord)) throw new Error(`${what} must be a JSON object keyed by question id, each question an object.`);
  return value;
}

const JSON_IN = (name = "json", label = "JSON") => ({ name, label, type: "textarea", required: true });
const QUESTIONS = (name = "questions", label = "Questions (JSON object keyed by question id)") => ({ name, label, type: "textarea", required: true,
  placeholder: '{"wants_refund": {"type": "noul", "instructions": "Does the customer ask for a refund?"}}' });
const ID = { name: "id", label: "Question id", type: "text", required: true };
const INSTRUCTIONS = { name: "instructions", label: "Instructions", type: "textarea", required: true };

function questionId(text) {
  const id = String(text).trim();
  if (!id) throw new Error("Question id is required.");
  return id;
}

// ---------- outlines ----------

// One outline row per criterion (Choice option, Score level, Noul true/false), or one row for a question without
// criteria. id and type repeat on every row; the instructions sit on the question's first row.
function outlineRows(questions) {
  const rows = [];
  for (const [id, question] of Object.entries(questions)) {
    const type = typeof question.type === "string" ? question.type : describe(question.type ?? "");
    const instructions = question.instructions === undefined ? "" : describe(question.instructions);
    const { criteria } = question;
    const entries = Array.isArray(criteria) ? criteria.map((level, index) => [String(index), level]) : isRecord(criteria) ? Object.entries(criteria) : [];
    if (!entries.length) rows.push([id, type, instructions, "", ""]);
    entries.forEach(([key, description], index) => rows.push([id, type, index ? "" : instructions, key, describe(description ?? "")]));
  }
  return rows;
}

// The apostrophe the CSV outline puts before text a spreadsheet would run as a formula (= + - @, or a leading tab or
// line break), taken off again so a round trip keeps the wording.
const unformula = (text) => text.replace(/^'(?=\s*[=+@-]|[\t\r\n])/, "");

function fromOutline(header, body, fromCsv = false) {
  const find = (name) => header.findIndex((cell) => String(cell).trim().toLowerCase() === name);
  const at = Object.fromEntries(OUTLINE.map((name) => [name, find(name)]));
  if (at.id === -1 || at.type === -1) throw new Error(`The outline needs id and type columns (and instructions, key, description). Columns: ${header.join(", ")}.`);
  const drafts = new Map();
  body.forEach((cells, index) => {
    const row = index + 2;
    const get = (column) => {
      const text = at[column] === -1 ? "" : String(cells[at[column]] ?? "");
      return fromCsv ? unformula(text) : text;
    };
    if (cells.every((cell) => String(cell).trim() === "")) return;
    const id = get("id").trim();
    if (!id) throw new Error(`Row ${row} has no id.`);
    const type = get("type").trim().toLowerCase();
    if (!TYPES.includes(type)) throw new Error(`Row ${row}: type must be noul, choice, score or box.`);
    if (!drafts.has(id)) drafts.set(id, { type, instructions: "", entries: [] });
    const draft = drafts.get(id);
    if (draft.type !== type) throw new Error(`Question ${id} has two types: ${draft.type} and ${type}.`);
    const instructions = get("instructions").trim();
    if (instructions && draft.instructions && instructions !== draft.instructions) throw new Error(`Question ${id} has two different instructions.`);
    if (instructions) draft.instructions = instructions;
    const key = get("key").trim(), description = get("description").trim();
    if (key || description) draft.entries.push({ key, description, row });
  });
  if (!drafts.size) throw new Error("The outline has no questions.");
  const out = {};
  for (const [id, draft] of drafts) {
    if (!draft.instructions) throw new Error(`Question ${id} has no instructions.`);
    const question = { type: draft.type, instructions: draft.instructions };
    const { entries } = draft;
    if (draft.type === "choice") {
      if (!entries.length) throw new Error(`Choice ${id} has no options.`);
      const criteria = {};
      for (const entry of entries) {
        if (!entry.key) throw new Error(`Row ${entry.row}: a Choice option needs a key.`);
        if (hasOwn(criteria, entry.key)) throw new Error(`Choice ${id} lists option ${entry.key} twice.`);
        let description = entry.description;
        if (description.startsWith("{")) {
          try { const parsed = JSON.parse(description); if (isRecord(parsed)) description = parsed; } catch { /* text */ }
        }
        setOwn(criteria, entry.key, description);
      }
      question.criteria = criteria;
    } else if (draft.type === "score") {
      if (entries.length < 2) throw new Error(`Score ${id} needs at least two levels.`);
      if (entries.every((entry) => entry.key === "")) question.criteria = entries.map((entry) => entry.description);
      else {
        const levels = [];
        for (const entry of entries) {
          const level = /^\d+$/.test(entry.key) ? Number(entry.key) : -1;
          if (level < 0 || level >= entries.length || levels[level] !== undefined) throw new Error(`Score ${id} levels must be numbered 0 to ${entries.length - 1}, once each.`);
          levels[level] = entry.description;
        }
        question.criteria = levels;
      }
    } else if (draft.type === "noul") {
      if (entries.length) {
        const criteria = {};
        for (const entry of entries) {
          const key = entry.key.toLowerCase();
          if (key !== "true" && key !== "false") throw new Error(`Row ${entry.row}: a Noul criterion's key is true or false.`);
          if (hasOwn(criteria, key)) throw new Error(`Noul ${id} gives its ${key} criterion twice.`);
          criteria[key] = entry.description;
        }
        question.criteria = criteria;
      }
    } else if (entries.length) throw new Error(`Box ${id} takes no criteria.`);
    setOwn(out, id, question);
  }
  return out;
}

// ---------- validation ----------

function criteriaProblem(type, criteria) {
  if (type === "choice") {
    if (!isRecord(criteria) || !Object.keys(criteria).length) return "Choice criteria must be an object of option key to description";
    return Object.keys(criteria).length > MAX_OPTIONS ? `At most ${MAX_OPTIONS} options` : null;
  }
  if (type === "score") {
    if (!Array.isArray(criteria) || criteria.length < 2) return "Score criteria must be a list of at least two levels";
    return criteria.length > MAX_LEVELS ? `At most ${MAX_LEVELS} levels` : null;
  }
  if (type === "box") {
    const empty = criteria === undefined || criteria === null || (Array.isArray(criteria) && !criteria.length) || (isRecord(criteria) && !Object.keys(criteria).length);
    return empty ? null : "Box questions take no criteria";
  }
  if (criteria === undefined || criteria === null) return null;
  return isRecord(criteria) && Object.keys(criteria).every((key) => key === "true" || key === "false") ? null : "Noul criteria may only have true and false keys";
}

function validate(text) {
  const value = parseJson(text, "The questions object");
  const problems = [];
  for (const path of duplicateKeys(text) || []) {
    const segments = parsePath(path) || [path];
    problems.push([String(segments[0]), segments.length === 1 ? "The id is written twice; JSON keeps only the last question" : `${path} is written twice; JSON keeps only the last value`]);
  }
  if (!isRecord(value)) return { count: 0, problems: [...problems, ["", "Questions must be an object keyed by question id"]] };
  const ids = Object.keys(value);
  if (!ids.length) problems.push(["", "There are no questions"]);
  if (ids.length > MAX_QUESTIONS) problems.push(["", `At most ${MAX_QUESTIONS} questions per request`]);
  const trimmed = new Map();
  for (const id of ids) {
    const add = (problem) => problems.push([id, problem]);
    const clean = id.trim();
    if (!clean) add("The id is blank");
    else if (trimmed.has(clean)) add(`Same id as ${JSON.stringify(trimmed.get(clean))} once spaces are trimmed`);
    else trimmed.set(clean, id);
    const question = value[id];
    if (!isRecord(question)) { add("A question must be an object"); continue; }
    const typed = TYPES.includes(question.type);
    if (!typed) add("type must be noul, choice, score or box");
    const { instructions } = question;
    if (instructions === undefined || instructions === null || instructions === "") add("Instructions are missing");
    else if (typeof instructions !== "string") add("Instructions are not text");
    else if (!instructions.trim()) add("Instructions are blank");
    if (typed) {
      const problem = criteriaProblem(question.type, question.criteria);
      if (problem) add(problem);
    }
    for (const key of Object.keys(question)) if (!FIELDS.includes(key)) add(`${key} is not sent to the model; only type, instructions and criteria are`);
  }
  return { count: ids.length, problems };
}

// ---------- key-value text ----------

function decodeQuoted(text) {
  if (!text.startsWith('"')) return undefined;
  try { const value = JSON.parse(text); return typeof value === "string" ? value : undefined; } catch { return undefined; }
}

function typedValue(text) {
  if (JSON_NUMBER.test(text)) return Number(text);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

const needsQuotes = (text) => text === "" || text !== text.trim() || /[\r\n]/.test(text) || text.startsWith('"')
  || JSON_NUMBER.test(text) || ["true", "false", "null"].includes(text) || text.startsWith("{") || text.startsWith("[");

// ---------- the server's count (Python json.dumps: ", " and ": " separators, non-ASCII escaped) ----------

const asciiJson = (text) => JSON.stringify(text).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

function pyDumps(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return asciiJson(value);
  if (Array.isArray(value)) return `[${value.map(pyDumps).join(", ")}]`;
  return `{${Object.keys(value).map((key) => `${asciiJson(key)}: ${pyDumps(value[key])}`).join(", ")}}`;
}

function listIds(text) {
  const ids = String(text).split(/[,\n]/).map((id) => id.trim()).filter(Boolean);
  if (!ids.length) throw new Error("List at least one question id.");
  return ids;
}

function optionCount(question) {
  const { criteria } = question;
  return Array.isArray(criteria) ? criteria.length : isRecord(criteria) ? Object.keys(criteria).length : 0;
}

function criteriaChanges(before, after) {
  const a = before.criteria, b = after.criteria;
  if (stableStringify(a ?? null) === stableStringify(b ?? null)) {
    const reordered = isRecord(a) && isRecord(b) && Object.keys(a).join("\u0000") !== Object.keys(b).join("\u0000");
    return reordered ? ["option order changed"] : [];
  }
  if (isRecord(a) && isRecord(b) && before.type === "choice" && after.type === "choice") {
    const out = [];
    const added = Object.keys(b).filter((key) => !hasOwn(a, key)), removed = Object.keys(a).filter((key) => !hasOwn(b, key));
    const changed = Object.keys(a).filter((key) => hasOwn(b, key) && stableStringify(a[key]) !== stableStringify(b[key]));
    if (added.length) out.push(`options added: ${added.join(", ")}`);
    if (removed.length) out.push(`options removed: ${removed.join(", ")}`);
    if (changed.length) out.push(`option descriptions changed: ${changed.join(", ")}`);
    const common = (keys, other) => keys.filter((key) => hasOwn(other, key)).join("\u0000");
    if (common(Object.keys(a), b) !== common(Object.keys(b), a)) out.push("option order changed");
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [];
    if (a.length !== b.length) out.push(`levels ${a.length} → ${b.length}`);
    const changed = a.slice(0, b.length).flatMap((level, index) => (stableStringify(level) !== stableStringify(b[index]) ? [index] : []));
    if (changed.length) out.push(`level descriptions changed: ${changed.join(", ")}`);
    return out;
  }
  return ["criteria changed"];
}

function allowedLabels(question) {
  const { type, criteria } = question;
  if (type === "choice") return isRecord(criteria) && Object.keys(criteria).length ? Object.keys(criteria).join(", ") : "no options yet";
  if (type === "noul") return "true or false (also yes/no, y/n, 1/0)";
  if (type === "score") return Array.isArray(criteria) && criteria.length ? criteria.map((_level, index) => index).join(", ") : "no levels yet";
  if (type === "box") return "left, top, right and bottom, each from 0 to 1";
  return "none: the type is not noul, choice, score or box";
}

export default definePack({
  id: "tb-questions-json",
  surface: "workbench.toolbox",
  title: "Question and JSON tools",
  about: "Thirty tools for question sets and JSON: validate a questions object, build Choice, Score and Noul questions from what you type, convert questions to and from CSV or Markdown outlines, rename, compare and combine question sets, and format, diff, flatten and query JSON. They read only what you paste, never write question wording of their own, and send nothing anywhere.",
  features: [
    // ---------- questions ----------
    { id: "validate_questions", kind: "tool", group: GROUP, title: "Validate a questions object",
      help: "Lists every problem the Workbench would refuse or silently drop before a run: ids written twice (JSON keeps the last), blank or clashing ids, unknown types, missing instructions, criteria of the wrong shape or size, and fields that are never sent; it also flags instructions that are blank or not text. It checks shape only, not wording.",
      inputs: [QUESTIONS()],
      compute: ({ questions }) => {
        const { count, problems } = validate(questions);
        return { rows: [["Questions", count], ["Problems", problems.length]], table: { columns: ["question", "problem"], rows: problems },
          note: problems.length ? null : "No problems found. These checks cover the shape, not whether the wording gets good answers." };
      } },
    { id: "choice_from_options", kind: "tool", group: GROUP, title: "Choice question from a list of options",
      help: "Builds a Choice question from one option per line, as key: description (or a key alone for an option without a description). Keys keep their order and must be unique.",
      inputs: [ID, INSTRUCTIONS, { name: "options", label: "Options, one per line (key: description)", type: "textarea", required: true, placeholder: "billing: Refunds, charges, or payment questions\nshipping: Delivery tracking or missing parcels" }],
      compute: ({ id, instructions, options }) => {
        const criteria = {}, lines = new Map();
        options.split(/\r\n|\r|\n/).forEach((raw, index) => {
          const line = raw.trim();
          if (!line) return;
          const colon = line.indexOf(":");
          const key = (colon === -1 ? line : line.slice(0, colon)).trim();
          if (!key) throw new Error(`Line ${index + 1} has no option key.`);
          if (lines.has(key)) throw new Error(`Option ${key} is listed twice (lines ${lines.get(key)} and ${index + 1}).`);
          lines.set(key, index + 1);
          setOwn(criteria, key, colon === -1 ? "" : line.slice(colon + 1).trim());
        });
        const keys = Object.keys(criteria);
        if (keys.length < 2) throw new Error("A Choice needs at least two options.");
        if (keys.length > MAX_OPTIONS) throw new Error(`A Choice takes at most ${MAX_OPTIONS} options.`);
        const described = keys.filter((key) => criteria[key] !== "").length;
        const out = {};
        setOwn(out, questionId(id), { type: "choice", instructions: instructions.trim(), criteria });
        return { text: pretty(out), note: `${plural(keys.length, "option")}.${described && described < keys.length ? " Some options have a description and others do not." : ""}` };
      } },
    { id: "score_from_levels", kind: "tool", group: GROUP, title: "Score question from ordered levels",
      help: "Builds a Score question from one level description per line, lowest first: the first line is level 0. Two to 25 levels.",
      inputs: [ID, INSTRUCTIONS, { name: "levels", label: "Levels, lowest first, one per line", type: "textarea", required: true, placeholder: "No deadline or time pressure\nSoon, without an immediate deadline\nImmediate action or an explicit urgent deadline" }],
      compute: ({ id, instructions, levels }) => {
        const criteria = levels.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
        if (criteria.length < 2) throw new Error("A Score needs at least two levels.");
        if (criteria.length > MAX_LEVELS) throw new Error(`A Score takes at most ${MAX_LEVELS} levels.`);
        const folded = criteria.map((level) => level.toLowerCase());
        const twin = folded.findIndex((level, index) => folded.indexOf(level) !== index);
        const out = {};
        setOwn(out, questionId(id), { type: "score", instructions: instructions.trim(), criteria });
        return { text: pretty(out), note: `${criteria.length} levels, 0 to ${criteria.length - 1}.${twin === -1 ? "" : ` Levels ${folded.indexOf(folded[twin])} and ${twin} read the same.`}` };
      } },
    { id: "noul_question", kind: "tool", group: GROUP, title: "Noul question with yes and no criteria",
      help: "Builds a Noul (yes or no) question with the true and false criteria you type: what a yes means and what a no means. A blank criterion is left out.",
      inputs: [ID, INSTRUCTIONS, { name: "yes", label: "What a yes (true) means", type: "textarea" }, { name: "no", label: "What a no (false) means", type: "textarea" }],
      compute: ({ id, instructions, yes, no }) => {
        const question = { type: "noul", instructions: instructions.trim() };
        const criteria = {};
        if (yes.trim()) criteria.true = yes.trim();
        if (no.trim()) criteria.false = no.trim();
        if (Object.keys(criteria).length) question.criteria = criteria;
        const out = {};
        setOwn(out, questionId(id), question);
        return { text: pretty(out), note: Object.keys(criteria).length === 2 ? null : "A Noul is clearer with both a true and a false criterion." };
      } },
    { id: "list_questions", kind: "tool", group: GROUP, title: "List question ids and types",
      help: "One line per question, in request order: its id, type, how many options, levels or Noul criteria it has, and how many words its instructions run to.",
      inputs: [QUESTIONS()],
      compute: ({ questions }) => {
        const parsed = parseQuestions(questions);
        return { table: { columns: ["id", "type", "options or levels", "instruction words"],
          rows: Object.entries(parsed).map(([id, question]) => [id, describe(question.type ?? ""), optionCount(question), typeof question.instructions === "string" ? wordCount(question.instructions) : 0]) },
        note: `${plural(Object.keys(parsed).length, "question")}.` };
      } },
    { id: "label_values", kind: "tool", group: GROUP, title: "Allowed label values per question",
      help: "What a human label under _expect may be for each question: a Choice option key, true or false for a Noul, a level number for a Score, and four edges for a Box. A cheat sheet for whoever labels rows.",
      inputs: [QUESTIONS()],
      compute: ({ questions }) => ({ table: { columns: ["question", "type", "labels"],
        rows: Object.entries(parseQuestions(questions)).map(([id, question]) => [id, describe(question.type ?? ""), allowedLabels(question)]) } }) },
    { id: "questions_to_csv", kind: "tool", group: GROUP, title: "Questions to a CSV outline",
      help: "A questions object as a CSV outline with id, type, instructions, key and description columns: one row per Choice option, Score level or Noul criterion, so the wording can be reviewed in a spreadsheet. Text a spreadsheet would run as a formula gets a leading apostrophe.",
      inputs: [QUESTIONS()],
      compute: ({ questions }) => {
        const rows = outlineRows(parseQuestions(questions));
        return { text: formatDelimited([OUTLINE, ...rows], ","), note: `${plural(rows.length, "row")}.` };
      } },
    { id: "csv_to_questions", kind: "tool", group: GROUP, title: "CSV outline to questions",
      help: "Turns an outline with id, type, instructions, key and description columns (comma, tab, semicolon or pipe) back into a questions object, in first-seen order. Score keys may be blank (row order) or 0 to n−1; Noul keys are true or false. The apostrophe the CSV outline adds before text such as -, = or + is taken off again.",
      inputs: [{ name: "outline", label: "Outline table", type: "textarea", required: true }],
      compute: ({ outline }) => {
        const rows = parseDelimited(outline, sniffDelimiter(outline)).filter((row) => !(row.length === 1 && row[0].trim() === ""));
        if (!rows.length) throw new Error("Paste an outline with a header line.");
        const out = fromOutline(rows[0], rows.slice(1), true);
        return { text: pretty(out), note: `${plural(Object.keys(out).length, "question")}.` };
      } },
    { id: "questions_to_markdown", kind: "tool", group: GROUP, title: "Questions to a Markdown outline",
      help: "A questions object as a Markdown table with id, type, instructions, key and description columns, one row per option, level or criterion, for a review doc or ticket.",
      inputs: [QUESTIONS()],
      compute: ({ questions }) => ({ text: formatMarkdownTable(OUTLINE, outlineRows(parseQuestions(questions))) }) },
    { id: "markdown_to_questions", kind: "tool", group: GROUP, title: "Markdown outline to questions",
      help: "Turns a Markdown outline table (id, type, instructions, key, description) back into a questions object, with <br> read as a line break.",
      inputs: [{ name: "markdown", label: "Markdown outline", type: "textarea", required: true }],
      compute: ({ markdown }) => {
        const parsed = parseMarkdownTable(markdown);
        if (!parsed) throw new Error("This is not a Markdown table: every line needs pipes, and a header line comes first.");
        return { text: pretty(fromOutline(parsed.columns, parsed.rows.map((row) => row.map((cell) => cell.replace(/<br\s*\/?>/gi, "\n"))))) };
      } },
    { id: "rename_question", kind: "tool", group: GROUP, title: "Rename a question id",
      help: "Renames one question in a questions object, keeping its place in the request. Labels under _expect in rows keep the old id until you rename them too.",
      inputs: [QUESTIONS(), { name: "from", label: "Current id", type: "text", required: true }, { name: "to", label: "New id", type: "text", required: true }],
      compute: ({ questions, from, to }) => {
        const parsed = parseQuestions(questions);
        const [old, next] = [from.trim(), questionId(to)];
        if (!hasOwn(parsed, old)) throw new Error(`No question has the id ${old}.`);
        if (old === next) throw new Error("The new id is the same as the current one.");
        if (hasOwn(parsed, next)) throw new Error(`A question already has the id ${next}.`);
        const out = {};
        for (const id of Object.keys(parsed)) setOwn(out, id === old ? next : id, parsed[id]);
        return { text: pretty(out), note: "Rename this question's labels in your rows too." };
      } },
    { id: "compare_questions", kind: "tool", group: GROUP, title: "Compare two question sets",
      help: "What changed between two questions objects, question by question: added and removed questions, type and instruction changes, Choice options added, removed, reworded or reordered, Score levels added or reworded, and questions that moved among the ones both sets share.",
      inputs: [QUESTIONS("before", "Before"), QUESTIONS("after", "After")],
      compute: ({ before, after }) => {
        const a = parseQuestions(before, "Before"), b = parseQuestions(after, "After");
        const rows = [];
        const commonA = Object.keys(a).filter((id) => hasOwn(b, id)), commonB = Object.keys(b).filter((id) => hasOwn(a, id));
        let changed = 0;
        for (const id of Object.keys(b)) {
          if (!hasOwn(a, id)) { rows.push([id, `added (${describe(b[id].type ?? "")})`]); continue; }
          const changes = [];
          if (stableStringify(a[id].type ?? null) !== stableStringify(b[id].type ?? null)) changes.push(`type ${describe(a[id].type ?? "")} → ${describe(b[id].type ?? "")}`);
          if (stableStringify(a[id].instructions ?? null) !== stableStringify(b[id].instructions ?? null)) changes.push("instructions changed");
          changes.push(...criteriaChanges(a[id], b[id]));
          if (commonA.indexOf(id) !== commonB.indexOf(id)) changes.push(`position among shared questions ${commonA.indexOf(id) + 1} → ${commonB.indexOf(id) + 1}`);
          if (changes.length) changed += 1;
          for (const change of changes) rows.push([id, change]);
        }
        const removed = Object.keys(a).filter((id) => !hasOwn(b, id));
        for (const id of removed) rows.push([id, "removed"]);
        return { rows: [["Added", Object.keys(b).length - commonB.length], ["Removed", removed.length], ["Changed", changed], ["Unchanged", commonB.length - changed]],
          table: { columns: ["question", "change"], rows } };
      } },
    { id: "pick_questions", kind: "tool", group: GROUP, title: "Keep or drop some questions",
      help: "A questions object with only the listed ids (separated by commas or lines), or without them, keeping request order. Useful for a smaller, cheaper request.",
      inputs: [QUESTIONS(), { name: "ids", label: "Question ids", type: "textarea", required: true }, { name: "exclude", label: "Leave the listed questions out instead", type: "checkbox" }],
      compute: ({ questions, ids, exclude }) => {
        const parsed = parseQuestions(questions);
        const listed = listIds(ids);
        const unknown = listed.filter((id) => !hasOwn(parsed, id));
        if (unknown.length) throw new Error(`No question has the id ${unknown.join(", ")}.`);
        const out = {};
        for (const id of Object.keys(parsed)) if (listed.includes(id) !== exclude) setOwn(out, id, parsed[id]);
        if (!Object.keys(out).length) throw new Error("No question would be left.");
        return { text: pretty(out), note: `${Object.keys(out).length} of ${plural(Object.keys(parsed).length, "question")}.` };
      } },
    { id: "combine_questions", kind: "tool", group: GROUP, title: "Combine two question sets into one request",
      help: "Joins two questions objects into one, the way Autopilot merges Shield's and Dispatch's questions: each set's ids can get a prefix (such as shield.), and ids that would clash are refused.",
      inputs: [QUESTIONS("first", "First questions"), QUESTIONS("second", "Second questions"),
        { name: "firstPrefix", label: "Prefix for the first set's ids", type: "text" }, { name: "secondPrefix", label: "Prefix for the second set's ids", type: "text" }],
      compute: ({ first, second, firstPrefix, secondPrefix }) => {
        const out = {}, clashes = [];
        for (const [set, prefix] of [[parseQuestions(first, "The first questions object"), firstPrefix.trim()], [parseQuestions(second, "The second questions object"), secondPrefix.trim()]]) {
          for (const [id, question] of Object.entries(set)) {
            const key = `${prefix}${id}`;
            if (hasOwn(out, key)) clashes.push(key); else setOwn(out, key, question);
          }
        }
        if (clashes.length) throw new Error(`These ids would clash: ${clashes.join(", ")}. Give one set a prefix.`);
        const count = Object.keys(out).length;
        return { text: pretty(out), note: `${plural(count, "question")}.${count > MAX_QUESTIONS ? ` The Workbench runs at most ${MAX_QUESTIONS} per request.` : ""}` };
      } },

    // ---------- JSON ----------
    { id: "pretty_json", kind: "tool", group: GROUP, title: "Pretty-print JSON",
      help: "Indents JSON text for reading, keeping key order. Warns when a key is written twice, since JSON keeps only its last value.",
      inputs: [JSON_IN(), { name: "indent", label: "Indent", type: "select", options: [["2", "2 spaces"], ["4", "4 spaces"], ["tab", "Tab"]], default: "2" }],
      compute: ({ json, indent }) => {
        const repeated = duplicateKeys(json) || [];
        return { text: JSON.stringify(parseJson(json), null, indent === "tab" ? "\t" : Number(indent)),
          note: repeated.length ? `Written twice, so only the last value is kept: ${repeated.join(", ")}.` : null };
      } },
    { id: "minify_json", kind: "tool", group: GROUP, title: "Minify JSON",
      help: "JSON text on one line with no spaces, keeping key order, for a row or a request body, with the size before and after in UTF-8 bytes.",
      inputs: [JSON_IN()],
      compute: ({ json }) => {
        const text = JSON.stringify(parseJson(json));
        return { text, note: `${utf8Bytes(json)} bytes became ${utf8Bytes(text)}.` };
      } },
    { id: "sort_json_keys", kind: "tool", group: GROUP, title: "Sort JSON keys",
      help: "Sorts the keys of every object at every level, so two documents that differ only in key order look the same. Arrays keep their order. Key order matters in questions objects and Choice options.",
      inputs: [JSON_IN()],
      compute: ({ json }) => ({ text: pretty(sortKeys(parseJson(json))), note: "Question order and Choice option order follow key order: do not send a sorted questions object unless that order does not matter." }) },
    { id: "duplicate_keys", kind: "tool", group: GROUP, title: "Find keys written twice",
      help: "Finds object keys written more than once in JSON text, which JSON.parse accepts silently by keeping only the last value, with each one's path.",
      inputs: [JSON_IN()],
      compute: ({ json }) => {
        const paths = duplicateKeys(json);
        if (paths === null) parseJson(json);
        return { rows: [["Keys written twice", paths.length]], table: { columns: ["path"], rows: paths.map((path) => [path]) } };
      } },
    { id: "diff_json", kind: "tool", group: GROUP, title: "Compare two JSON values by path",
      help: "Every difference between two JSON values, by path: added, removed and changed nodes, with object keys compared in any order and arrays position by position.",
      inputs: [JSON_IN("before", "Before"), JSON_IN("after", "After")],
      compute: ({ before, after }) => {
        const changes = diffValues(parseJson(before, "Before"), parseJson(after, "After"));
        const shown = (value) => (value === undefined ? "" : JSON.stringify(value));
        return { rows: [["Differences", changes.length]],
          table: { columns: ["path", "change", "before", "after"], rows: changes.map((change) => [change.path || "(root)", change.kind, shown(change.before), shown(change.after)]) } };
      } },
    { id: "flatten_json", kind: "tool", group: GROUP, title: "Flatten JSON to paths",
      help: "A JSON value as one flat object from each leaf's path (a.b[0]) to its value; empty objects and arrays stay as leaves so the value can be rebuilt.",
      inputs: [JSON_IN()],
      compute: ({ json }) => {
        const flat = flatten(parseJson(json));
        return { text: pretty(flat), note: `${plural(Object.keys(flat).length, "leaf", "leaves")}.` };
      } },
    { id: "unflatten_json", kind: "tool", group: GROUP, title: "Unflatten paths to JSON",
      help: "Rebuilds nested JSON from a flat object of paths (a.b[0], [\"my key\"].x) to values: the reverse of flattening.",
      inputs: [JSON_IN("json", "Flat JSON object of path to value")],
      compute: ({ json }) => {
        const flat = parseJson(json);
        if (!isRecord(flat)) throw new Error("Paste a JSON object whose keys are paths.");
        const bad = Object.keys(flat).find((path) => parsePath(path) === null);
        if (bad !== undefined) throw new Error(`Not a path: ${bad}`);
        return { text: pretty(unflatten(flat)) };
      } },
    { id: "value_at_path", kind: "tool", group: GROUP, title: "Value at a path",
      help: "The value at one path in a JSON document, such as department.criteria.billing or rows[2].text; a blank path is the whole document.",
      inputs: [JSON_IN(), { name: "path", label: "Path (blank for the whole document)", type: "text", placeholder: "a.b[0]" }],
      compute: ({ json, path }) => {
        const value = parseJson(json), where = path.trim();
        if (parsePath(where) === null) throw new Error(`Not a path: ${where}`);
        const found = getPath(value, where);
        if (found === undefined) throw new Error(`Nothing at ${where}.`);
        return { text: pretty(found), note: `A${typeName(found) === "array" || typeName(found) === "object" ? "n" : ""} ${typeName(found)}.` };
      } },
    { id: "list_paths", kind: "tool", group: GROUP, title: "List every path",
      help: "Every leaf of a JSON document with its path, type and value (shortened past 60 characters), in document order.",
      inputs: [JSON_IN()],
      compute: ({ json }) => {
        const value = parseJson(json);
        return { table: { columns: ["path", "type", "value"],
          rows: listPaths(value).map((path) => { const leaf = getPath(value, path); return [path || "(root)", typeName(leaf), truncate(JSON.stringify(leaf), 60)]; }) } };
      } },
    { id: "set_path", kind: "tool", group: GROUP, title: "Set a value at a path",
      help: "A copy of a JSON document with the value at one path set, creating missing objects and arrays on the way. The value is JSON (\"text\", 3, true, {…}) unless you mark it as plain text.",
      inputs: [JSON_IN(), { name: "path", label: "Path (blank for the whole document)", type: "text" }, { name: "value", label: "New value", type: "textarea", required: true },
        { name: "plain", label: "Treat the value as plain text", type: "checkbox" }],
      compute: ({ json, path, value, plain }) => {
        const doc = parseJson(json), where = path.trim();
        if (parsePath(where) === null) throw new Error(`Not a path: ${where}`);
        const next = plain ? value : parseJson(value, "The new value");
        return { text: pretty(setPath(doc, where, next)), note: getPath(doc, where) === undefined ? `Created ${where}.` : `Replaced ${where || "the whole document"}.` };
      } },
    { id: "json_shape", kind: "tool", group: GROUP, title: "JSON size and shape",
      help: "How big and how deep a JSON value is: characters and UTF-8 bytes as compact JSON, nesting depth, leaves and object keys, and its length as the server measures a state (Python's json.dumps) against the 120,000-character limit.",
      inputs: [JSON_IN()],
      compute: ({ json }) => {
        const value = parseJson(json);
        let keys = 0;
        walk(value, (_path, node) => { if (isRecord(node)) keys += Object.keys(node).length; });
        const server = pyDumps(value).length;
        return { rows: [["Type", typeName(value)], ["Characters as compact JSON", Array.from(JSON.stringify(value)).length], ["UTF-8 bytes as compact JSON", utf8Bytes(JSON.stringify(value))],
          ["Depth", depth(value)], ["Leaves", countLeaves(value)], ["Object keys", keys], ["Characters as the server counts a state", server],
          ["Within the 120,000-character state limit", server <= STATE_LIMIT ? "yes" : "no"]],
        note: "The server count escapes non-ASCII characters and puts a space after every comma and colon. A number written like 1.0 counts as 1." };
      } },
    { id: "merge_json", kind: "tool", group: GROUP, title: "Merge two JSON objects",
      help: "Merges a second JSON object over a first, key by key at every level, for example to apply overrides to a state. Arrays and other values from the second replace the first's.",
      inputs: [JSON_IN("base", "Base"), JSON_IN("overlay", "Overrides")],
      compute: ({ base, overlay }) => ({ text: pretty(mergeDeep(parseJson(base, "Base"), parseJson(overlay, "Overrides"))) }) },
    { id: "escape_string", kind: "tool", group: GROUP, title: "Escape text as a JSON string",
      help: "Text as a JSON string literal, with quotes, backslashes, line breaks and control characters escaped, ready to paste into a state or a row. Optionally escapes every non-ASCII character or leaves out the outer quotes.",
      inputs: [{ name: "text", label: "Text", type: "textarea", required: true }, { name: "ascii", label: "Escape every non-ASCII character", type: "checkbox" },
        { name: "bare", label: "Leave out the outer quotes", type: "checkbox" }],
      compute: ({ text, ascii, bare }) => {
        const literal = ascii ? asciiJson(text) : JSON.stringify(text);
        return { text: bare ? literal.slice(1, -1) : literal };
      } },
    { id: "unescape_string", kind: "tool", group: GROUP, title: "Unescape a JSON string",
      help: "The text a JSON string literal stands for, with \\n, \\\" and \\u escapes decoded. The outer quotes are optional.",
      inputs: [{ name: "literal", label: "JSON string", type: "textarea", required: true, placeholder: "\"Line one\\nLine two\"" }],
      compute: ({ literal }) => {
        const trimmed = literal.trim();
        const quoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2 ? trimmed : `"${trimmed}"`;
        let value;
        try { value = JSON.parse(quoted); } catch { throw new Error("This is not a valid JSON string: check for unescaped quotes, backslashes or line breaks."); }
        return { text: value };
      } },
    { id: "key_values_to_json", kind: "tool", group: GROUP, title: "Key-value lines to a state object",
      help: "Lines of key: value (or key = value) as a JSON object for a request's state. Blank lines and lines starting with # are skipped, a value in double quotes is read as a JSON string, and the other values stay text unless you read them as JSON.",
      inputs: [{ name: "text", label: "Key-value lines", type: "textarea", required: true, placeholder: "customer: Ada Example\norder: A-1041\nnote: arrived damaged" },
        { name: "typed", label: "Read numbers, true, false, null, objects and arrays as JSON", type: "checkbox" }],
      compute: ({ text, typed }) => {
        const out = {}, lines = new Map();
        text.split(/\r\n|\r|\n/).forEach((raw, index) => {
          const line = raw.trim();
          if (!line || line.startsWith("#")) return;
          const at = line.search(/[:=]/);
          if (at === -1) throw new Error(`Line ${index + 1} has no : or =.`);
          const key = line.slice(0, at).trim();
          if (!key) throw new Error(`Line ${index + 1} has no key.`);
          if (lines.has(key)) throw new Error(`${key} is given twice (lines ${lines.get(key)} and ${index + 1}).`);
          lines.set(key, index + 1);
          const rest = line.slice(at + 1).trim();
          const quoted = decodeQuoted(rest);
          setOwn(out, key, quoted !== undefined ? quoted : typed ? typedValue(rest) : rest);
        });
        if (!Object.keys(out).length) throw new Error("No key-value lines found.");
        return { text: pretty(out), note: `${plural(Object.keys(out).length, "field")}.` };
      } },
    { id: "json_to_key_values", kind: "tool", group: GROUP, title: "State object to key-value lines",
      help: "A JSON object as key: value lines for quick editing. Text that would read back as something else (blank, edge spaces, line breaks, numbers, true/false/null) is written as a quoted JSON string; other values are written as JSON.",
      inputs: [JSON_IN("json", "JSON object")],
      compute: ({ json }) => {
        const value = parseJson(json);
        if (!isRecord(value)) throw new Error("Paste a JSON object.");
        const lines = Object.entries(value).map(([key, item]) => {
          if (!key.trim() || key !== key.trim() || /[:=\r\n]/.test(key) || key.startsWith("#")) throw new Error(`The key ${JSON.stringify(key)} cannot be written as a key-value line.`);
          return `${key}: ${typeof item === "string" ? (needsQuotes(item) ? JSON.stringify(item) : item) : JSON.stringify(item)}`;
        });
        if (!lines.length) throw new Error("The object has no keys.");
        return { text: lines.join("\n"), note: "Read it back with JSON values on to keep numbers, true/false, null, objects and arrays." };
      } },
  ],
});
