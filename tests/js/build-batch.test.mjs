import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { matchesEditorQuestion, moveShownQuestionsToEdge, removeBlankEditorCriteria, shownEditorInstructions, editorQuestionsMarkdown, reorderEditorCriteria } from "../../static/js/build-editing.js";

const source = readFileSync(new URL("../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const question = (id = "route", type = "choice") => ({ id, type, instructions: "Route ☕😀", choice: [["z", "Last"], ["a", "First"]], score: ["Low", "High"], noulYes: "Yes", noulNo: "No" });
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((v) => v != null), addEventListener() {} });
const descendants = (node) => [node, ...(node?.children || []).flatMap((child) => typeof child === "object" ? descendants(child) : [])];

test("ID prefix combines with text filters and Unicode instruction bounds without editing authored data", () => {
  const row = question("  Shield.route  "), before = JSON.stringify(row);
  const count = Array.from(row.instructions).length;
  assert.equal(matchesEditorQuestion(row, { idPrefix: " shield.", query: "route", minInstructions: count, maxInstructions: count }), true);
  assert.equal(matchesEditorQuestion(row, { idPrefix: "route" }), false);
  assert.equal(matchesEditorQuestion(row, { minInstructions: count + 1 }), false);
  assert.equal(matchesEditorQuestion(row, { maxInstructions: count - 1 }), false);
  for (const bound of ["-1", "1.1", "Infinity", "NaN"]) for (const field of ["minInstructions", "maxInstructions"]) {
    assert.equal(matchesEditorQuestion(row, { [field]: bound }), false);
  }
  assert.equal(matchesEditorQuestion({ ...row, instructions: "" }, { maxInstructions: "0" }), true);
  assert.equal(JSON.stringify(row), before);
});

test("moving a shown subset preserves full row identity, stable relative orders and hidden inputs", () => {
  const rows = [question("hidden1"), question("shown1"), question("hidden2"), question("shown2")];
  const before = JSON.stringify(rows), shown = [rows[3], rows[1]];
  assert.deepEqual(moveShownQuestionsToEdge(rows, shown).map((row) => row.id), ["shown1", "shown2", "hidden1", "hidden2"]);
  assert.deepEqual(moveShownQuestionsToEdge(rows, shown, true).map((row) => row.id), ["hidden1", "hidden2", "shown1", "shown2"]);
  assert.equal(moveShownQuestionsToEdge(rows, shown)[0], rows[1]);
  assert.deepEqual(moveShownQuestionsToEdge(rows, []), rows);
  assert.deepEqual(moveShownQuestionsToEdge(rows, rows, true), rows);
  assert.equal(JSON.stringify(rows), before);
});

test("blank criterion cleanup retains incomplete descriptions and leaves emitted criteria numerically unchanged", () => {
  const choice = question();
  choice.choice = [["", ""], [" ", " \t"], ["", "Keep me for repair"], [" a ", "A"], ["b", ""]];
  const score = question("score", "score"); score.score = ["", "Low", "  ", "High", ""];
  const cleanedChoice = removeBlankEditorCriteria(choice), cleanedScore = removeBlankEditorCriteria(score);
  assert.deepEqual(cleanedChoice.choice, [["", "Keep me for repair"], [" a ", "A"], ["b", ""]]);
  const emitted = (row) => row.type === "choice" ? row.choice.filter(([key]) => key.trim()) : row.score.filter((level) => level.trim());
  assert.deepEqual(emitted(choice), emitted(cleanedChoice));
  assert.deepEqual(emitted(score), emitted(cleanedScore));
  assert.deepEqual(cleanedScore.score, ["Low", "High"]);
  assert.equal(choice.choice.length, 5); assert.equal(score.score.length, 5);
  const box = question("box", "box"); assert.equal(removeBlankEditorCriteria(box), box);
});

test("descending and reverse Choice operations keep descriptions attached and preserve original rows", () => {
  const row = question(); row.choice.splice(1, 0, ["m", "Middle"]);
  assert.deepEqual(reorderEditorCriteria(row, "sort-desc").choice, [["z", "Last"], ["m", "Middle"], ["a", "First"]]);
  assert.deepEqual(reorderEditorCriteria(row, "reverse").choice, [["a", "First"], ["m", "Middle"], ["z", "Last"]]);
  assert.deepEqual(row.choice, [["z", "Last"], ["m", "Middle"], ["a", "First"]]);
});

test("authored handoffs exclude answers and expectations and safely fence arbitrary authored Markdown", () => {
  const row = { ...question("id\n## injected"), instructions: "```\n# authored", expect: "private labels", answers: "private answers", state: "private input" };
  const rows = [row, question("score", "score"), question("noul", "noul"), question("box", "box")];
  assert.equal(shownEditorInstructions(rows), rows.map((row) => row.instructions).join("\n\n"));
  const markdown = editorQuestionsMarkdown(rows);
  assert.match(markdown, /````\n```\n# authored\n````/);
  assert.match(markdown, /"key": "z"/); assert.match(markdown, /"description": "Last"/);
  assert.match(markdown, /"Low"/); assert.match(markdown, /"yes": "Yes"/);
  for (const secret of ["private labels", "private answers", "private input"]) assert.ok(!markdown.includes(secret));
});

test("toolbar filters wire to presentation state and moving shown rows invalidates results without moving expectations", () => {
  const W = { questions: [question("a"), question("b"), question("c")], expect: { b: { choice: "a" } } };
  const view = { query: "", type: "all" }, shown = [W.questions[1]];
  let refreshes = 0, edits = 0, renders = 0;
  const tools = new Function("h", "visibleBuildQuestions", "buildQuestionView", "TYPES", "W", "refreshQuestionVisibility", "moveShownQuestionsToEdge", "markBuildEdited", "render", `${body("renderQuestionTools")}; return renderQuestionTools;`)(h, () => shown, view, ["choice"], W, () => refreshes++, moveShownQuestionsToEdge, () => edits++, () => renders++);
  const nodes = descendants(tools());
  for (const [label, key, value] of [["Build question id prefix", "idPrefix", "b"], ["Minimum instruction characters", "minInstructions", "2"], ["Maximum instruction characters", "maxInstructions", "20"]]) {
    nodes.find((node) => node.attrs?.["aria-label"] === label).attrs.oninput({ target: { value } });
    assert.equal(view[key], value);
  }
  assert.equal(refreshes, 3); assert.equal(edits, 0);
  nodes.find((node) => node.attrs?.id === "build-move-shown-first").attrs.onclick();
  assert.deepEqual(W.questions.map((row) => row.id), ["b", "a", "c"]);
  nodes.find((node) => node.attrs?.id === "build-move-shown-last").attrs.onclick();
  assert.deepEqual(W.questions.map((row) => row.id), ["a", "c", "b"]);
  assert.deepEqual(W.expect, { b: { choice: "a" } });
  assert.equal(edits, 2); assert.equal(renders, 2);
});

test("actual handoff controls block pending Raw edits and empty shown sets before copying or downloading", async () => {
  const rows = [question()], copies = [], downloads = [], messages = [];
  let raw = null, shown = rows;
  const share = new Function("visibleBuildQuestions", "copyText", "toast", "shownEditorInstructions", "editorQuestionsMarkdown", "URL", "Blob", "h", "setTimeout", "getRaw", `${body("shareShownQuestions").replace('if (buildRawText !== null)', 'if (getRaw() !== null)')}; return shareShownQuestions;`)(() => shown, (text) => copies.push(text), (text) => messages.push(text), shownEditorInstructions, editorQuestionsMarkdown,
    { createObjectURL: (blob) => { downloads.push({ blob }); return "blob:test"; }, revokeObjectURL() {} }, Blob,
    (tag, attrs) => ({ click: () => Object.assign(downloads.at(-1), attrs) }), (fn) => fn(), () => raw);
  share("instructions"); share("markdown");
  assert.equal(copies[0], rows[0].instructions);
  assert.equal(downloads[0].download, "jev-questions.md");
  assert.equal(await downloads[0].blob.text(), editorQuestionsMarkdown(rows));
  assert.equal(downloads[0].blob.type, "text/markdown;charset=utf-8");
  raw = "pending"; share("instructions"); share("markdown");
  assert.equal(copies.length, 1); assert.equal(downloads.length, 1); assert.match(messages.at(-1), /Raw JSON/);
  raw = null; shown = []; share("instructions"); share("markdown");
  assert.equal(copies.length, 1); assert.equal(downloads.length, 1); assert.match(messages.at(-1), /No questions/);
});
