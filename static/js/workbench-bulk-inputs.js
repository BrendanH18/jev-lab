// Shared Bulk and Compare inputs, available without loading either panel.
import { api, handleError } from "./common.js";
import { sampleUrl, toQuestions } from "./workbench-build.js";
import { W, canon } from "./workbench-state.js";

// One row as a line of the rows box, carrying `labels` if given. A text line that would split, lose
// whitespace, or parse as JSON is written as an object so it survives the trip (the server splits rows
// on "\n" and trims each line).
export function rowLineFor(row, labels = null) {
  const has = labels && Object.keys(labels).length;
  if (typeof row === "string") {
    const plain = row === row.trim() && !/^[{[]/.test(row) && !/[\n\r]/.test(row);
    if (!has && plain) return row;
    return JSON.stringify(has ? { text: row, _expect: labels } : { text: row });
  }
  return JSON.stringify(has ? { ...row, _expect: labels } : row);
}

// Rows as the rows box shows them: one per line, or a JSON array when a row is itself an array, since
// an array line would come back as text.
export function rowsText(rows) {
  if (rows.some(Array.isArray)) return `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
  return rows.map((r) => rowLineFor(r)).join("\n");
}

// Rows or labels that a reload would lose: the box differs from the last save or load, or labels were
// typed in the results table and not yet put in the rows.
export const bulkUnsaved = () => W.bulk.rowsText !== W.bulk.savedText || W.bulk.labelsDirty;

export function countRows(text) {
  const t = text.trim();
  if (t.startsWith("[")) {
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v)) return v.length;
    } catch {
      /* count lines */
    }
  }
  return text.split("\n").filter((l) => l.trim()).length;
}

// The rows box as the server takes it: a JSON array, or the text itself (one row per line).
export function rowsPayload(rows = W.bulk.rowsText) {
  if (/^\[/.test(rows.trim())) {
    try {
      return JSON.parse(rows);
    } catch {
      /* keep text */
    }
  }
  return rows;
}

export function bulkQuestions() {
  const b = W.bulk;
  if (b.source === "dataset" && b.dataset.questions) return b.dataset.questions;
  return b.source === "sample" ? b.sampleQuestions : toQuestions(W.questions);
}

// A row that is only {"text": ...} reads as its text; anything else shows as JSON. A test row's marker is not shown.
export function rowText(row) {
  if (row && typeof row === "object" && !Array.isArray(row) && "_test" in row) {
    const { _test, ...rest } = row;
    row = rest;
  }
  if (typeof row === "string") return row;
  if (
    row &&
    typeof row === "object" &&
    !Array.isArray(row) &&
    Object.keys(row).length === 1 &&
    typeof row.text === "string"
  )
    return row.text;
  return JSON.stringify(row);
}

// Image URLs for the pictures rows name: samples from static files, uploads fetched once.
export async function loadPictureUrls(results) {
  const b = W.bulk;
  const names = [...new Set(results.map((r) => r.row?._image).filter((n) => typeof n === "string" && !b.pictures[n]))];
  const files = names.filter((n) => !/^[a-z-]+$/.test(n));
  for (const n of names) if (/^[a-z-]+$/.test(n)) b.pictures[n] = sampleUrl(n);
  if (!files.length) return;
  try {
    const { pictures } = await api("/api/workbench/pictures/load", { names: files });
    for (const [n, x] of Object.entries(pictures))
      b.pictures[n] = `data:image/${x.format === "jpg" ? "jpeg" : "png"};base64,${x.data_base64}`;
  } catch (e) {
    handleError(e);
  }
}

// A health report describes the current rows and selected questions, never a prior Bulk run's answers.
export const healthContext = () => canon([W.bulk.rowsText, bulkQuestions(), W.bulk.labelsDirty, W.bulk.health.field]);

// A fit belongs to one run and its labels/questions. Never carry it into a newer run or edited inputs.
export function setFitContext() {
  const b = W.bulk;
  return JSON.stringify([b.labels, b.ranQuestions, bulkQuestions(), b.rowsText]);
}
export function syncAttachedSets() {
  const b = W.bulk;
  const s = b.sets;
  const context = setFitContext();
  if (s.result !== b.result || s.context !== context) {
    s.attached = {};
    s.result = b.result;
    s.context = context;
    s.fitted = null;
  }
}
