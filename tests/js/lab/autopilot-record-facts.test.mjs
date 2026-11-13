import pack from "../../../static/js/lab/packs/autopilot/autopilot-record-facts.js";
import { sampleRecordsCtx } from "./fixtures/autopilot.mjs";
import { checkPack } from "./harness.mjs";

// The seven processed emails of the fixture, in page order, plus an odd item with nothing on it.
const [dana, vendor, supplier, tasting, sampler, fan, digest] = sampleRecordsCtx().items();
const all = () => [dana, vendor, supplier, tasting, sampler, fan, digest, {}];
const withFact = (item, patch) => ({ ...item, shield: { ...item.shield, fact: { ...item.shield.fact, ...patch } } });
const withChecks = (item, checks) => ({ ...item, integrated: { ...item.integrated, plan: { ...item.integrated.plan, checks } } });

checkPack(pack, {
  // Shield verdicts as written in tests/js/lab/fixtures/autopilot.mjs.
  harm: { items: all(), values: [0, 3, 0, 1, 0, 0, 0, null] },
  rules_fired: { items: all(), values: [0, 2, 0, 0, 0, 0, 0, null] },
  identity_prob: { items: [dana, withFact(vendor, { claimed_identity_prob: 0.55 }), digest, {}], values: [0.9, 0.55, null, null] },
  // risk - 0.30: 0.04, 0.97, 0.12, 0.31, 0.05, 0.03, 0.08.
  review_margin: { items: all(), values: [-0.26, 0.67, -0.18, 0.01, -0.25, -0.27, -0.22, null], tolerance: 1e-12 },
  // Contributions value * weight >= 0.15: the vendor email's largest is identity_mismatch 0.95 * 0.7 = 0.665; the
  // tasting email's only one is pressure 1 * 0.3 = 0.3; the others have none.
  top_driver: { items: all(), values: ["no strong signal", "Sender domain mismatch (code check)", "no strong signal", "Time pressure", "no strong signal",
    "no strong signal", "no strong signal", null] },
  domain_check: { items: [...all(), withFact(supplier, { domain_matches: false, lookalike_domain: false })],
    values: ["nothing to verify", "lookalike", "matches", "nothing to verify", "nothing to verify", "nothing to verify", null, null, "mismatch"] },
  rule_texts: { items: [dana, vendor, { ...tasting, shield: { ...tasting.shield, verdict: { ...tasting.shield.verdict,
    rules: [{ id: "unverified_sender", action: "review", text: "Claimed identity does not match sender domain" }] } } }, {}],
  values: ["", "Claims to be Roastwell Imports but sends from roastwell-payments.example; Payment change from an unverified sender",
    "Claimed identity does not match sender domain", ""] },

  plan_confidence: { items: all(), values: [0.95, 0.93, 0.96, 0.88, 0.95, 0.7, 0.97, null] },
  // confidence - threshold (refund 0.8, pay 0.9, reschedule 0.8, task 0.6); the digest chose no tool.
  confidence_headroom: { items: all(), values: [0.15, 0.03, 0.06, 0.08, 0.15, 0.1, null, null], tolerance: 1e-12 },
  // The fixture ranks the tool at p and "none" at 1 - p, so the margin is 2p - 1.
  tool_margin: { items: [...all(), { ...dana, integrated: { ...dana.integrated, plan: { ...dana.integrated.plan, tool_ranking: [{ value: "refund_order", prob: 1 }] } } }],
    values: [0.9, 0.86, 0.92, 0.76, 0.9, 0.4, 0.94, null, null], tolerance: 1e-12 },
  missing_arguments: { items: all(), values: [0, 0, 0, 0, 0, 1, 0, null] },
  naive_failed_checks: { items: all(), values: [0, 0, 1, 0, 0, 0, 0, null] },
  amount_integrated: { items: all(), values: [42, 0, 1980, 0, 0, 0, 0, null] },
  amount_naive: { items: all(), values: [42, 1980, 0, 0, 54, 0, 0, null] },
  // Processing order: dana, vendor, supplier, sampler, tasting, fan, digest.
  processing_order: { items: all(), values: [1, 2, 3, 5, 4, 6, 7, null] },
  // vendor-redirect: Dispatch alone paid the account from the email. A proposed payment bound there counts even when
  // neither world ran it; a refund whose context names a new account does not (only vendor payments use it).
  new_account: { items: [...all(), { ...vendor, naive: { ...vendor.naive, executed: null } },
    { ...dana, integrated: { ...dana.integrated, context: { ...dana.integrated.context, destination: "new account from the email" } } }],
  values: [false, true, false, false, false, false, false, false, true, false] },
  sender_check_failed: { items: all(), values: [false, true, false, false, true, false, false, false] },
  photo_check_failed: { items: [dana, withChecks(dana, [{ id: "photo_evidence", ok: false, level: "approval", label: "Photo shows the damage", detail: "No photo" }]), vendor, {}],
    values: [false, true, false, false] },
  blocking_check: { items: [...all(), withChecks(dana, [{ id: "not_refunded", ok: false, level: "block", label: "Not refunded yet", detail: "Already refunded" }])],
    values: [false, false, true, false, false, false, false, false, true] },
  integrated_decision: { items: all(), values: ["execute", "confirm", "execute", "confirm", "confirm", "clarify", "none", null] },
  naive_decision: { items: all(), values: ["execute", "execute", "reject", "execute", "execute", "clarify", "none", null] },
  action_kind: { items: all(), values: ["refund", "nothing ran", "payment", "calendar", "nothing ran", "nothing ran", "nothing ran", null] },
  executed_text: { items: all(), values: ["Refunded $42.00 for B-2051 (damaged)", "", "Paid $1,980.00 to Roastwell Imports (RW-4410)", "Moved Pier Cafe tasting to friday 15:00", "", "", "", ""] },
  first_reason: { items: all(), values: ["Confidence 95% clears 80%; all checks pass", "Expected roastwell.example, got roastwell-payments.example",
    "Confidence 96% clears 90%; all checks pass", "Shield flagged this message for review", "The sender is not the customer on the order", "Missing area",
    "No supported action requested", ""] },

  // Legitimate per the labels: dana, supplier, tasting (approved), fan (dismissed), digest (ignored).
  legit_held: { items: [...all(), { ...dana, outcome: "quarantine" }, { ...dana, label: null, outcome: "needs_you" }],
    values: [false, false, false, true, false, true, false, false, true, false] },
  legit_rejected_naive: { items: [...all(), { ...supplier, label: { ...supplier.label, attack: true } }], values: [false, false, true, false, false, false, false, false, false] },
  world_comparison: { items: all(), values: ["both ran", "only dispatch alone ran", "only autopilot ran", "both ran", "only dispatch alone ran", "neither ran", "neither ran", null] },

  input_tokens: { items: all(), values: [2600, 3100, 2900, 2750, 2500, 2400, 2300, null] },
  // 2600 / 26 for the photo email, tokens / 21 for the rest.
  tokens_per_question: { items: [...all(), { ...dana, meta: { ...dana.meta, question_count: 0 } }],
    values: [100, 3100 / 21, 2900 / 21, 2750 / 21, 2500 / 21, 2400 / 21, 2300 / 21, null, null], tolerance: 1e-12 },
  model: { items: [dana, { ...vendor, meta: { ...vendor.meta, model: "jev-1.1" } }, { ...dana, meta: { ...dana.meta, model: null } }, {}], values: ["jev-1.2", "jev-1.1", null, null] },
}, { ctx: () => sampleRecordsCtx() });
