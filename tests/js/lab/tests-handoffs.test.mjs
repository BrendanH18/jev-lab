import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/tests-handoffs.js";
import { mergeTestResults } from "../../../static/js/test-selection.js";
import { checkPack } from "./harness.mjs";
import { sampleTestsItemsCtx, sampleTestsRaw } from "./fixtures/workbench-tests.mjs";

// Default fixture ctx: refund-routing (pass), bean-quality (fail), damaged-bag-photo (error), wholesale-inquiry and
// unnamed-draft (not run) are shown; latte-art-feedback (fail, orphan expectation) is hidden by the archived filter and
// selected together with bean-quality. All fictional, made by the real surface builder.
const ctx = (overrides) => sampleTestsItemsCtx(overrides);
const feature = (id) => pack.features.find((entry) => entry.id === id);
const CRLF = (...lines) => lines.map((cells) => cells.map((cell) => `"${cell}"`).join(",")).join("\r\n") + "\r\n";

const URGENT = { type: "noul", instructions: "Does this need a reply today?" };
const INTENT = { type: "choice", instructions: "What does the customer want?", criteria: { refund: "Money back", replacement: "A new bag", question: "Just asking" } };
const QUALITY = { type: "score", instructions: "How happy is the reviewer?", criteria: ["Unhappy", "Mixed", "Happy"] };
const DAMAGE = { type: "box", instructions: "Where is the tear in `photo`?" };
const raw = (id, extra = {}) => ({ id, name: id, saved_at: "2026-10-01T09:30:00Z", state: "Order HC-1042 is late. sam@customer.example", questions: { urgent: URGENT }, ...extra });
const custom = (items, extra = {}) => ctx({ items, results: null, filters: {}, selected: [], ...extra });

// Inventory suite: urgent is asked three times with two wordings (b rewords it) and checked once (a); intent twice with
// two option lists and never checked. In a made-up session a's urgent failed and its intent was unchecked; b passed.
const INVENTORY_RAW = [
  raw("inv-a", { questions: { urgent: URGENT, intent: INTENT }, expect: { urgent: { min: 0.5 } } }),
  raw("inv-b", { state: "Another order", questions: { urgent: { ...URGENT, instructions: "Reply today?" } } }),
  raw("inv-c", { state: "A third order", questions: { urgent: URGENT }, expect: { urgent: {} } }),
  raw("inv-d", { state: "A fourth order", questions: { intent: { ...INTENT, criteria: { refund: "Money back", question: "Just asking" } } } }),
];
const run = (id, ok, results) => ({ id, name: id, ok, elapsed_ms: 300, meta: { model: "jev-1.2", latency_ms: 280, question_count: 2, input_tokens: 80, output_tokens: 6, cost_usd: 0.0001, backend: "sdk" }, results });
const INVENTORY = () => ctx({ items: INVENTORY_RAW, filters: {}, selected: [], results: mergeTestResults(null, { runs: [
  run("inv-a", false, { urgent: { ok: false, checks: ["0.30 < 0.50"], answer: { type: "noul", noul: 0.3 } },
    intent: { ok: null, checks: ["no expectation"], answer: { type: "choice", choice: "refund", probabilities: { refund: 0.8, replacement: 0.1, question: 0.1 }, confidence: 0.8 } } }),
  run("inv-b", true, { urgent: { ok: null, checks: ["no expectation"], answer: { type: "noul", noul: 0.6 } } }),
], wall_ms: 600, cost_usd: 0.0002 }, INVENTORY_RAW) });

// Two tests to compare (and a third with a text input).
const DIFF_RAW = [
  raw("order-a", { state: { order: "HC-1", note: "late", stars: 2 }, questions: { intent: INTENT, urgent: URGENT, quality: QUALITY },
    expect: { intent: { choice: "refund" }, urgent: { min: 0.5 } }, images: { photo: { sample: "torn-bag" } } }),
  raw("order-b", { state: { order: "HC-1", note: "stale", channel: "email" },
    questions: { intent: { ...INTENT, criteria: { refund: "Money back", question: "Just asking", exchange: "Swap it" } }, urgent: { ...URGENT, instructions: "Reply today?" },
      quality: { type: "choice", instructions: QUALITY.instructions, criteria: { happy: "Happy", unhappy: "Unhappy" } }, tone: { type: "noul", instructions: "Is it rude?" } },
    expect: { intent: { choice: "refund", min: 0.5 } }, images: { photo: { file: "0123456789abcdef.png" }, back: { sample: "torn-bag" } } }),
  raw("order-c", { state: "Plain text order" }),
];

const section = (t, tree, name) => t.textOf(t.find(tree, (node) => node.attrs["data-section"] === name));
const cell = (t, tree, key) => t.textOf(t.find(tree, (node) => node.attrs["data-cell"] === key));
const control = (t, tree, action) => t.find(tree, (node) => node.attrs["data-action"] === action);
const rowIds = (t, tree) => t.findAll(tree, (node) => node.tag === "tr" && node.attrs["data-question"]).map((node) => node.attrs["data-question"]);
const rowCells = (t, tree, id) => t.find(tree, (node) => node.attrs["data-question"] === id).children.map(t.textOf);
const preview = (t, tree) => t.textOf(t.find(tree, (node) => node.attrs["data-preview"] === "planner"));
// Sets the planner's mode and value through its controls, the way a person types them.
function planWith(t, page, mode, value, seed) {
  t.fire(control(t, t.render(page), "planner-mode"), "change", { target: { value: mode } });
  t.fire(control(t, t.render(page), "planner-value"), "input", { target: { value } });
  if (seed !== undefined) t.fire(control(t, t.render(page), "planner-seed"), "input", { target: { value: seed } });
  return t.render(page);
}

checkPack(pack, {
  // Server times 430.1, 660.4 and 3.2 ms: 0.430, 0.660 and 0.003 s, 1.094 s in all (1093.7 ms).
  junit_xml: { ctx: ctx(), filename: "jev-tests-junit.xml", excludes: ["Budget reached", "0.91", "Hi, order"],
    text: [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<testsuites name=\"Jev saved tests\" tests=\"5\" failures=\"1\" errors=\"1\" skipped=\"2\" time=\"1.094\">",
      "  <testsuite name=\"Jev saved tests\" tests=\"5\" failures=\"1\" errors=\"1\" skipped=\"2\" time=\"1.094\">",
      "    <testcase classname=\"jev.workbench\" name=\"refund-routing\" time=\"0.430\"/>",
      "    <testcase classname=\"jev.workbench\" name=\"bean-quality\" time=\"0.660\">",
      "      <failure type=\"expectation\" message=\"Failed questions: quality\"/>",
      "    </testcase>",
      "    <testcase classname=\"jev.workbench\" name=\"damaged-bag-photo\" time=\"0.003\">",
      "      <error type=\"call\" message=\"The call failed; its error text is not included\"/>",
      "    </testcase>",
      "    <testcase classname=\"jev.workbench\" name=\"wholesale-inquiry\">",
      "      <skipped message=\"Not run in this page session\"/>",
      "    </testcase>",
      "    <testcase classname=\"jev.workbench\" name=\"unnamed-draft\">",
      "      <skipped message=\"Not run in this page session\"/>",
      "    </testcase>",
      "  </testsuite>",
      "</testsuites>",
      ""].join("\n") },
  tap: { ctx: ctx(), filename: "jev-tests.tap", excludes: ["Budget reached"],
    text: "TAP version 13\n1..5\nok 1 - refund-routing\nnot ok 2 - bean-quality: failed quality\nnot ok 3 - damaged-bag-photo: call error\n"
      + "ok 4 - wholesale-inquiry # SKIP not run in this page session\nok 5 - unnamed-draft # SKIP not run in this page session\n" },
  // Every test shown: latte-art-feedback adds an unchecked Score, a passed Noul and its orphan expectation (which failed).
  per_question_csv: { ctx: ctx({ filters: {} }), filename: "jev-tests-per-question.csv", excludes: ["refund\"\r", "0.6", "choice = "],
    text: CRLF(["test_id", "question_id", "type", "expectation", "verdict"],
      ["refund-routing", "intent", "choice", "option+bounds", "pass"], ["refund-routing", "urgent", "noul", "bounds", "pass"],
      ["bean-quality", "quality", "score", "bounds", "fail"],
      ["damaged-bag-photo", "damage", "box", "box", "error"], ["damaged-bag-photo", "torn", "noul", "none", "error"],
      ["wholesale-inquiry", "route", "choice", "option", "not run"], ["wholesale-inquiry", "spam", "noul", "empty", "not run"],
      ["latte-art-feedback", "tone", "score", "none", "unchecked"], ["latte-art-feedback", "mentions_milk", "noul", "bounds", "pass"],
      ["latte-art-feedback", "old_question", "", "orphan", "fail"]) },
  measurements_csv: { ctx: ctx(), filename: "jev-tests-measurements.csv",
    text: CRLF(["test_id", "status", "model", "backend", "questions", "input_tokens", "output_tokens", "latency_ms", "elapsed_ms", "cost_usd"],
      ["refund-routing", "pass", "jev-1.2", "sdk", "2", "180", "12", "412.5", "430.1", "0.00021"],
      ["bean-quality", "fail", "jev-1.2", "sdk", "1", "140", "9", "655", "660.4", "0.00015"],
      ["damaged-bag-photo", "error", "", "", "", "", "", "", "3.2", ""],
      ["wholesale-inquiry", "not-run", "", "", "", "", "", "", "", ""], ["unnamed-draft", "not-run", "", "", "", "", "", "", "", ""]) },
  coverage_matrix_csv: { ctx: ctx(), filename: "jev-tests-coverage-matrix.csv", excludes: ["wholesale\"", "0.5"],
    text: CRLF(["test_id", "intent", "urgent", "quality", "damage", "torn", "route", "spam"],
      ["refund-routing", "option+bounds", "bounds", "", "", "", "", ""], ["bean-quality", "", "", "bounds", "", "", "", ""],
      ["damaged-bag-photo", "", "", "", "box", "none", "", ""], ["wholesale-inquiry", "", "", "", "", "", "option", "empty"],
      ["unnamed-draft", "", "", "", "", "", "", ""]) },
  // urgent: three tests, two with an expect entry (inv-c's {} counts, as on the page); intent: two tests, none.
  inventory_csv: { ctx: INVENTORY(), filename: "jev-question-inventory-shown.csv",
    text: CRLF(["id", "tests", "withExpectations", "types"], ["urgent", "3", "2", "noul"], ["intent", "2", "0", "choice"]) },
  // Checked results with every test shown: old_question and quality failed once each; intent, mentions_milk and urgent
  // passed once each; tone is unchecked and left out. Most failures first, then by ID.
  failures_by_question_csv: { ctx: ctx({ filters: {} }), filename: "jev-tests-failures-by-question.csv",
    text: CRLF(["question_id", "checked", "passed", "failed"], ["old_question", "1", "0", "1"], ["quality", "1", "0", "1"],
      ["intent", "1", "1", "0"], ["mentions_milk", "1", "1", "0"], ["urgent", "1", "1", "0"]) },
  // Shown questions: intent, urgent, quality, damage, torn, route, spam; torn has no expectation and spam's is {}.
  // Latest spend of the shown calls: 0.00021 + 0.00015 = 0.00036.
  summary_markdown: { ctx: ctx(), filename: "jev-tests-summary.md", excludes: ["Hi, order", "refund"],
    text: ["# Jev saved tests summary", "",
      "- Shown tests: 5 of 6 saved",
      "- Questions: 7 (3 noul, 2 choice, 1 score, 1 box)",
      "- Questions an expectation checks: 5 of 7",
      "- Picture references: 1",
      "- Latest results of the shown tests: 1 passed, 1 failed, 1 error, 2 not run",
      "- Measured spend of those latest calls: $0.00036 (2 calls)",
      "- Session: 1 paid batch, $0.00066 measured spend, 2,100 ms wall time",
      "", "Counts only: no inputs, instructions, expected values or answers. Spend is measured, never an estimate.", ""].join("\n") },
  // Selected (in saved order): damaged-bag-photo (a bundled sample, not listed), the hidden latte-art-feedback, and
  // dock-upload with one stored picture and one unsafe file name; "Bad ID" cannot be a saved file name.
  file_paths: {
    ctx: ctx({ items: [...sampleTestsRaw(), raw("dock-upload", { state: { photo: "photo", back: "back" }, questions: { damage: DAMAGE },
      images: { photo: { file: "0123456789abcdef.png" }, back: { file: "../escape.png" } } }), raw("Bad ID")],
    selected: ["Bad ID", "dock-upload", "damaged-bag-photo", "latte-art-feedback"] }),
    filename: "jev-selected-test-files.txt", excludes: ["torn-bag", "escape", "Bad ID"],
    text: "data/workbench/damaged-bag-photo.json\ndata/workbench/latte-art-feedback.json\ndata/workbench/dock-upload.json\ndata/workbench/images/0123456789abcdef.png\n" },
  check_text_markdown: { ctx: ctx(), filename: "jev-tests-check-text.md",
    includes: ["quotes answers and expected values",
      "| Test | Status | Question | Check text |\n| --- | --- | --- | --- |\n",
      "| refund-routing | pass | intent | choice = refund; 0.91 ≥ 0.60 |\n| refund-routing | pass | urgent | 0.72 ≥ 0.50 |\n",
      "| bean-quality | fail | quality | 0.40 < 1.00; 0.40 ≤ 2.00 |\n| damaged-bag-photo | error | — | Budget reached for this session |"],
    excludes: ["wholesale-inquiry", "Hi, order", "What does the customer want"] },

  // Types: refund-routing adds choice and noul, then bean-quality score (first of three that add one), then
  // damaged-bag-photo box.
  select_type_cover: { ctx: () => ctx({ filters: {} }), hidden: () => ctx({ busy: true }),
    check: (c) => { assert.deepEqual(c.state.selected, ["refund-routing", "bean-quality", "damaged-bag-photo"]); assert.match(c.env.toasts[0].message, /Undo selection change/); } },
  // Expected options: refund-routing (intent) and wholesale-inquiry (route).
  select_option_cover: { ctx: () => ctx({ filters: {} }), hidden: () => ctx({ items: [sampleTestsRaw()[1]] }),
    check: (c) => assert.deepEqual(c.state.selected, ["refund-routing", "wholesale-inquiry"]) },
  // set-1 and set-2 ask urgent (set-2 reworded); set-3 asks urgent and intent; no-questions asks nothing.
  select_one_per_question_set: {
    ctx: () => custom([raw("set-1"), raw("set-2", { questions: { urgent: { ...URGENT, instructions: "Reply today?" } } }),
      raw("set-3", { questions: { urgent: URGENT, intent: INTENT } }), raw("no-questions", { questions: null })]),
    hidden: () => custom([raw("no-questions", { questions: null })]),
    check: (c) => assert.deepEqual(c.state.selected, ["set-1", "set-3"]) },
  // quality failed in bean-quality's latest run; bean-blend also asks quality. latte's old_question is an orphan, not a question.
  select_failure_neighbours: {
    ctx: () => ctx({ items: [...sampleTestsRaw(), raw("bean-blend", { questions: { quality: QUALITY } })], filters: {} }), hidden: () => ctx({ results: null }),
    check: (c) => assert.deepEqual(c.state.selected, ["bean-quality", "bean-blend"]) },
  // copy-b repeats copy-a with its questions in another order; copy-d repeats copy-a exactly.
  select_repeat_copies: {
    ctx: () => custom([raw("copy-a", { questions: { urgent: URGENT, intent: INTENT } }), raw("copy-b", { questions: { intent: INTENT, urgent: URGENT } }),
      raw("other", { state: "Different order" }), raw("copy-d", { questions: { urgent: URGENT, intent: INTENT } })]),
    hidden: () => ctx(),
    check: (c) => assert.deepEqual(c.state.selected, ["copy-b", "copy-d"]) },
  add_shared_inputs: {
    ctx: () => custom([raw("in-a"), raw("in-b", { questions: { intent: INTENT } }), raw("in-c", { state: "Different order" })], { selected: ["in-a"] }),
    hidden: () => ctx(),
    check: (c) => { assert.deepEqual(c.state.selected, ["in-a", "in-b"]); assert.match(c.env.toasts[0].message, /^Added 1 test/); } },
  keep_shown_selection: { ctx: () => ctx(), hidden: () => ctx({ filters: {} }),
    check: (c) => { assert.deepEqual(c.state.selected, ["bean-quality"]); assert.match(c.env.toasts[0].message, /Removed 1 hidden test/); } },
  // Shown failing tests: bean-quality (fail) and damaged-bag-photo (error).
  open_next_failing: { ctx: () => ctx({ editingId: "bean-quality" }), hidden: () => ctx({ results: null }),
    check: (c) => {
      assert.deepEqual(c.log.filter((entry) => entry[0] === "open"), [["open", "damaged-bag-photo"]]);
      for (const [editing, expected] of [["damaged-bag-photo", "bean-quality"], [null, "bean-quality"], ["refund-routing", "bean-quality"], ["wholesale-inquiry", "bean-quality"]]) {
        const other = ctx({ editingId: editing });
        feature("open_next_failing").run(other);
        assert.deepEqual(other.log, [["open", expected]], `after ${editing}`);
      }
    } },
  open_previous_failing: { ctx: () => ctx({ editingId: "damaged-bag-photo" }), hidden: () => ctx({ results: null }),
    check: (c) => {
      assert.deepEqual(c.log, [["open", "bean-quality"]]);
      for (const [editing, expected] of [["bean-quality", "damaged-bag-photo"], [null, "damaged-bag-photo"], ["wholesale-inquiry", "damaged-bag-photo"], ["refund-routing", "damaged-bag-photo"]]) {
        const other = ctx({ editingId: editing });
        feature("open_previous_failing").run(other);
        assert.deepEqual(other.log, [["open", expected]], `after ${editing}`);
      }
    } },
  open_selected: { ctx: () => ctx({ selected: ["wholesale-inquiry"] }), hidden: () => ctx(),
    check: (c) => assert.deepEqual(c.log, [["open", "wholesale-inquiry"]]) },
  // Measured latency of the shown calls: refund-routing 412.5 ms, bean-quality 655 ms; latte-art-feedback (980 ms) when shown.
  inspect_slowest: { ctx: () => ctx(), hidden: () => ctx({ results: null }),
    check: (c) => {
      assert.deepEqual(c.log, [["inspect", "Test · Bean quality review"]]);
      const all = ctx({ filters: {} });
      feature("inspect_slowest").run(all);
      assert.deepEqual(all.log, [["inspect", "Test · Latte art feedback"]]);
    } },
  inspect_editing: { ctx: () => ctx({ editingId: "refund-routing" }), hidden: () => ctx({ editingId: "wholesale-inquiry" }),
    check: (c) => assert.deepEqual(c.log, [["inspect", "Test · Refund routing"]]) },
  copy_status_line: { ctx: () => ctx(), hidden: () => ctx({ results: null }),
    check: (c) => assert.deepEqual(c.env.copied, ["Jev saved tests: 1 passed, 2 failed, 1 error, 2 not run of 6 saved · 1 paid batch · $0.00066 measured spend · 2,100 ms wall time"]) },

  question_matrix: { improvements: {
    grid: (t) => {
      const tree = t.render(ctx({ filters: {} }));
      assert.deepEqual(["refund-routing/intent", "bean-quality/quality", "damaged-bag-photo/torn", "wholesale-inquiry/route", "latte-art-feedback/tone", "refund-routing/quality"]
        .map((key) => cell(t, tree, key)), ["pass", "fail", "error", "not run", "unchecked", "—"]);
    },
    totals: (t) => {
      const tree = t.render(INVENTORY());
      const total = (id) => t.textOf(t.find(tree, (node) => node.attrs["data-total"] === id));
      assert.equal(total("urgent"), "3 asked · 0 pass · 1 fail");
      assert.equal(total("intent"), "2 asked · 0 pass · 0 fail");
    },
    failing_only: (t) => {
      const page = ctx({ filters: {} });
      t.fire(control(t, t.render(page), "failing-only"), "click");
      assert.equal(t.state.failingOnly, true);
      const heads = t.findAll(t.render(page), (node) => node.tag === "th" && node.children.some((child) => child?.attrs?.["data-select-column"]));
      assert.deepEqual(heads.map((node) => node.children[0]), ["quality"]);
      assert.ok(t.find(t.render(custom([raw("quiet")])), (node) => node.attrs["data-empty"] === "matrix"));
    },
    select_column: (t) => {
      const page = INVENTORY();
      t.fire(t.find(t.render(page), (node) => node.attrs["data-select-column"] === "urgent"), "click");
      assert.deepEqual(page.state.selected, ["inv-a", "inv-b", "inv-c"]);
      assert.match(t.env.toasts[0].message, /^Selected 3 tests that ask urgent\. Undo selection change/);
    },
    add_row: (t) => {
      const page = ctx();
      t.fire(t.find(t.render(page), (node) => node.attrs["data-add-row"] === "wholesale-inquiry"), "click");
      assert.deepEqual(page.state.selected, ["bean-quality", "wholesale-inquiry", "latte-art-feedback"]);
      const busy = ctx({ busy: true });
      t.fire(t.find(t.render(busy), (node) => node.attrs["data-add-row"] === "refund-routing"), "click");
      assert.equal(t.env.toasts.at(-1).kind, "error");
    },
  } },
  question_inventory: { improvements: {
    table: (t) => {
      const tree = t.render(INVENTORY());
      assert.deepEqual(rowCells(t, tree, "urgent").slice(0, 4), ["urgent", "3", "1", "noul"]);
      assert.deepEqual(rowCells(t, tree, "intent").slice(0, 4), ["intent", "2", "0", "choice"]);
    },
    variants: (t) => {
      const tree = t.render(INVENTORY());
      assert.deepEqual(rowCells(t, tree, "urgent").slice(4, 6), ["2", "0"]);
      assert.deepEqual(rowCells(t, tree, "intent").slice(4, 6), ["1", "2"]);
    },
    search: (t) => {
      const page = INVENTORY();
      t.fire(control(t, t.render(page), "inventory-query"), "input", { target: { value: " INT " } });
      assert.deepEqual(rowIds(t, t.render(page)), ["intent"]);
      t.fire(control(t, t.render(page), "inventory-query"), "input", { target: { value: "zzz" } });
      assert.ok(t.find(t.render(page), (node) => node.attrs["data-empty"] === "inventory"));
    },
    sort: (t) => {
      const page = INVENTORY();
      assert.deepEqual(rowIds(t, t.render(page)), ["intent", "urgent"]);
      t.fire(control(t, t.render(page), "inventory-sort"), "change", { target: { value: "tests" } });
      assert.deepEqual(rowIds(t, t.render(page)), ["urgent", "intent"]);
      t.fire(control(t, t.render(page), "inventory-sort"), "change", { target: { value: "id" } });
      t.fire(control(t, t.render(page), "inventory-sort"), "change", { target: { value: "failures" } });
      const tree = t.render(page);
      assert.deepEqual(rowIds(t, tree), ["urgent", "intent"]);
      // The failures column it sorts by: inv-a's urgent failed (1 of 1 checked); intent was never checked.
      assert.equal(rowCells(t, tree, "urgent")[6], "1 / 1");
      assert.equal(rowCells(t, tree, "intent")[6], "—");
    },
    select_minority: (t) => {
      const page = INVENTORY();
      const tree = t.render(page);
      assert.equal(t.find(tree, (node) => node.attrs["data-minority"] === "intent"), null);
      t.fire(t.find(tree, (node) => node.attrs["data-minority"] === "urgent"), "click");
      assert.deepEqual(page.state.selected, ["inv-b"]);
      assert.match(t.env.toasts[0].message, /^Selected 1 test whose wording of urgent differs/);
    },
  } },
  // Shown with the default filter: refund-routing ($0.00021, 412.5 ms, saved 2026-10-01), bean-quality ($0.00015, 655 ms,
  // 2026-10-15), damaged-bag-photo (error, 2026-11-02), wholesale-inquiry and unnamed-draft (not run, no saved time).
  selection_planner: { improvements: {
    spend_cap: (t) => {
      const page = ctx();
      let tree = planWith(t, page, "spend", "0.0003");
      assert.match(preview(t, tree), /^Would select 1 test: bean-quality\. \$0\.00015 latest measured spend; not an estimate.* 3 shown tests without a measured value are left out\.$/);
      tree = planWith(t, page, "spend", "0.00036");
      assert.match(preview(t, tree), /^Would select 2 tests: refund-routing, bean-quality\./);
      t.fire(control(t, tree, "planner-apply"), "click");
      assert.deepEqual(page.state.selected, ["refund-routing", "bean-quality"]);
      assert.equal(page.log.some((entry) => entry[0] === "run"), false);
    },
    latency_cap: (t) => {
      const page = ctx();
      assert.match(preview(t, planWith(t, page, "latency", "1000")), /^Would select 1 test: refund-routing\. 413 ms summed latest latency \(not wall time\)/);
      const tree = planWith(t, page, "latency", "1100");
      assert.match(preview(t, tree), /^Would select 2 tests: refund-routing, bean-quality\. 1,068 ms/);
      assert.match(preview(t, planWith(t, page, "latency", "-5")), /^Enter a latency cap/);
      assert.equal(control(t, t.render(page), "planner-apply").attrs.disabled, true);
    },
    // Shown order: refund-routing, bean-quality, damaged-bag-photo, wholesale-inquiry, unnamed-draft. The sampled
    // positions were computed with a separate Python port of mulberry32 and the partial Floyd draw: 2 of 5 with seed 7 is
    // [0, 4], with seed 8 [0, 3]; 3 of 5 with seed 2 is [1, 2, 4].
    random_sample: (t) => {
      const page = ctx();
      const tree = planWith(t, page, "random", "2", "7");
      assert.match(preview(t, tree), /^Would select 2 tests: refund-routing, unnamed-draft\. Seed 7:/);
      assert.equal(preview(t, t.render(page)), preview(t, tree), "the same seed gives the same sample");
      t.fire(control(t, tree, "planner-apply"), "click");
      assert.deepEqual(page.state.selected, ["refund-routing", "unnamed-draft"]);
      assert.match(preview(t, planWith(t, page, "random", "2", "8")), /^Would select 2 tests: refund-routing, wholesale-inquiry\./);
      assert.match(preview(t, planWith(t, page, "random", "3", "2")), /^Would select 3 tests: bean-quality, damaged-bag-photo, unnamed-draft\./);
      assert.match(preview(t, planWith(t, page, "random", "9", "2")), /^Would select 5 tests:/, "N above the shown count takes them all");
      assert.match(preview(t, planWith(t, page, "random", "0", "7")), /^Enter a whole number N/);
      assert.match(preview(t, planWith(t, page, "random", "2", "-1")), /^Enter a whole-number seed/);
      assert.equal(page.log.some((entry) => entry[0] === "run"), false);
    },
    every_nth: (t) => {
      const page = ctx();
      const tree = planWith(t, page, "nth", "2");
      assert.match(preview(t, tree), /^Would select 3 tests: refund-routing, damaged-bag-photo, unnamed-draft\./);
      t.fire(control(t, tree, "planner-apply"), "click");
      assert.deepEqual(page.state.selected, ["refund-routing", "damaged-bag-photo", "unnamed-draft"]);
    },
    most_recent: (t) => {
      const page = ctx();
      const tree = planWith(t, page, "recent", "2");
      assert.match(preview(t, tree), /^Would select 2 tests: bean-quality, damaged-bag-photo\. By last saved time\. 2 shown tests without a saved time are left out\.$/);
      t.fire(control(t, tree, "planner-apply"), "click");
      assert.deepEqual(page.state.selected, ["bean-quality", "damaged-bag-photo"]);
    },
  } },
  compare_two: { improvements: {
    questions: (t) => {
      const page = custom(DIFF_RAW);
      assert.equal(section(t, t.render(page), "questions"), "Question IDsonly in order-b: tone");
      t.fire(control(t, t.render(page), "diff-b"), "change", { target: { value: "order-c" } });
      assert.equal(section(t, t.render(page), "questions"), "Question IDsonly in order-a: intent, quality");
    },
    shape: (t) => {
      const text = section(t, t.render(custom(DIFF_RAW)), "shape");
      assert.ok(text.includes("intent: options added exchange; options removed replacement"), text);
      assert.ok(text.includes("quality: type score → choice"), text);
      assert.ok(!text.includes("urgent"), text);
    },
    wording: (t) => {
      const text = section(t, t.render(custom(DIFF_RAW)), "wording");
      assert.equal(text, "Wordingurgent: the wording differs");
      assert.ok(!text.includes("Reply today"));
    },
    expectations: (t) => {
      const text = section(t, t.render(custom(DIFF_RAW)), "expectations");
      assert.equal(text, "Expectation kindsintent: option → option+boundsurgent: bounds → none");
    },
    input: (t) => {
      const page = custom(DIFF_RAW);
      const text = section(t, t.render(page), "input");
      assert.equal(text, "Input and picturesfields added: channelfields removed: starsfields changed: notepictures added: backpictures changed: photo");
      assert.ok(!text.includes("stale") && !text.includes("HC-1"));
      t.fire(control(t, t.render(page), "diff-b"), "change", { target: { value: "order-c" } });
      assert.match(section(t, t.render(page), "input"), /input shape object → text/);
    },
  } },
}, { ctx: () => ctx() });

test("tests-handoffs: exports and planner stay quiet or explain themselves on an empty page and odd items", () => {
  const empty = custom([]);
  for (const id of ["junit_xml", "tap", "per_question_csv", "measurements_csv", "coverage_matrix_csv", "inventory_csv", "summary_markdown"]) {
    const text = feature(id).build(empty);
    assert.equal(typeof text, "string", id);
    assert.ok(!/NaN|undefined/.test(text), `${id}: ${text}`);
  }
  assert.match(feature("tap").build(empty), /^TAP version 13\n1\.\.0\n$/);
  assert.throws(() => feature("failures_by_question_csv").build(empty), /Run tests first/);
  assert.throws(() => feature("check_text_markdown").build(empty), /Run tests first/);
  assert.throws(() => feature("file_paths").build(empty), /Select saved tests first/);
  const odd = custom([{ id: "odd-1", questions: "nope", expect: 3, images: [1] }, { id: "odd-2", state: { a: 1 }, questions: { q: null } }]);
  for (const id of ["junit_xml", "tap", "per_question_csv", "measurements_csv", "coverage_matrix_csv", "inventory_csv", "summary_markdown"]) {
    assert.ok(!/NaN|undefined/.test(feature(id).build(odd)), id);
  }
});

test("tests-handoffs: no export holds a request, an input or an instruction", () => {
  assert.equal(pack.features.some((entry) => entry.id === "requests_jsonl"), false);
  const page = ctx({ filters: {} });
  for (const entry of pack.features.filter((one) => one.kind === "exporter" && one.id !== "file_paths")) {
    let text = "";
    try { text = entry.build(page); } catch { continue; }
    for (const secret of ["Hi, order HC-1042", "Dark roast tasted burnt", "What does the customer want", "Money back", "archived: replaced"]) {
      assert.ok(!text.includes(secret), `${entry.id} holds ${secret}`);
    }
  }
});
