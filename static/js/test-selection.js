// Current-page saved-test selection and results. No persistence or model calls.
import { matchesSaved } from "./saved-search.js";

export function testResultStatus(result) {
  return !result ? "not-run" : result.error ? "error" : result.ok ? "pass" : "fail";
}

export function visibleTests(items, results, { query = "", status = "all", type = "all", sort = "saved", expectations = "all", images = "all", selection = "all", selected = [] } = {}) {
  const byId = new Map((results?.runs || []).map((run) => [run.id, run]));
  const selectedSet = new Set(selected);
  const presenceMatches = (value, mode) => mode === "all" || (mode === "with" ? value : !value);
  const shown = items.filter((item) => matchesSaved(item, query)
    && (status === "all" || testResultStatus(byId.get(item.id)) === status)
    && (type === "all" || Object.values(item.questions || {}).some((question) => question.type === type))
    && presenceMatches(Object.keys(item.expect || {}).length > 0, expectations)
    && presenceMatches(Object.keys(item.images || {}).length > 0, images)
    && (selection === "all" || selectedSet.has(item.id) === (selection === "selected")));
  // Array#sort is stable; ties retain the saved list's order.
  if (sort === "name") shown.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  if (sort === "questions") shown.sort((a, b) => Object.keys(b.questions || {}).length - Object.keys(a.questions || {}).length);
  if (sort === "name-desc") shown.sort((a, b) => (b.name || b.id).localeCompare(a.name || a.id));
  if (sort === "fewest-questions") shown.sort((a, b) => Object.keys(a.questions || {}).length - Object.keys(b.questions || {}).length);
  if (sort === "expectations") shown.sort((a, b) => Object.keys(b.expect || {}).length - Object.keys(a.expect || {}).length);
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
