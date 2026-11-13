// Facts, checks and metrics for the answers of the Build tab's latest Run (surface workbench.build.result, contract in
// static/js/lab/surfaces/workbench-build.js). Every value reads the user's own Run in this page session; expectation
// checks mirror jev/workbench.py check_expectation and iou in local code, and every threshold here is a local,
// advisory rule. Nothing is stored and nothing calls the model.
import { definePack, toNumber } from "../../kit.js";

const RUN_NOTE = "From your latest Run in this page session.";
const EDGES = ["left", "top", "right", "bottom"];
const CATCH_ALL = new Set(["none", "other", "others", "unknown", "neither", "na", "n_a", "not_applicable", "none_of_these", "none_of_the_above",
  "something_else", "unclear", "unsure", "not_sure", "no_match"]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object, key) => isObject(object) && Object.prototype.hasOwnProperty.call(object, key);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const probsOf = (item) => (Array.isArray(item?.probabilities) ? item.probabilities.filter((entry) => entry && finite(entry.p) !== null) : []);
const fixed2 = (value) => value.toFixed(2);

// Probabilities from most to least likely; ties keep the response order.
const ranked = (item) => probsOf(item).map((entry, index) => ({ ...entry, index })).sort((a, b) => b.p - a.p || a.index - b.index);

// Edges of a box as numbers, or null when one is missing or not finite. read: finite for an answer, toNumber for a
// human expectation (check_expectation reads those with float(), so "0.5" counts).
function edgesOf(box, read = finite) {
  if (!isObject(box)) return null;
  const edges = EDGES.map((edge) => read(box[edge]));
  return edges.includes(null) ? null : { left: edges[0], top: edges[1], right: edges[2], bottom: edges[3] };
}

// Intersection over union of two boxes of edge fractions, as jev/workbench.py iou.
function iou(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = w * h;
  const area = (e) => Math.max(0, e.right - e.left) * Math.max(0, e.bottom - e.top);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

// The value check_expectation compares with min and max: P(chosen option) for a Choice (0 when it is not listed),
// the score, or P(yes). null for a Box or an odd answer.
function targetOf(item) {
  if (item.type === "choice") {
    const entry = probsOf(item).find((one) => one.key === item.value);
    return entry ? entry.p : 0;
  }
  return item.type === "score" || item.type === "noul" ? finite(item.value) : null;
}

// Signed distance to the nearest failing bound (numeric min/max, or the Box IoU floor): positive inside, negative
// outside. null when the expectation has no such bound for this answer.
function headroom(item) {
  const expect = item.expectation;
  if (!isObject(expect)) return null;
  if (item.type === "box") {
    const answer = edgesOf(item.box), wanted = hasOwn(expect, "box") ? edgesOf(expect.box, toNumber) : null;
    if (!answer || !wanted) return null;
    const floor = hasOwn(expect, "iou_min") ? toNumber(expect.iou_min) : 0.5;
    return floor === null ? null : iou(answer, wanted) - floor;
  }
  const target = targetOf(item);
  if (target === null) return null;
  const gaps = [];
  const min = toNumber(expect.min), max = toNumber(expect.max);
  if (hasOwn(expect, "min")) gaps.push(min === null ? null : target - min);
  if (hasOwn(expect, "max")) gaps.push(max === null ? null : max - target);
  return gaps.length && !gaps.includes(null) ? Math.min(...gaps) : null;
}

// true (met), false (missed) or null (nothing checked), as check_expectation decides it.
function meets(item) {
  const expect = item.expectation;
  if (!isObject(expect)) return null;
  if (item.type === "box") {
    const room = headroom(item);
    return room === null ? null : room >= 0;
  }
  if (!["choice", "score", "noul"].includes(item.type)) return null;
  let checked = false, ok = true;
  if (item.type === "choice" && hasOwn(expect, "choice")) { checked = true; ok = item.value === expect.choice; }
  if (hasOwn(expect, "min") || hasOwn(expect, "max")) {
    const room = headroom(item);
    if (room === null) return null;
    checked = true;
    ok = ok && room >= 0;
  }
  return checked ? ok : null;
}

// The nearest Score level, halves up, within 0..scale.
function nearestLevel(item) {
  const score = finite(item.value);
  if (item.type !== "score" || score === null) return null;
  const level = Math.max(0, Math.floor(score + 0.5));
  return finite(item.scale) === null ? level : Math.min(level, item.scale);
}

function criterionText(item, key) {
  const found = (Array.isArray(item.criteria) ? item.criteria : []).find((entry) => entry && entry.key === key);
  return found ? String(found.text ?? "") : "";
}

const keyWords = (key) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export default definePack({
  id: "build-answer-facts",
  surface: "workbench.build.result",
  title: "Answer facts",
  about: "Facts, checks and metrics for the answers of the Build tab's latest Run: probability shape, Score spread, Box size, local expectation headroom and measured cost per question. Everything reads your own Run in this page session; thresholds and expectation checks are local, advisory code.",
  features: [
    // ---------- facts ----------
    { id: "noul_yes", kind: "fact", type: "number", label: "Noul P(yes)", help: `The probability of yes; other types are unavailable. ${RUN_NOTE}`,
      value: (item) => (item.type === "noul" ? finite(item.value) : null) },
    { id: "score_value", kind: "fact", type: "number", label: "returned score", help: `The score of a Score answer, from 0 to its top level. ${RUN_NOTE}`,
      value: (item) => (item.type === "score" ? finite(item.value) : null) },
    { id: "score_spread", kind: "fact", type: "number", label: "score level spread",
      help: "Standard deviation, in levels, of a Score answer's level probabilities: 0 when all sit on one level.",
      value: (item) => {
        if (item.type !== "score") return null;
        const levels = probsOf(item).filter((entry) => /^\d+$/.test(entry.key)).map((entry) => ({ level: Number(entry.key), p: entry.p }));
        const total = levels.reduce((sum, entry) => sum + entry.p, 0);
        if (levels.length < 2 || !(total > 0)) return null;
        const mean = levels.reduce((sum, entry) => sum + entry.p * entry.level, 0) / total;
        return Math.sqrt(levels.reduce((sum, entry) => sum + entry.p * (entry.level - mean) ** 2, 0) / total);
      } },
    { id: "options_to_90", kind: "fact", type: "number", label: "options holding 90% of the probability",
      help: "The fewest Choice options or Score levels whose probabilities add up to at least 90%; unavailable when they never do.",
      value: (item) => {
        if (item.type !== "choice" && item.type !== "score") return null;
        let total = 0, count = 0;
        for (const entry of ranked(item)) {
          total += entry.p;
          count++;
          if (total >= 0.9 - 1e-9) return count;
        }
        return null;
      } },
    { id: "box_width", kind: "fact", type: "number", label: "box width share", help: "Right minus left edge of a Box answer, as a share of the picture's width.",
      value: (item) => { const box = edgesOf(item.box); return box ? box.right - box.left : null; } },
    { id: "box_height", kind: "fact", type: "number", label: "box height share", help: "Bottom minus top edge of a Box answer, as a share of the picture's height.",
      value: (item) => { const box = edgesOf(item.box); return box ? box.bottom - box.top : null; } },
    { id: "expected_probability", kind: "fact", type: "number", label: "probability of the expected option",
      help: "The probability this Run gave the option your human expectation names; unavailable without one or when the Run did not list it.",
      value: (item) => {
        if (item.type !== "choice" || !hasOwn(item.expectation, "choice")) return null;
        const entry = probsOf(item).find((one) => one.key === item.expectation.choice);
        return entry ? entry.p : null;
      } },
    { id: "expectation_iou", kind: "fact", type: "number", label: "box overlap with the expected box",
      help: "Intersection over union of a Box answer and the box your human expectation holds (local code mirroring the Tests tab).",
      value: (item) => {
        const answer = item.type === "box" ? edgesOf(item.box) : null;
        const wanted = answer && hasOwn(item.expectation, "box") ? edgesOf(item.expectation.box, toNumber) : null;
        return wanted ? iou(answer, wanted) : null;
      } },
    { id: "expectation_headroom", kind: "fact", type: "number", label: "expectation headroom",
      help: "Distance to the nearest bound of your human expectation (min, max, or the Box IoU floor): positive when inside, negative when outside. A Choice is measured on the probability of its chosen option, as the Tests tab does. Local code.",
      value: (item) => headroom(item) },
    { id: "chosen_description", kind: "fact", type: "text", label: "chosen criterion description",
      help: "The criterion text of the chosen option, of the nearest Score level, or of the Noul side the answer leans to (as sent).",
      value: (item) => {
        if (item.type === "choice") return item.value === null ? "" : criterionText(item, item.value);
        if (item.type === "score") { const level = nearestLevel(item); return level === null ? "" : criterionText(item, String(level)); }
        if (item.type === "noul") return finite(item.value) === null ? "" : criterionText(item, item.value >= 0.5 ? "true" : "false");
        return "";
      } },
    { id: "runner_up", kind: "fact", type: "text", label: "runner-up option",
      help: "The second most likely Choice option or Score level (a level is its number); empty for a Noul or a Box.",
      value: (item) => {
        if (item.type !== "choice" && item.type !== "score") return "";
        const list = ranked(item);
        return list.length >= 2 ? list[1].key : "";
      } },
    { id: "chosen_answer", kind: "fact", type: "category", label: "chosen answer",
      help: "The chosen Choice key, the nearest Score level (halves up) or yes/no for a Noul (yes from 50%); unavailable for a Box.",
      value: (item) => {
        if (item.type === "choice") return item.value;
        if (item.type === "score") { const level = nearestLevel(item); return level === null ? null : `level ${level}`; }
        if (item.type === "noul") return finite(item.value) === null ? null : item.value >= 0.5 ? "yes" : "no";
        return null;
      } },
    { id: "chose_catch_all", kind: "fact", type: "flag", label: "a catch-all option chosen",
      help: "The chosen Choice key reads as none, other, unknown, n/a or a similar catch-all.",
      value: (item) => item.type === "choice" && item.value !== null && CATCH_ALL.has(keyWords(item.value)) },
    { id: "mode_differs", kind: "fact", type: "flag", label: "a most likely level other than the rounded score",
      help: "A Score answer whose most probable level is not its score rounded to the nearest level: the probabilities have two humps.",
      value: (item) => {
        const level = nearestLevel(item);
        const top = ranked(item)[0];
        return level !== null && !!top && /^\d+$/.test(top.key) && Number(top.key) !== level;
      } },

    // ---------- checks ----------
    { id: "probabilities_off", kind: "diagnostic", severity: "advice", label: "Probabilities that do not add up to 100%",
      check: (item) => {
        if (item.type !== "choice" && item.type !== "score") return null;
        const list = probsOf(item);
        if (!list.length) return null;
        const total = list.reduce((sum, entry) => sum + entry.p, 0);
        return Math.abs(total - 1) > 0.01 ? `The listed probabilities add up to ${(total * 100).toFixed(1)}%, not 100% (local rule: more than 1 point off).` : null;
      } },
    { id: "chosen_not_top", kind: "diagnostic", severity: "advice", label: "Chosen option is not the most likely",
      check: (item) => {
        if (item.type !== "choice" || item.value === null) return null;
        const list = ranked(item);
        if (!list.length) return null;
        const chosen = list.find((entry) => entry.key === item.value);
        if (!chosen) return `The chosen option “${item.value}” is not among the probabilities this Run listed.`;
        return chosen.p < list[0].p ? `The chosen option “${item.value}” (${(chosen.p * 100).toFixed(1)}%) is less likely than “${list[0].key}” (${(list[0].p * 100).toFixed(1)}%).` : null;
      } },
    { id: "box_at_edge", kind: "diagnostic", severity: "advice", label: "Box touching the picture's edge",
      check: (item) => {
        const box = item.type === "box" ? edgesOf(item.box) : null;
        if (!box) return null;
        const sides = [["left", box.left], ["top", box.top], ["right", 1 - box.right], ["bottom", 1 - box.bottom]].filter(([, gap]) => gap <= 0.005).map(([side]) => side);
        return sides.length ? `The box reaches the picture's ${sides.join(" and ")} edge (within 0.5%); the thing may be cut off there.` : null;
      } },
    { id: "expectation_other_kind", kind: "diagnostic", severity: "advice", label: "Expectation the local check ignores",
      check: (item) => {
        const expect = item.expectation;
        if (!isObject(expect)) return null;
        const keys = Object.keys(expect);
        if (item.type === "box") {
          if (!hasOwn(expect, "box")) return "This Box answer's expectation holds no box, so the check passes it without comparing anything.";
          const extra = keys.filter((key) => ["choice", "min", "max"].includes(key));
          return extra.length ? `A Box is checked by its box only; ${extra.join(", ")} in its expectation is ignored.` : null;
        }
        if (!["choice", "score", "noul"].includes(item.type)) return null;
        const ignored = keys.filter((key) => key === "box" || key === "iou_min" || (key === "choice" && item.type !== "choice"));
        return ignored.length ? `A ${item.type === "choice" ? "Choice" : item.type === "score" ? "Score" : "Noul"} answer is not checked by ${ignored.join(", ")}; that part of its expectation is ignored.` : null;
      } },
    { id: "expected_option_unlisted", kind: "diagnostic", severity: "advice", label: "Expected option not offered",
      check: (item) => {
        if (item.type !== "choice" || !hasOwn(item.expectation, "choice")) return null;
        const wanted = item.expectation.choice;
        const keys = [...probsOf(item).map((entry) => entry.key), ...(Array.isArray(item.criteria) ? item.criteria.map((entry) => entry?.key) : [])];
        return keys.length && !keys.includes(wanted) ? `The expectation names “${String(wanted)}”, which is not an option of the question this Run sent; it can never be met.` : null;
      } },
    { id: "barely_met", kind: "diagnostic", severity: "advice", label: "Barely meets its expectation",
      check: (item) => {
        const room = headroom(item);
        if (meets(item) !== true || room === null || room >= 0.05) return null;
        return `Passes its expectation by ${fixed2(room)} (local rule: under 0.05); a small change in the answer would flip it.`;
      } },
    { id: "unanswered", kind: "diagnostic", scope: "list", severity: "advice", label: "Questions the Run sent without an answer",
      check: (items, ctx) => {
        const questions = ctx.data.request?.questions;
        if (!isObject(questions)) return null;
        const answered = new Set(ctx.items().map((item) => item.id));
        const missing = Object.keys(questions).filter((id) => !answered.has(id));
        return missing.length ? `The Run sent ${missing.length} question${missing.length === 1 ? "" : "s"} that got no answer: ${missing.join(", ")}.` : null;
      } },

    // ---------- metrics ----------
    { id: "cost_per_question", kind: "metric", format: "usd", label: "Measured cost per question",
      help: "The Run's measured cost divided by its question count; a measurement of this Run, not an estimate.",
      compute: (ctx) => {
        const cost = finite(ctx.data.meta?.cost_usd), count = finite(ctx.data.meta?.question_count);
        return cost !== null && count ? { value: cost / count, detail: ctx.data.stale ? "from the previous request" : "" } : null;
      } },
    { id: "answering_model", kind: "metric", format: "text", label: "Model that answered",
      help: "The model the server reports for this Run, with the model the request asked for when it differs (an alias).",
      compute: (ctx) => {
        const model = ctx.data.meta?.model;
        if (typeof model !== "string" || !model) return null;
        const asked = ctx.data.request?.model;
        return { value: model, detail: typeof asked === "string" && asked && asked !== model ? `asked for ${asked}` : "" };
      } },
  ],
});
