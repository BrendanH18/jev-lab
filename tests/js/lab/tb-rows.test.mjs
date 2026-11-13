// Tests for the tb-rows Toolbox pack. Every expected row, table and note below was written out by hand from the
// Workbench's row format (docs/workbench.md: one row per nonempty line, a JSON object line is an object row, any
// other line is text; labels under "_expect", held-out rows "_test": true, pictures "_image"). Expected JSON lines
// are hand-written objects serialized with JSON.stringify in the key order the tool is specified to produce.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-rows.js";
import { checkPack } from "./harness.mjs";
import { sampleToolboxCtx } from "./fixtures/workbench-shell.mjs";

const line = (value) => (typeof value === "string" ? value : JSON.stringify(value));
const L = (...values) => values.map(line).join("\n");
const J = (...values) => values.map((value) => `${line(value)}\n`).join("");
const textNote = (text, note) => (result) => {
  assert.equal(result.text, text);
  if (note !== undefined) assert.equal(result.note, note);
};
const rowsTable = (rows, table) => (result) => {
  assert.deepEqual(result.rows, rows);
  assert.deepEqual(result.table, table);
};

// Rows shared by the duplicate cases: lines 1, 2 and 7 share an input (field order ignored) but 7 is held out, lines
// 3 and 6 are the same text, and lines 4 and 5 differ only by picture, which counts.
const DUPES = L(
  { text: "A", channel: "email", _expect: { d: "billing" } },
  { channel: "email", text: "A", _expect: { d: "billing" } },
  "Plain",
  { text: "B", _image: "torn-bag" },
  { text: "B", _image: "intact-bag" },
  "Plain",
  { text: "A", channel: "email", _test: true, _expect: { d: "billing" } },
);

checkPack(pack, {
  table_to_rows: {
    values: { table: [
      "text,channel,label:department,expect:urgent,_expect.level,_test",
      "Where is my parcel?,email,shipping,true,2,",
      '"Refund order A-1041, please",chat,billing,False,0,yes',
      ",chat,other,,,",
      ",,billing,,,",
      "=SUM(A1),web,,,,no",
    ].join("\n") },
    expect: textNote(J(
      { text: "Where is my parcel?", channel: "email", _expect: { department: "shipping", urgent: true, level: "2" } },
      { text: "Refund order A-1041, please", channel: "chat", _expect: { department: "billing", urgent: false, level: "0" }, _test: true },
      { channel: "chat", _expect: { department: "other" } },
      { text: "=SUM(A1)", channel: "web" },
    ), "Read as comma-separated. 4 rows: 3 labeled, 1 held out. 1 row with nothing for the model to read left out."),
    more: [
      { values: { table: "text;label:department\nHi there;billing\n", delimiter: "semicolon" }, expect: { text: J({ text: "Hi there", _expect: { department: "billing" } }) } },
      { values: { table: "text\t_test\nA\tmaybe\n" },
        expect: textNote(J({ text: "A" }), "Read as tab-separated. 1 row: 0 labeled, 0 held out. 1 _test cell that was not yes or no ignored.") },
      // Headers are trimmed as the Workbench's CSV import trims them; a repeated field header becomes text_2, a blank one
      // column_3; a Choice key "5" stays text (a number would not be a valid Choice label); the cell past the header is dropped.
      { values: { table: " text , label:stars ,,text\nGreat beans,5,x,again,extra\nOk,3,,," },
        expect: textNote(J({ text: "Great beans", column_3: "x", text_2: "again", _expect: { stars: "5" } }, { text: "Ok", _expect: { stars: "3" } }),
          "Read as comma-separated. 2 rows: 2 labeled, 0 held out. 1 row had cells past the header, which were left out.") },
    ],
    invalid: [{ table: "text,label:a,expect:a\nx,1,2" }, { table: "text,label:a,label:a\nx,1,2" }, { table: "text,_test,_test\nx,yes,no" },
      { table: "text,label:a" }, { table: "text,_expect\nx,{}" }, { table: "text,label:a\n,1" }, { table: "  " }],
  },
  column_to_text_rows: {
    values: { table: 'id,Text\n1,"My beans arrived\n  stale"\n2,\n3,"{""a"": 1}"\n', column: "text" },
    expect: textNote('My beans arrived stale\n{"a": 1}\n', "2 text rows. 1 blank cell skipped. 1 row starts with { and would be read as a JSON object."),
    invalid: [{ table: "id,Text\n1,x", column: "body" }, { table: "id,Text\n1,", column: "Text" }],
  },
  rows_to_table: {
    values: { rows: L(
      { text: "Where is my parcel?", channel: "email", _expect: { department: "shipping" } },
      "Refund please",
      { text: "-5 off coupon", meta: { tier: 2 }, _expect: { department: "billing", urgent: true }, _test: true },
    ) },
    // The text cell starting with "-" gets the formula apostrophe; the nested object is JSON text, quoted for its quotes.
    expect: textNote([
      "text,channel,meta,label:department,label:urgent,_test",
      "Where is my parcel?,email,,shipping,,",
      "Refund please,,,,,",
      `'-5 off coupon,,"{""tier"":2}",billing,true,true`,
    ].join("\r\n") + "\r\n", "3 rows, 6 columns."),
    more: [{ values: { rows: "Hello there", output: "tab" }, expect: { text: "text\r\nHello there\r\n" } },
      { values: { rows: L({ text: "A", _expect: "billing" }) }, expect: textNote("text\r\nA\r\n", "1 row, 1 column. 1 row whose _expect is not an object was written without labels.") }],
    invalid: [{ rows: "" }, { rows: "x", output: "colon" }],
  },
  markdown_to_rows: {
    values: { markdown: "| text | label:department | _test |\n| --- | --- | --- |\n| Beans arrived stale<br>and cold | billing | yes |\n| Grinder \\| hopper cracked | other | |" },
    expect: { text: J(
      { text: "Beans arrived stale\nand cold", _expect: { department: "billing" }, _test: true },
      { text: "Grinder | hopper cracked", _expect: { department: "other" } },
    ) },
    invalid: [{ markdown: "just text\nno pipes" }],
  },
  rows_to_markdown: {
    values: { rows: L({ text: "Grinder | hopper", _expect: { department: "other" } }, "Where is my parcel?") },
    expect: { text: "| text | label:department |\n| --- | --- |\n| Grinder \\| hopper | other |\n| Where is my parcel? |  |" },
  },
  json_array_to_rows: {
    values: { json: '[{"text":"Hi","_expect":{"d":"billing"}}, "Line one\\nline two", 42, null, [1], "  ", true, "{\\"a\\":1}"]' },
    expect: textNote(J({ text: "Hi", _expect: { d: "billing" } }, "Line one line two", "42", "true", '{"a":1}'),
      "5 rows (4 text). Skipped positions 4, 5, 6. 1 row starts with { and would be read as a JSON object."),
    invalid: [{ json: '{"a": 1}' }, { json: "nope" }, { json: "[null]" }],
  },
  rows_to_json_array: {
    values: { rows: 'Hello\n\n{"text":"Hi","_test":true}\n' },
    expect: { text: '[\n  "Hello",\n  {\n    "text": "Hi",\n    "_test": true\n  }\n]' },
  },
  text_rows_to_objects: {
    values: { rows: 'Where is my parcel?\n{"text":"Hi"}\n{broken', field: "body" },
    expect: textNote(J({ body: "Where is my parcel?" }, '{"text":"Hi"}', { body: "{broken" }), "2 text rows wrapped; 1 object row kept."),
    invalid: [{ rows: "x", field: "_expect" }, { rows: "x", field: "  " }],
  },
  paragraphs_to_rows: {
    values: { text: "Dear team,\nmy order is late.\n\n\n  Please refund\r\n  order A-1041.\r\n\r\nThanks" },
    expect: textNote("Dear team, my order is late.\nPlease refund order A-1041.\nThanks\n", "3 text rows."),
  },
  field_to_label: {
    values: { rows: L(
      { text: "Late again", dept: "shipping" },
      { text: "Charged twice", dept: "billing", _expect: { dept: "other" } },
      { text: "Hi", dept: "" },
      { dept: "billing", _test: true },
      "Plain text",
    ), field: "dept", question: "department" },
    expect: textNote(J(
      { text: "Late again", _expect: { department: "shipping" } },
      { text: "Charged twice", _expect: { dept: "other", department: "billing" } },
      { text: "Hi" },
      { _expect: { department: "billing" }, _test: true },
      "Plain text",
    ), "3 values moved to _expect.department. 1 row without the field. 1 row now has nothing for the model to read."),
    more: [{ values: { rows: L({ text: "A", department: "billing", _expect: { department: "shipping" } }), field: "department" },
      expect: textNote(J({ text: "A", department: "billing", _expect: { department: "shipping" } }), "0 values moved to _expect.department. 1 row with a different label left as it was.") }],
    invalid: [{ rows: "x", field: "_expect" }],
  },
  label_to_field: {
    values: { rows: L(
      { text: "A", _expect: { department: "billing", urgent: true }, _test: true },
      { text: "B", department: "other", _expect: { department: "shipping" } },
      { text: "C", _expect: { urgent: false } },
    ), question: "department" },
    expect: textNote(J(
      { text: "A", department: "billing", _expect: { urgent: true }, _test: true },
      { text: "B", department: "other", _expect: { department: "shipping" } },
      { text: "C", _expect: { urgent: false } },
    ), "1 label moved to the field department. 1 row whose field differs left as it was."),
    more: [{ values: { rows: L({ text: "A", _expect: { urgent: true } }), question: "urgent", field: "flag" }, expect: { text: J({ text: "A", flag: true }) } }],
    invalid: [{ rows: "x", question: "d", field: "_test" }],
  },
  rename_label: {
    values: { rows: L({ text: "A", _expect: { dept: "billing", urgent: true } }, { text: "B", _expect: { dept: "other", department: "shipping" } }, "Plain"),
      from: "dept", to: "department" },
    expect: textNote(J({ text: "A", _expect: { department: "billing", urgent: true } }, { text: "B", _expect: { dept: "other", department: "shipping" } }, "Plain"),
      "1 label renamed. 1 row already labeled under department left as it was."),
    invalid: [{ rows: "x", from: "a", to: "a" }],
  },
  strip_labels: {
    values: { rows: L({ text: "A", _image: "torn-bag", _expect: { d: "x" }, _test: true }, { text: "B" }, "Plain") },
    expect: textNote(J({ text: "A", _image: "torn-bag" }, { text: "B" }, "Plain"), "Labels removed from 1 row, test markers from 1."),
    more: [{ values: { rows: L({ text: "A", _image: "torn-bag", _expect: { d: "x" }, _test: true }), pictures: true },
      expect: textNote(J({ text: "A" }), "Labels removed from 1 row, test markers from 1, picture names from 1.") }],
  },
  join_labels: {
    values: {
      rows: L(
        { text: "Where is my parcel?", channel: "email", _test: true },
        { text: "Refund" },
        { text: "New one" },
        { text: "Where is my parcel?", channel: "email", _expect: { department: "other" } },
      ),
      labeled: L(
        { channel: "email", text: "Where is my parcel?", _expect: { department: "shipping", urgent: false } },
        { text: "Refund", _expect: { department: "billing" } },
        { text: "Refund", _expect: { department: "other" } },
      ),
    },
    expect: textNote(J(
      { text: "Where is my parcel?", channel: "email", _expect: { department: "shipping", urgent: false }, _test: true },
      { text: "Refund" },
      { text: "New one" },
      { text: "Where is my parcel?", channel: "email", _expect: { department: "other", urgent: false } },
    ), "3 labels added to 2 rows. 1 existing label kept where the labeled set differs. 1 row with no match. 1 row whose labeled copies disagree left alone."),
    // A text row is the same input as {"text": ...} and takes that form to carry labels; a null label is no label to copy.
    more: [{ values: { rows: "Where is my parcel?\nOther text", labeled: L({ text: "Where is my parcel?", _expect: { d: "shipping", u: null } }) },
      expect: textNote(J({ text: "Where is my parcel?", _expect: { d: "shipping" } }, "Other text"), "1 label added to 1 row. 1 row with no match.") }],
  },
  check_labels: {
    values: {
      questions: JSON.stringify({
        department: { type: "choice", instructions: "Team?", criteria: { billing: "", shipping: "" } },
        urgent: { type: "noul", instructions: "Urgent?" },
        level: { type: "score", instructions: "How?", criteria: ["low", "mid", "high"] },
        spot: { type: "box", instructions: "the bag" },
      }),
      rows: L(
        { text: "A", _expect: { department: "billing", urgent: "Yes", level: "2", spot: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 } } },
        { text: "B", _expect: { department: "Billing", urgent: "maybe", level: 3, spot: { left: 0.5, top: 0.2, right: 0.1, bottom: 0.6 }, mood: "calm" } },
        { text: "C", _expect: "billing" },
        { text: "D", _expect: { urgent: null, level: 1.5, department: true, gone: null } },
        "Plain",
        { text: "E", _test: true, _expect: { department: "returns", urgent: "no" } },
      ),
    },
    // 4 + 5 + 2 + 2 labels are checked (line 3 has no label map; line 4's nulls are no labels, even under an unknown
    // id); line 1 is all valid; line 6 is held out, so its problem does not show the value "returns".
    expect: rowsTable([["Labels checked", 13], ["Problems", 9]], { columns: ["line", "question", "problem"], rows: [
      [2, "department", '"Billing" is not one of the options: billing, shipping'],
      [2, "urgent", '"maybe" is not yes or no'],
      [2, "level", "3 is not a level number from 0 to 2"],
      [2, "spot", "A Box label needs left, top, right and bottom from 0 to 1, with left < right and top < bottom"],
      [2, "mood", "No question has this id"],
      [3, "", "_expect is not an object keyed by question id"],
      [4, "level", "1.5 is not a level number from 0 to 2"],
      [4, "department", "true is not one of the options: billing, shipping"],
      [6, "department", "The label is not one of the options: billing, shipping"],
    ] }),
    invalid: [{ rows: "x", questions: "[]" }, { rows: "x", questions: '{"a": 1}' }, { rows: "x", questions: "{bad" }],
  },
  count_rows: {
    values: { rows: L(
      { text: "A", channel: "email", _expect: { d: "billing", u: null } },
      "Plain text row",
      { text: "B", _image: "torn-bag", _test: true, _expect: { d: "other", u: true } },
      "{broken json",
      "",
      { photo_note: "x", _expect: { u: null } },
    ) },
    // Labels: 1 + 2 + 0 (nulls are no label); fields text, channel, photo_note (the picture name is not a field).
    expect: [["Rows", 5], ["Text rows", 2], ["Object rows", 3], ["Labeled rows", 2], ["Labels", 3], ["Held-out rows", 1],
      ["Rows with a picture", 1], ["Distinct input fields", 3], ["Lines that start with { but are not JSON", 1]],
  },
  field_fill_rates: {
    values: { rows: L({ text: "A", channel: "email", n: 3, _expect: { d: "x" } }, { text: "", channel: null, tags: ["a"] }, { text: "C", n: "4" }, "Plain") },
    expect: (result) => {
      assert.deepEqual(result.table, { columns: ["field", "rows with a value", "share of object rows", "types"],
        rows: [["text", 2, 2 / 3, "string"], ["channel", 1, 1 / 3, "string"], ["n", 2, 2 / 3, "number, string"], ["tags", 1, 1 / 3, "array"]] });
      assert.equal(result.note, "3 object rows.");
    },
    invalid: [{ rows: "Plain only" }],
  },
  label_coverage: {
    values: { rows: L({ text: "A", _expect: { d: "billing", u: true } }, { text: "B", _expect: { d: "billing" }, _test: true }, { text: "C", _expect: { d: "shipping", u: null } }, "Plain") },
    // d: rows 1 and 3 are tuning rows (billing, shipping); row 2's billing is held out, counted but not shown.
    expect: rowsTable([["Rows", 4], ["Labeled rows", 3]], { columns: ["question", "labeled rows", "share of rows", "held-out labeled", "values on rows not held out"],
      rows: [["d", 3, 0.75, 1, "billing × 1, shipping × 1"], ["u", 1, 0.25, 0, "true × 1"]] }),
  },
  malformed_lines: {
    values: { rows: [
      '{"text":"A","text":"B"}',
      "{\"text\": broken}",
      '["a","b"]',
      '"quoted line"',
      line({ text: "C", _expect: "billing", _test: "yes" }),
      line({ _image: "cat.png", photo: "x" }),
      line({ _expect: { d: "x" } }),
      "Plain",
      line({ text: "D", _image: "0123456789abcdef.png" }),
    ].join("\n") },
    expect: rowsTable([["Rows", 9], ["Lines with a problem", 7]], { columns: ["line", "problem"], rows: [
      [1, "text is written twice; JSON keeps only the last value"],
      [2, "Starts with { but is not a valid JSON object, so Bulk reads it as text"],
      [3, "A JSON array: Bulk reads the line as text"],
      [4, "A quoted JSON string: Bulk keeps the quotes as part of the text"],
      [5, "_expect must be an object keyed by question id"],
      [5, "_test must be true, or left out"],
      [6, "_image must name a sample picture (torn-bag, intact-bag, crushed-box, grinder-ok) or a saved picture"],
      [6, "A row with _image cannot also have a photo field"],
      [7, "Nothing for the model to read"],
    ] }),
  },
  duplicate_inputs: {
    values: { rows: DUPES },
    expect: rowsTable([["Rows", 7], ["Inputs with copies", 2], ["Extra copies", 3]], { columns: ["input", "copies", "lines", "labels"],
      rows: [['{"text":"A","channel":"email"}', 3, "1, 2, 7", "differ"], ["Plain", 2, "3, 6", "same"]] }),
    more: [{ values: { rows: L("Late order", { text: "Late order" }, { text: "Late order", _image: "torn-bag" }) },
      expect: rowsTable([["Rows", 3], ["Inputs with copies", 1], ["Extra copies", 1]], { columns: ["input", "copies", "lines", "labels"], rows: [["Late order", 2, "1, 2", "same"]] }) }],
  },
  dedupe_rows: {
    values: { rows: DUPES },
    expect: textNote(J(
      { text: "A", channel: "email", _expect: { d: "billing" } },
      { channel: "email", text: "A", _expect: { d: "billing" } },
      "Plain",
      { text: "B", _image: "torn-bag" },
      { text: "B", _image: "intact-bag" },
      { text: "A", channel: "email", _test: true, _expect: { d: "billing" } },
    ), "1 copy removed. 1 input with a held-out copy kept whole."),
    more: [{ values: { rows: L({ text: "A", _expect: { d: "x" } }, { _expect: { d: "x" }, text: "A" }) }, expect: textNote(J({ text: "A", _expect: { d: "x" } }), "1 copy removed.") },
      { values: { rows: L({ text: "A", _expect: { d: "x" } }, { text: "A", _expect: { d: "y" } }, "B", { text: "B" }) },
        expect: textNote(J({ text: "A", _expect: { d: "x" } }, { text: "A", _expect: { d: "y" } }, "B"), "1 copy removed. 1 input whose copies have different labels or markers kept whole.") },
      { values: { rows: L({ text: "A", _test: true }, { text: "A", _test: true }) },
        expect: textNote(J({ text: "A", _test: true }, { text: "A", _test: true }), "0 copies removed. 1 input with a held-out copy kept whole.") }],
  },
  compare_row_sets: {
    values: {
      first: L({ text: "A", _expect: { d: "billing" } }, { text: "B" }, { text: "A" }, "Plain"),
      second: L({ text: "A", _expect: { d: "other" } }, "Plain", { text: "C" }),
    },
    expect: rowsTable([["Distinct inputs in the first", 3], ["Distinct inputs in the second", 3], ["In both", 2], ["Only in the first", 1], ["Only in the second", 1],
      ["In both with different labels", 1]], { columns: ["where", "line", "input"], rows: [
      ["labels differ", 1, '{"text":"A"}'], ["only in the first", 2, '{"text":"B"}'], ["only in the second", 3, '{"text":"C"}']] }),
    more: [{ values: { first: "Late order", second: L({ text: "Late order" }, { text: "Late order", channel: "chat" }) },
      expect: rowsTable([["Distinct inputs in the first", 1], ["Distinct inputs in the second", 2], ["In both", 1], ["Only in the first", 0], ["Only in the second", 1],
        ["In both with different labels", 0]], { columns: ["where", "line", "input"], rows: [["only in the second", 2, '{"text":"Late order","channel":"chat"}']] }) }],
  },
  split_by_value: {
    values: { rows: L({ text: "A", channel: "email" }, { text: "B", channel: "chat" }, "Plain", { text: "C", channel: "email" }), field: "channel" },
    expect: textNote(`# channel = email (2 rows)\n${J({ text: "A", channel: "email" }, { text: "C", channel: "email" })}\n# channel = chat (1 row)\n${J({ text: "B", channel: "chat" })}\n# channel = (missing) (1 row)\nPlain\n`, "3 groups."),
    more: [
      { values: { rows: L({ text: "A", _test: true }, { text: "B" }), field: "_test" }, expect: { text: `# _test = true (1 row)\n${J({ text: "A", _test: true })}\n# _test = (missing) (1 row)\n${J({ text: "B" })}` } },
      { values: { rows: L({ text: "A", _expect: { d: 2 } }, { text: "B", _expect: { d: 2 } }), field: "_expect.d" }, expect: { text: `# _expect.d = 2 (2 rows)\n${J({ text: "A", _expect: { d: 2 } }, { text: "B", _expect: { d: 2 } })}` } },
    ],
  },
  batches: {
    values: { rows: "a\nb\nc\nd\ne", size: 2 },
    expect: textNote("# Batch 1: rows 1 to 2\na\nb\n\n# Batch 2: rows 3 to 4\nc\nd\n\n# Batch 3: rows 5 to 5\ne\n", "3 batches of up to 2."),
    invalid: [{ rows: "a", size: 0 }, { rows: "a", size: 201 }, { rows: "a", size: 1.5 }],
  },
  sort_rows: {
    // Numbers by value first (2, 2, 10; ties keep order), then text in natural order ("9" before "10"), missing last.
    values: { rows: L({ text: "a", n: 10 }, { text: "b", n: "9" }, { text: "c", n: 2 }, "Plain", { text: "d", n: "10" }, { text: "e", n: 2 }), field: "n" },
    expect: textNote(J({ text: "c", n: 2 }, { text: "e", n: 2 }, { text: "a", n: 10 }, { text: "b", n: "9" }, { text: "d", n: "10" }, "Plain"), "6 rows sorted. 1 row without n last."),
    more: [{ values: { rows: L({ text: "a", n: 10 }, { text: "b", n: "9" }, { text: "c", n: 2 }, "Plain", { text: "d", n: "10" }, { text: "e", n: 2 }), field: "n", direction: "desc" },
      expect: { text: J({ text: "d", n: "10" }, { text: "b", n: "9" }, { text: "a", n: 10 }, { text: "c", n: 2 }, { text: "e", n: 2 }, "Plain") } }],
  },
  rename_field: {
    values: { rows: L({ id: "A-1", text: "x", _expect: { d: "y" } }, { id: "A-2", order_id: "z" }, "Plain"), from: "id", to: "order_id" },
    expect: textNote(J({ order_id: "A-1", text: "x", _expect: { d: "y" } }, { id: "A-2", order_id: "z" }, "Plain"), "1 row renamed. 1 row that already had order_id left as it was."),
    invalid: [{ rows: "x", from: "id", to: "_test" }, { rows: "x", from: "id", to: "id" }],
  },
  drop_fields: {
    values: { rows: L({ id: "A-1", text: "x", internal: true, _expect: { d: "y" } }, { id: "A-2" }, "Plain"), fields: "id,\n internal" },
    expect: textNote(J({ text: "x", _expect: { d: "y" } }, {}, "Plain"), "2 rows changed. 1 row now has nothing for the model to read."),
    invalid: [{ rows: "x", fields: "_expect" }, { rows: "x", fields: " , " }],
  },
  sniff_delimiter: {
    values: { table: "a;b;c\n1;2;3\n4;5\n" },
    expect: [["Delimiter", "semicolon"], ["Columns in the header", 3], ["Data rows", 2], ["Rows with a different number of cells", 1]],
    more: [{ values: { table: "x\ty\n1\t2" }, expect: [["Delimiter", "tab"], ["Columns in the header", 2], ["Data rows", 1], ["Rows with a different number of cells", 0]] }],
  },
  change_delimiter: {
    values: { table: 'name;note\nBeans;=cheap\nGrinder;"a;b"\n' },
    expect: { text: "name,note\r\nBeans,'=cheap\r\nGrinder,a;b\r\n" },
    more: [{ values: { table: "a,b\n1,2", output: "pipe" }, expect: { text: "a|b\r\n1|2\r\n" } }],
  },
  transpose_table: {
    values: { table: "a,b,c\n1,2\n" },
    expect: textNote("a,1\r\nb,2\r\nc,\r\n", "2 lines of up to 3 cells became 3 lines of 2 cells."),
  },
  table_to_markdown: {
    values: { table: "text\tlabel:d\nGrinder | hopper\tother\n" },
    expect: { text: "| text | label:d |\n| --- | --- |\n| Grinder \\| hopper | other |" },
  },
  markdown_to_table: {
    values: { markdown: "| name | note |\n|---|---|\n| Beans | -2 off<br>today |\n" },
    expect: { text: "name,note\r\nBeans,\"'-2 off\ntoday\"\r\n" },
    more: [{ values: { markdown: "| a | b |\n| 1 | 2 |", output: "tab" }, expect: { text: "a\tb\r\n1\t2\r\n" } }],
    invalid: [{ markdown: "no table here" }],
  },
}, { ctx: () => sampleToolboxCtx() });
