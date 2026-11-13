import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/shield/shield-inbox-triage.js";
import { checkPack } from "./harness.mjs";
import { inboxById, sampleShieldInboxCtx } from "./fixtures/shield.mjs";

const ctx = (overrides) => sampleShieldInboxCtx(overrides);
const base = ctx();
const I = inboxById(base);
const feature = (id) => pack.features.find((entry) => entry.id === id);
const empty = () => ctx({ results: {} });
const ALL_BUT = (...keep) => ({ hide: base.items().map((item) => item.id).filter((id) => !keep.includes(id)) });

checkPack(pack, {
  // Risks worked out from the fixture's answers with the default weights: maya 1 − Π(1 − c) over 0.018, 0.009, 0.018,
  // 0.01, 0.03, 0.016, 0.015, 0 = 0.1105226616; bec 0.9931189981; packright 0.502549245; northside has no result.
  risk: { items: [I["maya-damaged"], I["bec-invoice"], I["northside-reschedule"], I["packright-proof"]], values: [0.1105226616, 0.9931189981, null, 0.502549245], tolerance: 1e-9 },
  // The odd message's harm is the text "unknown".
  harm: { items: [I["maya-damaged"], I["admin-phish"], I["northside-reschedule"], I["message-9"]], values: [0.9, 3, null, null] },
  latency: { items: [I["maya-damaged"], I["packright-proof"], I["message-9"], I.newsletter], values: [412.5, 1500, null, null] },
  cost: { items: [I["bec-invoice"], I["stranger-refund"], I.newsletter], values: [0.00035, 0.0003, null] },
  // maya: link lure 0.05 × 0.6; bec: ai_instructions 0.97 × 0.9.
  strongest: { items: [I["maya-damaged"], I["bec-invoice"], I["northside-reschedule"]], values: [0.03, 0.873, null], tolerance: 1e-9 },
  // 0.3 − 0.1105226616 and 0.3326812461 − 0.3; jess-fan was skipped.
  threshold_distance: { ctx: base, items: [I["maya-damaged"], I["message-9"], I["jess-fan"]], values: [0.1894773384, 0.0326812461, null], tolerance: 1e-9 },
  rule_count: { items: [I["bec-invoice"], I["maya-damaged"], I["northside-reschedule"]], values: [2, 0, null] },
  level: { items: [I["maya-damaged"], I["bec-invoice"], I["packright-proof"], I["northside-reschedule"]], values: ["safe", "quarantine", "review", null] },
  category: { ctx: base, items: [I["maya-damaged"], I["bec-invoice"], I["message-9"], I["northside-reschedule"]], values: ["Customer request", "Vendor business", null, null] },
  claimed: { ctx: base, items: [I["bec-invoice"], I["admin-phish"], I["message-9"], I["northside-reschedule"]],
    values: ["Bean Brokers Ltd", "Harbor Coffee (internal)", "Other organization", null] },
  status: { items: [I["northside-reschedule"], I["maya-damaged"], I.newsletter, I["jess-fan"]], values: ["not screened yet", "screened", "failed", "skipped by the batch"] },
  // "Orders@PackRight.example " is trimmed and lowercased; the odd address has no @.
  domain: { items: [I["bec-invoice"], I["packright-proof"], I["message-9"]], values: ["beanbrokers-payments.example", "packright.example", ""] },
  lookalike: { items: [I["bec-invoice"], I["packright-proof"], I["maya-damaged"]], values: [true, false, false] },
  mismatch: { items: [I["admin-phish"], I["packright-proof"], I["message-9"]], values: [true, false, false] },
  differs: { items: [I["packright-proof"], I["maya-damaged"], I["northside-reschedule"]], values: [true, false, false] },

  near_threshold: { ctx: base, hit: I["message-9"], miss: [I["maya-damaged"], I["packright-proof"], I["northside-reschedule"]],
    message: /^Risk 33\.3% is 3\.3 points from the review threshold \(30\.0%\): a small weight change can flip this verdict\.$/ },
  unlike_note: { hit: I["packright-proof"], miss: [I["maya-damaged"], I["message-9"], I["northside-reschedule"]],
    message: /^Verdict review, but the scenario note expects safe \(a demo note, never sent to Jev\): Approve the label proof/ },
  no_result: { hit: [I.newsletter, I["jess-fan"]], miss: [I["maya-damaged"], I["northside-reschedule"]], message: /^The (screen failed|batch skipped it): .+\. Click it to screen it again\.$/ },
  unsure_sender: { ctx: base, hit: { ...I["bec-invoice"], fact: { ...I["bec-invoice"].fact, claimed_identity_prob: 0.55 } },
    miss: [I["bec-invoice"], I["packright-proof"], I["northside-reschedule"]],
    message: /^beanbrokers-payments\.example is not beanbrokers\.example, but P\(claimed sender\) is 55\.0%, below 60\.0%/ },
  unscreened_left: { hitList: base.items(), missList: base.items().filter((item) => item.id !== "northside-reschedule"),
    message: /^1 shown message not screened yet: #3\.$/ },

  // Screened: maya, bec, admin, stranger, packright and the odd message; 9 shown.
  screened_count: [{ ctx: base, expect: (result) => { assert.equal(result.value, 6); assert.equal(result.detail, "of 9 shown"); }, empty: empty() },
    { ctx: ctx({ hide: ["maya-damaged"] }), expect: 5 }],
  // bec and admin of the six.
  quarantine_share: [{ ctx: base, expect: 1 / 3, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ hide: ["bec-invoice"] }), expect: 0.2, tolerance: 1e-12 }],
  // Judged: maya, bec, admin, stranger agree; packright does not; the odd message has no note.
  agreement: [{ ctx: base, expect: (result) => { assert.equal(result.value, 0.8); assert.equal(result.detail, "4 of 5"); }, empty: empty() },
    { ctx: ctx({ hide: ["packright-proof"] }), expect: 1 }],
  // 0.00031 + 0.00035 + 0.00033 + 0.0003 + 0.00032; the odd message has no measured cost.
  measured_cost: [{ ctx: base, expect: (result) => { assert.ok(Math.abs(result.value - 0.00161) < 1e-12); assert.equal(result.detail, "5 measured calls"); }, empty: empty() }],
  // (412.5 + 455 + 398.2 + 420 + 1500) / 5; without packright (1685.7) / 4.
  mean_latency: [{ ctx: base, expect: 637.14, tolerance: 1e-9, empty: empty() }, { ctx: ctx({ hide: ["packright-proof"] }), expect: 421.425, tolerance: 1e-9 }],

  verdicts_csv: { ctx: ctx(ALL_BUT("bec-invoice", "northside-reschedule")), filename: "shield-verdicts.csv",
    includes: ['"position","from","sender_domain","subject","status","verdict","risk","harm","hard_rules","scenario_expected","matches_note"\r\n',
      '"2","Bean Brokers Ltd - Accounts","beanbrokers-payments.example","URGENT: updated remittance details for INV-7781","screened","quarantine","0.99311899',
      '"2.9","prompt_injection impersonation","quarantine","yes"\r\n',
      '"3","Dana Park, Northside Bistro","northsidebistro.example","Tasting this week","unscreened","","","","","safe",""\r\n'],
    excludes: ["Our bank has changed", "Maya", "0.97"],
    check: (out) => assert.equal(out.text.split("\r\n").length, 4, "a header, two rows and the final line break") },
  triage_md: { ctx: base, filename: "shield-triage.md", text: [
    "# Shield triage", "",
    "## Quarantined (2)", "",
    "- Bean Brokers Ltd - Accounts: URGENT: updated remittance details for INV-7781 · risk 99.3% · prompt_injection, impersonation",
    "- Harbor Coffee IT Support: Action required: store admin password expires in 2 hours · risk 98.6% · credential_phish, impersonation", "",
    "## Hold for a human (2)", "",
    "- Kim Lee, PackRight Packaging: Label proof needs approval by Friday · risk 50.3%",
    "- #9: (no subject) · risk 33.3%", "",
    "## Nothing suspicious (2)", "",
    "- Maya Chen: Order A-1041 arrived damaged · risk 11.1%",
    "- K. Jones: never got my espresso sampler · risk 19.1%", "",
    "6 messages screened, 3 without a verdict.", ""].join("\n") },

  // bec (#2) is open; #3 northside is unscreened and skipped, so next is #4 admin.
  next_screened: { ctx: () => ctx(), check: (c) => { assert.deepEqual(c.log, [["open", "admin-phish"]]); assert.equal(c.state.selected, "admin-phish"); }, hidden: empty },
  // Back from bec is maya (#1); back again wraps to the odd message (#9).
  previous_screened: { ctx: () => ctx(), hidden: empty,
    check: async (c) => {
      assert.deepEqual(c.log, [["open", "maya-damaged"]]);
      await feature("previous_screened").run(c);
      assert.deepEqual(c.log.at(-1), ["open", "message-9"]);
    } },
}, { ctx: () => ctx() });
