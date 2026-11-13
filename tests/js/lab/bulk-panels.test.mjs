// Tests for static/js/lab/packs/workbench/bulk-panels.js on the Bulk results fixture (tests/js/lab/fixtures/workbench-bulk.mjs).
// Reference values are worked out by hand from the fixture's run. Answered, not held-out rows (#position):
//   #1 department shipping p .88 conf .86 (label shipping, agrees) · frustration 1 · urgent no · refund yes (label yes)
//   #2 department shipping p .94 conf .93 (label shipping, agrees) · frustration 0 · urgent no · refund yes (label no)
//   #3 department shipping p .45 conf .34 (label billing, disagrees) · frustration 2 · urgent yes · refund yes
//   #7 department none p .83 conf .80 (label "accounts" fits no option) · frustration 0 · urgent yes · refund no
//   #8 department shipping p .60 conf .52 (no label) · frustration 2 · urgent no · refund yes (label yes)
// #4 failed, #5 held out (answers hidden, latency 845 ms), #6 skipped. Latencies: 812, 790, 1033, 845, 702, 1120 ms
// (sum 5302, median (812 + 845) / 2 = 828.5).
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/bulk-panels.js";
import { approx, checkPack } from "./harness.mjs";
import { sampleBulkResultsCtx } from "./fixtures/workbench-bulk.mjs";

const ctx = (overrides = {}) => sampleBulkResultsCtx(overrides);
const empty = () => sampleBulkResultsCtx({ result: null });
const byAttr = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const cells = (t, row) => row.children.filter((child) => child && (child.tag === "td" || child.tag === "th")).map(t.textOf);
const rowOf = (t, tree, name, value) => cells(t, byAttr(t, tree, name, value));
const keysOf = (t, tree, table, name) => t.findAll(byAttr(t, tree, "data-table", table), (node) => node.tag === "tr" && node.attrs[name] !== undefined)
  .map((node) => node.attrs[name]);
const listed = (t, tree, name) => t.findAll(byAttr(t, tree, "data-list", name), (node) => node.tag === "li").map((node) => node.attrs["data-row"]);
const DEPARTMENTS = ["billing", "shipping", "technical", "product", "wholesale", "none"];

checkPack(pack, {
  answers: { improvements: {
    table: (t) => {
      // Only the shown rows count: hide #8 (index 7).
      const fewer = t.render(ctx({ matches: (item) => item.index !== 7 }));
      assert.equal(rowOf(t, fewer, "data-option", "shipping")[1], "3");
      const page = ctx();
      let tree = t.render(page);
      assert.deepEqual(keysOf(t, tree, "answers", "data-option"), DEPARTMENTS, "Calibrate's question first, options as written");
      assert.deepEqual(DEPARTMENTS.map((option) => rowOf(t, tree, "data-option", option).slice(1, 3)),
        [["0", "0.0%"], ["4", "80.0%"], ["0", "0.0%"], ["0", "0.0%"], ["0", "0.0%"], ["1", "20.0%"]]);
      t.fire(byAttr(t, tree, "data-action", "answers-question"), "change", { target: { value: "frustration" } });
      tree = t.render(page);
      assert.deepEqual(["0", "1", "2"].map((level) => rowOf(t, tree, "data-option", level)[1]), ["2", "1", "2"]);
      assert.match(t.textOf(t.render(empty())), /Run Bulk first/);
    },
    mean_p: (t) => {
      const tree = t.render(ctx());
      // shipping: (.88 + .94 + .45 + .60) / 4 = 0.7175; none: .83.
      assert.equal(rowOf(t, tree, "data-option", "shipping")[3], "0.72");
      assert.equal(rowOf(t, tree, "data-option", "none")[3], "0.83");
      assert.equal(rowOf(t, tree, "data-option", "billing")[3], "—");
    },
    labels: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(DEPARTMENTS.map((option) => rowOf(t, tree, "data-option", option)[4]), ["1", "2", "0", "0", "0", "0"]);
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "answers")), "5 answered rows shown; 3 valid labels; 1 that fits no option.");
    },
    largest_first: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "answers-largest"), "click");
      assert.deepEqual(keysOf(t, t.render(page), "answers", "data-option"), ["shipping", "none", "billing", "technical", "product", "wholesale"]);
    },
    open: (t) => {
      const page = ctx();
      assert.equal(byAttr(t, t.render(page), "data-open-option", "billing"), null, "an option nobody got has nothing to open");
      t.fire(byAttr(t, t.render(page), "data-open-option", "shipping"), "click");
      const tree = t.render(page);
      assert.deepEqual(listed(t, tree, "answer-rows"), [1, 2, 3, 8]);
      t.fire(byAttr(t, byAttr(t, tree, "data-list", "answer-rows"), "data-go-row", 3), "click");
      assert.deepEqual(page.calls, [["focusRow", 2]]);
    },
  } },

  histogram: { improvements: {
    table: (t) => {
      const tree = t.render(ctx());
      // department p: .88 → bin 8, .94 → 9, .45 → 4, .83 → 8, .60 → 6.
      assert.deepEqual(keysOf(t, tree, "histogram", "data-bin"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((bin) => rowOf(t, tree, "data-bin", bin)[1]), ["0", "0", "0", "0", "1", "0", "1", "0", "2", "1"]);
      assert.equal(rowOf(t, tree, "data-bin", 8)[0], "0.8–0.9");
      assert.equal(byAttr(t, byAttr(t, tree, "data-bin", 8), "data-width", 100).tag, "span", "the tallest bin fills the bar");
      assert.equal(byAttr(t, byAttr(t, tree, "data-bin", 4), "data-width", 50).tag, "span", "a bin of 1 against 2 fills half");
      // The context column: #1 (.88, agrees), #2 (.94, agrees), #3 (.45, disagrees); #7's label fits no option, #8 has none.
      assert.deepEqual([4, 6, 8, 9].map((bin) => rowOf(t, tree, "data-bin", bin)[3]), ["0/1", "—", "1/1", "1/1"]);
    },
    bins: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "histogram-bins"), "change", { target: { value: "5" } });
      let tree = t.render(page);
      // Fifths: .45 → 2, .60 → 3, .83 .88 .94 → 4.
      assert.deepEqual([0, 1, 2, 3, 4].map((bin) => rowOf(t, tree, "data-bin", bin)[1]), ["0", "0", "1", "1", "3"]);
      t.fire(byAttr(t, tree, "data-action", "histogram-bins"), "change", { target: { value: "20" } });
      tree = t.render(page);
      assert.equal(keysOf(t, tree, "histogram", "data-bin").length, 20);
      // Twentieths: .45 → 9, .60 → 12, .83 → 16, .88 → 17, .94 → 18.
      assert.deepEqual([9, 12, 16, 17, 18].map((bin) => rowOf(t, tree, "data-bin", bin)[1]), ["1", "1", "1", "1", "1"]);
      assert.equal(rowOf(t, tree, "data-bin", 9)[0], "0.45–0.50");
    },
    signal: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "histogram-signal"), "change", { target: { value: "confidence" } });
      let tree = t.render(page);
      // department confidence: .86 → 8, .93 → 9, .34 → 3, .80 → 8, .52 → 5.
      assert.deepEqual([3, 5, 8, 9].map((bin) => rowOf(t, tree, "data-bin", bin)[1]), ["1", "1", "2", "1"]);
      t.fire(byAttr(t, tree, "data-action", "histogram-question"), "change", { target: { value: "is_urgent" } });
      tree = t.render(page);
      assert.match(t.textOf(tree), /No shown answer to is_urgent carries a confidence/);
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "missing")), "5 answers carry no confidence.");
      t.fire(byAttr(t, tree, "data-action", "histogram-question"), "change", { target: { value: "seal_damage" } });
      // Box confidences .74 .61 .12 .20 .58 → bins 7, 6, 1, 2, 5.
      assert.deepEqual([1, 2, 5, 6, 7].map((bin) => rowOf(t, t.render(page), "data-bin", bin)[1]), ["1", "1", "1", "1", "1"]);
    },
    summary: (t) => {
      // Sorted: .45 .60 .83 .88 .94 → median .83; one under .50.
      assert.equal(t.textOf(byAttr(t, t.render(ctx()), "data-note", "summary")), "5 answers; median 0.83; 1 under 0.50.");
    },
    cut: (t) => {
      const page = ctx();
      let tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-note", "cut"), null, "no cut until one is typed");
      t.fire(byAttr(t, tree, "data-action", "histogram-cut"), "input", { target: { value: "0.8" } });
      tree = t.render(page);
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "cut")), "3 of 5 answers (60.0%) at or above 0.8 — advisory; Policy's gates are unchanged.");
      t.fire(byAttr(t, tree, "data-action", "histogram-cut"), "input", { target: { value: "1.5" } });
      assert.equal(byAttr(t, t.render(page), "data-note", "cut"), null, "a cut outside 0–1 is ignored");
      for (const typed of ["0x1", "abc", " "]) {
        t.fire(byAttr(t, t.render(page), "data-action", "histogram-cut"), "input", { target: { value: typed } });
        assert.equal(byAttr(t, t.render(page), "data-note", "cut"), null, `${JSON.stringify(typed)} is not a cut`);
      }
      // .5 sits between .45 and .60: 4 of 5 at or above it.
      t.fire(byAttr(t, t.render(page), "data-action", "histogram-cut"), "input", { target: { value: ".5" } });
      assert.match(t.textOf(byAttr(t, t.render(page), "data-note", "cut")), /^4 of 5 answers \(80\.0%\) at or above 0\.5 /);
      assert.deepEqual(page.calls, [], "the cut changes nothing on the page");
    },
    open: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-open-bin", 8), "click");
      const tree = t.render(page);
      assert.deepEqual(listed(t, tree, "bin-rows"), [1, 7]);
      t.fire(byAttr(t, byAttr(t, tree, "data-list", "bin-rows"), "data-go-row", 7), "click");
      assert.deepEqual(page.calls, [["focusRow", 6]]);
    },
  } },

  cross: { improvements: {
    table: (t) => {
      const tree = t.render(ctx());
      // department × frustration: shipping 0 1 2 → 1 1 2 (#2; #1; #3 #8), none → 1 0 0 (#7).
      assert.deepEqual(keysOf(t, tree, "cross", "data-value"), ["shipping", "none"]);
      assert.deepEqual(rowOf(t, tree, "data-value", "shipping"), ["shipping", "1", "1", "2", "4"]);
      assert.deepEqual(rowOf(t, tree, "data-value", "none"), ["none", "1", "0", "0", "1"]);
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "cross-columns"), "change", { target: { value: "department" } });
      assert.match(t.textOf(t.render(page)), /Pick two different questions/);
    },
    swap: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "cross-swap"), "click");
      const tree = t.render(page);
      assert.deepEqual(keysOf(t, tree, "cross", "data-value"), ["0", "1", "2"]);
      assert.deepEqual(rowOf(t, tree, "data-value", "2"), ["2", "2", "0", "2"]);
    },
    mode: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "cross-mode"), "change", { target: { value: "row" } });
      let tree = t.render(page);
      assert.deepEqual(rowOf(t, tree, "data-value", "shipping").slice(1, 4), ["25.0%", "25.0%", "50.0%"]);
      t.fire(byAttr(t, tree, "data-action", "cross-mode"), "change", { target: { value: "column" } });
      tree = t.render(page);
      assert.deepEqual(rowOf(t, tree, "data-value", "shipping").slice(1, 4), ["50.0%", "100.0%", "100.0%"]);
      assert.deepEqual(rowOf(t, tree, "data-value", "none").slice(1, 4), ["50.0%", "0.0%", "0.0%"]);
    },
    association: (t) => {
      // Expected counts (row total × column total / 5): shipping 1.6 0.8 1.6, none 0.4 0.2 0.4.
      // χ² = .36/1.6 + .04/.8 + .16/1.6 + .36/.4 + .04/.2 + .16/.4 = 1.875; V = √(1.875 / (5 · 1)) = √0.375 ≈ 0.612.
      assert.match(t.textOf(byAttr(t, t.render(ctx()), "data-note", "association")), /^Cramér's V 0\.61 over 5 rows/);
      // Hiding #7 leaves one department answer: nothing to measure.
      assert.match(t.textOf(byAttr(t, t.render(ctx({ matches: (item) => item.index !== 6 })), "data-note", "association")), /no association to measure/);
      // A 2 × 2 table's V is |φ| = |ad − bc| / √(r1 r2 c1 c2). is_urgent × wants_refund without #2: urgent no → refund yes
      // #1 #8 (a = 2, b = 0); urgent yes → yes #3, no #7 (c = 1, d = 1): 2 / √(2 · 2 · 3 · 1) = 0.57735.
      const pair = ctx({ matches: (item) => item.index !== 1 });
      t.fire(byAttr(t, t.render(pair), "data-action", "cross-rows"), "change", { target: { value: "is_urgent" } });
      t.fire(byAttr(t, t.render(pair), "data-action", "cross-columns"), "change", { target: { value: "wants_refund" } });
      const tree = t.render(pair);
      assert.deepEqual(rowOf(t, tree, "data-value", "no"), ["no", "2", "0", "2"]);
      assert.match(t.textOf(byAttr(t, tree, "data-note", "association")), /^Cramér's V 0\.58 over 4 rows/);
    },
    open: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-open-cell", "shipping|2"), "click");
      const tree = t.render(page);
      assert.deepEqual(listed(t, tree, "cell-rows"), [3, 8]);
      t.fire(byAttr(t, byAttr(t, tree, "data-list", "cell-rows"), "data-go-row", 8), "click");
      assert.deepEqual(page.calls, [["focusRow", 7]]);
    },
  } },

  confusion: { improvements: {
    matrix: (t) => {
      const page = ctx();
      let tree = t.render(page);
      // department: #1, #2 shipping → shipping; #3 billing → shipping.
      assert.deepEqual(keysOf(t, tree, "confusion", "data-label"), ["billing", "shipping", "precision"]);
      assert.deepEqual(rowOf(t, tree, "data-label", "billing").slice(0, 3), ["billing", "0", "1"]);
      assert.deepEqual(rowOf(t, tree, "data-label", "shipping").slice(0, 3), ["shipping", "0", "2"]);
      t.fire(byAttr(t, tree, "data-action", "confusion-question"), "change", { target: { value: "wants_refund" } });
      tree = t.render(page);
      // wants_refund: #1 yes → yes, #2 no → yes, #8 yes → yes.
      assert.deepEqual(rowOf(t, tree, "data-label", "yes").slice(0, 3), ["yes", "2", "0"]);
      assert.deepEqual(rowOf(t, tree, "data-label", "no").slice(0, 3), ["no", "1", "0"]);
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "labeled")), "3 labeled rows shown; rows are your labels, columns the answers.");
      // Only the shown rows: hiding #3 leaves shipping → shipping alone for department.
      t.fire(byAttr(t, tree, "data-action", "confusion-question"), "change", { target: { value: "department" } });
      const fewer = t.render(ctx({ matches: (item) => item.index !== 2 }));
      assert.deepEqual(keysOf(t, fewer, "confusion", "data-label"), ["shipping", "precision"]);
      assert.deepEqual(rowOf(t, fewer, "data-label", "shipping").slice(0, 2), ["shipping", "2"]);
      // #7's "accounts" fits no department and stays out of the table, with a note.
      assert.equal(t.textOf(byAttr(t, t.render(ctx()), "data-note", "invalid")), "1 label fits no option and is left out.");
    },
    rates: (t) => {
      const tree = t.render(ctx());
      assert.equal(t.textOf(byAttr(t, tree, "data-recall", "billing")), "0.0%");
      assert.equal(t.textOf(byAttr(t, tree, "data-recall", "shipping")), "100.0%");
      assert.equal(t.textOf(byAttr(t, tree, "data-precision", "billing")), "—", "nothing was answered billing");
      assert.equal(t.textOf(byAttr(t, tree, "data-precision", "shipping")), "66.7%");
    },
    shares: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "confusion-question"), "change", { target: { value: "wants_refund" } });
      t.fire(byAttr(t, t.render(page), "data-action", "confusion-shares"), "click");
      const tree = t.render(page);
      assert.deepEqual(rowOf(t, tree, "data-label", "yes").slice(1, 3), ["100.0%", "0.0%"]);
      assert.deepEqual(rowOf(t, tree, "data-label", "no").slice(1, 3), ["100.0%", "0.0%"]);
    },
    mistakes: (t) => {
      const page = ctx();
      let tree = t.render(page);
      assert.deepEqual(t.findAll(byAttr(t, tree, "data-list", "mistakes"), (node) => node.tag === "li").map(t.textOf), ["labeled billing, answered shipping: 1 (#3)"]);
      t.fire(byAttr(t, tree, "data-action", "confusion-question"), "change", { target: { value: "frustration" } });
      tree = t.render(page);
      // frustration labels: #1 1 → 1, #3 2 → 2: no mistake.
      assert.equal(t.textOf(byAttr(t, tree, "data-note", "no-mistakes")), "Every labeled row agrees.");
    },
    open: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-open-cell", "shipping|shipping"), "click");
      const tree = t.render(page);
      assert.deepEqual(listed(t, tree, "confusion-rows"), [1, 2]);
      t.fire(byAttr(t, byAttr(t, tree, "data-list", "confusion-rows"), "data-go-row", 1), "click");
      assert.deepEqual(page.calls, [["focusRow", 0]]);
    },
  } },

  slowest: { improvements: {
    list: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(keysOf(t, tree, "slowest", "data-row"), [8, 3, 5, 1, 2]);
      assert.deepEqual(rowOf(t, tree, "data-row", 3).slice(0, 6),
        ["3", "Charged twice for this grinder order, refund today!", "1033 ms", "880", "41", "$0.000037"]);
      assert.equal(rowOf(t, tree, "data-row", 8)[4], "—", "#8 has no output tokens");
      assert.match(t.textOf(t.render(empty())), /Run Bulk first/);
    },
    top: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "slowest-top"), "change", { target: { value: "10" } });
      assert.deepEqual(keysOf(t, t.render(page), "slowest", "data-row"), [8, 3, 5, 1, 2, 7]);
    },
    rank: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "slowest-rank"), "change", { target: { value: "cost" } });
      // Costs: #3 .000037, #1 .0000366, #2 .0000361, #8 .000036, #5 .0000358, #7 .0000345.
      assert.deepEqual(keysOf(t, t.render(page), "slowest", "data-row"), [3, 1, 2, 8, 5]);
      t.fire(byAttr(t, t.render(page), "data-action", "slowest-rank"), "change", { target: { value: "output" } });
      // Output tokens: #3 41, then 40 for #1, #2, #5 in row order, #7 39; #8 has none.
      assert.deepEqual(keysOf(t, t.render(page), "slowest", "data-row"), [3, 1, 2, 5, 7]);
    },
    share: (t) => {
      const page = ctx();
      // (5302 − 702) / 5302 = 4600 / 5302 ≈ 86.76%.
      assert.equal(t.textOf(byAttr(t, t.render(page), "data-note", "share")), "These 5 calls hold 86.8% of the latency of the 6 shown calls.");
      t.fire(byAttr(t, t.render(page), "data-action", "slowest-top"), "change", { target: { value: "10" } });
      assert.equal(t.textOf(byAttr(t, t.render(page), "data-note", "share")), "These 6 calls hold 100.0% of the latency of the 6 shown calls.");
    },
    go: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-go-row", 8), "click");
      assert.deepEqual(page.calls, [["focusRow", 7]]);
      const hidden = ctx({ focusRow: () => { throw new Error("That row is not shown."); } });
      t.fire(byAttr(t, t.render(hidden), "data-go-row", 8), "click");
      assert.equal(t.env.toasts.at(-1).kind, "error");
    },
  } },

  // The slowest ⌈6 / 10⌉ = 1 call: 1120 / 5302.
  slow_tenth_share: { ctx: ctx(), expect: 1120 / 5302, empty: empty() },
  tail_ratio: { ctx: ctx(), expect: 1120 / 828.5, empty: empty() },
  // Patterns (department, frustration, urgent, refund): #1 shipping 1 no yes, #2 shipping 0 no yes, #3 shipping 2 yes yes,
  // #7 none 0 yes no, #8 shipping 2 no yes — all different. Hiding #2 and #8 leaves 3.
  answer_patterns: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 5); assert.match(result.detail, /covers 1$/); }, empty: empty() },
    { ctx: ctx({ matches: (item) => item.index !== 1 && item.index !== 7 }), expect: 3 }],
  mean_entropy: { ctx: ctx(), empty: empty(), expect: (result) => {
    // A separate computation over the fixture's probability vectors (department, frustration, urgent, refund per row).
    const vectors = [
      [0.05, 0.88, 0.01, 0.02, 0.01, 0.03], [0.1, 0.6, 0.3], [0.22, 0.78], [0.91, 0.09],
      [0.02, 0.94, 0.01, 0.01, 0.01, 0.01], [0.65, 0.3, 0.05], [0.08, 0.92], [0.62, 0.38],
      [0.41, 0.45, 0.1, 0.02, 0.01, 0.01], [0.05, 0.2, 0.75], [0.81, 0.19], [0.97, 0.03],
      [0.01, 0.02, 0.01, 0.12, 0.01, 0.83], [0.92, 0.07, 0.01], [0.5, 0.5], [0.03, 0.97],
      [0.3, 0.6, 0.06, 0.02, 0.01, 0.01], [0.1, 0.35, 0.55], [0.44, 0.56], [0.95, 0.05],
    ];
    const entropy = (ps) => { const s = ps.reduce((a, b) => a + b, 0); let h = 0; for (const p of ps) h -= (p / s) * Math.log(p / s); return h / Math.log(ps.length); };
    approx(result.value, vectors.map(entropy).reduce((a, b) => a + b, 0) / vectors.length, 1e-9);
    assert.equal(result.detail, "20 answers");
  } },
}, { ctx: () => sampleBulkResultsCtx() });
