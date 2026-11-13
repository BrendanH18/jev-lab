// Question-shape and expectation-shape facts for the saved tests on the Workbench Tests tab ("workbench.tests.items";
// contract in static/js/lab/surfaces/workbench-tests.js). Everything is read from the saved file alone: no run is needed
// and no answer is read. The rules follow the server: which expectation keys a run uses comes from
// jev/workbench.py check_expectation and run_item, the save rules from validate_questions, and backticked references,
// description matching and path resolution from jev/lint.py (_TICKED, _PATH, _norm, _resolve).
// Facts return counts, measures, flags and fixed-vocabulary categories only (plus a hash label of question IDs and
// types), never instructions, criteria, expected options or bound values, so the Lab facts CSV carries no authored text
// and no human labels.
import { definePack } from "../../kit.js";
import { codePoints, fingerprint } from "../../lib/text.js";

const TYPES = ["noul", "choice", "score", "box"];
const KNOWN_KEYS = ["choice", "min", "max", "box", "iou_min"];
// Server limits (jev/workbench.py).
const MAX_QUESTIONS = 100, MAX_CHOICE_OPTIONS = 255, MAX_SCORE_LEVELS = 25;

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const has = (object, key) => isObject(object) && Object.hasOwn(object, key);
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions.filter(isObject) : []);
const criteriaOf = (question) => (Array.isArray(question.criteria) ? question.criteria.filter(isObject) : []);
const textOf = (value) => (typeof value === "string" ? value : "");
const ofType = (item, type) => questionsOf(item).filter((question) => question.type === type);
const maxOrNull = (values) => (values.length ? Math.max(...values) : null);
const minOrNull = (values) => (values.length ? Math.min(...values) : null);

// A description for comparing, as jev/lint.py _norm does for text: case, spacing and sentence punctuation ignored.
const norm = (text) => textOf(text).toLowerCase().replace(/[\s.,;:!?'"“”‘’()]+/g, " ").trim();
// A blank description: empty text, or an empty structured one (lint treats "", {} and [] alike).
const blank = (text) => { const value = textOf(text).trim(); return value === "" || value === "{}" || value === "[]"; };

// The expectation keys a run uses for a question of this type (check_expectation): Choice checks the option and
// bounds the chosen option's probability, Noul and Score bound P(yes) and the score, a Box checks overlap with the
// expected box (iou_min only counts beside a box). Unknown types use nothing.
function usedKeys(question) {
  const expect = question.expect;
  if (!isObject(expect)) return [];
  if (question.type === "choice") return ["choice", "min", "max"].filter((key) => has(expect, key));
  if (question.type === "noul" || question.type === "score") return ["min", "max"].filter((key) => has(expect, key));
  if (question.type === "box") return has(expect, "box") ? ["box", "iou_min"].filter((key) => has(expect, key)) : [];
  return [];
}

// The answer range a numeric bound applies to: [0, 1] for Noul P(yes) and Choice probability, [0, levels - 1] for a
// Score with levels, null otherwise (a Score without levels has only the lower end 0).
function answerRange(question) {
  if (question.type === "noul" || question.type === "choice") return [0, 1];
  if (question.type === "score") return criteriaOf(question).length ? [0, criteriaOf(question).length - 1] : [0, null];
  return null;
}

const bounds = (question) => {
  const used = usedKeys(question);
  return { min: used.includes("min") ? finite(question.expect.min) : null, max: used.includes("max") ? finite(question.expect.max) : null };
};

function impossible(question) {
  const range = answerRange(question);
  if (range) {
    const { min, max } = bounds(question);
    if (min !== null && max !== null && min > max) return true;
    if (max !== null && max < range[0]) return true;
    if (min !== null && range[1] !== null && min > range[1]) return true;
    return false;
  }
  if (question.type === "box" && usedKeys(question).includes("box")) {
    const floor = has(question.expect, "iou_min") ? finite(question.expect.iou_min) : 0.5;
    if (floor === null) return false;
    if (floor > 1) return true;
    // A box with no area overlaps nothing, so any positive floor is out of reach.
    const box = question.expect.box;
    const edges = isObject(box) ? ["left", "top", "right", "bottom"].map((edge) => finite(box[edge])) : [];
    if (edges.length === 4 && edges.every((edge) => edge !== null) && (edges[2] <= edges[0] || edges[3] <= edges[1])) return floor > 0;
  }
  return false;
}

function trivial(question) {
  const range = answerRange(question);
  if (range) {
    const { min, max } = bounds(question);
    return (min !== null && min <= range[0]) || (max !== null && range[1] !== null && max >= range[1]);
  }
  if (question.type === "box" && usedKeys(question).includes("box") && has(question.expect, "iou_min")) {
    const floor = finite(question.expect.iou_min);
    return floor !== null && floor <= 0;
  }
  return false;
}

// Keys the run reads for some type but not this one, such as "choice" on a Noul, min/max on a Box, "box" on a Score,
// or iou_min without a box.
function ignoredKeys(question) {
  if (!TYPES.includes(question.type) || !isObject(question.expect)) return [];
  const used = new Set(usedKeys(question));
  return KNOWN_KEYS.filter((key) => has(question.expect, key) && !used.has(key));
}

// jev/lint.py: a backticked token is a path when it fully matches _PATH (Python's \w is Unicode).
const TICKED = /`([^`\n]+)`/g;
const PATH = /^[A-Za-z_][\p{L}\p{N}_-]*(?:\.[\p{L}\p{N}_-]+|\[\d+\])*$/u;

function backtickedPaths(item) {
  const found = [];
  for (const question of questionsOf(item)) {
    for (const text of [question.instructions, ...criteriaOf(question).map((criterion) => criterion.text)]) {
      for (const match of textOf(text).matchAll(TICKED)) {
        const token = match[1].trim();
        if (PATH.test(token) && !found.includes(token)) found.push(token);
      }
    }
  }
  return found;
}

// jev/lint.py _resolve: whether `path` names something in the state. A field name may itself contain dots.
function resolves(value, path) {
  if (path === "") return true;
  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      if (!path.startsWith(key)) continue;
      const rest = path.slice(key.length);
      if ((rest === "" || rest[0] === "." || rest[0] === "[") && resolves(value[key], rest.startsWith(".") ? rest.slice(1) : rest)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) {
    const step = /^(?:\[(\d+)\]|(\d+)(?=$|[.[]))/.exec(path);
    if (!step) return false;
    const index = Number(step[1] ?? step[2]);
    const rest = path.slice(step[0].length);
    return index < value.length && resolves(value[index], rest.startsWith(".") ? rest.slice(1) : rest);
  }
  return false;
}

function structured(text) {
  const value = textOf(text).trim();
  if (!value.startsWith("{") && !value.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(value);
    return !!parsed && typeof parsed === "object";
  } catch { return false; }
}

// jev/lint.py _norm for a parsed structured value: text as norm, object fields sorted by name, list items in order;
// empty objects, lists and null read as "" (no description), other values as JSON.
function structuredKey(value) {
  if (typeof value === "string") return norm(value);
  if (Array.isArray(value)) return value.length ? `[${value.map(structuredKey).join(" | ")}]` : "";
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return keys.length ? `{${keys.map((key) => `${key}: ${structuredKey(value[key])}`).join(", ")}}` : "";
  }
  return value === null || value === undefined ? "" : JSON.stringify(value);
}

// The comparison key of a description as the page gives it (structured values arrive as JSON text).
const descriptionKey = (text) => (structured(text) ? structuredKey(JSON.parse(textOf(text).trim())) : norm(text));

const hasRepeat = (texts) => {
  const seen = new Set();
  for (const text of texts.map(descriptionKey).filter(Boolean)) {
    if (seen.has(text)) return true;
    seen.add(text);
  }
  return false;
};

// What validate_questions would refuse, judged from the saved test as the page reads it. A Box's object criteria are
// not visible in the item, so only list criteria count there.
function rejected(item) {
  const questions = questionsOf(item);
  if (!questions.length || questions.length > MAX_QUESTIONS) return true;
  const ids = new Set();
  for (const question of questions) {
    const id = textOf(question.id).trim();
    if (!id || ids.has(id)) return true;
    ids.add(id);
    if (!TYPES.includes(question.type) || textOf(question.instructions) === "") return true;
    const criteria = criteriaOf(question);
    if (question.type === "choice" && (!criteria.length || criteria.length > MAX_CHOICE_OPTIONS)) return true;
    if (question.type === "score" && (criteria.length < 2 || criteria.length > MAX_SCORE_LEVELS
      || criteria.some((criterion, index) => criterion.key !== String(index)))) return true;
    if (question.type === "box" && criteria.length) return true;
    if (question.type === "noul" && criteria.some((criterion) => criterion.key !== "true" && criterion.key !== "false")) return true;
  }
  return false;
}

// One question ID's naming style; single lowercase words fit every style and are left out.
function idStyle(id) {
  if (/^[a-z][a-z0-9]*$/.test(id)) return null;
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(id)) return "snake_case";
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(id)) return "kebab-case";
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(id)) return "camelCase";
  return "other";
}

export default definePack({
  id: "tests-question-facts",
  surface: "workbench.tests.items",
  title: "Saved test question and expectation facts",
  about: "Per-test facts about the saved questions and expectations: instruction and criteria measures, option and level extremes, backticked references, impossible, trivial, ignored or unrecognized expectation keys, and the save rules, all from the saved files without a run. Values are counts, measures, flags and fixed categories only, never instructions, criteria, expected options or bound values.",
  features: [
    { id: "longest_instruction", kind: "fact", type: "number", label: "longest single instruction", unit: "characters",
      help: "Unicode characters of the longest question's instructions (structured instructions as JSON text). The page's own filter is the total.",
      value: (item) => maxOrNull(questionsOf(item).map((question) => codePoints(textOf(question.instructions)))) },
    { id: "longest_criterion", kind: "fact", type: "number", label: "longest single criterion", unit: "characters",
      help: "Unicode characters of the longest option, level or yes/no description; unknown when the test has none.",
      value: (item) => maxOrNull(questionsOf(item).flatMap((question) => criteriaOf(question).map((criterion) => codePoints(textOf(criterion.text))))) },
    { id: "blank_criteria", kind: "fact", type: "number", label: "blank criterion descriptions", unit: "criteria",
      help: "Options, levels or yes/no criteria saved without a description (empty text, {} or []).",
      value: (item) => questionsOf(item).reduce((sum, question) => sum + criteriaOf(question).filter((criterion) => blank(criterion.text)).length, 0) },
    { id: "most_options", kind: "fact", type: "number", label: "most options on one choice question", unit: "options",
      help: "Unknown when the test has no Choice question. The page's own filter is the total across questions.",
      value: (item) => maxOrNull(ofType(item, "choice").map((question) => criteriaOf(question).length)) },
    { id: "fewest_options", kind: "fact", type: "number", label: "fewest options on one choice question", unit: "options",
      help: "Unknown when the test has no Choice question.",
      value: (item) => minOrNull(ofType(item, "choice").map((question) => criteriaOf(question).length)) },
    { id: "most_score_levels", kind: "fact", type: "number", label: "most levels on one score question", unit: "levels",
      help: "Unknown when the test has no Score question. The page's own filter is the total across questions.",
      value: (item) => maxOrNull(ofType(item, "score").map((question) => criteriaOf(question).length)) },
    { id: "backtick_references", kind: "fact", type: "number", label: "backticked references", unit: "references",
      help: "Distinct `field.path` tokens in instructions and criteria, by the rule jev/lint.py uses.",
      value: (item) => backtickedPaths(item).length },
    { id: "unresolved_references", kind: "fact", type: "number", label: "backticked references the input lacks", unit: "references",
      help: "Backticked paths that neither a picture reference nor the saved state resolves (a text state has no fields), as jev/lint.py checks them.",
      value: (item) => {
        const refs = new Set((Array.isArray(item?.images) ? item.images : []).map((image) => image?.ref));
        return backtickedPaths(item).filter((path) => !refs.has(path) && !resolves(item?.state ?? null, path)).length;
      } },
    { id: "range_expectations", kind: "fact", type: "number", label: "two-sided expectation ranges", unit: "expectations",
      help: "Noul, Choice and Score expectations with both a min and a max.",
      value: (item) => questionsOf(item).filter((question) => { const { min, max } = bounds(question); return min !== null && max !== null; }).length },
    { id: "narrowest_probability_range", kind: "fact", type: "number", label: "narrowest probability range", unit: "0 to 1",
      help: "Smallest max minus min among Noul and Choice expectations with both; negative when a min sits above its max. Unknown when there is none. A width, never a bound.",
      value: (item) => minOrNull(questionsOf(item).filter((question) => question.type === "noul" || question.type === "choice")
        .map(bounds).filter(({ min, max }) => min !== null && max !== null).map(({ min, max }) => max - min)) },

    { id: "impossible_bound", kind: "fact", type: "flag", label: "a bound no answer can meet",
      help: "A min above its max, a probability bound beyond 0 to 1, a Score bound beyond its levels, an iou_min above 1, or an expected box with no area. Advisory: such a check always fails.",
      value: (item) => questionsOf(item).some(impossible) },
    { id: "trivial_bound", kind: "fact", type: "flag", label: "a bound every answer meets",
      help: "A min at or below the lowest possible answer, a max at or above the highest, or an iou_min at or below 0: that bound checks nothing.",
      value: (item) => questionsOf(item).some(trivial) },
    { id: "exact_point", kind: "fact", type: "flag", label: "a min equal to its max",
      help: "A single-point range, brittle for calibrated probabilities and continuous scores.",
      value: (item) => questionsOf(item).some((question) => { const { min, max } = bounds(question); return min !== null && min === max; }) },
    { id: "choice_floor", kind: "fact", type: "flag", label: "an expected option with a probability floor",
      help: "A Choice expectation that names an option and also bounds the chosen option's probability from below.",
      value: (item) => ofType(item, "choice").some((question) => has(question.expect, "choice") && finite(question.expect.min) !== null) },
    { id: "ignored_expectation_key", kind: "fact", type: "flag", label: "an expectation key the run ignores",
      help: "\"choice\" on a Noul, Score or Box, min or max on a Box, \"box\" on another type, or iou_min without a box.",
      value: (item) => questionsOf(item).some((question) => ignoredKeys(question).length > 0) },
    { id: "unrecognized_expectation_key", kind: "fact", type: "flag", label: "an unrecognized expectation key",
      help: "A key other than choice, min, max, box and iou_min, such as a misspelled \"mim\"; the run never reads it.",
      value: (item) => questionsOf(item).some((question) => isObject(question.expect) && Object.keys(question.expect).some((key) => !KNOWN_KEYS.includes(key))) },
    { id: "repeated_descriptions", kind: "fact", type: "flag", label: "options or levels with the same description",
      help: "Two options of one Choice question, or two levels of one Score question, read the same once case, spacing, sentence punctuation and the order of structured fields are ignored; blank descriptions are left out (jev/lint.py same_options and same_levels).",
      value: (item) => questionsOf(item).some((question) => (question.type === "choice" || question.type === "score")
        && hasRepeat(criteriaOf(question).map((criterion) => criterion.text))) },
    { id: "repeated_instructions", kind: "fact", type: "flag", label: "two questions with the same instructions",
      help: "Two questions of one test whose instructions read the same once case, spacing and sentence punctuation are ignored.",
      value: (item) => hasRepeat(questionsOf(item).map((question) => question.instructions)) },
    { id: "noul_without_both_sides", kind: "fact", type: "flag", label: "a yes/no question missing a yes or no description",
      help: "A Noul question without a nonblank true and false criterion. Like jev/lint.py noul_criteria, except that whitespace-only, {} and [] descriptions also count as missing here.",
      value: (item) => ofType(item, "noul").some((question) => ["true", "false"]
        .some((key) => !criteriaOf(question).some((criterion) => criterion.key === key && !blank(criterion.text)))) },
    { id: "structured_instructions", kind: "fact", type: "flag", label: "structured instructions",
      help: "At least one question's instructions are a JSON object or list.",
      value: (item) => questionsOf(item).some((question) => structured(question.instructions)) },
    { id: "save_rules_rejected", kind: "fact", type: "flag", label: "questions the save rules reject",
      help: "No readable questions, more than 100, a blank or repeated ID, an unknown type, blank instructions, a Choice without options or over 255, a Score outside 2 to 25 levels, Box criteria, or Noul criteria other than true and false. Hand-edited files only: Build's Save checks these.",
      value: (item) => rejected(item) },

    { id: "expectation_kinds", kind: "fact", type: "category", label: "expectation kinds used",
      help: "Which checks the expectations make: option (an expected Choice option), bound (min or max), box, combined with +, or none. Unknown when the test has no readable question.",
      value: (item) => {
        const questions = questionsOf(item);
        if (!questions.length) return null;
        const kinds = new Set();
        for (const question of questions) {
          const used = usedKeys(question);
          if (used.includes("choice")) kinds.add("option");
          if (used.includes("min") || used.includes("max")) kinds.add("bound");
          if (used.includes("box")) kinds.add("box");
        }
        return kinds.size ? [...kinds].sort().join(" + ") : "none";
      } },
    { id: "question_set", kind: "fact", type: "category", label: "question set",
      help: "A short label hashed (FNV-1a) from the sorted question IDs and types, so tests that ask the same schema group together. Order of questions does not matter.",
      value: (item) => {
        const questions = questionsOf(item);
        if (!questions.length) return null;
        return `qs-${fingerprint(questions.map((question) => `${textOf(question.id)}\t${textOf(question.type)}`).sort().join("\n"))}`;
      } },
    { id: "question_id_style", kind: "fact", type: "category", label: "question id style",
      help: "snake_case, kebab-case, camelCase, other, or mixed when the test uses more than one; single lowercase words fit any style. Unknown without questions.",
      value: (item) => {
        const questions = questionsOf(item);
        if (!questions.length) return null;
        const styles = new Set(questions.map((question) => idStyle(textOf(question.id))).filter(Boolean));
        return styles.size === 0 ? "single words" : styles.size === 1 ? [...styles][0] : "mixed";
      } },
  ],
});
