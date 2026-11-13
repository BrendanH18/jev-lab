// Tests of the Lab surfaces of the Workbench analysis panels (static/js/lab/surfaces/workbench-analysis.js) and of
// their hooks in static/js/workbench-calibrate.js, workbench-policy.js and workbench-costs.js. The hooks are rebuilt
// from the page source, as tests/js/build-refinements.test.mjs does, and run against a real Lab host. No browser, no
// server, no model.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { calibrateCtx, costsCtx, policyCtx } from "../../../static/js/lab/surfaces/workbench-analysis.js";
import calibratePack from "../../../static/js/lab/packs/workbench/wb-calibrate-rows.js";
import policyPack from "../../../static/js/lab/packs/workbench/wb-policy-rows.js";
import costsPack from "../../../static/js/lab/packs/workbench/wb-costs-mistakes.js";
import { workbenchSource } from "../workbench-source.mjs";
import { fakeEnv, textOf, findAll } from "./harness.mjs";
import { CAL_REPORTS, COSTS, POLICY_GATES, POLICY_REPORT, PRUNE_REPORT, RESULT, SETS_REPORT, sampleCalibrateCtx, sampleCostsCtx,
  samplePolicyCtx } from "./fixtures/workbench-analysis.mjs";

const body = (name) => workbenchSource.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------- workbench.calibrate ----------

test("calibrate: one frozen item per scored row, joined to the run and the answer sets", () => {
  const ctx = sampleCalibrateCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.index), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Object.keys(items[1]), ["index", "number", "text", "row", "image", "type", "label", "predicted", "correct", "signal", "top", "answer", "set"]);
  assert.deepEqual(items[1].row, { text: "Where is wholesale order HC-2231?", channel: "email", _image: "receipt.png" });
  assert.equal(items[1].image, "receipt.png");
  assert.equal(items[0].text, "My espresso grinder arrived cracked, I want a refund today.");
  assert.deepEqual(items[5].set, { options: ["billing", "shipping"], size: 2, covered: true, route: "review", probabilities: { billing: 0.4, shipping: 0.3 } });
  assert.equal(items[5].answer.confidence, undefined, "row 6's answer has no confidence field");
  assert.ok(Object.isFrozen(items) && Object.isFrozen(items[0]) && Object.isFrozen(items[0].answer));
  assert.equal(ctx.items(), items, "the same objects until the list changes");
  assert.equal(ctx.itemName(items[2], 0), "#3");
  assert.equal(JSON.stringify(items), JSON.stringify(clone(items)), "items are plain JSON");
});

test("calibrate: held-out rows never become items, even when a stale report names one", () => {
  const report = clone(CAL_REPORTS.department);
  report.rows.push({ index: 7, label: "billing", predicted: "billing", correct: true, signal: 0.96, top: 0.97 });
  const ctx = sampleCalibrateCtx({ report });
  assert.ok(!ctx.items().some((item) => item.index === 7));
  assert.ok(!JSON.stringify(ctx.items()).includes("kettle"));
  assert.deepEqual(ctx.data.run, { rows: 10, answered: 8, held_out: 1 });
});

test("calibrate: answer sets attach only for a fitted report of the same type", () => {
  assert.equal(sampleCalibrateCtx({ sets: { ...clone(SETS_REPORT), cut: null } }).items()[1].set, null);
  assert.equal(sampleCalibrateCtx({ qid: "urgent", sets: SETS_REPORT }).items()[1].set, null, "a Choice fit does not attach to a Noul question");
});

test("calibrate: shown() honors Lab filters and sort, and data reads the page now", () => {
  const ctx = sampleCalibrateCtx({ hide: [1, 4], order: [6, 0] });
  assert.deepEqual(ctx.shown().map((item) => item.index), [6, 0, 2, 3, 5]);
  assert.equal(ctx.data.threshold, 0.5);
  assert.deepEqual(ctx.data.at, CAL_REPORTS.department.sweep[50]);
  ctx.state.threshold = 0.934;
  assert.equal(ctx.data.threshold, 0.93);
  assert.equal(ctx.data.at.automated, 1);
  assert.deepEqual(ctx.data.questions.map((q) => [q.qid, q.type, q.labeled]), [["department", "choice", true], ["urgent", "noul", true], ["tone", "score", true], ["spot", "box", true]]);
  assert.equal(ctx.data.signals[9], 0.4, "unlabeled answered rows keep their signal");
  assert.equal(ctx.data.cost.best.gates.department, 0.21);
  assert.equal(ctx.data.slices.field, "channel");
  assert.equal(ctx.data.sets.cut, 0.3);
});

test("calibrate: empty before a run, while rescoring and without labels", () => {
  for (const ctx of [sampleCalibrateCtx({ result: null }), sampleCalibrateCtx({ report: null }), sampleCalibrateCtx({ qid: null })]) {
    assert.deepEqual(ctx.items(), []);
    assert.deepEqual(ctx.shown(), []);
    assert.equal(ctx.data.report, null);
    assert.equal(ctx.data.at, null);
    assert.equal(ctx.data.cost, null);
    assert.deepEqual(ctx.data.signals, {});
  }
  const none = sampleCalibrateCtx({ result: null });
  assert.equal(none.data.qid, null);
  assert.deepEqual(none.data.questions, []);
  assert.equal(none.data.run, null);
  assert.equal(none.data.holdout, null);
});

test("calibrate: every action applies its guard before the page acts", async () => {
  const ctx = sampleCalibrateCtx();
  assert.equal(ctx.actions.setThreshold(0.734), 0.73);
  assert.equal(ctx.state.threshold, 0.73);
  for (const bad of [-0.1, 1.2, "0.5", NaN]) assert.throws(() => ctx.actions.setThreshold(bad), /number from 0 to 1/);
  assert.throws(() => sampleCalibrateCtx({ report: null }).actions.setThreshold(0.5), /no labeled Calibrate report/);
  assert.throws(() => ctx.actions.selectQuestion("refund"), /not a question this run answered/);
  ctx.actions.selectQuestion("tone");
  assert.throws(() => ctx.actions.setSignal("probability"), /confidence or top_probability/);
  ctx.actions.setSignal("top_probability");
  assert.throws(() => ctx.actions.setBound("upper"), /estimate/);
  ctx.actions.setBound("lower");
  assert.throws(() => ctx.actions.setCoverage(0.5), /80%, 90%, 95% or 99%/);
  ctx.actions.setCoverage(0.95);
  assert.throws(() => sampleCalibrateCtx({ qid: "spot" }).actions.setCoverage(0.9), /Choice, Noul or Score/);
  ctx.actions.checkUnseen();
  assert.throws(() => sampleCalibrateCtx({ qid: "spot" }).actions.checkUnseen(), /Choice, Noul or Score/);
  assert.throws(() => sampleCalibrateCtx({ holdout: { running: true } }).actions.checkUnseen(), /already running/);
  assert.throws(() => sampleCalibrateCtx({ holdoutReady: false }).actions.checkUnseen(), /Open the Bulk tab/);
  assert.throws(() => sampleCalibrateCtx({ result: null }).actions.selectQuestion("department"), /Run the rows in Bulk first/);
  assert.deepEqual(ctx.log, [["setThreshold", 0.73], ["selectQuestion", "tone"], ["setSignal", "top_probability"], ["setBound", "lower"],
    ["setCoverage", 0.95], ["checkUnseen"]]);
  assert.equal(ctx.actions.replaceItems, undefined, "the rows are model answers: read-only");
  assert.equal(ctx.actions.importItems, undefined);
});

// ---------- workbench.policy ----------

test("policy: one item per scored row with its outcome; test rows never appear", () => {
  const ctx = samplePolicyCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => [item.index, item.outcome]), [[0, "right"], [1, "review"], [2, "right"], [3, "wrong"], [4, "review"], [5, "review"], [6, "right"]]);
  assert.deepEqual(Object.keys(items[1]), ["index", "number", "text", "row", "image", "outcome", "automated", "correct", "held", "wrong", "rules", "answers"]);
  assert.deepEqual(items[1].answers, { department: { answer: "wholesale", label: "shipping", signal: 0.12 }, urgent: { answer: "no", label: "no", signal: 0.4 } });
  assert.deepEqual(items[1].rules, [1]);
  const report = clone(POLICY_REPORT);
  report.rows.push({ ...clone(report.rows[0]), index: 7 });
  assert.ok(!samplePolicyCtx({ report }).items().some((item) => item.index === 7));
  assert.deepEqual(samplePolicyCtx({ hide: [0], order: [5] }).shown().map((item) => item.index), [5, 1, 2, 3, 4, 6]);
});

test("policy: data mirrors the gates, and the list is empty with no gate checked", () => {
  const ctx = samplePolicyCtx();
  assert.deepEqual(ctx.data.active, { department: 0.5, urgent: 0.3 });
  assert.deepEqual(ctx.data.questions.map((q) => [q.qid, q.on, q.t]), [["department", true, 0.5], ["urgent", true, 0.3], ["tone", false, 0.5]]);
  assert.equal(ctx.data.rules.in_force, "if department = wholesale then urgent = yes");
  assert.equal(ctx.data.max_gates, 10);
  assert.equal(ctx.data.prune.report, null);
  const pruned = samplePolicyCtx({ prune: { target: 0.95, running: false, report: PRUNE_REPORT } });
  assert.deepEqual(pruned.data.prune.report.gated.map((g) => g.holds_back_nothing), [true, false], "prune.js holdsBackNothing, added here");
  const off = samplePolicyCtx({ gates: { department: { on: false, t: 0.5 }, urgent: { on: false, t: 0.3 }, tone: { on: false, t: 0.5 } } });
  assert.deepEqual(off.items(), []);
  assert.equal(off.data.report, null);
  assert.equal(off.data.cheapest, null);
  const none = samplePolicyCtx({ result: null });
  assert.deepEqual(none.items(), []);
  assert.deepEqual(none.data.gates, {});
  assert.equal(none.data.run, null);
});

test("policy: actions refuse what the page's controls would not allow", () => {
  const ctx = samplePolicyCtx();
  ctx.actions.setThreshold("urgent", 0.456);
  assert.throws(() => ctx.actions.setThreshold("tone", 0.5), /not a checked gate/);
  assert.throws(() => ctx.actions.setThresholds({}), /at least one checked gate/);
  assert.throws(() => ctx.actions.setThresholds({ department: 2 }), /number from 0 to 1/);
  ctx.actions.setThresholds({ department: 0.6, urgent: 0.35 });
  assert.throws(() => ctx.actions.setGate("spot", true), /not a Choice, Noul or Score question/);
  assert.throws(() => ctx.actions.setGate("department", true), /already checked/);
  ctx.actions.setGate("tone", true);
  ctx.actions.setGate("department", false);
  const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i}`, { on: i < 10, t: 0.5 }]));
  const answers = Object.fromEntries(Object.keys(many).map((q) => [q, { type: "noul", noul: 0.5 }]));
  const wide = samplePolicyCtx({ result: { results: [{ index: 0, row: "x", answers }] }, gates: many, report: null });
  assert.throws(() => wide.actions.setGate("q10", true), /At most 10 gates/);
  assert.throws(() => ctx.actions.setSignal("p"), /confidence or top_probability/);
  ctx.actions.setBound("lower");
  ctx.actions.checkUnseen();
  assert.throws(() => samplePolicyCtx({ holdout: { running: true } }).actions.checkUnseen(), /already running/);
  ctx.actions.checkGates();
  assert.throws(() => samplePolicyCtx({ requestReady: false }).actions.checkGates(), /questions that run asked/);
  assert.throws(() => samplePolicyCtx({ prune: { running: true } }).actions.checkGates(), /already running/);
  ctx.actions.exportGate();
  const off = samplePolicyCtx({ gates: { department: { on: false, t: 0.5 }, urgent: { on: false, t: 0.3 }, tone: { on: false, t: 0.5 } } });
  for (const name of ["checkUnseen", "checkGates", "exportGate"]) assert.throws(() => off.actions[name](), /Check at least one question/);
  assert.deepEqual(ctx.log, [["setThresholds", { urgent: 0.46 }], ["setThresholds", { department: 0.6, urgent: 0.35 }], ["setGate", "tone", true],
    ["setGate", "department", false], ["setBound", "lower"], ["checkUnseen"], ["checkGates"], ["exportGate"]]);
  assert.equal(ctx.actions.replaceItems, undefined);
});

// ---------- workbench.costs ----------

test("costs: items are the priced mistakes as typed; data mirrors the page's prices", () => {
  const ctx = sampleCostsCtx();
  assert.deepEqual(ctx.items(), COSTS.mistakes);
  assert.equal(ctx.items(), ctx.items());
  assert.equal(ctx.itemName(ctx.items()[2], 0), "mistake 3");
  assert.equal(ctx.data.break_even, 0.9);
  assert.equal(ctx.data.problem, null);
  assert.equal(ctx.data.prices.mistakes[2].cost, 35.5);
  assert.deepEqual(ctx.data.questions.map((q) => [q.qid, q.classes]), [["department", ["billing", "shipping", "wholesale", "other"]], ["urgent", ["yes", "no"]], ["tone", ["0", "1", "2"]]]);
  assert.deepEqual(ctx.data.policy.active, { department: 0.5, urgent: 0.3 });
  assert.equal(ctx.data.calibrate.qid, "department");
  const bad = sampleCostsCtx({ costs: { ...clone(COSTS), error: "free" } });
  assert.equal(bad.data.prices, null);
  assert.equal(bad.data.break_even, null);
  assert.match(bad.data.problem, /number from 0 to 1,000,000/);
  assert.deepEqual(sampleCostsCtx({ hide: [0], order: [2] }).shown().map((m) => m.question), ["tone", "urgent"]);
});

test("costs: replaceItems keeps every invariant and writes through the page", () => {
  const ctx = sampleCostsCtx();
  const items = ctx.items().map((m) => ({ ...m }));
  const rejects = [
    ["not a list", /list of priced mistakes/],
    [Array.from({ length: 101 }, () => items[0]), /At most 100/],
    [[{ ...items[0], question: "spot" }], /not a Choice, Noul or Score question/],
    [[{ ...items[0], label: "cafe" }], /“cafe” is not an option of department/],
    [[{ ...items[1], answer: "yes" }], /must differ from the label/],
    [[{ ...items[0], cost: "lots" }], /number from 0 to 1,000,000/],
    [[{ ...items[0], cost: 2e6 }], /number from 0 to 1,000,000/],
    [[items[0], { ...items[0], cost: "70" }], /Mistake 2: department labeled billing, answered shipping is priced twice/],
    [[items[0], 7], /Mistake 2 must be an object/],
  ];
  for (const [next, message] of rejects) assert.throws(() => ctx.actions.replaceItems(next), message);
  assert.deepEqual(ctx.log, [], "a refused edit writes nothing");
  assert.deepEqual(ctx.actions.replaceItems(items), { changed: false });
  assert.deepEqual(ctx.log, [], "an unchanged list writes nothing");
  assert.deepEqual(ctx.actions.replaceItems([{ ...items[2], cost: 12, extra: "dropped" }, items[0]], { label: "Order" }), { changed: true });
  assert.deepEqual(ctx.log, [["write", [{ question: "tone", label: "2", answer: "0", cost: "12" }, items[0]], "Order"]]);
  assert.deepEqual(ctx.items().map((m) => m.question), ["tone", "department"]);
  assert.throws(() => sampleCostsCtx({ result: null }).actions.replaceItems([]), /Run the rows in Bulk first/);
});

test("costs: importItems appends and refuses duplicates; setPrices validates", () => {
  const ctx = sampleCostsCtx();
  assert.throws(() => ctx.actions.importItems([]), /nothing to add/);
  assert.throws(() => ctx.actions.importItems([{ question: "urgent", label: "yes", answer: "no", cost: "5" }]), /priced twice/);
  ctx.actions.importItems([{ question: "urgent", label: "no", answer: "yes", cost: " 15 " }], { label: "CSV" });
  assert.deepEqual(ctx.items()[3], { question: "urgent", label: "no", answer: "yes", cost: "15" });
  assert.throws(() => ctx.actions.setPrices("-1", null), /review price must be a number/);
  assert.throws(() => ctx.actions.setPrices(null, "lots"), /mistake price must be a number/);
  ctx.actions.setPrices(3, null);
  assert.deepEqual(ctx.log.at(-1), ["setPrices", "3", "20"]);
  assert.equal(ctx.data.review, "3");
});

// ---------- the hooks in the page source ----------

const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) });
const statusBadge = (kind, label) => h("span", { class: `badge ${kind}` }, label || kind);

// A real Lab host with the starter packs and the builders, as the generated page index gives it.
function labHost() {
  return createLab([calibratePack, policyPack, costsPack], { calibrateCtx, policyCtx, costsCtx });
}

function calibrateHooks(W) {
  const names = ["calLab", "calLabRows", "calLabSetsRows", "calLabBlock"];
  return new Function("W", "$", "labeledQids", "attachedSetsPayload", "refreshCalLab", "updateCal", "recalibrate", "render", "refreshSets", "runHoldout",
    "h", "statusBadge", "SIGNALS", "resetCalLab",
    `const CAL_LAB = "workbench.calibrate"; const calLabCtxs = {}; ${names.map(body).join("\n")}; return { ${names.join(", ")} };`)(
    W, () => null, () => new Set(["department", "urgent", "tone", "spot"]), () => ({}), () => {}, () => {}, async () => {}, () => {}, async () => {}, async () => {},
    h, statusBadge, { confidence: "confidence", top_probability: "top probability" }, () => {});
}

function calibrateW(lab) {
  return { lab, labEnv: lab ? fakeEnv() : undefined,
    bulk: { result: RESULT, cal: { qid: "department", signal: "confidence", bound: "estimate", threshold: 0.5, report: CAL_REPORTS.department, cost: null, holdout: null },
      sets: { coverage: 0.9, report: SETS_REPORT, attached: {} }, slice: { cal: null } } };
}

test("hook: without Lab every Calibrate list is exactly as before and nothing renders", () => {
  const hooks = calibrateHooks(calibrateW(undefined));
  const rows = SETS_REPORT.rows.filter((r) => r.size >= 2);
  assert.equal(hooks.calLabSetsRows(rows), rows, "the page's own list, untouched");
  assert.equal(hooks.calLab(), null);
  assert.equal(hooks.calLabRows(), null);
  assert.equal(hooks.calLabBlock(), null);
  const idle = calibrateHooks(calibrateW(labHost()));
  assert.equal(idle.calLabSetsRows(rows), rows, "a Lab host with no active filter changes nothing");
  assert.equal(idle.calLabRows(), null);
  assert.ok(idle.calLabBlock(), "the Lab section renders beside the panel");
});

test("hook: a Lab filter on Calibrate reaches its row list and the answer-set short list", () => {
  const lab = labHost();
  const W = calibrateW(lab);
  const hooks = calibrateHooks(W);
  const view = lab.view("workbench.calibrate");
  view.filters = [{ key: "wb-calibrate-rows/result", op: "is", value: "wrong" }];
  view.sort = { key: "wb-calibrate-rows/signal", dir: "desc" };
  const rows = SETS_REPORT.rows.filter((r) => r.size >= 2);
  // Wrong rows are #2 (signal .12) and #6 (.20); sorted by signal, highest first.
  assert.deepEqual(hooks.calLabSetsRows(rows).map((r) => r.index), [5, 1]);
  const list = hooks.calLabRows();
  assert.match(textOf(list), /Rows Lab shows · 2 of 7 scored rows · 2 Lab settings active/);
  assert.deepEqual(findAll(list, (node) => node.tag === "tr").slice(1).map((tr) => textOf(tr.children[0])), ["6", "2"]);
  view.filters = [{ key: "wb-calibrate-rows/label_outside_set", op: "with" }];
  assert.deepEqual(hooks.calLabSetsRows(rows), [], "every short list holds its row's label");
  // Row #2's list now misses its label: the answer-set fact reads the fit the page holds, and the short list follows.
  W.bulk.sets.report = { ...SETS_REPORT, rows: SETS_REPORT.rows.map((r) => (r.index === 1 ? { ...r, set: ["wholesale", "billing"], covered: false } : r)) };
  const missed = W.bulk.sets.report.rows.filter((r) => r.size >= 2);
  assert.deepEqual(hooks.calLabSetsRows(missed).map((r) => r.index), [1]);
  lab.reset("workbench.calibrate");
  assert.equal(hooks.calLabSetsRows(missed), missed);
});

function policyHooks(W) {
  const names = ["polLab", "polLabWrongRows", "polLabRows", "policyMistakes"];
  return new Function("W", "$", "labeledQids", "policyRules", "refreshPolLab", "rescorePolicy", "render", "repolicy", "clearHoldout", "clearPrune", "retunePolicy",
    "runHoldout", "activeGates", "runPrune", "exportGate", "gateModel", "attachedSetsPayload", "h", "statusBadge", "rowText",
    `const POL_LAB = "workbench.policy"; const polLabCtxs = {}; const POL_OUTCOMES = { right: ["pass", "Automated, right"], wrong: ["fail", "Automated, wrong"], review: ["review", "Sent to review"] };
     ${names.map(body).join("\n")}; return { ${names.join(", ")} };`)(
    W, () => null, () => new Set(["department", "urgent"]), () => "", () => {}, async () => {}, () => {}, async () => {}, () => {}, () => {}, async () => {},
    async () => {}, () => ({ department: 0.5, urgent: 0.3 }), async () => {}, async () => {}, () => "", () => undefined, h, statusBadge,
    (row) => (typeof row === "string" ? row : JSON.stringify(row)));
}

function policyW(lab) {
  return { lab, labEnv: lab ? fakeEnv() : undefined,
    bulk: { result: RESULT, ranQuestions: {}, policy: { signal: "confidence", bound: "estimate", gates: clone(POLICY_GATES), report: POLICY_REPORT, tunes: null,
      cost: null, cheapest: null, holdout: null, prune: { target: 0.95, running: false, report: null } },
    rules: { text: "", applied: "", hold: true, report: null, error: null }, slice: { pol: null } } };
}

test("hook: Policy's 'Automated but wrong' keeps its meaning and counts Lab filters like any other filter", () => {
  const plain = policyHooks(policyW(undefined));
  const before = plain.policyMistakes(POLICY_REPORT);
  assert.match(textOf(before), /^Automated but wrong · 1: your code would act/);
  assert.equal(plain.polLabRows(), null);
  const lab = labHost();
  const hooks = policyHooks(policyW(lab));
  assert.equal(textOf(hooks.policyMistakes(POLICY_REPORT)), textOf(before), "with no Lab setting active nothing changes");
  // Only row #2 carries a picture, so the automated-but-wrong row #4 is hidden.
  lab.view("workbench.policy").filters = [{ key: "wb-policy-rows/picture", op: "with" }];
  const filtered = hooks.policyMistakes(POLICY_REPORT);
  assert.match(textOf(filtered), /Automated but wrong · 0 of 1/);
  assert.match(textOf(filtered), /No automated-but-wrong row matches Policy's Lab filters/);
  assert.equal(findAll(filtered, (node) => node.tag === "table").length, 0);
  const shown = hooks.polLabRows();
  assert.match(textOf(shown), /Rows Lab shows · 1 of 7 scored rows · 1 Lab setting active/);
  assert.deepEqual(findAll(shown, (node) => node.tag === "tr").slice(1).map((tr) => textOf(tr.children[0])), ["2"]);
  lab.view("workbench.policy").filters = [{ key: "wb-policy-rows/outcome", op: "is", value: "automated, wrong" }];
  assert.match(textOf(hooks.policyMistakes(POLICY_REPORT)), /Automated but wrong · 1 of 1/);
});

function costsHooks(W) {
  const names = ["costsLab", "costsLabRows", "costsLabNote"];
  return new Function("W", "$", "costsPayload", "activeGates", "refreshCostsLab", "costsLabWrite", "mount", "costsBody", "h",
    `const COSTS_LAB = "workbench.costs"; const costsLabCtxs = {}; ${names.map(body).join("\n")}; return { ${names.join(", ")} };`)(
    W, () => null, () => ({ costs: null, problem: null }), () => ({}), () => {}, () => {}, () => {}, () => [], h);
}

test("hook: the priced-mistake rows keep their own index under Lab filters and sort", () => {
  const W = { lab: undefined, bulk: { result: RESULT, costs: clone(COSTS), cal: { qid: "department", threshold: 0.5, cost: null }, policy: { cost: null, cheapest: null } } };
  const rows = ["row 0", "row 1", "row 2"];
  assert.equal(costsHooks(W).costsLabRows(rows), rows);
  assert.equal(costsHooks(W).costsLabNote(), null);
  const lab = labHost();
  W.lab = lab;
  W.labEnv = fakeEnv();
  const hooks = costsHooks(W);
  assert.equal(hooks.costsLabRows(rows), rows);
  lab.view("workbench.costs").filters = [{ key: "wb-costs-mistakes/price", op: "min", value: "40" }];
  lab.view("workbench.costs").sort = { key: "wb-costs-mistakes/price", dir: "desc" };
  assert.deepEqual(hooks.costsLabRows(rows), ["row 1", "row 0"], "the $120 and $50 rows, highest first, each built for its own index");
  assert.match(textOf(hooks.costsLabNote()), /Lab shows 2 of 3 priced mistakes · 2 Lab settings active/);
});

test("hook: page code reaches Lab only through W", () => {
  for (const name of ["calLab", "calLabBlock", "calLabRows", "calLabSetsRows", "refreshCalLab", "polLab", "polLabBlock", "polLabRows", "polLabWrongRows",
    "refreshPolLab", "costsLab", "costsLabRows", "costsLabNote", "refreshCostsLab", "costsLabWrite"]) {
    const text = body(name);
    assert.ok(!/\bLAB\b/.test(text.replace(/[A-Z_]+_LAB\b/g, "")), `${name} must not name LAB directly`);
  }
});
