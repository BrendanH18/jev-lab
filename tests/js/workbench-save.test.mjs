import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

test("saving edited questions omits removed expectations and preserves current ones", async () => {
  // Exercise the page's real submit handler without booting the DOM or making model calls.
  const source = workbenchSource;
  const handler = source.match(/async function saveTest\(\) \{[\s\S]*?\n\}/)[0];
  const questions = { urgent: { type: "noul", instructions: "Urgent?" } };
  const state = { expect: { urgent: { max: 0.5 }, removed: { min: 0.9 } }, saveName: "Edited", stateText: "x" };
  let saved;
  const api = async (path, body) => {
    assert.equal(path, "/api/workbench/items");
    if (!body) return { items: [] };
    saved = body;
    return { item: { id: "edited" } };
  };
  const saveTest = new Function("W", "api", "toQuestions", "parseState", "imagesPayload", "toast", "render", "handleError",
    "questionEditorError", "buildContext", "buildResultStale",
    `let buildRawText = null, buildBaseline = null; ${handler}; return saveTest;`)(state, api, () => questions, (text) => text, () => ({}), () => {}, () => {}, (e) => { throw e; }, () => null, () => "saved", () => false);
  await saveTest();
  assert.deepEqual(saved.questions, questions);
  assert.deepEqual(saved.expect, { urgent: { max: 0.5 } });
  assert.equal(state.editingId, "edited");
});


test("editing while Save is pending leaves the newer Build request unsaved", async () => {
  const handler = workbenchSource.match(/async function saveTest\(\) \{[\s\S]*?\n\}/)[0];
  const W = { stateText: "submitted", expect: {}, questions: [], saveName: "Coffee" };
  let finish;
  const api = (path, body) => body ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ items: [] });
  const harness = new Function("W", "api", "toQuestions", "parseState", "imagesPayload", "toast", "render", "handleError",
    "questionEditorError", "buildContext", "buildResultStale",
    `let buildRawText = null, buildBaseline = null; ${handler}; return { saveTest, baseline: () => buildBaseline };`)(
    W, api, () => ({ q: { type: "noul", instructions: "Urgent?" } }), (v) => v, () => ({}), () => {}, () => {},
    (e) => { throw e; }, () => null, () => W.stateText, () => false);
  const pending = harness.saveTest();
  W.stateText = "new unsaved edit";
  finish({ item: { id: "coffee" } });
  await pending;
  assert.equal(harness.baseline(), "submitted");
  assert.notEqual(harness.baseline(), W.stateText);
});
