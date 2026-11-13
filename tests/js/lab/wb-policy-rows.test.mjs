// Tests for the Policy rows starter pack (static/js/lab/packs/workbench/wb-policy-rows.js). Expected values are worked
// out by hand from tests/js/lab/fixtures/workbench-analysis.mjs (gates department ≥ 0.50, urgent ≥ 0.30, one rule).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/wb-policy-rows.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { samplePolicyCtx } from "./fixtures/workbench-analysis.mjs";

// #1 right · #2 review (department, rule) · #3 right · #4 wrong (urgent) · #5 review (rule) · #6 review (both) · #7 right
const rows = () => samplePolicyCtx().items();
const OFF = { department: { on: false, t: 0.5 }, urgent: { on: false, t: 0.3 }, tone: { on: false, t: 0.5 } };
const oneGate = (items) => fakeCtx({ items, data: { active: { a: 0.5 } } });
const nearItems = [{ answers: { a: { signal: 0.47 } } }, { answers: { a: { signal: 0.4 } } }, { answers: { a: { signal: 0.6 } } }, { answers: { a: { signal: 0.45 } } }];

checkPack(pack, {
  // department signal − 0.50 and urgent signal − 0.30, the smaller: (.26, .46) (−.38, .10) (.37, .60) (.43, .10) (.10, .30) (−.30, −.30) (.34, .52)
  min_margin: { items: rows(), values: [0.26, -0.38, 0.37, 0.1, 0.1, -0.3, 0.34], ctx: samplePolicyCtx(), tolerance: 1e-9 },
  held_count: { items: rows(), values: [0, 1, 0, 0, 0, 2, 0] },
  wrong_count: { items: rows(), values: [0, 1, 0, 1, 0, 1, 0] },
  mean_signal: { items: rows(), values: [0.76, 0.26, 0.885, 0.665, 0.6, 0.1, 0.83], ctx: samplePolicyCtx(), tolerance: 1e-9 },
  // #2 is held by department and a rule, #6 by two gates: neither is held by one gate alone.
  held_alone: { items: [{ held: ["urgent"], rules: [] }, { held: ["urgent"], rules: [1] }, { held: [], rules: [] }, { held: ["a", "b"], rules: [] }, rows()[1], rows()[5]],
    values: [true, false, false, false, false, false] },
  near_miss: { items: nearItems, values: [true, false, false, true], ctx: oneGate(nearItems) },
  picture: { items: rows(), values: [false, true, false, false, false, false, false] },
  outcome: { items: rows(), values: ["automated, right", "sent to review", "automated, right", "automated, wrong", "sent to review", "sent to review", "automated, right"] },
  held_by: { items: rows(), values: ["nothing", "department + a rule", "nothing", "nothing", "a rule", "department + urgent", "nothing"] },
  wrong_questions: { items: rows(), values: ["none", "department", "none", "urgent", "none", "department", "none"] },
  row_text: { items: [rows()[0], rows()[3]], values: ["My espresso grinder arrived cracked, I want a refund today.", "Invoice INV-88 was charged twice on my card."] },

  // Without #6 urgent holds nothing; department still holds #2.
  idle_gate: { hitList: rows().filter((item) => item.index !== 5), missList: rows(), ctx: samplePolicyCtx(), message: /^urgent holds none of the 6 shown rows/ },
  confident_mistake: {
    hit: { outcome: "wrong", wrong: ["department"], answers: { department: { signal: 0.9 }, urgent: { signal: 0.85 } } },
    miss: [rows()[3], rows()[0], { outcome: "review", wrong: ["a"], answers: { a: { signal: 0.95 } } }],
    message: /yet department is wrong/,
  },

  rule_share: [
    { ctx: samplePolicyCtx(), expect: 2 / 7, tolerance: 1e-12, empty: samplePolicyCtx({ result: null }) },
    { ctx: samplePolicyCtx({ hide: [1] }), expect: 1 / 6, tolerance: 1e-12 },
  ],
  // #6 is held by both gates, far below them; #2 and #5 by a rule. One hand-made row at 0.46 under a 0.50 gate is near.
  near_misses: [
    { ctx: samplePolicyCtx(), expect: 0, empty: samplePolicyCtx({ result: null }) },
    { ctx: oneGate([{ outcome: "review", held: ["a"], rules: [], answers: { a: { signal: 0.46 } } },
      { outcome: "review", held: ["a"], rules: [], answers: { a: { signal: 0.3 } } }, { outcome: "right", held: [], rules: [], answers: { a: { signal: 0.9 } } }]), expect: 1 },
    // Two gates at 0.50: every held gate must be near (.47 and .46 yes; .47 and .20 no), and a rule-held row never counts.
    { ctx: fakeCtx({ data: { active: { a: 0.5, b: 0.5 } }, items: [
      { outcome: "review", held: ["a", "b"], rules: [], answers: { a: { signal: 0.47 }, b: { signal: 0.2 } } },
      { outcome: "review", held: ["a", "b"], rules: [], answers: { a: { signal: 0.47 }, b: { signal: 0.46 } } },
      { outcome: "review", held: ["a"], rules: [2], answers: { a: { signal: 0.48 }, b: { signal: 0.9 } } }] }), expect: 1 },
  ],
  // Automated: #1 #3 #4 #7, three right.
  automated_accuracy: [
    // Wilson 95% for 3 of 4 from a separate computation: 0.3006–0.9544 (the fixture's POLICY_COST.current agrees).
    { ctx: samplePolicyCtx(), expect: (result) => { assert.equal(result.value, 0.75); assert.equal(result.detail, "3 of 4; 95% interval 30.1%–95.4%"); },
      empty: samplePolicyCtx({ result: null }) },
    { ctx: samplePolicyCtx({ hide: [3] }), expect: 1 },
    { ctx: samplePolicyCtx({ hide: [0, 2, 3, 6] }), expect: null },
  ],

  rows_csv: {
    ctx: samplePolicyCtx({ hide: [0, 2, 4, 5, 6] }),
    text: '"Bulk #","outcome","held by","rules","wrong","department answer","department label","department signal","urgent answer","urgent label","urgent signal"\r\n'
      + '"2","review","department","1","department","wholesale","shipping","0.12","no","no","0.40"\r\n'
      + '"4","wrong","","","urgent","billing","billing","0.93","yes","no","0.40"\r\n',
    excludes: ["HC-2231", "Invoice", "kettle"],
  },
  gates_csv: {
    // Wilson 95% from a separate computation: 5 of 7 → 0.3589–0.9178, 6 of 7 → 0.4869–0.9743. Lab filters change nothing here.
    ctx: samplePolicyCtx({ hide: [0, 1, 2] }),
    text: '"question","type","threshold","right on every scored row","accuracy","low","high","holds for review","holds alone","wrong while automated"\r\n'
      + '"department","choice","0.50","5","0.7143","0.3589","0.9178","2","0","0"\r\n'
      + '"urgent","noul","0.30","6","0.8571","0.4869","0.9743","1","0","1"\r\n',
  },
  gates_json: {
    ctx: samplePolicyCtx(),
    text: '{\n  "signal": "confidence",\n  "gates": {\n    "department": 0.5,\n    "urgent": 0.3\n  }\n}\n',
    excludes: ["tone", "billing"],
  },

  check_unseen: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["checkUnseen"]]),
    hidden: () => samplePolicyCtx({ holdout: { running: true } }),
  },
  check_gates: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["checkGates"]]),
    hidden: () => samplePolicyCtx({ prune: { target: 0.95, running: true, report: null } }),
  },
  export_gate: {
    ctx: () => samplePolicyCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["exportGate"]]),
    hidden: () => samplePolicyCtx({ gates: OFF }),
  },
}, { ctx: () => samplePolicyCtx() });

for (const feature of pack.features.filter((f) => f.kind === "fact")) feature.value({}, fakeCtx({}));
