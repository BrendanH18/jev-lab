// Tests for the Bulk rows inspector (static/js/lab/packs/workbench/bulk-rows-inspector.js). Expected values are counted
// by hand from the eight-row box below (characters and words noted beside each line).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/bulk-rows-inspector.js";
import { checkPack } from "./harness.mjs";
import { sampleBulkRowsCtx } from "./fixtures/workbench-bulk.mjs";

// Eight short rows whose facts are easy to count by hand (positions 1-8, one per line).
const BOX = [
  "Hi there",                                                                   // 1 text, 8 characters, 2 words, no labels
  '{"text": "  Refund   my order  ", "_expect": {"q": "yes", "zz": 1}}',          // 2 text, 21 characters, 3 words, 2 labels
  '{"note": "bag", "_image": "torn-bag"}',                                      // 3 object with a picture, no text
  '{"text": "held one", "_test": true, "_expect": {"q": true}}',                // 4 held out, label hidden
  '{"text": "Write to ana@harbor.example", "_expect": {"q": false}}',           // 5 27 characters, 3 words, an email
  "[1, 2] as text",                                                             // 6 a line that looks like an array
  '{"broken',                                                                   // 7 malformed JSON, read as text
  '{"text": "x", "_expect": "bad"}',                                            // 8 a row the server refuses
].join("\n");
const QUESTIONS = { q: { type: "noul", instructions: "Is it urgent?" } };
const box = (overrides = {}) => sampleBulkRowsCtx({ rowsText: BOX, questions: QUESTIONS, ...overrides });
const rows = box().items();
const long = sampleBulkRowsCtx({ rowsText: Array.from({ length: 201 }, (_, index) => `ticket ${index + 1}`).join("\n") });
const row = (input, extra = {}) => ({ ref: null, input, image: null, labels: {}, test: false, ...extra });
const held = (input, extra = {}) => ({ ref: "held-1", input, image: null, labels: null, test: true, ...extra });

checkPack(pack, {
  chars: { items: rows, values: [8, 21, null, 8, 27, 14, 8, 1] },
  words: { items: rows, values: [2, 3, null, 2, 3, 4, 1, 1] },
  label_count: { items: rows, values: [0, 2, 0, 1, 1, 0, 0, 0] },
  has_picture: { items: rows, values: [false, false, true, false, false, false, false, false] },
  held_out: { items: rows, values: [false, false, false, true, false, false, false, false] },
  has_problem: { items: rows, values: [false, false, false, false, false, false, false, true] },
  past_cap: { items: [long.items()[0], long.items()[199], long.items()[200]], values: [false, false, true] },
  kind: { items: rows, values: ["text", "text", "object", "text", "text", "text", "text", "text"] },
  text: { items: rows, values: ["Hi there", "  Refund   my order  ", "", "held one", "Write to ana@harbor.example", "[1, 2] as text", '{"broken', "x"] },

  malformed_json: { hit: rows[6], miss: [rows[0], rows[5]], message: /not a JSON object/ },
  server_problem: { hit: rows[7], miss: [rows[0], rows[6]], message: /_expect must be an object/ },
  unknown_label_ids: { ctx: box(), hit: rows[1], miss: [rows[0], rows[4], rows[3]], message: /Labels for zz,/ },
  bracket_text: { hit: rows[5], miss: [rows[0], rows[6]], message: /Starts with \[/ },
  email_in_text: { hit: rows[4], miss: [rows[0], rows[1]], message: /Holds 1 email address\./ },
  // The check reads the whole box: row 201 counts even when a filter shows only the first row.
  rows_past_cap: { ctx: long, hitList: long.items().slice(0, 1), missCtx: box(), missList: rows, message: /^1 row past the 200-row cap/ },

  trim_text: { input: [row("  a b  "), held(" kept "), row({ text: " t ", channel: "email" })],
    output: [row("a b"), held(" kept "), row({ text: "t", channel: "email" })], unchanged: [row("tidy"), row({ note: " no text field " })] },
  collapse_spaces: { input: [row("a  \n b"), held("x  y"), row("one two")], output: [row("a b"), held("x  y"), row("one two")] },
  drop_unknown_labels: { ctx: box(), input: [row("a", { labels: { q: true, zz: 1 } }), row("b", { labels: { q: false } }), held("c")],
    output: [row("a", { labels: { q: true } }), row("b", { labels: { q: false } }), held("c")] },
  normalize_noul_labels: { ctx: box({ questions: { ...QUESTIONS, team: { type: "choice", instructions: "Team?", criteria: { yes: "Yes team", no: "No team" } } } }),
    input: [row("a", { labels: { q: " Yes ", team: "yes" } }), row("b", { labels: { q: "maybe" } }), row("c", { labels: { q: "0" } }),
      row("d", { labels: { q: 1 } }), row("e", { labels: { q: 2 } }), held("f")],
    output: [row("a", { labels: { q: true, team: "yes" } }), row("b", { labels: { q: "maybe" } }), row("c", { labels: { q: false } }),
      row("d", { labels: { q: true } }), row("e", { labels: { q: 2 } }), held("f")],
    unchanged: [row("g", { labels: { q: "constructor" } }), row("h", { labels: { q: true } })] },
  drop_shown: { input: [row("a"), held("h"), row("b"), row("c")], shown: [0, 1, 2], output: [held("h"), row("c")] },

  labeled_share: { ctx: box(), expect: 2 / 7, tolerance: 1e-12, empty: sampleBulkRowsCtx({ rowsText: "" }) },
  held_out_share: [{ ctx: box(), expect: 1 / 8, empty: sampleBulkRowsCtx({ rowsText: "" }) },
    { ctx: box({ matches: (item) => !item.test }), expect: 0 }],
  picture_rows: [{ ctx: box(), expect: 1, empty: sampleBulkRowsCtx({ rowsText: "" }) }, { ctx: box({ matches: (item) => !item.image }), expect: 0 }],
  mean_words: { ctx: box(), expect: 16 / 7, tolerance: 1e-12, empty: sampleBulkRowsCtx({ rowsText: "" }) },

  shown_inputs_jsonl: { ctx: box(), filename: "bulk-inputs.jsonl",
    text: ['{"text":"Hi there"}', '{"text":"  Refund   my order  "}', '{"note":"bag","_image":"torn-bag"}', '{"text":"Write to ana@harbor.example"}',
      '{"text":"[1, 2] as text"}', '{"text":"{\\"broken"}', '{"text":"x"}', ""].join("\n"),
    excludes: ["held one", "_expect", "zz"] },
  labels_csv: { ctx: box(), filename: "bulk-labels.csv",
    text: '"row","q","zz"\r\n"1","",""\r\n"2","yes","1"\r\n"3","",""\r\n"5","false",""\r\n"6","",""\r\n"7","",""\r\n"8","",""\r\n',
    excludes: ['"4"', "true", "Hi there"] },
  positions: { ctx: box({ matches: (item) => item.position % 2 === 0 }), text: "2, 4, 6, 8", filename: "bulk-rows.txt" },

  check_health: { ctx: () => sampleBulkRowsCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["checkHealth"]]) },
  check_inputs: { ctx: () => sampleBulkRowsCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["checkPreflight"]]) },
  open_csv: { ctx: () => sampleBulkRowsCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["openCsvImport"]]) },
  first_problem: { ctx: () => sampleBulkRowsCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["focusLine", 8]]),
    hidden: () => sampleBulkRowsCtx({ rowsText: "fine\nalso fine" }) },
}, { ctx: () => sampleBulkRowsCtx() });

test("bulk-rows-inspector: label CSV escapes text a spreadsheet would run as a formula", () => {
  const ctx = sampleBulkRowsCtx({ rowsText: '{"text": "a", "_expect": {"q": "=1+1"}}', questions: QUESTIONS });
  const exporter = pack.features.find((feature) => feature.id === "labels_csv");
  assert.equal(exporter.build(ctx), '"row","q"\r\n"1","\'=1+1"\r\n');
});

test("bulk-rows-inspector: odd items give unavailable facts, not exceptions", () => {
  for (const fact of pack.features.filter((entry) => entry.kind === "fact")) {
    for (const odd of [{}, { text: 3, labeled: "q", image: 5 }]) {
      const value = fact.value(odd);
      assert.ok(value === null || value === false || value === "", `${fact.id} gave ${JSON.stringify(value)}`);
    }
  }
});
