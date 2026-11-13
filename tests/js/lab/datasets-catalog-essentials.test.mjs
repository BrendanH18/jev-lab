import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/datasets-catalog-essentials.js";
import { checkPack } from "./harness.mjs";
import { sampleDatasetsCatalogCtx, sampleDatasetsRaw } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsCatalogCtx(overrides);
const all = () => ctx({ filters: {} });
const D = Object.fromEntries(all().items().map((item) => [item.id, item]));
const ARCHIVED = D["archived-refunds"], BEAN = D["bean-reviews"], CAFE = D["cafe-photos"], EMPTY = D["empty-draft"];
const HARBOR = D["harbor-support-inbox"], WHOLESALE = D["wholesale-leads"];
// Items made by the real builder from hand-written summaries.
const made = (...raws) => ctx({ datasets: raws, filters: {}, loadedId: null }).items();
const [SPLIT_ONLY, RENAMED, CHECK_ONLY, TWIN] = made(
  { id: "latte-split", name: "Latte split", rows: 10, labeled: 10, labels: { foam: 10 }, questions: 1, guidelines: 0,
    test: { rows: 4, labeled: 4, share: 0.4, looks: 0, locked_at: "not a date" } },
  { id: "support-2025", name: "Support tickets", rows: 3, labeled: 1, labels: { intent: 1 }, questions: 1 },
  { id: "promo-check", name: "Promo check", rows: 8, labeled: 8, labels: { promo: 8 }, questions: 1, check: { gates: { promo: 0.6 } } },
  { id: "harbor-support-copy", name: "  harbor SUPPORT   inbox ", rows: 1, labeled: 0, questions: 0 },
);

checkPack(pack, {
  // Harbor labels intent and urgent; bean only quality; wholesale names three IDs; cafe and the empty draft none.
  labeled_questions: { items: [HARBOR, BEAN, CAFE, WHOLESALE, EMPTY], values: [2, 1, 0, 3, 0] },
  fewest_question_labels: { items: [HARBOR, BEAN, WHOLESALE, CAFE], values: [18, 12, 1, null] },
  // 30 - 18, 12 - 12, 5 - 1.
  question_label_spread: { items: [HARBOR, BEAN, WHOLESALE, CAFE], values: [12, 0, 4, null] },
  // Clock 2026-11-12T12:00Z: locked Oct 31 09:00 is 12 days 3 h back; Jun 2 09:00 is 163 days 3 h back.
  split_age_days: { items: [HARBOR, ARCHIVED, BEAN, SPLIT_ONLY], values: [12, 163, null, null], ctx: all() },
  // 6 of 30 labeled rows held out; 3 of 9; no split.
  held_out_labeled_share: { items: [HARBOR, ARCHIVED, BEAN], values: [0.2, 1 / 3, null] },
  stage: { items: [EMPTY, HARBOR, CAFE, WHOLESALE, BEAN, SPLIT_ONLY], values: ["empty", "checked", "unlabeled", "labeling", "labeled", "split"] },
  loaded: { items: [HARBOR, BEAN], values: [true, false] },
  can_copy: { items: [HARBOR, BEAN, ARCHIVED], values: [false, true, false] },
  split_ready: { items: [BEAN, CAFE, HARBOR], values: [true, false, false] },
  // "Support tickets" saves to support-tickets, not support-2025; a missing name shows the id itself.
  name_id_mismatch: { items: [RENAMED, HARBOR, EMPTY], values: [true, false, false] },
  // Wholesale labels route, spam and legacy_tag but saves 2 questions.
  stale_label_questions: { items: [WHOLESALE, HARBOR, CAFE], values: [true, false, false] },

  few_held_out: { hit: HARBOR, miss: [BEAN, made({ id: "big-split", rows: 60, labeled: 60, test: { rows: 15, labeled: 15, looks: 0 } })[0]], message: /Only 6 held-out rows have a label/ },
  many_looks: { hit: ARCHIVED, miss: [HARBOR, BEAN], message: /scored 4 times/ },
  check_without_split: { hit: CHECK_ONLY, miss: [HARBOR, BEAN], message: /hold out test rows/ },
  duplicate_names: { hitList: [HARBOR, BEAN, TWIN], missList: [ARCHIVED, BEAN, CAFE, HARBOR], message: /harbor-support-inbox, harbor-support-copy share a name/ },

  // Shown by default: bean 12/12, cafe 0/6, empty 0/0, harbor 30/40, wholesale 5/20 -> 47 of 78.
  labeled_share: { ctx: ctx(), expect: (result) => { assert.ok(Math.abs(result.value - 47 / 78) < 1e-12); assert.equal(result.detail, "47 of 78 rows"); },
    empty: ctx({ datasets: [] }) },
  // Only harbor has a split among the shown five (the archived one is hidden).
  split_datasets: [{ ctx: ctx(), expect: 1, empty: ctx({ datasets: [] }) }, { ctx: all(), expect: 2 }],
  // Rows 12, 6, 0, 40, 20 -> 12; with the archived 9 too: 0, 6, 9, 12, 20, 40 -> 10.5.
  median_rows: [{ ctx: ctx(), expect: 12, empty: ctx({ datasets: [] }) }, { ctx: all(), expect: 10.5 }],

  catalog_markdown: { ctx: ctx(), filename: "jev-datasets-overview.md",
    includes: ["| Dataset | Name | Rows | Labeled | Held out | Questions | Saved check | Saved |",
      "| harbor-support-inbox | Harbor support inbox | 40 | 30 | 8 | 2 | yes | 2026-10-30 |",
      "| cafe-photos | Cafe photos | 6 | 0 | 0 | 0 | no | — |", "| empty-draft | empty-draft | 0 | 0 | 0 | 0 | no | 2026-11-11 |"],
    excludes: ["support@harbor.example", "second labeler", "archived-refunds", "jev-1.2"] },
  question_label_csv: { ctx: ctx(),
    text: '"dataset","question","labeled_rows"\r\n"bean-reviews","quality","12"\r\n"harbor-support-inbox","intent","30"\r\n'
      + '"harbor-support-inbox","urgent","18"\r\n"wholesale-leads","route","5"\r\n"wholesale-leads","spam","3"\r\n"wholesale-leads","legacy_tag","1"\r\n' },

  // The newest saved_at among the shown is empty-draft (2026-11-11).
  load_newest: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["load", "empty-draft"]]), hidden: () => ctx({ filters: { query: "no such dataset" } }) },
  pin_with_split: { ctx: () => ctx(), check: (c) => {
    assert.deepEqual(c.state.filters.pinnedIds, ["bean-reviews", "harbor-support-inbox"]);
    assert.match(c.env.toasts[0].message, /Pinned 1 dataset/);
  }, hidden: () => ctx({ pinnedIds: ["harbor-support-inbox"] }) },
  copy_loaded_id: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.env.copied, ["harbor-support-inbox"]), hidden: () => ctx({ loadedId: null }) },
  open_loaded_agreement: { ctx: () => ctx({ agreementOpen: [] }), check: (c) => assert.deepEqual(c.log, [["openAgreement", "harbor-support-inbox"]]),
    hidden: () => ctx() },

  // 90% of 40 is 36 labeled rows: 6 more than 30. 75% now.
  labels_to_target: { values: { rows: 40, labeled: 30, target: 90 }, expect: [["Rows to label", 6], ["Labeled share now (%)", 75], ["Labeled rows at the target", 36]],
    more: [{ values: { rows: 7, labeled: 7, target: 50 }, expect: [["Rows to label", 0], ["Labeled share now (%)", 100], ["Labeled rows at the target", 4]] },
      { values: { rows: 3, labeled: 0, target: 33.3 }, expect: [["Rows to label", 1], ["Labeled share now (%)", 0], ["Labeled rows at the target", 1]] }],
    invalid: [{ rows: 5, labeled: 6, target: 50 }, { rows: 0, labeled: 0, target: 50 }, { rows: 5, labeled: 1, target: 101 }] },
}, { ctx: () => ctx() });

// The raw fixture keeps its check configuration out of every item.
assert.ok(sampleDatasetsRaw().some((raw) => raw.check));
