// The Build tab's Lab surfaces (static/js/lab/surfaces/workbench-build.js) and their hooks in
// static/js/workbench-build.js: item shapes, shown() with page and Lab filters, data, every action's guard, and the
// page functions that apply Lab's filters, sort and reset (rebuilt from the page source, as the build-*.test.mjs do).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { definePack } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";
import { wbBuildQuestionsCtx, wbBuildResultCtx } from "../../../static/js/lab/surfaces/workbench-build.js";
import { matchesEditorQuestion } from "../../../static/js/build-editing.js";
import { buildExpect, buildOddResult, buildResult, buildRows, sampleBuildQuestionsCtx, sampleBuildResultCtx } from "./fixtures/workbench-build.mjs";

const QUESTIONS = "workbench.build.questions";
const RESULT = "workbench.build.result";
const source = readFileSync(new URL("../../../static/js/workbench-build.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const row = (id, type = "noul", extra = {}) => ({ id, type, instructions: `Is ${id} late?`, choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "", ...extra });

// A Lab with one numeric fact per surface, so filters and sorts can be set the way the Refine bar sets them.
const lab = () => createLab([
  definePack({ id: "test-question-facts", surface: QUESTIONS, title: "Question facts", features: [
    { id: "chars", kind: "fact", type: "number", label: "instruction characters", value: (item) => item.instructions.length },
    { id: "loop", kind: "fact", type: "number", label: "shown count", value: (item, ctx) => ctx.shown().length },
  ] }),
  definePack({ id: "test-answer-facts", surface: RESULT, title: "Answer facts", features: [
    { id: "conf", kind: "fact", type: "number", label: "confidence", value: (item) => item.confidence },
  ] }),
]);

// ---------- workbench.build.questions: items and data ----------

test("question items carry the documented fields, frozen, with active criteria and expectations", () => {
  const ctx = sampleBuildQuestionsCtx();
  const items = ctx.items();
  assert.equal(items.length, 7);
  assert.deepEqual(Object.keys(items[0]), ["ref", "id", "type", "instructions", "choice", "score", "noulYes", "noulNo", "expectation"],
    "stored fields only are enumerable");
  assert.deepEqual([items[0].position, items[0].qid, items[0].structured], [1, "intent", false], "facts are present on the items");
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(items[0]))), Object.keys(items[0]), "copies and snapshots leave the facts out");
  assert.deepEqual(items.map((item) => item.ref), ["q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
  assert.ok(items.every((item) => Object.isFrozen(item) && Object.isFrozen(item.criteria)));
  assert.deepEqual(items[0].criteria, [{ key: "refund", text: "Wants money back" }, { key: "where_is_order", text: "Asks where an order is" }, { key: "other", text: "" }]);
  assert.deepEqual(items[0].choice.at(-1), ["", ""], "blank placeholders stay in choice");
  assert.deepEqual(items[1].criteria.map((entry) => entry.key), ["0", "1", "2"], "a blank Score level is dropped before numbering");
  assert.deepEqual(items[2].criteria, [{ key: "true", text: "Uses angry or threatening words" }]);
  assert.deepEqual(items[3].criteria, []);
  assert.equal(items[4].id, " refund_amount_ok ");
  assert.equal(items[4].qid, "refund_amount_ok");
  assert.equal(items[4].structured, true);
  assert.equal(items[5].qid, "");
  assert.deepEqual(items.map((item) => item.expectation === null), [false, true, false, false, true, true, true]);
  assert.deepEqual(items.map((item, index) => ctx.itemName(item, index)), ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "question 6", "tone"]);
});

test("question items keep their identity until their row, position or expectation changes", () => {
  const ctx = sampleBuildQuestionsCtx();
  const [first, second] = ctx.items();
  assert.equal(ctx.items()[0], first);
  ctx.page.rows[0].instructions += " Today?";  // typing mutates the row in place
  assert.notEqual(ctx.items()[0], first);
  assert.equal(ctx.items()[1], second);
  ctx.page.expect.urgency = { min: 1 };
  assert.deepEqual(ctx.items()[1].expectation, { min: 1 });
  ctx.page.rows = [ctx.page.rows[1], ctx.page.rows[0]];
  assert.equal(ctx.items()[0].position, 1);
  assert.equal(ctx.items()[0].qid, "urgency");
  assert.deepEqual(ctx.items().map((item) => item.ref), ["q2", "q1"], "a card keeps its ref when it moves");
});

test("question data: state kinds, pictures without bytes, answers, lint and limits", () => {
  const ctx = sampleBuildQuestionsCtx();
  assert.equal(ctx.data.state.kind, "object");
  assert.equal(ctx.data.state.value.ticket.lines[0].qty, 2);
  assert.ok(Object.isFrozen(ctx.data.state.value.ticket));
  assert.deepEqual(ctx.data.images, [{ ref: "photo-0a1b2c3d4e", sample: "mug", name: null, format: "png" },
    { ref: "photo-99ffee0011", sample: null, name: "counter.jpg", format: "jpg" }]);
  assert.ok(!JSON.stringify(ctx.data.images).includes("AAAA"), "picture bytes never reach packs");
  assert.equal(ctx.data.answers.intent.choice, "refund");
  assert.equal(ctx.data.lint.counts.problem, 1);
  assert.equal(ctx.data.lint.lab.findings[0].code, "sample-pack/short_id");
  assert.equal(ctx.data.limits.questions, 100);
  assert.equal(ctx.data.limits.images, 4);
  assert.deepEqual(ctx.data.origin, { example: "support_triage", test: null, handoff: null });
  assert.deepEqual(Object.keys(ctx.data.expect), ["intent", "angry", "mug_box", "old_question"]);
  for (const [text, kind] of [["Plain words", "text"], ["", "text"], ["{not json", "text"], ["[1, 2]", "array"], ["{\"a\": 1, \"a\": 2}", "invalid"]]) {
    assert.equal(sampleBuildQuestionsCtx({ stateText: text }).data.state.kind, kind, text);
  }
  assert.match(sampleBuildQuestionsCtx({ stateText: "{\"a\": 1, \"a\": 2}" }).data.state.error, /repeats key/);
  const bare = sampleBuildQuestionsCtx({ rows: [], result: null, lint: null, expect: {}, images: [] });
  assert.deepEqual(bare.items(), []);
  assert.deepEqual(bare.shown(), []);
  assert.equal(bare.data.answers, null);
  assert.equal(bare.data.lint, null);
  assert.equal(bare.data.stale, false);
  assert.equal(sampleBuildQuestionsCtx({ result: null, stale: true }).data.stale, false, "no answers, nothing outdated");
  assert.match(sampleBuildQuestionsCtx({ rows: [row("a"), row("a")] }).data.editorError, /repeated/);
});

test("question shown() follows the page's filters, then Lab's sort, and survives a fact that asks for shown()", () => {
  const ctx = sampleBuildQuestionsCtx();
  assert.deepEqual(ctx.shown().map((item) => item.position), [1, 2, 3, 4, 5, 6]);
  assert.ok(ctx.shown().every((item, index) => item === ctx.items()[index]));
  ctx.page.order = ["angry", "intent"];
  assert.deepEqual(ctx.shown().map((item) => item.position), [3, 1, 2, 4, 5, 6]);

  const host = lab();
  const page = { rows: [row("a", "noul", { instructions: "short" }), row("b", "noul", { instructions: "a much longer one" }), row("c")] };
  const live = wbBuildQuestionsCtx({ rows: () => page.rows, expect: () => ({}),
    matches: (item, c) => host.matches(QUESTIONS, item, c), arrange: (items, c) => host.arrange(QUESTIONS, items, c) });
  assert.deepEqual(live.shown().map((item) => item.qid), ["a", "b", "c"]);
  host.view(QUESTIONS).filters = [{ key: "test-question-facts/chars", op: "min", value: "9" }];
  host.view(QUESTIONS).sort = { key: "test-question-facts/chars", dir: "desc" };
  assert.deepEqual(live.shown().map((item) => item.qid), ["b", "c"]);
  host.view(QUESTIONS).filters = [{ key: "test-question-facts/loop", op: "min", value: "1" }];
  assert.equal(live.shown().length, 3, "a fact reading shown() sees items() instead of recursing");
});

// ---------- workbench.build.questions: actions ----------

test("replaceItems edits through the page's commit, keeps unchanged rows and moves expectations with a rename", () => {
  const ctx = sampleBuildQuestionsCtx();
  const before = ctx.page.rows.slice();
  const next = ctx.items().map((item) => ({ ...item }));
  next[0].id = "customer_intent";
  next[1].instructions = "How urgent is it?";
  ctx.actions.replaceItems(next, { label: "Rename" });
  const [[name, commit]] = ctx.log;
  assert.equal(name, "commit");
  assert.equal(commit.label, "Rename");
  assert.deepEqual(commit.origins, before);
  assert.equal(ctx.page.rows[2], before[2], "an unchanged row keeps its identity (and collapsed state)");
  assert.notEqual(ctx.page.rows[0], before[0]);
  assert.deepEqual(ctx.page.rows[0], { ...before[0], id: "customer_intent" });
  assert.equal(ctx.page.rows[1].instructions, "How urgent is it?");
  assert.deepEqual(ctx.page.expect, { old_question: { min: 0.2 }, customer_intent: { choice: "refund" }, angry: { max: 0.5 },
    mug_box: { box: { left: 0.2, top: 0.3, right: 0.6, bottom: 0.8 }, iou_min: 0.5 } });
  assert.ok(!Object.hasOwn(ctx.page.expect, "intent"));
});

test("replaceItems rejects lists that break the editor's invariants and leaves the page unchanged", () => {
  const base = () => sampleBuildQuestionsCtx().items().map((item) => ({ ...item }));
  const cases = [
    [() => null, /no question list/],
    [() => [...base(), ...Array.from({ length: 94 }, (_, index) => ({ id: `q${index}`, type: "noul" }))], /at most 100 questions/],
    [() => base().map((item, index) => (index === 1 ? { ...item, type: "ranking" } : item)), /type must be noul, choice, score or box/],
    [() => base().map((item, index) => (index === 1 ? { ...item, instructions: 4 } : item)), /instructions must be text/],
    [() => base().map((item, index) => (index === 1 ? { ...item, choice: [["a"]] } : item)), /choice must be a list/],
    [() => base().map((item, index) => (index === 1 ? { ...item, score: [1, 2] } : item)), /score must be a list/],
    [() => base().map((item, index) => (index === 1 ? { ...item, id: "intent" } : item)), /“intent” is repeated/],
    [() => base().map((item, index) => (index === 6 ? { ...item, choice: [["calm", "A"], [" calm", "B"]] } : item)), /repeats option key “calm”/],
    [() => base().map((item, index) => (index === 6 ? { ...item, choice: Array.from({ length: 256 }, (_, n) => [`k${n}`, ""]) } : item)), /at most 255 options/],
    [() => base().map((item, index) => (index === 1 ? { ...item, score: Array.from({ length: 26 }, (_, n) => `level ${n}`) } : item)), /at most 25 levels/],
    [() => base().filter((item) => item.id !== "angry"), /“angry” has human expectations/],
    [() => base().map((item) => (item.id === "angry" ? { ...item, id: "  " } : item)), /needs an id/],
    [() => base().map((item) => (item.id === "angry" ? { ...item, id: "intent_x" } : item.id === "intent" ? { ...item, id: "angry_x" } : item)), null],
    [() => base().map((item) => (item.id === "urgency" ? { ...item, id: "old_question" } : item)), /Expectations already exist for “old_question”/],
    [() => [...base(), { id: "old_question", type: "noul" }], /Expectations already exist for “old_question”/],
    [() => base().map((item) => (item.id === "angry" ? { ...item, id: "mug_box" } : item.id === "mug_box" ? { ...item, id: "mug" } : item)), null],
  ];
  for (const [make, message] of cases) {
    const ctx = sampleBuildQuestionsCtx();
    if (message === null) {
      ctx.actions.replaceItems(make(), {});
      assert.equal(ctx.log.length, 1, "swapping expectations between renamed questions is allowed");
      continue;
    }
    assert.throws(() => ctx.actions.replaceItems(make(), {}), message);
    assert.deepEqual(ctx.log, [], String(message));
    assert.deepEqual(ctx.page.rows, buildRows());
    assert.deepEqual(ctx.page.expect, buildExpect());
  }
  const pending = sampleBuildQuestionsCtx({ rawPending: true });
  assert.throws(() => pending.actions.replaceItems(pending.items(), {}), /Apply the Raw JSON edits before editing questions/);
});

test("replaceItems: a repeated ref is a new card, which never inherits an expectation", () => {
  const ctx = sampleBuildQuestionsCtx();
  const items = ctx.items().map((item) => ({ ...item }));
  ctx.actions.replaceItems([...items, { ...items[0], id: "intent_copy" }], {});
  assert.equal(ctx.page.rows.length, 8);
  assert.equal(ctx.log[0][1].origins[7], null);
  assert.ok(!Object.hasOwn(ctx.page.expect, "intent_copy"));
  assert.deepEqual(ctx.page.expect.intent, { choice: "refund" });
  assert.deepEqual(ctx.items().map((item) => item.ref), ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
});

test("replaceItems follows cards by ref when they move, and Lab's Undo restores a reorder, a rename and a removal", () => {
  const ctx = sampleBuildQuestionsCtx();
  const before = ctx.items();
  // Swap intent and angry and rename both: expectations follow their cards, not their positions.
  const swapped = before.map((item) => ({ ...item }));
  [swapped[0], swapped[2]] = [{ ...swapped[2], id: "is_angry" }, { ...swapped[0], id: "wants" }];
  ctx.actions.replaceItems(swapped, {});
  assert.deepEqual(ctx.page.rows.slice(0, 3).map((r) => r.id), ["is_angry", "urgency", "wants"]);
  assert.deepEqual(ctx.page.expect.is_angry, { max: 0.5 });
  assert.deepEqual(ctx.page.expect.wants, { choice: "refund" });
  assert.equal(JSON.stringify(ctx.items()), JSON.stringify(swapped), "the edited list reads back exactly as it was given");
  ctx.actions.replaceItems(before.map((item) => ({ ...item })), {});
  assert.deepEqual(ctx.page.rows, buildRows());
  assert.deepEqual(ctx.page.expect, buildExpect());
  // Dropping a card without expectations and restoring it keeps its ref.
  const dropped = ctx.items().filter((item) => item.ref !== "q2").map((item) => ({ ...item }));
  ctx.actions.replaceItems(dropped, {});
  assert.equal(ctx.page.rows.length, 6);
  ctx.actions.replaceItems(before.map((item) => ({ ...item })), {});
  assert.equal(JSON.stringify(ctx.items()), JSON.stringify(before));
  assert.ok(ctx.log.every(([name]) => name === "commit"));
});

test("replaceItems keeps ids such as __proto__ and their expectations as own properties", () => {
  const ctx = sampleBuildQuestionsCtx({ rows: [row("__proto__"), row("b")], expect: JSON.parse("{\"__proto__\": {\"min\": 0.5}}") });
  const next = ctx.items().map((item) => ({ ...item }));
  next[1].id = "renamed";
  ctx.actions.replaceItems(next, {});
  assert.ok(Object.hasOwn(ctx.page.expect, "__proto__"));
  assert.deepEqual(ctx.page.expect.__proto__, { min: 0.5 });
});

test("importItems appends new questions with blank defaults and refuses ids in use or with expectations", () => {
  const ctx = sampleBuildQuestionsCtx();
  ctx.actions.importItems([{ id: "refund_reason", type: "choice", instructions: "Why?", ref: "q1" }, { id: "size", type: "score", score: ["Small", "Large"] }], { label: "Import" });
  assert.deepEqual(ctx.items().slice(7).map((item) => item.ref), ["q8", "q9"], "an imported item's ref is ignored");
  assert.equal(ctx.page.rows.length, 9);
  assert.deepEqual(ctx.page.rows[7], { id: "refund_reason", type: "choice", instructions: "Why?", choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "" });
  assert.deepEqual(ctx.page.rows[8].score, ["Small", "Large"]);
  assert.deepEqual(ctx.page.expect, buildExpect());
  for (const [list, message] of [[[], /nothing to import/], [[{ id: " ", type: "noul" }], /needs an id/], [[{ id: "intent", type: "noul" }], /already in the editor/],
    [[{ id: "old_question", type: "noul" }], /Expectations already exist/], [[{ id: "x", type: "noul" }, { id: "x", type: "box" }], /repeated/],
    [Array.from({ length: 94 }, (_, n) => ({ id: `n${n}`, type: "noul" })), /at most 100 questions/], [[{ id: "z", type: "poll" }], /type must be/]]) {
    const fresh = sampleBuildQuestionsCtx();
    assert.throws(() => fresh.actions.importItems(list, {}), message);
    assert.deepEqual(fresh.log, []);
  }
  assert.throws(() => sampleBuildQuestionsCtx({ rawPending: true }).actions.importItems([{ id: "x", type: "noul" }], {}), /Raw JSON/);
});

test("question actions guard before reaching the page", () => {
  const ctx = sampleBuildQuestionsCtx();
  ctx.actions.addQuestion("box");
  ctx.actions.focus("angry");
  ctx.actions.focus(2);
  ctx.actions.checkQuestions();
  ctx.actions.exportCode();
  ctx.actions.formatState();
  ctx.actions.compactState();
  ctx.actions.clearFilters();
  assert.deepEqual(ctx.log, [["addQuestion", "box"], ["focus", 2], ["focus", 1], ["checkQuestions"], ["exportCode"], ["formatState"], ["compactState"], ["clearFilters"]]);
  assert.throws(() => ctx.actions.addQuestion("rank"), /Choose a question type/);
  assert.throws(() => sampleBuildQuestionsCtx({ rows: Array.from({ length: 100 }, (_, n) => row(`q${n}`)) }).actions.addQuestion("noul"), /at most 100/);
  assert.throws(() => sampleBuildQuestionsCtx({ rawPending: true }).actions.addQuestion("noul"), /Raw JSON/);
  assert.throws(() => sampleBuildQuestionsCtx().actions.focus("tone"), /hidden by the question filters/);
  assert.throws(() => sampleBuildQuestionsCtx().actions.focus("nope"), /There is no question “nope”/);
  assert.throws(() => sampleBuildQuestionsCtx().actions.focus(9), /at position 9/);
  for (const action of ["checkQuestions", "exportCode"]) {
    assert.throws(() => sampleBuildQuestionsCtx({ rawPending: true }).actions[action](), /Apply the Raw JSON edits before using this request/);
    assert.throws(() => sampleBuildQuestionsCtx({ stateText: "{\"a\": 1, \"a\": 2}" }).actions[action](), /State: .*repeats key/);
    assert.throws(() => sampleBuildQuestionsCtx({ rows: [row("a"), row("a")] }).actions[action](), /repeated/);
    assert.throws(() => sampleBuildQuestionsCtx({ rows: [row("")] }).actions[action](), /at least one question with an id/);
  }
  assert.throws(() => sampleBuildQuestionsCtx({ stateText: "[1, 1, {\"x\": 1, \"x\": 2}]" }).actions.formatState(), /repeats key/);
  assert.throws(() => sampleBuildQuestionsCtx({ stateText: "{\"x\": 1, \"x\": 2}" }).actions.compactState(), /repeats key/);
  assert.throws(() => sampleBuildQuestionsCtx().actions.undoRemove(), /No removed question/);
  const undo = sampleBuildQuestionsCtx({ canUndoRemove: true });
  undo.actions.undoRemove();
  assert.deepEqual(undo.log, [["undoRemove"]]);
  assert.throws(() => wbBuildQuestionsCtx({ rows: () => [row("a")] }).actions.checkQuestions(), /cannot do that here/);
});

// ---------- workbench.build.result ----------

test("answer items carry the documented fields in response order, with the expectation the editor holds now", () => {
  const ctx = sampleBuildResultCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.id), ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "tone"]);
  assert.deepEqual(Object.keys(items[0]), ["id", "position", "type", "instructions", "criteria", "value", "display", "scale", "probabilities", "top", "confidence", "box", "expectation", "answer"]);
  assert.ok(items.every((item) => Object.isFrozen(item) && Object.isFrozen(item.answer)));
  assert.deepEqual(items[0].criteria[2], { key: "other", text: "" });
  assert.deepEqual([items[1].value, items[1].display, items[1].scale, items[1].top], [1.35, "1.35 / 2", 2, { key: "1", p: 0.45 }]);
  assert.deepEqual([items[2].value, items[2].display, items[2].confidence], [0.64, "64.0%", null]);
  assert.equal(items[2].probabilities[1].key, "no");
  assert.ok(Math.abs(items[2].probabilities[1].p - 0.36) < 1e-12);
  assert.deepEqual(items[3].box, { left: 0.25, top: 0.3, right: 0.65, bottom: 0.7 });
  assert.equal(items[3].display, "40% × 40%");
  assert.equal(items[4].instructions, "{\"ask\":\"Does `order_total` match the refund asked for?\"}");
  assert.deepEqual(items.map((item) => item.expectation === null), [false, true, false, false, true, true]);
  assert.equal(ctx.items()[0], items[0]);
  ctx.page.expect = { ...ctx.page.expect, urgency: { min: 1 } };
  assert.deepEqual(ctx.items()[1].expectation, { min: 1 });
  assert.deepEqual(ctx.items().map((item, index) => ctx.itemName(item, index)), ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "tone"]);
});

test("odd answers give nulls rather than throwing, and no Run gives an empty list", () => {
  const items = sampleBuildResultCtx({ result: buildOddResult() }).items();
  assert.deepEqual(items.map((item) => [item.id, item.value, item.display, item.top]), [["level", null, "", { key: "0", p: 0.5 }], ["pick", "x_y", "x y", null],
    ["spot", null, "", null], ["future", null, "", null]]);
  assert.deepEqual(items[0].probabilities, [{ key: "0", p: 0.5 }]);
  assert.equal(items[0].scale, 1);
  const none = sampleBuildResultCtx({ result: null });
  assert.deepEqual([none.items(), none.shown(), none.data.meta, none.data.request, none.data.pictures, none.data.stale], [[], [], null, null, [], false]);
});

test("answer data and shown(): measurements, pictures without bytes, Lab filters and sort", () => {
  const ctx = sampleBuildResultCtx();
  assert.equal(ctx.data.meta.cost_usd, 0.000412);
  assert.deepEqual(Object.keys(ctx.data.request), ["state", "model", "questions"]);
  assert.ok(!JSON.stringify(ctx.data.pictures).includes("AAAA"));
  assert.deepEqual(ctx.data.currentIds, ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "tone"]);
  assert.equal(sampleBuildResultCtx({ stale: true }).data.stale, true);
  assert.deepEqual(sampleBuildResultCtx({ hide: ["angry"], order: ["tone"] }).shown().map((item) => item.id), ["tone", "intent", "urgency", "mug_box", "refund_amount_ok"]);

  const host = lab();
  let result = buildResult();
  const live = wbBuildResultCtx({ result: () => result, matches: (item, c) => host.matches(RESULT, item, c), arrange: (items, c) => host.arrange(RESULT, items, c) });
  host.view(RESULT).filters = [{ key: "test-answer-facts/conf", op: "max", value: "0.6" }];
  host.view(RESULT).sort = { key: "test-answer-facts/conf", dir: "asc" };
  assert.deepEqual(live.shown().map((item) => item.id), ["urgency", "tone"]);
  result = null;
  assert.deepEqual(live.shown(), []);
});

test("answer actions guard Inspect, Save and focus, and none presses Run", () => {
  const ctx = sampleBuildResultCtx();
  assert.equal("run" in ctx.actions, false, "no action presses Run (a live model call)");
  ctx.actions.inspect();
  ctx.actions.openSave();
  ctx.actions.focusQuestion("angry");
  assert.deepEqual(ctx.log, [["inspect"], ["openSave"], ["focusQuestion", "angry"]]);
  assert.throws(() => sampleBuildResultCtx({ result: null }).actions.inspect(), /Press Run first/);
  assert.throws(() => sampleBuildResultCtx({ result: null }).actions.openSave(), /Press Run first/);
  assert.throws(() => sampleBuildResultCtx({ stale: true }).actions.openSave(), /Run the edited request/);
  assert.throws(() => sampleBuildResultCtx().actions.focusQuestion("gone"), /No question in the editor/);
  assert.throws(() => sampleBuildResultCtx({ hide: ["tone"] }).actions.focusQuestion("tone"), /hidden by the question filters/);
  assert.equal(ctx.actions.replaceItems, undefined, "answers are read-only");
  assert.equal(ctx.actions.importItems, undefined);
});

// ---------- the hooks in static/js/workbench-build.js ----------

function pageWith(rows, expect = {}) {
  const host = lab();
  const W = { questions: rows, expect, lab: host };
  W.buildLabCtx = { questions: wbBuildQuestionsCtx({ rows: () => W.questions, expect: () => W.expect }) };
  return W;
}
const visibleFor = (W, view = { query: "", type: "all" }) =>
  new Function("W", "$", "buildQuestionView", "matchesEditorQuestion", `${body("visibleBuildQuestions")}; return visibleBuildQuestions;`)(W, () => null, view, matchesEditorQuestion);

test("visibleBuildQuestions counts Lab filters with the page's own, and is unchanged without Lab", () => {
  const rows = [row("short", "noul", { instructions: "Late?" }), row("long", "choice", { instructions: "Is the Harbor Coffee order late?" }), row("third", "noul", { instructions: "Is it cold today?" })];
  const W = pageWith(rows);
  assert.deepEqual(visibleFor(W)().map((r) => r.id), ["short", "long", "third"]);
  assert.deepEqual(visibleFor({ questions: rows, expect: {} })().map((r) => r.id), ["short", "long", "third"], "no W.lab: the page as before");
  W.lab.view(QUESTIONS).filters = [{ key: "test-question-facts/chars", op: "min", value: "10" }];
  assert.deepEqual(visibleFor(W)().map((r) => r.id), ["long", "third"]);
  assert.deepEqual(visibleFor(W, { query: "", type: "noul" })().map((r) => r.id), ["third"], "Lab and page filters combine");
  W.lab.view(QUESTIONS).sort = { key: "test-question-facts/chars", dir: "desc" };
  assert.deepEqual(visibleFor(W)().map((r) => r.id), ["long", "third"], "visible rows stay in request order; only the display is sorted");
});

test("the card order follows a Lab sort for shown cards and stays request order otherwise", () => {
  const rows = [row("a", "noul", { instructions: "x" }), row("b", "noul", { instructions: "xxx" }), row("c", "noul", { instructions: "xx" })];
  const W = pageWith(rows);
  const order = new Function("W", "BUILD_LAB_QUESTIONS", `${body("buildLabQuestionOrder")}; return buildLabQuestionOrder;`)(W, QUESTIONS);
  assert.deepEqual(order(new Set(rows)), [0, 1, 2]);
  W.lab.view(QUESTIONS).sort = { key: "test-question-facts/chars", dir: "desc" };
  assert.deepEqual(order(new Set(rows)), [1, 2, 0]);
  assert.deepEqual(order(new Set([rows[0], rows[2]])), [2, 0, 1], "hidden cards follow the shown ones");
  const plain = new Function("W", "BUILD_LAB_QUESTIONS", `${body("buildLabQuestionOrder")}; return buildLabQuestionOrder;`)({ questions: rows }, QUESTIONS);
  assert.deepEqual(plain(new Set(rows)), [0, 1, 2]);
});

test("the shown count names active Lab settings, and Clear question filters and Insert also clear Lab's", () => {
  const rows = [row("a", "noul", { instructions: "x" }), row("b", "noul", { instructions: "a longer text" })];
  const W = pageWith(rows);
  W.lab.view(QUESTIONS).filters = [{ key: "test-question-facts/chars", op: "min", value: "5" }];
  const count = { textContent: "" };
  const elements = { "#build-question-count": count };
  const refresh = new Function("W", "$", "buildQuestionView", "matchesEditorQuestion", "refreshAuthoringSummary",
    `${body("visibleBuildQuestions")}; ${body("refreshQuestionVisibility")}; return refreshQuestionVisibility;`)(W, (selector) => elements[selector] || null, { query: "", type: "all" }, matchesEditorQuestion, () => {});
  refresh();
  assert.equal(count.textContent, "1 of 2 questions shown. Run and export include every question. 1 Lab setting active.");
  W.lab.reset(QUESTIONS);
  refresh();
  assert.equal(count.textContent, "2 of 2 questions shown. Run and export include every question.", "no Lab setting: the text as before");

  const nodes = [];
  const h = (tag, attrs = {}, ...children) => { const node = { tag, attrs: attrs || {}, children: children.flat(Infinity) }; nodes.push(node); return node; };
  let renders = 0;
  const view = { query: "x", type: "noul" };
  W.lab.view(QUESTIONS).filters = [{ key: "test-question-facts/chars", op: "min", value: "5" }];
  const tools = new Function("h", "visibleBuildQuestions", "buildQuestionView", "TYPES", "W", "refreshQuestionVisibility", "moveShownQuestionsToEdge", "markBuildEdited", "render",
    `${body("renderQuestionTools")}; return renderQuestionTools;`)(h, () => [rows[1]], view, ["noul", "choice", "score", "box"], W, () => {}, () => {}, () => {}, () => { renders++; });
  tools();
  assert.match(nodes.find((node) => node.attrs.id === "build-question-count").children[0], /^1 of 2 questions shown\. Run and export include every question\. 1 Lab setting active\.$/);
  nodes.find((node) => node.tag === "button" && node.children.includes("Clear question filters")).attrs.onclick();
  assert.deepEqual(view, { query: "", type: "all" });
  assert.equal(W.lab.active(QUESTIONS), 0);
  assert.equal(renders, 1);

  W.lab.view(QUESTIONS).filters = [{ key: "test-question-facts/chars", op: "min", value: "5" }];
  const insert = new Function("W", "blankRow", "buildQuestionView", "markBuildEdited", "render", `${body("insertBuildQuestion")}; return insertBuildQuestion;`)(
    W, (type) => row("fresh", type), { query: "q" }, () => {}, () => {});
  insert(0, true);
  assert.equal(W.lab.active(QUESTIONS), 0, "an inserted card is never hidden by a Lab filter");
});

test("answer cards follow Lab filters and sort, with a count and a reset, and are unchanged without Lab", () => {
  const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined) });
  const answerCard = (qid) => ({ card: qid });
  const result = buildResult();
  const make = (W) => new Function("W", "h", "answerCard", "render", "BUILD_LAB_RESULT", `${body("renderBuildAnswerCards")}; return renderBuildAnswerCards;`)(W, h, answerCard, () => {}, RESULT);
  assert.deepEqual(make({ result: null })(), []);
  const all = ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "tone"];
  assert.deepEqual(make({ result })().map((node) => node.card), all, "no Lab ctx: every answer in response order");
  const host = lab();
  const W = { result, lab: host };
  W.buildLabCtx = { result: wbBuildResultCtx({ result: () => W.result, matches: (item, c) => host.matches(RESULT, item, c), arrange: (items, c) => host.arrange(RESULT, items, c) }) };
  const [cards, note] = make(W)();
  assert.deepEqual(cards.map((node) => node.card), all, "Lab present but idle: the same cards");
  assert.equal(note, null);
  host.view(RESULT).filters = [{ key: "test-answer-facts/conf", op: "min", value: "0.5" }];
  host.view(RESULT).sort = { key: "test-answer-facts/conf", dir: "desc" };
  const [sorted, status] = make(W)();
  assert.deepEqual(sorted.map((node) => node.card), ["intent", "mug_box", "tone"]);
  assert.match(status.children[0], /^3 of 6 answers shown · 2 Lab settings active/);
  host.view(RESULT).filters = [{ key: "test-answer-facts/conf", op: "min", value: "0.99" }];
  assert.equal(make(W)()[0].children[0], "No answer matches the Lab filters.");
});

test("Question checks list the Python packs' extra findings after the built-in ones, without changing the counts", () => {
  const nodes = [];
  const h = (tag, attrs = {}, ...children) => { const node = { tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }; nodes.push(node); return node; };
  const text = (node) => (typeof node === "string" ? node : (node.children || []).map(text).join(""));
  const make = (lint) => {
    nodes.length = 0;
    return new Function("W", "h", "icon", "statusBadge", "render", `${body("renderLint")}; return renderLint;`)({ lint }, h, () => "", (kind, label) => h("span", { class: "badge" }, label), () => {})();
  };
  const guide = "https://docs.typesafe.ai/concepts/how-to-build-with-system-one";
  const builtIn = { level: "advice", code: "long_instructions", question: "intent", message: "Long.", guide };
  const extra = { level: "advice", code: "sample-pack/short_id", question: "angry", message: "A longer id would help.", guide: `${guide}#ids` };
  const panel = make({ findings: [builtIn], counts: { problem: 0, advice: 1 }, guide, lab: { findings: [extra], counts: { problem: 0, advice: 1 } } });
  const lists = nodes.filter((node) => node.tag === "ul");
  assert.equal(lists.length, 2);
  assert.equal(lists[1].attrs["data-lint"], "lab");
  assert.match(text(lists[1]), /angryA longer id would help\.Why: How to build with System One/);
  assert.match(text(panel), /Additional checks · 1/);
  assert.deepEqual(nodes.filter((node) => node.attrs.class === "badge warning" && /advice/.test(text(node))).map(text), ["1 advice"], "the badge counts built-in findings only");
  const quiet = make({ findings: [], counts: { problem: 0, advice: 0 }, guide, lab: { findings: [], counts: { problem: 0, advice: 0 } } });
  assert.match(text(quiet), /No findings\./);
  assert.doesNotMatch(text(quiet), /Additional checks/);
  const before = make({ findings: [builtIn], counts: { problem: 0, advice: 1 }, guide });
  assert.equal(nodes.filter((node) => node.tag === "ul").length, 1, "a report without lab renders as before");
  assert.doesNotMatch(text(before), /Additional/);
  const onlyExtra = make({ findings: [], counts: { problem: 0, advice: 0 }, guide, lab: { findings: [{ ...extra, guide: "" }], counts: { problem: 0, advice: 1 } } });
  assert.match(text(onlyExtra), /No findings from the built-in checks\./);
  assert.equal(nodes.filter((node) => node.tag === "a" && node.attrs.href === "").length, 0, "no empty guide link");
});
