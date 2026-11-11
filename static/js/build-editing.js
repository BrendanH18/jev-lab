// Pure editor operations. These never fetch, persist, or carry model answers.

export function uniqueQuestionId(rows, preferred = "question") {
  const used = new Set(rows.map((row) => String(row.id || "").trim()));
  const base = String(preferred).trim() || "question";
  let id = base;
  for (let suffix = 2; used.has(id); suffix++) id = `${base}_${suffix}`;
  return id;
}

export function duplicateQuestionRow(row, rows) {
  return { ...JSON.parse(JSON.stringify(row)), id: uniqueQuestionId(rows, `${String(row.id || "question").trim()}_copy`) };
}

export function moveEditorEntry(entries, index, direction) {
  const next = index + direction;
  if (!Number.isInteger(index) || ![-1, 1].includes(direction) || index < 0 || index >= entries.length || next < 0 || next >= entries.length) return entries;
  const moved = entries.slice();
  [moved[index], moved[next]] = [moved[next], moved[index]];
  return moved;
}

export function removeEditorQuestion(rows, expect, index) {
  if (!rows[index]) return null;
  const row = rows[index], id = String(row.id || "").trim();
  const kept = rows.filter((_, i) => i !== index);
  const ownsExpectation = !kept.some((q) => String(q.id || "").trim() === id) && Object.hasOwn(expect, id);
  const expectations = { ...expect };
  if (ownsExpectation) delete expectations[id];
  return { rows: kept, expect: expectations, undo: { row, index, id, ownsExpectation,
    expectation: ownsExpectation ? JSON.parse(JSON.stringify(expect[id])) : undefined } };
}

export function restoreEditorQuestion(rows, expect, undo) {
  if (!undo) return null;
  if (undo.id && rows.some((row) => String(row.id || "").trim() === undo.id)) {
    throw new Error(`Cannot restore “${undo.id}”: another question now uses that id. Rename it first.`);
  }
  if (undo.ownsExpectation && Object.hasOwn(expect, undo.id)) {
    throw new Error(`Cannot restore “${undo.id}”: its expectations have changed. Keep the current expectations or restore the question manually.`);
  }
  const restored = rows.slice();
  restored.splice(Math.min(undo.index, restored.length), 0, undo.row);
  return { rows: restored, expect: undo.ownsExpectation ? { ...expect, [undo.id]: undo.expectation } : expect };
}

export function buildRequestSummary(stateText, rows, imageCount) {
  const counts = new Map();
  for (const row of rows) counts.set(row.type, (counts.get(row.type) || 0) + 1);
  const types = [...counts].map(([type, count]) => `${count} ${type}`).join(" · ");
  const bytes = new TextEncoder().encode(stateText).length;
  return `${rows.length} question${rows.length === 1 ? "" : "s"}${types ? ` (${types})` : ""} · ${bytes} state-text bytes · ${imageCount} image${imageCount === 1 ? "" : "s"}`;
}

// Filtering keeps the complete editor request intact, including hidden questions.
export function matchesEditorQuestion(row, { query = "", type = "all", instructions = "all", criteria = "all", expectations = "all", searchField = "all", exclude = "", minCriteria = "", maxCriteria = "" } = {}, expect = {}) {
  const hasInstructions = !!String(row.instructions || "").trim();
  const hasCriteria = row.type === "choice" ? (row.choice || []).some(([key]) => key.trim())
    : row.type === "score" ? (row.score || []).some((level) => level.trim())
    : row.type === "noul" ? [row.noulYes, row.noulNo].some((value) => String(value || "").trim()) : false;
  const hasExpectation = Object.hasOwn(expect || {}, String(row.id || "").trim());
  for (const [filter, present] of [[instructions, hasInstructions], [criteria, hasCriteria], [expectations, hasExpectation]]) {
    if ((filter === "with" && !present) || (filter === "without" && present)) return false;
  }
  if (type !== "all" && row.type !== type) return false;
  const fields = { id: [row.id], instructions: [row.instructions],
    criteria: row.type === "choice" ? (row.choice || []).flat() : row.type === "score" ? (row.score || [])
      : row.type === "noul" ? [row.noulYes, row.noulNo] : [] };
  const text = (fields[searchField] || Object.values(fields).flat())
    .filter((value) => value != null).join("\n").toLocaleLowerCase();
  if (!text.includes(String(query).trim().toLocaleLowerCase())) return false;
  if (String(exclude).trim() && text.includes(String(exclude).trim().toLocaleLowerCase())) return false;
  const count = editorCriterionCount(row);
  for (const [value, maximum] of [[minCriteria, false], [maxCriteria, true]]) {
    if (String(value).trim() === "") continue;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 0 || (maximum ? count > limit : count < limit)) return false;
  }
  return true;
}

export function moveEditorEntryTo(entries, index, target) {
  if (!Number.isInteger(index) || !Number.isInteger(target) || index < 0 || index >= entries.length
    || target < 0 || target >= entries.length || index === target) return entries;
  const moved = entries.slice();
  moved.splice(target, 0, moved.splice(index, 1)[0]);
  return moved;
}

// Rename is explicit so existing human expectations travel with their question.
export function renameEditorQuestion(rows, expect, index, requestedId) {
  const id = String(requestedId).trim(), row = rows[index];
  if (!row || !id) throw new Error("Give the question a nonempty id.");
  const previous = String(row.id || "").trim();
  if (rows.some((other, i) => i !== index && String(other.id || "").trim() === id)) {
    throw new Error(`Another question already uses “${id}”.`);
  }
  if (previous !== id && Object.hasOwn(expect, id)) throw new Error(`Expectations already exist for “${id}”. Keep or remove them before renaming.`);
  if (previous !== id && rows.some((other, i) => i !== index && String(other.id || "").trim() === previous)
      && Object.hasOwn(expect, previous)) throw new Error("Fix the repeated original id before moving its expectations.");
  const expectations = { ...expect };
  if (previous !== id && Object.hasOwn(expectations, previous)) {
    const value = expectations[previous];
    delete expectations[previous];
    Object.defineProperty(expectations, id, { value, enumerable: true, writable: true, configurable: true });
  }
  return { rows: rows.map((other, i) => i === index ? { ...other, id } : other), expect: expectations };
}

export function duplicateChoiceOption(options, index) {
  if (!options[index]) return options;
  const [key, description] = options[index];
  const used = new Set(options.map(([value]) => value.trim()));
  const base = `${key.trim() || "option"}_copy`;
  let copy = base;
  for (let n = 2; used.has(copy); n++) copy = `${base}_${n}`;
  const result = options.slice();
  result.splice(index + 1, 0, [copy, description]);
  return result;
}

// Insert fresh criteria rather than copying a neighboring label or changing its key.
export function insertEditorCriterion(entries, index, after, type) {
  if (!["choice", "score"].includes(type) || !Number.isInteger(index) || index < 0 || index >= entries.length) return entries;
  const result = entries.slice();
  result.splice(index + Number(after), 0, type === "choice" ? ["", ""] : "");
  return result;
}

export function duplicateShownQuestions(rows, shown) {
  const selected = new Set(shown), result = [];
  const used = rows.slice();
  for (const row of rows) {
    result.push(row);
    if (selected.has(row)) {
      const copy = duplicateQuestionRow(row, used);
      used.push(copy);
      result.push(copy);
    }
  }
  return result;
}

// Counts describe authored criteria, never model answers or evaluation readiness.
export function editorCriterionCount(row) {
  if (row.type === "choice") return (row.choice || []).filter(([key]) => String(key).trim()).length;
  if (row.type === "score") return (row.score || []).filter((level) => String(level).trim()).length;
  if (row.type === "noul") return [row.noulYes, row.noulNo].filter((value) => String(value || "").trim()).length;
  return 0;
}

export function editorQuestionOutline(rows) {
  // JSON strings keep tabs/newlines in an id from becoming extra outline columns.
  return ["position\tid\ttype\tcriteria\tinstruction_characters", ...rows.map((row, index) =>
    [index + 1, JSON.stringify(String(row.id || "")), row.type, editorCriterionCount(row),
      Array.from(String(row.instructions || "")).length].join("\t"))].join("\n") + "\n";
}

export function reorderEditorCriteria(row, action) {
  if (row.type === "choice" && action === "sort") {
    return { ...row, choice: row.choice.slice().sort((a, b) => a[0].trim().localeCompare(b[0].trim())) };
  }
  if (row.type === "score" && action === "reverse") return { ...row, score: row.score.slice().reverse() };
  return row;
}
