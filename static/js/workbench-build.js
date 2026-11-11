// Build tab: the state, questions and pictures of one request, running it, question checks (jev/lint.py),
// code export and saving it as a test. Also the helpers that convert questions between the editor and the API.
import {
  $, answerCard, api, callStats, copyText, currentStatus, h, handleError, icon, inspect, pct, photoView, prepareImage,
  statusBadge, toast,
} from "./common.js";
import { editorQuestionError, parseUniqueJson, requestDraft, parseRequestDraft, buildEditorContext, buildContextChanged, parseBuildState, formatBuildState } from "./build-request.js";
import { uniqueQuestionId, duplicateQuestionRow, moveEditorEntry, removeEditorQuestion, restoreEditorQuestion, buildRequestSummary, matchesEditorQuestion, moveEditorEntryTo, renameEditorQuestion, duplicateChoiceOption, insertEditorCriterion, duplicateShownQuestions, editorQuestionOutline, reorderEditorCriteria } from "./build-editing.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";

const TYPES = ["noul", "choice", "score", "box"];
let buildBaseline = null;
let buildRunContext = null;
let buildDraftPreview = null;
let buildRunSequence = 0;
let buildRunning = false;
let buildRawText = null;
let buildDraftBusy = false;
const buildQuestionView = { query: "", type: "all" };

// ---------- data helpers ----------
const parseMaybeJson = (s) => {
  if (typeof s !== "string") return s;
  const t = s.trim();
  if (/^[\[{]/.test(t)) { try { return JSON.parse(t); } catch { /* keep as text */ } }
  return s;
};
export const stringify = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
const parseState = (text) => parseBuildState(text);

export function toQuestions(rows) {
  // Rendering callers can keep the editor open while invalid keys are being fixed.
  // Outbound actions also report questionEditorError before making a request.
  if (editorQuestionError(rows)) return {};
  const out = Object.create(null);
  for (const r of rows) {
    const id = (r.id || "").trim();
    if (!id) continue;
    const q = { type: r.type, instructions: parseMaybeJson(r.instructions || "") };
    if (r.type === "box") {
      // A Box takes no criteria: its answer is always four edges.
    } else if (r.type === "choice") {
      q.criteria = Object.fromEntries(r.choice.filter(([k]) => k.trim()).map(([k, d]) => [k.trim(), d.trim() ? parseMaybeJson(d) : null]));
    } else if (r.type === "score") {
      q.criteria = r.score.filter((s) => s.trim()).map(parseMaybeJson);
    } else if ((r.noulYes || "").trim() || (r.noulNo || "").trim()) {
      q.criteria = { true: (r.noulYes || "").trim() ? parseMaybeJson(r.noulYes) : null, false: (r.noulNo || "").trim() ? parseMaybeJson(r.noulNo) : null };
    }
    out[id] = q;
  }
  return out;
}

export const questionEditorError = (rows = W.questions) => editorQuestionError(rows);

const buildContext = () => buildEditorContext(W.stateText, [W.questions, buildRawText], imagesPayload());
export const buildUnsaved = () => buildContextChanged(buildContext(), buildBaseline);
export const buildResultStale = () => !!W.result && buildContextChanged(buildContext(), buildRunContext);

function markBuildEdited() {
  W.exported = null;
  W.lint = null;
  $("#export")?.remove();
  $("#lint")?.remove();
  const stale = $("#build-stale");
  if (stale) stale.style.display = buildResultStale() ? "" : "none";
  const error = $("#build-validation");
  if (error) { error.textContent = questionEditorError() || ""; error.hidden = !error.textContent; }
  const save = $("#build-save-test");
  if (save) save.disabled = !W.result || buildResultStale();
  const summary = $("#build-request-summary");
  if (summary) summary.textContent = buildRequestSummary(W.stateText, W.questions, W.images.length);
  if ($(".qlist")) refreshQuestionVisibility();
  W.questions.forEach((row, index) => {
    const characters = $(`#build-instruction-count-${index}`);
    if (characters) characters.textContent = `${Array.from(String(row.instructions || "")).length} instruction characters`;
    const count = $(`#build-criteria-count-${index}`);
    if (count) count.textContent = row.type === "choice" ? `${row.choice.filter(([key]) => key.trim()).length} named options`
      : row.type === "score" ? `${row.score.filter((level) => level.trim()).length} defined levels`
      : row.type === "noul" ? `${[row.noulYes, row.noulNo].filter((value) => String(value || "").trim()).length} defined outcomes` : "Coordinates only · no criteria";
  });
}

function validBuildQuestions() {
  if (buildRawText !== null) { toast("Apply the Raw JSON edits before using this request.", "error"); return null; }
  try { parseState(W.stateText); } catch (e) { toast(`State: ${e.message}`, "error"); return null; }
  const error = questionEditorError();
  if (error) { toast(error, "error"); return null; }
  const questions = toQuestions(W.questions);
  if (!Object.keys(questions).length) { toast("Add at least one question with an id.", "error"); return null; }
  return questions;
}

export function fromQuestions(obj) {
  return Object.entries(obj || {}).map(([id, q]) => ({
    id, type: q.type, instructions: stringify(q.instructions),
    choice: q.type === "choice" ? Object.entries(q.criteria || {}).map(([k, d]) => [k, stringify(d)]) : [["", ""], ["", ""]],
    score: q.type === "score" ? (q.criteria || []).map(stringify) : ["", "", ""],
    noulYes: q.type === "noul" ? stringify(q.criteria?.true) : "", noulNo: q.type === "noul" ? stringify(q.criteria?.false) : "",
  }));
}

const blankRow = (type) => ({
  id: uniqueQuestionId(W.questions, `${type}_${W.questions.length + 1}`), type, instructions: "",
  choice: [["", ""], ["", ""]], score: ["", "", ""], noulYes: "", noulNo: "",
});

function defaultExpect(answer) {
  if (answer.type === "choice") return { choice: answer.choice };
  if (answer.type === "box") {
    return { box: Object.fromEntries(["left", "top", "right", "bottom"].map((k) => [k, +answer.box[k].toFixed(3)])), iou_min: 0.5 };
  }
  if (answer.type === "score") return { min: Math.max(0, +(answer.score - 0.5).toFixed(2)), max: +(answer.score + 0.5).toFixed(2) };
  return answer.noul >= 0.5 ? { min: 0.5 } : { max: 0.5 };
}

// ---------- images ----------
// Each picture has a reference string; the API swaps the picture in wherever the reference appears.
function newRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `photo-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export const sampleUrl = (name) => `/img/samples/${name}.png`;

function imagesFromSpecs(specs) {
  return Object.entries(specs || {}).map(([ref, spec]) => spec.sample
    ? { ref, sample: spec.sample, url: sampleUrl(spec.sample), about: W.samples.find((x) => x.name === spec.sample)?.about }
    : { ref, format: spec.format, data_base64: spec.data_base64, url: `data:image/${spec.format === "png" ? "png" : "jpeg"};base64,${spec.data_base64}` });
}
const imagesPayload = () => Object.fromEntries(W.images.map((i) => [i.ref, i.sample ? { sample: i.sample } : { format: i.format, data_base64: i.data_base64 }]));
const imageNames = () => Object.fromEntries(W.images.map((i) => [i.ref, i.sample ? { sample: i.sample } : { format: i.format }]));

// Put a new picture somewhere a question can point at it: a `photo` field in an object state.
function placeInState(ref) {
  const state = parseState(W.stateText);
  const isObject = state && typeof state === "object" && !Array.isArray(state);
  if (Array.isArray(state)) return "Put its reference in the state or a question.";
  const obj = isObject ? state : (String(state || "").trim() ? { text: state } : {});
  let key = "photo";
  for (let n = 2; key in obj; n++) key = `photo_${n}`;
  obj[key] = ref;
  W.stateText = JSON.stringify(obj, null, 2);
  return isObject || !String(state || "").trim() ? `Added \`${key}\` to the state.` : `Moved the text into \`text\` and added \`${key}\`.`;
}

function addImage(img) {
  if (W.images.length >= W.maxImages) return toast(`At most ${W.maxImages} images per request.`, "error");
  try { parseState(W.stateText); } catch (e) { return toast(`State: ${e.message}`, "error"); }
  const ref = newRef();
  W.images.push({ ...img, ref });
  toast(placeInState(ref));
  W.result = null;
  markBuildEdited();
  render();
}

function removeImage(ref) {
  let state;
  try { state = parseState(W.stateText); } catch (e) { return toast(`State: ${e.message}`, "error"); }
  W.images = W.images.filter((i) => i.ref !== ref);
  if (state && typeof state === "object" && !Array.isArray(state)) {
    for (const [k, v] of Object.entries(state)) if (v === ref) delete state[k];
    W.stateText = JSON.stringify(state, null, 2);
  }
  W.result = null;
  markBuildEdited();
  render();
}

// Follow a backticked state path such as `photo`, `after.photo` or `frames[2].frame`.
function lookup(state, path) {
  if (state && typeof state === "object" && Object.hasOwn(state, path)) return state[path]; // a key with dots
  let node = state;
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (node === null || typeof node !== "object" || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

// Which picture a Box question points at: one named by reference or by a backticked state path.
// With several pictures and no match, return null rather than draw the box on a guessed picture.
function imageFor(question, state, images) {
  const text = typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions);
  const byRef = images.find((i) => text.includes(i.ref));
  if (byRef) return byRef;
  for (const [, path] of text.matchAll(/`([^`]+)`/g)) {
    const value = lookup(state, path.trim());
    const img = images.find((i) => i.ref === value);
    if (img) return img;
  }
  return images.length === 1 ? images[0] : null;
}

export function loadInto(state, questions, { expect = {}, name = "", notes = "", id = null, example = null, images = {}, handoff = null } = {}) {
  if (buildUnsaved() && !window.confirm("Replace the unsaved Build request? Download a Build draft first to keep it.")) return false;
  buildRunSequence += 1;
  buildRunning = false;
  W.stateText = typeof state === "string" ? state : JSON.stringify(state, null, 2);
  W.questions = fromQuestions(questions);
  W.images = imagesFromSpecs(images);
  W.expect = expect || {};
  W.saveName = name;
  W.saveNotes = notes;
  W.editingId = id;
  W.loadedExample = example;
  W.handoff = handoff;
  W.result = null;
  W.exported = null;
  W.lint = null;
  W.saveOpen = false;
  W.raw = false;
  W.buildEditing = null;
  buildRawText = null;
  W.tab = "build";
  buildRunContext = null;
  buildDraftPreview = null;
  buildBaseline = buildContext();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  return true;
}

export function applyBuildQuestions(questions) {
  try { return loadInto(parseState(W.stateText), questions, { images: imagesPayload() }); }
  catch (e) { toast(`State: ${e.message}`, "error"); return false; }
}

const buildEditState = () => W.buildEditing || (W.buildEditing = { collapsed: new WeakSet(), deleted: null });

function deleteBuildQuestion(index) {
  const removed = removeEditorQuestion(W.questions, W.expect, index);
  if (!removed) return;
  W.questions = removed.rows;
  W.expect = removed.expect;
  buildEditState().deleted = removed.undo;
  markBuildEdited();
  render();
}

function undoBuildQuestion() {
  try {
    const restored = restoreEditorQuestion(W.questions, W.expect, buildEditState().deleted);
    if (!restored) return;
    W.questions = restored.rows;
    W.expect = restored.expect;
    buildEditState().deleted = null;
    markBuildEdited();
    render();
  } catch (e) { toast(e.message, "error"); }
}

function duplicateBuildQuestion(index) {
  const row = duplicateQuestionRow(W.questions[index], W.questions);
  W.questions.splice(index + 1, 0, row);
  markBuildEdited();
  render();
}

function moveBuildQuestionToPosition(index) {
  const entered = window.prompt(`Move question to position (1–${W.questions.length}):`, String(index + 1));
  if (entered === null) return;
  const target = Number(entered) - 1;
  if (!entered.trim() || !Number.isInteger(target) || target < 0 || target >= W.questions.length) {
    return toast("Choose a whole-number position within the current question list.", "error");
  }
  W.questions = moveEditorEntryTo(W.questions, index, target);
  markBuildEdited(); render();
}

function renameBuildQuestion(index) {
  const requested = window.prompt("New question id (human expectations move with it):", W.questions[index].id);
  if (requested === null) return;
  try {
    const renamed = renameEditorQuestion(W.questions, W.expect, index, requested);
    W.questions = renamed.rows;
    W.expect = renamed.expect;
    markBuildEdited();
    render();
  } catch (e) { toast(e.message, "error"); }
}

function insertBuildQuestion(index, after) {
  W.questions.splice(index + Number(after), 0, blankRow(W.questions[index].type));
  for (const key of Object.keys(buildQuestionView)) delete buildQuestionView[key];
  Object.assign(buildQuestionView, { query: "", type: "all" });
  markBuildEdited();
  render();
}

function formatBuildStateText() {
  try {
    const formatted = formatBuildState(W.stateText);
    W.stateText = formatted.text;
    markBuildEdited();
    render();
    toast(formatted.message);
  } catch (e) { toast(`Could not format JSON: ${e.message}`, "error"); }
}

function compactBuildStateText() {
  try {
    const state = parseState(W.stateText);
    if (!state || typeof state !== "object") return toast("Compact JSON needs an object or array; plain text stays unchanged.");
    // Validate above, then remove only whitespace outside strings. Re-serializing would
    // round large numeric literals or turn overflowing numbers into null.
    let compact = "", quoted = false, escaped = false;
    for (const char of W.stateText) {
      if (quoted) {
        compact += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') { quoted = true; compact += char; }
      else if (!/[ \t\r\n]/.test(char)) compact += char;
    }
    W.stateText = compact;
    markBuildEdited();
    render();
  } catch (e) { toast(`Could not compact JSON: ${e.message}`, "error"); }
}

function visibleBuildQuestions() {
  // Keep an edited card visible until focus leaves it, so filtering never interrupts typing.
  const focusedIndex = Number($(".build-question-card:focus-within")?.dataset.questionIndex ?? -1);
  return W.questions.filter((row, index) => index === focusedIndex || matchesEditorQuestion(row, buildQuestionView, W.expect));
}

function refreshQuestionVisibility() {
  const shown = new Set(visibleBuildQuestions());
  $(".qlist")?.querySelectorAll(".build-question-card").forEach((card) => {
    card.hidden = !shown.has(W.questions[Number(card.dataset.questionIndex)]);
  });
  const count = $("#build-question-count");
  if (count) count.textContent = `${shown.size} of ${W.questions.length} questions shown. Run and export include every question.`;
  for (const id of ["build-copy-shown", "build-duplicate-shown", "build-copy-shown-json", "build-download-shown-json", "build-download-outline"]) {
    const button = $(`#${id}`);
    if (button) button.disabled = !shown.size;
  }
  const empty = $("#build-question-no-match");
  if (empty) empty.hidden = shown.size > 0;
}

function questionFocusOut(event) {
  if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
  // Focus events can run before the next element becomes :focus-within.
  setTimeout(refreshQuestionVisibility, 0);
}

function renderQuestionTools() {
  const shown = visibleBuildQuestions().length;
  return h("div", { class: "grid", style: { gap: "8px" } },
    h("input", { class: "input", type: "search", "aria-label": "Search Build questions", value: buildQuestionView.query,
      placeholder: "Search ids, instructions or criteria", oninput: (event) => {
        buildQuestionView.query = event.target.value; refreshQuestionVisibility();
      } }),
    h("div", { class: "chips" },
      h("select", { class: "input sm", "aria-label": "Search Build question field", onchange: (event) => {
        buildQuestionView.searchField = event.target.value; refreshQuestionVisibility();
      } }, [["all", "All question fields"], ["id", "Ids only"], ["instructions", "Instructions only"], ["criteria", "Criteria only"]].map(([value, label]) =>
        h("option", { value, selected: (buildQuestionView.searchField || "all") === value }, label))),
      h("input", { class: "input sm", type: "search", "aria-label": "Exclude Build question text", placeholder: "Exclude text in search field",
        value: buildQuestionView.exclude || "", oninput: (event) => { buildQuestionView.exclude = event.target.value; refreshQuestionVisibility(); } }),
      [["minCriteria", "Minimum defined criteria"], ["maxCriteria", "Maximum defined criteria"]].map(([key, label]) =>
        h("input", { class: "input sm", type: "number", min: "0", step: "1", "aria-label": label, placeholder: label,
          value: buildQuestionView[key] || "", oninput: (event) => { buildQuestionView[key] = event.target.value; refreshQuestionVisibility(); } })),
      h("select", { class: "input sm", "aria-label": "Filter Build question type", onchange: (event) => {
        buildQuestionView.type = event.target.value; refreshQuestionVisibility();
      } }, ["all", ...TYPES].map((type) => h("option", { value: type, selected: buildQuestionView.type === type }, type === "all" ? "All question types" : type))),
      [["instructions", "Instructions"], ["criteria", "Defined criteria"], ["expectations", "Human expectations"]].map(([field, label]) =>
        h("label", { class: "faint" }, label, " ", h("select", { class: "input sm", "aria-label": `Filter Build ${label.toLowerCase()}`,
          onchange: (event) => { buildQuestionView[field] = event.target.value; refreshQuestionVisibility(); } },
        [["all", "Any"], ["with", "With"], ["without", "Without"]].map(([value, text]) =>
          h("option", { value, selected: (buildQuestionView[field] || "all") === value }, text))))),
      h("button", { class: "btn sm ghost", id: "build-copy-shown", disabled: !shown, onclick: () => copyText(visibleBuildQuestions().map((row) => row.id).join("\n")) }, "Copy shown ids"),
      h("button", { class: "btn sm ghost", id: "build-copy-shown-json", disabled: !shown, onclick: () => shareShownQuestions("copy") }, "Copy shown questions JSON"),
      h("button", { class: "btn sm ghost", id: "build-download-shown-json", disabled: !shown, onclick: () => shareShownQuestions("json") }, "Download shown questions JSON"),
      h("button", { class: "btn sm ghost", id: "build-download-outline", disabled: !shown, onclick: () => shareShownQuestions("outline") }, "Download shown outline"),
      h("button", { class: "btn sm ghost", id: "build-duplicate-shown", disabled: !shown, onclick: () => {
        W.questions = duplicateShownQuestions(W.questions, visibleBuildQuestions());
        markBuildEdited(); render();
      } }, "Duplicate shown"),
      h("button", { class: "btn sm ghost", onclick: () => { for (const key of Object.keys(buildQuestionView)) delete buildQuestionView[key]; Object.assign(buildQuestionView, { query: "", type: "all" }); render(); } }, "Clear question filters"),
      [true, false].map((collapse) => h("button", { class: "btn sm ghost", onclick: () => {
        for (const row of visibleBuildQuestions()) {
          if (collapse) buildEditState().collapsed.add(row); else buildEditState().collapsed.delete(row);
        }
        render();
      } }, collapse ? "Collapse shown" : "Expand shown"))),
    h("span", { class: "faint", id: "build-question-count", "aria-live": "polite" }, `${shown} of ${W.questions.length} questions shown. Run and export include every question.`),
    h("p", { class: "faint", id: "build-question-no-match", hidden: shown > 0 }, "No questions match. Clear filters to show every question."));
}

function shareShownQuestions(format) {
  if (buildRawText !== null) return toast("Apply the Raw JSON edits before sharing editor questions.", "error");
  const rows = visibleBuildQuestions();
  if (!rows.length) return toast("No questions are shown.", "error");
  let text;
  if (format === "outline") text = editorQuestionOutline(rows);
  else {
    const error = questionEditorError(rows);
    if (error) return toast(error, "error");
    text = JSON.stringify(toQuestions(rows), null, 2) + "\n";
  }
  if (format === "copy") return copyText(text);
  const url = URL.createObjectURL(new Blob([text], { type: format === "outline" ? "text/plain;charset=utf-8" : "application/json" }));
  h("a", { href: url, download: format === "outline" ? "jev-question-outline.txt" : "jev-questions.json" }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reorderBuildCriteria(index, action) {
  const row = W.questions[index];
  if (row.type === "score" && !window.confirm("Reverse Score levels? This changes the numeric meaning of every level. Existing human expectations stay unchanged; review them before running.")) return;
  W.questions[index] = reorderEditorCriteria(row, action);
  markBuildEdited(); render();
}

function discardBuildRaw() {
  if (buildRawText === null || !window.confirm("Discard the unapplied Raw JSON edits? The question editor will keep its current questions.")) return;
  buildRawText = null;
  W.raw = false;
  markBuildEdited();
  render();
}

function editorMoveButtons(entries, index, label, apply) {
  return [-1, 1].map((direction) => {
    const title = `Move ${label} ${direction < 0 ? "up" : "down"}`;
    return h("button", { class: "btn sm ghost", title, "aria-label": title,
      disabled: index + direction < 0 || index + direction >= entries.length,
      onclick: () => { apply(moveEditorEntry(entries, index, direction)); markBuildEdited(); render(); } }, direction < 0 ? "↑" : "↓");
  });
}

// ---------- Build ----------
// Says where an opened demo request came from, and that its answers did not come along.
function handoffNote() {
  const ho = W.handoff;
  if (!ho) return null;
  const model = currentStatus().model;
  return h("div", { class: "callout" }, icon("arrow"), h("div", {},
    h("b", {}, `Opened from ${ho.source}`),
    h("div", { class: "muted" }, `This started as the exact request ${ho.source} sent. Its answers stayed in that tab: press Run to ask the model again,`
      + " then reword a question, save it as a test, or use the questions in Bulk."
      + (ho.model && model && ho.model !== model ? ` ${ho.source} asked ${ho.model}; Run asks ${model}.` : ""))));
}

export function renderBuild() {
  const stateArea = h("textarea", { class: "input", spellcheck: "false", "aria-label": "Request state", placeholder: "Plain text, or a JSON object/array. Point questions at fields with `backticks`." }, W.stateText);
  stateArea.addEventListener("input", () => { W.stateText = stateArea.value; markBuildEdited(); });
  const left = h("div", { class: "grid", style: { gap: "16px" } },
    handoffNote(),
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "State"), h("div", { class: "spacer" }),
        h("button", { class: "btn sm", onclick: formatBuildStateText, title: "Format a JSON object or array without changing plain text" }, "Format JSON"),
        h("button", { class: "btn sm ghost", onclick: compactBuildStateText, title: "Remove JSON whitespace while preserving every value" }, "Compact JSON"),
        h("span", { class: "faint", style: { fontSize: "12px" } }, W.loadedExample ? `from example: ${W.loadedExample}` : W.editingId ? `editing test: ${W.editingId}`
          : W.handoff ? `from ${W.handoff.source}` : "")),
      h("div", { class: "panel-body state-box" }, stateArea,
        h("p", { id: "build-request-summary", class: "faint", style: { fontSize: "12px" } }, buildRequestSummary(W.stateText, W.questions, W.images.length)), renderBuildDraft())),
    renderImages(),
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, `Questions · ${W.questions.length}`), h("div", { class: "spacer" }),
        h("button", { class: `btn sm ${W.raw ? "" : "ghost"}`, onclick: () => { W.raw = !W.raw; render(); } }, icon("code"), W.raw ? "Editor" : "Raw JSON")),
      h("div", { class: "panel-body grid", style: { gap: "10px" } },
        h("p", { id: "build-validation", class: "critical-text", role: "alert", hidden: !questionEditorError() }, questionEditorError()),
        !W.raw && buildRawText !== null ? h("div", { class: "callout", role: "status" },
          h("span", {}, "Raw JSON has unapplied edits. Apply or discard them before using the request."),
          h("button", { class: "btn sm", onclick: () => { W.raw = true; render(); } }, "Review Raw JSON"),
          h("button", { class: "btn sm ghost", onclick: discardBuildRaw }, "Discard Raw edits")) : null,
        !W.raw ? renderQuestionTools() : null,
        W.raw ? renderRaw() : h("div", { class: "qlist" }, W.questions.map((row, i) =>
          h("div", { class: "build-question-card", "data-question-index": String(i), hidden: !visibleBuildQuestions().includes(row),
            onfocusout: questionFocusOut }, renderQuestionCard(row, i)))),
        !W.raw ? h("div", { class: "chips" }, TYPES.map((t) =>
          h("button", { class: "chip", onclick: () => { W.questions.push(blankRow(t)); markBuildEdited(); render(); } }, icon("plus"), `Add ${t}`)),
        buildEditState().deleted ? h("button", { class: "btn sm", onclick: undoBuildQuestion }, `Undo remove ${buildEditState().deleted.id || "question"}`) : null) : null)));

  const runBtn = h("button", { class: "btn primary", id: "build-run", disabled: buildRunning, onclick: run }, icon("bolt"), buildRunning ? "Running…" : "Run");
  const right = h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Answers"), h("div", { class: "spacer" }),
        h("button", { class: "btn sm", onclick: checkQuestions, title: "Read the questions for common mistakes. Plain code: no model call, no cost." }, icon("search"), "Check questions"),
        h("button", { class: "btn sm", onclick: exportCode }, icon("code"), "Export code"),
        h("button", { class: "btn sm", id: "build-save-test", disabled: !W.result || buildResultStale(), onclick: () => { W.saveOpen = !W.saveOpen; if (W.saveOpen && !Object.keys(W.expect).length) W.expect = Object.fromEntries(Object.entries(W.result.answers).map(([k, a]) => [k, defaultExpect(a)])); render(); } }, icon("save"), "Save as test"),
        runBtn),
      h("p", { id: "build-stale", class: "callout", role: "status", style: { display: buildResultStale() ? "" : "none" } }, "These answers are from the previous request. Inputs or questions have changed; run again to answer the current request."),
      boxWarning(),
      W.result
        ? h("div", { class: "panel-body grid", style: { gap: "12px" } },
          callStats(W.result.meta, () => inspect(W.result.trace, "Workbench · one Jev request")),
          renderBoxes(),
          h("div", { class: "answers" }, Object.entries(W.result.answers).map(([qid, a]) => answerCard(qid, a, W.result.trace.request.questions[qid]))))
        : h("div", { class: "empty" }, "Press Run. Every question is evaluated in parallel against the state, in one request.")),
    W.lint ? renderLint() : null,
    W.saveOpen && W.result && !buildResultStale() ? renderSaveForm() : null,
    W.exported ? renderExport() : null,
    h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Writing good questions")),
      h("div", { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
        h("p", { class: "muted" }, "One judgment per question. If you would need a paragraph to explain the answer, split it."),
        h("p", { class: "muted" }, "Say exactly what a yes means and what it does not mean; Jev reads instructions literally."),
        h("p", { class: "muted" }, "Keep math, dates, counting, and exact lookups in code. Ask Jev to pick from options, not to generate values."),
        h("p", { class: "muted" }, "Include a “none of these” option when nothing may fit, and read confidence before acting."),
        h("p", { class: "muted" }, "A Box always returns four edges, even when the target is missing. Ask a Noul whether it is there, and ignore the box when that is low."),
        h("p", { class: "faint" }, "Docs: ", h("a", { href: "https://docs.typesafe.ai/concepts/how-to-build-with-system-one", target: "_blank", rel: "noopener" }, "How to build with TypeSafe"), " · ", h("a", { href: "https://docs.typesafe.ai/model-jaggedness/jev-1.13", target: "_blank", rel: "noopener" }, "Known jagged edges")))));
  return h("div", { class: "grid wb-grid" }, left, right);
}

function renderBuildDraft() {
  const file = h("input", { type: "file", accept: ".json,application/json", hidden: true,
    onchange: () => previewBuildDraft(file.files[0]) });
  const preview = buildDraftPreview;
  return h("div", { class: "grid", style: { gap: "8px", marginTop: "10px" } },
    h("div", { class: "chips" },
      h("button", { class: "btn sm", disabled: buildDraftBusy, onclick: downloadBuildDraft }, "Download Build draft"),
      h("button", { class: "btn sm", disabled: buildDraftBusy, onclick: () => file.click() }, "Restore Build draft"), file),
    h("p", { class: "faint" }, "Keep an unrun request with its questions and pictures. Drafts contain no model answers or API settings. Review your input data before sharing."),
    preview ? h("div", { class: "callout" }, h("div", {},
      h("b", {}, "Build draft preview"),
      h("p", {}, `${Object.keys(preview.draft.questions).length} questions · ${Object.keys(preview.draft.images).length} pictures. Accepting replaces the Build request; it makes no model call or saved change.`),
      h("button", { class: "btn sm primary", disabled: buildDraftBusy, onclick: acceptBuildDraft }, "Accept Build draft"),
      h("button", { class: "btn sm ghost", onclick: () => { buildDraftPreview = null; render(); } }, "Cancel restore"))) : null);
}

async function downloadBuildDraft() {
  if (buildDraftBusy) return;
  const questions = validBuildQuestions();
  if (!questions) return;
  const context = buildContext();
  const draft = requestDraft(parseState(W.stateText), questions, imagesPayload());
  buildDraftBusy = true;
  render();
  try {
    await api("/api/workbench/draft/validate", draft);
    if (context !== buildContext()) return toast("The Build request changed. Download its current draft again.", "error");
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: "jev-build-draft.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    buildBaseline = context;
    toast("Downloaded the Build draft, including its pictures.");
  } catch (e) { handleError(e); }
  finally { buildDraftBusy = false; render(); }
}

async function previewBuildDraft(file) {
  if (!file || buildDraftBusy) return;
  buildDraftBusy = true;
  buildDraftPreview = null;
  const context = buildContext();
  render();
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error("Build drafts must be at most 12 MiB.");
    const draft = parseRequestDraft(parseUniqueJson(await file.text()));
    const error = questionEditorError(fromQuestions(draft.questions));
    if (error) throw new Error(error);
    await api("/api/workbench/draft/validate", draft);
    if (context !== buildContext()) return toast("The Build request changed. Preview the draft again before replacing it.", "error");
    buildDraftPreview = { draft, context };
  } catch (e) { handleError(e); }
  finally { buildDraftBusy = false; render(); }
}

function acceptBuildDraft() {
  const preview = buildDraftPreview;
  if (!preview) return;
  if (preview.context !== buildContext()) return toast("The Build request changed. Preview the draft again before replacing it.", "error");
  const { state, questions, images } = preview.draft;
  if (loadInto(state, questions, { images })) toast("Restored the Build draft. Run it when ready to get answers.");
}

function renderImages() {
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/*", class: "hidden" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const img = await prepareImage(f);
      addImage({ format: img.format, data_base64: img.data_base64, url: img.url, name: img.name });
    } catch (e) { toast(e.message || "Could not read that image.", "error"); }
  });
  const full = W.images.length >= W.maxImages;
  return h("div", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, `Images · ${W.images.length}`),
      h("span", { class: "dreamer", title: "TypeSafe marks images and Box as dreamer-ready: for prototypes, and subject to change" }, "Dreamer-ready"),
      h("div", { class: "spacer" }),
      h("button", { class: "btn sm", disabled: full, onclick: () => file.click() }, icon("upload"), "Upload"), file),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      W.images.length ? h("div", { class: "img-list" }, W.images.map((img) => h("div", { class: "img-row" },
        photoView(img.url, [], { alt: img.about || img.name || "Image" }),
        h("div", { class: "grid", style: { gap: "4px", minWidth: 0 } },
          h("button", { class: "ref mono", title: "Copy the reference", onclick: () => copyText(img.ref) }, img.ref, icon("copy")),
          h("span", { class: "faint", style: { fontSize: "11.5px" } }, img.sample ? `Sample drawing: ${img.about || img.sample}` : `${img.name || "Upload"} · JPEG`)),
        h("button", { class: "btn sm ghost", title: "Remove image", "aria-label": "Remove image", onclick: () => removeImage(img.ref) }, icon("trash"))))) : null,
      h("div", { class: "thumbs" }, W.samples.map((sm) => h("button", {
        class: "thumb", title: `Add sample: ${sm.about}`, "aria-label": `Add sample: ${sm.about}`, disabled: full,
        onclick: () => addImage({ sample: sm.name, url: sm.url, about: sm.about }),
      }, h("img", { src: sm.url, alt: "" })))),
      h("p", { class: "faint", style: { fontSize: "12px" } },
        "Each picture gets a reference. Wherever the reference appears in the state or a question, the model sees the picture. Point questions at it by field, such as ", h("code", {}, "`photo`"), ". Uploads are resized in your browser to 280–1568 px.")));
}

function boxWarning() {
  const st = currentStatus();
  const hasBox = W.questions.some((q) => q.type === "box");
  if (!hasBox || !st.configured || st.supports_box) return null;
  return h("div", { class: "panel-body", style: { paddingBottom: 0 } }, h("div", { class: "callout" }, icon("alert"),
    h("div", {}, h("b", {}, `${st.model} cannot answer Box questions.`), h("div", { class: "muted" }, "Box needs Jev 1.14 or later. Change the model from the key menu in the top bar."))));
}

// Draw every Box answer on the picture its question points at.
function renderBoxes() {
  const r = W.result;
  const boxes = Object.entries(r.answers).filter(([, a]) => a.type === "box");
  if (!boxes.length || !r.images?.length) return null;
  const byImage = new Map();
  const unplaced = [];
  for (const [qid, a] of boxes) {
    const img = imageFor(r.trace.request.questions[qid] || {}, r.trace.request.state, r.images);
    if (!img) { unplaced.push(qid); continue; }
    if (!byImage.has(img)) byImage.set(img, []);
    byImage.get(img).push({ box: a.box, label: `${qid} · ${pct(a.confidence)}` });
  }
  return h("div", { class: "box-views" }, [...byImage].map(([img, list]) =>
    photoView(img.url, list, { alt: "Image with Box answers", caption: `${list.length} Box answer${list.length > 1 ? "s" : ""} on ${img.ref}. A Box always returns edges, so check a presence Noul before trusting one.` })),
  unplaced.length ? h("p", { class: "faint", style: { fontSize: "12px" } },
    `Not drawn: ${unplaced.join(", ")}. Name the picture in the instructions by reference or by its backticked state field to see the box.`) : null);
}

function renderRaw() {
  const error = buildRawText === null ? questionEditorError() : null;
  if (error) return h("div", { class: "raw grid", style: { gap: "8px" } },
    h("p", { role: "alert" }, `Fix the editor errors before opening Raw JSON: ${error}`),
    h("button", { class: "btn sm", onclick: () => { W.raw = false; render(); } }, "Back to editor"));
  const discard = h("button", { class: "btn sm ghost", disabled: buildRawText === null, onclick: discardBuildRaw }, "Discard Raw edits");
  const area = h("textarea", { class: "input", spellcheck: "false", "aria-label": "Questions as JSON" }, buildRawText ?? JSON.stringify(toQuestions(W.questions), null, 2));
  area.addEventListener("input", () => { buildRawText = area.value; discard.disabled = false; markBuildEdited(); });
  return h("div", { class: "raw grid", style: { gap: "8px" } }, area,
    h("div", { style: { display: "flex", gap: "8px" } },
      h("button", { class: "btn sm primary", onclick: () => {
        try {
          const rows = fromQuestions(parseUniqueJson(area.value));
          const error = questionEditorError(rows);
          if (error) throw new Error(error);
          W.questions = rows; W.buildEditing = null; buildRawText = null; W.raw = false; markBuildEdited(); render();
        }
        catch (e) { toast(`Invalid JSON: ${e.message}`, "error"); }
      } }, "Apply"),
      discard,
      h("span", { class: "faint", style: { fontSize: "12px", alignSelf: "center" } }, "Same shape as the API's questions map. Structured instructions and criteria (objects, arrays) are allowed.")));
}

function renderQuestionCard(row, i) {
  const collapsed = buildEditState().collapsed.has(row);
  const copyButton = h("button", { class: "btn sm ghost", disabled: !String(row.id || "").trim(), "aria-label": `Copy question ${row.id || i + 1} JSON`, onclick: () => {
    if (!String(row.id || "").trim()) return toast("Give this question an id before copying it.", "error");
    const error = questionEditorError([row]);
    if (error) return toast(error, "error");
    copyText(JSON.stringify(toQuestions([row]), null, 2));
  } }, "Copy JSON");
  const idInput = h("input", { class: "input mono", value: row.id, placeholder: "question_id", "aria-label": `Question ${i + 1} id` });
  idInput.addEventListener("input", () => { row.id = idInput.value; copyButton.disabled = !String(row.id || "").trim(); markBuildEdited(); });
  const typeSel = h("select", { class: "input", "aria-label": `Question ${i + 1} type` }, TYPES.map((t) => h("option", { value: t, selected: row.type === t }, t)));
  typeSel.addEventListener("change", () => { row.type = typeSel.value; markBuildEdited(); render(); });
  const instr = h("textarea", { class: "input", "aria-label": `Instructions for ${row.id || `question ${i + 1}`}`, placeholder: row.type === "box"
    ? "What to find and in which picture, e.g. the coffee mug in `photo`."
    : "Instructions: the question, as a person would ask it. Refer to state fields with `backticks`." }, row.instructions);
  instr.addEventListener("input", () => { row.instructions = instr.value; markBuildEdited(); });

  let crit;
  if (row.type === "box") {
    crit = h("div", { class: "faint", style: { fontSize: "12px" } },
      "A Box takes no criteria. The answer is the four edges of the target as fractions of the picture's width and height. Needs an image and Jev 1.14+.");
  } else if (row.type === "choice") {
    crit = h("div", { class: "crit" },
      h("div", { class: "section-label", style: { margin: 0 } }, "Options (key → description, description optional)"),
      h("button", { class: "btn sm ghost", onclick: () => reorderBuildCriteria(i, "sort") }, "Sort options by key"),
      row.choice.map((pair, j) => {
        const k = h("input", { class: "input mono", value: pair[0], placeholder: "option_key" });
        const d = h("input", { class: "input", value: pair[1], placeholder: "what this option means" });
        k.addEventListener("input", () => { pair[0] = k.value; markBuildEdited(); });
        d.addEventListener("input", () => { pair[1] = d.value; markBuildEdited(); });
        return h("div", { class: "cr" }, k, d, h("div", { style: { display: "flex", flexWrap: "wrap", gridColumn: "1 / -1" } },
          editorMoveButtons(row.choice, j, `option ${pair[0] || j + 1}`, (entries) => { row.choice = entries; }),
          [[0, "first"], [row.choice.length - 1, "last"]].map(([target, label]) => h("button", {
            class: "btn sm ghost", disabled: j === target, "aria-label": `Move option ${pair[0] || j + 1} ${label}`,
            onclick: () => { row.choice = moveEditorEntryTo(row.choice, j, target); markBuildEdited(); render(); },
          }, label)),
          [false, true].map((after) => h("button", { class: "btn sm ghost", "aria-label": `Insert option ${after ? "after" : "before"} ${pair[0] || j + 1}`,
            onclick: () => { row.choice = insertEditorCriterion(row.choice, j, after, "choice"); markBuildEdited(); render(); } }, after ? "Insert after" : "Insert before")),
          h("button", { class: "btn sm ghost", "aria-label": `Duplicate option ${pair[0] || j + 1}`,
            onclick: () => { row.choice = duplicateChoiceOption(row.choice, j); markBuildEdited(); render(); } }, "Duplicate"),
          h("button", { class: "btn sm ghost", title: "Remove option", "aria-label": `Remove option ${pair[0] || j + 1}`, onclick: () => { row.choice.splice(j, 1); markBuildEdited(); render(); } }, icon("x"))));
      }),
      h("div", {}, h("button", { class: "chip", onclick: () => { row.choice.push(["", ""]); markBuildEdited(); render(); } }, icon("plus"), "Add option")));
  } else if (row.type === "score") {
    crit = h("div", { class: "crit" },
      h("div", { class: "section-label", style: { margin: 0 } }, "Levels, in order from 0 (moving a level changes its numeric score)"),
      h("button", { class: "btn sm ghost", onclick: () => reorderBuildCriteria(i, "reverse") }, "Reverse levels…"),
      row.score.map((lvl, j) => {
        const d = h("input", { class: "input", value: lvl, placeholder: `level ${j}` });
        d.addEventListener("input", () => { row.score[j] = d.value; markBuildEdited(); });
        return h("div", { class: "cr score" }, h("span", { class: "lv" }, String(j)), d, h("div", { style: { display: "flex", flexWrap: "wrap", gridColumn: "1 / -1" } },
          editorMoveButtons(row.score, j, `level ${j}`, (entries) => { row.score = entries; }),
          [[0, "first"], [row.score.length - 1, "last"]].map(([target, label]) => h("button", {
            class: "btn sm ghost", disabled: j === target, "aria-label": `Move level ${j} ${label}`,
            title: "Moving levels changes their numeric scores",
            onclick: () => { row.score = moveEditorEntryTo(row.score, j, target); markBuildEdited(); render(); },
          }, label)),
          [false, true].map((after) => h("button", { class: "btn sm ghost", "aria-label": `Insert level ${after ? "after" : "before"} ${j}`,
            title: "Inserting levels changes later numeric scores",
            onclick: () => { row.score = insertEditorCriterion(row.score, j, after, "score"); markBuildEdited(); render(); } }, after ? "Insert after" : "Insert before")),
          h("button", { class: "btn sm ghost", "aria-label": `Duplicate level ${j}`, title: "Insert a copy after this level; later numeric scores move up",
            onclick: () => { row.score.splice(j + 1, 0, row.score[j]); markBuildEdited(); render(); } }, "Duplicate"),
          h("button", { class: "btn sm ghost", title: "Remove level", "aria-label": `Remove level ${j}`, onclick: () => { row.score.splice(j, 1); markBuildEdited(); render(); } }, icon("x"))));
      }),
      h("div", {}, h("button", { class: "chip", onclick: () => { row.score.push(""); markBuildEdited(); render(); } }, icon("plus"), "Add level")));
  } else {
    const yes = h("input", { class: "input", value: row.noulYes, placeholder: "optional: what a yes means" });
    const no = h("input", { class: "input", value: row.noulNo, placeholder: "optional: what a no means" });
    yes.addEventListener("input", () => { row.noulYes = yes.value; markBuildEdited(); });
    no.addEventListener("input", () => { row.noulNo = no.value; markBuildEdited(); });
    crit = h("div", { class: "crit" }, h("div", { class: "cr noul" }, h("span", { class: "k" }, "yes"), yes), h("div", { class: "cr noul" }, h("span", { class: "k" }, "no"), no));
  }
  return h("div", { class: "qcard" },
    h("div", { class: "row" }, idInput, typeSel, h("button", { class: "btn sm ghost", "aria-expanded": String(!collapsed),
      "aria-label": `${collapsed ? "Expand" : "Collapse"} question ${row.id || i + 1}`,
      onclick: () => { const state = buildEditState(); if (collapsed) state.collapsed.delete(row); else state.collapsed.add(row); render(); } }, collapsed ? "Expand" : "Collapse")),
    h("div", { class: "chips" },
      editorMoveButtons(W.questions, i, `question ${row.id || i + 1}`, (entries) => { W.questions = entries; }),
      [[0, "first"], [W.questions.length - 1, "last"]].map(([target, label]) => h("button", {
        class: "btn sm ghost", disabled: i === target, "aria-label": `Move question ${row.id || i + 1} ${label}`,
        onclick: () => { W.questions = moveEditorEntryTo(W.questions, i, target); markBuildEdited(); render(); },
      }, `Move ${label}`)),
      h("button", { class: "btn sm ghost", onclick: () => moveBuildQuestionToPosition(i) }, "Move to position"),
      copyButton,
      h("button", { class: "btn sm ghost", onclick: () => renameBuildQuestion(i) }, "Rename safely"),
      [false, true].map((after) => h("button", { class: "btn sm ghost", onclick: () => insertBuildQuestion(i, after) }, after ? "Insert after" : "Insert before")),
      h("button", { class: "btn sm ghost", onclick: () => copyText(row.instructions || "") }, "Copy instructions"),
      h("button", { class: "btn sm ghost", onclick: () => {
        const normalized = [{ ...row, id: "question" }];
        const error = questionEditorError(normalized);
        if (error) return toast(error, "error");
        const question = Object.values(toQuestions(normalized))[0];
        copyText(JSON.stringify(question.criteria ?? {}, null, 2));
      } }, "Copy criteria"),
      h("button", { class: "btn sm ghost", onclick: () => duplicateBuildQuestion(i), "aria-label": `Duplicate question ${row.id || i + 1}` }, "Duplicate"),
      h("button", { class: "btn sm ghost", title: "Remove question", "aria-label": `Remove question ${row.id || i + 1}`, onclick: () => deleteBuildQuestion(i) }, icon("trash"), "Remove")),
    h("span", { class: "faint", id: `build-criteria-count-${i}`, "aria-live": "polite" },
      row.type === "choice" ? `${row.choice.filter(([key]) => key.trim()).length} named options`
        : row.type === "score" ? `${row.score.filter((level) => level.trim()).length} defined levels`
        : row.type === "noul" ? `${[row.noulYes, row.noulNo].filter((value) => String(value || "").trim()).length} defined outcomes` : "Coordinates only · no criteria"),
    h("span", { class: "faint", id: `build-instruction-count-${i}`, "aria-live": "polite" }, `${Array.from(String(row.instructions || "")).length} instruction characters`),
    collapsed ? h("p", { class: "faint", style: { margin: 0, overflowWrap: "anywhere" } },
      row.instructions ? `${row.instructions.slice(0, 160)}${row.instructions.length > 160 ? "…" : ""}` : "No instructions yet") : [instr, crit]);
}

async function run() {
  if (buildRunning) return;
  const questions = validBuildQuestions();
  if (!questions) return;
  const context = buildContext();
  const sequence = ++buildRunSequence;
  buildRunning = true;
  render();
  try {
    const images = W.images.map((i) => ({ ...i }));
    const result = await api("/api/workbench/run", { state: parseState(W.stateText), questions, images: imagesPayload() });
    if (sequence !== buildRunSequence) return;
    result.images = images;
    W.result = result;
    buildRunContext = context;
    W.saveOpen = false;
  } catch (e) { handleError(e); }
  finally { if (sequence === buildRunSequence) { buildRunning = false; render(); } }
}

async function checkQuestions({ scroll = true } = {}) {
  const questions = validBuildQuestions();
  if (!questions) return;
  const context = buildContext();
  try {
    const report = await api("/api/workbench/lint", { state: parseState(W.stateText), questions, images: imageNames() });
    if (context !== buildContext()) return;
    W.lint = report;
    render();
    if (scroll) $("#lint")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { handleError(e); }
}

function renderLint() {
  const { findings, counts, guide } = W.lint;
  const head = (level, n) => (level === "problem" ? `${n} ${n === 1 ? "problem" : "problems"}` : `${n} advice`);
  return h("div", { class: "panel", id: "lint" },
    h("div", { class: "panel-head" }, h("h2", {}, "Question checks"),
      counts.problem ? h("span", { class: "badge critical" }, icon("alert"), head("problem", counts.problem)) : null,
      counts.advice ? h("span", { class: "badge warning" }, icon("question"), head("advice", counts.advice)) : null,
      h("div", { class: "spacer" }),
      h("button", { class: "btn sm ghost", title: "Close", "aria-label": "Close question checks", onclick: () => { W.lint = null; render(); } }, icon("x"))),
    h("div", { class: "panel-body grid", style: { gap: "8px" } },
      findings.length
        ? h("ul", { class: "lint-list" }, findings.map((f) => h("li", { class: `lint ${f.level}` },
          f.level === "problem" ? statusBadge("fail", "Problem") : h("span", { class: "badge warning" }, icon("question"), "Advice"),
          h("div", {},
            f.question ? h("code", { class: "mono" }, f.question) : h("span", { class: "faint" }, "State"),
            h("div", { class: "muted" }, f.message),
            h("a", { class: "faint", href: f.guide, target: "_blank", rel: "noopener" }, "Why: How to build with System One")))))
        : h("div", { class: "callout good" }, icon("check"), h("div", {}, h("b", {}, "No findings."),
          h("div", { class: "muted" }, "Checks catch common mistakes, not every one. Run the questions and read the answers."))),
      h("p", { class: "faint", style: { fontSize: "12px" } },
        "Plain code read these questions: no model call, no cost. A problem is almost certainly a mistake; advice is a pattern ",
        h("a", { href: guide, target: "_blank", rel: "noopener" }, "TypeSafe's guide"),
        " recommends against, and may be what you meant. After an edit, press Check questions again.")));
}

async function exportCode() {
  try {
    const questions = validBuildQuestions();
    if (!questions) return;
    const context = buildContext();
    const exported = await api("/api/workbench/export", { state: parseState(W.stateText), questions, images: imageNames() });
    if (context !== buildContext()) return;
    W.exported = exported;
    render();
    $("#export")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { handleError(e); }
}

function renderExport() {
  const tabs = [["python", "Python SDK"], ["javascript", "JavaScript SDK"], ["curl", "curl"]];
  return h("div", { class: "panel", id: "export" },
    h("div", { class: "panel-head" }, icon("code"), h("h2", {}, "This request as code"), h("div", { class: "spacer" }),
      h("div", { class: "tabs" }, tabs.map(([k, l]) => h("button", { class: `tab${W.exportTab === k ? " active" : ""}`, onclick: () => { W.exportTab = k; render(); } }, l))),
      h("button", { class: "btn sm ghost", onclick: () => { W.exported = null; render(); } }, icon("x"))),
    h("div", { class: "panel-body" }, h("div", { class: "code" },
      h("button", { class: "btn sm copy", onclick: () => copyText(W.exported[W.exportTab]) }, icon("copy"), "Copy"),
      h("pre", {}, W.exported[W.exportTab])),
      h("p", { class: "faint", style: { fontSize: "12px", marginTop: "8px" } },
        W.exportTab === "python" ? "pip install typesafe-sdk (Python 3.10+), then set TYPESAFE_API_KEY."
          : W.exportTab === "javascript" ? "npm install @typesafe-ai/sdk (Node 20+), then set TYPESAFE_API_KEY."
            : "Set TYPESAFE_API_KEY in your shell first.",
        W.images.length ? " The snippet loads each picture from a file named after it; save the pictures beside it first." : "")));
}

function renderSaveForm() {
  const name = h("input", { class: "input", value: W.saveName, placeholder: "Test name, e.g. “angry refund routes to billing”" });
  name.addEventListener("input", () => { W.saveName = name.value; });
  const notes = h("input", { class: "input", value: W.saveNotes, placeholder: "Notes (optional)" });
  notes.addEventListener("input", () => { W.saveNotes = notes.value; });
  const rows = Object.entries(W.result.answers).map(([qid, a]) => {
    const e = W.expect[qid] || (W.expect[qid] = defaultExpect(a));
    const numField = (key) => {
      const inp = h("input", { class: "input mono", value: e[key] ?? "", placeholder: key });
      inp.addEventListener("input", () => { if (inp.value === "") delete e[key]; else e[key] = Number(inp.value); });
      return inp;
    };
    if (a.type === "choice") {
      const sel = h("select", { class: "input" }, Object.keys(a.probabilities).map((k) => h("option", { value: k, selected: e.choice === k }, k)));
      sel.addEventListener("change", () => { e.choice = sel.value; });
      return h("div", { class: "exp" }, h("code", {}, qid), h("span", { class: "faint" }, "choice ="), sel, h("span", {}));
    }
    if (a.type === "box") {
      return h("div", { class: "exp" }, h("code", {}, qid), h("span", { class: "faint", title: "Overlap with the box saved from this run: 1 is identical, 0 is no overlap" }, "IoU with this box ≥"), numField("iou_min"), h("span", {}));
    }
    return h("div", { class: "exp" }, h("code", {}, qid), h("span", { class: "faint" }, a.type === "score" ? "score in" : "P(yes) in"), numField("min"), numField("max"));
  });
  return h("div", { class: "panel pop" },
    h("div", { class: "panel-head" }, icon("save"), h("h2", {}, W.editingId ? `Update test “${W.editingId}”` : "Save as a test"), h("div", { class: "spacer" }),
      h("button", { class: "btn sm ghost", onclick: () => { W.saveOpen = false; render(); } }, icon("x"))),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("p", { class: "muted", style: { fontSize: "12.5px" } }, "Expectations start from the answers you just got. Edit them to what you believe is correct; the Tests tab re-runs this state live and checks the answers against them."),
      name, notes, h("div", { class: "grid", style: { gap: "6px" } }, rows),
      h("div", {}, h("button", { class: "btn primary", onclick: saveTest }, icon("save"), "Save to data/workbench/"))));
}

async function saveTest() {
  try {
    if (W.result && buildResultStale()) return toast("Run the edited request before saving its expectations as a test.", "error");
    if (buildRawText !== null) return toast("Apply the Raw JSON edits before saving this request.", "error");
    const questions = toQuestions(W.questions);
    const error = questionEditorError();
    if (error) return toast(error, "error");
    const submittedContext = buildContext();
    const expect = Object.fromEntries(Object.entries(W.expect).filter(([qid]) => Object.hasOwn(questions, qid)));
    const { item } = await api("/api/workbench/items", {
      id: W.editingId || undefined, name: W.saveName, notes: W.saveNotes, state: parseState(W.stateText),
      questions, expect, images: imagesPayload(),
    });
    W.items = (await api("/api/workbench/items")).items;
    W.editingId = item.id;
    W.saveOpen = false;
    buildBaseline = submittedContext;
    toast(`Saved data/workbench/${item.id}.json`);
    render();
  } catch (e) { handleError(e); }
}
