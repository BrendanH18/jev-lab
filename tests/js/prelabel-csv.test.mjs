import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";
const source = workbenchSource;
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
function harness(api) {
  const W = { bulk: { rowsText: "original", prelabel: { busy: false, report: {}, context: "original", drafts: { 0: { keep: false } } } } };
  const fn = new Function("W", "api", "prelabelContext", "preparedDraftKey", "render", "handleError", "rowsPayload", "bulkQuestions",
    ["previewPreparedLabels", "acceptPreparedLabels"].map(body).join("\n") + ";return {previewPreparedLabels,acceptPreparedLabels};"
  )(W, api, () => W.bulk.rowsText, () => JSON.stringify(W.bulk.prelabel.drafts), () => {}, (e) => { throw e; }, () => W.bulk.rowsText, () => ({}));
  return { W, ...fn };
}
const preview = { items: [{ index: 0, labels: { score: 0 } }, { index: 2, labels: { urgent: false } }], counts: { matched: 3, rows: 2, labels: 2 } };
test("CSV preview changes no drafts until acceptance; blanks and other slices keep drafts", async () => {
  const calls = [];
  const x = harness(async (...args) => { calls.push(args); return preview; });
  await x.previewPreparedLabels("csv");
  assert.deepEqual(x.W.bulk.prelabel.drafts, { 0: { keep: false } });
  x.acceptPreparedLabels();
  assert.deepEqual(JSON.parse(JSON.stringify(x.W.bulk.prelabel.drafts)), { 0: { keep: false, score: 0 }, 2: { urgent: false } });
  assert.equal(x.W.bulk.rowsText, "original");
  assert.equal(calls.length, 1, "acceptance makes no call and saves nothing");
});
for (const change of ["rows", "drafts"]) {
  test(`pending preview is discarded when ${change} changes`, async () => {
    let finish;
    const x = harness(() => new Promise((resolve) => { finish = resolve; }));
    const pending = x.previewPreparedLabels("csv");
    if (change === "rows") x.W.bulk.rowsText = "changed";
    else x.W.bulk.prelabel.drafts[0].keep = true;
    finish(preview);
    await pending;
    assert.equal(x.W.bulk.prelabel.csvPreview, null);
    x.acceptPreparedLabels();
    assert.equal(x.W.bulk.prelabel.drafts[2], undefined);
  });
  test(`accepted preview cannot merge after ${change} changes`, async () => {
    const x = harness(async () => preview);
    await x.previewPreparedLabels("csv");
    if (change === "rows") x.W.bulk.rowsText = "changed";
    else x.W.bulk.prelabel.drafts[0].keep = true;
    x.acceptPreparedLabels();
    assert.equal(x.W.bulk.prelabel.drafts[2], undefined);
  });
}
test("file read snapshot and busy guards prevent a competing import", async () => {
  let calls = 0;
  const x = harness(async () => { calls++; return preview; });
  await x.previewPreparedLabels("csv", "stale");
  x.W.bulk.prelabel.busy = true;
  await x.previewPreparedLabels("csv");
  assert.equal(calls, 0);
});

test("draft restore previews through its endpoint and accepts only into drafts", async () => {
  let path;
  const x = harness(async (p) => { path = p; return preview; });
  await x.previewPreparedLabels('{"format":"jev-labeling-draft"}', "original", "draft");
  assert.equal(path, "/api/workbench/prelabel/draft/import");
  assert.equal(x.W.bulk.prelabel.drafts[2], undefined);
  x.acceptPreparedLabels();
  assert.equal(x.W.bulk.prelabel.drafts[2].urgent, false);
  assert.equal(x.W.bulk.rowsText, "original");
});

test("unload guard includes unapplied current drafts even before rows change", () => {
  const W = { bulk: { prelabel: { context: "same", drafts: { 0: { urgent: false, severity: 0 } } } } };
  const text = source.match(/const preparedLabelsUnsaved = \(\) =>[\s\S]*?;/)[0];
  const unsaved = new Function("W", "prelabelContext", `${text}; return preparedLabelsUnsaved;`)(W, () => "same");
  assert.equal(unsaved(), true);
  W.bulk.prelabel.context = "old";
  assert.equal(unsaved(), false);
  W.bulk.prelabel.context = "same";
  W.bulk.prelabel.drafts = { 0: {} };
  assert.equal(unsaved(), false);
});
