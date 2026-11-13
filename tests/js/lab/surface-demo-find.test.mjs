// The Find page's Lab surfaces: the builders of static/js/lab/surfaces/find.js, and the hooks in static/js/find.js,
// rebuilt from the page source with stand-ins for the DOM and the network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { applyTransform, previewTransform, undoTransform } from "../../../static/js/lab/kit.js";
import { createLab } from "../../../static/js/lab/host.js";
import { FIND_RULES, findDocumentCtx, findDocumentLines, findLineItems, findResultsCtx } from "../../../static/js/lab/surfaces/find.js";
import resultsPack from "../../../static/js/lab/packs/find/find-results-insights.js";
import documentPack from "../../../static/js/lab/packs/find/find-document-tools.js";
import { fakeEnv, find, fire, textOf } from "./harness.mjs";
import { DOC_LINES, DOCS, QUERIES, RESULTS, resultsByPosition, sampleFindDocumentCtx, sampleFindResultsCtx } from "./fixtures/find.mjs";

const PAGE = readFileSync(new URL("../../../static/js/find.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../../static/find.html", import.meta.url), "utf8");
const FIND_PY = readFileSync(new URL("../../../jev/find.py", import.meta.url), "utf8");
const body = (name, source = PAGE) => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `no function ${name}`);
  return match[0];
};
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) });
const plain = (value) => JSON.parse(JSON.stringify(value, (key, entry) => (typeof entry === "function" ? "fn" : entry)));

// ---------- the contract's constants ----------

test("FIND_RULES mirror jev/find.py and the page", () => {
  assert.match(FIND_PY, /MAX_LINES = 255\b/);
  assert.match(FIND_PY, /MAX_QUERIES = 8\b/);
  assert.match(FIND_PY, /MAX_DOC_CHARS = 60_000\b/);
  assert.match(FIND_PY, /FOUND, ABSENT = 0\.7, 0\.35\b/);
  assert.match(FIND_PY, /top: int = 5\)/);
  assert.deepEqual({ ...FIND_RULES }, { found: 0.7, absent: 0.35, max_queries: 8, max_lines: 255, max_doc_chars: 60000, top: 5, list_min: 0.01, highlight_min: 0.05 });
  assert.match(PAGE, /const MAX_Q = 8;/);
  assert.ok(PAGE.includes("i === 0 || hit.prob >= 0.01"), "the page lists hits from 1%");
  assert.ok(PAGE.includes('hit.prob >= 0.05 ? "hit2"'), "the page highlights hits from 5%");
  assert.ok(PAGE.includes("/^Section [A-Z]:/.test(l)"), "the page's heading rule");
});

test("the fixture builds requests the way jev/find.py does", () => {
  const request = RESULTS.handbook.trace.request;
  assert.ok(request.state.document.startsWith("L000| Harbor Coffee Co. Team Handbook"));
  assert.ok(FIND_PY.includes('"%s| %s" % (line_id(i), line)'));
  assert.ok(FIND_PY.includes("Which line of `document` contains the answer to: “%s”?"));
  assert.ok(FIND_PY.includes("Does any line of `document` address or answer: “%s”?"));
  assert.equal(request.questions["q0.where"].instructions, `Which line of \`document\` contains the answer to: “${QUERIES[0]}”?`);
  for (const text of ["At least one line states or directly implies the answer", "No line addresses this question"]) assert.ok(FIND_PY.includes(`"${text}"`));
  for (const line of DOC_LINES) assert.doesNotMatch(line, /@(?![\w.-]+\.example\b)/, "fictional addresses use .example");
});

// ---------- find.results builder ----------

test("result items have the contract's shape, in request order", () => {
  const ctx = sampleFindResultsCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.position), [1, 2, 3, 4]);
  const notice = items[1];
  assert.deepEqual(Object.keys(notice), ["position", "key", "query", "exists", "verdict", "confidence", "hits", "top", "top_prob", "line_probs"]);
  assert.deepEqual({ ...notice, hits: undefined, top: undefined, line_probs: undefined }, { position: 2, key: "q1", query: QUERIES[1], exists: 0.93, verdict: "answered",
    confidence: 0.64, hits: undefined, top: undefined, top_prob: 0.64, line_probs: undefined });
  assert.deepEqual(notice.hits.map((hit) => [hit.rank, hit.id, hit.index, hit.prob, hit.heading, hit.section, hit.listed]), [
    [1, "L008", 8, 0.64, false, "Section C: Leaving Harbor Coffee", true],
    [2, "L006", 6, 0.3, false, "Section B: Pay and time off", true],
    [3, "L007", 7, 0.03, true, "Section C: Leaving Harbor Coffee", true],
    [4, "L003", 3, 0.02, false, "Section A: Hours and scheduling", true],
    [5, "L000", 0, 0.005, false, null, false],
  ]);
  assert.equal(notice.hits[0].text, "Please give at least two weeks notice when you resign.");
  assert.deepEqual(notice.top, notice.hits[0]);
  assert.notEqual(notice.top, notice.hits[0], "top is a copy");
  assert.deepEqual(notice.line_probs, [0.005, 0, 0, 0.02, 0, 0, 0.3, 0.03, 0.64, 0, 0, 0, 0.005]);
  assert.equal(items[0].line_probs[0], null, "a line missing from the response is null, not 0");
  assert.ok(Object.isFrozen(notice) && Object.isFrozen(notice.hits[0]) && Object.isFrozen(notice.line_probs));
  assert.equal(ctx.itemName(notice, 0), "Q2");
  assert.equal(ctx.itemName({}, 3), "4");
  for (const item of items) JSON.parse(JSON.stringify(item));
});

test("odd results read without throwing", () => {
  const items = sampleFindResultsCtx({ result: RESULTS.odd }).items();
  assert.equal(items.length, 3);
  assert.deepEqual([items[0].query, items[0].exists, items[0].verdict, items[0].confidence, items[0].top_prob, items[0].line_probs], ["  ", null, null, null, null, null]);
  assert.deepEqual(items[0].hits.map((hit) => [hit.id, hit.index, hit.prob, hit.section, hit.listed]),
    [["L001", 1, null, "Section A: Hours and scheduling", true], ["", null, 0.02, null, true]]);
  assert.deepEqual([items[1].hits, items[1].top, items[1].verdict], [[], null, "absent"]);
  assert.deepEqual([items[2].query, items[2].hits], ["", []]);
  const ctx = sampleFindResultsCtx({ result: RESULTS.odd });
  assert.deepEqual([ctx.data.lines, ctx.data.thresholds, ctx.data.request, ctx.data.trace, ctx.data.truncated], [null, null, null, null, false]);
  assert.deepEqual(ctx.data.meta, { model: "jev-1.14.0" });
});

test("items keep their identity until a new result arrives; shown() honors Lab filters and sort", () => {
  let result = RESULTS.handbook;
  const ctx = sampleFindResultsCtx({ result: () => result, hide: [2], order: [4, 3] });
  const first = ctx.items();
  assert.equal(ctx.items(), first);
  assert.deepEqual(ctx.shown().map((item) => item.position), [4, 3, 1]);
  assert.ok(ctx.shown().every((item) => first.includes(item)));
  result = RESULTS.mixed;
  assert.notEqual(ctx.items(), first);
  assert.deepEqual(ctx.items().map((item) => item.query), ["who roasts on Sunday?", "where is the staff entrance?", "when is payday?"]);
  result = null;
  assert.deepEqual([ctx.items(), ctx.shown()], [[], []]);
});

test("results data: before a search, after it, and while the boxes change", () => {
  const none = sampleFindResultsCtx({ result: null, searches: 0 });
  assert.deepEqual([none.data.lines, none.data.meta, none.data.request, none.data.trace, none.data.thresholds, none.data.focus, none.data.stale, none.data.searches],
    [null, null, null, null, null, null, false, 0]);
  assert.deepEqual(none.data.searched, []);
  assert.deepEqual(none.data.queries, QUERIES);
  const boxes = [...QUERIES, "   "];
  const ctx = sampleFindResultsCtx({ queries: boxes, focusIndex: 2, pending: true, editing: true, searches: 3 });
  assert.deepEqual([ctx.data.lines, ctx.data.truncated, ctx.data.focus, ctx.data.pending, ctx.data.editing, ctx.data.searches], [13, false, 3, true, true, 3]);
  assert.deepEqual(ctx.data.thresholds, { found: 0.7, absent: 0.35 });
  assert.equal(ctx.data.meta.cost_usd, 0.000092);
  assert.ok(ctx.data.request.state.document.includes("L012| Questions about this handbook"));
  assert.ok(Object.isFrozen(ctx.data.trace) && Object.isFrozen(ctx.data.trace.response.answers));
  assert.notEqual(ctx.data.trace, RESULTS.handbook.trace, "a copy of the page's trace");
  assert.equal(ctx.data.stale, false, "a blank box is not a change");
  boxes[1] = "  how much notice do I have to give before I quit?  ";
  assert.equal(ctx.data.stale, false, "edge spaces are not a change");
  boxes[1] = "how much notice for managers?";
  assert.equal(ctx.data.stale, true);
  assert.equal(sampleFindResultsCtx({ focusIndex: 9 }).data.focus, null, "a focus outside the results reads as none");
  assert.equal(sampleFindResultsCtx({ result: RESULTS.handbook, queries: [...QUERIES, "a", "b", "c", "d", "e"] }).data.stale, true);
});

test("results actions: focusResult and showHit go only to shown, listed things", () => {
  const ctx = sampleFindResultsCtx({ hide: [3], offScreen: [6] });
  assert.equal(ctx.actions.focusResult(2).position, 2);
  assert.deepEqual(ctx.log, [["focusResult", 1]]);
  assert.throws(() => ctx.actions.focusResult(3), /hidden by the current Lab filters/);
  assert.throws(() => ctx.actions.focusResult(7), /no question 7/);
  assert.throws(() => sampleFindResultsCtx({ result: null }).actions.focusResult(1), /Search first/);
  ctx.log.length = 0;
  assert.equal(ctx.actions.showHit(1, 1).id, "L010");
  assert.deepEqual(ctx.log, [["focusResult", 0], ["showLine", 10]]);
  assert.throws(() => ctx.actions.showHit(2, 5), /does not list hit 5/, "L000 at 0.5% is not on the card");
  assert.throws(() => ctx.actions.showHit(2, 9), /has no hit 9/);
  ctx.log.length = 0;
  assert.throws(() => ctx.actions.showHit(2, 2), /L006 is not shown in the document/);
  assert.deepEqual(ctx.log, [["focusResult", 1], ["showLine", 6]], "the question is still focused");
  assert.throws(() => sampleFindResultsCtx({ editing: true }).actions.showHit(1, 1), /Press Done first/);
  assert.throws(() => sampleFindResultsCtx({ result: RESULTS.odd }).actions.showHit(1, 2), /does not list hit 2/, "a hit without an index cannot be shown");
  assert.throws(() => sampleFindResultsCtx({ missing: ["focusResult"] }).actions.focusResult(1), /cannot do that here/);
});

test("results actions: inspect and addQuery keep their guards and never search", () => {
  const ctx = sampleFindResultsCtx();
  ctx.actions.inspect();
  assert.deepEqual(ctx.log, [["inspect"]]);
  assert.throws(() => sampleFindResultsCtx({ result: null }).actions.inspect(), /Search first/);
  assert.equal(ctx.actions.addQuery("  do we sell gift cards?  "), "do we sell gift cards?");
  assert.deepEqual(ctx.log.at(-1), ["addQuery", "do we sell gift cards?"]);
  assert.equal(ctx.data.stale, true, "the result now differs from the boxes");
  assert.throws(() => ctx.actions.addQuery("   "), /no question to add/);
  assert.throws(() => ctx.actions.addQuery(42), /no question to add/);
  assert.throws(() => ctx.actions.addQuery("Can I bring my DOG to work?"), /already in a box/);
  assert.throws(() => sampleFindResultsCtx({ pending: true }).actions.addQuery("is there a staff discount?"), /Wait for the search/);
  const full = sampleFindResultsCtx({ queries: ["a", "b", "c", "d", "e", "f", "g", "h"] });
  assert.throws(() => full.actions.addQuery("is there a staff discount?"), /at most 8 questions/);
  assert.deepEqual(full.log, []);
  assert.deepEqual(Object.keys(ctx.actions).sort(), ["addQuery", "focusResult", "inspect", "showHit"], "no replaceItems or importItems: the results are read-only");
});

// ---------- find.document builder ----------

test("document items are the page's lines, canonical, with 255 searched", () => {
  const ctx = sampleFindDocumentCtx();
  const items = ctx.items();
  assert.deepEqual(items.map((item) => item.text), DOC_LINES, "blank lines dropped, indentation trimmed");
  assert.deepEqual(findDocumentLines(DOCS.short), DOC_LINES);
  assert.deepEqual(items[3], { index: 3, id: "L003", text: DOC_LINES[3], heading: false, section: "Section A: Hours and scheduling", searched: true });
  assert.deepEqual(items[0], { index: 0, id: "L000", text: DOC_LINES[0], heading: false, section: null, searched: true });
  assert.deepEqual(Object.keys(items[9]), ["index", "id", "text", "heading", "section", "searched"]);
  assert.equal(items[9].section, "Section D: Pets");
  assert.equal(ctx.itemName(items[12], 0), "L012");
  assert.equal(ctx.items(), items, "the same objects while the text is unchanged");
  assert.ok(Object.isFrozen(items) && Object.isFrozen(items[0]));
  const long = sampleFindDocumentCtx({ text: DOCS.long, result: null });
  assert.equal(long.items().length, 260);
  assert.equal(long.shown().length, 255, "the page shows only the searched lines");
  assert.deepEqual([long.items()[254].searched, long.items()[255].searched, long.items()[255].section], [true, false, "Section F: Roast log week 6"]);
  assert.equal(findLineItems(["a"]).length, 1);
  assert.equal(findLineItems(Array.from({ length: 1001 }, () => "x"))[1000].id, "L1000");
  assert.deepEqual(sampleFindDocumentCtx({ text: "", result: null }).items(), []);
});

test("document data: text, counts, sample flag, and the user's own results", () => {
  const ctx = sampleFindDocumentCtx({ focusIndex: 1 });
  assert.equal(ctx.data.text, DOCS.short);
  assert.equal(ctx.data.chars, DOCS.short.length);
  assert.equal(sampleFindDocumentCtx({ text: "Café ☕\u{1F600}", result: null }).data.chars, 7, "code points, like the server");
  assert.deepEqual([ctx.data.lines, ctx.data.searchable, ctx.data.sample, ctx.data.editing, ctx.data.pending], [13, 13, true, false, false]);
  assert.equal(sampleFindDocumentCtx({ text: DOCS.long, result: null }).data.searchable, 255);
  assert.equal(sampleFindDocumentCtx({ sample: DOCS.plain }).data.sample, false);
  assert.equal(sampleFindDocumentCtx({ sample: null }).data.sample, false);
  assert.equal(ctx.data.results.length, 4);
  assert.equal(ctx.data.results[0], resultsByPosition(sampleFindResultsCtx())[1], "the same frozen objects as find.results");
  assert.equal(ctx.data.focused.position, 2);
  const none = sampleFindDocumentCtx({ result: null });
  assert.deepEqual([none.data.results, none.data.focused], [[], null]);
  assert.equal(ctx.data.rules, FIND_RULES);
});

test("replaceItems writes canonical lines back as the document, with every guard", () => {
  const ctx = sampleFindDocumentCtx();
  const items = ctx.items();
  // Unchanged: nothing is written, so the results stay.
  assert.equal(ctx.actions.replaceItems(items.map((item) => ({ ...item })), { label: "Nothing" }), 13);
  assert.deepEqual(ctx.log, []);
  const next = findLineItems(DOC_LINES.filter((_, index) => index !== 3));
  assert.equal(ctx.actions.replaceItems(next, { label: "Drop L003" }), 12);
  assert.deepEqual(ctx.log, [["setText", DOC_LINES.filter((_, index) => index !== 3).join("\n"), "Drop L003"]]);
  assert.deepEqual(ctx.items().map((item) => item.text), DOC_LINES.filter((_, index) => index !== 3), "items follow the new text");
  const fresh = () => sampleFindDocumentCtx();
  const rejects = [
    ["not a list", /a list of lines/],
    [[], /at least one line/],
    [[{ text: 3 }], /Line 1 has no text/],
    [findLineItems(["   "]), /Line 1 is blank/],
    [findLineItems(["two\nlines"]), /line break/],
    [[{ ...findLineItems(["padded"])[0], text: " padded " }], /spaces at an end/],
    [next.slice(1), /out of step/],                                         // stale index and id after removing a line
    [[{ id: "L000", index: 0, text: "Order", heading: false, section: null, searched: true }], /out of step/],  // key order matters for Undo
    [[{ ...findLineItems(["Section A: Hours"])[0], heading: false }], /out of step/],
    [findLineItems(["x".repeat(60001)]), /at most 60,000/],
  ];
  for (const [input, message] of rejects) {
    const one = fresh();
    assert.throws(() => one.actions.replaceItems(input, { label: "Bad" }), message);
    assert.deepEqual(one.log, [], `nothing written for ${String(message)}`);
  }
  assert.throws(() => sampleFindDocumentCtx({ editing: true }).actions.replaceItems(next, {}), /Press Done first/);
  assert.throws(() => sampleFindDocumentCtx({ pending: true }).actions.replaceItems(next, {}), /Wait for the search/);
  assert.throws(() => sampleFindDocumentCtx({ missing: ["setText"] }).actions.replaceItems(next, {}), /cannot do that here/);
  const exact = findLineItems(["x".repeat(60000)]);
  assert.equal(sampleFindDocumentCtx().actions.replaceItems(exact, {}), 1, "exactly 60,000 characters is allowed");
});

test("a previewed edit applies through replaceItems and its Undo restores the document", () => {
  const ctx = sampleFindDocumentCtx({ text: "Section A: Hours\nThe cafe opens at 6:30 am.\nthe cafe opens at  6:30 am.\nSection B: Pay", result: null });
  const transform = documentPack.features.find((feature) => feature.id === "remove_duplicates");
  const before = ctx.items();
  const preview = previewTransform("find-document-tools/remove_duplicates", transform, before, new Set(before.map((_, index) => index)), {}, ctx);
  const applied = applyTransform(preview, ctx.items());
  ctx.actions.replaceItems(applied.items, { label: preview.label });
  assert.equal(ctx.state.text, "Section A: Hours\nThe cafe opens at 6:30 am.\nSection B: Pay");
  const restored = undoTransform(applied.undo, ctx.items());
  ctx.actions.replaceItems(restored, { label: "Undo" });
  assert.equal(ctx.state.text, "Section A: Hours\nThe cafe opens at 6:30 am.\nthe cafe opens at  6:30 am.\nSection B: Pay");
  assert.deepEqual(ctx.items(), before);
});

test("importItems appends text lines with the same guards", () => {
  const ctx = sampleFindDocumentCtx({ text: "Section A: Hours\nPayday is Friday.", result: null });
  assert.equal(ctx.actions.importItems([{ text: "  Tips are pooled.  " }, { ...findLineItems(["Section B: Pay"])[0], index: 7 }], { label: "Paste" }), 4);
  assert.deepEqual(ctx.log, [["setText", "Section A: Hours\nPayday is Friday.\nTips are pooled.\nSection B: Pay", "Paste"]]);
  assert.deepEqual(ctx.items().map((item) => item.id), ["L000", "L001", "L002", "L003"], "imported lines are renumbered");
  assert.throws(() => ctx.actions.importItems([], {}), /no lines to add/);
  assert.throws(() => ctx.actions.importItems([{ text: "" }], {}), /blank/);
  assert.throws(() => ctx.actions.importItems([{ text: "a\r\nb" }], {}), /line break/);
  assert.throws(() => ctx.actions.importItems([{ text: "y".repeat(60000) }], {}), /at most 60,000/);
  assert.throws(() => sampleFindDocumentCtx({ editing: true }).actions.importItems([{ text: "x" }], {}), /Press Done first/);
  assert.equal(ctx.log.length, 1);
});

test("showLine scrolls only to a line that is shown", () => {
  const ctx = sampleFindDocumentCtx({ hide: [4], offScreen: [6] });
  assert.equal(ctx.actions.showLine(2).id, "L002");
  assert.deepEqual(ctx.log, [["showLine", 2]]);
  assert.throws(() => ctx.actions.showLine(4), /a Lab filter hides it/);
  assert.throws(() => ctx.actions.showLine(6), /not on screen/);
  assert.throws(() => ctx.actions.showLine(40), /no line 40/);
  assert.throws(() => sampleFindDocumentCtx({ text: DOCS.long, result: null }).actions.showLine(258), /first 255 lines/);
  assert.throws(() => sampleFindDocumentCtx({ editing: true }).actions.showLine(2), /Press Done first/);
});

// ---------- the page hooks, rebuilt from static/js/find.js ----------

// The page as it was before Lab, for the "exactly as before" checks.
const BEFORE = `function renderDoc() {
  const ls = lines();
  $("#doc-count").textContent = \`\${ls.length} lines\${ls.length > 255 ? " (first 255 searched)" : ""}\`;
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
    h("div", { class: \`ln \${/^Section [A-Z]:/.test(l) ? "head" : ""} \${hits.get(i) || ""}\`, id: \`ln-\${i}\` },
      h("span", { class: "id" }, \`L\${String(i).padStart(3, "0")}\`), h("span", {}, l)))));
}
function renderResults() {
  const r = S.result;
  if (!r) return mount("#results", h("div", { class: "empty" }, "Results appear here. One request answers every question at once."));
  const cards = r.results.map((res, qi) => h("div", { class: \`result panel-body\${qi === S.focus ? "" : ""}\`, style: { borderBottom: "1px solid var(--line)", cursor: "pointer", background: qi === S.focus ? "var(--panel-2)" : "" }, onclick: () => { S.focus = qi; renderResults(); renderDoc(); } },
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
      h("span", { class: "q" }, \`“\${res.query}”\`), h("div", { style: { flex: 1 } }),
      statusBadge(res.verdict), h("span", { class: "mono faint", style: { fontSize: "12px" }, title: "Noul: does any line answer this?" }, \`exists \${pct(res.exists)}\`)),
    h("div", { class: "grid", style: { gap: "2px" } }, res.hits.filter((hit, i) => i === 0 || hit.prob >= 0.01).map((hit, i) => h("div", { class: \`hit\${i === 0 ? " top" : ""}\`, onclick: (e) => { e.stopPropagation(); S.focus = qi; renderResults(); renderDoc(); document.getElementById(\`ln-\${hit.index}\`)?.scrollIntoView({ block: "center" }); } },
      h("div", {}, h("div", { class: "p" }, pct(hit.prob)), h("div", { class: "mini" }, h("i", { style: { width: pct(hit.prob, 1) } }))),
      h("div", { class: "txt" }, h("span", { class: "faint mono", style: { fontSize: "11px", marginRight: "6px" } }, hit.id), hit.text))))));
  mount("#results",
    h("div", { class: "panel-head" }, icon("search"), h("h2", {}, \`\${r.results.length} questions · \${r.lines} lines · 1 request\`), h("div", { class: "spacer" }),
      callStats(r.meta, () => inspect(r.trace, "Find · one Jev request"))),
    cards,
    h("div", { class: "panel-body faint", style: { fontSize: "12px" } },
      \`The Choice probabilities always sum to 1, so some line ranks first even when nothing answers. The separate “exists” Noul is what tells you whether to trust the top hit: ≥ \${pct(r.thresholds.found)} answered, < \${pct(r.thresholds.absent)} absent, between = partial. Tune those on your own documents.\`));
}`;

const PAGE_FUNCTIONS = ["lines", "renderDoc", "renderDocLab", "renderResults", "resultsLab", "renderResultCards", "resultCard", "focusResult", "showLine", "setDocument", "toggleEdit"];
const ctxDecl = (name, builder) => {
  const match = PAGE.match(new RegExp(`const ${name} = ${builder}\\(\\{[^]*?\\n\\}\\);`));
  assert.ok(match, `static/js/find.js has no ${name}`);
  return match[0];
};

// The page's functions over a fake screen. packs: the Lab packs loaded; state: S overrides.
function pageWith({ packs = [], ...state } = {}) {
  const LAB = createLab(packs);
  const S = { text: DOCS.short, queries: [...QUERIES], editing: false, result: RESULTS.handbook, focus: 0, pending: false, searches: 1, sample: DOCS.short, ...state };
  const held = new Map();
  const log = [];
  const byId = (id) => {
    for (const nodes of held.values()) for (const node of nodes) { const hit = find(node, (entry) => entry.attrs?.id === id); if (hit) return hit; }
    return null;
  };
  const elements = { "#doc-count": { textContent: "" }, "#doc-lab": { hidden: true, classList: { toggle: (name, on) => { elements["#doc-lab"].hidden = on; } } } };
  const $ = (selector) => elements[selector] || byId(selector.slice(1));
  const mount = (target, ...nodes) => {
    const list = nodes.flat(Infinity).filter(Boolean);
    if (typeof target === "string") held.set(target, list); else target.children = list;
    return target;
  };
  const deps = {
    S, LAB, RESULTS: "find.results", DOC: "find.document", $, h, mount, labEnv: fakeEnv(),
    statusBadge: (kind) => h("badge", {}, kind), pct: (p, digits = 0) => `${(p * 100).toFixed(digits)}%`, icon: (name) => h("icon", {}, name),
    callStats: (meta, onInspect) => h("stats", { onclick: onInspect }, String(meta.cost_usd)), inspect: (trace, title) => log.push(["inspect", title]),
    toast: (message) => log.push(["toast", message]), renderQueries: (focus) => log.push(["renderQueries", focus]),
    document: { getElementById: (id) => (byId(id) ? { scrollIntoView: () => log.push(["scroll", id]) } : null) },
    findResultsCtx, findDocumentCtx,
  };
  const names = Object.keys(deps);
  const source = `${ctxDecl("resultsCtx", "findResultsCtx")}\n${ctxDecl("docCtx", "findDocumentCtx")}\n${PAGE_FUNCTIONS.map((name) => body(name)).join("\n")}\nreturn { resultsCtx, docCtx, ${PAGE_FUNCTIONS.join(", ")} };`;
  const page = new Function(...names, source)(...names.map((name) => deps[name]));
  const before = new Function(...names, "lines", `${BEFORE}\nreturn { renderDoc, renderResults };`)(...names.map((name) => deps[name]), page.lines);
  return { ...page, before, S, LAB, held, log, elements };
}

test("with no Lab setting active the document and the result cards render exactly as before", () => {
  for (const state of [{}, { focus: 2 }, { text: DOCS.long, result: null }, { result: null }, { editing: true }]) {
    const page = pageWith({ packs: [resultsPack, documentPack], ...state });
    page.before.renderDoc();
    const docBefore = plain(page.held.get("#doc"));
    const countBefore = page.elements["#doc-count"].textContent;
    page.renderDoc();
    assert.deepEqual(plain(page.held.get("#doc")), docBefore);
    assert.equal(page.elements["#doc-count"].textContent, countBefore);
    if (state.editing) continue;
    page.before.renderResults();
    const resultsBefore = plain(page.held.get("#results"));
    page.renderResults();
    const now = plain(page.held.get("#results"));
    if (!page.S.result) {
      assert.deepEqual(now[0], resultsBefore[0], "the same empty note");
      continue;
    }
    const cards = resultsBefore.slice(1, -1);
    assert.deepEqual(now[0], resultsBefore[0], "the same head");
    assert.equal(now[1].attrs.id, "result-cards");
    assert.deepEqual(now[1].children, cards, "the same cards in the same order");
    assert.deepEqual(now[2], resultsBefore.at(-1), "the same footnote");
  }
});

test("without packs on a surface the page adds nothing", () => {
  const page = pageWith();
  page.renderResults();
  assert.equal(page.held.get("#results").length, 3, "head, cards, footnote");
  page.renderDocLab();
  assert.equal(page.elements["#doc-lab"].hidden, true);
  assert.deepEqual(page.held.get("#doc-lab"), []);
});

test("result cards: Lab filters hide cards, a Lab sort reorders them, clicks keep each card's own question", () => {
  const page = pageWith({ packs: [resultsPack, documentPack] });
  page.renderResults();
  const cards = () => page.held.get("#results")[1].children;
  const queries = () => cards().filter((node) => node.attrs.class?.startsWith("result")).map((node) => textOf(find(node, (entry) => entry.attrs.class === "q")));
  const view = page.LAB.view("find.results");
  view.filters = [{ key: "find-results-insights/verdict", op: "is", value: "answered" }];
  page.renderResultCards();
  assert.deepEqual(queries(), [`“${QUERIES[0]}”`, `“${QUERIES[1]}”`]);
  assert.match(textOf(cards()[0]), /2 of 4 questions shown · 1 Lab setting active/);
  assert.equal(cards()[0].attrs.role, "status");
  view.filters = [];
  view.sort = { key: "find-results-insights/top_prob", dir: "asc" };
  page.renderResultCards();
  // .38 wifi, .41 parental, .64 notice, .71 dog
  assert.deepEqual(queries(), [3, 2, 1, 0].map((index) => `“${QUERIES[index]}”`));
  const dogCard = cards().at(-1);
  assert.equal(dogCard.attrs.style.background, "var(--panel-2)", "question 1 is still the focused one");
  fire(cards()[2], "click");  // the parental-leave card, after the status note and the wifi card
  assert.equal(page.S.focus, 2);
  fire(find(cards()[2], (node) => node.attrs.class === "hit top"), "click", { stopPropagation: () => page.log.push(["stop"]) });
  assert.deepEqual(page.log.slice(-2), [["stop"], ["scroll", "ln-6"]], "the top line of the parental question is L006");
  view.filters = [{ key: "find-results-insights/top_prob", op: "min", value: "0.99" }];
  page.renderResultCards();
  assert.equal(textOf(cards()[1]), "No question matches the Lab filters.");
  fire(find(cards()[0], (node) => node.tag === "button"), "click");
  assert.equal(page.LAB.active("find.results"), 0);
  assert.equal(queries().length, 4);
  assert.deepEqual(queries(), QUERIES.map((query) => `“${query}”`));
});

test("document lines: Lab filters and sort keep line IDs and highlights, with a note and a reset", () => {
  const page = pageWith({ packs: [resultsPack, documentPack] });
  const view = page.LAB.view("find.document");
  view.filters = [{ key: "find-document-tools/heading", op: "with" }];
  page.renderDoc();
  let [note, doc] = page.held.get("#doc");
  assert.match(textOf(note), /5 of 13 lines shown · 1 Lab setting active/);
  assert.deepEqual(doc.children.map((node) => node.attrs.id), ["ln-1", "ln-4", "ln-7", "ln-9", "ln-11"]);
  // Question 1 is focused: L010 is its top line (not shown), L009 at 20% is highlighted, L011 at 4% is not.
  assert.equal(doc.children[3].attrs.class, "ln head hit2");
  assert.equal(doc.children[4].attrs.class, "ln head ");
  view.filters = [];
  view.sort = { key: "find-document-tools/focused_p", dir: "desc" };
  page.renderDoc();
  [note, doc] = page.held.get("#doc");
  assert.deepEqual(doc.children.slice(0, 3).map((node) => textOf(node.children[0])), ["L010", "L009", "L011"]);
  assert.equal(doc.children[0].attrs.class, "ln  hit");
  view.filters = [{ key: "find-document-tools/words", op: "min", value: "99" }];
  page.renderDoc();
  assert.equal(textOf(page.held.get("#doc")[1]), "No line matches the Lab filters.");
  fire(find(page.held.get("#doc")[0], (node) => node.tag === "button"), "click");
  assert.equal(page.LAB.active("find.document"), 0);
  assert.equal(page.held.get("#doc").length, 1);
  assert.equal(page.held.get("#doc")[0].children.length, 13);
  assert.equal(page.elements["#doc-lab"].hidden, false, "the reset also redraws the Lab section");
});

test("the Lab sections render beside both lists, and a document edit drops the results like Done", () => {
  const page = pageWith({ packs: [resultsPack, documentPack] });
  page.renderResults();
  const lab = page.held.get("#results").at(-1);
  assert.equal(lab.attrs.id, "results-lab");
  assert.equal(find(lab, (node) => node.attrs?.["data-lab-surface"])?.attrs["data-lab-surface"], "find.results");
  page.renderDocLab();
  assert.equal(page.elements["#doc-lab"].hidden, false);
  assert.equal(page.held.get("#doc-lab")[0].attrs["data-lab-surface"], "find.document");
  assert.deepEqual(page.LAB.mountedIds().sort(), ["find.document", "find.results"]);
  // A previewed Lab edit applied through the document's replaceItems.
  page.docCtx.actions.replaceItems(findLineItems(DOC_LINES.slice(0, 4)), { label: "Keep the start" });
  assert.equal(page.S.text, DOC_LINES.slice(0, 4).join("\n"));
  assert.equal(page.S.result, null);
  assert.equal(textOf(page.held.get("#results")[0]), "Results appear here. One request answers every question at once.");
  assert.deepEqual(page.log.at(-1), ["toast", "Keep the start: the document changed. Press Search for new results."]);
  assert.equal(page.held.get("#doc")[0].children.length, 4);
  // While the text box is open, edits wait for Done.
  page.S.editing = true;
  page.held.delete("#doc");
  page.docCtx.refresh();
  assert.equal(page.held.has("#doc"), false, "refresh leaves the open text box alone");
  assert.throws(() => page.docCtx.actions.replaceItems(findLineItems(["One line"]), {}), /Press Done first/);
  // The results surface's addQuery adds a box through the page and never searches.
  const fresh = pageWith({ packs: [resultsPack] });
  fresh.resultsCtx.actions.addQuery("is there a staff discount?");
  assert.deepEqual(fresh.S.queries.at(-1), "is there a staff discount?");
  assert.deepEqual(fresh.log, [["renderQueries", true]]);
  fresh.resultsCtx.actions.inspect();
  assert.deepEqual(fresh.log.at(-1), ["inspect", "Find · one Jev request"]);
});

test("search() marks the search pending, counts answered searches and redraws the document's Lab tools", async () => {
  const run = async (fail) => {
    const S = { text: DOCS.short, queries: [...QUERIES], editing: false, result: null, focus: 3, pending: false, searches: 2 };
    const seen = [];
    const btn = { disabled: false };
    const deps = {
      S, $: () => btn, h, mount: () => {}, icon: () => null, toast: (message) => seen.push(["toast", message]), toggleEdit: () => seen.push(["toggleEdit"]),
      handleError: (error) => seen.push(["handleError", error.message, S.pending]),
      api: async (path, payload) => { seen.push(["api", path, payload.queries.length, S.pending]); if (fail) throw new Error("No key"); return RESULTS.handbook; },
      renderResults: () => seen.push(["renderResults", S.pending, S.searches]), renderDoc: () => seen.push(["renderDoc"]), renderDocLab: () => seen.push(["renderDocLab"]),
    };
    const search = new Function(...Object.keys(deps), `${body("search")}\nreturn search;`)(...Object.values(deps));
    await search();
    return { S, seen };
  };
  const ok = await run(false);
  assert.deepEqual(ok.seen, [["api", "/api/find", 4, true], ["renderResults", false, 3], ["renderDoc"], ["renderDocLab"]]);
  assert.deepEqual([ok.S.pending, ok.S.focus, ok.S.result], [false, 0, RESULTS.handbook]);
  const failed = await run(true);
  assert.deepEqual(failed.seen.slice(1), [["handleError", "No key", true]]);
  assert.deepEqual([failed.S.pending, failed.S.searches], [false, 2]);
});

test("the page installs Lab once after the top bar and wires both surfaces", () => {
  const boot = body("boot");
  assert.match(boot, /await initChrome\("\/find"\);\n\s*installLab\(LAB\);/);
  assert.equal(PAGE.match(/installLab\(/g).length, 1);
  assert.match(PAGE, /import \{ LAB \} from "\.\/lab\/pages\/find\.js";/);
  assert.match(PAGE, /import \{ installLab, labEnv \} from "\.\/lab\/env\.js";/);
  assert.match(PAGE, /import \{ findDocumentCtx, findResultsCtx \} from "\.\/lab\/surfaces\/find\.js";/);
  for (const hook of ["LAB.matches(RESULTS, item, ctx)", "LAB.arrange(RESULTS, list, ctx)", "LAB.matches(DOC, item, ctx)", "LAB.arrange(DOC, list, ctx)"]) assert.ok(PAGE.includes(hook), hook);
  for (const declaration of [ctxDecl("resultsCtx", "findResultsCtx"), ctxDecl("docCtx", "findDocumentCtx")]) {
    assert.doesNotMatch(declaration, /\bsearch\(|api\(/, "no Lab action can search");
  }
  assert.match(body("resultsLab"), /LAB\.section\(labEnv, RESULTS, resultsCtx\)/);
  assert.match(body("renderDocLab"), /LAB\.section\(labEnv, DOC, docCtx\)/);
  assert.match(HTML, /<div id="doc"><\/div>\s*<div id="doc-lab" class="panel-body hidden"><\/div>/);
});

test("both starter packs render with the real ctx and every block open", () => {
  const LAB = createLab([resultsPack, documentPack]);
  for (const [id, ctx] of [["find.results", sampleFindResultsCtx()], ["find.document", sampleFindDocumentCtx()]]) {
    const view = LAB.view(id);
    for (const name of ["section", "refine", "checks", "transforms", "metrics", "exports", "imports", "commands"]) view.open[name] = true;
    const tree = LAB.section(fakeEnv(), id, ctx);
    assert.match(textOf(tree), /Lab tools · \d+/);
    const editable = id === "find.document";
    assert.equal(!!find(tree, (node) => node.attrs?.["data-lab-block"] === "transforms"), editable, `${id}: edits only on the document`);
    assert.equal(!!find(tree, (node) => node.attrs?.["data-lab-block"] === "imports"), editable, `${id}: imports only on the document`);
  }
  assert.equal(LAB.count("find.results"), 47);
  assert.equal(LAB.count("find.document"), 39);
  // Commands reach the page through the mounted ctx.
  const ctx = sampleFindResultsCtx();
  LAB.mount("find.results", ctx);
  const key = LAB.handleKey({ key: "ArrowDown", altKey: true, shiftKey: true, target: { tagName: "INPUT" } });
  assert.equal(key, "find-results-insights/next_question");
  assert.deepEqual(ctx.log, [["focusResult", 1]]);
});
