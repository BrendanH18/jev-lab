// Tests for static/js/lab/packs/workbench/checks-list-config-facts.js on the saved checks fixture
// (tests/js/lab/fixtures/workbench-checks.mjs) and two hand-made checks. Worked out by hand:
//   harbor-support   gates topic 0.62, urgent 0.71; jev-1.2 tuned on jev-1.2; targets 0.95 / 0.6; 1 rule;
//                    slice channel = email (0.9 / 0.5); shortlist topic 0.9
//   wholesale-leads  gate route 0.55; jev-latest tuned on jev-1.2; targets 0.9 / 0.3; model box "jev-1.3"; one note
//   bean-reviews     gate quality 0.8; jev-1.1, no tuned-on; targets 1 / 0
//   roastery-orders  gate late 0.5; jev-1.2; name "" (shows its id)
//   espresso-bar     (hand-made) gates crema 0.4, bitter 0.99; jev-1.3 tuned on jev-1.2; target 0.85; 3 rules;
//                    slices channel = email (0.8 / 0.4) and size = large (0.95 / 0.1); shortlists crema 0.85, bitter 0.95
//   draft-gate       (hand-made) no gates
import pack from "../../../static/js/lab/packs/workbench/checks-list-config-facts.js";
import { checkPack } from "./harness.mjs";
import { sampleChecksListCtx } from "./fixtures/workbench-checks.mjs";

const ctx = (overrides) => sampleChecksListCtx(overrides);
const byId = (c) => Object.fromEntries(c.items().map((item) => [item.id, item]));
const C = byId(ctx({ catalogHidden: [] }));
const H = C["harbor-support"],
  WL = C["wholesale-leads"],
  B = C["bean-reviews"],
  R = C["roastery-orders"];
const [RICH, NONE] = ctx({
  datasets: [
    {
      id: "espresso-bar",
      name: "Espresso bar",
      rows: 10,
      labeled: 10,
      questions: 3,
      check: {
        gates: { crema: 0.4, bitter: 0.99 },
        signal: "confidence",
        bound: "estimate",
        model: "jev-1.3",
        tuned_on: "jev-1.2",
        min_accuracy: 0.85,
        min_coverage: 0.2,
        rules:
          "if crema = yes then bitter = no\nif bitter = yes then crema = no\n\nif crema = no then bitter in yes, no",
        slice_targets: [
          { field: "channel", value: "email", min_accuracy: 0.8, min_coverage: 0.4 },
          { field: "size", value: "large", min_accuracy: 0.95, min_coverage: 0.1 },
        ],
        answer_sets: { crema: 0.85, bitter: 0.95 },
      },
    },
    {
      id: "draft-gate",
      name: "Draft gate",
      rows: 4,
      labeled: 4,
      check: { gates: {}, model: "jev-1.2", min_accuracy: 0.9, min_coverage: 0.5 },
    },
  ],
}).items();

checkPack(
  pack,
  {
    threshold_spread: { items: [H, WL, NONE, RICH], values: [0.09, 0, null, 0.59] },
    mean_threshold: { items: [H, WL, B, RICH, NONE], values: [0.665, 0.55, 0.8, 0.695, null] },
    error_allowance: { items: [H, WL, B, RICH], values: [0.05, 0.1, 0, 0.15] },
    rule_count: { items: [H, WL, RICH], values: [1, 0, 3] },
    slice_target_count: { items: [H, WL, RICH], values: [1, 0, 2] },
    shortlist_count: { items: [H, WL, RICH], values: [1, 0, 2] },
    slice_accuracy_floor: { items: [H, RICH, WL], values: [0.9, 0.8, null] },
    slice_automation_floor: { items: [H, RICH, WL], values: [0.5, 0.1, null] },
    shortlist_coverage_floor: { items: [H, RICH, WL], values: [0.9, 0.85, null] },

    asks_tuned_version: { items: [H, WL, B, RICH], values: [true, false, false, false] },
    model_box_set: { items: [WL, H], values: [true, false] },
    perfect_accuracy: { items: [B, H, RICH], values: [true, false, false] },

    model: { items: [H, WL, B, R, { model: "" }], values: ["jev-1.2", "jev-latest", "jev-1.1", "jev-1.2", null] },
    tuned_on: { items: [H, B, RICH], values: ["jev-1.2", "not saved", "jev-1.2"] },
    threshold_band: {
      items: [H, WL, B, RICH, NONE, R, { gates: { espresso: 0.95 } }],
      values: ["0.5 to 0.7", "0.5 to 0.7", "0.7 to 0.9", "under 0.5", null, "0.5 to 0.7", "0.9 or more"],
    },
    accuracy_band: { items: [H, WL, B, RICH], values: ["95% to 99.9%", "90% to 94.9%", "100%", "under 90%"] },
    extras: {
      items: [
        H,
        WL,
        RICH,
        { rules: 2 },
        { slice_targets: [{ field: "size", value: "large" }], answer_sets: { crema: 0.9 } },
      ],
      values: [
        "rules + slices + shortlists",
        "gates only",
        "rules + slices + shortlists",
        "rules",
        "slices + shortlists",
      ],
    },

    gate_list: { items: [H, WL, NONE], values: ["topic ≥ 0.62, urgent ≥ 0.71", "route ≥ 0.55", ""] },
    slice_list: { items: [H, RICH, WL], values: ["channel = email", "channel = email, size = large", ""] },
    shortlist_list: { items: [H, RICH, WL], values: ["topic 0.90", "crema 0.85, bitter 0.95", ""] },
    notes: {
      items: [WL, H, { notes: ["Retune soon.", "Pin it."] }],
      values: ["Pin this check to jev-1.2: it asks the alias jev-latest.", "", "Retune soon. Pin it."],
    },
    name: { items: [H, R, WL], values: ["Harbor support inbox", "roastery-orders", "Wholesale leads"] },
  },
  { ctx: () => ctx() },
);
