// Tests for static/js/lab/packs/workbench/costs-price-facts.js. Expected values are worked out by hand from
// tests/js/lab/fixtures/workbench-analysis.mjs: review $2, default mistake $20, three priced mistakes
//   department billing → shipping $50 · urgent yes → no $120 · tone 2 → 0 $35.50   (total $205.50)
// and the run's questions department (Choice: billing, shipping, wholesale, other), urgent (Noul) and tone (Score 0–2).
import assert from "node:assert/strict";
import { test } from "node:test";

import pack from "../../../static/js/lab/packs/workbench/costs-price-facts.js";
import { checkPack, fakeCtx } from "./harness.mjs";
import { COSTS, sampleCostsCtx } from "./fixtures/workbench-analysis.mjs";

const base = sampleCostsCtx();
const items = base.items();
const mistake = (question, label, answer, cost) => ({ question, label, answer, cost });
const [m1, m2, m3] = COSTS.mistakes.map((m) => ({ ...m }));
const m4 = mistake("department", "shipping", "billing", "30");
const withReverse = sampleCostsCtx({ costs: { ...COSTS, mistakes: [...COSTS.mistakes, m4] } });
const lop = sampleCostsCtx({ costs: { ...COSTS, mistakes: [mistake("department", "billing", "shipping", "500"), mistake("department", "shipping", "billing", "20"), m2] } });
const bands = ["0", "1", "10", "20", "50", "500", "abc"].map((cost) => mistake("department", "billing", "other", cost));
const toneNear = mistake("tone", "2", "1", "30"), toneFar = mistake("tone", "2", "0", "10");

checkPack(pack, {
  reviews_per_mistake: { items, values: [25, 60, 17.75], ctx: base },
  times_default: { items, values: [2.5, 6, 1.775], ctx: base, tolerance: 1e-12 },
  reverse_gap: { items: withReverse.items(), values: [20, null, null, -20], ctx: withReverse },
  price_band: { items: bands, ctx: base,
    values: ["free", "below a review", "between a review and the default", "the default", "above the default", "over 10× the default", null] },
  share_of_listed: { items, values: [50 / 205.5, 120 / 205.5, 35.5 / 205.5], ctx: base, tolerance: 1e-12 },

  default_at_or_below_review: { hitList: items, missList: items, ctx: sampleCostsCtx({ costs: { ...COSTS, review: "25" } }), missCtx: base,
    message: /^The default mistake price \$20\.00 is no more than a review \(\$25\.00\)/ },
  score_not_monotone: { hitList: [toneNear, toneFar], missList: items, ctx: base,
    message: /^tone: labeled 2, answered 0 \(\$10\.00\) is priced below answered 1 \(\$30\.00\), though it is further off/ },
  lopsided_reverse: { hit: lop.items()[0], miss: [lop.items()[1], lop.items()[2]], ctx: lop,
    message: /priced \$500\.00, 25× its reverse \(shipping answered billing, \$20\.00\)/ },

  symmetrize: { input: [m1, m4, m2], output: [m1, { ...m4, cost: "50" }, m2], unchanged: [m1, m2, m3] },
  cap_prices: { input: [m1, m2, m3], params: { cap: 100 }, output: [m1, { ...m2, cost: "100" }, m3], unchanged: [m1, m3] },
  score_monotone: { input: [toneNear, toneFar, m1], output: [toneNear, { ...toneFar, cost: "30" }, m1], unchanged: [m1, m2, m3], ctx: base },
  review_multiple: { input: [m1, m2, m3], params: { multiple: 10 }, output: [m1, m2, m3].map((m) => ({ ...m, cost: "20" })), ctx: base },
  prices_tsv: { ctx: base, filename: "priced-mistakes.tsv",
    text: "question\tlabel\tanswer\tprice\ndepartment\tbilling\tshipping\t50\nurgent\tyes\tno\t120\ntone\t2\t0\t35.5\n" },

  json_price_list: { ctx: base, warnings: 1,
    text: "{\"review\":2,\"error\":20,\"mistakes\":[{\"question\":\"department\",\"label\":\"billing\",\"answer\":\"other\",\"cost\":12.5},{\"question\":\"nope\",\"label\":\"a\",\"answer\":\"b\",\"cost\":1}]}",
    items: [mistake("department", "billing", "other", "12.5")],
    rejects: ["not json", "{}", "[]"] },
  tsv: { ctx: base, warnings: 1, text: "question\tlabel\tanswer\tprice\ndepartment\tother\tbilling\t$7\nurgent\tno\tyes\tx\n",
    items: [mistake("department", "other", "billing", "7")], rejects: ["", "a\tb\n"] },
  markdown_table: { ctx: base,
    text: "| question | label | answer | price | break-even accuracy |\n| --- | --- | --- | --- | --- |\n| tone | 0 | 2 | $40.00 | 95.0% |\n",
    items: [mistake("tone", "0", "2", "40")], rejects: ["no table here", "| a | b |\n| - | - |\n| 1 | 2 |"] },

  default_to_highest: {
    ctx: () => sampleCostsCtx(),
    check: (ctx) => {
      assert.deepEqual(ctx.log, [["setPrices", "2", "120"]]);
      assert.match(ctx.env.toasts[0].message, /\$120\.00/);
    },
    hidden: () => sampleCostsCtx({ costs: { ...COSTS, mistakes: [] } }),
  },
}, { ctx: () => sampleCostsCtx() });

test("costs-price-facts: Score prices are raised from the highest nearer price, and only shown ones change", async () => {
  const { previewTransform } = await import("../../../static/js/lab/kit.js");
  const edit = pack.features.find((f) => f.id === "score_monotone");
  // Label 0 answered higher: 1 at $40, 2 at $25 → raised to $40. Label 2 answered 1 at $5 stays (nothing nearer).
  const input = [mistake("tone", "0", "1", "40"), mistake("tone", "0", "2", "25"), mistake("tone", "2", "1", "5")];
  const all = previewTransform("k", edit, input, new Set([0, 1, 2]), {}, base);
  assert.deepEqual(all.next.map((m) => m.cost), ["40", "40", "5"]);
  const hidden = previewTransform("k", edit, input, new Set([0, 2]), {}, base);
  assert.deepEqual(hidden.next.map((m) => m.cost), ["40", "25", "5"]);
});

test("costs-price-facts: a free reverse counts as lopsided, and an exported JSON price list imports back", async () => {
  const free = sampleCostsCtx({ costs: { ...COSTS, mistakes: [mistake("urgent", "yes", "no", "120"), mistake("urgent", "no", "yes", "0")] } });
  assert.match(pack.features.find((f) => f.id === "lopsided_reverse").check(free.items()[0], free), /its reverse \(no answered yes\) is free/);
  const { runImporter } = await import("../../../static/js/lab/kit.js");
  const exported = JSON.stringify({ review: 2, error: 20, mistakes: [{ ...m1, cost: 50 }, { ...m2, cost: 120 }, { ...m3, cost: 35.5 }] });
  assert.deepEqual(runImporter(pack.features.find((f) => f.id === "json_price_list"), exported, base).items, [m1, m2, m3]);
  for (const feature of pack.features.filter((f) => f.kind === "fact")) feature.value({}, fakeCtx({}));
  // The tab-separated export pastes back into the tab-separated import unchanged.
  const tsv = pack.features.find((f) => f.id === "prices_tsv").build(base);
  assert.deepEqual(runImporter(pack.features.find((f) => f.id === "tsv"), tsv, base).items, [m1, m2, m3]);
});

test("price edits keep sub-cent prices, which Costs accepts", () => {
  const feature = (id) => pack.features.find((f) => f.id === id);
  // A $0.001 review times 2 is $0.002, not a free mistake.
  const cheap = sampleCostsCtx({ costs: { ...COSTS, review: "0.001" } });
  assert.equal(feature("review_multiple").each(m1, { multiple: 2 }, cheap).cost, "0.002");
  // A typed $0.005 cap writes $0.005, never a rounded $0.01 above the cap.
  assert.equal(feature("cap_prices").each({ ...m1, cost: "0.009" }, { cap: 0.005 }, base).cost, "0.005");
});
