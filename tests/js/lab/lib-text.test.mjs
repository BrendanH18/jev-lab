// static/js/lab/lib/text.js: the shared text helpers Lab packs import. Run with: node --test tests/js/lab/lib-text.test.mjs
// Every expected value here is derived without the code under test: counted by hand, taken from a published table
// (the FNV test vectors, textbook edit distances) or computed with Python (its utf-8 codec, a full-matrix
// Levenshtein, a byte-by-byte FNV-1a loop). The comment at each group says which.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as text from "../../../static/js/lab/lib/text.js";

const cp = (...codes) => String.fromCodePoint(...codes);
const E_ACUTE = cp(0xE9);                 // precomposed e with acute accent
const COMBINING_ACUTE = cp(0x301);
const EURO = cp(0x20AC);
const GRIN = cp(0x1F600);                 // an astral emoji: one code point, two UTF-16 units, four UTF-8 bytes
const LONE_SURROGATE = String.fromCharCode(0xD83D);
const CAFE = `caf${E_ACUTE}`;

test("every export is a function, and every function reads null and undefined as empty text", () => {
  const names = ["codePoints", "graphemeCount", "utf8Bytes", "words", "wordCount", "lines", "lineCount", "sentences", "longestLine", "averageWordLength",
    "isAscii", "hasControlCharacters", "hasEdgeWhitespace", "hasRepeatedSpaces", "hasMixedNewlines", "isBlank", "isUpperCase", "isLowerCase", "isTitleCase",
    "normalizeNewlines", "collapseWhitespace", "trimLines", "trimLineEnds", "stripControlCharacters", "normalizeQuotes", "normalizeDashes", "normalizeUnicode",
    "slugify", "toSnakeCase", "toCamelCase", "toKebabCase", "toTitleCase", "isIdentifier", "uniqueName",
    "levenshtein", "similarity", "jaccard", "commonPrefix", "commonSuffix", "ngrams",
    "findEmails", "findUrls", "findNumbers", "findPhoneNumbers", "findIsoDates", "findPlaceholders", "placeholderName", "findBackticked",
    "escapeRegExp", "countOccurrences", "truncate", "fingerprint", "pluralize"];
  assert.deepEqual(Object.keys(text).sort(), [...names].sort());
  const oneText = names.filter((name) => !["levenshtein", "similarity", "jaccard", "commonPrefix", "commonSuffix", "ngrams", "uniqueName",
    "countOccurrences", "truncate", "pluralize"].includes(name));
  for (const name of oneText) {
    assert.deepEqual(text[name](null), text[name](""), `${name}(null)`);
    assert.deepEqual(text[name](undefined), text[name](""), `${name}(undefined)`);
  }
});

// ---------- measures ----------

test("codePoints counts code points, not UTF-16 units", () => {
  // By definition: one per character, one for an astral character, two for a letter plus a combining mark.
  assert.equal(text.codePoints(""), 0);
  assert.equal(text.codePoints("abc"), 3);
  assert.equal(GRIN.length, 2);
  assert.equal(text.codePoints(GRIN), 1);
  assert.equal(text.codePoints(`e${COMBINING_ACUTE}`), 2);
  assert.equal(text.codePoints(LONE_SURROGATE), 1);
  assert.equal(text.codePoints(null), 0);
  assert.equal(text.codePoints(undefined), 0);
  assert.equal(text.codePoints(12345), 5);
  assert.equal(text.codePoints(true), 4);
  assert.equal(text.codePoints(Object.create(null)), 0);
});

test("graphemeCount counts what a reader sees as one character", () => {
  // Unicode UAX #29 extended grapheme clusters: a base letter and its combining mark are one cluster, a pair of
  // regional indicators (a flag) is one, and emoji joined by ZERO WIDTH JOINER are one.
  assert.equal(text.graphemeCount(""), 0);
  assert.equal(text.graphemeCount("abc"), 3);
  assert.equal(text.graphemeCount(`e${COMBINING_ACUTE}`), 1);
  assert.equal(text.graphemeCount(cp(0x1F1EB, 0x1F1F7)), 1);
  assert.equal(text.graphemeCount(cp(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467)), 1);
  assert.equal(text.graphemeCount(`a${GRIN}b`), 3);
});

test("utf8Bytes is the encoded size", () => {
  // UTF-8 by definition: 1 byte below U+0080, 2 below U+0800, 3 below U+10000, 4 above. The mixed string was
  // encoded with Python: len("café ☕".encode("utf-8")) == 9. A lone surrogate is U+FFFD (3 bytes), as TextEncoder does.
  assert.equal(text.utf8Bytes(""), 0);
  assert.equal(text.utf8Bytes("a"), 1);
  assert.equal(text.utf8Bytes(E_ACUTE), 2);
  assert.equal(text.utf8Bytes(EURO), 3);
  assert.equal(text.utf8Bytes(GRIN), 4);
  assert.equal(text.utf8Bytes(`${CAFE} ${cp(0x2615)}`), 9);
  assert.equal(text.utf8Bytes(LONE_SURROGATE), 3);
  assert.equal(text.utf8Bytes(cp(0x7F)), 1);
  assert.equal(text.utf8Bytes(cp(0x80)), 2);
  assert.equal(text.utf8Bytes(cp(0x7FF)), 2);
  assert.equal(text.utf8Bytes(cp(0x800)), 3);
  assert.equal(text.utf8Bytes(cp(0xFFFF)), 3);
  assert.equal(text.utf8Bytes(cp(0x10000)), 4);
  assert.equal(text.utf8Bytes("a".repeat(100000)), 100000);
  for (const sample of ["", "plain", CAFE, `${EURO}${GRIN} mixed ${E_ACUTE}`, LONE_SURROGATE]) {
    assert.equal(text.utf8Bytes(sample), new TextEncoder().encode(sample).length);
  }
});

test("words, wordCount and averageWordLength split on whitespace", () => {
  // Counted by hand.
  assert.deepEqual(text.words("  Hello,   world\n\tagain "), ["Hello,", "world", "again"]);
  assert.deepEqual(text.words(""), []);
  assert.deepEqual(text.words(" \n\t "), []);
  assert.deepEqual(text.words("one"), ["one"]);
  assert.equal(text.wordCount("  Hello,   world\n\tagain "), 3);
  assert.equal(text.wordCount(""), 0);
  assert.equal(text.wordCount(`a${cp(0xA0)}b`), 2);                 // a no-break space separates words too
  assert.equal(text.averageWordLength("a bb ccc"), 2);              // (1 + 2 + 3) / 3
  assert.equal(text.averageWordLength(`h${E_ACUTE}llo ${GRIN}`), 3); // (5 + 1) / 2, in code points
  assert.equal(text.averageWordLength("ab abc"), 2.5);
  assert.equal(text.averageWordLength(""), 0);
  assert.equal(text.averageWordLength("   "), 0);
});

test("lines, lineCount and longestLine treat CRLF, CR and LF as one break each", () => {
  // Counted by hand; a final line break closes the last line.
  assert.deepEqual(text.lines(""), []);
  assert.deepEqual(text.lines("a"), ["a"]);
  assert.deepEqual(text.lines("a\n"), ["a"]);
  assert.deepEqual(text.lines("a\n\n"), ["a", ""]);
  assert.deepEqual(text.lines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
  assert.deepEqual(text.lines("\n"), [""]);
  assert.equal(text.lineCount(""), 0);
  assert.equal(text.lineCount("a"), 1);
  assert.equal(text.lineCount("a\n"), 1);
  assert.equal(text.lineCount("a\nb"), 2);
  assert.equal(text.lineCount("a\r\nb\rc\nd"), 4);
  assert.equal(text.lineCount("\r\n"), 1);
  assert.equal(text.lineCount("a\n\n"), 2);
  assert.equal(text.lineCount("\n\n\n"), 3);
  assert.equal(text.longestLine(""), 0);
  assert.equal(text.longestLine(`ab\r\ncdef\n${GRIN.repeat(5)}`), 5);
  assert.equal(text.longestLine("abc"), 3);
  assert.equal(text.longestLine("\n\n"), 0);
});

test("sentences end at . ! ? before whitespace or the end", () => {
  // Split by hand from the stated rule.
  assert.deepEqual(text.sentences("Hello world. How are you? Fine!"), ["Hello world.", "How are you?", "Fine!"]);
  assert.deepEqual(text.sentences("Pi is 3.14 today. Yes"), ["Pi is 3.14 today.", "Yes"]);
  assert.deepEqual(text.sentences('He said "stop." Then he left.'), ['He said "stop."', "Then he left."]);
  assert.deepEqual(text.sentences("What?! No..."), ["What?!", "No..."]);
  assert.deepEqual(text.sentences("One.\nTwo."), ["One.", "Two."]);
  assert.deepEqual(text.sentences("no terminator"), ["no terminator"]);
  assert.deepEqual(text.sentences("see harbor.example for more"), ["see harbor.example for more"]);
  assert.deepEqual(text.sentences(""), []);
  assert.deepEqual(text.sentences("   "), []);
});

// ---------- character tests ----------

test("character tests", () => {
  // Each case follows from the definition in the function's comment.
  assert.equal(text.isAscii(""), true);
  assert.equal(text.isAscii("abc\n\t~"), true);
  assert.equal(text.isAscii(cp(0x7F)), true);
  assert.equal(text.isAscii(cp(0x80)), false);
  assert.equal(text.isAscii(CAFE), false);
  assert.equal(text.isAscii(GRIN), false);

  assert.equal(text.hasControlCharacters(""), false);
  assert.equal(text.hasControlCharacters("a\tb\r\nc"), false);
  assert.equal(text.hasControlCharacters(CAFE), false);
  assert.equal(text.hasControlCharacters(`a${cp(0)}b`), true);
  assert.equal(text.hasControlCharacters(`${cp(0x1B)}[0m`), true);
  assert.equal(text.hasControlCharacters(cp(0x0B)), true);
  assert.equal(text.hasControlCharacters(cp(0x7F)), true);
  assert.equal(text.hasControlCharacters(cp(0x85)), true);
  assert.equal(text.hasControlCharacters(cp(0xA0)), false);

  assert.equal(text.hasEdgeWhitespace(""), false);
  assert.equal(text.hasEdgeWhitespace("a b"), false);
  assert.equal(text.hasEdgeWhitespace(" a"), true);
  assert.equal(text.hasEdgeWhitespace("a "), true);
  assert.equal(text.hasEdgeWhitespace("a\n"), true);
  assert.equal(text.hasEdgeWhitespace(`${cp(0xA0)}a`), true);

  assert.equal(text.hasRepeatedSpaces("a  b"), true);
  assert.equal(text.hasRepeatedSpaces("a b c"), false);
  assert.equal(text.hasRepeatedSpaces("a \tb"), false);
  assert.equal(text.hasRepeatedSpaces("a\n\nb"), false);
  assert.equal(text.hasRepeatedSpaces(""), false);

  assert.equal(text.hasMixedNewlines(""), false);
  assert.equal(text.hasMixedNewlines("a\nb\nc"), false);
  assert.equal(text.hasMixedNewlines("a\r\nb\r\n"), false);
  assert.equal(text.hasMixedNewlines("a\rb"), false);
  assert.equal(text.hasMixedNewlines("a\r\nb\nc"), true);
  assert.equal(text.hasMixedNewlines("a\rb\nc"), true);
  assert.equal(text.hasMixedNewlines("a\r\n\rb"), true);

  assert.equal(text.isBlank(""), true);
  assert.equal(text.isBlank(" \t\r\n"), true);
  assert.equal(text.isBlank(null), true);
  assert.equal(text.isBlank(" a "), false);
  assert.equal(text.isBlank(0), false);
});

test("case tests need at least one cased letter", () => {
  assert.equal(text.isUpperCase("ORDER 66"), true);
  assert.equal(text.isUpperCase(`${cp(0xC9)}COLE`), true);
  assert.equal(text.isUpperCase("Order"), false);
  assert.equal(text.isUpperCase("123"), false);
  assert.equal(text.isUpperCase(""), false);
  assert.equal(text.isLowerCase("order 66"), true);
  assert.equal(text.isLowerCase(CAFE), true);
  assert.equal(text.isLowerCase("Order"), false);
  assert.equal(text.isLowerCase("123"), false);
  assert.equal(text.isLowerCase(""), false);
  for (const yes of ["Order Status", "Well-Known Fact", "Don't Stop", "3rd Place", "A", "Hello, World!"]) assert.equal(text.isTitleCase(yes), true, yes);
  for (const no of ["Order status", "USA Today", "iPhone", "order", "", "123", "3rd"]) assert.equal(text.isTitleCase(no), false, no);
});

// ---------- cleanup ----------

test("cleanup functions", () => {
  // Expected texts written out by hand.
  assert.equal(text.normalizeNewlines("a\r\nb\rc\nd"), "a\nb\nc\nd");
  assert.equal(text.normalizeNewlines("\r\r\n\n"), "\n\n\n");
  assert.equal(text.normalizeNewlines(""), "");

  assert.equal(text.collapseWhitespace("  a \t\r\n b  c "), "a b c");
  assert.equal(text.collapseWhitespace(" \n "), "");

  assert.equal(text.trimLines("  a  \r\n\tb \n\n c"), "a\r\nb\n\nc");
  assert.equal(text.trimLines("a\n"), "a\n");
  assert.equal(text.trimLines("   "), "");
  assert.equal(text.trimLineEnds("  a  \r\n\tb \n"), "  a\r\n\tb\n");
  assert.equal(text.trimLineEnds("a \rb "), "a\rb");

  assert.equal(text.stripControlCharacters(`a${cp(0)}b\tc${cp(0x1B)}\r\nd${cp(0x7F)}${cp(0x9F)}`), "ab\tc\r\nd");
  assert.equal(text.stripControlCharacters(CAFE), CAFE);

  assert.equal(text.normalizeQuotes(`${cp(0x201C)}a${cp(0x201D)} ${cp(0x2018)}b${cp(0x2019)} ${cp(0x201E)}c${cp(0x201F)} ${cp(0x201A)}d${cp(0x201B)}`), "\"a\" 'b' \"c\" 'd'");
  assert.equal(text.normalizeQuotes("\"plain\" 'quotes'"), "\"plain\" 'quotes'");

  assert.equal(text.normalizeDashes(`a${cp(0x2010)}b${cp(0x2011)}c${cp(0x2012)}d${cp(0x2013)}e${cp(0x2014)}f${cp(0x2015)}g${cp(0x2212)}h`), "a-b-c-d-e-f-g-h");
  assert.equal(text.normalizeDashes("a-b_c~d"), "a-b_c~d");

  // Unicode normalization: NFC composes e + U+0301 into U+00E9, NFD splits it, NFKC folds the fi ligature U+FB01.
  assert.equal(text.normalizeUnicode(`e${COMBINING_ACUTE}`), E_ACUTE);
  assert.equal(text.normalizeUnicode(`e${COMBINING_ACUTE}`, "NFC"), E_ACUTE);
  assert.equal(text.normalizeUnicode(E_ACUTE, "NFD"), `e${COMBINING_ACUTE}`);
  assert.equal(text.normalizeUnicode(cp(0xFB01), "NFKC"), "fi");
  assert.equal(text.normalizeUnicode(cp(0xFB01), "NFC"), cp(0xFB01));
  assert.equal(text.normalizeUnicode(cp(0xFB01), "NFKD"), "fi");
  assert.equal(text.normalizeUnicode("abc", "nfc"), null);
  assert.equal(text.normalizeUnicode("abc", "bogus"), null);
  assert.equal(text.normalizeUnicode("abc", null), null);
});

// ---------- identifiers ----------

test("slugify and the case converters", () => {
  // Expected names written out by hand.
  assert.equal(text.slugify("Hello, World!"), "hello-world");
  assert.equal(text.slugify(`Cr${cp(0xE8)}me Br${cp(0xFB)}l${E_ACUTE}e`), "creme-brulee");
  assert.equal(text.slugify("  --a--b-- "), "a-b");
  assert.equal(text.slugify("Don't stop"), "dont-stop");
  assert.equal(text.slugify("Hello World", "_"), "hello_world");
  assert.equal(text.slugify("Hello World", ""), "helloworld");
  assert.equal(text.slugify("Hello World", null), "hello-world");
  assert.equal(text.slugify("helloWorld"), "helloworld");
  assert.equal(text.slugify(`Stra${cp(0xDF)}e`), "strasse");
  assert.equal(text.slugify(cp(0x65E5, 0x672C)), "");
  assert.equal(text.slugify(""), "");
  assert.equal(text.slugify("Q3 2024 report.final"), "q3-2024-report-final");

  for (const name of ["Order Status", "orderStatus", "order-status", "order_status", "  ORDER   STATUS "]) assert.equal(text.toSnakeCase(name), "order_status", name);
  assert.equal(text.toSnakeCase("HTTPServer"), "http_server");
  assert.equal(text.toSnakeCase("version2Beta"), "version2_beta");
  assert.equal(text.toSnakeCase("getHTTPResponseCode"), "get_http_response_code");
  assert.equal(text.toSnakeCase(""), "");
  assert.equal(text.toSnakeCase("!!!"), "");

  assert.equal(text.toCamelCase("order status"), "orderStatus");
  assert.equal(text.toCamelCase("Order_Status"), "orderStatus");
  assert.equal(text.toCamelCase("HTTP server"), "httpServer");
  assert.equal(text.toCamelCase("order"), "order");
  assert.equal(text.toCamelCase(""), "");

  assert.equal(text.toKebabCase("Order Status"), "order-status");
  assert.equal(text.toKebabCase("orderStatus"), "order-status");
  assert.equal(text.toKebabCase(`Cr${cp(0xE8)}me Br${cp(0xFB)}l${E_ACUTE}e`), `cr${cp(0xE8)}me-br${cp(0xFB)}l${E_ACUTE}e`);

  for (const name of ["order_status", "orderStatus", "ORDER STATUS", "order-status"]) assert.equal(text.toTitleCase(name), "Order Status", name);
  assert.equal(text.toTitleCase("is_refund"), "Is Refund");
  assert.equal(text.toTitleCase(""), "");
  assert.equal(text.isTitleCase(text.toTitleCase("some_long_fieldName")), true);
});

test("isIdentifier and uniqueName", () => {
  for (const yes of ["a", "_", "_a1", "a_b", "Order2"]) assert.equal(text.isIdentifier(yes), true, yes);
  for (const no of ["", "1a", "a-b", "a b", "a.b", E_ACUTE, "a\n"]) assert.equal(text.isIdentifier(no), false, JSON.stringify(no));

  assert.equal(text.uniqueName("row", []), "row");
  assert.equal(text.uniqueName("row", ["other"]), "row");
  assert.equal(text.uniqueName("row", ["row"]), "row_2");
  assert.equal(text.uniqueName("row", ["row", "row_2", "row_3"]), "row_4");
  assert.equal(text.uniqueName("row", ["row", "row_3"]), "row_2");
  assert.equal(text.uniqueName("row", new Set(["row", "row_2"])), "row_3");
  assert.equal(text.uniqueName("row", new Map([["row", 1]])), "row_2");
  assert.equal(text.uniqueName("row", { row: true, row_2: true }), "row_3");
  assert.equal(text.uniqueName("row", null), "row");
  assert.equal(text.uniqueName("row", undefined), "row");
  assert.equal(text.uniqueName("row", "row"), "row");
  assert.equal(text.uniqueName(null, [""]), "_2");
  assert.equal(text.uniqueName(7, [7]), "7_2");
});

// ---------- comparison ----------

test("levenshtein and similarity", () => {
  // kitten/sitting = 3, flaw/lawn = 2 and Saturday/Sunday = 3 are the standard textbook examples; intention/execution
  // = 5 is Jurafsky and Martin's example at unit substitution cost. All were also checked with a full-matrix
  // dynamic program in Python, which gave the last three values too.
  assert.equal(text.levenshtein("kitten", "sitting"), 3);
  assert.equal(text.levenshtein("flaw", "lawn"), 2);
  assert.equal(text.levenshtein("Saturday", "Sunday"), 3);
  assert.equal(text.levenshtein("intention", "execution"), 5);
  assert.equal(text.levenshtein(CAFE, "cafe"), 1);
  assert.equal(text.levenshtein(`${GRIN}a`, `${cp(0x1F601)}a`), 1);   // one code point differs, although two UTF-16 units share a half
  assert.equal(text.levenshtein("refund order", "refund my order"), 3);
  assert.equal(text.levenshtein("", ""), 0);
  assert.equal(text.levenshtein("", "abc"), 3);
  assert.equal(text.levenshtein("abc", ""), 3);
  assert.equal(text.levenshtein("abc", "abc"), 0);
  assert.equal(text.levenshtein("abc", "ABC"), 3);
  assert.equal(text.levenshtein(null, "ab"), 2);
  assert.equal(text.levenshtein("sitting", "kitten"), 3);
  assert.equal(text.levenshtein("a".repeat(300), "b".repeat(200)), 300);   // nothing matches: 200 substitutions + 100 deletions

  assert.equal(text.similarity("", ""), 1);
  assert.equal(text.similarity("abc", "abc"), 1);
  assert.equal(text.similarity("abc", ""), 0);
  assert.equal(text.similarity("abc", "xyz"), 0);
  assert.equal(text.similarity("kitten", "sitting"), 1 - 3 / 7);
  assert.equal(text.similarity("flaw", "lawn"), 0.5);
  assert.equal(text.similarity(null, undefined), 1);
});

test("jaccard, commonPrefix, commonSuffix and ngrams", () => {
  // Set sizes counted by hand: {a, b, c} and {b, c, d} share 2 of 4.
  assert.equal(text.jaccard("a b c", "b c d"), 0.5);
  assert.equal(text.jaccard("Refund, please.", "please refund"), 1);
  assert.equal(text.jaccard("A a a", "a"), 1);
  assert.equal(text.jaccard("", ""), 1);
  assert.equal(text.jaccard("a", ""), 0);
  assert.equal(text.jaccard("a b", "c d"), 0);
  assert.equal(text.jaccard("late order", "late order refund now"), 0.5);
  assert.equal(text.jaccard("...", "!!!"), 1);                         // neither side has a word

  assert.equal(text.commonPrefix(["interview", "internet", "interval"]), "inter");
  assert.equal(text.commonPrefix(["abc"]), "abc");
  assert.equal(text.commonPrefix(["abc", "xyz"]), "");
  assert.equal(text.commonPrefix(["abc", ""]), "");
  assert.equal(text.commonPrefix([]), "");
  assert.equal(text.commonPrefix(["ab", null]), "");
  assert.equal(text.commonPrefix([`${GRIN}a`, `${cp(0x1F601)}a`]), "");   // the shared high surrogate is not a prefix
  assert.equal(text.commonPrefix([`x${GRIN}a`, `x${GRIN}b`]), `x${GRIN}`);
  assert.equal(text.commonPrefix("abc"), null);
  assert.equal(text.commonPrefix(null), null);

  assert.equal(text.commonSuffix(["testing", "running", "ring"]), "ing");
  assert.equal(text.commonSuffix(["abc"]), "abc");
  assert.equal(text.commonSuffix(["abc", "xbd"]), "");
  assert.equal(text.commonSuffix([]), "");
  assert.equal(text.commonSuffix([`a${GRIN}`, `a${cp(0x1FA00)}`]), "");   // U+1F600 and U+1FA00 share only their low surrogate
  assert.equal(text.commonSuffix([`a${GRIN}`, `b${GRIN}`]), GRIN);
  assert.equal(text.commonSuffix({}), null);

  assert.deepEqual(text.ngrams("a b c d", 2), ["a b", "b c", "c d"]);
  assert.deepEqual(text.ngrams("a b c d", 1), ["a", "b", "c", "d"]);
  assert.deepEqual(text.ngrams("a b c d", 4), ["a b c d"]);
  assert.deepEqual(text.ngrams("a b c d", 5), []);
  assert.deepEqual(text.ngrams("", 1), []);
  assert.deepEqual(text.ngrams("The  late\norder", 2), ["The late", "late order"]);
  assert.equal(text.ngrams("a b", 0), null);
  assert.equal(text.ngrams("a b", -1), null);
  assert.equal(text.ngrams("a b", 1.5), null);
  assert.equal(text.ngrams("a b", "2"), null);
  assert.equal(text.ngrams("a b", NaN), null);
});

// ---------- finding things ----------

test("findEmails", () => {
  // Read off the sample text by eye.
  assert.deepEqual(text.findEmails("Write to ana@harbor.example, or Bo.Li+orders@mail.harbor.example."), ["ana@harbor.example", "Bo.Li+orders@mail.harbor.example"]);
  assert.deepEqual(text.findEmails("<ana@harbor.example> (ana@harbor.example)"), ["ana@harbor.example", "ana@harbor.example"]);
  assert.deepEqual(text.findEmails("mailto:orders@harbor.example?subject=x"), ["orders@harbor.example"]);
  assert.deepEqual(text.findEmails("no at sign here"), []);
  assert.deepEqual(text.findEmails("a@b and @harbor.example and ana@ and a@.example"), []);
  assert.deepEqual(text.findEmails("see ...ana@harbor.example"), ["ana@harbor.example"]);
  assert.deepEqual(text.findEmails("ana.@harbor.example"), []);
  assert.deepEqual(text.findEmails("ana@harbor-.example ana@harbor.example-"), []);
  assert.deepEqual(text.findEmails(""), []);
  assert.deepEqual(text.findEmails("@".repeat(5000)), []);
});

test("findUrls", () => {
  assert.deepEqual(text.findUrls("See https://harbor.example/menu?x=1. Or (http://harbor.example/a_(b)) and www.harbor.example, ok"),
    ["https://harbor.example/menu?x=1", "http://harbor.example/a_(b)", "www.harbor.example"]);
  assert.deepEqual(text.findUrls('<a href="https://harbor.example/x">link</a>'), ["https://harbor.example/x"]);
  assert.deepEqual(text.findUrls("HTTPS://HARBOR.EXAMPLE/A!"), ["HTTPS://HARBOR.EXAMPLE/A"]);
  assert.deepEqual(text.findUrls("[menu](https://harbor.example/menu)"), ["https://harbor.example/menu"]);
  assert.deepEqual(text.findUrls("https:// and http://. and www. and ftp://harbor.example and awww.harbor.example"), []);
  assert.deepEqual(text.findUrls(""), []);
});

test("findNumbers", () => {
  // Read off the sample text by eye, using the rules in the function's comment.
  assert.deepEqual(text.findNumbers("Order 3 items for $1,234.50, then -2 and 5 -3; 1e3, .5, 2024-01-15, item-2, 1,2,3"),
    [3, 1234.5, -2, 5, -3, 1000, 0.5, 2024, 1, 15, 2, 1, 2, 3]);
  assert.deepEqual(text.findNumbers("1.2.3"), [1.2, 3]);
  assert.deepEqual(text.findNumbers("12,345,678"), [12345678]);
  assert.deepEqual(text.findNumbers("1,2345"), [1, 2345]);
  assert.deepEqual(text.findNumbers("(-3)"), [-3]);
  assert.deepEqual(text.findNumbers(`${cp(0x2212)}4`), [-4]);
  assert.deepEqual(text.findNumbers("85% of 2.5E-3"), [85, 0.0025]);
  assert.deepEqual(text.findNumbers("1e999 and 7"), [7]);
  assert.deepEqual(text.findNumbers("no digits"), []);
  assert.deepEqual(text.findNumbers(""), []);
  assert.deepEqual(text.findNumbers(42), [42]);
  assert.ok(Object.is(text.findNumbers("-0")[0], 0));
  assert.ok(text.findNumbers("9".repeat(400)).every(Number.isFinite));
});

test("findPhoneNumbers", () => {
  assert.deepEqual(text.findPhoneNumbers("Call +1 (555) 010-0199 or 555-0100, fax 5550100199."), ["+1 (555) 010-0199", "555-0100", "5550100199"]);
  assert.deepEqual(text.findPhoneNumbers("020 7946 0958"), ["020 7946 0958"]);
  assert.deepEqual(text.findPhoneNumbers("555.010.0199"), ["555.010.0199"]);
  for (const none of ["Order #12345678", "on 2024-01-15 at noon", "pi is 3.14159265", "host 192.168.100.200", "ORD12345678", "123456", "1234567890123456",
    "1,234,567", "$12345678", "12345678th", ""]) assert.deepEqual(text.findPhoneNumbers(none), [], none);
});

test("findIsoDates keeps only real calendar dates", () => {
  // 2024 and 2000 are leap years; 2023 and 1900 are not (Gregorian rule); April has 30 days.
  assert.deepEqual(text.findIsoDates("From 2024-02-29 to 2023-02-29, 2024-13-01, 2024-04-31, 12024-01-01, 2024-01-15T10:30:00Z, 1900-02-29 and 2000-02-29"),
    ["2024-02-29", "2024-01-15", "2000-02-29"]);
  assert.deepEqual(text.findIsoDates("2024-01-150 2024-00-10 2024-01-00 2024-1-5 20240115"), []);
  assert.deepEqual(text.findIsoDates("2024-12-31 2024-12-31"), ["2024-12-31", "2024-12-31"]);
  assert.deepEqual(text.findIsoDates(""), []);
});

test("findPlaceholders, placeholderName and findBackticked", () => {
  assert.deepEqual(text.findPlaceholders('Hi {name}, {{ first_name }} <order_id> [ORDER ID] [1] [see below] {"a": 1} {{x}} {order.id}'),
    ["{name}", "{{ first_name }}", "<order_id>", "[ORDER ID]", "{{x}}", "{order.id}"]);
  assert.deepEqual(text.findPlaceholders("{} { name } </b> [lower] {1} a < b > c"), []);
  assert.deepEqual(text.findPlaceholders("[A] [FIRST-NAME] [X_1]"), ["[A]", "[FIRST-NAME]", "[X_1]"]);
  assert.deepEqual(text.findPlaceholders(""), []);
  assert.equal(text.placeholderName("{{ first_name }}"), "first_name");
  assert.equal(text.placeholderName("{name}"), "name");
  assert.equal(text.placeholderName("<order_id>"), "order_id");
  assert.equal(text.placeholderName("[ORDER ID]"), "ORDER ID");
  assert.equal(text.placeholderName("  plain "), "plain");
  assert.equal(text.placeholderName(""), "");
  assert.deepEqual(text.findPlaceholders("Dear {{name}}, re [ORDER ID]").map(text.placeholderName), ["name", "ORDER ID"]);

  assert.deepEqual(text.findBackticked("Use `foo` and `bar baz`, not `` or `a\nb`."), ["foo", "bar baz"]);
  assert.deepEqual(text.findBackticked("``a ` b`` and `` `c` ``"), ["a ` b", "`c`"]);
  assert.deepEqual(text.findBackticked("```js\nlet x = 1;\n```"), []);
  assert.deepEqual(text.findBackticked("`x` `x`"), ["x", "x"]);
  assert.deepEqual(text.findBackticked("no code"), []);
  assert.deepEqual(text.findBackticked(""), []);
});

// ---------- misc ----------

test("escapeRegExp makes any text match itself literally", () => {
  assert.equal(text.escapeRegExp("a.b*c"), "a\\.b\\*c");
  assert.equal(text.escapeRegExp("plain"), "plain");
  assert.equal(text.escapeRegExp(""), "");
  for (const sample of [".*+?^${}()|[]\\/-", "1+1=2?", "[NAME] (x|y) $5.00 \\d", `${CAFE} ${GRIN}`]) {
    for (const flags of ["", "u"]) {
      const pattern = new RegExp(`^${text.escapeRegExp(sample)}$`, flags);
      assert.equal(pattern.test(sample), true, sample);
      assert.equal(pattern.test(`${sample}x`), false, sample);
    }
  }
  assert.equal(new RegExp(text.escapeRegExp("a.c")).test("abc"), false);
});

test("countOccurrences", () => {
  // Counted by hand; matches do not overlap.
  assert.equal(text.countOccurrences("banana", "an"), 2);
  assert.equal(text.countOccurrences("aaa", "aa"), 1);
  assert.equal(text.countOccurrences("aaaa", "aa"), 2);
  assert.equal(text.countOccurrences("Banana", "b"), 0);
  assert.equal(text.countOccurrences("Banana", "b", { caseSensitive: false }), 1);
  assert.equal(text.countOccurrences("Banana BANANA", "ANA", { caseSensitive: false }), 2);
  assert.equal(text.countOccurrences("Banana", "B", { caseSensitive: true }), 1);
  assert.equal(text.countOccurrences("abc", ""), 0);
  assert.equal(text.countOccurrences("", "a"), 0);
  assert.equal(text.countOccurrences("a.b.c", "."), 2);
  assert.equal(text.countOccurrences("abc", "c", null), 1);
  assert.equal(text.countOccurrences(null, null), 0);
  assert.equal(text.countOccurrences(101, 1), 2);
});

test("truncate cuts by code points and never exceeds max", () => {
  const ELLIPSIS = cp(0x2026);
  assert.equal(text.truncate("Hello world", 8), `Hello w${ELLIPSIS}`);
  assert.equal(text.truncate("Hello", 5), "Hello");
  assert.equal(text.truncate("Hello", 10), "Hello");
  assert.equal(text.truncate(GRIN.repeat(4), 3), `${GRIN}${GRIN}${ELLIPSIS}`);
  assert.equal(text.truncate("Hello world", 8, "..."), "Hello...");
  assert.equal(text.truncate("Hello world", 8, ""), "Hello wo");
  assert.equal(text.truncate("Hello", 0), "");
  assert.equal(text.truncate("Hello", 1), ELLIPSIS);
  assert.equal(text.truncate("Hello", 2, "..."), "..");
  assert.equal(text.truncate("", 0), "");
  assert.equal(text.truncate(null, 3), "");
  assert.equal(text.truncate("Hello", -1), null);
  assert.equal(text.truncate("Hello", 1.5), null);
  assert.equal(text.truncate("Hello", NaN), null);
  assert.equal(text.truncate("Hello", "3"), null);
  assert.equal(text.truncate("Hello"), null);
  for (let max = 0; max <= 12; max += 1) assert.ok(text.codePoints(text.truncate(`${GRIN} Hello world`, max)) <= max);
});

test("fingerprint is FNV-1a 32-bit over UTF-8", () => {
  // "", "a", "b" and "foobar" are from the published FNV test vectors (Noll's test suite, FNV-1a 32-bit). The rest
  // were computed in Python with the defining loop: h = 0x811c9dc5; for each utf-8 byte: h ^= byte; h = h * 0x01000193 mod 2^32.
  assert.equal(text.fingerprint(""), "811c9dc5");
  assert.equal(text.fingerprint("a"), "e40c292c");
  assert.equal(text.fingerprint("b"), "e70c2de5");
  assert.equal(text.fingerprint("foobar"), "bf9cf968");
  assert.equal(text.fingerprint("Harbor Coffee Co."), "3fa9f79d");
  assert.equal(text.fingerprint(`${CAFE} ${cp(0x2615)}`), "52bdf2b4");
  assert.equal(text.fingerprint(GRIN), "33a29608");
  assert.equal(text.fingerprint(LONE_SURROGATE), "03479c4a");   // hashed as U+FFFD
  assert.equal(text.fingerprint(null), "811c9dc5");
  assert.match(text.fingerprint("x".repeat(10000)), /^[0-9a-f]{8}$/);
  assert.notEqual(text.fingerprint("ab"), text.fingerprint("ba"));
});

test("pluralize", () => {
  assert.equal(text.pluralize(1, "row"), "1 row");
  assert.equal(text.pluralize(0, "row"), "0 rows");
  assert.equal(text.pluralize(3, "row"), "3 rows");
  assert.equal(text.pluralize(2, "query", "queries"), "2 queries");
  assert.equal(text.pluralize(1, "query", "queries"), "1 query");
  assert.equal(text.pluralize(1.5, "hour"), "1.5 hours");
  assert.equal(text.pluralize(-1, "row"), "-1 rows");
  assert.equal(text.pluralize(NaN, "row"), null);
  assert.equal(text.pluralize(Infinity, "row"), null);
  assert.equal(text.pluralize("3", "row"), null);
  assert.equal(text.pluralize(null, "row"), null);
});
