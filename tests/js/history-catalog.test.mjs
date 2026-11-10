import assert from "node:assert/strict";
import { test } from "node:test";
import { createHistory } from "../../static/js/history.js";

const h = (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((child) => child != null && child !== false) });
const nodes = (node) => typeof node !== "object" ? [] : [node, ...node.children.flatMap(nodes)];
const text = (node) => typeof node !== "object" ? String(node) : node.children.map(text).join("");
const button = (node, name) => nodes(node).find((entry) => entry.tag === "button" && text(entry) === name);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const entries = [
  { revision: "same", at: "2026-11-08T12:00:00Z", current: true, rows: 3, labeled: 2, questions: ["urgent"] },
  { revision: "old", at: "2026-11-07T12:00:00Z", current: false, rows: 2, labeled: 1, questions: ["urgent"] },
];
const report = { id: "coffee", exists: true, revision: "file-token", rows: { before: 3, after: 3, added: 0, removed: 0 },
  labels: { added: 0, removed: 0, changed: 0 }, check: "none", test: { before: 0, after: 0, history: "none" } };

function harness() {
  const calls = [];
  const api = async (path, body) => {
    calls.push([path, body]);
    if (path.endsWith("/deleted")) return { datasets: [{ id: "coffee", name: "Harbor", revisions: 2 }, { id: "old", name: "Other", revisions: 1 }] };
    if (path.endsWith("/preview")) return report;
    if (path.endsWith("/history")) return { id: body.id, revisions: entries, keep: 20 };
    assert.fail(`Unexpected mutation ${path}`);
  };
  return { calls, ui: createHistory({ h, api, render: () => {}, toast: () => {}, handleError: (error) => { throw error; } }) };
}

test("history filter hides current copies with counts and removes a now-hidden restore preview", async () => {
  const { ui, calls } = harness();
  ui.button("coffee").attrs.onclick();
  await settle();
  button(ui.panel("coffee"), "Preview restore").attrs.onclick();
  await settle();
  assert.ok(button(ui.panel("coffee"), "Restore this revision"));
  const checkbox = nodes(ui.panel("coffee")).find((entry) => entry.tag === "input" && entry.attrs.type === "checkbox");
  checkbox.attrs.onchange({ target: { checked: true } });
  const filtered = ui.panel("coffee");
  assert.match(text(filtered), /1 of 2 revisions shown/);
  assert.doesNotMatch(text(filtered), /same as current/);
  assert.equal(button(filtered, "Restore this revision"), undefined);
  assert.equal(calls.length, 2, "filtering makes no API request");
  button(filtered, "Preview restore").attrs.onclick();
  await settle();
  assert.deepEqual(calls[2], ["/api/workbench/datasets/history/preview", { id: "coffee", revision: "old" }]);
});

test("deleted dataset search keeps open history mounted and performs no reads or writes", async () => {
  const { ui, calls } = harness();
  ui.deleted().attrs.ontoggle({ target: { open: true } });
  await settle();
  ui.button("coffee").attrs.onclick();
  await settle();
  const section = ui.deleted();
  const search = nodes(section).find((entry) => entry.attrs["aria-label"] === "Search deleted datasets");
  const rows = [{ dataset: { deletedDataset: "coffee" }, style: {} }, { dataset: { deletedDataset: "old" }, style: {} }];
  const count = {}, empty = {};
  const root = { querySelectorAll: () => rows, querySelector: (selector) => selector === "[data-deleted-count]" ? count : empty };
  search.attrs.oninput({ target: { value: "missing", closest: () => root } });
  assert.ok(rows.every((row) => row.style.display === "none"));
  assert.equal(empty.hidden, false);
  search.attrs.oninput({ target: { value: " HARBOR ", closest: () => root } });
  assert.equal(rows[0].style.display, "");
  assert.equal(rows[1].style.display, "none");
  assert.equal(count.textContent, "1 of 2 deleted datasets shown");
  assert.ok(button(ui.deleted(), "Preview restore"), "open history survives search and subsequent renders");
  assert.equal(calls.length, 2);
});
