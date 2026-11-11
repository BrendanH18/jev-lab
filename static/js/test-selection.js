// Current-page saved-test selection and results. No persistence or model calls.
import { matchesSaved } from "./saved-search.js";

export function testResultStatus(result) {
  return !result ? "not-run" : result.error ? "error" : result.ok ? "pass" : "fail";
}

export function visibleTests(items, results, { query = "", status = "all", type = "all", sort = "saved", expectations = "all", images = "all", selection = "all", selected = [], minQuestions = "", maxQuestions = "", stateType = "all", notes = "all", questionId = "", coverage = "all", typeMix = "all" } = {}) {
  const byId = new Map((results?.runs || []).map((run) => [run.id, run]));
  const selectedSet = new Set(selected);
  const presenceMatches = (value, mode) => mode === "all" || (mode === "with" ? value : !value);
  const countMatches = (count, value, minimum) => {
    if (String(value).trim() === "") return true;
    const bound = Number(value);
    return Number.isInteger(bound) && bound >= 0 && (minimum ? count >= bound : count <= bound);
  };
  const shown = items.filter((item) => matchesSaved(item, query)
    && (status === "all" || testResultStatus(byId.get(item.id)) === status)
    && (type === "all" || Object.values(item.questions || {}).some((question) => question.type === type))
    && presenceMatches(Object.keys(item.expect || {}).length > 0, expectations)
    && presenceMatches(Object.keys(item.images || {}).length > 0, images)
    && presenceMatches(!!String(item.notes || "").trim(), notes)
    && (!String(questionId).trim() || Object.keys(item.questions || {}).some((id) => id.toLocaleLowerCase().includes(String(questionId).trim().toLocaleLowerCase())))
    && (coverage === "all" || testExpectationCoverage(item) === coverage)
    && (typeMix === "all" || (new Set(Object.values(item.questions || {}).map((q) => q.type)).size > 1 ? "mixed" : "single") === typeMix)
    && (stateType === "all" || (typeof item.state === "string" ? "text" : Array.isArray(item.state) ? "array" : "object") === stateType)
    && countMatches(Object.keys(item.questions || {}).length, minQuestions, true)
    && countMatches(Object.keys(item.questions || {}).length, maxQuestions, false)
    && (selection === "all" || selectedSet.has(item.id) === (selection === "selected")));
  // Array#sort is stable; ties retain the saved list's order.
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
  return shown;
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
