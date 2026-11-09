import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const source = workbenchSource;
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const { queueVisible, queueNextIncomplete } = new Function(
  ["queueReady", "queueVisible", "queueNextIncomplete"].map(body).join("\n")
  + "; return { queueVisible, queueNextIncomplete };")();
const gates = { urgent: 0.5 };
const row = (line, kind, value) => ({ line, kind, row: { text: `Traffic ${line}` },
  labels: { urgent: value }, answers: { urgent: true }, held: ["urgent"], rules: [], open: ["urgent"], provenance: { version: 1 } });

function h(tag, attrs, ...children) {
  return { tag, attrs, children: children.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false),
    addEventListener() {} };
}
const textOf = (node) => typeof node === "object" ? node.children.map(textOf).join(" ") : String(node);
const find = (node, tag) => typeof node === "object"
  ? [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => find(child, tag))] : [];

test("kind and status filters preserve the queue and treat false and zero as ready labels", () => {
  const items = [row(1, "review", null), row(2, "audit", false), row(3, "audit", null), row(4, "review", 0)];
  const original = structuredClone(items);
  assert.deepEqual(queueVisible(items, gates, "audit", "incomplete"), [items[2]]);
  assert.deepEqual(queueVisible(items, gates, "all", "ready"), [items[1], items[3]]);
  assert.deepEqual(queueVisible(items, gates, "review"), [items[0], items[3]]);
  assert.deepEqual(items, original);
});

test("next incomplete follows queue order and kind, wraps, and skips newly completed rows", () => {
  const items = [row(1, "review", null), row(2, "audit", false), row(3, "audit", null), row(4, "audit", null)];
  assert.equal(queueNextIncomplete(items, gates).line, 1);
  assert.equal(queueNextIncomplete(items, gates, "audit").line, 3);
  assert.equal(queueNextIncomplete(items, gates, "audit", 3).line, 4);
  assert.equal(queueNextIncomplete(items, gates, "audit", 4).line, 3);
  items[2].labels.urgent = false;
  assert.equal(queueNextIncomplete(items, gates, "audit", 4).line, 4);
  items[3].labels.urgent = false;
  assert.equal(queueNextIncomplete(items, gates, "audit"), undefined);
});

test("filtered view keeps blind audit answers hidden and Add counts all ready rows", () => {
  const items = [row(1, "review", false), row(2, "audit", null), row(3, "audit", true)];
  const q = { report: { items, gates, questions: { urgent: { type: "noul" } }, room: 10,
    counts: { decisions: 3, review: 1, auto: 2, queued: 3, audit: 2 } }, kindFilter: "audit", statusFilter: "incomplete" };
  let csvItems;
  const functions = ["queueView", "queueReady", "queueVisible", "queueNextIncomplete", "queueSelect", "queueClasses", "shownAnswer", "labelText", "labelValue"].map(body).join("\n");
  const view = new Function("W", "h", "icon", "rowText", "queueCsv", "render", "nextQueueRow", "addQueued",
    `${functions}; return queueView;`)({ bulk: { pictures: {} } }, h, () => "", (r) => r.text,
    (_id, queue) => { csvItems = queue.report.items; return null; }, () => {}, () => {}, () => {});
  const tree = view({ id: "tickets" }, q);
  assert.match(textOf(tree), /2 of 3 rows ready · 1 incomplete · showing 1/);
  assert.match(textOf(tree), /Traffic 2/);
  assert.doesNotMatch(textOf(tree), /Traffic 1|Traffic 3|gate:|Suggested shortlist/);
  assert.match(textOf(tree), /Add 2 labeled rows/);
  assert.equal(csvItems, items, "CSV receives the whole queue, including hidden rows");
  const controls = find(tree, "select");
  controls[0].attrs.onchange({ target: { value: "review" } });
  assert.equal(q.kindFilter, "review");
  assert.deepEqual(q.report.items, items);
});

test("jump changes only presentation, then scrolls and focuses the next incomplete label", () => {
  const items = [row(1, "review", null), row(2, "audit", null), row(3, "audit", false)];
  const q = { report: { items, gates }, kindFilter: "audit", statusFilter: "ready", nextLine: null };
  const calls = [];
  const document = { getElementById(id) { calls.push(id); return {
    scrollIntoView: () => calls.push("scroll"), querySelector: () => ({ focus: () => calls.push("focus") }),
  }; } };
  const next = new Function("W", "document", "render", `${["queueReady", "queueNextIncomplete", "nextQueueRow"].map(body).join("\n")}; return nextQueueRow;`)(
    { bulk: { checkRuns: { tickets: { queue: q } } } }, document, () => calls.push("render"));
  next("tickets");
  assert.equal(q.statusFilter, "incomplete");
  assert.equal(q.nextLine, 2);
  assert.deepEqual(calls, ["render", "queue-tickets-2", "scroll", "focus"]);
  assert.equal(q.report.items, items);
  q.busy = true;
  next("tickets");
  assert.equal(calls.length, 4);
});

test("slice filtering uses full normalized identities and previous navigation wraps inside the slice", () => {
  const common = "a".repeat(80);
  const items = [row(1, "audit", null), row(2, "audit", null), row(3, "review", null), row(4, "audit", null)];
  for (const item of items) item.slice_values = { channel: item.line === 2 ? `${common}right` : `${common}left` };
  const snapshot = structuredClone(items);
  assert.deepEqual(queueVisible(items, gates, "all", "all", "channel", `${common}right`), [items[1]]);
  assert.equal(queueNextIncomplete(items, gates, "audit", 4, "channel", `${common}left`, -1).line, 1);
  assert.equal(queueNextIncomplete(items, gates, "audit", 1, "channel", `${common}left`, -1).line, 4);
  assert.deepEqual(items, snapshot, "filters and navigation cannot mutate labels, audit membership, or inputs");
});
