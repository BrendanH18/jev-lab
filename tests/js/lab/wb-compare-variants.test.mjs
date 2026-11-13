// Tests for the Compare variant setup starter pack (static/js/lab/packs/workbench/wb-compare-variants.js). Expected
// values are worked out by hand from tests/js/lab/fixtures/workbench-compare.mjs (QUESTIONS_A and QUESTIONS_B).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/wb-compare-variants.js";
import { checkPack } from "./harness.mjs";
import { sampleCompareVariantsCtx } from "./fixtures/workbench-compare.mjs";

// department, urgent, tone, drink, spot, rush, allergy (A only), refund (B only)
const items = () => sampleCompareVariantsCtx().items();
const noul = (instructions) => ({ type: "noul", instructions });

checkPack(pack, {
  // department: "Team for this message?" (22) minus "Which Harbor Coffee Co. team should handle this message?" (56).
  instruction_char_delta: { items: items(), values: [-34, 0, 0, 0, 0, 0, null, null] },
  option_count_a: { items: items(), values: [4, null, 3, 3, null, null, null, null] },
  position_shift: { items: items(), values: [1, -1, 0, 0, 0, 0, null, null] },
  only_in_a: { items: items(), values: [false, false, false, false, false, false, true, false] },
  only_in_b: { items: items(), values: [false, false, false, false, false, false, false, true] },
  type_mismatch: { items: items(), values: [false, false, false, false, false, true, false, false] },
  instructions_changed: { items: items(), values: [true, false, false, false, false, false, false, false] },
  criteria_changed: { items: items(), values: [false, false, true, false, false, true, false, false] },
  order_only: { items: items(), values: [false, false, false, true, false, false, false, false] },
  status: { items: items(), values: ["reworded", "identical", "options changed", "options reordered", "identical", "retyped", "only A", "only B"] },
  qid: { items: items(), values: ["department", "urgent", "tone", "drink", "spot", "rush", "allergy", "refund"] },

  no_comparable: {
    hitList: [{ qid: "rush", a: { type: "noul" }, b: { type: "score" }, ia: 0, ib: 0, comparable: false }, { qid: "allergy", a: noul("x"), b: null, ia: 1, ib: null, comparable: false }],
    missList: items(),
    message: /share no question id/,
  },
  two_changes: {
    ctx: sampleCompareVariantsCtx(),
    hitList: items(),
    missList: items().filter((item) => item.qid === "urgent" || item.qid === "spot" || item.qid === "allergy"),
    message: /jev-latest against jev-1\.14\.0\) and 3 questions \(department, tone, drink\)/,
  },
  blank_instructions: {
    hit: [{ qid: "x", a: { type: "noul", instructions: "  " }, b: null }, { qid: "y", a: noul("ok"), b: { type: "noul" } }],
    miss: [items()[0], { qid: "z", a: { type: "box", instructions: { text: "Look at the photo" } }, b: null }],
    message: /has no instructions/,
  },

  copy_wording_to_b: {
    input: [
      { qid: "department", a: { type: "choice", instructions: "Which team?", criteria: { billing: "Money", other: "Else" } },
        b: { type: "choice", instructions: "Team?", criteria: { billing: "Money", other: "Else" } }, ia: 0, ib: 0, comparable: true },
      { qid: "rush", a: noul("Rush?"), b: { type: "score", instructions: "Rush order?", criteria: ["No", "Yes"] }, ia: 1, ib: 1, comparable: false },
      { qid: "urgent", a: noul("Today?"), b: noul("Need it today?"), ia: 2, ib: 2, comparable: true },
    ],
    shown: [0, 1],
    output: [
      { qid: "department", a: { type: "choice", instructions: "Which team?", criteria: { billing: "Money", other: "Else" } },
        b: { type: "choice", instructions: "Which team?", criteria: { billing: "Money", other: "Else" } }, ia: 0, ib: 0, comparable: true },
      { qid: "rush", a: noul("Rush?"), b: { type: "score", instructions: "Rush order?", criteria: ["No", "Yes"] }, ia: 1, ib: 1, comparable: false },
      { qid: "urgent", a: noul("Today?"), b: noul("Need it today?"), ia: 2, ib: 2, comparable: true },
    ],
    unchanged: [{ qid: "spot", a: { type: "box", instructions: "Where?" }, b: { type: "box", instructions: "Where?" }, ia: 0, ib: 0, comparable: true }],
  },
  drop_only_b: {
    input: [
      { qid: "a1", a: noul("x"), b: noul("x"), ia: 0, ib: 0, comparable: true },
      { qid: "b1", a: null, b: noul("y"), ia: null, ib: 1, comparable: false },
      { qid: "b2", a: null, b: noul("z"), ia: null, ib: 2, comparable: false },
    ],
    shown: [0, 1],
    output: [
      { qid: "a1", a: noul("x"), b: noul("x"), ia: 0, ib: 0, comparable: true },
      { qid: "b2", a: null, b: noul("z"), ia: null, ib: 2, comparable: false },
    ],
    unchanged: [{ qid: "a1", a: noul("x"), b: noul("x"), ia: 0, ib: 0, comparable: true }],
  },
  sort_a_by_id: {
    input: [
      { qid: "tone", a: { type: "score" }, b: null, ia: 0, ib: null, comparable: false },
      { qid: "department", a: { type: "choice" }, b: null, ia: 1, ib: null, comparable: false },
      { qid: "urgent", a: { type: "noul" }, b: null, ia: 2, ib: null, comparable: false },
    ],
    output: [
      { qid: "department", a: { type: "choice" }, b: null, ia: 1, ib: null, comparable: false },
      { qid: "tone", a: { type: "score" }, b: null, ia: 0, ib: null, comparable: false },
      { qid: "urgent", a: { type: "noul" }, b: null, ia: 2, ib: null, comparable: false },
    ],
  },

  questions_to_b: {
    text: '{"refund": {"type": "noul", "instructions": "Money back?"}, "gift": {"type": "choice", "criteria": {"yes": null, "no": null}}}',
    items: [
      { qid: "refund", a: null, b: { type: "noul", instructions: "Money back?" }, ia: null, ib: null, comparable: false },
      { qid: "gift", a: null, b: { type: "choice", criteria: { yes: null, no: null } }, ia: null, ib: null, comparable: false },
    ],
    warnings: 1,
    rejects: ["[1, 2]", "not json", '{"x": {"type": "rating"}}', "{}", '{"  ": {"type": "noul"}}'],
  },

  diff_markdown: {
    ctx: sampleCompareVariantsCtx({ hide: ["urgent", "tone", "drink", "spot", "rush"] }),
    filename: "compare-question-differences.md",
    text: "| question | A | B | change |\n| --- | --- | --- | --- |\n| department | choice | choice | reworded |\n| allergy | noul | — | only A |\n| refund | — | noul | only B |\n",
    excludes: ["Which Harbor", "Team for"],
  },
  b_shown_json: {
    ctx: sampleCompareVariantsCtx({ hide: ["department", "tone", "drink", "spot", "rush"], order: ["refund"] }),
    filename: "variant-b-questions.json",
    text: '{\n  "refund": {\n    "type": "noul",\n    "instructions": "Does the writer ask for money back?"\n  },\n'
      + '  "urgent": {\n    "type": "noul",\n    "instructions": "Does the writer need an answer today?"\n  }\n}\n',
  },

  comparable_count: [
    { ctx: sampleCompareVariantsCtx(), expect: 5, empty: sampleCompareVariantsCtx({ texts: ["", ""] }) },
    { ctx: sampleCompareVariantsCtx({ texts: ['{"urgent": {"type": "noul"}}', "{ not json"] }), expect: 0 },
  ],
  one_sided_count: [
    { ctx: sampleCompareVariantsCtx(), expect: 2, empty: sampleCompareVariantsCtx({ texts: ["", ""] }) },
    { ctx: sampleCompareVariantsCtx({ texts: ['{"urgent": {"type": "noul"}}', '{"urgent": {"type": "score"}}'] }), expect: 0 },
  ],

  order_check: {
    ctx: () => sampleCompareVariantsCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["reverseA"]]),
    hidden: () => sampleCompareVariantsCtx({ running: true }),
  },
}, { ctx: () => sampleCompareVariantsCtx() });

test("wb-compare-variants: the order check is hidden while A does not parse", () => {
  const feature = pack.features.find((entry) => entry.id === "order_check");
  assert.equal(feature.when(sampleCompareVariantsCtx({ texts: ["{ oops", "{}"] })), false);
});

test("wb-compare-variants: an imported question lands at the end of B through importItems", () => {
  const ctx = sampleCompareVariantsCtx();
  const importer = pack.features.find((entry) => entry.id === "questions_to_b");
  ctx.actions.importItems(importer.parse('{"gift": {"type": "noul", "instructions": "Is it a gift?"}}').items);
  assert.deepEqual(Object.keys(JSON.parse(ctx.state.variants[1].text)), ["urgent", "department", "tone", "drink", "spot", "rush", "refund", "gift"]);
  assert.equal(ctx.state.variants[0].text, sampleCompareVariantsCtx().state.variants[0].text, "A keeps its text byte for byte");
});
