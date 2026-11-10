import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

test("Bulk Run reports a current Build duplicate-key error before requesting any work", async () => {
  const body = workbenchSource.match(/async function runBulk\(\) \{[\s\S]*?\n\}/)[0];
  const W = { bulk: { source: "current" } }, messages = [];
  const run = new Function("W", "questionEditorError", "toast", "$", "updateBulkRetry", body + "; return runBulk;")(
    W, () => "Question id q is repeated", (message) => messages.push(message), () => null, () => {});
  await run();
  assert.deepEqual(messages, ["Question id q is repeated"]);
  assert.equal(W.bulk.running, false);
});
