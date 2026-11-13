// Tests for the priced-mistakes starter pack (static/js/lab/packs/workbench/wb-costs-mistakes.js). Expected values are
// worked out by hand from tests/js/lab/fixtures/workbench-analysis.mjs: review $2, default mistake $20, and three priced
// mistakes department billing → shipping $50, urgent yes → no $120, tone 2 → 0 $35.5.
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/wb-costs-mistakes.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { sampleCostsCtx } from "./fixtures/workbench-analysis.mjs";

const A = { question: "department", label: "billing", answer: "shipping", cost: "50" };
const B = { question: "urgent", label: "yes", answer: "no", cost: "120" };
const C = { question: "tone", label: "2", answer: "0", cost: "35.5" };
const none = () => sampleCostsCtx({ costs: { review: "2", error: "20", mistakes: [] } });

checkPack(pack, {
  price: { items: [{ ...A }, { ...B }, { ...C }, { ...A, cost: "oops" }], values: [50, 120, 35.5, null] },
  price_multiple: { items: [{ ...A }, { ...B }, { ...C }], values: [2.5, 6, 1.775], ctx: sampleCostsCtx(), tolerance: 1e-12 },
  reviews_paid: { items: [{ ...A }, { ...B }, { ...C }, { ...A, cost: "" }], values: [25, 60, 17.75, null], ctx: sampleCostsCtx(), tolerance: 1e-12 },
  below_default: { items: [{ ...A, cost: "10" }, { ...A, cost: "30" }, { ...A, cost: "x" }], values: [true, false, false], ctx: sampleCostsCtx() },
  invalid_price: { items: [{ ...A, cost: "oops" }, { ...A, cost: "5" }, { ...A, cost: "2000000" }, { ...A, cost: "" }], values: [true, false, true, true] },
  question: { items: [{ ...A }, { ...B }, { ...C }], values: ["department", "urgent", "tone"] },
  // spot is a Box question: no price can name it.
  question_type: { items: [{ ...A }, { ...B }, { ...C }, { ...A, question: "spot" }], values: ["choice", "noul", "score", null], ctx: sampleCostsCtx() },
  mistake: { items: [{ ...A }, { ...B }, { ...C }], values: ["department: billing → shipping", "urgent: yes → no", "tone: 2 → 0"] },

  cheaper_than_review: { hit: { ...A, cost: "1" }, miss: [{ ...A }, { ...A, cost: "2" }, { ...A, cost: "oops" }], ctx: sampleCostsCtx(), message: /less than one \$2\.00 review/ },
  not_a_mistake: { hit: { ...B, answer: "yes" }, miss: { ...B }, message: /labeled yes and answered yes/ },
  priced_twice: { hitList: [{ ...A }, { ...B }, { ...A, cost: "70" }], missList: [{ ...A }, { ...B }, { ...C }], message: /positions 1 and 3/ },

  dedupe: { input: [{ ...A }, { ...B }, { ...A, cost: "70" }], output: [{ ...A }, { ...B }], unchanged: [{ ...A }, { ...B }, { ...C }] },
  scale: {
    input: [{ ...A }, { ...B }, { ...C }, { ...B, label: "no", answer: "yes", cost: "x" }],
    params: { factor: "2" },
    output: [{ ...A, cost: "100" }, { ...B, cost: "240" }, { ...C, cost: "71" }, { ...B, label: "no", answer: "yes", cost: "x" }],
    rejects: [{ params: { factor: "-1" }, message: /at least 0/ }],
  },
  sort_by_price: { input: [{ ...A }, { ...A, label: "other", cost: "oops" }, { ...B }, { ...C }], output: [{ ...B }, { ...A }, { ...C }, { ...A, label: "other", cost: "oops" }] },
  drop_not_mistakes: { input: [{ ...A }, { ...B, answer: "yes" }, { ...B }], output: [{ ...A }, { ...B }], unchanged: [{ ...A }, { ...B }, { ...C }] },

  csv: {
    text: "question,label,answer,price\ndepartment,billing,shipping,50\nspot,a,b,3\nurgent,yes,no\n\"tone\",\" 2\",0,35.5\n",
    ctx: sampleCostsCtx(),
    items: [{ ...A }, { ...C }],
    warnings: 2,
    rejects: ["", "question,label,answer,price\n", "spot,a,b,3"],
  },
  mistakes_csv: {
    ctx: sampleCostsCtx({ hide: [1] }),
    filename: "priced-mistakes.csv",
    text: '"question","label","answer","price"\r\n"department","billing","shipping","50"\r\n"tone","2","0","35.5"\r\n',
  },

  highest_price: [
    { ctx: sampleCostsCtx(), expect: 120, empty: none() },
    { ctx: sampleCostsCtx({ hide: [1] }), expect: 50 },
  ],
  priced_questions: [
    { ctx: sampleCostsCtx(), expect: 3, empty: none() },
    { ctx: sampleCostsCtx({ hide: [0] }), expect: 2 },
  ],
  // 1 − 2 / 120, and without the $120 mistake 1 − 2 / 50.
  strictest_break_even: [
    { ctx: sampleCostsCtx(), expect: 1 - 2 / 120, tolerance: 1e-12, empty: none() },
    { ctx: sampleCostsCtx({ hide: [1] }), expect: 0.96, tolerance: 1e-12 },
  ],

  // Shown prices 35.5, 50, 120: the median is 50.
  default_to_median: {
    ctx: () => sampleCostsCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setPrices", "2", "50"]]);
      assert.equal(ctx.data.error, "50");
      assert.match(ctx.env.toasts[0].message, /\$50\.00/);
    },
    hidden: none,
  },
}, { ctx: () => sampleCostsCtx() });

test("wb-costs-mistakes: an even count takes the mean of the middle two prices", () => {
  const ctx = sampleCostsCtx({ hide: [2] });  // 50 and 120
  pack.features.find((f) => f.id === "default_to_median").run(ctx);
  assert.deepEqual(ctx.log, [["setPrices", "2", "85"]]);
});

for (const feature of pack.features.filter((f) => f.kind === "fact")) feature.value({}, fakeCtx({}));
