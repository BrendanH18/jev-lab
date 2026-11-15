// Tests for static/js/lab/packs/workbench/checks-list-config-checks.js on the saved checks fixture
// (tests/js/lab/fixtures/workbench-checks.mjs) and hand-made checks. Worked out by hand from the fixture header:
// the catalog hides roastery-orders, so harbor-support, wholesale-leads and bean-reviews are shown.
//   harbor-support   40 tuning / 8 held out / 40 labeled; jev-1.2 tuned on jev-1.2; 0.95 / 0.6; lower bound; 1 rule;
//                    slice channel = email 0.9 / 0.5; shortlist topic 0.9; ran (fail); traffic shifted; Review edits
//   wholesale-leads  30 tuning / 0 held out / 30 labeled; jev-latest (an alias); 0.9 / 0.3; estimate; loaded; ran (pass)
//   bean-reviews     240 tuning / 20 held out / 120 labeled; jev-1.1, no tuned-on; 1 / 0; lower bound; not run
//   roastery-orders  hidden; a run in progress. Five datasets saved, four with a check.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/checks-list-config-checks.js";
import { checkPack } from "./harness.mjs";
import { sampleCheckDatasets, sampleCheckRuns, sampleChecksListCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleChecksListCtx(overrides);
const all = (overrides = {}) => ctx({ catalogHidden: [], ...overrides });
const empty = () => ctx({ datasets: [], runs: {} });
const only = (...ids) => ctx({ datasets: sampleCheckDatasets().filter((dataset) => ids.includes(dataset.id)) });
const C = Object.fromEntries(all().items().map((item) => [item.id, item]));
const H = C["harbor-support"], WL = C["wholesale-leads"], B = C["bean-reviews"], R = C["roastery-orders"];
// A check saved with every problem this pack looks for, under harbor-support's name; and one with no gate.
const [ODD, NONE] = ctx({ datasets: [
  { id: "odd-gate", name: "Harbor support inbox", rows: 20, labeled: 12, questions: 1,
    check: { gates: { crema: 1.5, bitter: "x" }, signal: "", bound: "estimate", model: "jev-1.3", tuned_on: "jev-1.2", min_accuracy: 1,
      slice_targets: [{ field: "channel", value: "email", min_accuracy: 1, min_coverage: 0 }, { field: "channel", value: "email", min_accuracy: 0.8, min_coverage: 0.2 },
        { field: "", value: "phone", min_accuracy: 0.9, min_coverage: 0.1 }],
      answer_sets: { crema: 0.7, bitter: 1 } } },
  { id: "draft-gate", name: "Draft gate", rows: 4, labeled: 4, questions: 1, check: { gates: {}, signal: "", model: "jev-1.2", min_accuracy: 0.9, min_coverage: 0.5 } },
] }).items();

const CONFIG = [
  { dataset: "harbor-support", name: "Harbor support inbox", model: "jev-1.2", tuned_on: "jev-1.2", signal: "confidence", accuracy_basis: "lower",
    gates: { topic: 0.62, urgent: 0.71 }, min_accuracy: 0.95, min_automation: 0.6, rules: 1,
    slice_targets: [{ field: "channel", value: "email", min_accuracy: 0.9, min_automation: 0.5 }], shortlists: { topic: 0.9 } },
  { dataset: "wholesale-leads", name: "Wholesale leads", model: "jev-latest", tuned_on: "jev-1.2", signal: "probability", accuracy_basis: "estimate",
    gates: { route: 0.55 }, min_accuracy: 0.9, min_automation: 0.3, rules: 0, slice_targets: [], shortlists: {} },
  { dataset: "bean-reviews", name: "Bean reviews", model: "jev-1.1", tuned_on: null, signal: "confidence", accuracy_basis: "lower",
    gates: { quality: 0.8 }, min_accuracy: 1, min_automation: 0, rules: 0, slice_targets: [], shortlists: {} },
];
const driftLines = (id) => [`# ${id}: upper bound on calls and cost, no model calls`, `uv run scripts/check.py ${id} --drift new-rows.jsonl --estimate`,
  `# ${id}: live comparison (spends budget; exits 1 on a shift)`, `uv run scripts/check.py ${id} --drift new-rows.jsonl`];

checkPack(pack, {
  slice_no_automation: { hit: ODD, miss: [H, WL], message: /^channel = email has an automation target of 0%, so it adds no automation minimum for that slice; its accuracy target still needs automated rows there, so a slice the gate automates nothing in still fails\.$/ },
  slice_perfect_accuracy: { hit: ODD, miss: [H, WL], message: /^channel = email asks 100% accuracy/ },
  // bean-reviews also asks 100%, but on the lower bound, which the starter pack's unreachable-target check covers.
  perfect_accuracy_estimate: { hit: ODD, miss: [B, H] },
  slice_looser_than_overall: { hit: H, miss: [WL, B], message: /^channel = email asks 90\.0% accuracy, below the check's 95\.0%/ },
  duplicate_slices: { hit: ODD, miss: [H], message: /^channel = email is required 2 times; keep one target for it\.$/ },
  blank_slice: { hit: ODD, miss: [H] },
  shortlist_low_coverage: { hit: ODD, miss: [H], message: /^crema's shortlist is cut to hold the right answer for 70\.0% of rows/ },
  shortlist_full_coverage: { hit: ODD, miss: [H], message: /^bitter's shortlist is cut for 100% coverage/ },
  missing_targets: { hit: ODD, miss: [H, WL], message: /^No automation target is saved/ },
  // crema's threshold is 1.5; bitter's "x" is saved as no number at all.
  out_of_range: { hit: ODD, miss: [H, WL, B], message: /^crema threshold, bitter threshold are not a number from 0 to 1\.$/ },
  no_gates: { hit: NONE, miss: [H] },
  no_signal: { hit: [ODD, NONE], miss: [H, WL] },
  few_labeled: { hit: ODD, miss: [H, R], message: /^Only 12 rows carry a label/ },
  small_held_out: { hit: H, miss: [WL, B], message: /^Only 8 rows are held out/ },
  gates_exceed_questions: { hit: ODD, miss: [H, R], message: /^The gate names 2 questions but the dataset saves 1;/ },
  tuned_on_other_version: { hit: ODD, miss: [H, WL, B], message: /^The check asks jev-1\.3, but its thresholds were tuned on jev-1\.2\./ },

  same_name: { hitList: [H, ODD], missList: [H, WL, B], message: /^harbor-support, odd-gate share a name/ },
  mixed_models: { hitList: [H, WL], missList: [H, R], message: /ask 2 models \(jev-1\.2, jev-latest\)/ },
  hidden_by_catalog: { ctx: ctx(), hitList: [H, WL, B], missCtx: all(), missList: [H, WL, B, R], message: /^1 check is hidden by the Datasets catalog's filters/ },

  checks_shown: { ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "of 4 saved checks"); } },
  not_run: { ctx: ctx(), expect: 1, empty: empty() },
  alias_checks: { ctx: ctx(), expect: 1, empty: empty() },
  // (0.95 + 0.9 + 1) / 3
  mean_accuracy_target: { ctx: ctx(), expect: 0.95, tolerance: 1e-12, empty: empty() },
  total_tuning_rows: { ctx: ctx(), expect: 310, empty: empty() },
  total_labeled: { ctx: ctx(), expect: 190, empty: empty() },
  total_held_out: { ctx: ctx(), expect: 28, empty: empty() },
  total_rules: { ctx: ctx(), expect: 1, empty: empty() },
  total_slice_targets: { ctx: ctx(), expect: 1, empty: empty() },
  distinct_models: { ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 3); assert.equal(result.detail, "jev-1.2, jev-latest, jev-1.1"); } },
  datasets_without_check: { ctx: ctx(), empty: empty(), expect: (result) => { assert.equal(result.value, 1); assert.equal(result.detail, "of 5 datasets"); } },
  busy_checks: { ctx: ctx(), expect: 1, empty: empty() },

  config_json: { ctx: ctx(), filename: "jev-check-config.json", check: (out) => assert.deepEqual(JSON.parse(out.text), CONFIG),
    excludes: ["0.811", "fail", "report", "Grinder", "jev-1.3", "roastery"] },
  gates_csv: { ctx: ctx(), filename: "jev-check-gates.csv",
    text: '"dataset","question","threshold","signal","shortlist_coverage"\r\n"harbor-support","topic","0.62","confidence","0.9"\r\n'
      + '"harbor-support","urgent","0.71","confidence",""\r\n"wholesale-leads","route","0.55","probability",""\r\n"bean-reviews","quality","0.8","confidence",""\r\n' },
  slice_targets_csv: { ctx: ctx(), filename: "jev-check-slices.csv",
    text: '"dataset","field","value","min_accuracy","min_automation"\r\n"harbor-support","channel","email","0.9","0.5"\r\n', excludes: ["fail", "0.758"] },
  config_markdown: { ctx: ctx(), filename: "jev-check-config.md",
    text: "| Dataset | Model | Tuned on | Gates | Targets (accuracy / automated) | Basis | Rules | Required slices | Shortlists |\n"
      + "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n"
      + "| harbor-support | jev-1.2 | jev-1.2 | topic ≥ 0.62, urgent ≥ 0.71 | 95.0% / 60.0% | 95% lower bound | 1 | channel = email | topic 0.90 |\n"
      + "| wholesale-leads | jev-latest | jev-1.2 | route ≥ 0.55 | 90.0% / 30.0% | estimate | 0 | — | — |\n"
      + "| bean-reviews | jev-1.1 | — | quality ≥ 0.80 | 100.0% / 0.0% | 95% lower bound | 0 | — | — |\n" },
  drift_commands: { ctx: ctx(), filename: "jev-check-drift.sh",
    text: ["# Put the new rows in new-rows.jsonl, one per line as in Bulk. Run from the repository.",
      ...driftLines("harbor-support"), ...driftLines("wholesale-leads"), ...driftLines("bean-reviews")].join("\n") + "\n" },
  dataset_ids: { ctx: ctx(), filename: "jev-check-ids.txt", text: "harbor-support\nwholesale-leads\nbean-reviews\n" },

  go_first_not_run: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", "bean-reviews"]]), hidden: () => only("harbor-support", "wholesale-leads") },
  go_loaded: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", "wholesale-leads"]]), hidden: () => ctx({ loadedId: null }) },
  go_first_shifted: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", "harbor-support"]]), hidden: () => only("wholesale-leads", "bean-reviews") },
  go_first_alias: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", "wholesale-leads"]]), hidden: () => only("harbor-support", "bean-reviews") },
  export_loaded_gate: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["exportGate", "wholesale-leads"]]), hidden: () => ctx({ loadedId: "cafe-menu" }) },
  // harbor-support's Review queue is open already, so the command scrolls to it.
  open_review_with_edits: { ctx: () => ctx(), check: (c) => assert.deepEqual(c.log, [["goTo", "harbor-support"]]), hidden: () => only("wholesale-leads", "bean-reviews") },
}, { ctx: () => ctx() });

test("checks-list-config-checks/open_review_with_edits opens a closed Review queue instead of scrolling", () => {
  const runs = sampleCheckRuns();
  runs["harbor-support"].queue.open = false;
  const c = ctx({ runs });
  pack.features.find((feature) => feature.id === "open_review_with_edits").run(c);
  assert.deepEqual(c.log, [["open", "harbor-support", "queue", true]]);
});

test("checks-list-config-checks/drift_commands quotes a dataset id that is not one shell word", () => {
  const c = ctx({ datasets: [{ id: "it's odd", name: "Odd", rows: 2, labeled: 2, questions: 1, check: { gates: { a: 0.5 }, model: "jev-1.2", min_accuracy: 0.9, min_coverage: 0.1 } }], runs: {} });
  const text = pack.features.find((feature) => feature.id === "drift_commands").build(c);
  assert.ok(text.includes("uv run scripts/check.py 'it'\\''s odd' --drift new-rows.jsonl --estimate\n"));
});
