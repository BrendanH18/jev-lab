// Authored-content diagnostics and explicit, reversible whitespace cleanup. No calls or storage.
import { editorQuestionError } from "./build-request.js";

const text = (value) => String(value ?? "");
const characters = (value) => Array.from(text(value)).length;
const edgeSpace = (value) => text(value) !== text(value).trim();
const descriptions = (row) => row.type === "choice" ? (row.choice || []).map(([, value]) => text(value))
  : row.type === "score" ? (row.score || []).map(text) : row.type === "noul" ? [text(row.noulYes), text(row.noulNo)] : [];

export const refinementFlags = [
  ["missingDescriptions", "Choice options without descriptions"],
  ["repeatedDescriptions", "Repeated Choice descriptions"],
  ["idWhitespace", "ID edge whitespace"],
  ["instructionWhitespace", "Instruction edge whitespace"],
  ["keyWhitespace", "Choice key edge whitespace"],
  ["criterionWhitespace", "Criterion edge whitespace"],
  ["multilineCriteria", "Multiline criteria"],
  ["nonAsciiId", "Non-ASCII IDs"],
  ["controlCharacters", "Unexpected control characters"],
  ["todoMarkers", "TODO or FIXME markers"],
  ["blankInstructions", "Whitespace-only instructions"],
];

export function buildRefinementFacts(row) {
  const instruction = text(row.instructions), criteria = descriptions(row);
  const choice = row.type === "choice" ? row.choice || [] : [];
  const defined = choice.filter(([key]) => text(key).trim());
  const values = defined.map(([, value]) => text(value).trim()).filter(Boolean);
  const authored = [text(row.id), instruction, ...criteria, ...choice.map(([key]) => text(key))];
  return {
    instructionWords: instruction.trim() ? instruction.trim().split(/\s+/u).length : 0,
    criterionCharacters: criteria.reduce((sum, value) => sum + characters(value), 0),
    missingDescriptions: defined.some(([, value]) => !text(value).trim()),
    repeatedDescriptions: new Set(values).size < values.length,
    idWhitespace: edgeSpace(row.id), instructionWhitespace: edgeSpace(instruction),
    keyWhitespace: choice.some(([key]) => edgeSpace(key)),
    criterionWhitespace: criteria.some(edgeSpace),
    multilineCriteria: criteria.some((value) => /[\r\n]/.test(value)),
    nonAsciiId: /[^\x00-\x7f]/.test(text(row.id)),
    controlCharacters: authored.some((value) => /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)),
    todoMarkers: authored.some((value) => /\b(?:TODO|FIXME)\b/i.test(value)),
    blankInstructions: instruction.length > 0 && !instruction.trim(),
  };
}

export function matchesBuildRefinements(row, filters = {}) {
  const facts = buildRefinementFacts(row);
  for (const [field, value, maximum] of [["minInstructionWords", facts.instructionWords, false],
    ["maxInstructionWords", facts.instructionWords, true], ["minCriterionCharacters", facts.criterionCharacters, false],
    ["maxCriterionCharacters", facts.criterionCharacters, true]]) {
    if (text(filters[field]).trim() === "") continue;
    const bound = Number(filters[field]);
    if (!Number.isInteger(bound) || bound < 0 || (maximum ? value > bound : value < bound)) return false;
  }
  return refinementFlags.every(([field]) => filters[field] !== "with" && filters[field] !== "without"
    || facts[field] === (filters[field] === "with"));
}

export const cleanupActions = [
  ["ids", "Trim question IDs"], ["instructions", "Trim instructions"], ["keys", "Trim Choice keys"],
  ["criteria", "Trim active criterion descriptions"], ["instruction-newlines", "Normalize instruction newlines"],
  ["criterion-newlines", "Normalize criterion newlines"],
];

function cleanupRow(row, action) {
  const clean = action.endsWith("newlines") ? (value) => text(value).replace(/\r\n?|\n/g, "\n") : (value) => text(value).trim();
  if (action === "ids") return { ...row, id: clean(row.id) };
  if (action === "instructions" || action === "instruction-newlines") return { ...row, instructions: clean(row.instructions) };
  if (action === "keys") return row.type === "choice" ? { ...row, choice: row.choice.map(([key, value]) => [clean(key), value]) } : row;
  if (row.type === "choice") return { ...row, choice: row.choice.map(([key, value]) => [key, clean(value)]) };
  if (row.type === "score") return { ...row, score: row.score.map(clean) };
  if (row.type === "noul") return { ...row, noulYes: clean(row.noulYes), noulNo: clean(row.noulNo) };
  return row;
}

export const buildCleanupSnapshot = (rows, expect) => JSON.stringify([rows, expect]);

export function prepareBuildCleanup(rows, expect, shown, action) {
  if (!cleanupActions.some(([value]) => value === action)) throw new Error("Choose a cleanup action.");
  if (!shown.length) throw new Error("No questions are shown.");
  const selected = new Set(shown);
  const next = rows.map((row) => selected.has(row) ? cleanupRow(row, action) : row);
  const error = editorQuestionError(next);
  if (error) throw new Error(`Fix question IDs and Choice keys before cleanup: ${error}`);
  const changes = rows.flatMap((row, index) => JSON.stringify(row) !== JSON.stringify(next[index])
    ? [{ position: index + 1, id: text(row.id), type: row.type }] : []);
  return { action, before: buildCleanupSnapshot(rows, expect), rows: JSON.parse(JSON.stringify(next)), changes };
}

export function applyBuildCleanup(rows, expect, preview) {
  if (!preview || preview.before !== buildCleanupSnapshot(rows, expect)) throw new Error("Questions or expectations changed. Preview cleanup again.");
  return { rows: preview.rows.map((row, index) => JSON.stringify(row) === JSON.stringify(rows[index]) ? rows[index] : JSON.parse(JSON.stringify(row))),
    undo: { before: JSON.parse(JSON.stringify(rows)), after: buildCleanupSnapshot(preview.rows, expect) } };
}

export function undoBuildCleanup(rows, expect, undo) {
  if (!undo || undo.after !== buildCleanupSnapshot(rows, expect)) throw new Error("Questions or expectations changed after cleanup. Undo would replace newer edits.");
  return undo.before.map((row, index) => JSON.stringify(row) === JSON.stringify(rows[index]) ? rows[index] : JSON.parse(JSON.stringify(row)));
}

export function buildDiagnosticsMetadata(rows) {
  return rows.map((row, index) => ({ position: index + 1, id: text(row.id), type: row.type, ...buildRefinementFacts(row) }));
}

export function renderBuildRefinements(h, { view, refresh, preview, undo, onPreview, onApply, onUndo, onCancel, onDownload }) {
  return h("details", { open: !!view.refinementsOpen, ontoggle: (event) => { view.refinementsOpen = event.target.open; } },
    h("summary", {}, "Content diagnostics and cleanup"),
    h("div", { class: "grid", style: { gap: "8px", marginTop: "8px" } },
      h("p", { class: "faint" }, "Diagnostics inspect authored content. Word counts use whitespace separators; criterion characters count Unicode code points in active descriptions. Findings are advisory."),
      h("div", { class: "chips" }, [["minInstructionWords", "Minimum instruction words"], ["maxInstructionWords", "Maximum instruction words"],
        ["minCriterionCharacters", "Minimum criterion characters"], ["maxCriterionCharacters", "Maximum criterion characters"]].map(([field, label]) =>
        h("input", { class: "input sm", type: "number", min: 0, step: 1, "aria-label": label, placeholder: label, value: view[field] ?? "",
          oninput: (event) => { view[field] = event.target.value; refresh(); } }))),
      h("div", { class: "chips" }, refinementFlags.map(([field, label]) => h("label", { class: "faint" }, label, " ",
        h("select", { class: "input sm", "aria-label": label, onchange: (event) => { view[field] = event.target.value; refresh(); } },
          [["all", "Any"], ["with", "With"], ["without", "Without"]].map(([value, title]) => h("option", { value, selected: (view[field] || "all") === value }, title)))))),
      h("p", { class: "faint" }, "Cleanup changes only shown questions after preview and Apply. Review instruction and criterion wording before applying. Score levels stay in order and human expectations stay attached."),
      h("div", { class: "chips" },
        h("select", { class: "input sm", "aria-label": "Question cleanup action", onchange: (event) => { view.cleanupAction = event.target.value; } },
          cleanupActions.map(([value, label]) => h("option", { value, selected: (view.cleanupAction || "ids") === value }, label))),
        h("button", { class: "btn sm", onclick: onPreview }, "Preview shown cleanup"),
        h("button", { class: "btn sm ghost", disabled: !undo, onclick: onUndo }, "Undo last cleanup"),
        h("button", { class: "btn sm ghost", onclick: onDownload }, "Download shown diagnostics")),
      preview ? h("div", { class: "callout", role: "status" },
        h("p", {}, `${cleanupActions.find(([value]) => value === preview.action)?.[1]}: ${preview.changes.length} question(s) would change. No call or saved change.`),
        h("pre", {}, preview.changes.map((change) => `${change.position}. ${JSON.stringify(change.id)} (${change.type})`).join("\n") || "No changes needed."),
        h("button", { class: "btn sm primary", disabled: !preview.changes.length, onclick: onApply }, "Apply previewed cleanup"),
        h("button", { class: "btn sm ghost", onclick: onCancel }, "Cancel cleanup preview")) : null));
}
