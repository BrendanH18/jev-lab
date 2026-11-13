import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/review-queue-essentials.js";
import { checkPack } from "./harness.mjs";
import { sampleReviewItemsRaw, sampleReviewQueueCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleReviewQueueCtx(overrides);
const empty = () => ctx({ report: null });
const R = Object.fromEntries(ctx().items().map((item) => [item.line, item]));
const [R2, R4, R6, R9, R13, R15] = [R[2], R[4], R[6], R[9], R[13], R[15]];
// A ready review row whose gated labels are both still the gate's suggestions (no edits), and one held that broke a rule.
const extra = ctx({ items: [...sampleReviewItemsRaw(),
  { line: 20, kind: "review", provenance: { version: 1 }, row: { text: "Refund for the espresso subscription", channel: "email" }, held: [], rules: [], open: [],
    answers: { topic: "billing", urgent: false, tone: 1 }, labels: { topic: "billing", urgent: false, tone: null }, slice_values: { channel: "email" } },
  { line: 21, kind: "review", provenance: { version: 1 }, row: { text: "Cold brew kit missing its filter", channel: "chat" }, held: ["urgent"],
    rules: ["if urgent = yes then topic in shipping, billing"], open: ["urgent", "topic"], answers: { topic: "shipping", urgent: true },
    labels: { topic: null, urgent: null, tone: null }, slice_values: { channel: "chat" } }] });
const SUGG = extra.items().find((item) => item.line === 20), BOTH = extra.items().find((item) => item.line === 21);
const withLabels = (item, patch) => ({ ...JSON.parse(JSON.stringify(item)), labels: { ...item.labels, ...patch } });

checkPack(pack, {
  gated_missing: { items: [R2, R4, R6, R9, R13, R15], values: [1, 0, 2, 2, 0, 1] },
  human_edits: { items: [R2, R4, R13, R15, R6], values: [0, 2, 3, 1, 0] },
  held_questions: { items: [R2, R4, R6, R9], values: [1, 0, 1, 0] },
  broken_rules: { items: [R4, R2, BOTH], values: [1, 0, 1] },
  // Line 4: topic billing vs the gate's wholesale. Line 13 (audit, labeled): tone 2 vs 1. Line 2 agrees on its one label.
  // Lines 9 and 15 are blind audit rows: unknown.
  disagreements: { items: [R4, R13, R2, R6, R9, R15], values: [1, 1, 0, 0, null, null] },
  verified: { items: [R2, R6], values: [true, false] },
  suggested_only: { items: [SUGG, R4, R13, R2], values: [true, false, false, false], ctx: extra },
  has_picture: { items: [R6, R2], values: [true, false] },
  will_add: { items: [R4, R13, R2], values: [true, false, false] },
  input_text: { items: [R2, R4], values: ["My grinder arrived with a cracked hopper", "Charged twice for the wholesale order"] },
  queue_reason: { items: [R2, R4, R9, BOTH, SUGG, { held: ["urgent"] }], values: ["held", "broke a rule", "audit sample", "held and broke a rule", "other", null] },

  confirm_suggestions: { hit: SUGG, miss: [R2, R4, R13], ctx: extra, message: /^Ready only from the gate's suggested labels \(topic, urgent\)/ },
  // Lines 9 and 15 are not ready; 13 is. A list without unfinished audit rows (or without audit rows) stays quiet.
  incomplete_audit: { hitList: [R9, R13, R15], missList: [R13, R2, null], message: /^2 of 3 shown audit rows still need labels\. Label the whole random sample before reading the audit\.$/ },

  fill_review_blank: { ctx: ctx(), input: [R2, R4, R9], params: { question: "urgent", label: "yes" },
    output: [withLabels(R2, { urgent: true }), withLabels(R4, {}), withLabels(R9, {})],
    unchanged: [R4, R13],
    rejects: [{ params: { question: "mood", label: "yes" }, message: /not a question of this queue/ },
      { params: { question: "topic", label: "coffee" }, message: /not an option of topic \(billing, shipping, wholesale, beans\)/ }] },
  clear_question: { ctx: ctx(), input: [R4, R13, R6], params: { question: "topic" },
    output: [withLabels(R4, { topic: null }), withLabels(R13, { topic: null }), withLabels(R6, {})],
    unchanged: [R6, R9],
    rejects: [{ params: { question: "" }, message: /Question id is required/ }, { params: { question: "Urgent" }, message: /not a question of this queue/ }] },

  // Audit rows 9, 13, 15: only 13 is labeled.
  audit_progress: [{ ctx: ctx(), expect: 1 / 3, tolerance: 1e-12, empty: empty() },
    { ctx: ctx({ items: sampleReviewItemsRaw().filter((item) => item.kind === "review") }), expect: null }],
  // Line 4: 2, line 13: 3, line 15: 1.
  human_edit_count: { ctx: ctx(), expect: 6, empty: empty() },
  review_disagreements: { ctx: ctx(), expect: 1, empty: empty() },

  progress_csv: { ctx: ctx(), filename: "jev-review-progress.csv",
    text: '"line","kind","provenance","status","will_add","missing","human_edits"\r\n'
      + '"2","review","verified","incomplete","no","urgent","0"\r\n'
      + '"4","review","verified","ready","yes","","2"\r\n'
      + '"6","review","none","incomplete","no","topic urgent","0"\r\n'
      + '"9","audit","verified","incomplete","no","topic urgent","0"\r\n'
      + '"13","audit","verified","ready","no","","3"\r\n'
      + '"15","audit","verified","incomplete","no","urgent","1"\r\n',
    excludes: ["shipping", "beans", "wholesale", "grinder", "roastery@"] },
  lines_text: { ctx: ctx({ kind: "audit" }), filename: "jev-review-lines.txt", text: "9, 13, 15\n" },

  go_first_disagreement: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", 4]]), hidden: () => ctx({ kind: "audit" }) },
  show_incomplete_audit: { ctx: () => ctx(),
    check: (c) => {
      assert.deepEqual(c.log, [["setFilter", "kindFilter", "audit"], ["setFilter", "statusFilter", "incomplete"]]);
      assert.deepEqual(c.shown().map((item) => item.line), [9, 15]);
    },
    hidden: () => ctx({ busy: true }) },
  reset_filters: { ctx: () => ctx({ kind: "audit", status: "ready" }),
    check: (c) => {
      assert.deepEqual(c.log, [["resetFilters"]]);
      assert.deepEqual(c.data.filters, { kind: "all", status: "all", slice_field: "", slice_value: "" });
    },
    hidden: () => empty() },
}, { ctx: () => ctx() });

test("review-queue-essentials: suggestions-only needs a gate and every gated label still suggested", () => {
  const fact = pack.features.find((feature) => feature.id === "suggested_only").value;
  const check = pack.features.find((feature) => feature.id === "confirm_suggestions").check;
  assert.equal(fact(SUGG, extra), true);
  // With no gate there is nothing a suggestion could have made ready.
  const ungated = { data: { gates: {} } };
  assert.equal(fact(SUGG, ungated), false);
  assert.equal(check(SUGG, ungated), null);
  for (const odd of [null, {}, { kind: "review", ready: true }]) assert.equal(fact(odd, extra), false);
  assert.equal(check(SUGG, extra), "Ready only from the gate's suggested labels (topic, urgent). Confirm them before adding.");
});
