// Lab surface of Policy on the Workbench Bulk tab (static/js/workbench-policy.js, with "Do the gates earn their
// place?" from prune.js). Everything Policy shows is plain arithmetic over the answers of the CURRENT USER'S OWN latest
// Bulk run in this page session: nothing here calls the model. Pure code: it imports the kit and the DOM-free prune.js
// only, and touches no DOM, storage or network. Tests: tests/js/lab/surface-wb-policy.test.mjs. Fixtures for pack
// tests: tests/js/lab/fixtures/workbench-analysis.mjs (samplePolicyCtx).
// This header is the CONTRACT for packs on this surface.
//
// The ctx is { items(), shown(), data, actions, refresh(), itemName(item, index) }. The page builds it once per page
// session; every field reads the page state when called, so read a value when you need it and keep nothing across
// renders. items() and shown() return the SAME frozen item objects (compare by identity) until the list itself changes
// (a new report, a new run). Items and data values are deeply frozen copies: never write to them.
//
// Row numbering: `index` is the row's 0-based position in the Bulk run, the number the Bulk results table prints as
// "#" minus one; `number` is index + 1. Held-out test rows ("_test": true) never appear on this surface: the reports
// are computed from tuning rows only (tuningResults), and the builder drops any row of a test row even if a stale
// report named one. data.run.held_out is a COUNT of test rows, never their content. A test score exists only through
// Policy's explicit "Score this gate on N test rows" action, which is not on this surface.
//
// Shared value vocabulary:
//   signal   "confidence" | "top_probability"     what a gate compares with its threshold. "confidence" is the answer's
//            confidence field (a Choice/Score without one: how far the top probability sits above an even split; a
//            Noul: |2p - 1|); "top_probability" is the probability of the prediction (Noul: max(p, 1 - p)). A row is
//            AUTOMATED at threshold t when signal + 1e-9 >= t (the page's tie rule).
//   bound    "estimate" | "lower"   whether accuracy targets must hold on these rows or at the 95% Wilson lower bound
//   answers and labels are shown as Calibrate shows them: a Choice option key, "yes"/"no" for a Noul (right means
//            P(yes) >= 0.5 agrees with the label), a Score level as text ("2"; right means the most likely level).
//   intervals are 95% Wilson (Z = 1.959964): low = 0 when none are right and high = 1 when all are.
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
//   index      integer   0-based row of the run (see Row numbering). Unique. itemName() returns "#<number>".
//   number     integer   index + 1
//   text       string    the row as the Bulk table prints it (an object with only "text" reads as its text, anything
//                        else as compact JSON); "" when the run has no such row
//   row        string | object | array | null   the row as run, without "_test" and "_expect" ("_image" stays)
//   image      string | null   the row's picture name ("_image")
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
//   holdout    null | { running: true } | the "Check on unseen rows" report for the checked gates: { signal, bound,
//              folds, labeled, minimum, problem, targets: [{ target, tuned, unseen, gap, below, unreached, spread,
//              parts, needed }], cost? }. null until the user asks, and again after any change.
//   prune      { target, running, report }   "Do the gates earn their place?": report null | { signal, bound, target,
//              labeled, baseline: { gates | null, labeled, automated, coverage, accuracy, low, high }, gated: [{ qid,
//              type, share, rules, off, dropped | null, holds_back_nothing }], unused: [{ qid, type, share }], chars }
//              (holds_back_nothing is prune.js holdsBackNothing, added here)
//   rules      { text (as typed), applied (accepted text), hold (Policy sends rule-breaking rows to review),
//              in_force (the text Policy applies now, "" when none), error, report | null (jev/rules.py report) }
//   slices     null | Policy's "By slice" report: { fields: [{ name, values }], field, slices: [{ value, rows,
//              accuracy, accuracy_low, accuracy_high, automated, coverage, automated_accuracy, automated_low,
//              automated_high, wrong_automated, below, below_all, p, p_all }], overall }. null until computed.
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
// CONTENT BOUNDARIES
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

const GATEABLE = Object.freeze(["choice", "noul", "score"]);
const SIGNALS = Object.freeze(["confidence", "top_probability"]);
const BOUNDS = Object.freeze(["estimate", "lower"]);
const MAX_GATES = 10;
const EMPTY = Object.freeze([]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const hasOwn = (object, key) => Object.hasOwn(object, key);
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
  try {
    value = typeof source[name] === "function" ? source[name]() : source[name];
  } catch {
    value = undefined;
  }
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
    const byIndex = new Map(),
      test = new Set();
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
  return deepFreeze({
    rows: rows.length,
    answered: rows.filter((r) => isObject(r.answers) && !isTestRow(r.row)).length,
    held_out: rows.filter((r) => isTestRow(r.row)).length,
  });
}

function rowFields(entry, index) {
  const row = entry ? entry.row : undefined;
  return {
    index,
    number: index + 1,
    text: entry ? analysisRowText(row) : "",
    row: plainRow(row),
    image: isObject(row) && typeof row._image === "string" && row._image ? row._image : null,
  };
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

function shownList(source, items, ctx) {
  const list = items.filter((item) => !source.matches || source.matches(item, ctx) !== false);
  const arranged = source.arrange ? source.arrange(list, ctx) : list;
  return Array.isArray(arranged) ? arranged : list;
}

const rowName = (item, index) => (item && Number.isInteger(item.number) ? `#${item.number}` : String(index + 1));

// ---------- workbench.policy ----------

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

const POL_ITEMS = new WeakMap();
function polItems(report, result) {
  const known = POL_ITEMS.get(report);
  if (known && known.result === result) return known.items;
  const { byIndex, test } = runIndex(result);
  const items = deepFreeze(
    (Array.isArray(report.rows) ? report.rows : [])
      .filter((row) => isObject(row) && Number.isInteger(row.index) && !test.has(row.index))
      .map((row) => {
        const automated = row.automated === true,
          correct = row.correct === true;
        const answers = {};
        for (const [id, entry] of Object.entries(isObject(row.answers) ? row.answers : {})) {
          if (!isObject(entry)) continue;
          answers[id] = {
            answer: String(entry.answer ?? ""),
            label: String(entry.label ?? ""),
            signal: finite(entry.signal) ?? 0,
          };
        }
        return {
          ...rowFields(byIndex.get(row.index), row.index),
          outcome: automated ? (correct ? "right" : "wrong") : "review",
          automated,
          correct,
          held: stringList(row.held),
          wrong: stringList(row.wrong),
          rules: Array.isArray(row.rules) ? row.rules.filter(Number.isInteger) : [],
          answers,
        };
      }),
  );
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
  const gateable = () =>
    Object.entries(answeredQuestions(result())).filter(([, answer]) => GATEABLE.includes(answer?.type));
  const gates = () => {
    const raw = read(source, "gates", {});
    const out = {};
    for (const [id] of gateable()) {
      const gate = isObject(raw) && isObject(raw[id]) ? raw[id] : {};
      out[id] = { on: gate.on === true, t: finite(gate.t) ?? 0.5 };
    }
    return out;
  };
  const active = () =>
    Object.fromEntries(
      Object.entries(gates())
        .filter(([, gate]) => gate.on)
        .map(([id, gate]) => [id, gate.t]),
    );
  const report = () => {
    const value = read(source, "report", null);
    return result() && Object.keys(active()).length && isObject(value) && Array.isArray(value.rows) ? value : null;
  };
  const items = () => {
    const rep = report();
    return rep ? polItems(rep, result()) : EMPTY;
  };
  const needRun = () => {
    if (!result()) throw new Error("Run the rows in Bulk first: Policy reads that run's answers.");
  };
  const needGate = () => {
    needRun();
    if (!Object.keys(active()).length) throw new Error("Check at least one question to gate.");
  };
  const thresholds = (map) => {
    needGate();
    if (!isObject(map) || !Object.keys(map).length)
      throw new Error("Name at least one checked gate and its threshold.");
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
      get signal() {
        return pick(SIGNALS, report()?.signal ?? read(source, "signal", "confidence"), "confidence");
      },
      get bound() {
        return pick(BOUNDS, read(source, "bound", "estimate"), "estimate");
      },
      get gates() {
        return deepFreeze(gates());
      },
      get active() {
        return deepFreeze(active());
      },
      get max_gates() {
        return MAX_GATES;
      },
      get questions() {
        const labeled = labeledSet(read(source, "labeledQids", null));
        const all = gates();
        return deepFreeze(
          gateable().map(([id, answer]) => ({
            qid: id,
            type: answer.type,
            labeled: labeled.has(id),
            on: all[id].on,
            t: all[id].t,
          })),
        );
      },
      get report() {
        return frozenCopy(report());
      },
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
          if (Array.isArray(copy.gated))
            for (const g of copy.gated) if (isObject(g)) g.holds_back_nothing = holdsBackNothing(g, copy.baseline);
        }
        return deepFreeze({ target: finite(raw.target) ?? 0.95, running: raw.running === true, report: copy });
      },
      get rules() {
        const raw = read(source, "rules", {});
        const text = (value) => (typeof value === "string" ? value : "");
        return deepFreeze({
          text: text(raw.text),
          applied: text(raw.applied),
          hold: raw.hold === true,
          in_force: text(read(source, "rulesInForce", "")),
          error: typeof raw.error === "string" && raw.error ? raw.error : null,
          report: isObject(raw.report) && result() ? clone(raw.report) : null,
        });
      },
      get slices() {
        const value = read(source, "slices", null);
        return report() && isObject(value) ? frozenCopy(value) : null;
      },
      get run() {
        return runCounts(result());
      },
      get request_ready() {
        return read(source, "requestReady", false) === true;
      },
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
        if (typeof id !== "string" || !hasOwn(all, id))
          throw new Error(`“${String(id)}” is not a Choice, Noul or Score question of this run.`);
        if (typeof on !== "boolean") throw new Error("Say whether to check (true) or uncheck (false) the gate.");
        if (all[id].on === on) throw new Error(`${id} is already ${on ? "checked" : "unchecked"}.`);
        if (on && Object.keys(active()).length >= MAX_GATES)
          throw new Error(`At most ${MAX_GATES} gates can be checked. Uncheck one first.`);
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
        if (read(source, "requestReady", false) !== true)
          throw new Error("Run the rows in Bulk first: the check reads the questions that run asked.");
        return call(source, "checkGates");
      },
      exportGate() {
        needGate();
        return call(source, "exportGate");
      },
    },
    refresh: () => {
      if (typeof source.refresh === "function") source.refresh();
    },
    itemName: rowName,
  };
  return ctx;
}
