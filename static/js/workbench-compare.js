// Compare tab: two question variants or models over the same rows, and the cascade between them.
import {
  $, api, copyText, currentStatus, h, handleError, icon, mount, ms, num, pct, stat, statusBadge, toast, usd,
} from "./common.js";
import { reverseOptions } from "./variants.js";
import { confirmSpend, estimateLine } from "./estimate.js";
import { W } from "./workbench-state.js";
import { toQuestions, fromQuestions } from "./workbench-build.js";
import { render } from "./workbench.js";
import { loadSampleRows, countRows, rowsPayload, rowText } from "./workbench-bulk.js";
import { svg, SIGNALS, boundSelect, interval, withCI, syncAttachedSets } from "./workbench-calibrate.js";

// ---------- Compare ----------
// Two variants, each a question set and a model, over the Bulk rows. The server makes one call per
// row and variant; scoring a question (jev/compare.py) reuses those answers and makes no calls.
const VARIANTS = ["A", "B"];
// How B's rows can be rewritten (jev/perturb.py). Each keeps the row's meaning, and the same rows get the same
// rewrite on every run, so with B a copy of A a changed answer is an effect of the rewrite alone.
const PERTURBS = {
  "": "as written",
  typos: "with typos",
  lowercase: "in lowercase",
  distractor: "with an unrelated sentence added",
  shuffle: "with JSON fields shuffled",
};

function parseVariant(i) {
  const name = VARIANTS[i];
  const text = W.compare.variants[i].text.trim();
  if (!text) throw new Error(`Variant ${name} has no questions`);
  let questions;
  try { questions = JSON.parse(text); } catch (e) { throw new Error(`Variant ${name}: invalid JSON (${e.message})`); }
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) throw new Error(`Variant ${name}: questions must be an object keyed by question id`);
  return questions;
}

function variantStatus(i) {
  try {
    const n = Object.keys(parseVariant(i)).length;
    return h("span", { class: "faint" }, `${n} question${n === 1 ? "" : "s"}`);
  } catch (e) { return h("span", { style: { color: "var(--critical-text)" } }, e.message); }
}

// Model suggestions come from GET /v1/models for the connected key; any name can still be typed.
export function loadModels() {
  const c = W.compare;
  if (c.models || c.modelsLoading || !currentStatus()?.configured) return;
  c.modelsLoading = true;
  api("/api/models").then((res) => {
    c.models = (res.models || []).map((m) => m.name);
    const list = $("#cmp-models");
    if (list) mount(list, c.models.map((n) => h("option", { value: n })));
  }).catch(() => { c.models = []; /* typing a name still works */ }).finally(() => { c.modelsLoading = false; });
}

function variantPanel(i) {
  const v = W.compare.variants[i];
  const name = VARIANTS[i];
  const area = h("textarea", { class: "input", spellcheck: "false", "aria-label": `Variant ${name} questions as JSON` }, v.text);
  const note = h("div", { style: { fontSize: "12px" } }, variantStatus(i));
  area.addEventListener("input", () => { v.text = area.value; mount(note, variantStatus(i)); });
  const model = h("input", { class: "input", list: "cmp-models", value: v.model, spellcheck: "false", "aria-label": `Variant ${name} model`,
    placeholder: `Current model (${currentStatus()?.model || "jev-latest"})` });
  model.addEventListener("input", () => { v.model = model.value; });
  const rows = i === 1 ? h("select", { class: "input", "aria-label": `Rows variant ${name} is sent` },
    Object.entries(PERTURBS).map(([k, label]) => h("option", { value: k, selected: k === v.perturb }, k ? `The rows, ${label}` : "The rows as written"))) : null;
  rows?.addEventListener("change", () => { v.perturb = rows.value; render(); });
  const asked = i === 1 ? h("select", { class: "input", "aria-label": `How variant ${name} asks` },
    h("option", { value: "", selected: !v.average }, "Once, with the options as listed"),
    h("option", { value: "both", selected: v.average }, "Twice, with the options in both orders, averaged")) : null;
  asked?.addEventListener("change", () => { v.average = asked.value === "both"; render(); });
  const set = (questions) => { v.text = JSON.stringify(questions, null, 2); render(); };
  return h("div", { class: "panel raw" },
    h("div", { class: "panel-head" }, h("i", { class: `cmp-key ${name.toLowerCase()}` }), h("h2", {}, `Variant ${name}`), h("div", { class: "spacer" }),
      h("div", { class: "chips" },
        h("button", { class: "btn sm ghost", onclick: () => set(toQuestions(W.questions)) }, "Build questions"),
        h("button", { class: "btn sm ghost", onclick: () => set(W.bulk.sampleQuestions) }, "Sample"),
        h("button", { class: "btn sm ghost", onclick: () => set(W.compare.terse) }, "Sample, terse"),
        i === 1 ? h("button", { class: "btn sm ghost", title: "A's questions and model", onclick: () => { v.text = W.compare.variants[0].text; v.model = W.compare.variants[0].model; render(); } }, "Copy A") : null,
        i === 1 ? h("button", { class: "btn sm ghost", title: "A's questions and model, with each Choice question's options in reverse order", onclick: reverseA }, "Reverse A's options") : null,
        i === 1 ? h("button", { class: "btn sm ghost", title: "A's questions and model, asked in both option orders and averaged", onclick: averageA }, "Average A's orders") : null)),
    h("div", { class: "panel-body grid", style: { gap: "10px" } },
      h("label", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, h("span", { class: "muted" }, "Model"), model),
      rows ? h("label", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, h("span", { class: "muted" }, "Rows"), rows,
        v.perturb ? h("span", { class: "faint" }, "An input check: with B a copy of A (", h("b", {}, "Copy A"), "), any answer that changes changed because of the rewrite.") : null) : null,
      asked ? h("label", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, h("span", { class: "muted" }, "Ask"), asked,
        v.average ? h("span", { class: "faint" }, "Each row is sent twice, the second time with every Choice question's options in reverse order, and the two answers are averaged in code. That costs twice as much per row.") : null) : null,
      area, note));
}

// An order check: B becomes A, with the same model and each Choice question's options in reverse order, so
// any answer that changes changed because of the order alone.
function reverseA() {
  let questions;
  try { questions = parseVariant(0); } catch (e) { return toast(e.message, "error"); }
  const reversed = reverseOptions(questions);
  if (!reversed) return toast("Variant A has no Choice question whose options can be reordered. Score levels keep their order, and options named by whole numbers always list in ascending order.", "error");
  const [a, b] = W.compare.variants;
  b.text = JSON.stringify(reversed, null, 2);
  b.model = a.model;
  b.perturb = "";  // the rows as written, so the order is the only change
  b.average = false;
  render();
  toast("B is A with each Choice question's options in reverse order");
}

// A fix to measure against the order check: B asks A's questions twice, once with each Choice question's options
// reversed, and averages the answers (jev/orders.py), so the first and last places trade options.
function averageA() {
  let questions;
  try { questions = parseVariant(0); } catch (e) { return toast(e.message, "error"); }
  const choice = Object.values(questions).some((q) => q && q.type === "choice" && q.criteria && typeof q.criteria === "object" && Object.keys(q.criteria).length > 1);
  if (!choice) return toast("Variant A has no Choice question with two or more options to average over both orders.", "error");
  const [a, b] = W.compare.variants;
  b.text = a.text;
  b.model = a.model;
  b.perturb = "";
  b.average = true;
  render();
  toast("B asks A's questions in both option orders and averages the answers");
}

const runLabel = (n) => [icon("layers"), `Run ${Math.min(n, 200)} rows × 2 variants`];

export function renderCompare() {
  const c = W.compare;
  const b = W.bulk;
  loadModels();
  const count = h("h2", {}, `Rows · ${countRows(b.rowsText)}`);
  // Disabled from state, not on the button alone: a render during a run must not offer a second paid run.
  const runBtn = h("button", { class: "btn primary", id: "cmp-run", onclick: runCompare, disabled: c.running },
    c.running ? [h("span", { class: "spin" }), " Running both variants…"] : runLabel(countRows(b.rowsText)));
  const rows = h("textarea", { class: "input", spellcheck: "false", "aria-label": "Rows, shared with the Bulk tab" }, b.rowsText);
  rows.addEventListener("input", () => {
    b.rowsText = rows.value;
    syncAttachedSets();
    const n = countRows(b.rowsText);
    count.textContent = `Rows · ${n}`;
    if (!c.running) mount(runBtn, runLabel(n));
  });
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("p", { class: "muted", style: { maxWidth: "820px" } }, "Change one thing and measure it: reword a question, trim its criteria, or switch the model. Both variants answer the same labeled rows, and the report shows which one was right more often, how far to trust each one's confidence, and the rows where they disagree. ",
      h("b", {}, "Reverse A's options"), " makes B an order check: if an answer changes when only the order of the options changes, the model is reading the list, not the row. ",
      h("b", {}, "Rows"), ", on B, makes it an input check: B's rows get typos, lowercase, an unrelated sentence, or shuffled fields, changes that should not move a good answer. ",
      h("b", {}, "Average A's orders"), " tests a fix for an order effect: B asks A's questions twice, once with the options reversed, and averages the answers, so the report shows what a second call per row buys."),
    h("div", { class: "grid cmp-grid" }, variantPanel(0), variantPanel(1)),
    h("datalist", { id: "cmp-models" }, (c.models || []).map((n) => h("option", { value: n }))),
    h("div", { class: "grid wb-grid" },
      h("div", { class: "panel bulk" },
        h("div", { class: "panel-head" }, count, h("span", { class: "faint", style: { fontSize: "12px" } }, "shared with Bulk"), h("div", { class: "spacer" }),
          h("button", { class: "btn sm ghost", onclick: loadSampleRows }, "Load sample rows")),
        h("div", { class: "panel-body" }, rows)),
      h("div", { class: "panel" },
        h("div", { class: "panel-head" }, h("h2", {}, "Run both")),
        h("div", { class: "panel-body grid", style: { gap: "10px", fontSize: "12.5px" } },
          h("p", { class: "muted" }, "Each row is sent once per variant, so 40 rows make 80 live calls, or 120 when B asks in both orders. They run 8 at a time and count against the session budget. The report scores both variants only on rows both answered, so a stopped run or a failed call cannot tilt the comparison."),
          h("p", { class: "muted" }, "Labels come from ", h("code", {}, "\"_expect\""), " in the rows. To label in the browser, use the label column on the Bulk tab, then ", h("b", {}, "Keep labels in rows"), ". Only question ids that both variants share, with the same type, are compared."),
          h("div", {}, runBtn, " ", estimateLine(h, api, "compare", () => ({ rows: rowsPayload(), variants: compareVariants() })))))),
    c.result ? renderCompareReport() : null,
    c.result && c.report ? renderCompareRows() : null);
}

const compareVariants = () => VARIANTS.map((_, i) => ({ questions: parseVariant(i), model: W.compare.variants[i].model.trim(),
  perturb: W.compare.variants[i].perturb || null, average_orders: !!W.compare.variants[i].average }));

async function runCompare() {
  const c = W.compare;
  let variants;
  try { variants = compareVariants(); }
  catch (e) { return toast(e.message, "error"); }
  if (c.running) return;
  if (!(await confirmSpend(api, "compare", { rows: rowsPayload(), variants }))) return;
  c.running = true;
  render();
  let done = false;
  try {
    c.result = await api("/api/workbench/compare", { rows: rowsPayload(), variants });
    c.qid = chooseCmpQuestion();
    await rescoreCompare();
    if (c.result.stopped) toast(c.result.stopped, "error");
    done = true;
  } catch (e) { handleError(e); } finally {
    c.running = false;
    render();
  }
  if (done && W.tab === "compare") $("#compare-report")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Question ids both variants asked with the same type, in A's order.
function cmpQuestions(res) {
  const [qa, qb] = res.variants.map((v) => v.questions);
  return Object.keys(qa).filter((q) => qb[q] && qb[q].type === qa[q].type);
}
function cmpLabeled(res) {
  const qids = new Set();
  for (const r of res.results) for (const q of Object.keys(r.expect || {})) qids.add(q);
  return qids;
}
function chooseCmpQuestion() {
  const c = W.compare;
  const qids = cmpQuestions(c.result);
  const labeled = cmpLabeled(c.result);
  if (qids.includes(c.qid) && (labeled.has(c.qid) || !labeled.size)) return c.qid;
  return qids.find((q) => labeled.has(q)) || qids[0] || null;
}

let cmpSeq = 0;
async function rescoreCompare() {
  const c = W.compare;
  const qid = c.qid;
  const seq = ++cmpSeq;  // only the latest request may install its report
  c.report = null;
  c.reportError = null;
  if (!qid) return;
  const rows = c.result.results.filter((r) => r.runs.some((run) => run.answers?.[qid]))
    .map((r) => ({ index: r.index, label: r.expect?.[qid] ?? null, answers: r.runs.map((run) => run.answers?.[qid] ?? null),
      meta: r.runs.map((run) => (run.meta ? { cost_usd: run.meta.cost_usd, latency_ms: run.meta.latency_ms } : null)) }));
  if (!rows.length) return;
  try {
    const report = await api("/api/workbench/compare/score", { rows, signal: c.signal, first: c.first, bound: c.bound });
    if (seq === cmpSeq) {
      c.report = report;
      // Start where the cascade first matches the second variant. When the first variant matches it
      // alone, or nothing does, start at the most accurate point instead.
      const cas = report.cascade;
      if (cas) c.cascadeT = (cas.match?.escalated ? cas.match : cas.best).threshold;
    }
  } catch (e) { if (seq === cmpSeq) c.reportError = e.message; }
}

// Index of the better of two numbers, or -1 for a tie or a missing value.
function better(values, higher = true) {
  const [a, b] = values;
  if (a === null || a === undefined || b === null || b === undefined || Math.abs(a - b) < 1e-9) return -1;
  return (a > b) === higher ? 0 : 1;
}

function summaryRow(label, cells, values = null, higher = true) {
  const win = values ? better(values, higher) : -1;
  return h("tr", {}, h("th", {}, label), cells.map((cell, i) => h("td", {}, i === win ? [h("b", {}, cell), h("span", { class: "faint" }, " · better")] : cell)));
}

function summaryTable(res, rep) {
  const vs = res.variants;
  const rows = [
    summaryRow("model", vs.map((v) => h("span", { class: "mono" }, v.model))),
    summaryRow("questions", vs.map((v) => String(Object.keys(v.questions).length))),
    vs.some((v) => v.perturb) ? summaryRow("rows sent", vs.map((v) => (v.perturb ? `${PERTURBS[v.perturb] || v.perturb} · ${v.perturbed_rows} of ${res.rows} rewritten` : "as written"))) : null,
    vs.some((v) => v.average_orders) ? summaryRow("asked", vs.map((v) => (v.average_orders ? "twice, options in both orders, averaged" : "once"))) : null,
    summaryRow("rows answered", vs.map((v) => `${v.completed} of ${res.rows}${v.errors ? ` · ${v.errors} failed` : ""}`)),
    summaryRow(vs.some((v) => v.average_orders) ? "median latency, slower of two calls when asked twice" : "median latency", vs.map((v) => (v.latency_ms_median === null ? "—" : ms(v.latency_ms_median))), vs.map((v) => v.latency_ms_median), false),
    summaryRow("input tokens", vs.map((v) => num(v.input_tokens)), vs.map((v) => (v.completed ? v.input_tokens / v.completed : null)), false),
    summaryRow("cost", vs.map((v) => usd(v.cost_usd)), vs.map((v) => (v.completed ? v.cost_usd / v.completed : null)), false),
  ];
  const sv = rep?.variants;
  if (sv && sv.some((v) => v.labeled)) {
    rows.push(
      summaryRow(`accuracy · ${W.compare.qid}`, sv.map((v) => (v.accuracy === null ? "—" : withCI(`${pct(v.accuracy, 1)} (${v.correct}/${v.labeled})`, v.accuracy_low, v.accuracy_high))), sv.map((v) => v.accuracy)),
      summaryRow("calibration gap (ECE)", sv.map((v) => (v.ece === null ? "—" : `${(v.ece * 100).toFixed(1)} pts`)), sv.map((v) => v.ece), false));
    (sv[0].targets.length ? sv[0] : sv[1]).targets.forEach((t, k) => {
      const hits = sv.map((v) => v.targets[k]);
      const lower = rep.bound === "lower";
      rows.push(summaryRow(`automates at ${pct(t.target)} accuracy${lower ? ", 95% confidence" : ""}`,
        hits.map((x, i) => (x?.threshold === null || !x ? (lower && sv[i].labeled < t.needed ? `not shown: needs ${t.needed}+ rows` : "not reached") : `${pct(x.coverage)} (≥ ${x.threshold.toFixed(2)})`)),
        hits.map((x) => (x ? x.coverage : null))));
    });
  }
  return h("div", { class: "scroll" }, h("table", { class: "table cmp-table" },
    h("thead", {}, h("tr", {}, h("th", {}), VARIANTS.map((name) => h("th", {}, h("i", { class: `cmp-key ${name.toLowerCase()}` }), `Variant ${name}`)))),
    h("tbody", {}, rows)));
}

function pairedBlock(rep) {
  const p = rep.paired;
  const split = p.a_only + p.b_only;
  let verdict;
  if (!split) {
    verdict = `A and B were right on exactly the same rows, so these labels cannot tell them apart.`;
  } else {
    const lead = p.a_only > p.b_only ? "A" : p.b_only > p.a_only ? "B" : null;
    const chance = p.p_value < 0.001 ? "less than 0.1%" : pct(p.p_value, 1);
    verdict = `On ${split} row${split === 1 ? "" : "s"} exactly one variant was right: A on ${p.a_only}, B on ${p.b_only}. ` +
      `If neither were better, a split at least this uneven would happen ${chance} of the time (exact McNemar test). ` +
      (!lead ? "Neither is ahead on these rows."
        : p.p_value < 0.05 ? `${lead} is ahead, and chance is an unlikely explanation.`
          : `${lead} is ahead, but that could be chance. Label more rows before you switch.`);
  }
  return h("div", { class: "grid", style: { gap: "8px" } },
    h("h3", { class: "cal-h" }, `Row by row: ${p.rows} labeled rows that both variants answered`),
    h("div", { class: "stat-row" },
      stat("both right", String(p.both_right)), stat("only A right", String(p.a_only), true),
      stat("only B right", String(p.b_only), true), stat("both wrong", String(p.both_wrong))),
    h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px" } }, verdict));
}

function renderCompareReport() {
  const c = W.compare;
  const res = c.result;
  const qids = cmpQuestions(res);
  const labeled = cmpLabeled(res);
  const qSel = h("select", { class: "input", "aria-label": "Question to compare" },
    qids.map((q) => h("option", { value: q, selected: q === c.qid }, labeled.has(q) ? q : `${q} (no labels)`)));
  qSel.addEventListener("change", async () => { c.qid = qSel.value; await rescoreCompare(); render(); });
  const sigSel = h("select", { class: "input", "aria-label": "Signal to gate on" },
    Object.entries(SIGNALS).map(([k, label]) => h("option", { value: k, selected: k === c.signal }, `gate on ${label}`)));
  sigSel.addEventListener("change", async () => { c.signal = sigSel.value; await rescoreCompare(); render(); });
  const rep = c.report;
  const hasLabels = rep && rep.variants.some((v) => v.labeled);
  const use = (i) => h("button", { class: "btn sm", onclick: () => {
    W.questions = fromQuestions(res.variants[i].questions);
    W.result = null;
    W.raw = false;
    W.tab = "build";
    location.hash = "build";
    render();
    toast(`Build now has variant ${VARIANTS[i]}'s questions`);
  } }, `Use ${VARIANTS[i]} in Build`);
  const failures = res.results.flatMap((r) => r.runs.map((run, v) => (run.error ? `row ${r.index + 1} (${VARIANTS[v]}): ${run.error}` : null)).filter(Boolean));
  const notes = [
    failures.length ? h("p", { style: { color: "var(--critical-text)" } }, `${failures.length} calls failed: `, failures.slice(0, 3).join("; "), failures.length > 3 ? "…" : "") : null,
    rep ? rep.variants.map((v, i) => (v.invalid.length ? h("p", { style: { color: "var(--critical-text)" } },
      `${v.invalid.length} labels ignored for ${VARIANTS[i]}: `, v.invalid.slice(0, 3).map((x) => `row ${x.index + 1}: ${x.reason}`).join("; ")) : null)) : null,
    rep && (rep.only_a || rep.only_b) ? h("p", { class: "faint" }, `${rep.only_a + rep.only_b} rows answered by only one variant (A ${rep.only_a}, B ${rep.only_b}) are left out, so both sides are scored on the same rows.`) : null,
    rep?.excluded ? h("p", { class: "faint" }, `${rep.excluded} labels that one variant cannot score are left out of both.`) : null,
    hasLabels && rep.paired.rows < 100 && rep.paired.rows ? h("p", { class: "faint" }, `With ${rep.paired.rows} paired rows, one row moves accuracy by ${(100 / rep.paired.rows).toFixed(1)} points. Pin model versions (for example jev-1.14.0) when you compare wording, so a model update does not change the result.`) : null,
  ];
  let body;
  if (!qids.length) {
    body = h("p", { class: "muted" }, "The variants share no question id with the same type, so there is nothing to compare. Use the same ids in both.");
  } else if (c.reportError) {
    body = h("p", { style: { color: "var(--critical-text)" } }, c.reportError);
  } else {
    body = [
      summaryTable(res, rep),
      !hasLabels ? h("p", { class: "muted" }, `No labels for “${c.qid}”. Add `, h("code", {}, "\"_expect\""), " to the rows to score accuracy; the disagreements below still show where the variants differ.") : null,
      hasLabels ? pairedBlock(rep) : null,
      hasLabels ? h("div", { class: "cal-chart-wrap" },
        h("h3", { class: "cal-h" }, "Accuracy against the share automated, as the threshold moves"),
        h("div", { class: "cal-legend" }, res.variants.map((v, i) => h("span", {}, h("i", { class: `cmp-key ${VARIANTS[i].toLowerCase()}` }), `Variant ${VARIANTS[i]} · ${v.model}`))),
        h("div", { id: "cmp-chart" }),
        h("div", { class: "cal-tip", id: "cmp-tip", hidden: true }),
        h("p", { class: "faint", style: { fontSize: "12px" } }, "Each line starts at the strictest threshold (few rows automated, usually the most accurate) and ends with every row automated. A line that stays higher automates the same share more accurately."),
        cmpSweepTable(rep)) : null,
      hasLabels && rep.cascade ? cascadeBlock(res, rep) : null,
    ];
  }
  return h("div", { class: "panel", id: "compare-report" },
    h("div", { class: "panel-head" }, icon("layers"), h("h2", {}, "Compare"),
      h("span", { class: "faint", style: { fontSize: "12px" } }, "scored from these answers, no extra calls"), h("div", { class: "spacer" }),
      qids.length ? h("div", { class: "cal-controls" }, qSel, sigSel, boundSelect(c, async () => {
        const keep = c.cascadeT;  // the basis changes only the targets, so the cascade keeps its threshold
        await rescoreCompare();
        c.cascadeT = keep;
      })) : null),
    h("div", { class: "panel-body grid", style: { gap: "14px" } },
      h("div", { class: "stat-row" },
        stat("rows", String(res.rows)), stat("labeled", String(res.labeled)),
        res.held_out ? stat("test rows left out", String(res.held_out)) : null,
        stat("wall", ms(res.wall_ms), true), stat("cost, both variants", usd(res.cost_usd))),
      agreementBlock(res),
      ordersBlock(res),
      body,
      h("div", { class: "grid", style: { gap: "4px", fontSize: "12.5px" } }, notes),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, use(0), use(1))));
}

// How often A and B answer each shared question differently, read from the answers, so it needs no labels.
// When B lists a Choice question's options in another order and changes nothing else (jev/compare.py
// reordered), every changed answer comes from the order alone.
function agreementBlock(res) {
  const c = W.compare;
  const perturbed = (res.agreement || []).some((a) => a.perturbed);
  const kind = res.variants.find((v) => v.perturb);
  const how = kind ? PERTURBS[kind.perturb] || kind.perturb : "";
  const rows = (res.agreement || []).filter((a) => a.answered);
  if (!rows.length && perturbed && !kind.perturbed_rows) {
    return h("div", { class: "grid", style: { gap: "8px" } },
      h("h3", { class: "cal-h" }, `Input check: the rows ${how}`),
      h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px", margin: 0 } },
        `The rewrite left every row as it was (say, text rows have one field to shuffle), so B repeated A's request and there is nothing to check. Try another rewrite.`));
  }
  if (!rows.length) return null;
  const moved = rows.filter((a) => a.reordered);
  const show = (qid) => async () => {
    c.qid = qid;
    await rescoreCompare();
    render();
    $("#compare-rows")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const notes = moved.map((a) => (a.changed
    ? `“${a.qid}”: ${a.changed} of ${a.answered} answers changed when only the order of its options changed` +
      (a.options === 2 ? ". With two options, a changed answer always picks the same place in the list, so the place cannot tell position from option."
        : a.same_position ? `, and ${a.same_position} of those picked the option in the same place in both lists, as an answer that follows the position would.` : ".")
    : `“${a.qid}”: no answer changed on ${a.answered} rows when only the order of its options changed.`));
  if (perturbed) {
    const changed = rows.filter((a) => a.changed);
    notes.push(changed.length
      ? `Answers that changed when only the rows were rewritten ${how}: ${changed.map((a) => `“${a.qid}” ${a.changed} of ${a.answered}`).join(", ")}.`
      : `No answer changed on any question when the rows were rewritten ${how}.`);
    const same = kind.unperturbed_rows;
    if (same) notes.push(`${same} of ${res.rows} rows came out of the rewrite unchanged (say, a row with one field to shuffle or no long words). B repeated A's request on them, so they are left out of the input check.`);
  }
  return h("div", { class: "grid", style: { gap: "8px" } },
    h("h3", { class: "cal-h" }, moved.length ? "Order check: how often an answer changes when only the order of the options changes"
      : perturbed ? `Input check: how often an answer changes when only the rows are rewritten ${how}` : "Agreement: how often A and B answer each question differently"),
    h("div", { class: "scroll" }, h("table", { class: "table cmp-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "question"), h("th", {}, "rows both answered"), h("th", {}, moved.length || perturbed ? "answers changed" : "answers differ"),
        moved.length ? h("th", { title: "Changed answers that picked the option in the same place in each variant's list" }, "same place in the list") : null, h("th", {}))),
      h("tbody", {}, rows.map((a) => h("tr", {},
        h("th", {}, a.qid, a.reordered ? h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, "options reordered") : null),
        h("td", {}, String(a.answered)),
        h("td", {}, withCI(`${a.changed} · ${pct(a.rate, 1)}`, a.low, a.high)),
        moved.length ? h("td", {}, a.reordered && a.changed ? `${a.same_position} of ${a.changed}` : "—") : null,
        h("td", {}, a.changed && a.qid !== c.qid ? h("button", { class: "btn sm ghost", onclick: show(a.qid) }, "Show rows")
          : a.changed ? h("span", { class: "faint" }, "shown below") : null)))))),
    notes.length ? h("div", { class: "grid", style: { gap: "4px" } }, notes.map((n) => h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px", margin: 0 } }, n))) : null,
    h("p", { class: "faint", style: { fontSize: "12px", maxWidth: "820px", margin: 0 } }, moved.length
      ? "Each answer is A's and B's top pick on the same row. The interval is 95%. A small share can still matter: those rows get a different answer depending on how the options happen to be listed."
      : perturbed ? "Each answer is A's top pick on the row as written and B's on the rewritten row. The interval is 95%. A changed answer can also come from a row the model finds close either way, so compare with a run of B as a plain copy of A."
        : "Each answer is the top pick on the same row, labeled or not. The interval is 95%."));
}

// For a variant that averages over both orders (jev/orders.py): how often its two calls picked different options.
// Those are the rows where averaging decides the answer, and the share is an order check from the same calls.
function ordersBlock(res) {
  const vs = res.variants.map((v, i) => ({ ...v, name: VARIANTS[i] })).filter((v) => v.average_orders && v.orders?.some((o) => o.answered));
  if (!vs.length) return null;
  return h("div", { class: "grid", style: { gap: "8px" } },
    h("h3", { class: "cal-h" }, "Order averaging: how often the two orders disagree"),
    h("div", { class: "scroll" }, h("table", { class: "table cmp-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "variant"), h("th", {}, "question"), h("th", {}, "rows both orders answered"), h("th", {}, "orders picked differently"))),
      h("tbody", {}, vs.flatMap((v) => v.orders.filter((o) => o.answered).map((o) => h("tr", {},
        h("th", {}, h("i", { class: `cmp-key ${v.name.toLowerCase()}` }), v.name),
        h("td", {}, o.qid),
        h("td", { class: "num" }, String(o.answered)),
        h("td", {}, withCI(`${o.changed} (${pct(o.rate, 1)})`, o.low, o.high)))))))),
    h("p", { class: "faint", style: { fontSize: "12px", maxWidth: "820px", margin: 0 } },
      "Each row was asked with the options as listed and in reverse order. Where the two picks differ, the averaged probabilities decide, and the confidence usually falls, so a threshold may send those rows to review. ",
      "Only Choice questions with two or more options are averaged; every other question keeps the answer from the call with the options as listed. Compare the variants above to see whether the second call is worth its cost."));
}

function cmpSweepTable(rep) {
  const [a, b] = rep.variants;
  const cell = (p) => [h("td", {}, `${p.automated} · ${pct(p.coverage)}`), h("td", {}, p.accuracy === null ? "—" : withCI(pct(p.accuracy, 1), p.low, p.high))];
  return h("details", {}, h("summary", { class: "faint", style: { fontSize: "12.5px", cursor: "pointer" } }, "Curves as a table"),
    h("div", { class: "scroll" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "threshold"), h("th", {}, "A automated"), h("th", {}, "A accuracy"), h("th", {}, "B automated"), h("th", {}, "B accuracy"))),
      h("tbody", {}, a.sweep.filter((p) => Math.round(p.threshold * 100) % 5 === 0).map((p) => h("tr", {},
        h("td", { class: "mono" }, p.threshold.toFixed(2)), cell(p), cell(b.sweep[Math.round(p.threshold * 100)])))))));
}

// The rewritten row a perturbed variant was sent, under the row as written, and what an averaged variant
// picked in each order.
function sentText(res, index) {
  const runs = res.results[index]?.runs || [];
  const qid = W.compare.qid;
  return runs.flatMap((run, v) => [
    run && "input" in run
      ? h("div", { class: "faint", style: { marginTop: "4px", fontSize: "12px" } }, h("b", {}, `${VARIANTS[v]} saw: `), rowText(run.input))
      : null,
    run?.orders?.[qid]
      ? h("div", { class: "faint", style: { marginTop: "4px", fontSize: "12px" } }, h("b", {}, `${VARIANTS[v]} in each order: `),
        `${run.orders[qid][0]} as listed, ${run.orders[qid][1]} reversed`)
      : null]);
}

function renderCompareRows() {
  const c = W.compare;
  const rep = c.report;
  const res = c.result;
  const verdicts = { a_only: ["pass", "A right"], b_only: ["pass", "B right"], both_wrong: ["fail", "Both wrong"] };
  const answer = (x) => h("td", {}, h("span", { class: "cell-choice" }, x.predicted),
    h("span", { class: "faint mono", style: { marginLeft: "6px", fontSize: "11px" } }, x.signal.toFixed(2)),
    x.correct === null ? null : h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, x.correct ? "right" : "wrong"));
  return h("div", { class: "panel", id: "compare-rows" },
    h("div", { class: "panel-head" }, icon("list"), h("h2", {}, `Rows where A and B answer “${c.qid}” differently · ${rep.disagreements.length}`), h("div", { class: "spacer" }),
      h("span", { class: "faint", style: { fontSize: "12px" } }, `${rep.agree} of ${rep.answered_both} rows agree`)),
    rep.disagreements.length
      ? h("div", { class: "scroll" }, h("table", { class: "table bulk-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "row"), h("th", {}, "label"), h("th", {}, "A"), h("th", {}, "B"), h("th", {}, "result"))),
        h("tbody", {}, rep.disagreements.map((d) => h("tr", {},
          h("td", { class: "num" }, String(d.index + 1)),
          h("td", { class: "row" }, rowText(res.results[d.index]?.row), sentText(res, d.index)),
          h("td", {}, d.label ?? h("span", { class: "faint" }, "—")),
          d.answers.map(answer),
          h("td", {}, d.verdict && verdicts[d.verdict] ? statusBadge(...verdicts[d.verdict]) : h("span", { class: "faint" }, "no label")))))))
      : h("div", { class: "panel-body muted" }, "A and B gave the same answer on every row they both answered."));
}

// Accuracy of the automated rows against the share automated: one line per variant, one point per
// distinct automated set (thresholds that automate the same rows give the same point).
function cmpCurve(sweep) {
  const seen = new Map();
  for (const p of sweep) if (p.accuracy !== null && !seen.has(p.automated)) seen.set(p.automated, p);  // lowest threshold first
  return [...seen.values()].sort((x, y) => x.coverage - y.coverage);
}

export function updateCmpChart() {
  const rep = W.compare.report;
  if (!rep || !$("#cmp-chart")) return;
  mount("#cmp-chart", cmpChart(rep));
}

function cmpChart(rep) {
  const curves = rep.variants.map((v) => cmpCurve(v.sweep));
  const W_ = Math.max(320, Math.round($("#cmp-chart")?.clientWidth || 640)), H_ = 260, m = { l: 46, r: 30, t: 14, b: 40 };
  const iw = W_ - m.l - m.r, ih = H_ - m.t - m.b;
  const lowest = Math.min(1, ...curves.flat().map((p) => p.accuracy));
  const y0 = Math.max(0, Math.min(0.5, Math.floor(lowest * 10) / 10));  // accuracy lives near the top; zoom to where it is
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - (v - y0) / (1 - y0)) * ih;
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.coverage).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join("");
  const grid = [y0, (y0 + 1) / 2, 1].map((v) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(v), y2: y(v), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end", class: "cal-axis" }, pct(v))]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, pct(v)));
  // Direct labels just past each line's end (every row automated), nudged apart when they would touch.
  const ends = curves.map((pts) => pts[pts.length - 1]);
  const ly = ends.map((p) => (p ? y(p.accuracy) : null));
  if (ly[0] !== null && ly[1] !== null && Math.abs(ly[0] - ly[1]) < 14) {
    const mid = (ly[0] + ly[1]) / 2, up = ly[0] <= ly[1];
    ly[0] = mid + (up ? -7 : 7); ly[1] = mid + (up ? 7 : -7);
  }
  const labels = ends.map((p, i) => (p ? svg("text", { x: x(p.coverage) + 7, y: ly[i] + 4, class: "cal-label" }, VARIANTS[i]) : null));
  const lines = curves.map((pts, i) => svg("path", { d: path(pts), class: `cal-line ${VARIANTS[i].toLowerCase()}` }));
  const hair = svg("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, class: "cal-hair", visibility: "hidden" });
  const dots = curves.map((_, i) => svg("circle", { r: 4, class: `cal-dot ${VARIANTS[i].toLowerCase()}`, visibility: "hidden" }));
  const hit = svg("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "cal-hit" });
  const summary = rep.variants.map((v, i) => `${VARIANTS[i]}: ${v.accuracy === null ? "no labeled rows" : `${pct(v.accuracy)} accurate with every row automated`}`).join("; ");
  const root = svg("svg", { viewBox: `0 0 ${W_} ${H_}`, width: W_, height: H_, class: "cal-chart", role: "img",
    "aria-label": `Accuracy of automated rows against the share automated, for each variant. ${summary}.` },
  grid, ticks,
  svg("text", { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" }, "share of labeled rows automated"),
  lines, hair, dots, labels, hit);
  const nearest = (pts, v) => pts.reduce((best, p) => (!best || Math.abs(p.coverage - v) < Math.abs(best.coverage - v) ? p : best), null);
  hit.addEventListener("pointermove", (e) => {
    const box = root.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, ((((e.clientX - box.left) / box.width) * W_) - m.l) / iw));
    hair.setAttribute("x1", x(v)); hair.setAttribute("x2", x(v)); hair.setAttribute("visibility", "visible");
    const near = curves.map((pts) => nearest(pts, v));
    near.forEach((p, i) => {
      if (!p) return dots[i].setAttribute("visibility", "hidden");
      dots[i].setAttribute("cx", x(p.coverage)); dots[i].setAttribute("cy", y(p.accuracy)); dots[i].setAttribute("visibility", "visible");
    });
    const tip = $("#cmp-tip");
    const wrap = tip.parentElement.getBoundingClientRect();
    mount(tip, h("div", { class: "faint mono" }, `about ${pct(v)} automated`),
      near.map((p, i) => (p ? h("div", {}, h("i", { class: `cmp-key ${VARIANTS[i].toLowerCase()}` }), h("b", {}, VARIANTS[i]),
        ` ${pct(p.accuracy, 1)} accurate (${interval(p.low, p.high)}) · ${pct(p.coverage)} automated at ≥ ${p.threshold.toFixed(2)}`) : null)));
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX - wrap.left + 14, wrap.width - 250)}px`;
    tip.style.top = `${e.clientY - wrap.top + 10}px`;
  });
  hit.addEventListener("pointerleave", () => {
    hair.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
    $("#cmp-tip").hidden = true;
  });
  return root;
}

// ---------- Cascade ----------
// Ask one variant first and the other only when the first is unsure. Both variants already answered every
// scored row, so jev/compare.py reads each threshold's accuracy, cost, and latency from those answers.
function cascadeSummary(cas, signal) {
  const [f, s] = [cas.first, cas.second];
  const fa = cas.first_alone, sa = cas.second_alone, m = cas.match, b = cas.best;
  const asks = (p) => `${p.escalated} of ${cas.rows} rows (${pct(p.share)})`;
  const parts = [];
  if (m && !m.escalated) {
    parts.push(`${f} alone is already at least as accurate as ${s} on these rows (${pct(fa.accuracy, 1)} against ${pct(sa.accuracy, 1)}).`);
  } else if (m) {
    const cost = m.cost_usd !== null && sa.cost_usd > 0 ? `, for ${pct(m.cost_usd / sa.cost_usd)} of what ${s} alone costs` : "";
    parts.push(`Asking ${s} on the ${asks(m)} where ${f} is least sure matches ${s}'s accuracy, ${pct(sa.accuracy, 1)}${cost}.`);
  } else {
    parts.push(`No threshold reaches ${s}'s accuracy (${pct(sa.accuracy, 1)}): ${f} answers some rows with a ${SIGNALS[signal]} of 1.00, and a cascade always keeps those.`);
  }
  if (b.accuracy > Math.max(fa.accuracy, sa.accuracy) + 1e-9) {
    parts.push(`At ≥ ${b.threshold.toFixed(2)} the cascade is right more often than either variant alone: ${pct(b.accuracy, 1)}, asking ${s} on ${asks(b)}.`);
  }
  return parts.join(" ");
}

function cascadeBlock(res, rep) {
  const c = W.compare;
  const cas = rep.cascade;
  const [f, s] = [cas.first, cas.second];
  const order = h("select", { class: "input", "aria-label": "Variant the cascade asks first" },
    VARIANTS.map((name, i) => h("option", { value: name, selected: name === cas.first }, `${name} first, then ${VARIANTS[1 - i]}`)));
  order.addEventListener("change", async () => { c.first = order.value; await rescoreCompare(); render(); });
  const slider = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: c.cascadeT, id: "cas-slider", class: "cal-slider",
    "aria-label": `Minimum ${SIGNALS[c.signal]} for ${f} to answer alone` });
  slider.addEventListener("input", () => { c.cascadeT = Number(slider.value); updateCascade(); });
  const set = (t) => { c.cascadeT = t; updateCascade(); };
  const m = cas.match, b = cas.best;
  const chips = [
    m?.escalated ? h("button", { class: "chip", onclick: () => set(m.threshold) }, `Match ${s} → ≥ ${m.threshold.toFixed(2)}, asks ${s} on ${pct(m.share)}`)
      : h("button", { class: "chip", disabled: true }, m ? `${f} alone already matches ${s}` : `${s}'s accuracy: not reached on these rows`),
    !m || b.threshold !== m.threshold
      ? h("button", { class: "chip", onclick: () => set(b.threshold) }, `Most accurate, ${pct(b.accuracy, 1)} → ≥ ${b.threshold.toFixed(2)}, asks ${s} on ${pct(b.share)}`) : null,
  ];
  const known = cas.second_alone.cost_usd !== null;
  return h("div", { class: "grid", id: "cascade", style: { gap: "10px" } },
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
      h("h3", { class: "cal-h", style: { margin: 0 } }, `Cascade: ask one variant first, and the other only when it is unsure · ${cas.rows} labeled rows`),
      h("div", { class: "spacer" }), h("div", { class: "cal-controls" }, order)),
    h("p", { class: "muted", style: { fontSize: "12.5px", maxWidth: "820px" } }, cascadeSummary(cas, c.signal)),
    h("div", { class: "cal-gate" },
      h("label", { for: "cas-slider" }, `Keep ${f}'s answer when its ${SIGNALS[c.signal]} ≥ `, h("b", { id: "cas-value", class: "mono" })),
      slider),
    h("div", { class: "chips" }, chips),
    h("div", { id: "cas-table", class: "scroll" }),
    h("div", { class: "cal-chart-wrap" },
      h("div", { class: "cal-legend" },
        h("span", {}, h("i", { class: "cal-key cas" }), `Cascade accuracy as more rows go to ${s}`),
        h("span", {}, h("i", { class: `cmp-key ${f.toLowerCase()}` }), `${f} alone`),
        h("span", {}, h("i", { class: `cmp-key ${s.toLowerCase()}` }), `${s} alone`)),
      h("div", { id: "cas-chart" })),
    h("div", { class: "code" }, h("pre", { id: "cas-code" }),
      h("button", { class: "btn sm copy", onclick: () => copyText($("#cas-code").textContent) }, icon("copy"), "Copy")),
    h("p", { class: "faint", style: { fontSize: "12px", maxWidth: "820px" } },
      `Moving the threshold makes no calls. ${known
        ? `Cost counts ${f}'s call on every row and ${s}'s call on each escalated row, and each call asks all of its variant's questions. Latency adds both calls, because the second waits for the first.`
        : "Cost and latency are not shown, because some rows have no usage."}`));
}

function cascadeTable(cas, p) {
  const [f, s] = [cas.first, cas.second];
  const n = cas.rows;
  const row = (label, x, escalated) => h("tr", {}, h("th", {}, label),
    h("td", {}, `${pct(x.accuracy, 1)} (${x.correct}/${n})`), h("td", {}, escalated),
    h("td", {}, x.cost_usd === null ? "—" : usd((x.cost_usd / n) * 1000)), h("td", {}, x.latency_ms === null ? "—" : ms(x.latency_ms)));
  return h("table", { class: "table cmp-table" },
    h("thead", {}, h("tr", {}, h("th", {}), h("th", {}, "accuracy"), h("th", {}, `rows sent to ${s}`), h("th", {}, "cost per 1,000 rows"), h("th", {}, "mean latency"))),
    h("tbody", {},
      row(`${f} alone`, cas.first_alone, "none"),
      row(h("b", {}, `Cascade at ≥ ${p.threshold.toFixed(2)}`), p, `${p.escalated} · ${pct(p.share)}`),
      row(`${s} alone`, cas.second_alone, "all")));
}

function cascadeCode(rep, res, t) {
  const cas = rep.cascade;
  const [fi, si] = [VARIANTS.indexOf(cas.first), VARIANTS.indexOf(cas.second)];
  const key = JSON.stringify(W.compare.qid);
  const qs = (i) => `questions_${VARIANTS[i].toLowerCase()}`;
  const call = (i) => `client.system_one(state, ${qs(i)}, model=${JSON.stringify(res.variants[i].model)})`;
  let read, gate;
  if (rep.type === "noul") {
    read = `p = first.nouls[${key}].noul`;
    gate = rep.signal === "confidence" ? "abs(2 * p - 1)" : "max(p, 1 - p)";
  } else {
    read = `answer = first.${rep.type === "choice" ? "choices" : "scores"}[${key}]`;
    gate = rep.signal === "confidence" ? "answer.confidence"
      : rep.type === "choice" ? "answer.probabilities[answer.choice]" : "max(answer.probabilities.values())";
  }
  return `# ${qs(fi)} and ${qs(si)} are variant ${cas.first}'s and ${cas.second}'s questions; Build's Export writes them as Python.\n` +
    `first = ${call(fi)}\n${read}\nif ${gate} + 1e-9 >= ${t.toFixed(2)}:  # the report's tolerance for float rounding\n    result = first\nelse:\n    result = ${call(si)}\n`;
}

// Refresh the parts that follow the cascade threshold without rebuilding the slider under the pointer.
export function updateCascade() {
  const c = W.compare;
  const rep = c.report;
  if (!rep?.cascade || !$("#cas-table")) return;
  const t = c.cascadeT;
  const p = rep.cascade.sweep[Math.round(t * 100)];
  const slider = $("#cas-slider");
  if (slider && Number(slider.value) !== t) slider.value = t;
  mount("#cas-value", t.toFixed(2));
  mount("#cas-table", cascadeTable(rep.cascade, p));
  mount("#cas-chart", cascadeChart(rep.cascade, p));
  $("#cas-code").textContent = cascadeCode(rep, c.result, t);
}

// Accuracy against the share of rows sent to the second variant. The line runs from the first variant
// alone (nothing escalated) to the second alone (everything escalated); the dot is the chosen threshold.
function cascadeChart(cas, p) {
  const seen = new Map();
  for (const q of cas.sweep) if (!seen.has(q.escalated)) seen.set(q.escalated, q);  // lowest threshold first
  const pts = [...seen.values()].sort((x, y) => x.share - y.share);
  const W_ = Math.max(320, Math.round($("#cas-chart")?.clientWidth || 640)), H_ = 240, m = { l: 46, r: 18, t: 22, b: 40 };
  const iw = W_ - m.l - m.r, ih = H_ - m.t - m.b;
  const ends = [cas.first_alone.accuracy, cas.second_alone.accuracy];
  const lowest = Math.min(1, ...pts.map((q) => q.accuracy), ...ends);
  const y0 = Math.max(0, Math.min(0.5, Math.floor(lowest * 10) / 10));
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - (v - y0) / (1 - y0)) * ih;
  const grid = [y0, (y0 + 1) / 2, 1].map((v) => [
    svg("line", { x1: m.l, x2: W_ - m.r, y1: y(v), y2: y(v), class: "cal-grid" }),
    svg("text", { x: m.l - 8, y: y(v) + 3.5, "text-anchor": "end", class: "cal-axis" }, pct(v))]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => svg("text", { x: x(v), y: H_ - m.b + 16, "text-anchor": "middle", class: "cal-axis" }, pct(v)));
  const d = pts.map((q, i) => `${i ? "L" : "M"}${x(q.share).toFixed(1)},${y(q.accuracy).toFixed(1)}`).join("");
  const [f, s] = [cas.first.toLowerCase(), cas.second.toLowerCase()];
  const right = p.share > 0.6;
  const root = svg("svg", { viewBox: `0 0 ${W_} ${H_}`, width: W_, height: H_, class: "cal-chart", role: "img",
    "aria-label": `Cascade accuracy against the share of rows sent to ${cas.second}. ${cas.first} alone ${pct(ends[0])}, ${cas.second} alone ${pct(ends[1])}. At ≥ ${p.threshold.toFixed(2)}: ${pct(p.share)} sent, ${pct(p.accuracy)} accurate.` },
  grid, ticks,
  svg("text", { x: m.l + iw / 2, y: H_ - 6, "text-anchor": "middle", class: "cal-axis" }, `share of labeled rows sent to ${cas.second}`),
  svg("line", { x1: x(p.share), x2: x(p.share), y1: m.t, y2: m.t + ih, class: "cal-marker" }),
  svg("path", { d, class: "cal-line cas" }),
  svg("circle", { cx: x(0), cy: y(ends[0]), r: 4, class: `cal-dot ${f}` }),
  svg("circle", { cx: x(1), cy: y(ends[1]), r: 4, class: `cal-dot ${s}` }),
  svg("circle", { cx: x(p.share), cy: y(p.accuracy), r: 5, class: "cal-dot cas" }),
  // Accuracy usually sits near the top, where the line runs flat: label below the dot there, above it lower down.
  svg("text", { x: x(p.share) + (right ? -10 : 10), y: y(p.accuracy) + (y(p.accuracy) < m.t + ih / 2 ? 20 : -9), "text-anchor": right ? "end" : "start", class: "cal-label" },
    `${pct(p.accuracy, 1)} accurate · ${pct(p.share)} sent`));
  return root;
}
