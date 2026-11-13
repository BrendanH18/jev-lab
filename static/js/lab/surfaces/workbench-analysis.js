// Lab surfaces of the Workbench analysis panels on the Bulk tab: Calibrate (static/js/workbench-calibrate.js, with
// its Answer sets panel), Policy (static/js/workbench-policy.js, with "Do the gates earn their place?" from prune.js)
// and Costs (static/js/workbench-costs.js, with the "Check on unseen rows" holdout checks). Everything these panels
// show is plain arithmetic over the answers of the CURRENT USER'S OWN latest Bulk run in this page session: no panel
// here calls the model. Pure code: it imports the kit and the DOM-free prune.js only, and touches no DOM, storage or
// network. Tests: tests/js/lab/surface-wb-calibrate-policy-costs.test.mjs. Fixtures for pack tests:
// tests/js/lab/fixtures/workbench-analysis.mjs (sampleCalibrateCtx, samplePolicyCtx, sampleCostsCtx).
// This header is the CONTRACT for packs on these three surfaces.
//
// Every ctx is { items(), shown(), data, actions, refresh(), itemName(item, index) }. The page builds each ctx once per
// page session; every field reads the page state when called, so read a value when you need it and keep nothing
// across renders. items() and shown() return the SAME frozen item objects (compare by identity) until the list itself
// changes (a new report, a new run, an edit). Items and data values are deeply frozen copies: never write to them.
//
// Row numbering (Calibrate and Policy): `index` is the row's 0-based position in the Bulk run, the number the Bulk
// results table prints as "#" minus one; `number` is index + 1. Held-out test rows ("_test": true) never appear on
// these surfaces: the reports are computed from tuning rows only (tuningResults), and the builders drop any row of a
// test row even if a stale report named one. data.run.held_out is a COUNT of test rows, never their content. A test
// score exists only through Policy's explicit "Score this gate on N test rows" action, which is not on these surfaces.
//
// Shared value vocabulary:
//   type     "choice" | "noul" | "score" | "box"   the question's answer type
//   signal   "confidence" | "top_probability"     what a gate compares with its threshold. "confidence" is the answer's
//            confidence field (a Choice/Score without one: how far the top probability sits above an even split; a
//            Noul: |2p - 1|; a Box: its confidence); "top_probability" is the probability of the prediction (Noul:
//            max(p, 1 - p)). A row is AUTOMATED at threshold t when signal + 1e-9 >= t (the page's tie rule).
//   bound    "estimate" | "lower"   whether accuracy targets must hold on these rows or at the 95% Wilson lower bound
//   answers and labels are shown as Calibrate shows them: a Choice option key, "yes"/"no" for a Noul (right means
//            P(yes) >= 0.5 agrees with the label), a Score level as text ("2"; right means the most likely level),
//            a Box as "left, top, right, bottom" with two decimals (right means IoU >= 0.5 with the label).
//   intervals are 95% Wilson (Z = 1.959964): low = 0 when none are right and high = 1 when all are.
//
// ===================================================================================================================
// SURFACE "workbench.calibrate"  —  builder calibrateCtx(source)  —  fixture sampleCalibrateCtx(overrides)
// ===================================================================================================================
// The labeled, scored rows of the question Calibrate shows (data.qid): exactly the rows of its report
// (POST /api/workbench/calibrate, jev/calibrate.py evaluate), in row order. items() is [] before a run, while a
// rescoring is in flight (the page clears the report first), after a failure, and when no row has a usable label.
// Unlabeled answered rows are not items: their signals are in data.signals; rows with a label that cannot be read are
// in data.report.invalid. The page has no per-row list of its own in Calibrate, so shown() is items() minus what a Lab
// filter hides, in Lab's sort order (row order otherwise). While a Lab filter or sort is active the panel lists
// exactly shown() under "Rows Lab shows", with a "Clear Lab filters and sort" button; the Answer sets panel's list of
// "Rows a person would choose for" (rows whose set holds two or more answers, first 8) then also keeps only rows Lab
// shows, in Lab's order. With no Lab setting active both panels are exactly as before.
//
// Item (one scored row):
//   index      integer   0-based row of the run (see Row numbering). Unique. itemName() returns "#<number>".
//   number     integer   index + 1
//   text       string    the row as the Bulk table prints it (an object with only "text" reads as its text, anything
//                        else as compact JSON); "" when the run has no such row
//   row        string | object | array | null   the row as run, without "_test" and "_expect" ("_image" stays)
//   image      string | null   the row's picture name ("_image")
//   type       the question's type (as data.type)
//   label      string    the human label as Calibrate shows it
//   predicted  string    the answer as Calibrate shows it
//   correct    boolean   the server's verdict (see "right" above)
//   signal     number    0..1, the gating signal under data.signal (the report's signal)
//   top        number    0..1, the stated probability of the prediction (Noul: max(p, 1 - p); Box: its confidence)
//   answer     object | null   the raw answer to data.qid from the run: choice { type, choice, probabilities: { option:
//                        p }, confidence? }; noul { type, noul: P(yes) }; score { type, score (expected level),
//                        probabilities: { level: p }, legend?, confidence? }; box { type, box: { left, top, right,
//                        bottom }, confidence }. null if the run has no such answer.
//   set        object | null   the row's answer set from the Answer sets report for the same question:
//                        { options: string[] (most likely first; [] when no option reaches the cut), size, covered
//                        (the list a reviewer sees holds the label), route: "auto" | "review", probabilities:
//                        { option: p } of the listed options }. null when there is no current fit for this row.
// NOT on the item, because it moves with the slider: whether the row is automated. Compute it as
// item.signal + 1e-9 >= ctx.data.threshold (data.threshold is always a number).
//
// data (live getters; frozen copies):
//   qid        string | null   the question Calibrate shows (its question select); null before a run
//   type       type | null     its type; null when unknown
//   signal     signal          the report's signal (the select's while no report)
//   bound      bound           the report's bound (the select's while no report)
//   threshold  number 0..1     the slider (0.01 steps)
//   questions  [{ qid, type, labeled }]   every question the run answered, in answer order (the question select);
//                              labeled: some row carries a label for it. [] before a run.
//   report     null | the server's report: { type, signal, bound, labeled, unlabeled, invalid: [{ index, reason }],
//              correct, accuracy, accuracy_low, accuracy_high, classes, confusion (label row × answer column),
//              reliability: [{ lo, hi, count, stated, observed, hits }], ece, sweep: 101 × { threshold, automated,
//              correct, coverage, accuracy, low, high } (sweep[k] is threshold k / 100), targets: [{ target, threshold
//              | null, coverage, automated, accuracy, low, high, needed, plan }], rows, signals, ordinal | null (Score
//              only: { within_one, within_one_accuracy, within_one_low, within_one_high, mean_error, expected_rows,
//              expected_error, cuts: [...] }), iou_mean, iou_right (Box only) }. null as for items().
//   at         null | the sweep point at data.threshold (null without a labeled report)
//   signals    { "<index>": signal }   every readable answered tuning row, labeled or not ({} without a report)
//   cost       null | Calibrate's cost report for data.qid (POST /api/workbench/cost): { review, error, mistakes,
//              break_even, review_all, automate_all, best: { automated, wrong, review, coverage, accuracy, low, high,
//              cost, per_1000, gates | null }, sweep: 101 × { threshold, automated, wrong, cost, per_1000 }, labeled,
//              ... }. null for a Box, when prices are invalid, and while it is recomputed.
//   holdout    null | { running: true } | the "Check on unseen rows" report: { signal, bound, folds, labeled,
//              minimum, problem, targets: [{ target, tuned, unseen, gap, below, unreached, spread, parts, needed }],
//              cost? }. null until the user asks, and again after any change.
//   sets       null | the Answer sets report for data.qid: { type, coverage_target, labeled, unlabeled, invalid,
//              needed, options, cut | null, summary, rows, holdout, slices }. null for a Box, before a fit, and while
//              a fit is on its way.
//   sets_coverage   number   the coverage the Answer sets select asks for (0.8, 0.9, 0.95 or 0.99)
//   attached   { qid: { cut, coverage } }   answer-set cuts attached to Policy's export and saved check
//   slices     null | Calibrate's "By slice" report: { fields: [{ name, values }], field, slices: [{ value, rows,
//              accuracy, accuracy_low, accuracy_high, automated, coverage, automated_accuracy, automated_low,
//              automated_high, wrong_automated, below, below_all, p, p_all }], overall }. null until computed.
//   run        null | { rows, answered, held_out }   counts of the latest run (held_out: test rows, a count only)
//
// actions (each throws an Error with a message for the user when its guard refuses; call them only from a command or a
// control the user just pressed, never from a fact, metric, check or render). None of them calls the model.
//   setThreshold(t)        moves the slider to t rounded to 0.01, as dragging it does (updates stats, chart, cost,
//                          route column in place). Guard: a labeled report; 0 <= t <= 1. Returns the rounded t.
//   selectQuestion(qid)    the question select: rescoring through the page's pure-code requests. Guard: a run;
//                          qid is one of data.questions. Returns the page's promise.
//   setSignal(signal), setBound(bound)   the two selects, rescoring the same way. Guard: a run; a known value.
//   setCoverage(coverage)  the Answer sets select (0.8, 0.9, 0.95 or 0.99): refits the sets. Guard: a run; the
//                          question is Choice, Noul or Score.
//   checkUnseen()          the "Check on unseen rows" button (5 grouped folds, pure code). Guard: a labeled report of a
//                          Choice, Noul or Score question; no check running; the panel is on screen.
// There is no replaceItems or importItems: the rows are the user's model answers; no pack may edit, add or replay one.
//
// refresh() re-lists "Rows Lab shows" and the Answer sets row list; the rest of the panel keeps its state. The page
// renders this surface's Lab section at the foot of Calibrate on every render of the Bulk tab, but only while the
// report has labeled rows, so its commands are reachable from the palette only then. The slider moves without a
// re-render: "Rows Lab shows" follows it, while an open Metrics block keeps the value it computed until the next render.
//
// ===================================================================================================================
// SURFACE "workbench.policy"  —  builder policyCtx(source)  —  fixture samplePolicyCtx(overrides)
// ===================================================================================================================
// The rows Policy scores at the current gates (POST /api/workbench/policy, jev/policy.py evaluate): every tuning row
// labeled for EVERY checked gate, in row order. items() is [] with no gate checked, while a rescoring is in flight,
// after a failure and when no row is labeled for every gate. shown() is items() minus what a Lab filter hides, in Lab's
// sort order. The page's own list here is "Automated but wrong" (outcome "wrong", first 12): it lists the shown()
// rows whose outcome is "wrong", in shown() order, and its heading reads "N of M" while a Lab setting is active. While
// one is active the panel also lists shown() under "Rows Lab shows" with a reset button. Stats, the bar, the
// per-question table and slices always describe every scored row.
//
// Item (one scored row):
//   index, number, text, row, image   as on workbench.calibrate
//   outcome    "right" | "wrong" | "review"   automated and every gated answer right / automated with a wrong one /
//                        held for review (by a gate or by a rule)
//   automated  boolean   every gate clears and no rule holds the row
//   correct    boolean   every gated answer matches its label (whether or not automated)
//   held       string[]  the gates whose answer is below its threshold, in gate order
//   wrong      string[]  the gated questions answered wrongly, in gate order
//   rules      integer[] line numbers (in data.rules.applied) of the rules the row's answers break or cannot be
//                        checked against; [] when rules are off
//   answers    { qid: { answer, label, signal } }   every gated question: answer and label as Calibrate shows them,
//                        signal 0..1 under data.signal
//
// data (live getters; frozen copies):
//   signal     the report's signal (the select's while no report);   bound   the target-basis select
//   gates      { qid: { on, t } }   every gateable (Choice/Noul/Score) question of the run, in answer order
//   active     { qid: t }   the checked gates only (what a rescoring sends)
//   max_gates  10
//   questions  [{ qid, type, labeled, on, t }]   the gateable questions in gate-row order
//   report     null | the server's report: { signal, gates, questions: [{ qid, type, threshold, correct, holds, only,
//              wrong_automated, accuracy, accuracy_low, accuracy_high }], labeled, unlabeled, invalid, skipped,
//              accuracy_all, accuracy_all_low, accuracy_all_high, automated, correct, review, coverage, accuracy,
//              accuracy_low, accuracy_high, routed, routed_automated, rules: [text], held_by_rules,
//              routed_held_by_rules, rows }. null as for items().
//   tunes      null | { signal, bound, labeled, targets: [{ target, gates | null, automated, coverage, accuracy,
//              low, high, needed, plan }] }   the Tune chips
//   cost       null | the cost at the current thresholds: { current, review_all, automate_all, review, error, ... }
//   cheapest   null | the lowest-cost thresholds: { best: { gates | null, per_1000, ... }, review_all, ... }
//   holdout    as on workbench.calibrate, for the checked gates
//   prune      { target, running, report }   "Do the gates earn their place?": report null | { signal, bound, target,
//              labeled, baseline: { gates | null, labeled, automated, coverage, accuracy, low, high }, gated: [{ qid,
//              type, share, rules, off, dropped | null, holds_back_nothing }], unused: [{ qid, type, share }], chars }
//              (holds_back_nothing is prune.js holdsBackNothing, added here)
//   rules      { text (as typed), applied (accepted text), hold (Policy sends rule-breaking rows to review),
//              in_force (the text Policy applies now, "" when none), error, report | null (jev/rules.py report) }
//   slices     null | Policy's "By slice" report (shape as on workbench.calibrate)
//   run        null | { rows, answered, held_out }
//   request_ready   boolean   the run's question set is known (needed for checkGates)
//
// actions (guards as above; none calls the model; no edit of answers):
//   setThreshold(qid, t)   one gate's slider to t (rounded to 0.01) and rescore, as the Tune chips apply thresholds.
//                          Guard: qid is a checked gate; 0 <= t <= 1. Returns the page's promise.
//   setThresholds(map)     several checked gates at once ({ qid: t }), one rescoring. Same guards; map nonempty.
//   setGate(qid, on)       the gate's checkbox: retunes and rescores everything. Guard: qid is gateable; turning one on
//                          refuses at data.max_gates checked gates; turning off the last checked gate is allowed.
//   setSignal(signal), setBound(bound)   the two selects (bound only retunes).
//   checkUnseen()          Policy's "Check on unseen rows". Guard: a checked gate; no check running; on screen.
//   checkGates()           "Check each gate" (prune). Guard: a checked gate; no check running; data.request_ready.
//   exportGate()           "Export as a module": the page's export with the current gates, rules and attached cuts.
//                          Guard: a checked gate. Shows the export panel; nothing is saved.
// There is no replaceItems or importItems.
//
// refresh() re-lists "Automated but wrong" and "Rows Lab shows"; the rest of Policy keeps its state. The page renders
// this surface's Lab section below Policy's report on every render of the Bulk tab while at least one gate is checked;
// a gate slider moving rescores without re-rendering it, so an open Metrics block can lag the slider until the next
// render (close and reopen it to recompute), while both row lists follow every rescoring.
//
// ===================================================================================================================
// SURFACE "workbench.costs"  —  builder costsCtx(source)  —  fixture sampleCostsCtx(overrides)
// ===================================================================================================================
// The user's own priced specific mistakes (Costs → "Price specific mistakes"), in the order they were added. items()
// is [] when none are priced. The page lists every one as an editable row; shown() is items() minus what a Lab filter
// hides, in Lab's sort order, and the list shows exactly shown() (the summary reads "Lab shows N of M" with a reset).
// The prices are session configuration typed by the user: never saved, never sent to the model.
//
// Item (one priced mistake; these four fields are all an item holds):
//   question   string   a Choice, Noul or Score question id of the run
//   label      string   the labeled class (an option key, "yes"/"no", or a Score level as text "0", "1", ...)
//   answer     string   the answered class; a priced mistake is "labeled <label>, answered <answer>"
//   cost       string   the price as typed (dollars per mistake); read it with kit.toNumber
// itemName() returns "mistake <position>" (1-based in items()).
//
// data (live getters; frozen copies):
//   review, error   string   the review price and the default mistake price as typed
//   prices     null | { review, error, mistakes: [{ question, label, answer, cost: number }] }   the prices as the
//              server takes them (null while any price is invalid)
//   problem    string | null   why prices cannot be used yet (the page's message), null when they can
//   break_even number | null   1 - review / error (at least 0): the accuracy above which automating pays; null when
//              prices are invalid or a mistake costs nothing
//   questions  [{ qid, type, classes: string[] }]   the gateable questions of the run and their classes (Score levels
//              ascending), in answer order: what a mistake may name. [] before a run.
//   max_mistakes 100;  max_price 1000000
//   calibrate  { qid, threshold, cost }   Calibrate's question, slider and its cost report (shape on workbench.calibrate)
//   policy     { active, cost, cheapest }   Policy's checked gates and its two cost reports (as on workbench.policy)
//
// actions (each throws an Error with a message for the user; none calls the model):
//   replaceItems(next, { label })  writes the whole list back through the page's own edit path (the list re-renders,
//                     every cost recomputes, both unseen-row checks clear, exactly as editing a row does). Invariants
//                     (the first violation throws, naming the mistake): an array of at most 100 objects; question is a
//                     gateable question of the run; label and answer are classes of that question and differ; cost is a
//                     number from 0 to 1,000,000 (typed text or a number; written back as text); no (question,
//                     label, answer) appears twice. Other fields are dropped. An unchanged list writes nothing.
//                     Returns { changed }.
//   importItems(items, { label })  appends after the existing mistakes through replaceItems (same invariants).
//   setPrices(review, error)  the two price fields (number or numeric text, 0 to 1,000,000; null keeps one as it
//                     is), recomputing as typing does. Guard: a run with a gateable question.
//
// refresh() re-lists the priced mistakes from shown(). The page renders this surface's Lab section at the foot of the
// Costs panel, which shows while the run has a Choice, Noul or Score question. An applied edit re-renders the panel
// (its prices, its list and the Lab section) a moment later, with the edit's Undo in place.
//
// ===================================================================================================================
// CONTENT BOUNDARIES (all three surfaces)
//   - Every answer, signal, verdict, cost and interval comes from the current user's own Bulk run in this page session
//     and arithmetic on it. Show, measure and export them; never store them, never present them as another run's,
//     never fill a gap with a guess, and never ship sample answers or results in a pack.
//   - Held-out test rows never appear and must not be inferred: read rows only from items() and the reports here.
//   - Aggregate exports (counts, rates, thresholds, intervals, option keys, question ids, prices) say so. An export
//     with per-row values names the row numbering (Bulk "#"), says it holds your run's answers and labels, and leaves
//     input text out unless its label says it is included. CSV goes through csvText/csvCell (formula escaping).
//   - Nothing here is persisted: a dataset or check keeps configuration and human labels only, through the page's own
//     save actions, never answers, measured results, candidates or prices from a pack.
//   - Statistics keep the page's wording: say measured, not promised; tuned numbers are optimistic until checked on
//     unseen rows; intervals treat rows as independent; slice and per-class comparisons are exploratory and
//     unadjusted. A second figure next to a server number (another ECE, interval or cost) carries a distinct label and
//     must not contradict it. A threshold a pack proposes is advisory until the user applies it through an action.
//   - Answer-set cuts only assist review; thresholds and rules decide automation.
import { clone } from "../kit.js";
import { holdsBackNothing } from "../../prune.js";

const TYPES = Object.freeze(["choice", "noul", "score", "box"]);
const GATEABLE = Object.freeze(["choice", "noul", "score"]);
const SIGNALS = Object.freeze(["confidence", "top_probability"]);
const BOUNDS = Object.freeze(["estimate", "lower"]);
const SET_COVERAGES = Object.freeze([0.8, 0.9, 0.95, 0.99]);
const MAX_GATES = 10;
const MAX_MISTAKES = 100;
const MAX_PRICE = 1e6;
const EMPTY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const integer = (value) => (Number.isInteger(value) ? value : null);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const round2 = (value) => Math.round(value * 100) / 100;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A frozen copy of a raw page value, made once per raw object (every rescoring installs a new report object).
const COPIES = new WeakMap();
function frozenCopy(raw) {
  if (!raw || typeof raw !== "object") return raw === undefined ? null : raw;
  if (!COPIES.has(raw)) COPIES.set(raw, deepFreeze(clone(raw)));
  return COPIES.get(raw);
}

// A source field: a value, or a function that returns the value now. Errors and null read as the fallback.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("This panel cannot do that here.");
  return source[name](...args);
}

function pick(list, value, fallback) {
  return list.includes(value) ? value : fallback;
}

// ---------- rows of the run ----------

const isTestRow = (row) => isObject(row) && row._test === true;

// The row as the Bulk table prints it (static/js/workbench-bulk.js rowText), without the test marker.
function analysisRowText(row) {
  if (isObject(row) && "_test" in row) {
    const { _test, ...rest } = row;
    row = rest;
  }
  if (typeof row === "string") return row;
  if (isObject(row) && Object.keys(row).length === 1 && typeof row.text === "string") return row.text;
  return JSON.stringify(row) ?? "";
}

function plainRow(row) {
  if (row === undefined) return null;
  if (!isObject(row)) return clone(row) ?? null;
  const { _test, _expect, ...rest } = row;
  return clone(rest);
}

// { byIndex: Map(index -> result entry), testIndexes: Set } for a run, built once per result object.
const RUNS = new WeakMap();
function runIndex(result) {
  if (!isObject(result) || !Array.isArray(result.results)) return { byIndex: new Map(), test: new Set() };
  if (!RUNS.has(result)) {
    const byIndex = new Map(), test = new Set();
    for (const entry of result.results) {
      if (!isObject(entry) || !Number.isInteger(entry.index)) continue;
      byIndex.set(entry.index, entry);
      if (isTestRow(entry.row)) test.add(entry.index);
    }
    RUNS.set(result, { byIndex, test });
  }
  return RUNS.get(result);
}

function runCounts(result) {
  if (!isObject(result) || !Array.isArray(result.results)) return null;
  const rows = result.results.filter(isObject);
  return deepFreeze({ rows: rows.length, answered: rows.filter((r) => isObject(r.answers) && !isTestRow(r.row)).length,
    held_out: rows.filter((r) => isTestRow(r.row)).length });
}

function rowFields(entry, index) {
  const row = entry ? entry.row : undefined;
  return { index, number: index + 1, text: entry ? analysisRowText(row) : "", row: plainRow(row),
    image: isObject(row) && typeof row._image === "string" && row._image ? row._image : null };
}

// The answered questions of a run, as bulkQuestionsForResult: the first answered row's answers.
function answeredQuestions(result) {
  if (!isObject(result) || !Array.isArray(result.results)) return {};
  const first = result.results.find((entry) => isObject(entry) && isObject(entry.answers));
  return first ? first.answers : {};
}

function labeledSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value : []);
}

// The classes a priced mistake may name (workbench-calibrate.js answerClasses).
function classesOf(answer) {
  if (!isObject(answer)) return [];
  if (answer.type === "noul") return ["yes", "no"];
  const keys = Object.keys(isObject(answer.probabilities) ? answer.probabilities : {});
  return answer.type === "score" ? keys.sort((a, b) => Number(a) - Number(b)) : keys;
}

function shownList(source, items, ctx) {
  const list = items.filter((item) => !source.matches || source.matches(item, ctx) !== false);
  const arranged = source.arrange ? source.arrange(list, ctx) : list;
  return Array.isArray(arranged) ? arranged : list;
}

const rowName = (item, index) => (item && Number.isInteger(item.number) ? `#${item.number}` : String(index + 1));

// ---------- workbench.calibrate ----------

function setsBy(sets, qid, type) {
  const map = new Map();
  if (!isObject(sets) || sets.type !== type || !Array.isArray(sets.rows) || sets.cut === null || sets.cut === undefined) return map;
  for (const row of sets.rows) {
    if (!isObject(row) || !Number.isInteger(row.index)) continue;
    map.set(row.index, { options: Array.isArray(row.set) ? row.set.map(String) : [], size: integer(row.size) ?? 0, covered: row.covered === true,
      route: row.route === "auto" ? "auto" : "review", probabilities: isObject(row.probabilities) ? clone(row.probabilities) : {} });
  }
  return map;
}

const CAL_ITEMS = new WeakMap();
function calItems(report, result, qid, sets) {
  const known = CAL_ITEMS.get(report);
  if (known && known.result === result && known.qid === qid && known.sets === sets) return known.items;
  const { byIndex, test } = runIndex(result);
  const type = pick(TYPES, report.type, null);
  const setMap = setsBy(sets, qid, type);
  const items = deepFreeze((Array.isArray(report.rows) ? report.rows : []).filter((row) => isObject(row) && Number.isInteger(row.index) && !test.has(row.index))
    .map((row) => {
      const entry = byIndex.get(row.index);
      const answer = entry && isObject(entry.answers) && isObject(entry.answers[qid]) ? clone(entry.answers[qid]) : null;
      return { ...rowFields(entry, row.index), type, label: String(row.label ?? ""), predicted: String(row.predicted ?? ""), correct: row.correct === true,
        signal: finite(row.signal) ?? 0, top: finite(row.top) ?? 0, answer, set: setMap.get(row.index) || null };
    }));
  CAL_ITEMS.set(report, { result, qid, sets, items });
  return items;
}

// source: {
//   result()        W.bulk.result (null before a run)
//   report()        W.bulk.cal.report;   qid(), signal(), bound(), threshold()   W.bulk.cal fields
//   labeledQids()   a Set (or array) of question ids that carry a label on some row (labeledQids(W.bulk))
//   cost(), holdout(), sets() (W.bulk.sets.report), setsCoverage(), attached(), slices() (W.bulk.slice.cal)
//   matches(item, ctx), arrange(items, ctx)   LAB.matches / LAB.arrange for "workbench.calibrate"
//   refresh()
//   setThreshold(t), selectQuestion(qid), setSignal(signal), setBound(bound), setCoverage(coverage), checkUnseen()
//   holdoutReady()  the unseen-row panel is on screen
// }
export function calibrateCtx(source = {}) {
  const result = () => {
    const value = read(source, "result", null);
    return isObject(value) && Array.isArray(value.results) ? value : null;
  };
  const qid = () => {
    const value = read(source, "qid", null);
    return result() && typeof value === "string" && value ? value : null;
  };
  const report = () => {
    const value = read(source, "report", null);
    return result() && qid() && isObject(value) && Array.isArray(value.rows) ? value : null;
  };
  const labeledReport = () => {
    const rep = report();
    return rep && integer(rep.labeled) > 0 ? rep : null;
  };
  const questions = () => answeredQuestions(result());
  const typeNow = () => pick(TYPES, report()?.type ?? questions()[qid()]?.type, null);
  const threshold = () => {
    const value = finite(read(source, "threshold", 0.5));
    return value === null ? 0.5 : Math.min(1, Math.max(0, round2(value)));
  };
  const sets = () => {
    const value = read(source, "sets", null);
    return isObject(value) && qid() ? value : null;
  };
  const items = () => {
    const rep = report();
    return rep ? calItems(rep, result(), qid(), sets()) : EMPTY;
  };
  const needRun = () => { if (!result()) throw new Error("Run the rows in Bulk first: Calibrate reads that run's answers."); };
  const ctx = {
    items,
    shown: () => shownList(source, items(), ctx),
    data: {
      get qid() { return qid(); },
      get type() { return typeNow(); },
      get signal() { return pick(SIGNALS, report()?.signal ?? read(source, "signal", "confidence"), "confidence"); },
      get bound() { return pick(BOUNDS, report()?.bound ?? read(source, "bound", "estimate"), "estimate"); },
      get threshold() { return threshold(); },
      get questions() {
        const labeled = labeledSet(read(source, "labeledQids", null));
        return deepFreeze(Object.entries(questions()).map(([id, answer]) => ({ qid: id, type: pick(TYPES, answer?.type, null), labeled: labeled.has(id) })));
      },
      get report() { return frozenCopy(report()); },
      get at() {
        const rep = labeledReport();
        const point = rep && Array.isArray(rep.sweep) ? rep.sweep[Math.round(threshold() * 100)] : null;
        return isObject(point) ? frozenCopy(point) : null;
      },
      get signals() { return isObject(report()?.signals) ? frozenCopy(report().signals) : EMPTY_OBJECT; },
      get cost() {
        const value = read(source, "cost", null);
        return labeledReport() && isObject(value) ? frozenCopy(value) : null;
      },
      get holdout() {
        const value = read(source, "holdout", null);
        return result() && isObject(value) ? frozenCopy(value) : null;
      },
      get sets() { return frozenCopy(sets()); },
      get sets_coverage() { return pick(SET_COVERAGES, read(source, "setsCoverage", 0.9), 0.9); },
      get attached() {
        const value = read(source, "attached", null);
        return isObject(value) ? frozenCopy(value) : EMPTY_OBJECT;
      },
      get slices() {
        const value = read(source, "slices", null);
        return labeledReport() && isObject(value) ? frozenCopy(value) : null;
      },
      get run() { return runCounts(result()); },
    },
    actions: {
      setThreshold(value) {
        if (!labeledReport()) throw new Error("There is no labeled Calibrate report to set a threshold on yet.");
        const t = finite(value);
        if (t === null || t < 0 || t > 1) throw new Error("A threshold is a number from 0 to 1.");
        const rounded = round2(t);
        call(source, "setThreshold", rounded);
        return rounded;
      },
      selectQuestion(id) {
        needRun();
        if (typeof id !== "string" || !hasOwn(questions(), id)) throw new Error(`“${String(id)}” is not a question this run answered.`);
        return call(source, "selectQuestion", id);
      },
      setSignal(signal) {
        needRun();
        if (!SIGNALS.includes(signal)) throw new Error("Gate on confidence or top_probability.");
        return call(source, "setSignal", signal);
      },
      setBound(bound) {
        needRun();
        if (!BOUNDS.includes(bound)) throw new Error("Targets use estimate (these rows) or lower (95% confidence).");
        return call(source, "setBound", bound);
      },
      setCoverage(coverage) {
        needRun();
        if (!SET_COVERAGES.includes(coverage)) throw new Error("Answer sets hold the right answer 80%, 90%, 95% or 99% of the time.");
        if (!GATEABLE.includes(typeNow())) throw new Error("Answer sets need a Choice, Noul or Score question.");
        return call(source, "setCoverage", coverage);
      },
      checkUnseen() {
        if (!labeledReport()) throw new Error("Label some rows first: the check tunes on labeled rows.");
        if (!GATEABLE.includes(typeNow())) throw new Error("The check on unseen rows needs a Choice, Noul or Score question.");
        if (read(source, "holdout", null)?.running) throw new Error("The check on unseen rows is already running.");
        if (read(source, "holdoutReady", true) !== true) throw new Error("Open the Bulk tab to run the check.");
        return call(source, "checkUnseen");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: rowName,
  };
  return ctx;
}

// ---------- workbench.policy ----------

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

const POL_ITEMS = new WeakMap();
function polItems(report, result) {
  const known = POL_ITEMS.get(report);
  if (known && known.result === result) return known.items;
  const { byIndex, test } = runIndex(result);
  const items = deepFreeze((Array.isArray(report.rows) ? report.rows : []).filter((row) => isObject(row) && Number.isInteger(row.index) && !test.has(row.index))
    .map((row) => {
      const automated = row.automated === true, correct = row.correct === true;
      const answers = {};
      for (const [id, entry] of Object.entries(isObject(row.answers) ? row.answers : {})) {
        if (!isObject(entry)) continue;
        answers[id] = { answer: String(entry.answer ?? ""), label: String(entry.label ?? ""), signal: finite(entry.signal) ?? 0 };
      }
      return { ...rowFields(byIndex.get(row.index), row.index), outcome: automated ? (correct ? "right" : "wrong") : "review", automated, correct,
        held: stringList(row.held), wrong: stringList(row.wrong), rules: Array.isArray(row.rules) ? row.rules.filter(Number.isInteger) : [], answers };
    }));
  POL_ITEMS.set(report, { result, items });
  return items;
}

// source: {
//   result(), report() (W.bulk.policy.report), gates() (W.bulk.policy.gates), signal(), bound(), labeledQids()
//   tunes(), cost(), cheapest(), holdout(), prune() (W.bulk.policy.prune), rules() (W.bulk.rules), rulesInForce()
//   (policyRules()), slices() (W.bulk.slice.pol), requestReady() (!!W.bulk.ranQuestions), holdoutReady()
//   matches, arrange, refresh
//   setThresholds(map), setGate(qid, on), setSignal(signal), setBound(bound), checkUnseen(), checkGates(), exportGate()
// }
export function policyCtx(source = {}) {
  const result = () => {
    const value = read(source, "result", null);
    return isObject(value) && Array.isArray(value.results) ? value : null;
  };
  const gateable = () => Object.entries(answeredQuestions(result())).filter(([, answer]) => GATEABLE.includes(answer?.type));
  const gates = () => {
    const raw = read(source, "gates", {});
    const out = {};
    for (const [id] of gateable()) {
      const gate = isObject(raw) && isObject(raw[id]) ? raw[id] : {};
      out[id] = { on: gate.on === true, t: finite(gate.t) ?? 0.5 };
    }
    return out;
  };
  const active = () => Object.fromEntries(Object.entries(gates()).filter(([, gate]) => gate.on).map(([id, gate]) => [id, gate.t]));
  const report = () => {
    const value = read(source, "report", null);
    return result() && Object.keys(active()).length && isObject(value) && Array.isArray(value.rows) ? value : null;
  };
  const items = () => {
    const rep = report();
    return rep ? polItems(rep, result()) : EMPTY;
  };
  const needRun = () => { if (!result()) throw new Error("Run the rows in Bulk first: Policy reads that run's answers."); };
  const needGate = () => {
    needRun();
    if (!Object.keys(active()).length) throw new Error("Check at least one question to gate.");
  };
  const thresholds = (map) => {
    needGate();
    if (!isObject(map) || !Object.keys(map).length) throw new Error("Name at least one checked gate and its threshold.");
    const on = active();
    const out = {};
    for (const [id, value] of Object.entries(map)) {
      if (!hasOwn(on, id)) throw new Error(`“${id}” is not a checked gate.`);
      const t = finite(value);
      if (t === null || t < 0 || t > 1) throw new Error(`${id}: a threshold is a number from 0 to 1.`);
      out[id] = round2(t);
    }
    return out;
  };
  const ctx = {
    items,
    shown: () => shownList(source, items(), ctx),
    data: {
      get signal() { return pick(SIGNALS, report()?.signal ?? read(source, "signal", "confidence"), "confidence"); },
      get bound() { return pick(BOUNDS, read(source, "bound", "estimate"), "estimate"); },
      get gates() { return deepFreeze(gates()); },
      get active() { return deepFreeze(active()); },
      get max_gates() { return MAX_GATES; },
      get questions() {
        const labeled = labeledSet(read(source, "labeledQids", null));
        const all = gates();
        return deepFreeze(gateable().map(([id, answer]) => ({ qid: id, type: answer.type, labeled: labeled.has(id), on: all[id].on, t: all[id].t })));
      },
      get report() { return frozenCopy(report()); },
      get tunes() {
        const value = read(source, "tunes", null);
        return report() && isObject(value) ? frozenCopy(value) : null;
      },
      get cost() {
        const value = read(source, "cost", null);
        return report() && isObject(value) ? frozenCopy(value) : null;
      },
      get cheapest() {
        const value = read(source, "cheapest", null);
        return result() && Object.keys(active()).length && isObject(value) ? frozenCopy(value) : null;
      },
      get holdout() {
        const value = read(source, "holdout", null);
        return result() && isObject(value) ? frozenCopy(value) : null;
      },
      get prune() {
        const raw = read(source, "prune", {});
        const rep = isObject(raw.report) && result() ? raw.report : null;
        let copy = null;
        if (rep) {
          copy = clone(rep);
          if (Array.isArray(copy.gated)) for (const g of copy.gated) if (isObject(g)) g.holds_back_nothing = holdsBackNothing(g, copy.baseline);
        }
        return deepFreeze({ target: finite(raw.target) ?? 0.95, running: raw.running === true, report: copy });
      },
      get rules() {
        const raw = read(source, "rules", {});
        const text = (value) => (typeof value === "string" ? value : "");
        return deepFreeze({ text: text(raw.text), applied: text(raw.applied), hold: raw.hold === true, in_force: text(read(source, "rulesInForce", "")),
          error: typeof raw.error === "string" && raw.error ? raw.error : null, report: isObject(raw.report) && result() ? clone(raw.report) : null });
      },
      get slices() {
        const value = read(source, "slices", null);
        return report() && isObject(value) ? frozenCopy(value) : null;
      },
      get run() { return runCounts(result()); },
      get request_ready() { return read(source, "requestReady", false) === true; },
    },
    actions: {
      setThreshold(id, value) {
        const map = thresholds({ [id]: value });
        return call(source, "setThresholds", map);
      },
      setThresholds(map) {
        return call(source, "setThresholds", thresholds(map));
      },
      setGate(id, on) {
        needRun();
        const all = gates();
        if (typeof id !== "string" || !hasOwn(all, id)) throw new Error(`“${String(id)}” is not a Choice, Noul or Score question of this run.`);
        if (typeof on !== "boolean") throw new Error("Say whether to check (true) or uncheck (false) the gate.");
        if (all[id].on === on) throw new Error(`${id} is already ${on ? "checked" : "unchecked"}.`);
        if (on && Object.keys(active()).length >= MAX_GATES) throw new Error(`At most ${MAX_GATES} gates can be checked. Uncheck one first.`);
        return call(source, "setGate", id, on);
      },
      setSignal(signal) {
        needRun();
        if (!SIGNALS.includes(signal)) throw new Error("Gate on confidence or top_probability.");
        return call(source, "setSignal", signal);
      },
      setBound(bound) {
        needRun();
        if (!BOUNDS.includes(bound)) throw new Error("Targets use estimate (these rows) or lower (95% confidence).");
        return call(source, "setBound", bound);
      },
      checkUnseen() {
        needGate();
        if (read(source, "holdout", null)?.running) throw new Error("The check on unseen rows is already running.");
        if (read(source, "holdoutReady", true) !== true) throw new Error("Open the Bulk tab to run the check.");
        return call(source, "checkUnseen");
      },
      checkGates() {
        needGate();
        if (read(source, "prune", {})?.running) throw new Error("The gate check is already running.");
        if (read(source, "requestReady", false) !== true) throw new Error("Run the rows in Bulk first: the check reads the questions that run asked.");
        return call(source, "checkGates");
      },
      exportGate() {
        needGate();
        return call(source, "exportGate");
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: rowName,
  };
  return ctx;
}

// ---------- workbench.costs ----------

// A price as the page reads one (costsPayload): nonblank text or a number from 0 to 1,000,000, else null.
function priceOf(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= MAX_PRICE ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  const number = Number(text);
  return text !== "" && Number.isFinite(number) && number >= 0 && number <= MAX_PRICE ? number : null;
}

function mistakeItem(raw) {
  return { question: String(raw?.question ?? ""), label: String(raw?.label ?? ""), answer: String(raw?.answer ?? ""),
    cost: typeof raw?.cost === "number" ? String(raw.cost) : String(raw?.cost ?? "") };
}

// source: {
//   result()       W.bulk.result;   costs()   W.bulk.costs ({ review, error, mistakes } as typed)
//   payload()      costsPayload(): { costs | null, problem | null }
//   calQid(), calThreshold(), calCost(), active() (activeGates()), policyCost(), cheapest()
//   matches, arrange, refresh
//   write(mistakes, label)   replace W.bulk.costs.mistakes through the page's edit path
//   setPrices(review, error) set the two price strings and recompute as typing does
// }
export function costsCtx(source = {}) {
  const result = () => {
    const value = read(source, "result", null);
    return isObject(value) && Array.isArray(value.results) ? value : null;
  };
  const questionList = () => Object.entries(answeredQuestions(result())).filter(([, answer]) => GATEABLE.includes(answer?.type))
    .map(([id, answer]) => ({ qid: id, type: answer.type, classes: classesOf(answer) }));
  const raw = () => {
    const value = read(source, "costs", {});
    return isObject(value) ? value : {};
  };
  let built = { key: null, items: EMPTY };
  const items = () => {
    const list = Array.isArray(raw().mistakes) ? raw().mistakes : [];
    const key = JSON.stringify(list);
    if (built.key !== key) built = { key, items: deepFreeze(list.map(mistakeItem)) };
    return built.items;
  };
  const payload = () => {
    const value = read(source, "payload", null);
    return isObject(value) ? value : { costs: null, problem: "Prices are not available." };
  };
  // The list next as the page would store it, or an Error naming the first mistake at fault.
  const validate = (next) => {
    if (!Array.isArray(next)) throw new Error("An edit must give a list of priced mistakes.");
    if (next.length > MAX_MISTAKES) throw new Error(`At most ${MAX_MISTAKES} mistakes can be priced; the edit gives ${next.length}.`);
    const byQid = new Map(questionList().map((q) => [q.qid, q]));
    const seen = new Set();
    return next.map((entry, i) => {
      const where = `Mistake ${i + 1}`;
      if (!isObject(entry)) throw new Error(`${where} must be an object with question, label, answer and cost.`);
      const question = byQid.get(entry.question);
      if (!question) throw new Error(`${where}: “${String(entry.question)}” is not a Choice, Noul or Score question of this run.`);
      const label = String(entry.label ?? ""), answer = String(entry.answer ?? "");
      if (!question.classes.includes(label)) throw new Error(`${where}: “${label}” is not an option of ${question.qid}.`);
      if (!question.classes.includes(answer)) throw new Error(`${where}: “${answer}” is not an option of ${question.qid}.`);
      if (label === answer) throw new Error(`${where}: the answer must differ from the label, or it is not a mistake.`);
      const price = priceOf(entry.cost);
      if (price === null) throw new Error(`${where}: the price must be a number from 0 to 1,000,000.`);
      const key = JSON.stringify([question.qid, label, answer]);
      if (seen.has(key)) throw new Error(`${where}: ${question.qid} labeled ${label}, answered ${answer} is priced twice.`);
      seen.add(key);
      return { question: question.qid, label, answer, cost: typeof entry.cost === "number" ? String(entry.cost) : String(entry.cost).trim() };
    });
  };
  const ctx = {
    items,
    shown: () => shownList(source, items(), ctx),
    data: {
      get review() { return String(raw().review ?? ""); },
      get error() { return String(raw().error ?? ""); },
      get prices() { return isObject(payload().costs) ? frozenCopy(payload().costs) : null; },
      get problem() {
        const value = payload().problem;
        return typeof value === "string" && value ? value : null;
      },
      get break_even() {
        const prices = payload().costs;
        if (!isObject(prices) || !(finite(prices.error) > 0) || finite(prices.review) === null) return null;
        return Math.max(0, 1 - prices.review / prices.error);
      },
      get questions() { return deepFreeze(questionList()); },
      get max_mistakes() { return MAX_MISTAKES; },
      get max_price() { return MAX_PRICE; },
      get calibrate() {
        const qid = read(source, "calQid", null);
        const t = finite(read(source, "calThreshold", 0.5));
        const cost = read(source, "calCost", null);
        return deepFreeze({ qid: result() && typeof qid === "string" ? qid : null, threshold: t === null ? 0.5 : t,
          cost: result() && isObject(cost) ? clone(cost) : null });
      },
      get policy() {
        const on = read(source, "active", {});
        const cost = read(source, "policyCost", null), cheapest = read(source, "cheapest", null);
        return deepFreeze({ active: result() && isObject(on) ? clone(on) : {}, cost: result() && isObject(cost) ? clone(cost) : null,
          cheapest: result() && isObject(cheapest) ? clone(cheapest) : null });
      },
    },
    actions: {
      replaceItems(next, options = {}) {
        if (!questionList().length) throw new Error("Run the rows in Bulk first: a mistake names a question of that run.");
        const list = validate(next);
        if (JSON.stringify(list) === JSON.stringify(items())) return { changed: false };
        call(source, "write", list, String(options?.label || "Lab edit"));
        return { changed: true };
      },
      importItems(added, options = {}) {
        if (!Array.isArray(added) || !added.length) throw new Error("There is nothing to add.");
        return ctx.actions.replaceItems([...items().map((item) => ({ ...item })), ...added], options);
      },
      setPrices(review, error) {
        if (!questionList().length) throw new Error("Run the rows in Bulk first: prices apply to that run's questions.");
        const read1 = (value, what, current) => {
          if (value === null || value === undefined) return current;
          const price = priceOf(value);
          if (price === null) throw new Error(`${what} must be a number from 0 to 1,000,000.`);
          return typeof value === "number" ? String(value) : String(value).trim();
        };
        const next = [read1(review, "The review price", String(raw().review ?? "")), read1(error, "The mistake price", String(raw().error ?? ""))];
        return call(source, "setPrices", next[0], next[1]);
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => {
      const at = items().indexOf(item);
      return `mistake ${(at >= 0 ? at : index) + 1}`;
    },
  };
  return ctx;
}
