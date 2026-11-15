// Tests for static/js/lab/packs/workbench/checks-list-dataset-facts.js on the saved checks fixture
// (tests/js/lab/fixtures/workbench-checks.mjs). Worked out by hand from the fixture header and its page state:
//   harbor-support   48 rows, 8 held out, 40 tuning, 40 labeled, 3 questions, 2 gated, position 1; Review queue open:
//                    4 rows, 2 ready (lines 1 and 3 have topic, the only queue gate), 1 audit, 2 edited labels
//   wholesale-leads  30 rows, 30 labeled, 2 questions, 1 gated, position 2, loaded in Bulk
//   bean-reviews     260 rows, 20 held out, 240 tuning (200 calls, 40 left out), 120 labeled, 1 question, position 3
//   roastery-orders  12 rows, 0 labeled, position 4, a run in progress, Upgrade panel open
import pack from "../../../static/js/lab/packs/workbench/checks-list-dataset-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleChecksListCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleChecksListCtx(overrides);
const C = Object.fromEntries(ctx({ catalogHidden: [] }).items().map((item) => [item.id, item]));
const H = C["harbor-support"], WL = C["wholesale-leads"], B = C["bean-reviews"], R = C["roastery-orders"];

checkPack(pack, {
  tuning_rows: { items: [H, WL, B, R], values: [40, 30, 240, 12] },
  held_out_rows: { items: [H, WL, B], values: [8, 0, 20] },
  held_out_share: { items: [H, WL, B, { rows: 0, held_out_rows: 0 }], values: [8 / 48, 0, 20 / 260, null] },
  labeled_share: { items: [H, WL, B, R], values: [40 / 48, 1, 120 / 260, 0] },
  unlabeled_rows: { items: [H, WL, B, R], values: [8, 0, 140, 12] },
  calls_per_run: { items: [H, WL, B], values: [40, 30, 200] },
  rows_past_cap: { items: [H, B], values: [0, 40] },
  question_count: { items: [H, WL, B], values: [3, 2, 1] },
  // A gate naming more questions than the dataset saves gives 0, never a negative count.
  ungated_questions: { items: [H, WL, B, { question_count: 1, gated: ["crema", "bitter"] }, { gated: [] }], values: [1, 1, 0, 0, null] },
  catalog_position: { items: [H, WL, B, R], values: [1, 2, 3, 4] },
  review_rows: { items: [H, WL], values: [4, 0] },
  review_ready: { items: [H, WL], values: [2, 0] },
  review_audit: { items: [H, WL], values: [1, 0] },
  review_edits: { items: [H, WL], values: [2, 0] },

  loaded: { items: [WL, H], values: [true, false] },
  has_held_out: { items: [H, WL], values: [true, false] },
  capped: { items: [B, H], values: [true, false] },
  every_row_labeled: { items: [WL, H, R], values: [true, false, false] },
  busy: { items: [R, H], values: [true, false] },
  review_open: { items: [H, WL], values: [true, false] },

  size_band: { items: [H, WL, B, R, { tuning_rows: 150 }], values: ["30 to 99", "30 to 99", "over 200", "under 30", "100 to 200"] },
  labeling_band: { items: [R, B, H, WL], values: ["none labeled", "under half labeled", "half or more labeled", "all labeled"] },
  open_panels: { items: [H, R, WL, { drift: { open: true }, queue: { open: true } }],
    values: ["Review queue", "Try a new version", "none open", "Compare new rows + Review queue"] },

  dataset_id: { items: [H, WL], values: ["harbor-support", "wholesale-leads"] },
}, { ctx: () => ctx() });
