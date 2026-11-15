// Tests for static/js/lab/packs/workbench/drift-queue-checks.js on the drift queue fixture
// (tests/js/lab/fixtures/workbench-checks.mjs) and a hand-made queue. Worked out by hand from the fixture header:
//   new row 3   40 characters, topic + urgent            ready, in the next Add (room 1)
//   new row 5   40 characters, topic + tone              urgent missing
//   new row 8   19 characters, nothing labeled           picture receipt-scan (loaded)
//   new row 11  23 characters ("Where is order HC-3110?"), all three labeled, ready but no room; parcel-photo not loaded
//   new row 12  0 characters, urgent no                  topic missing
// Comparison counts: 2 already in the dataset, 1 repeated, 0 unsupported. Tone is the only optional question.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/drift-queue-checks.js";
import { checkPack } from "./harness.mjs";
import { sampleDriftItemsRaw, sampleDriftQueueCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleDriftQueueCtx(overrides);
const empty = () => ctx({ labeling: null });
const blank = { topic: null, urgent: null, tone: null };
const C = ctx();
const D = Object.fromEntries(C.items().map((item) => [item.line, item]));
const [D3, D5, D8, D11, D12] = [D[3], D[5], D[8], D[11], D[12]];

const twinsCtx = ctx({ items: [
  { index: 0, line: 1, row: { text: "Order HC-2041 arrived late", channel: "email" }, labels: { ...blank } },
  { index: 1, line: 2, row: { text: "Order HC-2041 arrived late", channel: "chat" }, labels: { ...blank } },
  { index: 2, line: 3, row: { text: "Order HC-2041 arrived late", channel: "phone" }, labels: { ...blank } },
  { index: 3, line: 4, row: { order_id: "HC-4410", channel: "email" }, labels: { ...blank } },
  { index: 4, line: 5, row: { text: "  Café order\nSecond line\n", channel: "email", order: { id: "HC-5001", bags: 12 } }, labels: { ...blank } },
  { index: 5, line: 6, row: { text: "Reorder at https://harbor.example/reorder or write orders@harbor.example", channel: "web" }, labels: { ...blank } },
] });
const [T1, , , NOTEXT, MULTI, LINKS] = twinsCtx.items();
const fiveAndEight = () => ctx({ items: sampleDriftItemsRaw().filter((raw) => raw.line === 5 || raw.line === 8) });

checkPack(pack, {
  ready_no_room: { hit: D11, miss: [D3, D5], message: /no room left for it in the next Add/ },
  not_started: { hit: D8, miss: [D3, D12], message: /^No label yet\.$/ },
  picture_not_loaded: { hit: D11, miss: [D8, D3], message: /“parcel-photo”/ },
  shares_text: { ctx: twinsCtx, hit: T1, miss: [NOTEXT, MULTI, D12], message: /^new row 2, new row 3 have the same text with other fields/ },
  contact_details: { hit: LINKS, miss: [D3, NOTEXT], message: /holds 2 web or email addresses/ },
  edge_spaces: { hit: MULTI, miss: [D3, D12, NOTEXT] },
  control_characters: { hit: { row: { text: "Order\u0007 HC-1" } }, miss: [D3, MULTI] },
  long_text: { hit: { row: { text: "a".repeat(2001) } }, miss: [{ row: { text: "a".repeat(2000) } }, D3], message: /2,001 characters long/ },
  no_text_field: { hit: NOTEXT, miss: [D3, { line: 1 }], message: /^The input has no text field; label it from order_id, channel\.$/ },
  nested_fields: { hit: MULTI, miss: [D3, NOTEXT], message: /^order holds an object or a list/ },

  no_room: { ctx: ctx({ room: 0 }), hitList: ctx({ room: 0 }).items(), missCtx: C, missList: C.items(), message: /Add takes none/ },
  nothing_ready: { hitList: [D5, D8, D12], missList: [D3, D5], message: /^None of the 3 rows/ },
  restored_draft: { ctx: ctx({ recovered: true }), hitList: ctx({ recovered: true }).items(), missCtx: C, missList: C.items() },
  mixed_fields: { hitList: [D3, NOTEXT, D5], missList: [D3, D5, D8], message: /2 different sets of fields: channel, text \(2\); channel, order_id \(1\)\.$/ },
  // Rows 8 and 5 have topic on row 5 only and urgent on neither.
  required_never_labeled: { ctx: C, hitList: [D8, D5], missList: [D3, D8], message: /^urgent has no label on any of these rows yet/ },
  rows_added: { ctx: ctx({ saved: { added: 2, already: 1 } }), hitList: [], missCtx: C, missList: C.items(), message: /^2 rows from this queue are in the dataset now/ },

  queued_rows: { ctx: C, expect: 5, empty: empty() },
  // Missing: 0 + 1 + 2 + 0 + 1; tone blank on rows 3, 8 and 12.
  required_labels_missing: { ctx: C, expect: 4, empty: empty() },
  optional_blank: { ctx: C, expect: 3, empty: empty() },
  rows_not_started: { ctx: C, expect: 1, empty: empty() },
  rows_with_pictures: { ctx: C, empty: empty(), expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "1 not loaded"); } },
  // 0, 19, 23, 40, 40.
  median_text_length: { ctx: C, expect: 23, empty: empty() },
  distinct_texts: { ctx: C, empty: empty(), expect: (result) => { assert.equal(result.value, 5); assert.equal(result.detail, "among 5 rows with text"); } },
  // topic on rows 3, 5, 11 and urgent on rows 3, 11, 12: a tie keeps the first; rows 5 and 8 alone leave urgent at 0.
  least_labeled_required: [
    { ctx: C, empty: empty(), expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "topic (3 of 5 rows)"); } },
    { ctx: fiveAndEight(), expect: (result) => { assert.equal(result.value, 0); assert.equal(result.detail, "urgent (0 of 2 rows)"); } },
  ],
  skipped_in_dataset: [{ ctx: C, expect: 2, empty: empty() }, { ctx: ctx({ recovered: true }), expect: null }],
  skipped_repeated: { ctx: C, expect: 1, empty: empty() },
  skipped_unsupported: { ctx: C, expect: 0, empty: empty() },
  rows_added_count: { ctx: ctx({ saved: { added: 2, already: 1 } }), empty: C,
    expect: (result) => { assert.equal(result.value, 2); assert.equal(result.detail, "1 already in the dataset"); } },
}, { ctx: () => ctx() });
