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
    `${handler}; return saveTest;`)(state, api, () => questions, (text) => text, () => ({}), () => {}, () => {}, (e) => { throw e; });
  await saveTest();
  assert.deepEqual(saved.questions, questions);
  assert.deepEqual(saved.expect, { urgent: { max: 0.5 } });
  assert.equal(state.editingId, "edited");
});
