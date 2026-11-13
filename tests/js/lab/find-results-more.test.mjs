import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/find/find-results-more.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { DOC_LINES, QUERIES, RESULTS, resultsByPosition, sampleFindResultsCtx } from "./fixtures/find.mjs";

// Reference values come from the answer table in tests/js/lab/fixtures/find.mjs:
//   handbook  1 dog    L010 .71  L009 .20  L011 .04  L002 .03  L005 .02  (L000 missing)          exists .82 answered
//             2 notice L008 .64  L006 .30  L007 .03  L003 .02  L000 .005  L012 .005               exists .93 answered
//             3 parent L006 .41  L005 .22  L004 .20  L000 .10  L012 .07                           exists .12 absent
//             4 wifi   L012 .38  L001 .30  L000 .16  L011 .10  L003 .06                           exists .48 partial
//   mixed     1 Sunday L002 .55  L003 .30  L001 .10  L000 .05                                     exists .20 absent
//             2 entr.  L001 .15  L000 .14  L003 .14  L004 .12  L011 .10  L002/5/6 .09  L007 .08   exists .75 answered
//             3 payday L005 .97  L004 .02  L006 .01                                               exists .97 answered
// Sections: L000 none, A = L001–L003, B = L004–L006, C = L007–L008, D = L009–L010, E = L011–L012.
const ctx = (overrides) => sampleFindResultsCtx(overrides);
const H = resultsByPosition(ctx());
const M = resultsByPosition(ctx({ result: RESULTS.mixed }));
const O = resultsByPosition(ctx({ result: RESULTS.odd }));
const empty = () => ctx({ result: null });
const feature = (id) => pack.features.find((entry) => entry.id === id);
// p ln p, summed by hand over the nonzero probabilities; a question's line_probs has 13 entries.
const plnp = (...ps) => ps.reduce((sum, p) => sum + p * Math.log(p), 0);
const LN13 = Math.log(13);

checkPack(pack, {
  // .64 + .30 + .03 + .02 + .005 (the fifth is unlisted, under 1%); .15 + .14 + .14 + .12 + .10; .97 + .02 + .01 + 0 + 0;
  // O[1]'s top hit has no number and O[2] has no hits.
  hit_mass: { items: [H[2], M[2], M[3], O[1], O[2]], values: [0.995, 0.65, 1, null, null] },
  // Checked against a separate Python computation: dog 0.342014, payday 0.059977. One line holding all is 0; four
  // equal lines are exactly 1.
  spread: { items: [H[1], M[3], O[1], { line_probs: [0, 0, 0] }, { line_probs: [0, 1, 0] }, { line_probs: [0.25, 0.25, 0.25, 0.25] }],
    values: [-plnp(0.71, 0.2, 0.04, 0.03, 0.02) / LN13, -plnp(0.97, 0.02, 0.01) / LN13, null, null, 0, 1] },
  // Dog: .71 and .20 (L011 is 4%); parental: all five; entrance: nine lines from 8% to 15%; Sunday: .55 .30 .10 and
  // L000 at exactly 5%, which counts.
  highlighted: { items: [H[1], H[3], M[2], M[1], O[1]], values: [2, 5, 9, 4, null] },
  third_prob: { items: [H[1], H[3], M[3], O[2]], values: [0.04, 0.2, 0.01, null] },
  // Dog: D = .20 + .71; notice: C = .03 + .64; parental: B = .20 + .22 + .41; wifi: E = .10 + .38; entrance (same
  // document): A = .15 + .09 + .14.
  section_mass: { ctx: ctx(), items: [H[1], H[2], H[3], H[4], M[2], O[1]], values: [0.91, 0.67, 0.83, 0.48, 0.38, null] },
  // Focus on question 3 (parental), whose top line is L006. Dog gives L006 0 with five lines above 0; notice gives it
  // .30 with only L008 (.64) above; wifi gives it 0 with five lines above.
  focus_top_rank: { ctx: ctx({ focusIndex: 2 }), items: [H[1], H[2], H[3], H[4], O[1]], values: [6, 2, 1, 6, null] },
  // Dog: D and D; notice: C and B; parental: B and B; wifi: E and A.
  same_section_top2: { items: [H[1], H[2], H[3], H[4]], values: [true, false, true, false] },
  // .75 is 5 points from .70 and .38 is 3 points from .35; .82, .48 and a missing exists are not near either.
  // .30 is exactly 5 points under .35 (in), .29 and .76 are 6 points away (out).
  near_threshold: { ctx: ctx(), items: [M[2], H[1], { exists: 0.38 }, H[4], O[1], { exists: 0.3 }, { exists: 0.29 }, { exists: 0.76 }],
    values: [true, false, true, false, false, true, false, false] },
  opening_word: { items: [H[1], H[2], H[3], M[1], O[1]], values: ["can", "how", "is", "who", null] },

  short_question: { hit: [{ query: "wifi password?" }, { query: "Pets" }], miss: [H[1], O[1]], message: /^Only [12] words?\./ },
  // The entrance question is answered with nine lines between 8% and 15% (spread about 0.85).
  flat_answered: { hit: M[2], miss: [H[1], H[4], M[3], { ...M[2], verdict: "partial" }], message: /spread 0\.85;/ },
  // Parental lists all five lines, Sunday four (its fifth is 0%).
  absent_many_listed: { hit: [H[3], M[1]], miss: [H[1], O[2]], message: /lists [45] lines/ },
  first_line_top: { hit: { top: { id: "L000", index: 0, text: DOC_LINES[0] } }, miss: [H[1], O[2]], message: /^The top line is L000/ },
  duplicate_questions: { hitList: [H[1], H[2], { position: 5, query: "Can I bring my DOG to work" }], missList: Object.values(H),
    message: /^Q1, Q5 ask the same words/ },
  stale_result: { ctx: ctx({ queries: [...QUERIES.slice(0, 3), "where do I park?"] }), missCtx: ctx(),
    hitList: Object.values(H), missList: Object.values(H), message: /no longer hold/ },
  truncated_document: { ctx: ctx({ result: { ...RESULTS.handbook, truncated: true } }), missCtx: ctx(),
    hitList: Object.values(H), missList: Object.values(H), message: /^Only the first 255 lines/ },

  // (.82 + .93 + .12 + .48) / 4, and without parental (.82 + .93 + .48) / 3.
  mean_exists: [{ ctx: ctx(), expect: 0.5875, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ hide: [3] }), expect: 2.23 / 3, tolerance: 1e-12 }],
  // At 5% or more: L000, L001, L003–L006, L008–L012 (L002 and L007 peak at 3%): 11 of 13. Dog and notice alone:
  // L006, L008, L009, L010. The odd result has no line count.
  document_coverage: [{ ctx: ctx(), expect: 11 / 13, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ hide: [3, 4] }), expect: 4 / 13, tolerance: 1e-12 },
    { ctx: ctx({ result: RESULTS.odd }), expect: null }],
  latency_per_question: [{ ctx: ctx(), expect: 103.15, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ result: RESULTS.single }), expect: 188 },
    { ctx: ctx({ result: RESULTS.odd }), expect: null }],

  hits_csv: { ctx: ctx({ result: RESULTS.single }), filename: "find-hits.csv",
    text: '"question","query","rank","line","probability","listed","section","text"\r\n'
      + '"Q1","can I bring my dog to work?","1","L010","0.71","yes","Section D: Pets","Only service animals are allowed behind the counter; pets may wait on the patio."\r\n'
      + '"Q1","can I bring my dog to work?","2","L009","0.2","yes","Section D: Pets","Section D: Pets"\r\n'
      + '"Q1","can I bring my dog to work?","3","L011","0.04","yes","Section E: Contact","Section E: Contact"\r\n'
      + '"Q1","can I bring my dog to work?","4","L002","0.03","yes","Section A: Hours and scheduling","The cafe is open 6:30 am to 6:00 pm Monday through Saturday."\r\n'
      + '"Q1","can I bring my dog to work?","5","L005","0.02","yes","Section B: Pay and time off","Payday is every other Friday by direct deposit."\r\n' },
  handoff_json: { ctx: ctx(), filename: "find-search-handoff.json", includes: [QUERIES[3], DOC_LINES[12]],
    excludes: ["0.71", "answered", "exists", "jev-1.14.0", "L000|", "probabilit"],
    check: (out) => assert.deepEqual(JSON.parse(out.text), { questions: [...QUERIES], document: [...DOC_LINES] }) },
  // Parental (question 3): L000 10%, L004 20%, L005 22%, L006 41%, L012 7%, every other line 0.
  focused_probs_csv: { ctx: ctx({ focusIndex: 2 }), filename: "find-q3-line-probabilities.csv",
    includes: ['"line","probability","text"\r\n"L000","0.1","Harbor Coffee Co. Team Handbook, revised September 2026."\r\n"L001","0",',
      '"L006","0.41","Paid time off requests need two weeks notice."\r\n', '"L012","0.07",'],
    check: (out) => {
      assert.equal(out.text.split("\r\n").length, 15, "a header, 13 lines and the final break");
      // The dog question's response holds no number for L000: its cell stays blank.
      assert.ok(runExporter(feature("focused_probs_csv"), ctx()).text.includes('"L000","","Harbor'));
      assert.equal(runExporter(feature("focused_probs_csv"), empty()).text, "");
    } },
}, { ctx: () => ctx() });

test("find-results-more: spread is +0, not -0, when one line holds everything", () => {
  assert.ok(Object.is(feature("spread").value({ line_probs: [0, 1, 0] }), 0));
});
test("find-results-more: focus_top_rank follows the focused question (focus 1: dog's top line L010)", () => {
  // Notice gives L010 0 with six lines above 0 (L008, L006, L007, L003, L000, L012); parental and wifi five.
  const one = ctx();
  assert.deepEqual([H[1], H[2], H[3], H[4]].map((item) => feature("focus_top_rank").value(item, one)), [1, 7, 6, 6]);
  assert.equal(feature("focus_top_rank").value(H[1], empty()), null);
});
