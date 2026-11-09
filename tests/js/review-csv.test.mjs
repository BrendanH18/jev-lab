import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const source = workbenchSource;
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

function setup(apiOverride) {
  const item = { row: { text: "A real traffic row" }, kind: "audit", labels: { urgent: null },
    answers: { urgent: true }, provenance: { version: 1 }, line: 1, open: ["urgent"], held: [] };
  const q = { busy: false, report: { items: [item] }, csvPreview: null, audit_report: { old: true } };
  const calls = [], errors = [], downloads = [], revoked = [];
  const W = { bulk: { checkRuns: { tickets: { queue: q } } } };
  const api = async (path, payload) => { calls.push({ path, payload }); return apiOverride(path, payload); };
  const h = (_tag, attrs) => ({ click: () => downloads.push(attrs) });
  const URL = { createObjectURL: () => "blob:labels", revokeObjectURL: (url) => revoked.push(url) };
  const funcs = ["exportQueueLabels", "previewQueueLabels", "applyQueueLabels"].map(body).join("\n");
  const handlers = new Function("W", "api", "render", "handleError", "h", "URL", "Blob",
    `${funcs}; return { exportQueueLabels, previewQueueLabels, applyQueueLabels };`)(
    W, api, () => {}, (e) => errors.push(e), h, URL, Blob);
  return { q, item, calls, errors, downloads, revoked, ...handlers };
}

test("CSV preview changes no labels until apply and preserves queue membership", async () => {
  const s = setup((_path, payload) => ({ items: payload.items.map((i) => ({ ...i, labels: { urgent: false } })),
    counts: { matched: 1, changed: 1 } }));
  await s.previewQueueLabels("tickets", "filled CSV");
  assert.deepEqual(s.item.labels, { urgent: null });
  assert.equal(s.q.report.items[0], s.item);
  assert.equal(s.calls[0].path, "/api/workbench/checks/decisions/import");
  assert.equal(s.calls[0].payload.text, "filled CSV");
  s.applyQueueLabels("tickets");
  assert.deepEqual(s.q.report.items[0], { ...s.item, labels: { urgent: false } });
  assert.equal(s.q.csvPreview, null);
  assert.equal(s.q.audit_report, null);
  assert.equal(s.calls.length, 1, "apply makes no save or model call");
});

test("a rejected CSV clears prior preview and keeps current labels", async () => {
  const s = setup(() => { throw Error("Input changed"); });
  s.q.csvPreview = { stale: true };
  await s.previewQueueLabels("tickets", "bad CSV");
  assert.equal(s.q.csvPreview, null);
  assert.deepEqual(s.q.report.items, [s.item]);
  assert.equal(s.errors[0].message, "Input changed");
  assert.equal(s.q.busy, false);
});

test("CSV export downloads server output without saving the dataset", async () => {
  const s = setup(() => ({ csv: "row_id,input,label:urgent\n" }));
  await s.exportQueueLabels("tickets");
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].path, "/api/workbench/checks/decisions/export");
  assert.deepEqual(s.downloads, [{ href: "blob:labels", download: "tickets-review-labels.csv" }]);
  assert.deepEqual(s.revoked, ["blob:labels"]);
  assert.equal(s.q.busy, false);
});

test("busy queue rejects competing imports, exports and apply", async () => {
  const s = setup(() => { throw Error("Unexpected call"); });
  s.q.busy = true;
  s.q.csvPreview = { items: [] };
  await s.previewQueueLabels("tickets", "CSV");
  await s.exportQueueLabels("tickets");
  s.applyQueueLabels("tickets");
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.q.report.items, [s.item]);
});
