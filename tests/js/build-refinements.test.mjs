import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildRefinementFacts, matchesBuildRefinements, refinementFlags, cleanupActions, prepareBuildCleanup,
  applyBuildCleanup, undoBuildCleanup, buildDiagnosticsMetadata, renderBuildRefinements } from "../../static/js/build-refinements.js";
import { matchesEditorQuestion } from "../../static/js/build-editing.js";

const row = (id = "route", type = "choice") => ({ id, type, instructions: "Choose the best route.",
  choice: [["one", " First "], ["two", "Second"]], score: [" Low ", "High"], noulYes: " Yes ", noulNo: "No" });
const source = readFileSync(new URL("../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((value) => value != null) });
const nodes = (node) => [node, ...(node?.children || []).flatMap((child) => typeof child === "object" ? nodes(child) : [])];

test("word and criterion bounds compose with existing filters and use Unicode characters", () => {
  const question = { ...row(), instructions: " one\t two\n😀 ", choice: [["x", "😀a"], ["y", "é"]] };
  assert.equal(buildRefinementFacts(question).instructionWords, 3);
  assert.equal(buildRefinementFacts(question).criterionCharacters, 3);
  assert.equal(matchesEditorQuestion(question, { type: "choice", query: "😀", minInstructionWords: "3", maxInstructionWords: "3", minCriterionCharacters: "3", maxCriterionCharacters: "3" }), true);
  for (const filters of [{ minInstructionWords: 4 }, { maxInstructionWords: 2 }, { minCriterionCharacters: 4 }, { maxCriterionCharacters: 2 }, { query: "absent" }]) {
    assert.equal(matchesEditorQuestion(question, filters), false);
  }
  for (const field of ["minInstructionWords", "maxInstructionWords", "minCriterionCharacters", "maxCriterionCharacters"]) {
    for (const value of [-1, 1.2, "oops", "Infinity"]) assert.equal(matchesBuildRefinements(question, { [field]: value }), false);
  }
  assert.equal(matchesBuildRefinements({ ...row(), instructions: "", choice: [] }, { maxInstructionWords: "0", maxCriterionCharacters: "0" }), true);
});

test("eleven diagnostics separate authored issues and ignore inactive fields", () => {
  const examples = {
    missingDescriptions: { ...row(), choice: [["yes", " "]] },
    repeatedDescriptions: { ...row(), choice: [["a", "Same"], ["b", " Same "]] },
    idWhitespace: row(" route "), instructionWhitespace: { ...row(), instructions: " text " },
    keyWhitespace: { ...row(), choice: [[" key ", "value"]] },
    criterionWhitespace: row(), multilineCriteria: { ...row(), choice: [["a", "First\r\nsecond"]] },
    nonAsciiId: row("路由"), controlCharacters: { ...row(), instructions: "hello\u0000world" },
    todoMarkers: { ...row(), instructions: "Review FIXME before using" }, blankInstructions: { ...row(), instructions: " \t\n" },
  };
  for (const [field] of refinementFlags) {
    assert.equal(matchesBuildRefinements(examples[field], { [field]: "with" }), true, field);
    assert.equal(matchesBuildRefinements(examples[field], { [field]: "without" }), false, field);
  }
  const box = { ...row("box", "box"), choice: [[" TODO ", "\u0000\n "]], score: [" FIXME "] };
  for (const field of ["keyWhitespace", "criterionWhitespace", "todoMarkers", "controlCharacters", "multilineCriteria"]) {
    assert.equal(matchesBuildRefinements(box, { [field]: "without" }), true, field);
  }
  assert.equal(buildRefinementFacts(box).criterionCharacters, 0);
  assert.equal(matchesBuildRefinements({ ...row(), instructions: "" }, { blankInstructions: "with" }), false);
  assert.equal(matchesBuildRefinements({ ...row(), choice: [["", ""], ["key", "value"]] }, { missingDescriptions: "with" }), false);
  assert.equal(matchesBuildRefinements({ ...row(), choice: [["a", "Same"], ["b", "same"]] }, { repeatedDescriptions: "with" }), false);
});

test("cleanup preview changes only shown questions and leaves every source and expectation untouched", () => {
  const rows = [row(" route "), row("hidden")], expect = { route: { choice: "one" } }, before = JSON.stringify([rows, expect]);
  const preview = prepareBuildCleanup(rows, expect, [rows[0]], "ids");
  assert.deepEqual(preview.changes, [{ position: 1, id: " route ", type: "choice" }]);
  assert.equal(preview.rows[0].id, "route");
  assert.deepEqual(preview.rows[1], rows[1]);
  assert.equal(JSON.stringify([rows, expect]), before);
  preview.rows[1].choice[0][1] = "independent";
  assert.equal(rows[1].choice[0][1], " First ");
});

test("all six cleanup types preserve Choice associations, Score order and inactive fields", () => {
  const original = { ...row(" id "), instructions: " First\r\nsecond\rthird ", choice: [[" first ", " Alpha\r\nBeta "], ["last", " Omega "]] };
  for (const [action] of cleanupActions) {
    const result = prepareBuildCleanup([original], {}, [original], action).rows[0];
    if (action === "ids") assert.equal(result.id, "id");
    else assert.equal(result.id, original.id);
    if (action === "instructions") assert.equal(result.instructions, "First\r\nsecond\rthird");
    if (action === "instruction-newlines") assert.equal(result.instructions, " First\nsecond\nthird ");
    if (action === "keys") assert.deepEqual(result.choice, [["first", " Alpha\r\nBeta "], ["last", " Omega "]]);
    if (action === "criteria") assert.deepEqual(result.choice, [[" first ", "Alpha\r\nBeta"], ["last", "Omega"]]);
    if (action === "criterion-newlines") assert.deepEqual(result.choice, [[" first ", " Alpha\nBeta "], ["last", " Omega "]]);
    assert.deepEqual(result.score, original.score);
    assert.equal(result.noulYes, original.noulYes);
  }
  const score = row("s", "score"), noul = row("n", "noul");
  assert.deepEqual(prepareBuildCleanup([score], {}, [score], "criteria").rows[0].score, ["Low", "High"]);
  assert.equal(prepareBuildCleanup([noul], {}, [noul], "criteria").rows[0].noulYes, "Yes");
});

test("cleanup refuses collisions and an empty shown set rather than cleaning everything", () => {
  const a = row(" id "), b = row("id");
  assert.throws(() => prepareBuildCleanup([a, b], {}, [a], "ids"), /repeated/);
  const choice = { ...row(), choice: [[" a ", "first"], ["a", "second"]] };
  assert.throws(() => prepareBuildCleanup([choice], {}, [choice], "keys"), /repeats option/);
  assert.throws(() => prepareBuildCleanup([a], {}, [], "ids"), /No questions/);
  assert.throws(() => prepareBuildCleanup([a], {}, [a], "unknown"), /Choose a cleanup/);
});

test("apply and undo require the exact original questions and expectation snapshots", () => {
  const rows = [row(" route "), row("hidden")], expect = { route: { choice: "one" } };
  const preview = prepareBuildCleanup(rows, expect, [rows[0]], "ids");
  const result = applyBuildCleanup(rows, expect, preview);
  assert.equal(result.rows[0].id, "route"); assert.equal(result.rows[1], rows[1]);
  assert.deepEqual(expect, { route: { choice: "one" } });
  const restored = undoBuildCleanup(result.rows, expect, result.undo);
  assert.deepEqual(restored, rows); assert.equal(restored[1], rows[1]);
  assert.throws(() => applyBuildCleanup([...rows].reverse(), expect, preview), /changed/);
  assert.throws(() => applyBuildCleanup(rows, { route: { choice: "two" } }, preview), /changed/);
  assert.throws(() => undoBuildCleanup(result.rows, {}, result.undo), /changed/);
  result.rows[0].instructions += " edited";
  assert.throws(() => undoBuildCleanup(result.rows, expect, result.undo), /newer edits/);
});

test("diagnostic JSON allowlist excludes authored wording, expectation values, inputs and model data", () => {
  const question = { ...row(), instructions: "private instructions", choice: [["private option", "private criterion"]],
    expect: "secret labels", answers: "secret answers", state: "secret state", apiKey: "secret key" };
  const metadata = buildDiagnosticsMetadata([question]);
  assert.deepEqual(Object.keys(metadata[0]), ["position", "id", "type", "instructionWords", "criterionCharacters", ...refinementFlags.map(([field]) => field)]);
  assert.equal(metadata[0].position, 1); assert.equal(metadata[0].id, "route");
  for (const secret of ["private instructions", "private option", "private criterion", "secret labels", "secret answers", "secret state", "secret key"]) {
    assert.ok(!JSON.stringify(metadata).includes(secret));
  }
});

test("diagnostic controls update only presentation; preview, apply, undo and download stay explicit", () => {
  const view = {}, calls = []; let refreshes = 0;
  const tree = renderBuildRefinements(h, { view, refresh: () => refreshes++, shown: [row()], preview: null, undo: {},
    onPreview: () => calls.push("preview"), onApply: () => calls.push("apply"), onUndo: () => calls.push("undo"),
    onCancel: () => calls.push("cancel"), onDownload: () => calls.push("download") });
  const all = nodes(tree);
  for (const [field, label] of [["minInstructionWords", "Minimum instruction words"], ["maxInstructionWords", "Maximum instruction words"],
    ["minCriterionCharacters", "Minimum criterion characters"], ["maxCriterionCharacters", "Maximum criterion characters"]]) {
    all.find((node) => node.attrs?.["aria-label"] === label).attrs.oninput({ target: { value: "3" } });
    assert.equal(view[field], "3");
  }
  for (const [field, label] of refinementFlags) {
    all.find((node) => node.attrs?.["aria-label"] === label).attrs.onchange({ target: { value: "with" } });
    assert.equal(view[field], "with");
  }
  assert.equal(refreshes, 15); assert.deepEqual(calls, []);
  all.find((node) => node.attrs?.["aria-label"] === "Question cleanup action").attrs.onchange({ target: { value: "criteria" } });
  assert.equal(view.cleanupAction, "criteria");
  for (const label of ["Preview shown cleanup", "Undo last cleanup", "Download shown diagnostics"]) all.find((node) => node.children?.includes(label)).attrs.onclick();
  assert.deepEqual(calls, ["preview", "undo", "download"]);
  tree.attrs.ontoggle({ target: { open: true } }); assert.equal(view.refinementsOpen, true);
});

test("real cleanup coordinator guards Raw JSON, invalidates request products, and restores without changing expectations", async () => {
  const W = { questions: [row(" route ")], expect: { route: { choice: "one" } } }, messages = [], downloads = [];
  let raw = null, edits = 0, renders = 0;
  const coordinator = new Function("W", "getRaw", "toast", "visibleBuildQuestions", "buildQuestionView", "prepareBuildCleanup", "applyBuildCleanup", "undoBuildCleanup", "buildDiagnosticsMetadata", "markBuildEdited", "render", "URL", "Blob", "h", "setTimeout",
    `let buildCleanupPreview = null, buildCleanupUndo = null; ${body("cleanupBuildQuestions").replace("if (buildRawText !== null)", "if (getRaw() !== null)")}; return { run: cleanupBuildQuestions, preview: () => buildCleanupPreview };`)(
    W, () => raw, (message) => messages.push(message), () => W.questions, { cleanupAction: "ids" }, prepareBuildCleanup, applyBuildCleanup, undoBuildCleanup, buildDiagnosticsMetadata,
    () => edits++, () => renders++, { createObjectURL: (blob) => { downloads.push({ blob }); return "blob:test"; }, revokeObjectURL() {} }, Blob,
    (tag, attrs) => ({ click: () => Object.assign(downloads.at(-1), attrs) }), (fn) => fn());
  raw = "pending"; for (const action of ["preview", "apply", "undo", "download"]) coordinator.run(action);
  assert.equal(edits, 0); assert.equal(renders, 0); assert.equal(downloads.length, 0); assert.equal(messages.length, 4);
  raw = null; coordinator.run("preview"); assert.ok(coordinator.preview()); assert.equal(W.questions[0].id, " route ");
  coordinator.run("apply"); assert.equal(W.questions[0].id, "route"); assert.equal(edits, 1);
  coordinator.run("download"); assert.equal(downloads[0].download, "jev-question-diagnostics.json");
  assert.deepEqual(JSON.parse(await downloads[0].blob.text()), buildDiagnosticsMetadata(W.questions));
  coordinator.run("undo"); assert.equal(W.questions[0].id, " route "); assert.equal(edits, 2); assert.equal(renders, 3);
  assert.deepEqual(W.expect, { route: { choice: "one" } });
});
