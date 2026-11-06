import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../static/js/workbench.js", import.meta.url), "utf8");
const handler = source.match(/async function checkHealth\(\) \{[\s\S]*?\n\}/)[0];
const renderer = source.match(/function healthBody\(\) \{[\s\S]*?\n\}/)[0];
const report = { rows: 2, unique_inputs: 1, duplicate_groups: [{ rows: [1, 2] }],
  conflicts: [{ question: "urgent", rows: [1, 2] }], overlap: [{ training: [1], test: [2] }],
  questions: [{ qid: "urgent", labeled: 1, missing: 1, missing_rows: [2], invalid: [] }], invalid_labels: [] };

function harness(api, settle = () => true) {
  const W = { bulk: { rowsText: "first", health: { busy: false, report: null, context: null } } };
  let questions = { urgent: { type: "noul", instructions: "Urgent?" } };
  const context = () => JSON.stringify([W.bulk.rowsText, questions]);
  const h = (tag, attrs, ...children) => ({ tag, attrs, children });
  const check = new Function("W", "api", "healthContext", "bulkQuestions", "rowsPayload", "settleLabels", "render", "handleError",
    `${handler}; return checkHealth;`)(W, api, context, () => questions, () => W.bulk.rowsText, settle, () => {}, (e) => { throw e; });
  const body = new Function("W", "healthContext", "checkHealth", "h", `${renderer}; return healthBody;`)(W, context, check, h);
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

for (const changed of ["rows", "questions"]) {
  test(`discards a response when ${changed} change while inspection is pending`, async () => {
    let finish;
    const x = harness(() => new Promise((resolve) => { finish = resolve; }));
    const pending = x.check();
    if (changed === "rows") x.W.bulk.rowsText = "changed";
    else x.changeQuestions();
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
