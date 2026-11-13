// Toolbox: classification metrics from confusion matrices. Every tool is pure: it reads only the counts, prices or
// pasted rows typed into its form, never page data, and it never calls the model.
import { compareText, definePack, toNumber } from "../../kit.js";
import { binomialCdf, chiSquareSf, normalQuantile } from "../../lib/math.js";

const GROUP = "Classification metrics";
const MAX_COUNT = 1e12;

// ---------- inputs ----------

const CELLS = [
  { name: "tp", label: "True positives (TP)", type: "integer", min: 0, max: MAX_COUNT, placeholder: "e.g. 40" },
  { name: "fp", label: "False positives (FP)", type: "integer", min: 0, max: MAX_COUNT, placeholder: "e.g. 10" },
  { name: "fn", label: "False negatives (FN)", type: "integer", min: 0, max: MAX_COUNT, placeholder: "e.g. 20" },
  { name: "tn", label: "True negatives (TN)", type: "integer", min: 0, max: MAX_COUNT, placeholder: "e.g. 30" },
];
const LEVEL = { name: "level", label: "Interval confidence", type: "select", options: [["0.95", "95%"], ["0.9", "90%"], ["0.99", "99%"]], default: "0.95" };
const SHARE = (name, label, placeholder) => ({ name, label, type: "number", min: 0, max: 1, placeholder });

const MATRIX_FORMAT = "Paste one row per actual class and one column per predicted class, separated by tabs, commas, semicolons or spaces. "
  + "An optional first row names the predicted classes (start it with a blank cell when the names are numbers) and an optional first column names the actual classes.";
const MATRIX_INPUT = { name: "matrix", label: "Confusion matrix (rows actual, columns predicted)", type: "textarea", rows: 6, required: true,
  placeholder: ",cat,dog,bird\ncat,8,1,1\ndog,2,6,2\nbird,0,1,9" };
const PAIRS_FORMAT = "Paste one item per line as label,prediction (tab, comma, semicolon or space between them); a header line such as label,prediction is skipped.";
const PAIRS_INPUT = { name: "pairs", label: "Label and prediction pairs", type: "textarea", rows: 8, required: true, placeholder: "label,prediction\nrefund,refund\nrefund,other\nother,other" };

// ---------- small numerics ----------

const ratio = (top, bottom) => (bottom > 0 ? top / bottom : null);
const zOf = (level) => normalQuantile(1 - (1 - level) / 2);
const percentOf = (level) => `${Math.round(level * 100)}%`;
const levelOf = (params) => Number(params.level || "0.95");

// The Wilson score interval for k successes in n trials; [null, null] when n is 0.
function wilson(k, n, level) {
  if (!(n > 0)) return [null, null];
  const z = zOf(level), p = k / n, z2 = z * z, scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale;
  const half = (z / scale) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// A ratio estimate with a log-scale interval: exp(ln(value) -+ z * se). Null parts when it is undefined.
function logInterval(value, se, level) {
  if (value === null || !(value > 0) || se === null || !Number.isFinite(se)) return [null, null];
  const z = zOf(level), centre = Math.log(value);
  return [Math.exp(centre - z * se), Math.exp(centre + z * se)];
}

// The four cells with their total. A matrix of zeros has nothing to measure.
function cellsOf(params) {
  const { tp, fp, fn, tn } = params;
  const n = tp + fp + fn + tn;
  if (n === 0) throw new Error("Enter at least one count above zero.");
  return { tp, fp, fn, tn, n };
}

// ---------- the 2x2 metrics, shared by the single tools and the report ----------

const proportion = (k, n) => (level) => {
  const [low, high] = wilson(k, n, level);
  return { value: ratio(k, n), low, high, k, n };
};
const plain = (value) => () => ({ value, low: null, high: null });

function f1Of(c) { return ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn); }
function fBetaOf(c, beta) {
  const b2 = beta * beta;
  return ratio((1 + b2) * c.tp, (1 + b2) * c.tp + b2 * c.fn + c.fp);
}
function sumOrNull(...values) { return values.some((value) => value === null) ? null : values.reduce((a, b) => a + b, 0); }
function mccOf(c) {
  const factors = [c.tp + c.fp, c.tp + c.fn, c.tn + c.fp, c.tn + c.fn];
  if (factors.some((factor) => factor === 0)) return null;
  return (c.tp * c.tn - c.fp * c.fn) / factors.reduce((product, factor) => product * Math.sqrt(factor), 1);
}
function lrPositive(c, level) {
  const tpr = ratio(c.tp, c.tp + c.fn), fpr = ratio(c.fp, c.fp + c.tn);
  const value = tpr === null || fpr === null || fpr === 0 ? null : tpr / fpr;
  const se = c.tp > 0 && c.fp > 0 ? Math.sqrt(1 / c.tp - 1 / (c.tp + c.fn) + 1 / c.fp - 1 / (c.fp + c.tn)) : null;
  const [low, high] = logInterval(value, se, level);
  return { value, low, high };
}
function lrNegative(c, level) {
  const fnr = ratio(c.fn, c.tp + c.fn), tnr = ratio(c.tn, c.fp + c.tn);
  const value = fnr === null || tnr === null || tnr === 0 ? null : fnr / tnr;
  const se = c.fn > 0 && c.tn > 0 ? Math.sqrt(1 / c.fn - 1 / (c.tp + c.fn) + 1 / c.tn - 1 / (c.fp + c.tn)) : null;
  const [low, high] = logInterval(value, se, level);
  return { value, low, high };
}
function oddsRatio(c, level) {
  const value = c.fp * c.fn > 0 ? (c.tp * c.tn) / (c.fp * c.fn) : null;
  const se = c.tp > 0 && c.fp > 0 && c.fn > 0 && c.tn > 0 ? Math.sqrt(1 / c.tp + 1 / c.fp + 1 / c.fn + 1 / c.tn) : null;
  const [low, high] = logInterval(value, se, level);
  return { value, low, high };
}
function kappaOf(c, level) {
  const po = (c.tp + c.tn) / c.n;
  const pe = ((c.tp + c.fp) * (c.tp + c.fn) + (c.fn + c.tn) * (c.fp + c.tn)) / (c.n * c.n);
  if (pe >= 1) return { po, pe, value: null, low: null, high: null };
  const value = (po - pe) / (1 - pe);
  const se = Math.sqrt(po * (1 - po) / (c.n * (1 - pe) * (1 - pe)));
  const z = zOf(level);
  return { po, pe, value, low: Math.max(-1, value - z * se), high: Math.min(1, value + z * se) };
}

const METRICS = [
  ["Accuracy", (c) => proportion(c.tp + c.tn, c.n)],
  ["Error rate", (c) => proportion(c.fp + c.fn, c.n)],
  ["Precision", (c) => proportion(c.tp, c.tp + c.fp)],
  ["Recall", (c) => proportion(c.tp, c.tp + c.fn)],
  ["Specificity", (c) => proportion(c.tn, c.tn + c.fp)],
  ["Negative predictive value", (c) => proportion(c.tn, c.tn + c.fn)],
  ["False positive rate", (c) => proportion(c.fp, c.fp + c.tn)],
  ["False negative rate", (c) => proportion(c.fn, c.fn + c.tp)],
  ["False discovery rate", (c) => proportion(c.fp, c.fp + c.tp)],
  ["False omission rate", (c) => proportion(c.fn, c.fn + c.tn)],
  ["Prevalence", (c) => proportion(c.tp + c.fn, c.n)],
  ["Threat score", (c) => proportion(c.tp, c.tp + c.fp + c.fn)],
  ["F1", (c) => plain(f1Of(c))],
  ["Balanced accuracy", (c) => { const s = sumOrNull(ratio(c.tp, c.tp + c.fn), ratio(c.tn, c.tn + c.fp)); return plain(s === null ? null : s / 2); }],
  ["Matthews correlation", (c) => plain(mccOf(c))],
  ["Youden's J", (c) => { const s = sumOrNull(ratio(c.tp, c.tp + c.fn), ratio(c.tn, c.tn + c.fp)); return plain(s === null ? null : s - 1); }],
  ["Markedness", (c) => { const s = sumOrNull(ratio(c.tp, c.tp + c.fp), ratio(c.tn, c.tn + c.fn)); return plain(s === null ? null : s - 1); }],
  ["Fowlkes-Mallows index", (c) => plain(c.tp + c.fp > 0 && c.tp + c.fn > 0 ? c.tp / (Math.sqrt(c.tp + c.fp) * Math.sqrt(c.tp + c.fn)) : null)],
  ["Positive likelihood ratio", (c) => (level) => lrPositive(c, level)],
  ["Negative likelihood ratio", (c) => (level) => lrNegative(c, level)],
  ["Diagnostic odds ratio", (c) => (level) => oddsRatio(c, level)],
  ["Cohen's kappa", (c) => (level) => kappaOf(c, level)],
];
const metric = (name, c, level) => METRICS.find(([label]) => label === name)[1](c)(level);

// Rows for a proportion: the value, what was counted, and its Wilson interval.
function proportionRows(label, c, level) {
  const result = metric(label, c, level);
  return [[label, result.value], [`${label}: counted`, `${result.k} of ${result.n}`],
    [`${percentOf(level)} Wilson interval, low`, result.low], [`${percentOf(level)} Wilson interval, high`, result.high]];
}

function proportionTool(id, label, title, help, extra = () => []) {
  return { id, kind: "tool", group: GROUP, title, help: `${help} The interval is the Wilson score interval; a zero denominator shows as —.`,
    inputs: [...CELLS, LEVEL], compute: (params) => { const c = cellsOf(params); return [...proportionRows(label, c, levelOf(params)), ...extra(c)]; } };
}

function ratioTool(id, label, title, help) {
  return { id, kind: "tool", group: GROUP, title, help, inputs: [...CELLS, LEVEL], compute: (params) => {
    const c = cellsOf(params), level = levelOf(params), result = metric(label, c, level);
    return [[label, result.value], [`${percentOf(level)} log-method interval, low`, result.low], [`${percentOf(level)} log-method interval, high`, result.high]];
  } };
}

// ---------- pasted tables ----------

function splitterFor(text) {
  for (const delimiter of ["\t", ",", ";"]) if (text.includes(delimiter)) return (line) => line.split(delimiter).map((cell) => cell.trim());
  return (line) => line.trim().split(/\s+/);
}
const linesOf = (text) => String(text ?? "").split(/\r\n|\n|\r/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.trim() !== "");

function countCell(cell, where) {
  const value = toNumber(cell);
  if (value === null || !Number.isInteger(value) || value < 0 || value > MAX_COUNT) throw new Error(`${where}: "${cell}" is not a whole count of 0 or more.`);
  return value;
}

// A square confusion matrix with class names: { names, m } with m[actual][predicted].
function parseMatrix(text) {
  const lines = linesOf(text);
  if (!lines.length) throw new Error(`Paste a confusion matrix. ${MATRIX_FORMAT}`);
  const split = splitterFor(String(text));
  const rows = lines.map(({ line, number }) => ({ cells: split(line), number }));
  let header = null;
  // A first row with a blank corner cell (",0,1") is a header even when the class names are numbers, and then the
  // rows start with their class names too.
  const blankCorner = rows[0].cells.length > 1 && rows[0].cells[0] === "";
  if (blankCorner || rows[0].cells.some((cell, index) => index > 0 && toNumber(cell) === null) || rows[0].cells.every((cell) => toNumber(cell) === null)) header = rows.shift();
  if (rows.length < 2) throw new Error("A confusion matrix needs at least two classes.");
  const labelled = rows.map((row) => blankCorner || toNumber(row.cells[0]) === null);
  if (labelled.some((value) => value !== labelled[0])) throw new Error("Either every row starts with a class name or none does.");
  const k = rows.length;
  const m = rows.map((row) => {
    const values = labelled[0] ? row.cells.slice(1) : row.cells;
    if (values.length !== k) throw new Error(`Line ${row.number}: expected ${k} counts (one per class), found ${values.length}.`);
    return values.map((cell) => countCell(cell, `Line ${row.number}`));
  });
  const rowNames = labelled[0] ? rows.map((row) => row.cells[0]) : null;
  let headNames = null;
  if (header) {
    const cells = header.cells.length === k + 1 ? header.cells.slice(1) : header.cells;
    if (cells.length !== k) throw new Error(`Line ${header.number}: the header names ${cells.length} classes but the matrix has ${k} rows.`);
    headNames = cells;
  }
  if (rowNames && headNames && rowNames.some((name, index) => name !== headNames[index])) throw new Error("Row and column class names differ; list the classes in the same order both ways.");
  const names = rowNames || headNames || m.map((_, index) => `Class ${index + 1}`);
  if (new Set(names).size !== names.length || names.some((name) => name === "")) throw new Error("Every class needs a distinct, nonblank name.");
  if (m.every((row) => row.every((value) => value === 0))) throw new Error("Enter at least one count above zero.");
  return { names, m };
}

const HEADER_LABELS = new Set(["label", "labels", "actual", "true", "truth", "y_true", "expected", "gold"]);
const HEADER_PREDICTIONS = new Set(["prediction", "predictions", "predicted", "pred", "y_pred", "guess"]);

// Pasted label,prediction pairs as [[label, prediction], ...].
function parsePairs(text) {
  const lines = linesOf(text);
  const split = splitterFor(String(text));
  const pairs = [];
  lines.forEach(({ line, number }, index) => {
    const cells = split(line);
    if (index === 0 && cells.length === 2 && HEADER_LABELS.has(cells[0].toLowerCase()) && HEADER_PREDICTIONS.has(cells[1].toLowerCase())) return;
    if (cells.length !== 2 || cells[0] === "" || cells[1] === "") throw new Error(`Line ${number}: expected two values, a label and a prediction.`);
    pairs.push(cells);
  });
  if (!pairs.length) throw new Error(`Paste at least one pair. ${PAIRS_FORMAT}`);
  return pairs;
}

function perClass({ m }) {
  const support = m.map((row) => row.reduce((a, b) => a + b, 0));
  const predicted = m[0].map((_, j) => m.reduce((total, row) => total + row[j], 0));
  return m.map((row, i) => ({ tp: row[i], support: support[i], predicted: predicted[i],
    precision: ratio(row[i], predicted[i]), recall: ratio(row[i], support[i]), f1: ratio(2 * row[i], support[i] + predicted[i]) }));
}

const dash = (value) => (value === null ? "—" : value);

// ---------- the pack ----------

export default definePack({
  id: "tb-classification",
  surface: "workbench.toolbox",
  title: "Classification metrics",
  about: "Toolbox calculators for classification metrics from confusion-matrix counts, pasted multi-class matrices or label,prediction pairs, with Wilson and log-method intervals. They read only what you type into them and never call the model.",
  features: [
    proportionTool("accuracy", "Accuracy", "Accuracy with an interval", "Share of all items the classifier got right: (TP + TN) / all items. Also shows the accuracy of always predicting the larger class.",
      (c) => [["Accuracy of always predicting the larger class", Math.max(c.tp + c.fn, c.fp + c.tn) / c.n]]),
    proportionTool("error_rate", "Error rate", "Error rate with an interval", "Share of all items the classifier got wrong: (FP + FN) / all items."),
    proportionTool("precision", "Precision", "Precision with an interval", "Share of predicted positives that are positive: TP / (TP + FP). Also called positive predictive value."),
    proportionTool("recall", "Recall", "Recall with an interval", "Share of actual positives the classifier caught: TP / (TP + FN). Also called sensitivity or true positive rate."),
    proportionTool("specificity", "Specificity", "Specificity with an interval", "Share of actual negatives predicted negative: TN / (TN + FP). Also called true negative rate."),
    proportionTool("npv", "Negative predictive value", "Negative predictive value with an interval", "Share of predicted negatives that are negative: TN / (TN + FN)."),
    proportionTool("fpr", "False positive rate", "False positive rate with an interval", "Share of actual negatives wrongly flagged: FP / (FP + TN). Also called fall-out."),
    proportionTool("fnr", "False negative rate", "False negative rate with an interval", "Share of actual positives missed: FN / (FN + TP). Also called miss rate."),
    proportionTool("fdr", "False discovery rate", "False discovery rate with an interval", "Share of predicted positives that are wrong: FP / (FP + TP)."),
    proportionTool("false_omission_rate", "False omission rate", "False omission rate with an interval", "Share of predicted negatives that are actually positive: FN / (FN + TN)."),
    proportionTool("prevalence", "Prevalence", "Prevalence with an interval", "Share of items that are actually positive: (TP + FN) / all items. Also shows the share the classifier predicted positive.",
      (c) => [["Predicted positive share", (c.tp + c.fp) / c.n]]),
    proportionTool("threat_score", "Threat score", "Threat score (critical success index) with an interval", "TP / (TP + FP + FN): true positives among items that are positive in the labels or the predictions. Also called the Jaccard index or critical success index."),
    { id: "f1", kind: "tool", group: GROUP, title: "F1 score", help: "The harmonic mean of precision and recall: 2TP / (2TP + FP + FN). — when TP, FP and FN are all zero.",
      inputs: CELLS, compute: (params) => { const c = cellsOf(params); return [["F1", f1Of(c)], ["Precision", ratio(c.tp, c.tp + c.fp)], ["Recall", ratio(c.tp, c.tp + c.fn)]]; } },
    { id: "f_beta", kind: "tool", group: GROUP, title: "F-beta score", help: "(1 + β²)TP / ((1 + β²)TP + β²FN + FP). β above 1 weighs recall more, below 1 precision more (β = 2 counts recall twice as much).",
      inputs: [...CELLS, { name: "beta", label: "β (weight of recall)", type: "number", min: 0.01, max: 100, default: 2 }],
      compute: (params) => { const c = cellsOf(params); return [["F-beta score", fBetaOf(c, params.beta)], ["β", params.beta], ["Precision", ratio(c.tp, c.tp + c.fp)], ["Recall", ratio(c.tp, c.tp + c.fn)]]; } },
    { id: "balanced_accuracy", kind: "tool", group: GROUP, title: "Balanced accuracy", help: "The mean of recall and specificity, which is not inflated by a large majority class. — when either class is empty.",
      inputs: CELLS, compute: (params) => { const c = cellsOf(params); return [["Balanced accuracy", metric("Balanced accuracy", c, 0.95).value], ["Recall", ratio(c.tp, c.tp + c.fn)], ["Specificity", ratio(c.tn, c.tn + c.fp)]]; } },
    { id: "mcc", kind: "tool", group: GROUP, title: "Matthews correlation coefficient", help: "(TP·TN − FP·FN) / √((TP+FP)(TP+FN)(TN+FP)(TN+FN)), from −1 (always wrong) through 0 (chance) to 1 (perfect). — when any row or column of the matrix is empty.",
      inputs: CELLS, compute: (params) => [["Matthews correlation", mccOf(cellsOf(params))]] },
    { id: "youden_j", kind: "tool", group: GROUP, title: "Youden's J (informedness)", help: "Recall + specificity − 1: 0 for a classifier no better than chance, 1 for a perfect one.",
      inputs: CELLS, compute: (params) => { const c = cellsOf(params); return [["Youden's J", metric("Youden's J", c, 0.95).value], ["Recall", ratio(c.tp, c.tp + c.fn)], ["Specificity", ratio(c.tn, c.tn + c.fp)]]; } },
    { id: "markedness", kind: "tool", group: GROUP, title: "Markedness", help: "Precision + negative predictive value − 1: how much a prediction tells you beyond chance.",
      inputs: CELLS, compute: (params) => { const c = cellsOf(params); return [["Markedness", metric("Markedness", c, 0.95).value], ["Precision", ratio(c.tp, c.tp + c.fp)], ["Negative predictive value", ratio(c.tn, c.tn + c.fn)]]; } },
    ratioTool("lr_positive", "Positive likelihood ratio", "Positive likelihood ratio", "Recall / false positive rate: how much a positive prediction raises the odds that an item is positive. The interval is the log method (Simel et al.). The ratio is — when FP is zero; the interval is — when TP or FP is zero."),
    ratioTool("lr_negative", "Negative likelihood ratio", "Negative likelihood ratio", "False negative rate / specificity: how much a negative prediction lowers the odds. The interval is the log method (Simel et al.). The ratio is — when TN is zero; the interval is — when FN or TN is zero."),
    ratioTool("diagnostic_odds", "Diagnostic odds ratio", "Diagnostic odds ratio", "(TP·TN) / (FP·FN), the positive over the negative likelihood ratio. The interval is Woolf's log method. The ratio is — when FP or FN is zero; the interval is — when any cell is zero."),
    { id: "fowlkes_mallows", kind: "tool", group: GROUP, title: "Fowlkes-Mallows index", help: "The geometric mean of precision and recall: TP / √((TP + FP)(TP + FN)).",
      inputs: CELLS, compute: (params) => { const c = cellsOf(params); return [["Fowlkes-Mallows index", metric("Fowlkes-Mallows index", c, 0.95).value], ["Precision", ratio(c.tp, c.tp + c.fp)], ["Recall", ratio(c.tp, c.tp + c.fn)]]; } },
    { id: "cohen_kappa", kind: "tool", group: GROUP, title: "Cohen's kappa against labels", help: "Agreement between the classifier and the labels beyond what their positive rates give by chance: (observed − chance) / (1 − chance). The interval uses Cohen's large-sample standard error.",
      inputs: [...CELLS, LEVEL], compute: (params) => {
        const c = cellsOf(params), level = levelOf(params), k = kappaOf(c, level);
        return [["Observed agreement", k.po], ["Chance agreement", k.pe], ["Cohen's kappa", k.value],
          [`${percentOf(level)} interval, low`, k.low], [`${percentOf(level)} interval, high`, k.high]];
      } },
    { id: "report", kind: "tool", group: GROUP, title: "Every metric of a 2x2 confusion matrix", help: "One table of all the metrics above for the same TP, FP, FN and TN, with Wilson intervals for proportions and log-method intervals for ratios. — marks a value that is undefined.",
      inputs: [...CELLS, LEVEL], compute: (params) => {
        const c = cellsOf(params), level = levelOf(params);
        return { table: { columns: ["Metric", "Value", `${percentOf(level)} low`, `${percentOf(level)} high`],
          rows: METRICS.map(([name, make]) => { const result = make(c)(level); return [name, dash(result.value), dash(result.low), dash(result.high)]; }) } };
      } },
    { id: "per_class", kind: "tool", group: GROUP, title: "Per-class precision, recall and F1", help: `Precision, recall and F1 of every class of a multi-class confusion matrix, with each class's support (actual count) and predicted count. ${MATRIX_FORMAT}`,
      inputs: [MATRIX_INPUT], compute: (params) => {
        const parsed = parseMatrix(params.matrix);
        return { table: { columns: ["Class", "Support", "Predicted", "Precision", "Recall", "F1"],
          rows: perClass(parsed).map((entry, i) => [parsed.names[i], entry.support, entry.predicted, dash(entry.precision), dash(entry.recall), dash(entry.f1)]) } };
      } },
    { id: "class_averages", kind: "tool", group: GROUP, title: "Macro, weighted and micro averages", help: `Macro (plain mean over classes), weighted (by support) and micro (pooled counts) precision, recall and F1 of a multi-class confusion matrix. An undefined per-class value counts as 0, as in scikit-learn. ${MATRIX_FORMAT}`,
      inputs: [MATRIX_INPUT], compute: (params) => {
        const parsed = parseMatrix(params.matrix), classes = perClass(parsed);
        const total = classes.reduce((sum, entry) => sum + entry.support, 0);
        const correct = classes.reduce((sum, entry) => sum + entry.tp, 0);
        const macro = (key) => classes.reduce((sum, entry) => sum + (entry[key] ?? 0), 0) / classes.length;
        const weighted = (key) => classes.reduce((sum, entry) => sum + (entry[key] ?? 0) * entry.support, 0) / total;
        const undefinedPrecision = classes.filter((entry) => entry.precision === null).length;
        const undefinedRecall = classes.filter((entry) => entry.recall === null).length;
        const notes = [];
        if (undefinedPrecision) notes.push(`${undefinedPrecision} class${undefinedPrecision === 1 ? " was" : "es were"} never predicted, so precision counted as 0`);
        if (undefinedRecall) notes.push(`${undefinedRecall} class${undefinedRecall === 1 ? " has" : "es have"} no actual items, so recall counted as 0`);
        const micro = correct / total;
        return { rows: [["Macro precision", macro("precision")], ["Macro recall", macro("recall")], ["Macro F1", macro("f1")],
          ["Weighted precision", weighted("precision")], ["Weighted recall", weighted("recall")], ["Weighted F1", weighted("f1")],
          ["Micro precision", micro], ["Micro recall", micro], ["Micro F1", micro]],
        note: notes.length ? `${notes.join("; ")}.` : null };
      } },
    { id: "multiclass_agreement", kind: "tool", group: GROUP, title: "Multi-class accuracy, kappa and MCC", help: `Accuracy (with a Wilson interval), Cohen's kappa and the multi-class Matthews correlation (Gorodkin's R_K, as scikit-learn computes it) of a multi-class confusion matrix. ${MATRIX_FORMAT}`,
      inputs: [MATRIX_INPUT, LEVEL], compute: (params) => {
        const { m } = parseMatrix(params.matrix), level = levelOf(params);
        const s = m.flat().reduce((a, b) => a + b, 0), c = m.reduce((sum, row, i) => sum + row[i], 0);
        const t = m.map((row) => row.reduce((a, b) => a + b, 0)), p = m[0].map((_, j) => m.reduce((sum, row) => sum + row[j], 0));
        const tp = t.reduce((sum, value, i) => sum + value * p[i], 0);
        const pe = tp / (s * s);
        const denominator = Math.sqrt(s * s - p.reduce((sum, value) => sum + value * value, 0)) * Math.sqrt(s * s - t.reduce((sum, value) => sum + value * value, 0));
        const [low, high] = wilson(c, s, level);
        return [["Items", s], ["Accuracy", c / s], [`${percentOf(level)} Wilson interval, low`, low], [`${percentOf(level)} Wilson interval, high`, high],
          ["Cohen's kappa", pe >= 1 ? null : (c / s - pe) / (1 - pe)], ["Matthews correlation", denominator > 0 ? (c * s - tp) / denominator : null]];
      } },
    { id: "matrix_from_pairs", kind: "tool", group: GROUP, title: "Confusion matrix from label,prediction pairs", help: `Counts pasted pairs into a confusion matrix: rows are actual labels, columns predictions, classes in natural sort order. ${PAIRS_FORMAT}`,
      inputs: [PAIRS_INPUT, { name: "shares", label: "Show each row as shares of its actual class", type: "checkbox" }], compute: (params) => {
        const pairs = parsePairs(params.pairs);
        const names = [...new Set(pairs.flat())].sort(compareText);
        const index = new Map(names.map((name, i) => [name, i]));
        const m = names.map(() => names.map(() => 0));
        for (const [label, prediction] of pairs) m[index.get(label)][index.get(prediction)]++;
        const totals = m.map((row) => row.reduce((a, b) => a + b, 0));
        const columnTotals = names.map((_, j) => m.reduce((sum, row) => sum + row[j], 0));
        const correct = m.reduce((sum, row, i) => sum + row[i], 0);
        const body = m.map((row, i) => [names[i], ...row.map((value) => (params.shares ? dash(ratio(value, totals[i])) : value)), totals[i]]);
        return { rows: [["Items", pairs.length], ["Classes", names.length], ["Accuracy", correct / pairs.length]],
          table: { columns: ["Actual \\ predicted", ...names, "Total"], rows: [...body, ["Total", ...columnTotals.map((value) => (params.shares ? dash(ratio(value, pairs.length)) : value)), pairs.length]] } };
      } },
    { id: "binary_counts", kind: "tool", group: GROUP, title: "TP, FP, FN and TN from label,prediction pairs", help: `Counts pasted pairs against one positive label (every other label is negative), giving the four cells the other tools take. Labels match exactly, case included. ${PAIRS_FORMAT}`,
      inputs: [PAIRS_INPUT, { name: "positive", label: "Positive label", type: "text", required: true, placeholder: "e.g. refund" }], compute: (params) => {
        const pairs = parsePairs(params.pairs), positive = params.positive.trim();
        if (!pairs.some(([label, prediction]) => label === positive || prediction === positive)) throw new Error(`"${positive}" is not among the pasted labels or predictions.`);
        const count = (actual, predicted) => pairs.filter(([label, prediction]) => (label === positive) === actual && (prediction === positive) === predicted).length;
        return [["True positives (TP)", count(true, true)], ["False positives (FP)", count(false, true)], ["False negatives (FN)", count(true, false)], ["True negatives (TN)", count(false, false)], ["Items", pairs.length]];
      } },
    { id: "changed_prevalence", kind: "tool", group: GROUP, title: "Precision at a different prevalence", help: "Recall and specificity do not depend on how common positives are, but precision does. From your counts and a new share of positives (0 to 1), it gives the precision, negative predictive value and accuracy the same classifier would have.",
      inputs: [...CELLS, SHARE("prevalence", "New prevalence (share of positives, 0 to 1)", "e.g. 0.05")], compute: (params) => {
        const c = cellsOf(params), prior = params.prevalence;
        const tpr = ratio(c.tp, c.tp + c.fn), tnr = ratio(c.tn, c.tn + c.fp);
        const known = tpr !== null && tnr !== null;
        const flagged = known ? tpr * prior + (1 - tnr) * (1 - prior) : null;
        const cleared = known ? tnr * (1 - prior) + (1 - tpr) * prior : null;
        return [["Prevalence in the counts", (c.tp + c.fn) / c.n], ["New prevalence", prior], ["Recall (unchanged)", tpr], ["Specificity (unchanged)", tnr],
          ["Precision in the counts", ratio(c.tp, c.tp + c.fp)], ["Precision at the new prevalence", known && flagged > 0 ? tpr * prior / flagged : null],
          ["Negative predictive value at the new prevalence", known && cleared > 0 ? tnr * (1 - prior) / cleared : null],
          ["Accuracy at the new prevalence", known ? tpr * prior + tnr * (1 - prior) : null]];
      } },
    { id: "matrix_cost", kind: "tool", group: GROUP, title: "Cost of a confusion matrix", help: "Prices each cell (a negative price is a gain) and compares the total with predicting everything positive or everything negative.",
      inputs: [...CELLS,
        { name: "cost_tp", label: "Price of a true positive", type: "number", default: 0 }, { name: "cost_fp", label: "Price of a false positive", type: "number", default: 1 },
        { name: "cost_fn", label: "Price of a false negative", type: "number", default: 1 }, { name: "cost_tn", label: "Price of a true negative", type: "number", default: 0 }],
      compute: (params) => {
        const c = cellsOf(params), positives = c.tp + c.fn, negatives = c.fp + c.tn;
        const total = c.tp * params.cost_tp + c.fp * params.cost_fp + c.fn * params.cost_fn + c.tn * params.cost_tn;
        const allPositive = positives * params.cost_tp + negatives * params.cost_fp, allNegative = positives * params.cost_fn + negatives * params.cost_tn;
        return [["Total cost", total], ["Cost per item", total / c.n], ["Cost of predicting everything positive", allPositive],
          ["Cost of predicting everything negative", allNegative], ["Saving against the cheaper of those", Math.min(allPositive, allNegative) - total]];
      } },
    { id: "counts_from_rates", kind: "tool", group: GROUP, title: "Expected counts from rates", help: "Turns a prevalence, recall and specificity into the expected TP, FP, FN and TN for a number of items (natural frequencies), and how many false alarms come with each true positive.",
      inputs: [{ name: "items", label: "Items", type: "integer", min: 1, max: MAX_COUNT, default: 1000 }, SHARE("prevalence", "Prevalence (0 to 1)", "e.g. 0.1"),
        SHARE("recall", "Recall (0 to 1)", "e.g. 0.8"), SHARE("specificity", "Specificity (0 to 1)", "e.g. 0.9")],
      compute: ({ items, prevalence, recall, specificity }) => {
        const positives = items * prevalence, negatives = items - positives;
        const tp = positives * recall, fp = negatives * (1 - specificity);
        return [["Actual positives", positives], ["Actual negatives", negatives], ["True positives (TP)", tp], ["False negatives (FN)", positives - tp],
          ["False positives (FP)", fp], ["True negatives (TN)", negatives - fp], ["Flagged items (TP + FP)", tp + fp], ["False alarms per true positive", ratio(fp, tp)]];
      } },
    { id: "mcnemar", kind: "tool", group: GROUP, title: "McNemar's test for two classifiers", help: "Compares two classifiers on the same labeled items using only the items where exactly one of them is right. Gives the chi-square statistic with continuity correction (as statsmodels computes it) and the exact two-sided binomial p-value.",
      inputs: [{ name: "only_a", label: "Items only classifier A got right", type: "integer", min: 0, max: MAX_COUNT },
        { name: "only_b", label: "Items only classifier B got right", type: "integer", min: 0, max: MAX_COUNT }],
      compute: ({ only_a: a, only_b: b }) => {
        const n = a + b;
        const statistic = n > 0 ? (Math.abs(a - b) - 1) ** 2 / n : null;
        return [["Disagreements", n], ["Chi-square (continuity corrected)", statistic], ["p-value (chi-square)", statistic === null ? null : chiSquareSf(statistic, 1)],
          ["Exact p-value (binomial)", n > 0 ? Math.min(1, 2 * binomialCdf(Math.min(a, b), n, 0.5)) : null],
          ["More accurate on these items", a > b ? "classifier A" : b > a ? "classifier B" : "neither"]];
      } },
  ],
});
