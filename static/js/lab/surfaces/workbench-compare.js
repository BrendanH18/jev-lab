// Lab surfaces of the Workbench Compare tab (static/js/workbench-compare.js): two variants, each a question set and a
// model, run over the Bulk rows, then scored one shared question at a time without further calls. Pure code: it
// imports the kit and the DOM-free variants.js only, and touches no DOM, storage or network. Tests:
// tests/js/lab/surface-wb-compare.test.mjs. Fixtures for pack tests: tests/js/lab/fixtures/workbench-compare.mjs
// (sampleCompareRowsCtx, sampleCompareVariantsCtx). This header is the CONTRACT for packs on these two surfaces.
//
// Both ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) }; the page builds them at
// render time and every field reads the page state when called, so read a value when you need it and keep nothing
// across renders. items() and shown() return the SAME frozen item objects (compare by identity) until the list itself
// changes. Items and data values are deeply frozen copies: read them, never write to them.
//
// Row numbering: a Compare row's `index` counts the TUNING rows the run sent (after the 200-row cap, with held-out
// test rows left out), from 0; the page prints index + 1 as "#". It is NOT the line number in the rows box when test
// rows come before it. Anything that names rows (an export, a finding, a command) must use this numbering and say so.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.compare.rows"  —  builder compareRowsCtx(source)  —  "Rows where A and B answer “qid” differently"
// ---------------------------------------------------------------------------------------------------------------
// The rows of the CURRENT USER'S OWN latest Compare run of this page session, for the question the report scores now
// (data.qid). items() holds every row of that run that at least one variant answered for that question, in run order
// (the same rows the page sends to its local scorer). It is [] before a run, while a run or a rescoring is in flight
// (no report yet), when the report failed (data.report_error), and when the variants share no question.
// The page's own filter: its table lists only the rows where the two variants pick differently (item.differs). So
// shown() is items() with differs === true, minus what a Lab filter hides, in Lab's sort order when one is set (run
// order otherwise); the table shows exactly shown(), and its heading count reads "shown of all" while a Lab filter or
// sort is active, with a "Show every disagreement" reset. With no Lab setting active the table is as before.
// Rows both variants agree on, and rows only one variant answered, are in items() and never in shown().
//
// Item (one compared row):
//   index     integer   0-based position among the tuning rows the run sent (see Row numbering). Unique.
//   number    integer   index + 1, as the table's "#" column prints it. itemName() returns "#<number>".
//   row       string | object | array   the row as written in the rows box (may carry "_image", a picture name).
//                       Never "_expect" or "_test": labels are in `label`, and test rows never reach a Compare run.
//   text      string    the row as the table prints it: a string row as is, an object { text } as its text, anything
//                       else as compact JSON
//   sent      [state | null, state | null]   per variant (A, B): the rewritten row that variant was sent when B's rows
//                       were rewritten (typos, lowercase, an unrelated sentence, shuffled fields); null when it was sent
//                       the row as written
//   label     any | null   the human label for data.qid from the row's "_expect" (string for Choice, true/false or text
//                       for Noul, a level number for Score, { left, top, right, bottom } for Box); null when unlabeled.
//                       A label that a variant cannot score (say, an option only the other offers) is still here; the
//                       report leaves it out of both sides (data.counts.excluded, data.scores[v].invalid).
//   answers   [answer | null, answer | null]   each variant's raw answer to data.qid, null when that call failed, was
//                       skipped by a stop, or holds no answer to it. Shapes: choice { type, choice, probabilities:
//                       { option: p }, confidence? }; noul { type, noul }; score { type, score?, probabilities:
//                       { level: p }, confidence? }; box { type, box: { left, top, right, bottom }, confidence }
//   picks     [string | null, string | null]   each answer as Calibrate shows it: Choice the option key, Noul "yes" or
//                       "no", Score the level as text ("2"), Box "0.10, 0.20, 0.50, 0.60" (left, top, right, bottom);
//                       null when there is no answer or it cannot be read
//   signals   [number | null, number | null]   each answer's gating signal (0..1) under data.signal: "confidence" is
//                       the answer's confidence (Choice/Score without one: how far the top probability sits above an
//                       even split; Noul: |2p - 1|; Box: its confidence); "top_probability" is the probability of the
//                       pick (Noul: max(p, 1 - p)). null when unreadable.
//   tops      [number | null, number | null]   the probability each answer gives its own pick (Box: its confidence)
//   correct   [boolean | null, boolean | null]   whether each pick matches the label, as the server scored it. Only
//                       for differing rows; null on every other row and wherever the label was not scored.
//   verdict   "both_right" | "a_only" | "b_only" | "both_wrong" | null   the server's verdict for a differing row
//                       (the table's result badge); null for unlabeled rows and for every row that does not differ
//   differs   boolean   the two variants pick differently (the server's list; exactly the rows the page's table lists)
//   paired    boolean   both variants answered this question on this row
//   orders    [[as listed, reversed] | null, ...]   for a variant asked in both option orders: its pick in each order
//                       for data.qid; null otherwise
//   meta      [meta | null, meta | null]   each call's measurements: { model, latency_ms, input_tokens,
//                       output_tokens, cost_usd, calls } (every field may be null; an averaged variant's meta sums both
//                       calls' tokens and cost and keeps the slower latency, calls = 2). Measured, never estimated.
//   errors    [string | null, string | null]   the failed call's message for each variant
//   skipped   [boolean, boolean]   the call was skipped because the run stopped (budget, rate limit)
// For differing rows picks and signals are the server's (what the table prints). For the others they come from a local
// read that mirrors jev/calibrate.read; on those rows the two picks are equal, or one side is missing.
//
// data (live getters; every value a frozen copy):
//   qid          string | null   the question the report scores (the page's question select); null before a run
//   type         "choice" | "noul" | "score" | "box" | null   its type; null while there is no report
//   signal       "confidence" | "top_probability"   the gating signal the report used
//   bound        "estimate" | "lower"   what must reach each automation target: these rows, or the 95% lower bound
//   first        "A" | "B"   the variant the cascade asks first
//   cascade_threshold  number 0..1 (step 0.01)   the cascade slider's value
//   questions    [question | null, question | null]   each variant's authored question data.qid as it was run
//   shared       string[]   question ids both variants ask with the same type, in A's order (the question select)
//   labeled      string[]   question ids that carry a label on at least one row of the run
//   variants     [] before a run, else two { name: "A"|"B", model (resolved for the run), perturb (null | "typos" |
//                "lowercase" | "distractor" | "shuffle"), average_orders, question_count, completed, errors, cost_usd,
//                input_tokens, latency_ms_median (null when none), perturbed_rows, unperturbed_rows }
//   scores       null without a report, else two { labeled, unlabeled, invalid: [{ index, reason }], correct,
//                accuracy, accuracy_low, accuracy_high (95% Wilson), ece, sweep: 101 × { threshold, automated, correct,
//                coverage, accuracy, low, high }, targets: [{ target, threshold, coverage, automated, accuracy, low,
//                high, needed, plan }] }, scored on the labeled rows BOTH variants answered (the same set for both)
//   paired       null | { both_right, a_only, b_only, both_wrong, rows, p_value }   p_value: exact McNemar, two-sided
//   counts       null | { answered_both, agree, disagree, only_a, only_b, excluded }
//   cascade      null | { first, second, rows, first_alone, second_alone, sweep: 101 × { threshold, escalated, share,
//                correct, accuracy, cost_usd, latency_ms }, match, best } (cost and latency null when usage is missing)
//   agreement    [] before a run, else [{ qid, type, answered, changed, rate, low, high, reordered, perturbed,
//                same_position?, options? }] for every shared question (the order or input check table)
//   orders       [] before a run, else two: null, or [{ qid, answered, changed, rate, low, high }] for a variant asked
//                in both option orders
//   run          null | { rows, labeled, held_out, wall_ms, cost_usd, stopped }   held_out counts the test rows the run
//                left out (never their content); stopped is the stop message or null
//   slices       null | { fields: [{ name, values }], field, paired_rows, slices: [...] }   Compare by slice, as fetched
//   slices_error, report_error   string | null
//   running      boolean   a paid run is in flight;   labeling   boolean   the labeling handoff is being prepared
//
// actions (each throws an Error with a message for the user when its guard refuses; call them only from a command or
// a control the user just pressed, never from a fact, metric, check or render):
//   selectQuestion(qid)   score another shared question: exactly the page's question select. One LOCAL scoring
//                         request (/api/workbench/compare/score and /slices), NO model call. Guard: a run exists, no run
//                         is in flight, qid is in data.shared. Returns the page's promise.
//   setSignal(signal)     gate on "confidence" or "top_probability" (the gate select); rescoring as above.
//   setBound(bound)       "estimate" or "lower" (the targets select); rescoring as above, the cascade keeps its threshold.
//   setFirst(name)        "A" or "B" asks first in the cascade (the order select); rescoring as above. Guard: a cascade.
//   setCascadeThreshold(t)  moves the cascade slider to t (rounded to 0.01). Guard: 0 <= t <= 1 and a cascade. No call.
//   labelDisagreements()  the page's "Label missing disagreement inputs": opens blank human-label controls in Bulk for
//                         EVERY disagreement of data.qid (never only the shown ones), after the page's own confirm, which
//                         warns that it replaces the rows editor and drafts. Carries inputs only, never answers. Guard:
//                         data.type is choice, noul or score, a row differs, and no handoff is in flight.
//   useInBuild(name)      the page's "Use A in Build" / "Use B in Build" with that variant's questions as run (Build's
//                         own guards apply). Guard: a run exists and name is "A" or "B".
// There is no replaceItems or importItems: these rows are model answers of the user's run, and no pack may edit,
// add or replay one. Edits (transform) and Paste to import (importer) do not render here.
//
// refresh() re-renders the table and its heading count; the Lab section and the rest of the report stay as they are.
// The page renders this surface's Lab section (below the table) only while the table is on screen, that is while a
// report exists for the selected question, so its commands are reachable from the palette only then.
//
// Content boundaries for workbench.compare.rows:
//   - Every answer, signal, verdict and measurement here comes from the run the current user made in this page session.
//     Show, measure and export them; never store them, never show them as another run's, never fill a gap with a guess.
//   - An export that holds answers, picks, signals or verdicts says so in its label or help ("your Compare run's
//     answers"), names the row numbering, uses csvText/csvCell for CSV, and is never offered as something to import.
//   - A labeling or Build handoff carries inputs and question configuration only, never answers or suggestions.
//   - Held-out test rows never appear: the run leaves them out. data.run.held_out is a count only.
//   - Statistics keep the page's wording: 95% Wilson intervals, exact McNemar, small samples are rarely conclusive,
//     slice and per-question comparisons are exploratory and unadjusted. A threshold or "would escalate" rule a pack
//     applies is plain local code and is labeled as advisory, never as the model's answer.
//   - Cost and latency are measured values of calls already made; a projection says it is one, never spend.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.compare.variants"  —  builder compareVariantsCtx(source)  —  "Variant A" / "Variant B" editors
// ---------------------------------------------------------------------------------------------------------------
// The questions of the two variant editors AS TYPED NOW (before any run), one item per question id: A's ids in A's
// order, then ids only B asks, in B's order. A variant whose JSON does not parse contributes nothing (its error is in
// data.variants[i].error). The page renders no per-question list of its own, so shown() is items() minus what a Lab
// filter hides, in Lab's sort order: it is what the Lab tools (Refine, Checks, per-item Edits) act on.
//
// Item (one question id):
//   qid         string   the question id (an object key of the variant JSON). Unique. itemName() returns it.
//   a, b        question | null   A's and B's question with that id exactly as typed (any JSON object: normally
//                        { type: "noul" | "choice" | "score" | "box", instructions, criteria? }, where a Choice's criteria
//                        is { option: description | null } in listed order, a Score's an array of level descriptions,
//                        a Noul's optionally { true, false }). null when that variant does not ask it.
//   ia, ib      integer | null   its 0-based position in A's and in B's question order; null when absent
//   comparable  boolean  both ask it with the same type, so a run compares it (the report's question select)
//
// data (live getters; frozen copies):
//   variants     two { name: "A" | "B", text (the editor's JSON as typed), model (as typed; "" means the current
//                model), perturb ("" | "typos" | "lowercase" | "distractor" | "shuffle"; B only, A is always ""),
//                average (boolean; B only), error (string | null: the message the editor shows), count (number of
//                questions, null on error) }
//   current_model   string | null   the model a blank model field uses (the status pill's model)
//   models       string[] | null   model-name suggestions for the connected key; null until loaded
//   perturbs     { "": "as written", typos: "with typos", ... }   the rewrites B can apply to its rows
//   rows         { count, sent }   nonempty rows in the rows box shared with Bulk, and how many a run sends at most
//                (count capped at 200). Counts only: test rows are among them and a run leaves them out.
//   running      boolean   a paid run is in flight
//   last_run     null | two { name, model, perturb, average_orders, questions }   the configuration (never answers) of
//                this session's latest finished run, to tell whether the editors changed since
//
// actions (each throws an Error with a message for the user when its guard refuses):
//   replaceItems(next, { label })  writes the list back into both editors through the page's own edit path (the
//                same one "Copy A" and "Sample" use). A's questions follow the order of `next`; B's follow ib (items
//                with ib null go last, in list order). Guards: no run in flight; both editors parse now (an edit never
//                overwrites JSON that does not parse); next is an array of objects with a nonblank, unique string qid;
//                every a/b is null or an object whose type is noul, choice, score or box; each variant keeps at least
//                one question. A variant whose questions do not change keeps its text byte for byte. Note: JavaScript
//                lists whole-number ids ("1", "2") first in ascending order, whatever the list order.
//   importItems(items, { label })  appends items (same shape; ia/ib may be null) through replaceItems. Guard: a qid
//                already in the list is refused, never merged.
//   copyAToB()   the page's "Copy A": B gets A's questions and model.
//   reverseA()   the page's "Reverse A's options" (an order check). Guard: A parses and has a Choice question whose
//                options can be reordered.
//   averageA()   the page's "Average A's orders". Guard: A parses and has a Choice question with two or more options.
//   fill(name, from)  the page's fill buttons: from is "build" (Build's questions), "sample" or "terse". Guard: name is
//                "A" or "B"; a sample set must have loaded.
//   setModel(name, model)  types a model name into that variant's model field ("" for the current model).
//   setRows(kind)   B's Rows select: a key of data.perturbs. setAsk(both)   B's Ask select: true asks in both orders.
// NO ACTION ON EITHER COMPARE SURFACE CALLS THE MODEL OR SPENDS BUDGET: a Compare run is only ever the user's own press
// of the page's Run button (with its spend preview), and no action presses it.
//
// refresh() re-renders the two variant editors; the rest of the tab stays as it is. The page renders this surface's
// Lab section right below the editors on every render of the tab. Typing in an editor does not re-render it (that
// would steal clicks aimed at it), so metrics shown in an open block can lag the typing until the next render;
// filters, checks, edits and exports read the editors when they run.
//
// Content boundaries for workbench.compare.variants:
//   - Items and data are authored configuration and counts: no answers, no rows, no labels. An export here may contain
//     questions, models and settings, and says so; it must not contain rows or anything from a run's results.
//   - Edits change only the user's own question JSON, explicitly (preview, Apply, Undo). They never touch built-in
//     sample questions or the model-facing wording of the app's own scenarios, and they never start a run.
//   - Checks that classify a change as an order check or an input check mirror jev/compare.py (reordered: same
//     instructions and options, listed in another order; perturbed: an otherwise identical request); they never
//     redefine those terms.
import { clone } from "../kit.js";
import { parseVariantText, reverseOptions } from "../../variants.js";

const NAMES = Object.freeze(["A", "B"]);
const TYPES = Object.freeze(["noul", "choice", "score", "box"]);
const SIGNALS = Object.freeze(["confidence", "top_probability"]);
const BOUNDS = Object.freeze(["estimate", "lower"]);
const LABELABLE = Object.freeze(["choice", "noul", "score"]);
const PERTURBS = Object.freeze({ "": "as written", typos: "with typos", lowercase: "in lowercase", distractor: "with an unrelated sentence added",
  shuffle: "with JSON fields shuffled" });
const MAX_ROWS = 200;
const EMPTY = Object.freeze([]);
const EDGES = ["left", "top", "right", "bottom"];

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const integer = (value) => (Number.isInteger(value) ? value : null);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A frozen copy of a raw page value, made once per raw object (a new report or result is a new object).
const COPIES = new WeakMap();
function frozenCopy(raw) {
  if (!raw || typeof raw !== "object") return raw === undefined ? null : raw;
  if (!COPIES.has(raw)) COPIES.set(raw, deepFreeze(clone(raw)));
  return COPIES.get(raw);
}

// A source field: a value, or a function that returns the value now.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("The Compare tab cannot do that here.");
  return source[name](...args);
}

const nameIndex = (name) => {
  const index = NAMES.indexOf(name);
  if (index < 0) throw new Error("Name a variant: A or B.");
  return index;
};

// ---------- reading an answer (mirrors jev/calibrate.py read) ----------

function unit(value) {
  if (typeof value !== "number" || !(value >= 0 && value <= 1)) throw new Error("not a number from 0 to 1");
  return value;
}

// { pick, signal, top } for one answer, or null when jev/calibrate.py would refuse to read it.
function readAnswer(answer, signal) {
  if (!isObject(answer) || !TYPES.includes(answer.type)) return null;
  try {
    if (answer.type === "box") {
      const stated = unit(answer.confidence);
      const box = answer.box;
      if (!isObject(box) || !EDGES.every((edge) => hasOwn(box, edge))) return null;
      const edges = EDGES.map((edge) => unit(box[edge]));
      if (!(edges[0] < edges[2] && edges[1] < edges[3])) return null;
      return { pick: edges.map((edge) => edge.toFixed(2)).join(", "), signal: stated, top: stated };
    }
    if (answer.type === "noul") {
      const p = unit(answer.noul);
      const top = Math.max(p, 1 - p);
      return { pick: p >= 0.5 ? "yes" : "no", signal: signal === "confidence" ? Math.abs(2 * p - 1) : top, top };
    }
    const raw = answer.probabilities ?? {};
    if (!isObject(raw)) return null;
    const probs = Object.entries(raw).map(([key, p]) => [key, unit(p)]);
    if (!probs.length) return null;
    let pick, top;
    if (answer.type === "choice") {
      if (typeof answer.choice !== "string" || !hasOwn(raw, answer.choice)) return null;
      pick = answer.choice;
      top = raw[answer.choice];
    } else {
      if (!probs.every(([key]) => /^\s*[+-]?\d+\s*$/.test(key))) return null;
      let best = probs[0];
      for (const entry of probs) if (entry[1] > best[1]) best = entry;
      pick = String(Number.parseInt(best[0], 10));
      top = best[1];
    }
    let gate = top;
    if (signal === "confidence") {
      const stated = answer.confidence;
      if (stated === null || stated === undefined) {
        const n = probs.length;
        gate = n < 2 ? 1 : Math.max(0, (Math.max(...probs.map(([, p]) => p)) - 1 / n) / (1 - 1 / n));
      } else gate = unit(stated);
    }
    return { pick, signal: gate, top };
  } catch {
    return null;
  }
}

function rowText(row) {
  if (isObject(row) && "_test" in row) {
    const { _test, ...rest } = row;
    row = rest;
  }
  if (typeof row === "string") return row;
  if (isObject(row) && Object.keys(row).length === 1 && typeof row.text === "string") return row.text;
  return JSON.stringify(row) ?? "";
}

function metaOf(run) {
  const meta = isObject(run) && isObject(run.meta) ? run.meta : null;
  if (!meta) return null;
  return { model: typeof meta.model === "string" ? meta.model : null, latency_ms: finite(meta.latency_ms), input_tokens: finite(meta.input_tokens),
    output_tokens: finite(meta.output_tokens), cost_usd: finite(meta.cost_usd), calls: integer(meta.calls) };
}

// ---------- workbench.compare.rows ----------

function rowItem(result, qid, signal, disagreement) {
  const runs = Array.isArray(result.runs) ? result.runs : [];
  const run = (v) => (isObject(runs[v]) ? runs[v] : null);
  const answers = NAMES.map((_, v) => {
    const answer = run(v) && isObject(run(v).answers) ? run(v).answers[qid] : undefined;
    return isObject(answer) ? answer : null;
  });
  const reads = answers.map((answer) => (answer ? readAnswer(answer, signal) : null));
  const server = disagreement && Array.isArray(disagreement.answers) ? disagreement.answers : null;
  const index = integer(result.index) ?? 0;
  const expect = isObject(result.expect) ? result.expect : {};
  return {
    index,
    number: index + 1,
    row: clone(result.row) ?? null,
    text: rowText(result.row),
    sent: NAMES.map((_, v) => (run(v) && "input" in run(v) ? clone(run(v).input) ?? null : null)),
    label: hasOwn(expect, qid) && expect[qid] !== undefined ? clone(expect[qid]) : null,
    answers: answers.map((answer) => (answer ? clone(answer) : null)),
    picks: NAMES.map((_, v) => (server && isObject(server[v]) && server[v].predicted !== undefined ? String(server[v].predicted) : reads[v]?.pick ?? null)),
    signals: NAMES.map((_, v) => (server && isObject(server[v]) ? finite(server[v].signal) : reads[v]?.signal ?? null)),
    tops: reads.map((entry) => entry?.top ?? null),
    correct: NAMES.map((_, v) => (server && isObject(server[v]) && typeof server[v].correct === "boolean" ? server[v].correct : null)),
    verdict: disagreement && ["both_right", "a_only", "b_only", "both_wrong"].includes(disagreement.verdict) ? disagreement.verdict : null,
    differs: !!disagreement,
    paired: answers.every(Boolean),
    orders: NAMES.map((_, v) => {
      const picks = run(v) && isObject(run(v).orders) ? run(v).orders[qid] : null;
      return Array.isArray(picks) && picks.length === 2 ? picks.map((pick) => (pick === null || pick === undefined ? null : String(pick))) : null;
    }),
    meta: NAMES.map((_, v) => metaOf(run(v))),
    errors: NAMES.map((_, v) => (run(v) && typeof run(v).error === "string" && run(v).error ? run(v).error : null)),
    skipped: NAMES.map((_, v) => !!(run(v) && run(v).skipped === true)),
  };
}

// The items of one (result, report, qid): built once and kept while all three are the same.
const ROWS = new WeakMap();
function rowItems(result, report, qid) {
  const known = ROWS.get(report);
  if (known && known.result === result && known.qid === qid) return known.items;
  const signal = SIGNALS.includes(report.signal) ? report.signal : "confidence";
  const differing = new Map();
  for (const entry of Array.isArray(report.disagreements) ? report.disagreements : []) {
    if (isObject(entry) && !differing.has(entry.index)) differing.set(entry.index, entry);
  }
  const results = Array.isArray(result.results) ? result.results : [];
  const items = deepFreeze(results.filter((entry) => isObject(entry) && Array.isArray(entry.runs)
    && entry.runs.some((run) => isObject(run) && isObject(run.answers) && isObject(run.answers[qid])))
    .map((entry) => rowItem(entry, qid, signal, differing.get(entry.index) || null)));
  ROWS.set(report, { result, qid, items });
  return items;
}

// Question ids both variants ask with the same type, in A's order (the page's cmpQuestions).
function sharedIds(result) {
  const [qa, qb] = (Array.isArray(result?.variants) ? result.variants : []).map((variant) => (isObject(variant?.questions) ? variant.questions : {}));
  if (!qa || !qb) return [];
  return Object.keys(qa).filter((qid) => isObject(qb[qid]) && isObject(qa[qid]) && qb[qid].type === qa[qid].type);
}

function labeledIds(result) {
  const ids = new Set();
  for (const entry of Array.isArray(result?.results) ? result.results : []) for (const qid of Object.keys(isObject(entry?.expect) ? entry.expect : {})) ids.add(qid);
  return [...ids];
}

// source: {
//   result()   W.compare.result (the latest finished run of this session) or null
//   report()   W.compare.report (the scored question's report) or null;   qid()   W.compare.qid
//   signal(), bound(), first(), cascadeT()   the report controls;   slices(), slicesError(), reportError()
//   running(), labeling()   W.compare.running and W.compare.labelingBusy
//   matches(item, ctx)  LAB.matches for this surface;   arrange(items, ctx)  LAB.arrange for this surface
//   refresh()   re-render the table and its count
//   selectQuestion(qid), setSignal(signal), setBound(bound), setFirst(name), setCascadeThreshold(t),
//   labelDisagreements(), useInBuild(index)   the page's own operations (guards are applied here first)
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function compareRowsCtx(source = {}) {
  const result = () => {
    const value = read(source, "result", null);
    return isObject(value) && Array.isArray(value.results) && Array.isArray(value.variants) ? value : null;
  };
  const report = () => {
    const value = read(source, "report", null);
    return result() && isObject(value) ? value : null;
  };
  const qid = () => {
    const value = read(source, "qid", null);
    return result() && typeof value === "string" && value ? value : null;
  };
  const running = () => read(source, "running", false) === true;
  const items = () => {
    const res = result(), rep = report(), id = qid();
    return res && rep && id ? rowItems(res, rep, id) : EMPTY;
  };
  const shared = () => (result() ? sharedIds(result()) : []);
  const idle = () => {
    if (!result()) throw new Error("Run both variants first: there is no Compare report yet.");
    if (running()) throw new Error("Wait for the current Compare run to finish.");
  };
  const cascade = () => (isObject(report()?.cascade) ? report().cascade : null);
  const ctx = {
    items,
    shown() {
      const list = items().filter((item) => item.differs && (!source.matches || source.matches(item, ctx) !== false));
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: {
      get qid() { return qid(); },
      get type() { return TYPES.includes(report()?.type) ? report().type : null; },
      get signal() {
        const value = report()?.signal ?? read(source, "signal", "confidence");
        return SIGNALS.includes(value) ? value : "confidence";
      },
      get bound() {
        const value = report()?.bound ?? read(source, "bound", "estimate");
        return BOUNDS.includes(value) ? value : "estimate";
      },
      get first() { return read(source, "first", "A") === "B" ? "B" : "A"; },
      get cascade_threshold() {
        const value = finite(read(source, "cascadeT", null));
        return value === null ? null : Math.min(1, Math.max(0, value));
      },
      get questions() {
        const id = qid(), res = result();
        if (!id || !res) return deepFreeze([null, null]);
        return deepFreeze(res.variants.slice(0, 2).map((variant) => (isObject(variant?.questions?.[id]) && hasOwn(variant.questions, id) ? clone(variant.questions[id]) : null)));
      },
      get shared() { return deepFreeze(shared()); },
      get labeled() { return deepFreeze(labeledIds(result())); },
      get variants() {
        const res = result();
        if (!res) return EMPTY;
        return deepFreeze(res.variants.slice(0, 2).map((variant, v) => ({ name: NAMES[v], model: typeof variant?.model === "string" ? variant.model : null,
          perturb: typeof variant?.perturb === "string" && variant.perturb ? variant.perturb : null, average_orders: variant?.average_orders === true,
          question_count: isObject(variant?.questions) ? Object.keys(variant.questions).length : 0, completed: integer(variant?.completed) ?? 0,
          errors: integer(variant?.errors) ?? 0, cost_usd: finite(variant?.cost_usd), input_tokens: finite(variant?.input_tokens),
          latency_ms_median: finite(variant?.latency_ms_median), perturbed_rows: integer(variant?.perturbed_rows) ?? 0,
          unperturbed_rows: integer(variant?.unperturbed_rows) ?? 0 })));
      },
      get scores() {
        const rep = report();
        return rep && Array.isArray(rep.variants) && rep.variants.length === 2 ? frozenCopy(rep.variants) : null;
      },
      get paired() { return isObject(report()?.paired) ? frozenCopy(report().paired) : null; },
      get counts() {
        const rep = report();
        if (!rep) return null;
        return deepFreeze({ answered_both: integer(rep.answered_both) ?? 0, agree: integer(rep.agree) ?? 0,
          disagree: Array.isArray(rep.disagreements) ? rep.disagreements.length : 0, only_a: integer(rep.only_a) ?? 0,
          only_b: integer(rep.only_b) ?? 0, excluded: integer(rep.excluded) ?? 0 });
      },
      get cascade() { return cascade() ? frozenCopy(cascade()) : null; },
      get agreement() { return Array.isArray(result()?.agreement) ? frozenCopy(result().agreement) : EMPTY; },
      get orders() {
        const res = result();
        if (!res) return EMPTY;
        return deepFreeze(res.variants.slice(0, 2).map((variant) => (Array.isArray(variant?.orders) ? clone(variant.orders) : null)));
      },
      get run() {
        const res = result();
        if (!res) return null;
        return deepFreeze({ rows: integer(res.rows) ?? res.results.length, labeled: integer(res.labeled) ?? 0, held_out: integer(res.held_out) ?? 0,
          wall_ms: finite(res.wall_ms), cost_usd: finite(res.cost_usd), stopped: typeof res.stopped === "string" && res.stopped ? res.stopped : null });
      },
      get slices() {
        const value = read(source, "slices", null);
        return result() && isObject(value) ? frozenCopy(value) : null;
      },
      get slices_error() {
        const value = read(source, "slicesError", null);
        return typeof value === "string" && value ? value : null;
      },
      get report_error() {
        const value = read(source, "reportError", null);
        return typeof value === "string" && value ? value : null;
      },
      get running() { return running(); },
      get labeling() { return read(source, "labeling", false) === true; },
    },
    actions: {
      selectQuestion(id) {
        idle();
        if (typeof id !== "string" || !shared().includes(id)) throw new Error(`“${String(id)}” is not a question both variants ask with the same type.`);
        return call(source, "selectQuestion", id);
      },
      setSignal(signal) {
        idle();
        if (!SIGNALS.includes(signal)) throw new Error("Gate on confidence or top_probability.");
        return call(source, "setSignal", signal);
      },
      setBound(bound) {
        idle();
        if (!BOUNDS.includes(bound)) throw new Error("Targets use estimate (these rows) or lower (95% confidence).");
        return call(source, "setBound", bound);
      },
      setFirst(name) {
        idle();
        nameIndex(name);
        if (!cascade()) throw new Error("There is no cascade for this question: it needs labeled rows both variants answered.");
        return call(source, "setFirst", name);
      },
      setCascadeThreshold(value) {
        if (!cascade()) throw new Error("There is no cascade for this question: it needs labeled rows both variants answered.");
        const t = finite(value);
        if (t === null || t < 0 || t > 1) throw new Error("A cascade threshold is a number from 0 to 1.");
        const rounded = Math.round(t * 100) / 100;
        call(source, "setCascadeThreshold", rounded);
        return rounded;
      },
      labelDisagreements() {
        idle();
        const type = ctx.data.type;
        if (!LABELABLE.includes(type)) throw new Error("Blank labels can be opened for Choice, Noul and Score questions only.");
        if (!items().some((item) => item.differs)) throw new Error("A and B gave the same answer on every row, so there is nothing to label.");
        if (ctx.data.labeling) throw new Error("The labeling handoff is already being prepared.");
        return call(source, "labelDisagreements");
      },
      useInBuild(name) {
        idle();
        return call(source, "useInBuild", nameIndex(name));
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && Number.isInteger(item.number) ? `#${item.number}` : String(index + 1)),
  };
  return ctx;
}

// ---------- workbench.compare.variants ----------

function parsedVariant(variant, v) {
  try { return { questions: parseVariantText(variant?.text, NAMES[v]), error: null }; }
  catch (error) { return { questions: null, error: error.message }; }
}

function variantItems(parsed) {
  const [qa, qb] = parsed.map((entry) => entry.questions || Object.create(null));
  const aIds = Object.keys(qa), bIds = Object.keys(qb);
  const make = (qid) => {
    const a = hasOwn(qa, qid) ? qa[qid] : undefined, b = hasOwn(qb, qid) ? qb[qid] : undefined;
    const ia = aIds.indexOf(qid), ib = bIds.indexOf(qid);
    return { qid, a: a === undefined ? null : clone(a), b: b === undefined ? null : clone(b), ia: ia < 0 ? null : ia, ib: ib < 0 ? null : ib,
      comparable: isObject(a) && isObject(b) && a.type === b.type };
  };
  return deepFreeze([...aIds.map(make), ...bIds.filter((qid) => !hasOwn(qa, qid)).map(make)]);
}

function checkQuestion(question, qid, name) {
  if (question === null) return;
  if (!isObject(question)) throw new Error(`Variant ${name}: question “${qid}” must be an object.`);
  if (!TYPES.includes(question.type)) throw new Error(`Variant ${name}: question “${qid}” needs a type of noul, choice, score or box.`);
}

// The two question objects a list of items stands for. Throws an Error a person can act on.
function questionsFromItems(next) {
  if (!Array.isArray(next)) throw new Error("An edit must give a list of questions.");
  const seen = new Set();
  for (const item of next) {
    if (!isObject(item) || typeof item.qid !== "string" || !item.qid.trim()) throw new Error("Every question needs a nonblank id.");
    if (seen.has(item.qid)) throw new Error(`Question id “${item.qid}” appears twice. Give every question a unique id.`);
    seen.add(item.qid);
    const a = item.a === undefined ? null : item.a, b = item.b === undefined ? null : item.b;
    checkQuestion(a, item.qid, "A");
    checkQuestion(b, item.qid, "B");
  }
  const qa = Object.create(null), qb = Object.create(null);
  for (const item of next) if (isObject(item.a)) qa[item.qid] = clone(item.a);
  const inB = next.map((item, order) => ({ item, order })).filter(({ item }) => isObject(item.b));
  inB.sort((x, y) => {
    const px = Number.isInteger(x.item.ib) ? x.item.ib : Infinity, py = Number.isInteger(y.item.ib) ? y.item.ib : Infinity;
    return px === py ? x.order - y.order : px - py;
  });
  for (const { item } of inB) qb[item.qid] = clone(item.b);
  if (!Object.keys(qa).length) throw new Error("Variant A would have no questions left. Keep at least one.");
  if (!Object.keys(qb).length) throw new Error("Variant B would have no questions left. Keep at least one.");
  return [qa, qb];
}

// source: {
//   variants()   W.compare.variants: two { text, model, perturb, average } (the page's editor state)
//   currentModel(), models(), rowCount(), running(), lastRun()   (lastRun: W.compare.result?.variants or null)
//   matches(item, ctx), arrange(items, ctx)   LAB.matches / LAB.arrange for this surface
//   setQuestions(index, questions)   write one variant's questions into its editor (the page's own edit path)
//   refresh()   re-render the two editors
//   copyAToB(), reverseA(), averageA(), fill(index, from), setModel(index, model), setRows(kind), setAsk(both)
// }
export function compareVariantsCtx(source = {}) {
  const raw = () => {
    const list = read(source, "variants", EMPTY);
    return [0, 1].map((v) => (Array.isArray(list) && isObject(list[v]) ? list[v] : { text: "", model: "", perturb: "", average: false }));
  };
  let built = { key: null, parsed: null, items: EMPTY };
  const state = () => {
    const texts = raw().map((variant) => (typeof variant.text === "string" ? variant.text : ""));
    const key = JSON.stringify(texts);
    if (built.key !== key) {
      const parsed = raw().map((variant, v) => parsedVariant({ text: texts[v] }, v));
      built = { key, parsed, items: variantItems(parsed) };
    }
    return built;
  };
  const items = () => state().items;
  const running = () => read(source, "running", false) === true;
  const idle = () => { if (running()) throw new Error("Wait for the current Compare run to finish."); };
  const parsedA = () => {
    const a = state().parsed[0];
    if (a.error) throw new Error(a.error);
    return a.questions;
  };
  const ctx = {
    items,
    shown() {
      const list = items().filter((item) => !source.matches || source.matches(item, ctx) !== false);
      const arranged = source.arrange ? source.arrange(list, ctx) : list;
      return Array.isArray(arranged) ? arranged : list;
    },
    data: {
      get variants() {
        const { parsed } = state();
        return deepFreeze(raw().map((variant, v) => ({ name: NAMES[v], text: typeof variant.text === "string" ? variant.text : "",
          model: typeof variant.model === "string" ? variant.model : "", perturb: v === 1 && hasOwn(PERTURBS, variant.perturb || "") ? variant.perturb || "" : "",
          average: v === 1 && variant.average === true, error: parsed[v].error, count: parsed[v].questions ? Object.keys(parsed[v].questions).length : null })));
      },
      get current_model() {
        const value = read(source, "currentModel", null);
        return typeof value === "string" && value ? value : null;
      },
      get models() {
        const value = read(source, "models", null);
        return Array.isArray(value) ? deepFreeze(value.filter((name) => typeof name === "string")) : null;
      },
      get perturbs() { return PERTURBS; },
      get rows() {
        const count = integer(read(source, "rowCount", 0)) ?? 0;
        return deepFreeze({ count: Math.max(0, count), sent: Math.min(Math.max(0, count), MAX_ROWS) });
      },
      get running() { return running(); },
      get last_run() {
        const list = read(source, "lastRun", null);
        if (!Array.isArray(list) || list.length < 2) return null;
        return deepFreeze(list.slice(0, 2).map((variant, v) => ({ name: NAMES[v], model: typeof variant?.model === "string" ? variant.model : null,
          perturb: typeof variant?.perturb === "string" && variant.perturb ? variant.perturb : null, average_orders: variant?.average_orders === true,
          questions: isObject(variant?.questions) ? clone(variant.questions) : {} })));
      },
    },
    actions: {
      replaceItems(next) {
        idle();
        const { parsed } = state();
        for (const entry of parsed) if (entry.error) throw new Error(`${entry.error}. Fix that editor before applying an edit.`);
        const questions = questionsFromItems(next);
        if (typeof source.setQuestions !== "function") throw new Error("The Compare tab cannot do that here.");
        questions.forEach((list, v) => {
          if (JSON.stringify(list) !== JSON.stringify(parsed[v].questions)) source.setQuestions(v, list);
        });
      },
      importItems(added) {
        if (!Array.isArray(added) || !added.length) throw new Error("There is nothing to add.");
        const taken = new Set(items().map((item) => item.qid));
        for (const item of added) {
          if (isObject(item) && taken.has(item.qid)) throw new Error(`Question id “${item.qid}” is already in a variant. Edit it there instead.`);
        }
        ctx.actions.replaceItems([...items(), ...added]);
      },
      copyAToB() {
        idle();
        return call(source, "copyAToB");
      },
      reverseA() {
        idle();
        if (!reverseOptions(parsedA())) throw new Error("Variant A has no Choice question whose options can be reordered. Score levels keep their order, and options named by whole numbers always list in ascending order.");
        return call(source, "reverseA");
      },
      averageA() {
        idle();
        const questions = parsedA();
        if (!Object.values(questions).some((q) => isObject(q) && q.type === "choice" && isObject(q.criteria) && Object.keys(q.criteria).length > 1)) {
          throw new Error("Variant A has no Choice question with two or more options to average over both orders.");
        }
        return call(source, "averageA");
      },
      fill(name, from) {
        idle();
        const index = nameIndex(name);
        if (!["build", "sample", "terse"].includes(from)) throw new Error("Fill from build, sample or terse.");
        return call(source, "fill", index, from);
      },
      setModel(name, model) {
        idle();
        const index = nameIndex(name);
        if (typeof model !== "string") throw new Error("A model name is text; leave it blank for the current model.");
        return call(source, "setModel", index, model.trim());
      },
      setRows(kind) {
        idle();
        if (typeof kind !== "string" || !hasOwn(PERTURBS, kind)) throw new Error(`B's rows are ${Object.keys(PERTURBS).map((key) => key || "as written").join(", ")}.`);
        return call(source, "setRows", kind);
      },
      setAsk(both) {
        idle();
        if (typeof both !== "boolean") throw new Error("Ask once (false) or in both orders (true).");
        return call(source, "setAsk", both);
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.qid === "string" && item.qid ? item.qid : String(index + 1)),
  };
  return ctx;
}
