import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/autopilot/autopilot-waiting.js";
import { emptyInboxCtx, sampleInboxCtx } from "./fixtures/autopilot.mjs";
import { checkPack } from "./harness.mjs";

// The three waiting emails of the fixture: a cracked-grinder refund with a photo (next), a phishing email with two
// links, and a note with no label, subject, sender name or body. Plus a made-up invoice email and an odd empty item.
const [grinder, phish, blank] = sampleInboxCtx().items();
const invoice = { subject: "Invoice RW-4410", body: "Pay $1,980.00 now, or $20 later", sender_domain: "roastwell.example", from_name: "Ana Lima" };
// Two more made-up items: amounts written in words (Dispatch's pattern also reads "45 USD" and "30 dollars"), and a
// note naming a real-format order (A-1041) and invoice (INV-7781) of the world's data.
const words = { subject: "Refund", body: "Please refund 45 USD or 30 dollars, not $12.5" };
const refs = { subject: "Order A-1041", body: "See INV-7781." };
const all = () => [grinder, phish, blank, invoice, {}];

checkPack(pack, {
  body_words: { items: all(), values: [17, 20, 0, 6, null] },
  link_count: { items: all(), values: [0, 2, 0, 0, null] },
  // Reference: jev/dispatch.py AMOUNT_RE run in Python on the same texts gives [249], [1980, 20] and [45, 30, 12.5].
  largest_amount: { items: [...all(), words], values: [249, null, null, 1980, null, 45] },
  attachment: { items: all(), values: [true, false, false, false, false] },
  scenario_attack: { items: all(), values: [true, true, false, false, false] },
  order_ref: { items: [...all(), refs], values: [true, false, false, false, false, true] },
  invoice_ref: { items: [...all(), refs], values: [false, false, false, true, false, true] },
  next_up: { items: all(), values: [true, false, false, false, false] },
  sender_domain: { items: all(), values: ["example.com", "harborcoffee-help.example", "parcelhub.example", "roastwell.example", null] },
  expected_verdict: { items: all(), values: ["safe", "quarantine", null, null, null] },
  subject: { items: all(), values: ["Grinder arrived cracked", "Password expires in 2 hours", "", "Invoice RW-4410", ""] },
  sender_name: { items: all(), values: ["Kai Moore", "Harbor Coffee IT Desk", "", "Ana Lima", ""] },

  bank_details: { hit: { subject: "New bank", body: "Pay to routing 011000015, account 55501234." }, miss: [grinder, phish, blank, invoice, {}], message: /plain-code heuristic/ },
  // harbor-coffee.example holds the name once hyphens go; a subdomain of the real domain is not a lookalike.
  lookalike_domain: { hit: [phish, { sender_domain: "harbor-coffee.example" }], miss: [grinder, blank, invoice, { sender_domain: "harborcoffee.example" }, { sender_domain: "shop.harborcoffee.example" }, {}],
    message: /^harbor(coffee-help|-coffee)\.example looks like harborcoffee\.example but is not it \(plain-code heuristic, not a verdict\)\.$/ },
  credential_words: { hit: [phish, { subject: "Your verification code" }], miss: [grinder, blank, invoice, {}], message: /plain-code heuristic/ },
  same_sender: { hitList: [grinder, { sender_domain: "example.com" }, phish], missList: [grinder, phish, blank, {}], message: /^2 shown emails come from example\.com\.$/ },

  // The fixture page has 10 emails, 7 processed: grinder-crack, admin-reset and blank-note wait. With no records all 10
  // wait, 4 of them labelled attacks (vendor-redirect, sampler-refund, grinder-crack, admin-reset), 2 with photos.
  waiting_count: [{ ctx: sampleInboxCtx(), expect: 3 }, { ctx: sampleInboxCtx({ records: {} }), expect: 10, empty: emptyInboxCtx() }],
  attacks_waiting: [{ ctx: sampleInboxCtx(), expect: 2 }, { ctx: sampleInboxCtx({ records: {} }), expect: 4, empty: emptyInboxCtx() }],
  photos_waiting: [{ ctx: sampleInboxCtx(), expect: 1 }, { ctx: sampleInboxCtx({ records: {} }), expect: 2, empty: emptyInboxCtx() }],

  waiting_csv: { ctx: sampleInboxCtx({ matches: (item) => item.id !== "admin-reset" }), filename: "autopilot-waiting.csv",
    text: '"position","sender","address","subject","photo","scenario attack","scenario shield label"\r\n'
      + '"8","Kai Moore","kai.moore@example.com","Grinder arrived cracked","grinder.png","yes","safe"\r\n'
      + '"10","","no-reply@parcelhub.example","","","",""\r\n',
    excludes: ["hopper"] },
  copy_senders: { ctx: () => sampleInboxCtx(), hidden: () => emptyInboxCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.env.copied, ["kai.moore@example.com\nit@harborcoffee-help.example\nno-reply@parcelhub.example"]);
      assert.deepEqual(ctx.env.toasts.map((toast) => toast.message), ["Copied 3 sender addresses."]);
      assert.deepEqual(ctx.calls, [], "copying calls no page operation");
    } },
  // Edit distances and similarities checked with a separate Python Levenshtein; similarity is 1 - distance / longer length.
  domain_distance: { values: { b: "harborcoffee-help.example" },
    expect: [["Edit distance", 5], ["Similarity", 0.8], ["Same domain", "no"], ["Lookalike (plain-code rule)", "yes"]],
    more: [{ values: { b: " HarborCoffee.example " }, expect: [["Edit distance", 0], ["Similarity", 1], ["Same domain", "yes"], ["Lookalike (plain-code rule)", "no"]] },
      { values: { a: "roastwell.example", b: "roastwel.example" }, expect: [["Edit distance", 1], ["Similarity", 0.941], ["Same domain", "no"], ["Lookalike (plain-code rule)", "yes"]] },
      { values: { a: "abc.example", b: "xyz.example" }, expect: [["Edit distance", 3], ["Similarity", 0.727], ["Same domain", "no"], ["Lookalike (plain-code rule)", "no"]] },
      // A short sender whose name happens to occur inside the expected name is not a lookalike: 11 edits, 1 - 11/20.
      { values: { b: "a.example" }, expect: [["Edit distance", 11], ["Similarity", 0.45], ["Same domain", "no"], ["Lookalike (plain-code rule)", "no"]] },
      // Five edits apart, but it holds "roastwell" once hyphens go: 1 - 5/22 = 0.7727.
      { values: { a: "roastwell.example", b: "roast-well-pay.example" }, expect: [["Edit distance", 5], ["Similarity", 0.773], ["Same domain", "no"], ["Lookalike (plain-code rule)", "yes"]] }],
    invalid: [{ a: "harborcoffee.example", b: "  " }, { a: "", b: "x.example" }] },
}, { ctx: () => sampleInboxCtx() });
