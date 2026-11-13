// More for the priced mistakes in Costs (surface "workbench.costs"; contract in static/js/lab/surfaces/workbench-analysis.js):
// per-mistake facts, cost metrics and price what-ifs over the cost reports Calibrate and Policy already computed,
// price-list edits (preview, Apply, Undo through the page's own edit path) and configuration or aggregate exports.
// Prices are the user's own session configuration; metrics are arithmetic on reports of the user's own run. No model
// call, no storage, nothing kept after the page session.
import { csvText, definePack, toNumber } from "../../kit.js";
import { round } from "../../lib/math.js";
import { formatMarkdownTable } from "../../lib/tables.js";

const MAX_PRICE = 1e6;
const MAX_MISTAKES = 100;
const EPS = 1e-9;

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const price = (item) => {
  const value = toNumber(item?.cost);
  return value !== null && value >= 0 && value <= MAX_PRICE ? value : null;
};
const reviewPrice = (ctx) => toNumber(ctx?.data?.review);
const defaultPrice = (ctx) => toNumber(ctx?.data?.error);
const keyOf = (item) => JSON.stringify([item.question, item.label, item.answer]);
const cents = (value) => String(round(value, 2));
const money = (value) => `$${value.toFixed(2)}`;
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const questionOf = (ctx, qid) => list(ctx?.data?.questions).find((q) => q.qid === qid) || null;
const fixed = (value, digits = 2) => (num(value) === null ? "" : value.toFixed(digits));

// Calibrate's cost report and its sweep point at the slider, or null.
function calAt(ctx) {
  const cal = ctx?.data?.calibrate, cost = cal?.cost;
  if (!isObject(cost) || !Array.isArray(cost.sweep) || num(cost.review) === null || !(num(cost.labeled) > 0)) return null;
  const point = cost.sweep[Math.round((num(cal.threshold) ?? 0.5) * 100)];
  return isObject(point) && num(point.cost) !== null && num(point.automated) !== null ? { cost, point } : null;
}

// Reviews cost a fixed amount; the rest of a sweep point's cost is mistakes. Scaling every mistake price by k scales
// only the mistake part, so the cost at k × the prices is exact from the sweep.
const reviewPart = (cost, point) => cost.review * (cost.labeled - point.automated);

function cheapestAt(ctx, k) {
  const cost = ctx?.data?.calibrate?.cost;
  if (!isObject(cost) || !Array.isArray(cost.sweep) || num(cost.review) === null || !(num(cost.labeled) > 0)) return null;
  let best = null;
  for (const point of cost.sweep) {
    if (!isObject(point) || num(point.threshold) === null || num(point.cost) === null || num(point.automated) === null) continue;
    const review = reviewPart(cost, point);
    const total = review + k * (point.cost - review);
    if (!best || total < best.total - EPS || (Math.abs(total - best.total) <= EPS && point.threshold < best.point.threshold)) best = { total, point };
  }
  if (!best) return null;
  const per1000 = (best.total / cost.labeled) * 1000;
  return best.point.automated > 0
    ? { value: best.point.threshold, detail: `${money(per1000)} per 1,000 rows, automating ${best.point.automated} of ${cost.labeled}` }
    : { value: "review every row", detail: `${money(per1000)} per 1,000 rows` };
}

// The classes of a run's question, or null when the run lacks the question.
const classesOf = (ctx, qid) => {
  const q = questionOf(ctx, qid);
  return q ? list(q.classes) : null;
};

function addNew(items, extra) {
  const seen = new Set(items.map(keyOf));
  const out = items.slice();
  for (const entry of extra) {
    if (seen.has(keyOf(entry))) continue;
    seen.add(keyOf(entry));
    out.push(entry);
  }
  if (out.length > MAX_MISTAKES) throw new Error(`That would price ${out.length} mistakes; the page takes at most ${MAX_MISTAKES}.`);
  return out;
}

function needPrice(ctx, what) {
  const value = defaultPrice(ctx);
  if (value === null || value < 0 || value > MAX_PRICE) throw new Error(`Set a valid default mistake price first: ${what} uses it.`);
  return value;
}

function policyCost(ctx) {
  const cost = ctx?.data?.policy?.cost;
  const current = cost?.current;
  return isObject(cost) && isObject(current) && num(current.cost) !== null && num(cost.labeled) > 0 ? cost : null;
}

export default definePack({
  id: "costs-more",
  surface: "workbench.costs",
  title: "Costs: break-even, what-ifs and price-list edits",
  about: "Per-mistake facts, cost metrics and price what-ifs from the cost reports Calibrate and Policy already computed on your own run, price-list edits with preview and Undo, and exports of your price configuration or aggregate costs. No answers, no rows, nothing saved.",
  features: [
    // ---------- facts ----------
    { id: "break_even", kind: "fact", type: "number", label: "break-even accuracy for this mistake",
      help: "1 − review price ÷ this price (at least 0): the accuracy above which automating a row that risks only this mistake pays.",
      value: (item, ctx) => {
        const p = price(item), review = reviewPrice(ctx);
        return p === null || review === null || p <= 0 ? null : Math.max(0, 1 - review / p);
      } },
    { id: "score_distance", kind: "fact", type: "number", label: "levels between label and answer",
      help: "For a Score question, how many levels apart the label and the answer are; unavailable for other types.",
      value: (item, ctx) => {
        if (questionOf(ctx, item.question)?.type !== "score") return null;
        const label = toNumber(item.label), answer = toNumber(item.answer);
        return label === null || answer === null ? null : Math.abs(label - answer);
      } },
    { id: "label", kind: "fact", type: "category", label: "labeled class", value: (item) => (item.label ? String(item.label) : null) },
    { id: "answer", kind: "fact", type: "category", label: "answered class", value: (item) => (item.answer ? String(item.answer) : null) },
    { id: "direction", kind: "fact", type: "category", label: "direction of the mistake",
      help: "Noul: a false yes or a false no. Score: answered higher or lower than the label. Unavailable for Choice.",
      value: (item, ctx) => {
        const type = questionOf(ctx, item.question)?.type;
        if (type === "noul") return item.label === "no" && item.answer === "yes" ? "false yes" : item.label === "yes" && item.answer === "no" ? "false no" : null;
        if (type !== "score") return null;
        const label = toNumber(item.label), answer = toNumber(item.answer);
        return label === null || answer === null || label === answer ? null : answer > label ? "answered higher" : "answered lower";
      } },
    { id: "reverse_priced", kind: "fact", type: "flag", label: "its reverse priced too",
      help: "The same question with label and answer swapped is also in the list.",
      value: (item, ctx) => ctx.items().some((other) => other.question === item.question && other.label === item.answer && other.answer === item.label) },
    { id: "stale", kind: "fact", type: "flag", label: "a question or option this run lacks",
      help: "The question is not a Choice, Noul or Score question of the current run, or its label or answer is not one of its options.",
      value: (item, ctx) => {
        const classes = classesOf(ctx, item.question);
        return !classes || !classes.includes(item.label) || !classes.includes(item.answer);
      } },
    { id: "on_calibrate", kind: "fact", type: "flag", label: "Calibrate's question", help: "The mistake names the question Calibrate shows, so it moves Calibrate's cost.",
      value: (item, ctx) => !!item.question && item.question === ctx?.data?.calibrate?.qid },
    { id: "on_policy", kind: "fact", type: "flag", label: "a checked Policy gate", help: "The mistake names a question Policy gates now, so it moves Policy's cost.",
      value: (item, ctx) => isObject(ctx?.data?.policy?.active) && Object.prototype.hasOwnProperty.call(ctx.data.policy.active, item.question) },
    { id: "equals_default", kind: "fact", type: "flag", label: "the default mistake price", help: "Priced exactly at the default, so the entry changes no cost.",
      value: (item, ctx) => price(item) !== null && defaultPrice(ctx) !== null && Math.abs(price(item) - defaultPrice(ctx)) < EPS },

    // ---------- Calibrate cost metrics and what-ifs ----------
    { id: "cal_savings_share", kind: "metric", format: "percent", label: "Calibrate: savings against reviewing every row",
      help: "At the slider, as a share of the review-all cost. Negative: the slider costs more than reviewing every row.",
      compute: (ctx) => {
        const at = calAt(ctx), all = num(at?.cost.review_all?.cost);
        if (!at || !(all > 0)) return null;
        return { value: (all - at.point.cost) / all, detail: `${money(at.point.cost)} against ${money(all)} on ${at.cost.labeled} labeled rows` };
      } },
    { id: "cal_review_spend", kind: "metric", format: "usd", label: "Calibrate: review spending per 1,000 rows at the slider",
      compute: (ctx) => {
        const at = calAt(ctx);
        if (!at) return null;
        const reviews = at.cost.labeled - at.point.automated;
        return { value: (at.cost.review * reviews / at.cost.labeled) * 1000, detail: `${reviews} of ${at.cost.labeled} rows reviewed` };
      } },
    { id: "cal_mistake_spend", kind: "metric", format: "usd", label: "Calibrate: mistake spending per 1,000 rows at the slider",
      compute: (ctx) => {
        const at = calAt(ctx);
        if (!at) return null;
        const spend = at.point.cost - reviewPart(at.cost, at.point);
        return { value: (spend / at.cost.labeled) * 1000, detail: `${num(at.point.wrong) ?? "?"} automated mistakes cost ${money(spend)}` };
      } },
    { id: "cal_regret", kind: "metric", format: "usd", label: "Calibrate: cost per 1,000 above the lowest-cost threshold",
      help: "The slider's cost per 1,000 rows minus the lowest cost the page found (reviewing every row when nothing is worth automating).",
      compute: (ctx) => {
        const at = calAt(ctx);
        const best = num(at?.cost.best?.per_1000) ?? num(at?.cost.review_all?.per_1000);
        if (!at || best === null || num(at.point.per_1000) === null) return null;
        return Math.max(0, at.point.per_1000 - best);
      } },
    { id: "cal_break_even_price", kind: "metric", format: "usd", label: "Calibrate: mistake price at which the slider ties reviewing every row",
      help: "Review price × automated rows ÷ automated mistakes, treating every mistake at one price: below it the slider is cheaper than reviewing every row.",
      compute: (ctx) => {
        const at = calAt(ctx), wrong = num(at?.point.wrong);
        if (!at || wrong === null || !at.point.automated) return null;
        if (!wrong) return { value: null, detail: "No automated row is wrong at this threshold: it beats reviewing every row at any mistake price." };
        return { value: (at.cost.review * at.point.automated) / wrong, detail: `${at.point.automated} automated rows, ${wrong} wrong` };
      } },
    { id: "cal_best_at_half", kind: "metric", format: "number", label: "Calibrate: lowest-cost threshold at half the mistake prices",
      help: "Every mistake price halved, reviews unchanged, on the cost sweep's 0.01 steps (ties go to the lower threshold). Advisory until you move the slider.",
      compute: (ctx) => cheapestAt(ctx, 0.5) },
    { id: "cal_best_at_double", kind: "metric", format: "number", label: "Calibrate: lowest-cost threshold at twice the mistake prices",
      help: "Every mistake price doubled, reviews unchanged, on the cost sweep's 0.01 steps (ties go to the lower threshold). Advisory until you move the slider.",
      compute: (ctx) => cheapestAt(ctx, 2) },

    // ---------- Policy cost metrics ----------
    { id: "pol_savings_share", kind: "metric", format: "percent", label: "Policy: savings against reviewing every row",
      help: "At the current gates, as a share of the review-all cost. Negative: the gates cost more than reviewing every row.",
      compute: (ctx) => {
        const cost = policyCost(ctx), all = num(cost?.review_all?.cost);
        if (!cost || !(all > 0)) return null;
        return { value: (all - cost.current.cost) / all, detail: `${money(cost.current.cost)} against ${money(all)}` };
      } },
    { id: "pol_regret", kind: "metric", format: "usd", label: "Policy: cost per 1,000 above the lowest-cost thresholds",
      help: "The current gates' cost per 1,000 rows minus the lowest the page found (reviewing every row when nothing is worth automating).",
      compute: (ctx) => {
        const cost = policyCost(ctx), cheapest = ctx?.data?.policy?.cheapest;
        const best = num(cheapest?.best?.per_1000) ?? num(cheapest?.review_all?.per_1000);
        if (!cost || best === null || num(cost.current.per_1000) === null) return null;
        return Math.max(0, cost.current.per_1000 - best);
      } },
    { id: "pol_mistake_spend", kind: "metric", format: "usd", label: "Policy: mistake spending per 1,000 rows at the current gates",
      compute: (ctx) => {
        const cost = policyCost(ctx);
        if (!cost || num(cost.review) === null || num(cost.current.review) === null) return null;
        const spend = cost.current.cost - cost.review * cost.current.review;
        return { value: (spend / cost.labeled) * 1000, detail: `${num(cost.current.wrong) ?? "?"} automated mistakes cost ${money(spend)}` };
      } },

    // ---------- price-list metrics ----------
    { id: "mean_price", kind: "metric", format: "usd", label: "average price of the shown mistakes",
      compute: (ctx) => {
        const prices = ctx.shown().map(price).filter((value) => value !== null);
        return prices.length ? { value: prices.reduce((a, b) => a + b, 0) / prices.length, detail: `${prices.length} prices` } : null;
      } },
    { id: "unpriced_pairs", kind: "metric", format: "integer", label: "mistakes left at the default price",
      help: "Every label ≠ answer pair of the run's Choice, Noul and Score questions, minus the pairs you priced.",
      compute: (ctx) => {
        const questions = list(ctx?.data?.questions);
        if (!questions.length) return null;
        const pairs = questions.reduce((total, q) => total + list(q.classes).length * (list(q.classes).length - 1), 0);
        const priced = new Set(ctx.items().filter((item) => {
          const classes = classesOf(ctx, item.question);
          return classes && item.label !== item.answer && classes.includes(item.label) && classes.includes(item.answer);
        }).map(keyOf)).size;
        return { value: pairs - priced, detail: `${priced} of ${pairs} possible mistakes priced` };
      } },

    // ---------- price-list edits ----------
    { id: "fill_question", kind: "transform", label: "Price every unpriced mistake of a question at the default price",
      help: "Adds each label ≠ answer pair of that question that is not priced yet, at the default mistake price, so you can edit them one by one.",
      params: [{ name: "question", label: "Question id", type: "text", required: true }],
      all: (items, { question }, ctx) => {
        const q = questionOf(ctx, question.trim());
        if (!q) throw new Error(`“${question.trim()}” is not a Choice, Noul or Score question of this run.`);
        const cost = cents(needPrice(ctx, "filling a question"));
        const added = [];
        for (const label of list(q.classes)) for (const answer of list(q.classes)) if (label !== answer) added.push({ question: q.qid, label, answer, cost });
        return addNew(items, added);
      } },
    { id: "add_reverse", kind: "transform", label: "Add the reverse of each shown mistake at the same price",
      help: "For each shown mistake, the one with label and answer swapped, unless it is already priced.",
      all: (items, _params, _ctx, shown) => addNew(items, items.filter((_, i) => shown.has(i))
        .map((item) => ({ question: item.question, label: item.answer, answer: item.label, cost: item.cost }))) },
    { id: "drop_default_priced", kind: "transform", label: "Remove shown mistakes priced at the default price",
      help: "They change no cost: an unpriced mistake costs the default price already.",
      all: (items, _params, ctx, shown) => {
        const base = defaultPrice(ctx);
        return base === null ? items : items.filter((item, i) => !(shown.has(i) && price(item) !== null && Math.abs(price(item) - base) < EPS));
      } },
    { id: "score_by_distance", kind: "transform", label: "Price shown Score mistakes by distance",
      help: "Each shown Score mistake costs the base price × the number of levels between label and answer.",
      params: [{ name: "base", label: "Price per level", type: "number", min: 0, max: MAX_PRICE, default: 10 }],
      each: (item, { base }, ctx) => {
        if (questionOf(ctx, item.question)?.type !== "score") return null;
        const label = toNumber(item.label), answer = toNumber(item.answer);
        if (label === null || answer === null) return null;
        const value = base * Math.abs(label - answer);
        if (value > MAX_PRICE) throw new Error(`${item.question} ${item.label} → ${item.answer} would cost more than $1,000,000.`);
        return { ...item, cost: cents(value) };
      } },
    { id: "round_cents", kind: "transform", label: "Round shown prices to cents", help: "Prices that are not numbers stay as they are.",
      each: (item) => {
        const p = price(item);
        return p === null || round(p, 2) === p ? null : { ...item, cost: cents(p) };
      } },
    { id: "sort_by_question", kind: "transform", label: "Order by question, then label, then answer",
      help: "Questions and options in the run's order; mistakes on a question or option the run lacks go last.",
      all: (items, _params, ctx) => {
        const questions = list(ctx?.data?.questions);
        const rank = (item) => {
          const at = questions.findIndex((q) => q.qid === item.question);
          if (at < 0) return [Infinity, Infinity, Infinity];
          const classes = list(questions[at].classes);
          const where = (value) => (classes.indexOf(value) < 0 ? Infinity : classes.indexOf(value));
          return [at, where(item.label), where(item.answer)];
        };
        return items.map((item, i) => ({ item, i, r: rank(item) }))
          .sort((a, b) => (a.r[0] - b.r[0]) || (a.r[1] - b.r[1]) || (a.r[2] - b.r[2]) || a.i - b.i)
          .map((entry) => entry.item);
      } },
    { id: "drop_stale", kind: "transform", label: "Remove mistakes on a question or option this run lacks",
      help: "They never change a cost, and Lab edits refuse a list that names one, so this clears them after a run with different questions.",
      all: (items, _params, ctx) => items.filter((item) => {
        const classes = classesOf(ctx, item.question);
        return classes && classes.includes(item.label) && classes.includes(item.answer);
      }) },
    { id: "set_shown_price", kind: "transform", label: "Set every shown mistake to one price",
      params: [{ name: "price", label: "Price", type: "number", min: 0, max: MAX_PRICE }],
      each: (item, params) => ({ ...item, cost: cents(params.price) }) },
    { id: "noul_prices", kind: "transform", label: "Price a Noul question's false yes and false no",
      help: "Sets (or adds) labeled no answered yes and labeled yes answered no for that question.",
      params: [{ name: "question", label: "Noul question id", type: "text", required: true },
        { name: "false_yes", label: "Price of a false yes", type: "number", min: 0, max: MAX_PRICE },
        { name: "false_no", label: "Price of a false no", type: "number", min: 0, max: MAX_PRICE }],
      all: (items, params, ctx) => {
        const q = questionOf(ctx, params.question.trim());
        if (!q || q.type !== "noul") throw new Error(`“${params.question.trim()}” is not a Noul question of this run.`);
        const wanted = [{ question: q.qid, label: "no", answer: "yes", cost: cents(params.false_yes) },
          { question: q.qid, label: "yes", answer: "no", cost: cents(params.false_no) }];
        const next = items.map((item) => wanted.find((w) => keyOf(w) === keyOf(item)) || item);
        return addNew(next, wanted);
      } },
    { id: "raise_to_review", kind: "transform", label: "Raise shown prices below the review price to it",
      help: "A mistake cheaper than a review makes the cheapest gate automate rows that may make it.",
      each: (item, _params, ctx) => {
        const p = price(item), review = reviewPrice(ctx);
        return p === null || review === null || p >= review ? null : { ...item, cost: cents(review) };
      } },

    // ---------- exports ----------
    { id: "prices_json", kind: "exporter", label: "Price list as JSON", mime: "application/json", filename: "price-list.json",
      help: "Your price configuration only: the review price, the default mistake price and every priced mistake.",
      build: (ctx) => {
        const value = (text) => toNumber(text) ?? String(text);
        return `${JSON.stringify({ review: value(ctx.data.review), error: value(ctx.data.error),
          mistakes: ctx.items().map((item) => ({ question: item.question, label: item.label, answer: item.answer, cost: value(item.cost) })) }, null, 2)}\n`;
      } },
    { id: "mistakes_markdown", kind: "exporter", label: "Shown priced mistakes as a Markdown table", mime: "text/markdown", filename: "priced-mistakes.md",
      help: "Your price configuration only: question, label, answer, price and its break-even accuracy.",
      build: (ctx) => {
        const review = reviewPrice(ctx);
        return `${formatMarkdownTable(["question", "label", "answer", "price", "break-even accuracy"], ctx.shown().map((item) => {
          const p = price(item);
          return [item.question, item.label, item.answer, p === null ? item.cost : money(p),
            p === null || review === null || p <= 0 ? "" : percent(Math.max(0, 1 - review / p))];
        }))}\n`;
      } },
    { id: "cost_summary_csv", kind: "exporter", label: "Cost summary as CSV", mime: "text/csv", filename: "cost-summary.csv",
      help: "Aggregates only: Calibrate's and Policy's cost per 1,000 rows at the current thresholds, reviewing every row, automating every row and the lowest cost, with the thresholds.",
      build: (ctx) => {
        const out = [["panel", "measure", "value"]];
        const cal = ctx.data.calibrate, at = calAt(ctx);
        if (at) {
          out.push(["Calibrate", "question", cal.qid ?? ""], ["Calibrate", "threshold", fixed(cal.threshold)],
            ["Calibrate", "cost per 1,000 at the threshold", fixed(at.point.per_1000)],
            ["Calibrate", "cost per 1,000 reviewing every row", fixed(at.cost.review_all?.per_1000)],
            ["Calibrate", "cost per 1,000 automating every row", fixed(at.cost.automate_all?.per_1000)],
            ["Calibrate", "lowest cost per 1,000", fixed(at.cost.best?.per_1000)],
            ["Calibrate", "lowest-cost threshold", at.cost.best?.gates ? Object.values(at.cost.best.gates).map((t) => fixed(t)).join(" ") : "review every row"]);
        }
        const pol = policyCost(ctx), cheapest = ctx.data.policy?.cheapest;
        if (pol) {
          const gates = (map) => Object.entries(map || {}).map(([qid, t]) => `${qid} ${fixed(t)}`).join("; ");
          out.push(["Policy", "gates", gates(ctx.data.policy.active)], ["Policy", "cost per 1,000 at the gates", fixed(pol.current.per_1000)],
            ["Policy", "cost per 1,000 reviewing every row", fixed(pol.review_all?.per_1000)],
            ["Policy", "cost per 1,000 automating every row", fixed(pol.automate_all?.per_1000)]);
          if (isObject(cheapest)) {
            out.push(["Policy", "lowest cost per 1,000", fixed(cheapest.best?.per_1000 ?? cheapest.review_all?.per_1000)],
              ["Policy", "lowest-cost gates", cheapest.best?.gates ? gates(cheapest.best.gates) : "review every row"]);
          }
        }
        if (out.length === 1) throw new Error("There is no cost yet: run the rows in Bulk, label some, and enter valid prices.");
        return csvText(out);
      } },
    { id: "price_matrix_csv", kind: "exporter", label: "Every possible mistake with its price as CSV", mime: "text/csv", filename: "price-matrix.csv",
      help: "Your price configuration only: each label ≠ answer pair of the run's Choice, Noul and Score questions, with the price a cost uses (yours, or the default).",
      build: (ctx) => {
        const prices = ctx.data.prices;
        if (!prices) throw new Error(ctx.data.problem || "Enter valid prices first.");
        const priced = new Map(list(prices.mistakes).map((m) => [keyOf(m), m.cost]));
        const out = [["question", "label", "answer", "price", "source"]];
        for (const q of list(ctx.data.questions)) {
          for (const label of list(q.classes)) for (const answer of list(q.classes)) {
            if (label === answer) continue;
            const key = keyOf({ question: q.qid, label, answer });
            out.push([q.qid, label, answer, String(priced.has(key) ? priced.get(key) : prices.error), priced.has(key) ? "priced" : "default"]);
          }
        }
        if (out.length === 1) throw new Error("This run has no Choice, Noul or Score question to price.");
        return csvText(out);
      } },
    { id: "cal_sweep_csv", kind: "exporter", label: "Calibrate's cost sweep at 0.01 steps as CSV", mime: "text/csv", filename: "calibrate-cost-sweep.csv",
      help: "Aggregates only: for each threshold, automated rows, automated mistakes, total cost and cost per 1,000 rows on your labeled rows.",
      build: (ctx) => {
        const cost = ctx.data.calibrate?.cost;
        if (!isObject(cost) || !Array.isArray(cost.sweep) || !cost.sweep.length) throw new Error("Calibrate has no cost yet: label some rows and enter valid prices.");
        return csvText([["threshold", "automated", "wrong", "cost", "per 1,000 rows"],
          ...cost.sweep.map((p) => [fixed(p.threshold), p.automated, p.wrong, fixed(p.cost), fixed(p.per_1000)])]);
      } },
  ],
});
