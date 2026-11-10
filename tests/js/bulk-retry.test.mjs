import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bulkRetryContext, unansweredBulkIndices, bulkRetryPlan, mergeBulkRetry, clearBulkRetryReports } from "../../static/js/bulk-retry.js";
import { W } from "../../static/js/workbench-state.js";

const questions = { team: { type: "choice", instructions: "Which team?", criteria: { billing: "Refunds", shipping: "Parcels" } } };
const request = () => ({ rowsText: "original rows", rows: [{ text: "same" }, { text: "same", _image: "torn-bag" }, { text: "hold", _test: true }],
  questions: structuredClone(questions), model: "jev-latest", source: "current", datasetId: null });
const answer = (index, model = "jev-1.14.0") => ({ index, row: { text: "same" }, answers: { team: { type: "choice", choice: "billing" } },
  meta: { model, cost_usd: 0.01, input_tokens: 10 } });
const result = () => ({ results: [answer(0), { index: 1, row: { text: "same", _image: "torn-bag" }, expect: { team: "shipping" }, error: "try again" },
  { index: 2, row: { text: "hold", _test: true }, skipped: true }], rows: 3, completed: 1, labeled: 1,
  cost_usd: 0.01, input_tokens: 10, wall_ms: 100, stopped: "budget", model: "jev-latest" });
const attempt = (results) => ({ results, completed: results.filter((row) => row.answers).length, rows: results.length,
  cost_usd: 0.02, input_tokens: 20, wall_ms: 200, stopped: null, model: "jev-1.14.0" });

test("retry selects only unanswered original positions and pins the successful version", () => {
  const original = request();
  const plan = bulkRetryPlan(result(), original, structuredClone(original));
  assert.deepEqual(plan.indices, [1, 2]);
  assert.equal(plan.body.model, "jev-1.14.0");
  assert.equal(plan.body.rows, original.rows);
  assert.equal(plan.body.questions, original.questions);
  assert.equal(plan.body.rows[1]._image, "torn-bag");
  assert.equal(plan.body.rows[2]._test, true);
});

test("changed rows, ordered Choice options, model, dataset, source and invalid questions block retries", () => {
  const original = request();
  const changed = [
    { ...original, rowsText: "changed rows" },
    { ...original, questions: { team: { ...questions.team, criteria: { shipping: "Parcels", billing: "Refunds" } } } },
    { ...original, model: "jev-1.15.0" }, { ...original, datasetId: "other" }, { ...original, source: "sample" },
    { ...original, error: "duplicate question id" },
  ];
  for (const current of changed) assert.equal(bulkRetryPlan(result(), original, current).body, null);
  assert.notEqual(bulkRetryContext(original), bulkRetryContext(changed[1]));
  assert.equal(bulkRetryPlan(result(), null, original).body, null);
});

test("unknown or mixed successful model versions cannot be combined", () => {
  const original = request();
  for (const models of [["jev-latest"], [undefined], ["jev-1.14.0", "jev-1.15.0"]]) {
    const previous = result();
    previous.results = [...models.map((model, index) => ({ ...answer(index), meta: { model } })), { index: 9, skipped: true }];
    assert.equal(bulkRetryPlan(previous, original, original).body, null);
  }
});

test("sparse merges preserve successful calls, original inputs and labels while accumulating real attempt totals", () => {
  const previous = result();
  const merged = mergeBulkRetry(previous, attempt([answer(2), { index: 1, error: "rate limit", row: { wrong: true } }]), [1, 2], "jev-1.14.0");
  assert.equal(merged.results[0], previous.results[0]);
  assert.equal(merged.results[1].row, previous.results[1].row);
  assert.equal(merged.results[1].expect, previous.results[1].expect);
  assert.equal(merged.results[2].row._test, true);
  assert.deepEqual(unansweredBulkIndices(merged), [1]);
  assert.equal(merged.completed, 2);
  assert.equal(merged.rows, 3);
  assert.equal(merged.cost_usd, 0.03);
  assert.equal(merged.input_tokens, 30);
  assert.equal(merged.wall_ms, 300);
  assert.equal(merged.stopped, null);
  const complete = mergeBulkRetry(merged, attempt([answer(1)]), [1], "jev-1.14.0");
  assert.equal(complete.completed, 3);
  assert.deepEqual(unansweredBulkIndices(complete), []);
  assert.equal(complete.input_tokens, 50);
  assert.equal(complete.wall_ms, 500);
});

test("a run with no successes can recover through its alias, then pins subsequent retries", () => {
  const original = request();
  const previous = result();
  previous.results[0] = { index: 0, row: previous.results[0].row, skipped: true };
  const plan = bulkRetryPlan(previous, original, original);
  assert.equal(plan.body.model, "jev-latest");
  const merged = mergeBulkRetry(previous, attempt([answer(0), { index: 1, error: "limit" }, { index: 2, skipped: true }]), plan.indices, plan.body.model);
  assert.equal(merged.completed, 1);
  assert.equal(bulkRetryPlan(merged, original, original).body.model, "jev-1.14.0");
});

test("unexpected models remain unanswered while their real spend stays counted", () => {
  const previous = result();
  const merged = mergeBulkRetry(previous, attempt([answer(1, "jev-1.15.0"), { index: 2, skipped: true }]), [1, 2], "jev-1.14.0");
  assert.equal(merged.completed, 1);
  assert.equal(merged.results[1].answers, undefined);
  assert.match(merged.results[1].error, /model version/);
  assert.equal(merged.cost_usd, 0.03);
  assert.equal(merged.input_tokens, 30);
});

test("retry merge refuses successful, repeated, missing or unexpected positions", () => {
  for (const [rows, indices] of [[[answer(0)], [0]], [[answer(1)], [1, 1]], [[answer(1)], [1, 2]],
    [[answer(1), answer(1)], [1, 2]], [[answer(1), answer(7)], [1, 2]]]) {
    assert.throws(() => mergeBulkRetry(result(), attempt(rows), indices, "jev-1.14.0"), /Retry/);
  }
});

test("refresh invalidates fitted and measured reports but preserves human labels and policy configuration", () => {
  const bulk = structuredClone(W.bulk);
  bulk.labels = { 1: { team: "shipping" } };
  bulk.labelsDirty = true;
  bulk.policy.gates = { team: { on: true, t: 0.81 } };
  bulk.rules.text = bulk.rules.applied = "if team = billing then team in billing";
  bulk.sets.attached = { team: { cut: 0.2 } };
  for (const state of [bulk.cal, bulk.policy]) { state.report = {}; state.holdout = {}; state.holdoutSeq = 5; }
  bulk.policy.prune.report = {};
  bulk.testScore = bulk.gateExport = bulk.slice.cal = bulk.slice.pol = bulk.review.report = bulk.rules.report = bulk.sets.report = {};
  clearBulkRetryReports(bulk);
  assert.deepEqual(bulk.labels, { 1: { team: "shipping" } });
  assert.equal(bulk.labelsDirty, true);
  assert.deepEqual(bulk.policy.gates, { team: { on: true, t: 0.81 } });
  assert.match(bulk.rules.applied, /billing/);
  assert.equal(bulk.cal.report, null);
  assert.equal(bulk.policy.report, null);
  assert.equal(bulk.policy.holdoutSeq, 6);
  assert.equal(bulk.testScore, null);
  assert.equal(bulk.gateExport, null);
  assert.deepEqual(bulk.sets.attached, {});
});

const source = readFileSync(new URL("../../static/js/workbench-bulk.js", import.meta.url), "utf8");
const retryBody = source.match(/async function retryBulk\(\) \{[\s\S]*?\n\}/)[0];
const snapshotBody = source.match(/function bulkRequestSnapshot\(\) \{[\s\S]*?\n\}/)[0];
const runBody = source.match(/async function runBulk\(\) \{[\s\S]*?\n\}/)[0];

test("the actual request snapshot detaches nested rows and ordered questions from editor mutations", () => {
  const original = request();
  const state = { bulk: { rowsText: original.rowsText, source: original.source, dataset: { id: null } } };
  const snapshot = new Function("W", "rowsPayload", "bulkQuestions", "currentStatus", `${snapshotBody}; return bulkRequestSnapshot;`)(
    state, () => original.rows, () => original.questions, () => ({ model: original.model }));
  const captured = snapshot();
  original.rows[1]._image = "intact-bag";
  original.questions.team.criteria.billing = "Changed wording";
  assert.equal(captured.rows[1]._image, "torn-bag");
  assert.equal(captured.questions.team.criteria.billing, "Refunds");
});

test("an initial Bulk completion cannot replace current results after an editor or model change", async () => {
  for (const field of ["rowsText", "questions", "model"]) {
    let current = request(), complete;
    const old = result(), messages = [];
    const state = { bulk: { source: "current", result: old } };
    const api = () => new Promise((resolve) => { complete = resolve; });
    const run = new Function("W", "questionEditorError", "bulkQuestions", "settleLabels", "bulkRequestSnapshot", "bulkRetryContext",
      "checkBulkPreflight", "confirmSpend", "$", "updateBulkRetry", "api", "toast", "render", "handleError", `${runBody}; return runBulk;`)(
      state, () => null, () => current.questions, () => true, () => structuredClone(current), bulkRetryContext,
      async () => ({ findings: [] }), async () => true, () => null, () => {}, api,
      (message) => messages.push(message), () => {}, (e) => { throw e; });
    const pending = run();
    await new Promise((resolve) => setImmediate(resolve));
    current[field] = field === "questions" ? { changed: { type: "noul" } } : "changed";
    complete(result());
    await pending;
    assert.equal(state.bulk.result, old);
    assert.equal(state.bulk.runRequest, undefined);
    assert.match(messages[0], /earlier request/);
    assert.equal(state.bulk.running, false);
  }
});

function retryHarness() {
  const bulk = structuredClone(W.bulk);
  bulk.result = result(); bulk.runRequest = request();
  bulk.labels = { 1: { team: "billing" } }; bulk.labelsDirty = true;
  bulk.policy.gates = { team: { on: true, t: 0.9 } };
  const state = { bulk }, calls = [], messages = [];
  let current = structuredClone(bulk.runRequest), complete;
  const api = (path, body) => { calls.push([path, body]); return new Promise((resolve) => { complete = resolve; }); };
  const run = new Function("W", "currentBulkRetryPlan", "toast", "updateBulkRetry", "$", "confirmSpend", "api", "mergeBulkRetry",
    "clearBulkRetryReports", "chooseCalQuestion", "resetPolicy", "recalibrate", "repolicy", "loadPictureUrls", "render", "handleError", `${retryBody}; return retryBulk;`)(
    state, () => bulkRetryPlan(bulk.result, bulk.runRequest, current), (message) => messages.push(message), () => {}, () => null,
    async () => true, api, mergeBulkRetry, clearBulkRetryReports, () => "team", () => assert.fail("existing gates must stay"),
    async () => {}, async () => {}, async () => {}, () => {}, (e) => { throw e; });
  return { bulk, calls, messages, run, finish: (value) => complete(value), change: (value) => { current = value; } };
}

test("Retry handler keeps table human edits and existing gates while replacing only sparse outcomes", async () => {
  const harness = retryHarness();
  const pending = harness.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0][1].indices, [1, 2]);
  harness.bulk.labels[0] = { team: "shipping" }; // a human keeps editing while the calls finish
  harness.finish(attempt([answer(1), answer(2)]));
  await pending;
  assert.deepEqual(harness.bulk.labels, { 0: { team: "shipping" }, 1: { team: "billing" } });
  assert.equal(harness.bulk.labelsDirty, true);
  assert.equal(harness.bulk.policy.gates.team.t, 0.9);
  assert.equal(harness.bulk.result.completed, 3);
  assert.equal(harness.bulk.running, false);
});

test("Retry completion cannot overwrite a replaced result or changed request while in flight", async () => {
  for (const replace of [false, true]) {
    const harness = retryHarness();
    const old = harness.bulk.result;
    const pending = harness.run();
    await new Promise((resolve) => setImmediate(resolve));
    if (replace) harness.bulk.result = null;
    else harness.change({ ...request(), rowsText: "edited while waiting" });
    harness.finish(attempt([answer(1), answer(2)]));
    await pending;
    assert.equal(harness.bulk.result, replace ? null : old);
    assert.match(harness.messages[0], /earlier request/);
    assert.equal(harness.bulk.running, false);
  }
});

test("stale retry attempts still count spend before another retry after restoring inputs", async () => {
  for (const field of ["rowsText", "model"]) {
    const harness = retryHarness();
    const old = harness.bulk.result;
    const originalRows = old.results;
    const pending = harness.run();
    await new Promise((resolve) => setImmediate(resolve));
    harness.change({ ...request(), [field]: "edited while waiting" });
    harness.finish(attempt([answer(1), answer(2)]));
    await pending;
    assert.equal(harness.bulk.result, old);
    assert.equal(old.results, originalRows);
    assert.equal(old.completed, 1);
    assert.equal(old.cost_usd, 0.03);
    assert.equal(old.input_tokens, 30);
    assert.equal(old.wall_ms, 300);
    assert.deepEqual(harness.bulk.labels, { 1: { team: "billing" } });
    harness.change(request());
    const retry = harness.run();
    await new Promise((resolve) => setImmediate(resolve));
    harness.finish(attempt([answer(1), answer(2)]));
    await retry;
    assert.equal(harness.bulk.result.completed, 3);
    assert.equal(harness.bulk.result.cost_usd, 0.05);
    assert.equal(harness.bulk.result.input_tokens, 50);
    assert.equal(harness.bulk.result.wall_ms, 500);
  }
});

test("a stale retry never charges a replacement batch", async () => {
  const harness = retryHarness();
  const old = harness.bulk.result;
  const pending = harness.run();
  await new Promise((resolve) => setImmediate(resolve));
  const replacement = result();
  harness.bulk.result = replacement;
  harness.finish(attempt([answer(1), answer(2)]));
  await pending;
  assert.equal(harness.bulk.result, replacement);
  assert.equal(replacement.cost_usd, 0.01);
  assert.equal(old.cost_usd, 0.03);
});
