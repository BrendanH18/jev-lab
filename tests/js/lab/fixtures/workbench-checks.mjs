// Fixtures for packs on the Workbench saved checks, the drift "Label new traffic" queue and the Review queue
// (contract: static/js/lab/surfaces/workbench-checks.js). Not a test file.
//
//   import { sampleChecksListCtx, sampleDriftQueueCtx, sampleReviewQueueCtx } from "./fixtures/workbench-checks.mjs";
//   const checks = sampleChecksListCtx();           // four checks; the catalog hides "roastery-orders"
//   const drift = sampleDriftQueueCtx();            // five queued new rows, Label new traffic open, room for 1
//   const review = sampleReviewQueueCtx();          // six queued rows: three review, three audit (two still blind)
//   const audits = sampleReviewQueueCtx({ kind: "audit" });   // the page's "Audit only" filter
//
// Every ctx is made by the real builder from hand-written page state shaped like W.bulk.datasets / W.bulk.checkRuns
// and the server's reports (POST /api/workbench/checks/run, /checks/drift, /checks/decisions), with stand-ins for the
// page operations that change that state the way the page does. Harbor Coffee Co.; .example domains only. Answers and
// measured values here are made up.
//
// Each ctx also carries env (fakeEnv(): toasts, copied, downloads), log (every page operation it received, as
// [name, ...args]) and the mutable page state it reads (ctx.state).
//
// ---------------------------------------------------------------------------------------------------------------
// CHECKS LIST (catalog order; the catalog's filters hide "roastery-orders" unless overrides.catalogHidden says else)
//   harbor-support   "Harbor support inbox"  48 rows (8 held out, 40 tuning), 40 labeled, 3 questions.
//                    gates topic ≥ 0.62, urgent ≥ 0.71; confidence; bound lower; asks jev-1.2, tuned on jev-1.2;
//                    targets 95% / 60%; 1 rule; slice target channel = email (90% / 50%); answer set topic 0.9.
//                    Last run FAIL: 38 labeled, 26 automated, 25 correct, accuracy 25/26, lower bound 0.811 (measured),
//                    coverage 26/38, cost $0.0042, median 412 ms, 1 mistake; slice email fail.
//                    Drift: compared, "shift", 3 queued. Review queue open: 4 rows, 2 ready, 1 audit, 2 edited labels.
//   wholesale-leads  "Wholesale leads"  30 rows, 30 labeled, 2 questions, LOADED in Bulk. gate route ≥ 0.55;
//                    probability; bound estimate; asks the alias jev-latest, tuned on jev-1.2; targets 90% / 30%;
//                    note "Pin …". Last run PASS (answered by jev-1.3): 18 of 30 automated, 17 correct,
//                    accuracy 17/18 (measured), coverage 0.6, cost $0.0021, 380 ms. Upgrade report: retune to jev-1.3.
//   bean-reviews     "Bean reviews"  260 rows (20 held out, 240 tuning → 200 calls), 120 labeled. gate quality ≥ 0.8,
//                    bound lower, jev-1.1, targets 100% / 0%. Not run this session.
//   roastery-orders  name "" (shows as its id)  12 rows, 0 labeled. gate late ≥ 0.5, jev-1.2, targets 90% / 20%.
//                    Last run ERROR (nothing labeled). Its Upgrade panel is open and a check run is RUNNING (busy).
//   cafe-menu        a dataset without a check (never an item)
//
// DRIFT QUEUE (dataset harbor-support; questions topic choice billing/shipping/wholesale, urgent noul, tone score
// 0 Upset / 1 Neutral / 2 Happy; gates topic, urgent; room 1)
//   new row 3   {text: "Two bags of Harbor House arrived crushed", channel: "email"}   topic shipping, urgent yes  READY (will add)
//   new row 5   {text: "Can I pay by invoice for the cafe order?", channel: "chat"}    topic billing, tone 1     incomplete
//   new row 8   {text: "Photo of my receipt", channel: "chat", _image: "receipt-scan"} no labels; picture loaded
//   new row 11  {text: "Where is order HC-3110?", channel: "email", _image: "parcel-photo"} topic shipping, urgent no,
//               tone 0  READY (no room left); picture not loaded
//   new row 12  {text: "", channel: "phone"}   urgent no   incomplete (blank text)
//
// REVIEW QUEUE (dataset harbor-support; same questions; gates topic, urgent; room 1; current row line 4)
//   line 2   review, verified, held urgent, channel email; labels topic shipping (suggested) → incomplete;
//            answers topic shipping / urgent yes / tone 2; shortlist topic [shipping, billing]
//   line 4   review, verified, broke a rule, channel chat; labels topic billing + urgent yes (both human edits) → READY
//            (will add); answers topic wholesale / urgent yes / tone 0 → disagrees on topic
//   line 6   review, UNVERIFIED (no provenance), held topic, channel chat, picture receipt-scan (loaded); no labels;
//            answers topic beans / urgent no / tone 1
//   line 9   audit, blind (nothing labeled), channel email; the decisions file's answers stay hidden
//   line 13  audit, labels topic beans / urgent no / tone 2 (human) → READY (no room left), revealed: answers topic beans /
//            urgent no / tone 1 → disagrees on tone; shortlist topic [beans, wholesale]
//   line 15  audit, topic shipping (human) → incomplete, still blind; channel phone
import { checksListCtx, driftQueueCtx, reviewQueueCtx } from "../../../../static/js/lab/surfaces/workbench-checks.js";
import { fakeEnv } from "../harness.mjs";

export const CHECKS_SURFACE = "workbench.checks.list";
export const DRIFT_SURFACE = "workbench.drift.queue";
export const REVIEW_SURFACE = "workbench.review.queue";

const has = (overrides, key) => Object.prototype.hasOwnProperty.call(overrides, key);
const fresh = (value) => JSON.parse(JSON.stringify(value));

export const CHECK_QUESTIONS = Object.freeze({
  topic: { type: "choice", instructions: "Which team handles this?", criteria: { billing: "Charges and refunds", shipping: "Deliveries and damage", wholesale: "Cafe and bulk orders" } },
  urgent: { type: "noul", instructions: "Does the customer need help today?", criteria: { true: "Cannot use what they paid for", false: "Can wait a day" } },
  tone: { type: "score", instructions: "How does the customer feel?", criteria: ["Upset", "Neutral", "Happy"] },
});
export const REVIEW_QUESTIONS = Object.freeze({ ...CHECK_QUESTIONS,
  topic: { type: "choice", instructions: "Which team handles this?", criteria: { billing: "Charges and refunds", shipping: "Deliveries and damage", wholesale: "Cafe and bulk orders", beans: "Roasts and taste" } } });
const GATES = Object.freeze({ topic: 0.62, urgent: 0.71 });

// ---------------------------------------------------------------------------------------------------------------
// workbench.checks.list
// ---------------------------------------------------------------------------------------------------------------

export function sampleCheckDatasets() {
  return [
    { id: "harbor-support", name: "Harbor support inbox", rows: 48, labeled: 40, questions: 3, saved_at: "2026-11-02T08:00:00Z",
      test: { rows: 8, labeled: 8 }, check_notes: [],
      check: { gates: { topic: 0.62, urgent: 0.71 }, signal: "confidence", bound: "lower", model: "jev-1.2", tuned_on: "jev-1.2",
        min_accuracy: 0.95, min_coverage: 0.6, rules: "if urgent = yes then topic in shipping, billing",
        slice_targets: [{ field: "channel", value: "email", min_accuracy: 0.9, min_coverage: 0.5 }], answer_sets: { topic: 0.9 } } },
    { id: "wholesale-leads", name: "Wholesale leads", rows: 30, labeled: 30, questions: 2, saved_at: "2026-10-20T10:00:00Z",
      check_notes: ["Pin this check to jev-1.2: it asks the alias jev-latest."],
      check: { gates: { route: 0.55 }, signal: "probability", bound: "estimate", model: "jev-latest", tuned_on: "jev-1.2",
        min_accuracy: 0.9, min_coverage: 0.3 } },
    { id: "bean-reviews", name: "Bean reviews", rows: 260, labeled: 120, questions: 1, saved_at: "2026-09-12T16:30:00Z",
      test: { rows: 20, labeled: 20 },
      check: { gates: { quality: 0.8 }, signal: "confidence", bound: "lower", model: "jev-1.1", min_accuracy: 1, min_coverage: 0 } },
    { id: "cafe-menu", name: "Cafe menu questions", rows: 15, labeled: 5, questions: 1, saved_at: "2026-08-01T09:00:00Z" },
    { id: "roastery-orders", name: "", rows: 12, labeled: 0, questions: 1, saved_at: "2026-07-04T12:00:00Z",
      check: { gates: { late: 0.5 }, signal: "confidence", bound: "estimate", model: "jev-1.2", min_accuracy: 0.9, min_coverage: 0.2 } },
  ];
}

const emptyRun = () => ({ running: false, report: null, model: "",
  drift: { open: false, text: "", running: false, report: null, labelsOpen: false, busy: false, saved: null },
  queue: { open: false, text: "", audit: "10", busy: false, report: null, edits: {} },
  upgrade: { open: false, model: "", running: false, report: null } });

export function sampleCheckRuns() {
  const harbor = emptyRun();
  harbor.report = { status: "fail", rows: 40, answered: 40, labeled: 38, unlabeled: 2, automated: 26, correct: 25, coverage: 26 / 38,
    accuracy: 25 / 26, accuracy_low: 0.811, accuracy_high: 0.993,
    targets: { accuracy: { ok: false, value: 0.811, target: 0.95, bound: "lower" }, coverage: { ok: true, value: 26 / 38, target: 0.6 } },
    reasons: ["Accuracy on automated rows is 96.2% (95% lower bound 81.1%), below the 95.0% target."], notes: [],
    model: "jev-1.2", answered_by: ["jev-1.2"], cost_usd: 0.0042, latency_ms_median: 412, wall_ms: 5200, mistakes_total: 1,
    mistakes: [{ index: 7, row: "Grinder burr snapped, refund please", wrong: { topic: { answer: "shipping", label: "billing", signal: 0.81 } } }],
    slice_targets: [{ field: "channel", value: "email", status: "fail", rows: 20, labeled: 19, automated: 12, correct: 12, coverage: 12 / 19,
      accuracy: 1, accuracy_low: 0.758, accuracy_high: 1, reasons: [] }] };
  harbor.drift.report = { status: "shift", check_status: "fail", labeling: { items: [{ line: 1 }, { line: 2 }, { line: 3 }], questions: {}, gates: {} } };
  harbor.queue.open = true;
  harbor.queue.report = { gates: { topic: 0.62 }, items: [
    { line: 1, kind: "review", labels: { topic: "billing" } }, { line: 2, kind: "review", labels: { topic: null } },
    { line: 3, kind: "audit", labels: { topic: "beans" } }, { line: 4, kind: "review", labels: {} }] };
  harbor.queue.edits = { 1: { topic: "billing" }, 3: { topic: "beans" } };
  const wholesale = emptyRun();
  wholesale.report = { status: "pass", rows: 30, answered: 30, labeled: 30, automated: 18, correct: 17, coverage: 0.6,
    accuracy: 17 / 18, accuracy_low: 0.742, accuracy_high: 0.99,
    targets: { accuracy: { ok: true, value: 17 / 18, target: 0.9, bound: "estimate" }, coverage: { ok: true, value: 0.6, target: 0.3 } },
    reasons: [], notes: ["jev-latest answered as jev-1.3, not jev-1.2."], model: "jev-latest", answered_by: ["jev-1.3"],
    cost_usd: 0.0021, latency_ms_median: 380, wall_ms: 2900, mistakes_total: 1, mistakes: [] };
  wholesale.upgrade.report = { verdict: "retune", sides: { current: { model: "jev-1.2" }, candidate: { model: "jev-1.3" } } };
  wholesale.model = "  jev-1.3 ";
  const roastery = emptyRun();
  roastery.running = true;
  roastery.upgrade.open = true;
  roastery.report = { status: "error", rows: 12, answered: 12, labeled: 0, automated: 0, correct: 0, coverage: null, accuracy: null,
    targets: {}, reasons: ["No row is labeled for every gated question (late), so accuracy is unknown."], notes: [], model: "jev-1.2",
    answered_by: ["jev-1.2"], cost_usd: 0.0011, latency_ms_median: null, mistakes_total: 0, mistakes: [] };
  return { "harbor-support": harbor, "wholesale-leads": wholesale, "bean-reviews": emptyRun(), "roastery-orders": roastery };
}

// overrides: datasets, runs, loadedId, catalogHidden (ids the catalog's filters hide; default ["roastery-orders"]),
// lab (a Lab host from createLab whose matches/arrange the ctx routes through, as the page does).
export function sampleChecksListCtx(overrides = {}) {
  const state = {
    datasets: has(overrides, "datasets") ? overrides.datasets : sampleCheckDatasets(),
    runs: has(overrides, "runs") ? overrides.runs : sampleCheckRuns(),
    loadedId: has(overrides, "loadedId") ? overrides.loadedId : "wholesale-leads",
    catalogHidden: has(overrides, "catalogHidden") ? overrides.catalogHidden : ["roastery-orders"],
  };
  const lab = overrides.lab || null;
  const log = [];
  const ctx = checksListCtx({
    datasets: () => state.datasets,
    catalogShown: (dataset) => !state.catalogHidden.includes(dataset.id),
    runs: () => state.runs,
    loadedId: () => state.loadedId,
    matches: lab ? (item, c) => lab.matches(CHECKS_SURFACE, item, c) : undefined,
    arrange: lab ? (items, c) => lab.arrange(CHECKS_SURFACE, items, c) : undefined,
    open: (id, panel, open) => { log.push(["open", id, panel, open]); state.runs[id][panel].open = open; },
    exportGate: (id) => { log.push(["exportGate", id]); },
    goTo: (id) => { log.push(["goTo", id]); },
    refresh: () => { log.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.state = state;
  ctx.log = log;
  return ctx;
}

// ---------------------------------------------------------------------------------------------------------------
// workbench.drift.queue
// ---------------------------------------------------------------------------------------------------------------

export function sampleDriftItemsRaw() {
  return [
    { index: 2, line: 3, row: { text: "Two bags of Harbor House arrived crushed", channel: "email" }, labels: { topic: "shipping", urgent: true, tone: null }, open: ["topic", "urgent"] },
    { index: 4, line: 5, row: { text: "Can I pay by invoice for the cafe order?", channel: "chat" }, labels: { topic: "billing", urgent: null, tone: 1 }, open: ["topic", "urgent"] },
    { index: 7, line: 8, row: { text: "Photo of my receipt", channel: "chat", _image: "receipt-scan" }, labels: { topic: null, urgent: null, tone: null }, open: ["topic", "urgent"] },
    { index: 10, line: 11, row: { text: "Where is order HC-3110?", channel: "email", _image: "parcel-photo" }, labels: { topic: "shipping", urgent: false, tone: 0 }, open: ["topic", "urgent"] },
    { index: 11, line: 12, row: { text: "", channel: "phone" }, labels: { topic: null, urgent: false, tone: null }, open: ["topic", "urgent"] },
  ];
}

export function sampleDriftLabeling(overrides = {}) {
  return { questions: fresh(CHECK_QUESTIONS), gates: { ...GATES },
    items: has(overrides, "items") ? overrides.items : sampleDriftItemsRaw(),
    counts: { eligible: 8, queued: 5, in_dataset: 2, repeated: 1, unsupported: 0 },
    session_context: has(overrides, "sessionContext") ? overrides.sessionContext : "drift-context-1",
    room: has(overrides, "room") ? overrides.room : 1 };
}

// overrides: items, room, sessionContext, labeling (null: no queue), open (default true), busy, recovered, saved,
// pictures, dataset, lab.
export function sampleDriftQueueCtx(overrides = {}) {
  const labeling = has(overrides, "labeling") ? overrides.labeling : sampleDriftLabeling(overrides);
  const drift = { open: true, text: "…", running: false, busy: false, labelsOpen: has(overrides, "open") ? overrides.open : true,
    saved: has(overrides, "saved") ? overrides.saved : null, sessionPreview: null,
    report: labeling ? (overrides.recovered ? { labeling, recovered: true } : { status: "shift", labeling }) : null };
  const page = { busy: overrides.busy === true,
    pictures: has(overrides, "pictures") ? overrides.pictures : { "receipt-scan": "/api/workbench/images/receipt-scan.png" },
    dataset: has(overrides, "dataset") ? overrides.dataset : { id: "harbor-support", name: "Harbor support inbox" } };
  const lab = overrides.lab || null;
  const log = [];
  const ctx = driftQueueCtx({
    dataset: () => page.dataset,
    drift: () => drift,
    busy: () => page.busy,
    pictures: () => page.pictures,
    matches: lab ? (item, c) => lab.matches(DRIFT_SURFACE, item, c) : undefined,
    arrange: lab ? (items, c) => lab.arrange(DRIFT_SURFACE, items, c) : undefined,
    writeLabels: (changes, label) => {
      log.push(["writeLabels", fresh(changes), label]);
      for (const [line, labels] of changes) Object.assign(drift.report.labeling.items.find((item) => item.line === line).labels, labels);
      drift.sessionPreview = null;
    },
    goTo: (line) => { log.push(["goTo", line]); },
    openLabels: (open) => { log.push(["openLabels", open]); drift.labelsOpen = open; },
    refresh: () => { log.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.state = drift;
  ctx.page_state = page;
  ctx.log = log;
  return ctx;
}

// ---------------------------------------------------------------------------------------------------------------
// workbench.review.queue
// ---------------------------------------------------------------------------------------------------------------

const PROVENANCE = Object.freeze({ version: 1, questions: "sha256:harbor-q", model: "jev-1.2", gates: { topic: 0.62, urgent: 0.71 } });

export function sampleReviewItemsRaw() {
  const verified = () => ({ provenance: { ...PROVENANCE, gates: { ...PROVENANCE.gates } } });
  return [
    { line: 2, kind: "review", route: "review", ...verified(), row: { text: "My grinder arrived with a cracked hopper", channel: "email" },
      held: ["urgent"], rules: [], open: ["urgent"], answers: { topic: "shipping", urgent: true, tone: 2 },
      labels: { topic: "shipping", urgent: null, tone: null }, candidates: { topic: ["shipping", "billing"] }, slice_values: { channel: "email" } },
    { line: 4, kind: "review", route: "review", ...verified(), row: { text: "Charged twice for the wholesale order", channel: "chat" },
      held: [], rules: ["if urgent = yes then topic in shipping, billing"], open: ["topic", "urgent", "tone"],
      answers: { topic: "wholesale", urgent: true, tone: 0 }, labels: { topic: "billing", urgent: true, tone: null }, slice_values: { channel: "chat" } },
    { line: 6, kind: "review", route: "review", row: { text: "Receipt attached, wrong roast sent", channel: "chat", _image: "receipt-scan" },
      held: ["topic"], rules: [], open: ["topic"], answers: { topic: "beans", urgent: false, tone: 1 },
      labels: { topic: null, urgent: null, tone: null }, slice_values: { channel: "chat" } },
    { line: 9, kind: "audit", route: "auto", ...verified(), row: { text: "Love the Sumatra roast", channel: "email" },
      held: [], rules: [], open: ["topic", "urgent", "tone"], answers: { topic: "shipping", urgent: false, tone: 2 },
      labels: { topic: null, urgent: null, tone: null }, candidates: { topic: ["shipping"] }, slice_values: { channel: "email" } },
    { line: 13, kind: "audit", route: "auto", ...verified(), row: { text: "Do you roast decaf on Fridays? Ask roastery@harbor.example", channel: "phone" },
      held: [], rules: [], open: ["topic", "urgent", "tone"], answers: { topic: "beans", urgent: false, tone: 1 },
      labels: { topic: "beans", urgent: false, tone: 2 }, candidates: { topic: ["beans", "wholesale"] }, slice_values: { channel: "phone" } },
    { line: 15, kind: "audit", route: "auto", ...verified(), row: { text: "Parcel left at the wrong door", channel: "phone" },
      held: [], rules: [], open: ["topic", "urgent", "tone"], answers: { topic: "shipping", urgent: true, tone: 0 },
      labels: { topic: "shipping", urgent: null, tone: null }, slice_values: { channel: "phone" } },
  ];
}

export function sampleReviewEdits() {
  const edit = (labels) => Object.assign(Object.create(null), labels);
  return { 4: edit({ topic: "billing", urgent: true }), 13: edit({ topic: "beans", urgent: false, tone: 2 }), 15: edit({ topic: "shipping" }) };
}

export function sampleReviewReport(overrides = {}) {
  return { dataset: { id: "harbor-support" }, items: has(overrides, "items") ? overrides.items : sampleReviewItemsRaw(),
    questions: fresh(REVIEW_QUESTIONS), gates: { ...GATES },
    counts: { decisions: 20, review: 5, auto: 15, in_dataset: 1, repeated: 1, unverified: 1, queued: 6, audit: 3, dropped: 0 },
    problems: [{ line: 7, message: "Line 7 is not JSON" }, { line: 18, message: "Line 18 has no row" }], problems_total: 2,
    room: has(overrides, "room") ? overrides.room : 1,
    slice_fields: [{ name: "channel", values: ["chat", "email", "phone"] }],
    seed: 7, audit_requested: 3, session_context: has(overrides, "sessionContext") ? overrides.sessionContext : "review-context-1" };
}

// overrides: items, room, sessionContext, report (null: nothing read), edits, kind, status, sliceField, sliceValue,
// nextLine, busy, textChanged, csvPreview, pictures, dataset, lab.
export function sampleReviewQueueCtx(overrides = {}) {
  const text = '{"route":"review","row":{"text":"…"}}\n';
  const q = { open: true, audit: "3", busy: overrides.busy === true,
    report: has(overrides, "report") ? overrides.report : sampleReviewReport(overrides),
    edits: has(overrides, "edits") ? overrides.edits : sampleReviewEdits(),
    kindFilter: overrides.kind || "all", statusFilter: overrides.status || "all",
    sliceField: overrides.sliceField || "", sliceValue: overrides.sliceValue || "",
    nextLine: has(overrides, "nextLine") ? overrides.nextLine : 4,
    text: overrides.textChanged ? `${text}{"route":"auto"}\n` : text, readText: text,
    csvPreview: has(overrides, "csvPreview") ? overrides.csvPreview : null, sessionPreview: null, audit_report: null };
  const page = {
    pictures: has(overrides, "pictures") ? overrides.pictures : { "receipt-scan": "/api/workbench/images/receipt-scan.png" },
    dataset: has(overrides, "dataset") ? overrides.dataset : { id: "harbor-support", name: "Harbor support inbox" } };
  const lab = overrides.lab || null;
  const log = [];
  const ready = (item) => Object.keys(q.report.gates).every((qid) => item.labels[qid] !== null && item.labels[qid] !== undefined);
  const ctx = reviewQueueCtx({
    dataset: () => page.dataset,
    queue: () => q,
    pictures: () => page.pictures,
    matches: lab ? (item, c) => lab.matches(REVIEW_SURFACE, item, c) : undefined,
    arrange: lab ? (items, c) => lab.arrange(REVIEW_SURFACE, items, c) : undefined,
    writeLabels: (changes, label) => {
      log.push(["writeLabels", fresh(changes), label]);
      for (const [line, labels] of changes) {
        const item = q.report.items.find((entry) => entry.line === line);
        for (const [qid, value] of Object.entries(labels)) {
          item.labels[qid] = value;
          ((q.edits ||= {})[line] ||= Object.create(null))[qid] = value;
        }
      }
      if (changes.length === 1) q.nextLine = changes[0][0];
      q.sessionPreview = q.csvPreview = null;
    },
    goTo: (line) => { log.push(["goTo", line]); q.nextLine = line; },
    // The page's nextQueueRow: the next incomplete row after the current one, in queue order, of the selected kind and
    // slice, among the rows Lab's filters leave; it sets the status filter to Incomplete.
    next: (direction) => {
      log.push(["next", direction]);
      const pool = q.report.items.filter((raw) => ctx.page.matches(raw));
      const ordered = direction < 0 ? [...pool].reverse() : pool;
      const start = ordered.findIndex((item) => item.line === q.nextLine);
      const item = [...ordered.slice(start + 1), ...ordered.slice(0, start + 1)].find((entry) => (q.kindFilter === "all" || entry.kind === q.kindFilter)
        && !ready(entry) && (!q.sliceField || entry.slice_values?.[q.sliceField] === q.sliceValue));
      if (item) { q.statusFilter = "incomplete"; q.nextLine = item.line; }
    },
    setFilter: (name, value) => { log.push(["setFilter", name, value]); q[name] = value; q.nextLine = null; },
    setSlice: (field, value) => { log.push(["setSlice", field, value]); q.sliceField = field; q.sliceValue = value; q.nextLine = null; },
    resetFilters: () => {
      log.push(["resetFilters"]);
      Object.assign(q, { kindFilter: "all", statusFilter: "all", sliceField: "", sliceValue: "", nextLine: null });
      lab?.reset(REVIEW_SURFACE);
    },
    refresh: () => { log.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.state = q;
  ctx.page_state = page;
  ctx.log = log;
  return ctx;
}
