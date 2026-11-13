// Lab surfaces of the Overview page (static/index.html, static/js/index.js): the four-question playground and the
// app cards. Pure code: it imports only the kit, touches no DOM, storage or network, and is tested in Node
// (tests/js/lab/surface-demo-index.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/index.mjs
// (sampleIndexPlaygroundCtx, sampleIndexAppsCtx; starter packs: static/js/lab/packs/index/). This header is the
// CONTRACT for packs on these two surfaces.
//
// Both ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) } and are built once per
// page load. items() and shown() are evaluated at call time and return the SAME item objects (compare by identity),
// which stay the same until the list itself changes. Items and every data value are deeply frozen: read them, never
// write to them. Every data field is a live getter: read it when you need it, do not keep a copy across renders.
// Neither surface has replaceItems or importItems, so Edits (transform) and Paste to import (importer) do not render
// here: the answers are model output and the cards are page copy, and neither may be rewritten by a pack.
// Kinds both surfaces host: fact, diagnostic, metric, exporter, command, tool, panel (and behavior).
// No action on either surface calls the model, and no pack may cause a model call: the playground asks only when the
// user edits its text or presses an example chip, exactly as before Lab.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "index.playground"  —  builder indexPlaygroundCtx(source)  —  "Try it · 4 questions, 1 call"
// ---------------------------------------------------------------------------------------------------------------
// The list is the answers of the CURRENT USER'S OWN latest answered playground call, one row per question, in the
// response's order (intent, urgency, wants_money_back, talks_to_ai for the built-in questions of jev/hello.py).
// items() is [] before the first answer of this page load, and again after a call fails because no API key is
// connected (the page then shows "Connect an API key…" instead of answers). The page has no filter of its own, so
// shown() is items() after Lab's filters and Lab's sort. A new answer replaces every item object.
//
// Item (one answer row):
//   id             string   the question id, for example "urgency". Unique in the list. itemName() returns it.
//   position       number   1-based position in the response's answer order
//   type           string   "choice" | "score" | "noul" as the API returned it. The builder also reads "box" and
//                           passes any other type through; the built-in playground only asks the first three.
//   instructions   string   the question text that was sent ("" when the request holds no such question; text that
//                           is not a string is given as JSON)
//   criteria       [{ key, text }]  the options that were sent, in authored order. Choice: key and description pairs.
//                           Score: one per level, key "0", "1", …, text the level's description. Noul: [] (or
//                           key "true"/"false" entries when yes/no criteria were sent; the built-in Nouls send none).
//                           Box and unknown types: []. A Score whose request question is missing uses the answer's
//                           legend instead; a description that is null reads "".
//   value          string | number | null   Choice: the chosen key. Score: the score, a float from 0 to scale.
//                           Noul: P(yes) from 0 to 1. Box, unknown type or a missing/odd value: null.
//   display        string   the answer as its card prints it: Choice "making request" (underscores as spaces),
//                           Score "1.62 / 2", Noul "97.0%", Box "40% × 20%" (width × height); "" when value is null.
//   scale          number | null   Score only: the highest level index (2 for the three-level urgency question)
//   probabilities  [{ key, p }]   Choice: one per option the response listed, in response order. Score: one per
//                           level, key "0", "1", …. Noul: [{ key: "yes", p }, { key: "no", p: 1 - p }] (1 - p is a
//                           plain subtraction, so compare with a tolerance). Others, or nothing usable: []. Entries
//                           whose probability is not a finite number are left out.
//   top            { key, p } | null   the entry of probabilities with the highest p (the first one on a tie)
//   confidence     number | null   the answer's own confidence field. Noul answers carry none: null.
//   box            { left, top, right, bottom } | null   Box only, fractions of the picture's width and height
//   answer         object   the raw answer exactly as the server returned it (a frozen copy)
//
// data (all live getters):
//   text        string | null   the text the shown answers were made for (request.state.text): trimmed, and cut to
//                               4,000 characters by the server. null while items() is [].
//   draft       string          what the playground textarea holds right now, untrimmed. "" when empty.
//   stale       boolean         true when answers are shown and the textarea no longer holds the text they were made
//                               for (the user is typing, a pack drafted text, or the next call is on its way).
//                               false with no answers.
//   pending     boolean         a call for the current text is in flight
//   error       string | null   the message of the latest call when it failed; null after a success, while a call is
//                               in flight, and before any call
//   configured  boolean         whether an API key is connected, as the status pill shows
//   examples    [{ label, text }]   the example chips above the answers, in page order; [] when they did not load.
//                               These are inputs only. They carry no answers and must never be shown as answered
//                               (an example whose text equals data.text is answered only through items()).
//   questions   object | null   the questions of the shown call exactly as sent: { id: { type, instructions,
//                               criteria? } }. null while items() is [].
//   request     object | null   the exact request of the shown call: { state: { text }, model, questions }
//   meta        object | null   the server's measurements of the shown call: { model, latency_ms, question_count,
//                               input_tokens, output_tokens, cost_usd, backend }. Treat every field as possibly
//                               missing. cost_usd is the measured cost of that one call, not an estimate.
//   trace       object | null   what Inspect JSON shows for the shown call: { request, response, meta }
//   calls       number          how many playground calls were answered since the page loaded (0 at first)
//   history     [{ call, at, text, meta, rows }]   the answered calls of THIS page load, oldest first, the newest
//                               50 at most: call is its 1-based number in the session (so the first entry's call can
//                               be above 1), at the arrival time in epoch milliseconds, text/meta as above, rows the
//                               same item shape as items(). It lives in memory only and is gone on reload. [] at
//                               first. The last entry is the shown call unless items() is [] (key removed).
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them only from a
// command or a control the user just pressed, one call per press, never from a fact, metric, check or render).
// NONE of them calls the model:
//   draftText(text)   puts text in the playground textarea and focuses it WITHOUT asking: the shown answers stay,
//                     data.stale turns true, and the page asks only after the user's next edit, as it always does.
//                     Guard: text must be a nonblank string. Returns the text it placed.
//   inspect()         opens the page's Inspect JSON drawer on the shown call. Guard: refuses while items() is [].
//   focusText()       moves the keyboard focus to the textarea. No guard.
//   openSettings()    opens the page's API key and spend settings dialog. No guard.
// There is no action that asks the model, edits, clears or replays answers, and none may be added by a pack.
//
// refresh() re-renders the answer cards from shown(). The page re-renders the Lab section itself when a new answer
// arrives or a call fails, not when a call starts or the user types.
//
// Content boundaries for index.playground:
//   - Everything in items() and data.history is an answer the current user requested in this page load. A pack may
//     show, measure, compare and export those. It must never show a made-up, sample, remembered or predicted answer,
//     never keep answers beyond the page session, and never present an earlier call's answer as the current one:
//     anything read from data.history is labeled as an earlier call of this session.
//   - Exports that hold answers or probabilities say so in their label or help, as does one that holds the user's
//     text. An export described as a request, a handoff or "for the Workbench" carries state, model and questions
//     only, never answers, probabilities or meta (the Open in Workbench rule of AGENTS.md).
//   - Metrics over meta are measurements of this session's calls and are labeled as measured. A projection (cost
//     per thousand calls, monthly cost) is arithmetic on a measured call and says so; it is never shown as spend.
//   - A rule a pack applies to probabilities (a threshold, "close call", "would escalate") is plain local code:
//     advisory, labeled as such, and never worded as the model's answer.
//   - No pack changes the questions, the example texts or the request. Nothing here holds the API key.
//   - CSV exports go through the kit's csvText/csvCell (spreadsheet formula escaping) on both surfaces.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "index.apps"  —  builder indexAppsCtx(source)  —  "Eight apps, one fictional business"
// ---------------------------------------------------------------------------------------------------------------
// The list is the app cards of the Overview page in page order, read once from the page's own markup. The page has
// no filter of its own, so shown() is items() after Lab's filters and Lab's sort; the page shows exactly those
// cards in that order (and "No app matches the Lab filters." when none is left).
//
// Item (one app card):
//   id        string    the card's link without slashes: "shield", "dispatch", "autopilot", "claims", "counter",
//                       "reviews", "find", "play", "workbench". Unique in the list. itemName() returns it.
//   href      string    the card's link, for example "/shield"
//   position  number    1-based position in page order
//   label     string    the small line above the title as printed: "APP 3 · INTEGRATED", "App 8"; "" when absent
//   number    number | null   the app number in that line (3); null when the line has none. The page's numbers are
//                       page copy and are not guaranteed unique.
//   tag       string    what follows "·" in that line: "INTEGRATED", "IMAGES", "BUILD YOUR OWN"; "" when absent
//   title     string    the heading as printed, emoji included: "🛡️ Shield"
//   emoji     string    the leading symbols of the heading; "" when it starts with a letter or digit
//   name      string    the heading without them: "Shield"
//   summary   string    the card's paragraph
//   points    string[]  the card's bullet points in order; [] for a card without bullets
//   featured  boolean   whether the card has the highlighted "featured" style
//   cta       string    the link text at the bottom of the card: "Open Shield →"
// All text is the page's own copy with runs of whitespace collapsed to one space.
//
// data (all live getters; page copy only):
//   heading     string              the section heading above the cards; "" when missing
//   lede        string              the paragraph under it; "" when missing
//   features    [{ title, text }]   the four capability cards above the apps ("Typed by construction", …); [] if none
//   principles  [{ title, text }]   the three "Built the way TypeSafe recommends" cards; [] if none
//
// actions (each throws an Error with a message for the user when its guard refuses):
//   open(id)   goes to that app's page, exactly what clicking its card does. Guard: the id must be in items().
//   focus(id)  scrolls to the card and moves the keyboard focus to it. Guard: the id must be in items() and the card
//              must be shown now (not hidden by a Lab filter).
//
// refresh() re-renders the card grid from shown().
//
// Content boundaries for index.apps: everything here is public page copy. Exports and metrics may contain it freely
// and nothing else; this surface holds no inputs, answers, measurements or settings, so a pack here must not claim
// anything about what an app measured or would answer. Counts are counts of words, bullets and cards, never usage.
import { clone } from "../kit.js";

const HISTORY_SHOWN = 50;
const EMPTY = Object.freeze([]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asText = (value) => (typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value) ?? "");
const tidy = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const percent = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A source field: a value, or a function that returns the value now.
function read(source, name, fallback) {
  let value;
  try { value = typeof source[name] === "function" ? source[name]() : source[name]; } catch { value = undefined; }
  return value === undefined || value === null ? fallback : value;
}

function call(source, name, ...args) {
  if (typeof source[name] !== "function") throw new Error("This page cannot do that here.");
  return source[name](...args);
}

// ---------- index.playground ----------

function criteriaOf(type, question, answer) {
  const criteria = isObject(question) ? question.criteria : undefined;
  if (type === "score") {
    if (Array.isArray(criteria)) return criteria.map((text, index) => ({ key: String(index), text: asText(text) }));
    return Object.entries(isObject(answer.legend) ? answer.legend : {}).map(([key, text]) => ({ key, text: asText(text) }));
  }
  if ((type === "choice" || type === "noul") && isObject(criteria)) return Object.entries(criteria).map(([key, text]) => ({ key, text: asText(text) }));
  return [];
}

function probabilitiesOf(type, answer) {
  if (type === "noul") {
    const yes = finite(answer.noul);
    return yes === null ? [] : [{ key: "yes", p: yes }, { key: "no", p: 1 - yes }];
  }
  if (type !== "choice" && type !== "score") return [];
  return Object.entries(isObject(answer.probabilities) ? answer.probabilities : {}).flatMap(([key, p]) => (finite(p) === null ? [] : [{ key, p }]));
}

function boxOf(type, answer) {
  if (type !== "box" || !isObject(answer.box)) return null;
  const edges = ["left", "top", "right", "bottom"].map((edge) => finite(answer.box[edge]));
  return edges.includes(null) ? null : { left: edges[0], top: edges[1], right: edges[2], bottom: edges[3] };
}

function answerRow(id, answer, question, position) {
  const type = typeof answer.type === "string" ? answer.type : "";
  const criteria = criteriaOf(type, question, answer);
  const probabilities = probabilitiesOf(type, answer);
  const box = boxOf(type, answer);
  let value = null, display = "", scale = null;
  if (type === "choice") {
    value = answer.choice === null || answer.choice === undefined ? null : String(answer.choice);
    if (value !== null) display = value.replace(/_/g, " ");
  } else if (type === "score") {
    value = finite(answer.score);
    const levels = isObject(answer.legend) && Object.keys(answer.legend).length ? Object.keys(answer.legend).length : criteria.length;
    scale = levels ? levels - 1 : null;
    if (value !== null) display = scale === null ? value.toFixed(2) : `${value.toFixed(2)} / ${scale}`;
  } else if (type === "noul") {
    value = finite(answer.noul);
    if (value !== null) display = percent(value, 1);
  } else if (box) {
    display = `${percent(box.right - box.left)} × ${percent(box.bottom - box.top)}`;
  }
  let top = null;
  for (const entry of probabilities) if (!top || entry.p > top.p) top = entry;
  return { id, position, type, instructions: isObject(question) ? asText(question.instructions) : "", criteria, value, display, scale,
    probabilities, top: top ? { ...top } : null, confidence: type === "noul" ? null : finite(answer.confidence), box, answer: clone(answer) };
}

// What one raw playground result ({ answers, meta, trace }) gives the surface. Kept per result object, so the item
// objects stay the same until a new answer arrives.
const VIEWS = new WeakMap();
function viewOf(result) {
  if (VIEWS.has(result)) return VIEWS.get(result);
  const trace = isObject(result.trace) ? result.trace : {};
  const request = isObject(trace.request) ? trace.request : null;
  const questions = request && isObject(request.questions) ? request.questions : null;
  const state = request ? request.state : undefined;
  const answers = isObject(result.answers) ? result.answers : {};
  const rows = Object.entries(answers).filter(([, answer]) => isObject(answer))
    .map(([id, answer], index) => answerRow(id, answer, questions ? questions[id] : null, index + 1));
  const view = deepFreeze({
    rows,
    text: isObject(state) && typeof state.text === "string" ? state.text : typeof state === "string" ? state : null,
    meta: isObject(result.meta) ? clone(result.meta) : null,
    questions: questions ? clone(questions) : null,
    request: request ? clone(request) : null,
    trace: isObject(result.trace) ? clone(result.trace) : null,
  });
  VIEWS.set(result, view);
  return view;
}

const ENTRIES = new WeakMap();
function historyEntry(raw) {
  if (ENTRIES.has(raw)) return ENTRIES.get(raw);
  const view = viewOf(raw.result);
  const entry = Object.freeze({ call: finite(raw.call), at: finite(raw.at), text: view.text, meta: view.meta, rows: view.rows });
  ENTRIES.set(raw, entry);
  return entry;
}

// source: {
//   result: () => the raw result of the latest answered call ({ answers, meta, trace }) or null,
//   history: () => [{ call, at, result }] oldest first,     calls: () => number of answered calls,
//   draft: () => the textarea's text,     pending: () => boolean,     error: () => string | null,
//   configured: () => boolean,     examples: () => [{ label, text }],
//   matches: (item, ctx) => boolean   (LAB.matches),     arrange: (items, ctx) => items   (LAB.arrange),
//   draftText(text), inspect(), focusText(), openSettings(), refresh()   the page's own operations; draftText must
//          place the text without asking (no input event, no call)
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function indexPlaygroundCtx(source = {}) {
  const result = () => {
    const raw = read(source, "result", null);
    return isObject(raw) ? raw : null;
  };
  const view = () => {
    const raw = result();
    return raw ? viewOf(raw) : null;
  };
  const draft = () => asText(read(source, "draft", ""));
  const examples = () => {
    const list = read(source, "examples", EMPTY);
    return Array.isArray(list) ? list.filter(isObject).map((example) => ({ label: asText(example.label), text: asText(example.text) })) : [];
  };
  const ctx = {
    items: () => view()?.rows || EMPTY,
    shown: () => {
      const list = ctx.items().filter((item) => !source.matches || source.matches(item, ctx));
      return source.arrange ? source.arrange(list, ctx) : list;
    },
    data: {
      get text() { return view()?.text ?? null; },
      get draft() { return draft(); },
      get stale() {
        const text = view()?.text;
        if (typeof text !== "string") return false;
        const typed = draft().trim();
        return typed !== text && Array.from(typed).slice(0, 4000).join("") !== text;
      },
      get pending() { return read(source, "pending", false) === true; },
      get error() {
        const message = read(source, "error", null);
        return typeof message === "string" && message ? message : null;
      },
      get configured() { return read(source, "configured", false) === true; },
      get examples() { return deepFreeze(examples()); },
      get questions() { return view()?.questions ?? null; },
      get request() { return view()?.request ?? null; },
      get meta() { return view()?.meta ?? null; },
      get trace() { return view()?.trace ?? null; },
      get calls() {
        const count = read(source, "calls", null);
        return Number.isInteger(count) && count >= 0 ? count : ctx.data.history.length;
      },
      get history() {
        const list = read(source, "history", EMPTY);
        if (!Array.isArray(list)) return EMPTY;
        return Object.freeze(list.filter((raw) => isObject(raw) && isObject(raw.result)).slice(-HISTORY_SHOWN).map(historyEntry));
      },
    },
    actions: {
      draftText(text) {
        if (typeof text !== "string" || !text.trim()) throw new Error("There is no text to put in the playground.");
        call(source, "draftText", text);
        return text;
      },
      inspect() {
        if (!result()) throw new Error("Run the playground first: there is no request to inspect yet.");
        return call(source, "inspect");
      },
      focusText: () => call(source, "focusText"),
      openSettings: () => call(source, "openSettings"),
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1)),
  };
  return ctx;
}

// ---------- index.apps ----------

function appItem(raw, index, taken) {
  const href = tidy(raw.href);
  const base = href.replace(/^\/+|\/+$/g, "") || `app-${index + 1}`;
  let id = base;
  for (let copy = 2; taken.has(id); copy++) id = `${base}-${copy}`;
  taken.add(id);
  const label = tidy(raw.label);
  const numbered = label.match(/\bapp\s+(\d+)\b/i);
  const title = tidy(raw.title);
  const split = title.match(/^([^\p{L}\p{N}]+)(.*)$/u);
  return { id, href, position: index + 1, label, number: numbered ? Number(numbered[1]) : null,
    tag: label.includes("·") ? label.slice(label.indexOf("·") + 1).trim() : "",
    title, emoji: split ? split[1].trim() : "", name: split ? split[2].trim() : title, summary: tidy(raw.summary),
    points: Array.isArray(raw.points) ? raw.points.map(tidy).filter(Boolean) : [], featured: raw.featured === true, cta: tidy(raw.cta) };
}

const copyCards = (list) => (Array.isArray(list) ? list.filter(isObject).map((card) => ({ title: tidy(card.title), text: tidy(card.text) })) : []);

// source: {
//   cards: () => the raw cards in page order, [{ href, label, title, summary, points, featured, cta }] — return the
//          same array while the cards are the same, so the item objects stay the same,
//   page: () => { heading, lede, features: [{ title, text }], principles: [{ title, text }] },
//   matches: (item, ctx) => boolean   (LAB.matches),     arrange: (items, ctx) => items   (LAB.arrange),
//   open(item), focus(item), refresh()   the page's own operations
// }
export function indexAppsCtx(source = {}) {
  let built = { cards: null, items: EMPTY };
  const items = () => {
    const cards = read(source, "cards", EMPTY);
    if (cards !== built.cards) {
      const taken = new Set();
      built = { cards, items: deepFreeze((Array.isArray(cards) ? cards : []).filter(isObject).map((raw, index) => appItem(raw, index, taken))) };
    }
    return built.items;
  };
  const page = () => {
    const value = read(source, "page", null);
    return isObject(value) ? value : {};
  };
  const find = (id) => {
    const item = items().find((entry) => entry.id === id);
    if (!item) throw new Error(`There is no app card "${asText(id)}" on this page.`);
    return item;
  };
  const ctx = {
    items,
    shown: () => {
      const list = items().filter((item) => !source.matches || source.matches(item, ctx));
      return source.arrange ? source.arrange(list, ctx) : list;
    },
    data: {
      get heading() { return tidy(page().heading); },
      get lede() { return tidy(page().lede); },
      get features() { return deepFreeze(copyCards(page().features)); },
      get principles() { return deepFreeze(copyCards(page().principles)); },
    },
    actions: {
      open: (id) => call(source, "open", find(id)),
      focus(id) {
        const item = find(id);
        if (!ctx.shown().includes(item)) throw new Error(`${item.name || item.id} is hidden by the current filters. Clear them to go to its card.`);
        return call(source, "focus", item);
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1)),
  };
  return ctx;
}
