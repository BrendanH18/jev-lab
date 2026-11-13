// Starter pack for the Workbench Tests tab ("workbench.tests.items"; contract in static/js/lab/surfaces/workbench-tests.js):
// question-type counts, verdict and measurement facts from the user's own latest run, expectation sanity checks, run
// metrics, a results table export, and a selection command. Facts return numbers, flags and fixed-vocabulary categories only,
// so the Lab facts CSV never carries authored text, expectation values or answers.
import { definePack } from "../../kit.js";

const DAY_MS = 86400000;
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const questionsOf = (item) => (Array.isArray(item?.questions) ? item.questions.filter(isObject) : []);
const checksOf = (item) => (item?.result && Array.isArray(item.result.checks) ? item.result.checks : []);
const typeCount = (type) => (item) => (Array.isArray(item?.questions) ? item.questions.filter((question) => question?.type === type).length : null);
// Verdict facts need a successful call: null before a run and after a call error.
const answered = (item) => !!item?.result && !item.result.error;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const TYPES = ["noul", "choice", "score", "box"];
// A question type from the fixed vocabulary; any other string a file holds reads "other", so no authored text leaks.
const typeName = (type) => (TYPES.includes(type) ? type : "other");
const criteriaOf = (question) => (Array.isArray(question?.criteria) ? question.criteria : []);
// Min and max bound the answer for Noul, Choice and Score; the run ignores them on a Box.
const bounded = (question) => ["noul", "choice", "score"].includes(question?.type);

// Range bounds an expectation may hold for a question: probabilities for Noul and Choice, levels for a Score.
function boundRange(question) {
  if (question.type === "noul" || question.type === "choice") return [0, 1];
  if (question.type === "score" && criteriaOf(question).length) return [0, criteriaOf(question).length - 1];
  return null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Greedy set cover: repeatedly take the test that asks the most question IDs not yet covered (the earlier test in the
// given order on a tie). Tests that add nothing new are left out.
function coveringTests(tests) {
  const left = new Set(tests.flatMap((test) => questionsOf(test).map((question) => question.id)));
  const chosen = [];
  while (left.size) {
    let best = null, gain = 0;
    for (const test of tests) {
      const adds = new Set(questionsOf(test).map((question) => question.id).filter((id) => left.has(id))).size;
      if (adds > gain) { best = test; gain = adds; }
    }
    if (!best) break;
    chosen.push(best.id);
    for (const question of questionsOf(best)) left.delete(question.id);
  }
  return chosen;
}

export default definePack({
  id: "tests-triage",
  surface: "workbench.tests.items",
  title: "Saved test triage",
  about: "Question-type counts, verdict, token and confidence facts from your own latest run, expectation sanity checks, run metrics, a results table and a covering selection for the saved tests. Facts and the results table hold counts, statuses, IDs and measurements only: never inputs, instructions, expectation values or answers.",
  features: [
    { id: "noul_questions", kind: "fact", type: "number", label: "yes/no questions", unit: "questions", value: typeCount("noul") },
    { id: "choice_questions", kind: "fact", type: "number", label: "choice questions", unit: "questions", value: typeCount("choice") },
    { id: "score_questions", kind: "fact", type: "number", label: "score questions", unit: "questions", value: typeCount("score") },
    { id: "box_questions", kind: "fact", type: "number", label: "box questions", unit: "questions", value: typeCount("box") },
    { id: "failed_checks", kind: "fact", type: "number", label: "failed checks", unit: "checks", help: "From your latest run of each test; unknown before a run and after a call error.",
      value: (item) => (answered(item) ? checksOf(item).filter((check) => check.ok === false).length : null) },
    { id: "unchecked_answers", kind: "fact", type: "number", label: "unchecked answers", unit: "answers", help: "Answers of your latest run that no expectation checked.",
      value: (item) => (answered(item) ? checksOf(item).filter((check) => check.ok === null && check.answer).length : null) },
    { id: "input_tokens", kind: "fact", type: "number", label: "measured input tokens", unit: "tokens",
      value: (item) => finite(item?.result?.meta?.input_tokens) },
    { id: "lowest_confidence", kind: "fact", type: "number", label: "lowest answer confidence", unit: "0 to 1", help: "Choice, Score and Box answers of your latest run; Noul answers carry none.",
      value: (item) => {
        const values = checksOf(item).map((check) => finite(check.confidence)).filter((value) => value !== null);
        return values.length ? Math.min(...values) : null;
      } },
    { id: "age_days", kind: "fact", type: "number", label: "days since last saved", unit: "days", help: "Whole 24-hour days from saved_at to now; unknown when the file has none or the time cannot be read, and 0 for a save time after the clock.",
      value: (item, ctx) => {
        const saved = finite(item?.saved_ms), now = finite(ctx?.data?.now);
        return saved === null || now === null ? null : Math.max(0, Math.floor((now - saved) / DAY_MS));
      } },
    { id: "empty_expectation", kind: "fact", type: "flag", label: "an empty {} expectation", help: "It counts as coverage but checks nothing.",
      value: (item) => questionsOf(item).some((question) => isObject(question.expect) && !Object.keys(question.expect).length) },
    { id: "unreachable_choice", kind: "fact", type: "flag", label: "an expected option that is not offered", help: "Such a test can never pass.",
      value: (item) => questionsOf(item).some((question) => question.type === "choice" && typeof question.expect?.choice === "string"
        && !criteriaOf(question).some((criterion) => criterion?.key === question.expect.choice)) },
    { id: "answer_model", kind: "fact", type: "category", label: "answering model", value: (item) => item?.result?.meta?.model || null },
    { id: "type_mix", kind: "fact", type: "category", label: "question type mix",
      help: "The distinct question types the test asks, such as \"choice + noul\"; a type outside noul, choice, score and box reads \"other\".",
      value: (item) => {
        const types = [...new Set(questionsOf(item).map((question) => typeName(question?.type)))].sort();
        return types.length ? types.join(" + ") : null;
      } },

    { id: "min_above_max", kind: "diagnostic", severity: "problem", label: "Empty expectation range",
      help: "A Noul, Choice or Score expectation whose min is above its max (the run ignores min and max on a Box).",
      check: (item) => questionsOf(item).filter((question) => bounded(question) && finite(question.expect?.min) !== null && finite(question.expect?.max) !== null && question.expect.min > question.expect.max)
        .map((question) => `${question.id}: min is above max, so this check can never pass.`) },
    { id: "choice_on_non_choice", kind: "diagnostic", severity: "advice", label: "Expected option on a question without options",
      check: (item) => questionsOf(item).filter((question) => question.type !== "choice" && isObject(question.expect) && Object.hasOwn(question.expect, "choice"))
        .map((question) => `${question.id}: a ${TYPES.includes(question.type) ? question.type : "question of this type"} has no options, so "choice" is ignored.`) },
    { id: "bound_out_of_range", kind: "diagnostic", severity: "problem", label: "Expectation bound outside the answer's range",
      check: (item) => questionsOf(item).flatMap((question) => {
        const range = boundRange(question);
        if (!range || !isObject(question.expect)) return [];
        return ["min", "max"].filter((key) => finite(question.expect[key]) !== null && (question.expect[key] < range[0] || question.expect[key] > range[1]))
          .map((key) => `${question.id}: ${key} is outside ${range[0]} to ${range[1]}.`);
      }) },
    { id: "duplicate_names", kind: "diagnostic", severity: "advice", scope: "list", label: "Tests that share a name",
      check: (items) => {
        const groups = new Map();
        for (const item of items) {
          const key = String(item?.name || "").trim().replace(/\s+/g, " ").toLowerCase();
          if (key) groups.set(key, [...(groups.get(key) || []), item.id]);
        }
        return [...groups.values()].filter((ids) => ids.length > 1).map((ids) => `${ids.join(", ")} share a name.`);
      } },

    { id: "check_pass_rate", kind: "metric", format: "percent", label: "Checked questions that passed",
      help: "Among the shown tests' latest runs; unchecked answers are left out.",
      compute: (ctx) => {
        const checks = ctx.shown().flatMap((item) => checksOf(item)).filter((check) => check.ok !== null);
        if (!checks.length) return null;
        const passed = checks.filter((check) => check.ok === true).length;
        return { value: passed / checks.length, detail: `${passed} of ${plural(checks.length, "check")}` };
      } },
    { id: "median_latency", kind: "metric", format: "ms", label: "Median measured latency",
      help: "Latest call of each shown test that has one. Not wall time.",
      compute: (ctx) => {
        const values = ctx.shown().map((item) => finite(item?.result?.meta?.latency_ms)).filter((value) => value !== null);
        return values.length ? { value: median(values), detail: plural(values.length, "call") } : null;
      } },

    { id: "results_markdown", kind: "exporter", label: "Shown results as a Markdown table", filename: "jev-test-results.md", mime: "text/markdown",
      help: "Test IDs, names, status, failed question IDs, measured latency and spend of your latest run. No inputs, instructions, expectation values, answers or check text.",
      build: (ctx) => {
        const cell = (value) => String(value).replace(/[\\|]/g, "\\$&").replace(/\s+/g, " ").trim();
        const rows = ctx.shown().map((item) => {
          const failed = checksOf(item).filter((check) => check.ok === false).map((check) => check.id);
          const latency = finite(item.result?.meta?.latency_ms), cost = finite(item.result?.meta?.cost_usd);
          return `| ${cell(item.id)} | ${cell(item.name)} | ${item.status} | ${failed.length ? cell(failed.join(", ")) : "—"} | ${latency === null ? "—" : `${Math.round(latency)} ms`} | ${cost === null ? "—" : `$${cost}`} |`;
        });
        return ["| Test | Name | Status | Failed questions | Latency | Spend |", "| --- | --- | --- | --- | --- | --- |", ...rows].join("\n") + "\n";
      } },

    { id: "select_covering", kind: "command", title: "Replace the selection with shown tests that cover every question ID", group: "Saved tests",
      when: (ctx) => !ctx.data.busy && ctx.shown().some((item) => questionsOf(item).length > 0),
      run: (ctx) => {
        const ids = coveringTests(ctx.shown());
        if (!ids.length) throw new Error("No shown test has a question.");
        ctx.actions.select(ids, "replace");
        ctx.env?.toast?.(`Selected ${plural(ids.length, "test")} that together ask every shown question ID. Undo selection change restores the previous selection.`);
      } },
  ],
});
