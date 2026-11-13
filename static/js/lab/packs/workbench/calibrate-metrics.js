// Classification, agreement, calibration-quality, ranking and selective-prediction metrics for the question Calibrate
// shows (surface "workbench.calibrate"; contract in static/js/lab/surfaces/workbench-analysis.js), and exports of
// aggregate tables. Every metric reads the shown rows (the scored tuning rows a Lab filter leaves), states that basis
// and, for proportions, a 95% Wilson interval. Numbers are measured on these rows, not promised: tuned figures are
// optimistic until checked on unseen rows, and intervals treat rows as independent. No model call, nothing stored;
// held-out test rows are never items here.
import { csvText, definePack, formatValue, runMetrics, toNumber } from "../../kit.js";
import { binomialSf, normalSf } from "../../lib/math.js";
import { formatMarkdownTable } from "../../lib/tables.js";
import { slugify } from "../../lib/text.js";

const Z = 1.959964;         // 95% Wilson, as jev/calibrate.py
const EPS = 1e-9;           // the page's tie rule: signal + 1e-9 >= threshold clears
const CLIP = 1e-15;         // log loss clips probabilities here
const SHARP = 0.9;          // a stated probability this high is a sharp answer
const IOU_HIGH = 0.75;      // a strict overlap bar for Box answers
const CLASSIFY = Object.freeze(["choice", "noul", "score"]);

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const fixed = (value, digits = 4) => (num(value) === null ? "" : value.toFixed(digits));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const shownRows = (n) => `${n} shown row${n === 1 ? "" : "s"}`;
const fileQid = (ctx) => slugify(ctx?.data?.qid || "") || "question";
const signalName = (ctx) => (ctx?.data?.signal === "top_probability" ? "top probability" : "confidence");

function wilson(k, n) {
  const p = k / n, z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [k === 0 ? 0 : Math.max(0, centre - half), k === n ? 1 : Math.min(1, centre + half)];
}
const interval = (k, n) => {
  const [low, high] = wilson(k, n);
  return `95% interval ${percent(low)}–${percent(high)}`;
};
// A proportion with its basis and interval, or null with nothing to count.
const share = (k, n, what) => (n ? { value: k / n, detail: `${k} of ${n} ${what}; ${interval(k, n)}` } : null);

// The shown scored rows and the question type they belong to.
function rowsOf(ctx) {
  const rows = (typeof ctx?.shown === "function" ? ctx.shown() : []).filter((item) => isObject(item) && typeof item.correct === "boolean");
  const type = ctx?.data?.type || rows.find((item) => typeof item.type === "string")?.type || null;
  return { rows, type };
}

// ---------- options of one answer ----------

function options(item) {
  const answer = item?.answer;
  if (!isObject(answer)) return null;
  if (answer.type === "noul") {
    const p = num(answer.noul);
    return p === null ? null : [["yes", p], ["no", 1 - p]].sort((a, b) => b[1] - a[1]);
  }
  if (answer.type !== "choice" && answer.type !== "score") return null;
  const list = Object.entries(isObject(answer.probabilities) ? answer.probabilities : {}).filter(([, p]) => num(p) !== null && p >= 0);
  return list.length ? list.sort((a, b) => b[1] - a[1]) : null;
}

function labelEntry(item) {
  const list = options(item);
  const found = list && list.find(([key]) => key === String(item.label));
  return found ? { list, p: found[1], rank: 1 + list.filter(([, p]) => p > found[1]).length } : null;
}

// ---------- classification counts ----------

// Option keys in the report's order, then any other label or answer of the shown rows in order of appearance.
function classList(ctx, rows) {
  const out = [];
  const add = (key) => { if (!out.includes(key)) out.push(key); };
  const reported = ctx?.data?.report?.classes;
  if (Array.isArray(reported)) for (const key of reported) if (typeof key === "string") add(key);
  for (const row of rows) { add(String(row.label)); add(String(row.predicted)); }
  return out;
}

// Per-option counts over the shown rows of a Choice, Noul or Score question; null otherwise.
function tally(ctx) {
  const { rows, type } = rowsOf(ctx);
  if (!rows.length || !CLASSIFY.includes(type)) return null;
  const classes = classList(ctx, rows);
  const stats = new Map(classes.map((key) => [key, { key, tp: 0, fp: 0, fn: 0, labeled: 0, answered: 0 }]));
  for (const row of rows) {
    const label = stats.get(String(row.label)), answer = stats.get(String(row.predicted));
    label.labeled++;
    answer.answered++;
    if (label === answer) label.tp++;
    else { answer.fp++; label.fn++; }
  }
  const list = classes.map((key) => stats.get(key));
  return { rows, type, n: rows.length, list, right: list.reduce((sum, s) => sum + s.tp, 0) };
}

const meanOf = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function majority(t) {
  return t.list.reduce((best, s) => (s.labeled > best.labeled ? s : best), t.list[0]);
}

// ---------- Noul, Score and Box helpers ----------

function binary(ctx) {
  const { rows, type } = rowsOf(ctx);
  if (type !== "noul") return null;
  const c = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const row of rows) {
    if (row.label === "yes") row.predicted === "yes" ? c.tp++ : c.fn++;
    else if (row.label === "no") row.predicted === "yes" ? c.fp++ : c.tn++;
  }
  return c.tp + c.fp + c.tn + c.fn ? c : null;
}

function levelRows(ctx) {
  const { rows, type } = rowsOf(ctx);
  if (type !== "score") return null;
  const out = rows.map((row) => ({ row, label: toNumber(row.label), predicted: toNumber(row.predicted) }))
    .filter((entry) => entry.label !== null && entry.predicted !== null);
  return out.length ? out : null;
}

// Cohen's kappa with linear or quadratic weights over the Score levels in ascending order.
function weightedKappa(ctx, power) {
  const entries = levelRows(ctx);
  if (!entries) return null;
  const levels = new Set(entries.flatMap((entry) => [entry.label, entry.predicted]));
  for (const key of ctx?.data?.report?.classes || []) if (toNumber(key) !== null) levels.add(toNumber(key));
  const sorted = [...levels].sort((a, b) => a - b), k = sorted.length, n = entries.length;
  if (k < 2) return null;
  const at = new Map(sorted.map((level, i) => [level, i]));
  const rowsum = new Array(k).fill(0), colsum = new Array(k).fill(0);
  let observed = 0;
  const weight = (i, j) => (Math.abs(i - j) / (k - 1)) ** power;
  for (const entry of entries) {
    const i = at.get(entry.label), j = at.get(entry.predicted);
    rowsum[i]++; colsum[j]++;
    observed += weight(i, j);
  }
  let expected = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) expected += weight(i, j) * rowsum[i] * colsum[j] / n;
  return expected > 0 ? { value: 1 - observed / expected, detail: `${plural(k, "level")} ${sorted.join(", ")}; on ${shownRows(n)}` } : null;
}

function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    for (let m = i; m <= j; m++) out[order[m].index] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

function pearson(x, y) {
  const mx = meanOf(x), my = meanOf(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

const EDGES = ["left", "top", "right", "bottom"];
function boxOf(value) {
  if (!isObject(value) || !EDGES.every((edge) => num(value[edge]) !== null)) return null;
  return Object.fromEntries(EDGES.map((edge) => [edge, value[edge]]));
}
function labelBox(text) {
  const parts = String(text ?? "").split(",").map((part) => toNumber(part));
  return parts.length === 4 && parts.every((part) => part !== null) ? Object.fromEntries(EDGES.map((edge, i) => [edge, parts[i]])) : null;
}
// Intersection over union, as jev/calibrate.py iou.
function iou(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = w * h;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return union > 0 ? inter / union : 0;
}
function ious(ctx) {
  const { rows, type } = rowsOf(ctx);
  if (type !== "box") return null;
  const out = rows.map((row) => {
    const answered = boxOf(row.answer?.box), labeled = labelBox(row.label);
    return answered && labeled ? iou(answered, labeled) : null;
  }).filter((value) => value !== null);
  return out.length ? out : null;
}

// ---------- probability and signal pairs ----------

// (stated probability of the answer, 1 when right) for every shown row with a stated probability.
function statedPairs(ctx) {
  const { rows } = rowsOf(ctx);
  const out = rows.filter((row) => num(row.top) !== null).map((row) => ({ p: row.top, y: row.correct ? 1 : 0 }));
  return out.length ? out : null;
}

// (signal, right) for every shown row with a signal.
function signalPairs(ctx) {
  const { rows } = rowsOf(ctx);
  return rows.filter((row) => num(row.signal) !== null).map((row) => ({ s: row.signal, right: row.correct }));
}

function bothKinds(ctx) {
  const pairs = signalPairs(ctx);
  const right = pairs.filter((pair) => pair.right).map((pair) => pair.s), wrong = pairs.filter((pair) => !pair.right).map((pair) => pair.s);
  return right.length && wrong.length ? { pairs, right, wrong } : null;
}

// The highest threshold on the 0.01 grid that automates at least `coverage` of the shown rows, with its accuracy.
function selective(ctx, coverage) {
  const pairs = signalPairs(ctx);
  if (!pairs.length) return null;
  for (let k = 100; k >= 0; k--) {
    const t = k / 100;
    const auto = pairs.filter((pair) => pair.s + EPS >= t);
    if (auto.length / pairs.length + EPS >= coverage) {
      const right = auto.filter((pair) => pair.right).length;
      return { value: right / auto.length, detail: `at threshold ${t.toFixed(2)} (signal: ${signalName(ctx)}): ${right} of ${auto.length} automated right, ${auto.length} of ${shownRows(pairs.length)} automated; ${interval(right, auto.length)}` };
    }
  }
  return null;
}

// Risk at each distinct signal, from the highest down: [{ s, automated, wrong }].
function riskSteps(pairs) {
  const sorted = pairs.slice().sort((a, b) => b.s - a.s);
  const steps = [];
  let automated = 0, wrong = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].s === sorted[i].s) {
      automated++;
      if (!sorted[j].right) wrong++;
      j++;
    }
    steps.push({ s: sorted[i].s, count: j - i, automated, wrong });
    i = j;
  }
  return steps;
}

function noulPairs(ctx) {
  const { rows, type } = rowsOf(ctx);
  if (type !== "noul") return null;
  const pairs = rows.map((row) => ({ p: num(row.answer?.noul), yes: row.label === "yes", known: row.label === "yes" || row.label === "no" }))
    .filter((pair) => pair.p !== null && pair.known);
  const pos = pairs.filter((pair) => pair.yes).length;
  return pos && pos < pairs.length ? { pairs, pos, neg: pairs.length - pos } : null;
}

// ---------- the metrics ----------

const METRICS = [
  // classification and agreement
  { id: "macro_precision", kind: "metric", format: "percent", label: "Macro precision",
    help: "Mean over options the answer gave of how often that answer was right. Options never given have no precision and are left out.",
    compute: (ctx) => {
      const t = tally(ctx);
      const used = t ? t.list.filter((s) => s.answered) : [];
      return used.length ? { value: meanOf(used.map((s) => s.tp / s.answered)), detail: `${plural(used.length, "answered option")}; on ${shownRows(t.n)}` } : null;
    } },
  { id: "macro_recall", kind: "metric", format: "percent", label: "Balanced accuracy (macro recall)",
    help: "Mean over labeled options of the share of their rows the answer got right, so a rare option counts as much as a common one.",
    compute: (ctx) => {
      const t = tally(ctx);
      const used = t ? t.list.filter((s) => s.labeled) : [];
      return used.length ? { value: meanOf(used.map((s) => s.tp / s.labeled)), detail: `${plural(used.length, "labeled option")}; on ${shownRows(t.n)}` } : null;
    } },
  { id: "macro_f1", kind: "metric", format: "percent", label: "Macro F1",
    help: "Mean over options that are labeled or answered of F1 = 2·right / (2·right + answered wrongly + missed).",
    compute: (ctx) => {
      const t = tally(ctx);
      const used = t ? t.list.filter((s) => s.labeled || s.answered) : [];
      return used.length ? { value: meanOf(used.map((s) => (2 * s.tp) / (2 * s.tp + s.fp + s.fn))), detail: `${plural(used.length, "option")}; on ${shownRows(t.n)}` } : null;
    } },
  { id: "kappa", kind: "metric", format: "number", label: "Cohen's kappa between answers and labels",
    help: "Agreement beyond what the answer and label frequencies give by chance: 1 is perfect, 0 is chance level.",
    compute: (ctx) => {
      const t = tally(ctx);
      if (!t) return null;
      const po = t.right / t.n, pe = t.list.reduce((sum, s) => sum + s.labeled * s.answered, 0) / (t.n * t.n);
      return pe < 1 - 1e-12 ? { value: (po - pe) / (1 - pe), detail: `observed ${percent(po)}, chance ${percent(pe)}; on ${shownRows(t.n)}` } : null;
    } },
  { id: "mcc", kind: "metric", format: "number", label: "Matthews correlation",
    help: "The multi-class Matthews correlation between answers and labels: 1 perfect, 0 no better than chance, negative worse.",
    compute: (ctx) => {
      const t = tally(ctx);
      if (!t) return null;
      const s = t.n, cross = t.list.reduce((sum, c) => sum + c.labeled * c.answered, 0);
      const den = Math.sqrt((s * s - t.list.reduce((sum, c) => sum + c.answered ** 2, 0)) * (s * s - t.list.reduce((sum, c) => sum + c.labeled ** 2, 0)));
      return den > 0 ? { value: (t.right * s - cross) / den, detail: `on ${shownRows(t.n)}` } : null;
    } },
  { id: "majority_rate", kind: "metric", format: "percent", label: "Majority-label rate (no-information rate)",
    help: "The accuracy of always answering the most common label of the shown rows.",
    compute: (ctx) => {
      const t = tally(ctx);
      if (!t) return null;
      const top = majority(t);
      return { value: top.labeled / t.n, detail: `“${top.key}” labels ${top.labeled} of ${shownRows(t.n)}; ${interval(top.labeled, t.n)}` };
    } },
  { id: "accuracy_lift", kind: "metric", format: "percent", label: "Accuracy above the majority-label rate",
    help: "Accuracy minus the share of the most common label, in points: what the answers add over always giving that label.",
    compute: (ctx) => {
      const t = tally(ctx);
      if (!t) return null;
      const top = majority(t);
      return { value: (t.right - top.labeled) / t.n, detail: `${t.right} right against ${top.labeled} “${top.key}” labels of ${shownRows(t.n)}` };
    } },
  { id: "lift_p_value", kind: "metric", format: "number", label: "Chance of this accuracy from the majority rate (p)",
    help: "One-sided binomial p-value: the chance of at least this many right rows from something right as often as the majority-label rate. Small means the answers beat that baseline.",
    compute: (ctx) => {
      const t = tally(ctx);
      if (!t) return null;
      const top = majority(t);
      const p = binomialSf(t.right, t.n, top.labeled / t.n);
      return p === null ? null : { value: p, detail: `P(at least ${t.right} of ${t.n} right) at ${percent(top.labeled / t.n)}; on ${shownRows(t.n)}` };
    } },
  { id: "top2_accuracy", kind: "metric", format: "percent", label: "Top-two accuracy",
    help: "Share of shown rows whose label is one of the answer's two most likely options. Choice and Score questions.",
    compute: (ctx) => {
      const { rows, type } = rowsOf(ctx);
      if (type !== "choice" && type !== "score") return null;
      const ranked = rows.map(labelEntry).filter(Boolean);
      return share(ranked.filter((entry) => entry.rank <= 2).length, ranked.length, "shown rows hold the label in the top two");
    } },
  { id: "top_confusion", kind: "metric", format: "text", label: "Most frequent mistake",
    help: "The label → answer pair that occurs most often among wrong shown rows (ties: the first to appear).",
    compute: (ctx) => {
      const t = tally(ctx);
      if (!t) return null;
      const pairs = new Map();
      for (const row of t.rows) {
        if (String(row.label) === String(row.predicted)) continue;
        const key = `${row.label} → ${row.predicted}`;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
      if (!pairs.size) return { value: null, detail: `no wrong row among ${shownRows(t.n)}` };
      const wrong = [...pairs.values()].reduce((sum, count) => sum + count, 0);
      const [key, count] = [...pairs].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
      return { value: key, detail: `${count} of ${plural(wrong, "wrong shown row")} (${percent(count / wrong)})` };
    } },
  { id: "over_given", kind: "metric", format: "text", label: "Answer given most often beyond its labels",
    help: "The option whose answer count exceeds its label count by the most rows (ties: the report's option order).",
    compute: (ctx) => {
      const t = tally(ctx);
      if (!t) return null;
      const best = t.list.reduce((top, s) => (s.answered - s.labeled > top.answered - top.labeled ? s : top), t.list[0]);
      if (best.answered - best.labeled <= 0) return { value: null, detail: `every option is answered as often as it is labeled on ${shownRows(t.n)}` };
      return { value: best.key, detail: `answered ${best.answered}, labeled ${best.labeled} of ${shownRows(t.n)} (${((best.answered - best.labeled) / t.n * 100).toFixed(1)} points more)` };
    } },

  // Noul
  { id: "sensitivity", kind: "metric", format: "percent", label: "Sensitivity (yes rows answered yes)",
    help: "Noul questions: the share of yes-labeled rows the answer called yes (P(yes) ≥ 0.5).",
    compute: (ctx) => { const c = binary(ctx); return c && share(c.tp, c.tp + c.fn, "yes-labeled shown rows answered yes"); } },
  { id: "specificity", kind: "metric", format: "percent", label: "Specificity (no rows answered no)",
    help: "Noul questions: the share of no-labeled rows the answer called no.",
    compute: (ctx) => { const c = binary(ctx); return c && share(c.tn, c.tn + c.fp, "no-labeled shown rows answered no"); } },
  { id: "ppv", kind: "metric", format: "percent", label: "Precision of yes answers",
    help: "Noul questions: the share of yes answers whose label is yes (positive predictive value).",
    compute: (ctx) => { const c = binary(ctx); return c && share(c.tp, c.tp + c.fp, "yes answers labeled yes"); } },
  { id: "npv", kind: "metric", format: "percent", label: "Precision of no answers",
    help: "Noul questions: the share of no answers whose label is no (negative predictive value).",
    compute: (ctx) => { const c = binary(ctx); return c && share(c.tn, c.tn + c.fn, "no answers labeled no"); } },
  { id: "yes_f1", kind: "metric", format: "percent", label: "F1 for yes",
    help: "Noul questions: 2·true yes / (2·true yes + false yes + missed yes).",
    compute: (ctx) => {
      const c = binary(ctx);
      const den = c ? 2 * c.tp + c.fp + c.fn : 0;
      return den ? { value: (2 * c.tp) / den, detail: `${c.tp} true yes, ${c.fp} false yes, ${c.fn} missed yes on ${shownRows(c.tp + c.fp + c.tn + c.fn)}` } : null;
    } },

  // Score
  { id: "quadratic_kappa", kind: "metric", format: "number", label: "Quadratic-weighted kappa",
    help: "Score questions: agreement on the levels where a miss costs the square of its distance; 1 perfect, 0 chance.",
    compute: (ctx) => weightedKappa(ctx, 2) },
  { id: "linear_kappa", kind: "metric", format: "number", label: "Linear-weighted kappa",
    help: "Score questions: agreement on the levels where a miss costs its distance; 1 perfect, 0 chance.",
    compute: (ctx) => weightedKappa(ctx, 1) },
  { id: "level_rmse", kind: "metric", format: "number", label: "Root mean square level error",
    help: "Score questions: √mean((most likely level − label)²), in levels; weighs big misses more than the page's mean error.",
    compute: (ctx) => {
      const entries = levelRows(ctx);
      return entries && { value: Math.sqrt(meanOf(entries.map((e) => (e.predicted - e.label) ** 2))), detail: `in levels; on ${shownRows(entries.length)}` };
    } },
  { id: "level_bias", kind: "metric", format: "number", label: "Mean signed level error",
    help: "Score questions: mean(most likely level − label). Positive scores high, negative scores low.",
    compute: (ctx) => {
      const entries = levelRows(ctx);
      if (!entries) return null;
      const value = meanOf(entries.map((e) => e.predicted - e.label));
      return { value, detail: `${value > 0 ? "scores high" : value < 0 ? "scores low" : "no lean"}; on ${shownRows(entries.length)}` };
    } },
  { id: "score_spearman", kind: "metric", format: "number", label: "Rank correlation of expected score and label",
    help: "Score questions: Spearman correlation between the probability-weighted score and the labeled level (ties share ranks).",
    compute: (ctx) => {
      const entries = (levelRows(ctx) || []).filter((e) => num(e.row.answer?.score) !== null);
      if (entries.length < 3) return null;
      const value = pearson(ranks(entries.map((e) => e.row.answer.score)), ranks(entries.map((e) => e.label)));
      return value === null ? null : { value, detail: `on ${shownRows(entries.length)}` };
    } },
  { id: "off_by_two", kind: "metric", format: "percent", label: "Share two or more levels off",
    help: "Score questions: rows whose most likely level is at least two levels from the label.",
    compute: (ctx) => {
      const entries = levelRows(ctx);
      return entries && share(entries.filter((e) => Math.abs(e.predicted - e.label) >= 2).length, entries.length, "shown rows two or more levels off");
    } },

  // Box
  { id: "median_iou", kind: "metric", format: "number", label: "Median box overlap (IoU)",
    help: "Box questions: the median intersection over union of answered and labeled boxes (labels at two decimals, as Calibrate shows them). The page's mean IoU stays the reference.",
    compute: (ctx) => {
      const values = ious(ctx);
      if (!values) return null;
      const sorted = values.slice().sort((a, b) => a - b), mid = sorted.length >> 1;
      return { value: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, detail: `on ${shownRows(values.length)}` };
    } },
  { id: "iou_high", kind: "metric", format: "percent", label: "Share with a tight box (IoU ≥ 0.75)",
    help: "Box questions: rows whose answered box overlaps the label by 0.75 or more, a stricter bar than the page's 0.5.",
    compute: (ctx) => {
      const values = ious(ctx);
      return values && share(values.filter((value) => value + EPS >= IOU_HIGH).length, values.length, "shown rows at IoU 0.75 or more");
    } },

  // calibration quality, on (stated probability of the answer, right)
  { id: "max_calibration_error", kind: "metric", format: "number", label: "Largest reliability-bin gap",
    help: "The largest |mean stated probability − share right| over ten equal-width bins of the stated probability. A separate figure from the page's ECE.",
    compute: (ctx) => {
      const pairs = statedPairs(ctx);
      if (!pairs) return null;
      const bins = Array.from({ length: 10 }, () => []);
      for (const pair of pairs) bins[Math.min(9, Math.max(0, Math.floor(pair.p * 10 + EPS)))].push(pair);
      let best = null;
      bins.forEach((bin, k) => {
        if (!bin.length) return;
        const gap = Math.abs(meanOf(bin.map((pair) => pair.p)) - meanOf(bin.map((pair) => pair.y)));
        if (!best || gap > best.gap + 1e-12) best = { gap, k, count: bin.length };
      });
      return { value: best.gap, detail: `in the ${(best.k / 10).toFixed(1)}–${((best.k + 1) / 10).toFixed(1)} bin (${plural(best.count, "row")}); on ${shownRows(pairs.length)}` };
    } },
  { id: "equal_count_ece", kind: "metric", format: "number", label: "Calibration error over equal-count bins",
    help: "ECE with bins of about equal rows (min(10, ⌊rows / 2⌋) bins, stated probability ascending). A separate figure from the page's equal-width ECE.",
    compute: (ctx) => {
      const pairs = statedPairs(ctx);
      if (!pairs) return null;
      const sorted = pairs.slice().sort((a, b) => a.p - b.p), n = sorted.length, bins = Math.max(1, Math.min(10, Math.floor(n / 2)));
      let total = 0;
      for (let b = 0; b < bins; b++) {
        const bin = sorted.slice(Math.floor((b * n) / bins), Math.floor(((b + 1) * n) / bins));
        total += bin.length * Math.abs(meanOf(bin.map((pair) => pair.p)) - meanOf(bin.map((pair) => pair.y)));
      }
      return { value: total / n, detail: `${plural(bins, "bin")}; on ${shownRows(n)}` };
    } },
  { id: "overconfidence", kind: "metric", format: "percent", label: "Stated probability minus share right",
    help: "Mean stated probability of the answers minus the share right, in points: positive is overconfident, negative underconfident.",
    compute: (ctx) => {
      const pairs = statedPairs(ctx);
      if (!pairs) return null;
      const stated = meanOf(pairs.map((pair) => pair.p)), right = meanOf(pairs.map((pair) => pair.y)), gap = stated - right;
      return { value: gap, detail: `stated ${percent(stated)}, right ${percent(right)}: ${gap > 0 ? "overconfident" : gap < 0 ? "underconfident" : "even"}; on ${shownRows(pairs.length)}` };
    } },
  { id: "brier_skill", kind: "metric", format: "number", label: "Brier skill against the base rate",
    help: "1 − Brier score of the stated probability ÷ the Brier score of always stating the share right. Above 0 beats that constant; 1 is perfect.",
    compute: (ctx) => {
      const pairs = statedPairs(ctx);
      if (!pairs) return null;
      const rate = meanOf(pairs.map((pair) => pair.y)), reference = rate * (1 - rate);
      if (!(reference > 0)) return { value: null, detail: "every shown row is right, or every one wrong: no skill to measure" };
      const brier = meanOf(pairs.map((pair) => (pair.p - pair.y) ** 2));
      return { value: 1 - brier / reference, detail: `Brier ${formatValue(brier)} against ${formatValue(reference)}; on ${shownRows(pairs.length)}` };
    } },
  { id: "label_log_loss", kind: "metric", format: "number", label: "Log loss of the label",
    help: "Mean −ln(probability the answer gave the label), probabilities clipped at 1e-15. Lower is better; not available for a Box.",
    compute: (ctx) => {
      const entries = rowsOf(ctx).rows.map(labelEntry).filter(Boolean);
      return entries.length ? { value: meanOf(entries.map((entry) => -Math.log(Math.max(CLIP, entry.p)))), detail: `nats; on ${shownRows(entries.length)}` } : null;
    } },
  { id: "multiclass_brier", kind: "metric", format: "number", label: "Brier score over every option",
    help: "Mean over rows of Σ (option probability − 1 for the label, else 0)², using the whole distribution (0 best, 2 worst). Not available for a Box.",
    compute: (ctx) => {
      const entries = rowsOf(ctx).rows.map((row) => ({ row, entry: labelEntry(row) })).filter((e) => e.entry);
      return entries.length ? { value: meanOf(entries.map(({ row, entry }) => entry.list.reduce((sum, [key, p]) => sum + (p - (key === String(row.label) ? 1 : 0)) ** 2, 0))),
        detail: `on ${shownRows(entries.length)}` } : null;
    } },
  { id: "sharpness", kind: "metric", format: "percent", label: "Share of sharp answers (stated ≥ 0.90)",
    help: "Rows whose answer states 0.90 or more for itself: how decisive the answers are, whatever their accuracy.",
    compute: (ctx) => {
      const pairs = statedPairs(ctx);
      return pairs && share(pairs.filter((pair) => pair.p + EPS >= SHARP).length, pairs.length, "shown rows stated 0.90 or more");
    } },
  { id: "spiegelhalter", kind: "metric", format: "number", label: "Calibration test p-value (Spiegelhalter)",
    help: "Two-sided p-value of Spiegelhalter's Z test that the stated probabilities match the right/wrong outcomes. Small means the mismatch is more than chance; rows treated as independent.",
    compute: (ctx) => {
      const pairs = statedPairs(ctx);
      if (!pairs) return null;
      const top = pairs.reduce((sum, { p, y }) => sum + (y - p) * (1 - 2 * p), 0);
      const variance = pairs.reduce((sum, { p }) => sum + (1 - 2 * p) ** 2 * p * (1 - p), 0);
      if (!(variance > 0)) return null;
      const z = top / Math.sqrt(variance);
      return { value: Math.min(1, 2 * normalSf(Math.abs(z))), detail: `Z = ${z.toFixed(3)}; on ${shownRows(pairs.length)}` };
    } },

  // ranking and selective prediction, on (signal, right)
  { id: "aurc", kind: "metric", format: "number", label: "Area under the risk–coverage curve",
    help: "Mean share wrong among the automated rows as the threshold drops row by row (tied signals enter together). Lower is better; the detail gives the best any ordering could do.",
    compute: (ctx) => {
      const pairs = signalPairs(ctx);
      if (!pairs.length) return null;
      const n = pairs.length, right = pairs.filter((pair) => pair.right).length;
      const value = riskSteps(pairs).reduce((sum, step) => sum + step.count * (step.wrong / step.automated), 0) / n;
      let best = 0;
      for (let k = right + 1; k <= n; k++) best += (k - right) / k;
      best /= n;
      return { value, detail: `signal: ${signalName(ctx)}; best possible ${formatValue(best)}, excess ${formatValue(value - best)}; on ${shownRows(n)}` };
    } },
  { id: "wrong_average_precision", kind: "metric", format: "number", label: "Average precision for finding wrong rows by low signal",
    help: "Reading rows from the lowest signal up, the mean share of wrong rows among those read at each wrong row (ties read together). 1 when every wrong row comes first.",
    compute: (ctx) => {
      const both = bothKinds(ctx);
      if (!both) return null;
      const values = both.wrong.map((s) => {
        const read = both.pairs.filter((pair) => pair.s <= s);
        return read.filter((pair) => !pair.right).length / read.length;
      });
      return { value: meanOf(values), detail: `${plural(both.wrong.length, "wrong row")} among ${shownRows(both.pairs.length)}; signal: ${signalName(ctx)}` };
    } },
  { id: "ks_separation", kind: "metric", format: "number", label: "Separation of right and wrong signals (KS)",
    help: "The largest gap between the cumulative signal distributions of wrong and right rows: 1 when some threshold splits them perfectly, 0 when they look alike.",
    compute: (ctx) => {
      const both = bothKinds(ctx);
      if (!both) return null;
      const values = [...new Set(both.pairs.map((pair) => pair.s))].sort((a, b) => a - b);
      let best = { gap: -1, at: null };
      for (const v of values) {
        const gap = Math.abs(both.wrong.filter((s) => s <= v).length / both.wrong.length - both.right.filter((s) => s <= v).length / both.right.length);
        if (gap > best.gap + 1e-12) best = { gap, at: v };
      }
      return { value: best.gap, detail: `largest at signal ≤ ${best.at.toFixed(2)} (signal: ${signalName(ctx)}); ${both.right.length} right, ${both.wrong.length} wrong shown rows` };
    } },
  { id: "overlap_rows", kind: "metric", format: "integer", label: "Rows where right and wrong signals overlap",
    help: "Shown rows whose signal lies between the lowest signal of a right row and the highest of a wrong row: no threshold separates these.",
    compute: (ctx) => {
      const both = bothKinds(ctx);
      if (!both) return null;
      const low = Math.min(...both.right), high = Math.max(...both.wrong);
      if (low > high) return { value: 0, detail: `every right row's signal is above every wrong row's (${high.toFixed(2)} < ${low.toFixed(2)})` };
      return { value: both.pairs.filter((pair) => pair.s >= low && pair.s <= high).length, detail: `signals ${low.toFixed(2)}–${high.toFixed(2)} of ${shownRows(both.pairs.length)}` };
    } },
  { id: "accuracy_at_half", kind: "metric", format: "percent", label: "Accuracy when automating half the rows",
    help: "Accuracy of the automated rows at the highest 0.01 threshold that automates at least 50% of the shown rows. Tuned on these rows; check on unseen rows.",
    compute: (ctx) => selective(ctx, 0.5) },
  { id: "accuracy_at_ninety", kind: "metric", format: "percent", label: "Accuracy when automating 90% of the rows",
    help: "Accuracy of the automated rows at the highest 0.01 threshold that automates at least 90% of the shown rows. Tuned on these rows; check on unseen rows.",
    compute: (ctx) => selective(ctx, 0.9) },
  { id: "yes_auroc", kind: "metric", format: "number", label: "How well P(yes) ranks yes rows above no rows",
    help: "Noul questions: the chance a yes-labeled row has a higher P(yes) than a no-labeled row (ties count half).",
    compute: (ctx) => {
      const data = noulPairs(ctx);
      if (!data) return null;
      let wins = 0;
      for (const a of data.pairs) if (a.yes) for (const b of data.pairs) if (!b.yes) wins += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0;
      return { value: wins / (data.pos * data.neg), detail: `${data.pos} yes × ${data.neg} no shown rows` };
    } },
  { id: "youden_cut", kind: "metric", format: "number", label: "P(yes) cut with the best sensitivity + specificity",
    help: "Noul questions: the lowest 0.01 cut c (answer yes when P(yes) ≥ c) that maximizes Youden's J = sensitivity + specificity − 1. Advisory: Calibrate's rule stays P(yes) ≥ 0.5.",
    compute: (ctx) => {
      const data = noulPairs(ctx);
      if (!data) return null;
      const at = (c) => {
        const sens = data.pairs.filter((pair) => pair.yes && pair.p + EPS >= c).length / data.pos;
        const spec = data.pairs.filter((pair) => !pair.yes && pair.p + EPS < c).length / data.neg;
        return { c, sens, spec, j: sens + spec - 1 };
      };
      const grid = Array.from({ length: 101 }, (_, k) => at(k / 100));
      const top = Math.max(...grid.map((point) => point.j));
      const best = grid.filter((point) => point.j > top - 1e-12);
      const first = best[0], last = best[best.length - 1];
      return { value: first.c, detail: `J ${first.j.toFixed(3)} (sensitivity ${percent(first.sens)}, specificity ${percent(first.spec)})${last.c > first.c ? `; the same J up to ${last.c.toFixed(2)}` : ""}; on ${shownRows(data.pairs.length)}` };
    } },
];

// ---------- exports ----------

const AGGREGATE = "Aggregates from your own Bulk run in this page session: counts, rates, thresholds and intervals; no inputs, answers or row numbers. Held-out test rows are never included.";

function needReport(ctx) {
  const report = ctx?.data?.report;
  if (!isObject(report) || !(report.labeled > 0)) throw new Error("There is no labeled Calibrate report yet: label some rows first.");
  return report;
}

const EXPORTS = [
  { id: "classes_csv", kind: "exporter", label: "Per-option counts and rates as CSV", mime: "text/csv",
    help: "Aggregates over the shown rows: for each option key, rows labeled and answered, right, answered wrongly, missed, precision, recall and F1. No inputs or row numbers.",
    filename: (ctx) => `calibrate-${fileQid(ctx)}-options.csv`,
    build: (ctx) => {
      const t = tally(ctx);
      if (!t) throw new Error("Per-option counts need shown rows of a Choice, Noul or Score question.");
      return csvText([["option", "labeled", "answered", "right", "answered wrongly", "missed", "precision", "recall", "F1"],
        ...t.list.map((s) => [s.key, s.labeled, s.answered, s.tp, s.fp, s.fn, s.answered ? fixed(s.tp / s.answered) : "", s.labeled ? fixed(s.tp / s.labeled) : "",
          s.labeled || s.answered ? fixed((2 * s.tp) / (2 * s.tp + s.fp + s.fn)) : ""])]);
    } },
  { id: "confusion_shares_csv", kind: "exporter", label: "Confusion matrix as shares of each label as CSV", mime: "text/csv",
    help: "Aggregates of every scored row from the page's confusion matrix: each label row divided by its total, so a row reads as where that label's rows went.",
    filename: (ctx) => `calibrate-${fileQid(ctx)}-confusion-shares.csv`,
    build: (ctx) => {
      const report = needReport(ctx);
      if (!Array.isArray(report.classes) || !report.classes.length || !Array.isArray(report.confusion)) throw new Error("This question has no confusion matrix (a Box).");
      return csvText([["label \\ answer", ...report.classes, "rows"], ...report.classes.map((key, i) => {
        const counts = Array.isArray(report.confusion[i]) ? report.confusion[i].map((value) => num(value) ?? 0) : [];
        const total = counts.reduce((sum, value) => sum + value, 0);
        return [key, ...report.classes.map((_, j) => (total ? fixed((counts[j] || 0) / total) : "")), total];
      })]);
    } },
  { id: "reliability_csv", kind: "exporter", label: "Reliability bins with intervals as CSV", mime: "text/csv",
    help: "Aggregates of every scored row from the page's reliability table, with each bin's gap (stated − observed) and a 95% Wilson interval for its observed rate.",
    filename: (ctx) => `calibrate-${fileQid(ctx)}-reliability.csv`,
    build: (ctx) => {
      const report = needReport(ctx);
      const bins = Array.isArray(report.reliability) ? report.reliability.filter((bin) => isObject(bin) && bin.count > 0) : [];
      if (!bins.length) throw new Error("The report has no reliability bins.");
      return csvText([["bin from", "bin to", "rows", "mean stated", "observed", "hits", "gap", "low", "high"], ...bins.map((bin) => {
        const [low, high] = wilson(bin.hits, bin.count);
        return [fixed(bin.lo, 2), fixed(bin.hi, 2), bin.count, fixed(bin.stated), fixed(bin.observed), bin.hits, fixed(bin.stated - bin.observed), fixed(low), fixed(high)];
      })]);
    } },
  { id: "targets_csv", kind: "exporter", label: "Accuracy targets as CSV", mime: "text/csv",
    help: "Aggregates of every scored row from the page's 90/95/99% targets under the report's basis: threshold, rows and share automated, accuracy with its interval, rows needed.",
    filename: (ctx) => `calibrate-${fileQid(ctx)}-targets.csv`,
    build: (ctx) => {
      const report = needReport(ctx);
      const targets = Array.isArray(report.targets) ? report.targets.filter(isObject) : [];
      if (!targets.length) throw new Error("The report has no targets.");
      return csvText([["target", "basis", "threshold", "automated", "share", "accuracy", "low", "high", "rows needed"],
        ...targets.map((target) => [fixed(target.target, 2), ctx.data.bound, fixed(target.threshold, 2), target.automated ?? "", fixed(target.coverage),
          fixed(target.accuracy), fixed(target.low), fixed(target.high), target.needed ?? ""])]);
    } },
  { id: "signal_groups_csv", kind: "exporter", label: "Accuracy by signal group as CSV", mime: "text/csv",
    help: "Aggregates over the shown rows sorted by signal and cut into up to ten groups of about equal rows (at least two each): signal range, rows, right, accuracy and its 95% interval.",
    filename: (ctx) => `calibrate-${fileQid(ctx)}-signal-groups.csv`,
    build: (ctx) => {
      const pairs = signalPairs(ctx).sort((a, b) => a.s - b.s);
      if (!pairs.length) throw new Error("There are no shown rows to group.");
      const n = pairs.length, groups = Math.max(1, Math.min(10, Math.floor(n / 2)));
      const rows = [];
      for (let g = 0; g < groups; g++) {
        const part = pairs.slice(Math.floor((g * n) / groups), Math.floor(((g + 1) * n) / groups));
        const right = part.filter((pair) => pair.right).length, [low, high] = wilson(right, part.length);
        rows.push([g + 1, fixed(part[0].s, 2), fixed(part[part.length - 1].s, 2), part.length, right, fixed(right / part.length), fixed(low), fixed(high)]);
      }
      return csvText([["group", "lowest signal", "highest signal", "rows", "right", "accuracy", "low", "high"], ...rows]);
    } },
  { id: "risk_coverage_csv", kind: "exporter", label: "Risk–coverage curve as CSV", mime: "text/csv",
    help: "Aggregates over the shown rows: at each distinct signal from the highest down, the rows a threshold there automates, their share, the wrong ones and the share wrong.",
    filename: (ctx) => `calibrate-${fileQid(ctx)}-risk-coverage.csv`,
    build: (ctx) => {
      const pairs = signalPairs(ctx);
      if (!pairs.length) throw new Error("There are no shown rows to measure.");
      return csvText([["threshold", "automated", "share", "wrong", "share wrong"],
        ...riskSteps(pairs).map((step) => [fixed(step.s, 2), step.automated, fixed(step.automated / pairs.length), step.wrong, fixed(step.wrong / step.automated)])]);
    } },
  { id: "summary_markdown", kind: "exporter", label: "Calibrate summary as Markdown", mime: "text/markdown",
    help: "Aggregates only: question, basis, accuracy, the page's ECE, the slider's threshold and the targets. No inputs, answers or row numbers.",
    filename: (ctx) => `calibrate-${fileQid(ctx)}-summary.md`,
    build: (ctx) => {
      const report = needReport(ctx);
      const d = ctx.data, at = d.at;
      const range = (low, high) => (num(low) === null ? "—" : `${percent(low)}–${percent(high)}`);
      const lines = [`# Calibrate summary: ${d.qid}`, "", AGGREGATE, "",
        `- Question: ${d.qid} (${d.type})`,
        `- Signal: ${d.signal === "top_probability" ? "top probability" : "confidence"}; targets: ${d.bound === "lower" ? "at the 95% lower bound" : "on these rows"}`,
        `- Labeled rows scored: ${report.labeled} (answered without a label: ${report.unlabeled ?? 0}; labels ignored: ${Array.isArray(report.invalid) ? report.invalid.length : 0})`,
        `- Accuracy on every scored row: ${percent(report.accuracy)} (95% interval ${range(report.accuracy_low, report.accuracy_high)})`,
        `- Calibration error (the page's ECE): ${num(report.ece) === null ? "—" : formatValue(report.ece)}`];
      if (at) lines.push(`- At threshold ${d.threshold.toFixed(2)}: ${at.automated} of ${report.labeled} automated (${percent(at.coverage)}), accuracy ${num(at.accuracy) === null ? "—" : `${percent(at.accuracy)} (95% interval ${range(at.low, at.high)})`}`);
      const targets = Array.isArray(report.targets) ? report.targets.filter(isObject) : [];
      if (targets.length) {
        lines.push("", formatMarkdownTable(["target", "threshold", "share automated", "accuracy", "95% interval"], targets.map((target) => [percent(target.target),
          num(target.threshold) === null ? "not reached" : target.threshold.toFixed(2), percent(target.coverage ?? 0),
          num(target.accuracy) === null ? "—" : percent(target.accuracy), range(target.low, target.high)])));
      }
      lines.push("", "Measured on these rows, not promised: tuned numbers are optimistic until checked on unseen rows, and intervals treat rows as independent.", "");
      return lines.join("\n");
    } },
  { id: "metrics_csv", kind: "exporter", label: "Every metric of this pack as CSV", mime: "text/csv",
    help: "Aggregates: each metric's name, value and basis as this pack computes it on the shown rows now (blank where it does not apply). No inputs, answers or row numbers.",
    filename: (ctx) => `calibrate-${fileQid(ctx)}-metrics.csv`,
    build: (ctx) => {
      const results = runMetrics(METRICS.map((metric) => [metric.id, metric]), ctx);
      if (!results.some((row) => row.value !== null)) throw new Error("No metric applies to the shown rows yet.");
      return csvText([["metric", "value", "basis"], ...results.map((row) => [row.label, row.value === null ? "" : row.text, row.detail])]);
    } },
];

export default definePack({
  id: "calibrate-metrics",
  surface: "workbench.calibrate",
  title: "Calibrate metrics",
  about: "Classification, agreement, calibration-quality, ranking and selective-prediction metrics for Calibrate's question, measured on the shown rows with their basis and 95% intervals, plus aggregate CSV and Markdown exports. Exports hold counts, rates, thresholds and option keys only: no inputs, answers, row numbers or held-out rows.",
  features: [...METRICS, ...EXPORTS],
});
