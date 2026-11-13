// Lab surface of the Workbench Tests tab (static/js/workbench-tests.js): the saved tests, each joined with the latest
// result of the user's own run in this page session. Pure code: it imports only the kit and the page's own pure
// selection module, touches no DOM, storage or network, and is tested in Node (tests/js/lab/surface-wb-tests.test.mjs).
// Fixture for pack tests: tests/js/lab/fixtures/workbench-tests.mjs (sampleTestsItemsCtx). Starter pack:
// static/js/lab/packs/workbench/tests-triage.js. This header is the CONTRACT for packs on this surface.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.tests.items"  —  builder testsItemsCtx(source)  —  "Saved tests · data/workbench/"
// ---------------------------------------------------------------------------------------------------------------
// The list is every saved test (one JSON file under data/workbench/ each) in SAVED ORDER (the server lists files by
// name). The page builds ONE ctx for the page session; items(), shown() and every data field read the page at call
// time, so never keep a copy across renders. data/workbench/ ships empty: every test and every result here is the
// user's own.
//
// The list is READ-ONLY. There is no replaceItems and no importItems, so Edits (transform) and Paste to import
// (importer) do not render here: a saved test is a file that only Build's "Save as test" writes (with server
// validation), and a result is the record of a paid call the user made. Kinds this surface hosts: fact, diagnostic,
// metric, exporter, command, panel (and behavior).
//
// items()   every saved test in saved order, as frozen plain objects (see ITEM). The same raw test with the same
//           latest result gives the same item object, so compare by identity or by id.
// shown()   the tests the page shows now, in display order: after EVERY page filter (search, exclude, status, type,
//           counts, measurements, selection, ... the 47 settings of the Tests tab) and Lab's filters, sorted by the
//           page's sort and then by Lab's sort when one is set (Lab's sort applies last; ties keep the page's order).
//           "Select visible", "Copy visible test IDs", the visible downloads and the visible schema all use exactly
//           this list, so a Lab filter counts like any other filter there. Facts must not call shown() (it runs the
//           filters, which run the facts).
// itemName(item) is the test id. refresh() re-renders the whole Tests tab (rows, counts and this section).
//
// ITEM  one saved test (deeply frozen; every value JSON-serializable):
//   id             string   the saved id ([a-z0-9-], at most 60 characters for files the server wrote). Unique.
//   name           string   the saved name; the id when the file has none
//   position       integer  1-based position in saved order
//   notes          string   the saved notes ("" when none; the server cuts notes to 2,000 characters)
//   saved_at       string | null   "YYYY-MM-DDTHH:MM:SSZ" (UTC) as saved; it is rewritten on every save, so it means
//                           "last saved". null when the file has none.
//   saved_ms       number | null   saved_at as epoch milliseconds; null when missing or unreadable
//   state          string | object | array | null   the authored input, a copy. AUTHORED TEXT (see boundaries).
//   state_kind     "text" | "object" | "array" | "other"   (the page's "input shape"; "other" for null/numbers)
//   questions      [{ id, type, instructions, criteria, expect }] in authored order; [] when the file holds no
//                  readable question object.
//                    id            string   the question id
//                    type          "noul" | "choice" | "score" | "box", or whatever odd string the file holds ("" if none)
//                    instructions  string   as authored; structured instructions are given as JSON text; "" if none
//                    criteria      [{ key, text }]   Choice: option key and description in authored order. Score: one
//                                  per level, key "0", "1", … Noul: "true"/"false" entries when authored. Box: [].
//                                  A description that is not a string is JSON text ("" for null).
//                    expect        object | null   the human expectation for this question, a copy of the file's
//                                  expect[id] exactly ({} stays {}); null when the test has none for it. Shapes the
//                                  server checks: { choice?: key, min?: number, max?: number } (Choice: min/max bound
//                                  the probability of the chosen option; Noul: P(yes); Score: the score),
//                                  { box: { left, top, right, bottom }, iou_min?: number (default 0.5) }.
//                                  These are HUMAN LABELS (see boundaries).
//   expect         object   the file's whole expect map, a copy ({} when none), orphans included
//   orphan_expectations  string[]   expect ids that name no question (a run always fails them)
//   images         [{ ref, sample, file }]   picture references: sample name or stored file name (the other null)
//   status         "pass" | "fail" | "error" | "not-run"   of the latest current result, as the page's badge shows
//   result         null until the user runs this test in this page session, and again when the test changed or was
//                  deleted since its run, or after "Clear session results". Otherwise the LATEST run only:
//     { ok           boolean   every checked question passed and the call succeeded
//       error        string | null   the call's error text (status "error"); null after a successful call
//       meta         null for an error, else { model, latency_ms, question_count, input_tokens, output_tokens,
//                    cost_usd, backend }, each null when the server sent none. cost_usd and the tokens are MEASURED.
//       elapsed_ms   number | null   server time for the test, including loading its saved pictures
//       has_trace    boolean   whether Inspect JSON has a request/response for it (actions.inspect)
//       checks       [{ id, question, ok, checks, type, value, confidence, answer }] one per id the server reported,
//                    in its order (questions, then orphan expectation ids, then extra answers):
//                      id          string   question id
//                      question    boolean  the id is a question of this test (false for an orphan expectation)
//                      ok          true (passed) | false (failed, missing answer, orphan, invalid) | null (no expectation)
//                      checks      string[] the server's check text: "choice = x", "0.93 ≥ 0.70", "IoU 0.62 ≥ 0.50",
//                                  "no expectation", "missing answer", ... Recompute from answer + expect rather than
//                                  parse it; it is answer- and label-bearing text.
//                      type        the answer's type, or null when there is no answer
//                      value       Choice: the chosen key (string). Score: the score (0..levels-1). Noul: P(yes) (0..1).
//                                  Box or no answer: null.
//                      confidence  number | null   the answer's confidence (Choice, Score, Box); null for Noul
//                      answer      object | null   the raw answer: choice { type, choice, probabilities, confidence },
//                                  score { type, score, legend, probabilities, confidence }, noul { type, noul },
//                                  box { type, box: { left, top, right, bottom }, confidence }
//     }
//
// DATA  ctx.data is computed at every read and frozen; read it when needed.
//   results        null until the first completed run of this page session (and after Clear session results), else
//                  { batches, last_count, cost_usd, wall_ms, passed, failed, errors, unrun }: paid batches so far,
//                  tests in the last batch, MEASURED spend and wall time of every completed batch (reruns included;
//                  they never shrink when results are dropped), and the current status counts over all saved tests.
//   selected       string[]  selected test ids in saved order ([] when none). Hidden tests can be selected.
//   can_undo_selection  boolean  the page's one-step "Undo selection change" is available
//   busy           boolean   a spend preview or paid run is in progress (selection and runs are locked)
//   tab            string    the Workbench tab shown now ("tests" when this surface is on screen)
//   editing_id     string | null   the saved test currently loaded in Build, if any
//   filters        object    the page's own filter settings as typed (strings), plus query (the search box)
//   filters_active integer   page settings that differ from their defaults (the sort included; the search box counts
//                            once). Lab's own filters are not counted here.
//   sort           string    the page's sort key ("saved" is saved order)
//   budget         null until the page has loaded its status, else { budget_usd, spent_usd, reserved_usd,
//                  remaining_usd } (numbers or null) from the server's SpendGuard: the process budget, not an estimate
//   model          string | null   the configured default model
//   limits         { max_questions: 100, max_choice_options: 255, max_score_levels: 25, max_state_chars: 120000,
//                    max_pictures_per_request: 4, max_saved_pictures: 20, max_id_chars: 60, max_notes_chars: 2000 }
//                  the server's limits (jev/workbench.py, jev/images.py), for advisory checks
//   now            number    epoch milliseconds at the time of the read (the clock for age facts)
//
// ACTIONS  the page's own operations. Each throws an Error with a message for the user when its guard refuses. Call
// them only from a command or a control the user just pressed, one call per press, never from a fact, metric, check
// or render.
//   select(ids, mode = "add")  changes the SELECTION ONLY: mode "add" | "remove" | "replace". Unknown ids are ignored;
//                  hidden tests are kept, as with every selection tool of the page. Records the page's one-step Undo.
//                  Guards: refuses while busy; refuses a mode it does not know and an ids value that is not an array;
//                  "add"/"remove" refuse when no id is a saved test ("replace" with [] clears the selection).
//                  Returns the new selection (ids in saved order).
//   undoSelection() the page's "Undo selection change". Guards: refuses while busy and when there is nothing to undo.
//   open(id)       the row's "Open": loads the test into Build (Build asks before replacing unsaved work).
//                  Guard: the id must be a saved test. Returns the page's promise.
//   inspect(id)    opens the Inspect JSON drawer on the latest call of that test. Guards: the id must be a saved test
//                  with a current result that has a trace.
//   resetFilters() the page's "Reset test filters": every page filter and the search back to defaults, and Lab's
//                  filters and sort cleared. Selection and results are kept. No guard.
// There is no action that runs a test, saves, renames, deletes or edits a test, clears results, or replays an answer,
// and a pack must not add one. NO ACTION ON THIS SURFACE CALLS THE MODEL OR SPENDS BUDGET: paid runs stay the page's
// own Run buttons (with their spend preview), and no action presses them.
//
// INVARIANTS  Items and data are frozen copies; the page's own objects are never handed out, so nothing a pack does
// can change a saved test, its JSON snapshot, the spend-preview snapshot or a session result. Filters never change
// the selection or the scope of Run all; Lab filters and sorts are presentation only.
//
// CONTENT BOUNDARIES (AGENTS.md: saved-test metadata, question inventories, no canned answers)
//   - Every result, answer, check text, measurement and the session totals come from paid calls the CURRENT USER made
//     in this page session. Show them as they are, never store them, never fill a gap with a guess, and never show
//     anything as answered before the user ran it. Unknown stays unknown: a fact returns null, a metric null.
//   - FACTS land in the Lab facts table and its CSV. A fact may return counts, measurements, numbers derived from the
//     user's own answers (confidence, margins, tokens), flags, and categories from a fixed vocabulary (question
//     types, statuses, expectation kinds, model ids). It must NEVER return authored text verbatim (state,
//     instructions, criteria, notes), expectation values (expected option keys, bounds, boxes), answer values
//     (chosen options) or check/error text.
//   - EXPORTS hold what their label says. IDs, names, counts, statuses and measured latency/spend may appear freely.
//     An export that holds answers, check or error text, expectation values, notes, state or instructions must be a
//     separately named copy/download that says so in its label and help; never an importable "results" format, and
//     never under the name of the page's metadata or inventory downloads (whose allowlists are fixed: metadata =
//     id, name, questions, expectations, pictures, status, latency_ms, cost_usd; inventory = id, tests,
//     withExpectations, types). Traces and requests are not exported here. CSV goes through csvText/csvCell.
//   - METRICS over results are measurements of this session's latest calls (summed latency is not wall time; a
//     projection is labeled as one). Spend estimates come only from the page's spend preview, never from a pack.
//   - Checks and flags about expectations are advisory and never repair anything.
//
// The ctx also carries `page` ({ matches(rawTest), arrange(rawTests) }): the page's own hook into Lab's filters and
// sort, used by test-selection.js visibleTests. It is not part of the pack contract; packs never call it.
import { clone } from "../kit.js";
import { selectedTestIds, testResultStatus } from "../../test-selection.js";

const TESTS_LIMITS = Object.freeze({ max_questions: 100, max_choice_options: 255, max_score_levels: 25, max_state_chars: 120000,
  max_pictures_per_request: 4, max_saved_pictures: 20, max_id_chars: 60, max_notes_chars: 2000 });
const SAVED_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const integer = (value) => (Number.isInteger(value) ? value : null);
const textOr = (value, fallback = null) => (typeof value === "string" && value !== "" ? value : fallback);
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : (JSON.stringify(value) ?? ""));
const copy = (value) => {
  try { return value === undefined ? null : clone(value); } catch { return null; }
};

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A source field: a value, or a function that returns the value now.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function criteriaOf(type, question) {
  const criteria = question.criteria;
  if (Array.isArray(criteria)) return criteria.map((text, index) => ({ key: String(index), text: asText(text) }));
  if (isObject(criteria) && type !== "box") return Object.entries(criteria).map(([key, text]) => ({ key, text: asText(text) }));
  return [];
}

function questionsOf(raw, expect) {
  if (!isObject(raw.questions)) return [];
  return Object.entries(raw.questions).map(([id, question]) => {
    const q = isObject(question) ? question : {};
    const type = typeof q.type === "string" ? q.type : "";
    return { id, type, instructions: asText(q.instructions), criteria: criteriaOf(type, q),
      expect: Object.hasOwn(expect, id) ? copy(expect[id]) : null };
  });
}

function savedMs(text) {
  const match = typeof text === "string" ? SAVED_AT.exec(text) : null;
  if (!match) return null;
  const [, y, mo, d, hh, mm, ss] = match.map(Number);
  const ms = Date.UTC(y, mo - 1, d, hh, mm, ss);
  const back = new Date(ms);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && hh < 24 && mm < 60 && ss < 60 ? ms : null;
}

function answerValue(answer) {
  if (!isObject(answer)) return null;
  if (answer.type === "choice") return typeof answer.choice === "string" ? answer.choice : null;
  if (answer.type === "score") return finite(answer.score);
  if (answer.type === "noul") return finite(answer.noul);
  return null;
}

function resultOf(run, questionIds) {
  if (!isObject(run)) return null;
  const meta = isObject(run.meta) && !run.error ? run.meta : null;
  const results = isObject(run.results) ? run.results : {};
  return {
    ok: run.ok === true,
    error: run.error ? asText(run.error) : null,
    meta: meta ? { model: textOr(meta.model), latency_ms: finite(meta.latency_ms), question_count: integer(meta.question_count),
      input_tokens: integer(meta.input_tokens), output_tokens: integer(meta.output_tokens), cost_usd: finite(meta.cost_usd),
      backend: textOr(meta.backend) } : null,
    elapsed_ms: finite(run.elapsed_ms),
    has_trace: isObject(run.trace),
    checks: Object.entries(results).map(([id, verdict]) => {
      const v = isObject(verdict) ? verdict : {};
      const answer = isObject(v.answer) ? copy(v.answer) : null;
      return { id, question: questionIds.has(id), ok: v.ok === true ? true : v.ok === false ? false : null,
        checks: Array.isArray(v.checks) ? v.checks.map(asText) : [],
        type: answer && typeof answer.type === "string" ? answer.type : null,
        value: answerValue(answer), confidence: answer && answer.type !== "noul" ? finite(answer.confidence) : null, answer };
    }),
  };
}

// One saved test (and its latest current run) as the frozen item packs read.
function testItem(raw, index, run) {
  const expect = isObject(raw.expect) ? raw.expect : {};
  const questions = questionsOf(raw, expect);
  const ids = new Set(questions.map((question) => question.id));
  const state = raw.state === undefined ? null : copy(raw.state);
  const id = asText(raw.id);
  return deepFreeze({
    id,
    name: textOr(raw.name, id),
    position: index + 1,
    notes: typeof raw.notes === "string" ? raw.notes : "",
    saved_at: textOr(raw.saved_at),
    saved_ms: savedMs(raw.saved_at),
    state,
    state_kind: typeof state === "string" ? "text" : Array.isArray(state) ? "array" : isObject(state) ? "object" : "other",
    questions,
    expect: copy(expect) || {},
    orphan_expectations: Object.keys(expect).filter((key) => !ids.has(key)),
    images: Object.entries(isObject(raw.images) ? raw.images : {}).map(([ref, entry]) => ({ ref,
      sample: isObject(entry) ? textOr(entry.sample) : null, file: isObject(entry) ? textOr(entry.file) : null })),
    status: testResultStatus(run),
    result: resultOf(run, ids),
  });
}

function sessionOf(results) {
  if (!isObject(results)) return null;
  const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
  return { batches: count(results.batches), last_count: count(results.last_count), cost_usd: finite(results.cost_usd) ?? 0,
    wall_ms: finite(results.wall_ms) ?? 0, passed: count(results.passed), failed: count(results.failed), errors: count(results.errors),
    unrun: count(results.unrun) };
}

function budgetOf(status) {
  const spend = isObject(status) && isObject(status.spend) ? status.spend : null;
  if (!spend) return null;
  const budget = finite(spend.budget_usd), spent = finite(spend.spent_usd), reserved = finite(spend.reserved_usd);
  return { budget_usd: budget, spent_usd: spent, reserved_usd: reserved,
    remaining_usd: budget === null || spent === null ? null : Math.max(0, budget - spent - (reserved ?? 0)) };
}

// source: {
//   items()            the page's saved tests (W.items), raw
//   results()          the page's session results (W.runResults) or null
//   shown()            the raw saved tests the page shows now, after every page filter AND Lab's (the page passes
//                      ctx.page to visibleTests), in display order
//   matches(item, ctx), arrange(items, ctx)    the Lab hooks: LAB.matches / LAB.arrange for "workbench.tests.items"
//   selected(), canUndoSelection(), busy(), filters(), defaults(), sort(), tab(), editingId(), status(), now()
//   setSelection(ids)  record the one-step undo, set the selection, render
//   undoSelection(), open(rawTest), inspect(trace, title), resetFilters(), refresh()   (none calls the model)
// }
export function testsItemsCtx(source = {}) {
  const cache = new WeakMap();
  // One lookup per (saved list, session results) pair: the page asks for every row's item many times per render.
  let memo = null;
  const lookup = () => {
    const list = read(source, "items", []);
    const results = read(source, "results", null);
    const length = Array.isArray(list) ? list.length : -1;
    if (memo && memo.list === list && memo.length === length && memo.results === results) return memo.value;
    const raws = Array.isArray(list) ? list.filter(isObject) : [];
    const runs = new Map((isObject(results) && Array.isArray(results.runs) ? results.runs : []).filter(isObject).map((run) => [run.id, run]));
    const position = new Map(raws.map((raw, index) => [raw, index]));
    // The same raw test, position and run give the same item object.
    const of = (raw) => {
      const index = position.has(raw) ? position.get(raw) : raws.length;
      const run = runs.get(raw.id);
      const known = cache.get(raw);
      if (known && known.index === index && known.run === run) return known.item;
      const item = testItem(raw, index, run);
      cache.set(raw, { index, run, item });
      return item;
    };
    memo = { list, length, results, value: { raws, runs, of } };
    return memo.value;
  };
  const rawItems = () => lookup().raws;
  const runsById = () => lookup().runs;
  const items = () => {
    const { raws, of } = lookup();
    return raws.map(of);
  };
  const busy = () => read(source, "busy", false) === true;
  const notBusy = () => { if (busy()) throw new Error("Wait for the current spend check or run to finish."); };
  const rawById = (id) => {
    const raw = rawItems().find((entry) => entry.id === id);
    if (typeof id !== "string" || !raw) throw new Error(`There is no saved test “${String(id)}”.`);
    return raw;
  };
  const knownIds = (ids) => {
    if (!Array.isArray(ids)) throw new Error("Give a list of saved test IDs.");
    return selectedTestIds(rawItems(), ids.filter((id) => typeof id === "string"));
  };
  const call = (name, ...args) => {
    if (typeof source[name] !== "function") throw new Error("The Tests tab cannot do that here.");
    return source[name](...args);
  };

  const ctx = {
    items,
    shown() {
      const list = read(source, "shown", null);
      const { of } = lookup();
      return (Array.isArray(list) ? list : rawItems()).filter(isObject).map(of);
    },
    get data() {
      const filters = read(source, "filters", {});
      const defaults = read(source, "defaults", {});
      const typed = {};
      for (const [key, value] of Object.entries(isObject(filters) ? filters : {})) {
        if (typeof value === "string" || typeof value === "number") typed[key] = String(value);
      }
      let active = 0;
      for (const [key, value] of Object.entries(typed)) {
        if (key === "query") { if (value.trim()) active++; } else if (isObject(defaults) && Object.hasOwn(defaults, key) && String(defaults[key]) !== value) active++;
      }
      const status = read(source, "status", null);
      const now = finite(read(source, "now", null));
      return deepFreeze({
        results: sessionOf(read(source, "results", null)),
        selected: selectedTestIds(rawItems(), Array.isArray(read(source, "selected", [])) ? read(source, "selected", []) : []),
        can_undo_selection: read(source, "canUndoSelection", false) === true,
        busy: busy(),
        tab: asText(read(source, "tab", "")),
        editing_id: textOr(read(source, "editingId", null)),
        filters: typed,
        filters_active: active,
        sort: textOr(typed.sort, "saved"),
        budget: budgetOf(status),
        model: isObject(status) ? textOr(status.model) : null,
        limits: TESTS_LIMITS,
        now: now === null ? Date.now() : now,
      });
    },
    actions: {
      select(ids, mode = "add") {
        notBusy();
        if (!["add", "remove", "replace"].includes(mode)) throw new Error(`Unknown selection change “${String(mode)}”.`);
        const known = knownIds(ids);
        if (mode !== "replace" && !known.length) throw new Error("None of those IDs is a saved test. The selection is unchanged.");
        const raws = rawItems();
        const current = selectedTestIds(raws, Array.isArray(read(source, "selected", [])) ? read(source, "selected", []) : []);
        const drop = new Set(known);
        const next = mode === "replace" ? known : mode === "add" ? selectedTestIds(raws, [...current, ...known]) : current.filter((id) => !drop.has(id));
        call("setSelection", next);
        return next;
      },
      undoSelection() {
        notBusy();
        if (read(source, "canUndoSelection", false) !== true) throw new Error("There is no selection change to undo.");
        return call("undoSelection");
      },
      open(id) {
        return call("open", rawById(id));
      },
      inspect(id) {
        const raw = rawById(id);
        const run = runsById().get(id);
        if (!isObject(run) || !isObject(run.trace)) throw new Error(`Test “${id}” has no call to inspect in this session.`);
        return call("inspect", run.trace, `Test · ${raw.name || id}`);
      },
      resetFilters() {
        return call("resetFilters");
      },
    },
    refresh() { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item) => (item && typeof item.id === "string" ? item.id : "?"),
    // The page's hook (not for packs): Lab's filters and sort on the page's raw saved tests.
    page: {
      matches(raw) {
        if (typeof source.matches !== "function" || !isObject(raw)) return true;
        return source.matches(lookup().of(raw), ctx) !== false;
      },
      arrange(raws) {
        if (typeof source.arrange !== "function" || !Array.isArray(raws)) return raws;
        const { of } = lookup();
        const pairs = new Map();
        const list = raws.map((raw) => {
          const item = isObject(raw) ? of(raw) : raw;
          pairs.set(item, raw);
          return item;
        });
        const arranged = source.arrange(list, ctx);
        if (!Array.isArray(arranged) || arranged.length !== raws.length || !arranged.every((item) => pairs.has(item))) return raws;
        return arranged.map((item) => pairs.get(item));
      },
    },
  };
  return ctx;
}
