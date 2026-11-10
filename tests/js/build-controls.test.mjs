import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renameEditorQuestion, duplicateChoiceOption, moveEditorEntryTo } from "../../static/js/build-editing.js";
import { editorQuestionError } from "../../static/js/build-request.js";

const source = readFileSync(new URL("../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const question = (id = "route", type = "choice") => ({ id, type, instructions: "Which department?", choice: [["billing", "Invoices"], ["shipping", "Deliveries"]], score: ["Low", "High"], noulYes: "Yes", noulNo: "" });
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((v) => v != null), events: {}, addEventListener(name, fn) { this.events[name] = fn; } });
const descendants = (node) => [node, ...(node?.children || []).flatMap((child) => typeof child === "object" ? descendants(child) : [])];

test("safe rename moves only the original expectation and rejects conflicting identities", () => {
  const rows = [question(), question("other")], expect = { route: { choice: "billing" }, other: { min: 0 } };
  const renamed = renameEditorQuestion(rows, expect, 0, " new_route ");
  assert.deepEqual(renamed.rows.map((row) => row.id), ["new_route", "other"]);
  assert.deepEqual(renamed.expect, { new_route: { choice: "billing" }, other: { min: 0 } });
  assert.equal(rows[0].id, "route");
  assert.equal(expect.route.choice, "billing");
  assert.equal(renamed.rows[1], rows[1]);
  assert.throws(() => renameEditorQuestion(rows, expect, 0, "other"), /already uses/);
  assert.throws(() => renameEditorQuestion(rows, expect, 0, " "), /nonempty/);
  assert.throws(() => renameEditorQuestion(rows, { ...expect, orphan: { min: 0 } }, 0, "orphan"), /Expectations already/);
  assert.throws(() => renameEditorQuestion([question(), question()], expect, 0, "new"), /repeated original/);
  assert.equal(Object.hasOwn(renameEditorQuestion(rows, expect, 0, "__proto__").expect, "__proto__"), true);
});

test("duplicated choice options retain descriptions with unique trim-safe independent keys", () => {
  const options = [["billing", "Invoices"], [" billing_copy ", "Taken"], ["billing_copy_2", "Also taken"]];
  const copy = duplicateChoiceOption(options, 0);
  assert.deepEqual(copy[1], ["billing_copy_3", "Invoices"]);
  copy[1][1] = "Changed";
  assert.equal(options[0][1], "Invoices");
  assert.equal(duplicateChoiceOption(options, -1), options);
});

test("insert before and after create a fresh same-type question without expectations", () => {
  for (const after of [false, true]) {
    const W = { questions: [question("first"), question("second", "score")], expect: { second: { min: 1 } } };
    let edits = 0;
    const filters = { query: "hidden", type: "choice" };
    const insert = new Function("W", "blankRow", "buildQuestionView", "markBuildEdited", "render", `${body("insertBuildQuestion")}; return insertBuildQuestion;`)(W, (type) => ({ ...question("fresh", type), instructions: "" }), filters, () => edits++, () => {});
    insert(1, after);
    assert.deepEqual(W.questions.map((q) => q.id), after ? ["first", "second", "fresh"] : ["first", "fresh", "second"]);
    assert.equal(W.questions[after ? 2 : 1].type, "score");
    assert.deepEqual(W.expect, { second: { min: 1 } });
    assert.deepEqual(filters, { query: "", type: "all" });
    assert.equal(edits, 1);
  }
});

function cardHarness(row) {
  const W = { questions: [row] }, copies = [], messages = [];
  let edits = 0;
  const toQuestions = (rows) => ({ question: { criteria: rows[0].type === "choice" ? Object.fromEntries(rows[0].choice) : rows[0].score } });
  const renderCard = new Function("W", "h", "buildEditState", "TYPES", "markBuildEdited", "render", "icon", "editorMoveButtons", "questionEditorError", "toQuestions", "copyText", "toast", "moveEditorEntryTo", "duplicateChoiceOption", `${body("renderQuestionCard")}; return renderQuestionCard;`)(W, h, () => ({ collapsed: new WeakSet() }), ["noul", "choice", "score", "box"], () => edits++, () => {}, () => null, () => [], editorQuestionError, toQuestions, (text) => copies.push(text), (text) => messages.push(text), moveEditorEntryTo, duplicateChoiceOption);
  const nodes = () => descendants(renderCard(row, 0));
  return { copies, messages, edits: () => edits, nodes, click: (label) => nodes().find((node) => node.attrs?.["aria-label"] === label || node.children?.includes(label)).attrs.onclick() };
}

test("Choice duplicate and endpoint controls preserve key-description pairs and invalidate results", () => {
  const row = question(), harness = cardHarness(row);
  harness.click("Move option shipping first");
  assert.deepEqual(row.choice[0], ["shipping", "Deliveries"]);
  harness.click("Duplicate option shipping");
  assert.deepEqual(row.choice[1], ["shipping_copy", "Deliveries"]);
  harness.click("Move option shipping last");
  assert.deepEqual(row.choice.at(-1), ["shipping", "Deliveries"]);
  assert.equal(harness.edits(), 3);
});

test("Score duplicate and endpoint controls keep explicit ordinal ordering", () => {
  const row = question("rating", "score"), harness = cardHarness(row);
  harness.click("Duplicate level 0");
  assert.deepEqual(row.score, ["Low", "Low", "High"]);
  harness.click("Move level 2 first");
  assert.deepEqual(row.score, ["High", "Low", "Low"]);
  harness.click("Move level 0 last");
  assert.deepEqual(row.score, ["Low", "Low", "High"]);
  assert.equal(harness.edits(), 3);
});

test("instruction and criteria copies contain only the chosen request content and never edit", () => {
  const row = question(), harness = cardHarness(row);
  harness.click("Copy instructions");
  harness.click("Copy criteria");
  assert.equal(harness.copies[0], "Which department?");
  assert.deepEqual(JSON.parse(harness.copies[1]), { billing: "Invoices", shipping: "Deliveries" });
  assert.equal(harness.edits(), 0);
});

test("criteria summary counts defined options, levels and outcomes rather than blank editor rows", () => {
  for (const [type, expected] of [["choice", "2 named options"], ["score", "2 defined levels"], ["noul", "1 defined outcomes"], ["box", "Coordinates only · no criteria"]]) {
    const row = question("q", type);
    row.choice.push(["", ""]); row.score.push("");
    const summary = cardHarness(row).nodes().find((node) => node.attrs?.id === "build-criteria-count-0");
    assert.equal(summary.children[0], expected);
  }
});

test("criteria copy rejects repeated keys even before a question id is entered", () => {
  const row = question("");
  row.choice.push(["billing", "Duplicate"]);
  const harness = cardHarness(row);
  harness.click("Copy criteria");
  assert.equal(harness.copies.length, 0);
  assert.match(harness.messages[0], /repeats option key/);
});
