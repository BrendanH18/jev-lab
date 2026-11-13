// Fixtures for packs on the Workbench Bulk surfaces (contract: static/js/lab/surfaces/workbench-bulk.js). Not a test file.
//
//   import { sampleBulkRowsCtx, sampleBulkResultsCtx } from "./fixtures/workbench-bulk.mjs";
//   const ctx = sampleBulkRowsCtx();                     // the rows box below, through the real builder
//   const other = sampleBulkRowsCtx({ rowsText: "a\nb" }); // any source field can be overridden
//
// Each ctx is built by the surface's real builder from hand-written Harbor Coffee Co. data, so items(), shown(), data
// and every action guard behave exactly as on the page. Made-up answers are fine here: these are tests. Extras on the
// returned ctx, for assertions:
//   ctx.env     fakeEnv() from harness.mjs: env.toasts, env.copied, env.downloads
//   ctx.state   the mutable page state the source reads (rowsText, labelsDirty, result, labels, …): change it to
//               simulate the page
//   ctx.calls   every page operation the actions reached, as [name, ...args]; replaceItems/importItems show up as
//               ["write", text, label] and also change ctx.state.rowsText, as the page does
// Override `matches: (item) => boolean` to simulate items that filters hide; shown() then leaves them out.
import { fakeEnv } from "../harness.mjs";
import { bulkResultsCtx, bulkRowsCtx } from "../../../../static/js/lab/surfaces/workbench-bulk.js";

// The questions selected to run: the sample support-triage set plus a Box question for pictures.
export const SAMPLE_BULK_QUESTIONS = Object.freeze({
  department: { type: "choice", instructions: "Which team should handle this message?", criteria: {
    billing: "Charges, refunds, invoices", shipping: "Delivery status, lost or damaged packages", technical: "The website, app or a machine",
    product: "Coffee, brewing, availability", wholesale: "Cafes and businesses buying in volume", none: "No team needs to act" } },
  frustration: { type: "score", instructions: "How frustrated does the writer sound?", criteria: ["Calm", "Frustrated but civil", "Very angry"] },
  is_urgent: { type: "noul", instructions: "Does the message need attention today rather than within the week?" },
  wants_refund: { type: "noul", instructions: "Does the writer ask for a refund, replacement, or money back?" },
  seal_damage: { type: "box", instructions: "Where is the damage on the bag or box in `photo`?" },
});

// The rows box. Item positions (1-based among nonempty rows) and what each one exercises:
//   1  line 1   {"text", "_expect"}: a text row (input is the string) with 4 labels (Choice, Noul false, Noul true, Score 1)
//   2  line 2   plain text line, no labels
//   3  line 3   text row with labels (Score 2, Noul true)
//   4  line 4   HELD-OUT row: labels null, labeled ["department", "is_urgent"], ref "held-1"
//      line 5   blank (no row)
//   5  line 6   picture row: object input { note } + image "torn-bag" + a Box label; text null
//   6  line 7   invalid labels: "accounts" is not a department, "maybe" is not yes/no; object input { text, channel }
//   7  line 8   malformed: starts with "{" but is not JSON, so it is sent as text
//   8  line 9   duplicate of row 2
//   9  line 10  problem: _expect is not an object (labels {})
//   10 line 11  object input with several fields and a .example email address, one label
//   11 line 12  HELD-OUT picture row "crushed-box", ref "held-1"
//   12 line 13  text row with a Noul label written as text "yes" (kept as written)
export const SAMPLE_BULK_ROWS_TEXT = [
  '{"text": "My order arrived with the bag torn and beans everywhere. Can I get a replacement?", "_expect": {"department": "shipping", "is_urgent": false, "wants_refund": true, "frustration": 1}}',
  "Do you sell decaf in whole bean?",
  '{"text": "I was charged twice for order A-2210. Please fix this today!", "_expect": {"frustration": 2, "wants_refund": true}}',
  '{"text": "Love the new Ethiopia roast, thank you!", "_expect": {"department": "none", "is_urgent": false}, "_test": true}',
  "",
  '{"note": "Customer photo of the delivered bag", "_image": "torn-bag", "_expect": {"seal_damage": {"left": 0.2, "top": 0.3, "right": 0.7, "bottom": 0.8}}}',
  '{"text": "Where is the invoice for our cafe order?", "channel": "email", "_expect": {"department": "accounts", "is_urgent": "maybe"}}',
  '{"text": "Half-written JSON',
  "Do you sell decaf in whole bean?",
  '{"text": "Refund please", "_expect": "billing"}',
  '{"text": "Please send the wholesale price list to orders@harborcafe.example", "channel": "email", "customer": "Harbor Cafe", "_expect": {"department": "wholesale"}}',
  '{"note": "Crushed corner on arrival", "_image": "crushed-box", "_test": true, "_expect": {"wants_refund": true}}',
  '{"text": "The grinder stopped working after a week", "_expect": {"is_urgent": "yes"}}',
].join("\n");

// A dataset health report for the box above, as POST /api/workbench/health returns it (row numbers only).
const HEALTH = {
  rows: 12, unique_inputs: 11, duplicate_groups: [{ rows: [2, 8] }], conflicts: [], overlap: [],
  questions: [
    { qid: "department", labeled: 3, missing: 8, missing_rows: [2, 3, 5, 7, 8, 9, 11, 12], invalid: [6] },
    { qid: "frustration", labeled: 2, missing: 10, missing_rows: [2, 4, 5, 6, 7, 8, 9, 10, 11, 12], invalid: [] },
  ],
  invalid_labels: [], by_slice: { fields: [{ name: "channel", values: 2 }], field: null, slices: [] },
  lab: [{ code: "example-pack/short_inputs", title: "Very short inputs", rows: [2, 8, 9], message: "3 rows have fewer than six words." }],
};

// A Check Bulk inputs report for the box above (POST /api/workbench/preflight).
const PREFLIGHT = {
  rows: 12, held_out: 2,
  findings: [
    { row: 2, question: null, code: "missing_picture", message: "Box questions need a picture on this row." },
    { row: 7, question: null, code: "missing_picture", message: "Box questions need a picture on this row." },
  ],
  lab: [{ row: 10, question: "department", code: "example-pack/email_in_text", message: "The input holds an email address." }],
};

function rowsSource(state, calls, overrides) {
  const log = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    rowsText: () => state.rowsText, questions: () => state.questions, questionError: () => state.questionError,
    source: () => state.source, dataset: () => state.dataset, unsaved: () => state.unsaved, labelsDirty: () => state.labelsDirty,
    running: () => state.running, health: () => state.health, preflight: () => state.preflight,
    confirmDiscard: () => { calls.push(["confirmDiscard"]); return state.approve; },
    write: (text, label) => { calls.push(["write", text, label]); state.rowsText = text; state.unsaved = true; },
    checkHealth: log("checkHealth"), checkPreflight: log("checkPreflight"), openCsvImport: log("openCsvImport"),
    focusLine: log("focusLine"), refresh: log("refresh"),
    ...overrides,
  };
}

// The "workbench.bulk.rows" ctx. overrides: any source field (rowsText, questions, questionError, source, dataset,
// unsaved, labelsDirty, running, health, preflight, approve: false to make confirmDiscard cancel, matches, arrange, …).
export function sampleBulkRowsCtx(overrides = {}) {
  const calls = [];
  const state = { rowsText: SAMPLE_BULK_ROWS_TEXT, questions: structuredClone(SAMPLE_BULK_QUESTIONS), questionError: null, source: "current",
    dataset: { id: "harbor-support", name: "Harbor support tickets" }, unsaved: false, labelsDirty: false, running: false,
    health: structuredClone(HEALTH), preflight: structuredClone(PREFLIGHT), approve: true };
  const fields = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key in state && typeof value !== "function") state[key] = value;
    else fields[key] = value;
  }
  const ctx = bulkRowsCtx(rowsSource(state, calls, fields));
  ctx.env = fakeEnv();
  ctx.state = state;
  ctx.calls = calls;
  return ctx;
}

// ---------- workbench.bulk.results ----------

const meta = (latency, input, output, cost) => ({ model: "jev-1.14.0", latency_ms: latency, question_count: 5, input_tokens: input,
  output_tokens: output, cost_usd: cost, backend: "sdk" });
const legend = { 0: "Calm", 1: "Frustrated but civil", 2: "Very angry" };
const choice = (picked, probabilities, confidence) => ({ type: "choice", choice: picked, probabilities, confidence });
const score = (value, probabilities, confidence) => ({ type: "score", score: value, legend, probabilities, confidence });
const noul = (p) => ({ type: "noul", noul: p });
const box = (left, top, right, bottom, confidence) => ({ type: "box", box: { left, top, right, bottom }, confidence });

// The run, in row order. Every row carries a picture, since the questions include a Box. What each index exercises:
//   0  answered, labels agree on department/frustration/wants_refund, Box label overlaps the answer (IoU 0.75)
//   1  answered, department label right, wants_refund label wrong (answer 0.62 = yes, label false)
//   2  answered, department wrong (label billing, answer shipping: a close call, 0.45 vs 0.41), Noul label written as
//      "yes", a tiny Box (0.05 x 0.08 of the picture)
//   3  failed with an error message
//   4  answered but HELD OUT: answers and labels hidden
//   5  skipped (never sent)
//   6  answered, invalid department label "accounts"; is_urgent answer exactly 0.5 (predicted yes)
//   7  answered, no saved labels; a label chosen in the table (labelsDirty); meta without output_tokens
const RESULT = {
  rows: 8, completed: 6, labeled: 5, wall_ms: 2140, input_tokens: 5130, cost_usd: 0.000216, model: "jev-latest", stopped: null,
  results: [
    { index: 0, row: { text: "The bag arrived torn and beans spilled everywhere. Replacement please.", _image: "torn-bag" },
      expect: { department: "shipping", wants_refund: true, frustration: 1, seal_damage: { left: 0.2, top: 0.2, right: 0.6, bottom: 0.6 } },
      answers: { department: choice("shipping", { billing: 0.05, shipping: 0.88, technical: 0.01, product: 0.02, wholesale: 0.01, none: 0.03 }, 0.86),
        frustration: score(1.2, { 0: 0.1, 1: 0.6, 2: 0.3 }, 0.55), is_urgent: noul(0.22), wants_refund: noul(0.91),
        seal_damage: box(0.2, 0.2, 0.6, 0.5, 0.74) }, meta: meta(812, 870, 40, 0.0000366) },
    { index: 1, row: { text: "Box corner crushed but the beans look fine.", _image: "crushed-box" },
      expect: { department: "shipping", wants_refund: false },
      answers: { department: choice("shipping", { billing: 0.02, shipping: 0.94, technical: 0.01, product: 0.01, wholesale: 0.01, none: 0.01 }, 0.93),
        frustration: score(0.4, { 0: 0.65, 1: 0.3, 2: 0.05 }, 0.48), is_urgent: noul(0.08), wants_refund: noul(0.62),
        seal_damage: box(0.55, 0.1, 0.95, 0.45, 0.61) }, meta: meta(790, 860, 40, 0.0000361) },
    { index: 2, row: { text: "Charged twice for this grinder order, refund today!", _image: "grinder-ok" },
      expect: { department: "billing", is_urgent: "yes", frustration: 2 },
      answers: { department: choice("shipping", { billing: 0.41, shipping: 0.45, technical: 0.1, product: 0.02, wholesale: 0.01, none: 0.01 }, 0.34),
        frustration: score(1.7, { 0: 0.05, 1: 0.2, 2: 0.75 }, 0.7), is_urgent: noul(0.81), wants_refund: noul(0.97),
        seal_damage: box(0.4, 0.4, 0.45, 0.48, 0.12) }, meta: meta(1033, 880, 41, 0.0000370) },
    { index: 3, row: { text: "Sealed bag, just checking the roast date.", _image: "intact-bag" },
      error: "Rate limited: try again in a few seconds" },
    { index: 4, row: { text: "Seal was open when it arrived.", _image: "torn-bag", _test: true }, expect: { department: "shipping" },
      answers: { department: choice("shipping", { billing: 0.1, shipping: 0.8, technical: 0.04, product: 0.02, wholesale: 0.02, none: 0.02 }, 0.76),
        frustration: score(0.9, { 0: 0.3, 1: 0.5, 2: 0.2 }, 0.3), is_urgent: noul(0.3), wants_refund: noul(0.7),
        seal_damage: box(0.3, 0.3, 0.6, 0.7, 0.66) }, meta: meta(845, 850, 40, 0.0000358) },
    { index: 5, row: { text: "Second photo of the same delivery.", _image: "crushed-box" }, skipped: true },
    { index: 6, row: { text: "Love the new Ethiopia roast!", _image: "intact-bag" }, expect: { department: "accounts" },
      answers: { department: choice("none", { billing: 0.01, shipping: 0.02, technical: 0.01, product: 0.12, wholesale: 0.01, none: 0.83 }, 0.8),
        frustration: score(0.1, { 0: 0.92, 1: 0.07, 2: 0.01 }, 0.9), is_urgent: noul(0.5), wants_refund: noul(0.03),
        seal_damage: box(0.1, 0.1, 0.9, 0.9, 0.2) }, meta: meta(702, 820, 39, 0.0000345) },
    { index: 7, row: { text: "Grinder hopper cracked in transit, I want my money back", _image: "grinder-ok" },
      answers: { department: choice("shipping", { billing: 0.3, shipping: 0.6, technical: 0.06, product: 0.02, wholesale: 0.01, none: 0.01 }, 0.52),
        frustration: score(1.5, { 0: 0.1, 1: 0.35, 2: 0.55 }, 0.4), is_urgent: noul(0.44), wants_refund: noul(0.95),
        seal_damage: box(0.35, 0.25, 0.65, 0.55, 0.58) }, meta: { ...meta(1120, 850, 40, 0.0000360), output_tokens: undefined } },
  ],
};

// The human labels now in force: saved labels, plus row 7's wants_refund chosen in the table (so labelsDirty).
const LABELS = { 0: RESULT.results[0].expect, 1: RESULT.results[1].expect, 2: RESULT.results[2].expect, 4: RESULT.results[4].expect,
  6: RESULT.results[6].expect, 7: { wants_refund: true } };

function resultsSource(state, calls, overrides) {
  const log = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    result: () => state.result, labels: () => state.labels, questions: () => state.questions, calQuestion: () => state.calQuestion,
    calReport: () => state.calReport, sort: () => state.sort, requestedModel: () => state.requestedModel,
    labelsDirty: () => state.labelsDirty, running: () => state.running,
    order: () => {
      if (!state.result) return [];
      const rows = state.result.results.slice();
      if (state.sort?.key === "__row") rows.sort((a, b) => (a.index - b.index) * state.sort.dir);
      return rows;
    },
    sortBy: (key, dir) => { calls.push(["sortBy", key, dir]); state.sort = { key, dir }; },
    keepLabels: log("keepLabels"), downloadCsv: log("downloadCsv"), focusRow: log("focusRow"), refresh: log("refresh"),
    ...overrides,
  };
}

// The "workbench.bulk.results" ctx. overrides: any source field (result: null for the state before any run, labels,
// questions, calQuestion, calReport, sort, requestedModel, labelsDirty, running, matches, arrange, order, …).
export function sampleBulkResultsCtx(overrides = {}) {
  const calls = [];
  const state = { result: structuredClone(RESULT), labels: structuredClone(LABELS), questions: structuredClone(SAMPLE_BULK_QUESTIONS),
    calQuestion: "department", calReport: { rows: [{ index: 0, correct: true }, { index: 1, correct: true }, { index: 2, correct: false }] },
    sort: null, requestedModel: "jev-latest", labelsDirty: true, running: false };
  const fields = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key in state && typeof value !== "function") state[key] = value;
    else fields[key] = value;
  }
  const ctx = bulkResultsCtx(resultsSource(state, calls, fields));
  ctx.env = fakeEnv();
  ctx.state = state;
  ctx.calls = calls;
  return ctx;
}
