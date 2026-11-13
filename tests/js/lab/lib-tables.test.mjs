// static/js/lab/lib/tables.js: the shared table helpers Lab packs import. Run with: node --test tests/js/lab/lib-tables.test.mjs
// Every expected value is written out by hand from the format's own rules (RFC 4180 for delimited text, including
// its section 2 examples; the JSON Lines and GitHub Markdown table conventions; hand-counted column widths), never
// copied from the output of the code under test. Round trips are checked against the input, not against a printout.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as tables from "../../../static/js/lab/lib/tables.js";

const BOM = String.fromCharCode(0xFEFF);

test("the module exports exactly the documented names", () => {
  assert.deepEqual(Object.keys(tables).sort(), ["cellText", "columnValues", "distinctCounts", "formatDelimited", "formatHtmlTable", "formatJsonl",
    "formatMarkdownTable", "formatTextTable", "objectsToRows", "parseDelimited", "parseJsonl", "parseMarkdownTable", "rowsToObjects", "sniffDelimiter",
    "transpose"]);
});

test("cellText turns any cell into text", () => {
  assert.equal(tables.cellText(null), "");
  assert.equal(tables.cellText(undefined), "");
  assert.equal(tables.cellText("x"), "x");
  assert.equal(tables.cellText(5), "5");
  assert.equal(tables.cellText(-0.5), "-0.5");
  assert.equal(tables.cellText(true), "true");
  assert.equal(tables.cellText(10n), "10");
  assert.equal(tables.cellText({ a: 1 }), '{"a":1}');
  assert.equal(tables.cellText([1, "a"]), '[1,"a"]');
  assert.equal(tables.cellText(new Date(0)), "1970-01-01T00:00:00.000Z");   // the Unix epoch in ISO 8601
  assert.equal(tables.cellText(new Date(NaN)), "");
  const cycle = {};
  cycle.self = cycle;
  assert.equal(tables.cellText(cycle), "[object Object]");
});

// ---------- delimited text ----------

test("parseDelimited follows RFC 4180", () => {
  // RFC 4180 section 2, rules 1 to 3: records end at CRLF, and the last one may have no line break.
  assert.deepEqual(tables.parseDelimited("aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n"), [["aaa", "bbb", "ccc"], ["zzz", "yyy", "xxx"]]);
  assert.deepEqual(tables.parseDelimited("aaa,bbb,ccc\r\nzzz,yyy,xxx"), [["aaa", "bbb", "ccc"], ["zzz", "yyy", "xxx"]]);
  // Rule 5: fields may be quoted. Rule 6: quoted fields may hold line breaks and commas. Rule 7: "" is one quote.
  assert.deepEqual(tables.parseDelimited('"aaa","bbb","ccc"\r\nzzz,yyy,xxx'), [["aaa", "bbb", "ccc"], ["zzz", "yyy", "xxx"]]);
  assert.deepEqual(tables.parseDelimited('"aaa","b\r\nbb","ccc"\r\nzzz,yyy,xxx'), [["aaa", "b\r\nbb", "ccc"], ["zzz", "yyy", "xxx"]]);
  assert.deepEqual(tables.parseDelimited('"aaa","b""bb","ccc"'), [["aaa", 'b"bb', "ccc"]]);
  assert.deepEqual(tables.parseDelimited('name,note\n"Lee, Ana","said ""hi""\nthen left"\n'), [["name", "note"], ["Lee, Ana", 'said "hi"\nthen left']]);
  // Rule 4: spaces are part of a field.
  assert.deepEqual(tables.parseDelimited(" a , b "), [[" a ", " b "]]);
});

test("parseDelimited edge cases", () => {
  assert.deepEqual(tables.parseDelimited(""), []);
  assert.deepEqual(tables.parseDelimited(null), []);
  assert.deepEqual(tables.parseDelimited("a"), [["a"]]);
  assert.deepEqual(tables.parseDelimited("a\n"), [["a"]]);
  assert.deepEqual(tables.parseDelimited("a,b\n\nc"), [["a", "b"], [""], ["c"]]);
  assert.deepEqual(tables.parseDelimited("a\n\n"), [["a"], [""]]);
  assert.deepEqual(tables.parseDelimited("\n"), [[""]]);
  assert.deepEqual(tables.parseDelimited(",\n"), [["", ""]]);
  assert.deepEqual(tables.parseDelimited("a,"), [["a", ""]]);
  assert.deepEqual(tables.parseDelimited('""'), [[""]]);
  assert.deepEqual(tables.parseDelimited('"",""\n'), [["", ""]]);
  assert.deepEqual(tables.parseDelimited("a\rb\r"), [["a"], ["b"]]);
  assert.deepEqual(tables.parseDelimited("a,b\n1\n1,2,3"), [["a", "b"], ["1"], ["1", "2", "3"]]);
  assert.deepEqual(tables.parseDelimited(`${BOM}a,b\n1,2`), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(tables.parseDelimited(`${BOM}"a",b`), [["a", "b"]]);
  assert.deepEqual(tables.parseDelimited("a\tb\n1\t2", "\t"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(tables.parseDelimited('a;"b;c";d', ";"), [["a", "b;c", "d"]]);
  assert.deepEqual(tables.parseDelimited("a,b;c", ";"), [["a,b", "c"]]);
  assert.deepEqual(tables.parseDelimited("a|b", "|"), [["a", "b"]]);
  // Lenient with broken quoting.
  assert.deepEqual(tables.parseDelimited('a"b,c'), [['a"b', "c"]]);
  assert.deepEqual(tables.parseDelimited('"abc'), [["abc"]]);
  assert.deepEqual(tables.parseDelimited('"a"b,c'), [["ab", "c"]]);
  assert.deepEqual(tables.parseDelimited('"a,b\nc'), [["a,b\nc"]]);
  for (const bad of ["", ",,", '"', "\n", "\r", 5, null, {}]) assert.equal(tables.parseDelimited("a,b", bad), null, JSON.stringify(bad));
  assert.deepEqual(tables.parseDelimited("a,b", undefined), [["a", "b"]]);
  const big = tables.parseDelimited("x,y\n".repeat(20000));
  assert.equal(big.length, 20000);
  assert.deepEqual(big[19999], ["x", "y"]);
});

test("formatDelimited quotes only when needed", () => {
  assert.equal(tables.formatDelimited([["a", "b"], ["1", "2"]]), "a,b\r\n1,2\r\n");
  assert.equal(tables.formatDelimited([["Lee, Ana", 'said "hi"', "two\nlines", " pad "]]), '"Lee, Ana","said ""hi""","two\nlines", pad \r\n');
  assert.equal(tables.formatDelimited([["a,b", "c;d"]], ";"), 'a,b;"c;d"\r\n');
  assert.equal(tables.formatDelimited([["a\tb", "c"]], "\t"), '"a\tb"\tc\r\n');
  assert.equal(tables.formatDelimited([["a", "b"], ["1", "2"]], ",", { newline: "\n" }), "a,b\n1,2\n");
  assert.equal(tables.formatDelimited([["a"], ["b"]], ",", { newline: "\r" }), "a\rb\r");
  assert.equal(tables.formatDelimited([["a"]], ",", { newline: "; " }), "a\r\n");
  assert.equal(tables.formatDelimited([[{ a: 1 }, [1, 2], null, undefined, 1.5, false]]), '"{""a"":1}","[1,2]",,,1.5,false\r\n');
  assert.equal(tables.formatDelimited([]), "");
  assert.equal(tables.formatDelimited([[]]), "\r\n");
  assert.equal(tables.formatDelimited(["x", ["y"]]), "x\r\ny\r\n");
  assert.equal(tables.formatDelimited([["a"]], ",", null), "a\r\n");
  assert.equal(tables.formatDelimited(null), null);
  assert.equal(tables.formatDelimited("a,b"), null);
  assert.equal(tables.formatDelimited([["a"]], ""), null);
  assert.equal(tables.formatDelimited([["a"]], "ab"), null);
  assert.equal(tables.formatDelimited([["a"]], '"'), null);
});

test("formatDelimited neutralizes spreadsheet formulas unless told to keep them", () => {
  // The rule in the spec: text starting with = + - @ (optionally after whitespace) or with tab, CR or LF gets a
  // leading apostrophe. Numbers are data, so -5 stays -5.
  assert.equal(tables.formatDelimited([["=SUM(A1)", "+1", "-1", "@x", "  =1", "\tx", "a=b", -5, 5, true]]), "'=SUM(A1),'+1,'-1,'@x,'  =1,'\tx,a=b,-5,5,true\r\n");
  assert.equal(tables.formatDelimited([["\nx", "\rx", " \t-2"]]), "\"'\nx\",\"'\rx\",' \t-2\r\n");
  assert.equal(tables.formatDelimited([['=HYPERLINK("http://harbor.example","x")']]), "\"'=HYPERLINK(\"\"http://harbor.example\"\",\"\"x\"\")\"\r\n");
  assert.equal(tables.formatDelimited([["=1", "-1"]], ",", { formulas: "keep" }), "=1,-1\r\n");
  assert.equal(tables.formatDelimited([["=1"]], ",", { formulas: "escape" }), "'=1\r\n");
  assert.equal(tables.formatDelimited([["=1"]], ",", { formulas: "anything else" }), "'=1\r\n");
  assert.equal(tables.formatDelimited([["=1"]], ",", {}), "'=1\r\n");
  assert.equal(tables.formatDelimited([["plain", "1-2", "a@harbor.example", ""]]), "plain,1-2,a@harbor.example,\r\n");
});

test("delimited text round-trips", () => {
  const rows = [["id", "note", "more"], ["1", 'He said "no", twice', "line one\r\nline two"], ["2", "", " spaced "], ["3", "semi;colon|pipe\ttab", "'quoted'"], [""]];
  for (const delimiter of [",", ";", "\t", "|"]) {
    for (const newline of ["\r\n", "\n", "\r"]) {
      assert.deepEqual(tables.parseDelimited(tables.formatDelimited(rows, delimiter, { newline }), delimiter), rows, JSON.stringify([delimiter, newline]));
    }
  }
});

test("sniffDelimiter picks the delimiter most lines agree on", () => {
  assert.equal(tables.sniffDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(tables.sniffDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(tables.sniffDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(tables.sniffDelimiter("a|b\r\n1|2\r\n"), "|");
  assert.equal(tables.sniffDelimiter("name;note\nAna;hello, world\nBo;a, b, c"), ";");      // ; is 1 on all 3 lines, commas are 0, 1, 2
  assert.equal(tables.sniffDelimiter('a;b\n"x,y,z";2\n"p,q";3'), ";");                       // commas inside quotes do not count
  assert.equal(tables.sniffDelimiter('id\tnote\n1\t"a, b\nc, d"\n2\tx'), "\t");              // a quoted line break does not split the line
  assert.equal(tables.sniffDelimiter("a,b;c\n1,2;3"), ",");                                  // a tie goes to the earlier candidate
  assert.equal(tables.sniffDelimiter("a;b;c,d\n1;2;3,4"), ";");                              // equal agreement: more columns wins
  assert.equal(tables.sniffDelimiter(`${BOM}a;b\n1;2`), ";");
  assert.equal(tables.sniffDelimiter("\n\na|b\n\n1|2\n"), "|");
  assert.equal(tables.sniffDelimiter(""), ",");
  assert.equal(tables.sniffDelimiter("no delimiters here"), ",");
  assert.equal(tables.sniffDelimiter(null), ",");
});

// ---------- rows and objects ----------

test("rowsToObjects keys rows by the header", () => {
  assert.deepEqual(tables.rowsToObjects([["id", "name"], ["1", "Ana"], ["2"]]), [{ id: "1", name: "Ana" }, { id: "2", name: "" }]);
  assert.deepEqual(tables.rowsToObjects([["a", "a", "a_2", "a"], ["1", "2", "3", "4"]]), [{ a: "1", a_2: "2", a_2_2: "3", a_3: "4" }]);
  assert.deepEqual(tables.rowsToObjects([["id", ""], ["1", "x", "y"]]), [{ id: "1", column_2: "x", column_3: "y" }]);
  assert.deepEqual(tables.rowsToObjects([["id", "n"], [1, null]]), [{ id: 1, n: "" }]);
  assert.deepEqual(Object.keys(tables.rowsToObjects([["b", "a", "c"], ["1", "2", "3"]])[0]), ["b", "a", "c"]);
  assert.deepEqual(tables.rowsToObjects([["a"]]), []);
  assert.deepEqual(tables.rowsToObjects([]), []);
  assert.equal(tables.rowsToObjects(null), null);
  assert.equal(tables.rowsToObjects("a,b"), null);
  const [risky] = tables.rowsToObjects([["__proto__", "x"], ["polluted", "1"]]);
  assert.deepEqual(Object.keys(risky), ["__proto__", "x"]);
  assert.equal(Object.getPrototypeOf(risky), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test("objectsToRows unions the keys in first-seen order", () => {
  assert.deepEqual(tables.objectsToRows([{ id: 1, name: "Ana" }, { name: "Bo", tags: ["a", "b"], meta: { k: null } }, { id: null }]),
    [["id", "name", "tags", "meta"], ["1", "Ana", "", ""], ["", "Bo", '["a","b"]', '{"k":null}'], ["", "", "", ""]]);
  assert.deepEqual(tables.objectsToRows([]), [[]]);
  assert.deepEqual(tables.objectsToRows([{}]), [[], []]);
  assert.deepEqual(tables.objectsToRows([5, "x", { value: "y", other: true }, [1]]), [["value", "other"], ["5", ""], ["x", ""], ["y", "true"], ["[1]", ""]]);
  assert.equal(tables.objectsToRows(null), null);
  assert.equal(tables.objectsToRows({ a: 1 }), null);
  const objects = [{ id: "1", note: "a, b" }, { id: "2", note: "" }];
  assert.deepEqual(tables.rowsToObjects(tables.objectsToRows(objects)), objects);
  assert.deepEqual(tables.rowsToObjects(tables.parseDelimited(tables.formatDelimited(tables.objectsToRows(objects)))), objects);
});

// ---------- JSON Lines ----------

test("parseJsonl collects rows and line-numbered errors", () => {
  const parsed = tables.parseJsonl('{"a":1}\n\n[1,2]\r\n"x"\n{bad}\n  \n7');
  assert.deepEqual(parsed.rows, [{ a: 1 }, [1, 2], "x", 7]);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, 5);                     // counted by hand: lines 1, 3, 4 and 7 are valid, 2 and 6 blank
  assert.equal(typeof parsed.errors[0].message, "string");
  assert.ok(parsed.errors[0].message.length > 0);
  assert.deepEqual(Object.keys(parsed.errors[0]), ["line", "message"]);
  assert.deepEqual(tables.parseJsonl(""), { rows: [], errors: [] });
  assert.deepEqual(tables.parseJsonl(null), { rows: [], errors: [] });
  assert.deepEqual(tables.parseJsonl("\n\n"), { rows: [], errors: [] });
  assert.deepEqual(tables.parseJsonl(`${BOM}{"a":1}`), { rows: [{ a: 1 }], errors: [] });
  assert.deepEqual(tables.parseJsonl("null\nfalse\n0").rows, [null, false, 0]);
  assert.deepEqual(tables.parseJsonl("x\ny\r\n{}\rz").errors.map((error) => error.line), [1, 2, 4]);
});

test("formatJsonl writes one compact value per line", () => {
  assert.equal(tables.formatJsonl([{ a: 1 }, [1, 2], "x", null, undefined, () => 1]), '{"a":1}\n[1,2]\n"x"\nnull\nnull\nnull\n');
  assert.equal(tables.formatJsonl([{ text: "two\nlines" }]), '{"text":"two\\nlines"}\n');
  assert.equal(tables.formatJsonl([]), "");
  assert.equal(tables.formatJsonl(null), null);
  assert.equal(tables.formatJsonl({}), null);
  const cycle = {};
  cycle.self = cycle;
  assert.equal(tables.formatJsonl([cycle, 1]), "null\n1\n");
  const values = [{ id: 1, tags: ["a"], note: "line\nbreak" }, [null, true], "text", 3.5, null];
  assert.deepEqual(tables.parseJsonl(tables.formatJsonl(values)), { rows: values, errors: [] });
});

// ---------- Markdown ----------

test("parseMarkdownTable reads pipe tables", () => {
  assert.deepEqual(tables.parseMarkdownTable("| Name | Qty |\n| :--- | ---: |\n| Latte | 2 |\n| A \\| B | |"),
    { columns: ["Name", "Qty"], rows: [["Latte", "2"], ["A | B", ""]] });
  assert.deepEqual(tables.parseMarkdownTable("Name | Qty\n--- | ---\nLatte | 2"), { columns: ["Name", "Qty"], rows: [["Latte", "2"]] });
  assert.deepEqual(tables.parseMarkdownTable("a | b\n1 | 2\n3 | 4"), { columns: ["a", "b"], rows: [["1", "2"], ["3", "4"]] });
  assert.deepEqual(tables.parseMarkdownTable("| a | b |\n|:-:|-|"), { columns: ["a", "b"], rows: [] });
  assert.deepEqual(tables.parseMarkdownTable("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |"), { columns: ["a", "b"], rows: [["1", ""], ["1", "2"]] });
  assert.deepEqual(tables.parseMarkdownTable("\n\n  | a |\r\n  | --- |\r\n  | 1 |\n\n"), { columns: ["a"], rows: [["1"]] });
  assert.deepEqual(tables.parseMarkdownTable("| a | b |\n| --- | --- |\n| --- | x |"), { columns: ["a", "b"], rows: [["---", "x"]] });
  for (const not of ["", "just text", "one | line", "a | b\n\nplain text", "a | b\nno pipe here", "a \\| b\nc \\| d", null]) {
    assert.equal(tables.parseMarkdownTable(not), null, JSON.stringify(not));
  }
});

test("formatMarkdownTable escapes pipes and line breaks", () => {
  assert.equal(tables.formatMarkdownTable(["Name", "Note"], [["Latte", "a|b"], ["Tea", "two\nlines"], ["Short"], [1, null, "extra"]]),
    "| Name | Note |\n| --- | --- |\n| Latte | a\\|b |\n| Tea | two<br>lines |\n| Short |  |\n| 1 |  |");
  assert.equal(tables.formatMarkdownTable(["Only"], []), "| Only |\n| --- |");
  assert.equal(tables.formatMarkdownTable(["A"], [["x\r\ny\rz"]]), "| A |\n| --- |\n| x<br>y<br>z |");
  assert.equal(tables.formatMarkdownTable([], []), null);
  assert.equal(tables.formatMarkdownTable(null, []), null);
  assert.equal(tables.formatMarkdownTable(["A"], null), null);
  const columns = ["id", "note | with pipe"];
  const rows = [["1", "a | b"], ["2", ""], ["3", "back\\slash and \\| both"]];
  assert.deepEqual(tables.parseMarkdownTable(tables.formatMarkdownTable(columns, rows)), { columns, rows });
});

// ---------- plain text and HTML ----------

test("formatTextTable pads columns and right-aligns numbers", () => {
  // Widths counted by hand: Item 10 ("Flat white"), Qty 3 (the header), Price 6 ("$14.00"); two spaces between columns.
  assert.equal(tables.formatTextTable(["Item", "Qty", "Price"], [["Latte", 2, "$4.50"], ["Flat white", 12, "$14.00"], ["Tea", "", "$3.00"]]), [
    "Item        Qty   Price",
    "----------  ---  ------",
    "Latte         2   $4.50",
    "Flat white   12  $14.00",
    `Tea${" ".repeat(15)}$3.00`,   // 7 to fill Item, 2 between, 3 for the blank Qty, 2 between, 1 to right-align
  ].join("\n"));
  assert.equal(tables.formatTextTable(["A", "B"], [["x", ""], ["yy", "z"]]), "A   B\n--  -\nx\nyy  z");
  assert.equal(tables.formatTextTable(["Share"], [["85%"], ["-3.5"], ["1,200"], [7]]), "Share\n-----\n  85%\n -3.5\n1,200\n    7");
  assert.equal(tables.formatTextTable(["Mixed"], [["12"], ["n/a"]]), "Mixed\n-----\n12\nn/a");
  assert.equal(tables.formatTextTable(["Note"], [["two\nlines\there"], [null]]), "Note\n--------------\ntwo lines here\n");
  assert.equal(tables.formatTextTable(["Face", "N"], [[String.fromCodePoint(0x1F600), 1], ["ab", 22]]), `Face   N\n----  --\n${String.fromCodePoint(0x1F600)}      1\nab    22`);
  assert.equal(tables.formatTextTable(["Empty"], []), "Empty\n-----");
  assert.equal(tables.formatTextTable(["A", "B"], [["only", "x", "dropped"], "bare"]), "A     B\n----  -\nonly  x\nbare");
  assert.equal(tables.formatTextTable([], []), null);
  assert.equal(tables.formatTextTable(null, []), null);
  assert.equal(tables.formatTextTable(["A"], "rows"), null);
});

test("formatHtmlTable escapes every cell", () => {
  assert.equal(tables.formatHtmlTable(["Name", "Note"], [["<b>Ana</b>", "Tom & \"Jerry\" 'x'"], [1]]), [
    "<table>",
    "<thead><tr><th>Name</th><th>Note</th></tr></thead>",
    "<tbody>",
    "<tr><td>&lt;b&gt;Ana&lt;/b&gt;</td><td>Tom &amp; &quot;Jerry&quot; &#39;x&#39;</td></tr>",
    "<tr><td>1</td><td></td></tr>",
    "</tbody>",
    "</table>",
  ].join("\n"));
  assert.equal(tables.formatHtmlTable(["<script>"], []), "<table>\n<thead><tr><th>&lt;script&gt;</th></tr></thead>\n<tbody>\n</tbody>\n</table>");
  const html = tables.formatHtmlTable(["a"], [["<img src=x onerror=alert(1)>"], ["&lt;"]]);
  assert.equal(html.includes("<img"), false);
  assert.ok(html.includes("&amp;lt;"));
  assert.equal(tables.formatHtmlTable([], []), null);
  assert.equal(tables.formatHtmlTable(["a"], null), null);
});

// ---------- operations on rows ----------

test("transpose and columnValues", () => {
  assert.deepEqual(tables.transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
  assert.deepEqual(tables.transpose([[1, 2], [3]]), [[1, 3], [2, ""]]);
  assert.deepEqual(tables.transpose([["a"]]), [["a"]]);
  assert.deepEqual(tables.transpose([]), []);
  assert.deepEqual(tables.transpose([[]]), []);
  assert.deepEqual(tables.transpose(["x", "y"]), [["x", "y"]]);
  assert.equal(tables.transpose(null), null);
  const grid = [["a", "b", "c"], ["d", "e", "f"]];
  assert.deepEqual(tables.transpose(tables.transpose(grid)), grid);

  assert.deepEqual(tables.columnValues([["a", "b"], ["c"], ["d", "e", "f"]], 1), ["b", "", "e"]);
  assert.deepEqual(tables.columnValues([["a", "b"], ["c"]], 0), ["a", "c"]);
  assert.deepEqual(tables.columnValues([["a"]], 5), [""]);
  assert.deepEqual(tables.columnValues([], 0), []);
  assert.equal(tables.columnValues([["a"]], -1), null);
  assert.equal(tables.columnValues([["a"]], 0.5), null);
  assert.equal(tables.columnValues([["a"]], "0"), null);
  assert.equal(tables.columnValues(null, 0), null);
});

test("distinctCounts orders by count, then value", () => {
  // Counted by hand.
  assert.deepEqual(tables.distinctCounts(["b", "a", "b", "c", "a", "b"]), [["b", 3], ["a", 2], ["c", 1]]);
  assert.deepEqual(tables.distinctCounts(["y", "x", "y", "x", "a"]), [["x", 2], ["y", 2], ["a", 1]]);
  assert.deepEqual(tables.distinctCounts([10, 9, 10, 9, 2]), [[9, 2], [10, 2], [2, 1]]);       // numbers compare as numbers: 9 before 10
  assert.deepEqual(tables.distinctCounts([1, "1", 1]), [[1, 2], ["1", 1]]);
  assert.deepEqual(tables.distinctCounts(["a", 5, "B", 3]), [[3, 1], [5, 1], ["B", 1], ["a", 1]]);
  assert.deepEqual(tables.distinctCounts([null, "", null]), [[null, 2], ["", 1]]);
  assert.deepEqual(tables.distinctCounts([]), []);
  assert.equal(tables.distinctCounts(null), null);
  assert.equal(tables.distinctCounts("aab"), null);
});
