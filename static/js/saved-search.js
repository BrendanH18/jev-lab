// Search changes presentation only: it never drops labels or changes the scope of a paid run.
export function matchesSaved(item, query = "") {
  const text = [item.id, item.name, item.notes].filter(Boolean).join("\n").toLocaleLowerCase();
  return text.includes(String(query).trim().toLocaleLowerCase());
}

export function matchesDataset(item, { query = "", check = "all", labels = "all" } = {}) {
  if (!matchesSaved(item, query)) return false;
  if (check === "with" && !item.check || check === "without" && item.check) return false;
  const labeled = Number(item.labeled || 0), rows = Number(item.rows || 0);
  if (labels === "none") return labeled === 0;
  if (labels === "some") return labeled > 0 && labeled < rows;
  if (labels === "every") return rows > 0 && labeled === rows;
  return true;
}
