// Dataset-list metadata only. Filters never load rows, labels or model answers.
import { matchesDataset, matchesSaved } from "./saved-search.js";

export const catalogDefaults = () => ({ query: "", check: "all", labels: "all", questions: "all", test: "all", guidelines: "all", sort: "saved", minRows: "", maxRows: "", minLabeled: "", minUnlabeled: "", minQuestions: "", savedAfter: "", savedBefore: "", minLabelShare: "", maxLabelShare: "", pinned: "all", pinnedIds: [], searchField: "all", exclude: "", notes: "all", maxQuestions: "", maxUnlabeled: "", minHeldOut: "", maxLabeled: "", maxHeldOut: "", minGuidelines: "", maxGuidelines: "" });

export function matchesCatalog(item, filters = {}) {
  const searchField = filters.searchField || "all";
  const scoped = searchField === "all" ? item : { [searchField]: item[searchField] };
  if (!matchesDataset(item, { ...filters, query: "" }) || !matchesSaved(scoped, filters.query)) return false;
  if (String(filters.exclude || "").trim() && matchesSaved(scoped, filters.exclude)) return false;
  const hasNotes = !!String(item.notes || "").trim();
  if (filters.notes === "with" && !hasNotes || filters.notes === "without" && hasNotes) return false;
  if (filters.pinned === "with" && !filters.pinnedIds?.includes(item.id)) return false;
  if (filters.pinned === "without" && filters.pinnedIds?.includes(item.id)) return false;
  const saved = String(item.saved_at || "").slice(0, 10);
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
    maxGuidelines: [Number(item.guidelines || 0), true] };
  for (const [key, [count, maximum]] of Object.entries(counts)) {
    if (filters[key] === undefined || String(filters[key]).trim() === "") continue;
    const limit = Number(filters[key]);
    if (!Number.isInteger(limit) || limit < 0 || (maximum ? count > limit : count < limit)) return false;
  }
  return true;
}

export function sortedCatalog(items, sort = "saved", pinnedIds = []) {
  const copy = [...items];
  if (sort === "pinned") copy.sort((a, b) => Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)));
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
