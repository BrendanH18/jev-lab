// Fixtures for packs on the Workbench Tests tab (contract: static/js/lab/surfaces/workbench-tests.js). Not a test file.
//
//   import { sampleTestsItemsCtx, sampleTestsRaw, TESTS_NOW } from "./fixtures/workbench-tests.mjs";
//   const ctx = sampleTestsItemsCtx();                     // six saved tests, four run; "latte-art-feedback" hidden
//   const all = sampleTestsItemsCtx({ filters: {} });       // no page filter: all six shown
//   const empty = sampleTestsItemsCtx({ results: null });   // nothing run yet in this session
//   const none = sampleTestsItemsCtx({ items: [] });        // no saved tests at all
//   const T = Object.fromEntries(sampleTestsItemsCtx({ filters: {} }).items().map((item) => [item.id, item]));
//
// Every ctx is made by the real builder (testsItemsCtx) from hand-written raw saved tests and a session made by the
// page's own mergeTestResults, and shown() runs the page's own visibleTests with the given filters, so items, data
// and shown() have exactly the page's shapes and semantics. The answers are made up for tests; the page itself only
// ever shows answers the user requested.
//
// The six saved tests (saved order) and their latest results:
//   refund-routing      text state; choice `intent` (refund / replacement / question; expect choice refund, min 0.6)
//                       and noul `urgent` (expect min 0.5). PASS: intent refund 0.91 (confidence 0.88), urgent 0.72.
//                       jev-1.2, 412.5 ms, 180 in / 12 out tokens, $0.00021, elapsed 430.1 ms. Saved 2026-10-01T09:30:00Z.
//   bean-quality        object state; score `quality` (Unhappy / Mixed / Happy; expect min 1, max 2). FAIL: score
//                       0.4 (confidence 0.55). jev-1.2, 655 ms, 140 / 9 tokens, $0.00015. Saved 2026-10-15T14:00:00Z.
//   damaged-bag-photo   object state with a sample picture "torn-bag"; box `damage` (expect a box, iou_min 0.5) and
//                       noul `torn` (no expectation). ERROR: "Budget reached for this session" (no meta, no trace).
//                       Saved 2026-11-02T08:05:00Z.
//   wholesale-inquiry   array state; choice `route` (sales / support; expect choice "wholesale", which is NOT an
//                       option) and noul `spam` (expect {}, which checks nothing). NOT RUN. No saved_at.
//   latte-art-feedback  text state; notes start "archived:" (the default page filter hides it); score `tone` with
//                       structured instructions and four levels (no expectation) and noul `mentions_milk` with
//                       true/false criteria (expect min 0.8); orphan expectation `old_question`. FAIL (the orphan):
//                       tone 2.3 (confidence 0.71) unchecked, mentions_milk 0.97 passed. jev-1.1, 980 ms, 220 / 15
//                       tokens, $0.0003, stdlib backend. Saved 2026-09-20T17:45:00Z.
//   unnamed-draft       no name, no notes, no expect, questions: null (an unreadable question object). NOT RUN.
// Session: 1 batch of 4, $0.00066 and 2,100 ms wall; 1 passed, 2 failed, 1 error, 2 not run.
// Selection: bean-quality and latte-art-feedback (one of them hidden). Clock TESTS_NOW: 2026-11-12T12:00:00Z.
//
// overrides: items (raw tests), results (session or null), filters (page filter settings; default
// { exclude: "archived" }), query (search box), selected, busy, canUndoSelection, status (currentStatus()), tab,
// editingId, now, and lab: a Lab host (createLab) whose matches/arrange the ctx routes through, as the page does.
// The ctx also carries env (fakeEnv(): toasts, copied, downloads), state (the mutable page state: selected,
// previous, busy, filters) and log: every action the page received, as [name, ...args].
import { mergeTestResults, visibleTests } from "../../../../static/js/test-selection.js";
import { testsItemsCtx } from "../../../../static/js/lab/surfaces/workbench-tests.js";
import { fakeEnv } from "../harness.mjs";

export const TESTS_NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
export const TESTS_SURFACE = "workbench.tests.items";

// The page's filter defaults (workbench-tests.js testFilterDefaults), for data.filters_active.
export const TESTS_FILTER_DEFAULTS = Object.freeze({ status: "all", type: "all", expectations: "all", images: "all", selection: "all", sort: "saved",
  minQuestions: "", maxQuestions: "", stateType: "all", notes: "all", questionId: "", coverage: "all", typeMix: "all", searchField: "all", exclude: "",
  minExpectations: "", maxExpectations: "", minImages: "", maxImages: "", idPrefix: "", excludeType: "all", minStateBytes: "", maxStateBytes: "",
  namePrefix: "", idSuffix: "", questionMatch: "contains", minUncovered: "", maxUncovered: "", minOptions: "", maxOptions: "", minInstructions: "",
  maxInstructions: "", minLatency: "", maxLatency: "", minCost: "", maxCost: "", latency: "all", cost: "all", minCriteria: "", maxCriteria: "",
  minCriteriaCharacters: "", maxCriteriaCharacters: "", minScoreLevels: "", maxScoreLevels: "", minOrphanExpectations: "", maxOrphanExpectations: "",
  orphanExpectations: "all" });

// Raw saved tests exactly as GET /api/workbench/items returns them (fresh copies on every call).
export function sampleTestsRaw() {
  return [
    { id: "refund-routing", name: "Refund routing", notes: "Customer asks for money back on a bag of beans.", saved_at: "2026-10-01T09:30:00Z",
      state: "Hi, order HC-1042 arrived stale. Can I get a refund? Dana (dana@customer.example)",
      questions: {
        intent: { type: "choice", instructions: "What does the customer want?", criteria: { refund: "Money back", replacement: "A new bag", question: "Just asking" } },
        urgent: { type: "noul", instructions: "Does this need a reply today?" },
      },
      expect: { intent: { choice: "refund", min: 0.6 }, urgent: { min: 0.5 } } },
    { id: "bean-quality", name: "Bean quality review", notes: "", saved_at: "2026-10-15T14:00:00Z",
      state: { review: "Dark roast tasted burnt, but shipping was fast.", stars: 2 },
      questions: { quality: { type: "score", instructions: "How happy is the reviewer with the beans?", criteria: ["Unhappy", "Mixed", "Happy"] } },
      expect: { quality: { min: 1, max: 2 } } },
    { id: "damaged-bag-photo", name: "Damaged bag photo", notes: "Photo from the wholesale dock.", saved_at: "2026-11-02T08:05:00Z",
      state: { note: "Bag arrived torn at the Portside dock", photo: "photo" },
      questions: { damage: { type: "box", instructions: "Where is the tear in `photo`?" }, torn: { type: "noul", instructions: "Is the bag in `photo` torn?" } },
      expect: { damage: { box: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 }, iou_min: 0.5 } },
      images: { photo: { sample: "torn-bag" } } },
    { id: "wholesale-inquiry", name: "Wholesale inquiry", notes: "",
      state: ["Do you sell 5 kg bags?", "We run a cafe in Portside: orders@portside-cafe.example"],
      questions: {
        route: { type: "choice", instructions: "Which team should answer?", criteria: { sales: "Wholesale sales", support: "Customer support" } },
        spam: { type: "noul", instructions: "Is this spam?" },
      },
      expect: { route: { choice: "wholesale" }, spam: {} } },
    { id: "latte-art-feedback", name: "Latte art feedback", notes: "archived: replaced by the cafe survey", saved_at: "2026-09-20T17:45:00Z",
      state: "The latte art was lovely but the milk was lukewarm.",
      questions: {
        tone: { type: "score", instructions: { text: "Rate the tone", scale: "0-3" }, criteria: ["Angry", "Cold", "Warm", "Delighted"] },
        mentions_milk: { type: "noul", instructions: "Does the text mention milk?", criteria: { true: "Milk is mentioned", false: "No milk" } },
      },
      expect: { mentions_milk: { min: 0.8 }, old_question: { max: 0.2 } } },
    { id: "unnamed-draft", state: "Draft", questions: null },
  ];
}

const meta = (model, latency, input, output, cost, backend = "sdk", count = 1) =>
  ({ model, latency_ms: latency, question_count: count, input_tokens: input, output_tokens: output, cost_usd: cost, backend });
const trace = (id, metaValue) => ({ request: { state: `state of ${id}`, model: "jev-latest" }, response: { model: metaValue.model }, meta: metaValue });

// The server's batch response for the four tests that were run (POST /api/workbench/items/run).
export function sampleTestsBatch() {
  const refundMeta = meta("jev-1.2", 412.5, 180, 12, 0.00021, "sdk", 2);
  const beanMeta = meta("jev-1.2", 655, 140, 9, 0.00015);
  const latteMeta = meta("jev-1.1", 980, 220, 15, 0.0003, "stdlib", 2);
  return {
    runs: [
      { id: "refund-routing", name: "Refund routing", ok: true, elapsed_ms: 430.1, meta: refundMeta, trace: trace("refund-routing", refundMeta),
        results: {
          intent: { ok: true, checks: ["choice = refund", "0.91 ≥ 0.60"],
            answer: { type: "choice", choice: "refund", probabilities: { refund: 0.91, replacement: 0.06, question: 0.03 }, confidence: 0.88 } },
          urgent: { ok: true, checks: ["0.72 ≥ 0.50"], answer: { type: "noul", noul: 0.72 } },
        } },
      { id: "bean-quality", name: "Bean quality review", ok: false, elapsed_ms: 660.4, meta: beanMeta, trace: trace("bean-quality", beanMeta),
        results: {
          quality: { ok: false, checks: ["0.40 < 1.00", "0.40 ≤ 2.00"],
            answer: { type: "score", score: 0.4, legend: { 0: "Unhappy", 1: "Mixed", 2: "Happy" }, probabilities: { 0: 0.62, 1: 0.36, 2: 0.02 }, confidence: 0.55 } },
        } },
      { id: "damaged-bag-photo", name: "Damaged bag photo", error: "Budget reached for this session", ok: false, results: {}, elapsed_ms: 3.2 },
      { id: "latte-art-feedback", name: "Latte art feedback", ok: false, elapsed_ms: 1001, meta: latteMeta, trace: trace("latte-art-feedback", latteMeta),
        results: {
          tone: { ok: null, checks: ["no expectation"],
            answer: { type: "score", score: 2.3, legend: { 0: "Angry", 1: "Cold", 2: "Warm", 3: "Delighted" }, probabilities: { 0: 0.01, 1: 0.09, 2: 0.49, 3: 0.41 }, confidence: 0.71 } },
          mentions_milk: { ok: true, checks: ["0.97 ≥ 0.80"], answer: { type: "noul", noul: 0.97 } },
          old_question: { ok: false, checks: ["expectation refers to an unknown question"], answer: null },
        } },
    ],
    passed: 1, failed: 3, wall_ms: 2100, cost_usd: 0.00066,
  };
}

// The page's session after that one batch, made by the page's own mergeTestResults.
export function sampleTestsResults(items = sampleTestsRaw()) {
  return mergeTestResults(null, sampleTestsBatch(), items);
}

export const TESTS_STATUS = Object.freeze({ model: "jev-latest", spend: { budget_usd: 1, spent_usd: 0.25, reserved_usd: 0.05 } });

export function sampleTestsItemsCtx(overrides = {}) {
  const items = overrides.items || sampleTestsRaw();
  const state = {
    items,
    results: "results" in overrides ? overrides.results : sampleTestsResults(items),
    filters: { ...TESTS_FILTER_DEFAULTS, ...("filters" in overrides ? overrides.filters : { exclude: "archived" }) },
    query: overrides.query || "",
    selected: overrides.selected || ["bean-quality", "latte-art-feedback"],
    previous: overrides.canUndoSelection ? ["refund-routing"] : null,
    busy: !!overrides.busy,
  };
  const log = [];
  const lab = overrides.lab || null;
  let ctx = null;
  const source = {
    items: () => state.items,
    results: () => state.results,
    // The page: visibleTests with its filter settings, the search box and the Lab hook (ctx.page).
    shown: () => visibleTests(state.items, state.results, { ...state.filters, selected: state.selected, query: state.query, lab: ctx.page }),
    matches: lab ? (item, current) => lab.matches(TESTS_SURFACE, item, current) : undefined,
    arrange: lab ? (list, current) => lab.arrange(TESTS_SURFACE, list, current) : undefined,
    selected: () => state.selected,
    canUndoSelection: () => state.previous !== null,
    busy: () => state.busy,
    filters: () => ({ ...state.filters, query: state.query }),
    defaults: () => ({ ...TESTS_FILTER_DEFAULTS }),
    tab: () => overrides.tab ?? "tests",
    editingId: () => overrides.editingId ?? null,
    status: () => ("status" in overrides ? overrides.status : TESTS_STATUS),
    now: () => overrides.now ?? TESTS_NOW,
    setSelection: (ids) => { log.push(["setSelection", ids]); state.previous = [...state.selected]; state.selected = ids; },
    undoSelection: () => { log.push(["undoSelection"]); state.selected = state.previous || []; state.previous = null; },
    open: (raw) => { log.push(["open", raw.id]); return Promise.resolve(); },
    inspect: (value, title) => { log.push(["inspect", title]); return value; },
    resetFilters: () => { log.push(["resetFilters"]); state.filters = { ...TESTS_FILTER_DEFAULTS }; state.query = ""; },
    refresh: () => { log.push(["refresh"]); },
  };
  ctx = testsItemsCtx(source);
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  return ctx;
}
