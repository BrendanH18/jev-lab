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
export function matchesEditorQuestion(row, { query = "", type = "all" } = {}) {
  if (type !== "all" && row.type !== type) return false;
  const text = [row.id, row.instructions, ...(row.choice || []).flat(), ...(row.score || []), row.noulYes, row.noulNo]
    .filter((value) => value != null).join("\n").toLocaleLowerCase();
  return text.includes(String(query).trim().toLocaleLowerCase());
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
