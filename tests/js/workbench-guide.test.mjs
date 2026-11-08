import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowSteps, renderWorkbenchGuide } from "../../static/js/workbench-guide.js";

const h = (tag, attrs, ...children) => ({ tag, attrs,
  children: children.flat(Infinity).filter((x) => x != null && x !== false) });
const nodes = (node, tag) => typeof node !== "object" ? []
  : [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => nodes(child, tag))];
const step = (snapshot, id) => workflowSteps(snapshot).find((item) => item.id === id);

test("empty workspace still allows setup and existing saved-dataset navigation", () => {
  const available = workflowSteps().filter((item) => item.enabled).map((item) => item.id);
  assert.deepEqual(available, ["questions", "rows", "review"]);
  assert.equal(step({}, "run").status, "Live call required");
});

test("inspect and run need both rows and questions; policy also needs current gateable results", () => {
  for (const snapshot of [{ questionCount: 1 }, { rowCount: 2 }]) {
    assert.equal(step(snapshot, "labels").enabled, false);
    assert.equal(step(snapshot, "run").enabled, false);
  }
  const ready = { rowCount: 2, questionCount: 1, gateableCount: 1 };
  assert.equal(step(ready, "run").enabled, true);
  assert.equal(step(ready, "policy").enabled, false);
  assert.equal(step({ ...ready, currentRun: true }, "policy").enabled, true);
  assert.equal(step({ ...ready, currentRun: true, gateableCount: 0 }, "policy").enabled, false);
  assert.equal(step({ ...ready, healthCurrent: true }, "labels").status, "Current health report available");
  assert.equal(step({ hasSavedCheck: true }, "review").status, "Saved check available");
});

test("guide shortcuts only emit tab and target, preserve data, and retain disclosure preference", () => {
  const snapshot = Object.freeze({ rowCount: 2, questionCount: 1, currentRun: true, gateableCount: 1 });
  const calls = [];
  let open;
  const guide = renderWorkbenchGuide(h, snapshot, (...args) => calls.push(args),
    { open: true, onToggle: (value) => { open = value; } });
  assert.equal(guide.attrs.open, true);
  guide.attrs.ontoggle({ target: { open: false } });
  assert.equal(open, false);
  for (const button of nodes(guide, "button")) button.attrs.onclick();
  assert.deepEqual(calls, [["build", "#view"], ["bulk", "#bulk-rows"], ["bulk", "#dataset-health"],
    ["bulk", "#bulk-run"], ["bulk", "#policy"], ["bulk", "#datasets"]]);
  assert.equal(snapshot.currentRun, true);
});

test("disabled shortcuts cannot navigate even if their event handler is called", () => {
  const calls = [];
  const guide = renderWorkbenchGuide(h, {}, (...args) => calls.push(args));
  for (const button of nodes(guide, "button").filter((node) => node.attrs.disabled)) button.attrs.onclick();
  assert.deepEqual(calls, []);
});
