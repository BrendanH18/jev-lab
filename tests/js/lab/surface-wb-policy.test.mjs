// Tests of the Lab surface of Workbench Policy (static/js/lab/surfaces/workbench-analysis.js) and of its hooks in
// static/js/workbench-policy.js. The hooks are rebuilt from the page source, as tests/js/build-refinements.test.mjs
// does, and run against a real Lab host. No browser, no server, no model.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLab } from "../../../static/js/lab/host.js";
import { policyCtx } from "../../../static/js/lab/surfaces/workbench-analysis.js";
import { workbenchSource } from "../workbench-source.mjs";
import { probePack } from "./fixture-pack.mjs";
import { fakeEnv, textOf, findAll } from "./harness.mjs";
import { POLICY_GATES, POLICY_REPORT, PRUNE_REPORT, RESULT, samplePolicyCtx } from "./fixtures/workbench-analysis.mjs";

const body = (name) => workbenchSource.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const clone = (value) => JSON.parse(JSON.stringify(value));
const policyPack = probePack("policy-probe", "workbench.policy", {
  picture: ["flag", (item) => item.image !== null],
  outcome: ["category", (item) => item.outcome],
});

// ---------- workbench.policy ----------

test("policy: one item per scored row with its outcome; test rows never appear", () => {
  const ctx = samplePolicyCtx();
  const items = ctx.items();
  assert.deepEqual(
    items.map((item) => [item.index, item.outcome]),
    [
      [0, "right"],
      [1, "review"],
      [2, "right"],
      [3, "wrong"],
      [4, "review"],
      [5, "review"],
      [6, "right"],
    ],
  );
  assert.deepEqual(Object.keys(items[1]), [
    "index",
    "number",
    "text",
    "row",
    "image",
    "outcome",
    "automated",
    "correct",
    "held",
    "wrong",
    "rules",
    "answers",
  ]);
  assert.deepEqual(items[1].answers, {
    department: { answer: "wholesale", label: "shipping", signal: 0.12 },
    urgent: { answer: "no", label: "no", signal: 0.4 },
  });
  assert.deepEqual(items[1].rules, [1]);
  const report = clone(POLICY_REPORT);
  report.rows.push({ ...clone(report.rows[0]), index: 7 });
  assert.ok(
    !samplePolicyCtx({ report })
      .items()
      .some((item) => item.index === 7),
  );
  assert.deepEqual(
    samplePolicyCtx({ hide: [0], order: [5] })
      .shown()
      .map((item) => item.index),
    [5, 1, 2, 3, 4, 6],
  );
});

test("policy: data mirrors the gates, and the list is empty with no gate checked", () => {
  const ctx = samplePolicyCtx();
  assert.deepEqual(ctx.data.active, { department: 0.5, urgent: 0.3 });
  assert.deepEqual(
    ctx.data.questions.map((q) => [q.qid, q.on, q.t]),
    [
      ["department", true, 0.5],
      ["urgent", true, 0.3],
      ["tone", false, 0.5],
    ],
  );
  assert.equal(ctx.data.rules.in_force, "if department = wholesale then urgent = yes");
  assert.equal(ctx.data.max_gates, 10);
  assert.equal(ctx.data.prune.report, null);
  const pruned = samplePolicyCtx({ prune: { target: 0.95, running: false, report: PRUNE_REPORT } });
  assert.deepEqual(
    pruned.data.prune.report.gated.map((g) => g.holds_back_nothing),
    [true, false],
    "prune.js holdsBackNothing, added here",
  );
  const off = samplePolicyCtx({
    gates: { department: { on: false, t: 0.5 }, urgent: { on: false, t: 0.3 }, tone: { on: false, t: 0.5 } },
  });
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
  const off = samplePolicyCtx({
    gates: { department: { on: false, t: 0.5 }, urgent: { on: false, t: 0.3 }, tone: { on: false, t: 0.5 } },
  });
  for (const name of ["checkUnseen", "checkGates", "exportGate"])
    assert.throws(() => off.actions[name](), /Check at least one question/);
  assert.deepEqual(ctx.log, [
    ["setThresholds", { urgent: 0.46 }],
    ["setThresholds", { department: 0.6, urgent: 0.35 }],
    ["setGate", "tone", true],
    ["setGate", "department", false],
    ["setBound", "lower"],
    ["checkUnseen"],
    ["checkGates"],
    ["exportGate"],
  ]);
  assert.equal(ctx.actions.replaceItems, undefined);
});

// ---------- the hooks in the page source ----------

const h = (tag, attrs = {}, ...children) => ({
  tag,
  attrs: attrs || {},
  children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
});
const statusBadge = (kind, label) => h("span", { class: `badge ${kind}` }, label || kind);

// A real Lab host with the starter packs and the builders, as the generated page index gives it.
function labHost() {
  return createLab([policyPack], { policyCtx });
}

function policyHooks(W) {
  const names = ["polLab", "polLabWrongRows", "polLabRows", "policyMistakes"];
  return new Function(
    "W",
    "$",
    "labeledQids",
    "policyRules",
    "refreshPolLab",
    "rescorePolicy",
    "render",
    "repolicy",
    "clearHoldout",
    "clearPrune",
    "retunePolicy",
    "runHoldout",
    "activeGates",
    "runPrune",
    "exportGate",
    "gateModel",
    "attachedSetsPayload",
    "h",
    "statusBadge",
    "rowText",
    `const POL_LAB = "workbench.policy"; const polLabCtxs = {}; const POL_OUTCOMES = { right: ["pass", "Automated, right"], wrong: ["fail", "Automated, wrong"], review: ["review", "Sent to review"] };
     ${names.map(body).join("\n")}; return { ${names.join(", ")} };`,
  )(
    W,
    () => null,
    () => new Set(["department", "urgent"]),
    () => "",
    () => {},
    async () => {},
    () => {},
    async () => {},
    () => {},
    () => {},
    async () => {},
    async () => {},
    () => ({ department: 0.5, urgent: 0.3 }),
    async () => {},
    async () => {},
    () => "",
    () => undefined,
    h,
    statusBadge,
    (row) => (typeof row === "string" ? row : JSON.stringify(row)),
  );
}

function policyW(lab) {
  return {
    lab,
    labEnv: lab ? fakeEnv() : undefined,
    bulk: {
      result: RESULT,
      ranQuestions: {},
      policy: {
        signal: "confidence",
        bound: "estimate",
        gates: clone(POLICY_GATES),
        report: POLICY_REPORT,
        tunes: null,
        cost: null,
        cheapest: null,
        holdout: null,
        prune: { target: 0.95, running: false, report: null },
      },
      rules: { text: "", applied: "", hold: true, report: null, error: null },
      slice: { pol: null },
    },
  };
}

test("hook: Policy's 'Automated but wrong' keeps its meaning and counts Lab filters like any other filter", () => {
  const plain = policyHooks(policyW(undefined));
  const before = plain.policyMistakes(POLICY_REPORT);
  assert.match(textOf(before), /^Automated but wrong · 1: your code would act/);
  assert.equal(plain.polLabRows(), null);
  const lab = labHost();
  const hooks = policyHooks(policyW(lab));
  assert.equal(
    textOf(hooks.policyMistakes(POLICY_REPORT)),
    textOf(before),
    "with no Lab setting active nothing changes",
  );
  // Only row #2 carries a picture, so the automated-but-wrong row #4 is hidden.
  lab.view("workbench.policy").filters = [{ key: "policy-probe/picture", op: "with" }];
  const filtered = hooks.policyMistakes(POLICY_REPORT);
  assert.match(textOf(filtered), /Automated but wrong · 0 of 1/);
  assert.match(textOf(filtered), /No automated-but-wrong row matches Policy's Lab filters/);
  assert.equal(findAll(filtered, (node) => node.tag === "table").length, 0);
  const shown = hooks.polLabRows();
  assert.match(textOf(shown), /Rows Lab shows · 1 of 7 scored rows · 1 Lab setting active/);
  assert.deepEqual(
    findAll(shown, (node) => node.tag === "tr")
      .slice(1)
      .map((tr) => textOf(tr.children[0])),
    ["2"],
  );
  lab.view("workbench.policy").filters = [{ key: "policy-probe/outcome", op: "is", value: "wrong" }];
  assert.match(textOf(hooks.policyMistakes(POLICY_REPORT)), /Automated but wrong · 1 of 1/);
});

test("hook: page code reaches Lab only through W", () => {
  for (const name of ["polLab", "polLabBlock", "polLabRows", "polLabWrongRows", "refreshPolLab"]) {
    const text = body(name);
    assert.ok(!/\bLAB\b/.test(text.replace(/[A-Z_]+_LAB\b/g, "")), `${name} must not name LAB directly`);
  }
});
