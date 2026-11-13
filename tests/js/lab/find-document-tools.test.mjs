import pack from "../../../static/js/lab/packs/find/find-document-tools.js";
import { checkPack } from "./harness.mjs";
import { DOCS, linesByIndex, sampleFindDocumentCtx } from "./fixtures/find.mjs";

const ctx = (overrides) => sampleFindDocumentCtx(overrides);
const D = linesByIndex(ctx());   // the short handbook, with the four-question search (question 1 focused)
const itemsOf = (text) => ctx({ text, result: null }).items();
const line = (index, text, heading, section) => ({ index, id: `L${String(index).padStart(3, "0")}`, text, heading, section, searched: true });
const empty = () => ctx({ text: "", result: null });
const TWO = "Section A: Hours\nPayday is Friday.";  // 16 + 1 + 17 = 34 characters

const EMPTY_SECTIONS = "Section A: Hours\nSection B: Pay\nPayday is Friday.\nSection C: Leaving";
const E = itemsOf(EMPTY_SECTIONS);
const SPLIT = "Harbor Coffee Co. Team Handbook, revised September 2026.\nSection A: Hours. Notes\n"
  + "We open at 6 a.m. daily. Close at 6:00 pm! Ask? yes, always.\nSchedules are posted Thursday.\nHidden line one. Hidden line two.";
const A = "Section A: Hours. Notes";
const BARE = {};

checkPack(pack, {
  // Word counts by hand (and by Python's str.split): 8, 5, 3 and 14.
  words: { items: [D[0], D[1], D[9], D[10], { index: 40, text: "" }, BARE], values: [8, 5, 3, 14, null, null] },
  // "Section A: Hours and scheduling" is 31 characters; "Café ☕" is 6 code points (the cup is one).
  chars: { items: [D[9], D[1], { index: 40, text: "Café ☕" }, { index: 41, text: "" }, BARE], values: [15, 31, 6, null, null] },
  // The dog question: L010 71%, L009 20%, L003 0%, and L000 is missing from the response.
  focused_p: { ctx: ctx(), items: [D[10], D[9], D[3], D[0], BARE], values: [0.71, 0.2, 0, null, null] },
  // L000: max(-, .005, .10, .16); L006: max(0, .30, .41, 0); L010: .71; L007: .03; line 40 has no probabilities.
  best_p: { ctx: ctx(), items: [D[0], D[6], D[10], D[7], { index: 40, text: "x" }, BARE], values: [0.16, 0.41, 0.71, 0.03, null, null] },
  section: { items: [D[0], D[2], D[5], D[1], BARE], values: ["no section", "Section A: Hours and scheduling", "Section B: Pay and time off", "Section A: Hours and scheduling", null] },
  heading: { items: [D[1], D[2], BARE], values: [true, false, false] },
  has_number: { items: [D[2], D[1], D[12], BARE], values: [true, false, true, false] },
  has_email: { items: [D[12], D[0], { text: "Write to the roastery @ the dock" }], values: [true, false, false] },
  // Top lines of the four questions: L010, L008, L006, L012. L009 is only second; with no search nothing is a top line.
  top_hit: { ctx: ctx(), items: [D[10], D[8], D[9], D[0], D[6], D[12]], values: [true, true, false, false, true, true] },
  line_text: { items: [D[1], D[9], BARE], values: ["Section A: Hours and scheduling", "Section D: Pets", ""] },

  // "We roast " is 9 characters; 40 of them less the last space is 359. 300 exactly is not too long.
  long_line: { hit: { text: "We roast ".repeat(40).trim() }, miss: [D[0], D[12], { text: "x".repeat(300) }, BARE], message: /^359 characters/ },
  wrapped_line: { hit: [{ text: "Baristas arrive 15 minutes before the doors open to dial in" }, { text: "Bring your apron," }, { text: "Mind the steam wand;" }],
    miss: [D[1], D[2], D[12], { text: "Things to bring:" }, { text: "Section A: hours and scheduling" }, BARE], message: /Join it with the next line/ },
  duplicate_lines: { hitList: [D[2], { index: 13, id: "L013", text: "the cafe is open 6:30 am to 6:00 pm  Monday through Saturday." }],
    missList: [...Object.values(D), BARE], message: /^“The cafe is open 6:30 am to 6:00 pm Monday through Saturday\.” appears on L002, L013\./ },
  // Section A is followed straight by Section B, and Section C is the last line of the document. The list holds only
  // L000, L002 and L003 (a filter hides Section B): the check reads the whole document, so Section A is still found.
  empty_section: { ctx: ctx({ text: EMPTY_SECTIONS, result: null }), hitList: [E[0], E[2], E[3]],
    missList: Object.values(D), missCtx: ctx(), message: /^L00[03] “Section [AC]: \w+” has no lines under it\.$/ },

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
  // "Co." and "a.m." do not end a sentence, "yes, always." starts in lower case so it stays with "Ask?", the heading is
  // left alone, and the last line is not shown, so it stays whole. Everything after the split is renumbered.
  split_sentences: { input: itemsOf(SPLIT), shown: [0, 1, 2, 3], unchanged: Object.values(D),
    output: [line(0, "Harbor Coffee Co. Team Handbook, revised September 2026.", false, null), line(1, A, true, A),
      line(2, "We open at 6 a.m. daily.", false, A), line(3, "Close at 6:00 pm!", false, A), line(4, "Ask? yes, always.", false, A),
      line(5, "Schedules are posted Thursday.", false, A), line(6, "Hidden line one. Hidden line two.", false, A)] },

  // 34 characters ("Section A: Hours" 16 + newline + "Payday is Friday." 17); the short handbook's raw text is 620
  // code points (Python len of the same text, blank and indented line kept); 60,010 is 10 over.
  chars_left: [{ ctx: ctx({ text: TWO, result: null }), expect: 59966, empty: empty() }, { ctx: ctx(), expect: 59380 },
    { ctx: ctx({ text: "x".repeat(60010), result: null }), expect: -10 }],

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
}, { ctx: () => ctx() });
