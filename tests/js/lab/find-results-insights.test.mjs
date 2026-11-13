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

checkPack(pack, {
  top_prob: { items: [H[1], H[3], O[1], M[3]], values: [0.71, 0.41, null, 0.97] },
  // O[1]'s exists arrived as the text "0.5", which is not a number.
  exists_p: { items: [H[1], H[3], O[1]], values: [0.82, 0.12, null] },
  // O[1]: its second hit is the one without an index (2%); O[2] has no hits.
  runner_up: { items: [H[1], H[2], H[4], O[2], O[1]], values: [0.2, 0.3, 0.3, null, 0.02] },
  // .71 - .20, .64 - .30, .38 - .30, .15 - .14; O[1]'s top probability is not a number.
  lead: { items: [H[1], H[2], H[4], M[2], O[1]], values: [0.51, 0.34, 0.08, 0.01, null], tolerance: 1e-9 },
  confidence: { items: [H[1], H[2], O[1]], values: [0.71, 0.64, null] },
  // All five for the dog; the notice question's fifth line is 0.5%; payday lists 97%, 2% and 1%; no hits at all.
  listed: { items: [H[1], H[2], M[3], O[2]], values: [5, 4, 3, 0] },
  query_words: { items: [H[1], H[2], H[3], O[1]], values: [7, 11, 5, null] },
  verdict: { items: [H[1], H[3], H[4], O[1]], values: ["answered", "absent", "partial", null] },
  top_section: { items: [H[1], H[2], H[3], O[2], { top: { id: "L000", text: "Harbor Coffee Co. Team Handbook", section: null } }],
    values: ["Section D: Pets", "Section C: Leaving Harbor Coffee", "Section B: Pay and time off", null, "no section"] },
  query_text: { items: [H[1], H[3], O[1]], values: [QUERIES[0], QUERIES[2], "  "] },
  top_text: { items: [H[1], H[4], O[2]], values: [DOG_TOP, WIFI_TOP, ""] },
  strong_top: { items: [H[1], H[3], O[2]], values: [true, false, false] },
  // Sunday: absent but L002 at 55%; entrance: answered but its top line is only 15%.
  disagrees: { items: [M[1], M[2], H[1], H[3]], values: [true, true, false, false] },
  // The entrance question's top line is "Section A: Hours and scheduling", as is the odd result's.
  top_heading: { items: [M[2], O[1], H[1]], values: [true, true, false] },
  // The dog's listed lines span Sections D, E, A and B; payday's are all in Section B.
  spread: { items: [H[1], M[3], O[2]], values: [true, false, false] },

  close_call: { hit: [M[2], H[4]], miss: [H[1], H[2], O[2]], message: /leads the second by only (1\.0|8\.0) points/ },
  partial: { ctx: ctx(), hit: H[4], miss: [H[1], H[3]], message: /48\.0%, between absent \(< 35\.0%\) and answered \(≥ 70\.0%\)/ },
  shared_top: { hitList: [H[1], H[3], { position: 5, top: { id: "L006" } }], missList: Object.values(H), message: /L006 is the top line for 2 questions \(Q3, Q5\)/ },

  // 2 of 4 answered; without the dog question 1 of 3.
  answered_share: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "2 of 4"); }, empty: empty() },
    { ctx: ctx({ hide: [1] }), expect: 1 / 3, tolerance: 1e-12 }],
  // (.71 + .64 + .41 + .38) / 4 and (.41 + .38) / 2.
  mean_top: [{ ctx: ctx(), expect: 0.535, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ hide: [1, 2] }), expect: 0.395, tolerance: 1e-12 }],
  // $0.000092 over four questions; the single search's $0.000041 over one.
  cost_per_question: [{ ctx: ctx(), expect: 0.000023, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ result: RESULTS.single }), expect: 0.000041, tolerance: 1e-12 },
    { ctx: ctx({ result: RESULTS.odd }), expect: null }],
  // 1,840 input tokens over 13 lines; 820 over 13.
  tokens_per_line: [{ ctx: ctx(), expect: 141.538461538, tolerance: 1e-9, empty: empty() }, { ctx: ctx({ result: RESULTS.single }), expect: 63.076923077, tolerance: 1e-9 }],

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
    excludes: ["answered", "L010", "0.71"] },

  // Shown in the order 4, 3, 2, 1 with question 1 focused: next wraps around to question 4 (index 3).
  next_question: { ctx: () => ctx({ order: [4, 3, 2, 1] }), check: (c) => assert.deepEqual(c.log, [["focusResult", 3]]), hidden: () => empty() },
  // Question 1 focused and question 4 hidden: previous wraps around to question 3 (index 2).
  previous_question: { ctx: () => ctx({ hide: [4] }), check: (c) => assert.deepEqual(c.log, [["focusResult", 2]]), hidden: () => ctx({ hide: [1, 2, 3, 4] }) },
  // The dog question's top line is L010.
  show_top: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["focusResult", 0], ["showLine", 10]]), hidden: () => empty() },
  copy_top: { ctx: () => ctx({ focusIndex: 1 }), check: (c) => assert.deepEqual(c.env.copied, ["L008| Please give at least two weeks notice when you resign."]),
    hidden: () => ctx({ result: RESULTS.odd, focusIndex: 1 }) },
}, { ctx: () => ctx() });
