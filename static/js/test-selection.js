// Current-page saved-test selection and results. No persistence or model calls.
import { matchesSaved } from "./saved-search.js";
import { refineSuite } from "./suite-refinements.js";
export { suiteAuthoredMetrics, suiteQuestionInventory, suiteInventoryText, previewSuiteIds, applySuiteIds, firstVisibleSuiteIds } from "./suite-refinements.js";

export function testResultStatus(result) {
  return !result ? "not-run" : result.error ? "error" : result.ok ? "pass" : "fail";
}

export function visibleTests(items, results, { query = "", status = "all", type = "all", sort = "saved", expectations = "all", images = "all", selection = "all", selected = [], minQuestions = "", maxQuestions = "", stateType = "all", notes = "all", questionId = "", coverage = "all", typeMix = "all", searchField = "all", exclude = "", minExpectations = "", maxExpectations = "", minImages = "", maxImages = "", idPrefix = "", excludeType = "all", minStateBytes = "", maxStateBytes = "", namePrefix = "", idSuffix = "", questionMatch = "contains", minUncovered = "", maxUncovered = "", minOptions = "", maxOptions = "", minInstructions = "", maxInstructions = "", minLatency = "", maxLatency = "", minCost = "", maxCost = "", latency = "all", cost = "all", ...refinements } = {}) {
  const byId = new Map((results?.runs || []).map((run) => [run.id, run]));
  const selectedSet = new Set(selected);
  const presenceMatches = (value, mode) => mode === "all" || (mode === "with" ? value : !value);
  const countMatches = (count, value, minimum) => {
    if (String(value).trim() === "") return true;
    const bound = Number(value);
    return Number.isInteger(bound) && bound >= 0 && (minimum ? count >= bound : count <= bound);
  };
  const inputSizes = new Map();
  const inputBytes = (item) => {
    if (!inputSizes.has(item)) inputSizes.set(item, testInputBytes(item));
    return inputSizes.get(item);
  };
  const authoredCounts = new Map();
  const authored = (item) => {
    if (!authoredCounts.has(item)) authoredCounts.set(item, testAuthoredCounts(item));
    return authoredCounts.get(item);
  };
  const searchItem = (item) => searchField === "all" ? item : { [searchField]: item[searchField] };
  const numberMatches = (number, value, minimum) => String(value).trim() === "" ||
    (Number.isFinite(number) && Number.isFinite(Number(value)) && Number(value) >= 0 && (minimum ? number >= Number(value) : number <= Number(value)));
  const measured = (item, key) => {
    const value = byId.get(item.id)?.meta?.[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const shown = items.filter((item) => matchesSaved(searchItem(item), query)
    && (!String(exclude).trim() || !matchesSaved(searchItem(item), exclude))
    && String(item.id).toLocaleLowerCase().startsWith(String(idPrefix).trim().toLocaleLowerCase())
    && String(item.name || item.id).toLocaleLowerCase().startsWith(String(namePrefix).trim().toLocaleLowerCase())
    && String(item.id).toLocaleLowerCase().endsWith(String(idSuffix).trim().toLocaleLowerCase())
    && countMatches(authored(item).uncovered, minUncovered, true)
    && countMatches(authored(item).uncovered, maxUncovered, false)
    && countMatches(authored(item).options, minOptions, true)
    && countMatches(authored(item).options, maxOptions, false)
    && countMatches(authored(item).instructions, minInstructions, true)
    && countMatches(authored(item).instructions, maxInstructions, false)
    && presenceMatches(measured(item, "latency_ms") !== null, latency)
    && presenceMatches(measured(item, "cost_usd") !== null, cost)
    && numberMatches(measured(item, "latency_ms"), minLatency, true)
    && numberMatches(measured(item, "latency_ms"), maxLatency, false)
    && numberMatches(measured(item, "cost_usd"), minCost, true)
    && numberMatches(measured(item, "cost_usd"), maxCost, false)
    && (excludeType === "all" || !Object.values(item.questions || {}).some((question) => question.type === excludeType))
    && (String(minStateBytes).trim() === "" || countMatches(inputBytes(item), minStateBytes, true))
    && (String(maxStateBytes).trim() === "" || countMatches(inputBytes(item), maxStateBytes, false))
    && countMatches(Object.keys(item.expect || {}).length, minExpectations, true)
    && countMatches(Object.keys(item.expect || {}).length, maxExpectations, false)
    && countMatches(Object.keys(item.images || {}).length, minImages, true)
    && countMatches(Object.keys(item.images || {}).length, maxImages, false)
    && (status === "all" || testResultStatus(byId.get(item.id)) === status)
    && (type === "all" || Object.values(item.questions || {}).some((question) => question.type === type))
    && presenceMatches(Object.keys(item.expect || {}).length > 0, expectations)
    && presenceMatches(Object.keys(item.images || {}).length > 0, images)
    && presenceMatches(!!String(item.notes || "").trim(), notes)
    && (!String(questionId).trim() || Object.keys(item.questions || {}).some((id) => questionMatch === "exact"
      ? id.toLocaleLowerCase() === String(questionId).trim().toLocaleLowerCase()
      : id.toLocaleLowerCase().includes(String(questionId).trim().toLocaleLowerCase())))
    && (coverage === "all" || testExpectationCoverage(item) === coverage)
    && (typeMix === "all" || (new Set(Object.values(item.questions || {}).map((q) => q.type)).size > 1 ? "mixed" : "single") === typeMix)
    && (stateType === "all" || (typeof item.state === "string" ? "text" : Array.isArray(item.state) ? "array" : "object") === stateType)
    && countMatches(Object.keys(item.questions || {}).length, minQuestions, true)
    && countMatches(Object.keys(item.questions || {}).length, maxQuestions, false)
    && (selection === "all" || selectedSet.has(item.id) === (selection === "selected")));
  // Array#sort is stable; ties retain the saved list's order.
  if (sort === "input-smallest") shown.sort((a, b) => inputBytes(a) - inputBytes(b));
  if (sort === "input-largest") shown.sort((a, b) => inputBytes(b) - inputBytes(a));
  if (sort === "id") shown.sort((a, b) => a.id.localeCompare(b.id));
  if (sort === "id-desc") shown.sort((a, b) => b.id.localeCompare(a.id));
  if (sort === "fewest-images") shown.sort((a, b) => Object.keys(a.images || {}).length - Object.keys(b.images || {}).length);
  for (const [key, descending, ascending] of [["uncovered", "most-uncovered", "fewest-uncovered"], ["options", "most-options", "fewest-options"], ["instructions", "longest-instructions", "shortest-instructions"]]) {
    if ([descending, ascending].includes(sort)) shown.sort((a, b) => (sort === descending ? -1 : 1) * (authored(a)[key] - authored(b)[key]));
  }
  if (sort === "images") shown.sort((a, b) => Object.keys(b.images || {}).length - Object.keys(a.images || {}).length);
  if (sort === "fewest-expectations") shown.sort((a, b) => Object.keys(a.expect || {}).length - Object.keys(b.expect || {}).length);
  if (sort === "name") shown.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  if (sort === "questions") shown.sort((a, b) => Object.keys(b.questions || {}).length - Object.keys(a.questions || {}).length);
  if (sort === "name-desc") shown.sort((a, b) => (b.name || b.id).localeCompare(a.name || a.id));
  if (sort === "fewest-questions") shown.sort((a, b) => Object.keys(a.questions || {}).length - Object.keys(b.questions || {}).length);
  if (sort === "expectations") shown.sort((a, b) => Object.keys(b.expect || {}).length - Object.keys(a.expect || {}).length);
  if (["slowest", "costliest", "fastest", "cheapest"].includes(sort)) {
    const key = ["slowest", "fastest"].includes(sort) ? "latency_ms" : "cost_usd";
    const ascending = ["fastest", "cheapest"].includes(sort);
    const observed = (item) => {
      const value = byId.get(item.id)?.meta?.[key];
      return typeof value === "number" && Number.isFinite(value) ? value : (ascending ? Infinity : -Infinity);
    };
    shown.sort((a, b) => ascending ? observed(a) - observed(b) : observed(b) - observed(a));
  }
  if (sort === "problems") {
    const priority = { error: 0, fail: 1, "not-run": 2, pass: 3 };
    shown.sort((a, b) => priority[testResultStatus(byId.get(a.id))] - priority[testResultStatus(byId.get(b.id))]);
  }
  return refineSuite(shown, { ...refinements, sort });
}

// Authored counts, never question wording or labels in reports/downloads.
export function testAuthoredCounts(item) {
  const questions = Object.entries(item.questions || {});
  return {
    uncovered: questions.filter(([id]) => !Object.hasOwn(item.expect || {}, id)).length,
    options: questions.reduce((sum, [, q]) => sum + (q.type === "choice" ? Object.keys(q.criteria || {}).length : 0), 0),
    instructions: questions.reduce((sum, [, q]) => sum + Array.from(typeof q.instructions === "string" ? q.instructions : (q.instructions == null ? "" : JSON.stringify(q.instructions))).length, 0),
  };
}

// Latest current results only. These totals intentionally exclude previous rerun attempts.
export function testObservedSummary(items, results) {
  const ids = new Set(items.map((item) => item.id));
  const summary = { tests: ids.size, latencyCount: 0, latencyTotal: 0, costCount: 0, costTotal: 0 };
  for (const run of results?.runs || []) {
    if (!ids.has(run.id)) continue;
    for (const [field, count, total] of [["latency_ms", "latencyCount", "latencyTotal"], ["cost_usd", "costCount", "costTotal"]]) {
      const value = run.meta?.[field];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) { summary[count]++; summary[total] += value; }
    }
  }
  return summary;
}

export function selectedTestIds(items, selected) {
  const wanted = new Set(selected);
  return items.filter((item) => wanted.has(item.id)).map((item) => item.id);
}

export function selectVisibleTests(items, selected, visible) {
  return selectedTestIds(items, [...selected, ...visible.map((item) => item.id)]);
}

export function deselectVisibleTests(items, selected, visible) {
  const removed = new Set(visible.map((item) => item.id));
  return selectedTestIds(items, selected.filter((id) => !removed.has(id)));
}

export function invertVisibleTests(items, selected, visible) {
  const toggled = new Set(selectedTestIds(items, selected));
  for (const id of new Set(visible.map((item) => item.id))) {
    if (toggled.has(id)) toggled.delete(id);
    else toggled.add(id);
  }
  return selectedTestIds(items, toggled);
}

export function testRunBody(items, ids = null) {
  // An empty ids array means "all" on the server: never send one.
  const selected = ids === null ? items.map((item) => item.id) : selectedTestIds(items, ids);
  return selected.length ? { ids: selected } : null;
}

export function testRunSnapshot(items, body) {
  if (!body) return null;
  const wanted = new Set(body.ids);
  return JSON.stringify([body.ids, items.filter((item) => wanted.has(item.id))]);
}

function summarizeTestRuns(session, items) {
  const available = new Map(items.map((item) => [item.id, JSON.stringify(item)]));
  const runs = session.runs.filter((run) => available.has(run.id)
    && (!session.snapshots || session.snapshots[run.id] === available.get(run.id)));
  const count = (status) => runs.filter((run) => testResultStatus(run) === status).length;
  return { ...session, runs, passed: count("pass"), failed: count("fail"), errors: count("error"),
    unrun: items.length - runs.length };
}

export function pruneTestResults(session, items) {
  return session ? summarizeTestRuns(session, items) : null;
}

export function mergeTestResults(previous, batch, items, requestedItems = items) {
  const byId = new Map((previous?.runs || []).map((run) => [run.id, run]));
  const snapshots = Object.assign(Object.create(null), previous?.snapshots || {});
  const requested = new Map(requestedItems.map((item) => [item.id, JSON.stringify(item)]));
  for (const run of batch.runs || []) {
    byId.set(run.id, run);
    snapshots[run.id] = requested.get(run.id);
  }
  return summarizeTestRuns({ snapshots, runs: [...byId.values()], batches: (previous?.batches || 0) + 1,
    cost_usd: (previous?.cost_usd || 0) + (batch.cost_usd || 0),
    wall_ms: (previous?.wall_ms || 0) + (batch.wall_ms || 0),
    last_count: (batch.runs || []).length }, items);
}

// Describes the selected saved requests, never measured or estimated model spend.
export function selectedTestSummary(items, selected) {
  const wanted = new Set(selectedTestIds(items, selected));
  return items.filter((item) => wanted.has(item.id)).reduce((total, item) => ({
    tests: total.tests + 1,
    questions: total.questions + Object.keys(item.questions || {}).length,
    expectations: total.expectations + Object.keys(item.expect || {}).length,
    images: total.images + Object.keys(item.images || {}).length,
  }), { tests: 0, questions: 0, expectations: 0, images: 0 });
}

// Coverage counts only expectations for existing questions; an empty request has no coverage.
export function testExpectationCoverage(item) {
  const ids = Object.keys(item.questions || {});
  const covered = ids.filter((id) => Object.hasOwn(item.expect || {}, id)).length;
  return !covered ? "none" : covered === ids.length ? "full" : "partial";
}

// Metadata only: exclude authored instructions, inputs, notes, pictures and all answer/check/error text.
export function testMetadataJson(items, results) {
  const byId = new Map((results?.runs || []).map((run) => [run.id, run]));
  const observed = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return JSON.stringify(items.map((item) => {
    const run = byId.get(item.id);
    return { id: item.id, name: item.name || item.id,
      questions: Object.keys(item.questions || {}).length,
      expectations: Object.keys(item.expect || {}).length,
      pictures: Object.keys(item.images || {}).length,
      status: testResultStatus(run),
      latency_ms: observed(run?.meta?.latency_ms), cost_usd: observed(run?.meta?.cost_usd) };
  }), null, 2);
}

// Serialized state bytes describe authored inputs; picture bytes are not included.
export function testInputBytes(item) {
  return new TextEncoder().encode(typeof item.state === "string" ? item.state : JSON.stringify(item.state ?? null)).length;
}

// This shares the JSON export's allowlist; spreadsheet cells are always escaped.
export function testMetadataCsv(items, results) {
  const fields = ["id", "name", "questions", "expectations", "pictures", "status", "latency_ms", "cost_usd"];
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [fields, ...JSON.parse(testMetadataJson(items, results)).map((row) => fields.map((field) => row[field]))]
    .map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function testStatusSummary(items, results) {
  const byId = new Map((results?.runs || []).map((run) => [run.id, run]));
  const counts = { pass: 0, fail: 0, error: 0, "not-run": 0 };
  for (const item of items) counts[testResultStatus(byId.get(item.id))]++;
  return `${counts.pass} passed · ${counts.fail} failed · ${counts.error} errors · ${counts["not-run"]} not run among shown tests`;
}
