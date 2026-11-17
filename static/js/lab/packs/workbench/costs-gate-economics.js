// Gate economics in Costs (surface "workbench.costs"; contract in static/js/lab/surfaces/workbench-analysis.js): what
// an automated row costs in mistakes, how far the automated rows' accuracy sits above break-even, reviews spent per
// mistake avoided, savings against automating everything, the review price at which the threshold stops paying, how
// flat the cost curve is near its lowest point, and what the lowest-cost gates would change. Every figure is
// arithmetic on the cost reports Calibrate and Policy already computed from the user's own run and prices in this
// page session: no model call, nothing saved. Tuned figures are optimistic until checked on unseen rows.
import { csvText, definePack, runMetrics } from "../../kit.js";

const EPS = 1e-9;
const FLAT = 0.1; // a threshold within this share of the lowest cost counts as near the cheapest

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const money = (value) => `$${value.toFixed(2)}`;
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const fixed = (value) => (num(value) === null ? "" : value.toFixed(2));

// A cost line as { n, review, auto, wrong, cost, all } where `all` is automating every row: Calibrate's sweep point at
// the slider, or Policy's current gates. null when the report lacks a figure.
function calLine(ctx) {
  const cal = ctx?.data?.calibrate,
    cost = cal?.cost;
  if (!isObject(cost) || !Array.isArray(cost.sweep)) return null;
  const point = cost.sweep[Math.round((num(cal.threshold) ?? 0.5) * 100)];
  return shape(cost, point);
}
function polLine(ctx) {
  const cost = ctx?.data?.policy?.cost;
  return isObject(cost) ? shape(cost, cost.current) : null;
}
function shape(cost, point) {
  const n = num(cost.labeled),
    review = num(cost.review);
  if (!(n > 0) || review === null || !isObject(point)) return null;
  const auto = num(point.automated),
    wrong = num(point.wrong),
    total = num(point.cost);
  if (auto === null || wrong === null || total === null) return null;
  const all =
    isObject(cost.automate_all) && num(cost.automate_all.cost) !== null && num(cost.automate_all.wrong) !== null
      ? cost.automate_all
      : null;
  return {
    n,
    review,
    auto,
    wrong,
    cost: total,
    reviews: n - auto,
    mistakes: total - review * (n - auto),
    all,
    breakEven: num(cost.break_even),
  };
}

const lossPerAutomated = (line) => {
  if (!line) return null;
  if (!line.auto) return { value: null, detail: "nothing is automated" };
  return {
    value: line.mistakes / line.auto,
    detail: `${money(line.mistakes)} in mistakes over ${line.auto} automated rows, against a ${money(line.review)} review`,
  };
};
const headroom = (line) => {
  if (!line || line.breakEven === null) return null;
  if (!line.auto) return { value: null, detail: "nothing is automated" };
  const accuracy = (line.auto - line.wrong) / line.auto;
  return {
    value: accuracy - line.breakEven,
    detail: `automated rows right ${percent(accuracy)}; automating pays above ${percent(line.breakEven)} at the default price`,
  };
};
const reviewsPerAvoided = (line) => {
  if (!line || !line.all) return null;
  const avoided = line.all.wrong - line.wrong;
  if (avoided <= 0)
    return { value: null, detail: "these reviews avoid no mistake that automating every row would make" };
  return {
    value: line.reviews / avoided,
    detail: `${line.reviews} reviews avoid ${avoided} mistake${avoided === 1 ? "" : "s"}`,
  };
};
const savingsVsAll = (line) => {
  if (!line || !line.all || !(line.all.cost > 0)) return null;
  return {
    value: (line.all.cost - line.cost) / line.all.cost,
    detail: `${money(line.cost)} against ${money(line.all.cost)} automating every row`,
  };
};
const reviewTie = (line) => {
  if (!line || !line.all) return null;
  if (!line.reviews) return { value: null, detail: "nothing goes to review" };
  return {
    value: (line.all.cost - line.mistakes) / line.reviews,
    detail: `above this review price, automating every row costs less than ${line.reviews} reviews save`,
  };
};

// The thresholds of Calibrate's cost sweep within FLAT of its lowest cost.
function nearCheapest(ctx) {
  const sweep = ctx?.data?.calibrate?.cost?.sweep;
  if (!Array.isArray(sweep)) return null;
  const points = sweep.filter((p) => isObject(p) && num(p.cost) !== null && num(p.threshold) !== null);
  if (!points.length) return null;
  const lowest = Math.min(...points.map((p) => p.cost));
  return { lowest, near: points.filter((p) => p.cost <= lowest * (1 + FLAT) + EPS) };
}

const METRICS = [
  // ---------- Calibrate ----------
  {
    id: "cal_loss_per_automated",
    kind: "metric",
    format: "usd",
    label: "Calibrate: mistake cost per automated row at the slider",
    help: "Automating pays while this stays below the review price.",
    compute: (ctx) => lossPerAutomated(calLine(ctx)),
  },
  {
    id: "cal_break_even_headroom",
    kind: "metric",
    format: "percent",
    label: "Calibrate: automated accuracy above break-even at the slider",
    help: "The automated rows' accuracy minus 1 − review ÷ default mistake price. Negative: they are less accurate than automating pays for.",
    compute: (ctx) => headroom(calLine(ctx)),
  },
  {
    id: "cal_reviews_per_mistake_avoided",
    kind: "metric",
    format: "number",
    label: "Calibrate: reviews per mistake avoided at the slider",
    help: "Rows sent to review over the mistakes that automating every row would make and the slider avoids.",
    compute: (ctx) => reviewsPerAvoided(calLine(ctx)),
  },
  {
    id: "cal_savings_vs_automate_all",
    kind: "metric",
    format: "percent",
    label: "Calibrate: savings against automating every row",
    help: "As a share of the automate-all cost. Negative: the slider costs more than automating everything.",
    compute: (ctx) => savingsVsAll(calLine(ctx)),
  },
  {
    id: "cal_review_price_tie",
    kind: "metric",
    format: "usd",
    label: "Calibrate: review price at which the slider ties automating every row",
    help: "The mistakes the slider's reviews avoid, in dollars, over the number of reviews.",
    compute: (ctx) => reviewTie(calLine(ctx)),
  },
  {
    id: "cal_near_cheapest_width",
    kind: "metric",
    format: "number",
    label: `Calibrate: width of the thresholds within ${FLAT * 100}% of the lowest cost`,
    help: "Highest minus lowest threshold on the 0.01 cost sweep whose cost is within 10% of the lowest: wide means the exact threshold matters little.",
    compute: (ctx) => {
      const found = nearCheapest(ctx);
      if (!found) return null;
      const ts = found.near.map((p) => p.threshold);
      const low = Math.min(...ts),
        high = Math.max(...ts);
      return {
        value: high - low,
        detail: `${fixed(low)} to ${fixed(high)} (${found.near.length} steps) cost at most ${money(found.lowest * (1 + FLAT))}`,
      };
    },
  },
  {
    id: "cal_slider_to_cheapest",
    kind: "metric",
    format: "number",
    label: "Calibrate: slider minus the lowest-cost threshold",
    help: "Positive: the slider sends more rows to review than the cheapest threshold.",
    compute: (ctx) => {
      const cal = ctx?.data?.calibrate,
        cost = cal?.cost;
      if (!isObject(cost)) return null;
      const best = num(cost.best?.gates?.[cal.qid]);
      if (best === null) return { value: null, detail: "reviewing every row is cheapest at these prices" };
      return {
        value: (num(cal.threshold) ?? 0.5) - best,
        detail: `slider ${fixed(cal.threshold)}, lowest cost at ${fixed(best)}`,
      };
    },
  },
  {
    id: "cal_cost_spread",
    kind: "metric",
    format: "usd",
    label: "Calibrate: dearest minus cheapest threshold, per 1,000 rows",
    help: "How much the choice of threshold can matter at these prices, over the 0.01 cost sweep.",
    compute: (ctx) => {
      const sweep = ctx?.data?.calibrate?.cost?.sweep;
      const per = Array.isArray(sweep) ? sweep.map((p) => num(p?.per_1000)).filter((v) => v !== null) : [];
      if (!per.length) return null;
      return {
        value: Math.max(...per) - Math.min(...per),
        detail: `from ${money(Math.min(...per))} to ${money(Math.max(...per))} per 1,000 rows`,
      };
    },
  },

  // ---------- Policy ----------
  {
    id: "pol_loss_per_automated",
    kind: "metric",
    format: "usd",
    label: "Policy: mistake cost per automated row at the current gates",
    help: "Automating pays while this stays below the review price.",
    compute: (ctx) => lossPerAutomated(polLine(ctx)),
  },
  {
    id: "pol_break_even_headroom",
    kind: "metric",
    format: "percent",
    label: "Policy: automated accuracy above break-even at the current gates",
    compute: (ctx) => headroom(polLine(ctx)),
  },
  {
    id: "pol_reviews_per_mistake_avoided",
    kind: "metric",
    format: "number",
    label: "Policy: reviews per mistake avoided at the current gates",
    compute: (ctx) => reviewsPerAvoided(polLine(ctx)),
  },
  {
    id: "pol_savings_vs_automate_all",
    kind: "metric",
    format: "percent",
    label: "Policy: savings against automating every row",
    compute: (ctx) => savingsVsAll(polLine(ctx)),
  },
  {
    id: "pol_review_price_tie",
    kind: "metric",
    format: "usd",
    label: "Policy: review price at which the current gates tie automating every row",
    compute: (ctx) => reviewTie(polLine(ctx)),
  },
  {
    id: "pol_break_even_price",
    kind: "metric",
    format: "usd",
    label: "Policy: mistake price at which the current gates tie reviewing every row",
    help: "Review price × automated rows ÷ automated mistakes, treating every mistake at one price: below it the gates beat reviewing every row.",
    compute: (ctx) => {
      const line = polLine(ctx);
      if (!line || !line.auto) return null;
      if (!line.wrong)
        return {
          value: null,
          detail: "No automated row is wrong at these gates: they beat reviewing every row at any mistake price.",
        };
      return {
        value: (line.review * line.auto) / line.wrong,
        detail: `${line.auto} automated rows, ${line.wrong} wrong`,
      };
    },
  },
  {
    id: "pol_cheapest_coverage_change",
    kind: "metric",
    format: "percent",
    label: "Policy: change in rows automated at the lowest-cost gates",
    help: "The lowest-cost gates' share of rows automated minus the current gates' share. Negative: the cheapest gates send more rows to review.",
    compute: (ctx) => {
      const line = polLine(ctx),
        cheapest = ctx?.data?.policy?.cheapest;
      if (!line || !isObject(cheapest)) return null;
      const best = isObject(cheapest.best) && num(cheapest.best.automated) !== null ? cheapest.best.automated : 0;
      return {
        value: (best - line.auto) / line.n,
        detail: `${line.auto} of ${line.n} rows automated now, ${best} at the lowest-cost gates`,
      };
    },
  },
  {
    id: "pol_cheapest_moves",
    kind: "metric",
    format: "text",
    label: "Policy: what the lowest-cost gates change",
    help: "Each checked gate whose lowest-cost threshold differs from its current one. Advisory: apply it from Policy.",
    compute: (ctx) => {
      const policy = ctx?.data?.policy,
        cheapest = policy?.cheapest;
      if (!isObject(cheapest) || !Object.keys(policy.active || {}).length) return null;
      if (!isObject(cheapest.best?.gates))
        return { value: "review every row", detail: "no thresholds beat reviewing every row at these prices" };
      const moves = Object.entries(cheapest.best.gates)
        .filter(([qid, t]) => num(policy.active[qid]) !== null && Math.abs(t - policy.active[qid]) > EPS)
        .map(([qid, t]) => `${qid} ${fixed(policy.active[qid])} → ${fixed(t)}`);
      return moves.length
        ? { value: moves.join(", "), detail: `${money(num(cheapest.best.per_1000) ?? 0)} per 1,000 rows` }
        : { value: "nothing", detail: "the current gates are the cheapest" };
    },
  },
];

export default definePack({
  id: "costs-gate-economics",
  surface: "workbench.costs",
  title: "Costs: gate economics",
  about:
    "What an automated row costs in mistakes, accuracy above break-even, reviews spent per mistake avoided, savings against automating everything, the review price at which a threshold stops paying, how flat Calibrate's cost curve is, and what the lowest-cost Policy gates would change. Arithmetic on the cost reports of your own run in this page session; nothing calls the model.",
  features: [
    ...METRICS,
    {
      id: "economics_csv",
      kind: "exporter",
      label: "Gate economics as CSV",
      mime: "text/csv",
      filename: "gate-economics.csv",
      help: "Aggregates only: every figure of this pack for Calibrate's slider and Policy's current gates, with its basis. No rows, answers or labels.",
      build: (ctx) => {
        const rows = runMetrics(
          METRICS.map((metric) => [metric.id, metric]),
          ctx,
        ).filter((row) => row.value !== null);
        if (!rows.length)
          throw new Error("There is no cost yet: run the rows in Bulk, label some, and enter valid prices.");
        return csvText([
          ["measure", "value", "basis"],
          ...rows.map((row) => [
            row.label,
            typeof row.value === "number" ? row.value.toFixed(4) : String(row.value),
            row.detail,
          ]),
        ]);
      },
    },
  ],
});
