// Starter pack on workbench.build.result. Expected values are worked out by hand from the fixture Run
// (tests/js/lab/fixtures/workbench-build.mjs): intent refund 0.82 / 0.11 / 0.07, urgency 1.35 with 0.1 / 0.45 / 0.45,
// angry P(yes) 0.64, a mug box, refund_amount_ok P(yes) 0.12, tone upset 0.52 against calm 0.48; expectations
// intent = refund, angry ≤ 0.5, and a mug box that overlaps the answer with IoU 0.14 / 0.22 ≈ 0.64.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/wb-build-answer-insights.js";
import { runExporter } from "../../../static/js/lab/kit.js";
import { checkPack } from "./harness.mjs";
import { buildRows, sampleBuildResultCtx } from "./fixtures/workbench-build.mjs";

const ctx = sampleBuildResultCtx();
const items = ctx.items();
const [intent, urgency, angry, mugBox] = items;
const tone = items[5];
const empty = () => sampleBuildResultCtx({ result: null });
const three = { hide: ["mug_box", "refund_amount_ok", "tone"] };
const p = (...values) => ({ probabilities: values.map((value, index) => ({ key: String(index), p: value })) });

checkPack(pack, {
  // Top two: 0.82 - 0.11, 0.45 - 0.45, Noul 0.64 - 0.36, no probabilities on a Box, 0.88 - 0.12, 0.52 - 0.48.
  margin: { items: [...items, { probabilities: [null, { key: "a", p: 0.3 }, { key: "b", p: "0.9" }] }], values: [0.71, 0, 0.28, null, 0.76, 0.04, null], ctx },
  confidence: { items, values: [0.82, 0.45, null, 0.71, null, 0.52], ctx },
  top_probability: { items, values: [0.82, 0.45, 0.64, null, 0.88, 0.52], ctx },
  // intent = refund (met); angry 0.64 > max 0.5 (missed); mug box IoU 0.14 / 0.22 = 7/11 ≥ 0.5 (met). The extra items:
  // a Score of 1.2 against a text bound "1.5" (float() reads it: missed), a Choice whose chosen option has p 0.6 against
  // min 0.7 (missed even though the choice matches), and a bound that is not a number (nothing checked).
  expectation_check: { items: [...items,
    { type: "score", value: 1.2, expectation: { min: "1.5" }, answer: { type: "score", score: 1.2 } },
    { type: "choice", value: "a", expectation: { choice: "a", min: 0.7 }, answer: { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.4 } } },
    { type: "noul", value: 0.9, expectation: { min: "high" }, answer: { type: "noul", noul: 0.9 } },
    // The same mug box against a stricter floor written as text: IoU 7/11 = 0.636 < 0.7 (missed); an expected box with a
    // missing edge checks nothing.
    { type: "box", box: { left: 0.25, top: 0.3, right: 0.65, bottom: 0.7 }, expectation: { box: { left: 0.2, top: 0.3, right: 0.6, bottom: 0.8 }, iou_min: "0.7" } },
    { type: "box", box: { left: 0.25, top: 0.3, right: 0.65, bottom: 0.7 }, expectation: { box: { left: 0.2, top: 0.3, right: 0.6 } } }],
  values: ["met", null, "missed", "met", null, null, "missed", "missed", null, "missed", null], ctx },
  answer_type: { items, values: ["choice", "score", "noul", "box", "noul", "choice"], ctx },
  box_area: { items: [{ box: { left: 0, top: 0, right: 0.5, bottom: 0.5 } }, { box: { left: 0.25, top: 0.3, right: 0.65, bottom: 0.7 } }, { box: null },
    { box: { left: 0.6, top: 0.2, right: 0.4, bottom: 0.5 } }, { box: { left: 0.1, top: 0.1, right: 0.3 } }],
  values: [0.25, 0.16, null, 0, null], tolerance: 1e-12 },
  question_gone: (() => {
    const gone = sampleBuildResultCtx({ rows: buildRows().slice(0, 6) });
    return { items: gone.items(), values: [false, false, false, false, false, true], ctx: gone };
  })(),
  // (0.5, 0.25, 0.25): (0.5 ln 2 + 0.5 ln 4) / ln 3 = 1.5 ln 2 / ln 3 = 0.9463946...; (0.2, 0.2) rescales to (0.5, 0.5).
  entropy: { items: [p(0.5, 0.5), p(1, 0), p(0.25, 0.25, 0.25, 0.25), p(1), p(0.5, 0.25, 0.25), p(0.2, 0.2), p(0, 0)],
    values: [1, 0, 1, null, 1.5 * Math.LN2 / Math.log(3), 1, null], tolerance: 1e-12 },

  close_call: { hit: [tone, urgency], miss: [intent, mugBox], message: /^The top two answers are within (4\.0|0\.0) points/ },
  between_levels: { hit: [urgency, { type: "score", value: 0.5 }], miss: [{ type: "score", value: 1.9 }, { type: "score", value: 1.3 }, { type: "choice", value: "refund" }],
    message: /^Score (1\.35|0\.50) sits between level (1 and level 2|0 and level 1) \(local rule/ },
  missed_expectation: { hit: angry, miss: [intent, urgency], message: /misses the human expectation/ },

  mean_confidence: [{ ctx, expect: 0.625, empty: empty() }, { ctx: sampleBuildResultCtx({ hide: ["intent"] }), expect: 0.56 }],
  latency_per_question: { ctx, expect: 412 / 6, empty: empty() },
  tokens_per_question: { ctx, expect: 321, empty: empty() },
  cost_per_thousand: { ctx, expect: 0.412, empty: empty() },
  expectations_met: [{ ctx, expect: 2 / 3, empty: empty() }, { ctx: sampleBuildResultCtx({ expect: {} }), expect: null }],

  answers_csv: { ctx: sampleBuildResultCtx(three), filename: "jev-build-answers.csv",
    text: "\"question\",\"type\",\"answer\",\"top_probability\",\"confidence\",\"margin\",\"outdated\"\r\n"
      + "\"intent\",\"choice\",\"refund\",\"0.8200\",\"0.8200\",\"0.7100\",\"no\"\r\n"
      + "\"urgency\",\"score\",\"1.35 / 2\",\"0.4500\",\"0.4500\",\"0.0000\",\"no\"\r\n"
      + "\"angry\",\"noul\",\"64.0%\",\"0.6400\",\"\",\"0.2800\",\"no\"\r\n",
    excludes: ["maya@customers.example", "upset"] },
  answers_markdown: { ctx: sampleBuildResultCtx({ ...three, stale: true }), filename: "jev-build-answers.md",
    text: "Answers from your latest Run in this page session, OUTDATED: the request changed since.\n\n| Question | Type | Answer | Confidence |\n"
      + "| --- | --- | --- | --- |\n| intent | choice | refund | 82% |\n| urgency | score | 1.35 / 2 | 45% |\n| angry | noul | 64.0% | — |\n" },

  inspect_run: { ctx: () => sampleBuildResultCtx(), check: (c) => assert.deepEqual(c.log, [["inspect"]]), hidden: empty },
  save_as_test: { ctx: () => sampleBuildResultCtx(), check: (c) => { assert.deepEqual(c.log, [["openSave"]]); assert.equal(c.data.saveOpen, true); },
    hidden: () => sampleBuildResultCtx({ stale: true }) },
}, { ctx: () => sampleBuildResultCtx() });

test("answer exports refuse when nothing is shown and never fall back to every answer", () => {
  const exporter = pack.features.find((feature) => feature.id === "answers_csv");
  assert.throws(() => runExporter(exporter, sampleBuildResultCtx({ result: null })), /No answers are shown/);
  assert.throws(() => runExporter(exporter, sampleBuildResultCtx({ hide: ["intent", "urgency", "angry", "mug_box", "refund_amount_ok", "tone"] })), /No answers are shown/);
});

test("Markdown cells escape pipes and line breaks in question ids", () => {
  const result = { answers: { "a|b\nc": { type: "noul", noul: 0.5 } }, meta: {}, trace: { request: { state: "", questions: {} } } };
  const out = runExporter(pack.features.find((feature) => feature.id === "answers_markdown"), sampleBuildResultCtx({ result }));
  assert.match(out.text, /\| a\\\|b c \| noul \| 50\.0% \| — \|/);
});
