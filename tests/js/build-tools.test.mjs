import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { matchesEditorQuestion, editorCriterionCount, editorQuestionOutline, reorderEditorCriteria } from "../../static/js/build-editing.js";
import { editorQuestionError } from "../../static/js/build-request.js";

const source = readFileSync(new URL("../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const question = (id = "route", type = "choice") => ({ id, type, instructions: "Which department? ☕",
  choice: [["shipping", "Deliveries"], ["billing", "Invoices"], ["", ""]], score: ["Low", "High"], noulYes: "Present", noulNo: "Absent" });
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((v) => v != null),
  events: {}, addEventListener(name, fn) { this.events[name] = fn; } });
const descendants = (node) => [node, ...(node?.children || []).flatMap((child) => typeof child === "object" ? descendants(child) : [])];

test("field-scoped searches and exclusions inspect only active authored fields", () => {
  const row = question();
  assert.equal(matchesEditorQuestion(row, { searchField: "id", query: "route" }), true);
  assert.equal(matchesEditorQuestion(row, { searchField: "instructions", query: "route" }), false);
  assert.equal(matchesEditorQuestion(row, { searchField: "criteria", query: "INVOICES" }), true);
  assert.equal(matchesEditorQuestion(row, { searchField: "instructions", exclude: "invoices" }), true);
  assert.equal(matchesEditorQuestion(row, { searchField: "criteria", exclude: " invoices " }), false);
  assert.equal(matchesEditorQuestion(row, { query: "Low" }), false, "inactive Score criteria do not affect Choice searches");
  assert.equal(matchesEditorQuestion(question("box", "box"), { searchField: "criteria", query: "Present" }), false);
});

test("minimum and maximum criteria filters count defined entries and reject invalid bounds", () => {
  const row = question();
  assert.equal(editorCriterionCount(row), 2);
  assert.equal(editorCriterionCount(question("score", "score")), 2);
  assert.equal(editorCriterionCount(question("noul", "noul")), 2);
  assert.equal(editorCriterionCount(question("box", "box")), 0);
  assert.equal(matchesEditorQuestion(row, { minCriteria: "2", maxCriteria: "2" }), true);
  assert.equal(matchesEditorQuestion(row, { minCriteria: "3" }), false);
  assert.equal(matchesEditorQuestion(row, { maxCriteria: "1" }), false);
  for (const value of ["-1", "1.5", "NaN", "Infinity"]) assert.equal(matchesEditorQuestion(row, { maxCriteria: value }), false);
  assert.equal(matchesEditorQuestion(row, { maxCriteria: "0" }), false);
});

test("instruction counts render and update Unicode characters independently of request bytes", () => {
  const row = question("urgent", "noul"); row.instructions = "☕😀";
  const W = { questions: [row], expect: {}, images: [] };
  const card = new Function("W", "h", "buildEditState", "TYPES", "icon", "editorMoveButtons", `${body("renderQuestionCard")}; return renderQuestionCard;`)(
    W, h, () => ({ collapsed: new WeakSet() }), ["noul"], () => null, () => []);
  const count = descendants(card(row, 0)).find((node) => node.attrs?.id === "build-instruction-count-0");
  assert.equal(count.children[0], "2 instruction characters");
  const current = {};
  const edit = new Function("W", "$", `${body("markBuildEdited")}; return markBuildEdited;`)(W, (selector) => selector === "#build-instruction-count-0" ? current : null);
  row.instructions += "é"; edit();
  assert.equal(current.textContent, "3 instruction characters");
});

test("shown JSON copying and downloads contain authored questions only and never mutate the request", async () => {
  const rows = [question()], copied = [], downloads = [], messages = [];
  let shown = rows, raw = null;
  const share = new Function("visibleBuildQuestions", "questionEditorError", "toQuestions", "copyText", "toast", "editorQuestionOutline", "URL", "Blob", "h", "setTimeout", "getRaw", `
    ${body("shareShownQuestions").replace('if (buildRawText !== null)', 'if (getRaw() !== null)')}; return shareShownQuestions;
  `)(() => shown, editorQuestionError, (rows) => Object.fromEntries(rows.map((row) => [row.id, { type: row.type, instructions: row.instructions }])),
    (text) => copied.push(text), (text) => messages.push(text), editorQuestionOutline,
    { createObjectURL: (blob) => { downloads.push({ blob }); return "blob:test"; }, revokeObjectURL: () => {} }, Blob,
    (tag, attrs) => ({ click: () => Object.assign(downloads.at(-1), attrs) }), (fn) => fn(), () => raw);
  const before = JSON.stringify(rows);
  share("copy"); share("json"); share("outline");
  assert.deepEqual(JSON.parse(copied[0]), { route: { type: "choice", instructions: rows[0].instructions } });
  assert.equal(await downloads[0].blob.text(), copied[0]);
  assert.equal(downloads[0].download, "jev-questions.json");
  assert.equal(downloads[1].download, "jev-question-outline.txt");
  const outline = await downloads[1].blob.text();
  assert.match(outline, /position\tid\ttype\tcriteria\tinstruction_characters/);
  assert.ok(!outline.includes(rows[0].instructions));
  assert.ok(!outline.includes("Invoices"));
  assert.equal(JSON.stringify(rows), before);
  shown = []; share("json");
  assert.equal(downloads.length, 2, "empty filtered selection cannot export the complete request");
  shown = [question("same"), question("same")]; share("json");
  assert.equal(downloads.length, 2, "duplicate IDs are rejected before serialization");
  for (const blank of ["", "   "]) {
    shown = [question(), question(blank)]; share("json"); share("copy");
    assert.equal(downloads.length, 2, "blank IDs cannot silently drop shown cards from downloads");
    assert.equal(copied.length, 1, "blank IDs cannot silently drop shown cards from clipboard JSON");
    assert.match(messages.at(-1), /id before sharing/);
  }
  raw = "pending"; share("copy");
  assert.equal(copied.length, 1);
  assert.match(messages.at(-1), /Apply the Raw JSON/);
});

test("Choice sorting preserves key-description association and Score reversal preserves authored values", () => {
  const row = question(), before = JSON.stringify(row);
  const sorted = reorderEditorCriteria(row, "sort");
  assert.deepEqual(sorted.choice, [["", ""], ["billing", "Invoices"], ["shipping", "Deliveries"]]);
  assert.equal(sorted.id, row.id);
  assert.equal(JSON.stringify(row), before);
  const score = question("rating", "score");
  assert.deepEqual(reorderEditorCriteria(score, "reverse").score, ["High", "Low"]);
  assert.deepEqual(score.score, ["Low", "High"]);
});

test("Score reverse requires deliberate acceptance and invalidates old request products without changing expectations", () => {
  const W = { questions: [question("rating", "score")], expect: { rating: { min: 1 } } };
  let accept = false, edits = 0, renders = 0;
  const reverse = new Function("W", "window", "reorderEditorCriteria", "markBuildEdited", "render", `${body("reorderBuildCriteria")}; return reorderBuildCriteria;`)(
    W, { confirm: (text) => { assert.match(text, /numeric meaning/); return accept; } }, reorderEditorCriteria, () => edits++, () => renders++);
  reverse(0, "reverse");
  assert.deepEqual(W.questions[0].score, ["Low", "High"]);
  assert.equal(edits, 0);
  accept = true; reverse(0, "reverse");
  assert.deepEqual(W.questions[0].score, ["High", "Low"]);
  assert.deepEqual(W.expect.rating, { min: 1 });
  assert.equal(edits, 1); assert.equal(renders, 1);
});

test("inserting a question clears every filter so the blank question remains visible", () => {
  for (const after of [false, true]) {
    const W = { questions: [question()], expect: {} };
    const view = { query: "department", type: "choice", instructions: "with", criteria: "with",
      expectations: "with", searchField: "instructions", exclude: "fresh", minCriteria: "2", maxCriteria: "3" };
    const fresh = { ...question("fresh"), instructions: "", choice: [["", ""]] };
    assert.equal(matchesEditorQuestion(fresh, view, W.expect), false);
    let edits = 0;
    const insert = new Function("W", "blankRow", "buildQuestionView", "markBuildEdited", "render", `${body("insertBuildQuestion")}; return insertBuildQuestion;`)(
      W, () => fresh, view, () => edits++, () => {});
    insert(0, after);
    assert.equal(W.questions[Number(after)], fresh);
    assert.deepEqual(view, { query: "", type: "all" });
    assert.equal(matchesEditorQuestion(fresh, view, W.expect), true);
    assert.equal(edits, 1);
  }
});
