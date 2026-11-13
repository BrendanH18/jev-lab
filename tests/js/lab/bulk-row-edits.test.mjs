import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/bulk-row-edits.js";
import { runImporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { sampleBulkRowsCtx } from "./fixtures/workbench-bulk.mjs";

// Row copies as transforms receive them, and new rows as importers return them.
const row = (input, extra = {}) => ({ ref: null, input, image: null, labels: {}, test: false, ...extra });
const held = (input, extra = {}) => ({ ref: "held-1", input, image: null, labels: null, test: true, ...extra });
const fresh = (input, extra = {}) => ({ input, image: null, labels: {}, ...extra });
const sample = () => sampleBulkRowsCtx();  // selected questions: department (choice), frustration (score), is_urgent and wants_refund (noul), seal_damage (box)
const SEAL = { left: 0.2, top: 0.3, right: 0.7, bottom: 0.8 };

// Six rows for the exports, positions 1-6; row 3 is held out and its label (billing) must never appear.
const BOX = [
  "Hi there",
  '{"text": "Bag torn", "channel": "email", "_image": "torn-bag", "_expect": {"department": "shipping", "is_urgent": true}}',
  '{"text": "held one", "_image": "torn-bag", "_test": true, "_expect": {"department": "billing"}}',
  '{"note": "=SUM(A1)", "_image": "torn-bag", "_expect": {"department": "shipping"}}',
  '{"text": "Two\\nlines", "_expect": {"frustration": 2}}',
  '{"order": 12, "tags": ["a"]}',
].join("\n");
const box = (overrides = {}) => sampleBulkRowsCtx({ rowsText: BOX, ...overrides });
const notSix = () => box({ matches: (item) => item.position !== 6 });
const tsvImport = pack.features.find((feature) => feature.id === "tab_separated");

checkPack(pack, {
  // ---------- text clean-up ----------
  straight_quotes: { input: [row("It\u2019s \u201Cfine\u201D"), held("\u201Ckept\u201D"), row({ note: "\u2018ok\u2019", n: 1 })],
    output: [row("It's \"fine\""), held("\u201Ckept\u201D"), row({ note: "'ok'", n: 1 })] },
  plain_dashes: { input: [row("A\u2013B \u2014 C \u22121"), held("x\u2014y")], output: [row("A-B - C -1"), held("x\u2014y")] },
  strip_control: { input: [row("a\u0007b\tc\nd"), row("clean")], output: [row("ab\tc\nd"), row("clean")] },
  unicode_nfc: { input: [row("Cafe\u0301"), held("Cafe\u0301")], output: [row("Caf\u00E9"), held("Cafe\u0301")] },
  unix_newlines: { input: [row("a\r\nb\rc"), row({ text: "x\r\ny", channel: "chat" })], output: [row("a\nb\nc"), row({ text: "x\ny", channel: "chat" })] },
  literal_newlines: { input: [row("line one\\nline two\\r\\nthree")], output: [row("line one\nline two\nthree")], unchanged: [row("C:/no/escapes"), row("a backslash \\ alone and \\t")] },
  // Removing "<b>" from "<sc<b>ript>" joins a new tag; that is removed too.
  // Block and <br> tags become line breaks (worked by hand: "<p>" and "</p>" each give "\n", ends trimmed), inline tags vanish.
  strip_html_tags: { input: [row("<p>Hello <b>there</b></p> 2 < 3"), held("<i>x</i>"), row({ text: "Hi<br>there<div>Bye</div>", n: 1 }), row("<ul><li>a</li><li>b</li></ul>"), row("<sc<b>ript>x")],
    output: [row("Hello there\n 2 < 3"), held("<i>x</i>"), row({ text: "Hi\nthere\nBye", n: 1 }), row("a\n\nb"), row("x")], unchanged: [row("2 < 3 and 4 > 1"), row("<br>")] },
  decode_entities: { input: [row("Tom &amp; Jerry &lt;3 &#233;&#x41; &foo;"), row("&amp;lt; once &#xD800; &#0;")], output: [row("Tom & Jerry <3 \u00E9A &foo;"), row("&lt; once &#xD800; &#0;")] },

  // ---------- fields ----------
  trim_field_names: { input: [row({ " text ": "hi", "channel ": "email" }), row({ " text": "only" }), held({ " a": 1 })],
    output: [row({ text: "hi", channel: "email" }), row("only"), held({ " a": 1 })],
    rejects: [{ input: [row({ " a": 1, a: 2 })], message: /Row 1 would have two fields with the same name/ }] },
  snake_case_fields: { input: [row({ "Order ID": "A-1", orderStatus: "late" }), row({ Text: "hi" })],
    output: [row({ order_id: "A-1", order_status: "late" }), row("hi")],
    rejects: [{ input: [row({ "Order ID": 1, order_id: 2 })], message: /two fields with the same name/ }] },
  rename_field: { params: { from: "message", to: "text" },
    input: [row({ message: "hi" }), row({ message: "x", channel: "c" }), row("plain"), held({ message: "h" })],
    output: [row("hi"), row({ text: "x", channel: "c" }), row("plain"), held({ message: "h" })],
    rejects: [{ params: { from: "message", to: "_image" }, message: /row marker/ },
      { input: [row({ message: "a", text: "b" })], params: { from: "message", to: "text" }, message: /Row 1 already has a field text/ }] },
  drop_field: { params: { name: "channel" }, input: [row({ text: "a", channel: "c" }), held({ text: "b", channel: "c" }), row({ note: "n" })],
    output: [row("a"), held({ text: "b", channel: "c" }), row({ note: "n" })],
    rejects: [{ input: [row({ channel: "c" })], params: { name: "channel" }, message: /Row 1 would have no input left/ }] },
  set_field: { params: { name: "channel", value: "email" }, input: [row("hi"), row({ text: "x", channel: "chat" }), row([1, 2]), held("h")],
    output: [row({ text: "hi", channel: "email" }), row({ text: "x", channel: "email" }), row([1, 2]), held("h")],
    rejects: [{ input: [row("hi", { image: "torn-bag" })], params: { name: "photo", value: "x" }, message: /cannot have its own photo field/ },
      { params: { name: "_test", value: "1" }, message: /row marker/ }] },
  lowercase_field: { params: { name: "channel" }, input: [row({ text: "a", channel: "Email" }), row({ text: "b", channel: 3 })],
    output: [row({ text: "a", channel: "email" }), row({ text: "b", channel: 3 })] },
  drop_empty_fields: { input: [row({ text: "a", note: " ", tags: [], meta: {}, n: null, k: 0 }), row({ note: "", x: null })],
    output: [row({ text: "a", k: 0 }), row({ note: "", x: null })] },
  field_into_text: { params: { name: "channel" }, input: [row({ text: "Hi", channel: "email" }), row({ channel: { id: 1 }, note: "n" }), row("plain")],
    output: [row("Hi\nchannel: email"), row({ text: 'channel: {"id":1}', note: "n" }), row("plain")] },
  field_to_label: { params: { field: "department", question: "department" },
    input: [row({ text: "a", department: "billing" }), row({ text: "b", department: "shipping" }, { labels: { department: "shipping", q: true } }), held({ text: "c", department: "x" }),
      row({ text: "d", department: " " }), row({ text: "e", department: null }, { labels: { department: "none" } })],
    output: [row("a", { labels: { department: "billing" } }), row("b", { labels: { department: "shipping", q: true } }), held({ text: "c", department: "x" }),
      row("d"), row("e", { labels: { department: "none" } })],
    rejects: [{ input: [row({ text: "c", department: "billing" }, { labels: { department: "none" } })], params: { field: "department", question: "department" },
      message: /Row 1 already has a different department label/ }] },

  // ---------- rows ----------
  drop_empty_rows: { input: [row(""), row({ note: "", x: null }), row({ note: "" }, { image: "torn-bag" }), held(""), row("keep"), row([])],
    output: [row({ note: "" }, { image: "torn-bag" }), held(""), row("keep")] },
  // "a": copies 1 and 3 agree, so they merge at 1; "b": copies disagree on q, so they stay; "c": a held-out copy exists, so it stays.
  merge_copies: { input: [row("a", { labels: { q: true } }), row("b"), row("a", { labels: { r: 1 } }), held("c"), row("c", { labels: { q: false } }),
    row("b", { labels: { q: true } }), row("b", { labels: { q: false } }), row("c")],
  output: [row("a", { labels: { q: true, r: 1 } }), row("b"), held("c"), row("c", { labels: { q: false } }), row("b", { labels: { q: true } }),
    row("b", { labels: { q: false } }), row("c")] },
  sort_by_field: { params: { name: "amount", order: "asc" },
    input: [row({ amount: 10 }), held("h"), row({ amount: "n/a" }), row("no field"), row({ amount: 2 }), row({ amount: "abc" })],
    output: [row({ amount: 2 }), held("h"), row({ amount: 10 }), row({ amount: "abc" }), row({ amount: "n/a" }), row("no field")] },
  labeled_first: { input: [row("a"), held("h"), row("b", { labels: { q: 1 } }), row("c"), row("d", { labels: { q: 2 } })],
    output: [row("b", { labels: { q: 1 } }), held("h"), row("d", { labels: { q: 2 } }), row("a"), row("c")] },

  // ---------- labels ----------
  rename_label: { params: { from: "urgent", to: "is_urgent" }, input: [row("a", { labels: { urgent: true, q: 1 } }), held("h")],
    output: [row("a", { labels: { is_urgent: true, q: 1 } }), held("h")],
    rejects: [{ input: [row("a", { labels: { urgent: true, is_urgent: false } })], params: { from: "urgent", to: "is_urgent" }, message: /Row 1 already has a label for is_urgent\./ }] },
  drop_label: { params: { question: "q" }, input: [row("a", { labels: { q: 1, r: 2 } }), held("h"), row("b")], output: [row("a", { labels: { r: 2 } }), held("h"), row("b")] },
  choice_label_case: { ctx: sample(), input: [row("a", { labels: { department: " Shipping " } }), row("b", { labels: { department: "Freight" } }), row("c", { labels: { other: "X" } })],
    output: [row("a", { labels: { department: "shipping" } }), row("b", { labels: { department: "Freight" } }), row("c", { labels: { other: "X" } })] },
  score_label_numbers: { ctx: sample(), input: [row("a", { labels: { frustration: "2.0" } }), row("b", { labels: { frustration: "high" } }), row("c", { labels: { is_urgent: "1" } })],
    output: [row("a", { labels: { frustration: 2 } }), row("b", { labels: { frustration: "high" } }), row("c", { labels: { is_urgent: "1" } })] },
  drop_box_labels_without_picture: { ctx: sample(),
    input: [row("a", { labels: { seal_damage: SEAL, department: "shipping" } }), row({ note: "n" }, { image: "torn-bag", labels: { seal_damage: SEAL } })],
    output: [row("a", { labels: { department: "shipping" } }), row({ note: "n" }, { image: "torn-bag", labels: { seal_damage: SEAL } })] },

  // ---------- importers ----------
  plain_lines: { text: 'First line\n\n  {"text": "x"}  \r\nThird', items: [fresh("First line"), fresh('{"text": "x"}'), fresh("Third")], rejects: ["", "  \n "] },
  list_items: { text: "Intro\n1. Where is my order?\n2) Grinder broke\n   after a week\n- Decaf?\n",
    items: [fresh("Where is my order?"), fresh("Grinder broke after a week"), fresh("Decaf?")], warnings: 1, rejects: ["no markers here"] },
  message_blocks: { text: "Hi,\nmy bag tore.\n\n\nSecond message  \n \nThird", items: [fresh("Hi,\nmy bag tore."), fresh("Second message"), fresh("Third")], rejects: ["\n\n"] },
  tab_separated: { ctx: sample(),
    text: "\r\n \t\r\ntext\tchannel\t_image\tlabel:department\tlabel:is_urgent\tlabel:frustration\nBag torn\temail\ttorn-bag\tshipping\tTRUE\t2\nDecaf?\t\t\t\t\t\n\t\t\t\t\t\n\tchat\t\t\tmaybe\t\n",
    items: [fresh({ text: "Bag torn", channel: "email" }, { image: "torn-bag", labels: { department: "shipping", is_urgent: true, frustration: 2 } }),
      fresh("Decaf?"), fresh({ channel: "chat" }, { labels: { is_urgent: "maybe" } })],
    warnings: 1, rejects: ["text,department\na,b", "text\tlabel:\nx\ty", "text\t_test\nx\ttrue", "text\tlabel:q", "text\ttext\na\tb"] },
  markdown_table: { text: "| text | _image | label:department |\n|---|---|---|\n| Line one<br>line two | | billing |\n| | crushed-box | |",
    items: [fresh("Line one\nline two", { labels: { department: "billing" } }), fresh({}, { image: "crushed-box" })],
    rejects: ["not a table", "| text |\n|---|", "| text | text |\n| a | b |"] },
  json_array: { text: '["Hi", "", {"text": "Bag torn", "_image": "torn-bag", "_expect": {"department": "shipping"}}, {"text": "held", "_test": true}, {"note": "n", "channel": "c"}, 5, [1], {"_expect": {"q": 1}}, {"note": "p", "photo": "x", "_image": "torn-bag"}]',
    items: [fresh("Hi"), fresh("Bag torn", { image: "torn-bag", labels: { department: "shipping" } }), fresh({ note: "n", channel: "c" })],
    warnings: 6, rejects: ["{}", "not json", "[5]"] },
  field_blocks: { ctx: sample(), text: "text: Bag torn\nchannel: email\n_image: torn-bag\nlabel:department: shipping\nlabel:is_urgent: false\n\ntext: Decaf?\n",
    items: [fresh({ text: "Bag torn", channel: "email" }, { image: "torn-bag", labels: { department: "shipping", is_urgent: false } }), fresh("Decaf?")],
    rejects: ["just words without a colon", "text: a\ntext: b"] },

  // ---------- exporters ----------
  rows_json: { ctx: box(), filename: "bulk-rows.json", excludes: ["held one", "billing"],
    text: `${JSON.stringify(["Hi there",
      { text: "Bag torn", channel: "email", _image: "torn-bag", _expect: { department: "shipping", is_urgent: true } },
      { note: "=SUM(A1)", _image: "torn-bag", _expect: { department: "shipping" } },
      { text: "Two\nlines", _expect: { frustration: 2 } },
      { order: 12, tags: ["a"] }], null, 2)}\n` },
  rows_tsv: { ctx: notSix(), filename: "bulk-rows.tsv", excludes: ["held one", "billing"],
    text: "text\tchannel\tnote\t_image\tlabel:department\tlabel:frustration\tlabel:is_urgent\n"
      + "Hi there\t\t\t\t\t\t\n"
      + "Bag torn\temail\t\ttorn-bag\tshipping\t\ttrue\n"
      + "\t\t'=SUM(A1)\ttorn-bag\tshipping\t\t\n"
      + '"Two\nlines"\t\t\t\t\t2\t\n',
    check: (out) => {
      // The tab-separated import reads the export back into the same rows (the formula cell keeps its apostrophe).
      const back = runImporter(tsvImport, out.text, sample()).items;
      assert.deepEqual(back[1], fresh({ text: "Bag torn", channel: "email" }, { image: "torn-bag", labels: { department: "shipping", is_urgent: true } }));
      assert.deepEqual(back[3], fresh("Two\nlines", { labels: { frustration: 2 } }));
    } },
  inputs_csv: { ctx: notSix(), filename: "bulk-inputs.csv", excludes: ["held one", "shipping", "billing"],
    text: '"row","text","channel","note","picture"\r\n"1","Hi there","","",""\r\n"2","Bag torn","email","","torn-bag"\r\n"4","","","\'=SUM(A1)","torn-bag"\r\n"5","Two\nlines","","",""\r\n' },
  rows_markdown: { ctx: box({ matches: (item) => item.position <= 5 }), filename: "bulk-rows.md", excludes: ["billing"],
    text: ["| row | input | picture | labels |", "| --- | --- | --- | --- |", "| 1 | Hi there |  |  |",
      '| 2 | {"text":"Bag torn","channel":"email"} | torn-bag | department: shipping; is_urgent: true |',
      "| 3 | held one | torn-bag | held out |", '| 4 | {"note":"=SUM(A1)"} | torn-bag | department: shipping |',
      "| 5 | Two<br>lines |  | frustration: 2 |", ""].join("\n") },
  texts_lines: { ctx: box(), filename: "bulk-texts.txt", text: "Hi there\nBag torn\nTwo lines\n", excludes: ["held one"] },
  field_inventory: { ctx: box(), filename: "bulk-fields.csv", excludes: ["Bag torn", "email"],
    text: '"field","rows","kinds"\r\n"text","4","text"\r\n"channel","1","text"\r\n"note","1","text"\r\n"order","1","number"\r\n"tags","1","list"\r\n' },
  picture_counts: { ctx: box(), filename: "bulk-pictures.csv", text: '"picture","tuning rows","held-out rows"\r\n"torn-bag","2","1"\r\n' },
  label_distribution: { ctx: box(), filename: "bulk-label-counts.csv", excludes: ["billing"],
    text: '"question","label","rows"\r\n"department","shipping","2"\r\n"frustration","2","1"\r\n"is_urgent","true","1"\r\n' },
}, { ctx: () => sampleBulkRowsCtx() });

// Every all() edit, and a few each() edits, applied to the real sample box go through the page's own replaceItems
// guards: held-out rows stay exactly as they were (same line text), and nothing becomes or stops being held out.
const { test } = await import("node:test");
const { previewTransform } = await import("../../../static/js/lab/kit.js");
const feature = (id) => pack.features.find((entry) => entry.id === id);
test("bulk-row-edits: edits on the sample box pass the page's replaceItems guards and keep held-out lines", () => {
  const edits = [["drop_empty_rows", {}], ["merge_copies", {}], ["sort_by_field", { name: "text" }], ["labeled_first", {}],
    ["set_field", { name: "channel", value: "web" }], ["field_into_text", { name: "channel" }], ["drop_label", { question: "is_urgent" }]];
  for (const [id, params] of edits) {
    const ctx = sample();
    const before = ctx.state.rowsText.split("\n");
    const heldLines = before.filter((line) => line.includes('"_test"'));
    const items = ctx.items();
    const preview = previewTransform(`bulk-row-edits/${id}`, feature(id), items, new Set(items.map((_, index) => index)), params, ctx);
    const result = ctx.actions.replaceItems(preview.next, { label: id });
    // The sample box has no empty rows, so that edit changes nothing; every other one does.
    assert.equal(result.changed, id !== "drop_empty_rows", id);
    const after = ctx.state.rowsText.split("\n");
    for (const line of heldLines) assert.equal(after.filter((entry) => entry === line).length, 1, `${id} keeps held-out line ${line}`);
    assert.equal(ctx.data.heldOut, 2, id);
  }
});

test("bulk-row-edits: merge_copies only merges shown copies", () => {
  const items = [row("a", { labels: { q: true } }), row("a", { labels: { r: 1 } }), row("a")];
  const preview = previewTransform("bulk-row-edits/merge_copies", feature("merge_copies"), items, new Set([0, 2]), {}, sample());
  assert.deepEqual(preview.next, [row("a", { labels: { q: true } }), row("a", { labels: { r: 1 } })]);
});

test("bulk-row-edits: imported rows append through importItems and keep labels and pictures", () => {
  const ctx = sample();
  const { items } = runImporter(tsvImport, "text\t_image\tlabel:is_urgent\nNew bag torn\ttorn-bag\tfalse\n", ctx);
  ctx.actions.importItems(items, { label: "TSV" });
  const last = ctx.items()[ctx.items().length - 1];
  assert.deepEqual({ input: last.input, image: last.image, labels: last.labels, test: last.test }, { input: "New bag torn", image: "torn-bag", labels: { is_urgent: false }, test: false });
  assert.equal(ctx.items().length, 13);
});
