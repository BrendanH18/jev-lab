// Panels for the user's own Bulk run ("workbench.bulk.results"; contract in static/js/lab/surfaces/workbench-bulk.js):
// a per-question answer distribution, a histogram of each question's probability or confidence, a cross-tab of two
// questions' answers, labels against answers for the labeled rows, and the slowest (or costliest) calls, plus a few run
// metrics. Read-only: every number is arithmetic on the shown rows of the run the current user made in this page
// session; held-out rows carry no answers or labels, so they never appear in an answer table. The only page action is
// Go to row (focusRow), pressed by the user. A cut typed into the histogram is advisory and never changes Policy.
import { compareText, definePack, formatValue, toNumber } from "../../kit.js";
import { median } from "../../lib/math.js";
import { truncate } from "../../lib/text.js";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const pct = (value) => formatValue(finite(value), "percent");
const two = (value) => (finite(value) === null ? "—" : value.toFixed(2));
const usd = (value) => (finite(value) === null ? "—" : `$${Number(value.toPrecision(3))}`);
const dataOf = (ctx) => (isObject(ctx?.data) ? ctx.data : {});
const isItem = (item) => isObject(item) && Number.isInteger(item.index);
function shownOf(ctx) {
  try { return list(ctx?.shown?.()).filter(isItem); } catch { return []; }
}
const short = (text) => truncate(String(text ?? ""), 70) ?? "";
const EPS = 1e-9;

// The question ids of the run in the table's order, with their types.
function questionList(ctx) {
  const data = dataOf(ctx);
  const questions = isObject(data.questions) ? data.questions : {};
  const ids = list(data.questionIds).length ? list(data.questionIds) : Object.keys(questions);
  return ids.filter((id) => typeof id === "string").map((id) => ({ id, type: questions[id]?.type || null, criteria: questions[id]?.criteria }));
}
const classed = (ctx) => questionList(ctx).filter((question) => ["choice", "score", "noul"].includes(question.type));
const answerOf = (item, qid) => (isObject(item.answers) && isObject(item.answers[qid]) ? item.answers[qid] : null);
const picked = (item, qid) => {
  const answer = answerOf(item, qid);
  return answer && typeof answer.predicted === "string" ? answer.predicted : null;
};
const validLabel = (answer) => (answer && answer.labelValid === true && typeof answer.label === "string" ? answer.label : null);

// The classes of a question in a readable order: its options as written (Score levels, yes/no), then any others.
function classOrder(question, seen) {
  let known = [];
  if (question.type === "choice" && isObject(question.criteria)) known = Object.keys(question.criteria);
  else if (question.type === "score" && Array.isArray(question.criteria)) known = question.criteria.map((_, level) => String(level));
  else if (question.type === "noul") known = ["yes", "no"];
  const extra = [...new Set(seen)].filter((value) => !known.includes(value)).sort(question.type === "score" ? (a, b) => Number(a) - Number(b) || compareText(a, b) : compareText);
  return [...known, ...extra];
}
const presentOrder = (question, values) => classOrder(question, values).filter((value) => values.includes(value));

function pickQuestion(ctx, state, key, pool, fallback = dataOf(ctx).calQuestion) {
  return pool.find((question) => question.id === state[key]) || pool.find((question) => question.id === fallback) || pool[0] || null;
}
const questionSelect = (h, api, key, pool, current, name, label = "Question ") => h("label", {}, label,
  h("select", { "data-action": name, onchange: (event) => { api.state[key] = event.target.value; api.redraw(); } },
    pool.map((question) => h("option", { value: question.id, selected: question.id === current.id }, question.id))));

// Runs a page action the user just pressed and reports a refusal as an error toast.
function attempt(api, run) {
  try {
    const result = run();
    if (result && typeof result.then === "function") result.then(null, (error) => api.toast(error?.message || String(error), "error"));
  } catch (error) { api.toast(error?.message || String(error), "error"); }
}
// A row as text: its input's text when it has one, else the table's text (JSON for other objects).
const rowText = (item) => short(typeof item.input === "string" ? item.input : isObject(item.input) && typeof item.input.text === "string" ? item.input.text
  : typeof item.text === "string" ? item.text : JSON.stringify(item.input) ?? "");
const rowList = (h, ctx, api, name, rows, extra = () => "") => h("ul", { "data-list": name }, rows.map((item) => h("li", { "data-row": item.position },
  `#${item.position} `, h("span", {}, rowText(item)), extra(item), " ",
  h("button", { class: "btn sm ghost", "data-go-row": item.position, onclick: () => attempt(api, () => ctx.actions.focusRow(item.index)) }, "Go to row"))));
const noRun = (h) => h("p", { class: "faint" }, "Run Bulk first: this panel reads the answers of your own run.");

// ---------- answer distribution ----------

function answersPanel(h, ctx, api) {
  if (!dataOf(ctx).run) return noRun(h);
  const pool = classed(ctx);
  const question = pickQuestion(ctx, api.state, "question", pool);
  if (!question) return h("p", { class: "faint" }, "No Choice, Score or Noul question in this run.");
  const rows = shownOf(ctx).filter((item) => picked(item, question.id) !== null);
  const labels = shownOf(ctx).map((item) => validLabel(answerOf(item, question.id))).filter((value) => value !== null);
  const invalid = shownOf(ctx).filter((item) => answerOf(item, question.id)?.labelValid === false).length;
  let classes = classOrder(question, rows.map((item) => picked(item, question.id))).map((value, order) => {
    const members = rows.filter((item) => picked(item, question.id) === value);
    const ps = members.map((item) => finite(answerOf(item, question.id).p)).filter((p) => p !== null);
    return { value, order, count: members.length, meanP: ps.length ? ps.reduce((sum, p) => sum + p, 0) / ps.length : null,
      labels: labels.filter((label) => label === value).length };
  });
  if (api.state.largestFirst) classes = classes.slice().sort((a, b) => b.count - a.count || a.order - b.order);
  const open = classes.find((entry) => entry.value === api.state.open && entry.count > 0) || null;
  return h("div", {},
    h("div", { class: "chips lab-row" }, questionSelect(h, api, "question", pool, question, "answers-question"),
      h("button", { class: "btn sm ghost", "data-action": "answers-largest", "aria-pressed": api.state.largestFirst ? "true" : "false",
        onclick: () => { api.state.largestFirst = !api.state.largestFirst; api.redraw(); } }, "Largest first")),
    h("table", { class: "table", "data-table": "answers" },
      h("thead", {}, h("tr", {}, ["Answer", "Rows", "Share", "Mean probability", "Labeled this option"].map((name) => h("th", {}, name)))),
      h("tbody", {}, classes.map((entry) => h("tr", { "data-option": entry.value },
        h("td", {}, entry.count ? h("button", { class: "btn sm ghost", "data-open-option": entry.value,
          onclick: () => { api.state.open = api.state.open === entry.value ? null : entry.value; api.redraw(); } }, entry.value) : entry.value),
        h("td", { class: "num" }, String(entry.count)), h("td", { class: "num" }, pct(rows.length ? entry.count / rows.length : null)),
        h("td", { class: "num" }, two(entry.meanP)), h("td", { class: "num" }, String(entry.labels)))))),
    h("p", { "data-note": "answers" }, `${plural(rows.length, "answered row")} shown; ${plural(labels.length, "valid label")}${invalid ? `; ${invalid} that ${invalid === 1 ? "fits" : "fit"} no option` : ""}.`),
    open ? h("div", {}, h("p", {}, `Rows answered ${open.value}:`), rowList(h, ctx, api, "answer-rows", rows.filter((item) => picked(item, question.id) === open.value))) : "");
}

// ---------- probability / confidence histogram ----------

const BINS = [5, 10, 20];
const binOf = (value, bins) => Math.min(bins - 1, Math.max(0, Math.floor(value * bins + EPS)));
const edge = (value, bins) => (bins > 10 ? value.toFixed(2) : value.toFixed(1));

function histogramPanel(h, ctx, api) {
  if (!dataOf(ctx).run) return noRun(h);
  const pool = questionList(ctx).filter((question) => question.type);
  const question = pickQuestion(ctx, api.state, "question", pool);
  if (!question) return h("p", { class: "faint" }, "No answered question in this run.");
  const signal = api.state.signal === "confidence" ? "confidence" : "p";
  const bins = BINS.includes(Number(api.state.bins)) ? Number(api.state.bins) : 10;
  const answered = shownOf(ctx).filter((item) => answerOf(item, question.id));
  const valued = answered.map((item) => ({ item, answer: answerOf(item, question.id), value: finite(answerOf(item, question.id)[signal]) }))
    .filter((entry) => entry.value !== null && entry.value >= 0 && entry.value <= 1);
  const missing = answered.length - valued.length;
  const table = Array.from({ length: bins }, (_, index) => ({ index, members: [] }));
  for (const entry of valued) table[binOf(entry.value, bins)].members.push(entry);
  const most = Math.max(1, ...table.map((bin) => bin.members.length));
  const cut = toNumber(api.state.cut);
  const cutText = cut !== null && cut >= 0 && cut <= 1 ? cut : null;
  const above = cutText === null ? 0 : valued.filter((entry) => entry.value + EPS >= cutText).length;
  const values = valued.map((entry) => entry.value);
  const open = Number.isInteger(api.state.open) && api.state.open < bins ? table[api.state.open] : null;
  const name = signal === "p" ? "probability" : "confidence";
  return h("div", {},
    h("div", { class: "chips lab-row" }, questionSelect(h, api, "question", pool, question, "histogram-question"),
      h("label", {}, "Signal ", h("select", { "data-action": "histogram-signal", onchange: (event) => { api.state.signal = event.target.value; api.state.open = null; api.redraw(); } },
        [["p", "Probability of the answer"], ["confidence", "Confidence field"]].map(([key, label]) => h("option", { value: key, selected: key === signal }, label)))),
      h("label", {}, "Bins ", h("select", { "data-action": "histogram-bins", onchange: (event) => { api.state.bins = Number(event.target.value); api.state.open = null; api.redraw(); } },
        BINS.map((count) => h("option", { value: count, selected: count === bins }, String(count))))),
      h("label", {}, "Cut ", h("input", { type: "number", min: 0, max: 1, step: 0.01, "data-action": "histogram-cut", value: api.state.cut ?? "",
        oninput: (event) => { api.state.cut = String(event.target.value ?? ""); api.redraw(); } }))),
    valued.length ? h("table", { class: "table", "data-table": "histogram" },
      h("thead", {}, h("tr", {}, [`${name[0].toUpperCase()}${name.slice(1)}`, "Answers", "", "Labeled that agree"].map((label) => h("th", {}, label)))),
      h("tbody", {}, table.map((bin) => {
        const scored = bin.members.filter((entry) => entry.answer.agrees === true || entry.answer.agrees === false);
        const agree = scored.filter((entry) => entry.answer.agrees === true).length;
        return h("tr", { "data-bin": bin.index },
          h("td", { class: "mono" }, `${edge(bin.index / bins, bins)}–${edge((bin.index + 1) / bins, bins)}`),
          h("td", { class: "num" }, bin.members.length ? h("button", { class: "btn sm ghost", "data-open-bin": bin.index,
            onclick: () => { api.state.open = api.state.open === bin.index ? null : bin.index; api.redraw(); } }, String(bin.members.length)) : "0"),
          h("td", {}, h("span", { class: "lab-bar", "data-width": Math.round((bin.members.length / most) * 100), style: `display:inline-block;height:0.7em;background:currentColor;width:${Math.round((bin.members.length / most) * 100)}%` })),
          h("td", { class: "num" }, scored.length ? `${agree}/${scored.length}` : "—"));
      }))) : h("p", { class: "faint" }, `No shown answer to ${question.id} carries a ${name}.`),
    valued.length ? h("p", { "data-note": "summary" }, `${plural(valued.length, "answer")}; median ${two(median(values))}; ${values.filter((value) => value < 0.5).length} under 0.50.`) : "",
    missing ? h("p", { "data-note": "missing" }, `${plural(missing, "answer")} ${missing === 1 ? "carries" : "carry"} no ${name}.`) : "",
    cutText !== null && valued.length ? h("p", { "data-note": "cut" }, `${above} of ${plural(valued.length, "answer")} (${pct(above / valued.length)}) at or above ${cutText} — advisory; Policy's gates are unchanged.`) : "",
    open && open.members.length ? h("div", {}, h("p", {}, `Rows with a ${name} of ${edge(open.index / bins, bins)}–${edge((open.index + 1) / bins, bins)}:`),
      rowList(h, ctx, api, "bin-rows", open.members.map((entry) => entry.item), (item) => ` (${two(finite(answerOf(item, question.id)[signal]))})`)) : "");
}

// ---------- cross-tab ----------

const MODES = [["count", "Counts"], ["row", "Row shares"], ["column", "Column shares"]];

// Cramér's V of a table of counts (rows × columns, every margin nonzero): √(χ² / (n · (min(r, c) − 1))).
function cramersV(counts) {
  const rows = counts.map((row) => row.reduce((sum, value) => sum + value, 0));
  const columns = counts[0].map((_, column) => counts.reduce((sum, row) => sum + row[column], 0));
  const n = rows.reduce((sum, value) => sum + value, 0);
  const k = Math.min(rows.length, columns.length) - 1;
  if (!n || k < 1) return null;
  let chi = 0;
  counts.forEach((row, r) => row.forEach((observed, c) => {
    const expected = (rows[r] * columns[c]) / n;
    chi += (observed - expected) ** 2 / expected;
  }));
  return Math.sqrt(chi / (n * k));
}

function crossPanel(h, ctx, api) {
  if (!dataOf(ctx).run) return noRun(h);
  const pool = classed(ctx);
  if (pool.length < 2) return h("p", { class: "faint" }, "A cross-tab needs two Choice, Score or Noul questions in the run.");
  const rowQ = pool.find((question) => question.id === api.state.rows) || pool[0];
  const colQ = pool.find((question) => question.id === api.state.columns) || pool.find((question) => question.id !== rowQ.id);
  const mode = MODES.some(([key]) => key === api.state.mode) ? api.state.mode : "count";
  const controls = h("div", { class: "chips lab-row" },
    questionSelect(h, api, "rows", pool, rowQ, "cross-rows", "Rows "), questionSelect(h, api, "columns", pool, colQ, "cross-columns", "Columns "),
    h("button", { class: "btn sm ghost", "data-action": "cross-swap", onclick: () => { api.state.rows = colQ.id; api.state.columns = rowQ.id; api.state.open = null; api.redraw(); } }, "Swap"),
    h("label", {}, "Show ", h("select", { "data-action": "cross-mode", onchange: (event) => { api.state.mode = event.target.value; api.redraw(); } },
      MODES.map(([key, label]) => h("option", { value: key, selected: key === mode }, label)))));
  if (rowQ.id === colQ.id) return h("div", {}, controls, h("p", { class: "faint" }, "Pick two different questions."));
  const both = shownOf(ctx).filter((item) => picked(item, rowQ.id) !== null && picked(item, colQ.id) !== null);
  if (!both.length) return h("div", {}, controls, h("p", { class: "faint" }, "No shown row answered both questions."));
  const rowValues = presentOrder(rowQ, both.map((item) => picked(item, rowQ.id)));
  const colValues = presentOrder(colQ, both.map((item) => picked(item, colQ.id)));
  const cell = (r, c) => both.filter((item) => picked(item, rowQ.id) === r && picked(item, colQ.id) === c);
  const counts = rowValues.map((r) => colValues.map((c) => cell(r, c).length));
  const rowTotals = counts.map((row) => row.reduce((sum, value) => sum + value, 0));
  const colTotals = colValues.map((_, c) => counts.reduce((sum, row) => sum + row[c], 0));
  const show = (r, c) => (mode === "row" ? pct(counts[r][c] / rowTotals[r]) : mode === "column" ? pct(counts[r][c] / colTotals[c]) : String(counts[r][c]));
  const v = cramersV(counts);
  const open = Array.isArray(api.state.open) && rowValues.includes(api.state.open[0]) && colValues.includes(api.state.open[1]) ? api.state.open : null;
  return h("div", {}, controls,
    h("table", { class: "table", "data-table": "cross" },
      h("thead", {}, h("tr", {}, h("th", {}, `${rowQ.id} \\ ${colQ.id}`), colValues.map((c) => h("th", { "data-column": c }, c)), h("th", {}, "Total"))),
      h("tbody", {}, rowValues.map((r, ri) => h("tr", { "data-value": r }, h("th", {}, r),
        colValues.map((c, ci) => h("td", { class: "num", "data-cell": `${r}|${c}` }, counts[ri][ci] ? h("button", { class: "btn sm ghost", "data-open-cell": `${r}|${c}`,
          onclick: () => { api.state.open = open && open[0] === r && open[1] === c ? null : [r, c]; api.redraw(); } }, show(ri, ci)) : show(ri, ci))),
        h("td", { class: "num" }, String(rowTotals[ri])))))),
    h("p", { "data-note": "association" }, v === null ? `Each question has one answer on these ${both.length} rows, so there is no association to measure.`
      : `Cramér's V ${two(v)} over ${plural(both.length, "row")} (0 = unrelated, 1 = one answer fixes the other). Descriptive only; small samples overstate it.`),
    open ? h("div", {}, h("p", {}, `Rows answered ${rowQ.id} ${open[0]} and ${colQ.id} ${open[1]}:`), rowList(h, ctx, api, "cell-rows", cell(open[0], open[1]))) : "");
}

// ---------- labels against answers ----------

function confusionPanel(h, ctx, api) {
  if (!dataOf(ctx).run) return noRun(h);
  const pool = classed(ctx);
  const question = pickQuestion(ctx, api.state, "question", pool);
  if (!question) return h("p", { class: "faint" }, "No Choice, Score or Noul question in this run.");
  const controls = h("div", { class: "chips lab-row" }, questionSelect(h, api, "question", pool, question, "confusion-question"),
    h("button", { class: "btn sm ghost", "data-action": "confusion-shares", "aria-pressed": api.state.shares ? "true" : "false",
      onclick: () => { api.state.shares = !api.state.shares; api.redraw(); } }, "Row shares"));
  const rows = shownOf(ctx).filter((item) => validLabel(answerOf(item, question.id)) !== null && picked(item, question.id) !== null);
  const invalid = shownOf(ctx).filter((item) => answerOf(item, question.id)?.labelValid === false).length;
  const invalidNote = invalid ? h("p", { "data-note": "invalid" }, `${plural(invalid, "label")} ${invalid === 1 ? "fits" : "fit"} no option and ${invalid === 1 ? "is" : "are"} left out.`) : "";
  if (!rows.length) return h("div", {}, controls, h("p", { class: "faint" }, `No shown row has a valid label for ${question.id} and an answer.`), invalidNote);
  const labelOf = (item) => validLabel(answerOf(item, question.id));
  const values = presentOrder(question, [...rows.map(labelOf), ...rows.map((item) => picked(item, question.id))]);
  const cell = (label, answer) => rows.filter((item) => labelOf(item) === label && picked(item, question.id) === answer);
  const counts = values.map((label) => values.map((answer) => cell(label, answer).length));
  const rowTotal = (r) => counts[r].reduce((sum, value) => sum + value, 0);
  const colTotal = (c) => counts.reduce((sum, row) => sum + row[c], 0);
  const mistakes = [];
  values.forEach((label, r) => values.forEach((answer, c) => { if (r !== c && counts[r][c]) mistakes.push({ label, answer, rows: cell(label, answer), order: r * values.length + c }); }));
  mistakes.sort((a, b) => b.rows.length - a.rows.length || a.order - b.order);
  const open = Array.isArray(api.state.open) && values.includes(api.state.open[0]) && values.includes(api.state.open[1]) ? api.state.open : null;
  return h("div", {}, controls,
    h("table", { class: "table", "data-table": "confusion" },
      h("thead", {}, h("tr", {}, h("th", {}, "Label \\ answer"), values.map((value) => h("th", { "data-column": value }, value)), h("th", {}, "Recall"))),
      h("tbody", {},
        values.map((label, r) => h("tr", { "data-label": label }, h("th", {}, label),
          values.map((answer, c) => {
            const text = api.state.shares ? pct(rowTotal(r) ? counts[r][c] / rowTotal(r) : null) : String(counts[r][c]);
            return h("td", { class: "num", "data-cell": `${label}|${answer}` }, counts[r][c] ? h("button", { class: "btn sm ghost", "data-open-cell": `${label}|${answer}`,
              onclick: () => { api.state.open = open && open[0] === label && open[1] === answer ? null : [label, answer]; api.redraw(); } }, text) : text);
          }),
          h("td", { class: "num", "data-recall": label }, pct(rowTotal(r) ? counts[r][r] / rowTotal(r) : null)))),
        h("tr", { "data-label": "precision" }, h("th", {}, "Precision"),
          values.map((value, c) => h("td", { class: "num", "data-precision": value }, pct(colTotal(c) ? counts[c][c] / colTotal(c) : null))), h("td", {}, "")))),
    h("p", { "data-note": "labeled" }, `${plural(rows.length, "labeled row")} shown; rows are your labels, columns the answers.`),
    invalidNote,
    mistakes.length ? h("ol", { "data-list": "mistakes" }, mistakes.slice(0, 5).map((entry) => h("li", { "data-mistake": `${entry.label}|${entry.answer}` },
      `labeled ${entry.label}, answered ${entry.answer}: ${entry.rows.length} (${entry.rows.map((item) => `#${item.position}`).join(", ")})`))) : h("p", { "data-note": "no-mistakes" }, "Every labeled row agrees."),
    open ? h("div", {}, h("p", {}, `Rows labeled ${open[0]} and answered ${open[1]}:`), rowList(h, ctx, api, "confusion-rows", cell(open[0], open[1]))) : "");
}

// ---------- slowest calls ----------

const TOPS = [5, 10, 20];
const RANKS = [["latency", "Latency", (meta) => finite(meta?.latency_ms)], ["cost", "Measured cost", (meta) => finite(meta?.cost_usd)],
  ["output", "Output tokens", (meta) => finite(meta?.output_tokens)]];

function slowestPanel(h, ctx, api) {
  if (!dataOf(ctx).run) return noRun(h);
  const top = TOPS.includes(Number(api.state.top)) ? Number(api.state.top) : 5;
  const rank = RANKS.find(([key]) => key === api.state.rank) || RANKS[0];
  const measured = shownOf(ctx).map((item, order) => ({ item, order, value: rank[2](item.meta) })).filter((entry) => entry.value !== null);
  if (!measured.length) return h("p", { class: "faint" }, "No shown row has that measurement.");
  const listed = measured.slice().sort((a, b) => b.value - a.value || a.order - b.order).slice(0, top);
  const totalAll = measured.reduce((sum, entry) => sum + entry.value, 0);
  const totalListed = listed.reduce((sum, entry) => sum + entry.value, 0);
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("label", {}, "Rank by ", h("select", { "data-action": "slowest-rank", onchange: (event) => { api.state.rank = event.target.value; api.redraw(); } },
        RANKS.map(([key, label]) => h("option", { value: key, selected: key === rank[0] }, label)))),
      h("label", {}, "List ", h("select", { "data-action": "slowest-top", onchange: (event) => { api.state.top = Number(event.target.value); api.redraw(); } },
        TOPS.map((count) => h("option", { value: count, selected: count === top }, String(count)))))),
    h("table", { class: "table", "data-table": "slowest" },
      h("thead", {}, h("tr", {}, ["#", "Row", "Latency", "Input tokens", "Output tokens", "Measured cost", ""].map((name) => h("th", {}, name)))),
      h("tbody", {}, listed.map(({ item }) => h("tr", { "data-row": item.position },
        h("td", { class: "num" }, String(item.position)), h("td", {}, rowText(item)),
        h("td", { class: "num" }, formatValue(finite(item.meta?.latency_ms), "ms")), h("td", { class: "num" }, formatValue(finite(item.meta?.input_tokens), "integer")),
        h("td", { class: "num" }, formatValue(finite(item.meta?.output_tokens), "integer")), h("td", { class: "num" }, usd(finite(item.meta?.cost_usd))),
        h("td", {}, h("button", { class: "btn sm ghost", "data-go-row": item.position, onclick: () => attempt(api, () => ctx.actions.focusRow(item.index)) }, "Go to row")))))),
    h("p", { "data-note": "share" }, `These ${plural(listed.length, "call")} hold ${pct(totalAll ? totalListed / totalAll : null)} of the ${rank[1].toLowerCase()} of the ${plural(measured.length, "shown call")}.`),
    h("p", { class: "faint" }, "Measured on calls already made in this run."));
}

// ---------- metrics ----------

const latencies = (ctx) => shownOf(ctx).map((item) => finite(item.meta?.latency_ms)).filter((value) => value !== null);

export default definePack({
  id: "bulk-panels",
  surface: "workbench.bulk.results",
  title: "Bulk results panels",
  about: "Panels for your own Bulk run: each question's answer distribution, a histogram of its probability or confidence, a cross-tab of two questions' answers, your labels against the answers, and the slowest or costliest calls, plus a few run metrics. Read-only arithmetic on the shown rows of this page session's run; held-out rows never appear in an answer table, and a typed cut is advisory.",
  features: [
    { id: "answers", kind: "panel", title: "Answer distribution", render: answersPanel, improvements: [
      { id: "table", title: "Count the shown answers to a question per option, with shares" },
      { id: "mean_p", title: "Show the mean probability of the answers given each option" },
      { id: "labels", title: "Count valid human labels per option beside the answers" },
      { id: "largest_first", title: "Order the answer distribution by count" },
      { id: "open", title: "Open an option onto the rows answered with it" },
    ] },
    { id: "histogram", kind: "panel", title: "Probability histogram", render: histogramPanel, improvements: [
      { id: "table", title: "Bin a question's answer probabilities into a histogram" },
      { id: "bins", title: "Choose 5, 10 or 20 histogram bins" },
      { id: "signal", title: "Switch the histogram to the answers' confidence field" },
      { id: "summary", title: "Summarize the histogram: median and answers under 0.50" },
      { id: "cut", title: "Count the answers at or above a cut you type (advisory)" },
      { id: "open", title: "Open a histogram bin onto its rows" },
    ] },
    { id: "cross", kind: "panel", title: "Two questions' answers", render: crossPanel, improvements: [
      { id: "table", title: "Cross-tabulate two questions' answers on the shown rows" },
      { id: "swap", title: "Swap the cross-tab's rows and columns" },
      { id: "mode", title: "Show the cross-tab as counts, row shares or column shares" },
      { id: "association", title: "Measure how strongly two questions' answers go together (Cramér's V)" },
      { id: "open", title: "Open a cross-tab cell onto its rows" },
    ] },
    { id: "confusion", kind: "panel", title: "Labels against answers", render: confusionPanel, improvements: [
      { id: "matrix", title: "Tabulate valid human labels against answers over the shown rows only" },
      { id: "rates", title: "Show each option's precision and recall" },
      { id: "shares", title: "Show each label's row as shares" },
      { id: "mistakes", title: "List the most frequent label-to-answer mistakes with their rows" },
      { id: "open", title: "Open a label-answer cell onto its rows" },
    ] },
    { id: "slowest", kind: "panel", title: "Slowest calls", render: slowestPanel, improvements: [
      { id: "list", title: "List the shown rows' slowest calls with latency, tokens and cost" },
      { id: "top", title: "Choose how many calls to list: 5, 10 or 20" },
      { id: "rank", title: "Rank the calls by latency, measured cost or output tokens" },
      { id: "share", title: "Show the listed calls' share of the shown total" },
      { id: "go", title: "Go to a listed call's row" },
    ] },

    { id: "slow_tenth_share", kind: "metric", format: "percent", label: "Call time in the slowest tenth of shown calls",
      help: "The slowest ⌈n / 10⌉ calls' share of the summed latency of the shown calls. Measured on calls already made.",
      compute: (ctx) => {
        const values = latencies(ctx).sort((a, b) => b - a);
        const total = values.reduce((sum, value) => sum + value, 0);
        if (!values.length || total <= 0) return null;
        const count = Math.ceil(values.length / 10);
        return { value: values.slice(0, count).reduce((sum, value) => sum + value, 0) / total, detail: `${plural(count, "call")} of ${values.length}` };
      } },
    { id: "tail_ratio", kind: "metric", label: "Slowest shown call over the median call",
      help: "How many times the median latency the slowest shown call took.",
      compute: (ctx) => {
        const values = latencies(ctx);
        const middle = values.length ? median(values) : null;
        if (!middle) return null;
        return { value: Math.max(...values) / middle, detail: `${formatValue(Math.max(...values), "ms")} against a median of ${formatValue(middle, "ms")}` };
      } },
    { id: "answer_patterns", kind: "metric", format: "integer", label: "Distinct answer patterns across questions",
      help: "Shown rows counted once per combination of their Choice, Score and Noul answers. Few patterns over many rows means the questions rarely tell rows apart.",
      compute: (ctx) => {
        const questions = classed(ctx);
        const rows = shownOf(ctx).filter((item) => questions.length && questions.every((question) => picked(item, question.id) !== null));
        if (!rows.length) return null;
        const counts = new Map();
        for (const item of rows) {
          const key = JSON.stringify(questions.map((question) => picked(item, question.id)));
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return { value: counts.size, detail: `${plural(rows.length, "answered row")}; the most common pattern covers ${Math.max(...counts.values())}` };
      } },
    { id: "mean_entropy", kind: "metric", label: "Mean normalized entropy of the shown answers",
      help: "Average over the shown Choice, Score and Noul answers of −Σ p ln p / ln k (k options): 0 when one option takes everything, 1 when all are even.",
      compute: (ctx) => {
        const values = [];
        for (const item of shownOf(ctx)) {
          for (const answer of Object.values(isObject(item.answers) ? item.answers : {})) {
            const ps = list(answer?.probabilities).map((entry) => finite(entry?.p));
            if (ps.length < 2 || ps.some((p) => p === null || p < 0)) continue;
            const total = ps.reduce((sum, p) => sum + p, 0);
            if (total <= 0) continue;
            values.push(-ps.reduce((sum, p) => (p > 0 ? sum + (p / total) * Math.log(p / total) : sum), 0) / Math.log(ps.length));
          }
        }
        return values.length ? { value: values.reduce((sum, value) => sum + value, 0) / values.length, detail: plural(values.length, "answer") } : null;
      } },
  ],
});
