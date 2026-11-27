// static/js/lab/lib/text.js: slugify and fingerprint, the text helpers Lab packs import. Run with:
// node --test tests/js/lab/lib-text.test.mjs
// Every expected value here is derived without the code under test: written out by hand, taken from a published
// table (the FNV test vectors) or computed with Python (a byte-by-byte FNV-1a loop). The comment at each test says
// which.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as text from "../../../static/js/lab/lib/text.js";

const cp = (...codes) => String.fromCodePoint(...codes);
const E_ACUTE = cp(0xe9); // precomposed e with acute accent
const GRIN = cp(0x1f600); // an astral emoji: one code point, two UTF-16 units, four UTF-8 bytes
const LONE_SURROGATE = String.fromCharCode(0xd83d);
const CAFE = `caf${E_ACUTE}`;

test("the module exports exactly slugify and fingerprint, and both read null and undefined as empty text", () => {
  assert.deepEqual(Object.keys(text).sort(), ["fingerprint", "slugify"]);
  for (const name of ["fingerprint", "slugify"]) {
    assert.equal(text[name](null), text[name](""), `${name}(null)`);
    assert.equal(text[name](undefined), text[name](""), `${name}(undefined)`);
  }
});

// ---------- identifiers ----------

test("slugify", () => {
  // Expected names written out by hand.
  assert.equal(text.slugify("Hello, World!"), "hello-world");
  assert.equal(text.slugify(`Cr${cp(0xe8)}me Br${cp(0xfb)}l${E_ACUTE}e`), "creme-brulee");
  assert.equal(text.slugify("  --a--b-- "), "a-b");
  assert.equal(text.slugify("Don't stop"), "dont-stop");
  assert.equal(text.slugify("Hello World", "_"), "hello_world");
  assert.equal(text.slugify("Hello World", ""), "helloworld");
  assert.equal(text.slugify("Hello World", null), "hello-world");
  assert.equal(text.slugify("helloWorld"), "helloworld");
  assert.equal(text.slugify(`Stra${cp(0xdf)}e`), "strasse");
  assert.equal(text.slugify(cp(0x65e5, 0x672c)), "");
  assert.equal(text.slugify(""), "");
  assert.equal(text.slugify("Q3 2024 report.final"), "q3-2024-report-final");
});

// ---------- change detection ----------

test("fingerprint is FNV-1a 32-bit over UTF-8", () => {
  // "", "a", "b" and "foobar" are from the published FNV test vectors (Noll's test suite, FNV-1a 32-bit). The rest
  // were computed in Python with the defining loop: h = 0x811c9dc5; for each utf-8 byte: h ^= byte; h = h * 0x01000193 mod 2^32.
  assert.equal(text.fingerprint(""), "811c9dc5");
  assert.equal(text.fingerprint("a"), "e40c292c");
  assert.equal(text.fingerprint("b"), "e70c2de5");
  assert.equal(text.fingerprint("foobar"), "bf9cf968");
  assert.equal(text.fingerprint("Harbor Coffee Co."), "3fa9f79d");
  assert.equal(text.fingerprint(`${CAFE} ${cp(0x2615)}`), "52bdf2b4");
  assert.equal(text.fingerprint(GRIN), "33a29608");
  assert.equal(text.fingerprint(LONE_SURROGATE), "03479c4a"); // hashed as U+FFFD
  assert.equal(text.fingerprint(null), "811c9dc5");
  assert.match(text.fingerprint("x".repeat(10000)), /^[0-9a-f]{8}$/);
  assert.notEqual(text.fingerprint("ab"), text.fingerprint("ba"));
});
