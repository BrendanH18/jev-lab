import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/find/find-results-insights.js";
import { checkPack } from "./harness.mjs";
import { QUERIES, RESULTS, resultsByPosition, sampleFindResultsCtx } from "./fixtures/find.mjs";

const ctx = (overrides) => sampleFindResultsCtx(overrides);
const H = resultsByPosition(ctx());                          // dog, notice, parental, wifi
const M = resultsByPosition(ctx({ result: RESULTS.mixed }));  // Sunday, entrance, payday
const O = resultsByPosition(ctx({ result: RESULTS.odd }));    // odd shapes
const empty = () => ctx({ result: null });
const DOG_TOP = "Only service animals are allowed behind the counter; pets may wait on the patio.";
const WIFI_TOP = "Questions about this handbook go to people@harborcoffee.example or call 555-0142.";

// Reference values come from the fixture's hand-written answer table (tests/js/lab/fixtures/find.mjs, ANSWERS and
// MIXED_ANSWERS), worked out by hand: hits are the five likeliest lines, ties in line order.
// {} stands for an item with nothing readable: every fact must give "unavailable" (or false) and never throw.
const BARE = {};
const TIES = { position: 9, top_prob: 0.5, hits: [{ rank: 1, id: "L003", prob: 0.5 }, { rank: 2, id: "L004", prob: 0.4 }] };

checkPack(pack, {
  top_prob: { items: [H[1], H[3], O[1], M[3], BARE], values: [0.71, 0.41, null, 0.97, null] },
  // O[1]'s exists arrived as the text "0.5", which is not a number.
  exists_p: { items: [H[1], H[3], O[1], BARE], values: [0.82, 0.12, null, null] },
  // O[1]: its second hit is the one without an index (2%); O[2] has no hits.
  runner_up: { items: [H[1], H[2], H[4], O[2], O[1], BARE], values: [0.2, 0.3, 0.3, null, 0.02, null] },
  // .71 - .20, .64 - .30, .38 - .30, .15 - .14 (L000 wins the .14 tie with L003); O[1]'s top probability is not a number.
  lead: { items: [H[1], H[2], H[4], M[2], O[1], BARE], values: [0.51, 0.34, 0.08, 0.01, null, null], tolerance: 1e-9 },
  confidence: { items: [H[1], H[2], O[1], BARE], values: [0.71, 0.64, null, null] },
  // All five for the dog; the notice question's fifth line is 0.5%; payday lists 97%, 2% and 1% (1% counts); no hits.
  listed: { items: [H[1], H[2], M[3], O[2], BARE], values: [5, 4, 3, 0, null] },
  query_words: { items: [H[1], H[2], H[3], O[1], BARE], values: [7, 11, 5, null, null] },
  verdict: { items: [H[1], H[3], H[4], O[1], BARE], values: ["answered", "absent", "partial", null, null] },
  top_section: { items: [H[1], H[2], H[3], O[2], { top: { id: "L000", text: "Harbor Coffee Co. Team Handbook", section: null } }, BARE],
    values: ["Section D: Pets", "Section C: Leaving Harbor Coffee", "Section B: Pay and time off", null, "no section", null] },
  query_text: { items: [H[1], H[3], O[1], BARE], values: [QUERIES[0], QUERIES[2], "  ", ""] },
  top_text: { items: [H[1], H[4], O[2], BARE], values: [DOG_TOP, WIFI_TOP, "", ""] },
  // Sunday: absent but L002 at 55%; entrance: answered but its top line is only 15%. Payday: answered at 97%; parental:
  // absent at 41% (under 50%); wifi: partial, which the rule never flags.
  disagrees: { items: [M[1], M[2], H[1], H[3], H[4], M[3], BARE], values: [true, true, false, false, false, false, false] },
  // The entrance question's top line is "Section A: Hours and scheduling", as is the odd result's.
  top_heading: { items: [M[2], O[1], H[1], BARE], values: [true, true, false, false] },
  // The dog's listed lines span Sections D, E, A and B; payday's are all in Section B; the notice question's listed
  // lines are C, B, C and A (its .5% L000 is not listed).
  spread: { items: [H[1], M[3], O[2], H[2], BARE], values: [true, false, false, true, false] },

  // 1.0 and 8.0 points; a lead of exactly 10 points (TIES: .5 - .4) is not a close call.
  close_call: { hit: [M[2], H[4]], miss: [H[1], H[2], O[2], TIES, BARE], message: /leads the second by only (1\.0 points \(L001 vs L000\)|8\.0 points \(L012 vs L001\))/ },
  shared_top: { hitList: [H[1], H[3], { position: 5, top: { id: "L006" } }, BARE], missList: [...Object.values(H), BARE], message: /^L006 is the top line for 2 questions \(Q3, Q5\)\./ },

  // 2 of 4 answered; without the dog question 1 of 3; the mixed search: entrance and payday of 3.
  answered_share: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "2 of 4"); }, empty: empty() },
    { ctx: ctx({ hide: [1] }), expect: 1 / 3, tolerance: 1e-12 }, { ctx: ctx({ result: RESULTS.mixed }), expect: 2 / 3, tolerance: 1e-12 },
    { ctx: ctx({ hide: [1, 2, 3, 4] }), expect: null }],
  // $0.000092 over four questions (hiding cards does not change the call); the single search's $0.000041 over one.
  cost_per_question: [{ ctx: ctx(), expect: 0.000023, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ result: RESULTS.single }), expect: 0.000041, tolerance: 1e-12 },
    { ctx: ctx({ hide: [1, 2] }), expect: 0.000023, tolerance: 1e-12 }, { ctx: ctx({ result: RESULTS.odd }), expect: null }],
  // 1,840 input tokens over 13 lines = 141.538461...; 820 over 13 = 63.076923...; the odd result has no line count.
  tokens_per_line: [{ ctx: ctx(), expect: 1840 / 13, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ result: RESULTS.single }), expect: 820 / 13, tolerance: 1e-12 },
    { ctx: ctx({ result: RESULTS.odd }), expect: null }],

  results_csv: { ctx: ctx({ hide: [2, 3] }), filename: "find-results.csv",
    text: '"question","verdict","exists","top line","top probability","top line text"\r\n'
      + `"can I bring my dog to work?","answered","0.82","L010","0.71","${DOG_TOP}"\r\n`
      + `"what is the wifi password?","partial","0.48","L012","0.38","${WIFI_TOP}"\r\n` },
  results_markdown: { ctx: ctx({ order: [4, 1], hide: [2, 3] }), filename: "find-results.md",
    text: "| Question | Verdict | Exists | Top line |\n| --- | --- | --- | --- |\n"
      + `| what is the wifi password? | partial | 48.0% | L012 ${WIFI_TOP} |\n`
      + `| can I bring my dog to work? | answered | 82.0% | L010 ${DOG_TOP} |\n` },
  questions_text: { ctx: ctx({ hide: [1] }), filename: "find-questions.txt",
    text: "can I bring my dog to work?\nhow much notice do I have to give before I quit?\nis there paid parental leave?\nwhat is the wifi password?\n",
    excludes: ["answered", "L010", "0.71", "0.82"] },

  // Shown in the order 4, 3, 2, 1 with question 1 focused: next wraps around to question 4 (index 3).
  next_question: { ctx: () => ctx({ order: [4, 3, 2, 1] }), check: (c) => assert.deepEqual(c.log, [["focusResult", 3]]), hidden: () => empty() },
  // Question 1 focused and question 4 hidden: previous wraps around to question 3 (index 2).
  previous_question: { ctx: () => ctx({ hide: [4] }), check: (c) => assert.deepEqual(c.log, [["focusResult", 2]]), hidden: () => ctx({ hide: [1, 2, 3, 4] }) },
  // Question 3 focused: its top line is L006. Hidden while the document is open in its text box.
  show_top: { ctx: () => ctx({ focusIndex: 2 }), check: (c) => assert.deepEqual(c.log, [["focusResult", 2], ["showLine", 6]]), hidden: () => ctx({ editing: true }) },
  copy_top: { ctx: () => ctx({ focusIndex: 1 }), check: (c) => assert.deepEqual(c.env.copied, ["L008| Please give at least two weeks notice when you resign."]),
    hidden: () => ctx({ result: RESULTS.odd, focusIndex: 1 }) },
}, { ctx: () => ctx() });
