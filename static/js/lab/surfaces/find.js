// Lab surfaces of the Find page (static/find.html, static/js/find.js): the results of the user's own latest search,
// and the document's lines. Pure code: it imports only the kit, touches no DOM, storage or network, and is tested in
// Node (tests/js/lab/surface-demo-find.test.mjs). Fixtures for pack tests: tests/js/lab/fixtures/find.mjs
// (sampleFindResultsCtx, sampleFindDocumentCtx; starter packs: static/js/lab/packs/find/). This header is the
// CONTRACT for packs on these two surfaces.
//
// How Find works (jev/find.py): the document is split into nonblank trimmed lines, the first 255 get IDs L000, L001,
// …, and ONE request asks two questions per query: "q<i>.where", a Choice over the line IDs (where the answer is), and
// "q<i>.exists", a Noul (whether any line answers it). Plain code then turns exists into a verdict: >= 0.7 "answered",
// < 0.35 "absent", in between "partial", and keeps the five likeliest lines as hits.
//
// Both ctx objects are { items(), shown(), data, actions, refresh(), itemName(item, index) }, built ONCE per page load
// and read at call time, so they never go stale. items() and shown() return the SAME frozen item objects (compare by
// identity) until the list itself changes. Every data field is a live getter that returns frozen values: read it when
// you need it, never keep it across renders. No action on either surface calls the model, and no pack may cause a
// model call: only the page's own Search button (or Enter in a question box) searches, exactly as before Lab.
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "find.results"  —  builder findResultsCtx(source)  —  the result cards of the latest search
// ---------------------------------------------------------------------------------------------------------------
// The list is the answer of the CURRENT USER'S OWN latest search in this page load: one item per question, in the
// order the questions were sent. items() is [] before the first search answers, and again whenever the page drops the
// results: after Edit -> Done on the document, after "Load sample", and after a Lab edit or import on find.document.
// The page has no filter of its own, so shown() is items() after Lab's filters and in Lab's sort order; the page shows
// exactly those cards in that order, with a "x of y questions shown" note and a reset while a Lab setting is active.
// The list is READ-ONLY (no replaceItems, no importItems): the results are model output, never rewritten by a pack.
// Kinds this surface hosts: fact, diagnostic, metric, exporter, command, tool, panel (and behavior).
//
// Item (one question's result):
//   position     integer >= 1   the question's place in the request; "q<position - 1>" are its question ids. Unique.
//   key          string         "q0", "q1", …: the prefix of its two question ids ("q0.where", "q0.exists")
//   query        string         the question as it was sent (trimmed by the server)
//   exists       number | null  the Noul P(the document answers it), 0..1; null when the server sent no number
//   verdict      "answered" | "partial" | "absent" | null   the server's verdict from exists (null if missing/unknown)
//   confidence   number | null  the where-Choice's own confidence field (0..1)
//   hits         [{ rank, id, index, text, prob, heading, section, listed }]   the five likeliest lines, best first:
//                  rank     integer >= 1, 1 is the top line
//                  id       "L012" (the line's ID in the request; "" when the server sent none)
//                  index    integer line index (0-based; id is "L" + index padded to three digits) or null
//                  text     the line as it was searched (trimmed)
//                  prob     number | null   the where-probability of that line (the server reads a missing one as 0)
//                  heading  boolean  the line matches /^Section [A-Z]:/ (the page draws such lines bold)
//                  section  string | null  the heading line at or above it in the SEARCHED document (from the
//                           request's tagged document); null above the first heading. A heading's section is itself.
//                  listed   boolean  the page lists this hit on the card: rank 1, or prob >= 0.01 (rules.list_min)
//                [] when the server sent none. The page draws rank 1 strongly and highlights the focused question's
//                rank-1 line and every hit with prob >= 0.05 (rules.highlight_min) in the document.
//   top          the rank-1 hit (a copy of hits[0]) or null
//   top_prob     hits[0].prob, or null
//   line_probs   (number | null)[] | null   the where-probability of EVERY searched line, by line index (length =
//                data.lines), read from the response in the trace; an entry is null when the response holds no number
//                for that line. null when the trace holds no probabilities for this question.
// itemName(item) is "Q<position>". refresh() re-renders the result cards only (not the Lab section).
//
// data (live getters):
//   lines        integer | null  how many lines were searched (at most 255); null with no result
//   truncated    boolean         the document had more than 255 lines and only the first 255 were searched
//   thresholds   { found, absent } | null   the cut-offs the server applied (0.7 and 0.35); null with no result
//   rules        { found: 0.7, absent: 0.35, max_queries: 8, max_lines: 255, max_doc_chars: 60000, top: 5,
//                  list_min: 0.01, highlight_min: 0.05 }   constants mirrored from jev/find.py and static/js/find.js
//   meta         { model, latency_ms, question_count, input_tokens, output_tokens, cost_usd, backend } | null
//                measured values of the ONE request of the shown search; question_count is 2 per query. Any field may
//                be missing. cost_usd is measured spend of that call, never an estimate.
//   request      { state: { document }, model, questions } | null   the exact request: state.document is the tagged
//                document "L000| first line\nL001| …"; questions holds "q<i>.where" and "q<i>.exists"
//   trace        { request, response, meta } | null   what Inspect JSON shows (a frozen copy)
//   searched     string[]        the queries of the shown result, in order; [] with no result
//   queries      string[]        what the question boxes hold right now, untrimmed, blanks included
//   stale        boolean         a result is shown and the boxes no longer hold its queries (the user edited or added
//                                one; the page searches only when the user presses Search). false with no result
//   focus        integer | null  position of the focused question (the one whose lines the document highlights);
//                                null with no result
//   pending      boolean         a search is on its way
//   editing      boolean         the document is open in its text box (Edit); Done drops the results
//   searches     integer         searches answered since the page loaded (0 at first)
//
// actions (each throws an Error with a message for the user when its guard refuses; packs call them only from a
// command or a control the user just pressed, one call per press, never from a fact, metric, check or render):
//   focusResult(position)   what clicking a card does: focuses that question, so the document highlights its
//                           lines. Guard: a result is shown, the position is in items(), and that card is shown now
//                           (not hidden by a Lab filter). Returns the item.
//   showHit(position, rank) what clicking a hit does: focuses the question and scrolls the document to that line.
//                           Guard: as focusResult, plus the hit exists and is listed on the card (listed: true), and
//                           the document is not in its text box. Returns the hit. If a Lab filter on find.document
//                           hides the line, the question is still focused and the call throws to say so.
//   inspect()               opens the page's Inspect JSON drawer on the shown search. Guard: a result is shown.
//   addQuery(text)          what "Add question" does, with text: a new question box holding the trimmed text, focused.
//                           It does NOT search; data.stale turns true and the user presses Search. Guard: the text is a
//                           nonblank string, fewer than 8 boxes exist, no box already holds it (ignoring case and edge
//                           spaces), and no search is pending. Returns the text it placed.
// There is no action that searches, edits answers or replays a result, and none may be added by a pack.
//
// Content boundaries for find.results:
//   - Every probability, verdict, hit and measurement is from a search the current user ran in this page load. Show
//     them as they are; never store them, never carry them into a later search, never fill a gap with a guess (a
//     null stays "not available").
//   - Exports that hold answers (verdicts, probabilities, hit lines) say so in their label or help. An export described
//     as a request or handoff carries the document and the queries only, never answers or meta.
//   - A rule a pack applies (a margin, "low confidence", "disagrees") is plain local code: advisory, labeled as such,
//     never worded as the model's answer. The verdict thresholds are the server's; a pack may show what other
//     thresholds would give, labeled as local and hypothetical.
//   - meta is the measured cost and latency of one call. A projection (per question, per thousand searches) is
//     arithmetic on it and says so; it is never shown as spend.
//   - CSV goes through the kit's csvText/csvCell (spreadsheet formula escaping).
//
// ---------------------------------------------------------------------------------------------------------------
// SURFACE "find.document"  —  builder findDocumentCtx(source)  —  the document panel
// ---------------------------------------------------------------------------------------------------------------
// The list is the document's lines as the page shows them: the text split on "\n", each line trimmed, blank lines
// dropped (the page's own lines(); the server also splits on "\r" and other line breaks). items() is EVERY line of the
// current text; the page itself shows only the first 255 (the ones searched), so shown() is the lines with
// searched: true, after Lab's filters, in Lab's sort order. The page draws exactly those lines in that order, with a
// "x of y lines shown" note and a reset while a Lab setting is active. While the document is open in its text box
// (data.editing) the page shows the text box instead, and items() is the text as it was before Edit.
// Kinds this surface hosts: fact, diagnostic, transform, metric, exporter, importer, command, tool, panel (behavior).
// This text is the user's own document (or the sample handbook). It is local text, not model output.
//
// Item (one line), with its fields in EXACTLY this order:
//   { index,     integer: 0-based position among the nonblank lines; the server's line ID uses it
//     id,        "L" + index padded to three digits: "L000", "L012", "L1000"
//     text,      the trimmed line, never blank and never holding a line break
//     heading,   boolean: text matches /^Section [A-Z]:/ (the page draws it bold)
//     section,   string | null: the text of the nearest heading at or above the line; null above the first heading
//     searched } boolean: index < 255 (only these lines are sent; the page shows only these)
// itemName(item) is its id. refresh() re-renders the document lines only (not the Lab section); while the text box is
// open it does nothing, so typed text is never lost.
//
// data (live getters):
//   text         string          the document text exactly as the page holds it (blank lines and indentation kept)
//   chars        integer         its length in code points (the server refuses more than rules.max_doc_chars)
//   lines        integer         nonblank lines (items().length)
//   searchable   integer         lines a search would send: min(lines, 255)
//   sample       boolean         the text is exactly the sample handbook the page loaded
//   editing      boolean         the document is open in its text box
//   pending      boolean         a search is on its way
//   results      [find.results items]   the shown search's results (same objects as find.results' items()); []
//                                with none. The page drops them whenever the text changes, so while non-empty they
//                                were made for this text and data.results[i].line_probs[item.index] belongs to item.
//   focused      find.results item | null   the focused question's result (the one the page highlights)
//   rules        the same constants as find.results
//
// actions:
//   replaceItems(nextItems, { label })   the Lab Edits block's Apply and Undo. Writes the lines back as the document
//                text (joined with "\n", so blank lines and indentation of the old text are not kept), exactly like
//                editing the text by hand and pressing Done: the shown results are dropped, and the page asks the
//                user to search again. Nothing is searched. Guards (each throws, nothing changes):
//                  - not while the document is open in its text box (finish with Done first), not while searching
//                  - nextItems is a nonempty array of objects
//                  - every item is CANONICAL: { index, id, text, heading, section, searched } in that key order,
//                    with index = its position, id/heading/section/searched derived as above, text trimmed, nonblank,
//                    with no line break. Undo compares the list exactly, so a transform that changes a line's text,
//                    removes, inserts or reorders lines must rebuild every item, for example with:
//                      const relabel = (texts) => { let section = null; return texts.map((text, index) => {
//                        const heading = /^Section [A-Z]:/.test(text); if (heading) section = text;
//                        return { index, id: `L${String(index).padStart(3, "0")}`, text, heading, section, searched: index < 255 }; }); };
//                  - the joined text holds at most 60,000 code points (the server's limit)
//                A list equal to the current one changes nothing (and keeps the results).
//   importItems(items, { label })   the Lab "Paste to import" block's Add: appends lines at the END of the document,
//                with the same effect and guards as replaceItems, except that items need only a text field
//                ({ text } or a full item; other fields are ignored and recomputed).
//   showLine(index)   scrolls the document to that line. Guard: not in the text box, and the line is shown now (searched
//                and not hidden by a Lab filter). Returns the item.
// There is no action that searches, loads the sample (it would discard the user's text without asking) or opens
// the text box.
//
// Content boundaries for find.document:
//   - Items and data.text are the user's own document. Exports of it may contain it and say so; nothing here may be
//     sent anywhere. The sample handbook is page content: a pack never edits samples on disk or bundles its own.
//   - data.results/data.focused carry the same answer boundaries as find.results: a fact or metric that reads them
//     (a line's probability for the focused question) shows the user's own answers of this page load, labeled as
//     such, and is null with no search. Never predict which line would answer.
//   - An export described as the document or "as Find sends it" holds text only, never probabilities or verdicts.
//   - Edits and imports change only the editor text through replaceItems/importItems, never the questions, and never
//     search by themselves.
import { clone } from "../kit.js";

// Mirrors jev/find.py (FOUND, ABSENT, MAX_QUERIES, MAX_LINES, MAX_DOC_CHARS, search(top=5)) and static/js/find.js
// (hits listed from 1%, highlighted from 5%); tests/js/lab/surface-demo-find.test.mjs keeps them in step.
export const FIND_RULES = Object.freeze({ found: 0.7, absent: 0.35, max_queries: 8, max_lines: 255, max_doc_chars: 60000, top: 5,
  list_min: 0.01, highlight_min: 0.05 });
const HEADING = /^Section [A-Z]:/;
const VERDICTS = ["answered", "partial", "absent"];
const EMPTY = Object.freeze([]);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asText = (value) => (typeof value === "string" ? value : "");
const lineId = (index) => `L${String(index).padStart(3, "0")}`;
const codePoints = (text) => { let count = 0; for (const _char of text) count += 1; return count; };

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

// The page's lines(): split on "\n", trim, drop blanks.
export function findDocumentLines(text) {
  return asText(text).split("\n").map((line) => line.trim()).filter(Boolean);
}

// Canonical document items for a list of trimmed lines: the shape replaceItems requires.
export function findLineItems(texts) {
  let section = null;
  return texts.map((text, index) => {
    const heading = HEADING.test(text);
    if (heading) section = text;
    return { index, id: lineId(index), text, heading, section, searched: index < FIND_RULES.max_lines };
  });
}

// ---------- find.results ----------

// The searched lines, read from the request's tagged document ("L000| text"), or null when the trace holds none.
function searchedLines(request) {
  const document = isObject(request) && isObject(request.state) ? request.state.document : null;
  if (typeof document !== "string") return null;
  const out = [];
  for (const line of document.split("\n")) {
    const match = line.match(/^L(\d+)\| ?(.*)$/);
    if (match) out[Number(match[1])] = match[2];
  }
  return out;
}

function sectionsOf(lines) {
  if (!lines) return null;
  let section = null;
  return Array.from(lines, (text) => {
    if (typeof text === "string" && HEADING.test(text)) section = text;
    return section;
  });
}

function hitOf(raw, rank, sections) {
  const text = asText(raw.text);
  const index = Number.isInteger(raw.index) && raw.index >= 0 ? raw.index : null;
  const prob = finite(raw.prob);
  const heading = HEADING.test(text);
  const section = sections && index !== null && index < sections.length ? sections[index] ?? null : heading ? text : null;
  return { rank: rank + 1, id: asText(raw.id), index, text, prob, heading, section, listed: rank === 0 || (prob !== null && prob >= FIND_RULES.list_min) };
}

// What one raw search result (the page's own Search call) gives the surfaces. Kept per result object, so the items stay the same objects until
// a new search answers.
const VIEWS = new WeakMap();
function viewOf(result) {
  if (VIEWS.has(result)) return VIEWS.get(result);
  const trace = isObject(result.trace) ? result.trace : null;
  const request = trace && isObject(trace.request) ? trace.request : null;
  const answers = trace && isObject(trace.response) && isObject(trace.response.answers) ? trace.response.answers : {};
  const sections = sectionsOf(searchedLines(request));
  const lines = Number.isInteger(result.lines) && result.lines >= 0 ? result.lines : null;
  const rows = (Array.isArray(result.results) ? result.results : []).map((raw, qi) => {
    const res = isObject(raw) ? raw : {};
    const hits = (Array.isArray(res.hits) ? res.hits : []).filter(isObject).map((hit, rank) => hitOf(hit, rank, sections));
    const where = answers[`q${qi}.where`];
    const probs = isObject(where) && isObject(where.probabilities) ? where.probabilities : null;
    return {
      position: qi + 1, key: `q${qi}`, query: asText(res.query), exists: finite(res.exists),
      verdict: VERDICTS.includes(res.verdict) ? res.verdict : null, confidence: finite(res.confidence),
      hits, top: hits[0] ? { ...hits[0] } : null, top_prob: hits[0] ? hits[0].prob : null,
      line_probs: probs && lines !== null ? Array.from({ length: lines }, (_, index) => finite(probs[lineId(index)])) : null,
    };
  });
  const thresholds = isObject(result.thresholds) ? { found: finite(result.thresholds.found), absent: finite(result.thresholds.absent) } : null;
  const view = deepFreeze({
    rows,
    lines,
    truncated: result.truncated === true,
    thresholds,
    meta: isObject(result.meta) ? clone(result.meta) : null,
    request: request ? clone(request) : null,
    trace: trace ? clone(trace) : null,
    searched: rows.map((row) => row.query),
  });
  VIEWS.set(result, view);
  return view;
}

function resultView(source) {
  const raw = read(source, "result", null);
  return isObject(raw) ? viewOf(raw) : null;
}

function focusOf(source, view) {
  if (!view || !view.rows.length) return null;
  const index = read(source, "focusIndex", 0);
  return Number.isInteger(index) && index >= 0 && index < view.rows.length ? index + 1 : null;
}

const flag = (source, name) => read(source, name, false) === true;

function shownOf(ctx, source, list) {
  const kept = list.filter((item) => !source.matches || source.matches(item, ctx) !== false);
  const arranged = source.arrange ? source.arrange(kept, ctx) : kept;
  return Array.isArray(arranged) ? arranged : kept;
}

// source: {
//   result: () => the raw response of the shown search ({ results, lines, truncated, meta, trace,
//           thresholds }) or null,
//   focusIndex: () => the page's focused question index (0-based),   queries: () => the question boxes' texts,
//   pending, editing: () => boolean,   searches: () => answered searches this page load,
//   matches: (item, ctx) => boolean (LAB.matches),   arrange: (items, ctx) => items (LAB.arrange),
//   focusResult(index0)       focus that question and re-render the cards and the document,
//   showLine(lineIndex)       scroll the document to a line; returns false when the line is not on screen,
//   inspect(), addQuery(text), refresh()   the page's own operations; addQuery must not search
// }
// Every field may also be a plain value. A missing callback makes its action throw.
export function findResultsCtx(source = {}) {
  const view = () => resultView(source);
  const queries = () => {
    const list = read(source, "queries", EMPTY);
    return Array.isArray(list) ? list.map((query) => (typeof query === "string" ? query : "")) : [];
  };
  const shownItem = (position) => {
    const current = view();
    if (!current) throw new Error("Search first: there are no results yet.");
    const item = current.rows.find((row) => row.position === position);
    if (!item) throw new Error(`There is no question ${String(position)} in these results.`);
    if (!ctx.shown().includes(item)) throw new Error(`Question ${position} is hidden by the current Lab filters. Clear them to go to it.`);
    return item;
  };
  const ctx = {
    items: () => view()?.rows || EMPTY,
    shown: () => shownOf(ctx, source, ctx.items()),
    data: {
      get lines() { return view()?.lines ?? null; },
      get truncated() { return view()?.truncated === true; },
      get thresholds() { return view()?.thresholds ?? null; },
      get rules() { return FIND_RULES; },
      get meta() { return view()?.meta ?? null; },
      get request() { return view()?.request ?? null; },
      get trace() { return view()?.trace ?? null; },
      get searched() { return view()?.searched ?? EMPTY; },
      get queries() { return Object.freeze(queries()); },
      get stale() {
        const current = view();
        if (!current) return false;
        const typed = queries().map((query) => query.trim()).filter(Boolean).slice(0, FIND_RULES.max_queries);
        return JSON.stringify(typed) !== JSON.stringify(current.searched);
      },
      get focus() { return focusOf(source, view()); },
      get pending() { return flag(source, "pending"); },
      get editing() { return flag(source, "editing"); },
      get searches() {
        const count = read(source, "searches", 0);
        return Number.isInteger(count) && count >= 0 ? count : 0;
      },
    },
    actions: {
      focusResult(position) {
        const item = shownItem(position);
        call(source, "focusResult", item.position - 1);
        return item;
      },
      showHit(position, rank) {
        const item = shownItem(position);
        const hit = item.hits.find((entry) => entry.rank === rank);
        if (!hit) throw new Error(`Question ${position} has no hit ${String(rank)}.`);
        if (!hit.listed || hit.index === null) throw new Error(`The card does not list hit ${rank} of question ${position} (under ${FIND_RULES.list_min * 100}%).`);
        if (flag(source, "editing")) throw new Error("The document is open for editing. Press Done first.");
        call(source, "focusResult", item.position - 1);
        if (call(source, "showLine", hit.index) === false) throw new Error(`${hit.id} is not shown in the document now (a Lab filter may hide it).`);
        return hit;
      },
      inspect() {
        if (!view()) throw new Error("Search first: there is no request to inspect yet.");
        return call(source, "inspect");
      },
      addQuery(text) {
        if (typeof text !== "string" || !text.trim()) throw new Error("There is no question to add.");
        const clean = text.trim();
        const boxes = queries();
        if (boxes.length >= FIND_RULES.max_queries) throw new Error(`One search takes at most ${FIND_RULES.max_queries} questions. Remove one first.`);
        if (boxes.some((query) => query.trim().toLowerCase() === clean.toLowerCase())) throw new Error("That question is already in a box.");
        if (flag(source, "pending")) throw new Error("Wait for the search to finish.");
        call(source, "addQuery", clean);
        return clean;
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && Number.isInteger(item.position) ? `Q${item.position}` : String(index + 1)),
  };
  return ctx;
}

// ---------- find.document ----------

// The text a list of items would write, or an Error a person can act on. canonical: every item must be exactly what
// the builder would make for its position (replaceItems); otherwise only text is read (importItems).
function textsFrom(items, canonical) {
  if (!Array.isArray(items)) throw new Error("An edit must give a list of lines.");
  const texts = items.map((item, index) => {
    const at = `Line ${index + 1}`;
    if (!isObject(item) || typeof item.text !== "string") throw new Error(`${at} has no text.`);
    if (/[\r\n]/.test(item.text)) throw new Error(`${at} holds a line break. Split it into separate lines.`);
    if (!item.text.trim()) throw new Error(`${at} is blank. The document has no blank lines; remove it instead.`);
    if (canonical && item.text !== item.text.trim()) throw new Error(`${at} has spaces at an end. Trim it.`);
    return item.text.trim();
  });
  if (canonical) {
    const expected = findLineItems(texts);
    items.forEach((item, index) => {
      if (JSON.stringify(item) !== JSON.stringify(expected[index])) {
        throw new Error(`Line ${index + 1} is out of step with its position: an edit must rebuild index, id, text, heading, section and searched, in that order.`);
      }
    });
  }
  return texts;
}

function checkWritable(source) {
  if (flag(source, "editing")) throw new Error("The document is open for editing. Press Done first.");
  if (flag(source, "pending")) throw new Error("Wait for the search to finish.");
}

function writeTexts(source, texts, label) {
  if (!texts.length) throw new Error("The document needs at least one line.");
  const text = texts.join("\n");
  if (codePoints(text) > FIND_RULES.max_doc_chars) throw new Error(`The document would be ${codePoints(text).toLocaleString("en-US")} characters; Find takes at most ${FIND_RULES.max_doc_chars.toLocaleString("en-US")}.`);
  call(source, "setText", text, typeof label === "string" && label ? label : "Lab edit");
  return texts.length;
}

// source: {
//   text: () => the document text the page holds,   sample: () => the sample handbook text (or null before it loads),
//   editing, pending: () => boolean,
//   result: () => the raw response of the shown search or null,   focusIndex: () => the focused question,
//   matches: (item, ctx) => boolean (LAB.matches),   arrange: (items, ctx) => items (LAB.arrange),
//   setText(text, label)   replace the document text exactly as Edit -> Done does (drops the results, no search),
//   showLine(index)        scroll to a line; false when it is not on screen,
//   refresh()              re-render the document lines
// }
export function findDocumentCtx(source = {}) {
  let built = { text: null, items: EMPTY };
  const text = () => asText(read(source, "text", ""));
  const items = () => {
    const current = text();
    if (current !== built.text) built = { text: current, items: deepFreeze(findLineItems(findDocumentLines(current))) };
    return built.items;
  };
  const ctx = {
    items,
    shown: () => shownOf(ctx, source, items().filter((item) => item.searched)),
    data: {
      get text() { return text(); },
      get chars() { return codePoints(text()); },
      get lines() { return items().length; },
      get searchable() { return Math.min(items().length, FIND_RULES.max_lines); },
      get sample() {
        const sample = read(source, "sample", null);
        return typeof sample === "string" && sample !== "" && sample === text();
      },
      get editing() { return flag(source, "editing"); },
      get pending() { return flag(source, "pending"); },
      get results() { return resultView(source)?.rows ?? EMPTY; },
      get focused() {
        const current = resultView(source);
        const focus = focusOf(source, current);
        return focus === null ? null : current.rows[focus - 1];
      },
      get rules() { return FIND_RULES; },
    },
    actions: {
      replaceItems(nextItems, { label } = {}) {
        checkWritable(source);
        const texts = textsFrom(nextItems, true);
        if (JSON.stringify(texts) === JSON.stringify(items().map((item) => item.text))) return texts.length;
        return writeTexts(source, texts, label);
      },
      importItems(added, { label } = {}) {
        checkWritable(source);
        const texts = textsFrom(added, false);
        if (!texts.length) throw new Error("There are no lines to add.");
        return writeTexts(source, [...items().map((item) => item.text), ...texts], label || "Import");
      },
      showLine(index) {
        if (flag(source, "editing")) throw new Error("The document is open for editing. Press Done first.");
        const item = items().find((entry) => entry.index === index);
        if (!item) throw new Error(`There is no line ${String(index)} in the document.`);
        if (!ctx.shown().includes(item)) throw new Error(`${item.id} is not shown now${item.searched ? " (a Lab filter hides it)" : " (only the first 255 lines are shown)"}.`);
        if (call(source, "showLine", index) === false) throw new Error(`${item.id} is not on screen.`);
        return item;
      },
    },
    refresh: () => { if (typeof source.refresh === "function") source.refresh(); },
    itemName: (item, index) => (item && typeof item.id === "string" && item.id ? item.id : String(index + 1)),
  };
  return ctx;
}
