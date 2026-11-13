// Panels for the Workbench Compare report ("workbench.compare.rows"; contract in static/js/lab/surfaces/workbench-compare.js):
// a scoreboard of every shared question, right/wrong and pick matrices that open onto their rows, a histogram of each
// variant's gating signal with a reliability table, one row's answers side by side, and the Compare runs seen in this
// page session, plus a few run metrics. Everything is arithmetic on the current user's own run of this page session:
// no model call, nothing stored beyond this page's memory, and the only page actions are a question switch (a local
// rescoring, no model call) pressed by the user. Row numbers count the tuning rows the run sent, as the table's "#".
import { compareText, definePack, formatValue } from "../../kit.js";
import { stableStringify } from "../../lib/json.js";
import { formatMarkdownTable } from "../../lib/tables.js";
import { truncate } from "../../lib/text.js";

const NAMES = ["A", "B"];
const EDGES = ["left", "top", "right", "bottom"];
const BIN_CHOICES = [5, 10, 20];
const IOU_RIGHT = 0.5;  // jev/calibrate.py: a Box answer is right when it overlaps its label at least this much
const EPS = 1e-9;
const NUMBERING = "Row numbers count the tuning rows the run sent (the table's #).";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const pct = (value) => formatValue(finite(value), "percent");
const two = (value) => (finite(value) === null ? "—" : value.toFixed(2));
const usd = (value) => (finite(value) === null ? "—" : `$${Number(value.toPrecision(6))}`);
const itemsOf = (ctx) => {
  try {
    const list = ctx?.items?.();
    return Array.isArray(list) ? list.filter((item) => isObject(item) && Number.isInteger(item.index)) : [];
  } catch { return []; }
};
const dataOf = (ctx) => (isObject(ctx?.data) ? ctx.data : {});
const typeOf = (ctx) => dataOf(ctx).type || null;
const listOf = (value) => (Array.isArray(value) ? value : []);
const short = (text) => truncate(String(text ?? ""), 80) ?? "";
const pickOf = (item, v) => (typeof item.picks?.[v] === "string" ? item.picks[v] : null);

function rowText(value) {
  if (typeof value === "string") return value;
  if (isObject(value) && Object.keys(value).length === 1 && typeof value.text === "string") return value.text;
  return JSON.stringify(value) ?? "";
}

// Reports a refused page action (thrown or a rejected promise) as an error toast.
function attempt(api, run) {
  try {
    const result = run();
    if (result && typeof result.then === "function") result.then(null, (error) => api.toast(error?.message || String(error), "error"));
  } catch (error) { api.toast(error.message, "error"); }
}

// ---------- scoring a row locally (mirrors jev/calibrate.py's label reading) ----------

const validBox = (box) => isObject(box) && EDGES.every((edge) => finite(box[edge]) !== null) && box.left < box.right && box.top < box.bottom;

function iou(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const hgt = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = w * hgt;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return union > 0 ? inter / union : 0;
}

// The human label as a pick ("billing", "yes", "2"), or null when the report would not score it against this answer.
function labelPick(type, label, answer) {
  if (label === null || label === undefined) return null;
  const probs = isObject(answer?.probabilities) ? answer.probabilities : null;
  if (type === "choice") return typeof label === "string" && probs && Object.hasOwn(probs, label) ? label : null;
  if (type === "noul") {
    if (typeof label === "boolean") return label ? "yes" : "no";
    const text = String(label).trim().toLowerCase();
    return ["yes", "true", "1", "y"].includes(text) ? "yes" : ["no", "false", "0", "n"].includes(text) ? "no" : null;
  }
  if (type === "score") {
    if (typeof label === "boolean" || (typeof label === "string" && !label.trim()) || !probs) return null;
    const level = Number(label);
    if (!Number.isInteger(level)) return null;
    return Object.keys(probs).some((key) => Number.parseInt(key, 10) === level) ? String(level) : null;
  }
  return null;
}

// Row indexes whose label the report left out of both sides (data.scores[v].invalid).
function invalidIndexes(ctx) {
  const scores = listOf(dataOf(ctx).scores);
  return new Set(scores.flatMap((score) => listOf(score?.invalid).map((entry) => entry?.index)));
}

// Whether variant v got this row right: the server's verdict on differing rows, else a local reading of the label on
// rows both variants answered (the rows the report scores). null when the row is not scored.
function rightOf(item, v, type, invalid) {
  if (typeof item.correct?.[v] === "boolean") return item.correct[v];
  if (!item.paired || item.label === null || item.label === undefined || invalid.has(item.index)) return null;
  const answer = item.answers?.[v];
  if (!isObject(answer)) return null;
  if (type === "box") return validBox(answer.box) && validBox(item.label) ? iou(item.label, answer.box) + EPS >= IOU_RIGHT : null;
  const want = labelPick(type, item.label, answer);
  const pick = pickOf(item, v);
  return want === null || pick === null ? null : pick === want;
}

// The labeled rows both variants answered, with each side's verdict: [{ item, right: [a, b] }].
function scoredRows(ctx) {
  const type = typeOf(ctx), invalid = invalidIndexes(ctx);
  return itemsOf(ctx).filter((item) => item.paired).map((item) => ({ item, right: [0, 1].map((v) => rightOf(item, v, type, invalid)) }))
    .filter((entry) => entry.right.every((value) => typeof value === "boolean"));
}

const CELLS = [["both_right", "A right, B right"], ["a_only", "A right, B wrong"], ["b_only", "A wrong, B right"], ["both_wrong", "A wrong, B wrong"]];
const cellOf = ([a, b]) => (a && b ? "both_right" : a ? "a_only" : b ? "b_only" : "both_wrong");

// Picks in a readable order: the options of A's question as run, then any others A to Z.
function pickOrder(ctx, picks) {
  const question = listOf(dataOf(ctx).questions)[0];
  const type = typeOf(ctx);
  const known = type === "choice" && isObject(question?.criteria) ? Object.keys(question.criteria) : type === "noul" ? ["yes", "no"] : [];
  const rest = [...new Set(picks)].filter((pick) => !known.includes(pick)).sort(type === "score" ? (a, b) => Number(a) - Number(b) || compareText(a, b) : compareText);
  return [...known.filter((pick) => picks.includes(pick)), ...rest];
}

const rowLine = (h, item, extra) => h("li", { "data-row": item.index }, `#${item.number} `, h("span", {}, short(item.text)), extra ? ` — ${extra}` : "");

// ---------- remembering this session's runs and scored questions (panel memory only) ----------

const runKey = (data) => stableStringify([data.variants, data.run]);

function runSummary(data) {
  const variants = listOf(data.variants);
  return { models: variants.map((variant) => variant?.model || "—"), perturb: variants[1]?.perturb || null, average: variants[1]?.average_orders === true,
    rows: data.run?.rows ?? null, held_out: data.run?.held_out ?? 0, cost_usd: finite(data.run?.cost_usd), wall_ms: finite(data.run?.wall_ms), stopped: data.run?.stopped || null };
}

// Notes the run on screen and the question it scores now in this panel's memory. A new run moves the previous one to
// state.earlier. Returns the current run's record, or null before a run.
function observe(state, ctx) {
  const data = dataOf(ctx);
  if (!data.run || listOf(data.variants).length !== 2) return null;
  const key = runKey(data);
  if (state.key !== key) {
    if (state.key && state.current) state.earlier = [...listOf(state.earlier), state.current];
    state.key = key;
    state.current = { summary: runSummary(data), scored: {} };
  }
  const scores = listOf(data.scores);
  if (data.qid && scores.length === 2 && scores.every(isObject)) {
    state.current.scored[data.qid] = { type: data.type, correct: scores.map((score) => score.correct ?? 0), labeled: scores.map((score) => score.labeled ?? 0),
      p: finite(data.paired?.p_value) };
  }
  return state.current;
}

const accuracyText = (entry, v) => (entry && entry.labeled[v] ? `${entry.correct[v]}/${entry.labeled[v]} (${pct(entry.correct[v] / entry.labeled[v])})` : "—");
const gapOf = (entry) => (entry && entry.labeled[0] && entry.labeled[1] ? entry.correct[1] / entry.labeled[1] - entry.correct[0] / entry.labeled[0] : null);

function leadText(entry) {
  if (!entry || !entry.labeled[0]) return "—";
  const diff = entry.correct[1] - entry.correct[0];
  const p = entry.p === null ? "" : ` (p = ${entry.p.toFixed(2)})`;
  return diff === 0 ? `even${p}` : `${diff > 0 ? "B" : "A"} +${Math.abs(diff)}${p}`;
}

// ---------- scoreboard ----------

const SORTS = [["order", "Question order"], ["changed", "Most answers changed"], ["gap", "Largest accuracy gap"]];

function scoreboardRows(ctx, state, memory) {
  const data = dataOf(ctx);
  const agreement = new Map(listOf(data.agreement).filter(isObject).map((entry) => [entry.qid, entry]));
  const labeled = new Set(listOf(data.labeled));
  let rows = listOf(data.shared).map((qid, order) => {
    const entry = agreement.get(qid) || {};
    return { qid, order, type: entry.type || "—", check: entry.reordered ? "order check" : entry.perturbed ? "input check" : "—",
      answered: entry.answered ?? null, changed: entry.changed ?? null, rate: finite(entry.rate), low: finite(entry.low), high: finite(entry.high),
      labeled: labeled.has(qid), scored: memory?.scored?.[qid] || null };
  });
  if (state.labeledOnly) rows = rows.filter((row) => row.labeled);
  const sort = SORTS.some(([key]) => key === state.sort) ? state.sort : "order";
  const value = (row) => (sort === "changed" ? row.rate : sort === "gap" ? (gapOf(row.scored) === null ? null : Math.abs(gapOf(row.scored))) : row.order);
  return rows.map((row) => ({ row, value: value(row) })).sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === b.value ? a.row.order - b.row.order : a.value === null ? 1 : -1;
    return (sort === "order" ? a.value - b.value : b.value - a.value) || a.row.order - b.row.order;
  }).map((entry) => entry.row);
}

const changedText = (row) => (row.rate === null ? "—" : `${row.changed}/${row.answered} (${pct(row.rate)}, 95% ${pct(row.low)}–${pct(row.high)})`);

function scoreboardPanel(h, ctx, api) {
  const memory = observe(api.state, ctx);
  const data = dataOf(ctx);
  if (!memory || !listOf(data.shared).length) return h("p", { class: "faint" }, "Run both variants first: the scoreboard lists the questions they share.");
  const rows = scoreboardRows(ctx, api.state, memory);
  const sort = SORTS.some(([key]) => key === api.state.sort) ? api.state.sort : "order";
  const markdown = () => [`# Compare scoreboard: your Compare run's agreement and scored accuracies`, "",
    formatMarkdownTable(["Question", "Type", "Check", "Answers changed", "A accuracy", "B accuracy", "Ahead"],
      rows.map((row) => [row.qid, row.type, row.check, changedText(row), accuracyText(row.scored, 0), accuracyText(row.scored, 1), leadText(row.scored)])),
    "", "Accuracies are for the questions you scored in this run; p is the exact McNemar test, and small samples are rarely conclusive. Comparisons across questions are exploratory and unadjusted.", ""].join("\n");
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("label", {}, "Sort ", h("select", { "data-action": "scoreboard-sort", onchange: (event) => { api.state.sort = event.target.value; api.redraw(); } },
        SORTS.map(([key, label]) => h("option", { value: key, selected: key === sort }, label)))),
      h("button", { class: "btn sm ghost", "data-action": "labeled-only", "aria-pressed": api.state.labeledOnly ? "true" : "false",
        onclick: () => { api.state.labeledOnly = !api.state.labeledOnly; api.redraw(); } }, api.state.labeledOnly ? "Show every shared question" : "Show only labeled questions"),
      h("button", { class: "btn sm ghost", "data-action": "copy-scoreboard", disabled: !rows.length,
        onclick: () => { api.copy(markdown()); api.toast("Copied the scoreboard: your Compare run's agreement rates and scored accuracies."); } }, "Copy as Markdown")),
    rows.length ? h("div", { class: "scroll" }, h("table", { class: "table", "data-table": "scoreboard" },
      h("thead", {}, h("tr", {}, ["question", "type", "check", "answers changed", "A accuracy", "B accuracy", "ahead", ""].map((name) => h("th", {}, name)))),
      h("tbody", {}, rows.map((row) => h("tr", { "data-question": row.qid },
        h("td", { class: "mono" }, row.qid), h("td", {}, row.type), h("td", {}, row.check), h("td", { class: "num" }, changedText(row)),
        h("td", { class: "num", "data-accuracy": "A" }, row.scored ? accuracyText(row.scored, 0) : "not scored yet"),
        h("td", { class: "num", "data-accuracy": "B" }, row.scored ? accuracyText(row.scored, 1) : "not scored yet"),
        h("td", { "data-lead": row.qid }, leadText(row.scored)),
        h("td", {}, row.qid === data.qid ? h("span", { class: "faint", "data-current": row.qid }, "scoring now")
          : h("button", { class: "btn sm ghost", "data-score": row.qid, disabled: !!data.running, "aria-label": `Score ${row.qid}`,
            onclick: () => attempt(api, () => ctx.actions.selectQuestion(row.qid)) }, "Score")))))))
      : h("p", { class: "faint", "data-empty": "scoreboard" }, "No shared question carries a label in this run."),
    h("p", { class: "faint" }, "Answers changed: rows both variants answered where the picks differ, with the 95% Wilson interval. Accuracies appear for each question you score in this run (Score asks the page for a local rescoring, no model call). p: exact McNemar, two-sided; small samples are rarely conclusive."));
}

// ---------- matrices ----------

function matricesPanel(h, ctx, api) {
  const scored = scoredRows(ctx);
  const items = itemsOf(ctx);
  if (!items.length) return h("p", { class: "faint" }, "Run both variants first: there is no Compare report yet.");
  const type = typeOf(ctx);
  const state = api.state;
  const counts = Object.fromEntries(CELLS.map(([key]) => [key, scored.filter((entry) => cellOf(entry.right) === key)]));
  const paired = dataOf(ctx).paired;
  const differs = paired && CELLS.some(([key]) => paired[key] !== counts[key].length);
  const cellButton = (key) => h("button", { class: "btn sm ghost", "data-cell": key, "aria-pressed": state.cell === key ? "true" : "false",
    onclick: () => { state.cell = state.cell === key ? null : key; api.redraw(); } }, String(counts[key].length));
  const chosen = CELLS.some(([key]) => key === state.cell) ? state.cell : null;
  const both = items.filter((item) => item.paired && pickOf(item, 0) !== null && pickOf(item, 1) !== null);
  const aPicks = both.map((item) => pickOf(item, 0)), bPicks = both.map((item) => pickOf(item, 1));
  const axis = pickOrder(ctx, [...aPicks, ...bPicks]);
  const pickKey = (a, b) => `${a}\u0000${b}`;
  const inCell = (a, b) => both.filter((item) => pickOf(item, 0) === a && pickOf(item, 1) === b);
  const [pa, pb] = typeof state.pick === "string" ? state.pick.split("\u0000") : [null, null];
  const labels = scored.map((entry) => ({ ...entry, label: labelPick(type, entry.item.label, entry.item.answers?.[0]) })).filter((entry) => entry.label !== null);
  const labelAxis = pickOrder(ctx, labels.map((entry) => entry.label));
  const perLabel = labelAxis.map((label) => {
    const group = labels.filter((entry) => entry.label === label);
    return { label, n: group.length, right: [0, 1].map((v) => group.filter((entry) => entry.right[v]).length) };
  }).sort((x, y) => y.n - x.n || labelAxis.indexOf(x.label) - labelAxis.indexOf(y.label));
  const confusion = (v) => {
    const columns = pickOrder(ctx, labels.map((entry) => pickOf(entry.item, v)));
    return h("table", { class: "table", "data-confusion": NAMES[v] },
      h("thead", {}, h("tr", {}, h("th", {}, `label \\ ${NAMES[v]}'s pick`), columns.map((pick) => h("th", { class: "mono" }, pick)))),
      h("tbody", {}, labelAxis.map((label) => h("tr", {}, h("th", { class: "mono" }, label),
        columns.map((pick) => h("td", { class: "num", "data-lc": `${NAMES[v]}|${label}|${pick}` },
          String(labels.filter((entry) => entry.label === label && pickOf(entry.item, v) === pick).length)))))));
  };
  return h("div", {},
    h("h4", {}, "A against B, right or wrong"),
    h("table", { class: "table", "data-table": "right-wrong" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "B right"), h("th", {}, "B wrong"))),
      h("tbody", {},
        h("tr", {}, h("th", {}, "A right"), h("td", {}, cellButton("both_right")), h("td", {}, cellButton("a_only"))),
        h("tr", {}, h("th", {}, "A wrong"), h("td", {}, cellButton("b_only")), h("td", {}, cellButton("both_wrong"))))),
    h("p", { class: "faint" }, `${plural(scored.length, "labeled row")} both variants answered.${differs ? " These counts differ from the report's paired table, which may leave out labels it could not score." : ""}`),
    chosen ? h("div", { "data-cell-rows": chosen }, h("p", {}, `${CELLS.find(([key]) => key === chosen)[1]}: ${plural(counts[chosen].length, "row")}`),
      counts[chosen].length ? h("ul", {}, counts[chosen].map((entry) => rowLine(h, entry.item, `A ${pickOf(entry.item, 0)}, B ${pickOf(entry.item, 1)}`))) : null) : null,
    type === "box" ? h("p", { class: "faint", "data-empty": "picks" }, "Box picks are coordinates, so there is no pick-by-pick table.")
      : both.length ? h("div", {},
        h("h4", {}, "A's pick against B's pick"),
        h("div", { class: "scroll" }, h("table", { class: "table", "data-table": "picks" },
          h("thead", {}, h("tr", {}, h("th", {}, "A \\ B"), axis.map((pick) => h("th", { class: "mono" }, pick)))),
          h("tbody", {}, axis.map((a) => h("tr", {}, h("th", { class: "mono" }, a), axis.map((b) => {
            const count = inCell(a, b).length;
            return h("td", { class: "num" }, count ? h("button", { class: "btn sm ghost", "data-pick": `${a}|${b}`, onclick: () => { state.pick = state.pick === pickKey(a, b) ? null : pickKey(a, b); api.redraw(); } }, String(count)) : "0");
          })))))),
        pa !== null && inCell(pa, pb).length ? h("div", { "data-pick-rows": `${pa}|${pb}` }, h("p", {}, `A ${pa}, B ${pb}: ${plural(inCell(pa, pb).length, "row")}`),
          h("ul", {}, inCell(pa, pb).map((item) => rowLine(h, item, item.label === null ? "unlabeled" : `label ${rowText(item.label)}`)))) : null) : null,
    type === "box" || !labels.length ? null : h("div", {},
      h("h4", {}, "Accuracy per label"),
      h("table", { class: "table", "data-table": "per-label" },
        h("thead", {}, h("tr", {}, ["label", "rows", "A right", "B right"].map((name) => h("th", {}, name)))),
        h("tbody", {}, perLabel.map((row) => h("tr", { "data-label": row.label }, h("td", { class: "mono" }, row.label), h("td", { class: "num" }, String(row.n)),
          [0, 1].map((v) => h("td", { class: "num" }, `${row.right[v]}/${row.n} (${pct(row.right[v] / row.n)})`)))))),
      h("h4", {}, "Label against pick"), confusion(0), confusion(1)),
    h("p", { class: "faint" }, `From your Compare run's answers for “${dataOf(ctx).qid}”: right and wrong on labeled rows both variants answered (the report's scored set), picks on every row both answered. ${NUMBERING} Per-label figures are exploratory.`));
}

// ---------- signal histograms ----------

function binOf(value, bins) {
  return Math.min(bins - 1, Math.max(0, Math.floor(value * bins + EPS)));
}

function signalsPanel(h, ctx, api) {
  const items = itemsOf(ctx);
  if (!items.length) return h("p", { class: "faint" }, "Run both variants first: there is no Compare report yet.");
  const state = api.state;
  const bins = BIN_CHOICES.includes(Number(state.bins)) ? Number(state.bins) : 10;
  const type = typeOf(ctx), invalid = invalidIndexes(ctx);
  const signal = dataOf(ctx).signal === "top_probability" ? "top probability" : "confidence";
  const answered = (v) => items.filter((item) => finite(item.signals?.[v]) !== null);
  const members = (v, bin) => answered(v).filter((item) => binOf(item.signals[v], bins) === bin);
  const range = (bin) => `${(bin / bins).toFixed(2)}–${((bin + 1) / bins).toFixed(2)}`;
  const max = Math.max(1, ...[0, 1].flatMap((v) => Array.from({ length: bins }, (_, bin) => members(v, bin).length)));
  const split = (list, v) => {
    const right = list.filter((item) => rightOf(item, v, type, invalid) === true).length;
    const wrong = list.filter((item) => rightOf(item, v, type, invalid) === false).length;
    return `${right} right · ${wrong} wrong · ${list.length - right - wrong} unscored`;
  };
  const [openV, openBin] = typeof state.bin === "string" ? state.bin.split("|") : [null, null];
  const openList = openV !== null ? members(NAMES.indexOf(openV), Number(openBin)) : [];
  const reliability = (v) => {
    const pairs = items.map((item) => ({ item, top: finite(item.tops?.[v]), right: rightOf(item, v, type, invalid) }))
      .filter((entry) => entry.top !== null && typeof entry.right === "boolean" && entry.item.paired);
    const rows = Array.from({ length: bins }, (_, bin) => pairs.filter((entry) => binOf(entry.top, bins) === bin)).map((group, bin) => ({ bin, group }))
      .filter((entry) => entry.group.length).map(({ bin, group }) => {
        const stated = group.reduce((sum, entry) => sum + entry.top, 0) / group.length;
        const observed = group.filter((entry) => entry.right).length / group.length;
        return { bin, n: group.length, stated, observed, gap: Math.abs(stated - observed) };
      });
    const weighted = pairs.length ? rows.reduce((sum, row) => sum + row.n * row.gap, 0) / pairs.length : null;
    return h("div", { "data-reliability": NAMES[v] }, h("h4", {}, `Variant ${NAMES[v]}: stated probability against accuracy`),
      rows.length ? h("table", { class: "table" },
        h("thead", {}, h("tr", {}, ["stated probability", "rows", "mean stated", "accuracy", "gap"].map((name) => h("th", {}, name)))),
        h("tbody", {}, rows.map((row) => h("tr", { "data-rel-bin": `${NAMES[v]}|${row.bin}` }, h("td", {}, range(row.bin)), h("td", { class: "num" }, String(row.n)),
          h("td", { class: "num" }, two(row.stated)), h("td", { class: "num" }, pct(row.observed)), h("td", { class: "num" }, two(row.gap)))))) : h("p", { class: "faint" }, "No labeled row both variants answered."),
      weighted === null ? null : h("p", { "data-weighted": NAMES[v] }, `Weighted gap over ${plural(pairs.length, "row")}: ${two(weighted)}`));
  };
  return h("div", {},
    h("div", { class: "chips lab-row" }, h("label", {}, "Bins ", h("select", { "data-action": "bins", onchange: (event) => { state.bins = event.target.value; state.bin = null; api.redraw(); } },
      BIN_CHOICES.map((count) => h("option", { value: String(count), selected: count === bins }, String(count)))))),
    h("div", { class: "scroll" }, h("table", { class: "table", "data-table": "histogram" },
      h("thead", {}, h("tr", {}, h("th", {}, signal), NAMES.map((name) => h("th", {}, `Variant ${name}`)))),
      h("tbody", {}, Array.from({ length: bins }, (_, bin) => h("tr", {}, h("td", {}, range(bin)), [0, 1].map((v) => {
        const list = members(v, bin);
        return h("td", { "data-bin": `${NAMES[v]}|${bin}` },
          list.length ? h("button", { class: "btn sm ghost", "data-open-bin": `${NAMES[v]}|${bin}`, onclick: () => { state.bin = state.bin === `${NAMES[v]}|${bin}` ? null : `${NAMES[v]}|${bin}`; api.redraw(); } },
            String(list.length)) : "0",
          " ", h("span", { "aria-hidden": "true" }, "█".repeat(Math.round((list.length / max) * 12))),
          list.length ? h("span", { class: "faint", "data-split": `${NAMES[v]}|${bin}` }, ` ${split(list, v)}`) : null);
      })))))),
    openList.length ? h("div", { "data-bin-rows": state.bin }, h("p", {}, `Variant ${openV}, ${signal} ${range(Number(openBin))}: ${plural(openList.length, "row")}`),
      h("ul", {}, openList.map((item) => rowLine(h, item, `${openV} ${pickOf(item, NAMES.indexOf(openV)) ?? "—"} at ${two(item.signals[NAMES.indexOf(openV)])}`)))) : null,
    reliability(0), reliability(1),
    h("p", { class: "faint" }, `Each variant's gating signal (${signal}) on every row it answered for “${dataOf(ctx).qid}”; right and wrong only on labeled rows both answered. The reliability tables bin the probability each answer gives its own pick against how often that pick is right; the report's calibration gap does the same for Choice, Score and Box, but for Yes/no it bins P(yes) against yes labels, so the two can differ there. ${NUMBERING}`));
}

// ---------- row detail ----------

function probabilityRows(answers) {
  const keys = [];
  const values = answers.map((answer) => {
    if (!isObject(answer)) return {};
    if (answer.type === "noul" && finite(answer.noul) !== null) return { yes: answer.noul, no: 1 - answer.noul };
    if (answer.type === "box" && isObject(answer.box)) return Object.fromEntries(EDGES.map((edge) => [edge, finite(answer.box[edge])]));
    return isObject(answer.probabilities) ? Object.fromEntries(Object.entries(answer.probabilities).map(([key, p]) => [key, finite(p)])) : {};
  });
  for (const map of values) for (const key of Object.keys(map)) if (!keys.includes(key)) keys.push(key);
  return keys.map((key) => [key, ...values.map((map) => (Object.hasOwn(map, key) ? map[key] : null))]);
}

const sentText = (item, v) => (item.sent?.[v] === null || item.sent?.[v] === undefined ? "as written" : rowText(item.sent[v]));

function callText(item, v) {
  if (item.errors?.[v]) return `call failed: ${item.errors[v]}`;
  if (item.skipped?.[v]) return "skipped by a stop";
  return isObject(item.answers?.[v]) ? "answered" : "no answer to this question";
}

function detailFields(ctx, item) {
  const type = typeOf(ctx), invalid = invalidIndexes(ctx);
  const result = (v) => {
    const right = rightOf(item, v, type, invalid);
    return right === true ? "right" : right === false ? "wrong" : "unscored";
  };
  const meta = (v, field) => (isObject(item.meta?.[v]) ? finite(item.meta[v][field]) : null);
  return [
    ["pick", ...[0, 1].map((v) => pickOf(item, v) ?? "—")],
    ["signal", ...[0, 1].map((v) => two(item.signals?.[v]))],
    ["top probability", ...[0, 1].map((v) => two(item.tops?.[v]))],
    ["result", ...[0, 1].map(result)],
    ["call", ...[0, 1].map((v) => callText(item, v))],
    ["latency", ...[0, 1].map((v) => (meta(v, "latency_ms") === null ? "—" : `${Math.round(meta(v, "latency_ms"))} ms`))],
    ["input tokens", ...[0, 1].map((v) => (meta(v, "input_tokens") === null ? "—" : String(meta(v, "input_tokens"))))],
    ["output tokens", ...[0, 1].map((v) => (meta(v, "output_tokens") === null ? "—" : String(meta(v, "output_tokens"))))],
    ["cost", ...[0, 1].map((v) => usd(meta(v, "cost_usd")))],
    ["calls", ...[0, 1].map((v) => (meta(v, "calls") === null ? "—" : String(meta(v, "calls"))))],
    ["option orders", ...[0, 1].map((v) => (Array.isArray(item.orders?.[v]) ? `as listed ${item.orders[v][0] ?? "—"} · reversed ${item.orders[v][1] ?? "—"}` : "asked once"))],
    ["sent", ...[0, 1].map((v) => sentText(item, v))],
  ];
}

function detailPanel(h, ctx, api) {
  const items = itemsOf(ctx);
  if (!items.length) return h("p", { class: "faint" }, "Run both variants first: there is no Compare report yet.");
  const state = api.state;
  const position = Math.max(0, items.findIndex((item) => item.index === Number(state.row)));
  const item = items[position];
  const go = (next) => { state.row = items[next].index; api.redraw(); };
  const fields = detailFields(ctx, item);
  const probabilities = probabilityRows(item.answers || []);
  const qid = dataOf(ctx).qid;
  const markdown = () => [`# Compare row #${item.number}: your Compare run's answers and the row's label for “${qid}”`, "", NUMBERING, "",
    `Row as written: ${item.text}`, `Label: ${item.label === null ? "none" : rowText(item.label)}`, "",
    formatMarkdownTable(["", "A", "B"], fields), "",
    probabilities.length ? formatMarkdownTable(["option", "A", "B"], probabilities.map(([key, a, b]) => [key, two(a), two(b)])) : "", ""].join("\n");
  return h("div", {},
    h("div", { class: "chips lab-row" },
      h("button", { class: "btn sm ghost", "data-action": "previous-row", disabled: position === 0, onclick: () => go(position - 1) }, "Previous row"),
      h("label", {}, " Row ", h("select", { "data-action": "row", onchange: (event) => { state.row = Number(event.target.value); api.redraw(); } },
        items.map((entry) => h("option", { value: String(entry.index), selected: entry === item }, `#${entry.number}${entry.differs ? " · differs" : ""}`)))),
      h("button", { class: "btn sm ghost", "data-action": "next-row", disabled: position === items.length - 1, onclick: () => go(position + 1) }, "Next row"),
      h("button", { class: "btn sm ghost", "data-action": "copy-row", onclick: () => { api.copy(markdown()); api.toast(`Copied row #${item.number}: your Compare run's answers for that row.`); } }, "Copy as Markdown")),
    h("p", { "data-heading": "row" }, `Row #${item.number} of ${plural(items.length, "compared row")} · label ${item.label === null ? "none" : rowText(item.label)}`),
    h("p", { class: "mono", "data-text": "row" }, item.text),
    h("table", { class: "table", "data-table": "detail" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Variant A"), h("th", {}, "Variant B"))),
      h("tbody", {}, fields.map(([name, a, b]) => h("tr", { "data-field": name }, h("th", {}, name), h("td", {}, a), h("td", {}, b))))),
    probabilities.length ? h("table", { class: "table", "data-table": "probabilities" },
      h("thead", {}, h("tr", {}, h("th", {}, dataOf(ctx).type === "box" ? "edge" : "option"), h("th", {}, "A"), h("th", {}, "B"))),
      h("tbody", {}, probabilities.map(([key, a, b]) => h("tr", { "data-key": key }, h("td", { class: "mono" }, key), h("td", { class: "num" }, two(a)), h("td", { class: "num" }, two(b))))))
      : null,
    h("p", { class: "faint" }, `Your Compare run's answers and measurements for “${qid}” on one row. ${NUMBERING} Cost and latency are measured.`));
}

// ---------- this session's runs ----------

function sessionPanel(h, ctx, api) {
  const current = observe(api.state, ctx);
  const earlier = listOf(api.state.earlier);
  if (!current && !earlier.length) return h("p", { class: "faint" }, "No Compare run yet in this page session.");
  const runs = [...earlier.map((run, index) => ({ run, name: `Earlier run ${index + 1}` })), ...(current ? [{ run: current, name: "Current run" }] : [])];
  const previous = earlier.at(-1) || null;
  const both = current && previous ? Object.keys(current.scored).filter((qid) => previous.scored[qid]) : [];
  const describe = ({ summary }) => `A ${summary.models[0]} · B ${summary.models[1]}${summary.perturb ? `, rows ${summary.perturb}` : ""}${summary.average ? ", both orders averaged" : ""}`;
  return h("div", {},
    h("table", { class: "table", "data-table": "runs" },
      h("thead", {}, h("tr", {}, ["run", "setup", "rows", "held out", "measured cost", "wall time", "questions scored"].map((name) => h("th", {}, name)))),
      h("tbody", {}, runs.map(({ run, name }) => h("tr", { "data-run": name }, h("td", {}, name), h("td", {}, describe(run)),
        h("td", { class: "num" }, run.summary.rows === null ? "—" : String(run.summary.rows)), h("td", { class: "num" }, String(run.summary.held_out)),
        h("td", { class: "num" }, usd(run.summary.cost_usd)), h("td", { class: "num" }, run.summary.wall_ms === null ? "—" : `${Math.round(run.summary.wall_ms)} ms`),
        h("td", {}, Object.keys(run.scored).join(", ") || "none"))))),
    previous && current ? h("div", {}, h("h4", {}, "Current run against the previous one"),
      both.length ? h("table", { class: "table", "data-table": "vs-previous" },
        h("thead", {}, h("tr", {}, ["question", "A before", "A now", "B before", "B now"].map((name) => h("th", {}, name)))),
        h("tbody", {}, both.map((qid) => h("tr", { "data-question": qid }, h("td", { class: "mono" }, qid),
          h("td", { class: "num" }, accuracyText(previous.scored[qid], 0)), h("td", { class: "num" }, accuracyText(current.scored[qid], 0)),
          h("td", { class: "num" }, accuracyText(previous.scored[qid], 1)), h("td", { class: "num" }, accuracyText(current.scored[qid], 1))))))
        : h("p", { class: "faint", "data-empty": "vs-previous" }, "Score a question in this run that you also scored in the previous one to compare them.")) : null,
    earlier.length ? h("button", { class: "btn sm ghost", "data-action": "forget-runs", onclick: () => { api.state.earlier = []; api.redraw(); api.toast("Forgot the earlier runs; the current run stays."); } },
      "Forget earlier runs") : null,
    h("p", { class: "faint" }, "Runs and scored questions this panel saw while open in this page session, kept in the page's memory only; earlier runs are labeled as such. Accuracies are on each run's own labeled rows, so runs over different rows are not directly comparable."));
}

// ---------- metrics ----------

function pooledChanged(ctx) {
  const entries = listOf(dataOf(ctx).agreement).filter((entry) => isObject(entry) && Number.isInteger(entry.answered) && entry.answered > 0);
  const answered = entries.reduce((sum, entry) => sum + entry.answered, 0);
  if (!answered) return null;
  const changed = entries.reduce((sum, entry) => sum + (Number.isInteger(entry.changed) ? entry.changed : 0), 0);
  return { value: changed / answered, detail: `${changed} of ${answered} answers across ${plural(entries.length, "shared question")}` };
}

function agreeAccuracy(ctx) {
  const agreeing = scoredRows(ctx).filter((entry) => !entry.item.differs);
  if (!agreeing.length) return null;
  const right = agreeing.filter((entry) => entry.right[0] && entry.right[1]).length;
  return { value: right / agreeing.length, detail: `${right} of ${plural(agreeing.length, "labeled row")} where both give the same answer` };
}

function majorityBaseline(ctx) {
  const type = typeOf(ctx);
  if (type === "box") return null;
  const labels = scoredRows(ctx).map((entry) => labelPick(type, entry.item.label, entry.item.answers?.[0])).filter((label) => label !== null);
  if (!labels.length) return null;
  const counts = new Map();
  for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
  const [top, count] = [...counts].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0];
  return { value: count / labels.length, detail: `Always “${top}”: ${count} of ${plural(labels.length, "labeled row")} both variants answered` };
}

function rewriteEffect(ctx) {
  const paired = itemsOf(ctx).filter((item) => item.paired);
  const rewritten = paired.filter((item) => listOf(item.sent).some((sent) => sent !== null && sent !== undefined));
  const plain = paired.filter((item) => !rewritten.includes(item));
  if (!rewritten.length || !plain.length) return null;
  const rate = (list) => list.filter((item) => item.differs).length / list.length;
  return { value: rate(rewritten) - rate(plain),
    detail: `${rewritten.filter((item) => item.differs).length} of ${plural(rewritten.length, "rewritten row")} differ, ${plain.filter((item) => item.differs).length} of ${plain.length} sent as written` };
}

export default definePack({
  id: "compare-panels",
  surface: "workbench.compare.rows",
  title: "Compare panels",
  about: "Panels for your Compare run: a scoreboard of every shared question, right/wrong, pick and label matrices that open onto their rows, a histogram and reliability table of each variant's signal, one row's answers side by side, and the Compare runs seen in this page session, plus four run metrics. Everything is computed from your own run in this page session and kept only in the page's memory; the only page action is a question switch, a local rescoring with no model call.",
  features: [
    { id: "scoreboard", kind: "panel", title: "Shared-question scoreboard",
      improvements: [
        { id: "remembered", title: "A's and B's accuracy on each question scored in this run" },
        { id: "leader", title: "The variant ahead on each scored question, with the exact McNemar p" },
        { id: "sort", title: "Sort the scoreboard by question order, answers changed or accuracy gap" },
        { id: "labeled_only", title: "Show only the shared questions with labels in this run" },
        { id: "copy", title: "Copy the scoreboard as Markdown" },
      ],
      render: scoreboardPanel },
    { id: "matrices", kind: "panel", title: "Right/wrong and pick matrices",
      improvements: [
        { id: "cell_rows", title: "List the rows behind a cell of the right/wrong table" },
        { id: "pick_matrix", title: "Table of A's pick against B's pick on every row both answered" },
        { id: "pick_rows", title: "List the rows behind a cell of the pick table" },
        { id: "per_label", title: "A's and B's accuracy for each human label" },
        { id: "label_confusion", title: "Human label against each variant's pick" },
      ],
      render: matricesPanel },
    { id: "signals", kind: "panel", title: "Signal histograms",
      improvements: [
        { id: "histogram", title: "Histogram of each variant's gating signal on the rows it answered" },
        { id: "right_wrong", title: "Right, wrong and unscored answers in each histogram bin" },
        { id: "bins", title: "Choose 5, 10 or 20 histogram bins" },
        { id: "reliability", title: "Stated probability against accuracy per bin for each variant" },
        { id: "bin_rows", title: "List the rows in one histogram bin" },
      ],
      render: signalsPanel },
    { id: "row_detail", kind: "panel", title: "Row detail, A beside B",
      improvements: [
        { id: "pick_row", title: "Choose any compared row, agreeing ones included, and see both variants' pick, signal, result, rewrite and option orders side by side" },
        { id: "probabilities", title: "Both variants' probability for every option or level side by side" },
        { id: "measurements", title: "Each call's measured latency, tokens and cost, with failures and skips" },
        { id: "step", title: "Step to the previous or next compared row" },
        { id: "copy", title: "Copy one row's answers as Markdown" },
      ],
      render: detailPanel },
    { id: "session_runs", kind: "panel", title: "This session's Compare runs",
      improvements: [
        { id: "runs", title: "List the Compare runs seen in this page session with setup, rows and measured cost" },
        { id: "vs_previous", title: "Accuracy now and in the previous run for questions scored in both" },
        { id: "forget", title: "Forget the earlier runs this panel recorded" },
      ],
      render: sessionPanel },
    { id: "pooled_changed", kind: "metric", format: "percent", label: "Answers changed across shared questions",
      help: "Rows both variants answered where the picks differ, pooled over every shared question of your run (the order or input check table).",
      compute: pooledChanged },
    { id: "agree_accuracy", kind: "metric", format: "percent", label: "Accuracy where A and B agree",
      help: "On labeled rows both variants answered with the same pick: how often that shared answer is right.",
      compute: agreeAccuracy },
    { id: "majority_baseline", kind: "metric", format: "percent", label: "Accuracy of always giving the most common label",
      help: "A baseline for the scored question: the share of labeled rows both variants answered that carry the most common label. Not for Box questions.",
      compute: majorityBaseline },
    { id: "rewrite_effect", kind: "metric", format: "percent", label: "Disagreement on rewritten rows minus rows sent as written",
      help: "Among rows both variants answered: the share that differ when a variant was sent a rewritten row, minus the share that differ when both got the row as written. Exploratory: the two groups hold different rows.",
      compute: rewriteEffect },
  ],
});
