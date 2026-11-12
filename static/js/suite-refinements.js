// Local saved-suite planning: authored counts and explicit selection only.
const authoredText = (value) => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);

export function suiteAuthoredMetrics(item) {
  const questions = item.questions || {};
  let criteria = 0, criteriaCharacters = 0, scoreLevels = 0;
  for (const question of Object.values(questions)) {
    const values = Array.isArray(question.criteria) ? question.criteria : Object.values(question.criteria || {});
    criteria += values.length;
    criteriaCharacters += values.reduce((sum, value) => sum + Array.from(authoredText(value)).length, 0);
    if (question.type === "score") scoreLevels += values.length;
  }
  return { criteria, criteriaCharacters, scoreLevels,
    orphanExpectations: Object.keys(item.expect || {}).filter((id) => !Object.hasOwn(questions, id)).length };
}

const metrics = [
  ["criteria", "minCriteria", "maxCriteria", "fewest-criteria", "most-criteria"],
  ["criteriaCharacters", "minCriteriaCharacters", "maxCriteriaCharacters", "shortest-criteria", "longest-criteria"],
  ["scoreLevels", "minScoreLevels", "maxScoreLevels", "fewest-score-levels", "most-score-levels"],
  ["orphanExpectations", "minOrphanExpectations", "maxOrphanExpectations", "fewest-orphans", "most-orphans"],
];

export function refineSuite(items, filters = {}) {
  const active = metrics.some(([, min, max, ascending, descending]) =>
    [min, max].some((key) => filters[key] != null && String(filters[key]).trim() !== "")
    || filters.sort === ascending || filters.sort === descending)
    || (filters.orphanExpectations && filters.orphanExpectations !== "all");
  if (!active) return items;
  const counts = new Map();
  const metric = (item) => {
    if (!counts.has(item)) counts.set(item, suiteAuthoredMetrics(item));
    return counts.get(item);
  };
  const boundMatches = (value, bound, minimum) => {
    if (bound == null || String(bound).trim() === "") return true;
    const number = Number(bound);
    return Number.isInteger(number) && number >= 0 && (minimum ? value >= number : value <= number);
  };
  const shown = items.filter((item) => metrics.every(([key, min, max]) => boundMatches(metric(item)[key], filters[min], true)
    && boundMatches(metric(item)[key], filters[max], false))
    && (!filters.orphanExpectations || filters.orphanExpectations === "all"
      || (metric(item).orphanExpectations > 0) === (filters.orphanExpectations === "with")));
  for (const [key, , , ascending, descending] of metrics) {
    if (filters.sort === ascending || filters.sort === descending) shown.sort((a, b) =>
      (filters.sort === ascending ? 1 : -1) * (metric(a)[key] - metric(b)[key]));
  }
  return shown;
}

// IDs, types and occurrence counts only. No authored instructions, inputs or label values.
export function suiteQuestionInventory(items) {
  const rows = new Map();
  for (const item of items) for (const [id, question] of Object.entries(item.questions || {})) {
    const row = rows.get(id) || { id, tests: 0, withExpectations: 0, types: new Set() };
    row.tests++;
    if (Object.hasOwn(item.expect || {}, id)) row.withExpectations++;
    row.types.add(question.type);
    rows.set(id, row);
  }
  return [...rows.values()].map((row) => ({ ...row, types: [...row.types].sort() }));
}

export function suiteInventoryText(items) {
  const rows = suiteQuestionInventory(items);
  const total = rows.reduce((sum, row) => sum + row.tests, 0);
  const covered = rows.reduce((sum, row) => sum + row.withExpectations, 0);
  return `${rows.length} distinct question IDs · ${total} question occurrences · ${covered} with authored expectations · ${rows.filter((row) => row.types.length > 1).length} IDs used with multiple types. Counts do not validate expectations.`;
}

export function previewSuiteIds(items, text) {
  const requested = [...new Set(String(text || "").split(/\r?\n/).map((id) => id.trim()).filter(Boolean))];
  const saved = new Set(items.map((item) => item.id));
  return { matched: items.filter((item) => requested.includes(item.id)).map((item) => item.id),
    unknown: requested.filter((id) => !saved.has(id)) };
}

export function applySuiteIds(items, selected, preview, mode = "add") {
  const known = new Set(preview.matched);
  const chosen = new Set(selected);
  if (mode === "remove") for (const id of known) chosen.delete(id);
  else for (const id of known) chosen.add(id);
  return items.filter((item) => chosen.has(item.id)).map((item) => item.id);
}

export function firstVisibleSuiteIds(items, selected, visible, count) {
  const number = Number(count);
  if (String(count).trim() === "" || !Number.isInteger(number) || number <= 0) return null;
  return applySuiteIds(items, selected, { matched: visible.slice(0, number).map((item) => item.id) });
}
