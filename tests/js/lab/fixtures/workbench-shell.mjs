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
//   sampleExamplesCtx({ examples, view, pins, expanded, loaded, lab })
//     the seven examples below through the page's own visibleExamples; view merges into exampleBrowserDefaults();
//     pins/expanded are arrays of ids; lab is a createLab(...) host whose filters and sort apply (none by default).
import { exampleBrowserDefaults, visibleExamples } from "../../../../static/js/examples-browser.js";
import { workflowSteps } from "../../../../static/js/workbench-guide.js";
import { shellCtx, shellExamplesCtx, shellToolboxCtx } from "../../../../static/js/lab/surfaces/workbench-shell.js";
import { fakeEnv } from "../harness.mjs";

export const SHELL_TABS = Object.freeze([["build", "Build"], ["tests", "Tests"], ["bulk", "Bulk"], ["compare", "Compare"], ["examples", "Examples"], ["toolbox", "Toolbox"]]);

const SHELL_DEFAULTS = {
  tab: "bulk", previousTab: "build", guideOpen: false, ready: true,
  workspace: { questionCount: 4, rowCount: 12, currentRun: true, healthCurrent: false, gateableCount: 4, hasSavedCheck: false },
  counts: { savedTests: 3, examples: 13, datasets: 2, checks: 1 },
  unsaved: { build: false, bulk: true, labeling: false, review: false, drift: false, datasetEdits: false, agreement: false },
};

export function sampleShellCtx(overrides = {}) {
  const state = { ...SHELL_DEFAULTS, ...overrides };
  state.workspace = { ...SHELL_DEFAULTS.workspace, ...(overrides.workspace || {}) };
  state.unsaved = { ...SHELL_DEFAULTS.unsaved, ...(overrides.unsaved || {}) };
  const calls = [];
  const show = (tab) => { if (tab !== state.tab) state.previousTab = state.tab; state.tab = tab; };
  const ctx = shellCtx({
    tab: () => state.tab, tabs: () => SHELL_TABS, previousTab: () => state.previousTab, guideOpen: () => state.guideOpen,
    steps: () => workflowSteps(state.ready ? state.workspace : {}),
    workspace: () => (state.ready ? state.workspace : null),
    counts: () => (state.ready ? state.counts : null),
    unsaved: () => state.unsaved,
    openTab: (tab) => { calls.push(["openTab", tab]); show(tab); },
    goToStep: (tab, target) => { calls.push(["goToStep", tab, target]); show(tab); },
    setGuideOpen: (open) => { calls.push(["setGuideOpen", open]); state.guideOpen = open; },
    focusTabs: () => { calls.push(["focusTabs"]); },
    refresh: () => { calls.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.calls = calls;
  ctx.state = state;
  return ctx;
}

export function sampleToolboxCtx(overrides = {}) {
  const state = { imageLimits: { min_side: 280, max_side: 1568, max_images: 4 }, prices: { review: "2", error: "20" }, tab: "toolbox", ...overrides };
  const calls = [];
  const ctx = shellToolboxCtx({ imageLimits: () => state.imageLimits, prices: () => state.prices, tabs: () => SHELL_TABS,
    openTab: (tab) => { calls.push(["openTab", tab]); state.tab = tab; }, refresh: () => { calls.push(["refresh"]); } });
  ctx.env = fakeEnv();
  ctx.calls = calls;
  ctx.state = state;
  return ctx;
}

// Seven authored examples in the gallery's shape (jev/examples.py), covering text, object and array states, all four
// question types, Noul wording on both sides and on one side, instructions that are not text, a field the state
// lacks, built-in and embedded pictures, a Box without a picture, thin Choice and Score questions, repeated
// instructions, expectations (which items count but never carry) and an example with nothing but an id and title.
export function sampleExamples() {
  return [
    { id: "order-triage", title: "Order problem triage", pattern: "Route + score + flag in one call",
      blurb: "Sort a Harbor Coffee Co. support email by team, mood and refund request.",
      code: "route by `department.choice`; refund queue when `wants_refund.noul` >= 0.7.",
      state: "Hi Harbor Coffee, my order of Ethiopian beans arrived crushed. Can I get a replacement?",
      questions: {
        department: { type: "choice", instructions: "Which team should handle this message?",
          criteria: { billing: "Charges and refunds", shipping: "Delivery and damaged parcels", product: "Coffee and brewing questions" } },
        frustration: { type: "score", instructions: "How frustrated does the writer sound?", criteria: ["Calm", "Frustrated but civil", "Very angry"] },
        wants_refund: { type: "noul", instructions: "Does the writer ask for a refund or replacement?" },
      },
      expect: { department: { choice: "shipping" }, wants_refund: { min: 0.7 } } },
    { id: "wholesale-lead", title: "Wholesale lead scoring", pattern: "Score a lead for the sales team",
      blurb: "Turn a wholesale enquiry into numbers the sales team can sort by.", code: "call back first when `volume.score` >= 2.",
      state: { company: "Driftwood Cafe", email: "owner@driftwood.example", message: "We go through 20 kg of espresso beans a week and want a supplier from March." },
      questions: {
        is_business: { type: "noul", instructions: "Is the sender in `message` a business buying for resale?",
          criteria: { true: "A cafe, restaurant or shop", false: "A home customer" } },
        volume: { type: "score", instructions: "How much coffee does `message` suggest they buy?",
          criteria: ["Under 1 kg a week", "1 to 10 kg a week", "10 to 50 kg a week", "Over 50 kg a week"] },
        timing: { type: "choice", instructions: "When does the buyer in `notes` want to start?",
          criteria: { now: "Within a month", later: "Later this year", unknown: "Not stated" } },
      } },
    { id: "bag-photo", title: "Damaged bag photo", pattern: "Images + Box: is it there, and where",
      blurb: "A delivery photo goes in the state like any other field.", code: "crop to `spill_box` when `beans_spilled.noul` >= 0.5.",
      state: { photo: "photo-torn-bag", context: "A customer photo of a delivered bag" },
      images: { "photo-torn-bag": { sample: "torn-bag" }, "photo-spare-angle": { format: "png", data_base64: "iVBORw0KGgo=" } },
      questions: {
        beans_spilled: { type: "noul", instructions: "Are coffee beans spilled outside the bag in `photo`?" },
        spill_box: { type: "box", instructions: "the spilled coffee beans in `photo`" },
      },
      expect: { beans_spilled: { min: 0.6 } } },
    { id: "review-batch", title: "Review batch grading", pattern: "Score many reviews at once", blurb: "", code: "",
      state: [{ text: "Great roast, fast delivery" }, { text: "Too bitter for me" }],
      questions: {
        sentiment: { type: "score", instructions: { text: "Rate the overall sentiment of the reviews" }, criteria: ["Negative", "Mixed", "Positive"] },
      } },
    { id: "late-delivery", title: "Late delivery check", pattern: "Flag + route",
      blurb: "Spot late orders before the customer writes twice.", code: "escalate when `is_late.noul` >= 0.5.",
      state: { message: "My grinder order is a week late and nobody answers." },
      questions: {
        is_late: { type: "noul", instructions: "Does `message` say an order is late?", criteria: { true: "Mentions a delay", false: null } },
        team: { type: "choice", instructions: "Which team should answer?", criteria: { shipping: "Delivery problems" } },
        repeat_check: { type: "noul", instructions: "does `message`  say an order is late?" },
      },
      expect: { is_late: { min: 0.5 } } },
    { id: "blank-draft", title: "Blank starting point", state: "", questions: {} },
    { id: "crate-locate", title: "Find the crate", pattern: "Box", blurb: "Where is the crate on the pallet?", code: "send the box to the picker.",
      state: { photo: "crate-photo" },
      questions: {
        crate_box: { type: "box", instructions: "the coffee crate in `photo`" },
        fill: { type: "score", instructions: "How full is the crate?", criteria: ["Empty"] },
      } },
  ];
}

export function sampleExamplesCtx(overrides = {}) {
  const examples = overrides.examples || sampleExamples();
  const view = { ...exampleBrowserDefaults(), ...(overrides.view || {}), pins: new Set(overrides.pins || []), expanded: new Set(overrides.expanded || []) };
  const state = { loaded: overrides.loaded === undefined ? "order-triage" : overrides.loaded };
  const lab = overrides.lab || null;
  const calls = [];
  const ID = "workbench.examples.gallery";
  const ctx = shellExamplesCtx({
    examples: () => examples, visible: (hooks) => visibleExamples(examples, view, hooks), view: () => view,
    pins: () => view.pins, expanded: () => view.expanded, loaded: () => state.loaded,
    matches: lab ? (item, c) => lab.matches(ID, item, c) : undefined,
    arrange: lab ? (items, c) => lab.arrange(ID, items, c) : undefined,
    open: (example) => { calls.push(["open", example.id]); state.loaded = example.id; },
    pin: (id) => { calls.push(["pin", id]); view.pins.add(id); },
    unpin: (id) => { calls.push(["unpin", id]); view.pins.delete(id); },
    expand: (id) => { calls.push(["expand", id]); view.expanded.add(id); },
    collapse: (id) => { calls.push(["collapse", id]); view.expanded.delete(id); },
    resetView: () => { calls.push(["resetView"]); Object.assign(view, exampleBrowserDefaults()); lab?.reset(ID); },
    refresh: () => { calls.push(["refresh"]); },
  });
  ctx.env = fakeEnv();
  ctx.calls = calls;
  ctx.view = view;
  return ctx;
}
