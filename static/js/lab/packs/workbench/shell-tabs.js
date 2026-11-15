// Tab and guide tools for the Workbench shell ("workbench.shell"): commands that jump to the first or last tab, read
// the tab bar and the saved counts aloud, report guide progress and the steps not available yet, and open Examples
// when Build has no questions; metrics for saved tests, checks, datasets without a check, questions a gate cannot
// read and guide steps done; tab-bar and guide-step exports; a tab switcher and a guide step list. Everything
// navigates or counts: nothing runs, labels, applies or saves, and nothing holds inputs, questions, labels, answers
// or prices.
import { csvText, definePack } from "../../kit.js";

// Each unsaved area of the page's leave-page warning and the tab it lives on.
const AREAS = [["build", "Build request", "build"], ["bulk", "Bulk rows or labels", "bulk"], ["labeling", "pre-run label drafts", "bulk"],
  ["review", "Review queue labels", "bulk"], ["drift", "new-traffic labels", "bulk"], ["datasetEdits", "dataset repairs", "bulk"],
  ["agreement", "second-labeling session", "bulk"]];

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// Whether a guide step's work shows in the workspace (the rule the starter pack's checklist uses). "review" happens
// outside the page, so it never reads as done.
export function stepDone(step, workspace) {
  if (!workspace) return false;
  return { questions: workspace.questionCount > 0, rows: workspace.rowCount > 0, labels: workspace.healthCurrent,
    run: workspace.currentRun, policy: workspace.hasSavedCheck }[step.id] === true;
}

const unsavedOn = (ctx, tabId) => AREAS.filter(([key, , home]) => home === tabId && ctx.data.unsaved[key]).map(([, name]) => name);

function edgeTab(id, title, pick) {
  return { id, kind: "command", group: "Workbench tabs", title,
    when: (ctx) => { const tab = pick(ctx.data.tabs); return !!tab && !tab.active; },
    run: (ctx) => {
      const tab = pick(ctx.data.tabs);
      if (!tab) throw new Error("The Workbench has no tabs.");
      if (tab.active) throw new Error(`The ${tab.label} tab is already open.`);
      return ctx.actions.openTab(tab.id);
    } };
}

const countsMetric = (id, label, compute, help) => ({ id, kind: "metric", format: "integer", label, help,
  compute: (ctx) => (ctx.data.counts ? compute(ctx.data.counts) : null) });

function attempt(api, work) {
  try { work(); } catch (error) { api.toast(error.message, "error"); }
}

function switcherPanel(h, ctx, api) {
  const tabs = ctx.data.tabs;
  if (!tabs.length) return h("p", { class: "faint" }, "The Workbench has no tabs.");
  return h("div", { role: "group", "aria-label": "Workbench tabs" }, tabs.map((tab) => {
    const unsaved = unsavedOn(ctx, tab.id);
    const previous = tab.id === ctx.data.previousTab;
    const label = `${tab.position}. ${tab.label}${tab.count ? ` (${tab.count})` : ""}`;
    return h("div", { "data-tab": tab.id },
      tab.active ? h("strong", { "aria-current": "page" }, `${label} · open`)
        : h("button", { class: "btn sm ghost", "data-go": tab.id, onclick: () => attempt(api, () => ctx.actions.openTab(tab.id)) }, label),
      unsaved.length ? h("span", { class: "faint", "data-part": "unsaved" }, ` · unsaved: ${unsaved.join(", ")}`) : null,
      previous ? h("span", { class: "faint", "data-part": "previous" }, " · open before this one ",
        h("button", { class: "btn sm ghost", "data-back": tab.id, onclick: () => attempt(api, () => ctx.actions.openTab(tab.id)) }, "Back")) : null);
  }));
}

function stepsPanel(h, ctx, api) {
  const steps = ctx.data.steps;
  if (!steps.length) return h("p", { class: "faint" }, "The guide has no steps.");
  return h("ol", {}, steps.map((step) => h("li", { "data-step": step.id },
    h("span", {}, `${step.title} — ${step.status}`),
    stepDone(step, ctx.data.workspace) ? h("span", { class: "faint", "data-part": "done" }, " · done") : null,
    step.enabled ? h("button", { class: "btn sm ghost", "data-go": step.id, "aria-label": `${step.action}: ${step.title}`,
      onclick: () => attempt(api, () => ctx.actions.goToStep(step.id)) }, step.action || "Go")
      : h("span", { class: "faint", "data-part": "waiting" }, " · not available yet"))));
}

export default definePack({
  id: "shell-tabs",
  surface: "workbench.shell",
  title: "Workbench tabs and guide steps",
  about: "Commands that open the first or last tab, read the tab bar and saved counts, report guide progress and the steps not available yet, and open Examples when Build has no questions; metrics for saved tests, checks, datasets without a check, questions a gate cannot read and guide steps done; tab-bar CSV and guide-step JSON exports; a tab switcher and a guide step list with Go buttons. Navigation and counts only: nothing runs, labels or saves.",
  features: [
    edgeTab("first_tab", "Go to the first Workbench tab", (tabs) => tabs[0] || null),
    edgeTab("last_tab", "Go to the last Workbench tab", (tabs) => tabs[tabs.length - 1] || null),
    { id: "read_tab_bar", kind: "command", group: "Workbench tabs", title: "Read out the tab bar",
      help: "Each tab with its position, saved tests on Tests, which one is open and which hold unsaved work.",
      run: (ctx) => ctx.env.toast(`Tabs: ${ctx.data.tabs.map((tab) => {
        const notes = [tab.count ? `${tab.count} saved` : null, tab.active ? "open" : null, unsavedOn(ctx, tab.id).length ? "unsaved work" : null].filter(Boolean);
        return `${tab.position} ${tab.label}${notes.length ? ` (${notes.join(", ")})` : ""}`;
      }).join(", ")}.`) },
    { id: "show_counts", kind: "command", group: "Workbench", title: "Show the saved tests, examples, datasets and checks in one line",
      when: (ctx) => ctx.data.counts !== null,
      run: (ctx) => {
        const counts = ctx.data.counts;
        if (!counts) throw new Error("The page has not loaded its counts yet.");
        ctx.env.toast(`${plural(counts.savedTests, "saved test")}, ${plural(counts.examples, "gallery example")}, ${plural(counts.datasets, "saved dataset")} (${counts.checks} with a check).`);
      } },
    { id: "show_guide_progress", kind: "command", group: "Workbench guide", title: "Say how far the guide's steps are done",
      help: "A step reads as done when the workspace shows its work; status describes the workspace, not accuracy.",
      when: (ctx) => ctx.data.workspace !== null,
      run: (ctx) => {
        if (!ctx.data.workspace) throw new Error("The workspace has not loaded yet.");
        const steps = ctx.data.steps;
        const done = steps.filter((step) => stepDone(step, ctx.data.workspace));
        const next = steps.find((step) => !done.includes(step));
        ctx.env.toast(`Guide: ${done.length} of ${steps.length} steps done.${next ? ` First not done: ${next.title}.` : ""}`);
      } },
    { id: "show_waiting_steps", kind: "command", group: "Workbench guide", title: "List the guide steps that are not available yet, with what each says",
      when: (ctx) => ctx.data.steps.some((step) => !step.enabled),
      run: (ctx) => {
        const waiting = ctx.data.steps.filter((step) => !step.enabled);
        ctx.env.toast(waiting.length ? `Not available yet: ${waiting.map((step) => `${step.title} (${step.status})`).join("; ")}.` : "Every guide step is available.");
      } },
    { id: "start_from_example", kind: "command", group: "Workbench", title: "Start from an example: open the Examples tab while Build has no questions",
      help: "Opens the gallery only; opening an example into Build stays your own click.",
      when: (ctx) => ctx.data.workspace !== null && ctx.data.workspace.questionCount === 0 && ctx.data.tab !== "examples",
      run: (ctx) => {
        if (!ctx.data.workspace || ctx.data.workspace.questionCount > 0) throw new Error("Build already has questions selected.");
        return ctx.actions.openTab("examples");
      } },

    countsMetric("saved_tests", "Saved tests", (counts) => counts.savedTests),
    countsMetric("saved_checks", "Saved datasets with a check", (counts) => counts.checks),
    countsMetric("datasets_without_check", "Saved datasets without a check", (counts) => Math.max(0, counts.datasets - counts.checks),
      "A dataset needs a tuned Policy gate saved as a check before scripts/check.py can rerun it."),
    { id: "ungateable_questions", kind: "metric", format: "integer", label: "Selected questions a gate cannot read",
      help: "Box questions: they return coordinates, which a gate cannot threshold.",
      compute: (ctx) => (ctx.data.workspace ? Math.max(0, ctx.data.workspace.questionCount - ctx.data.workspace.gateableCount) : null) },
    { id: "guide_steps_done", kind: "metric", format: "integer", label: "Guide steps done",
      help: "Steps whose work shows in the workspace now. Status, not accuracy.",
      compute: (ctx) => (ctx.data.workspace ? { value: ctx.data.steps.filter((step) => stepDone(step, ctx.data.workspace)).length, detail: `of ${ctx.data.steps.length}` } : null) },

    { id: "tab_bar_csv", kind: "exporter", label: "Tab bar (CSV)", help: "position, tab id, label, open, saved tests (Tests only) and unsaved areas; nothing else",
      filename: "workbench-tabs.csv", mime: "text/csv",
      build: (ctx) => csvText([["position", "id", "label", "open", "saved_tests", "unsaved"],
        ...ctx.data.tabs.map((tab) => [tab.position, tab.id, tab.label, tab.active ? "yes" : "no", tab.count ?? "", unsavedOn(ctx, tab.id).join("; ")])]) },
    { id: "steps_json", kind: "exporter", label: "Guide steps (JSON)", help: "each step's id, title, tab, button wording, status wording, available and done; no workspace contents",
      filename: "workbench-guide-steps.json", mime: "application/json",
      build: (ctx) => `${JSON.stringify(ctx.data.steps.map((step) => ({ id: step.id, position: step.position, title: step.title, tab: step.tab,
        action: step.action, status: step.status, available: step.enabled, done: stepDone(step, ctx.data.workspace) })), null, 2)}\n` },

    { id: "switcher", kind: "panel", title: "Tab switcher",
      improvements: [
        { id: "buttons", title: "A button per Workbench tab with its position and saved-test count, the open tab marked instead" },
        { id: "unsaved_marks", title: "Mark the tabs that hold unsaved work, naming the areas" },
        { id: "back", title: "Mark the tab that was open before this one, with a Back button" },
      ],
      render: switcherPanel },
    { id: "step_list", kind: "panel", title: "Guide steps",
      improvements: [
        { id: "list", title: "List the six guide steps with the guide's status, marking those whose work shows as done" },
        { id: "go", title: "A button per available step that only navigates, and a note on each step not available yet" },
      ],
      render: stepsPanel },
  ],
});
