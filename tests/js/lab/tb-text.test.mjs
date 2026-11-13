// Tests for the tb-text pack. Expected values are counted by hand from the typed text (the comments show the counts);
// the readability scores apply the published Flesch formulas to those hand counts.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-text.js";
import { approx, checkPack, fakeCtx } from "./harness.mjs";

const exactly = (rows, table, text) => (result) => {
  assert.deepEqual(result.rows, rows);
  if (table !== undefined) assert.deepEqual(result.table, table);
  if (text !== undefined) assert.equal(result.text, text);
};

checkPack(pack, {
  // C a f e + combining acute (one character, two code points, 3 bytes for "é"), space, a flag of two regional
  // indicators (one character, 2 code points, 8 bytes), a line break, "ok": 9 characters, 11 code points, 18 bytes.
  text_size: {
    values: { text: "Café \u{1F1F3}\u{1F1FF}\nok" },
    expect: [["Characters", 9], ["Code points", 11], ["UTF-8 bytes", 18], ["Words", 3], ["Lines", 2]],
    more: [{ values: { text: "a b" }, expect: [["Characters", 3], ["Code points", 3], ["UTF-8 bytes", 3], ["Words", 2], ["Lines", 1]] }],
    invalid: [{ text: "" }],
  },
  // 3 + 3 + 4 = 10 words over 3 sentences.
  sentence_lengths: {
    values: { text: "Check the order. Is it late? Reply yes or no!" },
    expect: exactly([["Sentences", 3], ["Words", 10], ["Average words per sentence", 10 / 3], ["Longest sentence (words)", 4]],
      { columns: ["sentence", "words", "text"], rows: [[1, 3, "Check the order."], [2, 3, "Is it late?"], [3, 4, "Reply yes or no!"]] }),
    invalid: [{ text: "   " }],
  },
  // 9 words, 2 sentences, 10 syllables (every word 1 except hap-py). Then: make 1, the 1, ta-ble 2, with 1, cof-fee 2 =
  // 7 syllables in 5 words and 1 sentence; the dash is not a word.
  readability: {
    values: { text: "The cat sat on the mat. It was happy." },
    expect: [["Words", 9], ["Sentences", 2], ["Syllables (estimated)", 10], ["Words per sentence", 4.5], ["Syllables per word", 10 / 9],
      ["Flesch reading ease", 206.835 - 1.015 * 4.5 - 84.6 * 10 / 9], ["Flesch-Kincaid grade", 0.39 * 4.5 + 11.8 * 10 / 9 - 15.59]],
    more: [{ values: { text: "Make the table — with coffee." },
      expect: [["Words", 5], ["Sentences", 1], ["Syllables (estimated)", 7], ["Words per sentence", 5], ["Syllables per word", 1.4],
        ["Flesch reading ease", 83.32], ["Flesch-Kincaid grade", 2.88]] }],
    invalid: [{ text: "?! —" }],
  },
  // Lengths 5, 17, 0, 8: only line 2 is over 8.
  long_lines: {
    values: { text: "short\nthis line is long\n\nmid line", limit: 8 },
    expect: exactly([["Lines", 4], ["Longest line (characters)", 17], ["Lines over the limit", 1]], { columns: ["line", "characters"], rows: [[2, 17]] }),
    invalid: [{ text: "x", limit: 0 }],
  },
  // the 3, order 2, and 1, refund 2, now 1 (9 words, 5 distinct); ties keep first use: order before refund.
  repeated_words: {
    values: { text: "The order, the ORDER and the refund. Refund now.", least: 2 },
    expect: exactly([["Words", 9], ["Distinct words", 5], ["Words used 2 or more times", 3]], { columns: ["word", "times"], rows: [["the", 3], ["order", 2], ["refund", 2]] }),
    more: [{ values: { text: "The order, the ORDER and the refund. Refund now.", least: 3 },
      expect: exactly([["Words", 9], ["Distinct words", 5], ["Words used 3 or more times", 1]], { columns: ["word", "times"], rows: [["the", 3]] }) }],
    invalid: [{ text: "a a", least: 1 }],
  },
  // "the the" on line 1, "is is" on line 2, "So so" on line 3; "that, that" has a comma between and is left alone.
  doubled_words: {
    values: { text: "Check the the order.\nIt is is late, that, that is fine.\nSo so" },
    expect: exactly([["Doubled words", 3]], { columns: ["line", "words"], rows: [[1, "the the"], [2, "is is"], [3, "So so"]] }),
    more: [{ values: { text: "No repeats here, here." }, expect: exactly([["Doubled words", 0]], { columns: ["line", "words"], rows: [] }) }],
  },
  // A: refund, the, order, please; B: please, refund, now. Shared 2 of 5 distinct words.
  shared_words: {
    values: { a: "Refund the order, please.", b: "Please refund now" },
    expect: exactly([["Distinct words in A", 4], ["Distinct words in B", 3], ["Shared words", 2], ["Only in A", 2], ["Only in B", 1], ["Jaccard similarity", 0.4]],
      { columns: ["word", "in"], rows: [["refund", "both"], ["please", "both"], ["the", "A only"], ["order", "A only"], ["now", "B only"]] }),
    invalid: [{ a: "", b: " " }],
  },
  // "order late" → "Order later": substitute o→O and add r = 2 of 11. Ignoring case: 1 of 11, and all 10 characters
  // of A start B.
  edit_distance: {
    values: { a: "order late", b: "Order later" },
    expect: [["Edit distance (characters)", 2], ["Similarity", 9 / 11], ["Same start (characters)", 0], ["Same end (characters)", 0]],
    more: [{ values: { a: "order late", b: "Order later", ignoreCase: true }, expect: [["Edit distance (characters)", 1], ["Similarity", 10 / 11], ["Same start (characters)", 10], ["Same end (characters)", 0]] },
      { values: { a: "", b: "" }, expect: [["Edit distance (characters)", 0], ["Similarity", 1], ["Same start (characters)", 0], ["Same end (characters)", 0]] }],
  },
  // Four addresses, the first two the same ignoring case; .example, .test and example.com are reserved, .notreal is not.
  find_emails: {
    values: { text: "Write ana@harbor.example or Ana@Harbor.Example, cc bo@coffee.test, cy@mail.example.com and x@harbor.notreal." },
    expect: exactly([["Addresses found", 5], ["Distinct addresses", 4], ["Not on a reserved example domain", 1]],
      { columns: ["address", "times", "example domain"], rows: [["ana@harbor.example", 2, "yes"], ["bo@coffee.test", 1, "yes"], ["cy@mail.example.com", 1, "yes"], ["x@harbor.notreal", 1, "no"]] }),
    more: [{ values: { text: "no addresses" }, expect: exactly([["Addresses found", 0], ["Distinct addresses", 0], ["Not on a reserved example domain", 0]],
      { columns: ["address", "times", "example domain"], rows: [] }) }],
  },
  // The comma and the final period are not part of the links.
  find_links: {
    values: { text: "See https://harbor.example/menu, www.example.com/a and http://shop.notreal/x?y=1. Again https://harbor.example/menu" },
    expect: exactly([["Links found", 4], ["Distinct links", 3], ["Not on a reserved example domain", 1]],
      { columns: ["link", "times", "example domain"], rows: [["https://harbor.example/menu", 2, "yes"], ["www.example.com/a", 1, "yes"], ["http://shop.notreal/x?y=1", 1, "no"]] }),
  },
  // 1,234.50 → 1234.5; the date gives 2024, 5, 1 (no minus signs); item-2 → 2; " -3" → −3; ".5" → 0.5. Sum 3264.
  find_numbers: {
    values: { text: "Paid 1,234.50 on 2024-05-01 for item-2, refund -3 and .5" },
    expect: exactly([["Numbers found", 7], ["Sum", 3264], ["Smallest", -3], ["Largest", 2024]],
      { columns: ["#", "number"], rows: [[1, 1234.5], [2, 2024], [3, 5], [4, 1], [5, 2], [6, -3], [7, 0.5]] }),
    more: [{ values: { text: "no digits" }, expect: exactly([["Numbers found", 0], ["Sum", null], ["Smallest", null], ["Largest", null]], { columns: ["#", "number"], rows: [] }) }],
  },
  // 2023-02-29 is not a real date. 2024 is a leap year: 28 Feb → 1 Mar is 2 days.
  find_dates: {
    values: { text: "Ordered 2024-02-28, shipped 2024-03-01, again 2024-02-28; bad 2023-02-29." },
    expect: exactly([["Dates found", 3], ["Distinct dates", 2], ["Earliest", "2024-02-28"], ["Latest", "2024-03-01"], ["Days from earliest to latest", 2]],
      { columns: ["date", "times"], rows: [["2024-02-28", 2], ["2024-03-01", 1]] }),
    more: [{ values: { text: "2023-12-31 to 2024-12-31" }, expect: (result) => approx(result.rows[4][1], 366) }],
  },
  // The date and the long decimal are not phone numbers.
  find_phones: {
    values: { text: "Call +1 (555) 010-0199 or 555-0100; order 2024-05-01, total 3.1415926, again 555-0100" },
    expect: exactly([["Phone numbers found", 3], ["Distinct phone numbers", 2]], { columns: ["phone number", "times"], rows: [["+1 (555) 010-0199", 1], ["555-0100", 2]] }),
  },
  // name twice in two styles, order_id, city and ORDER ID once each: 5 placeholders, 4 names, four styles.
  find_placeholders: {
    values: { text: "Hi {name}, your order {{ order_id }} ships to <city>. {{name}} [ORDER ID]" },
    expect: exactly([["Placeholders found", 5], ["Distinct names", 4], ["Styles used", "{name}, {{name}}, <name>, [NAME]"]],
      { columns: ["name", "written as", "times"], rows: [["name", "{name}, {{name}}", 2], ["order_id", "{{ order_id }}", 1], ["city", "<city>", 1], ["ORDER ID", "[ORDER ID]", 1]] }),
    more: [{ values: { text: "{\"a\": 1} and [see below]" }, expect: exactly([["Placeholders found", 0], ["Distinct names", 0], ["Styles used", "none"]], { columns: ["name", "written as", "times"], rows: [] }) }],
  },
  // {name} twice and {{order_id}} once are filled; <status> has no value; "unused" is never asked for.
  fill_placeholders: {
    values: { text: "Dear {name}, order {{order_id}} for {name} is <status>.", values: "name = Ana Ruiz\norder_id: HC-1042\n# note\nunused = x=y" },
    expect: exactly([["Placeholders filled", 3], ["Placeholders left", 1], ["Names without a value", "status"], ["Values not used", "unused"]], undefined,
      "Dear Ana Ruiz, order HC-1042 for Ana Ruiz is <status>."),
    invalid: [{ text: "{a}", values: "just text" }, { text: "{a}", values: "a = 1\na = 2" }, { text: "{a}", values: "" }],
  },
  question_id: {
    values: { text: "Is the order late?", taken: "is_the_order_late\nis_the_order_late_2" },
    expect: [["snake_case", "is_the_order_late"], ["camelCase", "isTheOrderLate"], ["kebab-case", "is-the-order-late"], ["ASCII slug", "is_the_order_late"],
      ["Title Case label", "Is The Order Late"], ["Plain identifier (letters, digits, underscores)", "yes"], ["Unique snake_case id", "is_the_order_late_3"]],
    // Accents stay in the case forms and leave the slug; a leading digit is not a plain identifier.
    more: [{ values: { text: "2nd Crème check" },
      expect: [["snake_case", "2nd_crème_check"], ["camelCase", "2ndCrèmeCheck"], ["kebab-case", "2nd-crème-check"], ["ASCII slug", "2nd_creme_check"],
        ["Title Case label", "2nd Crème Check"], ["Plain identifier (letters, digits, underscores)", "no"], ["Unique snake_case id", "2nd_crème_check"]] }],
    invalid: [{ text: "?!" }],
  },
  // Width 12 with a two-space indent: "  one two" (9), "  three four" (12), "  five six"; the 20-letter word stays whole.
  wrap_lines: {
    values: { text: "  one two three four five six\nshort\n\nsupercalifragilistic word", width: 12 },
    expect: exactly([["Lines before", 4], ["Lines after", 7]], undefined, "  one two\n  three four\n  five six\nshort\n\nsupercalifragilistic\nword"),
    invalid: [{ text: "a", width: 5 }],
  },
  unwrap_lines: {
    values: { text: "First line\nsecond line.\n\n\nNext   para\n  here." },
    expect: exactly([["Lines before", 6], ["Paragraphs", 2]], undefined, "First line\nsecond line.".replace("\n", " ") + "\n\nNext   para here."),
  },
  // NUL, BEL and NEL (U+0085) are control characters; the tab stays; the zero-width space goes only when asked.
  strip_control: {
    values: { text: "a\u0000b\u0007c\td​e\u0085" },
    expect: exactly([["Control characters removed", 3], ["Invisible characters removed", 0]], undefined, "abc\td​e"),
    more: [{ values: { text: "a\u0000b\u0007c\td​e\u0085", invisible: true }, expect: exactly([["Control characters removed", 3], ["Invisible characters removed", 1]], undefined, "abc\tde") }],
  },
  // Quotes “ ” ’ (3), dashes — and − (2), two no-break spaces; the ellipsis stays unless asked.
  normalize_punctuation: {
    values: { text: "“Hi” — it’s 5 − 2…" },
    expect: exactly([["Quotes straightened", 3], ["Dashes replaced", 2], ["Spaces replaced", 2], ["Ellipses expanded", 0]], undefined, "\"Hi\" - it's 5 - 2…"),
    more: [{ values: { text: "“Hi” — it’s 5 − 2…", quotes: false, ellipsis: true },
      expect: exactly([["Quotes straightened", 0], ["Dashes replaced", 2], ["Spaces replaced", 2], ["Ellipses expanded", 1]], undefined, "“Hi” - it’s 5 - 2...") }],
  },
  // Case-sensitive: "translate", "late." and "late?" (not Late or LATE). Whole words ignoring case: Late, late, late, LATE.
  count_phrase: {
    values: { text: "Late order. The translate tool said late.\nNot late? LATE", phrase: "late" },
    expect: [["Occurrences", 3], ["Lines with the phrase", 2], ["First line", 1]],
    more: [{ values: { text: "Late order. The translate tool said late.\nNot late? LATE", phrase: "late", ignoreCase: true, whole: true }, expect: [["Occurrences", 4], ["Lines with the phrase", 2], ["First line", 1]] },
      { values: { text: "Late order. The translate tool said late.\nNot late? LATE", phrase: "late", whole: true }, expect: [["Occurrences", 2], ["Lines with the phrase", 2], ["First line", 1]] },
      { values: { text: "Late order.\nrefund later", phrase: "refund (" }, expect: [["Occurrences", 0], ["Lines with the phrase", 0], ["First line", null]] }],
    invalid: [{ text: "abc", phrase: "" }],
  },
  // one kept, two → 2 replaced, three kept, four added.
  line_diff: {
    values: { a: "one\ntwo\nthree", b: "one\n2\nthree\nfour" },
    expect: exactly([["Unchanged lines", 2], ["Removed lines", 1], ["Added lines", 2]], undefined, "  one\n- two\n+ 2\n  three\n+ four"),
    more: [{ values: { a: "x  \ny", b: "x\ny", trimEnds: true }, expect: exactly([["Unchanged lines", 2], ["Removed lines", 0], ["Added lines", 0]], undefined, "  x\n  y") },
      { values: { a: "x  \ny", b: "x\ny" }, expect: exactly([["Unchanged lines", 1], ["Removed lines", 1], ["Added lines", 1]], undefined, "- x  \n+ x\n  y") }],
  },
  // Lines: "", "  keep  indent  ", "x\t\ty", "", "", "", "end   ", "". Two lines end in spaces, two inner runs, one leading
  // blank + two extra blanks + one trailing blank removed, two CRLF breaks.
  tidy_whitespace: {
    values: { text: "\r\n  keep  indent  \r\nx\t\ty\n\n\n\nend   \n\n" },
    expect: exactly([["Lines with spaces at the end", 2], ["Runs of spaces collapsed", 2], ["Blank lines removed", 4], ["Line breaks changed to LF", 2]], undefined,
      "  keep indent\nx y\n\nend"),
  },
  unusual_characters: {
    values: { text: "Café menu​ é\u0007" },
    expect: exactly([["Distinct unusual characters", 4], ["Control or invisible (times)", 3], ["Other non-ASCII (times)", 2]],
      { columns: ["character", "code point", "times", "kind"], rows: [["é", "U+00E9", 2, "non-ASCII"], ["no-break space", "U+00A0", 1, "invisible or special space"],
        ["zero-width space", "U+200B", 1, "invisible or special space"], ["(not shown)", "U+0007", 1, "control"]] }),
    more: [{ values: { text: "plain\tASCII\n" }, expect: exactly([["Distinct unusual characters", 0], ["Control or invisible (times)", 0], ["Other non-ASCII (times)", 0]],
      { columns: ["character", "code point", "times", "kind"], rows: [] }) }],
  },
  // 13 code points to 8: 7 kept + "…". In bytes, "café crème" is 12; 8 bytes leaves 5 before the 3-byte "…" ("café").
  shorten_text: {
    values: { text: "Harbor coffee", max: 8 },
    expect: exactly([["Length before", 13], ["Length after", 8], ["Cut", "yes"]], undefined, "Harbor …"),
    more: [{ values: { text: "café crème", max: 8, unit: "bytes" }, expect: exactly([["Length before", 12], ["Length after", 8], ["Cut", "yes"]], undefined, "café…") },
      { values: { text: "café crème", max: 4, unit: "bytes", ellipsis: false }, expect: exactly([["Length before", 12], ["Length after", 3], ["Cut", "yes"]], undefined, "caf") },
      { values: { text: "café crème", max: 2, unit: "bytes" }, expect: exactly([["Length before", 12], ["Length after", 2], ["Cut", "yes"]], undefined, "ca") },
      { values: { text: "Harbor", max: 200 }, expect: exactly([["Length before", 6], ["Length after", 6], ["Cut", "no"]], undefined, "Harbor") }],
    invalid: [{ text: "abc", max: 0 }],
  },
  // 6 lines; one blank; ignoring case "item 2" repeats "Item 2" and the second "item 10" repeats the first. Natural order
  // puts Item 2 before item 10.
  sort_lines: {
    values: { text: "item 10\nItem 2\n\nitem 2\nbanana\nitem 10", order: "asc", ignoreCase: true },
    expect: exactly([["Lines before", 6], ["Lines after", 3], ["Repeated lines removed", 2], ["Blank lines removed", 1]], undefined, "banana\nItem 2\nitem 10"),
    more: [{ values: { text: "item 10\nItem 2\n\nitem 2\nbanana\nitem 10", order: "desc" },
      expect: exactly([["Lines before", 6], ["Lines after", 4], ["Repeated lines removed", 1], ["Blank lines removed", 1]], undefined, "item 10\nitem 2\nItem 2\nbanana") }],
    invalid: [{ text: "a", order: "random" }],
  },
}, { ctx: () => fakeCtx({}) });
