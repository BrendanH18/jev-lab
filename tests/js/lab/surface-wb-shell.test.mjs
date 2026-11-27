// Tests of the Workbench shell and Toolbox Lab surfaces (static/js/lab/surfaces/workbench-shell.js) and of their hooks
// in the page code: the tab bar's keys (tabForKey in static/js/workbench-guide.js) and the shell/Toolbox functions of
// static/js/workbench.js, rebuilt from the page's source with stand-ins the way tests/js/build-*.test.mjs do.
import assert from "node:assert/strict";
import { test } from "node:test";

import { shellCtx, shellToolboxCtx } from "../../../static/js/lab/surfaces/workbench-shell.js";
import * as builders from "../../../static/js/lab/surfaces/workbench-shell.js";
import { createLab } from "../../../static/js/lab/host.js";
import { improvementsOf } from "../../../static/js/lab/kit.js";
import { renderWorkbenchGuide, tabForKey, workflowSteps } from "../../../static/js/workbench-guide.js";
import shellPack from "../../../static/js/lab/packs/workbench/workbench-shell-starter.js";
import toolboxPack from "../../../static/js/lab/packs/workbench/workbench-toolbox-starter.js";
import { fakeEnv, find, findAll, textOf } from "./harness.mjs";
import { SHELL_TABS, sampleShellCtx, sampleToolboxCtx } from "./fixtures/workbench-shell.mjs";
import { moduleSources } from "../workbench-source.mjs";

// ---------- workbench.shell ----------

test("shell ctx: no list, the tab bar with the open tab and the saved-test count, and fresh frozen data", () => {
  const ctx = sampleShellCtx();
  assert.deepEqual(ctx.items(), []);
  assert.deepEqual(ctx.shown(), []);
  assert.equal(ctx.data.tab, "bulk");
  assert.deepEqual(
    ctx.data.tabs,
    SHELL_TABS.map(([id, label], index) => ({
      id,
      label,
      position: index + 1,
      active: id === "bulk",
      count: id === "tests" ? 3 : null,
    })),
  );
  assert.ok(Object.isFrozen(ctx.data.tabs) && Object.isFrozen(ctx.data.tabs[0]));
  assert.notEqual(ctx.data.tabs, ctx.data.tabs, "every read is a fresh value");
  assert.equal(ctx.data.previousTab, "build");
  assert.equal(ctx.data.guideOpen, false);
  assert.deepEqual(ctx.data.workspace, {
    questionCount: 4,
    rowCount: 12,
    gateableCount: 4,
    currentRun: true,
    healthCurrent: false,
    hasSavedCheck: false,
  });
  assert.deepEqual(ctx.data.counts, { savedTests: 3, examples: 13, datasets: 2, checks: 1 });
  assert.deepEqual(ctx.data.unsaved, {
    build: false,
    bulk: true,
    labeling: false,
    review: false,
    drift: false,
    datasetEdits: false,
    agreement: false,
    any: true,
  });
  const expected = workflowSteps(ctx.state.workspace);
  assert.deepEqual(
    ctx.data.steps.map((step) => [step.id, step.position, step.tab, step.target, step.status, step.enabled]),
    expected.map((step, index) => [step.id, index + 1, step.tab, step.target, step.status, step.enabled]),
  );
  assert.equal(ctx.itemName({}, 2), "3");
});

test("shell ctx before the page loads, and odd source values", () => {
  const ctx = sampleShellCtx({ ready: false, previousTab: "bulk" });
  assert.equal(ctx.data.workspace, null);
  assert.equal(ctx.data.counts, null);
  assert.equal(ctx.data.tabs.find((tab) => tab.id === "tests").count, 0);
  assert.equal(ctx.data.previousTab, null, "the open tab is never its own previous tab");
  const odd = shellCtx({
    tab: () => {
      throw new Error("boom");
    },
    tabs: [{ id: "build", label: "Build" }, ["", "x"], null, ["tests"]],
    workspace: { questionCount: -2, rowCount: 1.5, currentRun: "yes" },
    unsaved: {
      build: () => true,
      bulk: () => {
        throw new Error("x");
      },
    },
    previousTab: "gone",
  });
  assert.equal(odd.data.tab, "build", "an unreadable tab reads as the first tab");
  assert.deepEqual(
    odd.data.tabs.map((tab) => [tab.id, tab.label]),
    [
      ["build", "Build"],
      ["tests", "tests"],
    ],
  );
  assert.deepEqual(odd.data.workspace, {
    questionCount: 0,
    rowCount: 0,
    gateableCount: 0,
    currentRun: false,
    healthCurrent: false,
    hasSavedCheck: false,
  });
  assert.equal(odd.data.unsaved.build, true);
  assert.equal(odd.data.unsaved.bulk, false);
  assert.equal(odd.data.unsaved.any, true);
  assert.equal(odd.data.previousTab, null, "a previous tab that is not in the bar is null");
  assert.deepEqual(odd.data.steps, []);
});

test("shell actions: openTab, goToStep, setGuideOpen and focusTabs reach the page only past their guards", () => {
  const ctx = sampleShellCtx();
  assert.throws(() => ctx.actions.openTab("settings"), /no Workbench tab "settings"/);
  ctx.actions.openTab("toolbox");
  assert.equal(ctx.data.tab, "toolbox");
  assert.equal(ctx.data.previousTab, "bulk");
  assert.throws(() => ctx.actions.goToStep("deploy"), /no guide step "deploy"/);
  const early = sampleShellCtx({ ready: false });
  assert.throws(
    () => early.actions.goToStep("run"),
    /Run the selected questions is not available yet: Live call required\./,
  );
  assert.deepEqual(early.calls, []);
  ctx.actions.goToStep("policy");
  assert.throws(() => ctx.actions.setGuideOpen("yes"), /open or closed/);
  ctx.actions.setGuideOpen(true);
  assert.equal(ctx.data.guideOpen, true);
  ctx.actions.focusTabs();
  ctx.refresh();
  assert.deepEqual(ctx.calls, [
    ["openTab", "toolbox"],
    ["goToStep", "bulk", "#policy"],
    ["setGuideOpen", true],
    ["focusTabs"],
    ["refresh"],
  ]);
  assert.equal(ctx.actions.replaceItems, undefined);
  assert.equal(ctx.actions.importItems, undefined);
  const bare = shellCtx({ tabs: SHELL_TABS });
  assert.throws(() => bare.actions.openTab("build"), /cannot do that here/);
  assert.throws(() => bare.actions.focusTabs(), /cannot do that here/);
});

// ---------- workbench.toolbox ----------

test("toolbox ctx: picture limits and typed prices, no list, openTab guarded", () => {
  const ctx = sampleToolboxCtx();
  assert.deepEqual(ctx.items(), []);
  assert.deepEqual(ctx.shown(), []);
  assert.deepEqual(ctx.data.imageLimits, { minSide: 280, maxSide: 1568, maxImages: 4 });
  assert.deepEqual(ctx.data.prices, { review: 2, error: 20 });
  assert.deepEqual(sampleToolboxCtx({ imageLimits: null, prices: { review: "", error: "lots" } }).data, {
    imageLimits: null,
    prices: { review: null, error: null },
  });
  assert.deepEqual(sampleToolboxCtx({ imageLimits: { minSide: 300, maxSide: 0 } }).data.imageLimits, {
    minSide: 300,
    maxSide: null,
    maxImages: null,
  });
  assert.deepEqual(sampleToolboxCtx({ prices: { review: 1.5, error: " 2e1 " } }).data.prices, {
    review: 1.5,
    error: 20,
  });
  assert.throws(() => ctx.actions.openTab("nowhere"), /no Workbench tab/);
  ctx.actions.openTab("bulk");
  assert.deepEqual(ctx.calls, [["openTab", "bulk"]]);
  assert.equal(shellToolboxCtx().data.imageLimits, null);
});

test("the surface module exports exactly the two builders", () => {
  assert.deepEqual(Object.keys(builders).sort(), ["shellCtx", "shellToolboxCtx"]);
});

// ---------- the tab bar and the guide ----------

test("tabForKey: arrows move and wrap, Home and End jump, other keys do nothing", () => {
  const tabs = SHELL_TABS.map(([id]) => id);
  assert.equal(tabForKey(tabs, "bulk", "ArrowRight"), "compare");
  assert.equal(tabForKey(tabs, "bulk", "ArrowLeft"), "tests");
  assert.equal(tabForKey(tabs, "toolbox", "ArrowRight"), "build");
  assert.equal(tabForKey(tabs, "build", "ArrowLeft"), "toolbox");
  assert.equal(tabForKey(tabs, "bulk", "Home"), "build");
  assert.equal(tabForKey(tabs, "bulk", "End"), "toolbox");
  assert.equal(tabForKey(tabs, "unknown", "ArrowRight"), "build");
  assert.equal(tabForKey(tabs, "unknown", "ArrowLeft"), "toolbox");
  for (const key of ["Enter", " ", "ArrowDown", "Tab", "a"]) assert.equal(tabForKey(tabs, "bulk", key), null);
  assert.equal(tabForKey([], "bulk", "Home"), null);
});

test("the guide shows an extra node (the shell's Page tools) after its steps, and nothing when there is none", () => {
  const h = (tag, attrs, ...children) => ({
    tag,
    attrs,
    children: children.flat(Infinity).filter((x) => x != null && x !== false),
  });
  const extra = h("div", { "data-lab-surface": "workbench.shell" });
  const guide = renderWorkbenchGuide(h, {}, () => {}, { extra });
  const body = guide.children[1];
  assert.equal(body.children.at(-1), extra);
  assert.equal(renderWorkbenchGuide(h, {}, () => {}).children[1].children.length, 2);
});

// ---------- static/js/workbench.js: the Toolbox tab and the shell ctx, rebuilt from source ----------

const workbench = moduleSources["workbench.js"];
const body = (name) => workbench.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const fakeH = (tag, attrs = {}, ...children) => ({
  tag,
  attrs: attrs || {},
  children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
});

test("workbench.js lists the Toolbox tab, opens it from #toolbox and reaches Lab only through W in its new functions", () => {
  assert.match(workbench, /const TABS = \[[^;]*\["toolbox", "Toolbox"\],?\s*\];/);
  assert.match(workbench, /case "toolbox":\s*view = renderToolbox\(\);\s*break;/);
  assert.match(
    workbench,
    /role: "tab",\s*\n?\s*"aria-selected": W\.tab === k \? "true" : "false",\s*"aria-controls": "view",\s*tabindex: W\.tab === k \? "0" : "-1"/,
  );
  assert.match(workbench, /tabForKey\(tabIds, W\.tab, event\.key\)/);
  assert.match(workbench, /window\.addEventListener\("hashchange"/);
  for (const name of [
    "renderToolbox",
    "shellLabCtx",
    "renderGuide",
    "openWorkbenchTab",
    "navigateGuideStep",
    "guideSnapshot",
  ]) {
    assert.ok(!/\bLAB\b/.test(body(name)), `${name} must reach Lab through W`);
  }
});

test("reopening Toolbox records the displayed tool so Back can restore it", () => {
  const lab = createLab([toolboxPack], builders);
  const surface = "workbench.toolbox";
  const [[first], [second]] = lab.entries(surface, "tool");
  const state = lab.view(surface).tool;
  const location = new URL("http://localhost/workbench#toolbox/" + first);
  const history = {
    pushState: (_state, _title, hash) => {
      location.hash = hash;
    },
  };
  const W = { lab, tab: "toolbox" };
  const [openTab, applyHash] = new Function(
    "W",
    "TOOLBOX_LAB",
    "TOOL_HASH",
    "location",
    "history",
    "render",
    "$",
    "TABS",
    `${body("openWorkbenchTab")} ${body("applyWorkbenchHash")} return [openWorkbenchTab, applyWorkbenchHash];`,
  )(
    W,
    surface,
    "#toolbox/",
    location,
    history,
    () => {},
    () => ({ querySelector: () => null }),
    SHELL_TABS,
  );
  state.key = first;
  openTab("build");
  openTab("toolbox");
  const reopened = location.hash;
  state.key = second;
  location.hash = "#toolbox/" + second;
  const previous = location.hash;
  location.hash = reopened;
  applyHash(previous);
  assert.equal(state.key, first);
  assert.equal(location.hash, "#toolbox/" + first);
});

test("renderToolbox: an empty state without tools, and the flat Toolbox section with them", () => {
  const make = new Function(
    "W",
    "h",
    "icon",
    "TOOLBOX_LAB",
    "TABS",
    "openWorkbenchTab",
    "render",
    `${body("renderToolbox")}; return renderToolbox;`,
  );
  const opened = [];
  const args = (W) => [W, fakeH, () => null, "workbench.toolbox", SHELL_TABS, (tab) => opened.push(tab), () => {}];
  const bare = make(...args({ bulk: { costs: {} } }))();
  assert.match(textOf(bare), /Toolbox/);
  assert.match(textOf(bare), /Nothing is sent anywhere/);
  assert.ok(find(bare, (n) => n.attrs?.class === "empty" && /No tools are loaded/.test(textOf(n))));
  const lab = createLab([toolboxPack], builders);
  const W = {
    lab,
    labEnv: fakeEnv(),
    imageLimits: { min_side: 280, max_side: 1568, max_images: 4 },
    bulk: { costs: { review: "3", error: "30" } },
  };
  const view = make(...args(W))();
  const section = find(view, (n) => n.attrs?.["data-lab-surface"] === "workbench.toolbox");
  assert.ok(section && /\bflat\b/.test(section.attrs.class), "the Toolbox section renders flat, without a disclosure");
  assert.ok(!find(view, (n) => n.attrs?.class === "empty"));
  assert.equal(findAll(view, (n) => n.attrs?.role === "listitem").length, 7, "every retained tool is listed");
  const mounted = lab.commandEntries();
  assert.equal(mounted.length, 0);
  assert.deepEqual(lab.mountedIds(), ["workbench.toolbox"]);
});

test("shellLabCtx: built once from the page's state, with the page's own tab switch and guide navigation", () => {
  const calls = [];
  const W = {
    tab: "build",
    guideOpen: false,
    items: [{}, {}],
    examples: [{}],
    bulk: { datasets: [{ check: {} }, {}] },
    labEnv: fakeEnv(),
    lab: { builders },
  };
  const make = new Function(
    "W",
    "TABS",
    "workflowSteps",
    "guideSnapshot",
    "buildUnsaved",
    "bulkUnsaved",
    "preparedLabelsUnsaved",
    "reviewQueuesUnsaved",
    "driftQueuesUnsaved",
    "datasetEditsUnsaved",
    "agreementSessionsUnsaved",
    "navigateGuideStep",
    "openWorkbenchTab",
    "renderGuide",
    "$",
    "render",
    `let wbShellCtx = null; let wbShellReady = true; let wbShellPreviousTab = "tests"; ${body("shellLabCtx")}; return shellLabCtx;`,
  );
  const snapshot = {
    questionCount: 2,
    rowCount: 5,
    currentRun: false,
    healthCurrent: true,
    gateableCount: 2,
    hasSavedCheck: true,
  };
  const shellLab = make(
    W,
    SHELL_TABS,
    workflowSteps,
    () => snapshot,
    () => true,
    () => false,
    () => false,
    () => false,
    () => false,
    () => false,
    () => false,
    (tab, target) => calls.push(["navigate", tab, target]),
    (tab) => {
      calls.push(["open", tab]);
      W.tab = tab;
    },
    () => calls.push(["guide"]),
    (selector) => ({ focus: () => calls.push(["focus", selector]) }),
    () => calls.push(["render"]),
  );
  const ctx = shellLab();
  assert.equal(shellLab(), ctx, "built once");
  assert.equal(ctx.env, W.labEnv);
  assert.equal(ctx.data.tab, "build");
  assert.equal(ctx.data.previousTab, "tests");
  assert.deepEqual(ctx.data.counts, { savedTests: 2, examples: 1, datasets: 2, checks: 1 });
  assert.deepEqual(ctx.data.workspace, snapshot);
  assert.equal(ctx.data.unsaved.build, true);
  assert.equal(ctx.data.unsaved.any, true);
  ctx.actions.openTab("toolbox");
  ctx.actions.goToStep("labels");
  ctx.actions.setGuideOpen(true);
  ctx.actions.focusTabs();
  ctx.refresh();
  assert.equal(W.guideOpen, true);
  assert.deepEqual(calls, [
    ["open", "toolbox"],
    ["navigate", "bulk", "#dataset-health"],
    ["guide"],
    ["focus", "#tabs .tab.active"],
    ["render"],
  ]);
  const none = new Function("W", `let wbShellCtx = null; ${body("shellLabCtx")}; return shellLabCtx;`)({
    lab: undefined,
  });
  assert.equal(none(), null, "no builder yet: no shell ctx, and the page renders as before");
});

test("the shell section renders in the guide with the starter pack, and every starter command is reachable once mounted", () => {
  const lab = createLab([shellPack], builders);
  const ctx = sampleShellCtx();
  const tree = lab.section(fakeEnv(), "workbench.shell", ctx, { title: "Page tools" });
  assert.match(textOf(tree), new RegExp(`^Page tools · ${improvementsOf(shellPack).length}(?!\\d)`));
  const commands = shellPack.features.filter((feature) => feature.kind === "command");
  assert.ok(commands.length > 0);
  assert.deepEqual(
    lab
      .commandEntries()
      .map(([key]) => key)
      .sort(),
    commands.map((command) => `${shellPack.id}/${command.id}`).sort(),
  );
});
