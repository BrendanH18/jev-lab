// Bulk result facts: per-row facts across a row's answers (margins, entropy, agreement with labels, Score and Box
// distances, call measurements) and advisory checks over the answers of the user's own Bulk run
// (surface workbench.bulk.results; contract in static/js/lab/surfaces/workbench-bulk.js).
// Read-only: it never edits answers or labels, never fills a missing answer, and never shows a held-out row's answers
// (items already hide them). Every threshold here is plain local arithmetic, advisory only, and never changes Policy.
import { definePack } from "../../kit.js";
import { median } from "../../lib/math.js";
import { stableStringify } from "../../lib/json.js";

const answersOf = (item) => (item && item.answers && typeof item.answers === "object" ? Object.entries(item.answers) : []);
const isNum = (value) => typeof value === "number" && Number.isFinite(value);
const nums = (values) => values.filter(isNum);
const lowest = (values) => (nums(values).length ? Math.min(...nums(values)) : null);
const highest = (values) => (nums(values).length ? Math.max(...nums(values)) : null);
const percent = (value) => `${Math.round(value * 100)}%`;
const rowList = (items) => items.map((item) => item.position).join(", ");
const ranked = (answer) => nums((answer.probabilities || []).map((entry) => entry.p)).sort((a, b) => b - a);
const isEdges = (value) => !!value && typeof value === "object" && ["left", "top", "right", "bottom"].every((edge) => isNum(value[edge]));
// A box whose edges are in order (left < right, top < bottom); an inverted answer box has no area or overlap.
const isBox = (value) => isEdges(value) && value.left < value.right && value.top < value.bottom;

// The gap between the two most likely options or levels of a Choice or Score answer; null when it has fewer than two.
function margin(answer) {
  if (answer.type !== "choice" && answer.type !== "score") return null;
  const ps = ranked(answer);
  return ps.length >= 2 ? ps[0] - ps[1] : null;
}

// Shannon entropy of an answer's probabilities (rescaled to sum to 1) divided by ln(number of options): 0 is one sure
// option, 1 is every option equally likely. null for a Box or fewer than two options.
function normalizedEntropy(answer) {
  if (answer.type === "box") return null;
  const ps = nums((answer.probabilities || []).map((entry) => entry.p));
  const total = ps.reduce((sum, p) => sum + p, 0);
  if (ps.length < 2 || !(total > 0)) return null;
  const entropy = ps.reduce((sum, p) => (p > 0 ? sum - (p / total) * Math.log(p / total) : sum), 0);
  return entropy / Math.log(ps.length);
}

// Intersection over union of two boxes of edge fractions.
function iou(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = width * height;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return union > 0 ? inter / union : null;
}

const verdicts = (item) => answersOf(item).map(([, answer]) => answer.agrees).filter((value) => value === true || value === false);
const calAnswer = (item, ctx) => {
  const qid = ctx?.data?.calQuestion;
  return qid && item.answers ? item.answers[qid] || null : null;
};

export default definePack({
  id: "bulk-result-facts",
  surface: "workbench.bulk.results",
  title: "Bulk result facts",
  about: "Per-row facts across the answers of your own Bulk run in this session (margins, entropy, agreement with your labels, Score and Box distances, output tokens) and advisory checks. Held-out rows' answers stay hidden; every threshold is local arithmetic and never changes Policy.",
  features: [
    // ---------- probability shape ----------
    { id: "min_margin", kind: "fact", type: "number", label: "smallest top-two margin",
      help: "Across the row's Choice and Score answers, the smallest gap between the two most likely options or levels.",
      value: (item) => lowest(answersOf(item).map(([, answer]) => margin(answer))) },
    { id: "max_entropy", kind: "fact", type: "number", label: "highest normalized entropy",
      help: "Across the row's Choice, Score and Noul answers, the largest entropy of the probabilities divided by ln(number of options): 0 is one certain option, 1 is all options equally likely.",
      value: (item) => highest(answersOf(item).map(([, answer]) => normalizedEntropy(answer))) },
    { id: "mean_p", kind: "fact", type: "number", label: "mean answer probability",
      help: "The mean probability of the predicted answers on the row (a Noul counts max(P, 1 − P)); Box answers carry none.",
      value: (item) => {
        const ps = nums(answersOf(item).map(([, answer]) => answer.p));
        return ps.length ? ps.reduce((sum, p) => sum + p, 0) / ps.length : null;
      } },
    { id: "p_spread", kind: "fact", type: "number", label: "probability spread across questions",
      help: "The most certain answer's probability minus the least certain one's on the row: how unevenly sure the model is across questions.",
      value: (item) => {
        const ps = nums(answersOf(item).map(([, answer]) => answer.p));
        return ps.length >= 2 ? Math.max(...ps) - Math.min(...ps) : null;
      } },
    { id: "noul_distance", kind: "fact", type: "number", label: "smallest Noul distance from 0.5",
      help: "How far the row's least decided yes/no answer is from 0.5 (0 is a coin flip, 0.5 is certain).",
      value: (item) => lowest(answersOf(item).filter(([, answer]) => answer.type === "noul").map(([, answer]) => (isNum(answer.value) ? Math.abs(answer.value - 0.5) : null))) },
    { id: "confidence_gap", kind: "fact", type: "number", label: "largest confidence–probability gap",
      help: "Across answers that carry both, the largest difference between the answer's confidence field and the probability of its predicted option.",
      value: (item) => highest(answersOf(item).map(([, answer]) => (isNum(answer.confidence) && isNum(answer.p) ? Math.abs(answer.confidence - answer.p) : null))) },
    { id: "score_level_gap", kind: "fact", type: "number", label: "largest Score gap to its likeliest level",
      help: "Across Score answers, the distance between the score value and the level with the highest probability. A large gap means the probability mass is split.",
      value: (item) => highest(answersOf(item).filter(([, answer]) => answer.type === "score")
        .map(([, answer]) => (isNum(answer.value) && answer.predicted !== null ? Math.abs(answer.value - Number(answer.predicted)) : null))) },

    // ---------- agreement with human labels ----------
    { id: "scored_labels", kind: "fact", type: "number", label: "scored labels",
      help: "Answers on the row with a valid human label to compare against (Box: when both have edges).",
      value: (item) => (item.answers ? verdicts(item).length : null) },
    { id: "agreement_share", kind: "fact", type: "number", label: "share of labels that agree",
      help: "Of the row's scored labels, the share the answer agrees with (Box: overlap of at least 0.5). Unavailable without a scored label.",
      value: (item) => {
        const marks = verdicts(item);
        return marks.length ? marks.filter(Boolean).length / marks.length : null;
      } },
    { id: "score_label_distance", kind: "fact", type: "number", label: "largest Score distance from label",
      help: "Across Score answers with a valid label, the distance between the score value and the labeled level.",
      value: (item) => highest(answersOf(item).filter(([, answer]) => answer.type === "score" && answer.labelValid === true)
        .map(([, answer]) => (isNum(answer.value) ? Math.abs(answer.value - Number(answer.label)) : null))) },
    { id: "box_iou", kind: "fact", type: "number", label: "smallest Box overlap with label",
      help: "Across Box answers with a valid labeled box, the smallest intersection over union of the answer and the label.",
      value: (item) => lowest(answersOf(item).filter(([, answer]) => answer.type === "box" && isBox(answer.box) && isBox(answer.label))
        .map(([, answer]) => iou(answer.box, answer.label))) },
    { id: "disagreeing_questions", kind: "fact", type: "text", label: "disagreeing questions",
      help: "The question ids on the row whose answer disagrees with its human label, in answer order.",
      value: (item) => answersOf(item).filter(([, answer]) => answer.agrees === false).map(([qid]) => qid).join(", ") },
    { id: "cal_label", kind: "fact", type: "category", label: "label for Calibrate's question",
      help: "The human label for the question Calibrate shows, in the answer's terms; unavailable without a valid label, on unanswered rows and on held-out rows.",
      value: (item, ctx) => { const label = calAnswer(item, ctx)?.label; return typeof label === "string" ? label : null; } },
    { id: "cal_verdict", kind: "fact", type: "category", label: "Calibrate verdict",
      help: "Calibrate's right/wrong verdict for its question on this row; unavailable when it did not score the row.",
      value: (item) => (item.calCorrect === true ? "right" : item.calCorrect === false ? "wrong" : null) },

    // ---------- answer shape across questions ----------
    { id: "weakest_question", kind: "fact", type: "category", label: "least certain question",
      help: "The question whose predicted answer has the lowest probability on the row (the first one on a tie).",
      value: (item) => {
        let best = null;
        for (const [qid, answer] of answersOf(item)) if (isNum(answer.p) && (!best || answer.p < best.p)) best = { qid, p: answer.p };
        return best ? best.qid : null;
      } },
    { id: "box_area", kind: "fact", type: "number", label: "largest Box area share",
      help: "The largest share of the picture a Box answer on the row covers (width × height in edge fractions). A box with its edges out of order has no area.",
      value: (item) => highest(answersOf(item).filter(([, answer]) => isBox(answer.box))
        .map(([, answer]) => (answer.box.right - answer.box.left) * (answer.box.bottom - answer.box.top))) },
    { id: "output_tokens", kind: "fact", type: "number", label: "output tokens", unit: "tokens",
      help: "Measured output tokens of the row's call; unavailable when the call did not report them.",
      value: (item) => (isNum(item.meta?.output_tokens) ? item.meta.output_tokens : null) },

    // ---------- checks ----------
    { id: "confident_wrong", kind: "diagnostic", severity: "problem", label: "Confident answer that disagrees with its label",
      help: "An answer at 80% or more probability that its valid human label contradicts: check the label or the question's wording.",
      check: (item) => answersOf(item).filter(([, answer]) => isNum(answer.p) && answer.p >= 0.8 && answer.agrees === false)
        .map(([qid, answer]) => `${qid}: ${percent(answer.p)} sure of ${answer.predicted}, but the label says ${answer.label}.`) },
    { id: "noul_tie", kind: "diagnostic", severity: "info", label: "Noul exactly 0.5",
      check: (item) => answersOf(item).filter(([, answer]) => answer.type === "noul" && answer.value === 0.5)
        .map(([qid]) => `${qid} is exactly 0.5: it reads as yes only because 0.5 counts as yes.`) },
    { id: "rate_limited", kind: "diagnostic", severity: "info", label: "Rate-limited call",
      check: (item) => (item.status === "failed" && /rate.?limit|too many requests|\b429\b/i.test(item.error || "")
        ? "This call was rate limited. Wait a little, then retry it from the table." : null) },
    { id: "labels_unanswered", kind: "diagnostic", severity: "advice", label: "Labels on a row with no answer",
      check: (item) => {
        if (item.status === "answered" || item.test || !item.labels || typeof item.labels !== "object") return null;
        const ids = Object.keys(item.labels);
        return ids.length ? `Labels for ${ids.join(", ")} cannot be scored: this row has no answer. Retry it from the table to score them.` : null;
      } },
    { id: "latency_outlier", kind: "diagnostic", severity: "info", scope: "list", label: "Call over three times the median latency",
      help: "Needs at least three measured calls among the shown rows.",
      check: (items) => {
        const timed = items.filter((item) => isNum(item.meta?.latency_ms));
        if (timed.length < 3) return null;
        const middle = median(timed.map((item) => item.meta.latency_ms));
        return timed.filter((item) => item.meta.latency_ms > 3 * middle)
          .map((item) => `Row ${item.position} took ${Math.round(item.meta.latency_ms)} ms, over three times the median of ${Math.round(middle)} ms.`);
      } },
    { id: "same_input_split", kind: "diagnostic", severity: "advice", scope: "list", label: "Same input, different answers",
      help: "Shown answered rows with the same input and picture whose predicted answers differ: the model is unsure about that input.",
      check: (items) => {
        const groups = new Map();
        for (const item of items) {
          if (!item.answers) continue;
          const key = stableStringify([item.input ?? null, item.image ?? null]);
          groups.set(key, [...(groups.get(key) || []), item]);
        }
        const out = [];
        for (const group of groups.values()) {
          if (group.length < 2) continue;
          const qids = [...new Set(group.flatMap((item) => Object.keys(item.answers)))].filter((qid) => new Set(group
            .map((item) => item.answers[qid]?.predicted).filter((value) => value !== null && value !== undefined)).size > 1);
          if (qids.length) out.push(`Rows ${rowList(group)} have the same input and picture but different answers to ${qids.join(", ")}.`);
        }
        return out;
      } },
    { id: "one_class", kind: "diagnostic", severity: "info", scope: "list", label: "Every answer to a Choice question the same",
      help: "A Choice question that got the same answer on every shown answered row (three or more): the rows may not test it.",
      check: (items) => {
        const qids = [...new Set(items.flatMap((item) => answersOf(item).filter(([, answer]) => answer.type === "choice").map(([qid]) => qid)))];
        return qids.flatMap((qid) => {
          const picked = items.map((item) => item.answers?.[qid]?.predicted).filter((value) => typeof value === "string");
          return picked.length >= 3 && new Set(picked).size === 1 ? [`Every shown answer to ${qid} is ${picked[0]} (${picked.length} rows).`] : [];
        });
      } },
    { id: "shared_error", kind: "diagnostic", severity: "advice", scope: "list", label: "Failed rows sharing one error",
      check: (items) => {
        const groups = new Map();
        for (const item of items) if (item.status === "failed" && item.error) groups.set(item.error, [...(groups.get(item.error) || []), item]);
        return [...groups].filter(([, group]) => group.length >= 2)
          .map(([error, group]) => `${group.length} failed rows share one error (rows ${rowList(group)}): ${error}`);
      } },
  ],
});
