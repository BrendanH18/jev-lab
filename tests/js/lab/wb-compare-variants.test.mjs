// Tests for the Compare variant setup starter pack (static/js/lab/packs/workbench/wb-compare-variants.js). Expected
// values are worked out by hand from tests/js/lab/fixtures/workbench-compare.mjs (QUESTIONS_A and QUESTIONS_B).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/wb-compare-variants.js";
import { applyTransform, previewTransform, snapshot, undoTransform } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { sampleCompareVariantsCtx } from "./fixtures/workbench-compare.mjs";

// department, urgent, tone, drink, spot, rush, allergy (A only), refund (B only)
const items = () => sampleCompareVariantsCtx().items();
const noul = (instructions) => ({ type: "noul", instructions });
const feature = (id) => pack.features.find((entry) => entry.id === id);
// A has rush (Noul) and allergy; B asks rush as a Score: nothing comparable.
const NOTHING_SHARED = ['{"rush": {"type": "noul", "instructions": "Rush?"}, "allergy": {"type": "noul", "instructions": "Allergy?"}}',
  '{"rush": {"type": "score", "instructions": "Rush?", "criteria": ["No", "Yes"]}}'];

checkPack(pack, {
  // department: "Team for this message?" (22) minus "Which Harbor Coffee Co. team should handle this message?" (56).
  instruction_char_delta: { items: [...items(), { a: noul("café"), b: noul("cafe ☕☕") }], values: [-34, 0, 0, 0, 0, 0, null, null, 3] },
  option_count_a: { items: items(), values: [4, null, 3, 3, null, null, null, null] },
  // A: department 0, urgent 1, tone 2, drink 3, spot 4, rush 5, allergy 6; B: urgent 0, department 1, then the same.
  position_shift: { items: items(), values: [1, -1, 0, 0, 0, 0, null, null] },
  only_in_a: { items: items(), values: [false, false, false, false, false, false, true, false] },
  only_in_b: { items: items(), values: [false, false, false, false, false, false, false, true] },
  type_mismatch: { items: items(), values: [false, false, false, false, false, true, false, false] },
  instructions_changed: { items: items(), values: [true, false, false, false, false, false, false, false] },
  criteria_changed: { items: items(), values: [false, false, true, false, false, true, false, false] },
  order_only: { items: items(), values: [false, false, false, true, false, false, false, false] },
  status: {
    items: [...items(),
      { qid: "w", a: { type: "noul", instructions: "x" }, b: { instructions: "x", type: "noul" } },
      { qid: "e", a: { type: "noul", instructions: "x", note: 1 }, b: { type: "noul", instructions: "x", note: 2 } }, {}],
    values: ["reworded", "identical", "options changed", "options reordered", "identical", "retyped", "only A", "only B",
      "written in another order", "other fields changed", null],
  },
  qid: { items: items(), values: ["department", "urgent", "tone", "drink", "spot", "rush", "allergy", "refund"] },

  no_comparable: {
    ctx: sampleCompareVariantsCtx({ texts: NOTHING_SHARED }),
    hitList: sampleCompareVariantsCtx({ texts: NOTHING_SHARED }).items(),
    missCtx: sampleCompareVariantsCtx(),
    missList: items(),
    message: /share no question id/,
  },
  // A's blank model reads as the current model jev-latest; B asks jev-1.14.0. Changed compared questions: department
  // (reworded), tone (a level reworded), drink (options reordered); rush is retyped, so not compared.
  two_changes: {
    ctx: sampleCompareVariantsCtx(),
    hitList: items().filter((item) => item.qid === "urgent"),
    missCtx: sampleCompareVariantsCtx({ models: ["jev-latest", ""] }),
    missList: items(),
    message: /jev-latest against jev-1\.14\.0\) and 3 questions \(department, tone, drink\)/,
  },
  blank_instructions: {
    hit: [{ qid: "x", a: { type: "noul", instructions: "  " }, b: null }, { qid: "y", a: noul("ok"), b: { type: "noul" } },
      { qid: "n", a: { type: "noul", instructions: null }, b: null }],
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
  // B asks b1, a1, b2. Dropping b1 moves a1 to B's place 0 and b2 to place 1, as the editors would rebuild them.
  drop_only_b: {
    input: [
      { qid: "a1", a: noul("x"), b: noul("x"), ia: 0, ib: 1, comparable: true },
      { qid: "b1", a: null, b: noul("y"), ia: null, ib: 0, comparable: false },
      { qid: "b2", a: null, b: noul("z"), ia: null, ib: 2, comparable: false },
    ],
    shown: [0, 1],
    output: [
      { qid: "a1", a: noul("x"), b: noul("x"), ia: 0, ib: 0, comparable: true },
      { qid: "b2", a: null, b: noul("z"), ia: null, ib: 1, comparable: false },
    ],
    unchanged: [{ qid: "a1", a: noul("x"), b: noul("x"), ia: 0, ib: 0, comparable: true }],
  },
  // A's ids A to Z with new positions; B's only question (alpha) keeps B's order and goes after A's ids.
  sort_a_by_id: {
    input: [
      { qid: "tone", a: { type: "score" }, b: null, ia: 0, ib: null, comparable: false },
      { qid: "alpha", a: null, b: { type: "noul" }, ia: null, ib: 0, comparable: false },
      { qid: "department", a: { type: "choice" }, b: null, ia: 1, ib: null, comparable: false },
      { qid: "urgent", a: { type: "noul" }, b: null, ia: 2, ib: null, comparable: false },
    ],
    output: [
      { qid: "department", a: { type: "choice" }, b: null, ia: 0, ib: null, comparable: false },
      { qid: "tone", a: { type: "score" }, b: null, ia: 1, ib: null, comparable: false },
      { qid: "urgent", a: { type: "noul" }, b: null, ia: 2, ib: null, comparable: false },
      { qid: "alpha", a: null, b: { type: "noul" }, ia: null, ib: 0, comparable: false },
    ],
  },

  questions_to_b: {
    text: '{"refund": {"type": "noul", "instructions": "Money back?"}, "gift": {"type": "choice", "criteria": {"yes": null, "no": null}}}',
    items: [
      { qid: "refund", a: null, b: { type: "noul", instructions: "Money back?" }, ia: null, ib: null, comparable: false },
      { qid: "gift", a: null, b: { type: "choice", criteria: { yes: null, no: null } }, ia: null, ib: null, comparable: false },
    ],
    warnings: 1,
    rejects: ["[1, 2]", "not json", '{"x": {"type": "rating"}}', "{}", '{"  ": {"type": "noul"}}',
      '{"gift": {"type": "noul"}, "gift": {"type": "box"}}'],
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
    excludes: ["allergy"],
  },

  // department, urgent, tone, drink, spot are asked by both with one type; rush is retyped.
  comparable_count: [
    { ctx: sampleCompareVariantsCtx(), expect: 5, empty: sampleCompareVariantsCtx({ texts: ["", ""] }) },
    { ctx: sampleCompareVariantsCtx({ texts: NOTHING_SHARED }), expect: 0 },
    { ctx: sampleCompareVariantsCtx({ texts: ['{"urgent": {"type": "noul"}}', "{ not json"] }), expect: null },
  ],
  // allergy (A only) and refund (B only).
  one_sided_count: [
    { ctx: sampleCompareVariantsCtx(), expect: 2, empty: sampleCompareVariantsCtx({ texts: ["", ""] }) },
    { ctx: sampleCompareVariantsCtx({ texts: NOTHING_SHARED }), expect: 1 },
    { ctx: sampleCompareVariantsCtx({ texts: ['{"urgent": {"type": "noul"}}', '{"urgent": {"type": "score"}}'] }), expect: 0 },
    { ctx: sampleCompareVariantsCtx({ texts: ['{"urgent": {"type": "noul"}}', "{ not json"] }), expect: null },
  ],

  order_check: {
    ctx: () => sampleCompareVariantsCtx(),
    check: (ctx) => assert.deepEqual(ctx.log, [["reverseA"]]),
    hidden: () => sampleCompareVariantsCtx({ running: true }),
  },
}, { ctx: () => sampleCompareVariantsCtx() });

test("wb-compare-variants: the order check is hidden while A has no Choice question whose options can be reversed", () => {
  const when = feature("order_check").when;
  assert.equal(when(sampleCompareVariantsCtx({ texts: ["{ oops", "{}"] })), false);
  assert.equal(when(sampleCompareVariantsCtx({ texts: ['{"u": {"type": "noul"}}', "{}"] })), false);
  // Whole-number option names always list in ascending order, so reversing changes nothing.
  assert.equal(when(sampleCompareVariantsCtx({ texts: ['{"n": {"type": "choice", "criteria": {"1": "one", "2": "two"}}}', "{}"] })), false);
  assert.equal(when(sampleCompareVariantsCtx({ texts: ['{"n": {"type": "choice", "criteria": {"one": null}}}', "{}"] })), false);
  // One whole number and one name: "1" always lists first, so the reverse is the same list.
  assert.equal(when(sampleCompareVariantsCtx({ texts: ['{"n": {"type": "choice", "criteria": {"1": "one", "b": "bee"}}}', "{}"] })), false);
  // "1", "a", "b" reversed lists "1", "b", "a".
  assert.equal(when(sampleCompareVariantsCtx({ texts: ['{"n": {"type": "choice", "criteria": {"1": "one", "a": "ay", "b": "bee"}}}', "{}"] })), true);
});

test("wb-compare-variants: two changes at once is quiet when only the model differs", () => {
  const same = JSON.stringify({ urgent: noul("Today?") });
  const ctx = sampleCompareVariantsCtx({ texts: [same, same], models: ["jev-1.14.0", "jev-latest"] });
  assert.equal(feature("two_changes").check(ctx.items(), ctx), null);
});

test("wb-compare-variants: list edits rebuild exactly as the editors do, so Undo works", () => {
  // B lists a question only it asks before the shared ones, so dropping it and sorting A both move positions.
  const texts = [JSON.stringify({ tone: noul("t"), alpha: noul("a"), drink: noul("d") }), JSON.stringify({ extra: noul("x"), drink: noul("d"), tone: noul("t") })];
  for (const id of ["drop_only_b", "sort_a_by_id"]) {
    const ctx = sampleCompareVariantsCtx({ texts });
    const before = ctx.items();
    const preview = previewTransform(id, feature(id), before, new Set(before.map((_, index) => index)), {}, ctx);
    const applied = applyTransform(preview, before);
    ctx.actions.replaceItems(applied.items);
    assert.equal(snapshot(ctx.items()), snapshot(applied.items), `${id}: the rebuilt list matches the preview`);
    ctx.actions.replaceItems(undoTransform(applied.undo, ctx.items()));
    assert.equal(snapshot(ctx.items()), snapshot(before), `${id}: Undo restores the editors`);
  }
});

test("wb-compare-variants: an imported question lands at the end of B through importItems", () => {
  const ctx = sampleCompareVariantsCtx();
  ctx.actions.importItems(feature("questions_to_b").parse('{"gift": {"type": "noul", "instructions": "Is it a gift?"}}').items);
  assert.deepEqual(Object.keys(JSON.parse(ctx.state.variants[1].text)), ["urgent", "department", "tone", "drink", "spot", "rush", "refund", "gift"]);
  assert.equal(ctx.state.variants[0].text, sampleCompareVariantsCtx().state.variants[0].text, "A keeps its text byte for byte");
});

test("wb-compare-variants: odd items give unavailable facts, not exceptions", () => {
  for (const fact of pack.features.filter((entry) => entry.kind === "fact")) {
    for (const odd of [{}, { a: "text", b: 3, ia: "1" }]) {
      const value = fact.value(odd);
      assert.ok(value === null || value === false || value === "", `${fact.id} gave ${JSON.stringify(value)}`);
    }
  }
});
