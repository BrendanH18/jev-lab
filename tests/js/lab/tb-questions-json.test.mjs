// Tests for the tb-questions-json Toolbox pack. Expected questions objects, outlines, diffs and notes were written out
// by hand from the question format in docs/workbench.md and the server's checks in jev/workbench.py
// (validate_questions). Byte and character counts were checked separately: "37 bytes became 27" and the compact
// length 43 / 44 UTF-8 bytes with Python's len(s) and len(s.encode()); the server's state count 57 is
// len(json.dumps({"a": "é", "b": [1, 2], "c": {"d": None, "e": True}})) in Python.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-questions-json.js";
import { checkPack } from "./harness.mjs";
import { sampleToolboxCtx } from "./fixtures/workbench-shell.mjs";

const pretty = (value) => JSON.stringify(value, null, 2);
const textNote = (text, note) => (result) => {
  assert.equal(result.text, text);
  if (note !== undefined) assert.equal(result.note, note);
};
const rowsTable = (rows, table) => (result) => {
  assert.deepEqual(result.rows, rows);
  assert.deepEqual(result.table, table);
};

const Q4 = JSON.stringify({
  department: { type: "choice", instructions: "Which team should handle this ticket?", criteria: { billing: "Refunds", shipping: "Parcels", other: "Anything else" } },
  urgent: { type: "noul", instructions: "Is it urgent?" },
  level: { type: "score", instructions: "How much time pressure does the ticket express?", criteria: ["low", "mid", "high"] },
  spot: { type: "box", instructions: "the spilled coffee beans in `photo`" },
});

const BAD_SET = `{
  "department": {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "Refunds", "billing": "Charges"}},
  "urgent": {"type": "noul", "instructions": "Urgent?", "criteria": {"yes": "now"}},
  "level": {"type": "score", "instructions": "", "criteria": ["only one"], "notes": "draft"},
  " department ": {"type": "box", "instructions": "the bag", "criteria": {"x": 1}},
  "": {"type": "Choice", "instructions": 5},
  "spot": "the bag",
  "urgent": {"type": "noul", "instructions": "   "}
}`;

const BEFORE = JSON.stringify({
  dept: { type: "choice", instructions: "Team?", criteria: { billing: "Money", shipping: "Parcels", other: "Else" } },
  urgent: { type: "noul", instructions: "Urgent?" },
  level: { type: "score", instructions: "How much?", criteria: ["low", "mid", "high"] },
  old: { type: "box", instructions: "the bag" },
  same: { type: "noul", instructions: "Same?" },
});
const AFTER = JSON.stringify({
  urgent: { type: "score", instructions: "How urgent?", criteria: ["no", "yes"] },
  dept: { type: "choice", instructions: "Team?", criteria: { shipping: "Parcels", billing: "Money and refunds", returns: "Returns" } },
  new_q: { type: "noul", instructions: "New?" },
  level: { type: "score", instructions: "How much?", criteria: ["low", "medium", "high", "extreme"] },
  same: { type: "noul", instructions: "Same?" },
});

checkPack(pack, {
  validate_questions: {
    // JSON.parse keeps the last "urgent" (instructions "   ") in the first "urgent"'s place, so the noul criteria
    // problem of the first copy is never seen: only the repeat is reported.
    values: { questions: BAD_SET },
    expect: rowsTable([["Questions", 6], ["Problems", 12]], { columns: ["question", "problem"], rows: [
      ["department", "department.criteria.billing is written twice; JSON keeps only the last value"],
      ["urgent", "The id is written twice; JSON keeps only the last question"],
      ["urgent", "Instructions are blank"],
      ["level", "Instructions are missing"],
      ["level", "Score criteria must be a list of at least two levels"],
      ["level", "notes is not sent to the model; only type, instructions and criteria are"],
      [" department ", 'Same id as "department" once spaces are trimmed'],
      [" department ", "Box questions take no criteria"],
      ["", "The id is blank"],
      ["", "type must be noul, choice, score or box"],
      ["", "Instructions are not text"],
      ["spot", "A question must be an object"],
    ] }),
    more: [
      { values: { questions: Q4 }, expect: (result) => {
        assert.deepEqual(result.rows, [["Questions", 4], ["Problems", 0]]);
        assert.deepEqual(result.table.rows, []);
        assert.match(result.note, /No problems found/);
      } },
      { values: { questions: "[1]" }, expect: rowsTable([["Questions", 0], ["Problems", 1]], { columns: ["question", "problem"], rows: [["", "Questions must be an object keyed by question id"]] }) },
      { values: { questions: "{}" }, expect: rowsTable([["Questions", 0], ["Problems", 1]], { columns: ["question", "problem"], rows: [["", "There are no questions"]] }) },
      { values: { questions: JSON.stringify({ q: { type: "noul", instructions: "Q?", criteria: { maybe: "x" } }, s: { type: "choice", instructions: "S?", criteria: {} } }) },
        expect: rowsTable([["Questions", 2], ["Problems", 2]], { columns: ["question", "problem"], rows: [
          ["q", "Noul criteria may only have true and false keys"], ["s", "Choice criteria must be an object of option key to description"]] }) },
    ],
    invalid: [{ questions: "{bad" }],
  },
  choice_from_options: {
    values: { id: " department ", instructions: "Which team should handle this ticket? ", options: "billing: Refunds, charges: or payment\n\nshipping:Delivery tracking\nother\n" },
    expect: textNote(`{
  "department": {
    "type": "choice",
    "instructions": "Which team should handle this ticket?",
    "criteria": {
      "billing": "Refunds, charges: or payment",
      "shipping": "Delivery tracking",
      "other": ""
    }
  }
}`, "3 options. Some options have a description and others do not."),
    invalid: [{ id: "q", instructions: "Q?", options: "a\nb: x\na: y" }, { id: "q", instructions: "Q?", options: "only" }, { id: "q", instructions: "Q?", options: ": nokey\nb" },
      { id: "  ", instructions: "Q?", options: "a\nb" }],
  },
  score_from_levels: {
    values: { id: "urgency", instructions: "How much time pressure?", levels: "None\n Soon \n\nnone\nNow" },
    expect: textNote(pretty({ urgency: { type: "score", instructions: "How much time pressure?", criteria: ["None", "Soon", "none", "Now"] } }), "4 levels, 0 to 3. Levels 0 and 2 read the same."),
    invalid: [{ id: "q", instructions: "Q?", levels: "one level" }, { id: "q", instructions: "Q?", levels: Array.from({ length: 26 }, (_, i) => `level ${i}`).join("\n") }],
  },
  noul_question: {
    values: { id: "wants_refund", instructions: "Does the customer ask for a refund?", yes: " They ask for money back " },
    expect: textNote(pretty({ wants_refund: { type: "noul", instructions: "Does the customer ask for a refund?", criteria: { true: "They ask for money back" } } }),
      "A Noul is clearer with both a true and a false criterion."),
    more: [{ values: { id: "q", instructions: "Q?", yes: "a", no: "b" }, expect: textNote(pretty({ q: { type: "noul", instructions: "Q?", criteria: { true: "a", false: "b" } } }), null) },
      { values: { id: "q", instructions: "Q?" }, expect: { text: pretty({ q: { type: "noul", instructions: "Q?" } }) } }],
    invalid: [{ id: "q", instructions: "" }],
  },
  list_questions: {
    values: { questions: Q4 },
    expect: (result) => {
      assert.deepEqual(result.table, { columns: ["id", "type", "options or levels", "instruction words"],
        rows: [["department", "choice", 3, 6], ["urgent", "noul", 0, 3], ["level", "score", 3, 8], ["spot", "box", 0, 6]] });
      assert.equal(result.note, "4 questions.");
    },
    invalid: [{ questions: "[]" }, { questions: '{"a": "x"}' }],
  },
  label_values: {
    values: { questions: Q4 },
    expect: { table: { columns: ["question", "type", "labels"], rows: [
      ["department", "choice", "billing, shipping, other"], ["urgent", "noul", "true or false (also yes/no, y/n, 1/0)"], ["level", "score", "0, 1, 2"],
      ["spot", "box", "left, top, right and bottom, each from 0 to 1"]] } },
  },
  questions_to_csv: {
    values: { questions: JSON.stringify({
      department: { type: "choice", instructions: "Which team?", criteria: { billing: "Refunds, charges", other: "-" } },
      urgent: { type: "noul", instructions: "Urgent?", criteria: { true: 'Says "today"', false: "No deadline" } },
      spot: { type: "box", instructions: "the bag in `photo`" },
      level: { type: "score", instructions: "How much?", criteria: ["low", "high"] },
    }) },
    // The lone "-" description gets the formula apostrophe; the comma and quotes force quoting.
    expect: textNote([
      "id,type,instructions,key,description",
      'department,choice,Which team?,billing,"Refunds, charges"',
      "department,choice,,other,'-",
      'urgent,noul,Urgent?,true,"Says ""today"""',
      "urgent,noul,,false,No deadline",
      "spot,box,the bag in `photo`,,",
      "level,score,How much?,0,low",
      "level,score,,1,high",
    ].join("\r\n") + "\r\n", "7 rows."),
  },
  csv_to_questions: {
    values: { outline: [
      "ID,Type,Instructions,Key,Description",
      'department,choice,Which team?,billing,"Refunds, charges"',
      'department,choice,,shipping,"{""label"": ""Shipping"", ""hint"": ""parcels""}"',
      "urgent,NOUL,Urgent?,TRUE,Says today",
      ",,,,",
      "level,score,How much?,1,high",
      "level,score,,0,low",
      "spot,box,the bag in `photo`,,",
    ].join("\n") },
    expect: textNote(pretty({
      department: { type: "choice", instructions: "Which team?", criteria: { billing: "Refunds, charges", shipping: { label: "Shipping", hint: "parcels" } } },
      urgent: { type: "noul", instructions: "Urgent?", criteria: { true: "Says today" } },
      level: { type: "score", instructions: "How much?", criteria: ["low", "high"] },
      spot: { type: "box", instructions: "the bag in `photo`" },
    }), "4 questions."),
    more: [{ values: { outline: "id\ttype\tinstructions\tkey\tdescription\nq\tscore\tHow?\t\tlow\nq\tscore\t\t\thigh" },
      expect: { text: pretty({ q: { type: "score", instructions: "How?", criteria: ["low", "high"] } }) } },
      // The apostrophe questions_to_csv puts before formula-like text comes off; one before ordinary text stays.
      { values: { outline: "id,type,instructions,key,description\nq,choice,Pick one,minus,'-\nq,choice,,eq,' =1+1\nq,choice,,quote,'plain" },
        expect: { text: pretty({ q: { type: "choice", instructions: "Pick one", criteria: { minus: "-", eq: "=1+1", quote: "'plain" } } }) } }],
    invalid: [
      { outline: "id,type\nq,choice" },
      { outline: "name,kind\nq,noul" },
      { outline: "id,type,instructions,key,description\nq,score,How?,0,a\nq,score,,0,b" },
      { outline: "id,type,instructions\nq,choice,A?\nq,noul,B?" },
      { outline: "id,type,instructions,key\nb,box,the bag,x" },
      { outline: "id,type,instructions,key,description\nq,noul,A?,maybe,x" },
      { outline: "id,type,instructions,key,description\nq,choice,A?,a,x\nq,choice,B?,b,y" },
      { outline: "id,type,instructions,key,description\nq,banana,A?,,"},
    ],
  },
  questions_to_markdown: {
    values: { questions: JSON.stringify({ q: { type: "noul", instructions: "Is it | broken?\nReally?", criteria: { true: "yes" } }, b: { type: "box", instructions: "the bag" } }) },
    expect: { text: "| id | type | instructions | key | description |\n| --- | --- | --- | --- | --- |\n| q | noul | Is it \\| broken?<br>Really? | true | yes |\n| b | box | the bag |  |  |" },
  },
  markdown_to_questions: {
    values: { markdown: "| id | type | instructions | key | description |\n| --- | --- | --- | --- | --- |\n| q | noul | Is it \\| broken?<br>Really? | true | yes |\n| b | box | the bag |  |  |" },
    expect: { text: pretty({ q: { type: "noul", instructions: "Is it | broken?\nReally?", criteria: { true: "yes" } }, b: { type: "box", instructions: "the bag" } }) },
    invalid: [{ markdown: "no table" }],
  },
  rename_question: {
    values: { questions: JSON.stringify({ a: { type: "noul", instructions: "A?" }, b: { type: "box", instructions: "B" }, c: { type: "noul", instructions: "C?" } }), from: "b", to: " bee " },
    expect: { text: pretty({ a: { type: "noul", instructions: "A?" }, bee: { type: "box", instructions: "B" }, c: { type: "noul", instructions: "C?" } }) },
    invalid: [{ questions: '{"a":{"type":"noul","instructions":"A?"},"b":{"type":"noul","instructions":"B?"}}', from: "zz", to: "y" },
      { questions: '{"a":{"type":"noul","instructions":"A?"},"b":{"type":"noul","instructions":"B?"}}', from: "b", to: "a" },
      { questions: '{"a":{"type":"noul","instructions":"A?"}}', from: "a", to: "a" }, { questions: '{"a":{"type":"noul","instructions":"A?"}}', from: "a", to: "   " }],
  },
  compare_questions: {
    values: { before: BEFORE, after: AFTER },
    // Shared ids in before order: dept, urgent, level, same; in after order: urgent, dept, level, same.
    expect: rowsTable([["Added", 1], ["Removed", 1], ["Changed", 3], ["Unchanged", 1]], { columns: ["question", "change"], rows: [
      ["urgent", "type noul → score"], ["urgent", "instructions changed"], ["urgent", "criteria changed"], ["urgent", "position among shared questions 2 → 1"],
      ["dept", "options added: returns"], ["dept", "options removed: other"], ["dept", "option descriptions changed: billing"], ["dept", "option order changed"],
      ["dept", "position among shared questions 1 → 2"],
      ["new_q", "added (noul)"],
      ["level", "levels 3 → 4"], ["level", "level descriptions changed: 1"],
      ["old", "removed"],
    ] }),
    more: [{ values: { before: '{"c":{"type":"choice","instructions":"X","criteria":{"a":"1","b":"2"}}}', after: '{"c":{"type":"choice","instructions":"X","criteria":{"b":"2","a":"1"}}}' },
      expect: rowsTable([["Added", 0], ["Removed", 0], ["Changed", 1], ["Unchanged", 0]], { columns: ["question", "change"], rows: [["c", "option order changed"]] }) }],
  },
  pick_questions: {
    values: { questions: Q4, ids: "level,\nurgent" },
    expect: textNote(pretty({ urgent: { type: "noul", instructions: "Is it urgent?" }, level: { type: "score", instructions: "How much time pressure does the ticket express?", criteria: ["low", "mid", "high"] } }), "2 of 4 questions."),
    more: [{ values: { questions: Q4, ids: "spot, level", exclude: true }, expect: textNote(pretty({
      department: { type: "choice", instructions: "Which team should handle this ticket?", criteria: { billing: "Refunds", shipping: "Parcels", other: "Anything else" } },
      urgent: { type: "noul", instructions: "Is it urgent?" } }), "2 of 4 questions.") }],
    invalid: [{ questions: Q4, ids: "nope" }, { questions: Q4, ids: "department, urgent, level, spot", exclude: true }, { questions: Q4, ids: " , " }],
  },
  combine_questions: {
    values: {
      first: '{"verdict": {"type": "noul", "instructions": "Phishing?"}}',
      second: '{"verdict": {"type": "choice", "instructions": "Action?", "criteria": {"pay": "", "hold": ""}}, "amount_ok": {"type": "noul", "instructions": "Amount fine?"}}',
      firstPrefix: "shield.", secondPrefix: " dispatch. ",
    },
    expect: textNote(pretty({
      "shield.verdict": { type: "noul", instructions: "Phishing?" },
      "dispatch.verdict": { type: "choice", instructions: "Action?", criteria: { pay: "", hold: "" } },
      "dispatch.amount_ok": { type: "noul", instructions: "Amount fine?" },
    }), "3 questions."),
    invalid: [{ first: '{"verdict": {"type": "noul", "instructions": "A?"}}', second: '{"verdict": {"type": "noul", "instructions": "B?"}}' }],
  },
  pretty_json: {
    values: { json: '{"b":1,"a":[1,{"c":null}],"b":2}', indent: "4" },
    expect: textNote('{\n    "b": 2,\n    "a": [\n        1,\n        {\n            "c": null\n        }\n    ]\n}', "Written twice, so only the last value is kept: b."),
    more: [{ values: { json: '{"x":[1]}', indent: "tab" }, expect: textNote('{\n\t"x": [\n\t\t1\n\t]\n}', null) }, { values: { json: " [] " }, expect: { text: "[]" } }],
    invalid: [{ json: "{" }],
  },
  minify_json: {
    values: { json: '{\n  "text": "Crème",\n  "n": [1, 2]\n}' },
    expect: textNote('{"text":"Crème","n":[1,2]}', "37 bytes became 27."),
    invalid: [{ json: "nope" }],
  },
  sort_json_keys: {
    values: { json: '{"b":{"z":1,"a":2},"a":[{"d":1,"c":2}]}' },
    expect: { text: '{\n  "a": [\n    {\n      "c": 2,\n      "d": 1\n    }\n  ],\n  "b": {\n    "a": 2,\n    "z": 1\n  }\n}' },
  },
  duplicate_keys: {
    values: { json: '{"a":1,"a":2,"b":{"c":1,"c":2,"c":3},"d":[{"e":1,"e":2}]}' },
    expect: rowsTable([["Keys written twice", 3]], { columns: ["path"], rows: [["a"], ["b.c"], ["d[0].e"]] }),
    more: [{ values: { json: '{"a":1}' }, expect: rowsTable([["Keys written twice", 0]], { columns: ["path"], rows: [] }) }],
    invalid: [{ json: "{x" }],
  },
  diff_json: {
    values: { before: '{"a":1,"b":[1,2],"c":{"d":"x"},"e":true}', after: '{"a":2,"b":[1],"c":{"d":"x","f":null},"g":"new"}' },
    expect: rowsTable([["Differences", 5]], { columns: ["path", "change", "before", "after"], rows: [
      ["a", "changed", "1", "2"], ["b[1]", "removed", "2", ""], ["c.f", "added", "", "null"], ["e", "removed", "true", ""], ["g", "added", "", '"new"']] }),
    more: [{ values: { before: "1", after: '"1"' }, expect: rowsTable([["Differences", 1]], { columns: ["path", "change", "before", "after"], rows: [["(root)", "changed", "1", '"1"']] }) }],
    invalid: [{ before: "{", after: "{}" }],
  },
  flatten_json: {
    values: { json: '{"a":{"b":[1,{}]},"my key":null}' },
    expect: textNote('{\n  "a.b[0]": 1,\n  "a.b[1]": {},\n  "[\\"my key\\"]": null\n}', "3 leaves."),
  },
  unflatten_json: {
    values: { json: '{"a.b[0]":1,"a.b[1]":{},"[\\"my key\\"]":null,"c":"x"}' },
    expect: { text: pretty({ a: { b: [1, {}] }, "my key": null, c: "x" }) },
    invalid: [{ json: '{"a..b":1}' }, { json: "[1]" }],
  },
  value_at_path: {
    values: { json: '{"department":{"criteria":{"billing":"Refunds"}},"rows":[{"text":"A"},{"text":"B"}]}', path: "rows[1]" },
    expect: textNote('{\n  "text": "B"\n}', "An object."),
    more: [{ values: { json: '{"department":{"criteria":{"billing":"Refunds"}}}', path: " department.criteria.billing " }, expect: textNote('"Refunds"', "A string.") },
      { values: { json: "[1, 2]" }, expect: textNote("[\n  1,\n  2\n]", "An array.") }],
    invalid: [{ json: '{"rows":[]}', path: "rows[5]" }, { json: "{}", path: "a..b" }],
  },
  list_paths: {
    values: { json: JSON.stringify({ a: [1, "two"], b: {}, long: "x".repeat(70) }) },
    // The long value is 72 characters as JSON; shortened to 59 of them plus an ellipsis.
    expect: { table: { columns: ["path", "type", "value"], rows: [["a[0]", "number", "1"], ["a[1]", "string", '"two"'], ["b", "object", "{}"], ["long", "string", `"${"x".repeat(58)}…`]] } },
    more: [{ values: { json: "5" }, expect: { table: { columns: ["path", "type", "value"], rows: [["(root)", "number", "5"]] } } }],
  },
  set_path: {
    values: { json: '{"a":{"b":1}}', path: "a.c[1]", value: '"x"' },
    expect: textNote(pretty({ a: { b: 1, c: [null, "x"] } }), "Created a.c[1]."),
    more: [{ values: { json: '{"a":{"b":1}}', path: "a.b", value: "hello", plain: true }, expect: textNote(pretty({ a: { b: "hello" } }), "Replaced a.b.") }],
    invalid: [{ json: "{}", path: "a", value: "not json" }, { json: "{}", path: "a..b", value: "1" }],
  },
  json_shape: {
    values: { json: '{"a":"é","b":[1,2],"c":{"d":null,"e":true}}' },
    expect: [["Type", "object"], ["Characters as compact JSON", 43], ["UTF-8 bytes as compact JSON", 44], ["Depth", 2], ["Leaves", 5], ["Object keys", 5],
      ["Characters as the server counts a state", 57], ["Within the 120,000-character state limit", "yes"]],
    more: [
      // Checked in Python: s = {"k\x7f": "x\U0001F600", "n": [0.5, -3], "t": "tab\there"}; len(json.dumps(s)) is 62 (DEL and
      // the emoji's two surrogates escaped), and the compact text with ensure_ascii=False is 40 code points, 43 UTF-8 bytes.
      { values: { json: '{"k\u007f": "x\ud83d\ude00", "n": [0.5, -3], "t": "tab\\there"}' },
        expect: [["Type", "object"], ["Characters as compact JSON", 40], ["UTF-8 bytes as compact JSON", 43], ["Depth", 2], ["Leaves", 4], ["Object keys", 3],
          ["Characters as the server counts a state", 62], ["Within the 120,000-character state limit", "yes"]] },
      { values: { json: JSON.stringify({ text: "y".repeat(120000) }) }, expect: (result) => {
      // {"text": "<120,000 y>"} is 12 + 120,000 characters in Python's json.dumps.
      assert.deepEqual(result.rows.slice(-2), [["Characters as the server counts a state", 120012], ["Within the 120,000-character state limit", "no"]]);
    } }],
  },
  merge_json: {
    values: { base: '{"a":{"x":1,"y":[1,2]},"b":"keep"}', overlay: '{"a":{"y":[3],"z":true},"c":null}' },
    expect: { text: pretty({ a: { x: 1, y: [3], z: true }, b: "keep", c: null }) },
  },
  escape_string: {
    values: { text: 'Say "hi"\n\tcafé\\' },
    expect: { text: '"Say \\"hi\\"\\n\\tcafé\\\\"' },
    more: [{ values: { text: 'Say "hi"\n\tcafé\\', ascii: true, bare: true }, expect: { text: 'Say \\"hi\\"\\n\\tcaf\\u00e9\\\\' } }],
  },
  unescape_string: {
    values: { literal: '"Line one\\nLine \\"two\\" \\u00e9"' },
    expect: { text: 'Line one\nLine "two" é' },
    more: [{ values: { literal: "a\\tb" }, expect: { text: "a\tb" } }],
    invalid: [{ literal: '"unterminated' }, { literal: "bad \\x escape" }],
  },
  key_values_to_json: {
    values: { text: '# customer\ncustomer: Ada Example\norder = A-1041\n\nitems: 3\nnote: "  spaced  "\nzip: 007\nurl: https://shop.example/a?b=c' },
    expect: textNote(pretty({ customer: "Ada Example", order: "A-1041", items: "3", note: "  spaced  ", zip: "007", url: "https://shop.example/a?b=c" }), "6 fields."),
    more: [{ values: { text: 'n: 3\nok: true\nnone: null\ntags: ["a"]\nzip: 007\nbad: {x', typed: true },
      expect: { text: pretty({ n: 3, ok: true, none: null, tags: ["a"], zip: "007", bad: "{x" }) } }],
    invalid: [{ text: "no separator" }, { text: "a: 1\na: 2" }, { text: ": 1" }, { text: "# only a comment" }],
  },
  json_to_key_values: {
    values: { json: JSON.stringify({ customer: "Ada Example", items: 3, note: "  spaced  ", zip: "007", count: "42", tags: ["a"], empty: "", flag: "true" }) },
    expect: { text: 'customer: Ada Example\nitems: 3\nnote: "  spaced  "\nzip: 007\ncount: "42"\ntags: ["a"]\nempty: ""\nflag: "true"' },
    invalid: [{ json: '{"a:b": 1}' }, { json: "[1]" }, { json: "{}" }],
  },
}, { ctx: () => sampleToolboxCtx() });
