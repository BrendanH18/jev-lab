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
