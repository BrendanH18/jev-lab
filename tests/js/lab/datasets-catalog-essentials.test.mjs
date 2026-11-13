import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/datasets-catalog-essentials.js";
import { runDiagnostics, runExporter } from "../../../static/js/lab/kit.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { DATASETS_NOW, sampleDatasetsCatalogCtx, sampleDatasetsRaw } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsCatalogCtx(overrides);
const all = () => ctx({ filters: {} });
const D = Object.fromEntries(all().items().map((item) => [item.id, item]));
const ARCHIVED = D["archived-refunds"], BEAN = D["bean-reviews"], CAFE = D["cafe-photos"], EMPTY = D["empty-draft"];
const HARBOR = D["harbor-support-inbox"], WHOLESALE = D["wholesale-leads"];
// Items made by the real builder from hand-written summaries.
const made = (...raws) => ctx({ datasets: raws, filters: {}, loadedId: null }).items();
const [SPLIT_ONLY, RENAMED, CHECK_ONLY, TWIN, GAPPY, BARE, FUTURE_SPLIT, NO_TEST_LABELS] = made(
  { id: "latte-split", name: "Latte split", rows: 10, labeled: 10, labels: { foam: 10 }, questions: 1, guidelines: 0,
    test: { rows: 4, labeled: 4, share: 0.4, looks: 0, locked_at: "not a date" } },
  { id: "support-2025", name: "Support tickets", rows: 3, labeled: 1, labels: { intent: 1 }, questions: 1 },
  { id: "promo-check", name: "Promo check", rows: 8, labeled: 8, labels: { promo: 8 }, questions: 1, check: { gates: { promo: 0.6 } } },
  { id: "harbor-support-copy", name: "  harbor SUPPORT   inbox ", rows: 1, labeled: 0, questions: 0 },
  // Three saved questions, only two named by labels: the third has none.
  { id: "menu-gaps", name: "Menu gaps", rows: 6, labeled: 4, labels: { item: 4, size: 2 }, questions: 3 },
  // One saved question and no labels at all.
  { id: "bare-question", name: "Bare question", rows: 5, labeled: 0, labels: {}, questions: 1 },
  { id: "future-split", name: "Future split", rows: 10, labeled: 10, labels: { foam: 10 }, questions: 1,
    test: { rows: 4, labeled: 4, share: 0.4, looks: 0, locked_at: "2026-11-20T09:00:00Z" } },
  { id: "unlabeled-test", name: "Unlabeled test", rows: 12, labeled: 6, labels: { foam: 6 }, questions: 1,
    test: { rows: 4, labeled: 0, share: 0, looks: 0, locked_at: "2026-11-01T09:00:00Z" } },
);
// Hand-made odd items (not through the builder): facts must give null or false, never throw or NaN.
const ODD = { id: "odd", test: {}, labeled: 5, question_labels: "not a list", questions: "two" };
const ODD_SHARE = { id: "odd-share", test: { rows: 2 }, labeled: 0, held_out_labeled: 1 };

checkPack(pack, {
  // Harbor labels intent and urgent; bean only quality; wholesale names three IDs; cafe and the empty draft none.
  labeled_questions: { items: [HARBOR, BEAN, CAFE, WHOLESALE, EMPTY, ODD], values: [2, 1, 0, 3, 0, 0] },
  // min(30, 18); 12; min(5, 3, 1); cafe has no labels and no questions; menu-gaps' third saved question has 0;
  // bare-question's only saved question has 0.
  fewest_question_labels: { items: [HARBOR, BEAN, WHOLESALE, CAFE, GAPPY, BARE, ODD], values: [18, 12, 1, null, 0, 0, null] },
  // 30 - 18, 12 - 12, 5 - 1, unknown, 4 - 0, 0 - 0.
  question_label_spread: { items: [HARBOR, BEAN, WHOLESALE, CAFE, GAPPY, BARE], values: [12, 0, 4, null, 4, 0] },
  // Clock 2026-11-12T12:00Z: locked Oct 31 09:00 is 12 days 3 h back; Jun 2 09:00 is 163 days 3 h back
  // (Jun 2 -> Nov 2 is 30 + 31 + 31 + 30 + 31 = 153 days, then 10 more). A lock on Nov 20 is after the clock.
  split_age_days: { items: [HARBOR, ARCHIVED, BEAN, SPLIT_ONLY, FUTURE_SPLIT], values: [12, 163, null, null, null], ctx: all() },
  // 6 of 30 labeled rows held out; 3 of 9; no split; odd items have no usable counts.
  held_out_labeled_share: { items: [HARBOR, ARCHIVED, BEAN, ODD, ODD_SHARE], values: [0.2, 1 / 3, null, null, null], tolerance: 1e-12 },
  stage: { items: [EMPTY, HARBOR, CAFE, WHOLESALE, BEAN, SPLIT_ONLY, BARE], values: ["empty", "checked", "unlabeled", "labeling", "labeled", "split", "unlabeled"] },
  loaded: { items: [HARBOR, BEAN], values: [true, false] },
  can_copy: { items: [HARBOR, BEAN, ARCHIVED], values: [false, true, false] },
  split_ready: { items: [BEAN, CAFE, HARBOR, RENAMED], values: [true, false, false, false] },
  // "Support tickets" saves to support-tickets, not support-2025; a missing name shows the id itself; a name with
  // other spacing and case that still slugs to its own id is no mismatch.
  name_id_mismatch: { items: [RENAMED, HARBOR, EMPTY, TWIN, made({ id: "bean-reviews", name: "Bean  Reviews!" })[0]], values: [true, false, false, true, false] },
  // Wholesale labels route, spam and legacy_tag but saves 2 questions.
  stale_label_questions: { items: [WHOLESALE, HARBOR, CAFE, GAPPY], values: [true, false, false, false] },

  few_held_out: { hit: HARBOR, miss: [BEAN, made({ id: "big-split", rows: 60, labeled: 60, test: { rows: 15, labeled: 15, looks: 0 } })[0]], message: /^Only 6 held-out rows have a label/ },
  many_looks: { hit: ARCHIVED, miss: [HARBOR, BEAN], message: /scored 4 times/ },
  check_without_split: { hit: CHECK_ONLY, miss: [HARBOR, BEAN], message: /hold out test rows/ },
  duplicate_names: { hitList: [HARBOR, BEAN, TWIN], missList: [ARCHIVED, BEAN, CAFE, HARBOR], message: /^harbor-support-inbox, harbor-support-copy share a name\.$/ },

  // Shown by default: bean 12/12, cafe 0/6, empty 0/0, harbor 30/40, wholesale 5/20 -> 47 of 78.
  labeled_share: [{ ctx: ctx(), expect: (result) => { assert.ok(Math.abs(result.value - 47 / 78) < 1e-12); assert.equal(result.detail, "47 of 78 rows"); },
    empty: ctx({ datasets: [] }) },
  // Only the empty draft is shown: no rows to measure.
  { ctx: ctx({ filters: { query: "empty-draft" } }), expect: null }],
  // Only harbor has a split among the shown five (the archived one is hidden).
  split_datasets: [{ ctx: ctx(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "of 5 datasets"); }, empty: ctx({ datasets: [] }) },
    { ctx: all(), expect: 2 }],
  // Rows 12, 6, 0, 40, 20 -> 12; with the archived 9 too: 0, 6, 9, 12, 20, 40 -> 10.5.
  median_rows: [{ ctx: ctx(), expect: 12, empty: ctx({ datasets: [] }) }, { ctx: all(), expect: 10.5 }],

  catalog_markdown: { ctx: ctx(), filename: "jev-datasets-overview.md",
    text: "| Dataset | Name | Rows | Labeled | Held out | Questions | Saved check | Saved |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n"
      + "| bean-reviews | Bean reviews | 12 | 12 | 0 | 1 | no | 2026-11-10 |\n"
      + "| cafe-photos | Cafe photos | 6 | 0 | 0 | 0 | no | — |\n"
      + "| empty-draft | empty-draft | 0 | 0 | 0 | 0 | no | 2026-11-11 |\n"
      + "| harbor-support-inbox | Harbor support inbox | 40 | 30 | 8 | 2 | yes | 2026-10-30 |\n"
      + "| wholesale-leads | Wholesale leads | 20 | 5 | 0 | 2 | no | 2026-09-05 |\n",
    excludes: ["support@harbor.example", "second labeler", "archived-refunds", "jev-1.2"] },
  question_label_csv: { ctx: ctx(),
    text: '"dataset","question","labeled_rows"\r\n"bean-reviews","quality","12"\r\n"harbor-support-inbox","intent","30"\r\n'
      + '"harbor-support-inbox","urgent","18"\r\n"wholesale-leads","route","5"\r\n"wholesale-leads","spam","3"\r\n"wholesale-leads","legacy_tag","1"\r\n',
    excludes: ["Draft", "support@", "refund"] },

  // The newest saved_at among the shown is empty-draft (2026-11-11).
  load_newest: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["load", "empty-draft"]]), hidden: () => ctx({ filters: { query: "no such dataset" } }) },
  pin_with_split: { ctx: () => ctx(), check: (c) => {
    // The archived split is hidden by the default filter, so only harbor is pinned; bean keeps its pin.
    assert.deepEqual(c.state.filters.pinnedIds, ["bean-reviews", "harbor-support-inbox"]);
    assert.match(c.env.toasts[0].message, /^Pinned 1 dataset with held-out rows/);
  }, hidden: () => ctx({ pinnedIds: ["harbor-support-inbox"] }) },
  copy_loaded_id: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.env.copied, ["harbor-support-inbox"]), hidden: () => ctx({ loadedId: null }) },
  open_loaded_agreement: { ctx: () => ctx({ agreementOpen: [] }), check: (c) => assert.deepEqual(c.log, [["openAgreement", "harbor-support-inbox"]]),
    hidden: () => ctx() },

  // 90% of 40 is 36 labeled rows: 6 more than 30; 75% now. 50% of 7 is 3.5 -> 4. 33.3% of 3 is 0.999 -> 1.
  // 100% of 9 is 9: 7 more than 2; 2/9 = 22.2%.
  labels_to_target: { values: { rows: 40, labeled: 30, target: 90 }, expect: [["Rows to label", 6], ["Labeled share now (%)", 75], ["Labeled rows at the target", 36]],
    more: [{ values: { rows: 7, labeled: 7, target: 50 }, expect: [["Rows to label", 0], ["Labeled share now (%)", 100], ["Labeled rows at the target", 4]] },
      { values: { rows: 3, labeled: 0, target: 33.3 }, expect: [["Rows to label", 1], ["Labeled share now (%)", 0], ["Labeled rows at the target", 1]] },
      { values: { rows: 9, labeled: 2, target: 100 }, expect: [["Rows to label", 7], ["Labeled share now (%)", 22.2], ["Labeled rows at the target", 9]] }],
    invalid: [{ rows: 5, labeled: 6, target: 50 }, { rows: 0, labeled: 0, target: 50 }, { rows: 5, labeled: 1, target: 101 }] },
}, { ctx: () => ctx() });

const feature = (id) => pack.features.find((entry) => entry.id === id);

test("datasets-catalog-essentials: a split with no labeled held-out row gets its own message", () => {
  const findings = runDiagnostics([["few", feature("few_held_out")]], [NO_TEST_LABELS], fakeCtx({}));
  assert.deepEqual(findings.map((finding) => finding.message), ["No held-out row has a label yet, so the test rows cannot be scored."]);
});

test("datasets-catalog-essentials: the Markdown table escapes pipes in names", () => {
  const out = runExporter(feature("catalog_markdown"), ctx({ datasets: [{ id: "beans-grind", name: "Beans | grind", rows: 2, labeled: 1, questions: 1 }], filters: {} }));
  assert.ok(out.text.endsWith("| beans-grind | Beans \\| grind | 2 | 1 | 0 | 1 | no | — |\n"));
});

test("datasets-catalog-essentials: the fixture's clock and check configuration stay off the items", () => {
  assert.equal(all().data.now, DATASETS_NOW);
  assert.ok(sampleDatasetsRaw().some((raw) => raw.check));
  for (const item of all().items()) assert.equal(JSON.stringify(item).includes("gates"), false);
});
