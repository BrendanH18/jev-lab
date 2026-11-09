import assert from "node:assert/strict";
import { test } from "node:test";
import { workbenchSource } from "./workbench-source.mjs";

const source = workbenchSource;
const body = source.match(/function auditSlices\([^\n]*\) \{[\s\S]*?\n\}/)[0];
function h(tag, attrs, ...children) {
  return { tag, attrs, children: children.flat(Infinity).filter((x) => x != null), listeners: {},
    addEventListener(event, fn) { this.listeners[event] = fn; } };
}
const text = (node) => typeof node === "object" ? node.children.map(text).join(" ") : String(node);
const find = (node, tag) => typeof node === "object"
  ? [...(node.tag === tag ? [node] : []), ...node.children.flatMap((n) => find(n, tag))] : [];

test("slice selection renders batch counts and intervals and makes no request", () => {
  let renders = 0;
  const view = new Function("h", "pct", "withCI", "render", `${body}; return auditSlices;`)(
    h, (p) => `${p * 100}%`, (p, low, high) => `${p} [${low}, ${high}]`, () => renders++);
  const stats = { rows: 2, correct: 1, accuracy: 0.5, accuracy_low: 0.1, accuracy_high: 0.9 };
  const a = { by_slice: [{ field: "channel", slices: [{ ...stats, value: "email" }] },
    { field: "language", slices: [{ ...stats, value: "fr" }] }] };
  let tree = view(a);
  assert.match(text(tree), /email 2 1 50% \[0.1, 0.9\]/);
  assert.doesNotMatch(text(tree), /fr 2/);
  const selector = find(tree, "select")[0];
  selector.value = "language";
  selector.listeners.change();
  assert.equal(renders, 1);
  tree = view(a);
  assert.match(text(tree), /fr 2 1/);
  assert.doesNotMatch(text(tree), /email 2/);
  assert.equal(find(tree, "option").find((n) => n.attrs.selected).attrs.value, "language");
  assert.match(text(tree), /Small slices have wide intervals/);
  assert.match(text(tree), /results are not saved/);
});

test("a batch without slice fields explains missing evidence", () => {
  const view = new Function("h", `${body}; return auditSlices;`)(h);
  assert.match(text(view({ by_slice: [] })), /More varied audited rows are needed/);
});
