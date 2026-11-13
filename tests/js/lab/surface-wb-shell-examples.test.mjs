// Tests of the Workbench shell, Toolbox and Examples gallery Lab surfaces (static/js/lab/surfaces/workbench-shell.js)
// and of their hooks in the page code: visibleExamples/renderExamplesBrowser (static/js/examples-browser.js), the tab
// bar's keys (tabForKey in static/js/workbench-guide.js) and the shell/Toolbox functions of static/js/workbench.js,
// rebuilt from the page's source with stand-ins the way tests/js/build-*.test.mjs do.
import assert from "node:assert/strict";
import { test } from "node:test";

import { shellCtx, shellExamplesCtx, shellToolboxCtx } from "../../../static/js/lab/surfaces/workbench-shell.js";
import * as builders from "../../../static/js/lab/surfaces/workbench-shell.js";
import { createLab } from "../../../static/js/lab/host.js";
import { improvementsOf } from "../../../static/js/lab/kit.js";
import { exampleBrowserDefaults, renderExamplesBrowser, visibleExamples } from "../../../static/js/examples-browser.js";
import { renderWorkbenchGuide, tabForKey, workflowSteps } from "../../../static/js/workbench-guide.js";
import examplesPack from "../../../static/js/lab/packs/workbench/workbench-examples-starter.js";
import shellPack from "../../../static/js/lab/packs/workbench/workbench-shell-starter.js";
import toolboxPack from "../../../static/js/lab/packs/workbench/workbench-toolbox-starter.js";
import { fakeEnv, find, findAll, textOf } from "./harness.mjs";
import { SHELL_TABS, sampleExamples, sampleExamplesCtx, sampleShellCtx, sampleToolboxCtx } from "./fixtures/workbench-shell.mjs";
import { moduleSources } from "../workbench-source.mjs";

const GALLERY = "workbench.examples.gallery";
const ids = (list) => list.map((item) => item.id);

// ---------- workbench.shell ----------

test("shell ctx: no list, the tab bar with the open tab and the saved-test count, and fresh frozen data", () => {
  const ctx = sampleShellCtx();
  assert.deepEqual(ctx.items(), []);
  assert.deepEqual(ctx.shown(), []);
  assert.equal(ctx.data.tab, "bulk");
  assert.deepEqual(ctx.data.tabs, SHELL_TABS.map(([id, label], index) => ({ id, label, position: index + 1, active: id === "bulk", count: id === "tests" ? 3 : null })));
  assert.ok(Object.isFrozen(ctx.data.tabs) && Object.isFrozen(ctx.data.tabs[0]));
  assert.notEqual(ctx.data.tabs, ctx.data.tabs, "every read is a fresh value");
  assert.equal(ctx.data.previousTab, "build");
  assert.equal(ctx.data.guideOpen, false);
  assert.deepEqual(ctx.data.workspace, { questionCount: 4, rowCount: 12, gateableCount: 4, currentRun: true, healthCurrent: false, hasSavedCheck: false });
  assert.deepEqual(ctx.data.counts, { savedTests: 3, examples: 13, datasets: 2, checks: 1 });
  assert.deepEqual(ctx.data.unsaved, { build: false, bulk: true, labeling: false, review: false, drift: false, datasetEdits: false, agreement: false, any: true });
  const expected = workflowSteps(ctx.state.workspace);
  assert.deepEqual(ctx.data.steps.map((step) => [step.id, step.position, step.tab, step.target, step.status, step.enabled]),
    expected.map((step, index) => [step.id, index + 1, step.tab, step.target, step.status, step.enabled]));
  assert.equal(ctx.itemName({}, 2), "3");
});

test("shell ctx before the page loads, and odd source values", () => {
  const ctx = sampleShellCtx({ ready: false, previousTab: "bulk" });
  assert.equal(ctx.data.workspace, null);
  assert.equal(ctx.data.counts, null);
  assert.equal(ctx.data.tabs.find((tab) => tab.id === "tests").count, 0);
  assert.equal(ctx.data.previousTab, null, "the open tab is never its own previous tab");
  const odd = shellCtx({ tab: () => { throw new Error("boom"); }, tabs: [{ id: "build", label: "Build" }, ["", "x"], null, ["tests"]],
    workspace: { questionCount: -2, rowCount: 1.5, currentRun: "yes" }, unsaved: { build: () => true, bulk: () => { throw new Error("x"); } }, previousTab: "gone" });
  assert.equal(odd.data.tab, "build", "an unreadable tab reads as the first tab");
  assert.deepEqual(odd.data.tabs.map((tab) => [tab.id, tab.label]), [["build", "Build"], ["tests", "tests"]]);
  assert.deepEqual(odd.data.workspace, { questionCount: 0, rowCount: 0, gateableCount: 0, currentRun: false, healthCurrent: false, hasSavedCheck: false });
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
  assert.throws(() => early.actions.goToStep("run"), /Run the selected questions is not available yet: Live call required\./);
  assert.deepEqual(early.calls, []);
  ctx.actions.goToStep("policy");
  assert.throws(() => ctx.actions.setGuideOpen("yes"), /open or closed/);
  ctx.actions.setGuideOpen(true);
  assert.equal(ctx.data.guideOpen, true);
  ctx.actions.focusTabs();
  ctx.refresh();
  assert.deepEqual(ctx.calls, [["openTab", "toolbox"], ["goToStep", "bulk", "#policy"], ["setGuideOpen", true], ["focusTabs"], ["refresh"]]);
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
  assert.deepEqual(sampleToolboxCtx({ imageLimits: null, prices: { review: "", error: "lots" } }).data, { imageLimits: null, prices: { review: null, error: null } });
  assert.deepEqual(sampleToolboxCtx({ imageLimits: { minSide: 300, maxSide: 0 } }).data.imageLimits, { minSide: 300, maxSide: null, maxImages: null });
  assert.deepEqual(sampleToolboxCtx({ prices: { review: 1.5, error: " 2e1 " } }).data.prices, { review: 1.5, error: 20 });
  assert.throws(() => ctx.actions.openTab("nowhere"), /no Workbench tab/);
  ctx.actions.openTab("bulk");
  assert.deepEqual(ctx.calls, [["openTab", "bulk"]]);
  assert.equal(shellToolboxCtx().data.imageLimits, null);
});

// ---------- workbench.examples.gallery ----------

test("gallery items: authored content only, in the documented shape, never expectations", () => {
  const ctx = sampleExamplesCtx();
  const items = ctx.items();
  assert.deepEqual(ids(items), ["order-triage", "wholesale-lead", "bag-photo", "review-batch", "late-delivery", "blank-draft", "crate-locate"]);
  assert.deepEqual(items[4], {
    id: "late-delivery", position: 5, title: "Late delivery check", pattern: "Flag + route", blurb: "Spot late orders before the customer writes twice.",
    code: "escalate when `is_late.noul` >= 0.5.", state: { message: "My grinder order is a week late and nobody answers." }, state_type: "object", state_bytes: 65,
    questions: [
      { id: "is_late", position: 1, type: "noul", instructions: "Does `message` say an order is late?", criteria: [{ key: "true", text: "Mentions a delay" }, { key: "false", text: "" }] },
      { id: "team", position: 2, type: "choice", instructions: "Which team should answer?", criteria: [{ key: "shipping", text: "Delivery problems" }] },
      { id: "repeat_check", position: 3, type: "noul", instructions: "does `message`  say an order is late?", criteria: [] },
    ],
    question_count: 3, types: ["choice", "noul"], criteria_count: 1, pictures: [], picture_count: 0, expectation_count: 1,
  });
  assert.deepEqual(items[2].pictures, [{ name: "photo-torn-bag", sample: "torn-bag" }, { name: "photo-spare-angle", sample: null }]);
  assert.equal(items[2].picture_count, 2);
  assert.deepEqual(items[2].questions[1], { id: "spill_box", position: 2, type: "box", instructions: "the spilled coffee beans in `photo`", criteria: [] });
  assert.equal(items[3].state_type, "array");
  assert.equal(items[3].questions[0].instructions, "{\"text\":\"Rate the overall sentiment of the reviews\"}");
  assert.deepEqual(items[3].questions[0].criteria.map((c) => c.key), ["0", "1", "2"]);
  assert.equal(items[0].state_type, "text");
  assert.equal(items[0].criteria_count, 6);
  assert.deepEqual(items[5], { id: "blank-draft", position: 6, title: "Blank starting point", pattern: "", blurb: "", code: "", state: "", state_type: "text",
    state_bytes: 0, questions: [], question_count: 0, types: [], criteria_count: 0, pictures: [], picture_count: 0, expectation_count: 0 });
  const text = JSON.stringify(items);
  for (const leak of ["\"expect\"", "\"min\"", "\"choice\":\"shipping\"", "iVBORw0KGgo=", "data_base64"]) assert.ok(!text.includes(leak), `items must not carry ${leak}`);
  assert.ok(Object.isFrozen(items) && Object.isFrozen(items[0].questions[0].criteria[0]) && Object.isFrozen(items[1].state));
  assert.equal(ctx.items(), items, "the same list gives the same item objects");
  assert.equal(ctx.itemName(items[1], 1), "wholesale-lead");
});

test("gallery shown(): the page's filters and sort, then Lab's filter and sort; data follows the page session", () => {
  assert.deepEqual(ids(sampleExamplesCtx({ view: { type: "box" } }).shown()), ["bag-photo", "crate-locate"]);
  assert.deepEqual(ids(sampleExamplesCtx({ view: { sort: "most" } }).shown()), ["order-triage", "wholesale-lead", "late-delivery", "bag-photo", "crate-locate", "review-batch", "blank-draft"]);
  const lab = createLab([examplesPack]);
  const ctx = sampleExamplesCtx({ lab, view: { sort: "most" }, pins: ["crate-locate", "order-triage"], expanded: ["bag-photo"] });
  assert.equal(ctx.shown()[0], ctx.items()[0], "shown() returns the item objects of items()");
  lab.view(GALLERY).filters = [{ key: "workbench-examples-starter/yes_no_count", op: "min", value: "1" }];
  assert.deepEqual(ids(ctx.shown()), ["order-triage", "wholesale-lead", "late-delivery", "bag-photo"]);
  lab.view(GALLERY).sort = { key: "workbench-examples-starter/instruction_words", dir: "desc" };
  assert.deepEqual(ids(ctx.shown()), ["wholesale-lead", "order-triage", "late-delivery", "bag-photo"], "Lab's sort applies after the page's");
  assert.equal(ctx.data.pageShown, 7);
  assert.equal(lab.active(GALLERY), 2);
  assert.deepEqual(ctx.data.pins, ["order-triage", "crate-locate"], "pins in gallery order, hidden ones included");
  assert.deepEqual(ctx.data.expanded, ["bag-photo"]);
  assert.equal(ctx.data.loaded, "order-triage");
  assert.deepEqual(ctx.data.view, { ...exampleBrowserDefaults(), sort: "most" });
  assert.ok(Object.isFrozen(ctx.data.view));
  ctx.actions.resetView();
  assert.equal(lab.active(GALLERY), 0, "Reset example view clears Lab's filters and sort");
  assert.deepEqual(ids(ctx.shown()), ids(ctx.items()));
});

test("gallery actions: open, pin, unpin, expand and collapse need an id in the gallery", () => {
  const ctx = sampleExamplesCtx({ view: { type: "box" }, loaded: null });
  for (const name of ["open", "pin", "unpin", "expand", "collapse"]) assert.throws(() => ctx.actions[name]("no-such-example"), /no example "no-such-example"/);
  assert.equal(ctx.data.loaded, null);
  ctx.actions.pin("order-triage");  // hidden by the type filter: pinning it is still allowed
  ctx.actions.expand("bag-photo");
  ctx.actions.collapse("bag-photo");
  ctx.actions.unpin("order-triage");
  ctx.actions.open("crate-locate");
  assert.deepEqual(ctx.calls, [["pin", "order-triage"], ["expand", "bag-photo"], ["collapse", "bag-photo"], ["unpin", "order-triage"], ["open", "crate-locate"]]);
  assert.equal(ctx.data.loaded, "crate-locate");
  assert.equal(ctx.actions.replaceItems, undefined);
  assert.equal(ctx.actions.importItems, undefined);
  let opened = null;
  const raw = sampleExamples();
  shellExamplesCtx({ examples: raw, open: (example) => { opened = example; } }).actions.open("wholesale-lead");
  assert.equal(opened, raw[1], "open hands the page its own authored example");
  assert.throws(() => shellExamplesCtx({ examples: raw }).actions.open("bag-photo"), /cannot do that here/);
  assert.deepEqual(ids(shellExamplesCtx({ examples: raw }).shown()), ids(raw), "without a visible() source every example is shown");
});

test("the surface module exports exactly the three builders", () => {
  assert.deepEqual(Object.keys(builders).sort(), ["shellCtx", "shellExamplesCtx", "shellToolboxCtx"]);
});

// ---------- the gallery hook in static/js/examples-browser.js ----------

test("visibleExamples: Lab's test runs inside the filter and Lab's arrange after the page's sort; without hooks nothing changes", () => {
  const examples = sampleExamples();
  const view = { ...exampleBrowserDefaults(), sort: "title" };
  const plain = visibleExamples(examples, view).map((ex) => ex.id);
  assert.deepEqual(visibleExamples(examples, view, null).map((ex) => ex.id), plain);
  assert.deepEqual(visibleExamples(examples, view, {}).map((ex) => ex.id), plain);
  const seen = [];
  const out = visibleExamples(examples, { ...view, type: "noul" }, {
    matches: (ex) => { seen.push(ex.id); return ex.id !== "wholesale-lead"; },
    arrange: (list) => { assert.deepEqual(list.map((ex) => ex.id), ["bag-photo", "late-delivery", "order-triage"]); return [...list].reverse(); },
  });
  assert.deepEqual(seen, ["order-triage", "wholesale-lead", "bag-photo", "late-delivery"], "Lab is asked only about examples the page's own filters keep");
  assert.deepEqual(out.map((ex) => ex.id), ["order-triage", "late-delivery", "bag-photo"]);
});

// A minimal tree with the DOM methods the gallery uses, as in tests/js/examples-refinements.test.mjs.
function treeH(tag, attrs = {}, ...children) {
  return { tag, attrs, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
    replaceChildren(...next) { this.children = next; }, replaceWith(next) { this.replacement = next; },
    get textContent() { return this.text ?? this.children.map((c) => (typeof c === "object" ? c.textContent : String(c))).join(""); },
    set textContent(value) { this.text = value; }, click() {} };
}
const treeAll = (root) => [root, ...root.children.filter((c) => typeof c === "object").flatMap(treeAll)];
const cardIds = (root) => treeAll(root).filter((n) => n.attrs["data-example-id"]).map((n) => n.attrs["data-example-id"]);
const button = (root, label) => treeAll(root).find((n) => n.tag === "button" && n.textContent === label);
const status = (root) => treeAll(root).find((n) => n.attrs.role === "status" && n.attrs["aria-live"] === "polite").textContent;
const labEnv = () => ({ ...fakeEnv(), h: treeH, mount: (node, ...kids) => { node.children = kids.flat(Infinity).filter(Boolean); return node; } });

test("renderExamplesBrowser: the Lab section renders beside the controls and Lab filters reach the cards, count, pins and reset", () => {
  const examples = sampleExamples();
  const host = createLab([examplesPack], builders);
  const env = labEnv();
  const opened = [];
  const root = renderExamplesBrowser(treeH, examples, (ex) => opened.push(ex.id), { host, env, loaded: () => "bag-photo" });
  const section = treeAll(root).find((n) => n.attrs["data-lab-surface"] === GALLERY);
  assert.ok(section, "the gallery's Lab section is in the page");
  assert.ok(root.children.indexOf(section) > 0, "it sits beside the gallery's own controls");
  assert.deepEqual(cardIds(root), ids(examples));
  assert.equal(host.mountedIds().includes(GALLERY), true);
  // A Lab filter, as the Refine block sets it, then the surface's refresh().
  host.view(GALLERY).filters = [{ key: "workbench-examples-starter/picture_source", op: "is", value: "no pictures" }, { key: "workbench-examples-starter/yes_no_count", op: "min", value: "1" }];
  const labCtx = host.commandEntries().find(([key]) => key.startsWith("workbench-examples-starter/"))[2];
  assert.equal(labCtx.data.loaded, "bag-photo");
  labCtx.refresh();
  assert.deepEqual(cardIds(root), ["order-triage", "wholesale-lead", "late-delivery"]);
  assert.match(status(root), /^3 of 7 examples · 9 authored questions · 2 Lab settings active$/);
  button(root, "Pin shown examples").attrs.onclick();
  assert.deepEqual(labCtx.data.pins, ["order-triage", "wholesale-lead", "late-delivery"], "Pin shown counts Lab's filters like any other filter");
  labCtx.actions.open("late-delivery");
  assert.deepEqual(opened, ["late-delivery"]);
  button(root, "Reset example view").attrs.onclick();
  assert.equal(host.active(GALLERY), 0, "Reset example view also clears Lab's filters");
  const reset = root.replacement;
  assert.deepEqual(cardIds(reset), ids(examples));
  assert.match(status(reset), /^7 of 7 examples · 14 authored questions$/);
  assert.ok(treeAll(reset).some((n) => n.attrs["data-lab-surface"] === GALLERY), "the reset gallery keeps its Lab section");
  button(reset, "Unpin shown examples").attrs.onclick();
});

test("renderExamplesBrowser without a Lab host, or before the page index holds the builder, is the gallery as before", () => {
  const examples = sampleExamples();
  for (const lab of [null, { host: createLab([examplesPack]), env: labEnv() }]) {
    const root = renderExamplesBrowser(treeH, examples, () => {}, lab);
    assert.ok(!treeAll(root).some((n) => n.attrs["data-lab-surface"]));
    assert.deepEqual(cardIds(root), ids(examples));
    assert.match(status(root), /^7 of 7 examples · 14 authored questions$/);
    button(root, "Reset example view").attrs.onclick();
  }
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
  const h = (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((x) => x != null && x !== false) });
  const extra = h("div", { "data-lab-surface": "workbench.shell" });
  const guide = renderWorkbenchGuide(h, {}, () => {}, { extra });
  const body = guide.children[1];
  assert.equal(body.children.at(-1), extra);
  assert.equal(renderWorkbenchGuide(h, {}, () => {}).children[1].children.length, 2);
});

// ---------- static/js/workbench.js: the Toolbox tab and the shell ctx, rebuilt from source ----------

const workbench = moduleSources["workbench.js"];
const body = (name) => workbench.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const fakeH = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) });

test("workbench.js lists the Toolbox tab, opens it from #toolbox and reaches Lab only through W in its new functions", () => {
  assert.match(workbench, /const TABS = \[[^\n]*\["toolbox", "Toolbox"\]\];/);
  assert.match(workbench, /case "toolbox": view = renderToolbox\(\); break;/);
  assert.match(workbench, /role: "tab",\s*\n?\s*"aria-selected": W\.tab === k \? "true" : "false", "aria-controls": "view", tabindex: W\.tab === k \? "0" : "-1"/);
  assert.match(workbench, /tabForKey\(tabIds, W\.tab, event\.key\)/);
  assert.match(workbench, /window\.addEventListener\("hashchange"/);
  for (const name of ["renderToolbox", "shellLabCtx", "renderGuide", "openWorkbenchTab", "navigateGuideStep", "guideSnapshot"]) {
    assert.ok(!/\bLAB\b/.test(body(name)), `${name} must reach Lab through W`);
  }
});

test("renderToolbox: an empty state without tools, and the flat Toolbox section with them", () => {
  const make = new Function("W", "h", "icon", "TOOLBOX_LAB", "TABS", "openWorkbenchTab", "render", `${body("renderToolbox")}; return renderToolbox;`);
  const opened = [];
  const args = (W) => [W, fakeH, () => null, "workbench.toolbox", SHELL_TABS, (tab) => opened.push(tab), () => {}];
  const bare = make(...args({ bulk: { costs: {} } }))();
  assert.match(textOf(bare), /Toolbox/);
  assert.match(textOf(bare), /nothing is sent anywhere/);
  assert.ok(find(bare, (n) => n.attrs?.class === "empty" && /No tools are loaded/.test(textOf(n))));
  const lab = createLab([toolboxPack], builders);
  const W = { lab, labEnv: fakeEnv(), imageLimits: { min_side: 280, max_side: 1568, max_images: 4 }, bulk: { costs: { review: "3", error: "30" } } };
  const view = make(...args(W))();
  const section = find(view, (n) => n.attrs?.["data-lab-surface"] === "workbench.toolbox");
  assert.ok(section && /\bflat\b/.test(section.attrs.class), "the Toolbox section renders flat, without a disclosure");
  assert.ok(!find(view, (n) => n.attrs?.class === "empty"));
  assert.ok(findAll(view, (n) => n.attrs?.role === "listitem").length >= 25, "every starter tool is listed");
  const mounted = lab.commandEntries();
  assert.equal(mounted.length, 0);
  assert.deepEqual(lab.mountedIds(), ["workbench.toolbox"]);
});

test("shellLabCtx: built once from the page's state, with the page's own tab switch and guide navigation", () => {
  const calls = [];
  const W = { tab: "build", guideOpen: false, items: [{}, {}], examples: [{}], bulk: { datasets: [{ check: {} }, {}] }, labEnv: fakeEnv(), lab: { builders } };
  const make = new Function("W", "TABS", "workflowSteps", "guideSnapshot", "buildUnsaved", "bulkUnsaved", "preparedLabelsUnsaved", "reviewQueuesUnsaved",
    "driftQueuesUnsaved", "datasetEditsUnsaved", "agreementSessionsUnsaved", "navigateGuideStep", "openWorkbenchTab", "renderGuide", "$", "render",
    `let wbShellCtx = null; let wbShellReady = true; let wbShellPreviousTab = "tests"; ${body("shellLabCtx")}; return shellLabCtx;`);
  const snapshot = { questionCount: 2, rowCount: 5, currentRun: false, healthCurrent: true, gateableCount: 2, hasSavedCheck: true };
  const shellLab = make(W, SHELL_TABS, workflowSteps, () => snapshot, () => true, () => false, () => false, () => false, () => false, () => false, () => false,
    (tab, target) => calls.push(["navigate", tab, target]), (tab) => { calls.push(["open", tab]); W.tab = tab; }, () => calls.push(["guide"]),
    (selector) => ({ focus: () => calls.push(["focus", selector]) }), () => calls.push(["render"]));
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
  assert.deepEqual(calls, [["open", "toolbox"], ["navigate", "bulk", "#dataset-health"], ["guide"], ["focus", "#tabs .tab.active"], ["render"]]);
  const none = new Function("W", `let wbShellCtx = null; ${body("shellLabCtx")}; return shellLabCtx;`)({ lab: undefined });
  assert.equal(none(), null, "no builder yet: no shell ctx, and the page renders as before");
});

test("the shell section renders in the guide with the starter pack, and every starter command is reachable once mounted", () => {
  const lab = createLab([shellPack], builders);
  const ctx = sampleShellCtx();
  const tree = lab.section(fakeEnv(), "workbench.shell", ctx, { title: "Page tools" });
  assert.match(textOf(tree), new RegExp(`^Page tools · ${improvementsOf(shellPack).length}(?!\\d)`));
  const commands = shellPack.features.filter((feature) => feature.kind === "command");
  assert.ok(commands.length > 0);
  assert.deepEqual(lab.commandEntries().map(([key]) => key).sort(), commands.map((command) => `${shellPack.id}/${command.id}`).sort());
});
