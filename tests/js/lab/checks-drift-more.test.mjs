import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/checks-drift-more.js";
import { checkPack } from "./harness.mjs";
import { sampleCheckRuns, sampleChecksListCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleChecksListCtx(overrides);
const all = (overrides = {}) => ctx({ catalogHidden: [], ...overrides });
const empty = () => ctx({ datasets: [], runs: {} });
const byId = (c) => Object.fromEntries(c.items().map((item) => [item.id, item]));
const C = byId(all());
const H = C["harbor-support"], WL = C["wholesale-leads"], B = C["bean-reviews"], R = C["roastery-orders"];
// A check saved before any gate was chosen.
const [NONE] = ctx({ datasets: [{ id: "draft-gate", name: "Draft gate", rows: 4, labeled: 4, check: { gates: {}, model: "jev-1.2", min_accuracy: 0.9, min_coverage: 0.5 } }] }).items();
// A check with one gate under 0.5 and one at 0.99.
const [EDGE] = ctx({ datasets: [{ id: "espresso-gate", name: "Espresso", rows: 10, labeled: 10, questions: 2,
  check: { gates: { crema: 0.4, bitter: 0.99 }, signal: "confidence", bound: "estimate", model: "jev-1.2", min_accuracy: 0.9, min_coverage: 0.2 } }] }).items();
// Page state variants: bean-reviews' traffic queue restored from a draft; harbor answered by two versions; wholesale passing
// on a judged accuracy of 0.905 against its 0.90 target.
const runsWith = (change) => { const runs = sampleCheckRuns(); change(runs); return runs; };
const BR = byId(all({ runs: runsWith((runs) => { runs["bean-reviews"].drift.report = { recovered: true, labeling: { items: [{ line: 1 }] } }; }) }))["bean-reviews"];
const H2 = byId(all({ runs: runsWith((runs) => { runs["harbor-support"].report.answered_by = ["jev-1.2", "jev-1.3"]; }) }))["harbor-support"];
const WL2 = byId(all({ runs: runsWith((runs) => { runs["wholesale-leads"].report.targets.accuracy.value = 0.905; }) }))["wholesale-leads"];

checkPack(pack, {
  highest_threshold: { items: [H, WL, B, R, NONE], values: [0.71, 0.55, 0.8, 0.5, null] },
  // Harbor 8 of 48 held out, bean 20 of 260, wholesale none; a dataset with no rows has no share.
  held_out_share: { items: [H, WL, B, { rows: 0, held_out_rows: 0 }], values: [8 / 48, 0, 20 / 260, null], tolerance: 1e-12 },
  // Harbor 26 automated, 25 correct; wholesale 18 and 17; roastery automated nothing; bean never ran.
  wrong_automated: { items: [H, WL, R, B], values: [1, 1, 0, null] },
  interval_width: { items: [H, WL, R, B], values: [0.993 - 0.811, 0.99 - 0.742, null, null], tolerance: 1e-12 },
  queued_traffic: { items: [H, WL], values: [3, 0] },
  no_tuned_on: { items: [B, R, H], values: [true, true, false] },
  has_answer_sets: { items: [H, WL], values: [true, false] },
  slice_failed: { items: [H, WL, B], values: [true, false, false] },
  run_notes: { items: [WL, H, B], values: [true, false, false] },
  // Harbor missed accuracy only; wholesale met both; roastery's run was not judged; bean never ran.
  missed_target: { items: [H, WL, R, B], values: ["accuracy", "neither", "not judged", null] },
  drift_verdict: { items: [H, WL, BR], values: ["shifted", "not compared", "restored draft"] },
  upgrade_verdict: { items: [WL, H], values: ["retune", "not tried"] },
  signal: { items: [H, WL, { signal: "" }], values: ["confidence", "probability", null] },

  low_threshold: { hit: EDGE, miss: [H, WL, B, R], message: /^crema ≥ 0\.40 can automate answers given with under even odds/ },
  high_threshold: { hit: EDGE, miss: [H, WL, B, R], message: /^bitter ≥ 0\.99 sends almost every row to review/ },
  override_differs: { hit: WL, miss: [H, B, R],
    message: /^The model box says jev-1\.3, so the next run measures that model; the saved check keeps asking jev-latest and was tuned on jev-1\.2\.$/ },
  several_versions: { hit: H2, miss: [H, WL, B], message: /answered by jev-1\.2 and jev-1\.3/ },
  // 0.905 - 0.90 = 0.005 < 0.01; the sample's 17/18 - 0.90 = 0.044 is clear; harbor failed.
  narrow_pass: { hit: WL2, miss: [WL, H, B], message: /^The latest run passed within 1 point of its accuracy target/ },
  no_labeled: { hit: R, miss: [H, WL, B], message: /^No row is labeled, so a run would spend 12 calls/ },
  drift_queue_waiting: { hit: H, miss: [WL, B, R], message: /^New traffic shifted and 3 rows wait in Label new traffic/ },
  unsaved_review_edits: { hit: H, miss: [WL, B], message: /^2 Review labels you edited in this session are not in the dataset until Add\.$/ },

  // Shown: harbor 0.811 - 0.95 = -0.139, wholesale 17/18 - 0.9 = +0.044, bean not run. Without harbor: wholesale's.
  worst_accuracy_margin: [
    { ctx: ctx(), empty: empty(), expect: (result) => { assert.ok(Math.abs(result.value - (0.811 - 0.95)) < 1e-12); assert.equal(result.detail, "harbor-support"); } },
    { ctx: ctx({ catalogHidden: ["harbor-support"] }), expect: 17 / 18 - 0.9, tolerance: 1e-12 },
    { ctx: ctx({ catalogHidden: ["harbor-support", "wholesale-leads"] }), expect: null }],
  // Harbor: 3 new traffic rows, and 4 Review rows of which 2 are ready.
  rows_to_label: [
    { ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 5); assert.equal(result.detail, "3 new traffic rows, 2 Review rows not ready"); } },
    { ctx: ctx({ catalogHidden: ["harbor-support"] }), expect: null }],

  config_csv: { ctx: ctx(), filename: "jev-check-config.csv",
    text: '"dataset","name","model","tuned_on","signal","basis","gates","min_accuracy","min_automation","rules","slice_targets","shortlists","tuning_rows","calls"\r\n'
      + '"harbor-support","Harbor support inbox","jev-1.2","jev-1.2","confidence","lower","topic>=0.62 urgent>=0.71","0.95","0.6","1","1","topic:0.9","40","40"\r\n'
      + '"wholesale-leads","Wholesale leads","jev-latest","jev-1.2","probability","estimate","route>=0.55","0.9","0.3","0","0","","30","30"\r\n'
      + '"bean-reviews","Bean reviews","jev-1.1","","confidence","lower","quality>=0.80","1","0","0","0","","240","200"\r\n',
    excludes: ["0.811", "fail", "Grinder", "roastery-orders"] },
  results_csv: { ctx: ctx(), filename: "jev-check-session-runs.csv",
    text: '"dataset","status","rows","labeled","automated","correct","accuracy","accuracy_low","accuracy_high","judged_accuracy","automation","cost_usd","answered_by"\r\n'
      + `"harbor-support","fail","40","38","26","25","${25 / 26}","0.811","0.993","0.811","${26 / 38}","0.0042","jev-1.2"\r\n`
      + `"wholesale-leads","pass","30","30","18","17","${17 / 18}","0.742","0.99","${17 / 18}","0.6","0.0021","jev-1.3"\r\n`
      + '"bean-reviews","not run","","","","","","","","","","",""\r\n',
    excludes: ["Grinder", "refund", "billing"] },
  check_commands: { ctx: ctx(), filename: "jev-check-commands.sh",
    text: "# Upper bound on calls and cost, no model calls:\n"
      + "uv run scripts/check.py harbor-support wholesale-leads bean-reviews --estimate\n"
      + "# Live run (spends budget; exits 1 when a check misses its targets):\n"
      + "uv run scripts/check.py harbor-support wholesale-leads bean-reviews\n",
    excludes: ["roastery-orders"] },
  upgrade_commands: { ctx: ctx(), filename: "jev-check-upgrades.sh",
    text: "# wholesale-leads: retune on jev-1.3 (this session)\n"
      + "uv run scripts/check.py wholesale-leads --upgrade-to jev-1.3 --estimate\n"
      + "uv run scripts/check.py wholesale-leads --upgrade-to jev-1.3\n",
    excludes: ["harbor-support", "bean-reviews"] },
}, { ctx: () => ctx() });

