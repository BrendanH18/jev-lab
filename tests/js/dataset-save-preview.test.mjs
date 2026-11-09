import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const source = workbenchSource;
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const preview = { id: "tickets", exists: true, revision: "before", rows: { before: 1, after: 1, added: 0, removed: 0 },
  labels: { added: 1, removed: 0, changed: 0 }, test: { before: 0, after: 0, changed_membership: 0, history: "none" }, check: "none" };

function harness({ approve = true, onPreview, onSave } = {}) {
  const W = { bulk: { dataset: { id: "tickets", name: "Tickets", notes: "", withQuestions: true },
    rowsText: "new", savedText: "old", labelsDirty: false, rules: { text: "" }, datasets: [] } };
  const calls = [], confirms = [], errors = [];
  const questions = { urgent: { type: "noul", instructions: "Urgent?" } };
  const api = async (path, data) => {
    calls.push([path, data]);
    if (path.endsWith("/preview")) return onPreview ? await onPreview(W) : preview;
    if (!data) return { datasets: [] };
    if (onSave) await onSave(W);
    return { dataset: { id: "tickets", name: "Tickets", rows: 1, labeled: 1 } };
  };
  const fn = new Function("W", "api", "slugOf", "toast", "settleLabels", "bulkQuestions", "rowsPayload", "confirm", "handleError", "render",
    body("datasetChangeMessage") + "\n" + body("saveDataset") + "; return saveDataset;"
  )(W, api, () => "tickets", () => {}, () => true, () => questions, () => W.bulk.rowsText,
    (message) => { confirms.push(message); return approve; }, (error) => errors.push(error), () => {});
  return { W, calls, confirms, errors, save: fn };
}

test("replacing even the currently loaded dataset previews before explicit confirmation", async () => {
  const x = harness();
  await x.save();
  assert.equal(x.calls[0][0], "/api/workbench/datasets/preview");
  assert.equal(x.calls[1][0], "/api/workbench/datasets");
  assert.equal(x.calls[1][1].preview_revision, "before");
  assert.equal(x.confirms.length, 1);
  assert.match(x.confirms[0], /Human labels: 1 added, 0 removed, 0 changed/);
  assert.equal(x.W.bulk.savedText, "new");
});

test("declining a preview leaves the dataset and unsaved state alone", async () => {
  const x = harness({ approve: false });
  await x.save();
  assert.equal(x.calls.length, 1);
  assert.equal(x.W.bulk.savedText, "old");
});

test("editing during preview prevents a stale confirmation and save", async () => {
  const x = harness({ onPreview: async (W) => { W.bulk.rowsText = "newer"; return preview; } });
  await x.save();
  assert.equal(x.calls.length, 1);
  assert.equal(x.confirms.length, 0);
  assert.equal(x.W.bulk.savedText, "old");
});

test("editing while save runs preserves newer editor changes as unsaved", async () => {
  const x = harness({ onSave: async (W) => { W.bulk.rowsText = "newer"; } });
  await x.save();
  assert.equal(x.calls[1][1].rows, "new");
  assert.equal(x.W.bulk.rowsText, "newer");
  assert.equal(x.W.bulk.savedText, "old");
});

test("a save cannot run twice while preview is pending", async () => {
  let finish;
  const x = harness({ onPreview: () => new Promise((resolve) => { finish = resolve; }) });
  const first = x.save();
  await x.save();
  assert.equal(x.calls.length, 1);
  finish(preview);
  await first;
  assert.equal(x.calls.length, 3);
});

test("a rejected stale revision leaves the editor unsaved", async () => {
  const x = harness({ onSave: () => { throw new Error("Saved dataset changed"); } });
  await x.save();
  assert.equal(x.errors.length, 1);
  assert.equal(x.W.bulk.savedText, "old");
  assert.equal(x.W.bulk.datasetSaveBusy, false);
});
