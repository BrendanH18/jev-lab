// Local authoring diagnostics and handoffs: authored questions only, never answers or state.
const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase();
const characters = (value) => Array.from(String(value ?? "")).length;

export function editorAuthoringFacts(row) {
  const instruction = String(row.instructions || "");
  let structured = false;
  try { const value = JSON.parse(instruction); structured = value !== null && typeof value === "object"; } catch { /* ordinary text */ }
  const choice = row.type === "choice" ? row.choice || [] : [];
  const keys = choice.map(([key]) => String(key).trim()).filter(Boolean);
  return {
    idCharacters: characters(String(row.id || "").trim()),
    instructionLines: instruction ? instruction.split(/\r\n|\r|\n/).length : 0,
    structured,
    placeholders: row.type === "choice" ? choice.some(([key, description]) => !String(key).trim() && !String(description).trim())
      : row.type === "score" ? (row.score || []).some((level) => !String(level).trim()) : false,
    unnamedChoice: choice.some(([key, description]) => !String(key).trim() && !!String(description).trim()),
    duplicateKeys: new Set(keys).size !== keys.length,
    references: /`[^`]+`/.test(instruction),
  };
}

export function matchesAdvancedEditorQuestion(row, filters = {}, rows = []) {
  const id = normalized(row.id), facts = editorAuthoringFacts(row);
  if (!id.endsWith(normalized(filters.idSuffix))) return false;
  if (normalized(filters.idExact) && id !== normalized(filters.idExact)) return false;
  for (const [field, value, maximum] of [["minIdCharacters", facts.idCharacters, false], ["maxIdCharacters", facts.idCharacters, true],
    ["minInstructionLines", facts.instructionLines, false], ["maxInstructionLines", facts.instructionLines, true]]) {
    if (String(filters[field] ?? "").trim() === "") continue;
    const limit = Number(filters[field]);
    if (!Number.isInteger(limit) || limit < 0 || (maximum ? value > limit : value < limit)) return false;
  }
  if (filters.instructionFormat === "structured" && !facts.structured) return false;
  if (filters.instructionFormat === "text" && facts.structured) return false;
  const duplicateFilter = ["with", "without"].includes(filters.duplicateIds);
  const trimmedId = String(row.id || "").trim();
  const duplicateIds = duplicateFilter && !!trimmedId && (filters.idCounts
    ? (filters.idCounts.get(trimmedId) || 0) > 1
    : rows.filter((other) => String(other.id || "").trim() === trimmedId).length > 1);
  for (const [field, present] of [["placeholders", facts.placeholders], ["unnamedChoice", facts.unnamedChoice],
    ["duplicateKeys", facts.duplicateKeys], ["duplicateIds", duplicateIds], ["references", facts.references]]) {
    if (filters[field] === "with" && !present || filters[field] === "without" && present) return false;
  }
  return true;
}

export function editorAuthoringSummary(rows) {
  const counts = Object.fromEntries(["noul", "choice", "score", "box"].map((type) => [type, rows.filter((row) => row.type === type).length]));
  const text = rows.map((row) => [row.id, row.instructions, ...(row.type === "choice" ? (row.choice || []).flat()
    : row.type === "score" ? row.score || [] : row.type === "noul" ? [row.noulYes, row.noulNo] : [])].map((value) => String(value ?? "")).join("" )).join("");
  return { counts, bytes: new TextEncoder().encode(text).length };
}

export function editorOutlineCsv(rows) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const count = (row) => row.type === "choice" ? (row.choice || []).filter(([key]) => String(key).trim()).length
    : row.type === "score" ? (row.score || []).filter((level) => String(level).trim()).length
      : row.type === "noul" ? [row.noulYes, row.noulNo].filter((value) => String(value || "").trim()).length : 0;
  return [["position", "id", "type", "criteria", "instruction_characters"], ...rows.map((row, index) =>
    [index + 1, row.id, row.type, count(row), characters(row.instructions)])].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function shownQuestionIndex(rows, shown, currentIndex, direction) {
  const selected = new Set(shown), indices = rows.flatMap((row, index) => selected.has(row) ? [index] : []);
  if (direction === "first") return indices[0] ?? -1;
  if (direction === "last") return indices.at(-1) ?? -1;
  return direction === "previous" ? indices.filter((index) => index < currentIndex).at(-1) ?? -1
    : indices.find((index) => index > currentIndex) ?? -1;
}
