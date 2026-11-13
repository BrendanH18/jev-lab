// Tests of the Workbench Bulk Lab surfaces: the builders in static/js/lab/surfaces/workbench-bulk.js (item shapes,
// shown(), every action's guard, replaceItems/importItems invariants) and the page hooks in static/js/workbench-bulk.js,
// static/js/bulk-preflight.js and static/js/workbench-import.js, rebuilt from their source with stand-ins.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { bulkResultsCtx, bulkRowsCtx } from "../../../static/js/lab/surfaces/workbench-bulk.js";
import { definePack } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";
import { SAMPLE_BULK_ROWS_TEXT, sampleBulkResultsCtx, sampleBulkRowsCtx } from "./fixtures/workbench-bulk.mjs";
import { fakeEnv, find, findAll, textOf } from "./harness.mjs";

const lines = SAMPLE_BULK_ROWS_TEXT.split("\n");
const bulkSource = readFileSync(new URL("../../../static/js/workbench-bulk.js", import.meta.url), "utf8");
const preflightSource = readFileSync(new URL("../../../static/js/bulk-preflight.js", import.meta.url), "utf8");
const importSource = readFileSync(new URL("../../../static/js/workbench-import.js", import.meta.url), "utf8");
const body = (source, name) => source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) });

// ---------- workbench.bulk.rows: items ----------

test("rows: items follow the server's parsing, with positions, lines and kinds", () => {
  const ctx = sampleBulkRowsCtx();
  const items = ctx.items();
  assert.equal(items.length, 12);
  assert.deepEqual(items.map((item) => item.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(items.map((item) => item.line), [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(items.map((item) => item.kind), ["text", "text", "text", "text", "object", "object", "text", "text", "text", "object", "object", "text"]);
  assert.deepEqual(items.map((item) => item.ref), [null, null, null, "held-1", null, null, null, null, null, null, "held-1", null]);
  assert.equal(items[0].input, "My order arrived with the bag torn and beans everywhere. Can I get a replacement?", "an object with only text reads as text");
  assert.equal(items[1].input, "Do you sell decaf in whole bean?");
  assert.deepEqual(items[1].fields, ["text"]);
  assert.deepEqual(items[5].input, { text: "Where is the invoice for our cafe order?", channel: "email" });
  assert.deepEqual(items[5].fields, ["text", "channel"]);
  assert.equal(items[4].text, null);
  assert.equal(items[4].image, "torn-bag");
  assert.deepEqual(items[4].input, { note: "Customer photo of the delivered bag" });
  assert.equal(items[6].malformed, true);
  assert.equal(items[6].input, '{"text": "Half-written JSON');
  assert.equal(items[8].problem, "_expect must be an object keyed by question id");
  assert.deepEqual(items[8].labels, {});
  assert.deepEqual(items[11].labels, { is_urgent: "yes" });
  assert.ok(items.every((item) => item.inRun));
  assert.ok(Object.isFrozen(items[0]) && Object.isFrozen(items[0].labels) && Object.isFrozen(items[0].labeled));
  assert.equal(ctx.itemName(items[9], 0), "10", "the position, not the index in a filtered list");
  assert.deepEqual(Object.keys(items[0]), ["ref", "input", "image", "labels", "test"], "copies hold the stored fields only");
  assert.deepEqual(Object.keys(structuredClone(items[5])), ["ref", "input", "image", "labels", "test"]);
  assert.equal(JSON.parse(JSON.stringify(items[5])).position, undefined);
});

test("rows: held-out rows hide their label values but list their question ids", () => {
  const items = sampleBulkRowsCtx().items();
  const held = items.filter((item) => item.test);
  assert.deepEqual(held.map((item) => item.position), [4, 11]);
  assert.equal(held[0].labels, null);
  assert.deepEqual(held[0].labeled, ["department", "is_urgent"]);
  assert.deepEqual(held[1].labeled, ["wants_refund"]);
  assert.ok(!JSON.stringify(held).includes("none"), "the held-out department label never appears");
  const twins = bulkRowsCtx({ rowsText: '{"text": "same", "_test": true, "_expect": {"q": "a"}}\n{"text": "same", "_test": true, "_expect": {"q": "b"}}' }).items();
  assert.deepEqual(twins.map((item) => item.ref), ["held-1", "held-2"], "held-out rows with the same input are told apart");
  const odd = bulkRowsCtx({ rowsText: '{"text": "x", "_test": "yes", "_expect": {"q": "secret"}}' }).items()[0];
  assert.equal(odd.test, true);
  assert.equal(odd.labels, null);
  assert.match(odd.problem, /_test must be true/);
  assert.ok(!odd.problem.includes("secret"));
});

test("rows: problems name what the server would refuse", () => {
  const text = ['{"note": "n", "_image": "torn-bag", "photo": "x"}', '{"_image": ""}', '{"_expect": {"q": 1}}', '{"_expect": {"q": 1}, "_image": "torn-bag"}'].join("\n");
  const items = bulkRowsCtx({ rowsText: text }).items();
  assert.match(items[0].problem, /cannot also have its own photo field/);
  assert.match(items[1].problem, /_image must name a picture/);
  assert.equal(items[1].image, null);
  assert.match(items[2].problem, /labels but no input/);
  assert.equal(items[3].problem, null, "a picture is input enough, as the server sees it");
});

test("rows: a JSON-array box keeps every element but null and empty text, with no line numbers", () => {
  const ctx = bulkRowsCtx({ rowsText: ' [{"text": "a", "_expect": {"q": "x"}}, null, "", "b", [1, 2], 5]' });
  assert.equal(ctx.data.format, "array");
  assert.deepEqual(ctx.items().map((item) => [item.kind, item.position, item.line]), [["text", 1, null], ["text", 2, null], ["array", 3, null], ["value", 4, null]]);
  assert.deepEqual(ctx.items()[0].labels, { q: "x" });
  assert.deepEqual(ctx.items()[2].fields, []);
  assert.equal(bulkRowsCtx({ rowsText: "[not json" }).data.format, "lines");
  assert.equal(bulkRowsCtx({ rowsText: "[not json" }).items()[0].kind, "text");
  assert.deepEqual(bulkRowsCtx({}).items(), []);
});

test("rows: rows past the 200-row cap are marked out of the run", () => {
  const text = Array.from({ length: 202 }, (_, index) => `ticket ${index + 1}`).join("\n");
  const items = bulkRowsCtx({ rowsText: text }).items();
  assert.deepEqual(items.slice(198).map((item) => item.inRun), [true, true, false, false]);
});

test("rows: items keep their identity until the box changes", () => {
  const ctx = sampleBulkRowsCtx();
  const first = ctx.items();
  assert.equal(ctx.items(), first);
  assert.equal(ctx.shown()[0], first[0]);
  ctx.state.rowsText += "\nA new ticket";
  assert.notEqual(ctx.items(), first);
  assert.equal(ctx.items().length, 13);
});

test("rows: shown() applies the Lab filter, then the Lab sort, at call time", () => {
  let hideHeld = true;
  const ctx = sampleBulkRowsCtx({ matches: (item) => !(hideHeld && item.test), arrange: (items) => items.slice().reverse() });
  assert.deepEqual(ctx.shown().map((item) => item.position), [12, 10, 9, 8, 7, 6, 5, 3, 2, 1]);
  hideHeld = false;
  assert.equal(ctx.shown().length, 12);
  const lab = createLab([definePack({ id: "t", surface: "workbench.bulk.rows", title: "T",
    features: [{ id: "labels", kind: "fact", type: "number", label: "label count", value: (item) => item.labeled.length }] })]);
  const real = sampleBulkRowsCtx({ matches: (item, c) => lab.matches("workbench.bulk.rows", item, c), arrange: (items, c) => lab.arrange("workbench.bulk.rows", items, c) });
  assert.equal(real.shown().length, 12, "no Lab filter: every row");
  lab.view("workbench.bulk.rows").filters = [{ key: "t/labels", op: "min", value: "2" }];
  assert.deepEqual(real.shown().map((item) => item.position), [1, 3, 4, 6]);
  lab.view("workbench.bulk.rows").sort = { key: "t/labels", dir: "desc" };
  assert.deepEqual(real.shown().map((item) => item.position), [1, 3, 4, 6]);
  lab.view("workbench.bulk.rows").sort = { key: "t/labels", dir: "asc" };
  assert.deepEqual(real.shown().map((item) => item.position), [3, 4, 6, 1]);
});

test("rows: data reads the page at call time, frozen", () => {
  const ctx = sampleBulkRowsCtx();
  assert.equal(ctx.data.format, "lines");
  assert.equal(ctx.data.cap, 200);
  assert.equal(ctx.data.heldOut, 2);
  assert.deepEqual(Object.keys(ctx.data.questions), ["department", "frustration", "is_urgent", "wants_refund", "seal_damage"]);
  assert.ok(Object.isFrozen(ctx.data.questions.department.criteria));
  assert.deepEqual(ctx.data.dataset, { id: "harbor-support", name: "Harbor support tickets" });
  assert.equal(ctx.data.health.lab[0].title, "Very short inputs");
  assert.equal(ctx.data.preflight.lab.length, 1);
  ctx.state.health = null; ctx.state.dataset = { id: null, name: "" }; ctx.state.source = "weird"; ctx.state.questionError = "Duplicate id: q";
  assert.equal(ctx.data.health, null);
  assert.equal(ctx.data.dataset, null);
  assert.equal(ctx.data.source, "current");
  assert.equal(ctx.data.questionError, "Duplicate id: q");
  const bare = bulkRowsCtx({ questions: () => { throw new Error("editor"); } });
  assert.deepEqual(bare.data.questions, {});
  assert.equal(bare.data.unsaved, false);
});

// ---------- workbench.bulk.rows: replaceItems / importItems ----------

const edited = (ctx, position, change) => ctx.items().map((item) => (item.position === position ? { ...structuredClone(item), ...change } : structuredClone(item)));

test("rows: an unchanged list writes nothing", () => {
  const ctx = sampleBulkRowsCtx();
  assert.deepEqual(ctx.actions.replaceItems(structuredClone(ctx.items()), { label: "Nothing" }), { changed: false, rows: 12 });
  assert.deepEqual(ctx.calls, []);
});

test("rows: an edit rewrites only its own row; unchanged rows keep their exact line text", () => {
  const ctx = sampleBulkRowsCtx();
  const result = ctx.actions.replaceItems(edited(ctx, 2, { labels: { department: "product" } }), { label: "Label decaf" });
  assert.deepEqual(result, { changed: true, rows: 12 });
  const expected = [lines[0], '{"text":"Do you sell decaf in whole bean?","_expect":{"department":"product"}}', ...lines.slice(2, 4), ...lines.slice(5)].join("\n");
  assert.deepEqual(ctx.calls, [["confirmDiscard"], ["write", expected, "Label decaf"]]);
  assert.equal(ctx.state.rowsText, expected);
  assert.equal(ctx.items()[1].labels.department, "product");
  assert.equal(ctx.items()[3].test, true, "held-out rows come through");
  assert.ok(ctx.state.rowsText.includes(lines[3]), "the held-out row is written back byte for byte, hidden labels included");
});

test("rows: new text rows, pictures, and removing labels write rows the box accepts", () => {
  const ctx = sampleBulkRowsCtx();
  const next = structuredClone(ctx.items());
  next[0] = { ...next[0], labels: {} };
  next[4] = { ...next[4], image: null };
  next.push({ input: " padded text " }, { input: "plain new row" }, { input: { text: "photo row" }, image: "intact-bag", labels: { wants_refund: false } });
  ctx.actions.replaceItems(next);
  const written = ctx.state.rowsText.split("\n");
  assert.equal(written[0], "My order arrived with the bag torn and beans everywhere. Can I get a replacement?");
  assert.equal(written[4], '{"note":"Customer photo of the delivered bag","_expect":{"seal_damage":{"left":0.2,"top":0.3,"right":0.7,"bottom":0.8}}}');
  assert.deepEqual(written.slice(-3), ['{"text":" padded text "}', "plain new row", '{"text":"photo row","_image":"intact-bag","_expect":{"wants_refund":false}}']);
  assert.equal(ctx.calls.at(-1)[2], "Lab edit");
});

test("rows: removing and reordering tuning rows is allowed; held-out rows may move but must stay", () => {
  const ctx = sampleBulkRowsCtx();
  const next = ctx.items().filter((item) => item.position !== 8).reverse().map((item) => structuredClone(item));
  ctx.actions.replaceItems(next);
  assert.deepEqual(ctx.items().map((item) => item.test), [false, true, false, false, false, false, false, true, false, false, false]);
  assert.equal(ctx.items()[0].text, "The grinder stopped working after a week");
});

test("rows: held-out rows cannot be removed, edited, copied, unmarked or created", () => {
  const cases = [
    [(items) => items.filter((_, index) => index !== 3), /remove held-out test row 4/],
    [(items) => items.filter((item) => !item.test), /held-out test rows 4, 11/],
    [(items) => items.map((item, index) => (index === 3 ? { ...item, input: "changed" } : item)), /must stay exactly as it is/],
    [(items) => items.map((item, index) => (index === 10 ? { ...item, image: "torn-bag" } : item)), /must stay exactly as it is/],
    [(items) => items.map((item, index) => (index === 3 ? { ...item, labels: { department: "billing" } } : item)), /must stay exactly as it is/],
    [(items) => items.map((item, index) => (index === 3 ? { ...item, ref: "held-2" } : item)), /Only Datasets' test split/],
    [(items) => items.map((item, index) => (index === 3 ? { ...item, labeled: [] } : item)), /labeled cannot be set/],
    [(items) => [...items, items[3]], /Held-out rows cannot be copied/],
    [(items) => items.map((item, index) => (index === 3 ? { ...item, test: false } : item)), /cannot become tuning rows/],
    [(items) => items.map((item, index) => (index === 3 ? { ...item, test: false, ref: null } : item)), /repeat the input of a held-out test row/],
    [(items) => items.map((item, index) => (index === 1 ? { ...item, test: true } : item)), /Only Datasets' test split/],
    [(items) => [...items, { input: "new", test: true }], /Only Datasets' test split/],
    [(items) => [...items, { input: "Love the new Ethiopia roast, thank you!" }], /repeat the input of a held-out test row/],
    [(items) => [...items, { input: { note: "Crushed corner on arrival" }, image: "crushed-box", labels: { wants_refund: false } }], /repeat the input of a held-out/],
  ];
  for (const [change, message] of cases) {
    const ctx = sampleBulkRowsCtx();
    assert.throws(() => ctx.actions.replaceItems(change(structuredClone(ctx.items()))), message);
    assert.deepEqual(ctx.calls, [], `${message} must not write`);
    assert.equal(ctx.state.rowsText, SAMPLE_BULK_ROWS_TEXT);
  }
});

test("rows: only the stored fields can be set; the read-only facts follow from them", () => {
  const ctx = sampleBulkRowsCtx();
  assert.throws(() => ctx.actions.replaceItems(edited(ctx, 2, { text: "Edited only the text" })), /Row 2: text cannot be set/);
  assert.throws(() => ctx.actions.replaceItems(edited(ctx, 1, { labeled: [], position: 3 })), /labeled, position cannot be set/);
  assert.deepEqual(ctx.calls, []);
  ctx.actions.replaceItems(edited(ctx, 2, { input: "Do you sell decaf beans?" }));
  assert.equal(ctx.items()[1].text, "Do you sell decaf beans?");
  assert.equal(ctx.items()[1].position, 2);
});

test("rows: invalid inputs, pictures and labels are refused with the row named", () => {
  const cases = [
    [{ input: "   " }, /Row 13: the input is blank/],
    [{ input: 42 }, /must be text, a JSON object or a JSON array/],
    [{ input: null }, /must be text, a JSON object or a JSON array/],
    [{ input: { text: "x", _expect: { q: 1 } } }, /may not hold _expect/],
    [{ input: { text: "x", _test: true } }, /may not hold _test/],
    [{ input: { text: "x", _image: "a" } }, /may not hold _image/],
    [{ input: { photo: "p" }, image: "torn-bag" }, /cannot also have its own photo field/],
    [{ input: {} }, /empty object/],
    [{ input: [1, 2], labels: { q: "a" } }, /cannot carry a picture or labels/],
    [{ input: "x", labels: "billing" }, /labels must be an object/],
    [{ input: "x", image: "" }, /image must be a picture name/],
  ];
  for (const [item, message] of cases) {
    const ctx = sampleBulkRowsCtx();
    assert.throws(() => ctx.actions.replaceItems([...structuredClone(ctx.items()), item]), message);
    assert.deepEqual(ctx.calls, []);
  }
  assert.throws(() => sampleBulkRowsCtx().actions.replaceItems("rows"), /whole list/);
  assert.throws(() => sampleBulkRowsCtx().actions.replaceItems([...sampleBulkRowsCtx().items(), 7]), /Row 13 is not a row object/);
});

test("rows: replaceItems refuses while table labels are unsettled, and Cancel on the discard confirm changes nothing", () => {
  const dirty = sampleBulkRowsCtx({ labelsDirty: true });
  assert.throws(() => dirty.actions.replaceItems(edited(dirty, 2, { labels: { department: "product" } })), /Keep labels in rows/);
  assert.deepEqual(dirty.calls, []);
  const cancel = sampleBulkRowsCtx({ approve: false });
  assert.throws(() => cancel.actions.replaceItems(edited(cancel, 2, { labels: { department: "product" } })), /Nothing changed/);
  assert.deepEqual(cancel.calls, [["confirmDiscard"]]);
  assert.equal(cancel.state.rowsText, SAMPLE_BULK_ROWS_TEXT);
});

test("rows: a JSON-array box stays an array; an array row turns a lines box into one", () => {
  const ctx = bulkRowsCtx({ rowsText: '[{"text": "a"}, "b", 5]', write: (text) => { ctx.written = text; } });
  ctx.actions.replaceItems([...structuredClone(ctx.items()), { input: "c", labels: { q: "x" } }]);
  assert.equal(ctx.written, '[\n{"text":"a"},\n"b",\n5,\n{"text":"c","_expect":{"q":"x"}}\n]');
  const lined = bulkRowsCtx({ rowsText: "one\ntwo", write: (text) => { lined.written = text; } });
  lined.actions.replaceItems([...structuredClone(lined.items()), { input: [1, "x"] }]);
  assert.equal(lined.written, '[\n"one",\n"two",\n[1,"x"]\n]');
});

test("rows: lines are written as the page's rowLineFor writes them", () => {
  const rowLineFor = new Function(`${body(bulkSource, "rowLineFor")}; return rowLineFor;`)();
  for (const input of ["plain", " lead", "tail ", "{looks like json", "[bracket", "two\nlines", "cr\rhere", "ünïcode ☕"]) {
    const ctx = bulkRowsCtx({ rowsText: "", write: (text) => { ctx.written = text; } });
    ctx.actions.replaceItems([{ input }]);
    assert.equal(ctx.written, rowLineFor(input), JSON.stringify(input));
    assert.deepEqual(bulkRowsCtx({ rowsText: ctx.written }).items()[0].text, input, "the row reads back as the same text");
  }
  const labeled = bulkRowsCtx({ rowsText: "", write: (text) => { labeled.written = text; } });
  labeled.actions.replaceItems([{ input: "hi", labels: { q: true } }]);
  assert.equal(labeled.written, rowLineFor("hi", { q: true }));
});

test("rows: importItems appends new tuning rows through the same guards", () => {
  const ctx = sampleBulkRowsCtx();
  const result = ctx.actions.importItems([{ input: "Is the Harbor House blend fair trade?", labels: { department: "product" } }, { ...ctx.items()[0] }], { label: "Paste" });
  assert.deepEqual(result, { changed: true, rows: 14 });
  assert.equal(ctx.calls.at(-1)[2], "Paste");
  assert.deepEqual(ctx.items().slice(-2).map((item) => item.text), ["Is the Harbor House blend fair trade?", "My order arrived with the bag torn and beans everywhere. Can I get a replacement?"]);
  assert.equal(ctx.state.rowsText.split("\n").at(-1), '{"text":"My order arrived with the bag torn and beans everywhere. Can I get a replacement?","_expect":{"department":"shipping","is_urgent":false,"wants_refund":true,"frustration":1}}');
  assert.throws(() => sampleBulkRowsCtx().actions.importItems([]), /nothing to import/);
  assert.throws(() => sampleBulkRowsCtx().actions.importItems([{ input: "x", test: true }]), /Imported row 1 is marked held out/);
  assert.throws(() => sampleBulkRowsCtx().actions.importItems([{ ...sampleBulkRowsCtx().items()[3] }]), /Imported row 1 is marked held out/);
  assert.throws(() => sampleBulkRowsCtx().actions.importItems(["text"]), /not a row object/);
  assert.throws(() => sampleBulkRowsCtx({ labelsDirty: true }).actions.importItems([{ input: "x" }]), /Keep labels in rows/);
});

test("rows: page operations go through, with focusRow's guards", () => {
  const ctx = sampleBulkRowsCtx();
  ctx.actions.checkHealth();
  ctx.actions.checkPreflight();
  ctx.actions.openCsvImport();
  ctx.actions.focusRow(5);
  ctx.refresh();
  assert.deepEqual(ctx.calls, [["checkHealth"], ["checkPreflight"], ["openCsvImport"], ["focusLine", 6], ["refresh"]]);
  assert.throws(() => ctx.actions.focusRow(13), /no row 13/);
  assert.throws(() => ctx.actions.focusRow("2"), /no row 2/);
  assert.throws(() => bulkRowsCtx({ rowsText: '["a"]', focusLine: () => {} }).actions.focusRow(1), /JSON array/);
  assert.throws(() => bulkRowsCtx({ rowsText: "a" }).actions.checkHealth(), /cannot do that here/);
  assert.throws(() => bulkRowsCtx({ rowsText: "a" }).actions.replaceItems([{ input: "b" }]), /cannot do that here/);
});

// ---------- workbench.bulk.results ----------

test("results: items carry status, hidden held-out answers, and answers in Calibrate's terms", () => {
  const ctx = sampleBulkResultsCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.status), ["answered", "answered", "answered", "failed", "answered", "skipped", "answered", "answered"]);
  assert.equal(items[3].error, "Rate limited: try again in a few seconds");
  assert.equal(items[3].answers, null);
  assert.equal(items[3].meta, null);
  const held = items[4];
  assert.equal(held.test, true);
  assert.equal(held.answers, null);
  assert.equal(held.labels, null);
  assert.equal(held.text, '{"text":"Seal was open when it arrived.","_image":"torn-bag"}');
  assert.deepEqual(held.input, { text: "Seal was open when it arrived." });
  assert.equal(held.image, "torn-bag");
  const first = items[0].answers;
  assert.deepEqual([first.department.value, first.department.predicted, first.department.p, first.department.confidence, first.department.agrees], ["shipping", "shipping", 0.88, 0.86, true]);
  assert.deepEqual([first.frustration.value, first.frustration.predicted, first.frustration.p, first.frustration.scale, first.frustration.label, first.frustration.agrees], [1.2, "1", 0.6, 2, "1", true]);
  assert.deepEqual([first.is_urgent.predicted, first.is_urgent.p, first.is_urgent.confidence, first.is_urgent.labelValid], ["no", 0.78, null, null]);
  assert.deepEqual(first.is_urgent.probabilities.map((entry) => entry.key), ["yes", "no"]);
  assert.deepEqual([first.seal_damage.value, first.seal_damage.predicted, first.seal_damage.p], [null, null, null]);
  assert.deepEqual(first.seal_damage.box, { left: 0.2, top: 0.2, right: 0.6, bottom: 0.5 });
  assert.equal(first.seal_damage.agrees, true, "IoU 0.75");
  assert.equal(items[1].answers.wants_refund.agrees, false);
  assert.equal(items[2].answers.department.agrees, false);
  assert.equal(items[2].answers.is_urgent.label, "yes");
  assert.equal(items[2].answers.is_urgent.agrees, true);
  assert.deepEqual([items[6].answers.department.labelValid, items[6].answers.department.label, items[6].answers.department.agrees], [false, null, null]);
  assert.equal(items[6].answers.is_urgent.predicted, "yes", "P(yes) 0.5 reads yes, as Calibrate reads it");
  assert.deepEqual(items[7].labels, { wants_refund: true });
  assert.equal(items[7].answers.wants_refund.agrees, true);
  assert.equal(items[7].meta.output_tokens, null);
  assert.deepEqual(items.map((item) => item.calCorrect), [true, true, false, null, null, null, null, null]);
  assert.equal(ctx.itemName(items[2], 2), "3");
});

test("results: Box labels that overlap too little disagree, and odd labels never throw", () => {
  const ctx = sampleBulkResultsCtx();
  const raw = ctx.state.result.results[1];
  ctx.state.labels = { ...ctx.state.labels, 1: { seal_damage: { left: 0, top: 0, right: 0.3, bottom: 0.3 }, frustration: "1.0", department: ["x"] } };
  const answers = ctx.items().find((item) => item.index === 1).answers;
  assert.equal(raw.answers.seal_damage.type, "box");
  assert.equal(answers.seal_damage.agrees, false);
  assert.equal(answers.frustration.label, "1");
  assert.equal(answers.frustration.agrees, false);
  assert.equal(answers.department.labelValid, false);
  ctx.state.labels = { 1: { frustration: " ", is_urgent: { odd: true }, seal_damage: { left: 0.5, top: 0, right: 0.4, bottom: 1 } } };
  const odd = ctx.items().find((item) => item.index === 1).answers;
  assert.deepEqual([odd.frustration.labelValid, odd.is_urgent.labelValid, odd.seal_damage.labelValid], [false, false, false]);
});

test("results: page order, Lab filters and Lab sort apply in that order", () => {
  const ctx = sampleBulkResultsCtx({ sort: { key: "__row", dir: -1 } });
  assert.deepEqual(ctx.items().map((item) => item.index), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(ctx.data.sort, { key: "__row", dir: "desc" });
  const lab = createLab([definePack({ id: "t", surface: "workbench.bulk.results", title: "T", features: [
    { id: "status", kind: "fact", type: "category", label: "status", value: (item) => item.status },
    { id: "refund", kind: "fact", type: "number", label: "refund probability", value: (item) => item.answers?.wants_refund?.value ?? null }] })]);
  const real = sampleBulkResultsCtx({ matches: (item, c) => lab.matches("workbench.bulk.results", item, c), arrange: (items, c) => lab.arrange("workbench.bulk.results", items, c) });
  assert.deepEqual(real.shown().map((item) => item.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  lab.view("workbench.bulk.results").filters = [{ key: "t/refund", op: "min", value: "0.9" }];
  assert.deepEqual(real.shown().map((item) => item.index), [0, 2, 7], "the held-out row's hidden 0.7 can never match");
  lab.view("workbench.bulk.results").sort = { key: "t/refund", dir: "asc" };
  assert.deepEqual(real.shown().map((item) => item.index), [0, 7, 2]);
  lab.view("workbench.bulk.results").filters = [{ key: "t/status", op: "is", value: "skipped" }];
  lab.view("workbench.bulk.results").sort = null;
  assert.deepEqual(real.shown().map((item) => item.index), [5]);
});

test("results: items stay the same objects until their labels or Calibrate's verdict change", () => {
  const ctx = sampleBulkResultsCtx();
  const before = ctx.items();
  assert.equal(ctx.items()[0], before[0]);
  ctx.state.labels = { ...ctx.state.labels, 7: { wants_refund: false } };
  const after = ctx.items();
  assert.equal(after[0], before[0]);
  assert.notEqual(after[7], before[7]);
  assert.equal(after[7].answers.wants_refund.agrees, false);
  ctx.state.calReport = null;
  assert.equal(ctx.items()[0].calCorrect, null);
});

test("results: data is the measured run, null-safe before any run", () => {
  const ctx = sampleBulkResultsCtx();
  assert.deepEqual({ ...ctx.data.run }, { rows: 8, completed: 6, failed: 1, skipped: 1, held_out: 1, wall_ms: 2140, input_tokens: 5130, cost_usd: 0.000216,
    model: "jev-latest", requested_model: "jev-latest", stopped: null, retry_error: null });
  assert.deepEqual([...ctx.data.questionIds], ["department", "frustration", "is_urgent", "wants_refund", "seal_damage"]);
  assert.equal(ctx.data.calQuestion, "department");
  assert.equal(ctx.data.labelsDirty, true);
  assert.equal(ctx.data.sort, null);
  const empty = sampleBulkResultsCtx({ result: null });
  assert.deepEqual(empty.items(), []);
  assert.deepEqual(empty.shown(), []);
  assert.equal(empty.data.run, null);
  assert.deepEqual(empty.data.questions, {});
  assert.deepEqual([...empty.data.questionIds], []);
  assert.equal(empty.data.calQuestion, null);
  assert.deepEqual(bulkResultsCtx().items(), []);
});

test("results: actions keep their guards", () => {
  const ctx = sampleBulkResultsCtx();
  ctx.actions.sortBy("wants_refund", "asc");
  ctx.actions.sortBy("__row");
  ctx.actions.keepLabels();
  ctx.actions.downloadCsv();
  ctx.actions.focusRow(4);
  assert.deepEqual(ctx.calls, [["sortBy", "wants_refund", 1], ["sortBy", "__row", -1], ["keepLabels"], ["downloadCsv"], ["focusRow", 4]]);
  assert.throws(() => ctx.actions.sortBy("refund"), /no column refund/);
  assert.throws(() => ctx.actions.sortBy("department", "up"), /asc or desc/);
  const hidden = sampleBulkResultsCtx({ matches: (item) => item.index !== 2 });
  assert.throws(() => hidden.actions.focusRow(2), /Row 3 is not shown/);
  assert.throws(() => hidden.actions.focusRow(99), /Row 100 is not shown/);
  const empty = sampleBulkResultsCtx({ result: null });
  for (const run of [() => empty.actions.sortBy("__row"), () => empty.actions.keepLabels(), () => empty.actions.downloadCsv()]) assert.throws(run, /Run Bulk first/);
  assert.deepEqual(empty.calls, []);
});

test("results: text matches the page's rowText", () => {
  const rowText = new Function(`${body(bulkSource, "rowText")}; return rowText;`)();
  const ctx = sampleBulkResultsCtx();
  for (const row of ["plain", { text: "only text" }, { text: "t", _test: true }, { text: "t", _image: "torn-bag" }, [1, 2], { a: 1 }]) {
    ctx.state.result = { ...ctx.state.result, results: [{ index: 0, row, skipped: true }] };
    assert.equal(ctx.items()[0].text, rowText(row), JSON.stringify(row));
  }
});

// ---------- page hooks ----------

const resultsPack = definePack({ id: "t", surface: "workbench.bulk.results", title: "T", features: [
  { id: "status", kind: "fact", type: "category", label: "status", value: (item) => item.status },
  { id: "count", kind: "metric", label: "Rows in the run", compute: (ctx) => (ctx.items().length || null) }] });
const rowsPack = definePack({ id: "r", surface: "workbench.bulk.rows", title: "R", features: [
  { id: "held", kind: "fact", type: "flag", label: "held-out marker", value: (item) => item.test },
  { id: "upper", kind: "transform", label: "Uppercase text rows", each: (item) => (typeof item.input === "string" ? { ...item, input: item.input.toUpperCase() } : null) },
  { id: "drop_unlabeled", kind: "transform", label: "Drop unlabeled tuning rows", all: (items) => items.filter((item) => item.test || Object.keys(item.labels).length) }] });

// The results table body, rebuilt from the page source with stand-ins.
function tableHarness({ lab = null, sortKey = null, sortDir = -1 } = {}) {
  const fixture = sampleBulkResultsCtx();
  const W = { bulk: { result: fixture.state.result, sortKey, sortDir, labels: {}, cal: { qid: null, report: null }, pictures: {}, runRequest: null },
    lab, labEnv: fakeEnv() };
  const renders = [];
  const fns = ["bulkTableOrder", "bulkTableBody", "bulkResultsLab", "bulkLabSection"].map((name) => body(bulkSource, name)).join("\n");
  const isTest = (r) => !!r.row && typeof r.row === "object" && !Array.isArray(r.row) && r.row._test === true;
  const api = new Function("W", "h", "render", "isTest", "rowText", "cellValue", "labelCell", "statusBadge", "pct", "bulkQuestionsForResult", "$", "mount",
    "keepLabels", "downloadBulkCsv",
    `const bulkVisibleAnswers = (r) => (isTest(r) ? null : r.answers);
     const BULK_RESULTS_LAB = "workbench.bulk.results"; const bulkLabCtxs = {};
     ${fns}; return { bulkTableBody, bulkTableOrder, bulkResultsLab, bulkLabSection };`)(
    W, h, () => renders.push("render"), isTest, (row) => JSON.stringify(row),
    (answers, qid) => (answers?.[qid] ? { sort: answers[qid].noul ?? answers[qid].score ?? 0, text: String(answers[qid].noul ?? answers[qid].choice ?? "") } : { sort: -1, text: "" }),
    () => h("td", {}), () => "", (value) => String(value), (res) => res.results.find((r) => r.answers).answers, () => null, () => {}, () => {}, () => {});
  const shownRows = () => findAll({ children: api.bulkTableBody() }, (node) => node.tag === "tr" && node.attrs["data-index"] !== undefined).map((node) => Number(node.attrs["data-index"]));
  return { W, api, renders, shownRows };
}

test("hook: without Lab builders the table is exactly the page's own sorted list", () => {
  const plain = tableHarness({ sortKey: "wants_refund", sortDir: -1 });
  assert.equal(plain.api.bulkResultsLab(), null);
  assert.equal(plain.api.bulkLabSection("workbench.bulk.results", null), null);
  assert.deepEqual(plain.shownRows(), [2, 7, 0, 1, 6, 3, 4, 5], "descending refund probability; held-out and unanswered rows sort as -1, as before");
  assert.ok(!textOf({ children: plain.api.bulkTableBody() }).includes("Lab"));
});

test("hook: with Lab, no active setting changes nothing; a filter hides rows, says so and resets", () => {
  const lab = createLab([resultsPack], { bulkResultsCtx });
  const x = tableHarness({ lab, sortKey: "wants_refund", sortDir: -1 });
  assert.deepEqual(x.shownRows(), [2, 7, 0, 1, 6, 3, 4, 5]);
  const section = x.api.bulkLabSection("workbench.bulk.results", x.api.bulkResultsLab());
  assert.equal(section.attrs["data-lab-surface"], "workbench.bulk.results");
  assert.equal(x.api.bulkResultsLab(), x.api.bulkResultsLab(), "one ctx per page session");
  lab.view("workbench.bulk.results").filters = [{ key: "t/status", op: "is", value: "answered" }];
  assert.deepEqual(x.shownRows(), [2, 7, 0, 1, 6, 4], "the page's sort, minus what the Lab filter hides");
  const note = find({ children: x.api.bulkTableBody() }, (node) => node.tag === "p" && node.attrs.role === "status");
  assert.match(textOf(note), /Showing 6 of 8 rows · 1 Lab setting active/);
  lab.view("workbench.bulk.results").filters = [{ key: "t/status", op: "is", value: "nothing" }];
  const empty = { children: x.api.bulkTableBody() };
  assert.ok(textOf(empty).includes("No row matches the Lab filters."));
  find(empty, (node) => node.tag === "button" && textOf(node) === "Clear Lab filters and sort").attrs.onclick();
  assert.equal(lab.active("workbench.bulk.results"), 0);
  assert.deepEqual(x.renders, ["render"]);
  assert.deepEqual(x.shownRows(), [2, 7, 0, 1, 6, 3, 4, 5]);
});

test("hook: the results ctx actions reach the page's own sort", () => {
  const lab = createLab([resultsPack], { bulkResultsCtx });
  const x = tableHarness({ lab });
  x.api.bulkResultsLab().actions.sortBy("__row", "desc");
  assert.deepEqual([x.W.bulk.sortKey, x.W.bulk.sortDir], ["__row", -1]);
  assert.deepEqual(x.renders, ["render"]);
  assert.deepEqual(x.shownRows(), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(x.api.bulkResultsLab().data.sort, { key: "__row", dir: "desc" });
});

// The rows box hooks, rebuilt from the page source with stand-ins.
function rowsHarness({ lab = null, approveRepairs = true, drafts = false, approveDrafts = true } = {}) {
  const W = { bulk: { rowsText: SAMPLE_BULK_ROWS_TEXT, source: "current", dataset: { id: null, name: "" }, labelsDirty: false, running: false,
    health: { context: "now", report: { rows: 12 } } }, lab, labEnv: fakeEnv() };
  const log = [];
  const fns = ["bulkRowsLab", "bulkLabWriteRows", "bulkRowsLabNote", "bulkLabSection"].map((name) => body(bulkSource, name)).join("\n");
  const api = new Function("W", "h", "$", "mount", "render", "toast", "confirm", "markUnsaved", "bulkQuestions", "questionEditorError", "bulkUnsaved",
    "healthContext", "bulkPreflightReport", "confirmDatasetEditsDiscard", "preparedLabelsUnsaved", "checkHealth", "checkBulkInputs", "focusBulkRowLine",
    `const BULK_ROWS_LAB = "workbench.bulk.rows"; const bulkLabCtxs = {}; ${fns}; return { bulkRowsLab, bulkLabWriteRows, bulkRowsLabNote, bulkLabSection };`)(
    W, h, () => null, () => {}, () => log.push("render"), (message) => log.push(`toast:${message}`),
    (message) => { log.push(`confirm:${message.slice(0, 30)}`); return approveDrafts; }, () => log.push("markUnsaved"),
    () => ({ q: { type: "noul", instructions: "Q?" } }), () => null, () => false, () => "now", () => null,
    () => { log.push("repairs?"); return approveRepairs; }, () => drafts, () => log.push("checkHealth"), () => log.push("checkBulkInputs"), () => {});
  return { W, api, log };
}

test("hook: the rows ctx is built from W.lab.builders once, and is null without them", () => {
  assert.equal(rowsHarness().api.bulkRowsLab(), null);
  assert.equal(rowsHarness().api.bulkRowsLabNote(), null);
  const x = rowsHarness({ lab: createLab([rowsPack], { bulkRowsCtx }) });
  const ctx = x.api.bulkRowsLab();
  assert.equal(x.api.bulkRowsLab(), ctx);
  assert.equal(ctx.items().length, 12);
  assert.deepEqual(ctx.data.health, { rows: 12 });
  assert.deepEqual(Object.keys(ctx.data.questions), ["q"]);
  ctx.actions.checkHealth();
  ctx.actions.checkPreflight();
  assert.deepEqual(x.log, ["checkHealth", "checkBulkInputs"]);
  assert.equal(x.api.bulkRowsLabNote(), null, "no Lab setting active: no note");
});

test("hook: a Lab edit takes the typing path, after the page's discard questions", async () => {
  const x = rowsHarness({ lab: createLab([rowsPack], { bulkRowsCtx }), drafts: true });
  const ctx = x.api.bulkRowsLab();
  ctx.actions.replaceItems(ctx.items().map((item) => (item.position === 2 ? { ...item, input: "DECAF?" } : item)), { label: "Uppercase" });
  assert.equal(x.W.bulk.rowsText.split("\n")[1], "DECAF?");
  assert.deepEqual(x.log, ["repairs?", "confirm:This edit changes the rows box", "markUnsaved", "toast:Uppercase: the rows box changed. Save the dataset to keep it."]);
  await Promise.resolve();
  assert.equal(x.log.at(-1), "render", "the page renders after Lab has recorded its Undo step");
  for (const [options, asked] of [[{ approveRepairs: false }, ["repairs?"]], [{ drafts: true, approveDrafts: false }, ["repairs?", "confirm:This edit changes the rows box"]]]) {
    const y = rowsHarness({ lab: createLab([rowsPack], { bulkRowsCtx }), ...options });
    const rows = y.api.bulkRowsLab();
    assert.throws(() => rows.actions.replaceItems(rows.items().map((item) => (item.position === 2 ? { ...item, input: "DECAF?" } : item))), /Nothing changed/);
    assert.equal(y.W.bulk.rowsText, SAMPLE_BULK_ROWS_TEXT);
    assert.deepEqual(y.log, asked);
  }
});

test("hook: the rows note lists the matching rows while a Lab filter is active, and clears it", () => {
  const lab = createLab([rowsPack], { bulkRowsCtx });
  const x = rowsHarness({ lab });
  lab.view("workbench.bulk.rows").filters = [{ key: "r/held", op: "with" }];
  const note = x.api.bulkRowsLabNote();
  assert.match(textOf(note), /1 Lab setting active: 2 of 12 rows match \(rows 4, 11\)/);
  find(note, (node) => node.tag === "button").attrs.onclick();
  assert.equal(lab.active("workbench.bulk.rows"), 0);
  assert.deepEqual(x.log, ["render"]);
  const section = x.api.bulkLabSection("workbench.bulk.rows", x.api.bulkRowsLab());
  assert.equal(section.attrs["data-lab-surface"], "workbench.bulk.rows");
});

test("hook: a Lab per-item edit through the section changes the shown rows only, and undoes", async () => {
  const lab = createLab([rowsPack], { bulkRowsCtx });
  const x = rowsHarness({ lab });
  x.W.bulk.rowsText = "decaf?\n{\"text\": \"keep\", \"_test\": true}\nbeans";
  lab.view("workbench.bulk.rows").filters = [{ key: "r/held", op: "without" }];
  const ctx = x.api.bulkRowsLab();
  const view = lab.view("workbench.bulk.rows");
  view.open.section = view.open.transforms = true;
  view.transform.key = "r/upper";
  const env = fakeEnv();
  const tree = lab.section(env, "workbench.bulk.rows", ctx);
  const original = x.W.bulk.rowsText;
  find(tree, (node) => node.tag === "button" && textOf(node) === "Preview edit").attrs.onclick();
  assert.match(textOf(tree), /2 items would change \(positions 1, 3\)/);
  find(tree, (node) => node.tag === "button" && textOf(node) === "Apply previewed edit").attrs.onclick();
  assert.equal(x.W.bulk.rowsText, 'DECAF?\n{"text": "keep", "_test": true}\nBEANS');
  await Promise.resolve();
  assert.equal(x.log.filter((entry) => entry === "render").length, 1);
  const rendered = lab.section(env, "workbench.bulk.rows", ctx);  // what the page's deferred render shows
  assert.ok(!textOf(rendered).includes("Apply previewed edit"), "the applied preview is gone");
  find(rendered, (node) => node.tag === "button" && textOf(node) === "Undo: Uppercase text rows").attrs.onclick();
  assert.equal(x.W.bulk.rowsText, original, "one-step Undo restores the box exactly");
  assert.ok(!textOf(tree).includes("changed after this edit"));
  // A whole-list edit that removes rows also undoes.
  view.transform = { key: "r/drop_unlabeled", values: {}, preview: null, undo: null, error: "" };
  lab.view("workbench.bulk.rows").filters = [];
  x.W.bulk.rowsText = 'keep me\n{"text": "labeled", "_expect": {"q": true}}\n{"text": "held", "_test": true}\n\nalso drop';
  const again = lab.section(env, "workbench.bulk.rows", ctx);
  find(again, (node) => node.tag === "button" && textOf(node) === "Preview edit").attrs.onclick();
  find(again, (node) => node.tag === "button" && textOf(node) === "Apply previewed edit").attrs.onclick();
  assert.equal(x.W.bulk.rowsText, '{"text": "labeled", "_expect": {"q": true}}\n{"text": "held", "_test": true}');
  find(again, (node) => node.tag === "button" && textOf(node) === "Undo: Drop unlabeled tuning rows").attrs.onclick();
  assert.equal(x.W.bulk.rowsText, 'keep me\n{"text": "labeled", "_expect": {"q": true}}\n{"text": "held", "_test": true}\nalso drop', "the blank line is not kept");
});

test("hook: Bulk preflight shows Lab notes as advisory, and a run never confirms because of them", async () => {
  const W = { bulk: { rowsText: "a", labelsDirty: false, source: "sample" } };
  const report = { rows: 1, findings: [], held_out: 0, lab: [{ row: 1, question: "q", code: "p/f", message: "Looks short." }] };
  const mod = new Function("W", "api", "h", "handleError", "bulkQuestions", "rowsPayload", "settleLabels", "questionEditorError", "render",
    `${preflightSource.replace(/^import .*;\n/gm, "").replace(/^export /gm, "")}; return { checkBulkPreflight, bulkPreflightBody, bulkPreflightReport, checkBulkInputs };`)(
    W, async () => report, h, (e) => { throw e; }, () => ({}), () => "a", () => true, () => null, () => {});
  assert.equal(mod.bulkPreflightReport(), null);
  await mod.checkBulkInputs();
  assert.equal(mod.bulkPreflightReport(), report);
  const tree = mod.bulkPreflightBody();
  const notes = find(tree, (node) => node.attrs?.["data-lab"] === "preflight-notes");
  assert.match(textOf(notes), /Advisory notes · 1/);
  assert.match(textOf(notes), /Row 1 · q: Looks short\./);
  assert.match(textOf(tree), /1 inputs checked · 0 findings/);
  W.bulk.rowsText = "b";
  assert.equal(mod.bulkPreflightReport(), null, "an edited box hides the old report");
  assert.equal(find(mod.bulkPreflightBody(), (node) => node.attrs?.["data-lab"] === "preflight-notes"), null);
  // runBulk confirms on findings only: Lab notes never ask.
  const runBody = body(bulkSource, "runBulk");
  const state = { bulk: { source: "sample", result: null } };
  const asked = [];
  globalThis.confirm = (message) => { asked.push(message); return true; };
  try {
    const run = new Function("W", "questionEditorError", "bulkQuestions", "settleLabels", "bulkRequestSnapshot", "bulkRetryContext",
      "checkBulkPreflight", "confirmSpend", "$", "updateBulkRetry", "api", "toast", "render", "handleError", `${runBody}; return runBulk;`)(
      state, () => null, () => ({ q: {} }), () => true, () => ({ rows: ["a"], questions: { q: {} }, model: "jev-latest" }), () => "same",
      async () => report, async () => false, () => null, () => {}, async () => assert.fail("no paid call"), () => {}, () => {}, (e) => { throw e; });
    await run();
  } finally { delete globalThis.confirm; }
  assert.deepEqual(asked, []);
});

test("hook: dataset health shows the Lab findings as Additional findings, with row numbers only", () => {
  const renderer = body(importSource, "healthBody");
  const slices = body(importSource, "healthSlices");
  const W = { bulk: { health: { busy: false, context: "now", field: null, report: { rows: 3, unique_inputs: 3, duplicate_groups: [], conflicts: [], overlap: [],
    questions: [], invalid_labels: [], lab: [{ code: "p/a", title: "Very short inputs", rows: [1, 3], message: "2 rows have fewer than six words." },
      { code: "p/b", title: "Mixed languages", rows: [], message: "Mixed languages" }] } } } };
  const healthBody = new Function("W", "healthContext", "checkHealth", "h", `${slices}; ${renderer}; return healthBody;`)(W, () => "now", () => {}, h);
  const block = find(healthBody(), (node) => node.attrs?.["data-lab"] === "health-findings");
  assert.match(textOf(block), /Additional findings/);
  assert.deepEqual(findAll(block, (node) => node.tag === "li").map(textOf), ["Very short inputs · rows 1, 3: 2 rows have fewer than six words.", "Mixed languages"]);
  W.bulk.health.report.lab = [];
  assert.equal(find(healthBody(), (node) => node.attrs?.["data-lab"] === "health-findings"), null);
  delete W.bulk.health.report.lab;
  assert.equal(find(healthBody(), (node) => node.attrs?.["data-lab"] === "health-findings"), null, "an older server without lab findings");
});
