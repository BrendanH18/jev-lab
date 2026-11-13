// Fixtures for packs on the Find page's surfaces "find.results" and "find.document" (contract:
// static/js/lab/surfaces/find.js). Not a test file itself.
//
//   import { sampleFindResultsCtx, sampleFindDocumentCtx, RESULTS, DOCS, QUERIES } from "./fixtures/find.mjs";
//   const ctx = sampleFindResultsCtx();                          // the four-question search of the short handbook
//   const odd = sampleFindResultsCtx({ result: RESULTS.odd });  // shapes the builder must survive
//   const none = sampleFindResultsCtx({ result: null });        // the page before the first search answered
//   const doc = sampleFindDocumentCtx();                         // the short handbook's 13 lines, with that search
//   const long = sampleFindDocumentCtx({ text: DOCS.long, result: null });  // 260 lines: 255 searched
//   const byPos = resultsByPosition(ctx);                       // { 1: item, 2: item, ... } for fact cases
//   const lines = linesByIndex(doc);                            // { 0: item, 1: item, ... }
//
// Every ctx is made by the real builder from hand-written raw /api/find responses (built the way jev/find.py search()
// builds them: the tagged document, the exact question wording, the five likeliest lines with a stable tie order),
// so items and data have the page's shapes and every guard of the contract runs. The answers are made up for tests;
// the page itself only ever shows answers the user requested.
//
// overrides for sampleFindResultsCtx: any source field (result, focusIndex, queries, pending, editing, searches) as a
//   value or a function, plus
//   hide:      positions that shown() leaves out, as an active Lab filter would
//   order:     positions in the order shown() returns them, as an active Lab sort would (others keep their place after)
//   matches, arrange:  your own Lab hooks instead of hide/order
//   offScreen: line indexes the page's showLine() reports as not on screen (a Lab filter on the document hides them)
//   missing:   page callback names to leave out (focusResult, showLine, inspect, addQuery, refresh)
// overrides for sampleFindDocumentCtx: text, sample, editing, pending, result, focusIndex, plus hide (line indexes),
//   order (line indexes), matches, arrange, offScreen, missing (setText, showLine, refresh).
//   setText really replaces the fixture's text, so items() and data follow an applied edit; ctx.state.text holds it.
// Each ctx carries env (fakeEnv(): toasts, copied, downloads) and log: every page callback it reached, as
// [name, ...args], so a command test can assert what it asked the page to do. No callback can search.
import { findDocumentCtx, findResultsCtx } from "../../../../static/js/lab/surfaces/find.js";
import { fakeEnv } from "../harness.mjs";

const lineId = (index) => `L${String(index).padStart(3, "0")}`;

// The short handbook: 13 nonblank lines once trimmed. The raw text keeps a blank line and an indented line on purpose.
//   L000 title (above every section)        L007 Section C: Leaving Harbor Coffee
//   L001 Section A: Hours and scheduling    L008 two weeks notice when you resign
//   L002 open 6:30 am to 6:00 pm            L009 Section D: Pets
//   L003 schedules posted Thursday          L010 service animals / patio
//   L004 Section B: Pay and time off        L011 Section E: Contact
//   L005 payday every other Friday          L012 people@harborcoffee.example, 555-0142
//   L006 time off needs two weeks notice
export const DOC_LINES = Object.freeze([
  "Harbor Coffee Co. Team Handbook, revised September 2026.",
  "Section A: Hours and scheduling",
  "The cafe is open 6:30 am to 6:00 pm Monday through Saturday.",
  "Schedules are posted every Thursday for the following week.",
  "Section B: Pay and time off",
  "Payday is every other Friday by direct deposit.",
  "Paid time off requests need two weeks notice.",
  "Section C: Leaving Harbor Coffee",
  "Please give at least two weeks notice when you resign.",
  "Section D: Pets",
  "Only service animals are allowed behind the counter; pets may wait on the patio.",
  "Section E: Contact",
  "Questions about this handbook go to people@harborcoffee.example or call 555-0142.",
]);
const SHORT_TEXT = [DOC_LINES[0], DOC_LINES[1], DOC_LINES[2], `  ${DOC_LINES[3]}`, "", ...DOC_LINES.slice(4)].join("\n");

// 260 lines: a heading every 50 lines ("Section A: Roast log week 1" at 0, 50, 100, …), entries in between.
const LONG_LINES = Array.from({ length: 260 }, (_, index) => (index % 50 === 0
  ? `Section ${String.fromCharCode(65 + index / 50)}: Roast log week ${index / 50 + 1}`
  : `Batch ${index}: Harbor House Blend, ${12 + (index % 7)} minutes, roasted by the ${index % 2 ? "morning" : "evening"} crew.`));

export const DOCS = Object.freeze({
  short: SHORT_TEXT,
  long: LONG_LINES.join("\n"),
  // No section headings at all, and a line with curly quotes and doubled spaces.
  plain: "Grinders are cleaned every night.\nWe say “good morning” to every regular.\nRefunds  go  through the register.",
  empty: "",
});

// The four questions of the default search, and what each answered (where-probabilities by line index; a line that
// is not in the map is missing from the response).
//   1 dog       exists 0.82 answered  L010 .71  L009 .20  L011 .04  L002 .03  L005 .02  (L000 missing)
//   2 notice    exists 0.93 answered  L008 .64  L006 .30  L007 .03  L003 .02  L000 .005 (unlisted; ties L012 .005)
//   3 parental  exists 0.12 absent    L006 .41  L005 .22  L004 .20  L000 .10  L012 .07
//   4 wifi      exists 0.48 partial   L012 .38  L001 .30  L000 .16  L011 .10  L003 .06
export const QUERIES = Object.freeze([
  "can I bring my dog to work?",
  "how much notice do I have to give before I quit?",
  "is there paid parental leave?",
  "what is the wifi password?",
]);
const zeros = (except) => Object.fromEntries(DOC_LINES.map((_, index) => [index, 0]).filter(([index]) => !except.includes(Number(index))));
const ANSWERS = [
  { exists: 0.82, confidence: 0.71, probs: { ...zeros([0]), 10: 0.71, 9: 0.2, 11: 0.04, 2: 0.03, 5: 0.02 } },
  { exists: 0.93, confidence: 0.64, probs: { ...zeros([]), 8: 0.64, 6: 0.3, 7: 0.03, 3: 0.02, 0: 0.005, 12: 0.005 } },
  { exists: 0.12, confidence: 0.41, probs: { ...zeros([]), 6: 0.41, 5: 0.22, 4: 0.2, 0: 0.1, 12: 0.07 } },
  { exists: 0.48, confidence: 0.38, probs: { ...zeros([]), 12: 0.38, 1: 0.3, 0: 0.16, 11: 0.1, 3: 0.06 } },
];

const verdict = (exists) => (exists >= 0.7 ? "answered" : exists < 0.35 ? "absent" : "partial");

// A raw /api/find response for these lines, queries and answers, built like jev/find.py search().
export function rawSearch(lines, queries, answers, { meta = {}, truncated = false } = {}) {
  const document = lines.map((line, index) => `${lineId(index)}| ${line}`).join("\n");
  const ids = Object.fromEntries(lines.map((_, index) => [lineId(index), null]));
  const questions = {};
  const responseAnswers = {};
  queries.forEach((query, qi) => {
    questions[`q${qi}.where`] = { type: "choice", instructions: `Which line of \`document\` contains the answer to: “${query}”?`, criteria: ids };
    questions[`q${qi}.exists`] = { type: "noul", instructions: `Does any line of \`document\` address or answer: “${query}”?`,
      criteria: { true: "At least one line states or directly implies the answer", false: "No line addresses this question" } };
    const probs = Object.fromEntries(Object.entries(answers[qi].probs).map(([index, p]) => [lineId(Number(index)), p]));
    const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
    responseAnswers[`q${qi}.where`] = { type: "choice", choice: top[0], confidence: answers[qi].confidence, probabilities: probs };
    responseAnswers[`q${qi}.exists`] = { type: "noul", noul: answers[qi].exists };
  });
  const results = queries.map((query, qi) => {
    const probs = answers[qi].probs;
    const ranked = lines.map((_, index) => index).sort((a, b) => (probs[b] ?? 0) - (probs[a] ?? 0) || a - b).slice(0, 5);
    return { query, exists: answers[qi].exists, verdict: verdict(answers[qi].exists), confidence: answers[qi].confidence,
      hits: ranked.map((index) => ({ id: lineId(index), index, text: lines[index], prob: probs[index] ?? 0 })) };
  });
  const fullMeta = { model: "jev-1.14.0", latency_ms: 412.6, question_count: queries.length * 2, input_tokens: 1840, output_tokens: 0,
    cost_usd: 0.000092, backend: "sdk", ...meta };
  return { results, lines: lines.length, truncated, meta: fullMeta,
    trace: { request: { state: { document }, model: "jev-latest", questions }, response: { model: "jev-1.14.0", answers: responseAnswers }, meta: fullMeta },
    thresholds: { found: 0.7, absent: 0.35 } };
}

// Three questions whose answers pull against each other (every line not in a map is 0):
//   1 Sunday    exists 0.20 absent    L002 .55  L003 .30  L001 .10  L000 .05  L004 0    (absent, yet a strong top line)
//   2 entrance  exists 0.75 answered  L001 .15  L000 .14  L003 .14  L004 .12  L011 .10  (a heading on top, flat spread)
//   3 payday    exists 0.97 answered  L005 .97  L004 .02  L006 .01  L000 0    L001 0    (every listed line in Section B)
export const MIXED_QUERIES = Object.freeze(["who roasts on Sunday?", "where is the staff entrance?", "when is payday?"]);
const MIXED_ANSWERS = [
  { exists: 0.2, confidence: 0.55, probs: { ...zeros([]), 2: 0.55, 3: 0.3, 1: 0.1, 0: 0.05 } },
  { exists: 0.75, confidence: 0.15, probs: { ...zeros([]), 1: 0.15, 0: 0.14, 3: 0.14, 4: 0.12, 11: 0.1, 2: 0.09, 5: 0.09, 6: 0.09, 7: 0.08 } },
  { exists: 0.97, confidence: 0.97, probs: { ...zeros([]), 5: 0.97, 4: 0.02, 6: 0.01 } },
];

export const RESULTS = Object.freeze({
  // The default: four questions over the short handbook, focus on question 1.
  handbook: rawSearch(DOC_LINES, QUERIES, ANSWERS),
  // Three questions where the verdict and the top line disagree, or one section holds every listed line.
  mixed: rawSearch(DOC_LINES, MIXED_QUERIES, MIXED_ANSWERS, { meta: { latency_ms: 377.4, input_tokens: 1610, cost_usd: 0.00008, question_count: 6 } }),
  // One question only (the dog question), cheaper and quicker.
  single: rawSearch(DOC_LINES, QUERIES.slice(0, 1), ANSWERS.slice(0, 1), { meta: { latency_ms: 188, input_tokens: 820, cost_usd: 0.000041, question_count: 2 } }),
  // Shapes the builder must survive: a blank query, an exists that is text, an unknown verdict, a hit whose
  // probability is text and one without an index, a non-object hit, a result with no hits, no trace and no lines.
  odd: {
    results: [
      { query: "  ", exists: "0.5", verdict: "maybe", confidence: null,
        hits: [{ id: "L001", index: 1, text: "Section A: Hours and scheduling", prob: "high" }, null, { text: "a hit without an index", prob: 0.02 }] },
      { query: "do we ship to Canada?", exists: 0.2, verdict: "absent" },
      null,
    ],
    meta: { model: "jev-1.14.0" },
  },
});

const value = (entry) => (typeof entry === "function" ? entry : () => entry);
const hooks = ({ hide = [], order = [], matches, arrange }, keyOf) => {
  const hidden = new Set(hide);
  const rank = (item) => (order.includes(keyOf(item)) ? order.indexOf(keyOf(item)) : order.length);
  return {
    matches: matches || ((item) => !hidden.has(keyOf(item))),
    arrange: arrange || ((list) => (order.length ? list.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map((entry) => entry.item) : list)),
  };
};

// The find.results ctx. By default: the handbook search, question 1 focused, the boxes holding the four searched
// queries (not stale), no search pending, the document not in its text box, one search answered.
export function sampleFindResultsCtx(overrides = {}) {
  const log = [];
  const { hide, order, matches, arrange, offScreen = [], missing = [], ...rest } = overrides;
  const queries = "queries" in rest ? rest.queries : [...QUERIES];
  const callbacks = {
    focusResult: (index) => { log.push(["focusResult", index]); },
    showLine: (index) => { log.push(["showLine", index]); return !offScreen.includes(index); },
    inspect: () => { log.push(["inspect"]); },
    addQuery: (text) => { log.push(["addQuery", text]); if (Array.isArray(queries)) queries.push(text); },
    refresh: () => { log.push(["refresh"]); },
  };
  for (const name of missing) delete callbacks[name];
  const ctx = findResultsCtx({
    result: value("result" in rest ? rest.result : RESULTS.handbook),
    focusIndex: value(rest.focusIndex ?? 0),
    queries: value(queries),
    pending: value(rest.pending ?? false),
    editing: value(rest.editing ?? false),
    searches: value(rest.searches ?? 1),
    ...hooks({ hide, order, matches, arrange }, (item) => item.position),
    ...callbacks,
  });
  ctx.env = fakeEnv();
  ctx.log = log;
  return ctx;
}

// The find.document ctx. By default: the short handbook (also the loaded sample), the handbook search shown with
// question 1 focused, not editing, nothing pending.
export function sampleFindDocumentCtx(overrides = {}) {
  const log = [];
  const { hide, order, matches, arrange, offScreen = [], missing = [], ...rest } = overrides;
  const state = { text: "text" in rest ? rest.text : DOCS.short };
  const callbacks = {
    setText: (text, label) => { log.push(["setText", text, label]); state.text = text; },
    showLine: (index) => { log.push(["showLine", index]); return !offScreen.includes(index); },
    refresh: () => { log.push(["refresh"]); },
  };
  for (const name of missing) delete callbacks[name];
  const ctx = findDocumentCtx({
    text: () => state.text,
    sample: value("sample" in rest ? rest.sample : DOCS.short),
    editing: value(rest.editing ?? false),
    pending: value(rest.pending ?? false),
    result: value("result" in rest ? rest.result : RESULTS.handbook),
    focusIndex: value(rest.focusIndex ?? 0),
    ...hooks({ hide, order, matches, arrange }, (item) => item.index),
    ...callbacks,
  });
  ctx.env = fakeEnv();
  ctx.log = log;
  ctx.state = state;
  return ctx;
}

export const resultsByPosition = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.position, item]));
export const linesByIndex = (ctx) => Object.fromEntries(ctx.items().map((item) => [item.index, item]));
