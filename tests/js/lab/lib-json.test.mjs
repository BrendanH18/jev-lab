// static/js/lab/lib/json.js: stableStringify, the JSON helper Lab imports. Run with:
// node --test tests/js/lab/lib-json.test.mjs
// Every expected value is written out by hand from the function's stated rule, or comes from an independent source:
// JSON.stringify and JSON.parse (the platform's own JSON). Nothing is copied from the output of the code under test.
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
  assert.deepEqual(Object.keys(json), ["stableStringify"]);
});

test("stableStringify sorts keys at every level", () => {
  // Expected texts written out by hand.
  assert.equal(json.stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(
    json.stableStringify({ z: [{ y: 1, x: 2 }], a: { c: null, b: "t" } }),
    '{"a":{"b":"t","c":null},"z":[{"x":2,"y":1}]}',
  );
  assert.equal(json.stableStringify({ b: [1, 2], a: {} }, 2), '{\n  "a": {},\n  "b": [\n    1,\n    2\n  ]\n}');
  assert.equal(json.stableStringify({ 10: "a", 9: "b", a: 1 }), '{"10":"a","9":"b","a":1}'); // text order, not the engine's numeric order
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
  assert.equal(
    json.stableStringify(() => 1),
    null,
  );
  assert.equal(json.stableStringify(Symbol("s")), null);
  assert.equal(json.stableStringify(cyclic()), null);
});

test("stableStringify matches JSON.stringify on values whose keys are already sorted", () => {
  // JSON.stringify is the independent reference: for keys already in sorted order the two must agree exactly.
  const samples = [
    { a: 1, b: [true, false, null, "x", 1.5, -2, 1e21, 1e-7, 0.1], c: { d: {}, e: [], f: [[]] } },
    [
      'quote " backslash \\ newline \n tab \t',
      cp(0x1f600),
      cp(0xe9),
      String.fromCharCode(1),
      String.fromCharCode(0x2028),
    ],
    { "": 0, " ": 1, "a b": 2, é: 3 },
    [[[[1]]], [{ a: [{ b: [] }] }]],
    "text",
    0,
    -1.25,
    null,
    false,
    [],
    {},
  ];
  for (const sample of samples) {
    for (const indent of [0, 1, 2, 4, 10, 25, "\t", "--", undefined, null, -3, 2.9]) {
      const reference =
        typeof indent === "number" || typeof indent === "string"
          ? JSON.stringify(sample, null, indent)
          : JSON.stringify(sample);
      assert.equal(json.stableStringify(sample, indent), reference, JSON.stringify([sample, indent]));
    }
    assert.deepEqual(JSON.parse(json.stableStringify(sample)), sample);
  }
  const shuffled = { n: null, list: [[1, 2], [3]], "my key": { 0: "zero" }, a: { b: [10, { c: "x" }] } };
  assert.equal(json.stableStringify(shuffled), json.stableStringify(doc()));
  assert.deepEqual(JSON.parse(json.stableStringify(shuffled, 2)), doc());
});
