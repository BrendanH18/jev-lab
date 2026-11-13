// More facts and advisory checks for the rows Calibrate scores (surface "workbench.calibrate"; contract in
// static/js/lab/surfaces/workbench-analysis.js). Scored-row facts for every type, then facts that apply to one answer
// type only (Score, Noul, Box; null for the others), then checks. Everything is arithmetic on the current user's own
// Bulk run in this page session: no model call, no storage, nothing kept. Held-out test rows are never items here.
import { definePack, toNumber } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";

const EPS = 1e-9;          // the page's tie rule: signal + 1e-9 >= threshold clears
const FAR = 2;             // a Score answer this many levels from the label is far off
const SPLIT = 1;           // an expected score this far from the most likely level means a split answer
const CLIFF = 0.05;        // a 0.01 move of the threshold that re-routes this share of the shown rows is a cliff
const FEW_SIGNALS = 3;     // this many distinct signal values or fewer leaves thresholds little room
const OVER_GIVEN = 0.2;    // an answer given this much more often than it is labeled (share of shown rows)
const NONE = "(none)";     // the slice of rows without the field, as By slice names it

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const thresholdOf = (ctx) => num(ctx?.data?.threshold) ?? 0.5;
const automated = (item, ctx) => num(item.signal) !== null && item.signal + EPS >= thresholdOf(ctx);
const typeOf = (item) => (typeof item?.type === "string" ? item.type : isObject(item?.answer) ? item.answer.type : null);
const answerOf = (item, type) => (isObject(item?.answer) && item.answer.type === type ? item.answer : null);
const listType = (items, ctx) => ctx?.data?.type || typeOf(items.find((item) => typeOf(item))) || null;
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const rowName = (item) => (Number.isInteger(item?.number) ? `#${item.number}` : "a row");

// The answer's options as [key, p] (Choice and Score probabilities; a Noul's yes and no), most likely first, ties in
// the answer's own order. null for a Box or an answer without readable probabilities.
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

// 1 + the options the answer made more likely than the label; null when the label is not among the options.
function labelRank(item) {
  const list = options(item);
  if (!list) return null;
  const found = list.find(([key]) => key === String(item.label));
  return found ? 1 + list.filter(([, p]) => p > found[1]).length : null;
}

// Entropy of the option distribution over the log of the option count: 0 is certain, 1 an even spread.
function entropy(item) {
  const list = options(item);
  if (!list || list.length < 2) return null;
  const total = list.reduce((sum, [, p]) => sum + p, 0);
  if (!(total > 0)) return null;
  const h = list.reduce((sum, [, p]) => (p > 0 ? sum - (p / total) * Math.log(p / total) : sum), 0);
  return Math.min(1, Math.max(0, h / Math.log(list.length)));
}

function scoreLevels(item) {
  if (typeOf(item) !== "score") return null;
  const predicted = toNumber(item.predicted), label = toNumber(item.label);
  return predicted === null || label === null ? null : { predicted, label };
}

const EDGES = ["left", "top", "right", "bottom"];
function boxOf(value) {
  if (!isObject(value)) return null;
  const out = {};
  for (const edge of EDGES) {
    if (num(value[edge]) === null) return null;
    out[edge] = value[edge];
  }
  return out;
}

// The label as Calibrate shows a box: "left, top, right, bottom" with two decimals.
function labelBox(item) {
  const parts = String(item?.label ?? "").split(",").map((part) => toNumber(part));
  return parts.length === 4 && parts.every((part) => part !== null) ? Object.fromEntries(EDGES.map((edge, i) => [edge, parts[i]])) : null;
}

const area = (box) => Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);

// Intersection over union, as jev/calibrate.py iou: 1 identical, 0 disjoint (also when the union is empty).
function iou(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = w * h;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return union > 0 ? inter / union : 0;
}

function rowIou(item) {
  if (typeOf(item) !== "box") return null;
  const predicted = boxOf(answerOf(item, "box")?.box), label = labelBox(item);
  return predicted && label ? iou(predicted, label) : null;
}

// The input's identity as dataset health and Review use it: field order ignored, picture names kept (the item's row
// already has no label or test marker). null for a row the run does not hold.
const identity = (item) => (item?.row === null || item?.row === undefined ? null : stableStringify(item.row));

// How many items share each identity, counted once per items() list (the surface keeps the same array until the list
// changes), so filtering and sorting stay linear in the rows.
const GROUPS = new WeakMap();
function identityCounts(list) {
  if (!GROUPS.has(list)) {
    const counts = new Map();
    for (const item of list) {
      const key = identity(item);
      if (key !== null) counts.set(key, (counts.get(key) || 0) + 1);
    }
    GROUPS.set(list, counts);
  }
  return GROUPS.get(list);
}

// A field value as By slice groups it (jev/slices.py _value): missing, null or blank is "(none)", text is stripped of
// what Python's str.strip removes, anything else is Python's json.dumps(sort_keys=True): ", " and ": " separators and
// every non-ASCII character escaped as \uXXXX (ensure_ascii).
const PY_SPACE = "[\\s\\x1c-\\x1f\\x85]";
const PY_STRIP = new RegExp(`^(?:(?!\\ufeff)${PY_SPACE})+|(?:(?!\\ufeff)${PY_SPACE})+$`, "g");
const pyStrip = (text) => text.replace(PY_STRIP, "");
const pyString = (text) => JSON.stringify(text).replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
function pyJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return pyString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(pyJson).join(", ")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${pyString(key)}: ${pyJson(value[key])}`).join(", ")}}`;
  return "null";
}
function sliceValue(row, field) {
  if (!isObject(row) || !Object.prototype.hasOwnProperty.call(row, field) || row[field] === null || row[field] === "") return NONE;
  const value = row[field];
  return pyStrip(typeof value === "string" ? value : pyJson(value)) || NONE;
}

function bandOf(signal) {
  const k = Math.min(9, Math.max(0, Math.floor(signal * 10 + EPS)));
  return `${(k / 10).toFixed(1)}–${((k + 1) / 10).toFixed(1)}`;
}

const nextStep = (t, step) => Math.round(t * 100 + step) / 100;

export default definePack({
  id: "calibrate-row-facts",
  surface: "workbench.calibrate",
  title: "Calibrate row facts",
  about: "More filters, sorts and breakdowns for the rows Calibrate scores (probabilities, ranks, duplicates, slices, Score levels, Noul P(yes), Box overlap) and advisory checks. Everything reads your own run's answers and labels in this page session; held-out test rows never appear.",
  features: [
    // ---------- every type ----------
    { id: "stated_probability", kind: "fact", type: "number", label: "stated probability of the answer",
      help: "The probability the answer gave its own prediction (a Noul's max(P(yes), 1 − P(yes)); a Box's confidence).",
      value: (item) => num(item.top) },
    { id: "entropy", kind: "fact", type: "number", label: "spread of the option probabilities",
      help: "Normalized entropy: 0 when one option holds everything, 1 when every option is equally likely. Not available for a Box.",
      value: entropy },
    { id: "label_rank", kind: "fact", type: "number", label: "rank of the label among the options",
      help: "1 when the answer's most likely option is the label, 2 when the label came second, and so on. Not available for a Box.",
      value: labelRank },
    { id: "set_size", kind: "fact", type: "number", label: "options in the reviewer's list",
      help: "How many options the Answer sets fit lists for the row; not available before a fit.",
      value: (item) => (isObject(item.set) && Number.isInteger(item.set.size) ? item.set.size : null) },
    { id: "same_input_rows", kind: "fact", type: "number", label: "scored rows with the same input",
      help: "Scored rows whose input is identical (field order ignored, picture names kept), this row included. They always share a cross-validation fold.",
      value: (item, ctx) => {
        const key = identity(item);
        if (key === null) return null;
        const list = typeof ctx?.items === "function" ? ctx.items() : null;
        return Array.isArray(list) ? identityCounts(list).get(key) || null : null;
      } },
    { id: "label_is_runner_up", kind: "fact", type: "flag", label: "a label the answer ranked second",
      help: "Wrong rows whose label was the answer's second choice: often a near miss rather than a confused answer.",
      value: (item) => item.correct === false && labelRank(item) === 2 },
    { id: "missing_confidence", kind: "fact", type: "flag", label: "an answer without a confidence field",
      help: "A Choice or Score answer with no confidence: its confidence signal is how far the top probability sits above an even split.",
      value: (item) => {
        const answer = item.answer;
        return isObject(answer) && ["choice", "score"].includes(answer.type) && num(answer.confidence) === null;
      } },
    { id: "outcome", kind: "fact", type: "category", label: "route and result",
      help: "Automated or reviewed at the slider's threshold, and right or wrong.",
      value: (item, ctx) => (num(item.signal) === null || typeof item.correct !== "boolean" ? null
        : `${automated(item, ctx) ? "automated" : "reviewed"} ${item.correct ? "right" : "wrong"}`) },
    { id: "label", kind: "fact", type: "category", label: "human label", value: (item) => (item.label ? String(item.label) : null) },
    { id: "signal_band", kind: "fact", type: "category", label: "signal band",
      help: "Ten bands 0.1 wide; a signal of exactly 1 falls in 0.9–1.0.", value: (item) => (num(item.signal) === null ? null : bandOf(item.signal)) },
    { id: "slice_value", kind: "fact", type: "category", label: "value of the slice field",
      help: "The row's value of the field By slice is split on, grouped as By slice groups it; not available until a field is chosen there.",
      value: (item, ctx) => {
        const field = ctx?.data?.slices?.field;
        return typeof field === "string" && field ? sliceValue(item.row, field) : null;
      } },

    // ---------- one type ----------
    { id: "level_error", kind: "fact", type: "number", label: "levels the Score answer is off",
      help: "Most likely level minus the labeled level: negative scored low, positive scored high. Score questions only.",
      value: (item) => {
        const levels = scoreLevels(item);
        return levels && levels.predicted - levels.label;
      } },
    { id: "expected_error", kind: "fact", type: "number", label: "distance of the expected score from the label",
      help: "|expected score − labeled level|, using the answer's probability-weighted score. Score questions only.",
      value: (item) => {
        const label = typeOf(item) === "score" ? toNumber(item.label) : null;
        const score = num(answerOf(item, "score")?.score);
        return label === null || score === null ? null : Math.abs(score - label);
      } },
    { id: "error_kind", kind: "fact", type: "category", label: "yes or no outcome",
      help: "true yes, false yes, true no or false no, from the answer (P(yes) ≥ 0.5 is yes) and the label. Noul questions only.",
      value: (item) => {
        if (typeOf(item) !== "noul" || !["yes", "no"].includes(item.predicted) || !["yes", "no"].includes(item.label)) return null;
        return `${item.predicted === item.label ? "true" : "false"} ${item.predicted}`;
      } },
    { id: "p_yes", kind: "fact", type: "number", label: "probability of yes", help: "The Noul answer's P(yes). Noul questions only.",
      value: (item) => (typeOf(item) === "noul" ? num(answerOf(item, "noul")?.noul) : null) },
    { id: "iou", kind: "fact", type: "number", label: "overlap with the labeled box",
      help: "Intersection over union of the answered and labeled boxes (the label as Calibrate shows it, at two decimals). Right means 0.5 or more. Box questions only.",
      value: rowIou },
    { id: "box_area", kind: "fact", type: "number", label: "area of the answered box",
      help: "Width × height of the answered box, as a share of the picture. Box questions only.",
      value: (item) => {
        const box = typeOf(item) === "box" ? boxOf(answerOf(item, "box")?.box) : null;
        return box && area(box);
      } },

    // ---------- checks on one row ----------
    { id: "score_far_off", kind: "diagnostic", severity: "advice", label: "Score answer two or more levels off",
      check: (item) => {
        const levels = scoreLevels(item);
        if (!levels || Math.abs(levels.predicted - levels.label) < FAR) return null;
        return `answered level ${item.predicted} for a row labeled ${item.label}: ${Math.abs(levels.predicted - levels.label)} levels off; check the label and the level descriptions`;
      } },
    { id: "score_split", kind: "diagnostic", severity: "info", label: "Score answer split between distant levels",
      check: (item) => {
        const predicted = typeOf(item) === "score" ? toNumber(item.predicted) : null;
        const score = num(answerOf(item, "score")?.score);
        if (predicted === null || score === null || Math.abs(score - predicted) + EPS < SPLIT) return null;
        return `the expected score ${score.toFixed(2)} sits ${Math.abs(score - predicted).toFixed(2)} levels from the most likely level ${item.predicted}: the answer is torn between distant levels`;
      } },
    { id: "box_no_overlap", kind: "diagnostic", severity: "advice", label: "Answered box misses the labeled box",
      check: (item) => (rowIou(item) === 0 ? "the answered box does not overlap the labeled box at all (IoU 0): check the label, or whether the picture holds the object twice" : null) },
    { id: "box_degenerate", kind: "diagnostic", severity: "advice", label: "Answered box is empty or outside the picture",
      check: (item) => {
        if (typeOf(item) !== "box" || !answerOf(item, "box")) return null;
        const box = boxOf(item.answer.box);
        if (!box) return "the answered box lacks a numeric edge";
        if (box.right <= box.left || box.bottom <= box.top) return "the answered box has no area (an edge sits on or past its opposite edge)";
        if (EDGES.some((edge) => box[edge] < -EPS || box[edge] > 1 + EPS)) return "the answered box reaches outside the picture (an edge below 0 or above 1)";
        return null;
      } },

    // ---------- checks on the shown rows ----------
    { id: "label_conflict", kind: "diagnostic", severity: "advice", scope: "list", label: "Identical inputs with different labels",
      check: (items) => {
        const groups = new Map();
        for (const item of items) {
          const key = identity(item);
          if (key === null) continue;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        return [...groups.values()].filter((group) => group.length > 1 && new Set(group.map((item) => String(item.label))).size > 1)
          .map((group) => `Rows ${group.map(rowName).join(", ")} share one input but carry different labels: at most one can be right, so settle the label before tuning.`);
      } },
    { id: "cliff", kind: "diagnostic", severity: "info", scope: "list", label: "Threshold on a cliff",
      check: (items, ctx) => {
        const rows = items.filter((item) => num(item.signal) !== null);
        if (!rows.length) return null;
        const t = thresholdOf(ctx);
        const steps = [t > 0 ? nextStep(t, -1) : null, t < 1 ? nextStep(t, 1) : null].filter((step) => step !== null);
        const clears = (item, at) => item.signal + EPS >= at;
        const flips = rows.filter((item) => steps.some((step) => clears(item, step) !== clears(item, t))).length;
        return flips && flips / rows.length >= CLIFF
          ? `Moving the threshold ${t.toFixed(2)} by 0.01 either way re-routes ${flips} of ${rows.length} shown rows (${percent(flips / rows.length)}): small moves change a lot here.`
          : null;
      } },
    { id: "few_distinct_signals", kind: "diagnostic", severity: "info", scope: "list", label: "Few distinct signal values",
      check: (items) => {
        const signals = items.map((item) => num(item.signal)).filter((value) => value !== null);
        const distinct = new Set(signals).size;
        return signals.length >= 5 && distinct <= FEW_SIGNALS
          ? `The ${signals.length} shown rows take only ${distinct} distinct signal value${distinct === 1 ? "" : "s"}, so a threshold can only route them ${distinct + 1} different ways.`
          : null;
      } },
    { id: "class_never_answered", kind: "diagnostic", severity: "advice", scope: "list", label: "Labeled option the answer never gives",
      check: (items, ctx) => {
        if (!items.length || listType(items, ctx) === "box") return null;
        const answered = new Set(items.map((item) => String(item.predicted)));
        const counts = new Map();
        for (const item of items) if (item.label) counts.set(String(item.label), (counts.get(String(item.label)) || 0) + 1);
        return [...counts].filter(([label]) => !answered.has(label))
          .map(([label, count]) => `“${label}” is the label of ${count} shown row${count === 1 ? "" : "s"} but never the answer: check its description in the question.`);
      } },
    { id: "over_given_answer", kind: "diagnostic", severity: "advice", scope: "list", label: "Answer given far more often than labeled",
      check: (items, ctx) => {
        if (items.length < 5 || listType(items, ctx) === "box") return null;
        const answered = new Map(), labeled = new Map();
        for (const item of items) {
          answered.set(String(item.predicted), (answered.get(String(item.predicted)) || 0) + 1);
          labeled.set(String(item.label), (labeled.get(String(item.label)) || 0) + 1);
        }
        return [...answered].filter(([key, count]) => (count - (labeled.get(key) || 0)) / items.length + EPS >= OVER_GIVEN)
          .map(([key, count]) => `“${key}” is the answer on ${count} of ${items.length} shown rows but the label on ${labeled.get(key) || 0}: the question may pull toward it.`);
      } },
  ],
});
