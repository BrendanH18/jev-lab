// Tests for static/js/lab/packs/workbench/calibrate-row-facts.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs (rows #1-#7 of each question) or from the small items written here.
import assert from "node:assert/strict";

import pack from "../../../static/js/lab/packs/workbench/calibrate-row-facts.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleCalibrateCtx } from "./fixtures/workbench-analysis.mjs";

// department: labels billing shipping other billing wholesale shipping shipping; answers billing wholesale other
// billing wholesale billing shipping; signals .76 .12 .87 .93 .60 .20 .84; stated .82 .45 .90 .95 .70 .40 .88.
const dep = () => sampleCalibrateCtx().items();
const urgent = () => sampleCalibrateCtx({ qid: "urgent" }).items();   // P(yes) .88 .30 .05 .70 .20 .50 .91
const tone = () => sampleCalibrateCtx({ qid: "tone" }).items();       // rows #1 #2 #3 #4 #7
const spot = () => sampleCalibrateCtx({ qid: "spot" }).items();       // rows #2 (right) and #5 (wrong)

// Normalized entropy by its definition, written out separately: −Σ p ln p / ln k.
const H = (ps) => -ps.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(ps.length);

const choiceRow = (label, predicted, extra = {}) => ({ type: "choice", label, predicted, correct: label === predicted, signal: 0.5, ...extra });

checkPack(pack, {
  stated_probability: { items: dep(), values: [0.82, 0.45, 0.9, 0.95, 0.7, 0.4, 0.88] },
  // #1 department .82 .12 .03 .03; #6 urgent P(yes) .5 is an even split; a Box has no options.
  entropy: { items: [dep()[0], urgent()[5], urgent()[0], spot()[0]], values: [H([0.82, 0.12, 0.03, 0.03]), 1, H([0.88, 0.12]), null], tolerance: 1e-12 },
  // #2: shipping .40 under wholesale .45; #6: shipping .30 under billing .40; urgent #4 labeled no: P(no) .30 under .70.
  label_rank: { items: [...dep(), urgent()[3], spot()[0]], values: [1, 2, 1, 1, 1, 2, 1, 2, null] },
  // The Answer sets fit (department only) lists two options for #2 and #6.
  set_size: { items: [...dep(), urgent()[0]], values: [1, 2, 1, 1, 1, 2, 1, null] },
  // Field order is ignored; the picture name is kept; a missing row has no identity.
  // Nested field order is ignored too; a different picture name is a different input.
  same_input_rows: (() => {
    const items = [{ row: { a: 1, b: "x" } }, { row: { b: "x", a: 1 } }, { row: { a: 1, b: "x", _image: "cup.png" } }, { row: "text" }, { row: null },
      { row: { a: 1, b: "x", _image: "mug.png" } }, { row: { n: { y: 2, z: [1] } } }, { row: { n: { z: [1], y: 2 } } }, { row: { n: { z: [1], y: 2 } } }];
    return { items, values: [2, 2, 1, 1, null, 1, 3, 3, 3], ctx: fakeCtx({ items }) };
  })(),
  label_is_runner_up: { items: dep(), values: [false, true, false, false, false, true, false] },
  // #6's department answer has no confidence field; tone #1 has one; a Score answer without one counts; a Noul never
  // has one, and a Box is not a Choice or Score answer.
  missing_confidence: { items: [...dep(), urgent()[0], tone()[0], { answer: { type: "score", probabilities: { 0: 1 } } }, spot()[0],
    { answer: { type: "box", box: {} } }],
    values: [false, false, false, false, false, true, false, false, false, true, false, false] },
  // At 0.15: #2 (.12) is reviewed and wrong, #6 (.20) is automated and wrong, the rest are automated and right.
  outcome: { items: dep(), ctx: sampleCalibrateCtx({ threshold: 0.15 }),
    values: ["automated right", "reviewed wrong", "automated right", "automated right", "automated right", "automated wrong", "automated right"] },
  label: { items: dep(), values: ["billing", "shipping", "other", "billing", "wholesale", "shipping", "shipping"] },
  signal_band: { items: [...dep(), { signal: 1 }, { signal: null }],
    values: ["0.7–0.8", "0.1–0.2", "0.8–0.9", "0.9–1.0", "0.6–0.7", "0.2–0.3", "0.8–0.9", "0.9–1.0", null] },
  // The fixture's By slice report is on "channel": #2 email, #5 phone, text rows have none. Non-text values read as
  // Python's json.dumps(sort_keys=True), which escapes non-ASCII (python3 -c 'import json; print(json.dumps({"city":
  // "Zürich"}, sort_keys=True))' prints {"city": "Z\u00fcrich"}); text keeps its own characters. Blank text is none,
  // and Python's strip also removes \x85 and \x1c but keeps \ufeff.
  slice_value: {
    items: [...dep(), { row: { channel: 3 } }, { row: { channel: { b: true, a: [1, "x"] } } }, { row: { channel: "  " } },
      { row: { channel: { city: "Zürich" } } }, { row: { channel: " Zürich\x85" } }, { row: { channel: "\x1c" } }, { row: { channel: "\ufeffweb" } },
      { row: { channel: false } }, { row: { channel: null } }],
    values: ["(none)", "email", "(none)", "(none)", "phone", "(none)", "(none)", "3", '{"a": [1, "x"], "b": true}', "(none)",
      '{"city": "Z\\u00fcrich"}', "Zürich", "(none)", "\ufeffweb", "false", "(none)"],
    ctx: sampleCalibrateCtx(),
  },

  // tone: labels 2 1 0 1 2, answers 2 0 0 1 2.
  level_error: { items: [...tone(), dep()[0]], values: [0, -1, 0, 0, 0, null] },
  // Expected scores 1.65 .50 .12 1.10 1.55 against labels 2 1 0 1 2.
  expected_error: { items: [...tone(), urgent()[0]], values: [0.35, 0.5, 0.12, 0.1, 0.45, null], tolerance: 1e-9 },
  error_kind: { items: [...urgent(), dep()[0]], values: ["true yes", "true no", "true no", "false yes", "true no", "true yes", "true yes", null] },
  p_yes: { items: [...urgent(), dep()[0]], values: [0.88, 0.3, 0.05, 0.7, 0.2, 0.5, 0.91, null] },
  // #2: answered .10 .20 .50 .60, labeled .12 .22 .50 .58: overlap .38 × .36 = .1368; union .16 + .1368 − .1368 = .16.
  // #5: .60-.90 against .05-.20: no overlap.
  iou: { items: [...spot(), dep()[0]], values: [0.1368 / 0.16, 0, null], tolerance: 1e-9 },
  box_area: { items: [...spot(), dep()[0]], values: [0.16, 0.09, null], tolerance: 1e-9 },

  score_far_off: {
    hit: { type: "score", label: "0", predicted: "2" },
    miss: [...tone(), { type: "choice", label: "0", predicted: "2" }],
    message: /answered level 2 for a row labeled 0: 2 levels off/,
  },
  // Levels 0..4 at .4 0 0 .3 .3: most likely level 0, expected score 0.9 + 1.2 = 2.1.
  score_split: {
    hit: { type: "score", predicted: "0", answer: { type: "score", score: 2.1, probabilities: { 0: 0.4, 1: 0, 2: 0, 3: 0.3, 4: 0.3 } } },
    miss: tone(),
    message: /expected score 2\.10 sits 2\.10 levels from the most likely level 0/,
  },
  box_no_overlap: { hit: spot()[1], miss: [spot()[0], dep()[0]], message: /does not overlap the labeled box at all \(IoU 0\)/ },
  box_degenerate: {
    hit: [{ type: "box", answer: { type: "box", box: { left: 0.5, top: 0.2, right: 0.4, bottom: 0.6 } } },
      { type: "box", answer: { type: "box", box: { left: 0.5, top: 0.2, right: 1.2, bottom: 0.6 } } },
      { type: "box", answer: { type: "box", box: { left: 0.5, top: 0.2, right: 0.9 } } }],
    miss: [...spot(), dep()[0]],
  },
  label_conflict: {
    hitList: [{ number: 2, row: { a: 1 }, label: "billing" }, { number: 5, row: { a: 1 }, label: "shipping" }, { number: 6, row: "z", label: "billing" },
      { number: 8, row: "z", label: "billing" }],
    // Copies with the same label, and different inputs with different labels, are no conflict.
    missList: [{ number: 1, row: { a: 1, b: 2 }, label: "billing" }, { number: 3, row: { b: 2, a: 1 }, label: "billing" }, { number: 4, row: "z", label: "other" }],
    message: /^Rows #2, #5 share one input/,
  },
  // At 0.60, #5 (signal .60) clears 0.60 but not 0.61: 1 of 7 rows (14%). At 0.50 no signal lies in [0.49, 0.51).
  cliff: {
    hitList: dep(), ctx: sampleCalibrateCtx({ threshold: 0.6 }),
    missList: dep(), missCtx: sampleCalibrateCtx({ threshold: 0.5 }),
    message: /threshold 0\.60 by 0\.01 either way re-routes 1 of 7 shown rows \(14\.3%\)/,
  },
  few_distinct_signals: {
    hitList: [0.5, 0.5, 0.9, 0.9, 0.1].map((signal) => ({ signal })),
    missList: dep(),
    message: /5 shown rows take only 3 distinct signal values/,
  },
  class_never_answered: {
    hitList: [choiceRow("billing", "billing"), choiceRow("shipping", "billing"), choiceRow("shipping", "billing")],
    missList: dep(), ctx: fakeCtx({ data: { type: "choice" } }),
    message: /“shipping” is the label of 2 shown rows but never the answer/,
  },
  // "billing" answered 5 times, labeled twice: 3 of 5 rows more. department: billing 3 vs 2 and wholesale 2 vs 1 of 7.
  over_given_answer: {
    hitList: ["billing", "billing", "other", "other", "shipping"].map((label) => choiceRow(label, "billing")),
    missList: dep(), ctx: fakeCtx({ data: { type: "choice" } }),
    message: /“billing” is the answer on 5 of 5 shown rows but the label on 2/,
  },
}, { ctx: () => sampleCalibrateCtx() });

// The same-input count reads every scored row, not only the shown ones: hiding #2 leaves its twin counting two.
{
  const twin = Object.freeze([{ row: { a: 1 } }, { row: { a: 1 } }, { row: "solo" }]);
  const fact = pack.features.find((f) => f.id === "same_input_rows");
  const ctx = fakeCtx({ items: twin, shown: [twin[1], twin[2]] });
  assert.deepEqual([fact.value(twin[1], ctx), fact.value(twin[2], ctx)], [2, 1]);
}

// A fact never throws on an odd item.
for (const feature of pack.features.filter((f) => f.kind === "fact")) {
  feature.value({}, fakeCtx({}));
  feature.value({ answer: { type: "score", probabilities: null }, type: "score", label: null }, sampleCalibrateCtx({ result: null }));
}
