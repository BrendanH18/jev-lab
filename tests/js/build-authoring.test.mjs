import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { matchesEditorQuestion, insertEditorCriterion, duplicateShownQuestions, moveEditorEntryTo } from "../../static/js/build-editing.js";
const source = readFileSync(new URL("../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const question = (id = "q", type = "choice") => ({ id, type, instructions: "Route this", choice: [["a", "A"], ["b", "B"]], score: ["Low", "High"], noulYes: "", noulNo: "" });
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((v) => v != null), addEventListener() {} });
const descendants = (node) => [node, ...(node?.children || []).flatMap((child) => typeof child === "object" ? descendants(child) : [])];

test("authoring filters combine without modifying questions or expectations", () => {
  const row = question(), expect = { q: { choice: "a" } }, before = JSON.stringify([row, expect]);
  assert.equal(matchesEditorQuestion(row, { instructions: "with", criteria: "with", expectations: "with" }, expect), true);
  for (const field of ["instructions", "criteria", "expectations"]) assert.equal(matchesEditorQuestion(row, { [field]: "without" }, expect), false);
  assert.equal(matchesEditorQuestion({ ...row, instructions: "  " }, { instructions: "without" }), true);
  assert.equal(matchesEditorQuestion({ ...row, choice: [["", "description only"]] }, { criteria: "without" }), true);
  assert.equal(matchesEditorQuestion({ ...row, type: "box" }, { criteria: "without" }), true);
  assert.equal(matchesEditorQuestion({ ...row, type: "score", score: [" "] }, { criteria: "without" }), true);
  assert.equal(matchesEditorQuestion({ ...row, type: "noul", noulYes: "yes" }, { criteria: "with" }), true);
  assert.equal(JSON.stringify([row, expect]), before);
});

test("duplicate shown preserves original order and deep-copies only shown questions with unique ids", () => {
  const rows = [question(), question("q_copy"), question("hidden")], before = JSON.stringify(rows);
  const result = duplicateShownQuestions(rows, [rows[0], rows[1]]);
  assert.deepEqual(result.map((q) => q.id), ["q", "q_copy_2", "q_copy", "q_copy_copy", "hidden"]);
  result[1].choice[0][1] = "new";
  assert.equal(JSON.stringify(rows), before);
  assert.equal(result[4], rows[2]);
  assert.deepEqual(duplicateShownQuestions(rows, []), rows);
});

test("criteria insertion preserves neighbors and inserts fresh blank values at requested positions", () => {
  for (const after of [false, true]) for (const type of ["choice", "score"]) {
    const original = type === "choice" ? [["a", "A"], ["b", "B"]] : ["Low", "High"];
    const before = JSON.stringify(original), result = insertEditorCriterion(original, 1, after, type);
    assert.deepEqual(result[1 + Number(after)], type === "choice" ? ["", ""] : "");
    assert.equal(result[0], original[0]);
    assert.equal(JSON.stringify(original), before);
  }
  const values = ["A"];
  assert.equal(insertEditorCriterion(values, -1, false, "score"), values);
});

test("question position prompt validates bounds, preserves expectations, and invalidates old results", () => {
  const W = { questions: [question("a"), question("b"), question("c")], expect: { a: { min: 0 } } };
  let entered = "3", edits = 0, errors = 0;
  const move = new Function("W", "window", "toast", "moveEditorEntryTo", "markBuildEdited", "render", `${body("moveBuildQuestionToPosition")}; return moveBuildQuestionToPosition;`)(W, { prompt: () => entered }, () => errors++, moveEditorEntryTo, () => edits++, () => {});
  move(0);
  assert.deepEqual(W.questions.map((q) => q.id), ["b", "c", "a"]);
  assert.deepEqual(W.expect, { a: { min: 0 } });
  for (entered of ["", "0", "4", "1.5", "bad", null]) move(0);
  assert.equal(edits, 1);
  assert.equal(errors, 5);
});

test("actual Choice and Score insertion controls invalidate answers and preserve expectation maps", () => {
  for (const type of ["choice", "score"]) for (const after of [false, true]) {
    const row = question("q", type), W = { questions: [row], expect: { q: { min: 0 } } };
    let edits = 0;
    const card = new Function("W", "h", "buildEditState", "TYPES", "markBuildEdited", "render", "icon", "editorMoveButtons", "insertEditorCriterion", `${body("renderQuestionCard")}; return renderQuestionCard;`)(W, h, () => ({ collapsed: new WeakSet() }), [type], () => edits++, () => {}, () => null, () => [], insertEditorCriterion);
    const label = type === "choice" ? `Insert option ${after ? "after" : "before"} b` : `Insert level ${after ? "after" : "before"} 1`;
    descendants(card(row, 0)).find((node) => node.attrs?.["aria-label"] === label).attrs.onclick();
    assert.deepEqual((type === "choice" ? row.choice : row.score)[1 + Number(after)], type === "choice" ? ["", ""] : "");
    assert.equal(edits, 1);
    assert.deepEqual(W.expect, { q: { min: 0 } });
  }
});

test("shown controls copy authored ids only and duplicate without copying expectations", () => {
  const W = { questions: [question("shown"), question("hidden")], expect: { shown: { min: 0 } } }, view = { query: "shown", type: "all" };
  let copied, edits = 0;
  const renderTools = new Function("W", "$", "buildQuestionView", "matchesEditorQuestion", "h", "TYPES", "copyText", "duplicateShownQuestions", "markBuildEdited", "render", `${body("visibleBuildQuestions")}; ${body("renderQuestionTools")}; return renderQuestionTools;`)(W, () => null, view, matchesEditorQuestion, h, ["choice"], (text) => { copied = text; }, duplicateShownQuestions, () => edits++, () => {});
  const click = (label) => descendants(renderTools()).find((node) => node.tag === "button" && node.children.includes(label)).attrs.onclick();
  click("Copy shown ids");
  assert.equal(copied, "shown");
  assert.equal(edits, 0);
  click("Duplicate shown");
  assert.deepEqual(W.questions.map((q) => q.id), ["shown", "shown_copy", "hidden"]);
  assert.deepEqual(W.expect, { shown: { min: 0 } });
  assert.equal(edits, 1);
});

test("filter refresh updates shown-action availability after a zero-match search", () => {
  const row = question(), W = { questions: [row] }, view = { query: "missing" };
  const copy = { disabled: false }, duplicate = { disabled: false };
  const elements = { "#build-copy-shown": copy, "#build-duplicate-shown": duplicate };
  const refresh = new Function("W", "$", "buildQuestionView", "matchesEditorQuestion", `${body("visibleBuildQuestions")}; ${body("refreshQuestionVisibility")}; return refreshQuestionVisibility;`)(W, (selector) => elements[selector] || null, view, matchesEditorQuestion);
  refresh();
  assert.equal(copy.disabled, true);
  assert.equal(duplicate.disabled, true);
  view.query = "";
  refresh();
  assert.equal(copy.disabled, false);
  assert.equal(duplicate.disabled, false);
});
