import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/review-queue-more.js";
import { checkPack } from "./harness.mjs";
import { sampleReviewEdits, sampleReviewItemsRaw, sampleReviewQueueCtx, sampleReviewReport } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleReviewQueueCtx(overrides);
const empty = () => ctx({ report: null });
const R = Object.fromEntries(ctx().items().map((item) => [item.line, item]));
const [R2, R4, R6, R9, R13, R15] = [R[2], R[4], R[6], R[9], R[13], R[15]];
const copy = (value) => JSON.parse(JSON.stringify(value));
// A report whose server counts or audit request differ from the sample's.
const report = (patch, counts = {}) => {
  const rep = sampleReviewReport();
  Object.assign(rep, patch);
  Object.assign(rep.counts, counts);
  return rep;
};

// Line 22: a review row where the person changed urgent but left the gate's topic suggestion untouched.
const mixed = ctx({ items: [...sampleReviewItemsRaw(), { line: 22, kind: "review", provenance: { version: 1 }, row: { text: "Refill pods missing from the box", channel: "chat" },
  held: ["urgent"], rules: [], open: ["urgent"], answers: { topic: "shipping", urgent: true, tone: 1 }, labels: { topic: "shipping", urgent: false, tone: null },
  slice_values: { channel: "chat" } }], edits: { ...sampleReviewEdits(), 22: { urgent: false } } });
const MIX = mixed.items().find((item) => item.line === 22);
// Line 2 with a topic its shortlist [shipping, billing] did not offer.
const OUTSIDE = { ...copy(R2), labels: { ...R2.labels, topic: "wholesale" } };
const unloaded = Object.fromEntries(ctx({ pictures: {} }).items().map((item) => [item.line, item]));
const reviewOnly = () => sampleReviewItemsRaw().filter((item) => item.kind === "review");

checkPack(pack, {
  open_questions: { items: [R2, R4, R6, R9], values: [1, 3, 1, 3] },
  labels_set: { items: [R2, R4, R6, R13, R15], values: [1, 2, 0, 3, 1] },
  suggested_labels: { items: [R2, R4, R13], values: [1, 0, 0] },
  // tone is the only question outside the gate: blank on lines 2 and 4, labeled 2 on line 13.
  optional_missing: { items: [R2, R4, R13], values: [1, 1, 0], ctx: ctx() },
  // Line 2: [shipping, billing]; line 13: [beans, wholesale]; line 4 has none; line 9 is still blind.
  shortlist_options: { items: [R2, R4, R13, R9, R6], values: [2, 0, 2, null, 0] },
  input_fields: { items: [R2, R6, { row: { text: "Decaf in stock?" } }, { row: "plain" }], values: [2, 2, 1, null] },
  label_outside_shortlist: { items: [OUTSIDE, R2, R13, R9], values: [true, false, false, false] },
  current_row: { items: [R4, R2], values: [true, false] },
  mixed_edits: { items: [MIX, R4, R2, R13], values: [true, false, false, false], ctx: mixed },
  picture_not_loaded: { items: [unloaded[6], unloaded[2], R6], values: [true, false, false] },
  held_set: { items: [R2, R6, R4, R9], values: ["urgent", "topic", "none", null] },
  missing_set: { items: [R2, R4, R6, R9], values: ["urgent", "none", "topic, urgent", "topic, urgent"] },
  rule_text: { items: [R4, R2, { rules: ["if tone = 0 then urgent in yes"] }],
    values: ["if urgent = yes then topic in shipping, billing", "", "if tone = 0 then urgent in yes"] },

  ready_open_blank: { hit: R4, miss: [R13, R2, R6], message: /^tone is open on this row but has no label; Add saves the row without it\.$/ },
  audit_partly_labeled: { hit: R15, miss: [R9, R13, R2], message: /^urgent still needs a label\. Add skips this audit row/ },
  no_audit_sample: (() => {
    const none = ctx({ report: report({ items: reviewOnly(), audit_requested: 0 }, { audit: 0, queued: 3 }) });
    // Quiet when a sample was asked for but none could be drawn: "Fewer audit rows than asked" says that instead.
    const shortfall = ctx({ report: report({ items: reviewOnly(), audit_requested: 3 }, { audit: 0, queued: 3 }) });
    return { ctx: none, hitList: none.items(), missList: shortfall.items(), missCtx: shortfall, message: /^The queue holds no audit rows from the 15 automated decisions/ };
  })(),
  // 0.98 / √3 = 0.5658 -> ±56.6; (0.98 / 0.10)² = 96.04 -> 97 rows; (0.98 / 0.05)² = 384.16 -> 385 rows. 100 rows: 0.098.
  wide_audit_margin: { ctx: ctx(), hitList: ctx().items(), missList: ctx().items(), missCtx: ctx({ report: report({}, { audit: 100 }) }),
    message: /^3 audit rows give a worst-case 95% margin of ±56\.6 points; about 97 give ±10 points and 385 give ±5\.$/ },
  audit_short: { ctx: ctx({ report: report({ audit_requested: 5 }) }), hitList: Object.values(R), missList: Object.values(R), missCtx: ctx(),
    message: /^You asked for 5 audit rows; the queue holds 3\./ },
  current_hidden: (() => {
    const audits = ctx({ kind: "audit" });
    return { ctx: audits, hitList: audits.shown(), missList: ctx().shown(), missCtx: ctx(), message: /^Line 4, the current row, is hidden by the current filters\.$/ };
  })(),
  text_changed: { ctx: ctx({ textChanged: true }), hitList: Object.values(R), missList: Object.values(R), missCtx: ctx(), message: /Download Review session is off/ },

  audit_margin: [{ ctx: ctx(), expect: 0.98 / Math.sqrt(3), tolerance: 1e-12, empty: empty() },
    { ctx: ctx({ report: report({ items: reviewOnly() }, { audit: 0 }) }), expect: null }],
  // 3 audit rows of 15 automated decisions.
  audit_sampling_share: [{ ctx: ctx(), expect: 0.2, tolerance: 1e-12, empty: empty() },
    { ctx: ctx({ report: report({}, { auto: 0 }) }), expect: null }],
  // Review rows 2, 4, 6: only line 4 is ready.
  review_progress: [{ ctx: ctx(), expect: 1 / 3, tolerance: 1e-12, empty: empty() },
    { ctx: ctx({ items: sampleReviewItemsRaw().filter((item) => item.kind === "audit") }), expect: null }],
  // Lines 2 and 9 email, 4 and 6 chat, 13 and 15 phone. Review rows only: 2 email, 4 and 6 chat.
  slice_values: [{ ctx: ctx(), empty: empty(),
    expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "channel: chat 2, email 2, phone 2"); } },
  { ctx: ctx({ items: reviewOnly() }), expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "channel: chat 2, email 1"); } }],
  // Lines 4 and 13 are ready, room for 1.
  ready_waiting: [{ ctx: ctx(), expect: 1, empty: empty() }, { ctx: ctx({ room: 5 }), expect: 0 }],

  // topic: labeled on 2, 4, 13, 15; edited on 4, 13, 15; suggested on 2. urgent: labeled and edited on 4, 13. tone: 13.
  question_progress_csv: { ctx: ctx(), filename: "jev-review-questions.csv",
    text: '"question","type","gated","threshold","labeled","missing","edited","suggested"\r\n'
      + '"topic","choice","yes","0.62","4","2","3","1"\r\n'
      + '"urgent","noul","yes","0.71","2","4","2","0"\r\n'
      + '"tone","score","no","","1","5","1","0"\r\n',
    excludes: ["shipping", "billing", "beans"] },
  reasons_csv: { ctx: ctx(), filename: "jev-review-reasons.csv",
    text: '"line","kind","provenance","held","rules_broken","open"\r\n'
      + '"2","review","verified","urgent","","urgent"\r\n'
      + '"4","review","verified","","if urgent = yes then topic in shipping, billing","topic urgent tone"\r\n'
      + '"6","review","none","topic","","topic"\r\n'
      + '"9","audit","verified","","","topic urgent tone"\r\n'
      + '"13","audit","verified","","","topic urgent tone"\r\n'
      + '"15","audit","verified","","","topic urgent tone"\r\n',
    excludes: ["grinder", "Charged twice", "beans", "roastery@"] },
  summary_text: { ctx: ctx(), filename: "jev-review-summary.txt",
    text: "Review queue for Harbor support inbox (harbor-support)\n"
      + "Decisions read: 20 (5 to review, 15 automated)\n"
      + "Queued: 6 (3 to review, 3 to audit; audit asked: 3)\n"
      + "Audit sample: 3 of 15 automated decisions; worst-case 95% margin ±56.6 points\n"
      + "Ready: 2 · incomplete: 4 · room: 1 · next Add takes 1\n"
      + "Human edits this session: 6 labels on 3 rows\n",
    excludes: ["grinder", "shipping", "beans"] },

  go_current: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", 4]]), hidden: () => ctx({ kind: "audit" }) },
  go_first_unverified: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", 6]]), hidden: () => ctx({ kind: "audit" }) },
  go_first_will_add: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", 4]]), hidden: () => ctx({ room: 0 }) },
  // Line 4 takes the one place; line 13 is ready behind it.
  go_first_past_room: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", 13]]), hidden: () => ctx({ room: 5 }) },
  // The current row is line 4, channel chat.
  show_current_slice: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.log, [["setSlice", "channel", "chat"]]);
      assert.deepEqual(c.shown().map((item) => item.line), [4, 6]);
    },
    hidden: () => ctx({ sliceField: "channel", sliceValue: "chat" }) },
  clear_slice: { ctx: () => ctx({ sliceField: "channel", sliceValue: "email" }),
    check: (c) => {
      assert.deepEqual(c.log, [["setSlice", "", ""]]);
      assert.equal(c.data.filters.slice_field, "");
      assert.equal(c.shown().length, 6);
    },
    hidden: () => ctx() },
}, { ctx: () => ctx() });

test("review-queue-more: no audit sample fires on an ordinary queue only when none was asked for", () => {
  const check = pack.features.find((feature) => feature.id === "no_audit_sample");
  assert.equal(check.check(ctx().items(), ctx()), null);
  const shortfall = ctx({ report: report({ items: reviewOnly(), audit_requested: 3 }, { audit: 0, queued: 3 }) });
  const short = pack.features.find((feature) => feature.id === "audit_short");
  assert.match(short.check(shortfall.items(), shortfall), /^You asked for 3 audit rows; the queue holds 0\./);
});

test("review-queue-more: facts and checks never throw on odd items", () => {
  const odd = [{}, { labels: "x", open: "y", candidates: [], revealed: true }, { kind: "review", held: null, missing: 3 }, { row: null, rules: "z" }];
  for (const feature of pack.features) {
    for (const item of odd) {
      if (feature.kind === "fact") feature.value(item, ctx());
      if (feature.kind === "diagnostic" && (feature.scope || "item") === "item") feature.check(item, ctx(), 0);
    }
  }
});
