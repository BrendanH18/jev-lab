import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const body = (name) => workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

function handoffHarness(api, confirm = () => true) {
  const questions = { urgent: { type: "noul", instructions: "Urgent?" } };
  const source = [{ text: "held", _test: true, _expect: { urgent: true } }, { text: "duplicate" },
    { text: "duplicate", _expect: { urgent: false } }];
  const prepared = { items: [{ index: 1, row: { text: "duplicate" }, missing: ["urgent"] }],
    questions, eligible: 1, missing: 1, fields: [], values: [], field: null, value: null };
  const W = { tab: "compare", questions: ["old"], result: { old: true },
    compare: { qid: "urgent", sourceText: JSON.stringify(source),
      result: { variants: [{ questions }], results: [] }, report: { disagreements: [{ index: 0, answers: ["secret answer"] }] } },
    bulk: { rowsText: "current", savedText: "saved", source: "sample", dataset: { id: "retained" }, labelsDirty: true,
      labels: { 0: { urgent: true } }, prelabel: { drafts: { 0: { urgent: false } } }, health: { report: { old: true } } } };
  const location = {};
  const messages = [];
  const fn = new Function("W", "api", "canon", "rowsPayload", "fromQuestions", "toQuestions", "confirm", "render", "toast",
    "handleError", "loadPictureUrls", "location", "syncAttachedSets", "$", "applyBuildQuestions", body("handoffCompareDisagreements") + "; return handoffCompareDisagreements;"
  )(W, (path, data) => api(path, data, prepared), JSON.stringify, JSON.parse, (q) => q, (q) => q, confirm,
    () => {}, (text) => messages.push(text), (error) => { throw error; }, async () => {}, location, () => {}, () => null, (q) => { W.questions = q; W.result = null; W.raw = false; return true; });
  return { W, fn, prepared, source, location, messages };
}

test("handoff sends only source inputs/schema/indices and opens blank controls against full original rows", async () => {
  const calls = [];
  const x = handoffHarness(async (path, data, prepared) => { calls.push({ path, data }); return prepared; });
  await x.fn();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/workbench/compare/labeling");
  assert.deepEqual(Object.keys(calls[0].data).sort(), ["indices", "qid", "questions", "rows"]);
  assert.ok(!JSON.stringify(calls).includes("secret answer"));
  assert.deepEqual(JSON.parse(x.W.bulk.rowsText), x.source);
  assert.equal(x.W.bulk.savedText, "saved", "does not mark the rows saved");
  assert.equal(x.W.bulk.dataset.id, "retained");
  assert.equal(x.W.bulk.result, null);
  assert.deepEqual(x.W.bulk.prelabel.drafts, {});
  assert.deepEqual(x.W.bulk.prelabel.report, x.prepared);
  assert.equal(x.W.bulk.prelabel.context, JSON.stringify([x.W.bulk.rowsText, x.prepared.questions, false]));
  assert.equal(x.location.hash, "bulk");
});

test("canceling handoff preserves Build, editor labels, and unfinished drafts", async () => {
  const x = handoffHarness(async (_, __, prepared) => prepared, () => false);
  const before = JSON.parse(JSON.stringify({ questions: x.W.questions, bulk: x.W.bulk }));
  await x.fn();
  assert.deepEqual({ questions: x.W.questions, bulk: x.W.bulk }, before);
  assert.equal(x.W.tab, "compare");
});

test("pending handoff is rejected when rows, question schema or drafts changed", async () => {
  for (const change of [
    (x) => { x.W.bulk.rowsText = "new row edit"; },
    (x) => { x.W.questions = ["new question edit"]; },
    (x) => { x.W.bulk.prelabel.drafts[0].urgent = true; },
  ]) {
    let finish;
    let confirmed = false;
    const x = handoffHarness(() => new Promise((resolve) => { finish = resolve; }), () => { confirmed = true; return true; });
    const pending = x.fn();
    change(x);
    const changed = JSON.parse(JSON.stringify({ questions: x.W.questions, bulk: x.W.bulk }));
    finish(x.prepared);
    await pending;
    assert.equal(confirmed, false);
    assert.deepEqual({ questions: x.W.questions, bulk: x.W.bulk }, changed);
  }
});

test("already labeled disagreements leave the current editor untouched", async () => {
  const x = handoffHarness(async () => ({ items: [] }));
  await x.fn();
  assert.equal(x.W.bulk.rowsText, "current");
  assert.match(x.messages[0], /already have labels/);
});

test("Compare slice controls retain full value identity behind display truncation", () => {
  const report = { fields: [{ name: "channel" }], field: "channel", slices: [{ value: "full-value-A", shown: "full…", rows: 1,
    paired: { rows: 1, p_value: 1 }, variants: Array.from({ length: 2 }, () => ({ correct: 1, labeled: 1,
      accuracy: 1, accuracy_low: .2, accuracy_high: 1, targets: [{ target: .95, threshold: null, coverage: null }] })) }] };
  const h = (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((child) => child != null), addEventListener() {} });
  const fn = new Function("W", "h", "rescoreCompare", "render", "pct", "withCI", body("compareSlices") + "; return compareSlices;")(
    { compare: { slices: report } }, h, async () => {}, () => {}, String, (value) => value);
  const text = JSON.stringify(fn());
  assert.match(text, /full-value-A/);
  assert.match(text, /full…/);
  assert.match(text, /not reached/);
});
