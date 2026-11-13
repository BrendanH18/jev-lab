// Toolbox: more sample-size and planning calculators for audits, labeling and comparisons. Every tool is pure: it reads
// only the rates, counts and margins typed into its form, never page data, and it never calls the model.
import { definePack, toNumber } from "../../kit.js";
import { binomialCdf, binomialPmf, binomialSf, hypergeometricPmf, incompleteBeta, normalQuantile, studentTQuantile } from "../../lib/math.js";

const GROUP = "Sample sizes";
const MAX_ROWS = 1e9;
const MAX_SCAN = 200000;   // rows tried one by one by the exact searches

// ---------- inputs ----------

const count = (name, label, placeholder, extra = {}) => ({ name, label, type: "integer", min: 0, max: MAX_ROWS, placeholder, ...extra });
const share = (name, label, placeholder, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, placeholder, ...extra });
const real = (name, label, placeholder, extra = {}) => ({ name, label, type: "number", placeholder, ...extra });
const LEVEL = { name: "level", label: "Confidence level", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]] };
const ONE_SIDED = { ...LEVEL, label: "Confidence level (one-sided)" };
const CHANCE = { name: "chance", label: "Chance wanted", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"], ["0.8", "80%"]] };
const ALPHA = { name: "alpha", label: "Significance level (two-sided)", type: "select", options: [["0.05", "0.05"], ["0.01", "0.01"], ["0.1", "0.10"]] };
const ALPHA_ONE = { name: "alpha", label: "Significance level (one-sided)", type: "select", options: [["0.025", "0.025"], ["0.05", "0.05"], ["0.01", "0.01"]] };
const POWER = { name: "power", label: "Power", type: "select", options: [["0.8", "80%"], ["0.9", "90%"], ["0.95", "95%"]] };
const STRATA = { name: "strata", label: "Strata", type: "textarea", required: true, placeholder: "retail, 8000, 0.05\nwholesale, 2000, 0.2" };
const STRATA_FORMAT = "Paste one stratum per line: name, number of rows in it, expected error rate (the name may be left out).";

// ---------- helpers ----------

const fail = (message) => { throw new Error(message); };
const ceilCount = (x) => Math.ceil(x - 1e-9);
const zTwo = (level) => normalQuantile(1 - (1 - Number(level)) / 2);
const zOf = (p) => normalQuantile(Number(p));
const short = (text) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);

function strictShare(value, label) {
  if (value <= 0 || value >= 1) fail(`${label} must be strictly between 0 and 1.`);
}

// The smallest whole n >= lo with ok(n) true, for ok false then true as n grows; null when none up to MAX_ROWS.
function firstTrue(ok, lo) {
  let hi = Math.max(lo, 1);
  while (!ok(hi)) {
    if (hi >= MAX_ROWS) return null;
    lo = hi + 1;
    hi = Math.min(MAX_ROWS, hi * 2);
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// Lines of "name, size, rate" (the name may be left out).
function strata(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) fail("Paste at least two strata, one per line.");
  return lines.map((line, index) => {
    const cells = line.split(/[,;\t]/).map((cell) => cell.trim());
    if (cells.length === 2) cells.unshift(`Stratum ${index + 1}`);
    if (cells.length !== 3) fail(`Line ${index + 1} ("${short(line)}") needs a name, the number of rows and the expected error rate.`);
    const size = toNumber(cells[1]), rate = toNumber(cells[2]);
    if (size === null || !Number.isInteger(size) || size < 1) fail(`Line ${index + 1}: the number of rows must be a whole number of at least 1.`);
    if (rate === null || rate < 0 || rate > 1) fail(`Line ${index + 1}: the expected rate must be between 0 and 1.`);
    return { name: cells[0] || `Stratum ${index + 1}`, size, rate, spread: Math.sqrt(rate * (1 - rate)) };
  });
}

// Whole numbers that add up to total, in proportion to quotas: floors first, then one more each to the largest
// remainders (earlier lines first on ties).
function largestRemainder(quotas, total) {
  const floors = quotas.map((quota) => Math.floor(quota + 1e-9));
  let left = total - floors.reduce((sum, value) => sum + value, 0);
  const order = quotas.map((quota, index) => ({ index, fraction: quota - floors[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

// Neyman allocation (n_h proportional to N_h S_h) with every stratum capped at its size; the rows a capped stratum
// cannot take go to the others. Strata with no spread left share the rest by size.
function neymanQuotas(list, total) {
  const quotas = new Array(list.length).fill(0), capped = new Set();
  for (;;) {
    const free = list.map((row, index) => index).filter((index) => !capped.has(index));
    const rest = total - [...capped].reduce((sum, index) => sum + list[index].size, 0);
    let weights = free.map((index) => list[index].size * list[index].spread);
    if (weights.every((weight) => weight === 0)) weights = free.map((index) => list[index].size);
    const sum = weights.reduce((a, b) => a + b, 0);
    let changed = false;
    free.forEach((index, i) => {
      quotas[index] = rest * weights[i] / sum;
      if (quotas[index] > list[index].size + 1e-9) { capped.add(index); changed = true; }
    });
    for (const index of capped) quotas[index] = list[index].size;
    if (!changed) return quotas;
  }
}

// Labeled rows a class needs for its margin: z² a (1 − a) / e².
const marginRows = (z, rate, margin) => ceilCount(z * z * rate * (1 - rate) / (margin * margin));

// Lines of "class, share of rows, expected accuracy".
function classes(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) fail("Paste at least one class.");
  const list = lines.map((line, index) => {
    const cells = line.split(/[,;\t]/).map((cell) => cell.trim());
    if (cells.length !== 3) fail(`Line ${index + 1} ("${short(line)}") needs a class name, its share of rows and its expected accuracy.`);
    const prevalence = toNumber(cells[1]), accuracy = toNumber(cells[2]);
    if (prevalence === null || prevalence <= 0 || prevalence > 1) fail(`Line ${index + 1}: the share of rows must be above 0 and at most 1.`);
    if (accuracy === null || accuracy <= 0 || accuracy >= 1) fail(`Line ${index + 1}: the expected accuracy must be strictly between 0 and 1.`);
    return { name: cells[0] || `Class ${index + 1}`, prevalence, accuracy };
  });
  if (list.reduce((sum, row) => sum + row.prevalence, 0) > 1 + 1e-9) fail("The shares of rows add up to more than 1.");
  return list;
}

// ---------- tools ----------

const tool = (id, title, help, inputs, compute) => ({ id, kind: "tool", group: GROUP, title, help, inputs, compute });

export default definePack({
  id: "tb-sample-sizes",
  surface: "workbench.toolbox",
  title: "More sample sizes",
  about: "Nineteen planning calculators: rows to show an accuracy above a target, relative precision, finite batches, stratified audits, means, audit power and acceptance plans, rare cases, clustering, per-class labels, Bayesian audits, non-inferiority, AUC and correlation. They compute only from what you type; sizes are plans, not measurements.",
  features: [
    tool("rows_above_target", "Rows to show an accuracy above a target", "How many labeled rows give the chosen power to show, at the chosen one-sided confidence, that the true accuracy is above a target when you expect it to be higher. Gives the normal approximation and the smallest size where the exact binomial test reaches the power (exact power zigzags with n, so a few more rows can briefly have less). Up to 200,000 rows.",
      [share("target", "Target accuracy", "e.g. 0.8"), share("expected", "Expected accuracy", "e.g. 0.9"), ONE_SIDED, POWER], ({ target, expected, level, power }) => {
        strictShare(target, "The target"); strictShare(expected, "The expected accuracy");
        if (expected <= target) fail("The expected accuracy must be above the target.");
        const alpha = 1 - Number(level), za = zOf(level), zb = zOf(power);
        const normal = ceilCount(((za * Math.sqrt(target * (1 - target)) + zb * Math.sqrt(expected * (1 - expected))) / (expected - target)) ** 2);
        // the smallest n whose exact test (reject when X >= c, c the smallest count with P(X >= c | target) <= alpha) has the power
        let n = Math.max(1, Math.floor(Math.log(alpha) / Math.log(target)));
        while (binomialSf(n, n, target) > alpha) n++;
        let c = n, exact = null, reached = null;
        for (; n <= MAX_SCAN; n++, c = binomialSf(c, n, target) <= alpha ? c : c + 1) {
          const chance = binomialSf(c, n, expected);
          if (chance >= Number(power)) { exact = n; reached = chance; break; }
        }
        return { rows: [["Rows needed (normal approximation)", normal], ["Rows needed (exact binomial)", exact], ["Correct rows needed among them", exact === null ? null : c],
          ["Exact power at that size", reached]], note: exact === null ? "The exact search stopped at 200,000 rows." : null };
      }),
    tool("relative_precision_rows", "Rows to estimate a rate with relative precision", "How many rows estimate a rate to within ± a share of itself (for example ±10% of a 2% error rate, so 1.8% to 2.2%), and the events a Poisson count needs for the same relative precision. Rare rates need many rows for relative precision.",
      [share("rate", "Expected rate", "e.g. 0.02"), share("relative", "Relative precision (share of the rate)", "e.g. 0.1"), LEVEL], ({ rate, relative, level }) => {
        strictShare(rate, "The expected rate");
        if (relative <= 0) fail("The relative precision must be above 0.");
        const z = zTwo(level), n = ceilCount(z * z * (1 - rate) / (relative * relative * rate));
        return [["Rows needed", n], ["Expected cases among them", n * rate], ["Events needed for a Poisson rate", ceilCount(z * z / (relative * relative))]];
      }),
    tool("finite_batch_audit", "Rows to audit from a finite batch", "How many rows to draw without replacement from a batch so that, if the batch held errors at the rate you want to rule out, finding no more than the allowed errors would happen with at most 1 − confidence chance (exact hypergeometric), next to the size that ignores the batch. Batches up to 1,000,000 rows.",
      [count("size", "Rows in the batch", "e.g. 2000", { min: 1, max: 1e6 }), share("rate", "Error rate to rule out", "e.g. 0.02"), count("allowed", "Errors allowed in the audit", "e.g. 0", { default: 0, max: 10000 }), ONE_SIDED],
      ({ size, rate, allowed, level }) => {
        strictShare(rate, "The error rate");
        const errors = ceilCount(rate * size), alpha = 1 - Number(level);
        if (errors <= allowed) fail(`At that rate the batch holds only ${errors} errors, no more than the errors allowed.`);
        const passes = (n) => {
          let total = 0;
          for (let j = 0; j <= allowed; j++) total += hypergeometricPmf(j, size, errors, n);
          return total;
        };
        let lo = allowed + 1, hi = size;
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (passes(mid) <= alpha) hi = mid; else lo = mid + 1; }
        const binomial = firstTrue((n) => binomialCdf(allowed, n, rate) <= alpha, allowed + 1);
        return [["Errors in the batch at that rate", errors], ["Rows to audit (finite batch)", lo], ["Rows to audit ignoring the batch size", binomial], ["Share of the batch audited", lo / size]];
      }),
    tool("stratified_allocation", "Split an audit across strata", `How to split a fixed number of audited rows across strata (for example customer types or slices): proportional to each stratum's size, and Neyman's allocation, which also gives more rows to strata whose error rate is closer to 50% (more spread) and caps each stratum at its size. Each column is rounded to whole rows that add up to the total. ${STRATA_FORMAT}`,
      [STRATA, count("total", "Rows to audit in all", "e.g. 400", { min: 1 })], ({ strata: text, total }) => {
        const list = strata(text), population = list.reduce((sum, row) => sum + row.size, 0);
        if (total > population) fail("The rows to audit cannot be more than the rows in all strata.");
        const proportional = largestRemainder(list.map((row) => total * row.size / population), total);
        const neyman = largestRemainder(neymanQuotas(list, total), total);
        return { table: { columns: ["Stratum", "Rows", "Expected rate", "Proportional", "Neyman"], rows: list.map((row, i) => [row.name, row.size, row.rate, proportional[i], neyman[i]]) },
          note: `${total} rows over ${list.length} strata.` };
      }),
    tool("stratified_total", "Rows for a stratified audit's margin", `The total rows a stratified audit needs to estimate the overall error rate within ± the margin, with Neyman allocation, with proportional allocation, and as one simple random sample, by Cochran's formulas with S² = p(1 − p) and the finite population correction. ${STRATA_FORMAT}`,
      [STRATA, share("margin", "Margin of error (e.g. 0.02)", "e.g. 0.02"), LEVEL], ({ strata: text, margin, level }) => {
        if (margin <= 0) fail("The margin must be above 0.");
        const list = strata(text), population = list.reduce((sum, row) => sum + row.size, 0), v = (margin / zTwo(level)) ** 2;
        const weights = list.map((row) => row.size / population);
        const ws = weights.reduce((sum, w, i) => sum + w * list[i].spread, 0), ws2 = weights.reduce((sum, w, i) => sum + w * list[i].spread ** 2, 0);
        const overall = weights.reduce((sum, w, i) => sum + w * list[i].rate, 0), s2 = overall * (1 - overall);
        return [["Rows with Neyman allocation", ceilCount(ws * ws / (v + ws2 / population))], ["Rows with proportional allocation", ceilCount(ws2 / (v + ws2 / population))],
          ["Rows as one simple random sample", ceilCount(s2 / (v + s2 / population))], ["Expected overall error rate", overall]];
      }),
    tool("two_means_rows", "Rows per group to compare two means", "Rows each of two independent groups needs for a two-sided test to detect a difference in means (for example latency or a score) with the chosen power: 2(z_α/2 + z_β)² σ² ÷ δ², and with Guenther's small-sample correction (+ z_α/2² ÷ 4), which is close to the t test's answer.",
      [real("delta", "Difference to detect", "e.g. 50", { min: 0 }), real("sd", "Standard deviation in each group", "e.g. 120", { min: 0 }), ALPHA, POWER], ({ delta, sd, alpha, power }) => {
        if (!(delta > 0) || !(sd > 0)) fail("The difference and the standard deviation must be above 0.");
        const za = normalQuantile(1 - Number(alpha) / 2), zb = zOf(power), n = 2 * (za + zb) ** 2 * sd * sd / (delta * delta);
        const corrected = ceilCount(n + za * za / 4);
        return [["Rows per group (normal approximation)", ceilCount(n)], ["Rows per group (with the correction)", corrected], ["Rows in total", 2 * corrected]];
      }),
    tool("audit_power", "Power of an audit to catch an error rate", "With n audited rows and a batch failing when more than c errors turn up: the chance the audit fails a batch whose true error rate is p, the chance it passes it, and (given an acceptable rate) the chance of a false alarm on a good batch. Exact binomial.",
      [count("n", "Rows audited", "e.g. 100", { min: 1 }), count("allowed", "Errors allowed (c)", "e.g. 1", { default: 0 }), share("rate", "True error rate", "e.g. 0.03"),
        share("acceptable", "Acceptable error rate (optional)", "e.g. 0.005", { optional: true })], ({ n, allowed, rate, acceptable }) => {
        if (allowed >= n) fail("The errors allowed must be fewer than the rows audited.");
        return [["Chance the audit catches it", binomialSf(allowed + 1, n, rate)], ["Chance the batch passes", binomialCdf(allowed, n, rate)], ["Expected errors found", n * rate],
          ["False alarm chance at the acceptable rate", acceptable === null ? null : binomialSf(allowed + 1, n, acceptable)]];
      }),
    tool("rows_until_errors", "Rows to review until k errors are seen", "When errors occur at rate p, the number of rows to review before the k-th error turns up follows a negative binomial distribution: its mean, its spread, its median and the rows that see k errors with the chance you choose. Useful for collecting examples of a rare mistake.",
      [count("k", "Errors to collect", "e.g. 5", { min: 1, max: 1e6 }), share("rate", "Error rate", "e.g. 0.02"), CHANCE], ({ k, rate, chance }) => {
        if (rate <= 0) fail("The error rate must be above 0.");
        const enough = (q) => firstTrue((m) => binomialSf(k, m, rate) >= q, k);
        return [["Expected rows", k / rate], ["Standard deviation", Math.sqrt(k * (1 - rate)) / rate], ["Median rows", enough(0.5)], ["Rows for the chance wanted", enough(Number(chance))]];
      }),
    tool("rare_cases", "Rare cases to expect in a sample", "How many cases of a rare kind (a class, an error, a fraud pattern) a sample of n rows holds on average, its spread, and the chance of finding none, fewer than r, or at least r. Exact binomial.",
      [count("n", "Rows in the sample", "e.g. 500", { min: 1 }), share("rate", "Rate of the rare case", "e.g. 0.004"), count("r", "Cases wanted (r)", "e.g. 3", { min: 1 })], ({ n, rate, r }) => {
        const atLeast = binomialSf(r, n, rate);
        return [["Expected cases", n * rate], ["Standard deviation", Math.sqrt(n * rate * (1 - rate))], ["Chance of none", binomialPmf(0, n, rate)],
          ["Chance of fewer than r", binomialCdf(r - 1, n, rate)], ["Chance of at least r", atLeast]];
      }),
    tool("design_effect", "Rows needed when rows come in groups", "Rows from the same customer, thread or day tend to resemble each other, so they carry less information than independent rows. The design effect 1 + (m − 1)·ICC inflates a size computed for independent rows; also gives the groups to sample and what each group is worth in independent rows.",
      [count("rows", "Rows needed if independent", "e.g. 385", { min: 1 }), real("perGroup", "Average rows per group (m)", "e.g. 10", { min: 1 }), share("icc", "Intraclass correlation (ICC)", "e.g. 0.05")],
      ({ rows, perGroup, icc }) => {
        const effect = 1 + (perGroup - 1) * icc, needed = ceilCount(rows * effect);
        return [["Design effect", effect], ["Rows needed", needed], ["Groups needed", ceilCount(needed / perGroup)], ["Independent rows each group is worth", perGroup / effect]];
      }),
    tool("per_class_labels", "Labels needed per class", "For a target ± margin on each class's own accuracy (or recall): the labels each class needs, and how many rows to sample at random so the class holds that many, from its share of rows. The rarest, hardest class usually decides the total. Paste one class per line: name, share of rows, expected accuracy.",
      [{ name: "classes", label: "Classes", type: "textarea", required: true, placeholder: "refund, 0.6, 0.95\nexchange, 0.3, 0.9\nfraud, 0.1, 0.8" },
        share("margin", "Margin of error per class (e.g. 0.05)", "e.g. 0.05"), LEVEL], ({ classes: text, margin, level }) => {
        if (margin <= 0) fail("The margin must be above 0.");
        const list = classes(text), z = zTwo(level);
        const rows = list.map((row) => {
          const labels = marginRows(z, row.accuracy, margin);
          return [row.name, row.prevalence, row.accuracy, labels, ceilCount(labels / row.prevalence)];
        });
        const most = rows.reduce((best, row) => (row[4] > best[4] ? row : best), rows[0]);
        return { rows: [["Rows to sample so every class has enough", most[4]], ["Class that needs the most rows", most[0]]],
          table: { columns: ["Class", "Share of rows", "Expected accuracy", "Labels needed", "Rows to sample"], rows } };
      }),
    tool("bayes_audit_rows", "Rows for a Bayesian audit", "How many rows to audit so that, if no more than the errors you expect turn up, the Beta posterior gives at least the chance you choose that the true error rate is below the target. Starts from a Beta(a, b) prior on the error rate (1 and 1 is uniform). A Bayesian statement given the prior.",
      [share("target", "Error rate to stay below", "e.g. 0.02"), CHANCE, count("errors", "Errors you expect to find", "e.g. 0", { default: 0, max: 1e6 }),
        real("a", "Prior errors + 1 (Beta a)", "1 = uniform", { min: 0.0001, default: 1 }), real("b", "Prior correct rows + 1 (Beta b)", "1 = uniform", { min: 0.0001, default: 1 })],
      ({ target, chance, errors, a, b }) => {
        strictShare(target, "The target error rate");
        const posterior = (n) => incompleteBeta(target, a + errors, b + n - errors);
        const n = firstTrue((size) => posterior(size) >= Number(chance), Math.max(errors, 1));
        return [["Rows to audit", n], ["Chance the error rate is below the target", n === null ? null : posterior(n)]];
      }),
    tool("mean_margin_rows", "Rows to estimate a mean within a margin", "How many rows estimate a mean (latency, cost, a score) to within ± the margin: (zσ ÷ e)² by the normal approximation, the smallest size whose Student t interval is that narrow, and the normal size with the finite population correction when you give the population.",
      [real("sd", "Expected standard deviation", "e.g. 120", { min: 0 }), real("margin", "Margin of error", "e.g. 20", { min: 0 }), LEVEL,
        { name: "population", label: "Population size (optional)", type: "integer", min: 2, optional: true }], ({ sd, margin, level, population }) => {
        if (!(sd > 0) || !(margin > 0)) fail("The standard deviation and the margin must be above 0.");
        const z = zTwo(level), n0 = (z * sd / margin) ** 2, upper = 1 - (1 - Number(level)) / 2;
        const withT = firstTrue((n) => studentTQuantile(upper, n - 1) * sd / Math.sqrt(n) <= margin, 2);
        return [["Rows (normal approximation)", Math.max(2, ceilCount(n0))], ["Rows (Student t)", withT],
          ["Rows with the population correction", population === null ? null : ceilCount(n0 / (1 + (n0 - 1) / population))]];
      }),
    tool("noninferiority_rows", "Rows per variant for non-inferiority or equivalence", "Rows each variant needs to show a new variant's success rate is no worse than the current one's by more than the margin (non-inferiority), or within ± the margin of it (equivalence, two one-sided tests), with the chosen power. Normal approximation (Chow, Shao and Wang); equivalence uses z for half the miss rate, as they do.",
      [share("pNew", "Expected rate of the new variant", "e.g. 0.9"), share("pCurrent", "Expected rate of the current variant", "e.g. 0.9"), share("margin", "Margin", "e.g. 0.05"),
        ALPHA_ONE, POWER, { name: "design", label: "Show", type: "select", options: [["noninferiority", "Non-inferiority"], ["equivalence", "Equivalence"]] }],
      ({ pNew, pCurrent, margin, alpha, power, design }) => {
        if (margin <= 0) fail("The margin must be above 0.");
        const spread = pNew * (1 - pNew) + pCurrent * (1 - pCurrent), diff = pNew - pCurrent, za = normalQuantile(1 - Number(alpha));
        if (spread === 0) fail("Both rates are 0 or 1, so there is no spread to plan for.");
        let n;
        if (design === "noninferiority") {
          if (diff + margin <= 0) fail("The new variant is expected to be worse than the margin allows.");
          n = (za + zOf(power)) ** 2 * spread / (diff + margin) ** 2;
        } else {
          if (Math.abs(diff) >= margin) fail("The expected difference must be smaller than the margin.");
          n = (za + normalQuantile(1 - (1 - Number(power)) / 2)) ** 2 * spread / (margin - Math.abs(diff)) ** 2;
        }
        return [["Rows per variant", ceilCount(n)], ["Rows in total", 2 * ceilCount(n)]];
      }),
    tool("acceptance_plan", "Audit plan for good and bad batches", "The smallest audit (n rows, pass when at most c errors) that passes a good batch (at the good error rate) with chance at least 1 − producer's risk and passes a bad batch (at the bad error rate) with chance at most the consumer's risk. Exact binomial, up to 200,000 rows.",
      [share("good", "Good batch error rate", "e.g. 0.01"), share("bad", "Bad batch error rate", "e.g. 0.05"),
        real("producer", "Producer's risk (failing a good batch)", "e.g. 0.05", { min: 0.0001, max: 0.5, default: 0.05 }),
        real("consumer", "Consumer's risk (passing a bad batch)", "e.g. 0.1", { min: 0.0001, max: 0.5, default: 0.1 })], ({ good, bad, producer, consumer }) => {
        strictShare(good, "The good error rate"); strictShare(bad, "The bad error rate");
        if (bad <= good) fail("The bad error rate must be above the good one.");
        let c = -1;
        for (let n = 1; n <= MAX_SCAN; n++) {
          while (c + 1 < n && binomialCdf(c + 1, n, bad) <= consumer) c++;
          if (c >= 0 && binomialCdf(c, n, good) >= 1 - producer) {
            return [["Rows to audit", n], ["Errors allowed", c], ["Chance a good batch passes", binomialCdf(c, n, good)], ["Chance a bad batch passes", binomialCdf(c, n, bad)]];
          }
        }
        return fail("No plan up to 200,000 rows; bring the two error rates further apart.");
      }),
    tool("auc_rows", "Positives and negatives for an AUC interval", "How many positive rows (and negatives, at the ratio you give) estimate a ROC AUC to within ± the half-width, from the Hanley–McNeil (1982) standard error at the expected AUC.",
      [{ name: "auc", label: "Expected AUC", type: "number", min: 0.5, max: 1, placeholder: "e.g. 0.85" }, real("ratio", "Negatives per positive", "e.g. 3", { min: 0.001, default: 1 }),
        share("half", "Half-width (e.g. 0.05)", "e.g. 0.05"), LEVEL], ({ auc, ratio, half, level }) => {
        if (auc >= 1) fail("The expected AUC must be below 1.");
        if (half <= 0) fail("The half-width must be above 0.");
        const z = zTwo(level), q1 = auc / (2 - auc), q2 = 2 * auc * auc / (1 + auc);
        const width = (pos) => {
          const neg = ceilCount(ratio * pos);
          return z * Math.sqrt((auc * (1 - auc) + (pos - 1) * (q1 - auc * auc) + (neg - 1) * (q2 - auc * auc)) / (pos * neg));
        };
        const pos = firstTrue((size) => ceilCount(ratio * size) >= 1 && width(size) <= half, 1);
        if (pos === null) return { rows: [["Positives needed", null], ["Negatives needed", null], ["Rows in total", null], ["Half-width at that size", null]], note: "No size up to 1,000,000,000 positives is enough." };
        const neg = ceilCount(ratio * pos);
        return [["Positives needed", pos], ["Negatives needed", neg], ["Rows in total", pos + neg], ["Half-width at that size", width(pos)]];
      }),
    tool("correlation_rows", "Pairs to detect a correlation", "How many pairs (for example confidence score and human score) a two-sided test needs to detect a correlation of r with the chosen power, by the Fisher z approximation: ((z_α/2 + z_β) ÷ atanh r)² + 3.",
      [real("r", "Correlation to detect", "e.g. 0.3", { min: -1, max: 1 }), ALPHA, POWER], ({ r, alpha, power }) => {
        if (r === 0 || Math.abs(r) >= 1) fail("The correlation must be between −1 and 1 and not 0.");
        const z = Math.atanh(Math.abs(r));
        return [["Pairs needed", ceilCount(((normalQuantile(1 - Number(alpha) / 2) + zOf(power)) / z) ** 2 + 3)], ["Fisher z of r", z]];
      }),
    tool("difference_margin_rows", "Rows per variant to estimate a difference", "Rows each of two variants needs so the difference between their rates is estimated within ± the margin (a precision target, not a test): z² (p₁(1 − p₁) + p₂(1 − p₂)) ÷ e².",
      [share("p1", "Expected rate of A", "e.g. 0.85"), share("p2", "Expected rate of B", "e.g. 0.9"), share("margin", "Margin for the difference", "e.g. 0.05"), LEVEL],
      ({ p1, p2, margin, level }) => {
        if (margin <= 0) fail("The margin must be above 0.");
        if (p1 * (1 - p1) + p2 * (1 - p2) === 0) fail("Both rates are 0 or 1, so there is no spread to plan for.");
        const z = zTwo(level), n = ceilCount(z * z * (p1 * (1 - p1) + p2 * (1 - p2)) / (margin * margin));
        return [["Rows per variant", n], ["Rows in total", 2 * n]];
      }),
    tool("gate_label_rows", "Rows to label for a gate's accuracy margin", "A gate's accuracy is measured only on the rows it automates, so at a coverage below 100% more rows must be labeled: the automated rows needed for ± the margin on accuracy, the rows to label in all at the expected coverage, and the margin coverage itself gets at that size.",
      [share("coverage", "Expected coverage (share automated)", "e.g. 0.7"), share("accuracy", "Expected accuracy when automated", "e.g. 0.95"), share("margin", "Margin for accuracy", "e.g. 0.03"), LEVEL],
      ({ coverage, accuracy, margin, level }) => {
        if (coverage <= 0) fail("The coverage must be above 0.");
        strictShare(accuracy, "The expected accuracy");
        if (margin <= 0) fail("The margin must be above 0.");
        const z = zTwo(level), automated = marginRows(z, accuracy, margin), total = ceilCount(automated / coverage);
        return [["Automated rows needed", automated], ["Rows to label in all", total], ["Coverage margin at that size", z * Math.sqrt(coverage * (1 - coverage) / total)]];
      }),
  ],
});
