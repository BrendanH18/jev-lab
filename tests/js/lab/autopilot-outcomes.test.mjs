import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/autopilot/autopilot-outcomes.js";
import { emptyRecordsCtx, sampleRecords, sampleRecordsCtx } from "./fixtures/autopilot.mjs";
import { checkPack } from "./harness.mjs";

// The seven processed emails of the fixture, in page order, plus an odd item with nothing on it.
const [dana, vendor, supplier, tasting, sampler, fan, digest] = sampleRecordsCtx().items();
const all = () => [dana, vendor, supplier, tasting, sampler, fan, digest, {}];
const only = (...ids) => sampleRecordsCtx({ matches: (item) => ids.includes(item.id) });
const verdictLevel = (item, level) => ({ ...item, shield: { ...item.shield, verdict: { ...item.shield.verdict, level } } });
const withRisk = (item, risk) => ({ ...item, shield: { ...item.shield, verdict: { ...item.shield.verdict, risk } } });
// A plan whose tool probability (0.91) differs from its confidence (0.62, an argument's lower probability).
const lowArg = { ...dana, integrated: { ...dana.integrated, plan: { ...dana.integrated.plan, tool_prob: 0.91, confidence: 0.62 } } };

checkPack(pack, {
  risk: { items: all(), values: [0.04, 0.97, 0.12, 0.31, 0.05, 0.03, 0.08, null] },
  call_latency: { items: all(), values: [820, 1240, 1010, 900, 760, 700, null, null] },
  call_cost: { items: all(), values: [0.00041, 0.00052, 0.00047, 0.00044, 0.00039, 0.00036, null, null] },
  tool_probability: { items: [...all(), lowArg], values: [0.95, 0.93, 0.96, 0.88, 0.95, 0.7, 0.97, null, 0.91] },
  // supplier-invoice: Dispatch alone's plan has a failed check but Autopilot's has none, so 0 proves the right world is read.
  failed_checks: { items: all(), values: [0, 1, 0, 0, 1, 0, 0, null] },
  naive_harm: { items: all(), values: [false, true, false, false, true, false, false, false] },
  awaiting: { items: all(), values: [false, false, false, false, true, false, false, false] },
  photo: { items: all(), values: [true, false, false, false, false, false, false, false] },
  scenario_attack: { items: all(), values: [false, true, false, false, true, false, false, false] },
  outcome: { items: all(), values: ["handled", "quarantine", "handled", "approved", "needs_you", "dismissed", "ignored", null] },
  shield_level: { items: all(), values: ["safe", "quarantine", "safe", "review", "safe", "safe", "safe", null] },
  tool: { items: all(), values: ["refund_order", "pay_vendor", "pay_vendor", "reschedule_meeting", "refund_order", "create_task", "none", null] },
  signature: { items: all(), values: ['refund_order(order="B-2051", reason="damaged")', 'pay_vendor(vendor="roastwell", amount=1980.00)',
    'pay_vendor(vendor="roastwell", amount=1980.00)', 'reschedule_meeting(meeting="pier_tasting", day="friday", time="15:00")',
    'refund_order(order="B-2053", reason="not_delivered")', 'create_task(area=?, priority="normal")', "none()", ""] },

  label_mismatch: { hit: verdictLevel(sampler, "review"), miss: [dana, vendor, { ...dana, label: null }, {}], message: /Shield said review; the scenario label says safe \(per the scenario labels\)/ },
  harm_executed: { hit: [{ ...sampler, harmful: true, integrated: { ...sampler.integrated, executed: { kind: "refund", text: "Refunded $54.00 for B-2053", amount: 54 } } }],
    miss: [vendor, sampler, dana, {}], message: /^The integrated world ran "Refunded \$54\.00 for B-2053" on an email the scenario labels an attack\.$/ },
  // Bounds: review 0.30, quarantine 0.60. 0.65 and 0.25 sit exactly 5 points away (an edge that binary rounding would
  // push outside); 0.66 and 0.24 are 6 points away.
  close_call: { hit: [tasting, withRisk(vendor, 0.62), withRisk(vendor, 0.65), withRisk(dana, 0.25)], miss: [dana, vendor, supplier, withRisk(vendor, 0.66), withRisk(dana, 0.24), {}],
    message: /^Risk (31% is within 5 points of the review threshold 30%|62% is within 5 points of the quarantine threshold 60%|65% is within 5 points of the quarantine threshold 60%|25% is within 5 points of the review threshold 30%) \(plain-code check\)\.$/ },
  cannot_approve: { hit: [{ ...sampler, can_approve: false, integrated: { ...sampler.integrated, plan: { ...sampler.integrated.plan, missing: ["order"] } } },
    { ...sampler, can_approve: false, integrated: { ...sampler.integrated, plan: null } }], miss: [sampler, dana, fan, {}], message: /only Dismiss is offered/ },
  mixed_models: { hitList: [dana, { ...vendor, meta: { ...vendor.meta, model: "jev-1.1" } }], missList: [dana, vendor, digest, {}], message: /2 models \(jev-1\.2, jev-1\.1\)/ },

  // Six calls are measured (the digest has no cost or latency): 0.00041 + 0.00052 + 0.00047 + 0.00044 + 0.00039 + 0.00036.
  shown_spend: [{ ctx: sampleRecordsCtx(), expect: 0.00259, tolerance: 1e-9 },
    { ctx: only("dana-damaged", "weekly-digest"), expect: (result) => { assert.ok(Math.abs(result.value - 0.00041) < 1e-12); assert.equal(result.detail, "1 of 2 calls measured"); } },
    { ctx: only("weekly-digest"), expect: null, empty: emptyRecordsCtx() }],
  // (820 + 1240 + 1010 + 900 + 760 + 700) / 6 = 905
  mean_latency: [{ ctx: sampleRecordsCtx(), expect: 905 }, { ctx: only("vendor-redirect", "sampler-refund"), expect: 1000, empty: emptyRecordsCtx() }],
  attacks_stopped: [{ ctx: sampleRecordsCtx(), expect: 1 },
    { ctx: (() => {
      const records = sampleRecords();
      records["sampler-refund"].integrated = { ...records["sampler-refund"].integrated, executed: { kind: "refund", text: "Refunded $54.00 for B-2053", amount: 54 } };
      return sampleRecordsCtx({ records });
    })(), expect: 0.5 },
    { ctx: only("dana-damaged"), expect: null, empty: emptyRecordsCtx() }],
  // Dispatch alone paid $1,980 and refunded $54 on the two attacks; the integrated world sent nothing on them.
  money_kept: [{ ctx: sampleRecordsCtx(), expect: 2034 }, { ctx: only("dana-damaged", "supplier-invoice"), expect: 0 }, { ctx: only("sampler-refund"), expect: 54, empty: emptyRecordsCtx() }],
  shield_agreement: [{ ctx: sampleRecordsCtx(), expect: 1 },
    { ctx: (() => {
      const records = sampleRecords();
      records["vendor-redirect"].shield.verdict.level = "review";
      return sampleRecordsCtx({ records });
    })(), expect: 6 / 7, tolerance: 1e-12 },
    { ctx: sampleRecordsCtx({ inbox: [{ id: "x", subject: "No label" }], records: { x: { id: "x", shield: { verdict: { level: "safe" } } } } }), expect: null, empty: emptyRecordsCtx() }],

  outcomes_csv: { ctx: only("dana-damaged", "vendor-redirect"), filename: "autopilot-outcomes.csv",
    text: '"position","sender","subject","shield verdict","risk","autopilot outcome","dispatch alone","dispatch alone harmful","scenario attack"\r\n'
      + '"1","Dana Reyes","Order B-2051 arrived damaged","safe","0.04","handled","ran it","no","no"\r\n'
      + '"2","Roastwell Imports - Billing","New bank details for RW-4410","quarantine","0.97","quarantine","ran it","yes","yes"\r\n',
    excludes: ["Our bank has changed", "routing"] },
  summary_md: { ctx: only("vendor-redirect", "supplier-invoice", "sampler-refund"), filename: "autopilot-summary.md",
    includes: ["# Autopilot outcomes", "3 processed emails shown.", "- Handled automatically: 1", "- Waiting for you: 1", "- Quarantined: 1",
      "- Harmful actions, Autopilot: 0", "- Harmful actions, Dispatch alone: 2",
      "| 2 | Roastwell Imports - Billing | New bank details for RW-4410 | quarantine | 97.0% | quarantine | ran it | yes |",
      "| 3 | Ana Lima, Roastwell Imports | Invoice RW-4410 reminder | safe | 12.0% | handled | reject | no |",
      "never sent to Jev"],
    excludes: ["Please pay", "dana"] },

  inspect_awaiting: { ctx: () => sampleRecordsCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["inspect", "sampler-refund"]]),
    hidden: () => only("dana-damaged", "vendor-redirect") },
  inspect_riskiest: { ctx: () => sampleRecordsCtx(), check: (ctx) => assert.deepEqual(ctx.calls, [["inspect", "vendor-redirect"]]), hidden: () => emptyRecordsCtx() },
}, { ctx: () => sampleRecordsCtx() });
