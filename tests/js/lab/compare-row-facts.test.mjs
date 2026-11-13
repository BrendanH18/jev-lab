// Tests for the Compare row facts pack (static/js/lab/packs/workbench/compare-row-facts.js). Expected values are worked
// out by hand from the answers in tests/js/lab/fixtures/workbench-compare.mjs, plus a few hand-made rows for cases the
// fixture does not hold (a tie, a Choice pick that is not the most likely option, disjoint boxes).
import pack from "../../../static/js/lab/packs/workbench/compare-row-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleCompareRowsCtx } from "./fixtures/workbench-compare.mjs";

// The seven rows of the "department" Choice run, #1 .. #7 (B failed on #5 and was skipped on #7).
const dept = sampleCompareRowsCtx().items();
const urgent = sampleCompareRowsCtx({ qid: "urgent" }).items();   // Noul: rows #1, #2, #3, #4, #6
const tone = sampleCompareRowsCtx({ qid: "tone" }).items()[0];    // Score: #1, A picks 2 (score 1.5), B picks 1 (score 1.3)
const spot = sampleCompareRowsCtx({ qid: "spot" }).items()[0];    // Box: #2

const choice = (pick, probabilities) => ({ type: "choice", choice: pick, probabilities });

checkPack(pack, {
  // Each answer's probability for its own pick, as listed in the fixture.
  // Plus Noul #2 (P(yes) .62 → the larger of .62 and .38) and Box #2 (its confidence .8).
  top_prob_a: { items: [...dept, urgent[1], spot], values: [0.7, 0.5, 0.8, 0.9, 0.75, 0.52, 0.5, 0.62, 0.8] },
  top_prob_b: { items: dept, values: [0.6, 0.8, 0.9, 0.55, null, 0.5, null] },
  // Pick minus best other option: #1 .7-.2, #2 .5-.35, #3 .8-.1, #4 .9-.04, #5 .75-.1, #6 .52-.3, #7 .5-.2;
  // Noul .62 → .62-.38; a Choice pick of x at .3 against y at .6 → -.3; Box has no probability list.
  margin_a: {
    items: [...dept, urgent[1], { picks: ["x", "y"], answers: [choice("x", { x: 0.3, y: 0.6 }), null] }, spot],
    values: [0.5, 0.15, 0.7, 0.86, 0.65, 0.22, 0.3, 0.24, -0.3, null],
  },
  // Score tone: B picks level 1 at .5 against level 2 at .4 → .1.
  margin_b: { items: [...dept, tone], values: [0.3, 0.7, 0.86, 0.25, null, 0.3, null, 0.1] },
  // A's probability for B's pick: shipping .2, shipping .35, other .8, shipping .04, (no B), other .08, (no B).
  cross_prob_a: {
    items: [...dept, { picks: ["x", "z"], answers: [choice("x", { x: 0.6, y: 0.4 }), choice("z", { z: 1 })] }],
    values: [0.2, 0.35, 0.8, 0.04, null, 0.08, null, null],
  },
  // Score tone: A gave B's level 1 probability .3; B gave A's level 2 probability .4.
  // B's probability for A's pick: billing .3, wholesale .1, other .9, billing .3, (no B), billing .2, (no B); Noul: B's P(yes) .4.
  cross_prob_b: { items: [...dept, urgent[1], tone], values: [0.3, 0.1, 0.9, 0.3, null, 0.2, null, 0.4, 0.4] },
  // Half the summed |pA - pB|: #1 (.4+.4)/2, #2 (.05+.45+.4+0)/2, #3 (.02+.02+.06+.1)/2, #4 (.6+.51+.07+.02)/2,
  // #6 (.32+.1+0+.42)/2; Noul |.62-.4|; different option sets → unavailable.
  prob_shift: {
    // Score tone: (0 + .2 + .2) / 2.
    items: [...dept, urgent[1], { answers: [choice("x", { x: 0.6, y: 0.4 }), choice("x", { x: 0.6, z: 0.4 })] }, tone, spot],
    values: [0.4, 0.45, 0.1, 0.6, null, 0.42, null, 0.22, null, 0.2, null],
  },

  pick_a: { items: dept, values: ["billing", "wholesale", "other", "billing", "wholesale", "billing", "other"] },
  pick_b: { items: dept, values: ["shipping", "shipping", "other", "shipping", null, "other", null] },
  // Choice labels as written, Noul true/false as yes/no, a Score level as text, Box edges to two decimals.
  label: {
    items: [...dept, urgent[0], urgent[1], tone, spot],
    values: ["billing", "shipping", "other", null, "wholesale", "shipping", null, "yes", "no", "2", "0.11, 0.20, 0.50, 0.60"],
  },
  // Signals A/B: .6/.45, .3/.7, .7/.85, .85/.4, .6/–, .36/.33, .35/–; plus an even pair.
  more_confident: { items: [...dept, { signals: [0.5, 0.5] }], values: ["A", "B", "B", "A", null, "A", null, "tie"] },
  // #1: A surer and right; #2: B surer and right; #6: A surer but wrong; unscored rows and ties are without.
  confident_side_right: {
    items: [...dept, { signals: [0.5, 0.5], verdict: "both_right", correct: [true, true] }],
    values: [true, true, false, false, false, false, false, false],
  },

  // Words: #1 10; #2 "Where is wholesale order HC-2231?" 5 + "email" 1 (the picture name does not count); #3 9; #4 8;
  // #5 8 + "phone" 1; #6 5; #7 7; an empty list row 0; a row with only its printed text "a b" 2.
  // Nested values count, numbers do not: "a b" + "c" → 3.
  row_words: { items: [...dept, { row: [] }, { text: "a b" }, { row: { n: 5, tags: ["a b", "c"] } }], values: [10, 6, 9, 8, 9, 5, 7, 0, 2, 3] },
  // Object rows #2 (text, channel) and #5 (text, channel); a hand row with three fields and a picture; a list row.
  row_fields: {
    items: [...dept, { row: { a: 1, b: "two", c: null, _image: "x.png" } }, { row: [1, 2] }],
    values: [null, 2, null, null, 2, null, null, 3, null],
  },
  has_picture: { items: [...dept, { row: { text: "hi", _image: "  " } }], values: [false, true, false, false, false, false, false, false] },
  cost_a: { items: [dept[0], dept[6], { meta: [{ cost_usd: 0.0004 }, null] }, { meta: [null, null] }], values: [0.0001, 0.0001, 0.0004, null] },
  // B's measured costs; #5's failed call cost 0, #7 was skipped and has no measurement.
  cost_b: { items: dept, values: [0.0003, 0.0003, 0.0002, 0.0002, 0, 0.0002, null] },

  // tone: levels 2 and 1; a hand Score pair 0 and 2; Choice options named by numbers are not levels.
  level_gap: {
    items: [tone, dept[0], { picks: ["0", "2"], answers: [{ type: "score" }, { type: "score" }] }, { picks: ["1", "2"], answers: [choice("1", { 1: 1 }), choice("2", { 2: 1 })] }],
    values: [1, null, 2, null],
  },
  // tone: 1.3 - 1.5; a hand pair: A without a score weighs 0*.2 + 1*.3 + 2*.5 = 1.3, B states 2 → 0.7.
  expected_gap: {
    // Probabilities that do not sum to 1 are normalized: (0 × .2 + 2 × .2) / .4 = 1, against B's stated 3 → 2.
    items: [tone, { answers: [{ type: "score", probabilities: { 0: 0.2, 1: 0.3, 2: 0.5 } }, { type: "score", score: 2, probabilities: { 2: 1 } }] }, urgent[0],
      { answers: [{ type: "score", probabilities: { 0: 0.2, 2: 0.2 } }, { type: "score", score: 3, probabilities: { 3: 1 } }] }],
    values: [-0.2, 0.7, null, 2],
  },
  // urgent #1: .88 - .91; #2: .4 - .62.
  yes_gap: { items: [urgent[0], urgent[1], dept[0]], values: [-0.03, -0.22, null] },
  // spot: overlap .38 × .4 = .152 over union .16 + .152 - .152 = .16 → .95; disjoint boxes → 0.
  box_overlap: {
    items: [spot, dept[0], { answers: [{ type: "box", box: { left: 0, top: 0, right: 0.2, bottom: 0.2 }, confidence: 1 },
      { type: "box", box: { left: 0.5, top: 0.5, right: 0.9, bottom: 0.9 }, confidence: 1 }] }],
    values: [0.95, null, 0],
  },
}, { ctx: () => sampleCompareRowsCtx() });
