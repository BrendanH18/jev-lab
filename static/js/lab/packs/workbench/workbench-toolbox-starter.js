// The Toolbox's first tools ("workbench.toolbox"): intervals, sample sizes, costs, rate limits, odds and boxes for
// people planning a typed-answer gate. Every tool computes from what is typed into its form with plain local
// arithmetic (no shared numerics library), never reads page data, and never calls the model.
import { definePack } from "../../kit.js";

const G = {
  intervals: "Proportions and intervals", sizes: "Sample sizes", costs: "Costs and budgets", time: "Time and rate limits",
  odds: "Probabilities and odds", boxes: "Boxes and pictures",
};

// Two-sided normal quantiles for the confidence levels offered, and one-sided ones for power.
const Z = { "0.9": 1.6448536269514722, "0.95": 1.959963984540054, "0.99": 2.5758293035489004 };
const Z_POWER = { "0.8": 0.8416212335729143, "0.9": 1.2815515655446004 };
const Z_ALPHA = { "0.05": Z["0.95"], "0.01": Z["0.99"], "0.1": Z["0.9"] };
const LEVEL = { name: "level", label: "Confidence", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]], default: "0.95" };
const PRICE = { name: "price", label: "Price per million input tokens (USD)", type: "number", min: 0, default: 0.042, help: "Jev 1.13 and 1.14: $0.042; output tokens are free." };
const TOKENS = { name: "tokens", label: "Input tokens per call", type: "number", min: 0, placeholder: "e.g. 500" };
const CALLS = { name: "calls", label: "Calls per row", type: "integer", min: 1, default: 1 };
const CAP = { name: "cap", label: "Live calls allowed per minute", type: "integer", min: 1, default: 120 };
const SHARE = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });
const COUNT = (name, label, extra = {}) => ({ name, label, type: "integer", min: 0, ...extra });

const pct = (level) => `${Math.round(Number(level) * 100)}%`;
const ceilSafe = (x) => Math.ceil(x - 1e-9);

function need(condition, message) {
  if (!condition) throw new Error(message);
}

// Wilson score interval for k of n.
function wilson(k, n, z) {
  const p = k / n, z2 = z * z, scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale;
  const half = (z / scale) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// P(X <= k) for X ~ Binomial(n, p), summed in log space so large n does not underflow.
function binomialCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n || p <= 0) return 1;
  if (p >= 1) return 0;
  const step = Math.log(p) - Math.log1p(-p);
  let log = n * Math.log1p(-p);
  const logs = [log];
  for (let i = 0; i < k; i++) {
    log += Math.log(n - i) - Math.log(i + 1) + step;
    logs.push(log);
  }
  const top = logs.reduce((max, value) => Math.max(max, value), -Infinity);
  return Math.min(1, Math.exp(top) * logs.reduce((sum, value) => sum + Math.exp(value - top), 0));
}

// The p in (0, 1) where a monotone f(p) crosses target; rising says whether f increases with p. 100 halvings leave an
// interval of 2^-100, far below double precision even for bounds near 1e-8, at half the cost of more.
function solve(f, target, rising) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if ((f(mid) < target) === rising) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function clopperPearson(k, n, level) {
  const tail = (1 - level) / 2;
  const lower = k === 0 ? 0 : solve((p) => 1 - binomialCdf(k - 1, n, p), tail, true);
  const upper = k === n ? 1 : solve((p) => binomialCdf(k, n, p), tail, false);
  return [lower, upper];
}

function counts(k, n) {
  need(n >= 1, "Trials must be at least 1.");
  need(k <= n, "Successes cannot be more than trials.");
}

// A duration in seconds as "1 h 30 min", "8 min 20 s", "45 s" or "250 ms".
function readable(seconds) {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  let rest = Math.round(seconds);
  const hours = Math.floor(rest / 3600); rest -= hours * 3600;
  const minutes = Math.floor(rest / 60); rest -= minutes * 60;
  return [hours ? `${hours} h` : "", minutes ? `${minutes} min` : "", rest ? `${rest} s` : ""].filter(Boolean).join(" ") || "0 s";
}

const short = (x) => String(Number(x.toPrecision(4)));

function box(prefix, params) {
  const [left, top, right, bottom] = ["left", "top", "right", "bottom"].map((edge) => params[`${prefix}${edge}`]);
  need(right > left && bottom > top, "Each box needs right above left and bottom above top.");
  return { left, top, right, bottom, area: (right - left) * (bottom - top) };
}
const EDGES = (prefix, name) => ["left", "top", "right", "bottom"].map((edge) => SHARE(`${prefix}${edge}`, `${name} ${edge} (0 to 1)`));

export default definePack({
  id: "workbench-toolbox-starter",
  surface: "workbench.toolbox",
  title: "Gate planning tools",
  about: "Twenty-five calculators for planning a gate: intervals, sample sizes, run costs and budgets, time under the rate limit, odds, and picture boxes and sizes. They compute from what you type only; costs are estimates, never measured spend.",
  features: [
    // ---------- Proportions and intervals ----------
    { id: "wilson_interval", kind: "tool", group: G.intervals, title: "Wilson interval for a proportion",
      help: "The Wilson score interval around k successes in n trials, such as correct answers among labeled rows. It stays inside 0 to 1 and behaves well with few rows.",
      inputs: [COUNT("k", "Successes (k)"), COUNT("n", "Trials (n)", { min: 1 }), LEVEL],
      compute: ({ k, n, level }) => {
        counts(k, n);
        const [lower, upper] = wilson(k, n, Z[level]);
        return { rows: [["Proportion", k / n], ["Lower bound", lower], ["Upper bound", upper], ["Interval width", upper - lower]], note: `${pct(level)} Wilson score interval.` };
      } },
    { id: "clopper_pearson", kind: "tool", group: G.intervals, title: "Exact (Clopper-Pearson) interval for a proportion",
      help: "The exact binomial interval around k successes in n trials. Wider than Wilson, but it never covers less than the level you choose. Up to 100,000 trials.",
      inputs: [COUNT("k", "Successes (k)"), COUNT("n", "Trials (n)", { min: 1, max: 100000 }), LEVEL],
      compute: ({ k, n, level }) => {
        counts(k, n);
        const [lower, upper] = clopperPearson(k, n, Number(level));
        return { rows: [["Proportion", k / n], ["Lower bound", lower], ["Upper bound", upper]], note: `${pct(level)} Clopper-Pearson interval.` };
      } },
    { id: "zero_errors_bound", kind: "tool", group: G.intervals, title: "Error-rate bound when no errors were seen",
      help: "After checking n rows and finding no mistakes, the highest error rate still consistent with that at the chosen confidence (one-sided). The rule of three, 3 ÷ n, is the 95% shortcut.",
      inputs: [COUNT("n", "Rows checked, all correct", { min: 1 }), LEVEL],
      compute: ({ n, level }) => {
        const bound = 1 - Math.pow(1 - Number(level), 1 / n);
        return [["Error rate is at most", bound], ["Accuracy is at least", 1 - bound], ["Shortcut: −ln(1 − confidence) ÷ n", -Math.log(1 - Number(level)) / n]];
      } },
    { id: "newcombe_difference", kind: "tool", group: G.intervals, title: "Difference of two proportions (Newcombe interval)",
      help: "Compares two accuracies or rates measured on different rows, such as two question wordings, with Newcombe's hybrid score interval for the difference.",
      inputs: [COUNT("k1", "First: successes"), COUNT("n1", "First: trials", { min: 1 }), COUNT("k2", "Second: successes"), COUNT("n2", "Second: trials", { min: 1 }), LEVEL],
      compute: ({ k1, n1, k2, n2, level }) => {
        counts(k1, n1); counts(k2, n2);
        const z = Z[level], p1 = k1 / n1, p2 = k2 / n2;
        const [l1, u1] = wilson(k1, n1, z), [l2, u2] = wilson(k2, n2, z);
        const diff = p1 - p2;
        return { rows: [["First proportion", p1], ["Second proportion", p2], ["Difference (first − second)", diff],
          ["Lower bound", diff - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)], ["Upper bound", diff + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)]],
        note: `${pct(level)} interval. When it includes 0 the rows do not show a difference.` };
      } },
    { id: "gate_coverage", kind: "tool", group: G.intervals, title: "Coverage and accuracy of a gate",
      help: "From the rows a gate saw, the rows it automated and how many of those were right: coverage and accuracy, each with a Wilson interval.",
      inputs: [COUNT("total", "Rows the gate saw", { min: 1 }), COUNT("automated", "Rows it automated"), COUNT("correct", "Automated rows that were right"), LEVEL],
      compute: ({ total, automated, correct, level }) => {
        need(automated <= total, "Automated rows cannot be more than the rows the gate saw.");
        need(automated >= 1, "Accuracy needs at least one automated row.");
        need(correct <= automated, "Right rows cannot be more than automated rows.");
        const z = Z[level];
        const [cl, cu] = wilson(automated, total, z), [al, au] = wilson(correct, automated, z);
        return { rows: [["Coverage", automated / total], ["Coverage lower bound", cl], ["Coverage upper bound", cu], ["Accuracy when automated", correct / automated],
          ["Accuracy lower bound", al], ["Accuracy upper bound", au], ["Rows sent to review", total - automated]], note: `${pct(level)} Wilson intervals.` };
      } },

    // ---------- Sample sizes ----------
    { id: "rows_for_margin", kind: "tool", group: G.sizes, title: "Rows to label for a margin of error",
      help: "How many labeled rows estimate an accuracy to within ± the margin. Use 0.5 for the expected proportion when you do not know it (the safe maximum). Give the population size to apply the finite population correction.",
      inputs: [SHARE("margin", "Margin of error (e.g. 0.05)"), SHARE("p", "Expected proportion", { default: 0.5 }), LEVEL,
        { name: "population", label: "Population size (optional)", type: "integer", min: 1, optional: true }],
      compute: ({ margin, p, level, population }) => {
        need(margin > 0, "The margin must be above 0.");
        const n0 = Z[level] ** 2 * p * (1 - p) / (margin * margin);
        const corrected = population === null ? null : ceilSafe(n0 / (1 + (n0 - 1) / population));
        return [["Rows needed", ceilSafe(n0)], ["With the population correction", corrected]];
      } },
    { id: "margin_for_rows", kind: "tool", group: G.sizes, title: "Margin of error for a number of rows",
      help: "The ± margin an accuracy measured on n labeled rows carries (normal approximation). Give the population size to apply the finite population correction.",
      inputs: [COUNT("n", "Labeled rows", { min: 1 }), SHARE("p", "Measured or expected proportion", { default: 0.5 }), LEVEL,
        { name: "population", label: "Population size (optional)", type: "integer", min: 1, optional: true }],
      compute: ({ n, p, level, population }) => {
        need(population === null || population >= n, "The population cannot be smaller than the rows.");
        const margin = Z[level] * Math.sqrt(p * (1 - p) / n);
        return [["Margin of error", margin], ["With the population correction", population === null ? null : population === 1 ? 0 : margin * Math.sqrt((population - n) / (population - 1))]];
      } },
    { id: "rows_with_no_errors", kind: "tool", group: G.sizes, title: "Rows to audit with no errors allowed",
      help: "How many rows must all be right to show the error rate is below a target at the chosen confidence (one-sided).",
      inputs: [SHARE("rate", "Highest acceptable error rate (e.g. 0.01)"), LEVEL],
      compute: ({ rate, level }) => {
        need(rate > 0 && rate < 1, "The error rate must be between 0 and 1.");
        const alpha = 1 - Number(level);
        return [["Rows that must all be right", ceilSafe(Math.log(alpha) / Math.log(1 - rate))], ["Shortcut: −ln(1 − confidence) ÷ rate", ceilSafe(-Math.log(alpha) / rate)]];
      } },
    { id: "rows_per_variant", kind: "tool", group: G.sizes, title: "Rows per variant to detect a difference",
      help: "Rows each of two variants (two wordings, two models) needs for a two-sided test to detect the difference between two accuracies with the chosen power.",
      inputs: [SHARE("p1", "First accuracy"), SHARE("p2", "Second accuracy"),
        { name: "alpha", label: "Significance level", type: "select", options: [["0.05", "0.05"], ["0.01", "0.01"], ["0.1", "0.10"]], default: "0.05" },
        { name: "power", label: "Power", type: "select", options: [["0.8", "80%"], ["0.9", "90%"]], default: "0.8" }],
      compute: ({ p1, p2, alpha, power }) => {
        need(p1 !== p2, "The two accuracies must differ.");
        const za = Z_ALPHA[alpha], zb = Z_POWER[power];
        const mean = (p1 + p2) / 2;
        const n = ceilSafe((za * Math.sqrt(2 * mean * (1 - mean)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2);
        return [["Rows per variant", n], ["Rows in total", 2 * n]];
      } },

    // ---------- Costs and budgets ----------
    { id: "run_cost", kind: "tool", group: G.costs, title: "Estimated cost of a run",
      help: "Input tokens times the price for a number of rows. An estimate from the tokens you type, not measured spend; output tokens are free.",
      inputs: [COUNT("rows", "Rows", { min: 1 }), TOKENS, CALLS, PRICE],
      compute: ({ rows, tokens, calls, price }) => {
        const total = rows * calls * tokens;
        const cost = total * price / 1e6;
        return { rows: [["Input tokens", total], ["Estimated cost (USD)", cost], ["Estimated cost per 1,000 rows (USD)", cost / rows * 1000]], note: "An estimate, not measured spend." };
      } },
    { id: "rows_for_budget", kind: "tool", group: G.costs, title: "Rows a budget allows",
      help: "How many rows fit in a budget at a number of input tokens per call. The server's default budget is $2.00 per run of the server.",
      inputs: [{ name: "budget", label: "Budget (USD)", type: "number", min: 0, default: 2 }, TOKENS, CALLS, PRICE],
      compute: ({ budget, tokens, calls, price }) => {
        const perRow = calls * tokens * price / 1e6;
        need(perRow > 0, "Tokens and price must be above 0.");
        return { rows: [["Estimated cost per row (USD)", perRow], ["Rows the budget allows", Math.floor(budget / perRow + 1e-9)]], note: "An estimate from the tokens you typed." };
      } },
    { id: "cost_with_review", kind: "tool", group: G.costs, title: "Expected cost per row with human review",
      help: "What each row costs on average when a share goes to people and the rest is automated: review cost, the cost of automated mistakes, and the model's cost per row.",
      inputs: [SHARE("review", "Share of rows sent to review"), { name: "reviewCost", label: "Cost of reviewing one row (USD)", type: "number", min: 0, default: 2 },
        SHARE("errorRate", "Error rate among automated rows"), { name: "errorCost", label: "Cost of one automated mistake (USD)", type: "number", min: 0, default: 20 },
        { name: "modelCost", label: "Model cost per row (USD)", type: "number", min: 0, default: 0 }],
      compute: ({ review, reviewCost, errorRate, errorCost, modelCost }) => {
        const reviewing = review * reviewCost, mistakes = (1 - review) * errorRate * errorCost;
        const total = reviewing + mistakes + modelCost;
        return [["Review cost per row", reviewing], ["Mistake cost per row", mistakes], ["Expected cost per row", total], ["Expected cost per 1,000 rows", total * 1000]];
      } },
    { id: "break_even_confidence", kind: "tool", group: G.costs, title: "Break-even confidence for automating",
      help: "Automating a row whose answer is right with probability p costs (1 − p) × the cost of a mistake; reviewing it costs the review price. Automating is cheaper above p = 1 − review ÷ mistake.",
      inputs: [{ name: "reviewCost", label: "Cost of reviewing one row (USD)", type: "number", min: 0, default: 2 },
        { name: "errorCost", label: "Cost of one automated mistake (USD)", type: "number", min: 0, default: 20 }],
      compute: ({ reviewCost, errorCost }) => {
        need(errorCost > 0, "The cost of a mistake must be above 0.");
        const threshold = Math.max(0, 1 - reviewCost / errorCost);
        return { rows: [["Automate when the probability of being right is at least", threshold], ["Mistakes accepted per 100 rows at that probability", 100 * (1 - threshold)]],
          note: threshold === 0 ? "Review costs as much as a mistake or more, so automating every row is cheapest." : "A calibrated probability is needed for this to hold." };
      } },
    { id: "monthly_projection", kind: "tool", group: G.costs, title: "Monthly cost projection",
      help: "Projects a month of traffic from rows per day and input tokens per call. A projection, not spend.",
      inputs: [COUNT("perDay", "Rows per day", { min: 1 }), TOKENS, CALLS, PRICE, { name: "days", label: "Days per month", type: "integer", min: 1, max: 31, default: 30 }],
      compute: ({ perDay, tokens, calls, price, days }) => {
        const rows = perDay * days, total = rows * calls * tokens;
        return { rows: [["Rows per month", rows], ["Input tokens per month", total], ["Projected cost per month (USD)", total * price / 1e6]], note: "A projection, not measured spend." };
      } },

    // ---------- Time and rate limits ----------
    { id: "time_for_rows", kind: "tool", group: G.time, title: "Time to run rows under a rate limit",
      help: "The shortest time a number of rows can take when live calls are capped per minute (the server allows 120 a minute by default).",
      inputs: [COUNT("rows", "Rows", { min: 1 }), CALLS, CAP],
      compute: ({ rows, calls, cap }) => {
        const minutes = rows * calls / cap;
        return [["Live calls", rows * calls], ["Minutes at the cap", minutes], ["Duration", readable(minutes * 60)]];
      } },
    { id: "rows_in_time", kind: "tool", group: G.time, title: "Rows that fit in a time window",
      help: "How many rows a rate limit lets through in a number of minutes.",
      inputs: [{ name: "minutes", label: "Minutes", type: "number", min: 0 }, CALLS, CAP],
      compute: ({ minutes, calls, cap }) => [["Live calls allowed", Math.floor(minutes * cap + 1e-9)], ["Rows", Math.floor(minutes * cap / calls + 1e-9)]] },
    { id: "parallel_duration", kind: "tool", group: G.time, title: "Duration with parallel calls",
      help: "How long rows take with several calls in flight: throughput is the smaller of parallel calls ÷ latency and the per-minute cap.",
      inputs: [COUNT("rows", "Rows", { min: 1 }), { name: "parallel", label: "Calls in flight at once", type: "integer", min: 1, default: 8 },
        { name: "latency", label: "Latency per call (ms)", type: "number", min: 1, default: 600 }, CAP],
      compute: ({ rows, parallel, latency, cap }) => {
        const byLatency = parallel / (latency / 1000), byCap = cap / 60;
        const rate = Math.min(byLatency, byCap);
        const seconds = rows / rate;
        return [["Limited by", byCap <= byLatency ? "the rate limit" : "latency and parallel calls"], ["Calls per second", rate], ["Duration (seconds)", seconds], ["Duration", readable(seconds)]];
      } },
    { id: "convert_duration", kind: "tool", group: G.time, title: "Convert a duration",
      help: "A duration in milliseconds, seconds, minutes and hours, and as a readable phrase.",
      inputs: [{ name: "value", label: "Duration", type: "number", min: 0 },
        { name: "unit", label: "Unit", type: "select", options: [["ms", "milliseconds"], ["s", "seconds"], ["min", "minutes"], ["h", "hours"]], default: "min" }],
      compute: ({ value, unit }) => {
        const seconds = value * { ms: 0.001, s: 1, min: 60, h: 3600 }[unit];
        return [["Milliseconds", seconds * 1000], ["Seconds", seconds], ["Minutes", seconds / 60], ["Hours", seconds / 3600], ["Readable", readable(seconds)]];
      } },

    // ---------- Probabilities and odds ----------
    { id: "probability_to_odds", kind: "tool", group: G.odds, title: "Probability to odds and log-odds",
      help: "A probability as odds (p ÷ (1 − p)), as a ratio, as log-odds and as \"one in N\".",
      inputs: [SHARE("p", "Probability (between 0 and 1)")],
      compute: ({ p }) => {
        need(p > 0 && p < 1, "The probability must be between 0 and 1, not equal to either.");
        const odds = p / (1 - p);
        return [["Odds", odds], ["Odds as a ratio", odds >= 1 ? `${short(odds)} : 1` : `1 : ${short(1 / odds)}`], ["Log-odds", Math.log(odds)], ["One in", 1 / p]];
      } },
    { id: "odds_to_probability", kind: "tool", group: G.odds, title: "Odds to probability",
      help: "Odds of A to B (for example 3 to 1) as a probability.",
      inputs: [{ name: "a", label: "Odds for (A)", type: "number", min: 0 }, { name: "b", label: "Odds against (B)", type: "number", min: 0 }],
      compute: ({ a, b }) => {
        need(a + b > 0, "At least one side of the odds must be above 0.");
        return [["Probability", a / (a + b)], ["Odds (A ÷ B)", b > 0 ? a / b : null]];
      } },
    { id: "logodds_to_probability", kind: "tool", group: G.odds, title: "Log-odds to probability",
      help: "The logistic function: a log-odds value (a logit) as a probability and as odds.",
      inputs: [{ name: "x", label: "Log-odds", type: "number", min: -700, max: 700 }],
      compute: ({ x }) => [["Probability", 1 / (1 + Math.exp(-x))], ["Odds", Math.exp(x)]] },
    { id: "at_least_one", kind: "tool", group: G.odds, title: "Chance of at least one of several independent events",
      help: "With k independent events of probability p each (k flagged rows, k checks), the chance that at least one, all, or none of them happen.",
      inputs: [SHARE("p", "Probability of each event"), COUNT("k", "Number of events", { min: 1 })],
      compute: ({ p, k }) => [["At least one", 1 - Math.pow(1 - p, k)], ["All of them", Math.pow(p, k)], ["None of them", Math.pow(1 - p, k)]] },

    // ---------- Boxes and pictures ----------
    { id: "box_iou", kind: "tool", group: G.boxes, title: "Overlap of two boxes (IoU)",
      help: "Intersection over union of two Box answers or a Box answer and a hand-drawn box, with edges as fractions of the picture's width and height.",
      inputs: [...EDGES("a_", "Box A"), ...EDGES("b_", "Box B")],
      compute: (params) => {
        const a = box("a_", params), b = box("b_", params);
        const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const inter = width * height, union = a.area + b.area - inter;
        return [["Intersection area", inter], ["Union area", union], ["IoU", inter / union]];
      } },
    { id: "resize_picture", kind: "tool", group: G.boxes, title: "Resize a picture to the side limits",
      help: "The size to scale a picture to so every side is within the limits Jev accepts (280 to 1568 pixels), keeping its shape. Pictures more than 5.6 times wider than tall (or the reverse) must be cropped first.",
      inputs: [COUNT("width", "Width (px)", { min: 1 }), COUNT("height", "Height (px)", { min: 1 }),
        COUNT("minSide", "Shortest side allowed (px)", { min: 1, default: 280 }), COUNT("maxSide", "Longest side allowed (px)", { min: 1, default: 1568 })],
      compute: ({ width, height, minSide, maxSide }) => {
        need(minSide <= maxSide, "The shortest side allowed cannot be above the longest.");
        const long = Math.max(width, height), shortSide = Math.min(width, height);
        let scale = 1, newLong = long, newShort = shortSide;
        if (long > maxSide) { scale = maxSide / long; newLong = maxSide; newShort = Math.round(shortSide * scale); }
        else if (shortSide < minSide) { scale = minSide / shortSide; newShort = minSide; newLong = Math.round(long * scale); }
        const fits = newShort >= minSide && newLong <= maxSide;
        const wide = width >= height;
        return { rows: [["New width", wide ? newLong : newShort], ["New height", wide ? newShort : newLong], ["Scale", scale], ["Fits the limits", fits ? "yes" : "no"]],
          note: fits ? null : `No scale fits: crop to at most ${short(maxSide / minSide)} : 1 first.` };
      } },
    { id: "box_to_pixels", kind: "tool", group: G.boxes, title: "Box edges to pixels",
      help: "A Box answer's edges (fractions of width and height) as pixel coordinates on a picture of a given size, for cropping.",
      inputs: [...EDGES("", "Box"), COUNT("width", "Picture width (px)", { min: 1 }), COUNT("height", "Picture height (px)", { min: 1 })],
      compute: (params) => {
        const b = box("", params), { width, height } = params;
        const left = Math.round(b.left * width), top = Math.round(b.top * height), right = Math.round(b.right * width), bottom = Math.round(b.bottom * height);
        return [["Left (px)", left], ["Top (px)", top], ["Right (px)", right], ["Bottom (px)", bottom], ["Width (px)", right - left], ["Height (px)", bottom - top], ["Share of the picture", b.area]];
      } },
  ],
});
