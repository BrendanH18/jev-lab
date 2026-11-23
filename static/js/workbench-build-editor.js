// Build question cards and Raw JSON editing.
import { shownQuestionIndex } from "./build-authoring.js";
import {
  duplicateChoiceOption,
  duplicateQuestionRow,
  insertEditorCriterion,
  moveEditorEntry,
  moveEditorEntryTo,
  removeBlankEditorCriteria,
  removeEditorQuestion,
  renameEditorQuestion,
  restoreEditorQuestion,
} from "./build-editing.js";
import { parseUniqueJson } from "./build-request.js";
import { $, copyText, h, icon, toast } from "./common.js";
import {
  buildQuestionView,
  navigateBuildQuestion,
  reorderBuildCriteria,
  shareAuthoringQuestions,
  visibleBuildQuestions,
} from "./workbench-build-question-tools.js";
import {
  TYPES,
  blankRow,
  fromQuestions,
  markBuildEdited,
  questionEditorError,
  toQuestions,
} from "./workbench-build.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";

export let buildRawText = null;

export function resetBuildRaw() {
  buildRawText = null;
}

export const buildEditState = () => W.buildEditing || (W.buildEditing = { collapsed: new WeakSet(), deleted: null });

function deleteBuildQuestion(index) {
  const removed = removeEditorQuestion(W.questions, W.expect, index);
  if (!removed) return;
  W.questions = removed.rows;
  W.expect = removed.expect;
  buildEditState().deleted = removed.undo;
  markBuildEdited();
  render();
}

export function undoBuildQuestion() {
  try {
    const restored = restoreEditorQuestion(W.questions, W.expect, buildEditState().deleted);
    if (!restored) return;
    W.questions = restored.rows;
    W.expect = restored.expect;
    buildEditState().deleted = null;
    markBuildEdited();
    render();
  } catch (e) {
    toast(e.message, "error");
  }
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
  markBuildEdited();
  render();
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
  } catch (e) {
    toast(e.message, "error");
  }
}

function insertBuildQuestion(index, after) {
  W.questions.splice(index + Number(after), 0, blankRow(W.questions[index].type));
  for (const key of Object.keys(buildQuestionView)) delete buildQuestionView[key];
  Object.assign(buildQuestionView, { query: "", type: "all" });
  W.lab?.reset?.("workbench.build.questions");
  markBuildEdited();
  render();
}

export function discardBuildRaw() {
  if (
    buildRawText === null ||
    !window.confirm("Discard the unapplied Raw JSON edits? The question editor will keep its current questions.")
  )
    return;
  buildRawText = null;
  W.raw = false;
  markBuildEdited();
  render();
}

function editorMoveButtons(entries, index, label, apply) {
  return [-1, 1].map((direction) => {
    const title = `Move ${label} ${direction < 0 ? "up" : "down"}`;
    return h(
      "button",
      {
        class: "btn sm ghost",
        title,
        "aria-label": title,
        disabled: index + direction < 0 || index + direction >= entries.length,
        onclick: () => {
          apply(moveEditorEntry(entries, index, direction));
          markBuildEdited();
          render();
        },
      },
      direction < 0 ? "↑" : "↓",
    );
  });
}

export function renderRaw() {
  const error = buildRawText === null ? questionEditorError() : null;
  if (error)
    return h(
      "div",
      { class: "raw grid", style: { gap: "8px" } },
      h("p", { role: "alert" }, `Fix the editor errors before opening Raw JSON: ${error}`),
      h(
        "button",
        {
          class: "btn sm",
          onclick: () => {
            W.raw = false;
            render();
          },
        },
        "Back to editor",
      ),
    );
  const discard = h(
    "button",
    { class: "btn sm ghost", disabled: buildRawText === null, onclick: discardBuildRaw },
    "Discard Raw edits",
  );
  const area = h(
    "textarea",
    { class: "input", spellcheck: "false", "aria-label": "Questions as JSON" },
    buildRawText ?? JSON.stringify(toQuestions(W.questions), null, 2),
  );
  area.addEventListener("input", () => {
    buildRawText = area.value;
    discard.disabled = false;
    markBuildEdited();
  });
  return h(
    "div",
    { class: "raw grid", style: { gap: "8px" } },
    area,
    h(
      "div",
      { style: { display: "flex", gap: "8px" } },
      h(
        "button",
        {
          class: "btn sm primary",
          onclick: () => {
            try {
              const rows = fromQuestions(parseUniqueJson(area.value));
              const error = questionEditorError(rows);
              if (error) throw new Error(error);
              W.questions = rows;
              W.buildEditing = null;
              buildRawText = null;
              W.raw = false;
              markBuildEdited();
              render();
            } catch (e) {
              toast(`Invalid JSON: ${e.message}`, "error");
            }
          },
        },
        "Apply",
      ),
      discard,
      h(
        "span",
        { class: "faint", style: { fontSize: "12px", alignSelf: "center" } },
        "Same shape as the API's questions map. Structured instructions and criteria (objects, arrays) are allowed.",
      ),
    ),
  );
}

export function renderQuestionCard(row, i) {
  const collapsed = buildEditState().collapsed.has(row);
  const copyButton = h(
    "button",
    {
      class: "btn sm ghost",
      disabled: !String(row.id || "").trim(),
      "aria-label": `Copy question ${row.id || i + 1} JSON`,
      onclick: () => {
        if (!String(row.id || "").trim()) return toast("Give this question an id before copying it.", "error");
        const error = questionEditorError([row]);
        if (error) return toast(error, "error");
        copyText(JSON.stringify(toQuestions([row]), null, 2));
      },
    },
    "Copy JSON",
  );
  const idInput = h("input", {
    class: "input mono",
    value: row.id,
    placeholder: "question_id",
    "aria-label": `Question ${i + 1} id`,
  });
  idInput.addEventListener("input", () => {
    row.id = idInput.value;
    copyButton.disabled = !String(row.id || "").trim();
    markBuildEdited();
  });
  const typeSel = h(
    "select",
    { class: "input", "aria-label": `Question ${i + 1} type` },
    TYPES.map((t) => h("option", { value: t, selected: row.type === t }, t)),
  );
  typeSel.addEventListener("change", () => {
    row.type = typeSel.value;
    markBuildEdited();
    render();
  });
  const instr = h(
    "textarea",
    {
      class: "input",
      "aria-label": `Instructions for ${row.id || `question ${i + 1}`}`,
      placeholder:
        row.type === "box"
          ? "What to find and in which picture, e.g. the coffee mug in `photo`."
          : "Instructions: the question, as a person would ask it. Refer to state fields with `backticks`.",
    },
    row.instructions,
  );
  instr.addEventListener("input", () => {
    row.instructions = instr.value;
    markBuildEdited();
  });

  let crit;
  if (row.type === "box") {
    crit = h(
      "div",
      { class: "faint", style: { fontSize: "12px" } },
      "A Box takes no criteria. The answer is the four edges of the target as fractions of the picture's width and height. Needs an image and Jev 1.14+.",
    );
  } else if (row.type === "choice") {
    crit = h(
      "div",
      { class: "crit" },
      h("div", { class: "section-label", style: { margin: 0 } }, "Options (key → description, description optional)"),
      h("button", { class: "btn sm ghost", onclick: () => reorderBuildCriteria(i, "sort") }, "Sort options by key"),
      h(
        "button",
        { class: "btn sm ghost", onclick: () => reorderBuildCriteria(i, "sort-desc") },
        "Sort options descending",
      ),
      h(
        "button",
        { class: "btn sm ghost", onclick: () => reorderBuildCriteria(i, "description") },
        "Sort descriptions A–Z",
      ),
      h(
        "button",
        { class: "btn sm ghost", onclick: () => reorderBuildCriteria(i, "description-desc") },
        "Sort descriptions Z–A",
      ),
      h("button", { class: "btn sm ghost", onclick: () => reorderBuildCriteria(i, "reverse") }, "Reverse options"),
      row.choice.map((pair, j) => {
        const k = h("input", { class: "input mono", value: pair[0], placeholder: "option_key" });
        const d = h("input", { class: "input", value: pair[1], placeholder: "what this option means" });
        k.addEventListener("input", () => {
          pair[0] = k.value;
          markBuildEdited();
        });
        d.addEventListener("input", () => {
          pair[1] = d.value;
          markBuildEdited();
        });
        return h(
          "div",
          { class: "cr" },
          k,
          d,
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gridColumn: "1 / -1" } },
            editorMoveButtons(row.choice, j, `option ${pair[0] || j + 1}`, (entries) => {
              row.choice = entries;
            }),
            [
              [0, "first"],
              [row.choice.length - 1, "last"],
            ].map(([target, label]) =>
              h(
                "button",
                {
                  class: "btn sm ghost",
                  disabled: j === target,
                  "aria-label": `Move option ${pair[0] || j + 1} ${label}`,
                  onclick: () => {
                    row.choice = moveEditorEntryTo(row.choice, j, target);
                    markBuildEdited();
                    render();
                  },
                },
                label,
              ),
            ),
            [false, true].map((after) =>
              h(
                "button",
                {
                  class: "btn sm ghost",
                  "aria-label": `Insert option ${after ? "after" : "before"} ${pair[0] || j + 1}`,
                  onclick: () => {
                    row.choice = insertEditorCriterion(row.choice, j, after, "choice");
                    markBuildEdited();
                    render();
                  },
                },
                after ? "Insert after" : "Insert before",
              ),
            ),
            h(
              "button",
              {
                class: "btn sm ghost",
                "aria-label": `Duplicate option ${pair[0] || j + 1}`,
                onclick: () => {
                  row.choice = duplicateChoiceOption(row.choice, j);
                  markBuildEdited();
                  render();
                },
              },
              "Duplicate",
            ),
            h(
              "button",
              {
                class: "btn sm ghost",
                title: "Remove option",
                "aria-label": `Remove option ${pair[0] || j + 1}`,
                onclick: () => {
                  row.choice.splice(j, 1);
                  markBuildEdited();
                  render();
                },
              },
              icon("x"),
            ),
          ),
        );
      }),
      h(
        "div",
        {},
        h(
          "button",
          {
            class: "chip",
            onclick: () => {
              row.choice.push(["", ""]);
              markBuildEdited();
              render();
            },
          },
          icon("plus"),
          "Add option",
        ),
      ),
    );
  } else if (row.type === "score") {
    crit = h(
      "div",
      { class: "crit" },
      h(
        "div",
        { class: "section-label", style: { margin: 0 } },
        "Levels, in order from 0 (moving a level changes its numeric score)",
      ),
      h("button", { class: "btn sm ghost", onclick: () => reorderBuildCriteria(i, "reverse") }, "Reverse levels…"),
      row.score.map((lvl, j) => {
        const d = h("input", { class: "input", value: lvl, placeholder: `level ${j}` });
        d.addEventListener("input", () => {
          row.score[j] = d.value;
          markBuildEdited();
        });
        return h(
          "div",
          { class: "cr score" },
          h("span", { class: "lv" }, String(j)),
          d,
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gridColumn: "1 / -1" } },
            editorMoveButtons(row.score, j, `level ${j}`, (entries) => {
              row.score = entries;
            }),
            [
              [0, "first"],
              [row.score.length - 1, "last"],
            ].map(([target, label]) =>
              h(
                "button",
                {
                  class: "btn sm ghost",
                  disabled: j === target,
                  "aria-label": `Move level ${j} ${label}`,
                  title: "Moving levels changes their numeric scores",
                  onclick: () => {
                    row.score = moveEditorEntryTo(row.score, j, target);
                    markBuildEdited();
                    render();
                  },
                },
                label,
              ),
            ),
            [false, true].map((after) =>
              h(
                "button",
                {
                  class: "btn sm ghost",
                  "aria-label": `Insert level ${after ? "after" : "before"} ${j}`,
                  title: "Inserting levels changes later numeric scores",
                  onclick: () => {
                    row.score = insertEditorCriterion(row.score, j, after, "score");
                    markBuildEdited();
                    render();
                  },
                },
                after ? "Insert after" : "Insert before",
              ),
            ),
            h(
              "button",
              {
                class: "btn sm ghost",
                "aria-label": `Duplicate level ${j}`,
                title: "Insert a copy after this level; later numeric scores move up",
                onclick: () => {
                  row.score.splice(j + 1, 0, row.score[j]);
                  markBuildEdited();
                  render();
                },
              },
              "Duplicate",
            ),
            h(
              "button",
              {
                class: "btn sm ghost",
                title: "Remove level",
                "aria-label": `Remove level ${j}`,
                onclick: () => {
                  row.score.splice(j, 1);
                  markBuildEdited();
                  render();
                },
              },
              icon("x"),
            ),
          ),
        );
      }),
      h(
        "div",
        {},
        h(
          "button",
          {
            class: "chip",
            onclick: () => {
              row.score.push("");
              markBuildEdited();
              render();
            },
          },
          icon("plus"),
          "Add level",
        ),
      ),
    );
  } else {
    const yes = h("input", { class: "input", value: row.noulYes, placeholder: "optional: what a yes means" });
    const no = h("input", { class: "input", value: row.noulNo, placeholder: "optional: what a no means" });
    yes.addEventListener("input", () => {
      row.noulYes = yes.value;
      markBuildEdited();
    });
    no.addEventListener("input", () => {
      row.noulNo = no.value;
      markBuildEdited();
    });
    crit = h(
      "div",
      { class: "crit" },
      h("div", { class: "cr noul" }, h("span", { class: "k" }, "yes"), yes),
      h("div", { class: "cr noul" }, h("span", { class: "k" }, "no"), no),
    );
  }
  return h(
    "div",
    { class: "qcard" },
    h(
      "div",
      { class: "row" },
      idInput,
      typeSel,
      h(
        "button",
        {
          class: "btn sm ghost",
          "aria-expanded": String(!collapsed),
          "aria-label": `${collapsed ? "Expand" : "Collapse"} question ${row.id || i + 1}`,
          onclick: () => {
            const state = buildEditState();
            if (collapsed) state.collapsed.delete(row);
            else state.collapsed.add(row);
            render();
          },
        },
        collapsed ? "Expand" : "Collapse",
      ),
    ),
    h(
      "div",
      { class: "chips" },
      editorMoveButtons(W.questions, i, `question ${row.id || i + 1}`, (entries) => {
        W.questions = entries;
      }),
      [
        [0, "first"],
        [W.questions.length - 1, "last"],
      ].map(([target, label]) =>
        h(
          "button",
          {
            class: "btn sm ghost",
            disabled: i === target,
            "aria-label": `Move question ${row.id || i + 1} ${label}`,
            onclick: () => {
              W.questions = moveEditorEntryTo(W.questions, i, target);
              markBuildEdited();
              render();
            },
          },
          `Move ${label}`,
        ),
      ),
      h("button", { class: "btn sm ghost", onclick: () => moveBuildQuestionToPosition(i) }, "Move to position"),
      copyButton,
      h("button", { class: "btn sm ghost", onclick: () => renameBuildQuestion(i) }, "Rename safely"),
      [false, true].map((after) =>
        h(
          "button",
          { class: "btn sm ghost", onclick: () => insertBuildQuestion(i, after) },
          after ? "Insert after" : "Insert before",
        ),
      ),
      h("button", { class: "btn sm ghost", onclick: () => copyText(row.instructions || "") }, "Copy instructions"),
      h(
        "button",
        {
          class: "btn sm ghost",
          onclick: () => {
            const normalized = [{ ...row, id: "question" }];
            const error = questionEditorError(normalized);
            if (error) return toast(error, "error");
            const question = Object.values(toQuestions(normalized))[0];
            copyText(JSON.stringify(question.criteria ?? {}, null, 2));
          },
        },
        "Copy criteria",
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          onclick: () => duplicateBuildQuestion(i),
          "aria-label": `Duplicate question ${row.id || i + 1}`,
        },
        "Duplicate",
      ),
      h(
        "button",
        {
          class: "btn sm ghost",
          title: "Remove question",
          "aria-label": `Remove question ${row.id || i + 1}`,
          onclick: () => deleteBuildQuestion(i),
        },
        icon("trash"),
        "Remove",
      ),
    ),
    h(
      "details",
      {},
      h("summary", {}, "Question navigation and sharing"),
      h(
        "div",
        { class: "chips" },
        ["previous", "next"].map((direction) =>
          h(
            "button",
            {
              class: "btn sm ghost",
              onclick: () => {
                const target = shownQuestionIndex(W.questions, visibleBuildQuestions(), i, direction);
                if (target < 0) return toast(`No ${direction} shown question.`);
                navigateBuildQuestion(target);
              },
            },
            `${direction === "previous" ? "Previous" : "Next"} shown question`,
          ),
        ),
        h("button", { class: "btn sm ghost", onclick: () => navigateBuildQuestion(i, true) }, "Focus instructions"),
        h(
          "button",
          {
            class: "btn sm ghost",
            onclick: () => {
              if (buildRawText !== null)
                return toast("Apply the Raw JSON edits before sharing editor questions.", "error");
              copyText(String(row.id || ""));
            },
          },
          "Copy id",
        ),
        h(
          "button",
          { class: "btn sm ghost", onclick: () => shareAuthoringQuestions("markdown-copy", i) },
          "Copy question Markdown",
        ),
        h(
          "button",
          { class: "btn sm ghost", onclick: () => shareAuthoringQuestions("question-json", i) },
          "Download question JSON",
        ),
      ),
    ),
    h(
      "span",
      { class: "faint", id: `build-criteria-count-${i}`, "aria-live": "polite" },
      row.type === "choice"
        ? `${row.choice.filter(([key]) => key.trim()).length} named options`
        : row.type === "score"
          ? `${row.score.filter((level) => level.trim()).length} defined levels`
          : row.type === "noul"
            ? `${[row.noulYes, row.noulNo].filter((value) => String(value || "").trim()).length} defined outcomes`
            : "Coordinates only · no criteria",
    ),
    h(
      "span",
      { class: "faint", id: `build-instruction-count-${i}`, "aria-live": "polite" },
      `${Array.from(String(row.instructions || "")).length} instruction characters`,
    ),
    ["choice", "score"].includes(row.type)
      ? h(
          "button",
          {
            class: "btn sm ghost",
            onclick: () => {
              W.questions[i] = removeBlankEditorCriteria(row);
              markBuildEdited();
              render();
            },
            title: "Remove empty placeholders only; keep unnamed descriptions and every defined criterion",
          },
          "Remove blank criterion rows",
        )
      : null,
    collapsed
      ? h(
          "p",
          { class: "faint", style: { margin: 0, overflowWrap: "anywhere" } },
          row.instructions
            ? `${row.instructions.slice(0, 160)}${row.instructions.length > 160 ? "…" : ""}`
            : "No instructions yet",
        )
      : [instr, crit],
  );
}
