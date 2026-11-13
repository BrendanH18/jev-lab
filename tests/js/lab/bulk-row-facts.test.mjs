import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/bulk-row-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleBulkRowsCtx } from "./fixtures/workbench-bulk.mjs";

const SEAL = '{"left": 0.1, "top": 0.1, "right": 0.9, "bottom": 0.9}';
// Twelve rows, one per line, positions 1-12. Input sizes are the UTF-8 bytes of the compact JSON input, worked out
// with Python's json.dumps(state, separators=(",", ":")) for each row.
const BOX = [
  "Hi there",                                                                                     // 1 text, 19 bytes, twin of 8
  '{"text": "Where is my order?", "channel": "email", "_expect": {"department": "shipping"}}',     // 2 47 bytes, twin of 5
  '{"text": "where is  my order?", "channel": "email"}',                                          // 3 48 bytes, near copy of 2
  '{"Channel": "chat", "text": "Grinder broke", "_expect": {"department": "technical", "is_urgent": true}}', // 4 41 bytes
  '{"text": "Where is my order?", "channel": "email"}',                                           // 5 exact copy of 2, unlabeled
  `{"note": "bag photo", "_image": "torn-bag", "_expect": {"department": "shipping", "is_urgent": false, "seal_damage": ${SEAL}}}`, // 6 20 bytes
  '{"note": "", "_image": "torn-bag", "_test": true, "_expect": {"department": "shipping"}}',     // 7 held out, 11 bytes, one empty field
  `{"text": "Hi there", "_expect": {"seal_damage": ${SEAL}}}`,                                     // 8 text row, Box label, no picture
  '{"order": {"id": "A-1"}, "tags": ["a"], "_x": 1, " name ": null}',                             // 9 56 bytes, depth 2
  '{"text": 42, "channel": "phone"}',                                                             // 10 29 bytes, text not a string
  '{"text": "Grinder broke", "channel": "chat"}',                                                 // 11 41 bytes, same text as 4
  '{"text": "Box arrived", "channel": "email", "_image": "crushed-box"}',                           // 12 40 bytes
].join("\n");
const QUESTIONS = {
  department: { type: "choice", instructions: "Which team?", criteria: { shipping: "Delivery", technical: "Machines" } },
  is_urgent: { type: "noul", instructions: "Urgent today?" },
  seal_damage: { type: "box", instructions: "Where is the damage in `photo`?" },
};
const box = (overrides = {}) => sampleBulkRowsCtx({ rowsText: BOX, questions: QUESTIONS, ...overrides });
const ctx = box();
const rows = ctx.items();
const at = (...positions) => positions.map((position) => rows[position - 1]);
const noQuestions = box({ questions: {} });
const arrayBox = sampleBulkRowsCtx({ rowsText: '[{"text": "a"}, [1, 2], 5]' });
const [arrayText, arrayRow, valueRow] = arrayBox.items();

checkPack(pack, {
  row_number: { ctx, items: rows, values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  input_bytes: { ctx, items: rows, values: [19, 47, 48, 41, 47, 20, 11, 19, 56, 29, 41, 40] },
  field_count: { ctx: arrayBox, items: [...at(1, 2, 9), arrayRow, valueRow], values: [1, 2, 4, null, null] },
  nesting_depth: { ctx: arrayBox, items: [...at(1, 9), arrayRow, valueRow], values: [1, 2, 1, 0] },
  empty_fields: { ctx: arrayBox, items: [...at(1, 2, 7, 9), arrayRow], values: [0, 0, 1, 1, null] },
  // Three selected questions: department, is_urgent, seal_damage. Row 7 is held out and labels department (id only).
  missing_selected: { ctx, items: rows, values: [3, 2, 3, 1, 3, 0, 2, 2, 3, 3, 3, 3] },
  same_input_rows: { ctx, items: rows, values: [2, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1] },
  same_picture_rows: { ctx, items: at(1, 6, 7, 12), values: [null, 2, 2, 1] },

  repeats_earlier: { ctx, items: at(1, 2, 5, 8, 11), values: [false, false, true, true, false] },
  same_text_elsewhere: { ctx, items: at(1, 2, 3, 4, 10, 11), values: [false, false, false, true, false, true] },
  nested_object: { ctx, items: at(2, 9, 10), values: [false, true, false] },
  list_field: { ctx, items: at(1, 9, 12), values: [false, true, false] },

  input_json: { ctx, items: at(1, 4, 7), values: ['{"text":"Hi there"}', '{"Channel":"chat","text":"Grinder broke"}', '{"note":""}'] },
  labeled_ids: { ctx, items: at(1, 4, 6, 7), values: ["", "department, is_urgent", "department, is_urgent, seal_damage", "department"] },

  field_set: { ctx: arrayBox, items: [...at(1, 2, 4, 6, 10), arrayRow], values: ["text", "channel, text", "Channel, text", "note", "channel, text", null] },
  picture_name: { ctx, items: at(1, 6, 7, 12), values: [null, "torn-bag", "torn-bag", "crushed-box"] },
  label_coverage: { ctx, items: at(1, 2, 6, 7), values: ["none", "partial", "complete", "partial"] },

  underscore_field: { hit: at(9), miss: at(1, 2), message: /^_x starts with an underscore/ },
  field_name_spaces: { hit: at(9), miss: at(2, 4), message: /^Field " name " has spaces at its ends; questions that name "name"/ },
  text_not_string: { hit: at(10), miss: at(1, 2, 6), message: /^The text field holds a number,/ },
  bare_value_row: { hit: [arrayRow, valueRow], miss: [arrayText, rows[1]], message: /^This row is a (JSON array|bare number), so it cannot carry labels/ },
  box_label_without_picture: { ctx, hit: at(8), miss: at(1, 6, 7), message: /^Has a label for Box question seal_damage but no picture, so that label can never be scored\.$/ },
  unlabeled_copy: { ctx, hit: at(5, 1), miss: at(2, 8, 7, 3), message: /^Same input as row (2, which has labels for department|8, which has labels for seal_damage) that this row lacks\.$/ },

  field_case_variants: { hitList: rows, missList: at(1, 2, 3, 5, 9, 10, 11),
    message: /^Fields "channel" \(rows 2, 3, 5, 10, 11, 12\) and "Channel" \(row 4\) differ only in letter case/ },
  odd_field_set: { hitList: rows, missList: at(1, 2, 3, 5, 8),
    message: /^Row (4 lacks channel and adds Channel|6 lacks channel, text and adds note|7 lacks channel, text and adds note|9 lacks channel, text and adds .+), unlike the 6 object rows with fields channel, text\.$/ },
  picture_on_both_sides: { hitList: rows, missList: at(1, 6, 8, 12),
    message: /^Picture torn-bag is on tuning row 6 and held-out row 7, so the test side is not fully unseen\.$/ },
  near_copies: { hitList: rows, missList: at(1, 2, 5, 8),
    message: /^Rows 2, 3, 5 match once letter case and spacing are ignored, but are not all exact copies \(3 rows\)\.$/ },
}, { ctx: () => box() });

// Without selected questions the coverage facts are unavailable rather than guessed.
test("bulk-row-facts: label coverage facts are unavailable without selected questions", () => {
  const [first] = noQuestions.items();
  assert.equal(pack.features.find((feature) => feature.id === "missing_selected").value(first, noQuestions), null);
  assert.equal(pack.features.find((feature) => feature.id === "label_coverage").value(first, noQuestions), null);
});

const feature = (id) => pack.features.find((entry) => entry.id === id);
const messages = (id, items, context = ctx) => {
  const check = feature(id);
  const out = check.scope === "list" ? check.check(items, context) : items.map((item) => check.check(item, context));
  return (Array.isArray(out) ? out : [out]).filter(Boolean);
};

// Worked by hand from BOX: 10 object rows (2-7, 9-12); 6 of them have exactly {channel, text}, a majority of 10.
test("bulk-row-facts: odd field sets name every other object row and what it lacks or adds", () => {
  assert.deepEqual(messages("odd_field_set", rows), [
    "Row 4 lacks channel and adds Channel, unlike the 6 object rows with fields channel, text.",
    "Row 6 lacks channel, text and adds note, unlike the 6 object rows with fields channel, text.",
    "Row 7 lacks channel, text and adds note, unlike the 6 object rows with fields channel, text.",
    "Row 9 lacks channel, text and adds  name , _x, order, tags, unlike the 6 object rows with fields channel, text.",
  ]);
  // A tie for the most common set, or no set above half of the object rows, says nothing.
  assert.deepEqual(messages("odd_field_set", at(2, 4, 6, 9)), []);
  assert.deepEqual(messages("odd_field_set", at(2, 5, 4, 6)), []);
});

test("bulk-row-facts: list checks give one message per group, with exact row numbers", () => {
  assert.deepEqual(messages("field_case_variants", rows), [
    'Fields "channel" (rows 2, 3, 5, 10, 11, 12) and "Channel" (row 4) differ only in letter case or spacing, so questions see them as different fields.']);
  assert.deepEqual(messages("near_copies", rows), ["Rows 2, 3, 5 match once letter case and spacing are ignored, but are not all exact copies (3 rows)."]);
  // Rows 1 and 8 are exact copies, so they are health's duplicates, not near copies.
  assert.deepEqual(messages("near_copies", at(1, 8)), []);
  assert.deepEqual(messages("picture_on_both_sides", at(6, 7, 12)), ["Picture torn-bag is on tuning row 6 and held-out row 7, so the test side is not fully unseen."]);
});

// A held-out copy never counts as the twin a tuning row should copy labels from, and its labels are never named.
test("bulk-row-facts: a copy is compared with tuning twins only", () => {
  const twins = sampleBulkRowsCtx({ questions: QUESTIONS, rowsText: [
    '{"text": "Seal open", "_image": "torn-bag", "_test": true, "_expect": {"department": "shipping"}}',
    '{"text": "Seal open", "_image": "torn-bag"}',
    '{"text": "Seal open", "_image": "torn-bag", "_expect": {"is_urgent": true}}',
  ].join("\n") });
  const [heldRow, bare, labeled] = twins.items();
  assert.deepEqual(messages("unlabeled_copy", [heldRow, bare, labeled], twins), ["Same input as row 3, which has labels for is_urgent that this row lacks."]);
  assert.equal(feature("same_input_rows").value(bare, twins), 3);
  assert.equal(feature("repeats_earlier").value(bare, twins), true);
  assert.equal(feature("repeats_earlier").value(heldRow, twins), false);
});

// Odd items and an empty box give null, false, "" or no finding, never an exception.
test("bulk-row-facts: odd items and an empty box never throw", () => {
  const empty = sampleBulkRowsCtx({ rowsText: "" });
  const odd = [null, {}, { input: undefined }, { input: null, labels: 5, labeled: "x" }, { input: { text: null }, image: 7 }];
  for (const item of odd) {
    for (const entry of pack.features) {
      if (entry.kind === "fact") {
        const value = entry.value(item, empty);
        assert.ok(value === null || value === false || value === "" || (typeof value === "number" && Number.isFinite(value)) || typeof value === "string", `${entry.id}`);
      } else if ((entry.scope || "item") === "item") entry.check(item, empty, 0);
    }
  }
  for (const entry of pack.features.filter((each) => each.scope === "list")) {
    assert.deepEqual(messages(entry.id, [], empty), []);
    entry.check(odd, empty);
  }
  assert.equal(feature("same_input_rows").value(rows[0], empty), null);
});
