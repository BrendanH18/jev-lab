// static/js/lab/lib/json.js: the shared JSON helpers Lab packs import. Run with: node --test tests/js/lab/lib-json.test.mjs
// Every expected value is written out by hand from the path grammar and the function's stated rule, or comes from
// an independent source: JSON.stringify and JSON.parse (the platform's own JSON), and Python for byte sizes
// (len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))). Nothing is copied from the
// output of the code under test.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as json from "../../../static/js/lab/lib/json.js";

const cp = (...codes) => String.fromCodePoint(...codes);
const doc = () => ({ a: { b: [10, { c: "x" }] }, "my key": { 0: "zero" }, list: [[1, 2], [3]], n: null });
const cyclic = () => {
  const value = { name: "loop", items: [1] };
  value.self = value;
  value.items.push(value);
  return value;
};

test("the module exports exactly the documented names", () => {
  assert.deepEqual(Object.keys(json).sort(), ["byteSize", "countLeaves", "deepEqual", "deletePath", "depth", "diffValues", "duplicateKeys", "flatten",
    "formatPath", "getPath", "isPlainObject", "listPaths", "mergeDeep", "omit", "parsePath", "pick", "setPath", "sortKeys", "stableStringify", "typeName",
    "unflatten", "walk"]);
});

// ---------- kinds of value ----------

test("typeName and isPlainObject", () => {
  assert.equal(json.typeName(null), "null");
  assert.equal(json.typeName([]), "array");
  assert.equal(json.typeName({}), "object");
  assert.equal(json.typeName(new Date(0)), "object");
  assert.equal(json.typeName(""), "string");
  assert.equal(json.typeName(0), "number");
  assert.equal(json.typeName(NaN), "number");
  assert.equal(json.typeName(false), "boolean");
  assert.equal(json.typeName(undefined), null);
  assert.equal(json.typeName(() => 1), null);
  assert.equal(json.typeName(Symbol("s")), null);
  assert.equal(json.typeName(1n), null);
  for (const value of [null, true, 1.5, "s", [1], { a: 1 }]) assert.equal(json.typeName(JSON.parse(JSON.stringify(value))), json.typeName(value));

  assert.equal(json.isPlainObject({}), true);
  assert.equal(json.isPlainObject(Object.create(null)), true);
  assert.equal(json.isPlainObject(JSON.parse('{"a":1}')), true);
  for (const no of [null, undefined, [], "x", 1, new Date(0), new Map(), () => 1, new (class Box {})()]) assert.equal(json.isPlainObject(no), false);
});

// ---------- paths ----------

test("formatPath and parsePath follow the path grammar", () => {
  // Written from the grammar: dot for identifier keys, ["key"] otherwise, [n] for indexes, "" for the root.
  const cases = [
    [[], ""],
    [["a"], "a"],
    [["a", "b", 0], "a.b[0]"],
    [[0, "a"], "[0].a"],
    [[2, 3], "[2][3]"],
    [["my key", "x"], '["my key"].x'],
    [["a", "my-key"], 'a["my-key"]'],
    [[""], '[""]'],
    [["0"], '["0"]'],
    [["1a"], '["1a"]'],
    [["_a1", "B"], "_a1.B"],
    [["a.b"], '["a.b"]'],
    [['q"uote'], '["q\\"uote"]'],
    [["back\\slash"], '["back\\\\slash"]'],
    [["a]b"], '["a]b"]'],
    [[cp(0xE9)], `["${cp(0xE9)}"]`],
    [["__proto__", "x"], "__proto__.x"],
  ];
  for (const [segments, path] of cases) {
    assert.equal(json.formatPath(segments), path);
    assert.deepEqual(json.parsePath(path), segments, path);
    assert.deepEqual(json.parsePath(segments), segments);
  }
  assert.notEqual(json.parsePath(cases[2][0]), cases[2][0]);                // a copy, not the same array
  for (const bad of [[-1], [1.5], [null], [{}], [NaN], ["a", undefined]]) {
    assert.equal(json.formatPath(bad), null);
    assert.equal(json.parsePath(bad), null);
  }
  assert.equal(json.formatPath("a.b"), null);
  assert.equal(json.formatPath(null), null);
  for (const bad of ["a..b", ".a", "a.", "a[", "a[]", "a[01]", "[-1]", "a[1", "a b", "a-b", "1a", "a[x]", 'a["x]', 'a["x"', "[0]a", "a.[0]", 'a."b"',
    "a[1.5]", "a[99999999999999999999]", null, undefined, 5, {}]) assert.equal(json.parsePath(bad), null, JSON.stringify(bad));
});

test("getPath reads a node and gives undefined for anything missing", () => {
  const value = doc();
  assert.equal(json.getPath(value, ""), value);
  assert.equal(json.getPath(value, "a.b[0]"), 10);
  assert.equal(json.getPath(value, "a.b[1].c"), "x");
  assert.equal(json.getPath(value, '["my key"]["0"]'), "zero");
  assert.equal(json.getPath(value, "list[1][0]"), 3);
  assert.equal(json.getPath(value, "n"), null);
  assert.equal(json.getPath(value, ["a", "b", 1, "c"]), "x");
  assert.equal(json.getPath(value, []), value);
  assert.equal(json.getPath(5, ""), 5);
  for (const missing of ["a.missing", "a.b[5]", "a.b[1].c.d", '["my key"][0]', 'a.b["0"]', "a.b.length", "constructor", "a.constructor", "n.x", "a..b", "a["]) {
    assert.equal(json.getPath(value, missing), undefined, missing);
  }
  assert.equal(json.getPath(null, "a"), undefined);
  assert.equal(json.getPath(undefined, "a"), undefined);
  assert.equal(json.getPath("text", "[0]"), undefined);
  assert.equal(json.getPath(value, null), undefined);
});

test("setPath returns a changed copy and shares the rest", () => {
  const value = doc();
  const before = JSON.stringify(value);
  const changed = json.setPath(value, "a.b[0]", 11);
  assert.deepEqual(changed, { a: { b: [11, { c: "x" }] }, "my key": { 0: "zero" }, list: [[1, 2], [3]], n: null });
  assert.equal(JSON.stringify(value), before);
  assert.notEqual(changed, value);
  assert.notEqual(changed.a, value.a);
  assert.notEqual(changed.a.b, value.a.b);
  assert.equal(changed.a.b[1], value.a.b[1]);
  assert.equal(changed.list, value.list);

  assert.deepEqual(json.setPath({}, "a.b[1].c", 1), { a: { b: [null, { c: 1 }] } });
  assert.deepEqual(json.setPath({ a: 1 }, "a.b", 2), { a: { b: 2 } });
  assert.deepEqual(json.setPath({ a: [1] }, "a.b", 2), { a: { b: 2 } });
  assert.deepEqual(json.setPath({ a: { x: 1 } }, "a[0]", 2), { a: [2] });
  assert.deepEqual(json.setPath(undefined, "[0]", "x"), ["x"]);
  assert.deepEqual(json.setPath(null, "a", 1), { a: 1 });
  assert.deepEqual(json.setPath([1, 2], "[3]", 4), [1, 2, null, 4]);
  assert.deepEqual(json.setPath({ a: 1 }, '["my key"]', 2), { a: 1, "my key": 2 });
  assert.deepEqual(json.setPath({ a: 1 }, ["b", 0], 2), { a: 1, b: [2] });
  assert.equal(json.setPath(value, "", 7), 7);
  assert.equal(json.setPath(value, "a..b", 1), null);
  assert.equal(json.setPath(value, null, 1), null);

  const risky = json.setPath({}, "__proto__.polluted", true);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(risky), Object.prototype);
  assert.deepEqual(Object.keys(risky), ["__proto__"]);
  assert.equal(json.getPath(risky, "__proto__.polluted"), true);
});

test("deletePath returns a copy without the node", () => {
  const value = doc();
  const before = JSON.stringify(value);
  assert.deepEqual(json.deletePath({ a: 1, b: 2 }, "a"), { b: 2 });
  assert.deepEqual(json.deletePath({ a: [1, 2, 3] }, "a[1]"), { a: [1, 3] });
  assert.deepEqual(json.deletePath(value, "a.b[1].c"), { a: { b: [10, {}] }, "my key": { 0: "zero" }, list: [[1, 2], [3]], n: null });
  assert.deepEqual(json.deletePath(value, '["my key"]'), { a: { b: [10, { c: "x" }] }, list: [[1, 2], [3]], n: null });
  assert.deepEqual(json.deletePath([1, 2, 3], "[0]"), [2, 3]);
  assert.equal(JSON.stringify(value), before);
  const shared = json.deletePath(value, "list[0]");
  assert.deepEqual(shared.list, [[3]]);
  assert.equal(shared.a, value.a);
  for (const missing of ["zzz", "a.b[9]", "a.b[0].x", "n.x", '["my key"][0]']) assert.equal(json.deletePath(value, missing), value, missing);
  assert.equal(json.deletePath(value, ""), undefined);
  assert.equal(json.deletePath(value, "a["), null);
  assert.equal(json.deletePath(5, "a"), 5);
});

// ---------- shape ----------

test("walk visits every node in document order", () => {
  const seen = [];
  const count = json.walk({ a: { b: [1, 2] }, "my key": true }, (path, value) => { seen.push([path, json.typeName(value)]); });
  assert.deepEqual(seen, [["", "object"], ["a", "object"], ["a.b", "array"], ["a.b[0]", "number"], ["a.b[1]", "number"], ['["my key"]', "boolean"]]);
  assert.equal(count, 6);

  const skipped = [];
  assert.equal(json.walk({ a: { b: [1, 2] }, c: 3 }, (path) => { skipped.push(path); return path !== "a"; }), 3);
  assert.deepEqual(skipped, ["", "a", "c"]);

  const roots = [];
  assert.equal(json.walk(5, (path, value) => roots.push([path, value])), 1);
  assert.deepEqual(roots, [["", 5]]);
  assert.equal(json.walk([[], {}], () => {}), 3);
  assert.equal(json.walk({}, null), null);
  assert.equal(json.walk({}, "visit"), null);

  const value = doc();
  json.walk(value, (path, node) => assert.equal(json.getPath(value, path), node, path));
});

test("depth, countLeaves and listPaths", () => {
  // Counted by hand.
  assert.equal(json.depth(5), 0);
  assert.equal(json.depth(null), 0);
  assert.equal(json.depth("text"), 0);
  assert.equal(json.depth([]), 1);
  assert.equal(json.depth({}), 1);
  assert.equal(json.depth({ a: 1 }), 1);
  assert.equal(json.depth({ a: [1] }), 2);
  assert.equal(json.depth([[[]]]), 3);
  assert.equal(json.depth({ a: { b: { c: {} } }, d: 1 }), 4);
  assert.equal(json.depth(doc()), 4);                               // a -> b -> [1] -> { c }

  assert.equal(json.countLeaves(5), 1);
  assert.equal(json.countLeaves(null), 1);
  assert.equal(json.countLeaves({}), 1);
  assert.equal(json.countLeaves([]), 1);
  assert.equal(json.countLeaves({ a: 1, b: [2, {}] }), 3);
  assert.equal(json.countLeaves({ a: { b: [1, 2, 3] }, c: null }), 4);
  assert.equal(json.countLeaves(doc()), 7);                         // 10, "x", "zero", 1, 2, 3, null

  assert.deepEqual(json.listPaths({ a: 1, b: [2, { c: 3 }] }), ["a", "b[0]", "b[1].c"]);
  assert.deepEqual(json.listPaths(doc()), ["a.b[0]", "a.b[1].c", '["my key"]["0"]', "list[0][0]", "list[0][1]", "list[1][0]", "n"]);
  assert.deepEqual(json.listPaths(5), [""]);
  assert.deepEqual(json.listPaths({}), [""]);
  assert.deepEqual(json.listPaths([[], { a: {} }]), ["[0]", "[1].a"]);
});

test("byteSize is the UTF-8 size of compact JSON", () => {
  // Sizes from Python: len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).
  assert.equal(json.byteSize({ a: 1, b: [true, null, "x"] }), 27);
  assert.equal(json.byteSize(`h${cp(0xE9)}`), 5);
  assert.equal(json.byteSize({ k: `${cp(0x20AC)}${cp(0x1F600)}` }), 15);
  assert.equal(json.byteSize([]), 2);
  assert.equal(json.byteSize(1.5), 3);
  assert.equal(json.byteSize(null), 4);
  assert.equal(json.byteSize(""), 2);
  assert.equal(json.byteSize(undefined), null);
  assert.equal(json.byteSize(() => 1), null);
  assert.equal(json.byteSize(1n), null);
  assert.equal(json.byteSize(cyclic()), null);
  for (const value of [doc(), "plain", { text: `${cp(0xE9)}${cp(0x4E2D)}${cp(0x1F600)} "quoted"\n` }]) {
    assert.equal(json.byteSize(value), new TextEncoder().encode(JSON.stringify(value)).length);
  }
});

test("flatten and unflatten are inverses", () => {
  assert.deepEqual(json.flatten({ a: { b: [1, {}] }, "x y": [], n: null }), { "a.b[0]": 1, "a.b[1]": {}, '["x y"]': [], n: null });
  assert.deepEqual(Object.keys(json.flatten({ b: 1, a: [2, 3] })), ["b", "a[0]", "a[1]"]);
  assert.deepEqual(json.flatten(5), { "": 5 });
  assert.deepEqual(json.flatten({}), { "": {} });
  assert.deepEqual(json.flatten([1, [2]]), { "[0]": 1, "[1][0]": 2 });

  assert.deepEqual(json.unflatten({ "a.b[0]": 1, "a.b[1]": {}, '["x y"]': [], n: null }), { a: { b: [1, {}] }, "x y": [], n: null });
  assert.deepEqual(json.unflatten({ "": 5 }), 5);
  assert.deepEqual(json.unflatten({ "[0]": 1, "[1][0]": 2 }), [1, [2]]);
  assert.deepEqual(json.unflatten({ "a[2]": 1 }), { a: [null, null, 1] });
  assert.deepEqual(json.unflatten({ a: 1, "a.b": 2 }), { a: { b: 2 } });
  assert.deepEqual(json.unflatten({ "a.b": 2, a: 1 }), { a: 1 });
  assert.deepEqual(json.unflatten({}), {});
  assert.equal(json.unflatten({ "a..b": 1 }), null);
  assert.equal(json.unflatten(null), null);
  assert.equal(json.unflatten([1]), null);
  assert.equal(json.unflatten("a"), null);

  const leaf = { deep: [1] };
  const built = json.unflatten({ a: leaf, "a.more": 2 });
  assert.deepEqual(built, { a: { deep: [1], more: 2 } });
  assert.deepEqual(leaf, { deep: [1] });                             // the caller's leaf was copied, not written into

  const samples = [doc(), 5, null, "text", [], {}, [[1, [2, [3]]], { a: [] }],
    JSON.parse('{"": 1, "a.b": 2, "0": 3, "q\\"uote": [{"__proto__": {"x": 1}}], "sp ace": {"k": [true, false, null]}}')];
  for (const sample of samples) {
    assert.deepEqual(json.unflatten(json.flatten(sample)), sample);
    assert.deepEqual(Object.keys(json.flatten(sample)), json.listPaths(sample));
    assert.equal(json.countLeaves(sample), json.listPaths(sample).length);
  }
  assert.equal({}.x, undefined);
});

// ---------- copies ----------

test("sortKeys deep-copies with sorted keys", () => {
  const input = { b: 1, a: { d: 1, c: [{ z: 1, y: 2 }, 3] } };
  const sorted = json.sortKeys(input);
  assert.deepEqual(sorted, input);
  assert.deepEqual(Object.keys(sorted), ["a", "b"]);
  assert.deepEqual(Object.keys(sorted.a), ["c", "d"]);
  assert.deepEqual(Object.keys(sorted.a.c[0]), ["y", "z"]);
  assert.deepEqual(Object.keys(input), ["b", "a"]);
  assert.notEqual(sorted.a, input.a);
  assert.notEqual(sorted.a.c, input.a.c);
  assert.deepEqual(Object.keys(json.sortKeys({ b: 1, B: 2, a: 3, _: 4 })), ["B", "_", "a", "b"]);    // UTF-16 order: capitals, then _, then lower case
  assert.equal(json.sortKeys(5), 5);
  assert.equal(json.sortKeys(null), null);
  assert.deepEqual(json.sortKeys([{ b: 1, a: 2 }]), [{ a: 2, b: 1 }]);
  const date = new Date(0);
  assert.equal(json.sortKeys({ when: date }).when, date);
});

test("stableStringify sorts keys at every level", () => {
  // Expected texts written out by hand.
  assert.equal(json.stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(json.stableStringify({ z: [{ y: 1, x: 2 }], a: { c: null, b: "t" } }), '{"a":{"b":"t","c":null},"z":[{"x":2,"y":1}]}');
  assert.equal(json.stableStringify({ b: [1, 2], a: {} }, 2), '{\n  "a": {},\n  "b": [\n    1,\n    2\n  ]\n}');
  assert.equal(json.stableStringify({ 10: "a", 9: "b", a: 1 }), '{"10":"a","9":"b","a":1}');           // text order, not the engine's numeric order
  assert.equal(json.stableStringify({ a: 1, b: { c: 2, d: 3 } }), json.stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
  assert.equal(json.stableStringify("x"), '"x"');
  assert.equal(json.stableStringify(5), "5");
  assert.equal(json.stableStringify(null), "null");
  assert.equal(json.stableStringify(true), "true");
  assert.equal(json.stableStringify([]), "[]");
  assert.equal(json.stableStringify({}), "{}");
  assert.equal(json.stableStringify([], 2), "[]");
  assert.equal(json.stableStringify({ a: undefined, b: () => 1, c: 1 }), '{"c":1}');
  assert.equal(json.stableStringify([undefined, () => 1, NaN, Infinity, -0]), "[null,null,null,null,0]");
  assert.equal(json.stableStringify({ when: new Date(0) }), '{"when":"1970-01-01T00:00:00.000Z"}');
  assert.equal(json.stableStringify({ big: 10n }), '{"big":10}');
  assert.equal(json.stableStringify(undefined), null);
  assert.equal(json.stableStringify(() => 1), null);
  assert.equal(json.stableStringify(Symbol("s")), null);
  assert.equal(json.stableStringify(cyclic()), null);
});

test("stableStringify matches JSON.stringify on values whose keys are already sorted", () => {
  // JSON.stringify is the independent reference: for keys already in sorted order the two must agree exactly.
  const samples = [
    { a: 1, b: [true, false, null, "x", 1.5, -2, 1e21, 1e-7, 0.1], c: { d: {}, e: [], f: [[]] } },
    ["quote \" backslash \\ newline \n tab \t", cp(0x1F600), cp(0xE9), String.fromCharCode(1), String.fromCharCode(0x2028)],
    { "": 0, " ": 1, "a b": 2, é: 3 },
    [[[[1]]], [{ a: [{ b: [] }] }]],
    "text", 0, -1.25, null, false, [], {},
  ];
  for (const sample of samples) {
    for (const indent of [0, 1, 2, 4, 10, 25, "\t", "--", undefined, null, -3, 2.9]) {
      const reference = typeof indent === "number" || typeof indent === "string" ? JSON.stringify(sample, null, indent) : JSON.stringify(sample);
      assert.equal(json.stableStringify(sample, indent), reference, JSON.stringify([sample, indent]));
    }
    assert.deepEqual(JSON.parse(json.stableStringify(sample)), sample);
  }
  const shuffled = { n: null, list: [[1, 2], [3]], "my key": { 0: "zero" }, a: { b: [10, { c: "x" }] } };
  assert.equal(json.stableStringify(shuffled), json.stableStringify(doc()));
  assert.deepEqual(JSON.parse(json.stableStringify(shuffled, 2)), doc());
});

test("pick and omit", () => {
  const picked = json.pick({ a: 1, b: 2, c: 3 }, ["c", "a", "zz", "c"]);
  assert.deepEqual(picked, { c: 3, a: 1 });
  assert.deepEqual(Object.keys(picked), ["c", "a"]);
  assert.deepEqual(json.pick({ a: 1 }, []), {});
  assert.deepEqual(json.pick({ a: 1 }, ["toString", "constructor"]), {});
  assert.deepEqual(json.pick({ 0: "zero", a: 1 }, [0]), { 0: "zero" });
  assert.deepEqual(json.omit({ a: 1, b: 2, c: 3 }, ["b", "zz"]), { a: 1, c: 3 });
  assert.deepEqual(Object.keys(json.omit({ c: 1, b: 2, a: 3 }, ["b"])), ["c", "a"]);
  assert.deepEqual(json.omit({ a: 1 }, []), { a: 1 });
  const source = { a: 1, b: 2 };
  json.pick(source, ["a"]);
  json.omit(source, ["a"]);
  assert.deepEqual(source, { a: 1, b: 2 });
  for (const bad of [null, undefined, [1], "text", 5]) {
    assert.equal(json.pick(bad, ["a"]), null);
    assert.equal(json.omit(bad, ["a"]), null);
  }
  assert.equal(json.pick({ a: 1 }, "a"), null);
  assert.equal(json.omit({ a: 1 }, null), null);
});

// ---------- comparison ----------

test("deepEqual compares JSON values", () => {
  const same = [
    [1, 1], ["a", "a"], [null, null], [undefined, undefined], [NaN, NaN], [0, -0], [[], []], [{}, {}],
    [{ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 }],
    [[1, [2, [3]]], [1, [2, [3]]]],
    [new Date(5), new Date(5)],
    [doc(), doc()],
    [Object.create(null), {}],
  ];
  for (const [a, b] of same) {
    assert.equal(json.deepEqual(a, b), true, JSON.stringify([a, b]));
    assert.equal(json.deepEqual(b, a), true);
  }
  const different = [
    [1, 2], [1, "1"], [0, false], [null, undefined], [null, 0], [null, {}], [[], {}], [[1, 2], [2, 1]], [[1], [1, 2]],
    [{ a: 1 }, { a: 2 }], [{ a: 1 }, { b: 1 }], [{ a: 1 }, { a: 1, b: undefined }], [{ a: undefined }, {}], [{ a: [1] }, { a: { 0: 1 } }],
    [new Date(5), new Date(6)], [new Map(), new Map()], ["a", "A"], [{ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }],
  ];
  for (const [a, b] of different) {
    assert.equal(json.deepEqual(a, b), false, JSON.stringify([a, b]));
    assert.equal(json.deepEqual(b, a), false);
  }
  const map = new Map();
  assert.equal(json.deepEqual(map, map), true);
});

test("diffValues lists added, removed and changed nodes in path order", () => {
  const before = { a: 1, b: { c: 2, d: [1, 2, 3] }, e: "x" };
  const after = { g: null, b: { f: true, d: [1, 2], c: 3 }, a: 1 };
  assert.deepEqual(json.diffValues(before, after), [
    { path: "b.c", kind: "changed", before: 2, after: 3 },
    { path: "b.d[2]", kind: "removed", before: 3, after: undefined },
    { path: "b.f", kind: "added", before: undefined, after: true },
    { path: "e", kind: "removed", before: "x", after: undefined },
    { path: "g", kind: "added", before: undefined, after: null },
  ]);
  assert.deepEqual(Object.keys(json.diffValues({ a: 1 }, {})[0]), ["path", "kind", "before", "after"]);
  assert.deepEqual(json.diffValues({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), []);
  assert.deepEqual(json.diffValues(1, 1), []);
  assert.deepEqual(json.diffValues(undefined, undefined), []);
  assert.deepEqual(json.diffValues(1, 2), [{ path: "", kind: "changed", before: 1, after: 2 }]);
  assert.deepEqual(json.diffValues({ a: [1] }, { a: { 0: 1 } }), [{ path: "a", kind: "changed", before: [1], after: { 0: 1 } }]);
  assert.deepEqual(json.diffValues([1], [1, 2]), [{ path: "[1]", kind: "added", before: undefined, after: 2 }]);
  assert.deepEqual(json.diffValues({}, { "my key": { deep: [1] } }), [{ path: '["my key"]', kind: "added", before: undefined, after: { deep: [1] } }]);
  assert.deepEqual(json.diffValues([{ id: 1 }, { id: 2 }], [{ id: 2 }]), [
    { path: "[0].id", kind: "changed", before: 1, after: 2 },
    { path: "[1]", kind: "removed", before: { id: 2 }, after: undefined },
  ]);
  assert.deepEqual(json.diffValues({ b: 1, a: 1 }, { b: 2, a: 2 }).map((entry) => entry.path), ["a", "b"]);
  assert.deepEqual(json.diffValues({ a: null }, { a: undefined }), [{ path: "a", kind: "changed", before: null, after: undefined }]);

  // Replaying the entries on the first value gives the second (removals last to first, so array indexes hold).
  let replayed = before;
  const entries = json.diffValues(before, after);
  for (const entry of entries.filter((item) => item.kind !== "removed")) replayed = json.setPath(replayed, entry.path, entry.after);
  for (const entry of entries.filter((item) => item.kind === "removed").reverse()) replayed = json.deletePath(replayed, entry.path);
  assert.deepEqual(replayed, after);
});

test("mergeDeep merges objects and replaces everything else", () => {
  const a = { a: 1, b: { c: 2, d: [1, 2] }, e: 5 };
  const b = { b: { d: [9], f: true }, e: null, g: "new" };
  const merged = json.mergeDeep(a, b);
  assert.deepEqual(merged, { a: 1, b: { c: 2, d: [9], f: true }, e: null, g: "new" });
  assert.deepEqual(Object.keys(merged), ["a", "b", "e", "g"]);
  assert.deepEqual(a, { a: 1, b: { c: 2, d: [1, 2] }, e: 5 });
  assert.deepEqual(b, { b: { d: [9], f: true }, e: null, g: "new" });
  assert.notEqual(merged.b.d, b.b.d);
  assert.notEqual(json.mergeDeep(a, {}).b, a.b);
  assert.deepEqual(json.mergeDeep({ a: 1 }, { a: undefined, b: undefined }), { a: 1 });
  assert.deepEqual(json.mergeDeep({ a: 1 }, undefined), { a: 1 });
  assert.deepEqual(json.mergeDeep(undefined, { a: 1 }), { a: 1 });
  assert.deepEqual(json.mergeDeep(1, { a: 1 }), { a: 1 });
  assert.equal(json.mergeDeep({ a: 1 }, 2), 2);
  assert.equal(json.mergeDeep({ a: 1 }, null), null);
  assert.deepEqual(json.mergeDeep([1, 2, 3], [9]), [9]);
  assert.deepEqual(json.mergeDeep({ a: { b: 1 } }, { a: [1] }), { a: [1] });
  assert.deepEqual(json.mergeDeep({ a: [1] }, { a: { b: 1 } }), { a: { b: 1 } });
  assert.deepEqual(json.mergeDeep({ a: { b: { c: 1, d: 2 } } }, { a: { b: { c: 3 } } }), { a: { b: { c: 3, d: 2 } } });
  const risky = json.mergeDeep({}, JSON.parse('{"__proto__": {"polluted": true}}'));
  assert.equal({}.polluted, undefined);
  assert.equal(risky.polluted, undefined);
  assert.deepEqual(Object.keys(risky), ["__proto__"]);
});

// ---------- JSON text ----------

test("duplicateKeys finds keys JSON.parse silently drops", () => {
  assert.equal(JSON.parse('{"a":1,"a":2}').a, 2);                   // the behavior this function exists to expose
  assert.deepEqual(json.duplicateKeys('{"a":1,"b":2}'), []);
  assert.deepEqual(json.duplicateKeys('{"a":1,"a":2}'), ["a"]);
  assert.deepEqual(json.duplicateKeys('{"a":{"b":1,"b":2,"b":3},"c":[{"id":1},{"id":1,"id":2}]}'), ["a.b", "c[1].id"]);
  assert.deepEqual(json.duplicateKeys('{"my key":1,"my key":2}'), ['["my key"]']);
  assert.deepEqual(json.duplicateKeys(`{"a":1,"${"\\"}u0061":2}`), ["a"]);                            // an escaped spelling of the same key
  assert.deepEqual(json.duplicateKeys('{"a":"{\\"a\\":1,\\"a\\":2}","b":"}","c":"a"}'), []);        // text inside string values is not keys
  assert.deepEqual(json.duplicateKeys('{"a":{"a":{"a":1}}}'), []);
  assert.deepEqual(json.duplicateKeys('[{"a":1},{"a":2}]'), []);
  assert.deepEqual(json.duplicateKeys('{"a":{"x":1,"x":2},"a":{"y":1}}'), ["a.x", "a"]);
  assert.deepEqual(json.duplicateKeys('{\n  "state": {"order": 1},\n  "questions": [],\n  "state": {"order": 2, "order": 3}\n}'), ["state", "state.order"]);
  assert.deepEqual(json.duplicateKeys('[[{"k":1,"k":2}],[[{"k":1}],{"":0,"":1}]]'), ["[0][0].k", '[1][1][""]']);
  assert.deepEqual(json.duplicateKeys('{"a":[1,2,{"b":"x","c":[],"b":null}]}'), ["a[2].b"]);
  assert.deepEqual(json.duplicateKeys('{"a\\\\":1,"a\\\\":2,"q\\"":1,"q\\"":2}'), ['["a\\\\"]', '["q\\""]']);
  for (const scalar of ["5", '"a"', "null", "[]", "{}", ' [1, "a,a", {"a": "a"}] ']) assert.deepEqual(json.duplicateKeys(scalar), [], scalar);
  for (const invalid of ['{"a":1,}', "", "{", '{"a":1,"a":2', "{a:1,a:2}", null, undefined]) assert.equal(json.duplicateKeys(invalid), null, String(invalid));
  for (const path of json.duplicateKeys('{"a":{"b":1,"b":2},"c":[{"id":1},{"id":1,"id":2}]}')) {
    assert.notEqual(json.getPath(JSON.parse('{"a":{"b":1,"b":2},"c":[{"id":1},{"id":1,"id":2}]}'), path), undefined, path);
  }
});

// ---------- outside the domain ----------

test("cyclic values never loop forever", () => {
  const value = cyclic();
  assert.equal(json.depth(value), 2);                               // the object and its items array; the cycle is not entered
  assert.equal(json.walk(value, () => {}), 6);                      // root, name, items, items[0], items[1] (the cycle), self (the cycle)
  assert.deepEqual(json.listPaths(value), ["name", "items[0]"]);
  assert.equal(json.sortKeys(value).self, value);
  assert.equal(json.deepEqual(value, value), true);
  assert.equal(json.deepEqual(value, cyclic()), false);
  assert.ok(Array.isArray(json.diffValues(value, cyclic())));
  assert.equal(json.mergeDeep(value, { extra: 1 }).extra, 1);
  assert.equal(json.stableStringify(value), null);
});
