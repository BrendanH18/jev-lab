import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const source = workbenchSource;
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const questions = {
  topic: { type: "choice", instructions: "Which team should help?", criteria: { billing: "Billing", shipping: "Shipping" } },
  urgent: { type: "noul", instructions: "Does it need help today?" },
};
const gates = { topic: 0.5, urgent: 0.4 };
const fresh = (line, labels = { topic: "billing", urgent: false }) => ({
  index: line - 1, line, row: { text: `Traffic ${line}`, _image: "torn-bag" }, labels, open: Object.keys(gates),
});
const labeling = (items = [fresh(1)], room = 5) => ({
  items, questions, gates, room, counts: { eligible: items.length, queued: items.length, in_dataset: 0, repeated: 0, unsupported: 0 },
});

function h(tag, attrs, ...children) {
  return { tag, attrs, children: children.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false),
    addEventListener() {} };
}
const textOf = (node) => typeof node === "object" ? node.children.map(textOf).join(" ") : String(node);
const find = (node, tag) => typeof node === "object"
  ? [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => find(child, tag))] : [];

test("traffic labels start blank, show the full input and picture, and never suggest model answers", () => {
  const item = fresh(1, { topic: null, urgent: null });
  item.row.text = `${"Long original input. ".repeat(50)}UNTRUNCATED END`;
  const rep = labeling([item]);
  const run = { drift: { report: { labeling: rep }, labelsOpen: true }, upgrade: {} };
  const W = { bulk: { pictures: { "torn-bag": "/img/samples/torn-bag.png" } } };
  const funcs = ["driftLabels", "agreeQuestions", "rowText", "queueClasses", "queueReady", "queueSelect", "labelText", "labelValue"].map(body).join("\n");
  let checks = 0;
  const view = new Function("W", "h", "photoView", "stringify", "icon", "render", "runCheck",
    `${funcs}; return driftLabels;`)(W, h, (url) => h("img", { src: url }), String, () => "", () => {}, () => { checks++; });
  let tree = view({ id: "tickets", rows: 10, test: { rows: 2 } }, run);
  assert.match(textOf(tree), /UNTRUNCATED END/);
  assert.match(textOf(tree), /targeted sample, not a random audit/);
  assert.doesNotMatch(textOf(tree), /Suggested|gate:|accuracy.*%/);
  assert.equal(find(tree, "img")[0].attrs.src, W.bulk.pictures["torn-bag"]);
  assert.deepEqual(find(tree, "select").map((s) => find(s, "option").filter((o) => o.attrs.selected).map((o) => o.attrs.value)), [[""], [""]]);
  assert.equal(find(tree, "button").find((b) => textOf(b).includes("Add 0")).attrs.disabled, true);
  assert.deepEqual(item.labels, { topic: null, urgent: null });
  run.drift.saved = { added: 1, already: 0 };
  tree = view({ id: "tickets", rows: 11, test: { rows: 2 } }, run);
  assert.equal(checks, 0);
  find(tree, "button").find((b) => textOf(b).includes("Rerun check · 9 calls")).attrs.onclick();
  assert.equal(checks, 1, "a paid check runs only after its own button is clicked");
});

test("the traffic queue shows complete Choice, Noul, and Score label definitions", () => {
  const criteria = {
    topic: { type: "choice", instructions: "Which outcome applies?", criteria: {
      a: "Payment was collected more than once", b: "The delivery has not arrived" } },
    urgent: { type: "noul", instructions: "Does it qualify?", criteria: {
      true: "A replacement must arrive before the next opening", false: "The regular schedule is acceptable" } },
    level: { type: "score", instructions: "How severe is it?", criteria: [
      "The item remains usable with no action required", { description: "The item cannot be used until replaced" }] },
  };
  const rep = { ...labeling([fresh(1, { topic: null, urgent: null, level: null })]), questions: criteria };
  const funcs = ["driftLabels", "agreeQuestions", "rowText", "queueClasses", "queueReady", "queueSelect", "labelText", "labelValue"].map(body).join("\n");
  const view = new Function("W", "h", "stringify", "icon", "render", `${funcs}; return driftLabels;`)(
    { bulk: { pictures: {} } }, h, String, () => "", () => {});
  const tree = view({ id: "tickets", rows: 1 }, {
    drift: { report: { labeling: rep }, labelsOpen: true }, upgrade: {},
  });
  const displayed = textOf(tree);
  for (const question of Object.values(criteria)) {
    for (const definition of Object.values(question.criteria)) {
      assert.ok(displayed.includes(typeof definition === "string" ? definition : JSON.stringify(definition)),
        `Missing full definition: ${JSON.stringify(definition)}`);
    }
  }
  assert.deepEqual(find(tree, "select").map((s) => find(s, "option").filter((o) => o.attrs.selected).map((o) => o.attrs.value)),
    [[""], [""], [""]], "definitions never preselect human labels");
});

function setup({ items = [fresh(1)], room = 5, dirty = false, api: apiOverride } = {}) {
  const rep = labeling(items, room);
  const run = { running: false, report: { old: true }, model: "", upgrade: { running: false, report: { old: true } },
    drift: { running: false, busy: false, labelsOpen: true, saved: null, report: { labeling: rep } } };
  const bulk = { dataset: { id: "tickets" }, datasets: [{ id: "tickets", rows: 1 }], checkRuns: { tickets: run },
    rowsText: dirty ? "Unsaved edit" : "Original", savedText: "Original", labelsDirty: false, testScore: { old: true } };
  const calls = [], errors = [], notices = [];
  const added = { added: 1, already: 0, room: room - 1, dataset: { id: "tickets", rows: 2 } };
  const api = async (path, payload) => {
    calls.push({ path, payload });
    if (apiOverride) return apiOverride(path, payload, added);
    return path.endsWith("/add") ? added : { dataset: { rows: ["Original", { ...items[0].row, _expect: items[0].labels }] } };
  };
  const funcs = ["queueReady", "rowLineFor", "rowsText", "addDriftLabels"].map(body).join("\n");
  const add = new Function("W", "api", "bulkUnsaved", "render", "toast", "handleError", `${funcs}; return addDriftLabels;`)(
    { bulk }, api, () => bulk.rowsText !== bulk.savedText || bulk.labelsDirty, () => {},
    (message) => notices.push(message), (error) => errors.push(error));
  return { add: () => add("tickets"), bulk, run, rep, calls, errors, notices, added };
}

test("saving sends only human labels and inputs, refreshes clean rows, and never reruns the model", async () => {
  const pending = fresh(2, { topic: "shipping", urgent: null });
  const s = setup({ items: [fresh(1), pending] });
  await s.add();
  assert.deepEqual(s.calls.map((c) => c.path), ["/api/workbench/checks/drift/add", "/api/workbench/datasets/load"]);
  assert.deepEqual(s.calls[0].payload, { id: "tickets", questions, items: [{ row: fresh(1).row, labels: fresh(1).labels }] });
  assert.deepEqual(s.rep.items, [pending]);
  assert.equal(s.bulk.dataset.id, "tickets");
  assert.match(s.bulk.rowsText, /Traffic 1/);
  assert.equal(s.bulk.rowsText, s.bulk.savedText);
  assert.equal(s.run.report, null);
  assert.equal(s.run.upgrade.report, null);
  assert.equal(s.bulk.testScore, null);
  assert.deepEqual(s.run.drift.saved, { added: 1, already: 0 });
  await s.add();
  assert.equal(s.calls.length, 2, "saved rows are no longer submitted, and incomplete rows stay queued");
});

test("capacity keeps remaining ready labels in the queue", async () => {
  const remaining = fresh(2);
  const s = setup({ items: [fresh(1), remaining], room: 1 });
  await s.add();
  assert.equal(s.calls[0].payload.items.length, 1);
  assert.deepEqual(s.rep.items, [remaining]);
  assert.equal(s.rep.room, 0);
  await s.add();
  assert.equal(s.calls.length, 2);
});

test("saving preserves dirty Bulk input and unlinks the old dataset snapshot", async () => {
  const s = setup({ dirty: true });
  await s.add();
  assert.equal(s.bulk.rowsText, "Unsaved edit");
  assert.equal(s.bulk.dataset.id, null);
  assert.equal(s.calls.length, 1);
});

test("a failed or stale-question save keeps all chosen labels", async () => {
  const item = fresh(1);
  const s = setup({ items: [item], api: async () => { throw Error("Dataset questions changed"); } });
  await s.add();
  assert.equal(s.errors[0].message, "Dataset questions changed");
  assert.deepEqual(s.rep.items, [item]);
  assert.deepEqual(item.labels, { topic: "billing", urgent: false });
  assert.equal(s.run.drift.busy, false);
  assert.equal(s.run.drift.saved, null);
  assert.equal(s.bulk.dataset.id, "tickets");
});

test("an editor refresh failure after saving cannot silently overwrite appended rows", async () => {
  const s = setup({ api: async (path, _payload, added) => {
    if (path.endsWith("/add")) return added;
    throw Error("Refresh failed");
  } });
  await s.add();
  assert.deepEqual(s.rep.items, []);
  assert.equal(s.bulk.rowsText, "Original");
  assert.equal(s.bulk.dataset.id, null);
  assert.equal(s.run.drift.saved.added, 1);
});

test("duplicate submits are ignored and a stale reply does not change a newer comparison", async () => {
  let finish;
  const deferred = new Promise((resolve) => { finish = resolve; });
  const s = setup({ api: () => deferred });
  const saving = s.add();
  await s.add();
  assert.equal(s.calls.length, 1);
  const newer = { labeling: labeling([fresh(9)]) };
  s.run.drift.report = newer;
  finish(s.added);
  await saving;
  assert.equal(s.run.drift.report, newer);
  assert.equal(newer.labeling.items[0].line, 9);
  assert.equal(s.run.drift.saved, null);
  assert.equal(s.bulk.datasets[0].rows, 1);
});

test("editing while the refreshed dataset loads preserves the edit and requires replacement confirmation", async () => {
  let finish, loaded;
  const waiting = new Promise((resolve) => { loaded = resolve; });
  const s = setup({ api: async (path, _payload, added) => {
    if (path.endsWith("/add")) return added;
    loaded();
    return new Promise((resolve) => { finish = resolve; });
  } });
  const saving = s.add();
  await waiting;
  s.bulk.rowsText = "A new unsaved edit";
  finish({ dataset: { rows: ["Original", "Added"] } });
  await saving;
  assert.equal(s.bulk.rowsText, "A new unsaved edit");
  assert.equal(s.bulk.dataset.id, null);
});

test("comparing again asks before discarding labels, and saving blocks paid runs", async () => {
  const s = setup();
  s.run.drift.text = "new traffic";
  const calls = [];
  const funcs = ["runDrift", "runCheck", "runUpgrade"].map(body).join("\n");
  const handlers = new Function("W", "lineCount", "confirm", "toast", "render", "api", "handleError",
    `${funcs}; return {runDrift,runCheck,runUpgrade};`)({ bulk: s.bulk }, () => 1, () => false,
    () => {}, () => {}, (...args) => calls.push(args), (e) => { throw e; });
  await handlers.runDrift("tickets");
  assert.equal(s.run.drift.report.labeling, s.rep);
  s.run.drift.busy = true;
  await handlers.runDrift("tickets");
  await handlers.runCheck("tickets");
  await handlers.runUpgrade("tickets");
  assert.deepEqual(calls, []);
});
