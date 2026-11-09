import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";
import { agreementEditsUnsaved, restoreAgreementEdits, sessionItems, secondItems, sessionSettlements, settledItems, settleKey } from "../../static/js/agreement.js";

const body = (name) => workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const make = (name, deps) => new Function(...Object.keys(deps), `${body(name)}; return ${name};`)(...Object.values(deps));
const nothing = () => {};
const context = (run) => JSON.stringify([run.sample?.session_context, run.labels, run.choices, run.pendingSettlements]);
const sample = { session_context: "snapshot", sample_size: 2, seed: 7,
  items: [{ row_id: "a", questions: ["urgent", "score"], row: { text: "Where is my order?" } }] };

function setup({ approve = true, api: override } = {}) {
  const run = { sample, labels: { a: { urgent: false } }, choices: {}, pendingSettlements: [], sessionPreview: null };
  const W = { bulk: { agreeRuns: { coffee: run } } };
  const restored = { sample, items: [{ row_id: "a", labels: { urgent: false, score: 0 } }],
    settlements: [{ row_id: "a", question: "urgent", value: null }], counts: { rows: 1, labels: 2, settlements: 1 } };
  const calls = [];
  const deps = { W, agreeRun: () => run, agreementEditContext: context, render: nothing, toast: nothing,
    handleError: (e) => { throw e; }, window: { confirm: () => approve },
    api: async (url, data) => { calls.push([url, data]); return override ? override(run, restored) : restored; },
    loadPictureUrls: async () => {}, agreementEditsUnsaved, restoreAgreementEdits };
  return { run, W, restored, calls, deps };
}

test("agreement preview keeps the current blind sample and edits; acceptance revalidates", async () => {
  const x = setup();
  const preview = make("previewAgreementSession", x.deps);
  await preview("coffee", { format: "session" });
  assert.equal(x.run.sample, sample);
  assert.deepEqual(x.run.labels, { a: { urgent: false } });
  assert.equal(x.calls.length, 1);
  await make("acceptAgreementSession", x.deps)("coffee");
  assert.equal(x.calls.length, 2);
  assert.equal(x.run.report, null, "saved labels remain hidden until the user presses Compare");
  assert.deepEqual(x.run.labels, { a: { urgent: false, score: 0 } });
  assert.deepEqual(x.run.choices, {});
  assert.deepEqual(x.run.pendingSettlements, x.restored.settlements);
});

test("canceling acceptance keeps human labels and makes no extra request", async () => {
  const x = setup({ approve: false });
  await make("previewAgreementSession", x.deps)("coffee", {});
  await make("acceptAgreementSession", x.deps)("coffee");
  assert.equal(x.calls.length, 1);
  assert.deepEqual(x.run.labels, { a: { urgent: false } });
  assert.notEqual(x.run.sessionPreview, null);
});

test("late previews cannot replace a changed session or newly edited labels", async () => {
  for (const replace of [false, true]) {
    let finish;
    const x = setup({ api: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = make("previewAgreementSession", x.deps)("coffee", {});
    if (replace) x.W.bulk.agreeRuns.coffee = {};
    else x.run.labels.a.score = 0;
    finish(x.restored);
    await pending;
    assert.equal(x.run.sessionPreview, null);
  }
});

test("download sends human edits and sample identifiers without report values", async () => {
  const x = setup();
  let payload;
  x.run.report = { answers: { hidden: "model" }, disagreements: [{ first: "saved" }] };
  const download = make("downloadAgreementSession", { ...x.deps, secondItems, sessionSettlements, sessionItems,
    api: async (_url, data) => { payload = data; return {}; }, Blob,
    URL: { createObjectURL: () => "blob:session", revokeObjectURL: nothing }, h: () => ({ click: nothing }) });
  await download("coffee");
  assert.deepEqual(payload, { id: "coffee", context: "snapshot", rows: 2, seed: 7,
    items: [{ row_id: "a", labels: { urgent: false } }], settlements: [] });
  assert.equal(x.run.busy, false);
});

test("canceling a partial settlement save keeps recoverable edits and makes no write", async () => {
  const x = setup({ approve: false });
  x.run.report = { disagreements: [{ row_id: "a", question: "urgent", first: true, second: false },
    { row_id: "a", question: "score", first: 2, second: 0 }] };
  x.run.choices = { [settleKey("a", "urgent")]: false };
  await make("saveSettled", { ...x.deps, settledItems, settleKey,
    api: () => assert.fail("cancellation must happen before a dataset write") })("coffee");
  assert.equal(x.run.sample.session_context, "snapshot");
  assert.deepEqual(x.run.choices, { [settleKey("a", "urgent")]: false });
});

test("mismatched CSV rows reach session validation and cannot be silently dropped from a download", async () => {
  const x = setup();
  x.run.labels.outside = { urgent: true };
  let payload, error;
  const download = make("downloadAgreementSession", { ...x.deps, sessionItems, sessionSettlements,
    api: async (_url, data) => { payload = data; throw new Error("unknown sampled row"); },
    handleError: (e) => { error = e; }, Blob: () => assert.fail("invalid session must not download"),
    URL: {}, h: () => assert.fail("invalid session must not download") });
  await download("coffee");
  assert.deepEqual(payload.items.map((item) => item.row_id), ["a", "outside"]);
  assert.match(error.message, /unknown/);
  assert.equal(x.run.busy, false);
});
