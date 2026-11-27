// Workbench entry point: boots the page, switches tabs and renders the current one. The panels live in the
// workbench-*.js modules it imports; they share the page state through W (workbench-state.js) and call render()
// from here. Modules only declare functions and constants at load time, so their import cycles are safe.
import { $, api, debounce, h, handleError, icon, initChrome, mount, toast } from "./common.js";
import { readHandoff } from "./handoff.js";
import { renderWorkbenchGuide, tabForKey, workflowSteps } from "./workbench-guide.js";
import { createGuidelines } from "./guidelines.js";
import { W } from "./workbench-state.js";
import { LAB } from "./lab/pages/workbench.js";
import { installLab, labEnv } from "./lab/env.js";
import { buildUnsaved, loadInto, renderBuild } from "./workbench-build.js";
import { rowsText, bulkUnsaved, countRows, bulkQuestions, renderBulk } from "./workbench-bulk.js";
import { healthContext } from "./workbench-import.js";
import { datasetEditsUnsaved } from "./dataset-edits.js";
import { agreementSessionsUnsaved } from "./workbench-dataset-agreement.js";
import { preparedLabelsUnsaved } from "./workbench-labeling.js";
import { reviewQueuesUnsaved, confirmReviewDiscard } from "./workbench-review.js";
import { driftQueuesUnsaved } from "./workbench-drift.js";
import { updateCal, syncAttachedSets } from "./workbench-calibrate.js";
import { updatePolicy } from "./workbench-policy.js";

// Labeling guidelines (static/js/guidelines.js): human-only, shown beside label controls, never sent to the model.
// Kept on W so a view rendered without it (tests/js) simply shows no guideline.
W.guides = createGuidelines({
  h,
  api,
  handleError,
  toast,
  rerender: () => render(),
  beforeSave: (id) => confirmReviewDiscard(id),
});
// Lab (static/js/lab): this page's packs, the ctx builders of its surfaces (W.lab.builders) and the env they act
// through. Kept on W, like the guidelines, so a view rendered without it (tests/js) simply shows no Lab tools.
W.lab = LAB;
W.labEnv = labEnv;
const TABS = [
  ["build", "Build"],
  ["tests", "Tests"],
  ["bulk", "Bulk"],
  ["compare", "Compare"],
  ["examples", "Examples"],
  ["toolbox", "Toolbox"],
];
const BASIC_TABS = new Set(["build", "bulk"]);
const deferredPanels = {
  tests: {
    async load() {
      const { renderTests } = await import("./workbench-tests.js");
      return { render: renderTests };
    },
  },
  compare: {
    async load() {
      const { renderCompare, updateCompareView } = await import("./workbench-compare.js");
      return { render: renderCompare, update: updateCompareView };
    },
  },
  examples: {
    async load() {
      const { renderExamplesBrowser } = await import("./examples-browser.js");
      return {
        render: () =>
          renderExamplesBrowser(h, W.examples, (ex) =>
            loadInto(ex.state, ex.questions, { expect: ex.expect, example: ex.id, images: ex.images }),
          ),
      };
    },
  },
};
// Lab surfaces of the page shell and the Toolbox tab (contract: static/js/lab/surfaces/workbench-shell.js). The shell's
// ctx is built once and mounted on every render, so its commands reach every tab. Page code reaches Lab only through
// W, so views rendered in tests/js see no Lab.
const SHELL_LAB = "workbench.shell";
const TOOLBOX_LAB = "workbench.toolbox";
const TOOL_HASH = "#toolbox/";
let wbShellReady = false; // boot() has loaded the page's data
let wbShellRenderedTab = null; // the tab the last render showed
let wbShellPreviousTab = null; // the tab shown before that one, for data.previousTab
let wbShellCtx = null;

// ---------- boot ----------
async function boot() {
  await initChrome("/workbench");
  installLab(LAB);
  const [ex, sample, pics, sets] = await Promise.all([
    api("/api/workbench/examples"),
    api("/api/workbench/bulk/sample"),
    api("/api/images/samples"),
    api("/api/workbench/datasets"),
  ]);
  W.samples = pics.samples;
  W.maxImages = pics.limits.max_images;
  W.imageLimits = pics.limits;
  W.examples = ex.examples;
  W.bulk.rowsText = W.bulk.savedText = rowsText(sample.rows);
  W.bulk.datasets = sets.datasets;
  window.addEventListener("beforeunload", (e) => {
    if (
      bulkUnsaved() ||
      preparedLabelsUnsaved() ||
      reviewQueuesUnsaved() ||
      driftQueuesUnsaved() ||
      datasetEditsUnsaved() ||
      buildUnsaved() ||
      agreementSessionsUnsaved()
    ) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  W.bulk.sampleQuestions = sample.questions;
  W.compare.terse = sample.terse_questions;
  W.compare.variants[0].text = JSON.stringify(sample.questions, null, 2);
  W.compare.variants[1].text = JSON.stringify(sample.terse_questions, null, 2);
  $("#workbench-basic").addEventListener("click", () => setWorkbenchMode(false));
  $("#workbench-advanced").addEventListener("click", () => setWorkbenchMode(true));
  wbShellReady = true;
  const first = W.examples[0];
  let handed = null;
  try {
    // A shared tool opens independently of a pending demo handoff in another tab.
    if (!location.hash.startsWith(TOOL_HASH)) handed = readHandoff(localStorage);
  } catch {
    /* site data blocked: reading localStorage itself throws */
  }
  if (handed) {
    loadInto(handed.state, handed.questions, {
      images: handed.images,
      handoff: { source: handed.source, model: handed.model },
    });
    return;
  }
  loadInto(first.state, first.questions, { expect: first.expect, example: first.id, images: first.images });
  applyWorkbenchHash();
}

// ---------- tabs and the page shell ----------
function setWorkbenchMode(advanced) {
  if (advanced === W.advanced) return;
  W.advanced = advanced;
  if (!advanced && !BASIC_TABS.has(W.tab)) {
    openWorkbenchTab("build");
    return;
  }
  render();
}

// Shows a tab exactly as a click on the tab bar does. Switching keeps every editor, queue and draft (they live in W).
function openWorkbenchTab(tab) {
  if (tab === "toolbox" && W.tab === tab && location.hash.startsWith(TOOL_HASH)) return;
  const key = tab === "toolbox" && W.lab.view(TOOLBOX_LAB).tool.key;
  const hash = key ? TOOL_HASH + key : "#" + tab;
  if (location.hash !== hash) history.pushState(null, "", hash);
  W.tab = tab;
  render();
}

// What a guide step's button does: open its tab and scroll to its area. Navigation only.
function navigateGuideStep(tab, target) {
  W.tab = tab;
  location.hash = tab;
  render();
  $(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The guide's view of the workspace (static/js/workbench-guide.js workflowSteps).
function guideSnapshot() {
  const b = W.bulk;
  const questions = bulkQuestions() || {};
  return {
    questionCount: Object.keys(questions).length,
    rowCount: countRows(b.rowsText),
    currentRun: !!b.result && b.runText === b.rowsText && JSON.stringify(b.ranQuestions) === JSON.stringify(questions),
    healthCurrent: !!b.health.report && b.health.context === healthContext(),
    gateableCount: Object.values(questions).filter((q) => ["choice", "noul", "score"].includes(q.type)).length,
    hasSavedCheck: b.datasets.some((d) => d.check),
  };
}

// The "workbench.shell" ctx, built once (null until the page index holds its builder).
function shellLabCtx() {
  if (wbShellCtx) return wbShellCtx;
  const build = W.lab?.builders?.shellCtx;
  if (typeof build !== "function") return null;
  wbShellCtx = build({
    tab: () => W.tab,
    tabs: () => TABS,
    previousTab: () => wbShellPreviousTab,
    guideOpen: () => W.guideOpen,
    steps: () => workflowSteps(guideSnapshot()),
    workspace: () => (wbShellReady ? guideSnapshot() : null),
    counts: () =>
      wbShellReady
        ? {
            savedTests: W.items?.length ?? null,
            examples: W.examples.length,
            datasets: W.bulk.datasets.length,
            checks: W.bulk.datasets.filter((d) => d.check).length,
          }
        : null,
    unsaved: () => ({
      build: buildUnsaved,
      bulk: bulkUnsaved,
      labeling: preparedLabelsUnsaved,
      review: reviewQueuesUnsaved,
      drift: driftQueuesUnsaved,
      datasetEdits: datasetEditsUnsaved,
      agreement: agreementSessionsUnsaved,
    }),
    openTab: openWorkbenchTab,
    goToStep: navigateGuideStep,
    setGuideOpen: (open) => {
      W.guideOpen = open;
      renderGuide();
    },
    focusTabs: () => {
      $("#tabs .tab.active")?.focus();
    },
    refresh: () => render(),
  });
  wbShellCtx.env = W.labEnv;
  return wbShellCtx;
}

// The Toolbox tab: Lab's tools for the "workbench.toolbox" surface, computed in the browser from what is typed.
function renderToolbox() {
  const build = W.lab?.builders?.shellToolboxCtx;
  const ctx =
    typeof build === "function"
      ? build({
          imageLimits: () => W.imageLimits,
          prices: () => W.bulk.costs,
          tabs: () => TABS,
          openTab: openWorkbenchTab,
          refresh: () => render(),
        })
      : null;
  const section = ctx
    ? W.lab.section(W.labEnv, TOOLBOX_LAB, ctx, {
        flat: true,
        toolLink: (key) => `${location.origin}${location.pathname}${TOOL_HASH}${key}`,
        onSelectTool: (key) => {
          const hash = TOOL_HASH + key;
          if (location.hash !== hash) history.pushState(null, "", hash);
        },
      })
    : null;
  return h(
    "div",
    { class: "panel", id: "toolbox-panel" },
    h("div", { class: "panel-head" }, icon("sparkle"), h("h2", {}, "Toolbox")),
    h(
      "div",
      { class: "panel-body grid", style: { gap: "12px" } },
      h(
        "p",
        { class: "muted" },
        "Calculate confidence intervals and plan audit sample sizes from the values you enter. Nothing is sent anywhere.",
      ),
      section || h("p", { class: "empty", role: "status" }, "No tools are loaded on this page yet."),
    ),
  );
}

// ---------- render ----------
export function renderGuide() {
  const ctx = shellLabCtx();
  mount(
    "#workbench-guide",
    renderWorkbenchGuide(h, guideSnapshot(), navigateGuideStep, {
      open: W.guideOpen,
      onToggle: (open) => {
        W.guideOpen = open;
      },
      extra: ctx ? W.lab?.section(W.labEnv, SHELL_LAB, ctx, { title: "Page tools" }) : null,
    }),
  );
}

export function render() {
  // A shared link or an action that opens an advanced tab also reveals its tab.
  if (!BASIC_TABS.has(W.tab)) W.advanced = true;
  for (const [mode, selected] of [
    ["basic", !W.advanced],
    ["advanced", W.advanced],
  ]) {
    const button = $(`#workbench-${mode}`);
    button?.classList.toggle("active", selected);
    button?.setAttribute("aria-pressed", String(selected));
  }
  syncAttachedSets();
  LAB.unmountAll(["chrome"]); // only the surfaces rendered below stay reachable from the command palette
  const shell = shellLabCtx();
  if (shell) W.lab?.mount(SHELL_LAB, shell);
  if (wbShellRenderedTab !== null && wbShellRenderedTab !== W.tab) wbShellPreviousTab = wbShellRenderedTab;
  wbShellRenderedTab = W.tab;
  renderTabs();
  renderView();
  renderGuide();
}

function renderTabs() {
  // The tab bar follows the WAI-ARIA tabs pattern: one tab in the Tab order, arrow keys move and wrap, Home/End.
  const focused = document.activeElement;
  const focusedTab = $("#tabs").contains(focused) ? focused.id : null;
  const visibleTabs = W.advanced ? TABS : TABS.filter(([id]) => BASIC_TABS.has(id));
  const tabIds = visibleTabs.map(([k]) => k);
  mount(
    "#tabs",
    visibleTabs.map(([k, label]) =>
      h(
        "button",
        {
          class: `tab${W.tab === k ? " active" : ""}`,
          id: `tab-${k}`,
          role: "tab",
          "aria-selected": W.tab === k ? "true" : "false",
          "aria-controls": "view",
          tabindex: W.tab === k ? "0" : "-1",
          onclick: () => openWorkbenchTab(k),
          onkeydown: (event) => {
            const next = event.altKey || event.ctrlKey || event.metaKey ? null : tabForKey(tabIds, W.tab, event.key);
            if (!next) return;
            event.preventDefault();
            if (next !== W.tab) openWorkbenchTab(next);
            $(`#tab-${next}`)?.focus();
          },
        },
        label,
        k === "tests" && W.items?.length ? ` (${W.items.length})` : "",
      ),
    ),
  );
  if (focusedTab) $(`#${focusedTab}`)?.focus();
}

function renderDeferredPanel(tab, panel) {
  if (panel.content) return panel.content.render();
  const label = TABS.find(([id]) => id === tab)[1];
  if (panel.failed === "module") {
    return h(
      "p",
      { class: "empty", role: "alert" },
      `Could not load ${label}. Save or download unsaved work before reloading Workbench.`,
    );
  }
  if (panel.failed === "catalog") {
    return h(
      "div",
      { class: "panel panel-body" },
      h("p", { role: "alert" }, `Could not load ${label}.`),
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            panel.failed = null;
            renderView();
            $("#view").focus();
          },
        },
        "Try again",
      ),
    );
  }
  panel.pending ??= loadDeferredPanel(tab, panel);
  return h("p", { class: "empty", role: "status" }, `Loading ${label}…`);
}

async function loadDeferredPanel(tab, panel) {
  const catalog =
    tab === "tests" && W.items === null
      ? api("/api/workbench/items").then(
          ({ items }) => {
            // A Build save can refresh the catalog while the first Tests visit is loading.
            W.items ??= items;
            return true;
          },
          () => W.items !== null,
        )
      : true;
  try {
    const [content, catalogReady] = await Promise.all([panel.load(), catalog]);
    if (catalogReady) {
      panel.content = content;
    } else {
      panel.failed = "catalog";
    }
  } catch {
    panel.failed = "module";
  }
  panel.pending = null;
  if (tab === "tests" && panel.content && W.advanced) renderTabs();
  if (W.tab === tab) renderView();
}

function renderView() {
  let view;
  switch (W.tab) {
    case "tests":
    case "compare":
    case "examples":
      view = renderDeferredPanel(W.tab, deferredPanels[W.tab]);
      break;
    case "bulk":
      view = renderBulk();
      break;
    case "toolbox":
      view = renderToolbox();
      break;
    default:
      view = renderBuild();
  }
  const panel = mount("#view", view);
  const deferred = deferredPanels[W.tab];
  panel.setAttribute("aria-labelledby", `tab-${W.tab}`);
  panel.tabIndex = deferred && !deferred.content && deferred.failed !== "catalog" ? 0 : -1;
  if (W.tab === "bulk") {
    if (W.advanced) updateCal();
    updatePolicy();
  }
  if (W.tab === "compare") deferredPanels.compare.content?.update();
}

// Browser history and fresh links use the same registered pack/tool keys as the Toolbox picker.
function applyWorkbenchHash(previousHash = "") {
  const hash = location.hash;
  if (hash.startsWith(TOOL_HASH)) {
    if (!W.lab.surface(TOOLBOX_LAB)) {
      W.tab = "toolbox";
      render();
      W.lab.load().then(
        () => {
          if (location.hash === hash) applyWorkbenchHash(previousHash);
        },
        () => {
          // The Toolbox shows the load error in its panel.
        },
      );
      return;
    }
    const key = hash.slice(TOOL_HASH.length);
    const found = W.lab.entries(TOOLBOX_LAB, "tool").some(([id]) => key === id);
    const state = W.lab.view(TOOLBOX_LAB).tool;
    Object.assign(state, { key: found ? key : "", group: "", query: "", result: null, error: "" });
    W.tab = "toolbox";
    render();
    if (found) {
      const form = $("#toolbox-panel .lab-tool-form");
      (form?.querySelector("input, select, textarea") || form?.querySelector("button"))?.focus();
    } else {
      toast("This tool is unavailable. Choose another tool from the Toolbox.");
    }
    return;
  }
  const tab = hash.slice(1) || "build";
  if (tab === "toolbox" && previousHash.startsWith(TOOL_HASH)) {
    Object.assign(W.lab.view(TOOLBOX_LAB).tool, { key: "", result: null, error: "" });
  } else if (tab === W.tab || !TABS.some(([id]) => tab === id)) return;
  W.tab = tab;
  render();
}

window.addEventListener("hashchange", (event) => {
  if (wbShellReady) applyWorkbenchHash(new URL(event.oldURL).hash);
});
window.addEventListener(
  "resize",
  debounce(() => {
    if (W.tab === "bulk" && W.advanced) updateCal();
    if (W.tab === "compare") deferredPanels.compare.content?.update();
  }, 150),
);
boot().catch(handleError);
