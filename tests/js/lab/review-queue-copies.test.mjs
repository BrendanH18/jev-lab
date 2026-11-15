import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/review-queue-copies.js";
import { checkPack } from "./harness.mjs";
import { sampleReviewEdits, sampleReviewItemsRaw, sampleReviewQueueCtx } from "./fixtures/workbench-checks.mjs";

// The sample queue plus three copies:
//   line 20  review, the same input as audit line 9 (still blind): topic beans is the gate's untouched suggestion,
//            urgent no is a human edit. So line 9 has a copy that shows the gate's answers.
//   line 22  audit, the same input as review line 4: topic wholesale and urgent yes by hand -> ready, revealed. Line 4
//            has topic billing by hand, so the copies differ on topic (urgent agrees).
//   line 24  audit, the same input as audit line 15, nothing labeled: both copies blind. Line 15 labels topic by hand.
const extra = [
  { line: 20, kind: "review", provenance: { version: 1 }, row: { text: "Love the Sumatra roast", channel: "email" }, held: ["urgent"], rules: [], open: ["urgent"],
    answers: { topic: "beans", urgent: false, tone: 2 }, labels: { topic: "beans", urgent: false, tone: null }, slice_values: { channel: "email" } },
  { line: 22, kind: "audit", provenance: { version: 1 }, row: { text: "Charged twice for the wholesale order", channel: "chat" }, held: [], rules: [], open: ["topic", "urgent", "tone"],
    answers: { topic: "wholesale", urgent: true, tone: 0 }, labels: { topic: "wholesale", urgent: true, tone: null }, slice_values: { channel: "chat" } },
  { line: 24, kind: "audit", provenance: { version: 1 }, row: { text: "Parcel left at the wrong door", channel: "phone" }, held: [], rules: [], open: ["topic", "urgent", "tone"],
    answers: { topic: "shipping", urgent: true, tone: 0 }, labels: { topic: null, urgent: null, tone: null }, slice_values: { channel: "phone" } },
];
const copies = (overrides = {}) => sampleReviewQueueCtx({ items: [...sampleReviewItemsRaw(), ...JSON.parse(JSON.stringify(extra))],
  edits: { ...sampleReviewEdits(), 20: { urgent: false }, 22: { topic: "wholesale", urgent: true } }, ...overrides });
const C = copies();
const R = Object.fromEntries(C.items().map((item) => [item.line, item]));
const base = () => sampleReviewQueueCtx();
const empty = () => sampleReviewQueueCtx({ report: null });
const lastGoTo = (ctx) => ctx.log.filter((entry) => entry[0] === "goTo").at(-1);

checkPack(pack, {
  input_copies: { items: [R[2], R[4], R[9], R[24]], values: [1, 2, 2, 2], ctx: C },
  copy_lines: { items: [R[4], R[9], R[2], R[24]], values: ["22", "20", "", "15"], ctx: C },
  copy_kinds: { items: [R[2], R[4], R[15], R[9]], values: ["no copy", "review and audit", "audit", "review and audit"], ctx: C },
  // Line 4 billing vs line 22 wholesale (both by hand). Line 20's topic is the gate's suggestion and line 9 has no labels.
  copy_conflict: { items: [R[4], R[22], R[9], R[20], R[15]], values: [true, true, false, false, false], ctx: C },
  // Line 9 is blind and its copy, review line 20, is revealed. Line 24's copy (15) is blind too. Line 22 is not blind.
  blind_exposed: { items: [R[9], R[24], R[15], R[22]], values: [true, false, false, false], ctx: C },

  copy_conflict_check: { ctx: C, hit: R[4], miss: [R[9], R[20], R[2], R[15]],
    message: /^Line 4 has topic = billing, but line 22 has the same input with topic = wholesale\.$/ },
  blind_copy_exposed: { ctx: C, hit: R[9], miss: [R[24], R[15], R[4], R[2]],
    message: /^Line 9 is a blind audit row, but line 20 shows the gate's answers for the identical input\. Label line 9 first, without looking there\.$/ },
  // Line 15 labels topic, its copy 24 has none; line 20 labels urgent by hand, its copy 9 has none.
  copy_label_gap: { ctx: C, hit: [R[15], R[20]], miss: [R[4], R[22], R[9], R[2]],
    message: /^Line (24|9) has the same input with no label for (topic|urgent) yet\.$/ },

  copy_groups: [{ ctx: C, empty: empty(), expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "6 rows in them"); } },
    { ctx: base(), expect: 0 }],
  conflicting_groups: [{ ctx: C, empty: empty(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "of 3 repeated inputs"); } },
    { ctx: base(), expect: 0 }],
  // Blind rows: 9, 15 and 24 (15 still misses urgent); only 9 has a revealed copy. The sample alone: 9 and 15, none exposed.
  exposed_rows: [{ ctx: C, empty: empty(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "of 3 blind audit rows"); } },
    { ctx: base(), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "of 2 blind audit rows"); } }],

  copy_groups_csv: { ctx: C, filename: "jev-review-copies.csv",
    text: '"group","rows","lines","kinds","blind_audit_rows","differing_questions"\r\n'
      + '"1","2","4 22","review and audit","0","topic"\r\n'
      + '"2","2","9 20","review and audit","1",""\r\n'
      + '"3","2","15 24","audit","2",""\r\n',
    excludes: ["Charged", "billing", "wholesale", "beans", "Sumatra"] },

  go_first_conflict: { ctx: () => copies(), check: (ctx) => assert.deepEqual(lastGoTo(ctx), ["goTo", 4]), hidden: base },
  // The current row is line 4; its only copy is line 22. From 22 the search starts over at the top and finds 4.
  go_next_copy: { ctx: () => copies(),
    check: (ctx) => {
      assert.deepEqual(lastGoTo(ctx), ["goTo", 22]);
      pack.features.find((feature) => feature.id === "go_next_copy").run(ctx);
      assert.deepEqual(lastGoTo(ctx), ["goTo", 4]);
    },
    hidden: () => copies({ nextLine: 2 }) },
  go_first_exposed: { ctx: () => copies(), check: (ctx) => assert.deepEqual(lastGoTo(ctx), ["goTo", 9]), hidden: base },
}, { ctx: () => copies() });
