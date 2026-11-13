// Tests for the tb-patterns pack. Expected values are worked out by hand from the typed text (comments show the
// reasoning); the number-range patterns are checked by brute force against every number up to 2,000.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tb-patterns.js";
import { checkPack } from "./harness.mjs";

// Rows, table and text exactly; undefined skips a part, null requires its absence.
const exactly = (rows, table, text) => (result) => {
  assert.deepEqual(result.rows, rows);
  if (table !== undefined) assert.deepEqual(result.table, table);
  if (text !== undefined) assert.equal(result.text, text);
};
const LONG = "x".repeat(10001);

checkPack(pack, {
  // Line 1 holds HC-1042 (group 1 "1042"), line 2 nothing, line 3 HC-7.
  test_lines: {
    values: { pattern: "HC-(\\d+)", text: "order HC-1042 late\nno order here\nHC-7 lost" },
    expect: exactly([["Lines", 3], ["Lines with a match", 2], ["Lines without a match", 1], ["Capture groups", 1]],
      { columns: ["line", "matched", "match", "groups"], rows: [[1, "yes", "HC-1042", '["1042"]'], [2, "no", "", ""], [3, "yes", "HC-7", '["7"]']] }, "no order here"),
    more: [
      // Whole line: "HC-12 late" has more after the number.
      { values: { pattern: "HC-\\d+", text: "HC-12\nHC-12 late", whole: true },
        expect: exactly([["Lines", 2], ["Lines with a match", 1], ["Lines without a match", 1], ["Capture groups", 0]], undefined, "HC-12 late") },
      // Group 1 takes no part when the second alternative matches.
      { values: { pattern: "(a)|(b)", text: "b" },
        expect: exactly([["Lines", 1], ["Lines with a match", 1], ["Lines without a match", 0], ["Capture groups", 2]],
          { columns: ["line", "matched", "match", "groups"], rows: [[1, "yes", "b", "[null,\"b\"]"]] }, "") },
      // Ignore case.
      { values: { pattern: "late", flags: "i", text: "LATE" }, expect: exactly([["Lines", 1], ["Lines with a match", 1], ["Lines without a match", 0], ["Capture groups", 0]]) },
    ],
    // Not valid; exponential shape; unknown flag; doubled flag; text over 10,000 characters; a ) that the whole-line
    // wrapper would otherwise balance.
    // The last five once hung the page on 40 characters (alternatives or pieces that match the same text inside a repeat).
    invalid: [{ pattern: "(", text: "a" }, { pattern: "(a+)+$", text: "aaa" }, { pattern: "a", flags: "g", text: "a" }, { pattern: "a", flags: "ii", text: "a" },
      { pattern: "a", text: LONG }, { pattern: "a)(b", text: "a", whole: true },
      { pattern: "(a|aa)+$", text: "aaaa!" }, { pattern: "(\\w|\\d)+$", text: "1111!" }, { pattern: "(\\s|.)*y", text: "    x" }, { pattern: "(\\s?\\s?)+y", text: "    x" },
      { pattern: "(a+){10}$", text: "aaaa!" }],
  },
  // "HC-1 late" starts at index 2 of line 1 (column 3); "HC-22" starts line 2. Group 2 takes no part in the second, so
  // its CSV cell is empty.
  match_details: {
    values: { pattern: "(?<id>HC-\\d+)(?: (late))?", text: "x HC-1 late\nHC-22\n" },
    expect: exactly([["Matches", 2], ["Lines with a match", 2], ["Stopped at 1,000 matches", "no"]],
      { columns: ["match", "line", "column", "text", "id", "group 2"], rows: [[1, 1, 3, "HC-1 late", "HC-1", "late"], [2, 2, 1, "HC-22", "HC-22", null]] },
      '"line","column","match","id","group 2"\r\n"1","3","HC-1 late","HC-1","late"\r\n"2","1","HC-22","HC-22",""\r\n'),
    more: [
      // A match a spreadsheet would run as a formula gets an apostrophe in the CSV.
      { values: { pattern: "=\\w+", text: "a =SUM" }, expect: exactly([["Matches", 1], ["Lines with a match", 1], ["Stopped at 1,000 matches", "no"]], undefined, '"line","column","match"\r\n"1","3","\'=SUM"\r\n') },
      // 1,001 single-letter matches: the list stops at 1,000.
      { values: { pattern: "a", text: "a".repeat(1001) }, expect: (result) => {
        assert.deepEqual(result.rows, [["Matches", 1000], ["Lines with a match", 1], ["Stopped at 1,000 matches", "yes"]]);
        assert.equal(result.table.rows.length, 1000);
      } },
      // The emoji counts as one character, so HC-5 starts at column 3; with m, ^ matches on lines 1 and 3 (CRLF is one break).
      { values: { pattern: "HC-\\d", text: "\u{1F600} HC-5" }, expect: exactly([["Matches", 1], ["Lines with a match", 1], ["Stopped at 1,000 matches", "no"]],
        { columns: ["match", "line", "column", "text"], rows: [[1, 1, 3, "HC-5"]] }) },
      { values: { pattern: "^HC", flags: "m", text: "HC\r\nxHC\nHC" }, expect: exactly([["Matches", 2], ["Lines with a match", 2], ["Stopped at 1,000 matches", "no"]],
        { columns: ["match", "line", "column", "text"], rows: [[1, 1, 1, "HC"], [2, 3, 1, "HC"]] }) },
    ],
    invalid: [{ pattern: "[", text: "a" }, { pattern: "(.*a)*", text: "a" }],
  },
  // Case matters unless the i flag is given.
  keep_lines: {
    values: { pattern: "late", text: "a late\nb ok\nc LATE" },
    expect: exactly([["Lines", 3], ["Lines kept", 1], ["Lines dropped", 2]], undefined, "a late"),
    more: [
      { values: { pattern: "late", flags: "i", text: "a late\nb ok\nc LATE" }, expect: exactly([["Lines", 3], ["Lines kept", 2], ["Lines dropped", 1]], undefined, "a late\nc LATE") },
      { values: { pattern: "late", flags: "i", text: "a late\nb ok\nc LATE", mode: "drop" }, expect: exactly([["Lines", 3], ["Lines kept", 1], ["Lines dropped", 2]], undefined, "b ok") },
    ],
    invalid: [{ pattern: "a", text: "a", mode: "both" }],
  },
  // Three matches on lines 1 and 3; line 2 is unchanged.
  replace_preview: {
    values: { pattern: "HC-(\\d+)", replacement: "order $1", text: "HC-1 late\nfine\nHC-22 and HC-3" },
    expect: exactly([["Replacements", 3], ["Lines changed", 2], ["Lines before", 3], ["Lines after", 3]],
      { columns: ["line", "before", "after"], rows: [[1, "HC-1 late", "order 1 late"], [3, "HC-22 and HC-3", "order 22 and order 3"]] }, "order 1 late\nfine\norder 22 and order 3"),
    more: [
      // Joining lines changes the line count, so no line table.
      { values: { pattern: "\\n", replacement: "\\x20", text: "a\nb" }, expect: exactly([["Replacements", 1], ["Lines changed", null], ["Lines before", 2], ["Lines after", 1]], null, "a b") },
      // x* matches empty text before a, before b and at the end: 3 replacements.
      { values: { pattern: "x*", replacement: "-", text: "ab" }, expect: exactly([["Replacements", 3], ["Lines changed", 1], ["Lines before", 1], ["Lines after", 1]], undefined, "-a-b-") },
      // Named group and a blank replacement.
      { values: { pattern: "(?<n>\\d+)", replacement: "<$<n>>", text: "a1b22" }, expect: exactly([["Replacements", 2], ["Lines changed", 1], ["Lines before", 1], ["Lines after", 1]], undefined, "a<1>b<22>") },
      // \n in the replacement is a line break and \\ a backslash: "a,b" becomes two lines, "c" becomes "\c".
      { values: { pattern: ",", replacement: "\\n", text: "a,b" }, expect: exactly([["Replacements", 1], ["Lines changed", null], ["Lines before", 1], ["Lines after", 2]], null, "a\nb") },
      { values: { pattern: "c", replacement: "\\\\$&", text: "c" }, expect: exactly([["Replacements", 1], ["Lines changed", 1], ["Lines before", 1], ["Lines after", 1]], undefined, "\\c") },
      { values: { pattern: "\\s+", text: "a b  c" }, expect: exactly([["Replacements", 2], ["Lines changed", 1], ["Lines before", 1], ["Lines after", 1]], undefined, "abc") },
    ],
    invalid: [{ pattern: "(", text: "a" }, { pattern: "a", text: LONG }],
  },
  // Rule 1 turns both whitespace runs into _, then rule 2 rewrites both order numbers.
  replace_steps: {
    values: { rules: "\\s+ => _\nHC-(\\d+) => #$1", text: "HC-1  late HC-2" },
    expect: exactly([["Rules", 2], ["Replacements", 4]],
      { columns: ["rule", "pattern", "replacement", "replacements"], rows: [[1, "\\s+", "_", 2], [2, "HC-(\\d+)", "#$1", 2]] }, "#1_late_#2"),
    // A blank replacement deletes; blank rule lines are skipped.
    more: [{ values: { rules: "late => \n\n_ => ", text: "a_late" }, expect: exactly([["Rules", 2], ["Replacements", 2]], undefined, "a") },
      { values: { rules: "_ => \\t", text: "a_b" }, expect: exactly([["Rules", 1], ["Replacements", 1]], undefined, "a\tb") },
      // "late =>" with nothing after it (an editor may strip the trailing space) deletes too.
      { values: { rules: "late =>\n_ =>", text: "a_late_b" }, expect: exactly([["Rules", 2], ["Replacements", 3]], undefined, "ab") }],
    invalid: [{ rules: "abc", text: "a" }, { rules: "( => x", text: "a" }],
  },
  // Group 1 values 1, 2, 1.
  list_matches: {
    values: { pattern: "HC-(\\d+)", text: "HC-1 HC-2 HC-1", group: 1 },
    expect: exactly([["Matches", 3], ["Matches without the group", 0], ["Distinct values", 2], ["Stopped at 1,000 matches", "no"]],
      { columns: ["value", "times"], rows: [["1", 2], ["2", 1]] }, "1\n2\n1"),
    more: [
      { values: { pattern: "HC-(\\d+)", text: "HC-1 HC-2 HC-1", group: 1, unique: true }, expect: exactly([["Matches", 3], ["Matches without the group", 0], ["Distinct values", 2], ["Stopped at 1,000 matches", "no"]], undefined, "1\n2") },
      // "ab" fills group 1, the lone "a" does not.
      { values: { pattern: "a(b)?", text: "ab a", group: 1 }, expect: exactly([["Matches", 2], ["Matches without the group", 1], ["Distinct values", 1], ["Stopped at 1,000 matches", "no"]], undefined, "b") },
      { values: { pattern: "\\d+", text: "7 x 7" }, expect: exactly([["Matches", 2], ["Matches without the group", 0], ["Distinct values", 1], ["Stopped at 1,000 matches", "no"]], { columns: ["value", "times"], rows: [["7", 2]] }, "7\n7") },
    ],
    invalid: [{ pattern: "HC-(\\d+)", text: "HC-1", group: 2 }],
  },
  // Line 2 has no match; the optional days group is null on line 3.
  lines_to_json: {
    values: { pattern: "(?<order>HC-\\d+) is (?<status>late|lost)(?: by (?<days>\\d+) days)?", text: "HC-1 is late by 3 days\nhello\nHC-2 is lost" },
    expect: exactly([["Lines", 3], ["Rows made", 2], ["Lines without a match", 1]], { columns: ["line", "text without a match"], rows: [[2, "hello"]] },
      '[\n  {\n    "order": "HC-1",\n    "status": "late",\n    "days": "3"\n  },\n  {\n    "order": "HC-2",\n    "status": "lost",\n    "days": null\n  }\n]'),
    invalid: [{ pattern: "(a)", text: "a" }],
  },
  // late: lines 1, 3, 5; lost: 2, 3, 5; ^HC-1: 1, 5. Per line 2, 1, 2, 0, 3 patterns.
  count_per_pattern: {
    values: { patterns: "late\nlost\n^HC-1", text: "HC-1 late\nHC-2 lost\nlate and lost\nnothing\nHC-1 late lost" },
    expect: exactly([["Lines", 5], ["Patterns", 3], ["Lines matching none", 1], ["Lines matching more than one", 3], ["Lines matching all", 1]],
      { columns: ["pattern", "text", "lines", "share of lines"], rows: [[1, "late", 3, "60.0%"], [2, "lost", 3, "60.0%"], [3, "^HC-1", 2, "40.0%"]] }),
    invalid: [{ patterns: "a\n(", text: "a" }, { patterns: Array(51).fill("a").join("\n"), text: "a" }],
  },
  // "late refund" goes to rule 1 because refund comes first; rule 3 is shadowed by rule 1.
  first_rule: {
    values: { patterns: "refund\nlate|lost\nrefund now", text: "refund now please\nparcel lost\nhello\nlate refund" },
    expect: exactly([["Rule 1", 2], ["Rule 2", 1], ["Rule 3", 0], ["No rule", 1], ["Rules that caught nothing", "3"]],
      { columns: ["line", "rule", "text"], rows: [[1, 1, "refund now please"], [2, 2, "parcel lost"], [3, "none", "hello"], [4, 1, "late refund"]] }),
    more: [{ values: { patterns: "a\nb", text: "a\nb" }, expect: exactly([["Rule 1", 1], ["Rule 2", 1], ["No rule", 0], ["Rules that caught nothing", "none"]]) }],
    invalid: [{ patterns: "   ", text: "a" }],
  },
  // . ( ) ? are escaped: 4 characters. In JSON every backslash doubles.
  escape_text: {
    values: { text: "a.b (x)?" },
    expect: exactly([["Characters escaped", 4], ["As a JSON string", '"a\\\\.b \\\\(x\\\\)\\\\?"']], undefined, "a\\.b \\(x\\)\\?"),
    more: [
      { values: { text: "HC", mode: "word" }, expect: exactly([["Characters escaped", 0], ["As a JSON string", '"(?<![A-Za-z0-9_])HC(?![A-Za-z0-9_])"']], undefined, "(?<![A-Za-z0-9_])HC(?![A-Za-z0-9_])") },
      { values: { text: "1+1", mode: "line" }, expect: exactly([["Characters escaped", 1], ["As a JSON string", '"^1\\\\+1$"']], undefined, "^1\\+1$") },
      { values: { text: "a.b (x)?" }, expect: (result) => assert.ok(new RegExp(result.text).test("say a.b (x)? now")) },
    ],
    invalid: [{ text: "" }, { text: "a", mode: "nowhere" }],
  },
  // Trimmed entries; longest first (refund request 14, refund 6, Late 4, late 4, a.b 3), ties in typed order.
  keyword_pattern: {
    values: { words: "refund\nrefund request\nLate\nlate\n a.b \n" },
    expect: exactly([["Entries", 5], ["Duplicates removed", 0], ["Flags", "none"]], undefined,
      "(?<![A-Za-z0-9_])(?:refund request|refund|Late|late|a\\.b)(?![A-Za-z0-9_])"),
    more: [
      { values: { words: "refund\nrefund request\nLate\nlate\n a.b \n", whole: false, ignoreCase: true },
        expect: exactly([["Entries", 4], ["Duplicates removed", 1], ["Flags", "i"]], undefined, "(?:refund request|refund|Late|a\\.b)") },
      // Whole words: "refunds" is not a match, "a refund." is.
      { values: { words: "refund" }, expect: (result) => {
        const re = new RegExp(result.text);
        assert.equal(re.test("refunds"), false);
        assert.equal(re.test("a refund."), true);
      } },
    ],
    invalid: [{ words: " \n " }],
  },
  backtracking_check: {
    values: { pattern: "(a+)+$" },
    expect: exactly([["Findings", 1], ["Refused by the pattern tools", "yes"], ["Verdict", "Can take exponential time: rewrite it"]],
      { columns: ["position", "piece", "severity", "finding"], rows: [[1, "(a+)+", "problem", "repeats a+, which is itself repeated: the same text can be split between the two repeats in exponentially many ways"]] }),
    more: [
      // Each repetition must end in a comma, which \d+ cannot match: advice only.
      { values: { pattern: "(\\d+,)*x" }, expect: exactly([["Findings", 1], ["Refused by the pattern tools", "no"], ["Verdict", "Can be slow on long text"]],
        { columns: ["position", "piece", "severity", "finding"], rows: [[1, "(\\d+,)*", "advice", "repeats a group holding \\d+: safe only while each repetition must end in something \\d+ cannot match"]] }) },
      { values: { pattern: "x\\d+\\d+" }, expect: exactly([["Findings", 1], ["Refused by the pattern tools", "no"], ["Verdict", "Can be slow on long text"]],
        { columns: ["position", "piece", "severity", "finding"], rows: [[2, "\\d+", "advice", "next to \\d+, two repeats can share the same characters, so matching slows down sharply on a long run of characters both can match"]] }) },
      { values: { pattern: "^HC-\\d{4}$" }, expect: exactly([["Findings", 0], ["Refused by the pattern tools", "no"], ["Verdict", "No slow shapes found"]], { columns: ["position", "piece", "severity", "finding"], rows: [] }) },
      { values: { pattern: "(a|a)*" }, expect: exactly([["Findings", 1], ["Refused by the pattern tools", "yes"], ["Verdict", "Can take exponential time: rewrite it"]],
        { columns: ["position", "piece", "severity", "finding"], rows: [[1, "(a|a)*", "problem", "repeats a choice with two identical alternatives (a), which doubles the ways to match at every repetition"]] }) },
      // .* inside a repeat can eat the "a" that ends each repetition.
      { values: { pattern: "(.*a)*" }, expect: (result) => assert.deepEqual(result.table.rows, [[1, "(.*a)*", "problem", "repeats a group holding .*, which can swallow what ends each repetition: exponential time on text that almost matches"]]) },
      // The optional \s? lets \w+ be a whole repetition on its own; the repeat at character 3 inside the group is reached too.
      { values: { pattern: "z(\\w+\\s?)+" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[1], row[2]]), [[2, "(\\w+\\s?)+", "problem"]]) },
      // x+x+ inside a repeat: both the inner pair and the repeat are reported, the repeat as a problem.
      { values: { pattern: "(x+x+)+y" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[1], row[2]]), [[1, "(x+x+)+", "problem"], [2, "x+", "advice"]]) },
      // (a|ab)* has one alternative that starts another, but every text splits into a and ab one way only: advice.
      { values: { pattern: "(a|ab)*c" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[2]]), [[1, "advice"]]) },
      // "aa" is a·a or aa, so the ways to match double with each pair of a's.
      { values: { pattern: "(a|aa)+" }, expect: exactly([["Findings", 1], ["Refused by the pattern tools", "yes"], ["Verdict", "Can take exponential time: rewrite it"]],
        { columns: ["position", "piece", "severity", "finding"], rows: [[1, "(a|aa)+", "problem", "repeats a choice whose alternatives a and aa can match the same text, so the ways to match multiply at every repetition"]] }) },
      // \r\n is one alternative or \r then \n; a space is \s or "." (character sets overlap, not just text).
      { values: { pattern: "(?:\\r\\n|\\r|\\n)+" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[2]]), [[1, "problem"]]) },
      { values: { pattern: "x(\\s|.)*y" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[1], row[2]]), [[2, "(\\s|.)*", "problem"]]) },
      // A space can be taken by either \s? in one repetition; a? can be empty and leave the a to the next repetition.
      { values: { pattern: "(\\s?\\s?)+y" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[2]]), [[1, "problem"]]) },
      { values: { pattern: "(a?a)+$" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[2]]), [[1, "problem"]]) },
      // Ten repetitions of a+ is polynomial of degree ten: refused like an unlimited repeat.
      { values: { pattern: "(a+){10}$" }, expect: (result) => assert.deepEqual(result.table.rows.map((row) => [row[0], row[1], row[2]]), [[1, "(a+){10}", "problem"]]) },
      // [a-z]+ cannot match the capital that starts the next repetition, unless the i flag makes it match.
      { values: { pattern: "(?:[A-Z][a-z]+\\s?)+$" }, expect: exactly([["Findings", 1], ["Refused by the pattern tools", "no"], ["Verdict", "Can be slow on long text"]]) },
      { values: { pattern: "(?:[A-Z][a-z]+\\s?)+$", flags: "i" }, expect: exactly([["Findings", 1], ["Refused by the pattern tools", "yes"], ["Verdict", "Can take exponential time: rewrite it"]]) },
      // Mr. and Mrs. differ at the third character, so no text splits two ways; [^"\\] and \\. never start alike.
      { values: { pattern: "(?:Mr\\.|Mrs\\.)+" }, expect: exactly([["Findings", 0], ["Refused by the pattern tools", "no"], ["Verdict", "No slow shapes found"]]) },
      { values: { pattern: '"(?:[^"\\\\]|\\\\.)*"' }, expect: exactly([["Findings", 0], ["Refused by the pattern tools", "no"], ["Verdict", "No slow shapes found"]]) },
    ],
    invalid: [{ pattern: "(" }, { pattern: "a", flags: "x" }],
  },
  // ** followed by / may be empty, * stays within one part.
  glob_to_pattern: {
    values: { wildcard: "orders/**/*.json", samples: "orders/a.json\norders/2026/11/b.json\norders/a.csv\nother/a.json" },
    expect: exactly([["Sample lines", 4], ["Sample lines that match", 2]], { columns: ["line", "matches", "text"],
      rows: [[1, "yes", "orders/a.json"], [2, "yes", "orders/2026/11/b.json"], [3, "no", "orders/a.csv"], [4, "no", "other/a.json"]] }, "^orders/(?:.*/)?[^/]*\\.json$"),
    more: [
      { values: { wildcard: "HC-[!0]?{a,b}" }, expect: exactly([["Sample lines", 0], ["Sample lines that match", 0]], null, "^HC-[^0][^/](?:a|b)$") },
      { values: { wildcard: "a%b_", syntax: "like", samples: "aXXbY\nab" }, expect: exactly([["Sample lines", 2], ["Sample lines that match", 1]], undefined, "^a.*b.$") },
      // \% is a literal percent sign.
      { values: { wildcard: "100\\%", syntax: "like", samples: "100%\n1000" }, expect: exactly([["Sample lines", 2], ["Sample lines that match", 1]], undefined, "^100%$") },
    ],
    invalid: [{ wildcard: "[abc" }, { wildcard: "{a,{b}}" }, { wildcard: "{a" }],
  },
  // "lately" has late but no whole word; "delayed" only for B.
  compare_patterns: {
    values: { a: "late", b: "\\blate\\b|delayed", text: "late order\ndelayed order\nfine\nlately" },
    expect: exactly([["Lines", 4], ["Matched by both", 1], ["Only A", 1], ["Only B", 1], ["Neither", 1]],
      { columns: ["line", "A", "B", "text"], rows: [[1, "yes", "yes", "late order"], [2, "no", "yes", "delayed order"], [3, "no", "no", "fine"], [4, "yes", "no", "lately"]] }),
    invalid: [{ a: "(", b: "a", text: "a" }, { a: "a", b: "(a*)*", text: "a" }],
  },
  // Line 4 is blank. HC-77 has two digits (missed); HC-12345 has no word boundary after four digits; HC-1234. does.
  expected_lines: {
    values: { pattern: "HC-\\d{4}\\b", examples: "+ HC-1042 is late\n+HC-77\n- no order\n\n- HC-12345\n- HC-1234." },
    expect: exactly([["Examples", 5], ["Correct", 3], ["Should match but did not", 1], ["Matched but should not", 1]],
      { columns: ["line", "expected", "matched", "result", "text"], rows: [[1, "match", "yes", "ok", "HC-1042 is late"], [2, "match", "no", "missed", "HC-77"],
        [3, "no match", "no", "ok", "no order"], [5, "no match", "no", "ok", "HC-12345"], [6, "no match", "yes", "false match", "HC-1234."]] }),
    invalid: [{ pattern: "a", examples: "x bad" }, { pattern: "a", examples: "\n\n" }],
  },
  split_fields: {
    values: { pattern: "\\s*[,;]\\s*", text: "a, b;c\nd\n,e" },
    expect: exactly([["Lines", 3], ["Most fields on a line", 3], ["Fewest fields on a line", 1]],
      { columns: ["line", "field 1", "field 2", "field 3"], rows: [[1, "a", "b", "c"], [2, "d", "", ""], [3, "", "e", ""]] }),
    more: [{ values: { pattern: "\\s*[,;]\\s*", text: "a, b;c\nd\n,e", keepEmpty: false }, expect: exactly([["Lines", 3], ["Most fields on a line", 3], ["Fewest fields on a line", 1]],
      { columns: ["line", "field 1", "field 2", "field 3"], rows: [[1, "a", "b", "c"], [2, "d", "", ""], [3, "e", "", ""]] }) },
    // \b never matches empty text on its own, but every match it makes is empty, so nothing splits.
    { values: { pattern: "\\b", text: "ab cd" }, expect: exactly([["Lines", 1], ["Most fields on a line", 1], ["Fewest fields on a line", 1]], { columns: ["line", "field 1"], rows: [[1, "ab cd"]] }) }],
    invalid: [{ pattern: ",*", text: "a,b" }],
  },
  explain_pattern: {
    values: { pattern: "^HC-(?<num>\\d{4})(?:x|y)?$" },
    expect: exactly([["Capture groups", 1], ["Named groups", "num"], ["Matches empty text", "no"], ["Pieces", 9]], { columns: ["level", "piece", "meaning"], rows: [
      [0, "^", "the start of the text"], [0, "HC-", "the text \"HC-\""], [0, "(?<num>\\d{4})", "capture group 1 named \"num\""], [1, "\\d{4}", "a digit (0-9), exactly 4 times"],
      [0, "(?:x|y)?", "a group (no capture), optional"], [1, "x", "the character \"x\""], [1, "|", "or"], [1, "y", "the character \"y\""], [0, "$", "the end of the text"]] }),
    more: [
      // With s, the dot is any character. \.+? has a quantifier, so it is not merged into the text before it.
      { values: { pattern: "a\\.+?[^ ]*.", flags: "s" }, expect: exactly([["Capture groups", 0], ["Named groups", "none"], ["Matches empty text", "no"], ["Pieces", 4]],
        { columns: ["level", "piece", "meaning"], rows: [[0, "a", "the character \"a\""], [0, "\\.+?", "the character \".\", one or more times (as few as possible)"],
          [0, "[^ ]*", "one character not in [^ ], zero or more times"], [0, ".", "any character"]] }) },
      { values: { pattern: "(\\d)?\\1", flags: "m" }, expect: exactly([["Capture groups", 1], ["Named groups", "none"], ["Matches empty text", "yes"], ["Pieces", 3]],
        { columns: ["level", "piece", "meaning"], rows: [[0, "(\\d)?", "capture group 1, optional"], [1, "\\d", "a digit (0-9)"], [0, "\\1", "the same text that group 1 matched"]] }) },
    ],
    invalid: [{ pattern: "(?<a>x" }],
  },
  // HC stays literal, digit runs of length 4, 5 and 1.
  shape_pattern: {
    values: { examples: "HC-1042\nHC-20931\nHC-7" },
    expect: exactly([["Examples", 3], ["Pieces", 3]], undefined, "^HC-\\d{1,5}$"),
    more: [
      { values: { examples: "ab-12\nCd_345" }, expect: exactly([["Examples", 2], ["Pieces", 3]], undefined, "^[A-Za-z]{2}[\\-_]\\d{2,3}$") },
      { values: { examples: "AB.1\nZQ.9" }, expect: exactly([["Examples", 2], ["Pieces", 3]], undefined, "^[A-Z]{2}\\.\\d$") },
      { values: { examples: "X" }, expect: exactly([["Examples", 1], ["Pieces", 1]], undefined, "^X$") },
    ],
    invalid: [{ examples: "a1\n1a" }, { examples: "  " }],
  },
  // Characters - 1 a b c z (the line break left out): a, b, c are a run of three.
  char_class: {
    values: { text: "cab\nz-b1" },
    expect: exactly([["Distinct characters", 6], ["Needs the u flag", "no"]], undefined, "[\\-1a-cz]"),
    more: [
      { values: { text: "cab\nz-b1", skipBreaks: false }, expect: exactly([["Distinct characters", 7], ["Needs the u flag", "no"]], undefined, "[\\n\\-1a-cz]") },
      { values: { text: "\u{1F600}a" }, expect: exactly([["Distinct characters", 2], ["Needs the u flag", "yes"]], undefined, "[a\u{1F600}]") },
      // Two in a row stay as two characters; ] and ^ are escaped.
      { values: { text: "]^ab" }, expect: exactly([["Distinct characters", 4], ["Needs the u flag", "no"]], undefined, "[\\]\\^ab]") },
    ],
    invalid: [{ text: "\n\n" }],
  },
  // Line 2 holds é (U+00E9) and an en dash (U+2013): 11 + 9 + 4 = 24 characters checked.
  chars_outside: {
    values: { allowed: "[A-Za-z0-9 ]", text: "Hello world\nCafé – ok\nfine" },
    expect: exactly([["Characters checked", 24], ["Distinct characters not allowed", 2], ["Lines with one", 1]],
      { columns: ["character", "code point", "times", "first line"], rows: [["é", "U+00E9", 1, 2], ["–", "U+2013", 1, 2]] }),
    more: [{ values: { allowed: "[a-z]", text: "a\tb\nc\td!" }, expect: exactly([["Characters checked", 7], ["Distinct characters not allowed", 2], ["Lines with one", 2]],
      { columns: ["character", "code point", "times", "first line"], rows: [["(not visible)", "U+0009", 2, 1], ["!", "U+0021", 1, 2]] }) }],
    invalid: [{ allowed: "[", text: "a" }],
  },
  // HC-1042 (7 characters) keeps 42 and masks 5; HC-7 (4) keeps -7 and masks 2.
  mask_matches: {
    values: { pattern: "HC-\\d+", text: "HC-1042 and HC-7", keep: 2 },
    expect: exactly([["Matches masked", 2], ["Characters masked", 7]], undefined, "*****42 and **-7"),
    more: [
      { values: { pattern: "HC-\\d+", text: "HC-1042 and HC-7", keep: 10 }, expect: exactly([["Matches masked", 2], ["Characters masked", 0]], undefined, "HC-1042 and HC-7") },
      { values: { pattern: "HC-\\d+", text: "HC-1042 and HC-7", mask: "#" }, expect: exactly([["Matches masked", 2], ["Characters masked", 11]], undefined, "####### and ####") },
    ],
    invalid: [{ pattern: "a", text: "a", mask: "ab" }, { pattern: "a", text: "a", keep: -1 }],
  },
  number_range: {
    // 1 to 9, 10 to 29, 30 to 31.
    values: { low: 1, high: 31, standalone: false },
    expect: exactly([["Alternatives", 3]], undefined, "^(?:[1-9]|[1-2]\\d|3[0-1])$"),
    more: [
      ...[[7, 1042], [0, 0], [100, 999], [95, 105], [0, 1999], [19, 20]].map(([low, high]) => ({ values: { low, high, standalone: false }, expect: (result) => {
        const re = new RegExp(result.text);
        for (let n = 0; n <= 2000; n++) assert.equal(re.test(String(n)), n >= low && n <= high, `${result.text} on ${n}`);
        assert.equal(re.test(`0${low}`), false, "a leading zero is not matched");
      } })),
      // Wide range: boundaries and a fixed spread of samples up to 999,999,999, judged by plain comparison.
      { values: { low: 123456, high: 987654321, standalone: false }, expect: (result) => {
        const re = new RegExp(result.text);
        const samples = [0, 9, 99999, 123455, 123456, 123457, 999999, 1000000, 987654320, 987654321, 987654322, 999999999];
        for (let n = 1; n < 400; n++) samples.push((n * 2654435761) % 1000000000);
        for (const n of samples) assert.equal(re.test(String(n)), n >= 123456 && n <= 987654321, `${n}`);
      } },
      { values: { low: 1, high: 31 }, expect: (result) => {
        const re = new RegExp(result.text);
        assert.equal(re.test("day 31."), true);
        assert.equal(re.test("day 315"), false);
        assert.equal(re.test("day 32"), false);
      } },
    ],
    invalid: [{ low: 5, high: 4 }, { low: 0, high: 1000000000 }, { low: 1.5, high: 3 }],
  },
  convert_python_js: {
    values: { pattern: "(?i)(?P<order>HC-\\d+)\\s+(?P=order)\\Z(?#end)" },
    expect: exactly([["Pattern", "(?<order>HC-\\d+)\\s+\\k<order>$"], ["Flags", "i"], ["Changes", 5], ["Note", "Python's \\d, \\w and \\b also match other scripts; JavaScript's match ASCII only."]],
      { columns: ["from", "to"], rows: [["(?i)", "flags i"], ["(?P<order>", "(?<order>"], ["(?P=order)", "\\k<order>"], ["\\Z", "$"], ["(?#end)", ""]] }),
    more: [
      { values: { pattern: "\\A[$]x", direction: "py_to_js" }, expect: exactly([["Pattern", "^[$]x"], ["Flags", "none"], ["Changes", 1], ["Note", "none"]], undefined) },
      // With m, ^ and $ would mean a line's ends, so \A and \Z become lookarounds for the very start and end. In Python
      // a ] right after [ is a character, which JavaScript needs escaped.
      { values: { pattern: "\\A[]a]x\\Z", flags: "m" }, expect: exactly([["Pattern", "(?<![\\s\\S])[\\]a]x(?![\\s\\S])"], ["Flags", "m"], ["Changes", 3], ["Note", "none"]],
        { columns: ["from", "to"], rows: [["\\A", "(?<![\\s\\S])"], ["[]", "[\\]"], ["\\Z", "(?![\\s\\S])"]] }) },
      // \U with eight hex digits needs the u flag; (?a) is dropped and silences the \d note; a final $ gets a note.
      { values: { pattern: "\\U0001F600" }, expect: exactly([["Pattern", "\\u{1F600}"], ["Flags", "u"], ["Changes", 1], ["Note", "none"]], undefined) },
      { values: { pattern: "(?a)\\d+$" }, expect: exactly([["Pattern", "\\d+$"], ["Flags", "none"], ["Changes", 1],
        ["Note", "Python's $ also matches before a final line break; JavaScript's $ only at the very end."]], undefined) },
      { values: { pattern: "^(?<sku>[A-Z]+)-\\d+\\k<sku>$", direction: "js_to_py", flags: "i" },
        expect: exactly([["Pattern", "^(?P<sku>[A-Z]+)-\\d+(?P=sku)\\Z"], ["Flags", "re.IGNORECASE"], ["Changes", 3],
          ["Note", "Python's \\d, \\w and \\b also match other scripts; add re.ASCII to keep JavaScript's meaning."]], undefined) },
      // With m, $ means the end of a line in both. Inside a class $ is literal; (?<=...) is a lookbehind, not a name.
      { values: { pattern: "(?<=a)[$]x$", direction: "js_to_py", flags: "m" }, expect: exactly([["Pattern", "(?<=a)[$]x$"], ["Flags", "re.MULTILINE"], ["Changes", 0],
        ["Note", "Python's lookbehinds must match a fixed length."]], undefined) },
      { values: { pattern: "\\u{1F600}\\cJ", direction: "js_to_py", flags: "u" }, expect: exactly([["Pattern", "\\U0001F600\\x0a"], ["Flags", "none"], ["Changes", 2], ["Note", "none"]], undefined) },
      // JavaScript's [^] is any character and [] matches nothing; the class after them is an ordinary one.
      { values: { pattern: "[^]x[]y[a]", direction: "js_to_py" }, expect: exactly([["Pattern", "[\\s\\S]x(?!)y[a]"], ["Flags", "none"], ["Changes", 2], ["Note", "none"]], undefined) },
    ],
    invalid: [{ pattern: "(?x)a" }, { pattern: "(?>a)" }, { pattern: "a(?i)b" }, { pattern: "\\N{EM DASH}" }, { pattern: "\\p{L}", direction: "js_to_py", flags: "u" },
      { pattern: "(?<na$me>a)", direction: "js_to_py" }, { pattern: "(", direction: "js_to_py" }],
  },
});
