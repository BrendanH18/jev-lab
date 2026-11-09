// Bulk tab: the rows box and its pictures, running the questions over every row, the results table with its
// label controls, and the order of the panels below it.
import {
  $, api, currentStatus, h, handleError, icon, mount, ms, num, pct, prepareImage, statusBadge, toast, usd,
} from "./common.js";
import { bulkPreflightBody, checkBulkPreflight } from "./bulk-preflight.js";
import { datasetEditsBody, confirmDatasetEditsDiscard } from "./dataset-edits.js";
import { confirmSpend, estimateLine } from "./estimate.js";
import { W } from "./workbench-state.js";
import { toQuestions, sampleUrl } from "./workbench-build.js";
import { renderGuide, render } from "./workbench.js";
import { renderDatasets } from "./workbench-datasets.js";
import { renderGateExport } from "./workbench-checks.js";
import { renderImport, healthBody } from "./workbench-import.js";
import { prelabelBody, renderReview } from "./workbench-labeling.js";
import {
  answerClasses, labelText, labelValue, labeledQids, chooseCalQuestion, recalibrate, renderCalibrate, setFitContext,
  syncAttachedSets, renderAnswerSets,
} from "./workbench-calibrate.js";
import { renderCosts } from "./workbench-costs.js";
import { renderRules, GATEABLE, resetPolicy, repolicy, renderPolicy } from "./workbench-policy.js";

// ---------- Bulk ----------
// One row as a line of the rows box, carrying `labels` if given. A text line that would split, lose
// whitespace, or parse as JSON is written as an object so it survives the trip (the server splits rows
// on "\n" and trims each line).
export function rowLineFor(row, labels = null) {
  const has = labels && Object.keys(labels).length;
  if (typeof row === "string") {
    const plain = row === row.trim() && !/^[{[]/.test(row) && !/[\n\r]/.test(row);
    if (!has && plain) return row;
    return JSON.stringify(has ? { text: row, _expect: labels } : { text: row });
  }
  return JSON.stringify(has ? { ...row, _expect: labels } : row);
}

// Rows as the rows box shows them: one per line, or a JSON array when a row is itself an array, since
// an array line would come back as text.
export function rowsText(rows) {
  if (rows.some(Array.isArray)) return `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
  return rows.map((r) => rowLineFor(r)).join("\n");
}

// Rows or labels that a reload would lose: the box differs from the last save or load, or labels were
// typed in the results table and not yet put in the rows.
export const bulkUnsaved = () => W.bulk.rowsText !== W.bulk.savedText || W.bulk.labelsDirty;

function markUnsaved() {
  syncAttachedSets();
  renderGuide();
  const healthPanel = $("#dataset-health");
  if (healthPanel) mount(healthPanel, healthBody());
  const labeling = $("#prelabel-panel");
  if (labeling) mount(labeling, prelabelBody());
  const el = $("#ds-unsaved");
  if (el) el.style.display = bulkUnsaved() ? "" : "none";
}

// Replace the rows box, after a confirm when that would lose unsaved rows or labels.
export function replaceRows(text, what) {
  const b = W.bulk;
  if (bulkUnsaved() && !confirm(`Replace the rows box with ${what}? Rows and labels you have not saved will be lost.`)) return false;
  if (!confirmDatasetEditsDiscard()) return false;
  b.rowsText = b.savedText = text;
  b.labelsDirty = false;
  return true;
}

// Store chosen pictures under data/workbench/images (resized as Build resizes them) and add a row for each.
async function addPictures(input) {
  const files = [...input.files];
  input.value = "";
  if (!files.length) return;
  try {
    // One picture per request: a few detailed photos together could pass the server's request size limit.
    const names = [];
    for (const file of files.slice(0, 20)) {
      const picture = await prepareImage(file);
      const [name] = (await api("/api/workbench/pictures", { pictures: [{ data_base64: picture.data_base64 }] })).names;
      W.bulk.pictures[name] = picture.url;
      names.push(name);
    }
    const b = W.bulk;
    const added = names.map((name) => ({ note: "", _image: name }));
    const current = rowsPayload();  // a JSON array stays an array of rows; lines stay lines
    b.rowsText = Array.isArray(current) ? rowsText([...current, ...added])
      : [b.rowsText.trim(), ...added.map((x) => JSON.stringify(x))].filter(Boolean).join("\n");
    markUnsaved();
    if (files.length > 20) toast("Added the first 20 pictures; add the rest in another batch.", "error");
    else toast(`Added ${names.length} picture row${names.length > 1 ? "s" : ""}. Saved under data/workbench/images.`);
    render();
  } catch (e) { handleError(e); }
}
// Image URLs for the pictures rows name: samples from static files, uploads fetched once.
export async function loadPictureUrls(results) {
  const b = W.bulk;
  const names = [...new Set(results.map((r) => r.row?._image).filter((n) => typeof n === "string" && !b.pictures[n]))];
  const files = names.filter((n) => !/^[a-z-]+$/.test(n));
  for (const n of names) if (/^[a-z-]+$/.test(n)) b.pictures[n] = sampleUrl(n);
  if (!files.length) return;
  try {
    const { pictures } = await api("/api/workbench/pictures/load", { names: files });
    for (const [n, x] of Object.entries(pictures)) b.pictures[n] = `data:image/${x.format === "jpg" ? "jpeg" : "png"};base64,${x.data_base64}`;
  } catch (e) { handleError(e); }
}

export async function loadSampleRows() {
  try {
    const s = await api("/api/workbench/bulk/sample");
    if (!replaceRows(rowsText(s.rows), "the sample rows")) return;
    W.bulk.dataset.id = null;
    render();
  } catch (e) { handleError(e); }
}

// Put labels chosen in the results table into the rows box before the box is saved or run, so they are
// not lost. They fit only the rows that were run; when the box has changed since, ask before dropping them.
export function settleLabels(action) {
  const b = W.bulk;
  if (!b.labelsDirty || !b.result) return true;
  if (b.rowsText === b.runText) return keepLabels(true);
  return confirm(`The rows box has changed since the run, so the labels chosen in the results table cannot be put back in it. ${action} without them?`);
}

// What a label for a question has to be, for the import's warnings.
export function expectedText(q) {
  if (!q) return "a label";
  if (q.type === "noul") return "yes or no";
  if (q.type === "score") return `a level from 0 to ${(q.criteria || []).length - 1}`;
  return `one of its options (${Object.keys(q.criteria || {}).join(", ")})`;
}

export function countRows(text) {
  const t = text.trim();
  if (t.startsWith("[")) { try { const v = JSON.parse(t); if (Array.isArray(v)) return v.length; } catch { /* count lines */ } }
  return text.split("\n").filter((l) => l.trim()).length;
}

// The rows box as the server takes it: a JSON array, or the text itself (one row per line).
export function rowsPayload(rows = W.bulk.rowsText) {
  if (/^\[/.test(rows.trim())) { try { return JSON.parse(rows); } catch { /* keep text */ } }
  return rows;
}

export function bulkQuestions() {
  const b = W.bulk;
  if (b.source === "dataset" && b.dataset.questions) return b.dataset.questions;
  return b.source === "sample" ? b.sampleQuestions : toQuestions(W.questions);
}

export function renderBulk() {
  const b = W.bulk;
  const rows = h("textarea", { class: "input", spellcheck: "false", placeholder: "One item per line. A text line becomes the state {\"text\": line}; a JSON object line is sent as it is. Or paste a JSON array of objects." }, b.rowsText);
  rows.addEventListener("input", () => { b.rowsText = rows.value; markUnsaved(); });
  const nRows = countRows(b.rowsText);
  const current = toQuestions(W.questions);
  const src = (value, label) => {
    const r = h("input", { type: "radio", name: "src", checked: b.source === value });
    r.addEventListener("change", () => { b.source = value; b.csv.columns = {}; render(); });
    return h("label", { class: "toggle", style: { gap: "6px" } }, r, h("span", { class: "track" }), label);
  };
  const runBtn = h("button", { class: "btn primary", id: "bulk-run", disabled: !!b.running, onclick: runBulk }, icon("layers"), `Run ${Math.min(nRows, 200)} rows`);
  return h("div", { class: "grid", style: { gap: "16px" } },
    h("div", { class: "grid wb-grid" },
      h("div", { class: "panel bulk", id: "bulk-rows" },
        h("div", { class: "panel-head" }, h("h2", {}, `Rows · ${nRows}`), h("div", { class: "spacer" }),
          h("button", { class: "btn sm ghost", onclick: () => { b.csv.open = !b.csv.open; render(); if (b.csv.open) $("#csv-import")?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, "Import CSV"),
          h("button", { class: "btn sm ghost", onclick: () => $("#bulk-pictures").click(), title: "Each picture becomes a row whose state names it as photo" }, "Add pictures"),
          h("input", { type: "file", id: "bulk-pictures", accept: "image/png,image/jpeg", multiple: true, hidden: true, onchange: (e) => addPictures(e.target) }),
          h("button", { class: "btn sm ghost", onclick: loadSampleRows }, "Load sample rows")),
        h("div", { class: "panel-body" }, rows,
          h("p", { class: "faint", style: { fontSize: "12px", marginTop: "8px" } }, "Put labels on a JSON row under ", h("code", {}, "\"_expect\""), ", keyed by question id: ",
            h("code", {}, "{\"text\": \"…\", \"_expect\": {\"department\": \"billing\", \"wants_refund\": true}}"), ". Labels never reach the model; Calibrate scores the answers against them. ",
            "A row's ", h("code", {}, "\"_image\""), " names a picture, sent with the row as ", h("code", {}, "photo"), ", so questions can ask about ", h("code", {}, "`photo`"),
            " and Box questions can run. Label a Box with its edges: ", h("code", {}, "{\"left\": 0.4, \"top\": 0.3, \"right\": 0.7, \"bottom\": 0.6}"), "."))),
      h("div", { class: "grid", style: { gap: "16px" } },
        renderDatasets(),
        h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Questions to run on every row")),
          h("div", { class: "panel-body grid", style: { gap: "10px" } },
            src("current", `Current Build questions (${Object.keys(current).length})`),
            src("sample", `Sample: support triage (${Object.keys(b.sampleQuestions || {}).length})`),
            b.dataset.questions ? src("dataset", `Saved with “${b.dataset.name}” (${Object.keys(b.dataset.questions).length})`) : null,
            h("p", { class: "faint", style: { fontSize: "12px" } }, "Each row is its own live request; they run 8 at a time and count against the session budget. Cap: 200 rows per run. The sample rows carry labels for the sample questions."),
            h("div", { id: "dataset-health" }, healthBody()),
            bulkPreflightBody(),
            h("div", {}, runBtn, " ", estimateLine(h, api, "bulk", () => (Object.keys(bulkQuestions()).length ? { rows: rowsPayload(), questions: bulkQuestions() } : null))))),
        h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Why this matters")),
          h("div", { class: "panel-body grid", style: { gap: "6px", fontSize: "12.5px" } },
            h("p", { class: "muted" }, "At $0.042 per million input tokens, a question set over a million short messages costs about ", h("b", {}, "$10"), ". That is why “classify everything, then sort” is finally practical."),
            h("p", { class: "muted" }, "With labeled rows, Calibrate shows how often each answer was right and where to set the confidence threshold: above it your code acts, below it a person reviews. Choose the threshold from your own data, not a default."))))),
    datasetEditsBody(),
    h("div", { id: "prelabel-panel" }, prelabelBody()),
    b.csv.open ? renderImport() : null,
    b.gateExport ? renderGateExport() : null,
    b.result ? renderCosts() : null,
    b.result ? renderCalibrate() : null,
    b.result ? renderAnswerSets() : null,
    b.result ? renderReview() : null,
    b.result ? renderRules() : null,
    b.result ? renderPolicy() : null,
    b.result ? renderBulkTable() : null);
}

async function runBulk() {
  if (W.bulk.running) return;
  W.bulk.running = true;
  try {
    const questions = bulkQuestions();
    if (!Object.keys(questions).length) return toast("No questions. Build some first or pick the sample.", "error");
    if (!settleLabels("Run the rows box")) return;
    const snapshot = JSON.stringify([W.bulk.rowsText, questions]);
    try {
      const checked = await checkBulkPreflight(false);
      if (checked.findings.length && !confirm(`Bulk input checks found ${checked.findings.length} issues. Review Check Bulk inputs before spending, or continue anyway?`)) { render(); return; }
      if (!(await confirmSpend(api, "bulk", { rows: rowsPayload(), questions }))) return;
      if (snapshot !== JSON.stringify([W.bulk.rowsText, bulkQuestions()])) return toast("Rows or questions changed. Run again with the current inputs.", "error");
    } catch (e) { handleError(e); render(); return; }
    const btn = $("#bulk-run");
    btn.disabled = true;
    mount(btn, h("span", { class: "spin" }), " Running…");
    try {
      const b = W.bulk;
      const ranText = b.rowsText;
      const runModel = currentStatus()?.model || "";  // the model can change in Settings after the run
      b.result = await api("/api/workbench/bulk", { rows: rowsPayload(), questions });
      b.runText = ranText;
      b.ranQuestions = questions;
      b.runModel = runModel;
      b.pin = true;
      b.checkForm = { accuracy: null, coverage: null };
      b.testScore = null;
      b.labelsDirty = false;
      b.sortKey = null;
      b.labels = {};
      for (const r of b.result.results) if (r.expect) b.labels[r.index] = { ...r.expect };
      b.review = { report: null, kept: new Set(), all: { suspects: false, next: false } };
      // Keep priced mistakes that still name a question and two of its answers; the new run may ask other questions.
      const asked = bulkQuestionsForResult(b.result);
      b.costs.mistakes = b.costs.mistakes.filter((m) => GATEABLE.has(asked[m.question]?.type)
        && answerClasses(asked[m.question]).includes(m.label) && answerClasses(asked[m.question]).includes(m.answer));
      b.cal.qid = chooseCalQuestion();
      resetPolicy();
      await Promise.all([recalibrate(), repolicy(), loadPictureUrls(b.result.results)]);
      if (b.result.stopped) toast(b.result.stopped, "error");
      render();
      $("#calibrate")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { handleError(e); render(); }
  } finally {
    W.bulk.running = false;
    const runButton = $("#bulk-run");
    if (runButton) runButton.disabled = false;
  }
}

function cellValue(answers, qid) {
  const a = answers?.[qid];
  if (!a) return { sort: -1, text: "" };
  if (a.type === "choice") return { sort: a.choice, text: a.choice, sub: pct(a.probabilities[a.choice]) };
  if (a.type === "score") return { sort: a.score, text: a.score.toFixed(2), heat: a.score / Math.max(1, Object.keys(a.legend).length - 1) };
  if (a.type === "box") return { sort: a.confidence ?? -1, text: ["left", "top", "right", "bottom"].map((k) => a.box[k].toFixed(2)).join(" "), sub: a.confidence === undefined ? "" : pct(a.confidence) };
  return { sort: a.noul, text: pct(a.noul), heat: a.noul };
}

function labelCell(r, qid) {
  return h("td", {}, labelSelect(r, qid));
}

// A label picker for one row and question. Changing it rescores everything that reads labels.
export function labelSelect(r, qid) {
  const b = W.bulk;
  const answer = r.answers?.[qid];
  if (!answer) return null;
  if (answer.type === "box") {  // a Box label is four edges, written in the row's "_expect"
    const label = b.labels[r.index]?.[qid];
    return label && typeof label === "object" ? h("span", { class: "mono faint", style: { fontSize: "11.5px" } }, ["left", "top", "right", "bottom"].map((k) => Number(label[k]).toFixed(2)).join(" ")) : null;
  }
  const current = labelText(b.labels[r.index]?.[qid], answer.type);
  const classes = answerClasses(answer);
  const extra = current && !classes.includes(current) ? [h("option", { value: current, selected: true }, `${current} (invalid)`)] : [];
  const sel = h("select", { class: "input label-sel", "aria-label": `Label for row ${r.index + 1}` },
    h("option", { value: "", selected: !current }, "—"),
    classes.map((c) => h("option", { value: c, selected: c === current }, answer.type === "score" ? `${c} · ${String(answer.legend?.[c] ?? "").slice(0, 32)}` : c)), extra);
  sel.addEventListener("change", async () => {
    const value = labelValue(sel.value, answer.type);
    const labels = { ...(b.labels[r.index] || {}) };
    if (value === null) delete labels[qid]; else labels[qid] = value;
    b.labels[r.index] = labels;
    b.review.kept.delete(`${r.index}:${qid}`);  // a changed label is checked afresh
    b.labelsDirty = true;
    await Promise.all([recalibrate(), repolicy()]);
    render();
  });
  return sel;
}

function renderBulkTable() {
  const b = W.bulk;
  const res = b.result;
  const qids = Object.keys(bulkQuestionsForResult(res));
  const calQ = b.cal.qid;
  const scored = new Map((b.cal.report?.rows || []).map((r) => [r.index, r]));
  let rows = res.results.slice();
  const shown = (r) => (isTest(r) ? null : r.answers);  // a test row's answers stay hidden, even from sorting
  const tests = res.results.filter(isTest).length;
  if (b.sortKey) {
    rows.sort((x, y) => {
      const vx = b.sortKey === "__row" ? x.index : cellValue(shown(x), b.sortKey).sort;
      const vy = b.sortKey === "__row" ? y.index : cellValue(shown(y), b.sortKey).sort;
      return (vx > vy ? 1 : vx < vy ? -1 : 0) * b.sortDir;
    });
  }
  const th = (key, label) => h("th", { class: b.sortKey === key ? "sorted" : "", onclick: () => { b.sortDir = b.sortKey === key ? -b.sortDir : -1; b.sortKey = key; render(); } },
    label, b.sortKey === key ? (b.sortDir < 0 ? " ↓" : " ↑") : "");
  const csv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const labeled = qids.filter((q) => labeledQids(b).has(q));
    const lines = [["row", ...qids, ...labeled.map((q) => `label:${q}`)].map(esc).join(",")];
    for (const r of res.results) {
      lines.push([typeof r.row === "string" ? r.row : JSON.stringify(r.row), ...qids.map((q) => cellValue(shown(r), q).text),
        ...labeled.map((q) => labelText(b.labels[r.index]?.[q], r.answers?.[q]?.type))].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "jev-bulk.csv" });
    document.body.append(a); a.click(); a.remove();
  };
  return h("div", { class: "panel", id: "bulk-table" },
    h("div", { class: "panel-head" }, icon("layers"), h("h2", {}, `${res.completed} of ${res.rows} rows`), h("div", { class: "spacer" }),
      h("div", { class: "stat-row" },
        h("span", { class: "stat accent" }, "wall", h("b", {}, ms(res.wall_ms))),
        h("span", { class: "stat" }, "tokens", h("b", {}, num(res.input_tokens))),
        h("span", { class: "stat" }, "cost", h("b", {}, usd(res.cost_usd))),
        h("button", { class: "btn sm", onclick: () => keepLabels(), title: "Rewrite the rows box as JSON lines that carry these labels, so the next run keeps them" }, "Keep labels in rows"),
        h("button", { class: "btn sm", onclick: csv }, "Download CSV"))),
    tests ? h("p", { class: "faint", style: { fontSize: "12.5px", margin: "8px 16px 0" } }, icon("eye"),
      ` ${tests} test row${tests === 1 ? "" : "s"}: their answers stay hidden and no tuning panel reads them. Score a gate on them from Policy's Test rows.`) : null,
    h("div", { class: "scroll" }, h("table", { class: "table bulk-table" },
      h("thead", {}, h("tr", {}, th("__row", "#"), h("th", {}, "row"), qids.map((q) => th(q, q)),
        calQ ? [h("th", {}, `label · ${calQ}`), h("th", {}, "result"), h("th", {}, "route")] : null)),
      h("tbody", {}, rows.map((r) => h("tr", { "data-index": String(r.index) },
        h("td", { class: "num" }, String(r.index + 1)),
        h("td", { class: "row" }, b.pictures[r.row?._image] ? h("img", { src: b.pictures[r.row._image], alt: r.row._image, class: "row-thumb" }) : null,
          isTest(r) ? h("span", { class: "badge", style: { marginRight: "6px" } }, "test") : null,
          rowText(r.row), r.error ? h("div", { style: { color: "var(--critical-text)", fontSize: "12px" } }, r.error) : null),
        qids.map((q) => {
          if (isTest(r) && r.answers?.[q]) return h("td", { class: `faint${q === calQ ? " cal-col" : ""}`, title: "A test row's answers stay hidden" }, "hidden");
          const v = cellValue(r.answers, q);
          return h("td", { class: q === calQ ? "cal-col" : "" }, v.heat !== undefined
            ? h("span", {}, h("span", { class: "pill-num" }, v.text), h("span", { class: "heat" }, h("i", { style: { width: pct(v.heat, 1) } })))
            : h("span", {}, h("span", { class: "cell-choice" }, v.text), v.sub ? h("span", { class: "faint", style: { marginLeft: "6px", fontSize: "11.5px" } }, v.sub) : null));
        }),
        calQ ? [labelCell(r, calQ),
          h("td", {}, scored.has(r.index) ? (scored.get(r.index).correct ? statusBadge("pass", "Right") : statusBadge("fail", "Wrong")) : null),
          h("td", { class: "route" })] : null))))));
}

// A test row (jev/testsplit.py): held out of every tuning panel and Compare, and its answers stay hidden here.
export const isTest = (r) => !!r.row && typeof r.row === "object" && !Array.isArray(r.row) && r.row._test === true;
// The rows every tuning panel reads: answered, and not test rows.
export const tuningResults = (res) => res.results.filter((r) => r.answers && !isTest(r));

// A row that is only {"text": ...} reads as its text; anything else shows as JSON. A test row's marker is not shown.
export function rowText(row) {
  if (row && typeof row === "object" && !Array.isArray(row) && "_test" in row) {
    const { _test, ...rest } = row;
    row = rest;
  }
  if (typeof row === "string") return row;
  if (row && typeof row === "object" && !Array.isArray(row) && Object.keys(row).length === 1 && typeof row.text === "string") return row.text;
  return JSON.stringify(row);
}

export function bulkQuestionsForResult(res) {
  const first = res.results.find((r) => r.answers);
  return first ? first.answers : {};
}

function keepLabels(quiet = false) {
  const b = W.bulk;
  // One JSON line per row. Array states cannot hold "_expect" and would come back as text, so refuse.
  if (b.result.results.some((r) => Array.isArray(r.row))) {
    toast("Rows that are JSON arrays cannot carry labels. Wrap each one in an object first.", "error");
    return false;
  }
  if (!quiet && b.rowsText !== b.runText
    && !confirm("The rows box has changed since the run. Replace it with the rows that were run, carrying these labels?")) return false;
  syncAttachedSets();
  const fit = b.sets.fitted;
  b.rowsText = b.runText = b.result.results.map((r) => rowLineFor(r.row, b.labels[r.index])).join("\n");
  // Serializing the same rows and labels changes their text, not the data used to fit the cuts.
  b.sets.context = setFitContext();
  if (fit !== null) b.sets.fitted = b.sets.context;
  b.labelsDirty = false;
  if (!quiet) {
    render();
    toast("Rows now carry their labels as JSON lines");
  }
  return true;
}
