import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/reviews/reviews-example-more.js";
import { checkPack } from "./harness.mjs";
import { sampleReviewsExamplesCtx } from "./fixtures/reviews.mjs";

const FLAT = "The bag that came last week was roasted almost three months ago. Flat, papery taste and no crema. Could you send a fresh bag?";
const WARM = "Best flat white in town. The barista remembered my name and the croissant was still warm.";
const only = (...indexes) => sampleReviewsExamplesCtx({ matches: (item) => indexes.includes(item.index) });
const feature = (id) => pack.features.find((entry) => entry.id === id);

checkPack(pack, {
  // "Wow! Great!!" holds three marks; text that is missing is unavailable.
  exclamations: { items: [{ text: "Wow! Great!!" }, { text: "Fine." }, {}], values: [3, 0, null] },
  // ABcd: 2 of 4; "Hi there": 1 of 7 letters; no letters: unavailable; "ÉCLAIR é": 6 of 7 (accented capitals count).
  upper_share: { items: [{ text: "ABcd" }, { text: "Hi there" }, { text: "123 !" }, { text: "ÉCLAIR é" }], values: [0.5, 1 / 7, null, 6 / 7], tolerance: 1e-12 },
  // Letters and digits only: I + wasn't + sure = (1 + 5 + 4) / 3; berry-like + ok = (9 + 2) / 2; "Café 2" = (4 + 1) / 2 (é counts once);
  // punctuation alone has no words.
  avg_word_length: { items: [{ text: "I wasn't sure." }, { text: "berry-like, ok" }, { text: "Café 2" }, { text: "!!!" }], values: [10 / 3, 5.5, 2.5, null], tolerance: 1e-12 },
  // A bare domain and a https address count; a decimal, "e.g." and an e-mail address do not.
  web_addresses: { items: [{ text: "Visit quickfix.example or https://shop.harbor.example/deals now" }, { text: "Pi is 3.14, e.g. this." },
    { text: "mail me at sam@harbor.example" }, {}], values: [2, 0, 0, null] },
  largest_amount: { items: [{ text: "Total waste of $180 and $24.50 shipping" }, { text: "Paid $1,250.00 twice" }, { text: "No money here" }], values: [180, 1250, null] },

  kw_refund: { items: [{ text: "Please REFUND the second charge." }, { text: "Fine coffee." }, { text: "Charger cable broke" }], values: [true, false, false] },
  // "deliverable" holds "deliver" but runs on into a letter, so it is not the keyword.
  kw_delivery: { items: [{ text: "It arrived on Friday." }, { text: "A deliverable plan." }, { text: "Shipping was quick" }, { text: "Two parcels went missing" }],
    values: [true, false, true, true] },
  kw_cafe: { items: [{ text: "Best latte at the café" }, { text: "Great beans" }, { text: "The CAFE staff" }], values: [true, false, true] },
  kw_equipment: { items: [{ text: "The burrs squeal" }, { text: "Burrata was nice" }, { text: "My French  press cracked" }], values: [true, false, true] },
  // "burnt" describes a roast's taste, so it is not an injury keyword; "ill" inside "Will" does not count.
  kw_injury: { items: [{ text: "I have a blister now" }, { text: "Tastes burnt and bitter" }, { text: "Will it brew?" }, { text: "My son got SICK" }], values: [true, false, false, true] },
  kw_stale: { items: [{ text: "roasted three months ago" }, { text: "Fresh and bright" }, { text: "Papery taste" }], values: [true, false, true] },
  kw_advert: { items: [{ text: "50% off this week" }, { text: "Phones fixed while you wait!" }, { text: "I paid 50% more" }], values: [true, true, false] },
  // "may" is left out on purpose (a common verb); a bare number is no date.
  kw_date: { items: [{ text: "Back on Saturday" }, { text: "It came on the 14th" }, { text: "Mayhem at the counter" }, { text: "Room 12 was cold" }, { text: "Monday's order" }],
    values: [true, true, false, false, true] },
  edge_space: { items: [{ text: "  Fine.  " }, { text: "Fine." }, { text: "   " }], values: [true, false, false] },

  expects_mismatch: { items: [{ expect: { action: "reply", flags: ["rating_mismatch"] } }, { expect: { action: "escalate", flags: ["safety"] } }, {}], values: [true, false, false] },
  // The same set in another order or with a repeat reads the same; unknown flags follow the known ones.
  expected_flags: { items: [{ expect: { flags: ["safety", "rating_mismatch"] } }, { expect: { flags: ["rating_mismatch", "safety", "safety"] } }, { expect: { action: "reply", flags: [] } },
    { expect: null }, { expect: { flags: ["zz_custom", "not_about_us"] } }],
    values: ["safety + rating_mismatch", "safety + rating_mismatch", "none", null, "not_about_us + zz_custom"] },

  unknown_channel: { ctx: sampleReviewsExamplesCtx(), hit: [{ channel: "fax" }, { channel: "" }], miss: [{ channel: "maps" }, { channel: "website" }], message: /server would refuse/ },
  unknown_team: { ctx: sampleReviewsExamplesCtx(), hit: { expect: { action: "reply", team: "baristas", flags: [] } },
    miss: [{ expect: { action: "reply", team: "roasting", flags: [] } }, { expect: null }], message: /team "baristas"/ },
  thank_low_stars: { hit: { stars: 3, expect: { action: "thank", flags: [] } },
    miss: [{ stars: 4, expect: { action: "thank", flags: [] } }, { stars: 2, expect: { action: "reply", flags: [] } }, { stars: null, expect: { action: "thank", flags: [] } }],
    message: /for a 3-star review/ },
  mismatch_mid_stars: { hit: { stars: 3, expect: { action: "reply", flags: ["rating_mismatch"] } },
    miss: [{ stars: 5, expect: { action: "reply", flags: ["rating_mismatch"] } }, { stars: 3, expect: { action: "reply", flags: [] } }], message: /at most 2 levels away/ },
  escalate_safety_pair: { hit: [{ expect: { action: "escalate", flags: [] } }, { expect: { action: "reply", flags: ["safety"] } }],
    miss: [{ expect: { action: "escalate", flags: ["safety"] } }, { expect: { action: "thank", flags: [] } }, { expect: null }],
    message: /^A person (expects escalate but lists no safety flag|lists the safety flag but expects no escalation)\.$/ },
  moderation_pair: { hit: [{ expect: { action: "moderate", team: "cafes", flags: [] } }, { expect: { action: "log", team: "moderation", flags: [] } }],
    miss: [{ expect: { action: "moderate", team: "moderation", flags: [] } }, { expect: { action: "reply", team: "roasting", flags: [] } }, { expect: null }],
    message: /^A person (expects moderate but names team "cafes"|names the moderation team but expects "log")\.$/ },
  duplicate_words: { hitList: [{ label: "A", stars: 5, text: "Fine.", channel: "maps", about: "" }, { label: "B", stars: 1, text: " Fine. ", channel: "maps", about: "" }],
    missList: [{ label: "A", text: "Fine.", channel: "maps", about: "" }, { label: "C", text: "Fine.", channel: "app", about: "" }],
    message: /^A and B have the same words/ },

  shown_jsonl: { ctx: only(0, 5), filename: "review-examples.jsonl",
    text: `{"label":"Warm welcome","stars":5,"channel":"maps","about":"Pier Street café","text":"${WARM}","expect":{"action":"thank","team":"cafes","flags":[]}}\n`
      + '{"label":"Example 6","stars":null,"channel":"fax","about":"","text":"  Fine.  ","expect":null}\n' },
  // Both texts hold 14 whitespace-separated words (counted by hand).
  shown_table: { ctx: only(3, 4), filename: "review-examples-table.md",
    text: ["| Example | Stars | Channel | Subject | Words | Expected action (hand-written) |", "| --- | --- | --- | --- | --- | --- |",
      "| Five stars, angry | 5 | Website review | Harbor Burr Grinder | 14 | reply |", "| Phone repair ad | 5 | Map listing |  | 14 | moderate |", ""].join("\n"),
    excludes: ["squeal", "quickfix"] },
  loaded_json: { ctx: sampleReviewsExamplesCtx(), filename: "review-example.json",
    text: `{\n  "label": "Flat beans",\n  "stars": 2,\n  "channel": "website",\n  "about": "Harbor House Blend, 340 g bag",\n  "text": "${FLAT}"\n}\n`,
    excludes: ["roasting", "expect"],
    check: () => assert.throws(() => feature("loaded_json").build(sampleReviewsExamplesCtx({ draft: { stars: 1, channel: "app", about: "", text: "Something else" } })), /pick one first/) },
  // Groups follow the setup's action order; the example without an expectation comes last.
  by_action: { ctx: sampleReviewsExamplesCtx(), filename: "review-expectations.md",
    text: ["# Expected actions (hand-written, not Jev's answers)", "", "## Escalate to quality & safety", "", "- Scalded wrist", "", "## Hold for moderation", "", "- Phone repair ad", "",
      "## A person replies", "", "- Flat beans", "- Five stars, angry", "", "## Thank-you template", "", "- Warm welcome", "", "## No expectation", "", "- Example 6", ""].join("\n"),
    excludes: ["papery", "blister"] },

  // Words 16 + 24 + 19 + 14 + 14 + 1 = 88 over sentences 2 + 3 + 2 + 3 + 2 + 1 = 13 (counted by hand; "quickfix.example!" ends one sentence).
  words_per_sentence: [{ ctx: sampleReviewsExamplesCtx(), expect: (result) => { assert.ok(Math.abs(result.value - 88 / 13) < 1e-12); assert.equal(result.detail, "88 words in 13 sentences"); },
    empty: sampleReviewsExamplesCtx({ setup: null }) }, { ctx: only(5), expect: 1 },
  // "Phone repair ad": 14 words in 2 sentences; the dot inside quickfix.example does not end one.
  { ctx: only(4), expect: (result) => { assert.equal(result.value, 7); assert.equal(result.detail, "14 words in 2 sentences"); } }],
  // barista, months ago, takeaway, burrs, while you wait match; "Fine." does not.
  keyword_share: [{ ctx: sampleReviewsExamplesCtx(), expect: (result) => { assert.ok(Math.abs(result.value - 5 / 6) < 1e-12); assert.equal(result.detail, "5 of 6"); },
    empty: sampleReviewsExamplesCtx({ setup: null }) }, { ctx: only(5), expect: 0 }],
  // cafes, roasting, quality_safety, equipment_support and moderation out of eight teams.
  team_coverage: [{ ctx: sampleReviewsExamplesCtx(), expect: (result) => { assert.equal(result.value, 0.625); assert.equal(result.detail, "5 of 8"); },
    empty: sampleReviewsExamplesCtx({ setup: null }) }, { ctx: only(1, 2), expect: 0.25 }],
  // thank, reply, escalate, reply, moderate: four of the five expectations need a person; Example 6 has none.
  followup_share: [{ ctx: sampleReviewsExamplesCtx(), expect: (result) => { assert.equal(result.value, 0.8); assert.equal(result.detail, "4 of 5"); },
    empty: sampleReviewsExamplesCtx({ setup: null }) }, { ctx: only(0, 5), expect: 0 }],
}, { ctx: () => sampleReviewsExamplesCtx() });
