import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const body = (name) => workbenchSource.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const make = (name, values = {}, extras = []) => new Function(...Object.keys(values),
  [...extras, name].map(body).join("\n") + `; return ${name};`)(...Object.values(values));
const nothing = () => {};
const raise = (e) => { throw e; };
function state(queue) { return { bulk: { checkRuns: { coffee: { queue } } } }; }

test("unsaved warning counts only human edits, including a cleared label", () => {
  const queue = { report: { items: [{ labels: { topic: "seeded suggestion" } }] }, edits: {} };
  const unsaved = make("reviewQueuesUnsaved", { W: state(queue) });
  assert.equal(unsaved(), false);
  queue.edits[1] = { topic: null };
  assert.equal(unsaved(), true);
  delete queue.edits[1];
  assert.equal(unsaved(), false);
});

test("replacement cancellation preserves edits and never asks about suggested labels", () => {
  const messages = [];
  const replace = make("replaceQueue", { window: { confirm: (message) => { messages.push(message); return false; } } });
  const q = { edits: {}, report: { items: [{ labels: { topic: "suggestion" } }] } };
  assert.equal(replace(q), true);
  q.edits[1] = { topic: "delivery" };
  assert.equal(replace(q), false);
  assert.match(messages[0], /unsaved human labels/);
  assert.equal(q.edits[1].topic, "delivery");
});

test("session download sends human edits only and original read snapshot", async () => {
  const q = { text: "original decisions", readText: "original decisions", edits: { 4: { topic: null, urgent: false } },
    report: { seed: 7, audit_requested: 2, session_context: "snapshot", items: [{ answers: { topic: "secret" }, labels: { topic: "seeded" } }] } };
  const W = state(q);
  let payload;
  const download = make("downloadQueueSession", { W, render: nothing, toast: nothing, handleError: raise,
    api: async (_url, data) => { payload = data; return {}; },
    URL: { createObjectURL: () => "blob:session", revokeObjectURL: nothing }, Blob,
    h: () => ({ click: nothing }),
  });
  await download("coffee");
  assert.deepEqual(payload, { id: "coffee", text: "original decisions", seed: 7, audit: 2, context: "snapshot",
    items: [{ line: 4, labels: { topic: null, urgent: false } }] });
  assert.equal(q.busy, false);
  q.text = "changed decisions";
  payload = null;
  await download("coffee");
  assert.equal(payload, null, "an edited decisions box cannot download a stale queue");
});

test("restore preview does not replace labels or membership, accept revalidates then restores", async () => {
  const old = { items: [{ line: 1, kind: "audit", labels: {} }] };
  const restored = { items: [{ line: 9, kind: "audit", labels: { topic: "delivery" } }], audit_requested: 1 };
  const edits = [{ line: 9, labels: { topic: "delivery" } }];
  const q = { text: "decisions", report: old, edits: {} };
  const W = state(q);
  const calls = [];
  const deps = { W, render: nothing, toast: nothing, handleError: raise, replaceQueue: () => true,
    loadPictureUrls: async () => {}, api: async (url, data) => { calls.push([url, data]); return { report: restored, edits, counts: {} }; } };
  const preview = make("previewQueueSession", deps);
  const accept = make("acceptQueueSession", deps);
  const session = { version: 1 };
  await preview("coffee", session);
  assert.equal(q.report, old);
  assert.deepEqual(q.edits, {});
  assert.equal(calls.length, 1);
  await accept("coffee");
  assert.equal(calls.length, 2, "accept validates the current saved dataset again");
  assert.equal(q.report, restored);
  assert.deepEqual(q.edits, { 9: { topic: "delivery" } });
  assert.equal(q.sessionPreview, null);
  assert.equal(q.audit, "1");
});

test("late restore previews cannot apply to a changed decisions file or replaced queue", async () => {
  for (const replace of [false, true]) {
    const q = { text: "decisions", report: null };
    const W = state(q);
    let finish;
    const preview = make("previewQueueSession", { W, render: nothing, handleError: raise,
      api: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = preview("coffee", {});
    if (replace) W.bulk.checkRuns.coffee.queue = { text: "decisions" };
    else q.text = "different decisions";
    finish({ report: {}, edits: [] });
    await pending;
    assert.equal(q.sessionPreview, null);
    assert.equal(q.busy, false);
  }
});

test("failed restore accept leaves the existing queue and human edits intact", async () => {
  const report = { items: [{ line: 1, kind: "review", labels: { topic: "billing" } }] };
  const q = { text: "decisions", report, edits: { 1: { topic: "billing" } }, sessionPreview: { text: "decisions", session: {} } };
  let error;
  const accept = make("acceptQueueSession", { W: state(q), render: nothing, replaceQueue: () => true,
    api: async () => { throw new Error("dataset changed"); }, handleError: (e) => { error = e; } });
  await accept("coffee");
  assert.equal(q.report, report);
  assert.equal(q.edits[1].topic, "billing");
  assert.match(error.message, /dataset changed/);
});

test("canceling a partial append preserves remaining human labels and makes no request", async () => {
  const items = [
    { line: 1, kind: "review", labels: { topic: "billing" } },
    { line: 2, kind: "audit", labels: { topic: null }, open: ["topic"] },
  ];
  const q = { report: { items, gates: { topic: 0.9 }, room: 10 }, edits: { 2: { topic: null } } };
  let asked = false;
  const add = make("addQueued", { W: state(q), toast: nothing,
    window: { confirm: (text) => { asked = true; assert.match(text, /prevents session downloads/); return false; } },
    api: () => assert.fail("cancel must not write the dataset"),
  }, ["queueReady"]);
  await add("coffee");
  assert.equal(asked, true);
  assert.equal(q.report.items, items);
  assert.deepEqual(q.edits, { 2: { topic: null } });
});

test("pasting decisions enables Restore immediately without replacing the textarea", () => {
  const made = [];
  const h = (tag, attrs, ...children) => {
    const node = { tag, attrs, children, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } };
    made.push(node);
    return node;
  };
  const q = { text: "", audit: "2", sessionPreview: null };
  const controls = () => ({ restoreDisabled: !q.text.trim() });
  const form = make("queueForm", { h, queueSession: controls, icon: nothing,
    mount: (target, child) => { target.children = [child]; } });
  form({ id: "coffee" }, q);
  const textarea = made.find((node) => node.tag === "textarea");
  const session = made.find((node) => node.children[0]?.restoreDisabled === true);
  textarea.value = "original decisions";
  textarea.listeners.input();
  assert.equal(q.text, "original decisions");
  assert.equal(session.children[0].restoreDisabled, false);
  assert.equal(made.filter((node) => node.tag === "textarea").length, 1);
  textarea.value = "";
  textarea.listeners.input();
  assert.equal(session.children[0].restoreDisabled, true);
});

test("all check and dataset queue-discarding actions honor cancellation before requests", async () => {
  for (const name of ["saveCheck", "removeCheck", "moveCheck", "deleteDataset", "importBundle"]) {
    const q = { edits: { 1: { topic: "delivery" } } };
    const W = state(q);
    Object.assign(W.bulk, { dataset: { id: "coffee" }, policy: {}, datasets: [], bundle: { name: "coffee" } });
    let guarded = false;
    const action = make(name, { W, checkBlocker: () => null, slugOf: (name) => name,
      confirmReviewDiscard: (id) => { assert.equal(id, "coffee"); guarded = true; return false; },
      api: () => assert.fail(`${name} must not mutate saved configuration when canceled`),
      confirm: () => assert.fail("Review warning should happen before normal confirmation"),
    });
    await action("coffee", {}, "upgrade");
    assert.equal(guarded, true, name);
    assert.equal(W.bulk.checkRuns.coffee.queue, q);
    assert.equal(q.edits[1].topic, "delivery");
  }
});

test("discard guard preserves unsaved and busy Review queues", () => {
  const q = { edits: { 1: { topic: "delivery" } } };
  const W = state(q);
  const guard = make("confirmReviewDiscard", { W, toast: nothing, window: { confirm: () => false } }, ["replaceQueue"]);
  assert.equal(guard("coffee"), false);
  q.busy = true;
  assert.equal(guard("coffee"), false);
  assert.equal(guard("other"), true);
});
