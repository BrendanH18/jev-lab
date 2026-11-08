import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { labelProgress, visibleLabels } from "../../static/js/prelabel.js";

const source = readFileSync(new URL("../../static/js/workbench.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const h = (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((x) => x != null && x !== false) });
const nodes = (n, tag) => typeof n !== "object" ? [] : [...(n.tag === tag ? [n] : []), ...n.children.flatMap((c) => nodes(c, tag))];
const report = { items: [{ index: 0, row: { text: "First" }, missing: ["urgent", "level"] }],
  questions: { urgent: { type: "noul", instructions: "Urgent?" }, level: { type: "score", criteria: ["low", "high"] } },
  eligible: 2, missing: 3, field: null, value: null, fields: [{ name: "channel" }], values: [] };
function harness(api) {
  const W = { bulk: { rowsText: "original", labelsDirty: false, result: { old: true }, pictures: {},
    prelabel: { busy: false, report: null, context: null, drafts: {} } } };
  let schema = "first";
  const context = () => JSON.stringify([W.bulk.rowsText, schema, W.bulk.labelsDirty]);
  const fn = new Function("W", "api", "prelabelContext", "settleLabels", "render", "handleError", "rowsPayload", "bulkQuestions",
    "loadPictureUrls", "rowsText", "syncAttachedSets", "toast", "h", "stringify", "photoView",
    "labelProgress", "visibleLabels", "preparedLabelCsv", "nextPreparedLabel",
    ["agreeQuestions", "labelText", "labelValue", "prepareLabels", "applyPreparedLabels", "prelabelBody"].map(body).join("\n")
      + "; return { prepareLabels, applyPreparedLabels, prelabelBody };"
  )(W, api, context, () => true, () => {}, (e) => { throw e; }, () => W.bulk.rowsText, () => schema,
    async () => {}, JSON.stringify, () => {}, () => {}, h, JSON.stringify, () => null, labelProgress, visibleLabels, () => null, () => {});
  return { W, ...fn, changeSchema: () => { schema = "changed"; } };
}

test("blank controls accept false and zero; drafts survive slice changes and apply every slice", async () => {
  const calls = [];
  const x = harness(async (path, data) => {
    calls.push({ path, data });
    return path.endsWith("/apply") ? { rows: [{ text: "First", _expect: { urgent: false, level: 0 } }], applied: 2 }
      : data.field ? { ...report, items: [], field: data.field } : report;
  });
  await x.prepareLabels();
  const selects = nodes(x.prelabelBody(), "select");
  selects.find((s) => s.attrs["aria-label"] === "Label urgent for row 1").attrs.onchange({ target: { value: "no" } });
  selects.find((s) => s.attrs["aria-label"] === "Label level for row 1").attrs.onchange({ target: { value: "0" } });
  assert.deepEqual({ ...x.W.bulk.prelabel.drafts[0] }, { urgent: false, level: 0 });
  await x.prepareLabels("channel");
  await x.applyPreparedLabels();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).data.items)), [{ index: 0, labels: { urgent: false, level: 0 } }]);
  assert.match(x.W.bulk.rowsText, /_expect/);
  assert.equal(x.W.bulk.result, null, "old result labels cannot overwrite applied labels");
  assert.equal(x.W.bulk.savedText, undefined, "does not persist or mark saved");
});

for (const change of ["rows", "questions"]) {
  test(`hides stale drafts and rejects a pending apply response after ${change} change`, async () => {
    let finish;
    const x = harness(async (path) => path.endsWith("/apply") ? new Promise((r) => { finish = r; }) : report);
    await x.prepareLabels();
    x.W.bulk.prelabel.drafts = { 0: { urgent: false } };
    const pending = x.applyPreparedLabels();
    if (change === "rows") x.W.bulk.rowsText = "new inputs"; else x.changeSchema();
    const before = x.W.bulk.rowsText;
    assert.ok(!JSON.stringify(x.prelabelBody()).includes("First"));
    finish({ rows: ["wrong"], applied: 1 });
    await pending;
    assert.equal(x.W.bulk.rowsText, before);
    await x.applyPreparedLabels();
    assert.equal(x.W.bulk.rowsText, before);
  });
}

test("discards a pending prepare response if inputs change", async () => {
  let finish;
  const x = harness(() => new Promise((r) => { finish = r; }));
  const pending = x.prepareLabels();
  x.W.bulk.rowsText = "changed";
  finish(report);
  await pending;
  assert.equal(x.W.bulk.prelabel.report, null);
});

 test("shows full Choice and Noul rubrics before human labeling", async () => {
  const x = harness(async () => ({ ...report, questions: { ...report.questions,
    urgent: { type: "noul", instructions: "Urgent?", criteria: { true: "Safety risk or deadline", false: "Routine request" } },
    team: { type: "choice", instructions: { task: "Choose a team" }, criteria: { A: "Order support", B: "Wholesale sales" } } } }));
  await x.prepareLabels();
  const text = JSON.stringify(x.prelabelBody());
  for (const rubric of ["Safety risk or deadline", "Routine request", "Order support", "Wholesale sales", "Choose a team"]) {
    assert.ok(text.includes(rubric), rubric);
  }
});

test("status filters show ready rows without dropping hidden drafts or their Apply count", async () => {
  const x = harness(async () => ({ ...report, items: [...report.items,
    { index: 4, row: { text: "Other slice" }, missing: ["urgent"] }] }));
  await x.prepareLabels();
  x.W.bulk.prelabel.drafts = { 0: { urgent: false, level: 0 }, 4: { urgent: true } };
  x.W.bulk.prelabel.status = "incomplete";
  const hidden = JSON.stringify(x.prelabelBody());
  assert.ok(!hidden.includes("Other slice"));
  assert.ok(hidden.includes("Apply 3 labels to rows"));
  x.W.bulk.prelabel.status = "ready";
  assert.ok(JSON.stringify(x.prelabelBody()).includes("Other slice"));
  assert.deepEqual(x.W.bulk.prelabel.drafts[0], { urgent: false, level: 0 });
});
