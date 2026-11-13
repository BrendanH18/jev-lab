import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/find/find-document-more.js";
import { checkPack } from "./harness.mjs";
import { DOCS, linesByIndex, sampleFindDocumentCtx } from "./fixtures/find.mjs";

// The short handbook (tests/js/lab/fixtures/find.mjs): L000 title; Section A = L001–L003, B = L004–L006, C = L007–L008,
// D = L009–L010, E = L011–L012. The search shown with it focuses question 1, whose top line is L010 (Section D).
const ctx = (overrides) => sampleFindDocumentCtx(overrides);
const D = linesByIndex(ctx());
const itemsOf = (text) => ctx({ text, result: null }).items();
const empty = () => ctx({ text: "", result: null });
// Lines of another text, with ids prefixed by X so they cannot be mistaken for the handbook's lines in one list.
const xItems = (text) => itemsOf(text).map((item) => ({ ...item, id: `X${item.id}` }));
// A small document: one line above the first heading, two lines in Section A, an empty Section B.
const SMALL = "Intro line here.\nSection A: Hours\nOpen at 6:30 am.\nClosed Sunday.\nSection B: Pay";
const MENTIONS = "Shift meals are $6.50 off on 4/15.\nSee https://harborcoffee.example/menu before 14:00.";

checkPack(pack, {
  // "Co." does not end the title's sentence; "Dr." does not end "Dr. Lee signs off."
  sentences: { items: [D[0], { text: "Payday is every other Friday. Bring ID! Questions?" }, { text: "Dr. Lee signs off. Thanks." }, { text: "" }],
    values: [1, 3, 2, null] },
  // Section A holds L002 and L003, Section C only L008; L000 is above the first heading.
  section_size: { ctx: ctx(), items: [D[1], D[8], D[0], D[5]], values: [2, 1, null, 2] },
  // "Section D: Pets" = (7 + 1 + 4) / 3; "Payday is every other Friday by direct deposit." = (6+2+5+5+6+2+6+7) / 8;
  // "Open at 6:30 am." = (4 + 2 + 3 + 2) / 4, the colon inside 6:30 left out.
  word_length: { items: [D[9], D[5], { text: "Open at 6:30 am." }, { text: "— …" }], values: [4, 4.875, 2.75, null] },
  has_time: { items: [D[2], D[5], { text: "Doors open at 14:00." }, { text: "Batch 12 took 14 minutes." }], values: [true, false, true, false] },
  has_amount: { items: [{ text: "Shift meals are $6.50 off." }, D[12], { text: "Tips are pooled up to 40 dollars a day." }, D[2]], values: [true, false, true, false] },
  // L010 says "pets may wait": "may" is not the month May.
  has_date: { items: [D[2], D[6], D[0], D[10], { text: "Inventory is due May 31." }, { text: "Count stock on 2026-11-02." }, { text: "Order by 4/15." }],
    values: [true, false, true, false, true, true, true] },
  has_phone: { items: [D[12], D[2]], values: [true, false] },
  has_url: { items: [{ text: "See https://harborcoffee.example/menu." }, D[12]], values: [true, false] },
  // L006 "need", L010 "may"; L002 and L008 ("Please give …") state no rule word.
  // "due May 31" names the month, not permission; "May I swap shifts?" asks permission.
  has_modal: { items: [D[6], D[10], D[2], D[8], { text: "Inventory is due May 31." }, { text: "May I swap shifts?" }],
    values: [true, true, false, false, false, true] },

  heading_order: { hitList: itemsOf("Section A: Hours\nOpen at 6:30 am.\nSection C: Pets\nSection B: Pay\nSection A: Again"),
    missList: Object.values(D), message: /^L00[234] (is Section [CB] after Section [AC]; expected Section [BD]|repeats Section A \(first on L000\))\.$/ },
  unrecognized_heading: { hit: [{ text: "Section 3: Pay" }, { text: "section b: pay" }, { text: "## Pay and time off" }, { text: "SECTION F - Uniforms" }],
    miss: [D[1], { text: "Sections of the walk-in are labeled." }, { text: "Section B covers pay." }, D[2]], message: /looks like a heading/ },
  starts_lowercase: { hit: { text: "espresso and set up the pastry case," }, miss: [D[2], D[1], { text: "6 am opening checklist" }], message: /lowercase letter/ },
  all_caps: { hit: { text: "NO PETS BEHIND THE COUNTER." }, miss: [D[1], { text: "OK" }, { text: "Call 555-0142." }], message: /^Written in capitals/ },
  // L006 "…need two weeks notice." and L008 "…at least two weeks notice when…" share one phrase; the two X lines share
  // "open at six every day of the week", reported as one run. "is on the" alone is too plain to count.
  repeated_phrase: { hitList: [...Object.values(D), ...xItems("We open at six every day of the week.\nStaff open at six every day of the week too.")],
    missList: [...itemsOf(DOCS.plain), ...xItems("Milk is on the left.\nSyrup is on the top.")],
    message: /^“(two weeks notice” is on L006, L008|open at six every day of the week” is on XL000, XL001)\. / },

  // 101 words over the 13 lines (counted line by line: 8 5 12 9 6 8 8 5 10 3 14 3 10); SMALL: 3 + 3 + 4 + 2 + 3.
  total_words: [{ ctx: ctx(), expect: 101, empty: empty() }, { ctx: ctx({ text: SMALL, result: null }), expect: 15 }],
  // Handbook sections hold 2, 2, 1, 1, 1 lines; SMALL's two sections 2 and 0; DOCS.plain has no heading.
  median_section_lines: [{ ctx: ctx(), expect: 1, empty: empty() }, { ctx: ctx({ text: SMALL, result: null }), expect: 1 },
    { ctx: ctx({ text: "Section A: a\nx1\nx2\nx3\nSection B: b\ny1", result: null }), expect: 2 }, { ctx: ctx({ text: DOCS.plain, result: null }), expect: null }],
  // 101 - 22 heading words = 79 words in eight one-sentence lines; then 8 words in three sentences.
  words_per_sentence: [{ ctx: ctx(), expect: 79 / 8, tolerance: 1e-12, empty: empty() },
    { ctx: ctx({ text: "Open at 6:30. Close at 6:00! Bring ID.", result: null }), expect: 8 / 3, tolerance: 1e-12 }],
  // The short handbook's raw text keeps one blank line; "a\n\n  \nb\n" has two (the final break adds none).
  blank_lines: [{ ctx: ctx(), expect: 1, empty: empty() }, { ctx: ctx({ text: "a\n\n  \nb\n", result: null }), expect: 2 }],

  // A backslash before a digit is no Markdown escape, so a numbered line escapes its dot; "---" would be a rule.
  markdown: { ctx: ctx({ text: "Intro line here.\nSection A: Hours\n- not a bullet\n1. not a list\n---\n# not a title\nOpen at 6:30 am.", result: null }),
    filename: "find-document.md",
    text: "Intro line here.\n\n## Section A: Hours\n\n\\- not a bullet\n\n1\\. not a list\n\n\\---\n\n\\# not a title\n\nOpen at 6:30 am.\n" },
  // "Open at 6:30 am." is 4 words and 16 characters, "Closed Sunday." 2 and 14; "Intro line here." 3 and 16.
  section_stats: { ctx: ctx({ text: SMALL, result: null }), filename: "find-section-stats.csv",
    text: '"section","heading line","lines","words","characters"\r\n"(before the first section)","","1","3","16"\r\n'
      + '"Section A: Hours","L001","2","6","30"\r\n"Section B: Pay","L004","0","0","0"\r\n' },
  mentions: { ctx: ctx({ text: MENTIONS, result: null }), filename: "find-mentions.csv",
    text: '"line","kind","mention"\r\n"L000","amount","$6.50"\r\n"L000","date","4/15"\r\n"L001","time","14:00"\r\n'
      + '"L001","web address","https://harborcoffee.example/menu"\r\n',
    check: () => {
      const handbook = pack.features.find((feature) => feature.id === "mentions").build(ctx({ hide: [0, 3, 5] }));
      assert.equal(handbook, '"line","kind","mention"\r\n"L002","time","6:30 am"\r\n"L002","time","6:00 pm"\r\n"L002","date","Monday"\r\n'
        + '"L002","date","Saturday"\r\n"L012","phone","555-0142"\r\n"L012","email","people@harborcoffee.example"\r\n');
    } },
  // DOCS.long has 260 lines; L255–L259 are batches 255–259 (minutes 12 + index mod 7; odd batches the morning crew).
  unsearched: { ctx: ctx({ text: DOCS.long, result: null }), filename: "find-unsearched-lines.txt",
    text: "L255| Batch 255: Harbor House Blend, 15 minutes, roasted by the morning crew.\n"
      + "L256| Batch 256: Harbor House Blend, 16 minutes, roasted by the evening crew.\n"
      + "L257| Batch 257: Harbor House Blend, 17 minutes, roasted by the morning crew.\n"
      + "L258| Batch 258: Harbor House Blend, 18 minutes, roasted by the evening crew.\n"
      + "L259| Batch 259: Harbor House Blend, 12 minutes, roasted by the morning crew.\n",
    check: () => assert.equal(pack.features.find((feature) => feature.id === "unsearched").build(ctx()), "") },

  // Question 1's top line L010 sits in Section D, whose heading is L009.
  focused_section: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["showLine", 9]]), hidden: () => ctx({ result: null }) },
  // L012 is 81 characters, L010 80, every other line shorter.
  longest_line: { ctx: () => ctx(), check: (c) => {
    assert.deepEqual(c.log, [["showLine", 12]]);
    const without = ctx({ hide: [12] });
    pack.features.find((feature) => feature.id === "longest_line").run(without);
    assert.deepEqual(without.log, [["showLine", 10]]);
  }, hidden: () => ctx({ editing: true }) },
}, { ctx: () => ctx() });

const feature = (id) => pack.features.find((entry) => entry.id === id);

test("find-document-more: section_size keeps two headings with the same text apart", () => {
  // The first "Section A: Hours" holds two lines, the repeated one holds one.
  const twice = ctx({ text: "Section A: Hours\nOpen at 6:30 am.\nClosed Sunday.\nSection A: Hours\nOpen late Fridays.", result: null });
  assert.deepEqual(twice.items().map((item) => feature("section_size").value(item, twice)), [2, 2, 2, 1, 1]);
});

test("find-document-more: repeated_phrase reports every shared run exactly once", () => {
  const two = [...Object.values(D), ...xItems("We open at six every day of the week.\nStaff open at six every day of the week too.")];
  assert.deepEqual(feature("repeated_phrase").check(two, ctx()), [
    "“two weeks notice” is on L006, L008. Lines that share wording compete for the same questions.",
    "“open at six every day of the week” is on XL000, XL001. Lines that share wording compete for the same questions.",
  ]);
  // "at 6:30 am" has only digits and two-letter words besides "6:30", so it is too plain to report.
  assert.deepEqual(feature("repeated_phrase").check(xItems("Doors open at 6:30 am daily.\nPrep starts at 6:30 am sharp."), ctx()), []);
});
