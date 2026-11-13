import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/datasets-history-essentials.js";
import { checkPack } from "./harness.mjs";
import { sampleDatasetsHistoryCtx, sampleRevisionsRaw } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsHistoryCtx(overrides);
const C = ctx();
const [R1, R2, R3, R4, R5] = C.items();
// Twenty kept revisions, kept Oct 28 back to Oct 9 (one a day at 10:15): the most a history holds.
const full = () => ctx({ revisions: Array.from({ length: 20 }, (_, index) => ({ ...sampleRevisionsRaw()[1],
  revision: `202610${String(28 - index).padStart(2, "0")}T101500000000Z-0f9e8d7c6b${String(index).padStart(2, "0")}`,
  at: `2026-10-${String(28 - index).padStart(2, "0")}T10:15:00.000000Z` })) });
const FULL = full();
// A revision kept after the clock (2026-11-12T12:00Z) and odd hand-made items.
const [LATER] = ctx({ revisions: [{ ...sampleRevisionsRaw()[1], at: "2026-11-13T08:00:00.000000Z" }] }).items();
const ODD = { revision: "odd", readable: true, rows: "many", labeled: null, questions: "intent" };

checkPack(pack, {
  // Clock 2026-11-12T12:00Z: Oct 30 16:20 is 12 d 19 h 40 min back, Oct 28 10:15 15 d 1 h 45 min, Oct 25 08:00 18 d 4 h,
  // Oct 20 09:00 23 d 3 h, Oct 1 09:00 42 d 3 h (31 days to Nov 1, then 11).
  age_days: { items: [R1, R2, R3, R4, R5, LATER], values: [12, 15, 18, 23, 42, null], ctx: C },
  // 40 - 38; 38 - 38 (the unreadable #3 is skipped); unreadable; 38 - 25; the oldest has nothing older.
  rows_change: { items: [R1, R2, R3, R4, R5, ODD], values: [2, 0, null, 13, null, null], ctx: C },
  // 30 - 24; 24 - 26; unreadable; 26 - 0; oldest.
  labeled_change: { items: [R1, R2, R3, R4, R5], values: [6, -2, null, 26, null], ctx: C },
  labeled_share: { items: [R1, R2, R3, R4, R5, ODD], values: [0.75, 24 / 38, null, 26 / 38, 0, null], tolerance: 1e-12 },
  question_count: { items: [R1, R3, R5, ODD], values: [2, null, 0, null] },
  has_check: { items: [R1, R2, R3], values: [true, false, false] },
  has_split: { items: [R1, R2, R3], values: [true, false, false] },
  unreadable: { items: [R3, R1], values: [true, false] },
  // #5 saved no questions; #2 has the same intent, urgent as the newest; the order counts.
  questions_differ: { items: [R5, R2, R1, R3, { ...R2, revision: "x", questions: ["urgent", "intent"] }], values: [true, false, false, false, true], ctx: C },
  change_kind: { items: [R1, R2, R3, R4, R5], values: ["rows added", "labels removed", "unreadable", "rows added", "oldest kept"], ctx: C },
  saved_name: { items: [R1, R5, R3], values: ["Harbor support inbox", "Support", ""] },

  label_loss: { hit: R2, miss: [R1, R3, R4, R5], message: /^2 labeled rows fewer than the older revision/, ctx: C },
  // The current #1 holds 8 held-out rows; #2, #4 and #5 hold none.
  split_dropped: { hit: [R2, R4, R5], miss: [R1, R3], message: /^Restoring it would leave no held-out rows \(now 8\)/, ctx: C },
  // Every kept revision counts even when filters show only three; the oldest is #20 from Oct 9.
  history_full: { hitList: FULL.items().slice(0, 3), missList: C.items(), ctx: FULL, missCtx: C,
    message: /^20 revisions kept, the most this history holds: the next save over this dataset drops the oldest \(#20, kept 2026-10-09 10:15 UTC\)\.$/ },

  // Oct 30 16:20 minus Oct 1 09:00: 29 days 7 h 20 min.
  span_days: { ctx: C, expect: (result) => { assert.ok(Math.abs(result.value - (29 + (7 * 60 + 20) / 1440)) < 1e-12); assert.equal(result.detail, "5 revisions"); },
    empty: ctx({ revisions: [] }) },
  most_labeled: [{ ctx: C, expect: (result) => { assert.equal(result.value, 30); assert.equal(result.detail, "revision #1 (current)"); }, empty: ctx({ revisions: [] }) },
    { ctx: ctx({ revisions: sampleRevisionsRaw().slice(1) }), expect: (result) => { assert.equal(result.value, 26); assert.equal(result.detail, "revision #3"); } }],

  timeline_markdown: { ctx: C, filename: "harbor-support-inbox-revisions.md",
    text: "| # | Kept (UTC) | Rows | Labeled | Held out | Questions | Check | Same as current |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n"
      + "| 1 | 2026-10-30 16:20 | 40 | 30 | 8 | 2 | yes | yes |\n| 2 | 2026-10-28 10:15 | 38 | 24 | 0 | 2 | no | no |\n"
      + "| 3 | 2026-10-25 08:00 | unreadable | — | — | — | — | no |\n| 4 | 2026-10-20 09:00 | 38 | 26 | 0 | 2 | no | no |\n"
      + "| 5 | 2026-10-01 09:00 | 25 | 0 | 0 | 0 | no | no |\n" },
  // Hiding revisions identical to the current file leaves #2 to #5; the unreadable #3 has blank counts and check.
  counts_csv: { ctx: ctx({ changedOnly: true }), filename: "harbor-support-inbox-revision-counts.csv",
    text: '"revision","kept_at","rows","labeled","held_out","questions","check","current"\r\n'
      + '"20261028T101500000000Z-0f9e8d7c6b5a","2026-10-28T10:15:00.000000Z","38","24","0","2","no","no"\r\n'
      + '"20261025T080000000000Z-badbadbadbad","2026-10-25T08:00:00.000000Z","","","","","","no"\r\n'
      + '"20261020T090000000000Z-1234567890ab","2026-10-20T09:00:00.000000Z","38","26","0","2","no","no"\r\n'
      + '"20261001T090000000000Z-cafe00c0ffee","2026-10-01T09:00:00.000000Z","25","0","0","0","no","no"\r\n',
    excludes: ["a1b2c3d4e5f6", "Harbor support inbox", "Support"] },

  preview_newest_other: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["preview", "20261028T101500000000Z-0f9e8d7c6b5a"]]), hidden: () => ctx({ busy: true }) },
  // #4 keeps 26 labeled rows, more than #2 (24) and #5 (0); the current #1 (30) is left out.
  preview_most_labeled: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["preview", "20261020T090000000000Z-1234567890ab"]]),
    hidden: () => ctx({ revisions: sampleRevisionsRaw().slice(0, 1) }) },
  cancel_preview: { ctx: () => ctx({ preview: true }), check: (c) => { assert.deepEqual(c.log, [["cancelPreview"]]); assert.equal(c.data.preview, null); }, hidden: () => ctx() },
}, { ctx: () => ctx({ preview: true }) });
