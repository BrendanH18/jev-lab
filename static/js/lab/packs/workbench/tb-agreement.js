// Toolbox: agreement between two or more human labelers. Every tool is pure: it reads only the label pairs, tables or
// numbers typed into its form, never page data or saved labels, and it never calls the model.
import { compareText, definePack, toNumber } from "../../kit.js";
import { chiSquareSf, normalQuantile, normalSf } from "../../lib/math.js";

const GROUP = "Agreement between labelers";
const MAX_COUNT = 1e9;
const MISSING = new Set(["", ".", "na", "n/a", "?", "-", "*", "null"]);

// ---------- inputs ----------

const FORMAT = { name: "format", label: "Pasted as", type: "select",
  options: [["pairs", "Label pairs, one item per line"], ["table", "Confusion table (rows labeler A, columns labeler B)"]] };
const DATA = { name: "data", label: "Labels or table", type: "textarea", rows: 8, required: true, placeholder: "refund,refund\nrefund,other\nother,other\nshipping,shipping" };
const HEADER = { name: "header", label: "First line is a header", type: "checkbox", default: false };
const TWO_RATERS = [FORMAT, DATA, HEADER];
const TWO_RATER_FORMAT = "Paste one item per line as two labels separated by a tab, semicolon, comma or spaces (labeler A first), or a square confusion table of counts with one row per line.";
const LEVEL = { name: "level", label: "Confidence level", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]] };
const UNITS = { name: "table", label: "Labels (one row per item, one column per labeler)", type: "textarea", rows: 8, required: true, placeholder: "1\t1\t2\n2\t2\t2\n3\t.\t3\n1\t2\t1" };
const UNITS_FORMAT = "Paste one row per item and one column per labeler, separated by tabs, semicolons, commas or spaces; mark a missing label with an empty cell (tab, semicolon or comma separated), ., NA, ? or *.";
const COUNTS = { name: "table", label: "Counts (one row per item, one column per category)", type: "textarea", rows: 8, required: true, placeholder: "0 0 3\n1 2 0\n0 3 0\n2 0 1" };
const CELLS = [
  { name: "a", label: "Both positive", type: "integer", min: 0, max: MAX_COUNT, placeholder: "e.g. 80" },
  { name: "b", label: "A positive, B negative", type: "integer", min: 0, max: MAX_COUNT, placeholder: "e.g. 5" },
  { name: "c", label: "A negative, B positive", type: "integer", min: 0, max: MAX_COUNT, placeholder: "e.g. 10" },
  { name: "d", label: "Both negative", type: "integer", min: 0, max: MAX_COUNT, placeholder: "e.g. 5" },
];
const CATEGORIES = { name: "categories", label: "Possible categories (blank = categories seen)", type: "integer", min: 2, max: 1000, optional: true };
const share = (name, label, extra = {}) => ({ name, label, type: "number", min: 0, max: 1, ...extra });

// ---------- helpers ----------

const fail = (message) => { throw new Error(message); };
const percent = (level) => `${Math.round(Number(level) * 100)}%`;
const zFor = (level) => normalQuantile(1 - (1 - Number(level)) / 2);
const short = (text) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);
const sumOf = (list) => list.reduce((a, b) => a + b, 0);
const ratio = (top, bottom) => (bottom > 0 ? top / bottom : null);
// top / bottom for a denominator of either sign; null when it is zero or the quotient is not finite.
const quotient = (top, bottom) => { const value = top / bottom; return Number.isFinite(value) ? value : null; };
const chanceCorrected = (observed, chance) => (chance < 1 ? (observed - chance) / (1 - chance) : null);
const ceilCount = (value) => Math.ceil(value - 1e-9);

// A label as typed, with numbers written one way ("1.0" and "1" are the same label); null for a missing mark.
function labelOf(cell) {
  const text = String(cell ?? "").trim();
  if (MISSING.has(text.toLowerCase())) return null;
  const number = toNumber(text);
  return number === null ? text : String(number);
}

// Labels in their natural order: numerically when every label is a number, otherwise alphabetically.
function orderLabels(labels) {
  const list = [...new Set(labels)];
  return list.every((label) => toNumber(label) !== null) ? list.sort((a, b) => Number(a) - Number(b)) : list.sort(compareText);
}

const nonBlankLines = (text) => String(text ?? "").split(/\r?\n/).map((line, index) => ({ line: line.replace(/\s+$/, ""), number: index + 1 })).filter(({ line }) => line.trim() !== "");

// The delimiter used throughout a pasted block: tab, then semicolon, then comma, else runs of spaces.
function splitterOf(lines) {
  const all = lines.map(({ line }) => line).join("\n");
  if (all.includes("\t")) return (line) => line.split("\t");
  if (all.includes(";")) return (line) => line.split(";");
  if (all.includes(",")) return (line) => line.split(",");
  return (line) => line.trim().split(/\s+/);
}

// A table of whole-number counts, rows by line (or semicolons), cells by commas, tabs or spaces.
function countTable(text, label, { square = false } = {}) {
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
  if (square && rows.length !== width) fail(`${label}: a confusion table needs as many rows as columns (it has ${rows.length} rows and ${width} columns).`);
  return rows;
}

// Two labelers' labels as a square confusion table { names, counts, total, values }: values are the categories'
// numbers when every label is a number (table positions 1..k for a pasted table), otherwise null.
function twoRaters({ format, data, header }) {
  if (format === "table") {
    const counts = countTable(header ? String(data ?? "").split(/\r?\n/).filter((line) => line.trim()).slice(1).join("\n") : data, "Confusion table", { square: true });
    const total = sumOf(counts.flat());
    if (total === 0) fail("Confusion table: every count is zero.");
    return { names: counts.map((_, i) => `category ${i + 1}`), counts, total, values: counts.map((_, i) => i + 1) };
  }
  let lines = nonBlankLines(data);
  if (header) lines = lines.slice(1);
  if (!lines.length) fail("Label pairs: paste at least one item.");
  const split = splitterOf(lines);
  const pairs = lines.map(({ line, number }) => {
    const cells = split(line).map(labelOf);
    if (cells.length !== 2 || cells.some((cell) => cell === null)) fail(`Label pairs: line ${number} needs exactly two labels, labeler A's then labeler B's.`);
    return cells;
  });
  const names = orderLabels(pairs.flat());
  if (names.length < 2) fail("Label pairs: both labelers used one and the same label for every item, so agreement beyond chance cannot be measured.");
  const index = new Map(names.map((name, i) => [name, i]));
  const counts = names.map(() => names.map(() => 0));
  for (const [a, b] of pairs) counts[index.get(a)][index.get(b)]++;
  const numeric = names.every((name) => toNumber(name) !== null);
  return { names, counts, total: pairs.length, values: numeric ? names.map(Number) : null };
}

// Observed and chance agreement of a confusion table, with Cohen's kappa and its standard errors (Fleiss, Cohen and
// Everitt 1969 for the estimate; the null standard error for the z test).
function kappaOf(counts) {
  const total = sumOf(counts.flat()), k = counts.length;
  const p = counts.map((row) => row.map((value) => value / total));
  const rows = p.map((row) => sumOf(row)), cols = p[0].map((_, j) => sumOf(p.map((row) => row[j])));
  const po = sumOf(p.map((row, i) => row[i])), pe = sumOf(rows.map((value, i) => value * cols[i]));
  const kappa = chanceCorrected(po, pe);
  let se = null, se0 = null;
  if (kappa !== null) {
    let diagonal = 0, off = 0;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        if (i === j) diagonal += p[i][i] * ((1 - pe) - (cols[i] + rows[i]) * (1 - po)) ** 2;
        else off += p[i][j] * (cols[i] + rows[j]) ** 2;
      }
    }
    const variance = (diagonal + (1 - po) ** 2 * off - (po * pe - 2 * pe + po) ** 2) / (total * (1 - pe) ** 4);
    se = Math.sqrt(Math.max(0, variance));
    const null0 = pe + pe * pe - sumOf(rows.map((value, i) => value * cols[i] * (value + cols[i])));
    se0 = Math.sqrt(Math.max(0, null0)) / ((1 - pe) * Math.sqrt(total));
  }
  return { total, p, rows, cols, po, pe, kappa, se, se0 };
}

// The Wilson score interval for x successes in n trials.
function wilson(x, n, z) {
  const p = x / n, z2 = z * z, scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale;
  const half = (z / scale) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// A units-by-labelers table of labels: { names (labelers), rows (labels or null per cell) }.
function unitTable(text, header, { minColumns = 2 } = {}) {
  const lines = nonBlankLines(text);
  const split = splitterOf(lines);
  let rows = lines.map(({ line }) => split(line));
  let names = null;
  if (header) {
    if (!rows.length) fail("Labels: the header line is missing.");
    names = rows[0].map((cell) => String(cell).trim());
    rows = rows.slice(1);
  }
  if (!rows.length) fail("Labels: paste at least one item row.");
  const width = Math.max(...rows.map((row) => row.length), names ? names.length : 0);
  if (width < minColumns) fail(`Labels: paste at least ${minColumns} columns.`);
  const cells = rows.map((row) => Array.from({ length: width }, (_, j) => labelOf(row[j])));
  const labelers = Array.from({ length: width }, (_, j) => (names && names[j] ? names[j] : `labeler ${j + 1}`));
  return { names: labelers, rows: cells };
}

function confusionOf(pairs) {
  const names = orderLabels(pairs.flat());
  const index = new Map(names.map((name, i) => [name, i]));
  const counts = names.map(() => names.map(() => 0));
  for (const [a, b] of pairs) counts[index.get(a)][index.get(b)]++;
  return counts;
}

// Fleiss-style count matrix checks: every item rated by the same number of raters, at least two.
function ratingCounts(text) {
  const counts = countTable(text, "Counts");
  const raters = sumOf(counts[0]);
  counts.forEach((row, i) => { if (sumOf(row) !== raters) fail(`Counts: row ${i + 1} adds up to ${sumOf(row)} labels but row 1 adds up to ${raters}; every item needs the same number of labelers.`); });
  if (raters < 2) fail("Counts: every item needs at least two labels.");
  const items = counts.length;
  const shares = counts[0].map((_, j) => sumOf(counts.map((row) => row[j])) / (items * raters));
  const observed = sumOf(counts.map((row) => (sumOf(row.map((x) => x * x)) - raters) / (raters * (raters - 1)))) / items;
  return { counts, raters, items, shares, observed };
}

// Solves a small linear system by Gaussian elimination with partial pivoting; null when it is singular.
function solve(matrix, vector) {
  const n = vector.length, a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

function landisKoch(kappa) {
  return kappa < 0 ? "poor (below chance)" : kappa <= 0.2 ? "slight" : kappa <= 0.4 ? "fair" : kappa <= 0.6 ? "moderate" : kappa <= 0.8 ? "substantial" : "almost perfect";
}

// ---------- tools ----------

const tool = (id, title, help, inputs, compute) => ({ id, kind: "tool", group: GROUP, title, help, inputs, compute });

export default definePack({
  id: "tb-agreement",
  surface: "workbench.toolbox",
  title: "Agreement between labelers",
  about: "Agreement statistics, tests and planning numbers for two or more human labelers, from pasted label pairs, confusion tables or items-by-labelers tables. Each tool computes only from what is typed into it, never from saved labels.",
  features: [
    tool("percent_agreement", "Percent agreement", `The share of items both labelers labeled the same, with a Wilson score interval. It ignores agreement expected by chance; see Cohen's kappa for that. ${TWO_RATER_FORMAT}`,
      [...TWO_RATERS, LEVEL], (params) => {
        const m = twoRaters(params);
        const agree = sumOf(m.counts.map((row, i) => row[i]));
        const [low, high] = wilson(agree, m.total, zFor(params.level));
        return [["Items", m.total], ["Items both labeled the same", agree], ["Agreement (share of items)", agree / m.total],
          [`Lower ${percent(params.level)} bound (Wilson)`, low], [`Upper ${percent(params.level)} bound (Wilson)`, high]];
      }),
    tool("cohens_kappa", "Cohen's kappa with standard error", `Agreement between two labelers beyond what their own label shares give by chance, with the large-sample standard error of Fleiss, Cohen and Everitt (1969), an interval, and a z test of kappa = 0. Assumes independent items and fixed labelers. ${TWO_RATER_FORMAT}`,
      [...TWO_RATERS, LEVEL], (params) => {
        const k = kappaOf(twoRaters(params).counts);
        if (k.kappa === null) fail("Both labelers used a single category for every item, so kappa is undefined.");
        const z = zFor(params.level), test = k.se0 > 0 ? k.kappa / k.se0 : null;
        return [["Items", k.total], ["Observed agreement", k.po], ["Chance agreement", k.pe], ["Cohen's kappa", k.kappa], ["Standard error", k.se],
          [`Lower ${percent(params.level)} bound`, k.kappa - z * k.se], [`Upper ${percent(params.level)} bound`, Math.min(1, k.kappa + z * k.se)],
          ["z statistic (kappa = 0)", test], ["p-value (two-sided)", test === null ? null : Math.min(1, 2 * normalSf(Math.abs(test)))]];
      }),
    tool("weighted_kappa", "Weighted kappa for ordered labels", `Kappa that gives partial credit to near misses on ordered labels such as Score levels: linear weights 1 − |i − j| / range and quadratic weights 1 − (i − j)² / range². Label pairs must be numbers (their values set the distances); a pasted table is taken as equally spaced categories in row order. ${TWO_RATER_FORMAT}`,
      TWO_RATERS, (params) => {
        const m = twoRaters(params);
        if (!m.values) fail("Weighted kappa needs numeric labels such as Score levels; paste a confusion table in order for other ordered labels.");
        const { p, rows, cols, kappa } = kappaOf(m.counts);
        const range = m.values[m.values.length - 1] - m.values[0];
        const weighted = (power) => {
          let observed = 0, chance = 0;
          m.values.forEach((vi, i) => m.values.forEach((vj, j) => {
            const w = 1 - (Math.abs(vi - vj) / range) ** power;
            observed += w * p[i][j];
            chance += w * rows[i] * cols[j];
          }));
          return chanceCorrected(observed, chance);
        };
        return [["Items", m.total], ["Linear weighted kappa", weighted(1)], ["Quadratic weighted kappa", weighted(2)], ["Unweighted kappa", kappa]];
      }),
    tool("scotts_pi", "Scott's pi", `Like Cohen's kappa, but chance agreement comes from the two labelers' pooled label shares, as if they shared one distribution. ${TWO_RATER_FORMAT}`,
      TWO_RATERS, (params) => {
        const { po, rows, cols, total } = kappaOf(twoRaters(params).counts);
        const chance = sumOf(rows.map((value, i) => ((value + cols[i]) / 2) ** 2));
        return [["Items", total], ["Observed agreement", po], ["Chance agreement (pooled shares)", chance], ["Scott's pi", chanceCorrected(po, chance)]];
      }),
    tool("fleiss_kappa", "Fleiss' kappa for several labelers", "Agreement among a fixed number of labelers per item (not necessarily the same people) from a count matrix: one row per item, one column per category, each cell the number of labelers who chose it. Gives each category's kappa and the z test of kappa = 0 (Fleiss, Nee and Landis 1979). Rows separated by new lines or semicolons; counts by commas, tabs or spaces.",
      [COUNTS], ({ table }) => {
        const { counts, raters, items, shares, observed } = ratingCounts(table);
        const chance = sumOf(shares.map((p) => p * p));
        const kappa = chanceCorrected(observed, chance);
        if (kappa === null) fail("Every label is in one category, so kappa is undefined.");
        const pq = shares.map((p) => p * (1 - p)), spread = sumOf(pq);
        const se0 = Math.sqrt(2) / (spread * Math.sqrt(items * raters * (raters - 1))) * Math.sqrt(Math.max(0, spread * spread - sumOf(pq.map((value, j) => value * (1 - 2 * shares[j])))));
        const categoryKappa = (j) => (pq[j] > 0 ? 1 - sumOf(counts.map((row) => row[j] * (raters - row[j]))) / (items * raters * (raters - 1) * pq[j]) : null);
        return { rows: [["Items", items], ["Labelers per item", raters], ["Mean observed agreement", observed], ["Chance agreement", chance], ["Fleiss' kappa", kappa],
          ["Standard error (kappa = 0)", se0], ["z statistic", ratio(kappa, se0)], ["p-value (two-sided)", se0 > 0 ? Math.min(1, 2 * normalSf(Math.abs(kappa / se0))) : null]],
        table: { columns: ["category", "share of labels", "kappa for this category"], rows: shares.map((p, j) => [j + 1, p, categoryKappa(j)]) } };
      }),
    tool("krippendorff_alpha", "Krippendorff's alpha", `Agreement among any number of labelers with missing labels allowed, at the nominal (categories), ordinal (ranked, such as Score levels) or interval (numeric distances) level. Items with fewer than two labels are left out. ${UNITS_FORMAT}`,
      [UNITS, { name: "level", label: "Level of measurement", type: "select", options: [["nominal", "Nominal (categories)"], ["ordinal", "Ordinal (ranked)"], ["interval", "Interval (numeric)"]] }, HEADER],
      ({ table, level, header }) => {
        const units = unitTable(table, header).rows.map((row) => row.filter((cell) => cell !== null)).filter((values) => values.length >= 2);
        if (!units.length) fail("Labels: no item has two or more labels.");
        const values = orderLabels(units.flat());
        if (level !== "nominal" && !values.every((value) => toNumber(value) !== null)) fail(`The ${level} level needs numeric labels.`);
        const index = new Map(values.map((value, i) => [value, i]));
        const o = values.map(() => values.map(() => 0));
        for (const unit of units) {
          for (let a = 0; a < unit.length; a++) for (let b = 0; b < unit.length; b++) if (a !== b) o[index.get(unit[a])][index.get(unit[b])] += 1 / (unit.length - 1);
        }
        const marginal = o.map((row) => sumOf(row)), n = sumOf(marginal);
        const delta = (c, k) => {
          if (level === "nominal") return c === k ? 0 : 1;
          if (level === "interval") return (Number(values[c]) - Number(values[k])) ** 2;
          const [low, high] = c < k ? [c, k] : [k, c];
          return (sumOf(marginal.slice(low, high + 1)) - (marginal[c] + marginal[k]) / 2) ** 2;
        };
        let observed = 0, expected = 0;
        values.forEach((_, c) => values.forEach((__, k) => { observed += o[c][k] * delta(c, k); expected += marginal[c] * marginal[k] * delta(c, k); }));
        observed /= n;
        expected /= n * (n - 1);
        if (!(expected > 0)) fail("Every label is the same, so expected disagreement is zero and alpha is undefined.");
        return [["Items with two or more labels", units.length], ["Pairable labels", n], ["Observed disagreement", observed], ["Expected disagreement", expected],
          ["Krippendorff's alpha", 1 - observed / expected]];
      }),
    tool("gwet_ac1", "Gwet's AC1", `A chance-corrected agreement for two labelers that stays stable when one category is very common (where kappa can drop sharply despite high agreement). Chance agreement is Σ π(1 − π) / (K − 1) over the pooled category shares π. ${TWO_RATER_FORMAT}`,
      [...TWO_RATERS, CATEGORIES], (params) => {
        const m = twoRaters(params);
        const { po, rows, cols } = kappaOf(m.counts);
        const used = params.categories ?? m.names.length;
        if (used < m.names.length) fail(`Possible categories must be at least the ${m.names.length} categories seen.`);
        const chance = sumOf(rows.map((value, i) => { const pi = (value + cols[i]) / 2; return pi * (1 - pi); })) / (used - 1);
        return [["Items", m.total], ["Observed agreement", po], ["Chance agreement (Gwet)", chance], ["Gwet's AC1", chanceCorrected(po, chance)]];
      }),
    tool("pabak", "Prevalence- and bias-adjusted kappa (PABAK)", "For a yes/no question labeled by two people: kappa next to PABAK = 2 × observed agreement − 1, with the prevalence index |a − d| / n and bias index |b − c| / n of Byrt, Bishop and Carlin (1993) that explain why the two differ.",
      CELLS, ({ a, b, c, d }) => {
        const n = a + b + c + d;
        if (n === 0) fail("Enter at least one item.");
        const { po, kappa } = kappaOf([[a, b], [c, d]]);
        return [["Items", n], ["Observed agreement", po], ["Cohen's kappa", kappa], ["Prevalence index |a − d| ÷ n", Math.abs(a - d) / n],
          ["Bias index |b − c| ÷ n", Math.abs(b - c) / n], ["PABAK (2 × observed agreement − 1)", 2 * po - 1]];
      }),
    tool("bennett_s", "Bennett's S (Brennan–Prediger)", `Chance-corrected agreement assuming every one of K categories is equally likely by chance: S = (K × observed − 1) / (K − 1). Set K when some possible categories were never used. ${TWO_RATER_FORMAT}`,
      [...TWO_RATERS, CATEGORIES], (params) => {
        const m = twoRaters(params);
        const used = params.categories ?? m.names.length;
        if (used < m.names.length) fail(`Possible categories must be at least the ${m.names.length} categories seen.`);
        const { po } = kappaOf(m.counts);
        return [["Observed agreement", po], ["Categories (K)", used], ["Chance agreement 1 ÷ K", 1 / used], ["Bennett's S", (used * po - 1) / (used - 1)]];
      }),
    tool("max_kappa", "Maximum kappa the label shares allow", `The highest kappa two labelers could reach given how often each used each category: when their shares differ, perfect agreement is impossible. Shows how much of that ceiling the observed kappa reaches. ${TWO_RATER_FORMAT}`,
      TWO_RATERS, (params) => {
        const { kappa, rows, cols, pe } = kappaOf(twoRaters(params).counts);
        if (kappa === null) fail("Both labelers used a single category for every item, so kappa is undefined.");
        const ceiling = sumOf(rows.map((value, i) => Math.min(value, cols[i])));
        const most = chanceCorrected(ceiling, pe);
        return [["Cohen's kappa", kappa], ["Highest agreement these shares allow", ceiling], ["Maximum kappa", most], ["Kappa as a share of its maximum", most > 0 ? kappa / most : null]];
      }),
    tool("per_category_agreement", "Agreement per category", `For each category: how often each labeler used it, how often both did on the same item, the specific agreement 2 × both ÷ (A + B), and kappa for that category against all the others. ${TWO_RATER_FORMAT}`,
      TWO_RATERS, (params) => {
        const m = twoRaters(params);
        const rows = m.counts.map((row) => sumOf(row)), cols = m.counts[0].map((_, j) => sumOf(m.counts.map((row) => row[j])));
        return { table: { columns: ["category", "labeler A", "labeler B", "both", "specific agreement", "kappa vs the rest"], rows: m.names.map((name, i) => {
          const both = m.counts[i][i];
          const oneVsRest = kappaOf([[both, rows[i] - both], [cols[i] - both, m.total - rows[i] - cols[i] + both]]).kappa;
          return [name, rows[i], cols[i], both, ratio(2 * both, rows[i] + cols[i]), oneVsRest];
        }) } };
      }),
    tool("disagreement_matrix", "Disagreement matrix", `Counts every combination of labeler A's and labeler B's labels (agreements on the diagonal) and names the most common disagreement (every one tied for most), so guidelines can target it. ${TWO_RATER_FORMAT}`,
      TWO_RATERS, (params) => {
        const m = twoRaters(params);
        let best = 0, tops = [], disagreements = 0;
        m.counts.forEach((row, i) => row.forEach((value, j) => {
          if (i === j || value === 0) return;
          disagreements += value;
          if (value > best) { best = value; tops = []; }
          if (value === best) tops.push(`${m.names[i]} (A) vs ${m.names[j]} (B)`);
        }));
        // Every combination tied for the most items is named, not just the first one found.
        const most = tops.length ? `${tops.join("; ")}: ${best} item${best === 1 ? "" : "s"}${tops.length > 1 ? " each" : ""}` : "none";
        const cols = m.counts[0].map((_, j) => sumOf(m.counts.map((row) => row[j])));
        return { rows: [["Items", m.total], ["Disagreements", disagreements], ["Most common disagreement", most]],
          table: { columns: ["labeler A \\ labeler B", ...m.names, "total"], rows: [...m.counts.map((row, i) => [m.names[i], ...row, sumOf(row)]), ["total", ...cols, m.total]] } };
      }),
    tool("positive_negative_agreement", "Positive and negative agreement", "For a yes/no question labeled by two people: positive agreement 2a / (2a + b + c) and negative agreement 2d / (2d + b + c) (Cicchetti and Feinstein 1990), which show whether agreement holds on both answers or only on the common one.",
      CELLS, ({ a, b, c, d }) => {
        const n = a + b + c + d;
        if (n === 0) fail("Enter at least one item.");
        return [["Positive agreement", ratio(2 * a, 2 * a + b + c)], ["Negative agreement", ratio(2 * d, 2 * d + b + c)], ["Observed agreement", (a + d) / n],
          ["Share of labels that are positive", (2 * a + b + c) / (2 * n)]];
      }),
    tool("kappa_reading", "Reading of a kappa value", "Puts a kappa (or another chance-corrected agreement) on the verbal scales of Landis and Koch (1977), Fleiss (1981) and Altman (1991). The bands are conventions, not tests.",
      [{ name: "kappa", label: "Kappa", type: "number", min: -1, max: 1, placeholder: "e.g. 0.62" }], ({ kappa }) => [
        ["Landis and Koch (1977)", landisKoch(kappa)],
        ["Fleiss (1981)", kappa < 0.4 ? "poor" : kappa <= 0.75 ? "fair to good" : "excellent"],
        ["Altman (1991)", kappa <= 0.2 ? "poor" : kappa <= 0.4 ? "fair" : kappa <= 0.6 ? "moderate" : kappa <= 0.8 ? "good" : "very good"]]),
    tool("spearman_brown", "Labelers needed for a target reliability", "The Spearman–Brown prophecy: how many labelers to average (or vote) per item to lift a single labeler's reliability to a target, R_m = m·r / (1 + (m − 1)·r). Assumes the extra labelers are as reliable as the first.",
      [{ name: "r", label: "Reliability of one labeler", type: "number", min: 0.0001, max: 0.9999, placeholder: "e.g. 0.6" },
        { name: "target", label: "Target reliability", type: "number", min: 0.0001, max: 0.9999, placeholder: "e.g. 0.8" },
        { name: "raters", label: "Labelers per item to project (optional)", type: "integer", min: 1, max: 1000, optional: true }], ({ r, target, raters }) => {
        const prophecy = (m) => m * r / (1 + (m - 1) * r);
        const needed = target * (1 - r) / (r * (1 - target)), rounded = Math.max(1, ceilCount(needed));
        const rows = [["Labelers needed (rounded up)", rounded], ["Labelers needed (unrounded)", needed], ["Reliability with that many", prophecy(rounded)]];
        if (raters !== null) rows.push([`Reliability with ${raters} labeler${raters === 1 ? "" : "s"}`, prophecy(raters)]);
        return rows;
      }),
    tool("kappa_sample_size", "Items to double-label for a kappa interval", "How many items two people must both label so that the confidence interval for Cohen's kappa on a yes/no question is no wider than you want. Uses the large-sample standard error at the expected kappa, assuming both labelers say yes at the same expected rate.",
      [{ name: "kappa", label: "Expected kappa", type: "number", min: 0, max: 0.99, placeholder: "e.g. 0.7" }, share("prevalence", "Expected share of yes labels", { placeholder: "e.g. 0.3" }),
        { name: "width", label: "Full interval width", type: "number", min: 0.01, max: 1, placeholder: "e.g. 0.2" }, LEVEL], ({ kappa, prevalence, width, level }) => {
        if (prevalence <= 0 || prevalence >= 1) fail("The expected share of yes labels must be strictly between 0 and 1.");
        const q = 1 - prevalence, agreeExtra = kappa * prevalence * q;
        const cells = [[prevalence * prevalence + agreeExtra, prevalence * q * (1 - kappa)], [prevalence * q * (1 - kappa), q * q + agreeExtra]];
        const perItem = kappaOf(cells).se ** 2;   // the expected cell shares stand for one item, so this is the variance per item
        const z = zFor(level), n = ceilCount((2 * z) ** 2 * perItem / (width * width));
        return [["Items to double-label (rounded up)", n], ["Standard error of kappa at that size", Math.sqrt(perItem / n)], ["Expected interval half-width", z * Math.sqrt(perItem / n)]];
      }),
    tool("compare_kappas", "Compare two kappas", "Tests whether two kappas from independent samples differ (for example before and after new labeling guidelines), from each kappa and its standard error, with an interval for the difference. Assumes the two samples share no items.",
      [{ name: "k1", label: "Kappa 1", type: "number", min: -1, max: 1, placeholder: "e.g. 0.72" }, { name: "se1", label: "Standard error 1", type: "number", min: 0, placeholder: "e.g. 0.05" },
        { name: "k2", label: "Kappa 2", type: "number", min: -1, max: 1, placeholder: "e.g. 0.58" }, { name: "se2", label: "Standard error 2", type: "number", min: 0, placeholder: "e.g. 0.06" }, LEVEL],
      ({ k1, se1, k2, se2, level }) => {
        const se = Math.sqrt(se1 * se1 + se2 * se2);
        if (!(se > 0)) fail("At least one standard error must be above zero.");
        const d = k1 - k2, z = zFor(level);
        return [["Difference kappa 1 − kappa 2", d], ["Standard error of the difference", se], ["z statistic", d / se], ["p-value (two-sided)", Math.min(1, 2 * normalSf(Math.abs(d / se)))],
          [`Lower ${percent(level)} bound`, d - z * se], [`Upper ${percent(level)} bound`, d + z * se]];
      }),
    tool("icc", "Intraclass correlation for numeric scores", `Agreement of numeric scores (for example 1 to 5 ratings) given by several labelers to the same items, as the six intraclass correlations of Shrout and Fleiss (1979), for one labeler and for the mean of all. Every cell must be a number. ${UNITS_FORMAT.replace(/; mark a missing.*$/, ".")}`,
      [{ ...UNITS, placeholder: "9 2 5 8\n6 1 3 2\n8 4 6 8" }, HEADER], ({ table, header }) => {
        const { rows } = unitTable(table, header);
        const values = rows.map((row, i) => row.map((cell, j) => {
          const value = cell === null ? null : toNumber(cell);
          if (value === null) fail(`Labels: item ${i + 1}, column ${j + 1} is not a number; every cell needs a score.`);
          return value;
        }));
        const n = values.length, k = values[0].length;
        if (n < 2) fail("Labels: paste at least two items.");
        const grand = sumOf(values.flat()) / (n * k);
        const rowMeans = values.map((row) => sumOf(row) / k), colMeans = values[0].map((_, j) => sumOf(values.map((row) => row[j])) / n);
        const total = sumOf(values.flat().map((value) => (value - grand) ** 2));
        const between = k * sumOf(rowMeans.map((value) => (value - grand) ** 2)), raters = n * sumOf(colMeans.map((value) => (value - grand) ** 2));
        const msr = between / (n - 1), msc = raters / (k - 1), mse = (total - between - raters) / ((n - 1) * (k - 1)), msw = (total - between) / (n * (k - 1));
        if (!(msr > 0)) fail("Every item has the same mean score, so the items cannot be told apart.");
        return [["Items", n], ["Labelers", k],
          ["ICC(1,1): one labeler, labelers differ per item", quotient(msr - msw, msr + (k - 1) * msw)],
          ["ICC(2,1): one labeler, absolute agreement", quotient(msr - mse, msr + (k - 1) * mse + k * (msc - mse) / n)],
          ["ICC(3,1): one labeler, consistency", quotient(msr - mse, msr + (k - 1) * mse)],
          ["ICC(1,k): mean of labelers, labelers differ per item", quotient(msr - msw, msr)],
          ["ICC(2,k): mean of labelers, absolute agreement", quotient(msr - mse, msr + (msc - mse) / n)],
          ["ICC(3,k): mean of labelers, consistency", quotient(msr - mse, msr)]];
      }),
    tool("light_kappa", "Light's kappa (mean pairwise kappa)", `Cohen's kappa for every pair of labelers, on the items both labeled, and their mean (Light 1971). Pairs whose kappa is undefined are left out of the mean. ${UNITS_FORMAT}`,
      [UNITS, HEADER], ({ table, header }) => {
        const { names, rows } = unitTable(table, header);
        const pairs = [];
        for (let a = 0; a < names.length; a++) {
          for (let b = a + 1; b < names.length; b++) {
            const both = rows.filter((row) => row[a] !== null && row[b] !== null).map((row) => [row[a], row[b]]);
            pairs.push([`${names[a]} and ${names[b]}`, both.length, both.length ? kappaOf(confusionOf(both)).kappa : null]);
          }
        }
        const defined = pairs.map(([, , kappa]) => kappa).filter((kappa) => kappa !== null);
        return { rows: [["Labeler pairs", pairs.length], ["Pairs with a defined kappa", defined.length], ["Light's kappa (mean of pairwise kappas)", defined.length ? sumOf(defined) / defined.length : null]],
          table: { columns: ["labeler pair", "items both labeled", "Cohen's kappa"], rows: pairs } };
      }),
    tool("bowker_symmetry", "Bowker's test of symmetry", `Tests whether two labelers' disagreements run equally in both directions (A says x where B says y as often as the reverse); for two categories it is McNemar's test without correction. Category pairs with no disagreements are left out of the degrees of freedom. ${TWO_RATER_FORMAT}`,
      TWO_RATERS, (params) => {
        const { counts } = twoRaters(params);
        let chi = 0, df = 0;
        for (let i = 0; i < counts.length; i++) {
          for (let j = i + 1; j < counts.length; j++) {
            const both = counts[i][j] + counts[j][i];
            if (both > 0) { chi += (counts[i][j] - counts[j][i]) ** 2 / both; df++; }
          }
        }
        if (df === 0) fail("The labelers never disagree, so there is nothing to test.");
        return [["Bowker chi-square", chi], ["Degrees of freedom", df], ["p-value", chiSquareSf(chi, df)]];
      }),
    tool("stuart_maxwell", "Stuart–Maxwell test of marginal homogeneity", `Tests whether two labelers use the categories at the same overall rates (one labeler leaning towards some labels). Categories with no disagreements are left out. Assumes independent items. ${TWO_RATER_FORMAT}`,
      TWO_RATERS, (params) => {
        const m = twoRaters(params);
        const k = m.counts.length;
        const rows = m.counts.map((row) => sumOf(row)), cols = m.counts[0].map((_, j) => sumOf(m.counts.map((row) => row[j])));
        const kept = [...Array(k).keys()].filter((i) => rows[i] + cols[i] - 2 * m.counts[i][i] > 0);
        // One category per connected group of disagreements is dropped, so the covariance matrix is invertible.
        const group = new Map();
        for (const start of kept) {
          if (group.has(start)) continue;
          const stack = [start];
          group.set(start, start);
          while (stack.length) {
            const i = stack.pop();
            for (const j of kept) if (!group.has(j) && m.counts[i][j] + m.counts[j][i] > 0) { group.set(j, start); stack.push(j); }
          }
        }
        const dropped = new Set([...new Set(group.values())]);
        const used = kept.filter((i) => !dropped.has(i));
        if (!used.length) fail("The labelers never disagree, so there is nothing to test.");
        const d = used.map((i) => rows[i] - cols[i]);
        const s = used.map((i) => used.map((j) => (i === j ? rows[i] + cols[i] - 2 * m.counts[i][i] : -(m.counts[i][j] + m.counts[j][i]))));
        const x = solve(s, d);
        if (x === null) fail("The disagreements leave the test undefined.");
        const chi = sumOf(d.map((value, i) => value * x[i]));
        return { rows: [["Stuart–Maxwell chi-square", chi], ["Degrees of freedom", used.length], ["p-value", chiSquareSf(chi, used.length)]],
          table: { columns: ["category", "labeler A", "labeler B", "difference A − B"], rows: m.names.map((name, i) => [name, rows[i], cols[i], rows[i] - cols[i]]) } };
      }),
    tool("consensus_labels", "Majority label per item", `For each item: the label most labelers chose, its votes and share, and whether the item is unanimous, a majority, a tie (ties list every top label, for a person to settle) or has only one label. Missing labels are skipped. ${UNITS_FORMAT}`,
      [UNITS, HEADER], ({ table, header }) => {
        const { rows } = unitTable(table, header, { minColumns: 1 });
        let unanimous = 0, ties = 0, agreementSum = 0, agreementItems = 0;
        const out = rows.map((row, i) => {
          const labels = row.filter((cell) => cell !== null);
          if (!labels.length) return [i + 1, 0, "", 0, null, "no labels"];
          const votes = new Map();
          for (const label of labels) votes.set(label, (votes.get(label) || 0) + 1);
          const most = Math.max(...votes.values());
          const top = orderLabels([...votes].filter(([, count]) => count === most).map(([label]) => label));
          const status = labels.length === 1 ? "one label" : votes.size === 1 ? "unanimous" : top.length > 1 ? "tie" : "majority";
          if (status === "unanimous") unanimous++;
          if (status === "tie") ties++;
          if (labels.length >= 2) {
            agreementSum += sumOf([...votes.values()].map((count) => count * (count - 1))) / (labels.length * (labels.length - 1));
            agreementItems++;
          }
          return [i + 1, labels.length, top.join(" / "), most, most / labels.length, status];
        });
        return { rows: [["Items", rows.length], ["Unanimous items", unanimous], ["Items with a tie for the top label", ties],
          ["Mean pairwise agreement per item", agreementItems ? agreementSum / agreementItems : null]],
        table: { columns: ["item", "labels", "majority label", "votes", "share", "status"], rows: out } };
      }),
    tool("target_kappa_agreement", "Agreement needed for a target kappa", "How much raw agreement two labelers need on a yes/no question to reach a target kappa, given how often each says yes. With a rare yes, a high raw agreement can still mean a low kappa. Assumes the yes rates stay as given.",
      [{ name: "kappa", label: "Target kappa", type: "number", min: -1, max: 1, placeholder: "e.g. 0.6" }, share("pa", "Share of yes labels from labeler A", { placeholder: "e.g. 0.1" }),
        share("pb", "Share of yes labels from labeler B (blank = same as A)", { optional: true })], ({ kappa, pa, pb }) => {
        const b = pb === null ? pa : pb;
        const chance = pa * b + (1 - pa) * (1 - b), needed = chance + kappa * (1 - chance);
        const ceiling = Math.min(pa, b) + Math.min(1 - pa, 1 - b);
        return [["Chance agreement", chance], ["Observed agreement needed", needed], ["Highest agreement these shares allow", ceiling],
          ["Reachable", needed <= ceiling + 1e-12 ? "yes" : "no: the yes rates differ too much"]];
      }),
    tool("gwet_ac1_raters", "Gwet's AC1 for several labelers", "Gwet's paradox-resistant agreement for a fixed number of labelers per item, from a count matrix: one row per item, one column per category (every possible category, used or not), each cell the number of labelers who chose it. Rows separated by new lines or semicolons; counts by commas, tabs or spaces.",
      [COUNTS], ({ table }) => {
        const { raters, items, shares, observed } = ratingCounts(table);
        const chance = sumOf(shares.map((p) => p * (1 - p))) / (shares.length - 1);
        return [["Items", items], ["Labelers per item", raters], ["Mean observed agreement", observed], ["Chance agreement (Gwet)", chance], ["Gwet's AC1", chanceCorrected(observed, chance)]];
      }),
    tool("labelers_vs_reference", "Each labeler against a reference", `Accuracy and Cohen's kappa of each labeler against reference labels (for example adjudicated ones) in the first column, on the items both have. ${UNITS_FORMAT}`,
      [{ ...UNITS, label: "Labels (first column the reference, then one column per labeler)", placeholder: "yes\tyes\tno\nno\tno\tno\nyes\tyes\tyes" }, HEADER], ({ table, header }) => {
        const { names, rows } = unitTable(table, header);
        const out = names.slice(1).map((name, offset) => {
          const j = offset + 1;
          const both = rows.filter((row) => row[0] !== null && row[j] !== null).map((row) => [row[0], row[j]]);
          const right = both.filter(([a, b]) => a === b).length;
          return [name, both.length, ratio(right, both.length), both.length ? kappaOf(confusionOf(both)).kappa : null];
        });
        const accuracies = out.map(([, , accuracy]) => accuracy).filter((value) => value !== null);
        return { rows: [["Labelers", out.length], ["Mean accuracy", accuracies.length ? sumOf(accuracies) / accuracies.length : null]],
          table: { columns: ["labeler", "items with both labels", "accuracy", "Cohen's kappa vs reference"], rows: out } };
      }),
  ],
});
