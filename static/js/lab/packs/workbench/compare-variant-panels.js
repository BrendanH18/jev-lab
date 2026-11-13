// Compare setup panels (surface "workbench.compare.variants"; contract in static/js/lab/surfaces/workbench-compare.js):
// A's and B's questions side by side, a word diff of each question's instructions, its options or levels in one table,
// a line diff of its JSON, both question orders, the request size of each variant, and a checklist of every difference
// to tick off before a run is paid for. Pure: it reads the questions and settings as typed, edits nothing, never starts
// a run and calls no model. Copies hold authored questions, ids and settings only, never rows or answers.
import { definePack } from "../../kit.js";
import { deepEqual } from "../../lib/json.js";
import { levenshtein, utf8Bytes, words } from "../../lib/text.js";

const TYPES = ["noul", "choice", "score", "box"];
const NOT_ASKED = "—";
const MAX_CELLS = 250000;  // a diff of longer texts than this many token pairs shows as one replacement
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const both = (item) => isObject(item?.a) && isObject(item?.b);
const typeOf = (question) => (isObject(question) ? (typeof question.type === "string" && question.type ? question.type : "?") : NOT_ASKED);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
// Items as the surface gives them; anything without a string question id is skipped, never shown as "undefined".
const questionItems = (list) => (Array.isArray(list) ? list.filter((item) => isObject(item) && typeof item.qid === "string") : []);
const itemsOf = (ctx) => questionItems(typeof ctx?.items === "function" ? ctx.items() : []);
const shownOf = (ctx) => (typeof ctx?.shown === "function" ? questionItems(ctx.shown()) : itemsOf(ctx));
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
// One cell of tab-separated text: numbers as they are; text on one line, with a leading apostrophe where a spreadsheet
// would run it as a formula.
const tsvCell = (value) => {
  if (typeof value === "number") return String(value);
  const text = oneLine(value);
  return /^[=+@-]/.test(text) ? `'${text}` : text;
};
const tsv = (rows) => rows.map((row) => row.map(tsvCell).join("\t")).join("\n");
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const instructionsText = (question) => (!isObject(question) || question.instructions === undefined || question.instructions === null ? ""
  : typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions));
const choiceCriteria = (question) => (isObject(question) && isObject(question.criteria) ? question.criteria : {});
const scoreLevels = (question) => (isObject(question) && Array.isArray(question.criteria) ? question.criteria : []);
const describe = (value) => (value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));
const withoutCore = (question) => Object.fromEntries(Object.entries(question).filter(([key]) => !["type", "instructions", "criteria"].includes(key)));
const keyOrderDiffers = (a, b) => Object.keys(choiceCriteria(a)).join("\u0000") !== Object.keys(choiceCriteria(b)).join("\u0000");

function optionCount(question) {
  if (!isObject(question)) return 0;
  if (question.type === "choice" && isObject(question.criteria)) return Object.keys(question.criteria).length;
  if (question.type === "score" && Array.isArray(question.criteria)) return question.criteria.length;
  return 0;
}

// ---------- diffs ----------

// The longest-common-subsequence diff of two token lists: [{ op: "same" | "del" | "add", a?, b? }]. At a tie a
// deletion comes before an insertion. key(token) decides which tokens match.
function diffTokens(a, b, key = (token) => token) {
  const n = a.length, m = b.length;
  if (n * m > MAX_CELLS) return [...a.map((token) => ({ op: "del", a: token })), ...b.map((token) => ({ op: "add", b: token }))];
  const ka = a.map(key), kb = b.map(key);
  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i][j] = ka[i] === kb[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) out.push({ op: "same", a: a[i++], b: b[j++] });
    else if (table[i + 1][j] >= table[i][j + 1]) out.push({ op: "del", a: a[i++] });
    else out.push({ op: "add", b: b[j++] });
  }
  while (i < n) out.push({ op: "del", a: a[i++] });
  while (j < m) out.push({ op: "add", b: b[j++] });
  return out;
}

// A word as the "ignore case and punctuation" mode matches it: lower case, punctuation stripped from both ends.
const looseWord = (word) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || word.toLowerCase();
const looseText = (text) => words(text).map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")).filter(Boolean).join(" ");

// Runs of one kind of change: [{ op, text }], with B's spelling for words both keep.
function wordRuns(textA, textB, loose = false) {
  const runs = [];
  for (const step of diffTokens(words(textA), words(textB), loose ? looseWord : undefined)) {
    const word = step.op === "del" ? step.a : step.b;
    const last = runs[runs.length - 1];
    if (last && last.op === step.op) last.words.push(word);
    else runs.push({ op: step.op, words: [word] });
  }
  return runs.map((run) => ({ op: run.op, text: run.words.join(" "), count: run.words.length }));
}
const markup = (runs) => runs.map((run) => (run.op === "del" ? `[-${run.text}-]` : run.op === "add" ? `{+${run.text}+}` : run.text)).join(" ");
const runSpans = (h, runs) => runs.flatMap((run, index) => [index ? " " : null,
  h(run.op === "del" ? "del" : run.op === "add" ? "ins" : "span", { "data-op": run.op }, run.text)]).filter((part) => part !== null);

// ---------- the request ----------

const askedBy = (items, side) => items.filter((item) => isObject(item[side])).slice()
  .sort((x, y) => (Number.isInteger(x[`i${side}`]) ? x[`i${side}`] : Infinity) - (Number.isInteger(y[`i${side}`]) ? y[`i${side}`] : Infinity))
  .map((item) => item.qid);

// The fewest shared questions B must move so it asks the shared questions in A's relative order: everything outside
// one longest run that is already in A's order. Of several such runs it keeps the one that starts earliest in B and,
// from each kept question, continues with the earliest next one. Returns { shared, move: [qids in B's order] }.
function orderMoves(items) {
  const aIds = askedBy(items, "a"), bIds = askedBy(items, "b");
  const inA = new Map(aIds.map((qid, index) => [qid, index]));
  const shared = bIds.filter((qid) => inA.has(qid));
  const seq = shared.map((qid) => inA.get(qid));
  const best = seq.map(() => 1);
  for (let i = seq.length - 1; i >= 0; i--) for (let k = i + 1; k < seq.length; k++) if (seq[k] > seq[i]) best[i] = Math.max(best[i], best[k] + 1);
  const keep = new Set();
  let length = Math.max(0, ...best), at = best.indexOf(length);
  while (at >= 0 && length > 0) {
    keep.add(at);
    length -= 1;
    const from = at;
    at = seq.findIndex((value, k) => k > from && value > seq[from] && best[k] === length);
  }
  return { aIds, bIds, shared, move: shared.filter((_, index) => !keep.has(index)) };
}

const KIND = { choice: "options", score: "levels", noul: "criteria" };

// What differs for one question id, as short phrases ([] for no change).
function differences(item) {
  if (isObject(item.a) && !isObject(item.b)) return ["only A"];
  if (isObject(item.b) && !isObject(item.a)) return ["only B"];
  if (!both(item)) return [];
  if (typeOf(item.a) !== typeOf(item.b)) return ["type changed"];
  const out = [];
  if (item.ia !== item.ib) out.push("at another position");
  if (!deepEqual(item.a.instructions, item.b.instructions)) out.push("instructions reworded");
  const kind = KIND[item.a.type] || "criteria";
  if (!deepEqual(item.a.criteria, item.b.criteria)) out.push(`${kind} changed`);
  else if (item.a.type === "choice" && keyOrderDiffers(item.a, item.b)) out.push("options reordered");
  if (!deepEqual(withoutCore(item.a), withoutCore(item.b))) out.push("other fields changed");
  return out;
}

const modelOf = (variant, ctx) => (typeof variant?.model === "string" && variant.model.trim() ? variant.model.trim() : ctx.data?.current_model || "");
const modelLabel = (variant, ctx) => {
  const typed = typeof variant?.model === "string" ? variant.model.trim() : "";
  if (typed) return `“${typed}”`;
  return ctx.data?.current_model ? `“${ctx.data.current_model}” (the current model)` : "the current model";
};

// The checklist: { errors: [text] } when an editor does not parse, else { lines: [{ key, text }] }.
function checklist(ctx) {
  const variants = Array.isArray(ctx.data?.variants) ? ctx.data.variants : [];
  const errors = variants.filter((variant) => variant?.error).map((variant) => {
    const message = oneLine(variant.error);
    return `${message}${/[.!?]$/.test(message) ? "" : "."} Fix variant ${variant.name}'s editor before a run.`;
  });
  if (errors.length) return { errors };
  const [a, b] = variants;
  const items = itemsOf(ctx);
  const lines = [];
  const add = (key, ids, text) => { if (ids.length) lines.push({ key, text: `${text}: ${ids.join(", ")}` }); };
  if (modelOf(a, ctx) !== modelOf(b, ctx)) lines.push({ key: "model", text: `Models differ: A uses ${modelLabel(a, ctx)}, B uses ${modelLabel(b, ctx)}` });
  if (b?.perturb) lines.push({ key: "rows", text: `B's rows are rewritten: sent ${ctx.data?.perturbs?.[b.perturb] || b.perturb}` });
  if (b?.average === true) lines.push({ key: "orders", text: "B asks each Choice question in both option orders and averages them" });
  const onlyA = items.filter((item) => isObject(item.a) && !isObject(item.b)).map((item) => item.qid);
  const onlyB = items.filter((item) => isObject(item.b) && !isObject(item.a)).map((item) => item.qid);
  add("only_a", onlyA, `Only A asks ${plural(onlyA.length, "question")}`);
  add("only_b", onlyB, `Only B asks ${plural(onlyB.length, "question")}`);
  const kept = items.filter(both);
  const retyped = kept.filter((item) => typeOf(item.a) !== typeOf(item.b));
  add("retyped", retyped.map((item) => item.qid), "Type changed, so a run does not compare it");
  const same = kept.filter((item) => typeOf(item.a) === typeOf(item.b));
  add("reworded", same.filter((item) => !deepEqual(item.a.instructions, item.b.instructions)).map((item) => item.qid), "Instructions reworded");
  add("criteria", same.filter((item) => !deepEqual(item.a.criteria, item.b.criteria)).map((item) => item.qid), "Options or levels changed");
  add("reordered", same.filter((item) => item.a.type === "choice" && deepEqual(item.a.criteria, item.b.criteria) && keyOrderDiffers(item.a, item.b))
    .map((item) => item.qid), "Options listed in another order");
  add("other", same.filter((item) => !deepEqual(withoutCore(item.a), withoutCore(item.b))).map((item) => item.qid), "Other fields changed");
  const { move } = orderMoves(items);
  add("order", move, "B asks shared questions in another order; to match A, move");
  return { lines };
}

// ---------- shared controls ----------

function picker(h, api, candidates, current, label, tag = (item) => "") {
  return h("label", {}, `${label} `, h("select", { class: "input sm", "aria-label": label, "data-pick": "question",
    onchange: (event) => { api.state.qid = event.target.value; api.redraw(); } },
  candidates.map((item) => h("option", { value: item.qid, selected: item.qid === current.qid }, `${item.qid}${tag(item)}`))));
}
const copyButton = (h, api, key, text, label) => h("button", { class: "btn sm ghost", "data-copy": key, onclick: () => { api.copy(text); api.toast(`${label} copied.`); } }, `Copy ${label.toLowerCase()}`);
const table = (h, head, rows, rowAttrs = () => ({})) => h("table", { class: "table lab-table" },
  h("thead", {}, h("tr", {}, head.map((label) => h("th", {}, label)))),
  h("tbody", {}, rows.map((row, index) => h("tr", rowAttrs(row, index), row.cells.map((cell) => (cell && typeof cell === "object" && cell.tag ? cell : h("td", {}, String(cell))))))));
const choose = (candidates, state, preferred) => candidates.find((item) => item.qid === state.qid) || candidates.find(preferred) || candidates[0];

// ---------- criteria tables ----------

function criteriaTable(item) {
  const type = item.a.type;
  if (type === "choice") {
    const ca = choiceCriteria(item.a), cb = choiceCriteria(item.b);
    const ka = Object.keys(ca), kb = Object.keys(cb);
    const keys = [...ka, ...kb.filter((key) => !ka.includes(key))];
    const rows = keys.map((key) => {
      const pa = ka.indexOf(key), pb = kb.indexOf(key);
      let status;
      if (pb < 0) status = "only A";
      else if (pa < 0) status = "only B";
      else {
        const parts = [];
        if (!deepEqual(ca[key], cb[key])) parts.push("reworded");
        if (pb !== pa) parts.push(pb > pa ? `moved down ${pb - pa}` : `moved up ${pa - pb}`);
        status = parts.length ? parts.join(", ") : "same";
      }
      return { key, cells: [key, pa < 0 ? "" : pa + 1, pa < 0 ? "" : describe(ca[key]), pb < 0 ? "" : pb + 1, pb < 0 ? "" : describe(cb[key]), status],
        reworded: pa >= 0 && pb >= 0 && !deepEqual(ca[key], cb[key]) ? [describe(ca[key]), describe(cb[key])] : null };
    });
    return { head: ["Option", "A #", "A description", "B #", "B description", "Status"], rows, note: null };
  }
  if (type === "score") {
    const la = scoreLevels(item.a), lb = scoreLevels(item.b);
    const size = Math.max(la.length, lb.length);
    const rows = Array.from({ length: size }, (_, level) => ({ key: String(level), cells: [level, level < la.length ? describe(la[level]) : "",
      level < lb.length ? describe(lb[level]) : "", level >= lb.length ? "only A" : level >= la.length ? "only B" : deepEqual(la[level], lb[level]) ? "same" : "changed"] }));
    let note = null;
    if (la.length !== lb.length) {
      const shorter = Math.min(la.length, lb.length);
      let first = 0;
      while (first < shorter && deepEqual(la[first], lb[first])) first += 1;
      const kept = shorter === 0 ? "" : shorter === 1 ? "; level 0 keeps its number" : `; levels 0 to ${shorter - 1} keep their numbers`;
      note = first >= shorter
        ? `B ${lb.length > la.length ? "adds" : "drops"} ${plural(Math.abs(lb.length - la.length), "level")} at the end${kept}.`
        : `A has ${la.length} levels and B has ${lb.length}: from level ${first} on, the same number names a different level, so compare Score answers by meaning, not by number.`;
    }
    return { head: ["Level", "A", "B", "Status"], rows, note };
  }
  const ca = isObject(item.a.criteria) ? item.a.criteria : null, cb = isObject(item.b.criteria) ? item.b.criteria : null;
  if (!ca && !cb) return { head: ["Answer", "A", "B", "Status"], rows: [], note: "Neither variant describes yes and no for this question." };
  const rows = ["true", "false"].map((key) => {
    const va = ca && key in ca ? describe(ca[key]) : "", vb = cb && key in cb ? describe(cb[key]) : "";
    return { key, cells: [key === "true" ? "yes (true)" : "no (false)", va, vb, va === vb ? "same" : !va ? "only B" : !vb ? "only A" : "changed"] };
  });
  return { head: ["Answer", "A", "B", "Status"], rows, note: null };
}

export default definePack({
  id: "compare-variant-panels",
  surface: "workbench.compare.variants",
  title: "Compare setup panels",
  about: "Panels that set Compare's variants A and B side by side before a run is paid for: questions, instruction wording, options and levels, JSON, order, request size and a checklist of every difference. They read authored questions and settings only, copy nothing beyond them, and never start a run.",
  features: [
    { id: "question_diff", kind: "panel", title: "Questions of A and B side by side",
      improvements: [
        { id: "table", title: "One row per question id with its position and type in A and in B" },
        { id: "differences", title: "List every difference of each question: position, type, instructions, options or levels, other fields" },
        { id: "shown_only", title: "Limit the side-by-side table to the questions the Lab filters show" },
        { id: "copy", title: "Copy the side-by-side table as tab-separated text" },
      ],
      render: (h, ctx, api) => {
        const all = itemsOf(ctx);
        if (!all.length) return h("p", { class: "faint" }, "Neither variant has questions that parse.");
        const onlyShown = api.state.shownOnly === true;
        const list = onlyShown ? shownOf(ctx) : all;
        const pos = (index) => (Number.isInteger(index) ? index + 1 : "");
        const rows = list.map((item) => {
          const diff = differences(item);
          return { qid: item.qid, diff, cells: [item.qid, isObject(item.a) ? `${pos(item.ia)} · ${typeOf(item.a)}` : NOT_ASKED,
            isObject(item.b) ? `${pos(item.ib)} · ${typeOf(item.b)}` : NOT_ASKED, diff.length ? diff.join(", ") : "no change"] };
        });
        const copyRows = [["Question", "A position", "A type", "B position", "B type", "Differences"],
          ...list.map((item) => [item.qid, pos(isObject(item.a) ? item.ia : null), isObject(item.a) ? typeOf(item.a) : "",
            pos(isObject(item.b) ? item.ib : null), isObject(item.b) ? typeOf(item.b) : "", differences(item).join(", ") || "no change"])];
        return h("div", {},
          h("label", {}, h("input", { type: "checkbox", checked: onlyShown, "data-toggle": "shown",
            onchange: (event) => { api.state.shownOnly = !!event.target.checked; api.redraw(); } }), " Only the questions the Lab filters show"),
          h("p", { class: "faint" }, onlyShown ? `${list.length} of ${plural(all.length, "question")} shown. A run still sends every question.`
            : `${plural(all.length, "question")}: a run sends every one, whatever a filter hides.`),
          list.length ? table(h, ["Question", "A (position · type)", "B (position · type)", "Differences"], rows,
            (row) => ({ "data-qid": row.qid, "data-differences": row.diff.join("|") })) : h("p", { class: "faint" }, "No question is shown."),
          copyButton(h, api, "questions", tsv(copyRows), "Question table"));
      } },

    { id: "wording_diff", kind: "panel", title: "Instruction wording, A against B",
      improvements: [
        { id: "word_diff", title: "Choose a question both variants ask and mark the words B removes from A's instructions and the words it adds" },
        { id: "ignore_case", title: "Ignore letter case and punctuation when matching words" },
        { id: "stats", title: "Count the words in each variant, the words removed and added, and the character edits" },
        { id: "minor_only", title: "Say when the instructions differ only in letter case, spacing or punctuation" },
        { id: "step", title: "Step to the previous or next question with reworded instructions" },
        { id: "copy", title: "Copy one question's wording diff as text with [-removed-] and {+added+} marks" },
      ],
      render: (h, ctx, api) => {
        const candidates = itemsOf(ctx).filter(both);
        if (!candidates.length) return h("p", { class: "faint" }, "No question is asked by both A and B.");
        const reworded = (item) => instructionsText(item.a) !== instructionsText(item.b);
        const current = choose(candidates, api.state, reworded);
        const loose = api.state.ignore === true;
        const ta = instructionsText(current.a), tb = instructionsText(current.b);
        const runs = wordRuns(ta, tb, loose);
        const removed = runs.filter((run) => run.op === "del").reduce((sum, run) => sum + run.count, 0);
        const added = runs.filter((run) => run.op === "add").reduce((sum, run) => sum + run.count, 0);
        const at = candidates.indexOf(current);
        const previous = candidates.slice(0, at).reverse().find(reworded), next = candidates.slice(at + 1).find(reworded);
        const go = (item) => () => { api.state.qid = item.qid; api.redraw(); };
        const minor = ta !== tb && looseText(ta) === looseText(tb);
        return h("div", { "data-qid": current.qid },
          h("div", { class: "lab-row" },
            picker(h, api, candidates, current, "Question", (item) => (reworded(item) ? " · reworded" : "")),
            h("button", { class: "btn sm ghost", "data-step": "previous", disabled: !previous, onclick: previous ? go(previous) : undefined }, "Previous reworded"),
            h("button", { class: "btn sm ghost", "data-step": "next", disabled: !next, onclick: next ? go(next) : undefined }, "Next reworded"),
            h("label", {}, h("input", { type: "checkbox", checked: loose, "data-toggle": "ignore",
              onchange: (event) => { api.state.ignore = !!event.target.checked; api.redraw(); } }), " Ignore case and punctuation")),
          h("div", { class: "lab-row" },
            h("div", { "data-side": "A" }, h("strong", {}, "A: "), ta || "(no instructions)"),
            h("div", { "data-side": "B" }, h("strong", {}, "B: "), tb || "(no instructions)")),
          ta === tb ? h("p", { class: "faint", "data-same": "true" }, "A and B use the same instructions.")
            : h("p", { "data-diff": "words" }, runSpans(h, runs)),
          minor ? h("p", { class: "warn", "data-minor": "true" }, "The wording differs only in letter case, spacing or punctuation.") : null,
          h("ul", { "data-stats": "true" },
            h("li", {}, `Words: ${words(ta).length} in A, ${words(tb).length} in B`),
            h("li", {}, `${removed} removed, ${added} added${loose ? " (ignoring case and punctuation)" : ""}`),
            h("li", {}, `${plural(levenshtein(ta, tb), "character edit")}`)),
          copyButton(h, api, "wording", `${current.qid}: ${markup(runs)}`, "Wording diff"));
      } },

    { id: "criteria_table", kind: "panel", title: "Options and levels of A and B",
      improvements: [
        { id: "choice_table", title: "Table a Choice question's options with A's and B's position, description and what changed" },
        { id: "description_diff", title: "Mark the words B changes in each reworded option description" },
        { id: "score_table", title: "Table a Score question's levels by number with A's and B's description" },
        { id: "score_shift", title: "Warn when B inserts or removes a level so later level numbers change meaning" },
        { id: "noul_table", title: "Table a Noul question's yes and no descriptions in A and B" },
        { id: "copy", title: "Copy the options or levels table as tab-separated text" },
      ],
      render: (h, ctx, api) => {
        const all = itemsOf(ctx).filter(both);
        const candidates = all.filter((item) => typeOf(item.a) === typeOf(item.b) && ["choice", "score", "noul"].includes(item.a.type));
        const retyped = all.filter((item) => typeOf(item.a) !== typeOf(item.b)).map((item) => item.qid);
        const leftOut = retyped.length ? h("p", { class: "faint" }, `Left out because the type changes: ${retyped.join(", ")}.`) : null;
        if (!candidates.length) return h("div", {}, h("p", { class: "faint" }, "No Choice, Score or Noul question is asked by both A and B with the same type."), leftOut);
        const changed = (item) => !deepEqual(item.a.criteria, item.b.criteria) || (item.a.type === "choice" && keyOrderDiffers(item.a, item.b));
        const current = choose(candidates, api.state, changed);
        const { head, rows, note } = criteriaTable(current);
        const body = rows.map((row) => ({ ...row, cells: row.cells.map((cell, index) => (index === 5 && row.reworded
          ? h("td", {}, String(cell), " ", h("span", { "data-description-diff": row.key }, runSpans(h, wordRuns(row.reworded[0], row.reworded[1]))))
          : cell)) }));
        return h("div", { "data-qid": current.qid, "data-type": current.a.type },
          picker(h, api, candidates, current, "Question", (item) => ` · ${item.a.type}${changed(item) ? " · changed" : ""}`),
          rows.length ? table(h, head, body, (row) => ({ "data-key": row.key })) : null,
          note ? h("p", { class: rows.length ? "warn" : "faint", "data-note": "true" }, note) : null,
          rows.length ? copyButton(h, api, "criteria", tsv([head, ...rows.map((row) => row.cells)]), "Criteria table") : null,
          leftOut);
      } },

    { id: "json_diff", kind: "panel", title: "Question JSON, A against B",
      improvements: [
        { id: "lines", title: "Show one question's JSON as a line diff from A to B" },
        { id: "copy", title: "Copy one question's JSON diff in unified diff form" },
      ],
      render: (h, ctx, api) => {
        const candidates = itemsOf(ctx);
        if (!candidates.length) return h("p", { class: "faint" }, "Neither variant has questions that parse.");
        const lines = (question) => (isObject(question) ? JSON.stringify(question, null, 2).split("\n") : []);
        const current = choose(candidates, api.state, (item) => JSON.stringify(item.a ?? null) !== JSON.stringify(item.b ?? null));
        const steps = diffTokens(lines(current.a), lines(current.b));
        const text = steps.map((step) => (step.op === "del" ? `-${step.a}` : step.op === "add" ? `+${step.b}` : ` ${step.b}`));
        return h("div", { "data-qid": current.qid },
          picker(h, api, candidates, current, "Question", (item) => (JSON.stringify(item.a ?? null) !== JSON.stringify(item.b ?? null) ? " · differs" : "")),
          h("pre", { class: "lab-pre", "data-diff": "json" }, steps.map((step, index) => h("span", { "data-op": step.op }, `${text[index]}\n`))),
          copyButton(h, api, "json", [`--- A ${current.qid}`, `+++ B ${current.qid}`, ...text].join("\n"), "JSON diff"));
      } },

    { id: "order", kind: "panel", title: "Question order of A and B",
      improvements: [
        { id: "fewest_moves", title: "Set A's and B's question order side by side and name the fewest shared questions to move so B asks them in A's order" },
      ],
      render: (h, ctx) => {
        const items = itemsOf(ctx);
        if (!items.length) return h("p", { class: "faint" }, "Neither variant has questions that parse.");
        const { aIds, bIds, shared, move } = orderMoves(items);
        const size = Math.max(aIds.length, bIds.length);
        const rows = Array.from({ length: size }, (_, index) => ({ cells: [index + 1, aIds[index] ?? "",
          h("td", { "data-move": move.includes(bIds[index]) ? "true" : null }, bIds[index] === undefined ? "" : `${bIds[index]}${move.includes(bIds[index]) ? " (move)" : ""}`)] }));
        const verdict = shared.length < 2 ? "A and B share fewer than two questions, so their order cannot differ."
          : move.length ? `B asks ${shared.length} shared questions; moving ${plural(move.length, "question")} (${move.join(", ")}) puts them in A's order.`
            : `B asks the ${shared.length} shared questions in A's order.`;
        return h("div", {}, table(h, ["#", "A", "B"], rows, (_, index) => ({ "data-position": String(index + 1) })),
          h("p", { "data-moves": String(move.length) }, verdict));
      } },

    { id: "size", kind: "panel", title: "Request size of A and B",
      improvements: [
        { id: "totals", title: "Compare A's and B's question count, options and levels, instruction words and UTF-8 bytes" },
        { id: "per_type", title: "Count A's and B's questions of each type" },
      ],
      render: (h, ctx) => {
        const items = itemsOf(ctx);
        const variants = Array.isArray(ctx.data?.variants) ? ctx.data.variants : [];
        const sides = ["a", "b"].map((side, index) => {
          const ids = askedBy(items, side);
          const byId = new Map(items.map((item) => [item.qid, item[side]]));
          const questions = ids.map((qid) => byId.get(qid));
          const object = Object.fromEntries(ids.map((qid) => [qid, byId.get(qid)]));
          return { error: variants[index]?.error || null, questions, totals: [questions.length, questions.reduce((sum, q) => sum + optionCount(q), 0),
            questions.reduce((sum, q) => sum + words(instructionsText(q)).length, 0), utf8Bytes(JSON.stringify(object))] };
        });
        const labels = ["Questions", "Choice options and Score levels", "Instruction words", "Questions JSON (UTF-8 bytes, compact)"];
        const keys = ["questions", "options", "words", "bytes"];
        const cell = (side, index) => (side.error ? "editor error" : String(side.totals[index]));
        const types = [...TYPES, ...[...new Set(items.flatMap((item) => [item.a, item.b]).filter(isObject).map(typeOf))].filter((type) => !TYPES.includes(type)).sort()];
        const typeRows = types.map((type) => [type, ...sides.map((side) => side.questions.filter((q) => typeOf(q) === type).length)]).filter((row) => row[1] || row[2]);
        return h("div", {},
          h("table", { class: "table lab-table", "data-table": "totals" },
            h("thead", {}, h("tr", {}, ["", "A", "B", "B − A"].map((label) => h("th", {}, label)))),
            h("tbody", {}, labels.map((label, index) => h("tr", { "data-total": keys[index] }, h("th", {}, label), h("td", { class: "num" }, cell(sides[0], index)),
              h("td", { class: "num" }, cell(sides[1], index)),
              h("td", { class: "num" }, sides.some((side) => side.error) ? "" : signed(sides[1].totals[index] - sides[0].totals[index])))))),
          typeRows.length ? h("table", { class: "table lab-table", "data-table": "types" },
            h("thead", {}, h("tr", {}, ["Type", "A", "B"].map((label) => h("th", {}, label)))),
            h("tbody", {}, typeRows.map((row) => h("tr", { "data-type": row[0] }, row.map((value, index) => h(index ? "td" : "th", { class: index ? "num" : null }, String(value))))))) : null,
          h("p", { class: "faint" }, "Sizes of the authored questions only: they are not a spend estimate, which the Run button's preview gives."));
      } },

    { id: "checklist", kind: "panel", title: "Before you pay: what differs",
      improvements: [
        { id: "items", title: "List every difference between A and B as a checklist: model, row rewrite, both orders, questions, types, wording, options and order" },
        { id: "parse_errors", title: "Put an editor's JSON error first and hold the checklist until it parses" },
        { id: "tick", title: "Tick each difference off as reviewed and count the ones left" },
        { id: "reset", title: "Clear the ticks when either editor's text or a setting changes" },
        { id: "copy", title: "Copy the checklist as a Markdown task list with its ticks" },
      ],
      render: (h, ctx, api) => {
        const result = checklist(ctx);
        if (result.errors) {
          return h("div", { "data-errors": String(result.errors.length) }, result.errors.map((text) => h("p", { class: "warn", role: "alert" }, text)));
        }
        const { lines } = result;
        // The ticks belong to this exact setup: both editors' text, models, B's rows and ask settings and the current model.
        const signature = JSON.stringify([(Array.isArray(ctx.data?.variants) ? ctx.data.variants : []).map((variant) => [variant?.text, variant?.model,
          variant?.perturb, variant?.average]), ctx.data?.current_model ?? null]);
        if (api.state.signature !== signature) { api.state.signature = signature; api.state.ticks = {}; }
        const ticks = api.state.ticks;
        if (!lines.length) return h("p", { "data-nothing": "true" }, "A and B send the same request with the same settings: a run would only show how much answers vary between calls.");
        const done = lines.filter((line) => ticks[line.key]).length;
        const markdown = ["# Compare setup checklist", "", ...lines.map((line) => `- [${ticks[line.key] ? "x" : " "}] ${line.text}`)].join("\n") + "\n";
        return h("div", {},
          h("ul", { class: "lab-checklist" }, lines.map((line) => h("li", { "data-key": line.key },
            h("label", {}, h("input", { type: "checkbox", checked: !!ticks[line.key], "data-tick": line.key,
              onchange: (event) => { ticks[line.key] = !!event.target.checked; api.redraw(); } }), ` ${line.text}`)))),
          h("p", { class: done === lines.length ? "" : "faint", "data-progress": `${done}/${lines.length}` },
            done === lines.length ? `All ${plural(lines.length, "difference")} reviewed.` : `${done} of ${plural(lines.length, "difference")} reviewed.`),
          copyButton(h, api, "checklist", markdown, "Checklist"),
          h("p", { class: "faint" }, "Ticks last until the questions or settings change. Nothing here starts a run."));
      } },
  ],
});
