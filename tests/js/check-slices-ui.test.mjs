import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../static/js/workbench.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const target = { field: "channel", value: "email", min_accuracy: 0.95, min_coverage: 0.5 };

test("offers text slices from tuning inputs, excluding held-out rows, labels, markers, and mixed types", () => {
  const options = new Function(`${body("availableCheckSlices")}; return availableCheckSlices;`)();
  assert.deepEqual(options([
    { row: { channel: " email ", region: "west", mixed: "one", _expect: { topic: "billing" } } },
    { row: { channel: "chat", region: null, mixed: 2 } },
    { row: { channel: "private-test-channel", hidden: "private", _test: true } },
    { row: "text without fields" },
  ]), [
    { field: "channel", values: ["email", "chat", "(none)"] },
    { field: "region", values: ["west", "(none)"] },
  ]);
});

test("saved targets survive replacement, edits do not change saved configuration, and dataset switching resets them", () => {
  const W = { bulk: { dataset: { id: "coffee" }, checkSlices: { datasetId: null, targets: null },
    datasets: [{ id: "coffee", check: { slice_targets: [{ ...target }] } }, { id: "legacy", check: {} }] } };
  const get = new Function("W", `${body("checkSliceTargets")}; return checkSliceTargets;`)(W);
  const selected = get();
  assert.deepEqual(selected, [target]);
  selected[0].min_accuracy = 0.9;
  assert.equal(get()[0].min_accuracy, 0.9);
  assert.equal(W.bulk.datasets[0].check.slice_targets[0].min_accuracy, 0.95);
  selected.splice(0, 1);
  assert.deepEqual(get(), [], "removing the last target does not reload the saved targets");
  W.bulk.dataset.id = "legacy";
  assert.deepEqual(get(), []);
  W.bulk.dataset.id = "coffee";
  assert.deepEqual(get(), [target]);
});

function h(tag, attrs = {}, ...children) {
  const node = { tag, attrs, children: children.flat(Infinity).filter((v) => v != null && v !== false), listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; } };
  node.value = attrs.value ?? (tag === "select" ? node.children[0]?.attrs.value ?? "" : "");
  return node;
}
function mount(node, ...children) {
  if (typeof node === "string") return;
  node.children = children.flat(Infinity);
  if (node.tag === "select") node.value = node.children[0]?.attrs.value ?? "";
}
const find = (node, tag) => node && typeof node === "object" ? [...(node.tag === tag ? [node] : []), ...node.children.flatMap((v) => find(v, tag))] : [];
const text = (node) => node && typeof node === "object" ? node.children.map(text).join(" ") : String(node);

test("slice form adds selected values, edits percentages, and removes targets", () => {
  const targets = [{ ...target }];
  const W = { bulk: { result: { results: [{ row: { channel: "email" } }, { row: { channel: "chat" } }] } } };
  const funcs = ["availableCheckSlices", "checkSliceForm"].map(body).join("\n");
  const form = new Function("W", "h", "mount", "checkSliceTargets", `${funcs}; return checkSliceForm;`)(W, h, mount, () => targets);
  const first = form();
  assert.deepEqual(find(first, "option").map((option) => option.attrs.value), ["channel", "chat"]);
  const accuracy = find(first, "input")[0];
  accuracy.value = "97";
  accuracy.listeners.input();
  assert.equal(targets[0].min_accuracy, 0.97);
  find(first, "button").find((button) => text(button) === "Add slice target").attrs.onclick();
  assert.deepEqual(targets[1], { field: "channel", value: "chat", min_accuracy: 0.9, min_coverage: 0 });
  assert.match(text(form()), /No unused text-valued slices/);
  find(form(), "button")[0].attrs.onclick();
  assert.deepEqual(targets.map((t) => t.value), ["chat"]);
});

test("save handler sends the current slice configuration with the check", async () => {
  let saved;
  const W = { bulk: { policy: { signal: "confidence", bound: "lower" }, dataset: { id: "coffee" }, datasets: [], checkRuns: {} } };
  const handler = new Function("W", "$", "checkBlocker", "activeGates", "gateModel", "tunedOn", "policyRules", "attachedSetsPayload", "checkSliceTargets", "api", "toast", "render", "handleError",
    `${body("saveCheck")}; return saveCheck;`)(W, (selector) => ({ value: selector.includes("accuracy") ? "95" : "50" }), () => null,
    () => ({ topic: 0.8 }), () => "jev-1.14.0", () => "jev-1.14.0", () => "", () => undefined, () => [target],
    async (path, payload) => {
      if (payload) saved = payload.check;
      return { datasets: [] };
    }, () => {}, () => {}, (error) => { throw error; });
  await handler();
  assert.deepEqual(saved.slice_targets, [target]);
  assert.equal(saved.bound, "lower");
});

test("slice report shows missing slices and per-slice measured values with targets", () => {
  const render = new Function("h", "pct", "CHECK_BADGE", `${body("sliceCheckReport")}; return sliceCheckReport;`)(h,
    (value) => `${value * 100}%`, { pass: ["good", "", "Passed"], fail: ["critical", "", "Failed"], error: ["warning", "", "Not judged"] });
  const view = render({ slice_targets: [
    { field: "channel", value: "email", status: "fail", rows: 10, labeled: 10, coverage: 0.8,
      targets: { accuracy: { value: 0.7, target: 0.95, bound: "lower" }, coverage: { target: 0.5 } } },
    { field: "channel", value: "missing", status: "error", rows: 0, reasons: ["No rows match this required slice."] },
  ] });
  assert.match(text(view), /channel = email/);
  assert.match(text(view), /70% \/ 95% \(95% lower bound\)/);
  assert.match(text(view), /80% \/ 50%/);
  assert.match(text(view), /Not judged/);
  assert.match(text(view), /No rows match this required slice/);
  assert.equal(render({}), null);
});

test("upgrade sides keep unevaluable slice details visible even without overall targets", () => {
  const badges = { pass: ["good", "", "Passed"], fail: ["critical", "", "Failed"], error: ["warning", "", "Not judged"] };
  const funcs = ["sliceCheckReport", "upgradeReport"].map(body).join("\n");
  const render = new Function("h", "pct", "CHECK_BADGE", "UPGRADE_BADGE", "icon", "checkTargetsText",
    `${funcs}; return upgradeReport;`)(h, (n) => `${n * 100}%`, badges, { error: ["warning", "", "Not judged"] }, () => "", () => "targets");
  const side = { model: "jev-1.14.0", answered_by: [], rows: 0 };
  const judged = { status: "error", targets: {}, slice_targets: [{ field: "channel", value: "email", status: "error", rows: 0,
    reasons: ["No rows match this required slice."] }] };
  const view = render({}, { verdict: "error", check: { gates: { topic: 0.8 }, min_accuracy: 0.9 },
    sides: { current: side, candidate: side }, current: judged, candidate: { ...judged, targets: { accuracy: {} }, accuracy: 1, coverage: 1 },
    retuned: {}, paired: { rows: 0 }, changed: { questions: [], rows: [] }, reasons: [], proposals: {} });
  assert.equal((text(view).match(/channel = email/g) || []).length, 2);
  assert.equal((text(view).match(/No rows match this required slice/g) || []).length, 2);
  assert.doesNotMatch(text(view), /misses/);
});
