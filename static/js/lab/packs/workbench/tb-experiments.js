// Toolbox: planning comparisons of variants and models — rows for uneven splits, many variants and paired designs,
// what a deadline can detect, sequential looks (Pocock, O'Brien–Fleming, Haybittle–Peto and alpha spending), multiple
// comparisons, lucky winners and holdouts. Every tool is pure: it reads only what is typed into its form, never page
// data, and never calls the model. Sizes and chances are plans from the typed rates, not measurements.
import { definePack, toNumber } from "../../kit.js";
import { binomialPmf, normalCdf, normalPdf, normalQuantile, normalSf } from "../../lib/math.js";

const GROUP = "Experiment planning";
const MAX_ROWS = 1e9;

// ---------- inputs ----------

const share = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });
const count = (name, label, extra = {}) => ({ name, label, type: "integer", min: 0, max: MAX_ROWS, ...extra });
const ALPHA = { name: "alpha", label: "Significance level (two-sided)", type: "select", options: [["0.05", "0.05"], ["0.01", "0.01"], ["0.1", "0.10"]] };
const POWER = { name: "power", label: "Power", type: "select", options: [["0.8", "80%"], ["0.9", "90%"], ["0.95", "95%"]] };
const LEVEL = { name: "level", label: "Confidence level", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]] };
const SHAPE = { name: "shape", label: "Boundary shape", type: "select", options: [["obf", "O'Brien–Fleming"], ["pocock", "Pocock"]] };
const LOOKS = (max, extra = {}) => count("looks", "Looks (equally spaced)", { min: 1, max, default: 5, ...extra });
const DISCORDANT = share("discordant", "Share of rows where exactly one variant is right", { default: 0.2 });

// ---------- helpers ----------

const fail = (message) => { throw new Error(message); };
const ceilCount = (x) => Math.ceil(x - 1e-9);
const zTwo = (alpha) => normalQuantile(1 - Number(alpha) / 2);
const zOf = (p) => normalQuantile(Number(p));
const short = (text) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);

function strictRate(value, label) {
  if (value <= 0 || value >= 1) fail(`${label} must be strictly between 0 and 1.`);
}

// Unrounded rows per arm for a two-sided two-proportion z test, Fleiss's formula with B given ratio × A's rows.
function rawRows(p1, p2, alpha, power, ratio = 1) {
  const pooled = (p1 + ratio * p2) / (1 + ratio), d = p2 - p1;
  return ((zTwo(alpha) * Math.sqrt(pooled * (1 - pooled) * (1 + 1 / ratio)) + zOf(power) * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2) / ratio)) / d) ** 2;
}
const rowsPerArm = (p1, p2, alpha, power) => ceilCount(rawRows(p1, p2, alpha, power));

// The root of a monotone f on [lo, hi] by bisection, f(lo) and f(hi) of opposite signs.
function bisect(f, lo, hi, steps = 100) {
  const rising = f(hi) > f(lo);
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if ((f(mid) < 0) === rising) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Simpson weights for m (odd) points spaced h apart.
const simpson = (m, h) => Array.from({ length: m }, (_, i) => (i === 0 || i === m - 1 ? 1 : i % 2 ? 4 : 2) * h / 3);

// Group sequential crossing chances. S(t) is Brownian motion with drift: S(t) ~ N(drift·t, t). The test stops at look
// k when |S(t_k)| >= b_k·√t_k (two-sided), which is |Z_k| >= b_k. The density of S on the continuation region is
// carried from look to look on a Simpson grid (Armitage, McPherson and Rowe's recursion). Returns the chance of first
// stopping at each look.
function makeGrid(times) {
  let previous = 0, smallest = Infinity;
  for (const t of times) { smallest = Math.min(smallest, Math.sqrt(t - previous)); previous = t; }
  return Math.min(0.05, smallest / 8);
}
function startLook(t, drift) {
  return { t, drift, points: null, weights: null, density: null };
}
// The chance of stopping at the next look at time t with boundary b, given the state carried from the previous look.
function crossChance(state, t, b) {
  const step = t - state.t, sd = Math.sqrt(step), mu = state.drift * step, edge = b * Math.sqrt(t);
  if (!state.points) return normalSf((edge - mu) / sd) + normalCdf((-edge - mu) / sd);
  let total = 0;
  state.points.forEach((s, i) => { total += state.weights[i] * state.density[i] * (normalSf((edge - s - mu) / sd) + normalCdf((-edge - s - mu) / sd)); });
  return total;
}
// Moves the density of S to the continuation region of a look at time t with boundary b.
function advance(state, t, b, h) {
  const step = t - state.t, sd = Math.sqrt(step), mu = state.drift * step, edge = b * Math.sqrt(t);
  const intervals = 2 * Math.max(16, Math.ceil(edge / h)), m = intervals + 1, spacing = 2 * edge / intervals;
  const points = Array.from({ length: m }, (_, j) => -edge + j * spacing), weights = simpson(m, spacing);
  const density = points.map((x) => {
    if (!state.points) return normalPdf((x - mu) / sd) / sd;
    let total = 0;
    for (let i = 0; i < state.points.length; i++) {
      const u = (x - state.points[i] - mu) / sd;
      total += state.mass[i] * Math.exp(-0.5 * u * u);
    }
    return total * INV_SQRT_2PI / sd;
  });
  return { t, drift: state.drift, points, weights, density, mass: density.map((value, i) => value * weights[i]) };
}
function stopChances(times, bounds, drift = 0) {
  const h = makeGrid(times);
  let state = startLook(0, drift);
  return times.map((t, k) => {
    const chance = crossChance(state, t, bounds[k]);
    if (k < times.length - 1) state = advance(state, t, bounds[k], h);
    return chance;
  });
}
const INV_SQRT_2PI = 0.3989422804014327;
const totalOf = (values) => values.reduce((sum, value) => sum + value, 0);

// Classic boundaries at K equally spaced looks for a two-sided significance level.
function classicBounds(K, alpha, shape) {
  const times = Array.from({ length: K }, (_, i) => (i + 1) / K);
  const make = {
    pocock: (c) => times.map(() => c),
    obf: (c) => times.map((t) => c / Math.sqrt(t)),
    hp: (c) => times.map((t, k) => (k === K - 1 ? c : 3)),
  }[shape];
  if (shape === "hp" && K > 1) {
    const interim = totalOf(stopChances(times.slice(0, -1), make(3).slice(0, -1)));
    if (interim >= alpha) fail("The interim looks at |z| ≥ 3 already spend the whole significance level; use fewer looks.");
  }
  const constant = K === 1 ? zTwo(alpha) : bisect((c) => totalOf(stopChances(times, make(c))) - alpha, 0.5, 8, 44);
  return { times, constant, bounds: make(constant) };
}

const SPENDING = {
  obf: (alpha, t) => 2 * normalSf(normalQuantile(1 - alpha / 2) / Math.sqrt(t)),
  pocock: (alpha, t) => alpha * Math.log(1 + (Math.E - 1) * t),
  linear: (alpha, t) => alpha * t,
};

function fractionList(text) {
  const cells = String(text ?? "").split(/[\s,;]+/).filter(Boolean);
  if (!cells.length) fail("Type at least one look as a fraction of the planned rows.");
  if (cells.length > 20) fail("Type at most 20 looks.");
  const list = cells.map((cell, index) => {
    const value = toNumber(cell);
    if (value === null || value < 0.01 || value > 1) fail(`Look ${index + 1} ("${short(cell)}") must be a fraction from 0.01 to 1.`);
    return value;
  });
  list.forEach((value, index) => { if (index && value - list[index - 1] < 0.01 - 1e-12) fail("Each look must come at least 0.01 after the one before."); });
  if (Math.abs(list[list.length - 1] - 1) > 1e-12) fail("The last look must be at 1 (all the planned rows).");
  return list;
}

// Binomial P[X = x] for x = 0..n.
const pmfList = (n, p) => Array.from({ length: n + 1 }, (_, x) => binomialPmf(x, n, p));
// P[X <= x], summed from the bottom (accurate for small values).
function cdfList(pmf) {
  let running = 0;
  return pmf.map((value) => Math.min(1, (running += value)));
}

// The chance the best of k variants (accuracy best, the others other, n rows each) comes out on top, ties split evenly:
// Σ_x P(best = x) · F(x)^(k−1) · (1 + r + … + r^(k−1)) / k with r = F(x − 1) / F(x), F the others' distribution function.
function correctSelection(k, best, other, n) {
  const top = pmfList(n, best), cdf = cdfList(pmfList(n, other));
  let total = 0;
  for (let x = 0; x <= n; x++) {
    const upper = cdf[x];
    if (upper <= 0) continue;
    const r = x > 0 ? cdf[x - 1] / upper : 0;
    let geometric = 0, power = 1;
    for (let j = 0; j < k; j++) { geometric += power; power *= r; }
    total += top[x] * upper ** (k - 1) * geometric / k;
  }
  return Math.min(1, total);
}

const tool = (id, title, help, inputs, compute) => ({ id, kind: "tool", group: GROUP, title, help, inputs, compute });

// ---------- tools ----------

export default definePack({
  id: "tb-experiments",
  surface: "workbench.toolbox",
  title: "Experiment planning tools",
  about: "Twenty calculators for planning comparisons of variants and models: rows for uneven splits, many variants and paired designs, the difference a deadline can detect, days to collect rows, Pocock, O'Brien–Fleming and alpha-spending looks, multiple comparisons, lucky winners and holdout size. They compute only from what you type; results are plans, not measurements.",
  features: [
    tool("unequal_split_rows", "Rows for a comparison with an uneven split",
      "Rows each of two variants needs for a two-sided two-proportion test to detect the difference with the chosen power when B gets a fixed multiple of A's rows (for example a cautious 1:4 rollout), and the extra rows the uneven split costs against an even one (Fleiss's formula; a ratio of 1 gives the even-split size).",
      [share("p1", "Rate of A", { default: 0.85 }), share("p2", "Rate of B", { default: 0.9 }), { name: "ratio", label: "Rows of B per row of A", type: "number", min: 0.01, max: 100, default: 4 }, ALPHA, POWER],
      ({ p1, p2, ratio, alpha, power }) => {
        if (p1 === p2) fail("The two rates must differ.");
        const raw = rawRows(p1, p2, alpha, power, ratio), a = ceilCount(raw), b = ceilCount(raw * ratio), even = 2 * rowsPerArm(p1, p2, alpha, power);
        return [["Rows for A", a], ["Rows for B", b], ["Rows in total", a + b], ["Rows in total with an even split", even], ["Extra rows for the uneven split", a + b - even]];
      }),
    tool("many_vs_control_rows", "Rows for several variants against one control",
      "Comparing k variants with one control splits the significance level across k tests (Bonferroni) and gives the control √k times each variant's rows, the allocation that suits many-to-one comparisons. Shows the rows each arm needs to detect the typed rate in a variant, against equal arms.",
      [share("control", "Rate of the control", { default: 0.85 }), share("variant", "Rate of a better variant", { default: 0.9 }), count("k", "Variants besides the control", { min: 1, max: 100, default: 3 }), ALPHA, POWER],
      ({ control, variant, k, alpha, power }) => {
        if (control === variant) fail("The two rates must differ.");
        const each = Number(alpha) / k, raw = rawRows(control, variant, each, power, 1 / Math.sqrt(k));
        const controlRows = ceilCount(raw), variantRows = ceilCount(raw / Math.sqrt(k)), equal = rowsPerArm(control, variant, each, power);
        return [["Significance per comparison", each], ["Rows for the control", controlRows], ["Rows per variant", variantRows], ["Rows in total", controlRows + k * variantRows],
          ["Rows in total with equal arms", (k + 1) * equal]];
      }),
    tool("paired_mde", "Smallest difference a paired comparison can detect",
      "When both variants answer the same rows, only rows where exactly one is right carry information (McNemar). From the rows and the share of such rows, the smallest difference in accuracy the test detects with the chosen power (Connor's normal approximation, solved for the difference).",
      [count("rows", "Rows both variants answer", { min: 1, default: 500 }), DISCORDANT, ALPHA, POWER], ({ rows, discordant, alpha, power }) => {
        strictRate(discordant, "The share of rows where exactly one is right");
        const za = zTwo(alpha), chance = (d) => normalCdf((d * Math.sqrt(rows) - za * Math.sqrt(discordant)) / Math.sqrt(discordant - d * d));
        const top = discordant * (1 - 1e-9), reachable = chance(top) >= Number(power);
        const d = reachable ? bisect((x) => chance(x) - Number(power), 1e-12, top) : null;
        return { rows: [["Smallest detectable difference", d], ["Rows where exactly one is right", rows * discordant], ["Share of those won by the better variant", d === null ? null : (discordant + d) / (2 * discordant)]],
          note: reachable ? null : "No difference is detectable with this many rows: add rows or lower the power." };
      }),
    tool("deadline_mde", "Detectable difference by a deadline",
      "With a daily volume split evenly between two variants, the smallest rise and fall from the baseline rate a two-sided test detects with the chosen power after each number of days (the even-split formula of Rows per variant, solved for the rate).",
      [share("baseline", "Baseline rate", { default: 0.85 }), { name: "volume", label: "Rows per day", type: "number", min: 0, max: MAX_ROWS, default: 200 }, share("traffic", "Share of traffic in the test", { default: 1 }),
        ALPHA, POWER, { name: "days", label: "Days to try", type: "text", required: true, default: "7, 14, 28", placeholder: "7, 14, 28" }], ({ baseline, volume, traffic, alpha, power, days }) => {
        strictRate(baseline, "The baseline rate");
        const list = String(days).split(/[\s,;]+/).filter(Boolean).map((cell, index) => {
          const value = toNumber(cell);
          if (value === null || value <= 0 || value > 36500) fail(`Day count ${index + 1} ("${short(cell)}") must be a number above 0 and at most 36,500.`);
          return value;
        });
        if (!list.length || list.length > 50) fail("Type between 1 and 50 day counts.");
        const smallest = (n, up) => {
          if (n < 2) return null;
          const end = up ? 1 : 0, gap = (p) => rawRows(baseline, p, alpha, power) - n;
          if (gap(end) > 0) return null;
          return Math.abs(bisect(gap, up ? baseline + 1e-12 : end, up ? end : baseline - 1e-12) - baseline);
        };
        return { table: { columns: ["Days", "Rows per variant", "Smallest detectable rise", "Smallest detectable fall"],
          rows: list.map((d) => { const n = Math.floor(volume * traffic * d / 2 + 1e-9); return [d, n, smallest(n, true), smallest(n, false)]; }) } };
      }),
    tool("collection_days", "Days to collect rows at a daily volume",
      "Days of traffic needed to collect the rows a comparison needs, when only a share of traffic enters the test and only a share of those rows gets labeled, optionally rounded up to whole weeks so every weekday is represented, with the day of each equally spaced look.",
      [count("rows", "Rows needed in total", { min: 1, default: 2000 }), { name: "volume", label: "Rows per day", type: "number", min: 0.001, max: MAX_ROWS, default: 300 },
        share("traffic", "Share of traffic in the test", { default: 1 }), share("labeled", "Share of those rows labeled", { default: 1 }), count("looks", "Looks", { min: 1, max: 20, default: 1 }),
        { name: "weeks", label: "Run whole weeks", type: "checkbox" }], ({ rows, volume, traffic, labeled, looks, weeks }) => {
        if (traffic <= 0 || labeled <= 0) fail("The shares must be above 0.");
        const rate = volume * traffic * labeled, raw = ceilCount(rows / rate), days = weeks ? Math.ceil(raw / 7) * 7 : raw;
        return { rows: [["Usable rows per day", rate], ["Days", days], ["Weeks", days / 7], ["Traffic seen in that time", days * volume]],
          table: { columns: ["Look", "Rows by then", "Day"], rows: Array.from({ length: looks }, (_, i) => { const by = ceilCount((i + 1) * rows / looks); return [i + 1, by, ceilCount(by / rate)]; }) } };
      }),
    tool("group_sequential", "Group sequential boundaries at k looks",
      "Boundaries for looking at a comparison k times, equally spaced, while keeping the two-sided significance level: Pocock uses the same |z| at every look, O'Brien–Fleming demands a lot early and about the fixed-design value at the end, and Haybittle–Peto stops early only at |z| ≥ 3. Computed by numerical integration of the joint distribution of the looks.",
      [LOOKS(20), ALPHA, { name: "shape", label: "Boundary shape", type: "select", options: [["obf", "O'Brien–Fleming"], ["pocock", "Pocock"], ["hp", "Haybittle–Peto"]] }], ({ looks, alpha, shape }) => {
        const level = Number(alpha), design = classicBounds(looks, level, shape), stops = stopChances(design.times, design.bounds);
        let spent = 0;
        return { rows: [["Boundary constant", design.constant], ["Final-look boundary", design.bounds[looks - 1]], ["Significance spent in all", totalOf(stops)]],
          table: { columns: ["Look", "Information fraction", "Boundary (|z| ≥)", "Nominal p at the look", "Significance spent by then"],
            rows: design.times.map((t, k) => [k + 1, t, design.bounds[k], 2 * normalSf(design.bounds[k]), (spent += stops[k])]) } };
      }),
    tool("alpha_spending", "Alpha-spending boundaries at chosen looks",
      "Lan–DeMets boundaries for looks at any fractions of the planned rows: a spending function sets how much of the two-sided significance level may be used by each look (O'Brien–Fleming type 2 − 2Φ(z_α/2 ÷ √t) of the two-sided level, as in Lan and DeMets 1983; Pocock type α·ln(1 + (e − 1)t); or linear α·t), and each symmetric two-sided boundary spends exactly that. Software that spends α/2 on each side with the one-sided function (gsDesign, ldbounds) gives stricter early O'Brien–Fleming-type boundaries. Type the looks as fractions, the last one 1.",
      [{ name: "fractions", label: "Looks as fractions of the planned rows", type: "text", required: true, default: "0.25, 0.5, 0.75, 1", placeholder: "0.25, 0.5, 0.75, 1" }, ALPHA,
        { name: "spending", label: "Spending function", type: "select", options: [["obf", "O'Brien–Fleming type"], ["pocock", "Pocock type"], ["linear", "Linear"]] }], ({ fractions, alpha, spending }) => {
        const times = fractionList(fractions), level = Number(alpha), spend = SPENDING[spending], h = makeGrid(times);
        let state = startLook(0, 0), before = 0;
        const out = times.map((t, k) => {
          const cumulative = Math.min(level, spend(level, t)), part = cumulative - before;
          const b = part <= 1e-300 ? 40 : bisect((z) => crossChance(state, t, z) - part, 0, 40, 100);
          if (k < times.length - 1) state = advance(state, t, b, h);
          before = cumulative;
          return [k + 1, t, cumulative, part, b, 2 * normalSf(b)];
        });
        return { table: { columns: ["Look", "Fraction", "Significance spent by then", "Spent at this look", "Boundary (|z| ≥)", "Nominal p"], rows: out } };
      }),
    tool("sequential_rows", "Rows for a sequential design with k looks",
      "Looking early costs rows at the end: the most rows per variant a group sequential design needs to keep the power of a fixed design of the typed size (the inflation factor), and the rows it uses on average when the planned difference is real and when there is none. Type the fixed-design rows from a calculation at the same significance level and power.",
      [count("rows", "Fixed-design rows per variant", { min: 1, default: 1000 }), LOOKS(20, { min: 2 }), ALPHA, POWER, SHAPE], ({ rows, looks, alpha, power, shape }) => {
        const level = Number(alpha), design = classicBounds(looks, level, shape), drift = zTwo(alpha) + zOf(power);
        const at = (R) => design.times.map((t) => t * R);
        const powerAt = (R) => totalOf(stopChances(at(R), design.bounds, drift));
        const R = bisect((x) => powerAt(x) - Number(power), 1, 3, 40), times = at(R);
        const real = stopChances(times, design.bounds, drift), none = stopChances(times, design.bounds, 0);
        const expected = (stops) => totalOf(stops.slice(0, -1).map((p, k) => p * times[k])) + (1 - totalOf(stops.slice(0, -1))) * times[looks - 1];
        return { rows: [["Inflation factor", R], ["Most rows per variant", ceilCount(rows * R)], ["Expected rows per variant if the difference is real", rows * expected(real)],
          ["Expected rows per variant if there is none", rows * expected(none)], ["Power", totalOf(real)]],
        table: { columns: ["Look", "Rows per variant by then", "Boundary (|z| ≥)", "Chance of stopping here if the difference is real"],
          rows: times.map((t, k) => [k + 1, ceilCount(rows * t), design.bounds[k], real[k]]) } };
      }),
    tool("peeking_error", "False win chance from peeking at every look",
      "How often a comparison of two equal variants is declared a win at some look when you test at the usual significance level every time you look (equally spaced looks), and the constant Pocock boundary that would keep the overall level.",
      [LOOKS(20), { ...ALPHA, label: "Significance level used at each look (two-sided)" }], ({ looks, alpha }) => {
        const level = Number(alpha), times = Array.from({ length: looks }, (_, i) => (i + 1) / looks), stops = stopChances(times, times.map(() => zTwo(level)));
        let running = 0;
        const total = totalOf(stops);
        return { rows: [["False win chance over all looks", total], ["Times the planned level", total / level], ["Boundary that keeps the level (Pocock)", classicBounds(looks, level, "pocock").constant]],
          table: { columns: ["Look", "False win chance by then"], rows: stops.map((p, k) => [k + 1, (running += p)]) } };
      }),
    tool("many_variants_fdr", "False discoveries when testing many variants",
      "When many variants are each tested against a control, some wins are flukes. From the share of variants that are truly better, the power and the significance level of each test: the real and false wins to expect, the false share of wins (ratio of expectations), and the chance of at least one false or real win, treating variants as independent.",
      [count("variants", "Variants tested", { min: 1, max: 100000, default: 20 }), share("better", "Share truly better", { default: 0.1 }), share("power", "Power of each test", { default: 0.8 }),
        share("alpha", "Significance level of each test", { default: 0.05 })], ({ variants, better, power, alpha }) => {
        const real = variants * better * power, fluke = variants * (1 - better) * alpha;
        return [["Expected real wins", real], ["Expected false wins", fluke], ["False share of wins", real + fluke > 0 ? fluke / (real + fluke) : null],
          ["Chance of at least one false win", 0 - Math.expm1(variants * Math.log1p(-(1 - better) * alpha))], ["Chance of at least one real win", 0 - Math.expm1(variants * Math.log1p(-better * power))]];
      }),
    tool("bonferroni_budget", "Bonferroni budget for many comparisons",
      "Splits a family-wide significance level across the comparisons you plan (every pair of variants, each variant against a control, or a typed number): the level each comparison gets (Bonferroni, and Šidák for independent tests), its two-sided z, how many more rows each comparison then needs than a single one, and the false win chance without any correction.",
      [count("k", "Variants (including any control)", { min: 2, max: 1000, default: 4 }),
        { name: "design", label: "Comparisons", type: "select", options: [["pairs", "Every pair of variants"], ["control", "Each variant against a control"], ["count", "A typed number"]] },
        { ...count("m", "Number of comparisons (for a typed number)", { min: 1, max: 1e6 }), optional: true }, { ...ALPHA, label: "Family-wide significance level (two-sided)" }, POWER],
      ({ k, design, m, alpha, power }) => {
        if (design === "count" && m === null) fail("Type the number of comparisons.");
        const comparisons = design === "pairs" ? k * (k - 1) / 2 : design === "control" ? k - 1 : m, level = Number(alpha), zb = zOf(power);
        const each = level / comparisons, z = zTwo(each);
        return [["Comparisons", comparisons], ["Significance per comparison (Bonferroni)", each], ["Significance per comparison (Šidák)", 0 - Math.expm1(Math.log1p(-level) / comparisons)],
          ["Two-sided z per comparison", z], ["Rows per comparison, times a single test's", ((z + zb) / (zTwo(level) + zb)) ** 2], ["False win chance with no correction", 0 - Math.expm1(comparisons * Math.log1p(-level))]];
      }),
    tool("lucky_win", "Chance of a lucky win among equal variants",
      "When k variants (one of them the control) all have the same true accuracy and each answers n rows, chance alone makes one look better. The exact binomial chance that some variant beats the control by more than the margin, the chance the best one measures more than the margin above the truth, and how far the best measured accuracy sits above the truth on average (the winner's curse).",
      [count("k", "Variants including the control", { min: 2, max: 100, default: 5 }), share("accuracy", "True accuracy of every variant", { default: 0.85 }),
        count("rows", "Rows per variant", { min: 1, max: 100000, default: 200 }), share("margin", "Margin", { default: 0.03 })], ({ k, accuracy, rows, margin }) => {
        const pmf = pmfList(rows, accuracy), tail = new Array(rows + 2).fill(0);
        for (let x = rows; x >= 0; x--) tail[x] = tail[x + 1] + pmf[x];   // P[X >= x]
        const notAll = (y, times) => (y >= rows ? 0 : 0 - Math.expm1(times * Math.log1p(-Math.min(1, tail[y + 1]))));   // 1 − F(y)^times
        const gap = Math.floor(margin * rows + 1e-9) + 1;
        let beats = 0, best = 0;
        for (let x = 0; x <= rows; x++) beats += pmf[x] * notAll(x + gap - 1, k - 1);
        for (let y = 0; y < rows; y++) best += notAll(y, k);
        return [["Chance some variant beats the control by more than the margin", Math.min(1, beats)],
          ["Chance the best measures more than the margin above the truth", notAll(Math.floor(rows * (accuracy + margin) + 1e-9), k)],
          ["Expected accuracy of the best variant as measured", best / rows], ["Winner's curse (best measured minus true)", best / rows - accuracy]];
      }),
    tool("correct_selection", "Chance the observed winner is truly best",
      "When one of k variants is truly better and the others are equal, the exact binomial chance that the truly best one measures highest on n rows each (ties split evenly), and the rows per variant that make that chance reach the level you want (found by halving between sizes; the exact chance wobbles slightly with n). Up to 20,000 rows per variant.",
      [count("k", "Variants", { min: 2, max: 50, default: 4 }), share("best", "Accuracy of the best variant", { default: 0.9 }), share("other", "Accuracy of the others", { default: 0.85 }),
        { ...count("rows", "Rows per variant (optional)", { min: 1, max: 20000 }), optional: true }, { name: "chance", label: "Chance wanted", type: "select", options: [["0.9", "90%"], ["0.95", "95%"], ["0.8", "80%"], ["0.99", "99%"]] }],
      ({ k, best, other, rows, chance }) => {
        if (best <= other) fail("The best variant's accuracy must be above the others'.");
        const target = Number(chance), at = (n) => correctSelection(k, best, other, n);
        let needed = null;
        if (at(20000) >= target) {
          let lo = 1, hi = 20000;
          while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (at(mid) >= target) hi = mid; else lo = mid + 1; }
          needed = lo;
        }
        return { rows: [["Chance the best variant comes out on top", rows === null ? null : at(rows)], ["Rows per variant for the chance wanted", needed], ["Rows in total", needed === null ? null : needed * k]],
          note: needed === null ? "Even 20,000 rows per variant do not reach the chance wanted." : null };
      }),
    tool("holdout_size", "Holdout share for a target interval width",
      "Keeping a holdout without the gate measures what the gate changes. From the rows in the period and the expected rates with and without the gate, the smallest holdout share whose interval for the difference is within ± the target (Wald interval), and the narrowest interval any split of these rows allows.",
      [count("rows", "Rows in the period", { min: 2, default: 20000 }), share("gated", "Expected rate with the gate", { default: 0.9 }), share("held", "Expected rate in the holdout", { default: 0.85 }),
        share("margin", "Target half-width for the difference", { default: 0.02 }), LEVEL], ({ rows, gated, held, margin, level }) => {
        strictRate(gated, "The rate with the gate"); strictRate(held, "The rate in the holdout");
        if (margin <= 0) fail("The target half-width must be above 0.");
        const z = zTwo(1 - Number(level)), a = gated * (1 - gated), b = held * (1 - held), W = rows * (margin / z) ** 2;
        const best = Math.sqrt(b) / (Math.sqrt(a) + Math.sqrt(b)), narrowest = z * (Math.sqrt(a) + Math.sqrt(b)) / Math.sqrt(rows);
        const disc = (W + b - a) ** 2 - 4 * W * b, h = disc < 0 || narrowest > margin ? null : ((W + b - a) - Math.sqrt(disc)) / (2 * W);
        const holdout = h === null ? null : Math.min(rows - 1, Math.max(1, ceilCount(h * rows)));
        return { rows: [["Smallest holdout share", h], ["Holdout rows", holdout], ["Rows with the gate", holdout === null ? null : rows - holdout],
          ["Half-width at that split", holdout === null ? null : z * Math.sqrt(a / (rows - holdout) + b / holdout)], ["Narrowest half-width possible", narrowest], ["Holdout share for the narrowest", best]],
        note: h === null ? "No split of these rows reaches the target: collect more rows or accept a wider interval." : null };
      }),
    tool("paired_precision", "Rows for a paired difference within a margin",
      "Rows to label so the difference between two variants answering the same rows is estimated within ± the margin, z²(ψ − d²) ÷ e² with ψ the share where exactly one is right, against the rows separate samples need for the same margin.",
      [share("p1", "Accuracy of A", { default: 0.85 }), share("p2", "Accuracy of B", { default: 0.9 }), DISCORDANT, share("margin", "Margin for the difference", { default: 0.02 }), LEVEL],
      ({ p1, p2, discordant, margin, level }) => {
        const d = p2 - p1;
        if (discordant < Math.abs(d)) fail("The share where exactly one is right cannot be below the difference.");
        if (margin <= 0) fail("The margin must be above 0.");
        const z = zTwo(1 - Number(level)), separate = ceilCount(z * z * (p1 * (1 - p1) + p2 * (1 - p2)) / (margin * margin));
        return [["Paired rows to label", ceilCount(z * z * (discordant - d * d) / (margin * margin))], ["Separate rows per variant", separate], ["Separate rows to label", 2 * separate]];
      }),
    tool("replication", "Chance a comparison holds up on new rows",
      "From the z statistic of a finished comparison: its two-sided p, the power of an identical repeat if the true difference is exactly what was seen, and (with no prior view on the difference) the chance a repeat points the same way and the chance it is significant the same way. A just-significant result repeats only about half the time.",
      [{ name: "z", label: "z statistic of the result", type: "number", min: -50, max: 50, default: 2.2 }, ALPHA], ({ z, alpha }) => {
        const za = zTwo(alpha), size = Math.abs(z);
        return [["Two-sided p of the result", 2 * normalSf(size)], ["Power of an exact repeat at the observed difference", normalCdf(size - za) + normalCdf(-size - za)],
          ["Chance a repeat points the same way", normalCdf(size / Math.SQRT2)], ["Chance a repeat is significant the same way", normalCdf((size - za) / Math.SQRT2)]];
      }),
    tool("shrink_difference", "Shrink a winning difference for the winner's curse",
      "A variant picked because it won usually measured luckier than it is. With a normal prior centred on no difference, whose spread is how large true differences between variants like these usually are, the measured difference shrinks by τ² ÷ (τ² + se²); gives the shrunk difference, its credible interval and the chance the true difference is above 0.",
      [{ name: "difference", label: "Measured difference (B − A)", type: "number", min: -1, max: 1, default: 0.03 }, { name: "se", label: "Its standard error", type: "number", min: 0.000001, max: 1, default: 0.015 },
        { name: "spread", label: "Typical size of true differences (prior spread)", type: "number", min: 0.000001, max: 1, default: 0.01 }, LEVEL], ({ difference, se, spread, level }) => {
        const factor = spread * spread / (spread * spread + se * se), centre = factor * difference, sd = Math.sqrt(factor) * se, z = zTwo(1 - Number(level));
        return [["Shrinkage factor", factor], ["Shrunk difference", centre], ["Lower end", centre - z * sd], ["Upper end", centre + z * sd], ["Chance the true difference is above 0", normalCdf(centre / sd)]];
      }),
    tool("conditional_power", "Conditional power at an interim look",
      "At an interim look with z statistic z (positive favours the new variant) after a share t of the planned rows, the chance the final two-sided test comes out significant in that direction if the current trend continues, if the planned difference is real, and if there is no difference: 1 − Φ((z_α − z√t − θ(1 − t)) ÷ √(1 − t)). Interim stopping boundaries are ignored.",
      [{ name: "z", label: "Interim z statistic", type: "number", min: -50, max: 50, default: 1.2 }, share("fraction", "Share of planned rows seen", { default: 0.5 }), ALPHA, { ...POWER, label: "Planned power" }],
      ({ z, fraction, alpha, power }) => {
        strictRate(fraction, "The share of planned rows seen");
        const za = zTwo(alpha), left = 1 - fraction, at = (drift) => normalSf((za - z * Math.sqrt(fraction) - drift * left) / Math.sqrt(left));
        return [["If the current trend continues", at(z / Math.sqrt(fraction))], ["If the planned difference is real", at(za + zOf(power))], ["If there is no difference", at(0)],
          ["Final z the trend points to", z / Math.sqrt(fraction)]];
      }),
    tool("diluted_rows", "Rows when a change affects only some rows",
      "A change that touches only some rows (a new wording for one kind of request, say) shifts the overall rate by only share × change. Compares the rows per variant needed when every row is analyzed with the rows needed when only the affected rows are, and the traffic it takes to collect those. Assumes the affected rows start from the same baseline rate as the rest.",
      [share("baseline", "Baseline rate", { default: 0.85 }), { name: "change", label: "Change among affected rows", type: "number", min: -1, max: 1, default: 0.05 }, share("affected", "Share of rows affected", { default: 0.2 }), ALPHA, POWER],
      ({ baseline, change, affected, alpha, power }) => {
        if (change === 0) fail("The change must not be 0.");
        if (affected <= 0) fail("The share of rows affected must be above 0.");
        if (baseline + change < 0 || baseline + change > 1) fail("The baseline plus the change must stay between 0 and 1.");
        const all = rowsPerArm(baseline, baseline + affected * change, alpha, power), only = rowsPerArm(baseline, baseline + change, alpha, power), traffic = ceilCount(only / affected);
        return [["Difference over all rows", affected * change], ["Rows per variant analyzing all rows", all], ["Affected rows per variant analyzing only them", only],
          ["Rows of traffic per variant to collect them", traffic], ["Traffic saved by analyzing only affected rows", all - traffic]];
      }),
    tool("noisy_label_rows", "Rows needed when labels are noisy",
      "Wrong labels shrink the measured difference between two variants. If each label is wrong with the typed chance, spread evenly over the other options, and the variants' mistakes also spread evenly, measured accuracy is ε ÷ (m − 1) + a(1 − εm ÷ (m − 1)); compares the rows per variant needed with clean and with these labels.",
      [share("p1", "True accuracy of A", { default: 0.85 }), share("p2", "True accuracy of B", { default: 0.9 }), share("noise", "Chance a label is wrong", { default: 0.05 }),
        count("options", "Options the question has", { min: 2, max: 10000, default: 4 }), ALPHA, POWER], ({ p1, p2, noise, options, alpha, power }) => {
        if (p1 === p2) fail("The two accuracies must differ.");
        const factor = 1 - noise * options / (options - 1);
        if (factor <= 0) fail("With this much label noise the labels carry no information.");
        const measured = (a) => noise / (options - 1) + a * factor, clean = rowsPerArm(p1, p2, alpha, power), noisy = rowsPerArm(measured(p1), measured(p2), alpha, power);
        return [["Measured accuracy of A", measured(p1)], ["Measured accuracy of B", measured(p2)], ["Difference shrinks to (share)", factor], ["Rows per variant with clean labels", clean],
          ["Rows per variant with these labels", noisy], ["Times the rows with clean labels", noisy / clean]];
      }),
  ],
});
