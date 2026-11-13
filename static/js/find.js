import { $, api, callStats, h, handleError, icon, initChrome, inspect, mount, pct, statusBadge, toast } from "./common.js";
import { installLab, labEnv } from "./lab/env.js";
import { LAB } from "./lab/pages/find.js";
import { findDocumentCtx, findResultsCtx } from "./lab/surfaces/find.js";

// pending, searches and sample are read only by the Lab surfaces (contract: static/js/lab/surfaces/find.js).
const S = { text: "", queries: [], editing: false, result: null, focus: 0, pending: false, searches: 0, sample: null };
const MAX_Q = 8;

// Lab surfaces of this page: the result cards of the user's own latest search, and the document's lines. Lab's
// filters and sort reach both lists through matches/arrange; neither ctx can search.
const RESULTS = "find.results";
const DOC = "find.document";
const resultsCtx = findResultsCtx({
  result: () => S.result, focusIndex: () => S.focus, queries: () => S.queries, pending: () => S.pending, editing: () => S.editing,
  searches: () => S.searches,
  matches: (item, ctx) => LAB.matches(RESULTS, item, ctx), arrange: (list, ctx) => LAB.arrange(RESULTS, list, ctx),
  focusResult: (qi) => focusResult(qi), showLine: (index) => showLine(index),
  inspect: () => inspect(S.result.trace, "Find · one Jev request"),
  addQuery: (text) => { S.queries.push(text); renderQueries(true); },
  refresh: () => renderResultCards(),
});
const docCtx = findDocumentCtx({
  text: () => S.text, sample: () => S.sample, editing: () => S.editing, pending: () => S.pending,
  result: () => S.result, focusIndex: () => S.focus,
  matches: (item, ctx) => LAB.matches(DOC, item, ctx), arrange: (list, ctx) => LAB.arrange(DOC, list, ctx),
  setText: (text, label) => setDocument(text, label), showLine: (index) => showLine(index),
  // Not while the text box is open: re-rendering it would drop what the user typed since Edit.
  refresh: () => { if (!S.editing) renderDoc(); },
});

async function boot() {
  await initChrome("/find");
  installLab(LAB);
  mount("#q-add", icon("plus"), "Add question");
  mount("#search", icon("search"), "Search");
  const sample = await api("/api/find/sample");
  S.text = sample.text;
  S.sample = sample.text;
  S.queries = [...sample.queries];
  renderDoc();
  renderDocLab();
  renderQueries();
  renderResults();
  $("#doc-sample").addEventListener("click", () => { S.text = sample.text; S.editing = false; S.result = null; renderDoc(); renderResults(); renderDocLab(); });
  $("#doc-edit").addEventListener("click", toggleEdit);
  $("#q-add").addEventListener("click", () => { if (S.queries.length < MAX_Q) { S.queries.push(""); renderQueries(true); } });
  $("#search").addEventListener("click", search);
  window.addEventListener("jev:key", search);
  search();
}

function lines() { return S.text.split("\n").map((l) => l.trim()).filter(Boolean); }

function toggleEdit() {
  if (S.editing) { S.text = $("#doc textarea").value; S.result = null; renderResults(); }
  S.editing = !S.editing;
  renderDoc();
  renderDocLab();
}

// What a Lab edit or import on the document does: the same as editing the text by hand and pressing Done. The shown
// results were made for the old text, so they go, and nothing is searched until the user presses Search.
function setDocument(text, label) {
  if (text === S.text) return;
  S.text = text;
  S.result = null;
  renderDoc();
  renderResults();
  toast(`${label || "Edit"}: the document changed. Press Search for new results.`);
}

// Focus one question's result, as clicking its card does: the document highlights its lines.
function focusResult(qi) {
  S.focus = qi;
  renderResultCards();
  renderDoc();
  renderDocLab();
}

function showLine(index) {
  const node = document.getElementById(`ln-${index}`);
  node?.scrollIntoView({ block: "center" });
  return !!node;
}

// The document's lines: the first 255, unless Lab filters hide some or a Lab sort reorders them.
function renderDoc() {
  const ls = lines();
  $("#doc-count").textContent = `${ls.length} lines${ls.length > 255 ? " (first 255 searched)" : ""}`;
  mount("#doc-edit", S.editing ? "Done" : "Edit");
  if (S.editing) {
    mount("#doc", h("div", { class: "panel-body" }, h("textarea", { class: "input", spellcheck: "false" }, S.text)));
    return;
  }
  const hits = new Map();
  if (S.result) {
    const r = S.result.results[S.focus];
    r?.hits.forEach((hit, i) => hits.set(hit.index, i === 0 ? "hit" : hit.prob >= 0.05 ? "hit2" : ""));
  }
  const shown = docCtx.shown();
  const total = Math.min(ls.length, 255), active = LAB.active(DOC);
  mount("#doc",
    active ? h("div", { class: "faint", role: "status", style: { padding: "8px 12px 0", fontSize: "12px" } },
      `${shown.length} of ${total} lines shown · ${active} Lab setting${active === 1 ? "" : "s"} active `,
      h("button", { class: "btn sm ghost", onclick: () => { LAB.reset(DOC); renderDoc(); renderDocLab(); } }, "Clear Lab filters and sort")) : null,
    active && total && !shown.length ? h("div", { class: "empty" }, "No line matches the Lab filters.") : null,
    h("div", { class: "doc" }, shown.map(({ index: i, text: l }) =>
      h("div", { class: `ln ${/^Section [A-Z]:/.test(l) ? "head" : ""} ${hits.get(i) || ""}`, id: `ln-${i}` },
        h("span", { class: "id" }, `L${String(i).padStart(3, "0")}`), h("span", {}, l)))));
}

// The Lab tools under the document. Rendered again when the text, the results or the focus change, not by refresh().
function renderDocLab() {
  const section = LAB.section(labEnv, DOC, docCtx);
  $("#doc-lab").classList.toggle("hidden", !section);
  mount("#doc-lab", section);
}

function renderQueries(focusLast = false) {
  const rows = S.queries.map((q, i) => {
    const input = h("input", { class: "input", value: q, placeholder: "Ask the document something…" });
    input.addEventListener("input", () => { S.queries[i] = input.value; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
    return h("div", { class: "query" }, input,
      h("button", { class: "btn sm ghost", "aria-label": "Remove", onclick: () => { S.queries.splice(i, 1); renderQueries(); } }, icon("x")));
  });
  mount("#queries", rows);
  $("#q-note").textContent = `${S.queries.length} × 2 questions in one call`;
  if (focusLast) $$("#queries input").at(-1)?.focus();
}
const $$ = (s) => [...document.querySelectorAll(s)];

async function search() {
  const queries = S.queries.map((q) => q.trim()).filter(Boolean);
  if (!queries.length) return toast("Add at least one question.");
  if (S.editing) toggleEdit();
  const btn = $("#search");
  btn.disabled = true;
  S.pending = true;
  mount(btn, h("span", { class: "spin" }), " Searching…");
  try {
    S.result = await api("/api/find", { text: S.text, queries });
    S.focus = 0;
    S.searches += 1;
    S.pending = false;
    renderResults();
    renderDoc();
    renderDocLab();
  } catch (e) { handleError(e); } finally {
    S.pending = false;
    btn.disabled = false;
    mount(btn, icon("search"), "Search");
  }
}

function renderResults() {
  const r = S.result;
  if (!r) return mount("#results", h("div", { class: "empty" }, "Results appear here. One request answers every question at once."), resultsLab());
  mount("#results",
    h("div", { class: "panel-head" }, icon("search"), h("h2", {}, `${r.results.length} questions · ${r.lines} lines · 1 request`), h("div", { class: "spacer" }),
      callStats(r.meta, () => inspect(r.trace, "Find · one Jev request"))),
    h("div", { id: "result-cards" }),
    h("div", { class: "panel-body faint", style: { fontSize: "12px" } },
      `The Choice probabilities always sum to 1, so some line ranks first even when nothing answers. The separate “exists” Noul is what tells you whether to trust the top hit: ≥ ${pct(r.thresholds.found)} answered, < ${pct(r.thresholds.absent)} absent, between = partial. Tune those on your own documents.`),
    resultsLab());
  renderResultCards();
}

// The Lab tools at the foot of the results panel, or null when no pack works on the results.
function resultsLab() {
  const section = LAB.section(labEnv, RESULTS, resultsCtx);
  return section ? h("div", { class: "panel-body", id: "results-lab" }, section) : null;
}

// The result cards: one per question in request order, unless Lab filters hide some or a Lab sort reorders them.
// Lab's refresh() calls this alone, so the Lab section keeps its state while a filter is typed.
function renderResultCards() {
  const r = S.result;
  const box = $("#result-cards");
  if (!r || !box) return;
  const shown = resultsCtx.shown();
  const total = r.results.length, active = LAB.active(RESULTS);
  mount(box,
    active ? h("div", { class: "panel-body faint", role: "status", style: { fontSize: "12px" } },
      `${shown.length} of ${total} questions shown · ${active} Lab setting${active === 1 ? "" : "s"} active `,
      h("button", { class: "btn sm ghost", onclick: () => { LAB.reset(RESULTS); renderResults(); } }, "Clear Lab filters and sort")) : null,
    active && total && !shown.length ? h("div", { class: "empty" }, "No question matches the Lab filters.") : null,
    shown.map((item) => resultCard(r.results[item.position - 1], item.position - 1)));
}

function resultCard(res, qi) {
  return h("div", { class: `result panel-body${qi === S.focus ? "" : ""}`, style: { borderBottom: "1px solid var(--line)", cursor: "pointer", background: qi === S.focus ? "var(--panel-2)" : "" }, onclick: () => focusResult(qi) },
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: "q" }, `“${res.query}”`), h("div", { style: { flex: 1 } }),
      statusBadge(res.verdict), h("span", { class: "mono faint", style: { fontSize: "12px" }, title: "Noul: does any line answer this?" }, `exists ${pct(res.exists)}`)),
    h("div", { class: "grid", style: { gap: "2px" } }, res.hits.filter((hit, i) => i === 0 || hit.prob >= 0.01).map((hit, i) => h("div", { class: `hit${i === 0 ? " top" : ""}`, onclick: (e) => { e.stopPropagation(); focusResult(qi); showLine(hit.index); } },
      h("div", {}, h("div", { class: "p" }, pct(hit.prob)), h("div", { class: "mini" }, h("i", { style: { width: pct(hit.prob, 1) } }))),
      h("div", { class: "txt" }, h("span", { class: "faint mono", style: { fontSize: "11px", marginRight: "6px" } }, hit.id), hit.text)))));
}

boot().catch(handleError);
