import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const source = workbenchSource;
const handler = source.match(/async function checkHealth\(\) \{[\s\S]*?\n\}/)[0];
const renderer = source.match(/function healthBody\(\) \{[\s\S]*?\n\}/)[0];
const slicesRenderer = source.match(/function healthSlices\([^\n]*\) \{[\s\S]*?\n\}/)[0];
const report = { rows: 2, unique_inputs: 1, duplicate_groups: [{ rows: [1, 2] }],
  conflicts: [{ question: "urgent", rows: [1, 2] }], overlap: [{ training: [1], test: [2] }],
  questions: [{ qid: "urgent", labeled: 1, missing: 1, missing_rows: [2], invalid: [] }], invalid_labels: [] };

function harness(api, settle = () => true) {
  const W = { bulk: { rowsText: "first", health: { busy: false, report: null, context: null, field: null } } };
  let questions = { urgent: { type: "noul", instructions: "Urgent?" } };
  const context = new Function("W", "bulkQuestions", "canon", "return " + source.match(/const healthContext = (.*);/)[1])(W, () => questions, JSON.stringify);
  const h = (tag, attrs, ...children) => ({ tag, attrs, children });
  const check = new Function("W", "api", "healthContext", "bulkQuestions", "rowsPayload", "settleLabels", "render", "handleError",
    `${handler}; return checkHealth;`)(W, api, context, () => questions, () => W.bulk.rowsText, settle, () => {}, (e) => { throw e; });
  const body = new Function("W", "healthContext", "checkHealth", "h", `${slicesRenderer}; ${renderer}; return healthBody;`)(W, context, check, h);
  return { W, check, body, changeQuestions: () => { questions = {}; } };
}

test("inspects current rows and questions, and shows row numbers without label values", async () => {
  const x = harness(async (path, data) => {
    assert.equal(path, "/api/workbench/health");
    assert.equal(data.rows, "first");
    assert.equal(data.questions.urgent.type, "noul");
    return report;
  });
  await x.check();
  assert.equal(x.W.bulk.health.busy, false);
  assert.equal(x.W.bulk.health.report, report);
  const text = JSON.stringify(x.body());
  for (const message of ["Duplicate inputs", "Rows 1, 2", "Conflicting labels", "Tuning / test overlap", "Missing", "Row numbers"]) {
    assert.ok(text.includes(message), message);
  }
  x.W.bulk.rowsText = "changed";
  assert.ok(!JSON.stringify(x.body()).includes("Duplicate inputs"), "edited rows hide old findings");
});

for (const changed of ["rows", "questions", "field"]) {
  test(`discards a response when ${changed} change while inspection is pending`, async () => {
    let finish;
    const x = harness(() => new Promise((resolve) => { finish = resolve; }));
    const pending = x.check();
    if (changed === "rows") x.W.bulk.rowsText = "changed";
    else if (changed === "questions") x.changeQuestions();
    else x.W.bulk.health.field = "language";
    finish(report);
    await pending;
    assert.equal(x.W.bulk.health.report, null);
    assert.equal(x.W.bulk.health.busy, false);
  });
}

test("does not inspect when settling edited labels is cancelled", async () => {
  let called = false;
  const x = harness(async () => { called = true; }, () => false);
  await x.check();
  assert.equal(called, false);
});

test("selecting a health field requests counts and hides a response for a previous field", async () => {
  const split = { rows: 2, unique_inputs: 1, questions: [{ qid: "urgent", labeled: 1, missing: 1, invalid: 0 }] };
  const by_slice = { fields: [{ name: "channel", values: 2 }], field: null, slices: [] };
  const requests = [];
  const x = harness(async (_path, data) => {
    requests.push(data);
    return { ...report, by_slice: { ...by_slice, field: data.field,
      slices: data.field ? [{ value: "email", rows: 4, unique_inputs: 1, tuning: split, test: split }] : [] } };
  });
  await x.check();
  const find = (n, tag) => !n || typeof n !== "object" ? [] : Array.isArray(n) ? n.flatMap((c) => find(c, tag))
    : [...(n.tag === tag ? [n] : []), ...find(n.children, tag)];
  const [select] = find(x.body(), "select");
  select.attrs.onchange({ target: { value: "channel" } });
  // Let the async inspection install the response.
  await Promise.resolve();
  assert.equal(requests.at(-1).field, "channel");
  const text = JSON.stringify(x.body());
  for (const label of ["email", "Held-out", "Tuning", "Distinct inputs", "Invalid"]) assert.ok(text.includes(label), label);
  x.changeQuestions();
  assert.ok(!JSON.stringify(x.body()).includes("email"), "question edits hide stale slice counts");
});

test("cannot start a second health request while the first is pending", async () => {
  let finish;
  let calls = 0;
  const x = harness(() => { calls++; return new Promise((r) => { finish = r; }); });
  const first = x.check();
  await x.check();
  assert.equal(calls, 1);
  finish(report);
  await first;
});
