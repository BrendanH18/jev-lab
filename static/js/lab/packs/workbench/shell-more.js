// More page tools for the Workbench shell ("workbench.shell"): navigation commands, workspace readouts, exports of
// counts and the guide's wording, and a session overview. Everything navigates or counts: nothing here runs, labels,
// applies or saves, and nothing reads or exports inputs, questions, labels, answers or prices.
import { csvText, definePack } from "../../kit.js";

// Each unsaved area of the page's leave-page warning, with the tab it lives on.
const AREAS = [
  ["build", "Build request", "build"], ["bulk", "Bulk rows or labels", "bulk"], ["labeling", "pre-run label drafts", "bulk"],
  ["review", "Review queue labels", "bulk"], ["drift", "new-traffic labels", "bulk"], ["datasetEdits", "dataset repairs", "bulk"],
  ["agreement", "second-labeling session", "bulk"],
];

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const tabLabel = (ctx, id) => ctx.data.tabs.find((tab) => tab.id === id)?.label || id;

// Whether a guide step's work shows in the workspace (the same rule as the starter pack's checklist). "review"
// happens outside the page, so it never reads as done.
function stepDone(step, workspace) {
  if (!workspace) return false;
  return { questions: workspace.questionCount > 0, rows: workspace.rowCount > 0, labels: workspace.healthCurrent,
    run: workspace.currentRun, policy: workspace.hasSavedCheck }[step.id] === true;
}

// The first unavailable guide step and the step that provides what it needs, or null.
function prerequisite(ctx) {
  const workspace = ctx.data.workspace;
  if (!workspace) return null;
  const steps = ctx.data.steps;
  const blocked = steps.find((step) => !step.enabled);
  if (!blocked) return null;
  const [needId, need] = workspace.questionCount === 0 ? ["questions", "selected questions"]
    : workspace.rowCount === 0 ? ["rows", "rows in the Bulk editor"]
      : !workspace.currentRun ? ["run", "a current Bulk run"]
        : workspace.gateableCount === 0 ? ["questions", "a Choice, Noul or Score question"] : [null, null];
  const target = steps.find((step) => step.id === needId && step.enabled);
  return target ? { blocked, need, target } : null;
}

// The tabs that hold unsaved work, in tab-bar order, with the area names on each.
function unsavedTabs(ctx) {
  const unsaved = ctx.data.unsaved;
  return ctx.data.tabs.map((tab) => ({ tab, areas: AREAS.filter(([key, , home]) => home === tab.id && unsaved[key]).map(([, name]) => name) }))
    .filter((entry) => entry.areas.length > 0);
}

// The next tab with unsaved work after the open one, wrapping around; never the open tab.
function nextUnsaved(ctx) {
  const tabs = ctx.data.tabs;
  const at = Math.max(0, tabs.findIndex((tab) => tab.active));
  const holding = new Map(unsavedTabs(ctx).map((entry) => [entry.tab.id, entry]));
  for (let step = 1; step < tabs.length; step++) {
    const entry = holding.get(tabs[(at + step) % tabs.length].id);
    if (entry) return entry;
  }
  return null;
}

const fromCounts = (key) => (ctx) => (ctx.data.counts ? ctx.data.counts[key] : null);

function attempt(api, work) {
  try { work(); } catch (error) { api.toast(error.message, "error"); }
}

function overviewPanel(h, ctx, api) {
  const workspace = ctx.data.workspace;
  const steps = ctx.data.steps;
  const done = workspace ? steps.filter((step) => stepDone(step, workspace)) : [];
  const todo = steps.filter((step) => !done.includes(step));
  const readiness = workspace
    ? h("div", { "data-part": "readiness" },
      h("label", {}, h("span", {}, `Guide steps done: ${done.length} of ${steps.length}`), " ",
        h("progress", { max: String(steps.length), value: String(done.length), "aria-label": "Guide steps done" })),
      todo.length ? h("p", { class: "faint", "data-part": "todo" }, `Still to do: ${todo.map((step) => step.title).join(", ")}.`) : null)
    : h("p", { class: "faint", "data-part": "readiness" }, "The workspace has not loaded yet.");
  const holding = unsavedTabs(ctx);
  const unsaved = holding.length
    ? h("ul", { "data-part": "unsaved" }, holding.flatMap((entry) => entry.areas.map((name) => h("li", { "data-area": name },
      `${name} · ${entry.tab.label} tab `,
      entry.tab.active ? h("span", { class: "faint" }, "(open now)")
        : h("button", { class: "btn sm ghost", "data-go": entry.tab.id, "aria-label": `Go to the ${entry.tab.label} tab`,
          onclick: () => attempt(api, () => ctx.actions.openTab(entry.tab.id)) }, "Go")))))
    : h("p", { class: "faint", "data-part": "unsaved" }, "Nothing on this page is unsaved.");
  return h("div", {}, readiness, h("h4", {}, "Unsaved work"), unsaved,
    h("p", { class: "faint" }, "Status describes the workspace, not accuracy or a passing check."));
}

export default definePack({
  id: "shell-more",
  surface: "workbench.shell",
  title: "More Workbench page tools",
  about: "Navigation commands (tab links, where you are, guide statuses, a step's missing prerequisite, unsaved work), gallery and dataset counts, checklist, counts, unsaved-work and handoff exports, and a session overview of guide progress and unsaved work. Navigation and counts only: nothing runs, labels or saves, and exports hold tab names, the guide's wording, counts and flags, never inputs, questions, labels, answers or prices.",
  features: [
    { id: "copy_tab_links", kind: "command", group: "Workbench tabs", title: "Copy links to every Workbench tab as a Markdown list",
      when: (ctx) => ctx.data.tabs.length > 0,
      run: (ctx) => ctx.env.copy(ctx.data.tabs.map((tab) => `- [${tab.label}](/workbench#${tab.id})`).join("\n") + "\n") },
    { id: "where_tab", kind: "command", group: "Workbench tabs", title: "Say which tab is open and where it sits in the tab bar",
      run: (ctx) => {
        const tabs = ctx.data.tabs;
        const open = tabs.find((tab) => tab.active);
        const counts = ctx.data.counts;
        const saved = counts ? ` ${plural(counts.savedTests, "saved test")}.` : "";
        ctx.env.toast(open ? `${open.label} tab: ${open.position} of ${tabs.length}.${saved}` : `No Workbench tab is open.${saved}`);
      } },
    { id: "step_statuses", kind: "command", group: "Workbench guide", title: "Show every guide step's status in one line",
      when: (ctx) => ctx.data.steps.length > 0,
      run: (ctx) => ctx.env.toast(ctx.data.steps.map((step) => `${step.position}. ${step.title}: ${step.status}${step.enabled ? "" : " (not available yet)"}`).join("; ") + ".") },
    { id: "go_prerequisite", kind: "command", group: "Workbench guide", title: "Go to what the first unavailable guide step needs",
      help: "Navigation only: nothing runs or saves.",
      when: (ctx) => prerequisite(ctx) !== null,
      run: (ctx) => {
        const found = prerequisite(ctx);
        if (!found) throw new Error("Every guide step is available.");
        ctx.env.toast(`${found.blocked.title} needs ${found.need}. Going to ${found.target.title}.`);
        return ctx.actions.goToStep(found.target.id);
      } },
    { id: "go_unsaved", kind: "command", group: "Workbench", title: "Go to the next tab with unsaved work",
      when: (ctx) => nextUnsaved(ctx) !== null,
      run: (ctx) => {
        const entry = nextUnsaved(ctx);
        if (!entry) throw new Error("No other tab has unsaved work.");
        ctx.env.toast(`Unsaved on ${entry.tab.label}: ${entry.areas.join(", ")}.`);
        return ctx.actions.openTab(entry.tab.id);
      } },

    { id: "gallery_examples", kind: "metric", format: "integer", label: "Gallery examples", compute: fromCounts("examples") },
    { id: "saved_datasets", kind: "metric", format: "integer", label: "Saved datasets", compute: fromCounts("datasets") },

    { id: "checklist_csv", kind: "exporter", label: "Guide checklist (CSV)", help: "step number, title, the guide's status wording, available and done; nothing else",
      filename: "workbench-checklist.csv", mime: "text/csv",
      build: (ctx) => csvText([["step", "title", "status", "available", "done"],
        ...ctx.data.steps.map((step) => [step.position, step.title, step.status, step.enabled ? "yes" : "no", stepDone(step, ctx.data.workspace) ? "yes" : "no"])]) },
    { id: "counts_csv", kind: "exporter", label: "Workspace counts (one-row CSV)",
      help: "saved tests, examples, datasets, checks, selected and gateable questions, rows and three flags; blank before the page has loaded",
      filename: "workbench-counts.csv", mime: "text/csv",
      build: (ctx) => {
        const counts = ctx.data.counts || {}, workspace = ctx.data.workspace || {};
        const flag = (value) => (value === undefined ? "" : value ? "yes" : "no");
        return csvText([["saved_tests", "examples", "datasets", "checks", "questions_selected", "gateable_questions", "rows", "current_run", "health_report_current", "saved_check"],
          [counts.savedTests ?? "", counts.examples ?? "", counts.datasets ?? "", counts.checks ?? "", workspace.questionCount ?? "", workspace.gateableCount ?? "",
            workspace.rowCount ?? "", flag(workspace.currentRun), flag(workspace.healthCurrent), flag(workspace.hasSavedCheck)]]);
      } },
    { id: "unsaved_markdown", kind: "exporter", label: "Unsaved-work report (Markdown)", help: "each area's name, its tab and whether it has unsaved work; no contents",
      filename: "workbench-unsaved.md", mime: "text/markdown",
      build: (ctx) => {
        const unsaved = ctx.data.unsaved;
        const count = AREAS.filter(([key]) => unsaved[key]).length;
        return ["# Unsaved work on the Workbench", "",
          ...AREAS.map(([key, name, home]) => `- ${name} · ${tabLabel(ctx, home)} tab · ${unsaved[key] ? "unsaved" : "nothing unsaved"}`), "",
          count ? `${plural(count, "area")} with unsaved work.` : "Nothing on this page is unsaved."].join("\n") + "\n";
      } },
    { id: "handoff_markdown", kind: "exporter", label: "Session handoff note (Markdown)",
      help: "the open tab, counts, the guide's step statuses and the names of unsaved areas; no inputs, questions, labels, answers or prices",
      filename: "workbench-handoff.md", mime: "text/markdown",
      build: (ctx) => {
        const counts = ctx.data.counts, workspace = ctx.data.workspace;
        const unsaved = AREAS.filter(([key]) => ctx.data.unsaved[key]).map(([, name, home]) => `- ${name} (${tabLabel(ctx, home)} tab)`);
        return ["# Workbench session handoff", "", `Open tab: ${tabLabel(ctx, ctx.data.tab)}`, "", "## Counts", "",
          ...(counts && workspace ? [`- Saved tests: ${counts.savedTests}`, `- Gallery examples: ${counts.examples}`,
            `- Saved datasets: ${counts.datasets} (${counts.checks} with a check)`, `- Questions selected for Bulk: ${workspace.questionCount}`,
            `- Rows in the Bulk editor: ${workspace.rowCount}`] : ["The page has not loaded its counts yet."]), "",
          "## Guide steps", "", ...ctx.data.steps.map((step) => `${step.position}. ${step.title} — ${step.status}${step.enabled ? "" : " (not available yet)"}`), "",
          "## Unsaved work", "", ...(unsaved.length ? unsaved : ["Nothing on this page is unsaved."]), "",
          "Counts and the guide's wording only. Status describes the workspace, not accuracy or a passing check."].join("\n") + "\n";
      } },

    { id: "overview", kind: "panel", title: "Session overview",
      improvements: [
        { id: "readiness", title: "Readiness meter: guide steps done out of six, naming the steps still to do" },
        { id: "unsaved_list", title: "Unsaved-work list naming each area and its tab, with a Go button for a tab that is not open" },
      ],
      render: overviewPanel },
  ],
});
