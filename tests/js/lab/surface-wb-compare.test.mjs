// Tests of the Workbench Compare Lab surfaces: the builders in static/js/lab/surfaces/workbench-compare.js (item
// shapes, shown(), data, every action's guard, replaceItems/importItems invariants) and the hooks in
// static/js/workbench-compare.js, rebuilt from the page source with stand-ins and run against a real Lab host.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compareRowsCtx, compareVariantsCtx } from "../../../static/js/lab/surfaces/workbench-compare.js";
import { createLab } from "../../../static/js/lab/host.js";
import rowsPack from "../../../static/js/lab/packs/workbench/wb-compare-rows.js";
import variantsPack from "../../../static/js/lab/packs/workbench/wb-compare-variants.js";
import { fakeDom, fakeEnv, find, findAll, textOf } from "./harness.mjs";
import { COMPARE_REPORTS, COMPARE_RESULT, QUESTIONS_A, QUESTIONS_B, VARIANT_TEXTS, sampleCompareRowsCtx, sampleCompareVariantsCtx } from "./fixtures/workbench-compare.mjs";

const ROWS = "workbench.compare.rows";
const VARIANTS = "workbench.compare.variants";

// ---------- workbench.compare.rows: builder ----------

test("rows: every item has exactly the documented fields, in run order", () => {
  const ctx = sampleCompareRowsCtx();
  const keys = ["index", "number", "row", "text", "sent", "label", "answers", "picks", "signals", "tops", "correct", "verdict", "differs", "paired",
    "orders", "meta", "errors", "skipped"];
  for (const item of ctx.items()) assert.deepEqual(Object.keys(item), keys);
  assert.deepEqual(ctx.items().map((item) => item.number), [1, 2, 3, 4, 5, 6, 7]);
  const [first, second, third, , fifth, , seventh] = ctx.items();
  assert.equal(first.text, "My espresso grinder arrived cracked, I want a refund today.");
  assert.deepEqual(first.sent, [null, "My espreso grinder arived cracked, I want a refund today."]);
  assert.deepEqual(first.correct, [true, false]);
  assert.deepEqual(first.meta[1], { model: "jev-1.14.0", latency_ms: 560, input_tokens: 720, output_tokens: 40, cost_usd: 0.0003, calls: 2 });
  assert.equal(second.text, '{"text":"Where is wholesale order HC-2231?","channel":"email","_image":"receipt.png"}');
  assert.equal(second.row._image, "receipt.png");
  assert.equal(third.differs, false);
  assert.deepEqual(third.correct, [null, null], "rows that agree carry no per-row scoring");
  assert.deepEqual([fifth.paired, fifth.errors, fifth.picks[1]], [false, [null, "Rate limit reached"], null]);
  assert.deepEqual(seventh.skipped, [false, true]);
  assert.equal(seventh.label, null, "an empty _expect is no label");
  assert.equal(ctx.itemName(first, 0), "#1");
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.answers[0].probabilities));
  assert.equal(ctx.items(), ctx.items(), "the same item objects until the report changes");
});

test("rows: no item holds a held-out label, the rows box, or a test marker", () => {
  const text = JSON.stringify(sampleCompareRowsCtx().items());
  assert.ok(!text.includes("_test") && !text.includes("_expect"));
});

test("rows: local reads mirror jev/calibrate.read for every type and refuse what it refuses", () => {
  const result = { variants: [{ questions: { q: { type: "choice" } } }, { questions: { q: { type: "choice" } } }], results: [] };
  const answers = [
    [{ type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.5, c: 0.3 } }, "b", 0.25, 0.5],          // (0.5 - 1/3) / (2/3)
    [{ type: "choice", choice: "b", probabilities: { b: 1 } }, "b", 1, 1],                                   // one option: 1
    [{ type: "score", probabilities: { 0: 0.2, 1: 0.5, 2: 0.3 }, confidence: 0.4 }, "1", 0.4, 0.5],
    [{ type: "noul", noul: 0.3 }, "no", 0.4, 0.7],
    [{ type: "box", box: { left: 0.105, top: 0.2, right: 0.5, bottom: 0.6 }, confidence: 0.9 }, "0.10, 0.20, 0.50, 0.60", 0.9, 0.9],
    [{ type: "choice", choice: "z", probabilities: { a: 1 } }, null, null, null],                            // pick not offered
    [{ type: "noul", noul: 1.2 }, null, null, null],
    [{ type: "box", box: { left: 0.5, top: 0.2, right: 0.4, bottom: 0.6 }, confidence: 0.9 }, null, null, null],
    [{ type: "score", probabilities: { low: 1 } }, null, null, null],
    [{ type: "rating", value: 3 }, null, null, null],
  ];
  result.results = answers.map(([answer], index) => ({ index, row: `row ${index}`, runs: [{ answers: { q: answer } }, { answers: { q: answer } }] }));
  const ctx = compareRowsCtx({ result, report: { type: "choice", signal: "confidence", disagreements: [] }, qid: "q" });
  ctx.items().forEach((item, index) => {
    const [, pick, signal, top] = answers[index];
    assert.equal(item.picks[0], pick, `pick ${index}`);
    if (signal === null) assert.equal(item.signals[0], null);
    else assert.ok(Math.abs(item.signals[0] - signal) < 1e-12, `signal ${index}`);
    if (top === null) assert.equal(item.tops[0], null);
    else assert.ok(Math.abs(item.tops[0] - top) < 1e-12, `top ${index}`);
  });
  const top = compareRowsCtx({ result, report: { type: "choice", signal: "top_probability", disagreements: [] }, qid: "q" });
  assert.equal(top.items()[0].signals[0], 0.5);
  assert.equal(top.items()[3].signals[0], 0.7);
});

test("rows: shown() is the page's disagreement list after Lab filters and Lab sort", () => {
  assert.deepEqual(sampleCompareRowsCtx().shown().map((item) => item.number), [1, 2, 4, 6]);
  assert.deepEqual(sampleCompareRowsCtx({ hide: [1, 2] }).shown().map((item) => item.number), [1, 4, 6], "a Lab filter hides more");
  assert.deepEqual(sampleCompareRowsCtx({ order: [5, 3, 2] }).shown().map((item) => item.number), [6, 4, 1, 2], "agreeing rows stay hidden under a sort");
  const ctx = sampleCompareRowsCtx();
  ctx.state.report = COMPARE_REPORTS.urgent;
  ctx.state.qid = "urgent";
  assert.deepEqual(ctx.shown().map((item) => item.number), [2], "evaluated at call time");
});

test("rows: before a run, without a report and on a report error everything is empty", () => {
  for (const overrides of [{ result: null }, { report: null }, { report: null, reportError: "No row has answers from both variants" }]) {
    const ctx = sampleCompareRowsCtx(overrides);
    assert.deepEqual([ctx.items(), ctx.shown()], [[], []]);
    assert.equal(ctx.data.type, null);
    assert.equal(ctx.data.scores, null);
    assert.equal(ctx.data.cascade, null);
    assert.equal(ctx.data.counts, null);
  }
  const before = sampleCompareRowsCtx({ result: null });
  assert.deepEqual([before.data.qid, before.data.run, before.data.variants, before.data.agreement, before.data.shared, before.data.slices], [null, null, [], [], [], null]);
  assert.equal(sampleCompareRowsCtx({ report: null, reportError: "boom" }).data.report_error, "boom");
});

test("rows: data reads the run and the report", () => {
  const data = sampleCompareRowsCtx().data;
  assert.equal(data.qid, "department");
  assert.equal(data.type, "choice");
  assert.equal(data.signal, "confidence");
  assert.deepEqual(data.shared, ["department", "urgent", "tone", "drink", "spot"]);
  assert.deepEqual(data.labeled, ["department", "urgent", "tone", "spot"]);
  assert.deepEqual(data.counts, { answered_both: 5, agree: 1, disagree: 4, only_a: 2, only_b: 0, excluded: 0 });
  assert.deepEqual(data.run, { rows: 7, labeled: 6, held_out: 1, wall_ms: 3200, cost_usd: 0.0019, stopped: "Session budget reached; 1 call was skipped." });
  assert.deepEqual(data.variants.map((variant) => [variant.name, variant.perturb, variant.average_orders, variant.question_count, variant.errors]),
    [["A", null, false, 7, 0], ["B", "typos", true, 7, 1]]);
  assert.deepEqual(data.questions, [QUESTIONS_A.department, QUESTIONS_B.department]);
  assert.equal(data.scores[0].sweep.length, 101);
  assert.equal(data.cascade.best.threshold, 0.37);
  assert.equal(data.cascade_threshold, 0.37);
  assert.deepEqual(data.orders[0], null);
  assert.equal(data.orders[1][0].qid, "department");
  assert.equal(data.slices.field, "channel");
  assert.ok(Object.isFrozen(data.scores) && Object.isFrozen(data.agreement[0]));
  assert.equal(sampleCompareRowsCtx({ qid: "spot" }).data.type, "box");
});

test("rows: every action checks its guard before reaching the page", () => {
  const ok = sampleCompareRowsCtx();
  ok.actions.selectQuestion("urgent");
  ok.actions.setSignal("top_probability");
  ok.actions.setBound("lower");
  ok.actions.setFirst("B");
  assert.equal(ok.actions.setCascadeThreshold(0.456), 0.46);
  ok.actions.labelDisagreements();
  ok.actions.useInBuild("B");
  assert.deepEqual(ok.log, [["selectQuestion", "urgent"], ["setSignal", "top_probability"], ["setBound", "lower"], ["setFirst", "B"],
    ["setCascadeThreshold", 0.46], ["labelDisagreements"], ["useInBuild", 1]]);

  const refuse = (ctx, run, message) => {
    assert.throws(run, message);
    assert.deepEqual(ctx.log, [], "a refused action never reaches the page");
  };
  const ctx = sampleCompareRowsCtx();
  refuse(ctx, () => ctx.actions.selectQuestion("rush"), /not a question both variants ask/);
  refuse(ctx, () => ctx.actions.selectQuestion("allergy"), /not a question both variants ask/);
  refuse(ctx, () => ctx.actions.setSignal("margin"), /confidence or top_probability/);
  refuse(ctx, () => ctx.actions.setBound("upper"), /estimate/);
  refuse(ctx, () => ctx.actions.setFirst("C"), /A or B/);
  refuse(ctx, () => ctx.actions.setCascadeThreshold(1.5), /from 0 to 1/);
  refuse(ctx, () => ctx.actions.setCascadeThreshold("0.5"), /from 0 to 1/);
  refuse(ctx, () => ctx.actions.useInBuild(0), /A or B/);
  const running = sampleCompareRowsCtx({ running: true });
  for (const run of [() => running.actions.selectQuestion("urgent"), () => running.actions.setSignal("confidence"), () => running.actions.labelDisagreements(),
    () => running.actions.useInBuild("A"), () => running.actions.setFirst("A")]) refuse(running, run, /Wait for the current Compare run/);
  const none = sampleCompareRowsCtx({ result: null });
  refuse(none, () => none.actions.selectQuestion("department"), /Run both variants first/);
  const noul = sampleCompareRowsCtx({ qid: "urgent" });
  refuse(noul, () => noul.actions.setFirst("B"), /no cascade/);
  refuse(noul, () => noul.actions.setCascadeThreshold(0.5), /no cascade/);
  const box = sampleCompareRowsCtx({ qid: "spot" });
  refuse(box, () => box.actions.labelDisagreements(), /Choice, Noul and Score/);
  const agree = sampleCompareRowsCtx({ report: { ...COMPARE_REPORTS.urgent, disagreements: [] }, qid: "urgent" });
  refuse(agree, () => agree.actions.labelDisagreements(), /nothing to label/);
  const busy = sampleCompareRowsCtx({ labeling: true });
  refuse(busy, () => busy.actions.labelDisagreements(), /already being prepared/);
  assert.throws(() => compareRowsCtx({ result: COMPARE_RESULT, report: COMPARE_REPORTS.department, qid: "department" }).actions.useInBuild("A"), /cannot do that here/);
});

test("rows: there is no action that edits, adds or replays rows", () => {
  const actions = Object.keys(sampleCompareRowsCtx().actions);
  assert.ok(!actions.includes("replaceItems") && !actions.includes("importItems"));
});

// ---------- workbench.compare.variants: builder ----------

test("variants: one item per question id, A's order then B-only ids, with positions", () => {
  const ctx = sampleCompareVariantsCtx();
  assert.deepEqual(ctx.items().map((item) => [item.qid, item.ia, item.ib, item.comparable]), [["department", 0, 1, true], ["urgent", 1, 0, true],
    ["tone", 2, 2, true], ["drink", 3, 3, true], ["spot", 4, 4, true], ["rush", 5, 5, false], ["allergy", 6, null, false], ["refund", null, 6, false]]);
  for (const item of ctx.items()) assert.deepEqual(Object.keys(item), ["qid", "a", "b", "ia", "ib", "comparable"]);
  assert.deepEqual(ctx.items()[0].a, QUESTIONS_A.department);
  assert.equal(ctx.items()[6].b, null);
  assert.equal(ctx.itemName(ctx.items()[2], 2), "tone");
  assert.equal(ctx.items(), ctx.items());
  assert.deepEqual(sampleCompareVariantsCtx({ hide: ["tone", "rush"], order: ["refund"] }).shown().map((item) => item.qid),
    ["refund", "department", "urgent", "drink", "spot", "allergy"]);
});

test("variants: an editor that does not parse contributes nothing and shows the page's message", () => {
  const ctx = sampleCompareVariantsCtx({ texts: [VARIANT_TEXTS[0], '{"a": {"type": "noul"}, "a": {"type": "noul"}}'] });
  assert.deepEqual(ctx.items().map((item) => item.qid), Object.keys(QUESTIONS_A));
  assert.ok(ctx.items().every((item) => item.b === null));
  assert.match(ctx.data.variants[1].error, /^Variant B: invalid JSON/);
  assert.equal(ctx.data.variants[1].count, null);
  assert.equal(sampleCompareVariantsCtx({ texts: ["  ", "[]"] }).data.variants.map((variant) => variant.error).join(" | "),
    "Variant A has no questions | Variant B: questions must be an object keyed by question id");
  const proto = sampleCompareVariantsCtx({ texts: ['{"__proto__": {"type": "noul", "instructions": "x"}}', '{"__proto__": {"type": "noul", "instructions": "y"}}'] });
  assert.deepEqual(proto.items().map((item) => [item.qid, item.comparable]), [["__proto__", true]]);
});

test("variants: data holds the editors' configuration and label-free counts only", () => {
  const data = sampleCompareVariantsCtx({ perturb: "typos", average: true, rowCount: 260 }).data;
  assert.deepEqual(data.variants.map(({ name, model, perturb, average, error, count }) => ({ name, model, perturb, average, error, count })),
    [{ name: "A", model: "", perturb: "", average: false, error: null, count: 7 }, { name: "B", model: "jev-1.14.0", perturb: "typos", average: true, error: null, count: 7 }]);
  assert.deepEqual(data.rows, { count: 260, sent: 200 });
  assert.equal(data.current_model, "jev-latest");
  assert.deepEqual(data.models, ["jev-1.14.0", "jev-latest"]);
  assert.equal(data.perturbs.typos, "with typos");
  assert.equal(data.last_run, null);
  const last = sampleCompareVariantsCtx({ lastRun: COMPARE_RESULT.variants }).data.last_run;
  assert.deepEqual(Object.keys(last[1]), ["name", "model", "perturb", "average_orders", "questions"]);
  assert.ok(!JSON.stringify(last).includes("cost_usd"), "no measurements or answers");
});

test("variants: replaceItems writes both editors through the page's edit path and keeps unchanged text", () => {
  const ctx = sampleCompareVariantsCtx();
  const next = ctx.items().filter((item) => item.qid !== "refund").map((item) => (item.qid === "tone" ? { ...item, b: { ...item.b, instructions: "Upset?" } } : item));
  ctx.actions.replaceItems([next[1], ...next.filter((_, index) => index !== 1)], { label: "test" });
  assert.deepEqual(ctx.log.map(([name, index]) => [name, index]), [["setQuestions", 0], ["setQuestions", 1]]);
  assert.deepEqual(Object.keys(JSON.parse(ctx.state.variants[0].text)), ["urgent", "department", "tone", "drink", "spot", "rush", "allergy"], "A follows the list order");
  assert.deepEqual(Object.keys(JSON.parse(ctx.state.variants[1].text)), ["urgent", "department", "tone", "drink", "spot", "rush"], "B follows ib");
  assert.equal(JSON.parse(ctx.state.variants[1].text).tone.instructions, "Upset?");

  const same = sampleCompareVariantsCtx();
  same.actions.replaceItems(same.items());
  assert.deepEqual(same.log, [], "an unchanged list writes nothing");
  const moved = sampleCompareVariantsCtx();
  moved.actions.replaceItems(moved.items().map((item) => (item.qid === "refund" ? { ...item, ib: -1 } : item)));
  assert.deepEqual(moved.log.map(([name, index]) => [name, index]), [["setQuestions", 1]], "only B changed");
  assert.equal(Object.keys(JSON.parse(moved.state.variants[1].text))[0], "refund");
});

test("variants: replaceItems and importItems reject invalid lists and leave the editors alone", () => {
  const cases = [
    [(items) => [...items, { ...items[0] }], /appears twice/],
    [(items) => [...items, { qid: "  ", a: { type: "noul" }, b: null }], /nonblank id/],
    [(items) => [...items, { qid: "x", a: { type: "rating" }, b: null }], /type of noul, choice, score or box/],
    [(items) => [...items, { qid: "x", a: null, b: "free text" }], /must be an object/],
    [(items) => items.map((item) => ({ ...item, b: null })), /Variant B would have no questions/],
    [(items) => items.map((item) => ({ ...item, a: null })), /Variant A would have no questions/],
    [() => "not a list", /list of questions/],
  ];
  for (const [make, message] of cases) {
    const ctx = sampleCompareVariantsCtx();
    assert.throws(() => ctx.actions.replaceItems(make(ctx.items())), message);
    assert.deepEqual(ctx.log, []);
    assert.equal(ctx.state.variants[0].text, VARIANT_TEXTS[0]);
  }
  const broken = sampleCompareVariantsCtx({ texts: [VARIANT_TEXTS[0], "{ oops"] });
  assert.throws(() => broken.actions.replaceItems(broken.items()), /Variant B: invalid JSON.*Fix that editor/);
  const running = sampleCompareVariantsCtx({ running: true });
  assert.throws(() => running.actions.replaceItems(running.items()), /Wait for the current Compare run/);

  const ctx = sampleCompareVariantsCtx();
  assert.throws(() => ctx.actions.importItems([{ qid: "tone", a: null, b: { type: "noul" } }]), /already in a variant/);
  assert.throws(() => ctx.actions.importItems([]), /nothing to add/);
  assert.deepEqual(ctx.log, []);
  ctx.actions.importItems([{ qid: "gift", a: { type: "noul", instructions: "Gift?" }, b: null, ia: null, ib: null }]);
  assert.deepEqual(Object.keys(JSON.parse(ctx.state.variants[0].text)).at(-1), "gift");
});

test("variants: the editors' buttons keep their guards, and no action presses Run", () => {
  const ok = sampleCompareVariantsCtx();
  assert.equal("run" in ok.actions, false, "a Compare run (paid) stays the page's own Run button");
  ok.actions.copyAToB();
  ok.actions.reverseA();
  ok.actions.averageA();
  ok.actions.fill("B", "terse");
  ok.actions.setModel("A", " jev-1.14.0 ");
  ok.actions.setRows("shuffle");
  ok.actions.setAsk(true);
  assert.deepEqual(ok.log, [["copyAToB"], ["reverseA"], ["averageA"], ["fill", 1, "terse"], ["setModel", 0, "jev-1.14.0"], ["setRows", "shuffle"], ["setAsk", true]]);

  const plain = sampleCompareVariantsCtx({ texts: ['{"tone": {"type": "score", "criteria": ["Low", "High"]}, "pick": {"type": "choice", "criteria": {"1": "One", "2": "Two"}}}', VARIANT_TEXTS[1]] });
  assert.throws(() => plain.actions.reverseA(), /no Choice question whose options can be reordered/);
  const single = sampleCompareVariantsCtx({ texts: ['{"pick": {"type": "choice", "criteria": {"only": "One"}}}', VARIANT_TEXTS[1]] });
  assert.throws(() => single.actions.averageA(), /two or more options/);
  const broken = sampleCompareVariantsCtx({ texts: ["{ oops", VARIANT_TEXTS[1]] });
  assert.throws(() => broken.actions.reverseA(), /Variant A: invalid JSON/);
  const ctx = sampleCompareVariantsCtx();
  assert.throws(() => ctx.actions.fill("C", "sample"), /A or B/);
  assert.throws(() => ctx.actions.fill("A", "examples"), /build, sample or terse/);
  assert.throws(() => ctx.actions.setModel("A", 7), /text/);
  assert.throws(() => ctx.actions.setRows("uppercase"), /B's rows are/);
  assert.throws(() => ctx.actions.setAsk("yes"), /both orders/);
  assert.deepEqual([...plain.log, ...single.log, ...broken.log, ...ctx.log], []);
  const running = sampleCompareVariantsCtx({ running: true });
  for (const name of ["copyAToB", "reverseA", "averageA"]) assert.throws(() => running.actions[name](), /Wait for the current Compare run/);
  assert.deepEqual(running.log, []);
});

// ---------- the hooks in static/js/workbench-compare.js ----------

const source = readFileSync(new URL("../../../static/js/workbench-compare.js", import.meta.url), "utf8");
const body = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const HOOKS = ["renderCompareRows", "cmpShownDisagreements", "cmpRowsTitle", "cmpRowsReset", "cmpRowsList", "refreshCmpRows", "resetCmpRowsLab",
  "cmpLabSection", "cmpLabRows", "cmpLabVariants"];

// The page's rows panel, rebuilt from source with DOM stand-ins. W.lab is a real Lab host (or none).
function rowsPage(lab) {
  const dom = fakeDom();
  let tree = null;
  const byId = (id) => find(tree, (node) => node.attrs?.id === id);
  const $ = (selector) => {
    const id = selector.match(/^#([\w-]+)$/)?.[1];
    if (id) return byId(id);
    const surface = selector.match(/data-lab-surface="([^"]+)"/)?.[1];
    const node = find(tree, (entry) => entry.attrs?.["data-lab-surface"] === surface);
    return node ? { replaceWith: (next) => Object.assign(node, next) } : null;
  };
  const mount = (target, ...children) => dom.mount(typeof target === "string" ? $(target) : target, ...children);
  const calls = [];
  const W = { compare: { result: COMPARE_RESULT, report: COMPARE_REPORTS.department, qid: "department", signal: "confidence", bound: "estimate", first: "A",
    cascadeT: 0.37, slices: null, slicesError: null, reportError: null, running: false, labelingBusy: false, variants: [{ text: VARIANT_TEXTS[0], model: "" },
      { text: VARIANT_TEXTS[1], model: "", perturb: "", average: false }] }, bulk: { rowsText: "a\nb" }, lab, labEnv: fakeEnv() };
  const make = new Function("W", "h", "icon", "statusBadge", "rowText", "sentText", "mount", "$", "rescoreCompare", "render", "updateCascade",
    "handoffCompareDisagreements", "cmpUseInBuild", "currentStatus", "countRows", "cmpCopyA", "reverseA", "averageA", "cmpFill", "runCompare", "refreshCmpVariants",
    `${HOOKS.map(body).join("\n")}\nreturn { ${HOOKS.join(", ")} };`);
  const fns = make(W, dom.h, (name) => dom.h("i", { class: name }), (kind, text) => dom.h("span", { class: `badge ${kind}` }, text),
    (row) => (typeof row === "string" ? row : JSON.stringify(row)), () => null, mount, $, async () => { calls.push("rescore"); }, () => calls.push("render"),
    () => calls.push("updateCascade"), () => calls.push("handoff"), (i) => calls.push(`use ${i}`), () => ({ model: "jev-latest" }), (text) => text.split("\n").length,
    () => calls.push("copyA"), () => calls.push("reverseA"), () => calls.push("averageA"), (i, from) => calls.push(`fill ${i} ${from}`), () => calls.push("run"),
    () => calls.push("refreshVariants"));
  const render = () => { tree = fns.renderCompareRows(); return tree; };
  const listed = () => findAll(byId("cmp-rows-list"), (node) => node.tag === "tr").slice(1).map((row) => textOf(row.children[0]));
  return { W, fns, render, listed, byId, calls, get tree() { return tree; } };
}

const labWith = (packs, builders = { compareRowsCtx, compareVariantsCtx }) => createLab(packs, builders);

test("hook: without Lab, or before the builders exist, the table lists every disagreement as before", () => {
  for (const lab of [undefined, labWith([rowsPack], {})]) {
    const page = rowsPage(lab);
    page.render();
    assert.deepEqual(page.listed(), ["1", "2", "4", "6"]);
    assert.equal(textOf(page.byId("cmp-rows-title")), "Rows where A and B answer “department” differently · 4");
    assert.equal(find(page.tree, (node) => node.attrs?.["data-lab-surface"]), null, "no Lab section");
    assert.equal(textOf(page.byId("cmp-rows-reset")), "");
  }
});

test("hook: with packs but no Lab setting active, the table is unchanged and the Lab section sits below it", () => {
  const page = rowsPage(labWith([rowsPack]));
  page.render();
  assert.deepEqual(page.listed(), ["1", "2", "4", "6"]);
  assert.equal(textOf(page.byId("cmp-rows-title")), "Rows where A and B answer “department” differently · 4");
  assert.ok(find(page.tree, (node) => node.attrs?.["data-lab-surface"] === ROWS));
  assert.deepEqual(page.W.lab.mountedIds(), [ROWS], "the section mounts the ctx for commands");
});

test("hook: Lab filters and sort pick and order the listed rows, the count reads shown of all, and reset restores", () => {
  const lab = labWith([rowsPack]);
  const page = rowsPage(lab);
  lab.view(ROWS).filters = [{ key: "wb-compare-rows/signal_a", op: "min", value: "0.5" }];
  page.render();
  assert.deepEqual(page.listed(), ["1", "4"], "A's signal 0.60 and 0.85");
  assert.equal(textOf(page.byId("cmp-rows-title")), "Rows where A and B answer “department” differently · 2 of 4");
  lab.view(ROWS).sort = { key: "wb-compare-rows/signal_a", dir: "desc" };
  page.fns.refreshCmpRows();
  assert.deepEqual(page.listed(), ["4", "1"], "Lab's sort applies last");
  lab.view(ROWS).filters = [{ key: "wb-compare-rows/signal_a", op: "min", value: "0.99" }];
  page.fns.refreshCmpRows();
  assert.equal(textOf(page.byId("cmp-rows-list")), "No disagreement matches the Lab filters.");
  const reset = find(page.byId("cmp-rows-reset"), (node) => node.tag === "button");
  assert.equal(textOf(reset), "Show every disagreement");
  reset.attrs.onclick();
  assert.equal(lab.active(ROWS), 0);
  assert.deepEqual(page.listed(), ["1", "2", "4", "6"]);
  assert.equal(textOf(page.byId("cmp-rows-title")), "Rows where A and B answer “department” differently · 4");
});

test("hook: the labeling handoff still sends every disagreement, whatever Lab shows", () => {
  assert.match(body("handoffCompareDisagreements"), /indices: report\.disagreements\.map\(\(item\) => item\.index\)/);
  const lab = labWith([rowsPack]);
  const page = rowsPage(lab);
  lab.view(ROWS).filters = [{ key: "wb-compare-rows/labeled", op: "without", value: "" }];
  page.render();
  assert.deepEqual(page.listed(), ["4"]);
  const button = find(page.tree, (node) => node.tag === "button" && textOf(node) === "Label missing disagreement inputs");
  assert.equal(button.attrs.disabled, false);
});

test("hook: the rows ctx reaches the page's own operations", async () => {
  const page = rowsPage(labWith([rowsPack]));
  const ctx = page.fns.cmpLabRows();
  await ctx.actions.selectQuestion("urgent");
  assert.equal(page.W.compare.qid, "urgent");
  page.W.compare.qid = "department";
  await ctx.actions.setBound("lower");
  assert.deepEqual([page.W.compare.bound, page.W.compare.cascadeT], ["lower", 0.37]);
  ctx.actions.setCascadeThreshold(0.5);
  assert.equal(page.W.compare.cascadeT, 0.5);
  ctx.actions.labelDisagreements();
  ctx.actions.useInBuild("A");
  assert.deepEqual(page.calls, ["rescore", "render", "rescore", "render", "updateCascade", "handoff", "use 0"]);
});

test("hook: the variants ctx edits the editors' JSON and refreshes them, and never reaches runCompare", () => {
  const page = rowsPage(labWith([variantsPack]));
  const ctx = page.fns.cmpLabVariants();
  assert.equal(ctx.items().length, 8);
  ctx.actions.replaceItems(ctx.items().filter((item) => item.qid !== "refund"));
  assert.ok(!("refund" in JSON.parse(page.W.compare.variants[1].text)));
  assert.equal(page.W.compare.variants[0].text, VARIANT_TEXTS[0], "A is untouched");
  ctx.refresh();
  ctx.actions.copyAToB();
  assert.equal("run" in ctx.actions, false);
  assert.deepEqual(page.calls, ["refreshVariants", "copyA"]);
  page.W.compare.running = true;
  assert.throws(() => ctx.actions.copyAToB(), /Wait for the current Compare run/);
  assert.equal(rowsPage(labWith([variantsPack], {})).fns.cmpLabVariants(), null);
  assert.equal(rowsPage(undefined).fns.cmpLabSection(VARIANTS, null), null);
});

test("hook: the page reaches Lab only through W", () => {
  for (const name of HOOKS) assert.ok(!/\bLAB\b/.test(body(name)), `${name} must not name LAB`);
  assert.ok(!/^import[^;]*lab\//m.test(source), "workbench-compare.js imports no Lab module");
  assert.match(source, /cmpLabSection\("workbench\.compare\.variants", cmpLabVariants\(\)\)/);
});
