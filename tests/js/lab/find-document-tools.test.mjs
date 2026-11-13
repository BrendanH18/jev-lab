import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/find/find-document-tools.js";
import { checkPack } from "./harness.mjs";
import { DOCS, linesByIndex, sampleFindDocumentCtx } from "./fixtures/find.mjs";

const ctx = (overrides) => sampleFindDocumentCtx(overrides);
const D = linesByIndex(ctx());   // the short handbook, with the four-question search (question 1 focused)
const itemsOf = (text) => ctx({ text, result: null }).items();
const line = (index, text, heading, section) => ({ index, id: `L${String(index).padStart(3, "0")}`, text, heading, section, searched: true });
const empty = () => ctx({ text: "", result: null });
const TWO = "Section A: Hours\nPayday is Friday.";  // 16 + 1 + 17 = 34 characters

checkPack(pack, {
  words: { items: [D[0], D[1], D[9], { index: 40, text: "" }], values: [8, 5, 3, null] },
  // "Section A: Hours and scheduling" is 31 characters; "Café ☕" is 6 code points.
  chars: { items: [D[9], D[1], { index: 40, text: "Café ☕" }, { index: 41, text: "" }], values: [15, 31, 6, null] },
  // The dog question: L010 71%, L009 20%, L003 0%, and L000 is missing from the response.
  focused_p: { ctx: ctx(), items: [D[10], D[9], D[3], D[0]], values: [0.71, 0.2, 0, null] },
  // L000: max(-, .005, .10, .16); L006: max(0, .30, .41, 0); L010: .71; L007: .03; line 40 has no probabilities.
  best_p: { ctx: ctx(), items: [D[0], D[6], D[10], D[7], { index: 40, text: "x" }], values: [0.16, 0.41, 0.71, 0.03, null] },
  section: { items: [D[0], D[2], D[5], D[1]], values: ["no section", "Section A: Hours and scheduling", "Section B: Pay and time off", "Section A: Hours and scheduling"] },
  heading: { items: [D[1], D[2]], values: [true, false] },
  has_number: { items: [D[2], D[1], D[12]], values: [true, false, true] },
  has_email: { items: [D[12], D[0]], values: [true, false] },
  // Top lines of the four questions: L010, L008, L006, L012.
  top_hit: { ctx: ctx(), items: [D[10], D[8], D[9], D[0]], values: [true, true, false, false] },
  line_text: { items: [D[1], D[9]], values: ["Section A: Hours and scheduling", "Section D: Pets"] },

  // "We roast " is 9 characters; 40 of them less the last space is 359.
  long_line: { hit: { text: "We roast ".repeat(40).trim() }, miss: [D[0], D[12]], message: /^359 characters/ },
  wrapped_line: { hit: [{ text: "Baristas arrive 15 minutes before the doors open to dial in" }, { text: "Bring your apron," }],
    miss: [D[1], D[2], D[12], { text: "Things to bring:" }], message: /Join it with the next line/ },
  duplicate_lines: { hitList: [D[2], { index: 13, id: "L013", text: "the cafe is open 6:30 am to 6:00 pm  Monday through Saturday." }],
    missList: Object.values(D), message: /appears on L002, L013\./ },
  // Section A is followed straight by Section B, and Section C is the last line of the document.
  empty_section: { ctx: ctx({ text: "Section A: Hours\nSection B: Pay\nPayday is Friday.\nSection C: Leaving", result: null }),
    hitList: itemsOf("Section A: Hours\nSection B: Pay\nPayday is Friday.\nSection C: Leaving"), missList: Object.values(D), message: /^L00[03] “Section [AC]: \w+” has no lines under it\.$/ },

  collapse_spaces: { input: itemsOf(DOCS.plain), unchanged: Object.values(D),
    output: [line(0, "Grinders are cleaned every night.", false, null), line(1, "We say “good morning” to every regular.", false, null),
      line(2, "Refunds go through the register.", false, null)] },
  straight_quotes: { input: itemsOf(DOCS.plain), unchanged: Object.values(D),
    output: [line(0, "Grinders are cleaned every night.", false, null), line(1, 'We say "good morning" to every regular.', false, null),
      line(2, "Refunds  go  through the register.", false, null)] },
  // The second and third copies go (case and spacing ignored); everything after them is renumbered.
  remove_duplicates: { input: itemsOf("Section A: Hours\nThe cafe opens at 6:30 am.\nthe cafe opens at  6:30 am.\nSection B: Pay\nThe cafe opens at 6:30 am."),
    unchanged: Object.values(D),
    output: [line(0, "Section A: Hours", true, "Section A: Hours"), line(1, "The cafe opens at 6:30 am.", false, "Section A: Hours"), line(2, "Section B: Pay", true, "Section B: Pay")] },
  // Three wrapped lines become one; "Bring your apron;" is followed by a heading, so it stays.
  join_wrapped: { input: itemsOf("Baristas arrive 15 minutes before the doors open to dial in\nespresso and set up the pastry case,\nwhich opens at 6:30 am.\nSection A: Hours\nBring your apron;\nSection B: Pay"),
    unchanged: Object.values(D),
    output: [line(0, "Baristas arrive 15 minutes before the doors open to dial in espresso and set up the pastry case, which opens at 6:30 am.", false, null),
      line(1, "Section A: Hours", true, "Section A: Hours"), line(2, "Bring your apron;", false, "Section A: Hours"), line(3, "Section B: Pay", true, "Section B: Pay")] },

  sections: [{ ctx: ctx(), expect: 5, empty: empty() }, { ctx: ctx({ text: "Section A: Hours\nSection B: Pay\nPayday is Friday.\nSection C: Leaving", result: null }), expect: 3 }],
  // 101 words over 13 lines; the five headings alone: (5 + 6 + 5 + 3 + 3) / 5.
  mean_words: [{ ctx: ctx(), expect: 101 / 13, tolerance: 1e-12, empty: empty() }, { ctx: ctx({ hide: [0, 2, 3, 5, 6, 8, 10, 12] }), expect: 4.4, tolerance: 1e-12 }],
  chars_left: [{ ctx: ctx({ text: TWO, result: null }), expect: 59966, empty: empty() }, { ctx: ctx({ text: "x".repeat(60010), result: null }), expect: -10 }],
  top_lines: [{ ctx: ctx(), expect: 4, empty: ctx({ result: null }) }, { ctx: ctx({ hide: [10] }), expect: 3 }],

  tagged: { ctx: ctx({ text: "Section A: Hours\n\n  Payday is Friday.  ", result: null }), filename: "find-document-tagged.txt",
    text: "L000| Section A: Hours\nL001| Payday is Friday." },
  outline: { ctx: ctx({ hide: [0, 1, 2] }), filename: "find-outline.md",
    text: "- (before the first section): L000, 1 line\n- Section A: Hours and scheduling: L001–L003, 2 lines\n- Section B: Pay and time off: L004–L006, 2 lines\n"
      + "- Section C: Leaving Harbor Coffee: L007–L008, 1 line\n- Section D: Pets: L009–L010, 1 line\n- Section E: Contact: L011–L012, 1 line\n" },
  shown_csv: { ctx: ctx({ matches: (item) => [0, 1, 12].includes(item.index) }), filename: "find-lines.csv",
    text: '"id","section","text"\r\n"L000","","Harbor Coffee Co. Team Handbook, revised September 2026."\r\n'
      + '"L001","Section A: Hours and scheduling","Section A: Hours and scheduling"\r\n'
      + '"L012","Section E: Contact","Questions about this handbook go to people@harborcoffee.example or call 555-0142."\r\n' },

  plain_lines: { text: "  Roasting starts at 5:00 am.\r\n\r\nDecaf is roasted on Tuesdays.\n",
    items: [{ text: "Roasting starts at 5:00 am." }, { text: "Decaf is roasted on Tuesdays." }], warnings: 0, rejects: ["", "  \n \n"] },
  bullets: { text: "Holiday hours:\n- Thanksgiving: closed\n* Christmas Eve: open until 2:00 pm\n2. New Year's Day: closed\n",
    items: [{ text: "Thanksgiving: closed" }, { text: "Christmas Eve: open until 2:00 pm" }, { text: "New Year's Day: closed" }], warnings: 1,
    rejects: ["Holiday hours:\nNo list here."] },

  first_line: { ctx: () => ctx({ order: [12, 0] }), check: (c) => assert.deepEqual(c.log, [["showLine", 12]]), hidden: () => ctx({ editing: true }) },
  last_line: { ctx: () => ctx({ hide: [12] }), check: (c) => assert.deepEqual(c.log, [["showLine", 11]]), hidden: () => empty() },
}, { ctx: () => ctx() });
