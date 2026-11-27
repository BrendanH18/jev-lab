// Fixtures for packs on the Workbench Policy surface (contract: static/js/lab/surfaces/workbench-analysis.js).
// Not a test file.
//
//   import { samplePolicyCtx } from "./fixtures/workbench-analysis.mjs";
//   const pol = samplePolicyCtx();                        // gates department ≥ 0.50 and urgent ≥ 0.30, one rule
//   const none = samplePolicyCtx({ result: null });       // before any run: items() [], data mostly null / [] / {}
//
// The ctx is made by the real builder from hand-written raw page state, so items and data have exactly the page's
// shapes. The answers are made up for tests; the page itself only shows answers from the user's own run.
// overrides: any source field of the builder (result, report, gates, signal, bound, labeledQids, tunes, cost,
//   cheapest, holdout, prune, rules, rulesInForce, slices, requestReady, holdoutReady), plus
//   hide:  row indexes (item.index) that a Lab filter hides
//   order: the same keys in the order an active Lab sort gives (keys not named keep their place after)
// The ctx carries env (fakeEnv(): toasts, copied, downloads), state (the raw page state it reads; change it to
// simulate the page) and log: every page action it received as [name, ...args].
//
// The run (10 rows, model "jev-1.14.0", one held-out test row, one failed call). Rows 0-6 carry labels;
// row 9 is answered but unlabeled; row 7 is a test row and row 8 failed, so neither is ever an item.
//   #1 index 0  "My espresso grinder arrived cracked, I want a refund today."
//               department billing (conf .76, label billing, right) · urgent P(yes) .88 (yes, right) · tone 2 (right)
//   #2 index 1  { text: "Where is wholesale order HC-2231?", channel: "email", _image: "receipt.png" }
//               department wholesale (.45 vs shipping .40, conf .12, label shipping, WRONG) · urgent .30 (no, right)
//               tone 0 (label 1, WRONG) · spot box right (IoU ≥ 0.5)
//   #3 index 2  "Thanks for the Ethiopia roast, best cup all year!"
//               department other (conf .87, right) · urgent .05 (no, right) · tone 0 (right)
//   #4 index 3  "Invoice INV-88 was charged twice on my card."
//               department billing (conf .93, right) · urgent .70 (yes, label no, WRONG) · tone 1 (right)
//   #5 index 4  { text: "Can the cafe get 40 kg of house blend monthly?", channel: "phone" }
//               department wholesale (conf .60, right) · urgent .20 (no, right) · tone unlabeled · spot box WRONG
//   #6 index 5  "Do you ship to Norway?"
//               department billing (.40, NO confidence field: signal .20, label shipping, WRONG) · urgent .50 (yes,
//               right) · tone label "loud" (invalid)
//   #7 index 6  "Parcel says delivered but nothing came."   department shipping (conf .84, right) · urgent .91 · tone 2
//   #8 index 7  TEST ROW { text: "Refund for the broken kettle please", _test: true } (answered; must never appear)
//   #9 index 8  failed: "Rate limit reached"
//   #10 index 9 "Is the Guatemala roast back in stock?"   answered (department other, conf .40), no labels
import { policyCtx } from "../../../../static/js/lab/surfaces/workbench-analysis.js";
import { fakeEnv } from "../harness.mjs";

const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

// 95% Wilson interval, as jev/calibrate.py wilson: (0, 1) edges when none or all are right; (null, null) for n = 0.
export function wilson(correct, n) {
  if (!n) return [null, null];
  const z = 1.959964,
    p = correct / n,
    z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [correct === 0 ? 0 : Math.max(0, centre - half), correct === n ? 1 : Math.min(1, centre + half)];
}

// ---------- the run (W.bulk.result) ----------

const choice = (pick, probabilities, confidence) => ({
  type: "choice",
  choice: pick,
  probabilities,
  ...(confidence === undefined ? {} : { confidence }),
});
const noul = (p) => ({ type: "noul", noul: p });
const score = (probabilities, confidence) => {
  const expected = Object.entries(probabilities).reduce((total, [level, p]) => total + Number(level) * p, 0);
  return {
    type: "score",
    score: Math.round(expected * 100) / 100,
    probabilities,
    legend: { 0: "Calm", 1: "Annoyed", 2: "Angry" },
    ...(confidence === undefined ? {} : { confidence }),
  };
};
const box = (left, top, right, bottom, confidence) => ({ type: "box", box: { left, top, right, bottom }, confidence });
const meta = (latency, cost) => ({
  model: "jev-1.14.0",
  latency_ms: latency,
  question_count: 4,
  input_tokens: 310,
  output_tokens: 44,
  cost_usd: cost,
  backend: "sdk",
});

export const QUESTIONS = freeze({
  department: {
    type: "choice",
    instructions: "Which Harbor Coffee Co. team should handle this message?",
    criteria: {
      billing: "Charges, invoices and refunds",
      shipping: "Deliveries and tracking",
      wholesale: "Cafe and bulk orders",
      other: "Anything else",
    },
  },
  urgent: { type: "noul", instructions: "Does the writer need an answer today?" },
  tone: { type: "score", instructions: "How upset does the writer sound?", criteria: ["Calm", "Annoyed", "Angry"] },
  spot: { type: "box", instructions: "Where is the order number in the photo?" },
});

export const RESULT = freeze({
  model: "jev-1.14.0",
  rows: 10,
  completed: 9,
  stopped: null,
  labeled: 7,
  wall_ms: 4100,
  cost_usd: 0.0009,
  input_tokens: 2790,
  results: [
    {
      index: 0,
      row: "My espresso grinder arrived cracked, I want a refund today.",
      meta: meta(410, 0.0001),
      answers: {
        department: choice("billing", { billing: 0.82, shipping: 0.12, wholesale: 0.03, other: 0.03 }, 0.76),
        urgent: noul(0.88),
        tone: score({ 0: 0.05, 1: 0.25, 2: 0.7 }, 0.55),
        spot: box(0.05, 0.05, 0.3, 0.2, 0.2),
      },
    },
    {
      index: 1,
      row: { text: "Where is wholesale order HC-2231?", channel: "email", _image: "receipt.png" },
      meta: meta(520, 0.0001),
      answers: {
        department: choice("wholesale", { billing: 0.05, shipping: 0.4, wholesale: 0.45, other: 0.1 }, 0.12),
        urgent: noul(0.3),
        tone: score({ 0: 0.6, 1: 0.3, 2: 0.1 }, 0.4),
        spot: box(0.1, 0.2, 0.5, 0.6, 0.7),
      },
    },
    {
      index: 2,
      row: "Thanks for the Ethiopia roast, best cup all year!",
      meta: meta(380, 0.0001),
      answers: {
        department: choice("other", { billing: 0.02, shipping: 0.03, wholesale: 0.05, other: 0.9 }, 0.87),
        urgent: noul(0.05),
        tone: score({ 0: 0.9, 1: 0.08, 2: 0.02 }, 0.85),
        spot: box(0.4, 0.4, 0.6, 0.5, 0.1),
      },
    },
    {
      index: 3,
      row: "Invoice INV-88 was charged twice on my card.",
      meta: meta(395, 0.0001),
      answers: {
        department: choice("billing", { billing: 0.95, shipping: 0.02, wholesale: 0.02, other: 0.01 }, 0.93),
        urgent: noul(0.7),
        tone: score({ 0: 0.2, 1: 0.5, 2: 0.3 }, 0.25),
        spot: box(0.2, 0.2, 0.4, 0.3, 0.15),
      },
    },
    {
      index: 4,
      row: { text: "Can the cafe get 40 kg of house blend monthly?", channel: "phone" },
      meta: meta(450, 0.0001),
      answers: {
        department: choice("wholesale", { billing: 0.1, shipping: 0.15, wholesale: 0.7, other: 0.05 }, 0.6),
        urgent: noul(0.2),
        tone: score({ 0: 0.7, 1: 0.2, 2: 0.1 }, 0.55),
        spot: box(0.6, 0.6, 0.9, 0.9, 0.3),
      },
    },
    {
      index: 5,
      row: "Do you ship to Norway?",
      meta: meta(400, 0.0001),
      answers: {
        department: choice("billing", { billing: 0.4, shipping: 0.3, wholesale: 0.2, other: 0.1 }),
        urgent: noul(0.5),
        tone: score({ 0: 0.1, 1: 0.3, 2: 0.6 }),
        spot: box(0.1, 0.1, 0.2, 0.2, 0.05),
      },
    },
    {
      index: 6,
      row: "Parcel says delivered but nothing came.",
      meta: meta(430, 0.0001),
      answers: {
        department: choice("shipping", { billing: 0.04, shipping: 0.88, wholesale: 0.03, other: 0.05 }, 0.84),
        urgent: noul(0.91),
        tone: score({ 0: 0.15, 1: 0.15, 2: 0.7 }, 0.6),
        spot: box(0.3, 0.3, 0.5, 0.4, 0.2),
      },
    },
    {
      index: 7,
      row: { text: "Refund for the broken kettle please", _test: true },
      meta: meta(415, 0.0001),
      answers: {
        department: choice("billing", { billing: 0.97, shipping: 0.01, wholesale: 0.01, other: 0.01 }, 0.96),
        urgent: noul(0.81),
        tone: score({ 0: 0.1, 1: 0.6, 2: 0.3 }, 0.5),
        spot: box(0.1, 0.1, 0.3, 0.3, 0.2),
      },
    },
    { index: 8, row: "Can I change my delivery address?", error: "Rate limit reached" },
    {
      index: 9,
      row: "Is the Guatemala roast back in stock?",
      meta: meta(405, 0.0001),
      answers: {
        department: choice("other", { billing: 0.05, shipping: 0.2, wholesale: 0.2, other: 0.55 }, 0.4),
        urgent: noul(0.45),
        tone: score({ 0: 0.8, 1: 0.15, 2: 0.05 }, 0.7),
        spot: box(0.2, 0.2, 0.3, 0.3, 0.1),
      },
    },
  ],
});

// The human labels of the tuning rows (W.bulk.labels holds the test row's too; the reports never read it).
export const LABELS = freeze({
  0: { department: "billing", urgent: true, tone: 2 },
  1: { department: "shipping", urgent: false, tone: 1, spot: { left: 0.12, top: 0.22, right: 0.5, bottom: 0.58 } },
  2: { department: "other", urgent: false, tone: 0 },
  3: { department: "billing", urgent: false, tone: 1 },
  4: { department: "wholesale", urgent: false, spot: { left: 0.05, top: 0.05, right: 0.2, bottom: 0.2 } },
  5: { department: "shipping", urgent: true, tone: "loud" },
  6: { department: "shipping", urgent: true, tone: 2 },
  7: { department: "billing", urgent: true, tone: 1 },
});

// ---------- Policy (W.bulk.policy, W.bulk.rules) ----------

export const POLICY_RULES = "if department = wholesale then urgent = yes";

const polRow = (index, automated, correct, held, wrong, rules, dep, urg) => ({
  index,
  automated,
  correct,
  held,
  wrong,
  rules,
  answers: {
    department: { answer: dep[0], label: dep[1], signal: dep[2] },
    urgent: { answer: urg[0], label: urg[1], signal: urg[2] },
  },
});

function policyReport() {
  const [low, high] = wilson(3, 4),
    [allLow, allHigh] = wilson(4, 7),
    [dLow, dHigh] = wilson(5, 7),
    [uLow, uHigh] = wilson(6, 7);
  return {
    signal: "confidence",
    gates: { department: 0.5, urgent: 0.3 },
    questions: [
      {
        qid: "department",
        type: "choice",
        threshold: 0.5,
        correct: 5,
        holds: 2,
        only: 0,
        wrong_automated: 0,
        accuracy: 5 / 7,
        accuracy_low: dLow,
        accuracy_high: dHigh,
      },
      {
        qid: "urgent",
        type: "noul",
        threshold: 0.3,
        correct: 6,
        holds: 1,
        only: 0,
        wrong_automated: 1,
        accuracy: 6 / 7,
        accuracy_low: uLow,
        accuracy_high: uHigh,
      },
    ],
    labeled: 7,
    unlabeled: 1,
    invalid: [],
    skipped: 0,
    accuracy_all: 4 / 7,
    accuracy_all_low: allLow,
    accuracy_all_high: allHigh,
    automated: 4,
    correct: 3,
    review: 3,
    coverage: 4 / 7,
    accuracy: 0.75,
    accuracy_low: low,
    accuracy_high: high,
    routed: 8,
    routed_automated: 4,
    rules: [POLICY_RULES],
    held_by_rules: 2,
    routed_held_by_rules: 2,
    rows: [
      polRow(0, true, true, [], [], [], ["billing", "billing", 0.76], ["yes", "yes", 0.76]),
      polRow(1, false, false, ["department"], ["department"], [1], ["wholesale", "shipping", 0.12], ["no", "no", 0.4]),
      polRow(2, true, true, [], [], [], ["other", "other", 0.87], ["no", "no", 0.9]),
      polRow(3, true, false, [], ["urgent"], [], ["billing", "billing", 0.93], ["yes", "no", 0.4]),
      polRow(4, false, true, [], [], [1], ["wholesale", "wholesale", 0.6], ["no", "no", 0.6]),
      polRow(
        5,
        false,
        false,
        ["department", "urgent"],
        ["department"],
        [],
        ["billing", "shipping", 0.2],
        ["yes", "yes", 0],
      ),
      polRow(6, true, true, [], [], [], ["shipping", "shipping", 0.84], ["yes", "yes", 0.82]),
    ],
  };
}
export const POLICY_REPORT = freeze(policyReport());

export const POLICY_GATES = freeze({
  department: { on: true, t: 0.5 },
  urgent: { on: true, t: 0.3 },
  tone: { on: false, t: 0.5 },
});

export const POLICY_TUNES = freeze({
  signal: "confidence",
  bound: "estimate",
  labeled: 7,
  targets: [
    {
      target: 0.9,
      gates: { department: 0.5, urgent: 0.45 },
      automated: 3,
      coverage: 3 / 7,
      accuracy: 1,
      low: 0.4385,
      high: 1,
      needed: 22,
      plan: null,
    },
    {
      target: 0.95,
      gates: { department: 0.5, urgent: 0.45 },
      automated: 3,
      coverage: 3 / 7,
      accuracy: 1,
      low: 0.4385,
      high: 1,
      needed: 22,
      plan: null,
    },
    {
      target: 0.99,
      gates: null,
      automated: 0,
      coverage: 0,
      accuracy: null,
      low: null,
      high: null,
      needed: 22,
      plan: null,
    },
  ],
});

// Review $2, mistake $20 over the 7 scored rows: 3 reviews ($6) + 1 automated mistake ($20) = $26 → $3,714.29 per 1,000.
export const POLICY_COST = freeze({
  signal: "confidence",
  questions: ["department", "urgent"],
  labeled: 7,
  review: 2,
  error: 20,
  mistakes: [],
  break_even: 0.9,
  review_all: { automated: 0, wrong: 0, review: 7, cost: 14, per_1000: 2000 },
  automate_all: { automated: 7, wrong: 3, review: 0, cost: 60, per_1000: 60000 / 7 },
  best: null,
  current: {
    automated: 4,
    wrong: 1,
    review: 3,
    coverage: 4 / 7,
    accuracy: 0.75,
    low: 0.3006,
    high: 0.9544,
    cost: 26,
    per_1000: 26000 / 7,
    gates: { department: 0.5, urgent: 0.3 },
  },
  sweep: null,
});

export const POLICY_CHEAPEST = freeze({
  signal: "confidence",
  questions: ["department", "urgent"],
  labeled: 7,
  review: 2,
  error: 20,
  mistakes: [],
  break_even: 0.9,
  review_all: { automated: 0, wrong: 0, review: 7, cost: 14, per_1000: 2000 },
  automate_all: { automated: 7, wrong: 3, review: 0, cost: 60, per_1000: 60000 / 7 },
  best: {
    automated: 3,
    wrong: 0,
    review: 4,
    coverage: 3 / 7,
    accuracy: 1,
    low: 0.4385,
    high: 1,
    cost: 8,
    per_1000: 8000 / 7,
    gates: { department: 0.5, urgent: 0.45 },
  },
  current: null,
  sweep: null,
});

// A finished "Do the gates earn their place?" (not part of the default ctx: pass prune: { target, running, report }).
export const PRUNE_REPORT = freeze({
  signal: "confidence",
  bound: "estimate",
  target: 0.95,
  labeled: 7,
  chars: 220,
  baseline: {
    gates: { department: 0.5, urgent: 0.45 },
    labeled: 7,
    automated: 3,
    coverage: 3 / 7,
    accuracy: 1,
    low: 0.4385,
    high: 1,
  },
  gated: [
    {
      qid: "department",
      type: "choice",
      share: 0.45,
      rules: [POLICY_RULES],
      off: {
        gates: { department: 0, urgent: 0.45 },
        labeled: 7,
        automated: 3,
        coverage: 3 / 7,
        accuracy: 1,
        low: 0.4385,
        high: 1,
      },
      dropped: {
        gates: { urgent: 0.45 },
        labeled: 7,
        automated: 4,
        coverage: 4 / 7,
        accuracy: 1,
        low: 0.5101,
        high: 1,
      },
    },
    {
      qid: "urgent",
      type: "noul",
      share: 0.2,
      rules: [POLICY_RULES],
      off: { gates: null, labeled: 7, automated: 0, coverage: 0, accuracy: null, low: null, high: null },
      dropped: {
        gates: { department: 0.8 },
        labeled: 7,
        automated: 3,
        coverage: 3 / 7,
        accuracy: 1,
        low: 0.4385,
        high: 1,
      },
    },
  ],
  unused: [
    { qid: "tone", type: "score", share: 0.2 },
    { qid: "spot", type: "box", share: 0.15 },
  ],
});

// ---------- the ctx builders ----------

function labStandIn(key, hide = [], order = []) {
  return {
    matches: (item, ctx) => !hide.includes(key(item, ctx)),
    arrange: (items, ctx) => {
      if (!order.length) return items;
      const first = order.map((wanted) => items.find((item) => key(item, ctx) === wanted)).filter(Boolean);
      return [...first, ...items.filter((item) => !first.includes(item))];
    },
  };
}

const labeledQidsOf = (labels) =>
  new Set(
    Object.entries(labels)
      .filter(([index]) => index !== "7")
      .flatMap(([, row]) => Object.keys(row)),
  );

export function samplePolicyCtx(overrides = {}) {
  const { hide = [], order = [], ...rest } = overrides;
  const log = [];
  const state = {
    result: RESULT,
    report: POLICY_REPORT,
    gates: POLICY_GATES,
    signal: "confidence",
    bound: "estimate",
    labeledQids: labeledQidsOf(LABELS),
    tunes: POLICY_TUNES,
    cost: POLICY_COST,
    cheapest: POLICY_CHEAPEST,
    holdout: null,
    prune: { target: 0.95, running: false, report: null },
    rules: { text: POLICY_RULES, applied: POLICY_RULES, checked: POLICY_RULES, report: null, error: null, hold: true },
    rulesInForce: POLICY_RULES,
    slices: null,
    requestReady: true,
    holdoutReady: true,
    ...rest,
  };
  const stand = labStandIn((item) => item.index, hide, order);
  const record =
    (name) =>
    (...args) => {
      log.push([name, ...args]);
    };
  const ctx = policyCtx({
    ...Object.fromEntries(Object.keys(state).map((key) => [key, () => state[key]])),
    matches: stand.matches,
    arrange: stand.arrange,
    refresh: record("refresh"),
    setThresholds: record("setThresholds"),
    setGate: record("setGate"),
    setSignal: record("setSignal"),
    setBound: record("setBound"),
    checkUnseen: record("checkUnseen"),
    checkGates: record("checkGates"),
    exportGate: record("exportGate"),
  });
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  return ctx;
}
