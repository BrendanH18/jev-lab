import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  uniqueQuestionId, duplicateQuestionRow, moveEditorEntry, removeEditorQuestion, restoreEditorQuestion, buildRequestSummary,
} from "../../static/js/build-editing.js";
import {
  editorQuestionError, parseBuildState, formatBuildState, buildEditorContext,
} from "../../static/js/build-request.js";

const source = readFileSync(new URL("../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name, async = false) => source.match(new RegExp(`${async ? "async " : ""}function ${name}\\([^]*?\\n\\}`))[0];
const question = (id = "route", type = "choice") => ({ id, type, instructions: "Which department?",
  choice: [["billing", "Invoices"], ["shipping", "Deliveries"]], score: ["Low", "High"], noulYes: "", noulNo: "" });
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((v) => v != null),
  events: {}, addEventListener(name, fn) { this.events[name] = fn; } });
const descendants = (node) => [node, ...(node?.children || []).flatMap((child) => typeof child === "object" ? descendants(child) : [])];

test("duplicating a question picks a trim-safe unique id and copies independent criteria", () => {
  const row = question(), rows = [row, question("route_copy"), question(" route_copy_2 ")];
  const copy = duplicateQuestionRow(row, rows);
  assert.equal(copy.id, "route_copy_3");
  copy.choice[0][1] = "Changed";
  copy.score[0] = "Different";
  assert.equal(row.choice[0][1], "Invoices");
  assert.equal(row.score[0], "Low");
  assert.equal(uniqueQuestionId([question("noul_2"), question("noul_2_2")], "noul_2"), "noul_2_3");
});

test("question moves preserve ids and expectation association and respect list boundaries", () => {
  const rows = [question("a"), question("b"), question("c")], expect = { a: { min: 0 }, c: { max: 1 } };
  const moved = moveEditorEntry(rows, 1, -1);
  assert.deepEqual(moved.map((q) => q.id), ["b", "a", "c"]);
  assert.deepEqual(rows.map((q) => q.id), ["a", "b", "c"]);
  assert.equal(moved[1], rows[0]);
  assert.deepEqual(expect[moved[1].id], { min: 0 });
  assert.equal(moveEditorEntry(rows, 0, -1), rows);
  assert.equal(moveEditorEntry(rows, 2, 1), rows);
});

test("Choice moves keep descriptions with keys; Score moves change the explicit ordinal", () => {
  const row = question();
  row.choice = moveEditorEntry(row.choice, 1, -1);
  row.score = moveEditorEntry(row.score, 0, 1);
  const toQuestions = new Function("editorQuestionError", "parseMaybeJson", `${body("toQuestions")}; return toQuestions;`)(editorQuestionError, (v) => v);
  assert.deepEqual(Object.entries(toQuestions([row]).route.criteria), [["shipping", "Deliveries"], ["billing", "Invoices"]]);
  row.type = "score";
  assert.deepEqual(toQuestions([row]).route.criteria, ["High", "Low"]);
});

test("undo question deletion restores position and human expectations without changing other edits", () => {
  const rows = [question("a"), question("b"), question("c")], expect = { b: { choice: "billing" }, c: { min: 0 } };
  const removed = removeEditorQuestion(rows, expect, 1);
  assert.deepEqual(removed.rows.map((q) => q.id), ["a", "c"]);
  assert.deepEqual(removed.expect, { c: { min: 0 } });
  assert.deepEqual(expect.b, { choice: "billing" });
  removed.rows[0].instructions = "A newer edit";
  removed.expect.c.min = 0.2;
  const restored = restoreEditorQuestion(removed.rows, removed.expect, removed.undo);
  assert.deepEqual(restored.rows.map((q) => q.id), ["a", "b", "c"]);
  assert.equal(restored.rows[0].instructions, "A newer edit");
  assert.deepEqual(restored.expect, { b: { choice: "billing" }, c: { min: 0.2 } });
});

test("undo cannot overwrite a reused id or an expectation changed after deletion", () => {
  const removed = removeEditorQuestion([question("a")], { a: { min: 0 } }, 0);
  assert.throws(() => restoreEditorQuestion([question(" a ")], {}, removed.undo), /another question/);
  assert.throws(() => restoreEditorQuestion([], { a: { max: 1 } }, removed.undo), /expectations have changed/);
  const special = removeEditorQuestion([question("__proto__")], JSON.parse('{"__proto__":{"min":0}}'), 0);
  assert.equal(Object.hasOwn(restoreEditorQuestion([], {}, special.undo).expect, "__proto__"), true);
});

test("formatting preserves JSON values, leaves plain text alone and rejects malformed or duplicate JSON", () => {
  const input = '{"text":"é","picture":"photo-1","list":[1,false]}';
  const formatted = formatBuildState(input);
  assert.deepEqual(JSON.parse(formatted.text), JSON.parse(input));
  assert.match(formatted.text, /\n/);
  assert.deepEqual(formatBuildState(" plain input "), { text: " plain input ", message: "This state is plain text; formatting leaves it unchanged." });
  assert.throws(() => formatBuildState('{"a":1,'), SyntaxError);
  assert.throws(() => formatBuildState('{"a":1,"a":2}'), /repeats key/);
});

test("outbound state parsing rejects duplicate nested/escaped keys without taking away plain-text inputs", () => {
  assert.throws(() => parseBuildState('{"photo":"first","photo":"second"}'), /repeats key/);
  assert.throws(() => parseBuildState('[{"a":1,"\\u0061":2}]'), /repeats key/);
  assert.deepEqual(parseBuildState('{"text":"hello","list":[1,2]}'), { text: "hello", list: [1, 2] });
  assert.equal(parseBuildState("[Note] this is prose"), "[Note] this is prose");
  assert.equal(parseBuildState("  ordinary text  "), "  ordinary text  ");
});

test("duplicate state keys block each validated request before a paid or validation API call", async () => {
  const W = { stateText: '{"a":1,"a":2}', questions: [question()], images: [] }, messages = [];
  const harness = new Function("W", "parseState", "questionEditorError", "toQuestions", "toast", "api", `
    let buildRawText = null, buildRunning = false, buildDraftBusy = false;
    ${body("validBuildQuestions")}; ${body("run", true)}; ${body("downloadBuildDraft", true)};
    ${body("checkQuestions", true)}; ${body("exportCode", true)};
    return { run, downloadBuildDraft, checkQuestions, exportCode };
  `)(W, parseBuildState, () => null, () => ({}), (s) => messages.push(s), () => assert.fail("no API call"));
  for (const action of Object.values(harness)) await action();
  assert.equal(messages.length, 4);
  assert.ok(messages.every((s) => /State: JSON repeats key/.test(s)));
});

test("request summary counts UTF-8 editor bytes and question types without model data", () => {
  assert.equal(buildRequestSummary("é☕", [question(), question("urgent", "noul"), question("other")], 1),
    "3 questions (2 choice · 1 noul) · 5 state-text bytes · 1 image");
  assert.equal(buildRequestSummary("", [], 0), "0 questions · 0 state-text bytes · 0 images");
});

test("discarding Raw JSON requires confirmation and keeps the editor request unchanged", () => {
  const W = { raw: false, questions: [question()] }, original = JSON.stringify(W.questions);
  let accepted = false, edits = 0;
  const harness = new Function("W", "window", "markBuildEdited", "render", `
    let buildRawText = "unfinished edits";
    ${body("discardBuildRaw")}; return { discardBuildRaw, pending: () => buildRawText };
  `)(W, { confirm: () => accepted }, () => edits++, () => {});
  harness.discardBuildRaw();
  assert.equal(harness.pending(), "unfinished edits");
  assert.equal(edits, 0);
  accepted = true;
  harness.discardBuildRaw();
  assert.equal(harness.pending(), null);
  assert.equal(edits, 1);
  assert.equal(JSON.stringify(W.questions), original);
});

test("typing in Raw JSON immediately enables Discard without an intervening render", () => {
  const W = { questions: [question()] };
  const raw = new Function("W", "h", "questionEditorError", "toQuestions", "discardBuildRaw", "markBuildEdited", `
    let buildRawText = null;
    ${body("renderRaw")}; return renderRaw;
  `)(W, h, () => null, () => ({}), () => {}, () => {});
  const view = raw();
  const area = descendants(view).find((node) => node.tag === "textarea");
  const discard = descendants(view).find((node) => node.tag === "button" && node.children.includes("Discard Raw edits"));
  assert.equal(discard.attrs.disabled, true);
  area.value = "unfinished JSON";
  area.events.input();
  assert.equal(discard.disabled, false);
});

test("collapsing a question changes presentation only and retains pending values", () => {
  const row = question("urgent", "noul"), W = { questions: [row], expect: {}, stateText: "input" };
  const state = { collapsed: new WeakSet() };
  let edited = 0;
  const renderQuestionCard = new Function("W", "h", "buildEditState", "TYPES", "markBuildEdited", "render", "icon", "editorMoveButtons", `
    ${body("renderQuestionCard")}; return renderQuestionCard;
  `)(W, h, () => state, ["noul", "choice", "score", "box"], () => edited++, () => {}, () => null, () => []);
  const context = buildEditorContext(W.stateText, W.questions, {});
  let view = renderQuestionCard(row, 0);
  descendants(view).find((node) => node.attrs?.["aria-label"] === "Collapse question urgent").attrs.onclick();
  assert.equal(edited, 0);
  assert.equal(buildEditorContext(W.stateText, W.questions, {}), context);
  view = renderQuestionCard(row, 0);
  assert.equal(descendants(view).some((node) => node.tag === "textarea"), false);
  descendants(view).find((node) => node.attrs?.["aria-label"] === "Expand question urgent").attrs.onclick();
  view = renderQuestionCard(row, 0);
  assert.equal(descendants(view).find((node) => node.tag === "textarea").children[0], row.instructions);
});

test("reordering through the real editor control invalidates stale request products", () => {
  let entries = ["first", "second"], edits = 0, renders = 0;
  const buttons = new Function("h", "moveEditorEntry", "markBuildEdited", "render", `${body("editorMoveButtons")}; return editorMoveButtons;`)(
    h, moveEditorEntry, () => edits++, () => renders++);
  const controls = buttons(entries, 0, "level 0", (next) => { entries = next; });
  assert.equal(controls[0].attrs.disabled, true);
  controls[1].attrs.onclick();
  assert.deepEqual(entries, ["second", "first"]);
  assert.equal(edits, 1);
  assert.equal(renders, 1);
});

test("question filters search ids, instructions and criteria without removing hidden requests", async () => {
  const { matchesEditorQuestion } = await import("../../static/js/build-editing.js");
  const rows = [question("route"), question("urgent", "noul")];
  const before = JSON.stringify(rows);
  assert.equal(matchesEditorQuestion(rows[0], { query: "  INVOICES " }), true);
  assert.equal(matchesEditorQuestion(rows[0], { query: "route", type: "noul" }), false);
  assert.equal(matchesEditorQuestion(rows[1], { type: "noul" }), true);
  assert.equal(matchesEditorQuestion(rows[1], { query: "missing" }), false);
  assert.equal(JSON.stringify(rows), before);
});

test("moving questions directly to either end preserves identity, criteria and expectations", async () => {
  const { moveEditorEntryTo } = await import("../../static/js/build-editing.js");
  const rows = [question("first"), question("middle"), question("last")];
  const expect = { middle: { choice: "billing" } };
  const first = moveEditorEntryTo(rows, 1, 0), last = moveEditorEntryTo(rows, 1, 2);
  assert.deepEqual(first.map((row) => row.id), ["middle", "first", "last"]);
  assert.deepEqual(last.map((row) => row.id), ["first", "last", "middle"]);
  assert.equal(first[0], rows[1]);
  assert.deepEqual(expect[first[0].id], { choice: "billing" });
  assert.equal(moveEditorEntryTo(rows, 0, 0), rows);
  assert.equal(moveEditorEntryTo(rows, 0, 3), rows);
});

test("question tools clear filters and collapse only shown cards without editing the request", async () => {
  const { matchesEditorQuestion } = await import("../../static/js/build-editing.js");
  const W = { questions: [question("route"), question("urgent", "noul")] };
  const view = { query: "", type: "noul" }, state = { collapsed: new WeakSet() };
  let renders = 0;
  const tools = new Function("W", "$", "buildQuestionView", "matchesEditorQuestion", "h", "TYPES", "buildEditState", "render", `
    ${body("visibleBuildQuestions")}; ${body("renderQuestionTools")}; return renderQuestionTools;
  `)(W, () => null, view, matchesEditorQuestion, h, ["noul", "choice", "score", "box"], () => state, () => renders++);
  const before = JSON.stringify(W);
  const nodes = descendants(tools());
  const button = (name) => nodes.find((node) => node.tag === "button" && node.children.includes(name));
  assert.match(nodes.find((node) => node.attrs?.id === "build-question-count").children[0], /^1 of 2/);
  button("Collapse shown").attrs.onclick();
  assert.equal(state.collapsed.has(W.questions[0]), false);
  assert.equal(state.collapsed.has(W.questions[1]), true);
  button("Expand shown").attrs.onclick();
  assert.equal(state.collapsed.has(W.questions[1]), false);
  button("Clear question filters").attrs.onclick();
  assert.deepEqual(view, { query: "", type: "all" });
  assert.equal(JSON.stringify(W), before);
  assert.equal(renders, 3);
});

test("compacting JSON preserves values and rejects duplicates while leaving prose alone", () => {
  const W = { stateText: '{ "text": "é", "arr": [1, false] }' }, messages = [];
  let edits = 0;
  const compact = new Function("W", "parseState", "toast", "markBuildEdited", "render", `${body("compactBuildStateText")}; return compactBuildStateText;`)(
    W, parseBuildState, (message) => messages.push(message), () => edits++, () => {});
  compact();
  assert.equal(W.stateText, '{"text":"é","arr":[1,false]}');
  assert.equal(edits, 1);
  W.stateText = ' { "large": 9007199254740993, "overflow": 1e400, "negativeZero": -0, "text": "a \\\" b \\\\ c" } ';
  compact();
  assert.equal(W.stateText, '{"large":9007199254740993,"overflow":1e400,"negativeZero":-0,"text":"a \\\" b \\\\ c"}');
  assert.equal(edits, 2);
  W.stateText = ' {"a":1,"a":2}';
  compact();
  assert.match(messages.at(-1), /repeats key/);
  assert.equal(edits, 2);
  W.stateText = " ordinary prose ";
  compact();
  assert.equal(W.stateText, " ordinary prose ");
  assert.equal(edits, 2);
});

test("copying one question exports only its request JSON", () => {
  const row = question(), W = { questions: [row], expect: { route: { choice: "billing" } }, result: { answers: { secret: true } } };
  let copied;
  const renderQuestionCard = new Function("W", "h", "buildEditState", "TYPES", "markBuildEdited", "render", "icon", "editorMoveButtons", "questionEditorError", "toQuestions", "copyText", `
    ${body("renderQuestionCard")}; return renderQuestionCard;
  `)(W, h, () => ({ collapsed: new WeakSet() }), ["choice"], () => assert.fail("copy must not edit"), () => {}, () => null, () => [],
    editorQuestionError, (rows) => ({ [rows[0].id]: { type: rows[0].type, instructions: rows[0].instructions } }), (text) => { copied = JSON.parse(text); });
  const view = renderQuestionCard(row, 0);
  descendants(view).find((node) => node.attrs?.["aria-label"] === "Copy question route JSON").attrs.onclick();
  assert.deepEqual(copied, { route: { type: "choice", instructions: "Which department?" } });
});

test("question edits refresh filter membership and count while retaining the focused card", async () => {
  const { matchesEditorQuestion } = await import("../../static/js/build-editing.js");
  const W = { questions: [question("route"), question("other")], expect: {}, images: [] };
  const cards = W.questions.map((_, i) => ({ dataset: { questionIndex: String(i) }, hidden: i !== 0 }));
  const count = {}, empty = {}, list = { querySelectorAll: () => cards };
  let focused = cards[0];
  const $ = (selector) => ({ ".qlist": list, "#build-question-count": count, "#build-question-no-match": empty,
    ".build-question-card:focus-within": focused })[selector];
  const harness = new Function("W", "$", "matchesEditorQuestion", `
    const buildQuestionView = { query: "route", type: "all" };
    ${body("visibleBuildQuestions")}; ${body("refreshQuestionVisibility")}; ${body("markBuildEdited")};
    return { edit: markBuildEdited, refresh: refreshQuestionVisibility, shown: visibleBuildQuestions };
  `)(W, $, matchesEditorQuestion);
  W.questions[0].id = "renamed";
  harness.edit();
  assert.equal(cards[0].hidden, false, "typing never hides its focused editor");
  assert.match(count.textContent, /^1 of 2/);
  assert.deepEqual(harness.shown(), [W.questions[0]], "collapse and count use the same membership");
  focused = null; // The focusout microtask uses this same refresh after focus moves.
  harness.refresh();
  assert.equal(cards[0].hidden, true);
  assert.match(count.textContent, /^0 of 2/);
  assert.equal(empty.hidden, false);
  W.questions[1].instructions = "route this request";
  harness.edit();
  assert.equal(cards[1].hidden, false);
  assert.match(count.textContent, /^1 of 2/);
  W.questions[1].instructions = "updated";
  W.questions[1].choice[0][1] = "route invoices";
  harness.edit();
  assert.equal(cards[1].hidden, false, "criteria participate in refreshed filtering too");
});

test("Copy JSON availability follows ID edits immediately and its click guard rejects blank IDs", () => {
  const row = question(""), W = { questions: [row] }, messages = [], copies = [];
  const renderQuestionCard = new Function("W", "h", "buildEditState", "TYPES", "markBuildEdited", "render", "icon", "editorMoveButtons", "questionEditorError", "toQuestions", "copyText", "toast", `
    ${body("renderQuestionCard")}; return renderQuestionCard;
  `)(W, h, () => ({ collapsed: new WeakSet() }), ["choice"], () => {}, () => {}, () => null, () => [],
    editorQuestionError, (rows) => ({ [rows[0].id]: { type: rows[0].type } }), (text) => copies.push(text), (message) => messages.push(message));
  const nodes = descendants(renderQuestionCard(row, 0));
  const id = nodes.find((node) => node.attrs?.["aria-label"] === "Question 1 id");
  const copy = nodes.find((node) => node.children?.includes("Copy JSON"));
  assert.equal(copy.attrs.disabled, true);
  id.value = "valid";
  id.events.input();
  assert.equal(copy.disabled, false);
  copy.attrs.onclick();
  assert.deepEqual(JSON.parse(copies[0]), { valid: { type: "choice" } });
  id.value = "   ";
  id.events.input();
  assert.equal(copy.disabled, true);
  copy.attrs.onclick(); // Also reject a stale/programmatic activation.
  assert.equal(copies.length, 1);
  assert.match(messages[0], /Give this question an id/);
});
