// Build tab layout, shared request helpers and Lab wiring.
import { buildRequestSummary, uniqueQuestionId } from "./build-editing.js";
import {
  buildContextChanged,
  buildEditorContext,
  editorQuestionError,
  formatBuildState,
  parseBuildState,
} from "./build-request.js";
import { $, callStats, currentStatus, h, icon, inspect, toast } from "./common.js";
import {
  buildEditState,
  buildRawText,
  discardBuildRaw,
  renderQuestionCard,
  renderRaw,
  resetBuildRaw,
  undoBuildQuestion,
} from "./workbench-build-editor.js";
import {
  imagesFromSpecs,
  imagesPayload,
  renderBuildDraft,
  renderImages,
  resetBuildDraft,
} from "./workbench-build-inputs.js";
import {
  buildQuestionView,
  navigateBuildQuestion,
  questionFocusOut,
  refreshQuestionVisibility,
  renderBuildAuthoringTools,
  renderBuildContentTools,
  renderQuestionTools,
  resetBuildQuestionCleanup,
  visibleBuildQuestions,
} from "./workbench-build-question-tools.js";
import {
  boxWarning,
  buildRunContext,
  buildRunning,
  checkQuestions,
  clearBuildRunContext,
  exportCode,
  invalidateBuildRun,
  openBuildSaveForm,
  renderBoxes,
  renderBuildAnswerCards,
  renderExport,
  renderLint,
  renderSaveForm,
  run,
} from "./workbench-build-results.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";

export const TYPES = ["noul", "choice", "score", "box"];
let buildBaseline = null;

// Lab surface of this tab (contract: static/js/lab/surfaces/workbench-build.js). Functions that tests rebuild from
// this source reach Lab only through W (W.lab, W.labEnv, W.buildLabCtx), so they spell this id as a literal.
const BUILD_LAB_QUESTIONS = "workbench.build.questions";

// ---------- data helpers ----------
const parseMaybeJson = (s) => {
  if (typeof s !== "string") return s;
  const t = s.trim();
  if (/^[[{]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      /* keep as text */
    }
  }
  return s;
};
export const stringify = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
export const parseState = (text) => parseBuildState(text);

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
      q.criteria = Object.fromEntries(
        r.choice.filter(([k]) => k.trim()).map(([k, d]) => [k.trim(), d.trim() ? parseMaybeJson(d) : null]),
      );
    } else if (r.type === "score") {
      q.criteria = r.score.filter((s) => s.trim()).map(parseMaybeJson);
    } else if ((r.noulYes || "").trim() || (r.noulNo || "").trim()) {
      q.criteria = {
        true: (r.noulYes || "").trim() ? parseMaybeJson(r.noulYes) : null,
        false: (r.noulNo || "").trim() ? parseMaybeJson(r.noulNo) : null,
      };
    }
    out[id] = q;
  }
  return out;
}

export const questionEditorError = (rows = W.questions) => editorQuestionError(rows);

export const buildContext = () => buildEditorContext(W.stateText, [W.questions, buildRawText], imagesPayload());
export const buildUnsaved = () => buildContextChanged(buildContext(), buildBaseline);
export const buildResultStale = () => !!W.result && buildContextChanged(buildContext(), buildRunContext);

export function markBuildEdited() {
  W.exported = null;
  W.lint = null;
  $("#export")?.remove();
  $("#lint")?.remove();
  const stale = $("#build-stale");
  if (stale) stale.style.display = buildResultStale() ? "" : "none";
  const error = $("#build-validation");
  if (error) {
    error.textContent = questionEditorError() || "";
    error.hidden = !error.textContent;
  }
  const save = $("#build-save-test");
  if (save) save.disabled = !W.result || buildResultStale();
  const summary = $("#build-request-summary");
  if (summary) summary.textContent = buildRequestSummary(W.stateText, W.questions, W.images.length);
  if ($(".qlist")) refreshQuestionVisibility();
  W.questions.forEach((row, index) => {
    const characters = $(`#build-instruction-count-${index}`);
    if (characters)
      characters.textContent = `${Array.from(String(row.instructions || "")).length} instruction characters`;
    const count = $(`#build-criteria-count-${index}`);
    if (count)
      count.textContent =
        row.type === "choice"
          ? `${row.choice.filter(([key]) => key.trim()).length} named options`
          : row.type === "score"
            ? `${row.score.filter((level) => level.trim()).length} defined levels`
            : row.type === "noul"
              ? `${[row.noulYes, row.noulNo].filter((value) => String(value || "").trim()).length} defined outcomes`
              : "Coordinates only · no criteria";
  });
}

export function validBuildQuestions() {
  if (buildRawText !== null) {
    toast("Apply the Raw JSON edits before using this request.", "error");
    return null;
  }
  try {
    parseState(W.stateText);
  } catch (e) {
    toast(`State: ${e.message}`, "error");
    return null;
  }
  const error = questionEditorError();
  if (error) {
    toast(error, "error");
    return null;
  }
  const questions = toQuestions(W.questions);
  if (!Object.keys(questions).length) {
    toast("Add at least one question with an id.", "error");
    return null;
  }
  return questions;
}

export function fromQuestions(obj) {
  return Object.entries(obj || {}).map(([id, q]) => ({
    id,
    type: q.type,
    instructions: stringify(q.instructions),
    choice:
      q.type === "choice"
        ? Object.entries(q.criteria || {}).map(([k, d]) => [k, stringify(d)])
        : [
            ["", ""],
            ["", ""],
          ],
    score: q.type === "score" ? (q.criteria || []).map(stringify) : ["", "", ""],
    noulYes: q.type === "noul" ? stringify(q.criteria?.true) : "",
    noulNo: q.type === "noul" ? stringify(q.criteria?.false) : "",
  }));
}

export const blankRow = (type) => ({
  id: uniqueQuestionId(W.questions, `${type}_${W.questions.length + 1}`),
  type,
  instructions: "",
  choice: [
    ["", ""],
    ["", ""],
  ],
  score: ["", "", ""],
  noulYes: "",
  noulNo: "",
});

export function setBuildBaseline(context) {
  buildBaseline = context;
}

export const sampleUrl = (name) => `/img/samples/${name}.png`;

export function loadInto(
  state,
  questions,
  { expect = {}, name = "", notes = "", id = null, example = null, images = {}, handoff = null } = {},
) {
  if (buildUnsaved() && !window.confirm("Replace the unsaved Build request? Download a Build draft first to keep it."))
    return false;
  invalidateBuildRun();
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
  resetBuildRaw();
  W.tab = "build";
  clearBuildRunContext();
  resetBuildDraft();
  resetBuildQuestionCleanup();
  buildBaseline = buildContext();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  return true;
}

export function applyBuildQuestions(questions) {
  try {
    return loadInto(parseState(W.stateText), questions, { images: imagesPayload() });
  } catch (e) {
    toast(`State: ${e.message}`, "error");
    return false;
  }
}

function formatBuildStateText() {
  try {
    const formatted = formatBuildState(W.stateText);
    W.stateText = formatted.text;
    markBuildEdited();
    render();
    toast(formatted.message);
  } catch (e) {
    toast(`Could not format JSON: ${e.message}`, "error");
  }
}

function compactBuildStateText() {
  try {
    const state = parseState(W.stateText);
    if (!state || typeof state !== "object")
      return toast("Compact JSON needs an object or array; plain text stays unchanged.");
    // Validate above, then remove only whitespace outside strings. Re-serializing would
    // round large numeric literals or turn overflowing numbers into null.
    let compact = "",
      quoted = false,
      escaped = false;
    for (const char of W.stateText) {
      if (quoted) {
        compact += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') {
        quoted = true;
        compact += char;
      } else if (!/[ \t\r\n]/.test(char)) compact += char;
    }
    W.stateText = compact;
    markBuildEdited();
    render();
  } catch (e) {
    toast(`Could not compact JSON: ${e.message}`, "error");
  }
}

// ---------- Lab ----------
// The Lab ctx of this tab's questions, built once per page session from the builder the page's Lab index provides
// (W.lab.builders), and kept on W so the filter functions above reach it the way they reach W.lab. null until that
// builder exists. Every action goes through the same functions as the tab's own buttons.
function buildLabContexts() {
  if (W.buildLabCtx) return W.buildLabCtx;
  const build = W.lab?.builders?.wbBuildQuestionsCtx;
  if (!build) return null;
  W.buildLabCtx = {
    questions: build({
      rows: () => W.questions,
      expect: () => W.expect,
      stateText: () => W.stateText,
      images: () => W.images,
      result: () => W.result,
      stale: () => buildResultStale(),
      running: () => buildRunning,
      rawMode: () => W.raw,
      rawPending: () => buildRawText !== null,
      lint: () => W.lint,
      maxImages: () => W.maxImages,
      origin: () => ({ example: W.loadedExample, test: W.editingId, handoff: W.handoff?.source }),
      shownRows: () => visibleBuildQuestions(),
      arrange: (items, ctx) => W.lab.arrange(BUILD_LAB_QUESTIONS, items, ctx),
      commit: ({ rows, expect, origins }) => {
        const collapsed = buildEditState().collapsed;
        rows.forEach((row, index) => {
          if (origins[index] && collapsed.has(origins[index])) collapsed.add(row);
        });
        W.questions = rows;
        W.expect = expect;
        markBuildEdited();
        // Rendered once Lab has recorded the edit's Undo step, so the new Lab section shows it.
        queueMicrotask(render);
      },
      addQuestion: (type) => {
        W.questions.push(blankRow(type));
        markBuildEdited();
        render();
      },
      focus: (index) => navigateBuildQuestion(index),
      checkQuestions: () => checkQuestions(),
      exportCode: () => exportCode(),
      formatState: () => formatBuildStateText(),
      compactState: () => compactBuildStateText(),
      canUndoRemove: () => !!W.buildEditing?.deleted,
      undoRemove: () => undoBuildQuestion(),
      clearFilters: () => {
        for (const key of Object.keys(buildQuestionView)) delete buildQuestionView[key];
        Object.assign(buildQuestionView, { query: "", type: "all" });
        W.lab.reset(BUILD_LAB_QUESTIONS);
        render();
      },
      refresh: () => {
        refreshQuestionVisibility();
        arrangeBuildQuestionCards();
      },
    }),
  };
  return W.buildLabCtx;
}

// Card positions in display order: request order, or the shown cards in a Lab sort's order first. Run, export and
// every "shown" handoff keep request order; only the display follows the sort.
function buildLabQuestionOrder(shown) {
  const indexes = W.questions.map((_, index) => index);
  const ctx = W.buildLabCtx?.questions;
  if (!ctx || !W.lab?.active?.(BUILD_LAB_QUESTIONS)) return indexes;
  const shownItems = ctx.items().filter((item) => shown.has(W.questions[item.position - 1]));
  const arranged = W.lab.arrange(BUILD_LAB_QUESTIONS, shownItems, ctx).map((item) => item.position - 1);
  const placed = new Set(arranged);
  return [...arranged, ...indexes.filter((index) => !placed.has(index))];
}

// Re-orders the existing cards for a Lab sort without re-rendering, so their inputs keep focus and listeners.
function arrangeBuildQuestionCards() {
  const list = $(".qlist");
  if (!list) return;
  const cards = new Map(
    [...list.querySelectorAll(".build-question-card")].map((card) => [Number(card.dataset.questionIndex), card]),
  );
  for (const index of buildLabQuestionOrder(new Set(visibleBuildQuestions()))) {
    const card = cards.get(index);
    if (card) list.append(card);
  }
}

// ---------- Build ----------
// Says where an opened demo request came from, and that its answers did not come along.
function handoffNote() {
  const ho = W.handoff;
  if (!ho) return null;
  const model = currentStatus().model;
  return h(
    "div",
    { class: "callout" },
    icon("arrow"),
    h(
      "div",
      {},
      h("b", {}, `Opened from ${ho.source}`),
      h(
        "div",
        { class: "muted" },
        `This started as the exact request ${ho.source} sent. Its answers stayed in that tab: press Run to ask the model again,` +
          " then reword a question, save it as a test, or use the questions in Bulk." +
          (ho.model && model && ho.model !== model ? ` ${ho.source} asked ${ho.model}; Run asks ${model}.` : ""),
      ),
    ),
  );
}

export function renderBuild() {
  const labCtx = W.labEnv ? buildLabContexts() : null;
  const buildShown = new Set(visibleBuildQuestions());
  const stateArea = h(
    "textarea",
    {
      class: "input",
      spellcheck: "false",
      "aria-label": "Request state",
      placeholder: "Plain text, or a JSON object/array. Point questions at fields with `backticks`.",
    },
    W.stateText,
  );
  stateArea.addEventListener("input", () => {
    W.stateText = stateArea.value;
    markBuildEdited();
  });
  const left = h(
    "div",
    { class: "grid", style: { gap: "16px" } },
    handoffNote(),
    h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "panel-head" },
        h("h2", {}, "State"),
        h("div", { class: "spacer" }),
        h(
          "button",
          {
            class: "btn sm",
            onclick: formatBuildStateText,
            title: "Format a JSON object or array without changing plain text",
          },
          "Format JSON",
        ),
        h(
          "button",
          {
            class: "btn sm ghost",
            onclick: compactBuildStateText,
            title: "Remove JSON whitespace while preserving every value",
          },
          "Compact JSON",
        ),
        h(
          "span",
          { class: "faint", style: { fontSize: "12px" } },
          W.loadedExample
            ? `from example: ${W.loadedExample}`
            : W.editingId
              ? `editing test: ${W.editingId}`
              : W.handoff
                ? `from ${W.handoff.source}`
                : "",
        ),
      ),
      h(
        "div",
        { class: "panel-body state-box" },
        stateArea,
        h(
          "p",
          { id: "build-request-summary", class: "faint", style: { fontSize: "12px" } },
          buildRequestSummary(W.stateText, W.questions, W.images.length),
        ),
        renderBuildDraft(),
      ),
    ),
    renderImages(),
    h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "panel-head" },
        h("h2", {}, `Questions · ${W.questions.length}`),
        h("div", { class: "spacer" }),
        h(
          "button",
          {
            class: `btn sm ${W.raw ? "" : "ghost"}`,
            onclick: () => {
              W.raw = !W.raw;
              render();
            },
          },
          icon("code"),
          W.raw ? "Editor" : "Raw JSON",
        ),
      ),
      h(
        "div",
        { class: "panel-body grid", style: { gap: "10px" } },
        h(
          "p",
          { id: "build-validation", class: "critical-text", role: "alert", hidden: !questionEditorError() },
          questionEditorError(),
        ),
        !W.raw && buildRawText !== null
          ? h(
              "div",
              { class: "callout", role: "status" },
              h("span", {}, "Raw JSON has unapplied edits. Apply or discard them before using the request."),
              h(
                "button",
                {
                  class: "btn sm",
                  onclick: () => {
                    W.raw = true;
                    render();
                  },
                },
                "Review Raw JSON",
              ),
              h("button", { class: "btn sm ghost", onclick: discardBuildRaw }, "Discard Raw edits"),
            )
          : null,
        !W.raw ? renderQuestionTools() : null,
        !W.raw ? renderBuildAuthoringTools() : null,
        !W.raw ? renderBuildContentTools() : null,
        !W.raw && labCtx
          ? W.lab.section(W.labEnv, BUILD_LAB_QUESTIONS, labCtx.questions, { title: "Lab tools for questions" })
          : null,
        W.raw
          ? renderRaw()
          : h(
              "div",
              { class: "qlist" },
              buildLabQuestionOrder(buildShown).map((i) =>
                h(
                  "div",
                  {
                    class: "build-question-card",
                    "data-question-index": String(i),
                    hidden: !buildShown.has(W.questions[i]),
                    onfocusout: questionFocusOut,
                  },
                  renderQuestionCard(W.questions[i], i),
                ),
              ),
            ),
        !W.raw
          ? h(
              "div",
              { class: "chips" },
              TYPES.map((t) =>
                h(
                  "button",
                  {
                    class: "chip",
                    onclick: () => {
                      W.questions.push(blankRow(t));
                      markBuildEdited();
                      render();
                    },
                  },
                  icon("plus"),
                  `Add ${t}`,
                ),
              ),
              buildEditState().deleted
                ? h(
                    "button",
                    { class: "btn sm", onclick: undoBuildQuestion },
                    `Undo remove ${buildEditState().deleted.id || "question"}`,
                  )
                : null,
            )
          : null,
      ),
    ),
  );

  const runBtn = h(
    "button",
    { class: "btn primary", id: "build-run", disabled: buildRunning, onclick: run },
    icon("bolt"),
    buildRunning ? "Running…" : "Run",
  );
  const right = h(
    "div",
    { class: "grid", style: { gap: "16px" } },
    h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "panel-head" },
        h("h2", {}, "Answers"),
        h("div", { class: "spacer" }),
        h(
          "button",
          {
            class: "btn sm",
            onclick: checkQuestions,
            title: "Read the questions for common mistakes. Plain code: no model call, no cost.",
          },
          icon("search"),
          "Check questions",
        ),
        h("button", { class: "btn sm", onclick: exportCode }, icon("code"), "Export code"),
        h(
          "button",
          {
            class: "btn sm",
            id: "build-save-test",
            disabled: !W.result || buildResultStale(),
            onclick: () => openBuildSaveForm(),
          },
          icon("save"),
          "Save as test",
        ),
        runBtn,
      ),
      h(
        "p",
        { id: "build-stale", class: "callout", role: "status", style: { display: buildResultStale() ? "" : "none" } },
        "These answers are from the previous request. Inputs or questions have changed; run again to answer the current request.",
      ),
      boxWarning(),
      W.result
        ? h(
            "div",
            { class: "panel-body grid", style: { gap: "12px" } },
            callStats(W.result.meta, () => inspect(W.result.trace, "Workbench · one Jev request")),
            renderBoxes(),
            h("div", { class: "answers", id: "build-answers" }, renderBuildAnswerCards()),
          )
        : h(
            "div",
            { class: "empty" },
            "Press Run. Every question is evaluated in parallel against the state, in one request.",
          ),
    ),
    W.lint ? renderLint() : null,
    W.saveOpen && W.result && !buildResultStale() ? renderSaveForm() : null,
    W.exported ? renderExport() : null,
    h(
      "div",
      { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Writing good questions")),
      h(
        "div",
        { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
        h(
          "p",
          { class: "muted" },
          "One judgment per question. If you would need a paragraph to explain the answer, split it.",
        ),
        h(
          "p",
          { class: "muted" },
          "Say exactly what a yes means and what it does not mean; Jev reads instructions literally.",
        ),
        h(
          "p",
          { class: "muted" },
          "Keep math, dates, counting, and exact lookups in code. Ask Jev to pick from options, not to generate values.",
        ),
        h(
          "p",
          { class: "muted" },
          "Include a “none of these” option when nothing may fit, and read confidence before acting.",
        ),
        h(
          "p",
          { class: "muted" },
          "A Box always returns four edges, even when the target is missing. Ask a Noul whether it is there, and ignore the box when that is low.",
        ),
        h(
          "p",
          { class: "faint" },
          "Docs: ",
          h(
            "a",
            {
              href: "https://docs.typesafe.ai/concepts/how-to-build-with-system-one",
              target: "_blank",
              rel: "noopener",
            },
            "How to build with TypeSafe",
          ),
          " · ",
          h(
            "a",
            { href: "https://docs.typesafe.ai/model-jaggedness/jev-1.13", target: "_blank", rel: "noopener" },
            "Known jagged edges",
          ),
        ),
      ),
    ),
  );
  return h("div", { class: "grid wb-grid" }, left, right);
}
