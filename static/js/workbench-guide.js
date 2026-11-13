// Navigation only: the guide never runs a request or changes the working data.
export function workflowSteps(snapshot = {}) {
  const { questionCount = 0, rowCount = 0, currentRun = false, healthCurrent = false,
    gateableCount = 0, hasSavedCheck = false } = snapshot;
  const canRun = questionCount > 0 && rowCount > 0;
  const canTune = currentRun && gateableCount > 0;
  return [
    { id: "questions", title: "Define typed questions", tab: "build", target: "#view", action: "Open Build",
      status: questionCount ? "Questions selected" : "Start here", enabled: true,
      detail: "Choose the judgments your code needs. Check the wording in Build; Bulk can also use sample or saved questions." },
    { id: "rows", title: "Add representative inputs", tab: "bulk", target: "#bulk-rows", action: "Open rows",
      status: rowCount ? "Rows in editor" : "Add inputs", enabled: true,
      detail: "Paste rows, import CSV, or load a dataset. Include the inputs and pictures your application will receive." },
    { id: "labels", title: "Inspect and label the data", tab: "bulk", target: "#dataset-health", action: "Inspect data",
      status: healthCurrent ? "Current health report available" : "Inspect before spending", enabled: canRun,
      detail: "Check dataset health, then use Label before running to fill missing human labels. Apply drafts and save the dataset explicitly." },
    { id: "run", title: "Run the selected questions", tab: "bulk", target: "#bulk-run", action: "Go to Run",
      status: currentRun ? "Current run available" : "Live call required", enabled: canRun,
      detail: "Press Run when ready. Each row makes a paid live request; opening this step does not start it." },
    { id: "policy", title: "Tune a policy and save a check", tab: "bulk", target: "#policy", action: "Open Policy",
      status: canTune ? "Policy available" : "Needs a current run with a gateable question", enabled: canTune,
      detail: "Use your labeled results to choose thresholds and review trade-offs. Save the dataset and a check with the targets you require." },
    { id: "review", title: "Export a gate and review traffic", tab: "bulk", target: "#datasets", action: "Open datasets and Review",
      status: hasSavedCheck ? "Saved check available" : "Save a check for the review cycle", enabled: true,
      detail: "Export a gate from Policy or a saved check. Run it in your application, then load its decisions into the dataset's Review queue for human labels and blind audits." },
  ];
}

// extra: an optional node shown at the end of the guide's body (the Workbench's "Page tools" Lab section).
export function renderWorkbenchGuide(h, snapshot, onNavigate, { open = false, onToggle = () => {}, extra = null } = {}) {
  return h("details", { class: "panel", open, ontoggle: (event) => onToggle(event.target.open) },
    h("summary", { class: "panel-head" }, "Workbench guide · from questions to reviewed decisions"),
    h("div", { class: "panel-body grid", style: { gap: "12px" } },
      h("p", { class: "muted" }, "Follow the steps you need. These shortcuts only navigate; you choose when to run, apply labels, or save. Status describes the current workspace, not accuracy or a passing check."),
      h("ol", { class: "grid", style: { gap: "12px", paddingLeft: "22px", margin: "0" } },
        workflowSteps(snapshot).map((step) => h("li", {},
          h("b", {}, step.title), h("span", { class: "faint" }, ` · ${step.status}`),
          h("p", { class: "muted" }, step.detail),
          h("button", { class: "btn sm", disabled: !step.enabled,
            onclick: () => { if (step.enabled) onNavigate(step.tab, step.target); } }, step.action)))),
      extra));
}

// The tab a key press on the tab bar moves to (WAI-ARIA tabs pattern): ArrowRight and ArrowLeft move to the next
// and previous tab and wrap around, Home and End go to the first and last. Any other key, or no tabs, gives null.
// ids: the tab ids in order; current: the open tab (an unknown one counts as before the first).
export function tabForKey(ids, current, key) {
  if (!Array.isArray(ids) || !ids.length) return null;
  const at = ids.indexOf(current);
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  if (key === "ArrowRight") return ids[(at + 1) % ids.length];
  if (key === "ArrowLeft") return ids[at <= 0 ? ids.length - 1 : at - 1];
  return null;
}
