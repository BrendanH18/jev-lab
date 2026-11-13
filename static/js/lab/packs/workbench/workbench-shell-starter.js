// Page-level commands, workspace counts and a guide checklist for the Workbench shell ("workbench.shell"). Everything
// navigates or counts: nothing here runs, labels, applies or saves, and nothing reads inputs, labels or answers.
import { definePack } from "../../kit.js";

const TAB_NAMES = { build: "Build", tests: "Tests", bulk: "Bulk", compare: "Compare", examples: "Examples", toolbox: "Toolbox" };
const UNSAVED_NAMES = { build: "Build request", bulk: "Bulk rows or labels", labeling: "pre-run label drafts", review: "Review queue labels",
  drift: "new-traffic labels", datasetEdits: "dataset repairs", agreement: "second-labeling session" };

const openTab = (id) => ({ id: `open_${id}`, kind: "command", group: "Workbench tabs", title: `Go to the ${TAB_NAMES[id]} tab`,
  when: (ctx) => ctx.data.tab !== id && ctx.data.tabs.some((tab) => tab.id === id),
  run: (ctx) => ctx.actions.openTab(id) });

// The tab `step` places away from the open one in the tab bar, wrapping around.
function neighbour(ctx, step) {
  const tabs = ctx.data.tabs;
  if (tabs.length < 2) return null;
  const at = Math.max(0, tabs.findIndex((tab) => tab.active));
  return tabs[(at + step + tabs.length) % tabs.length].id;
}

// Whether a guide step's work shows in the workspace. "review" happens outside the page, so it never reads as done.
function stepDone(step, workspace) {
  if (!workspace) return false;
  return { questions: workspace.questionCount > 0, rows: workspace.rowCount > 0, labels: workspace.healthCurrent,
    run: workspace.currentRun, policy: workspace.hasSavedCheck }[step.id] === true;
}

const nextStep = (ctx) => ctx.data.steps.find((step) => step.enabled && !stepDone(step, ctx.data.workspace)) || null;

const goStep = (id, title) => ({ id: `step_${id}`, kind: "command", group: "Workbench guide", title: `Guide: ${title}`,
  when: (ctx) => ctx.data.steps.some((step) => step.id === id && step.enabled),
  run: (ctx) => ctx.actions.goToStep(id) });

const fromWorkspace = (key) => (ctx) => (ctx.data.workspace ? ctx.data.workspace[key] : null);

export default definePack({
  id: "workbench-shell-starter",
  surface: "workbench.shell",
  title: "Workbench page tools",
  about: "Palette commands for every Workbench tab and guide step, workspace counts and a guide checklist. Navigation and counts only: nothing runs, labels or saves, and exports hold tab names, step titles, counts and flags, never inputs, labels or answers.",
  features: [
    openTab("build"), openTab("tests"), openTab("bulk"), openTab("compare"), openTab("examples"), openTab("toolbox"),
    { id: "next_tab", kind: "command", group: "Workbench tabs", title: "Go to the next tab", keys: "Alt+PageDown",
      when: (ctx) => neighbour(ctx, 1) !== null, run: (ctx) => ctx.actions.openTab(neighbour(ctx, 1)) },
    { id: "tab_to_left", kind: "command", group: "Workbench tabs", title: "Go to the tab on the left", keys: "Alt+PageUp",
      when: (ctx) => neighbour(ctx, -1) !== null, run: (ctx) => ctx.actions.openTab(neighbour(ctx, -1)) },
    { id: "back_tab", kind: "command", group: "Workbench tabs", title: "Go back to the previously open tab",
      when: (ctx) => ctx.data.previousTab !== null, run: (ctx) => ctx.actions.openTab(ctx.data.previousTab) },
    { id: "focus_tabs", kind: "command", group: "Workbench tabs", title: "Move the keyboard focus to the tab bar", run: (ctx) => ctx.actions.focusTabs() },
    { id: "copy_tab_link", kind: "command", group: "Workbench tabs", title: "Copy a link to this tab",
      run: (ctx) => ctx.env.copy(`/workbench#${ctx.data.tab}`) },
    { id: "toggle_guide", kind: "command", group: "Workbench guide", title: "Open or close the Workbench guide",
      run: (ctx) => ctx.actions.setGuideOpen(!ctx.data.guideOpen) },
    { id: "next_step", kind: "command", group: "Workbench guide", title: "Go to the next guide step to do",
      when: (ctx) => nextStep(ctx) !== null,
      run: (ctx) => {
        const step = nextStep(ctx);
        if (!step) throw new Error("No guide step is available right now.");
        ctx.env.toast(`${step.title}: ${step.status}.`);
        return ctx.actions.goToStep(step.id);
      } },
    goStep("questions", "define typed questions"), goStep("rows", "add representative inputs"), goStep("labels", "inspect and label the data"),
    goStep("run", "run the selected questions"), goStep("policy", "tune a policy and save a check"), goStep("review", "export a gate and review traffic"),
    { id: "show_unsaved", kind: "command", group: "Workbench", title: "List unsaved work on this page",
      run: (ctx) => {
        const unsaved = ctx.data.unsaved;
        const names = Object.keys(UNSAVED_NAMES).filter((key) => unsaved[key]).map((key) => UNSAVED_NAMES[key]);
        ctx.env.toast(names.length ? `Unsaved: ${names.join(", ")}.` : "Nothing on this page is unsaved.", "");
      } },

    { id: "questions_selected", kind: "metric", format: "integer", label: "Questions selected for Bulk", compute: fromWorkspace("questionCount"),
      help: "The questions Bulk would ask now." },
    { id: "rows_in_editor", kind: "metric", format: "integer", label: "Rows in the Bulk editor", compute: fromWorkspace("rowCount") },
    { id: "gateable_questions", kind: "metric", format: "integer", label: "Questions a gate can use", compute: fromWorkspace("gateableCount"),
      help: "Choice, Noul and Score questions; Box answers cannot be gated." },
    { id: "steps_available", kind: "metric", format: "integer", label: "Guide steps available now",
      compute: (ctx) => (ctx.data.workspace ? ctx.data.steps.filter((step) => step.enabled).length : null) },
    { id: "unsaved_areas", kind: "metric", format: "integer", label: "Areas with unsaved work",
      compute: (ctx) => (ctx.data.counts ? Object.keys(UNSAVED_NAMES).filter((key) => ctx.data.unsaved[key]).length : null),
      help: "The same checks as the page's leave-page warning." },
    { id: "check_share", kind: "metric", format: "percent", label: "Saved datasets with a check",
      compute: (ctx) => {
        const counts = ctx.data.counts;
        if (!counts || !counts.datasets) return null;
        return { value: counts.checks / counts.datasets, detail: `${counts.checks} of ${counts.datasets}` };
      } },

    { id: "guide_checklist", kind: "exporter", label: "Guide checklist (Markdown)", help: "step titles and the guide's status wording only",
      filename: "workbench-checklist.md", mime: "text/markdown",
      build: (ctx) => ["# Workbench checklist", "", ...ctx.data.steps.map((step) =>
        `- [${stepDone(step, ctx.data.workspace) ? "x" : " "}] ${step.title} — ${step.status}${step.enabled ? "" : " (not available yet)"}`)].join("\n") + "\n" },
    { id: "workspace_summary", kind: "exporter", label: "Workspace summary (JSON)", help: "the open tab, counts and flags only; no inputs, labels or answers",
      filename: "workbench-workspace.json", mime: "application/json",
      build: (ctx) => JSON.stringify({ tab: ctx.data.tab, counts: ctx.data.counts, workspace: ctx.data.workspace, unsaved: ctx.data.unsaved }, null, 2) },
  ],
});
