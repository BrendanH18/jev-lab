// Tests for static/js/lab/packs/workbench/compare-panels.js on the Compare fixture (tests/js/lab/fixtures/workbench-compare.mjs).
// Reference values are worked out by hand from the fixture's raw run (see the fixture header for the seven rows):
// department, paired rows #1 #2 #3 #4 #6; labeled and scored #1 (a_only), #2 (b_only), #3 (both right, agree), #6
// (both wrong); signals A .60 .30 .70 .85 .60 .36 .35, B .45 .70 .85 .40 — .33 —; tops on scored rows A .70 .50 .80 .52,
// B .60 .80 .90 .50.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/compare-panels.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { COMPARE_REPORTS, COMPARE_RESULT, sampleCompareRowsCtx } from "./fixtures/workbench-compare.mjs";

const ctx = (overrides = {}) => sampleCompareRowsCtx(overrides);
const empty = () => sampleCompareRowsCtx({ result: null });
// A second run of the same setup: a new result object with other measurements, so the panels see a new run.
const RUN2 = { ...COMPARE_RESULT, wall_ms: 4100, cost_usd: 0.0021 };
const byAttr = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const cellsOf = (t, row) => row.children.filter((child) => child && (child.tag === "td" || child.tag === "th")).map(t.textOf);
const rowCells = (t, tree, name, value) => cellsOf(t, byAttr(t, tree, name, value));
const tableRows = (t, tree, table) => t.findAll(byAttr(t, tree, "data-table", table), (node) => node.tag === "tr" && node.attrs["data-question"]).map((node) => node.attrs["data-question"]);
const listed = (t, root) => t.findAll(root, (node) => node.tag === "li").map((node) => node.attrs["data-row"]);
const field = (t, tree, name) => rowCells(t, tree, "data-field", name).slice(1);

checkPack(pack, {
  scoreboard: { improvements: {
    remembered: (t) => {
      // The Score button asks the page for a local rescoring of another shared question; the one scored now has none.
      const page = ctx();
      const first = t.render(page);
      assert.ok(byAttr(t, first, "data-current", "department"));
      assert.equal(byAttr(t, first, "data-score", "department"), null);
      t.fire(byAttr(t, first, "data-score", "urgent"), "click");
      assert.deepEqual(page.log, [["selectQuestion", "urgent"]]);
      const busy = ctx({ running: true });
      t.fire(byAttr(t, t.render(busy), "data-score", "tone"), "click");
      assert.deepEqual(busy.log, [], "a refused switch reaches no page action");
      assert.match(t.env.toasts.at(-1).message, /Wait for the current Compare run/);
      const tree = t.render(ctx({ qid: "urgent" }));
      // department: 2 of 4 for both (the report's scores); urgent: A 1 of 2, B 2 of 2.
      assert.deepEqual(rowCells(t, tree, "data-question", "department").slice(4, 6), ["2/4 (50.0%)", "2/4 (50.0%)"]);
      assert.deepEqual(rowCells(t, tree, "data-question", "urgent").slice(4, 6), ["1/2 (50.0%)", "2/2 (100.0%)"]);
      assert.deepEqual(rowCells(t, tree, "data-question", "tone").slice(4, 6), ["not scored yet", "not scored yet"]);
      const next = t.render(ctx({ result: RUN2 }));
      assert.deepEqual(rowCells(t, next, "data-question", "urgent").slice(4, 6), ["not scored yet", "not scored yet"], "a new run starts over");
      assert.deepEqual(rowCells(t, next, "data-question", "department").slice(4, 6), ["2/4 (50.0%)", "2/4 (50.0%)"]);
    },
    leader: (t) => {
      t.render(ctx());
      t.render(ctx({ qid: "tone" }));
      const tree = t.render(ctx({ qid: "urgent" }));
      assert.equal(t.textOf(byAttr(t, tree, "data-lead", "department")), "even (p = 1.00)");
      assert.equal(t.textOf(byAttr(t, tree, "data-lead", "urgent")), "B +1 (p = 1.00)");
      assert.equal(t.textOf(byAttr(t, tree, "data-lead", "tone")), "A +1 (p = 1.00)");
      assert.equal(t.textOf(byAttr(t, tree, "data-lead", "spot")), "—");
    },
    sort: (t) => {
      const page = ctx();
      // Question order: shared ids in A's order; rush differs in type and allergy is only A's, so neither is listed.
      assert.deepEqual(tableRows(t, t.render(page), "scoreboard"), ["department", "urgent", "tone", "drink", "spot"]);
      t.render(ctx({ qid: "urgent" }));
      t.render(ctx({ qid: "tone" }));
      let tree = t.render(page);
      t.fire(byAttr(t, tree, "data-action", "scoreboard-sort"), "change", { target: { value: "changed" } });
      // Rates: tone 1, spot 1 (tie keeps order), department .8, urgent .2, drink unknown last.
      assert.deepEqual(tableRows(t, t.render(page), "scoreboard"), ["tone", "spot", "department", "urgent", "drink"]);
      tree = t.render(page);
      t.fire(byAttr(t, tree, "data-action", "scoreboard-sort"), "change", { target: { value: "gap" } });
      // |B − A| accuracy: tone 1, urgent .5, department 0; drink and spot not scored, last in order.
      assert.deepEqual(tableRows(t, t.render(page), "scoreboard"), ["tone", "urgent", "department", "drink", "spot"]);
    },
    labeled_only: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "labeled-only"), "click");
      assert.deepEqual(tableRows(t, t.render(page), "scoreboard"), ["department", "urgent", "tone", "spot"], "drink carries no label");
      t.fire(byAttr(t, t.render(page), "data-action", "labeled-only"), "click");
      assert.equal(tableRows(t, t.render(page), "scoreboard").length, 5);
    },
    copy: (t) => {
      t.fire(byAttr(t, t.render(ctx()), "data-action", "copy-scoreboard"), "click");
      const text = t.env.copied[0];
      assert.match(text, /your Compare run's agreement and scored accuracies/);
      assert.ok(text.includes("| department | choice | — | 4/5 (80.0%, 95% 37.6%–96.4%) | 2/4 (50.0%) | 2/4 (50.0%) | even (p = 1.00) |"));
      assert.ok(text.includes("| drink | choice | — | — | — | — | — |"));
      assert.match(text, /exact McNemar/);
    },
  } },
  matrices: { improvements: {
    cell_rows: (t) => {
      const count = (tree, key) => t.textOf(byAttr(t, tree, "data-cell", key));
      // department: #1 A only, #2 B only, #3 both right (agreeing, read locally), #6 both wrong.
      assert.deepEqual(["both_right", "a_only", "b_only", "both_wrong"].map((key) => count(t.render(ctx()), key)), ["1", "1", "1", "1"]);
      // urgent: #1 both yes with label true (both right), #2 A yes / B no with label false (B only).
      const urgent = t.render(ctx({ qid: "urgent" }));
      assert.deepEqual(["both_right", "a_only", "b_only", "both_wrong"].map((key) => count(urgent, key)), ["1", "0", "1", "0"]);
      assert.doesNotMatch(t.textOf(urgent), /differ from the report/);
      const off = t.render(ctx({ report: { ...COMPARE_REPORTS.department, paired: { ...COMPARE_REPORTS.department.paired, both_right: 2 } } }));
      assert.match(t.textOf(off), /differ from the report's paired table/);
      // Odd items (no answers, picks or text) render without throwing.
      const odd = t.fakeCtx({ items: [{ index: 0, number: 1, paired: true, label: "billing", correct: [true, false] }, { index: 1 }],
        data: { qid: "department", type: "choice", questions: [null, null], scores: null } });
      assert.match(t.textOf(t.render(odd)), /1 labeled row both variants answered/);
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-cell", "a_only"), "click");
      let tree = t.render(page);
      assert.deepEqual(listed(t, byAttr(t, tree, "data-cell-rows", "a_only")), [0]);
      assert.match(t.textOf(byAttr(t, tree, "data-cell-rows", "a_only")), /A right, B wrong: 1 row#1 My espresso grinder.* — A billing, B shipping/);
      t.fire(byAttr(t, tree, "data-cell", "both_right"), "click");
      tree = t.render(page);
      assert.deepEqual(listed(t, byAttr(t, tree, "data-cell-rows", "both_right")), [2]);
      t.fire(byAttr(t, tree, "data-cell", "both_right"), "click");
      assert.equal(byAttr(t, t.render(page), "data-cell-rows", "both_right"), null, "a second press closes the list");
    },
    pick_matrix: (t) => {
      const tree = t.render(ctx());
      const head = t.find(byAttr(t, tree, "data-table", "picks"), (node) => node.tag === "thead");
      assert.deepEqual(t.findAll(head, (node) => node.tag === "th").map(t.textOf), ["A \\ B", "billing", "shipping", "wholesale", "other"]);
      // Paired rows: #1 and #4 billing→shipping, #6 billing→other, #2 wholesale→shipping, #3 other→other.
      const pick = (key) => t.textOf(byAttr(t, tree, "data-pick", key));
      assert.deepEqual(["billing|shipping", "billing|other", "wholesale|shipping", "other|other"].map(pick), ["2", "1", "1", "1"]);
      assert.equal(byAttr(t, tree, "data-pick", "billing|billing"), null, "empty cells have no button");
      assert.match(t.textOf(t.render(ctx({ qid: "spot" }))), /Box picks are coordinates/);
    },
    pick_rows: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-pick", "billing|shipping"), "click");
      const box = byAttr(t, t.render(page), "data-pick-rows", "billing|shipping");
      assert.deepEqual(listed(t, box), [0, 3]);
      assert.match(t.textOf(box), /label billing/);
      assert.match(t.textOf(box), /unlabeled/);
    },
    per_label: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(t.findAll(byAttr(t, tree, "data-table", "per-label"), (node) => node.attrs["data-label"]).map((node) => node.attrs["data-label"]), ["shipping", "billing", "other"]);
      assert.deepEqual(rowCells(t, tree, "data-label", "shipping"), ["shipping", "2", "0/2 (0.0%)", "1/2 (50.0%)"]);
      assert.deepEqual(rowCells(t, tree, "data-label", "billing"), ["billing", "1", "1/1 (100.0%)", "0/1 (0.0%)"]);
      assert.deepEqual(rowCells(t, tree, "data-label", "other"), ["other", "1", "1/1 (100.0%)", "1/1 (100.0%)"]);
    },
    label_confusion: (t) => {
      const tree = t.render(ctx());
      const at = (key) => t.textOf(byAttr(t, tree, "data-lc", key));
      assert.deepEqual(["A|billing|billing", "A|shipping|wholesale", "A|shipping|billing", "A|other|other", "A|billing|wholesale"].map(at), ["1", "1", "1", "1", "0"]);
      assert.deepEqual(["B|billing|shipping", "B|shipping|shipping", "B|shipping|other", "B|other|other", "B|other|shipping"].map(at), ["1", "1", "1", "1", "0"]);
    },
  } },
  signals: { improvements: {
    histogram: (t) => {
      const tree = t.render(ctx());
      const bin = (key) => t.textOf(byAttr(t, tree, "data-open-bin", key));
      // Ten bins: A .30 .36 .35 → 3, .60 .60 → 6, .70 → 7, .85 → 8; B .33 → 3, .45 .40 → 4, .70 → 7, .85 → 8.
      assert.deepEqual(["A|3", "A|6", "A|7", "A|8"].map(bin), ["3", "2", "1", "1"]);
      assert.deepEqual(["B|3", "B|4", "B|7", "B|8"].map(bin), ["1", "2", "1", "1"]);
      assert.ok(t.textOf(byAttr(t, tree, "data-bin", "A|0")).startsWith("0"));
      assert.equal(t.findAll(byAttr(t, tree, "data-table", "histogram"), (node) => node.attrs["data-bin"]?.startsWith("A|")).length, 10);
    },
    right_wrong: (t) => {
      const tree = t.render(ctx());
      const split = (key) => t.textOf(byAttr(t, tree, "data-split", key)).trim();
      assert.equal(split("A|3"), "0 right · 2 wrong · 1 unscored");  // #2 and #6 wrong, #7 only A answered
      assert.equal(split("A|6"), "1 right · 0 wrong · 1 unscored");  // #1 right, #5 only A answered
      assert.equal(split("B|4"), "0 right · 1 wrong · 1 unscored");  // #1 wrong, #4 unlabeled
      assert.equal(split("B|8"), "1 right · 0 wrong · 0 unscored");  // #3 right
    },
    bins: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-action", "bins"), "change", { target: { value: "5" } });
      assert.equal(t.state.bins, "5");
      const tree = t.render(page);
      const bin = (key) => t.textOf(byAttr(t, tree, "data-open-bin", key));
      // Width .2: A .30 .36 .35 → 1, .60 .70 .60 → 3, .85 → 4; B .33 → 1, .45 .40 → 2, .70 → 3, .85 → 4.
      assert.deepEqual(["A|1", "A|3", "A|4", "B|1", "B|2", "B|3", "B|4"].map(bin), ["3", "3", "1", "1", "2", "1", "1"]);
      assert.equal(t.findAll(byAttr(t, tree, "data-table", "histogram"), (node) => node.attrs["data-bin"]?.startsWith("B|")).length, 5);
    },
    reliability: (t) => {
      const tree = t.render(ctx());
      assert.match(t.textOf(tree), /for Yes\/no it bins P\(yes\) against yes labels/);
      // A: .50 and .52 wrong (mean .51, gap .51), .70 right (gap .30), .80 right (gap .20); weighted (2·.51 + .30 + .20) / 4 = .38.
      assert.deepEqual(rowCells(t, tree, "data-rel-bin", "A|5"), ["0.50–0.60", "2", "0.51", "0.0%", "0.51"]);
      assert.deepEqual(rowCells(t, tree, "data-rel-bin", "A|7"), ["0.70–0.80", "1", "0.70", "100.0%", "0.30"]);
      assert.equal(t.textOf(byAttr(t, tree, "data-weighted", "A")), "Weighted gap over 4 rows: 0.38");
      // B: .60 wrong, .80 right, .90 right, .50 wrong: (.60 + .20 + .10 + .50) / 4 = .35.
      assert.deepEqual(rowCells(t, tree, "data-rel-bin", "B|6"), ["0.60–0.70", "1", "0.60", "0.0%", "0.60"]);
      assert.equal(t.textOf(byAttr(t, tree, "data-weighted", "B")), "Weighted gap over 4 rows: 0.35");
    },
    bin_rows: (t) => {
      const page = ctx();
      t.fire(byAttr(t, t.render(page), "data-open-bin", "A|3"), "click");
      const box = byAttr(t, t.render(page), "data-bin-rows", "A|3");
      assert.deepEqual(listed(t, box), [1, 5, 6]);
      assert.match(t.textOf(box), /A wholesale at 0\.30/);
    },
  } },
  row_detail: { improvements: {
    pick_row: (t) => {
      const page = ctx();
      let tree = t.render(page);
      assert.deepEqual(field(t, tree, "pick"), ["billing", "shipping"]);
      assert.deepEqual(field(t, tree, "signal"), ["0.60", "0.45"]);
      assert.deepEqual(field(t, tree, "top probability"), ["0.70", "0.60"]);
      assert.deepEqual(field(t, tree, "result"), ["right", "wrong"]);
      t.fire(byAttr(t, tree, "data-action", "row"), "change", { target: { value: "4" } });
      tree = t.render(page);
      assert.equal(t.textOf(byAttr(t, tree, "data-heading", "row")), "Row #5 of 7 compared rows · label wholesale");
      assert.deepEqual(field(t, tree, "pick"), ["wholesale", "—"]);
      assert.deepEqual(field(t, tree, "result"), ["unscored", "unscored"], "only A answered, so the report does not score it");
      // The row as written, as each variant was sent, and B's picks in both option orders.
      t.state.row = 0;
      tree = t.render(page);
      assert.deepEqual(field(t, tree, "sent"), ["as written", "My espreso grinder arived cracked, I want a refund today."]);
      assert.equal(t.textOf(byAttr(t, tree, "data-text", "row")), "My espresso grinder arrived cracked, I want a refund today.");
      assert.deepEqual(field(t, tree, "option orders"), ["asked once", "as listed shipping · reversed billing"]);
      t.state.row = 1;
      tree = t.render(page);
      assert.deepEqual(field(t, tree, "sent"), ["as written", '{"text":"Where is wholesale ordr HC-2231?","channel":"email","_image":"receipt.png"}']);
      t.state.row = 2;
      tree = t.render(page);
      assert.deepEqual(field(t, tree, "pick"), ["other", "other"], "an agreeing row the page's table never lists");
      assert.deepEqual(field(t, tree, "result"), ["right", "right"]);
      assert.deepEqual(field(t, tree, "sent"), ["as written", "as written"]);
      t.state.row = 5;
      assert.deepEqual(field(t, t.render(page), "option orders"), ["asked once", "as listed other · reversed billing"]);
    },
    probabilities: (t) => {
      const tree = t.render(ctx());
      assert.deepEqual(rowCells(t, tree, "data-key", "billing"), ["billing", "0.70", "0.30"]);
      assert.deepEqual(rowCells(t, tree, "data-key", "shipping"), ["shipping", "0.20", "0.60"]);
      const noul = t.render(ctx({ qid: "urgent" }));
      assert.deepEqual(rowCells(t, noul, "data-key", "yes"), ["yes", "0.91", "0.88"]);
      assert.deepEqual(rowCells(t, noul, "data-key", "no"), ["no", "0.09", "0.12"]);
    },
    measurements: (t) => {
      const page = ctx();
      let tree = t.render(page);
      assert.deepEqual(field(t, tree, "latency"), ["400 ms", "560 ms"]);
      assert.deepEqual(field(t, tree, "input tokens"), ["300", "720"]);
      assert.deepEqual(field(t, tree, "cost"), ["$0.0001", "$0.0003"]);
      assert.deepEqual(field(t, tree, "calls"), ["—", "2"]);
      t.state.row = 4;
      assert.deepEqual(field(t, t.render(page), "call"), ["answered", "call failed: Rate limit reached"]);
      t.state.row = 6;
      assert.deepEqual(field(t, t.render(page), "call"), ["answered", "skipped by a stop"]);
    },
    step: (t) => {
      const page = ctx();
      let tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-action", "previous-row").attrs.disabled, true);
      t.fire(byAttr(t, tree, "data-action", "next-row"), "click");
      tree = t.render(page);
      assert.match(t.textOf(byAttr(t, tree, "data-heading", "row")), /^Row #2 of 7/);
      t.fire(byAttr(t, tree, "data-action", "previous-row"), "click");
      assert.match(t.textOf(byAttr(t, t.render(page), "data-heading", "row")), /^Row #1 of 7/);
      t.state.row = 6;
      assert.equal(byAttr(t, t.render(page), "data-action", "next-row").attrs.disabled, true);
    },
    copy: (t) => {
      t.fire(byAttr(t, t.render(ctx()), "data-action", "copy-row"), "click");
      const text = t.env.copied[0];
      assert.ok(text.startsWith("# Compare row #1: your Compare run's answers and the row's label for “department”"));
      assert.ok(text.includes("Label: billing"));
      assert.ok(text.includes("| pick | billing | shipping |"));
      assert.ok(text.includes("| billing | 0.70 | 0.30 |"));
      assert.match(text, /Row numbers count the tuning rows the run sent/);
      assert.match(t.env.toasts[0].message, /Copied row #1/);
    },
  } },
  session_runs: { improvements: {
    runs: (t) => {
      let tree = t.render(ctx());
      assert.deepEqual(rowCells(t, tree, "data-run", "Current run"),
        ["Current run", "A jev-1.14.0 · B jev-1.14.0, rows typos, both orders averaged", "7", "1", "$0.0019", "3200 ms", "department"]);
      tree = t.render(ctx({ result: RUN2 }));
      assert.deepEqual(rowCells(t, tree, "data-run", "Earlier run 1").slice(4, 7), ["$0.0019", "3200 ms", "department"]);
      assert.deepEqual(rowCells(t, tree, "data-run", "Current run").slice(4, 7), ["$0.0021", "4100 ms", "department"]);
      assert.match(t.textOf(t.render(empty())), /Earlier run 1/, "earlier runs stay listed while no report is on screen");
    },
    vs_previous: (t) => {
      t.render(ctx());
      t.render(ctx({ qid: "urgent" }));
      const better = { ...COMPARE_REPORTS.department, variants: [{ ...COMPARE_REPORTS.department.variants[0], correct: 3 }, COMPARE_REPORTS.department.variants[1]] };
      const tree = t.render(ctx({ result: RUN2, report: better }));
      assert.deepEqual(tableRows(t, tree, "vs-previous"), ["department"], "urgent is not scored in the current run");
      assert.deepEqual(rowCells(t, tree, "data-question", "department"), ["department", "2/4 (50.0%)", "3/4 (75.0%)", "2/4 (50.0%)", "2/4 (50.0%)"]);
    },
    forget: (t) => {
      t.render(ctx());
      const page = ctx({ result: RUN2 });
      t.fire(byAttr(t, t.render(page), "data-action", "forget-runs"), "click");
      const tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-run", "Earlier run 1"), null);
      assert.ok(byAttr(t, tree, "data-run", "Current run"));
      assert.equal(byAttr(t, tree, "data-action", "forget-runs"), null);
    },
  } },
  pooled_changed: { ctx: ctx(), expect: 7 / 12, empty: empty() },  // changed 4 + 1 + 1 + 0 + 1 of answered 5 + 5 + 1 + 0 + 1
  agree_accuracy: [
    { ctx: ctx(), expect: 1, empty: empty() },  // #3: both "other", label other
    // The same run with #3 labeled billing: both still answer "other", so the one agreeing labeled row is wrong.
    { ctx: ctx({ result: { ...COMPARE_RESULT, results: COMPARE_RESULT.results.map((row) => (row.index === 2 ? { ...row, expect: { department: "billing" } } : row)) } }), expect: 0 },
  ],
  majority_baseline: [
    { ctx: ctx(), expect: 0.5, empty: empty() },  // labels billing, shipping, other, shipping: "shipping" 2 of 4
    { ctx: ctx({ qid: "tone" }), expect: 1 },
    { ctx: ctx({ qid: "spot" }), expect: null },
    // Odd items with no answers: the label cannot be read against an answer, so there is nothing to measure.
    { ctx: fakeCtx({ items: [{ index: 0, paired: true, label: "billing", correct: [true, false] }, { index: 1, paired: "yes" }, null], data: { type: "choice" } }), expect: null },
  ],
  rewrite_effect: [
    { ctx: ctx(), expect: 1, empty: empty() },  // rewritten #1 #2 #4 #6 all differ (4/4); #3 as written agrees (0/1)
    { ctx: ctx({ qid: "urgent" }), expect: 0.25 },  // urgent: of the rewritten rows only #2 differs (1/4); #3 agrees
  ],
}, { ctx: () => sampleCompareRowsCtx() });
