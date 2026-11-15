// Per-row costs for Calibrate's scored rows (surface "workbench.calibrate"; contract in
// static/js/lab/surfaces/workbench-analysis.js), at the prices in Costs as Calibrate's cost report holds them. A right
// automated row costs nothing, a wrong one its priced mistake (label → answer; the default mistake price when that pair
// is not priced), a reviewed row one review, as jev/cost.py prices them. Arithmetic on the user's own Bulk run and
// prices in this page session: no model call, no storage. There is no cost for a Box question.
import { csvText, definePack } from "../../kit.js";
import { slugify } from "../../lib/text.js";

const EPS = 1e-9;
const DEAR = 10;   // an automated mistake costing this many reviews or more is worth a look

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const money = (value) => `$${value.toFixed(2)}`;
const fixed = (value, digits = 2) => (num(value) === null ? "" : value.toFixed(digits));
const thresholdOf = (ctx) => num(ctx?.data?.threshold) ?? 0.5;
const automated = (item, ctx) => num(item?.signal) !== null && item.signal + EPS >= thresholdOf(ctx);
const fileQid = (ctx) => slugify(ctx?.data?.qid || "") || "question";

// { review, error, priced: Map("label\0answer" -> price) } for Calibrate's question, or null.
function pricesOf(ctx) {
  const cost = ctx?.data?.cost;
  const review = num(cost?.review), error = num(cost?.error);
  if (review === null || error === null) return null;
  const priced = new Map();
  for (const m of Array.isArray(cost.mistakes) ? cost.mistakes : []) {
    if (isObject(m) && m.question === ctx.data.qid && num(m.cost) !== null) priced.set(`${m.label}\u0000${m.answer}`, m.cost);
  }
  return { review, error, priced };
}

function automateCost(item, prices) {
  if (!prices || typeof item?.correct !== "boolean") return null;
  if (item.correct) return 0;
  const priced = prices.priced.get(`${item.label}\u0000${item.predicted}`);
  return priced === undefined ? prices.error : priced;
}

function routingCost(item, ctx, prices) {
  const auto = automateCost(item, prices);
  if (auto === null || num(item.signal) === null) return null;
  return automated(item, ctx) ? auto : prices.review;
}

// The shown rows with their costs, or null when a price or a row's cost is missing.
function costed(ctx) {
  const prices = pricesOf(ctx), rows = ctx.shown();
  if (!prices || !rows.length) return null;
  const out = rows.map((item) => ({ item, auto: automateCost(item, prices), routed: routingCost(item, ctx, prices) }));
  return out.some((entry) => entry.auto === null || entry.routed === null) ? null : { prices, rows: out };
}

export default definePack({
  id: "calibrate-row-costs",
  surface: "workbench.calibrate",
  title: "Calibrate: row costs",
  about: "What each scored row costs at the slider and at the prices in Costs, what automating or reviewing it would cost, and cost totals for the shown rows, with a row-level export. Arithmetic on your own run and prices in this page session; nothing calls the model.",
  features: [
    // ---------- row facts ----------
    { id: "automate_cost", kind: "fact", type: "number", label: "cost if automated", unit: "$",
      help: "Nothing for a right answer; for a wrong one, the price of that mistake (label → answer) in Costs, or the default mistake price.",
      value: (item, ctx) => automateCost(item, pricesOf(ctx)) },
    { id: "routing_cost", kind: "fact", type: "number", label: "cost at the slider", unit: "$",
      help: "One review when the slider sends the row to review; what automating it costs otherwise.",
      value: (item, ctx) => routingCost(item, ctx, pricesOf(ctx)) },
    { id: "hindsight_regret", kind: "fact", type: "number", label: "cost above the cheaper route in hindsight", unit: "$",
      help: "The row's cost at the slider minus the cheaper of reviewing and automating it, knowing its label.",
      value: (item, ctx) => {
        const prices = pricesOf(ctx);
        const routed = routingCost(item, ctx, prices), auto = automateCost(item, prices);
        return routed === null || auto === null ? null : routed - Math.min(prices.review, auto);
      } },
    { id: "costly_mistake", kind: "fact", type: "flag", label: "a mistake priced above the default",
      help: "Wrong, and its label → answer pair is priced in Costs above the default mistake price.",
      value: (item, ctx) => {
        const prices = pricesOf(ctx), auto = automateCost(item, prices);
        return item.correct === false && auto !== null && auto > prices.error + EPS;
      } },
    { id: "cheaper_route", kind: "fact", type: "category", label: "cheaper route in hindsight",
      help: "Knowing the label: automate when automating costs less than a review, review when it costs more, either when they tie.",
      value: (item, ctx) => {
        const prices = pricesOf(ctx), auto = automateCost(item, prices);
        if (auto === null) return null;
        return auto < prices.review - EPS ? "automate" : auto > prices.review + EPS ? "review" : "either";
      } },

    // ---------- check ----------
    { id: "dear_automated_mistake", kind: "diagnostic", severity: "advice", label: `Automated mistake costing ${DEAR} reviews or more`,
      check: (item, ctx) => {
        const prices = pricesOf(ctx), auto = automateCost(item, prices);
        if (!prices || item.correct !== false || !automated(item, ctx) || auto === null || !(prices.review > 0) || auto < DEAR * prices.review - EPS) return null;
        return `the slider automates this mistake (${item.label} answered ${item.predicted}), which costs ${money(auto)}, as much as ${Math.round((auto / prices.review) * 10) / 10} reviews`;
      } },

    // ---------- metrics on the shown rows ----------
    { id: "shown_cost_per_1000", kind: "metric", format: "usd", label: "cost per 1,000 shown rows at the slider",
      help: "At the prices in Costs, for the rows Lab shows; with no Lab filter it matches Calibrate's cost line.",
      compute: (ctx) => {
        const all = costed(ctx);
        if (!all) return null;
        const total = all.rows.reduce((sum, entry) => sum + entry.routed, 0);
        return { value: (total / all.rows.length) * 1000, detail: `${money(total)} over ${all.rows.length} rows` };
      } },
    { id: "hindsight_cost_per_1000", kind: "metric", format: "usd", label: "cost per 1,000 shown rows if each took its cheaper route",
      help: "A floor no threshold can beat: each row reviewed or automated, whichever costs less knowing its label.",
      compute: (ctx) => {
        const all = costed(ctx);
        if (!all) return null;
        const total = all.rows.reduce((sum, entry) => sum + Math.min(all.prices.review, entry.auto), 0);
        return { value: (total / all.rows.length) * 1000, detail: `${money(total)} over ${all.rows.length} rows` };
      } },
    { id: "automated_mistake_cost", kind: "metric", format: "usd", label: "cost of the shown mistakes the slider automates",
      compute: (ctx) => {
        const all = costed(ctx);
        if (!all) return null;
        const wrong = all.rows.filter((entry) => automated(entry.item, ctx) && entry.item.correct === false);
        return { value: wrong.reduce((sum, entry) => sum + entry.auto, 0), detail: `${wrong.length} automated mistake${wrong.length === 1 ? "" : "s"}` };
      } },
    { id: "needless_review_cost", kind: "metric", format: "usd", label: "cost of the shown reviews that find nothing wrong",
      compute: (ctx) => {
        const all = costed(ctx);
        if (!all) return null;
        const needless = all.rows.filter((entry) => !automated(entry.item, ctx) && entry.item.correct === true).length;
        return { value: needless * all.prices.review, detail: `${needless} review${needless === 1 ? "" : "s"} at ${money(all.prices.review)}` };
      } },
    { id: "loss_per_automated_row", kind: "metric", format: "usd", label: "mistake cost per automated shown row",
      help: "What each automated row costs in mistakes on average: automating pays while this stays below the review price.",
      compute: (ctx) => {
        const all = costed(ctx);
        if (!all) return null;
        const auto = all.rows.filter((entry) => automated(entry.item, ctx));
        if (!auto.length) return { value: null, detail: "the slider automates no shown row" };
        const total = auto.reduce((sum, entry) => sum + entry.auto, 0);
        return { value: total / auto.length, detail: `${money(total)} over ${auto.length} automated rows, against a ${money(all.prices.review)} review` };
      } },

    // ---------- export ----------
    { id: "row_costs_csv", kind: "exporter", label: "Shown rows' costs at the slider as CSV", mime: "text/csv",
      help: "Your run's answers and labels for the shown rows, numbered as Bulk's #, with the route at the slider and what each row costs at your prices routed, automated or reviewed. No input text.",
      filename: (ctx) => `calibrate-${fileQid(ctx)}-row-costs.csv`,
      build: (ctx) => {
        const all = costed(ctx);
        if (!all) throw new Error("There is no cost yet: label some rows of a Choice, Noul or Score question and enter valid prices.");
        return csvText([["Bulk #", "label", "answer", "right", "signal", "route", "cost at the slider", "cost if automated", "cost if reviewed"],
          ...all.rows.map(({ item, auto, routed }) => [item.number, item.label, item.predicted, item.correct ? "yes" : "no", fixed(item.signal),
            automated(item, ctx) ? "automated" : "review", fixed(routed), fixed(auto), fixed(all.prices.review)])]);
      } },
  ],
});
