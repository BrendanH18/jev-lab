// Build question filters, sharing, authoring tools and cleanup previews.
import { editorAuthoringSummary, editorOutlineCsv, shownQuestionIndex } from "./build-authoring.js";
import {
  duplicateShownQuestions,
  editorQuestionOutline,
  editorQuestionsMarkdown,
  matchesEditorQuestion,
  moveShownQuestionsToEdge,
  reorderEditorCriteria,
  shownEditorInstructions,
} from "./build-editing.js";
import {
  applyBuildCleanup,
  buildDiagnosticsMetadata,
  prepareBuildCleanup,
  renderBuildRefinements,
  undoBuildCleanup,
} from "./build-refinements.js";
import { $, copyText, h, toast } from "./common.js";
import { buildEditState, buildRawText } from "./workbench-build-editor.js";
import { TYPES, markBuildEdited, questionEditorError, toQuestions } from "./workbench-build.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";

let buildCleanupPreview = null;
let buildCleanupUndo = null;
export const buildQuestionView = { query: "", type: "all" };

export function resetBuildQuestionCleanup() {
  buildCleanupPreview = null;
  buildCleanupUndo = null;
}

export function visibleBuildQuestions() {
  // Keep an edited card visible until focus leaves it, so filtering never interrupts typing.
  const focusedIndex = Number($(".build-question-card:focus-within")?.dataset.questionIndex ?? -1);
  const idCounts = new Map();
  if (["with", "without"].includes(buildQuestionView.duplicateIds)) {
    for (const row of W.questions) {
      const id = String(row.id || "").trim();
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
  }
  // Lab filters count like the page's own (reached through W; absent in tests and before the Lab index exists).
  const labCtx = W.lab?.active?.("workbench.build.questions") ? W.buildLabCtx?.questions : null;
  const labItems = labCtx ? labCtx.items() : null;
  return W.questions.filter(
    (row, index) =>
      index === focusedIndex ||
      (matchesEditorQuestion(row, { ...buildQuestionView, idCounts }, W.expect) &&
        (!labItems || W.lab.matches("workbench.build.questions", labItems[index], labCtx))),
  );
}

export function refreshQuestionVisibility() {
  const shown = new Set(visibleBuildQuestions());
  $(".qlist")
    ?.querySelectorAll(".build-question-card")
    .forEach((card) => {
      card.hidden = !shown.has(W.questions[Number(card.dataset.questionIndex)]);
    });
  const count = $("#build-question-count");
  const labActive = W.lab?.active?.("workbench.build.questions") || 0;
  if (count)
    count.textContent = `${shown.size} of ${W.questions.length} questions shown. Run and export include every question.${labActive ? ` ${labActive} Lab setting${labActive === 1 ? "" : "s"} active.` : ""}`;
  for (const id of [
    "build-copy-shown",
    "build-duplicate-shown",
    "build-copy-shown-json",
    "build-download-shown-json",
    "build-download-outline",
    "build-copy-shown-instructions",
    "build-download-shown-markdown",
    "build-move-shown-first",
    "build-move-shown-last",
  ]) {
    const button = $(`#${id}`);
    if (button) button.disabled = !shown.size;
  }
  const empty = $("#build-question-no-match");
  if (empty) empty.hidden = shown.size > 0;
  if ($("#build-authoring-summary")) refreshAuthoringSummary();
}

export function questionFocusOut(event) {
  if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
  // Focus events can run before the next element becomes :focus-within.
  setTimeout(refreshQuestionVisibility, 0);
}

export function renderQuestionTools() {
  const shown = visibleBuildQuestions().length;
  const labActive = W.lab?.active?.("workbench.build.questions") || 0;
  return h(
    "div",
    { class: "grid", style: { gap: "8px" } },
    h("input", {
      class: "input",
      type: "search",
      "aria-label": "Search Build questions",
      value: buildQuestionView.query,
      placeholder: "Search ids, instructions or criteria",
      oninput: (event) => {
        buildQuestionView.query = event.target.value;
        refreshQuestionVisibility();
      },
    }),
    h(
      "div",
      { class: "chips" },
      h(
        "select",
        {
          class: "input sm",
          "aria-label": "Search Build question field",
          onchange: (event) => {
            buildQuestionView.searchField = event.target.value;
            refreshQuestionVisibility();
          },
        },
        [
          ["all", "All question fields"],
          ["id", "Ids only"],
          ["instructions", "Instructions only"],
          ["criteria", "Criteria only"],
          ["choiceKeys", "Choice keys only"],
          ["descriptions", "Criterion descriptions only"],
        ].map(([value, label]) =>
          h("option", { value, selected: (buildQuestionView.searchField || "all") === value }, label),
        ),
      ),
      h("input", {
        class: "input sm",
        type: "search",
        "aria-label": "Exclude Build question text",
        placeholder: "Exclude text in search field",
        value: buildQuestionView.exclude || "",
        oninput: (event) => {
          buildQuestionView.exclude = event.target.value;
          refreshQuestionVisibility();
        },
      }),
      h("input", {
        class: "input sm",
        type: "search",
        "aria-label": "Build question id prefix",
        placeholder: "Id starts with",
        value: buildQuestionView.idPrefix || "",
        oninput: (event) => {
          buildQuestionView.idPrefix = event.target.value;
          refreshQuestionVisibility();
        },
      }),
      [
        ["minCriteria", "Minimum defined criteria"],
        ["maxCriteria", "Maximum defined criteria"],
        ["minInstructions", "Minimum instruction characters"],
        ["maxInstructions", "Maximum instruction characters"],
      ].map(([key, label]) =>
        h("input", {
          class: "input sm",
          type: "number",
          min: "0",
          step: "1",
          "aria-label": label,
          placeholder: label,
          value: buildQuestionView[key] || "",
          oninput: (event) => {
            buildQuestionView[key] = event.target.value;
            refreshQuestionVisibility();
          },
        }),
      ),
      h(
        "select",
        {
          class: "input sm",
          "aria-label": "Filter Build question type",
          onchange: (event) => {
            buildQuestionView.type = event.target.value;
            refreshQuestionVisibility();
          },
        },
        ["all", ...TYPES].map((type) =>
          h(
            "option",
            { value: type, selected: buildQuestionView.type === type },
            type === "all" ? "All question types" : type,
          ),
        ),
      ),
      [
        ["instructions", "Instructions"],
        ["criteria", "Defined criteria"],
        ["expectations", "Human expectations"],
      ].map(([field, label]) =>
        h(
          "label",
          { class: "faint" },
          label,
          " ",
          h(
            "select",
            {
              class: "input sm",
              "aria-label": `Filter Build ${label.toLowerCase()}`,
              onchange: (event) => {
                buildQuestionView[field] = event.target.value;
                refreshQuestionVisibility();
              },
            },
            [
              ["all", "Any"],
              ["with", "With"],
              ["without", "Without"],
            ].map(([value, text]) =>
              h("option", { value, selected: (buildQuestionView[field] || "all") === value }, text),
            ),
          ),
        ),
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          id: "build-copy-shown",
          disabled: !shown,
          onclick: () =>
            copyText(
              visibleBuildQuestions()
                .map((row) => row.id)
                .join("\n"),
            ),
        },
        "Copy shown ids",
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          id: "build-copy-shown-json",
          disabled: !shown,
          onclick: () => shareShownQuestions("copy"),
        },
        "Copy shown questions JSON",
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          id: "build-download-shown-json",
          disabled: !shown,
          onclick: () => shareShownQuestions("json"),
        },
        "Download shown questions JSON",
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          id: "build-download-outline",
          disabled: !shown,
          onclick: () => shareShownQuestions("outline"),
        },
        "Download shown outline",
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          id: "build-copy-shown-instructions",
          disabled: !shown,
          onclick: () => shareShownQuestions("instructions"),
        },
        "Copy shown instructions",
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          id: "build-download-shown-markdown",
          disabled: !shown,
          onclick: () => shareShownQuestions("markdown"),
        },
        "Download shown Markdown",
      ),
      [false, true].map((last) =>
        h(
          "button",
          {
            class: "btn sm ghost",
            id: `build-move-shown-${last ? "last" : "first"}`,
            disabled: !shown,
            onclick: () => {
              W.questions = moveShownQuestionsToEdge(W.questions, visibleBuildQuestions(), last);
              markBuildEdited();
              render();
            },
          },
          last ? "Move shown last" : "Move shown first",
        ),
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          id: "build-duplicate-shown",
          disabled: !shown,
          onclick: () => {
            W.questions = duplicateShownQuestions(W.questions, visibleBuildQuestions());
            markBuildEdited();
            render();
          },
        },
        "Duplicate shown",
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          onclick: () => {
            for (const key of Object.keys(buildQuestionView)) delete buildQuestionView[key];
            Object.assign(buildQuestionView, { query: "", type: "all" });
            W.lab?.reset?.("workbench.build.questions");
            render();
          },
        },
        "Clear question filters",
      ),
      [true, false].map((collapse) =>
        h(
          "button",
          {
            class: "btn sm ghost",
            onclick: () => {
              for (const row of visibleBuildQuestions()) {
                if (collapse) buildEditState().collapsed.add(row);
                else buildEditState().collapsed.delete(row);
              }
              render();
            },
          },
          collapse ? "Collapse shown" : "Expand shown",
        ),
      ),
    ),
    h(
      "span",
      { class: "faint", id: "build-question-count", "aria-live": "polite" },
      `${shown} of ${W.questions.length} questions shown. Run and export include every question.${labActive ? ` ${labActive} Lab setting${labActive === 1 ? "" : "s"} active.` : ""}`,
    ),
    h(
      "p",
      { class: "faint", id: "build-question-no-match", hidden: shown > 0 },
      "No questions match. Clear filters to show every question.",
    ),
  );
}

function shareShownQuestions(format) {
  if (buildRawText !== null) return toast("Apply the Raw JSON edits before sharing editor questions.", "error");
  const rows = visibleBuildQuestions();
  if (!rows.length) return toast("No questions are shown.", "error");
  if (format === "instructions") return copyText(shownEditorInstructions(rows));
  let text;
  if (format === "markdown") text = editorQuestionsMarkdown(rows);
  else if (format === "outline") text = editorQuestionOutline(rows);
  else {
    if (rows.some((row) => !String(row.id || "").trim()))
      return toast("Give every shown question an id before sharing JSON.", "error");
    const error = questionEditorError(rows);
    if (error) return toast(error, "error");
    text = JSON.stringify(toQuestions(rows), null, 2) + "\n";
  }
  if (format === "copy") return copyText(text);
  const url = URL.createObjectURL(
    new Blob([text], {
      type:
        format === "markdown"
          ? "text/markdown;charset=utf-8"
          : format === "outline"
            ? "text/plain;charset=utf-8"
            : "application/json",
    }),
  );
  h("a", {
    href: url,
    download:
      format === "markdown"
        ? "jev-questions.md"
        : format === "outline"
          ? "jev-question-outline.txt"
          : "jev-questions.json",
  }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function authoringSummaryText() {
  const summary = editorAuthoringSummary(visibleBuildQuestions());
  return `Shown types: ${Object.entries(summary.counts)
    .map(([type, count]) => `${count} ${type}`)
    .join(
      " · ",
    )} · ${summary.bytes} authored UTF-8 bytes (ids, instructions and active criteria; excludes state and pictures). Counts are not spend estimates.`;
}

function refreshAuthoringSummary() {
  const summary = $("#build-authoring-summary");
  if (summary) summary.textContent = authoringSummaryText();
  const shown = visibleBuildQuestions();
  for (const id of [
    "build-first-shown",
    "build-last-shown",
    "build-copy-outline",
    "build-outline-csv",
    "build-instructions-text",
    "build-copy-markdown",
  ]) {
    const button = $(`#${id}`);
    if (button) button.disabled = !shown.length;
  }
}

export function navigateBuildQuestion(index, instructions = false) {
  if (index < 0 || !W.questions[index]) return;
  const row = W.questions[index];
  if (instructions) buildEditState().collapsed.delete(row);
  render();
  const card = $(`.build-question-card[data-question-index="${index}"]`);
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
  (instructions ? card?.querySelector("textarea") : card?.querySelector("input"))?.focus({ preventScroll: true });
}

export function shareAuthoringQuestions(format, singleIndex = null) {
  if (buildRawText !== null) return toast("Apply the Raw JSON edits before sharing editor questions.", "error");
  const rows =
    singleIndex === null ? visibleBuildQuestions() : W.questions[singleIndex] ? [W.questions[singleIndex]] : [];
  if (!rows.length) return toast("No questions are shown.", "error");
  if (format === "outline-copy") return copyText(editorQuestionOutline(rows));
  if (format === "markdown-copy") return copyText(editorQuestionsMarkdown(rows));
  let text, filename, mime;
  if (format === "outline-csv") {
    text = editorOutlineCsv(rows);
    filename = "jev-question-outline.csv";
    mime = "text/csv;charset=utf-8";
  } else if (format === "instructions-text") {
    text = shownEditorInstructions(rows);
    filename = "jev-instructions.txt";
    mime = "text/plain;charset=utf-8";
  } else {
    if (rows.some((row) => !String(row.id || "").trim())) return toast("Give every shared question an id.", "error");
    const error = questionEditorError(rows);
    if (error) return toast(error, "error");
    text = JSON.stringify(toQuestions(rows), null, 2) + "\n";
    filename = "jev-question.json";
    mime = "application/json";
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  h("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderBuildAuthoringTools() {
  const shown = visibleBuildQuestions();
  const selector = (field, label, options) =>
    h(
      "label",
      { class: "faint" },
      label,
      " ",
      h(
        "select",
        {
          class: "input sm",
          "aria-label": label,
          onchange: (event) => {
            buildQuestionView[field] = event.target.value;
            refreshQuestionVisibility();
          },
        },
        options.map(([value, text]) =>
          h("option", { value, selected: (buildQuestionView[field] || "all") === value }, text),
        ),
      ),
    );
  return h(
    "details",
    {
      ontoggle: (event) => {
        buildQuestionView.toolsOpen = event.target.open;
      },
      open: !!buildQuestionView.toolsOpen,
    },
    h("summary", {}, "Advanced authoring tools"),
    h(
      "div",
      { class: "grid", style: { gap: "8px", marginTop: "8px" } },
      h(
        "div",
        { class: "chips" },
        [
          ["idSuffix", "Build question id suffix", "Id ends with"],
          ["idExact", "Exact Build question id", "Exact id"],
        ].map(([field, label, placeholder]) =>
          h("input", {
            class: "input sm",
            type: "search",
            value: buildQuestionView[field] || "",
            "aria-label": label,
            placeholder,
            oninput: (event) => {
              buildQuestionView[field] = event.target.value;
              refreshQuestionVisibility();
            },
          }),
        ),
        [
          ["minIdCharacters", "Minimum id characters"],
          ["maxIdCharacters", "Maximum id characters"],
          ["minInstructionLines", "Minimum instruction lines"],
          ["maxInstructionLines", "Maximum instruction lines"],
        ].map(([field, label]) =>
          h("input", {
            class: "input sm",
            type: "number",
            min: 0,
            step: 1,
            value: buildQuestionView[field] ?? "",
            "aria-label": label,
            placeholder: label,
            oninput: (event) => {
              buildQuestionView[field] = event.target.value;
              refreshQuestionVisibility();
            },
          }),
        ),
        selector("instructionFormat", "Instruction format", [
          ["all", "Any format"],
          ["structured", "JSON object or array"],
          ["text", "Text and other literals"],
        ]),
        [
          ["placeholders", "Blank criterion placeholders"],
          ["unnamedChoice", "Unnamed Choice descriptions"],
          ["duplicateKeys", "Repeated Choice keys"],
          ["duplicateIds", "Repeated question ids"],
          ["references", "Backticked references"],
        ].map(([field, label]) =>
          selector(field, label, [
            ["all", "Any"],
            ["with", "With"],
            ["without", "Without"],
          ]),
        ),
      ),
      h(
        "div",
        { class: "chips" },
        [
          ["first", "First shown question"],
          ["last", "Last shown question"],
        ].map(([direction, label]) =>
          h(
            "button",
            {
              class: "btn sm",
              id: `build-${direction}-shown`,
              disabled: !shown.length,
              onclick: () =>
                navigateBuildQuestion(shownQuestionIndex(W.questions, visibleBuildQuestions(), -1, direction)),
            },
            label,
          ),
        ),
        [
          ["outline-copy", "build-copy-outline", "Copy shown outline"],
          ["outline-csv", "build-outline-csv", "Download shown outline CSV"],
          ["instructions-text", "build-instructions-text", "Download shown instructions"],
          ["markdown-copy", "build-copy-markdown", "Copy shown Markdown"],
        ].map(([format, id, label]) =>
          h(
            "button",
            { class: "btn sm ghost", id, disabled: !shown.length, onclick: () => shareAuthoringQuestions(format) },
            label,
          ),
        ),
      ),
      h("p", { class: "faint", id: "build-authoring-summary", "aria-live": "polite" }, authoringSummaryText()),
      h(
        "p",
        { class: "faint" },
        "Filters inspect authored content only. Repeated ids and Choice keys use trimmed, case-sensitive identities. Instruction lines include empty lines; an empty instruction has zero lines. No model calls or saved changes.",
      ),
    ),
  );
}

export function reorderBuildCriteria(index, action) {
  const row = W.questions[index];
  if (
    row.type === "score" &&
    !window.confirm(
      "Reverse Score levels? This changes the numeric meaning of every level. Existing human expectations stay unchanged; review them before running.",
    )
  )
    return;
  W.questions[index] = reorderEditorCriteria(row, action);
  markBuildEdited();
  render();
}

function cleanupBuildQuestions(action) {
  if (buildRawText !== null)
    return toast("Apply the Raw JSON edits before using content cleanup or diagnostics.", "error");
  const replaceRows = (rows) => {
    const collapsed = buildEditState().collapsed;
    rows.forEach((row, index) => {
      if (collapsed.has(W.questions[index])) collapsed.add(row);
    });
    W.questions = rows;
  };
  try {
    if (action === "preview") {
      buildCleanupPreview = prepareBuildCleanup(
        W.questions,
        W.expect,
        visibleBuildQuestions(),
        buildQuestionView.cleanupAction || "ids",
      );
    } else if (action === "apply") {
      const result = applyBuildCleanup(W.questions, W.expect, buildCleanupPreview);
      replaceRows(result.rows);
      buildCleanupUndo = result.undo;
      buildCleanupPreview = null;
      markBuildEdited();
    } else if (action === "undo") {
      replaceRows(undoBuildCleanup(W.questions, W.expect, buildCleanupUndo));
      buildCleanupUndo = null;
      buildCleanupPreview = null;
      markBuildEdited();
    } else if (action === "download") {
      const shown = visibleBuildQuestions();
      if (!shown.length) return toast("No questions are shown.", "error");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(buildDiagnosticsMetadata(shown), null, 2) + "\n"], { type: "application/json" }),
      );
      h("a", { href: url, download: "jev-question-diagnostics.json" }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    render();
  } catch (e) {
    toast(e.message, "error");
  }
}

export function renderBuildContentTools() {
  return renderBuildRefinements(h, {
    view: buildQuestionView,
    refresh: refreshQuestionVisibility,
    preview: buildCleanupPreview,
    undo: buildCleanupUndo,
    onPreview: () => cleanupBuildQuestions("preview"),
    onApply: () => cleanupBuildQuestions("apply"),
    onUndo: () => cleanupBuildQuestions("undo"),
    onDownload: () => cleanupBuildQuestions("download"),
    onCancel: () => {
      buildCleanupPreview = null;
      render();
    },
  });
}
