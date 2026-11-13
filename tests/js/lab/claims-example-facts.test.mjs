import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/claims/claims-example-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleClaimsExamplesCtx, sampleClaimsHistory } from "./fixtures/claims.mjs";

// The fixture's five examples: Torn bag (A-1041, approve), Intact bag (A-1041, retake), Crushed box (A-1044, review,
// loaded in the form), Grinder (A-1042, retake) and "Example 5" (A-1047, unknown sample, blank note, no valid
// expectation). This session checked Torn bag (approve), Intact bag (retake), an upload, and Crushed box (review).
const page = sampleClaimsExamplesCtx();
const items = page.items();
const only = (...labels) => sampleClaimsExamplesCtx({ matches: (item) => labels.includes(item.label) });
// The same session, except that the Crushed box check was approved when sent.
const disagreeing = () => {
  const history = sampleClaimsHistory();
  history[3] = { ...history[3], verdict: { ...history[3].verdict, decision: "approve" } };
  return sampleClaimsExamplesCtx({ history });
};

checkPack(pack, {
  label: { items, values: ["Torn bag", "Intact bag", "Crushed box", "Grinder", "Example 5"] },
  order: { items, values: ["A-1041", "A-1041", "A-1044", "A-1042", "A-1047"] },
  sample: { items: [items[0], items[3], { sample: "" }], values: ["torn-bag", "grinder-ok", null] },
  expectation: { items, values: ["approve", "retake", "review", "retake", null] },
  // "One bag's seal was torn open and beans spilled all over the box." is 64 characters; the blank note is 3 spaces.
  chars: { items: [...items, { chars: "64" }], values: [64, 51, 41, 37, 3, null] },
  words: { items, values: [13, 10, 8, 5, 0] },
  loaded: { items, values: [false, false, true, false, false] },
  was_checked: { items, values: [true, true, true, false, false] },
  checks: { items, values: [1, 1, 1, 0, 0] },
  // A-1041 $38, A-1044 $64, A-1042 $249; A-1047 has no total.
  order_total: { items, values: [38, 38, 64, 249, null], ctx: page },
  // A-1047 is still processing.
  order_open: { items, values: [true, true, true, true, false], ctx: page },

  expectation_differs: { hit: items[2], miss: [items[0], items[1], items[3], items[4]], ctx: disagreeing(),
    message: /^check 4 of this session decided approve when sent; the written expectation is review\.$/ },
  order_missing: { hit: { label: "Lost order", order: "A-1099" }, miss: [items[0], items[4]], ctx: page, message: /^order A-1099 is not among the loaded orders\.$/ },

  // Torn bag, Intact bag and Crushed box were checked; hiding Torn bag leaves two.
  examples_checked: [{ ctx: page, expect: 3, empty: sampleClaimsExamplesCtx({ history: [], calls: 0 }) },
    { ctx: sampleClaimsExamplesCtx({ matches: (item) => item.label !== "Torn bag" }), expect: 2 }],
  // Three example checks (the upload matches no example): all agree, or two of three once Crushed box was approved.
  expectation_agreement: [{ ctx: page, expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "3 of 3"); },
    empty: sampleClaimsExamplesCtx({ history: [], calls: 0 }) },
  { ctx: disagreeing(), expect: (result) => { assert.ok(Math.abs(result.value - 2 / 3) < 1e-12); assert.equal(result.detail, "2 of 3"); } }],

  examples_csv: { ctx: only("Grinder", "Example 5"), filename: "claims-examples.csv",
    text: "\"label\",\"order\",\"sample\",\"note\",\"written_expectation\"\r\n"
      + "\"Grinder\",\"A-1042\",\"grinder-ok\",\"The grinder's hopper arrived cracked.\",\"retake\"\r\n"
      + "\"Example 5\",\"A-1047\",\"mystery\",\"   \",\"\"\r\n" },
  expectations_markdown: { ctx: only("Torn bag", "Grinder"), filename: "claims-expectations.md",
    text: "| example | written expectation | your latest check (decision when sent) |\n| --- | --- | --- |\n"
      + "| Torn bag | approve | approve (check 1) |\n| Grinder | retake | not checked this session |\n" },

  // Crushed box (index 2) is loaded: next is Grinder (3), previous Intact bag (1).
  next_example: { ctx: () => sampleClaimsExamplesCtx(), check: (ctx) => { assert.deepEqual(ctx.log, [["use", 3]]); assert.equal(ctx.state.order, "A-1042"); },
    hidden: () => sampleClaimsExamplesCtx({ running: true }) },
  previous_example: { ctx: () => sampleClaimsExamplesCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["use", 1]]),
    hidden: () => sampleClaimsExamplesCtx({ matches: () => false }) },
  first_unchecked: { ctx: () => sampleClaimsExamplesCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["use", 3]]),
    hidden: () => sampleClaimsExamplesCtx({ matches: (item) => item.checked > 0 }) },
  focus_run: { ctx: () => sampleClaimsExamplesCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["focusRun"]]), hidden: () => sampleClaimsExamplesCtx({ running: true }) },
}, { ctx: () => sampleClaimsExamplesCtx() });
