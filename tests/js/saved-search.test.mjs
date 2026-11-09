import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSaved, matchesDataset } from "../../static/js/saved-search.js";

const rows = [
  { id: "tickets", name: "Harbor support", notes: "Email traffic", rows: 3, labeled: 2, check: {} },
  { id: "orders", name: "Order routing", notes: "Chat traffic", rows: 4, labeled: 0 },
  { id: "reviews", name: "Customer feedback", rows: 2, labeled: 2 },
];

test("search finds names, notes and identifiers without case sensitivity", () => {
  assert.equal(matchesSaved(rows[0], " HARBOR "), true);
  assert.equal(matchesSaved(rows[0], "email"), true);
  assert.equal(matchesSaved(rows[0], "tickets"), true);
  assert.equal(matchesSaved(rows[0], "orders"), false);
  assert.equal(matchesSaved(rows[2], ""), true);
});

test("dataset filters combine check and row-label status without changing their source", () => {
  const before = structuredClone(rows);
  assert.deepEqual(rows.filter((row) => matchesDataset(row, { check: "with", labels: "some" })), [rows[0]]);
  assert.deepEqual(rows.filter((row) => matchesDataset(row, { check: "without", labels: "none" })), [rows[1]]);
  assert.deepEqual(rows.filter((row) => matchesDataset(row, { labels: "every" })), [rows[2]]);
  assert.deepEqual(rows.filter((row) => matchesDataset(row, { query: "feedback", labels: "every" })), [rows[2]]);
  assert.equal(matchesDataset({ rows: 0, labeled: 0 }, { labels: "every" }), false);
  assert.deepEqual(rows, before);
});
