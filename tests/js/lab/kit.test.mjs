// The Lab framework itself: the pack contract and engines (static/js/lab/kit.js), the host (host.js), the generic
// controls (ui.js) and the test harness that every pack test uses. Run with: node --test tests/js/lab/
import assert from "node:assert/strict";
import { test } from "node:test";

import { FACT_OPS, applyTransform, csvCell, csvText, definePack, describeFilter, describePreview, factValue, factsTable, filterMatches, formatValue,
  improvementsOf, keysMatch, matchesFilters, parseKeys, previewChanges, previewTransform, readInputs, runDiagnostics, runExporter, runImporter,
  runMetrics, runTool, searchCommands, sortByFact, summarizeFact, toNumber, typingTarget, undoTransform } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";
import { renderPalette, resultText } from "../../../static/js/lab/ui.js";
import pack, { fixtureItems } from "./fixture-pack.mjs";
import { byText, checkPack, fakeCtx, fakeEnv, find, findAll, fire, nodes, textOf } from "./harness.mjs";

const feature = (id) => pack.features.find((entry) => entry.id === id);
const key = (id) => `fixture-pack/${id}`;
const facts = new Map(pack.features.filter((entry) => entry.kind === "fact").map((entry) => [key(entry.id), entry]));

// The harness itself, on a pack with one feature of every kind: one test per improvement.
const improvements = checkPack(pack, {
  words: { items: fixtureItems(), values: [3, 5, null, 3] },
  urgent: { items: fixtureItems(), values: [true, false, false, false] },
  text: { items: fixtureItems(), values: ["Refund the order", "Where is my parcel today", "", "Refund and cancel"] },
  tag: { items: fixtureItems(), values: ["billing", "shipping", null, "billing"] },
  empty_text: { hit: { text: "" }, miss: { text: "x" }, message: /Empty text/ },
  one_tag: { hitList: [{ tag: "a" }, { tag: "a" }, { tag: null }], missList: [{ tag: "a" }, { tag: "b" }], message: /same tag/ },
  upper: { input: [{ text: "a" }, { text: "" }, { text: "c" }], shown: [0, 1], output: [{ text: "A" }, { text: "" }, { text: "c" }], unchanged: [{ text: "" }] },
  keep_first: { input: [{ id: 1 }, { id: 2 }, { id: 3 }], params: { count: "1" }, output: [{ id: 1 }], rejects: [{ params: { count: "0" }, message: /at least 1/ }] },
  urgent_share: { ctx: fakeCtx({ items: fixtureItems() }), expect: 0.25, empty: fakeCtx({}) },
  ids_csv: { ctx: fakeCtx({ items: fixtureItems(), shown: fixtureItems().slice(0, 2) }), text: '"id"\r\n"a"\r\n"b"\r\n', excludes: ["Refund"], filename: "ids.csv" },
  lines: { text: " one two \n\nthree", items: [{ id: "new-1", text: "one two", words: 2, tag: null, urgent: false }, { id: "new-2", text: "three", words: 1, tag: null, urgent: false }],
    warnings: 0, rejects: ["", " \n "] },
  clear: { ctx: () => { const ctx = fakeCtx({ items: fixtureItems() }); ctx.actions.replaceItems = (next) => { ctx.list = next; }; return ctx; },
    check: (ctx) => assert.deepEqual(ctx.items(), []), hidden: () => fakeCtx({}) },
  double: { values: { x: "2.5" }, expect: [["Double", 5]], more: [{ values: { x: 0 }, expect: [["Double", 0]] }], invalid: [{ x: "" }, { x: "-1" }, { x: "two" }] },
  counter: { improvements: {
    count: (t) => { const tree = t.render(t.fakeCtx({})); t.fire(t.find(tree, (node) => node.attrs.class === "more"), "click"); assert.equal(t.state.count, 1); },
    reset: (t) => { t.state.count = 4; const tree = t.render(t.fakeCtx({})); t.fire(t.find(tree, (node) => node.attrs.class === "reset"), "click"); assert.equal(t.state.count, 0); },
  } },
  skip_link: { check: () => assert.ok(true) },
}, { ctx: () => fakeCtx({ items: fixtureItems() }) });

test("a pack's improvements: numeric facts are three, flags one, text two, categories two, panels as listed, the rest one", () => {
  assert.equal(improvements.length, 3 + 1 + 2 + 2 + 2 + 2 + 1 + 1 + 1 + 1 + 1 + 2 + 1);
  assert.deepEqual(improvements.slice(0, 4).map((item) => item.id), ["fixture-pack/words.min", "fixture-pack/words.max", "fixture-pack/words.sort", "fixture-pack/urgent"]);
  assert.equal(new Set(improvements.map((item) => item.id)).size, improvements.length);
  assert.ok(improvements.every((item) => item.pack === "fixture-pack" && item.surface === "test.list" && item.title));
  assert.equal(improvements.find((item) => item.id === "fixture-pack/clear").title, "Command: Clear the list (Alt+Shift+X)");
  assert.deepEqual(improvements.filter((item) => item.kind === "panel").map((item) => item.title), ["Count clicks in a panel", "Reset the panel count"]);
});

test("definePack rejects malformed packs and names the feature at fault", () => {
  const good = { id: "p", surface: "s", title: "T", features: [{ id: "f", kind: "fact", type: "number", label: "L", value: () => 1 }] };
  assert.ok(Object.isFrozen(definePack(good)) && Object.isFrozen(definePack(good).features[0]));
  const bad = (change, message) => assert.throws(() => definePack(change(JSON.parse(JSON.stringify(good), (k, v) => v), good)), message);
  bad((p) => ({ ...p, id: "Bad_Id", features: good.features }), /id must be lowercase/);
  bad((p) => ({ ...p, surface: " ", features: good.features }), /surface is required/);
  bad((p) => ({ ...p, features: [] }), /nonempty array/);
  bad((p) => ({ ...p, features: [{ ...good.features[0], id: "Bad-Id" }] }), /feature Bad-Id: id must be/);
  bad((p) => ({ ...p, features: [good.features[0], good.features[0]] }), /feature f: declared twice/);
  bad((p) => ({ ...p, features: [{ ...good.features[0], kind: "widget" }] }), /unknown kind/);
  bad((p) => ({ ...p, features: [{ ...good.features[0], type: "date" }] }), /missing a required field/);
  bad((p) => ({ ...p, features: [{ id: "t", kind: "transform", label: "Both", each: () => null, all: () => [] }] }), /missing a required field/);
  bad((p) => ({ ...p, features: [{ id: "t", kind: "tool", title: "T", group: "G", help: "H", compute: () => [], inputs: [{ name: "x", label: "X", type: "date" }] }] }), /unknown type/);
  bad((p) => ({ ...p, features: [{ id: "t", kind: "tool", title: "T", group: "G", help: "H", compute: () => [], inputs: [{ name: "x", label: "X", type: "select" }] }] }), /needs options/);
  bad((p) => ({ ...p, features: [{ id: "t", kind: "panel", title: "T", render: () => null, improvements: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }] }), /missing a required field/);
  assert.throws(() => definePack(null), /expected an object/);
});

test("numeric bounds: unavailable values never match, blank is no filter, and a non-number matches nothing", () => {
  const items = fixtureItems(), words = feature("words");
  const picked = (filter) => items.filter((item) => filterMatches(words, filter, item)).map((item) => item.id);
  assert.deepEqual(picked({ op: "min", value: "3" }), ["a", "b", "d"]);
  assert.deepEqual(picked({ op: "min", value: "3.5" }), ["b"]);
  assert.deepEqual(picked({ op: "max", value: "4" }), ["a", "d"]);
  assert.deepEqual(picked({ op: "max", value: " " }), ["a", "b", "c", "d"]);
  for (const value of ["x", "Infinity", "0x10", "1,5", "--1"]) assert.deepEqual(picked({ op: "min", value }), [], value);
  assert.deepEqual(picked({ op: "contains", value: "3" }), [], "an operator of another fact type matches nothing");
  assert.deepEqual([toNumber("1e2"), toNumber("-.5"), toNumber("+3."), toNumber(""), toNumber(NaN), toNumber(7)], [100, -0.5, 3, null, null, 7]);
});

test("flag, text and category filters; unknown facts are ignored; a throwing fact reads as unavailable", () => {
  const items = fixtureItems();
  const pick = (filters) => items.filter((item) => matchesFilters(item, filters, facts)).map((item) => item.id);
  assert.deepEqual(pick([{ key: key("urgent"), op: "with" }]), ["a"]);
  assert.deepEqual(pick([{ key: key("urgent"), op: "without" }]), ["b", "c", "d"]);
  assert.deepEqual(pick([{ key: key("text"), op: "contains", value: " REFUND " }]), ["a", "d"]);
  assert.deepEqual(pick([{ key: key("text"), op: "contains", value: ".*" }]), [], "text matching is literal, not a regular expression");
  assert.deepEqual(pick([{ key: key("tag"), op: "is", value: "billing" }, { key: key("words"), op: "max", value: "3" }]), ["a", "d"]);
  assert.deepEqual(pick([{ key: key("tag"), op: "is", value: "Billing" }]), []);
  assert.deepEqual(pick([{ key: "gone/fact", op: "min", value: "99" }]), ["a", "b", "c", "d"]);
  const broken = { type: "number", label: "broken", value: () => { throw new Error("no"); } };
  assert.equal(factValue(broken, {}), null);
  assert.equal(factValue({ type: "number", value: () => NaN }, {}), null);
  assert.equal(factValue({ type: "flag", value: () => "yes" }, {}), false);
  assert.equal(factValue({ type: "category", value: () => "" }, {}), null);
  assert.deepEqual(Object.keys(FACT_OPS), ["number", "flag", "text", "category"]);
  assert.equal(describeFilter(feature("words"), { op: "min", value: " 3 " }), "word count ≥ 3");
  assert.equal(describeFilter(feature("urgent"), { op: "without" }), "without urgent marker");
});

test("sorting is stable, puts unavailable values last in both directions, and leaves the input alone", () => {
  const items = fixtureItems();
  const order = (id, dir) => sortByFact(items, { key: key(id), dir }, facts).map((item) => item.id);
  assert.deepEqual(order("words", "asc"), ["a", "d", "b", "c"]);
  assert.deepEqual(order("words", "desc"), ["b", "a", "d", "c"]);
  assert.deepEqual(order("text", "asc"), ["d", "a", "b", "c"]);
  assert.deepEqual(order("text", "desc"), ["b", "a", "d", "c"]);
  assert.deepEqual(order("tag", "asc"), ["a", "d", "b", "c"]);
  assert.deepEqual(order("urgent", "desc"), ["a", "b", "c", "d"]);
  assert.deepEqual(sortByFact(items, { key: "gone/fact", dir: "asc" }, facts), items);
  assert.deepEqual(items.map((item) => item.id), ["a", "b", "c", "d"]);
});

test("summaries by fact type and the facts table", () => {
  const items = fixtureItems();
  assert.deepEqual(summarizeFact(feature("words"), items), { type: "number", count: 3, missing: 1, min: 3, max: 5, sum: 11, mean: 11 / 3, median: 3 });
  assert.deepEqual(summarizeFact(feature("words"), [items[2]]), { type: "number", count: 0, missing: 1, min: null, max: null, sum: null, mean: null, median: null });
  assert.equal(summarizeFact(feature("words"), [items[0], items[1]]).median, 4);
  assert.deepEqual(summarizeFact(feature("urgent"), items), { type: "flag", with: 1, without: 3 });
  assert.deepEqual(summarizeFact(feature("text"), items), { type: "text", filled: 3, empty: 1, distinct: 3 });
  assert.deepEqual(summarizeFact(feature("tag"), items), { type: "category", groups: [["billing", 2], ["shipping", 1]], missing: 1 });
  const table = factsTable([...facts], items, undefined, (item) => item.id);
  assert.deepEqual(table.columns, ["item", "word count", "urgent marker", "text", "tag"]);
  assert.deepEqual(table.rows[2], ["c", "", "no", "", ""]);
  assert.deepEqual(table.rows[0], ["a", 3, "yes", "Refund the order", "billing"]);
});

test("CSV cells are quoted and spreadsheet formulas are defused", () => {
  assert.equal(csvCell('a "b"'), '"a ""b"""');
  for (const text of ["=1+1", "+1", "-1", "@x", " =x", "\tx"]) assert.equal(csvCell(text), `"'${text}"`);
  assert.equal(csvCell(null), '""');
  assert.equal(csvText([["a", 1], ["b", "=2"]]), '"a","1"\r\n"b","\'=2"\r\n');
  assert.deepEqual([formatValue(0.256, "percent"), formatValue(1234.5, "integer"), formatValue(null), formatValue(0.5, "usd"), formatValue(0.00042, "usd"),
    formatValue(12.3456789), formatValue(1500.26), formatValue(0.0000123), formatValue(41.6, "ms"), formatValue("x"), formatValue(NaN)],
  ["25.6%", "1,235", "—", "$0.50", "$0.00042", "12.346", "1500.3", "1.230e-5", "42 ms", "x", "—"]);
});

test("diagnostics report per item or for the list, and a throwing check reports nothing", () => {
  const entries = [[key("empty_text"), feature("empty_text")], [key("one_tag"), feature("one_tag")],
    ["x/boom", { label: "Boom", check: () => { throw new Error("no"); } }], ["x/many", { label: "Many", severity: "info", check: () => ["one", "", "two"] }]];
  const findings = runDiagnostics(entries, [{ text: "", tag: "a" }, { text: "x", tag: "a" }], {});
  assert.deepEqual(findings.map((finding) => [finding.key, finding.index, finding.severity, finding.message]), [
    [key("empty_text"), 0, "problem", "Empty text"], [key("one_tag"), null, "advice", "Every tagged item has the same tag."],
    ["x/many", 0, "info", "one"], ["x/many", 0, "info", "two"], ["x/many", 1, "info", "one"], ["x/many", 1, "info", "two"]]);
});

test("typed inputs apply defaults, coerce, and explain what is wrong", () => {
  const inputs = [{ name: "n", label: "Count", type: "integer", min: 1, max: 9, default: 2 }, { name: "p", label: "Rate", type: "number", optional: true },
    { name: "mode", label: "Mode", type: "select", options: [["a", "A"], "b"] }, { name: "on", label: "On", type: "checkbox", default: true },
    { name: "note", label: "Note", type: "text" }, { name: "body", label: "Body", type: "textarea", required: true }];
  assert.deepEqual(readInputs(inputs, { body: "x" }), { n: 2, p: null, mode: "a", on: true, note: "", body: "x" });
  assert.deepEqual(readInputs(inputs, { n: "7", p: "0.5", mode: "b", on: false, note: " hi ", body: "x" }), { n: 7, p: 0.5, mode: "b", on: false, note: " hi ", body: "x" });
  for (const [values, message] of [[{ n: "1.5", body: "x" }, /whole number/], [{ n: "0", body: "x" }, /at least 1/], [{ n: "10", body: "x" }, /at most 9/],
    [{ n: "x", body: "x" }, /must be a number/], [{ mode: "c", body: "x" }, /listed options/], [{ body: " " }, /Body is required/],
    [{ n: "", body: "x" }, /Count is required/]]) {
    assert.throws(() => readInputs(inputs, values), message);
  }
  assert.throws(() => readInputs([{ name: "x", label: "X", type: "number" }], {}), /X is required/);
});

test("tools return rows, tables or text, and a tool with no result is an error", () => {
  const tool = (compute) => ({ title: "T", inputs: [], compute });
  assert.deepEqual(runTool(tool(() => [["A", 1]])), { rows: [["A", 1]], table: null, text: null, note: null });
  assert.deepEqual(runTool(tool(() => ({ text: "", note: "n" }))), { rows: [], table: null, text: "", note: "n" });
  const table = { columns: ["a"], rows: [[1]] };
  assert.deepEqual(runTool(tool(() => ({ table }))).table, table);
  assert.throws(() => runTool(tool(() => [])), /returned no result/);
  assert.throws(() => runTool(tool(() => null)), /returned no result/);
  assert.equal(resultText({ rows: [["A", 0.5]], table, text: "t", note: null }), "A\t0.5\na\n1\nt");
});

test("transforms preview against the current list, apply only to it, and undo only what nothing newer replaced", () => {
  const items = [{ text: "a" }, { text: "b" }, { text: "c" }];
  const preview = previewTransform(key("upper"), feature("upper"), items, new Set([0, 2]), {}, {});
  assert.deepEqual(preview.next, [{ text: "A" }, { text: "b" }, { text: "C" }]);
  assert.deepEqual([preview.changed, preview.was, preview.now, previewChanges(preview)], [[1, 3], 3, 3, true]);
  assert.match(describePreview(preview), /2 items would change \(positions 1, 3\)/);
  assert.throws(() => previewTransform(key("upper"), feature("upper"), items, new Set(), {}, {}), /Nothing is shown/);
  const applied = applyTransform(preview, items);
  assert.notEqual(applied.items, preview.next);
  assert.throws(() => applyTransform(preview, [{ text: "a" }]), /Preview again/);
  assert.throws(() => applyTransform(null, items), /Preview again/);
  assert.deepEqual(undoTransform(applied.undo, applied.items), items);
  assert.throws(() => undoTransform(applied.undo, [...applied.items, { text: "new" }]), /newer edits/);
  const shorter = previewTransform(key("keep_first"), feature("keep_first"), items, new Set(), { count: 2 }, {});
  assert.deepEqual([shorter.changed, shorter.was, shorter.now], [[], 3, 2]);
  assert.match(describePreview(shorter), /from 3 to 2 items/);
  const same = previewTransform(key("upper"), feature("upper"), [{ text: "" }], new Set([0]), {}, {});
  assert.equal(previewChanges(same), false);
  assert.match(describePreview(same), /nothing would change/);
  assert.throws(() => previewTransform("x", { label: "Bad", all: () => "no" }, items, new Set(), {}, {}), /returned no list/);
});

test("metrics, exporters and importers normalize results and report failures", () => {
  const rows = runMetrics([["a", { label: "A", compute: () => 0.5, format: "percent", help: "h" }], ["b", { label: "B", compute: () => ({ value: 3, detail: "of 4" }) }],
    ["c", { label: "C", compute: () => null }], ["d", { label: "D", compute: () => { throw new Error("bad"); } }], ["e", { label: "E", compute: () => undefined }]], {});
  assert.deepEqual(rows.map((row) => [row.value, row.text, row.detail, row.help]),
    [[0.5, "50.0%", "", "h"], [3, "3", "of 4", ""], [null, "—", "", ""], [null, "—", "Could not compute: bad", ""], [null, "—", "", ""]]);
  assert.deepEqual(runExporter({ label: "X", filename: (ctx) => `${ctx.name}.txt`, build: () => "t" }, { name: "n" }), { filename: "n.txt", mime: "text/plain", text: "t" });
  assert.throws(() => runExporter({ label: "X", filename: "x.txt", build: () => null }, {}), /produced no text/);
  assert.deepEqual(runImporter({ label: "I", parse: () => [1] }, "x", {}), { items: [1], warnings: [] });
  assert.throws(() => runImporter({ label: "I", parse: () => ({}) }, "x", {}), /found nothing to import/);
});

test("command search: every word must match, unavailable commands are hidden, prefix matches rank first", () => {
  const command = (title, extra = {}) => ["k/" + title, { title, run() {}, ...extra }, {}];
  const entries = [command("Open Bulk tab"), command("Go to Build", { group: "Workbench" }), command("Build a gate", { when: () => false }),
    command("Rebuild index"), command("Bulk: open import", { when: () => { throw new Error("x"); } })];
  const titles = (query) => searchCommands(entries, query).map(([, entry]) => entry.title);
  assert.deepEqual(titles(""), ["Open Bulk tab", "Go to Build", "Rebuild index"]);
  assert.deepEqual(titles("build"), ["Go to Build", "Rebuild index"]);
  assert.deepEqual(titles("go work"), ["Go to Build"]);
  assert.deepEqual(titles("REB"), ["Rebuild index"]);
  assert.deepEqual(titles("zzz"), []);
  assert.deepEqual(titles("("), []);
});

test("shortcuts: chords, Mod as Ctrl or Cmd, symbols regardless of Shift, and typing targets", () => {
  assert.deepEqual(parseKeys("Mod+Shift+K"), { key: "k", mod: true, ctrl: false, meta: false, alt: false, shift: true, bare: false });
  assert.equal(parseKeys("Shift+?").bare, true);
  for (const bad of ["", "Shift", "Hyper+K", "Mod+"]) assert.equal(parseKeys(bad), null, bad);
  const event = (keyName, flags = {}) => ({ key: keyName, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...flags });
  assert.equal(keysMatch(event("k", { ctrlKey: true }), "Mod+K"), true);
  assert.equal(keysMatch(event("K", { metaKey: true }), "Mod+K"), true);
  assert.equal(keysMatch(event("k", { ctrlKey: true, shiftKey: true }), "Mod+K"), false);
  assert.equal(keysMatch(event("k"), "Mod+K"), false);
  assert.equal(keysMatch(event("b", { altKey: true }), "Alt+B"), true);
  assert.equal(keysMatch(event("b", { altKey: true, ctrlKey: true }), "Alt+B"), false);
  assert.equal(keysMatch(event("?", { shiftKey: true }), "?"), true);
  assert.equal(keysMatch(event("?"), "?"), true);
  assert.equal(keysMatch(event("Escape"), "Escape"), true);
  assert.equal(keysMatch(event("x"), "Hyper+X"), false);
  // macOS types a composed character with Option held; the physical key still matches an Alt chord.
  assert.equal(keysMatch(event("˜", { altKey: true, shiftKey: true, code: "KeyN" }), "Alt+Shift+N"), true);
  assert.equal(keysMatch(event("™", { altKey: true, code: "Digit2" }), "Alt+2"), true);
  assert.equal(keysMatch(event("˜", { altKey: true, shiftKey: true, code: "KeyM" }), "Alt+Shift+N"), false);
  assert.equal(keysMatch(event("˜", { shiftKey: true, code: "KeyN" }), "Shift+N"), false, "without Alt the typed character decides");
  assert.equal(keysMatch(event("q", { code: "KeyA" }), "Q"), true, "a plain letter follows the layout, not the physical key");
  assert.deepEqual(["INPUT", "textarea", "Select", "DIV", undefined].map((tagName) => typingTarget({ tagName })), [true, true, true, false, false]);
  assert.equal(typingTarget({ tagName: "DIV", isContentEditable: true }), true);
});

test("the host filters, sorts, counts active settings, resets, and keeps surfaces apart", () => {
  const lab = createLab([pack]);
  const items = fixtureItems(), ctx = fakeCtx({ items });
  assert.equal(lab.count("test.list"), improvements.length);
  assert.equal(lab.count("other"), 0);
  assert.deepEqual(lab.refine("test.list", items, ctx), items, "no settings: everything shown in page order");
  assert.equal(lab.arrange("test.list", items, ctx), items, "no sort: the same array comes back");
  const view = lab.view("test.list");
  view.filters = [{ key: key("words"), op: "min", value: "3" }, { key: key("text"), op: "contains", value: "" }, { key: "gone/x", op: "with" }];
  view.sort = { key: key("words"), dir: "desc" };
  assert.deepEqual(lab.refine("test.list", items, ctx).map((item) => item.id), ["b", "a", "d"]);
  assert.equal(lab.matches("test.list", items[2], ctx), false);
  assert.equal(lab.matches("unknown.surface", items[2], ctx), true);
  assert.equal(lab.active("test.list"), 2, "one active filter and the sort; blank and unknown filters do not count");
  lab.reset("test.list");
  assert.deepEqual([lab.active("test.list"), view.filters, view.sort], [0, [], null]);
  assert.equal(lab.section(fakeEnv(), "unknown.surface", ctx), null);
  assert.throws(() => createLab([pack, pack]), /loaded twice/);
});

test("shortcuts run the mounted surface's command, respect when(), and skip bare chords while typing", () => {
  const lab = createLab([pack, definePack({ id: "bare", surface: "test.list", title: "Bare", features: [{ id: "help", kind: "command", title: "Help", keys: "?", run: (ctx) => { ctx.helped = true; } }] })]);
  const ctx = fakeCtx({ items: fixtureItems() });
  ctx.actions.replaceItems = (next) => { ctx.list = next; };
  const chord = { key: "x", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, target: { tagName: "BODY" } };
  assert.equal(lab.handleKey(chord), null, "nothing is mounted yet");
  lab.mount("test.list", ctx);
  assert.deepEqual(lab.mountedIds(), ["test.list"]);
  assert.equal(lab.handleKey({ ...chord, key: "y" }), null);
  assert.equal(lab.handleKey(chord), key("clear"));
  assert.deepEqual(ctx.items(), []);
  assert.equal(lab.handleKey(chord), null, "when() hides the command once the list is empty");
  assert.equal(lab.handleKey({ key: "?", shiftKey: true, target: { tagName: "INPUT" } }), null);
  assert.equal(lab.handleKey({ key: "?", shiftKey: true, target: { tagName: "BODY" } }), "bare/help");
  assert.equal(ctx.helped, true);
  lab.unmountAll(["test.list"]);
  assert.deepEqual(lab.mountedIds(), ["test.list"]);
  lab.unmountAll();
  assert.equal(lab.commandEntries().length, 0);
  const errors = [];
  const failing = createLab([definePack({ id: "fails", surface: "s", title: "F", features: [{ id: "boom", kind: "command", title: "Boom", keys: "Alt+B", run: () => { throw new Error("boom"); } }] })]);
  failing.mount("s", {});
  assert.equal(failing.handleKey({ key: "b", altKey: true, target: {} }, (error) => errors.push(error.message)), "fails/boom");
  assert.deepEqual(errors, ["boom"]);
});

// ---------- the generic controls ----------

function openSection(overrides = {}) {
  const lab = createLab([pack]);
  const ctx = fakeCtx({ items: fixtureItems() });
  ctx.shown = () => lab.refine("test.list", ctx.list, ctx);
  ctx.actions.replaceItems = (next, info) => { ctx.list = next; ctx.replaced = info; };
  ctx.actions.importItems = (items, info) => { ctx.list = [...ctx.list, ...items]; ctx.imported = info; };
  Object.assign(ctx, overrides);
  const view = lab.view("test.list");
  for (const name of ["section", "refine", "checks", "transforms", "metrics", "exports", "imports", "commands", "tools", "panel:fixture-pack/counter"]) view.open[name] = true;
  const env = fakeEnv();
  const render = () => lab.section(env, "test.list", ctx);
  return { lab, ctx, view, env, render, tree: render() };
}
const blockOf = (tree, name) => find(tree, (node) => node.attrs["data-lab-block"] === name);
const control = (root, label) => find(root, (node) => node.attrs["aria-label"] === label);
const button = (root, text) => find(root, (node) => node.tag === "button" && textOf(node).startsWith(text));

test("the section shows one block per kind in use, with counts, and renders closed blocks without content", () => {
  const { tree, lab, ctx, env } = openSection();
  assert.equal(tree.tag, "details");
  assert.equal(textOf(find(tree, (node) => node.tag === "summary")), `Lab tools · ${improvements.length}`);
  assert.deepEqual(findAll(tree, (node) => node.attrs["data-lab-block"]).map((node) => [node.attrs["data-lab-block"], textOf(node.children[0])]),
    [["refine", "Refine · 4"], ["checks", "Checks · 2"], ["transforms", "Edits · 2"], ["metrics", "Metrics · 1"], ["exports", "Copy and download · 1"],
      ["imports", "Paste to import · 1"], ["commands", "Commands · 1"], ["tools", "Tools · 1"], ["panel:fixture-pack/counter", "Counter · 2"]]);
  const closed = createLab([pack]);
  const quiet = closed.section(env, "test.list", ctx);
  assert.equal(quiet.attrs.open, false);
  assert.ok(findAll(quiet, (node) => node.attrs["data-lab-block"]).every((node) => node.children.length === 1), "closed blocks hold only their summary");
  fire(blockOf(quiet, "metrics"), "toggle", { target: { open: true } });
  assert.equal(closed.view("test.list").open.metrics, true);
  assert.ok(textOf(quiet).includes("Share of urgent items"), "opening a block builds its content");
  assert.equal(lab.mountedIds().includes("test.list"), true);
  const readOnly = createLab([pack]);
  for (const name of ["transforms", "imports"]) readOnly.view("test.list").open[name] = true;
  const plain = readOnly.section(env, "test.list", fakeCtx({ items: fixtureItems() }));
  assert.equal(blockOf(plain, "transforms"), null, "edits need a surface that can replace its items");
  assert.equal(blockOf(plain, "imports"), null, "imports need a surface that can add items");
});

test("Refine: adding, replacing and removing filters refreshes the list, the count and the chips", () => {
  const { tree, ctx, view, env } = openSection();
  const refine = blockOf(tree, "refine");
  const count = () => textOf(find(refine, (node) => node.attrs["data-lab"] === "count"));
  assert.equal(count(), "4 of 4 shown");
  assert.equal(button(refine, "Add filter"), null, "no value controls until a fact is chosen");
  fire(control(refine, "Fact to filter by"), "change", { target: { value: key("words") } });
  fire(control(refine, "word count bound"), "input", { target: { value: "x" } });
  fire(button(refine, "Add filter"), "click");
  assert.match(env.toasts.at(-1).message, /bound must be a number/);
  fire(control(refine, "word count bound"), "input", { target: { value: "4" } });
  fire(button(refine, "Add filter"), "click");
  assert.deepEqual(view.filters, [{ key: key("words"), op: "min", value: "4" }]);
  assert.equal(ctx.refreshes, 1);
  assert.equal(count(), "1 of 4 shown · 1 Lab setting active");
  fire(control(refine, "word count bound"), "input", { target: { value: "3" } });
  fire(control(refine, "word count bound"), "keydown", { key: "Enter" });
  assert.deepEqual(view.filters, [{ key: key("words"), op: "min", value: "3" }], "a second bound of the same kind replaces the first");
  fire(control(refine, "Comparison"), "change", { target: { value: "max" } });
  fire(control(refine, "word count bound"), "input", { target: { value: "3" } });
  fire(button(refine, "Add filter"), "click");
  assert.equal(count(), "2 of 4 shown · 2 Lab settings active");
  const chips = find(refine, (node) => node.attrs["data-lab"] === "filters");
  assert.deepEqual(findAll(chips, (node) => node.attrs.class === "chip").map(textOf), ["word count ≥ 3 ×", "word count ≤ 3 ×"]);
  fire(find(chips, (node) => node.attrs.class === "chip"), "click");
  assert.equal(count(), "2 of 4 shown · 1 Lab setting active");
  fire(button(chips, "Clear Lab filters and sort"), "click");
  assert.deepEqual([view.filters, view.sort, ctx.shown().length], [[], null, 4]);
});

test("Refine: flag, text and category filters, fact search, sort and summaries", () => {
  const { tree, ctx, view, env } = openSection();
  const refine = blockOf(tree, "refine");
  const factSelect = control(refine, "Fact to filter by");
  const optionsShown = () => findAll(factSelect, (node) => node.tag === "option").map(textOf);
  assert.deepEqual(optionsShown(), ["Choose a fact (4)…", "word count", "urgent marker", "text", "tag"]);
  fire(control(refine, "Search facts"), "input", { target: { value: "URG" } });
  assert.deepEqual(optionsShown(), ["Choose a fact (1)…", "urgent marker"]);
  fire(control(refine, "Search facts"), "input", { target: { value: "nothing" } });
  assert.deepEqual(optionsShown(), ["No fact matches"]);
  fire(factSelect, "change", { target: { value: key("urgent") } });
  fire(control(refine, "Comparison"), "change", { target: { value: "without" } });
  fire(button(refine, "Add filter"), "click");
  assert.deepEqual(ctx.shown().map((item) => item.id), ["b", "c", "d"]);
  fire(factSelect, "change", { target: { value: key("text") } });
  fire(button(refine, "Add filter"), "click");
  assert.match(env.toasts.at(-1).message, /Type a value/);
  fire(control(refine, "Text contained in text"), "input", { target: { value: "refund" } });
  fire(button(refine, "Add filter"), "click");
  assert.deepEqual(ctx.shown().map((item) => item.id), ["d"]);
  view.filters = [];
  fire(factSelect, "change", { target: { value: key("tag") } });
  const values = control(refine, "tag value");
  assert.deepEqual(findAll(values, (node) => node.tag === "option").map(textOf), ["billing (2)", "shipping (1)"]);
  fire(values, "change", { target: { value: "shipping" } });
  fire(button(refine, "Add filter"), "click");
  assert.deepEqual(ctx.shown().map((item) => item.id), ["b"]);
  view.filters = [];
  fire(control(refine, "Sort direction"), "change", { target: { value: "desc" } });
  assert.equal(view.sort, null, "a direction alone sorts nothing");
  fire(control(refine, "Sort by fact"), "change", { target: { value: key("words") } });
  assert.deepEqual(ctx.shown().map((item) => item.id), ["b", "a", "d", "c"]);
  fire(control(refine, "Sort direction"), "change", { target: { value: "asc" } });
  assert.deepEqual(ctx.shown().map((item) => item.id), ["a", "d", "b", "c"]);
  fire(control(refine, "Sort by fact"), "change", { target: { value: "" } });
  assert.equal(view.sort, null);
  const summary = find(refine, (node) => node.attrs["data-lab"] === "summary");
  fire(control(refine, "Summarize a fact over the shown items"), "change", { target: { value: key("words") } });
  assert.equal(textOf(summary), "items3minimum3median3mean3.6667maximum5sum11unavailable1");
  fire(control(refine, "Summarize a fact over the shown items"), "change", { target: { value: key("tag") } });
  assert.ok(textOf(summary).includes("billing2") && textOf(summary).includes("Not available1"));
  fire(control(refine, "Summarize a fact over the shown items"), "change", { target: { value: key("urgent") } });
  assert.equal(textOf(summary), "with1without3");
  fire(control(refine, "Summarize a fact over the shown items"), "change", { target: { value: key("text") } });
  assert.equal(textOf(summary), "filled3empty1distinct3");
  fire(button(refine, "Copy facts CSV"), "click");
  assert.ok(env.copied.at(-1).startsWith('"item","word count","urgent marker","text","tag"\r\n"1","3","yes","Refund the order","billing"\r\n'));
  fire(button(refine, "Download facts CSV"), "click");
  assert.deepEqual([env.downloads.at(-1).filename, env.downloads.at(-1).mime], ["lab-facts.csv", "text/csv"]);
});

test("Checks run on the shown items only and name items by their place in the full list", () => {
  const { tree, view, env } = openSection({ itemName: (item) => item.id });
  const checks = blockOf(tree, "checks");
  assert.ok(textOf(checks).includes("Not run yet."));
  fire(button(checks, "Run checks on shown items"), "click");
  assert.deepEqual(view.findings.list.map((finding) => [finding.severity, finding.where, finding.message]), [["problem", "Item c", "Empty text"]]);
  assert.ok(textOf(checks).includes("1 finding in 4 shown items"));
  fire(button(checks, "Copy findings"), "click");
  assert.equal(env.copied.at(-1), "Problem\tItem c\tEmpty text\tEmpty text");
  view.filters = [{ key: key("tag"), op: "is", value: "billing" }];
  fire(button(checks, "Run checks on shown items"), "click");
  assert.deepEqual(view.findings.list.map((finding) => [finding.where, finding.message]), [["List", "Every tagged item has the same tag."]]);
});

test("Open Metrics and Checks follow filter changes and edits without a rebuild", () => {
  const { tree, ctx, view, env } = openSection();
  const refine = blockOf(tree, "refine"), metrics = blockOf(tree, "metrics"), checks = blockOf(tree, "checks"), edits = blockOf(tree, "transforms");
  // One of the four fixture items is urgent: 25%. Filtered to the urgent one: 100%. Without it: 0 of 3.
  assert.ok(textOf(metrics).includes("Share of urgent items25.0%"));
  fire(button(checks, "Run checks on shown items"), "click");
  assert.ok(textOf(checks).includes("1 finding in 4 shown items"));
  fire(control(refine, "Fact to filter by"), "change", { target: { value: key("urgent") } });
  fire(button(refine, "Add filter"), "click");
  assert.ok(textOf(metrics).includes("Share of urgent items100.0%"), "the open metrics describe the filtered list");
  assert.ok(textOf(checks).includes("Not run yet."), "findings for the old list are cleared from view");
  fire(button(metrics, "Copy metrics"), "click");
  assert.equal(env.copied.at(-1), "Share of urgent items\t100.0%");
  fire(find(find(refine, (node) => node.attrs["data-lab"] === "filters"), (node) => node.attrs.class === "chip"), "click");
  assert.ok(textOf(metrics).includes("Share of urgent items25.0%"), "removing the filter refreshes them again");
  fire(control(refine, "Comparison"), "change", { target: { value: "without" } });
  fire(button(refine, "Add filter"), "click");
  assert.ok(textOf(metrics).includes("Share of urgent items0.0%"));
  view.filters = [];
  fire(control(edits, "Edit to preview"), "change", { target: { value: key("keep_first") } });
  fire(find(edits, (node) => node.tag === "input" && node.attrs.type === "number"), "input", { target: { value: "1" } });
  fire(button(edits, "Preview edit"), "click");
  fire(button(edits, "Apply previewed edit"), "click");
  assert.equal(ctx.items().length, 1);
  const first = fixtureItems()[0].urgent ? "100.0%" : "0.0%";
  assert.ok(textOf(metrics).includes(`Share of urgent items${first}`), "an applied edit refreshes them too");
});

test("Edits: choose, preview, apply through the surface, undo, and surface errors stay visible", () => {
  const { tree, ctx, view } = openSection();
  const edits = blockOf(tree, "transforms");
  const status = () => textOf(find(edits, (node) => node.attrs["data-lab"] === "transform-status"));
  fire(button(edits, "Preview edit"), "click");
  assert.match(status(), /Choose an edit first/);
  fire(control(edits, "Edit to preview"), "change", { target: { value: key("keep_first") } });
  const count = find(edits, (node) => node.tag === "input" && node.attrs.type === "number");
  fire(count, "input", { target: { value: "0" } });
  fire(button(edits, "Preview edit"), "click");
  assert.match(status(), /at least 1/);
  fire(count, "input", { target: { value: "3" } });
  fire(button(edits, "Preview edit"), "click");
  assert.match(status(), /from 4 to 3 items\. Nothing has changed yet/);
  assert.equal(ctx.items().length, 4);
  fire(count, "input", { target: { value: "1" } });
  assert.equal(view.transform.preview, null, "changing a parameter drops the preview");
  fire(button(edits, "Preview edit"), "click");
  ctx.list = [...ctx.list];
  ctx.list[0] = { ...ctx.list[0], text: "edited elsewhere" };
  fire(button(edits, "Apply previewed edit"), "click");
  assert.match(status(), /Preview again/);
  fire(button(edits, "Preview edit"), "click");
  fire(button(edits, "Apply previewed edit"), "click");
  assert.deepEqual([ctx.items().length, ctx.replaced.label, ctx.refreshes], [1, "Keep the first items", 1]);
  assert.ok(status().includes("Undo: Keep the first items"));
  fire(button(edits, "Undo: Keep the first items"), "click");
  assert.deepEqual([ctx.items().length, ctx.replaced.label, view.transform.undo], [4, "Undo Keep the first items", null]);
  ctx.actions.replaceItems = () => { throw new Error("Two rows share an ID."); };
  fire(button(edits, "Preview edit"), "click");
  fire(button(edits, "Apply previewed edit"), "click");
  assert.match(status(), /Two rows share an ID/);
  assert.equal(ctx.items().length, 4);
});

test("Metrics, exports, imports, commands, tools and panels work from their blocks", async () => {
  const { tree, ctx, env, view, render } = openSection();
  assert.ok(textOf(blockOf(tree, "metrics")).includes("Share of urgent items25.0%"));
  fire(button(blockOf(tree, "metrics"), "Copy metrics"), "click");
  assert.equal(env.copied.at(-1), "Share of urgent items\t25.0%");
  const exportsBlock = blockOf(tree, "exports");
  fire(control(exportsBlock, "Copy: Shown item IDs as CSV"), "click");
  assert.equal(env.copied.at(-1), '"id"\r\n"a"\r\n"b"\r\n"c"\r\n"d"\r\n');
  fire(control(exportsBlock, "Download: Shown item IDs as CSV"), "click");
  assert.deepEqual(env.downloads.at(-1), { filename: "ids.csv", text: '"id"\r\n"a"\r\n"b"\r\n"c"\r\n"d"\r\n', mime: "text/csv" });

  const imports = blockOf(tree, "imports");
  const importStatus = () => textOf(find(imports, (node) => node.attrs["data-lab"] === "import-status"));
  fire(button(imports, "Preview import"), "click");
  assert.match(importStatus(), /Choose a format first/);
  fire(control(imports, "Format to import"), "change", { target: { value: key("lines") } });
  fire(button(imports, "Preview import"), "click");
  assert.match(importStatus(), /Paste at least one line/);
  fire(control(imports, "Text to import"), "input", { target: { value: "one\ntwo\nthree\nfour" } });
  fire(button(imports, "Preview import"), "click");
  assert.match(importStatus(), /4 items read\. Nothing has been added yet\.More than three lines\./);
  assert.equal(ctx.items().length, 4);
  fire(button(imports, "Add previewed items"), "click");
  assert.deepEqual([ctx.items().length, ctx.imported.label, view.importer.text], [8, "One item per line", ""]);

  const tools = blockOf(render(), "tools");
  fire(control(tools, "Search tools"), "input", { target: { value: "nothing here" } });
  assert.ok(textOf(tools).includes("No tool matches."));
  fire(control(tools, "Search tools"), "input", { target: { value: "double two" } });
  fire(button(tools, "Double a number"), "click");
  fire(button(tools, "Calculate"), "click");
  assert.match(textOf(find(tools, (node) => node.attrs["data-lab"] === "tool-result")), /Number is required/);
  fire(find(tools, (node) => node.tag === "input" && node.attrs.type === "number"), "input", { target: { value: "21" } });
  fire(button(tools, "Calculate"), "click");
  assert.ok(textOf(find(tools, (node) => node.attrs["data-lab"] === "tool-result")).startsWith("Double42"));
  fire(button(tools, "Copy result"), "click");
  assert.equal(env.copied.at(-1), "Double\t42");
  fire(button(tools, "Reset inputs"), "click");
  assert.deepEqual(view.tool.values[key("double")], {});

  const panel = blockOf(render(), "panel:fixture-pack/counter");
  fire(find(panel, (node) => node.attrs.class === "more"), "click");
  assert.equal(view.panels[key("counter")].count, 1);

  const commands = blockOf(render(), "commands");
  assert.equal(textOf(button(commands, "Clear the list")), "Clear the listAlt+Shift+X");
  fire(button(commands, "Clear the list"), "click");
  await Promise.resolve();
  assert.deepEqual(ctx.items(), []);
  assert.equal(blockOf(render(), "commands").children.length, 2);
  assert.equal(button(blockOf(render(), "commands"), "Clear the list"), null, "a command whose when() is false is not offered");
});

test("flat sections show tools without a disclosure", () => {
  const lab = createLab([pack]);
  const tree = lab.section(fakeEnv(), "test.list", fakeCtx({}), { flat: true });
  assert.equal(tree.tag, "div");
  assert.ok(control(tree, "Search tools"));
  assert.equal(find(tree, (node) => node.tag === "summary" && textOf(node).startsWith("Tools")), null);
});

test("the command palette searches mounted commands, moves with the arrow keys and runs on Enter", async () => {
  const lab = createLab([pack, definePack({ id: "more", surface: "test.list", title: "More", features: [
    { id: "copy_ids", kind: "command", title: "Copy item IDs", group: "Fixture", run: (ctx) => ctx.env.copy(ctx.items().map((item) => item.id).join(",")) },
    { id: "fail", kind: "command", title: "Fail loudly", run: () => { throw new Error("It failed."); } }] })]);
  const ctx = fakeCtx({ items: fixtureItems() });
  ctx.actions.replaceItems = (next) => { ctx.list = next; };
  const env = fakeEnv();
  let closed = 0;
  assert.equal(textOf(renderPalette(env, lab, () => {}).node).includes("No command matches."), true);
  lab.mount("test.list", ctx);
  const palette = renderPalette(env, lab, () => { closed++; });
  const titles = () => findAll(palette.node, (node) => node.attrs.role === "option").map((node) => textOf(node.children[0]));
  const active = () => findAll(palette.node, (node) => node.attrs.role === "option").findIndex((node) => node.attrs["aria-selected"] === "true");
  assert.deepEqual(titles(), ["Clear the list", "Copy item IDs", "Fail loudly"]);
  fire(palette.input, "keydown", { key: "ArrowUp" });
  assert.equal(active(), 2);
  fire(palette.input, "keydown", { key: "ArrowDown" });
  assert.equal(active(), 0);
  fire(palette.input, "input", { target: { value: "copy fix" } });
  assert.deepEqual(titles(), ["Copy item IDs"]);
  fire(palette.input, "keydown", { key: "Enter" });
  await Promise.resolve();
  assert.deepEqual([closed, ctx.env.copied], [1, ["a,b,c,d"]]);
  fire(palette.input, "input", { target: { value: "fail" } });
  fire(find(palette.node, (node) => node.attrs.role === "option"), "click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(env.toasts.at(-1), { message: "It failed.", kind: "error" });
  fire(palette.input, "keydown", { key: "Escape" });
  fire(palette.node, "click", { target: palette.node });
  assert.equal(closed, 4);
  fire(palette.input, "input", { target: { value: "zzz" } });
  fire(palette.input, "keydown", { key: "Enter" });
  assert.equal(closed, 4, "Enter with no match does nothing");
  assert.equal(nodes(palette.node).some((node) => node.attrs?.role === "dialog" && node.attrs["aria-modal"] === "true"), true);
  assert.ok(byText(palette.node, "p", "Esc closes"));
});
