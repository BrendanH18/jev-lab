// Tests of the find-results-extra pack on tests/js/lab/fixtures/find.mjs. The handbook search has four questions:
//   Q1 "can I bring my dog to work?"  answered 0.82, top L010 0.71 (Section D), listed lines in D, D, E, A, B; 2 headings
//   Q2 "how much notice ... quit?"    answered 0.93, top L008 0.64, four listed lines in C, B, C, A; 1 heading
//   Q3 "is there paid parental leave?" absent 0.12, top L006 0.41, listed lines in B, B, B, (above any heading), E; 1 heading
//   Q4 "what is the wifi password?"   partial 0.48, top L012 0.38 (holds 555-0142)
// Q1 is focused. The search's measured cost is $0.000092. Expected values are worked out by hand from those numbers.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/find/find-results-extra.js";
import { checkPack } from "./harness.mjs";
import { RESULTS, resultsByPosition, sampleFindResultsCtx } from "./fixtures/find.mjs";

const ctx = (overrides) => sampleFindResultsCtx(overrides);
const none = () => ctx({ result: null });
const Q = resultsByPosition(ctx());
const ODD = resultsByPosition(ctx({ result: RESULTS.odd }));
const feature = (id) => pack.features.find((entry) => entry.id === id);

checkPack(
  pack,
  {
    query_chars: { items: [Q[1], Q[3], Q[4], ODD[1]], values: [27, 29, 26, null] },
    heading_hits: { items: [Q[1], Q[2], Q[3], ODD[2]], values: [2, 1, 1, null] },
    sections_listed: { items: [Q[1], Q[2], Q[3], ODD[2]], values: [4, 3, 3, null] },
    top_line_number: { items: [Q[1], Q[2], Q[3], Q[4], ODD[2]], values: [11, 9, 7, 13, null] },
    // 0.82 - 0.71, 0.93 - 0.64, 0.12 - 0.41, 0.48 - 0.38.
    exists_gap: { items: [Q[1], Q[2], Q[3], Q[4], ODD[2]], values: [0.11, 0.29, -0.29, 0.1, null], tolerance: 1e-9 },
    ends_question_mark: { items: [Q[1], { position: 9, query: "wifi password" }], values: [true, false] },
    focused: { items: [Q[1], Q[2]], values: [true, false], ctx: ctx() },
    top_has_number: { items: [Q[4], Q[1], ODD[2]], values: [true, false, false] },
    // Q2 shares "give" and "notice" with its top line, Q3 shares "paid"; Q1 and Q4 share nothing.
    word_overlap: { items: [Q[1], Q[2], Q[3], Q[4]], values: [false, true, true, false] },
    strength: {
      items: [Q[1], Q[3], { position: 9, top_prob: 0.1 }, ODD[2]],
      values: ["strong", "moderate", "weak", null],
    },
    second_text: {
      items: [Q[1], Q[2], ODD[2]],
      values: ["Section D: Pets", "Paid time off requests need two weeks notice.", ""],
    },

    no_overlap: { hit: Q[1], miss: [Q[2], Q[4], ODD[2]], message: /^L010 shares no word with the question/ },
    no_hits: { hit: ODD[2], miss: Q[1] },
    long_question: {
      hit: { position: 9, query: Array.from({ length: 26 }, () => "word").join(" ") },
      miss: [Q[2], { position: 8, query: Array.from({ length: 25 }, () => "word").join(" ") }],
      message: /^26 words\./,
    },

    mean_top_prob: [
      { ctx: ctx(), expect: 2.14 / 4, tolerance: 1e-9, empty: none() },
      { ctx: ctx({ hide: [1, 2] }), expect: (0.41 + 0.38) / 2, tolerance: 1e-9 },
    ],
    distinct_top_lines: [
      { ctx: ctx(), expect: 4, empty: none() },
      { ctx: ctx({ hide: [4] }), expect: 3 },
    ],
    thousand_searches: [
      { ctx: ctx(), expect: 0.092, tolerance: 1e-9, empty: none() },
      { ctx: ctx({ result: RESULTS.single }), expect: 0.041, tolerance: 1e-9 },
    ],

    top_lines_md: {
      ctx: ctx(),
      filename: "find-top-lines.md",
      text:
        "# Find results: top lines\n\n" +
        "1. can I bring my dog to work? — answered, answer-exists 82%\n   Top line L010 at 71%: Only service animals are allowed behind the counter; pets may wait on the patio.\n" +
        "2. how much notice do I have to give before I quit? — answered, answer-exists 93%\n   Top line L008 at 64%: Please give at least two weeks notice when you resign.\n" +
        "3. is there paid parental leave? — absent, answer-exists 12%\n   Top line L006 at 41%: Paid time off requests need two weeks notice.\n" +
        "4. what is the wifi password? — partial, answer-exists 48%\n   Top line L012 at 38%: Questions about this handbook go to people@harborcoffee.example or call 555-0142.\n",
      check: () => {
        const odd = feature("top_lines_md").build(ctx({ result: RESULTS.odd }));
        assert.ok(odd.includes("2. do we ship to Canada? — absent, answer-exists 20%\n   No line listed.\n"));
      },
    },
    results_json: {
      ctx: ctx({ hide: [2, 3] }),
      filename: "find-results.json",
      excludes: ["latency", "L005"],
      check: (out) => {
        const rows = JSON.parse(out.text);
        assert.deepEqual(
          rows.map((row) => row.position),
          [1, 4],
        );
        assert.deepEqual(rows[0], {
          position: 1,
          query: "can I bring my dog to work?",
          verdict: "answered",
          exists: 0.82,
          top: {
            id: "L010",
            text: "Only service animals are allowed behind the counter; pets may wait on the patio.",
            prob: 0.71,
          },
        });
      },
    },

    copy_focused_query: {
      ctx: () => ctx({ focusIndex: 1 }),
      hidden: none,
      check: (c) => assert.deepEqual(c.env.copied, ["how much notice do I have to give before I quit?"]),
    },
    focus_weakest: {
      ctx: () => ctx(),
      hidden: () => ctx({ focusIndex: 2 }),
      check: (c) => {
        assert.deepEqual(c.log, [["focusResult", 2]], "Q3 (0.12) is the weakest; the page focuses by 0-based index");
        const filtered = ctx({ hide: [3] });
        feature("focus_weakest").run(filtered);
        assert.deepEqual(filtered.log, [["focusResult", 3]], "with Q3 hidden, Q4 (0.48) is the weakest shown");
      },
    },
    say_verdicts: {
      ctx: () => ctx(),
      hidden: none,
      check: (c) => {
        assert.equal(c.env.toasts[0].message, "Verdicts of the 4 shown questions: 2 answered, 1 partial, 1 absent.");
        const odd = ctx({ result: RESULTS.odd });
        feature("say_verdicts").run(odd);
        assert.equal(
          odd.env.toasts[0].message,
          "Verdicts of the 3 shown questions: 0 answered, 0 partial, 1 absent, 2 without a verdict.",
        );
      },
    },
  },
  { ctx: () => ctx() },
);
