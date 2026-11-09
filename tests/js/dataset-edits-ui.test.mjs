import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../static/js/dataset-edits.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/export /g, "");

function harness(api, approve = true) {
  const W = { bulk: { rowsText: "original", labelsDirty: false, pictures: {}, dataset: {},
    health: { report: {} }, prelabel: { report: {}, drafts: {} }, result: {} } };
  const questions = { urgent: { type: "noul", instructions: "Urgent?" } };
  const errors = [];
  const h = (tag, attrs, ...children) => ({ tag, attrs, children });
  const helpers = new Function("api", "h", "handleError", "photoView", "toast", "W", "bulkQuestions", "loadPictureUrls",
    "rowsPayload", "rowsText", "settleLabels", "labelText", "labelValue", "syncAttachedSets", "render", "window", "preparedLabelsUnsaved",
    source + "; return {state,prepareEdits,previewEdits,applyEdits,datasetEditsBody,datasetEditsUnsaved};")(
    api, h, (e) => errors.push(e), () => null, () => {}, W, () => questions, async () => {},
    () => W.bulk.rowsText, JSON.stringify, () => true, (v) => v === false ? "no" : v === true ? "yes" : "",
    (v) => v === "no" ? false : v === "yes" ? true : null, () => {}, () => {}, { confirm: () => approve }, () => Object.keys(W.bulk.prelabel.drafts).length > 0);
  return { W, errors, ...helpers };
}

const prepared = { context: "server-snapshot", questions: { urgent: { type: "noul", instructions: "Urgent?" } },
  items: [{ index: 0, row: { text: "test input" }, labels: { urgent: "invalid" }, issues: { urgent: "invalid" } }],
  protected_rows: 1, remove: [] };

test("repair preview does not edit rows; Apply sends the preview token and clears stale results", async () => {
  const calls = [];
  const x = harness(async (path, body) => {
    calls.push({ path, body });
    if (path.endsWith("prepare")) return prepared;
    if (path.endsWith("preview")) return { token: "preview-token", changed: 1, removed: [], remaining: 2, changes: [] };
    return { rows: [{ text: "test input", _expect: { urgent: false } }], changed: 1, removed: 0 };
  });
  await x.prepareEdits("repair");
  x.state.drafts = { 0: { urgent: false } };
  assert.equal(x.datasetEditsUnsaved(), true);
  await x.previewEdits();
  assert.equal(x.W.bulk.rowsText, "original");
  await x.applyEdits();
  assert.equal(calls.at(-1).body.token, "preview-token");
  assert.deepEqual(calls.at(-1).body.items, [{ index: 0, labels: { urgent: false } }]);
  assert.equal(x.W.bulk.result, null);
  assert.equal(x.W.bulk.health.report, null);
  assert.equal(x.datasetEditsUnsaved(), false);
  assert.ok(calls.every((call) => call.path.startsWith("/api/workbench/dataset-edits/")));
});

test("edits or row changes invalidate a preview before Apply can make a request", async () => {
  let count = 0;
  const x = harness(async (path) => { count++; return path.endsWith("prepare") ? prepared
    : { token: "preview", changed: 1, removed: [], remaining: 2, changes: [] }; });
  await x.prepareEdits("repair");
  x.state.drafts = { 0: { urgent: false } };
  await x.previewEdits();
  x.state.drafts[0].urgent = true;
  await x.applyEdits();
  assert.equal(count, 2);
  x.W.bulk.rowsText = "new rows";
  assert.equal(x.datasetEditsUnsaved(), false);
  assert.ok(!JSON.stringify(x.datasetEditsBody()).includes("test input"));
});

test("a late Apply reply cannot overwrite newer rows", async () => {
  let finish;
  const x = harness(async (path) => path.endsWith("prepare") ? prepared : path.endsWith("preview")
    ? { token: "preview", changed: 1, removed: [], remaining: 1, changes: [] }
    : new Promise((resolve) => { finish = resolve; }));
  await x.prepareEdits("repair");
  x.state.drafts = { 0: { urgent: false } };
  await x.previewEdits();
  const pending = x.applyEdits();
  x.W.bulk.rowsText = "newer edit";
  finish({ rows: [], changed: 1, removed: 0 });
  await pending;
  assert.equal(x.W.bulk.rowsText, "newer edit");
});

test("canceling Apply with pre-run drafts preserves both queues without making an apply request", async () => {
  const calls = [];
  const x = harness(async (path) => { calls.push(path); return path.endsWith("prepare") ? prepared
    : { token: "preview", changed: 1, removed: [], remaining: 1, changes: [] }; }, false);
  await x.prepareEdits("repair");
  x.state.drafts = { 0: { urgent: false } };
  await x.previewEdits();
  x.W.bulk.prelabel.drafts = { 1: { urgent: true } };
  await x.applyEdits();
  assert.equal(calls.length, 2);
  assert.equal(x.W.bulk.rowsText, "original");
  assert.deepEqual(x.W.bulk.prelabel.drafts, { 1: { urgent: true } });
  assert.deepEqual(x.state.drafts, { 0: { urgent: false } });
});

test("Apply cannot clear pre-run drafts entered while its request is pending", async () => {
  let finish;
  const x = harness(async (path) => path.endsWith("prepare") ? prepared : path.endsWith("preview")
    ? { token: "preview", changed: 1, removed: [], remaining: 1, changes: [] }
    : new Promise((resolve) => { finish = resolve; }));
  await x.prepareEdits("repair");
  x.state.drafts = { 0: { urgent: false } };
  await x.previewEdits();
  const pending = x.applyEdits();
  x.W.bulk.prelabel.drafts = { 1: { urgent: true } };
  finish({ rows: [], changed: 1, removed: 0 });
  await pending;
  assert.equal(x.W.bulk.rowsText, "original");
  assert.deepEqual(x.W.bulk.prelabel.drafts, { 1: { urgent: true } });
});
