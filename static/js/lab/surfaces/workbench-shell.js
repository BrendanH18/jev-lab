// Lab surfaces of the Workbench shell (static/js/workbench.js: the tab bar, the guide and the page state) and the
// Toolbox tab. Pure code: it imports nothing, touches no DOM, storage or network, and is tested in Node
// (tests/js/lab/surface-wb-shell.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/workbench-shell.mjs
// (sampleShellCtx, sampleToolboxCtx). This header is the CONTRACT for packs on these two surfaces.
//
// Every ctx is { items(), shown(), data, actions, refresh(), itemName(item, index), env }. env ({ toast, copy,
// download }) is set by the page before a pack can run. items() and shown() are evaluated at call time. Every data
// field is a live getter that returns a fresh frozen value: read it when you need it, never keep it across renders.
// No surface here has replaceItems or importItems, so Edits (transform) and Paste to import (importer) never render:
// tabs are page structure and may not be rewritten by a pack.
// Every action throws an Error with a message for the user when its guard refuses. Packs call actions only from a
// command or a control the user just pressed, one call per press, never from a fact, metric, check or render.
// Nothing on these surfaces calls the model, spends budget or writes a file; no action here does either.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.shell"  —  builder shellCtx(source)  —  fixture sampleShellCtx(overrides)
// ---------------------------------------------------------------------------------------------------------------
// The page itself: which tab is open, the Workbench guide, and what is unsaved. It has NO list: items() and shown()
// are always []. It is mounted on every render, so its commands are in the palette (Ctrl/Cmd + K) on every tab, and
// its Lab section ("Page tools") renders at the bottom of the Workbench guide panel. Kinds it hosts: command, metric,
// exporter, panel (and behavior). Facts, checks, transforms and importers have nothing to act on here.
//
// data (live getters):
//   tab          string   the open tab's id: "build" | "tests" | "bulk" | "compare" | "examples" | "toolbox"
//   tabs         [{ id, label, position, active, count }]   the tab bar in order. position is 1-based; active is true
//                         for exactly the open tab; count is the number of saved tests for "tests" (0 included, the
//                         label shows it when above 0) and null for every other tab.
//   previousTab  string | null   the tab that was open before the current one in this page session; null at first
//                         and whenever no other tab has been shown yet.
//   guideOpen    boolean  whether the Workbench guide disclosure is open
//   steps        [{ id, position, title, tab, target, action, status, enabled }]   the guide's six workflow steps in
//                         order (static/js/workbench-guide.js workflowSteps): ids "questions", "rows", "labels", "run",
//                         "policy", "review". status is the guide's own wording; enabled is whether its button works.
//   workspace    { questionCount, rowCount, currentRun, healthCurrent, gateableCount, hasSavedCheck } | null
//                         the guide's snapshot of the workspace (numbers are whole numbers >= 0, flags booleans);
//                         null until the page has loaded its data. currentRun means the Bulk results match the rows
//                         and questions in the editor now. These describe the workspace, never accuracy.
//   counts       { savedTests, examples, datasets, checks } | null   how many saved tests (null until loaded), gallery examples, saved
//                         datasets and datasets with a saved check the page holds; null until the page has loaded.
//   unsaved      { build, bulk, labeling, review, drift, datasetEdits, agreement, any }   booleans: the same tests the
//                         page's "leave this page?" warning uses; any is true when one of them is.
//
// actions:
//   openTab(id)      shows that tab, exactly what clicking it does (it also sets location.hash). Switching tabs keeps
//                    every editor, queue and draft, so it has no confirm. Guard: id must be one of data.tabs.
//   goToStep(id)     what the guide step's button does: opens its tab and scrolls to its area. It never runs, labels
//                    or saves anything. Guard: the step must exist and be enabled (a disabled guide button refuses).
//   setGuideOpen(open)  opens or closes the guide disclosure. Guard: open must be a boolean.
//   focusTabs()      moves the keyboard focus to the open tab's button. No guard.
// refresh() re-renders the whole Workbench page (the current tab, the tab bar and the guide).
//
// Content boundaries for workbench.shell: counts, flags, tab names and the guide's wording only. Exports and metrics
// here never contain inputs, questions, labels, answers or prices, and a status never claims accuracy or a passing
// check. Guide navigation stays navigation: nothing here may run, apply, save or change configuration.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.toolbox"  —  builder shellToolboxCtx(source)  —  fixture sampleToolboxCtx(overrides)
// ---------------------------------------------------------------------------------------------------------------
// The Toolbox tab: local calculators and converters for people building typed-answer gates. It has NO list. Its
// Lab section renders flat (no disclosure) as the body of the tab, so `tool` is its main kind; it also hosts panel,
// metric and command. A tool's compute(params) gets only what the person typed (runTool): it never sees ctx, so it
// cannot depend on page state. Tools are grouped by `group`; use one of these names exactly (add a new group only
// when none fits):
//   "Proportions and intervals", "Sample sizes", "Costs and budgets", "Time and rate limits",
//   "Probabilities and odds", "Boxes and pictures"
// Defaults in tool inputs may use the published figures the app itself uses: $0.042 per million input tokens for
// Jev 1.13/1.14 (output tokens are free), the server's local cap of 120 live calls per minute, its default $2.00
// budget per server run, at most 4 pictures per request, and picture sides of 280 to 1568 pixels.
//
// data (live getters):
//   imageLimits  { minSide, maxSide, maxImages } | null   the picture limits the server reported (280, 1568, 4 today);
//                         null until the page has loaded them.
//   prices       { review, error }   the per-row prices typed in Bulk's cost fields (USD), as numbers; null for a
//                         field that is blank or not a number. They are the person's own inputs, not measurements.
// actions:
//   openTab(id)  the same as workbench.shell's openTab. Guard: id must be a Workbench tab.
// refresh() re-renders the Workbench page.
//
// Content boundaries for workbench.toolbox: a tool computes from its inputs only; every result is arithmetic on what
// was typed, labeled as an estimate, bound or projection where it is one, and never shown as measured spend or as a
// model answer. Nothing is sent anywhere.

const EMPTY = Object.freeze([]);
const UNSAVED_KEYS = Object.freeze(["build", "bulk", "labeling", "review", "drift", "datasetEdits", "agreement"]);
const WORKSPACE_COUNTS = Object.freeze(["questionCount", "rowCount", "gateableCount"]);
const WORKSPACE_FLAGS = Object.freeze(["currentRun", "healthCurrent", "hasSavedCheck"]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const asText = (value) =>
  typeof value === "string" ? value : value === null || value === undefined ? "" : (JSON.stringify(value) ?? "");
const whole = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A source field: a value, or a function that returns the value now. A callback that throws reads as missing.
function read(source, name, fallback) {
  let value;
  try {
    value = typeof source[name] === "function" ? source[name]() : source[name];
  } catch {
    value = undefined;
  }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("This page cannot do that here.");
  return source[name](...args);
}

const nameOf = (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1));

// The tab bar as [[id, label], ...] from the source (also accepts [{ id, label }]).
function tabPairs(source) {
  const list = read(source, "tabs", EMPTY);
  if (!Array.isArray(list)) return [];
  return list.flatMap((tab) => {
    const pair = Array.isArray(tab) ? tab : isObject(tab) ? [tab.id, tab.label] : [];
    return typeof pair[0] === "string" && pair[0] ? [[pair[0], asText(pair[1]) || pair[0]]] : [];
  });
}

function openTabAction(source) {
  return (id) => {
    if (!tabPairs(source).some(([tab]) => tab === id)) throw new Error(`There is no Workbench tab "${asText(id)}".`);
    return call(source, "openTab", id);
  };
}

// ---------- workbench.shell ----------

// source: {
//   tab: () => the open tab's id,     tabs: () => [[id, label], ...] in tab-bar order,
//   previousTab: () => id | null,     guideOpen: () => boolean,
//   steps: () => workflowSteps(snapshot) (static/js/workbench-guide.js),     workspace: () => that snapshot | null,
//   counts: () => { savedTests, examples, datasets, checks } | null,
//   unsaved: () => { build, bulk, labeling, review, drift, datasetEdits, agreement } (booleans or functions),
//   openTab(id), goToStep(tab, target), setGuideOpen(open), focusTabs(), refresh()   the page's own operations
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function shellCtx(source = {}) {
  const tabs = () => tabPairs(source);
  const current = () => {
    const tab = read(source, "tab", "");
    return typeof tab === "string" && tab ? tab : tabs()[0]?.[0] || "";
  };
  const steps = () => {
    const list = read(source, "steps", EMPTY);
    return (Array.isArray(list) ? list : []).filter(isObject).map((step, index) => ({
      id: asText(step.id),
      position: index + 1,
      title: asText(step.title),
      tab: asText(step.tab),
      target: asText(step.target),
      action: asText(step.action),
      status: asText(step.status),
      enabled: step.enabled === true,
    }));
  };
  const ctx = {
    items: () => EMPTY,
    shown: () => EMPTY,
    data: {
      get tab() {
        return current();
      },
      get tabs() {
        const open = current();
        const saved = read(source, "counts", null);
        return deepFreeze(
          tabs().map(([id, label], index) => ({
            id,
            label,
            position: index + 1,
            active: id === open,
            count: id === "tests" && saved?.savedTests !== null ? whole(saved?.savedTests) : null,
          })),
        );
      },
      get previousTab() {
        const tab = read(source, "previousTab", null);
        return typeof tab === "string" && tab && tab !== current() && tabs().some(([id]) => id === tab) ? tab : null;
      },
      get guideOpen() {
        return read(source, "guideOpen", false) === true;
      },
      get steps() {
        return deepFreeze(steps());
      },
      get workspace() {
        const snapshot = read(source, "workspace", null);
        if (!isObject(snapshot)) return null;
        const out = {};
        for (const key of WORKSPACE_COUNTS) out[key] = whole(snapshot[key]);
        for (const key of WORKSPACE_FLAGS) out[key] = snapshot[key] === true;
        return Object.freeze(out);
      },
      get counts() {
        const counts = read(source, "counts", null);
        if (!isObject(counts)) return null;
        return Object.freeze({
          savedTests: counts.savedTests === null ? null : whole(counts.savedTests),
          examples: whole(counts.examples),
          datasets: whole(counts.datasets),
          checks: whole(counts.checks),
        });
      },
      get unsaved() {
        const raw = read(source, "unsaved", {});
        const out = {};
        for (const key of UNSAVED_KEYS) {
          let value = isObject(raw) ? raw[key] : false;
          try {
            if (typeof value === "function") value = value();
          } catch {
            value = false;
          }
          out[key] = value === true;
        }
        out.any = UNSAVED_KEYS.some((key) => out[key]);
        return Object.freeze(out);
      },
    },
    actions: {
      openTab: openTabAction(source),
      goToStep(id) {
        const step = steps().find((entry) => entry.id === id);
        if (!step) throw new Error(`There is no guide step "${asText(id)}".`);
        if (!step.enabled) throw new Error(`${step.title} is not available yet: ${step.status}.`);
        return call(source, "goToStep", step.tab, step.target);
      },
      setGuideOpen(open) {
        if (typeof open !== "boolean") throw new Error("Say whether the guide should be open or closed.");
        return call(source, "setGuideOpen", open);
      },
      focusTabs: () => call(source, "focusTabs"),
    },
    refresh: () => {
      if (typeof source.refresh === "function") source.refresh();
    },
    itemName: nameOf,
  };
  return ctx;
}

// ---------- workbench.toolbox ----------

const price = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

// source: {
//   imageLimits: () => { min_side, max_side, max_images } (the server's names) or { minSide, maxSide, maxImages } | null,
//   prices: () => { review, error } as typed (strings or numbers),
//   tabs: () => [[id, label], ...],     openTab(id), refresh()
// }
export function shellToolboxCtx(source = {}) {
  return {
    items: () => EMPTY,
    shown: () => EMPTY,
    data: {
      get imageLimits() {
        const limits = read(source, "imageLimits", null);
        if (!isObject(limits)) return null;
        const pick = (snake, camel) => {
          const value = limits[camel] ?? limits[snake];
          return Number.isInteger(value) && value > 0 ? value : null;
        };
        const out = {
          minSide: pick("min_side", "minSide"),
          maxSide: pick("max_side", "maxSide"),
          maxImages: pick("max_images", "maxImages"),
        };
        return out.minSide === null && out.maxSide === null && out.maxImages === null ? null : Object.freeze(out);
      },
      get prices() {
        const typed = read(source, "prices", {});
        return Object.freeze({
          review: isObject(typed) ? price(typed.review) : null,
          error: isObject(typed) ? price(typed.error) : null,
        });
      },
    },
    actions: { openTab: openTabAction(source) },
    refresh: () => {
      if (typeof source.refresh === "function") source.refresh();
    },
    itemName: nameOf,
  };
}
