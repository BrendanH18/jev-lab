import assert from "node:assert/strict";
import { test } from "node:test";
import { checkChange, createHistory, restoreMessage, revisionText, revisionTime } from "../../static/js/history.js";

const h = (tag, attrs, ...children) => ({ tag, attrs,
  children: children.flat(Infinity).filter((x) => x != null && x !== false) });
const nodes = (node, pred) => typeof node !== "object" || node === null ? []
  : [...(pred(node) ? [node] : []), ...node.children.flatMap((child) => nodes(child, pred))];
const text = (node) => typeof node !== "object" ? String(node) : node.children.map(text).join("");
const buttonNamed = (node, name) => nodes(node, (n) => n.tag === "button" && text(n) === name)[0];

const ENTRY = { revision: "20261108T120000000000Z-0123456789ab", at: "2026-11-08T12:00:00.000000Z", current: false,
  name: "Tickets", rows: 7, labeled: 5, test_rows: 2, questions: ["urgent", "dept"], checks: 1 };
const REPORT = { id: "tickets", exists: true, revision: "file-token", restoring: ENTRY.revision,
  rows: { before: 3, after: 7, added: 4, removed: 0, order_changed: false },
  labels: { added: 4, removed: 0, changed: 1 }, questions_changed: true, rules_changed: false, metadata_changed: true,
  check: "preserved", check_dropped: null, check_changed: true,
  test: { before: 0, after: 2, changed_membership: 0, history: "started" } };

test("revision summaries show counts and question totals only", () => {
  assert.equal(revisionTime(ENTRY.at), "2026-11-08 12:00:00 UTC");
  assert.equal(revisionText(ENTRY), "2026-11-08 12:00:00 UTC · 7 rows · 5 labeled · 2 held out · 2 questions · saved check");
  assert.equal(revisionText({ ...ENTRY, test_rows: 0, checks: 0, questions: [], rows: 1 }),
    "2026-11-08 12:00:00 UTC · 1 row · 5 labeled · no questions");
  assert.match(revisionText({ at: ENTRY.at, error: "Not a readable dataset file" }), /Not a readable/);
});

test("check change wording distinguishes restored, unchanged, removed, and none", () => {
  assert.equal(checkChange(REPORT), "restored from the revision");
  assert.equal(checkChange({ ...REPORT, check_changed: false }), "unchanged");
  assert.equal(checkChange({ ...REPORT, check: "none", check_changed: true }), "removed (the revision has none)");
  assert.equal(checkChange({ ...REPORT, check: "none", check_changed: false }), "none");
  assert.match(checkChange({ ...REPORT, check: "removed", check_dropped: "Questions changed" }), /removed\. Questions changed/);
});

test("restore confirmation says it can be undone, or that it recreates a deleted dataset", () => {
  const message = restoreMessage(REPORT, ENTRY);
  assert.match(message, /Inputs: 3 → 7 rows; 4 added, 0 removed/);
  assert.match(message, /kept as a revision first, so this restore can be undone/);
  assert.match(message, /No model calls/);
  assert.match(restoreMessage({ ...REPORT, guidelines: { before: 1, after: 1, added: [], removed: [], changed: ["urgent"], dropped: [] } }, ENTRY),
    /Labeling guidelines: 1 → 1 questions; changed: urgent\./);
  const deleted = restoreMessage({ ...REPORT, exists: false, revision: "missing" }, ENTRY);
  assert.match(deleted, /deleted; restoring recreates it/);
  assert.doesNotMatch(deleted, /can be undone/);
});

function harness({ confirmAnswer = true, failRestore = null } = {}) {
  const calls = [];
  const restored = [];
  const responses = {
    "/api/workbench/datasets/history": () => ({ id: "tickets", exists: true, keep: 20, revisions: [ENTRY] }),
    "/api/workbench/datasets/history/preview": () => REPORT,
    "/api/workbench/datasets/history/restore": () => { if (failRestore) throw failRestore; return { dataset: { id: "tickets" } }; },
    "/api/workbench/datasets/history/deleted": () => ({ datasets: [{ id: "old", name: "Old", revisions: 2, latest: ENTRY.at }] }),
  };
  const asked = [];
  const errors = [];
  const ui = createHistory({ h, render: () => {}, toast: () => {}, handleError: (e) => errors.push(e),
    api: async (path, body) => { calls.push([path, body]); return responses[path](); },
    afterRestore: async (id) => { restored.push(id); },
    confirm: (message) => { asked.push(message); return confirmAnswer; } });
  return { ui, calls, restored, asked, errors };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("opening lists revisions; preview then explicit confirm restores with the preview's file token", async () => {
  const { ui, calls, restored, asked } = harness();
  assert.equal(ui.panel("tickets"), null);
  ui.button("tickets").attrs.onclick();
  await settle();
  assert.deepEqual(calls[0], ["/api/workbench/datasets/history", { id: "tickets" }]);
  buttonNamed(ui.panel("tickets"), "Preview restore").attrs.onclick();
  await settle();
  assert.deepEqual(calls[1], ["/api/workbench/datasets/history/preview", { id: "tickets", revision: ENTRY.revision }]);
  const view = ui.panel("tickets");
  assert.match(text(view), /restore can be undone/);
  buttonNamed(view, "Restore this revision").attrs.onclick();
  await settle();
  assert.equal(asked.length, 1);
  assert.deepEqual(calls[2], ["/api/workbench/datasets/history/restore",
    { id: "tickets", revision: ENTRY.revision, preview_revision: "file-token" }]);
  assert.deepEqual(restored, ["tickets"]);
  assert.equal(calls[3][0], "/api/workbench/datasets/history", "the list refreshes after a restore");
});

test("declining the confirmation makes no restore call", async () => {
  const { ui, calls, restored } = harness({ confirmAnswer: false });
  ui.button("tickets").attrs.onclick();
  await settle();
  buttonNamed(ui.panel("tickets"), "Preview restore").attrs.onclick();
  await settle();
  buttonNamed(ui.panel("tickets"), "Restore this revision").attrs.onclick();
  await settle();
  assert.equal(calls.filter(([path]) => path.endsWith("/restore")).length, 0);
  assert.deepEqual(restored, []);
});

test("a stale preview error drops the preview so it must be made again", async () => {
  const { ui, errors, restored } = harness({ failRestore: new Error("The saved dataset changed after preview. Preview the restore again.") });
  ui.button("tickets").attrs.onclick();
  await settle();
  buttonNamed(ui.panel("tickets"), "Preview restore").attrs.onclick();
  await settle();
  buttonNamed(ui.panel("tickets"), "Restore this revision").attrs.onclick();
  await settle();
  assert.match(errors[0].message, /Preview the restore again/);
  assert.equal(buttonNamed(ui.panel("tickets"), "Restore this revision"), undefined);
  assert.deepEqual(restored, []);
});

test("deleted datasets load when the section opens and offer their own history", async () => {
  const { ui, calls } = harness();
  ui.deleted().attrs.ontoggle({ target: { open: true } });
  await settle();
  assert.deepEqual(calls[0], ["/api/workbench/datasets/history/deleted", undefined]);
  const section = ui.deleted();
  assert.match(text(section), /Old/);
  assert.ok(buttonNamed(section, "History"));
});
