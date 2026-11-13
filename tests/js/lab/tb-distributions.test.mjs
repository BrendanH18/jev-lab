// Tests for the tb-distributions Toolbox pack. Reference values come from hand arithmetic on halves and quarters
// (entropies of 1.5 bits, Gini 0.625, a Score legend with mean 3 and variance 1.2) and, for logs and square roots of
// other values, from a separate stdlib Python script using math.log2, math.log and math.sqrt directly.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-distributions.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const P = "refund=0.5, exchange=0.25, other=0.25";
const Q = "refund: 0.25\nexchange: 0.25\nother: 0.5";
const LEGEND = "1=0.1, 2=0.2, 3=0.4, 4=0.2, 5=0.1";
const BAD = [{ answer: "" }, { answer: "a=0.5, b=x" }, { answer: "a=0.5, b=0.2" }, { answer: "a=0.5, a=0.5" }, { answer: "a=0.5, 0.5" }, { answer: "a=-0.1, b=1.1" }, { answer: "{ not json" }];
const BAD_PAIR = [{ first: "", second: Q }, { first: P, second: "a=0.3" }, { first: "x=1", second: "y=nope" }];

const near = (expected, tolerance = 1e-9) => (result) => {
  assert.deepEqual(result.rows.map(([label]) => label), expected.map(([label]) => label));
  expected.forEach(([label, value], i) => approx(result.rows[i][1], value, tolerance, label));
};
const tableIs = (columns, rows) => (result) => {
  assert.deepEqual(result.table.columns, columns);
  assert.equal(result.table.rows.length, rows.length);
  rows.forEach((row, i) => row.forEach((cell, j) => approx(result.table.rows[i][j], cell, 1e-9, `row ${i + 1} cell ${j + 1}:`)));
};

checkPack(pack, {
  // −(½ log₂ ½ + 2 · ¼ log₂ ¼) = 1.5 bits; the maximum for three options is log₂ 3.
  entropy: { values: { answer: P }, expect: [["Entropy (bits)", 1.5], ["Entropy (nats)", 1.5 * Math.LN2], ["Normalized entropy (0 to 1)", 0.9463946303571862], ["Largest possible (bits)", 1.584962500721156], ["Options", 3]],
    more: [
      // the same answer as a plain list, a two-column table with a header, and JSON
      { values: { answer: "0.5 0.25 0.25" }, expect: (result) => approx(result.rows[0][1], 1.5) },
      { values: { answer: "option,probability\nrefund,0.5\nexchange,0.25\ngift card,0.25" }, expect: (result) => approx(result.rows[0][1], 1.5) },
      { values: { answer: '{"refund": 0.5, "exchange": 0.25, "other": 0.25}' }, expect: (result) => approx(result.rows[0][1], 1.5) },
      { values: { answer: "only=1" }, expect: [["Entropy (bits)", 0], ["Entropy (nats)", 0], ["Normalized entropy (0 to 1)", null], ["Largest possible (bits)", 0], ["Options", 1]] },
      // 0.5 + 0.5 + 0.01 is within 0.02 of 1, so it is rescaled and noted
      { values: { answer: "a=0.5, b=0.5, c=0.01" }, expect: (result) => { approx(result.rows[4][1], 3); assert.match(result.note, /rescaled/); } },
    ],
    invalid: BAD },
  // ties keep the order given: exchange is the runner-up before other
  top_two_margin: { values: { answer: P }, expect: [["Top option", "refund"], ["Top probability", 0.5], ["Runner-up", "exchange"], ["Runner-up probability", 0.25], ["Margin", 0.25], ["Ratio (top ÷ runner-up)", 2]],
    more: [{ values: { answer: "a=0, b=1" }, expect: [["Top option", "b"], ["Top probability", 1], ["Runner-up", "a"], ["Runner-up probability", 0], ["Margin", 1], ["Ratio (top ÷ runner-up)", null]] }],
    invalid: [...BAD, { answer: "a=1" }] },
  // 1 − (¼ + 1/16 + 1/16) = 0.625; maximum 1 − ⅓.
  gini_impurity: { values: { answer: P }, expect: [["Gini impurity", 0.625], ["Normalized (0 to 1)", 0.9375], ["Chance two draws agree", 0.375], ["Options", 3]],
    more: [{ values: { answer: "x=1" }, expect: [["Gini impurity", 0], ["Normalized (0 to 1)", null], ["Chance two draws agree", 1], ["Options", 1]] }], invalid: BAD },
  top_k_mass: { values: { answer: P, k: "2" }, expect: [["Top options", "refund, exchange"], ["Their probability", 0.75], ["Probability of the rest", 0.25], ["Options counted", 2]],
    more: [{ values: { answer: "a=0.1, b=0.6, c=0.3", k: "5" }, expect: [["Top options", "b, c, a"], ["Their probability", 1], ["Probability of the rest", 0], ["Options counted", 3]] }],
    invalid: [...BAD, { answer: P, k: "0" }] },
  fewest_options_for_mass: { values: { answer: P, target: "0.7" }, expect: [["Options needed", 2], ["Options", "refund, exchange"], ["Probability they hold", 0.75], ["Share of all options", 2 / 3]],
    more: [{ values: { answer: P, target: "0.5" }, expect: [["Options needed", 1], ["Options", "refund"], ["Probability they hold", 0.5], ["Share of all options", 1 / 3]] },
      { values: { answer: P, target: "1" }, expect: [["Options needed", 3], ["Options", "refund, exchange, other"], ["Probability they hold", 1], ["Share of all options", 1]] }],
    invalid: [...BAD, { answer: P, target: "1.5" }] },
  // mean 1·0.1 + 2·0.2 + 3·0.4 + 4·0.2 + 5·0.1 = 3; variance 0.1·4 + 0.2·1 + 0 + 0.2·1 + 0.1·4 = 1.2.
  expected_score: { values: { answer: LEGEND }, expect: [["Expected score", 3], ["Variance", 1.2], ["Standard deviation", Math.sqrt(1.2)], ["Lowest level with probability", 1], ["Highest level with probability", 5]],
    more: [{ values: { answer: "10=0.5, 0=0.5, 5=0" }, expect: [["Expected score", 5], ["Variance", 25], ["Standard deviation", 5], ["Lowest level with probability", 0], ["Highest level with probability", 10]] },
      { values: { answer: "0.2 0.8" }, expect: (result) => approx(result.rows[0][1], 1.8) }],   // a plain list is levels 1 and 2
    invalid: [...BAD, { answer: "low=0.5, high=0.5" }, { answer: "1=0.5, 1.0=0.5" }] },
  // cumulative 0.1, 0.3, 0.7: the median is 3; for 0 and 10 at ½ each the median is 0 and the tied mode is the lower level.
  score_mode_median: { values: { answer: LEGEND }, expect: [["Most likely level", 3], ["Its probability", 0.4], ["Median level", 3], ["Probability at or below the median", 0.7]],
    more: [{ values: { answer: "10=0.5, 0=0.5" }, expect: [["Most likely level", 0], ["Its probability", 0.5], ["Median level", 0], ["Probability at or below the median", 0.5]] }],
    invalid: [...BAD, { answer: "a=1" }] },
  score_cumulative: { values: { answer: LEGEND }, expect: tableIs(["Level", "Probability", "At most this level", "At least this level"],
    [[1, 0.1, 0.1, 1], [2, 0.2, 0.3, 0.9], [3, 0.4, 0.7, 0.7], [4, 0.2, 0.9, 0.3], [5, 0.1, 1, 0.1]]),
  more: [{ values: { answer: "3=0.25\n1=0.75" }, expect: tableIs(["Level", "Probability", "At most this level", "At least this level"], [[1, 0.75, 0.75, 1], [3, 0.25, 1, 0.25]]) }],
  invalid: [...BAD, { answer: "x=1" }] },
  // P against Q: ½ log₂ 2 + ¼ log₂ ½ = 0.25 bits each way. (½, ½) against (0.9, 0.1) from the Python reference.
  kl_divergence: { values: { first: P, second: Q }, expect: [["KL(first ‖ second)", 0.25], ["KL(second ‖ first)", 0.25], ["Options in only one distribution", 0]],
    more: [
      { values: { first: "a=0.5, b=0.5", second: "a=0.9, b=0.1" }, expect: [["KL(first ‖ second)", 0.7369655941662061], ["KL(second ‖ first)", 0.5310044064107189], ["Options in only one distribution", 0]] },
      { values: { first: "a=0.5, b=0.5", second: "a=0.9, b=0.1", unit: "nats" }, expect: [["KL(first ‖ second)", 0.5108256237659905], ["KL(second ‖ first)", 0.36806420716849714], ["Options in only one distribution", 0]] },
      // c is missing from the second, so KL(first ‖ second) is infinite; KL(second ‖ first) = 1 · log₂(1 ÷ 0.5)
      { values: { first: "a=0.5, c=0.5", second: "a=1" }, expect: [["KL(first ‖ second)", null], ["KL(second ‖ first)", 1], ["Options in only one distribution", 1]] },
    ],
    invalid: [...BAD_PAIR, { first: P, second: Q, unit: "bans" }] },
  js_divergence: { values: { first: P, second: Q }, expect: [["Jensen-Shannon divergence (bits)", 0.06127812445913294], ["Jensen-Shannon distance", 0.24754418688212604], ["Options in only one distribution", 0]],
    more: [{ values: { first: "a=0.5, b=0.5", second: "a=0.9, b=0.1" }, expect: [["Jensen-Shannon divergence (bits)", 0.14679310243605218], ["Jensen-Shannon distance", 0.38313587985994235], ["Options in only one distribution", 0]] },
      { values: { first: "a=1", second: "b=1" }, expect: [["Jensen-Shannon divergence (bits)", 1], ["Jensen-Shannon distance", 1], ["Options in only one distribution", 2]] }],
    invalid: BAD_PAIR },
  // ½(|0.5 − 0.25| + 0 + |0.25 − 0.5|) = 0.25; refund and other change by the same amount and refund is listed first.
  total_variation: { values: { first: P, second: Q }, expect: [["Total variation distance", 0.25], ["Option that changes most", "refund"], ["Its change (second − first)", -0.25], ["Options in only one distribution", 0]],
    more: [{ values: { first: "a=1", second: "a=0.4, b=0.6" }, expect: [["Total variation distance", 0.6], ["Option that changes most", "a"], ["Its change (second − first)", -0.6], ["Options in only one distribution", 1]] }],
    invalid: BAD_PAIR },
  // Bhattacharyya coefficient √⅛ + ¼ + √⅛ = 0.25 + 1/√2.
  hellinger_distance: { values: { first: P, second: Q }, expect: [["Hellinger distance", Math.sqrt(0.75 - Math.SQRT1_2)], ["Bhattacharyya coefficient", 0.25 + Math.SQRT1_2], ["Bhattacharyya distance", 0.0438403146663646],
    ["Options in only one distribution", 0]],
  more: [{ values: { first: "a=1", second: "b=1" }, expect: [["Hellinger distance", 1], ["Bhattacharyya coefficient", 0], ["Bhattacharyya distance", null], ["Options in only one distribution", 2]] },
    { values: { first: "a=0.5, b=0.5", second: "a=0.9, b=0.1" }, expect: (result) => approx(result.rows[0][1], 0.32491969623290634) }],
  invalid: BAD_PAIR },
  renormalize: { values: { answer: "refund=2, exchange=1, other=1" }, expect: (result) => {
    near([["Sum of the values given", 4], ["Options", 3]])(result);
    tableIs(["Option", "Given", "Probability"], [["refund", 2, 0.5], ["exchange", 1, 0.25], ["other", 1, 0.25]])(result);
  },
  more: [{ values: { answer: "3 1" }, expect: tableIs(["Option", "Given", "Probability"], [["1", 3, 0.75], ["2", 1, 0.25]]) },
    // the values given come back exactly as typed, not recomputed from the probabilities; 0.1 + 0.2 + 0.7 sums to 1 in floating point
    { values: { answer: "a=0.1, b=0.2, c=0.7, d=0.3" }, expect: (result) => {
      assert.deepEqual(result.table.rows.map((row) => row[1]), [0.1, 0.2, 0.7, 0.3]);
      approx(result.rows[0][1], 1.3); approx(result.table.rows[3][2], 3 / 13);
    } }],
  invalid: [{ answer: "" }, { answer: "a=0, b=0" }, { answer: "a=-1, b=2" }, { answer: "a=1, a=2" }] },
  // 2^1.5 = 2√2 and 1 ÷ 0.375.
  effective_options: { values: { answer: P }, expect: [["Perplexity (2^entropy)", 2 * Math.SQRT2], ["Inverse Simpson (1 ÷ Σ p²)", 8 / 3], ["Options", 3]],
    more: [{ values: { answer: "a=0.25, b=0.25, c=0.25, d=0.25" }, expect: [["Perplexity (2^entropy)", 4], ["Inverse Simpson (1 ÷ Σ p²)", 4], ["Options", 4]] }], invalid: BAD },
  // exchange: p ¼, 2 bits, one option (refund, ½) strictly more likely; Brier ½² + ¾² + ¼².
  answer_surprisal: { values: { answer: P, right: "exchange" }, expect: [["Probability of the right option", 0.25], ["Surprisal (bits)", 2], ["Rank", 2], ["Probability of more likely options", 0.5],
    ["Brier score of this answer", 0.875]],
  more: [{ values: { answer: "a=1, b=0", right: " b " }, expect: [["Probability of the right option", 0], ["Surprisal (bits)", null], ["Rank", 2], ["Probability of more likely options", 1], ["Brier score of this answer", 2]] }],
  invalid: [{ answer: P, right: "store credit" }, { answer: P, right: "" }, { answer: "", right: "a" }] },
  // (0.9, 0.1) and (0.1, 0.9) average to (½, ½): 1 bit in total, 0.46900 bits each (Python), so 0.53100 bits of disagreement.
  ensemble_disagreement: { values: { answers: "refund=0.9, exchange=0.1\nexchange=0.9; refund=0.1" }, expect: (result) => {
    near([["Answers", 2], ["Entropy of the average answer (bits)", 1], ["Mean entropy of the answers (bits)", 0.4689955935892812], ["Mutual information (bits)", 0.5310044064107188],
      ["Top option of the average", "refund"], ["Its average probability", 0.5]])(result);
    tableIs(["Option", "Average probability"], [["refund", 0.5], ["exchange", 0.5]])(result);
  },
  more: [{ values: { answers: "0.6 0.3 0.1\n0.2 0.5 0.3\n0.4 0.4 0.2" }, expect: (result) => {
    approx(result.rows[1][1], 1.5219280948873624); approx(result.rows[2][1], 1.4342884121176729); approx(result.rows[3][1], 0.08763968276968948); assert.equal(result.rows[4][1], "1");
  } },
  { values: { answers: "a=0.5, b=0.5\na=0.5, b=0.5" }, expect: (result) => approx(result.rows[3][1], 0) }],
  invalid: [{ answers: "a=0.5, b=0.5" }, { answers: "a=0.5, b=0.5\na=0.5, c=0.5" }, { answers: "a=0.5, b=0.5\na=0.5, b=nope" }, { answers: "0.5 0.5\n0.3 0.3 0.4" }] },
}, { ctx: () => fakeCtx({}) });
