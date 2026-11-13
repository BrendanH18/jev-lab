// Fixtures for packs on the Workbench Build tab's surfaces (contract: static/js/lab/surfaces/workbench-build.js).
// Not a test file.
//
//   import { sampleBuildQuestionsCtx, sampleBuildResultCtx, BUILD_RESULT } from "./fixtures/workbench-build.mjs";
//   const ctx = sampleBuildQuestionsCtx();                 // 7 cards of every type; "tone" is hidden by a page filter
//   const bare = sampleBuildQuestionsCtx({ rows: [], result: null, lint: null, expect: {} });   // empty editor
//   const answers = sampleBuildResultCtx();                // the six answers of one Run
//   const none = sampleBuildResultCtx({ result: null });   // before the first Run
//
// Every ctx is made by the real builder from hand-written raw page state, so items and data have exactly the page's
// shapes. The answers are made up for tests; the page itself only ever shows answers the user requested.
// overrides: any raw page field below (rows, expect, stateText, images, result, stale, running, rawMode, rawPending,
// lint, saveOpen, canUndoRemove, maxImages, origin), plus
//   hide:  qids (or 1-based positions) the page's own filters hide, as a search or type filter would (default
//          ["tone"] on the questions ctx, [] on the result ctx)
//   order: qids in the order shown() returns them, as an active Lab sort would (others keep their place after)
// The ctx also carries env (fakeEnv(): toasts, copied, downloads), log: every action the page received, as
// [name, ...args], and page: the raw state, which commit() (replaceItems/importItems) and addQuestion() change the
// way the real page does, so a command or edit test can assert the outcome.
import { wbBuildQuestionsCtx, wbBuildResultCtx } from "../../../../static/js/lab/surfaces/workbench-build.js";
import { fakeEnv } from "../harness.mjs";

// The state of a Harbor Coffee Co. support ticket, as the state editor holds it (JSON text).
export const BUILD_STATE_TEXT = JSON.stringify({
  ticket: {
    subject: "Charged twice for my beans",
    body: "Hi Harbor Coffee, I was charged twice for order HC-1042 (2 bags of Harbor Espresso). Please refund the extra charge today.",
    customer: "maya@customers.example",
    lines: [{ sku: "BEAN-ESP-1KG", qty: 2 }],
  },
  order_total: 38.5,
  photo: "photo-0a1b2c3d4e",
}, null, 2);

// The editor rows (W.questions), in request order. Every row keeps all four criteria fields, as the editor does.
export function buildRows() {
  return [
    { id: "intent", type: "choice", instructions: "What does the customer in `ticket.body` want?",
      choice: [["refund", "Wants money back"], ["where_is_order", "Asks where an order is"], ["other", ""], ["", ""]],
      score: ["", "", ""], noulYes: "", noulNo: "" },
    { id: "urgency", type: "score", instructions: "How urgent is `ticket.body`?",
      choice: [["", ""], ["", ""]], score: ["Not urgent", "Soon", "", "Right now"], noulYes: "", noulNo: "" },
    { id: "angry", type: "noul", instructions: "Is the customer in `ticket.body` angry?",
      choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "Uses angry or threatening words", noulNo: "" },
    { id: "mug_box", type: "box", instructions: "The coffee mug in `photo`.",
      choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" },
    { id: " refund_amount_ok ", type: "noul", instructions: "{\"ask\": \"Does `order_total` match the refund asked for?\"}",
      choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" },
    { id: "", type: "choice", instructions: "", choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" },
    { id: "tone", type: "choice", instructions: "What is the tone of `ticket.subject`?",
      choice: [["calm", "Calm and polite"], ["upset", "Upset"]], score: ["", "", ""], noulYes: "", noulNo: "" },
  ];
}

// Human expectations (W.expect). "old_question" belongs to no card: it was renamed by typing.
export function buildExpect() {
  return { intent: { choice: "refund" }, angry: { max: 0.5 }, mug_box: { box: { left: 0.2, top: 0.3, right: 0.6, bottom: 0.8 }, iou_min: 0.5 },
    old_question: { min: 0.2 } };
}

export const BUILD_IMAGES = Object.freeze([
  { ref: "photo-0a1b2c3d4e", sample: "mug", url: "/img/samples/mug.png", about: "A coffee mug on a counter" },
  { ref: "photo-99ffee0011", format: "jpg", data_base64: "AAAA", url: "data:image/jpeg;base64,AAAA", name: "counter.jpg" },
]);

// The questions as the Run sent them (the API shape of buildRows(), blank id skipped).
const SENT_QUESTIONS = {
  intent: { type: "choice", instructions: "What does the customer in `ticket.body` want?",
    criteria: { refund: "Wants money back", where_is_order: "Asks where an order is", other: null } },
  urgency: { type: "score", instructions: "How urgent is `ticket.body`?", criteria: ["Not urgent", "Soon", "Right now"] },
  angry: { type: "noul", instructions: "Is the customer in `ticket.body` angry?", criteria: { true: "Uses angry or threatening words", false: null } },
  mug_box: { type: "box", instructions: "The coffee mug in `photo`." },
  refund_amount_ok: { type: "noul", instructions: { ask: "Does `order_total` match the refund asked for?" } },
  tone: { type: "choice", instructions: "What is the tone of `ticket.subject`?", criteria: { calm: "Calm and polite", upset: "Upset" } },
};

// One Run of the request above (W.result). Made-up answers for tests.
export function buildResult() {
  return {
    answers: {
      intent: { type: "choice", choice: "refund", probabilities: { refund: 0.82, where_is_order: 0.11, other: 0.07 }, confidence: 0.82 },
      urgency: { type: "score", score: 1.35, legend: { 0: "Not urgent", 1: "Soon", 2: "Right now" }, probabilities: { 0: 0.1, 1: 0.45, 2: 0.45 }, confidence: 0.45 },
      angry: { type: "noul", noul: 0.64 },
      mug_box: { type: "box", box: { left: 0.25, top: 0.3, right: 0.65, bottom: 0.7 }, confidence: 0.71 },
      refund_amount_ok: { type: "noul", noul: 0.12 },
      tone: { type: "choice", choice: "upset", probabilities: { calm: 0.48, upset: 0.52 }, confidence: 0.52 },
    },
    meta: { model: "jev-1.14", latency_ms: 412, question_count: 6, input_tokens: 1830, output_tokens: 96, cost_usd: 0.000412, backend: "sdk" },
    trace: { request: { state: JSON.parse(BUILD_STATE_TEXT), model: "jev-1.14", questions: JSON.parse(JSON.stringify(SENT_QUESTIONS)) },
      response: { answers: {}, model: "jev-1.14" }, meta: {} },
    images: BUILD_IMAGES.map((image) => ({ ...image })),
  };
}

// An odd Run: a missing score, a Choice without probabilities, a Box with a missing edge, an unknown type.
export function buildOddResult() {
  return {
    answers: {
      level: { type: "score", score: null, legend: { 0: "Low", 1: "High" }, probabilities: { 0: 0.5, 1: "n/a" } },
      pick: { type: "choice", choice: "x_y", confidence: 0.4 },
      spot: { type: "box", box: { left: 0.1, top: 0.1, right: 0.4 }, confidence: 0.3 },
      future: { type: "ranking", ranking: ["a", "b"] },
    },
    meta: { model: "jev-1.14" },
    trace: { request: { state: "plain text", model: "jev-1.14", questions: { level: { type: "score" }, pick: { type: "choice", instructions: "Pick" } } } },
  };
}

// The Question checks report after Check questions (W.lint), with one extra advisory finding from a Python pack.
export function buildLint() {
  return {
    findings: [
      { level: "advice", code: "undescribed_option", question: "intent", message: "Option “other” has no description.", guide: "https://docs.typesafe.ai/concepts/how-to-build-with-system-one#describe-every-option" },
      { level: "problem", code: "missing_path", question: "tone", message: "`ticket.subjekt` is not in the state.", guide: "https://docs.typesafe.ai/concepts/how-to-build-with-system-one#use-structure-in-the-input-state" },
    ],
    counts: { problem: 1, advice: 1 },
    guide: "https://docs.typesafe.ai/concepts/how-to-build-with-system-one",
    lab: { findings: [{ level: "advice", code: "sample-pack/short_id", question: "angry", message: "A longer id would say what is angry.", guide: "" }], counts: { problem: 0, advice: 1 } },
  };
}

// The raw page state and a source for the builders, with every action logged.
export function samplePage(overrides = {}, defaults = {}) {
  const page = { rows: buildRows(), expect: buildExpect(), stateText: BUILD_STATE_TEXT, images: BUILD_IMAGES.map((image) => ({ ...image })),
    result: buildResult(), stale: false, running: false, rawMode: false, rawPending: false, lint: buildLint(), saveOpen: false,
    canUndoRemove: false, maxImages: 4, origin: { example: "support_triage", test: null, handoff: null }, hide: ["tone"], order: null, ...defaults };
  for (const [key, value] of Object.entries(overrides)) page[key] = value;
  const log = [];
  const hidden = (row, index) => (page.hide || []).some((entry) => (typeof entry === "number" ? entry === index + 1 : String(row.id || "").trim() === entry));
  const arrange = (items) => {
    if (!page.order) return items;
    const rank = (item) => { const at = page.order.indexOf(item.qid ?? item.id); return at < 0 ? page.order.length : at; };
    return items.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map((entry) => entry.item);
  };
  const logged = (name, value) => (...args) => { log.push([name, ...args]); return typeof value === "function" ? value(...args) : value; };
  const source = {
    rows: () => page.rows, expect: () => page.expect, stateText: () => page.stateText, images: () => page.images, result: () => page.result,
    stale: () => page.stale, running: () => page.running, rawMode: () => page.rawMode, rawPending: () => page.rawPending, lint: () => page.lint,
    maxImages: () => page.maxImages, origin: () => page.origin, saveOpen: () => page.saveOpen, canUndoRemove: () => page.canUndoRemove,
    currentIds: () => page.rows.map((row) => String(row.id || "").trim()).filter(Boolean),
    shownRows: () => page.rows.filter((row, index) => !hidden(row, index)),
    arrange,
    commit: logged("commit", ({ rows, expect }) => { page.rows = rows; page.expect = expect; }),
    addQuestion: logged("addQuestion", (type) => { page.rows = [...page.rows, { id: `${type}_${page.rows.length + 1}`, type, instructions: "", choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" }]; }),
    focus: logged("focus"), checkQuestions: logged("checkQuestions"), exportCode: logged("exportCode"), formatState: logged("formatState"),
    compactState: logged("compactState"), undoRemove: logged("undoRemove"), clearFilters: logged("clearFilters", () => { page.hide = []; page.order = null; }),
    inspect: logged("inspect"), openSave: logged("openSave", () => { page.saveOpen = true; }),
    focusQuestion: logged("focusQuestion", (qid) => !page.rows.some((row, index) => String(row.id || "").trim() === qid && hidden(row, index))),
    refresh: logged("refresh"),
  };
  return { page, log, source };
}

function withExtras(ctx, made) {
  ctx.env = fakeEnv();
  ctx.log = made.log;
  ctx.page = made.page;
  return ctx;
}

export function sampleBuildQuestionsCtx(overrides = {}) {
  const made = samplePage(overrides);
  return withExtras(wbBuildQuestionsCtx(made.source), made);
}

export function sampleBuildResultCtx(overrides = {}) {
  const made = samplePage(overrides, { hide: [] });
  const ctx = wbBuildResultCtx({ ...made.source, matches: (item) => !(made.page.hide || []).includes(item.id) });
  return withExtras(ctx, made);
}
