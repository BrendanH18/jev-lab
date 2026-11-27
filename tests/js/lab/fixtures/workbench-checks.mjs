// Fixtures for packs on the Workbench Review queue (contract: static/js/lab/surfaces/workbench-checks.js). Not a test
// file.
//
//   import { sampleReviewQueueCtx } from "./fixtures/workbench-checks.mjs";
//   const review = sampleReviewQueueCtx();          // six queued rows: three review, three audit (two still blind)
//   const audits = sampleReviewQueueCtx({ kind: "audit" });   // the page's "Audit only" filter
//
// Every ctx is made by the real builder from hand-written page state shaped like W.bulk.checkRuns[id].queue and the
// server's report (POST /api/workbench/checks/decisions), with stand-ins for the
// page operations that change that state the way the page does. Harbor Coffee Co.; .example domains only. Answers and
// measured values here are made up.
//
// Each ctx also carries env (fakeEnv(): toasts, copied, downloads), log (every page operation it received, as
// [name, ...args]) and the mutable page state it reads (ctx.state).
//
// REVIEW QUEUE (dataset harbor-support; questions topic choice billing/shipping/wholesale/beans, urgent noul, tone
// score 0 Upset / 1 Neutral / 2 Happy; gates topic, urgent; room 1; current row line 4)
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
import { reviewQueueCtx } from "../../../../static/js/lab/surfaces/workbench-checks.js";
import { fakeEnv } from "../harness.mjs";

export const REVIEW_SURFACE = "workbench.review.queue";

const has = (overrides, key) => Object.hasOwn(overrides, key);
const fresh = (value) => JSON.parse(JSON.stringify(value));

export const CHECK_QUESTIONS = Object.freeze({
  topic: {
    type: "choice",
    instructions: "Which team handles this?",
    criteria: { billing: "Charges and refunds", shipping: "Deliveries and damage", wholesale: "Cafe and bulk orders" },
  },
  urgent: {
    type: "noul",
    instructions: "Does the customer need help today?",
    criteria: { true: "Cannot use what they paid for", false: "Can wait a day" },
  },
  tone: { type: "score", instructions: "How does the customer feel?", criteria: ["Upset", "Neutral", "Happy"] },
});
export const REVIEW_QUESTIONS = Object.freeze({
  ...CHECK_QUESTIONS,
  topic: {
    type: "choice",
    instructions: "Which team handles this?",
    criteria: {
      billing: "Charges and refunds",
      shipping: "Deliveries and damage",
      wholesale: "Cafe and bulk orders",
      beans: "Roasts and taste",
    },
  },
});
const GATES = Object.freeze({ topic: 0.62, urgent: 0.71 });

// ---------------------------------------------------------------------------------------------------------------
// workbench.review.queue
// ---------------------------------------------------------------------------------------------------------------

const PROVENANCE = Object.freeze({
  version: 1,
  questions: "sha256:harbor-q",
  model: "jev-1.2",
  gates: { topic: 0.62, urgent: 0.71 },
});

export function sampleReviewItemsRaw() {
  const verified = () => ({ provenance: { ...PROVENANCE, gates: { ...PROVENANCE.gates } } });
  return [
    {
      line: 2,
      kind: "review",
      route: "review",
      ...verified(),
      row: { text: "My grinder arrived with a cracked hopper", channel: "email" },
      held: ["urgent"],
      rules: [],
      open: ["urgent"],
      answers: { topic: "shipping", urgent: true, tone: 2 },
      labels: { topic: "shipping", urgent: null, tone: null },
      candidates: { topic: ["shipping", "billing"] },
      slice_values: { channel: "email" },
    },
    {
      line: 4,
      kind: "review",
      route: "review",
      ...verified(),
      row: { text: "Charged twice for the wholesale order", channel: "chat" },
      held: [],
      rules: ["if urgent = yes then topic in shipping, billing"],
      open: ["topic", "urgent", "tone"],
      answers: { topic: "wholesale", urgent: true, tone: 0 },
      labels: { topic: "billing", urgent: true, tone: null },
      slice_values: { channel: "chat" },
    },
    {
      line: 6,
      kind: "review",
      route: "review",
      row: { text: "Receipt attached, wrong roast sent", channel: "chat", _image: "receipt-scan" },
      held: ["topic"],
      rules: [],
      open: ["topic"],
      answers: { topic: "beans", urgent: false, tone: 1 },
      labels: { topic: null, urgent: null, tone: null },
      slice_values: { channel: "chat" },
    },
    {
      line: 9,
      kind: "audit",
      route: "auto",
      ...verified(),
      row: { text: "Love the Sumatra roast", channel: "email" },
      held: [],
      rules: [],
      open: ["topic", "urgent", "tone"],
      answers: { topic: "shipping", urgent: false, tone: 2 },
      labels: { topic: null, urgent: null, tone: null },
      candidates: { topic: ["shipping"] },
      slice_values: { channel: "email" },
    },
    {
      line: 13,
      kind: "audit",
      route: "auto",
      ...verified(),
      row: { text: "Do you roast decaf on Fridays? Ask roastery@harbor.example", channel: "phone" },
      held: [],
      rules: [],
      open: ["topic", "urgent", "tone"],
      answers: { topic: "beans", urgent: false, tone: 1 },
      labels: { topic: "beans", urgent: false, tone: 2 },
      candidates: { topic: ["beans", "wholesale"] },
      slice_values: { channel: "phone" },
    },
    {
      line: 15,
      kind: "audit",
      route: "auto",
      ...verified(),
      row: { text: "Parcel left at the wrong door", channel: "phone" },
      held: [],
      rules: [],
      open: ["topic", "urgent", "tone"],
      answers: { topic: "shipping", urgent: true, tone: 0 },
      labels: { topic: "shipping", urgent: null, tone: null },
      slice_values: { channel: "phone" },
    },
  ];
}

export function sampleReviewEdits() {
  const edit = (labels) => Object.assign(Object.create(null), labels);
  return {
    4: edit({ topic: "billing", urgent: true }),
    13: edit({ topic: "beans", urgent: false, tone: 2 }),
    15: edit({ topic: "shipping" }),
  };
}

export function sampleReviewReport(overrides = {}) {
  return {
    dataset: { id: "harbor-support" },
    items: has(overrides, "items") ? overrides.items : sampleReviewItemsRaw(),
    questions: fresh(REVIEW_QUESTIONS),
    gates: { ...GATES },
    counts: {
      decisions: 20,
      review: 5,
      auto: 15,
      in_dataset: 1,
      repeated: 1,
      unverified: 1,
      queued: 6,
      audit: 3,
      dropped: 0,
    },
    problems: [
      { line: 7, message: "Line 7 is not JSON" },
      { line: 18, message: "Line 18 has no row" },
    ],
    problems_total: 2,
    room: has(overrides, "room") ? overrides.room : 1,
    slice_fields: [{ name: "channel", values: ["chat", "email", "phone"] }],
    seed: 7,
    audit_requested: 3,
    session_context: has(overrides, "sessionContext") ? overrides.sessionContext : "review-context-1",
  };
}

// overrides: items, room, sessionContext, report (null: nothing read), edits, kind, status, sliceField, sliceValue,
// nextLine, busy, textChanged, csvPreview, pictures, dataset, lab.
export function sampleReviewQueueCtx(overrides = {}) {
  const text = '{"route":"review","row":{"text":"…"}}\n';
  const q = {
    open: true,
    audit: "3",
    busy: overrides.busy === true,
    report: has(overrides, "report") ? overrides.report : sampleReviewReport(overrides),
    edits: has(overrides, "edits") ? overrides.edits : sampleReviewEdits(),
    kindFilter: overrides.kind || "all",
    statusFilter: overrides.status || "all",
    sliceField: overrides.sliceField || "",
    sliceValue: overrides.sliceValue || "",
    nextLine: has(overrides, "nextLine") ? overrides.nextLine : 4,
    text: overrides.textChanged ? `${text}{"route":"auto"}\n` : text,
    readText: text,
    csvPreview: has(overrides, "csvPreview") ? overrides.csvPreview : null,
    sessionPreview: null,
    audit_report: null,
  };
  const page = {
    pictures: has(overrides, "pictures")
      ? overrides.pictures
      : { "receipt-scan": "/api/workbench/images/receipt-scan.png" },
    dataset: has(overrides, "dataset") ? overrides.dataset : { id: "harbor-support", name: "Harbor support inbox" },
  };
  const lab = overrides.lab || null;
  const log = [];
  const ready = (item) =>
    Object.keys(q.report.gates).every((qid) => item.labels[qid] !== null && item.labels[qid] !== undefined);
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
    goTo: (line) => {
      log.push(["goTo", line]);
      q.nextLine = line;
    },
    // The page's nextQueueRow: the next incomplete row after the current one, in queue order, of the selected kind and
    // slice, among the rows Lab's filters leave; it sets the status filter to Incomplete.
    next: (direction) => {
      log.push(["next", direction]);
      const pool = q.report.items.filter((raw) => ctx.page.matches(raw));
      const ordered = direction < 0 ? [...pool].reverse() : pool;
      const start = ordered.findIndex((item) => item.line === q.nextLine);
      const item = [...ordered.slice(start + 1), ...ordered.slice(0, start + 1)].find(
        (entry) =>
          (q.kindFilter === "all" || entry.kind === q.kindFilter) &&
          !ready(entry) &&
          (!q.sliceField || entry.slice_values?.[q.sliceField] === q.sliceValue),
      );
      if (item) {
        q.statusFilter = "incomplete";
        q.nextLine = item.line;
      }
    },
    setFilter: (name, value) => {
      log.push(["setFilter", name, value]);
      q[name] = value;
      q.nextLine = null;
    },
    setSlice: (field, value) => {
      log.push(["setSlice", field, value]);
      q.sliceField = field;
      q.sliceValue = value;
      q.nextLine = null;
    },
    resetFilters: () => {
      log.push(["resetFilters"]);
      Object.assign(q, { kindFilter: "all", statusFilter: "all", sliceField: "", sliceValue: "", nextLine: null });
      lab?.reset(REVIEW_SURFACE);
    },
    refresh: () => {
      log.push(["refresh"]);
    },
  });
  ctx.env = fakeEnv();
  ctx.state = q;
  ctx.page_state = page;
  ctx.log = log;
  return ctx;
}
