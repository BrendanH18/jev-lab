import { $, api, callStats, h, handleError, icon, initChrome, inspect, mount, pct, statusBadge, toast } from "./common.js";

const S = { text: "", queries: [], editing: false, result: null, focus: 0 };
const MAX_Q = 8;

async function boot() {
  await initChrome("/find");
  mount("#q-add", icon("plus"), "Add question");
  mount("#search", icon("search"), "Search");
  const sample = await api("/api/find/sample");
  S.text = sample.text;
  S.queries = [...sample.queries];
  renderDoc();
  renderQueries();
  $("#doc-sample").addEventListener("click", () => { S.text = sample.text; S.editing = false; S.result = null; renderDoc(); renderResults(); });
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
}

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
  mount("#doc", h("div", { class: "doc" }, ls.slice(0, 255).map((l, i) =>
    h("div", { class: `ln ${/^Section [A-Z]:/.test(l) ? "head" : ""} ${hits.get(i) || ""}`, id: `ln-${i}` },
      h("span", { class: "id" }, `L${String(i).padStart(3, "0")}`), h("span", {}, l)))));
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
  mount(btn, h("span", { class: "spin" }), " Searching…");
  try {
    S.result = await api("/api/find", { text: S.text, queries });
    S.focus = 0;
    renderResults();
    renderDoc();
  } catch (e) { handleError(e); } finally {
    btn.disabled = false;
    mount(btn, icon("search"), "Search");
  }
}

function renderResults() {
  const r = S.result;
  if (!r) return mount("#results", h("div", { class: "empty" }, "Results appear here. One request answers every question at once."));
  const cards = r.results.map((res, qi) => h("div", { class: `result panel-body${qi === S.focus ? "" : ""}`, style: { borderBottom: "1px solid var(--line)", cursor: "pointer", background: qi === S.focus ? "var(--panel-2)" : "" }, onclick: () => { S.focus = qi; renderResults(); renderDoc(); } },
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: "q" }, `“${res.query}”`), h("div", { style: { flex: 1 } }),
      statusBadge(res.verdict), h("span", { class: "mono faint", style: { fontSize: "12px" }, title: "Noul: does any line answer this?" }, `exists ${pct(res.exists)}`)),
    h("div", { class: "grid", style: { gap: "2px" } }, res.hits.filter((hit, i) => i === 0 || hit.prob >= 0.01).map((hit, i) => h("div", { class: `hit${i === 0 ? " top" : ""}`, onclick: (e) => { e.stopPropagation(); S.focus = qi; renderResults(); renderDoc(); document.getElementById(`ln-${hit.index}`)?.scrollIntoView({ block: "center" }); } },
      h("div", {}, h("div", { class: "p" }, pct(hit.prob)), h("div", { class: "mini" }, h("i", { style: { width: pct(hit.prob, 1) } }))),
      h("div", { class: "txt" }, h("span", { class: "faint mono", style: { fontSize: "11px", marginRight: "6px" } }, hit.id), hit.text))))));
  mount("#results",
    h("div", { class: "panel-head" }, icon("search"), h("h2", {}, `${r.results.length} questions · ${r.lines} lines · 1 request`), h("div", { class: "spacer" }),
      callStats(r.meta, () => inspect(r.trace, "Find · one Jev request"))),
    cards,
    h("div", { class: "panel-body faint", style: { fontSize: "12px" } },
      `The Choice probabilities always sum to 1, so some line ranks first even when nothing answers. The separate “exists” Noul is what tells you whether to trust the top hit: ≥ ${pct(r.thresholds.found)} answered, < ${pct(r.thresholds.absent)} absent, between = partial. Tune those on your own documents.`));
}

boot().catch(handleError);
