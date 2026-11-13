// Session facts for the Workbench Tests tab ("workbench.tests.items"; contract in static/js/lab/surfaces/workbench-tests.js):
// what the latest result of each saved test says, for tests the user ran in this page session. Verdict facts
// recompute every check from the answer and the test's own expectation (the server's rules in jev/workbench.py
// check_expectation and iou) instead of parsing check text; measurement facts read the call's measured meta.
// Before a run, after Clear session results and for a test changed since its run, every fact is unavailable (null),
// never zero. Facts return numbers, flags, failing question IDs and categories from a fixed vocabulary: never inputs,
// instructions, expectation values, chosen options, check text or error text.
import { definePack } from "../../kit.js";

const EDGES = ["left", "top", "right", "bottom"];
const CLOSE = 0.05;   // a bound held by less than this is a close call

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions : []);
const resultOf = (item) => (isObject(item?.result) ? item.result : null);
// A successful call of this session: verdict facts need one.
const answered = (item) => { const result = resultOf(item); return !!result && !result.error && Array.isArray(result.checks); };
const checksOf = (item) => (answered(item) ? item.result.checks.filter(isObject) : []);
const metaOf = (item) => { const result = resultOf(item); return result && !result.error && isObject(result.meta) ? result.meta : null; };
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
// Derived values are rounded to 12 significant digits so the facts table shows 0.22, not 0.21999999999999997.
const tidy = (value) => (value === null ? null : Number(value.toPrecision(12)));
const lowest = (values) => (values.length ? tidy(Math.min(...values)) : null);

// The expectation the server checked for a question check: the question's own nonempty expectation (the server
// treats a missing or empty one as "no expectation").
function expectationOf(item, check) {
  if (!check.question) return null;
  const question = questionsOf(item).find((entry) => entry.id === check.id);
  return question && isObject(question.expect) && Object.keys(question.expect).length ? question.expect : null;
}

// Intersection over union of two boxes given as edge fractions (jev/workbench.py iou); null when an edge is not a number.
function iou(a, b) {
  if (!isObject(a) || !isObject(b) || !EDGES.every((edge) => finite(a[edge]) !== null && finite(b[edge]) !== null)) return null;
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const area = (box) => Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
  const inter = width * height, union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

// One answer against its expectation, as check_expectation does it: margins (value minus a lower bound, upper bound
// minus value, overlap minus its floor; negative when missed) on the "probability", "score" or "overlap" scale, the
// kinds of failure, the recomputed overlap, and whether the expectation holds something the server cannot read.
function assess(answer, expect) {
  const out = { margins: [], kinds: [], invalid: false, overlap: null };
  if (!isObject(answer) || !isObject(expect)) return out;
  if (answer.type === "box") {
    if (!has(expect, "box")) return out;
    const floor = has(expect, "iou_min") ? finite(expect.iou_min) : 0.5;
    const overlap = iou(answer.box, expect.box);
    if (overlap === null || floor === null) { out.invalid = true; return out; }
    out.overlap = overlap;
    out.margins.push({ scale: "overlap", margin: overlap - floor });
    if (overlap < floor) out.kinds.push("low overlap");
    return out;
  }
  let target, scale;
  if (answer.type === "choice") {
    if (has(expect, "choice") && answer.choice !== expect.choice) out.kinds.push("wrong choice");
    target = isObject(answer.probabilities) && has(answer.probabilities, answer.choice) ? finite(answer.probabilities[answer.choice]) : 0;
    scale = "probability";
  } else if (answer.type === "score") { target = finite(answer.score); scale = "score"; } else if (answer.type === "noul") { target = finite(answer.noul); scale = "probability"; } else return out;
  for (const [key, below] of [["min", true], ["max", false]]) {
    if (!has(expect, key)) continue;
    const bound = finite(expect[key]);
    if (bound === null || target === null) { out.invalid = true; continue; }
    out.margins.push({ scale, margin: below ? target - bound : bound - target });
    if (below ? target < bound : target > bound) out.kinds.push(below ? "below min" : "above max");
  }
  return out;
}

// Every checked question of the latest run with its assessment.
const assessed = (item) => checksOf(item).filter((check) => check.question && isObject(check.answer))
  .map((check) => ({ check, ...assess(check.answer, expectationOf(item, check)) }));
const margins = (item, scales) => assessed(item).flatMap((entry) => entry.margins).filter((entry) => scales.includes(entry.scale)).map((entry) => entry.margin);

// The kinds of failure of one failed check. An expectation that is not an object (a number, say) is one the server
// cannot read: run_item checks every truthy expectation, and check_expectation fails on it.
function failureKinds(item, check) {
  if (!check.question) return ["unknown question"];
  if (!isObject(check.answer)) return ["missing answer"];
  const raw = questionsOf(item).find((entry) => entry.id === check.id)?.expect;
  if (raw && !isObject(raw)) return ["invalid expectation"];
  const result = assess(check.answer, expectationOf(item, check));
  if (result.invalid) return ["invalid expectation"];
  return result.kinds.length ? result.kinds : ["other"];
}

const answersOf = (item, type) => checksOf(item).map((check) => check.answer).filter((answer) => isObject(answer) && answer.type === type);
const choiceProbabilities = (answer) => (isObject(answer.probabilities) ? Object.values(answer.probabilities).map(finite) : []);

// Normalized entropy of one Choice answer: 0 when one option holds everything, 1 when all options are equally likely.
function normalizedEntropy(answer) {
  const values = choiceProbabilities(answer);
  if (values.length < 2 || values.some((value) => value === null || value < 0)) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  const entropy = values.reduce((sum, value) => (value > 0 ? sum - (value / total) * Math.log(value / total) : sum), 0);
  return entropy / Math.log(values.length);
}

// Gap between the two most likely options of one Choice answer.
function topGap(answer) {
  const values = choiceProbabilities(answer);
  if (values.length < 2 || values.some((value) => value === null)) return null;
  const sorted = values.sort((a, b) => b - a);
  return sorted[0] - sorted[1];
}

const perQuestion = (field) => (item) => {
  const meta = metaOf(item);
  const value = finite(meta?.[field]), count = meta && Number.isInteger(meta.question_count) && meta.question_count > 0 ? meta.question_count : null;
  return value === null || count === null ? null : tidy(value / count);
};

// Error causes from the messages of jev/client.py, jev/workbench.py and jev/images.py; order matters. The TypeSafe
// messages come first because they end with the upstream service's own text, which may say "budget" or "image".
const ERROR_KINDS = [
  [/^No TypeSafe API key|^TypeSafe rejected the API key/i, "API key"],
  [/^TypeSafe could not validate the request \(422\)/i, "request validation"],
  [/^TypeSafe rate limit \(429\)/i, "upstream rate limit"],
  [/^TypeSafe error \d+/i, "upstream error"],
  [/^Could not reach TypeSafe/i, "network"],
  [/^Local rate limit/i, "local rate limit"],
  [/has spent its .*budget|budget/i, "budget reached"],
  [/image|picture|png|jpeg/i, "picture problem"],
];

const SESSION = "From your latest run of this test in this page session; unknown before a run.";

export default definePack({
  id: "tests-session-facts",
  surface: "workbench.tests.items",
  title: "Session result facts",
  about: "Verdict, margin, confidence, latency, token and cost facts from the latest result of each saved test you ran in this page session, recomputed from your own answers and expectations; unknown before a run. Values are numbers, flags, failing question IDs and fixed categories: never inputs, instructions, expectation values, chosen options, check text or error text.",
  features: [
    // ---------- verdicts ----------
    { id: "check_pass_share", kind: "fact", type: "number", label: "share of checks passed", unit: "0 to 1",
      help: `Passed checks over checked questions and orphan expectations; answers with no expectation are left out. ${SESSION}`,
      value: (item) => {
        const checked = checksOf(item).filter((check) => check.ok === true || check.ok === false);
        return checked.length ? tidy(checked.filter((check) => check.ok === true).length / checked.length) : null;
      } },
    { id: "closest_probability_margin", kind: "fact", type: "number", label: "closest probability margin", unit: "probability",
      help: `Smallest distance between a Choice or yes/no probability and the min or max it was checked against; negative when the bound was missed. ${SESSION}`,
      value: (item) => lowest(margins(item, ["probability"])) },
    { id: "closest_score_margin", kind: "fact", type: "number", label: "closest score margin", unit: "levels",
      help: `Smallest distance between a Score and the min or max it was checked against; negative when the bound was missed. ${SESSION}`,
      value: (item) => lowest(margins(item, ["score"])) },
    { id: "lowest_expected_probability", kind: "fact", type: "number", label: "lowest probability of an expected option", unit: "0 to 1",
      help: `The smallest probability your latest answers gave to the option a Choice expectation names. ${SESSION}`,
      value: (item) => lowest(checksOf(item).flatMap((check) => {
        const expect = expectationOf(item, check), answer = check.answer;
        if (!expect || typeof expect.choice !== "string" || !isObject(answer) || answer.type !== "choice" || !isObject(answer.probabilities)) return [];
        const value = has(answer.probabilities, expect.choice) ? finite(answer.probabilities[expect.choice]) : null;
        return value === null ? [] : [value];
      })) },
    { id: "lowest_overlap", kind: "fact", type: "number", label: "lowest box overlap", unit: "IoU 0 to 1",
      help: `The smallest intersection over union between an answered box and its expected box, recomputed with the server's formula. ${SESSION}`,
      value: (item) => lowest(assessed(item).map((entry) => entry.overlap).filter((value) => value !== null)) },
    { id: "missing_answer", kind: "fact", type: "flag", label: "a question that came back unanswered",
      help: `A question of the test had no answer in the latest call. ${SESSION}`,
      value: (item) => checksOf(item).some((check) => check.question && !isObject(check.answer)) },
    { id: "wrong_choice", kind: "fact", type: "flag", label: "a different option than expected",
      help: `A Choice expectation failed on the chosen option itself, not only on a probability bound. ${SESSION}`,
      value: (item) => assessed(item).some((entry) => entry.kinds.includes("wrong choice")) },
    { id: "close_pass", kind: "fact", type: "flag", label: "a pass by a close margin",
      help: `The test passed, but a probability, score or overlap bound held by less than ${CLOSE}. ${SESSION}`,
      value: (item) => item?.status === "pass" && answered(item) && margins(item, ["probability", "score", "overlap"]).some((margin) => margin >= 0 && margin < CLOSE) },
    { id: "failure_kind", kind: "fact", type: "category", label: "kind of failure",
      help: `wrong choice, below min, above max, low overlap, missing answer, unknown question (an orphan expectation), invalid expectation, call error, several kinds, or other (a failure these rules do not explain). Unknown for a pass. ${SESSION}`,
      value: (item) => {
        const result = resultOf(item);
        if (!result) return null;
        if (result.error) return "call error";
        const kinds = new Set(checksOf(item).filter((check) => check.ok === false).flatMap((check) => failureKinds(item, check)));
        return kinds.size === 0 ? null : kinds.size === 1 ? [...kinds][0] : "several kinds";
      } },
    { id: "error_kind", kind: "fact", type: "category", label: "cause of the call error",
      help: `budget reached, local rate limit, API key, request validation, upstream rate limit, picture problem, network, upstream error or other, read from the error of your latest call. The error text itself never appears. ${SESSION}`,
      value: (item) => {
        const error = resultOf(item)?.error;
        if (!error) return null;
        const text = String(error);
        return (ERROR_KINDS.find(([pattern]) => pattern.test(text)) || [null, "other"])[1];
      } },
    { id: "failing_check_ids", kind: "fact", type: "text", label: "failing question IDs",
      help: `IDs of the questions and orphan expectations whose latest check failed, comma separated. ${SESSION}`,
      value: (item) => checksOf(item).filter((check) => check.ok === false).map((check) => check.id).join(", ") },

    // ---------- confidence of the answers ----------
    { id: "mean_confidence", kind: "fact", type: "number", label: "mean answer confidence", unit: "0 to 1",
      help: `Mean confidence of the Choice, Score and Box answers; yes/no answers carry none. ${SESSION}`,
      value: (item) => {
        const values = checksOf(item).map((check) => finite(check.confidence)).filter((value) => value !== null);
        return values.length ? tidy(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
      } },
    { id: "uncertain_yes_no", kind: "fact", type: "number", label: "uncertain yes/no answers", unit: "answers",
      help: `Yes/no answers with P(yes) from 0.35 to 0.65. ${SESSION}`,
      value: (item) => (answered(item) ? answersOf(item, "noul").filter((answer) => finite(answer.noul) !== null && answer.noul >= 0.35 && answer.noul <= 0.65).length : null) },
    { id: "highest_choice_entropy", kind: "fact", type: "number", label: "highest Choice entropy", unit: "0 to 1",
      help: `The most spread-out Choice answer: entropy of its probabilities divided by the log of its option count (0 is certain, 1 is uniform). ${SESSION}`,
      value: (item) => {
        const values = answersOf(item, "choice").map(normalizedEntropy).filter((value) => value !== null);
        return values.length ? tidy(Math.max(...values)) : null;
      } },
    { id: "smallest_choice_gap", kind: "fact", type: "number", label: "smallest gap between the top two options", unit: "probability",
      help: `For each Choice answer, the probability of its most likely option minus the runner-up's; the smallest of them. ${SESSION}`,
      value: (item) => lowest(answersOf(item, "choice").map(topGap).filter((value) => value !== null)) },

    // ---------- measurements of the call ----------
    { id: "output_tokens", kind: "fact", type: "number", label: "measured output tokens", unit: "tokens", help: SESSION,
      value: (item) => finite(metaOf(item)?.output_tokens) },
    { id: "input_tokens_per_question", kind: "fact", type: "number", label: "measured input tokens per question", unit: "tokens",
      help: `Input tokens of the latest call divided by the questions it asked. ${SESSION}`, value: perQuestion("input_tokens") },
    { id: "cost_per_question", kind: "fact", type: "number", label: "measured spend per question", unit: "USD",
      help: `Measured spend of the latest call divided by the questions it asked; not an estimate. ${SESSION}`, value: perQuestion("cost_usd") },
    { id: "latency_per_question", kind: "fact", type: "number", label: "measured latency per question", unit: "ms",
      help: `Model latency of the latest call divided by the questions it asked. ${SESSION}`, value: perQuestion("latency_ms") },
    { id: "server_elapsed_ms", kind: "fact", type: "number", label: "server time for the test", unit: "ms",
      help: `Server time for the test, including loading its saved pictures; failed calls have one too. ${SESSION}`,
      value: (item) => finite(resultOf(item)?.elapsed_ms) },
    { id: "server_overhead_ms", kind: "fact", type: "number", label: "server time beyond model latency", unit: "ms",
      help: `Server time for the test minus the call's model latency: picture loading and checks. ${SESSION}`,
      value: (item) => {
        const elapsed = finite(resultOf(item)?.elapsed_ms), latency = finite(metaOf(item)?.latency_ms);
        return elapsed === null || latency === null ? null : tidy(elapsed - latency);
      } },
  ],
});
