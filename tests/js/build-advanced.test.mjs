import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { editorAuthoringFacts, matchesAdvancedEditorQuestion, editorAuthoringSummary, editorOutlineCsv, shownQuestionIndex } from "../../static/js/build-authoring.js";
import { matchesEditorQuestion, reorderEditorCriteria, editorQuestionOutline, shownEditorInstructions, editorQuestionsMarkdown } from "../../static/js/build-editing.js";
import { editorQuestionError } from "../../static/js/build-request.js";

const source = readFileSync(new URL("../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const question = (id = "route", type = "choice") => ({ id, type, instructions: "First line\nSecond `photo`", choice: [["b", "Zulu"], ["a", "Alpha"]], score: ["Low", "High"], noulYes: "Yes", noulNo: "No" });
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((value) => value != null), events: {}, addEventListener(name, fn) { this.events[name] = fn; } });
const descendants = (node) => [node, ...(node?.children || []).flatMap((child) => typeof child === "object" ? descendants(child) : [])];

test("advanced ID and line bounds combine with existing search while preserving all authored data", () => {
  const row = question("  Shield.route😀  "), rows = [row], before = JSON.stringify(rows);
  assert.equal(matchesEditorQuestion(row, { idSuffix: "ROUTE😀", idExact: "shield.route😀", minIdCharacters: 13, maxIdCharacters: 13, minInstructionLines: 2, maxInstructionLines: 2, query: "photo", allRows: rows }), true);
  for (const filter of [{ idSuffix: "wrong" }, { idExact: "shield" }, { minIdCharacters: 14 }, { maxIdCharacters: 12 }, { minInstructionLines: 3 }, { maxInstructionLines: 1 }]) {
    assert.equal(matchesEditorQuestion(row, filter), false);
  }
  for (const field of ["minIdCharacters", "maxIdCharacters", "minInstructionLines", "maxInstructionLines"]) {
    for (const value of ["-1", "1.2", "Infinity", "NaN"]) assert.equal(matchesEditorQuestion(row, { [field]: value }), false);
  }
  assert.equal(matchesEditorQuestion({ ...row, instructions: "" }, { maxInstructionLines: "0" }), true);
  assert.equal(editorAuthoringFacts({ ...row, instructions: "a\r\nb\rc\n" }).instructionLines, 4);
  assert.equal(JSON.stringify(rows), before);
});

test("structured and backtick filters inspect authored instructions without treating scalar JSON as structured", () => {
  for (const text of ['{"task":"route"}', '["route"]']) {
    assert.equal(matchesAdvancedEditorQuestion({ ...question(), instructions: text }, { instructionFormat: "structured" }), true);
    assert.equal(matchesAdvancedEditorQuestion({ ...question(), instructions: text }, { instructionFormat: "text" }), false);
  }
  for (const text of ["route", "null", '"route"', "4", "{"]) {
    assert.equal(matchesAdvancedEditorQuestion({ ...question(), instructions: text }, { instructionFormat: "text" }), true);
  }
  assert.equal(matchesEditorQuestion(question(), { references: "with" }), true);
  assert.equal(matchesEditorQuestion(question(), { references: "without" }), false);
  assert.equal(matchesEditorQuestion({ ...question(), instructions: "``" }, { references: "without" }), true);
});

test("problem filters find blank and unnamed criteria separately and use outbound key identities", () => {
  const row = question(); row.choice.push(["", ""], [" ", "Repair me"], [" a ", "Repeat"]);
  for (const field of ["placeholders", "unnamedChoice", "duplicateKeys"]) {
    assert.equal(matchesEditorQuestion(row, { [field]: "with" }), true);
    assert.equal(matchesEditorQuestion(row, { [field]: "without" }), false);
    assert.equal(matchesEditorQuestion(question(), { [field]: "without" }), true);
  }
  assert.equal(matchesEditorQuestion({ ...row, type: "box" }, { placeholders: "without", unnamedChoice: "without", duplicateKeys: "without" }), true);
  assert.equal(matchesEditorQuestion({ ...question(), type: "score", score: ["Low", " "] }, { placeholders: "with" }), true);
  const rows = [row, question(" route "), question("ROUTE")];
  assert.equal(matchesEditorQuestion(row, { duplicateIds: "with", allRows: rows }), true);
  assert.equal(matchesEditorQuestion(rows[2], { duplicateIds: "with", allRows: rows }), false);
  assert.equal(matchesEditorQuestion(question(""), { duplicateIds: "with", allRows: [question(""), question("")] }), false);
});

test("Choice-key and description searches exclude inactive fields and honor exclusions", () => {
  const row = question();
  assert.equal(matchesEditorQuestion(row, { searchField: "choiceKeys", query: "b" }), true);
  assert.equal(matchesEditorQuestion(row, { searchField: "choiceKeys", query: "Zulu" }), false);
  assert.equal(matchesEditorQuestion(row, { searchField: "descriptions", query: "Zulu", exclude: "Alpha" }), false);
  assert.equal(matchesEditorQuestion(row, { searchField: "descriptions", query: "Zulu" }), true);
  assert.equal(matchesEditorQuestion(question("rating", "score"), { searchField: "descriptions", query: "Low" }), true);
  assert.equal(matchesEditorQuestion(question("check", "noul"), { searchField: "descriptions", query: "Yes" }), true);
  assert.equal(matchesEditorQuestion(question("box", "box"), { searchField: "descriptions", query: "Zulu" }), false);
});

test("shown navigation follows request order and never crosses a hidden row or wraps unexpectedly", () => {
  const rows = [question("a"), question("b"), question("c"), question("d")], shown = [rows[3], rows[1]];
  assert.equal(shownQuestionIndex(rows, shown, -1, "first"), 1);
  assert.equal(shownQuestionIndex(rows, shown, -1, "last"), 3);
  assert.equal(shownQuestionIndex(rows, shown, 1, "next"), 3);
  assert.equal(shownQuestionIndex(rows, shown, 3, "previous"), 1);
  assert.equal(shownQuestionIndex(rows, shown, 3, "next"), -1);
  assert.equal(shownQuestionIndex(rows, shown, 1, "previous"), -1);
  for (const direction of ["first", "last", "next", "previous"]) assert.equal(shownQuestionIndex(rows, [], 0, direction), -1);
});

test("shown authoring totals count UTF-8 active fields only and contain no answers, state or labels", () => {
  const rows = [question("😀"), question("n", "noul"), question("s", "score"), question("x", "box")];
  const expected = rows.map((row) => [row.id, row.instructions, ...(row.type === "choice" ? row.choice.flat() : row.type === "score" ? row.score : row.type === "noul" ? [row.noulYes, row.noulNo] : [])].join("")).join("");
  rows[0].answers = "secret answer"; rows[0].state = "secret input"; rows[0].expect = "secret labels";
  assert.deepEqual(editorAuthoringSummary(rows), { counts: { noul: 1, choice: 1, score: 1, box: 1 }, bytes: new TextEncoder().encode(expected).length });
  assert.equal(editorAuthoringSummary([]).bytes, 0);
});

test("outline CSV protects spreadsheet formulas and contains only count metadata", () => {
  const rows = [question('=SUM(1,2)\n"quoted"'), question("\t@formula"), question(" +calc")];
  rows[0].answers = "secret answer"; rows[0].expect = "secret labels"; rows[0].instructions = "private instructions";
  const csv = editorOutlineCsv(rows);
  assert.match(csv, /"'=SUM\(1,2\)\n""quoted"""/);
  assert.match(csv, /"'\t@formula"/); assert.match(csv, /"' \+calc"/);
  for (const value of ["secret answer", "secret labels", "private instructions", "Zulu"]) assert.ok(!csv.includes(value));
  assert.ok(csv.endsWith("\r\n"));
});

test("Choice description sorts are stable, keep pairs intact and leave Score ordinals unchanged", () => {
  const row = question(); row.choice.push(["c", "Alpha"]);
  assert.deepEqual(reorderEditorCriteria(row, "description").choice, [["a", "Alpha"], ["c", "Alpha"], ["b", "Zulu"]]);
  assert.deepEqual(reorderEditorCriteria(row, "description-desc").choice, [["b", "Zulu"], ["a", "Alpha"], ["c", "Alpha"]]);
  assert.deepEqual(row.choice, [["b", "Zulu"], ["a", "Alpha"], ["c", "Alpha"]]);
  const score = question("s", "score"); assert.equal(reorderEditorCriteria(score, "description"), score);
});

test("advanced toolbar wires every filter to presentation and keeps sharing and navigation explicit", () => {
  const W = { questions: [question()] }, view = {}, calls = [], shared = [];
  let refreshes = 0;
  const renderTools = new Function("h", "visibleBuildQuestions", "buildQuestionView", "refreshQuestionVisibility", "authoringSummaryText", "W", "shownQuestionIndex", "navigateBuildQuestion", "shareAuthoringQuestions", `${body("renderBuildAuthoringTools")}; return renderBuildAuthoringTools;`)(h, () => W.questions, view, () => refreshes++, () => "summary", W, shownQuestionIndex, (index) => calls.push(index), (format) => shared.push(format));
  const nodes = descendants(renderTools());
  for (const [label, field] of [["Build question id suffix", "idSuffix"], ["Exact Build question id", "idExact"], ["Minimum id characters", "minIdCharacters"], ["Maximum id characters", "maxIdCharacters"], ["Minimum instruction lines", "minInstructionLines"], ["Maximum instruction lines", "maxInstructionLines"]]) {
    nodes.find((node) => node.attrs?.["aria-label"] === label).attrs.oninput({ target: { value: "2" } }); assert.equal(view[field], "2");
  }
  for (const [label, field] of [["Instruction format", "instructionFormat"], ["Blank criterion placeholders", "placeholders"], ["Unnamed Choice descriptions", "unnamedChoice"], ["Repeated Choice keys", "duplicateKeys"], ["Repeated question ids", "duplicateIds"], ["Backticked references", "references"]]) {
    nodes.find((node) => node.attrs?.["aria-label"] === label).attrs.onchange({ target: { value: "with" } }); assert.equal(view[field], "with");
  }
  assert.equal(refreshes, 12);
  for (const id of ["build-first-shown", "build-last-shown", "build-copy-outline", "build-outline-csv", "build-instructions-text", "build-copy-markdown"]) nodes.find((node) => node.attrs?.id === id).attrs.onclick();
  assert.deepEqual(calls, [0, 0]); assert.deepEqual(shared, ["outline-copy", "outline-csv", "instructions-text", "markdown-copy"]);
  nodes[0].attrs.ontoggle({ target: { open: true } }); assert.equal(view.toolsOpen, true);
});

test("new handoffs share only the chosen authored questions and block unapplied Raw JSON", async () => {
  const rows = [question("first"), question("hidden")], copies = [], downloads = [], messages = [];
  let raw = null, shown = [rows[0]];
  const W = { questions: rows, expect: "secret labels", result: "secret answers", stateText: "secret inputs" };
  const share = new Function("W", "visibleBuildQuestions", "copyText", "toast", "editorQuestionOutline", "editorQuestionsMarkdown", "shownEditorInstructions", "editorOutlineCsv", "questionEditorError", "toQuestions", "URL", "Blob", "h", "setTimeout", "getRaw", `${body("shareAuthoringQuestions").replace('if (buildRawText !== null)', 'if (getRaw() !== null)')}; return shareAuthoringQuestions;`)(W, () => shown, (text) => copies.push(text), (text) => messages.push(text), editorQuestionOutline, editorQuestionsMarkdown, shownEditorInstructions, editorOutlineCsv, editorQuestionError, (questions) => Object.fromEntries(questions.map((row) => [row.id, { type: row.type, instructions: row.instructions, criteria: Object.fromEntries(row.choice) }])),
    { createObjectURL: (blob) => { downloads.push({ blob }); return "blob:test"; }, revokeObjectURL() {} }, Blob,
    (tag, attrs) => ({ click: () => Object.assign(downloads.at(-1), attrs) }), (fn) => fn(), () => raw);
  share("outline-copy"); share("markdown-copy"); share("outline-csv"); share("instructions-text"); share("question-json", 1);
  assert.equal(copies[0], editorQuestionOutline([rows[0]])); assert.equal(copies[1], editorQuestionsMarkdown([rows[0]]));
  assert.equal(downloads[0].download, "jev-question-outline.csv"); assert.equal(downloads[1].download, "jev-instructions.txt");
  assert.equal(await downloads[1].blob.text(), rows[0].instructions);
  assert.deepEqual(Object.keys(JSON.parse(await downloads[2].blob.text())), ["hidden"]);
  for (const download of downloads) for (const secret of ["secret inputs", "secret labels", "secret answers"]) assert.ok(!(await download.blob.text()).includes(secret));
  raw = "pending";
  for (const format of ["outline-copy", "markdown-copy", "outline-csv", "instructions-text", "question-json"]) share(format);
  assert.equal(copies.length, 2); assert.equal(downloads.length, 3); assert.match(messages.at(-1), /Raw JSON/);
  raw = null; shown = []; share("outline-copy"); assert.match(messages.at(-1), /No questions/);
});

test("focus-instructions action expands only the destination and focuses without a model call or edit", () => {
  const rows = [question("first"), question("second")], collapsed = new WeakSet(rows), actions = [];
  const focus = new Function("W", "buildEditState", "render", "$", `${body("navigateBuildQuestion")}; return navigateBuildQuestion;`)({ questions: rows }, () => ({ collapsed }), () => actions.push("render"), (selector) => {
    assert.equal(selector, '.build-question-card[data-question-index="1"]');
    return { scrollIntoView: () => actions.push("scroll"), querySelector: (tag) => ({ focus: () => actions.push(tag) }) };
  });
  focus(1, true); assert.equal(collapsed.has(rows[0]), true); assert.equal(collapsed.has(rows[1]), false); assert.deepEqual(actions, ["render", "scroll", "textarea"]);
  focus(-1); assert.equal(actions.length, 3);
});

test("single-question sharing and navigation controls use the current card and guard raw edits", () => {
  const rows = [question("first"), question("second")], W = { questions: rows }, copies = [], shared = [], moves = [], messages = [];
  let raw = null;
  const renderCard = new Function("W", "h", "buildEditState", "TYPES", "icon", "editorMoveButtons", "copyText", "toast", "shareAuthoringQuestions", "navigateBuildQuestion", "shownQuestionIndex", "visibleBuildQuestions", "getRaw", `${body("renderQuestionCard").replaceAll('buildRawText !== null', 'getRaw() !== null')}; return renderQuestionCard;`)(W, h, () => ({ collapsed: new WeakSet() }), ["choice"], () => null, () => [], (text) => copies.push(text), (text) => messages.push(text), (...args) => shared.push(args), (...args) => moves.push(args), shownQuestionIndex, () => rows, () => raw);
  const nodes = descendants(renderCard(rows[1], 1));
  const click = (label) => nodes.find((node) => node.children?.includes(label)).attrs.onclick();
  click("Copy id"); click("Copy question Markdown"); click("Download question JSON"); click("Previous shown question"); click("Focus instructions"); click("Next shown question");
  assert.deepEqual(copies, ["second"]); assert.deepEqual(shared, [["markdown-copy", 1], ["question-json", 1]]);
  assert.deepEqual(moves, [[0], [1, true]]); assert.match(messages[0], /No next/);
  raw = "pending"; click("Copy id"); assert.equal(copies.length, 1); assert.match(messages.at(-1), /Raw JSON/);
});
