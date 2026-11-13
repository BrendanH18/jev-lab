// Tests for the dataset catalog panels (static/js/lab/packs/workbench/datasets-panels.js). Expected values are worked
// out by hand from the summaries in tests/js/lab/fixtures/workbench-datasets.mjs (clock 2026-11-12T12:00:00Z);
// comments give the arithmetic where it is not obvious.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/datasets-panels.js";
import { checkPack } from "./harness.mjs";
import { sampleDatasetsCatalogCtx } from "./fixtures/workbench-datasets.mjs";

// Shown by default (the "archived" exclusion hides archived-refunds): bean-reviews, cafe-photos, empty-draft,
// harbor-support-inbox (loaded), wholesale-leads. bean-reviews is pinned.
const ctx = (overrides) => sampleDatasetsCatalogCtx(overrides);
const all = () => ctx({ filters: {} });
const shared = () => ctx({ filters: {}, loadedId: null, pinnedIds: [], datasets: [
  { id: "a-set", name: "A set", rows: 3, labeled: 3, labels: { intent: 3, tone: 1 }, questions: 2 },
  { id: "b-set", name: "B set", rows: 2, labeled: 2, labels: { intent: 2 }, questions: 1 }] });
// Words from notes and check configuration that must never appear in a panel or a copy.
const PRIVATE = ["support@harbor.example", "second labeler", "replaced by", "jev-1.1", "jev-1.2", "gates", "targets"];
const attr = (name, value) => (node) => node.attrs?.[name] === value;
const has = (name) => (node) => node.attrs?.[name] !== undefined && node.attrs?.[name] !== null;
const rowsBy = (t, tree, name) => t.findAll(tree, (node) => node.tag === "tr" && has(name)(node)).map((row) => row.children.map(t.textOf));
const tableOf = (t, tree, name) => t.find(tree, attr("data-table", name));
const headOf = (t, tree, name) => t.findAll(tableOf(t, tree, name), (node) => node.tag === "th").map(t.textOf);
const click = (t, tree, match) => t.fire(t.find(tree, match), "click");
const type = (t, tree, key, value) => t.fire(t.find(tree, attr("data-input", key)), "input", { target: { value } });
const choose = (t, tree, key, value) => t.fire(t.find(tree, attr("data-pick", key)), "change", { target: { value } });
const toggle = (t, tree, key) => t.fire(t.find(tree, attr("data-toggle", key)), "change", { target: { checked: true } });
const clean = (text) => { for (const word of PRIVATE) assert.ok(!text.includes(word), `must not show ${word}`); };

checkPack(pack, {
  coverage: { improvements: {
    matrix: (t) => {
      const tree = t.render(ctx());
      // Question ids with a label in the shown datasets, A to Z.
      assert.deepEqual(headOf(t, tree, "coverage"), ["Dataset", "intent", "legacy_tag", "quality", "route", "spam", "urgent"]);
      assert.deepEqual(rowsBy(t, tree, "data-dataset"), [["bean-reviews", "", "", "12", "", "", ""],
        ["harbor-support-inbox", "30", "", "", "", "", "18"], ["wholesale-leads", "", "1", "", "5", "3", ""]]);
      assert.equal(t.find(tree, has("data-without")).attrs["data-without"], "cafe-photos,empty-draft");
      clean(t.textOf(tree));
      assert.match(t.textOf(t.render(ctx({ datasets: [] }))), /No dataset is shown/);
    },
    shares: (t) => {
      toggle(t, t.render(ctx()), "shares");
      // 30/40, 18/40; 1/20, 5/20, 3/20; 12/12.
      assert.deepEqual(rowsBy(t, t.render(ctx()), "data-dataset"), [["bean-reviews", "", "", "100%", "", "", ""],
        ["harbor-support-inbox", "75%", "", "", "", "", "45%"], ["wholesale-leads", "", "5%", "", "25%", "15%", ""]]);
    },
    threshold: (t) => {
      type(t, t.render(ctx()), "threshold", "10");
      const tree = t.render(ctx());
      assert.deepEqual(t.findAll(tree, attr("data-low", "true")).map(t.textOf), ["1", "5", "3"]);
      assert.equal(t.textOf(t.find(tree, has("data-low-count"))), "3 cells under 10 labeled rows.");
      for (const bad of ["0", "ten", "2.5"]) {
        t.state.threshold = bad;
        assert.ok(t.find(t.render(ctx()), attr("data-threshold-error", "true")), bad);
      }
    },
    include_hidden: (t) => {
      toggle(t, t.render(ctx()), "hidden");
      const tree = t.render(ctx());
      assert.deepEqual(headOf(t, tree, "coverage"), ["Dataset", "intent", "legacy_tag", "quality", "refund", "route", "spam", "urgent"]);
      assert.deepEqual(rowsBy(t, tree, "data-dataset")[0], ["archived-refunds", "", "", "", "9", "", "", ""]);
    },
    sort_columns: (t) => {
      choose(t, t.render(ctx()), "columns", "rows");
      // Labeled rows per id: intent 30, urgent 18, quality 12, route 5, spam 3, legacy_tag 1.
      assert.deepEqual(headOf(t, t.render(ctx()), "coverage"), ["Dataset", "intent", "urgent", "quality", "route", "spam", "legacy_tag"]);
    },
    copy: (t) => {
      click(t, t.render(ctx()), attr("data-copy", "coverage"));
      assert.deepEqual(t.env.copied, ["Dataset\tintent\tlegacy_tag\tquality\troute\tspam\turgent\nbean-reviews\t\t\t12\t\t\t\n"
        + "harbor-support-inbox\t30\t\t\t\t\t18\nwholesale-leads\t\t1\t\t5\t3\t"]);
    },
  } },

  splits: { improvements: {
    table: (t) => {
      const cells = (tree) => rowsBy(t, tree, "data-flags").map((row) => row.slice(0, 8));
      assert.deepEqual(cells(t.render(ctx())), [["harbor-support-inbox", "8", "6", "32", "24", "20%", "1", "2026-10-31"]]);
      // archived: 3 of its 9 labeled rows are held out, 33%.
      assert.deepEqual(cells(t.render(all()))[0], ["archived-refunds", "3", "3", "6", "6", "33%", "4", "2026-06-02"]);
      assert.match(t.textOf(t.render(ctx({ filters: { query: "bean" } }))), /No shown dataset has a held-out split/);
    },
    thresholds: (t) => {
      const flags = rowsBy(t, t.render(all()), "data-flags").map((row) => [row[0], row[8]]);
      // Defaults: fewer than 10 labeled held-out rows, 3 or more looks. archived holds out 3, all labeled, 4 looks;
      // harbor holds out 8 rows, 6 labeled (8 - 6 = 2 without a label), 1 look.
      assert.deepEqual(flags, [["archived-refunds", "under 10 labeled held-out rows; scored 4 times"],
        ["harbor-support-inbox", "under 10 labeled held-out rows; 2 held-out rows without a label"]]);
      // Bounds are exact: 3 labeled is not under 3, and 4 looks is "4 or more".
      t.state.minLabeled = "3";
      t.state.manyLooks = "4";
      assert.deepEqual(rowsBy(t, t.render(all()), "data-flags").map((row) => row[8]), ["scored 4 times", "2 held-out rows without a label"]);
      // 0 turns a flag off.
      t.state.minLabeled = "0";
      t.state.manyLooks = "0";
      assert.deepEqual(rowsBy(t, t.render(all()), "data-flags").map((row) => row[8]), ["", "2 held-out rows without a label"]);
      t.state.minLabeled = undefined;
      t.state.manyLooks = undefined;
      const tree = t.render(all());
      type(t, tree, "minLabeled", "5");
      type(t, tree, "manyLooks", "5");
      assert.deepEqual(rowsBy(t, t.render(all()), "data-flags").map((row) => row[8]), ["under 5 labeled held-out rows", "2 held-out rows without a label"]);
      t.state.manyLooks = "many";
      assert.ok(t.find(t.render(all()), attr("data-threshold-error", "true")));
    },
    no_split: (t) => {
      assert.deepEqual(t.findAll(t.render(ctx()), has("data-no-split")).map(t.textOf), ["bean-reviews: 12 labeled rows, ready to hold out test rows",
        "cafe-photos: 0 labeled rows, needs 4 more labeled rows first", "empty-draft: 0 labeled rows, needs 4 more labeled rows first",
        "wholesale-leads: 5 labeled rows, ready to hold out test rows"]);
      const one = ctx({ filters: {}, datasets: [{ id: "tiny", name: "Tiny", rows: 5, labeled: 1, labels: { a: 1 }, questions: 1 }] });
      assert.deepEqual(t.findAll(t.render(one), has("data-no-split")).map(t.textOf), ["tiny: 1 labeled row, needs 3 more labeled rows first"]);
    },
    pin_flagged: (t) => {
      const c = ctx();
      click(t, t.render(c), attr("data-pin", "flagged"));
      // harbor's split is flagged; bean-reviews was pinned already and stays pinned.
      assert.deepEqual(c.log, [["setPins", ["bean-reviews", "harbor-support-inbox"]]]);
      assert.equal(t.env.toasts[0].message, "Pinned 1 dataset with a flagged split for this page session.");
      // With both flags off and every held-out row labeled, nothing is flagged and the button is disabled.
      t.state.minLabeled = "0";
      t.state.manyLooks = "0";
      const quiet = ctx({ datasets: [{ id: "solo", name: "Solo", rows: 10, labeled: 10, labels: { a: 10 }, questions: 1,
        test: { rows: 2, labeled: 2, share: 0.2, looks: 0, locked_at: null } }] });
      assert.equal(t.find(t.render(quiet), attr("data-pin", "flagged")).attrs.disabled, true);
    },
  } },

  checks: { improvements: {
    table: (t) => {
      const tree = t.render(ctx());
      // harbor: 0 check notes, 8 held out, 1 look, 40 - 8 = 32 tuning rows of which 30 - 6 = 24 labeled, saved 2026-10-30.
      assert.deepEqual(rowsBy(t, tree, "data-dataset"), [["harbor-support-inbox", "Harbor support inbox", "0", "8", "1", "24", "2026-10-30"]]);
      clean(t.textOf(tree));
      const both = t.render(all());
      assert.deepEqual(rowsBy(t, both, "data-dataset")[0], ["archived-refunds", "Archived refunds", "1", "3", "4", "6", "2026-06-01"]);
      clean(t.textOf(both));
      // A check without a split: no held-out rows and no test looks; every labeled row is a tuning row.
      const bare = ctx({ filters: {}, datasets: [{ id: "solo", name: "Solo", rows: 4, labeled: 3, labels: { a: 3 }, questions: 1,
        check: { gates: { a: 0.5 } }, check_notes: [], saved_at: "2026-11-01T00:00:00Z" }] });
      assert.deepEqual(rowsBy(t, t.render(bare), "data-dataset"), [["solo", "Solo", "0", "none", "", "3", "2026-11-01"]]);
      assert.match(t.textOf(t.render(ctx({ filters: { query: "bean" } }))), /No shown dataset has a saved check/);
    },
    copy: (t) => {
      click(t, t.render(all()), attr("data-copy", "checks"));
      assert.deepEqual(t.env.copied, ["Dataset\tName\tAdvisory notes\tHeld-out rows\tTest looks\tLabeled tuning rows\tSaved\n"
        + "archived-refunds\tArchived refunds\t1\t3\t4\t6\t2026-06-01\nharbor-support-inbox\tHarbor support inbox\t0\t8\t1\t24\t2026-10-30"]);
      clean(t.env.copied[0]);
      // A name a spreadsheet would run as a formula gets a leading apostrophe.
      const risky = ctx({ filters: {}, datasets: [{ id: "f", name: "=SUM(A1)", rows: 1, labeled: 1, labels: { a: 1 }, questions: 1, check: { gates: {} }, check_notes: [] }] });
      click(t, t.render(risky), attr("data-copy", "checks"));
      assert.equal(t.env.copied[1].split("\n")[1].split("\t")[1], "'=SUM(A1)");
    },
  } },

  pair: { improvements: {
    table: (t) => {
      const tree = t.render(ctx());
      // The first two shown datasets open first.
      assert.deepEqual(headOf(t, tree, "pair"), ["", "bean-reviews", "cafe-photos", "Name", "Rows", "Labeled rows", "Rows without a label", "Saved questions",
        "Guidelines", "Saved check", "Held-out rows", "Held-out labeled rows", "Test looks", "Last saved"]);
      assert.deepEqual(rowsBy(t, tree, "data-row").map((row) => row.slice(1)), [["Bean reviews", "Cafe photos"], ["12", "6"], ["12", "0"], ["0", "6"], ["1", "0"],
        ["0", "0"], ["no", "no"], ["0", "0"], ["0", "0"], ["no split", "no split"], ["2026-11-10T08:00:00Z", "unknown"]]);
      assert.match(t.textOf(t.render(ctx({ datasets: [] }))), /Two saved datasets are needed/);
    },
    differences: (t) => {
      const differing = (tree) => t.findAll(tree, attr("data-differs", "true")).map((row) => row.attrs["data-row"]);
      let tree = t.render(ctx());
      assert.deepEqual(differing(tree), ["Name", "Rows", "Labeled rows", "Rows without a label", "Saved questions", "Last saved"]);
      assert.equal(t.textOf(t.find(tree, has("data-differ-count"))), "6 of 11 values differ.");
      choose(t, tree, "a", "harbor-support-inbox");
      choose(t, tree, "b", "archived-refunds");
      tree = t.render(ctx());
      // Both have a saved check; every other value differs (40/9 rows, 30/9 labeled, 10/0, 2/1, 2/1, 8/3, 6/3, 1/4 looks).
      assert.equal(t.textOf(t.find(tree, has("data-differ-count"))), "10 of 11 values differ.");
      clean(t.textOf(tree));
    },
    questions: (t) => {
      let tree = t.render(ctx());
      assert.deepEqual(rowsBy(t, tree, "data-question"), [["quality", "12", ""]]);
      assert.equal(t.textOf(t.find(tree, has("data-shared"))), "No question ID is labeled in both.");
      tree = t.render(shared());
      assert.deepEqual(rowsBy(t, tree, "data-question"), [["intent", "3", "2"], ["tone", "1", ""]]);
      assert.equal(t.textOf(t.find(tree, has("data-shared"))), "1 question ID labeled in both.");
    },
  } },
}, { ctx: () => ctx() });
