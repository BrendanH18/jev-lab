// Toolbox: more intervals and bounds for accuracies, rates, means, quantiles and class shares. Every tool is pure: it
// reads only the counts, summaries or pasted lists typed into its form, never page data, and it never calls the model.
import { definePack, toNumber } from "../../kit.js";
import { betaQuantile, binomialCdf, binomialPmf, binomialSf, chiSquareQuantile, hypergeometricPmf, incompleteBeta, logGamma, mean,
  normalQuantile, quantile, stdev, studentTQuantile } from "../../lib/math.js";

const GROUP = "Proportions and intervals";
const MAX_TRIALS = 1e6;
const MAX_EXACT = 1e5;   // counts summed term by term (posterior comparisons, predictive and batch bounds)

// ---------- inputs ----------

const count = (name, label, placeholder, extra = {}) => ({ name, label, type: "integer", min: 0, max: MAX_TRIALS, placeholder, ...extra });
const share = (name, label, placeholder, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, placeholder, ...extra });
const real = (name, label, placeholder, extra = {}) => ({ name, label, type: "number", placeholder, ...extra });
const LEVEL = { name: "level", label: "Confidence level", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]] };
const ONE_SIDED = { ...LEVEL, label: "Confidence level (one-sided)" };
const SUCCESSES = count("k", "Successes (k)", "e.g. 45");
const TRIALS = count("n", "Trials (n)", "e.g. 50", { min: 1 });
const PRIOR = [real("a", "Prior successes + 1 (Beta a)", "1 = uniform", { min: 0.0001, default: 1 }),
  real("b", "Prior failures + 1 (Beta b)", "1 = uniform", { min: 0.0001, default: 1 })];
const INTEGER_PRIOR = [count("a", "Prior successes + 1 (Beta a)", "1 = uniform", { min: 1, max: MAX_EXACT, default: 1 }),
  count("b", "Prior failures + 1 (Beta b)", "1 = uniform", { min: 1, max: MAX_EXACT, default: 1 })];
const ERROR_PRIOR = [real("a", "Prior errors + 1 (Beta a)", "1 = uniform", { min: 0.0001, default: 1 }),
  real("b", "Prior correct rows + 1 (Beta b)", "1 = uniform", { min: 0.0001, default: 1 })];
const LIST_FORMAT = "Separate the numbers with commas, spaces, tabs, semicolons or new lines.";

// ---------- helpers ----------

const fail = (message) => { throw new Error(message); };
const percent = (level) => `${Math.round(Number(level) * 100)}%`;
const zTwo = (level) => normalQuantile(1 - (1 - Number(level)) / 2);
const zOne = (level) => normalQuantile(Number(level));
const clip = (x) => Math.min(1, Math.max(0, x));
const yesNo = (flag) => (flag ? "yes" : "no");
const short = (text) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);

function counts(k, n) {
  if (k > n) fail("Successes cannot be more than trials.");
}

// Numbers pasted as a list: any mix of commas, spaces, tabs, semicolons and new lines between them.
function numberList(text, label, minimum) {
  const values = String(text ?? "").replace(/−/g, "-").split(/[\s,;]+/).filter(Boolean).map((token) => {
    const value = toNumber(token);
    if (value === null) fail(`${label}: "${short(token)}" is not a number.`);
    return value;
  });
  if (values.length < minimum) fail(`${label}: paste at least ${minimum} numbers.`);
  return values;
}

// The x in [lo, hi] where a monotone f crosses target (increasing says which way f runs), by bisection.
function bisect(f, target, increasing, lo = 0, hi = 1) {
  for (let i = 0; i < 200 && hi - lo > 0; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if ((f(mid) < target) === increasing) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- intervals for one proportion: each returns [lower, upper] or [null, null] where undefined ----------

function wald(k, n, z) {
  const p = k / n, half = z * Math.sqrt(p * (1 - p) / n);
  return [p - half, p + half];
}

function wilson(k, n, z) {
  const p = k / n, z2 = z * z, scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale;
  const half = (z / scale) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Newcombe (1998), method 4: the Wilson interval with a continuity correction.
function wilsonCorrected(k, n, z) {
  const p = k / n, z2 = z * z, d = 2 * (n + z2);
  const lower = k === 0 ? 0 : Math.max(0, (2 * n * p + z2 - 1 - z * Math.sqrt(Math.max(0, z2 - 2 - 1 / n + 4 * p * (n * (1 - p) + 1)))) / d);
  const upper = k === n ? 1 : Math.min(1, (2 * n * p + z2 + 1 + z * Math.sqrt(Math.max(0, z2 + 2 - 1 / n + 4 * p * (n * (1 - p) - 1)))) / d);
  return [lower, upper];
}

function agrestiCoull(k, n, z) {
  const size = n + z * z, centre = (k + z * z / 2) / size, half = z * Math.sqrt(centre * (1 - centre) / size);
  return [clip(centre - half), clip(centre + half)];
}

function jeffreys(k, n, level) {
  const tail = (1 - Number(level)) / 2;
  return [k === 0 ? 0 : betaQuantile(tail, k + 0.5, n - k + 0.5), k === n ? 1 : betaQuantile(1 - tail, k + 0.5, n - k + 0.5)];
}

function clopperPearson(k, n, level) {
  const tail = (1 - Number(level)) / 2;
  return [k === 0 ? 0 : betaQuantile(tail, k, n - k + 1), k === n ? 1 : betaQuantile(1 - tail, k + 1, n - k)];
}

// The mid-p exact interval: each end counts half the probability of the observed count.
function midP(k, n, level) {
  const tail = (1 - Number(level)) / 2;
  const lower = k === 0 ? 0 : bisect((p) => binomialSf(k + 1, n, p) + 0.5 * binomialPmf(k, n, p), tail, true);
  const upper = k === n ? 1 : bisect((p) => binomialCdf(k - 1, n, p) + 0.5 * binomialPmf(k, n, p), tail, false);
  return [lower, upper];
}

function logitInterval(k, n, z) {
  if (k === 0 || k === n) return [null, null];
  const p = k / n, centre = Math.log(p / (1 - p)), half = z / Math.sqrt(n * p * (1 - p));
  return [1 / (1 + Math.exp(-(centre - half))), 1 / (1 + Math.exp(-(centre + half)))];
}

function arcsine(k, n, z) {
  const angle = Math.asin(Math.sqrt(k / n)), half = z / (2 * Math.sqrt(n));
  return [Math.sin(Math.max(0, angle - half)) ** 2, Math.sin(Math.min(Math.PI / 2, angle + half)) ** 2];
}

const METHODS = [
  ["wald", "Wald", (k, n, level) => wald(k, n, zTwo(level))],
  ["wilson", "Wilson", (k, n, level) => wilson(k, n, zTwo(level))],
  ["wilson_cc", "Wilson with continuity correction", (k, n, level) => wilsonCorrected(k, n, zTwo(level))],
  ["agresti_coull", "Agresti–Coull", (k, n, level) => agrestiCoull(k, n, zTwo(level))],
  ["jeffreys", "Jeffreys", jeffreys],
  ["clopper_pearson", "Clopper–Pearson (exact)", clopperPearson],
  ["mid_p", "Mid-p exact", midP],
  ["logit", "Logit", (k, n, level) => logitInterval(k, n, zTwo(level))],
  ["arcsine", "Arcsine", (k, n, level) => arcsine(k, n, zTwo(level))],
];
const COVERAGE_METHODS = METHODS.slice(0, 7);

// ---------- other helpers ----------

const logBeta = (a, b) => logGamma(a) + logGamma(b) - logGamma(a + b);

// Lines of "label, count" (or "label: count"), or bare counts, as [[label, count], ...].
function classCounts(text) {
  const raw = String(text ?? "").trim();
  if (/^[\d\s,;]+$/.test(raw)) {
    return raw.split(/[\s,;]+/).filter(Boolean).map((token, index) => [`Class ${index + 1}`, Number(token)]);
  }
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const match = line.match(/^(.*?)[\s:,;=]+(\d+)$/);
    if (!match || !match[1].trim()) fail(`Line ${index + 1} ("${short(line)}") needs a class name and a count, such as "refund: 12".`);
    return [match[1].trim(), Number(match[2])];
  });
}

// Lines of "name, batch size, audited, correct" (the name may be left out), as stratum objects.
function strata(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) fail("Paste at least two strata, one per line.");
  return lines.map((line, index) => {
    const cells = line.split(/[,;\t]/).map((cell) => cell.trim());
    if (cells.length === 3) cells.unshift(`Stratum ${index + 1}`);
    if (cells.length !== 4) fail(`Line ${index + 1} needs a name, the stratum's size, the rows audited and the rows found correct.`);
    const [size, audited, correct] = cells.slice(1).map((cell) => toNumber(cell));
    for (const value of [size, audited, correct]) {
      if (value === null || !Number.isInteger(value) || value < 0) fail(`Line ${index + 1}: sizes and counts must be whole numbers 0 or more.`);
    }
    if (audited < 2) fail(`Line ${index + 1}: audit at least 2 rows in every stratum.`);
    if (audited > size) fail(`Line ${index + 1}: more rows audited than the stratum holds.`);
    if (correct > audited) fail(`Line ${index + 1}: more rows correct than audited.`);
    return { name: cells[0] || `Stratum ${index + 1}`, size, audited, correct };
  });
}

// P(X <= k) (below) or P(X >= k) (above) for X hypergeometric: k errors among n audited rows from a batch of size
// holding errors. The sum starts at k and walks away from it; once the terms fall (past the mode) below 1e-17 of the
// total, the rest cannot change the sum, so it stops there instead of visiting every count.
function hyperTail(k, size, errors, audited, below) {
  const end = below ? 0 : Math.min(audited, errors), step = below ? -1 : 1;
  let total = 0, previous = Infinity;
  for (let j = k; below ? j >= end : j <= end; j += step) {
    const term = hypergeometricPmf(j, size, errors, audited);
    total += term;
    if (total > 0 && term < previous && term <= total * 1e-17) break;
    previous = term;
  }
  return Math.min(1, total);
}

// The largest m in [lo, hi] with ok(m) true, given ok is true up to some point and false after it (lo must be ok).
function lastTrue(ok, lo, hi) {
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// ---------- tools ----------

const tool = (id, title, help, inputs, compute) => ({ id, kind: "tool", group: GROUP, title, help, inputs, compute });

export default definePack({
  id: "tb-intervals",
  surface: "workbench.toolbox",
  title: "More intervals and bounds",
  about: "Twenty-four interval and bound calculators: Wald (with its failings), Wilson with correction, Agresti–Coull, Jeffreys, mid-p, a side-by-side comparison and exact coverage, Bayesian posteriors, one-sided bounds, ratios, Poisson rates, means, spreads, quantiles, finite batches, strata and class shares. They compute only from what you type.",
  features: [
    tool("wald_interval", "Wald interval and its failings", "The textbook interval p ± z·√(p(1 − p)/n). It is shown so you can see why not to rely on it: it collapses to a single point at 0 or n successes, can run below 0 or above 1, and covers the true rate far less often than the level says when n is small or p is near 0 or 1 (Brown, Cai and DasGupta, 2001). The Wilson interval is shown beside it.",
      [SUCCESSES, TRIALS, LEVEL], ({ k, n, level }) => {
        counts(k, n);
        const z = zTwo(level), [lower, upper] = wald(k, n, z), [wl, wu] = wilson(k, n, z);
        return { rows: [["Proportion", k / n], ["Lower bound (not clipped)", lower], ["Upper bound (not clipped)", upper],
          ["Runs outside 0 to 1", yesNo(lower < 0 || upper > 1)], ["Collapses to a single point", yesNo(k === 0 || k === n)],
          ["Wilson lower bound, for comparison", wl], ["Wilson upper bound, for comparison", wu]],
        note: `${percent(level)} Wald interval. Prefer Wilson, Agresti–Coull or Jeffreys.` };
      }),
    tool("wilson_corrected", "Wilson interval with continuity correction", "Newcombe's (1998) continuity-corrected Wilson score interval: a little wider than plain Wilson, so it more rarely covers less than the level you choose. 0 successes give a lower bound of 0 and n successes an upper bound of 1.",
      [SUCCESSES, TRIALS, LEVEL], ({ k, n, level }) => {
        counts(k, n);
        const [lower, upper] = wilsonCorrected(k, n, zTwo(level));
        return [["Proportion", k / n], ["Lower bound", lower], ["Upper bound", upper], ["Interval width", upper - lower]];
      }),
    tool("agresti_coull", "Agresti–Coull interval", "Adds z²/2 successes and z²/2 failures (about two of each at 95%) and uses the Wald formula on the adjusted counts. Simple and close to Wilson; bounds are clipped to 0 to 1.",
      [SUCCESSES, TRIALS, LEVEL], ({ k, n, level }) => {
        counts(k, n);
        const z = zTwo(level), [lower, upper] = agrestiCoull(k, n, z);
        return [["Proportion", k / n], ["Adjusted trials (n + z²)", n + z * z], ["Adjusted proportion", (k + z * z / 2) / (n + z * z)], ["Lower bound", lower], ["Upper bound", upper]];
      }),
    tool("jeffreys_interval", "Jeffreys interval", "The equal-tailed interval of the Beta(k + ½, n − k + ½) posterior from the Jeffreys prior. It has good average coverage; with 0 successes the lower bound is 0 and with n successes the upper bound is 1 (Brown, Cai and DasGupta's adjustment).",
      [SUCCESSES, TRIALS, LEVEL], ({ k, n, level }) => {
        counts(k, n);
        const [lower, upper] = jeffreys(k, n, level);
        return [["Proportion", k / n], ["Lower bound", lower], ["Upper bound", upper]];
      }),
    tool("mid_p_interval", "Mid-p exact interval", "An exact binomial interval that counts only half the probability of the observed count in each tail. Narrower than Clopper–Pearson, with coverage close to the level on average rather than always above it. Up to 100,000 trials.",
      [SUCCESSES, count("n", "Trials (n)", "e.g. 50", { min: 1, max: MAX_EXACT }), LEVEL], ({ k, n, level }) => {
        counts(k, n);
        const [lower, upper] = midP(k, n, level);
        return [["Proportion", k / n], ["Lower bound", lower], ["Upper bound", upper]];
      }),
    tool("interval_methods", "Compare interval methods for a proportion", "The interval for k successes in n trials by nine methods side by side: Wald (not clipped), Wilson, Wilson with continuity correction, Agresti–Coull, Jeffreys, Clopper–Pearson, mid-p, logit and arcsine. The logit interval is undefined at 0 or n successes. Up to 100,000 trials.",
      [SUCCESSES, count("n", "Trials (n)", "e.g. 50", { min: 1, max: MAX_EXACT }), LEVEL], ({ k, n, level }) => {
        counts(k, n);
        const rows = METHODS.map(([, name, method]) => {
          const [lower, upper] = method(k, n, level);
          return [name, lower, upper, lower === null || upper === null ? null : upper - lower];
        });
        return { table: { columns: ["Method", "Lower bound", "Upper bound", "Width"], rows }, note: `${percent(level)} intervals for ${k} of ${n}.` };
      }),
    tool("interval_coverage", "Actual coverage of an interval method", "The exact chance that a method's interval contains the true rate, summed over every possible count of successes in n trials, and its expected width. A 95% method rarely covers exactly 95%; Wald can fall far below. Counts with probability under 1e-20 are skipped. Up to 2,000 trials.",
      [count("n", "Trials (n)", "e.g. 50", { min: 1, max: 2000 }), share("p", "True rate", "e.g. 0.1"), LEVEL,
        { name: "method", label: "Method", type: "select", options: COVERAGE_METHODS.map(([id, name]) => [id, name]) }], ({ n, p, level, method }) => {
        if (p <= 0 || p >= 1) fail("The true rate must be strictly between 0 and 1.");
        const interval = COVERAGE_METHODS.find(([id]) => id === method)[2];
        let covered = 0, width = 0;
        for (let k = 0; k <= n; k++) {
          const weight = binomialPmf(k, n, p);
          if (weight < 1e-20) continue;
          const [lower, upper] = interval(k, n, level);
          if (lower === null || upper === null) return [["Actual coverage", null], ["Nominal coverage", Number(level)], ["Actual minus nominal", null], ["Expected interval width", null]];
          if (lower <= p && p <= upper) covered += weight;
          width += weight * (upper - lower);
        }
        return [["Actual coverage", Math.min(1, covered)], ["Nominal coverage", Number(level)], ["Actual minus nominal", Math.min(1, covered) - Number(level)], ["Expected interval width", width]];
      }),
    tool("beta_posterior", "Bayesian Beta posterior and credible interval", "Starts from a Beta(a, b) prior (1 and 1 is uniform; 0.5 and 0.5 is Jeffreys; earlier counts can go in as successes + 1 and failures + 1), adds k successes and n − k failures, and gives the posterior and its equal-tailed credible interval. A statement about the rate given the prior, not a frequentist interval.",
      [SUCCESSES, TRIALS, ...PRIOR, LEVEL], ({ k, n, a, b, level }) => {
        counts(k, n);
        const pa = a + k, pb = b + n - k, total = pa + pb, tail = (1 - Number(level)) / 2;
        return [["Posterior a", pa], ["Posterior b", pb], ["Posterior mean", pa / total], ["Posterior mode", pa > 1 && pb > 1 ? (pa - 1) / (total - 2) : null],
          ["Posterior standard deviation", Math.sqrt(pa * pb / (total * total * (total + 1)))],
          [`Lower ${percent(level)} credible bound`, betaQuantile(tail, pa, pb)], [`Upper ${percent(level)} credible bound`, betaQuantile(1 - tail, pa, pb)]];
      }),
    tool("probability_above_target", "Chance a gate's true accuracy is above a target", "From k correct of n checked rows and a Beta prior (1 and 1 is uniform), the posterior probability that the true accuracy is above the target. A Bayesian statement given the prior, not a p-value.",
      [count("k", "Correct rows", "e.g. 188"), count("n", "Rows checked", "e.g. 200", { min: 1 }), share("target", "Target accuracy", "e.g. 0.9"), ...PRIOR], ({ k, n, target, a, b }) => {
        counts(k, n);
        if (target <= 0 || target >= 1) fail("The target must be strictly between 0 and 1.");
        const pa = a + k, pb = b + n - k;
        const above = incompleteBeta(1 - target, pb, pa);   // P(rate > t) = I_(1−t)(b', a'); null when it cannot be computed
        return [["Posterior mean accuracy", pa / (pa + pb)], ["Chance the accuracy is above the target", above], ["Chance it is at or below the target", above === null ? null : 1 - above]];
      }),
    tool("probability_b_beats_a", "Chance one variant's accuracy beats another's", "With independent Beta posteriors for two variants (whole-number prior; 1 and 1 is uniform), the chance that B's true accuracy is above A's, by the exact sum for whole-number shapes. Counts up to 100,000.",
      [count("kA", "A: correct rows", "e.g. 80", { max: MAX_EXACT }), count("nA", "A: rows checked", "e.g. 100", { min: 1, max: MAX_EXACT }),
        count("kB", "B: correct rows", "e.g. 88", { max: MAX_EXACT }), count("nB", "B: rows checked", "e.g. 100", { min: 1, max: MAX_EXACT }), ...INTEGER_PRIOR],
      ({ kA, nA, kB, nB, a, b }) => {
        if (kA > nA || kB > nB) fail("Correct rows cannot be more than rows checked.");
        const aA = a + kA, bA = b + nA - kA, aB = a + kB, bB = b + nB - kB;
        // P(pB > pA) = Σ_{i < aB} B(aA + i, bA + bB) / ((bB + i) B(1 + i, bB) B(aA, bA))
        let total = 0;
        for (let i = 0; i < aB; i++) total += Math.exp(logBeta(aA + i, bA + bB) - Math.log(bB + i) - logBeta(1 + i, bB) - logBeta(aA, bA));
        const beats = Math.min(1, Math.max(0, total));
        return [["Posterior mean of A", aA / (aA + bA)], ["Posterior mean of B", aB / (aB + bB)], ["Chance B is above A", beats], ["Chance A is above B", 1 - beats]];
      }),
    tool("one_sided_bounds", "One-sided bounds for an accuracy", "A lower bound to claim \"accuracy is at least …\" and an upper bound to claim \"at most …\", each holding on its own at the chosen confidence: the exact (Clopper–Pearson) bound and the Wilson bound. Together the two exact bounds form a two-sided interval at twice the error.",
      [count("k", "Correct rows", "e.g. 188"), count("n", "Rows checked", "e.g. 200", { min: 1 }), ONE_SIDED], ({ k, n, level }) => {
        counts(k, n);
        const alpha = 1 - Number(level), z = zOne(level), [wl, wu] = wilson(k, n, z);
        return [["Accuracy", k / n], ["Exact lower bound", k === 0 ? 0 : betaQuantile(alpha, k, n - k + 1)], ["Exact upper bound", k === n ? 1 : betaQuantile(1 - alpha, k + 1, n - k)],
          ["Wilson lower bound", wl], ["Wilson upper bound", wu]];
      }),
    tool("accuracy_needed", "Accuracy needed to show a target", "How many of n checked rows must be correct for the exact one-sided binomial test to show the true accuracy is above the target at the chosen confidence. When even n of n is not enough, it says so and gives the fewest rows that could do it.",
      [count("n", "Rows you will check", "e.g. 200", { min: 1 }), share("target", "Target accuracy", "e.g. 0.9"), ONE_SIDED], ({ n, target, level }) => {
        if (target <= 0 || target >= 1) fail("The target must be strictly between 0 and 1.");
        const alpha = 1 - Number(level);
        const fewest = Math.ceil(Math.log(alpha) / Math.log(target) - 1e-9);
        if (binomialSf(n, n, target) > alpha) {
          return { rows: [["Correct rows needed", null], ["Accuracy needed", null], ["Errors allowed", null], ["Fewest rows that could show it (all correct)", fewest]],
            note: `${n} rows cannot show it, even with none wrong.` };
        }
        let lo = 0, hi = n;   // the smallest k with P(X >= k | target) <= alpha
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (binomialSf(mid, n, target) <= alpha) hi = mid; else lo = mid + 1;
        }
        return [["Correct rows needed", lo], ["Accuracy needed", lo / n], ["Errors allowed", n - lo], ["Fewest rows that could show it (all correct)", fewest]];
      }),
    tool("ratio_score_interval", "Ratio of two proportions (score interval)", "The ratio of two success rates (A ÷ B, the relative risk) with Koopman's score interval, which needs no correction for zero cells and holds its level better with small counts than the log interval in Odds ratio and rate ratio. With no successes in B the upper bound is unbounded (—).",
      [count("x1", "A: successes", "e.g. 36"), count("n1", "A: trials", "e.g. 40", { min: 1 }), count("x2", "B: successes", "e.g. 16"), count("n2", "B: trials", "e.g. 80", { min: 1 }), LEVEL],
      ({ x1, n1, x2, n2, level }) => {
        if (x1 > n1 || x2 > n2) fail("Successes cannot be more than trials.");
        if (x1 === 0 && x2 === 0) fail("Neither group has a success, so the ratio is undefined.");
        const p1 = x1 / n1, p2 = x2 / n2, total = n1 + n2, critical = zTwo(level) ** 2;
        // The score statistic at ratio t, with the rates fitted under p1 = t * p2 (the root of a quadratic).
        const score = (t) => {
          const A = total * t, B = -(n1 * t + x1 + n2 + x2 * t), C = x1 + x2;
          const q2 = Math.min(1, (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A)), q1 = Math.min(1, t * q2);
          const top = (p1 - t * p2) ** 2, spread = q1 * (1 - q1) / n1 + t * t * q2 * (1 - q2) / n2;
          return spread > 0 ? top / spread : (top === 0 ? 0 : Infinity);
        };
        const estimate = x2 === 0 ? null : p1 / p2;
        const solveLog = (from, to) => Math.exp(bisect((w) => score(Math.exp(w)), critical, from < to, Math.min(from, to), Math.max(from, to)));
        let lower = 0, upper = null;
        if (x1 > 0) {
          const centre = x2 === 0 ? Math.log(1e12) : Math.log(estimate);
          let far = centre - 1;
          while (score(Math.exp(far)) <= critical && far > -700) far -= 1;
          lower = solveLog(centre, far);
        }
        if (x2 > 0) {
          const centre = x1 === 0 ? Math.log(1e-12) : Math.log(estimate);
          let far = centre + 1;
          while (score(Math.exp(far)) <= critical && far < 700) far += 1;
          upper = far >= 700 ? null : solveLog(centre, far);
        }
        return [["Rate A", p1], ["Rate B", p2], ["Ratio A ÷ B", estimate], [`Lower ${percent(level)} bound`, lower], [`Upper ${percent(level)} bound`, upper]];
      }),
    tool("poisson_rate_interval", "Exact interval for an event rate", "Events counted over an exposure (rows, hours, days) as a rate with its exact (Garwood) Poisson interval, scaled per the unit you choose, such as errors per 1,000 rows. Assumes events arrive independently at a constant rate.",
      [count("events", "Events counted", "e.g. 137", { max: 1e7 }), real("exposure", "Exposure (rows, hours, …)", "e.g. 24.19893", { min: 0 }), real("per", "Express the rate per", "e.g. 1000", { min: 0, default: 1 }), LEVEL],
      ({ events, exposure, per, level }) => {
        if (!(exposure > 0) || !(per > 0)) fail("The exposure and the unit must be above 0.");
        const tail = (1 - Number(level)) / 2, scale = per / exposure;
        return [["Events", events], ["Rate per unit", events * scale], [`Lower ${percent(level)} bound`, events === 0 ? 0 : chiSquareQuantile(tail, 2 * events) / 2 * scale],
          [`Upper ${percent(level)} bound`, chiSquareQuantile(1 - tail, 2 * events + 2) / 2 * scale]];
      }),
    tool("mean_interval", "Interval for a mean from summary statistics", "The Student t interval for a mean from its sample mean, standard deviation and size, such as average latency or score. Give the population size to apply the finite population correction when the rows were drawn without replacement from a known batch. Assumes the sample mean is roughly normal.",
      [real("m", "Sample mean", "e.g. 412"), real("sd", "Sample standard deviation", "e.g. 95", { min: 0 }), count("n", "Sample size", "e.g. 25", { min: 2 }), LEVEL,
        { name: "population", label: "Population size (optional)", type: "integer", min: 2, optional: true }], ({ m, sd, n, level, population }) => {
        if (population !== null && population < n) fail("The population cannot be smaller than the sample.");
        const correction = population === null ? 1 : Math.sqrt((population - n) / (population - 1));
        const se = sd / Math.sqrt(n) * correction, t = studentTQuantile(1 - (1 - Number(level)) / 2, n - 1);
        return [["Standard error", se], ["Degrees of freedom", n - 1], ["t multiplier", t], ["Margin", t * se], ["Lower bound", m - t * se], ["Upper bound", m + t * se]];
      }),
    tool("sd_interval", "Interval for a standard deviation", "The chi-square interval for the spread (standard deviation and variance) of normally distributed values, from the sample standard deviation and size. It is sensitive to outliers and skew, so treat it as rough for latencies or costs.",
      [real("sd", "Sample standard deviation", "e.g. 95", { min: 0 }), count("n", "Sample size", "e.g. 11", { min: 2 }), LEVEL], ({ sd, n, level }) => {
        const tail = (1 - Number(level)) / 2, df = n - 1, variance = sd * sd;
        const lowVar = df * variance / chiSquareQuantile(1 - tail, df), highVar = df * variance / chiSquareQuantile(tail, df);
        return [["Lower bound for the standard deviation", Math.sqrt(lowVar)], ["Upper bound for the standard deviation", Math.sqrt(highVar)],
          ["Lower bound for the variance", lowVar], ["Upper bound for the variance", highVar]];
      }),
    tool("quantile_interval", "Interval for a median or percentile", `A distribution-free interval for a median (or any percentile) of pasted values, such as latencies, from their order statistics: no assumption about the shape. The coverage is exact and at least the level; a bound beyond the smallest or largest value is shown as —. ${LIST_FORMAT}`,
      [{ name: "values", label: "Values", type: "textarea", required: true, placeholder: "e.g. 310, 290, 455, 1200, 380" }, share("q", "Percentile (0.5 = median)", "e.g. 0.5", { default: 0.5 }), LEVEL],
      ({ values, q, level }) => {
        if (q <= 0 || q >= 1) fail("The percentile must be strictly between 0 and 1.");
        const list = numberList(values, "Values", 2).sort((x, y) => x - y), n = list.length, tail = (1 - Number(level)) / 2;
        if (n > MAX_EXACT) fail("Paste at most 100,000 values.");
        // lower rank: the largest l with P(B <= l - 1) <= tail; upper rank: the smallest u with P(B <= u - 1) >= 1 - tail; B ~ Bin(n, q)
        const low = binomialCdf(0, n, q) > tail ? null : lastTrue((l) => binomialCdf(l - 1, n, q) <= tail, 1, n);
        let high = null;
        if (binomialCdf(n - 1, n, q) >= 1 - tail) {
          let lo = 1, hi = n;
          while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (binomialCdf(mid - 1, n, q) >= 1 - tail) hi = mid; else lo = mid + 1; }
          high = lo;
        }
        const coverage = (high === null ? 1 : binomialCdf(high - 1, n, q)) - (low === null ? 0 : binomialCdf(low - 1, n, q));
        return [["Values", n], ["Sample percentile", quantile(list, q)], ["Lower bound", low === null ? null : list[low - 1]], ["Upper bound", high === null ? null : list[high - 1]],
          ["Rank of the lower bound", low], ["Rank of the upper bound", high], ["Actual coverage", coverage]];
      }),
    tool("geometric_mean_interval", "Interval for a geometric mean", `For skewed positive values such as latencies or costs: the t interval on the logarithms, turned back into the original unit. It brackets the geometric mean (the median when the values are log-normal), not the ordinary mean. ${LIST_FORMAT}`,
      [{ name: "values", label: "Positive values", type: "textarea", required: true, placeholder: "e.g. 120, 340, 95, 410, 2200" }, LEVEL], ({ values, level }) => {
        const list = numberList(values, "Positive values", 2);
        if (list.some((value) => value <= 0)) fail("Positive values: every value must be above 0.");
        const logs = list.map(Math.log), m = mean(logs), s = stdev(logs), n = list.length;
        const half = studentTQuantile(1 - (1 - Number(level)) / 2, n - 1) * s / Math.sqrt(n);
        return [["Values", n], ["Geometric mean", Math.exp(m)], ["Lower bound", Math.exp(m - half)], ["Upper bound", Math.exp(m + half)], ["Geometric standard deviation", Math.exp(s)]];
      }),
    tool("batch_errors_interval", "Exact bounds on errors left in a finite batch", "After auditing n rows drawn without replacement from a batch and finding k errors, the fewest and most errors the whole batch could hold, exact from the hypergeometric distribution (the finite population correction built in), and a one-sided upper bound. A count of errors m is kept when each tail probability is above (1 − confidence) ÷ 2 (one-sided: above 1 − confidence). Batches up to 100,000 rows.",
      [count("size", "Rows in the batch", "e.g. 500", { min: 1, max: MAX_EXACT }), count("audited", "Rows audited", "e.g. 60", { min: 1, max: MAX_EXACT }), count("k", "Errors found", "e.g. 2", { max: MAX_EXACT }), LEVEL],
      ({ size, audited, k, level }) => {
        if (audited > size) fail("Rows audited cannot be more than the rows in the batch.");
        if (k > audited) fail("Errors found cannot be more than rows audited.");
        const alpha = 1 - Number(level), least = k, most = size - (audited - k);
        const upperAt = (cut) => lastTrue((m) => hyperTail(k, size, m, audited, true) > cut, least, most);
        // smallest m with P(X >= k | m) > alpha / 2: that tail rises with m
        let lo = least, hi = most;
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (hyperTail(k, size, mid, audited, false) > alpha / 2) hi = mid; else lo = mid + 1; }
        const upper = upperAt(alpha / 2), oneSided = upperAt(alpha);
        return [["Error rate in the sample", k / audited], ["Estimated errors in the batch", k * size / audited], ["Fewest errors in the batch", lo], ["Most errors in the batch", upper],
          ["Most errors as a share of the batch", upper / size], ["One-sided upper bound on errors", oneSided], ["Rows not audited", size - audited]];
      }),
    tool("stratified_accuracy", "Accuracy from a stratified audit", "Combines per-stratum audits (for example by customer type or slice) into the accuracy of the whole population, weighting each stratum by its size, with Cochran's variance including the finite population correction and a normal interval. Paste one stratum per line: name, size, rows audited, rows correct (the name may be left out).",
      [{ name: "strata", label: "Strata", type: "textarea", required: true, placeholder: "retail, 800, 40, 38\nwholesale, 200, 30, 24" }, LEVEL], ({ strata: text, level }) => {
        const list = strata(text), population = list.reduce((sum, row) => sum + row.size, 0);
        let estimate = 0, variance = 0;
        const rows = list.map((row) => {
          const weight = row.size / population, p = row.correct / row.audited;
          estimate += weight * p;
          variance += weight * weight * (1 - row.audited / row.size) * p * (1 - p) / (row.audited - 1);
          return [row.name, weight, row.audited, p];
        });
        const se = Math.sqrt(variance), z = zTwo(level);
        const pooled = list.reduce((sum, row) => sum + row.correct, 0) / list.reduce((sum, row) => sum + row.audited, 0);
        return { rows: [["Stratified accuracy", estimate], ["Standard error", se], [`Lower ${percent(level)} bound`, clip(estimate - z * se)], [`Upper ${percent(level)} bound`, clip(estimate + z * se)],
          ["Unweighted accuracy of the audited rows", pooled]], table: { columns: ["Stratum", "Weight", "Rows audited", "Accuracy"], rows } };
      }),
    tool("goodman_intervals", "Simultaneous intervals for class shares", "Goodman's (1965) simultaneous intervals for the share of each class in a multinomial count (for example labels per class), so all K intervals hold together at the chosen level. Paste one class per line as \"name: count\", or just the counts separated by commas or spaces.",
      [{ name: "counts", label: "Counts per class", type: "textarea", required: true, placeholder: "refund: 40\nexchange: 25\nother: 15" }, LEVEL], ({ counts: text, level }) => {
        const classes = classCounts(text);
        if (classes.length < 2) fail("Paste at least two classes.");
        const total = classes.reduce((sum, [, value]) => sum + value, 0);
        if (total === 0) fail("The counts add up to 0.");
        const z = normalQuantile(1 - (1 - Number(level)) / (2 * classes.length)), A = z * z;
        const rows = classes.map(([name, value]) => {
          const root = Math.sqrt(A * (A + 4 * value * (total - value) / total));
          return [name, value, value / total, (A + 2 * value - root) / (2 * (total + A)), (A + 2 * value + root) / (2 * (total + A))];
        });
        return { table: { columns: ["Class", "Count", "Share", "Lower bound", "Upper bound"], rows }, note: `${percent(level)} simultaneous intervals for ${classes.length} classes and ${total} items.` };
      }),
    tool("next_batch_errors", "Errors to expect in the next batch", "From k errors in n checked rows and a Beta prior (1 and 1 is uniform), the predictive (beta-binomial) distribution of errors in the next m rows: the expected number, the chance of none, and an equal-tailed prediction range. Up to 100,000 rows.",
      [count("k", "Errors found", "e.g. 3", { max: MAX_EXACT }), count("n", "Rows checked", "e.g. 200", { min: 1, max: MAX_EXACT }), count("m", "Rows in the next batch", "e.g. 1000", { min: 1, max: MAX_EXACT }), ...ERROR_PRIOR, LEVEL],
      ({ k, n, m, a, b, level }) => {
        if (k > n) fail("Errors found cannot be more than rows checked.");
        const pa = a + k, pb = b + n - k, tail = (1 - Number(level)) / 2, base = logBeta(pa, pb);
        let cumulative = 0, lower = null, upper = null;
        const pmf = (j) => Math.exp(logGamma(m + 1) - logGamma(j + 1) - logGamma(m - j + 1) + logBeta(j + pa, m - j + pb) - base);
        for (let j = 0; j <= m && upper === null; j++) {
          cumulative += pmf(j);
          if (lower === null && cumulative >= tail) lower = j;
          if (cumulative >= 1 - tail) upper = j;
        }
        return [["Expected errors", m * pa / (pa + pb)], ["Chance of no errors", pmf(0)], [`Lower end of the ${percent(level)} range`, lower], [`Upper end of the ${percent(level)} range`, upper ?? m]];
      }),
    tool("corrected_rate", "True rate from an imperfect check", "When the check that flags rows (a labeler, a rule, a gate) has a known sensitivity and specificity, the Rogan–Gladen correction turns the share flagged into an estimate of the true share, with the Wilson interval of the flagged share carried through the same correction and clipped to 0 to 1. Assumes the sensitivity and specificity are known exactly and add up to more than 1.",
      [count("x", "Rows flagged", "e.g. 30"), count("n", "Rows checked", "e.g. 200", { min: 1 }), share("sensitivity", "Sensitivity of the check", "e.g. 0.9"), share("specificity", "Specificity of the check", "e.g. 0.95"), LEVEL],
      ({ x, n, sensitivity, specificity, level }) => {
        if (x > n) fail("Rows flagged cannot be more than rows checked.");
        const youden = sensitivity + specificity - 1;
        if (youden <= 0) fail("Sensitivity plus specificity must be above 1, or the check tells nothing.");
        const correct = (rate) => (rate + specificity - 1) / youden;
        const [low, high] = wilson(x, n, zTwo(level)), raw = correct(x / n);
        return [["Share flagged", x / n], ["Corrected rate (before clipping)", raw], ["Corrected rate", clip(raw)], [`Lower ${percent(level)} bound`, clip(correct(low))], [`Upper ${percent(level)} bound`, clip(correct(high))]];
      }),
    tool("correlation_interval", "Interval for a correlation", "The Fisher z interval for a Pearson correlation r from n pairs, such as between a confidence score and a human score. Assumes roughly bivariate normal data.",
      [real("r", "Correlation r", "e.g. 0.45", { min: -1, max: 1 }), count("n", "Pairs", "e.g. 50", { min: 4 }), LEVEL], ({ r, n, level }) => {
        if (Math.abs(r) >= 1) fail("The correlation must be strictly between −1 and 1.");
        const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3), half = zTwo(level) * se;
        return [["Fisher z", z], ["Standard error of z", se], ["Lower bound", Math.tanh(z - half)], ["Upper bound", Math.tanh(z + half)]];
      }),
  ],
});
