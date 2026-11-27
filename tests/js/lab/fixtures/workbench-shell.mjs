// Fixtures for packs on the Workbench shell surfaces (contract: static/js/lab/surfaces/workbench-shell.js). Each
// sample*Ctx(overrides) is a realistic ctx made by the real builder from hand-written Harbor Coffee Co. data, with a
// fake env (ctx.env: toasts, copied, downloads) and a log of the page operations the actions reached (ctx.calls, as
// [name, ...args]). Not a test file itself.
//
//   sampleShellCtx({ tab, previousTab, guideOpen, workspace, counts, unsaved, ready })
//     tab "bulk", previous tab "build", guide closed, a workspace with 4 questions, 12 rows and a current run, 3 saved
//     tests, 13 examples, 2 datasets (1 with a check), unsaved Bulk rows. ready: false gives workspace and counts null
//     (the page before its data loaded). openTab/goToStep/setGuideOpen change the fixture's state like the page does.
//   sampleToolboxCtx({ imageLimits, prices })
//     limits 280/1568/4 and the typed prices review "2", error "20".
import { workflowSteps } from "../../../../static/js/workbench-guide.js";
import { shellCtx, shellToolboxCtx } from "../../../../static/js/lab/surfaces/workbench-shell.js";
import { fakeEnv } from "../harness.mjs";

export const SHELL_TABS = Object.freeze([
  ["build", "Build"],
  ["tests", "Tests"],
  ["bulk", "Bulk"],
  ["compare", "Compare"],
  ["examples", "Examples"],
  ["toolbox", "Toolbox"],
]);

const SHELL_DEFAULTS = {
  tab: "bulk",
  previousTab: "build",
  guideOpen: false,
  ready: true,
  workspace: {
    questionCount: 4,
    rowCount: 12,
    currentRun: true,
    healthCurrent: false,
    gateableCount: 4,
    hasSavedCheck: false,
  },
  counts: { savedTests: 3, examples: 13, datasets: 2, checks: 1 },
  unsaved: {
    build: false,
    bulk: true,
    labeling: false,
    review: false,
    drift: false,
    datasetEdits: false,
    agreement: false,
  },
};

export function sampleShellCtx(overrides = {}) {
  const state = { ...SHELL_DEFAULTS, ...overrides };
  state.workspace = { ...SHELL_DEFAULTS.workspace, ...(overrides.workspace || {}) };
  state.unsaved = { ...SHELL_DEFAULTS.unsaved, ...(overrides.unsaved || {}) };
  const calls = [];
  const show = (tab) => {
    if (tab !== state.tab) state.previousTab = state.tab;
    state.tab = tab;
  };
  const ctx = shellCtx({
    tab: () => state.tab,
    tabs: () => SHELL_TABS,
    previousTab: () => state.previousTab,
    guideOpen: () => state.guideOpen,
    steps: () => workflowSteps(state.ready ? state.workspace : {}),
    workspace: () => (state.ready ? state.workspace : null),
    counts: () => (state.ready ? state.counts : null),
    unsaved: () => state.unsaved,
    openTab: (tab) => {
      calls.push(["openTab", tab]);
      show(tab);
    },
    goToStep: (tab, target) => {
      calls.push(["goToStep", tab, target]);
      show(tab);
    },
    setGuideOpen: (open) => {
      calls.push(["setGuideOpen", open]);
      state.guideOpen = open;
    },
    focusTabs: () => {
      calls.push(["focusTabs"]);
    },
    refresh: () => {
      calls.push(["refresh"]);
    },
  });
  ctx.env = fakeEnv();
  ctx.calls = calls;
  ctx.state = state;
  return ctx;
}

export function sampleToolboxCtx(overrides = {}) {
  const state = {
    imageLimits: { min_side: 280, max_side: 1568, max_images: 4 },
    prices: { review: "2", error: "20" },
    tab: "toolbox",
    ...overrides,
  };
  const calls = [];
  const ctx = shellToolboxCtx({
    imageLimits: () => state.imageLimits,
    prices: () => state.prices,
    tabs: () => SHELL_TABS,
    openTab: (tab) => {
      calls.push(["openTab", tab]);
      state.tab = tab;
    },
    refresh: () => {
      calls.push(["refresh"]);
    },
  });
  ctx.env = fakeEnv();
  ctx.calls = calls;
  ctx.state = state;
  return ctx;
}
