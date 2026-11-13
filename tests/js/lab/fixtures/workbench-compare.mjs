// Fixtures for packs on the Workbench Compare surfaces (contract: static/js/lab/surfaces/workbench-compare.js).
// Not a test file.
//
//   import { sampleCompareRowsCtx, sampleCompareVariantsCtx, COMPARE_RESULT, COMPARE_REPORTS } from "./fixtures/workbench-compare.mjs";
//   const ctx = sampleCompareRowsCtx();                     // the "department" Choice question of a 7-row run
//   const noul = sampleCompareRowsCtx({ qid: "urgent" });   // also "tone" (Score) and "spot" (Box, one picture row)
//   const empty = sampleCompareRowsCtx({ result: null });   // before any run: items() is [], data mostly null/[]
//   const variants = sampleCompareVariantsCtx();            // the two editors as typed; { texts: [a, b] } overrides them
//
// Every ctx is made by the real builder from hand-written raw page state, so items and data have exactly the page's
// shapes. The answers are made up for tests; the page itself only shows answers from the user's own run.
// overrides (rows): any source field of compareRowsCtx (result, report, qid, signal, bound, first, cascadeT, slices,
//   slicesError, reportError, running, labeling). Giving qid alone picks COMPARE_REPORTS[qid] as the report. Plus
//   hide:  row indexes (0-based, item.index) that a Lab filter hides, so shown() leaves them out
//   order: row indexes in the order an active Lab sort would give (indexes not named keep their place after)
// overrides (variants): texts [a, b] (editor JSON), models [a, b], perturb, average, running, rowCount, lastRun,
//   models list as modelList, currentModel, hide (qids), order (qids).
// Each ctx carries env (fakeEnv(): toasts, copied, downloads) and log: every page action it received as
// [name, ...args], so a command test can assert what it asked the page to do.
//
// The rows run (department, signal "confidence"):
//   #1 index 0  a_only      A billing (.60) vs B shipping (.45), label billing; B sent a typo rewrite; B orders split
//   #2 index 1  b_only      A wholesale (.30) vs B shipping (.70), label shipping; object row with a picture
//   #3 index 2  agrees      both "other", label other (hidden by the page: differs false)
//   #4 index 3  differs     A billing (.85) vs B shipping (.40), no label (verdict null)
//   #5 index 4  only A      B's call failed ("Rate limit reached"), label wholesale (hidden: not paired)
//   #6 index 5  both_wrong  A billing (.36, no confidence field) vs B other (.33), label shipping
//   #7 index 6  only A      B's call was skipped by a stop (hidden)
// One held-out test row was left out by the run (data.run.held_out === 1; never present).
import { compareRowsCtx, compareVariantsCtx } from "../../../../static/js/lab/surfaces/workbench-compare.js";
import { fakeEnv } from "../harness.mjs";

const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

// ---------- the two variants' questions ----------

export const QUESTIONS_A = freeze({
  department: { type: "choice", instructions: "Which Harbor Coffee Co. team should handle this message?",
    criteria: { billing: "Charges, invoices and refunds", shipping: "Deliveries and tracking", wholesale: "Cafe and bulk orders", other: "Anything else" } },
  urgent: { type: "noul", instructions: "Does the writer need an answer today?" },
  tone: { type: "score", instructions: "How upset does the writer sound?", criteria: ["Calm", "Annoyed", "Angry"] },
  drink: { type: "choice", instructions: "Which drink is the message about?", criteria: { espresso: "Espresso drinks", filter: "Filter coffee", tea: "Tea" } },
  spot: { type: "box", instructions: "Where is the damage in the photo?" },
  rush: { type: "noul", instructions: "Is this a rush order?" },
  allergy: { type: "noul", instructions: "Does the writer mention an allergy?" },
});

export const QUESTIONS_B = freeze({
  urgent: { type: "noul", instructions: "Does the writer need an answer today?" },
  department: { type: "choice", instructions: "Team for this message?",
    criteria: { billing: "Charges, invoices and refunds", shipping: "Deliveries and tracking", wholesale: "Cafe and bulk orders", other: "Anything else" } },
  tone: { type: "score", instructions: "How upset does the writer sound?", criteria: ["Calm", "A little annoyed", "Angry"] },
  drink: { type: "choice", instructions: "Which drink is the message about?", criteria: { tea: "Tea", filter: "Filter coffee", espresso: "Espresso drinks" } },
  spot: { type: "box", instructions: "Where is the damage in the photo?" },
  rush: { type: "score", instructions: "Is this a rush order?", criteria: ["No", "Maybe", "Yes"] },
  refund: { type: "noul", instructions: "Does the writer ask for money back?" },
});

// ---------- the run (W.compare.result) ----------

const choice = (pick, probabilities, confidence) => ({ type: "choice", choice: pick, probabilities, ...(confidence === undefined ? {} : { confidence }) });
const meta = (latency, cost, input, calls) => ({ model: "jev-1.14.0", latency_ms: latency, question_count: 7, input_tokens: input, output_tokens: 40,
  cost_usd: cost, backend: "sdk", ...(calls ? { calls } : {}) });

export const COMPARE_RESULT = freeze({
  variants: [
    { name: "A", model: "jev-1.14.0", perturb: null, perturbed_rows: 0, unperturbed_rows: 0, average_orders: false, orders: null,
      questions: QUESTIONS_A, completed: 7, errors: 0, cost_usd: 0.0007, input_tokens: 2100, latency_ms_median: 410 },
    { name: "B", model: "jev-1.14.0", perturb: "typos", perturbed_rows: 4, unperturbed_rows: 1, average_orders: true,
      orders: [{ qid: "department", answered: 5, changed: 1, rate: 0.2, low: 0.036, high: 0.624 }],
      questions: QUESTIONS_B, completed: 5, errors: 1, cost_usd: 0.0012, input_tokens: 3600, latency_ms_median: 520 },
  ],
  results: [
    { index: 0, row: "My espresso grinder arrived cracked, I want a refund today.", expect: { department: "billing", urgent: true, tone: 2 },
      runs: [
        { answers: { department: choice("billing", { billing: 0.7, shipping: 0.2, wholesale: 0.05, other: 0.05 }, 0.6), urgent: { type: "noul", noul: 0.91 },
          tone: { type: "score", score: 1.5, probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 }, confidence: 0.4 } }, meta: meta(400, 0.0001, 300) },
        { answers: { department: choice("shipping", { billing: 0.3, shipping: 0.6, wholesale: 0.05, other: 0.05 }, 0.45), urgent: { type: "noul", noul: 0.88 },
          tone: { type: "score", score: 1.3, probabilities: { 0: 0.1, 1: 0.5, 2: 0.4 }, confidence: 0.25 } },
        meta: meta(560, 0.0003, 720, 2), input: "My espreso grinder arived cracked, I want a refund today.", orders: { department: ["shipping", "billing"] } },
      ] },
    { index: 1, row: { text: "Where is wholesale order HC-2231?", channel: "email", _image: "receipt.png" }, expect: { department: "shipping", urgent: false, spot: { left: 0.11, top: 0.2, right: 0.5, bottom: 0.6 } },
      runs: [
        { answers: { department: choice("wholesale", { billing: 0.1, shipping: 0.35, wholesale: 0.5, other: 0.05 }, 0.3), urgent: { type: "noul", noul: 0.62 },
          spot: { type: "box", box: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 }, confidence: 0.8 } }, meta: meta(380, 0.0001, 310) },
        { answers: { department: choice("shipping", { billing: 0.05, shipping: 0.8, wholesale: 0.1, other: 0.05 }, 0.7), urgent: { type: "noul", noul: 0.4 },
          spot: { type: "box", box: { left: 0.12, top: 0.2, right: 0.5, bottom: 0.6 }, confidence: 0.75 } },
        meta: meta(500, 0.0003, 700, 2), input: { text: "Where is wholesale ordr HC-2231?", channel: "email", _image: "receipt.png" },
        orders: { department: ["shipping", "shipping"] } },
      ] },
    { index: 2, row: "Thanks for the Ethiopia roast, best cup all year!", expect: { department: "other" },
      runs: [
        { answers: { department: choice("other", { billing: 0.05, shipping: 0.05, wholesale: 0.1, other: 0.8 }, 0.7), urgent: { type: "noul", noul: 0.05 } }, meta: meta(390, 0.0001, 290) },
        { answers: { department: choice("other", { billing: 0.03, shipping: 0.03, wholesale: 0.04, other: 0.9 }, 0.85), urgent: { type: "noul", noul: 0.08 } },
          meta: meta(470, 0.0002, 690, 2), orders: { department: ["other", "other"] } },
      ] },
    { index: 3, row: "Invoice INV-88 was charged twice on my card.",
      runs: [
        { answers: { department: choice("billing", { billing: 0.9, shipping: 0.04, wholesale: 0.03, other: 0.03 }, 0.85), urgent: { type: "noul", noul: 0.7 } }, meta: meta(420, 0.0001, 305) },
        { answers: { department: choice("shipping", { billing: 0.3, shipping: 0.55, wholesale: 0.1, other: 0.05 }, 0.4), urgent: { type: "noul", noul: 0.66 } },
          meta: meta(610, 0.0002, 710, 2), input: "Invoice INV-88 was chargd twice on my card.", orders: { department: ["shipping", "shipping"] } },
      ] },
    { index: 4, row: { text: "Cafe order for 40 bags of house blend", channel: "phone" }, expect: { department: "wholesale" },
      runs: [
        { answers: { department: choice("wholesale", { billing: 0.1, shipping: 0.1, wholesale: 0.75, other: 0.05 }, 0.6) }, meta: meta(450, 0.0001, 320) },
        { error: "Rate limit reached", meta: meta(90, 0, 0) },
      ] },
    { index: 5, row: "Do you ship to Norway?", expect: { department: "shipping" },
      runs: [
        { answers: { department: choice("billing", { billing: 0.52, shipping: 0.3, wholesale: 0.1, other: 0.08 }), urgent: { type: "noul", noul: 0.3 } }, meta: meta(410, 0.0001, 280) },
        { answers: { department: choice("other", { billing: 0.2, shipping: 0.2, wholesale: 0.1, other: 0.5 }, 0.33), urgent: { type: "noul", noul: 0.2 } },
          meta: meta(530, 0.0002, 680, 2), input: "Do you shp to Norway?", orders: { department: ["other", "billing"] } },
      ] },
    { index: 6, row: "Need a descaler for the café machine", expect: {},
      runs: [
        { answers: { department: choice("other", { billing: 0.1, shipping: 0.2, wholesale: 0.2, other: 0.5 }, 0.35) }, meta: meta(400, 0.0001, 300) },
        { skipped: true },
      ] },
  ],
  rows: 7, held_out: 1, stopped: "Session budget reached; 1 call was skipped.", labeled: 6, wall_ms: 3200, cost_usd: 0.0019,
  agreement: [
    { qid: "department", type: "choice", answered: 5, changed: 4, rate: 0.8, low: 0.376, high: 0.964, reordered: false, perturbed: false },
    { qid: "urgent", type: "noul", answered: 5, changed: 1, rate: 0.2, low: 0.036, high: 0.624, reordered: false, perturbed: false },
    { qid: "tone", type: "score", answered: 1, changed: 1, rate: 1, low: 0.207, high: 1, reordered: false, perturbed: false },
    { qid: "drink", type: "choice", answered: 0, changed: 0, rate: null, low: null, high: null, reordered: false, perturbed: false },
    { qid: "spot", type: "box", answered: 1, changed: 1, rate: 1, low: 0.207, high: 1, reordered: false, perturbed: false },
  ],
});

// ---------- the reports of the local scorer (W.compare.report), one per question ----------

// 101 sweep points from a few hand-chosen steps: [from threshold (inclusive), automated, correct].
function sweep(steps, labeled) {
  return Array.from({ length: 101 }, (_, k) => {
    const t = k / 100;
    const [, automated, correct] = [...steps].reverse().find(([from]) => t + 1e-9 >= from);
    return { threshold: t, automated, correct, coverage: labeled ? automated / labeled : 0, accuracy: automated ? correct / automated : null,
      low: automated ? 0.1 : null, high: automated ? 0.99 : null };
  });
}
const targets = () => [0.9, 0.95, 0.99].map((target) => ({ target, threshold: null, coverage: null, automated: 0, accuracy: null, low: null, high: null,
  needed: 29, plan: null }));
const score = (labeled, correct, ece, steps) => ({ labeled, unlabeled: 1, invalid: [], correct, accuracy: labeled ? correct / labeled : null,
  accuracy_low: labeled ? 0.15 : null, accuracy_high: labeled ? 0.85 : null, ece, sweep: sweep(steps, labeled), targets: targets() });

export const COMPARE_REPORTS = freeze({
  department: {
    type: "choice", signal: "confidence", bound: "estimate",
    variants: [score(4, 2, 0.21, [[0, 4, 2], [0.37, 3, 2], [0.61, 1, 1], [0.71, 0, 0]]), score(4, 2, 0.18, [[0, 4, 2], [0.34, 3, 2], [0.46, 2, 2], [0.86, 0, 0]])],
    paired: { both_right: 1, a_only: 1, b_only: 1, both_wrong: 1, rows: 4, p_value: 1 },
    answered_both: 5, agree: 1, only_a: 2, only_b: 0, excluded: 0,
    disagreements: [
      { index: 0, label: "billing", verdict: "a_only", answers: [{ predicted: "billing", signal: 0.6, correct: true }, { predicted: "shipping", signal: 0.45, correct: false }] },
      { index: 1, label: "shipping", verdict: "b_only", answers: [{ predicted: "wholesale", signal: 0.3, correct: false }, { predicted: "shipping", signal: 0.7, correct: true }] },
      { index: 3, label: null, verdict: null, answers: [{ predicted: "billing", signal: 0.85, correct: null }, { predicted: "shipping", signal: 0.4, correct: null }] },
      { index: 5, label: "shipping", verdict: "both_wrong", answers: [{ predicted: "billing", signal: 0.36, correct: false }, { predicted: "other", signal: 0.33, correct: false }] },
    ],
    cascade: { first: "A", second: "B", rows: 4,
      first_alone: { correct: 2, accuracy: 0.5, cost_usd: 0.0004, latency_ms: 397.5 }, second_alone: { correct: 2, accuracy: 0.5, cost_usd: 0.0010, latency_ms: 515 },
      sweep: Array.from({ length: 101 }, (_, k) => ({ threshold: k / 100, escalated: k <= 30 ? 0 : k <= 36 ? 1 : k <= 60 ? 2 : 4, share: k <= 30 ? 0 : k <= 36 ? 0.25 : k <= 60 ? 0.5 : 1,
        correct: k <= 30 ? 2 : k <= 36 ? 2 : k <= 60 ? 3 : 2, accuracy: k <= 30 ? 0.5 : k <= 36 ? 0.5 : k <= 60 ? 0.75 : 0.5, cost_usd: 0.0004 + (k <= 30 ? 0 : k <= 36 ? 0.0002 : k <= 60 ? 0.0005 : 0.001),
        latency_ms: 397.5 + (k <= 30 ? 0 : k <= 36 ? 132 : k <= 60 ? 255 : 515) })),
      match: { threshold: 0, escalated: 0, share: 0, correct: 2, accuracy: 0.5, cost_usd: 0.0004, latency_ms: 397.5 },
      best: { threshold: 0.37, escalated: 2, share: 0.5, correct: 3, accuracy: 0.75, cost_usd: 0.0009, latency_ms: 652.5 } },
  },
  urgent: {
    type: "noul", signal: "confidence", bound: "estimate",
    variants: [score(2, 1, 0.3, [[0, 2, 1], [0.25, 1, 1], [0.83, 0, 0]]), score(2, 2, 0.12, [[0, 2, 2], [0.2, 1, 1], [0.77, 0, 0]])],
    paired: { both_right: 1, a_only: 0, b_only: 1, both_wrong: 0, rows: 2, p_value: 1 },
    answered_both: 5, agree: 4, only_a: 0, only_b: 0, excluded: 0,
    disagreements: [
      { index: 1, label: false, verdict: "b_only", answers: [{ predicted: "yes", signal: 0.24, correct: false }, { predicted: "no", signal: 0.2, correct: true }] },
    ],
    cascade: null,
  },
  tone: {
    type: "score", signal: "confidence", bound: "estimate",
    variants: [score(1, 1, 0.4, [[0, 1, 1], [0.41, 0, 0]]), score(1, 0, 0.6, [[0, 1, 0], [0.26, 0, 0]])],
    paired: { both_right: 0, a_only: 1, b_only: 0, both_wrong: 0, rows: 1, p_value: 1 },
    answered_both: 1, agree: 0, only_a: 0, only_b: 0, excluded: 0,
    disagreements: [
      { index: 0, label: 2, verdict: "a_only", answers: [{ predicted: "2", signal: 0.4, correct: true }, { predicted: "1", signal: 0.25, correct: false }] },
    ],
    cascade: null,
  },
  spot: {
    type: "box", signal: "confidence", bound: "estimate",
    variants: [score(1, 1, 0.2, [[0, 1, 1], [0.81, 0, 0]]), score(1, 1, 0.25, [[0, 1, 1], [0.76, 0, 0]])],
    paired: { both_right: 1, a_only: 0, b_only: 0, both_wrong: 0, rows: 1, p_value: 1 },
    answered_both: 1, agree: 0, only_a: 0, only_b: 0, excluded: 0,
    disagreements: [
      { index: 1, label: { left: 0.11, top: 0.2, right: 0.5, bottom: 0.6 }, verdict: "both_right",
        answers: [{ predicted: "0.10, 0.20, 0.50, 0.60", signal: 0.8, correct: true }, { predicted: "0.12, 0.20, 0.50, 0.60", signal: 0.75, correct: true }] },
    ],
    cascade: null,
  },
});

export const COMPARE_SLICES = freeze({
  fields: [{ name: "channel", values: 2 }], field: "channel", paired_rows: 1, signal: "confidence", bound: "estimate",
  slices: [{ value: "email", shown: "email", rows: 1, paired: { both_right: 0, a_only: 0, b_only: 1, both_wrong: 0, rows: 1, p_value: 1 }, excluded: 0,
    variants: [{ labeled: 1, correct: 0, accuracy: 0, accuracy_low: 0, accuracy_high: 0.79, targets: [] }, { labeled: 1, correct: 1, accuracy: 1, accuracy_low: 0.21, accuracy_high: 1, targets: [] }] }],
});

// A Lab filter / sort stand-in: hide some keys, put others first in the given order.
function labStandIn(key, hide = [], order = []) {
  return {
    matches: (item) => !hide.includes(key(item)),
    arrange: (items) => {
      if (!order.length) return items;
      const first = order.map((wanted) => items.find((item) => key(item) === wanted)).filter(Boolean);
      return [...first, ...items.filter((item) => !first.includes(item))];
    },
  };
}

export function sampleCompareRowsCtx(overrides = {}) {
  const { hide = [], order = [], ...rest } = overrides;
  const log = [];
  const state = { result: COMPARE_RESULT, qid: "department", signal: "confidence", bound: "estimate", first: "A", cascadeT: 0.37, slices: COMPARE_SLICES,
    slicesError: null, reportError: null, running: false, labeling: false, ...rest };
  if (!("report" in rest)) state.report = COMPARE_REPORTS[state.qid] || null;
  const stand = labStandIn((item) => item.index, hide, order);
  const record = (name) => (...args) => { log.push([name, ...args]); };
  const ctx = compareRowsCtx({
    ...Object.fromEntries(Object.keys(state).map((key) => [key, () => state[key]])),
    matches: stand.matches, arrange: stand.arrange,
    refresh: record("refresh"),
    selectQuestion: record("selectQuestion"), setSignal: record("setSignal"), setBound: record("setBound"), setFirst: record("setFirst"),
    setCascadeThreshold: record("setCascadeThreshold"), labelDisagreements: record("labelDisagreements"), useInBuild: record("useInBuild"),
  });
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  return ctx;
}

// ---------- the variant editors (W.compare.variants) ----------

export const VARIANT_TEXTS = freeze([JSON.stringify(QUESTIONS_A, null, 2), JSON.stringify(QUESTIONS_B, null, 2)]);

export function sampleCompareVariantsCtx(overrides = {}) {
  const { hide = [], order = [], texts = VARIANT_TEXTS, models = ["", "jev-1.14.0"], perturb = "", average = false, running = false, rowCount = 41,
    lastRun = null, modelList = ["jev-1.14.0", "jev-latest"], currentModel = "jev-latest" } = overrides;
  const log = [];
  const variants = [{ text: texts[0], model: models[0], perturb: "", average: false }, { text: texts[1], model: models[1], perturb, average }];
  const state = { variants, running };
  const stand = labStandIn((item) => item.qid, hide, order);
  const record = (name) => (...args) => { log.push([name, ...args]); };
  const ctx = compareVariantsCtx({
    variants: () => state.variants, currentModel: () => currentModel, models: () => modelList, rowCount: () => rowCount, running: () => state.running,
    lastRun: () => lastRun,
    matches: stand.matches, arrange: stand.arrange,
    setQuestions: (index, questions) => { log.push(["setQuestions", index, questions]); state.variants[index].text = JSON.stringify(questions, null, 2); },
    refresh: record("refresh"), copyAToB: record("copyAToB"), reverseA: record("reverseA"), averageA: record("averageA"), fill: record("fill"),
    setModel: record("setModel"), setRows: record("setRows"), setAsk: record("setAsk"),
  });
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  return ctx;
}
