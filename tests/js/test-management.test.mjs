import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { visibleTests, testInputBytes, testMetadataCsv, testMetadataJson, testStatusSummary, selectedTestIds } from "../../static/js/test-selection.js";

const items = [
  { id: "ticket-new", name: '=HYPERLINK("private")', state: "é☕", questions: { q: { type: "choice", instructions: "PRIVATE INSTRUCTION" } }, notes: "PRIVATE NOTE", expect: { q: "PRIVATE LABEL" } },
  { id: "ticket-box", name: "Box", state: { text: "private" }, questions: { q: { type: "box" } }, images: { photo: "PRIVATE PICTURE" } },
  { id: "order", name: "Order", state: "ok", questions: { q: { type: "noul" } } },
];
const results = { runs: [
  { id: "ticket-new", ok: true, meta: { latency_ms: 7, cost_usd: 0.001 }, answers: "PRIVATE ANSWER", trace: "PRIVATE TRACE" },
  { id: "ticket-box", error: "PRIVATE ERROR" },
] };
const ids = (rows) => rows.map((row) => row.id);

test("ID prefix and excluded type intersect without touching hidden selections", () => {
  const before = JSON.stringify(items);
  assert.deepEqual(ids(visibleTests(items, results, { idPrefix: " TICKET- ", excludeType: "box" })), ["ticket-new"]);
  assert.deepEqual(ids(visibleTests(items, results, { idPrefix: "ticket", type: "box", excludeType: "box" })), []);
  assert.deepEqual(selectedTestIds(items, ["order", "ticket-box"]), ["ticket-box", "order"]);
  assert.equal(JSON.stringify(items), before);
});

test("state byte bounds count UTF-8 and serialize JSON without including pictures", () => {
  assert.equal(testInputBytes(items[0]), 5);
  assert.equal(testInputBytes(items[1]), new TextEncoder().encode(JSON.stringify(items[1].state)).length);
  assert.deepEqual(ids(visibleTests(items, null, { minStateBytes: "5", maxStateBytes: "5" })), ["ticket-new"]);
  for (const field of ["minStateBytes", "maxStateBytes"]) {
    for (const value of ["-1", "NaN", "1.5"]) assert.deepEqual(visibleTests(items, null, { [field]: value }), []);
    assert.equal(visibleTests(items, null, { [field]: " " }).length, 3);
  }
});

test("input size sorts are stable and do not mutate original saved order", () => {
  assert.deepEqual(ids(visibleTests(items, null, { sort: "input-smallest" })), ["order", "ticket-new", "ticket-box"]);
  assert.deepEqual(ids(visibleTests(items, null, { sort: "input-largest" })), ["ticket-box", "ticket-new", "order"]);
  assert.deepEqual(ids(visibleTests([items[0], { ...items[0], id: "copy" }], null, { sort: "input-smallest" })), ["ticket-new", "copy"]);
  assert.equal(items[0].id, "ticket-new");
});

test("CSV shares metadata JSON allowlist and escapes spreadsheet formulas and quotes", () => {
  const csv = testMetadataCsv(items, results);
  assert.match(csv, /"'=HYPERLINK\(""private""\)"/);
  assert.ok(csv.endsWith("\r\n"));
  for (const secret of ["PRIVATE INSTRUCTION", "PRIVATE NOTE", "PRIVATE LABEL", "PRIVATE PICTURE", "PRIVATE ANSWER", "PRIVATE ERROR", "PRIVATE TRACE"]) {
    assert.ok(!csv.includes(secret));
    assert.ok(!testMetadataJson(items, results).includes(secret));
  }
  for (const name of ["+SUM(1)", " @formula", "-1+2", "\tthing", "\nthing"]) {
    assert.ok(testMetadataCsv([{ ...items[0], name }], null).includes(`"'${name}"`));
  }
  const selected = items.filter((item) => selectedTestIds(items, ["order", "ticket-new"]).includes(item.id));
  assert.deepEqual(JSON.parse(testMetadataJson(selected, results)).map((row) => row.id), ["ticket-new", "order"]);
  assert.ok(!testMetadataCsv(selected, results).includes("ticket-box"));
});

test("visible status summary contains current session status counts only", () => {
  assert.equal(testStatusSummary(items, results), "1 passed · 0 failed · 1 errors · 1 not run among shown tests");
  assert.equal(testStatusSummary(visibleTests(items, results, { excludeType: "box" }), results), "1 passed · 0 failed · 0 errors · 1 not run among shown tests");
  assert.equal(testStatusSummary([], results), "0 passed · 0 failed · 0 errors · 0 not run among shown tests");
});

test("new test controls use current visible scope or full selected scope", () => {
  const source = readFileSync(new URL("../../static/js/workbench-tests.js", import.meta.url), "utf8");
  assert.match(source, /downloadTestMetadata\(shownTests\(\), "csv"\)/);
  for (const format of ["json", "csv"]) {
    assert.ok(source.includes(`downloadTestMetadata(W.items.filter((item) => testView.selected.includes(item.id)), "${format}")`));
  }
  for (const label of ["Test ID prefix", "Exclude question type", "Minimum state bytes", "Maximum state bytes", "Smallest state inputs", "Largest state inputs", "Download visible metadata CSV", "Download selected metadata JSON", "Download selected metadata CSV"]) {
    assert.ok(source.includes(label), label);
  }
  assert.match(source, /statuses\.textContent = testStatusSummary\(shown, W\.runResults\)/);
});


test("state encoding is skipped when unused and reused across bounds and sorting", () => {
  let encodings = 0;
  const Encoder = globalThis.TextEncoder;
  globalThis.TextEncoder = class extends Encoder {
    encode(value) { encodings++; return super.encode(value); }
  };
  try {
    visibleTests(items, null);
    assert.equal(encodings, 0);
    visibleTests(items, null, { minStateBytes: "0", maxStateBytes: "1000", sort: "input-largest" });
    assert.equal(encodings, items.length);
    items[0].state = "changed input";
    visibleTests(items, null, { sort: "input-smallest" });
    assert.equal(encodings, items.length * 2, "cache must not outlive the current request");
  } finally {
    items[0].state = "é☕";
    globalThis.TextEncoder = Encoder;
  }
});
