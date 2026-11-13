import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/shield/shield-inbox-more.js";
import { checkPack } from "./harness.mjs";
import { DEFAULT_POLICY, DRAFT, SHIELD_BATCH, inboxById, sampleShieldInboxCtx } from "./fixtures/shield.mjs";

const ctx = (overrides) => sampleShieldInboxCtx(overrides);
const base = ctx();
const I = inboxById(base);
const empty = () => ctx({ results: {} });
const withAnswer = (item, id, value) => ({ ...item, answers: { ...item.answers, [id]: { ...item.answers[id], value } } });

// Reference risks, worked out from the fixture's answers with the default weights in a separate Python script with
// exact fractions (1 − Π(1 − min(1, w × v))): maya 0.11052266160012156, bec 0.9931189981053575, admin
// 0.9863453563359268, stranger 0.19065294863777754, packright 0.5025492450267597, message-9 0.33268124608.
// Hot contributions (≥ 0.15) from the same script: bec 5, admin 4 (cred 0.864, mismatch 0.637, link 0.558, pressure
// 0.3), packright 2, maya 0.
const RISK = { packright: 0.5025492450267597 };

checkPack(pack, {
  // Only admin-phish's body has an address (http://harbor-admin-verify.example/login); the draft has none, so a variant
  // with two addresses gives 2.
  link_count: { items: [I["admin-phish"], I["maya-damaged"], { ...I["maya-damaged"], body: "See www.harbor.example and https://beans.example/a." }], values: [1, 0, 2] },
  // "$4,250.00" in bec; the page's own draft says "$500"; maya writes no amount.
  largest_amount: { items: [I["bec-invoice"], { ...I["maya-damaged"], subject: DRAFT.subject, body: DRAFT.body }, I["maya-damaged"]], values: [4250, 500, null] },
  // bec: "URGENT", "today"; admin: "Action required", "expires", "now"; maya none.
  urgency_words: { items: [I["bec-invoice"], I["admin-phish"], I["maya-damaged"]], values: [2, 3, 0] },
  // beanbrokers-payments.example has one hyphen; mail.example none; the odd address has no domain.
  domain_hyphens: { items: [I["bec-invoice"], I["maya-damaged"], I["message-9"]], values: [1, 0, null] },
  // maya asks for a refund; admin-phish asks for a password, not money.
  money_words: { items: [I["maya-damaged"], I["admin-phish"], I["jess-fan"]], values: [true, false, false] },
  credential_words: { items: [I["admin-phish"], I["bec-invoice"], I["maya-damaged"]], values: [true, false, false] },
  // A-1041, INV-7781 and A-1043; admin-phish's "6-digit" is not a reference.
  reference_number: { items: [I["maya-damaged"], I["bec-invoice"], I["stranger-refund"], I["admin-phish"]], values: [true, true, true, false] },
  // maya and stranger-refund both write from mail.example.
  shared_domain: { ctx: base, items: [I["maya-damaged"], I["stranger-refund"], I["bec-invoice"], I["message-9"]], values: [true, true, false, false] },
  // "Orders@PackRight.example " has capitals and a trailing space.
  address_untidy: { items: [I["packright-proof"], I["maya-damaged"], I["message-9"]], values: [true, false, false] },
  local_part: { items: [I["bec-invoice"], I["maya-damaged"], I["packright-proof"], I["message-9"]], values: ["accounts", "maya.chen", "Orders", ""] },
  expected: { items: [I["maya-damaged"], I["bec-invoice"], I["message-9"], I["packright-proof"]], values: ["safe", "quarantine", null, "safe"] },

  // Risk minus the review_at now on the sliders (moved to 0.45 here, so a fixed 0.3 would fail): maya
  // 0.11052266160012156 − 0.45 = −0.3394773383998784, bec 0.5431189981053576; unscreened and failed have none.
  review_margin: { ctx: ctx({ policy: { ...DEFAULT_POLICY, review_at: 0.45 } }), items: [I["maya-damaged"], I["bec-invoice"], I["northside-reschedule"], I.newsletter],
    values: [-0.3394773383998784, 0.5431189981053576, null, null], tolerance: 1e-12 },
  // bec: 0.873, 0.616, 0.588, 0.45, 0.285 ≥ 0.15; admin four; packright: link 0.33 and pressure 0.5 × 0.3 = 0.15 exactly
  // (counts, ≥); maya none; a verdict without a signal list is unavailable rather than an error.
  hot_signals: { ctx: base, items: [I["bec-invoice"], I["admin-phish"], I["packright-proof"], I["maya-damaged"], I["northside-reschedule"], { ...I["maya-damaged"], verdict: {} }],
    values: [5, 4, 2, 0, null, null] },
  // "beanbrokers-payments.example" → "beanbrokers.example" deletes "-payments" (9); harborcoffee-support → harborcoffee
  // deletes "-support" (8); packright matches (0); maya claims a customer, who has no known domain.
  domain_distance: { items: [I["bec-invoice"], I["admin-phish"], I["packright-proof"], I["maya-damaged"]], values: [9, 8, 0, null] },
  drivers: { ctx: base, items: [I["bec-invoice"], I["packright-proof"], I["maya-damaged"], I["northside-reschedule"], { ...I["maya-damaged"], verdict: { drivers: "pressure" } }],
    values: ["Instructs an AI, Domain mismatch, Payment redirect", "Link lure, Time pressure", "", "", ""] },
  // Scores 0.1, 1.9, 1, 0.6 round to levels 0, 2, 1, 1.
  pressure_level: { items: [I["maya-damaged"], I["bec-invoice"], I["packright-proof"], I["stranger-refund"], I["northside-reschedule"]],
    values: ["None", "Strong", "Mild", "Mild", null] },

  // Reports below 0.2 only: 0.2 itself is quiet.
  link_not_lure: { hit: withAnswer(I["admin-phish"], "link_lure", 0.1), miss: [I["admin-phish"], withAnswer(I["admin-phish"], "link_lure", 0.2), I["maya-damaged"], I["northside-reschedule"]],
    message: /^The text holds 1 web address \(a plain match\), but P\(link lure\) is 10\.0%/ },
  amount_not_payment: { hit: { ...I["maya-damaged"], body: `${I["maya-damaged"].body} It cost $38.00.` },
    miss: [I["bec-invoice"], I["maya-damaged"], { ...I["northside-reschedule"], body: "We owe $20." }, withAnswer({ ...I["maya-damaged"], body: "It cost $38.00." }, "payment_change", 0.2)],
    message: /^The text mentions 1 dollar amount \(largest \$38, a plain match\), but P\(payment redirect\) is 3\.0%\.$/ },
  // packright with a loss score of 2.6: risk 50.3% < 60% and no quarantine rule, so only the loss lifted it.
  // A verdict that lists no rules at all reads as "no quarantine rule" (risk 0.503 prints as 50.3%).
  harm_lifted: { ctx: base, hit: [{ ...I["packright-proof"], verdict: { ...I["packright-proof"].verdict, level: "quarantine", harm: 2.6 } },
      { ...I["packright-proof"], verdict: { level: "quarantine", risk: 0.503, harm: 2.6 } }],
    // Quiet: not quarantined; over the quarantine cut; a quarantine rule fired under the cut; loss 2.4 under 2.5; no risk.
    miss: [I["packright-proof"], I["bec-invoice"], { ...I["bec-invoice"], verdict: { ...I["bec-invoice"].verdict, risk: 0.5 } },
      { ...I["packright-proof"], verdict: { ...I["packright-proof"].verdict, level: "quarantine", harm: 2.4 } },
      { ...I["packright-proof"], verdict: { level: "quarantine", risk: null, harm: 2.6 } }, I["northside-reschedule"]],
    message: /^Quarantined because loss if obeyed is 2\.6, at least 2\.5: the risk 50\.3% is under the quarantine threshold 60\.0%/ },
  vendor_redirect: { ctx: base, hit: withAnswer(I["packright-proof"], "payment_change", 0.7), miss: [I["packright-proof"], I["bec-invoice"], I["northside-reschedule"]],
    message: /^PackRight Packaging writes from its own domain \(packright\.example\), yet P\(payment redirect\) is 70\.0%/ },
  attack_passed: { hit: I["stranger-refund"], miss: [I["maya-damaged"], I["bec-invoice"], I["northside-reschedule"]], message: /a demo note, never sent to Jev/ },
  domain_split: { hitList: [I["maya-damaged"], { ...I["stranger-refund"], verdict: { ...I["stranger-refund"].verdict, level: "review" } }, I["bec-invoice"]],
    missList: base.items(), message: /^mail\.example has mixed verdicts: 1 safe, 1 review\.$/ },

  // Sorted risks 0.1105, 0.1907, 0.3327, 0.5025, 0.9863, 0.9931: the median is the mean of the middle two,
  // (0.33268124608 + 0.5025492450267597) / 2 = 0.41761524555337987.
  median_risk: [{ ctx: base, expect: (result) => { assert.ok(Math.abs(result.value - 0.41761524555337987) < 1e-12); assert.equal(result.detail, "of 6 screened messages"); }, empty: empty() },
    { ctx: ctx({ hide: ["maya-damaged"] }), expect: RISK.packright, tolerance: 1e-12 }],
  // (1210 + 64) + (1388 + 66) + (1302 + 65) + (1180 + 64) + (1250 + 65) = 6654 over 5 calls; the odd message reports no tokens.
  tokens_per_call: [{ ctx: base, expect: (result) => { assert.equal(result.value, 1330.8); assert.equal(result.detail, "over 5 measured calls"); }, empty: empty() },
    { ctx: ctx({ hide: ["bec-invoice", "admin-phish"] }), expect: (1274 + 1244 + 1315) / 3, tolerance: 1e-12 }],
  // 1000 × 0.00161 / 5.
  cost_per_thousand: [{ ctx: base, expect: 0.322, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ hide: ["maya-damaged", "admin-phish", "stranger-refund", "packright-proof"] }), expect: 0.35, tolerance: 1e-12 }],
  // 3565.7 ms of calls in 1612.4 ms of wall time.
  batch_speedup: [{ ctx: ctx({ batch: SHIELD_BATCH }), expect: (result) => { assert.ok(Math.abs(result.value - 3565.7 / 1612.4) < 1e-12); assert.equal(result.detail, "3566 ms of calls in 1612 ms"); }, empty: base }],
  // Scenario attacks: bec (quarantine), admin (quarantine), stranger (safe).
  attack_catch: [{ ctx: base, expect: (result) => { assert.ok(Math.abs(result.value - 2 / 3) < 1e-12); assert.equal(result.detail, "2 of 3 scenario attacks"); }, empty: empty() },
    { ctx: ctx({ hide: ["stranger-refund"] }), expect: 1 }],
}, { ctx: () => sampleShieldInboxCtx() });
