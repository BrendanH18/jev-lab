import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { labelShortcut, nextLabel, labelProgress, visibleLabels } from "../../static/js/prelabel.js";

const items = [{ index: 0, missing: ["label"] }, { index: 3, missing: ["label"] }, { index: 7, missing: ["label"] }];

test("modified Enter navigates both directions without capturing native editing keys", () => {
  const event = { key: "Enter", ctrlKey: true };
  assert.equal(labelShortcut(event), 1);
  assert.equal(labelShortcut({ key: "Enter", metaKey: true, shiftKey: true }), -1);
  for (const override of [{ ctrlKey: false }, { key: "ArrowDown" }, { key: "Tab" }, { altKey: true },
    { isComposing: true }, { repeat: true }, { defaultPrevented: true }]) {
    assert.equal(labelShortcut({ ...event, ...override }), null);
  }
});

test("previous incomplete skips ready rows and wraps within the supplied slice", () => {
  const drafts = { 3: { label: false } };
  assert.equal(nextLabel(items, drafts, 7, -1).index, 0);
  assert.equal(nextLabel(items, drafts, 0, -1).index, 7);
  assert.equal(nextLabel(items, drafts, null, -1).index, 7);
  assert.equal(nextLabel([items[1]], drafts, 0, -1), null);
  assert.equal(nextLabel([], drafts, null, -1), null);
});

const source = readFileSync(new URL("../../static/js/workbench.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const h = (tag, attrs, ...children) => ({ tag, attrs, children });

test("shortcut is scoped to the labeling panel, follows focus, and never applies or saves", () => {
  const state = { context: "current", report: { items, questions: {}, fields: [], field: null,
    values: [], missing: 3, eligible: 3 }, drafts: {}, busy: false };
  // Skip row rendering here; navigation uses the report, not the presentation filter.
  state.status = "ready";
  const calls = [];
  const renderPanel = new Function("W", "prelabelContext", "labelProgress", "visibleLabels", "h",
    "agreeQuestions", "preparedLabelCsv", "labelShortcut", "nextPreparedLabel", "applyPreparedLabels",
    body("prelabelBody") + "; return prelabelBody;")(
    { bulk: { prelabel: state } }, () => "current", labelProgress, visibleLabels, h,
    () => null, () => null, labelShortcut, (direction) => calls.push([direction, state.nextIndex]), () => assert.fail("must not apply"));
  const panel = renderPanel();
  let prevented = 0;
  const event = { key: "Enter", ctrlKey: true, preventDefault: () => prevented++, target: {
    closest: () => ({ dataset: { prelabelIndex: "3" } }),
  } };
  panel.attrs.onkeydown(event);
  assert.deepEqual(calls, [[1, 3]]);
  assert.equal(prevented, 1);
  state.busy = true;
  renderPanel().attrs.onkeydown(event);
  state.busy = false;
  state.context = "stale";
  renderPanel().attrs.onkeydown(event);
  assert.equal(calls.length, 1);
});

test("next navigation focuses the destination label control", () => {
  const state = { context: "current", report: { items }, drafts: {}, nextIndex: 0 };
  const calls = [];
  const target = { scrollIntoView: () => calls.push("scroll"), querySelector: () => ({ focus: () => calls.push("label focus") }) };
  const navigate = new Function("W", "prelabelContext", "nextLabel", "render", "$",
    body("nextPreparedLabel") + "; return nextPreparedLabel;")(
    { bulk: { prelabel: state } }, () => "current", nextLabel, () => calls.push("render"), () => target);
  navigate(-1);
  assert.equal(state.nextIndex, 7);
  assert.equal(state.status, "incomplete");
  assert.deepEqual(calls, ["render", "scroll", "label focus"]);
});
