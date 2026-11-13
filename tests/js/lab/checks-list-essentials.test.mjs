import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/checks-list-essentials.js";
import { checkPack } from "./harness.mjs";
import { sampleChecksListCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleChecksListCtx(overrides);
const all = () => ctx({ catalogHidden: [] });
const empty = () => ctx({ datasets: [], runs: {} });
const C = Object.fromEntries(all().items().map((item) => [item.id, item]));
const H = C["harbor-support"], WL = C["wholesale-leads"], B = C["bean-reviews"], R = C["roastery-orders"];
// A check saved before any gate was chosen: no thresholds at all.
const [NONE] = ctx({ datasets: [{ id: "draft-gate", name: "Draft gate", rows: 4, labeled: 4, check: { gates: {}, model: "jev-1.2", min_accuracy: 0.9, min_coverage: 0.5 } }] }).items();

checkPack(pack, {
  gate_count: { items: [H, WL, NONE], values: [2, 1, 0] },
  // Harbor's lower threshold is topic's 0.62; a check without gates has none.
  lowest_threshold: { items: [H, WL, B, R, NONE], values: [0.62, 0.55, 0.8, 0.5, null] },
  accuracy_target: { items: [H, WL, B, R], values: [0.95, 0.9, 1, 0.9] },
  automation_target: { items: [H, WL, B, R], values: [0.6, 0.3, 0, 0.2] },
  // 25 of 26 and 17 of 18 automated rows right; bean never ran; roastery automated nothing.
  measured_accuracy: { items: [H, WL, B, R], values: [25 / 26, 17 / 18, null, null], tolerance: 1e-12 },
  // Harbor is judged on its lower bound 0.811 against 0.95; wholesale on its estimate 17/18 against 0.9.
  accuracy_margin: { items: [H, WL, B, R], values: [0.811 - 0.95, 17 / 18 - 0.9, null, null], tolerance: 1e-12 },
  // Harbor automated 26 of 38 against 60%; wholesale 60% against 30%; roastery has no coverage.
  automation_margin: { items: [H, WL, B, R], values: [26 / 38 - 0.6, 0.3, null, null], tolerance: 1e-12 },
  run_cost: { items: [H, WL, B, R], values: [0.0042, 0.0021, null, 0.0011] },
  alias_model: { items: [WL, H, B], values: [true, false, false] },
  // Wholesale was tuned on jev-1.2 and answered by jev-1.3; harbor stayed on jev-1.2; bean has no run.
  version_moved: { items: [WL, H, B], values: [true, false, false] },
  has_rules: { items: [H, WL], values: [true, false] },
  has_slice_targets: { items: [H, WL, B], values: [true, false, false] },
  not_run: { items: [B, H, R], values: [true, false, false] },
  last_status: { items: [H, WL, B, R], values: ["failed", "passed", "not run", "not judged"] },
  accuracy_basis: { items: [H, WL, B, R], values: ["95% lower bound", "estimate", "95% lower bound", "estimate"] },

  unreachable_accuracy: { hit: B, miss: [H, WL, R], message: /never pass/ },
  zero_automation_target: { hit: B, miss: [H, WL, R], message: /0%/ },
  alias_after_tuning: { hit: WL, miss: [H, B, R], message: /^It was tuned on jev-1\.2 but asks jev-latest/ },
  // Bean has 240 tuning rows and a run sends 200.
  capped_rows: { hit: B, miss: [H, WL, R], message: /^A run sends 200 of its 240 tuning rows\.$/ },

  // Shown (roastery hidden by the catalog): harbor failed, wholesale passed, bean never ran -> 1 of 2. All: roastery's
  // not-judged run makes it 1 of 3.
  passing_share: [{ ctx: ctx(), expect: 0.5, empty: empty() }, { ctx: all(), expect: 1 / 3, tolerance: 1e-12 }],
  session_spend: [{ ctx: ctx(), expect: 0.0063, tolerance: 1e-9, empty: empty() }, { ctx: all(), expect: 0.0074, tolerance: 1e-9 }],
  // 40 + 30 + 200 (bean is capped); roastery's 12 when the catalog shows it.
  rerun_calls: [{ ctx: ctx(), expect: 270, empty: empty() }, { ctx: all(), expect: 282 }],

  summary_markdown: { ctx: ctx(), filename: "jev-checks.md",
    text: "| Dataset | Gates | Targets (accuracy / automated) | Model | Last run | Accuracy | Automated |\n"
      + "| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| harbor-support | topic ≥ 0.62, urgent ≥ 0.71 | 95.0% / 60.0% | jev-1.2 | fail | 96.2% | 68.4% |\n"
      + "| wholesale-leads | route ≥ 0.55 | 90.0% / 30.0% | jev-latest | pass | 94.4% | 60.0% |\n"
      + "| bean-reviews | quality ≥ 0.80 | 100.0% / 0.0% | jev-1.1 | not run | — | — |\n",
    excludes: ["Grinder burr", "billing", "roastery-orders"] },

  go_first_failing: { ctx: () => ctx(),
    check: (c) => assert.deepEqual(c.log, [["goTo", "harbor-support"]]),
    hidden: () => ctx({ runs: {} }) },
}, { ctx: () => ctx() });
