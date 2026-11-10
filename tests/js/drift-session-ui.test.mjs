import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const body = (name) => workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const make = (name, deps) => new Function(...Object.keys(deps), `${body(name)}; return ${name};`)(...Object.values(deps));
const nothing = () => {};
const context = (d) => JSON.stringify(d.report?.labeling || null);
const queue = () => ({ session_context: "snapshot", questions: { urgent: { type: "noul", instructions: "Urgent?" } },
  gates: { urgent: 0.6 }, items: [{ line: 3, index: 2, row: { text: "An input", _image: "torn-bag" }, labels: { urgent: false } }] });

function setup({ approve = true, api: override, empty = false } = {}) {
  const d = { report: empty ? null : { labeling: queue(), estimate: { accuracy: 0.99 } } };
  const run = { drift: d, upgrade: {} };
  const W = { bulk: { checkRuns: { coffee: run } } };
  const restored = { labeling: queue(), counts: { rows: 1, edited_rows: 1, labels: 1 } };
  const calls = [];
  const deps = { W, render: nothing, toast: nothing, handleError: (e) => { throw e; },
    driftEditContext: context, loadPictureUrls: async () => {}, window: { confirm: () => approve },
    api: async (url, data) => { calls.push([url, data]); return override ? override(d, restored) : restored; } };
  deps.driftQueuesUnsaved = make("driftQueuesUnsaved", { W });
  return { W, run, d, restored, calls, deps };
}

test("unsaved traffic guards count human false/zero labels across all queues", () => {
  const s = setup();
  assert.equal(s.deps.driftQueuesUnsaved(), true);
  assert.equal(s.deps.driftQueuesUnsaved("other"), false);
  const guard = make("confirmDriftDiscard", { ...s.deps, window: { confirm: () => false } });
  assert.equal(guard("coffee"), false);
  s.d.report.labeling.items[0].labels = { urgent: null };
  assert.equal(s.deps.driftQueuesUnsaved(), false);
  assert.equal(guard("coffee"), true);
  s.d.busy = true;
  assert.equal(guard("coffee"), false, "a pending restore cannot race dataset replacement");
});

test("standalone preview makes no run and leaves the current queue untouched; accept revalidates", async () => {
  const s = setup({ empty: true });
  await make("previewDriftSession", s.deps)("coffee", { format: "draft" });
  assert.equal(s.d.report, null);
  assert.equal(s.calls.length, 1);
  await make("acceptDriftSession", s.deps)("coffee");
  assert.equal(s.calls.length, 2);
  assert.ok(s.calls.every(([url]) => url === "/api/workbench/checks/drift/session/import"));
  assert.equal(s.d.report.recovered, true);
  assert.deepEqual(s.d.report, { recovered: true, labeling: s.restored.labeling });
  assert.equal(s.d.labelsOpen, true);
  assert.equal(s.d.saved, null);
  assert.equal(s.d.sessionPreview, null);
});

test("canceling replacement keeps current human labels and makes no request after preview", async () => {
  const s = setup({ approve: false });
  const original = s.d.report;
  await make("previewDriftSession", s.deps)("coffee", {});
  await make("acceptDriftSession", s.deps)("coffee");
  assert.equal(s.calls.length, 1);
  assert.equal(s.d.report, original);
  assert.equal(s.d.report.labeling.items[0].labels.urgent, false);
});

test("late previews and accept responses cannot replace a newer queue or human edit", async () => {
  for (const stage of ["preview", "accept"]) {
    for (const replace of [false, true]) {
      let finish;
      const s = setup();
      if (stage === "accept") await make("previewDriftSession", s.deps)("coffee", {});
      s.deps.api = () => new Promise((resolve) => { finish = resolve; });
      const pending = stage === "preview" ? make("previewDriftSession", s.deps)("coffee", {})
        : make("acceptDriftSession", s.deps)("coffee");
      if (replace) s.W.bulk.checkRuns.coffee = { drift: {} };
      else s.d.report.labeling.items[0].labels.urgent = true;
      finish(s.restored);
      await pending;
      assert.notEqual(s.d.report.recovered, true);
      if (stage === "preview") assert.equal(s.d.sessionPreview, null);
    }
  }
});

test("download strips all report fields and sends only original inputs, positions and human edits", async () => {
  const s = setup();
  s.d.report.labeling.items[0].labels = { urgent: false, level: 0, empty: null };
  let payload;
  await make("downloadDriftSession", { ...s.deps,
    api: async (_path, data) => { payload = data; return {}; },
    Blob, URL: { createObjectURL: () => "blob:session", revokeObjectURL: nothing },
    h: () => ({ click: nothing }),
  })("coffee");
  assert.deepEqual(payload, { id: "coffee", context: "snapshot",
    members: [{ line: 3, row: { text: "An input", _image: "torn-bag" } }],
    items: [{ line: 3, labels: { urgent: false, level: 0 } }] });
  assert.equal(s.d.busy, false);
});

test("a recovered report renders the labeling queue without reading model statistics", () => {
  const s = setup({ empty: true });
  s.d.report = { recovered: true, labeling: queue() };
  const report = make("driftReport", { h: (_tag, _attrs, ...children) => children,
    driftLabels: () => "Human queue" });
  assert.match(JSON.stringify(report({}, s.run)), /Recovered human labeling queue/);
});

test("restore control is present before any paid report exists", () => {
  const s = setup({ empty: true });
  const h = (tag, attrs, ...children) => ({ tag, attrs, children, addEventListener: nothing });
  const panel = make("driftSessionPanel", { ...s.deps, h })("coffee", s.run);
  const text = JSON.stringify(panel);
  assert.match(text, /Restore traffic labeling draft/);
  const controls = panel.children[0].children;
  assert.equal(controls[0].attrs.disabled, true);
  assert.equal(!!controls[1].attrs.disabled, false);
});

test("partial Add warns before invalidating remaining recoverable human drafts", async () => {
  const s = setup();
  const rep = s.d.report.labeling;
  rep.room = 3;
  rep.items.push({ line: 4, row: { text: "Unfinished" }, labels: { urgent: null, level: 0 } });
  let warned = false;
  const add = make("addDriftLabels", { ...s.deps,
    queueReady: (item) => item.labels.urgent !== null,
    window: { confirm: (message) => { warned = /prevents downloading the remaining traffic labels/.test(message); return false; } },
    api: () => assert.fail("cancel must happen before saving"),
  });
  await add("coffee");
  assert.equal(warned, true);
  assert.equal(rep.session_context, "snapshot");
  assert.equal(rep.items.length, 2);
});

test("edits during drift spend preview keep the queue and make no paid comparison", async () => {
  for (const change of ["label", "inputs", "model", "queue"]) {
    const s = setup();
    s.d.text = "New traffic";
    s.run.model = "";
    let finish;
    const waiting = new Promise((resolve) => { finish = resolve; });
    const report = s.d.report;
    const run = make("runDrift", { ...s.deps, lineCount: () => 1, rowsPayload: (text) => text,
      confirm: () => true, confirmSpend: () => waiting,
      api: () => assert.fail("changed labels/inputs must not start a paid run") });
    const pending = run("coffee");
    if (change === "label") s.d.report.labeling.items[0].labels.urgent = true;
    else if (change === "inputs") s.d.text = "Different traffic";
    else if (change === "model") s.run.model = "jev-latest";
    else s.W.bulk.checkRuns.coffee = { drift: {} };
    finish(true);
    await pending;
    assert.equal(s.d.report, report);
    assert.notEqual(s.d.running, true);
  }
});
