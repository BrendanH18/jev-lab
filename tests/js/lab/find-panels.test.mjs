// Tests for static/js/lab/packs/find/find-panels.js on the fixtures of tests/js/lab/fixtures/find.mjs.
// Expected values are worked out by hand from the fixture's where-probabilities (header of fixtures/find.mjs):
//   Sections of the short handbook: before the first heading L000; A L001-L003; B L004-L006; C L007-L008; D L009-L010;
//   E L011-L012. Per question, the sum of its line probabilities in each section (L000 is missing for Q1):
//            before   A      B      C      D      E
//     Q1     —        .03    .02    0      .91    .04
//     Q2     .005     .02    .30    .67    0      .005
//     Q3     .10      0      .83    0      0      .07
//     Q4     .16      .36    0      0      0      .48
//   so the best sections are D, C, B, E and every section gets 5% or more from someone. Section totals over the four
//   questions: before .265, A .41, B 1.15, C .67, D .91, E .595 (B is heaviest).
//   The mixed search: Q1 A .95; Q2 before .14, A .38, B .30, C .08, E .10; Q3 B 1.00 -> A is best for two questions,
//   D gets nothing; A totals .95 + .38 = 1.33.
//   Lines to 80% (likeliest first): Q1 .71,.91 -> 2; Q2 .64,.94 -> 2; Q3 .41,.63,.83 -> 3; Q4 .38,.68,.84 -> 3; mean 2.5.
//   Mixed: Q1 .55,.85 -> 2; Q2 .15,.29,.43,.55,.65,.74,.83 -> 7; Q3 .97 -> 1; mean 10/3.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/find/find-panels.js";
import { DOC_LINES, MIXED_QUERIES, QUERIES, RESULTS, rawSearch, sampleFindResultsCtx } from "./fixtures/find.mjs";
import { checkPack } from "./harness.mjs";

const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const cellsOf = (t, row) => t.findAll(row, (node) => node.tag === "td").map(t.textOf);
const part = (t, root, name) => t.find(root, attr("data-part", name));
const row = (t, root, section) => t.find(root, (node) => node.tag === "tr" && node.attrs?.["data-section"] === section);
const empty = () => sampleFindResultsCtx({ result: null });
const mixed = (extra = {}) => sampleFindResultsCtx({ result: RESULTS.mixed, queries: [...MIXED_QUERIES], ...extra });
const A = "Section A: Hours and scheduling", B = "Section B: Pay and time off", C = "Section C: Leaving Harbor Coffee";
const D = "Section D: Pets", E = "Section E: Contact", BEFORE = "Before the first section";

// Two questions: the first has its top line in Section A (.40) but more probability in Section B (.30 + .30); the
// second's top line and probability are both in Section B.
const split = () => sampleFindResultsCtx({ result: rawSearch(DOC_LINES, ["when do shifts start?", "when is payday?"], [
  { exists: 0.5, confidence: 0.4, probs: { 1: 0.4, 4: 0.3, 5: 0.3 } },
  { exists: 0.9, confidence: 0.9, probs: { 5: 0.9, 4: 0.1 } }]), queries: ["when do shifts start?", "when is payday?"] });

// One question whose every line has probability 0.
const zeros = () => sampleFindResultsCtx({ result: rawSearch(DOC_LINES, ["is there a dress code?"], [{ exists: 0.05, confidence: 0, probs: { 0: 0 } }]),
  queries: ["is there a dress code?"] });

const outlineItems = (t, root, section, kind) => t.findAll(t.find(root, (node) => node.tag === "li" && node.attrs?.["data-section"] === section), has(kind))
  .map((node) => node.attrs[kind]);

checkPack(pack, {
  section_heat: { improvements: {
    table: (t) => {
      const root = t.render(sampleFindResultsCtx());
      assert.deepEqual(t.findAll(root, (node) => node.tag === "tr" && has("data-section")(node)).map((node) => node.attrs["data-section"]), [BEFORE, A, B, C, D, E]);
      assert.deepEqual(cellsOf(t, row(t, root, BEFORE)).slice(0, 5), [BEFORE, "—", "0.5%", "10.0%", "16.0%"]);
      assert.deepEqual(cellsOf(t, row(t, root, A)).slice(0, 5), [A, "3.0%", "2.0%", "0.0%", "36.0%"]);
      assert.deepEqual(cellsOf(t, row(t, root, D)).slice(1, 5), ["91.0% ★", "0.0%", "0.0%", "0.0%"]);
      assert.match(t.textOf(t.render(empty())), /Search first/);
      assert.match(t.textOf(t.render(sampleFindResultsCtx({ result: RESULTS.odd }))), /no tagged document/);
      // Columns follow shown(): a hidden question has no column.
      assert.deepEqual(t.findAll(t.render(sampleFindResultsCtx({ hide: [2] })), has("data-question")).map((node) => node.attrs["data-question"]), ["1", "3", "4"]);
    },
    shade: (t) => {
      const root = t.render(sampleFindResultsCtx());
      const cell = (section, position) => t.find(row(t, root, section), attr("data-cell", String(position)));
      assert.equal(cell(D, 1).attrs["data-level"], "3");
      assert.equal(cell(A, 4).attrs["data-level"], "2");
      assert.equal(cell(BEFORE, 3).attrs["data-level"], "1");
      assert.equal(cell(A, 1).attrs["data-level"], "0");
      assert.equal(cell(BEFORE, 1).attrs["data-level"], undefined);
      assert.match(cell(D, 1).attrs.style, /75%/);
      assert.equal(cell(BEFORE, 1).attrs.style, undefined);
    },
    best: (t) => {
      const root = t.render(sampleFindResultsCtx());
      const bests = t.findAll(root, has("data-best")).map((node) => [node.attrs["data-cell"], t.find(root, (tr) => tr.tag === "tr" && tr.children.includes(node)).attrs["data-section"]]);
      assert.deepEqual(bests.sort(), [["1", D], ["2", C], ["3", B], ["4", E]]);
    },
    mode: (t) => {
      const ctx = sampleFindResultsCtx();
      t.fire(t.find(t.render(ctx), attr("data-control", "mode")), "change", { target: { value: "max" } });
      const root = t.render(ctx);
      assert.deepEqual(cellsOf(t, row(t, root, A)).slice(1, 5), ["3.0%", "2.0%", "0.0%", "30.0%"]);
      assert.equal(cellsOf(t, row(t, root, C))[2], "64.0% ★");
      assert.equal(cellsOf(t, row(t, root, D))[1], "71.0% ★");
    },
    top_for: (t) => {
      const counts = (root) => Object.fromEntries(t.findAll(root, has("data-top-for")).map((node) => [t.find(root, (tr) => tr.tag === "tr" && tr.children.includes(node)).attrs["data-section"], t.textOf(node)]));
      assert.deepEqual(counts(t.render(sampleFindResultsCtx())), { [BEFORE]: "0", [A]: "0", [B]: "1", [C]: "1", [D]: "1", [E]: "1" });
      assert.deepEqual(counts(t.render(mixed())), { [BEFORE]: "0", [A]: "2", [B]: "1", [C]: "0", [D]: "0", [E]: "0" });
    },
    untouched: (t) => {
      assert.equal(t.textOf(part(t, t.render(sampleFindResultsCtx()), "untouched")), "Every section gets 5% or more from at least one shown question.");
      assert.equal(t.textOf(part(t, t.render(sampleFindResultsCtx({ hide: [1] })), "untouched")), "No shown question gives 5% or more to: Section D: Pets.");
      assert.equal(t.textOf(part(t, t.render(mixed()), "untouched")), "No shown question gives 5% or more to: Section D: Pets.");
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleFindResultsCtx()), attr("data-copy", "heat")), "click");
      const lines = t.env.copied[0].split("\n");
      assert.equal(lines[0], "section\tQ1\tQ2\tQ3\tQ4");
      assert.equal(lines[1], `${BEFORE}\t\t0.005\t0.1\t0.16`);
      assert.equal(lines[5], `${D}\t0.91\t0\t0\t0`);
      assert.equal(lines[6], `${E}\t0.04\t0.005\t0.07\t0.48`);
      assert.equal(lines.length, 8);
    },
  } },

  section_outline: { improvements: {
    outline: (t) => {
      const root = t.render(sampleFindResultsCtx());
      assert.deepEqual(t.findAll(root, attr("data-part", "head")).map(t.textOf), [
        "Before the first section · L000 · 1 line", "Section A: Hours and scheduling · L001 · 3 lines", "Section B: Pay and time off · L004 · 3 lines",
        "Section C: Leaving Harbor Coffee · L007 · 2 lines", "Section D: Pets · L009 · 2 lines", "Section E: Contact · L011 · 2 lines"]);
      assert.match(t.textOf(t.render(empty())), /Search first/);
    },
    top_matches: (t) => {
      const root = t.render(sampleFindResultsCtx());
      assert.deepEqual([BEFORE, A, B, C, D, E].map((section) => outlineItems(t, root, section, "data-top")), [[], [], ["Q3"], ["Q2"], ["Q1"], ["Q4"]]);
      assert.equal(t.textOf(t.find(root, attr("data-top", "Q1"))), "Q1 “can I bring my dog to work?” · top line L010 at 71.0% · answered");
      assert.match(t.textOf(t.find(root, attr("data-top", "Q3"))), /top line L006 at 41\.0% · absent/);
    },
    listed_matches: (t) => {
      const root = t.render(sampleFindResultsCtx());
      assert.deepEqual([BEFORE, A, B, C, D, E].map((section) => outlineItems(t, root, section, "data-listed")),
        [["Q3", "Q4"], ["Q1", "Q2", "Q4"], ["Q1", "Q2"], [], [], ["Q1", "Q3"]]);
      const inA = t.find(root, (node) => node.tag === "li" && node.attrs?.["data-section"] === A);
      assert.equal(t.textOf(t.find(inA, attr("data-listed", "Q4"))), "Q4 lists L001 at 30.0%");
    },
    matched_only: (t) => {
      const ctx = sampleFindResultsCtx();
      t.fire(t.find(t.render(ctx), attr("data-control", "matched-only")), "change", { target: { checked: true } });
      assert.deepEqual(t.findAll(t.render(ctx), attr("data-part", "head")).map((node) => t.textOf(node).split(" · ")[0]), [B, C, D, E]);
    },
    copy: (t) => {
      t.fire(t.find(t.render(sampleFindResultsCtx()), attr("data-copy", "outline")), "click");
      const lines = t.env.copied[0].split("\n");
      assert.deepEqual(lines.slice(0, 8), ["# Document outline with matched questions (your own search; holds answers)", "",
        "- Before the first section · L000 · 1 line", "  - Q3 lists L000 at 10.0%", "  - Q4 lists L000 at 16.0%",
        "- Section A: Hours and scheduling · L001 · 3 lines", "  - Q1 lists L002 at 3.0%", "  - Q2 lists L003 at 2.0%"]);
      assert.ok(lines.includes("  - Q1 “can I bring my dog to work?” · top line L010 at 71.0% · answered"));
    },
  } },

  distribution: { improvements: {
    buckets: (t) => {
      const counts = (root) => t.findAll(root, has("data-bucket")).map((node) => [node.attrs["data-bucket"], cellsOf(t, node)[1]]);
      // Q1: L000 missing; 0 on L001, L003, L004, L006, L007, L008, L012; 1-5% L002, L005, L011; L009 .20; L010 .71.
      assert.deepEqual(counts(t.render(sampleFindResultsCtx())), [["missing", "1"], ["zero", "7"], ["under_1", "0"], ["1_5", "3"], ["5_20", "0"], ["20_50", "1"], ["50_up", "1"]]);
      // Q2 (focused): L000 and L012 at .005 are under 1%; L007 .03 and L003 .02; L006 .30; L008 .64; the other 7 lines 0.
      assert.deepEqual(counts(t.render(sampleFindResultsCtx({ focusIndex: 1 }))), [["missing", "0"], ["zero", "7"], ["under_1", "2"], ["1_5", "2"], ["5_20", "0"], ["20_50", "1"], ["50_up", "1"]]);
      // The picker starts on the focused question and offers every shown one; choosing another wins over the focus.
      const ctx = sampleFindResultsCtx({ focusIndex: 2 });
      const control = t.find(t.render(ctx), attr("data-control", "question"));
      assert.equal(control.attrs.value, "3");
      assert.deepEqual(t.findAll(control, (node) => node.tag === "option").map((node) => node.attrs.value), ["1", "2", "3", "4"]);
      t.fire(control, "change", { target: { value: "4" } });
      // Q4: 0 on L002, L004-L010 (8 lines); L003 .06, L011 .10, L000 .16 in 5-20%; L001 .30, L012 .38 in 20-50%.
      assert.deepEqual(counts(t.render(ctx)), [["missing", "0"], ["zero", "8"], ["under_1", "0"], ["1_5", "0"], ["5_20", "3"], ["20_50", "2"], ["50_up", "0"]]);
      // A chosen question the Lab filters hide falls back to the focused one.
      assert.equal(t.find(t.render(sampleFindResultsCtx({ focusIndex: 2, hide: [4] })), attr("data-control", "question")).attrs.value, "3");
      assert.match(t.textOf(t.render(empty())), /Search first/);
      t.state.question = undefined;
      assert.match(t.textOf(t.render(sampleFindResultsCtx({ result: RESULTS.odd }))), /no line probabilities for Q1/);
    },
    coverage: (t) => {
      assert.equal(t.textOf(part(t, t.render(sampleFindResultsCtx()), "coverage")), "Likeliest lines holding 50% of the probability: 1 · 80%: 2 · 95%: 3 (of 13 lines).");
      assert.equal(t.textOf(part(t, t.render(sampleFindResultsCtx({ focusIndex: 3 })), "coverage")), "Likeliest lines holding 50% of the probability: 2 · 80%: 3 · 95%: 5 (of 13 lines).");
      assert.equal(t.textOf(part(t, t.render(mixed({ focusIndex: 1 })), "coverage")), "Likeliest lines holding 50% of the probability: 4 · 80%: 7 · 95%: 9 (of 13 lines).");
      // Mixed Q3: L005's .97 alone already holds 50%, 80% and 95% of the 1.00 total.
      assert.equal(t.textOf(part(t, t.render(mixed({ focusIndex: 2 })), "coverage")), "Likeliest lines holding 50% of the probability: 1 · 80%: 1 · 95%: 1 (of 13 lines).");
      assert.equal(t.textOf(part(t, t.render(zeros()), "coverage")), "No line has a probability above 0.");
    },
    likeliest: (t) => {
      const root = t.render(mixed({ focusIndex: 1 }));
      assert.deepEqual(t.findAll(part(t, root, "likeliest"), has("data-line")).map((node) => node.attrs["data-line"]),
        ["L001", "L000", "L003", "L004", "L011", "L002", "L005", "L006", "L007"]);
      assert.equal(t.textOf(t.find(root, attr("data-line", "L004"))), "L004 12.0%  Section B: Pay and time off");
      // Twelve lines above 0 (L000 .12 down to L011 .01, L012 0): only the ten likeliest are listed, L010 and L011 are not.
      const many = t.render(sampleFindResultsCtx({ result: rawSearch(DOC_LINES, ["what are the store hours?"],
        [{ exists: 0.9, confidence: 0.12, probs: Object.fromEntries(DOC_LINES.map((_, index) => [index, index < 12 ? (12 - index) / 78 : 0])) }]), queries: ["what are the store hours?"] }));
      assert.deepEqual(t.findAll(part(t, many, "likeliest"), has("data-line")).map((node) => node.attrs["data-line"]),
        ["L000", "L001", "L002", "L003", "L004", "L005", "L006", "L007", "L008", "L009"]);
      assert.deepEqual(t.findAll(part(t, t.render(zeros()), "likeliest"), has("data-line")), []);
    },
    overlap: (t) => {
      const ctx = sampleFindResultsCtx({ focusIndex: 1 });
      assert.equal(part(t, t.render(ctx), "overlap"), null);
      const other = t.find(t.render(ctx), attr("data-control", "other"));
      assert.deepEqual(t.findAll(other, (node) => node.tag === "option").map((node) => node.attrs.value), ["", "1", "3", "4"]);
      t.fire(other, "change", { target: { value: "3" } });
      assert.equal(t.textOf(part(t, t.render(ctx), "overlap")), "Q2 and Q3 share 31.0% (the smaller of the two per line, added up) · lines both give 5.0% or more: L006");
      t.state.question = 1; t.state.other = 4;
      assert.equal(t.textOf(part(t, t.render(ctx), "overlap")), "Q1 and Q4 share 4.0% (the smaller of the two per line, added up) · lines both give 5.0% or more: none");
    },
  } },

  query_log: { improvements: {
    log: (t) => {
      assert.match(t.textOf(t.render(empty())), /questions only, never answers/);
      t.render(sampleFindResultsCtx({ searches: 1 }));
      const root = t.render(mixed({ searches: 2 }));
      assert.deepEqual(t.findAll(root, has("data-search")).map((node) => node.attrs["data-search"]), ["1", "2"]);
      assert.deepEqual(t.findAll(t.find(root, attr("data-search", "1")), has("data-query")).map((node) => node.attrs["data-query"]), [...QUERIES]);
      assert.deepEqual(t.findAll(t.find(root, attr("data-search", "2")), has("data-query")).map((node) => node.attrs["data-query"]), [...MIXED_QUERIES]);
      // Re-rendering the same search adds nothing, and no answer reaches the list.
      const again = t.render(mixed({ searches: 2 }));
      assert.equal(t.findAll(again, has("data-search")).length, 2);
      assert.ok(!/answered|absent|partial|%/.test(t.textOf(again)));
    },
    gaps: (t) => {
      t.render(sampleFindResultsCtx({ searches: 2 }));
      assert.equal(t.textOf(part(t, t.render(sampleFindResultsCtx({ searches: 2 })), "gaps")), "Not listed: search 1 ran while this panel was closed.");
      assert.equal(t.textOf(part(t, t.render(mixed({ searches: 5 })), "gaps")), "Not listed: search 1, searches 3–4 ran while this panel was closed.");
    },
    repeats: (t) => {
      t.render(sampleFindResultsCtx({ searches: 1 }));
      t.render(mixed({ searches: 2 }));
      const root = t.render(sampleFindResultsCtx({ searches: 3, queries: QUERIES.map((query) => query.toUpperCase()) }));
      const third = t.find(root, attr("data-search", "3"));
      assert.deepEqual(t.findAll(third, has("data-repeat")).map((node) => node.attrs["data-repeat"]), ["1", "1", "1", "1"]);
      assert.deepEqual(t.findAll(t.find(root, attr("data-search", "2")), has("data-repeat")), []);
    },
    changes: (t) => {
      t.render(sampleFindResultsCtx({ searches: 1 }));
      const root = t.render(mixed({ searches: 2 }));
      assert.equal(t.findAll(t.find(root, attr("data-search", "2")), has("data-added")).length, 3);
      assert.equal(t.findAll(t.find(root, attr("data-search", "1")), has("data-added")).length, 0);
      assert.equal(t.textOf(t.find(root, has("data-dropped"))), `Dropped since search 1: ${QUERIES.join("; ")}`);
    },
    re_add: (t) => {
      t.render(sampleFindResultsCtx({ searches: 1 }));
      const ctx = mixed({ searches: 2 });
      const root = t.render(ctx);
      assert.deepEqual(t.findAll(root, has("data-add")).map((node) => node.attrs["data-add"]), [...QUERIES]);
      t.fire(t.find(root, attr("data-add", QUERIES[2])), "click");
      assert.deepEqual(ctx.log, [["addQuery", QUERIES[2]]]);
      assert.match(t.env.toasts[0].message, /nothing was searched/);
      assert.deepEqual(t.findAll(t.render(ctx), has("data-add")).map((node) => node.attrs["data-add"]), [QUERIES[0], QUERIES[1], QUERIES[3]]);
      const busy = mixed({ searches: 2, pending: true });
      t.fire(t.find(t.render(busy), attr("data-add", QUERIES[0])), "click");
      assert.equal(t.env.toasts[1].kind, "error");
      assert.deepEqual(busy.log, []);
    },
    copy: (t) => {
      t.render(sampleFindResultsCtx({ searches: 1 }));
      t.fire(t.find(t.render(mixed({ searches: 2 })), attr("data-copy", "log")), "click");
      assert.equal(t.env.copied[0], `Find questions of this page session (questions only, no answers)\n\nSearch 1\n${QUERIES.map((query) => `- ${query}`).join("\n")}\n\n`
        + `Search 2\n${MIXED_QUERIES.map((query) => `- ${query}`).join("\n")}\n`);
    },
    clear: (t) => {
      t.render(sampleFindResultsCtx({ searches: 1 }));
      const ctx = mixed({ searches: 2 });
      t.fire(t.find(t.render(ctx), attr("data-action", "clear")), "click");
      assert.equal(t.find(t.render(ctx), has("data-search")), null);
      const root = t.render(sampleFindResultsCtx({ searches: 3 }));
      assert.deepEqual(t.findAll(root, has("data-search")).map((node) => node.attrs["data-search"]), ["3"]);
      assert.equal(part(t, root, "gaps"), null);
    },
  } },

  heaviest_section: [
    { ctx: sampleFindResultsCtx(), empty: empty(), expect: (result) => { assert.equal(result.value, B); assert.equal(result.detail, "1.15 summed over 4 questions"); } },
    { ctx: mixed(), expect: (result) => { assert.equal(result.value, A); assert.equal(result.detail, "1.33 summed over 3 questions"); } },
    // With Q3 hidden, B loses Q3's .83 (1.15 -> .32), C stays .67 and D (.91, from Q1 alone) is heaviest.
    { ctx: sampleFindResultsCtx({ hide: [3] }), expect: (result) => { assert.equal(result.value, D); assert.equal(result.detail, "0.91 summed over 3 questions"); } },
    { ctx: sampleFindResultsCtx({ result: RESULTS.odd }), expect: null },
  ],
  top_in_best_section: [
    { ctx: sampleFindResultsCtx(), empty: empty(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "4 of 4"); } },
    { ctx: split(), expect: (result) => { assert.equal(result.value, 0.5); assert.equal(result.detail, "1 of 2"); } },
  ],
  mean_lines_80: [
    { ctx: sampleFindResultsCtx(), empty: empty(), expect: 2.5 },
    { ctx: mixed(), expect: 10 / 3, tolerance: 1e-12 },
    { ctx: sampleFindResultsCtx({ result: RESULTS.odd }), expect: null },
  ],
}, { ctx: () => sampleFindResultsCtx() });
