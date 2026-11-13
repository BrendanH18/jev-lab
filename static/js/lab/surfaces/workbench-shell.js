// Lab surfaces of the Workbench shell (static/js/workbench.js: the tab bar, the guide and the page state), the NEW
// Toolbox tab, and the Examples gallery (static/js/examples-browser.js). Pure code: it imports only the kit and the
// page's pure gallery helpers (static/js/examples-refinements.js), touches no DOM, storage or network, and is tested in
// Node (tests/js/lab/surface-wb-shell-examples.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/workbench-shell.mjs
// (sampleShellCtx, sampleToolboxCtx, sampleExamplesCtx). This header is the CONTRACT for packs on these three surfaces.
//
// Every ctx is { items(), shown(), data, actions, refresh(), itemName(item, index), env }. env ({ toast, copy,
// download }) is set by the page before a pack can run. items() and shown() are evaluated at call time. Every data
// field is a live getter that returns a fresh frozen value: read it when you need it, never keep it across renders.
// No surface here has replaceItems or importItems, so Edits (transform) and Paste to import (importer) never render:
// tabs are page structure and examples are authored built-ins, and neither may be rewritten by a pack.
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
//   counts       { savedTests, examples, datasets, checks } | null   how many saved tests, gallery examples, saved
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
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "workbench.examples.gallery"  —  builder shellExamplesCtx(source)  —  fixture sampleExamplesCtx(overrides)
// ---------------------------------------------------------------------------------------------------------------
// The Examples tab's gallery of authored starting points (jev/examples.py), one item per example in gallery order.
// shown() is what the gallery shows now: the page's own search, type, picture, expectation, input-shape, bound,
// type-mix and pin filters, then Lab's filters, in the page's sort order (Gallery order, Title, Fewest/Most questions,
// state size, criteria), then Lab's sort when one is set. Everything the page does with "shown examples" (Pin shown,
// Copy shown IDs, Expand/Collapse shown previews, Download shown metadata/CSV, the "x of y examples" count) counts
// Lab's filters like any other filter. Pinned handoffs keep including hidden pins, as before. items() and shown()
// return the SAME frozen objects (compare by identity), which stay the same while the gallery list is the same.
// Kinds it hosts: fact, diagnostic, metric, exporter, command, panel (and behavior). Read-only: no transform/importer.
//
// Item (one example; authored content only, deeply frozen):
//   id                 string   the example id ("support-triage"). Unique in the built-in gallery. itemName() returns it.
//   position           number   1-based position in gallery order
//   title, pattern, blurb, code   strings as authored ("" when missing). code is the "In code:" note.
//   state              string | object | array | null   the authored input exactly as the example holds it
//   state_type         "text" | "object" | "array"   as the card prints it ("text" for a string or any non-object)
//   state_bytes        number   UTF-8 bytes of the authored state (a string as-is, anything else as compact JSON); the
//                               same count as the page's "authored state bytes" bounds. Not a token count, not spend.
//   questions          [{ id, position, type, instructions, criteria }]   in authored order. type is "choice" |
//                               "noul" | "score" | "box" (other strings pass through). instructions is the text (an
//                               instruction that is not a string is given as JSON; "" when missing). criteria is
//                               [{ key, text }] in authored order: Choice its option keys and descriptions; Score one
//                               per level with key "0", "1", …; Noul [] or [{ key: "true", text }, { key: "false",
//                               text }] when yes/no wording was authored (a missing side reads ""); Box [].
//   question_count     number   questions.length
//   types              string[] the distinct question types, sorted A to Z
//   criteria_count     number   Choice options plus Score levels (Noul and Box add nothing), as the page counts them
//   pictures           [{ name, sample }]   the example's picture references in authored order: name is what the state
//                               or a question points at; sample is the built-in sample picture's name, or null for an
//                               embedded picture. Never picture bytes.
//   picture_count      number   pictures.length
//   expectation_count  number   how many questions carry an authored expectation. The expectations themselves are NOT
//                               in the item and must never be exported (AGENTS.md: requests never carry expectations).
//
// data (live getters):
//   view       { query, type, images, expectations, stateType, sort, compact, searchScope, searchMode, exclude,
//                minQuestions, maxQuestions, minCriteria, maxCriteria, minStateBytes, maxStateBytes, typeMix, pinned }
//              the gallery's own settings as typed (strings, compact a boolean). Presentation state of this page session.
//   pins       string[]   ids of the pinned examples in gallery order, hidden ones included. Session only; [] at first.
//   expanded   string[]   ids whose "Preview authored request" is open, in gallery order
//   loaded     string | null   the example last opened into Build in this page session (Build may have been edited
//              since); null when Build holds something else, such as a demo handoff
//   pageShown  number     how many examples the page's own filters leave, before Lab's filters
// actions:
//   open(id)      the card's "Open in Build": loads the example's state, questions and pictures into Build and switches
//                 to it. Build asks before replacing unsaved edits (the person can cancel); no model call. Guard: the
//                 id must be in items(). Opening stays explicit: call it only from a command the person ran.
//   pin(id), unpin(id)       the card's Pin/Unpin (session presentation state). Guard: the id must be in items(); a
//                 hidden example may be pinned.
//   expand(id), collapse(id) open or close the card's request preview. Guard: the id must be in items().
//   resetView()   the page's "Reset example view": every gallery setting back to its default, and Lab's filters and
//                 sort cleared. Pins and open previews stay. No guard.
// refresh() re-renders the cards and the count from shown().
//
// Content boundaries for workbench.examples.gallery:
//   - Items are authored content: state, ordered questions, picture names. An export described as a request or a
//     handoff carries state, questions and picture references only. Metadata exports carry ids, titles, counts, types
//     and input shapes only (the page's metadata allowlist), and CSV goes through csvText/csvCell (formula escaping).
//   - Never export or show expectations (only expectation_count exists here) and never show a model answer: browsing
//     the gallery never runs a model. A check about wording is plain local code, advisory and labeled as such.
//   - Pins, expanded previews and Lab's filters are session-only presentation: never stored, never sent anywhere.
//   - Byte and word counts describe authored text, never tokens or spend.
import { clone } from "../kit.js";
import { exampleCounts } from "../../examples-refinements.js";

const EMPTY = Object.freeze([]);
const VIEW_KEYS = Object.freeze(["query", "type", "images", "expectations", "stateType", "sort", "compact", "searchScope", "searchMode", "exclude",
  "minQuestions", "maxQuestions", "minCriteria", "maxCriteria", "minStateBytes", "maxStateBytes", "typeMix", "pinned"]);
const UNSAVED_KEYS = Object.freeze(["build", "bulk", "labeling", "review", "drift", "datasetEdits", "agreement"]);
const WORKSPACE_COUNTS = Object.freeze(["questionCount", "rowCount", "gateableCount"]);
const WORKSPACE_FLAGS = Object.freeze(["currentRun", "healthCurrent", "hasSavedCheck"]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value) ?? "");
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
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
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
    return typeof tab === "string" && tab ? tab : (tabs()[0]?.[0] || "");
  };
  const steps = () => {
    const list = read(source, "steps", EMPTY);
    return (Array.isArray(list) ? list : []).filter(isObject).map((step, index) => ({ id: asText(step.id), position: index + 1, title: asText(step.title),
      tab: asText(step.tab), target: asText(step.target), action: asText(step.action), status: asText(step.status), enabled: step.enabled === true }));
  };
  const ctx = {
    items: () => EMPTY,
    shown: () => EMPTY,
    data: {
      get tab() { return current(); },
      get tabs() {
        const open = current();
        const saved = read(source, "counts", null);
        return deepFreeze(tabs().map(([id, label], index) => ({ id, label, position: index + 1, active: id === open,
          count: id === "tests" ? (isObject(saved) ? whole(saved.savedTests) : 0) : null })));
      },
      get previousTab() {
        const tab = read(source, "previousTab", null);
        return typeof tab === "string" && tab && tab !== current() && tabs().some(([id]) => id === tab) ? tab : null;
      },
      get guideOpen() { return read(source, "guideOpen", false) === true; },
      get steps() { return deepFreeze(steps()); },
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
        return Object.freeze({ savedTests: whole(counts.savedTests), examples: whole(counts.examples), datasets: whole(counts.datasets), checks: whole(counts.checks) });
      },
      get unsaved() {
        const raw = read(source, "unsaved", {});
        const out = {};
        for (const key of UNSAVED_KEYS) {
          let value = isObject(raw) ? raw[key] : false;
          try { if (typeof value === "function") value = value(); } catch { value = false; }
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
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
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
        const out = { minSide: pick("min_side", "minSide"), maxSide: pick("max_side", "maxSide"), maxImages: pick("max_images", "maxImages") };
        return out.minSide === null && out.maxSide === null && out.maxImages === null ? null : Object.freeze(out);
      },
      get prices() {
        const typed = read(source, "prices", {});
        return Object.freeze({ review: isObject(typed) ? price(typed.review) : null, error: isObject(typed) ? price(typed.error) : null });
      },
    },
    actions: { openTab: openTabAction(source) },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: nameOf,
  };
}

// ---------- workbench.examples.gallery ----------

function criteriaList(type, criteria) {
  if (type === "box") return [];
  if (Array.isArray(criteria)) return criteria.map((text, index) => ({ key: String(index), text: asText(text) }));
  if (!isObject(criteria)) return [];
  if (type === "noul") {
    const sides = ["true", "false"].filter((key) => key in criteria);
    return sides.length ? ["true", "false"].map((key) => ({ key, text: asText(criteria[key]) })) : [];
  }
  return Object.entries(criteria).map(([key, text]) => ({ key, text: asText(text) }));
}

function exampleItem(raw, index) {
  const questions = isObject(raw.questions) ? raw.questions : {};
  const list = Object.entries(questions).map(([id, question], position) => {
    const q = isObject(question) ? question : {};
    const type = typeof q.type === "string" ? q.type : "";
    return { id, position: position + 1, type, instructions: asText(q.instructions), criteria: criteriaList(type, q.criteria) };
  });
  const images = isObject(raw.images) ? raw.images : {};
  const state = raw.state === undefined ? null : clone(raw.state);
  let counts;
  try { counts = exampleCounts({ state: raw.state, questions: Object.fromEntries(Object.entries(questions).filter(([, q]) => isObject(q))) }); }
  catch { counts = { criteria: 0, stateBytes: 0 }; }
  return deepFreeze({
    id: asText(raw.id), position: index + 1, title: asText(raw.title), pattern: asText(raw.pattern), blurb: asText(raw.blurb), code: asText(raw.code),
    state, state_type: Array.isArray(raw.state) ? "array" : raw.state !== null && typeof raw.state === "object" ? "object" : "text",
    state_bytes: whole(counts.stateBytes), questions: list, question_count: list.length, types: [...new Set(list.map((q) => q.type))].sort(),
    criteria_count: whole(counts.criteria),
    pictures: Object.entries(images).map(([name, spec]) => ({ name, sample: isObject(spec) && typeof spec.sample === "string" && spec.sample ? spec.sample : null })),
    picture_count: Object.keys(images).length,
    expectation_count: isObject(raw.expect) ? Object.keys(raw.expect).length : 0,
  });
}

const idList = (value) => (value instanceof Set ? [...value] : Array.isArray(value) ? value : []);

// source: {
//   examples: () => the raw gallery list ({ id, title, pattern, blurb, code, state, questions, images, expect }) — return
//               the same array while the gallery is the same, so the item objects stay the same,
//   visible: (hooks) => the raw examples the page shows, in its order: visibleExamples(examples, view, hooks) of
//               static/js/examples-browser.js. hooks is { matches(raw) -> boolean, arrange(raws) -> raws } or null
//               (null: the page's own filters only),
//   view: () => the gallery's settings,     pins: () => Set | array of ids,     expanded: () => Set | array of ids,
//   loaded: () => id | null,
//   matches: (item, ctx) => boolean   (LAB.matches),     arrange: (items, ctx) => items   (LAB.arrange),
//   open(raw), pin(id), unpin(id), expand(id), collapse(id), resetView(), refresh()   the page's own operations
// }
export function shellExamplesCtx(source = {}) {
  let built = { list: null, items: EMPTY };
  const raws = () => {
    const list = read(source, "examples", EMPTY);
    return Array.isArray(list) ? list : EMPTY;
  };
  const items = () => {
    const list = raws();
    if (list !== built.list) built = { list, items: Object.freeze(list.map((raw, index) => exampleItem(isObject(raw) ? raw : {}, index))) };
    return built.items;
  };
  const find = (id) => {
    const item = items().find((entry) => entry.id === id);
    if (!item) throw new Error(`There is no example "${asText(id)}" in the gallery.`);
    return item;
  };
  // The page's visible list, with Lab's filter inside its "is this shown" test and Lab's sort after its own sort.
  const pageList = (withLab) => {
    const list = raws();
    const all = items();
    const position = new Map(list.map((raw, index) => [raw, index]));
    const itemOf = (raw) => all[position.get(raw)];
    const hooks = withLab ? {
      matches: (raw) => !source.matches || !itemOf(raw) || source.matches(itemOf(raw), ctx) !== false,
      arrange: (shown) => (source.arrange ? source.arrange(shown.map(itemOf).filter(Boolean), ctx).map((item) => list[item.position - 1]) : shown),
    } : null;
    const out = typeof source.visible === "function" ? source.visible(hooks) : hooks ? hooks.arrange(list.filter(hooks.matches)) : list;
    return (Array.isArray(out) ? out : []).map(itemOf).filter(Boolean);
  };
  const ids = (name) => {
    const chosen = new Set(idList(read(source, name, EMPTY)));
    return Object.freeze(items().filter((item) => chosen.has(item.id)).map((item) => item.id));
  };
  const ctx = {
    items,
    shown: () => pageList(true),
    data: {
      get view() {
        const view = read(source, "view", {});
        const out = {};
        for (const key of VIEW_KEYS) out[key] = key === "compact" ? (isObject(view) && view.compact === true) : asText(isObject(view) ? view[key] : "");
        return Object.freeze(out);
      },
      get pins() { return ids("pins"); },
      get expanded() { return ids("expanded"); },
      get loaded() {
        const id = read(source, "loaded", null);
        return typeof id === "string" && id ? id : null;
      },
      get pageShown() { return pageList(false).length; },
    },
    actions: {
      open: (id) => call(source, "open", raws()[find(id).position - 1]),
      pin: (id) => call(source, "pin", find(id).id),
      unpin: (id) => call(source, "unpin", find(id).id),
      expand: (id) => call(source, "expand", find(id).id),
      collapse: (id) => call(source, "collapse", find(id).id),
      resetView: () => call(source, "resetView"),
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: nameOf,
  };
  return ctx;
}
