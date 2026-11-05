import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../static/js/workbench.js", import.meta.url), "utf8");
const handler = source.match(/async function importBundle\(\) \{[\s\S]*?\n\}/)[0];

test("the file-read busy state renders before a preview exists", () => {
  const form = source.match(/function bundleImportForm\(\) \{[\s\S]*?\n\}/)[0];
  const W = { bulk: { bundle: { busy: true, name: "", report: null } } };
  const h = (tag, attrs, ...children) => ({ tag, attrs, children, addEventListener() {} });
  const renderForm = new Function("W", "h", `${form}; return bundleImportForm;`)(W, h);
  const result = renderForm();
  assert.ok(JSON.stringify(result).includes("Reading or saving bundle…"));
});

function setup(confirm) {
  const calls = [];
  const bulk = {
    bundle: { data: "zip-bytes", report: {}, name: "Existing dataset", busy: false },
    datasets: [{ id: "existing-dataset" }], dataset: { id: "existing-dataset" },
    checkRuns: { "existing-dataset": {} }, agreeRuns: { "existing-dataset": {} },
    testScore: {}, rowsText: "unsaved input", labelsDirty: true,
  };
  const api = async (path, body) => {
    calls.push({ path, body });
    return path.endsWith("/import") ? { dataset: { id: "existing-dataset" } } : { datasets: bulk.datasets };
  };
  const run = new Function("W", "api", "slugOf", "confirm", "toast", "render", "handleError",
    `${handler}; return importBundle;`)({ bulk }, api, () => "existing-dataset", confirm,
    () => {}, () => {}, (e) => { throw e; });
  return { run, bulk, calls };
}

test("declining bundle replacement sends nothing and retains the preview", async () => {
  const { run, bulk, calls } = setup(() => false);
  await run();
  assert.deepEqual(calls, []);
  assert.equal(bulk.bundle.data, "zip-bytes");
  assert.equal(bulk.dataset.id, "existing-dataset");
});

test("confirmed import clears stale saved-dataset reports and preserves unsaved editor rows", async () => {
  const { run, bulk, calls } = setup(() => true);
  await run();
  assert.deepEqual(calls[0].body, { data: "zip-bytes", name: "Existing dataset", replace: true });
  assert.equal(bulk.rowsText, "unsaved input");
  assert.equal(bulk.labelsDirty, true);
  assert.equal(bulk.dataset.id, null);
  assert.equal(bulk.testScore, null);
  assert.deepEqual(bulk.checkRuns, {});
  assert.deepEqual(bulk.agreeRuns, {});
  assert.equal(bulk.bundle.report, null);
});
