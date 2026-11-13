// Suite metrics for the Workbench Tests tab ("workbench.tests.items"; contract in static/js/lab/surfaces/workbench-tests.js).
// Session metrics measure the latest result of each SHOWN test the user ran in this page session (pass rates with
// Wilson 95% intervals, failure kinds, latency, tokens and measured spend); each is unavailable before a
// run. Authored metrics describe the shown saved tests themselves (expectation coverage by type, shape, distinct
// inputs and pictures) and need no run. Summed latency is never wall time, nothing here is a
// spend estimate, and no metric shows inputs, instructions, expectation values, chosen options or check text.
import { compareText, definePack } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";
import { median, quantile } from "../../lib/math.js";

const Z95 = 1.959963984540054;   // the 97.5th percentile of the standard normal
const CLOSE = 0.05;              // a passed bound held by less than this is a close call
const EDGES = ["left", "top", "right", "bottom"];

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const total = (values) => values.reduce((sum, value) => sum + value, 0);
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions : []);
const resultOf = (item) => (isObject(item?.result) ? item.result : null);
const answered = (item) => { const result = resultOf(item); return !!result && !result.error && Array.isArray(result.checks); };
const checksOf = (item) => (answered(item) ? item.result.checks.filter(isObject) : []);
const metaOf = (item) => { const result = resultOf(item); return result && !result.error && isObject(result.meta) ? result.meta : null; };
const shownOf = (ctx) => { const list = ctx?.shown?.(); return Array.isArray(list) ? list.filter(isObject) : []; };
const ran = (ctx) => shownOf(ctx).filter((item) => resultOf(item));
const checked = (check) => check.ok === true || check.ok === false;

// The Wilson score interval for x successes in n trials.
function wilson(x, n) {
  const p = x / n, z2 = Z95 * Z95, denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (Z95 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// "name count · name count", largest count first, then by name.
const tally = (counts) => [...counts].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0])).map(([name, count]) => `${name} ${count}`).join(" · ");
const countBy = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
};

// The expectation the server checked for a question check (a nonempty one of the question).
function expectationOf(item, check) {
  if (!check.question) return null;
  const question = questionsOf(item).find((entry) => entry.id === check.id);
  return question && isObject(question.expect) && Object.keys(question.expect).length ? question.expect : null;
}

function iou(a, b) {
  if (!isObject(a) || !isObject(b) || !EDGES.every((edge) => finite(a[edge]) !== null && finite(b[edge]) !== null)) return null;
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const area = (box) => Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
  const inter = width * height, union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

// One answer against its expectation, as jev/workbench.py check_expectation does it: the margins of its bounds
// (negative when missed), the kinds of failure, and whether the expectation holds something the server cannot read.
function assess(answer, expect) {
  const out = { margins: [], kinds: [], invalid: false };
  if (!isObject(answer) || !isObject(expect)) return out;
  if (answer.type === "box") {
    if (!has(expect, "box")) return out;
    const floor = has(expect, "iou_min") ? finite(expect.iou_min) : 0.5, overlap = iou(answer.box, expect.box);
    if (overlap === null || floor === null) { out.invalid = true; return out; }
    out.margins.push(overlap - floor);
    if (overlap < floor) out.kinds.push("low overlap");
    return out;
  }
  let target;
  if (answer.type === "choice") {
    if (has(expect, "choice") && answer.choice !== expect.choice) out.kinds.push("wrong choice");
    target = isObject(answer.probabilities) && has(answer.probabilities, answer.choice) ? finite(answer.probabilities[answer.choice]) : 0;
  } else if (answer.type === "score") target = finite(answer.score);
  else if (answer.type === "noul") target = finite(answer.noul);
  else return out;
  for (const [key, below] of [["min", true], ["max", false]]) {
    if (!has(expect, key)) continue;
    const bound = finite(expect[key]);
    if (bound === null || target === null) { out.invalid = true; continue; }
    out.margins.push(below ? target - bound : bound - target);
    if (below ? target < bound : target > bound) out.kinds.push(below ? "below min" : "above max");
  }
  return out;
}

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


// Measured values of the shown tests' latest calls.
const measured = (ctx, field) => shownOf(ctx).map((item) => finite(metaOf(item)?.[field])).filter((value) => value !== null);
// [value, question_count] pairs of calls that measured both.
const perCall = (ctx, field) => shownOf(ctx).map(metaOf).filter((meta) => meta && finite(meta[field]) !== null && Number.isInteger(meta.question_count) && meta.question_count > 0)
  .map((meta) => [meta[field], meta.question_count]);

// Choice answers checked against an expected option the answer gave a probability to: { probabilities, expected }.
const expectedChoices = (ctx) => shownOf(ctx).flatMap((item) => checksOf(item).flatMap((check) => {
  const expect = expectationOf(item, check), answer = check.answer;
  if (!expect || typeof expect.choice !== "string" || !isObject(answer) || answer.type !== "choice" || !isObject(answer.probabilities)) return [];
  const probabilities = Object.entries(answer.probabilities).map(([key, value]) => [key, finite(value)]);
  if (probabilities.some(([, value]) => value === null) || !probabilities.some(([key]) => key === expect.choice)) return [];
  return [{ probabilities, expected: expect.choice }];
}));

// Authored: every question occurrence of the shown tests, with its test.
const occurrences = (ctx) => shownOf(ctx).flatMap((item) => questionsOf(item).map((question) => ({ item, question, type: question.type || "unknown" })));

const SESSION = "Latest result of each shown test you ran in this page session; unavailable before a run.";
const AUTHORED = "Over the shown saved tests as authored; no run needed.";

export default definePack({
  id: "tests-suite-metrics",
  surface: "workbench.tests.items",
  title: "Suite metrics",
  about: "Pass rates with 95% intervals, failure kinds, failing question IDs, confidence on expected options, latency, tokens and measured spend over the latest results of the shown tests you ran in this page session, plus authored expectation coverage, shape, distinct inputs and pictures of the shown tests before any run. Summed latency is not wall time and nothing is a spend estimate; no metric shows inputs, instructions, expectation values or answers.",
  features: [
    // ---------- verdicts ----------
    { id: "test_pass_rate", kind: "metric", format: "percent", label: "Tests that passed every check",
      help: `Among shown tests whose latest call succeeded and checked something, with a Wilson 95% interval. Call errors are left out. ${SESSION}`,
      compute: (ctx) => {
        const tests = ran(ctx).filter((item) => answered(item) && checksOf(item).some(checked));
        if (!tests.length) return null;
        const passed = tests.filter((item) => item.status === "pass").length, errors = ran(ctx).filter((item) => item.result.error).length;
        const [low, high] = wilson(passed, tests.length);
        return { value: passed / tests.length, detail: `${passed} of ${plural(tests.length, "test")}; 95% interval ${pct(low)} to ${pct(high)}${errors ? `; ${plural(errors, "call error")} left out` : ""}` };
      } },
    { id: "check_pass_interval", kind: "metric", format: "text", label: "Checked-question pass rate, 95% interval",
      help: `Wilson score interval for the share of checks that passed (questions and orphan expectations; unchecked answers left out). ${SESSION}`,
      compute: (ctx) => {
        const checks = ran(ctx).flatMap(checksOf).filter(checked);
        if (!checks.length) return null;
        const passed = checks.filter((check) => check.ok === true).length;
        const [low, high] = wilson(passed, checks.length);
        return { value: `${pct(low)} to ${pct(high)}`, detail: `${passed} of ${plural(checks.length, "check")} passed (${pct(passed / checks.length)})` };
      } },
    { id: "pass_rate_by_type", kind: "metric", format: "text", label: "Checks passed by question type",
      help: `Passed of checked questions per question type; orphan expectations are left out. ${SESSION}`,
      compute: (ctx) => {
        const groups = new Map();
        for (const item of ran(ctx)) {
          for (const check of checksOf(item).filter((entry) => entry.question && checked(entry))) {
            const type = questionsOf(item).find((question) => question.id === check.id)?.type || "unknown";
            const group = groups.get(type) || [0, 0];
            group[0] += check.ok === true ? 1 : 0;
            group[1] += 1;
            groups.set(type, group);
          }
        }
        if (!groups.size) return null;
        const checks = total([...groups.values()].map(([, count]) => count));
        return { value: [...groups].sort((a, b) => compareText(a[0], b[0])).map(([type, [passed, count]]) => `${type} ${passed}/${count}`).join(" · "), detail: plural(checks, "checked question") };
      } },
    { id: "failures_by_kind", kind: "metric", format: "text", label: "Failed checks by kind",
      help: `wrong choice, below min, above max, low overlap, missing answer, unknown question, invalid expectation or other (a failure these rules do not explain), recomputed from your answers and expectations; a check can fail more than one way. ${SESSION}`,
      compute: (ctx) => {
        const tests = ran(ctx).filter(answered);
        if (!tests.length) return null;
        const kinds = tests.flatMap((item) => checksOf(item).filter((check) => check.ok === false).flatMap((check) => failureKinds(item, check)));
        return kinds.length ? { value: tally(countBy(kinds)), detail: plural(kinds.length, "failure") } : { value: "no failed checks", detail: plural(tests.length, "answered test") };
      } },
    { id: "most_failed_ids", kind: "metric", format: "text", label: "Question IDs that fail most",
      help: `Up to three question or orphan-expectation IDs with the most failed checks, as failed/checked across the shown tests. ${SESSION}`,
      compute: (ctx) => {
        const counts = new Map();
        for (const check of ran(ctx).flatMap(checksOf).filter(checked)) {
          const entry = counts.get(check.id) || [0, 0];
          entry[0] += check.ok === false ? 1 : 0;
          entry[1] += 1;
          counts.set(check.id, entry);
        }
        if (!counts.size) return null;
        const failing = [...counts].filter(([, [failed]]) => failed > 0)
          .sort((a, b) => b[1][0] - a[1][0] || b[1][0] / b[1][1] - a[1][0] / a[1][1] || compareText(a[0], b[0]));
        if (!failing.length) return { value: "no failed checks", detail: plural(counts.size, "checked ID") };
        return { value: failing.slice(0, 3).map(([id, [failed, count]]) => `${id} ${failed}/${count}`).join(" · "), detail: `${plural(failing.length, "ID")} failed at least once` };
      } },
    { id: "unchecked_share", kind: "metric", format: "percent", label: "Answers with no expectation",
      help: `Share of answered questions that no expectation checked. ${SESSION}`,
      compute: (ctx) => {
        const answers = ran(ctx).flatMap(checksOf).filter((check) => check.question && isObject(check.answer));
        if (!answers.length) return null;
        const unchecked = answers.filter((check) => check.ok === null).length;
        return { value: unchecked / answers.length, detail: `${unchecked} of ${plural(answers.length, "answer")}` };
      } },
    { id: "close_passes", kind: "metric", format: "integer", label: "Passed checks within 0.05 of a bound",
      help: `Passed checks whose probability, score or overlap bound held by less than ${CLOSE}. ${SESSION}`,
      compute: (ctx) => {
        const bounded = ran(ctx).flatMap((item) => checksOf(item).filter((check) => check.ok === true && check.question && isObject(check.answer))
          .map((check) => assess(check.answer, expectationOf(item, check)).margins)).filter((list) => list.length);
        if (!bounded.length) return null;
        const close = bounded.filter((list) => Math.min(...list) >= 0 && Math.min(...list) < CLOSE).length;
        return { value: close, detail: `of ${plural(bounded.length, "passed check")} with a bound` };
      } },
    { id: "mean_expected_probability", kind: "metric", format: "percent", label: "Mean probability of expected options",
      help: `Mean probability your latest Choice answers gave to the option their expectation names. ${SESSION}`,
      compute: (ctx) => {
        const list = expectedChoices(ctx);
        if (!list.length) return null;
        return { value: total(list.map(({ probabilities, expected }) => probabilities.find(([key]) => key === expected)[1])) / list.length, detail: plural(list.length, "Choice answer") };
      } },
    { id: "choice_brier", kind: "metric", format: "number", label: "Brier score on expected options",
      help: `Mean over Choice answers with an expected option of the summed squared differences between each option's probability and 1 for the expected option, 0 for the others: 0 is perfect, 2 is the worst. ${SESSION}`,
      compute: (ctx) => {
        const list = expectedChoices(ctx);
        if (!list.length) return null;
        const scores = list.map(({ probabilities, expected }) => total(probabilities.map(([key, value]) => (value - (key === expected ? 1 : 0)) ** 2)));
        return { value: total(scores) / scores.length, detail: plural(list.length, "Choice answer") };
      } },

    // ---------- measurements ----------
    { id: "latency_p90", kind: "metric", format: "ms", label: "90th percentile of measured latency",
      help: `Model latency of the shown tests' latest calls, interpolated between order statistics. Not wall time. ${SESSION}`,
      compute: (ctx) => {
        const values = measured(ctx, "latency_ms");
        return values.length ? { value: quantile(values, 0.9), detail: plural(values.length, "call") } : null;
      } },
    { id: "latency_slope", kind: "metric", format: "ms", label: "Latency change per added question",
      help: `Least-squares slope of measured latency against the call's question count; needs calls with at least two different question counts. A measurement, not a prediction. ${SESSION}`,
      compute: (ctx) => {
        const points = perCall(ctx, "latency_ms");
        if (new Set(points.map(([, count]) => count)).size < 2) return null;
        const mx = total(points.map(([, x]) => x)) / points.length, my = total(points.map(([y]) => y)) / points.length;
        const sxx = total(points.map(([, x]) => (x - mx) ** 2)), sxy = total(points.map(([y, x]) => (x - mx) * (y - my)));
        return { value: sxy / sxx, detail: `over ${plural(points.length, "call")}` };
      } },
    { id: "latest_spend", kind: "metric", format: "usd", label: "Measured spend of the shown latest calls",
      help: `Sum of the measured spend of each shown test's latest call; earlier attempts are not included. Not an estimate. ${SESSION}`,
      compute: (ctx) => {
        const values = measured(ctx, "cost_usd");
        return values.length ? { value: total(values), detail: plural(values.length, "call") } : null;
      } },
    { id: "median_spend", kind: "metric", format: "usd", label: "Median measured spend per test",
      help: `Median of the measured spend of the shown tests' latest calls. ${SESSION}`,
      compute: (ctx) => {
        const values = measured(ctx, "cost_usd");
        return values.length ? { value: median(values), detail: plural(values.length, "call") } : null;
      } },
    { id: "spend_per_question", kind: "metric", format: "usd", label: "Measured spend per question",
      help: `Measured spend of the shown latest calls divided by the questions they asked. ${SESSION}`,
      compute: (ctx) => {
        const pairs = perCall(ctx, "cost_usd");
        const questions = total(pairs.map(([, count]) => count));
        return pairs.length ? { value: total(pairs.map(([value]) => value)) / questions, detail: `${plural(questions, "question")} in ${plural(pairs.length, "call")}` } : null;
      } },
    { id: "spend_concentration", kind: "metric", format: "percent", label: "Spend share of the three costliest tests",
      help: `Share of the shown latest calls' measured spend that the three costliest of them account for; needs four or more measured calls. ${SESSION}`,
      compute: (ctx) => {
        const values = measured(ctx, "cost_usd").sort((a, b) => b - a), sum = total(values);
        return values.length > 3 && sum > 0 ? { value: total(values.slice(0, 3)) / sum, detail: `of ${plural(values.length, "call")}` } : null;
      } },
    { id: "superseded_spend", kind: "metric", format: "usd", label: "Session spend outside the current results",
      help: "Measured session spend minus the spend of every saved test's latest call: reruns, and calls of tests changed or deleted since. All tests, not only the shown ones; unavailable before a run.",
      compute: (ctx) => {
        const session = ctx?.data?.results;
        if (!session) return null;
        const latest = total((ctx.items?.() || []).map((item) => finite(metaOf(item)?.cost_usd)).filter((value) => value !== null));
        const rest = session.cost_usd - latest;
        return { value: rest > 1e-12 ? rest : 0, detail: `session $${Number(session.cost_usd.toPrecision(6))} over ${plural(session.batches, "batch", "batches")}` };
      } },
    { id: "input_tokens_per_question", kind: "metric", format: "number", label: "Measured input tokens per question",
      help: `Input tokens of the shown latest calls divided by the questions they asked. ${SESSION}`,
      compute: (ctx) => {
        const pairs = perCall(ctx, "input_tokens");
        return pairs.length ? { value: total(pairs.map(([value]) => value)) / total(pairs.map(([, count]) => count)), detail: plural(pairs.length, "call") } : null;
      } },

    // ---------- authored (no run needed) ----------
    { id: "coverage_by_type", kind: "metric", format: "text", label: "Expectation coverage by question type",
      help: `Question occurrences with an expectation (an empty {} one included) over all occurrences, per type. ${AUTHORED}`,
      compute: (ctx) => {
        const list = occurrences(ctx);
        if (!list.length) return null;
        const groups = new Map();
        for (const { type, question } of list) {
          const group = groups.get(type) || [0, 0];
          group[0] += question.expect !== null && question.expect !== undefined ? 1 : 0;
          group[1] += 1;
          groups.set(type, group);
        }
        const covered = total([...groups.values()].map(([count]) => count));
        return { value: [...groups].sort((a, b) => compareText(a[0], b[0])).map(([type, [done, count]]) => `${type} ${done}/${count}`).join(" · "), detail: `${covered} of ${plural(list.length, "question occurrence")} covered` };
      } },
    { id: "questions_per_test", kind: "metric", format: "number", label: "Median questions per test",
      help: `Tests whose questions cannot be read count as zero. ${AUTHORED}`,
      compute: (ctx) => {
        const counts = shownOf(ctx).map((item) => questionsOf(item).length);
        return counts.length ? { value: median(counts), detail: `largest ${Math.max(...counts)}` } : null;
      } },
    { id: "options_per_choice", kind: "metric", format: "number", label: "Mean options per Choice question", help: AUTHORED,
      compute: (ctx) => {
        const list = occurrences(ctx).filter((entry) => entry.type === "choice");
        return list.length ? { value: total(list.map((entry) => entry.question.criteria?.length || 0)) / list.length, detail: plural(list.length, "Choice question") } : null;
      } },
    { id: "levels_per_score", kind: "metric", format: "number", label: "Mean levels per Score question", help: AUTHORED,
      compute: (ctx) => {
        const list = occurrences(ctx).filter((entry) => entry.type === "score");
        return list.length ? { value: total(list.map((entry) => entry.question.criteria?.length || 0)) / list.length, detail: plural(list.length, "Score question") } : null;
      } },
    { id: "distinct_inputs", kind: "metric", format: "integer", label: "Distinct inputs",
      help: `Different saved states among the shown tests; JSON key order is ignored. ${AUTHORED}`,
      compute: (ctx) => {
        const tests = shownOf(ctx);
        return tests.length ? { value: new Set(tests.map((item) => stableStringify(item.state))).size, detail: `of ${plural(tests.length, "test")}` } : null;
      } },
    { id: "distinct_pictures", kind: "metric", format: "integer", label: "Distinct pictures referenced",
      help: `Different sample or uploaded pictures the shown tests reference. ${AUTHORED}`,
      compute: (ctx) => {
        const tests = shownOf(ctx);
        if (!tests.length) return null;
        const refs = tests.flatMap((item) => (Array.isArray(item.images) ? item.images : []))
          .map((image) => (image?.sample ? `sample:${image.sample}` : image?.file ? `file:${image.file}` : null)).filter(Boolean);
        const distinct = new Set(refs);
        const samples = [...distinct].filter((ref) => ref.startsWith("sample:")).length;
        return { value: distinct.size, detail: `${plural(refs.length, "reference")}; ${plural(samples, "sample")}, ${plural(distinct.size - samples, "upload")}` };
      } },
  ],
});
