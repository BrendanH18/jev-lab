// Fixtures for packs on the Workbench pre-run labeling queue (contract: static/js/lab/surfaces/workbench-labeling.js).
// Not a test file.
//
//   import { sampleLabelingQueueCtx, LABELING_SURFACE } from "./fixtures/workbench-labeling.mjs";
//   const ctx = sampleLabelingQueueCtx();                          // seven queue rows, all shown (status "all")
//   const some = sampleLabelingQueueCtx({ status: "incomplete" });   // the page filter hides the two ready rows
//   const chat = sampleLabelingQueueCtx({ slice: "chat" });          // the "channel = chat" slice: three rows, and
//                                                                   // drafts on rows outside the slice
//   const closed = sampleLabelingQueueCtx({ report: null });         // no queue opened yet: items() is []
//   const stale = sampleLabelingQueueCtx({ current: false });        // rows changed since: the queue is closed
//   const R = Object.fromEntries(sampleLabelingQueueCtx().items().map((item) => [item.row_number, item]));
//
// Every ctx is made by the real builder (labelingQueueCtx) from a hand-written server report shaped like
// POST /api/workbench/prelabel, a page state shaped like W.bulk.prelabel, and stand-ins for the page operations that
// change that state the way the page does (writeDrafts merges into state.drafts, next uses prelabel.js nextLabel).
// Harbor Coffee Co. support inbox; .example domains only. Labels here are made-up human drafts.
//
// Questions (in order): urgent (noul, with yes/no criteria), topic (choice: billing / shipping / wholesale / beans),
// tone (score: 0 Upset, 1 Neutral, 2 Happy). Box questions never reach this queue.
// The rows box has ten nonempty rows (index 0..9). Index 2 is a held-out test row and index 7 is fully labeled, so
// neither is in the queue. The queue (slice "all rows", rows-box order):
//   Row 1  (index 0) object {text, channel: "email"} "My order HC-2041 arrived with a torn bag."
//          missing urgent, topic, tone; draft urgent yes, topic shipping, tone 0 -> READY
//   Row 2  (index 1) TEXT "Do you sell 5 lb bags of the Harbor House blend wholesale? Reply to buyer@cafe-north.example"
//          missing urgent, topic, tone; draft topic wholesale -> incomplete (partly drafted). The CURRENT row.
//   Row 4  (index 3) object {text, channel: "chat", _image: "receipt-scan"} "Charged twice for my subscription"
//          missing topic, tone (urgent is labeled); no draft -> incomplete. Picture loaded.
//   Row 5  (index 4) the SAME input as row 4 (duplicate identity); missing topic, tone; draft topic billing.
//   Row 6  (index 5) object {text, channel: "email", _image: "latte-photo"} "Love the new Sumatra roast!"
//          missing tone; draft tone 2 -> READY. Picture NOT loaded.
//   Row 7  (index 6) object {text: "", channel: "phone"} (blank text); missing urgent; no draft.
//   Row 9  (index 8) object {text, channel: "chat", order: {id: "HC-2077", items: 2}} "Where is my order?"
//          missing urgent, topic; draft urgent no -> partly drafted.
// Slice "chat": rows 4, 5 and 9 (field "channel", value "chat"); the drafts on rows 1, 2 and 6 lie outside it.
// Dataset "harbor-support" (Harbor support inbox) with guidelines for urgent (note and two examples) and topic (no
// note; one valid example, one whose label is not an option and is dropped); tone has none.
//
// overrides: report (null closes the queue), current (false: stale snapshot), slice ("all" | "chat"), status, drafts,
// nextIndex, busy, csvPreview, pictures, dataset, guidelines (the loaded server data, or null), lab (a Lab host from
// createLab whose matches/arrange the ctx routes through, as the page does).
// The ctx also carries env (fakeEnv(): toasts, copied, downloads), state (the mutable W.bulk.prelabel stand-in) and
// log: every page operation it received, as [name, ...args].
import { nextLabel } from "../../../../static/js/prelabel.js";
import { labelingQueueCtx } from "../../../../static/js/lab/surfaces/workbench-labeling.js";
import { fakeEnv } from "../harness.mjs";

export const LABELING_SURFACE = "workbench.labeling.queue";

export const LABELING_QUESTIONS = Object.freeze({
  urgent: { type: "noul", instructions: "Does the customer need help today?", criteria: { true: "Cannot use what they paid for", false: "Can wait a day" } },
  topic: { type: "choice", instructions: { task: "Which team handles this?" },
    criteria: { billing: "Charges and refunds", shipping: "Deliveries and damage", wholesale: "Cafe and bulk orders", beans: "Roasts and taste" } },
  tone: { type: "score", instructions: "How does the customer feel?", criteria: ["Upset", "Neutral", "Happy"] },
});

const TWICE = { text: "Charged twice for my subscription", channel: "chat", _image: "receipt-scan" };

// The queue rows exactly as the server returns them (fresh copies on every call).
export function sampleLabelingItemsRaw() {
  return [
    { index: 0, row: { text: "My order HC-2041 arrived with a torn bag.", channel: "email" }, missing: ["urgent", "topic", "tone"] },
    { index: 1, row: "Do you sell 5 lb bags of the Harbor House blend wholesale? Reply to buyer@cafe-north.example", missing: ["urgent", "topic", "tone"] },
    { index: 3, row: { ...TWICE }, missing: ["topic", "tone"] },
    { index: 4, row: { ...TWICE }, missing: ["topic", "tone"] },
    { index: 5, row: { text: "Love the new Sumatra roast!", channel: "email", _image: "latte-photo" }, missing: ["tone"] },
    { index: 6, row: { text: "", channel: "phone" }, missing: ["urgent"] },
    { index: 8, row: { text: "Where is my order?", channel: "chat", order: { id: "HC-2077", items: 2 } }, missing: ["urgent", "topic"] },
  ];
}

export function sampleLabelingReport(slice = "all") {
  const all = sampleLabelingItemsRaw();
  const chat = slice === "chat";
  return {
    items: chat ? all.filter((item) => item.row.channel === "chat") : all,
    questions: JSON.parse(JSON.stringify(LABELING_QUESTIONS)),
    fields: [{ name: "channel" }, { name: "order" }, { name: "text" }],
    field: chat ? "channel" : null,
    value: chat ? "chat" : null,
    values: chat ? [{ value: "chat", shown: "chat", rows: 3 }, { value: "email", shown: "email", rows: 2 }, { value: "phone", shown: "phone", rows: 1 }] : [],
    eligible: 7,
    missing: 14,
  };
}

// Drafts as the page keeps them: Object.create(null) maps by row index.
export function sampleLabelingDrafts() {
  const draft = (labels) => Object.assign(Object.create(null), labels);
  return { 0: draft({ urgent: true, topic: "shipping", tone: 0 }), 1: draft({ topic: "wholesale" }), 4: draft({ topic: "billing" }),
    5: draft({ tone: 2 }), 8: draft({ urgent: false }) };
}

export function sampleLabelingGuidelines() {
  return {
    id: "harbor-support", saved_at: "2026-11-10T09:00:00Z", warnings: [],
    questions: JSON.parse(JSON.stringify(LABELING_QUESTIONS)),
    guidelines: {
      urgent: { note: "  Urgent means the customer cannot use what they paid for today.  ",
        examples: [{ input: "My grinder arrived broken", label: true, why: "cannot brew" }, { input: "Do you ship to the islands?", label: false }] },
      topic: { examples: [{ input: "Refund my double charge", label: "billing" }, { input: "Pick a mug", label: "mugs" }] },
    },
  };
}

export function sampleLabelingQueueCtx(overrides = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
  const state = {
    busy: overrides.busy === true,
    report: has("report") ? overrides.report : sampleLabelingReport(overrides.slice || "all"),
    context: "snapshot",
    drafts: has("drafts") ? overrides.drafts : sampleLabelingDrafts(),
    field: null, value: null,
    status: overrides.status || "all",
    nextIndex: has("nextIndex") ? overrides.nextIndex : 1,
    csvPreview: has("csvPreview") ? overrides.csvPreview : null,
  };
  const page = {
    current: has("current") ? overrides.current : true,
    pictures: has("pictures") ? overrides.pictures : { "receipt-scan": "/api/workbench/images/receipt-scan.png" },
    dataset: has("dataset") ? overrides.dataset : { id: "harbor-support", name: "Harbor support inbox" },
    guidelines: has("guidelines") ? overrides.guidelines : sampleLabelingGuidelines(),
  };
  const lab = overrides.lab || null;
  const log = [];
  const ctx = labelingQueueCtx({
    state: () => state,
    current: () => page.current,
    pictures: () => page.pictures,
    dataset: () => page.dataset,
    guidelines: () => page.guidelines,
    matches: lab ? (item, c) => lab.matches(LABELING_SURFACE, item, c) : undefined,
    arrange: lab ? (items, c) => lab.arrange(LABELING_SURFACE, items, c) : undefined,
    writeDrafts: (changes, label) => {
      log.push(["writeDrafts", JSON.parse(JSON.stringify(changes)), label]);
      for (const [index, labels] of changes) {
        const target = state.drafts[index] ||= Object.create(null);
        for (const [qid, value] of Object.entries(labels)) {
          if (value === null) delete target[qid]; else target[qid] = value;
        }
      }
      state.csvPreview = null;
    },
    goTo: (index) => { log.push(["goTo", index]); state.nextIndex = index; },
    next: (direction) => {
      log.push(["next", direction]);
      const pool = state.report.items.filter((raw) => ctx.page.matches(raw));
      const item = nextLabel(pool, state.drafts, state.nextIndex, direction);
      if (item) { state.nextIndex = item.index; state.status = "incomplete"; }
    },
    setStatus: (status) => { log.push(["setStatus", status]); state.status = status; },
    prepare: async (field, value) => { log.push(["prepare", field, value]); },
    resetFilters: () => { log.push(["resetFilters"]); state.status = "all"; lab?.reset(LABELING_SURFACE); },
    refresh: () => { log.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.state = state;
  ctx.page_state = page;
  ctx.log = log;
  return ctx;
}
