import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  editorQuestionError, parseUniqueJson, requestDraft, parseRequestDraft, buildEditorContext, buildContextChanged,
} from "../../static/js/build-request.js";

const source = readFileSync(new URL("../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name, async = false) => source.match(new RegExp(`${async ? "async " : ""}function ${name}\\([^]*?\\n\\}`))[0];
const toQuestions = new Function("editorQuestionError", "parseMaybeJson", `${body("toQuestions")}; return toQuestions;`)(editorQuestionError, (v) => v);
const choice = (id = "department", keys = ["billing", "shipping"]) => ({
  id, type: "choice", instructions: "Which department?", choice: keys.map((k) => [k, ""]),
});

test("Raw JSON and draft parsing rejects repeated keys before JSON.parse can discard them", () => {
  assert.throws(() => parseUniqueJson('{"q": 1, "q": 2}'), /repeats key/);
  assert.throws(() => parseUniqueJson('{"q": {"criteria": {"a": "one", "\\u0061": "two"}}}'), /repeats key/);
  assert.deepEqual(parseUniqueJson('{"a": [{"same": 1}, {"same": 2}], "b": "comma, brace}"}'),
    { a: [{ same: 1 }, { same: 2 }], b: "comma, brace}" });
});

test("duplicate ids and option keys are rejected before serialization, including trim collisions", () => {
  for (const rows of [[choice("q"), choice(" q ")], [choice("q", ["one", " one "])]]) {
    assert.match(editorQuestionError(rows), /repeat/);
    assert.equal(Object.keys(toQuestions(rows)).length, 0);
  }
  const rows = [choice("__proto__", ["__proto__", "constructor"])];
  const questions = toQuestions(rows);
  assert.equal(Object.hasOwn(questions, "__proto__"), true);
  assert.deepEqual(Object.keys(questions.__proto__.criteria), ["__proto__", "constructor"]);
  assert.equal(JSON.parse(JSON.stringify(questions)).__proto__.type, "choice");
});

test("draft round trips inputs and ordered questions/images without result or settings fields", () => {
  const questions = toQuestions([choice()]);
  const images = { "photo-123": { format: "png", data_base64: "YWJj" }, "photo-456": { sample: "torn-bag" } };
  const draft = requestDraft({ text: "A parcel", photo: "photo-123" }, questions, images);
  const restored = parseRequestDraft(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(Object.keys(restored.questions.department.criteria), ["billing", "shipping"]);
  assert.deepEqual(restored.images, images);
  assert.deepEqual(Object.keys(draft), ["format", "version", "state", "questions", "images"]);
  assert.throws(() => parseRequestDraft({ ...draft, answers: {} }), /only state/);
  assert.throws(() => parseRequestDraft({ ...draft, version: 2 }), /version 1/);
  assert.throws(() => parseRequestDraft({ ...draft, questions: [] }), /question map/);
});

test("stale request snapshots include state, question wording/order and exact image bytes", () => {
  const images = { photo: { data_base64: "YWJj" } };
  const rows = [choice()];
  const original = buildEditorContext("input", rows, images);
  assert.equal(buildContextChanged(original, null), false);
  assert.equal(buildContextChanged(original, original), false);
  assert.equal(buildContextChanged(buildEditorContext("changed", rows, images), original), true);
  assert.equal(buildContextChanged(buildEditorContext("input", [choice("department", ["shipping", "billing"])], images), original), true);
  assert.equal(buildContextChanged(buildEditorContext("input", rows, { photo: { data_base64: "ZGVm" } }), original), true);
});

test("editing updates the stale warning and save guard without replacing the focused editor", () => {
  const nodes = { "#build-stale": { style: {} }, "#build-validation": {}, "#build-save-test": {} };
  const W = { result: {}, exported: {}, lint: {} };
  let stale = true;
  const edit = new Function("W", "$", "buildResultStale", "questionEditorError", `${body("markBuildEdited")}; return markBuildEdited;`)(
    W, (selector) => nodes[selector], () => stale, () => "duplicate id");
  edit();
  assert.equal(nodes["#build-stale"].style.display, "");
  assert.equal(nodes["#build-save-test"].disabled, true);
  assert.equal(nodes["#build-validation"].textContent, "duplicate id");
  assert.equal(W.lint, null);
  stale = false;
  edit();
  assert.equal(nodes["#build-stale"].style.display, "none");
  assert.equal(nodes["#build-save-test"].disabled, false);
});

test("a request edited while Run is in flight retains the original context for the stale warning", async () => {
  const W = { stateText: "original", questions: [choice()], images: [], saveOpen: true };
  let complete;
  const api = () => new Promise((resolve) => { complete = resolve; });
  const context = () => buildEditorContext(W.stateText, W.questions, {});
  const harness = new Function("W", "api", "validBuildQuestions", "buildContext", "parseState", "imagesPayload", "render", "handleError", `
    let buildRunning = false, buildRunSequence = 0, buildRunContext = null;
    ${body("run", true)};
    return { run, resultContext: () => buildRunContext, replace: () => ++buildRunSequence };
  `)(W, api, () => toQuestions(W.questions), context, (v) => v, () => ({}), () => {}, (e) => { throw e; });
  const original = context();
  const pending = harness.run();
  W.stateText = "edited while waiting";
  complete({ answers: {}, trace: { request: {} } });
  await pending;
  assert.equal(harness.resultContext(), original);
  assert.equal(buildContextChanged(context(), harness.resultContext()), true);
  assert.equal(W.saveOpen, false);

  const next = harness.run();
  harness.replace(); // Loading another request invalidates the in-flight completion.
  W.result = null;
  complete({ answers: { old: {} } });
  await next;
  assert.equal(W.result, null);
});

test("canceling replacement leaves the entire editor untouched", () => {
  const W = { stateText: "current", questions: [choice()], images: [], result: { answers: {} } };
  const before = JSON.stringify(W);
  const load = new Function("W", "buildUnsaved", "window", `${body("loadInto")}; return loadInto;`)(W, () => true, { confirm: () => false });
  assert.equal(load("new", {}), false);
  assert.equal(JSON.stringify(W), before);
});

test("draft preview is validated without modifying the editor and rejects a changed editor snapshot", async () => {
  const draft = requestDraft("input", { q: { type: "noul", instructions: "Urgent?" } });
  const calls = [];
  let context = "original";
  let validation;
  const api = async (path, payload) => {
    calls.push([path, payload]);
    await new Promise((resolve) => { validation = resolve; });
  };
  const harness = new Function("parseRequestDraft", "parseUniqueJson", "questionEditorError", "fromQuestions", "api", "buildContext", "render", "handleError", "toast", `
    let buildDraftBusy = false, buildDraftPreview = null;
    ${body("previewBuildDraft", true)};
    return { previewBuildDraft, preview: () => buildDraftPreview };
  `)(parseRequestDraft, parseUniqueJson, () => null, (v) => v, api, () => context, () => {}, (e) => { throw e; }, () => {});
  const pending = harness.previewBuildDraft({ size: 100, text: async () => JSON.stringify(draft) });
  await new Promise((resolve) => setImmediate(resolve));
  context = "changed";
  validation();
  await pending;
  assert.equal(harness.preview(), null);
  assert.equal(calls[0][0], "/api/workbench/draft/validate");
});


test("shared question replacement clears hidden Raw edits and invalidates pending Build runs", () => {
  const W = { stateText: "keep input", questions: [choice()], images: [], raw: false, result: {} };
  const harness = new Function("W", "buildUnsaved", "window", "fromQuestions", "imagesFromSpecs", "buildContext", "render",
    "parseState", "imagesPayload", `let buildRawText = "unapplied raw edits", buildRunSequence = 1, buildRunning = true,
    buildRunContext = "old", buildDraftPreview = {}, buildBaseline = null;
    ${body("loadInto")}; ${body("applyBuildQuestions")};
    return { applyBuildQuestions, raw: () => buildRawText, sequence: () => buildRunSequence, running: () => buildRunning };`)(
    W, () => true, { confirm: () => true, scrollTo: () => {} }, (q) => q, () => [], () => "new context", () => {}, (v) => v, () => ({}));
  assert.equal(harness.applyBuildQuestions({ urgent: { type: "noul", instructions: "Urgent?" } }), true);
  assert.equal(harness.raw(), null);
  assert.equal(harness.sequence(), 2);
  assert.equal(harness.running(), false);
  assert.equal(W.stateText, "keep input");
});

test("duplicate editor keys cannot seed an empty Raw JSON view that erases questions", () => {
  for (const questions of [[choice("q"), choice("q")], [choice("q", ["same", "same"])]]) {
    const W = { questions, raw: true };
    const original = JSON.stringify(questions);
    const h = (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity) });
    const raw = new Function("W", "h", "questionEditorError", "render", "toQuestions",
      `let buildRawText = null; ${body("renderRaw")}; return renderRaw;`)(W, h,
      () => editorQuestionError(W.questions), () => {}, () => assert.fail("duplicates cannot be serialized"));
    const view = raw();
    const children = view.children;
    assert.equal(children.some((node) => node.tag === "textarea"), false);
    assert.match(children[0].children[0], /Fix the editor errors/);
    children.find((node) => node.tag === "button").attrs.onclick();
    assert.equal(W.raw, false);
    assert.equal(JSON.stringify(W.questions), original);
  }
});

test("portable image drafts parse multi-megabyte base64 strings without regex stack overflow", () => {
  const data_base64 = "A".repeat(8 * 1024 * 1024);
  const draft = requestDraft({ photo: "image" }, { q: { type: "noul", instructions: "In `photo`?" } },
    { image: { format: "png", data_base64 } });
  assert.equal(parseUniqueJson(JSON.stringify(draft)).images.image.data_base64, data_base64);
});

test("key scanning skips escaped quotes, slashes, punctuation and long string values", () => {
  const state = { 'quoted"key': ["\\\"[{},:]", { nested: "!".repeat(100000) }], "comma,key": true };
  assert.deepEqual(parseUniqueJson(JSON.stringify(state)), state);
  const text = JSON.stringify({ a: "!".repeat(100000) });
  assert.throws(() => parseUniqueJson(text.slice(0, -1) + ',"a":null}'), /repeats key/);
  assert.throws(() => parseUniqueJson('"' + "!".repeat(100000)), SyntaxError);
});
