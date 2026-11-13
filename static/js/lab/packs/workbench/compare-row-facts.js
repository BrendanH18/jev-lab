// Per-row facts of both variants for the Compare disagreement table (surface "workbench.compare.rows"; contract in
// static/js/lab/surfaces/workbench-compare.js). Each fact reads one row of the user's own Compare run: the two
// answers to the scored question, the picks, the label, the row as written and each call's measured usage. Nothing
// is stored, nothing is estimated, and a value that cannot be read is unavailable rather than guessed.
import { definePack } from "../../kit.js";
import { words } from "../../lib/text.js";

const EDGES = ["left", "top", "right", "bottom"];
const NAMES = ["A", "B"];
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const unit = (value) => (num(value) !== null && value >= 0 && value <= 1 ? value : null);
const answerOf = (item, v) => (Array.isArray(item?.answers) && isObject(item.answers[v]) ? item.answers[v] : null);
const pickOf = (item, v) => (Array.isArray(item?.picks) && typeof item.picks[v] === "string" ? item.picks[v] : null);
const signalOf = (item, v) => (Array.isArray(item?.signals) ? unit(item.signals[v]) : null);
const metaOf = (item, v, field) => (Array.isArray(item?.meta) && isObject(item.meta[v]) ? num(item.meta[v][field]) : null);

// An answer's probabilities as a Map of option -> p, keyed the way picks are written: Choice by option key, Score by
// level as text ("2"), Noul as yes/no. null for Box, for a missing list, or for any value outside 0..1.
function probsOf(answer) {
  if (!answer) return null;
  if (answer.type === "noul") {
    const p = unit(answer.noul);
    return p === null ? null : new Map([["yes", p], ["no", 1 - p]]);
  }
  if (answer.type !== "choice" && answer.type !== "score") return null;
  if (!isObject(answer.probabilities)) return null;
  const entries = Object.entries(answer.probabilities);
  if (!entries.length) return null;
  const out = new Map();
  for (const [key, p] of entries) {
    if (unit(p) === null) return null;
    let name = key;
    if (answer.type === "score") {
      if (!/^\s*[+-]?\d+\s*$/.test(key)) return null;
      name = String(Number.parseInt(key, 10));
    }
    if (out.has(name)) return null;
    out.set(name, p);
  }
  return out;
}

// The pick's probability minus the best other option's (negative when a Choice pick is not the most likely option).
function margin(item, v) {
  const probs = probsOf(answerOf(item, v)), pick = pickOf(item, v);
  if (!probs || probs.size < 2 || pick === null || !probs.has(pick)) return null;
  let other = -Infinity;
  for (const [key, p] of probs) if (key !== pick && p > other) other = p;
  return probs.get(pick) - other;
}

// The probability variant v gave to the other variant's pick; null when v does not offer that option.
function crossProb(item, v) {
  const probs = probsOf(answerOf(item, v)), other = pickOf(item, 1 - v);
  return probs && other !== null && probs.has(other) ? probs.get(other) : null;
}

// Total variation distance between the two probability lists: half the summed absolute differences. Noul gives
// |p(A) - p(B)|. null unless both answers list exactly the same options.
function probShift(item) {
  const a = probsOf(answerOf(item, 0)), b = probsOf(answerOf(item, 1));
  if (!a || !b || a.size !== b.size || [...a.keys()].some((key) => !b.has(key))) return null;
  let total = 0;
  for (const [key, p] of a) total += Math.abs(p - b.get(key));
  return total / 2;
}

function strengths(item) {
  const a = signalOf(item, 0), b = signalOf(item, 1);
  return a === null || b === null ? null : [a, b];
}

function labelText(label) {
  if (label === null || label === undefined || label === "") return null;
  if (typeof label === "boolean") return label ? "yes" : "no";
  if (typeof label === "number") return Number.isFinite(label) ? String(label) : null;
  if (typeof label === "string") return label;
  if (isObject(label) && EDGES.every((edge) => num(label[edge]) !== null)) return EDGES.map((edge) => label[edge].toFixed(2)).join(", ");
  return JSON.stringify(label);
}

// Every string in the row as written, the picture name ("_image") left out.
function rowStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) rowStrings(entry, out);
  else if (isObject(value)) for (const [key, entry] of Object.entries(value)) if (key !== "_image") rowStrings(entry, out);
  return out;
}

const scoreLevel = (item, v) => {
  const pick = pickOf(item, v);
  return answerOf(item, v)?.type === "score" && pick !== null && /^[+-]?\d+$/.test(pick) ? Number(pick) : null;
};

// A Score answer's expected score: its `score`, else the probability-weighted level (mirrors jev/calibrate.py _expected).
function expected(answer) {
  if (answer?.type !== "score") return null;
  if (num(answer.score) !== null) return answer.score;
  const probs = probsOf(answer);
  if (!probs) return null;
  let total = 0, weighted = 0;
  for (const [level, p] of probs) { total += p; weighted += Number(level) * p; }
  return total > 0 ? weighted / total : null;
}

function boxOf(answer) {
  if (answer?.type !== "box" || !isObject(answer.box)) return null;
  const edges = EDGES.map((edge) => unit(answer.box[edge]));
  if (edges.some((edge) => edge === null) || !(edges[0] < edges[2] && edges[1] < edges[3])) return null;
  return edges;
}

// Intersection over union of the two boxes (mirrors jev/calibrate.py iou).
function boxOverlap(item) {
  const a = boxOf(answerOf(item, 0)), b = boxOf(answerOf(item, 1));
  if (!a || !b) return null;
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = width * height;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

const perVariant = (id, label, help, value) => NAMES.map((name, v) => ({ id: `${id}_${name.toLowerCase()}`, kind: "fact", type: "number",
  label: label(name, NAMES[1 - v]), help: help(name, NAMES[1 - v]), value: (item) => value(item, v) }));

export default definePack({
  id: "compare-row-facts",
  surface: "workbench.compare.rows",
  title: "Compare row facts",
  about: "Filters and sorts for each compared row by both variants' probabilities, margins, picks, the label, the row's size and each call's measured cost, plus Score, Noul and Box specifics. Every value is read from your own Compare run's answers for the scored question; nothing is estimated or stored.",
  features: [
    ...perVariant("top_prob", (name) => `variant ${name}'s probability for its pick`,
      (name) => `The probability ${name}'s answer gives its own pick, whatever gate signal is selected (Noul: the larger of P(yes) and P(no); Box: its confidence).`,
      (item, v) => (Array.isArray(item?.tops) ? unit(item.tops[v]) : null)),
    ...perVariant("margin", (name) => `variant ${name}'s margin over its runner-up`,
      (name) => `${name}'s probability for its pick minus its most likely other option (Noul: |2p - 1|). Negative when a Choice pick is not its most likely option; unavailable for Box.`,
      margin),
    ...perVariant("cross_prob", (name, other) => `variant ${name}'s probability for ${other}'s pick`,
      (name, other) => `How much probability ${name} gave the answer ${other} picked. Unavailable when ${name} does not offer that option, and for Box.`,
      crossProb),
    { id: "prob_shift", kind: "fact", type: "number", label: "probability shift from A to B",
      help: "Half the summed absolute differences between the two probability lists (total variation distance, 0 to 1). Unavailable when the options differ, and for Box.",
      value: probShift },

    { id: "pick_a", kind: "fact", type: "category", label: "variant A's pick", help: "A's answer as Calibrate shows it: the option, yes or no, the level, or the box edges.",
      value: (item) => pickOf(item, 0) },
    { id: "pick_b", kind: "fact", type: "category", label: "variant B's pick", help: "B's answer as Calibrate shows it: the option, yes or no, the level, or the box edges.",
      value: (item) => pickOf(item, 1) },
    { id: "label", kind: "fact", type: "category", label: "human label", help: "The row's label for the scored question (yes or no for Noul, the level for Score, box edges for Box).",
      value: (item) => labelText(item?.label) },
    { id: "more_confident", kind: "fact", type: "category", label: "more confident variant",
      help: "The variant with the higher gate signal on this row, or tie.",
      value: (item) => {
        const pair = strengths(item);
        return pair === null ? null : pair[0] > pair[1] ? "A" : pair[1] > pair[0] ? "B" : "tie";
      } },
    { id: "confident_side_right", kind: "fact", type: "flag", label: "the more confident variant right",
      help: "On a scored row, the variant with the higher signal matched the label. Ties and unscored rows count as without.",
      value: (item) => {
        const pair = strengths(item);
        if (pair === null || pair[0] === pair[1] || !item.verdict || !Array.isArray(item.correct)) return false;
        return item.correct[pair[0] > pair[1] ? 0 : 1] === true;
      } },

    { id: "row_words", kind: "fact", type: "number", label: "words in the row", unit: "words",
      help: "Whitespace-separated words across the row's text values; a picture name does not count.",
      value: (item) => (item && typeof item === "object" && "row" in item && item.row !== null ? rowStrings(item.row).reduce((total, text) => total + words(text).length, 0)
        : typeof item?.text === "string" ? words(item.text).length : null) },
    { id: "row_fields", kind: "fact", type: "number", label: "fields in an object row", unit: "fields",
      help: "Top-level fields of a row written as an object, not counting its picture name. Unavailable for text and list rows.",
      value: (item) => (isObject(item?.row) ? Object.keys(item.row).filter((key) => key !== "_image").length : null) },
    { id: "has_picture", kind: "fact", type: "flag", label: "a picture", help: "The row as written names a picture (_image).",
      value: (item) => isObject(item?.row) && typeof item.row._image === "string" && item.row._image.trim() !== "" },
    ...perVariant("cost", (name) => `variant ${name}'s cost`,
      (name) => `What ${name}'s call on this row cost in USD, as measured (both calls when asked in both orders).`,
      (item, v) => metaOf(item, v, "cost_usd")).map((fact) => ({ ...fact, unit: "USD" })),

    { id: "level_gap", kind: "fact", type: "number", label: "level gap between A and B", unit: "levels",
      help: "How many levels apart the two Score picks are. Unavailable for other question types.",
      value: (item) => {
        const a = scoreLevel(item, 0), b = scoreLevel(item, 1);
        return a === null || b === null ? null : Math.abs(a - b);
      } },
    { id: "expected_gap", kind: "fact", type: "number", label: "expected score of B minus A",
      help: "B's expected Score level minus A's: each answer's score, else its probability-weighted level. Unavailable for other question types.",
      value: (item) => {
        const a = expected(answerOf(item, 0)), b = expected(answerOf(item, 1));
        return a === null || b === null ? null : b - a;
      } },
    { id: "yes_gap", kind: "fact", type: "number", label: "yes probability of B minus A",
      help: "B's Noul probability of yes minus A's. Unavailable for other question types.",
      value: (item) => {
        const a = answerOf(item, 0), b = answerOf(item, 1);
        return a?.type === "noul" && b?.type === "noul" && unit(a.noul) !== null && unit(b.noul) !== null ? b.noul - a.noul : null;
      } },
    { id: "box_overlap", kind: "fact", type: "number", label: "box overlap between A and B",
      help: "Intersection over union of A's and B's boxes: 1 is the same box, 0 no overlap. Unavailable for other question types.",
      value: boxOverlap },
  ],
});
