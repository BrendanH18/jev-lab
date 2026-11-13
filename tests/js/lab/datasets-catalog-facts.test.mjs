import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/datasets-catalog-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleDatasetsCatalogCtx } from "./fixtures/workbench-datasets.mjs";

const ctx = (overrides) => sampleDatasetsCatalogCtx(overrides);
const all = () => ctx({ filters: {} });
const D = Object.fromEntries(all().items().map((item) => [item.id, item]));
const ARCHIVED = D["archived-refunds"], BEAN = D["bean-reviews"], CAFE = D["cafe-photos"], EMPTY = D["empty-draft"];
const HARBOR = D["harbor-support-inbox"], WHOLESALE = D["wholesale-leads"];
// Items made by the real builder from hand-written summaries (clock 2026-11-12T12:00:00Z).
const madeCtx = (...raws) => ctx({ datasets: raws, filters: {}, loadedId: null, pinnedIds: [], agreementOpen: [] });
const made = (...raws) => madeCtx(...raws).items();
const [FUTURE, RECENT, RESAVED, SPACED, DOUBLE, COPY, HARBOR_COPY, COPYEDIT, UNQ, WIDE, BREAD, PADDED, CONTACT, NEAR] = made(
  { id: "future-save", name: "Future save", saved_at: "2026-11-13T00:00:00Z", rows: 1, labeled: 0 },
  { id: "recent-save", name: "Recent save", saved_at: "2026-11-12T06:00:00Z", rows: 1, labeled: 0 },
  { id: "resaved-split", name: "Resaved split", saved_at: "2026-10-20T00:00:00Z", rows: 12, labeled: 10, labels: { foam: 10 }, questions: 1,
    test: { rows: 4, labeled: 0, share: 0, looks: 0, locked_at: "2026-10-01T00:00:00Z" } },
  { id: "latte-art", name: "  Latte art ", rows: 1, labeled: 0 },
  { id: "two-spaces", name: "Two  spaces", rows: 1, labeled: 0 },
  { id: "bean-reviews-copy-2", name: "Bean reviews copy 2", rows: 1, labeled: 0 },
  { id: "harbor-copy", name: "Harbor copy", rows: 1, labeled: 0 },
  { id: "copyedit-notes", name: "Copyedit notes", rows: 1, labeled: 0 },
  { id: "three-questions", name: "Three questions", rows: 6, labeled: 4, labels: { a: 4 }, questions: 3 },
  { id: "wide-split", name: "Wide split", rows: 10, labeled: 10, labels: { a: 10 }, questions: 1, test: { rows: 5, labeled: 5, share: 0.5, looks: 2, locked_at: "2026-10-01T00:00:00Z" } },
  { id: "bread-log", name: "Bread \u{1F35E} log", rows: 1, labeled: 0 },
  { id: "padded-notes", name: "Padded notes", notes: "  hi  ", rows: 1, labeled: 0 },
  { id: "sales-leads", name: "Leads from sales@harbor.example", rows: 1, labeled: 0 },
  { id: "bean-review", name: "Bean review", rows: 1, labeled: 0 },
);
// "Support tickets" saves to support-tickets, which is another saved dataset; RENAMED alone is listed, the other hidden.
const RENAMED_CTX = madeCtx({ id: "support-2025", name: "Support tickets", rows: 3, labeled: 0 }, { id: "support-tickets", name: "Support tickets new", rows: 1, labeled: 0 });
const [RENAMED] = RENAMED_CTX.items();
const [TWIN] = made({ id: "harbor-support-copy", name: "  harbor SUPPORT   inbox ", rows: 1, labeled: 0 });
// Boundaries, by hand from the clock 2026-11-12T12:00:00Z: exactly 7 days and exactly 1 day back; held-out shares of
// exactly 1/10 and 4/10 of the labeled rows; a name spelled exactly like its ID and one that differs only in case.
const [WEEK, DAY, TEN_PCT, FORTY_PCT, OWN_NAME, CASED, SAME_SAVE] = made(
  { id: "week-old", name: "Week old", saved_at: "2026-11-05T12:00:00Z", rows: 1, labeled: 0 },
  { id: "day-old", name: "Day old", saved_at: "2026-11-11T12:00:00Z", rows: 1, labeled: 0 },
  { id: "ten-pct", name: "Ten pct", rows: 10, labeled: 10, labels: { a: 10 }, questions: 1, test: { rows: 1, labeled: 1, share: 0.1, looks: 0, locked_at: null } },
  { id: "forty-pct", name: "Forty pct", rows: 10, labeled: 10, labels: { a: 10 }, questions: 1, test: { rows: 4, labeled: 4, share: 0.4, looks: 0, locked_at: null } },
  { id: "own-name", name: "own-name", rows: 1, labeled: 0 },
  { id: "cased-name", name: "Cased-Name", rows: 1, labeled: 0 },
  // A first save with held-out rows stamps locked_at with the save time (jev/workbench.py prepare_dataset).
  { id: "same-save", name: "Same save", saved_at: "2026-10-01T00:00:00Z", rows: 10, labeled: 10, labels: { a: 10 }, questions: 1,
    test: { rows: 2, labeled: 2, share: 0.2, looks: 0, locked_at: "2026-10-01T00:00:00Z" } },
);

checkPack(pack, {
  // Hand-worked from the clock: Oct 30 16:20 is 12.8 days back, Nov 10 08:00 2.2, Nov 11 07:30 1.2, Sep 5 12:00 exactly 68,
  // Jun 1 10:00 164.1, Nov 12 06:00 0.25. No date and a save after the clock are unknown.
  days_since_saved: { items: [HARBOR, BEAN, EMPTY, WHOLESALE, ARCHIVED, CAFE, FUTURE, RECENT, WEEK, DAY], values: [12, 2, 1, 68, 164, null, null, 0, 7, 1], ctx: all() },
  saved_month: { items: [HARBOR, BEAN, ARCHIVED, CAFE], values: ["2026-10", "2026-11", "2026-06", null] },
  // Band edges are exclusive: exactly 1 day is "under a week", exactly 7 days "under a month".
  save_age_band: { items: [RECENT, BEAN, HARBOR, WHOLESALE, ARCHIVED, CAFE, FUTURE, DAY, WEEK],
    values: ["under a day", "under a week", "under a month", "under 3 months", "3 months or more", null, null, "under a week", "under a month"], ctx: all() },
  // Saved Oct 20, split drawn Oct 1; Harbor was saved the day before its split.
  // TEN_PCT has a split with no draw date, so the order is unknown; SAME_SAVE was saved the second its split was drawn.
  saved_after_split: { items: [RESAVED, HARBOR, BEAN, TEN_PCT, SAME_SAVE], values: [true, false, false, false, false] },

  // The bread emoji is one code point (two UTF-16 units).
  name_length: { items: [HARBOR, EMPTY, BEAN, BREAD], values: [20, 11, 12, 11] },
  id_length: { items: [HARBOR, BEAN, WHOLESALE, EMPTY], values: [20, 12, 15, 11] },
  // Lengths counted with Python len(): 42, 41 and 29 characters; "  hi  " trims to 2.
  notes_length: { items: [ARCHIVED, HARBOR, WHOLESALE, BEAN, PADDED], values: [42, 41, 29, 0, 2] },
  id_family: { items: [HARBOR, BEAN, WHOLESALE, EMPTY, HARBOR_COPY], values: ["harbor", "bean", "wholesale", "empty", "harbor"] },
  name_is_id: { items: [EMPTY, HARBOR, OWN_NAME, CASED], values: [true, false, true, false] },
  name_spacing: { items: [SPACED, DOUBLE, HARBOR], values: [true, true, false] },
  copy_like_id: { items: [COPY, HARBOR_COPY, COPYEDIT, HARBOR], values: [true, true, false, false] },

  // Harbor labels intent 30 and urgent 18 on 30 labeled rows; bean quality 12 of 12; wholesale route 5, spam 3, legacy_tag 1 of 5.
  most_question_labels: { items: [HARBOR, BEAN, WHOLESALE, CAFE], values: [30, 12, 5, null] },
  question_label_total: { items: [HARBOR, BEAN, WHOLESALE, CAFE], values: [48, 12, 9, 0] },
  labels_per_labeled_row: { items: [HARBOR, BEAN, WHOLESALE, CAFE], values: [1.6, 1, 1.8, null] },
  least_question_share: { items: [HARBOR, BEAN, WHOLESALE, CAFE], values: [0.6, 1, 0.2, null] },
  // Three saved questions, one labeled; wholesale names three IDs for two saved questions.
  unlabeled_saved_question: { items: [UNQ, WHOLESALE, HARBOR, CAFE], values: [true, false, false, false] },

  // Harbor: 24 labeled tuning rows, 6 held out. Archived: 6 and 3. Resaved: 10 and 0.
  smaller_split_side: { items: [HARBOR, ARCHIVED, BEAN, RESAVED], values: [6, 3, null, 0] },
  evaluation_status: { items: [BEAN, RESAVED, HARBOR, ARCHIVED], values: ["no split", "not scored", "scored once", "scored 2+ times"] },
  check_has_notes: { items: [ARCHIVED, HARBOR, BEAN], values: [true, false, false] },
  agreement_ready: { items: [HARBOR, CAFE, EMPTY], values: [true, false, false] },
  agreement_open: { items: [HARBOR, BEAN], values: [true, false] },

  saved_in_future: { hit: FUTURE, miss: [HARBOR, CAFE, RECENT], ctx: all(), message: /2026-11-13T00:00:00Z, later than this computer's clock/ },
  name_saves_over: { hitList: [RENAMED], ctx: RENAMED_CTX, missList: all().items(), missCtx: all(),
    message: /Saving support-2025 under its name “Support tickets” would write support-tickets/ },
  // Harbor's notes hold an email address, but notes are not names.
  name_has_contact: { hit: CONTACT, miss: [HARBOR, BEAN], message: /email or web address/ },
  // "bean reviews" and "bean review" are one edit apart; identical names (Harbor and its twin) are left to the starter pack.
  similar_names: { hitList: [BEAN, NEAR, CAFE], missList: [...all().items(), TWIN], message: /^bean-reviews and bean-review have nearly the same name/ },
  // RESAVED labels foam on exactly 10 rows: not under 10.
  thin_question_labels: { hit: WHOLESALE, miss: [HARBOR, BEAN, CAFE, RESAVED], message: /route \(5\), spam \(3\), legacy_tag \(1\)/ },
  // 0 of 10 and 5 of 10 labeled rows held out are outside; 6 of 30 (20%) and 3 of 9 (33.3%) are inside.
  // Exactly 10% and exactly 40% are inside the range.
  held_out_share_range: { hit: [RESAVED, WIDE], miss: [HARBOR, ARCHIVED, BEAN, TEN_PCT, FORTY_PCT], message: /^(0|50)% of the labeled rows are held out/ },
  held_out_without_labels: { hit: RESAVED, miss: [HARBOR, BEAN, WIDE], message: /None of the 4 held-out rows has a label/ },
}, { ctx: () => ctx() });

test("datasets-catalog-facts: no fact returns notes text", () => {
  for (const feature of pack.features.filter((entry) => entry.kind === "fact")) {
    for (const item of [ARCHIVED, HARBOR, WHOLESALE, PADDED]) {
      const value = feature.value(item, all());
      assert.ok(typeof value !== "string" || !/support@|second labeler|replaced by|^\s*hi\s*$/.test(value), `${feature.id} returned notes text`);
    }
  }
});

test("datasets-catalog-facts: odd items and a page with no clock give unavailable values, never an exception", () => {
  const bare = { data: {}, items: () => { throw new Error("no list"); } };
  for (const item of [{}, { id: 7, name: 3, question_labels: "x", test: {}, saved_ms: "soon" }, { question_labels: [null, { id: "q", labeled: -1 }] }]) {
    for (const feature of pack.features) {
      if (feature.kind === "fact") {
        const value = feature.value(item, bare);
        assert.ok(value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value)), `${feature.id}: ${value}`);
      } else if ((feature.scope || "item") === "item") feature.check(item, bare, 0);
      else feature.check([item], bare);
    }
  }
  // Without a clock, the age facts are unavailable.
  const days = pack.features.find((feature) => feature.id === "days_since_saved");
  assert.equal(days.value(HARBOR, bare), null);
});
