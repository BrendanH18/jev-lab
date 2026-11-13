// Toolbox: hypothesis tests for comparing gates, variants and rates. Every tool is pure: it reads only the counts,
// summaries or pasted lists typed into its form, never page data, and it never calls the model.
import { definePack, toNumber } from "../../kit.js";
import { betaQuantile, binomialCdf, binomialPmf, binomialSf, chiSquareCdf, chiSquareSf, hypergeometricPmf, mean, normalCdf,
  normalQuantile, normalSf, studentTCdf, studentTQuantile, studentTSf, variance } from "../../lib/math.js";

const GROUP = "Hypothesis tests";
const MAX_COUNT = 1e9;
const RELATIVE = 1 + 1e-7;   // how close two probabilities must be to count as equally extreme (as R does)

// ---------- inputs ----------

const count = (name, label, placeholder, min = 0) => ({ name, label, type: "integer", min, max: MAX_COUNT, placeholder });
const share = (name, label, placeholder) => ({ name, label, type: "number", min: 0, max: 1, placeholder });
const real = (name, label, placeholder, extra = {}) => ({ name, label, type: "number", placeholder, ...extra });
const LEVEL = { name: "level", label: "Confidence level", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]] };
const ALPHA = { name: "alpha", label: "Significance level α", type: "number", min: 0.0001, max: 0.5, default: 0.05 };
const POWER = { name: "power", label: "Target power", type: "number", min: 0.5, max: 0.9999, default: 0.8 };
const SIDES = { name: "sides", label: "Test", type: "select", options: [["two", "Two-sided"], ["one", "One-sided"]] };
const ALTERNATIVE = { name: "alternative", label: "Alternative", type: "select",
  options: [["two-sided", "Two-sided: A differs from B"], ["greater", "One-sided: A above B"], ["less", "One-sided: A below B"]] };
const TWO_GROUPS = [count("x1", "Successes in A", "e.g. 45"), count("n1", "Trials in A", "e.g. 100", 1),
  count("x2", "Successes in B", "e.g. 30"), count("n2", "Trials in B", "e.g. 100", 1)];
const NEW_VS_CURRENT = [count("x1", "Successes with the new variant", "e.g. 188"), count("n1", "Trials with the new variant", "e.g. 200", 1),
  count("x2", "Successes with the current variant", "e.g. 190"), count("n2", "Trials with the current variant", "e.g. 200", 1)];
const SUMMARY_TWO = [real("mean1", "Mean of A", "e.g. 0.82"), real("sd1", "Standard deviation of A", "e.g. 0.1", { min: 0 }), count("n1", "Values in A", "e.g. 40", 2),
  real("mean2", "Mean of B", "e.g. 0.78"), real("sd2", "Standard deviation of B", "e.g. 0.12", { min: 0 }), count("n2", "Values in B", "e.g. 40", 2)];
const LIST_FORMAT = "Separate the numbers with commas, spaces, tabs, semicolons or new lines.";
const TABLE_FORMAT = "Put each row on its own line (or separate rows with semicolons) and separate the counts in a row with commas, tabs or spaces.";

// ---------- helpers ----------

const fail = (message) => { throw new Error(message); };
const percent = (level) => `${Math.round(Number(level) * 100)}%`;
const zFor = (level) => normalQuantile(1 - (1 - Number(level)) / 2);
const cap = (p) => Math.min(1, p);
const twoSidedZ = (z) => cap(2 * normalSf(Math.abs(z)));
const twoSidedT = (t, df) => cap(2 * studentTSf(Math.abs(t), df));
const short = (text) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);

function checkCounts(params, pairs) {
  for (const [x, n, name] of pairs) if (params[x] > params[n]) fail(`Successes in ${name} cannot exceed its trials.`);
}

// Numbers pasted as a list: any mix of commas, spaces, tabs, semicolons and new lines between them.
function numberList(text, label, minimum = 1) {
  const tokens = String(text ?? "").replace(/−/g, "-").split(/[\s,;]+/).filter(Boolean);
  const values = tokens.map((token) => {
    const value = toNumber(token);
    if (value === null) fail(`${label}: "${short(token)}" is not a number.`);
    return value;
  });
  if (values.length < minimum) fail(`${label}: paste at least ${minimum} number${minimum === 1 ? "" : "s"}.`);
  return values;
}

function pValueList(text) {
  const values = numberList(text, "P-values");
  for (const p of values) if (p < 0 || p > 1) fail(`P-values: ${p} is not between 0 and 1.`);
  return values;
}

// A table of counts pasted one row per line (or rows separated by semicolons), cells by commas, tabs or spaces.
function countTable(text, label) {
  const lines = String(text ?? "").split(/\r?\n|;/).map((line) => line.trim()).filter(Boolean);
  const rows = lines.map((line, index) => line.split(/[\s,]+/).filter(Boolean).map((token) => {
    const value = toNumber(token);
    if (value === null || !Number.isInteger(value) || value < 0) fail(`${label}: row ${index + 1} has "${short(token)}", which is not a count (a whole number 0 or more).`);
    return value;
  }));
  if (rows.length < 2) fail(`${label}: paste at least two rows.`);
  const width = rows[0].length;
  if (width < 2) fail(`${label}: every row needs at least two counts.`);
  rows.forEach((row, index) => { if (row.length !== width) fail(`${label}: row ${index + 1} has ${row.length} counts but row 1 has ${width}.`); });
  return rows;
}

// Average ranks (1-based) of values, with the tie-group sizes for the variance corrections.
function averageRanks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  const ties = [];
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].value === order[start].value) end++;
    const rank = (start + end + 2) / 2;
    for (let i = start; i <= end; i++) ranks[order[i].index] = rank;
    ties.push(end - start + 1);
    start = end + 1;
  }
  return { ranks, ties };
}

// The Wilson score interval for x successes in n trials.
function wilson(x, n, z) {
  const p = x / n, z2 = z * z, scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale;
  const half = (z / scale) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Newcombe's hybrid score interval (his method 10) for p1 - p2 from two independent Wilson intervals.
function newcombe(x1, n1, x2, n2, z) {
  const p1 = x1 / n1, p2 = x2 / n2, d = p1 - p2;
  const [l1, u1] = wilson(x1, n1, z), [l2, u2] = wilson(x2, n2, z);
  return { d, low: d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), high: d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2) };
}

// The pooled two-proportion z test, with or without the Yates continuity correction (as R's prop.test).
function twoProportion(params, corrected) {
  const { x1, n1, x2, n2, alternative } = params;
  checkCounts(params, [["x1", "n1", "A"], ["x2", "n2", "B"]]);
  const p1 = x1 / n1, p2 = x2 / n2, d = p1 - p2, pooled = (x1 + x2) / (n1 + n2);
  if (pooled === 0 || pooled === 1) fail("Every trial in both groups has the same outcome, so the pooled test is undefined.");
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const correction = corrected ? Math.min(0.5 * (1 / n1 + 1 / n2), Math.abs(d)) : 0;
  const z = Math.sign(d) * (Math.abs(d) - correction) / se;
  const p = alternative === "greater" ? normalSf(z) : alternative === "less" ? normalCdf(z) : twoSidedZ(z);
  const rows = [["Rate A (successes ÷ trials)", p1], ["Rate B (successes ÷ trials)", p2], ["Difference A − B (proportion)", d], ["Pooled rate", pooled],
    ["Standard error of the difference (pooled)", se]];
  if (corrected) rows.push(["Continuity correction applied (proportion)", correction]);
  rows.push(["z statistic", z], [`p-value (${alternative === "two-sided" ? "two-sided" : `one-sided, A ${alternative === "greater" ? "above" : "below"} B`})`, p]);
  return rows;
}

// Sum of the probabilities of a discrete distribution no larger than the observed one (R's two-sided exact rule).
function twoSidedExact(observed, from, to, pmf) {
  const limit = pmf(observed) * RELATIVE;
  let total = 0;
  for (let k = from; k <= to; k++) {
    const p = pmf(k);
    if (p <= limit) total += p;
  }
  return cap(total);
}

// Contingency-table margins and expected counts; rejects empty rows and columns.
function margins(table, label) {
  const rowTotals = table.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = table[0].map((_, j) => table.reduce((sum, row) => sum + row[j], 0));
  const total = rowTotals.reduce((a, b) => a + b, 0);
  rowTotals.forEach((value, i) => { if (value === 0) fail(`${label}: row ${i + 1} is all zeros.`); });
  colTotals.forEach((value, j) => { if (value === 0) fail(`${label}: column ${j + 1} is all zeros.`); });
  const expected = table.map((row, i) => row.map((_, j) => rowTotals[i] * colTotals[j] / total));
  return { rowTotals, colTotals, total, expected, df: (table.length - 1) * (table[0].length - 1) };
}

// Power of the two-proportion comparison by the normal approximation R's power.prop.test uses (the far tail ignored).
function proportionPower(p1, p2, n, alpha, sides) {
  const zAlpha = normalQuantile(1 - alpha / (sides === "one" ? 1 : 2));
  const pBar = (p1 + p2) / 2;
  return normalCdf((Math.sqrt(n) * Math.abs(p1 - p2) - zAlpha * Math.sqrt(2 * pBar * (1 - pBar))) / Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)));
}

function tSummary(values, level) {
  const n = values.length;
  const m = mean(values), sd = Math.sqrt(variance(values)), se = sd / Math.sqrt(n);
  return { n, m, sd, se, df: n - 1, q: studentTQuantile(1 - (1 - Number(level)) / 2, n - 1) };
}

const sizeReading = (value) => (Math.abs(value) < 0.2 ? "negligible" : Math.abs(value) < 0.5 ? "small" : Math.abs(value) < 0.8 ? "medium" : "large");
const ceilCount = (value) => Math.ceil(value - 1e-9);
// A confidence level as a percentage with up to two decimals: 0.95 -> "95%", 0.975 -> "97.5%".
const confidence = (level) => `${Number((level * 100).toFixed(2))}%`;

// ---------- tools ----------

const tool = (id, title, help, inputs, compute) => ({ id, kind: "tool", group: GROUP, title, help, inputs, compute });

export default definePack({
  id: "tb-hypothesis-tests",
  surface: "workbench.toolbox",
  title: "Hypothesis tests",
  about: "Tests, intervals, effect sizes and sample sizes for deciding whether one gate, variant or rate really beats another. Each tool computes only from the counts, summaries or lists typed into it.",
  features: [
    tool("two_proportion_z", "Two-proportion z test", "Compares two independent success rates with the pooled z test (the same as a 2x2 chi-square without correction). Assumes independent trials and roughly 5 or more successes and failures in each group.",
      [...TWO_GROUPS, ALTERNATIVE], (params) => twoProportion(params, false)),
    tool("two_proportion_z_corrected", "Two-proportion z test with continuity correction", "The pooled z test with the Yates continuity correction (as R's prop.test): more conservative for small groups. Assumes independent trials.",
      [...TWO_GROUPS, ALTERNATIVE], (params) => twoProportion(params, true)),
    tool("mcnemar_detail", "McNemar's test: one-sided, mid-p and uncorrected", "For two gates run on the same items, from the pairs where only one is right. Gives the one-sided exact p-value, the mid-p value (exact two-sided minus half the observed probability, recommended by Fagerland and colleagues) and the chi-square without continuity correction. Assumes the items are independent.",
      [count("b", "Items only A gets right", "e.g. 10"), count("c", "Items only B gets right", "e.g. 2")], ({ b, c }) => {
        const n = b + c;
        if (n === 0) fail("There are no items where exactly one gate is right, so there is nothing to test.");
        const low = Math.min(b, c);
        const chi = (b - c) ** 2 / n;
        return [["Discordant items", n], ["Share of discordant items A wins", b / n], ["Exact p-value (one-sided, A better)", binomialSf(b, n, 0.5)],
          ["Mid-p value (two-sided)", cap(2 * (binomialCdf(low, n, 0.5) - 0.5 * binomialPmf(low, n, 0.5)))],
          ["Chi-square without continuity correction (df 1)", chi], ["p-value without continuity correction", chiSquareSf(chi, 1)]];
      }),
    tool("paired_difference_interval", "Interval for a difference of two paired rates", "For two gates run on the same items: the difference in accuracy (A − B) with the Agresti–Min interval, a Wald interval after adding 0.5 to each of the four cells. Assumes the items are independent.",
      [count("both", "Items both get right", "e.g. 150"), count("b", "Items only A gets right", "e.g. 20"), count("c", "Items only B gets right", "e.g. 8"),
        count("neither", "Items both get wrong", "e.g. 22"), LEVEL], ({ both, b, c, neither, level }) => {
        const n = both + b + c + neither;
        if (n === 0) fail("Enter at least one item.");
        const m = n + 2, pb = (b + 0.5) / m, pc = (c + 0.5) / m;
        const adjusted = pb - pc, se = Math.sqrt((pb + pc - adjusted ** 2) / m), z = zFor(level);
        return [["Accuracy of A", (both + b) / n], ["Accuracy of B", (both + c) / n], ["Difference A − B (proportion)", (b - c) / n],
          [`Lower ${percent(level)} bound (Agresti–Min)`, Math.max(-1, adjusted - z * se)], [`Upper ${percent(level)} bound (Agresti–Min)`, Math.min(1, adjusted + z * se)]];
      }),
    tool("fisher_exact", "Fisher's exact test", "Exact test of a 2x2 table with both margins treated as fixed. The two-sided p-value sums every table no more probable than the one observed (as R's fisher.test). Works for any group size.",
      [count("a", "A: successes", "e.g. 3"), count("b", "A: failures", "e.g. 1"), count("c", "B: successes", "e.g. 1"), count("d", "B: failures", "e.g. 3")], ({ a, b, c, d }) => {
        const total = a + b + c + d;
        if (total === 0) fail("Enter at least one count above zero.");
        if (total > 1e6) fail("Fisher's exact test here takes at most 1,000,000 items; use the chi-square test for larger tables.");
        const row = a + b, column = a + c;
        const pmf = (k) => hypergeometricPmf(k, total, column, row);
        const from = Math.max(0, row - (total - column)), to = Math.min(row, column);
        let upper = 0, lower = 0;
        for (let k = from; k <= to; k++) {
          if (k >= a) upper += pmf(k);
          if (k <= a) lower += pmf(k);
        }
        return [["Sample odds ratio (a·d ÷ b·c)", b * c > 0 ? (a * d) / (b * c) : null], ["p-value (two-sided)", twoSidedExact(a, from, to, pmf)],
          ["p-value (one-sided, A's success rate higher)", cap(upper)], ["p-value (one-sided, A's success rate lower)", cap(lower)]];
      }),
    tool("chi_square_table", "Chi-square test of independence", `Pearson's chi-square test for an r x c table of counts (for example variants by outcome), with the expected counts and Cramér's V. ${TABLE_FORMAT} Assumes independent items and expected counts of about 5 or more.`,
      [{ name: "table", label: "Counts (one row per line)", type: "textarea", rows: 5, required: true, placeholder: "30 70\n45 55" }], ({ table }) => {
        const counts = countTable(table, "Counts");
        const { expected, total, df } = margins(counts, "Counts");
        let chi = 0;
        counts.forEach((row, i) => row.forEach((value, j) => { chi += (value - expected[i][j]) ** 2 / expected[i][j]; }));
        const small = expected.flat().filter((value) => value < 5).length;
        return { rows: [["Chi-square statistic", chi], ["Degrees of freedom", df], ["p-value", chiSquareSf(chi, df)],
          ["Cramér's V (0 to 1)", Math.sqrt(chi / (total * (Math.min(counts.length, counts[0].length) - 1)))], ["Cells with an expected count below 5", small]],
        table: { columns: ["expected count", ...counts[0].map((_, j) => `column ${j + 1}`)], rows: expected.map((row, i) => [`row ${i + 1}`, ...row]) },
        note: small ? "Some expected counts are below 5, so the chi-square p-value is rough; Fisher's exact test suits a sparse 2x2 table." : null };
      }),
    tool("g_test", "G-test of independence", `The likelihood-ratio (G) test for an r x c table of counts, with Williams' correction for small samples. ${TABLE_FORMAT} Assumes independent items.`,
      [{ name: "table", label: "Counts (one row per line)", type: "textarea", rows: 5, required: true, placeholder: "30 70\n45 55" }], ({ table }) => {
        const counts = countTable(table, "Counts");
        const { expected, total, df, rowTotals, colTotals } = margins(counts, "Counts");
        let g = 0;
        counts.forEach((row, i) => row.forEach((value, j) => { if (value > 0) g += 2 * value * Math.log(value / expected[i][j]); }));
        const inverse = (list) => list.reduce((sum, value) => sum + 1 / value, 0);
        const q = 1 + (total * inverse(rowTotals) - 1) * (total * inverse(colTotals) - 1) / (6 * total * df);
        return [["G statistic", g], ["Degrees of freedom", df], ["p-value", chiSquareSf(g, df)], ["Williams correction factor", q],
          ["G with Williams correction", g / q], ["p-value with Williams correction", chiSquareSf(g / q, df)]];
      }),
    tool("binomial_test", "Exact binomial test against a target rate", "Tests whether a gate's success rate differs from a target, from the exact binomial distribution. The two-sided p-value sums every count no more probable than the one observed (as R's binom.test); the Clopper–Pearson interval is exact. Assumes independent trials.",
      [count("x", "Successes", "e.g. 682"), count("n", "Trials", "e.g. 925", 1), share("p0", "Target rate (0 to 1)", "e.g. 0.75"),
        { ...ALTERNATIVE, options: [["two-sided", "Two-sided: rate differs from target"], ["greater", "One-sided: rate above target"], ["less", "One-sided: rate below target"]] }, LEVEL],
      ({ x, n, p0, alternative, level }) => {
        if (x > n) fail("Successes cannot exceed trials.");
        if (n > 1e6) fail("Trials must be at most 1,000,000.");
        if (p0 <= 0 || p0 >= 1) fail("Target rate must be strictly between 0 and 1.");
        const p = alternative === "greater" ? binomialSf(x, n, p0) : alternative === "less" ? binomialCdf(x, n, p0)
          : twoSidedExact(x, 0, n, (k) => binomialPmf(k, n, p0));
        const tail = (1 - Number(level)) / 2;
        return [["Observed rate", x / n], ["Target rate", p0], [`p-value (${alternative === "two-sided" ? "two-sided" : `one-sided, rate ${alternative === "greater" ? "above" : "below"} target`})`, p],
          [`Clopper–Pearson ${percent(level)} interval, lower`, x === 0 ? 0 : betaQuantile(tail, x, n - x + 1)],
          [`Clopper–Pearson ${percent(level)} interval, upper`, x === n ? 1 : betaQuantile(1 - tail, x + 1, n - x)]];
      }),
    tool("sign_test", "Sign test for paired preferences", "Tests whether reviewers prefer A over B more often than chance. Paste one preference per item: A, B or tie (also =), or a signed difference (positive means A). Ties are left out; the p-values are exact binomial.",
      [{ name: "preferences", label: "Preferences (A, B, tie or numbers)", type: "textarea", rows: 4, required: true, placeholder: "A A B tie A A B A" }], ({ preferences }) => {
        let a = 0, b = 0, ties = 0;
        for (const token of String(preferences).replace(/−/g, "-").split(/[\s,;]+/).filter(Boolean)) {
          const word = token.toLowerCase(), number = toNumber(token);
          if (word === "a" || (number !== null && number > 0)) a++;
          else if (word === "b" || (number !== null && number < 0)) b++;
          else if (["tie", "t", "=", "same", "draw"].includes(word) || number === 0) ties++;
          else fail(`Preferences: "${short(token)}" is not A, B, tie or a number.`);
        }
        const n = a + b;
        if (n === 0) fail("Preferences: there is no item that prefers A or B.");
        return [["A preferred", a], ["B preferred", b], ["Ties (left out)", ties], ["Share of decisive items preferring A", a / n],
          ["Exact p-value (two-sided)", cap(2 * binomialCdf(Math.min(a, b), n, 0.5))], ["Exact p-value (one-sided, A preferred more)", binomialSf(a, n, 0.5)]];
      }),
    tool("wilcoxon_signed_rank", "Wilcoxon signed-rank test", `Tests whether paired differences (for example score A − score B per item) are centred on zero. Zeros are left out, ties get average ranks and the p-value uses the normal approximation with the tie correction (as R's wilcox.test with exact = FALSE). Assumes the differences are symmetric about their median; with fewer than about 20 nonzero differences prefer an exact table. ${LIST_FORMAT}`,
      [{ name: "differences", label: "Paired differences", type: "textarea", rows: 4, required: true, placeholder: "0.12 -0.03 0.08 0.2 0 0.05" },
        { name: "continuity", label: "Continuity correction", type: "checkbox", default: true }], ({ differences, continuity }) => {
        const values = numberList(differences, "Paired differences");
        const nonzero = values.filter((value) => value !== 0);
        const n = nonzero.length;
        if (n === 0) fail("Paired differences: every difference is zero.");
        const { ranks, ties } = averageRanks(nonzero.map(Math.abs));
        const positive = ranks.reduce((sum, rank, i) => sum + (nonzero[i] > 0 ? rank : 0), 0);
        const centre = n * (n + 1) / 4;
        const sd = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - ties.reduce((sum, t) => sum + t ** 3 - t, 0) / 48);
        const shift = positive - centre;
        const z = (shift - (continuity ? Math.sign(shift) * 0.5 : 0)) / sd;
        return [["Nonzero differences used", n], ["Zero differences left out", values.length - n], ["Sum of positive ranks W+", positive],
          ["Sum of negative ranks W−", n * (n + 1) / 2 - positive], ["z statistic (normal approximation)", z], ["p-value (two-sided)", twoSidedZ(z)]];
      }),
    tool("mann_whitney", "Mann–Whitney U test", `Compares two independent samples (for example confidence scores of two variants) by ranks. Ties get average ranks; the p-value uses the normal approximation with the tie correction (as R's wilcox.test with exact = FALSE). Assumes independent values. ${LIST_FORMAT}`,
      [{ name: "a", label: "Sample A", type: "textarea", rows: 3, required: true, placeholder: "0.91 0.85 0.77 0.95" },
        { name: "b", label: "Sample B", type: "textarea", rows: 3, required: true, placeholder: "0.70 0.82 0.66 0.74" },
        { name: "continuity", label: "Continuity correction", type: "checkbox", default: true }], ({ a, b, continuity }) => {
        const first = numberList(a, "Sample A"), second = numberList(b, "Sample B");
        const n1 = first.length, n2 = second.length, total = n1 + n2;
        const { ranks, ties } = averageRanks([...first, ...second]);
        const u1 = ranks.slice(0, n1).reduce((sum, rank) => sum + rank, 0) - n1 * (n1 + 1) / 2;
        const tieSum = ties.reduce((sum, t) => sum + t ** 3 - t, 0);
        const variance2 = n1 * n2 / 12 * ((total + 1) - (total > 1 ? tieSum / (total * (total - 1)) : 0));
        if (!(variance2 > 0)) fail("Every value is the same, so the samples cannot be ranked apart.");
        const shift = u1 - n1 * n2 / 2;
        const z = (shift - (continuity ? Math.sign(shift) * 0.5 : 0)) / Math.sqrt(variance2);
        return [["Values in A", n1], ["Values in B", n2], ["U for A", u1], ["U for B", n1 * n2 - u1],
          ["Probability a value from A exceeds one from B (ties count half)", u1 / (n1 * n2)], ["z statistic (normal approximation)", z], ["p-value (two-sided)", twoSidedZ(z)]];
      }),
    tool("kruskal_wallis", "Kruskal–Wallis test for several groups", "Compares three or more independent samples (for example confidence scores of several variants) by ranks; with two groups it matches the Mann–Whitney test without continuity correction. Paste one group per line, its values separated by commas, spaces or tabs. Ties get average ranks and H is tie-corrected; the p-value uses the chi-square approximation, which needs about 5 or more values per group.",
      [{ name: "groups", label: "Groups (one per line)", type: "textarea", rows: 4, required: true, placeholder: "0.91 0.85 0.77 0.95\n0.70 0.82 0.66\n0.88 0.79 0.93 0.90" }], ({ groups }) => {
        const samples = String(groups ?? "").split(/\r?\n/).filter((line) => line.trim()).map((line, i) => numberList(line.replace(/;/g, " "), `Group ${i + 1}`));
        if (samples.length < 2) fail("Groups: paste at least two groups, one per line.");
        const all = samples.flat(), total = all.length;
        const { ranks, ties } = averageRanks(all);
        let offset = 0;
        const sums = samples.map((sample) => { const part = ranks.slice(offset, offset + sample.length); offset += sample.length; return part.reduce((a, b) => a + b, 0); });
        const correction = 1 - ties.reduce((sum, t) => sum + t ** 3 - t, 0) / (total ** 3 - total);
        if (!(correction > 0)) fail("Every value is the same, so the groups cannot be ranked apart.");
        const h = (12 / (total * (total + 1)) * sums.reduce((sum, value, i) => sum + value * value / samples[i].length, 0) - 3 * (total + 1)) / correction;
        const df = samples.length - 1;
        return { rows: [["Groups", samples.length], ["Values", total], ["H statistic (tie-corrected)", h], ["Degrees of freedom", df], ["p-value", chiSquareSf(h, df)]],
          table: { columns: ["group", "values", "mean rank"], rows: samples.map((sample, i) => [i + 1, sample.length, sums[i] / sample.length]) } };
      }),
    tool("welch_t", "Welch's t test from summary statistics", "Compares two means from their means, standard deviations and sizes without assuming equal variances (Welch–Satterthwaite degrees of freedom). Assumes independent samples with roughly normal means.",
      [...SUMMARY_TWO, LEVEL], ({ mean1, sd1, n1, mean2, sd2, n2, level }) => {
        const v1 = sd1 * sd1 / n1, v2 = sd2 * sd2 / n2, se = Math.sqrt(v1 + v2);
        if (!(se > 0)) fail("Both standard deviations are zero, so the difference has no spread to test against.");
        const d = mean1 - mean2, t = d / se;
        const df = (v1 + v2) ** 2 / (v1 * v1 / (n1 - 1) + v2 * v2 / (n2 - 1));
        const q = studentTQuantile(1 - (1 - Number(level)) / 2, df);
        return [["Difference in means A − B", d], ["Standard error of the difference", se], ["t statistic", t], ["Degrees of freedom (Welch–Satterthwaite)", df],
          ["p-value (two-sided)", twoSidedT(t, df)], [`Lower ${percent(level)} bound for the difference`, d - q * se], [`Upper ${percent(level)} bound for the difference`, d + q * se]];
      }),
    tool("paired_t", "Paired t test", `Compares two measurements of the same items (for example gate A's and gate B's score per item) through their differences A − B. Paste the two lists in the same item order. Assumes the differences are roughly normal. ${LIST_FORMAT}`,
      [{ name: "a", label: "Values for A", type: "textarea", rows: 3, required: true, placeholder: "0.82 0.75 0.91 0.66" },
        { name: "b", label: "Values for B, same order", type: "textarea", rows: 3, required: true, placeholder: "0.78 0.70 0.90 0.61" }, LEVEL], ({ a, b, level }) => {
        const first = numberList(a, "Values for A", 2), second = numberList(b, "Values for B", 2);
        if (first.length !== second.length) fail(`A has ${first.length} values but B has ${second.length}; paste one value per item in each.`);
        const s = tSummary(first.map((value, i) => value - second[i]), level);
        if (!(s.se > 0)) fail("Every difference is the same, so there is no spread to test against.");
        const t = s.m / s.se;
        return [["Pairs", s.n], ["Mean difference A − B", s.m], ["Standard deviation of the differences", s.sd], ["Standard error of the mean difference", s.se],
          ["t statistic", t], ["Degrees of freedom", s.df], ["p-value (two-sided)", twoSidedT(t, s.df)],
          [`Lower ${percent(level)} bound for the mean difference`, s.m - s.q * s.se], [`Upper ${percent(level)} bound for the mean difference`, s.m + s.q * s.se]];
      }),
    tool("one_sample_t", "One-sample t test", `Tests whether the mean of a list (for example per-batch accuracy) differs from a target value, with an interval for the mean. Assumes independent values with a roughly normal mean. ${LIST_FORMAT}`,
      [{ name: "values", label: "Values", type: "textarea", rows: 3, required: true, placeholder: "0.91 0.88 0.93 0.86 0.9" }, real("mu", "Target mean", "e.g. 0.9", { default: 0 }), LEVEL],
      ({ values, mu, level }) => {
        const s = tSummary(numberList(values, "Values", 2), level);
        if (!(s.se > 0)) fail("Every value is the same, so there is no spread to test against.");
        const t = (s.m - mu) / s.se;
        return [["Values", s.n], ["Mean", s.m], ["Standard deviation", s.sd], ["t statistic", t], ["Degrees of freedom", s.df], ["p-value (two-sided)", twoSidedT(t, s.df)],
          [`Lower ${percent(level)} bound for the mean`, s.m - s.q * s.se], [`Upper ${percent(level)} bound for the mean`, s.m + s.q * s.se]];
      }),
    tool("bonferroni_holm", "Bonferroni and Holm adjusted p-values", `Adjusts p-values for running several comparisons at once (for example one per question). Bonferroni multiplies by the number of tests; Holm's step-down method controls the same family-wise error with more power. Valid under any dependence between the tests. ${LIST_FORMAT}`,
      [{ name: "pvalues", label: "P-values", type: "textarea", rows: 3, required: true, placeholder: "0.01 0.04 0.03 0.005" }, ALPHA], ({ pvalues, alpha }) => {
        const p = pValueList(pvalues), m = p.length;
        const order = p.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value || x.index - y.index);
        const holm = new Array(m);
        let running = 0;
        order.forEach(({ value, index }, rank) => { running = Math.max(running, cap((m - rank) * value)); holm[index] = running; });
        const bonferroni = p.map((value) => cap(m * value));
        return { rows: [["Tests", m], [`Rejected by Bonferroni at α = ${alpha}`, bonferroni.filter((value) => value <= alpha).length],
          [`Rejected by Holm at α = ${alpha}`, holm.filter((value) => value <= alpha).length]],
        table: { columns: ["test", "p-value", "Bonferroni p", "Holm p", "rejected by Holm"], rows: p.map((value, i) => [i + 1, value, bonferroni[i], holm[i], holm[i] <= alpha ? "yes" : "no"]) } };
      }),
    tool("benjamini_hochberg", "Benjamini–Hochberg q-values", `Controls the false discovery rate across many comparisons: each q-value is the smallest FDR at which that test counts as a discovery. Assumes independent or positively dependent tests. ${LIST_FORMAT}`,
      [{ name: "pvalues", label: "P-values", type: "textarea", rows: 3, required: true, placeholder: "0.01 0.04 0.03 0.005" },
        { name: "fdr", label: "False discovery rate", type: "number", min: 0.0001, max: 0.5, default: 0.05 }], ({ pvalues, fdr }) => {
        const p = pValueList(pvalues), m = p.length;
        const order = p.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value || x.index - y.index);
        const q = new Array(m), rank = new Array(m);
        let running = 1;
        for (let r = m - 1; r >= 0; r--) {
          running = Math.min(running, cap(order[r].value * m / (r + 1)));
          q[order[r].index] = running;
          rank[order[r].index] = r + 1;
        }
        const found = p.filter((_, i) => q[i] <= fdr);
        return { rows: [["Tests", m], [`Discoveries at FDR ${fdr}`, found.length], ["Largest p-value among the discoveries", found.length ? Math.max(...found) : null]],
          table: { columns: ["test", "p-value", "rank", "q-value", "discovery"], rows: p.map((value, i) => [i + 1, value, rank[i], q[i], q[i] <= fdr ? "yes" : "no"]) } };
      }),
    tool("power_two_proportions", "Power of a two-rate comparison", "The chance that a two-proportion z test with this many items per arm detects a true difference between the two rates, by the normal approximation R's power.prop.test uses (the far tail ignored). Assumes independent trials and equal arms.",
      [share("p1", "Rate in A", "e.g. 0.5"), share("p2", "Rate in B", "e.g. 0.75"), count("n", "Items per arm", "e.g. 50", 2), ALPHA, SIDES], ({ p1, p2, n, alpha, sides }) => {
        if (p1 === p2) fail("The two rates are equal, so there is no difference to detect.");
        return [["Power (chance of a significant result)", proportionPower(p1, p2, n, alpha, sides)], ["Difference to detect", Math.abs(p1 - p2)], ["Items in total", 2 * n]];
      }),
    tool("ratio_measures", "Odds ratio and rate ratio", "Compares two variants' success rates as an odds ratio and as a rate ratio (relative risk), each with a log-scale (Woolf / Katz) interval and Wald p-value. When a cell is zero, 0.5 is added to every cell first. Assumes independent items.",
      [count("a", "A: successes", "e.g. 45"), count("b", "A: failures", "e.g. 55"), count("c", "B: successes", "e.g. 30"), count("d", "B: failures", "e.g. 70"), LEVEL],
      (params) => {
        if (params.a + params.b === 0 || params.c + params.d === 0) fail("Each variant needs at least one item.");
        const zero = [params.a, params.b, params.c, params.d].includes(0);
        const [a, b, c, d] = [params.a, params.b, params.c, params.d].map((value) => value + (zero ? 0.5 : 0));
        const z = zFor(params.level);
        const odds = (a * d) / (b * c), oddsSe = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
        const rate = (a / (a + b)) / (c / (c + d)), rateSe = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
        const pct = percent(params.level);
        return [["Odds ratio A ÷ B", odds], [`Odds ratio, lower ${pct} bound`, Math.exp(Math.log(odds) - z * oddsSe)], [`Odds ratio, upper ${pct} bound`, Math.exp(Math.log(odds) + z * oddsSe)],
          ["Odds ratio p-value (two-sided, Wald)", twoSidedZ(Math.log(odds) / oddsSe)],
          ["Rate ratio A ÷ B (relative risk)", rate], [`Rate ratio, lower ${pct} bound`, Math.exp(Math.log(rate) - z * rateSe)], [`Rate ratio, upper ${pct} bound`, Math.exp(Math.log(rate) + z * rateSe)],
          ["Rate ratio p-value (two-sided, Wald)", rateSe > 0 ? twoSidedZ(Math.log(rate) / rateSe) : null],
          ["Zero-cell correction", zero ? "added 0.5 to every cell" : "none"]];
      }),
    tool("number_needed", "Items per extra correct decision (NNT)", "One divided by the difference in success rates: how many items the new variant must handle to make one more correct decision than the current one (the number needed to treat). The interval inverts Newcombe's hybrid score interval for the difference; when that crosses zero the NNT interval runs through infinity. Assumes independent groups.",
      [...NEW_VS_CURRENT, LEVEL], (params) => {
        checkCounts(params, [["x1", "n1", "the new variant"], ["x2", "n2", "the current variant"]]);
        const { d, low, high } = newcombe(params.x1, params.n1, params.x2, params.n2, zFor(params.level));
        const nnt = d === 0 ? null : 1 / Math.abs(d);
        const fmt = (value) => String(Number(value.toPrecision(4)));
        const range = low > 0 ? `${fmt(1 / high)} to ${fmt(1 / low)} items per extra correct decision`
          : high < 0 ? `${fmt(1 / -low)} to ${fmt(1 / -high)} items per extra error`
            : `${high > 0 ? `${fmt(1 / high)} or more items per extra correct decision` : "no benefit"}, or ${low < 0 ? `${fmt(1 / -low)} or more items per extra error` : "no harm"}`;
        return [["Difference in success rate (new − current)", d], ["Direction", d > 0 ? "the new variant is better" : d < 0 ? "the new variant is worse" : "no difference"],
          ["Items per extra correct decision (or extra error when worse)", nnt], ["Rounded up", nnt === null ? null : ceilCount(nnt)],
          [`Lower ${percent(params.level)} bound for the difference`, low], [`Upper ${percent(params.level)} bound for the difference`, high], [`${percent(params.level)} interval for the NNT`, range]];
      }),
    tool("cohens_h", "Cohen's h for two rates", "The arcsine effect size of a difference between two rates, h = 2·asin√p1 − 2·asin√p2, with Cohen's rough reading (0.2 small, 0.5 medium, 0.8 large) and the items per arm a two-sided test at α = 0.05 needs for 80% power by the arcsine approximation.",
      [share("p1", "Rate in A", "e.g. 0.65"), share("p2", "Rate in B", "e.g. 0.45")], ({ p1, p2 }) => {
        const h = 2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p2));
        return [["Cohen's h", h], ["Size (Cohen's rough reading)", sizeReading(h)],
          ["Items per arm for 80% power at α = 0.05, two-sided", h === 0 ? null : ceilCount(((normalQuantile(0.975) + normalQuantile(0.8)) / h) ** 2)]];
      }),
    tool("goodness_of_fit", "Chi-square goodness of fit to expected shares", `Tests whether observed counts per category (for example labels per class) match expected shares. Leave the expected shares blank for equal shares; shares or counts are scaled to the total. Assumes independent items and expected counts of about 5 or more. ${LIST_FORMAT}`,
      [{ name: "observed", label: "Observed counts", type: "textarea", rows: 2, required: true, placeholder: "48 30 22" },
        { name: "expected", label: "Expected shares (blank for equal)", type: "textarea", rows: 2, placeholder: "0.5 0.3 0.2" }], ({ observed, expected }) => {
        const counts = numberList(observed, "Observed counts", 2);
        if (counts.some((value) => !Number.isInteger(value) || value < 0)) fail("Observed counts must be whole numbers 0 or more.");
        const weights = String(expected).trim() ? numberList(expected, "Expected shares") : counts.map(() => 1);
        if (weights.length !== counts.length) fail(`There are ${counts.length} observed counts but ${weights.length} expected shares.`);
        if (weights.some((value) => !(value > 0))) fail("Expected shares must all be above zero.");
        const total = counts.reduce((a, b) => a + b, 0), weightTotal = weights.reduce((a, b) => a + b, 0);
        if (total === 0) fail("Observed counts are all zero.");
        const exp = weights.map((value) => total * value / weightTotal);
        const parts = counts.map((value, i) => (value - exp[i]) ** 2 / exp[i]);
        const chi = parts.reduce((a, b) => a + b, 0);
        return { rows: [["Chi-square statistic", chi], ["Degrees of freedom", counts.length - 1], ["p-value", chiSquareSf(chi, counts.length - 1)], ["Smallest expected count", Math.min(...exp)]],
          table: { columns: ["category", "observed", "expected", "contribution to chi-square"], rows: counts.map((value, i) => [i + 1, value, exp[i], parts[i]]) } };
      }),
    tool("poisson_rate_comparison", "Compare two event rates", "Compares two event rates (for example errors per 1,000 items or per hour) with the exact conditional test: given the total events, A's share is binomial under equal rates (as R's poisson.test). Gives the rate ratio with its exact interval. Assumes events arrive independently at a constant rate.",
      [count("e1", "Events in A", "e.g. 11"), real("t1", "Exposure of A (items, hours, …)", "e.g. 800", { min: 0 }), count("e2", "Events in B", "e.g. 21"),
        real("t2", "Exposure of B, same unit", "e.g. 3011", { min: 0 }), LEVEL], ({ e1, t1, e2, t2, level }) => {
        if (!(t1 > 0) || !(t2 > 0)) fail("Both exposures must be above zero.");
        const k = e1 + e2;
        if (k === 0) fail("There are no events in either group.");
        if (k > 1e6) fail("The total number of events must be at most 1,000,000.");
        const share0 = t1 / (t1 + t2), tail = (1 - Number(level)) / 2;
        const ratio = (q) => q / (1 - q) * (t2 / t1);
        return [["Rate A (events per unit of exposure)", e1 / t1], ["Rate B (events per unit of exposure)", e2 / t2], ["Rate ratio A ÷ B", e2 === 0 ? null : (e1 / t1) / (e2 / t2)],
          ["Exact p-value (two-sided)", twoSidedExact(e1, 0, k, (j) => binomialPmf(j, k, share0))],
          [`Rate ratio, lower ${percent(level)} bound`, e1 === 0 ? 0 : ratio(betaQuantile(tail, e1, e2 + 1))],
          [`Rate ratio, upper ${percent(level)} bound`, e2 === 0 ? null : ratio(betaQuantile(1 - tail, e1 + 1, e2))]];
      }),
    tool("noninferiority", "Non-inferiority of a new variant's rate", "Tests whether a new variant's success rate is no worse than the current one's by more than a margin (H0: new − current ≤ −margin), with the one-sided Wald z test and its lower confidence bound. Assumes independent groups large enough for the normal approximation; for small groups check the Newcombe interval too.",
      [...NEW_VS_CURRENT, { name: "margin", label: "Margin (proportion, e.g. 0.02 for 2 points)", type: "number", min: 0.0001, max: 0.5, default: 0.02 }, ALPHA], (params) => {
        checkCounts(params, [["x1", "n1", "the new variant"], ["x2", "n2", "the current variant"]]);
        const { x1, n1, x2, n2, margin, alpha } = params;
        const p1 = x1 / n1, p2 = x2 / n2, d = p1 - p2, se = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
        if (!(se > 0)) fail("Both rates are 0 or 1, so the Wald standard error is zero; use the Newcombe interval instead.");
        const z = (d + margin) / se, bound = d - normalQuantile(1 - alpha) * se;
        return [["Difference new − current", d], ["Non-inferiority limit (−margin)", -margin], ["z statistic", z], ["p-value (one-sided)", normalSf(z)],
          [`One-sided ${confidence(1 - alpha)} lower bound for the difference`, bound], ["Verdict", bound > -margin ? "non-inferior at this margin" : "not shown to be non-inferior"]];
      }),
    tool("equivalence_tost", "Equivalence of two rates (TOST)", "Two one-sided tests of whether two success rates differ by less than a margin in either direction. The p-value is the larger of the two one-sided Wald p-values; equivalent when the 1 − 2α interval lies inside ±margin. Assumes independent groups large enough for the normal approximation.",
      [...NEW_VS_CURRENT, { name: "margin", label: "Margin (proportion, e.g. 0.02 for 2 points)", type: "number", min: 0.0001, max: 0.5, default: 0.02 }, ALPHA], (params) => {
        checkCounts(params, [["x1", "n1", "the new variant"], ["x2", "n2", "the current variant"]]);
        const { x1, n1, x2, n2, margin, alpha } = params;
        const p1 = x1 / n1, p2 = x2 / n2, d = p1 - p2, se = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
        if (!(se > 0)) fail("Both rates are 0 or 1, so the Wald standard error is zero; use the Newcombe interval instead.");
        const zLow = (d + margin) / se, zHigh = (margin - d) / se, q = normalQuantile(1 - alpha);
        const p = Math.max(normalSf(zLow), normalSf(zHigh));
        return [["Difference new − current", d], ["z against the lower limit", zLow], ["z against the upper limit", zHigh], ["p-value (TOST, larger of the two)", p],
          [`Lower bound of the ${confidence(1 - 2 * alpha)} interval`, d - q * se], [`Upper bound of the ${confidence(1 - 2 * alpha)} interval`, d + q * se], ["Verdict", p <= alpha ? "equivalent within the margin" : "not shown to be equivalent"]];
      }),
    tool("mcnemar_sample_size", "Items to compare two gates on the same items", "How many items to run through both gates for McNemar's test to detect a difference with the target power (Connor's 1987 formula), from the expected shares of items only A gets right and only B gets right. Assumes independent items.",
      [share("pb", "Expected share only A gets right", "e.g. 0.15"), share("pc", "Expected share only B gets right", "e.g. 0.05"), ALPHA, POWER], ({ pb, pc, alpha, power }) => {
        const psi = pb + pc, delta = pb - pc;
        if (psi > 1) fail("The two shares together cannot exceed 1.");
        if (delta === 0) fail("The two shares are equal, so there is no difference to detect.");
        const n = (normalQuantile(1 - alpha / 2) * Math.sqrt(psi) + normalQuantile(power) * Math.sqrt(psi - delta * delta)) ** 2 / (delta * delta);
        return [["Items (rounded up)", ceilCount(n)], ["Items (unrounded)", n], ["Expected items where only one gate is right", ceilCount(n) * psi]];
      }),
    tool("cochran_q", "Cochran's Q for several gates on the same items", `Tests whether several gates (or variants) have the same success rate when all run on the same items. Paste one row per item and one 0/1 column per gate (1 = correct). ${TABLE_FORMAT.replace("the counts", "the results")} Assumes independent items; it generalizes McNemar's test.`,
      [{ name: "table", label: "0/1 results (one row per item)", type: "textarea", rows: 6, required: true, placeholder: "1 1 0\n1 0 0\n1 1 1\n0 1 0" }], ({ table }) => {
        const rows = countTable(table, "Results");
        if (rows.flat().some((value) => value > 1)) fail("Results: use 1 for correct and 0 for wrong.");
        const k = rows[0].length, columns = rows[0].map((_, j) => rows.reduce((sum, row) => sum + row[j], 0));
        const totals = rows.map((row) => row.reduce((a, b) => a + b, 0)), all = totals.reduce((a, b) => a + b, 0);
        const denominator = k * all - totals.reduce((sum, value) => sum + value * value, 0);
        if (denominator === 0) fail("Every item has the same result for every gate, so the gates cannot be told apart.");
        const q = (k - 1) * (k * columns.reduce((sum, value) => sum + value * value, 0) - all * all) / denominator;
        return { rows: [["Items", rows.length], ["Gates", k], ["Cochran's Q", q], ["Degrees of freedom", k - 1], ["p-value", chiSquareSf(q, k - 1)]],
          table: { columns: ["gate", "successes", "success rate"], rows: columns.map((value, j) => [j + 1, value, value / rows.length]) } };
      }),
    tool("cohens_d", "Cohen's d and Hedges' g", "The standardized difference between two means (A − B over the pooled standard deviation), Hedges' small-sample correction g = d·(1 − 3/(4(n1 + n2) − 9)), and a large-sample interval for d. Assumes independent samples with roughly equal variances.",
      [...SUMMARY_TWO, LEVEL], ({ mean1, sd1, n1, mean2, sd2, n2, level }) => {
        const pooled = Math.sqrt(((n1 - 1) * sd1 * sd1 + (n2 - 1) * sd2 * sd2) / (n1 + n2 - 2));
        if (!(pooled > 0)) fail("Both standard deviations are zero, so the difference cannot be standardized.");
        const d = (mean1 - mean2) / pooled, se = Math.sqrt((n1 + n2) / (n1 * n2) + d * d / (2 * (n1 + n2))), z = zFor(level);
        return [["Pooled standard deviation", pooled], ["Cohen's d", d], ["Hedges' g", d * (1 - 3 / (4 * (n1 + n2) - 9))], ["Standard error of d", se],
          [`Lower ${percent(level)} bound for d`, d - z * se], [`Upper ${percent(level)} bound for d`, d + z * se], ["Size (Cohen's rough reading)", sizeReading(d)]];
      }),
    tool("statistic_to_p", "P-value from a z, t or chi-square statistic", "Turns a reported test statistic into its p-values: upper tail, lower tail and (for z and t) two-sided. Degrees of freedom are needed for t and chi-square and may be fractional. Assumes the statistic follows that distribution when there is no real difference.",
      [{ name: "distribution", label: "Distribution", type: "select", options: [["z", "Standard normal (z)"], ["t", "Student t"], ["chi2", "Chi-square"]] },
        real("statistic", "Statistic", "e.g. 2.1"), { name: "df", label: "Degrees of freedom (t and chi-square)", type: "number", min: 0.001, optional: true, placeholder: "e.g. 12" }],
      ({ distribution, statistic, df }) => {
        if (distribution === "z") return [["Upper-tail p-value P(Z ≥ z)", normalSf(statistic)], ["Lower-tail p-value P(Z ≤ z)", normalCdf(statistic)], ["Two-sided p-value", twoSidedZ(statistic)]];
        if (df === null) fail("Degrees of freedom are needed for t and chi-square.");
        if (distribution === "t") return [["Upper-tail p-value P(T ≥ t)", studentTSf(statistic, df)], ["Lower-tail p-value P(T ≤ t)", studentTCdf(statistic, df)], ["Two-sided p-value", twoSidedT(statistic, df)]];
        if (statistic < 0) fail("A chi-square statistic cannot be negative.");
        return [["Upper-tail p-value P(X ≥ x)", chiSquareSf(statistic, df)], ["Lower-tail p-value P(X ≤ x)", chiSquareCdf(statistic, df)]];
      }),
    tool("minimum_detectable_rate", "Smallest detectable improvement over a baseline rate", "The smallest rate above the baseline that a two-proportion z test with this many items per arm detects with the target power (solving R's power.prop.test formula). Assumes independent trials and equal arms.",
      [share("p2", "Baseline rate", "e.g. 0.8"), count("n", "Items per arm", "e.g. 500", 2), ALPHA, POWER, SIDES], ({ p2, n, alpha, power, sides }) => {
        if (p2 >= 1) fail("The baseline rate must be below 1.");
        const at = (p1) => proportionPower(p1, p2, n, alpha, sides) - power;
        let low = p2 + 1e-12, high = 1 - 1e-12;
        if (at(high) < 0) fail("Even a rate of 1 would not be detected with this many items; add items or lower the power.");
        for (let i = 0; i < 200 && high - low > 1e-15; i++) {
          const middle = (low + high) / 2;
          if (at(middle) < 0) low = middle; else high = middle;
        }
        return [["Smallest detectable rate", high], ["Smallest detectable difference", high - p2]];
      }),
    tool("combine_p_values", "Combine independent p-values", `Combines p-values from independent runs of the same comparison (for example separate evaluation batches) by Fisher's method (−2 Σ ln p against chi-square with 2k degrees of freedom) and Stouffer's method (Σ z / √k with one-sided p-values). Assumes the tests are independent and one-sided in the same direction for Stouffer. ${LIST_FORMAT}`,
      [{ name: "pvalues", label: "P-values", type: "textarea", rows: 3, required: true, placeholder: "0.08 0.11 0.04" }], ({ pvalues }) => {
        const p = pValueList(pvalues), k = p.length;
        if (p.some((value) => value === 0 || value === 1)) fail("P-values: Fisher's and Stouffer's methods need values strictly between 0 and 1.");
        const fisher = -2 * p.reduce((sum, value) => sum + Math.log(value), 0);
        const stouffer = p.reduce((sum, value) => sum + normalQuantile(1 - value), 0) / Math.sqrt(k);
        return [["P-values combined", k], ["Fisher's statistic −2 Σ ln p", fisher], ["Degrees of freedom", 2 * k], ["Fisher's combined p-value", chiSquareSf(fisher, 2 * k)],
          ["Stouffer's z", stouffer], ["Stouffer's combined p-value (one-sided)", normalSf(stouffer)]];
      }),
  ],
});
