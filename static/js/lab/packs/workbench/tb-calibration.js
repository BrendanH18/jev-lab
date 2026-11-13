// Toolbox: calibration scores from pasted probability,outcome pairs (or confidence,correct pairs from a gate) and from
// pasted probability or logit vectors. Every tool is pure: it reads only what is typed or pasted into its form, never
// page data, and never calls the model. Fitted recalibrations are in-sample arithmetic on the pasted rows.
import { compareText, definePack, toNumber } from "../../kit.js";
import { chiSquareSf, normalQuantile, normalSf } from "../../lib/math.js";

const GROUP = "Calibration";
const MAX_ROWS = 200000;
const SUM_TOLERANCE = 0.02;
const LOGIT_CLIP = 1e-6;
const PAIR_FORMAT = "Paste probability,outcome pairs, one per line or several on a line, separated by commas, tabs, spaces or semicolons. "
  + "Outcomes are 1/0, yes/no, true/false or correct/wrong (for confidence,correct pairs, whether the answer was right); a first line with no number is skipped as a header.";
const VECTOR_FORMAT = "Paste one row per line: the right option, then a value for each option, separated by commas, tabs or semicolons. "
  + "A header line such as label,refund,exchange,other names the options and labels may then use those names (or positions, unless the names are numbers such as Score levels); otherwise a label is the option's position (1, 2, …).";
const PROBABILITY_VECTORS = `${VECTOR_FORMAT} Rows whose probabilities add up to within ${SUM_TOLERANCE} of 1 are rescaled to add up to 1.`;

const PAIRS = { name: "pairs", label: "Probability and outcome pairs", type: "textarea", rows: 8, required: true, placeholder: "probability,outcome\n0.92,1\n0.35,0\n0.71,1" };
const SCORE_PAIRS = { name: "pairs", label: "Score and outcome pairs", type: "textarea", rows: 8, required: true, placeholder: "score,outcome\n2.3,1\n-0.4,0\n1.1,1" };
const VECTORS = { name: "rows", label: "Label and probabilities, one row per line", type: "textarea", rows: 8, required: true, placeholder: "label,refund,exchange,other\nrefund,0.7,0.2,0.1\nother,0.3,0.3,0.4" };
const BINS = { name: "bins", label: "Bins", type: "integer", min: 1, max: 100, default: 10 };
const BINNING = { name: "binning", label: "Bins", type: "select", options: [["width", "equal width"], ["mass", "equal mass (about equal rows)"]], default: "width" };
const FEATURE = { name: "feature", label: "Fit on", type: "select", options: [["score", "the score as typed"], ["logodds", "the log-odds of the score (scores are probabilities)"]], default: "score" };

// ---------- parsing ----------

const OUTCOMES = new Map([["1", 1], ["0", 0], ["true", 1], ["false", 0], ["yes", 1], ["no", 0], ["y", 1], ["n", 0], ["correct", 1], ["incorrect", 0],
  ["right", 1], ["wrong", 0], ["pos", 1], ["neg", 0], ["positive", 1], ["negative", 0]]);
const shown = (cell) => (cell.length > 40 ? `${cell.slice(0, 40)}…` : cell);
const brief = (x) => String(Number(x.toPrecision(6)));

function outcomeOf(cell, where) {
  const key = cell.toLowerCase();
  if (OUTCOMES.has(key)) return OUTCOMES.get(key);
  const number = toNumber(key);
  if (number === 1 || number === 0) return number;
  throw new Error(`${where}: "${shown(cell)}" is not an outcome; use 1/0, yes/no, true/false or correct/wrong.`);
}

function numberOf(cell, where) {
  const value = toNumber(cell);
  if (value === null) throw new Error(`${where}: "${shown(cell)}" is not a number.`);
  return value;
}

function probabilityOf(cell, where) {
  const value = numberOf(cell, where);
  if (value < 0 || value > 1) throw new Error(`${where}: ${shown(cell)} is not a probability from 0 to 1.`);
  return value;
}

// Records of `width` values from pasted text, one or more per line. The first nonblank line is skipped as a header
// when none of its cells is a number.
function records(text, width, what, read) {
  const out = [];
  let first = true;
  String(text ?? "").split(/\r\n|\n|\r/).forEach((line, index) => {
    const cells = line.trim().split(/[\s,;]+/).filter(Boolean);
    if (!cells.length) return;
    const header = first && cells.every((cell) => toNumber(cell) === null);
    first = false;
    if (header) return;
    if (cells.length % width) throw new Error(`Line ${index + 1}: expected ${what}s of ${width} values, found ${cells.length} value${cells.length === 1 ? "" : "s"}.`);
    for (let at = 0; at < cells.length; at += width) {
      if (out.length >= MAX_ROWS) throw new Error(`Paste at most ${MAX_ROWS.toLocaleString("en-US")} ${what}s.`);
      out.push(read(cells.slice(at, at + width), cells.length > width ? `Line ${index + 1}, ${what} ${at / width + 1}` : `Line ${index + 1}`));
    }
  });
  if (!out.length) throw new Error(`Paste at least one ${what}.`);
  return out;
}

function parsePairs(text, { anyScore = false } = {}) {
  const rows = records(text, 2, "pair", ([a, b], where) => [anyScore ? numberOf(a, where) : probabilityOf(a, where), outcomeOf(b, where)]);
  const p = rows.map((row) => row[0]), y = rows.map((row) => row[1]);
  const positives = y.reduce((total, value) => total + value, 0);
  return { p, y, n: rows.length, positives, negatives: rows.length - positives };
}

function needBoth(data) {
  if (!data.positives || !data.negatives) throw new Error("Paste at least one row with each outcome (1 and 0).");
  return data;
}

// One line's cells: split on its first delimiter found among tab, semicolon and comma, else on spaces.
function splitCells(line) {
  for (const delimiter of ["\t", ";", ","]) if (line.includes(delimiter)) return line.split(delimiter).map((cell) => cell.trim());
  return line.trim().split(/\s+/);
}

const isWhole = (cell) => { const value = toNumber(cell); return value !== null && Number.isInteger(value); };
const isVector = (values) => values.every((value) => value !== null && value >= 0 && value <= 1) && Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= SUM_TOLERANCE;

function labelIndex(cell, options, k, where) {
  if (options) {
    const index = options.indexOf(cell);
    if (index >= 0) return index;
    // Options named by numbers (Score levels 0, 1, 2) would make a position ambiguous, so only their names count.
    if (options.some(isWhole)) throw new Error(`${where}: "${shown(cell)}" is not an option named on the header line (${options.join(", ")}).`);
  }
  const position = toNumber(cell);
  if (position !== null && Number.isInteger(position) && position >= 1 && position <= k) return position - 1;
  throw new Error(options ? `${where}: "${shown(cell)}" is neither an option named on the header line (${options.join(", ")}) nor a position from 1 to ${k}.`
    : `${where}: "${shown(cell)}" is not an option position from 1 to ${k}; add a header line to use option names.`);
}

// Rows of a label and one value per option: { options, rows: [{ label, values }], rescaled }. With logits the values
// are any numbers; otherwise each is a probability and the row adds up to 1 (within SUM_TOLERANCE, then rescaled).
function parseVectors(text, { logits = false, labeled = true } = {}) {
  const lines = String(text ?? "").split(/\r\n|\n|\r/);
  const noun = logits ? "logits" : "probabilities";
  const skip = labeled ? 1 : 0;
  let options = null, k = null, rescaled = 0;
  const rows = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const where = `Line ${index + 1}`;
    const cells = splitCells(line);
    if (k === null) {
      const values = cells.slice(skip).map(toNumber);
      // Distinct whole numbers after a label that is not a position name the options (level,0,1,2), not one row's values.
      const numberNames = values.length >= 2 && cells.slice(skip).every(isWhole) && new Set(values).size === values.length;
      const data = labeled ? isWhole(cells[0]) || (!numberNames && values.every((value) => value !== null) && (logits || isVector(values))) : values.every((value) => value !== null);
      if (!data) {
        options = cells.slice(skip);
        if (options.length < 2 || options.some((option) => !option)) throw new Error(`${where}: a header line needs ${labeled ? "a label column and " : ""}at least two option names.`);
        const twice = options.find((option, at) => options.indexOf(option) !== at);
        if (twice !== undefined) throw new Error(`${where}: the option "${shown(twice)}" is named twice.`);
        k = options.length;
        return;
      }
      k = cells.length - skip;
      if (k < 2) throw new Error(`${where}: expected ${labeled ? "a label and " : ""}at least two ${noun}.`);
    }
    if (cells.length !== k + skip) throw new Error(`${where}: expected ${labeled ? "a label and " : ""}${k} ${noun}, found ${cells.length} value${cells.length === 1 ? "" : "s"}.`);
    const label = labeled ? labelIndex(cells[0], options, k, where) : null;
    let values = cells.slice(skip).map((cell) => (logits ? numberOf(cell, where) : probabilityOf(cell, where)));
    if (!logits) {
      const total = values.reduce((a, b) => a + b, 0);
      if (Math.abs(total - 1) > SUM_TOLERANCE) throw new Error(`${where}: the probabilities add up to ${brief(total)}, not 1.`);
      if (Math.abs(total - 1) > 1e-12) { rescaled++; values = values.map((value) => value / total); }
    }
    if (rows.length >= MAX_ROWS) throw new Error(`Paste at most ${MAX_ROWS.toLocaleString("en-US")} rows.`);
    rows.push({ label, values });
  });
  if (!rows.length) throw new Error(`Paste at least one row. ${VECTOR_FORMAT}`);
  return { options: options || Array.from({ length: k }, (_, i) => String(i + 1)), rows, rescaled };
}

const rescaledNote = (data) => (data.rescaled ? `${data.rescaled} row${data.rescaled === 1 ? "'s" : "s'"} probabilities were rescaled to add up to exactly 1.` : null);

// ---------- numerics ----------

const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const softplus = (z) => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));
const logOdds = (p) => Math.log(p) - Math.log1p(-p);
const clip = (p, eps) => Math.min(1 - eps, Math.max(eps, p));
const ratio = (top, bottom) => (bottom > 0 ? top / bottom : null);
const zFor = (level) => normalQuantile(1 - (1 - level) / 2);

function wilson(k, n, z) {
  if (!n) return [null, null];
  const p = k / n, z2 = z * z, scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale, half = (z / scale) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Mean log loss (nats) of probability p for outcome y, with p clipped to [eps, 1 − eps]; Infinity for a sure miss.
function logLoss(p, y, eps) {
  let total = 0;
  p.forEach((value, i) => { const q = clip(value, eps); total -= y[i] ? Math.log(q) : Math.log1p(-q); });
  return total / p.length;
}

// Equal-width bins over [0, 1]: bin i holds [i/B, (i+1)/B), the last also 1. Nonempty bins only.
function widthBins(p, y, count) {
  const bins = Array.from({ length: count }, (_, i) => ({ lo: i / count, hi: (i + 1) / count, n: 0, sp: 0, sy: 0 }));
  p.forEach((value, i) => { const bin = bins[Math.min(count - 1, Math.floor(value * count + 1e-9))]; bin.n++; bin.sp += value; bin.sy += y[i]; });
  return bins.filter((bin) => bin.n);
}

// Bins of about equal size by sorted probability: the run of equal probabilities starting at sorted position i goes
// whole into bin floor(i·B / n), so ties never split. lo/hi are the lowest and highest probability in the bin.
function massBins(p, y, count) {
  const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const bins = [];
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && p[order[j]] === p[order[i]]) j++;
    const index = Math.min(count - 1, Math.floor(i * count / order.length));
    let bin = bins[bins.length - 1];
    if (!bin || bin.index !== index) bins.push(bin = { index, lo: p[order[i]], hi: p[order[i]], n: 0, sp: 0, sy: 0 });
    for (let t = i; t < j; t++) { bin.n++; bin.sp += p[order[t]]; bin.sy += y[order[t]]; }
    bin.hi = p[order[j - 1]];
    i = j;
  }
  return bins;
}

const binsOf = (data, binning, count) => (binning === "mass" ? massBins(data.p, data.y, count) : widthBins(data.p, data.y, count));
const eceOf = (bins, n) => bins.reduce((total, bin) => total + Math.abs(bin.sy - bin.sp), 0) / n;

// Maximum-likelihood logistic regression of soft targets t on x: P = σ(a + b·x). Newton steps with step halving.
// null when the fit does not converge (for example when the outcomes are separated by x).
function fitLogistic(x, t) {
  const n = x.length;
  const loss = (a, b) => x.reduce((total, xi, i) => { const z = a + b * xi; return total + softplus(z) - t[i] * z; }, 0);
  let a = 0, b = 0, current = loss(a, b);
  for (let iteration = 0; iteration < 200; iteration++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    x.forEach((xi, i) => {
      const s = sigmoid(a + b * xi), w = s * (1 - s), r = s - t[i];
      ga += r; gb += r * xi; haa += w; hab += w * xi; hbb += w * xi * xi;
    });
    const det = haa * hbb - hab * hab;
    if (!(det > 1e-300)) return null;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    let step = 1, next = loss(a - da, b - db);
    while (!(next <= current + 1e-12 * Math.max(1, Math.abs(current))) && step > 1e-12) { step /= 2; next = loss(a - step * da, b - step * db); }
    a -= step * da; b -= step * db; current = next;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (Math.max(Math.abs(step * da), Math.abs(step * db)) < 1e-13 * Math.max(1, Math.abs(a), Math.abs(b))
      && Math.abs(ga) + Math.abs(gb) < 1e-8 * Math.max(1, n)) return { a, b };
  }
  return null;
}

// Whether 0/1 outcomes are (quasi-)separated by x, in which case a logistic fit has no finite slope.
function separated(x, y) {
  let max0 = -Infinity, min0 = Infinity, max1 = -Infinity, min1 = Infinity;
  x.forEach((xi, i) => { if (y[i]) { max1 = Math.max(max1, xi); min1 = Math.min(min1, xi); } else { max0 = Math.max(max0, xi); min0 = Math.min(min0, xi); } });
  return max0 <= min1 || max1 <= min0;
}

// The a solving Σ σ(a + x_i) = target for 0 < target < n (bisection; the left side rises with a).
function solveOffset(x, target) {
  let lo = -1000, hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (x.reduce((total, xi) => total + sigmoid(mid + xi), 0) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function clippedLogOdds(p) {
  let clipped = 0;
  const x = p.map((value) => { const q = clip(value, LOGIT_CLIP); if (q !== value) clipped++; return logOdds(q); });
  return { x, clipped, note: clipped ? `${clipped} probabilit${clipped === 1 ? "y" : "ies"} of 0 or 1 were moved ${LOGIT_CLIP} inside the range so their log-odds are finite.` : null };
}

// Pool adjacent violators over distinct scores: blocks { lo, hi, n, positives } with strictly rising rates.
function isotonicBlocks(scores, y) {
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const blocks = [];
  for (let i = 0; i < order.length;) {
    const block = { lo: scores[order[i]], hi: scores[order[i]], n: 0, positives: 0 };
    while (i < order.length && scores[order[i]] === block.lo) { block.n++; block.positives += y[order[i]]; i++; }
    blocks.push(block);
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1], before = blocks[blocks.length - 2];
      if (before.positives * last.n < last.positives * before.n) break;
      blocks.splice(-2, 2, { lo: before.lo, hi: last.hi, n: before.n + last.n, positives: before.positives + last.positives });
    }
  }
  return blocks;
}

function softmax(values, beta = 1) {
  const top = Math.max(...values.map((value) => value * beta));
  const exps = values.map((value) => Math.exp(value * beta - top));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((value) => value / total);
}

function temperatureLoss(rows, beta) {
  return rows.reduce((total, row) => {
    const scaled = row.values.map((value) => value * beta), top = Math.max(...scaled);
    return total + top + Math.log(scaled.reduce((sum, value) => sum + Math.exp(value - top), 0)) - scaled[row.label];
  }, 0) / rows.length;
}

// d/dβ of the mean log loss of softmax(β·z): mean of (expected logit − label's logit). It rises with β.
const temperatureSlope = (rows, beta) => rows.reduce((total, row) => {
  const q = softmax(row.values, beta);
  return total + q.reduce((sum, value, k) => sum + value * row.values[k], 0) - row.values[row.label];
}, 0) / rows.length;

const finite = (value) => (Number.isFinite(value) ? value : null);
const topIndex = (values) => values.reduce((best, value, k) => (value > values[best] ? k : best), 0);

function scoresList(text, read) {
  const out = [];
  let first = true;
  String(text ?? "").split(/\r\n|\n|\r/).forEach((line, index) => {
    const cells = line.trim().split(/[\s,;]+/).filter(Boolean);
    if (!cells.length) return;
    const header = first && cells.every((cell) => toNumber(cell) === null);
    first = false;
    if (header) return;
    cells.forEach((cell, at) => out.push(read(cell, cells.length > 1 ? `Line ${index + 1}, value ${at + 1}` : `Line ${index + 1}`)));
  });
  if (!out.length) throw new Error("Paste at least one score.");
  if (out.length > MAX_ROWS) throw new Error(`Paste at most ${MAX_ROWS.toLocaleString("en-US")} scores.`);
  return out;
}

function tool(id, title, help, inputs, compute) {
  return { id, kind: "tool", group: GROUP, title, help, inputs, compute };
}

// ---------- the pack ----------

export default definePack({
  id: "tb-calibration",
  surface: "workbench.toolbox",
  title: "Calibration scores and fits",
  about: "Toolbox calculators for how well probabilities match outcomes, from pasted probability,outcome pairs or probability and logit vectors: Brier, log loss, ECE, reliability, calibration tests, and Platt, isotonic and temperature fits. They read only what you paste into them, never page data, and never call the model.",
  features: [
    tool("brier_score", "Brier score and skill against the base rate",
      `The mean squared gap between probability and outcome (0 is perfect), the Brier score of always predicting the base rate, and the Brier skill score 1 − Brier ÷ that reference (above 0 beats the base rate). ${PAIR_FORMAT}`,
      [PAIRS], (params) => {
        const data = parsePairs(params.pairs);
        const brier = data.p.reduce((total, p, i) => total + (p - data.y[i]) ** 2, 0) / data.n;
        const rate = data.positives / data.n, reference = rate * (1 - rate);
        return [["Brier score", brier], ["Base rate", rate], ["Brier score of always predicting the base rate", reference],
          ["Brier skill score", reference > 0 ? 1 - brier / reference : null], ["Rows", data.n]];
      }),
    tool("murphy_decomposition", "Murphy decomposition of the Brier score",
      `Splits the Brier score into reliability (how far each probability is from the observed rate of the rows given it; lower is better), resolution (how far those rates are from the base rate; higher is better) and uncertainty (base rate × (1 − base rate)). Rows are grouped by exact probability, so reliability − resolution + uncertainty equals the Brier score. ${PAIR_FORMAT}`,
      [PAIRS], (params) => {
        const data = parsePairs(params.pairs), rate = data.positives / data.n;
        const groups = new Map();
        data.p.forEach((p, i) => { const group = groups.get(p) || { n: 0, sy: 0 }; group.n++; group.sy += data.y[i]; groups.set(p, group); });
        let reliability = 0, resolution = 0;
        for (const [p, group] of groups) { const observed = group.sy / group.n; reliability += group.n * (p - observed) ** 2; resolution += group.n * (observed - rate) ** 2; }
        reliability /= data.n; resolution /= data.n;
        const uncertainty = rate * (1 - rate);
        return [["Reliability", reliability], ["Resolution", resolution], ["Uncertainty", uncertainty], ["Brier score (reliability − resolution + uncertainty)", reliability - resolution + uncertainty],
          ["Distinct probabilities", groups.size]];
      }),
    tool("log_loss", "Log loss",
      `The mean negative log-likelihood of the outcomes, in nats and in bits, with probabilities clipped to [ε, 1 − ε] as scikit-learn does, and the skill against always predicting the base rate. A clip of 0 makes a sure miss (probability 0 or 1 on the wrong side) infinite, shown as —. ${PAIR_FORMAT}`,
      [PAIRS, { name: "eps", label: "Clip probabilities by ε", type: "number", min: 0, max: 0.1, default: 1e-15 }], (params) => {
        const data = parsePairs(params.pairs);
        const loss = logLoss(data.p, data.y, params.eps), rate = data.positives / data.n;
        const reference = rate > 0 && rate < 1 ? -(rate * Math.log(rate) + (1 - rate) * Math.log(1 - rate)) : 0;
        const misses = data.p.filter((p, i) => (data.y[i] ? p === 0 : p === 1)).length;
        const finite = Number.isFinite(loss);
        return [["Log loss (nats)", finite ? loss : null], ["Log loss (bits)", finite ? loss / Math.LN2 : null], ["Log loss of always predicting the base rate (nats)", reference],
          ["Skill against the base rate", finite && reference > 0 ? 1 - loss / reference : null], ["Sure misses (0 or 1 on the wrong side)", misses], ["Rows", data.n]];
      }),
    tool("spherical_score", "Spherical score",
      `A proper score that rewards probability on the outcome that happened: the mean of p(outcome) ÷ √(p² + (1 − p)²), from about 0.71 for a coin flip to 1 for a sure hit; higher is better. Always predicting the base rate r scores √(r² + (1 − r)²). ${PAIR_FORMAT}`,
      [PAIRS], (params) => {
        const data = parsePairs(params.pairs), rate = data.positives / data.n;
        const score = data.p.reduce((total, p, i) => total + (data.y[i] ? p : 1 - p) / Math.sqrt(p * p + (1 - p) * (1 - p)), 0) / data.n;
        return [["Spherical score", score], ["Score of always predicting the base rate", Math.sqrt(rate * rate + (1 - rate) * (1 - rate))], ["Rows", data.n]];
      }),
    tool("ece_equal_width", "Expected calibration error (equal-width bins)",
      `Splits 0 to 1 into equal-width bins (an edge value goes to the bin above it, 1 to the last bin) and averages |observed rate − mean probability| over the bins, weighted by their rows. For confidence,correct pairs this is the usual ECE. ${PAIR_FORMAT}`,
      [PAIRS, BINS], (params) => {
        const data = parsePairs(params.pairs), bins = widthBins(data.p, data.y, params.bins);
        return [["Expected calibration error", eceOf(bins, data.n)], ["Mean probability", data.p.reduce((a, b) => a + b, 0) / data.n], ["Observed rate", data.positives / data.n],
          ["Nonempty bins", bins.length], ["Rows", data.n]];
      }),
    tool("ece_equal_mass", "Expected calibration error (equal-mass bins)",
      `Like ECE, but with bins of about equal rows: sorted by probability, the rows starting at sorted position i go to bin ⌊i·bins ÷ rows⌋, and equal probabilities stay in one bin. Less sensitive to empty or tiny bins than equal-width ECE. ${PAIR_FORMAT}`,
      [PAIRS, BINS], (params) => {
        const data = parsePairs(params.pairs), bins = massBins(data.p, data.y, params.bins);
        return [["Expected calibration error", eceOf(bins, data.n)], ["Nonempty bins", bins.length], ["Smallest bin (rows)", Math.min(...bins.map((bin) => bin.n))],
          ["Largest bin (rows)", Math.max(...bins.map((bin) => bin.n))], ["Rows", data.n]];
      }),
    tool("max_calibration_error", "Maximum calibration error",
      `The largest |observed rate − mean probability| over the bins that hold at least the minimum rows, with the bin where it occurs. Small bins make it noisy, so raise the minimum for few rows. ${PAIR_FORMAT}`,
      [PAIRS, BINNING, BINS, { name: "minRows", label: "Minimum rows in a bin", type: "integer", min: 1, default: 1 }], (params) => {
        const data = parsePairs(params.pairs);
        const bins = binsOf(data, params.binning, params.bins).filter((bin) => bin.n >= params.minRows);
        if (!bins.length) return { rows: [["Maximum calibration error", null], ["Bin from", null], ["Bin to", null], ["Rows in that bin", null], ["Observed rate − mean probability there", null], ["Bins counted", 0]],
          note: "No bin holds the minimum rows." };
        let worst = bins[0];
        for (const bin of bins) if (Math.abs(bin.sy - bin.sp) / bin.n > Math.abs(worst.sy - worst.sp) / worst.n + 1e-15) worst = bin;
        return [["Maximum calibration error", Math.abs(worst.sy - worst.sp) / worst.n], ["Bin from", worst.lo], ["Bin to", worst.hi], ["Rows in that bin", worst.n],
          ["Observed rate − mean probability there", (worst.sy - worst.sp) / worst.n], ["Bins counted", bins.length]];
      }),
    tool("reliability_table", "Reliability table",
      `Per bin: its range (equal-width edges, or the lowest and highest probability in an equal-mass bin), rows, mean probability, observed rate, the gap observed − predicted (negative means overconfident) and a Wilson interval for the observed rate. Empty bins are left out. ${PAIR_FORMAT}`,
      [PAIRS, BINNING, BINS, { name: "level", label: "Interval confidence", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]], default: "0.95" }], (params) => {
        const data = parsePairs(params.pairs), z = zFor(Number(params.level));
        return { table: { columns: ["From", "To", "Rows", "Mean probability", "Observed rate", "Gap (observed − predicted)", "Interval low", "Interval high"],
          rows: binsOf(data, params.binning, params.bins).map((bin) => [bin.lo, bin.hi, bin.n, bin.sp / bin.n, bin.sy / bin.n, (bin.sy - bin.sp) / bin.n, ...wilson(bin.sy, bin.n, z)]) } };
      }),
    tool("calibration_slope", "Calibration slope and intercept",
      `Fits outcome ~ σ(intercept + slope × log-odds(probability)) by maximum likelihood (Cox's recalibration). A slope below 1 means the probabilities are too extreme, above 1 too timid; calibration-in-the-large is the intercept with the slope held at 1 (above 0: outcomes happen more often than predicted). Needs both outcomes and two different probabilities. ${PAIR_FORMAT}`,
      [PAIRS], (params) => {
        const data = needBoth(parsePairs(params.pairs));
        const { x, note } = clippedLogOdds(data.p);
        if (new Set(x).size < 2) throw new Error("Paste at least two different probabilities.");
        const citl = solveOffset(x, data.positives);
        if (separated(x, data.y)) return { rows: [["Calibration slope", null], ["Calibration intercept", null], ["Calibration-in-the-large", citl]],
          note: ["The outcomes are separated by probability (every 1 is at or above every 0, or the reverse), so the slope has no finite estimate.", note].filter(Boolean).join(" ") };
        const fit = fitLogistic(x, data.y);
        return { rows: [["Calibration slope", fit ? fit.b : null], ["Calibration intercept", fit ? fit.a : null], ["Calibration-in-the-large", citl]],
          note: [fit ? null : "The fit did not converge.", note].filter(Boolean).join(" ") || null };
      }),
    tool("hosmer_lemeshow", "Hosmer-Lemeshow test",
      `Groups rows by sorted probability into groups of about equal size (equal probabilities stay in one group), then compares observed and expected positives: H = Σ (O − E)² ÷ (E(1 − E ÷ n)) on groups − 2 degrees of freedom. A small p-value is evidence of miscalibration; with many rows tiny gaps become significant. ${PAIR_FORMAT}`,
      [PAIRS, { name: "groups", label: "Groups", type: "integer", min: 3, max: 50, default: 10 }], (params) => {
        const data = parsePairs(params.pairs), groups = massBins(data.p, data.y, params.groups);
        const table = { columns: ["Group", "Rows", "Lowest probability", "Highest probability", "Observed positives", "Expected positives"],
          rows: groups.map((group, i) => [i + 1, group.n, group.lo, group.hi, group.sy, group.sp]) };
        if (groups.length < 3) return { rows: [["H statistic", null], ["Degrees of freedom", null], ["p-value", null], ["Groups", groups.length]], table, note: "The test needs at least three groups; paste more distinct probabilities." };
        let h = 0, defined = true;
        for (const group of groups) {
          const expectedNo = group.n - group.sp;
          if (group.sp <= 0 || expectedNo <= 0) { defined = false; break; }
          h += (group.sy - group.sp) ** 2 / group.sp + ((group.n - group.sy) - expectedNo) ** 2 / expectedNo;
        }
        const df = groups.length - 2;
        return { rows: [["H statistic", defined ? h : null], ["Degrees of freedom", df], ["p-value", defined ? chiSquareSf(h, df) : null], ["Groups", groups.length]], table,
          note: defined ? null : "A group's probabilities are all 0 or all 1, so its expected count is 0 and H is undefined." };
      }),
    tool("multiclass_brier", "Multi-class Brier score",
      `The mean over rows of Σ (probability − 1 if that option is right, else 0)² over every option, from 0 (perfect) to 2; halved it runs from 0 to 1. The reference always predicts each option's share of the labels. ${PROBABILITY_VECTORS}`,
      [VECTORS], (params) => {
        const data = parseVectors(params.rows), n = data.rows.length, k = data.options.length;
        const brier = data.rows.reduce((total, row) => total + row.values.reduce((sum, p, j) => sum + (p - (j === row.label ? 1 : 0)) ** 2, 0), 0) / n;
        const shares = data.options.map((_, j) => data.rows.filter((row) => row.label === j).length / n);
        const reference = 1 - shares.reduce((sum, share) => sum + share * share, 0);
        const accuracy = data.rows.filter((row) => topIndex(row.values) === row.label).length / n;
        return { rows: [["Multi-class Brier score (0 to 2)", brier], ["Halved (0 to 1)", brier / 2], ["Brier score of predicting the label shares", reference],
          ["Skill against the label shares", reference > 0 ? 1 - brier / reference : null], ["Top-choice accuracy", accuracy], ["Rows", n], ["Options", k]], note: rescaledNote(data) };
      }),
    tool("multiclass_log_loss", "Multi-class log loss",
      `The mean of −ln(probability of the right option), clipped to at least ε, in nats and bits, with its perplexity (e^loss, the effective number of options it is torn between) and two references: a uniform guess (ln of the option count) and predicting each option's share of the labels. ${PROBABILITY_VECTORS}`,
      [VECTORS, { name: "eps", label: "Clip probabilities by ε", type: "number", min: 0, max: 0.1, default: 1e-15 }], (params) => {
        const data = parseVectors(params.rows), n = data.rows.length, k = data.options.length;
        const loss = data.rows.reduce((total, row) => total - Math.log(Math.max(params.eps, row.values[row.label])), 0) / n;
        const shares = data.options.map((_, j) => data.rows.filter((row) => row.label === j).length / n);
        const reference = -shares.reduce((sum, share) => sum + (share > 0 ? share * Math.log(share) : 0), 0);
        const finite = Number.isFinite(loss);
        return { rows: [["Log loss (nats)", finite ? loss : null], ["Log loss (bits)", finite ? loss / Math.LN2 : null], ["Perplexity", finite ? Math.exp(loss) : null],
          ["Log loss of a uniform guess (nats)", Math.log(k)], ["Log loss of predicting the label shares (nats)", reference],
          ["Skill against the label shares", finite && reference > 0 ? 1 - loss / reference : null], ["Rows", n]], note: rescaledNote(data) };
      }),
    tool("top_label_calibration", "Top-choice calibration from probability vectors",
      `Reads each row's top option (the first one listed among equal tops) and its probability as a confidence, then compares confidence with accuracy: mean confidence, top-choice accuracy, overconfidence (the difference) and the equal-width ECE of the top choice. ${PROBABILITY_VECTORS}`,
      [VECTORS, BINS], (params) => {
        const data = parseVectors(params.rows), n = data.rows.length;
        const p = data.rows.map((row) => Math.max(...row.values)), y = data.rows.map((row) => (topIndex(row.values) === row.label ? 1 : 0));
        const accuracy = y.reduce((a, b) => a + b, 0) / n, confidence = p.reduce((a, b) => a + b, 0) / n;
        return { rows: [["Top-choice accuracy", accuracy], ["Mean top probability", confidence], ["Overconfidence (confidence − accuracy)", confidence - accuracy],
          ["Top-choice ECE", eceOf(widthBins(p, y, params.bins), n)], ["Rows", n]], note: rescaledNote(data) };
      }),
    tool("ranked_probability_score", "Ranked probability score for ordered levels",
      `For answers on an ordered scale (a Score legend), the mean over rows of Σ (cumulative probability − cumulative outcome)² over the first K − 1 levels, divided by K − 1: 0 is perfect, 1 the worst, and a near miss costs less than a far one. Options are taken in the order given. The reference predicts each level's share of the labels. ${PROBABILITY_VECTORS}`,
      [{ ...VECTORS, label: "Label and probability per level, one row per line", placeholder: "level,1,2,3,4,5\n4,0.05,0.1,0.2,0.4,0.25\n2,0.1,0.5,0.3,0.1,0" }], (params) => {
        const data = parseVectors(params.rows), n = data.rows.length, k = data.options.length;
        const rps = (values, label) => {
          let total = 0, cumulative = 0;
          for (let j = 0; j < k - 1; j++) { cumulative += values[j]; total += (cumulative - (j >= label ? 1 : 0)) ** 2; }
          return total / (k - 1);
        };
        const shares = data.options.map((_, j) => data.rows.filter((row) => row.label === j).length / n);
        const score = data.rows.reduce((total, row) => total + rps(row.values, row.label), 0) / n;
        const reference = data.rows.reduce((total, row) => total + rps(shares, row.label), 0) / n;
        return { rows: [["Ranked probability score", score], ["Score of predicting the level shares", reference], ["Skill against the level shares", reference > 0 ? 1 - score / reference : null],
          ["Rows", n], ["Levels", k]], note: rescaledNote(data) };
      }),
    tool("platt_fit", "Platt scaling fit",
      `Fits p = σ(a·x + b) to the outcomes by maximum likelihood, where x is the score or its log-odds, with Platt's smoothed targets (N₊ + 1) ÷ (N₊ + 2) and 1 ÷ (N₋ + 2) unless you turn them off. Platt writes 1 ÷ (1 + e^(A·x + B)), so A = −a and B = −b. Lists the recalibrated probability of every distinct score. Fit on rows you will not evaluate on. Paste score,outcome pairs in the pair format: ${PAIR_FORMAT}`,
      [SCORE_PAIRS, FEATURE, { name: "smooth", label: "Use Platt's smoothed targets", type: "checkbox", default: true }], (params) => {
        const data = needBoth(parsePairs(params.pairs, { anyScore: params.feature !== "logodds" }));
        let x = data.p, note = null;
        if (params.feature === "logodds") ({ x, note } = clippedLogOdds(data.p));
        if (new Set(x).size < 2) throw new Error("Paste at least two different scores.");
        const high = (data.positives + 1) / (data.positives + 2), low = 1 / (data.negatives + 2);
        const targets = data.y.map((y) => (params.smooth ? (y ? high : low) : y));
        if (!params.smooth && separated(x, data.y)) return { rows: [["Slope (a)", null], ["Intercept (b)", null], ["Log loss after (nats)", null], ["Rows", data.n]],
          note: "Without smoothing the outcomes are separated by score, so the fit has no finite slope. Turn smoothing on." };
        const fit = fitLogistic(x, targets);
        if (!fit) return { rows: [["Slope (a)", null], ["Intercept (b)", null], ["Log loss after (nats)", null], ["Rows", data.n]], note: "The fit did not converge." };
        const fitted = x.map((xi) => sigmoid(fit.a + fit.b * xi));
        const distinct = [...new Set(data.p)].sort((a, b) => a - b);
        const position = new Map(distinct.map((score, i) => [score, i]));
        const counts = distinct.map(() => 0);
        data.p.forEach((score) => { counts[position.get(score)]++; });
        return { rows: [["Slope (a)", fit.b], ["Intercept (b)", fit.a], ["Log loss after (nats)", logLoss(fitted, data.y, 1e-15)],
          ["Log loss before (nats)", params.feature === "logodds" ? logLoss(data.p.map((p) => clip(p, LOGIT_CLIP)), data.y, 1e-15) : null], ["Rows", data.n]],
        table: { columns: ["Score", "Rows", "Recalibrated probability"], rows: distinct.map((score, i) => [score, counts[i], fitted[data.p.indexOf(score)]]) }, note };
      }),
    tool("platt_apply", "Apply a Platt scaling",
      "Turns scores into probabilities with p = σ(a·x + b), using the slope a and intercept b from the Platt scaling fit, where x is the score or its log-odds (probabilities of 0 or 1 are moved 1e-6 inside the range). Paste the scores separated by commas, spaces, tabs, semicolons or new lines.",
      [{ name: "a", label: "Slope (a)", type: "number" }, { name: "b", label: "Intercept (b)", type: "number" }, FEATURE,
        { name: "scores", label: "Scores", type: "textarea", rows: 4, required: true, placeholder: "0.2, 0.55, 0.9" }], (params) => {
        const logodds = params.feature === "logodds";
        const scores = scoresList(params.scores, logodds ? probabilityOf : numberOf);
        const x = scores.map((score) => (logodds ? logOdds(clip(score, LOGIT_CLIP)) : score));
        return { table: { columns: ["Score", "Recalibrated probability"], rows: scores.map((score, i) => [score, sigmoid(params.a * x[i] + params.b)]) } };
      }),
    tool("isotonic_fit", "Isotonic recalibration (pool adjacent violators)",
      `Fits the best non-decreasing step function from score to outcome rate (least squares, by pooling adjacent violators): each block of scores gets the observed rate of its rows. Equal scores share a block. Shows the in-sample Brier score before (when every score is a probability) and after. Fit on rows you will not evaluate on. ${PAIR_FORMAT} Scores may be any numbers.`,
      [SCORE_PAIRS], (params) => {
        const data = parsePairs(params.pairs, { anyScore: true });
        const blocks = isotonicBlocks(data.p, data.y);
        const after = blocks.reduce((total, block) => { const rate = block.positives / block.n; return total + block.positives * (1 - rate) ** 2 + (block.n - block.positives) * rate * rate; }, 0) / data.n;
        const probabilities = data.p.every((p) => p >= 0 && p <= 1);
        return { rows: [["Blocks", blocks.length], ["Brier score before", probabilities ? data.p.reduce((total, p, i) => total + (p - data.y[i]) ** 2, 0) / data.n : null], ["Brier score after", after]],
          table: { columns: ["From score", "To score", "Rows", "Positives", "Fitted probability"], rows: blocks.map((block) => [block.lo, block.hi, block.n, block.positives, block.positives / block.n]) } };
      }),
    tool("temperature_fit", "Temperature that minimizes log loss",
      `Finds the temperature T > 0 for which softmax(logits ÷ T) has the lowest log loss on the pasted rows (T above 1 softens overconfident answers, below 1 sharpens them). The top choice, and so accuracy, never changes. ${VECTOR_FORMAT} Each value is a logit.`,
      [{ ...VECTORS, label: "Label and logits, one row per line", placeholder: "label,refund,exchange,other\nrefund,2.1,0.3,-1.0\nother,0.2,0.4,0.9" }], (params) => {
        const data = parseVectors(params.rows, { logits: true }), rows = data.rows, n = rows.length;
        const accuracy = rows.filter((row) => topIndex(row.values) === row.label).length / n;
        const meanTop = (beta) => rows.reduce((total, row) => total + Math.max(...softmax(row.values, beta)), 0) / n;
        const base = [["Log loss at T = 1 (nats)", finite(temperatureLoss(rows, 1))], ["Top-choice accuracy", accuracy], ["Mean top probability at T = 1", finite(meanTop(1))]];
        const unknown = (note) => ({ rows: [["Temperature", null], ...base, ["Log loss at the fitted temperature (nats)", null], ["Mean top probability at the fitted temperature", null], ["Rows", n]], note });
        if (temperatureSlope(rows, 0) >= -1e-12) return unknown("The label's logit is on average no higher than the others', so the loss keeps falling as T grows: no finite temperature fits.");
        if (rows.every((row) => row.values[row.label] >= Math.max(...row.values))) {
          return unknown("Every label already has its row's highest logit, so the loss keeps falling as T shrinks toward 0: no positive temperature fits.");
        }
        let hi = 1;
        for (let i = 0; i < 1000 && temperatureSlope(rows, hi) < 0; i++) hi *= 2;
        let lo = 0;
        for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (temperatureSlope(rows, mid) < 0) lo = mid; else hi = mid; }
        const beta = (lo + hi) / 2, fitted = [1 / beta, temperatureLoss(rows, beta), meanTop(beta)];
        if (!(beta > 0) || !fitted.every(Number.isFinite)) return unknown("The logits are too large to fit a temperature; scale them down.");
        return [["Temperature", fitted[0]], ...base, ["Log loss at the fitted temperature (nats)", fitted[1]], ["Mean top probability at the fitted temperature", fitted[2]], ["Rows", n]];
      }),
    tool("temperature_apply", "Apply a temperature to logits",
      "Turns each row of logits into probabilities with softmax(logits ÷ T), with the top option. Paste one row of logits per line (no label column) separated by commas, tabs or semicolons; an optional first line names the options.",
      [{ name: "temperature", label: "Temperature (T)", type: "number", min: 1e-6, default: 1 },
        { name: "rows", label: "Logits, one row per line", type: "textarea", rows: 6, required: true, placeholder: "refund,exchange,other\n2.1,0.3,-1.0\n0.2,0.4,0.9" }], (params) => {
        if (!(params.temperature > 0)) throw new Error("The temperature must be above 0.");
        const data = parseVectors(params.rows, { logits: true, labeled: false });
        return { table: { columns: ["Row", ...data.options, "Top option"], rows: data.rows.map((row, i) => {
          const q = softmax(row.values, 1 / params.temperature);
          if (!q.every(Number.isFinite)) throw new Error(`Row ${i + 1}: the logits ÷ T are too large to compute; use a higher temperature or smaller logits.`);
          return [i + 1, ...q, data.options[topIndex(q)]];
        }) } };
      }),
    tool("observed_vs_expected", "Observed and expected positives",
      `Calibration-in-the-large: the positives the probabilities predict (Σ p) against the positives observed, their ratio and a z test with variance Σ p(1 − p) (normal approximation). Give a minimum probability to check only the rows a gate would automate. ${PAIR_FORMAT}`,
      [PAIRS, { name: "minimum", label: "Only rows with probability at least (optional)", type: "number", min: 0, max: 1, optional: true }], (params) => {
        const data = parsePairs(params.pairs);
        const keep = data.p.map((p) => params.minimum === null || p + 1e-9 >= params.minimum);
        let rows = 0, expected = 0, observed = 0, variance = 0;
        data.p.forEach((p, i) => { if (keep[i]) { rows++; expected += p; observed += data.y[i]; variance += p * (1 - p); } });
        const z = variance > 0 ? (observed - expected) / Math.sqrt(variance) : null;
        return [["Rows checked", rows], ["Expected positives", rows ? expected : null], ["Observed positives", rows ? observed : null], ["Observed ÷ expected", ratio(observed, expected)],
          ["Observed − expected", rows ? observed - expected : null], ["z", z], ["Two-sided p-value", z === null ? null : 2 * normalSf(Math.abs(z))]];
      }),
    tool("spiegelhalter_z", "Spiegelhalter's z test",
      `Tests whether the probabilities are calibrated row by row: Z = Σ (y − p)(1 − 2p) ÷ √Σ (1 − 2p)² p(1 − p), standard normal when they are. Undefined (—) when every probability is 0, 0.5 or 1. ${PAIR_FORMAT}`,
      [PAIRS], (params) => {
        const data = parsePairs(params.pairs);
        let top = 0, bottom = 0;
        data.p.forEach((p, i) => { top += (data.y[i] - p) * (1 - 2 * p); bottom += (1 - 2 * p) ** 2 * p * (1 - p); });
        const z = bottom > 0 ? top / Math.sqrt(bottom) : null;
        return [["z", z], ["Two-sided p-value", z === null ? null : 2 * normalSf(Math.abs(z))], ["Rows", data.n]];
      }),
    tool("compare_forecasts", "Compare two sets of probabilities on the same rows",
      "Scores two sets of probabilities for the same outcomes (two variants, models or recalibrations) with the Brier score or log loss, and tests the mean per-row difference with a paired z test (the Diebold-Mariano test without lags). Paste probability A, probability B and the outcome per row (several triples may share a line); a first line with no number is a header.",
      [{ name: "rows", label: "Probability A, probability B and outcome", type: "textarea", rows: 8, required: true, placeholder: "a,b,outcome\n0.8,0.7,1\n0.4,0.2,0" },
        { name: "score", label: "Score", type: "select", options: [["brier", "Brier score"], ["log", "log loss (clipped by 1e-15)"]], default: "brier" }], (params) => {
        const rows = records(params.rows, 3, "triple", ([a, b, y], where) => [probabilityOf(a, where), probabilityOf(b, where), outcomeOf(y, where)]);
        if (rows.length < 2) throw new Error("Paste at least two rows.");
        const score = params.score === "log" ? (p, y) => -Math.log(clip(y ? p : 1 - p, 1e-15)) : (p, y) => (p - y) ** 2;
        const a = rows.map(([p, , y]) => score(p, y)), b = rows.map(([, p, y]) => score(p, y));
        const d = a.map((value, i) => value - b[i]), n = rows.length;
        const meanA = a.reduce((x, v) => x + v, 0) / n, meanB = b.reduce((x, v) => x + v, 0) / n, meanD = d.reduce((x, v) => x + v, 0) / n;
        const se = Math.sqrt(d.reduce((x, v) => x + (v - meanD) ** 2, 0) / (n - 1) / n);
        const z = se > 0 ? meanD / se : null;
        return [["Score of A", meanA], ["Score of B", meanB], ["Difference (A − B)", meanD], ["Standard error of the difference", se], ["z", z],
          ["Two-sided p-value", z === null ? null : 2 * normalSf(Math.abs(z))], ["Lower (better) score", meanD < 0 ? "A" : meanD > 0 ? "B" : "neither"], ["Rows", n]];
      }),
    tool("ks_calibration", "Kolmogorov-Smirnov calibration error",
      `A bin-free calibration error (Gupta and others, 2021): sort the rows by probability and take the largest gap between the running sums of outcomes and of probabilities, each divided by the rows. Gaps are read only after each run of equal probabilities. ${PAIR_FORMAT}`,
      [PAIRS], (params) => {
        const data = parsePairs(params.pairs);
        const order = data.p.map((_, i) => i).sort((a, b) => data.p[a] - data.p[b]);
        let outcomes = 0, predicted = 0, best = { gap: 0, at: null, signed: 0 };
        for (let i = 0; i < order.length; i++) {
          outcomes += data.y[order[i]]; predicted += data.p[order[i]];
          if (i + 1 < order.length && data.p[order[i + 1]] === data.p[order[i]]) continue;
          const signed = (outcomes - predicted) / data.n;
          if (Math.abs(signed) > best.gap + 1e-15) best = { gap: Math.abs(signed), at: data.p[order[i]], signed };
        }
        return [["KS calibration error", best.gap], ["Up to probability", best.at], ["Outcomes there run", best.signed > 0 ? "above the probabilities" : best.signed < 0 ? "below the probabilities" : "level with the probabilities"], ["Rows", data.n]];
      }),
    tool("calibration_by_group", "Calibration by group",
      "Mean probability against observed rate for each group (a slice such as a channel or a product line), with the gap and a 95% Wilson interval for the observed rate, groups in name order. Paste group,probability,outcome per line separated by commas, tabs or semicolons; a first line whose probability is not a number is a header. Outcomes are 1/0, yes/no, true/false or correct/wrong.",
      [{ name: "rows", label: "Group, probability and outcome", type: "textarea", rows: 8, required: true, placeholder: "group,probability,outcome\nweb,0.9,1\nphone,0.7,0" }], (params) => {
        const lines = String(params.rows ?? "").split(/\r\n|\n|\r/);
        const groups = new Map();
        let first = true, total = 0;
        lines.forEach((line, index) => {
          if (!line.trim()) return;
          const where = `Line ${index + 1}`, cells = splitCells(line);
          const header = first && cells.length === 3 && toNumber(cells[1]) === null;
          first = false;
          if (header) return;
          if (cells.length !== 3) throw new Error(`${where}: expected a group, a probability and an outcome, found ${cells.length} value${cells.length === 1 ? "" : "s"}.`);
          if (!cells[0]) throw new Error(`${where}: the group is blank.`);
          const p = probabilityOf(cells[1], where), y = outcomeOf(cells[2], where);
          const group = groups.get(cells[0]) || { n: 0, sp: 0, sy: 0 };
          group.n++; group.sp += p; group.sy += y; groups.set(cells[0], group);
          if (++total > MAX_ROWS) throw new Error(`Paste at most ${MAX_ROWS.toLocaleString("en-US")} rows.`);
        });
        if (!total) throw new Error("Paste at least one group,probability,outcome row.");
        const names = [...groups.keys()].sort(compareText), z = zFor(0.95);
        let worst = null;
        for (const name of names) { const g = groups.get(name); if (!worst || Math.abs(g.sy - g.sp) / g.n > worst.gap + 1e-15) worst = { name, gap: Math.abs(g.sy - g.sp) / g.n }; }
        return { rows: [["Groups", names.length], ["Largest absolute gap", worst.gap], ["Group with the largest gap", worst.name]],
          table: { columns: ["Group", "Rows", "Mean probability", "Observed rate", "Gap (observed − predicted)", "95% low", "95% high"],
            rows: names.map((name) => { const g = groups.get(name); return [name, g.n, g.sp / g.n, g.sy / g.n, (g.sy - g.sp) / g.n, ...wilson(g.sy, g.n, z)]; }) } };
      }),
  ],
});
