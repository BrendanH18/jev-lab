// Tests for static/js/lab/packs/workbench/tests-panels.js. Besides the Tests fixture (tests/js/lab/fixtures/workbench-tests.mjs)
// it builds a five-test suite whose tests share question IDs, run three times through the page's own mergeTestResults:
//   run 1  t1 pass (intent refund .80 conf .70; urgent .90)       t2 fail (intent replacement .60 conf .90; urgent .20)
//          t3 fail (intent replacement .45 conf .40; urgent .60)  t4 fail (intent refund .50 conf .30; quality 1.5 conf .60)
//   run 2  t1 fail (intent refund .55 conf .50)  t2 pass (refund .70 conf .60, model jev-1.3)  t3 fail (replacement .48 conf .50)
//          t4 edited (expects refund now), pass (refund .90 conf .80)
//   run 3  t1 pass again.   t5 is never run.
// Reference values (Wilson intervals, margins, means) are worked out by hand; the Wilson bounds were checked with a
// separate Python computation of jev/calibrate.py's formula.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/tests-panels.js";
import { mergeTestResults } from "../../../static/js/test-selection.js";
import { checkPack } from "./harness.mjs";
import { sampleTestsItemsCtx } from "./fixtures/workbench-tests.mjs";

const INTENT = { type: "choice", instructions: "What does the customer want?", criteria: { refund: "Money back", replacement: "A new bag", question: "Just asking" } };
const URGENT = { type: "noul", instructions: "Does this need a reply today?" };
const QUALITY = { type: "score", instructions: "How happy is the reviewer?", criteria: ["Unhappy", "Mixed", "Happy"] };

function suite({ edited = false } = {}) {
  return [
    { id: "t1", name: "T1", state: "Refund please for order HC-1.", questions: { intent: INTENT, urgent: URGENT }, expect: { intent: { choice: "refund", min: 0.6 }, urgent: { min: 0.5 } } },
    { id: "t2", name: "T2", state: "Refund for HC-2?", questions: { intent: INTENT, urgent: URGENT }, expect: { intent: { choice: "refund" }, urgent: { max: 0.3 } } },
    { id: "t3", name: "T3", state: "Send a new bag for HC-3.", questions: { intent: INTENT, urgent: URGENT }, expect: { intent: { choice: "replacement", min: 0.5 } } },
    { id: "t4", name: "T4", state: "The beans were fine, I guess?", questions: { intent: INTENT, quality: QUALITY },
      expect: { intent: { choice: edited ? "refund" : "question" }, quality: { min: 1, max: 2 } } },
    { id: "t5", name: "T5", state: "Money back please.", questions: { intent: INTENT }, expect: { intent: { choice: "refund" } } },
  ];
}

const choice = (pick, refund, replacement, question, confidence) => ({ type: "choice", choice: pick, probabilities: { refund, replacement, question }, confidence });
const noul = (p) => ({ type: "noul", noul: p });
const score = (value, confidence) => ({ type: "score", score: value, legend: { 0: "Unhappy", 1: "Mixed", 2: "Happy" }, probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 }, confidence });
const check = (ok, answer) => ({ ok, checks: ["made up for tests"], answer });
const run = (id, ok, results, latency, cost, { model = "jev-1.2", trace = true } = {}) => ({ id, name: id.toUpperCase(), ok, elapsed_ms: latency + 10,
  meta: { model, latency_ms: latency, question_count: 2, input_tokens: 100, output_tokens: 10, cost_usd: cost, backend: "sdk" },
  ...(trace ? { trace: { request: { state: "made up" }, response: {} } } : {}), results });

const BATCH1 = { runs: [
  run("t1", true, { intent: check(true, choice("refund", 0.8, 0.15, 0.05, 0.7)), urgent: check(true, noul(0.9)) }, 400, 0.0002),
  run("t2", false, { intent: check(false, choice("replacement", 0.3, 0.6, 0.1, 0.9)), urgent: check(true, noul(0.2)) }, 500, 0.0003),
  run("t3", false, { intent: check(false, choice("replacement", 0.35, 0.45, 0.2, 0.4)), urgent: check(null, noul(0.6)) }, 600, 0.0001),
  run("t4", false, { intent: check(false, choice("refund", 0.5, 0.1, 0.4, 0.3)), quality: check(true, score(1.5, 0.6)) }, 700, 0.0002, { trace: false }),
], wall_ms: 900, cost_usd: 0.0008 };
const BATCH2 = { runs: [
  run("t1", false, { intent: check(false, choice("refund", 0.55, 0.3, 0.15, 0.5)), urgent: check(true, noul(0.9)) }, 450, 0.00025),
  run("t2", true, { intent: check(true, choice("refund", 0.7, 0.2, 0.1, 0.6)), urgent: check(true, noul(0.1)) }, 480, 0.0004, { model: "jev-1.3" }),
  run("t3", false, { intent: check(false, choice("replacement", 0.3, 0.48, 0.22, 0.5)), urgent: check(null, noul(0.6)) }, 650, 0.0001),
  run("t4", true, { intent: check(true, choice("refund", 0.9, 0.05, 0.05, 0.8)), quality: check(true, score(1.5, 0.6)) }, 700, 0.0002),
], wall_ms: 900, cost_usd: 0.00095 };
const BATCH3 = { runs: [run("t1", true, { intent: check(true, choice("refund", 0.8, 0.15, 0.05, 0.7)), urgent: check(true, noul(0.9)) }, 410, 0.0002)], wall_ms: 400, cost_usd: 0.0002 };

const RESULTS1 = mergeTestResults(null, BATCH1, suite());
const RESULTS2 = mergeTestResults(RESULTS1, BATCH2, suite({ edited: true }));
const RESULTS3 = mergeTestResults(RESULTS2, BATCH3, suite({ edited: true }));
const S1 = () => sampleTestsItemsCtx({ items: suite(), results: RESULTS1, filters: {}, selected: [] });
const S2 = () => sampleTestsItemsCtx({ items: suite({ edited: true }), results: RESULTS2, filters: {}, selected: [] });
const S3 = () => sampleTestsItemsCtx({ items: suite({ edited: true }), results: RESULTS3, filters: {}, selected: [] });
const fixture = (overrides = {}) => sampleTestsItemsCtx(overrides);
const empty = () => sampleTestsItemsCtx({ results: null });

// One saved Box test: expected box .1/.2/.5/.6, answer .1/.2/.5/.5 → IoU .12 / .16 = .75, margin .75 − .5 = .25.
const BOX_RAW = [{ id: "box-1", name: "Box", state: { photo: "photo" }, questions: { damage: { type: "box", instructions: "Where is the tear in `photo`?" } },
  expect: { damage: { box: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 }, iou_min: 0.5 } }, images: { photo: { sample: "torn-bag" } } }];
const BOX_CTX = () => sampleTestsItemsCtx({ items: BOX_RAW, filters: {}, selected: [],
  results: mergeTestResults(null, { runs: [run("box-1", true, { damage: check(true, { type: "box", box: { left: 0.1, top: 0.2, right: 0.5, bottom: 0.5 }, confidence: 0.7 }) }, 300, 0.0001)] }, BOX_RAW) });

const byAttr = (t, tree, name, value) => t.find(tree, (node) => node.attrs?.[name] === value);
const cellsOf = (t, row) => row.children.filter((child) => child && (child.tag === "td" || child.tag === "th")).map(t.textOf);
const rowCells = (t, tree, name, value) => cellsOf(t, byAttr(t, tree, name, value));
const rowsOf = (t, tree, table, name) => t.findAll(byAttr(t, tree, "data-table", table) || {}, (node) => node.tag === "tr" && node.attrs?.[name]).map((node) => node.attrs[name]);
const choose = (t, tree, action, value, event = "change") => t.fire(byAttr(t, tree, "data-action", action), event, { target: { value } });

checkPack(pack, {
  question_answers: { improvements: {
    table: (t) => {
      const page = S1();
      let tree = t.render(page);
      assert.deepEqual(rowsOf(t, tree, "answers", "data-test"), ["t1", "t2", "t3", "t4", "t5"]);
      assert.deepEqual(rowCells(t, tree, "data-test", "t1").slice(0, 4), ["t1", "pass", "option refund, p ≥ 0.6", "refund (p 0.80)"]);
      assert.deepEqual(rowCells(t, tree, "data-test", "t2").slice(0, 5), ["t2", "fail", "option refund", "replacement (p 0.60)", "0.90"]);
      assert.deepEqual(rowCells(t, tree, "data-test", "t5").slice(0, 5), ["t5", "not run", "option refund", "—", "—"]);
      choose(t, tree, "answers-question", "urgent");
      tree = t.render(page);
      assert.deepEqual(rowsOf(t, tree, "answers", "data-test"), ["t1", "t2", "t3"]);
      assert.deepEqual(rowCells(t, tree, "data-test", "t3").slice(0, 5), ["t3", "unchecked", "none", "P(yes) 0.60", "—"]);
      assert.match(t.textOf(t.render(sampleTestsItemsCtx({ items: [] }))), /The shown tests have no questions/);
      // Each listed row keeps the page's Open and, when the call has a trace, Inspect.
      t.state.qid = "intent";
      const again = S1();
      const rows = t.render(again);
      assert.equal(byAttr(t, rows, "data-inspect", "t4"), null, "t4's call has no trace");
      assert.equal(byAttr(t, rows, "data-inspect", "t5"), null, "t5 was not run");
      t.fire(byAttr(t, rows, "data-open", "t3"), "click");
      t.fire(byAttr(t, rows, "data-inspect", "t1"), "click");
      assert.deepEqual(again.log, [["open", "t3"], ["inspect", "Test · T1"]]);
      // An answer of an odd shape reads as unknown, not "undefined".
      const odd = sampleTestsItemsCtx({ items: suite(), filters: {}, selected: [], results: mergeTestResults(null, { runs: [run("t1", false, { intent: check(false, { type: "choice", probabilities: {} }) }, 400, 0.0002)] }, suite()) });
      assert.deepEqual(rowCells(t, t.render(odd), "data-test", "t1").slice(0, 4), ["t1", "fail", "option refund, p ≥ 0.6", "—"]);
    },
    margin: (t) => {
      const page = S1();
      let tree = t.render(page);
      const margin = (id) => rowCells(t, tree, "data-test", id)[5];
      assert.deepEqual(["t1", "t2", "t3", "t4", "t5"].map(margin), ["+0.20", "—", "-0.05", "—", "—"]);  // .80 − .6; option only; .45 − .5
      t.state.qid = "urgent";
      tree = t.render(page);
      assert.deepEqual(["t1", "t2", "t3"].map(margin), ["+0.40", "+0.10", "—"]);  // .90 − .5; .3 − .20; no expectation
      t.state.qid = "quality";
      tree = t.render(page);
      assert.equal(margin("t4"), "+0.50");  // 1.5 inside [1, 2]: min(.5, .5)
      tree = t.render(fixture({ filters: {} }));
      assert.equal(rowCells(t, tree, "data-test", "bean-quality")[5], "-0.60");  // score .4 under min 1
      t.state.qid = "damage";
      tree = t.render(BOX_CTX());
      assert.equal(rowCells(t, tree, "data-test", "box-1")[5], "+0.25");
    },
    sort: (t) => {
      const page = S1();
      choose(t, t.render(page), "answers-sort", "margin");
      assert.deepEqual(rowsOf(t, t.render(page), "answers", "data-test"), ["t3", "t1", "t2", "t4", "t5"]);
      choose(t, t.render(page), "answers-sort", "confidence");
      assert.deepEqual(rowsOf(t, t.render(page), "answers", "data-test"), ["t4", "t3", "t1", "t2", "t5"]);
      choose(t, t.render(page), "answers-sort", "shown");
      assert.deepEqual(rowsOf(t, t.render(page), "answers", "data-test"), ["t1", "t2", "t3", "t4", "t5"]);
    },
    failed_only: (t) => {
      const page = S1();
      t.fire(byAttr(t, t.render(page), "data-action", "answers-failed-only"), "click");
      assert.deepEqual(rowsOf(t, t.render(page), "answers", "data-test"), ["t2", "t3", "t4"]);
      t.state.qid = "urgent";
      assert.ok(byAttr(t, t.render(page), "data-empty", "answers"));
    },
    copy: (t) => {
      t.fire(byAttr(t, t.render(S1()), "data-action", "answers-copy"), "click");
      const text = t.env.copied[0];
      assert.ok(text.startsWith("# Answers for question ID “intent”: your latest answers and expected values"));
      assert.ok(text.includes("| t3 | fail | option replacement, p ≥ 0.5 | replacement (p 0.45) | 0.40 | -0.05 |"));
      assert.match(text, /never an import format/);
      assert.match(t.env.toasts[0].message, /holds your expected values and latest answers/);
    },
  } },
  rerun_report: { improvements: {
    status_changes: (t) => {
      assert.ok(byAttr(t, t.render(S1()), "data-empty", "report"), "one result per test: nothing to compare yet");
      const tree = t.render(S2());
      assert.deepEqual(rowsOf(t, tree, "report", "data-change"), ["t1", "t2", "t3", "t4"]);
      assert.deepEqual(rowCells(t, tree, "data-change", "t1").slice(0, 4), ["t1", "pass", "fail", "broke"]);
      assert.deepEqual(rowCells(t, tree, "data-change", "t2").slice(0, 4), ["t2", "fail", "pass", "fixed"]);
      assert.deepEqual(rowCells(t, tree, "data-change", "t3").slice(0, 4), ["t3", "fail", "fail", "unchanged"]);
      assert.match(t.textOf(t.render(empty())), /Run tests first/);
    },
    regressions: (t) => {
      t.render(S1());
      const tree = t.render(S2());
      assert.equal(t.textOf(byAttr(t, tree, "data-broke", "t1")), "intent");
      assert.equal(t.textOf(byAttr(t, tree, "data-broke", "t2")), "—");
      assert.equal(t.textOf(byAttr(t, tree, "data-broke", "t4")), "—");
    },
    fixes: (t) => {
      t.render(S1());
      const tree = t.render(S2());
      assert.equal(t.textOf(byAttr(t, tree, "data-fixed", "t2")), "intent");
      assert.equal(t.textOf(byAttr(t, tree, "data-fixed", "t4")), "intent");
      assert.equal(t.textOf(byAttr(t, tree, "data-fixed", "t1")), "—");
    },
    confidence_shift: (t) => {
      t.render(S1());
      const tree = t.render(S2());
      assert.deepEqual(rowCells(t, tree, "data-shift", "t1/intent"), ["t1", "intent", "0.70", "0.50", "-0.20"]);
      assert.deepEqual(rowCells(t, tree, "data-shift", "t2/intent"), ["t2", "intent", "0.90", "0.60", "-0.30"]);
      assert.deepEqual(rowCells(t, tree, "data-shift", "t3/intent"), ["t3", "intent", "0.40", "0.50", "+0.10"]);
      assert.equal(byAttr(t, tree, "data-shift", "t1/urgent"), null, "yes/no answers carry no confidence");
    },
    measured_delta: (t) => {
      t.render(S1());
      const tree = t.render(S2());
      assert.deepEqual(["t1", "t2", "t3", "t4"].map((id) => t.textOf(byAttr(t, tree, "data-latency", id))), ["+50 ms", "-20 ms", "+50 ms", "+0 ms"]);
      assert.deepEqual(["t1", "t2", "t3"].map((id) => t.textOf(byAttr(t, tree, "data-cost", id))), ["+$0.00005", "+$0.0001", "+$0"]);
    },
    edited_between: (t) => {
      t.render(S1());
      const tree = t.render(S2());
      assert.equal(t.textOf(byAttr(t, tree, "data-notes", "t4")), "edited between runs");
      assert.equal(t.textOf(byAttr(t, tree, "data-notes", "t3")), "—");
    },
    model_changed: (t) => {
      t.render(S1());
      const tree = t.render(S2());
      assert.equal(t.textOf(byAttr(t, tree, "data-notes", "t2")), "model jev-1.2 → jev-1.3");
      assert.equal(t.textOf(byAttr(t, tree, "data-notes", "t1")), "—");
    },
    history: (t) => {
      t.render(S1());
      t.render(S2());
      const tree = t.render(S3());
      assert.deepEqual(rowsOf(t, tree, "history", "data-history"), ["t1", "t2", "t3", "t4"], "t5 never ran");
      assert.deepEqual(rowCells(t, tree, "data-history", "t1").slice(0, 3), ["t1", "3", "pass → fail → pass"]);
      assert.deepEqual(rowCells(t, tree, "data-history", "t2").slice(0, 3), ["t2", "2", "fail → pass"]);
      t.render(S3());
      assert.deepEqual(rowCells(t, t.render(S3()), "data-history", "t1").slice(0, 3), ["t1", "3", "pass → fail → pass"], "seeing the same result again adds no attempt");
    },
    flaky: (t) => {
      t.render(S1());
      t.render(S2());
      const tree = t.render(S3());
      assert.equal(t.textOf(byAttr(t, tree, "data-flaky", "t1")), "2 (flaky)");
      assert.equal(t.textOf(byAttr(t, tree, "data-flaky", "t2")), "0", "t2's flip came with a model change (jev-1.2 → jev-1.3)");
      assert.equal(t.textOf(byAttr(t, tree, "data-flaky", "t4")), "0", "t4 was edited between its runs");
    },
    changed_only: (t) => {
      t.render(S1());
      const page = S2();
      t.fire(byAttr(t, t.render(page), "data-action", "changed-only"), "click");
      assert.deepEqual(rowsOf(t, t.render(page), "report", "data-change"), ["t1", "t2", "t4"]);
      t.fire(byAttr(t, t.render(page), "data-action", "changed-only"), "click");
      assert.deepEqual(rowsOf(t, t.render(page), "report", "data-change"), ["t1", "t2", "t3", "t4"]);
    },
    copy: (t) => {
      t.render(S1());
      t.fire(byAttr(t, t.render(S2()), "data-action", "copy-report"), "click");
      const text = t.env.copied[0];
      assert.ok(text.includes("| t1 | pass | fail | broke | intent | — | +50 ms | +$0.00005 | — |"));
      assert.ok(text.includes("| t4 | fail | pass | fixed | — | intent | +0 ms | +$0 | edited between runs |"));
      for (const answer of ["0.70", "refund", "made up"]) assert.ok(!text.includes(answer), `the report copy must not hold ${answer}`);
    },
    forget: (t) => {
      t.render(S1());
      const page = S2();
      t.fire(byAttr(t, t.render(page), "data-action", "forget-attempts"), "click");
      assert.deepEqual(t.state.attempts, {});
      const tree = t.render(page);
      assert.ok(byAttr(t, tree, "data-empty", "report"));
      assert.deepEqual(rowCells(t, tree, "data-history", "t1").slice(0, 3), ["t1", "1", "fail"]);
    },
  } },
  pass_rates: { improvements: {
    table: (t) => {
      const tree = t.render(S1());
      assert.deepEqual(rowsOf(t, tree, "rates", "data-question"), ["intent", "urgent", "quality"]);
      assert.deepEqual(rowCells(t, tree, "data-question", "intent").slice(0, 6), ["intent", "choice", "4", "1", "25.0%", "4.6%–69.9%"]);
      assert.deepEqual(rowCells(t, tree, "data-question", "urgent").slice(0, 6), ["urgent", "noul", "2", "2", "100.0%", "34.2%–100.0%"]);
      assert.deepEqual(rowCells(t, tree, "data-question", "quality").slice(0, 6), ["quality", "score", "1", "1", "100.0%", "20.7%–100.0%"]);
      assert.match(t.textOf(t.render(empty())), /Run tests first/);
    },
    sort: (t) => {
      const page = S1();
      choose(t, t.render(page), "rates-sort", "low");
      assert.deepEqual(rowsOf(t, t.render(page), "rates", "data-question"), ["intent", "quality", "urgent"]);  // 4.6%, 20.7%, 34.2%
      choose(t, t.render(page), "rates-sort", "rate");
      assert.deepEqual(rowsOf(t, t.render(page), "rates", "data-question"), ["intent", "urgent", "quality"]);  // 25%, then the tie in first-seen order
      choose(t, t.render(page), "rates-sort", "checked");
      assert.deepEqual(rowsOf(t, t.render(page), "rates", "data-question"), ["intent", "urgent", "quality"]);  // 4, 2, 1
      choose(t, t.render(page), "rates-sort", "seen");
      assert.deepEqual(rowsOf(t, t.render(page), "rates", "data-question"), ["intent", "urgent", "quality"]);
    },
    below: (t) => {
      const page = S1();
      choose(t, t.render(page), "rates-below", "50", "input");
      assert.deepEqual(rowsOf(t, t.render(page), "rates", "data-question"), ["intent"]);
      choose(t, t.render(page), "rates-below", "150", "input");
      let tree = t.render(page);
      assert.ok(byAttr(t, tree, "data-error", "below"));
      assert.equal(rowsOf(t, tree, "rates", "data-question").length, 3, "a share out of range filters nothing");
      choose(t, t.render(page), "rates-below", "", "input");
      tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-error", "below"), null);
      assert.equal(rowsOf(t, tree, "rates", "data-question").length, 3);
    },
    type_filter: (t) => {
      const page = S1();
      choose(t, t.render(page), "rates-type", "score");
      assert.deepEqual(rowsOf(t, t.render(page), "rates", "data-question"), ["quality"]);
      choose(t, t.render(page), "rates-type", "box");
      assert.ok(byAttr(t, t.render(page), "data-empty", "rates"));
    },
    confidence_split: (t) => {
      const tree = t.render(S1());
      assert.deepEqual(rowCells(t, tree, "data-question", "intent").slice(6, 8), ["0.70", "0.53"]);  // passed t1 .70; failed (.90 + .40 + .30) / 3
      assert.deepEqual(rowCells(t, tree, "data-question", "urgent").slice(6, 8), ["—", "—"]);
      assert.deepEqual(rowCells(t, tree, "data-question", "quality").slice(6, 8), ["0.60", "—"]);
    },
    option_confusion: (t) => {
      const tree = t.render(S1());
      const head = t.find(byAttr(t, tree, "data-table", "confusion"), (node) => node.tag === "thead");
      assert.deepEqual(t.findAll(head, (node) => node.tag === "th").map(t.textOf), ["expected \\ chosen", "refund", "replacement", "question"]);
      const at = (key) => t.textOf(byAttr(t, tree, "data-oc", key));
      assert.deepEqual(["refund|refund", "refund|replacement", "replacement|replacement", "question|refund", "question|question"].map(at), ["1", "1", "1", "1", "0"]);
    },
    select_failing: (t) => {
      const page = S1();
      const tree = t.render(page);
      assert.equal(byAttr(t, tree, "data-select-failing", "urgent").attrs.disabled, true);
      t.fire(byAttr(t, tree, "data-select-failing", "intent"), "click");
      assert.deepEqual(page.state.selected, ["t2", "t3", "t4"]);
      assert.match(t.env.toasts[0].message, /^Selected 3 tests whose check of intent failed\. Undo selection change/);
    },
    csv: (t) => {
      t.fire(byAttr(t, t.render(S1()), "data-action", "rates-csv"), "click");
      const [file] = t.env.downloads;
      assert.equal(file.filename, "jev-question-pass-rates.csv");
      assert.equal(file.mime, "text/csv");
      assert.equal(file.text, '"question_id","types","checked","passed","pass_rate","wilson_low","wilson_high"\r\n'
        + '"intent","choice","4","1","0.2500","0.0456","0.6994"\r\n"urgent","noul","2","2","1.0000","0.3424","1.0000"\r\n"quality","score","1","1","1.0000","0.2065","1.0000"\r\n');
    },
  } },
  mixed_question_ids: [
    { ctx: S1(), expect: 1, empty: empty() },  // intent passes in t1 and fails in t2, t3, t4
    { ctx: fixture(), expect: 0 },  // every question ID of the fixture is asked by one test
  ],
  confidence_gap: [
    { ctx: S1(), expect: 0.65 - 1.6 / 3, empty: empty() },  // passed .70 (t1 intent), .60 (t4 quality); failed .90, .40, .30
    { ctx: fixture(), expect: 0.88 - 0.55 },  // passed refund-routing intent .88; failed bean-quality .55
  ],
  one_check_away: [
    { ctx: S1(), expect: 3, empty: empty() },  // t2, t3, t4 each fail only intent
    { ctx: fixture({ filters: {} }), expect: 2 },  // bean-quality, and latte-art-feedback's orphan expectation
    { ctx: fixture(), expect: 1 },  // latte-art-feedback hidden by the default filter
  ],
  confident_failures: [
    { ctx: S1(), expect: 1, empty: empty() },  // t2 intent at .90
    { ctx: fixture(), expect: 0 },
  ],
  closest_miss: [
    { ctx: S1(), expect: 0.05, empty: empty(), tolerance: 1e-9 },  // t3: .45 under min .5; t2 and t4 expect an option only
    { ctx: fixture(), expect: 0.6 },  // bean-quality: .4 under min 1
  ],
}, { ctx: () => sampleTestsItemsCtx() });
