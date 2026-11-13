// Lab surfaces of the Workbench Build tab (static/js/workbench-build.js): the request editor's questions and the
// answers of the user's own latest Run. Pure code: it imports only the kit and the Build tab's pure request helpers,
// touches no DOM, storage or network, and is tested in Node (tests/js/lab/surface-wb-build.test.mjs). Fixtures for
// pack tests: tests/js/lab/fixtures/workbench-build.mjs (sampleBuildQuestionsCtx, sampleBuildResultCtx).
//
// ============================== CONTRACT FOR PACK AUTHORS ==============================
//
// Both ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) }, built ONCE per page
// session by the page (W.buildLabCtx), so every read is live. items() and shown() are evaluated at call time and
// return the SAME frozen item objects (compare by identity) while nothing they describe changed. Items and every
// data value are deeply frozen plain JSON: read them, never write to them, and read data when you need it rather
// than keeping a copy across renders.
//
// Facts, checks and Lab filters must not call ctx.shown(): the page runs Lab's filters while it computes what is
// shown, and a fact that asks for shown() gets items() there (no recursion, but no filtering either). Use items().
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.build.questions"  —  builder wbBuildQuestionsCtx(source)  —  the Build editor's question cards
// ---------------------------------------------------------------------------------------------------------------
// The list is the request's questions in REQUEST ORDER, one item per editor card, including cards whose id is
// still blank (those are skipped when the request is sent) and cards whose ids or Choice keys repeat while the user
// is fixing them. items() is [] when the editor has no question. The page's ~35 question filters (search, type,
// with/without instructions/criteria/expectations, id prefix/suffix/exact, counts, flags, ...) and Lab's filters
// decide shown(); a card that holds the keyboard focus stays shown until focus leaves it, so typing is never
// interrupted. With a Lab sort the shown cards are DISPLAYED in that order (shown() returns that order), but the
// request order, Run, Check, Export, drafts, Save and every "shown" handoff keep request order. Filters are
// presentation only: Run and export always include every question, and the page says so.
// Raw JSON mode replaces the cards with a text box; the Lab section is not rendered then and data.rawMode is true.
// Kinds this surface hosts: fact, diagnostic, transform, metric, exporter, importer, command, tool, panel (behavior).
//
// Item (one question card). STORED fields (enumerable: what Lab's copies, snapshots, Edits and Undo see):
//   ref           string   the card's reference for this page session ("q1", "q2", …): stable while the card exists,
//                          whatever its position or content. It is what ties an edited item back to its card in
//                          replaceItems: keep it on an edited item, leave it out on a new one. Never shown to people.
//   id            string   the id exactly as typed (may have edge spaces, may be "")
//   type          string   "noul" | "choice" | "score" | "box"
//   instructions  string   the instructions as typed. Text that parses as a JSON object or array is sent as
//                          structure (see structured); everything else is sent as the text.
//   choice        [[key, description], ...]   every Choice row as typed, blank placeholders included. EVERY card keeps
//   score         [level, ...]                every Score level as typed, in order (level i means score i)
//   noulYes       string                      what a yes means, as typed ("" when not set)
//   noulNo        string                      what a no means, as typed
//                 All four criteria fields exist on every item whatever its type; only the type's own fields are
//                 ACTIVE (sent). A Box takes no criteria.
//   expectation   object | null   the human expectation saved for the trimmed id ({ choice?, min?, max?, box?,
//                          iou_min? }), null when there is none or the id is blank. It follows its card through
//                          renames; replaceItems ignores changes to it.
// Read-only FACTS (non-enumerable: present on the items items() and shown() return, but NOT on the copies a transform
// receives, nor in snapshots or JSON, so a transform must work from the stored fields, e.g. id.trim() for qid):
//   position      number   1-based position in request order
//   qid           string   the id the request uses: id trimmed. "" when blank. Answers, expectations and the
//                          checks' "question" field are keyed by it. Compared trimmed and case-sensitive.
//   structured    boolean  instructions (trimmed) start with { or [ and parse as JSON
//   criteria      [{ key, text }]   the ACTIVE criteria as the request sends them, in order: Choice rows with a
//                          non-blank key (key and description trimmed); Score levels that are not blank, keyed "0",
//                          "1", ... in sent order (blank levels are dropped before numbering, as the request does);
//                          Noul "true"/"false" for a yes/no text that is set; Box [].
// itemName(item) is the qid, or "question <position>" for a card without an id.
// One-step Undo of a Lab edit works when every edited item keeps its ref and the edit adds no card (an item without a
// ref gets a fresh one, so Undo then refuses, safely, as "the list changed").
//
// data (live getters, frozen):
//   state        { text, kind, value, error }   the state editor: text exactly as typed; kind "text" (plain text,
//                blank, or text that is not valid JSON — all sent as text), "object" or "array" (valid JSON, value is
//                the parsed value), or "invalid" (valid JSON that repeats a key: every outbound action refuses it
//                and error says why). value is null unless kind is "object" or "array".
//   images       [{ ref, sample, name, format }]   the attached pictures in order (at most limits.images): ref is the
//                reference the state or a question names ("photo-0a1b2c3d4e"), sample a sample drawing's name or
//                null, name an upload's file name or null, format "png" | "jpg" | null. Never bytes or URLs.
//   expect       { [qid]: expectation }   every human expectation the editor holds, including ones whose question
//                was renamed by typing (they wait for their id to come back and are dropped on Save). {} when none.
//   answers      { [qid]: answer } | null   the answers of the CURRENT USER'S latest Run in this page session (the
//                same raw shapes as workbench.build.result's item.answer). null before the first Run of the loaded
//                request, after loading another request, and after adding or removing a picture.
//   stale        boolean   answers exist but the request changed since that Run (the page shows "These answers are
//                from the previous request"). A pack that shows an answer next to a question must say so when stale.
//   running      boolean   a Run is in flight
//   rawMode      boolean   the Raw JSON box replaces the editor cards
//   rawPending   boolean   Raw JSON has edits that are not applied: every edit, handoff and outbound action refuses
//   editorError  string | null   the editor's validation message (a repeated id or Choice key), else null
//   lint         null | { findings, counts, guide, lab }   the last Question checks report (POST /api/workbench/lint,
//                plain code, no model call) for the request as it was then; null before Check questions and after any
//                edit. findings: [{ level: "problem" | "advice", code, question: qid | null (null = the state),
//                message, guide }]; counts: { problem, advice } of those; lab: the Python packs' extra advisory
//                findings { findings: [same shape, code "<pack>/<feature>"], counts } or null.
//   limits       { questions: 100, choiceOptions: 255, scoreLevels: 25, minScoreLevels: 2, images, stateChars: 120000 }
//                the server's request limits (jev/workbench.py, jev/images.py)
//   origin       { example, test, handoff }   where the request came from: a built-in example id, the saved test id
//                being edited, or the demo name it was opened from (Open in Workbench); each null when not.
//
// actions (each throws an Error with a message for the user when its guard refuses; call them only from a command,
// an Apply or a control the user just pressed, never from a fact, metric, check or render):
//   replaceItems(next, { label })   Replaces the whole question list through the page's edit path (markBuildEdited
//                then a render), exactly like the page's own cleanup Apply. Guards and invariants:
//                - refuses while Raw JSON has unapplied edits;
//                - next is an array of at most 100 objects, each with type noul/choice/score/box; id, instructions,
//                  noulYes, noulNo strings; choice an array of [key, description] string pairs; score an array of
//                  strings (a missing criteria field takes the editor's blank default); at most 255 named Choice
//                  options and 25 defined Score levels on a question of that type;
//                - question ids and Choice keys stay unique (trimmed, case-sensitive) — the editor's own check;
//                - an item whose ref names an existing card is that card edited (the first such item; later copies are
//                  new cards). Its expectation moves with it when its id changes, and the move is refused when another
//                  expectation already uses the new id or the new id is blank. A card that owns an expectation may
//                  not be dropped (its own Remove button keeps an Undo). A new card never receives an expectation: its
//                  id may not be one that already has one. Order is free: cards may move.
//                Only ref, id, type, instructions, choice, score, noulYes and noulNo are read; expectation and the
//                facts are ignored. Unchanged cards keep their object identity and their collapsed state; changed
//                cards keep their card's collapsed state. Answers from the changed request are marked outdated by the
//                page, and question checks and code export are cleared. The page re-renders right after the call.
//   importItems(items, { label })   Appends new questions after the last card through the same edit path. Every
//                imported question needs a non-blank id that no card uses and that has no expectation; the shape
//                rules and the 100-question limit above apply. Imported questions carry no expectations; a ref on
//                them is ignored.
//   addQuestion(type)  Adds one blank card of that type with a fresh unique id, as the "Add <type>" chips do.
//                Guards: Raw JSON pending, unknown type, 100 questions.
//   focus(target)  Scrolls to a card and focuses its id box. target is a qid (string) or a position (number).
//                Guards: the card exists and is shown now (not hidden by a page or Lab filter).
//   checkQuestions()  Presses Check questions: POST /api/workbench/lint, plain code, NO model call, no cost.
//                Guards: Raw JSON pending, editorError, no question with an id, invalid state (the page also toasts).
//   exportCode()  Presses Export code (POST /api/workbench/export, no model call). Same guards.
//   formatState() / compactState()   The State panel's Format JSON / Compact JSON (plain text stays unchanged;
//                compact keeps every literal). Guard: state kind "invalid".
//   undoRemove()  The "Undo remove" button. Guard: a removed question is waiting (the page refuses a reused id).
//   clearFilters()  The "Clear question filters" button: clears the page's question filters AND Lab's filters/sort.
// There is no action that runs the model on this surface (Run is on workbench.build.result).
//
// refresh() re-applies the filters to the cards and re-orders them for a Lab sort without re-rendering the page,
// so focus and typing survive.
//
// Content boundaries for workbench.build.questions:
//   - Exports of questions are AUTHORED-QUESTION handoffs: ids, types, instructions and criteria only — never state,
//     pictures, expectations or answers. Outlines and diagnostics hold ids, types, positions, counts and flags only.
//     Anything that includes state, expectations or answers is a separately labelled handoff whose label says so.
//     CSV goes through csvText/csvCell (formula escaping); Markdown fences authored text (any run of backticks).
//   - Exports refuse while data.rawPending ("Apply the Raw JSON edits before sharing editor questions."), and a
//     "shown" export with nothing shown refuses instead of falling back to every question.
//   - Facts and checks inspect authored fields (active criteria only, unless they say otherwise) and are advisory
//     hints, never model-quality judgments. Do not repeat the page's filters or the Question checks
//     (jev/lint.py: missing_path, several_questions, long_instructions, undescribed_option, same_options,
//     mixed_option_fields, same_levels, noul_criteria, same_question, fields_in_text).
//   - Anything read from data.answers is an answer of the user's own Run in this page session: label it as such, and
//     as outdated when data.stale. Never keep it beyond the page, never present it as an answer to the edited request.
//   - Counts are counts (characters, bytes, criteria), never spend estimates. Never send, write or invent model-facing
//     wording: an edit may move, trim, rename or reshape what the user wrote, but a pack ships no instructions or
//     option text of its own (leave new text blank).
//   - Score level order IS the numeric meaning: an edit that moves, inserts or removes levels must say so in its
//     label or help. Choice sorts keep each key with its description.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.build.result"  —  builder wbBuildResultCtx(source)  —  the Answers panel after Run
// ---------------------------------------------------------------------------------------------------------------
// The list is the answers of the CURRENT USER'S latest Run of the Build request in this page session, one item per
// answered question in the response's order (the request order). items() is [] before the first Run, after another
// request is loaded and after a picture is added or removed. A new Run replaces every item. The page has no filter
// of its own, so shown() is items() after Lab's filters and Lab's sort; the page shows exactly those answer cards in
// that order, with "x of y answers shown" and a reset while a Lab setting is active. Read-only: answers are model
// output, so there is no replaceItems or importItems (no Edits, no Paste to import).
// Kinds this surface hosts: fact, diagnostic, metric, exporter, command, tool, panel (behavior).
//
// Item (one answer):
//   id            string   the question id (qid). Unique. itemName() returns it.
//   position      number   1-based position in the response's answer order
//   type          string   "choice" | "score" | "noul" | "box" as the response says
//   instructions  string   the instructions as SENT (a structured instruction is given as JSON text); "" if none
//   criteria      [{ key, text }]   the criteria as sent: Choice options (key, description; a description sent as
//                          null reads ""), Score levels keyed "0", "1", … (the answer's legend when the sent question
//                          has none), Noul "true"/"false" when sent, Box []
//   value         string | number | null   Choice: the chosen key. Score: the score (a float from 0 to scale). Noul:
//                          P(yes) from 0 to 1. Box or a missing/odd value: null.
//   display       string   what the card prints: Choice "making request" (underscores as spaces), Score "1.62 / 2",
//                          Noul "97.0%", Box "40% × 20%" (width × height); "" when nothing usable
//   scale         number | null   Score only: the highest level index (levels - 1)
//   probabilities [{ key, p }]   Choice: one per option the response listed, in response order; Score: one per level
//                          ("0", "1", …); Noul: [{ key: "yes", p }, { key: "no", p: 1 - p }] (a plain subtraction:
//                          compare with a tolerance); Box: []. Entries whose p is not a finite number are left out.
//   top           { key, p } | null   the most likely entry of probabilities (the first one on a tie)
//   confidence    number | null   the answer's own confidence. Noul answers carry none: null.
//   box           { left, top, right, bottom } | null   Box only: fractions of the picture's width and height
//   expectation   object | null   the human expectation the editor holds NOW for this id (it may have been edited
//                          after the Run); null when none
//   answer        object   the raw answer exactly as the server returned it (a frozen copy)
//
// data (live getters, frozen):
//   meta         { model, latency_ms, question_count, input_tokens, output_tokens, cost_usd, backend } | null —
//                the server's MEASUREMENTS of that one Run (every field may be missing). cost_usd is measured, not
//                an estimate. null before a Run.
//   request      { state, model, questions } | null   exactly what that Run sent (pictures as references only)
//   pictures     [{ ref, sample, name, format }]   the pictures attached at Run time, never bytes
//   stale        boolean   the request changed since the Run (the page shows the outdated banner; Save is disabled)
//   running      boolean   a Run is in flight (its answers replace these when they arrive)
//   expect       { [qid]: expectation }   the editor's human expectations now
//   currentIds   [qid, ...]   the editor's non-blank question ids now, in request order (an answer whose id is not
//                here belongs to a question that was renamed or removed since the Run)
//   saveOpen     boolean   the "Save as a test" form is open
//
// actions (each throws an Error with a message for the user when its guard refuses). NO ACTION ON THIS SURFACE CALLS
// THE MODEL OR SPENDS BUDGET: only the user's own press of the Run button runs the request, and no action presses it.
//   inspect()      Opens Inspect JSON on the Run's exact request and response. Guard: a Run exists.
//   openSave()     Opens the "Save as a test" form (expectations default from the answers, as the button does).
//                  Guards: a Run exists and is not stale.
//   focusQuestion(id)   Scrolls to that question's editor card. Guards: a card has this id now and is shown.
// refresh() re-renders the answer cards from shown().
//
// Content boundaries for workbench.build.result:
//   - Every item is an answer the current user requested in this page session. A pack may show, measure, compare and
//     export those. Never show a made-up, sample, remembered or predicted answer, never keep answers beyond the page
//     session (no storage, no files written by the pack), and say "outdated" whenever data.stale.
//   - Exports that hold answers, probabilities or meta say so in their label or help. An export described as a
//     request or a handoff carries state, model and questions only, never answers (AGENTS.md's handoff rule).
//   - A rule a pack applies to probabilities (a margin, a threshold, "would go to review", "meets the expectation")
//     is plain local code: advisory, labeled as such, and never worded as the model's answer. Expectation checks
//     mirror jev/workbench.py check_expectation and say they are local.
//   - Metrics over meta are measurements of this Run. A projection (per thousand calls) is arithmetic on a measured
//     Run and says so; it is never shown as spend.
import { clone } from "../kit.js";
import { editorQuestionError, parseBuildState } from "../../build-request.js";

const TYPES = Object.freeze(["noul", "choice", "score", "box"]);
const LIMITS = { questions: 100, choiceOptions: 255, scoreLevels: 25, minScoreLevels: 2, stateChars: 120000 };
const EMPTY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => isObject(object) && Object.prototype.hasOwnProperty.call(object, key);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value) ?? "");
const percent = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Sets an own property, even "__proto__" (question ids such as __proto__ must work).
function setOwn(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
}

// A source field: a value, or a function that returns the value now.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("The Build tab cannot do that here.");
  return source[name](...args);
}

function structuredText(text) {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try { const value = JSON.parse(trimmed); return !!value && typeof value === "object"; } catch { return false; }
}

const pictureOf = (image) => ({ ref: str(image.ref), sample: typeof image.sample === "string" ? image.sample : null,
  name: typeof image.name === "string" ? image.name : null,
  format: image.format === "png" || image.format === "jpg" ? image.format : image.sample ? "png" : null });
const picturesOf = (list) => (Array.isArray(list) ? list.filter(isObject).map(pictureOf) : []);

// ---------- workbench.build.questions ----------

function activeCriteria(type, choice, score, noulYes, noulNo) {
  if (type === "choice") return choice.filter(([key]) => key.trim()).map(([key, text]) => ({ key: key.trim(), text: text.trim() }));
  if (type === "score") return score.filter((level) => level.trim()).map((level, index) => ({ key: String(index), text: level.trim() }));
  if (type === "noul") return [["true", noulYes], ["false", noulNo]].filter(([, text]) => text.trim()).map(([key, text]) => ({ key, text: text.trim() }));
  return [];
}

function questionItem(row, index, expect, ref) {
  const id = str(row.id);
  const qid = id.trim();
  const type = str(row.type);
  const instructions = str(row.instructions);
  const choice = Array.isArray(row.choice) ? row.choice.map((pair) => [str(Array.isArray(pair) ? pair[0] : ""), str(Array.isArray(pair) ? pair[1] : "")]) : [];
  const score = Array.isArray(row.score) ? row.score.map(str) : [];
  const noulYes = str(row.noulYes), noulNo = str(row.noulNo);
  const item = { ref, id, type, instructions, choice, score, noulYes, noulNo, expectation: qid && hasOwn(expect, qid) ? clone(expect[qid]) : null };
  const facts = { position: index + 1, qid, structured: structuredText(instructions), criteria: activeCriteria(type, choice, score, noulYes, noulNo) };
  for (const [name, value] of Object.entries(facts)) Object.defineProperty(item, name, { value: deepFreeze(value), enumerable: false });
  return deepFreeze(item);
}

// One editable row from an item a pack returned: only the editor's own fields, checked and copied.
function editableRow(raw, where, limits) {
  if (!isObject(raw)) throw new Error(`${where} is not a question object.`);
  if (!TYPES.includes(raw.type)) throw new Error(`${where}: the type must be noul, choice, score or box.`);
  const text = (name) => {
    const value = raw[name];
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new Error(`${where}: ${name} must be text.`);
    return value;
  };
  let choice = [["", ""], ["", ""]], score = ["", "", ""];
  if (raw.choice !== undefined && raw.choice !== null) {
    if (!Array.isArray(raw.choice) || !raw.choice.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === "string"))) {
      throw new Error(`${where}: choice must be a list of [key, description] text pairs.`);
    }
    choice = raw.choice.map(([key, description]) => [key, description]);
  }
  if (raw.score !== undefined && raw.score !== null) {
    if (!Array.isArray(raw.score) || !raw.score.every((level) => typeof level === "string")) throw new Error(`${where}: score must be a list of level texts.`);
    score = raw.score.slice();
  }
  const row = { id: text("id"), type: raw.type, instructions: text("instructions"), choice, score, noulYes: text("noulYes"), noulNo: text("noulNo") };
  const name = row.id.trim() || where;
  if (row.type === "choice" && choice.filter(([key]) => key.trim()).length > limits.choiceOptions) throw new Error(`${name}: a Choice question takes at most ${limits.choiceOptions} options.`);
  if (row.type === "score" && score.filter((level) => level.trim()).length > limits.scoreLevels) throw new Error(`${name}: a Score question takes at most ${limits.scoreLevels} levels.`);
  return row;
}

// The editor fields of an existing row, for telling an unchanged row from an edited one.
const projection = (row) => JSON.stringify([str(row.id), str(row.type), str(row.instructions), Array.isArray(row.choice) ? row.choice : [],
  Array.isArray(row.score) ? row.score : [], str(row.noulYes), str(row.noulNo)]);

// The next rows and expectations for replaceItems; throws an Error a person can act on. Pure. refOf(row) gives a
// current row's card reference; the plan's refs[i] is the reference the i-th next row keeps (null: a fresh one).
function planReplace(rows, expect, next, limits, refOf) {
  if (!Array.isArray(next)) throw new Error("The edit returned no question list.");
  if (next.length > limits.questions) throw new Error(`A request takes at most ${limits.questions} questions.`);
  const byRef = new Map();
  rows.forEach((row, index) => { const ref = refOf(row); if (!byRef.has(ref)) byRef.set(ref, index); });
  const origins = [], refs = [];
  const claimed = new Set();
  const nextRows = next.map((raw, index) => {
    const row = editableRow(raw, `Question ${index + 1}`, limits);
    const ref = isObject(raw) && typeof raw.ref === "string" && raw.ref ? raw.ref : null;
    // A ref of a current card names that card (its first item); a ref no card has is kept (a card an Undo restores).
    const origin = ref !== null && byRef.has(ref) && !claimed.has(ref) ? byRef.get(ref) : null;
    const keep = ref !== null && !claimed.has(ref) && (origin !== null || !byRef.has(ref)) ? ref : null;
    if (keep !== null) claimed.add(keep);
    origins.push(origin);
    refs.push(keep);
    return origin !== null && projection(rows[origin]) === projection(row) ? rows[origin] : row;
  });
  const error = editorQuestionError(nextRows);
  if (error) throw new Error(error);
  // Who owns an expectation now: the first card with that id. Expectations no card owns stay as they are.
  const owner = new Map();
  rows.forEach((row, index) => { const qid = str(row.id).trim(); if (qid && !owner.has(qid)) owner.set(qid, index); });
  const nextExpect = {};
  const holder = new Map();
  for (const key of Object.keys(expect || {})) if (!owner.has(key)) { setOwn(nextExpect, key, clone(expect[key])); holder.set(key, null); }
  for (const [qid, from] of owner) {
    if (!hasOwn(expect, qid)) continue;
    const at = origins.indexOf(from);
    if (at < 0) throw new Error(`Question “${qid}” has human expectations. Remove it with its own Remove button, which keeps an Undo.`);
    const moved = nextRows[at].id.trim();
    if (!moved) throw new Error(`Question “${qid}” has human expectations, so it needs an id.`);
    if (hasOwn(nextExpect, moved)) throw new Error(`Expectations already exist for “${moved}”. Keep or remove them before renaming “${qid}”.`);
    setOwn(nextExpect, moved, clone(expect[qid]));
    holder.set(moved, at);
  }
  nextRows.forEach((row, index) => {
    const qid = row.id.trim();
    if (qid && holder.has(qid) && holder.get(qid) !== index) throw new Error(`Expectations already exist for “${qid}”. A new or renamed question cannot take them over.`);
  });
  return { rows: nextRows, expect: nextExpect, origins: origins.map((origin) => (origin === null ? null : rows[origin])), refs };
}

function planImport(rows, expect, items, limits) {
  if (!Array.isArray(items) || !items.length) throw new Error("There is nothing to import.");
  if (rows.length + items.length > limits.questions) throw new Error(`A request takes at most ${limits.questions} questions; ${rows.length} are already in the editor.`);
  const added = items.map((raw, index) => {
    const row = editableRow(raw, `Imported question ${index + 1}`, limits);
    const qid = row.id.trim();
    if (!qid) throw new Error(`Imported question ${index + 1} needs an id.`);
    if (rows.some((other) => str(other.id).trim() === qid)) throw new Error(`Question id “${qid}” is already in the editor. Rename it before importing.`);
    if (hasOwn(expect, qid)) throw new Error(`Expectations already exist for “${qid}”. Imported questions cannot take them over.`);
    return row;
  });
  const next = [...rows, ...added];
  const error = editorQuestionError(next);
  if (error) throw new Error(error);
  return { rows: next, expect, origins: [...rows, ...added.map(() => null)], refs: next.map(() => null) };
}

function stateView(text) {
  let value;
  try { value = parseBuildState(text); } catch (error) { return { text, kind: "invalid", value: null, error: String(error.message || error) }; }
  if (value && typeof value === "object") return { text, kind: Array.isArray(value) ? "array" : "object", value, error: null };
  return { text, kind: "text", value: null, error: null };
}

// source: {
//   rows()        W.questions (the live editor rows)        expect()      W.expect
//   stateText()   W.stateText                               images()      W.images
//   result()      W.result                                  stale()       buildResultStale()
//   running()     a Run is in flight                        rawMode()     W.raw
//   rawPending()  Raw JSON has unapplied edits              lint()        W.lint
//   maxImages()   W.maxImages                               origin()      { example, test, handoff }
//   shownRows()   the rows the page shows now (its filters AND Lab's), in request order
//   arrange(items, ctx)   LAB.arrange for this surface
//   matches(item, ctx)    LAB.matches, used only when shownRows is missing
//   commit({ rows, expect, origins, label })   the page's edit path: set the rows and expectations, carry the
//                 collapsed state from origins[i] (the old row an entry came from, or null), markBuildEdited(), render()
//   addQuestion(type), focus(index0), checkQuestions(), exportCode(), formatState(), compactState(),
//   canUndoRemove(), undoRemove(), clearFilters(), refresh()   the page's own operations
// }
export function wbBuildQuestionsCtx(source = {}) {
  const cache = new WeakMap();
  // Card references: one per row object for this page session. Reused row objects keep theirs; a commit hands the
  // new row objects the references their items carried.
  const refs = new WeakMap();
  const taken = new Set();
  let counter = 0;
  const fresh = () => { let ref; do ref = `q${++counter}`; while (taken.has(ref)); taken.add(ref); return ref; };
  const refOf = (row) => {
    if (!isObject(row)) return fresh();
    if (!refs.has(row)) refs.set(row, fresh());
    return refs.get(row);
  };
  let busy = false;
  let stateMemo = { text: null, view: null };
  let expectMemo = { key: null, value: EMPTY_OBJECT };
  let lintMemo = { raw: null, value: null };
  let answersMemo = { raw: null, value: null };
  const rowsOf = () => {
    const rows = read(source, "rows", EMPTY);
    return Array.isArray(rows) ? rows : EMPTY;
  };
  const expectOf = () => {
    const expect = read(source, "expect", EMPTY_OBJECT);
    return isObject(expect) ? expect : EMPTY_OBJECT;
  };
  const items = () => {
    const expect = expectOf();
    return rowsOf().map((raw, index) => {
      const row = isObject(raw) ? raw : {};
      const qid = str(row.id).trim();
      const key = JSON.stringify([index, row, qid && hasOwn(expect, qid) ? expect[qid] : null]);
      const known = isObject(raw) ? cache.get(raw) : undefined;
      if (known && known.key === key) return known.item;
      const item = questionItem(row, index, expect, refOf(raw));
      if (isObject(raw)) cache.set(raw, { key, item });
      return item;
    });
  };
  const limits = () => ({ ...LIMITS, images: Number.isInteger(read(source, "maxImages", 4)) ? read(source, "maxImages", 4) : 4 });
  const rawPending = () => read(source, "rawPending", false) === true;
  const refuseRaw = (what) => { if (rawPending()) throw new Error(`Apply the Raw JSON edits before ${what}.`); };
  const stateKind = () => ctx.data.state.kind;
  const outbound = () => {
    refuseRaw("using this request");
    if (stateKind() === "invalid") throw new Error(`State: ${ctx.data.state.error}`);
    const error = editorQuestionError(rowsOf());
    if (error) throw new Error(error);
    if (!rowsOf().some((row) => str(row?.id).trim())) throw new Error("Add at least one question with an id.");
  };
  const commit = (plan, label) => {
    plan.rows.forEach((row, index) => {
      if (refs.has(row)) return;  // an unchanged card keeps its reference
      const ref = plan.refs[index];
      if (ref !== null) taken.add(ref);
      refs.set(row, ref !== null ? ref : fresh());
    });
    return call(source, "commit", { rows: plan.rows, expect: plan.expect, origins: plan.origins, label: str(label) || "Lab edit" });
  };

  const ctx = {
    items,
    shown() {
      if (busy) return items();
      busy = true;
      try {
        const list = items();
        const shownRows = read(source, "shownRows", null);
        let visible;
        if (Array.isArray(shownRows)) {
          const rows = rowsOf();
          const keep = new Set(shownRows);
          visible = list.filter((item) => keep.has(rows[item.position - 1]));
        } else visible = list.filter((item) => !source.matches || source.matches(item, ctx) !== false);
        const arranged = source.arrange ? source.arrange(visible, ctx) : visible;
        return Array.isArray(arranged) ? arranged : visible;
      } finally { busy = false; }
    },
    data: {
      get state() {
        const text = str(read(source, "stateText", ""));
        if (stateMemo.text !== text) stateMemo = { text, view: deepFreeze(clone(stateView(text))) };
        return stateMemo.view;
      },
      get images() { return deepFreeze(picturesOf(read(source, "images", EMPTY))); },
      get expect() {
        const expect = expectOf();
        const key = JSON.stringify(expect);
        if (expectMemo.key !== key) expectMemo = { key, value: deepFreeze(JSON.parse(key)) };
        return expectMemo.value;
      },
      get answers() {
        const result = read(source, "result", null);
        const raw = isObject(result) && isObject(result.answers) ? result.answers : null;
        if (answersMemo.raw !== raw) answersMemo = { raw, value: raw ? deepFreeze(clone(raw)) : null };
        return answersMemo.value;
      },
      get stale() { return !!read(source, "result", null) && read(source, "stale", false) === true; },
      get running() { return read(source, "running", false) === true; },
      get rawMode() { return read(source, "rawMode", false) === true; },
      get rawPending() { return rawPending(); },
      get editorError() { return editorQuestionError(rowsOf()); },
      get lint() {
        const raw = read(source, "lint", null);
        if (lintMemo.raw !== raw) {
          const report = isObject(raw) ? raw : null;
          lintMemo = { raw, value: report ? deepFreeze({ findings: Array.isArray(report.findings) ? clone(report.findings) : [],
            counts: isObject(report.counts) ? clone(report.counts) : { problem: 0, advice: 0 }, guide: str(report.guide),
            lab: isObject(report.lab) ? { findings: Array.isArray(report.lab.findings) ? clone(report.lab.findings) : [],
              counts: isObject(report.lab.counts) ? clone(report.lab.counts) : { problem: 0, advice: 0 } } : null }) : null };
        }
        return lintMemo.value;
      },
      get limits() { return deepFreeze(limits()); },
      get origin() {
        const origin = read(source, "origin", EMPTY_OBJECT);
        const text = (value) => (typeof value === "string" && value ? value : null);
        return deepFreeze({ example: text(origin.example), test: text(origin.test), handoff: text(origin.handoff) });
      },
    },
    actions: {
      replaceItems(next, { label } = {}) {
        refuseRaw("editing questions");
        return commit(planReplace(rowsOf(), expectOf(), next, limits(), refOf), label);
      },
      importItems(list, { label } = {}) {
        refuseRaw("adding questions");
        return commit(planImport(rowsOf(), expectOf(), list, limits()), label);
      },
      addQuestion(type) {
        refuseRaw("adding questions");
        if (!TYPES.includes(type)) throw new Error("Choose a question type: noul, choice, score or box.");
        if (rowsOf().length >= LIMITS.questions) throw new Error(`A request takes at most ${LIMITS.questions} questions.`);
        return call(source, "addQuestion", type);
      },
      focus(target) {
        const list = items();
        const item = typeof target === "number" ? list.find((entry) => entry.position === target)
          : list.find((entry) => entry.qid && entry.qid === str(target).trim());
        if (!item) throw new Error(`There is no question ${typeof target === "number" ? `at position ${target}` : `“${str(target)}”`}.`);
        if (!ctx.shown().includes(item)) throw new Error(`${item.qid || `Question ${item.position}`} is hidden by the question filters. Clear them to go to it.`);
        return call(source, "focus", item.position - 1);
      },
      checkQuestions() { outbound(); return call(source, "checkQuestions"); },
      exportCode() { outbound(); return call(source, "exportCode"); },
      formatState() {
        if (stateKind() === "invalid") throw new Error(`State: ${ctx.data.state.error}`);
        return call(source, "formatState");
      },
      compactState() {
        if (stateKind() === "invalid") throw new Error(`State: ${ctx.data.state.error}`);
        return call(source, "compactState");
      },
      undoRemove() {
        if (read(source, "canUndoRemove", false) !== true) throw new Error("No removed question is waiting to be restored.");
        return call(source, "undoRemove");
      },
      clearFilters: () => call(source, "clearFilters"),
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.qid === "string" && item.qid ? item.qid : `question ${item?.position ?? index + 1}`),
  };
  return ctx;
}

// ---------- workbench.build.result ----------

function resultCriteria(type, question, answer) {
  const criteria = isObject(question) ? question.criteria : undefined;
  if (type === "score") {
    if (Array.isArray(criteria)) return criteria.map((text, index) => ({ key: String(index), text: asText(text) }));
    return Object.entries(isObject(answer.legend) ? answer.legend : {}).map(([key, text]) => ({ key, text: asText(text) }));
  }
  if ((type === "choice" || type === "noul") && isObject(criteria)) return Object.entries(criteria).map(([key, text]) => ({ key, text: asText(text) }));
  return [];
}

function answerItem(id, answer, question, position, expect) {
  const type = typeof answer.type === "string" ? answer.type : "";
  let probabilities = [];
  if (type === "noul") {
    const yes = finite(answer.noul);
    probabilities = yes === null ? [] : [{ key: "yes", p: yes }, { key: "no", p: 1 - yes }];
  } else if (type === "choice" || type === "score") {
    probabilities = Object.entries(isObject(answer.probabilities) ? answer.probabilities : {}).flatMap(([key, p]) => (finite(p) === null ? [] : [{ key, p }]));
  }
  let box = null;
  if (type === "box" && isObject(answer.box)) {
    const edges = ["left", "top", "right", "bottom"].map((edge) => finite(answer.box[edge]));
    if (!edges.includes(null)) box = { left: edges[0], top: edges[1], right: edges[2], bottom: edges[3] };
  }
  const criteria = resultCriteria(type, question, answer);
  let value = null, display = "", scale = null;
  if (type === "choice") {
    value = answer.choice === null || answer.choice === undefined ? null : String(answer.choice);
    if (value !== null) display = value.replace(/_/g, " ");
  } else if (type === "score") {
    value = finite(answer.score);
    const levels = isObject(answer.legend) && Object.keys(answer.legend).length ? Object.keys(answer.legend).length : criteria.length;
    scale = levels ? levels - 1 : null;
    if (value !== null) display = scale === null ? value.toFixed(2) : `${value.toFixed(2)} / ${scale}`;
  } else if (type === "noul") {
    value = finite(answer.noul);
    if (value !== null) display = percent(value, 1);
  } else if (box) display = `${percent(box.right - box.left)} × ${percent(box.bottom - box.top)}`;
  let top = null;
  for (const entry of probabilities) if (!top || entry.p > top.p) top = entry;
  return deepFreeze({ id, position, type, instructions: isObject(question) ? asText(question.instructions) : "", criteria, value, display, scale,
    probabilities, top: top ? { ...top } : null, confidence: type === "noul" ? null : finite(answer.confidence), box,
    expectation: hasOwn(expect, id) ? clone(expect[id]) : null, answer: clone(answer) });
}

// source: {
//   result()   W.result: { answers, meta, trace: { request }, images } of the latest Run, or null
//   expect()   W.expect        stale()  buildResultStale()        running()  a Run is in flight
//   currentIds()   the editor's non-blank ids now          saveOpen()   W.saveOpen
//   matches(item, ctx), arrange(items, ctx)   LAB.matches / LAB.arrange for this surface
//   inspect(), openSave(), focusQuestion(id) -> false when the card is missing or hidden, refresh()
// }
export function wbBuildResultCtx(source = {}) {
  let built = { result: null, key: null, items: EMPTY };
  let viewMemo = { result: null, view: null };
  const result = () => {
    const raw = read(source, "result", null);
    return isObject(raw) && isObject(raw.answers) ? raw : null;
  };
  const expectOf = () => {
    const expect = read(source, "expect", EMPTY_OBJECT);
    return isObject(expect) ? expect : EMPTY_OBJECT;
  };
  const view = () => {
    const raw = result();
    if (!raw) return null;
    if (viewMemo.result !== raw) {
      const trace = isObject(raw.trace) ? raw.trace : {};
      const request = isObject(trace.request) ? trace.request : null;
      viewMemo = { result: raw, view: deepFreeze({
        meta: isObject(raw.meta) ? clone(raw.meta) : null,
        request: request ? clone({ state: request.state, model: request.model ?? null, questions: isObject(request.questions) ? request.questions : {} }) : null,
        pictures: picturesOf(raw.images),
      }) };
    }
    return viewMemo.view;
  };
  const items = () => {
    const raw = result();
    if (!raw) return EMPTY;
    const expect = expectOf();
    const ids = Object.keys(raw.answers);
    const key = JSON.stringify(ids.map((id) => (hasOwn(expect, id) ? expect[id] : null)));
    if (built.result !== raw || built.key !== key) {
      const questions = view().request?.questions || {};
      built = { result: raw, key, items: Object.freeze(Object.entries(raw.answers).filter(([, answer]) => isObject(answer))
        .map(([id, answer], index) => answerItem(id, answer, hasOwn(questions, id) ? questions[id] : null, index + 1, expect))) };
    }
    return built.items;
  };
  const ctx = {
    items,
    shown() {
      const list = items().filter((item) => !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: {
      get meta() { return view()?.meta ?? null; },
      get request() { return view()?.request ?? null; },
      get pictures() { return view()?.pictures ?? EMPTY; },
      get stale() { return !!result() && read(source, "stale", false) === true; },
      get running() { return read(source, "running", false) === true; },
      get expect() { return deepFreeze(JSON.parse(JSON.stringify(expectOf()))); },
      get currentIds() {
        const ids = read(source, "currentIds", EMPTY);
        return deepFreeze(Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : []);
      },
      get saveOpen() { return read(source, "saveOpen", false) === true; },
    },
    actions: {
      inspect() {
        if (!result()) throw new Error("Press Run first: there is no request to inspect yet.");
        return call(source, "inspect");
      },
      openSave() {
        if (!result()) throw new Error("Press Run first: a test saves the answers of a Run as expectations.");
        if (ctx.data.stale) throw new Error("Run the edited request before saving its expectations as a test.");
        return call(source, "openSave");
      },
      focusQuestion(id) {
        const qid = str(id).trim();
        if (!qid || !ctx.data.currentIds.includes(qid)) throw new Error(`No question in the editor has the id “${str(id)}” now.`);
        if (call(source, "focusQuestion", qid) === false) throw new Error(`${qid} is hidden by the question filters. Clear them to go to it.`);
        return true;
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1)),
  };
  return ctx;
}
