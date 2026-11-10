// Dataset-list metadata only. Filters never load rows, labels or model answers.
import { matchesDataset } from "./saved-search.js";

export const catalogDefaults = () => ({ query: "", check: "all", labels: "all", questions: "all", test: "all", guidelines: "all", sort: "saved" });

export function matchesCatalog(item, filters = {}) {
  if (!matchesDataset(item, filters)) return false;
  for (const [key, present] of [["questions", Number(item.questions || 0) > 0], ["test", !!item.test],
    ["guidelines", Number(item.guidelines || 0) > 0]]) {
    if (filters[key] === "with" && !present || filters[key] === "without" && present) return false;
  }
  return true;
}

export function sortedCatalog(items, sort = "saved") {
  const copy = [...items];
  if (sort === "name") copy.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
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
