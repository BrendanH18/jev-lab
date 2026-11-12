// Dataset-list metadata only. Filters never load rows, labels or model answers.
import { matchesDataset, matchesSaved } from "./saved-search.js";

export const catalogDefaults = () => ({ query: "", check: "all", labels: "all", questions: "all", test: "all", guidelines: "all", sort: "saved", minRows: "", maxRows: "", minLabeled: "", minUnlabeled: "", minQuestions: "", savedAfter: "", savedBefore: "", minLabelShare: "", maxLabelShare: "", pinned: "all", pinnedIds: [], searchField: "all", exclude: "", notes: "all", maxQuestions: "", maxUnlabeled: "", minHeldOut: "", maxLabeled: "", maxHeldOut: "", minGuidelines: "", maxGuidelines: "", minTuning: "", maxTuning: "", minLooks: "", maxLooks: "", timestamp: "all",
  idPrefix: "", searchMode: "phrase", minHeldOutShare: "", maxHeldOutShare: "", minGuidelineShare: "", maxGuidelineShare: "",
  minTuningLabeled: "", maxTuningLabeled: "", minHeldOutLabeled: "", maxHeldOutLabeled: "", minUnguided: "", maxUnguided: "",
  tuningLabels: "all", heldOutLabels: "all", minTuningUnlabeled: "", maxTuningUnlabeled: "", minHeldOutUnlabeled: "", maxHeldOutUnlabeled: "",
  minTuningLabelShare: "", maxTuningLabelShare: "", minHeldOutLabelShare: "", maxHeldOutLabelShare: "",
  idSuffix: "", namePrefix: "", nameSuffix: "" });

// Split progress is human-label metadata. A row with a label may still need validation.
export function catalogSplitProgress(item) {
  const metrics = catalogMetrics(item), heldOut = Number(item.test?.rows || 0);
  return { tuningUnlabeled: Math.max(0, metrics.tuning - metrics.tuningLabeled),
    heldOutUnlabeled: Math.max(0, heldOut - metrics.heldOutLabeled),
    tuningLabelShare: metrics.tuning ? 100 * metrics.tuningLabeled / metrics.tuning : null,
    heldOutLabelShare: heldOut ? 100 * metrics.heldOutLabeled / heldOut : null };
}

// Counts describe saved human labeling progress, never label validity or model performance.
export function catalogMetrics(item) {
  const rows = Number(item.rows || 0), heldOut = Number(item.test?.rows || 0), questions = Number(item.questions || 0);
  const heldOutLabeled = Number(item.test?.labeled || 0), tuning = Math.max(0, rows - heldOut);
  return { tuning, heldOutLabeled, tuningLabeled: Math.max(0, Number(item.labeled || 0) - heldOutLabeled),
    heldOutShare: rows > 0 ? 100 * heldOut / rows : null,
    guidelineShare: questions > 0 ? 100 * Number(item.guidelines || 0) / questions : null,
    unguided: Math.max(0, questions - Number(item.guidelines || 0)) };
}

function matchesCatalogQuery(item, query, mode) {
  if (mode === "exact-field") {
    const target = String(query || "").trim().toLocaleLowerCase();
    return !target || [item.id, item.name, item.notes].some((value) => String(value || "").trim().toLocaleLowerCase() === target);
  }
  const words = String(query || "").trim().split(/\s+/).filter(Boolean);
  if (mode === "all-words") return words.every((word) => matchesSaved(item, word));
  if (mode === "any-word") return !words.length || words.some((word) => matchesSaved(item, word));
  return matchesSaved(item, query);
}

function matchesLabelProgress(mode, labeled, rows) {
  return mode === "none" ? rows > 0 && labeled === 0 : mode === "some" ? labeled > 0 && labeled < rows
    : mode === "every" ? rows > 0 && labeled === rows : true;
}

export function matchesCatalog(item, filters = {}) {
  const searchField = filters.searchField || "all";
  const scoped = searchField === "all" ? item : { [searchField]: item[searchField] };
  if (!matchesDataset(item, { ...filters, query: "" }) || !matchesCatalogQuery(scoped, filters.query, filters.searchMode)) return false;
  if (String(filters.exclude || "").trim() && matchesSaved(scoped, filters.exclude)) return false;
  if (!String(item.id || "").toLocaleLowerCase().startsWith(String(filters.idPrefix || "").trim().toLocaleLowerCase())) return false;
  const normalized = (value) => String(value || "").trim().toLocaleLowerCase();
  if (!normalized(item.id).endsWith(normalized(filters.idSuffix))
    || !normalized(item.name || item.id).startsWith(normalized(filters.namePrefix))
    || !normalized(item.name || item.id).endsWith(normalized(filters.nameSuffix))) return false;
  const metrics = catalogMetrics(item);
  const progress = catalogSplitProgress(item);
  if (!matchesLabelProgress(filters.tuningLabels, metrics.tuningLabeled, metrics.tuning)
    || !matchesLabelProgress(filters.heldOutLabels, metrics.heldOutLabeled, Number(item.test?.rows || 0))) return false;
  const hasNotes = !!String(item.notes || "").trim();
  if (filters.notes === "with" && !hasNotes || filters.notes === "without" && hasNotes) return false;
  if (filters.pinned === "with" && !filters.pinnedIds?.includes(item.id)) return false;
  if (filters.pinned === "without" && filters.pinnedIds?.includes(item.id)) return false;
  const saved = String(item.saved_at || "").slice(0, 10);
  if (filters.timestamp === "with" && !saved || filters.timestamp === "without" && saved) return false;
  for (const key of ["savedAfter", "savedBefore"]) {
    const value = filters[key];
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !saved || (key === "savedAfter" ? saved < value : saved > value)) return false;
  }
  const share = Number(item.rows || 0) > 0 ? 100 * Number(item.labeled || 0) / Number(item.rows) : null;
  for (const key of ["minLabelShare", "maxLabelShare"]) {
    if (filters[key] === undefined || String(filters[key]).trim() === "") continue;
    const value = Number(filters[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100 || share === null
      || (key === "minLabelShare" ? share < value : share > value)) return false;
  }
  for (const [key, share, maximum] of [["minHeldOutShare", metrics.heldOutShare, false], ["maxHeldOutShare", metrics.heldOutShare, true],
    ["minGuidelineShare", metrics.guidelineShare, false], ["maxGuidelineShare", metrics.guidelineShare, true],
    ["minTuningLabelShare", progress.tuningLabelShare, false], ["maxTuningLabelShare", progress.tuningLabelShare, true],
    ["minHeldOutLabelShare", progress.heldOutLabelShare, false], ["maxHeldOutLabelShare", progress.heldOutLabelShare, true]]) {
    if (filters[key] === undefined || String(filters[key]).trim() === "") continue;
    const limit = Number(filters[key]);
    if (!Number.isFinite(limit) || limit < 0 || limit > 100 || share === null || (maximum ? share > limit : share < limit)) return false;
  }
  for (const [key, present] of [["questions", Number(item.questions || 0) > 0], ["test", !!item.test],
    ["guidelines", Number(item.guidelines || 0) > 0]]) {
    if (filters[key] === "with" && !present || filters[key] === "without" && present) return false;
  }
  const counts = { minRows: [Number(item.rows || 0), false], maxRows: [Number(item.rows || 0), true],
    minLabeled: [Number(item.labeled || 0), false],
    minUnlabeled: [Math.max(0, Number(item.rows || 0) - Number(item.labeled || 0)), false],
    minQuestions: [Number(item.questions || 0), false], maxQuestions: [Number(item.questions || 0), true],
    maxUnlabeled: [Math.max(0, Number(item.rows || 0) - Number(item.labeled || 0)), true],
    minHeldOut: [Number(item.test?.rows || 0), false], maxHeldOut: [Number(item.test?.rows || 0), true],
    maxLabeled: [Number(item.labeled || 0), true], minGuidelines: [Number(item.guidelines || 0), false],
    maxGuidelines: [Number(item.guidelines || 0), true],
    minTuning: [Math.max(0, Number(item.rows || 0) - Number(item.test?.rows || 0)), false],
    maxTuning: [Math.max(0, Number(item.rows || 0) - Number(item.test?.rows || 0)), true],
    minLooks: [Number(item.test?.looks || 0), false], maxLooks: [Number(item.test?.looks || 0), true],
    minTuningLabeled: [metrics.tuningLabeled, false], maxTuningLabeled: [metrics.tuningLabeled, true],
    minHeldOutLabeled: [metrics.heldOutLabeled, false], maxHeldOutLabeled: [metrics.heldOutLabeled, true],
    minUnguided: [metrics.unguided, false], maxUnguided: [metrics.unguided, true],
    minTuningUnlabeled: [progress.tuningUnlabeled, false], maxTuningUnlabeled: [progress.tuningUnlabeled, true],
    minHeldOutUnlabeled: [progress.heldOutUnlabeled, false], maxHeldOutUnlabeled: [progress.heldOutUnlabeled, true] };
  for (const [key, [count, maximum]] of Object.entries(counts)) {
    if (filters[key] === undefined || String(filters[key]).trim() === "") continue;
    const limit = Number(filters[key]);
    if (!Number.isInteger(limit) || limit < 0 || (maximum ? count > limit : count < limit)) return false;
  }
  return true;
}

export function sortedCatalog(items, sort = "saved", pinnedIds = []) {
  const copy = [...items];
  const metricSorts = { looks: [(item) => Number(item.test?.looks || 0), true], "looks-asc": [(item) => Number(item.test?.looks || 0), false],
    "tuning-labeled": [(item) => catalogMetrics(item).tuningLabeled, true], "tuning-labeled-asc": [(item) => catalogMetrics(item).tuningLabeled, false],
    "held-out-share": [(item) => catalogMetrics(item).heldOutShare, true], "held-out-share-asc": [(item) => catalogMetrics(item).heldOutShare, false],
    "guideline-share": [(item) => catalogMetrics(item).guidelineShare, true], "guideline-share-asc": [(item) => catalogMetrics(item).guidelineShare, false] };
  for (const [name, key] of [["tuning-unlabeled", "tuningUnlabeled"], ["held-out-unlabeled", "heldOutUnlabeled"],
    ["tuning-label-share", "tuningLabelShare"], ["held-out-label-share", "heldOutLabelShare"]]) {
    metricSorts[name] = [(item) => catalogSplitProgress(item)[key], true];
    metricSorts[`${name}-asc`] = [(item) => catalogSplitProgress(item)[key], false];
  }
  if (metricSorts[sort]) {
    const [value, descending] = metricSorts[sort];
    copy.sort((a, b) => {
      const left = value(a), right = value(b);
      if (left === null || right === null) return Number(left === null) - Number(right === null);
      return descending ? right - left : left - right;
    });
  }
  else if (sort === "pinned") copy.sort((a, b) => Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)));
  else if (sort === "label-share-desc") copy.sort((a, b) => {
    const share = (item) => Number(item.rows || 0) > 0 ? Number(item.labeled || 0) / Number(item.rows) : -Infinity;
    return share(b) - share(a);
  });
  else if (sort === "newest" || sort === "oldest") copy.sort((a, b) => {
    // Unknown timestamps always follow dated datasets.
    const left = String(a.saved_at || ""), right = String(b.saved_at || "");
    if (!left || !right) return Number(!left) - Number(!right);
    return sort === "newest" ? right.localeCompare(left) : left.localeCompare(right);
  });
  else if (sort === "label-share") copy.sort((a, b) => {
    const share = (item) => Number(item.rows || 0) > 0 ? Number(item.labeled || 0) / Number(item.rows) : Infinity;
    return share(a) - share(b);
  });
  else if (sort === "name") copy.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  else if (sort === "name-desc") copy.sort((a, b) => String(b.name || b.id).localeCompare(String(a.name || a.id)));
  else if (sort === "rows-asc") copy.sort((a, b) => Number(a.rows || 0) - Number(b.rows || 0));
  else if (sort === "unlabeled") copy.sort((a, b) => Math.max(0, Number(b.rows || 0) - Number(b.labeled || 0)) - Math.max(0, Number(a.rows || 0) - Number(a.labeled || 0)));
  else if (sort === "labeled-asc") copy.sort((a, b) => Number(a.labeled || 0) - Number(b.labeled || 0));
  else if (sort === "unlabeled-asc") copy.sort((a, b) => Math.max(0, Number(a.rows || 0) - Number(a.labeled || 0)) - Math.max(0, Number(b.rows || 0) - Number(b.labeled || 0)));
  else if (sort === "questions-asc") copy.sort((a, b) => Number(a.questions || 0) - Number(b.questions || 0));
  else if (sort === "held-out-asc") copy.sort((a, b) => Number(a.test?.rows || 0) - Number(b.test?.rows || 0));
  else if (sort === "guidelines-asc") copy.sort((a, b) => Number(a.guidelines || 0) - Number(b.guidelines || 0));
  else if (sort === "tuning" || sort === "tuning-asc") copy.sort((a, b) => {
    const count = (item) => Math.max(0, Number(item.rows || 0) - Number(item.test?.rows || 0));
    return sort === "tuning" ? count(b) - count(a) : count(a) - count(b);
  });
  else if (sort === "guidelines") copy.sort((a, b) => Number(b.guidelines || 0) - Number(a.guidelines || 0));
  else if (sort === "questions") copy.sort((a, b) => Number(b.questions || 0) - Number(a.questions || 0));
  else if (sort === "held-out") copy.sort((a, b) => Number(b.test?.rows || 0) - Number(a.test?.rows || 0));
  else if (sort === "rows" || sort === "labeled") copy.sort((a, b) => Number(b[sort] || 0) - Number(a[sort] || 0));
  return copy;
}

export function catalogTotals(items) {
  return items.reduce((total, item) => ({ datasets: total.datasets + 1,
    rows: total.rows + Number(item.rows || 0), labeled: total.labeled + Number(item.labeled || 0),
    heldOut: total.heldOut + Number(item.test?.rows || 0), checks: total.checks + Number(!!item.check) }),
  { datasets: 0, rows: 0, labeled: 0, heldOut: 0, checks: 0 });
}

export function catalogSummary(items) {
  const totals = catalogTotals(items);
  return `${totals.rows} rows · ${totals.labeled} with labels · ${totals.heldOut} held out · ${totals.checks} saved checks in the shown datasets`;
}

export function catalogCsv(items) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const fields = ["id", "name", "rows", "labeled_rows", "questions", "held_out_rows", "saved_check", "guideline_questions", "saved_at"];
  const rows = items.map((item) => [item.id, item.name || item.id, item.rows || 0, item.labeled || 0,
    item.questions || 0, item.test?.rows || 0, item.check ? "yes" : "no", item.guidelines || 0, item.saved_at || ""]);
  return [fields, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function datasetCopyName(name, items) {
  const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  // Leave room for the suffix so long source names cannot collide after slug truncation.
  const shortened = String(name || "Dataset").trim().slice(0, 40);
  const base = slug(shortened) ? shortened : "Dataset";
  const used = new Set(items.map((item) => item.id));
  for (let n = 1; ; n++) {
    const candidate = `${base} copy${n === 1 ? "" : ` ${n}`}`;
    if (!used.has(slug(candidate))) return candidate;
  }
}

export function canCopyDataset(dataset) {
  // A new file would lose the original held-out evaluation history. Use a bundle for that.
  return !dataset.test && !(Array.isArray(dataset.rows) && dataset.rows.some((row) => row?._test === true));
}

export function matchesDeletedDataset(item, query = "") {
  return `${item.id}\n${item.name || ""}`.toLocaleLowerCase().includes(String(query).trim().toLocaleLowerCase());
}

// Catalog downloads deliberately exclude notes, input data, label values and check configuration.
export function catalogJson(items) {
  return JSON.stringify(items.map((item) => ({ id: item.id, name: item.name || item.id,
    rows: item.rows || 0, labeled_rows: item.labeled || 0, questions: item.questions || 0,
    held_out_rows: item.test?.rows || 0, saved_check: !!item.check,
    guideline_questions: item.guidelines || 0, saved_at: item.saved_at || "" })), null, 2) + "\n";
}

export function catalogPreset(name) {
  const defaults = catalogDefaults();
  if (name === "unscored") return { ...defaults, test: "with", maxLooks: "0" };
  if (name === "evaluated") return { ...defaults, test: "with", minLooks: "1" };
  if (name === "label") return { ...defaults, labels: "some", sort: "label-share" };
  if (name === "unlabeled") return { ...defaults, labels: "none", sort: "rows" };
  if (name === "check") return { ...defaults, questions: "with", labels: "every", check: "without" };
  return defaults;
}

// Counts are metadata only: any saved label counts, regardless of validity or completeness.
export function catalogProgress(item) {
  const rows = Number(item.rows || 0), labeled = Number(item.labeled || 0);
  return `${Math.max(0, rows - labeled)} rows without labels · ${rows ? `${Math.round(100 * labeled / rows)}% of rows have a label` : "label share unavailable"}`;
}

export function catalogIds(items) {
  return items.map((item) => String(item.id)).join("\n");
}

// Pin actions are session-only and operate on the explicitly shown set, retaining hidden pins.
export function updateCatalogPins(items, pinnedIds, shownIds, pin = true) {
  const current = new Set(pinnedIds), shown = new Set(shownIds);
  for (const item of items) if (shown.has(item.id)) {
    if (pin) current.add(item.id); else current.delete(item.id);
  }
  const saved = new Set(items.map((item) => item.id));
  return [...current].filter((id) => saved.has(id));
}

export function pinnedCatalog(items, sort, pinnedIds) {
  return sortedCatalog(items, sort, pinnedIds).filter((item) => pinnedIds.includes(item.id));
}

export function invertCatalogPins(items, pinnedIds, shownIds) {
  const next = new Set(pinnedIds), shown = new Set(shownIds), saved = new Set(items.map((item) => item.id));
  for (const item of items) if (shown.has(item.id)) {
    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
  }
  return [...next].filter((id) => saved.has(id));
}

// Presentation settings do not belong in the filter count. Pins are independent session state.
export function catalogActiveFilters(filters) {
  const defaults = catalogDefaults();
  const labels = { query: "Search", exclude: "Exclude phrase", check: "Saved check", labels: "Row labels", questions: "Saved questions",
    test: "Held-out split", guidelines: "Guidelines", pinned: "Pins", notes: "Notes", timestamp: "Saved timestamp",
    searchField: "Search field", searchMode: "Search matching", idPrefix: "ID prefix", idSuffix: "ID suffix",
    namePrefix: "Name prefix", nameSuffix: "Name suffix", tuningLabels: "Tuning labels", heldOutLabels: "Held-out labels",
    minTuningUnlabeled: "Minimum tuning rows without labels", maxTuningUnlabeled: "Maximum tuning rows without labels",
    minHeldOutUnlabeled: "Minimum held-out rows without labels", maxHeldOutUnlabeled: "Maximum held-out rows without labels",
    minTuningLabelShare: "Minimum tuning labeled share (%)", maxTuningLabelShare: "Maximum tuning labeled share (%)",
    minHeldOutLabelShare: "Minimum held-out labeled share (%)", maxHeldOutLabelShare: "Maximum held-out labeled share (%)" };
  return Object.entries(defaults).filter(([key, value]) => key !== "sort" && key !== "pinnedIds"
    && filters[key] !== undefined && filters[key] !== value && String(filters[key]).trim() !== "")
    .map(([key]) => ({ key, label: labels[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), value: String(filters[key]) }));
}

export function catalogFilterSummary(filters) {
  const active = catalogActiveFilters(filters);
  return active.length ? active.map(({ label, value }) => `${label}: ${value}`).join(" · ") : "No dataset filters active";
}

export function catalogDetailsSummary(items) {
  const total = items.reduce((sum, item) => {
    const metrics = catalogMetrics(item);
    return { tuning: sum.tuning + metrics.tuning, tuningLabeled: sum.tuningLabeled + metrics.tuningLabeled,
      heldOutLabeled: sum.heldOutLabeled + metrics.heldOutLabeled, questions: sum.questions + Number(item.questions || 0),
      guidelines: sum.guidelines + Number(item.guidelines || 0), unguided: sum.unguided + metrics.unguided,
      looks: sum.looks + Number(item.test?.looks || 0) };
  }, { tuning: 0, tuningLabeled: 0, heldOutLabeled: 0, questions: 0, guidelines: 0, unguided: 0, looks: 0 });
  return `${total.tuning} tuning rows (${total.tuningLabeled} with labels) · ${total.heldOutLabeled} held-out rows with labels · `
    + `${total.questions} questions (${total.guidelines} with guidelines, ${total.unguided} without) · ${total.looks} recorded test evaluations`;
}
