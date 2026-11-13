// Tests for the Compare variant tools pack (static/js/lab/packs/workbench/compare-variant-tools.js). Expected values are
// worked out by hand from tests/js/lab/fixtures/workbench-compare.mjs (QUESTIONS_A, QUESTIONS_B) or from the small
// hand-made question lists below; comments give the arithmetic where it is not obvious.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/compare-variant-tools.js";
import { applyTransform, previewTransform, runImporter, undoTransform } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { QUESTIONS_A, QUESTIONS_B, sampleCompareVariantsCtx } from "./fixtures/workbench-compare.mjs";

// Fixture order: department, urgent, tone, drink, spot, rush (noul in A, score in B), allergy (A only), refund (B only).
const items = (overrides) => sampleCompareVariantsCtx(overrides).items();
const pick = (list, ...ids) => ids.map((qid) => list.find((item) => item.qid === qid));
const noul = (instructions) => ({ type: "noul", instructions });
const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
const row = (qid, a, b, ia, ib) => ({ qid, a, b, ia, ib, comparable: !!a && !!b && a.type === b.type });
const sameModels = { models: ["jev-1.14.0", "jev-1.14.0"] };

// A hand-made Choice pair: B drops "other", adds "refunds" and "gifts", and rewords billing's description.
const reshaped = row("team", choice("Team?", { billing: "Money", shipping: "Parcels", other: "Else" }),
  choice("Team?", { billing: "Charges", shipping: "Parcels", refunds: "Money back", gifts: "Gift cards" }), 0, 0);
const three = () => [row("p", noul("P?"), noul("P?"), 0, 0), row("q", noul("Q?"), null, 1, null), row("r", null, noul("R?"), null, 1)];
const lastRun = [{ name: "A", model: "jev-latest", perturb: null, average_orders: false, questions: QUESTIONS_A },
  { name: "B", model: "jev-1.14.0", perturb: null, average_orders: false, questions: QUESTIONS_B }];
const lastCtx = sampleCompareVariantsCtx({ lastRun });
// The same last run, but B's department instructions were edited since.
const editedB = JSON.stringify({ ...QUESTIONS_B, department: { ...QUESTIONS_B.department, instructions: "Which team?" } }, null, 2);
const lastEdited = sampleCompareVariantsCtx({ lastRun, texts: [JSON.stringify(QUESTIONS_A, null, 2), editedB] });
// A twice; and A against A with drink's options listed tea, filter, espresso (the only change: a clean order check).
const textA = JSON.stringify(QUESTIONS_A, null, 2);
const drinkMoved = JSON.stringify({ ...QUESTIONS_A, drink: QUESTIONS_B.drink }, null, 2);
const twinCtx = sampleCompareVariantsCtx({ ...sameModels, texts: [textA, textA] });
const twinTyposCtx = sampleCompareVariantsCtx({ ...sameModels, perturb: "typos", texts: [textA, textA] });
const cleanOrderCtx = sampleCompareVariantsCtx({ ...sameModels, texts: [textA, drinkMoved] });

checkPack(pack, {
  option_count_b: { items: items(), values: [4, null, 3, 3, null, 3, null, null] },
  // department: A's words {which, harbor, coffee, co, team, should, handle, this, message} (9), B's {team, for, this,
  // message} (4); shared 3 of 10 distinct = 0.3. The other shared questions keep their instructions word for word.
  instruction_overlap: { items: items(), values: [0.3, 1, 1, 1, 1, 1, null, null] },
  options_dropped: { items: [reshaped, items()[0], items()[1]], values: [1, 0, null] },
  options_added: { items: [reshaped, items()[0], items()[1]], values: [2, 0, null] },
  descriptions_reworded: { items: [reshaped, items()[0], items()[1]], values: [1, 0, null] },
  // department: instructions 22 - 56 bytes = -34; tone: "A little annoyed" (16) - "Annoyed" (7) = +9; rush: "score" is one
  // byte longer than "noul", plus ,"criteria":["No","Maybe","Yes"] (12 + 20 bytes) = +33. drink only reorders.
  size_change: { items: items(), values: [-34, 0, 9, 0, 0, 33, null, null] },
  whole_number_options: { items: [row("size", choice("Size?", { 1: "Small", 2: "Large" }), null, 0, null), items()[0], items()[1]], values: [true, false, false] },
  noul_criteria_one_side: {
    items: [row("gift", { type: "noul", instructions: "Gift?", criteria: { true: "A present", false: "Not a present" } }, noul("Gift?"), 0, 0), items()[1], items()[5]],
    values: [true, false, false],
  },
  renamed_option: {
    items: [row("team", choice("Team?", { billing: "Money", other: "Else" }), choice("Team?", { payments: "Money", other: "Else" }), 0, 0), reshaped, items()[0]],
    values: [true, false, false],
  },
  question_type: { items: items(), values: ["choice", "noul", "score", "choice", "box", "noul → score", "noul", "noul"] },
  instructions: {
    items: items(),
    values: ["Which Harbor Coffee Co. team should handle this message? | Team for this message?", "Does the writer need an answer today?",
      "How upset does the writer sound?", "Which drink is the message about?", "Where is the damage in the photo?", "Is this a rush order?",
      "Does the writer mention an allergy?", "Does the writer ask for money back?"],
  },

  // The setup checks below classify the whole request (every question, whatever is shown), so hit and miss differ by ctx.
  identical_variants: {
    ctx: twinCtx,
    hitList: twinCtx.items(),
    missCtx: twinTyposCtx,  // the same questions, but B's rows are rewritten
    missList: twinTyposCtx.items(),
    message: /^B asks all 7 questions exactly as A does/,
  },
  input_check_not_clean: {
    ctx: sampleCompareVariantsCtx({ ...sameModels, perturb: "typos", hide: ["department", "urgent", "tone", "drink", "rush", "allergy", "refund"] }),
    hitList: pick(items(), "spot"),  // only spot is shown, but the run sends every question
    missCtx: twinTyposCtx,
    missList: twinTyposCtx.items(),
    message: /^B's rows are sent with typos, but “department”, “urgent”, “tone”, “drink”, “rush”, “allergy” and “refund” are not asked exactly alike/,  // spot alone is asked alike, at place 5 in both
  },
  // department, tone, rush, allergy and refund differ as JSON values; urgent and spot are equal; drink is the reordered one.
  order_check_not_clean: {
    ctx: sampleCompareVariantsCtx(sameModels),
    hitList: pick(items(), "drink"),
    missCtx: cleanOrderCtx,
    missList: cleanOrderCtx.items(),
    message: /^B lists the options of “drink” in another order, but “department”, “tone”, “rush”, “allergy” and “refund” also differ; the questions are listed in another order/,
  },
  question_order_differs: {
    hitList: items(),
    missList: pick(items(), "tone", "drink", "spot", "allergy"),
    message: /A: department, urgent, tone, drink, spot, rush; B: urgent, department, tone, drink, spot, rush/,
  },
  several_reworded: {
    ctx: sampleCompareVariantsCtx(sameModels),
    hitList: items(),
    missList: pick(items(), "department", "urgent", "spot"),
    message: /^3 compared questions differ between A and B \(“department”, “tone” and “drink”\)/,
  },
  model_case: {
    ctx: sampleCompareVariantsCtx({ models: ["jev-1.14.0", "JEV-1.14.0"] }),
    hitList: items(),
    missList: pick(items(), "allergy", "refund", "rush"),
    message: /“jev-1\.14\.0” and B's “JEV-1\.14\.0” differ only in letter case/,
  },
  unpinned_model: {
    ctx: sampleCompareVariantsCtx(),
    hitList: items(),
    missList: pick(items(), "urgent", "spot", "allergy"),
    message: /^A asks “jev-latest” \(the current model, since its field is blank\).*such as jev-1\.14\.0\.$/,
  },
  unknown_model: {
    ctx: sampleCompareVariantsCtx({ models: ["jev-9.0.0", "jev-1.14.0"] }),
    hitList: items(),
    missList: pick(items(), "allergy", "refund"),
    message: /^A's model “jev-9\.0\.0” is not among the 2 models your key lists/,
  },
  same_as_last_run: {
    ctx: lastCtx,
    hitList: lastCtx.items(),
    missCtx: lastEdited,
    missList: lastEdited.items(),
    message: /exactly as in your last run/,
  },
  unscorable_labels: {
    hit: [reshaped, row("tone", { type: "score", criteria: ["Calm", "Angry", "Furious"] }, { type: "score", criteria: ["Calm", "Annoyed", "Angry", "Furious"] }, 0, 0)],
    miss: [items()[0], items()[2], items()[1]],
    message: /left out of both sides/,
  },

  rotate_options_b: {
    input: [row("d", choice("T?", { x: "X", y: "Y", z: "Z" }), choice("T?", { x: "X", y: "Y", z: "Z" }), 0, 0), row("u", noul("U?"), noul("U?"), 1, 1)],
    params: { by: 2 },
    output: [row("d", choice("T?", { x: "X", y: "Y", z: "Z" }), choice("T?", { z: "Z", x: "X", y: "Y" }), 0, 0), row("u", noul("U?"), noul("U?"), 1, 1)],
    unchanged: [row("n", choice("N?", { 1: "One", 2: "Two" }), choice("N?", { 1: "One", 2: "Two" }), 0, 0)],
    rejects: [{ params: { by: 0 }, message: /at least 1/ }],
  },
  // Reference order from a separate Python mulberry32/Fisher-Yates: seed 7 turns billing, shipping, wholesale, other
  // into wholesale, shipping, other, billing.
  shuffle_options_b: {
    input: [row("d", null, choice("T?", { billing: "B", shipping: "S", wholesale: "W", other: "O" }), null, 0), row("u", noul("U?"), noul("U?"), 0, 1)],
    params: { seed: 7 },
    output: [row("d", null, choice("T?", { wholesale: "W", shipping: "S", other: "O", billing: "B" }), null, 0), row("u", noul("U?"), noul("U?"), 0, 1)],
  },
  sort_options_b: {
    input: [row("drink", choice("D?", { tea: "T", filter: "F", espresso: "E" }), choice("D?", { tea: "T", filter: "F", espresso: "E" }), 0, 0)],
    output: [row("drink", choice("D?", { tea: "T", filter: "F", espresso: "E" }), choice("D?", { espresso: "E", filter: "F", tea: "T" }), 0, 0)],
    unchanged: [row("drink", null, choice("D?", { espresso: "E", tea: "T" }), null, 0)],
  },
  option_last_b: {
    input: [row("d", null, choice("T?", { other: "O", billing: "B", shipping: "S" }), null, 0), row("e", null, choice("E?", { other: "O", tea: "T" }), null, 1)],
    shown: [0],
    params: { option: "other" },
    output: [row("d", null, choice("T?", { billing: "B", shipping: "S", other: "O" }), null, 0), row("e", null, choice("E?", { other: "O", tea: "T" }), null, 1)],
    rejects: [{ params: { option: "gifts" }, message: /No shown Choice question in B lists an option “gifts”/ }],
  },
  strip_descriptions_b: {
    input: [row("d", choice("T?", { x: "X", y: null }), choice("T?", { x: "X", y: null }), 0, 0)],
    output: [row("d", choice("T?", { x: "X", y: null }), choice("T?", { x: null, y: null }), 0, 0)],
    unchanged: [row("d", null, choice("T?", { x: null, y: null }), null, 0)],
  },
  revert_to_a: {
    input: [row("rush", noul("Rush?"), { type: "score", instructions: "Rush order?", criteria: ["No", "Yes"] }, 0, 0), row("u", noul("U?"), noul("Today?"), 1, 1)],
    shown: [0],
    output: [row("rush", noul("Rush?"), noul("Rush?"), 0, 0), row("u", noul("U?"), noul("Today?"), 1, 1)],
    unchanged: [row("u", noul("U?"), noul("U?"), 0, 0)],
  },
  // B lists p, r; q (A only) joins B at the end, so q's B position is 2.
  add_missing_to_b: {
    input: three(),
    output: [row("p", noul("P?"), noul("P?"), 0, 0), row("q", noul("Q?"), noul("Q?"), 1, 2), row("r", null, noul("R?"), null, 1)],
    unchanged: [row("p", noul("P?"), noul("P?"), 0, 0)],
  },
  // Only p is shown: B keeps p; r (asked by B only) disappears; q (A only) stays as it is.
  isolate_in_b: {
    input: three(),
    shown: [0],
    output: [row("p", noul("P?"), noul("P?"), 0, 0), row("q", noul("Q?"), null, 1, null)],
    rejects: [{ input: [row("q", noul("Q?"), null, 0, null), row("r", null, noul("R?"), null, 0)], message: /None of the shown questions is in B/ }],
  },
  // B asks q, p, r; reversed it asks r, p, q.
  reverse_questions_b: {
    input: [row("p", noul("P?"), noul("P?"), 0, 1), row("q", noul("Q?"), noul("Q?"), 1, 0), row("r", null, noul("R?"), null, 2)],
    output: [row("p", noul("P?"), noul("P?"), 0, 1), row("q", noul("Q?"), noul("Q?"), 1, 2), row("r", null, noul("R?"), null, 0)],
    unchanged: [row("p", noul("P?"), noul("P?"), 0, 0)],
  },
  sort_questions_b: {
    input: [row("zeta", noul("Z?"), noul("Z?"), 0, 0), row("alpha", noul("A?"), noul("A?"), 1, 1)],
    output: [row("zeta", noul("Z?"), noul("Z?"), 0, 1), row("alpha", noul("A?"), noul("A?"), 1, 0)],
  },
  rename_id: {
    input: three(),
    params: { from: "q", to: "queue" },
    output: [row("p", noul("P?"), noul("P?"), 0, 0), row("queue", noul("Q?"), null, 1, null), row("r", null, noul("R?"), null, 1)],
    rejects: [{ params: { from: "x", to: "y" }, message: /No question has the id “x”/ }, { params: { from: "q", to: "p" }, message: /already in use/ },
      { params: { from: "q", to: " " }, message: /required|blank/ }],
  },

  questions_to_a: {
    text: '{"gift": {"type": "noul", "instructions": "Is it a gift?"}, "size": {"type": "choice", "criteria": {"small": null, "large": null}}}',
    items: [{ qid: "gift", a: noul("Is it a gift?"), b: null, ia: null, ib: null, comparable: false },
      { qid: "size", a: { type: "choice", criteria: { small: null, large: null } }, b: null, ia: null, ib: null, comparable: false }],
    warnings: 1,
    rejects: ['{"gift": {"type": "noul"}, "gift": {"type": "noul"}}', "not json", "[]", "{}", '{"x": {"type": "rating"}}', '{"gift": {"type": "choice", "criteria": {"a": 1, "a": 2}}}'],
  },
  questions_to_both: {
    text: '{"gift": {"type": "noul", "instructions": "Is it a gift?"}}',
    items: [{ qid: "gift", a: noul("Is it a gift?"), b: noul("Is it a gift?"), ia: null, ib: null, comparable: true }],
    warnings: 0,
    rejects: ['{" ": {"type": "noul"}}', '{"gift": "noul"}'],
  },
  request_to_b: {
    text: '{"request": {"model": "jev-1.14.0", "state": {"text": "Hi"}, "questions": {"gift": {"type": "noul", "instructions": "Gift?"}}}, "response": {"answers": {}}}',
    items: [{ qid: "gift", a: null, b: noul("Gift?"), ia: null, ib: null, comparable: false }],
    warnings: 1,
    rejects: ['{"state": {"text": "Hi"}}', '{"questions": {}}', '{"request": {"questions": [1]}}'],
  },
  build_draft_to_b: {
    text: '{"format": "jev-build-draft", "version": 1, "state": {"text": "x"}, "questions": {"gift": {"type": "noul", "instructions": "Gift?"}}, "images": {}}',
    items: [{ qid: "gift", a: null, b: noul("Gift?"), ia: null, ib: null, comparable: false }],
    warnings: 1,
    rejects: ['{"format": "jev-build-draft", "version": 2, "questions": {"gift": {"type": "noul"}}}', '{"questions": {"gift": {"type": "noul"}}}'],
  },
}, { ctx: () => sampleCompareVariantsCtx() });

// ---------- beyond the per-feature cases ----------

const feature = (id) => pack.features.find((entry) => entry.id === id);

// The host's Undo works only when the items the page rebuilds after Apply equal the preview exactly.
for (const [id, params, shown] of [["reverse_questions_b", {}, null], ["sort_questions_b", {}, null], ["add_missing_to_b", {}, null], ["isolate_in_b", {}, [0, 1, 7]],
  ["rename_id", { from: "rush", to: "hurry" }, null], ["rotate_options_b", {}, null], ["revert_to_a", {}, null], ["option_last_b", { option: "billing" }, null]]) {
  test(`compare-variant-tools: ${id} applied through the editors matches its preview, so Undo stays available`, () => {
    const ctx = sampleCompareVariantsCtx();
    const before = ctx.items();
    const preview = previewTransform(id, feature(id), before, new Set(shown || before.map((_, index) => index)), params, ctx);
    assert.ok(preview.changed.length || preview.was !== preview.now, "the edit changes the fixture");
    const applied = applyTransform(preview, before);
    ctx.actions.replaceItems(applied.items, { label: id });
    assert.deepEqual(ctx.items(), preview.next);
    ctx.actions.replaceItems(undoTransform(applied.undo, ctx.items()), { label: `Undo ${id}` });
    assert.deepEqual(ctx.items(), before);
  });
}

test("compare-variant-tools: reversing B's order moves only B's text", () => {
  const ctx = sampleCompareVariantsCtx();
  const textA = ctx.state.variants[0].text;
  const preview = previewTransform("r", feature("reverse_questions_b"), ctx.items(), new Set(), {}, ctx);
  ctx.actions.replaceItems(preview.next);
  assert.equal(ctx.state.variants[0].text, textA);
  assert.deepEqual(Object.keys(JSON.parse(ctx.state.variants[1].text)), ["refund", "rush", "spot", "drink", "tone", "department", "urgent"]);
});

test("compare-variant-tools: renaming to a whole-number id follows the browser's key order", () => {
  const list = [row("p", noul("P?"), noul("P?"), 0, 0), row("q", noul("Q?"), noul("Q?"), 1, 1)];
  const preview = previewTransform("r", feature("rename_id"), list, new Set([0, 1]), { from: "q", to: "7" }, {});
  assert.deepEqual(preview.next.map((item) => [item.qid, item.ia, item.ib]), [["7", 0, 0], ["p", 1, 1]]);
});

test("compare-variant-tools: an imported question lands in both editors through importItems", () => {
  const ctx = sampleCompareVariantsCtx();
  const { items: added } = runImporter(feature("questions_to_both"), '{"gift": {"type": "noul", "instructions": "Is it a gift?"}}', ctx);
  ctx.actions.importItems(added);
  assert.deepEqual(Object.keys(JSON.parse(ctx.state.variants[0].text)).slice(-1), ["gift"]);
  assert.deepEqual(Object.keys(JSON.parse(ctx.state.variants[1].text)).slice(-1), ["gift"]);
  assert.equal(ctx.items().find((item) => item.qid === "gift").comparable, true);
});

test("compare-variant-tools: the input check is clean when only B's rows differ", () => {
  const ctx = sampleCompareVariantsCtx({ ...sameModels, perturb: "lowercase", texts: [JSON.stringify(QUESTIONS_A), JSON.stringify(QUESTIONS_A)] });
  assert.equal(feature("input_check_not_clean").check(ctx.items(), ctx), null);
  const averaged = sampleCompareVariantsCtx({ ...sameModels, perturb: "lowercase", average: true, texts: [JSON.stringify(QUESTIONS_A), JSON.stringify(QUESTIONS_A)] });
  assert.match(feature("input_check_not_clean").check(averaged.items(), averaged), /but B asks in both option orders/);
});

test("compare-variant-tools: the last-run check also needs the same models and rows setting", () => {
  const changed = sampleCompareVariantsCtx({ lastRun, perturb: "typos" });
  assert.equal(feature("same_as_last_run").check(changed.items(), changed), null);
  const other = sampleCompareVariantsCtx({ lastRun, currentModel: "jev-1.15.0" });
  assert.equal(feature("same_as_last_run").check(other.items(), other), null);
});

test("compare-variant-tools: the clean order check fixture is what jev/compare.py calls order_only", () => {
  // list(qa) == list(qb) (same ids, same order), qa == qb as dicts, same model, rows as written, asked once.
  const [qa, qb] = [JSON.parse(textA), JSON.parse(drinkMoved)];
  assert.deepEqual(Object.keys(qa), Object.keys(qb));
  assert.notEqual(JSON.stringify(qa.drink), JSON.stringify(qb.drink));
  assert.equal(feature("order_check_not_clean").check([], cleanOrderCtx), null);
  // A moved question that also differs in another field is not clean either (qa == qb fails in jev/compare.py).
  const extra = sampleCompareVariantsCtx({ ...sameModels, texts: [textA, JSON.stringify({ ...QUESTIONS_A, drink: { ...QUESTIONS_B.drink, note: "x" } })] });
  assert.match(feature("order_check_not_clean").check([], extra), /but “drink” also differs/);
});
