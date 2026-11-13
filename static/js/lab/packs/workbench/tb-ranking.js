// Toolbox: ranking metrics and curves from pasted score,label pairs. Every tool is pure: it reads only the text and
// numbers typed into its form, never page data, and it never calls the model.
import { definePack, toNumber } from "../../kit.js";
import { maxOf, mean, median, minOf, normalQuantile, stdev } from "../../lib/math.js";

const GROUP = "Ranking and curves";
const MAX_ITEMS = 200000;
const FORMAT = "Paste one item per line as score,label (tab, comma, semicolon or space between them); labels are 1/0, true/false, yes/no or positive/negative, and a header line is skipped. "
  + "An item counts as predicted positive when its score is at or above the threshold.";
const PAIRS = { name: "pairs", label: "Score and label pairs", type: "textarea", rows: 8, required: true, placeholder: "score,label\n0.92,1\n0.35,0\n0.71,1" };
const LEVEL = { name: "level", label: "Interval confidence", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]], default: "0.95" };
const TOP = "above top score";

// ---------- parsing ----------

const LABELS = new Map([["1", true], ["0", false], ["true", true], ["false", false], ["yes", true], ["no", false], ["y", true], ["n", false],
  ["pos", true], ["neg", false], ["positive", true], ["negative", false]]);

function labelOf(cell) {
  const key = cell.trim().toLowerCase();
  if (LABELS.has(key)) return LABELS.get(key);
  const number = toNumber(key);
  return number === 1 ? true : number === 0 ? false : undefined;
}

function splitterFor(text) {
  for (const delimiter of ["\t", ";", ","]) if (text.includes(delimiter)) return { delimiter, split: (line) => line.split(delimiter).map((cell) => cell.trim()) };
  return { delimiter: " ", split: (line) => line.trim().split(/\s+/) };
}

// Pasted pairs as { scores, labels, positives, negatives }. A decimal comma is read when the delimiter is not a comma.
function parsePairs(text) {
  const source = String(text ?? "");
  const { delimiter, split } = splitterFor(source);
  const scores = [], labels = [];
  let first = true;
  source.split(/\r\n|\n|\r/).forEach((line, index) => {
    if (!line.trim()) return;
    const cells = split(line);
    const isFirst = first;
    first = false;
    if (cells.length !== 2) throw new Error(`Line ${index + 1}: expected two values, a score and a label.`);
    const raw = delimiter !== "," && /^[-+]?\d+,\d+$/.test(cells[0]) ? cells[0].replace(",", ".") : cells[0];
    const score = toNumber(raw), label = labelOf(cells[1]);
    if (score === null && label === undefined && isFirst) return;   // a header line
    if (score === null) throw new Error(`Line ${index + 1}: "${cells[0]}" is not a number.`);
    if (label === undefined) throw new Error(`Line ${index + 1}: "${cells[1]}" is not a label; use 1/0, true/false, yes/no or positive/negative.`);
    scores.push(score);
    labels.push(label);
  });
  if (!scores.length) throw new Error(`Paste at least one item. ${FORMAT}`);
  if (scores.length > MAX_ITEMS) throw new Error(`Paste at most ${MAX_ITEMS.toLocaleString("en-US")} items.`);
  const positives = labels.filter(Boolean).length;
  return { scores, labels, positives, negatives: labels.length - positives, n: labels.length };
}

function needBoth(data) {
  if (!data.positives || !data.negatives) throw new Error("Paste at least one positive and one negative item.");
  return data;
}
function needPositives(data) {
  if (!data.positives) throw new Error("Paste at least one positive item.");
  return data;
}

// One entry per distinct score, highest first, with the counts when everything at or above it is predicted positive:
// { threshold, size, groupPositives, tp, fp, fn, tn, flagged }.
function sweep(data) {
  const order = data.scores.map((score, index) => index).sort((a, b) => data.scores[b] - data.scores[a]);
  const points = [];
  let tp = 0, fp = 0;
  for (let i = 0; i < order.length;) {
    const threshold = data.scores[order[i]];
    let size = 0, groupPositives = 0;
    while (i < order.length && data.scores[order[i]] === threshold) {
      if (data.labels[order[i]]) { tp++; groupPositives++; } else fp++;
      size++; i++;
    }
    points.push({ threshold, size, groupPositives, tp, fp, fn: data.positives - tp, tn: data.negatives - fp, flagged: tp + fp });
  }
  return points;
}

const ratio = (top, bottom) => (bottom > 0 ? top / bottom : null);
const rates = (point, data) => ({ tpr: ratio(point.tp, data.positives), fpr: ratio(point.fp, data.negatives), precision: ratio(point.tp, point.flagged) });
const dash = (value) => (value === null || value === undefined ? "—" : value);

// The expected positives among the top k items when tied scores are put in random order.
function positivesInTop(points, k) {
  if (k <= 0) return { positives: 0, split: 0 };
  let lo = 0, hi = points.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid].flagged >= k) hi = mid; else lo = mid + 1; }
  const point = points[lo], before = point.flagged - point.size, positivesBefore = point.tp - point.groupPositives;
  return { positives: positivesBefore + (k - before) * point.groupPositives / point.size, split: k > before && k < point.flagged ? point.size : 0 };
}

// The Mann-Whitney AUC: the chance a random positive outscores a random negative, ties counting one half.
function aucOf(data) {
  const order = data.scores.map((score, index) => index).sort((a, b) => data.scores[a] - data.scores[b]);
  let rankSum = 0;
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && data.scores[order[j]] === data.scores[order[i]]) j++;
    const midrank = (i + 1 + j) / 2;
    for (let t = i; t < j; t++) if (data.labels[order[t]]) rankSum += midrank;
    i = j;
  }
  return (rankSum - data.positives * (data.positives + 1) / 2) / (data.positives * data.negatives);
}

// The asymptotic Kolmogorov distribution's upper tail P(K > lambda), as scipy's kstwobign.sf.
function kolmogorovSf(lambda) {
  if (!(lambda > 0)) return 1;
  let total = 0;
  if (lambda < 1) {
    for (let k = 1; k <= 20; k++) total += Math.exp(-((2 * k - 1) ** 2) * Math.PI * Math.PI / (8 * lambda * lambda));
    return Math.min(1, Math.max(0, 1 - Math.sqrt(2 * Math.PI) / lambda * total));
  }
  for (let k = 1; k <= 100; k++) {
    const term = Math.exp(-2 * k * k * lambda * lambda);
    total += k % 2 ? term : -term;
    if (term < 1e-300) break;
  }
  return Math.min(1, Math.max(0, 2 * total));
}

function shareInput(name, label, extra = {}) { return { name, label, type: "number", min: 0, max: 1, ...extra }; }

// ---------- the pack ----------

export default definePack({
  id: "tb-ranking",
  surface: "workbench.toolbox",
  title: "Ranking and curves",
  about: "Toolbox calculators for ROC and precision-recall curves, AUC, lift, KS and threshold choice from pasted score,label pairs. They read only what you paste into them and never call the model.",
  features: [
    { id: "roc_auc", kind: "tool", group: GROUP, title: "ROC AUC with an interval", help: `The area under the ROC curve: the chance a random positive scores above a random negative, ties counting one half (the Mann-Whitney statistic). The interval uses the Hanley-McNeil standard error. ${FORMAT}`,
      inputs: [PAIRS, LEVEL], compute: (params) => {
        const data = needBoth(parsePairs(params.pairs)), auc = aucOf(data), level = Number(params.level);
        const q1 = auc / (2 - auc), q2 = 2 * auc * auc / (1 + auc);
        const se = Math.sqrt(Math.max(0, auc * (1 - auc) + (data.positives - 1) * (q1 - auc * auc) + (data.negatives - 1) * (q2 - auc * auc)) / (data.positives * data.negatives));
        const z = normalQuantile(1 - (1 - level) / 2), pct = `${Math.round(level * 100)}%`;
        return [["ROC AUC", auc], ["Standard error (Hanley-McNeil)", se], [`${pct} interval, low`, Math.max(0, auc - z * se)], [`${pct} interval, high`, Math.min(1, auc + z * se)],
          ["Positives", data.positives], ["Negatives", data.negatives]];
      } },
    { id: "roc_points", kind: "tool", group: GROUP, title: "ROC curve points", help: `The false and true positive rates at every distinct score used as a threshold, from the origin (nothing flagged) to (1, 1). Every point is kept, none dropped as collinear. ${FORMAT}`,
      inputs: [PAIRS], compute: (params) => {
        const data = needBoth(parsePairs(params.pairs));
        return { table: { columns: ["Threshold (score ≥)", "False positive rate", "True positive rate", "True positives", "False positives"],
          rows: [[TOP, 0, 0, 0, 0], ...sweep(data).map((point) => [point.threshold, point.fp / data.negatives, point.tp / data.positives, point.tp, point.fp])] } };
      } },
    { id: "pr_points", kind: "tool", group: GROUP, title: "Precision-recall curve points", help: `Precision and recall at every distinct score used as a threshold, highest score first. ${FORMAT}`,
      inputs: [PAIRS], compute: (params) => {
        const data = needPositives(parsePairs(params.pairs));
        return { table: { columns: ["Threshold (score ≥)", "Precision", "Recall", "True positives", "False positives"],
          rows: sweep(data).map((point) => [point.threshold, point.tp / point.flagged, point.tp / data.positives, point.tp, point.fp]) } };
      } },
    { id: "average_precision", kind: "tool", group: GROUP, title: "Average precision", help: `The precision at each threshold weighted by the recall it adds, Σ (Rₙ − Rₙ₋₁) Pₙ over distinct scores, as scikit-learn's average_precision_score computes it. A random ranking scores about the base rate. ${FORMAT}`,
      inputs: [PAIRS], compute: (params) => {
        const data = needPositives(parsePairs(params.pairs));
        let previous = 0, ap = 0;
        for (const point of sweep(data)) { const recall = point.tp / data.positives; ap += (recall - previous) * point.tp / point.flagged; previous = recall; }
        return [["Average precision", ap], ["Base rate", data.positives / data.n], ["Positives", data.positives], ["Items", data.n]];
      } },
    { id: "precision_at_k", kind: "tool", group: GROUP, title: "Precision and recall at k", help: `Precision and recall among the k highest-scoring items. Items tied at the cut share their positives in proportion, the average over every order of the ties. ${FORMAT}`,
      inputs: [PAIRS, { name: "k", label: "k (items at the top)", type: "integer", min: 1, default: 10 }], compute: (params) => {
        const data = parsePairs(params.pairs);
        if (params.k > data.n) throw new Error(`k is ${params.k} but only ${data.n} items were pasted.`);
        const top = positivesInTop(sweep(data), params.k);
        return [["Precision at k", top.positives / params.k], ["Recall at k", ratio(top.positives, data.positives)], ["Positives in the top k", top.positives], ["Tied items straddling the cut", top.split]];
      } },
    { id: "lift_at_share", kind: "tool", group: GROUP, title: "Lift and gain at a top share", help: `For the top share of items by score (rounded up to whole items): their precision, the lift over the base rate, and the gain (share of all positives they hold). Ties at the cut share their positives in proportion. ${FORMAT}`,
      inputs: [PAIRS, shareInput("share", "Top share of items (0 to 1)", { default: 0.1 })], compute: (params) => {
        const data = needPositives(parsePairs(params.pairs));
        if (!(params.share > 0)) throw new Error("Top share must be above 0.");
        const k = Math.max(1, Math.ceil(params.share * data.n - 1e-9));
        const { positives } = positivesInTop(sweep(data), k), base = data.positives / data.n;
        return [["Items in the top share", k], ["Positives in it", positives], ["Precision in it", positives / k], ["Base rate", base], ["Lift", positives / k / base], ["Gain (share of positives captured)", positives / data.positives]];
      } },
    { id: "gains_table", kind: "tool", group: GROUP, title: "Cumulative gains and lift table", help: `Cumulative positives, gain and lift for the top 1/bins, 2/bins, … of items by score (deciles by default), each rounded up to whole items. ${FORMAT}`,
      inputs: [PAIRS, { name: "bins", label: "Bins", type: "integer", min: 2, max: 100, default: 10 }], compute: (params) => {
        const data = needPositives(parsePairs(params.pairs));
        if (data.n < params.bins) throw new Error(`Paste at least as many items as bins (${params.bins}).`);
        const points = sweep(data), base = data.positives / data.n;
        const rows = [];
        for (let i = 1; i <= params.bins; i++) {
          const k = Math.ceil(i * data.n / params.bins - 1e-9), { positives } = positivesInTop(points, k);
          rows.push([i / params.bins, k, positives, positives / data.positives, positives / k / base]);
        }
        return { table: { columns: ["Top share", "Items", "Positives", "Gain", "Lift"], rows } };
      } },
    { id: "ks_statistic", kind: "tool", group: GROUP, title: "Kolmogorov-Smirnov statistic", help: `The largest gap between the score distributions of positives and negatives, max |TPR − FPR| over thresholds, with the score where it occurs and the asymptotic two-sample p-value from Kolmogorov's limiting distribution at D·√(mn / (m + n)), with no small-sample correction: approximate for small groups and conservative when scores tie. ${FORMAT}`,
      inputs: [PAIRS], compute: (params) => {
        const data = needBoth(parsePairs(params.pairs));
        let best = null, gap = -1;
        for (const point of sweep(data)) {
          const { tpr, fpr } = rates(point, data);
          if (Math.abs(tpr - fpr) > gap + 1e-12) { gap = Math.abs(tpr - fpr); best = { point, tpr, fpr }; }
        }
        const effective = data.positives * data.negatives / data.n;
        return [["KS statistic", gap], ["Threshold where it occurs (score ≥)", best.point.threshold], ["True positive rate there", best.tpr], ["False positive rate there", best.fpr],
          ["Higher scores go with", best.tpr > best.fpr ? "positives" : best.tpr < best.fpr ? "negatives" : "neither"], ["Asymptotic p-value", kolmogorovSf(gap * Math.sqrt(effective))]];
      } },
    { id: "best_threshold", kind: "tool", group: GROUP, title: "Best threshold by a criterion", help: `The distinct score that, used as a threshold, gives the highest Youden's J (TPR − FPR), the highest F1, the highest accuracy, or the ROC point closest to the top-left corner. Ties go to the higher threshold. ${FORMAT}`,
      inputs: [PAIRS, { name: "criterion", label: "Criterion", type: "select", options: [["youden", "Youden's J"], ["f1", "F1"], ["accuracy", "Accuracy"], ["corner", "Closest to the top-left corner"]], default: "youden" }],
      compute: (params) => {
        const data = needBoth(parsePairs(params.pairs));
        const score = {
          youden: (p) => p.tp / data.positives - p.fp / data.negatives,
          f1: (p) => 2 * p.tp / (2 * p.tp + p.fp + p.fn),
          accuracy: (p) => (p.tp + p.tn) / data.n,
          corner: (p) => -Math.hypot(p.fp / data.negatives, 1 - p.tp / data.positives),
        }[params.criterion];
        let best = null, value = -Infinity;
        for (const point of sweep(data)) { const v = score(point); if (v > value + 1e-12) { value = v; best = point; } }
        const { tpr, fpr, precision } = rates(best, data);
        return [["Best threshold (score ≥)", best.threshold], [params.criterion === "corner" ? "Distance to the corner" : "Criterion value", params.criterion === "corner" ? -value : value],
          ["Precision", precision], ["Recall", tpr], ["False positive rate", fpr], ["True positives", best.tp], ["False positives", best.fp], ["False negatives", best.fn], ["True negatives", best.tn]];
      } },
    { id: "threshold_for_precision", kind: "tool", group: GROUP, title: "Threshold for a target precision", help: `The lowest distinct score whose threshold still gives at least the target precision, so recall is as high as that precision allows, with the share of items it flags. ${FORMAT}`,
      inputs: [PAIRS, shareInput("target", "Target precision (0 to 1)", { default: 0.9 })], compute: (params) => {
        const data = needPositives(parsePairs(params.pairs));
        const hit = sweep(data).filter((point) => point.tp / point.flagged >= params.target - 1e-12).pop();
        if (!hit) return { rows: [["Threshold (score ≥)", null], ["Precision there", null], ["Recall there", null], ["Share of items flagged", null]], note: `No threshold reaches a precision of ${params.target}.` };
        return [["Threshold (score ≥)", hit.threshold], ["Precision there", hit.tp / hit.flagged], ["Recall there", hit.tp / data.positives], ["Share of items flagged", hit.flagged / data.n]];
      } },
    { id: "threshold_for_recall", kind: "tool", group: GROUP, title: "Threshold for a target recall", help: `The highest distinct score whose threshold still catches at least the target share of positives, so as few items as possible are flagged. ${FORMAT}`,
      inputs: [PAIRS, shareInput("target", "Target recall (0 to 1)", { default: 0.9 })], compute: (params) => {
        const data = needPositives(parsePairs(params.pairs));
        const hit = sweep(data).find((point) => point.tp / data.positives >= params.target - 1e-12);
        return [["Threshold (score ≥)", hit.threshold], ["Recall there", hit.tp / data.positives], ["Precision there", hit.tp / hit.flagged],
          ["False positive rate there", ratio(hit.fp, data.negatives)], ["Share of items flagged", hit.flagged / data.n]];
      } },
    { id: "threshold_for_fpr", kind: "tool", group: GROUP, title: "Threshold for a false positive cap", help: `The lowest distinct score whose threshold keeps the false positive rate at or below a cap, so the true positive rate is as high as the cap allows. ${FORMAT}`,
      inputs: [PAIRS, shareInput("cap", "Largest false positive rate (0 to 1)", { default: 0.05 })], compute: (params) => {
        const data = needBoth(parsePairs(params.pairs));
        const hit = sweep(data).filter((point) => point.fp / data.negatives <= params.cap + 1e-12).pop();
        if (!hit) return { rows: [["Threshold (score ≥)", null], ["False positive rate there", null], ["True positive rate there", null], ["Precision there", null]], note: `Even the top score has a false positive rate above ${params.cap}.` };
        return [["Threshold (score ≥)", hit.threshold], ["False positive rate there", hit.fp / data.negatives], ["True positive rate there", hit.tp / data.positives], ["Precision there", hit.tp / hit.flagged]];
      } },
    { id: "equal_error_rate", kind: "tool", group: GROUP, title: "Equal error rate", help: `The distinct score whose threshold brings the false positive rate and the false negative rate closest together, and their mean there. Ties go to the higher threshold. ${FORMAT}`,
      inputs: [PAIRS], compute: (params) => {
        const data = needBoth(parsePairs(params.pairs));
        let best = null, gap = Infinity;
        for (const point of sweep(data)) {
          const fpr = point.fp / data.negatives, fnr = point.fn / data.positives;
          if (Math.abs(fpr - fnr) < gap - 1e-12) { gap = Math.abs(fpr - fnr); best = { point, fpr, fnr }; }
        }
        return [["Equal error rate", (best.fpr + best.fnr) / 2], ["Threshold (score ≥)", best.point.threshold], ["False positive rate there", best.fpr], ["False negative rate there", best.fnr]];
      } },
    { id: "score_histogram", kind: "tool", group: GROUP, title: "Score histogram by label", help: `Counts positives and negatives in equal-width score bins from the lowest to the highest score; each bin holds scores from its lower edge up to, not including, its upper edge, and the last bin includes the top score. ${FORMAT}`,
      inputs: [PAIRS, { name: "bins", label: "Bins", type: "integer", min: 1, max: 50, default: 10 }, { name: "shares", label: "Show shares of each label instead of counts", type: "checkbox" }],
      compute: (params) => {
        const data = parsePairs(params.pairs);
        const low = minOf(data.scores), high = maxOf(data.scores);
        if (!Number.isFinite(high - low)) throw new Error("The scores span too wide a range to bin.");
        const bins = high > low ? params.bins : 1;
        const edge = (i) => (i >= bins ? high : low + (high - low) * i / bins);
        const counts = Array.from({ length: bins }, () => [0, 0]);
        const slack = (high - low) * 1e-9;   // an edge such as 0.1 + 0.2 = 0.30000000000000004 still takes the score 0.3
        data.scores.forEach((score, index) => {
          let bin = Math.min(bins - 1, Math.floor((score - low) / (high - low || 1) * bins));
          while (bin + 1 < bins && score >= edge(bin + 1) - slack) bin++;
          while (bin > 0 && score < edge(bin) - slack) bin--;
          counts[bin][data.labels[index] ? 0 : 1]++;
        });
        return { table: { columns: ["Score from", "Score to", params.shares ? "Share of positives" : "Positives", params.shares ? "Share of negatives" : "Negatives"],
          rows: counts.map(([pos, neg], i) => [edge(i), edge(i + 1), params.shares ? dash(ratio(pos, data.positives)) : pos, params.shares ? dash(ratio(neg, data.negatives)) : neg]) } };
      } },
    { id: "concordance", kind: "tool", group: GROUP, title: "Concordant pairs and Somers' D", help: `Over every positive-negative pair: concordant (the positive scores higher), discordant and tied pairs, Somers' D = (C − D) / pairs (also called the Gini coefficient or accuracy ratio, 2·AUC − 1), Goodman-Kruskal gamma and the concordance index. ${FORMAT}`,
      inputs: [PAIRS], compute: (params) => {
        const data = needBoth(parsePairs(params.pairs));
        const negatives = data.scores.filter((_, index) => !data.labels[index]).sort((a, b) => a - b);
        const below = (score, strict) => { let lo = 0, hi = negatives.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (strict ? negatives[mid] < score : negatives[mid] <= score) lo = mid + 1; else hi = mid; } return lo; };
        let concordant = 0, tied = 0;
        data.scores.forEach((score, index) => {
          if (!data.labels[index]) return;
          const less = below(score, true), notMore = below(score, false);
          concordant += less; tied += notMore - less;
        });
        const pairs = data.positives * data.negatives, discordant = pairs - concordant - tied;
        return [["Positive-negative pairs", pairs], ["Concordant pairs", concordant], ["Discordant pairs", discordant], ["Tied pairs", tied],
          ["Somers' D (Gini)", (concordant - discordant) / pairs], ["Goodman-Kruskal gamma", ratio(concordant - discordant, concordant + discordant)],
          ["Concordance index (C)", (concordant + tied / 2) / pairs]];
      } },
    { id: "partial_auc", kind: "tool", group: GROUP, title: "Partial AUC up to a false positive rate", help: `The area under the ROC curve from a false positive rate of 0 up to a cap (trapezoids, interpolated at the cap), and McClish's standardized form, which scikit-learn's roc_auc_score(max_fpr=…) returns: 0.5 for chance, 1 for perfect. ${FORMAT}`,
      inputs: [PAIRS, shareInput("cap", "Largest false positive rate (0 to 1)", { default: 0.1 })], compute: (params) => {
        const data = needBoth(parsePairs(params.pairs)), cap = params.cap;
        if (!(cap > 0)) throw new Error("The false positive rate cap must be above 0.");
        const points = [[0, 0], ...sweep(data).map((point) => [point.fp / data.negatives, point.tp / data.positives])];
        let area = 0;
        for (let i = 1; i < points.length; i++) {
          const [x0, y0] = points[i - 1], [x1, y1] = points[i];
          if (x0 >= cap) break;
          if (x1 <= cap) area += (x1 - x0) * (y0 + y1) / 2;
          else { const y = y0 + (y1 - y0) * (cap - x0) / (x1 - x0); area += (cap - x0) * (y0 + y) / 2; break; }
        }
        const least = cap * cap / 2;
        return [["Partial AUC", area], ["Largest possible", cap], ["Chance level", least], ["Standardized partial AUC (McClish)", 0.5 * (1 + (area - least) / (cap - least))]];
      } },
    { id: "metrics_at_threshold", kind: "tool", group: GROUP, title: "Metrics at a threshold", help: `The confusion matrix and the usual rates when every item scoring at or above a threshold is predicted positive. ${FORMAT}`,
      inputs: [PAIRS, { name: "threshold", label: "Threshold (score ≥)", type: "number", default: 0.5 }], compute: (params) => {
        const data = parsePairs(params.pairs);
        let tp = 0, fp = 0;
        data.scores.forEach((score, index) => { if (score >= params.threshold) { if (data.labels[index]) tp++; else fp++; } });
        const fn = data.positives - tp, tn = data.negatives - fp;
        return [["True positives", tp], ["False positives", fp], ["False negatives", fn], ["True negatives", tn], ["Precision", ratio(tp, tp + fp)], ["Recall", ratio(tp, data.positives)],
          ["Specificity", ratio(tn, data.negatives)], ["F1", ratio(2 * tp, 2 * tp + fp + fn)], ["Accuracy", (tp + tn) / data.n], ["Share predicted positive", (tp + fp) / data.n]];
      } },
    { id: "lowest_cost_threshold", kind: "tool", group: GROUP, title: "Threshold with the lowest cost", help: `Prices each false positive and false negative and finds the distinct score (or flagging nothing) whose threshold costs least; ties go to flagging fewer items. ${FORMAT}`,
      inputs: [PAIRS, { name: "cost_fp", label: "Price of a false positive", type: "number", min: 0, default: 1 }, { name: "cost_fn", label: "Price of a false negative", type: "number", min: 0, default: 1 }],
      compute: (params) => {
        const data = parsePairs(params.pairs);
        const cost = (point) => point.fp * params.cost_fp + point.fn * params.cost_fn;
        const nothing = { threshold: TOP, fp: 0, fn: data.positives };
        let best = nothing, lowest = cost(nothing);
        for (const point of sweep(data)) { const value = cost(point); if (value < lowest - 1e-12 * Math.max(1, Math.abs(lowest))) { lowest = value; best = point; } }
        return [["Best threshold (score ≥)", best.threshold], ["Total cost", lowest], ["Cost per item", lowest / data.n], ["False positives", best.fp], ["False negatives", best.fn],
          ["Cost of flagging nothing", cost(nothing)], ["Cost of flagging everything", data.negatives * params.cost_fp]];
      } },
    { id: "review_band", kind: "tool", group: GROUP, title: "Two thresholds with a review band", help: `Scores at or above the upper threshold are decided positive, scores below the lower threshold negative, and everything between goes to a person. Shows how much is automated and how accurate the automated decisions are. ${FORMAT}`,
      inputs: [PAIRS, { name: "low", label: "Lower threshold (below it: negative)", type: "number" }, { name: "high", label: "Upper threshold (at or above it: positive)", type: "number" }],
      compute: (params) => {
        if (params.low > params.high) throw new Error("The lower threshold must not be above the upper threshold.");
        const data = parsePairs(params.pairs);
        let positive = 0, truePositive = 0, negative = 0, trueNegative = 0;
        data.scores.forEach((score, index) => {
          if (score >= params.high) { positive++; if (data.labels[index]) truePositive++; } else if (score < params.low) { negative++; if (!data.labels[index]) trueNegative++; }
        });
        const automated = positive + negative;
        return [["Decided positive", positive], ["Precision of those", ratio(truePositive, positive)], ["Decided negative", negative], ["Negative predictive value of those", ratio(trueNegative, negative)],
          ["Sent to review", data.n - automated], ["Automated share", automated / data.n], ["Accuracy of automated decisions", ratio(truePositive + trueNegative, automated)]];
      } },
    { id: "score_summary", kind: "tool", group: GROUP, title: "Score summary by label", help: `Count, mean, median and sample standard deviation of the scores of positives and of negatives, the gap between their means, and Cohen's d (that gap over the pooled standard deviation). ${FORMAT}`,
      inputs: [PAIRS], compute: (params) => {
        const data = parsePairs(params.pairs);
        const pos = data.scores.filter((_, index) => data.labels[index]), neg = data.scores.filter((_, index) => !data.labels[index]);
        const sdPos = pos.length > 1 ? stdev(pos) : null, sdNeg = neg.length > 1 ? stdev(neg) : null;
        const gap = pos.length && neg.length ? mean(pos) - mean(neg) : null;
        const df = pos.length + neg.length - 2;
        const pooled = gap !== null && df > 0 ? Math.sqrt(((pos.length - 1) * (sdPos ?? 0) ** 2 + (neg.length - 1) * (sdNeg ?? 0) ** 2) / df) : null;
        return [["Positives", pos.length], ["Mean score of positives", mean(pos)], ["Median score of positives", median(pos)], ["Standard deviation of positives", sdPos],
          ["Negatives", neg.length], ["Mean score of negatives", mean(neg)], ["Median score of negatives", median(neg)], ["Standard deviation of negatives", sdNeg],
          ["Difference of means", gap], ["Cohen's d", pooled ? gap / pooled : null]];
      } },
    { id: "ndcg_at_k", kind: "tool", group: GROUP, title: "NDCG at k", help: `Normalized discounted cumulative gain of the ranking with positives as gain 1: Σ gain / log₂(rank + 1) over the top k, over the same sum for a perfect ranking. Tied scores share their discounts, as scikit-learn's ndcg_score does. Leave k blank for the whole list. ${FORMAT}`,
      inputs: [PAIRS, { name: "k", label: "k (items at the top, blank for all)", type: "integer", min: 1, optional: true }], compute: (params) => {
        const data = needPositives(parsePairs(params.pairs));
        const k = Math.min(params.k ?? data.n, data.n);
        const discount = (rank) => (rank <= k ? 1 / Math.log2(rank + 1) : 0);
        let dcg = 0, start = 0;
        for (const point of sweep(data)) {
          let sum = 0;
          for (let rank = start + 1; rank <= Math.min(point.flagged, k); rank++) sum += discount(rank);
          dcg += point.groupPositives / point.size * sum;
          start = point.flagged;
          if (start >= k) break;
        }
        let ideal = 0;
        for (let rank = 1; rank <= Math.min(data.positives, k); rank++) ideal += discount(rank);
        return [["NDCG at k", dcg / ideal], ["DCG at k", dcg], ["Ideal DCG at k", ideal], ["k", k]];
      } },
  ],
});
