// Confidence intervals and sample sizes for planning and evaluating a gate in the Toolbox.
import { definePack } from "../../kit.js";

const G = {
  intervals: "Proportions and intervals",
  sizes: "Sample sizes",
};

// Two-sided normal quantiles for the confidence levels offered.
const Z = { 0.9: 1.6448536269514722, 0.95: 1.959963984540054, 0.99: 2.5758293035489004 };
const LEVEL = {
  name: "level",
  label: "Confidence",
  type: "select",
  options: [
    ["0.95", "95%"],
    ["0.9", "90%"],
    ["0.99", "99%"],
  ],
  default: "0.95",
};
const SHARE = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });
const COUNT = (name, label, extra = {}) => ({ name, label, type: "integer", min: 0, ...extra });

const pct = (level) => `${Math.round(Number(level) * 100)}%`;
const ceilSafe = (x) => Math.ceil(x - 1e-9);

function need(condition, message) {
  if (!condition) throw new Error(message);
}

// Wilson score interval for k of n.
function wilson(k, n, z) {
  const p = k / n,
    z2 = z * z,
    scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale;
  const half = (z / scale) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
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
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target === rising) lo = mid;
    else hi = mid;
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

export default definePack({
  id: "workbench-toolbox-starter",
  surface: "workbench.toolbox",
  title: "Gate planning tools",
  about: "Confidence intervals and sample sizes computed from the counts and rates you enter.",
  features: [
    // ---------- Proportions and intervals ----------
    {
      id: "wilson_interval",
      kind: "tool",
      group: G.intervals,
      title: "Wilson interval for a proportion",
      help: "The Wilson score interval around k successes in n trials, such as correct answers among labeled rows. It stays inside 0 to 1 and behaves well with few rows.",
      inputs: [COUNT("k", "Successes (k)"), COUNT("n", "Trials (n)", { min: 1 }), LEVEL],
      compute: ({ k, n, level }) => {
        counts(k, n);
        const [lower, upper] = wilson(k, n, Z[level]);
        return {
          rows: [
            ["Proportion", k / n],
            ["Lower bound", lower],
            ["Upper bound", upper],
            ["Interval width", upper - lower],
          ],
          note: `${pct(level)} Wilson score interval.`,
        };
      },
    },
    {
      id: "clopper_pearson",
      kind: "tool",
      group: G.intervals,
      title: "Exact (Clopper-Pearson) interval for a proportion",
      help: "The exact binomial interval around k successes in n trials. Wider than Wilson, but it never covers less than the level you choose. Up to 100,000 trials.",
      inputs: [COUNT("k", "Successes (k)"), COUNT("n", "Trials (n)", { min: 1, max: 100000 }), LEVEL],
      compute: ({ k, n, level }) => {
        counts(k, n);
        const [lower, upper] = clopperPearson(k, n, Number(level));
        return {
          rows: [
            ["Proportion", k / n],
            ["Lower bound", lower],
            ["Upper bound", upper],
          ],
          note: `${pct(level)} Clopper-Pearson interval.`,
        };
      },
    },
    {
      id: "zero_errors_bound",
      kind: "tool",
      group: G.intervals,
      title: "Error-rate bound when no errors were seen",
      help: "After checking n rows and finding no mistakes, the highest error rate still consistent with that at the chosen confidence (one-sided). The rule of three, 3 ÷ n, is the 95% shortcut.",
      inputs: [COUNT("n", "Rows checked, all correct", { min: 1 }), LEVEL],
      compute: ({ n, level }) => {
        const bound = 1 - (1 - Number(level)) ** (1 / n);
        return [
          ["Error rate is at most", bound],
          ["Accuracy is at least", 1 - bound],
          ["Shortcut: −ln(1 − confidence) ÷ n", -Math.log(1 - Number(level)) / n],
        ];
      },
    },
    {
      id: "newcombe_difference",
      kind: "tool",
      group: G.intervals,
      title: "Difference of two proportions (Newcombe interval)",
      help: "Compares two accuracies or rates measured on different rows, such as two question wordings, with Newcombe's hybrid score interval for the difference.",
      inputs: [
        COUNT("k1", "First: successes"),
        COUNT("n1", "First: trials", { min: 1 }),
        COUNT("k2", "Second: successes"),
        COUNT("n2", "Second: trials", { min: 1 }),
        LEVEL,
      ],
      compute: ({ k1, n1, k2, n2, level }) => {
        counts(k1, n1);
        counts(k2, n2);
        const z = Z[level],
          p1 = k1 / n1,
          p2 = k2 / n2;
        const [l1, u1] = wilson(k1, n1, z),
          [l2, u2] = wilson(k2, n2, z);
        const diff = p1 - p2;
        return {
          rows: [
            ["First proportion", p1],
            ["Second proportion", p2],
            ["Difference (first − second)", diff],
            ["Lower bound", diff - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)],
            ["Upper bound", diff + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)],
          ],
          note: `${pct(level)} interval. When it includes 0 the rows do not show a difference.`,
        };
      },
    },
    // ---------- Sample sizes ----------
    {
      id: "rows_for_margin",
      kind: "tool",
      group: G.sizes,
      title: "Rows to label for a margin of error",
      help: "How many labeled rows estimate an accuracy to within ± the margin. Use 0.5 for the expected proportion when you do not know it (the safe maximum). Give the population size to apply the finite population correction.",
      inputs: [
        SHARE("margin", "Margin of error (e.g. 0.05)"),
        SHARE("p", "Expected proportion", { default: 0.5 }),
        LEVEL,
        { name: "population", label: "Population size (optional)", type: "integer", min: 1, optional: true },
      ],
      compute: ({ margin, p, level, population }) => {
        need(margin > 0, "The margin must be above 0.");
        const n0 = (Z[level] ** 2 * p * (1 - p)) / (margin * margin);
        const corrected = population === null ? null : ceilSafe(n0 / (1 + (n0 - 1) / population));
        return [
          ["Rows needed", ceilSafe(n0)],
          ["With the population correction", corrected],
        ];
      },
    },
    {
      id: "margin_for_rows",
      kind: "tool",
      group: G.sizes,
      title: "Margin of error for a number of rows",
      help: "The ± margin an accuracy measured on n labeled rows carries (normal approximation). Give the population size to apply the finite population correction.",
      inputs: [
        COUNT("n", "Labeled rows", { min: 1 }),
        SHARE("p", "Measured or expected proportion", { default: 0.5 }),
        LEVEL,
        { name: "population", label: "Population size (optional)", type: "integer", min: 1, optional: true },
      ],
      compute: ({ n, p, level, population }) => {
        need(population === null || population >= n, "The population cannot be smaller than the rows.");
        const margin = Z[level] * Math.sqrt((p * (1 - p)) / n);
        return [
          ["Margin of error", margin],
          [
            "With the population correction",
            population === null ? null : population === 1 ? 0 : margin * Math.sqrt((population - n) / (population - 1)),
          ],
        ];
      },
    },
    {
      id: "rows_with_no_errors",
      kind: "tool",
      group: G.sizes,
      title: "Rows to audit with no errors allowed",
      help: "How many rows must all be right to show the error rate is below a target at the chosen confidence (one-sided).",
      inputs: [SHARE("rate", "Highest acceptable error rate (e.g. 0.01)"), LEVEL],
      compute: ({ rate, level }) => {
        need(rate > 0 && rate < 1, "The error rate must be between 0 and 1.");
        const alpha = 1 - Number(level);
        return [
          ["Rows that must all be right", ceilSafe(Math.log(alpha) / Math.log(1 - rate))],
          ["Shortcut: −ln(1 − confidence) ÷ rate", ceilSafe(-Math.log(alpha) / rate)],
        ];
      },
    },
  ],
});
