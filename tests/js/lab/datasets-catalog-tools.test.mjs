import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/datasets-catalog-tools.js";
import { checkPack } from "./harness.mjs";
import { sampleDatasetsCatalogCtx, sampleDatasetsRaw } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsCatalogCtx(overrides);
const all = () => ctx({ filters: {} });
const none = () => ctx({ datasets: [] });
// Two datasets that both label intent (a-set 3 rows, b-set 2 rows); only a-set labels tone.
const shared = () => ctx({ filters: {}, loadedId: null, pinnedIds: [], datasets: [
  { id: "a-set", name: "A set", rows: 3, labeled: 3, labels: { intent: 3, tone: 1 }, questions: 2 },
  { id: "b-set", name: "B set", rows: 2, labeled: 2, labels: { intent: 2 }, questions: 1 }] });
const NEVER_SCORED = { id: "new-split", name: "New split", saved_at: "2026-11-01T00:00:00Z", rows: 10, labeled: 10, labels: { a: 10 }, questions: 1,
  test: { rows: 3, labeled: 3, share: 0.3, looks: 0, locked_at: "2026-11-01T00:00:00Z" } };
const feature = (id) => pack.features.find((entry) => entry.id === id);
const NOTES = ["support@harbor.example", "second labeler", "replaced by", "jev-1.1", "jev-1.2", "gates"];
const rowsOf = (t, tree, attr) => t.findAll(tree, (node) => node.tag === "tr" && node.attrs?.[attr]).map((row) => row.children.map(t.textOf));

checkPack(pack, {
  // Shown by default: bean (quality), harbor (intent, urgent), wholesale (route, spam, legacy_tag); archived adds refund.
  question_ids: [{ ctx: ctx(), expect: (r) => { assert.equal(r.value, 6); assert.equal(r.detail, "in 5 datasets"); }, empty: none() },
    { ctx: all(), expect: 7 }],
  shared_question_ids: [{ ctx: shared(), expect: (r) => { assert.equal(r.value, 1); assert.equal(r.detail, "intent"); }, empty: none() },
    { ctx: ctx(), expect: 0 }],
  // archived-refunds is pinned but the default "archived" exclusion hides it.
  pinned_hidden: [{ ctx: ctx({ pinnedIds: ["archived-refunds", "bean-reviews"] }), expect: (r) => { assert.equal(r.value, 1); assert.equal(r.detail, "archived-refunds"); },
    empty: none() }, { ctx: ctx(), expect: 0 }],
  // Shown dates: Sep 5 12:00 to Nov 11 07:30 is 66.8 days; with the archived Jun 1 10:00 it is 162.9 days.
  save_span_days: [{ ctx: ctx(), expect: (r) => { assert.equal(r.value, 66); assert.equal(r.detail, "2026-09-05 to 2026-11-11, 4 dated datasets"); }, empty: none() },
    { ctx: all(), expect: 162 }, { ctx: ctx({ filters: { query: "cafe" } }), expect: null }],
  // Unlabeled rows shown: bean 0, cafe 6, empty 0, harbor 10, wholesale 15.
  largest_backlog: [{ ctx: ctx(), expect: (r) => { assert.equal(r.value, 15); assert.equal(r.detail, "wholesale-leads"); }, empty: none() },
    { ctx: ctx({ filters: { query: "bean" } }), expect: (r) => { assert.equal(r.value, 0); assert.equal(r.detail, "every shown row has a label"); } }],

  labeling_checklist: { ctx: ctx(), filename: "jev-datasets-labeling-checklist.md", excludes: NOTES,
    text: "# Datasets still to label\n\n- [ ] cafe-photos (Cafe photos): 6 of 6 rows without a label\n"
      + "- [ ] harbor-support-inbox (Harbor support inbox): 10 of 40 rows without a label\n- [ ] wholesale-leads (Wholesale leads): 15 of 20 rows without a label\n" },
  stage_ids: { ctx: all(), filename: "jev-datasets-by-stage.txt",
    text: "empty (1): empty-draft\nunlabeled (1): cafe-photos\nlabeling (1): wholesale-leads\nlabeled (1): bean-reviews\nchecked (2): archived-refunds, harbor-support-inbox\n" },
  // archived: 3 held out, all labeled, 6 labeled tuning rows, share 1/3 to four places; harbor: 8, 6, 24, 0.2.
  split_csv: { ctx: all(), filename: "jev-dataset-splits.csv", excludes: NOTES,
    text: '"dataset","held_out_rows","held_out_labeled","tuning_labeled","held_out_share","test_looks","drawn_at"\r\n'
      + '"archived-refunds","3","3","6","0.3333","4","2026-06-02T09:00:00Z"\r\n"harbor-support-inbox","8","6","24","0.2","1","2026-10-31T09:00:00Z"\r\n' },

  // Shown order: bean, cafe, empty, harbor (loaded), wholesale.
  load_next: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["load", "wholesale-leads"]]), hidden: () => ctx({ loadedId: "wholesale-leads" }) },
  load_previous: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["load", "empty-draft"]]), hidden: () => ctx({ loadedId: "bean-reviews" }) },
  load_most_unlabeled: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["load", "wholesale-leads"]]), hidden: () => ctx({ loadedId: "wholesale-leads" }) },
  pin_labeling: { ctx: () => ctx(), check: (c) => {
    assert.deepEqual(c.state.filters.pinnedIds, ["bean-reviews", "harbor-support-inbox", "wholesale-leads"]);
    assert.match(c.env.toasts[0].message, /Pinned 2 datasets still being labeled/);
  }, hidden: () => ctx({ pinnedIds: ["harbor-support-inbox", "wholesale-leads"] }) },
  // Saved within 7 days of Nov 12 12:00: bean (already pinned) and empty-draft.
  pin_recent: { ctx: () => ctx(), check: (c) => {
    assert.deepEqual(c.state.filters.pinnedIds, ["bean-reviews", "empty-draft"]);
    assert.match(c.env.toasts[0].message, /Pinned 1 dataset saved in the last 7 days/);
  }, hidden: () => ctx({ pinnedIds: ["bean-reviews", "empty-draft"] }) },
  unpin_without_check: { ctx: () => ctx({ pinnedIds: ["bean-reviews", "harbor-support-inbox"] }),
    check: (c) => assert.deepEqual(c.state.filters.pinnedIds, ["harbor-support-inbox"]), hidden: () => ctx({ pinnedIds: ["harbor-support-inbox"] }) },
  unpin_hidden: { ctx: () => ctx({ pinnedIds: ["archived-refunds", "bean-reviews"] }), check: (c) => {
    assert.deepEqual(c.state.filters.pinnedIds, ["bean-reviews"]);
    assert.match(c.env.toasts[0].message, /Unpinned 1 hidden dataset/);
  }, hidden: () => ctx() },
  // bean-reviews is the first shown dataset with questions and labels whose panel is closed.
  open_first_agreement: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["openAgreement", "bean-reviews"]]),
    hidden: () => ctx({ agreementOpen: ["bean-reviews", "harbor-support-inbox", "wholesale-leads"] }) },
  copy_loaded_name: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.env.copied, ["Harbor support inbox"]), hidden: () => ctx({ loadedId: null }) },
  // No split and at least 4 labeled rows: bean (12) and wholesale (5); a "harbor" search shows only datasets with splits.
  copy_split_ready_ids: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.env.copied, ["bean-reviews\nwholesale-leads"]),
    hidden: () => ctx({ filters: { query: "harbor" } }) },
  copy_never_scored_ids: { ctx: () => ctx({ datasets: [...sampleDatasetsRaw(), NEVER_SCORED] }), check: (c) => assert.deepEqual(c.env.copied, ["new-split"]),
    hidden: () => ctx() },
  // Harbor has held-out rows, so only a dataset without one can be loaded as a copy.
  load_loaded_copy: { ctx: () => ctx({ loadedId: "bean-reviews" }), check: (c) => assert.deepEqual(c.log, [["loadCopy", "bean-reviews"]]), hidden: () => ctx() },
  download_loaded_bundle: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["downloadBundle", "harbor-support-inbox"]]), hidden: () => ctx({ loadedId: null }) },

  // 25% of 30 is 7.5: a tie, so 8. 10% of 4 is 0.4, raised to the 2-row minimum. 33.3% of 9 is 2.997, so 3.
  split_plan: { values: { labeled: 30, share: 25 }, expect: [["Labeled rows held out", 8], ["Labeled rows left for tuning", 22], ["Held-out share of labeled rows (%)", 26.7]],
    more: [{ values: { labeled: 4, share: 10 }, expect: [["Labeled rows held out", 2], ["Labeled rows left for tuning", 2], ["Held-out share of labeled rows (%)", 50]] },
      { values: { labeled: 30, share: 20 }, expect: [["Labeled rows held out", 6], ["Labeled rows left for tuning", 24], ["Held-out share of labeled rows (%)", 20]] },
      { values: { labeled: 9, share: 33.3 }, expect: [["Labeled rows held out", 3], ["Labeled rows left for tuning", 6], ["Held-out share of labeled rows (%)", 33.3]] },
      // 50% of 5 is 2.5, a tie that goes to the larger count (jev/testsplit.py key (distance, -count)): 3, leaving 2 for tuning.
      { values: { labeled: 5, share: 50 }, expect: [["Labeled rows held out", 3], ["Labeled rows left for tuning", 2], ["Held-out share of labeled rows (%)", 60]] },
      // A large count answers at once: 25% of 1,000,001 is 250,000.25, so 250,000.
      { values: { labeled: 1000001, share: 25 }, expect: [["Labeled rows held out", 250000], ["Labeled rows left for tuning", 750001], ["Held-out share of labeled rows (%)", 25]] }],
    invalid: [{ labeled: 3, share: 25 }, { labeled: 30, share: 60 }, { labeled: 30, share: 5 }, { labeled: 2.5, share: 25 }] },
  // 124 labeled at 20% holds out round(24.8) = 25, leaving 99; 125 holds out 25, leaving 100.
  // 39 at 25% holds out round(9.75) = 10, leaving 29; 40 holds out 10, leaving 30.
  tuning_size: { values: { tuning: 100, share: 20, labeled: 30 },
    expect: [["Labeled rows needed", 125], ["Held out at that size", 25], ["Labeled tuning rows at that size", 100], ["Rows still to label", 95]],
    more: [{ values: { tuning: 30, share: 25, labeled: 0 }, expect: [["Labeled rows needed", 40], ["Held out at that size", 10], ["Labeled tuning rows at that size", 30], ["Rows still to label", 40]] },
      { values: { tuning: 2, share: 50, labeled: 0 }, expect: [["Labeled rows needed", 4], ["Held out at that size", 2], ["Labeled tuning rows at that size", 2], ["Rows still to label", 4]] },
      { values: { tuning: 10, share: 0, labeled: 12 }, expect: [["Labeled rows needed", 10], ["Held out at that size", 0], ["Labeled tuning rows at that size", 10], ["Rows still to label", 0]] },
      // The largest input: 133,333 at 25% holds out round(33,333.25) = 33,333, leaving 100,000; 133,332 holds out 33,333
      // too (33,333 exactly), leaving 99,999.
      { values: { tuning: 100000, share: 25, labeled: 0 }, expect: [["Labeled rows needed", 133333], ["Held out at that size", 33333], ["Labeled tuning rows at that size", 100000], ["Rows still to label", 133333]] }],
    invalid: [{ tuning: 1, share: 20, labeled: 0 }, { tuning: 10, share: 60, labeled: 0 }, { tuning: 10, share: 20, labeled: -1 }] },

  stages: { improvements: {
    table: (t) => {
      // Default shown: empty-draft, cafe 6/6 unlabeled, wholesale 20 rows 15 unlabeled, bean 12 labeled, harbor 40 rows 10 unlabeled.
      assert.deepEqual(rowsOf(t, t.render(ctx()), "data-stage"), [["empty", "1", "0", "0", "Pin"], ["unlabeled", "1", "6", "6", "Pin"],
        ["labeling", "1", "20", "15", "Pin"], ["labeled", "1", "12", "0", "Pin"], ["checked", "1", "40", "10", "Pin"]]);
      // The archived dataset (9 rows, all labeled) joins harbor at checked.
      assert.deepEqual(rowsOf(t, t.render(all()), "data-stage").at(-1), ["checked", "2", "49", "10", "Pin"]);
      assert.match(t.textOf(t.render(none())), /No dataset is shown/);
    },
    copy: (t) => {
      t.fire(t.find(t.render(ctx()), (node) => node.attrs?.["data-copy"] === "stages"), "click");
      assert.deepEqual(t.env.copied, ["Stage\tDatasets\tRows\tRows without a label\nempty\t1\t0\t0\nunlabeled\t1\t6\t6\nlabeling\t1\t20\t15\nlabeled\t1\t12\t0\nchecked\t1\t40\t10"]);
    },
    pin: (t) => {
      const c = ctx();
      t.fire(t.find(t.render(c), (node) => node.attrs?.["data-pin-stage"] === "labeling"), "click");
      assert.deepEqual(c.state.filters.pinnedIds, ["bean-reviews", "wholesale-leads"]);
      assert.match(t.env.toasts[0].message, /Pinned 1 dataset at the labeling stage/);
      assert.deepEqual(c.log, [["setPins", ["bean-reviews", "wholesale-leads"]]]);
    },
  } },
  question_inventory: { improvements: {
    table: (t) => {
      assert.deepEqual(rowsOf(t, t.render(ctx()), "data-question"), [["intent", "1", "30", "harbor-support-inbox"], ["legacy_tag", "1", "1", "wholesale-leads"],
        ["quality", "1", "12", "bean-reviews"], ["route", "1", "5", "wholesale-leads"], ["spam", "1", "3", "wholesale-leads"], ["urgent", "1", "18", "harbor-support-inbox"]]);
      // A question in two datasets comes first: 3 + 2 labeled rows.
      assert.deepEqual(rowsOf(t, t.render(shared()), "data-question"), [["intent", "2", "5", "a-set, b-set"], ["tone", "1", "1", "a-set"]]);
      assert.match(t.textOf(t.render(ctx({ filters: { query: "cafe" } }))), /No shown dataset has a saved label/);
    },
    copy: (t) => {
      t.fire(t.find(t.render(shared()), (node) => node.attrs?.["data-copy"] === "questions"), "click");
      assert.deepEqual(t.env.copied, ["Question\tDatasets\tLabeled rows\tDataset IDs\nintent\t2\t5\ta-set, b-set\ntone\t1\t1\ta-set"]);
    },
  } },
  labeling_plan: { improvements: {
    progress: (t) => {
      const bars = t.findAll(t.render(ctx()), (node) => node.tag === "progress").map((node) => [node.attrs.max, node.attrs.value]);
      // empty-draft has no rows, so no bar.
      assert.deepEqual(bars, [["12", "12"], ["6", "0"], ["40", "30"], ["20", "5"]]);
    },
    target: (t) => {
      const needed = (tree) => t.findAll(tree, (node) => node.attrs?.["data-needed"] !== undefined).map((node) => node.attrs["data-needed"]);
      const total = (tree) => t.find(tree, (node) => node.attrs?.["data-total"] !== undefined).attrs["data-total"];
      let tree = t.render(ctx());
      assert.deepEqual(needed(tree), ["0", "6", "10", "15"]);
      assert.equal(total(tree), "31");
      // 80%: ceil(9.6) = 10 of 12, ceil(4.8) = 5 of 6, 32 of 40, 16 of 20.
      t.fire(t.find(tree, (node) => node.tag === "input"), "input", { target: { value: "80" } });
      tree = t.render(ctx());
      assert.deepEqual(needed(tree), ["0", "5", "2", "11"]);
      assert.equal(total(tree), "18");
      for (const bad of ["120", "", "half"]) {
        t.state.target = bad;
        assert.ok(t.find(t.render(ctx()), (node) => node.attrs?.["data-plan-error"]), bad);
      }
    },
    copy: (t) => {
      t.state.target = "80";
      t.fire(t.find(t.render(ctx()), (node) => node.attrs?.["data-copy"] === "plan"), "click");
      assert.deepEqual(t.env.copied, ["Dataset\tLabeled\tRows\tTo label for 80%\nbean-reviews\t12\t12\t0\ncafe-photos\t0\t6\t5\n"
        + "harbor-support-inbox\t30\t40\t2\nwholesale-leads\t5\t20\t11\nTotal\t\t\t18"]);
    },
  } },
  loaded_summary: { improvements: {
    summary: (t) => {
      const tree = t.render(ctx());
      assert.match(t.textOf(tree), /^Harbor support inbox \(harbor-support-inbox\)/);
      assert.deepEqual(t.findAll(tree, (node) => node.tag === "li").map(t.textOf),
        ["30 of 40 rows labeled", "2 saved questions", "8 held out, 1 test look", "saved check", "not pinned"]);
      assert.equal(t.find(tree, (node) => node.attrs?.["data-visibility"]).attrs["data-visibility"], "shown");
      assert.equal(t.find(tree, (node) => node.attrs?.["data-unsaved"]), null);
      assert.doesNotMatch(t.textOf(tree), /support@harbor/);
      const hidden = t.render(ctx({ filters: { query: "bean" }, unsaved: true }));
      assert.equal(t.find(hidden, (node) => node.attrs?.["data-visibility"]).attrs["data-visibility"], "hidden");
      assert.ok(t.find(hidden, (node) => node.attrs?.["data-unsaved"]));
      assert.match(t.textOf(t.render(ctx({ loadedId: null }))), /No saved dataset is loaded/);
    },
  } },
}, { ctx: () => ctx() });

test("datasets-catalog-tools: commands pick the right neighbour when the loaded dataset is hidden or a copy is loading", async () => {
  // The archived dataset is loaded but hidden: next is the first shown, previous the last shown.
  const forward = ctx({ loadedId: "archived-refunds" }), back = ctx({ loadedId: "archived-refunds" });
  await feature("load_next").run(forward);
  await feature("load_previous").run(back);
  assert.deepEqual([...forward.log, ...back.log], [["load", "bean-reviews"], ["load", "wholesale-leads"]]);
  assert.equal(feature("load_loaded_copy").when(ctx({ loadedId: "bean-reviews", copyBusy: true })), false);
  assert.equal(feature("load_next").when(none()), false);
});

test("datasets-catalog-tools: metrics read a page with nothing on it as unavailable", () => {
  for (const feature of pack.features.filter((entry) => entry.kind === "metric")) {
    assert.equal(feature.compute({}), null, feature.id);
    assert.equal(feature.compute({ shown: () => [], items: () => [], data: { total: 0, pinned_ids: [] } }), null, feature.id);
  }
});

test("datasets-catalog-tools: the split tools stay fast on their largest inputs", () => {
  const started = Date.now();
  feature("tuning_size").compute({ tuning: 100000, share: 50, labeled: 0 });
  feature("split_plan").compute({ labeled: 10000000, share: 10 });
  assert.ok(Date.now() - started < 500, "the split tools must not scan every count");
});
