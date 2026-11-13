import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/reviews/review-example-facts.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleReviewsExamplesCtx, sampleReviewsSetup } from "./fixtures/reviews.mjs";

const ACTIONS = { thank: "Thank-you template", reply: "A person replies", moderate: "Hold for moderation" };
const TEAMS = { cafes: "Cafés", roasting: "Roasting" };
const factCtx = (items, data) => fakeCtx({ items, data });
const only = (...labels) => sampleReviewsExamplesCtx({ matches: (item) => labels.includes(item.label) });
const FLAT = sampleReviewsSetup().examples[1].text;

const actionItems = [{ expect: { action: "thank" } }, { expect: { action: "reply" } }, { expect: null }, { expect: { action: "mystery" } }];
const teamItems = [{ expect: { team: "cafes" } }, { expect: { team: "roasting" } }, {}, { expect: { team: "night_shift" } }];

checkPack(pack, {
  stars: { items: [{ stars: 5 }, { stars: 2 }, { stars: null }], values: [5, 2, null] },
  chars: { items: [{ chars: 89 }, { chars: 9 }, { chars: "x" }], values: [89, 9, null] },
  words: { items: [{ words: 16 }, { words: 0 }, {}], values: [16, 0, null] },
  // "No..." is one break, and the empty run after the last "!" is not a sentence.
  sentences: { items: [{ text: "Best flat white. Great croissant!" }, { text: "Fine." }, { text: "Is it fresh? No... It was not!" }, { text: "" }, {}],
    values: [2, 1, 3, 0, null] },
  triaged: { items: [{ triaged: 2 }, { triaged: 0 }, {}], values: [2, 0, null] },
  channel: { items: [{ channel_label: "Map listing", channel: "maps" }, { channel_label: "", channel: "fax" }, { channel_label: "", channel: "" }],
    values: ["Map listing", "fax", null] },
  expected_action: { items: actionItems, values: ["Thank-you template", "A person replies", null, "mystery"], ctx: factCtx(actionItems, { actions: ACTIONS }) },
  expected_team: { items: teamItems, values: ["Cafés", "Roasting", null, "night_shift"], ctx: factCtx(teamItems, { teams: TEAMS }) },
  text: { items: [{ text: "Flat papery taste" }, { text: "Warm croissant" }, {}], values: ["Flat papery taste", "Warm croissant", ""] },
  about: { items: [{ about: "Pier Street café" }, { about: "Harbor Burr Grinder" }, { about: "" }], values: ["Pier Street café", "Harbor Burr Grinder", ""] },
  has_subject: { items: [{ about: "Pier Street café" }, { about: "   " }, {}], values: [true, false, false] },
  loaded: { items: [{ loaded: true }, { loaded: false }], values: [true, false] },
  expected_flag: { items: [{ expect: { flags: ["safety"] } }, { expect: { flags: [] } }, { expect: null }], values: [true, false, false] },
  money: { items: [{ text: "Total waste of $180." }, { text: "It cost 24 dollars" }, { text: "Three months old" }, { text: "Order 12 arrived" }],
    values: [true, true, false, false] },
  question: { items: [{ text: "Could you send a fresh bag?" }, { text: "Fine." }], values: [true, false] },

  no_expectation: { hit: { label: "Example 6", expect: null }, miss: { label: "Flat beans", expect: { action: "reply", team: "roasting", flags: [] } }, message: /no expected decision/ },
  uncovered_actions: {
    hitList: [{ expect: { action: "thank" } }, { expect: null }],
    missList: [{ expect: { action: "thank" } }, { expect: { action: "reply" } }, { expect: { action: "moderate" } }],
    message: /^No shown example expects: A person replies; Hold for moderation\.$/,
    ctx: fakeCtx({ data: { actions: ACTIONS } }),
  },

  // Stars 5, 2, 1, 5, 5 and one unknown: 18 / 5. Hiding the 5-star ones leaves 2 and 1.
  mean_stars: [{ ctx: sampleReviewsExamplesCtx(), expect: 3.6, empty: sampleReviewsExamplesCtx({ setup: null }) },
    { ctx: sampleReviewsExamplesCtx({ matches: (item) => item.stars !== 5 }), expect: 1.5 }],
  // 16 + 24 + 19 + 14 + 14 + 1 = 88 words over 6 examples.
  mean_words: [{ ctx: sampleReviewsExamplesCtx(), expect: 88 / 6, tolerance: 1e-12, empty: sampleReviewsExamplesCtx({ setup: null }) },
    { ctx: only("Five stars, angry", "Example 6"), expect: 7.5 }],
  // Warm welcome (1 check) and Flat beans (2 checks) of 6 shown.
  checked_share: [{ ctx: sampleReviewsExamplesCtx(), expect: (result) => { assert.ok(Math.abs(result.value - 1 / 3) < 1e-12); assert.equal(result.detail, "2 of 6"); },
    empty: sampleReviewsExamplesCtx({ setup: null }) },
  { ctx: sampleReviewsExamplesCtx({ history: [], calls: 0 }), expect: 0 }],
  // thank, reply, escalate, reply, moderate and none: 4 distinct.
  expected_actions: [{ ctx: sampleReviewsExamplesCtx(), expect: 4, empty: sampleReviewsExamplesCtx({ setup: null }) },
    { ctx: only("Flat beans", "Five stars, angry"), expect: 1 }],

  shown_csv: {
    ctx: only("Flat beans", "Example 6"),
    filename: "review-examples.csv",
    text: '"label","stars","channel","about","text","expected_action","expected_team","expected_flags"\r\n'
      + `"Flat beans","2","website","Harbor House Blend, 340 g bag","${FLAT}","reply","roasting",""\r\n`
      + '"Example 6","","fax","","  Fine.  ","","",""\r\n',
    excludes: ["Warm welcome", "freshness"],
  },
  shown_markdown: {
    ctx: only("Phone repair ad", "Example 6"),
    filename: "review-examples.md",
    text: "- **Phone repair ad** (5 stars, Map listing): Cracked screen? Quickfix Phones on Elm Road fixes it while you wait at quickfix.example!\n"
      + "- **Example 6** (? stars, fax): Fine.\n",
  },

  // From Flat beans (index 1), with Scalded wrist (index 2) hidden by a filter, the next shown is index 3.
  next: { ctx: () => sampleReviewsExamplesCtx({ matches: (item) => item.index !== 2 }),
    check: (ctx) => { assert.deepEqual(ctx.log, [["use", 3]]); assert.equal(ctx.data.loaded, 3); },
    hidden: () => sampleReviewsExamplesCtx({ running: true }) },
  // From the first example the previous one wraps to the last shown (index 5).
  previous: { ctx: () => { const first = sampleReviewsSetup().examples[0]; return sampleReviewsExamplesCtx({ draft: { stars: 5, channel: "maps", about: first.about, text: first.text } }); },
    check: (ctx) => { assert.deepEqual(ctx.log, [["use", 5]]); assert.equal(ctx.data.loaded, 5); },
    hidden: () => sampleReviewsExamplesCtx({ matches: () => false }) },
  focus_text: { ctx: () => sampleReviewsExamplesCtx(), check: (ctx) => assert.deepEqual(ctx.log, [["focusText"]]) },
}, { ctx: () => sampleReviewsExamplesCtx() });
