// Tests for static/js/lab/packs/workbench/calibrate-row-answers.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs, Calibrate on department (option order billing, shipping, wholesale,
// other). Rows (label → answer, answer probabilities, the reviewer's list at 90% coverage):
//   0 billing → billing .82/.12/.03/.03 [billing]          4 wholesale → wholesale .10/.15/.70/.05 [wholesale]
//   1 shipping → wholesale .05/.40/.45/.10 [wholesale, shipping]   5 shipping → billing .40/.30/.20/.10 [billing, shipping]
//   2 other → other .02/.03/.05/.90 [other]                6 shipping → shipping .04/.88/.03/.05 [shipping]
//   3 billing → billing .95/.02/.02/.01 [billing]
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/calibrate-row-answers.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleCalibrateCtx } from "./fixtures/workbench-analysis.mjs";

const base = sampleCalibrateCtx();
const rows = base.items();
const [r0, r1, r2, , r4, r5] = rows;
const empty = () => sampleCalibrateCtx({ report: null });
// A wrong row whose label (c) is third, not second.
const third = {
  type: "choice",
  label: "c",
  predicted: "a",
  correct: false,
  top: 0.5,
  answer: { type: "choice", probabilities: { a: 0.5, b: 0.3, c: 0.2 } },
};

checkPack(
  pack,
  {
    answer: { items: [r0, r1, r2], values: ["billing", "wholesale", "other"], ctx: base },
    // Row 3's runner-up ties shipping and wholesale at .02: shipping comes first in the answer.
    runner_up: {
      items: rows,
      values: ["shipping", "shipping", "wholesale", "shipping", "shipping", "shipping", "other"],
      ctx: base,
    },
    set_route: {
      items: rows,
      ctx: base,
      values: [
        "one option",
        "two or more options",
        "one option",
        "one option",
        "one option",
        "two or more options",
        "one option",
      ],
    },
    set_options: { items: [r0, r1, r5], values: ["billing", "wholesale, shipping", "billing, shipping"], ctx: base },
    input_length: { items: [{ text: "Hello" }, { text: "Where is my order?" }, { text: "" }], values: [5, 18, null] },
    input_kind: { items: [r0, r1, r4], values: ["plain text", "picture", "fields"], ctx: base },
    // Row 1: .45 − .40; row 5: .40 − .30.
    label_gap: { items: rows, values: [0, 0.05, 0, 0, 0, 0.1, 0], ctx: base, tolerance: 1e-9 },

    answer_never_labeled: {
      hitList: [r0, r1],
      missList: rows,
      ctx: base,
      message: /^“wholesale” is the answer of 1 shown row but no shown row's label/,
    },

    // Both wrong rows put shipping (their label) second.
    runner_up_recovery: [
      { ctx: base, expect: 1, empty: empty() },
      { ctx: fakeCtx({ items: [third] }), expect: 0 },
    ],
    mean_set_size: [
      { ctx: base, expect: 9 / 7, tolerance: 1e-12, empty: empty() },
      { ctx: sampleCalibrateCtx({ hide: [1, 5] }), expect: 1 },
    ],
  },
  { ctx: () => sampleCalibrateCtx() },
);

test("calibrate-row-answers: Noul labels read from P(yes), and a Box has no answer category", () => {
  const urgent = sampleCalibrateCtx({ qid: "urgent" });
  // Row 3: answered yes at .70, labeled no: P(no) = .30, so the label trailed by .40.
  const gap = pack.features.find((f) => f.id === "label_gap").value(urgent.items()[3], urgent);
  assert.ok(Math.abs(gap - 0.4) < 1e-9);
  assert.equal(pack.features.find((f) => f.id === "runner_up").value(urgent.items()[3], urgent), null);
  const box = sampleCalibrateCtx({ qid: "spot" });
  assert.equal(pack.features.find((f) => f.id === "answer").value(box.items()[0], box), null);
  for (const feature of pack.features.filter((f) => f.kind === "fact")) feature.value({}, fakeCtx({}));
});
