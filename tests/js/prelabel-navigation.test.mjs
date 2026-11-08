import assert from "node:assert/strict";
import { test } from "node:test";
import { labelReady, labelProgress, visibleLabels, nextLabel } from "../../static/js/prelabel.js";

const items = [{ index: 0, missing: ["yes", "score"] }, { index: 2, missing: ["yes"] }, { index: 3, missing: ["score"] }];
test("progress counts false and zero as filled and keeps partial rows incomplete", () => {
  const drafts = { 0: { yes: false, score: 0 }, 2: { yes: null } };
  assert.equal(labelReady(items[0], drafts), true);
  assert.deepEqual(labelProgress(items, drafts), { ready: 1, incomplete: 2 });
  assert.deepEqual(visibleLabels(items, drafts, "ready"), [items[0]]);
  assert.deepEqual(visibleLabels(items, drafts, "incomplete"), items.slice(1));
  assert.deepEqual(drafts, { 0: { yes: false, score: 0 }, 2: { yes: null } });
});
test("next follows the supplied slice, wraps, skips ready rows and handles completion", () => {
  const drafts = { 2: { yes: false } };
  assert.equal(nextLabel(items, drafts).index, 0);
  assert.equal(nextLabel(items, drafts, 0).index, 3);
  assert.equal(nextLabel(items, drafts, 3).index, 0);
  assert.equal(nextLabel([items[1]], drafts), null);
  assert.equal(nextLabel([], drafts), null);
});
